// 基地航空队的攻击力估算。
//
// 出处：wikiwiki「基地航空隊」与「対地攻撃」，口径见 docs/combat-bonus-sources.md。
//
// 两条最容易被忽略、又直接影响接线方式的性质：
//   ① **航空战不受 cap 前补正**——交战形态、阵形、损伤补正一律不影响。
//      所以陆航这段绝不能跟着昼战一起乘交战形态系数，得单独算完再加进去。
//   ② **打水上舰用雷装、打陆上型用爆装**。陆攻打陆上型时雷装完全不参与。
//
// 本模块只算「一波的期望攻击力」，不算命中与装甲减免——那由调用方按目标处理。

export interface LandBasePlane {
  type2: number
  torpedo: number // 雷装
  bomb: number // 爆装
  level: number // 改修 ★
  count: number // 当前搭载
  /** master id。陸偵補正要区分 二式陸偵(311)=1.125 与 熟練(312)=1.15，缺省则不加成 */
  mstId?: number
}

const T2_HOUGEKI = {
  carrierBomber: 7,
  carrierAttacker: 8,
  seaplaneBomber: 11,
  flyingBoat: 41,
  landAttacker: 47, // 陸攻
  landRecon: 49, // 陸上偵察機
  largeLandPlane: 53, // 大型陸上機
  jetFighter: 56,
  jetFighterBomber: 57,
  jetAttacker: 58,
} as const

const JET_TYPES = new Set<number>([
  T2_HOUGEKI.jetFighter,
  T2_HOUGEKI.jetFighterBomber,
  T2_HOUGEKI.jetAttacker,
])

/** 種別倍率：陸攻 0.8、大型陸上機/艦攻/艦爆/水爆 1.0、噴式機 0.7071 */
export const kindMultiplier = (type2: number): number => {
  if (type2 === T2_HOUGEKI.landAttacker) return 0.8
  if (JET_TYPES.has(type2)) return 0.7071
  if (
    type2 === T2_HOUGEKI.largeLandPlane ||
    type2 === T2_HOUGEKI.carrierAttacker ||
    type2 === T2_HOUGEKI.carrierBomber ||
    type2 === T2_HOUGEKI.seaplaneBomber ||
    type2 === T2_HOUGEKI.flyingBoat
  ) {
    return 1
  }
  return 0 // 战斗机等不参与对面攻击
}

/** 改修强化值（基地）：陸攻・大型陸上機 = 0.7×√★ */
const improvement = (plane: LandBasePlane): number => {
  if (plane.level <= 0) return 0
  if (plane.type2 === T2_HOUGEKI.landAttacker || plane.type2 === T2_HOUGEKI.largeLandPlane) {
    return 0.7 * Math.sqrt(plane.level)
  }
  return 0
}

/**
 * 一架中队的基本攻击力。
 * `againstLand` 为真时用爆装（陆上型），否则用雷装（水上舰）。
 *
 * 搭載数補正（wikiwiki 基地航空隊，确定性项）：大型陸上機 1.0、其余（含陸攻）1.8，
 * 乘在根号**内**——它与 cap 后那个 ×1.8 的陸攻補正是两个独立的项，不能互相顶替。
 */
export const planeBasePower = (plane: LandBasePlane, againstLand: boolean): number => {
  const kind = kindMultiplier(plane.type2)
  if (kind <= 0 || plane.count <= 0) return 0
  const stat = againstLand ? plane.bomb : plane.torpedo
  if (stat <= 0) return 0
  const slotMultiplier = plane.type2 === T2_HOUGEKI.largeLandPlane ? 1 : 1.8
  return kind * ((stat + improvement(plane)) * Math.sqrt(slotMultiplier * plane.count) + 25)
}

/**
 * 陸偵補正：中队里带 二式陸偵(熟練) ×1.15、二式陸偵 ×1.125。
 *
 * **乘在哪一步随目标类型不同**：対水上艦在基本攻撃力里（下取整之内），
 * 対地在最終攻撃力末尾（下取整之外）。所以这里只答「补正是多少」，
 * 乘的位置交给调用方——见 lbas-target-power.ts 的文件头 ③。
 */
const RECON_SKILLED_MST = 312
export const reconBonusOf = (planes: readonly LandBasePlane[]): number => {
  let bonus = 1
  for (const plane of planes) {
    if (plane.type2 !== T2_HOUGEKI.landRecon || plane.count <= 0) continue
    bonus = Math.max(bonus, plane.mstId === RECON_SKILLED_MST ? 1.15 : 1.125)
  }
  return bonus
}

export interface LandBaseWaveInput {
  planes: readonly LandBasePlane[]
  againstLand: boolean
  /**
   * 混合编成中陆上型目标所占比例。未提供时保持 againstLand 的全水上/全陆上口径；
   * 提供时按目标数加权，避免「候选里只要有一艘陆上型，整波都改用爆装」。
   */
  landTargetShare?: number
  /** 敌方是否联合舰队：对联合 ×1.1 */
  enemyCombined: boolean
}

/**
 * 一波（一支中队出击一次）的期望攻击力。
 *
 * 最終攻撃力 = [[基本攻撃力] × クリティカル × 熟練度クリティカル]
 *            × 触接 × 陸攻補正 × 陸攻特効 × 敵連合特効
 * 这里只施加**确定性的**那几项（陸攻補正 ×1.8、敵連合特効 ×1.1）。
 * 暴击、熟练度暴击、触接都是概率项，不假定发动——宁可低估，不给一个偏乐观的数。
 */
export const landBaseWavePower = (input: LandBaseWaveInput): number => {
  const landShare =
    typeof input.landTargetShare === 'number' && Number.isFinite(input.landTargetShare)
      ? Math.min(1, Math.max(0, input.landTargetShare))
      : null
  const reconBonus = reconBonusOf(input.planes)
  let total = 0
  for (const plane of input.planes) {
    const base = landShare == null
      ? planeBasePower(plane, input.againstLand)
      : planeBasePower(plane, false) * (1 - landShare) +
        planeBasePower(plane, true) * landShare
    if (base <= 0) continue
    // 陸攻補正只加给陸攻本身
    const landAttackerBonus = plane.type2 === T2_HOUGEKI.landAttacker ? 1.8 : 1
    total += base * reconBonus * landAttackerBonus
  }
  return total * (input.enemyCombined ? 1.1 : 1)
}

/** 该中队本次出击派向该点的波数（每队通常两波）。 */
export const wavesForCell = (
  strikes: Record<number, number[]> | null | undefined,
  squadRid: number,
  cell: number,
): number => {
  const cells = strikes?.[squadRid]
  if (!cells?.length || !(cell > 0)) return 0
  return cells.filter((target) => target === cell).length
}
