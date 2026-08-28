// 对地（陆上型深海栖舰）特攻补正。
//
// 为什么单独一层：陆上型分若干类，**同一件装备对不同类型的倍率差得极远**
// （三式弹对集積地 ×2.5、对トーチカ ×1.0 完全无效），所以绝不能像普通炮击那样
// 对「平均防御者」算一次——必须逐个敌人按其类型分别算。
//
// 口径与出处见 docs/combat-bonus-sources.md。倍率表照抄自
// kcwiki「对陆补正」总表（结构化提取，非人眼誊写），逐项在测试里钉住。
//
// 两处两源打架，用第三方计算例裁决过（详见 SOURCE_NOTES）：
//   · 内火艇改修分母 /30 还是 /50
//   · 特二式内火艇对集積地是 ×1.7 还是 ×1.5
//
// 本模块只算**补正倍率**，不算最终伤害——伤害公式另有 cap 前/cap 后之分，
// 由调用方按 preCap / postCap 分别施加。

/** 陆上型分类。null = 不是陆上型，走普通炮击。 */
export type LandTargetKind =
  | 'pillbox' // トーチカ型（砲台小鬼）
  | 'isolated' // ハードスキン型（離島棲姫）
  | 'harbor' // 港湾棲姫・北方棲姫・飛行場姫・集積地棲姫 的 cap 前部分
  | 'summerHarbor' // 港湾夏姫
  | 'supply' // 集積地棲姫（III バカンスmode 以外）的 cap 后部分

export interface AntiLandEquip {
  mstId: number
  type2: number
  level: number // 改修 ★
}

/** 一次对地补正的结果。两段分开，因为它们在伤害公式里施加的位置不同。 */
export interface AntiLandBonus {
  preCap: number
  postCap: number
  /** 只在昼战生效的部分（武装大発・装甲艇等），夜战要扣掉 */
  dayOnlyPreCap: number
  notes: string[]
}

// ---- 装备 id（按 mstId 判，绝不按名字）----
//
// 名字判定在这里是**已知会出错**的：`特大発動艇+チハ`(mst494, type2=24 登陆艇)
// 与 `九七式中戦車(チハ)`(mst497, type2=52 陆战部队) 都含「チハ」，倍率来源完全不同。

const SANSHIKI = new Set([35, 317, 483]) // 三式弾 / 改 / 改二
const AP_SHELL = new Set([36, 116, 365, 1536]) // 徹甲弾系
const WG42 = 126
const ROCKET_20CM = new Set([348, 349]) // 四式20cm対地噴進砲 / 集中配備
const MORTAR = new Set([346, 347]) // 二式12cm迫撃砲改 / 集中配備

const T2_LANDING = 24 // 上陸用舟艇
const T2_AMPHIBIOUS = 46 // 特型内火艇
const T2_ARMY_UNIT = 52 // 陸戦部隊（第百一号輸送艦系列独占）

const DAIHATSU_PLAIN = 68 // 大発動艇
const TOKU_DAIHATSU = new Set([193, 482, 514]) // 特大発動艇 / +III号戦車 / +III号戦車J型
const RIKUSENTAI_GROUP = new Set([166, 449, 482, 514]) // 陸戦隊 / 一式砲戦車 / III号戦車 / J型
const II_GO_TANK = 436 // 大発動艇(II号戦車/北アフリカ仕様)
const ARMED_BOAT = new Set([408, 409]) // 装甲艇(AB艇) / 武装大発
const M4A1_GROUP = new Set([355, 495, 514]) // M4A1 DD / 特大発+チハ改 / +III号戦車J型
const KAMI_TANK = 167 // 特二式内火艇

// ---- 倍率表 ----
// 列序：pillbox / isolated / harbor / summerHarbor / supply
// supply 一列是 **cap 后**补正，其余四列是 cap 前。

type Row = readonly [number, number, number, number, number]
const KIND_INDEX: Record<LandTargetKind, number> = {
  pillbox: 0,
  isolated: 1,
  harbor: 2,
  summerHarbor: 3,
  supply: 4,
}

const pick = (row: Row, kind: LandTargetKind) => row[KIND_INDEX[kind]]

