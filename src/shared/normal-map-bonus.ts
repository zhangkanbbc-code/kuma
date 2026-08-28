// 常规海图的**特效舰台账**（第一方，手工维护）。
//
// 活动图的特效倍卡有一整条现成的链路（assets/lodes/event-bonus.json → 镝的战斗预测，
// map-intel 的 operations.specialShips → 铎的特效舰匹配）；常规图这边一直是空的——
// 玩家在鉴里翻开 7-4，看不到「海防舰在这张图打得更疼」这件事，只能去日文站上查。
//
// ---- 为什么是台账而不是矿脉 ----
//
// 就两张图、十来条数，且**不需要被玩家目录覆盖、不参与 map-intel 的装配管线**，
// 走 assets/lodes 那套（注册 id、schema 校验、健康度追踪、抓取器）全是空转。
// 与 fit-bonus-supplement.ts 同族：第一方转写、编译进代码、逐条带核对日期与页名。
// 运行时零联网——数是维护者只读核对后手工转写的，仓库里没有对这两页的抓取脚本。
//
// ---- 边界：只展示，不进任何计算 ----
//
// 这一层**不接进 shared/combat-forecast.ts**。活动倍卡进伤害估算是因为那条链路
// 有点位上下文、有难度分层、有 certain 标记；常规图这几条只是一张说明表，
// 拿它去乘伤害等于凭一张日文页的社区实测值给玩家一个假的精确数。
// 鉴的海域详情页照原样列出来，玩家自己心里有数即可。
//
// ---- 收录范围 ----
//
// 常规图里有特效的只有 7-4 与 7-5 两张（2026-08-25 用户查定）。**没有数据的图零痕迹**：
// normalMapBonusOf 返回 null，渲染方整节不出，不挂「暂无资料」的空牌子——
// 常规图绝大多数本来就没有特效，给每张图挂一块空牌子只会让人以为是资料缺了。
//
// ---- 许可与印证 ----
//
// 与 fit-bonus-supplement 同理：**数值本身是游戏行为事实**（「海防舰在 7-4 的 P 点吃 ×1.33」），
// 逐条带依据转写进第一方台账合法；不合法的是把 wikiwiki 的页面/表格拼进包。
// 署名集中在 NOTICE.md 的「艦これ攻略 Wiki — 第一方台账」一节，条目内逐条不署名，
// 只带页名与该页的 Last-modified。
//
// **这个文件不 import 任何东西**，好让 node --test 直接读它、渲染方也能直接 import。

/** 一格补正：这几个点位吃这个倍率。上游写「-」的格不落条目。 */
export interface MapBonusCell {
  /** 适用点位，原页表头的字母，按原序 */
  nodes: readonly string[]
  /** 攻击力倍率，如 1.25 */
  value: number
}

/** 补正对象是一整个舰种（7-4 那种）。 */
export interface MapBonusStypeSubject {
  kind: 'stype'
  /** api_mst_stype 的 id：1 = 海防艦，21 = 練習巡洋艦 */
  stypeId: number
  /** 舰种日文原名，主数据没到手时的兜底 */
  ja: string
}

/** 补正对象是点名到具体舰娘（7-5 那种史实补正）。 */
export interface MapBonusShipsSubject {
  kind: 'ships'
  /** 上游给这一组起的名义（日文原文） */
  ja: string
  /** 同一名义的中文说法，给玩家读 */
  zh: string
  /**
   * 点名到的舰。`id` 是**改造链最浅那一形态**的 mstId，`ja` 是它在主数据里的名字——
   * 上游列的是「哪条船参加过这场海战」，改造形态一律同享，所以只钉链首。
   */
  ships: readonly { id: number; ja: string }[]
}

export type MapBonusSubject = MapBonusStypeSubject | MapBonusShipsSubject

export interface MapBonusRow {
  subject: MapBonusSubject
  cells: readonly MapBonusCell[]
}

export interface NormalMapBonus {
  /** 海图编号，如 '7-4' */
  code: string
  /** 上游确认的 Boss 点位；渲染方拿它给点位加标记 */
  bossNodes: readonly string[]
  rows: readonly MapBonusRow[]
  /** 日文出处是哪一页 */
  source: string
  /** 来源页最后编辑日期（wikiwiki 的 Last-modified） */
  sourceUpdatedAt: string
  /** 维护者只读核对的日期 */
  checkedAt: string
  /**
   * 上游自述的印证（脚注原文的转述）。**维护者字段，一个字都不上屏**——
   * 与矿脉包的 `meta.maintainerNote` 同一口径（2026-08-24 用户定的分界：
   * 玩家字段只留一两句人话，换源考古与对账史留在台账里）。
   */
  evidence: string
  /** 取到票却没转写进来的东西，逐条写明为什么。同样是维护者字段，不上屏 */
  deferred?: readonly string[]
  /** 玩家会问的那一句，写人话，进「口径」悬停。没有就不挂那个标 */
  playerNote?: string
}

