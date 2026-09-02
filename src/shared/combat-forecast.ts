// 出击前战力估算的纯计算层。
//
// 这是“机制模型”，不是把个人胜率换个名字再显示：
// - 舰娘最终面板、等级、士气、补给、装备命中/回避/雷装/爆装、改修与熟练度入模；
// - 深海舰最终数值、装备与搭载入模；
// - 制空、昼炮击/雷击的软上限、命中/回避和装甲乱数均按战斗模型的稳定结构计算；
// - 目标选择、特殊攻击、活动特效、对地与部分联合常数仍有未知量，因此输出“推定范围”，
//   绝不冒充服务器逐骰模拟。

import { BATTLESHIP_STYPES, CARRIER_STYPES, SUBMARINE_STYPES } from './kcs-domain'
import { antiLandBonus, landTargetKindOf } from './anti-land'
import { nightAttackBlock, nightPower } from './night-battle'
import type { NightBlockReason } from './night-battle'
import { fleetLosCorrectionOf, fleetLosScoreOf, spottingMultiplier } from './day-spotting'
import { openingAswOf } from './ship-special-attack'
import { landBaseWavePower } from './land-base-attack'
import type { LandBaseWaveInput } from './land-base-attack'

export interface ForecastEquipment {
  mstId: number
  type2: number
  /** api_type[3]：先制对潜的判据要看图标（声呐/爆雷分不出 type2 时靠它） */
  iconId: number
  /** api_saku：弾着観測射撃的発動率要用装備索敵値合計 */
  los: number
  firepower: number
  torpedo: number
  bomb: number
  antiAir: number
  asw: number
  accuracy: number
  evasion: number
  armor: number
  level: number
  proficiency: number
  planeCount: number
  preventsTDisadvantage: boolean
}

export interface ForecastShip {
  role: 'main' | 'escort'
  mstId: number
  // 对地补正要按敌舰的族名分类、按 api_soku 判是否陆上型。缺省时当作非陆上型，
  // 也就是不吃对地补正——宁可少算，不套错一个数量级。
  name?: string
  speed?: number
  /**
   * 该舰的额外伤害倍率（活动特效倍卡等），**cap 后**施加。
   * 由适配层算好填进来——本层不认「倍卡」这个概念，只认一个倍率，
   * 这样活动换代时改的是资料包与适配层，战斗模型不动。
   * 依据：搬运贴原文「基本的にはキャップ後補正です」。
   */
  damageBonus?: number
  level: number
  stype: number
  /** api_ctype 舰级。先制对潜有整级生效的规则（J 级改、Fletcher 级…） */
  ctype?: number
  /** api_slot_num 常规装备格数。先制对潜的「几格声呐」类规则要用 */
  slotNum?: number
  /** 是否为改造后形态。先制对潜有若干「改二才有」的规则 */
  kai?: boolean
  /** 是否为该舰队旗舰。弾着観測射撃的旗舰补正 +15 */
  flagship?: boolean
  /**
   * **素**索敵（不含任何装备）。弾着観測射撃的 `艦隊索敵補正` 要整队的素索敵合计。
   *
   * 可选：填不出来的适配层（深海舰没有这个概念、演习对手的素索敵也读不到）
   * 就不填，那一支的補正按 0 算——**少算**発動率，不是「这支队补正为 0」。
   */
  baseLos?: number
  hp: number
  hpMax: number
  firepower: number
  torpedo: number
  antiAir: number
  armor: number
  evasion: number
  asw: number
  luck: number
  condition: number
  fuelRate: number
  ammoRate: number
  equipment: ForecastEquipment[]
}

export interface ForecastFleet {
  ships: ForecastShip[]
  combinedType: number
}

export interface EncounterForecastInput {
  friendly: ForecastFleet
  enemy: ForecastFleet
  enemyFormation: number
  friendlyFormation?: number
  /**
   * 本次派向该点的基地航空波次。**航空战不受 cap 前补正**（交战形态、阵形、损伤都不影响），
   * 所以它不能混进 fleetOutput 跟着昼战一起乘交战形态系数，只能作为独立项加在外面。
   * 空数组 = 该点没派陆航（道中点常见），不是「没有陆航」。
   */
  landBaseWaves?: readonly LandBaseWaveInput[]
  /**
   * 敌方是玩家舰队（演习）：制空判定对敌方同样成立，制空在敌方手里时
   * 敌方也发动弾着観測射撃。深海敌人没有这一层，保持 false。
   *
   * 实测教训（2026-08-10 演习 D 败 vs 模型 B+ 64–91%）：对手双空母 84 机
   * 拿到制空确保后打出 3 次观测连击、场均 17 点/发——这层不建模，
   * 区间下界就是虚的。
   */
  enemySpotting?: boolean
}

export interface ForecastAirState {
  friendlyMin: number
  friendlyMax: number
  enemy: number
  stateMin: number
  stateMax: number
}

/**
 * 这一次估算里**实际参与了哪几层机制**。
 *
 * 存在的理由：模型是逐层长出来的，「有没有算进去」会随版本和局面变。
 * 把它当结构化事实报出来，说明文字才不会说谎——
 * 以前这里只有一句写死的「活动特效…与基地航空队未自动假定发动」，
 * 而那两层早就接进来了，字面与实现各说各话。
 */
export interface ForecastFactors {
  /** 吃到额外伤害倍率（活动特效倍卡等）的我方舰数 */
  bonusShips: number
  /** 敌方陆上型目标数；>0 表示对地补正参与了本次估算 */
  landTargets: number
  /** 计入本点的基地航空波次数 */
  landBaseWaves: number
  /** 联合舰队编成（0 = 非联合） */
  combinedType: number
  mainCount: number
  escortCount: number
  shipCount: number
  /** 昼战能发动弾着観測射撃的我方舰数（含连击）。制空不够时为 0 */
  spottingShips: number
  /** 有先制对潜的我方舰数 */
  openingAswShips: number
  /** 这一夜真正能出手的我方舰数 */
  nightAttackers: number
  /** 出不了手的按**具体拦下它的规则**分组计数，界面要说得清「为什么只有 6 舰参加」 */
  nightBlocked: Partial<Record<NightBlockReason, number>>
}

export interface EncounterMechanicForecast {
  bPlus: number
  sa: number
  taiha: number
  air: ForecastAirState
  friendlyPressure: number
  enemyPressure: number
  friendlyFormation: number
  engagement: 'natural' | 'saiun'
  confidence: 'B' | 'C'
  factors: ForecastFactors
  /** 追进夜战之后的同三项。与上面三项并列，不合并——夜战是昼战结束时才做的选择。 */
  night: { bPlus: number; sa: number; taiha: number }
  assumptions: string[]
}

export interface ForecastRange {
  min: number
  max: number
}

