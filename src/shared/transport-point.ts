// 輸送物資量（TP）的计算核。
//
// 从 renderer/fleet-calc 抽出来，理由与 shared/fleet-los33 同一条：口径本身是纯函数
//（舰种 + 装备 → 数），抽出来才测得动；留在 fleet-calc 里要先有 kernel 的 mg 单例才跑得起来。
//
// ## 两套表
//
// - **通用表**（本文件 `TP_GENERAL`）：口径见 wikiwiki「イベント海域テンプレート/輸送資源量の計算」
//   https://wikiwiki.jp/kancolle/イベント海域テンプレート/輸送資源量の計算_2019秋
//   TP = Σ(舰种基础値) + Σ(装备値)，输送扬陆点结算；A 胜 = S×0.7 向下取整，B 胜及以下不结算。
// - **图专用表**：个别活动图另发一张自己的表（图系数换舰种基础、装备值整张换掉），
//   见 shared/event-tp-rules。用哪一张由消费端按「当前海域的当前血条」决定。
//
// ## 取整口径
//
// **全程按精确值累加，只在合计之后取整。**逐件取整、逐舰取整都会算少。
// 通用表全是整数，这条看不出来；图专用表带 .25 / .5 的小数，取整时机就是三个不同的答案。
// 这一条不是推的，是 2026-08-27 一手实测锚钉死的——同一支队逐件取整算出 166、
// 逐舰取整算出 167、合计后取整算出 171，而游戏结算画面给的是 171（见 event-tp-rules 头注）。
//
// 「合计」的范围由 `TransportTable.perFleet` 决定，因为上游只对图专用表写死了这一层：
//
// - `perFleet: false`（通用表）：整支编成合成一笔，取整一次。这是本仓一直以来的口径，不动。
// - `perFleet: true`（62-5 专用表）：**第一舰队 / 第二舰队各自合计、各自取整**，
//   A 胜也是各自 ×0.7 再各自取整，最后两队相加。上游原文见 event-tp-rules 头注。
//   联合编成下这两种算法能差 1–2 点，单编成下则完全等价。
//
// ## 大破舰
//
// 到达扬陆点时大破的舰，连同其装备一律不计。判定交给调用方（它才知道当前 HP），
// 本核只认 `wrecked` 这一个布尔。

/** 一件装备。按 mstId 或名字识别，两条路都留着——通用表走名字，图专用表走 mstId。 */
export interface TransportEquip {
  mstId: number
  name: string
}

export interface TransportUnit {
  /** api_stype */
  stype: number
  /** 到达扬陆点时大破：整舰连同装备一律不计 */
  wrecked?: boolean
  equips: readonly TransportEquip[]
}

export interface TransportTable {
  /**
   * 图专用表在界面上的标注（如 `'62-5'`）。通用表为 null——
   * 消费端就是靠这一格决定芯片要不要写图号。
   */
  label: string | null
  /** 舰种基础值。未列出的舰种为 0。 */
  stypeTp: Readonly<Record<number, number>>
  /** 单件装备的值。这张表不给分就返回 0。 */
  equipTp: (equip: TransportEquip) => number
  /** A 胜比率 */
  aRate: number
  /** 联合编成时是否分队各自取整（见头注「取整口径」） */
  perFleet: boolean
}

export interface TransportPoint {
  /** S 胜结算量（已取整，= 游戏结算画面那个数） */
  s: number
  /** A 胜结算量 */
  a: number
  /**
   * 未取整的 S 胜合计（整支编成，不分队）。图专用表会带 .25 / .5 的小数——
   * 单列出来是为了让取整口径在测试里看得见。
   */
  sExact: number
  /** 因大破被排除的舰数 */
  excludedShips: number
  /** 实际有贡献的舰数 */
  contributing: number
  /** 用的哪张表（通用为 null），透传自 `TransportTable.label` */
  label: string | null
}

