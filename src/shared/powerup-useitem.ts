// 限定给餌类型 → 道具消耗；扣数、归因与季节收据共用这一份事实表。
// 依据（2026-10-19）：舰娘百科「季节性/2026年万圣节」：
// 「本次改修会消耗一个南瓜，并提升舰娘的运值」。
// 维护者账本 2026-10-19：16:24:21 南瓜 3 个，16:25:13 / :26 / :45
// 连续三次成功改修，post.api_limited_feed_type 均为 "1"，无道具数量字段；
// 3 个可做 3 次，与百科合证每次恰好 1 个。useitem 96 由当日 start2 主数据核实。
export const POWERUP_LIMITED_FEED_COSTS: ReadonlyMap<string, { itemId: number; cost: number }> = new Map([
  ['1', { itemId: 96, cost: 1 }],
])

const warnedTypes = new Set<string>()

export const powerupUseitemCost = (limitedFeedType: unknown) => {
  if (limitedFeedType == null || limitedFeedType === '0') return null
  const type = String(limitedFeedType)
  const cost = POWERUP_LIMITED_FEED_COSTS.get(type)
  if (cost) return cost
  if (!warnedTypes.has(type)) {
    warnedTypes.add(type)
    console.warn(`[kuma] mg: unknown powerup api_limited_feed_type ${type}`)
  }
  return null
}
