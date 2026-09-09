// 资源档案：游戏页整文件 only-if-cached，显示侧共用 archive-capture。
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import { safeConsole } from './crash-log'
import config from './config'
import {
  ASSET_ARCHIVE_MAX_ENTRY_BYTES,
  assetArchiveBlobPath,
  assetArchiveHasBlobFor,
  assetArchiveKey,
  archiveLimitBytes,
  assetArchiveUsage,
  planAssetArchiveEviction,
  sanitizeAssetArchiveEntry as sanitizeEntry,
  type AssetArchiveEntry,
  type AssetArchiveUsage,
} from '../shared/asset-archive-plan'

// 与缓存目录分开，缓存急救不触碰此目录。
const ASSET_ARCHIVE_DIR = path.join(APPDATA_PATH, 'asset-archive')
const INDEX_FILE = path.join(ASSET_ARCHIVE_DIR, 'index.json')
const BLOB_DIR = path.join(ASSET_ARCHIVE_DIR, 'asset')

const SCHEMA_VERSION = 1
/** 条目总数上限。资源档案独立限制索引条目数量。 */
const MAX_ENTRIES = 50_000

let entries = new Map<string, AssetArchiveEntry>()
let loaded = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const load = () => {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    const list = Array.isArray(raw?.entries) ? raw.entries : []
    for (const item of list.slice(-MAX_ENTRIES)) {
      const entry = sanitizeEntry(item)
      if (entry) entries.set(assetArchiveKey(entry.pathname, entry.sha1), entry)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 读不出来就当空档案继续；绝不让它拦住启动，也绝不顺手把 blob 删掉——
      // 索引坏了还能重建，实物没了就真没了。
      safeConsole('warn', '[kuma] 资源档案索引读取失败，按空档案继续', error)
    }
    entries = new Map()
  }
}

const flush = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!dirty) return
  dirty = false
  try {
    fs.mkdirSync(ASSET_ARCHIVE_DIR, { recursive: true })
    atomicWriteJsonSync(INDEX_FILE, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [...entries.values()],
    })
  } catch (error) {
    safeConsole('warn', '[kuma] 资源档案索引落盘失败', error)
  }
}

const scheduleSave = () => {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(flush, 3_000)
  saveTimer.unref?.()
}

/** 退出时调用，别把最后几张见到的丢掉。 */
export const flushAssetArchive = () => flush()

/** 实物文件的绝对路径。相对位置的推导与渲染层共用一份（shared/asset-archive-plan）。 */
const blobFileFor = (entry: AssetArchiveEntry): string | null => {
  const relative = assetArchiveBlobPath(entry.pathname, entry.sha1)
  return relative ? path.join(ASSET_ARCHIVE_DIR, ...relative.split('/')) : null
}

/**
 * 玩家设的上限（MB）。**没设 = 不限量 = 一条都不淘汰**（2026-08-23 起的默认，
 * 与语音档案同一条口径与同一个理由，见 main/voice-archive 的同名函数）。
 */
const limitBytes = (): number | null => {
  const mb = Number(config.get('kuma.archive.assetMaxMB', 0))
  return archiveLimitBytes(Number.isFinite(mb) ? mb * 1024 * 1024 : 0)
}

const evictIfNeeded = () => {
  const evicted = planAssetArchiveEviction([...entries.values()], limitBytes())
  for (const entry of evicted) {
    const file = blobFileFor(entry)
    try {
      // 不同图种可能同名且字节完全相同，按约定共用指纹文件；最后一个引用才删实物。
      const shared = [...entries.values()].some((other) => other !== entry && other.bytes > 0 && blobFileFor(other) === file)
      if (file && !shared) fs.rmSync(file, { force: true })
    } catch (error) {
      safeConsole('warn', '[kuma] 资源档案淘汰实物失败', error)
      continue
    }
    // 降级成「见过但没留下实物」：空间不够只是留不住实物，
    // 不该把玩家「我见过这张图」的见证也一起没收。
    entries.delete(assetArchiveKey(entry.pathname, entry.sha1))
    const placeholderKey = assetArchiveKey(entry.pathname, '')
    const existing = entries.get(placeholderKey)
    entries.set(placeholderKey, {
      ...entry,
      sha1: '',
      bytes: 0,
      firstSeen: Math.min(entry.firstSeen, existing?.firstSeen ?? entry.firstSeen),
      lastSeen: Math.max(entry.lastSeen, existing?.lastSeen ?? 0),
      seen: Math.max(entry.seen, existing?.seen ?? 0),
    })
  }
  if (evicted.length) scheduleSave()
}

/**
 * 记下「游戏刚取了这张图」。**只记事实，不碰网络**。
 *
 * 这是三态里的 `seen` 那一档：即使后面拿不到字节，格子也该半亮——
 * 玩家确实见过，那是真的。
 *
 * @returns 还该不该向页面要这一张的字节
 */
