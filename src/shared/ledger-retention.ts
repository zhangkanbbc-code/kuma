// 主账本的「记录保留与清理」判据。**只有这一份说得出哪张表会被删。**
//
// ---- 日期自动清理整个退役（2026-08-23 用户拍板）----
// 他的原话：「我说的可不止配音，包括所有本来设定了日期自动清理的部分」。
// 语音「官方没有」台账那条裁定（见 shared/voice-probe-plan 的「90 天自动过期退役」）
// 在同一天推广到主账本：**带日期的事实永久记着，清理权归玩家。**
//
// 这里原先是两个写死的常量：`RETENTION_DAYS = 90`（events / material_log /
// material_delta / battle_snapshots 每天定时 DELETE）与 `NOTIFY_RETENTION_DAYS = 14`
//（通知历史）。它们与档案上限那一处的设计正好相反——档案 2026-08-23 起就是
//「默认不限量，设了才淘汰」，而账本这边不问自取地每天删一遍。现在两边对齐：
// **不设保留期就一行都不删**，想要自动清理是玩家自己填一个天数。
//
// ---- 边界：哪些表**永远**不在清理范围内 ----
// 遭遇志、精矿类（舰娘人生、道具履历、装备实测…）、活动履历一律永久。
// 它们本来就不在旧 prune 的范围里，这次也一格都不许扩进来——那些表存的是
// 「原始报文过期之后仍然留得下的结论」，删掉就再也算不回来。
// 判据写成**白名单**而不是黑名单：新加一张表时默认不被删，而不是默认被删。

import { localMonthOf, localMonthRange, localMonthsBetween } from './local-calendar'

/**
 * 会被清理碰到的滚动表。**清理路径只认这四张**（自动清理、按月清理都是）。
 * 顺序即界面与执行顺序，别乱动（护栏按它逐张比对）。
 */
export const LEDGER_ROLLING_TABLES = [
  'events',
  'material_log',
  'material_delta',
  'battle_snapshots',
] as const

/**
 * 通知历史。跟随同一个保留期设置**自动**清理，但不进按月分组——
 * 它在铃里有自己的「清空历史」钮，玩家找它是去铃里找，不是来钥里按月挑。
 */
export const LEDGER_NOTIFY_TABLE = 'notify_log'

/**
 * 永久表。**任何清理路径都不许出现它们**，护栏逐个比对这张名单。
 * 写全名而不是写「其余都不删」：漏了一张就是静默地把玩家的精矿删掉，
 * 而界面上要过很久才看得出来。
 */
export const LEDGER_PERMANENT_TABLES = [
  'encounters',
  'node_samples',
  'sortie_samples',
  'routes',
  'friendly_fleets',
  'useitem_log',
  'senka_log',
  'senka_state',
  'quest_progress',
  'pay_log',
  'expedition_history',
  'ship_life_state',
  'ship_life_events',
  'event_archive',
  'event_map_catalog',
  'fit_observations',
] as const

/** 保留天数的上限（10 年）。填得再大也没有意义，且要挡住 1e18 那种输入。 */
export const LEDGER_RETENTION_DAYS_MAX = 3650

/**
 * 界面/配置里读到的保留天数落成一个能用的数。
 * **0 = 不限**（默认，也是空框、负数、乱填的归宿）——与档案上限那一处同一条判据：
 * 那边 0 也是「不设上限」，两处落到同一个行为上才不会因为写法差异变成会删。
 */
export const clampLedgerRetentionDays = (raw: unknown): number => {
  const days = Math.floor(Number(raw))
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.min(days, LEDGER_RETENTION_DAYS_MAX)
}

/** 一条删除指令：把 `table` 里落在 `[from, to)` 的行删掉。 */
export interface LedgerDelete {
  table: string
  from: number
  to: number
}

/**
 * 每日自动清理该删些什么。**没设保留期就是空数组——一行都不删。**
 *
 * ⚠️ 空数组是这个函数最要紧的返回值。写成「保留期缺省按 90 天」之类的兜底，
 * 口径就悄悄倒回去了，而界面上一模一样。
 *
 * @param retentionDays 玩家设的保留天数（0 = 不限）。
 */
export const planLedgerPrune = (input: {
  retentionDays: unknown
  now: number
}): LedgerDelete[] => {
  const days = clampLedgerRetentionDays(input.retentionDays)
  if (!days) return []
  const now = Number(input.now)
  if (!Number.isFinite(now) || now <= 0) return []
  const cutoff = now - days * 86_400_000
  if (cutoff <= 0) return []
  // 通知历史跟随同一个设置（它原先是单独的 14 天，那条也一并退役）
  return [...LEDGER_ROLLING_TABLES, LEDGER_NOTIFY_TABLE].map((table) => ({
    table,
    from: 0,
    to: cutoff,
  }))
}

/**
 * 「清理某一月」该删些什么。月份形状不对就是空数组——**一行都不删**
 *（宁可什么都没发生，也不要「点了清理，结果清掉了别的月」）。
 *
 * 通知历史不在其中：按月分组只数那四张滚动表，删的也只有它们。
 */
export const planLedgerMonthClear = (month: string): LedgerDelete[] => {
  const range = localMonthRange(month)
  if (!range) return []
  return LEDGER_ROLLING_TABLES.map((table) => ({ table, from: range.from, to: range.to }))
}

export interface LedgerMonthCount {
  /** 本地年月，`YYYY-MM` */
  month: string
  /** 那四张滚动表在这个月里一共多少行 */
  count: number
}

/**
 * 账本里覆盖到的月份，**新月在前**。两端由调用方从 `MIN(ts)` / `MAX(ts)` 取。
 * 逐月的行数另外数（按月按表 COUNT，ts 上有索引）。
 */
export const ledgerMonthsCovered = (minTs: number, maxTs: number): string[] =>
  localMonthsBetween(minTs, maxTs)

/**
 * 逐月行数收尾：合并同月、**丢掉 0 行的月**、新月在前。
 *
 * 0 行的月要丢：账本中间空一段（那阵子没玩）时，界面上摆一排「2026-03 · 0 条 [清理]」
 * 是一排点了什么都不会发生的钮。
 */
export const foldLedgerMonthCounts = (
  rows: readonly LedgerMonthCount[] | null | undefined,
): LedgerMonthCount[] => {
  const counts = new Map<string, number>()
  for (const row of rows ?? []) {
    const month = `${row?.month ?? ''}`
    const count = Number(row?.count)
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(count) || count <= 0) continue
    counts.set(month, (counts.get(month) ?? 0) + Math.floor(count))
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((left, right) => (left.month < right.month ? 1 : left.month > right.month ? -1 : 0))
}

/** 这个时刻归哪一个月（本地日历）。与语音台账那边同一份换算。 */
export const ledgerMonthOf = (at: number): string => localMonthOf(at)
