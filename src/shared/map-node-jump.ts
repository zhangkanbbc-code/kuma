// 节点图 → 敌编成小节的跳转（2026-08-27 用户提议）。
//
// 海域详情页上半是节点图，下半按点位列敌编成。图上点一个点位，页面就落到下面
// 那个点位的那一节。这里放的是**两边都得同意的那几件事**，做成纯逻辑是为了能
// 不带 DOM 直接测（与 shared/view-state 同一个理由）：
//
//   · 哪些点位算「有落点」——图上给不给手势、算不算可点，跟下面到底长不长出那一节，
//     必须是同一句话。各写一份必然漂移，而漂移的表现是「点了滚到空处」或者
//     「明明有一节却点不动」，两样都不报错。
//   · 标记与锚点叫什么名字——一边改了名另一边还在找旧名，同样不报错。
//
// ---- 点位身份 ----
//
// 判据用的是 fcd 那套**点位字母**（A / Z1 …）：节点图的圈和敌编成的行本来就都按它排。
// 缺包时的那张临时点位图不在此列——它的格子是罗盘**边号**不是点号（见
// shared/local-map-topology 的「点位身份为什么是边号」），字母在那条路上根本不存在，
// 所以那张图一个点位都跳不了，也不该做出可点的样子。

/** 节点图上「这个点位可跳」的标记。 */
export const MAP_NODE_JUMP_ATTR = 'data-mg-jump'

/** 下面敌编成小节上「这一节是哪个点位」的锚。 */
export const ENEMY_COMP_ANCHOR_ATTR = 'data-comp-node'

/** 落点判据只看一件事：这个点位有没有敌编成。 */
export interface EnemyCompNodeSource {
  enemyComps?: readonly unknown[]
}

/**
 * 这张图里**有敌编成可看**的点位，按点位名排序。
 *
 * 「资料收了这个点位」不等于「这个点位有敌编成」：只记了掉落的途中点、资源点、
 * 气旋点在目录里照样有条目，但 `enemyComps` 是空的——下面不会为它长出小节，
 * 图上也就不该可点。空目录（还没收录这张图）返回空数组，不是抛错。
 */
export const enemyCompNodes = (
  nodes: Readonly<Record<string, EnemyCompNodeSource>> | null | undefined,
): string[] =>
  Object.entries(nodes ?? {})
    .filter(([, value]) => (value?.enemyComps?.length ?? 0) > 0)
    .map(([node]) => node)
    .sort()

/**
 * 下面那一节的选择器。与锚点同一个出口——点位名里真出现引号或反斜杠时
 * 也不会把选择器拼断（拼断的表现是整句选择器抛异常，把一次跳转变成一次崩溃）。
 */
export const enemyCompRowSelector = (node: string): string =>
  `[${ENEMY_COMP_ANCHOR_ATTR}="${node.replace(/["\\]/g, (char) => `\\${char}`)}"]`
