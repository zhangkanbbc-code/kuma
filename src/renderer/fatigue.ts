import type { PlayerShip } from '../shared/mg-types'

interface CondSeen {
  cond: number
  ts: number
}

const condSeen = new Map<number, CondSeen>()

// 游戏脸色口径：0–19 红疲劳、20–29 橙疲劳、30 起不再显示疲劳。
export const RED_FATIGUE_COND = 20
export const FATIGUE_READY_COND = 30
export const fatigueBand = (cond: number): 'red' | 'orange' | 'ready' =>
  cond < RED_FATIGUE_COND ? 'red' : cond < FATIGUE_READY_COND ? 'orange' : 'ready'

/**
 * 记录 cond 观测点。普通渲染只在数值变化时更新；confirmed=true 表示刚收到一份
 * 新的游戏舰船快照，即使数值碰巧相同，也应以这次实测重新锚定恢复时钟。
 */
export const observeFatigue = (
  ships: Iterable<PlayerShip>,
  ts = Date.now(),
  confirmed = false,
) => {
  const alive = new Set<number>()
  for (const ship of ships) {
    alive.add(ship.id)
    const prior = condSeen.get(ship.id)
    if (confirmed || !prior || prior.cond !== ship.cond) {
      condSeen.set(ship.id, { cond: ship.cond, ts })
    }
  }
  for (const id of condSeen.keys()) {
    if (!alive.has(id)) condSeen.delete(id)
  }
}

export const estimatedCond = (rosterId: number, cap = 49, now = Date.now()): number | null => {
  const seen = condSeen.get(rosterId)
  if (!seen) return null
  return Math.min(cap, seen.cond + Math.floor((now - seen.ts) / 180000) * 3)
}

export const fatigueReadyTs = (rosterId: number, target = FATIGUE_READY_COND): number | null => {
  const seen = condSeen.get(rosterId)
  if (!seen) return null
  if (seen.cond >= target) return seen.ts
  return seen.ts + Math.ceil((target - seen.cond) / 3) * 180000
}

export const observedCond = (rosterId: number): CondSeen | null => condSeen.get(rosterId) ?? null
