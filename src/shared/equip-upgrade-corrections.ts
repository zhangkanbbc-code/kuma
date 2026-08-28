// 改修表的**第一方校正台账**（范式照 `shared/fit-bonus-corrections`）。
//
// ---- 为什么需要它（2026-08-25 用户游戏实测裁决）----
// 随包的改修数据换源自 wikiwiki「改修表」。那张表把**二号舰**与**档位**压在同一组
// 排版行里，靠 rowspan 做视觉打包；抓取器（`scripts/lib/wikiwiki-kaishu.mjs`）
// 按位置对齐读，就把「哪一档」绑到了「哪一个二号舰」上。
//
// 用户进游戏实测（瑞雲改二(六三四空) eq_id 322）：
//   **最上改二特当二号舰，能改 ★0 的那一件**，消耗显示改修资材 10 / 开发资材 8，
//   与包里记在「日向改二」名下的 p1 一模一样。
// 即 kcwiki 的口径对：**二号舰是并列候选、全档都能用**，差别只在**更新可不可以**
//（日向改二不能更新成夜間瑞雲）。包里那种「日向改二只有 ★0-5、最上改二只有 ★6-9」
// 是抓取器的错拆，不是游戏的规则。
//
// ---- 为什么不改抓取器 ----
// 「按档换二号舰」这个机制在别的装备上**真实存在**，一刀切改成「全档全可用」会把
// 那些改错。wikiwiki 改修表在多二号舰装备上作为机读源结构性不可靠——换源/加二票是
// 发布后的立项，不是发布前该动的东西。所以这里走**台账覆盖**：包文件一个字不改，
// 装配时把裁定过的那几件整条换掉。
//
// ---- 自失效 ----
// 每条校正钉着它当初看到的上游指纹。上游哪天改了那几行，指纹对不上就**跳过并告警**，
// 而不是拿一份过期的校正去改一个已经变了样的东西——那种错法既看不见又说不清。
//
// ---- 只录裁过的 ----
// 同病嫌疑还有好几件（`PENDING_EQUIP_UPGRADE_SUSPECTS`）。**不许替用户拍板**：
// 没实测过的一律照上游显示，差异列进报告等他人肉裁，裁一件加一件，机制不变。
//
// ---- 每条都要写清证据等级 ----
// `basis` 里「游戏实测」与「表对照 + 同因推定」是两回事，不许混着写。
// 322 是用户亲手在游戏里点出来的；294 是照 kcwiki 表补的，用户手上没有磯波改二，
// 补进去的那一档**谁都没在游戏里看过**——这一点必须留在台账上，
// 免得下一个人把它当成已经验过的事实。
//
// ============================================================================
// 机制通则（2026-08-25 用户裁决，长期判据）
// ============================================================================
// 上面那两件是一件一件裁的。裁到第三件时用户把**机制**本身定了下来，
// 于是同病的那一批不必再逐件实测——判据在机制，不在个案。
//
// **通则一：舰C 不存在「某二号舰只能从 ★x≠0 开始改修」。**
// 一件装备只要某二号舰支持改修，就是全档 ★0 → ★max 都支持；
// 只有**更新**才有专属二号舰要求。
//
// **通则二：能做更新的二号舰，100% 支持该装备的全档改修。**
// 「某舰只管更新、不管改修档」这种行在机制上不存在。
//
// 论证走的是明石改修界面本身：那个界面**按装备列行**，一件装备在某二号舰名下
// 要么出现、要么不出现——界面上根本没有「只限某星级段」的表达位。
// 所以包里那种「日向改二只有 ★0-5」不可能是游戏的样子，只能是抓取器的产物。
// 更新是另一回事：它是 ★max 时亮灯的独立判定，有自己的二号舰名单。
//
// 通则怎么落到数据上，见下面的 `EQUIP_UPGRADE_LADDER_FILLS`：
// 那一批不逐件抄数值，只列「哪几件适用」，缺的档由同装备他行同档现推。

import type { ImproveCosts } from './improve-budget'

export interface EquipUpgradeHelper {
  ship_ids: number[]
  days: number[]
}

export interface EquipUpgradeRowShape {
  convert: { id_after: number; lvl_after: number } | null
  helpers: EquipUpgradeHelper[]
  costs: ImproveCosts
}

export interface EquipUpgradeCorrection {
  eqId: number
  /** 装备名，只为读台账的人方便；判定一律用 eqId */
  label: string
  /** 记下这条校正时上游长什么样；对不上就跳过 */
  fingerprint: string
  /** 证据。每条都要写清是实测还是交叉，不许含糊 */
  basis: string
  /** 记下来但**未实测**的差异，留给下一轮裁决；不影响显示 */
  pending?: readonly string[]
  improvement: readonly EquipUpgradeRowShape[]
}

const stageMark = (stage: ImproveCosts['p1']): string =>
  stage
    ? `${stage.devmats ?? ''}/${stage.devmats_sli ?? ''}:${stage.screws ?? ''}/${stage.screws_sli ?? ''}`
    : '-'