export const rememberAssetSeen = (input: {
  pathname: string
  version?: string
  ts?: number
}): boolean => {
  load()
  const seed = sanitizeEntry({
    pathname: input.pathname,
    version: input.version,
    sha1: '',
    bytes: 0,
    firstSeen: input.ts ?? Date.now(),
    lastSeen: input.ts ?? Date.now(),
    seen: 1,
  })
  if (!seed) return false
  const all = [...entries.values()]
  // 「已经留住了」的判据要连**版本**一起看（判据在 shared，护栏能真跑）：
  // 官方换季会在同一个地址上换图并把 `?version=` 推上去，只看路径的话，
  // 攒着去年那一份的槽位会被当成「已经有了」，当季这一份就再也不去取。
  const withBlob = all.filter(
    (entry) => entry.pathname === seed.pathname && entry.bytes > 0 && entry.version === seed.version,
  )
  const targets = withBlob.length ? withBlob : [entries.get(assetArchiveKey(seed.pathname, ''))]
  let touched = false
  for (const target of targets) {
    if (!target) continue
    target.lastSeen = Math.max(target.lastSeen, seed.lastSeen)
    target.seen += 1
    if (!target.version && seed.version) target.version = seed.version
    touched = true
  }
  if (!touched) {
    if (entries.size >= MAX_ENTRIES) return false
    entries.set(assetArchiveKey(seed.pathname, ''), seed)
  }
  scheduleSave()
  return !assetArchiveHasBlobFor(all, seed.pathname, seed.version)
}

/**
 * 收下页面从 Chromium 缓存里读出来的字节。
 *
 * @returns 新留住的那一条（调用方拿它去通知界面点亮）；没有新增就是 null
 */
export const keepAssetBlob = (input: {
  pathname: string
  bytes: Uint8Array
  version?: string
  ts?: number
}): AssetArchiveEntry | null => {
  load()
  const data = input.bytes
  if (!(data instanceof Uint8Array) || !data.byteLength) return null
  if (data.byteLength > ASSET_ARCHIVE_MAX_ENTRY_BYTES) return null
  // PNG 魔数：页面递过来的字节同样不裸信。这个桥对游戏页上任何脚本都可达，
  // 而档案是要摆到界面上看的——不是图片的东西不该进来。
  if (input.pathname.endsWith('.json')) {
    try { JSON.parse(Buffer.from(data).toString('utf8')) } catch { return null }
  } else if (![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => data[i] === byte)) return null
  const sha1 = createHash('sha1').update(data).digest('hex').slice(0, 16)
  const seed = sanitizeEntry({
    pathname: input.pathname,
    version: input.version,
    sha1,
    bytes: data.byteLength,
    firstSeen: input.ts ?? Date.now(),
    lastSeen: input.ts ?? Date.now(),
    seen: 1,
  })
  if (!seed) return null
  const key = assetArchiveKey(seed.pathname, sha1)
  const known = entries.get(key)
  if (known?.bytes) {
    known.lastSeen = Math.max(known.lastSeen, seed.lastSeen)
    // 同样的字节换了个版本号下发（官方推了版本但图没变）：把版本跟到最新，
    // 否则 rememberAssetSeen 会永远认为「这个版本还没存下」而一直想再要一次。
    if (seed.version && known.version !== seed.version) known.version = seed.version
    entries.delete(assetArchiveKey(seed.pathname, ''))
    scheduleSave()
    return null
  }
  if (!known && entries.size >= MAX_ENTRIES && !entries.has(assetArchiveKey(seed.pathname, ''))) return null
  const file = blobFileFor(seed)
  if (!file) return null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 先写临时名再改名：半截文件被当成实物点亮，比没有实物更糟
    const temp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(temp, data)
    fs.renameSync(temp, file)
  } catch (error) {
    safeConsole('warn', '[kuma] 资源档案落盘失败', error)
    return null
  }
  // 同一路径的「只见过」占位让位给实物条目（沿用它更早的首次见到时间与次数）
  const placeholder = entries.get(assetArchiveKey(seed.pathname, ''))
  if (placeholder) {
    seed.firstSeen = Math.min(seed.firstSeen, placeholder.firstSeen)
    seed.seen = Math.max(seed.seen, placeholder.seen)
    entries.delete(assetArchiveKey(seed.pathname, ''))
  }
  entries.set(key, seed)
  scheduleSave()
  evictIfNeeded()
  return entries.has(key) ? seed : null
}

/** 渲染层启动时取一次的全表（之后靠广播增量更新）。 */
export const assetArchiveEntries = (): AssetArchiveEntry[] => {
  load()
  return [...entries.values()]
}

export const assetArchiveStats = (): AssetArchiveUsage => {
  load()
  return assetArchiveUsage([...entries.values()], limitBytes())
}

/**
 * 玩家在钥里主动清空档案。**只有这一个入口能删**——
 * 缓存急救、启动清理、任何自动流程都碰不到这个目录。
 */
export const clearAssetArchive = (): boolean => {
  load()
  try {
    fs.rmSync(BLOB_DIR, { recursive: true, force: true })
  } catch (error) {
    safeConsole('warn', '[kuma] 资源档案清空失败', error)
    return false
  }
  entries = new Map()
  dirty = true
  flush()
  return true
}