const TABLE = {
  sanshiki: [1, 1.75, 2.5, 1.75, 1] as Row,
  apShell: [1.85, 1, 1, 1.3, 1] as Row,
  wg42_1: [1.6, 1.4, 1.3, 1.4, 1.25] as Row,
  wg42_2: [2.72, 2.1, 1.82, 1.68, 1.625] as Row,
  rocket_1: [1.5, 1.3, 1.25, 1.25, 1.2] as Row,
  rocket_2: [2.7, 2.145, 1.875, 1.75, 1.68] as Row,
  mortar_1: [1.3, 1.2, 1.2, 1.1, 1.15] as Row,
  mortar_2: [1.95, 1.68, 1.56, 1.265, 1.38] as Row,
  landingBase: [1.8, 1.8, 1.4, 1.7, 1.7] as Row, // 登陆艇类别补正：**只算一次**
  daihatsuPlain: [1, 1, 1, 1, 1] as Row,
  tokuDaihatsu: [1.15, 1.15, 1.15, 1.2, 1.2] as Row,
  rikusentai_1: [1.5, 1.2, 1.5, 1.6, 1.3] as Row,
  rikusentai_2: [2.1, 1.68, 1.95, 2.4, 2.08] as Row,
  iiGo_1: [1.5, 1.2, 1.6, 1.5, 1] as Row,
  iiGo_2: [2.1, 1.68, 2.4, 1.95, 2.08] as Row,
  armedBoat_1: [1.3, 1.3, 1.5, 1.1, 1.2] as Row, // 昼のみ
  armedBoat_2: [1.56, 1.43, 1.65, 1.1, 1.21] as Row, // 昼のみ
  m4a1: [2, 1.8, 1.1, 2, 1.1] as Row,
  kami_1: [2.4, 2.4, 1.5, 2.8, 1.7] as Row,
  kami_2: [3.24, 3.24, 1.8, 4.2, 2.55] as Row,
} as const

export const SOURCE_NOTES = Object.freeze([
  {
    item: '内火艇改修补正的分母',
    kcwiki: '/50',
    others: '/30（wikiwiki・搬运贴）',
    verdict: '/30',
    basis:
      'wikiwiki「第百一号輸送艦改」页的计算例给出 2.267(特二式内火艇★max の集積地補正)；' +
      '2.267 ÷ (1+10/30) = 1.700，与集積地 ×1.7 吻合。若用 /50 则 1.7×1.2=2.04，对不上。',
  },
  {
    item: '特二式内火艇对集積地的基础倍率',
    kcwiki: '×1.7',
    others: '×1.5（wikiwiki）',
    verdict: '×1.7',
    basis: '同上反推：2.267 ÷ 1.3333 = 1.700。',
  },
])

/** 改修平均补正。登陆艇 /50、内火艇 /30——分母不同，别抄混。 */
const improvementBonus = (equips: readonly AntiLandEquip[], type2: number, divisor: number) => {
  const group = equips.filter((e) => e.type2 === type2)
  if (!group.length) return 1
  const stars = group.reduce((sum, e) => sum + Math.max(0, e.level), 0)
  return 1 + stars / group.length / divisor
}

const countOf = (equips: readonly AntiLandEquip[], match: (e: AntiLandEquip) => boolean) =>
  equips.filter(match).length

const tier = (count: number, one: number, two: number) => (count <= 0 ? 1 : count === 1 ? one : two)

// ---- 第百一号輸送艦系列独占的陸戦部隊補正 ----
//
// 全游戏只有 mst727 第百一号輸送艦改 / mst945 第百一号輸送艦 能装 type2=52
// （api_mst_equip_ship 单舰矩阵；api_mst_stype 里没有任何舰种可装 52）。
// 这两艘同时**装不了大発系**——矩阵里没有 24。
//
// 倍率是 **対集積地棲姫系のキャップ後補正**，出处 wikiwiki「第百一号輸送艦改」。
// 「陸戦部隊」按件数累积，「チハ改」「陸軍歩兵部隊」各自只算一次。
export const HYAKUICHI_SHIP_IDS = Object.freeze([727, 945])

