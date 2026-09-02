// 「这艘舰这套配装能发动什么、各自多大概率」——把五族发动率汇成一串可直接摆上界面的条目。
//
// 前四族的数学或证据各自住在
//   shared/aa-rocket-barrage（対空噴進弾幕）
//   shared/ship-special-attack（対空CI 条件与优先度；率证据在本文件）
//   shared/day-spotting    （昼战弾着観測射撃 / 連撃）
//   shared/night-cutin     （夜战 CI / 連撃）
// 专属动画特殊攻击的推定式与证据表集中在本文件。这里统一取数、按置信度决定
// 「给数字还是给问号」、把悬停要看的那几行凑出来。
// 编队页与装备图鉴的组合实验室共用同一份结论，两处不会各算各的。
//
// ---- 数值置信度 ----
//
// 公式或系数未验证时保留类型，rate 返回 null，悬停显示 PROC_RATE_UNKNOWN_NOTE。
// 夜战连击没有可用的 CI 项/种别系数；潜水舰专用系数由上游列为待验证。
// 空母夜袭种别判定尚未实现，不生成条目。
// 弹幕的 3 根以上加成与伊势型非日向改加成未验证，命中时 rate 返回 null。
// 昼观测按 B 级源文档给出数值；分歧记录在 day-spotting。
import {
  rocketBarrageOf,
  type RocketBarrageEquip,
  type RocketBarrageShip,
} from './aa-rocket-barrage'
import {
  spottingScore,
  spottingTypesOf,
  type SpottingEquip,
  type SpottingShip,
} from './day-spotting'
import {
  detectFleetSpecialAttacks,
  type FleetSpecialAttack,
  type FleetSpecialAttackEquip,
  type FleetSpecialAttackInput,
  type FleetSpecialAttackShip,
} from './fleet-special-attack'
import {
  isSearchlight,
  nightCutinRate,
  nightCutinScoreOf,
  nightCutinsOf,
  type NightCutinEquip,
} from './night-cutin'
import {
  shipAacis,
  type AaciEntry,
  type SpecialAbilityEquip,
  type SpecialAbilityShip,
} from './ship-special-attack'

/** 数值给不出时，悬停里那一句。用户 2026-09-01 逐字定稿，别改写。 */
export const PROC_RATE_UNKNOWN_NOTE = '暂无权威公式'

/**
 * 伊勢型 +25 的唯一实测对象。wikiwiki 脚注原文：「日向改での検証結果、伊勢改は未確認」。
 * 其余伊勢型姉妹（伊勢改 / 伊勢改二 / 日向改二 / 未改造）上的 +25 都是外推。
 */
const HYUUGA_KAI_MST_ID = 88

export type ProcRateGroup = 'barrage' | 'aaci' | 'day' | 'night' | 'special'

export interface ProcRateEntry {
  id: string
  group: ProcRateGroup
  /** 一眼位置的名字 */
  label: string
  /**
   * 発動率百分数，公式族**已封顶 100**（公式本身不封顶，封顶是展示口径）。
   * null = 置信度不够，界面写「?」。
   */
  rate: number | null
  /**
   * 悬停里逐行给的东西。公式未知时通常只有 PROC_RATE_UNKNOWN_NOTE；
   * 对空CI 仍会保留固定击坠、倍率与条件这些已知事实。
   */
  detail: string[]
  /**
   * 收纳卡中跟在名字后的字段，须包含数值或未知原因。
   * detail 不重复主标签已有的数值。
   */
  summary: string
}

export interface ProcRateGroupView {
  group: ProcRateGroup
  primary: ProcRateEntry
  others: readonly ProcRateEntry[]
  /** 主条完整 detail，后接「其他可发动项」与其余条目的脸值 */
  detail: string[]
  /** 窄态明细卡：主条一行，其余条目按原顺序缩进 */
  foldLines: string[]
}

/**
 * 展开区的族顺序。专属动画特殊攻击自成一族，不按昼夜拆分。
 */
export const PROC_RATE_GROUP_ORDER: readonly ProcRateGroup[] = [
  'special',
  'barrage',
  'aaci',
  'day',
  'night',
]

/** 五族共用的装备视图。 */
export interface ProcRateEquip extends SpecialAbilityEquip, FleetSpecialAttackEquip {
  name: string
  /** 装备索敌（api_saku） */
  los: number
  /** 改修★ */
  level: number
  /** 该格当前搭载数。补强增设格恒 0（它装不了水侦，也不该冒充有搭载数的一格） */
  planeCount: number
}

