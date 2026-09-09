// 出击中不能换装：同包舰船更新后不再挂在任何舰上的消耗品实例，视为已消耗。
// 洋上补给估算路径可能先删错实例；后续舰船报文仍带着该 id 时，实例表已无 mstId，
// 此处不尝试恢复，等待下次全量装备报文自愈。
export const SORTIE_CONSUMABLE_MST_IDS = [42, 43, 145, 150, 241, 146]

export const diffConsumedInstances = (
  before: { rosterId: number; slots: number[] }[],
  after: { rosterId: number; slots: number[] }[],
  mstIdOf: (instId: number) => number | undefined,
): { rosterId: number; instId: number; mstId: number }[] => {
  const updatedShips = new Set(after.map((ship) => ship.rosterId))
  const remaining = new Set(after.flatMap((ship) => ship.slots))
  return before.flatMap(({ rosterId, slots }) => {
    if (!updatedShips.has(rosterId)) return []
    return slots.flatMap((instId) => {
      const mstId = mstIdOf(instId)
      return instId > 0 && !remaining.has(instId) && mstId !== undefined && SORTIE_CONSUMABLE_MST_IDS.includes(mstId)
        ? [{ rosterId, instId, mstId }]
        : []
    })
  })
}
