// 対空噴進弾幕：带 12cm30連装噴進砲改二 的舰在开幕航空战有几率发动，发动则
// **这一艘**本次空袭完全免伤。这里只算发动率，免伤本身不在本模块。
//
// 规则移植自 poi `views/utils/combat/aapb.ts`（MIT），2026-08-30 与 wikiwiki 逐项核对，
// **两票一致的项才写进来**，每项的两处出处如下：
//   · 基本式 (加重対空 + 0.9 × 運) ÷ 281 × 100[%]
//       poi aapb.ts 末行 `((adjustedAA + 0.9 * lucky) * 100) / 281`；
//       wikiwiki「12cm30連装噴進砲改二」発動率「{(0.9×運+加重対空)/281}×100[%]」
//   · 加重対空 = A × ⌊X / A⌋，装备一件以上时 A = 2
//       poi `2 * Math.floor(adjustedAA / 2)`；wikiwiki「対空砲火」加重対空値の定義
//       （「装備無しの場合は1、アイテムを1つ以上装備している場合は2」）。
//       本模块先判有喷二才往下算，所以 A 恒为 2。
//   · X = 素対空 + Σ(装備倍率 × 装備対空 + 改修係数 × √改修)
//       装備倍率  対空機銃 6 / 高角砲・高射装置 4 / 電探 3 / 其余 0
//       改修係数  機銃(素対空≥8) 6・(≤7) 4 / 高角砲(≥8) 3・(≤7) 2 / 高射装置 2 / 電探 0
//       poi `getEquipWeightedAA` 与 wikiwiki「対空砲火」的两张系数表逐格相同。
//   · 喷二第二根起每根 +15；伊勢型（api_ctype 2）另 +25
//       poi `15 * (rlk2Count - 1)` 与 `ship.api_ctype === 2 ? 25 : 0`；
//       wikiwiki 装备页「2積み +15%／3積み 約+30%／伊勢型姉妹 さらに +25%」。
//   · 可发动舰种 航空巡洋艦 6 / 軽空母 7 / 航空戦艦 10 / 正規空母 11 / 水上機母艦 16 /
//     装甲空母 18
//       poi `capableShipTypes`；wikiwiki 装备页「航空戦艦」「航空母艦」「水上機母艦」
//       「航空巡洋艦」——日文把三种空母合称「航空母艦」，逐 stype 展开后与 poi 同集合。
//   · api_ctype 2 = 伊勢型：poi aapb.ts 注释；随包 kcwiki 装备加成表里 一式徹甲弾改
//       的 `classes [2,6,19,26,37]` 对应日文原表那一行「金剛型…・扶桑型・伊勢型…」。
//
// 有一处两边给的不一样，照 poi 取舍并记在这里：wikiwiki 的 X 还加「装備ボーナスの
// 0.75倍」，poi 的素対空取「$ship 初始対空 + api_kyouka[2]」，不含任何装备加成。
//
// **2026-09-01 更正这一处的定性**：从前写成「两票不一致」，那不准确——这不是两家口径
// 之争，是**一次有日期的游戏侧规格变更**加**一份过期的实现**：
//   · wikiwiki「対空砲火」明写装備ボーナスの上昇分「2022/8/4アップデートで寄与する
//     ようになりました」；
//   · poi `views/utils/combat/aapb.ts` 文件头自记 `Last update Nov 27, 2021`，早于那次变更。
// 所以 poi 在这一项上不是第二票，是过期；随它 ⇒ 系统性偏低，偏低量 =
// 0.75 × Σ装備ボーナス(対空) ÷ 281 × 100，约每 3 点对空加成 ≈ 1 个百分点。
//
// **但取舍不变，代码不动**：要加得先有一份可信的逐舰装备加成，而那份加成自己还在逐条
// 校正（见 fit-bonus-corrections），拿它乘 0.75 只是把两层不确定叠一起。这次只改这段
// 定性措辞——把「两票不一致」这个错判据留在这里，日后有人会照它去找并不存在的第二票。
//
// wikiwiki 装备页另写「改修による発動率上昇は情報元のツイートが非公開となったため
// 詳細不明」。不确定的是「一颗★换算成几个百分点」这句成品结论，不是系数本身——
// 同站「対空砲火」的加重対空値定义里改修係数是写死的，且与 poi 逐格相同，故照系数实装。
//
// 素対空的口径写死在入参上（baseAntiAir 必须是**不含装备**的那个值）。拿面板对空
// 减装备原始值是反推，会把装备加成留在里面，与上面刚说的口径正好相反。

import { isCarrierStype } from './kcs-domain'
import {
  isAAFD,
  isAAGun,
  isAARadar,
  isHighAngleMount,
  isRocketK2,
  type SpecialAbilityEquip,
} from './ship-special-attack'

