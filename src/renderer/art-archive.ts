// 立绘收集点亮的**判据**（渲染层这一半）。语音侧 renderer/voice-archive.ts 的同族。
//
// 判据只认持久档案层，**不认 Chromium 的磁盘缓存**：浏览器缓存会驱逐，
// 超限时还是整盘丢弃（共享记忆 electron-disk-cache-size），
// 拿它点亮等于让玩家的收集进度随时被浏览器抹掉一片。
//
// 三态的意思见 shared/art-archive-plan：
//   没见过（灰点）/ 见过但没留下实物（半亮）/ 有实物（可以看）。
// 「见过但没留下实物」是**如实呈现**，不是失败——早年见过、当时还没有档案层的
// 那些就该长这样；缓存里被驱逐掉的也该长这样。这一档不写抱怨文案。
import {
  artArchiveBlobPath,
  artArchiveState,
  type ArtArchiveEntry,
  type ArtArchiveState,
} from '../shared/art-archive-plan'

const path = require('path')
const { pathToFileURL } = require('url')
const { ipcRenderer } = require('electron')
const remote = require('@electron/remote')

// 档案根目录只在模块初始化时读一次。放进逐格的点亮判断里就是同步 IPC——
// 一屏几十格，那会把界面钉住（同一个坑见 assets/preload/resource-hack.js）。
const ARCHIVE_DIR: string = path.join(remote.getGlobal('APPDATA_PATH'), 'art-archive')

/** `mstId/type` → 条目。一个槽位可以有多份实物（季节版与常服）。 */
let bySlot = new Map<string, ArtArchiveEntry[]>()
/** mstId → 该形态留下过实物的图种数（逐舰进度用，免得每次都全表扫） */
let keptTypesOf = new Map<number, Set<string>>()
let loading: Promise<void> | null = null
let ready = false

const slotKey = (mstId: number, type: string) => `${mstId}/${type}`

const index = (entries: ArtArchiveEntry[]) => {
  const map = new Map<string, ArtArchiveEntry[]>()
  const kept = new Map<number, Set<string>>()
  for (const entry of entries) {
    const key = slotKey(entry.mstId, entry.type)
    const list = map.get(key) ?? []
    list.push(entry)
    map.set(key, list)
    if (entry.bytes > 0) {
      const set = kept.get(entry.mstId) ?? new Set<string>()
      set.add(entry.type)
      kept.set(entry.mstId, set)
    }
  }
  bySlot = map
  keptTypesOf = kept
  ready = true
}

export const loadArtArchive = (): Promise<void> => {
  loading ??= (ipcRenderer.invoke('mg:art-archive-entries') as Promise<ArtArchiveEntry[]>)
    .then((entries) => index(Array.isArray(entries) ? entries : []))
    .catch((error: unknown) => {
      loading = null
      console.warn('[kanso] 立绘档案索引读取失败', error)
    })
  return loading
}

/**
 * 主进程刚留住一张实物：整条并进本地索引。
 *
 * @returns 这一条是**新并进来**的吗。调用方据此决定要不要让界面跟上——
 *   已经有的同一份（重复广播）返回 false，别拿它去触发重渲。
 *
 * ---- 为什么这里要主动说一声 ----
 * 「这里不主动重渲」那条老政策成文时，立绘只有一条进货渠道：**游戏页面**自己
 * 请求资源时锚挂钩。那会儿玩家看的是游戏画面而不是图鉴，为一张图触发一次被动
 * 全量重绘性价比是负的，所以「切回图鉴那一下自然会重画」成立。
 *
 * 2026-08-22 加了「显示即入档」之后这个前提就没了：**入档恰恰发生在玩家正盯着
 * 那一页的时候**。于是出现用户报的那一幕——屋代的「立绘·中破」整张图渲染在页面上，
 * 它上面的格子却灰着，而档案里其实早就有了（六格同一秒全部落盘，界面卡在四格）。
 * 「画在屏幕上却没点亮」正是这条政策要消灭的东西，却被这行注释挡在门外。
 *
 * 所以现在：**并进索引之后如实说一声**（返回值 + `kanso:archive-lit` 事件），
 * 由消费端判断「这条是不是玩家正在看的那一页」再决定重渲。
 * 两道性能闸门一个没松——重渲仍旧走 ji 自己的 `scheduleRender`
 *（面板不 active 不画、手指按着的时候推迟，见 memory/kanso-perf-architecture）。
 */
