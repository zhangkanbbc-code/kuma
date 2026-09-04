import { detectEventAreas } from '../shared/event-area'
import type { TaskEntityIndex } from './task-entity-match'

export type TaskMapNameIndexEntry = TaskEntityIndex

export const buildTaskMapNameIndex = (
  mapInfos: readonly any[] | null | undefined,
  mapAreas: readonly any[] | null | undefined,
  localizedName: (map: any) => string,
  normalize: (text: string) => string,
): TaskMapNameIndexEntry[] => {
  const maps = mapInfos ?? []
  const eventAreaIds = detectEventAreas(mapAreas, maps).eventAreaIds
  const rows = maps.map((map) => {
    const code = `${map.api_maparea_id}-${map.api_no}`
    const localized = localizedName(map)
    const nameSegments = [map.api_name, localized]
      .flatMap((name) => `${name}`.split(/[／/]/))
      .map((name) => name.trim())
      .filter((name) => name.length >= 2)
    return {
      map,
      code,
      fullAliases: [map.api_name, localized, code]
        .map((name) => normalize(`${name ?? ''}`))
        .filter(Boolean),
      segmentAliases: nameSegments.map(normalize).filter(Boolean),
    }
  })

  const regularAliases = new Set(
    rows
      .filter(({ map }) => !eventAreaIds.has(map.api_maparea_id))
      .flatMap(({ fullAliases, segmentAliases }) => [...fullAliases, ...segmentAliases]),
  )

  return rows.map(({ map, code, fullAliases, segmentAliases }) => {
    // 活动图的完整图名与海域码仍可反查，只让撞上常规图别名的斜线名段退让。
    // 62-1「九州沖/南西諸島沖」的完整名照留，但「南西諸島沖」段撞 1-2；
    // 其中文名的「南西诸岛近海」段又撞 2-1，两段都不能把常规任务带到活动图。
    const allowedSegments = eventAreaIds.has(map.api_maparea_id)
      ? segmentAliases.filter((alias) => !regularAliases.has(alias))
      : segmentAliases
    const aliases = [...new Set([...fullAliases, ...allowedSegments])]
      .sort((left, right) => right.length - left.length)
    return {
      id: Number(map.api_id),
      name: code,
      simple: normalize(code),
      aliases,
    }
  })
}