/** 上游那份 improvement 的指纹：只回答「还是台账记下它时的样子吗」。 */
export const equipUpgradeFingerprint = (improvement: readonly any[] | null | undefined): string =>
  (improvement ?? [])
    .map((row: any) => {
      const costs = row?.costs ?? {}
      const helpers = (row?.helpers ?? [])
        .map((one: any) =>
          [...(one?.ship_ids ?? [])]
            .map(Number)
            .filter((id) => Number.isFinite(id))
            .sort((a, b) => a - b)
            .join('.'),
        )
        .sort()
        .join('|')
      return [
        Number(row?.convert?.id_after) || 0,
        stageMark(costs.p1),
        stageMark(costs.p2),
        stageMark(costs.conv),
        helpers,
      ].join('#')
    })
    .join(';')

// ---- 各档消耗（322：三档的数字上游本身没记错，错的只是它们挂在谁名下）----

const ZUIUN_P1: ImproveCosts['p1'] = {
  devmats: 10,
  devmats_sli: 12,
  screws: 8,
  screws_sli: 8,
  equips: [{ id: 26, eq_count: 2 }], // 瑞雲
  consumable: [],
}
const ZUIUN_P2: ImproveCosts['p2'] = {
  devmats: 15,
  devmats_sli: 30,
  screws: 9,
  screws_sli: 12,
  equips: [{ id: 55, eq_count: 2 }], // 紫電改二
  consumable: [],
}
const ZUIUN_CONV: ImproveCosts['conv'] = {
  devmats: 32,
  devmats_sli: 48,
  screws: 10,
  screws_sli: 17,
  equips: [{ id: 344, eq_count: 1 }], // 九七式艦攻改 試製三号戊型
  consumable: [
    { id: 77, eq_count: 4 }, // 新型航空兵装資材
    { id: 78, eq_count: 1 }, // 戦闘詳報
  ],
}
const ZUIUN_BASE = { fuel: 240, ammo: 280, steel: 0, baux: 630 }
/** 星期照包原样（火/水/木）——本条裁的是「哪一档归谁」，没裁日程。 */
const ZUIUN_DAYS = [2, 3, 4]

// ---- 294：12.7cm連装砲A型改二（与 322 同因，2026-08-25）----
//
// 上游给 294 记了三行，**只有「磯波改二 → 更新成 295」那一行缺 ★0-5 段**，
// 另外两行的 ★0-5 一模一样（改修资材 2/确保 3、开发资材 2/确保 2、12.7cm連装砲A型×2）。
// 这正是 322 那种两维压行的错拆：磯波改二那一格在排版上被更新档吃掉了。
//
// 消耗数字全部**取同装备他行的同一档**，不是新编：改修消耗由「装备 + 星级」决定，
// 与二号舰无关（322 与本件的 kcwiki 表都印证同装备各行同档消耗一致）。
// ★6-9 与更新档上游本来就有，原样留着；星期（木/金/土）照包不动。
const A_GATA_BASE = { fuel: 10, ammo: 40, steel: 70, baux: 10 }
/** ★0-5：与 294 另外两行同档同值 */
const A_GATA_P1: ImproveCosts['p1'] = {
  devmats: 2,
  devmats_sli: 3,
  screws: 2,
  screws_sli: 2,
  equips: [{ id: 297, eq_count: 2 }], // 12.7cm連装砲A型
  consumable: [],
}
/** ★6-9：上游本来就有，原样 */
const A_GATA_P2: ImproveCosts['p2'] = {
  devmats: 3,
  devmats_sli: 4,
  screws: 3,
  screws_sli: 5,
  equips: [{ id: 3, eq_count: 2 }], // 10cm連装高角砲
  consumable: [],
}
/** 更新（★max 时的独立判定）：上游本来就有，原样 */
const A_GATA_CONV: ImproveCosts['conv'] = {
  devmats: 11,
  devmats_sli: 18,
  screws: 8,
  screws_sli: 11,
  equips: [{ id: 121, eq_count: 1 }], // 94式高射装置
  consumable: [
    { id: 75, eq_count: 1 }, // 新型砲熕兵装資材（失败也耗）
    { id: 78, eq_count: 1 }, // 戦闘詳報（失败不耗）
  ],
}

