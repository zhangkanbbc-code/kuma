// 「响过即存」的持久 BGM 档案。语音/立绘档案的第三个同族成员，
// 目录、索引、指纹分份、淘汰豁免的做法都与它们一致（见 main/voice-archive 的文件头）。
//
// ---- 为什么 BGM 也要档案，而不是靠 Chromium 缓存 ----
// 与语音同样两条理由，而且第二条对 BGM 更狠：
//   ① Chromium 磁盘缓存会驱逐，超限时是**整盘丢弃**（共享记忆 electron-disk-cache-size）；
//   ② **活动曲随活动撤场**。活动一结束，那几个号在游戏里再也不会响，
//      官方什么时候把文件撤掉不由我们决定。本期 62 区的 275–281 就是这一批。
// 两件事叠起来：不转存的话，今天还能点响的活动曲，过两个月可能连缓存都没了。
//
// ---- 零网络请求，而且是**结构上**做不到发请求 ----
// 字节不是主进程去取的，是**游戏页面自己**用
// `fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })` 从
// Chromium 已有的缓存里读出来再交回来的（见 assets/preload/bgm-archive.js）。
// `only-if-cached` 在缓存没命中时抛错而不是走网络，所以这条路最坏的结果是
// 「这一首没存下」，永远不会变成一次对游戏 CDN 的请求。
//
// ---- 这是档案，不是缓存 ----
// 目录独立于缓存目录，并且不在钥的「清理缓存并重启」删除清单里
//（见 main/yu.ts 的 PRESERVED_ENTRIES）。玩家清缓存是正常操作，
// 不能顺手把攒下的曲子一起清掉。

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import { safeConsole } from './crash-log'
import config from './config'
import {
  BGM_ARCHIVE_MAX_ENTRY_BYTES,
  bgmArchiveBlobPath,
  bgmArchiveHasBlobFor,
  bgmArchiveKey,
  bgmArchiveLimitBytes,
  bgmArchiveUsage,
  planBgmArchiveEviction,
  sanitizeBgmArchiveEntry as sanitizeEntry,
  type BgmArchiveEntry,
  type BgmArchiveUsage,
} from '../shared/bgm-archive-plan'

/** 档案根目录。名字里带 archive 是给人看的：它不是 cache。 */
const BGM_ARCHIVE_DIR = path.join(APPDATA_PATH, 'bgm-archive')
const INDEX_FILE = path.join(BGM_ARCHIVE_DIR, 'index.json')
const BLOB_DIR = path.join(BGM_ARCHIVE_DIR, 'bgm')

const SCHEMA_VERSION = 1
/** 条目总数上限。两棵树各几百个号 × 若干换过的版本，五千条到下个十年都够。 */
const MAX_ENTRIES = 5_000

let entries = new Map<string, BgmArchiveEntry>()
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
      if (entry) entries.set(bgmArchiveKey(entry.pathname, entry.sha1), entry)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 读不出来就当空档案继续；绝不让它拦住启动，也绝不顺手把 blob 删掉——
      // 索引坏了还能重建，实物没了就真没了。
      safeConsole('warn', '[kanso] BGM 档案索引读取失败，按空档案继续', error)
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
    fs.mkdirSync(BGM_ARCHIVE_DIR, { recursive: true })
    atomicWriteJsonSync(INDEX_FILE, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [...entries.values()],
    })
  } catch (error) {
    safeConsole('warn', '[kanso] BGM 档案索引落盘失败', error)
  }
}

const scheduleSave = () => {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(flush, 3_000)
  saveTimer.unref?.()
}

/** 退出时调用，别把最后几首听到的丢掉。 */
export const flushBgmArchive = () => flush()

/** 实物文件的绝对路径。相对位置的推导与渲染层共用一份（shared/bgm-archive-plan）。 */
const blobFileFor = (entry: BgmArchiveEntry): string | null => {
  const relative = bgmArchiveBlobPath(entry.pathname, entry.sha1)
  return relative ? path.join(BGM_ARCHIVE_DIR, ...relative.split('/')) : null
}

/** 玩家设的上限（MB）。没设 = 不限量 = 一条都不淘汰，与语音/立绘同一条口径。 */
const limitBytes = (): number | null => {
  const mb = Number(config.get('kanso.archive.bgmMaxMB', 0))
  return bgmArchiveLimitBytes(Number.isFinite(mb) ? mb * 1024 * 1024 : 0)
}

const evictIfNeeded = () => {
  const evicted = planBgmArchiveEviction([...entries.values()], limitBytes())
  for (const entry of evicted) {
    const file = blobFileFor(entry)
    try {
      if (file) fs.rmSync(file, { force: true })
    } catch (error) {
      safeConsole('warn', '[kanso] BGM 档案淘汰实物失败', error)
      continue
    }
    // 降级成「响过但没留下实物」：空间不够只是留不住实物，
    // 不该把「这首在这台机器上响过」的见证也一起没收。
    entries.delete(bgmArchiveKey(entry.pathname, entry.sha1))
    const placeholderKey = bgmArchiveKey(entry.pathname, '')
    const existing = entries.get(placeholderKey)
    entries.set(placeholderKey, {
      ...entry,
      sha1: '',
      bytes: 0,
      firstHeard: Math.min(entry.firstHeard, existing?.firstHeard ?? entry.firstHeard),
      lastHeard: Math.max(entry.lastHeard, existing?.lastHeard ?? 0),
      heard: Math.max(entry.heard, existing?.heard ?? 0),
    })
  }
  if (evicted.length) scheduleSave()
}