export const NORMAL_MAP_BONUSES: readonly NormalMapBonus[] = Object.freeze([
  {
    code: '7-4',
    bossNodes: ['P'],
    rows: [
      {
        subject: { kind: 'stype', stypeId: 1, ja: '海防艦' },
        cells: [
          { nodes: ['J', 'L'], value: 1.25 },
          { nodes: ['P'], value: 1.33 },
        ],
      },
      {
        subject: { kind: 'stype', stypeId: 21, ja: '練習巡洋艦' },
        cells: [
          { nodes: ['J', 'L'], value: 1.15 },
          { nodes: ['P'], value: 1.23 },
        ],
      },
    ],
    source: 'wikiwiki.jp/kancolle「南西海域/7-4」',
    sourceUpdatedAt: '2026-07-18',
    checkedAt: '2026-08-25',
    evidence:
      '页面正文「J,L,P(ボス)マスにおいて海防艦と練習巡洋艦に対する特効が確認されている」，' +
      '四个数各挂一条脚注，指向 2022-02 与 2022-09 的实测推文与页内书き込み。',
  },
  {
    code: '7-5',
    // K = 第一血条 Boss，Q = 第二血条 Boss（陆上型），T = 第三血条 Boss。
    bossNodes: ['K', 'Q', 'T'],
    rows: [
      {
        subject: {
          kind: 'ships',
          ja: 'スラバヤ沖海戦',
          zh: '泗水海战',
          ships: [
            { id: 64, ja: '足柄' },
            { id: 62, ja: '妙高' },
            { id: 63, ja: '那智' },
            { id: 65, ja: '羽黒' },
            { id: 94, ja: '漣' },
            { id: 16, ja: '潮' },
            { id: 15, ja: '曙' },
            { id: 457, ja: '山風' },
            { id: 459, ja: '江風' },
            { id: 36, ja: '雷' },
            { id: 37, ja: '電' },
            { id: 55, ja: '神通' },
            { id: 190, ja: '初風' },
            { id: 20, ja: '雪風' },
            { id: 181, ja: '天津風' },
            { id: 186, ja: '時津風' },
            { id: 56, ja: '那珂' },
            { id: 44, ja: '村雨' },
            { id: 45, ja: '夕立' },
            { id: 405, ja: '春雨' },
            { id: 46, ja: '五月雨' },
            { id: 413, ja: '朝雲' },
            { id: 583, ja: '峯雲' },
            { id: 76, ja: '龍驤' },
            { id: 474, ja: '松風' },
            { id: 102, ja: '千歳' },
            { id: 451, ja: '瑞穂' },
            { id: 604, ja: 'De Ruyter' },
          ],
        },
        cells: [
          { nodes: ['B', 'C', 'D', 'E', 'J'], value: 1.08 },
          { nodes: ['G', 'K', 'L', 'M'], value: 1.13 },
          { nodes: ['Q'], value: 1.14 },
        ],
      },
      {
        subject: {
          kind: 'ships',
          ja: 'バタビア沖海戦',
          zh: '巴达维亚海战',
          ships: [
            { id: 53, ja: '名取' },
            { id: 472, ja: '朝風' },
            { id: 473, ja: '春風' },
            { id: 475, ja: '旗風' },
            { id: 9, ja: '吹雪' },
            { id: 10, ja: '白雪' },
            { id: 32, ja: '初雪' },
            { id: 33, ja: '叢雲' },
            { id: 28, ja: '皐月' },
            { id: 29, ja: '文月' },
            { id: 23, ja: '由良' },
            { id: 34, ja: '暁' },
            { id: 35, ja: '響' },
            { id: 481, ja: '水無月' },
            { id: 6, ja: '長月' },
            { id: 70, ja: '最上' },
            { id: 120, ja: '三隈' },
            { id: 14, ja: '敷波' },
            { id: 621, ja: '神州丸' },
            { id: 161, ja: 'あきつ丸' },
          ],
        },
        cells: [
          { nodes: ['B', 'C', 'D', 'E', 'J'], value: 1.06 },
          { nodes: ['N', 'R', 'T'], value: 1.15 },
        ],
      },
      {
        subject: {
          kind: 'ships',
          ja: '上記両海戦',
          zh: '两场海战都参加',
          ships: [
            { id: 595, ja: 'Houston' },
            { id: 613, ja: 'Perth' },
          ],
        },
        cells: [
          // 道中那一格上游标了浮层「x1.08x1.06」——两场的补正相乘（1.08×1.06≈1.1448），
          // 页面上取整写作 x1.14。这里照页面显示值落，不自己算第二个数。
          { nodes: ['B', 'C', 'D', 'E', 'J'], value: 1.14 },
          { nodes: ['G', 'K', 'L', 'M'], value: 1.13 },
          { nodes: ['Q'], value: 1.14 },
          { nodes: ['N', 'R', 'T'], value: 1.15 },
        ],
      },
    ],
    source: 'wikiwiki.jp/kancolle「南西海域/7-5」',
    sourceUpdatedAt: '2026-07-04',
    checkedAt: '2026-08-25',
    evidence:
      '页面「特効が確認されている艦娘」一节的史実補正表，两条脚注写「23/01/21確認」与' +
      '「enWiki 23/2/18確認」。同页另有一张按血条切的「艦種別」表，逐条与本表对得上' +
      '（第 1・2 血条 = 泗水一组，第 3 血条 = 巴达维亚一组，Houston/Perth 两侧都在）。',
    playerNote: '白雲不在名单里：上游把它划掉了，至今没人验过它吃不吃这个补正',
    deferred: [
      '白雲（mstId 964）：上游在参战舰名单里把它划了删除线，同页「艦種別」表也没收它，' +
        '本台账照上游不收。那一节的确认日期是 2023-01，白雲比它晚实装，' +
        '「白雲到底吃不吃这个补正」上游至今没给过票——不是查过说没有，是没人查过。',
      '同页「艦種別」表（按血条把同一批舰切成驱逐/轻巡/重巡级/轻母/其他）不另落一份：' +
        '它是史実補正表的另一种切法，不是第二份数据，两份并存只会各自漂移。',
    ],
  },
])

const byCode = new Map(NORMAL_MAP_BONUSES.map((one) => [one.code, one]))

/** 这张常规图的特效台账；没收录就是 null（调用方整节不渲染，不挂空牌子）。 */
export const normalMapBonusOf = (code: string): NormalMapBonus | null =>
  byCode.get(`${code}`) ?? null
