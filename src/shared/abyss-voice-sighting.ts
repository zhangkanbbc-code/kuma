// 深海开幕语音的「亲历台账」——**判据的单一出处**。
//
// ---- 缺口在哪 ----
// 深海台词卷只对 `subtitle-enemies` 那一支给播放钮，因为**只有它的 key 是完整的官方
// 档名**（`/kcs/sound/kc9998/605229710.mp3` 里那串裸数字），别的源给的是 wiki 资源键，
// 拼不出地址，也绝不许伪造（家法见 modules/ji 那一段）。
// 于是像米駆逐棲姫（2204）这样只被 `wikiwiki-abyss-voice` 收录的形态，
// 开幕台词摆得出来、播放钮却没有。
//
// ---- 官方自己会把档名告诉我们 ----
// Boss 开幕时，战斗报文的 `api_flavor_info` 里同时带着
// `api_boss_ship_id`（哪一艘）与 `api_voice_id`（哪一条音轨）。实测这两者严丝合缝：
//   api_voice_id="605229710" / api_boss_ship_id="2297"
//   → 605 | 2297 | 10  （前缀 | 形态号 | 行号，行号首位 1 = 開幕前）
// `api_voice_id` **就是** kc9998 的档名。也就是说，玩家亲历过的那一场，
// 官方已经替我们把「这一句是谁的、叫什么名字」讲清楚了——这是一手证据，不是推断。
//
// ---- 哲学：亲历显形 ----
// 只记**玩家自己遇到过**的：记过的才显示播放钮，没记过的一个字都不猜。
// 与「你的实测」「本机确认掉落」「档案点亮」同一家族。
//
// ---- 为什么行号还要自己算 ----
// 归属（mstId）由报文直给，不需要反解。但「这一条是开幕还是被弹」得看档名末尾的行号，
// 而报文不给。这里用**已知的 mstId** 去档名里定位形态号那一段，剩下的就是行号——
// 比 `abyss-voice-file` 的全盲反解更硬：那边要在候选里挑，这边形态号是给定的。
// 定位不唯一就返回空串（不猜），那一条仍然入账，只是不认领场合。

import { parseAbyssVoiceFile } from './abyss-voice-file'
import type { BattleFlavorVoice } from './mg-types'

export interface AbyssVoiceSighting {
  /** 深海形态 mstId，来自 `api_boss_ship_id`（一手，不反解） */
  mstId: number
  /** kc9998 的档名（不含扩展名），来自 `api_voice_id` */
  voiceId: string
  /** 档名末 1~2 位的行号；定位不出来就是空串 */
  lineNo: string
  firstHeard: number
  lastHeard: number
  /** 亲历次数。同一条重复听到只累加，不新建条目 */
  count: number
  /**
   * 这一条的判据来路。台账上两族记录的证据强度不一样，**不许在界面上混成一句话**：
   * 报文那一族是官方自己说的（一手），耳测考古那一族是「档名由结构自证归属、
   * 响没响由提督的耳朵判」。字段 2026-08-25 才加，老台账缺它——读回来时补成报文
   *（那时候只有这一条路，见 `normalizeAbyssVoiceSightings`）。
   */
  basis: string
}

/** 报文亲历：Boss 开幕时官方在 `api_flavor_info` 里自己把档名说了出来。 */
export const ABYSS_VOICE_BASIS_FLAVOR = '战斗报文 api_flavor_info'

/**
 * 耳测考古：往期活动的 boss 没有亲历机会，只能按档名结构推出候选、逐条试听。
 * 归属由档名结构自证（中段就是形态号），提督的耳朵只判「响没响、像不像那句台词」。
 */
export const abyssVoiceEarBasis = (day: string): string => `用户耳测考古 ${day}`

/** 这一条是耳测考古来的吗（界面上要说不同的话）。 */
export const isAbyssVoiceEarBasis = (basis: string | null | undefined): boolean =>
  `${basis ?? ''}`.startsWith('用户耳测考古')

/**
 * 读回台账：`basis` 是 2026-08-25 才加的字段，缺它的一律是报文亲历
 * ——那天之前**只有报文这一条路**，所以这不是默认值，是事实。
 */
export const normalizeAbyssVoiceSightings = (
  list: readonly (AbyssVoiceSighting | Omit<AbyssVoiceSighting, 'basis'>)[],
): AbyssVoiceSighting[] =>
  list.map((entry) => ({
    ...entry,
    basis: `${(entry as AbyssVoiceSighting).basis ?? ''}`.trim() || ABYSS_VOICE_BASIS_FLAVOR,
  }))

/** 行号 → 場合族（首位）。`'10'`/`'11'` 都属 `'1'`（開幕前）。 */
export const abyssVoiceSceneFamily = (lineNo: string | number | null | undefined): string => {
  const text = `${lineNo ?? ''}`.trim()
  return /^[1-5]/.test(text) ? text[0]! : ''
}

const LINE_ONE = /^[1-5]$/
const LINE_TWO = /^[1-5][01]$/

/**
 * 拿**已知的** mstId 在档名里定位形态号，剩下那一截就是行号。
 *
 * 形态号有两种写法（与 `abyss-voice-file` 同一套实证）：4 位就是 mstId 本身；
 * 3 位（或补一个前导零的 4 位）时 mstId = 1000 + 它。前缀是 2~3 位。
 * 两种读法给出不同行号时返回空串——**宁可不认场合，也不认错**。
 */
