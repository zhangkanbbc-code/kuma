// 哀悼态：这一趟出击里沉了人，界面失色到返港为止。
//
// 判断只有两句话，但它们必须**只有一份**：主进程按 battleresult 往出击上攒名单，
// 渲染层按同一份名单决定失色与碎裂卡，铃按同一份名单发击沉通知。
// 三处各写一遍的下场是可预期的——某一处漏掉演习、或者漏掉「返港后要解除」。
//
// 两条纪律都编码在这里：
// ① **可从状态推导**：给同一份 SortieView，任何时候算都得到同一个答案。
//    所以重开界面（甚至重开艦素后回灌同一份出击）不需要「恢复哀悼标记」这种东西——
//    它本来就不是标记，是算出来的。
// ② **返港即解除**：返港时 store 把 sortie.active 落下，这里立刻返回空。
//    没有单独的「解除」动作，也就没有「忘了解除」这条 bug 路径。

import type { SortieSunkShip, SortieView } from './mg-types'

export interface SunkSource {
  /** 战斗里的我方舰。只认 sunk，与遭遇志、人生记录同一判据。 */
  fShips: readonly {
    rosterId: number | null
    mstId: number
    name: string
    lv: number
    sunk: boolean
  }[]
  /** 演习：那里的「击沉」只是 HP 打到 1 的胜负判定，不是真沉。 */
  practice: boolean
}

/**
 * 这一战新添的沉没条目（已在名单里的不重复给）。
 *
 * 纯增量：调用方负责往 sortie.sunkShips 上推。不在这里就地改数组，
 * 是为了让「收了几条」这件事在护栏里看得见。
 */
export const newSunkEntries = (
  battle: SunkSource | null | undefined,
  known: readonly { rosterId: number }[],
  at: { cell: number; battleNo: number; ts: number },
): SortieSunkShip[] => {
  if (!battle || battle.practice) return []
  const seen = new Set(known.map((entry) => entry.rosterId))
  const out: SortieSunkShip[] = []
  for (const ship of battle.fShips) {
    if (!ship.sunk || ship.rosterId == null || seen.has(ship.rosterId)) continue
    seen.add(ship.rosterId) // 同一份报文里出现两次也只收一条
    out.push({
      rosterId: ship.rosterId,
      mstId: ship.mstId,
      name: ship.name,
      lv: ship.lv,
      cell: at.cell,
      battleNo: at.battleNo,
      ts: at.ts,
    })
  }
  return out
}

/**
 * 现在该为谁默哀。空数组 = 不哀悼（界面正常上色）。
 *
 * 出击已结束（返港）、演习、名单为空——三种情况都返回空。
 */
export const mourningShipsOf = (
  sortie: Pick<SortieView, 'active' | 'practice' | 'sunkShips'> | null | undefined,
): SortieSunkShip[] => {
  if (!sortie || !sortie.active || sortie.practice) return []
  return Array.isArray(sortie.sunkShips) ? sortie.sunkShips : []
}