// ---- 21：零式艦戦52型（A 档第 1 件结案，2026-08-25）----
//
// 这一件上游缺两处，病灶不是同一个：
//   ① **瑞鶴那一行整行零段位**——p1/p2/更新三段全空，只挂着瑞鶴/改/改二/改二甲
//      和星期（日一三）。零段位与「缺一两段」不是一回事，所以它一直压在待裁名单里
//      没让通则去补：凭空造出一整行改修，和补一段是两种风险。
//   ② **翔鶴那一行缺更新消耗段**——convert 指着零式艦戦62型(爆戦) ★+4 摆在那儿，
//      conv 却是空的。更新目标有、消耗没有，等于告诉提督「能更新，不要钱」。
//
// 用户拿 kcwiki 改修表（该页 2016 年后未再编辑，所以结构可信、助手名单不含 2016 年后
// 新增的那些）把两处都补齐了。交叉印证：kcwiki 给**瑞鶴行**的两档
//（初期 3/5·3/4·零式艦戦52型×1，★6 5/8·3/5·零式艦戦52型×2）与包里**翔鶴行**
// 已有的两档逐字相同——这是「改修消耗由装备+星级决定、与二号舰无关」这条前提
// 在本件上的又一次独立印证（见文件头「机制通则」）。
//
// 龍鳳与翔鶴同在一行、共享这段更新消耗，不拆行：官方推文明示龍鳳可更新
//（KanColle_STAFF 2024-05-29：「軽空母『龍鳳』のサポートでも艦上戦闘機
//【零式艦戦52型】の強化改修が可能となります。※同上位兵装【零式艦戦62型(爆戦)】への
// 装備更新も可能です。」）。包里把龍鳳放在可更新行与官方一致，那部分一个字没动。
const REI52_BASE = { fuel: 120, ammo: 120, steel: 0, baux: 280 }
/** ★0-5：上游翔鶴行本来就有，kcwiki 的瑞鶴行同值 */
const REI52_P1: ImproveCosts['p1'] = {
  devmats: 3,
  devmats_sli: 5,
  screws: 3,
  screws_sli: 4,
  equips: [{ id: 21, eq_count: 1 }], // 零式艦戦52型
  consumable: [],
}
/** ★6-9：同上 */
const REI52_P2: ImproveCosts['p2'] = {
  devmats: 5,
  devmats_sli: 8,
  screws: 3,
  screws_sli: 5,
  equips: [{ id: 21, eq_count: 2 }], // 零式艦戦52型
  consumable: [],
}
/** 更新（→零式艦戦62型(爆戦) ★+4）：上游这一段是空的，照 kcwiki 补 */
const REI52_CONV: ImproveCosts['conv'] = {
  devmats: 5,
  devmats_sli: 8,
  screws: 3,
  screws_sli: 5,
  equips: [{ id: 23, eq_count: 2 }], // 九九式艦爆
  consumable: [],
}

// ---- 66：8cm高角砲（A 档最后一件，改修嫌疑清单就此清零，2026-08-25）----
//
// 与 21 是同一副样子，缺的两处也同型：
//   ① **能代/阿賀野那一行整行零段位**——三段全空，只挂着能代/改/改二（日月）
//      与阿賀野/改（日木金土）。
//   ② **矢矧那一行缺更新消耗段**——convert 指着 8cm高角砲改+増設機銃 摆着，conv 是空的。
//
// 两档的数值用的是 wikiwiki 改修表**修订后**的新值（4/5·2/3·8cm高角砲×1，
// 5/7·2/4·10cm連装高角砲×1）。那张表把修订前的旧值划了线留在页面上，
// 抓取器已经正确地把划线值弃掉了——**这一处上游是对的，别动**。
// 更新消耗两家表一致：8/16·8/12·25mm単装機銃×2。
//
// 前半那一档的素材有官方一手：KanColle_STAFF 推文 2026-03-13（「新改修メニュー
// 追加実装＆更新 4/6」）写明**前半改修所需装备由『10cm連装高角砲』改为【8cm高角砲】**。
// 这正是包里 p1 素材 8cm高角砲 的来路，也顺带说明 **kcwiki 那张表停在 2026-03 调整前**
//（所以它只当结构与二号舰名单的一票，数值不取它的）。
// 改修菜单是一条、不分二号舰，所以能代/阿賀野行的 p1 同样取这个新值。
// ⚠ 推文里那个菜单名对不上主数据，归属存疑，已挂 pending——见下面第二条。
//
// 能代/阿賀野按通则一补两档、conv 仍然不给：两家表都写这一行更新不可。
const HACHI_BASE = { fuel: 10, ammo: 40, steel: 80, baux: 40 }
/** ★0-5：上游矢矧行本来就有（wikiwiki 修订后的新值），原样 */
const HACHI_P1: ImproveCosts['p1'] = {
  devmats: 4,
  devmats_sli: 5,
  screws: 2,
  screws_sli: 3,
  equips: [{ id: 66, eq_count: 1 }], // 8cm高角砲
  consumable: [],
}
/** ★6-9：同上 */
const HACHI_P2: ImproveCosts['p2'] = {
  devmats: 5,
  devmats_sli: 7,
  screws: 2,
  screws_sli: 4,
  equips: [{ id: 3, eq_count: 1 }], // 10cm連装高角砲
  consumable: [],
}
/** 更新（→8cm高角砲改+増設機銃）：上游这一段是空的，照两家表补 */
const HACHI_CONV: ImproveCosts['conv'] = {
  devmats: 8,
  devmats_sli: 16,
  screws: 8,
  screws_sli: 12,
  equips: [{ id: 49, eq_count: 2 }], // 25mm単装機銃
  consumable: [],
}

