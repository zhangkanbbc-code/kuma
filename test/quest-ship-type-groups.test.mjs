import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync, transformSync } from 'esbuild'
import { questEntityMaster } from './fixtures/quest-entity-master.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-quest-ship-types-'))
const output = path.join(temp, 'runtime.cjs')
buildSync({
  stdin: { contents: [
    'export * from "./src/shared/quest-ship-type-groups"',
    'export * from "./src/shared/quest-emphasis"',
    'export * from "./src/main/mg/quest-fleet-rules"',
    'export * from "./src/main/mg/kcwiki-quest-rules"',
    'export * from "./src/renderer/task-entity-index"',
    'export * from "./src/renderer/task-entity-match"',
    'export * from "./src/renderer/task-entity-marks"',
    'export * from "./src/renderer/quest-mark-html"',
    'export * from "./src/renderer/ship-category"',
  ].join('\n'), resolveDir: root },
  outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const runtime = createRequire(import.meta.url)(output)
const { QUEST_SHIP_TYPE_GROUPS: groups, STYPE_ALIASES } = runtime
test.after(() => fs.rmSync(temp, { recursive: true, force: true }))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const qn = read('src/renderer/modules/qn.ts')
const ji = read('src/renderer/modules/ji.ts')
// 沿用 qn 的原函数转译夹具：只隔离 DOM/Electron，执行线上函数本身。
const compile = (source, start, end, expression, deps) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `找不到渲染片段 ${start}`)
  const js = transformSync(`${source.slice(from, to)}\nreturn ${expression}`, { loader: 'ts' }).code
  return new Function(...Object.keys(deps), js)(...Object.values(deps))
}
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const elinkHtml = (type, id, inner) => `<span data-etype="${type}" data-eid="${id}">${inner}</span>`
const indexes = runtime.buildTaskEntityIndexes(questEntityMaster, (_domain, _id, name) => runtime.normalizeTaskEntityText(name))

test('任务舰种纯表的每个别名都存在于引擎，成员集合逐项相等', () => {
  assert.equal(groups.length, 4)
  assert.equal(new Set(groups.map((group) => group.key)).size, groups.length)
  assert.doesNotMatch(read('src/shared/quest-ship-type-groups.ts'), /^import\s/m)
  for (const group of groups) {
    assert.ok(group.stypes.length > 1)
    assert.equal(new Set(group.stypes).size, group.stypes.length)
    for (const alias of group.aliases) {
      assert.ok(Object.hasOwn(STYPE_ALIASES, alias), alias)
      assert.deepEqual([...group.stypes].sort((a, b) => a - b), [...STYPE_ALIASES[alias]].sort((a, b) => a - b), alias)
    }
  }
  assert.deepEqual(groups.find((group) => group.key === 'battleship').stypes, [8, 9, 10])
  assert.ok(!questEntityMaster.api_mst_ship.some((ship) => ship.api_sortno && ship.api_stype === 12))
})

const entityChips = compile(qn, 'const entityChipsHtml =', 'const expeditionDisplayName =', 'entityChipsHtml', {
  ...runtime, ...indexes, qp: null, simplifyJp: runtime.simplifyTaskEntityText,
  nationalityRangesInPackedText: () => [], mapIdsInText: () => [], mapIds: new Set(),
  matchedEntities: runtime.matchedTaskEntities, TASK_CATEGORIES: [],
  elink: (type, id, label) => elinkHtml(type, id, esc(label)),
})
const chipHtml = (desc) => entityChips({ id: 1, code: 'B1', name: '', desc, memo2: '', memo: '' })

test('所有泛称在涉及舰种与正文都链接到共享集合，重巡洋舰包含航巡', () => {
  for (const group of groups) {
    for (const alias of group.aliases) {
      const text = `编入${alias}两艘`
      const html = chipHtml(text)
      assert.ok(html.includes(elinkHtml('shipTypeGroup', group.stypes.join(','), group.label)), alias)
      const marks = runtime.taskEntityRawMarks(indexes, text, 'B1', [])
      const mark = marks.find((mark) => mark.kind === 'shipTypeGroup')
      assert.equal(mark?.ref, group.key, alias)
      assert.equal(text.slice(mark.start, mark.start + mark.length), alias)
      assert.ok(runtime.renderQuestMarkHtml(mark, esc(alias), elinkHtml)
        .includes(elinkHtml('shipTypeGroup', group.stypes.join(','), esc(alias))))
    }
  }
})