const ARMY_UNIT_STACK = [3.15, 2.35, 1.2] as const // 1个目 / 2个目 / 3个目
const CHIHA_KAI_IDS = new Set([498, 499]) // 九七式中戦車 新砲塔(チハ改) / 陸軍歩兵部隊+チハ改
const INFANTRY_IDS = new Set([496, 499]) // 陸軍歩兵部隊 / 陸軍歩兵部隊+チハ改
const CHIHA_KAI_BONUS = 1.2
const INFANTRY_BONUS = 1.55

/**
 * 陸戦部隊補正。只有第百一号系列能触发，且**只对集積地棲姫系**。
 * 返回 1 表示不适用——不是「没有加成」而是「这条规则不参与」，两者在乘法里同值。
 */
export const armyUnitBonus = (
  shipMstId: number,
  equips: readonly AntiLandEquip[],
  kind: LandTargetKind,
): number => {
  if (!HYAKUICHI_SHIP_IDS.includes(shipMstId)) return 1
  if (kind !== 'supply') return 1 // 页面只给了集積地；实测打港湾夏姫无此加成
  const units = equips.filter((e) => e.type2 === T2_ARMY_UNIT)
  if (!units.length) return 1
  let bonus = 1
  for (let i = 0; i < Math.min(units.length, ARMY_UNIT_STACK.length); i += 1) {
    bonus *= ARMY_UNIT_STACK[i]
  }
  if (units.some((e) => CHIHA_KAI_IDS.has(e.mstId))) bonus *= CHIHA_KAI_BONUS
  if (units.some((e) => INFANTRY_IDS.has(e.mstId))) bonus *= INFANTRY_BONUS
  return bonus
}

/**
 * 一般对地乘算补正。
 *
 * 登陆艇那一段的结构容易写错：**「登陆艇类别补正」是整组只乘一次的底数**，
 * 不是每件登陆艇各乘一次。原文反例：
 *   大発動艇 + 大発動艇(八九式中戦車&陸戦隊) = 1.4×1.2 ✓ ，不是 1.4×1.4×1.2 ✗
 */
