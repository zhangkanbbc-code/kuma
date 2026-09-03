// 鉴的整卷重画失效键。映射按每卷所有子页的读取面取并集：当前没打开抽屉也可以
// 多画一次，不能因为切到同卷的另一个子页才发现补丁被漏掉。
//
// 这张表就是缓存失效键：卷内渲染以后新增任何 mg 字段读取，都必须同步补进对应卷；
// 漏一项会让当前卷停在旧数据。卷切换是主动全量 render，不需要另记脏标记。

export type JiBook = 'ship' | 'roster' | 'equip' | 'stock' | 'abyss' | 'map' | 'item'

/** 主数据重建各卷目录、名称与导航标签，任何卷都依赖。 */
export const JI_ALL_BOOK_DEPENDENCIES = ['master'] as const

export const JI_BOOK_DEPENDENCIES: Readonly<Record<JiBook, readonly string[]>> = {
  ship: ['ships', 'decks', 'slotitems', 'useitems', 'materials', 'basic', 'sortie', 'quests'],
  roster: [],
  equip: [
    'ships',
    'decks',
    'slotitems',
    'useitems',
    'materials',
    'airBases',
    'ndocks',
    'sortie',
    'quests',
  ],
  stock: [],
  abyss: ['eventAreas', 'sortie'],
  map: ['ships', 'decks', 'slotitems', 'basic', 'eventAreas', 'sortie', 'mapGauges'],
  item: ['ships', 'slotitems', 'useitems', 'materials', 'basic', 'quests'],
}

export const jiBookNeedsRender = (changedKeys: readonly string[], book: JiBook): boolean =>
  changedKeys.some(
    (key) =>
      JI_ALL_BOOK_DEPENDENCIES.includes(key as (typeof JI_ALL_BOOK_DEPENDENCIES)[number]) ||
      JI_BOOK_DEPENDENCIES[book].includes(key),
  )
