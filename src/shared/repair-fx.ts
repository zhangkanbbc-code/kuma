// 修理与保命演出判定（实验性，维护者裁决 2026-11-26）：
// 侦测入渠完成（含用桶）、母港泊地修理落账、出击紧急泊地修理、要员(42)/女神(43)发动。
// 纯逻辑层，无 DOM/Electron 依赖，供锐编队面板与单元测试共用。

export type RepairFxKind = 'dock' | 'berth' | 'anchorage' | 'damecon' | 'goddess'

export interface RepairWatchShip {
  id: number
  nowhp: number
  maxhp: number
  docked: boolean
  berthRepairing: boolean
}

export interface RepairItemSignal {
  item: 42 | 43
  key: string
}

export interface RepairFxEvent {
  kind: RepairFxKind
  before: number
  after: number
  max: number
}

export interface RepairObserveOptions {
  sortie: boolean
  repairItems?: ReadonlyMap<number, RepairItemSignal>
}

interface ShipBaseline {
  nowhp: number
  docked: boolean
  berthRepairing: boolean
}

export const createRepairWatch = () => {
  const prev = new Map<number, ShipBaseline>()
  const seenItemKeys = new Set<string>()

  return {
    observe(
      ships: readonly RepairWatchShip[],
      { sortie, repairItems }: RepairObserveOptions,
    ): Map<number, RepairFxEvent> {
      const events = new Map<number, RepairFxEvent>()
      const present = new Set<number>()
      if (!sortie) seenItemKeys.clear()

      for (const ship of ships) {
        present.add(ship.id)
        const prior = prev.get(ship.id)
        prev.set(ship.id, {
          nowhp: ship.nowhp,
          docked: ship.docked,
          berthRepairing: ship.berthRepairing,
        })
        if (!prior || ship.maxhp <= 0) continue

        if (sortie) {
          const signal = repairItems?.get(ship.id)
          if (signal) {
            if (!seenItemKeys.has(signal.key)) {
              seenItemKeys.add(signal.key)
              events.set(ship.id, {
                kind: signal.item === 43 ? 'goddess' : 'damecon',
                before: prior.nowhp,
                after: ship.nowhp,
                max: ship.maxhp,
              })
            }
            continue
          }
          if (ship.nowhp > prior.nowhp) {
            events.set(ship.id, {
              kind: 'anchorage',
              before: prior.nowhp,
              after: ship.nowhp,
              max: ship.maxhp,
            })
          }
          continue
        }

        if (ship.nowhp <= prior.nowhp) continue
        if (prior.docked && !ship.docked && ship.nowhp >= ship.maxhp) {
          events.set(ship.id, { kind: 'dock', before: prior.nowhp, after: ship.nowhp, max: ship.maxhp })
        } else if (prior.berthRepairing || ship.berthRepairing) {
          events.set(ship.id, { kind: 'berth', before: prior.nowhp, after: ship.nowhp, max: ship.maxhp })
        } else if (!ship.docked && ship.nowhp >= ship.maxhp) {
          events.set(ship.id, { kind: 'dock', before: prior.nowhp, after: ship.nowhp, max: ship.maxhp })
        }
      }

      for (const id of prev.keys()) {
        if (!present.has(id)) prev.delete(id)
      }
      return events
    },
  }
}
