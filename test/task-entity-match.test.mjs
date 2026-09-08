import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'
import { questEntityMaster } from './fixtures/quest-entity-master.mjs'
import { auditQuestEntities } from '../scripts/lib/quest-entity-audit.mjs'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-task-entity-match-'))
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

const auditOutput = path.join(tempDir, 'entity-index.cjs')
buildSync({ stdin: { contents: [
  'export * from "./src/renderer/task-entity-index"',
  'export * from "./src/renderer/task-entity-match"',
  'export * from "./src/renderer/task-entity-marks"',
  'export * from "./src/shared/quest-emphasis"',
  'export * from "./src/renderer/kcwiki-zh"',
  'export * from "./src/renderer/zh-simplify"',
].join('\n'), resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, outfile: auditOutput, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const runtime = require(auditOutput)
const lode = (name) => JSON.parse(fs.readFileSync(new URL(`../assets/lodes/${name}.json`, import.meta.url), 'utf8'))
const opencc = lode('opencc-t2s')
runtime.installTaskEntityFold(opencc.data.chars)
runtime.installZhSimplifier(opencc)
const entities = runtime.simplifyLocalizationEntities(lode('kcwiki-localization').data.entities)
const indexes = runtime.buildTaskEntityIndexes(questEntityMaster, (domain, id, name) => entities[domain]?.[id]?.zh || name, runtime.simplifyKcwikiExpeditionData(lode('kcwiki-expedition').data), runtime.simplifyKcwikiShipsData(lode('kcwiki-ships').data))
const quests = runtime.simplifyQuestScnData(lode('quests-scn').data)
const aliasTables = [['equip', 'equipNameIndex', runtime.TASK_EQUIP_TEXT_ALIASES], ['item', 'itemNameIndex', runtime.TASK_ITEM_TEXT_ALIASES]]

test('两张文本别名表每条都被真实标记器命中，且在完整主数据索引里只指向一个实体', () => {
  for (const [kind, key, table] of aliasTables) {
    for (const [id, aliases] of Object.entries(table)) {
      for (const alias of aliases) {
        const normalized = runtime.normalizeTaskEntityText(alias)
        const owners = Object.entries(indexes).flatMap(([indexKey, entries]) => entries.filter((entry) => entry.aliases.includes(normalized)).map((entry) => [indexKey, entry.id]))
        assert.deepEqual(owners, [[key, Number(id)]], alias)
        const text = `「${alias}」`
        const hit = runtime.markTaskEntityHits(indexes[key], text, 3, { allowQuotedSingle: true }).find((hit) => hit.entry.id === Number(id) && hit.start === 1 && hit.length === alias.length)
        assert.ok(hit, `${kind}/${id}: ${alias}`)
        const marks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, 'F1', []))
        assert.deepEqual(marks.map((mark) => [mark.kind, mark.ref]), [[kind, Number(id)]], alias)
      }
    }
  }
})

test('F116 完整炮名命中 502、普通炮 ×5 命中 7，长者先占位且正文区间不重叠', () => {
  const q = Object.values(quests).find((q) => q.code === 'F116')
  const text = runtime.cleanQuestText(q.desc).text
  const hits = runtime.markTaskEntityHits(indexes.equipNameIndex, text, 3)
  assert.ok(hits.some((hit) => hit.entry.id === 502 && hit.length === '35.6cm连装炮改三(炫光迷彩规格)'.length))
  assert.ok(hits.some((hit) => hit.entry.id === 7 && text.slice(hit.start + hit.length).startsWith('」×5')))
  const marks = runtime.mergeQuestMarks(runtime.spreadMarksToQuotes(text, runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, q.code, []))))
  const equips = marks.filter((mark) => mark.kind === 'equip')
  assert.deepEqual(equips.map((mark) => [mark.ref, text.slice(mark.start, mark.start + mark.length)]), [[502, '35.6cm连装炮改三(炫光迷彩规格)'], [7, '35.6cm连装炮']])
  assert.ok(!runtime.rangesOverlap(equips[0], equips[1]))
  assert.equal(text.slice(equips[1].start + equips[1].length, equips[1].start + equips[1].length + 3), '」×5')
  assert.ok(marks.some((mark) => mark.kind === 'item' && mark.ref === 75 && text.slice(mark.start, mark.start + mark.length) === '新型炮兵装资材'))
  assert.equal(runtime.normalizeTaskEntityText('（炫光迷彩规格）'), runtime.normalizeTaskEntityText('(炫光迷彩规格)'))
})

