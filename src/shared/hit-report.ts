// 编队被弹演出的战报归因（实验性，交接包「编队被弹与特色入渠动画」v2，维护者 2026-11-27 定稿）：
// 一艘我方舰在刚结算的这一段（最新的昼 / 夜段）里实际挨了哪几击、各是炮击、雷击还是反潜，
// 按伤害占比给编队行挑演出（弹孔 / 鱼雷倾侧进水 / 反潜深弹）。
// 纯逻辑层，无 DOM/Electron 依赖；一击是什么打的走动画复盘同一份判据（battle-anim-script 的 attackWeaponOf）。

import { attackWeaponOf } from './battle-anim-script'
import { segmentStartOf } from './battle-hp-timeline'
import { isSubmarineStype } from './kcs-domain'

import type { BattleAttack, BattleView } from './mg-types'

export type HitDominant = 'asw' | 'torp' | 'shell' | 'mixed'

export interface ShipHitReport {
  /** 每一击的伤害（炮击、炸弹、航空爆击；炮雷并用的一半） */
  shellHits: number[]
  /** 雷击、航空雷击（炮雷并用、航空雷爆同中的一半） */
  torpHits: number[]
  /** 潜水舰挨的每一击（深弹、航空反潜） */
  aswHits: number[]
  shellDmg: number
  torpDmg: number
  aswDmg: number
  totalDmg: number
  /** 炮击占比 0..1（反潜不计入分母，潜水舰只有 aswHits） */
  shellRatio: number
  torpRatio: number
  dominant: HitDominant
  /** 没对上战报、按这次掉血兜底成一发 */
  fallback: boolean
}

export interface HitReportOptions {
  /** 舰船 mstId → 舰种 */
  stypeOf: (mstId: number) => number | null
  /** 装备 mstId → 图鉴分类（api_type[2]）；缺了夜战只认得出潜艇的鱼雷 */
  slotTypeOf?: (mstId: number) => number | null
  /** 这艘舰（受击方）的舰种 */
  targetStype: number | null
  /** 这次侦测到的掉血；对不上战报时按它兜底 */
  drop: { before: number; after: number }
}

const AIR_PHASES = new Set<BattleAttack['phase']>(['lbas', 'injection', 'air', 'air2', 'friendlyAir'])

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

const finish = (shellHits: number[], torpHits: number[], aswHits: number[], fallback: boolean): ShipHitReport => {
  const shellDmg = sum(shellHits)
  const torpDmg = sum(torpHits)
  const aswDmg = sum(aswHits)
  const surface = shellDmg + torpDmg
  const shellRatio = surface > 0 ? shellDmg / surface : 0
  const torpRatio = surface > 0 ? torpDmg / surface : 0
  const dominant: HitDominant =
    aswDmg > 0 && surface === 0 ? 'asw' : torpRatio >= 0.7 ? 'torp' : shellRatio >= 0.7 ? 'shell' : 'mixed'
  return {
    shellHits,
    torpHits,
    aswHits,
    shellDmg,
    torpDmg,
    aswDmg,
    totalDmg: shellDmg + torpDmg + aswDmg,
    shellRatio,
    torpRatio,
    dominant,
    fallback,
  }
}

const fallbackReport = (drop: HitReportOptions['drop'], sub: boolean): ShipHitReport => {
  const dmg = Math.max(0, Math.round(drop.before - drop.after))
  if (dmg <= 0) return finish([], [], [], true)
  return sub ? finish([], [], [dmg], true) : finish([dmg], [], [], true)
}

/**
 * 归因一艘我方舰刚挨的打。
 *
 * - 只看敌方（side 1）的出手，且排除友军夜战段——那一段敌方打的是 NPC 友军，受击位与我方同号会张冠李戴
 *   （与 battle-hp-timeline 的 9242971b 修正同一判据）。
 * - 默认只取最新的昼 / 夜段（segmentStartOf）；这一段对不满这次掉血（面板没跟上、昼夜两段一起到）就往前多取一段，
 *   直到够数或取完。
 * - 受击方是潜水舰：每一击都按反潜算。航空阶段按 hits[].airKind 分（雷击 / 爆击 / 都有＝各一半），其余阶段走 attackWeaponOf。
 * - 对不上任何有伤害的命中：按这次掉血兜底成一发炮击（潜水舰一发反潜），不演没发生的事，也不抛错。
 */
export const analyzeShipHitReport = (
  battle: Pick<BattleView, 'fShips' | 'eShips' | 'attacks'> | null | undefined,
  rosterId: number,
  options: HitReportOptions,
): ShipHitReport => {
  const sub = options.targetStype != null && isSubmarineStype(options.targetStype)
  const index = battle?.fShips.find((ship) => ship.rosterId === rosterId)?.index
  if (!battle || index == null) return fallbackReport(options.drop, sub)

  const incoming = (battle.attacks ?? [])
    .filter((attack) => attack.side === 1 && attack.phase !== 'friendly')
    .filter((attack) => attack.hits.some((hit) => hit.target === index && hit.damage > 0))
  if (!incoming.length) return fallbackReport(options.drop, sub)

  // 段的划分按全场攻击算（不分敌我，与 segmentStartOf 同口径）；从最新一段往前取，够这次掉血为止
  const want = Math.max(0, options.drop.before - options.drop.after)
  const damageOn = (attack: BattleAttack) =>
    attack.hits.reduce((total, hit) => total + (hit.target === index ? Math.max(0, hit.damage) : 0), 0)
  let rest = battle.attacks ?? []
  let from = segmentStartOf(rest)
  for (;;) {
    const got = incoming.filter((attack) => attack.stage >= from).reduce((total, attack) => total + damageOn(attack), 0)
    rest = rest.filter((attack) => attack.stage < from)
    if (got >= want || !rest.length) break
    from = segmentStartOf(rest)
  }

  const stypeOfEnemy = (position: number): number | null => {
    const ship = battle.eShips.find((entry) => entry.index === position)
    return ship ? options.stypeOf(ship.mstId) : null
  }
  const shellHits: number[] = []
  const torpHits: number[] = []
  const aswHits: number[] = []
  const split = (damage: number) => {
    const half = damage / 2
    shellHits.push(half)
    torpHits.push(half)
  }
  for (const attack of incoming.filter((entry) => entry.stage >= from).sort((a, b) => a.stage - b.stage || a.action - b.action)) {
    for (const hit of attack.hits) {
      if (hit.target !== index || !(hit.damage > 0)) continue
      const damage = Math.floor(hit.damage)
      if (sub) {
        aswHits.push(damage)
        continue
      }
      if (AIR_PHASES.has(attack.phase)) {
        if (hit.airKind === 'torpedo') torpHits.push(damage)
        else if (hit.airKind === 'both') split(damage)
        else shellHits.push(damage)
        continue
      }
      const weapon = attackWeaponOf(attack, {
        attackerStype: attack.attacker >= 0 ? stypeOfEnemy(attack.attacker) : null,
        targetStype: options.targetStype,
        usedTypes: (attack.equipmentMstIds ?? [])
          .map((mstId) => options.slotTypeOf?.(mstId) ?? null)
          .filter((type): type is number => type != null),
        special: false,
      })
      if (weapon === 'torpedo') torpHits.push(damage)
      else if (weapon === 'gun-torpedo') split(damage)
      else shellHits.push(damage)
    }
  }
  if (!shellHits.length && !torpHits.length && !aswHits.length) return fallbackReport(options.drop, sub)
  return finish(shellHits, torpHits, aswHits, false)
}