export const EQUIP_UPGRADE_CORRECTIONS: readonly EquipUpgradeCorrection[] = Object.freeze([
  {
    eqId: 322,
    label: '瑞雲改二(六三四空)',
    fingerprint: '490#-#15/30:9/12#32/48:10/17#501.506;0#10/12:8/8#-#-#554',
    basis:
      '用户 2026-08-25 游戏实测：最上改二特当二号舰能改 ★0 的这一件（改修资材 10 / 开发资材 8，' +
      '与上游记在日向改二名下的 ★0-5 档一致）→ 二号舰是并列候选、全档可用；' +
      'kcwiki 改修表同口径交叉。差别只在更新：日向改二不能更新成夜間瑞雲。',
    pending: [
      'kcwiki 表的周四格只写「最上改二」、不含「最上改二特」；本台账按上游把两者的日程都记作 火/水/木——这一格未实测',
    ],
    improvement: [
      {
        // 更新不可：这一行只强化，推满就到头
        convert: null,
        helpers: [{ ship_ids: [554], days: ZUIUN_DAYS }], // 日向改二
        costs: { ...ZUIUN_BASE, p1: ZUIUN_P1, p2: ZUIUN_P2 },
      },
      {
        convert: { id_after: 490, lvl_after: 0 }, // 試製 夜間瑞雲(攻撃装備)
        helpers: [{ ship_ids: [501, 506], days: ZUIUN_DAYS }], // 最上改二 / 最上改二特
        costs: { ...ZUIUN_BASE, p1: ZUIUN_P1, p2: ZUIUN_P2, conv: ZUIUN_CONV },
      },
    ],
  },
  {
    eqId: 294,
    label: '12.7cm連装砲A型改二',
    fingerprint:
      '295#-#3/4:3/5#11/18:8/11#666;455#2/3:2/2#3/4:3/5#9/17:6/8#647|959;0#2/3:2/2#3/4:3/5#-#1035.1040|420|426',
    basis:
      'kcwiki 改修表对照 + 322 同因结构推定，未游戏实测（用户未持有磯波改二）·2026-08-25',
    improvement: [
      {
        // 磯波改二：上游这一行**缺 ★0-5**，补上（同装备他行同档值）
        convert: { id_after: 295, lvl_after: 0 }, // 12.7cm連装砲A型改三(戦時改修)+高射装置
        helpers: [{ ship_ids: [666], days: [4, 5, 6] }], // 磯波改二 · 木/金/土，照包不动
        costs: { ...A_GATA_BASE, p1: A_GATA_P1, p2: A_GATA_P2, conv: A_GATA_CONV },
      },
      // 下面两行上游本来就齐，原样抄回来——台账是整条替换，少抄一行就等于把它删了
      {
        convert: { id_after: 455, lvl_after: 1 }, // 12.7cm連装砲A型改三
        helpers: [
          { ship_ids: [647], days: [0, 6] },
          { ship_ids: [959], days: [0, 1, 2, 3] },
        ],
        costs: {
          ...A_GATA_BASE,
          p1: A_GATA_P1,
          p2: A_GATA_P2,
          conv: {
            devmats: 9,
            devmats_sli: 17,
            screws: 6,
            screws_sli: 8,
            equips: [{ id: 294, eq_count: 1 }], // 12.7cm連装砲A型改二
            consumable: [{ id: 75, eq_count: 1 }], // 新型砲熕兵装資材
          },
        },
      },
      {
        convert: null,
        helpers: [
          { ship_ids: [426], days: [0, 1, 2, 3, 4, 5, 6] },
          { ship_ids: [1035, 1040], days: [1, 2, 3] },
          { ship_ids: [420], days: [3, 4, 5, 6] },
        ],
        costs: { ...A_GATA_BASE, p1: A_GATA_P1, p2: A_GATA_P2 },
      },
    ],
  },
  {
    eqId: 21,
    label: '零式艦戦52型',
    fingerprint: '60#3/5:3/4#5/8:3/5#-#110.288.461.466|185.318.883.888;0#-#-#-#111.112.462.467',
    basis:
      'kcwiki 改修表对照（该页 2016 年后未再编辑，结构可信、名单不含 2016 后新增助手）' +
      '+ 用户机制通则一 · 2026-08-25；未游戏实测。' +
      '龍鳳可改修且可更新另有官方一手：KanColle_STAFF 推文 2024-05-29 ' +
      '(x.com/KanColle_STAFF/status/1795771922443374837)，包里龍鳳的归属与之一致，未改动。',
    pending: [
      '形态范围待核：官方文只写「龍鳳」；英文 wiki 称仅未改造可（未核）',
    ],
    improvement: [
      {
        // 翔鶴系 + 龍鳳系：两档上游本来就有，**缺的是更新消耗段**，照 kcwiki 补
        convert: { id_after: 60, lvl_after: 4 }, // 零式艦戦62型(爆戦) ★+4
        helpers: [
          { ship_ids: [110, 288, 461, 466], days: [2, 3, 4] }, // 翔鶴/改/改二/改二甲 · 火水木
          { ship_ids: [185, 318, 883, 888], days: [0, 5, 6] }, // 龍鳳/改/改二戊/改二 · 日金土
        ],
        costs: { ...REI52_BASE, p1: REI52_P1, p2: REI52_P2, conv: REI52_CONV },
      },
      {
        // 瑞鶴系：上游**整行零段位**，两档照 kcwiki 补；更新不可，conv 仍然不给
        convert: null,
        helpers: [{ ship_ids: [111, 112, 462, 467], days: [0, 1, 3] }], // 瑞鶴/改/改二/改二甲 · 日月水
        costs: { ...REI52_BASE, p1: REI52_P1, p2: REI52_P2 },
      },
    ],
  },
  {
    eqId: 66,
    label: '8cm高角砲',
    fingerprint: '220#4/5:2/3#5/7:2/4#-#139.307.663.668|503|504|509;0#-#-#-#137.305|138.306.662',
    basis:
      '官方推文 2026-03-13 前半改修素材变更（10cm連装高角砲→8cm高角砲）' +
      '+ wikiwiki 修订后数值 + kcwiki 对照（调整前旧表，仅结构/名单）' +
      '+ 用户机制通则一 · 2026-08-25；未游戏实测',
    pending: [
      '鈴谷航改二是否为 8cm高角砲 二号舰：kcwiki 有 / wikiwiki 无，待游戏实测',
      '推文菜单名归属待核：推文写【8cm高角砲+増設機銃】，主数据里没有这个名字——' +
        '最接近的是 220「8cm高角砲改+増設機銃」（差一个「改」），本件是 66「8cm高角砲」。' +
        '两件的前半素材现在都已是 8cm高角砲，包数据分不出推文指的是哪个菜单',
    ],
    improvement: [
      {
        // 矢矧行：两档上游本来就有（wikiwiki 修订后的新值），**缺的是更新消耗段**
        convert: { id_after: 220, lvl_after: 0 }, // 8cm高角砲改+増設機銃
        helpers: [
          { ship_ids: [509], days: [0, 5, 6] }, // 熊野航改二 · 日金土
          { ship_ids: [503], days: [2, 3, 4] }, // 鈴谷改二 · 火水木
          { ship_ids: [504], days: [1, 2, 3] }, // 熊野改二 · 月火水
          { ship_ids: [139, 307, 663, 668], days: [0, 1, 2] }, // 矢矧/改/改二/改二乙 · 日月火
        ],
        costs: { ...HACHI_BASE, p1: HACHI_P1, p2: HACHI_P2, conv: HACHI_CONV },
      },
      {
        // 能代/阿賀野行：上游**整行零段位**，两档按通则一补；更新不可，conv 仍然不给
        convert: null,
        helpers: [
          { ship_ids: [138, 306, 662], days: [0, 1] }, // 能代/改/改二 · 日月
          { ship_ids: [137, 305], days: [0, 4, 5, 6] }, // 阿賀野/改 · 日木金土
        ],
        costs: { ...HACHI_BASE, p1: HACHI_P1, p2: HACHI_P2 },
      },
    ],
  },
])

