// 夜战特殊攻击（夜間特殊攻撃）的**种别判定**纯计算层。
//
// 口径来自 wikiwiki「夜戦」（2026-08-12 抓原页逐条抄录，含判定实例表核对）：
//
//   汎用（按装备数判，「記載数**以上**」，补强增设计入）：
//     主主主  主砲≥3            2.0 倍 × 1回
//     主主副  主砲≥2 且 副砲≥1  1.75 倍 × 1回
//     魚雷CI  魚雷≥2            1.5 倍 × 2回
//     主魚CI  主砲≥1 且 魚雷≥1  1.3 倍 × 2回
//     連撃    主砲+副砲 合计≥2  1.2 倍 × 2回
//   多种同时满足时「**攻撃倍率が最も高い物のみ**発動判定」（攻击回数不参与比较），
//   連撃判定顺序最下位——满足任何 CI 时連撃不再判定，CI 没中就是通常攻击。
//
//   駆逐艦専用（与汎用**并行判定**，优先度 主魚電＞魚見電＞魚魚水＞魚ド水）：
//     主魚電  主砲1+魚雷1+素索敵≥5的電探           1.3 倍 × 1~2回
//     魚見電  魚雷1+熟練見張員(含水雷戦隊)+素索敵≥5的電探  1.2 倍 × 1~2回
//     魚魚水  魚雷2+水雷戦隊 熟練見張員              1.5 倍 × 1~2回（无 D 型砲補正）
//     魚ド水  魚雷1+ドラム缶(輸送用)+水雷戦隊 熟練見張員  1.3 倍 × 1~2回（无 D 型砲補正）
//   主魚電/魚見電的 D 型砲補正（合计 2 门封顶）——照抄原表数字，不自行乘算：
//     主魚電：D2×1=1.625 / D2×2=1.82 / D3×1=1.706 / D2+D3=1.911 / D3×2=2.002
//     魚見電：D2×1=1.5   / D2×2=1.68 / D3×1=1.575 / D2+D3=1.768 / D3×2=1.848
//
//   夜間瑞雲CI（軽巡/航巡/航戦/水母，与汎用并行判定）：
//     主砲≥2 + 試製 夜間瑞雲(攻撃装備)：×1=1.24 / ×1+電探=1.28 / ×2=1.32 / ×2+電探=1.36，2回
//
//   潜水艦専用（进汎用同一「倍率最高」池，例2 实证：後期2+電探 只判 1.75）：
//     電魚魚  後期型潜水艦魚雷1+潜水艦搭載電探  1.75 倍 × 2回
//     後期魚魚 後期型潜水艦魚雷≥2               1.6 倍 × 2回
//
// 装备类别的主数据实核（2026-08-12 对本机 api_start2）：
//   魚雷 = type2 5（魚雷）/ 32（潜水艦魚雷）；甲標的是 type2 22，**不算魚雷**；
//   後期型潜水艦魚雷 = type2 32 且名称含「後期型」（wiki 原文就按名字点名）；
//   潜水艦搭載電探 = type2 51（当前该类全部是電探系）；
//   素索敵≥5的電探 = type2 12/13 且 api_saku ≥ 5。
//
// ---- 発動率（2026-09-01 补，此前本层只判种别）----
//
// 口径：wikiwiki「夜戦」現行表 + 其脚注 *46 指向的一手検証
// https://cc-jabberwock.hatenablog.com/entry/2024/01/24/025325 （2024-01-24，
// 「赤仮を入れようの会」；文中逐条列举 12 件反例并全部消解，含 534 次连续発動
// 与多例定点不発観測）。数字取自 wikiwiki 原页正文，并用该页两个算例交叉验算过
// （時雨改三 / Ташкент改 双双收敛到 CI項 115，正好卡在主魚CI 係数 115 的临界，
//  那是 2024 年那轮検証的核心观测点——两例都钉进了 test/night-cutin.test.mjs）。
//
//   夜戦CI発動率[%] = CI項 ÷ 種別係数 × 100
//     運 < 50：CI項 = 15 + 運 + ⌊0.75×√Lv⌋ + 配置補正 + 損傷補正 + 装備補正
//     運 ≥ 50：CI項 = 65 + ⌊√(運−50)⌋ + ⌊0.8×√Lv⌋ + 配置補正 + 損傷補正 + 装備補正
//     配置補正 旗艦 +15 ／ 損傷補正 中破 +18
//     装備補正 味方探照灯(大型同) +7 ・ 味方照明弾 +4 ・ 相手探照灯 −5 ・ 相手照明弾 −10
//              熟練見張員 +5 ・ 水雷戦隊 熟練見張員 +8（駆逐/軽巡/雷巡のみ、他艦種は +0）
//              両方の見張員を積めば両方入る（+13。2024-01 に確定、以前は非加算説だった）
//     夜間瑞雲CI は中破で発動せず、探照灯は負補正。静态编成无法知道战斗中是否已发动，
//              所以展示层不列中破条目，并把探照灯项按 0 处理，不猜负数。
//
// **切り捨て位置是三选一**：cc-jabberwock 原文写「√(運-50) の項、または 0.8*√(Lv.) の項、
// もしくはその両方に切り捨てが入ってる可能性が高い」「この3パターンのうちのどれかというのは
// 特定が不可能でした」。三种放法在现有数据上等价（最終整数結果一致）。本模块取 wikiwiki
// 的写法——两个 ⌊⌋ 各自取整，也就是三者中**永不偏高**的那一种。
//
// **不进発動率的两样，别加**：
//   · 夜偵（九八式水上偵察機）走的是「夜間触接」，提升夜戦火力与命中率，
//     wikiwiki 的「各種補正」表里根本没有它这一行。
//   · 改修★：这一族的発動率式里没有 ★ 项。
//
// 発動率可超 100%（例：Lv175 Grecale改 運120 旗艦 + 中破 + 探照灯 ⇒ CI項 123 > 魚雷CI 122）。
// **本层照实返回原值，不封顶**——封顶是展示层的事（同 aa-rocket-barrage）。
//
// 種別係数的来源强度分两档，逐条挂在 divisorConfidence 上：
//   sourced    wikiwiki 現行表明数（主魚電 115 / 魚見電 140 各有两条独立推特，魚魚水 126 单条）
//   unverified wikiwiki **自己**把它列在「要検証事項」里（潜水艦専用係数；空母夜襲同理，
//              但空母夜襲的**種別判定**本层尚未实装，故这里没有它的条目）
// 連撃**没有係数**——wikiwiki 把夜戦連撃発動率列在「要検証事項」，唯一来源是 2015 年的
// BBS 帖，只说「高レベルの場合、運の大小問わずおおむね 95% 以上」并注明「カットインとは
// 大幅に傾向が異なる」（即不适用上面这套 CI項/係数）。所以 divisor 给 null，不编数。
export interface NightCutinEquip {
  mstId: number
  type2: number
  name: string
  /** api_saku 素索敵（「素索敵+5以上の電探」判据） */
  los: number
}

