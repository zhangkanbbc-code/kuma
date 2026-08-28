// 活动图的**輸送物資量专用表**（第一方小表，一图一录，活动结束即作废）。
//
// ## 这张表补的是哪个洞
//
// shared/transport-point 的通用表是全活动通用口径。个别活动图会另发一张自己的表：
// 舰种基础乘一个图系数（Modmap），装备值则整张换掉——同族各版本的值互不相同，
// 差距还很大（本图里素の大発 6，特大発+Ⅲ号戦車J型 23）。拿通用表去算这种图，
// 数会大得离谱：本图那次实测里通用表给 205，游戏实际结算 171。
//
// ## 62-5（2026 夏「反撃！第三十一戦隊の戦い」E-5）P2 輸送段
//
// ### 口径由一手实测锚钉死（2026-08-27 15:28–15:36，本机账本可复现）
//
// 这不是照攻略表抄的，是拿自家账本里一场真出击反推、并与游戏结算画面对上的：
//
// - 出击：62-5 联合舰队 12 舰，4 战全 S 胜，无退避、无大破（最低 Prinz Eugen 改 23/63 = 36.5%，中破）
// - 游戏结算：`api_req_combined_battle/battleresult` 的
//   `api_landing_hp = {api_max_hp:"800", api_now_hp:"800", api_sub_value:171}`
// - 独立第二票：输送条 `api_now_maphp` 800 → 629，正好 171
//
// 按本表算：
//
// - 舰种：航戦 5.25 + 航巡 3 + 軽巡 1.5 + 駆逐 3.75×6 = 32.25
//   （戦艦/重巡/軽空母 一律 0）
// - 装备：素の大発動艇 ×19 × 6 = 114，特四式内火艇 ×1 × 11.5，大発動艇(八九式中戦車&陸戦隊) ×1 × 14
//   = 139.5
// - 合计 171.75 → 取整 **171** ✓
//
// ### 取整时机就是这枚锚定下来的
//
// 同一支队，三种取整各算各的：
//
// | 取整时机 | 结果 |
// |---|---|
// | 逐件取整 | 166 |
// | 逐舰取整 | 167 |
// | **累加到合计再取整** | **171** ✓ |
//
// 游戏给的是 171，所以口径是**全程精确值累加、最后才取整**（实现在 transport-point）。
//
// ### 「合计」的范围：分队各自取整（上游原文）
//
// wikiwiki 同一节里把范围也写死了：
//
// > 小数点部分は第一艦隊、第二艦隊ごとにS勝利時の値を計算して切り捨てられ、
// > A勝利時は0.7倍されてもう一度切り捨てられるため、()内は正確な値にならない。
//
// 即 `S = ⌊第一舰队合计⌋ + ⌊第二舰队合计⌋`，A 也是各队 ×0.7 各自取整再相加。
// 脚注 *23「計算の最後に小数点以下切り捨て」与通用页、艦これ検証Wiki 一致。
//
// 上面那枚实测锚**两种算法都给 171**（第一舰队 60.0、第二舰队 111.75
// → 分队 60+111 = 171，整支 171.75 → 171），所以它证不了分队这一层，
// 只能说不与之矛盾。分队是照上游原文实现的。
//
// ### 还没锚住的几格（照实说）
//
// - **A 胜**：这一场是 S 胜，没有 A 胜实测样本。按上游原文实现
//   （各队 ⌊S队 × 0.7⌋ 相加 = 42 + 77 = 119）。
// - **难度**：锚这一场是**丁**（`api_selected_rank` 1，输送条总量 800，与上游
//   「甲1280 / 乙1120 / 丙960 / 丁800」对得上）。Modmap 与装备值是否随难度变，
//   本仓没有第二难度样本；上游按图给表、不按难度分，故先当全难度通用。
// - **ドラム缶(輸送用)**：上游三家打架，见下面那一行的行注。
// - **鬼怒改二**：上游 2025秋E2 页另记一条单舰特例（S 9.5 / A 6.65 ＝ 軽巡 1.5 ＋
//   自带大発按**本来值 8.0**而非本图的 6.0，且**只算第一艘**）。本仓通用表历来也没做
//   单舰特例（fleet-calc 头注写着「未覆盖：鬼怒改二等单舰特殊补正」），这里保持一致：
//   **不做**。带鬼怒改二时本表会少算 8 点左右。要做得连通用表一起做，另开一批。
//
// ## 装备为什么按 mstId 而不是名字
//
// 通用表按名字前缀匹配是对的（大発家族持续新增，名字模式比穷举 id 耐更新）。
// 这张表反过来——它一图一表、活动一结束就作废，不存在「耐更新」的需求，
// 而按名字匹配这里有一个**不报错的坑**：游戏自己的装备名里，
//
// - id 482 `特大発動艇+Ⅲ号戦車(北アフリカ仕様)` / id 514 `特大発動艇+Ⅲ号戦車J型`
//   用的是 CJK 罗马数字 `Ⅲ`（U+2162），
// - id 436 `大発動艇(II号戦車/北アフリカ仕様)` 用的却是两个 ASCII 大写 I。
//
// 同一批装备两种写法。攻略表/截图上一律排版成 ASCII "III"，照抄进正则就是**永不命中**——
// 不报错、界面上也看不出来，只会把 23 分静静算成 6 分。按 mstId 就没有这一格。
// 下面每行的 `name` 只是给人对照用的（2026-08-27 逐条比对 `api_mst_slotitem` 原文）。
//
// ## 出处
//
// - **口径与取整**：本机账本一手实测锚（上文），2026-08-27；分队取整那一层照上游原文。
// - **表值**：wikiwiki「L'Élan de la Flotte Française -フランス艦隊の躍動-/E5」
//   （旧名「反撃！第三十一戦隊の戦い/E5」）页内折叠节
//   「輸送資源量(TP)の計算について(2025秋E2より引用)」，2026-08-27 逐格核对。
//
//   注意上游这一节的结构：**E5 页只带装备表和算式，舰种表不在 E5 页上**——
//   它在被引用的「逆転！ナルヴィク攻防戦/E2」页，标题写的是
//   「※艦種TPも異なっている。**通常時の0.75倍？**」，带问号，是上游自己的推测。
//   本仓的实测锚把其中四种（航戦/航巡/軽巡/駆逐）从推测升成了实测，其余六种仍是上游推测。
//
// - 用户截图是上述 wikiwiki 表的转录，逐格核过，只有 ドラム缶 一行不一致（见行注）。
//
// ## 逐格核对结论（2026-08-27）
//
// 装备 25 行：24 行与上游 wikiwiki 一致；ドラム缶(輸送用) 一行有争议，按 wikiwiki 取 3.25。
// 舰种 10 行：与上游 10 行全部一致（且 ×0.75 关系成立）。
//
// 顺带记一个**别去信博客**的坑：zekamashi 与 totoneko 两家都把
// 潜水空母(0.75) 与 潜水母艦(5.25) 写反了——同一处错误出现在两家，说明它们同源。
// wikiwiki 是对的，用户截图也是对的。

