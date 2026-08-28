// 出击航路：这一趟**走过哪几条边**。
//
// poi fcd 的 route 是 { 边号: [起点字母 | null, 终点字母] }，
// 而战斗记录里的 api_no **就是边号**——所以每一步自带起点，
// 「出发点 → 第一个点」那一段本来就在数据里。
//
// 反过来靠「把访问过的字母首尾相连」推航线会两头出错：
//   · 出发点根本不在节点列表里，那一段整个画不出来；
//   · 136 张图里有 73 张是**双起点**（6-4/6-5/5-6/E 图…），
//     字母配对法连不出这趟走的是哪一个。

export type FcdRoute = Record<string, [string | null, string] | undefined>

/** poi fcd 里一张图的两张表：`spots[字母] = [x, y, 类型]`，坐标系与屏幕同向（y 朝下）。 */
export interface FcdMap {
  route?: FcdRoute
  spots?: Record<string, readonly unknown[] | undefined>
}

export interface RouteEdge {
  from: string
  to: string
}

/**
 * 把节点记录（一串边号）翻成逐条边。
 *
 * 边号 0 那条是 `[null, 出发点]`——「进入出发点」的伪边，没有线可画，
 * 与「fcd 里查不到这条边」一样跳过：宁可少一段，也不瞎连一条不存在的航路。
 */
export const travelledEdges = (
  route: FcdRoute | null | undefined,
  cells: number[],
): RouteEdge[] => {
  if (!route) return []
  const out: RouteEdge[] = []
  for (const cell of cells) {
    const edge = route[String(cell)]
    const from = edge?.[0]
    const to = edge?.[1]
    if (!from || !to) continue
    out.push({ from, to })
  }
  return out
}

/**
 * 这一步在海图上的朝向，单位是度：0 = 向右，90 = 向下，-90 = 向上，±180 = 向左。
 *
 * 边号自带起止点，两端坐标一减就是方位。游戏海图的 y 与屏幕同向朝下，
 * 而 CSS `rotate()` 的正方向也是顺时针——所以 `atan2(dy, dx)` 换成度之后可以直接用，
 * 中间不需要任何翻转。
 *
 * **算不出来一律 null，调用方据此保持原样。** 五种算不出：
 * 这张图不在资料里（部分活动图）、这条边查无（新图/改版）、起点是 null
 * （0 号那条「进入出发点」的伪边）、任一端没有坐标、两端坐标重合。
 */
export const sortieHeadingDeg = (
  map: FcdMap | null | undefined,
  cell: number | null | undefined,
): number | null => {
  if (typeof cell !== 'number' || !Number.isFinite(cell)) return null
  const edge = map?.route?.[String(cell)]
  const from = edge?.[0]
  const to = edge?.[1]
  if (!from || !to) return null
  const start = map?.spots?.[from]
  const end = map?.spots?.[to]
  const isCoord = (p: readonly unknown[] | undefined): p is readonly number[] =>
    Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number'
      && Number.isFinite(p[0]) && Number.isFinite(p[1])
  if (!isCoord(start) || !isCoord(end)) return null
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (dx === 0 && dy === 0) return null
  // 留一位小数：再细的角度眼睛看不出来，却会让渲染产物随资料的浮点尾巴抖动
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 10) / 10
}
