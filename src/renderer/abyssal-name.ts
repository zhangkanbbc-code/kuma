export interface AbyssalNameEntry {
  id: number
  name: string
  yomi?: string
}

const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    // Wiki 会在末尾补“艦載機白/赤”等装备辨识；主数据实体名不含这段。
    .replace(/[（(][^（）()]*[）)]$/g, '')
    .trim()

// poi-plugin-subtitle 的深海包有一小批沿用繁中/中文音译名。这里只收已经逐条
// 对过 api_mst_ship 的显式别名；不做简繁模糊转换，避免把同名不同形态串在一起。
const AUDITED_SPEAKER_ALIASES: Record<string, string> = {
  水母棲姬: '水母棲姫',
  护卫栖水姬: '護衛棲水姫',
  '护卫栖水姬-坏': '護衛棲水姫-壊',
  深海海月姬: '深海海月姫',
  太平洋深海棲姬: '太平洋深海棲姫',
  '太平洋深海棲姬-壊': '太平洋深海棲姫-壊',
  安齊奧沖棲姫: 'アンツィオ沖棲姫',
  '安齊奧沖棲姫-壊': 'アンツィオ沖棲姫-壊',
  巴達維亞沖棲姬: 'バタビア沖棲姫',
  '巴達維亞沖棲姬-壞': 'バタビア沖棲姫-壊',
  潛水棲姬改: '潜水棲姫改',
  防空巡棲姬: '防空巡棲姫',
  '防空巡棲姬-壞': '防空巡棲姫-壊',
}

export const canonicalAbyssalSpeakerLabel = (value: string): string =>
  AUDITED_SPEAKER_ALIASES[value.trim()] ?? value.trim()

export const createAbyssalNameResolver = (entries: Iterable<AbyssalNameEntry>) => {
  const exact = new Map<string, number>()
  const relaxed = new Map<string, number>()
  const remember = (index: Map<string, number>, key: string, id: number) => {
    if (!key) return
    const current = index.get(key)
    if (current == null || id < current) index.set(key, id)
  }

  for (const entry of entries) {
    if (!Number.isInteger(entry.id) || entry.id <= 0 || !entry.name) continue
    const yomi = `${entry.yomi ?? ''}`.trim()
    const aliases = new Set([
      entry.name.trim(),
      `${entry.name}${yomi && yomi !== '-' ? yomi : ''}`.trim(),
    ])
    for (const alias of aliases) {
      remember(exact, alias, entry.id)
      remember(relaxed, normalized(alias), entry.id)
    }
  }

  return (label: string): number | null => {
    const canonical = canonicalAbyssalSpeakerLabel(label)
    return exact.get(canonical) ?? relaxed.get(normalized(canonical)) ?? null
  }
}
