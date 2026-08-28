// 装备实例现在有没有人占着、被谁占着——舰上的槽（含补强增设）与基地航空队的机位都算。
//
// 这条判据本来在三处各写了一份（`renderer/modules/equip-stock.ts` 的 `buildHolders`、
// `renderer/modules/ji.ts` 的 `equippedInstIds`，再加这里），现已收成这一份：
// 那两处都从 `equipHolderMap` 派生，各自只保留自己的兜底与缓存。
// 漏掉陆航那一半是这条判据最危险的错法：仓库卷会把正在出击的攻击机报成「闲置」，
// 玩家照着去废弃，拆掉的是基地里正飞着的机体。
//
// 参数写成结构类型而不是 `MgPlayer`：这样它是纯函数，测试拿字面量就能喂。
//
// **写入顺序是行为的一部分**：先舰上（常规槽按格序，再补强增设），后陆航。
// 同一实例 id 万一在两处都冒出来（数据串了），后写的那个赢——收拢前仓库卷就是这个结果，
// 别为了「看着更合理」调顺序。

export interface SlotHost {
  /** 舰的在籍 id（占用者里的 rosterId） */
  id: number
  /** 舰的 master id */
  shipId: number
  /** 舰上的常规槽；0 表示空槽 */
  slot: readonly number[]
  /** 补强增设槽；0 表示没有或空着 */
  slotEx: number
}

export interface PlaneHost {
  /** 所属海域 */
  areaId: number
  /** 中队编号 1-3 */
  rid: number
  planes: readonly { slotId: number }[]
}

/** 谁占着这件装备。**只描述被占的**：闲置什么样由消费端自己定（仓库卷有 `idle` 一档）。 */
export type OccupiedHolder =
  | { kind: 'ship'; rosterId: number; shipId: number; slot: number; ex: boolean }
  | { kind: 'airBase'; areaId: number; rid: number; slot: number }

/** 装备实例 id → 现在占着它的是谁。没被占的实例根本不进这张表。 */
export const equipHolderMap = (
  ships: Iterable<SlotHost>,
  airBases: Iterable<PlaneHost>,
): Map<number, OccupiedHolder> => {
  const holders = new Map<number, OccupiedHolder>()
  for (const ship of ships) {
    ship.slot.forEach((slotId, index) => {
      if (slotId > 0) {
        holders.set(slotId, {
          kind: 'ship',
          rosterId: ship.id,
          shipId: ship.shipId,
          slot: index + 1,
          ex: false,
        })
      }
    })
    if (ship.slotEx > 0) {
      holders.set(ship.slotEx, {
        kind: 'ship',
        rosterId: ship.id,
        shipId: ship.shipId,
        slot: 0,
        ex: true,
      })
    }
  }
  for (const squad of airBases) {
    squad.planes.forEach((plane, index) => {
      if (plane.slotId > 0) {
        holders.set(plane.slotId, {
          kind: 'airBase',
          areaId: squad.areaId,
          rid: squad.rid,
          slot: index + 1,
        })
      }
    })
  }
  return holders
}

/** 现在被占着的装备实例 id。舰上与陆航一起数，缺一半即失真。 */
export const equippedSlotIds = (
  ships: Iterable<SlotHost>,
  airBases: Iterable<PlaneHost>,
): Set<number> => new Set(equipHolderMap(ships, airBases).keys())