// 通用表的舰种基础值（S 胜）。未列出的舰种为 0：
// 戦艦 / 正規・装甲空母 / 軽空母 / 重巡 / 雷巡 / 海防艦 / 潜水艦 / 工作艦
export const TP_GENERAL_BY_STYPE: Readonly<Record<number, number>> = {
  2: 5, // 駆逐艦
  3: 2, // 軽巡洋艦
  6: 4, // 航空巡洋艦
  10: 7, // 航空戦艦
  14: 1, // 潜水空母
  16: 9, // 水上機母艦
  17: 12, // 揚陸艦
  20: 7, // 潜水母艦
  21: 6, // 練習巡洋艦
  22: 15, // 補給艦
}

// 通用表的装备值按名字模式匹配：大発家族持续新增（各国战车版本），
// 名字模式比穷举 id 更耐游戏更新。顺序敏感——特大発 必须先于 大発。
//
// （图专用表反过来走 mstId：那张表里同族各版本的值互不相同，
//   而且活动一结束就作废，不存在「耐更新」的需求。理由详见 event-tp-rules。）
const TP_GENERAL_EQUIP_RULES: readonly (readonly [RegExp, number])[] = [
  [/^特大発動艇/, 12], // 特大発動艇 及 +戦車第11連隊 / +チハ / +Ⅲ号戦車 等
  [/^大発動艇|^武装大発|^装甲艇|^M4A1\s*DD|^陸軍特種船/, 8],
  [/^特[二四]式内火艇/, 2],
  [/^ドラム缶/, 5],
  [/戦闘糧食|秋刀魚の缶詰/, 1],
]

export const TP_GENERAL: TransportTable = {
  label: null,
  stypeTp: TP_GENERAL_BY_STYPE,
  equipTp: ({ name }) => {
    for (const [re, tp] of TP_GENERAL_EQUIP_RULES) {
      if (re.test(name)) return tp
    }
    return 0
  },
  aRate: 0.7,
  // 通用表全是整数，分不分队算出来的 S 一模一样；A 则会差。
  // 上游那句「第一艦隊・第二艦隊ごとに切り捨て」写在**图专用表**那一页上，
  // 通用页只写了「計算の最後に小数点以下切り捨て」——没写分队，就不替它写。
  perFleet: false,
}

/**
 * 舰队输送物资量。大破舰按规则整舰（含装备）排除。
 *
 * 入参是**分好队的**编成：单编成传 `[ships]`，联合传 `[第一舰队, 第二舰队]`。
 * 分队边界只在 `table.perFleet` 为真时才影响结果（见头注「取整口径」），
 * 但入口一律要求分好——让调用方在有信息的地方把边界交出来，
 * 比在这里猜哪几艘属于哪一队可靠。
 */
export const transportPointOf = (
  fleets: readonly (readonly TransportUnit[])[],
  table: TransportTable = TP_GENERAL,
): TransportPoint => {
  // perFleet 为假时整支编成合成一笔——与分队各自取整不是同一个数
  const groups: readonly (readonly TransportUnit[])[] = table.perFleet ? fleets : [fleets.flat()]
  let s = 0
  let a = 0
  let sExact = 0
  let excludedShips = 0
  let contributing = 0
  for (const group of groups) {
    let groupExact = 0
    for (const unit of group) {
      if (unit.wrecked) {
        excludedShips++
        continue
      }
      let own = table.stypeTp[unit.stype] ?? 0
      for (const equip of unit.equips) own += table.equipTp(equip)
      if (own > 0) contributing++
      groupExact += own
    }
    const groupS = Math.floor(groupExact)
    s += groupS
    // A 胜按**已取整的 S**再乘再取整（上游：0.7倍されてもう一度切り捨て）
    a += Math.floor(groupS * table.aRate)
    sExact += groupExact
  }
  return { s, a, sExact, excludedShips, contributing, label: table.label }
}
