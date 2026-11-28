// 海域配曲的**本机留存**（2026-11-28 起）。
//
// `api_mst_mapbgm` 只给当下的配法：季节活动给常规图换的曲（秋刀鱼期间 1-1 道中换成 76）
// 活动一结束就从主数据里换回去，活动图撤场后整行消失。此前只能趁在场手抄
//（`shared/event-map-bgm`，只有 62 期）。现在每拿到一份主数据就记一遍：
// 每张图每一步的资源号一段，同一配法再见到只延长这一段，换了曲或整张图撤了就把它收口。
//
// 这里只放纯函数：怎么从主数据行拆出格子、拿到一份新主数据之后哪些段延长 / 收口 / 新开、
// 撤场后怎么拼回最后那一行。落库在 main/mg/ledger（`map_bgm_history`）。

/** 一张图上的五个配曲位，与 `api_mst_mapbgm` 的字段一一对应 */
export type MapBgmSlot = 'moving' | 'map-day' | 'map-night' | 'boss-day' | 'boss-night'

export const MAP_BGM_SLOTS: readonly MapBgmSlot[] = ['moving', 'map-day', 'map-night', 'boss-day', 'boss-night']

/** 一格：哪张图的哪一步用哪个战斗树资源号 */
export interface MapBgmCell {
  /** `api_mst_mapbgm.api_id`（区号×10＋图号） */
  mapId: number
  slot: MapBgmSlot
  bgm: number
}

/** 账本里的一段：同一格同一首曲连续被看到的那段时间 */
export interface MapBgmSpan extends MapBgmCell {
  id: number
  /** 第一次见到 */
  firstSeen: number
  /** 最后一次见到 */
  lastSeen: number
  /** 第一次确认它不在了（换了曲或整张图撤场）；还在用就是 null */
  closed: number | null
}

/** 与 `api_mst_mapbgm` 同形的一行；撤场后从留存拼回来的也是这个形状 */
export interface MapBgmRow {
  mapId: number
  api_moving_bgm: number
  api_map_bgm: readonly [number, number]
  api_boss_bgm: readonly [number, number]
}

const bgmIdOf = (value: unknown): number => {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= 999 ? id : 0
}

/** 主数据的配曲表拆成格子。号为 0（这一步没配曲）的格不收；同一张图出现两行时认第一行 */
export const mapBgmCellsOf = (rows: readonly unknown[]): MapBgmCell[] => {
  const out: MapBgmCell[] = []
  const seen = new Set<number>()
  for (const raw of rows) {
    const row = raw as Record<string, unknown> | null
    const mapId = Number(row?.api_id)
    if (!Number.isInteger(mapId) || mapId <= 0 || seen.has(mapId)) continue
    seen.add(mapId)
    const map = Array.isArray(row?.api_map_bgm) ? row.api_map_bgm : []
    const boss = Array.isArray(row?.api_boss_bgm) ? row.api_boss_bgm : []
    const values: [MapBgmSlot, unknown][] = [
      ['moving', row?.api_moving_bgm],
      ['map-day', map[0]],
      ['map-night', map[1]],
      ['boss-day', boss[0]],
      ['boss-night', boss[1]],
    ]
    for (const [slot, value] of values) {
      const bgm = bgmIdOf(value)
      if (bgm) out.push({ mapId, slot, bgm })
    }
  }
  return out
}

export interface MapBgmPlan {
  /** 这一次仍然看到、延长到本次的段 */
  extend: number[]
  /** 这一次没看到（换曲或撤场），收口的段 */
  close: number[]
  /** 新开的段 */
  insert: MapBgmCell[]
}

const cellKey = (cell: { mapId: number; slot: MapBgmSlot }) => `${cell.mapId}:${cell.slot}`

/**
 * 拿到一份新主数据之后怎么改账本。`open` 只传还没收口的段。
 *
 * 主数据里一格都拆不出来（报文残缺）就什么都不做——那不是「所有图都撤了」。
 */
export const planMapBgmSpans = (open: readonly MapBgmSpan[], cells: readonly MapBgmCell[]): MapBgmPlan => {
  const plan: MapBgmPlan = { extend: [], close: [], insert: [] }
  if (!cells.length) return plan
  const current = new Map(cells.map((cell) => [cellKey(cell), cell]))
  const kept = new Set<string>()
  for (const span of open) {
    const key = cellKey(span)
    const cell = current.get(key)
    // 同一格只认一段：账本里万一留着两段没收口的，多出来的一并收掉
    if (cell && cell.bgm === span.bgm && !kept.has(key)) {
      kept.add(key)
      plan.extend.push(span.id)
    } else {
      plan.close.push(span.id)
    }
  }
  for (const [key, cell] of current) {
    if (!kept.has(key)) plan.insert.push(cell)
  }
  return plan
}

/**
 * 主数据里已经没有这张图了（活动撤场）：照留存拼回它最后被看到时的那一行。
 *
 * 只取「最后一次见到这张图」那一刻在场的格——某一步后来改成不配曲的话，
 * 拿更早那段的号去填就成了张冠李戴。一格都没有就给 null。
 */
export const lastMapBgmRowOf = (spans: readonly MapBgmSpan[], mapId: number): MapBgmRow | null => {
  const own = spans.filter((span) => span.mapId === mapId)
  if (!own.length) return null
  const last = Math.max(...own.map((span) => span.lastSeen))
  const at = (slot: MapBgmSlot) =>
    own
      .filter((span) => span.slot === slot && span.lastSeen === last)
      .sort((a, b) => b.firstSeen - a.firstSeen)[0]?.bgm ?? 0
  return {
    mapId,
    api_moving_bgm: at('moving'),
    api_map_bgm: [at('map-day'), at('map-night')],
    api_boss_bgm: [at('boss-day'), at('boss-night')],
  }
}
