// 活动特效倍卡的**国籍例外台账**（逐期）。
//
// ---- 为什么必须有这一层 ----
//
// 倍卡表里整段整段地按国籍给（「苏」×1.9285 这种），而游戏**不下发国籍字段**。
// 我们和 EO 一样按 `api_sort_id` 的编号段判（`shared/ship-nationality.ts`）——
// 那是 C2 给图鉴排序用的编码，**跨国改造形态不跟着走**：
//
//   · Верный（147）的 sort_id 是 14226，紧挨着 響改 14222，落在日本段；
//     而策划的特効组历来把她括进苏联组。号段规则下她一格苏系倍卡都吃不到。
//   · UIT-25（539）sort_id 30731 在德国段、UIT-24（939）30721 同样，
//     但上游明写这两艘算**意大利舰**——号段不但漏给，还会**给错一个国籍**。
//   · 伊504（530）22321、伊503（940）22311、U-511改（334）23012 都在日本段，
//     上游分别算意大利舰、意大利舰、德国舰。
//
// 号段仍旧是缺省规则（真外国舰零特判，一条例外都不用写）。这里只收
// **上游逐行点名过的那几艘**，匹配顺序是「先查例外，再落号段」。
//
// 每条里的 `sortId` 是**实测值**，取自本仓库上一级的 api_start2 样本（`../s2.json`，
// 1751 条 api_mst_ship），护栏 `test/event-bonus-nationality.test.mjs` 拿它逐条复核：
// C2 哪天给某艘舰重编号，`sortId`/`bySortId` 对不上就当场红——那正是「这条例外
// 还成不成立」变了的时刻。
//
// ---- 为什么放 shared 而不是随包 ----
//
// ① 随包的 `event-bonus` 是 kcwiki 活动页的 CC 底表，我们不往上游包文件里塞
//    自己的裁决（同 `fit-bonus-corrections.ts` 那条许可纪律：不改包文件，
//    在加载时叠一层第一方台账）；
// ② 例外表在 wikiwiki 的**活动图页**上，与倍卡数值同源但不同站，抓取器不解析它；
// ③ 「先例外后号段」是**运行时判据**，判据的单一出处一直在 shared，
//    渲染层与将来可能的主进程用法共用同一份。
//
// ---- 自失效（逐期）----
//
// 每条都钉着**资料包当时指着的活动页名**（`scripts/lode-sources.json` 的
// event-bonus 项，`url` 里的 `page=`）。下一期活动换页名时，台账对不上就整段
// **不生效**，退回纯号段——而不是拿上一期的名单去套这一期的特効组。
// `test/event-bonus-nationality.test.mjs` 另有一道护栏：台账的页名必须与
// lode-sources.json 现行页名一致，换期时忘了更新台账会当场红。

/** 一条国籍裁决。 */
export interface EventNationalityRuling {
  /** 这一期活动（人读；判定不看它） */
  event: string
  /** 判定用的期号：资料包 `url` 里的 kcwiki 页名。对不上就整条不生效 */
  packPage: string
  mstId: number
  /** master 原名（给人读的锚，不参与判定） */
  name: string
  /**
   * 上游明写的国籍，写成**倍卡表列名的口径**（'苏' '德' '意' '日' '澳'…）——
   * 不是本仓库国籍表的 short（那边俄罗斯记「俄」）。null = 明写「不属于任何国籍组」。
   */
  nation: string | null
  /** 该形态的 api_sort_id（号段判定的输入，落账才说得清这条是纠错还是确认） */
  sortId: number
  /** 号段规则本来会给出的键（同样是倍卡表列名口径）；null = 号段判不出 */
  bySortId: string | null
  /** 与号段规则的关系：'override' 改判、'confirm' 只是确认（写下来才知道哪些是白记的） */
  kind: 'override' | 'confirm'
  /** 上游逐字 */
  jp: string
  /** 上游是哪一页 */
  source: string
  /** 为什么这么裁 */
  why: string
  decidedAt: string
}

/**
 * 2026 夏活的裁决全集。
 *
 * 出处：wikiwiki.jp/kancolle 活动图页 **E4 与 E5 各有一张同样的**
 * 「国籍に注意が必要な艦娘」表（挂在各自的「艦娘特効」表末尾），逐行照抄。
 * 两页互证，不是孤证。
 *
 * **穷举核对过**（2026-08-22，拿 api_mst_ship 一手数据跑改造并查集）：上游点名的
 * 六个族在游戏里的形态数与表上列的**逐个对得上**，没有漏掉任何一个改造形态——
 *   響族 響/響改/Верный（3）· U-511族 U-511/U-511改/呂500（3）·
 *   Luigi Torelli族 Luigi Torelli/同改/UIT-25/伊504（4）·
 *   C.Cappellini族 C.Cappellini/同改/UIT-24/伊503（4）· Perth族 Perth/Perth改（2）·
 *   神鷹族 神鷹/神鷹改/神鷹改二（3）。
 * 丹陽（651，sort_id 16084，雪風族）**不在**这张表上——所以她照号段落「日」，
 * 而本期 E4/E5 的国籍列里根本没有「日」，等于一格国籍倍卡都不吃。这是查证结果，
 * 不是「没找到」：那张表逐行读完了，她不在上面。
 */
