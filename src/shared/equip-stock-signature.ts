// 装备仓库行缓存的失效键。签名只拼数字/布尔值，不排序、不分组、不建 holder Map，
// 更不生成 HTML；收到高频 ships 补丁时，这一遍 O(S+I) 是用来挡住后面的重活。
//
// 字段必须跟消费面同步：
// - 舰的 id / shipId / slot[] / slotEx 是 equipHolderMap 生成舰上归属的完整读取面；
// - 陆航的 areaId / rid / planes[].slotId 是 equipHolderMap 生成中队归属的完整读取面；
// - 装备实例键 id 与 mstId / level / alv / locked 是 buildRows 的实例、款式、改修、
//   熟练与锁定读取面。
// 少一样就会出现「刚卸下来的装备还显示装在舰上」，或行里的状态停在旧值。
// 今后 buildRows / equipHolderMap 多读一个可变字段，必须同时把它加入这把失效键。

export interface EquipStockSignatureShip {
  id: number
  shipId: number
  slot: readonly number[]
  slotEx: number
}

export interface EquipStockSignatureAirBase {
  areaId: number
  rid: number
  planes: readonly { slotId: number }[]
}

export interface EquipStockSignatureItem {
  mstId: number
  level: number
  alv: number
  locked: boolean
}

export const equipStockSignature = (
  ships: Iterable<EquipStockSignatureShip>,
  airBases: Iterable<EquipStockSignatureAirBase>,
  slotitems: Readonly<Record<string | number, EquipStockSignatureItem>>,
): string => {
  const parts: string[] = []
  for (const ship of ships) {
    parts.push(`s:${ship.id},${ship.shipId},${ship.slot.length},${ship.slot.join(',')},${ship.slotEx};`)
  }
  for (const squad of airBases) {
    parts.push(
      `a:${squad.areaId},${squad.rid},${squad.planes.length},${squad.planes
        .map((plane) => plane.slotId)
        .join(',')};`,
    )
  }
  for (const [id, item] of Object.entries(slotitems)) {
    parts.push(`i:${id},${item.mstId},${item.level},${item.alv},${item.locked ? 1 : 0};`)
  }
  return parts.join('')
}
