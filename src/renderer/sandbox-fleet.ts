// 沙盘编成：一支不存在于游戏里的舰队，用来在出击前试搭配。
//
// 状态放在这里而不是编队卷里，是因为它有两个消费方：
//   · 编队卷「沙盘」页 —— 选人、看指标
//   · 海域详情的路线预测 —— 把它当成一支可选舰队，推演这套编成走这张图会怎样
// 后者才是它真正的用处：带路条件与胜率本来只认「当前四支舰队」，
// 想试一套编成得先去游戏里真拖完。
import { mg, uiGet, uiSet } from './kernel'
import type { Deck } from '../shared/mg-types'

/** 用负数占位：tab 与 deck.id 共用一套编号，而游戏的舰队 id 从 1 起。 */
export const SANDBOX_DECK_ID = -1
export const SANDBOX_CAP = 6

const KEY = 'ru.sandbox'

let ships: number[] = (uiGet<number[]>(KEY, []) ?? []).filter(
  (id) => Number.isInteger(id) && id > 0,
)

/** 当前沙盘成员（rosterId）。解体/改造掉的自动掉出——存的是 rosterId，查不到就是没了。 */
export const sandboxRosterIds = (): number[] => ships.filter((id) => mg.ships[id])

export const sandboxAdd = (rosterId: number): boolean => {
  if (!(rosterId > 0) || ships.includes(rosterId) || sandboxRosterIds().length >= SANDBOX_CAP) {
    return false
  }
  ships.push(rosterId)
  uiSet(KEY, ships)
  return true
}

export const sandboxRemove = (rosterId: number) => {
  ships = ships.filter((id) => id !== rosterId)
  uiSet(KEY, ships)
}

export const sandboxClear = () => {
  ships = []
  uiSet(KEY, ships)
}

/**
 * 把沙盘包成一支 Deck。
 *
 * 制空、索敌、TP、路线预测这些算法本来就只吃「一队舰」，跟舰队是不是真的存在无关，
 * 所以喂一支虚拟 Deck 就能整套复用，不必为 what-if 再写一遍。
 */
export const sandboxDeck = (): Deck => ({
  id: SANDBOX_DECK_ID,
  name: '沙盘编成',
  mission: [0, 0, 0, 0],
  ships: sandboxRosterIds(),
})
