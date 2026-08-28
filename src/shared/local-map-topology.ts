// 本机实测的海域点位图（自扩展体检待裁 1，2026-08-23 用户拍板选项 C）。
//
// ---- 这是什么，不是什么 ----
//
// 常规图的节点拓扑（点位字母、边、坐标）全靠 `poi-fcd-map`。一张新图从实装到上游更新
// 之间，节点图只有一句挂牌——**而本机遭遇志其实已经知道你走过哪些边**。
// 这一层就是把账本里那点事实画出来，它是**你的实测视图，不是官方拓扑**：
//   · 只画你自己走过的边，一条没走过的边都不补；
//   · 点位用**边号**（`#12`）不猜字母——字母是 fcd 那份资料的东西，猜出来的字母会骗人；
//   · 推不出边就只列点位，绝不为了「看起来像张图」硬连线。
//
// 边界（这条边界是用户当年亲自立的，2026-08-23 才放宽到「四包皆无」这一档）：
// 官方资料一到就**整块让位**，判据是 `officialMapMaterialAbsent`——四个包里
// 任何一个收了这张图，这一层就不出，不与官方拓扑并存、不给人机会把它读成完整拓扑。
//
// ---- 点位身份为什么是边号 ----
//
// 账本记的 `cell` 是罗盘的 `api_no`，那是**边号**不是点号：`route[api_no] = [起点, 终点]`，
// 一个点常常有好几条边通向它（实测 3-5 的 F 就有 6 号与 13 号两条）。
// 所以这里的一个「点位」= 一条边的终点，同一个真实点位可能出现两次。
// 这件事必须在界面上说清楚（挂牌那句），不能让人以为格子数就是点位数。
//
// 边则是**从边号到边号**：账本的 `routes` 表逐步记着「上一步的边号 → 这一步的边号」，
// 翻成拓扑就是「上一步的终点 → 这一步的终点」之间确有一条路。这是一手观测，不是反推。

export interface LocalMapTopologyNode {
  /** 边号（`api_no`）。展示成 `#12` */
  cell: number
  /** 你在这个点位打过多少战（没打过就是 0——走过但没战斗的点也要有格子） */
  battles: number
  /** 只按本机实际遭遇认定的 Boss 点 */
  boss: boolean
  /** 出击起点的下一步（账本里 `from_cell = -1` 的那些） */
  start: boolean
  /** 从起点数过来的最短步数；连不上起点的是 -1（照样有格子，只是排在最后一层） */
  depth: number
}

export interface LocalMapTopologyLink {
  from: number
  to: number
  /** 你走过这条边多少次 */
  count: number
}

export interface LocalMapTopology {
  nodes: LocalMapTopologyNode[]
  links: LocalMapTopologyLink[]
  /** 逐层的点位（画图时一层一列）。连不上起点的那些归在最后一层 */
  layers: number[][]
  /** 一条边都推不出来——只能列点位，不画连线 */
  linksUnavailable: boolean
}

export interface MapChronicleCells {
  cells: readonly { cell: number; count: number }[]
  bossCells: readonly number[]
}

/**
 * 四个包**都没有**这张图。
 *
 * 「让位」的判据故意取得比「fcd 没有」宽：只要任何一份官方/社区资料收了这张图，
 * 本机实测视图就不出。这是选项 C 的全部内容——把这一层的曝光窗口压到
 *「一张彻底没人有资料的新图」那一小段，避免它与官方拓扑并列时被误读。
 */
export const officialMapMaterialAbsent = (has: {
  fcdTopology: boolean
  routing: boolean
  drops: boolean
  enemyComps: boolean
}): boolean => !has.fcdTopology && !has.routing && !has.drops && !has.enemyComps

/**
 * 从本机遭遇志长出一张临时点位图。
 *
 * @param chronicle 整图汇总（`cells` 的 cell 是边号，`bossCells` 同口径）
 * @param branches  `RouteStatsReport.branches`：`上一步边号 → { 这一步边号: 次数 }`，
 *                  `-1` 是出击起点。拿不到（还没读到 / 读失败）就传 null——
 *                  那时只列点位，不画连线。
 */
export const localMapTopology = (
  chronicle: MapChronicleCells | null | undefined,
  branches: Record<number, Record<number, number>> | null | undefined,
): LocalMapTopology => {
  const battles = new Map<number, number>()
  for (const entry of chronicle?.cells ?? []) {
    const cell = Number(entry?.cell)
    if (cell > 0) battles.set(cell, (battles.get(cell) ?? 0) + (Number(entry?.count) || 0))
  }
  const boss = new Set<number>(
    (chronicle?.bossCells ?? []).map((cell) => Number(cell)).filter((cell) => cell > 0),
  )

  const links: LocalMapTopologyLink[] = []
  const starts = new Set<number>()
  const known = new Set<number>(battles.keys())
  for (const [rawFrom, steps] of Object.entries(branches ?? {})) {
    const from = Number(rawFrom)
    for (const [rawTo, rawCount] of Object.entries(steps ?? {})) {
      const to = Number(rawTo)
      const count = Number(rawCount)
      if (!(to > 0) || !(count > 0)) continue
      known.add(to)
      if (from === -1) {
        starts.add(to)
        continue // 出击起点不是一个点位，别画一条从虚空来的线
      }
      if (!(from > 0)) continue
      known.add(from)
      links.push({ from, to, count })
    }
  }
  links.sort((left, right) => left.from - right.from || left.to - right.to)

  // 逐层：从起点广度优先。起点一个都没有（老账本只记了战斗、没记航迹）就退化成一层。
  const out = new Map<number, number[]>()
  for (const link of links) out.set(link.from, [...(out.get(link.from) ?? []), link.to])
  const depth = new Map<number, number>()
  let frontier = [...starts].filter((cell) => known.has(cell)).sort((a, b) => a - b)
  for (const cell of frontier) depth.set(cell, 0)
  let level = 0
  while (frontier.length) {
    const next: number[] = []
    for (const cell of frontier) {
      for (const to of out.get(cell) ?? []) {
        if (depth.has(to)) continue
        depth.set(to, level + 1)
        next.push(to)
      }
    }
    frontier = next.sort((a, b) => a - b)
    level += 1
  }

  const nodes: LocalMapTopologyNode[] = [...known]
    .sort((a, b) => a - b)
    .map((cell) => ({
      cell,
      battles: battles.get(cell) ?? 0,
      boss: boss.has(cell),
      start: starts.has(cell),
      depth: depth.get(cell) ?? -1,
    }))

  const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), -1)
  // 连不上起点的归到最后一层：它们是真走过的点，只是航迹没串起来（老样本／中途换图），
  // 藏起来就是把事实藏起来
  const orphanLayer = maxDepth + 1
  const layers: number[][] = Array.from({ length: orphanLayer + 1 }, () => [])
  for (const node of nodes) layers[node.depth < 0 ? orphanLayer : node.depth].push(node.cell)

  return {
    nodes,
    links,
    layers: layers.filter((layer) => layer.length),
    linksUnavailable: links.length === 0,
  }
}
