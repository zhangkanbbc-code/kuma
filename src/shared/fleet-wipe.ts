// 「这一队是在哪个阶段被打光的」。
//
// 联合舰队交战时，敌主力与敌护卫是两个独立的目标池，各自被打光的时机不同：
// 开幕雷击就清掉护卫、还是拖到夜战才收尾，是完全不同的两场仗。
// 战斗流水里每一击都带 sunk 标志与阶段序，顺着放一遍就知道最后一艘倒在哪个阶段。
//
// 判据与战斗回放同源：hits[].target 用的就是 BattleShipView.index
// （联合第二舰队 6-11），所以不需要再做一次编号映射。
import type { BattleAttack, BattleShipView } from './mg-types'

export interface FleetWipe {
  /**
   * 打光这一队的最后一击落在哪个阶段（BattleAttack.stage）。
   * 全员确实已沉、但最后一击不在流水里时为 null——旧快照缺 hits，
   * 或沉没是结算侧补的。那仍然是全歼，只是说不出阶段，
   * 所以「全歼」与「哪个阶段」必须分开表达，不能用 null 一起表示。
   */
  stage: number | null
  stageLabel: string | null
}

export interface FleetWipeInput {
  ships: readonly BattleShipView[] // 待判定的那一队（已按 fleet 过滤）
  attacks: readonly BattleAttack[]
  /**
   * 判定敌方被全歼时传 0、判定我方时传 1（沿用旧口径：主要攻击来自对面）。
   * 内部按「攻击的受击侧 = 被判定侧」过滤，友军（side 2）的补刀也计入敌方全歼。
   */
  attackerSide: number
  /** 演习没有真轰沉，击破用 defeated；出击用 sunk */
  practice: boolean
}

/**
 * 这一队是否被全歼，以及打光它的最后一击在哪个阶段。
 * 没打光、或队伍本身为空 → null。
 *
 * 「全歼」只算真正参战的：开局就 0 HP 或已退避的不计入，
 * 否则一支有人退避的舰队会永远算不上被打光。
 */
export const fleetWipeStage = (input: FleetWipeInput): FleetWipe | null => {
  const engaged = input.ships.filter((ship) => ship.hpStart > 0 && !ship.escaped)
  if (!engaged.length) return null
  const down = (ship: BattleShipView) => (input.practice ? ship.defeated : ship.sunk)
  if (!engaged.every(down)) return null

  const pending = new Set(engaged.map((ship) => ship.index))
  // 只认「打向被判定这一队」的攻击。按攻击者侧过滤不够：友军（side 2）补刀敌舰
  // 该算进敌方全歼，而友军夜战段里敌方反击友军（side 1 → 友军）不该混进我方判定
  // ——hits[].target 是按受击侧编号的，认错侧就会拿友军舰的序号去消我方的账。
  const judgedSide = input.attackerSide === 0 ? 1 : 0
  const targetSideOf = (attack: BattleAttack): number =>
    attack.phase === 'friendly' || attack.phase === 'friendlyAir'
      ? attack.side === 2
        ? 1
        : 2
      : attack.side === 1
        ? 0
        : 1
  // 流水按阶段顺序生成，但排序一次更稳：回放/合并夜战后顺序不该被默认成天然有序。
  const ordered = [...input.attacks].sort((a, b) => a.stage - b.stage || a.action - b.action)
  for (const attack of ordered) {
    if (targetSideOf(attack) !== judgedSide) continue
    let emptied = false
    for (const hit of attack.hits) {
      if (!hit.sunk) continue
      pending.delete(hit.target)
      if (!pending.size) emptied = true
    }
    if (emptied) return { stage: attack.stage, stageLabel: attack.stageLabel }
  }
  // 全员确实已沉，但最后一击不在流水里（旧快照缺 hits、或沉没是结算侧补的）。
  // 这仍然是全歼，只是说不出阶段——照实返回，让 UI 划线但不标阶段。
  return { stage: null, stageLabel: null }
}
