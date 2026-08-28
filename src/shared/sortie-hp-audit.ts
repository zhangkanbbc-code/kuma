// 出击途中的权威 HP 对账：战斗解析出来的 hpEnd 与游戏自报的耐久逐舰比一遍。
//
// 起因是「万一战斗模块统计出错」这一问。两个方向不对称：
// **误报大破**只是虚惊（玩家白撤一次），**漏报大破**会让人放心进击，真会被轰沉。
// 所以危险方向只有一个——本地说没大破、权威说大破。
//
// ════ 时序实测（2026-08-27，账本 events 表近 30 小时 208 场战斗）════
//
// 原以为 ship_deck 是「玩家做进击/撤退决定之前」游戏主动下发的一份权威快照，
// 于是对账能赶在决定前把漏报补喊出来。**实测不是这样**：
//
//   battleresult ──19～68 秒（玩家看结算画面）──▶ ship_deck ──0.3～0.7 秒──▶ api_req_map/next
//
// · 161 次 ship_deck，**每一次**紧接着的下一条报文都是 `api_req_map/next`（进击请求），
//   间隔 296～659 ms（中位 379 ms）；两者之间一条别的报文都没有。
// · 208 次 battleresult 里，161 次后面跟 ship_deck（＝玩家点了进击），
//   46 次直接跟 api_port/port（＝玩家点了撤退）——**撤退这一支根本没有 ship_deck**。
// · battleresult 与 next 的响应体都不含任何耐久字段（已逐键核对）。
//
// 也就是说 ship_deck 不是「决定前的快照」，而是**进击这个动作自己带出来的**一次刷新：
// 玩家点下进击 → 客户端拉 ship_deck → 随即发 next。整条协议里，
// 从一场战斗结束到下一步走出去，**没有**任何早于决定的权威耐久来源。
//
// 所以这份对账不是「决定前的护栏」，它是：
// ① 战斗视图与账本当场纠正回权威值（镝的警告条、大破名单读的是战斗视图，
//    它是解析产物、不跟账本自动走）；
// ② 纠正命中危险方向时补一条大破通知，前缀「修正：」——玩家这一步已经迈出去了，
//    但通知是阻断级横幅、要手动关，下一个点位的进击/撤退决定他手上是对的；
// ③ 任何 HP 不符都留一条对账记录——这是抓下一个解析 bug 的哨兵。
//
// 判据本身不在这里另起炉灶：大破线走 taiha-verdict 的 isTaihaHp，三处同一份。
//
// 已知的一处会误报「不符」：出击途中做过緊急泊地修理，之后**撤退回港**——耐久合法地涨了，
// 而战斗视图还停在那一场的推演值。方向是安全的（权威更健康），所以不会补喊，
// 只会在对账台账里留一条。本机账本至今 0 次泊地修理，没有为它专门开口子。

import type { BattleShipView } from './mg-types'
import { isTaihaHp } from './taiha-verdict'

/** 一艘舰的「解析值 ≠ 权威值」。 */
export interface HpMismatch {
  rosterId: number
  /** 跨两队连号舰位，与 taiha-verdict 同一套坐标。 */
  index: number
  /** 战斗报文里的主数据原名；本地化留给渲染侧。 */
  name: string
  /** 我们从战斗报文推演出来的战后耐久。 */
  parsed: number
  /** 游戏自报的耐久。 */
  authoritative: number
  hpMax: number
  /** 本地非大破 → 权威大破。只有这一向会害人。 */
  dangerous: boolean
}

/**
 * 逐舰对账。
 *
 * 排除三类，各有各的理由：
 * · **敌方/友军**（rosterId 为 null）——不在我方在籍表里，无从比对；
 * · **已沉**——舰已除籍，权威侧查不到她，剩下的耐久也没有意义；
 * · **已退避**——她被送回港了，之后的耐久与这一战的推演不是同一件事。
 *
 * `authoritativeHp` 查不到的舰一律跳过（不是「不符」）：局部报文本来就只覆盖
 * 出击编成，查不到只说明这份报文没提她。
 */
export const auditSortieHp = (
  fShips: readonly BattleShipView[],
  authoritativeHp: (rosterId: number) => number | undefined,
): HpMismatch[] => {
  const out: HpMismatch[] = []
  for (const ship of fShips) {
    if (ship.rosterId == null || ship.sunk || ship.escaped) continue
    const authoritative = authoritativeHp(ship.rosterId)
    if (typeof authoritative !== 'number' || !Number.isFinite(authoritative)) continue
    if (authoritative === ship.hpEnd) continue
    out.push({
      rosterId: ship.rosterId,
      index: ship.index,
      name: ship.name,
      parsed: ship.hpEnd,
      authoritative,
      hpMax: ship.hpMax,
      dangerous:
        !isTaihaHp(ship.hpEnd, ship.hpMax) && isTaihaHp(authoritative, ship.hpMax),
    })
  }
  return out
}
