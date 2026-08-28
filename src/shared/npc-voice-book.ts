// kc9999 的 NPC 台词：从「音轨编号 → 台词」的平表整理成「角色 → 音轨块」的分组视图。
//
// 拆成纯层是因为这份数据的**归属判据**全靠约定，而约定写错了不报错：
// 界面上「归错了组」和「归对了组」长得一模一样，只有认得出这几位角色的人才看得出来。
// 下面两条判据各自有理由，别当成随手挑的。
//
// ---- ① 为什么一块归到「块内第一行的 name」名下 ----
// 一个音轨编号就是 kc9999 下的**一个 mp3 文件**。设施 NPC（明石、大淀、间宫、伊良湖）
// 是一键一条，谁说的没有歧义；但活动演出那一族是一键多条——西村舰队出击前的群像对白
// 里满潮、时雨、荒潮各说各的，一块里有好几个 name。
// 归属只能落在**开口的那一位**身上：文件不可分割，播放钮播的是整条音轨，
// 按「块内每个 name 都算一组」去拆，就会让同一个 mp3 出现在好几位名下，
// 点谁都播同一段完整对白——那不是分组，是复制。
//
// ---- ② 为什么组序按「组内最小音轨编号」升序 ----
// 音轨编号是游戏自己的档号，大致按实装先后发放：设施 NPC 占着 1..29 这一段低号，
// 活动演出是后来加的，落在 430+ 与 1186+。按组内最小号排组，日常听得到的那四位
// 自然排在活动演出前面，**而这是数据自己排出来的，不是我们写了一张名单**。
// 写死「明石、大淀、间宫、伊良湖优先」的白名单会在游戏下次加设施 NPC 时过期，
// 且过期的表现是新角色被默默排到活动演出后面去，没人会发现。
//
// ---- ③ 为什么「BGM」那一行要取 text 当组名，不取 name ----
// 整首插入曲的块（434《月夜海》）前三行是**曲目元信息**：name 依次是
// `BGM` / `作曲` / `作词`，之后才是逐行歌词。这三行的 name 不是「谁在说话」，
// 而是**字段标签**——「BGM：月夜海」里 name 是标签、text 才是值。
// 照判据 ① 直接取 name，这块就会得到一张叫「BGM」的卡，与明石、大淀并排摆着，
// 看起来像个坏条目。取 `BGM` 那一行的 text 得到的是曲名，卡就成了一张歌曲演出卡。
// **不写死 434**：判据挂在「第一行的 name 是 BGM」这个形状上，将来再进一首插入曲同样命中。
// 元信息那三行**照旧逐行显示**，一行不删——它们是这块内容的一部分。
import { EXTRA_VOICE_DIRS } from './voice-sound-path'

/** subtitle-npc 里的一行。字段名跟着上游 poi-plugin-subtitle 的形状走。 */
export interface NpcVoiceEntry {
  name?: string
  jp?: string
  zh?: string
  en?: string
  time?: number
}

/** subtitle-npc 的 `data`：音轨编号 → 一条，或一整块（活动演出是多条）。 */
export type NpcVoiceTable = Record<string, NpcVoiceEntry | NpcVoiceEntry[] | null | undefined>

export interface NpcVoiceLine {
  /** 这一行谁说的。块内逐行各自带 name——一块里可以有好几位 */
  name: string
  /** 日文原文。台词卷是**对照**功能，这一列跟中文并排摆，不是可选的附注 */
  ja: string
  /**
   * 中文。缺了就回退日文——一行台词摆在那儿却是空的，比重复一遍原文更难解释，
   * 而且「这一格没有中文」和「这一格没有台词」在界面上会长成同一个样子。
   */
  zh: string
}

export interface NpcVoiceTrack {
  /** 音轨编号，就是 kc9999 下的档名主体 */
  key: string
  /** 编号的数值形。排序与分组都按它，字符串序会把 `1187` 排到 `430` 前面 */
  no: number
  /** 音轨路径。既是取音轨的依据，也是**档案里的身份**（播过之后按它入档） */
  path: string
  lines: NpcVoiceLine[]
}

