import type { PlayerShip } from '../shared/mg-types'

import { masterShipName, mg } from './kernel'
import { remodelRootOf } from '../shared/remodel-label'

let remodelOrder: Map<number, number> | null = null
let remodelMasterCount = -1

export const invalidateRemodelOrder = () => {
  remodelOrder = null
  remodelMasterCount = -1
  rootCache = null
  rootMasterCount = -1
}

const ensureRemodelOrder = () => {
  const masterCount = Object.keys(mg.master.ships).length
  if (remodelOrder && remodelMasterCount === masterCount) return remodelOrder

  const order = new Map<number, number>()
  for (const [targetText, rows] of Object.entries(mg.master.upgrades ?? {})) {
    const target = Number(targetText)
    for (const upgrade of rows) {
      // 同目标多行时取最小 stage：形态的档位是「最早能到达它的那一步」。
      // 拿回环行的大 stage 当档位，会把 戊→改二 误判成「向更高阶推进」。
      if (target > 0) {
        order.set(target, Math.min(order.get(target) ?? Number.POSITIVE_INFINITY, upgrade.stage))
      }
      if (upgrade.originalShipId > 0 && !order.has(upgrade.originalShipId)) {
        order.set(upgrade.originalShipId, 0)
      }
    }
  }
  const incoming = new Set<number>()
  for (const master of Object.values(mg.master.ships)) {
    if (master.afterShipId > 0) incoming.add(master.afterShipId)
  }
  for (const id of Object.keys(mg.master.ships).map(Number)) {
    if (incoming.has(id)) continue
    const seen = new Set<number>()
    let current = id
    let rank = 0
    while (current > 0 && mg.master.ships[current] && !seen.has(current)) {
      seen.add(current)
      if (!order.has(current)) order.set(current, rank)
      current = mg.master.ships[current].afterShipId
      rank++
    }
  }
  remodelOrder = order
  remodelMasterCount = masterCount
  return order
}

/** 只返回真正向更高阶推进的改装；可逆转换的回边不算“下一改装”。 */
export const progressiveRemodelOf = (
  ship: PlayerShip,
): { shipId: number; level: number; name: string } | null => {
  const current = mg.master.ships[ship.shipId]
  if (!current?.afterShipId || current.afterLv <= 0) return null
  const target = mg.master.ships[current.afterShipId]
  const order = ensureRemodelOrder()
  const currentRank = order.get(ship.shipId)
  const targetRank = order.get(current.afterShipId)
  if (currentRank != null && targetRank != null && targetRank <= currentRank) return null
  if (
    (currentRank == null || targetRank == null) &&
    target?.afterShipId === ship.shipId &&
    current.afterLv >= target.afterLv
  ) {
    return null
  }
  return {
    shipId: current.afterShipId,
    level: current.afterLv,
    name: masterShipName(current.afterShipId),
  }
}

/**
 * 这条改装链的原型（「铃谷改二」→「铃谷」）。
 *
 * 只用来剥出档位标签（改 / 改二 / 航改二），所以按主数据的 afterShipId
 * 前驱方向回溯就够；判定「有没有这艘舰」另有一套（ship-ownership）。
 */
let rootCache: Map<number, number> | null = null
let rootMasterCount = -1
export const remodelChainRoot = (mstId: number): number => {
  const masterCount = Object.keys(mg.master.ships).length
  if (!rootCache || rootMasterCount !== masterCount) {
    rootMasterCount = masterCount
    const afterOf = new Map<number, number>()
    for (const [idText, ship] of Object.entries(mg.master.ships)) {
      if (ship.afterShipId > 0) afterOf.set(Number(idText), ship.afterShipId)
    }
    rootCache = new Map()
    for (const idText of Object.keys(mg.master.ships)) {
      const id = Number(idText)
      rootCache.set(id, remodelRootOf(afterOf, id))
    }
  }
  return rootCache.get(mstId) ?? mstId
}