// ============================================================================
// 按机制通则补档
// ============================================================================
//
// 322 和 294 是整条抄回来的：它们各自有一手来源（游戏实测 / kcwiki 表），
// 抄一遍才说得清「这个数是从哪儿来的」。
//
// 下面这一批不一样。它们缺的档，**数值在同一件装备的别的行里就摆着**——
// 改修消耗由「装备 + 星级」决定，与二号舰无关（322 与 294 的 kcwiki 表都印证
// 同装备各行同档消耗一致；`ladderStageConflict` 每次装配还会再验一遍，
// 打架就整件弃权）。既然如此就不该手抄：抄一遍是凭空多一个抄错的机会，
// 而且上游哪天调了数字，手抄的那份会安静地过期。
//
// 所以这一批只列**哪几件适用通则**，缺的段在装配时从同装备他行现取。
//
// 谁算缺档：一个二号舰「能改哪些档」＝ 它露面的所有行的档位**并集**
// （通则的论证就是这个——界面按装备列行，一个二号舰在一件装备名下要么在要么不在）。
// 并集里缺 ★0-5 或 ★6-9 的，就给它所在的行补上。
// `convert` 与更新消耗一个字不碰：更新是独立判定，有自己的二号舰名单。

export interface EquipUpgradeLadderFill {
  eqId: number
  /** 装备名，只为读台账的人方便；判定一律用 eqId */
  label: string
  /** 记下这条校正时上游长什么样；对不上就跳过 */
  fingerprint: string
  /** 证据 */
  basis: string
  /** 记这一件当初是哪种形状被收进来的，方便下次复查 */
  note?: string
}

const TRUE_BY_RULE =
  '用户机制通则裁决（改修支持即全档 ★0→★max，仅更新有专属二号舰）+ 322/294 同因 · 2026-08-25'

/** 通则二那一批分开写：援引的是另一条，证据来路不该混成一句话。 */
const TRUE_BY_RULE_TWO = '用户机制通则第二条（能更新必能全档改修）· 2026-08-25'

