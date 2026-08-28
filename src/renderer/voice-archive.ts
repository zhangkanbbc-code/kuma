// 收集点亮的**判据**（渲染层这一半）。
//
// 判据只认持久档案层，**不认 Chromium 的磁盘缓存**：浏览器缓存会驱逐，
// 超限时还是整盘丢弃（共享记忆 electron-disk-cache-size），
// 拿它点亮等于让玩家的收集进度随时被浏览器抹掉一片。
//
// 三态的意思见 shared/voice-archive-plan：
//   未听过（灰）/ 听过但没留下实物（半亮）/ 有实物（全亮，可播放）。
// 「听过但没留下实物」是**如实呈现**，不是失败——早年听过、当时还没有档案层的
// 那些就该长这样；缓存里被驱逐掉的也该长这样。这一档不写抱怨文案。
//
// ---- 常规台词也走这条路了（2026-08-23 实装）----
// 图鉴常规台词卷的每一个播放钮，判据都是 modules/ji 的 `voicePlaybackFor`：
//   ① 这一格有耳测负例 → 不给键；② **档案里有实物 → 播实物**；③ 否则按地址现取。
// ② 排在 ③ 前面的理由就是这个文件存在的理由：档案里那一份是玩家自己在游戏里听到过的，
// 播它天然不会错句——既不受官方当季换文件影响，也不受「场合→槽位」映射错位影响，
// 因为它就是那个地址上真实响过的字节。**更准的统计先验解决不了这两件事**，这套能。
//
// 2026-08-22 曾走过另一条路：本地没有字幕资料的形态**整族撤键**（自译层 2642 个）。
// 次日复核证据轴后判定那一刀砍偏了（两条耳测判例都指不到那一族），已恢复；
// 季节风险改由上面这条**全域一致**的优先级治理，不再按族歧视。原委见
// shared/voice-playback-observations 的文件头。
import { voiceFilenameOf } from './kcs-voice'
import { EXTRA_VOICE_DIRS, directVoiceIdOf, voiceSoundPathname } from '../shared/voice-sound-path'
import {
  voiceArchiveBlobPath,
  voiceArchiveState,
  type VoiceArchiveEntry,
} from '../shared/voice-archive-plan'

const path = require('path')
const { pathToFileURL } = require('url')
const { ipcRenderer } = require('electron')
const remote = require('@electron/remote')

// 档案根目录只在模块初始化时读一次。放进逐行的点亮判断里就是同步 IPC——
// 一屏台词几十行，那会把界面钉住（同一个坑见 assets/preload/resource-hack.js）。
const ARCHIVE_DIR: string = path.join(remote.getGlobal('APPDATA_PATH'), 'voice-archive')

/** pathname → 条目。一条路径可以有多份实物（同槽位的季节版与常规版）。 */
let byPath = new Map<string, VoiceArchiveEntry[]>()
let loading: Promise<void> | null = null
let ready = false
/**
 * 额外音轨目录（9997/9998/9999）下**留下过实物**的档名。
 *
 * 在索引装配期算一次，不在渲染路径上扫全表：深海台词卷要按形态列出「档案里
 * 听过的音轨」，逐行去翻整份档案就是把一次翻页变成几十次全表扫描。
 */
let extraFiles = new Map<string, string[]>()
/**
 * **舰娘音轨目录 → 档案里留下过实物的裸编号**（文件名就是编号本身，54..99999）。
 *
 * 与上面那份额外目录索引同一次装配算出来——台词卷要按形态摆出「档案里有、可表还没收」
 * 的那几条裸编号音轨，逐行去翻整份档案就是把一次翻页变成几十次全表扫描。
 * 判据与摆行规则在 shared/voice-probe-plan 的 `bareArchiveVoiceRows`（护栏能真跑一遍）。
 */
let bareSlots = new Map<string, number[]>()
/** 索引换过几回。消费端拿它当记忆的失效戳（档案一变，缓存的派生索引就该重算）。 */
let generation = 0

const EXTRA_PATH = /^\/kcs\/sound\/kc(999[789])\/([A-Za-z0-9_-]+)\.mp3$/
/** 舰娘目录下**纯数字**档名。裸编号与混淆编号都长这样，由 `directVoiceIdOf` 分开。 */
const SHIP_VOICE_PATH = /^\/kcs\/sound\/kc([A-Za-z0-9_-]+)\/(\d{1,6})\.mp3$/
/** 9997/9998/9999 没有 mstId 归属，不进舰娘那份索引（它们走上面 extraFiles）。 */
const EXTRA_DIRS = new Set<string>(Object.values(EXTRA_VOICE_DIRS))

