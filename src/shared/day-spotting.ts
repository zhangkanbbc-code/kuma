// 弾着観測射撃（昼战炮击的观测射击 / 连击）的纯计算层。
//
// 口径来自 wikiwiki「戦闘について」的弾着観測射撃项（2026-08-08 核对，逐条抄录）：
//
//   前提（四条**全部**满足）：
//     · 航空戦で航空優勢または制空権確保
//     · 攻撃艦の損傷が中破以下（＝不是大破）
//     · 攻撃艦が主砲+αを装備
//     · 搭載数1以上のスロットに水上偵察機か水上爆撃機を装備
//
//   种别与倍率（观测种别定数是发动率的分母）：
//     主砲+主砲 CI   主砲×2            1.5倍        定数 150
//     主砲+徹甲弾 CI 主砲1 + 徹甲弾1   1.3倍        定数 140
//     主砲+電探 CI   主砲1 + 電探1     1.2倍        定数 130
//     主砲+副砲 CI   主砲1 + 副砲1     1.1倍        定数 120
//     連撃           主砲×2            1.2倍 × 2回  定数 130
//
//   発動率 = ⌈観測項⌉ ÷ 観測種別定数
//     確保：観測項 = ⌊⌊√運+10⌋ + 0.7×(艦隊索敵補正 + 1.6×装備索敵値合計) + 10⌋ + 旗艦補正
//     優勢：観測項 = ⌊⌊√運+10⌋ + 0.6×(艦隊索敵補正 + 1.2×装備索敵値合計)⌋ + 旗艦補正
//     旗艦補正 +15（随伴艦 +0）
//     艦隊索敵補正 = ⌊√A + 0.1×A⌋
//       A = Σ(艦娘の**素**索敵値) + Σ(水偵/水爆の装備索敵値 × ⌊√そのスロットの搭載機数⌋)
//
// 2026-09-01 复查（wikiwiki「戦闘について」弾着観測射撃 + 其脚注 *14 指向的一手源文档
// https://docs.google.com/document/d/1tqYyqzdc1RT_fYDKFMcUId0kOZHCdGpVsObm6yt-Yco ）
// 改掉了此前三处，逐条记在这里：
//
//   ① `艦隊索敵補正` 不再按 0 算。2026-08-08 那次的注释写「来源只说『艦隊の素索敵値
//      合計が高いほど上昇』，没给出确切定义」——**现在两处都给出了确切定义**（上面那行）。
//      A 通常上百，⌊√A+0.1A⌋ 常在 20〜30+，乘 0.7 后是 +14〜21 点観測項，
//      这是原来最大的一处系统性偏低。
//
//   ② **確保式里 `+10` 的位置，两处转写不一致**——这是分歧，不是定论：
//        源文档（一手）  int( int(√運+10) + 0.7*(艦隊索敵補正 + 1.6*Σ装備索敵) + 10 )
//        wikiwiki 转写   ⌊(⌊√運+10⌋ + 0.7×(艦隊索敵補正 + 1.6×Σ装備索敵 + 10)⌋
//      前者的 +10 在 0.7 之外（净 +10），后者在括号内（净 +7），差 3 点観測項
//      （对主主 CI 约 2 个百分点）。**本模块跟源文档**，两条理由：证据序上一手源文档
//      高于 wikiwiki 转写；且 wikiwiki 那一行的括号本身不配平（`⌊(` 多一个左括号、
//      无对应右括号），是转写排版事故的特征。这一处若日后被推翻，改的是下面 base 那一行。
//
//   ③ 判定顺序不再是「按倍率降序」的假定。源文档「判定順」段与 wikiwiki
//      「上に記載されているものから順に判定していく」都写清了：
//      **主主 > 主徹 > 主電 > 主副 > 連撃**。此前 主副 与 連撃 是反的。

/** 观测种别。名字用中文，但条件与常数照抄原表。 */
export type SpottingKind = 'mainMain' | 'mainAp' | 'mainRadar' | 'mainSecondary' | 'double'

export interface SpottingType {
  kind: SpottingKind
  label: string
  /** 单次攻击的攻击力倍率 */
  multiplier: number
  /** 攻击次数。連撃是两次，其余都是一次 */
  attacks: number
  /** 発動率的分母 */
  divisor: number
}