export interface EncounterForecastBand {
  bPlus: ForecastRange
  sa: ForecastRange
  taiha: ForecastRange
  airStates: number[]
  candidates: number
  confidence: 'B' | 'C'
  friendlyFormations: number[]
  engagements: ('natural' | 'saiun')[]
  /** 各候选编成里参与层数最多的那一套；陆上型目标数按候选取最大 */
  factors: ForecastFactors
  /** 追进夜战之后的同三项区间 */
  night: { bPlus: ForecastRange; sa: ForecastRange; taiha: ForecastRange }
  assumptions: string[]
}

const AIRCRAFT_EXP = [0, 10, 25, 40, 55, 70, 85, 100, 121]
const AIR_LEVEL_BONUS: Record<number, number[]> = {
  6: [0, 0, 2, 5, 9, 14, 14, 22, 22],
  7: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  8: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  11: [0, 1, 1, 1, 1, 3, 3, 6, 6],
  26: [0, 0, 2, 5, 9, 14, 14, 22, 22],
  45: [0, 0, 2, 5, 9, 14, 14, 22, 22],
  47: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  48: [0, 0, 2, 5, 9, 14, 14, 22, 22],
  56: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  57: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  58: [0, 0, 0, 0, 0, 0, 0, 0, 0],
}
const AIR_TYPES = new Set([6, 7, 8, 11, 26, 45, 47, 48, 56, 57, 58])
const ENGAGEMENTS = [
  { id: 1, multiplier: 1, natural: 0.45, saiun: 0.45 },
  { id: 2, multiplier: 0.8, natural: 0.3, saiun: 0.4 },
  { id: 3, multiplier: 1.2, natural: 0.15, saiun: 0.15 },
  { id: 4, multiplier: 0.6, natural: 0.1, saiun: 0 },
] as const

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const softCap = (value: number, cap: number) =>
  value <= cap ? value : cap + Math.sqrt(value - cap)

const logistic = (value: number) => 1 / (1 + Math.exp(-value))
const percent = (value: number) => Math.round(clamp(value, 0, 1) * 100)

const airPower = (fleet: ForecastFleet, proficiency: 'min' | 'max'): number => {
  let total = 0
  for (const ship of fleet.ships) {
    for (const item of ship.equipment) {
      if (!AIR_TYPES.has(item.type2) || item.planeCount <= 0 || item.antiAir <= 0) continue
      const alv = clamp(Math.trunc(item.proficiency), 0, 7)
      const fixed = AIR_LEVEL_BONUS[item.type2]?.[alv] ?? 0
      const internal =
        proficiency === 'min'
          ? AIRCRAFT_EXP[alv]
          : AIRCRAFT_EXP[Math.min(8, alv + 1)] - 1
      const improvement =
        item.antiAir > 3 ? item.level * (item.bomb > 0 ? 0.25 : 0.2) : 0
      total += Math.floor(
        Math.sqrt(item.planeCount) * (item.antiAir + improvement) +
          Math.sqrt(Math.max(0, internal) / 10) +
          fixed,
      )
    }
  }
  return total
}

const fleetRole = (ship: ForecastShip): 'main' | 'escort' =>
  ship.role === 'escort' ? 'escort' : 'main'

// 我方联合对普通舰队时，开幕航空战只有第一舰队参加；对敌联合时两队参加。
// 当前离线敌编成通常是普通舰队，但保留对称分支，避免以后接入敌联合后再改口径。
const airCombatFleet = (
  fleet: ForecastFleet,
  opponent: ForecastFleet,
): ForecastFleet =>
  fleet.combinedType > 0 && opponent.combinedType <= 0
    ? {
        ...fleet,
        ships: fleet.ships.filter((ship) => fleetRole(ship) === 'main'),
      }
    : fleet

// api_disp_seiku 同口径：0 均衡 / 1 确保 / 2 优势 / 3 劣势 / 4 丧失。
export const forecastAirStateOf = (friendly: number, enemy: number): number => {
  if (enemy <= 0) return 1
  if (3 * friendly <= enemy) return 4
  if (3 * friendly <= 2 * enemy) return 3
  if (2 * friendly < 3 * enemy) return 0
  if (friendly < 3 * enemy) return 2
  return 1
}

/**
 * 昼战的改修强化值。**按相位分开**——同一件装备在昼炮击与雷击两相的系数不是一回事。
 *
 * 昼炮击相：**大口径主炮（api_type[2]=3）** 单独一档 `1.5√★`，领域文档
 * `舰队收藏-战斗计算模型.md` §16.2 明载「大口径主炮 昼炮击 1.5√★、夜战 √★」，
 * 而这里原先把它和小/中口径混在同一档 `1.0√★`，昼炮击整片低估。
 * 夜战那一路不在本函数里——它在 `shared/night-battle.ts` 的 `nightImprovement`，
 * 大口径本来就写着 √★，与文档一致，不必动。
 *
 * 雷击相：**只有雷装系装备参与，炮/弹/声呐一律 0**。已去日文一手核过——
 * wikiwiki「改修工廠」<https://wikiwiki.jp/kancolle/%E6%94%B9%E4%BF%AE%E5%B7%A5%E5%BB%A0>
 * 的「装備別補正値(検証中)」那张表是**按相位分列**的（列头：装備分類／砲撃戦／雷撃戦／
 * 夜戦／対潜攻撃／備考），不是笼统的「攻撃力に加算」；其中「雷撃戦」一列非零的只有
 * 魚雷 `1.2√★`、対空機銃 `1.2√★`、潜水艦魚雷 `0.2★` 三行，大口径主炮／小口径主炮／
 * 中口径主炮／副砲／徹甲弾／高角砲／水上偵察機／特殊潜航艇／ソナー／爆雷 全部写 0。
 * 「戦闘について」页的雷击攻击力式子里那一项也写作「改修強化値(雷撃)」，取的正是这一列。
 * 页面最后更新 2026-08-17，查证日 2026-08-22。原先炮类在雷击相仍给 √★，是整片高估。
 *
 * 未订正项（改非零系数需另行裁定）：
 * 対空機銃(21) 一手表写雷击 `1.2√★`，这里仍是 `√★`；潜水艦魚雷(32) 一手表写雷击
 * `0.2★`，这里仍是 `1.2√★`。昼炮击那一列也还有出入（魚雷/特殊潜航艇一手表写 0）。
 */
const improvementPower = (item: ForecastEquipment, phase: 'shell' | 'torpedo'): number => {
  if (item.level <= 0) return 0
  const root = Math.sqrt(item.level)
  if (phase === 'torpedo') {
    // 一手表「雷撃戦」列非零的只有这三类，其余装备不进雷击攻击力。
    if (item.type2 === 5) return 1.2 * root
    if (item.type2 === 32) return 1.2 * root
    if (item.type2 === 21) return root
    return 0
  }
  if (item.type2 === 3) return 1.5 * root
  if ([1, 2, 4, 18, 19, 21].includes(item.type2)) return root
  if ([5, 22, 32].includes(item.type2)) return 1.2 * root
  if ([14, 15, 40].includes(item.type2)) return 0.75 * root
  return 0
}