const index = (entries: VoiceArchiveEntry[]) => {
  const map = new Map<string, VoiceArchiveEntry[]>()
  for (const entry of entries) {
    const list = map.get(entry.pathname) ?? []
    list.push(entry)
    map.set(entry.pathname, list)
  }
  byPath = map
  extraFiles = new Map()
  bareSlots = new Map()
  for (const entry of entries) noteArchivedFile(entry)
  generation += 1
  ready = true
}

/**
 * 一条实物 → 两份**装配期**派生索引（额外目录档名 / 舰娘目录裸编号）。
 * 两份都在这一趟里算完，渲染路径上一次全表扫描都不发生。
 */
const noteArchivedFile = (entry: VoiceArchiveEntry) => {
  if (!(entry.bytes > 0)) return
  noteBareSlot(entry)
  const matched = EXTRA_PATH.exec(entry.pathname)
  if (!matched) return
  const known = extraFiles.get(matched[1]) ?? []
  if (known.includes(matched[2])) return
  known.push(matched[2])
  extraFiles.set(matched[1], known)
}

/**
 * 这一条要是舰娘目录下的**裸编号**音轨，记进目录索引。
 *
 * 混淆编号（≥100000）不进：那些是常规 1..53 槽，各自有正经的场合名与摆行路径，
 * `directVoiceIdOf` 的值域判据把两者分得干净（见 shared/voice-sound-path 头注）。
 */
const noteBareSlot = (entry: VoiceArchiveEntry) => {
  const matched = SHIP_VOICE_PATH.exec(entry.pathname)
  if (!matched || EXTRA_DIRS.has(matched[1])) return
  const slot = directVoiceIdOf(matched[2])
  if (slot == null) return
  const known = bareSlots.get(matched[1]) ?? []
  if (known.includes(slot)) return
  known.push(slot)
  bareSlots.set(matched[1], known)
}

export const loadVoiceArchive = (): Promise<void> => {
  loading ??= (ipcRenderer.invoke('mg:voice-archive-entries') as Promise<VoiceArchiveEntry[]>)
    .then((entries) => index(Array.isArray(entries) ? entries : []))
    .catch((error: unknown) => {
      loading = null
      console.warn('[kanso] 语音档案索引读取失败', error)
    })
  return loading
}

/**
 * 主进程刚留住一份实物：整条并进本地索引。
 *
 * @returns 这一条是**新并进来**的吗。重复广播返回 false，别拿它去触发重渲。
 *
 * ---- 与立绘侧同一处订正（2026-08-23）----
 * 「这里不主动重渲」成文时语音只有一条进货渠道：游戏页面播放时锚挂钩，
 * 那会儿玩家看的是游戏画面。2026-08-22 加了「播放即入档」之后前提就没了——
 * 玩家在图鉴里点播放钮，入档恰恰发生在他盯着那一页的时候，而那一格该当场
 * 升成「档案里留着这一份」。理由与闸门详见 renderer/art-archive 的同名函数。
 */
export const noteVoiceArchived = (entry: VoiceArchiveEntry): boolean => {
  if (!ready || !entry?.pathname || !entry.sha1 || !(entry.bytes > 0)) return false
  const list = byPath.get(entry.pathname) ?? []
  if (list.some((known) => known.sha1 === entry.sha1)) return false
  list.push(entry)
  byPath.set(entry.pathname, list)
  noteArchivedFile(entry)
  generation += 1
  return true
}

/**
 * 索引的失效戳。**只用来当缓存键**——档案一变它就变，消费端据此重算派生索引。
 * 别拿它当「有几条」：合并重复条目时它不动，删不掉的条目也不会让它退回去。
 */
export const voiceArchiveGeneration = (): number => generation

/**
 * 某个额外音轨目录（`9997`/`9998`/`9999`）下、档案里**留下过实物**的全部档名。
 *
 * 深海台词卷用它把「玩家在战斗里听过、可文本源一个字都没收」的那些音轨摆出来。
 * 只给有实物的：没有实物就没有可播的东西，摆一行空钮既没意义也不诚实。
 */
export const archivedExtraVoiceFiles = (directory: string): readonly string[] =>
  extraFiles.get(directory) ?? []