export const antiLandBonus = (
  shipMstId: number,
  equips: readonly AntiLandEquip[],
  kind: LandTargetKind,
): AntiLandBonus => {
  const notes: string[] = []
  let mult = 1

  const sanshiki = countOf(equips, (e) => SANSHIKI.has(e.mstId))
  if (sanshiki > 0) mult *= pick(TABLE.sanshiki, kind)
  const ap = countOf(equips, (e) => AP_SHELL.has(e.mstId))
  if (ap > 0) mult *= pick(TABLE.apShell, kind)

  // 对地装备：先各自按件数求值，再相乘（噴進砲 × WG42）
  const wg = countOf(equips, (e) => e.mstId === WG42)
  if (wg > 0) mult *= tier(wg, pick(TABLE.wg42_1, kind), pick(TABLE.wg42_2, kind))
  const rocket = countOf(equips, (e) => ROCKET_20CM.has(e.mstId))
  if (rocket > 0) mult *= tier(rocket, pick(TABLE.rocket_1, kind), pick(TABLE.rocket_2, kind))
  const mortar = countOf(equips, (e) => MORTAR.has(e.mstId))
  if (mortar > 0) mult *= tier(mortar, pick(TABLE.mortar_1, kind), pick(TABLE.mortar_2, kind))

  // 登陆艇。底数只由**上陸用舟艇(type2=24)**触发，整组乘一次。
  //
  // 曾试过把触发条件放宽到「上陸用舟艇 / 特四式系列 / 陸戦部隊 任一 ≥1」——
  // 搬运贴确有这么一句，但那是**泊地水鬼**表里的口径，套到集積地是错的：
  // wikiwiki「第百一号輸送艦改」页给的集積地计算例
  // `3.15×2.35×1.2×1.55×2.267 = 31.209` 里没有这个底数。
  // 陸戦部隊補正是自成一套的 cap 后补正，不叠登陆艇底数。
  const landing = equips.filter((e) => e.type2 === T2_LANDING)
  if (landing.length) {
    mult *= pick(TABLE.landingBase, kind) // 底数，整组一次
    if (landing.some((e) => e.mstId === DAIHATSU_PLAIN)) mult *= pick(TABLE.daihatsuPlain, kind)
    if (landing.some((e) => TOKU_DAIHATSU.has(e.mstId))) mult *= pick(TABLE.tokuDaihatsu, kind)
    const riku = countOf(landing, (e) => RIKUSENTAI_GROUP.has(e.mstId))
    if (riku > 0) mult *= tier(riku, pick(TABLE.rikusentai_1, kind), pick(TABLE.rikusentai_2, kind))
    const iigo = countOf(landing, (e) => e.mstId === II_GO_TANK)
    if (iigo > 0) mult *= tier(iigo, pick(TABLE.iiGo_1, kind), pick(TABLE.iiGo_2, kind))
    if (landing.some((e) => M4A1_GROUP.has(e.mstId))) mult *= pick(TABLE.m4a1, kind)
    mult *= improvementBonus(equips, T2_LANDING, 50)
  }

  // 内火艇（改修分母 /30，与登陆艇的 /50 不同）
  const kami = countOf(equips, (e) => e.mstId === KAMI_TANK)
  if (kami > 0) mult *= tier(kami, pick(TABLE.kami_1, kind), pick(TABLE.kami_2, kind))
  if (equips.some((e) => e.type2 === T2_AMPHIBIOUS)) {
    mult *= improvementBonus(equips, T2_AMPHIBIOUS, 30)
  }

  // 昼のみ的部分单独算，夜战由调用方剔除
  let dayOnly = 1
  const armed = countOf(equips, (e) => ARMED_BOAT.has(e.mstId))
  if (armed > 0) {
    dayOnly *= tier(armed, pick(TABLE.armedBoat_1, kind), pick(TABLE.armedBoat_2, kind))
  }

  const army = armyUnitBonus(shipMstId, equips, kind)
  if (army > 1) {
    notes.push(`陸戦部隊補正 ×${army.toFixed(3)}（第百一号輸送艦系列独占 · 対集積地キャップ後）`)
  }

  if (kind !== 'supply') {
    return { preCap: mult, postCap: 1, dayOnlyPreCap: dayOnly, notes }
  }
  // 集積地是**两段都吃**。原文：「对集積地棲姫类型的敌舰除计算本身的阈值后补正外，
  // 也会在阈值前计算对港湾棲姫类型的补正」——只算 cap 后那一段会严重低估。
  const pre = antiLandBonus(shipMstId, equips, 'harbor')
  return {
    preCap: pre.preCap,
    postCap: mult * army,
    dayOnlyPreCap: pre.dayOnlyPreCap,
    notes,
  }
}

// ---- 陆上型判定 ----
//
// 通用判据是 **api_soku（速度）=== 0**：陆上型不会移动。深海舰的 stype 靠不住
// （港湾夏姫II 与集積地棲姫II 都是 stype 10，而普通航空戦艦也是 10）。
// 分到哪一类只能靠名字——各类的成员名有稳定的族名前缀，且 wiki 的分类正是按族名给的。
//
// 「集積地棲姫III バカンスmode」是**例外**：wiki 把它单列进「浸水型(水上艦)」，
// 特性与以前的集積地不同（雷击阶段对地装备补正无效、实质水面单位）。
// 本模型不给它套集積地那套倍率——宁可少算，也不套错一个数量级。

export interface AntiLandTarget {
  name: string
  /** api_soku。0 = 陆上型 */
  speed: number
}

export const landTargetKindOf = (target: AntiLandTarget): LandTargetKind | null => {
  if (target.speed !== 0) return null
  const name = target.name ?? ''
  // III バカンスmode 归浸水型，不吃集積地那套；本模型暂不建模浸水型
  if (name.includes('集積地')) return name.includes('III') ? null : 'supply'
  if (name.includes('港湾夏姫')) return 'summerHarbor'
  if (name.includes('砲台') || name.includes('トーチカ')) return 'pillbox'
  if (name.includes('離島')) return 'isolated'
  // 飛行場姫・北方棲姫・港湾棲姫 及其余陆上型走 harbor 列
  return 'harbor'
}