/** 只给护栏用的窗口：把上面那张表按相位读出来，免得测试去反推整队输出。 */
export const forecastImprovementPower = (
  item: Pick<ForecastEquipment, 'type2' | 'level'>,
  phase: 'shell' | 'torpedo',
): number => improvementPower(item as ForecastEquipment, phase)

const improvementAccuracy = (item: ForecastEquipment): number => {
  if (item.level <= 0) return 0
  const root = Math.sqrt(item.level)
  if ([5, 22, 32].includes(item.type2)) return 2 * root
  if ([1, 2, 3, 4, 12, 13].includes(item.type2)) return root
  return 0
}

const moraleAttack = (condition: number) =>
  condition >= 50 ? 1.2 : condition < 20 ? 0.5 : condition < 30 ? 0.8 : 1

const moraleDefense = (condition: number) =>
  condition >= 50 ? 0.7 : condition < 20 ? 1.4 : condition < 30 ? 1.2 : 1

const softEvasion = (value: number): number => {
  if (value < 40) return value
  if (value < 65) return Math.floor(40 + 3 * Math.sqrt(value - 40))
  return Math.floor(55 + 2 * Math.sqrt(value - 65))
}

const hitRate = (
  attacker: ForecastShip,
  defender: ForecastShip,
  phase: 'shell' | 'torpedo',
): number => {
  const equipmentAccuracy = attacker.equipment.reduce(
    (sum, item) => sum + item.accuracy + improvementAccuracy(item),
    0,
  )
  const base =
    (phase === 'torpedo' ? 85 : 90) +
    2 * Math.sqrt(Math.max(1, attacker.level)) +
    1.5 * Math.sqrt(Math.max(0, attacker.luck)) +
    equipmentAccuracy +
    (phase === 'torpedo' ? Math.floor(0.2 * Math.min(180, attacker.torpedo)) : 0)
  const fuelPenalty = Math.max(0, 75 - clamp(defender.fuelRate, 0, 100))
  const evade = Math.max(
    0,
    softEvasion(defender.evasion + Math.sqrt(2 * Math.max(0, defender.luck))) -
      fuelPenalty,
  )
  return clamp(((base * moraleAttack(attacker.condition) - evade) * moraleDefense(defender.condition)) / 100, 0.1, 0.97)
}

const ammoCorrection = (rate: number) => clamp(rate / 50, 0, 1)

const formationPower = (
  formation: number,
  phase: 'shell' | 'torpedo' | 'asw',
): number => {
  const normal: Record<number, [number, number, number]> = {
    1: [1, 1, 0.6],
    2: [0.8, 0.8, 0.8],
    3: [0.7, 0.7, 1.2],
    4: [0.75, 0.6, 1.1],
    5: [0.6, 0.6, 1.3],
    // 警戒阵存在舰位差，整队预报只能用保守的聚合值，不能假装逐舰精确。
    6: [0.75, 0.6, 1],
    11: [0.8, 0.7, 1.3],
    12: [1, 0.9, 0.9],
    13: [0.7, 0.7, 1.1],
    14: [1.1, 1, 0.7],
  }
  const row = normal[formation] ?? normal[1]
  return row[phase === 'shell' ? 0 : phase === 'torpedo' ? 1 : 2]
}

const defaultFriendlyFormation = (
  friendly: ForecastFleet,
  enemy: ForecastFleet,
): number => {
  const allSubmarines =
    enemy.ships.length > 0 &&
    enemy.ships.every((ship) => SUBMARINE_STYPES.has(ship.stype))
  if (friendly.combinedType > 0) return allSubmarines ? 11 : 14
  return allSubmarines ? 5 : 1
}

// preCap（对地的 cap 前补正）必须乘在 softCap **之前**——那正是「阈值前补正」的定义。
// 乘在外面等于当成 cap 后补正，会把它高估：超上限的部分本该被开方压掉。
const shellPower = (
  ship: ForecastShip,
  formation: number,
  engagement: number,
  combinedBonus = 0,
  preCap = 1,
): number => {
  const improvement = ship.equipment.reduce(
    (sum, item) => sum + improvementPower(item, 'shell'),
    0,
  )
  if (CARRIER_STYPES.has(ship.stype)) {
    const planeTorpedo = ship.equipment.reduce(
      (sum, item) => sum + Math.max(0, item.torpedo),
      0,
    )
    const planeBomb = ship.equipment.reduce((sum, item) => sum + Math.max(0, item.bomb), 0)
    return softCap(
      (55 + Math.floor(1.5 * (ship.firepower + planeTorpedo + Math.floor(1.3 * planeBomb) + improvement + combinedBonus))) *
        formationPower(formation, 'shell') *
        engagement *
        preCap,
      220,
    )
  }
  return softCap(
    (ship.firepower + 5 + improvement + combinedBonus) *
      formationPower(formation, 'shell') *
      engagement *
      preCap,
    220,
  )
}

const torpedoPower = (
  ship: ForecastShip,
  formation: number,
  engagement: number,
  combinedBonus = 0,
): number =>
  softCap(
    (ship.torpedo +
      5 +
      ship.equipment.reduce((sum, item) => sum + improvementPower(item, 'torpedo'), 0) +
      combinedBonus) *
      formationPower(formation, 'torpedo') *
      engagement,
    180,
  )

const expectedDamage = (
  attacker: ForecastShip,
  defender: ForecastShip,
  phase: 'shell' | 'torpedo',
  attackerFormation: number,
  engagement: number,
  combinedBonus = 0,
  antiLand: { preCap: number; postCap: number } = { preCap: 1, postCap: 1 },
): number => {
  // 三段的位置各有讲究，错一段就差一个量级：
  //   preCap  → softCap 之前（在 shellPower 内部施加，会被开方压缩）
  //   postCap → softCap 之后、**减装甲之前**
  //   减装甲  → 最后
  // 从前两段都乘在减完装甲之后，等于既高估 preCap 又低估 postCap。
  const capped =
    phase === 'shell'
      ? shellPower(attacker, attackerFormation, engagement, combinedBonus, antiLand.preCap)
      : torpedoPower(attacker, attackerFormation, engagement, combinedBonus)
  // 活动特效与对地的 cap 后补正在同一位置叠乘
  const power = capped * antiLand.postCap * Math.max(1, attacker.damageBonus ?? 1)
  const hit = hitRate(attacker, defender, phase)
  // 装甲乱数 0.7A + floor(0.6A×U) 的期望近似为 A；未穿甲时保留擦伤期望。
  const penetration = Math.max(0, power - defender.armor)
  const scratch = Math.max(1, defender.hp * 0.06)
  const onHit = penetration > 0 ? penetration : scratch
  return hit * onHit * ammoCorrection(attacker.ammoRate)
}

