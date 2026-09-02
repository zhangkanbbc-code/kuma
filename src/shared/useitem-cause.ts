// 道具变动归因：只让一个端点解释它在机制上可能造成的方向与道具。
//
// 编号来源（2026-09-02 本机 api_start2 主数据 + events/useitem_log 实账核对）：
// · 44 家具コイン → api_req_furniture/buy
// · 55 書類一式＆指輪 → api_req_kaisou/marriage
// · 64 補強増設 → api_req_kaisou/open_exslot
// · 91 緊急修理資材 → api_req_map/anchorage_repair
// · 105 格納庫増設 → api_req_kaisou/hangar_expand
// · 58/65/75/77/78/100 → api_mst_shipupgrade 各计数字段 / api_req_kaisou/remodeling
// · 改修的 57/70/71/75/77/78/92/94/95/100/104 → 随包 equip-improve.json
//   所有非空 consumable 的实际编号集合 / api_req_kousyou/remodel_slot
//
// `*` 是任意 useitem；± 是同一动作既可能消费原道具、又可能产出兑换结果。
// 奖励与购买类一律只解释增加，不能再把紧随其后的返港全量负差值硬归给战果。
export type UseitemCauseSign = '+' | '-' | '±'
export type UseitemCauseItems = '*' | readonly number[]

export interface UseitemCauseRule {
  sign: UseitemCauseSign
  items: UseitemCauseItems
}

export interface UseitemCauseChange {
  itemId?: number
  id?: number
  delta: number
}

export interface UseitemCauseAction {
  ts: number
  path: string
  // events 表读出时是 JSON 串；渲染层/测试也可能已经解析成对象。
  // 归因表当前只需 path，但把两种真实形态都纳入契约，迁移与实时不会分叉。
  postBody?: string | Record<string, unknown> | null
}

export const USEITEM_FULL_SYNC_PATHS = [
  '/kcsapi/api_get_member/useitem',
  '/kcsapi/api_get_member/require_info',
] as const

export const isUseitemFullSyncPath = (path: string): boolean =>
  (USEITEM_FULL_SYNC_PATHS as readonly string[]).includes(path)

export const USEITEM_CAUSE_RULES: Readonly<Record<string, UseitemCauseRule>> = {
  '/kcsapi/api_req_sortie/battleresult': { sign: '+', items: '*' },
  '/kcsapi/api_req_combined_battle/battleresult': { sign: '+', items: '*' },
  '/kcsapi/api_req_mission/result': { sign: '+', items: '*' },
  '/kcsapi/api_req_quest/clearitemget': { sign: '+', items: '*' },
  '/kcsapi/api_req_member/get_event_selected_reward': { sign: '+', items: '*' },
  '/kcsapi/api_req_member/get_incentive': { sign: '+', items: '*' },
  '/kcsapi/api_req_map/start': { sign: '+', items: '*' },
  '/kcsapi/api_req_map/next': { sign: '+', items: '*' },
  '/kcsapi/api_dmm_payment/paycheck': { sign: '+', items: '*' },
  '/kcsapi/api_req_member/payitemuse': { sign: '+', items: '*' },
  '/kcsapi/api_req_member/itemuse': { sign: '±', items: '*' },
  '/kcsapi/api_req_kaisou/remodeling': {
    sign: '-',
    items: [58, 65, 75, 77, 78, 100],
  },
  '/kcsapi/api_req_kousyou/remodel_slot': {
    sign: '-',
    items: [57, 70, 71, 75, 77, 78, 92, 94, 95, 100, 104],
  },
  '/kcsapi/api_req_kaisou/open_exslot': { sign: '-', items: [64] },
  '/kcsapi/api_req_kaisou/hangar_expand': { sign: '-', items: [105] },
  '/kcsapi/api_req_furniture/buy': { sign: '-', items: [44] },
  '/kcsapi/api_req_kaisou/marriage': { sign: '-', items: [55] },
  '/kcsapi/api_req_map/anchorage_repair': { sign: '-', items: [91] },
}

const signMatches = (rule: UseitemCauseRule, delta: number): boolean =>
  rule.sign === '±' || (delta > 0 ? rule.sign === '+' : rule.sign === '-')

const itemMatches = (items: UseitemCauseItems, itemId: number): boolean =>
  items === '*' || items.includes(itemId)

export const resolveUseitemCause = (
  change: UseitemCauseChange,
  actionsSinceLastSync: readonly UseitemCauseAction[],
): string | null => {
  const itemId = Number(change.itemId ?? change.id)
  const delta = Number(change.delta)
  if (!(itemId > 0) || !Number.isFinite(delta) || delta === 0) return null
  let best: UseitemCauseAction | null = null
  for (const action of actionsSinceLastSync) {
    const rule = USEITEM_CAUSE_RULES[action.path]
    if (!rule || !signMatches(rule, delta) || !itemMatches(rule.items, itemId)) continue
    if (!best || action.ts >= best.ts) best = action
  }
  return best?.path ?? null
}