/**
 * 记下「游戏刚放了这一首」。**只记事实，不碰网络**。
 *
 * @returns 还值不值得再向页面要一次字节（这个版本还没有实物时才值得）
 */
export const rememberBgmHeard = (input: {
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
    firstHeard: input.ts ?? Date.now(),
    lastHeard: input.ts ?? Date.now(),
    heard: 1,
  })
  if (!seed) return false
  const all = [...entries.values()]
  const withBlob = all.filter(
    (entry) =>
      entry.pathname === seed.pathname && entry.bytes > 0 && entry.version === seed.version,
  )
  const targets = withBlob.length ? withBlob : [entries.get(bgmArchiveKey(seed.pathname, ''))]
  let touched = false
  for (const target of targets) {
    if (!target) continue
    target.lastHeard = Math.max(target.lastHeard, seed.lastHeard)
    target.heard += 1
    // 老档案（版本参数上线之前存的）在这里补记版本，不必迁移
    if (!target.version && seed.version) target.version = seed.version
    touched = true
  }
  if (!touched) {
    if (entries.size >= MAX_ENTRIES) return false
    entries.set(bgmArchiveKey(seed.pathname, ''), seed)
  }
  scheduleSave()
  return !bgmArchiveHasBlobFor(all, seed.pathname, seed.version)
}

/**
 * 收下页面从 Chromium 缓存里读出来的字节。
 *
 * @returns 新留住的那一条（调用方拿它去通知界面点亮）；没有新增就是 null
 */
export const keepBgmBlob = (input: {
  pathname: string
  bytes: Uint8Array
  version?: string
  ts?: number
}): BgmArchiveEntry | null => {
  load()
  const data = input.bytes
  if (!(data instanceof Uint8Array) || !data.byteLength) return null
  if (data.byteLength > BGM_ARCHIVE_MAX_ENTRY_BYTES) return null
  const sha1 = createHash('sha1').update(data).digest('hex').slice(0, 16)
  const seed = sanitizeEntry({
    pathname: input.pathname,
    version: input.version,
    sha1,
    bytes: data.byteLength,
    firstHeard: input.ts ?? Date.now(),
    lastHeard: input.ts ?? Date.now(),
    heard: 1,
  })
  if (!seed) return null
  const key = bgmArchiveKey(seed.pathname, sha1)
  const known = entries.get(key)
  if (known?.bytes) {
    known.lastHeard = Math.max(known.lastHeard, seed.lastHeard)
    // 同样的字节换了个版本号下发：把版本跟到最新，否则 rememberBgmHeard 会
    // 永远认为「这个版本还没存下」而一直想再要一次。
    if (seed.version && known.version !== seed.version) known.version = seed.version
    scheduleSave()
    return null
  }
  const file = blobFileFor(seed)
  if (!file) return null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 先写临时名再改名：半截文件被当成实物播出去，比没有实物更糟
    const temp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(temp, data)
    fs.renameSync(temp, file)
  } catch (error) {
    safeConsole('warn', '[kanso] BGM 档案落盘失败', error)
    return null
  }
  // 同一路径的「只响过」占位让位给实物条目（沿用它更早的首次听到时间与次数）
  const placeholder = entries.get(bgmArchiveKey(seed.pathname, ''))
  if (placeholder) {
    seed.firstHeard = Math.min(seed.firstHeard, placeholder.firstHeard)
    seed.heard = Math.max(seed.heard, placeholder.heard)
    entries.delete(bgmArchiveKey(seed.pathname, ''))
  }
  entries.set(key, seed)
  scheduleSave()
  evictIfNeeded()
  return entries.has(key) ? seed : null
}

/** 渲染层启动时取一次的全表（之后靠广播增量更新）。 */
export const bgmArchiveEntries = (): BgmArchiveEntry[] => {
  load()
  return [...entries.values()]
}

export const bgmArchiveStats = (): BgmArchiveUsage => {
  load()
  return bgmArchiveUsage([...entries.values()], limitBytes())
}

/**
 * 玩家在钥里主动清空档案。**只有这一个入口能删**——
 * 缓存急救、启动清理、任何自动流程都碰不到这个目录。
 */
export const clearBgmArchive = (): boolean => {
  load()
  try {
    fs.rmSync(BLOB_DIR, { recursive: true, force: true })
  } catch (error) {
    safeConsole('warn', '[kanso] BGM 档案清空失败', error)
    return false
  }
  entries = new Map()
  dirty = true
  flush()
  return true
}