const averageDefender = (ships: ForecastShip[]): ForecastShip => {
  const usable = ships.length ? ships : [{
    role: 'main' as const,
    mstId: 0,
    level: 1,
    stype: 0,
    hp: 1,
    hpMax: 1,
    firepower: 0,
    torpedo: 0,
    antiAir: 0,
    armor: 0,
    evasion: 0,
    asw: 0,
    luck: 0,
    condition: 49,
    fuelRate: 100,
    ammoRate: 100,
    equipment: [],
  }]
  const avg = (pick: (ship: ForecastShip) => number) =>
    usable.reduce((sum, ship) => sum + pick(ship), 0) / usable.length
  return {
    mstId: 0,
    level: avg((ship) => ship.level),
    stype: 0,
    hp: avg((ship) => ship.hp),
    hpMax: avg((ship) => ship.hpMax),
    firepower: avg((ship) => ship.firepower),
    torpedo: avg((ship) => ship.torpedo),
    antiAir: avg((ship) => ship.antiAir),
    armor: avg((ship) => ship.armor),
    evasion: avg((ship) => ship.evasion),
    asw: avg((ship) => ship.asw),
    luck: avg((ship) => ship.luck),
    condition: avg((ship) => ship.condition),
    fuelRate: avg((ship) => ship.fuelRate),
    ammoRate: avg((ship) => ship.ammoRate),
    equipment: [],
    role: usable.every((ship) => fleetRole(ship) === 'escort') ? 'escort' : 'main',
  }
}

// 我方联合对普通敌舰队时的昼炮击火力常数。第一/第二舰队不能压成一个
// “12 舰平均值”，三种联合类型的两队补正方向并不相同。
const combinedShellBonus = (
  fleet: ForecastFleet,
  ship: ForecastShip,
): number => {
  if (fleet.combinedType <= 0) return 0
  const escort = fleetRole(ship) === 'escort'
  if (fleet.combinedType === 1) return escort ? 10 : 2
  if (fleet.combinedType === 2) return escort ? -5 : 10
  if (fleet.combinedType === 3) return escort ? 10 : -5
  return 0
}

// 昼战炮击轮数。
//
// 联合舰队 = **主力两轮 + 护卫一轮**（本机 154 场战斗快照实测）。水上打击是主力
// gun1+gun2、护卫 gun3；机动部队是护卫 gun1、主力 gun2+gun3——先后顺序不同，轮数一致。
// （少于这个数的场次是敌方在首轮就被打光、后续阶段没有攻击记录，不是没有那一轮。）
//
// 单队 = 看有没有战舰。wikiwiki「戦闘について」原文：
//   「敵味方艦隊のいずれか、又は両方に**戦艦(航空戦艦含む)**がいる場合に発生」
//   「砲撃戦(1巡目)終了までにすべての戦艦が轟沈した場合でも2巡目は発生する」
//     → 开战时就定死，不随战况变，所以按初始编成判即可。
//   敌方的「鬼」「姫」等内部按战舰/航空战舰处理的，api_stype 本来就是战舰系，一并覆盖。
// 本机 77 场单队昼战复核：「任一方有战舰」命中 20/20、误报 0、漏报 0，完全分离；
// 「任一方有空母」有 12 次误报——空母不是判据，别顺手加进去。
//
// 从前这里不分轮数，每舰一律只算一次炮击，是预测系统性低估约 3 倍的主因。
const hasBattleship = (fleet: ForecastFleet): boolean =>
  fleet.ships.some((ship) => BATTLESHIP_STYPES.has(ship.stype))

const shellRounds = (
  attackers: ForecastFleet,
  ship: ForecastShip,
  defenders: ForecastFleet,
): number => {
  if (attackers.combinedType > 0) return fleetRole(ship) === 'main' ? 2 : 1
  return hasBattleship(attackers) || hasBattleship(defenders) ? 2 : 1
}

// 对地补正必须**逐个敌人**算：同一件装备对不同陆上型差一个数量级
// （三式弾对集積地 ×2.5、对トーチカ ×1.0 完全无效），拿平均防御者算一次是错的。
// 这里按各陆上型的血量占比加权，得到该攻击者在这支敌队上的期望倍率——
// 仍是估算（真实目标选择有随机性），但比"不算"和"一律按某一类算"都近。
const antiLandFactorOf = (
  attacker: ForecastShip,
  defenders: ForecastFleet,
): { preCap: number; postCap: number } => {
  const equips = attacker.equipment.map((item) => ({
    mstId: item.mstId,
    type2: item.type2,
    level: item.level,
  }))
  let pre = 0
  let post = 0
  let total = 0
  for (const enemy of defenders.ships) {
    const hp = Math.max(1, enemy.hpMax)
    total += hp
    const kind = landTargetKindOf({ name: enemy.name ?? '', speed: enemy.speed ?? 1 })
    if (!kind) {
      // 非陆上型不吃对地补正
      pre += hp
      post += hp
      continue
    }
    const bonus = antiLandBonus(attacker.mstId, equips, kind)
    pre += hp * bonus.preCap * bonus.dayOnlyPreCap
    post += hp * bonus.postCap
  }
  if (total <= 0) return { preCap: 1, postCap: 1 }
  return { preCap: pre / total, postCap: post / total }
}

/**
 * 夜战一轮的整队输出。
 *
 * 与昼战的结构性差别（口径见 shared/night-battle.ts 抄录的 wikiwiki 原文）：
 *   · 不受交战形态与阵形补正（警戒阵对主力舰减半是唯一例外，在 nightPower 里）；
 *   · 联合舰队只有第二舰队参战，第一舰队整队不出手；
 *   · 大破舰、空母不出手；
 *   · 每舰一轮，没有主力两轮那回事——那是昼战炮击的规则。
 *
 * 对潜沿用昼战那套（wikiwiki：夜战中素对潜 ≥1 的舰仍优先对潜攻击），
 * 但同样去掉阵形与交战形态补正。
 */
