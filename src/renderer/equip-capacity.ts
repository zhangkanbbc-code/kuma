import type { SlotitemInstance } from '../shared/mg-types'

// 游戏会把这些消耗装备一并放进 slot_item 实例表，但它们不占装备仓库容量。
// 与宿主 POI 的 getSlotitemCount 口径保持一致。
export const CAPACITY_EXEMPT_EQUIP_IDS = new Set<number>([42, 43, 145, 146, 150, 241])

export const countCapacitySlotitems = (slotitems: Record<number, SlotitemInstance>): number =>
  Object.values(slotitems).filter((item) => !CAPACITY_EXEMPT_EQUIP_IDS.has(item.mstId)).length
