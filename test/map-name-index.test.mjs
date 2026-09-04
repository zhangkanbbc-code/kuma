import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-map-name-index-'))
const require = createRequire(import.meta.url)

const bundle = (source, name) => {
  const output = path.join(tempDir, `${name}.cjs`)
  buildSync({
    entryPoints: [fileURLToPath(new URL(source, import.meta.url))],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return require(output)
}

const matcher = bundle('../src/renderer/task-entity-match.ts', 'task-entity-match')
const mapIndex = bundle('../src/renderer/map-name-index.ts', 'map-name-index')
const opencc = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/opencc-t2s.json', import.meta.url), 'utf8'),
)
matcher.installTaskEntityFold(opencc.data.chars)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const maparea = [
  { api_id: 1, api_type: 0 },
  { api_id: 2, api_type: 0 },
  { api_id: 62, api_type: 1 },
]

const mapinfo = [
  { api_id: 12, api_maparea_id: 1, api_no: 2, api_name: '南西諸島沖' },
  { api_id: 15, api_maparea_id: 1, api_no: 5, api_name: '鎮守府近海' },
  { api_id: 16, api_maparea_id: 1, api_no: 6, api_name: '鎮守府近海航路' },
  { api_id: 21, api_maparea_id: 2, api_no: 1, api_name: '南西諸島近海' },
  { api_id: 621, api_maparea_id: 62, api_no: 1, api_name: '九州沖/南西諸島沖' },
]

const localized = new Map([
  [12, '南西群岛近海'],
  [15, '镇守府近海'],
  [16, '镇守府近海航路'],
  [21, '金兰半岛'],
  [621, '九州近海/南西诸岛近海'],
])

const entries = mapIndex.buildTaskMapNameIndex(
  mapinfo,
  maparea,
  (map) => localized.get(map.api_id) ?? map.api_name,
  matcher.normalizeTaskEntityText,
)

const matchedIds = (text) =>
  matcher.matchTaskEntityHits(entries, text, 2)
    .map((hit) => hit.entry.id)
    .sort((left, right) => left - right)

test('By7 的常规海域名不反查到同名段的活动图', () => {
  const text = '保护南西方面的运输航路安全！ 以旗舰为「轻巡 练巡 驱逐舰」，僚舰中有三艘「驱逐舰 海防舰」（其他自由）的舰队反复出击！确保镇守府近海、南西诸岛近海、镇守府近海航路的安全并进行对潜扫荡！ 年常任务(6月) 1-5 2-1 S胜各两次，1-6到达终点两次 需要轻巡洋舰/练习巡洋舰/驱逐舰旗舰+3驱逐舰/海防舰'
  assert.deepEqual(matchedIds(text), [15, 16, 21])
})

test('B4 的常规海域名不反查到同名段的活动图', () => {
  const text = '出击南西诸岛冲！ 在「1-2|南西群岛近海(1-2)」派出舰队出击，与敌舰队交战！ 出击一次'
  assert.deepEqual(matchedIds(text), [12])
})

test('活动图仍保留海域码与完整名，只让碰撞的名段退让', () => {
  const eventMap = entries.find((entry) => entry.id === 621)
  assert.ok(eventMap)
  for (const alias of ['62-1', '九州沖/南西諸島沖', '九州近海/南西诸岛近海']) {
    assert.ok(eventMap.aliases.includes(matcher.normalizeTaskEntityText(alias)), alias)
  }
  for (const alias of ['南西諸島沖', '南西诸岛近海']) {
    assert.ok(!eventMap.aliases.includes(matcher.normalizeTaskEntityText(alias)), alias)
  }
})