test('全库前后对拍：新增别名来自异常词条；原有整词命中不变，新增覆盖只落在明确别名处', () => {
  const beforeIndexes = { ...indexes }
  for (const [, key, table] of aliasTables) {
    beforeIndexes[key] = indexes[key].map((entry) => ({ ...entry, aliases: entry.aliases.filter((alias) => !(table[entry.id] ?? []).map(runtime.normalizeTaskEntityText).includes(alias)) }))
  }
  const before = auditQuestEntities(quests, beforeIndexes, runtime)
  const after = auditQuestEntities(quests, indexes, runtime)
  const anomalies = [...before.unmatched, ...before.partial].map((row) => runtime.normalizeTaskEntityText(row.term))
  for (const [kind, , table] of aliasTables) {
    for (const [id, aliases] of Object.entries(table)) {
      // 75 是任务书明确点名的无引号例外，下面另外核全部三处上下文。
      if (kind === 'item' && Number(id) === 75) continue
      for (const alias of aliases) assert.ok(anomalies.includes(runtime.normalizeTaskEntityText(alias)), alias)
    }
  }
  for (let i = 0; i < before.occurrences.length; i += 1) {
    if (before.occurrences[i].status === 'matched') assert.deepEqual(after.occurrences[i], before.occurrences[i])
  }
  let unquoted75 = 0
  for (const quest of Object.values(quests)) {
    for (const field of ['desc', 'memo2', 'memo']) {
      const { text } = runtime.cleanQuestText(quest[field] ?? '')
      const oldMarks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(beforeIndexes, text, quest.code, []))
      const newMarks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, quest.code, []))
      for (const mark of newMarks) {
        if (oldMarks.some((old) => JSON.stringify(old) === JSON.stringify(mark))) continue
        const table = aliasTables.find(([kind]) => kind === mark.kind)?.[2]
        const phrase = runtime.normalizeTaskEntityText(text.slice(mark.start, mark.start + mark.length))
        assert.ok((table?.[mark.ref] ?? []).map(runtime.normalizeTaskEntityText).includes(phrase), `${quest.code} ${field}: ${phrase}`)
        if (mark.kind === 'item' && mark.ref === 75) {
          assert.ok(['F76', 'F116'].includes(quest.code))
          unquoted75 += 1
        }
      }
    }
  }
  assert.equal(unquoted75, 3)
  // 任务舰种新增 6 处整词、1 处部分命中；两侧共用舰种索引，装备/道具增量仍逐条核对。
  assert.deepEqual(before.summary, { total: 2050, matched: 1776, unmatched: 225, partial: 49 })
  assert.deepEqual(after.summary, { total: 2050, matched: 1805, unmatched: 205, partial: 40 })
})

test('任务舰种新增的七处审计覆盖：六处整词；改装特务空母只标部分命中', () => {
  const audit = auditQuestEntities(quests, indexes, runtime)
  for (const [code, term, status, ref] of [
    ['A13', '战舰', 'matched', 'battleship'],
    ['B8', '战舰', 'matched', 'battleship'],
    ['Bm4', '战舰', 'matched', 'battleship'],
    ['B32', '战舰', 'matched', 'battleship'],
    ['By8', '航空母舰', 'matched', 'carrier'],
    ['By10', '航空母舰', 'matched', 'carrier'],
    ['Cy6', '改装特务空母', 'partial', 'carrier'],
  ]) {
    const row = audit.occurrences.find((row) => row.code === code && row.field === 'desc' && row.term === term)
    assert.equal(row?.status, status, code)
    assert.deepEqual(row.hits.map((hit) => [hit.kind, hit.ref]), [['shipTypeGroup', ref]], code)
  }
})