export const noteArtArchived = (entry: ArtArchiveEntry): boolean => {
  if (!ready || !entry?.pathname || !entry.sha1 || !(entry.bytes > 0)) return false
  const key = slotKey(entry.mstId, entry.type)
  const list = bySlot.get(key) ?? []
  if (list.some((known) => known.sha1 === entry.sha1)) return false
  list.push(entry)
  bySlot.set(key, list)
  const set = keptTypesOf.get(entry.mstId) ?? new Set<string>()
  set.add(entry.type)
  keptTypesOf.set(entry.mstId, set)
  return true
}

/** 这一槽位（形态 × 图种）的收集状态。 */
export const artLitState = (mstId: number, type: string): ArtArchiveState =>
  artArchiveState(bySlot.get(slotKey(mstId, type)) ?? [])

/** 该槽位留下的全部实物，最近见到的排前面。 */
export const archivedArtEntries = (mstId: number, type: string): ArtArchiveEntry[] =>
  (bySlot.get(slotKey(mstId, type)) ?? [])
    .filter((entry) => entry.bytes > 0 && entry.sha1)
    .sort((left, right) => right.lastSeen - left.lastSeen)

/**
 * 这个形态在档案里留下的**全部实物**（不限图种），最近见到的排前面。
 *
 * 图鉴画廊的尾巴拿它对账：官方现行那几张之后要续排的，就是这里面**不是现行那份**
 * 的那些。判据在 shared/art-archive-plan 的 `legacyArchivedArt`（护栏能真跑一遍）。
 * 它扫的是单艘舰那几条（走 keptTypesOf/bySlot 两张索引），不是全表。
 */
export const archivedArtEntriesOfShip = (mstId: number): ArtArchiveEntry[] => {
  const out: ArtArchiveEntry[] = []
  for (const type of keptTypesOf.get(mstId) ?? []) {
    for (const entry of bySlot.get(slotKey(mstId, type)) ?? []) {
      if (entry.bytes > 0 && entry.sha1) out.push(entry)
    }
  }
  return out.sort((left, right) => right.lastSeen - left.lastSeen)
}

/** 档案里那一份的本地地址。**只给档案里的实物**，不回退到游戏 CDN。 */
export const archivedArtUrl = (entry: ArtArchiveEntry): string | null => {
  const relative = artArchiveBlobPath(entry.pathname, entry.sha1)
  if (!relative) return null
  return pathToFileURL(path.join(ARCHIVE_DIR, ...relative.split('/'))).href
}

/**
 * 这个形态在档案里留下了几个图种的实物。
 *
 * ⚠️ 当**分子**用时必须把 `types` 传进来（就是那一格摆出来的槽位表）。
 * 档案收的图种比收集格多（`ART_ARCHIVE_TYPES` 有 8 种，舰娘侧的收集格只摆 6 种，
 * 深海侧另有一张表），不限定就会出现「本形态 8/6 图种」这种分子大于分母的数——
 * 2026-08-23「显示即入档」上线后当场撞见过一次（那次还漏了图种闸门，显示成 13/6）。
 * 不传 `types` 的用法只剩「这个形态有没有留下过东西」那一种判断。
 */
export const artKeptTypeCount = (mstId: number, types?: ReadonlySet<string>): number => {
  const kept = keptTypesOf.get(mstId)
  if (!kept) return 0
  if (!types) return kept.size
  let count = 0
  for (const type of kept) if (types.has(type)) count++
  return count
}

// 这里曾经有 `artKeptFormCount`（跨舰收集度的分子：全站留下实物的形态数）。
// 2026-08-23 随「全部 x/889 形态」那行进度一起退役——用户拍板拔掉打卡腔：
// 档案如实记录留存了什么，不给「你集齐了百分之几」的框架。
// 逐形态的留存数仍由 `artKeptTypeCount` 供，那是库存陈述不是完成度。

/** 索引到位没有。没到位时展示层该说「统计中」，而不是显示成一格都没有。 */
export const artArchiveReady = (): boolean => ready