/**
 * 适用机制通则的装备。**只对名单里的生效**，不是全库扫描——
 * 通则是用户裁的，可名单还是得一件一件过眼睛，免得哪天上游冒出一件形状不同的
 * 被算法顺手改了。
 *
 * 名单里本来就不缺档的（下面标「无缺」那几件）留着不删：它们被审过了，
 * 记下来免得下一轮又当嫌疑犯重审一遍。
 */
export const EQUIP_UPGRADE_LADDER_FILLS: readonly EquipUpgradeLadderFill[] = Object.freeze([
  // ---- 同一二号舰跨行档位互斥（322 那种两维压行的典型样子）----
  {
    eqId: 40,
    label: '25mm三連装機銃',
    fingerprint: '131#1/2:1/1#1/3:1/2#5/9:3/7#141|418|428|484.680.983|487|498;0#1/2:1/1#-#-#68.271.428',
    basis: TRUE_BY_RULE,
    note: '更新行（摩耶改二那行）档位齐；另一行的 摩耶 / 摩耶改 只剩 ★0-5，补 ★6-9',
  },
  {
    eqId: 47,
    label: '三式水中探信儀',
    fingerprint: '438#-#-#40/48:18/25#982;0#4/5:2/3#5/7:3/5#-#115.293.622.623.624|141|528.688.982',
    basis: TRUE_BY_RULE,
    note: '无缺：更新行那位（早波改二）在带档位行里已经全档露面',
  },
  {
    eqId: 119,
    label: '14cm連装砲',
    fingerprint: '310#-#2/4:2/3#14/48:8/14#356.465.622.623.624;0#2/2:1/2#-#-#115.293.622.623.624',
    basis: TRUE_BY_RULE,
    note: '两行互补：一行只有 ★6-9、一行只有 ★0-5，各补对方那段',
  },
  {
    eqId: 122,
    label: '10cm連装高角砲+高射装置',
    fingerprint: '533#-#-#10/16:7/10#968;0#6/7:3/4#5/8:4/7#-#330.421.963|346.422|357.423.968|532.537|533.538',
    basis: TRUE_BY_RULE,
    note: '无缺：更新行那位（初月改二）在带档位行里已经全档露面（那边日程不同，档位是齐的）',
  },
  {
    eqId: 128,
    label: '試製51cm連装砲',
    fingerprint: '281#-#-#26/51:15/18#546;0#7/9:5/7#10/15:7/10#-#136.911.916|148.546',
    basis: TRUE_BY_RULE,
    note: '无缺：更新行那位（武蔵改二）在带档位行里已经全档露面',
  },
  {
    eqId: 237,
    label: '瑞雲(六三四空/熟練)',
    fingerprint: '322#-#-#24/40:9/16#554;0#8/10:6/7#10/16:7/9#-#88.554',
    basis: TRUE_BY_RULE,
    note: '无缺：更新行那位（日向改二）在带档位行里已经全档露面',
  },
  {
    eqId: 379,
    label: '12.7cm単装高角砲改二',
    fingerprint: '572#-#6/9:4/5#12/24:7/14#702|997.1035.1040;0#4/5:3/4#6/9:4/5#-#641.702',
    basis: TRUE_BY_RULE,
    note: '更新行的 杉改 / 吹雪改三 / 吹雪改三護(六式) 只剩 ★6-9，补 ★0-5（松改在另一行已全档）',
  },
  // ---- 与 322 同形：整段档位落在别的二号舰名下 ----
  {
    eqId: 5,
    label: '15.5cm三連装砲',
    fingerprint: '235#-#2/3:2/4#8/12:4/8#183|321;0#2/2:2/3#-#-#70.73.501.506',
    basis: TRUE_BY_RULE,
    note: '两行互补，各补对方缺的那段',
  },
  {
    eqId: 60,
    label: '零式艦戦62型(爆戦)',
    fingerprint: '219#4/6:3/5#-#-#508;0#-#5/9:4/6#-#110.288.461.466|92.284.408',
    basis: TRUE_BY_RULE,
    note: '两行互补，各补对方缺的那段',
  },
  {
    eqId: 276,
    label: '46cm三連装砲改',
    fingerprint: '128#8/9:5/6#9/16:8/9#-#136.911.916;0#-#9/16:8/9#-#148.546',
    basis: TRUE_BY_RULE,
    note: '一行只剩 ★6-9，补 ★0-5',
  },
  {
    eqId: 470,
    label: '12.7cm連装砲C型改三',
    fingerprint: '529#5/7:5/5#8/12:6/8#-#498|961|975;0#-#8/12:6/8#-#670|915|951',
    basis: TRUE_BY_RULE,
    note: '一行只剩 ★6-9，补 ★0-5',
  },
  // ---- 纯更新行：那几位二号舰只在更新行露面，一个改修档都没有 ----
  // 按通则二（能更新必能全档改修）补 ★0-5 + ★6-9。
  {
    eqId: 94,
    label: '天山一二型(友永隊)',
    fingerprint: '570#-#-#50/60:18/27#1031;0#8/9:6/7#10/15:7/9#-#196',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那位只在更新行露面，补全两档',
  },
  {
    eqId: 103,
    label: '試製35.6cm三連装砲',
    fingerprint: '328#-#-#35/40:12/15#150.592;289#-#-#7/10:6/9#151.593.954;0#4/6:3/4#6/9:4/7#-#149.591|411|412',
    basis: TRUE_BY_RULE_TWO,
    note: '两个更新行的二号舰都只在更新行露面，两行各补全两档',
  },
  {
    eqId: 106,
    label: '13号対空電探改',
    fingerprint: '450#-#-#9/13:6/9#716|745.1034|997;0#5/7:3/4#7/9:4/8#-#20.228.656|320|419',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那几位只在更新行露面，补全两档',
  },
  {
    eqId: 139,
    label: '15.2cm連装砲改',
    fingerprint: '407#-#-#8/10:5/10#138.306.662;0#3/4:2/3#4/5:3/5#-#139.307.663.668|140.314',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那几位只在更新行露面，补全两档',
  },
  {
    eqId: 167,
    label: '特二式内火艇',
    fingerprint: '525#-#-#41/68:9/17#971.976;0#5/8:3/4#8/12:4/6#-#127.399|128.400|155.403',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那几位只在更新行露面，补全两档',
  },
  {
    eqId: 251,
    label: 'Spitfire Mk.V',
    fingerprint: '252#-#-#12/24:7/9#393.515;0#6/7:3/4#8/10:4/6#-#571.576',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那几位只在更新行露面，补全两档',
  },
  {
    eqId: 315,
    label: 'SG レーダー(初期型)',
    fingerprint: '456#-#-#32/39:9/13#726.737;0#17/23:6/6#24/33:7/8#-#628|629|918',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那几位只在更新行露面，补全两档',
  },
  {
    eqId: 367,
    label: 'Swordfish(水上機型)',
    fingerprint: '370#-#-#12/18:6/12#364.439;0#4/5:2/2#5/9:3/5#-#162.499.500|372.491|574.579.630',
    basis: TRUE_BY_RULE_TWO,
    note: '更新行那几位只在更新行露面，补全两档',
  },
])

