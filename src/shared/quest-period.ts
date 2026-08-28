export type QuestPeriodKind = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

const DAY = 86_400_000
// 先转 JST，再减去 05:00：这样 UTC 日界线正好就是游戏的日重置线。
const resetDay = (ts: number) => Math.floor((ts + 4 * 3_600_000) / DAY)

export const questAnnualMonth = (text: string): number | null => {
  const source = `${text ?? ''}`
  const match =
    source.match(/年常任务[（(]\s*(1[0-2]|[1-9])\s*月[）)]/) ??
    source.match(/(?:^|\D)(1[0-2]|[1-9])\s*月年常/)
  const month = Number(match?.[1] ?? 0)
  return month >= 1 && month <= 12 ? month : null
}

/**
 * 任务编码的**分类位**：A 编成 / B 出击 / C 演习 / D 远征 / E 补给入渠 / F 工厂 / G 改装。
 * 期间限定编码带四位年月前缀（2606Cm1），先跳过它再取字母。
 *
 * 这是任务目录自己的分类，不是谁的整理成果；自研推导拿它当类别闸门——
 * 没有这道闸的话，远征名里的「航空战舰运用演习」会被演习类推导当成演习计数。
 */
export const questCodeFamily = (code: string): string | null =>
  `${code ?? ''}`.match(/^(?:\d{4})?\s*([A-Za-z])/)?.[1].toUpperCase() ?? null

export const questPeriodFromCode = (code: string, resetNote = ''): QuestPeriodKind | null => {
  // 常设任务编码的第 1 位是分类（B/C/F…），第 2 位才是周期。
  // 不能在整串里搜索：例如期间限定编码 2606Bm1 含 m，但不是月常。
  const marker = `${code ?? ''}`[1]?.toLowerCase()
  if (marker === 'd') return 'daily'
  if (marker === 'w') return 'weekly'
  if (marker === 'm') return 'monthly'
  if (marker === 'q') return 'quarterly'
  if (marker === 'y' && questAnnualMonth(resetNote)) return 'annual'
  return null
}

export const questPeriodKey = (
  kind: QuestPeriodKind,
  ts: number,
  annualMonth?: number | null,
): string => {
  const day = resetDay(ts)
  if (kind === 'daily') return `d:${day}`

  const resetDate = new Date(day * DAY)
  if (kind === 'weekly') {
    const daysSinceMonday = (resetDate.getUTCDay() + 6) % 7
    return `w:${day - daysSinceMonday}`
  }

  const year = resetDate.getUTCFullYear()
  const month = resetDate.getUTCMonth()
  if (kind === 'monthly') return `m:${year}-${month}`
  if (kind === 'annual') {
    const resetMonth = annualMonth && annualMonth >= 1 && annualMonth <= 12 ? annualMonth - 1 : null
    if (resetMonth == null) return `y:unknown`
    // 当前周期以最近一次该月 1 日 05:00 JST 为锚；重置月之前仍属于上一年度周期。
    return `y:${month >= resetMonth ? year : year - 1}-${resetMonth}`
  }

  // 季任按 3/6/9/12 月 1 日 05:00 JST 重置。
  const anchor =
    month >= 11 ? [year, 11] : month >= 8 ? [year, 8] : month >= 5 ? [year, 5] : month >= 2 ? [year, 2] : [year - 1, 11]
  return `q:${anchor[0]}-${anchor[1]}`
}