test('精确舰种保留单舰种目录链接，不把轻空母等拆成泛称', () => {
  for (const [alias, id] of [['轻空母', 7], ['轻母', 7], ['航巡', 6], ['装甲空母', 18], ['正规空母', 11], ['潜母', 14], ['雷巡', 4], ['航空战舰', 10], ['高速战舰', 8]]) {
    const text = `编入${alias}一艘`
    const html = chipHtml(text)
    assert.match(html, new RegExp(`data-etype="shipTypeCatalog" data-eid="${id}"`), alias)
    assert.doesNotMatch(html, /data-etype="shipTypeGroup"/, alias)
    const marks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(indexes, text, 'B1', []))
    assert.ok(marks.some((mark) => mark.kind === 'shipType' && mark.ref === id), alias)
    assert.ok(!marks.some((mark) => mark.kind === 'shipTypeGroup'), alias)
  }
  const mixed = chipHtml('编入轻空母、重巡洋舰与空母')
  for (const [type, id] of [['shipTypeCatalog', '7'], ['shipTypeGroup', '5,6'], ['shipTypeGroup', '7,11,18']]) {
    assert.ok(mixed.includes(`data-etype="${type}" data-eid="${id}"`))
  }
})

test('编成检查按引擎原组关联：舰队限制、同名组、具名舰与末尾限制不串位', () => {
  const fleetGoal = { fleetId: 2, maxShips: 6, disallowedStypes: [22], groups: [
    { label: '重巡洋舰', ships: [], stypes: [5, 6], amount: 2 },
    { label: '同名条件', ships: [70], stypes: [5, 6], amount: 1 },
    { label: '同名条件', ships: [], stypes: [2, 1], amount: 1 },
    { label: '轻空母', ships: [], stypes: [7], amount: 1 },
  ] }
  const qp = { trackers: { 1: { tasks: [], fleetGoal } }, progress: {}, serverFloors: {} }
  const diff = runtime.evaluateFleetGoal(fleetGoal, [], 1)
  const detail = compile(qn, 'const qpDetailHtml =', '// kcwiki 任务文本的道具名', 'qpDetailHtml', {
    qp, qpTaskGroups: () => [], mg: {}, esc, elinkHtml,
    fleetCheck: { 1: { diffs: [diff] } }, fleetCheckStaleHtml: () => '',
  })
  const html = detail({ id: 1 })
  assert.ok(html.includes(elinkHtml('shipTypeGroup', '5,6', '重巡洋舰')))
  assert.ok(html.includes(elinkHtml('shipTypeGroup', '2,1', '同名条件')))
  assert.ok(html.includes(elinkHtml('shipTypeGroup', '7', '轻空母')))
  assert.ok(!html.includes(elinkHtml('shipTypeGroup', '5,6', '同名条件')))
  assert.match(html, /同名条件 0\/1/)
  assert.equal((html.match(/data-etype="shipTypeGroup"/g) ?? []).length, 3)
})

