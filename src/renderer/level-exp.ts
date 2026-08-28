// 等级经验阈值表：矿脉包为主，自己手上的舰实测为校。
//
// 选源提醒：**两个 wiki 的表都不能直接用**（2026-08-09 逐个核过）。
// wikiwiki.jp 与 zh.kcwiki 都按「结婚后从 0 重新数」列表，Lv130 记 785,000；
// 而游戏 api_exp[0] 是从 Lv1 连续累计的 1,785,000，本地实测点站后者。
// KC3Kai 是工具、跟 API 对齐，所以选它。照搬 wiki 会让 Lv100 以上少算一百万。
//
// 游戏 api_start2 不给这张表（顶层没有任何含 exp 的键），高段也没有可套的公式
// ——低段是 50·lv·(lv-1)（Lv10 = 4500 ✓），到 Lv130 实测却是 1,785,000，
// 公式给 838,500，差一倍多。所以按「规则数据不硬编码」走矿脉包（KC3Kai，MIT）。
//
// 同时继续从每艘**未满级**的舰反推实测点：
//   api_exp = [累计, 距下一级, 进度] → accumulated + toNext = 升到 (lv+1) 的累计阈值
// 这些点不是用来补矿脉的洞，而是**用来对表**：接包时 95 个实测点逐点核对，
// 全部一致。日后游戏调表或包过期，冲突会在这里现形——那时以实测为准，
// 因为它直接来自玩家自己的游戏。
import { mg, queryLode, uiGet, uiSet } from './kernel'
import { expToLevel, levelExpPointsOf, mergeLevelExp, type LevelExpShip } from '../shared/level-exp'

const KEY = 'levelExp'

/** 矿脉表：等级 → 达到该级所需累计经验 */
let lodeTable = new Map<number, number>()
let lodeAsked = false

/** 从玩家自己的舰反推的实测点，落盘累积 */
let observed = new Map<number, number>()
let loaded = false

/** 与矿脉表对不上的实测点：等级 → [实测, 矿脉] */
const conflicts = new Map<number, [number, number]>()

const ensure = () => {
  if (loaded) return
  loaded = true
  const saved = uiGet<Record<string, number>>(KEY, {})
  const next = new Map<number, number>()
  for (const [level, total] of Object.entries(saved ?? {})) {
    const n = Number(level)
    if (n > 1 && typeof total === 'number' && total > 0) next.set(n, total)
  }
  // 换引用而不是原地灌：下面的合成表按两份输入的**身份**判失效
  observed = next
}

/**
 * 矿脉表 + 实测点的合成查询表（实测覆盖矿脉）。
 *
 * expNeededTo 是**逐舰**调用的：鉴的列表一次全量渲染四百多艘、演习的推荐练级卡
 * 也逐舰算一次。原来每次调用都 `new Map(lodeTable)` 再逐条盖实测点，一次渲染
 * 就是十万级的 Map 插入。两份输入都只在明确的几处换：矿脉包到手（lodeTable 整表换）、
 * ensure 读盘、observeLevelExp 学到新点（这两处都换 observed 的引用），
 * 所以按身份缓存就够——原地改内容而不换引用会让这个缓存失灵，别那么写。
 */
let mergedTable: Map<number, number> | null = null
let mergedFromLode: Map<number, number> | null = null
let mergedFromObserved: Map<number, number> | null = null
const mergedExpTable = (): Map<number, number> => {
  if (mergedTable && mergedFromLode === lodeTable && mergedFromObserved === observed) {
    return mergedTable
  }
  const merged = new Map(lodeTable)
  for (const [level, total] of observed) merged.set(level, total)
  mergedTable = merged
  mergedFromLode = lodeTable
  mergedFromObserved = observed
  return merged
}

const recheck = () => {
  conflicts.clear()
  if (!lodeTable.size) return
  for (const [level, total] of observed) {
    const fromLode = lodeTable.get(level)
    if (fromLode != null && fromLode !== total) conflicts.set(level, [total, fromLode])
  }
  if (conflicts.size) {
    console.warn(
      `[kanso] 等级经验表与本地实测有 ${conflicts.size} 处不符，改用实测值`,
      [...conflicts.entries()].slice(0, 5),
    )
  }
}

/** 按需拉矿脉包。只拉一次，失败就退回纯实测。 */
export const ensureLevelExpLode = (onReady?: () => void) => {
  if (lodeAsked) return
  lodeAsked = true
  void queryLode('ship-exp').then((lode) => {
    const rows = lode?.data as Record<string, [number, number]> | undefined
    if (!rows) return
    const table = new Map<number, number>()
    for (const [level, pair] of Object.entries(rows)) {
      const n = Number(level)
      // pair = [升下一级所需, 达到该级的累计]；这里要的是后者
      const cumulative = Array.isArray(pair) ? pair[1] : null
      if (n > 0 && typeof cumulative === 'number' && cumulative >= 0) table.set(n, cumulative)
    }
    if (!table.size) return
    lodeTable = table
    ensure()
    recheck()
    onReady?.()
  })
}

/**
 * 从当前在册的舰学新的实测点，有新的就落盘。
 *
 * 表只增不减；实测点的用途是对表，不是补洞。
 */
export const observeLevelExp = () => {
  ensure()
  const points = levelExpPointsOf(
    Object.values(mg.ships).map((ship) => ({
      lv: ship.lv,
      expTotal: ship.expTotal,
      expNext: ship.expNext,
    })),
  )
  if (mergeLevelExp(observed, points)) {
    // 学到了新点：换一份新引用，让按身份缓存的合成表认出这次变化。
    // 只在真有变化时复制（表最多两百来条，且练级不是每秒发生）。
    observed = new Map(observed)
    uiSet(KEY, Object.fromEntries(observed))
    recheck()
  }
}

/**
 * 练到 targetLevel 还差多少经验。
 *
 * 实测优先于矿脉：实测直接来自玩家自己的游戏，包只是资料。
 * 两边都没有就返回 null——调用方如实说算不出，不许插值。
 */
export const expNeededTo = (ship: LevelExpShip, targetLevel: number): number | null => {
  ensure()
  return expToLevel(mergedExpTable(), ship, targetLevel)
}

/**
 * 达到某等级的累计经验。实测优先于矿脉（同 expNeededTo 的口径），
 * 两边都没有就返回 null——调用方如实说算不出，不许插值。
 *
 * 演习经验的公式直接吃这个数（对手旗舰与 2 号舰各取一次）。
 */
export const cumulativeExpAt = (level: number): number | null => {
  ensure()
  if (!(level > 0)) return null
  const fromObserved = observed.get(level)
  if (fromObserved != null) return fromObserved
  return lodeTable.get(level) ?? null
}

