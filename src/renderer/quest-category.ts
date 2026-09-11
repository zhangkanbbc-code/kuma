// 主任务页与独立任务树共用字母分类色；细分色由任务页 TASK_CATEGORIES 提供。
export const CAT_META: Record<string, [string, string]> = {
  A: ['编成', '#67c98a'],
  B: ['出击', '#e06c75'],
  C: ['演习', '#a3dc6f'],
  D: ['远征', '#3fcab4'],
  E: ['补给·入渠', '#e0c455'],
  F: ['工厂', '#b8895a'],
  G: ['改装', '#b489ff'],
  S: ['限时', 'var(--gold)'],
}
