// kcwiki 初期装备逐槽归一化；不依赖运行时模块，空槽 -1 也保留原位置。
export interface InitialEquipment {
  id: number
  star: number
}

export type InitialEquipmentEntry = number | InitialEquipment

/** 维护者裁决 2026-11-03：数字是白板装备，对象携带改修星级，其它形状跳过。 */
export const normalizeInitialEquipment = (entry: unknown): InitialEquipment | null => {
  if (typeof entry === 'number' && Number.isFinite(entry)) return { id: entry, star: 0 }
  if (
    entry && typeof entry === 'object' && 'id' in entry && 'star' in entry
    && typeof entry.id === 'number' && Number.isFinite(entry.id)
    && typeof entry.star === 'number' && Number.isFinite(entry.star)
  ) {
    return { id: entry.id, star: entry.star }
  }
  return null
}