export interface ProcRateShip extends SpecialAbilityShip {
  level: number
  luck: number
  hp: number
  hpMax: number
  flagship: boolean
  /** 素対空：master 初期対空 + 近代化改修，**不含装备**（口径见 aa-rocket-barrage） */
  baseAntiAir: number
  equipment: readonly ProcRateEquip[]
}

export interface ProcRateFleet extends FleetSpecialAttackInput {
  /**
   * 艦隊索敵補正 ⌊√A+0.1A⌋。由调用方用 day-spotting 的
   * `fleetLosCorrectionOf(fleetLosScoreOf(...))` 算好传进来。
   */
  losCorrection: number
  /**
   * 同队任一舰带着探照灯（含大型）：夜战 CI項 +7。
   *
   * 照明弹自身有发动率，静态编成无法确定是否触发，因此不计 +4。
   */
  searchlight: boolean
}

export type AaciRateConfidence = 'A' | 'B' | 'C'

export interface AaciRateEvidence {
  id: number
  rate: number | null
  confidence: AaciRateConfidence
  success: number | null
  total: number | null
  date: string
  source: string
  sourceNote: string
}

export interface AaciProcRateEntry extends ProcRateEntry {
  group: 'aaci'
  aaci: AaciEntry
  evidence: AaciRateEvidence
}

/**
 * 対空CI 单体发动率证据。
 *
 * S1（1–46，CC_jabberwock / POI DB）：
 * https://docs.google.com/spreadsheets/d/1agGoLv57g5eOXLXtNIKHRoBYy61OQYxibWP6Vi_DMuY/edit?gid=1258270705#gid=1258270705
 * S2（47、48 与当前总表）：
 * https://docs.google.com/spreadsheets/d/1agGoLv57g5eOXLXtNIKHRoBYy61OQYxibWP6Vi_DMuY/edit?gid=524089780#gid=524089780
 * S3（53 与当前优先度表）：
 * https://docs.google.com/spreadsheets/d/1agGoLv57g5eOXLXtNIKHRoBYy61OQYxibWP6Vi_DMuY/edit?gid=13450409#gid=13450409
 *
 * A = S1 有检证样本（不代表样本都强；42/44 极小）；B = 原表明确带推定措辞；
 * C = 当前权威表无率。表内没有的数一律 null，不从优先度试验或相邻类型补齐。
 */
