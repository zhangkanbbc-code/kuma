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
//     確保：観測項 = ⌊⌊√運+10⌋ + 0.7×(艦隊索敵補正 + 1.6×装備索敵値合計 + 10)⌋ + 旗艦補正
//     優勢：観測項 = ⌊⌊√運+10⌋ + 0.6×(艦隊索敵補正 + 1.2×装備索敵値合計)⌋ + 旗艦補正
//     旗艦補正 +15（随伴艦 +0）
//
// **已知偏低，且是刻意的**：`艦隊索敵補正` 这一项，来源只说「艦隊の素索敵値合計が
// 高いほど上昇」，没给出确切定义。这里按 0 处理——少算发动率，而不是编一个数出来。
// 装備索敵値合計仍然逐舰照算，所以带水侦电探的舰照样吃得到大部分收益。

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
 * 按倍率从高到低排。同一艘舰可能同时满足多种（主砲2+徹甲弾 既能主主也能主徹），
 * 游戏是逐种掷骰的；本层按这个顺序依次条件掷骰。
 * **顺序本身是本模型的假定**——来源没写清优先级，写在说明栏里。
 */
export const SPOTTING_TYPES: readonly SpottingType[] = Object.freeze([
  { kind: 'mainMain', label: '主主 CI', multiplier: 1.5, attacks: 1, divisor: 150 },
  { kind: 'mainAp', label: '主徹 CI', multiplier: 1.3, attacks: 1, divisor: 140 },
  { kind: 'mainRadar', label: '主电 CI', multiplier: 1.2, attacks: 1, divisor: 130 },
  { kind: 'double', label: '连击', multiplier: 1.2, attacks: 2, divisor: 130 },
  { kind: 'mainSecondary', label: '主副 CI', multiplier: 1.1, attacks: 1, divisor: 120 },
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
}

/** 旗舰补正。原文：旗艦は+15、随伴艦は+0。 */
export const FLAGSHIP_BONUS = 15

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
 * 観測項。**艦隊索敵補正按 0 算**——来源没给出它的确切定义，
 * 少算发动率好过编一个数（见文件头）。
 */
export const spottingScore = (ship: SpottingShip, airState: number): number => {
  const equipLos = ship.equipment.reduce((sum, item) => sum + Math.max(0, item.los), 0)
  const luckTerm = Math.floor(Math.sqrt(Math.max(0, ship.luck)) + 10)
  const base =
    airState === 1
      ? Math.floor(luckTerm + 0.7 * (1.6 * equipLos + 10))
      : Math.floor(luckTerm + 0.6 * (1.2 * equipLos))
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
