// 「见过即存」的持久立绘档案。语音侧（voice-archive.ts）的同族实现。
//
// 为什么非要转存、而不是直接吃 Chromium 的磁盘缓存：
//   ① **有些图的可获取窗口是有限的**。季节立绘过季就换回去；活动限定的深海舰
//      活动一撤，那张图玩家再也见不到（「绝版」不是修辞，是事实）；
//   ② Chromium 的磁盘缓存会驱逐，而且超限时是**整盘丢弃**
//      （见共享记忆 electron-disk-cache-size）。
// 两件事叠起来是：不转存的话，「见过」也可能先被缓存驱逐、再因绝版而永久取不回。
//
// ---- 零网络请求，而且是**结构上**做不到发请求 ----
// 字节不是主进程去取的，是**游戏页面自己**用
// `fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })` 从
// Chromium 已有的缓存里读出来再交回来的（见 assets/preload/art-archive.js）。
// 与语音侧同一条路、同样的护栏钉法：`only-if-cached` 在缓存没命中时**抛错而不是
// 走网络**，所以最坏结果只是「这一张没存下」，永远不会变成对游戏 CDN 的主动拉取。
// **绝不从任何 wiki 取图，也绝不在玩家之间传图**——档案里的每一张，都只能是
// 这台机器上的游戏客户端自己合法收到过的那一份。
//
// ---- 这是档案，不是缓存 ----
// 目录**独立于**缓存目录，并且不在钥的「清理缓存并重启」删除清单里
// （那个清单是白名单式的，见 main/yu.ts 的 CACHE_DIRS 与 PRESERVED_ENTRIES）。

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import { safeConsole } from './crash-log'
import config from './config'
import {
  ART_ARCHIVE_MAX_ENTRY_BYTES,
  ART_ARCHIVE_PATH,
  shouldArchiveArtType,
  artArchiveBlobPath,
  artArchiveHasBlobFor,
  artArchiveKey,
  archiveLimitBytes,
  artArchiveUsage,
  planArtArchiveEviction,
  sanitizeArtArchiveEntry as sanitizeEntry,
  type ArtArchiveEntry,
  type ArtArchiveUsage,
} from '../shared/art-archive-plan'

/**
 * 档案根目录。
 *
 * ---- 为什么与 voice-archive 分开两个目录，而不是合成一个 ----
 * ① **玩家要能分别处置**：立绘档案会长到 GB 级，语音只有几百 MB；
 *    「立绘占太多想清掉、语音舍不得」是完全合理的诉求，合成一个目录就只能一起清；
 * ② **两边的淘汰压力完全不同**，混在一起会让语音被立绘挤掉（或反过来）；
 * ③ 索引的形状不同（这边是 图种/版本，那边是 槽位），合表反而要加判别字段。
 * 两者共享的是**做法**而不是存储：同一条零网络取字节的路、同一套三态、
 * 同一条「只淘汰实物不删见证」的规矩。
 */
const ART_ARCHIVE_DIR = path.join(APPDATA_PATH, 'art-archive')
const INDEX_FILE = path.join(ART_ARCHIVE_DIR, 'index.json')
const BLOB_DIR = path.join(ART_ARCHIVE_DIR, 'art')

const SCHEMA_VERSION = 1
/** 条目总数上限。约 1200 形态 × 十几个图种 × 若干季节版，三万条足够到下个十年。 */
const MAX_ENTRIES = 30_000

let entries = new Map<string, ArtArchiveEntry>()
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
      if (entry) entries.set(artArchiveKey(entry.pathname, entry.sha1), entry)
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 读不出来就当空档案继续；绝不让它拦住启动，也绝不顺手把 blob 删掉——
      // 索引坏了还能重建，实物没了就真没了。
      safeConsole('warn', '[kanso] 立绘档案索引读取失败，按空档案继续', error)
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
    fs.mkdirSync(ART_ARCHIVE_DIR, { recursive: true })
    atomicWriteJsonSync(INDEX_FILE, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [...entries.values()],
    })
  } catch (error) {
    safeConsole('warn', '[kanso] 立绘档案索引落盘失败', error)
  }
}

const scheduleSave = () => {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(flush, 3_000)
  saveTimer.unref?.()
}

/** 退出时调用，别把最后几张见到的丢掉。 */
export const flushArtArchive = () => flush()

/** 实物文件的绝对路径。相对位置的推导与渲染层共用一份（shared/art-archive-plan）。 */
const blobFileFor = (entry: ArtArchiveEntry): string | null => {
  const relative = artArchiveBlobPath(entry.pathname, entry.sha1)
  return relative ? path.join(ART_ARCHIVE_DIR, ...relative.split('/')) : null
}

/**
 * 玩家设的上限（MB）。**没设 = 不限量 = 一条都不淘汰**（2026-08-23 起的默认，
 * 与语音档案同一条口径与同一个理由，见 main/voice-archive 的同名函数）。
 */
const limitBytes = (): number | null => {
  const mb = Number(config.get('kanso.archive.artMaxMB', 0))
  return archiveLimitBytes(Number.isFinite(mb) ? mb * 1024 * 1024 : 0)
}

