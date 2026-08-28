// 演习对手的「通用配装」模板（口径 2026-08-10 拍板：玩家舰队默认不可能裸装）。
//
// 首选数据是 kcwiki-ships 的初期装备，但那个包停更已久（773 条），现代形态
// （霧島改二丙 694、Indiana改 937、Béarn改 1060……）整批缺档——实测正是这些
// 对手把 D 败预测成了 B+ 64–91%。缺档时按舰种模板兜底：
//
// **这是建模假设，不是世界事实**——和航向加权 45/30/15/10 一样属于模型常数，
// 所以允许写在代码里；它刻意取保守的低阶通用件（35.6cm 而不是 46cm），
// 让它撑的仍然是「对手至少有这些」的下界。界面文案统一写「通用配装」。

export interface LoadoutSlotPick {
  /** api_mst_slotitem 的装备 id */
  mstId: number
  /** 该槽是否搭载飞机（planeCount 取该槽的标准搭载数） */
  plane: boolean
}

// 低阶通用件 id（api_start2 恒有）：
//   2 = 12.7cm連装砲   4 = 14cm単装砲    6 = 20.3cm連装砲   7 = 35.6cm連装砲
//  14 = 61cm四連装魚雷 19 = 九六式艦戦   16 = 九七式艦攻    25 = 零式水上偵察機
const GUN_DD = 2
const GUN_CL = 4
const GUN_CA = 6
const GUN_BB = 7
const TORPEDO = 14
const FIGHTER = 19
const ATTACKER = 16
const SEAPLANE = 25

/**
 * 按舰种给出各槽的通用装备。`slots` 是槽数（master 的 slotNum）。
 * 返回长度 ≤ slots；空数组 = 该舰种没有通用模板（补给舰等），维持裸装。
 */
export const genericLoadoutByStype = (stype: number, slots: number): LoadoutSlotPick[] => {
  const take = (picks: LoadoutSlotPick[]) => picks.slice(0, Math.max(0, slots))
  // 战舰系（含航空战舰）：双主炮 + 水侦——主炮+水侦正是观测射击的发动条件
  if (stype === 8 || stype === 9 || stype === 10) {
    return take([
      { mstId: GUN_BB, plane: false },
      { mstId: GUN_BB, plane: false },
      { mstId: SEAPLANE, plane: true },
    ])
  }
  // 重巡/航巡：双主炮 + 水侦
  if (stype === 5 || stype === 6) {
    return take([
      { mstId: GUN_CA, plane: false },
      { mstId: GUN_CA, plane: false },
      { mstId: SEAPLANE, plane: true },
    ])
  }
  // 轻巡/雷巡/练巡：炮 + 鱼雷 + 水侦
  if (stype === 3 || stype === 4 || stype === 21) {
    return take([
      { mstId: GUN_CL, plane: false },
      { mstId: TORPEDO, plane: false },
      { mstId: SEAPLANE, plane: true },
    ])
  }
  // 海防舰不能装备鱼雷。把它和驱逐绑在一起会凭空给出雷装，
  // 而预测模型只看合计雷装是否 > 0，于是本来不会发生的闭幕雷击也会被算进去。
  if (stype === 1) {
    return take([{ mstId: GUN_DD, plane: false }])
  }
  // 驱逐：炮 + 鱼雷
  if (stype === 2) {
    return take([
      { mstId: GUN_DD, plane: false },
      { mstId: TORPEDO, plane: false },
    ])
  }
  // 空母系（轻母/正母/装母）：第一槽舰战、其余舰攻——全槽有机，制空与开幕都成立
  if (stype === 7 || stype === 11 || stype === 18) {
    const picks: LoadoutSlotPick[] = [{ mstId: FIGHTER, plane: true }]
    for (let i = 1; i < slots; i += 1) picks.push({ mstId: ATTACKER, plane: true })
    return take(picks)
  }
  // 水母：全槽水侦
  if (stype === 16) {
    const picks: LoadoutSlotPick[] = []
    for (let i = 0; i < slots; i += 1) picks.push({ mstId: SEAPLANE, plane: true })
    return take(picks)
  }
  // 潜水系：鱼雷×2
  if (stype === 13 || stype === 14) {
    return take([
      { mstId: TORPEDO, plane: false },
      { mstId: TORPEDO, plane: false },
    ])
  }
  // 其余（补给/工作舰/扬陆等）：没有可默认的通用件，维持未知
  return []
}
