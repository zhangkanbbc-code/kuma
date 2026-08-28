// 本地日历：时间戳 → 玩家那台机器上的年月日，以及某一个月的起止。
//
// ---- 为什么单独一份（2026-08-23）----
// 「所有日期自动清理退役」那一批同时要两处按月分组（语音「官方没有」台账、
// 主账本那四张滚动表），两处都要「本地年月」。各写各的必然分叉：
// 一边用 `getMonth()` 一边用 `toISOString().slice(0,7)`，同一天点两个清理钮
// 会落在两个不同的月上，而界面上看不出任何区别。
//
// ---- 为什么是本地不是 JST、也不是 UTC ----
// 这两处的日期都是**玩家自己按下鼠标的那一天**（探测发生的时刻、记账发生的时刻），
// 他读的是自己的日历。换算成 JST 会让「我昨天点的」对不上界面上写的那一天。
// ⚠️ 与 shared/jst-day 是两回事，别混：那一份管的是**游戏的自然日**
//（任务重置、战果月），那种日期归 JST，不归玩家所在时区。

const pad2 = (value: number): string => `${value}`.padStart(2, '0')

const validDate = (at: unknown): Date | null => {
  const ms = Number(at)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const day = new Date(ms)
  return Number.isNaN(day.getTime()) ? null : day
}

/** 本地日历的那一天，`YYYY-MM-DD`。时间戳不成形（0、NaN、负数）时给空串。 */
export const localDayOf = (at: number): string => {
  const day = validDate(at)
  return day ? `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}` : ''
}

/** 本地日历的那一个月，`YYYY-MM`。同上，读不出给空串——不编一个日期出来。 */
export const localMonthOf = (at: number): string => localDayOf(at).slice(0, 7)

/**
 * 本地日历那一天的 00:00（毫秒）。逐日聚合、按日切曲线都用这一把尺。
 * `setHours(0,0,0,0)` 而不是「取整到 86400000 的倍数」：后者在夏令时切换那天差一小时。
 */
export const localDayStart = (at: number): number => {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/**
 * 当前时区相对 UTC 的偏移（毫秒；东八区 = +8h = 28800000）。
 *
 * 只给 **SQL 侧换算日号**用：SQLite 里没有等价于 `setHours(0,0,0,0)` 的写法，
 * 逐日分组只能写成 `(ts + 偏移) / 86400000` 的整除。
 * ⚠️ 这条换算的前提是**偏移在整段查询区间里恒定**——中国/日本无夏令时，成立；
 * 换到有夏令时的时区，切换那一天的日界会差一小时（与 localDayStart 不再同尺）。
 * JS 侧一律用 localDayStart，别拿这个偏移在渲染层再算一遍日界。
 */
export const localDayOffsetMs = (at: number = Date.now()): number =>
  -new Date(at).getTimezoneOffset() * 60000

/**
 * 一个月覆盖的时刻区间 `[from, to)`（本地日历）。月份形状不对时给 null。
 *
 * 用 `new Date(year, month, 1)` 而不是拼字符串：夏令时切换那两个月里
 * 一天不是 86400 秒，按天数乘出来的边界会差一小时——正好把月末最后一小时的行
 * 漏在清理之外（或者把下个月的头一小时一起清掉）。
 */
export const localMonthRange = (month: string): { from: number; to: number } | null => {
  const matched = /^(\d{4})-(\d{2})$/.exec(`${month ?? ''}`)
  if (!matched) return null
  const year = Number(matched[1])
  const index = Number(matched[2]) - 1
  if (index < 0 || index > 11) return null
  return {
    from: new Date(year, index, 1).getTime(),
    to: new Date(year, index + 1, 1).getTime(),
  }
}

/** 一次最多枚举多少个月。防的是时间戳坏成 1 或者未来某个天文数字时铺出几万行。 */
export const LOCAL_MONTHS_MAX = 600

/**
 * 从最早到最晚覆盖到的那些月份，**新月在前**。
 * 两端读不出、或者次序反了就给空数组（不猜，也不自作主张对调）。
 */
export const localMonthsBetween = (minAt: number, maxAt: number): string[] => {
  const first = validDate(minAt)
  const last = validDate(maxAt)
  if (!first || !last || first.getTime() > last.getTime()) return []
  const out: string[] = []
  const cursor = new Date(last.getFullYear(), last.getMonth(), 1)
  const stop = new Date(first.getFullYear(), first.getMonth(), 1).getTime()
  while (cursor.getTime() >= stop && out.length < LOCAL_MONTHS_MAX) {
    out.push(`${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`)
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return out
}
