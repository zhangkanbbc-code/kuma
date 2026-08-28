// 「这个分歧点，我自己实际被带去过哪几次」——把账本里的边号统计翻成逐点的去向表。
//
// 这是攻略表替不了的一件事：带路条件说的是「满足什么会去哪」，
// 而固定分歧（比如 50/50）满足与否都一样——只有自己走过的次数
// 能回答「这条路我到底吃到过几回」。
//
// 账本记的是**边号**（api_no）。翻字母时不查 from_cell，而是查这一步那条边
// 自己的起点（`route[to][0]`）——因为同一个点常常有好几条边通向它
// （实测 3-5 的 F 就有 6 号与 13 号两条），按 from_cell 分组会把
// 「站在 F 往下走」的次数拆成互不相干的两堆。

import type { FcdRoute } from './sortie-route'

export interface BranchTally {
  /** 从这个点往下走过多少次 */
  total: number
  /** 去向字母 → 次数，次数降序 */
  to: { letter: string; count: number }[]
}

/**
 * 逐点的去向统计。键是**站着的那个点**的字母（出发点就是 fcd 里它自己的名字，
 * 多数图叫 '1'，双起点图还有 '2'）。
 *
 * fcd 里查不到的边整条跳过：宁可少一格，也不把次数记到猜出来的点上。
 */
export const branchTallyByLetter = (
  branches: Record<number, Record<number, number>> | null | undefined,
  route: FcdRoute | null | undefined,
): Map<string, BranchTally> => {
  const out = new Map<string, BranchTally>()
  if (!branches || !route) return out
  for (const steps of Object.values(branches)) {
    if (!steps) continue
    for (const [toCell, rawCount] of Object.entries(steps)) {
      const count = Number(rawCount)
      if (!Number.isFinite(count) || count <= 0) continue
      const edge = route[String(toCell)]
      const at = edge?.[0]
      const to = edge?.[1]
      if (!at || !to) continue
      const tally = out.get(at) ?? { total: 0, to: [] }
      const seen = tally.to.find((entry) => entry.letter === to)
      if (seen) seen.count += count
      else tally.to.push({ letter: to, count })
      tally.total += count
      out.set(at, tally)
    }
  }
  for (const tally of out.values()) {
    tally.to.sort((a, b) => b.count - a.count || a.letter.localeCompare(b.letter))
  }
  return out
}

/**
 * 一条完整路线在自己账本里走成过几次。
 *
 * 取沿途每一步的**最小值**：路线是 A→B→C 连着的，能走成的次数不会多过
 * 其中最窄的那一步。这是个上界，不是精确计数——账本按步记，
 * 不保留「这几步属于同一趟」的串联关系，所以只说「至多」。
 */
export const pathWalkedBound = (
  tally: Map<string, BranchTally>,
  nodes: string[],
): number | null => {
  if (nodes.length < 2) return null
  let bound: number | null = null
  for (let i = 1; i < nodes.length; i += 1) {
    const step = tally.get(nodes[i - 1])?.to.find((entry) => entry.letter === nodes[i])
    if (!step) return 0
    bound = bound == null ? step.count : Math.min(bound, step.count)
  }
  return bound
}
