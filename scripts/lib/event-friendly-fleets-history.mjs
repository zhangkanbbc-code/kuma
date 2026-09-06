import { jstDate } from '../map-intel.mjs'

// 当期表供铎继续读取；结束快照独立保存，下一期重建只替换当期表。
export const preserveFriendlyFleetHistory = (data, previous) => ({
  ...data,
  ...(previous?.data?.history ? { history: structuredClone(previous.data.history) } : {}),
})

export const archiveFriendlyFleetPack = (current, config, now = new Date()) => {
  const maps = Object.fromEntries(Object.entries(current.data.maps)
    .filter(([code]) => code.startsWith(`${config.mapAreaId}-`)))
  const expected = config.phases.flatMap((phase) => phase.maps)
    .map((no) => `${config.mapAreaId}-${no}`).sort()
  if (JSON.stringify(Object.keys(maps).sort()) !== JSON.stringify(expected)) {
    throw new Error(`友军包海图与活动 ${config.name} 登记不一致`)
  }
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
