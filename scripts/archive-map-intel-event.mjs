// 官方确认活动结束后：先把 map-intel-events.json 的 status 改为 ended 并填写 until，
// 再运行本脚本冻结当前活动层。历史仍保留，运行时不会联网。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { jstDate } from './map-intel.mjs'
import { archiveFriendlyFleetPack } from './lib/event-friendly-fleets-history.mjs'
import { archiveEventMapIntelPack } from './lib/event-map-intel-history.mjs'
import {
  assertNoPendingMapIntelCandidate,
  matchesPendingEventArchive,
  stageMapIntelCandidate,
} from './map-intel-review.mjs'

export const archiveMapIntelEvent = (root, { force = false, now = new Date() } = {}) => {
  const config = JSON.parse(
    readFileSync(path.join(root, 'scripts', 'map-intel-events.json'), 'utf8'),
  ).active
  if (config?.status !== 'ended' || !/^\d{4}-\d{2}-\d{2}$/.test(config.until ?? '')) {
    throw new Error('请先在 scripts/map-intel-events.json 将 active.status 改为 ended 并填写 until')
  }

  const output = path.join(root, 'assets', 'lodes', 'map-intel.json')
  const current = JSON.parse(readFileSync(output, 'utf8'))
  const candidate = structuredClone(current)
  let matched = 0
  for (const [code, map] of Object.entries(candidate.data.maps)) {
    if (!code.startsWith(`${config.mapAreaId}-`) || map.event?.name !== config.name) continue
    map.event = { ...map.event, status: 'ended', until: config.until }
    matched++
  }
  if (!matched) throw new Error(`正式包里没有找到活动 ${config.name}`)
  // 玩家可见（lodeCredit 的「源」悬停）：结束日对玩家有意义，留着；
  //「确认结束并冻结」是流水线状态，不写。维护者备忘见 scripts/lode-sources.json。
  candidate.meta.note = `${config.name} 已于 ${config.until} 结束，这一份是活动期间留下的记录`
  if (JSON.stringify(candidate) !== JSON.stringify(current)) {
    candidate.meta.version = jstDate(now).replaceAll('-', '.')
    candidate.meta.fetchedAt = now.toISOString()
  }
  const friendlyCurrent = JSON.parse(readFileSync(path.join(root, 'assets', 'lodes', 'event-friendly-fleets.json'), 'utf8'))
  const friendlyFleets = { current: friendlyCurrent, candidate: archiveFriendlyFleetPack(friendlyCurrent, config, now) }
  const eventCurrent = JSON.parse(readFileSync(path.join(root, 'assets', 'lodes', 'event-map-intel.json'), 'utf8'))
  const eventMapIntel = { current: eventCurrent, candidate: archiveEventMapIntelPack(eventCurrent, config, now) }
  if (matchesPendingEventArchive(output, current, candidate, friendlyFleets, eventMapIntel)) {
    console.log(`[lodes] ${config.name}：结束归档候选未变`)
    return
  }
  assertNoPendingMapIntelCandidate(output, force)
  if (JSON.stringify(current) === JSON.stringify(candidate) &&
      JSON.stringify(friendlyCurrent) === JSON.stringify(friendlyFleets.candidate) &&
      JSON.stringify(eventCurrent) === JSON.stringify(eventMapIntel.candidate)) {
    console.log(`[lodes] ${config.name}：三包已归档，无需改动`)
    return
  }
  console.log(`[lodes] ${config.name}：${matched} 张活动图、友军表与活动海域随包资料转为结束归档候选`)
  return stageMapIntelCandidate(output, current, candidate, friendlyFleets, eventMapIntel)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  archiveMapIntelEvent(path.join(fileURLToPath(import.meta.url), '..', '..'), { force: process.argv.includes('--force') })
}