/**
 * 还没裁的「整行零段位」嫌疑：那一行既没有 convert，三档也一个都没有，光挂着几位
 * 二号舰。与「缺一两段」不是一回事，套通则补等于凭空造出一整行改修，所以一律另案。
 *
 * **2026-08-25 起是空的**——21（零式艦戦52型）与 66（8cm高角砲）都拿到了把那一整行
 * 数字给全的表，逐件结案进了上面的台账。
 *
 * 空不等于这条规矩作废：**下次再遇到零段位行，仍旧先进这份名单等材料**。
 * 21 和 66 能结案是因为有表，不是因为「零段位就该补」——没有材料就照上游显示，
 * 列进报告等人肉裁。护栏钉着这一点：名单空了，当初那两件必须在台账里查得到，
 * 免得哪天有人把名单一删了事、看上去也是「清零」。
 */
export const PENDING_EQUIP_UPGRADE_SUSPECTS: readonly number[] = Object.freeze([])

/**
 * 曾经压在待裁名单里、后来逐件结案的。只为让「名单空了」这件事可核：
 * 空名单 + 这几件都在台账里 ＝ 真结案；空名单 + 查不到 ＝ 有人把名单删了。
 */
export const RESOLVED_LADDER_SUSPECTS: readonly number[] = Object.freeze([21, 66])

export type EquipUpgradeSkipReason = 'no-equip' | 'fingerprint' | 'stage-conflict'

export interface EquipUpgradeCorrectionReport {
  applied: number[]
  skipped: { eqId: number; reason: EquipUpgradeSkipReason }[]
  /** 按通则补了档的 */
  filled: number[]
  /** 名单里、审过、本来就不缺的 */
  fillUnchanged: number[]
}

type LadderStage = 'p1' | 'p2'
const LADDER_STAGES: readonly LadderStage[] = ['p1', 'p2']

const rowHelperShips = (row: any): number[] =>
  ((row?.helpers ?? []) as any[])
    .flatMap((one: any) => (one?.ship_ids ?? []) as any[])
    .map(Number)
    .filter((id) => Number.isFinite(id))

/** 一档消耗的指纹，只用来回答「同装备各行的这一档是不是同一个数」。 */
const stageSignature = (stage: ImproveCosts['p1']): string =>
  [
    stage?.devmats ?? '',
    stage?.devmats_sli ?? '',
    stage?.screws ?? '',
    stage?.screws_sli ?? '',
    (stage?.equips ?? []).map((one) => `${one.id}x${one.eq_count}`).join(','),
    (stage?.consumable ?? []).map((one) => `${one.id}x${one.eq_count}`).join(','),
  ].join(':')

export interface EquipUpgradeLadderFillResult {
  /** 补过的 improvement；本来就不缺档时是 null */
  improvement: EquipUpgradeRowShape[] | null
  /** 同装备同档消耗打架——「消耗与二号舰无关」在这件上不成立，整件弃权 */
  conflict: boolean
}

