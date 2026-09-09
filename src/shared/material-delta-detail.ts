import {
  createItemUseRefreshTracker, itemUseMaterialCategory,
  ITEM_USE_PATH, PAY_ITEM_USE_PATH, MATERIAL_REFRESH_PATH,
  type ItemUseRefreshTracker,
} from './item-use-materials'
import { mapIdOf } from './map-id'

export const SHIP_REMODEL_CATEGORY = '舰娘改造'
export const QUEST_COST_CATEGORY = '任务消耗'
export const AIR_BASE_SORTIE_CATEGORY = '基地航空队出击'

/** 只存业务 id 与数值；未知数字用 0，未知海域点位省略。不持久化名称或请求全文。 */
export type DeltaDetail =
  | { kind: 'anchorageRepair'; map: number; cell: number; repairer: number; ships: number; healed: number; steel: number; estimated: true }
  | { kind: 'offshoreSupply'; map: number; cell: number; useNum: number; estimated: true }
  | { kind: 'supply'; ships: number[]; mode?: 1 | 2 | 3; onslot: boolean }
  | { kind: 'dock'; ship: number; mst: number; ndock: number; highspeed: boolean }
  | { kind: 'build'; recipe: [number, number, number, number, number]; highspeed: boolean; large: boolean; kdock: number }
  | { kind: 'craft'; recipe: [number, number, number, number]; multiple: boolean; results: number[] }
  | { kind: 'scrap'; ships: { id: number; mst: number }[]; withSlots: boolean }
  | { kind: 'discard'; slotitems: { id: number; mst: number }[] }
  | { kind: 'improve'; slotitem: number; mst: number; certain: boolean; success: boolean; after?: { mst: number; level: number } }
  | { kind: 'expedition'; mission: number; deck: number; result: 'great' | 'success' | 'failed' }
  | { kind: 'quest'; quest: number }
  | { kind: 'questCost'; quest: number }
  | { kind: 'airBase'; action: 'setPlane' | 'supply'; area: number; base: number; squadron: number }
  | { kind: 'airBaseSortie'; map: number }
  | { kind: 'mapItem'; map?: number; cell?: number; source: 'start' | 'next' }
  | { kind: 'shipRemodel'; ship: number; from: number; to: number }
  | { kind: 'itemUse'; item: number | null; paid: boolean }

export interface DeltaDetailContext {
  apiPath: string
  postBody?: Record<string, unknown>
  body?: any
  before?: {
    ships?: Record<number, number>
    slotitems?: Record<number, { mstId: number }>
    dockShip?: number
  }
  after?: { ships?: Record<number, number> }
  sortie?: { mapArea: number; mapNo: number; currentCell?: number } | null
  expedition?: { mission: number; deck: number; result?: 'great' | 'success' | 'failed' }
}
const num = (value: unknown): number => Number(value) || 0
const ids = (value: unknown): number[] => `${value ?? ''}`.split(',').map(num).filter(id => id > 0)
const flag = (value: unknown): boolean => num(value) > 0

