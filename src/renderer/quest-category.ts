// 主任务页与独立任务树共用字母分类色；细分色由任务页 TASK_CATEGORIES 提供。
export const CAT_META: Record<string, [string, string]> = {
  A: ['编成', 'var(--qcat-A)'],
  B: ['出击', 'var(--qcat-B)'],
  C: ['演习', 'var(--qcat-C)'],
  D: ['远征', 'var(--qcat-D)'],
  E: ['补给·入渠', 'var(--qcat-E)'],
  F: ['工厂', 'var(--qcat-F)'],
  G: ['改装', 'var(--qcat-G)'],
  S: ['限时', 'var(--gold)'],
}

// 字母分类之外的细分档也集中在此，保留既有深色明度差。
export const CAT_DETAIL_COLORS = {
  repair: 'var(--qcat-E-repair)',
  develop: 'var(--qcat-F-develop)',
  scrap: 'var(--qcat-F-scrap)',
}