/**
 * 按机制通则把缺的改修档补齐（判据见文件头「机制通则」那一段）。
 *
 * 一个二号舰「能改哪些档」＝ 它露面的所有行的档位**并集**；并集里缺哪一档，
 * 就给它所在的行补上，值取同装备他行的同一档。
 *
 * 三种情况不补：
 *  - 这件装备整件就没有那一档（比如通篇只有 ★6-9）——那是真没有，不是缺；
 *  - 同装备各行的同一档消耗对不上——通则的前提在这件上不成立，`conflict` 弃权；
 *  - 本来就不缺——返回 null，让调用方知道「审过，没动」。
 *
 * `convert` 与更新消耗一个字不碰：更新是 ★max 时的独立判定，有自己的二号舰名单。
 */
export const fillEquipUpgradeLadders = (
  improvement: readonly any[] | null | undefined,
): EquipUpgradeLadderFillResult => {
  const rows = [...(improvement ?? [])]
  const donor: Record<LadderStage, ImproveCosts['p1'] | null> = { p1: null, p2: null }
  const covered: Record<LadderStage, Set<number>> = { p1: new Set(), p2: new Set() }

  for (const stage of LADDER_STAGES) {
    let mark: string | null = null
    for (const row of rows) {
      const cost = row?.costs?.[stage]
      if (!cost) continue
      const here = stageSignature(cost)
      if (mark === null) {
        mark = here
        donor[stage] = cost
      } else if (here !== mark) {
        return { improvement: null, conflict: true }
      }
      for (const id of rowHelperShips(row)) covered[stage].add(id)
    }
  }

  let touched = false
  const next = rows.map((row) => {
    const ships = rowHelperShips(row)
    const add: Partial<Record<LadderStage, ImproveCosts['p1']>> = {}
    for (const stage of LADDER_STAGES) {
      if (row?.costs?.[stage]) continue
      const source = donor[stage]
      if (!source) continue
      if (ships.some((id) => !covered[stage].has(id))) add[stage] = { ...source }
    }
    if (!Object.keys(add).length) return row
    touched = true
    return { ...row, costs: { ...(row?.costs ?? {}), ...add } }
  })

  return { improvement: touched ? (next as EquipUpgradeRowShape[]) : null, conflict: false }
}

/**
 * 把台账叠加到上游数据上。**返回新数组，不就地改**（包对象可能被别处共享）。
 *
 * 两层：先把裁过的那几件整条换掉，再给适用机制通则的那一批补缺档。
 * 两份名单不相交，谁先谁后都一样，写成先后只为读起来有个次序。
 *
 * 没进这两份名单的装备一个字不动。
 */
export const applyEquipUpgradeCorrections = <T extends { eq_id?: number; improvement?: unknown }>(
  rows: readonly T[] | null | undefined,
): { rows: T[]; report: EquipUpgradeCorrectionReport } => {
  const list = [...(rows ?? [])]
  const report: EquipUpgradeCorrectionReport = {
    applied: [],
    skipped: [],
    filled: [],
    fillUnchanged: [],
  }
  for (const correction of EQUIP_UPGRADE_CORRECTIONS) {
    const index = list.findIndex((row) => Number(row?.eq_id) === correction.eqId)
    if (index < 0) {
      report.skipped.push({ eqId: correction.eqId, reason: 'no-equip' })
      continue
    }
    const current = list[index]!
    if (equipUpgradeFingerprint(current.improvement as any[]) !== correction.fingerprint) {
      // 上游变样了：**不覆盖**。拿过期的校正去改一个已经不同的东西，错得看不见
      report.skipped.push({ eqId: correction.eqId, reason: 'fingerprint' })
      continue
    }
    list[index] = { ...current, improvement: correction.improvement.map((row) => ({ ...row })) } as T
    report.applied.push(correction.eqId)
  }
  for (const fill of EQUIP_UPGRADE_LADDER_FILLS) {
    const index = list.findIndex((row) => Number(row?.eq_id) === fill.eqId)
    if (index < 0) {
      report.skipped.push({ eqId: fill.eqId, reason: 'no-equip' })
      continue
    }
    const current = list[index]!
    if (equipUpgradeFingerprint(current.improvement as any[]) !== fill.fingerprint) {
      // 上游变样了：**不补**。形状都换了，通则套上去补出来的东西没人能说清
      report.skipped.push({ eqId: fill.eqId, reason: 'fingerprint' })
      continue
    }
    const filled = fillEquipUpgradeLadders(current.improvement as any[])
    if (filled.conflict) {
      // 同装备同档消耗打架 → 「消耗与二号舰无关」在这件上不成立，不猜
      report.skipped.push({ eqId: fill.eqId, reason: 'stage-conflict' })
      continue
    }
    if (!filled.improvement) {
      report.fillUnchanged.push(fill.eqId)
      continue
    }
    list[index] = { ...current, improvement: filled.improvement } as T
    report.filled.push(fill.eqId)
  }
  return { rows: list, report }
}
