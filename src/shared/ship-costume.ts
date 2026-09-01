// 图鉴衣装的**归属**：一个衣装构图编号是谁的。
//
// ---- 为什么需要这一层（2026-08-31 用户实机报）----
// 游戏图鉴里点衣装切替，取的图路径长这样：
//   /kcs2/resources/ship/character_full/5310_1985.png
// 立绘档案按路径里的四位号记归属（见 shared/art-archive-plan 的 sanitizeArtArchiveEntry），
// 于是这一份被记在**形态 5310** 名下——而主数据 `api_mst_ship` 里根本没有 5310 这艘舰。
// 结果就是「档案里明明有村雨改二的四套衣装，按舰去查一张都查不到」：
// 它们挂在幽灵编号下面。
//
// 归属的**唯一**可靠出处是游戏自己给的 `api_get_member/picture_book` 响应：
// 每条图鉴条目的 `api_table_id` 把这一条目下能显示的构图编号列全了，形如
//   村雨（图鉴 No.81）  [44, 244, 5191, 5201, 5226, 5309, 5478, 6023]
//   村雨改二（No.298）  [498, 5310, 5403, 5479, 6024]
// 前面几个是**真实形态**（44 村雨 / 244 村雨改 / 498 村雨改二，主数据里查得到），
// 后面几个是这一条目的衣装。所以判据不是「第一个之后都是衣装」——
// 那会把 244 村雨改当成一套衣装挂到 44 底下（错得不报错）。
//
// ---- 这里不发任何请求 ----
// 只解析玩家自己开图鉴时游戏返回的报文（实时一路 + 账本里已存的那些回灌一路）。
// 玩家从没开过图鉴的舰，这张表里就是没有——如实，不猜。

/**
 * 衣装归属表：构图编号 → 拥有它的形态（可能不止一个）。
 *
 * **一个衣装可以属于多个形态**：图鉴条目 No.81 同时覆盖村雨与村雨改，
 * 那六套衣装是这个条目的，报文没有再往下细分到某一个形态。
 * 硬挑一个当「正主」就是替游戏做它没做的区分，所以照实存成一组。
 */
export type ShipCostumeMap = Record<string, number[]>

/** 一条学到的归属。 */
export interface ShipCostumeEntry {
  graphId: number
  owners: number[]
}

/**
 * 构图编号的合法范围。图鉴条目里除了衣装还会出现装备号（装备图鉴走同一个端点，
 * `api_table_id` 是装备 id，形如 `[3]`），所以只靠「不是舰」判不够——
 * 装备条目里一个真实形态都没有，`owners` 为空时整条丢弃，那一道才是主闸门。
 */
const MAX_GRAPH_ID = 99_999

const asIntList = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const item of raw) {
    const value = Number(item)
    if (Number.isInteger(value) && value > 0 && value <= MAX_GRAPH_ID) out.push(value)
  }
  return out
}

const uniqSorted = (ids: readonly number[]): number[] =>
  [...new Set(ids)].sort((left, right) => left - right)

/**
 * 从一份 `api_get_member/picture_book` 响应里认出衣装归属。
 *
 * @param apiData   响应的 `api_data`（或整个报文，两种都收）
 * @param isShipMstId 「这个号是主数据里真实存在的一艘舰吗」。**必须由调用方给**：
 *   舰与衣装在 `api_table_id` 里长得一模一样，只有主数据能把两者分开。
 *   主数据还没到位时调用方给一个恒 false 的判据只会得到空结果——
 *   宁可这一次学不到，也不能把 244 村雨改记成一套衣装。
 *
 * 只收「第一个元素就是真实形态」的条目：舰船图鉴条目一定以本体形态打头，
 * 而装备图鉴条目（同端点，`api_type=2`）的第一个是装备 id，一个形态都配不上。
 */
export const parsePictureBookCostumes = (
  apiData: unknown,
  isShipMstId: (id: number) => boolean,
): ShipCostumeEntry[] => {
  const root = (apiData ?? {}) as Record<string, unknown>
  const nested = (root.api_data ?? root) as Record<string, unknown>
  const list = Array.isArray(nested?.api_list) ? nested.api_list : null
  if (!list) return []
  const out = new Map<number, Set<number>>()
  for (const raw of list) {
    const table = asIntList((raw as Record<string, unknown>)?.api_table_id)
    if (!table.length) continue
    // 打头的必须是真实形态。装备图鉴（同端点）的条目在这里整条落空。
    if (!isShipMstId(table[0])) continue
    const owners = table.filter((id) => isShipMstId(id))
    const costumes = table.filter((id) => !isShipMstId(id))
    if (!owners.length || !costumes.length) continue
    for (const graphId of costumes) {
      const set = out.get(graphId) ?? new Set<number>()
      for (const owner of owners) set.add(owner)
      out.set(graphId, set)
    }
  }
  return [...out.entries()]
    .map(([graphId, owners]) => ({ graphId, owners: uniqSorted([...owners]) }))
    .sort((left, right) => left.graphId - right.graphId)
}

/**
 * 把学到的归属并进表里。
 *
 * @returns 这一批里**新出现**的构图编号数（调用方据此决定要不要落盘/通知界面）。
 *   归属集合变大（同一个衣装又在另一个形态的条目里露面）也算变化。
 */
export const mergeShipCostumes = (
  into: ShipCostumeMap,
  learned: readonly ShipCostumeEntry[],
): number => {
  let changed = 0
  for (const entry of learned) {
    const key = `${entry.graphId}`
    const known = into[key] ?? []
    const merged = uniqSorted([...known, ...entry.owners])
    if (merged.length === known.length && merged.every((id, at) => id === known[at])) continue
    into[key] = merged
    changed += 1
  }
  return changed
}

/**
 * 把盘上那份收敛成干净结构。文件是我们自己写的，但没必要信任它的内容
 *（手改过、写到一半断电过都有可能）——同 sanitizeShipArtMap 的理由。
 */
export const sanitizeShipCostumeMap = (raw: unknown): ShipCostumeMap => {
  if (!raw || typeof raw !== 'object') return {}
  const out: ShipCostumeMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const graphId = Number(key)
    if (!Number.isInteger(graphId) || graphId <= 0 || graphId > MAX_GRAPH_ID) continue
    const owners = uniqSorted(asIntList(value))
    if (!owners.length) continue
    out[`${graphId}`] = owners
  }
  return out
}

/** 形态 → 它名下的衣装构图编号（升序）。逐格渲染前建一次，别每格全表扫。 */
export const shipCostumeIndex = (map: ShipCostumeMap): Map<number, number[]> => {
  const index = new Map<number, number[]>()
  for (const [key, owners] of Object.entries(map)) {
    const graphId = Number(key)
    if (!Number.isInteger(graphId)) continue
    for (const owner of owners) {
      const list = index.get(owner) ?? []
      list.push(graphId)
      index.set(owner, list)
    }
  }
  for (const list of index.values()) list.sort((left, right) => left - right)
  return index
}

/**
 * 这个构图编号该算在哪个形态头上（统计口径用，取归属里最小的那个形态号）。
 *
 * 「最小」不是随便挑的：同一条图鉴条目里的形态按改造顺序排，最小的就是本体，
 * 而档案占用那一行问的是「覆盖了多少个形态」——衣装不该被数成一艘新舰娘。
 * 表里没有这一条时返回它自己：**没学到归属就如实当独立一条**，不猜。
 */
export const costumeOwnerOf = (map: ShipCostumeMap, graphId: number): number => {
  const owners = map[`${graphId}`]
  return owners?.length ? owners[0] : graphId
}