export interface NightCutinKind {
  id: string
  label: string
  multiplier: number
  attacks: '1' | '2' | '1~2'
  scope: 'generic' | 'dd' | 'ss' | 'zuiun'
  /** 判定依据（照 wiki 原文口径措辞，供界面悬停说明） */
  basis: string
  /** 是否会进入发动判定：汎用池只判倍率最高一种；驱逐/瑞雲专用与汎用并行 */
  rolled: boolean
  /**
   * 種別係数（発動率 = CI項 ÷ 係数）。**連撃是 null**——它不走这套 CI項/係数，
   * 上游把夜戦連撃発動率列在「要検証事項」，本层不编一个数（见文件头）。
   */
  divisor: number | null
  /** 係数的来源强度：sourced = wikiwiki 現行表明数；unverified = 上游自列「要検証事項」 */
  divisorConfidence: 'sourced' | 'unverified'
}

const MAIN_GUN = new Set([1, 2, 3])
const SECONDARY = new Set([4])
const TORPEDO = new Set([5, 32]) // 甲標的(22)不算魚雷
const RADAR = new Set([12, 13])

const LOOKOUT = 129 // 熟練見張員
const TORPEDO_SQUADRON_LOOKOUT = 412 // 水雷戦隊 熟練見張員
const DRUM = 75 // ドラム缶(輸送用)
const D_KAI2 = 267 // 12.7cm連装砲D型改二
const D_KAI3 = 366 // 12.7cm連装砲D型改三
const NIGHT_ZUIUN = 490 // 試製 夜間瑞雲(攻撃装備)

