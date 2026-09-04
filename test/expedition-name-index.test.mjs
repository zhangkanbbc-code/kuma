import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-expedition-name-index-'))
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
const expeditionIndex = bundle(
  '../src/renderer/expedition-name-index.ts',
  'expedition-name-index',
)
const opencc = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/opencc-t2s.json', import.meta.url), 'utf8'),
)
matcher.installTaskEntityFold(opencc.data.chars)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

const missions = [
  { api_id: 3, api_disp_no: '03', api_name: '警備任務' },
  { api_id: 100, api_disp_no: 'A1', api_name: '兵站強化任務' },
]
const lodeData = {
  3: { nameJp: '警備任務', nameZh: '第三远征中文名' },
  A1: { nameJp: '兵站強化任務', nameZh: 'A1 远征中文名' },
}
const registrations = []
const entries = expeditionIndex.buildTaskExpeditionNameIndex(
  missions,
  lodeData,
  (mission) => mission.api_name,
  (mission, nameZh) => registrations.push([mission.api_id, nameZh]),
  matcher.normalizeTaskEntityText,
)

test('数字 dispNo 去前导零后查远征译名并登记中文名', () => {
  const mission = entries.find((entry) => entry.id === 3)
  assert.ok(mission)
  assert.ok(mission.aliases.includes(matcher.normalizeTaskEntityText('第三远征中文名')))
  assert.ok(mission.aliases.includes('3'))
  assert.ok(!mission.aliases.includes('03'))
  assert.deepEqual(registrations.find(([id]) => id === 3), [3, '第三远征中文名'])
})

test('字母 dispNo 以原样键查远征译名', () => {
  const mission = entries.find((entry) => entry.id === 100)
  assert.ok(mission)
  assert.ok(mission.aliases.includes(matcher.normalizeTaskEntityText('A1 远征中文名')))
  assert.ok(mission.aliases.includes('a1'))
  assert.deepEqual(registrations.find(([id]) => id === 100), [100, 'A1 远征中文名'])
})
