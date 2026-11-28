// BGM 反查（2026-11-28 起）：一首曲用在哪些海图的哪一步、哪些家具上。
//
// 反查不另造判据，只把三份正向的事实倒过来：
//  · 海图：当前主数据的 `api_mst_mapbgm`（战斗树号）＋ 本机留存的配曲变动（shared/map-bgm-history）
//    ＋ 活动期间手抄的留存（shared/event-map-bgm，只在前两份都没有这张图时才用）；
//  · 家具：主数据 `api_mst_furniture.api_bgm_id`（母港树号）。
// 两棵树各一套号（见 shared/kcs-bgm），键里带着树名，绝不跨树合并。
import type { KcsBgmKind } from './kcs-bgm'
import {
  MAP_BGM_SLOTS,
  mapBgmCellsOf,
  type MapBgmRow,
  type MapBgmSlot,
  type MapBgmSpan,
} from './map-bgm-history'

export interface BgmSlotUse {
  slot: MapBgmSlot
  /** 当前主数据里就是这么配的 */
  current: boolean
  /** 本机留存里这一格这首曲最早 / 最后见到的时刻；没留存过就是 null */
  firstSeen: number | null
  lastSeen: number | null
  /** 只出自活动期间的手抄留存，没有日期 */
  archived: boolean
}

export interface BgmMapUse {
  mapId: number
  slots: BgmSlotUse[]
}

export interface BgmUsage {
  kind: KcsBgmKind
  id: number
  maps: BgmMapUse[]
  furniture: number[]
}

export interface BgmUsageInput {
  /** 当前主数据的 `api_mst_mapbgm` */
  master: readonly unknown[]
  /** 账本 `map_bgm_history` 的全部段 */
  history?: readonly MapBgmSpan[]
  /** 活动期间手抄的配曲行（shared/event-map-bgm） */
  archive?: readonly MapBgmRow[]
  /** 主数据家具：附带母港曲的那些 */
  furniture?: readonly { id: number; bgmId: number }[]
}

export const bgmUsageKey = (kind: KcsBgmKind, id: number): string => `${kind}:${id}`

export const parseBgmUsageKey = (key: unknown): { kind: KcsBgmKind; id: number } | null => {
  const matched = /^(port|battle):(\d{1,3})$/.exec(`${key ?? ''}`)
  if (!matched) return null
  const id = Number(matched[2])
  return id > 0 ? { kind: matched[1] as KcsBgmKind, id } : null
}

/** 手抄留存的行（字段名照 api_mst_mapbgm，图号叫 mapId）转回主数据形状，好走同一个拆格函数 */
const archiveAsMaster = (row: MapBgmRow) => ({
  api_id: row.mapId,
  api_moving_bgm: row.api_moving_bgm,
  api_map_bgm: row.api_map_bgm,
  api_boss_bgm: row.api_boss_bgm,
})

const slotOrder = (slot: MapBgmSlot) => MAP_BGM_SLOTS.indexOf(slot)

