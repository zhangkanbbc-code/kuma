// 基地航空队的出击可能范围（战斗行动半径）。
//
// 出处：wikiwiki「基地航空隊」页，2026-08-27 取原始 HTML 逐条誊抄，口径记在
// docs/combat-bonus-sources.md。**不要照 WebFetch 之类的转述层填这里的数**——
// 同一页用转述层取过一次，公式被小模型改写成了页面上并不存在的句子（那条教训
// 本来就写在 combat-bonus-sources.md 开头，这次又验证了一遍）。
//
// 四条原文事实：
//   ① 「航空隊の4つの中隊のうちで最も短い戦闘行動半径の値が、その航空隊の
//      出撃可能範囲となる。0機になっている中隊は除外される。」
//   ② 延伸只有四个机种做得到：「大型飛行艇・艦上偵察機・水上偵察機・陸上偵察機を
//      組み込むことで延伸が可能。水爆・水戦含め他の機種では延伸不可。」
//   ③ 「延長する側の偵察機自体は延長できない」——延伸后的半径不会超过那架侦察机自己的半径。
//   ④ 「一式戦 隼II型改(20戦隊)・一式戦 隼III型改(熟練／20戦隊) 以外の、
//      回転翼機・対潜哨戒機 が配備されている場合、延長効果自体が無効になる。」
//
// **④ 有个反直觉处，实现时别按名字猜**：東海（試製東海 269 / 東海(九〇一空) 270）
// 在游戏主数据里是 `api_type[2] = 47 陸上攻撃機`，**不是**対潜哨戒機——它不让延伸失效。
// 真正落在対潜哨戒機(26) 里的只有三式指揮連絡機族与两件一式戦 隼(20戦隊)，
// 而后两件正是原文点名的例外。所以判据必须走 type2 + 那两个 mstId，不能走「像不像反潜机」。
//
// 公式本身页面自己标的是「出撃可能範囲の**推定式**」——社区推定，不是官方公布值，
// 所以显示层按推定标注，别写成确定口径。

/** 装备种别号（api_mst_slotitem_equiptype 的 id，与 api_type[2] 同一坐标系） */
const T2_CARRIER_RECON = 9
const T2_SEAPLANE_RECON = 10
const T2_AUTOGYRO = 25
const T2_ASW_PATROL = 26
const T2_FLYING_BOAT = 41
const T2_LAND_RECON = 49
const T2_LARGE_LAND_PLANE = 53

/** 能把出击范围延伸出去的四个机种（原文列举，别扩表） */
export const RADIUS_EXTENDER_TYPES: ReadonlySet<number> = new Set([
  T2_FLYING_BOAT,
  T2_CARRIER_RECON,
  T2_SEAPLANE_RECON,
  T2_LAND_RECON,
])

/**
 * 原文点名的两件例外：它们自己就是対潜哨戒機，但配备了**不**让延伸失效。
 * 一式戦 隼II型改(20戦隊) = 489、一式戦 隼III型改(熟練／20戦隊) = 491。
 */
export const EXTENSION_SAFE_PATROL_MST_IDS: ReadonlySet<number> = new Set([489, 491])

/** 配备了就让延伸整个失效的机种：回転翼機・対潜哨戒機（上面两件除外） */
const EXTENSION_BLOCKER_TYPES: ReadonlySet<number> = new Set([T2_AUTOGYRO, T2_ASW_PATROL])

/** 「最低行動半径からの加算は最大3まで」 */
export const RADIUS_BONUS_CAP = 3

export interface RadiusPlane {
  type2: number
  distance: number
  mstId?: number
  /** 搭载数；0 机的中队按原文「0機になっている中隊は除外される」不参与判定 */
  count?: number
}

/** 这一格会不会让整队的延伸效果失效 */
export const blocksRadiusExtension = (plane: RadiusPlane): boolean =>
  EXTENSION_BLOCKER_TYPES.has(plane.type2) &&
  !EXTENSION_SAFE_PATROL_MST_IDS.has(plane.mstId ?? -1)

/**
 * 一支航空队（最多四格）的出击可能范围。
 *
 * 空格与 0 机的格子不参与；没有侦察机时就是各格半径的最小值。
 */
export const squadRadius = (planes: readonly RadiusPlane[]): number => {
  const manned = planes.filter((plane) => (plane.count ?? 1) > 0 && plane.distance > 0)
  if (!manned.length) return 0
  const min = Math.min(...manned.map((plane) => plane.distance))
  if (manned.some(blocksRadiusExtension)) return min
  let reconMax = 0
  for (const plane of manned) {
    if (RADIUS_EXTENDER_TYPES.has(plane.type2)) reconMax = Math.max(reconMax, plane.distance)
  }
  // 侦察机自己的半径不比最短的那格远时，没有可延伸的余量（√ 内会变负）
  if (reconMax <= min) return min
  return min + Math.min(RADIUS_BONUS_CAP, Math.round(Math.sqrt(reconMax - min)))
}

/** 中队定数：「偵察機系(水偵/艦偵/大型飛行艇/陸偵)は4機、大型陸上機は9機、それ以外は18機」 */
export const slotCapacity = (type2: number): number => {
  if (RADIUS_EXTENDER_TYPES.has(type2)) return 4
  if (type2 === T2_LARGE_LAND_PLANE) return 9
  return 18
}