const DD_STYPE = 2
const SS_STYPES = new Set([13, 14])
const ZUIUN_STYPES = new Set([3, 6, 10, 16]) // 軽巡/航巡/航戦/水母

/** D 型砲補正后的倍率：照抄原表五档，D 炮合计 2 门封顶。 */
const dBoosted = (base: number, boosted: readonly number[], d2: number, d3: number): number => {
  // boosted = [D2×1, D2×2, D3×1, D2+D3, D3×2]
  if (d3 >= 2) return boosted[4]
  if (d3 === 1 && d2 >= 1) return boosted[3]
  if (d3 === 1) return boosted[2]
  if (d2 >= 2) return boosted[1]
  if (d2 === 1) return boosted[0]
  return base
}

export const nightCutinsOf = (
  stype: number,
  equips: readonly NightCutinEquip[],
): NightCutinKind[] => {
  const main = equips.filter((item) => MAIN_GUN.has(item.type2)).length
  const secondary = equips.filter((item) => SECONDARY.has(item.type2)).length
  const torpedo = equips.filter((item) => TORPEDO.has(item.type2)).length
  const lateTorpedo = equips.filter(
    (item) => item.type2 === 32 && item.name.includes('後期型'),
  ).length
  const subRadar = equips.filter((item) => item.type2 === 51).length
  const radar5 = equips.filter((item) => RADAR.has(item.type2) && item.los >= 5).length
  const lookoutAny = equips.filter(
    (item) => item.mstId === LOOKOUT || item.mstId === TORPEDO_SQUADRON_LOOKOUT,
  ).length
  const squadronLookout = equips.filter((item) => item.mstId === TORPEDO_SQUADRON_LOOKOUT).length
  const drums = equips.filter((item) => item.mstId === DRUM).length
  const d2 = equips.filter((item) => item.mstId === D_KAI2).length
  const d3 = equips.filter((item) => item.mstId === D_KAI3).length
  const nightZuiun = equips.filter((item) => item.mstId === NIGHT_ZUIUN).length

  // ---- 汎用池（含潜水艦专用条目）：只有倍率最高的一种会被判定 ----
  const pool: Omit<NightCutinKind, 'rolled'>[] = []
  if (SS_STYPES.has(stype)) {
    if (lateTorpedo >= 1 && subRadar >= 1) {
      pool.push({
        id: 'ssRadarTorp',
        label: '潜艇 電魚CI',
        multiplier: 1.75,
        attacks: '2',
        scope: 'ss',
        basis: '後期型潜水艦魚雷 1 + 潜水艦搭載電探 1',
        divisor: 105,
        divisorConfidence: 'unverified',
      })
    }
    if (lateTorpedo >= 2) {
      pool.push({
        id: 'ssLateTorp',
        label: '潜艇 後期魚雷CI',
        multiplier: 1.6,
        attacks: '2',
        scope: 'ss',
        basis: '後期型潜水艦魚雷 ×2',
        divisor: 110,
        divisorConfidence: 'unverified',
      })
    }
  }
  if (main >= 3) {
    pool.push({ id: 'mainMainMain', label: '主主主 CI', multiplier: 2.0, attacks: '1', scope: 'generic', basis: '主砲 ×3', divisor: 140, divisorConfidence: 'sourced' })
  }
  if (main >= 2 && secondary >= 1) {
    pool.push({ id: 'mainMainSecondary', label: '主主副 CI', multiplier: 1.75, attacks: '1', scope: 'generic', basis: '主砲 ×2 + 副砲 ×1', divisor: 130, divisorConfidence: 'sourced' })
  }
  if (torpedo >= 2) {
    pool.push({ id: 'torpTorp', label: '魚雷 CI', multiplier: 1.5, attacks: '2', scope: 'generic', basis: '魚雷 ×2（甲標的不算）', divisor: 122, divisorConfidence: 'sourced' })
  }
  if (main >= 1 && torpedo >= 1) {
    pool.push({ id: 'mainTorp', label: '主魚 CI', multiplier: 1.3, attacks: '2', scope: 'generic', basis: '主砲 ×1 + 魚雷 ×1', divisor: 115, divisorConfidence: 'sourced' })
  }
  const hasCutin = pool.length > 0
  if (!hasCutin && main + secondary >= 2) {
    pool.push({ id: 'double', label: '連撃', multiplier: 1.2, attacks: '2', scope: 'generic', basis: '主砲+副砲 合计 ×2（連撃判定顺序最下位，满足任一 CI 时不再判定）', divisor: null, divisorConfidence: 'unverified' })
  }
  const best = pool.reduce((top, kind) => (kind.multiplier > (top?.multiplier ?? 0) ? kind : top), null as Omit<NightCutinKind, 'rolled'> | null)
  const results: NightCutinKind[] = pool.map((kind) => ({ ...kind, rolled: kind === best }))

  // ---- 駆逐艦専用：与汎用并行判定（主魚電＞魚見電＞魚魚水＞魚ド水） ----
  if (stype === DD_STYPE) {
    const dd: NightCutinKind[] = []
    if (main >= 1 && torpedo >= 1 && radar5 >= 1) {
      dd.push({
        id: 'ddMainTorpRadar',
        label: '驱逐 主魚電 CI',
        multiplier: dBoosted(1.3, [1.625, 1.82, 1.706, 1.911, 2.002], d2, d3),
        attacks: '1~2',
        scope: 'dd',
        basis: '主砲 1 + 魚雷 1 + 素索敵≥5 電探（含 D 型砲補正）',
        divisor: 115,
        divisorConfidence: 'sourced',
        rolled: true,
      })
    }
    if (torpedo >= 1 && lookoutAny >= 1 && radar5 >= 1) {
      dd.push({
        id: 'ddTorpLookoutRadar',
        label: '驱逐 魚見電 CI',
        multiplier: dBoosted(1.2, [1.5, 1.68, 1.575, 1.768, 1.848], d2, d3),
        attacks: '1~2',
        scope: 'dd',
        basis: '魚雷 1 + 熟練見張員 + 素索敵≥5 電探（含 D 型砲補正）',
        divisor: 140,
        divisorConfidence: 'sourced',
        rolled: true,
      })
    }
    if (torpedo >= 2 && squadronLookout >= 1) {
      dd.push({
        id: 'ddTorpTorpLookout',
        label: '驱逐 魚魚水 CI',
        multiplier: 1.5,
        attacks: '1~2',
        scope: 'dd',
        basis: '魚雷 ×2 + 水雷戦隊 熟練見張員（无 D 型砲補正）',
        divisor: 126,
        divisorConfidence: 'sourced',
        rolled: true,
      })
    }
    if (torpedo >= 1 && drums >= 1 && squadronLookout >= 1) {
      dd.push({
        id: 'ddTorpDrumLookout',
        label: '驱逐 魚ド水 CI',
        multiplier: 1.3,
        attacks: '1~2',
        scope: 'dd',
        basis: '魚雷 1 + ドラム缶(輸送用) + 水雷戦隊 熟練見張員（无 D 型砲補正）',
        divisor: 122,
        divisorConfidence: 'sourced',
        rolled: true,
      })
    }
    results.unshift(...dd)
  }

  // ---- 夜間瑞雲CI：軽巡/航巡/航戦/水母，与汎用并行判定 ----
  if (ZUIUN_STYPES.has(stype) && main >= 2 && nightZuiun >= 1) {
    const multiplier = nightZuiun >= 2 ? (radar5 >= 1 ? 1.36 : 1.32) : radar5 >= 1 ? 1.28 : 1.24
    results.unshift({
      id: 'nightZuiun',
      label: '夜間瑞雲 CI',
      multiplier,
      attacks: '2',
      scope: 'zuiun',
      basis: '主砲 ×2 + 試製 夜間瑞雲(攻撃装備)（×2 或加素索敵≥5 電探再提档）',
      divisor: 135,
      divisorConfidence: 'sourced',
      rolled: true,
    })
  }

  return results
}

