// 敌方联合舰队：夜战会打到哪一队。
//
// 这件事决定「要不要进夜战」——敌一队旗舰是斩杀目标，可夜战往往被二队挡住。
// 原来镝按「敌二队还有活的 → 接触不到旗舰」写，那是把**全灭**当成了唯一放行条件，
// 于是「二队只剩两艘大破」这种其实打得到旗舰的局面，被报成了打不到。
//
// ════ 查证（2026-08-26。口径要改先回来对这一段，每条都记了出处与源数）════
//
// ① 判别式本体：**検証勢 Bottom 氏** 2020-01「修正2」推文
//    x.com/iron_and_sound/status/1213097369098522625；
//    **白羊記録紙**（kankore-sheep.blog.jp/archives/70902971.html）收录并逐条对照一致。
//    两源同式，后者是前者的转载校订，**不算两票独立**——见 ③ 的免责。
//
// ② 算分：
//    · 敌二队**全灭 → 夜战必打一队**。这一条是确定机制，不进算分。
//    · 否则：二队旗舰未击沉 +1；二队每舰（含旗舰自身）按损伤计——
//      无伤/小破 +1、中破 +0.7、大破/击沉 0。
//    · **合计 ≥3 → 夜战打二队；<3 → 打一队。**
//    PT小鬼群的中破系数是 **+0.5**（不是 0.7），由白羊記録紙 2021-09 的评论补充。
//    损伤档不另立一套比例，直接用 shared/battle-damage 的 damageTierOf——
//    与编队表、大破判定同一把尺（≤25% 大破、≤50% 中破、≤75% 小破）。
//
// ③ ⚠️ **这是暂定式，非官方，且有零星例外观测**（両源都自陈如此）。
//    所以凡是据此报给玩家的话**一律只说「预计」**，不许写成确定结论。
//    Bottom 版另有「残存 ≥5 必打二队 / ≤1 必打一队」的短路表述：
//    那两句在实际场景里与判别式等价（5 艘再破也至少 5×0.5+0=2.5，
//    加旗舰存活的 +1 必然过 3；剩 1 艘最多 1+1=2 < 3），故不单独实现。
//
// ---- 为什么算分用整十分 ----
// 0.7 与 0.5 在二进制里都是无限小数，逐舰累加后「恰好 3.0」会落成 2.9999…，
// 阈值就会在边界上抖。这里一律按**十分之一为单位的整数**累加（10 / 7 / 5 / 0），
// 阈值 30，判定完全走整数比较。

import { damageTierOf } from './battle-damage'

/** 敌方第二舰队的一艘：判定只要沉没、血量、是不是旗舰、是不是 PT。 */
export interface EnemyNightShip {
  sunk: boolean
  hp: number
  hpMax: number
  /** 敌二队旗舰（该队 position 0）。 */
  flagship: boolean
  /** PT小鬼群：中破系数不同。 */
  pt: boolean
}

/** 夜战接敌的那一支：一队（含旗舰，斩杀机会）还是二队（护卫挡在前面）。 */
export type EnemyNightTarget = 'main' | 'escort'

/** 合计 ≥3 打二队。内部按十分之一整数累加，故这里是 30。 */
export const NIGHT_TARGET_THRESHOLD_TENTHS = 30

/**
 * 主数据名认不认得出 PT小鬼群。
 *
 * 已对账随包资料：mstId 1637 起数条，`ja` 与 `zh` **都是**「PT小鬼群」
 * （assets/lodes/kcwiki-localization.json），所以不论传进来的是原名还是译名都认得。
 * 按词干「PT」宽松匹配，好让日后的 PT 系新形态（改名多半仍带这两个字母）不必回来改表。
 */
export const isPtShipName = (name: string | null | undefined): boolean =>
  typeof name === 'string' && name.includes('PT')

const scoreTenthsOf = (ship: EnemyNightShip): number => {
  if (ship.sunk || ship.hp <= 0) return 0
  const tier = damageTierOf(ship.hp, ship.hpMax)
  if (tier === 'heavy') return 0
  if (tier === 'medium') return ship.pt ? 5 : 7
  return 10 // 无伤（damageTierOf 给 null）与小破同为满分
}

/**
 * 夜战预计接触哪一支。**暂定式，有例外观测**（见头注 ③）——
 * 调用方据此说话时只许说「预计」。
 *
 * 传空数组（敌方不是联合编成）与全灭同解：必打一队。
 */
export const enemyNightTargetOf = (escort: readonly EnemyNightShip[]): EnemyNightTarget => {
  const alive = escort.filter((ship) => !ship.sunk && ship.hp > 0)
  // 全灭是确定机制，不进算分。
  if (!alive.length) return 'main'
  const flagshipAlive = alive.some((ship) => ship.flagship)
  const total =
    (flagshipAlive ? 10 : 0) + escort.reduce((sum, ship) => sum + scoreTenthsOf(ship), 0)
  return total >= NIGHT_TARGET_THRESHOLD_TENTHS ? 'escort' : 'main'
}
