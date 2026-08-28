export interface SortieSupplyBaseline {
  rosterId: number
  fuel: number
  ammo: number
}

export interface SortieSupplyState {
  rosterId: number
  fuel: number
  ammo: number
}

export interface SortieSupplyCost {
  fuel: number
  ammo: number
}

const finiteNonNegative = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * 出发与返港必须逐舰完整对齐；少一艘就不生成低报数字。
 * 返港值高于出发值时按 0 处理，避免补给后的快照制造负消耗。
 */
export const calculateSortieSupplyCost = (
  baseline: SortieSupplyBaseline[],
  after: SortieSupplyState[],
): SortieSupplyCost | null => {
  if (!Array.isArray(baseline) || !baseline.length || !Array.isArray(after)) return null
  const afterByRoster = new Map(
    after
      .map((ship) => {
        const rosterId = Number(ship?.rosterId)
        const fuel = finiteNonNegative(ship?.fuel)
        const ammo = finiteNonNegative(ship?.ammo)
        return Number.isInteger(rosterId) && rosterId > 0 && fuel != null && ammo != null
          ? [rosterId, { fuel, ammo }] as const
          : null
      })
      .filter((entry): entry is readonly [number, { fuel: number; ammo: number }] => entry != null),
  )
  let fuel = 0
  let ammo = 0
  for (const before of baseline) {
    const rosterId = Number(before?.rosterId)
    const beforeFuel = finiteNonNegative(before?.fuel)
    const beforeAmmo = finiteNonNegative(before?.ammo)
    const current = afterByRoster.get(rosterId)
    if (!current || beforeFuel == null || beforeAmmo == null) return null
    fuel += Math.max(0, beforeFuel - current.fuel)
    ammo += Math.max(0, beforeAmmo - current.ammo)
  }
  return { fuel, ammo }
}

// 返港前 ship_deck 可能只到上一场战斗；随后补给差额又可能被自然回复抵消少量。
// 两种本地证据取较大者，避免任一侧的已知低报。
export const mergeSortieSupplyCosts = (
  snapshot: SortieSupplyCost | null,
  resupply: SortieSupplyCost | null,
): SortieSupplyCost | null => {
  if (!snapshot) return resupply
  if (!resupply) return snapshot
  return {
    fuel: Math.max(snapshot.fuel, resupply.fuel),
    ammo: Math.max(snapshot.ammo, resupply.ammo),
  }
}