// ---- CI項 与発動率（口径与逐条出处见文件头「発動率」段）----

/** 水雷戦隊 熟練見張員 的 +8 只对这三种舰种生效，其余舰种 +0。 */
const SQUADRON_LOOKOUT_STYPES = new Set([2, 3, 4]) // 駆逐 / 軽巡 / 雷巡

/** 探照灯（29）与大型探照灯（42）同档，都记 +7。 */
const SEARCHLIGHT_TYPES = new Set([29, 42])
const STAR_SHELL_TYPE = 33 // 照明弾

export const isSearchlight = (type2: number): boolean => SEARCHLIGHT_TYPES.has(type2)
export const isStarShell = (type2: number): boolean => type2 === STAR_SHELL_TYPE

export interface NightCutinScoreInput {
  level: number
  luck: number
  stype: number
  /** 配置補正 +15 */
  flagship: boolean
  /** 損傷補正 +18。**中破一档而已**——大破在上游表里没有条目，别外推 */
  chuuha?: boolean
  /** 味方に探照灯（大型含む）：+7。舰队级——同队任一舰带着就成立 */
  friendlySearchlight?: boolean
  /** 夜間瑞雲CI：味方探照灯不套通用 +7（负补正数值不在静态编成里猜） */
  nightZuiun?: boolean
  /** 味方に照明弾：+4。舰队级 */
  friendlyStarShell?: boolean
  /** 相手の探照灯：−5 */
  enemySearchlight?: boolean
  /** 相手の照明弾：−10 */
  enemyStarShell?: boolean
  /** **这一艘**装了熟練見張員（mstId 129）：+5 */
  lookout?: boolean
  /** **这一艘**装了水雷戦隊 熟練見張員（mstId 412）：+8，仅駆逐/軽巡/雷巡 */
  squadronLookout?: boolean
}

