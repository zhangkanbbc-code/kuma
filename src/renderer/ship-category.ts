// 舰种的筛选口径。键是 api_stype（api_mst_stype.api_id）。
//
// 图鉴（收藏轴）与列表（在籍轴）共用这一份：两处各写一份，同一艘舰在两个
// 面板里会落进不同的分类，用户没法对照。
//
// 主数据里实际存在 22 个舰种（2026-08-08 从 api_start2 枚举）。顶栏放不下，
// 所以分两层：常用的做成 chip，**全部 22 个**在「更多分类」里逐个可选。
// 「其他」不写死名单——由具名分组反推，加新 chip 时不会忘了同步。

/** 舰种短名（简中）。列表与图鉴通关阵容共用——两处各抄一份迟早分家 */
export const STYPE_CN: Record<number, string> = {
  1: '海防', 2: '驱逐', 3: '轻巡', 4: '雷巡', 5: '重巡', 6: '航巡', 7: '轻母', 8: '高战',
  9: '战舰', 10: '航战', 11: '空母', 12: '超战', 13: '潜艇', 14: '潜母', 16: '水母',
  17: '扬陆', 18: '装母', 19: '工作', 20: '潜水母舰', 21: '练巡', 22: '补给',
}

/** 顶栏的常用分组。收藏是特例（不按舰种筛） */
export const SHIP_CHIPS: [string, number[]][] = [
  ['全部', []],
  // 海防舰图鉴内有 51 形态，比重巡(58)、正规空母(52) 只少一点，
  // 原来和工作舰、补给舰一起塞在「其他」里，翻起来很难受
  ['海防', [1]],
  ['驱逐', [2]],
  ['轻巡', [3, 4, 21]],
  ['重巡', [5, 6]],
  ['战舰', [8, 9, 10, 12]],
  ['空母', [7, 11, 18]],
  ['潜艇', [13, 14]],
  ['其他', []], // 具名分组之外的全部，见 isOtherShipType
  ['收藏', []],
]

const NAMED_SHIP_TYPES = new Set(SHIP_CHIPS.flatMap(([, types]) => types))

/** 不属于任何具名分组：水上机母舰 / 扬陆舰 / 工作舰 / 潜水母舰 / 补给舰 */
export const isOtherShipType = (stype: number): boolean => !NAMED_SHIP_TYPES.has(stype)

/**
 * chip 收不收这个舰种。
 *
 * 「其他」的名单必然是空的（它的定义就是「不在任何具名分组里」），所以**不能**
 * 拿 `types.length` 当前置条件——早先各卷自己写判断，图鉴那边正是这么写的，
 * 结果「其他」整条分支被跳过，点它等于没筛（实测 332 条全出，与「全部」一样）。
 *
 * 「全部」与「收藏」在舰种上不设限：收藏是另一根轴，由调用方单独判。
 */
export const shipChipMatches = (chip: string, stype: number): boolean => {
  if (chip === '其他') return isOtherShipType(stype)
  const types = SHIP_CHIPS.find(([label]) => label === chip)?.[1]
  if (!types || !types.length) return true
  return types.includes(stype)
}

/**
 * 「更多分类」面板里的排列顺序。
 * 主数据的 api_id 顺序本身就大致按舰种编成惯例走，直接用它，
 * 名字与是否存在都以 mg.master.stypes 为准——这里不硬编码任何中文名。
 */
export const ALL_SHIP_TYPE_IDS = Array.from({ length: 22 }, (_, i) => i + 1)
