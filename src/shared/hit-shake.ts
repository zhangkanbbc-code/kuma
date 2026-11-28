// 被弹动画与递进战损（实验性，维护者裁决 2026-11-25）：
// 编队行掉血侦测、4 档物理冲击分级、常驻伤势档位，以及确定性随机玻璃裂纹骨架 + 危险线 Glitch 错相参数。
// 纯逻辑层，无 DOM/Electron 依赖，供锐的编队面板与单元测试共用。
import { damageTierOf, type DamageTier } from './battle-damage'
import { HIT_FX, HIT_REPORT_FX, hitFxTotal, hitGhostAt, hitGhostDur, hitStampAt, holeSpreadTotal } from './fleet-fx-timing'
import type { HitMotion } from './hit-damage'

export interface HitShakeInput {
  before: number
  after: number
  max: number
}

export interface HitCrackInput {
  nowhp: number
  maxhp: number
  /** 维护者裁决 2026-11-26：带伤入渠期间裂纹保留、出渠修满才洗净，所以档位不看它；留着让调用方写清楚口径 */
  docked: boolean
}

export type HitSeverity = 1 | 2 | 3 | 4

export interface HitShakeParams {
  shake: number
  glitch: number
  shatter: number
  from: number
  to: number
  dmg: number
  severity: HitSeverity
  crossedTier: boolean
  glitchBurst: boolean
  /** 扣血残影几时开始下降、降多久（含淡出）；节拍见 shared/fleet-fx-timing */
  ghostAtMs: number
  ghostDurMs: number
  /** 跨档时「中破 / 大破」盖章与故障爆闪的时刻：残影降完再停一口气 */
  stampAtMs: number
  stampMs: number
  /** 扣血跳字时长 */
  popMs: number
  /** 整段演出播完的时长：重画期间续挂被弹属性到这一刻 */
  totalMs: number
  /**
   * 战报驱动的动作（交接包 v2）：shell 水平后坐、torp 破口侧下沉倾侧、asw 垂直水压浮沉。
   * leadMs 是扣血整体往后挪的那一拍（反潜等深弹起爆、鱼雷等航迹切入），上面几个时刻都已含它。
   */
  kind: HitMotion['kind']
  leadMs: number
  /** 倾侧：这一下之前 / 落定 / 冲击峰值（deg，正＝右沉） */
  listFrom: number
  listRest: number
  listPeak: number
  /** 反潜浮沉幅度（px） */
  heaveAmp: number
}

export interface HpWatchShip {
  id: number
  nowhp: number
  maxhp: number
}

export interface HpDrop {
  before: number
  after: number
  max: number
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const TIER_RANK: Record<DamageTier | 'none', number> = {
  none: 0,
  light: 1,
  medium: 2,
  heavy: 3,
}

export const hitCrackTier = ({ nowhp, maxhp }: HitCrackInput): DamageTier | null => {
  if (maxhp <= 0 || nowhp >= maxhp) return null
  return damageTierOf(nowhp, maxhp)
}

const IMPACT_ONLY: Pick<HitMotion, 'kind' | 'leadMs' | 'listFrom' | 'listRest' | 'listPeak' | 'heaveAmp'> = {
  kind: 'shell',
  leadMs: 0,
  listFrom: 0,
  listRest: 0,
  listPeak: 0,
  heaveAmp: 0,
}

/**
 * motion 来自战报归因（shared/hit-damage 的 applyHitReport）；不给就按一发普通炮击。
 * newHoles 是这一下新添的弹孔数：整段时长要盖过它们延展完、碎片飞完。
 */
export const hitShakeParams = (
  { before, after, max }: HitShakeInput,
  motion: Pick<HitMotion, 'kind' | 'leadMs' | 'listFrom' | 'listRest' | 'listPeak' | 'heaveAmp'> = IMPACT_ONLY,
  newHoles = 0,
): HitShakeParams | null => {
  if (max <= 0 || after >= before) return null
  const dmg = Math.max(1, Math.round(before - after))
  const loss = clamp01((before - after) / max)
  const missing = clamp01(1 - after / max)
  const prevTier = damageTierOf(before, max) ?? 'none'
  const nextTier = damageTierOf(after, max) ?? 'none'
  const crossedTier = TIER_RANK[nextTier] > TIER_RANK[prevTier]

  let severity: HitSeverity = 1
  if (loss >= 0.52 || nextTier === 'heavy' || after <= 0) {
    severity = 4
  } else if (loss >= 0.30 || nextTier === 'medium') {
    severity = 3
  } else if (loss >= 0.14 || nextTier === 'light') {
    severity = 2
  }

  return {
    shake: round3(clamp01(0.1 + 0.9 * Math.pow(loss, 0.65))),
    glitch: round3(Math.pow(missing, 1.6)),
    shatter: round3(Math.pow(missing, 2)),
    from: (before / max) * 100,
    to: (after / max) * 100,
    dmg,
    severity,
    crossedTier,
    glitchBurst: prevTier !== 'heavy' && nextTier === 'heavy',
    ghostAtMs: motion.leadMs + hitGhostAt(severity),
    ghostDurMs: hitGhostDur(severity),
    stampAtMs: motion.leadMs + hitStampAt(severity),
    stampMs: HIT_FX.stamp,
    popMs: HIT_FX.pop,
    totalMs:
      motion.leadMs +
      Math.max(
        hitFxTotal(severity, crossedTier),
        motion.kind === 'torp' ? HIT_REPORT_FX.list : motion.kind === 'asw' ? HIT_REPORT_FX.heave : 0,
        holeSpreadTotal(newHoles),
        newHoles > 0 ? (newHoles - 1) * HIT_REPORT_FX.shard.holeStep + HIT_REPORT_FX.shard.large + 7 * HIT_REPORT_FX.shard.step : 0,
      ),
    kind: motion.kind,
    leadMs: motion.leadMs,
    listFrom: motion.listFrom,
    listRest: motion.listRest,
    listPeak: motion.listPeak,
    heaveAmp: motion.heaveAmp,
  }
}

export const createHpWatch = () => {
  const prev = new Map<number, number>()
  return {
    observe(ships: readonly HpWatchShip[], { battle }: { battle: boolean }): Map<number, HpDrop> {
      const drops = new Map<number, HpDrop>()
      const present = new Set<number>()
      for (const ship of ships) {
        present.add(ship.id)
        const before = prev.get(ship.id)
        if (battle && before !== undefined && ship.nowhp < before && ship.maxhp > 0) {
          drops.set(ship.id, { before, after: ship.nowhp, max: ship.maxhp })
        }
        prev.set(ship.id, ship.nowhp)
      }
      for (const id of prev.keys()) {
        if (!present.has(id)) prev.delete(id)
      }
      return drops
    },
  }
}
