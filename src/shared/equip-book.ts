// 装备图鉴只读游戏 picture_book（api_type=2）报文，与库存见过记录取并集。
// 2026-09-12 协议核对：api_index_no 与 api_mst_slotitem.api_sortno 一致。
// 第 1 页编号范围 1–70、第 3 页 142–210、第 9 页 561–586；
// 在 1–200 的候选页容量中唯一解为 70。最大 sortno 588 对应 9 页，第 10 页为空。
// 2026-09-12：没有解锁条目的页返回 { api_result: 1, api_result_msg: '成功', api_data: null }。
export const EQUIP_BOOK_PAGE_SIZE = 70

export const equipBookPageOf = (sortno: number): number =>
  Math.floor((sortno - 1) / EQUIP_BOOK_PAGE_SIZE) + 1

export type EquipBookMap = {
  pages: Record<string, number>
  unlocked: Record<string, number>
  seen: Record<string, number>
}

export interface EquipBookPage {
  page: number
  unlocked: number[]
}

export const parsePictureBookEquipPage = (
  apiData: unknown,
  post: Record<string, unknown>,
  isEquipMstId: (id: number) => boolean,
): EquipBookPage | null => {
  const page = Number(post.api_no)
  if ((post.api_type !== '2' && post.api_type !== 2) || !Number.isInteger(page) || page <= 0) return null
  const root = (apiData ?? {}) as Record<string, unknown>
  if (apiData === null || root.api_data === null) return { page, unlocked: [] }
  const nested = (root.api_data ?? root) as Record<string, unknown>
  if (!Array.isArray(nested?.api_list)) return null
  const unlocked = new Set<number>()
  for (const entry of nested.api_list) {
    const id = entry?.api_table_id?.[0]
    if (entry?.api_state?.[0] === 1 && isEquipMstId(id)) unlocked.add(id)
  }
  return { page, unlocked: [...unlocked].sort((a, b) => a - b) }
}

export const sanitizeEquipBookMap = (raw: unknown): EquipBookMap => {
  const out: EquipBookMap = { pages: {}, unlocked: {}, seen: {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const field of ['pages', 'unlocked', 'seen'] as const) {
    const entries = (raw as Record<string, unknown>)[field]
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    for (const [key, ts] of Object.entries(entries)) {
      const id = Number(key)
      if (!Number.isInteger(id) || id <= 0 || typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) continue
      out[field][`${id}`] = ts
    }
  }
  return out
}

/** 页时间取较新报文；返回新增解锁数，空页也记为读过。 */
export const mergeEquipBookPage = (into: EquipBookMap, parsed: EquipBookPage, ts: number): number => {
  into.pages[`${parsed.page}`] = Math.max(into.pages[`${parsed.page}`] ?? ts, ts)
  let added = 0
  for (const id of parsed.unlocked) {
    if (into.unlocked[`${id}`] === undefined) added++
    into.unlocked[`${id}`] = Math.max(into.unlocked[`${id}`] ?? ts, ts)
  }
  return added
}

/** 库存首次见到的时间保留原值，重放与重复同步不覆盖。 */
export const noteEquipSeen = (into: EquipBookMap, mstIds: readonly number[], ts: number): number => {
  let added = 0
  for (const id of mstIds) {
    if (into.seen[`${id}`] !== undefined) continue
    into.seen[`${id}`] = ts
    added++
  }
  return added
}

export const equipHeldOnce = (map: EquipBookMap, mstId: number): boolean =>
  map.unlocked[`${mstId}`] !== undefined || map.seen[`${mstId}`] !== undefined

export const equipBookPagesRead = (map: EquipBookMap): number[] =>
  Object.keys(map.pages).map(Number).sort((a, b) => a - b)