const nightOutput = (
  attackers: ForecastFleet,
  defenders: ForecastFleet,
  attackerFormation: number,
): number => {
  if (!attackers.ships.length || !defenders.ships.length) return 0
  const defender = averageDefender(defenders.ships)
  const hasSurfaceTarget = defenders.ships.some((ship) => !SUBMARINE_STYPES.has(ship.stype))
  const hasSubmarineTarget = defenders.ships.some((ship) => SUBMARINE_STYPES.has(ship.stype))
  let total = 0
  for (const attacker of attackers.ships) {
    if (nightAttackBlock(attacker, attackers.combinedType)) continue
    if (hasSubmarineTarget && attacker.asw > 0) {
      const aswPower = softCap(
        2 * Math.sqrt(attacker.asw) +
          attacker.equipment.reduce((sum, item) => sum + 1.5 * item.asw, 0),
        170,
      )
      total += Math.max(1, aswPower - defender.armor * 0.45) * 0.75
      continue
    }
    if (!hasSurfaceTarget) continue
    const antiLand = antiLandFactorOf(attacker, defenders)
    // 三段位置与昼战同理：preCap 进 cap 之前，postCap 与倍卡在 cap 之后、减装甲之前
    const power =
      nightPower(attacker, attackerFormation, antiLand.preCap) *
      antiLand.postCap *
      Math.max(1, attacker.damageBonus ?? 1)
    const hit = hitRate(attacker, defender, 'shell')
    const penetration = Math.max(0, power - defender.armor)
    const onHit = penetration > 0 ? penetration : Math.max(1, defender.hp * 0.06)
    total += hit * onHit * ammoCorrection(attacker.ammoRate)
  }
  return total
}

/**
 * 该舰这一轮炮击的弾着観測射撃期望倍率。制空状态不够、大破、没主砲、没水侦时是 1。
 *
 * 敌方也吃这套吗？——深海侧不发动弾着観測射撃（它没有制空判定这一层）。
 * 但**演习对手是玩家舰队**，制空在他手里时观测射击照发不误：
 * enemySpotting 打开后，敌方按镜像制空状态也走这一层（见 mirrorAirState）。
 */
const spottingFactorOf = (
  ship: ForecastShip,
  airState: number,
  /** 该舰所属舰队的 `艦隊索敵補正`（见 fleetSpottingCorrection） */
  fleetLosCorrection: number,
): number =>
  spottingMultiplier(
    {
      hp: ship.hp,
      hpMax: ship.hpMax,
      luck: ship.luck,
      flagship: !!ship.flagship,
      equipment: ship.equipment.map((item) => ({
        type2: item.type2,
        planeCount: item.planeCount,
        los: item.los,
      })),
      fleetLosCorrection,
    },
    airState,
  ).expected

/**
 * 这支队的 `艦隊索敵補正` ⌊√A+0.1A⌋。
 *
 * 2026-09-01 补上：此前 day-spotting 把这一项 stub 成 0 并挂账「上游没给定义」，
 * 而 wikiwiki 与其一手源文档现在都写清了（定义见 day-spotting 文件头）。
 * 这是三处系统性偏低里最大的一处——A 通常上百，乘 0.7 后是 +14〜21 点観測項。
 *
 * `baseLos` 填不出来的舰（深海、演习对手）贡献 0，那一支照旧偏低。
 */
const fleetSpottingCorrection = (fleet: ForecastFleet): number =>
  fleetLosCorrectionOf(
    fleetLosScoreOf(
      fleet.ships.map((ship) => ({
        baseLos: ship.baseLos ?? 0,
        equipment: ship.equipment.map((item) => ({
          type2: item.type2,
          planeCount: item.planeCount,
          los: item.los,
        })),
      })),
    ),
  )

/**
 * 先制对潜：判据本来就在 ship-special-attack（编队页一直在用）。
 * 它是**额外**的一次对潜攻击，发生在炮击阶段之前。
 */
const hasOpeningAsw = (ship: ForecastShip): boolean =>
  openingAswOf(
    {
      mstId: ship.mstId,
      name: ship.name ?? '',
      stype: ship.stype,
      ctype: ship.ctype ?? 0,
      slotNum: ship.slotNum ?? 0,
      kai: !!ship.kai,
      asw: ship.asw,
    },
    ship.equipment.map((item) => ({
      mstId: item.mstId,
      type2: item.type2,
      iconId: item.iconId,
      antiAir: item.antiAir,
      asw: item.asw,
    })),
  ) !== null

const fleetOutput = (
  attackers: ForecastFleet,
  defenders: ForecastFleet,
  attackerFormation: number,
  engagement: number,
  /** 制空状态：1 确保 / 2 优势 才可能发动弾着観測射撃；0 表示不给我方这层加成 */
  airState = 0,
): number => {
  if (!attackers.ships.length || !defenders.ships.length) return 0
  const defender = averageDefender(defenders.ships)
  // 舰队级，逐舰不变——摊在循环外算一次
  const spottingCorrection = fleetSpottingCorrection(attackers)
  const hasSurfaceTarget = defenders.ships.some((ship) => !SUBMARINE_STYPES.has(ship.stype))
  const hasSubmarineTarget = defenders.ships.some((ship) => SUBMARINE_STYPES.has(ship.stype))
  const canReceiveTorpedo =
    defenders.combinedType <= 0 ||
    defenders.ships.some((ship) => fleetRole(ship) === 'escort')
  let total = 0
  for (const attacker of attackers.ships) {
    // 炮击轮里每舰只打一个目标池：有对潜能力的舰在潜艇在场时强制对潜
    // （夜战分支同一口径），不能既拿满对水面炮击又拿满对潜——那是两倍输出。
    const aswPriority = hasSubmarineTarget && attacker.asw > 0
    if (aswPriority) {
      const aswPower = softCap(
        (2 * Math.sqrt(attacker.asw) +
          attacker.equipment.reduce((sum, item) => sum + 1.5 * item.asw, 0)) *
          formationPower(attackerFormation, 'asw') *
          engagement,
        170,
      )
      // 对潜攻击同样在炮击阶段进行，轮数与炮击一致（实测纯潜艇点的
      // gun1/gun2/gun3 三轮都有对潜伤害）。先制对潜是**额外**的一次，
      // 发生在炮击阶段之前，所以是 +1 轮而不是换算成倍率。
      const rounds = shellRounds(attackers, attacker, defenders) + (hasOpeningAsw(attacker) ? 1 : 0)
      total += Math.max(1, aswPower - defender.armor * 0.45) * 0.75 * rounds
    } else if (hasSurfaceTarget) {
      // 对地补正只作用于炮击（雷击阶段装备特效无效，见 docs/combat-bonus-sources.md）
      total +=
        expectedDamage(
          attacker,
          defender,
          'shell',
          attackerFormation,
          engagement,
          combinedShellBonus(attackers, attacker),
          antiLandFactorOf(attacker, defenders),
        ) *
        shellRounds(attackers, attacker, defenders) *
        spottingFactorOf(attacker, airState, spottingCorrection)
    }
    // 闭幕雷击独立于炮击目标池：对潜优先的舰照样对水面放雷（潜艇吃不到鱼雷）
    const canAttackWithTorpedo = attackers.combinedType <= 0 || fleetRole(attacker) === 'escort'
    if (
      hasSurfaceTarget &&
      canReceiveTorpedo &&
      canAttackWithTorpedo &&
      attacker.torpedo > 0 &&
      !CARRIER_STYPES.has(attacker.stype)
    ) {
      total +=
        expectedDamage(
          attacker,
          defender,
          'torpedo',
          attackerFormation,
          engagement,
          attackers.combinedType > 0 ? -5 : 0,
        ) *
        0.7
    }
  }
  return total
}

