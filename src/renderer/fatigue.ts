import type { PlayerShip } from '../shared/mg-types'

interface CondSeen {
  cond: number
  ts: number
}

const condSeen = new Map<number, CondSeen>()

// 游戏脸色口径：0–19 红疲劳、20–29 橙疲劳、30 起不再显示疲劳。
export const RED_FATIGUE_COND = 20
export const FATIGUE_READY_COND = 30
// 自然回复的封顶值：每 3 分钟 +3，最高只回到 49（50 以上的闪闪要靠远征/旗舰另外挣）。
// 「不再显示疲劳」是 30，「士气回满」是这一档——两个门槛问的不是同一件事。
export const FATIGUE_FULL_COND = 49
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

export const estimatedCond = (
  rosterId: number,
  cap = FATIGUE_FULL_COND,
  now = Date.now(),
): number | null => {
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

export interface FleetFatigueEta {
  /** 全队最晚那艘回到 target 的时刻；已经全员到顶（或队里一个人都没有）时为 null */
  ts: number | null
  /** 还没到 target、却没有观测锚点因而算不出时刻的舰数 */
  unknown: number
}

/**
 * 全队的疲劳恢复时刻：**舰行那份单舰估算对全队取 max**。
 *
 * 每一艘都走上面的 `fatigueReadyTs`，锚点也还是同一张 `condSeen`——
 * 这里只是把「最晚的那个」挑出来，不是第二套推算。
 * 目标位默认 49（自然回复的封顶），编队抬头问的就是「什么时候全队士气回满」；
 * 舰行倒计时问的是「什么时候不再算疲劳」，所以那边传的是 30。
 *
 * 已经到顶的舰不参与；算得出但已经过点的也不参与（她已经回满了）。
 * 缺观测锚点的舰单独计数交给调用方——**不许当成「她回满了」**。
 */
export const fleetFatigueEta = (
  ships: Iterable<{ id: number; cond: number }>,
  target = FATIGUE_FULL_COND,
  now = Date.now(),
): FleetFatigueEta => {
  let ts: number | null = null
  let unknown = 0
  for (const ship of ships) {
    if (ship.cond >= target) continue
    const ready = fatigueReadyTs(ship.id, target)
    if (ready == null) {
      unknown += 1
      continue
    }
    if (ready > now && (ts == null || ready > ts)) ts = ready
  }
  return { ts, unknown }
}
