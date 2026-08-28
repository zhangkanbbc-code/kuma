import type { AirBaseSquad } from '../../shared/mg-types'

// 基地航空队一条中队。半径新版是 {api_base, api_bonus}，老版是数字——两种都吃。
export const toAirBase = (raw: any, ts: number, fallbackArea = 0): AirBaseSquad => {
  const distanceRaw = raw?.api_distance
  const distance =
    typeof distanceRaw === 'object' && distanceRaw
      ? (distanceRaw.api_base ?? 0) + (distanceRaw.api_bonus ?? 0)
      : (distanceRaw ?? 0)
  return {
    areaId: raw?.api_area_id ?? fallbackArea,
    rid: raw?.api_rid ?? 0,
    ts,
    name: raw?.api_name ?? '',
    actionKind: raw?.api_action_kind ?? 0,
    distance,
    planes: (raw?.api_plane_info ?? []).map((plane: any) => ({
      slotId: plane?.api_slotid ?? 0,
      count: plane?.api_count ?? 0,
      maxCount: plane?.api_max_count ?? 0,
      state: plane?.api_state ?? 0,
      cond: plane?.api_cond ?? 0,
    })),
  }
}

const uniqueAirBases = (squads: AirBaseSquad[]): AirBaseSquad[] => {
  const byKey = new Map<string, AirBaseSquad>()
  for (const squad of squads) byKey.set(`${squad.areaId}:${squad.rid}`, squad)
  return [...byKey.values()]
}

// mapinfo 的 api_air_base 一次给出 6/7 图与当前活动的完整陆航快照。
export const replaceAirBases = (rows: any[], ts: number): AirBaseSquad[] =>
  uniqueAirBases(rows.map((row) => toAirBase(row, ts)))

// 少数版本/操作仍可能调用独立接口；该接口按海域刷新，只替换对应区域。
export const mergeAirBases = (
  existing: AirBaseSquad[],
  rows: any[],
  requestedArea: number,
  ts: number,
): AirBaseSquad[] => {
  const incoming = rows.map((row) => toAirBase(row, ts, requestedArea))
  const refreshedAreas = new Set(incoming.map((squad) => squad.areaId).filter((id) => id > 0))
  if (requestedArea > 0) refreshedAreas.add(requestedArea)
  const kept = refreshedAreas.size
    ? existing.filter((squad) => !refreshedAreas.has(squad.areaId))
    : []
  return uniqueAirBases([...kept, ...incoming])
}
