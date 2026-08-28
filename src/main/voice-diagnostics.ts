import fs from 'fs'
import path from 'path'

import { atomicWriteJsonSync } from './atomic-json'
import { APPDATA_PATH } from './env'

// 「没出字幕」的语音台账。**三态要分开记**（2026-08-22 补 reason 字段）：
// 混在一起看不出该修哪儿，还会让人误以为「认不出的有 29 条」。
//
//   · unresolved  路径就认不出：目录名不在 shipgraph 里、或编号既非混淆值也非裸编号。
//                 这一档才是解析器的活。
//   · no-text     **归属可解，本地矿脉没有这一条译文**。跟解析器无关——
//                 是 wikiwiki-voice 独有、不随包（许可口径）造成的，改代码也补不出来。
//                 本机实测 29 条 ship 记录全属这一档（Jervis改 394 槽 13、Gloire改 970…）。
//   · no-voice-id 认出了目录（深海/NPC/短剧），但那个档名本地一条都没有。
export type VoiceUnmatchedReason = 'unresolved' | 'no-text' | 'no-voice-id'

export interface VoiceUnmatchedInput {
  pathname: string
  kind: 'ship' | 'npc' | 'enemy' | 'skit' | 'unresolved'
  reason?: VoiceUnmatchedReason
  voiceId?: string
  mstId?: number
  ts: number
}

interface VoiceUnmatchedRecord extends VoiceUnmatchedInput {
  reason: VoiceUnmatchedReason
  firstSeen: number
  lastSeen: number
  count: number
}

/** 台账按三态分组的条数。钥那一格据此如实分开说，不把三件事混成一个数。 */
export interface VoiceUnmatchedStats {
  unresolved: number
  noText: number
  noVoiceId: number
}

const FILE = path.join(APPDATA_PATH, 'voice-unmatched.json')
const MAX_RECORDS = 500
let records: VoiceUnmatchedRecord[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

const load = (): VoiceUnmatchedRecord[] => {
  if (records) return records
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    records = Array.isArray(raw?.records) ? raw.records.slice(-MAX_RECORDS) : []
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[kanso] voice diagnostics: failed to read unmatched log', error)
    }
    records = []
  }
  return records!
}

/**
 * 三态各有多少条。老记录没有 reason 字段时按 kind 推——
 * 「认出了归属」与「路径认不出」是两件事，不能因为字段是后加的就并成一堆。
 */
export const voiceUnmatchedStats = (): VoiceUnmatchedStats => {
  const list = load()
  const out: VoiceUnmatchedStats = { unresolved: 0, noText: 0, noVoiceId: 0 }
  for (const entry of list) {
    const reason = entry.reason ?? (entry.kind === 'unresolved' ? 'unresolved' : 'no-text')
    if (reason === 'unresolved') out.unresolved += 1
    else if (reason === 'no-voice-id') out.noVoiceId += 1
    else out.noText += 1
  }
  return out
}

export const flushVoiceUnmatched = () => {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!records) return
  try {
    atomicWriteJsonSync(FILE, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records,
    })
  } catch (error) {
    console.warn('[kanso] voice diagnostics: failed to write unmatched log', error)
  }
}

export const recordVoiceUnmatched = (input: VoiceUnmatchedInput) => {
  const pathname = `${input?.pathname ?? ''}`.slice(0, 500)
  const voiceId = input?.voiceId == null ? undefined : `${input.voiceId}`.slice(0, 120)
  const mstId = Number.isInteger(input?.mstId) && Number(input.mstId) > 0
    ? Number(input.mstId)
    : undefined
  const ts = Number.isFinite(input?.ts) && Number(input.ts) > 0 ? Number(input.ts) : Date.now()
  if (
    !/^\/kcs\/sound\/(?:kc[^/]+|titlecall)\/[^/]+\.mp3$/i.test(pathname) ||
    !['ship', 'npc', 'enemy', 'skit', 'unresolved'].includes(input?.kind)
  ) {
    return
  }
  // 调用方没说原因时按 kind 兜底：认出归属的一律是「有归属、没译文」
  const reason: VoiceUnmatchedReason =
    input?.reason && ['unresolved', 'no-text', 'no-voice-id'].includes(input.reason)
      ? input.reason
      : input.kind === 'unresolved'
        ? 'unresolved'
        : 'no-text'

  const list = load()
  const known = list.find(
    (entry) =>
      entry.kind === input.kind &&
      entry.voiceId === voiceId &&
      entry.mstId === mstId &&
      entry.pathname === pathname,
  )
  if (known) {
    known.lastSeen = Math.max(known.lastSeen, ts)
    known.count += 1
    known.reason = reason // 老记录（reason 上线前存的）在这里补上
  } else {
    list.push({
      pathname,
      kind: input.kind,
      reason,
      ...(voiceId ? { voiceId } : {}),
      ...(mstId ? { mstId } : {}),
      ts,
      firstSeen: ts,
      lastSeen: ts,
      count: 1,
    })
    if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS)
  }
  if (!flushTimer) flushTimer = setTimeout(flushVoiceUnmatched, 400)
}