/**
 * 大破风险。昼战与夜战共用这一套，只换两件事：谁在打、有几次机会。
 *
 * `night` 非空时算的是**夜战那一轮单独带来的**风险：
 *   · 输出换成 nightOutput，并按 surviving（昼战后敌方还剩多少）打折——
 *     不折就等于假设敌队整队完好地进夜战；
 *   · 机会数从「昼战多轮」的 enemyCount×1.5 降为「每艘存活敌舰各出手一次」。
 * 两段是独立的风险暴露，在调用处按 1−(1−昼)(1−夜) 合成——
 * 与这里跨舰用 allSafe 连乘是同一个道理，不另发明系数。
 */
const taihaChance = (
  enemy: ForecastFleet,
  friendly: ForecastFleet,
  enemyFormation: number,
  engagement: number,
  night: { surviving: number } | null = null,
  /** 敌方的制空状态（演习对手才有，见 enemySpotting）。观测连击直接抬高承伤 */
  enemyAirState = 0,
): number => {
  if (!friendly.ships.length) return 0
  let allSafe = 1
  const opportunities = night
    ? Math.sqrt(Math.max(0, Math.min(12, enemy.ships.length * night.surviving)))
    : Math.sqrt(Math.max(1, Math.min(12, enemy.ships.length * 1.5)))
  if (opportunities <= 0) return 0
  for (const defender of friendly.ships) {
    const taihaLine = Math.floor(defender.hpMax * 0.25)
    if (defender.hp <= taihaLine) return 1
    const remaining = Math.max(1, defender.hp - taihaLine)
    // 联合战每个炮击阶段只以正在交战的主力或护卫队为目标池；不能把一次攻击
    // 除以 12。游击部队则确实是一个完整的七舰目标池。
    const targetCount =
      friendly.combinedType > 0
        ? friendly.ships.filter((ship) => fleetRole(ship) === fleetRole(defender)).length
        : friendly.ships.length
    // 每次攻击只会落到一艘舰；先以该舰作为目标算承伤，再除以可选目标数。
    // 这避免旧口径把“整支敌舰队的总输出”同时压到所有舰的大破余量上。
    const focused = night
      ? nightOutput(
          enemy,
          { ships: [defender], combinedType: friendly.combinedType },
          enemyFormation,
        ) * night.surviving
      : fleetOutput(
          enemy,
          { ships: [defender], combinedType: friendly.combinedType },
          enemyFormation,
          engagement,
          enemyAirState,
        )
    const assignedRatio = focused / targetCount / remaining
    const chance = clamp(
      0.045 *
        Math.pow(Math.max(0, assignedRatio), 1.65) *
        opportunities *
        moraleDefense(defender.condition),
      0,
      0.78,
    )
    allSafe *= 1 - chance
  }
  return 1 - allSafe
}

interface EngagementForecast {
  bPlus: number
  sa: number
  taiha: number
  friendlyPressure: number
  enemyPressure: number
  /** 追进夜战之后的同三项。夜战是昼战结束时才做的选择，所以必须与上面并列而不是合并。 */
  night: { bPlus: number; sa: number; taiha: number }
}

const forecastEngagement = (
  friendly: ForecastFleet,
  enemy: ForecastFleet,
  friendlyFormation: number,
  enemyFormation: number,
  engagement: number,
  airAdvantage: number,
  landBaseOutput: number,
  /** 制空状态。取 stateMin（熟练度按最低算出来的那个）——宁可少算弾着観測 */
  airState: number,
  /** 敌方的制空状态（演习对手才有；深海传 0）。见 enemySpotting */
  enemyAirState = 0,
): EngagementForecast => {
  const friendlyHp = friendly.ships.reduce((sum, ship) => sum + Math.max(1, ship.hp), 0)
  const enemyHp = enemy.ships.reduce((sum, ship) => sum + Math.max(1, ship.hp), 0)
  const friendlyOutput = fleetOutput(
    friendly,
    enemy,
    friendlyFormation,
    engagement,
    airState,
  )
  const enemyOutput = fleetOutput(enemy, friendly, enemyFormation, engagement, enemyAirState)
  // 陆航独立加在外面：它不吃交战形态/阵形/损伤补正，跟着昼战乘会随同航反航乱动
  const friendlyPressure = (friendlyOutput + landBaseOutput) / Math.max(1, enemyHp)
  const enemyPressure = enemyOutput / Math.max(1, friendlyHp)
  const enemyCount = Math.max(1, enemy.ships.length)
  const friendlyCount = Math.max(1, friendly.ships.length)
  const sa = logistic(
    (friendlyPressure - 0.8) * 3.2 +
      airAdvantage +
      Math.max(0, enemyCount - friendlyCount) * 0.08,
  )
  const bPlus = Math.max(
    sa,
    logistic(
      (friendlyPressure - 0.42) * 3.5 +
        airAdvantage * 0.7,
    ),
  )
  const alreadyTaiha = friendly.ships.some(
    (ship) => ship.hp <= Math.floor(ship.hpMax * 0.25),
  )
  const taiha = alreadyTaiha
    ? 1
    : clamp(
        taihaChance(enemy, friendly, enemyFormation, engagement, null, enemyAirState) *
          stateRiskCorrection(airAdvantage),
        0,
        1,
      )

  // ---- 追进夜战会怎样 ----
  //
  // 夜战是玩家在昼战结束时才做的选择，所以它不能混进上面那个数——那会变成
  // 「不打夜战的人看到的是打了夜战的胜率」。这里单算一套，界面并列摆出来。
  //
  // 两处刻意的近似，都会写进说明栏：
  //   · 敌方夜战输出按**昼战后还剩多少**打折（surviving = 1 − 昼战压制度）：
  //     不折就等于假设敌队整队完好地进夜战，大破风险会被系统性高估；
  //   · 我方夜战输出不打折——大破舰已经在 nightAttackBlock 里被挡下，
  //     其余舰即使中破，夜战攻击力仍按当前面板算（游戏里也是这样）。
  const surviving = clamp(1 - friendlyPressure, 0, 1)
  const nightFriendly = nightOutput(friendly, enemy, friendlyFormation)
  const nightPressure = (friendlyOutput + landBaseOutput + nightFriendly) / Math.max(1, enemyHp)
  const nightSa = logistic(
    (nightPressure - 0.8) * 3.2 +
      airAdvantage +
      Math.max(0, enemyCount - friendlyCount) * 0.08,
  )
  const nightBPlus = Math.max(
    nightSa,
    logistic((nightPressure - 0.42) * 3.5 + airAdvantage * 0.7),
  )
  // 昼战与夜战是两段独立的风险暴露：都躲过去才算没大破。
  // 与 taihaChance 内部跨舰连乘 allSafe 是同一个道理，不另发明系数。
  const nightOnlyTaiha = alreadyTaiha
    ? 1
    : clamp(
        taihaChance(enemy, friendly, enemyFormation, engagement, { surviving }, enemyAirState) *
          stateRiskCorrection(airAdvantage),
        0,
        1,
      )
  const nightExtraTaiha = alreadyTaiha ? 1 : 1 - (1 - taiha) * (1 - nightOnlyTaiha)

  return {
    bPlus,
    sa,
    taiha,
    friendlyPressure,
    enemyPressure,
    night: { bPlus: nightBPlus, sa: nightSa, taiha: nightExtraTaiha },
  }
}

