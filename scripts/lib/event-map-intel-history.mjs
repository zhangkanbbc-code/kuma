import { jstDate } from '../map-intel.mjs'

export const archiveEventMapIntelPack = (current, config, now = new Date()) => {
  const maps = Object.fromEntries(Object.entries(current.data.maps)
    .filter(([code]) => code.startsWith(`${config.mapAreaId}-`)))
  const expected = config.phases.flatMap((phase) => phase.maps).map((no) => `${config.mapAreaId}-${no}`).sort()
  if (JSON.stringify(Object.keys(maps).sort()) !== JSON.stringify(expected)) throw new Error('活动海域包海图与登记不一致')
  const block = { name: config.name, mapAreaId: config.mapAreaId, status: 'ended', until: config.until, maps }
  const candidate = structuredClone(current)
  const history = candidate.data.history ??= []
  const index = history.findIndex((one) => one.mapAreaId === config.mapAreaId && one.name === config.name)
  if (index >= 0 && JSON.stringify(history[index]) === JSON.stringify(block)) return candidate
  if (index >= 0) history[index] = structuredClone(block)
  else history.push(structuredClone(block))
  candidate.meta.version = jstDate(now).replaceAll('-', '.')
  candidate.meta.fetchedAt = now.toISOString()
  return candidate
}
