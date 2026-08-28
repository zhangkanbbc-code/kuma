// 推荐练级（2026-08-12 用户提议）：演习是最稳的练级场，切到演习页时
// 顺手给出「还差几级就能改造」的在籍舰娘，越临近排越前。
//
// 单向改造与双向（可逆）形态切换必须分列：前者是一次性的推进节点，
// 练到就该改；后者只是「到级后可来回换形态」的可选项，混在一起会把
// 「换个形态」误当成练级待办。分类判据复用 remodel.ts 的
// progressiveRemodelOf（可逆转换的回边不算「下一改装」），由调用方注入，
// 本模块保持纯函数便于直接测试。
export interface LevelingInput {
  rosterId: number
  mstId: number
  level: number
  afterShipId: number
  afterLv: number
  /** 当前形态的下一改装是否向更高阶推进（可逆形态切换为 false） */
  progressive: boolean
  /** 下一改装是否已是链上最后一段（口径见 isFinalRemodelTarget，调用方注入） */
  targetFinal?: boolean
  /** 下一改装是否「进阶改造」（口径见 isAdvancedRemodelTarget，调用方注入） */
  advanced?: boolean
  /** 到改造等级还差的总经验（调用方按等级经验表算好；表未就绪为 null） */
  expGap?: number | null
  /** 图鉴收藏（链根口径，调用方判好注入，保持本模块纯函数） */
  favorite?: boolean
}

export interface LevelingRow {
  rosterId: number
  mstId: number
  level: number
  targetMstId: number
  targetLevel: number
  gap: number
  expGap: number | null
  favorite: boolean
  advanced: boolean
}

export interface LevelingGroups {
  oneWay: LevelingRow[]
  reversible: LevelingRow[]
}

// 收藏置顶（2026-08-16 用户提议）：收藏的舰娘在两种排序里都先于未收藏——
// 「想练谁」比「谁最近」优先级更高，组内再按各自口径排。
const byFavorite = (a: LevelingRow, b: LevelingRow) =>
  (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)

// 进阶分组置顶（2026-08-18 用户拍板）：两种排序都是「越便宜越靠前」，
// 低级链尾船（海防/丸ゆ这类一段改到头的）会天然刷屏，把主力舰的改造规划
// 挤到列表深处。进阶改造整组排前，初段速成组排后，组内再按各自口径。
// 收藏仍最优先——「想练谁」压过一切默认分组。
const byAdvanced = (a: LevelingRow, b: LevelingRow) =>
  (b.advanced ? 1 : 0) - (a.advanced ? 1 : 0)

// 同差距时先列等级高的（同样差 3 级，Lv97 的比 Lv27 的更值得进演习队），
// 再按 mstId 稳定排序，避免同名同级的行序随对象枚举顺序抖动。
const byCloseness = (a: LevelingRow, b: LevelingRow) =>
  byFavorite(a, b) || byAdvanced(a, b) || a.gap - b.gap || b.level - a.level || a.mstId - b.mstId

// 按经验差：级差不等价于经验差——Lv97 差 3 级要的经验可能是 Lv30 差 5 级的
// 几十倍。经验算不出（表未就绪）的沉底，同经验再按级差口径稳定排序。
const byExpGap = (a: LevelingRow, b: LevelingRow) =>
  byFavorite(a, b) ||
  byAdvanced(a, b) ||
  (a.expGap ?? Number.POSITIVE_INFINITY) - (b.expGap ?? Number.POSITIVE_INFINITY) ||
  a.gap - b.gap ||
  b.level - a.level ||
  a.mstId - b.mstId

export type LevelingOrder = 'level' | 'exp'

/**
 * 「最终改造筛选」的判据（2026-08-17 用户提议）：下一段改造是不是这条链
 * **最后一段推进**。只有改一的船（多为海外舰，五六十级才改）与临门最终
 * 改二/改三的船算；传统船的早期改一是中间段——正是「按经验」排序里
 * 刷屏的那批低级船——不算。
 *
 * 纯看主数据结构，不维护船名单：从改造目标沿 afterShipId 往后走，
 * - 走不动（再无下一段）→ 目标就是链尾，最终段；
 * - 绕回目标自己 → 目标处在可逆转换环里（翔鶴改二⇄改二甲），环即最终档；
 * - 走到目标之外的新形态（時雨改二后面还有改三）→ 中间段。
 * 步数上限做护栏：主数据异常也不死循环，超限按「判不了」= 非最终段处理。
 */