import { mapAreaOf, mapIdOf, mapNoOf } from './map-id'
import { TP_GENERAL_BY_STYPE } from './transport-point'

import type { TransportEquip, TransportTable } from './transport-point'

/** 游戏原生血条类型：3 = 运输 TP 条（见 mg-types.MapGauge.gaugeType） */
export const TP_GAUGE_TYPE = 3

export interface EventTpEquipValue {
  /** api_mst_slotitem 的 api_id */
  readonly mstId: number
  /** 游戏原文名，仅供人对照；匹配一律走 mstId */
  readonly name: string
  /** S 胜值 */
  readonly tp: number
  /** 是否已被一手实测锚直接核过 */
  readonly anchored?: true
}

export interface EventTpRule {
  readonly area: number
  readonly mapNo: number
  /** 界面标注用的图号，如 `'62-5'` */
  readonly label: string
  /** 这张表管的是第几条血条（仅作注记；判据走 gaugeType，见 eventTpRuleOf） */
  readonly gaugeNum: number | null
  /** 图系数：舰种基础 = 通用値 × modmap */
  readonly modmap: number
  /** A 胜比率 */
  readonly aRate: number
  readonly equips: readonly EventTpEquipValue[]
  /** 悬停里那句「适用范围 + 出处」 */
  readonly scopeNote: string
}

