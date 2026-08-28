// 战果（戦果）的换算与固定分值表。
//
// 游戏 API **不下发战果数值**——它只在游戏内的排名页出现，由服务器算。
// 但 wikiwiki「称号・戦果」给出了明确公式，而公式的输入（提督经验）API 是给的：
//
//   通常戦果 = 该月获得的提督经验 × 7 / 10000
//
// 所以「通常戦果」不是推算，是换算；而 EO 与任务的「特別戦果」是固定分值表。
// 两者性质不同，展示时必须分开——一个是算出来的，一个是查表来的。

/** 通常战果：每点提督经验折算多少战果。 */
export const SENKA_PER_EXP = 7 / 10000

export const senkaFromExp = (expDelta: number): number =>
  expDelta > 0 ? expDelta * SENKA_PER_EXP : 0

/**
 * EO（月度重置的额外作战）海域击破的固定战果。
 * 键是海域 id（区 × 10 + 图号），与 mapIdOf 一致。
 *
 * 分值 2026-08-17 对 wikiwiki「称号・戦果」特別戦果一覧逐行核对：
 * 修正了三处旧错——7-5 是 170（原误写 300）、1-6 的 75 与 5-6 的 225 原先缺失。
 * 7-5 虽有两段血条，但表上不分段、整图击破一笔 170。
 */
export const EO_SENKA: Record<number, number> = {
  15: 75, // 1-5
  16: 75, // 1-6
  25: 100, // 2-5
  35: 150, // 3-5
  45: 180, // 4-5
  55: 200, // 5-5
  56: 225, // 5-6
  65: 250, // 6-5
  75: 170, // 7-5
}

/**
 * 战果月的边界：**前月末 22:00 ～ 当月末 21:59（JST）**。
 *
 * 不是自然月——月末那两个小时算下个月。跨月统计若按自然月切，
 * 每个月头尾都会各错一段。
 */
export const senkaMonthStart = (at: number): number => {
  // 「某月最后一天 22:00 JST」= 下个月 1 日 00:00 JST 往前推 2 小时
  const endOf = (year: number, month: number) =>
    Date.UTC(year, month + 1, 1, 0, 0, 0) - 9 * 3600 * 1000 - 2 * 3600 * 1000
  const jst = new Date(at + 9 * 3600 * 1000)
  const year = jst.getUTCFullYear()
  const month = jst.getUTCMonth()
  // 从近到远取第一个不晚于 at 的边界。必须先试**本月末**：
  // 月末 22:00 之后已经算下个月了，只往前找会把这两小时错记到本月。
  for (const candidate of [endOf(year, month), endOf(year, month - 1), endOf(year, month - 2)]) {
    if (at >= candidate) return candidate
  }
  return endOf(year, month - 2)
}

/**
 * 战果月的月份标签「YYYY-MM」（JST 口径）。
 *
 * 月界落在**前月末 22:00**，直接看月界那一刻会得到上个月——
 * +9h 换成 JST、再 +3 天稳落主体月（月界后最多差 2 小时，3 天绰绰有余、
 * 又不会越过最短的 2 月）。
 * 「这是哪个月的战果」全仓只此一份：锱的战果卡抬头、战果详情抬头、
 * 以及下面判周期重置的月份都从这里取。
 */
export const senkaMonthLabel = (monthStart: number): string =>
  new Date(monthStart + 9 * 3600 * 1000 + 3 * 24 * 3600 * 1000).toISOString().slice(0, 7)

/** 该时刻所属战果月的**结束**边界（即下一个月界）。查历史月账目时当上界用。 */
export const senkaMonthEnd = (at: number): number => {
  // 月界起点 + 32 天必然落进下一个战果月，取它的起点即本月终点
  return senkaMonthStart(senkaMonthStart(at) + 32 * 24 * 3600 * 1000)
}

/**
 * 继承战果（引き継ぎ戦果）。wikiwiki「称号・戦果」原文（2026-08-17 核对）：
 *   引き継ぎ戦果 = [当年1月1日00:00～当年前月末21:59に得た提督経験値] / 50000
 *               + (当年前月作戦の特別戦果 / 35)
 * 「当年」按前月所在的自然年——1 月作战的窗口是去年整年（前月=去年 12 月）。
 */
export const CARRY_EXP_DIVISOR = 50000
export const CARRY_SPECIAL_DIVISOR = 35

export interface SenkaCarryWindows {
  /** 经验累计窗口起点：前月所在 JST 年的 1 月 1 日 00:00 */
  yearStart: number
  /** 前月战果月的起点（前前月末 22:00 JST） */
  prevMonthStart: number
  /** 本战果月起点 = 经验窗口与前月特别战果窗口的共同终点 */
  monthStart: number
}

export const senkaCarryWindows = (at: number): SenkaCarryWindows => {
  const monthStart = senkaMonthStart(at)
  // monthStart（前月末 22:00 JST）落在哪个 JST 年，前月就在哪年
  const jstYear = new Date(monthStart + 9 * 3600 * 1000).getUTCFullYear()
  const yearStart = Date.UTC(jstYear, 0, 1) - 9 * 3600 * 1000
  return { yearStart, prevMonthStart: senkaMonthStart(monthStart - 1), monthStart }
}

/**
 * 自检补记的资格（2026-08-17 用户纠正后的口径）：任务判成「已完成」只说明
 * **本期**交付过，而季任/年任的一期跨好几个月——「本期完成」定位不到
 * 「本战果月完成」。只有该任务的周期在本战果月里刚重置过，二者才必然重合：
 * - 月任及更短周期：每月都重置 → 永远可定位
 * - 季任：3 / 6 / 9 / 12 月（周期首月）才行
 * - 年任：只有它自己的重置月当月
 * 其余月份即便「已完成」也不列——那可能是本期更早月份交付的，靠实际校准兜底。
 */
