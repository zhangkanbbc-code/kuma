import { buildVoiceTranslationIndex, normalizeVoiceLine } from './voice-lineage'
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

const hasMisplacedJapaneseSource = (row: VoiceOverlaySourceRow): boolean =>
  row.ja.trim() === '' && (row.zh.match(/[ぁ-ゖァ-ヺ]/g)?.length ?? 0) >= 2

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
      // kcwiki 偶有把日文原文误填进 zh、ja 留空的行。只在 ja 为空且 zh 至少含
      // 两个假名时，把那一列当作本行的日文锚点；已有 ja 的正常中文译文不受影响。
      const misplacedJapaneseSource = hasMisplacedJapaneseSource(row)
      const upstreamJa = misplacedJapaneseSource ? row.zh : row.ja
      if (normalizeVoiceLine(upstreamJa) !== normalizeVoiceLine(entry.ja)) {
        warnings.push({
          key: row.key,
          pack,
          upstreamJa,
          overlayJa: entry.ja,
        })
        return { ...row }
      }
      if (!misplacedJapaneseSource && !isUntranslatedVoiceText(row.zh)) {
        retiredKeys.push(row.key)
        return { ...row }
      }
      appliedKeys.push(row.key)
      return { ...row, zh: entry.zh }
    })
  }

  return { data, appliedKeys, retiredKeys, warnings }
}

export const supplementVoiceZhByJa = (
  index: Map<string, string>,
  lines: { ja?: unknown; zh?: unknown }[] | null | undefined,
): void => {
  for (const line of lines ?? []) {
    const key = normalizeVoiceLine(line?.ja)
    const value = `${line?.zh ?? ''}`.trim()
    if (!key || !value || isUntranslatedVoiceText(value) || index.has(key)) continue
    index.set(key, value)
  }
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

/** 舰娘同句译文：字幕对 → kcwiki（非深海）→ 译文覆盖层 → kuma-voice，后源只补空。 */
export const buildVoiceZhByJa = (
  subtitleJa: Parameters<typeof buildVoiceTranslationIndex>[0],
  subtitleZh: Parameters<typeof buildVoiceTranslationIndex>[1],
  kcwiki: Record<string, { ja?: unknown; zh?: unknown }[] | undefined>,
  overlay: VoiceOverlayData | null | undefined,
  kuma: Record<string, { ja?: unknown; zh?: unknown }[] | undefined>,
): Map<string, string> => {
  const index = buildVoiceTranslationIndex(subtitleJa, subtitleZh)
  for (const [id, lines] of Object.entries(kcwiki)) {
    if (Number(id) < 1_500) supplementVoiceZhByJa(index, lines)
  }
  for (const [key, value] of voiceOverlayJaIndex(overlay)) {
    if (!index.has(key)) index.set(key, value)
  }
  for (const lines of Object.values(kuma)) supplementVoiceZhByJa(index, lines)
  return index
}
