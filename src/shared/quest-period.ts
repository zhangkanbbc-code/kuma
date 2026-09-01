export type QuestPeriodKind = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

const DAY = 86_400_000
// 先转 JST（+9h），再减去 05:00：这样 UTC 日界线正好就是游戏的日重置线。
const RESET_SHIFT = 4 * 3_600_000
const resetDay = (ts: number) => Math.floor((ts + RESET_SHIFT) / DAY)
// resetDay 的逆运算：日序号 → 开启那一期的 05:00 JST 真实时刻
const resetDayStart = (day: number) => day * DAY - RESET_SHIFT
// 某年某月 1 日 05:00 JST（月 / 季 / 年三种周期的重置点都长这样）
const resetMonthStart = (year: number, month: number) => Date.UTC(year, month, 1) - RESET_SHIFT

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

/**
 * 该时刻所属周期的**起点**——游戏上一次重置这个任务的真实时刻（epoch 毫秒）。
 * 重置时刻全是 05:00 JST：日任每天、周任周一、月任每月 1 日、
 * 季任 3/6/9/12 月 1 日、年任其重置月 1 日。
 *
 * 年任的重置月无从得知时返回 null——「定位不到周期」和「周期起点是某某时刻」
 * 是两回事，不许拿一个兜底时刻冒充（questPeriodKey 的 `y:unknown` 同一态度）。
 *
 * 周期起点比「这一期落在哪个月」有用得多：跨月界的那几小时里，
 * 「已完成」到底算哪个月的，只有拿起点跟月界比才判得准（见 shared/senka）。
 */
export const questPeriodStart = (
  kind: QuestPeriodKind,
  ts: number,
  annualMonth?: number | null,
): number | null => {
  const day = resetDay(ts)
  if (kind === 'daily') return resetDayStart(day)

  const resetDate = new Date(day * DAY)
  if (kind === 'weekly') {
    const daysSinceMonday = (resetDate.getUTCDay() + 6) % 7
    return resetDayStart(day - daysSinceMonday)
  }

  const year = resetDate.getUTCFullYear()
  const month = resetDate.getUTCMonth()
  if (kind === 'monthly') return resetMonthStart(year, month)
  if (kind === 'annual') {
    const resetMonth = annualMonth && annualMonth >= 1 && annualMonth <= 12 ? annualMonth - 1 : null
    if (resetMonth == null) return null
    // 当前周期以最近一次该月 1 日 05:00 JST 为锚；重置月之前仍属于上一年度周期。
    return resetMonthStart(month >= resetMonth ? year : year - 1, resetMonth)
  }

  // 季任按 3/6/9/12 月 1 日 05:00 JST 重置。
  const anchor =
    month >= 11 ? [year, 11] : month >= 8 ? [year, 8] : month >= 5 ? [year, 5] : month >= 2 ? [year, 2] : [year - 1, 11]
  return resetMonthStart(anchor[0], anchor[1])
}

/**
 * 该时刻所属周期的**终点**——下一期的起点（左闭右开，`[start, end)`）。
 *
 * 起点解不出来（年任重置月未知）时同样返回 null：一头定不下来，区间就不成立。
 * 月/季/年三种都用 `resetMonthStart` 直接跨月算，`Date.UTC` 自己会把
 * 「12 月 +3」进位成次年 3 月，不必手写年份进位。
 *
 * 有了区间才谈得上「同一期只算一次」：判两笔账在不在同一期，
 * 拿区间去框比拿键面字符串比更直接，也省得账本把键存进去（见 shared/senka-quest-book）。
 */
export const questPeriodEnd = (
  kind: QuestPeriodKind,
  ts: number,
  annualMonth?: number | null,
): number | null => {
  const start = questPeriodStart(kind, ts, annualMonth)
  if (start == null) return null
  if (kind === 'daily') return start + DAY
  if (kind === 'weekly') return start + 7 * DAY
  const date = new Date(start + RESET_SHIFT)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  if (kind === 'monthly') return resetMonthStart(year, month + 1)
  if (kind === 'annual') return resetMonthStart(year + 1, month)
  return resetMonthStart(year, month + 3)
}

/**
 * 周期标识：同一期算出来是同一个字符串。
 * 键面直接从 questPeriodStart 的结果格式化——重置时刻的算术只留那一份，
 * 「键」与「起点」不会各自漂移。
 */
export const questPeriodKey = (
  kind: QuestPeriodKind,
  ts: number,
  annualMonth?: number | null,
): string => {
  const start = questPeriodStart(kind, ts, annualMonth)
  if (start == null) return `y:unknown`
  if (kind === 'daily') return `d:${(start + RESET_SHIFT) / DAY}`
  if (kind === 'weekly') return `w:${(start + RESET_SHIFT) / DAY}`
  const date = new Date(start + RESET_SHIFT)
  const stamp = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
  if (kind === 'monthly') return `m:${stamp}`
  if (kind === 'annual') return `y:${stamp}`
  return `q:${stamp}`
}