export const EVENT_NATIONALITY_RULINGS: readonly EventNationalityRuling[] = Object.freeze([
  // ---- 改判（号段判错，这几条真的会改变预测出来的伤害）----
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 147,
    name: 'Верный',
    nation: '苏',
    sortId: 14226,
    bySortId: '日',
    kind: 'override',
    jp: '国籍に注意が必要な艦娘：響,響改 → 日本艦／Верный → ロシア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「艦娘特効」表末尾「国籍に注意が必要な艦娘」小表（两页同表，' +
      'E4 页自报「08/13確認」、E5 页自报「08/02確認」；2026-08-22 只读取原站 HTML 逐行核对）',
    why:
      'sort_id 14226 紧挨 響改 14222，落在日本段——号段规则给「日」，而本期 E4/E5 的国籍列里没有「日」，' +
      '于是她一格国籍倍卡都吃不到。上游把她明写成 ロシア艦。本期这一条**当场影响预测**：' +
      'E4 全图苏 ×1.06；E5 全图苏 ×1.06、T/V/X/Y1/Y2/Z ×1.45、ZZ 点（第四 Boss）×1.9285。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 334,
    name: 'U-511改',
    nation: '德',
    sortId: 23012,
    bySortId: '日',
    kind: 'override',
    jp: '国籍に注意が必要な艦娘：U-511,U-511改 → ドイツ艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why:
      '同一族里 U-511（431）sort_id 30711 在德国段、号段判得对，改造后的 U-511改（334）sort_id 却是 23012（日本段的呂/伊潜编号块），' +
      '号段就把她判成「日」了。上游把 U-511 与 U-511改 **并列写在同一格**，同判 ドイツ艦。' +
      '本期影响：E4 德 ×1.08；E5 德 ×1.18 全图 + 各点位 + ZZ ×1.475。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 539,
    name: 'UIT-25',
    nation: '意',
    sortId: 30731,
    bySortId: '德',
    kind: 'override',
    jp: '国籍に注意が必要な艦娘：Luigi Torelli,Luigi Torelli改,UIT-25,伊504 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why:
      '号段这里不是漏给，是**给错一个国籍**：sort_id 30731 落在德国段，号段判「德」，' +
      '而上游把整个 Luigi Torelli 族（含 UIT-25、伊504）明写成 イタリア艦。' +
      '本期 E4 意 ×1.19 > 德 ×1.08，E5 反过来 德 ×1.18 > 意 ×1.04——两边都会算错，方向还相反。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 530,
    name: '伊504',
    nation: '意',
    sortId: 22321,
    bySortId: '日',
    kind: 'override',
    jp: '国籍に注意が必要な艦娘：Luigi Torelli,Luigi Torelli改,UIT-25,伊504 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: 'sort_id 22321 在日本段（伊号潜编号块），号段判「日」＝无倍卡；上游明写 イタリア艦。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 939,
    name: 'UIT-24',
    nation: '意',
    sortId: 30721,
    bySortId: '德',
    kind: 'override',
    jp: '国籍に注意が必要な艦娘：C.Cappellini,C.Cappellini改,UIT-24,伊503 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '同 UIT-25：sort_id 30721 在德国段，号段判「德」；上游把整个 C.Cappellini 族明写成 イタリア艦。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 940,
    name: '伊503',
    nation: '意',
    sortId: 22311,
    bySortId: '日',
    kind: 'override',
    jp: '国籍に注意が必要な艦娘：C.Cappellini,C.Cappellini改,UIT-24,伊503 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '同 伊504：sort_id 22311 在日本段，号段判「日」＝无倍卡；上游明写 イタリア艦。',
    decidedAt: '2026-08-22',
  },

  // ---- 确认（号段本来就判对了）----
  //
  // 白记的这几条**不是冗余**：上游点名了它们，我们逐条核过并记下「号段这次是对的」。
  // 没有这几行，下一个人还得把整张表重查一遍才知道哪些查过了。
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 431,
    name: 'U-511',
    nation: '德',
    sortId: 30711,
    bySortId: '德',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：U-511,U-511改 → ドイツ艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: 'sort_id 30711 在德国段，号段判「德」，与上游一致。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 436,
    name: '呂500',
    nation: '日',
    sortId: 23021,
    bySortId: '日',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：呂500 → 日本艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why:
      '同族的 U-511 是德国舰、U-511改也是，改到呂500 就**变回日本舰**——上游把这三格分开写正是为了说这件事。' +
      '号段（23021，日本段）恰好判对。本期没有「日」这一列，所以她不吃任何国籍倍卡。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 535,
    name: 'Luigi Torelli',
    nation: '意',
    sortId: 31711,
    bySortId: '意',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：Luigi Torelli,Luigi Torelli改,UIT-25,伊504 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: 'sort_id 31711 在意大利段，号段判「意」，与上游一致。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 605,
    name: 'Luigi Torelli改',
    nation: '意',
    sortId: 31712,
    bySortId: '意',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：Luigi Torelli,Luigi Torelli改,UIT-25,伊504 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: 'sort_id 31712 在意大利段，号段判「意」，与上游一致。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 934,
    name: 'C.Cappellini',
    nation: '意',
    sortId: 31701,
    bySortId: '意',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：C.Cappellini,C.Cappellini改,UIT-24,伊503 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: 'sort_id 31701 在意大利段，号段判「意」，与上游一致。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 731,
    name: 'C.Cappellini改',
    nation: '意',
    sortId: 31702,
    bySortId: '意',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：C.Cappellini,C.Cappellini改,UIT-24,伊503 → イタリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: 'sort_id 31702 在意大利段，号段判「意」，与上游一致。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 35,
    name: '響',
    nation: '日',
    sortId: 14221,
    bySortId: '日',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：響,響改 → 日本艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '上游特意点明「改造成 Верный 之前仍是日本舰」。号段（14221，日本段）判对。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 235,
    name: '響改',
    nation: '日',
    sortId: 14222,
    bySortId: '日',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：響,響改 → 日本艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '同 響：号段（14222，日本段）判对。改造成 Верный 才换国籍。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 613,
    name: 'Perth',
    nation: '澳',
    sortId: 38411,
    bySortId: '澳',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：Perth,Perth改 → オーストラリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why:
      '上游点她是因为她挂英式舰名容易被当英舰。号段（38411，澳大利亚段）判「澳」，与上游一致——' +
      '本期没有「澳」这一列，所以她也不吃「英」的倍卡，正是上游要提醒的那件事。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 618,
    name: 'Perth改',
    nation: '澳',
    sortId: 38412,
    bySortId: '澳',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：Perth,Perth改 → オーストラリア艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '同 Perth：号段（38412，澳大利亚段）判对。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 534,
    name: '神鷹',
    nation: '日',
    sortId: 5041,
    bySortId: '日',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：神鷹,神鷹改,神鷹改二 → 日本艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '前身是德国客轮 Scharnhorst，上游点名说她算日本舰。号段（5041，日本段）判对。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 381,
    name: '神鷹改',
    nation: '日',
    sortId: 5042,
    bySortId: '日',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：神鷹,神鷹改,神鷹改二 → 日本艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '同 神鷹：号段（5042，日本段）判对。',
    decidedAt: '2026-08-22',
  },
  {
    event: '2026 夏活（前段 反撃！第三十一戦隊の戦い／后段 L\'Élan de la Flotte Française）',
    packPage: '2026年夏季活动',
    mstId: 536,
    name: '神鷹改二',
    nation: '日',
    sortId: 5046,
    bySortId: '日',
    kind: 'confirm',
    jp: '国籍に注意が必要な艦娘：神鷹,神鷹改,神鷹改二 → 日本艦',
    source:
      'wikiwiki.jp/kancolle「反撃！第三十一戦隊の戦い/E4」与同「/E5」的「国籍に注意が必要な艦娘」小表（2026-08-22 只读核对）',
    why: '同 神鷹：号段（5046，日本段）判对。',
    decidedAt: '2026-08-22',
  },
])