/**
 * **判定顺序照源文档**：主主 > 主徹 > 主電 > 主副 > 連撃（源文档注明「(api 大 > 小)」，
 * wikiwiki 作「上に記載されているものから順に判定していく」）。
 *
 * 同一艘舰可能同时满足多种（主砲2+徹甲弾 既能主主也能主徹），游戏逐种掷骰，
 * 本层按这个顺序依次条件掷骰。注意它**不是**倍率降序：連撃(1.2) 排在 主副(1.1) 之后。
 * 2026-08-08 那版按倍率降序排、并自承「顺序是本模型的假定」，对「主砲2+副砲1」
 * 这类配装算出来的期望倍率偏高。
 */
export const SPOTTING_TYPES: readonly SpottingType[] = Object.freeze([
  { kind: 'mainMain', label: '主主 CI', multiplier: 1.5, attacks: 1, divisor: 150 },
  { kind: 'mainAp', label: '主徹 CI', multiplier: 1.3, attacks: 1, divisor: 140 },
  { kind: 'mainRadar', label: '主电 CI', multiplier: 1.2, attacks: 1, divisor: 130 },
  { kind: 'mainSecondary', label: '主副 CI', multiplier: 1.1, attacks: 1, divisor: 120 },
  { kind: 'double', label: '连击', multiplier: 1.2, attacks: 2, divisor: 130 },
])

// 装备分类。type2 取自本机 api_mst_slotitem_equiptype 实核：
// 1 小口径主砲 / 2 中口径主砲 / 3 大口径主砲 / 4 副砲 /
// 10 水上偵察機 / 11 水上爆撃機 / 12 小型電探 / 13 大型電探 / 19 対艦強化弾
const MAIN_GUN = new Set([1, 2, 3])
const SECONDARY = new Set([4])
const AP_SHELL = new Set([19])
const RADAR = new Set([12, 13])
const SEAPLANE = new Set([10, 11])

export interface SpottingEquip {
  type2: number
  /** 该格当前搭载数。水侦/水爆要求**搭载数 1 以上**，空格不算 */
  planeCount: number
  /** 装备索敌值（api_saku） */
  los: number
}

export interface SpottingShip {
  hp: number
  hpMax: number
  luck: number
  /** 是否为该舰队旗舰（旗舰补正 +15） */
  flagship: boolean
  equipment: readonly SpottingEquip[]
  /**
   * `艦隊索敵補正`（⌊√A+0.1A⌋）。**舰队级**输入，由调用方用 fleetLosCorrectionOf
   * 算好传进来——本层只看得见一艘舰，算不出整队的 A。
   *
   * 缺省 0 = 「这个调用方还拿不到整队素索敵」，与 2026-08-08 那版行为一致；
   * 那是**少算**，不是「这支队补正为 0」。
   */
  fleetLosCorrection?: number
}

/** 旗舰补正。原文：旗艦は+15、随伴艦は+0。 */
export const FLAGSHIP_BONUS = 15

/** 算 `A` 用的舰队级视图：素索敵 + 各水偵/水爆槽的装備索敵与搭載機数。 */
export interface SpottingFleetShip {
  /**
   * **素**索敵：不含任何装备。面板索敵逐件减回装備索敵即得
   * （与 shared/fleet-los33 的「舰娘裸装索敌」同一口径）。
   */
  baseLos: number
  equipment: readonly SpottingEquip[]
}

/**
 * `A` = Σ(艦娘の素索敵値) + Σ(水偵/水爆の装備索敵値 × ⌊√搭載機数⌋)。
 *
 * 只有水偵/水爆进第二项——電探等其余装備的索敵**不算入 A**（它们已经在
 * 各舰自己的「装備索敵値合計」那一项里）。空格（搭載0）自然贡献 0。
 */
export const fleetLosScoreOf = (ships: readonly SpottingFleetShip[]): number =>
  ships.reduce(
    (total, ship) =>
      total +
      Math.max(0, ship.baseLos) +
      ship.equipment.reduce(
        (sum, item) =>
          SEAPLANE.has(item.type2)
            ? sum + Math.max(0, item.los) * Math.floor(Math.sqrt(Math.max(0, item.planeCount)))
            : sum,
        0,
      ),
    0,
  )

