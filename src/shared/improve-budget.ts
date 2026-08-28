// 改修预算：把分档消耗摊成「从 ★N 推到满还要多少」的累计账。
//
// 装备详情本来只列分档单价（★0-5 一档、★6-9 一档、更新一档），
// 玩家要自己乘次数再相加，才知道「这门炮推满到底要几根同款、多少改修资材」。
//
// 资材列的语义（2026-08-12 对 wikiwiki 改修表原表头钉死，用户抓的实锤）：
// 「必要資材(通常/確実)」——x/y 是**通常单价**与**确保化(必成)单价**两种打法，
// 不是浮动范围。此前界面把它标成「48~62 范围」是错的：
//   · 通常侧 = 赌脸单价，且**不含失败重打**——每档成功率没有权威资料
//     （wikiwiki 只说 ★ 越高越低、★6 起建议确保），期望次数造不出来，不造；
//   · 确保侧 = 全程确保化的**确定**消耗，必成，是真正可执行的封顶预算。
export interface ImproveStageCost {
  devmats?: number
  devmats_sli?: number // _sli = 確実化（EO 字段名）；缺省时与通常同值
  screws?: number
  screws_sli?: number
  equips?: { id: number; eq_count: number }[]
  consumable?: { id: number; eq_count: number }[]
}

export interface ImproveCosts {
  p1?: ImproveStageCost
  p2?: ImproveStageCost
  conv?: ImproveStageCost
  fuel?: number
  ammo?: number
  steel?: number
  baux?: number
}

/** 一笔「通常/确保」双单价的累计。normal ≤ certain（资料如此，代码不假定）。 */
export interface CostPair {
  /** 通常打法的合计——假定每次都成功，不含失败重打 */
  normal: number
  /** 全程确保化的合计——必成，确定值 */
  certain: number
}

export interface ImproveBudget {
  /** 起点星级 */
  from: number
  /** 用 p1 档的次数（★0-5 区间） */
  p1Times: number
  /** 用 p2 档的次数（★6-9 区间） */
  p2Times: number
  devmats: CostPair
  screws: CostPair
  /** 同款装备消耗：装备 mstId → 件数 */
  equips: Map<number, number>
  consumables: Map<number, number>
  fuel: number
  ammo: number
  steel: number
  baux: number
}

/** 改修上限。★0…★9 共 10 次改修到满。 */
export const IMPROVE_MAX = 10

const addPair = (
  into: CostPair,
  normal: number | undefined,
  certain: number | undefined,
  times: number,
) => {
  const a = normal ?? 0
  // 资料只给一个值时，确保侧退化成同值
  const b = certain ?? a
  into.normal += Math.min(a, b) * times
  into.certain += Math.max(a, b) * times
}

const addCounts = (into: Map<number, number>, list: { id: number; eq_count: number }[] | undefined, times: number) => {
  for (const entry of list ?? []) {
    if (!(entry?.id > 0) || !(entry.eq_count > 0)) continue
    into.set(entry.id, (into.get(entry.id) ?? 0) + entry.eq_count * times)
  }
}

/**
 * 从 ★from 推到 ★{@link IMPROVE_MAX} 的累计消耗。
 *
 * 分档口径直接沿用包内标注：`p1` 标「★0-5」、`p2` 标「★6-9」，
 * 即**按当前星级落在哪一档**收费，于是 ★0 起手是 6 次 p1 + 4 次 p2 共 10 次。
 * 这是资料自己的划分，不是这里推的；界面必须把次数摆出来让玩家能核对，
 * 别只给一个合计数字。
 *
 * 不含「更新」（conv）——那是推满之后另一回事，要不要更新是玩家的选择。
 */
