// 游戏自报任务分类与周期的存在层映射。来源：
// EO apilist.txt 原文：api_category：任務カテゴリ　1=編成, 2=出撃, 3=演習, 4=遠征, 5=補給/入渠, 6=工廠, 7=改装, 8=出撃(2), 9=出撃(3)
// 10/11 是账本实测（questlist 按 api_category 分组 × 任务库编码字母：10 全 B、11 全 F），EO 原文未列。
// EO apilist.txt 原文：api_label_type：周期アイコン種別　1=単発, 2=デイリー, 3=ウィークリー, 6=マンスリー, 7=他(輸送5と空母3,クォータリー), 102=イヤーリー(2月), 103=イヤーリー(3月)
// 账本实测组合：(type, label) 为 (1,2) 日、(2,3) 周、(3,6) 月、(4,1) 单、(5,7) 季、(5,101…110) 年；年任 label−100 为重置月。

export const questPeriodFromObserved = (type: number, labelType: number): {
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'once' | null
  label: '日' | '周' | '月' | '季' | '年' | '单' | null
  cls: 'd' | 'w' | 'm' | 'q' | 'y' | 'o' | null
  annualMonth: number | null
} => {
  if (type === 1) return { kind: 'daily', label: '日', cls: 'd', annualMonth: null }
  if (type === 2) return { kind: 'weekly', label: '周', cls: 'w', annualMonth: null }
  if (type === 3) return { kind: 'monthly', label: '月', cls: 'm', annualMonth: null }
  if (type === 4) return { kind: 'once', label: '单', cls: 'o', annualMonth: null }
  if (type === 5 && labelType === 7) {
    return { kind: 'quarterly', label: '季', cls: 'q', annualMonth: null }
  }
  if (type === 5 && Number.isInteger(labelType) && labelType >= 101 && labelType <= 112) {
    return { kind: 'annual', label: '年', cls: 'y', annualMonth: labelType - 100 }
  }
  return { kind: null, label: null, cls: null, annualMonth: null }
}

export const questCategoryLetterFromObserved = (
  category: number,
): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | null => {
  if (category === 1) return 'A'
  if (category === 2 || category === 8 || category === 9 || category === 10) return 'B'
  if (category === 3) return 'C'
  if (category === 4) return 'D'
  if (category === 5) return 'E'
  if (category === 6 || category === 11) return 'F'
  if (category === 7) return 'G'
  return null
}