test('qn 编成检查只渲染候选舰队，灰字只随引擎实际剔除结果出现', () => {
  const fleetGoal = { groups: [{ label: '轻巡', ships: [], stypes: [3], amount: 1 }] }
  const render = (check, goal = fleetGoal) => {
    const detail = compile(qn, 'const qpDetailHtml =', '// kcwiki 任务文本的道具名', 'qpDetailHtml', {
      qp: { trackers: { 1: { tasks: [], fleetGoal: goal } }, progress: {}, serverFloors: {} },
      qpTaskGroups: () => [], mg: {}, esc, elinkHtml,
      fleetCheck: check ? { 1: check } : {}, fleetCheckStaleHtml: () => '',
      fleetCheckPendingHtml: () => '当前编成读取中',
    })
    return detail({ id: 1 })
  }
  const diffs = [1, 2, 3, 4].map((id) => runtime.evaluateFleetGoal(fleetGoal, [], id))
  const combined = [{ deckId: 1, reason: 'combined' }, { deckId: 2, reason: 'combined' }]
  const guerrilla = [{ deckId: 3, reason: 'guerrilla' }]
  assert.doesNotMatch(render({ diffs }), /不参与常规出击判定/)
  assert.doesNotMatch(render(undefined), /不参与常规出击判定/)
  for (const excludedDecks of [combined, guerrilla, [...combined, ...guerrilla]]) {
    const remaining = diffs.filter((diff) => !excludedDecks.some((deck) => deck.deckId === diff.deckId))
    const html = render({ diffs: remaining, excludedDecks })
    for (const deck of excludedDecks) assert.ok(!html.includes(`<b>第${deck.deckId}舰队</b>`))
    for (const diff of remaining) assert.ok(html.includes(`<b>第${diff.deckId}舰队</b>`))
    assert.equal(html.includes('<div class="d-note">第 1／2 舰队为联合舰队，不参与常规出击判定</div>'), excludedDecks.includes(combined[0]))
    assert.equal(html.includes('<div class="d-note">第 3 舰队为游击部队（7 舰），不参与常规出击判定</div>'), excludedDecks.includes(guerrilla[0]))
  }
  const empty = render({ diffs: [], excludedDecks: [...combined, ...guerrilla] })
  assert.doesNotMatch(empty, /读取中|fleet-goal-row/)
  assert.match(empty, /不参与常规出击判定/)
  assert.match(render({ excludedDecks: combined }, null), /不参与常规出击判定/)
  assert.match(read('src/renderer/index.html'), /\.mod-qn \.d-note\s*\{[^}]*color: var\(--dim\)/)
})

test('要凑什么保留舰种链接与转义，具名舰不改，悬停与长度只读文字', () => {
  const fleetGoal = { groups: [
    { label: '重巡洋舰', ships: [], stypes: [5, 6], amount: 2 },
    { label: '驱逐舰/海防舰', ships: [], stypes: [2, 1], amount: 1 },
    { label: '「舰名」', ships: [1], stypes: [2], amount: 1 },
    { label: '<轻空母>', ships: [], stypes: [7], amount: 1 },
  ] }
  const fleetItems = compile(qn, 'const qpFleetNeedItems =', '\n\n', 'qpFleetNeedItems', { esc, elinkHtml })
  const items = fleetItems(fleetGoal)
  assert.equal(items[0], `${elinkHtml('shipTypeGroup', '5,6', '重巡洋舰')} ×2`)
  assert.equal(items[1], elinkHtml('shipTypeGroup', '2,1', '驱逐舰/海防舰'))
  assert.equal(items[2], '「舰名」')
  assert.equal(items[3], elinkHtml('shipTypeGroup', '7', esc('<轻空母>')))
  const need = compile(qn, 'const needVisualLen =', 'const qpStockCurrent =', '({ qpNeedHtml, needVisualLen })', {
    qp: { trackers: { 1: { fleetGoal, tasks: [] } } }, entityIndexVersion: 1,
    qpTaskGroups: () => [], esc, elinkHtml,
  })
  assert.equal(need.needVisualLen(items[0]), '重巡洋舰 ×2'.length)
  const html = need.qpNeedHtml({ id: 1 })
  const title = html.match(/title="([^"]*)"/)[1]
  assert.doesNotMatch(title, /<span|data-etype|data-eid/)
  assert.ok(title.includes('重巡洋舰 ×2'))
  assert.ok(html.includes(items[0]))
})

