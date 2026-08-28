// 基地航空队「按目标类型」算的有效威力。
//
// 起因：推荐搭配一期的威力列直接拿裸雷装/爆装排序，太粗。同一架飞机打水上舰、
// 打砲台小鬼、打離島棲姫、打集積地棲姫，倍率与补正**位置**都不一样，
// 排出来的名次也就不一样——这一层就是把那个差别算进去。
//
// 出处：wikiwiki「基地航空隊」页（2026-08-27 取原始 HTML 字节，与一期同一份抓取）。
// 口径记在 docs/combat-bonus-sources.md。**别用 WebFetch 之类的转述层核对这里的数**
// ——同一页栽过一次（一期半径公式），教训写在那份 docs 开头。
//
// 基本攻撃力不另造：直接用 land-base-attack 的 `planeBasePower`（種別倍率、
// 改修強化値、搭載数補正都在里面，已审定）。这一层只加它没有的三件事：
//   ① 対地特効（基地航空特効 / 爆撃特効），逐目标类型不同；
//   ② 公式里那几个 `[]` 下取整的**位置**；
//   ③ 火力キャップ。
//
// ── 三处必须照原文钉死、凭直觉都会写错的地方 ──────────────────────
//
// **① 集積地棲姫的「基地航空特効」是加算 +100，不是乘算。**
// 表里另外两行写的是 ×1.6 / ×1.18，只有集積地这一格写 `+100`。照着上下行
// 想当然写成 ×100 会差两个数量级，写成 ×1.0 则整条特效凭空消失。
//
// **② 两类目标的补正施加位置不同**，原文：
//   「砲台小鬼・離島棲姫」→ 基地航空特効在**キャップ前**、爆撃特効在**キャップ後**
//   「集積地棲姫」        → 基地航空特効・爆撃特効**都在キャップ後**
// 所以不能写成「先把两个倍率乘起来再套一次 cap」。
//
// **③ 陸偵補正在対地与対水上艦里的位置不一样。**
// 対水上艦：陸偵補正在 `基本攻撃力` 里，**在下取整之内**；
// 対地　　：陸偵補正在 `最終攻撃力` 末尾，**在下取整之外**。
// 抄成同一处，带二式陸偵的队会差一点点——差得不多，但那是错的。
//
// ── キャップ值：上游正文说 220，上游自己的表算的是 150 ────────────
// 同一页的正文写「※下線部に火力キャップ(キャップ値220)が適用される」，
// 但同页附的三张攻撃力比較表（対砲台小鬼／対離島棲姫／対集積地型，共 42 格）
// **按 220 只能对上 37 格，按 150 是 42 格全中**（无 cap、170 同样只有 37 格）。
// 差异只出现在高爆装机体上，正是唯一能把两种读法分开的地方：
//   Do 217 K-2＋Fritz-X（爆装24）対砲台小鬼，表上 437.4；
//   150 → 150+√56.86 = 157.54 → ⌊157⌋ ×1.55 = ⌊243⌋ ×1.8 = 437.4 ✔
//   220 → 未触顶 206.86 → ⌊206⌋ ×1.55 = ⌊319⌋ ×1.8 = 574.2 ✘
// **裁给表**：表是逐格的数值证据且自洽 42/42，正文那句是一句话。
// 那句 220 很可能是从上一节「対水上艦」搬下来的——那一节的原话是
// 「基本攻撃力に火力キャップ220が掛かるが、ほぼ到達不可能」，对水上艦确实到不了。
// 全部 42 格逐格进了回归测试当预言机；这个常数改动一个字，那批测试立刻红。

import { planeBasePower } from './land-base-attack'
import type { LandBasePlane } from './land-base-attack'

/**
 * 目标类型。
 *
 * `surface` 打水上舰（用雷装），其余四个都是陆上型（用爆装）。
 * `land` 是**没有具名特效**的陆上型（飛行場姫・港湾棲姫・北方棲姫 等）——
 * 上游只给了砲台小鬼／離島棲姫／集積地棲姫三类的数，其余按无特效算。
 * 这是「上游没给」，不是「我们查到是 1.0」，显示层要说清楚。
 */
export type LbasTargetKind = 'surface' | 'land' | 'pillbox' | 'isolated' | 'supply'

