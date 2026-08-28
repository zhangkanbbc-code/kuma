// 坑位 ↔ 候选的最大匹配（Kuhn 增广路）。
//
// 存在的理由：逐条要求「先到先得」在条件互相牵制时会**有解却报无解**。
// 典型反例——要求 A 收「軽巡或雷巡」、要求 B 只收「雷巡」，手上恰好一軽一雷：
// 先到先得会把唯一那艘雷巡填进 A，轮到 B 就没人了，于是报凑不出；
// 而把軽巡给 A、雷巡给 B 明明是可行的。
//
// 这里不是「尽量」——按 Hall 定理，只要存在填满全部坑位的分配，
// 最大匹配就一定会填满。填不满即真的凑不出，不是分法不好。

/**
 * @param slots 坑位，每个只收一个候选
 * @param candidates 候选，**按偏好从高到低排好**（越靠前越希望被选中）
 * @param accepts 该坑位收不收这个候选
 * @returns 与 slots 等长的数组；第 i 项是落在该坑的候选，没凑到则为 null
 *
 * 候选按偏好顺序逐个尝试增广，能增广就留下。二部图里「可被匹配的候选集合」
 * 构成横贯拟阵，所以按代价贪心 + 增广路拿到的是**最省的一组最大匹配**，
 * 而不是随便一组最大匹配。
 */
export const matchSlots = <S, T>(
  slots: S[],
  candidates: T[],
  accepts: (slot: S, candidate: T) => boolean,
): (T | null)[] => {
  const holder: (T | null)[] = slots.map(() => null)
  const augment = (candidate: T, seen: Set<number>): boolean => {
    for (let i = 0; i < slots.length; i++) {
      if (seen.has(i) || !accepts(slots[i], candidate)) continue
      seen.add(i)
      const current = holder[i]
      // 该坑空着，或它现在的占用者能挪到别处 —— 两种情况都能腾出来
      if (current === null || augment(current, seen)) {
        holder[i] = candidate
        return true
      }
    }
    return false
  }
  // 坑位填满就收工：全占满之后 augment 必然一路走到底再返回 false
  // （没有空坑可落脚），剩下的候选纯属白跑增广搜索，结果一模一样。
  let filled = 0
  for (const candidate of candidates) {
    if (filled >= slots.length) break
    if (augment(candidate, new Set())) filled++
  }
  return holder
}

/** 匹配是否填满了全部坑位 */
export const isFullMatch = <T>(holder: (T | null)[]): boolean => holder.every((x) => x !== null)