export const senkaQuestPeriodStartsInMonth = (
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual',
  monthStart: number,
  annualMonth?: number | null,
): boolean => {
  // 战果月的主体月份取自 senkaMonthLabel（「YYYY-MM」的后两位就是 1–12）——
  // 「+9h +3d」的算术只留那一份，别在这里再抄一遍
  const month = Number(senkaMonthLabel(monthStart).slice(5))
  if (kind === 'daily' || kind === 'weekly' || kind === 'monthly') return true
  if (kind === 'quarterly') return month === 3 || month === 6 || month === 9 || month === 12
  return annualMonth != null && month === annualMonth
}

export interface SenkaCarry {
  total: number
  fromExp: number // 经验部分（÷50000）
  fromSpecial: number // 前月特别战果部分（÷35）
  expWindowFrom: number // 经验窗口起点（当年 1/1 JST）
  /** 记账是否覆盖了整个经验窗口——不满整年时数值偏低，展示端要说清 */
  complete: boolean
}

export interface SenkaEntry {
  ts: number
  kind: 'exp' | 'eo' | 'quest'
  /** kind='exp' 时的提督经验增量 */
  expDelta: number
  /** 该笔折算/查表得到的战果 */
  senka: number
  note: string
}

/**
 * 明细的 IPC 载荷上限（2026-08-17 实锤修正）：以前裸 slice(0,300) 按时间倒序砍，
 * 半个月就能攒 300+ 条经验行，把 8/9 的 EO 行挤出列表——渲染端拿截断表判
 * 「本月记没记过」，于是把早就入账的 EO 报成漏记。经验行只用于明细展示，
 * EO/任务行却是「记没记过」的判据——**砍只砍经验行，EO/任务行一条不丢**。
 */
export const capSenkaEntries = (entries: SenkaEntry[], cap = 300): SenkaEntry[] => {
  if (entries.length <= cap) return entries
  const keep = entries.filter((entry) => entry.kind !== 'exp')
  const expBudget = Math.max(0, cap - keep.length)
  const exp = entries
    .filter((entry) => entry.kind === 'exp')
    .sort((left, right) => right.ts - left.ts)
    .slice(0, expBudget)
  return [...keep, ...exp].sort((left, right) => right.ts - left.ts)
}

/**
 * 游戏每月 1 日 05:00 JST 重置 EO 血条与 cleared 位。
 * 战果月起点是前月末 22:00 JST，+2h 到当月 1 日 00:00 JST，再 +5h 即重置点。
 * 重置点之后观测到 cleared=1，击破必然发生在重置之后 → 必属本战果月。
 */
export const eoMonthResetTs = (monthStart: number): number => monthStart + 7 * 3600 * 1000

/**
 * 从海域页（mapinfo）观测流水里找每张 EO 图在窗口内的**首次**击破观测。
 * 输入是按时间升序的观测（ts + 该次观测里 cleared=1 的图 id 列表）；
 * 窗口外的观测不作数——重置点之前的 cleared 可能是上月旧状态。
 */
export const firstEoClearObservations = (
  observations: readonly { ts: number; cleared: readonly number[] }[],
  fromTs: number,
  toTs: number,
): Map<number, number> => {
  const first = new Map<number, number>()
  for (const observation of observations) {
    if (observation.ts < fromTs || observation.ts >= toTs) continue
    for (const mapId of observation.cleared) {
      if (EO_SENKA[mapId] && !first.has(mapId)) first.set(mapId, observation.ts)
    }
  }
  return first
}

export interface SenkaSummary {
  monthStart: number
  /** 有记录的起点——账本从哪一刻开始记，早于此的战果这里没有 */
  recordedFrom: number | null
  normal: number
  special: number
  /** 继承（引き継ぎ）：按公式由账本算出；账本完全没记到窗口内数据时为 null */
  carry: SenkaCarry | null
  /** normal + special + (carry?.total ?? 0) */
  total: number
  /**
   * 实际校准（2026-08-17 用户提议）：玩家在游戏排名页看到自己的官方战果后
   * 手动填入，此后显示 = 校准值 + 校准时刻之后的账内新增。
   * 排名报文是加密的，官方值只能人眼读、手动进来；过战果月自动失效。
   */
  calibration: {
    value: number // 手填的官方值
    ts: number // 校准时刻
    gainedSince: number // 校准之后账内新增
    current: number // value + gainedSince
  } | null
  entries: SenkaEntry[]
}

/**
 * 从任务奖励文本里解析**固定**给的战果。
 *
 * kcwiki 的 memo 有三种写法：「80战果」「战果×350」「战果+200」，都收。
 * 但只认「奖励:」之后、第一个「以下奖励」之前那一段——再往后是选择奖励，
 * 玩家未必选战果（B170 的战果 800 就跟 FR-1 Fireball 二选一），
 * 自动记账不能替他做主。解析不出就返回 null，不猜。
 */
export const questFixedSenka = (memo: string | null | undefined): number | null => {
  const text = `${memo ?? ''}`
  const at = text.indexOf('奖励')
  if (at < 0) return null
  const optionAt = text.indexOf('以下奖励', at)
  const head = optionAt >= 0 ? text.slice(at, optionAt) : text.slice(at)
  const match = head.match(/(\d+)\s*战果/) ?? head.match(/战果\s*[×xX*+]\s*(\d+)/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}