/** 白名单逐字段取值：api_token 即使出现在 postBody / body 也没有进入 detail 的路径。 */
export const buildDeltaDetail = ({ apiPath, postBody: p = {}, body: b = {}, before, after, sortie, expedition }: DeltaDetailContext): DeltaDetail | null => {
  b = b?.api_data ?? b ?? {}
  const recipe: [number, number, number, number] = [1, 2, 3, 4].map(i => num(p[`api_item${i}`])) as [number, number, number, number]
  switch (apiPath) {
    case '/kcsapi/api_req_hokyu/charge': {
      const mode = num(p.api_kind)
      return { kind: 'supply', ships: ids(p.api_id_items), ...(mode === 1 || mode === 2 || mode === 3 ? { mode } : {}), onslot: flag(p.api_onslot) }
    }
    case '/kcsapi/api_req_nyukyo/start':
    case '/kcsapi/api_req_nyukyo/speedchange': {
      const speed = apiPath.endsWith('/speedchange')
      const ship = speed ? before?.dockShip ?? 0 : num(p.api_ship_id)
      return { kind: 'dock', ship, mst: before?.ships?.[ship] ?? after?.ships?.[ship] ?? 0, ndock: num(p.api_ndock_id), highspeed: speed || flag(p.api_highspeed) }
    }
    case '/kcsapi/api_req_kousyou/createship':
    case '/kcsapi/api_req_kousyou/createship_speedchange':
      return { kind: 'build', recipe: [...recipe, num(p.api_item5)], highspeed: apiPath.endsWith('_speedchange') || flag(p.api_highspeed), large: flag(p.api_large_flag), kdock: num(p.api_kdock_id) }
    case '/kcsapi/api_req_kousyou/createitem':
      return { kind: 'craft', recipe, multiple: flag(p.api_multiple_flag), results: Array.isArray(b.api_get_items) ? b.api_get_items.map((item: any) => num(item.api_slotitem_id) || -1) : b.api_get_item ? [num(b.api_get_item.api_slotitem_id) || -1] : b.api_create_flag === 0 ? [-1] : [] }
    case '/kcsapi/api_req_kousyou/destroyship':
      return { kind: 'scrap', ships: ids(p.api_ship_id).map(id => ({ id, mst: before?.ships?.[id] ?? 0 })), withSlots: flag(p.api_slot_dest_flag) }
    case '/kcsapi/api_req_kousyou/destroyitem2':
      return { kind: 'discard', slotitems: ids(p.api_slotitem_ids).map(id => ({ id, mst: before?.slotitems?.[id]?.mstId ?? 0 })) }
    case '/kcsapi/api_req_kousyou/remodel_slot':
      return { kind: 'improve', slotitem: num(p.api_slot_id), mst: before?.slotitems?.[num(p.api_slot_id)]?.mstId ?? 0, certain: flag(p.api_certain_flag), success: flag(b.api_remodel_flag), ...(b.api_after_slot ? { after: { mst: num(b.api_after_slot.api_slotitem_id), level: num(b.api_after_slot.api_level) } } : {}) }
    case '/kcsapi/api_req_mission/result':
      return { kind: 'expedition', mission: expedition?.mission ?? 0, deck: expedition?.deck ?? num(p.api_deck_id), result: expedition?.result ?? (num(b.api_clear_result) === 2 ? 'great' : num(b.api_clear_result) === 1 ? 'success' : 'failed') }
    case '/kcsapi/api_req_quest/clearitemget':
      return { kind: 'quest', quest: num(p.api_quest_id) }
    case '/kcsapi/api_req_air_corps/set_plane':
    case '/kcsapi/api_req_air_corps/supply':
      return { kind: 'airBase', action: apiPath.endsWith('/set_plane') ? 'setPlane' : 'supply', area: num(p.api_area_id), base: num(p.api_base_id), squadron: num(p.api_squadron_id) }
    case '/kcsapi/api_req_map/start_air_base':
      return { kind: 'airBaseSortie', map: sortie ? mapIdOf(sortie.mapArea, sortie.mapNo) : 0 }
    case '/kcsapi/api_req_map/start':
    case '/kcsapi/api_req_map/next': {
      const area = sortie?.mapArea || num(b.api_maparea_id) || num(p.api_maparea_id)
      const no = sortie?.mapNo || num(b.api_mapinfo_no) || num(p.api_mapinfo_no)
      const cell = num(b.api_no) || sortie?.currentCell || 0
      return { kind: 'mapItem', ...(area > 0 && no > 0 ? { map: mapIdOf(area, no) } : {}), ...(cell > 0 ? { cell } : {}), source: apiPath.endsWith('/start') ? 'start' : 'next' }
    }
    case '/kcsapi/api_req_kaisou/remodeling': {
      const ship = num(p.api_id)
      return { kind: 'shipRemodel', ship, from: before?.ships?.[ship] ?? 0, to: after?.ships?.[ship] ?? 0 }
    }
    case ITEM_USE_PATH:
    case PAY_ITEM_USE_PATH:
      return { kind: 'itemUse', item: num(apiPath === PAY_ITEM_USE_PATH ? p.api_payitem_id : p.api_useitem_id) || null, paid: apiPath === PAY_ITEM_USE_PATH }
    default: return null
  }
}