export const AACI_RATE_EVIDENCE: readonly AaciRateEvidence[] = [
  { id: 1, rate: 64.97, confidence: 'A', success: 18311, total: 28183, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '誤差' },
  { id: 2, rate: 55.34, confidence: 'A', success: 5600, total: 10119, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '多少怪しい' },
  { id: 3, rate: 50.77, confidence: 'A', success: 2400, total: 4727, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 4, rate: 50.00, confidence: 'A', success: 185, total: 370, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 5, rate: 49.81, confidence: 'A', success: 14266, total: 28643, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '怪しい' },
  { id: 6, rate: 40.59, confidence: 'A', success: 110, total: 271, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 7, rate: 44.51, confidence: 'A', success: 397, total: 892, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 8, rate: 49.82, confidence: 'A', success: 11719, total: 23523, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 9, rate: 38.64, confidence: 'A', success: 709, total: 1835, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 10, rate: 59.77, confidence: 'A', success: 5991, total: 10024, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 11, rate: 54.91, confidence: 'A', success: 2843, total: 5178, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 12, rate: 47.89, confidence: 'A', success: 1464, total: 3057, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '多少怪しい' },
  { id: 13, rate: 35.28, confidence: 'A', success: 440, total: 1247, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 14, rate: 65.14, confidence: 'A', success: 142, total: 218, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 15, rate: 57.42, confidence: 'A', success: 89, total: 155, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 16, rate: 58.43, confidence: 'A', success: 52, total: 89, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 17, rate: 52.38, confidence: 'A', success: 22, total: 42, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 18, rate: 58.00, confidence: 'A', success: 29, total: 50, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 19, rate: 44.44, confidence: 'A', success: 28, total: 63, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 20, rate: 63.16, confidence: 'A', success: 60, total: 95, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 21, rate: 57.86, confidence: 'A', success: 162, total: 280, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 22, rate: 54.76, confidence: 'A', success: 23, total: 42, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 23, rate: 77.27, confidence: 'A', success: 119, total: 154, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 24, rate: 60.53, confidence: 'A', success: 23, total: 38, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 25, rate: 60.01, confidence: 'A', success: 2282, total: 3803, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 26, rate: 61.75, confidence: 'A', success: 113, total: 183, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 27, rate: 47.20, confidence: 'A', success: 76, total: 161, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 28, rate: 55.51, confidence: 'A', success: 978, total: 1762, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 29, rate: 57.43, confidence: 'A', success: 564, total: 982, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 30, rate: 37.78, confidence: 'A', success: 34, total: 90, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '件数不足' },
  { id: 31, rate: 50.00, confidence: 'A', success: 44, total: 88, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 32, rate: 51.44, confidence: 'A', success: 535, total: 1040, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '怪しい' },
  { id: 33, rate: 46.77, confidence: 'A', success: 58, total: 124, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 34, rate: 55.35, confidence: 'A', success: 9061, total: 16370, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '怪しい' },
  { id: 35, rate: 53.26, confidence: 'A', success: 6701, total: 12582, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '誤差' },
  { id: 36, rate: 52.73, confidence: 'A', success: 2820, total: 5348, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '多少怪しい' },
  { id: 37, rate: 43.89, confidence: 'A', success: 6410, total: 14605, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '怪しい' },
  { id: 38, rate: 57.24, confidence: 'A', success: 704, total: 1230, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 39, rate: 56.13, confidence: 'A', success: 3529, total: 6287, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '原有率本就不清楚' },
  { id: 40, rate: 55.23, confidence: 'A', success: 6312, total: 11428, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '原有率本就不清楚' },
  { id: 41, rate: 54.01, confidence: 'A', success: 5039, total: 9330, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '原有率本就不清楚' },
  { id: 42, rate: 72.73, confidence: 'A', success: 8, total: 11, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '极弱样本' },
  { id: 43, rate: 51.52, confidence: 'A', success: 34, total: 66, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 44, rate: 80.00, confidence: 'A', success: 4, total: 5, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '极弱样本' },
  { id: 45, rate: 47.58, confidence: 'A', success: 266, total: 559, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 46, rate: 55.43, confidence: 'A', success: 51, total: 92, date: '2023-06', source: 'CC_jabberwock / POI DB', sourceNote: '' },
  { id: 47, rate: 70, confidence: 'B', success: null, total: 140, date: '2024-04', source: 'yukicacoon', sourceNote: '原表 70%?' },
  { id: 48, rate: null, confidence: 'C', success: 10, total: 10, date: '2024-06', source: 'yukicacoon', sourceNote: '原贴仅写「発動率が高い？」；当前总表留空' },
  { id: 49, rate: null, confidence: 'C', success: null, total: null, date: '2026-02', source: 'CC_jabberwock 汇总表', sourceNote: '当前总表及优先度表无数值' },
  { id: 50, rate: null, confidence: 'C', success: null, total: null, date: '2026-02', source: 'CC_jabberwock 汇总表', sourceNote: '当前总表及优先度表无数值' },
  { id: 51, rate: null, confidence: 'C', success: null, total: null, date: '2026-02', source: 'CC_jabberwock 汇总表', sourceNote: '当前总表及优先度表无数值' },
  { id: 52, rate: null, confidence: 'C', success: null, total: null, date: '2026-02', source: 'CC_jabberwock 汇总表', sourceNote: '当前总表及优先度表无数值' },
  { id: 53, rate: 60, confidence: 'B', success: null, total: 60, date: '2026-02', source: 'CC_jabberwock', sourceNote: '原表 60％前後' },
]

const AACI_RATE_BY_ID = new Map(AACI_RATE_EVIDENCE.map((evidence) => [evidence.id, evidence]))

const spottingEquipOf = (equip: ProcRateEquip): SpottingEquip => ({
  type2: equip.type2,
  planeCount: equip.planeCount,
  los: equip.los,
})

const nightEquipOf = (equip: ProcRateEquip): NightCutinEquip => ({
  mstId: equip.mstId,
  type2: equip.type2,
  name: equip.name,
  los: equip.los,
})

const barrageEquipOf = (equip: ProcRateEquip): RocketBarrageEquip => ({
  mstId: equip.mstId,
  type2: equip.type2,
  iconId: equip.iconId,
  antiAir: equip.antiAir,
  asw: equip.asw,
  level: equip.level,
})

