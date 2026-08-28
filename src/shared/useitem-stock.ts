export const USEITEM_MATERIAL_INDEX: Record<number, number> = {
  1: 5, // 高速修复材
  2: 4, // 高速建造材
  3: 6, // 开发资材
  4: 7, // 改修资材
  31: 0, // 燃料
  32: 1, // 弹药
  33: 2, // 钢材
  34: 3, // 铝土
}

// 31–34 是四资源在 api_mst_useitem 里的图鉴/商店入口，不是另一份库存。
// 自选奖励若把它们当独立道具扫，会跟「燃料×N」再撞出一项（By13 实锤：
// 「燃料燃料×700」拆成燃料×1 + 燃料×700 持有 0）。
export const isResourceMirrorUseitem = (id: number): boolean => {
  const idx = USEITEM_MATERIAL_INDEX[id]
  return idx != null && idx <= 3
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 任务页的奖励栏会把资源名写两遍再跟数量（「燃料燃料×700」「弹药弹药×8000」）。
// 连写只算一项；数量仍交给调用方按邻项口径截断。
export const matchMaterialRewardName = (
  normalized: string,
  name: string,
): { index: number; full: string; rawDigits: string } | null => {
  const pattern = new RegExp(`(?:${escapeRegExp(name)})+\\s*(?:×|x|\\*)?\\s*(\\d+)?`)
  const hit = pattern.exec(normalized)
  if (!hit || hit.index == null) return null
  return { index: hit.index, full: hit[0], rawDigits: hit[1] ?? '' }
}

export interface UseitemStockContext {
  materials: number[] | null
  furnitureCoins?: number
  useitems: Record<number, number>
  useitemsTs: number | null
  slotitems: Record<number, { mstId: number }>
  slotitemMasters: Record<number, { name: string }>
  slotitemsKnown: boolean
}

export interface UseitemStock {
  count: number
  known: boolean
  source: 'materials' | 'furnitureCoins' | 'slotitems' | 'useitems'
}

// api_mst_useitem 同时收录“真实道具库存”、资源入口和部分装备的商店入口。
// 持有数必须按实际存储域解析，不能把所有条目都塞进 api_useitem。
export const resolveUseitemStock = (
  id: number,
  name: string,
  context: UseitemStockContext,
): UseitemStock => {
  const materialIndex = USEITEM_MATERIAL_INDEX[id]
  if (materialIndex !== undefined) {
    return {
      count: context.materials?.[materialIndex] ?? 0,
      known: context.materials != null && typeof context.materials[materialIndex] === 'number',
      source: 'materials',
    }
  }

  if (id === 44) {
    return {
      count: typeof context.furnitureCoins === 'number' ? context.furnitureCoins : 0,
      known: typeof context.furnitureCoins === 'number',
      source: 'furnitureCoins',
    }
  }

  const mirroredSlotitemIds = Object.entries(context.slotitemMasters)
    .filter(([mstId, item]) => Number(mstId) < 1500 && item.name === name)
    .map(([mstId]) => Number(mstId))
  if (mirroredSlotitemIds.length) {
    const ids = new Set(mirroredSlotitemIds)
    return {
      count: Object.values(context.slotitems).filter((item) => ids.has(item.mstId)).length,
      known: context.slotitemsKnown,
      source: 'slotitems',
    }
  }

  return {
    count: context.useitems[id] ?? 0,
    known: id in context.useitems || context.useitemsTs != null,
    source: 'useitems',
  }
}
