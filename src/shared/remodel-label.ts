// 「下一改装是第几档」——从形态名里剥出「改」「改二」「航改二」这样的后缀。
//
// 编队行只有一小格，写完整舰名会把这一行挤爆，但一律写「改」又是错的：
// 铃谷改的下一档是**改二**，写「改」等于没说。剥掉改造链原型的名字，
// 剩下的那截正好就是玩家在游戏里看到的档位写法。
//
// 剥不掉就给完整名——有些改装会**改名换姓**（響改 → Верный，
// 天津風改二 → 天津風改二丁），那时后缀无从谈起，写全名反而清楚。

/**
 * @param rootName 改造链原型的名字（与 nextName 必须是**同一种语言**，
 *                 否则前缀对不上，会退化成显示完整名）
 * @param nextName 下一形态的名字
 */
export const remodelStageLabel = (
  rootName: string | null | undefined,
  nextName: string | null | undefined,
): string => {
  const next = `${nextName ?? ''}`.trim()
  if (!next) return ''
  const root = `${rootName ?? ''}`.trim()
  if (!root || !next.startsWith(root)) return next
  const rest = next.slice(root.length).trim()
  // 名字一模一样（理论上不该发生）时也给完整名，别给个空字符串
  return rest || next
}

/**
 * 沿 afterShipId 的**前驱**方向回溯到改造链原型。
 *
 * **互指的两个形态是可逆转换，不是链的方向**，登记前驱时必须跳过。
 * 实测 Fletcher：596 → 692 Fletcher改 → 628 改 Mod.2 ⇄ 629 Mk.II，
 * 629 先被登记成 628 的前驱，于是 628 一路回溯到 629，自己成了自己的原型，
 * 后缀怎么也剥不出来。
 *
 * 剩下的环（多形态可逆）由 visited 兜底；一条链上有多个入口时取先到的那个，
 * 档位标签只关心名字前缀，不必纠结分支。
 */
export const remodelRootOf = (
  afterOf: Map<number, number>,
  mstId: number,
): number => {
  const beforeOf = new Map<number, number>()
  for (const [id, after] of afterOf) {
    if (after <= 0) continue
    if (afterOf.get(after) === id) continue // 互指 = 可逆转换
    if (!beforeOf.has(after)) beforeOf.set(after, id)
  }
  const seen = new Set<number>()
  let current = mstId
  while (current > 0 && !seen.has(current)) {
    seen.add(current)
    const before = beforeOf.get(current)
    if (!before) {
      // 可逆对的两半共享同一个原型，但上游只挂在其中一半上
      // （矢矧改二乙 ⇄ 矢矧改二，链是 矢矧 → 改 → 改二，乙这边没有上游）。
      // 自己走不动就跳到对面接着回溯。
      const twin = afterOf.get(current)
      if (twin && afterOf.get(twin) === current && !seen.has(twin)) {
        current = twin
        continue
      }
      break
    }
    if (seen.has(before)) break
    current = before
  }
  return current
}