export interface RocketBarrageShip {
  stype: number
  ctype: number // 伊勢型加成按舰级收
  /** 素対空：master 初始対空 + 近代化改修，**不含装备** */
  baseAntiAir: number
  luck: number
}

/** 装备判据与对空CI 共用一套（见 ship-special-attack），故沿用它的装备视图再加改修星。 */
export interface RocketBarrageEquip extends SpecialAbilityEquip {
  level: number // 改修星数
}

export interface RocketBarrage {
  /** 舰种能不能发动。只看舰种，与带没带喷二无关 */
  eligible: boolean
  /** 发动率百分数；舰种不符或没带喷二时为 null。不封顶，可能超过 100 */
  rate: number | null
  /** 喷二根数 */
  rocketCount: number
  /** 加重対空（已过 2×⌊X/2⌋ 取整）；rate 为 null 时同样为 null */
  weightedAntiAir: number | null
  /** 基本式那一项：(加重対空 + 0.9 × 運) ÷ 281 × 100 */
  baseRate: number | null
  /** 第二根喷二起每根 +15 */
  extraRocketBonus: number
  /** 伊勢型 +25 */
  iseBonus: number
  /**
   * 加重対空里由 ★ 贡献的那一截（Σ 改修係数 × √★，取整之前的原值）。
   *
   * 单独摘出来是给展示层判「这套配装的 ★ 到底动没动这个数」用的——电探那一档改修係数
   * 是 0，插一根 ★10 电探照样是 0。发动率本身**已经**含了它，别再加一遍。
   */
  starContribution: number
}

/** 航空巡洋艦 / 航空戦艦 / 水上機母艦。三种空母走 kcs-domain 的 CARRIER_STYPES。 */
const BARRAGE_STYPES: ReadonlySet<number> = new Set([6, 10, 16])

const ISE_CTYPE = 2

/** 这艘舰的舰种能不能发动喷进弹幕。 */
export const canRocketBarrage = (stype: number): boolean =>
  BARRAGE_STYPES.has(stype) || isCarrierStype(stype)

/** 单件装备进加重対空的贡献。判定顺序照 poi：机铳 → 高角炮 → 高射装置 → 对空电探。 */
const equipWeightedAntiAir = (equip: RocketBarrageEquip): number => {
  const star = Math.sqrt(Math.max(0, equip.level))
  if (isAAGun(equip)) return 6 * equip.antiAir + (equip.antiAir >= 8 ? 6 : 4) * star
  if (isHighAngleMount(equip)) return 4 * equip.antiAir + (equip.antiAir >= 8 ? 3 : 2) * star
  if (isAAFD(equip)) return 4 * equip.antiAir + 2 * star
  // 电探这一档没有改修项——两票的改修係数表都把電探记 0，不是漏抄
  if (isAARadar(equip)) return 3 * equip.antiAir
  return 0
}

/** 上面那一件里由 ★ 贡献的部分。两处必须同源，所以就地按同一批判据再取一次。 */
const equipStarContribution = (equip: RocketBarrageEquip): number => {
  const star = Math.sqrt(Math.max(0, equip.level))
  if (star <= 0) return 0
  if (isAAGun(equip)) return (equip.antiAir >= 8 ? 6 : 4) * star
  if (isHighAngleMount(equip)) return (equip.antiAir >= 8 ? 3 : 2) * star
  if (isAAFD(equip)) return 2 * star
  return 0
}

/** 这艘舰在当前配装下的喷进弹幕发动率与构成明细。 */
export const rocketBarrageOf = (
  ship: RocketBarrageShip,
  equips: readonly RocketBarrageEquip[],
): RocketBarrage => {
  const eligible = canRocketBarrage(ship.stype)
  const rocketCount = equips.filter(isRocketK2).length
  const iseBonus = ship.ctype === ISE_CTYPE ? 25 : 0
  const blank: RocketBarrage = {
    eligible,
    rate: null,
    rocketCount,
    weightedAntiAir: null,
    baseRate: null,
    extraRocketBonus: 0,
    iseBonus,
    starContribution: 0,
  }
  if (!eligible || rocketCount === 0) return blank

  const raw = equips.reduce((total, equip) => total + equipWeightedAntiAir(equip), ship.baseAntiAir)
  // A × ⌊X / A⌋：这一步到了这里必定是 A=2（至少带着一根喷二）
  const weightedAntiAir = 2 * Math.floor(raw / 2)
  const baseRate = ((weightedAntiAir + 0.9 * ship.luck) * 100) / 281
  const extraRocketBonus = 15 * (rocketCount - 1)
  return {
    ...blank,
    rate: baseRate + extraRocketBonus + iseBonus,
    weightedAntiAir,
    baseRate,
    extraRocketBonus,
    starContribution: equips.reduce((total, equip) => total + equipStarContribution(equip), 0),
  }
}