export interface NightCutinScore {
  /** CI項（整数） */
  score: number
  /** 補正之前的基本项（運/Lv 那两段） */
  base: number
  /** 逐条補正，供界面把这个数从哪来说清楚。值为 0 的项不进这张表 */
  corrections: { label: string; value: number }[]
}

/**
 * CI項。運 50 是分界（運キャップ；実用上 51 最优——運50 时 √(50−50)=0 毫无贡献）。
 *
 * 切り捨て按 wikiwiki 写法分两处各自取整（三选一里永不偏高的那种，见文件头）。
 */
export const nightCutinScoreOf = (input: NightCutinScoreInput): NightCutinScore => {
  const luck = Math.max(0, input.luck)
  const level = Math.max(0, input.level)
  const base =
    luck >= 50
      ? 65 + Math.floor(Math.sqrt(luck - 50)) + Math.floor(0.8 * Math.sqrt(level))
      : 15 + luck + Math.floor(0.75 * Math.sqrt(level))
  const corrections: { label: string; value: number }[] = []
  const add = (label: string, value: number) => {
    if (value !== 0) corrections.push({ label, value })
  }
  add('旗舰', input.flagship ? 15 : 0)
  add('中破', input.chuuha ? 18 : 0)
  add('探照灯', input.friendlySearchlight && !input.nightZuiun ? 7 : 0)
  add('照明弹', input.friendlyStarShell ? 4 : 0)
  add('熟练见张员', input.lookout ? 5 : 0)
  add(
    '水雷战队见张员',
    input.squadronLookout && SQUADRON_LOOKOUT_STYPES.has(input.stype) ? 8 : 0,
  )
  add('敌方探照灯', input.enemySearchlight ? -5 : 0)
  add('敌方照明弹', input.enemyStarShell ? -10 : 0)
  return {
    score: base + corrections.reduce((sum, one) => sum + one.value, 0),
    base,
    corrections,
  }
}

/**
 * 発動率百分数。**不封顶**（CI項 可以超过係数，见文件头），
 * 係数为 null 的种别（連撃）返回 null——那是「上游没给」，不是 0。
 */
export const nightCutinRate = (score: number, kind: NightCutinKind): number | null =>
  kind.divisor === null ? null : (score / kind.divisor) * 100
