#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fetchText, jstDate, loadMasterShipNames } from './map-intel.mjs'
import { kcwikiEventPageQuery } from './lib/map-intel-event-comps.mjs'
import { parseEventMapPage, compareEventMapIntel, correctEventMapGimmicks, correctEventMapRewards } from './lib/event-map-intel.mjs'
import { preserveFriendlyFleetHistory } from './lib/event-friendly-fleets-history.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const { values } = parseArgs({ options: {
  'from-file': { type: 'string' }, 'cache-dir': { type: 'string' },
  compare: { type: 'boolean', default: false },
  'compare-from': { type: 'string', default: path.join(ROOT, 'assets/lodes/map-intel.json') },
  output: { type: 'string', default: path.join(ROOT, 'assets/lodes/event-map-intel.json') },
  report: { type: 'string' },
} })
const config = read(path.join(ROOT, 'scripts/map-intel-events.json')).active
if (!config?.kcwikiPage) throw new Error('活动登记表缺 kcwikiPage')
const source = read(path.join(ROOT, 'scripts/lode-sources.json')).find((s) => s.id === 'event-map-intel')
const shipsPack = read(path.join(ROOT, 'assets/lodes/kcwiki-ships.json'))
const masterNames = loadMasterShipNames(ROOT) ?? Object.entries(config.masterShips ?? {})
const now = new Date()
const checkedAt = jstDate(now)
const revision = checkedAt.replaceAll('-', '.')
const maps = {}
const parsing = {}
for (const no of config.phases.flatMap((p) => p.maps)) {
  const page = `${config.kcwikiPage}/E-${no}`
  let html
  if (values['from-file']) {
    const input = path.resolve(ROOT, values['from-file'])
    const file = fs.existsSync(input) && fs.statSync(input).isDirectory()
      ? ['kcwiki-E' + no + '.json', 'E' + no + '.html'].map((name) => path.join(input, name)).find(fs.existsSync)
      : input.replaceAll('{no}', `${no}`)
    if (!file) throw new Error(`离线目录缺 E${no}`)
    const raw = fs.readFileSync(file, 'utf8')
    if (file.endsWith('.json')) {
      const parsed = JSON.parse(raw).parse
      if (parsed?.title !== page) throw new Error(`缓存页名不符：${parsed?.title} / ${page}`)
      html = parsed.text
    } else html = raw
  } else {
    const raw = await fetchText(kcwikiEventPageQuery(page), { minIntervalMs: 900 })
    const parsed = JSON.parse(raw).parse
    if (parsed?.title !== page) throw new Error(`返回页名不符：${parsed?.title}`)
    html = parsed.text
    if (values['cache-dir']) {
      const dir = path.resolve(ROOT, values['cache-dir'])
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `kcwiki-E${no}.json`), raw)
    }
  }
  if (typeof html !== 'string' || !html) throw new Error(`${page} 没有渲染文本`)
  const parsed = parseEventMapPage({ html, no, config, shipsPack, masterNames, checkedAt, revision })
  maps[`${config.mapAreaId}-${no}`] = parsed.map
  parsing[`E${no}`] = { rawComps: parsed.rawComps, issues: parsed.issues }
}
let data = { schemaVersion: 1, maps }
let comparison = null
if (values.compare) {
  const compared = compareEventMapIntel(data, read(path.resolve(ROOT, values['compare-from'])), read(path.join(ROOT, 'assets/lodes/event-bonus.json')))
  data = compared.data
  comparison = compared.report
}
const corrected = correctEventMapGimmicks(data)
const correctedRewards = correctEventMapRewards(corrected.data)
data = correctedRewards.data
const output = path.resolve(ROOT, values.output)
const previous = fs.existsSync(output) ? read(output) : null
const pack = { meta: {
  id: source.id, name: source.name, source: source.source, license: source.license,
  sourceUrl: source.url, version: revision, fetchedAt: now.toISOString(),
  note: source.note, maintainerNote: source.maintainerNote,
}, data: preserveFriendlyFleetHistory(data, previous) }
fs.writeFileSync(output, JSON.stringify(pack, null, 2) + '\n')
const counts = Object.fromEntries(Object.entries(data.maps).map(([code, map]) => [code, {
  difficulties: Object.fromEntries(Object.entries(map.difficulties).map(([d, l]) => [d, {
    nodes: Object.keys(l.nodes).length,
    enemyComps: Object.values(l.nodes).reduce((n, v) => n + v.enemyComps.length, 0),
    gimmicks: l.operations?.gimmicks?.length ?? 0,
    steps: l.operations?.gimmicks?.reduce((n, g) => n + g.steps.length, 0) ?? 0,
  }])), rewards: map.rewards.length, specialShips: map.operations?.specialShips?.length ?? 0,
  drops: Object.fromEntries(Object.entries(map.drops?.nodes ?? {}).map(([n, s]) => [n, s.length])),
  nodeDistances: map.operations?.nodeDistances ?? {},
}]))
if (values.report) fs.writeFileSync(path.resolve(ROOT, values.report), JSON.stringify({ parsing, counts, comparison, corrections: [...corrected.corrections, ...correctedRewards.corrections] }, null, 2) + '\n')
console.log(JSON.stringify({ output, counts, comparison: comparison && Object.fromEntries(Object.entries(comparison).map(([k, v]) => [k, v.length])) }, null, 2))