const quotedShortTerms = [
  ['彗星', 'equip', 24, '彗星', 8],
  ['瑞云', 'equip', 26, '瑞雲', 8],
  ['流星', 'equip', 18, '流星', 5],
  ['天山', 'equip', 17, '天山', 4],
  ['彩云', 'equip', 54, '彩雲', 3],
  ['紫云', 'equip', 118, '紫雲', 1],
  ['勋章', 'item', 57, '勲章', 4],
  ['烈风', 'equip', 22, '試製烈風 後期型', 2],
]
const quotePairs = [['「', '」'], ['『', '』'], ['"', '"'], ['“', '”']]
const shortOptions = { allowQuotedSingle: true }
const comparableHits = (hits) => hits.map(({ entry, alias, start, length }) => ({ entry, alias, start, length })).sort((left, right) => left.start - right.start)

test('四种成对引号内两字装备／道具名，两处匹配器同输入同结果且实体对应主数据', () => {
  for (const [term, kind, id, name] of quotedShortTerms) {
    const source = kind === 'equip' ? questEntityMaster.api_mst_slotitem : questEntityMaster.api_mst_useitem
    assert.equal(source.find((row) => row.api_id === id).api_name, name)
    const entries = kind === 'equip' ? indexes.equipNameIndex : indexes.itemNameIndex
    for (const [open, close] of quotePairs) {
      const text = `准备${open}${term}${close}`
      const hits = runtime.matchTaskEntityHits(entries, text, 3, shortOptions)
      assert.deepEqual(hits.map((hit) => [hit.entry.id, hit.start, hit.length]), [[id, 3, 2]], text)
      assert.deepEqual(comparableHits(runtime.markTaskEntityHits(entries, text, 3, shortOptions)), comparableHits(hits), text)
      assert.deepEqual(runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, 'F1', [])).map((mark) => [mark.kind, mark.ref]), [[kind, id]], text)
    }
  }
})

test('门槛 3 下无引号、错配引号、引号只包住更长词语的两字装备／道具名仍不命中', () => {
  for (const [term, kind] of quotedShortTerms) {
    const entries = kind === 'equip' ? indexes.equipNameIndex : indexes.itemNameIndex
    for (const match of [runtime.matchTaskEntityHits, runtime.markTaskEntityHits]) {
      assert.deepEqual(match(entries, `「${term}」`, 3), [], '默认不开短名口')
      for (const text of [`准备${term}`, `「${term}』`, `'${term}'`, `「${term}装备」`, `「${term}×2」`]) {
        assert.deepEqual(match(entries, text, 3, shortOptions), [], text)
      }
    }
  }
})

test('引号长装备名仍占完整区间，不被两字短名抢走', () => {
  const text = '准备「彗星一二型甲」'
  for (const match of [runtime.matchTaskEntityHits, runtime.markTaskEntityHits]) {
    const hits = match(indexes.equipNameIndex, text, 3, shortOptions)
    assert.deepEqual(hits.map((hit) => [hit.entry.id, hit.start, hit.length]), [[57, 3, 6]])
  }
  assert.deepEqual(runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, 'F1', [])).map((mark) => [mark.kind, mark.ref, mark.length]), [['equip', 57, 6]])
})

test('前面无引号或长名中的短名不能借后面的引号放行，芯片与正文定位同一处', () => {
  for (const text of ['彗星与「彗星」', '「彗星一二型甲」与「彗星」']) {
    const chips = runtime.matchTaskEntityHits(indexes.equipNameIndex, text, 3, shortOptions)
    const marks = runtime.markTaskEntityHits(indexes.equipNameIndex, text, 3, shortOptions)
    assert.deepEqual(comparableHits(chips), comparableHits(marks))
    const short = chips.find((hit) => hit.entry.id === 24)
    assert.ok(short)
    assert.equal(short.start, text.lastIndexOf('彗星'))
  }
})

