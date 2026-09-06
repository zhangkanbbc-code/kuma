#!/usr/bin/env node
// 独立更新友军表，避免连带重抓敌编成、掉落与倍卡。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fetchText, jstDate, loadMasterShipNames } from './map-intel.mjs'
import { kcwikiEventPageQuery } from './lib/map-intel-event-comps.mjs'
import { parseEventFriendlyFleets, tagEventFriendlyFleets } from './lib/event-friendly-fleets.mjs'
import { preserveFriendlyFleetHistory } from './lib/event-friendly-fleets-history.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: {
  'from-file': { type: 'string' },
  'tags-from': { type: 'string', default: 'assets/lodes/map-intel.json' },
} })
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/map-intel-events.json'), 'utf8')).active
if (!config?.kcwikiPage) throw new Error('活动登记表缺 kcwikiPage')
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/lode-sources.json'), 'utf8'))
  .find((one) => one.id === 'event-friendly-fleets')
const html = values['from-file']
  ? fs.readFileSync(path.resolve(ROOT, values['from-file']), 'utf8')
  : JSON.parse(await fetchText(kcwikiEventPageQuery(config.kcwikiPage), { minIntervalMs: 900 }))?.parse?.text
if (typeof html !== 'string' || !html) throw new Error('舰娘百科没有渲染文本')
const ships = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lodes/kcwiki-ships.json'), 'utf8'))
// 沿用 fetch-map-intel-event 的主数据名表补全；只按原文等名解号，不写别名或手工 ID。
const masterNames = loadMasterShipNames(ROOT) ?? []
const { data, unresolved } = parseEventFriendlyFleets(html, ships, config.mapAreaId, masterNames)
if (unresolved.length) {
  throw new Error(`舰名未命中，拒绝出包（原文）：\n${unresolved.map((one) => `${one.map}: ${one.name}`).join('\n')}`)
}
const expected = config.phases.flatMap((phase) => phase.maps).map((no) => `${config.mapAreaId}-${no}`).sort()
if (JSON.stringify(Object.keys(data.maps).sort()) !== JSON.stringify(expected)) {
  throw new Error(`友军表海图与活动登记不一致：${Object.keys(data.maps).join('、')}`)
}
const now = new Date()
const tagsPath = path.resolve(ROOT, values['tags-from'])
let tagged = { data, report: null }
if (fs.existsSync(tagsPath)) {
  tagged = tagEventFriendlyFleets(data, JSON.parse(fs.readFileSync(tagsPath, 'utf8')))
} else {
  console.log(`标注参考不存在，跳过强弱与波次标注：${tagsPath}`)
}
const out = path.join(ROOT, 'assets/lodes/event-friendly-fleets.json')
const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null
const pack = {
  meta: {
    id: source.id, name: source.name, version: jstDate(now).replaceAll('-', '.'),
    source: source.source,
    sourceUrl: `https://zh.kcwiki.cn/wiki/${encodeURI(config.kcwikiPage)}`,
    fetchedAt: now.toISOString(), license: source.license,
    note: source.note,
    maintainerNote: source.maintainerNote,
  },
  data: preserveFriendlyFleetHistory(tagged.data, previous),
}
fs.writeFileSync(out, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
console.log(`已写出 ${out}`)
for (const [map, entry] of Object.entries(data.maps)) console.log(`${map}: ${entry.friendlyFleets.length} 组；${entry.point}`)
console.log('舰名未命中：0')
if (tagged.report) {
  const names = (one) => one.ships.map((ship) => ship.name ?? `#${ship.id}`).join(' · ')
  for (const [map, result] of Object.entries(tagged.report)) {
    console.log(`${map}: kcwiki ${result.total} / 指纹命中 ${result.matched} / 已标注 ${result.tagged} / 未标注 ${result.total - result.tagged} / 未命中 ${result.unmatched.length} / 冲突 ${result.conflicts.length} / 两表强弱不同 ${result.strengthDifferences.length} / 参考独有 ${result.extra.length}`)
    for (const one of result.unmatched) console.log(`  未命中：${names(one)}`)
    for (const one of result.conflicts) console.log(`  冲突：${names(one)} → ${JSON.stringify(one.notes)}`)
    for (const one of result.strengthDifferences) console.log(`  两表强弱不同（按本队表取值，仍须通过冲突检查）：${names(one)} → ${one.difficulties.join('、')} ${JSON.stringify(one.notes)}`)
    for (const one of result.invalidNotes) console.log(`  非允许 note：${names(one)} → ${JSON.stringify(one.notes)}`)
    for (const one of result.extra) console.log(`  参考独有：${names(one)} → ${JSON.stringify(one.notes)}`)
    for (const one of result.flagshipDifferences) console.log(`  旗舰不同：${names(one)} → 参考旗舰 id ${one.differentFlagships.join('、')}`)
  }
}
