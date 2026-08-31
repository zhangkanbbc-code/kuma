// 把一场战斗的战损拆成「昼战段」与「夜战段」。
//
// 战斗行原本只给 hpStart→hpEnd，一场昼夜连打下来看不出是白天挨的还是夜里挨的。
// 舰的记录里没有分段 HP，但攻击流里每一击都带 phase 与伤害，按 phase 归并即可还原。
//
// 实测 2026-08-09：200 场快照、2013 条逐舰核对，
// hpStart − 昼伤 − 夜伤 与 hpEnd **完全一致**（其中真正受过伤的 334 条也全对）。
// 护卫替身与应急修理都已经体现在 hits 里，不必另外建模。

/** 夜战段：夜战本体与 NPC 友军夜战。其余（含开幕/航空/支援/雷击）都算昼战段。 */
const NIGHT_PHASES = new Set(['night', 'friendly'])

export interface PhaseDamageInput {
  attacks: {
    phase: string
    side: number // 0 我方 / 1 敌方 / 2 NPC 友军
    attacker?: number // 攻方位置；-1 = 无逐舰归属（航空/支援）
    hits?: { target: number; damage: number }[]
  }[]
}

export interface PhaseDamage {
  day: number
  night: number
}

// 「某一舰**挨了**多少，昼夜各算」曾经也在这里（phaseDamageOf）。血条改成跟着
// 流水回放之后，受伤那半交给 battle-hp-timeline 的逐击重放——它连每个阶段结算后
// 剩多少都给得出来，昼夜两个总数只是它的一个切面，再留一份迟早两处说法打架。

export type BattlePhase = 'day' | 'night'

/**
 * 这场战斗有没有**明确的阶段切换**，以及谁先谁后。
 *
 * 只有两种场次真的换过阶段：
 *   · `day` 且合并了夜战包 —— 昼战打完追击夜战；
 *   · `nightday` —— 开幕就是夜战，天亮后转昼战。**顺序与上面相反**。
 *
 * 其余一律 null：`nightonly` 整场都是夜战（虽然 hasNight 也是 true，
 * 但从头到尾没换过阶段），`airbattle`/`airraid`/`radar`/`baseDefense`
 * 更是单阶段节点。把它们也当成「有阶段」会让血条凭空换一次基准。
 *
 * `subAirRaid`（对潜空袭）跟着 `day` 走：wikiwiki「戦闘について」写的是
 * 「戦闘自体は通常戦と同様の順番で進行する」，它只是敌方多一条不可攻击的空母，
 * 流程与通常昼战同一套。本机还没有一场它接夜战包的样本，所以这一支是照机制留的口子，
 * 真接上了血条才不会漏换基准。
 */
export const battlePhaseOrder = (
  kind: string,
  hasNight: boolean,
): { first: BattlePhase; second: BattlePhase } | null => {
  if (kind === 'nightday') return { first: 'night', second: 'day' }
  if ((kind === 'day' || kind === 'subAirRaid') && hasNight) {
    return { first: 'day', second: 'night' }
  }
  return null
}

// 与 di.ts 里那张攻击阶段表（lbas/gun1/…）不是一回事，名字取具体些免得撞车
export const DAY_NIGHT_LABEL: Record<BattlePhase, string> = { day: '昼战', night: '夜战' }

// 血量的分段与血条三截都搬去了 battle-hp-timeline：那边照解析层的规则逐击重放，
// 得到的是每个阶段结算后的准确血量。这里曾有个 phaseMidHp，用「昼伤/夜伤两个总数
// 按顺序分配再截断」凑中间值——`hits` 记的是攻击伤害而不是扣血，致命一击的溢出
// 照样记着（实测 618 条受伤记录里 360 条逐段之和大于掉血，其中 311 条是被击沉的），
// 只有总数时除了截断没有别的办法。逐击重放不受这个限制，那个将就的实现就删了。

/** 这一击属于昼战段还是夜战段。 */
export const isNightPhase = (phase: string): boolean => NIGHT_PHASES.has(phase)

/**
 * 某一舰**打出**的伤害，按昼/夜分开。
 *
 * 与受伤那边的分工：受伤看 hits[].target（现在走时间轴逐击重放），输出看 attack.attacker。
 * 航空/支援这类没有逐舰归属的攻击 attacker = -1，自然不计入任何一舰，
 * 所以逐舰之和会小于「输出合计」——这是事实，不去替它凑平。
 */
export const dealtByPhaseOf = (
  battle: PhaseDamageInput | null | undefined,
  shipIndex: number,
  enemy: boolean,
): PhaseDamage => {
  const out: PhaseDamage = { day: 0, night: 0 }
  if (!battle?.attacks?.length) return out
  for (const attack of battle.attacks) {
    // 敌舰的输出来自 side=1 的攻击；我方来自 side=0（NPC 友军 2 单列，不并进任何一方）
    if (enemy ? attack.side !== 1 : attack.side !== 0) continue
    if (attack.attacker !== shipIndex) continue
    for (const hit of attack.hits ?? []) {
      const damage = Number(hit.damage)
      if (!Number.isFinite(damage) || damage <= 0) continue
      if (isNightPhase(attack.phase)) out.night += damage
      else out.day += damage
    }
  }
  return out
}