const cap100 = (rate: number): number => Math.min(100, Math.max(0, rate))

const unknown = (id: string, group: ProcRateGroup, label: string): ProcRateEntry => ({
  id,
  group,
  label,
  rate: null,
  detail: [PROC_RATE_UNKNOWN_NOTE],
  summary: `? · ${PROC_RATE_UNKNOWN_NOTE}`,
})

interface KnownSpecialRate {
  raw: number
  formula: string
  substitution: string
  source: string
}

/**
 * 专属动画特殊攻击发动率证据与常量（2026-09-02 逐页核对）。
 *
 * S1 Nelson Touch：
 * https://wikiwiki.jp/kancolle/Nelson#NelsonTouch
 * 推定式脚注 *34（ENWiki）；页面未载检证日期。
 *
 * S2 長門／陸奥一斉射：
 * https://wikiwiki.jp/kancolle/長門改二#isseisya
 * 推定式脚注 *14（kanprint）；正文检证脚注另列 yukicacoon 2020-08-09。
 *
 * S3 僚艦夜戦突撃：
 * https://wikiwiki.jp/kancolle/金剛改二丙#SpecialAttack
 * 概要表引用 CC_jabberwock（2024-10-10 参照）与 ENWiki（2026-05-26 参照）；
 * 霧島的水上电探 +20／大型探照灯 +20 见脚注 *57（Google Sheet）。
 *
 * S4 大和／武蔵特殊砲撃：
 * https://wikiwiki.jp/kancolle/大和改二#SpecialAttack1
 * 电探限定原文：「また、命中8以上の電探の装備艦数により発動率が上がる」。
 * 因此这里按 type2=12/13 且 api_houm≥8 判，不附加索敌门。
 * 大和＋武蔵二舰组合的常数 40 与大和＋Iowa改／Richelieu改二舰组合的常数 35
 * 见推定式脚注 *34／*35（chang1124414276）；ci 400 三舰版没有对应率式，固定 C 级。
 *
 * C 级出处：
 * Colorado https://wikiwiki.jp/kancolle/Colorado#ColoTouch（脚注 *32 yukicacoon）；
 * Richelieu https://wikiwiki.jp/kancolle/Richelieu改#SpecialAttack
 * （脚注 *51 chang1124414276 2024-08-08／yukicacoon 2026-08-10）；
 * Queen Elizabeth https://wikiwiki.jp/kancolle/Warspite改#SpecialAttack
 * （脚注 *63 chang1124414276，仅称可能与長門型同式）；
 * 潜水艦隊攻撃 https://wikiwiki.jp/kancolle/大鯨#SpecialAttack（运营 2021-05-08，无率式）；
 * 四式特殊攻击没有对应率页。以上一律不给数，不拿假定式或相邻类型补常数。
 */
const KONGO_EQUIP_BONUS: Readonly<Record<string, { radar: number; searchlight: number }>> = {
  金剛改二丙: { radar: 30, searchlight: 10 }, // S3 概要表
  比叡改二丙: { radar: 10, searchlight: 30 }, // S3 概要表
  榛名改二乙: { radar: 15, searchlight: 0 }, // S3 概要表
  榛名改二丙: { radar: 20, searchlight: 0 }, // S3 概要表
  霧島改二丙: { radar: 20, searchlight: 20 }, // S3 概要表＋脚注 *57
}

const YAMATO_NAMES = new Set(['大和改二', '大和改二重'])
const YAMATO_RATE_35_PARTNERS = new Set(['Iowa改', 'Richelieu改'])
const RADAR_TYPES = new Set([12, 13])

const specialShipName = (ship: FleetSpecialAttackShip): string =>
  ship.name.replace(/\s+/g, ' ').trim()