test('舰娘一字引号规则保持：四种整词引号命中，无引号与长词片段拒绝', () => {
  const ships = [entry(37, '響', ['响'])]
  for (const match of [matcher.matchTaskEntityHits, matcher.markTaskEntityHits]) {
    for (const [open, close] of quotePairs) {
      assert.deepEqual(match(ships, `旗舰${open}响${close}`, 2, shortOptions).map((hit) => hit.entry.id), [37])
    }
    for (const text of ['旗舰响', '「响改」']) assert.deepEqual(match(ships, text, 2, shortOptions), [])
    assert.deepEqual(match(ships, '「响」', 2), [])
  }
})

test('全库短名规则前后对拍：仅新增八个两字词条 35 处，已有命中实体与部分命中不变', () => {
  // 还原本单之前正文装备／道具的门槛，不改索引别名与其它领域的匹配行为。
  const beforeIndexes = { ...indexes }
  for (const key of ['equipNameIndex', 'itemNameIndex']) {
    beforeIndexes[key] = indexes[key].map((entry) => ({ ...entry, aliases: entry.aliases.filter((alias) => alias.length >= 3) }))
  }
  const beforeRuntime = { ...runtime, taskEntityRawMarks: (_indexes, ...args) => runtime.taskEntityRawMarks(beforeIndexes, ...args) }
  const before = auditQuestEntities(quests, indexes, beforeRuntime)
  const after = auditQuestEntities(quests, indexes, runtime)
  assert.deepEqual(before.summary, { total: 2050, matched: 1770, unmatched: 240, partial: 40 })
  assert.deepEqual(after.summary, { total: 2050, matched: 1805, unmatched: 205, partial: 40 })
  const added = []
  for (let i = 0; i < before.occurrences.length; i += 1) {
    const old = before.occurrences[i]
    const current = after.occurrences[i]
    if (old.status === current.status) {
      assert.deepEqual(current, old)
      continue
    }
    assert.equal(old.status, 'unmatched')
    assert.equal(current.status, 'matched')
    const expected = quotedShortTerms.find(([term]) => term === current.term)
    assert.ok(expected, current.term)
    assert.deepEqual(current.hits.map((hit) => [hit.kind, hit.ref, hit.text]), [[expected[1], expected[2], current.term]])
    added.push(current)
  }
  for (const [term, , , , count] of quotedShortTerms) assert.equal(added.filter((row) => row.term === term).length, count, term)
  assert.equal(added.length, 35)
  for (const quest of Object.values(quests)) {
    for (const field of ['desc', 'memo2', 'memo']) {
      const { text } = runtime.cleanQuestText(quest[field] ?? '')
      const oldMarks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(beforeIndexes, text, quest.code, []))
      const newMarks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, quest.code, []))
      for (const mark of oldMarks) assert.ok(newMarks.some((current) => JSON.stringify(current) === JSON.stringify(mark)), `${quest.code} ${field}: 已有标记变化`)
      for (const mark of newMarks) {
        if (oldMarks.some((old) => JSON.stringify(old) === JSON.stringify(mark))) continue
        const term = text.slice(mark.start, mark.start + mark.length)
        assert.ok(quotedShortTerms.some(([expected, kind, id]) => expected === term && kind === mark.kind && id === mark.ref), `${quest.code} ${field}: ${term}`)
        assert.ok(runtime.isQuotedTaskAlias(text, term, mark.start))
      }
    }
  }
})

test('烈风别名在整套索引里唯一指向 22，结构化任务条件明确要求試製烈風 後期型 ×2', () => {
  assert.deepEqual(runtime.TASK_EQUIP_TEXT_ALIASES[22], ['烈风'])
  const owners = Object.entries(indexes).flatMap(([key, entries]) => entries.filter((entry) => entry.aliases.includes(runtime.normalizeTaskEntityText('烈风'))).map((entry) => [key, entry.id]))
  assert.deepEqual(owners, [['equipNameIndex', 22]])
  assert.equal(questEntityMaster.api_mst_slotitem.find((row) => row.api_id === 22).api_name, '試製烈風 後期型')
  assert.equal(questEntityMaster.api_mst_slotitem.find((row) => row.api_id === 53).api_name, '烈風 一一型')
  const requirements = lode('kcwiki-quest-req').data
  assert.deepEqual(requirements[616].scraps, [{ name: '試製烈風 後期型', amount: 2 }])
  assert.ok(requirements[651].equipments.some((equipment) => equipment.name === '試製烈風 後期型' && equipment.amount === 2))
})