/**
 * 某个**舰娘音轨目录**下、档案里留下过实物的裸编号（54 起，文件名就是编号）。
 *
 * 台词卷用它做「亲历显形」：官方新发明的裸编号（下一期活动的友军舰队…）
 * 玩家听过一次就自动长出一行，不必等展示侧那张表更新。
 * 传的是**目录名**不是形态号——目录即身份：一个目录名映射多个形态时，
 * 每个形态的页面都该长这行（共用目录 = 语音真共用）。
 */
export const archivedBareVoiceSlots = (directory: string): readonly number[] =>
  bareSlots.get(directory) ?? []

/**
 * 该舰某个语音槽位的音轨路径。算不出来（缺 shipgraph / 槽位不在可算范围）就 null。
 * 推导与取音、入档共用 shared/voice-sound-path 那一份——各写一份必然漂移，
 * 而漂移的表现是「播得出来却不点亮」。裸编号槽位（900…）随那一份一并放开。
 */
const voicePathOf = (mstId: number, voiceId: number): string | null =>
  voiceSoundPathname(voiceFilenameOf(mstId), mstId, voiceId)

export type VoiceLitState = 'none' | 'heard' | 'kept'

/** 这一槽位的收集状态。 */
export const voiceLitState = (mstId: number, voiceId: number): VoiceLitState => {
  const pathname = voicePathOf(mstId, voiceId)
  if (!pathname) return 'none'
  return voiceArchiveState(byPath.get(pathname) ?? [])
}

/**
 * 这条音轨路径已留下实物的本地播放地址。**只给档案里的实物**——
 * 不回退到游戏 CDN：这个函数是给季节台词那种「同一地址过季后内容会变」的行用的，
 * 拿网络那一份顶上去，播出来的就不是眼前这句。常规台词的试听走 kcs-voice 那条路。
 *
 * 按 **pathname** 取而不是按（形态, 槽位）取：深海/NPC/短剧的音轨本来就没有槽位号，
 * 它们在档案里的身份只有路径这一个（见 shared/voice-archive-plan 的 `pathname` 字段）。
 */
export const archivedVoiceUrlOf = (pathname: string | null): string | null => {
  if (!pathname) return null
  // 同一路径可能留下多份（当季那份与平时那份），取最近一次听到的
  const best = (byPath.get(pathname) ?? [])
    .filter((entry) => entry.bytes > 0 && entry.sha1)
    .sort((left, right) => right.lastHeard - left.lastHeard)[0]
  const relative = best ? voiceArchiveBlobPath(best.pathname, best.sha1) : null
  if (!relative) return null
  return pathToFileURL(path.join(ARCHIVE_DIR, ...relative.split('/'))).href
}

/** 该舰某个槽位已留下实物的本地播放地址（裸编号槽位一并适用，路径推导是同一份）。 */
export const archivedVoiceUrl = (mstId: number, voiceId: number): string | null =>
  archivedVoiceUrlOf(voicePathOf(mstId, voiceId))

/** 一条音轨路径下留存的一份实物：条目本身 + 它的本地播放地址。 */
export interface ArchivedVoiceTake {
  entry: VoiceArchiveEntry
  url: string
}

/**
 * 这条路径下**全部**留存的实物，最近听到的排前面。
 *
 * `archivedVoiceUrlOf` 只给最近那一份（播放钮要的就是一份）；这里给全部，
 * 是给「插入式扩展格」用的：同一槽位存了多份 sha1 时，正式行认领掉一份，
 * 其余的自动长成扩展变体行（判据在 shared/seasonal-collect 的 `unclaimedArchiveVariants`）。
 *
 * 装配期不预算这份索引：它只在**摊开某一格**时被问到一次，扫的是那条路径下的
 * 几条记录，不是全表——放进渲染路径的是查表，不是扫表。
 */
export const archivedVoiceTakesOf = (pathname: string | null): ArchivedVoiceTake[] => {
  if (!pathname) return []
  return (byPath.get(pathname) ?? [])
    .filter((entry) => entry.bytes > 0 && entry.sha1)
    .sort((left, right) => right.lastHeard - left.lastHeard)
    .flatMap((entry) => {
      const relative = voiceArchiveBlobPath(entry.pathname, entry.sha1)
      if (!relative) return []
      return [{ entry, url: pathToFileURL(path.join(ARCHIVE_DIR, ...relative.split('/'))).href }]
    })
}

/** 该舰某个槽位下留存的全部实物。路径推导与取音、入档共用同一份。 */
export const archivedVoiceTakes = (mstId: number, voiceId: number): ArchivedVoiceTake[] =>
  archivedVoiceTakesOf(voicePathOf(mstId, voiceId))
