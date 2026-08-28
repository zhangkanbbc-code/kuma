// 等级经验阈值表——**从玩家自己的在籍舰反推**，不引外部数据。
//
// 舰C 的升级经验表不在 api_start2 里（顶层没有任何含 exp 的键），
// 而它高段没有可套的公式：低段是 50·lv·(lv-1)（Lv10 = 4500 ✓），
// 到 Lv130 实测却是 1,785,000，公式给的是 838,500——差了一倍多。
// 所以既不能从主数据拿，也不能靠公式推。
//
// 但每艘**未满级**的在籍舰都自带一个精确的点：
//   api_exp = [累计经验, 距下一级, 进度%]
//   accumulated + toNext = 升到 (lv+1) 级所需的累计经验
// 436 艘在籍舰一次就能反推出 95 个等级点。表存下来跨会话累积，
// 玩家一直在练级，它只会越来越全——查不到的就老实说查不到，绝不插值补。

export interface LevelExpShip {
  lv: number
  expTotal: number
  expNext: number
}

/** 从在籍舰提取「达到某级所需累计经验」的点。 */
export const levelExpPointsOf = (ships: LevelExpShip[]): Map<number, number> => {
  const points = new Map<number, number>()
  for (const ship of ships) {
    // expNext ≤ 0 是满级舰，给不出下一级的阈值
    if (!(ship.expNext > 0) || !(ship.lv > 0) || !(ship.expTotal >= 0)) continue
    points.set(ship.lv + 1, ship.expTotal + ship.expNext)
  }
  return points
}

/**
 * 把新观测并进已有表。返回是否有变化（决定要不要落盘）。
 *
 * 同一等级出现两个不同阈值时**以新的为准**：游戏调过表的话，旧值才是错的。
 */
export const mergeLevelExp = (into: Map<number, number>, points: Map<number, number>): boolean => {
  let changed = false
  for (const [level, total] of points) {
    if (into.get(level) === total) continue
    into.set(level, total)
    changed = true
  }
  return changed
}

/**
 * 从当前状态练到 targetLevel 还差多少经验。
 *
 * 表里没有目标等级就返回 null —— 调用方必须如实说「算不出」，
 * 不许拿相邻等级插值：那会给出一个看起来精确的错数。
 */
export const expToLevel = (
  table: Map<number, number>,
  ship: LevelExpShip,
  targetLevel: number,
): number | null => {
  if (targetLevel <= ship.lv) return 0
  const need = table.get(targetLevel)
  if (need == null) return null
  return Math.max(0, need - ship.expTotal)
}