const stateRiskCorrection = (airAdvantage: number): number =>
  airAdvantage >= 0.3 ? 0.9 : airAdvantage <= -0.2 ? 1.12 : 1

/**
 * 我方制空状态 → 敌方制空状态。制空是同一场判定的两面：
 * 我确保(1)⇄敌丧失(4)，我优势(2)⇄敌劣势(3)，均衡(0)两边都是均衡。
 */
const mirrorAirState = (state: number): number =>
  state === 1 ? 4 : state === 2 ? 3 : state === 3 ? 2 : state === 4 ? 1 : 0

export const forecastEncounter = (
  input: EncounterForecastInput,
): EncounterMechanicForecast => {
  const friendly = input.friendly
  const enemy = input.enemy
  const friendlyFormation =
    input.friendlyFormation ?? defaultFriendlyFormation(friendly, enemy)

  const friendlyAirFleet = airCombatFleet(friendly, enemy)
  const enemyAirFleet = airCombatFleet(enemy, friendly)
  const friendlyMin = airPower(friendlyAirFleet, 'min')
  const friendlyMax = airPower(friendlyAirFleet, 'max')
  const enemyAir = airPower(enemyAirFleet, 'min')
  const stateMin = forecastAirStateOf(friendlyMin, enemyAir)
  const stateMax = forecastAirStateOf(friendlyMax, enemyAir)
  const airAdvantage =
    stateMax === 1 ? 0.32 : stateMax === 2 ? 0.18 : stateMin === 4 ? -0.25 : stateMin === 3 ? -0.12 : 0

  const landBaseOutput = (input.landBaseWaves ?? []).reduce(
    (sum, wave) => sum + landBaseWavePower(wave),
    0,
  )

  const hasSaiun = friendly.ships.some((ship) =>
    ship.equipment.some((item) => item.preventsTDisadvantage && item.planeCount > 0),
  )
  const engagement = hasSaiun ? 'saiun' : 'natural'
  // 演习对手是玩家舰队：制空的另一面归他。按我方 stateMin 的镜像取——
  // 我方按最差算，敌方就按最好算，宁可多算敌方观测
  const enemyAirState = input.enemySpotting ? mirrorAirState(stateMin) : 0
  const weighted = ENGAGEMENTS
    .map((row) => ({
      weight: hasSaiun ? row.saiun : row.natural,
      value: forecastEngagement(
        friendly,
        enemy,
        friendlyFormation,
        input.enemyFormation,
        row.multiplier,
        airAdvantage,
        landBaseOutput,
        stateMin,
        enemyAirState,
      ),
    }))
    .filter((row) => row.weight > 0)
  const average = (pick: (value: EngagementForecast) => number) =>
    weighted.reduce((sum, row) => sum + row.weight * pick(row.value), 0)
  const bPlus = average((value) => value.bPlus)
  const sa = average((value) => value.sa)
  const taiha = average((value) => value.taiha)
  const friendlyPressure = average((value) => value.friendlyPressure)
  const enemyPressure = average((value) => value.enemyPressure)
  const nightBPlus = average((value) => value.night.bPlus)
  const nightSa = average((value) => value.night.sa)
  const nightTaiha = average((value) => value.night.taiha)

  const incompleteEnemy = enemy.ships.some(
    (ship) => ship.hpMax <= 0 || ship.armor <= 0 || ship.evasion <= 0,
  )
  const nightBlocks = friendly.ships.map((ship) => nightAttackBlock(ship, friendly.combinedType))
  const factors: ForecastFactors = {
    bonusShips: friendly.ships.filter((ship) => (ship.damageBonus ?? 1) > 1).length,
    landTargets: enemy.ships.filter(
      (ship) => landTargetKindOf({ name: ship.name ?? '', speed: ship.speed ?? 1 }) !== null,
    ).length,
    landBaseWaves: (input.landBaseWaves ?? []).length,
    combinedType: friendly.combinedType,
    mainCount: friendly.ships.filter((ship) => fleetRole(ship) === 'main').length,
    escortCount: friendly.ships.filter((ship) => fleetRole(ship) === 'escort').length,
    shipCount: friendly.ships.length,
    // 制空状态按 stateMin 判：熟练度按最低算出来的那个，宁可少算
    spottingShips: friendly.ships.filter(
      (ship) => spottingFactorOf(ship, stateMin, fleetSpottingCorrection(friendly)) > 1,
    ).length,
    openingAswShips: friendly.ships.filter(hasOpeningAsw).length,
    nightAttackers: nightBlocks.filter((reason) => reason === null).length,
    nightBlocked: nightBlocks.reduce<Partial<Record<NightBlockReason, number>>>((acc, reason) => {
      if (reason) acc[reason] = (acc[reason] ?? 0) + 1
      return acc
    }, {}),
  }
  return {
    bPlus: percent(bPlus),
    sa: percent(sa),
    taiha: percent(taiha),
    air: {
      friendlyMin,
      friendlyMax,
      enemy: enemyAir,
      stateMin,
      stateMax,
    },
    friendlyPressure: Number(friendlyPressure.toFixed(2)),
    enemyPressure: Number(enemyPressure.toFixed(2)),
    friendlyFormation,
    engagement,
    confidence: incompleteEnemy ? 'C' : 'B',
    factors,
    night: {
      bPlus: percent(nightBPlus),
      sa: percent(nightSa),
      taiha: percent(nightTaiha),
    },
    assumptions: forecastAssumptions(factors, [friendlyFormation], hasSaiun),
  }
}

