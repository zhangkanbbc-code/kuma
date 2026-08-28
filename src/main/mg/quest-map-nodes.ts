// 铭 · 任务点位校准表 + 边号推导。
//
// 任务正文说的是**点位**（「7-3 的 E 点」「7-2 第二血条的 Boss」），
// 而游戏与判定用的是**边号**（罗盘 api_no = 走到该点的那条边）。两者之间只差一次查表，
// 但边号会随海图改版变，硬编码进规则里就是一堆迟早过期的魔数。
//
// 所以这里只留人写的那一半——「这张图的第几血条 Boss 是哪个字母」——
// 边号一律从 poi-fcd-map（MIT）的 route 表现算：route 的每一项是 边号 → [起点, 终点]，
// 终点等于目标字母的就是入边。实测九行全部对得上 EO 的编码（2026-08-21）：
//   1-6 N=[14,17] · 5-6 Z=[43] · 7-2 G=[7] M=[15] · 7-3 E=[5,8] P=[18,23,24,25]
//   7-4 O=[15] · 7-5 Q=[19] T=[24,25]
// 并与账本 encounters 的 is_boss 观测不矛盾（7-2 实测观测到 7 与 15，正是 G/M）。
//
// 纪律：表里没有的写法一律吐 null 交人裁，**不许默认取末血条**——
// 多血条图的裸引用（「7-3 取得一次 S 胜」）本身就是歧义，猜一个等于悄悄编数据。

import type { QpMapRef } from '../../shared/qp-types'

/** poi-fcd-map 的 data：海域 id（"7-3"）→ { route: 边号 → [起点, 终点], spots } */
export type PoiFcdMapData = Record<string, {
  route?: Record<string, [string | null, string | null]>
  spots?: Record<string, unknown>
}>

export interface QuestMapNodeRow {
  map: QpMapRef
  /**
   * 正文怎么指这个点：
   * - `P1`/`P2`/`P3` = 第 n 血条的 Boss 格（多血条图）
   * - `goal` = 护航图的终点（1-6 没有 Boss，「クリア」是走到终点）
   * - 其余 = 正文直接写出的格子字母（7-4「O 点」）
   */
  ref: string
  spot: string
  why: string
}

/**
 * 人工校准的全部内容就是这九行。
 * 每一行都能被 poi-fcd 的入边算式与账本 Boss 格观测双向核对，不是孤证。
 */
export const QUEST_MAP_NODE_TABLE: readonly QuestMapNodeRow[] = [
  { map: [1, 6], ref: 'goal', spot: 'N', why: '护航图终点；罗盘事件 8 船団護衛成功就在这一格' },
  { map: [5, 6], ref: 'P3', spot: 'Z', why: '第三血条 Boss' },
  { map: [7, 2], ref: 'P1', spot: 'G', why: '第一血条 Boss（第一段作战）' },
  { map: [7, 2], ref: 'P2', spot: 'M', why: '第二血条 Boss（第二段作战）' },
  { map: [7, 3], ref: 'P1', spot: 'E', why: '第一血条 Boss' },
  { map: [7, 3], ref: 'P2', spot: 'P', why: '第二血条 Boss' },
  { map: [7, 4], ref: 'O', spot: 'O', why: '正文直接写「O 点」' },
  { map: [7, 5], ref: 'P2', spot: 'Q', why: '第二血条 Boss' },
  { map: [7, 5], ref: 'P3', spot: 'T', why: '第三血条 Boss' },
]

export const mapKeyOf = (map: QpMapRef): string => `${map[0]}-${map[1]}`

/** 表里这张图登记了几个血条 Boss（P 开头的行）。≥2 = 裸引用有歧义，必须待裁。 */
export const questMapGaugeCount = (map: QpMapRef): number =>
  QUEST_MAP_NODE_TABLE.filter(
    (row) => row.map[0] === map[0] && row.map[1] === map[1] && /^P\d+$/.test(row.ref),
  ).length

/** 该海域的裸引用（正文只写「7-3」不写血条/点位）是否歧义。 */
export const questMapNeedsGauge = (map: QpMapRef): boolean => questMapGaugeCount(map) >= 2

/** 校准表查询：查不到返回 null（交人裁，绝不猜一个）。 */
export const questMapSpotOf = (map: QpMapRef, ref: string): string | null =>
  QUEST_MAP_NODE_TABLE.find(
    (row) => row.map[0] === map[0] && row.map[1] === map[1] && row.ref === ref,
  )?.spot ?? null

/**
 * 从 poi-fcd 的 route 表算出「走到 spot 的那些边号」。
 * 边号即罗盘 api_no，判定端拿它和 `api_no` 比。
 * 算不出（海图没收录 / 该点无入边）返回空数组——调用方据此放弃该条，而不是补个 0。
 */
export const questMapNodeIds = (
  fcd: PoiFcdMapData | null | undefined,
  map: QpMapRef,
  spot: string,
): number[] => {
  const route = fcd?.[mapKeyOf(map)]?.route
  if (!route || !spot) return []
  const ids: number[] = []
  for (const [edge, ends] of Object.entries(route)) {
    if (!Array.isArray(ends) || ends[1] !== spot) continue
    const id = parseInt(edge, 10)
    if (Number.isInteger(id) && id > 0) ids.push(id)
  }
  return ids.sort((left, right) => left - right)
}

/** 校准表 → 边号的一步到位查询；表里没有或图上算不出都返回空数组。 */
export const questMapRefNodeIds = (
  fcd: PoiFcdMapData | null | undefined,
  map: QpMapRef,
  ref: string,
): number[] => {
  const spot = questMapSpotOf(map, ref)
  return spot ? questMapNodeIds(fcd, map, spot) : []
}