// 2026-09-07 查账：7357 笔差分（约每天 210 笔）。638 包 material 的前驱为
// clearitemget 548、ship3（改造后）25、payitemuse 64、无前驱 1。
// 改造漏分 25 笔，弹药 -20160 / 钢材 -22125，对应舰历 remodel 25 条；
// remodeling → material 0.55–0.74 s，窗口取 3000 ms。
// 任务刷新漏分 73 笔，钢材 -71280；p90 1.6–2.9 s，最大 24.4 s，窗口取 30000 ms。
// 例如 1107 扣钢 24000、657 扣 4000、677 扣 3600、676 扣 2400、674 扣 300、
// 715 扣钢 900 / 铝 500。08-06 旧正值刷新是尚未累加 api_bounus type=1 的奖励补正。
// 1979 笔母港校准里 229 笔航程有 start_air_base；62-1 每次约 -57 / -28，
// 近 7 日 62-x 三图合计燃 -7192 / 弹 -4034；常规图同位置仅 +3～+30 自然回复。
// port 差额仍是净值（可混自然回复），这里按是否实际发过基地出击请求归类。
type RemodelDetail = Extract<DeltaDetail, { kind: 'shipRemodel' }>
type QuestDetail = Extract<DeltaDetail, { kind: 'quest' | 'questCost' }>
type AirSortieDetail = Extract<DeltaDetail, { kind: 'airBaseSortie' }>
export interface ShipRemodelRefreshTracker { pending: (RemodelDetail & { ts: number }) | null; detail: RemodelDetail | null }
export interface QuestSettleRefreshTracker { pending: { quest: number; ts: number } | null; detail: QuestDetail | null }
export interface AirBaseSortieTracker { pending: AirSortieDetail | null; detail: AirSortieDetail | null }
export const createShipRemodelRefreshTracker = (): ShipRemodelRefreshTracker => ({ pending: null, detail: null })
export const createQuestSettleRefreshTracker = (): QuestSettleRefreshTracker => ({ pending: null, detail: null })
export const createAirBaseSortieTracker = (): AirBaseSortieTracker => ({ pending: null, detail: null })

/** 每包调用；detail 只表示本包认领结果，pending 保存尚未落地的动作。 */
export const shipRemodelRefreshCategory = (tracker: ShipRemodelRefreshTracker, apiPath: string, ts: number, extra?: { detail?: DeltaDetail | null; body?: any }): string | null => {
  tracker.detail = null
  if (apiPath === '/kcsapi/api_req_kaisou/remodeling') {
    const detail = extra?.detail
    tracker.pending = { kind: 'shipRemodel', ship: 0, from: 0, to: 0, ...(detail?.kind === 'shipRemodel' ? detail : {}), ts }
  }
  if (apiPath === '/kcsapi/api_get_member/ship3' && tracker.pending) {
    const body = extra?.body?.api_data ?? extra?.body
    const ship = body?.api_ship_data?.find((s: any) => num(s.api_id) === tracker.pending!.ship)
    if (ship) tracker.pending.to = num(ship.api_ship_id)
  }
  if (apiPath !== MATERIAL_REFRESH_PATH || !tracker.pending) return null
  const { ts: armedTs, ...detail } = tracker.pending
  tracker.pending = null
  if (ts < armedTs || ts - armedTs > 3000) return null
  tracker.detail = detail
  return SHIP_REMODEL_CATEGORY
}

export const questSettleRefreshCategory = (tracker: QuestSettleRefreshTracker, apiPath: string, ts: number, extra?: { quest?: number; delta?: readonly number[] }): string | null => {
  tracker.detail = null
  if (apiPath === '/kcsapi/api_req_quest/clearitemget') tracker.pending = { quest: extra?.quest ?? 0, ts }
  if (apiPath !== MATERIAL_REFRESH_PATH || !tracker.pending) return null
  const pending = tracker.pending
  tracker.pending = null
  if (ts < pending.ts || ts - pending.ts > 30000) return null
  const cost = !!extra?.delta?.some(v => v < 0) && !extra?.delta?.some(v => v > 0)
  tracker.detail = { kind: cost ? 'questCost' : 'quest', quest: pending.quest }
  return cost ? QUEST_COST_CATEGORY : '任务'
}

