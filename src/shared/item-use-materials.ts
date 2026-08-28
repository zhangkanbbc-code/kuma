// 用掉一件道具之后，那笔资源到账该记在谁头上。
//
// ════ 报文实测（2026-08-28 本机账本全量：payitemuse 20 条 / itemuse 7 条 / material 374 条）════
//
// - `api_req_member/payitemuse` 的回包**不带任何效果字段**——资源型道具只回
//   `{api_caution_flag:0}`。资源真正到账，靠客户端紧跟着自己发的
//   `api_get_member/material`：余额是游戏亲发的，差分由 mg/index 的落账逻辑照记，
//   但那条 path 不在 DELTA_CATEGORY 里，于是 17 笔全落进了「其他」。
// - 两包间隔 17 笔全在 **221–244ms**（中位 230）。同一条 material path 上另外两族触发源
//   离得很远：任务领奖后的刷新 1640–2904ms（前面是 clearitemget），近代化改修后的
//   223–285ms（前面是 ship3，且根本没有 payitemuse）。窗口取 1000ms——比实测最大值宽
//   四倍，又比最近的他族（1640ms）窄 640ms。账本里离 payitemuse 最近的一笔他族差分
//   是 2235 秒，两族之间没有任何模糊地带。
// - **归属正确性有独立第二票**：把窗口命中的 17 笔与主数据 `api_mst_payitem[].api_item`
//   逐笔对照，17/17 完全一致（タンカー徴用 [1200,…]、アルミ大量産 […650…]、
//   高速修復材パック6 […6…]、八八資源セット [880×4]）。**主数据只用来对账，不用来记账**：
//   落进账本的数字始终是游戏亲发的余额差——消耗品封顶截断时表会错，余额差不会。
// - 母港拡張（`api_item` 全 0）后面跟的是 `api_get_member/basic`，不发 material。
//   没有资源变动就没有这一笔，与上面同一套解释。
//
// itemuse（普通道具）的**资源型**响应本机零样本：11:06 那条家具箱只回家具币、
// 8-18 那条是道具换道具，两次后面都没有 material 包。它按同一台状态机武装，但单独一类：
// 免费道具混进氪金那一格就是假账。

export const PAY_ITEM_USE_PATH = '/kcsapi/api_req_member/payitemuse'
export const ITEM_USE_PATH = '/kcsapi/api_req_member/itemuse'
export const MATERIAL_REFRESH_PATH = '/kcsapi/api_get_member/material'

/** 收支分解里的来源名（玩家可见）。 */
export const PAY_ITEM_CATEGORY = '氪金道具'
export const ITEM_USE_CATEGORY = '使用道具'

/** 用道具 → 客户端自发的余额刷新，实测 221–244ms。 */
export const ITEM_USE_REFRESH_WINDOW_MS = 1000

export interface ItemUseRefreshTracker {
  /** 上一次「用掉一件道具」的 path；null = 没有待认领的余额刷新 */
  path: string | null
  ts: number
}

export const createItemUseRefreshTracker = (): ItemUseRefreshTracker => ({ path: null, ts: 0 })

/**
 * 逐包推进状态机，返回这一包的资源差分该记在哪个来源名下；
 * null = 与用道具无关，照旧走 DELTA_CATEGORY。
 *
 * **每一包都要调用一次**（包括不带资源的包），否则武装与消耗的次序就断了。
 */
export const itemUseMaterialCategory = (
  tracker: ItemUseRefreshTracker,
  apiPath: string,
  ts: number,
): string | null => {
  if (apiPath === PAY_ITEM_USE_PATH || apiPath === ITEM_USE_PATH) {
    tracker.path = apiPath
    tracker.ts = ts
    return null
  }
  if (apiPath !== MATERIAL_REFRESH_PATH) return null
  const armed = tracker.path
  if (armed === null) return null
  const gap = ts - tracker.ts
  // 一次使用只认一次刷新：连点五下タンカー徴用，到达的是五对「使用→刷新」交替；
  // 不消耗的话一次使用会把后面别家来源的刷新也一并吞掉。
  tracker.path = null
  if (gap < 0 || gap > ITEM_USE_REFRESH_WINDOW_MS) return null
  return armed === PAY_ITEM_USE_PATH ? PAY_ITEM_CATEGORY : ITEM_USE_CATEGORY
}

/**
 * 从 events 回放出「该改判的资源刷新时刻 → 来源名」。
 *
 * 迁移与实时归因共用上面那台状态机，两边跑不出第二套口径。
 * 事件必须按到达次序喂进来，且上面三条 path 一条都不能漏——
 * 少喂 payitemuse 会漏判，少喂 material 会让消耗错位。
 */
export const replayItemUseMaterialCategories = (
  events: { ts: number; path: string }[],
): Map<number, string> => {
  const tracker = createItemUseRefreshTracker()
  const found = new Map<number, string>()
  for (const event of events) {
    const category = itemUseMaterialCategory(tracker, event.path, event.ts)
    if (category) found.set(event.ts, category)
  }
  return found
}
