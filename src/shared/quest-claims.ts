import { questCategoryLetterFromObserved } from './quest-observed'
import { questCodeFamily } from './quest-period'

export interface QuestScnEntry {
  code: string
  name: string
  desc: string
  memo: string
  memo2: string
  pre: string[]
}

export interface QuestScnPack {
  data?: unknown
  unnumbered?: Record<string, QuestScnEntry & { titleJa: string }>
}

export interface QuestClaim {
  no: number
  code: string
  title: string
}

/** 只由游戏观测重推，不修改原包或定号表；标题仅 trim，先判唯一再判类别。 */
export const resolveQuestClaims = (
  pack: QuestScnPack | null,
  observed: Iterable<{ no: number; title: string; category: number }>,
): { data: Record<string, QuestScnEntry>; claims: QuestClaim[] } => {
  const data = { ...(pack?.data as Record<string, QuestScnEntry> ?? {}) }
  const claims: QuestClaim[] = []
  const candidates = Object.values(pack?.unnumbered ?? {})
  for (const quest of observed) {
    if (Object.hasOwn(data, quest.no)) continue
    const title = quest.title?.trim() ?? ''
    if (!title) continue
    const matches = candidates.filter(entry => entry.titleJa.trim() === title)
    if (matches.length !== 1) continue
    const entry = matches[0]
    const category = questCategoryLetterFromObserved(quest.category)
    if (!category || questCodeFamily(entry.code) !== category) continue
    const { titleJa: _titleJa, ...numbered } = entry
    data[quest.no] = numbered
    claims.push({ no: quest.no, code: entry.code, title })
  }
  return { data, claims }
}
