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
  /** 在渠时那一格的预计修好时刻（ms）；出渠那一刻还没到点＝泼了高速修复桶 */
  dockCompleteAt?: number | null
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
  /** 入渠完成里用了高速修复桶：入渠当场泼桶（没进过渠就修满），或在渠里离预计修好还早就出来了 */
  bucket?: boolean
}

export interface RepairObserveOptions {
  sortie: boolean
  repairItems?: ReadonlyMap<number, RepairItemSignal>
  /** 现在的时刻（ms）；判出渠时还差多久到点 */
  now?: number
}

interface ShipBaseline {
  nowhp: number
  docked: boolean
  berthRepairing: boolean
  dockCompleteAt: number | null
}

/**
 * 出渠时离预计修好还差这么久以上，就算泼了桶。自然修好时报文总在到点之后（偶有几秒抖动），
 * 留一分半的余量，免得把自然出渠认成泼桶。
 */
export const BUCKET_EARLY_MS = 90_000

/**
 * 入渠维修进度 0..1：按剩余时间读——1 − 剩余 / 这次修满的总工时。
 * 拿不到总工时（0 或缺）或预计修好时刻时返回 null，调用方退回静态示意，绝不猜一个假进度。
 * 剩余比总工时还长（总工时取小了）按 0 算。
 */
export const dockRepairProgress = (completeTime: number, ndockTime: number, now: number): number | null => {
  if (!(completeTime > 0) || !(ndockTime > 0)) return null
  const remain = Math.max(0, completeTime - now)
  return Math.min(1, Math.max(0, 1 - remain / ndockTime))
}

export const createRepairWatch = () => {
  const prev = new Map<number, ShipBaseline>()
  const seenItemKeys = new Set<string>()

  return {
    observe(
      ships: readonly RepairWatchShip[],
      { sortie, repairItems, now = Date.now() }: RepairObserveOptions,
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
          dockCompleteAt: ship.docked ? ship.dockCompleteAt ?? null : null,
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
          const early = prior.dockCompleteAt != null && prior.dockCompleteAt - now > BUCKET_EARLY_MS
          events.set(ship.id, { kind: 'dock', before: prior.nowhp, after: ship.nowhp, max: ship.maxhp, bucket: early })
        } else if (prior.berthRepairing || ship.berthRepairing) {
          events.set(ship.id, { kind: 'berth', before: prior.nowhp, after: ship.nowhp, max: ship.maxhp })
        } else if (!ship.docked && ship.nowhp >= ship.maxhp) {
          // 没进过渠就修满：入渠当场泼了桶
          events.set(ship.id, { kind: 'dock', before: prior.nowhp, after: ship.nowhp, max: ship.maxhp, bucket: true })
        }
      }

      for (const id of prev.keys()) {
        if (!present.has(id)) prev.delete(id)
      }
      return events
    },
  }
}
