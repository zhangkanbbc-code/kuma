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
// 诚实边界：本层只判**种别与倍率**。发动率取决于运/等级/探照灯/照明弹/旗舰位/损伤，
// 页面给出的公式新旧多版并存，不在这里给一个冒充确定值的数。
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
      })
    }
  }
  if (main >= 3) {
    pool.push({ id: 'mainMainMain', label: '主主主 CI', multiplier: 2.0, attacks: '1', scope: 'generic', basis: '主砲 ×3' })
  }
  if (main >= 2 && secondary >= 1) {
    pool.push({ id: 'mainMainSecondary', label: '主主副 CI', multiplier: 1.75, attacks: '1', scope: 'generic', basis: '主砲 ×2 + 副砲 ×1' })
  }
  if (torpedo >= 2) {
    pool.push({ id: 'torpTorp', label: '魚雷 CI', multiplier: 1.5, attacks: '2', scope: 'generic', basis: '魚雷 ×2（甲標的不算）' })
  }
  if (main >= 1 && torpedo >= 1) {
    pool.push({ id: 'mainTorp', label: '主魚 CI', multiplier: 1.3, attacks: '2', scope: 'generic', basis: '主砲 ×1 + 魚雷 ×1' })
  }
  const hasCutin = pool.length > 0
  if (!hasCutin && main + secondary >= 2) {
    pool.push({ id: 'double', label: '連撃', multiplier: 1.2, attacks: '2', scope: 'generic', basis: '主砲+副砲 合计 ×2（連撃判定顺序最下位，满足任一 CI 时不再判定）' })
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
      rolled: true,
    })
  }

  return results
}
