import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-task-entity-match-'))
const output = path.join(tempDir, 'task-entity-match.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/task-entity-match.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const matcher = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

test('task entity folding extends JP2CN with the OpenCC character table', () => {
  matcher.installTaskEntityFold(null)
  assert.equal(matcher.normalizeTaskEntityText('戦艦'), '战舰')

  const opencc = JSON.parse(
    fs.readFileSync(new URL('../assets/lodes/opencc-t2s.json', import.meta.url), 'utf8'),
  )
  matcher.installTaskEntityFold(opencc.data.chars)
  assert.equal(matcher.normalizeTaskEntityText('南西諸島近海'), '南西诸岛近海')
  assert.equal(matcher.normalizeTaskEntityText('南西諸島防衛線'), '南西诸岛防卫线')
  assert.equal(matcher.normalizeTaskEntityText('東部オリョール海'), '东部オリョール海')

  const source = '南西諸島近海'
  const aligned = matcher.alignedTaskEntityText(source)
  assert.notEqual(aligned, null)
  assert.equal(aligned.length, source.length)
  matcher.installTaskEntityFold(null)
})

const entry = (id, name, aliases = [name]) => ({
  id,
  name,
  simple: aliases[0],
  aliases,
})

test('task entity matching rejects ordinary words that collide with ship names', () => {
  const ships = [
    entry(885, '胜利'),
    entry(895, '昭南'),
  ]
  assert.deepEqual(
    matcher.matchTaskEntityHits(ships, '出击胜利一次', 2, {
      acceptAlias: matcher.allowTaskShipAlias,
    }),
    [],
  )
  assert.deepEqual(
    matcher.matchTaskEntityHits(ships, '旗舰「胜利」出击', 2, {
      acceptAlias: matcher.allowTaskShipAlias,
    }).map((hit) => hit.entry.id),
    [885],
  )
  assert.deepEqual(
    matcher.matchTaskEntityHits(ships, '在演习中取得8次「胜利」', 2, {
      acceptAlias: matcher.allowTaskShipAlias,
    }),
    [],
  )
  assert.deepEqual(
    matcher.matchTaskEntityHits(ships, '突破昭南本土航路', 2, {
      acceptAlias: matcher.allowTaskShipAlias,
    }),
    [],
  )
})

test('task entity matching distinguishes equipment shorthand from fleet phrases', () => {
  const equipTypes = [
    entry(6, '舰载战斗机', ['舰战']),
    entry(45, '水上战斗机', ['水战']),
    entry(48, '局地战斗机', ['陆战']),
  ]
  for (const text of ['战舰战队，出击', '编成一水战', '登陆战用装备']) {
    assert.deepEqual(
      matcher.matchTaskEntityHits(equipTypes, text, 2, {
        acceptAlias: matcher.allowTaskEquipTypeAlias,
      }),
      [],
    )
  }
  assert.deepEqual(
    matcher.matchTaskEntityHits(equipTypes, '废弃「舰战」与「水战」装备', 2, {
      acceptAlias: matcher.allowTaskEquipTypeAlias,
    }).map((hit) => hit.entry.id),
    [6, 45],
  )
})

test('task entity matching removes identical-span duplicates', () => {
  const duplicateTypes = [
    entry(8, '高速战舰', ['战舰']),
    entry(9, '低速战舰', ['战舰']),
  ]
  assert.equal(matcher.matchTaskEntityHits(duplicateTypes, '战舰两艘', 2).length, 1)
})

test('task entity matching keeps enemy supply ships out of the friendly catalog', () => {
  const supply = [entry(22, '补给舰')]
  assert.deepEqual(
    matcher.matchTaskEntityHits(supply, '击沉敌方补给舰三艘', 2, {
      acceptAlias: matcher.allowTaskShipTypeAlias,
    }),
    [],
  )
  assert.deepEqual(
    matcher.matchTaskEntityHits(supply, '编入补给舰一艘', 2, {
      acceptAlias: matcher.allowTaskShipTypeAlias,
    }).map((hit) => hit.entry.id),
    [22],
  )
})

test('same-name consumables do not duplicate their equipment entity', () => {
  const equipment = matcher.matchTaskEntityHits(
    [entry(145, '战斗粮食')],
    '准备战斗粮食三个',
    2,
  )
  const items = matcher.matchTaskEntityHits(
    [entry(66, '战斗粮食')],
    '准备战斗粮食三个',
    2,
  )
  assert.deepEqual(matcher.excludeTaskHitsCoveredByAliases(items, equipment), [])
})

test('task entity memo cleaning excludes recommendations and prerequisite chatter', () => {
  assert.equal(
    matcher.taskEntityMemoText('包含四艘驱逐舰。2-4推荐两种方案，单水战二连'),
    '包含四艘驱逐舰。2-4',
  )
  assert.equal(
    matcher.taskEntityMemoText('需要在季常刷新后做完Dw2（东京急行一次） 注意装备需要解锁'),
    '',
  )
  assert.equal(
    matcher.taskEntityMemoText('旗舰为大和改二。奖励建议：后期甲板优先'),
    '旗舰为大和改二。',
  )
})

test('map and expedition text matching is limited to compatible quest categories', () => {
  assert.equal(matcher.taskEntityTextDomainAllowed('map', 'Bq6'), true)
  assert.equal(matcher.taskEntityTextDomainAllowed('map', 'D13'), false)
  assert.equal(matcher.taskEntityTextDomainAllowed('map', 'Fq2'), false)
  assert.equal(matcher.taskEntityTextDomainAllowed('expedition', 'D31'), true)
  assert.equal(matcher.taskEntityTextDomainAllowed('expedition', 'Bw3'), false)
  assert.equal(matcher.taskEntityTextDomainAllowed('expedition', 'Cm1'), false)
})

test('task nationality matching recognizes full names and compact allied-country lists', () => {
  assert.deepEqual(
    matcher.matchTaskNationalityHits('编成包括3只以上美英澳荷出身舰娘').map((hit) => hit.entry.id),
    [4, 5, 12, 11],
  )
  assert.deepEqual(
    matcher.matchTaskNationalityHits('以美・英舰艇组成联合水上舰队').map((hit) => hit.entry.id),
    [4, 5],
  )
  assert.deepEqual(
    matcher.matchTaskNationalityHits('美军（USS）舰娘与法国舰艇出击').map((hit) => hit.entry.id),
    [4, 4, 6],
  )
  assert.deepEqual(
    matcher.matchTaskNationalityHits('由意大利舰艇组成编队').map((hit) => hit.entry.id),
    [3],
  )
  assert.deepEqual(
    matcher.matchTaskNationalityHits('包含任意英国和美国舰娘共三艘').map((hit) => hit.entry.id),
    [5, 4],
  )
})

test('task nationality matching does not color ordinary Chinese word fragments', () => {
  for (const text of ['准备美味的补给品', '计数无法达成', '突破日本海航路', '将意大利编入舰队']) {
    assert.deepEqual(matcher.matchTaskNationalityHits(text), [])
  }
})
