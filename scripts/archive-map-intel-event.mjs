// 官方确认活动结束后：先把 map-intel-events.json 的 status 改为 ended 并填写 until，
// 再运行本脚本冻结当前活动层。历史仍保留，运行时不会联网。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { jstDate } from './map-intel.mjs'
import {
  assertNoPendingMapIntelCandidate,
  stageMapIntelCandidate,
} from './map-intel-review.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const config = JSON.parse(
  readFileSync(path.join(root, 'scripts', 'map-intel-events.json'), 'utf8'),
).active
if (config?.status !== 'ended' || !/^\d{4}-\d{2}-\d{2}$/.test(config.until ?? '')) {
  throw new Error('请先在 scripts/map-intel-events.json 将 active.status 改为 ended 并填写 until')
}

const output = path.join(root, 'assets', 'lodes', 'map-intel.json')
assertNoPendingMapIntelCandidate(output, process.argv.includes('--force'))
const current = JSON.parse(readFileSync(output, 'utf8'))
const candidate = structuredClone(current)
let changed = 0
for (const [code, map] of Object.entries(candidate.data.maps)) {
  if (!code.startsWith(`${config.mapAreaId}-`) || map.event?.name !== config.name) continue
  map.event = { ...map.event, status: 'ended', until: config.until }
  changed++
}
if (!changed) throw new Error(`正式包里没有找到活动 ${config.name}`)
const now = new Date()
candidate.meta.version = jstDate(now).replaceAll('-', '.')
candidate.meta.fetchedAt = now.toISOString()
// 玩家可见（lodeCredit 的「源」悬停）：结束日对玩家有意义，留着；
//「确认结束并冻结」是流水线状态，不写。维护者备忘见 scripts/lode-sources.json。
candidate.meta.note = `${config.name} 已于 ${config.until} 结束，这一份是活动期间留下的记录`
console.log(`[lodes] ${config.name}：${changed} 张活动图转为结束归档候选`)
stageMapIntelCandidate(output, current, candidate)
