// 「听过即存」的持久语音档案。
//
// 为什么非要转存、而不是直接吃 Chromium 的磁盘缓存：
//   ① 季节资产的可获取窗口**就是当季**。过季后游戏不再请求那一份，
//      官方 CDN 什么时候把它换掉/撤掉不由我们决定；
//   ② Chromium 的磁盘缓存会驱逐，而且超限时是**整盘丢弃**
//      （见共享记忆 electron-disk-cache-size）。
// 两件事叠起来是：不转存的话，「听过」也可能先被缓存驱逐、再因过季而永久取不回。
// 转存就是「档案」与「碰运气缓存」的分界线——档案要能在缓存被清空之后活下来。
//
// ---- 零网络请求，而且是**结构上**做不到发请求 ----
// 字节不是主进程去取的，是**游戏页面自己**用
// `fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })` 从
// Chromium 已有的缓存里读出来再交回来的（见 assets/preload/voice-archive.js）。
// `only-if-cached` 在缓存没命中时**抛错而不是走网络**——2026-08-22 本机实测
// （Electron 43，example.com 冷读抛 `Failed to fetch`、热读 `fromCache: true`）。
// 所以这条路最坏的结果是「这一条没存下」，永远不会变成一次对游戏 CDN 的请求。
//（同一测里另外两条路已证伪：主进程 `net.fetch` 带 `cache: 'only-if-cached'`
//  一律 `net::ERR_INVALID_ARGUMENT`——net 模块的请求没有 origin，
//  而 `only-if-cached` 只能配 `same-origin`。别再往那边试。）
//
// ---- 这是档案，不是缓存 ----
// 目录**独立于**缓存目录，并且不在钥的「清理缓存并重启」删除清单里
// （那个清单是白名单式的，见 main/yu.ts 的 CACHE_DIRS 与 PRESERVED_ENTRIES）。
// 玩家卡加载时清缓存是正常操作，不能顺手把攒了半年的收集进度一起清掉。

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import { safeConsole } from './crash-log'
import config from './config'
import {
  VOICE_ARCHIVE_MAX_ENTRY_BYTES,
  archiveLimitBytes,
  planVoiceArchiveEviction,
  sanitizeVoiceArchiveEntry as sanitizeEntry,
  voiceArchiveBlobPath,
  voiceArchiveHasBlobFor,
  voiceArchiveKey,
  voiceArchiveUsage,
  type VoiceArchiveEntry,
  type VoiceArchiveUsage,
} from '../shared/voice-archive-plan'

/** 档案根目录。名字里带 archive 是给人看的：它不是 cache。 */
const VOICE_ARCHIVE_DIR = path.join(APPDATA_PATH, 'voice-archive')
const INDEX_FILE = path.join(VOICE_ARCHIVE_DIR, 'index.json')
const BLOB_DIR = path.join(VOICE_ARCHIVE_DIR, 'sound')

const SCHEMA_VERSION = 1
/** 条目总数上限。一艘舰 53 槽 × 几百形态 × 若干季节版，两万条足够到下个十年。 */
const MAX_ENTRIES = 20_000

let entries = new Map<string, VoiceArchiveEntry>()
let loaded = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

// 条目收敛与「这个版本存过没有」的判据都住在 shared/voice-archive-plan：
// 那两件事写反了不会报错，只会某天默默让玩家的收集进度对不上号，
// 护栏必须能脱开 Electron 真调用它们。

const load = () => {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    const list = Array.isArray(raw?.entries) ? raw.entries : []
    for (const item of list.slice(-MAX_ENTRIES)) {
      const entry = sanitizeEntry(item)
      if (entry) entries.set(voiceArchiveKey(entry.pathname, entry.sha1), entry)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 读不出来就当空档案继续；绝不让它拦住启动，也绝不顺手把 blob 删掉——
      // 索引坏了还能重建，实物没了就真没了。
      safeConsole('warn', '[kanso] 语音档案索引读取失败，按空档案继续', error)
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
    fs.mkdirSync(VOICE_ARCHIVE_DIR, { recursive: true })
    atomicWriteJsonSync(INDEX_FILE, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [...entries.values()],
    })
  } catch (error) {
    safeConsole('warn', '[kanso] 语音档案索引落盘失败', error)
  }
}

