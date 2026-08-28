// 深海开幕语音亲历台账的落盘层。判据与理由在 `shared/abyss-voice-sighting`。
//
// 形制照抄同目录的 `voice-diagnostics`：APPDATA 下一个小 JSON、懒加载、
// 防抖落盘、退出时冲一次。它记的是**玩家自己遇到过**的 (深海形态, 官方档名)，
// 全部来自被动拦下来的战斗报文——**没有任何一次主动请求**。
//
// 为什么不进 mg.sqlite：这一份与账本的账目无关，是「见过什么」的小索引，
// 读取方只有图鉴一处、整份一次读完；单文件比开一张表轻，也跟着
// 「时间性记录不自动过期」那条口径走（不设 TTL，玩家自己清）。
import fs from 'fs'
import path from 'path'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'
import {
  abyssVoiceArchaeologyRow,
  abyssVoiceEarBasis,
  foldAbyssVoiceSightings,
  normalizeAbyssVoiceSightings,
  type AbyssVoiceSighting,
} from '../shared/abyss-voice-sighting'
import { localDayOf } from '../shared/local-calendar'
import type { BattleFlavorVoice } from '../shared/mg-types'

const FILE = path.join(APPDATA_PATH, 'abyss-voice-sightings.json')
const SCHEMA_VERSION = 1
const FLUSH_DELAY_MS = 2_000

let sightings: AbyssVoiceSighting[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

const load = (): AbyssVoiceSighting[] => {
  if (sightings) return sightings
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    // 老台账没有 `basis` 字段——补成报文亲历，那时候只有这一条路（判据在 shared）
    sightings = Array.isArray(raw?.sightings) ? normalizeAbyssVoiceSightings(raw.sightings) : []
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[kanso] abyss voice sightings: failed to read', error)
    }
    sightings = []
  }
  return sightings!
}

export const flushAbyssVoiceSightings = () => {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!sightings) return
  try {
    atomicWriteJsonSync(FILE, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      sightings,
    })
  } catch (error) {
    // 记不下来只是下次少一个播放钮，不该拖垮战斗结算
    console.warn('[kanso] abyss voice sightings: failed to write', error)
  }
}

/**
 * 把一场战斗报文里的深海开幕语音记进台账。
 *
 * 入参就是 `parseFlavorVoices` 的产物——**被动观察**到的东西，一次请求都不发。
 */
export const recordAbyssVoiceSightings = (rows: readonly BattleFlavorVoice[], ts: number) => {
  if (!rows.length) return
  const { list, changed } = foldAbyssVoiceSightings(load(), rows, ts)
  if (!changed) return
  sightings = list
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushAbyssVoiceSightings, FLUSH_DELAY_MS)
}

/**
 * 耳测考古的一条收录：往期活动的 boss 没有亲历机会，档名只能按结构推候选、
 * 逐条试听，响了且提督认下来才收。
 *
 * **归属由档名结构自证**，不靠调用方一句话：反解要解出**唯一**一个深海形态，
 * 且正是入参那一个，才落账。这一族的错法是把 A 的声音记到 B 名下，而界面上
 * 它和对的长得一模一样——所以宁可拒收。
 *
 * 场合（行号）解不出来时照收：**归属和场合是两层**，场合不明只是那一行在正式
 * 界面上还点不亮，不该连带把「这个形态确实有这条音轨」也丢掉。
 *
 * @param isAbyssMstId 「这个号是不是深海形态」的判据。落盘层没有主数据，
 *   由调用方给（与 `parseAbyssVoiceFile` 同一个约定）。
 * @returns 落账后的那一条；入参不合法或反解对不上返回 null。
 */
export const recordAbyssVoiceArchaeology = (
  input: { mstId?: unknown; voiceId?: unknown },
  isAbyssMstId: (mstId: number) => boolean,
  ts: number = Date.now(),
): AbyssVoiceSighting | null => {
  const row = abyssVoiceArchaeologyRow(input, isAbyssMstId)
  if (!row) return null
  const { list, changed } = foldAbyssVoiceSightings(
    load(),
    [row],
    ts,
    // 日期按**本地**日历：提督看到的是他自己按下鼠标那天的日期，
    // 换算成 JST 会让「我昨天收的」对不上台账上写的那一天（同 voice-probe-plan 那条）
    abyssVoiceEarBasis(localDayOf(ts)),
  )
  if (!changed) return null
  sightings = list
  // 收录是人工动作，一次一条，当场落盘——不走那 2 秒防抖：
  // 提督点完就可能去关窗口，攒着等于把刚认下来的那一条丢掉
  flushAbyssVoiceSightings()
  return list.find((entry) => entry.mstId === row.mstId && entry.voiceId === row.voiceId) ?? null
}

/** 整份台账（图鉴一次读完）。 */
export const queryAbyssVoiceSightings = (): AbyssVoiceSighting[] => load().slice()
