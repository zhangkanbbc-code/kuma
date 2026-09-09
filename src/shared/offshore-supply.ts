/**
 * 舰娘百科「洋上补给」：「洋上補給的補給效果會等額的消耗所補給數量的母港資源」。
 * 通常舰队三档为 25% / 36% / 47%，联合舰队为 15% / 27.5% / 40%，最多消耗三个。
 * 取整规则未定：这里逐舰向下取整，仅作油弹估算，下一条舰船报文校正。
 */
export const OFFSHORE_SUPPLY_RATES = {
  normal: [0.25, 0.36, 0.47],
  combined: [0.15, 0.275, 0.40],
} as const

export const planOffshoreSupply = (
  ships: readonly { rosterId: number; fuel: number; bull: number; fuelMax: number; bullMax: number }[],
  useNum: number,
  combined: boolean,
): { rosterId: number; fuel: number; bull: number }[] => {
  const rate = OFFSHORE_SUPPLY_RATES[combined ? 'combined' : 'normal'][Math.min(useNum, 3) - 1] ?? 0
  return ships.map(({ rosterId, fuel, bull, fuelMax, bullMax }) => ({
    rosterId,
    fuel: Math.min(fuelMax, fuel + Math.floor(fuelMax * rate)),
    bull: Math.min(bullMax, bull + Math.floor(bullMax * rate)),
  }))
}

export const planOffshoreSupplyConsumption = (
  slot: readonly number[],
  mstIdOf: (instId: number) => number | undefined,
  useNum: number,
): number[] => slot.filter((id) => mstIdOf(id) === 146).slice(0, Math.min(useNum, 3))

export const offshoreSupplyNote = (useNum: number, rate: number): string =>
  `洋上补给 ×${useNum} · 全队油弹 +${Number((rate * 100).toFixed(1))}%`

export const rationNote = (): string => '战斗粮食已用'
