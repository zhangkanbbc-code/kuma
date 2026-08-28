// 「这支队摆成这样，会走到哪儿去」——把一支舰队的全部可达路线收成一句话。
//
// 逐条路线的表已经有了（鉴的「可达路线」），可它一次只答一支队，
// 而玩家真正要做的判断是**队与队之间**的：哪支能进 Boss、哪支会绕开。
// 这一层不重新推带路，只把算好的路线聚合成可以并排比较的一行。

export interface PlannedRouteLike {
  nodes: string[]
  /** 走成这条的概率（0–1）；null = 分歧未决，带路条件收敛不出来 */
  probability: number | null
  uncertain: boolean
}

export interface BossReach {
  /** 经过 Boss 的可达路线条数 */
  routes: number
  /** 可达路线总数 */
  total: number
  /**
   * 合计进 Boss 的概率。**只要有一条路线概率未知就整体为 null**——
   * 把未知当 0 会得到一个看着精确、实际偏低的数，比不给还糟。
   */
  probability: number | null
}

export interface RouteOutlook {
  /** 最可能走成的那条；概率全未知时为 null */
  best: PlannedRouteLike | null
  /** 可达路线条数 */
  routes: number
  /** 有几条路线的分歧没收敛 */
  uncertain: number
  /** Boss 可达性；null = 不知道这张图的 Boss 在哪，不猜 */
  boss: BossReach | null
}

export const routeOutlook = (
  paths: PlannedRouteLike[] | null | undefined,
  bossLetters: Set<string> | null | undefined,
): RouteOutlook => {
  const list = paths ?? []
  const known = list.filter((path) => path.probability != null)
  // 并列时取短的：同样可能的两条里，先给玩家看少绕几个点的那条
  const best =
    known.length > 0
      ? known.reduce((top, path) =>
          (path.probability ?? 0) > (top.probability ?? 0) ||
          ((path.probability ?? 0) === (top.probability ?? 0) && path.nodes.length < top.nodes.length)
            ? path
            : top,
        )
      : null
  const out: RouteOutlook = {
    best,
    routes: list.length,
    uncertain: list.filter((path) => path.uncertain).length,
    boss: null,
  }
  if (!bossLetters?.size || !list.length) return out
  const reaching = list.filter((path) => path.nodes.some((node) => bossLetters.has(node)))
  const allKnown = reaching.length > 0 && reaching.every((path) => path.probability != null)
  out.boss = {
    routes: reaching.length,
    total: list.length,
    probability: allKnown
      ? Math.min(1, reaching.reduce((sum, path) => sum + (path.probability ?? 0), 0))
      : reaching.length === 0
        ? 0
        : null,
  }
  return out
}
