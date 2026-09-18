/**
 * 母港給糧艦システム（野埼タイマー）的判据与推算。
 *
 * 出处：wikiwiki「野埼」页（维护者 2026-09-18 按原文核定）。实现口径取自：
 *   · 「(野埼or野埼改)を旗艦または2番艦にして編成を終えてから15分以上経過後に
 *      母港画面に入ると、同じ編成内の他艦のcond値が少し上昇する」
 *   · 「最大54になるまで適用」「野埼自身のcond値上昇は起きない」
 *   · 结算时检查远征 / 入渠 / 补给 / 损伤 / cond；条件不满足不结算也不重置计时。
 *   · 旗艦或2番艦有野埼时改编成会重置；预设展开与随伴一括解除不重置；多舰队共用
 *     一个计时器；出击、演习与野埼→野埼改改造不重置；结算后重新起算。
 * 锚点缺失一律计时未知；改造上位的野埼要等一次编成才起表（维护者 2026-09-18 实测）。
 *
 * 游戏没有给粮舰结算报文。回港落账只能从 cond 前后值反推：自然回复封顶 49，
 * 所以非给粮舰、回港前不在渠的舰由 ≤49 涨到 >49，才是能与自然回复分开的证据。
 * 49 以下的涨幅故意不认；漏认只会让「已可结算」多摆一会儿，玩家回港一趟没结成，
 * 方向是安全的。
 */

/** mst ship id → 每次结算增加的 cond。只按这两艘点名，不按舰种 22。 */
export const PROVISION_SHIPS: Readonly<Record<number, number>> = { 996: 2, 1002: 3 }

export const PROVISION_WARMUP_MS = 15 * 60_000
export const PROVISION_COND_CAP = 54
export const PROVISION_MIN_COND = 30

export interface ProvisionShipRef {
  rosterId: number
  index: 0 | 1
  gain: number
}

/** 只看旗舰与 2 号位；两位都是给粮舰时旗舰优先。 */
export const provisionShipAt = (
  deckShips: readonly number[],
  mstOf: (rosterId: number) => number | undefined,
): ProvisionShipRef | null => {
  for (const index of [0, 1] as const) {
    const rosterId = deckShips[index]
    if (!(rosterId > 0)) continue
    const gain = PROVISION_SHIPS[mstOf(rosterId) ?? -1]
    if (gain !== undefined) return { rosterId, index, gain }
  }
  return null
}

export type ProvisionHalt =
  | 'mission'
  | 'flagDocked'
  | 'flagUnsupplied'
  | 'flagHurt'
  | 'flagTired'

/** 这些条件只挡本次结算，不挡计时。顺序与游戏结算条件的展示优先级一致。 */
export const provisionHalt = (
  flag: { nowhp: number; maxhp: number; cond: number; fuel: number; bull: number },
  {
    onMission,
    flagDocked,
    fuelMax,
    bullMax,
  }: { onMission: boolean; flagDocked: boolean; fuelMax: number; bullMax: number },
): ProvisionHalt | null => {
  if (onMission) return 'mission'
  if (flagDocked) return 'flagDocked'
  if (flag.fuel < fuelMax || flag.bull < bullMax) return 'flagUnsupplied'
  const ratio = flag.maxhp > 0 ? flag.nowhp / flag.maxhp : 1
  if (ratio <= 0.75) return 'flagHurt'
  if (flag.cond < PROVISION_MIN_COND) return 'flagTired'
  return null
}

export type ProvisionShipState = 'docked' | 'full' | 'ready'

export const provisionShipState = (base: number, docked: boolean): ProvisionShipState => {
  if (docked) return 'docked'
  return base >= PROVISION_COND_CAP ? 'full' : 'ready'
}

export const provisionEstimate = (base: number, gain: number): number =>
  Math.min(PROVISION_COND_CAP, base + gain)

/** 回港前后 cond 的可观测跃迁是否足以证明给粮舰已经结账。 */
export const provisionBanked = (
  decksBefore: readonly { ships: readonly number[] }[],
  condBefore: ReadonlyMap<number, number>,
  dockedBefore: ReadonlySet<number>,
  condAfter: ReadonlyMap<number, number>,
  mstOf: (rosterId: number) => number | undefined,
): boolean =>
  decksBefore.some((deck) => {
    const provision = provisionShipAt(deck.ships, mstOf)
    if (!provision) return false
    return deck.ships.some((rosterId) => {
      if (rosterId <= 0 || rosterId === provision.rosterId || dockedBefore.has(rosterId)) return false
      const was = condBefore.get(rosterId)
      const now = condAfter.get(rosterId)
      return was !== undefined && now !== undefined && now > was && now > 49
    })
  })