const evictIfNeeded = () => {
  const evicted = planArtArchiveEviction([...entries.values()], limitBytes())
  for (const entry of evicted) {
    const file = blobFileFor(entry)
    try {
      if (file) fs.rmSync(file, { force: true })
    } catch (error) {
      safeConsole('warn', '[kanso] 立绘档案淘汰实物失败', error)
      continue
    }
    // 降级成「见过但没留下实物」：空间不够只是留不住实物，
    // 不该把玩家「我见过这张图」的见证也一起没收。
    entries.delete(artArchiveKey(entry.pathname, entry.sha1))
    const placeholderKey = artArchiveKey(entry.pathname, '')
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
export const rememberArtSeen = (input: {
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
  const targets = withBlob.length ? withBlob : [entries.get(artArchiveKey(seed.pathname, ''))]
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
    entries.set(artArchiveKey(seed.pathname, ''), seed)
  }
  scheduleSave()
  return !artArchiveHasBlobFor(all, seed.pathname, seed.version)
}

/**
 * 收下页面从 Chromium 缓存里读出来的字节。
 *
 * @returns 新留住的那一条（调用方拿它去通知界面点亮）；没有新增就是 null
 */
export const keepArtBlob = (input: {
  pathname: string
  bytes: Uint8Array
  version?: string
  ts?: number
}): ArtArchiveEntry | null => {
  load()
  const data = input.bytes
  if (!(data instanceof Uint8Array) || !data.byteLength) return null
  if (data.byteLength > ART_ARCHIVE_MAX_ENTRY_BYTES) return null
  // PNG 魔数：页面递过来的字节同样不裸信。这个桥对游戏页上任何脚本都可达，
  // 而档案是要摆到界面上看的——不是图片的东西不该进来。
  if (!(data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)) return null
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
  const key = artArchiveKey(seed.pathname, sha1)
  const known = entries.get(key)
  if (known?.bytes) {
    known.lastSeen = Math.max(known.lastSeen, seed.lastSeen)
    // 同样的字节换了个版本号下发（官方推了版本但图没变）：把版本跟到最新，
    // 否则 rememberArtSeen 会永远认为「这个版本还没存下」而一直想再要一次。
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
    safeConsole('warn', '[kanso] 立绘档案落盘失败', error)
    return null
  }
  // 同一路径的「只见过」占位让位给实物条目（沿用它更早的首次见到时间与次数）
  const placeholder = entries.get(artArchiveKey(seed.pathname, ''))
  if (placeholder) {
    seed.firstSeen = Math.min(seed.firstSeen, placeholder.firstSeen)
    seed.seen = Math.max(seed.seen, placeholder.seen)
    entries.delete(artArchiveKey(seed.pathname, ''))
  }
  entries.set(key, seed)
  scheduleSave()
  evictIfNeeded()
  return entries.has(key) ? seed : null
}

/**
 * 首次运行的「吸收」：把 Chromium 缓存里**已经有**的立绘搬进档案。
 *
 * 为什么需要这一步：档案层是 2026-08-22 才有的，而玩家的浏览器缓存里往往已经躺着
 * 几百张游戏自己下过的图（本机实测 3672 条舰船美术 URL）。不吸收的话，
 * 这些图会在某次缓存驱逐里静静消失，而玩家「明明看过」却一格都没亮。
 *
 * **它同样是零网络的**：候选只来自 `ship-art-paths.json`（游戏**自己请求过**的
 * 真实路径，见 ship-art-store）+ 主数据里的版本号，取字节仍走 only-if-cached
 * 那条路——缓存里没有就是抛错，不会退化成一次真请求。所以最坏结果是
 * 「这一张没吸收到」，永远不会变成对游戏 CDN 的批量拉取。
 *
 * @param learned  `ship-art-paths.json` 的全表（mstId/type → pathname）
 * @param versionOf 形态 → `api_version[0]`；给不出就返回 null（那条按无版本处理）
 * @returns 待问的目标，形如 `/kcs2/resources/ship/full/0961_6849_x.png?version=109`
 */
export const artArchivePrimeTargets = (
  learned: Record<string, string>,
  versionOf: (mstId: number) => string | null,
): string[] => {
  load()
  const all = [...entries.values()]
  const out: string[] = []
  for (const [key, pathname] of Object.entries(learned ?? {})) {
    const slash = key.indexOf('/')
    if (slash <= 0) continue
    const mstId = Number(key.slice(0, slash))
    const type = key.slice(slash + 1)
    if (!(mstId > 0) || !shouldArchiveArtType(mstId, type)) continue
    if (!ART_ARCHIVE_PATH.test(pathname)) continue
    const version = versionOf(mstId) ?? ''
    // 已经留住这个版本的就不必再问——吸收是补历史，不是重来一遍
    if (artArchiveHasBlobFor(all, pathname, version)) continue
    out.push(version ? `${pathname}?version=${encodeURIComponent(version)}` : pathname)
  }
  return out
}

/** 渲染层启动时取一次的全表（之后靠广播增量更新）。 */
export const artArchiveEntries = (): ArtArchiveEntry[] => {
  load()
  return [...entries.values()]
}

export const artArchiveStats = (): ArtArchiveUsage => {
  load()
  return artArchiveUsage([...entries.values()], limitBytes())
}

/**
 * 玩家在钥里主动清空档案。**只有这一个入口能删**——
 * 缓存急救、启动清理、任何自动流程都碰不到这个目录。
 */
export const clearArtArchive = (): boolean => {
  load()
  try {
    fs.rmSync(BLOB_DIR, { recursive: true, force: true })
  } catch (error) {
    safeConsole('warn', '[kanso] 立绘档案清空失败', error)
    return false
  }
  entries = new Map()
  dirty = true
  flush()
  return true
}