export interface NpcVoiceGroup {
  /** 组名 = 块内第一行的 name（判据 ①）；那一行是曲名字段时取它的值（判据 ③） */
  name: string
  /** 组内最小音轨编号。组序由它定（判据 ②） */
  firstNo: number
  tracks: NpcVoiceTrack[]
  /** 这一位名下一共多少行台词。列表卡上摆得出的数字只有它——等级/舰种那些 NPC 位没有 */
  lineCount: number
}

/**
 * 音轨编号 → 路径。目录常量取自 `voice-sound-path`，**这里不写 9999**：
 * 取音轨、判点亮、入档三处必须用同一份推导，各写一份必然漂移，
 * 而漂移的表现是「播得出来却不点亮」，不报错。
 */
export const npcVoicePathname = (key: string): string =>
  `/kcs/sound/kc${EXTRA_VOICE_DIRS.npc}/${key}.mp3`

const lineOf = (entry: NpcVoiceEntry | null | undefined): NpcVoiceLine => {
  const ja = `${entry?.jp ?? ''}`.trim()
  const zh = `${entry?.zh ?? ''}`.trim()
  return { name: `${entry?.name ?? ''}`.trim(), ja, zh: zh || ja }
}

/**
 * 曲目元信息里「曲名」那一行的字段名（判据 ③）。
 *
 * 它是这张表里唯一一个 name **不指人**的值：同族的 `作曲`/`作词` 也一样是字段标签，
 * 但只有 `BGM` 那一行的值是**这块叫什么**，所以只认它一个。
 */
const SONG_TITLE_FIELD = 'BGM'

/**
 * 这块归谁名下。通常是第一行的说话人（判据 ①）；
 * 第一行是曲名字段时改取它的**值**，也就是曲名（判据 ③）。
 */
const ownerOf = (head: NpcVoiceLine): string =>
  head.name === SONG_TITLE_FIELD ? head.zh : head.name

/**
 * 平表 → 分组视图。判据见头注 ①②③。
 *
 * 非裸数字的键**整块丢掉**：编号要拿去拼音轨路径，拼不出路径的块摆出来就是
 * 一个点了没反应的播放钮。现行随包数据里一个都没有，这条是给上游改形状时兜的底。
 */
export const buildNpcVoiceBook = (table: NpcVoiceTable | null | undefined): NpcVoiceGroup[] => {
  const byName = new Map<string, NpcVoiceTrack[]>()
  for (const [key, raw] of Object.entries(table ?? {})) {
    if (!/^\d{1,12}$/.test(key)) continue
    const entries = Array.isArray(raw) ? raw : raw ? [raw] : []
    const lines = entries.map(lineOf).filter((line) => line.ja || line.zh)
    if (!lines.length) continue
    const owner = ownerOf(lines[0])
    if (!owner) continue
    const track: NpcVoiceTrack = {
      key,
      no: Number(key),
      path: npcVoicePathname(key),
      lines,
    }
    const known = byName.get(owner)
    if (known) known.push(track)
    else byName.set(owner, [track])
  }

  const groups: NpcVoiceGroup[] = []
  for (const [name, tracks] of byName) {
    tracks.sort((left, right) => left.no - right.no)
    groups.push({
      name,
      firstNo: tracks[0].no,
      tracks,
      lineCount: tracks.reduce((sum, track) => sum + track.lines.length, 0),
    })
  }
  groups.sort((left, right) => left.firstNo - right.firstNo)
  return groups
}

/** 按组名取一组。列表点开某一位之后，抽屉靠它把那一位找回来。 */
export const npcVoiceGroupOf = (
  groups: readonly NpcVoiceGroup[],
  name: string,
): NpcVoiceGroup | null => groups.find((group) => group.name === name) ?? null