const knownSpecialRateOf = (
  attack: FleetSpecialAttack,
  ships: readonly FleetSpecialAttackShip[],
): KnownSpecialRate | null => {
  const flag = ships[0]
  if (!flag) return null

  if (attack.ci === 100) {
    const third = ships[2]
    const fifth = ships[4]
    if (!third || !fifth) return null
    const raw =
      1.1 * Math.sqrt(flag.lv) +
      Math.sqrt(third.lv) +
      Math.sqrt(fifth.lv) +
      1.4 * Math.sqrt(flag.luck) +
      25
    return {
      raw,
      formula: '1.1√旗舰Lv+√3号Lv+√5号Lv+1.4√旗舰运+25',
      substitution:
        `旗舰 Lv${flag.lv} 运${flag.luck} · 3号 Lv${third.lv} · 5号 Lv${fifth.lv}`,
      source: 'ENWiki · 推定',
    }
  }

  if (attack.ci === 101 || attack.ci === 102) {
    const second = ships[1]
    if (!second) return null
    const raw =
      Math.sqrt(flag.lv) +
      Math.sqrt(second.lv) +
      1.2 * (Math.sqrt(flag.luck) + Math.sqrt(second.luck)) +
      30
    return {
      raw,
      formula: '(√1号Lv+√2号Lv)+1.2(√1号运+√2号运)+30',
      substitution:
        `1号 Lv${flag.lv} 运${flag.luck} · 2号 Lv${second.lv} 运${second.luck}`,
      source: 'kanprint · 推定',
    }
  }

  if (attack.ci === 104) {
    const second = ships[1]
    const bonus = KONGO_EQUIP_BONUS[specialShipName(flag)]
    if (!second || !bonus) return null
    const a = flag.equipment.some((equip) => equip.surfaceRadar && equip.saku >= 8)
      ? bonus.radar
      : 0
    const b = flag.equipment.some((equip) => equip.largeSearchlight)
      ? bonus.searchlight
      : 0
    const raw = Math.floor(
      3.5 * (Math.sqrt(flag.lv) + Math.sqrt(second.lv)) +
      1.1 * (Math.sqrt(flag.luck) + Math.sqrt(second.luck)) +
      a +
      b -
      33,
    )
    return {
      raw,
      formula: '⌊3.5(√旗舰Lv+√僚舰Lv)+1.1(√旗舰运+√僚舰运)+A+B−33⌋',
      substitution:
        `旗舰 Lv${flag.lv} 运${flag.luck} · 僚舰 Lv${second.lv} 运${second.luck} · A ${a} · B ${b}`,
      source: 'CC_jabberwock / ENWiki · 2024-10-10／2026-05-26 · 推定',
    }
  }

  if (attack.ci === 401) {
    const second = ships[1]
    if (!second) return null
    const flagName = specialShipName(flag)
    const secondName = specialShipName(second)
    const yamatoMusashi =
      (YAMATO_NAMES.has(flagName) && secondName === '武蔵改二') ||
      (flagName === '武蔵改二' && YAMATO_NAMES.has(secondName))
    const constant =
      yamatoMusashi
        ? 40
        : YAMATO_NAMES.has(flagName) && YAMATO_RATE_35_PARTNERS.has(secondName)
          ? 35
          : null
    if (constant === null) return null
    const radarShips = ships.filter((ship) =>
      ship.equipment.some((equip) => RADAR_TYPES.has(equip.type2) && equip.houm >= 8),
    ).length
    const yamatoFlagship = YAMATO_NAMES.has(flagName) ? 2 : 0
    const raw =
      Math.sqrt(flag.lv) +
      Math.sqrt(second.lv) +
      Math.sqrt(flag.luck) +
      Math.sqrt(second.luck) +
      constant +
      radarShips * 10 +
      yamatoFlagship
    return {
      raw,
      formula:
        `√1号Lv+√2号Lv+√1号运+√2号运+${constant}+电探装备舰数×10+大和旗舰2`,
      substitution:
        `1号 Lv${flag.lv} 运${flag.luck} · 2号 Lv${second.lv} 运${second.luck} · ` +
        `电探装备舰 ${radarShips} · 大和旗舰 ${yamatoFlagship}`,
      source: 'chang1124414276 · 推定',
    }
  }

  return null
}

const specialMechanismOf = (ci: number): string | null => {
  if ([100, 101, 102, 103, 105, 106, 400, 401].includes(ci)) return '一次出击一次'
  if (ci === 104) return '一次出击最多 3 次'
  if (ci === 300 || ci === 301 || ci === 302) {
    return '每个攻击点消耗 1 个潜水舰补给物资'
  }
  return null
}

const unknownSpecialNotesOf = (ci: number): string[] => {
  if (ci === 103) return ['1～3 号位 SG雷达（后期型）+5%']
  if (ci === 105) return ['38cm 四连装炮改 deux 不提升发动率']
  return []
}