/** 艦隊索敵補正 = ⌊√A + 0.1×A⌋。 */
export const fleetLosCorrectionOf = (score: number): number => {
  const a = Math.max(0, score)
  return Math.floor(Math.sqrt(a) + 0.1 * a)
}

/**
 * 该舰这一场能不能发动观测射击的**种别清单**（已按掷骰顺序排好）。
 * 前提不满足时返回空数组——包括制空状态不够、大破、没主砲、没水侦。
 */
export const spottingTypesOf = (
  ship: SpottingShip,
  /** 制空状态：1 确保 / 2 优势（其余状态一律不发动） */
  airState: number,
): SpottingType[] => {
  if (airState !== 1 && airState !== 2) return []
  // 「攻撃艦の損傷が中破以下」＝ 不是大破
  if (ship.hp <= Math.floor(ship.hpMax * 0.25)) return []
  // 「搭載数1以上のスロットに水上偵察機か水上爆撃機」——空格的水侦不算
  const hasSeaplane = ship.equipment.some(
    (item) => SEAPLANE.has(item.type2) && item.planeCount > 0,
  )
  if (!hasSeaplane) return []

  const mainGuns = ship.equipment.filter((item) => MAIN_GUN.has(item.type2)).length
  if (mainGuns < 1) return []
  const secondary = ship.equipment.some((item) => SECONDARY.has(item.type2))
  const apShell = ship.equipment.some((item) => AP_SHELL.has(item.type2))
  const radar = ship.equipment.some((item) => RADAR.has(item.type2))

  return SPOTTING_TYPES.filter((type) => {
    switch (type.kind) {
      case 'mainMain':
      case 'double':
        return mainGuns >= 2
      case 'mainAp':
        return mainGuns >= 1 && apShell
      case 'mainRadar':
        return mainGuns >= 1 && radar
      case 'mainSecondary':
        return mainGuns >= 1 && secondary
      default:
        return false
    }
  })
}

/**
 * 観測項。
 *
 * 確保档那个 `+ 10` 写在 `0.7 × (…)` **之外**——这是文件头 ② 记的分歧，
 * 跟的是一手源文档；wikiwiki 的转写把它写在括号内（净 +7）。改口径就改这一行。
 */
export const spottingScore = (ship: SpottingShip, airState: number): number => {
  const equipLos = ship.equipment.reduce((sum, item) => sum + Math.max(0, item.los), 0)
  const fleetLos = Math.max(0, ship.fleetLosCorrection ?? 0)
  const luckTerm = Math.floor(Math.sqrt(Math.max(0, ship.luck)) + 10)
  const base =
    airState === 1
      ? Math.floor(luckTerm + 0.7 * (fleetLos + 1.6 * equipLos) + 10)
      : Math.floor(luckTerm + 0.6 * (fleetLos + 1.2 * equipLos))
  return base + (ship.flagship ? FLAGSHIP_BONUS : 0)
}

export interface SpottingOutcome {
  /** 这一轮炮击的期望伤害倍率（没发动时是 1） */
  expected: number
  /** 参与掷骰的种别与各自的条件发动率，供界面说清凭什么是这个数 */
  rolls: { type: SpottingType; chance: number }[]
}

/**
 * 一轮炮击的期望倍率。
 *
 * 多种别同时满足时按 SPOTTING_TYPES 的顺序**依次条件掷骰**：
 * 前一种没中才轮到下一种。連撃是 1.2 倍打两次，所以它对这一轮总伤害的贡献是 2.4。
 */
export const spottingMultiplier = (
  ship: SpottingShip,
  airState: number,
): SpottingOutcome => {
  const types = spottingTypesOf(ship, airState)
  if (!types.length) return { expected: 1, rolls: [] }
  const score = Math.ceil(spottingScore(ship, airState))
  let remaining = 1
  let expected = 0
  const rolls: SpottingOutcome['rolls'] = []
  for (const type of types) {
    const chance = Math.min(1, Math.max(0, score / type.divisor))
    rolls.push({ type, chance })
    expected += remaining * chance * type.multiplier * type.attacks
    remaining *= 1 - chance
    if (remaining <= 0) break
  }
  // 都没中就是普通一次攻击
  return { expected: expected + remaining, rolls }
}
