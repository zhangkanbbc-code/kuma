// 改装链箭头的等级/弹钢：主数据定义了这条边且三项完整时，优先采用主数据。
// kcsapi 字段名陷阱：api_afterbull=弹药、api_afterfuel=钢材。
// 412 → 749：api_afterlv=92、api_afterbull=3200、api_afterfuel=5400；
// 119 → 1071：api_afterlv=88。两条新边的 kcwiki 等级/弹药/钢材仍为 0/0/0，
// 旧资料的「没有下一改」占位值不能压过主数据这条边的字段值。
export const remodelEdgeCost = (
  predecessor: {
    api_aftershipid?: string | number
    api_afterlv?: number
    api_afterbull?: number
    api_afterfuel?: number
  } | null | undefined,
  targetMstId: number,
  wiki: { 等级?: number; 弹药?: number; 钢材?: number } | null | undefined,
): { level: number | '?'; bull: number | '?'; fuel: number | '?'; source: 'master' | 'wiki' | 'none' } => {
  if (
    Number(predecessor?.api_aftershipid) === targetMstId &&
    Number.isInteger(predecessor?.api_afterlv) &&
    Number.isInteger(predecessor?.api_afterbull) &&
    Number.isInteger(predecessor?.api_afterfuel)
  ) {
    return {
      level: predecessor!.api_afterlv!,
      bull: predecessor!.api_afterbull!,
      fuel: predecessor!.api_afterfuel!,
      source: 'master',
    }
  }
  if ([wiki?.等级, wiki?.弹药, wiki?.钢材].some(Number.isInteger)) {
    return {
      level: Number.isInteger(wiki?.等级) ? wiki!.等级! : '?',
      bull: Number.isInteger(wiki?.弹药) ? wiki!.弹药! : '?',
      fuel: Number.isInteger(wiki?.钢材) ? wiki!.钢材! : '?',
      source: 'wiki',
    }
  }
  return { level: '?', bull: '?', fuel: '?', source: 'none' }
}