export const improveBudgetTo = (costs: ImproveCosts | null | undefined, from: number): ImproveBudget => {
  const start = Math.max(0, Math.min(IMPROVE_MAX, Math.floor(from)))
  const p1Times = Math.max(0, Math.min(6, 6 - start))
  const p2Times = Math.max(0, IMPROVE_MAX - Math.max(start, 6))
  const budget: ImproveBudget = {
    from: start,
    p1Times,
    p2Times,
    devmats: { normal: 0, certain: 0 },
    screws: { normal: 0, certain: 0 },
    equips: new Map(),
    consumables: new Map(),
    fuel: 0,
    ammo: 0,
    steel: 0,
    baux: 0,
  }
  const stages: [ImproveStageCost | undefined, number][] = [
    [costs?.p1, p1Times],
    [costs?.p2, p2Times],
  ]
  for (const [stage, times] of stages) {
    if (!stage || times <= 0) continue
    addPair(budget.devmats, stage.devmats, stage.devmats_sli, times)
    addPair(budget.screws, stage.screws, stage.screws_sli, times)
    addCounts(budget.equips, stage.equips, times)
    addCounts(budget.consumables, stage.consumable, times)
  }
  const runs = p1Times + p2Times
  budget.fuel = (costs?.fuel ?? 0) * runs
  budget.ammo = (costs?.ammo ?? 0) * runs
  budget.steel = (costs?.steel ?? 0) * runs
  budget.baux = (costs?.baux ?? 0) * runs
  return budget
}

/**
 * 「推满**再更新**」那条整路线的总账 —— 在 {@link improveBudgetTo} 之上加**一次**更新。
 *
 * 为什么另开一个而不是改 improveBudgetTo：推满与更新是两个决定，
 * 「推到 ★max」的预算不该被更新的消耗污染（没有更新目标的装备也要算这一笔）。
 * 但对**有更新目标**的装备，玩家心里的那笔账就是整条路线的合计
 *（2026-08-25 用户手算夜間瑞雲那条路线时，开发资材 152/240 正是 120/192 + 32/48），
 * 所以这一支要给得出来。
 *
 * 更新只做一次：它是推满之后的一步，不按档次数放大。
 */
export const improveRouteTotal = (
  costs: ImproveCosts | null | undefined,
  from: number,
): ImproveBudget => {
  const budget = improveBudgetTo(costs, from)
  const conv = costs?.conv
  if (!conv) return budget
  addPair(budget.devmats, conv.devmats, conv.devmats_sli, 1)
  addPair(budget.screws, conv.screws, conv.screws_sli, 1)
  addCounts(budget.equips, conv.equips, 1)
  addCounts(budget.consumables, conv.consumable, 1)
  return budget
}

/** 把若干件装备各自的预算合成一笔总账。 */
export const mergeImproveBudgets = (list: ImproveBudget[]): Omit<ImproveBudget, 'from'> => {
  const total: Omit<ImproveBudget, 'from'> = {
    p1Times: 0,
    p2Times: 0,
    devmats: { normal: 0, certain: 0 },
    screws: { normal: 0, certain: 0 },
    equips: new Map(),
    consumables: new Map(),
    fuel: 0,
    ammo: 0,
    steel: 0,
    baux: 0,
  }
  for (const one of list) {
    total.p1Times += one.p1Times
    total.p2Times += one.p2Times
    total.devmats.normal += one.devmats.normal
    total.devmats.certain += one.devmats.certain
    total.screws.normal += one.screws.normal
    total.screws.certain += one.screws.certain
    for (const [id, n] of one.equips) total.equips.set(id, (total.equips.get(id) ?? 0) + n)
    for (const [id, n] of one.consumables) total.consumables.set(id, (total.consumables.get(id) ?? 0) + n)
    total.fuel += one.fuel
    total.ammo += one.ammo
    total.steel += one.steel
    total.baux += one.baux
  }
  return total
}

/** 「48 · 确保 62」；两侧同值时只给一个数（此时通常=确保，无需区分）。 */
export const improveCostText = (pair: CostPair): string =>
  pair.normal === pair.certain ? `${pair.normal}` : `${pair.normal} · 确保 ${pair.certain}`