for (const [code, field, term, id] of [
  ['F15', 'desc', '烈风', 22],
  ['F47', 'memo2', '烈风', 22],
  ['F80', 'memo', '烈风 一一型', 53],
  ['F87', 'desc', '試製烈風 後期型', 22],
]) {
  test(`${code} ${field} 原文「${term}」命中 ${id}，芯片与正文保持完整装备名`, () => {
    const quest = Object.values(lode('quests-scn').data).find((quest) => quest.code === code)
    assert.ok(quest[field].includes(term))
    const { text } = runtime.cleanQuestText(quest[field])
    if (term === '烈风') assert.ok(text.includes('「烈风」'))
    const chips = runtime.matchTaskEntityHits(indexes.equipNameIndex, text, 3, shortOptions).filter((hit) => [22, 53].includes(hit.entry.id))
    assert.deepEqual(chips.map((hit) => [hit.entry.id, hit.alias]), [[id, runtime.normalizeTaskEntityText(term)]])
    const marks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, code, [])).filter((mark) => mark.kind === 'equip' && [22, 53].includes(mark.ref))
    assert.deepEqual(marks.map((mark) => [mark.ref, text.slice(mark.start, mark.start + mark.length)]), [[id, term]])
  })
}

test('烈风别名前后全库对拍：仅 F15 desc、F47 memo2 两处新增命中 22，已有命中不换人', () => {
  const beforeIndexes = {
    ...indexes,
    equipNameIndex: indexes.equipNameIndex.map((entry) => entry.id === 22 ? { ...entry, aliases: entry.aliases.filter((alias) => alias !== '烈风') } : entry),
  }
  const before = auditQuestEntities(quests, beforeIndexes, runtime)
  const after = auditQuestEntities(quests, indexes, runtime)
  assert.deepEqual(before.summary, { total: 2050, matched: 1803, unmatched: 207, partial: 40 })
  assert.deepEqual(after.summary, { total: 2050, matched: 1805, unmatched: 205, partial: 40 })
  assert.equal(after.occurrences.length, before.occurrences.length)
  const added = []
  for (let i = 0; i < before.occurrences.length; i += 1) {
    const old = before.occurrences[i]
    const current = after.occurrences[i]
    if (old.status === current.status) {
      assert.deepEqual(current, old)
      continue
    }
    assert.equal(old.status, 'unmatched')
    assert.equal(current.status, 'matched')
    assert.equal(current.term, '烈风')
    assert.deepEqual(current.hits.map((hit) => [hit.kind, hit.ref, hit.text]), [['equip', 22, '烈风']])
    added.push([current.code, current.field])
  }
  assert.deepEqual(added, [['F15', 'desc'], ['F47', 'memo2']])
  const newMarks = []
  for (const quest of Object.values(quests)) {
    for (const field of ['desc', 'memo2', 'memo']) {
      const { text } = runtime.cleanQuestText(quest[field] ?? '')
      const oldMarks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(beforeIndexes, text, quest.code, []))
      const currentMarks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, quest.code, []))
      for (const mark of oldMarks) assert.ok(currentMarks.some((current) => JSON.stringify(current) === JSON.stringify(mark)), `${quest.code} ${field}: 已有标记变化`)
      for (const mark of currentMarks) {
        if (oldMarks.some((old) => JSON.stringify(old) === JSON.stringify(mark))) continue
        assert.deepEqual([mark.kind, mark.ref, text.slice(mark.start, mark.start + mark.length)], ['equip', 22, '烈风'])
        newMarks.push([quest.code, field])
      }
    }
  }
  assert.deepEqual(newMarks, [['F15', 'desc'], ['F47', 'memo2']])
})