export const buildBgmUsage = (input: BgmUsageInput): Map<string, BgmUsage> => {
  const usage = new Map<string, BgmUsage>()
  const own = (kind: KcsBgmKind, id: number): BgmUsage => {
    const key = bgmUsageKey(kind, id)
    let entry = usage.get(key)
    if (!entry) {
      entry = { kind, id, maps: [], furniture: [] }
      usage.set(key, entry)
    }
    return entry
  }
  // 战斗树：先按「曲 | 图 | 格」攒，最后再收成每首曲的图列表
  const slots = new Map<string, BgmSlotUse & { bgm: number; mapId: number }>()
  const slotKey = (bgm: number, mapId: number, slot: MapBgmSlot) => `${bgm}|${mapId}|${slot}`

  const history = input.history ?? []
  const current = mapBgmCellsOf(input.master)
  const currentKeys = new Set(current.map((cell) => slotKey(cell.bgm, cell.mapId, cell.slot)))
  const openSpan = new Map(
    history.filter((span) => span.closed == null).map((span) => [slotKey(span.bgm, span.mapId, span.slot), span]),
  )
  for (const cell of current) {
    const span = openSpan.get(slotKey(cell.bgm, cell.mapId, cell.slot))
    slots.set(slotKey(cell.bgm, cell.mapId, cell.slot), {
      ...cell,
      current: true,
      firstSeen: span?.firstSeen ?? null,
      lastSeen: span?.lastSeen ?? null,
      archived: false,
    })
  }
  // 留存里的旧配法：同一格同一首曲多段就并成一条（最早见到～最后见到）；
  // 这首曲眼下又配回这一格了，就只按当前那段算，不再列成「曾用」
  for (const span of history) {
    const key = slotKey(span.bgm, span.mapId, span.slot)
    if (currentKeys.has(key)) continue
    const prev = slots.get(key)
    if (prev) {
      prev.firstSeen = Math.min(prev.firstSeen ?? span.firstSeen, span.firstSeen)
      prev.lastSeen = Math.max(prev.lastSeen ?? span.lastSeen, span.lastSeen)
      continue
    }
    slots.set(key, {
      mapId: span.mapId,
      slot: span.slot,
      bgm: span.bgm,
      current: false,
      firstSeen: span.firstSeen,
      lastSeen: span.lastSeen,
      archived: false,
    })
  }
  // 手抄留存只补前两份都没见过的图：留存开始之后撤场的活动图以账本为准
  const knownMaps = new Set([...current.map((cell) => cell.mapId), ...history.map((span) => span.mapId)])
  for (const cell of mapBgmCellsOf((input.archive ?? []).map(archiveAsMaster))) {
    if (knownMaps.has(cell.mapId)) continue
    slots.set(slotKey(cell.bgm, cell.mapId, cell.slot), {
      ...cell,
      current: false,
      firstSeen: null,
      lastSeen: null,
      archived: true,
    })
  }

  const maps = new Map<string, BgmMapUse>()
  for (const entry of slots.values()) {
    const mapKey = `${entry.bgm}|${entry.mapId}`
    let map = maps.get(mapKey)
    if (!map) {
      map = { mapId: entry.mapId, slots: [] }
      maps.set(mapKey, map)
      own('battle', entry.bgm).maps.push(map)
    }
    const { bgm: _bgm, mapId: _mapId, ...slot } = entry
    map.slots.push(slot)
  }
  for (const entry of usage.values()) {
    entry.maps.sort((a, b) => a.mapId - b.mapId)
    for (const map of entry.maps) map.slots.sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot))
  }

  for (const furniture of input.furniture ?? []) {
    const id = Number(furniture.id)
    const bgm = Number(furniture.bgmId)
    if (!(id > 0) || !(bgm > 0)) continue
    const entry = own('port', bgm)
    if (!entry.furniture.includes(id)) entry.furniture.push(id)
  }
  for (const entry of usage.values()) entry.furniture.sort((a, b) => a - b)
  return usage
}

/** 用到这首曲的地方共几处：每张图、每件家具各算一处，当前与曾用都算 */
export const bgmUsagePlaces = (usage: BgmUsage | null | undefined): number =>
  usage ? usage.maps.length + usage.furniture.length : 0

/**
 * 一张图上几个配曲位的叫法。海域页的 BGM 行与反查共用这一份：
 * 昼夜同曲合成一个词，别把同一首歌拆成两条。
 */
export const bgmSlotLabels = (slots: readonly MapBgmSlot[]): string[] => {
  const has = new Set(slots)
  const out: string[] = []
  if (has.has('moving')) out.push('海图')
  if (has.has('map-day') && has.has('map-night')) out.push('战斗')
  else {
    if (has.has('map-day')) out.push('昼战')
    if (has.has('map-night')) out.push('夜战')
  }
  if (has.has('boss-day') && has.has('boss-night')) out.push('Boss')
  else {
    if (has.has('boss-day')) out.push('Boss 昼')
    if (has.has('boss-night')) out.push('Boss 夜')
  }
  return out
}

/** 海域页那一行：一张图从海图到 Boss 依次用哪几首，昼夜同曲合并 */
export const mapBgmEntriesOf = (row: {
  api_moving_bgm?: number
  api_map_bgm?: readonly number[]
  api_boss_bgm?: readonly number[]
}): [string, number][] => {
  // 海图、道中、Boss 三段各自成组；同一段里昼夜同曲才合并，不同段同曲照样分开写
  const groups: [MapBgmSlot, unknown][][] = [
    [['moving', row.api_moving_bgm]],
    [['map-day', row.api_map_bgm?.[0]], ['map-night', row.api_map_bgm?.[1]]],
    [['boss-day', row.api_boss_bgm?.[0]], ['boss-night', row.api_boss_bgm?.[1]]],
  ]
  const out: [string, number][] = []
  for (const group of groups) {
    const bySong = new Map<number, MapBgmSlot[]>()
    for (const [slot, value] of group) {
      const bgm = Number(value) || 0
      if (bgm > 0) bySong.set(bgm, [...(bySong.get(bgm) ?? []), slot])
    }
    for (const [bgm, slots] of bySong) {
      for (const label of bgmSlotLabels(slots)) out.push([label, bgm])
    }
  }
  return out
}
