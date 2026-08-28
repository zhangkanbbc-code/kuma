// 游戏侧的基础判据与舰种分组。
//
// 这些常量原先在各处就地重写：`mstId >= 1500` 散落 19 处，舰种集合在
// combat-forecast 与 fleet-special-attack 里各定义一份（值相同）。
// 分散的后果不是麻烦，是**改漏一处就出现两套结论**——比如给舰种集合加一个新舰种，
// 战力估算认了、特殊攻击判定没认，同一支舰队在两个面板里说法不一致。

/** 深海侧的 master id 起点：舰与装备都从 1500 开始。 */
export const ABYSS_MST_ID_BASE = 1500

export const isAbyssMstId = (mstId: number): boolean => mstId >= ABYSS_MST_ID_BASE

// ---- 舰种（api_stype）分组 ----
//
// 只收「多处都要判、且判错会改变结论」的几组；一次性用的分组仍留在各自模块里，
// 搬过来反而看不出它服务于哪条规则。

/** 潜水艦 / 潜水空母 */
export const SUBMARINE_STYPES: ReadonlySet<number> = new Set([13, 14])

/** 軽空母 / 正規空母 / 装甲空母 */
export const CARRIER_STYPES: ReadonlySet<number> = new Set([7, 11, 18])

/** 高速戦艦 / 戦艦 / 航空戦艦 / 超弩級戦艦 */
export const BATTLESHIP_STYPES: ReadonlySet<number> = new Set([8, 9, 10, 12])

export const isSubmarineStype = (stype: number): boolean => SUBMARINE_STYPES.has(stype)
export const isCarrierStype = (stype: number): boolean => CARRIER_STYPES.has(stype)
export const isBattleshipStype = (stype: number): boolean => BATTLESHIP_STYPES.has(stype)