export const abyssVoiceLineNo = (voiceId: string, mstId: number): string => {
  if (!/^\d+$/.test(voiceId) || !Number.isInteger(mstId) || mstId < 1_500) return ''
  const forms = [`${mstId}`]
  if (mstId > 1_000 && mstId < 2_000) {
    forms.push(`${mstId - 1_000}`, `${mstId - 1_000}`.padStart(4, '0'))
  }
  const tails = new Set<string>()
  for (const form of forms) {
    for (const head of [2, 3]) {
      if (voiceId.slice(head, head + form.length) !== form) continue
      const tail = voiceId.slice(head + form.length)
      if (LINE_ONE.test(tail) || LINE_TWO.test(tail)) tails.add(tail)
    }
  }
  return tails.size === 1 ? [...tails][0]! : ''
}

/**
 * 耳测考古的一条**收不收**：收，就返回一条与报文同形的记录；不收返回 null。
 *
 * 归属由**档名结构自证**，不靠调用方一句话：反解要解出唯一一个深海形态，且正是
 * 入参那一个。这一族的错法是把 A 的声音记到 B 名下，而界面上它和对的长得一模一样。
 *
 * 场合（行号）解不出来**照收**：归属与场合是两层，场合不明只让那一行在正式界面上
 * 还点不亮，不该连带把「这个形态确实有这条音轨」也丢掉。
 *
 * @param isAbyssMstId 见 `parseAbyssVoiceFile`——判据由调用方给，因为主数据不住在 shared 层。
 */
export const abyssVoiceArchaeologyRow = (
  input: { mstId?: unknown; voiceId?: unknown },
  isAbyssMstId: (mstId: number) => boolean,
): BattleFlavorVoice | null => {
  const mstId = Number(input?.mstId)
  const voiceId = `${input?.voiceId ?? ''}`.trim()
  // 长度下界 2+3+1、上界 3+4+2，与 `parseAbyssVoiceFile` 同一套
  if (!Number.isInteger(mstId) || mstId < 1_500 || !/^\d{6,9}$/.test(voiceId)) return null
  if (parseAbyssVoiceFile(voiceId, isAbyssMstId)?.mstId !== mstId) return null
  return { mstId, voiceId, shipName: '', message: '' }
}

/** 台账上限：一条几十字节，留得住多年亲历；超了从最早的开始丢。 */
export const ABYSS_VOICE_SIGHTING_MAX = 2_000

/**
 * 把一场战斗报文里的开幕语音并进台账。
 *
 * @returns 新数组（不就地改入参）与「有没有真的变化」——没变化就不必落盘。
 */
export const foldAbyssVoiceSightings = (
  current: readonly AbyssVoiceSighting[],
  rows: readonly BattleFlavorVoice[],
  ts: number,
  /** 这一批的来路。缺省是报文亲历——耳测考古那一路自己传 `abyssVoiceEarBasis(今天)`。 */
  basis: string = ABYSS_VOICE_BASIS_FLAVOR,
): { list: AbyssVoiceSighting[]; changed: boolean } => {
  const at = Number.isFinite(ts) ? ts : 0
  const list = current.map((entry) => ({ ...entry }))
  const index = new Map(list.map((entry, i) => [`${entry.mstId}:${entry.voiceId}`, i]))
  let changed = false
  for (const row of rows) {
    const mstId = Number(row?.mstId)
    const voiceId = `${row?.voiceId ?? ''}`.trim()
    if (!Number.isInteger(mstId) || mstId < 1_500 || !/^\d{1,12}$/.test(voiceId)) continue
    const key = `${mstId}:${voiceId}`
    const found = index.get(key)
    if (found != null) {
      const entry = list[found]!
      entry.lastHeard = Math.max(entry.lastHeard, at)
      entry.count += 1
      // 耳测考古记过的那一条后来真在战斗里听到了：**证据升级**，改标报文。
      // 反过来不许——一手的报文不该被后来的耳测冲淡。
      if (basis === ABYSS_VOICE_BASIS_FLAVOR) entry.basis = ABYSS_VOICE_BASIS_FLAVOR
      changed = true
      continue
    }
    index.set(key, list.length)
    list.push({
      mstId,
      voiceId,
      lineNo: abyssVoiceLineNo(voiceId, mstId),
      firstHeard: at,
      lastHeard: at,
      count: 1,
      basis,
    })
    changed = true
  }
  if (list.length > ABYSS_VOICE_SIGHTING_MAX) {
    list.splice(0, list.length - ABYSS_VOICE_SIGHTING_MAX)
  }
  return { list, changed }
}

/**
 * 这个形态、这一族場合，玩家亲历过的那一条音轨。没有就是 null。
 *
 * 同族有多条时取**最近听到**的那一条：官方偶尔会给同一场合备几条，
 * 而玩家最后听到的那一条是此刻最可能仍然挂着的。
 */
export const abyssVoiceSightingFor = (
  list: readonly AbyssVoiceSighting[],
  mstId: number,
  family: string,
): AbyssVoiceSighting | null => {
  if (!family) return null
  let best: AbyssVoiceSighting | null = null
  for (const entry of list) {
    if (entry.mstId !== mstId) continue
    if (abyssVoiceSceneFamily(entry.lineNo) !== family) continue
    if (!best || entry.lastHeard > best.lastHeard) best = entry
  }
  return best
}