export const isFinalRemodelTarget = (
  targetMstId: number,
  afterShipIdOf: (mstId: number) => number,
): boolean => {
  const seen = new Set<number>([targetMstId])
  let current = targetMstId
  for (let step = 0; step < 32; step++) {
    const next = afterShipIdOf(current)
    if (!(next > 0) || next === current) return seen.size === 1
    if (seen.has(next)) return next === targetMstId
    seen.add(next)
    current = next
  }
  return false
}

/**
 * 改造段位图（2026-08-18「进阶改造分组」的输入）：形态 mstId → 链上第几段
 * 改造目标（改=1、改二=2、丁/改三=3…；链根本身不在图里）。
 * 链根 = 没有任何形态指向它的形态；从每个链根沿 afterShipId 正向数段，
 * 可逆转换环里的形态按「进环那一段」计。反向回溯在环上会断，所以只做正向。
 */
export const buildRemodelStageMap = (
  ships: { id: number; afterId: number }[],
): Map<number, number> => {
  const pointedTo = new Set<number>()
  for (const ship of ships) {
    if (ship.afterId > 0 && ship.afterId !== ship.id) pointedTo.add(ship.afterId)
  }
  const afterOf = new Map(ships.map((ship) => [ship.id, ship.afterId]))
  const stages = new Map<number, number>()
  for (const ship of ships) {
    if (pointedTo.has(ship.id)) continue // 非链根
    let current = ship.id
    let stage = 0
    const seen = new Set<number>([current])
    for (let step = 0; step < 32; step++) {
      const next = afterOf.get(current) ?? 0
      if (!(next > 0) || next === current || seen.has(next)) break
      stage++
      if (!stages.has(next)) stages.set(next, stage)
      seen.add(next)
      current = next
    }
  }
  return stages
}

/**
 * 「进阶改造」判据（2026-08-18 用户拍板的分组口径）：
 * - 目标是链上第二段及以上（改二/改三/丁/甲…）——传统主力船的关键改造；或
 * - 目标虽是第一段但已是链尾、且改造等级 ≥45——「海外只有改一、五六十级才改」
 *   那批（Warspite改 Lv75、Iowa改 Lv50…），与最初「最终改造筛选」的保留口径一致。
 * 纯主数据结构信号，不维护主观强度名单——所以 Lv50 的伊41改与 Lv50 的 Iowa改
 * 分不开、Lv45+ 的高级海防舰改也会算进阶，这是口径的已知代价。
 */
export const isAdvancedRemodelTarget = (
  targetMstId: number,
  afterLv: number,
  stageOf: Map<number, number>,
  afterShipIdOf: (mstId: number) => number,
): boolean =>
  (stageOf.get(targetMstId) ?? 0) >= 2 ||
  (afterLv >= 45 && isFinalRemodelTarget(targetMstId, afterShipIdOf))

export const levelingGroups = (
  ships: LevelingInput[],
  orderBy: LevelingOrder = 'level',
  opts: { finalOnly?: boolean } = {},
): LevelingGroups => {
  const oneWay: LevelingRow[] = []
  const reversible: LevelingRow[] = []
  for (const ship of ships) {
    // 没有下一改装的最终形态不进列表
    if (ship.afterShipId <= 0 || ship.afterLv <= 0) continue
    const gap = ship.afterLv - ship.level
    // 已到级的不是「练级」目标——那是改造素材/图纸的事，缺口另有面板管
    if (gap <= 0) continue
    // 最终改造筛选：目标是中间段的不列（口径见 isFinalRemodelTarget）
    if (opts.finalOnly && !ship.targetFinal) continue
    const row: LevelingRow = {
      rosterId: ship.rosterId,
      mstId: ship.mstId,
      level: ship.level,
      targetMstId: ship.afterShipId,
      targetLevel: ship.afterLv,
      gap,
      expGap: ship.expGap ?? null,
      favorite: ship.favorite ?? false,
      advanced: ship.advanced ?? false,
    }
    ;(ship.progressive ? oneWay : reversible).push(row)
  }
  const compare = orderBy === 'exp' ? byExpGap : byCloseness
  oneWay.sort(compare)
  reversible.sort(compare)
  return { oneWay, reversible }
}
