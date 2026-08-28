// 退避：这一趟出击里有人被送回港了，到返港为止她不再参战。
//
// 判断只有两句话，但它们必须**只有一份**：主进程按 goback_port 往出击上攒名单，
// 渲染层按同一份名单决定编队卡的退场态，制空 / 索敌 / 输送量 / 大破名单按同一份名单排除。
// 三处各写一遍的下场是可预期的——某一处漏掉「返港要解除」，或者算制空时把她算进去。
//
// 两条纪律与哀悼态（shared/sortie-mourning）完全一致：
// ① **可从状态推导**：给同一份 SortieView，任何时候算都得到同一个答案。
//    重开界面、甚至重开艦素后回灌同一份出击，都不需要「恢复退避标记」这种东西。
// ② **返港即解除**：返港时 store 把 sortie.active 落下，这里立刻返回空。
//    没有单独的「解除」动作，也就没有「忘了解除」这条 bug 路径。
//
// ---- 舰位怎么换成在籍 id ----
// battleresult 给的是**跨两队连号**的 0 基舰位（0–5 主力、6–11 护卫队），
// 与战斗包 `api_escape_idx` / `api_escape_idx_combined` 那两段拼起来同一套坐标。
// 遊撃部隊是单队 7 舰，0–6 直接落在那一队里，不走护卫队那条分支。

import type { SortieEscapedShip, SortieView } from './mg-types'

/** 一支在出击的舰队：`ships` 是编成位上的在籍 id，`-1` / `0` 表示空位。 */
export interface EscapeFleets {
  /** 出击的那一队（連合时即第一舰队）。 */
  main: readonly number[]
  /** 護衛（第二）舰队；没有联合编成时留空。 */
  escort: readonly number[]
}

/**
 * 0 基舰位 → 在籍 id。落在空位、越界、或那一队根本不存在时返回 null。
 *
 * 6 以上只在**有护卫队**时才映射到第二队：单队 7 舰的遊撃部隊没有第二队，
 * 位 6 是她自己那一队的第七个人，照第一队索引取。
 */
export const rosterAtEscapePosition = (
  fleets: EscapeFleets,
  position: number,
): number | null => {
  if (!Number.isInteger(position) || position < 0) return null
  const useEscort = position >= 6 && fleets.escort.length > 0
  const list = useEscort ? fleets.escort : fleets.main
  const id = list[useEscort ? position - 6 : position]
  return typeof id === 'number' && id > 0 ? id : null
}

export interface EscapeOffer {
  escape: readonly number[]
  tow: readonly number[]
}

/**
 * 这一次退避新添的条目（已在名单里的不重复给）。
 *
 * 纯增量：调用方负责往 sortie.escaped 上推。不在这里就地改数组，
 * 是为了让「收了几条」这件事在护栏里看得见——没有 offer 时返回空，
 * 调用方据此判定「到了 goback_port 却没人可退」这条异常。
 */
export const newEscapeEntries = (
  offer: EscapeOffer | null | undefined,
  fleets: EscapeFleets,
  known: readonly { rosterId: number }[],
  at: { cell: number; ts: number },
  describe: (rosterId: number) => { mstId: number; name: string },
): SortieEscapedShip[] => {
  if (!offer) return []
  const seen = new Set(known.map((entry) => entry.rosterId))
  const out: SortieEscapedShip[] = []
  const take = (positions: readonly number[], role: SortieEscapedShip['role']) => {
    for (const position of positions) {
      const rosterId = rosterAtEscapePosition(fleets, position)
      if (rosterId == null || seen.has(rosterId)) continue
      seen.add(rosterId) // 同一次报文里 escape 与 tow 指到同一个人也只收一条
      out.push({ rosterId, ...describe(rosterId), role, cell: at.cell, ts: at.ts })
    }
  }
  take(offer.escape ?? [], 'escaped')
  take(offer.tow ?? [], 'tow')
  return out
}

/**
 * 现在谁已经退避了。空数组 = 没人退（一切照常算）。
 *
 * 出击已结束（返港）、演习、名单为空——三种情况都返回空。
 */
export const escapedShipsOf = (
  sortie: Pick<SortieView, 'active' | 'practice' | 'escaped'> | null | undefined,
): SortieEscapedShip[] => {
  if (!sortie || !sortie.active || sortie.practice) return []
  return Array.isArray(sortie.escaped) ? sortie.escaped : []
}
