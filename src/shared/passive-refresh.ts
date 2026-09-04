/**
 * 返港只认 sortie 状态从有到无，不能拿 keys.includes('sortie') 代替：
 * 游戏在出击途中每个节点都会推 sortie，逐节点查账正是这里要躲掉的无用功。
 * 若漏掉真正的返港沿，活动出击消耗卡会一直停在上上次出击。
 */
export const sortieJustEnded = (prev: unknown | null, next: unknown | null): boolean =>
  prev != null && next == null

export type ReviewView =
  | 'overview'
  | 'resources'
  | 'factory'
  | 'practice'
  | 'nodes'
  | 'events'
  | 'items'

export type ReviewQuery =
  | 'materials'
  | 'battles'
  | 'nodes'
  | 'nodeDrops'
  | 'events'
  | 'factory'
  | 'useitems'
  | 'itemChanges'
  | 'actions'
  | 'master'
  | 'map'
  | 'payLog'

const REVIEW_QUERIES: Record<ReviewView, readonly ReviewQuery[]> = {
  overview: ['materials', 'battles', 'nodes', 'events', 'factory', 'useitems', 'master'],
  resources: ['materials'],
  factory: ['factory'],
  practice: ['battles'],
  nodes: ['battles', 'nodes', 'nodeDrops', 'master', 'map'],
  events: ['events', 'master'],
  items: ['useitems', 'itemChanges', 'actions', 'master', 'payLog'],
}

/** 当前视图的渲染串真正会读取的查询结果。 */
export const reviewQueriesFor = (view: ReviewView): readonly ReviewQuery[] =>
  REVIEW_QUERIES[view]

/** 切页只补从未取到的表；手上已有的数据保留并继续显示。 */
export const missingReviewQueries = (
  view: ReviewView,
  loaded: Iterable<ReviewQuery>,
): ReviewQuery[] => {
  const have = new Set(loaded)
  return REVIEW_QUERIES[view].filter((query) => !have.has(query))
}