/** 有专属动画的舰队特殊攻击；昼夜共用 special 一族。 */
export const specialEntriesOf = (
  detected: readonly FleetSpecialAttack[],
  fleetView: readonly FleetSpecialAttackShip[],
): ProcRateEntry[] =>
  detected.map((attack) => {
    const id = `special-${attack.ci}`
    const mechanism = specialMechanismOf(attack.ci)
    const known = knownSpecialRateOf(attack, fleetView)
    if (!known) {
      const condition = `编成条件：${attack.detail}`
      return {
        id,
        group: 'special' as const,
        label: attack.label,
        rate: null,
        detail:
          attack.ci === 400
            ? [condition, ...(mechanism ? [mechanism] : []), PROC_RATE_UNKNOWN_NOTE]
            : [
                condition,
                PROC_RATE_UNKNOWN_NOTE,
                ...unknownSpecialNotesOf(attack.ci),
                ...(mechanism ? [mechanism] : []),
              ],
        summary: '?',
      }
    }
    const rate = cap100(known.raw)
    return {
      id,
      group: 'special' as const,
      label: attack.label,
      rate,
      detail: [
        `编成条件：${attack.detail}`,
        `发动率：推定式 ${known.formula}`,
        `代入：${known.substitution}`,
        ...(known.raw > 100 ? [`公式值 ${known.raw.toFixed(2)}%`] : []),
        `出处：${known.source}`,
        ...(mechanism ? [mechanism] : []),
      ],
      summary: `${rate.toFixed(0)}%`,
    }
  })

const sampleCount = (value: number): string => value.toLocaleString('en-US')

/** 対空CI：类型由共享条件表枚举，率与出处只读上面的证据表。 */
export const aaciEntriesOf = (
  ship: SpecialAbilityShip & { equipment: readonly ProcRateEquip[] },
): AaciProcRateEntry[] =>
  shipAacis(ship, ship.equipment).map((aaci) => {
    const evidence = AACI_RATE_BY_ID.get(aaci.id)!
    const label = `对空CI ${aaci.id}`
    const known = [
      `固定击坠 +${aaci.fixed} · 倍率 ×${aaci.modifier}`,
      `条件：${aaci.scope} · ${aaci.condition}`,
    ]
    if (evidence.rate === null) {
      return {
        id: `aaci-${aaci.id}`,
        group: 'aaci' as const,
        label,
        rate: null,
        detail: [...known, PROC_RATE_UNKNOWN_NOTE],
        summary: `? · ${PROC_RATE_UNKNOWN_NOTE}`,
        aaci,
        evidence,
      }
    }
    const rateLine =
      evidence.confidence === 'B'
        ? `单体发动率 推定 ${evidence.rate.toFixed(0)}%（${evidence.sourceNote}）`
        : `单体发动率 ${evidence.rate.toFixed(2)}% · ${sampleCount(
            evidence.success!,
          )}/${sampleCount(evidence.total!)}`
    return {
      id: `aaci-${aaci.id}`,
      group: 'aaci' as const,
      label,
      rate: evidence.rate,
      detail: [
        ...known,
        rateLine,
        `出处：${evidence.source} · ${evidence.date}`,
        '按优先度逐项判定 · 非本队最终发动率',
      ],
      summary: `${evidence.rate.toFixed(0)}%`,
      aaci,
      evidence,
    }
  })

const LOOKOUT_MST_ID = 129
const SQUADRON_LOOKOUT_MST_ID = 412