export const EVENT_TP_RULES: readonly EventTpRule[] = [
  {
    area: 62,
    mapNo: 5,
    label: '62-5',
    gaugeNum: 2,
    modmap: 0.75,
    aRate: 0.7,
    scopeNote:
      '仅 62-5 输送段（P2）适用：舰种基础 ×0.75，装备另有专表，联合时两队各自取整 · ' +
      '出处 wikiwiki E5「輸送資源量(TP)の計算について」，' +
      '并由 2026-08-27 本机实测（游戏结算 TP 171）复核',
    equips: [
      // ── 大発／特大発 系 ──
      { mstId: 576, name: '大発動艇(R35&フランス兵)', tp: 24 },
      { mstId: 514, name: '特大発動艇+Ⅲ号戦車J型', tp: 23 },
      { mstId: 449, name: '特大発動艇+一式砲戦車', tp: 21 },
      { mstId: 355, name: 'M4A1 DD', tp: 20 },
      { mstId: 230, name: '特大発動艇+戦車第11連隊', tp: 19 },
      { mstId: 495, name: '特大発動艇+チハ改', tp: 19 },
      { mstId: 482, name: '特大発動艇+Ⅲ号戦車(北アフリカ仕様)', tp: 19 },
      { mstId: 494, name: '特大発動艇+チハ', tp: 17 },
      { mstId: 436, name: '大発動艇(II号戦車/北アフリカ仕様)', tp: 16 },
      { mstId: 166, name: '大発動艇(八九式中戦車&陸戦隊)', tp: 14, anchored: true },
      { mstId: 68, name: '大発動艇', tp: 6, anchored: true },
      { mstId: 193, name: '特大発動艇', tp: 6 },
      { mstId: 408, name: '装甲艇(AB艇)', tp: 6 },
      { mstId: 409, name: '武装大発', tp: 6 },
      // ── 内火艇系 ──
      { mstId: 526, name: '特四式内火艇改', tp: 13.5 },
      { mstId: 167, name: '特二式内火艇', tp: 12.5 },
      { mstId: 525, name: '特四式内火艇', tp: 11.5, anchored: true },
      // ── 陸軍部隊系 ──
      { mstId: 499, name: '陸軍歩兵部隊+チハ改', tp: 14 },
      { mstId: 498, name: '九七式中戦車 新砲塔(チハ改)', tp: 9 },
      { mstId: 497, name: '九七式中戦車(チハ)', tp: 7 },
      { mstId: 496, name: '陸軍歩兵部隊', tp: 5 },
      // ── 輸送用小物 ──
      //
      // ドラム缶：上游三家打架，取 wikiwiki 的 3.25。
      // - wikiwiki（E5 与 2025秋E2 两页）：3.25（A 栏 2.275）
      // - totoneko：正文写 "3.3"，但 A 栏也是 2.275 ＝ 3.25×0.7 → 底值同为 3.25
      // - zekamashi：3.75（A 栏 2.625）——正好等于通用值 5.0×0.75，
      //   像是拿图系数反推出来的；而本表**只有素の大発和糧食两族**满足 ×0.75，
      //   戦車/内火艇/ドラム缶 都是另给的值，所以这条反推本来就不成立。
      // 三票里两票（且都带 A 栏这个更难编的交叉校验）指向 3.25。
      // 本仓那枚实测锚里没有ドラム缶，**证不了这一格**——真要定得等一次带缶的实测。
      { mstId: 75, name: 'ドラム缶(輸送用)', tp: 3.25 },
      { mstId: 145, name: '戦闘糧食', tp: 0.75 },
      { mstId: 150, name: '秋刀魚の缶詰', tp: 0.75 },
      { mstId: 241, name: '戦闘糧食(特別なおにぎり)', tp: 0.75 },
    ],
  },
]

/**
 * 当前海域这一段该用哪张专用表；没有就返回 null（照通用表算）。
 *
 * 判据用的是**游戏自己下发的血条类型**：`api_get_member/mapinfo` 每次打开出击图都逐图带
 * `api_gauge_type`（3 = 运输条）与 `api_gauge_num`，落进 `mg.mapGauges`。所以
 *
 * - 输送段还在打 → `gaugeType === 3 && !cleared` → 用专用表；
 * - 输送段打完翻到下一条（HP 条）→ `gaugeType` 变 2 → 自动回落通用；
 * - 活动结束、图不再在册 → mapinfo 处理器是 `state.mapGauges = {}` 后整表重建，
 *   这一格直接消失 → `gauge` 为 undefined → 自动回落通用，零残留。
 *
 * `gaugeNum` 不进判据：`gaugeType === 3` 本身就等于「当前这条是输送条」，
 * 再比一次段号只会在段号缺失时把对的语境判错。
 */
export const eventTpRuleOf = (
  mapId: number,
  gauge: { gaugeType: number | null; cleared: boolean } | null | undefined,
): EventTpRule | null => {
  if (!gauge || gauge.cleared || gauge.gaugeType !== TP_GAUGE_TYPE) return null
  const area = mapAreaOf(mapId)
  const mapNo = mapNoOf(mapId)
  return EVENT_TP_RULES.find((rule) => rule.area === area && rule.mapNo === mapNo) ?? null
}

/**
 * 现在有没有哪张图的输送段正开着——舰队面板要的是这一问。
 *
 * 面板上的芯片不知道玩家打算去哪张图，能问的只有「当下这个游戏状态里，
 * 有没有一张带专表的图正在输送段」。有就按那张表显示（并标图号），没有就通用。
 */
export const activeEventTpRuleOf = (
  gauges: Readonly<Record<number, { gaugeType: number | null; cleared: boolean }>> | null | undefined,
): EventTpRule | null => {
  if (!gauges) return null
  for (const rule of EVENT_TP_RULES) {
    const found = eventTpRuleOf(mapIdOf(rule.area, rule.mapNo), gauges[mapIdOf(rule.area, rule.mapNo)])
    if (found) return found
  }
  return null
}

/** 把一条专用表规则摊成计算核吃的 `TransportTable`。 */
export const eventTpTableOf = (rule: EventTpRule): TransportTable => {
  const byId = new Map(rule.equips.map((e) => [e.mstId, e.tp]))
  const stypeTp: Record<number, number> = {}
  for (const [stype, tp] of Object.entries(TP_GENERAL_BY_STYPE)) {
    stypeTp[Number(stype)] = tp * rule.modmap
  }
  return {
    label: rule.label,
    stypeTp,
    // 表里没有的装备一律 0：这张表是**穷举**的（录入时逐条比对过 api_mst_slotitem，
    // 当时全部 25 件带 TP 的装备一件不漏）。活动中途真出了新装备，宁可算少也不猜。
    equipTp: (equip: TransportEquip) => byId.get(equip.mstId) ?? 0,
    aRate: rule.aRate,
    perFleet: true,
  }
}