const scheduleSave = () => {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(flush, 3_000)
  saveTimer.unref?.()
}

/** 退出时调用，别把最后几条听到的丢掉。 */
export const flushVoiceArchive = () => flush()

/** 实物文件的绝对路径。相对位置的推导与渲染层共用一份（shared/voice-archive-plan）。 */
const blobFileFor = (entry: VoiceArchiveEntry): string | null => {
  const relative = voiceArchiveBlobPath(entry.pathname, entry.sha1)
  return relative ? path.join(VOICE_ARCHIVE_DIR, ...relative.split('/')) : null
}

/**
 * 玩家设的上限（MB）。**没设 = 不限量 = 一条都不淘汰**（2026-08-23 起的默认）。
 *
 * 「留不留、是不是太占位置」的决断归玩家自己——他原话大意：「我有俩 2T 的盘，
 * 这点存储不算什么」。所以默认不设上限；设了才启用淘汰，而淘汰**永远绕开
 * 「来源已不可再得」的条目**（判据在 shared/voice-archive-plan）。
 */
const limitBytes = (): number | null => {
  const mb = Number(config.get('kanso.archive.voiceMaxMB', 0))
  return archiveLimitBytes(Number.isFinite(mb) ? mb * 1024 * 1024 : 0)
}

const evictIfNeeded = () => {
  const evicted = planVoiceArchiveEviction([...entries.values()], limitBytes())
  for (const entry of evicted) {
    const file = blobFileFor(entry)
    try {
      if (file) fs.rmSync(file, { force: true })
    } catch (error) {
      safeConsole('warn', '[kanso] 语音档案淘汰实物失败', error)
      continue
    }
    // 降级成「听过但没留下实物」：空间不够只是留不住实物，
    // 不该把玩家「我听过这一句」的见证也一起没收。
    entries.delete(voiceArchiveKey(entry.pathname, entry.sha1))
    const placeholderKey = voiceArchiveKey(entry.pathname, '')
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
 * 记下「游戏刚播了这一条」。**只记事实，不碰网络**。
 *
 * 这是三态里的 `heard` 那一档：即使后面拿不到字节，格子也该半亮——
 * 玩家确实听过，那是真的。
 */
export const rememberVoiceHeard = (input: {
  pathname: string
  version?: string
  mstId?: number
  voiceId?: number
  ts?: number
}): boolean => {
  load()
  const seed = sanitizeEntry({
    pathname: input.pathname,
    version: input.version,
    mstId: input.mstId,
    voiceId: input.voiceId,
    sha1: '',
    bytes: 0,
    firstHeard: input.ts ?? Date.now(),
    lastHeard: input.ts ?? Date.now(),
    heard: 1,
  })
  if (!seed) return false
  // 「已经留住了」的判据要连**版本**一起看（判据在 shared，护栏能真跑）：
  // 官方换季会在同一个地址上换文件并把 `?version=` 推上去，只看路径的话，
  // 攒着去年那一份的槽位会被当成「已经有了」，当季这一份就再也不去取。
  const all = [...entries.values()]
  const withBlob = all.filter(
    (entry) =>
      entry.pathname === seed.pathname && entry.bytes > 0 && entry.version === seed.version,
  )
  const targets = withBlob.length ? withBlob : [entries.get(voiceArchiveKey(seed.pathname, ''))]
  let touched = false
  for (const target of targets) {
    if (!target) continue
    target.lastHeard = Math.max(target.lastHeard, seed.lastHeard)
    target.heard += 1
    if (!target.mstId && seed.mstId) target.mstId = seed.mstId
    if (!target.voiceId && seed.voiceId) target.voiceId = seed.voiceId
    // 老档案（版本参数上线之前存的）在这里补记版本，不必迁移
    if (!target.version && seed.version) target.version = seed.version
    touched = true
  }
  if (!touched) {
    if (entries.size >= MAX_ENTRIES) return false
    entries.set(voiceArchiveKey(seed.pathname, ''), seed)
  }
  scheduleSave()
  // 这个版本还没有实物时才值得再问页面要一次字节
  return !voiceArchiveHasBlobFor(all, seed.pathname, seed.version)
}

/**
 * 收下页面从 Chromium 缓存里读出来的字节。
 *
 * @returns 新留住的那一条（调用方拿它去通知界面点亮）；没有新增就是 null
 */
export const keepVoiceBlob = (input: {
  pathname: string
  bytes: Uint8Array
  version?: string
  mstId?: number
  voiceId?: number
  ts?: number
}): VoiceArchiveEntry | null => {
  load()
  const data = input.bytes
  if (!(data instanceof Uint8Array) || !data.byteLength) return null
  if (data.byteLength > VOICE_ARCHIVE_MAX_ENTRY_BYTES) return null
  const sha1 = createHash('sha1').update(data).digest('hex').slice(0, 16)
  const seed = sanitizeEntry({
    pathname: input.pathname,
    version: input.version,
    mstId: input.mstId,
    voiceId: input.voiceId,
    sha1,
    bytes: data.byteLength,
    firstHeard: input.ts ?? Date.now(),
    lastHeard: input.ts ?? Date.now(),
    heard: 1,
  })
  if (!seed) return null
  const key = voiceArchiveKey(seed.pathname, sha1)
  const known = entries.get(key)
  if (known?.bytes) {
    known.lastHeard = Math.max(known.lastHeard, seed.lastHeard)
    // 同样的字节换了个版本号下发（官方推了版本但内容没变）：把版本跟到最新，
    // 否则 rememberVoiceHeard 会永远认为「这个版本还没存下」而一直想再要一次。
    if (seed.version && known.version !== seed.version) known.version = seed.version
    scheduleSave()
    return null
  }
  const file = blobFileFor(seed)
  if (!file) return null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 先写临时名再改名：半截文件被当成实物点亮，比没有实物更糟
    const temp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(temp, data)
    fs.renameSync(temp, file)
  } catch (error) {
    safeConsole('warn', '[kanso] 语音档案落盘失败', error)
    return null
  }
  // 同一路径的「只听过」占位让位给实物条目（沿用它更早的首次听到时间与次数）
  const placeholder = entries.get(voiceArchiveKey(seed.pathname, ''))
  if (placeholder) {
    seed.firstHeard = Math.min(seed.firstHeard, placeholder.firstHeard)
    seed.heard = Math.max(seed.heard, placeholder.heard)
    entries.delete(voiceArchiveKey(seed.pathname, ''))
  }
  entries.set(key, seed)
  scheduleSave()
  evictIfNeeded()
  return entries.has(key) ? seed : null
}

/** 渲染层启动时取一次的全表（之后靠广播增量更新）。 */
export const voiceArchiveEntries = (): VoiceArchiveEntry[] => {
  load()
  return [...entries.values()]
}

export const voiceArchiveStats = (): VoiceArchiveUsage => {
  load()
  return voiceArchiveUsage([...entries.values()], limitBytes())
}

/**
 * 玩家在钥里主动清空档案。**只有这一个入口能删**——
 * 缓存急救、启动清理、任何自动流程都碰不到这个目录。
 */
export const clearVoiceArchive = (): boolean => {
  load()
  try {
    fs.rmSync(BLOB_DIR, { recursive: true, force: true })
  } catch (error) {
    safeConsole('warn', '[kanso] 语音档案清空失败', error)
    return false
  }
  entries = new Map()
  dirty = true
  flush()
  return true
}