/** 対空噴進弾幕。舰种不符或没带喷二时返回 null（这艘舰根本没有这一项）。 */
export const barrageEntryOf = (ship: ProcRateShip): ProcRateEntry | null => {
  const shipView: RocketBarrageShip = {
    stype: ship.stype,
    ctype: ship.ctype,
    baseAntiAir: ship.baseAntiAir,
    luck: ship.luck,
  }
  const outcome = rocketBarrageOf(shipView, ship.equipment.map(barrageEquipOf))
  // aa-rocket-barrage 保证三个计算值同时存在或同时为 null。
  if (outcome.rate === null || outcome.weightedAntiAir === null || outcome.baseRate === null) {
    return null
  }
  // 与组合实验室共用中文名称。
  const label = '对空喷进弹幕'
  // 3 根以上与伊势型非日向改加成未验证；装备改修仍按已确认的加重对空系数计算。
  const shaky =
    outcome.rocketCount >= 3 ||
    (outcome.iseBonus > 0 && ship.mstId !== HYUUGA_KAI_MST_ID)
  if (shaky) {
    return {
      ...unknown('barrage', 'barrage', label),
      detail: [
        '出处：wikiwiki 12cm30連装噴進砲改二 · 推定',
        '该修正项未验证',
        PROC_RATE_UNKNOWN_NOTE,
      ],
    }
  }
  const parts = [`加重对空 ${outcome.weightedAntiAir} · 运 ${ship.luck}`]
  if (outcome.extraRocketBonus > 0 || outcome.iseBonus > 0) {
    parts.push(
      [
        `基本 ${outcome.baseRate.toFixed(1)}%`,
        outcome.extraRocketBonus > 0 ? `喷二 ${outcome.rocketCount} 根 +${outcome.extraRocketBonus}%` : '',
        outcome.iseBonus > 0 ? `伊势型 +${outcome.iseBonus}%` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    )
  }
  if (outcome.rate > 100) parts.push(`公式值 ${outcome.rate.toFixed(1)}%`)
  const rate = cap100(outcome.rate)
  return {
    id: 'barrage',
    group: 'barrage',
    label,
    rate,
    detail: [...parts, '出处：wikiwiki 12cm30連装噴進砲改二 · 推定'],
    summary: `${rate.toFixed(0)}%`,
  }
}

/**
 * 昼战弾着観測射撃 / 連撃。**一眼位置给「确保」档**，悬停并列确保与优势两个数。
 *
 * 制空前提本身不写成文字（用户 2026-09-01：解释不进一眼位置，前提散文一律不要）。
 * 制空拿不到确保/优势时这艘舰本来就发动不了——那由 spottingTypesOf 的四条前提管，
 * 与这里给哪一档数字是两件事。
 */
export const dayEntriesOf = (
  ship: ProcRateShip,
  fleet: Pick<ProcRateFleet, 'losCorrection'>,
): ProcRateEntry[] => {
  const view: SpottingShip = {
    hp: ship.hp,
    hpMax: ship.hpMax,
    luck: ship.luck,
    flagship: ship.flagship,
    equipment: ship.equipment.map(spottingEquipOf),
    fleetLosCorrection: fleet.losCorrection,
  }
  const types = spottingTypesOf(view, 1)
  if (!types.length) return []
  const secured = Math.ceil(spottingScore(view, 1))
  const superiority = Math.ceil(spottingScore(view, 2))
  return types.map((type) => {
    // 一眼位置给确保档；优势档只在悬停/明细卡里并列。两档都是纯数字，不写前提散文
    const securedRate = cap100((secured / type.divisor) * 100)
    const both = `确保 ${securedRate.toFixed(0)}% · 优势 ${cap100(
      (superiority / type.divisor) * 100,
    ).toFixed(0)}%`
    return {
      id: `day-${type.kind}`,
      group: 'day' as const,
      label: `昼 ${type.label}`,
      rate: securedRate,
      detail: [
        both,
        `观测项 ${secured} · 系数 ${type.divisor}`,
        '出处：wikiwiki 戦闘について · 弾着観測射撃',
      ],
      summary: both,
    }
  })
}

/**
 * 夜战 CI / 連撃。只列**真会进发动判定**的种别（汎用池里被更高倍率盖住的不列，
 * 那是「发动不了」，不是「概率低」）。
 *
 * 通用种别的中破补正（+18）按无伤算，敌方探照灯/照明弾一律不算——它们都是战斗中状态，
 * 静态编成里说不准。夜間瑞雲CI 是例外：中破不发动，探照灯不套通用 +7。
 */
export const nightEntriesOf = (
  ship: ProcRateShip,
  fleet: Pick<ProcRateFleet, 'searchlight'>,
): ProcRateEntry[] => {
  // 大破的舰这一夜出不了手（与昼观测的「中破以下」同源），一条都不列
  if (ship.hp <= Math.floor(ship.hpMax * 0.25)) return []
  const kinds = nightCutinsOf(ship.stype, ship.equipment.map(nightEquipOf)).filter(
    (kind) =>
      kind.rolled &&
      !(kind.scope === 'zuiun' && ship.hp <= Math.floor(ship.hpMax * 0.5)),
  )
  if (!kinds.length) return []
  return kinds.map((kind) => {
    const id = `night-${kind.id}`
    const label = `夜 ${kind.label === '連撃' ? '连击' : kind.label}`
    const scored = nightCutinScoreOf({
      level: ship.level,
      luck: ship.luck,
      stype: ship.stype,
      flagship: ship.flagship,
      friendlySearchlight: fleet.searchlight,
      nightZuiun: kind.scope === 'zuiun',
      lookout: ship.equipment.some((equip) => equip.mstId === LOOKOUT_MST_ID),
      squadronLookout: ship.equipment.some((equip) => equip.mstId === SQUADRON_LOOKOUT_MST_ID),
    })
    const rate = nightCutinRate(scored.score, kind)
    // divisor 为 null（連撃）与 'unverified'（潜水艦専用係数）走同一个出口：
    // 前者上游根本没给式子，后者上游自己列在「要検証事項」，都不配一个确定的数
    if (rate === null || kind.divisorConfidence === 'unverified') {
      return {
        ...unknown(id, 'night', label),
        detail: ['出处：wikiwiki 夜戦 · 推定', PROC_RATE_UNKNOWN_NOTE],
      }
    }
    const detail = [`CI项 ${scored.score} · 系数 ${kind.divisor}`]
    if (kind.scope === 'zuiun') detail.push('探照灯不计')
    if (scored.corrections.length) {
      detail.push(
        scored.corrections
          .map((one) => `${one.label} ${one.value > 0 ? '+' : ''}${one.value}`)
          .join(' · '),
      )
    }
    if (rate > 100) detail.push(`公式值 ${rate.toFixed(0)}%`)
    detail.push('出处：wikiwiki 夜戦 · 推定')
    const capped = cap100(rate)
    return {
      id,
      group: 'night' as const,
      label,
      rate: capped,
      detail,
      summary: `${capped.toFixed(0)}%`,
    }
  })
}

/**
 * 这艘舰当前配装能发动的全部特殊效果，按 特殊攻击 → 弾幕 → 対空CI → 昼观测 → 夜战 排。
 * 一条都没有就是空数组——界面对空数组什么都不画（「不可能的不显示」）。
 */
export const procRatesOf = (ship: ProcRateShip, fleet: ProcRateFleet): ProcRateEntry[] => {
  const special = ship.flagship
    ? specialEntriesOf(
        detectFleetSpecialAttacks({ role: fleet.role, ships: fleet.ships }),
        fleet.ships,
      )
    : []
  const barrage = barrageEntryOf(ship)
  return [
    ...special,
    ...(barrage ? [barrage] : []),
    ...aaciEntriesOf(ship),
    ...dayEntriesOf(ship, fleet),
    ...nightEntriesOf(ship, fleet),
  ]
}

const procRateEntryFace = (entry: ProcRateEntry): string =>
  entry.rate === null ? '?' : `${entry.rate.toFixed(0)}%`

/**
 * 把原始发动率条目投影成展开区的一族一枚。
 *
 * 主条取同族 rate 最高者；全为 null 时保留判定顺序第一条。其余条目只从原顺序中
 * 拿掉主条，所以 AACI 优先度、昼观测判定顺序与夜战池顺序都不会被重新排列。
 */
export const procRateGroupsOf = (
  entries: readonly ProcRateEntry[],
): ProcRateGroupView[] => {
  const result: ProcRateGroupView[] = []
  for (const group of PROC_RATE_GROUP_ORDER) {
    const members = entries.filter((entry) => entry.group === group)
    if (!members.length) continue
    let primary = members[0]
    for (const entry of members.slice(1)) {
      if (entry.rate !== null && (primary.rate === null || entry.rate > primary.rate)) {
        primary = entry
      }
    }
    const others = members.filter((entry) => entry !== primary)
    result.push({
      group,
      primary,
      others,
      detail: [
        ...primary.detail,
        ...(others.length
          ? ['其他可发动项', ...others.map((entry) => `${entry.label} ${procRateEntryFace(entry)}`)]
          : []),
      ],
      foldLines: [
        `${primary.group === 'special' ? '特殊攻击 · ' : ''}${primary.label} ${primary.summary}`,
        ...others.map(
          (entry) =>
            `　${entry.group === 'special' ? '特殊攻击 · ' : ''}${entry.label} ${entry.summary}`,
        ),
      ],
    })
  }
  return result
}

/** 同队任一舰带着探照灯（含大型）——夜战 CI項 的 +7 是舰队级判据。 */
export const fleetHasSearchlight = (
  fleets: readonly (readonly { type2: number }[])[],
): boolean => fleets.some((equips) => equips.some((equip) => isSearchlight(equip.type2)))