/**
 * 资料包 `sourceUrl` → kcwiki 活动页名（台账的期号）。
 *
 * 取的是 `page=` 参数（`fetch-lodes` 就是拿它抓的那一页）。取不出来返回 null——
 * 那种情况下台账**一条都不生效**，退回纯号段，而不是猜一个期号。
 */
export const eventBonusPackPageOf = (sourceUrl: string | null | undefined): string | null => {
  if (!sourceUrl) return null
  const matched = /[?&]page=([^&]+)/.exec(sourceUrl)
  if (!matched) return null
  try {
    return decodeURIComponent(matched[1])
  } catch (_error) {
    // 上游 URL 里出现坏转义时不猜，按「没有期号」处理（台账整段不生效）
    return null
  }
}

// 索引按期号分桶，惰性建一次。台账是常量，不会变。
let rulingIndex: Map<string, Map<number, EventNationalityRuling>> | null = null

const indexOf = (): Map<string, Map<number, EventNationalityRuling>> => {
  if (!rulingIndex) {
    rulingIndex = new Map()
    for (const ruling of EVENT_NATIONALITY_RULINGS) {
      let bucket = rulingIndex.get(ruling.packPage)
      if (!bucket) {
        bucket = new Map()
        rulingIndex.set(ruling.packPage, bucket)
      }
      bucket.set(ruling.mstId, ruling)
    }
  }
  return rulingIndex
}

/**
 * 查这一期这艘舰有没有被上游点过名。
 *
 * `packPage` 与台账对不上（换期了、或资料包 URL 取不出页名）就返回 null，
 * 调用方照号段走——**逐期台账绝不跨期复用**。
 */
export const eventNationalityRulingFor = (
  mstId: number,
  packPage: string | null,
): EventNationalityRuling | null =>
  (packPage ? indexOf().get(packPage)?.get(mstId) : undefined) ?? null

/** 这一期台账里有几条（0 = 台账对不上这一期，全走号段）。 */
export const eventNationalityRulingCount = (packPage: string | null): number =>
  packPage ? (indexOf().get(packPage)?.size ?? 0) : 0