export const airBaseSortieCategory = (tracker: AirBaseSortieTracker, apiPath: string, _ts: number, extra?: { map?: number }): string | null => {
  tracker.detail = null
  if (apiPath === '/kcsapi/api_req_map/start_air_base') tracker.pending = { kind: 'airBaseSortie', map: extra?.map ?? 0 }
  if (apiPath !== '/kcsapi/api_port/port') return null
  tracker.detail = tracker.pending
  tracker.pending = null // 任何 port（包括没有资源差分的 port）都清武装。
  return tracker.detail ? AIR_BASE_SORTIE_CATEGORY : null
}

export interface DeltaCategoryTrackers {
  itemUse: ItemUseRefreshTracker
  itemDetail: Extract<DeltaDetail, { kind: 'itemUse' }> | null
  shipRemodel: ShipRemodelRefreshTracker
  questSettle: QuestSettleRefreshTracker
  airBaseSortie: AirBaseSortieTracker
}
export const createDeltaCategoryTrackers = (): DeltaCategoryTrackers => ({ itemUse: createItemUseRefreshTracker(), itemDetail: null, shipRemodel: createShipRemodelRefreshTracker(), questSettle: createQuestSettleRefreshTracker(), airBaseSortie: createAirBaseSortieTracker() })
export interface DeltaResolution { category: string; detail: DeltaDetail | null }

/** 逐包推进全部机器（即使没有差分）。三种 material 武装源实际互斥，仍固定
 * 用道具 > 改造 > 任务，避免异常交错时同一包被多家认领；落地时全部消耗，不能短路调用。 */
export const resolveDeltaCategory = (trackers: DeltaCategoryTrackers, context: DeltaDetailContext & { ts: number; delta?: readonly number[]; categories?: Readonly<Record<string, string>> }): DeltaResolution => {
  const { apiPath, ts } = context
  const detail = buildDeltaDetail(context)
  if (detail?.kind === 'itemUse') trackers.itemDetail = detail
  const item = itemUseMaterialCategory(trackers.itemUse, apiPath, ts)
  const itemDetail = trackers.itemDetail
  if (apiPath === MATERIAL_REFRESH_PATH) trackers.itemDetail = null
  const remodel = shipRemodelRefreshCategory(trackers.shipRemodel, apiPath, ts, { detail, body: context.body })
  const quest = questSettleRefreshCategory(trackers.questSettle, apiPath, ts, { quest: num(context.postBody?.api_quest_id), delta: context.delta })
  const air = airBaseSortieCategory(trackers.airBaseSortie, apiPath, ts, { map: detail?.kind === 'airBaseSortie' ? detail.map : 0 })
  if (item) return { category: item, detail: itemDetail }
  if (remodel) return { category: remodel, detail: trackers.shipRemodel.detail }
  if (quest) return { category: quest, detail: trackers.questSettle.detail }
  if (air) return { category: air, detail: trackers.airBaseSortie.detail }
  const category = context.categories?.[apiPath] ?? '其他'
  return { category, detail: category === '其他' || category === '母港校准' ? null : detail }
}

export interface DeltaReplayEvent { ts: number; path: string; postBody: Record<string, unknown>; body?: any }
export interface DeltaReplayRow { ts: number; category: string; values: readonly number[] }

/** 历史回放与实时共用 resolve；port / material 零差分也必须推进，以免串到后一次。 */
export const replayDeltaCategoryFixes = (events: DeltaReplayEvent[], deltas: DeltaReplayRow[]): Map<number, DeltaResolution> => {
  const trackers = createDeltaCategoryTrackers()
  const rows = new Map(deltas.map(row => [row.ts, row]))
  const found = new Map<number, DeltaResolution>()
  let sortie: DeltaDetailContext['sortie'] = null
  for (const event of events) {
    const body = event.body?.api_data ?? event.body
    if (event.path === '/kcsapi/api_req_map/start') {
      sortie = { mapArea: num(event.postBody.api_maparea_id) || num(body?.api_maparea_id), mapNo: num(event.postBody.api_mapinfo_no) || num(body?.api_mapinfo_no) }
    }
    const row = rows.get(event.ts)
    const result = resolveDeltaCategory(trackers, { apiPath: event.path, ts: event.ts, postBody: event.postBody, body: event.body, sortie, delta: row?.values })
    if (row && (row.category === '其他' || row.category === '母港校准') && result.category !== '其他') found.set(event.ts, result)
    if (event.path === '/kcsapi/api_port/port') sortie = null
  }
  return found
}