// 与 shared/enemy-formation 的规范表同源（1–6 逐字相同）；11–14 这里刻意用全称——
// 本表只进「这个数是怎么来的」说明散文，全称在整句里更顺；窄格/词条一律用那边的短形。
// 这是语域差不是第二套口径，改任何一边的名字时两处都要看。
const FORMATION_NAME: Record<number, string> = {
  1: '单纵阵',
  2: '复纵阵',
  3: '轮形阵',
  4: '梯形阵',
  5: '单横阵',
  6: '警戒阵',
  11: '第一警戒航行序列',
  12: '第二警戒航行序列',
  13: '第三警戒航行序列',
  14: '第四警戒航行序列',
}

/**
 * 说明「这个数是怎么来的」。**由 factors 生成，不写死**——
 * 模型多接一层就会在这里自动多一行，少接一层也会自动少一行，
 * 说明文字与实现不会各说各话。
 *
 * 「未计入」只列**模型确实没建的机制**。
 * 「本点没派陆航」「本图没有倍卡」那是局面事实，不是模型缺口，不进这一栏。
 */
export const forecastAssumptions = (
  factors: ForecastFactors,
  formations: readonly number[],
  hasSaiun: boolean,
): string[] => {
  const formationText = [...new Set(formations)]
    .map((id) => FORMATION_NAME[id] ?? `阵形${id}`)
    .join('～')
  const fleetText =
    factors.combinedType > 0
      ? `联合舰队按主力${factors.mainCount}舰 + 护卫${factors.escortCount}舰分段计算；雷击只计护卫队，对普通敌舰队的航空战只计主力队`
      : factors.shipCount === 7
        ? '七舰游击部队按完整 7 舰计算，不截断第七舰；受击目标池同样按 7 舰处理'
        : `通常舰队按 ${factors.shipCount} 舰计算`

  const counted: string[] = []
  if (factors.landTargets > 0) {
    counted.push(`对地特攻（敌方 ${factors.landTargets} 个陆上型目标，含 cap 前/后两段）`)
  }
  if (factors.bonusShips > 0) counted.push(`活动特效倍卡（${factors.bonusShips} 舰适用，cap 后施加）`)
  if (factors.landBaseWaves > 0) counted.push(`派向本点的基地航空队 ${factors.landBaseWaves} 波`)
  if (factors.spottingShips > 0) {
    counted.push(
      `弹着观测射击 / 连击（${factors.spottingShips} 舰按发动率计入期望值）`,
    )
  }
  if (factors.openingAswShips > 0) counted.push(`先制对潜 ${factors.openingAswShips} 舰（额外一轮）`)

  const blocked = NIGHT_BLOCK_LABEL.flatMap(([reason, label]) => {
    const count = factors.nightBlocked[reason] ?? 0
    return count > 0 ? [`${label} ${count}`] : []
  })
  const nightText =
    factors.nightAttackers > 0
      ? `夜战单独计算：${factors.nightAttackers} 舰可攻击${
          blocked.length ? `；未参与：${blocked.join(' / ')}` : ''
        }；上限 360，不受阵形与交战形态补正影响（警戒阵主力减半除外）`
      : `夜战单独计算：当前编成无可攻击舰${blocked.length ? `（${blocked.join(' / ')}）` : ''}`

  return [
    `我方按${formationText}估算`,
    hasSaiun
      ? '航向按同航45% / 反航40% / T有利15%加权（彩云消除T不利）'
      : '航向按同航45% / 反航30% / T有利15% / T不利10%加权',
    fleetText,
    ...(counted.length ? [`已计入：${counted.join('、')}`] : []),
    nightText,
    '未计入：夜战CI、夜间触接、旗舰特殊攻击（一斉射等）、烟幕、支援舰队、友军舰队',
    '大破风险逐舰按被选中概率、当前HP和装甲承伤聚合',
  ]
}

/** 夜战出不了手的四种原因，按「说出来最有用」的顺序排 */
const NIGHT_BLOCK_LABEL: readonly [NightBlockReason, string][] = [
  ['mainOfCombined', '第一舰队'],
  ['carrier', '空母'],
  ['taiha', '大破'],
  ['noPower', '无火力雷装'],
]

const rangeOf = (
  forecasts: EncounterMechanicForecast[],
  pick: (value: EncounterMechanicForecast) => number,
): ForecastRange => {
  const values = forecasts.map(pick)
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  }
}

/**
 * 多套候选敌编成合成一个区间。
 *
 * factors 按候选取最大：陆上型目标数会随候选编成变（同一点有的候选带陆上型、有的不带），
 * 取最大是为了让说明栏**不漏说**已经参与的层——宁可说多，不可说少。
 */
export const summarizeEncounterForecasts = (
  forecasts: EncounterMechanicForecast[],
): EncounterForecastBand => {
  const first = forecasts[0]?.factors
  const maxOf = (pick: (value: ForecastFactors) => number) =>
    forecasts.length ? Math.max(...forecasts.map((value) => pick(value.factors))) : 0
  const factors: ForecastFactors = {
    bonusShips: maxOf((f) => f.bonusShips),
    landTargets: maxOf((f) => f.landTargets),
    landBaseWaves: maxOf((f) => f.landBaseWaves),
    combinedType: first?.combinedType ?? 0,
    mainCount: first?.mainCount ?? 0,
    escortCount: first?.escortCount ?? 0,
    shipCount: first?.shipCount ?? 0,
    // 弾着観測的可观测舰数**随候选变**：制空状态由候选敌编成的制空值决定
    // （带不带空母的两套候选能一个 6 舰、一个 0 舰）。同 landTargets 取最大，
    // 说明栏不漏说已参与的层；先前取第一套时说明与区间边界会脱钩。
    spottingShips: maxOf((f) => f.spottingShips),
    // 这两项只取决于我方编成，与候选敌编成无关，取第一套即可
    openingAswShips: first?.openingAswShips ?? 0,
    nightAttackers: first?.nightAttackers ?? 0,
    nightBlocked: first?.nightBlocked ?? {},
  }
  const formations = [...new Set(forecasts.map((value) => value.friendlyFormation))]
  const engagements = [...new Set(forecasts.map((value) => value.engagement))]
  return {
    bPlus: rangeOf(forecasts, (value) => value.bPlus),
    sa: rangeOf(forecasts, (value) => value.sa),
    taiha: rangeOf(forecasts, (value) => value.taiha),
    airStates: [...new Set(forecasts.flatMap((value) => [value.air.stateMin, value.air.stateMax]))],
    candidates: forecasts.length,
    confidence: forecasts.some((value) => value.confidence === 'C') ? 'C' : 'B',
    friendlyFormations: formations,
    engagements,
    factors,
    night: {
      bPlus: rangeOf(forecasts, (value) => value.night.bPlus),
      sa: rangeOf(forecasts, (value) => value.night.sa),
      taiha: rangeOf(forecasts, (value) => value.night.taiha),
    },
    assumptions: forecastAssumptions(
      factors,
      formations,
      engagements.length === 1 && engagements[0] === 'saiun',
    ),
  }
}
