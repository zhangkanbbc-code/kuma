import { normalizeVoiceLine } from './voice-lineage'
import { isUntranslatedVoiceText } from './voice-text'

export type VoiceOverlayPackId = 'kcwiki-voice' | 'kcwiki-seasonal-voice'

export interface VoiceOverlayEntry {
  pack: VoiceOverlayPackId
  ja: string
  zh: string
}

export interface VoiceOverlayData {
  entries?: Record<string, VoiceOverlayEntry | undefined>
  byJa?: { ja: string; zh: string }[]
}

export interface VoiceOverlaySourceRow {
  key: string
  ja: string
  zh: string
}

export interface VoiceOverlayWarning {
  key: string
  pack: VoiceOverlayPackId
  upstreamJa: string
  overlayJa: string
}

export interface VoiceOverlayResult<Row extends VoiceOverlaySourceRow> {
  data: Record<string, Row[] | undefined>
  appliedKeys: string[]
  retiredKeys: string[]
  warnings: VoiceOverlayWarning[]
}

/**
 * 第一方译文只叠在仍缺译、且日文原文未漂移的上游行上。
 * 返回新行表，不改传入的上游对象。
 */
export const applyVoiceOverlay = <Row extends VoiceOverlaySourceRow>(
  rowsByGroup: Readonly<Record<string, readonly Row[] | undefined>> | null | undefined,
  overlay: VoiceOverlayData | null | undefined,
  pack: VoiceOverlayPackId,
): VoiceOverlayResult<Row> => {
  const entries = overlay?.entries ?? {}
  const appliedKeys: string[] = []
  const retiredKeys: string[] = []
  const warnings: VoiceOverlayWarning[] = []
  const data: Record<string, Row[] | undefined> = {}

  for (const [group, rows] of Object.entries(rowsByGroup ?? {})) {
    if (!Array.isArray(rows)) {
      data[group] = undefined
      continue
    }
    data[group] = rows.map((row) => {
      const entry = entries[row.key]
      if (!entry || entry.pack !== pack) return { ...row }
      if (normalizeVoiceLine(row.ja) !== normalizeVoiceLine(entry.ja)) {
        warnings.push({
          key: row.key,
          pack,
          upstreamJa: row.ja,
          overlayJa: entry.ja,
        })
        return { ...row }
      }
      if (!isUntranslatedVoiceText(row.zh)) {
        retiredKeys.push(row.key)
        return { ...row }
      }
      appliedKeys.push(row.key)
      return { ...row, zh: entry.zh }
    })
  }

  return { data, appliedKeys, retiredKeys, warnings }
}

/** overlay 全部 keyed 条目与字幕专用 byJa 条目共用的日文原文 → 中文译文索引。 */
export const voiceOverlayJaIndex = (
  overlay: VoiceOverlayData | null | undefined,
): Map<string, string> => {
  const index = new Map<string, string>()
  for (const entry of Object.values(overlay?.entries ?? {})) {
    if (!entry) continue
    const key = normalizeVoiceLine(entry.ja)
    if (key) index.set(key, entry.zh)
  }
  for (const entry of overlay?.byJa ?? []) {
    const key = normalizeVoiceLine(entry.ja)
    if (key) index.set(key, entry.zh)
  }
  return index
}
