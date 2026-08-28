// 33 式索敌的装备改修系数。
// 口径：https://wikiwiki.jp/kancolle/ルート分岐（索敵スコア計算式 B 值）
export const LOS33_IMPROVEMENT_COEFFICIENT: Readonly<Record<number, number>> = Object.freeze({
  10: 1.2, // 水上侦察机
  11: 1.15, // 水上爆击机
  12: 1.25, // 小型电探
  13: 1.4, // 大型电探
})

export const los33ImprovementBonus = (type2: number, level: number): number =>
  (LOS33_IMPROVEMENT_COEFFICIENT[type2] ?? 0) * Math.sqrt(Math.max(0, level))

// ---- 33 式纯核（渲染层编成面板与主进程出击样本共用）----
//
// total = Σ√(舰娘裸装索敌) + Σ(装备索敌×系数)×係数 - ceil(提督Lv×0.4) + 2×(空格数)
// 从 renderer/fleet-calc 抽出：出击落表那一刻要在主进程算一份存进样本
// （通关阵容的 33 式没法从历史签名回溯），两处必须同一套数学。
export interface Los33ItemInput {
  saku: number
  type2: number
  level: number
}

export interface Los33ShipInput {
  /** 面板索敌（含装备）；核内逐件减回去得裸装值 */
  panelLos: number
  items: Los33ItemInput[]
}

export interface Los33Breakdown {
  ship: number
  item: number
  teitoku: number
  total: number
}

export const los33Of = (
  ships: Los33ShipInput[],
  admiralLv: number,
  mapModifier = 1,
  slotCount = 6,
): Los33Breakdown => {
  let shipLos = 0
  let equipLos = 0
  let emptySlot = slotCount
  for (const ship of ships) {
    emptySlot -= 1
    let pureLos = ship.panelLos
    for (const item of ship.items) {
      pureLos -= item.saku
      const starBonus = los33ImprovementBonus(item.type2, item.level || 0)
      switch (item.type2) {
        case 8: // 艦上攻撃機
          equipLos += item.saku * 0.8
          break
        case 9: // 艦上偵察機
          equipLos += item.saku * 1.0
          break
        case 10: // 水上偵察機
          equipLos += (item.saku + starBonus) * 1.2
          break
        case 11: // 水上爆撃機
          equipLos += (item.saku + starBonus) * 1.1
          break
        case 12: // 小型電探
        case 13: // 大型電探
          equipLos += (item.saku + starBonus) * 0.6
          break
        default:
          equipLos += item.saku * 0.6
          break
      }
    }
    shipLos += Math.sqrt(Math.max(0, pureLos))
  }
  equipLos *= mapModifier
  const teitoku = Math.ceil(admiralLv * 0.4)
  const round2 = (value: number) => parseFloat(value.toFixed(2))
  return {
    ship: round2(shipLos),
    item: round2(equipLos),
    teitoku: round2(teitoku),
    total: round2(shipLos + equipLos - teitoku + 2 * emptySlot),
  }
}