export const LBAS_TARGET_LABEL: Readonly<Record<LbasTargetKind, string>> = {
  surface: '水上舰',
  land: '陆上型（无具名特效）',
  pillbox: '砲台小鬼',
  isolated: '離島棲姫',
  supply: '集積地棲姫',
}

/** 打这一类目标时用爆装还是雷装。原文：打水上舰用雷装、打陆上型用爆装。 */
export const usesBombStat = (target: LbasTargetKind): boolean => target !== 'surface'

/**
 * 対地特効表。照抄 wikiwiki「基地航空隊」#対地特効補正 那张三行表：
 *
 * | 補正種別 | 基地航空特効 | 爆撃特効 |
 * | 砲台小鬼 |    ×1.6     |  ×1.55  |
 * | 離島棲姫 |    ×1.18    |  ×1.7   |
 * | 集積地棲姫|   **+100**  |  ×2.1   |
 *
 * `airMul` / `airAdd` 是「基地航空特効」的两种形态（乘算 / 加算），
 * 集積地那一行是加算——见文件头 ①。
 * `bombMul` 是「爆撃特効」，只有爆撃機拿得到（见 `earnsBombBonus`）。
 * `postCap` 记这一类的特效施加在 cap 之前还是之后——见文件头 ②。
 */
interface LandBonusRow {
  airMul: number
  airAdd: number
  bombMul: number
  /** true = 基地航空特効与爆撃特効都在 cap 之后（集積地）；false = 基地航空特効在 cap 之前 */
  bonusAfterCap: boolean
}

const LAND_BONUS: Readonly<Record<Exclude<LbasTargetKind, 'surface'>, LandBonusRow>> = {
  land: { airMul: 1, airAdd: 0, bombMul: 1, bonusAfterCap: false },
  pillbox: { airMul: 1.6, airAdd: 0, bombMul: 1.55, bonusAfterCap: false },
  isolated: { airMul: 1.18, airAdd: 0, bombMul: 1.7, bonusAfterCap: false },
  supply: { airMul: 1, airAdd: 100, bombMul: 2.1, bonusAfterCap: true },
}

/**
 * 火力キャップ。见文件头那一节：上游正文说 220，上游自己的三张比較表按 150 才 42/42 全中。
 * 裁给表。改这个数会让 `test/lbas-target-power.test.mjs` 里那 42 格预言机整片变红。
 */
export const LBAS_LAND_POWER_CAP = 150

/** 超过 cap 的部分开方压缩——与本仓库其它 cap 同一套写法。 */
const applyCap = (value: number, cap: number): number =>
  value <= cap ? value : cap + Math.sqrt(value - cap)

const T2_CARRIER_BOMBER = 7 // 艦上爆撃機
const T2_LAND_ATTACKER = 47 // 陸上攻撃機

/**
 * 拿不拿得到「爆撃特効」。
 *
 * 原文：「爆撃特効は艦上爆撃機、陸上攻撃機が得られる補正」——**只有这两类是确认的**。
 * 同段紧接着写「水上爆撃機や、噴式戦闘爆撃機も同様の補正を受けると思われるが未検証」，
 * 是上游自己标的未检证，所以这里**不给**水爆与噴式戦闘爆撃機。
 * 与本仓库对概率项一贯的取舍同一条：宁可低估，不拿一个「大概也吃吧」当确定值。
 */
export const earnsBombBonus = (type2: number): boolean =>
  type2 === T2_CARRIER_BOMBER || type2 === T2_LAND_ATTACKER

/** 陸攻補正 ×1.8 只给陸攻本身——与 land-base-attack 同一判据。 */
const landAttackerBonus = (type2: number): number => (type2 === T2_LAND_ATTACKER ? 1.8 : 1)

export interface SquadronPowerInput {
  plane: LandBasePlane
  target: LbasTargetKind
  /** 队内陸偵補正（1 / 1.125 / 1.15）。位置随目标类型不同——见文件头 ③ */
  reconBonus?: number
  /** 敵連合特効：对联合舰队 ×1.1 */
  enemyCombined?: boolean
}

/** 拆解出来的每一步，给悬停提示用；数值与 `squadronPower` 同源，不另算一遍。 */
export interface SquadronPowerBreakdown {
  /** 基本攻撃力（種別倍率 × {(雷装 or 爆装 + 改修) × √(搭載数補正 × 搭載数) + 25}） */
  base: number
  /** 基地航空特効施加后、cap 处理后的值 */
  afterAirBonus: number
  /** 爆撃特効施加后的值 */
  afterBombBonus: number
  /** 有没有真的触顶 */
  capped: boolean
  /** 这一格拿没拿到爆撃特効 */
  gotBombBonus: number
  /** 最终有效威力 */
  power: number
}

