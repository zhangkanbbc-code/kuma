export interface SenkaCalendarCell {
  day: string
  date: number
  gain: number
  rank: number | null
  rankDelta: number | null
  future: boolean
  today: boolean
}

export interface SenkaCalendar {
  month: string
  label: string
  weeks: (SenkaCalendarCell | null)[][]
  total: number
  latestRank: number | null
  maxGain: number
}

export interface SenkaCalendarModel extends SenkaCalendar {
  canPrev: boolean
  canNext: boolean
}

export const senkaDailyGains = (entries: readonly { ts: number; senka: number }[]): Record<string, number> => {
  const gains: Record<string, number> = {}
  for (const entry of entries) {
    const day = new Date(entry.ts + 9 * 3600_000).toISOString().slice(0, 10)
    gains[day] = (gains[day] ?? 0) + entry.senka
  }
  return gains
}

export const buildSenkaCalendar = ({ month, gains, ranks, today }: {
  month: string
  gains: Record<string, number>
  ranks: readonly { day: string; rank: number }[]
  today: string
}): SenkaCalendar => {
  const [year, monthNumber] = month.split('-').map(Number)
  const byDay = new Map<string, { rank: number; rankDelta: number | null }>()
  let previous: number | null = null
  for (const { day, rank } of [...ranks].sort((a, b) => a.day.localeCompare(b.day))) {
    // day 已按排行刷新时刻归入 JST 日期；升降只与同一自然月内更早的名次比较。
    if (day.slice(0, 7) !== month) continue
    byDay.set(day, { rank, rankDelta: previous == null ? null : previous - rank })
    previous = rank
  }
  const cells: (SenkaCalendarCell | null)[] = Array((new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7).fill(null)
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  let total = 0
  let maxGain = 0
  let latestRank: number | null = null
  for (let date = 1; date <= days; date++) {
    const day = `${month}-${String(date).padStart(2, '0')}`
    const future = day > today
    const gain = gains[day] ?? 0
    const ranking = future ? undefined : byDay.get(day)
    total += gain
    maxGain = Math.max(maxGain, gain)
    if (ranking) latestRank = ranking.rank
    cells.push({ day, date, gain: future ? 0 : gain, rank: ranking?.rank ?? null,
      rankDelta: ranking?.rankDelta ?? null, future, today: day === today })
  }
  while (cells.length % 7) cells.push(null)
  const weeks: SenkaCalendar['weeks'] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return { month, label: `${year}年${monthNumber}月`, weeks, total, latestRank, maxGain }
}