const catalogFixture = () => {
  const state = { chip: '全部', search: '', classFilter: 0, typeFilter: 0, nationalityFilter: 0, fleetFilter: '', questGroupFilter: '', typeSetFilter: [], open: true }
  const sets = new Map([[1, new Set([5, 6])], [2, new Set([6])], [3, new Set([16, 7])], [4, new Set([2])], [5, new Set([1])], [6, new Set([3, 4])]])
  const ships = new Map([...sets].map(([id, stypes]) => [id, { api_id: id, api_stype: [...stypes][0] }]))
  const stypes = { 1: '海防舰', 2: '驱逐舰', 5: '重巡洋舰', 6: '航空巡洋舰', 7: '轻空母', 8: '战舰', 9: '战舰', 10: '航空战舰', 11: '正规空母', 13: '潜水舰', 14: '潜水空母', 18: '装甲空母' }
  const deps = { ...runtime, shipState: state, chainStypeIndex: () => sets,
    chainOf: sets, friendlyShips: ships, chainInstances: () => [], esc,
    stypeLabelOf: (id) => stypes[id],
  }
  const clear = compile(ji, 'const clearShipDimensions =', 'const collapsedShipClasses =', 'clearShipDimensions', deps)
  let route
  let activated = 0
  let renders = 0
  compile(ji, "registerEntityRoute('shipTypeGroup'", "registerEntityRoute('shipNationality'", 'undefined', {
    ...deps, activeBook: '', clearShipDimensions: clear,
    activateModule: (id) => { assert.equal(id, 'ji'); activated++ }, render: () => { renders++ },
    registerEntityRoute: (_id, value) => { route = value },
  })
  const matches = compile(ji, 'const shipMatches =', 'const filteredRoots =', 'shipMatches', deps)
  const category = compile(ji, 'const shipQuestTypeCategoriesHtml =', '/**', 'shipQuestTypeCategoriesHtml', {
    ...deps, catPickedHtml: (key, label) => `<b data-clear-dim="${key}">${label}</b>`,
    catSectionHtml: (opts) => `${opts.label}${opts.picked}${opts.body}`,
  })
  return { state, route, clear, category, selected: () => [...ships.values()].filter(matches).map((ship) => ship.api_id), counts: () => [activated, renders] }
}

test('图鉴三级路由真执行：任务组优先，顶栏组照旧，任意集合与单舰种均激活并渲染', () => {
  const fixture = catalogFixture()
  for (const [id, key, chip, typeSet, selected, title, typeLabel] of [
    ['6,5,5', 'heavyCruiser', '全部', [], [1, 2], '重巡系', '任务舰种'],
    ['7,11,18', 'carrier', '全部', [], [3], '空母系', '任务舰种'],
    ['3,4,21', '', '轻巡', [], [6], '轻巡', '舰种组'],
    ['2,1', '', '全部', [2, 1], [4, 5], '驱逐舰/海防舰', '舰种组'],
    ['7', '', '全部', [7], [3], '轻空母', '舰种组'],
  ]) {
    fixture.route.open({ id })
    assert.equal(fixture.state.questGroupFilter, key)
    assert.equal(fixture.state.chip, chip)
    assert.deepEqual(fixture.state.typeSetFilter, typeSet)
    assert.deepEqual(fixture.selected(), selected)
    const peek = fixture.route.peek({ id })
    assert.equal(peek.title, title)
    assert.equal(peek.typeLabel, typeLabel)
    assert.match(peek.lines[0], new RegExp(`图鉴收录 ${selected.length} 艘`))
  }
  assert.deepEqual(fixture.counts(), [5, 5])
  fixture.clear()
  assert.equal(fixture.state.questGroupFilter, '')
  assert.deepEqual(fixture.state.typeSetFilter, [])
})

test('任务舰种格的收录数与根形态筛选一致，改造链跨舰种只计一次，选中项与成员提示可见', () => {
  const fixture = catalogFixture()
  for (const group of groups) {
    fixture.route.open({ id: group.stypes.join(',') })
    const html = fixture.category()
    assert.match(html, new RegExp(`class="cat-cell on" data-ship-quest-group="${group.key}"[^>]*>${group.label}<i>${fixture.selected().length}</i>`))
    assert.ok(html.includes(`<b data-clear-dim="questType">${group.label}</b>`))
  }
  assert.match(fixture.category(), /title="重巡洋舰 · 航空巡洋舰"/)
})
