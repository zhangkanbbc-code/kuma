// 海图包（`poi-fcd-map`）的一条到底画不画得出来——**判据的单一出处**。
//
// ---- 病灶 ----
//
// 上游 poi 的 `fcd/map.json` 会给还没人补坐标的新图先落一个**空壳**
// （`{ spots: {}, route: {} }`）。空对象是真值，于是从前四处消费点的
// `fcd?.spots` 一律放行，空壳就一路走到了画图那一步：
//
//   · `Math.min(...[])` 是 `Infinity`、`Math.max(...[])` 是 `-Infinity`
//     ⇒ viewBox 实算出来是 `"Infinity Infinity -Infinity -Infinity"`
//     （四个数一个有限的都没有，SVG 画不出来。test/fcd-topology 把这串钉住了）；
//   · 航迹条上的「海图」钮照挂，展开是一片空白；
//   · 图鉴那边更糟：空壳让 `mapGraphHtml` 以为有拓扑，直接绕过
//     `localMapGraphHtml` 那条**专为新图准备**的兜底路径，带路挂牌一条都不出；
//   · 「四包皆无才让位」的自扩展判据也会把空壳读成「官方已经收了这张图」，
//     于是本机遭遇志长出来的临时点位图也跟着不出——新图上什么都没有。
//
// ---- 判据 ----
//
// 两格都得真有东西。少一格都画不出一张图：只有点没有边连不起来，
// 只有边没有坐标不知道画在哪。空壳与「包里根本没这张图」在显示上是同一回事，
// 都该走新图的兜底路径。
//
// ---- 为什么闸门在这里而不在校验器 ----
//
// 空壳是上游**合法**的占位数据，不是坏包。而 `main/lode.ts` 的 readPack 对
// 校验不过的包是**整包丢弃**：让校验器因为一条空壳就否掉整份 poi-fcd-map，
// 会在新活动开幕那天（正是上游落空壳的时刻）把全部 136 张图的点位字母、
// 小地图、航迹一起弄没，而且正式包没有 DevTools，玩家只看到东西凭空消失。
// 那比一张坏图严重得多。所以闸门放在消费侧：坏的那一条走兜底，其余照画。

export interface FcdTopologyEntry {
  spots?: Record<string, unknown> | null
  route?: Record<string, unknown> | null
}

/** 这一条海图数据能不能拿来画图（空壳与缺条目一视同仁，都是「不能」）。 */
export const fcdTopologyUsable = (entry: FcdTopologyEntry | null | undefined): boolean => {
  const spots = entry?.spots
  const route = entry?.route
  if (!spots || typeof spots !== 'object') return false
  if (!route || typeof route !== 'object') return false
  return Object.keys(spots).length > 0 && Object.keys(route).length > 0
}