/**
 * 一个中队打一次的有效威力（含拆解）。
 *
 * 対水上艦（原文）：
 *   最終攻撃力 = [[基本攻撃力] × クリティカル × 熟練度クリティカル]
 *              × 触接 × 陸攻補正 × 陸攻特効 × 敵連合特効
 *   其中 基本攻撃力 = 種別倍率 × {…} × 陸偵補正   ← 陸偵在下取整**之内**
 *
 * 対地（原文）：
 *   最終攻撃力 = [[[基本攻撃力 × 基地航空特効(砲台・離島姫) × 爆撃特効(集積地)
 *                 + 基地航空特効(集積地)] × 爆撃特効(砲台・離島姫)]
 *                × クリティカル × 熟練度クリティカル]
 *              × 触接 × 陸攻補正 × 陸偵補正 × 敵連合特効   ← 陸偵在下取整**之外**
 *
 * 概率项（クリティカル・熟練度クリティカル・触接）一律按不发动算——
 * 与 land-base-attack 同一条纪律：宁可低估，不给一个偏乐观的数。
 * 陸攻特効（対特定水上ボス）也不计：它按敌人逐个给，没有通用表，见文件末注。
 */
export const squadronPowerDetail = (input: SquadronPowerInput): SquadronPowerBreakdown => {
  const { plane, target } = input
  const recon = input.reconBonus ?? 1
  const combined = input.enemyCombined ? 1.1 : 1
  const tail = landAttackerBonus(plane.type2) * combined

  const base = planeBasePower(plane, usesBombStat(target))
  if (base <= 0) {
    return { base: 0, afterAirBonus: 0, afterBombBonus: 0, capped: false, gotBombBonus: 1, power: 0 }
  }

  if (target === 'surface') {
    // 陸偵補正在下取整之内
    const floored = Math.floor(base * recon)
    return {
      base,
      afterAirBonus: floored,
      afterBombBonus: floored,
      capped: false,
      gotBombBonus: 1,
      power: floored * tail,
    }
  }

  const row = LAND_BONUS[target]
  const bomb = earnsBombBonus(plane.type2) ? row.bombMul : 1

  // 砲台小鬼・離島棲姫：基地航空特効在 cap 前；集積地：两个都在 cap 后
  const preCapRaw = row.bonusAfterCap ? base : base * row.airMul
  const capped = applyCap(preCapRaw, LBAS_LAND_POWER_CAP)
  const didCap = preCapRaw > LBAS_LAND_POWER_CAP

  // 集積地那一支：×爆撃特効 再 +基地航空特効(加算)，都在 cap 之后
  const afterAir = row.bonusAfterCap
    ? Math.floor(capped * bomb + row.airAdd)
    : Math.floor(capped)
  // 砲台・離島那一支：爆撃特効在 cap 之后
  const afterBomb = row.bonusAfterCap ? afterAir : Math.floor(afterAir * bomb)

  return {
    base,
    afterAirBonus: afterAir,
    afterBombBonus: afterBomb,
    capped: didCap,
    gotBombBonus: bomb,
    // 陸偵補正在下取整之外
    power: afterBomb * tail * recon,
  }
}

/** 只要那个数的简版。 */
export const squadronPower = (input: SquadronPowerInput): number =>
  squadronPowerDetail(input).power

// ── 刻意没建模的两项，别以为是漏了 ────────────────────────────────
//
// **命中**：上游自己写着「命中率やクリティカルヒット発生率については**データ不足であり
// 要検証**」——基地航空队的命中率公式**上游没有**。装备表里那一列「命中」是装备面板值，
// 不是命中率，拿它当命中率排序是编数。所以这一层不算命中，显示层照实说「命中未建模」。
//
// **陸攻特効（対水上ボス）**：原文只说「陸上攻撃機による一部の水上ボスに対する特効は
// 式の最後にかかる」，并举了一个「空母棲姫に対する倍率は3.2～3.4倍程度」的区间。
// 它是**按敌人逐个给**的，没有通用表，且举的还是个区间。不进模型。
