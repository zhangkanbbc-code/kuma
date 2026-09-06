import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'
import { remodelRuntime } from '../scripts/lib/remodel-fact-runtime.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import { nativeFields, resolveMaterial } from '../scripts/lib/remodel-fact-audit.mjs'
import { MAINTAINER_REMODEL_CORRECTIONS, classifyRemodelStage, parseRemodelStageColumns, reconcileStagedRemodel, wikiwikiStageObservations, parseCcConversionTable } from '../scripts/lib/remodel-stages.mjs'
import { remodelCycles, remodelStagesFor } from '../src/shared/remodel-stage.ts'
import validation from '../dist/main/lode-validation.js'
import { PLAYER_VIEW_WHITELIST } from './fixtures/player-view-whitelist.mjs'

const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'))
const fixture = read('./fixtures/remodel-facts.json'), pack = read('../assets/lodes/remodel-facts.json')
const kc = read('../assets/lodes/kcwiki-ships.json').data
const runtime = remodelRuntime(fixture.raw, kc, { facts: pack })
const sampleRaw = { ...fixture.raw, api_mst_ship: fixture.raw.api_mst_ship.filter(s => [501, 506].includes(s.api_id)), api_mst_shipupgrade: [
  { api_id: 506, api_current_ship_id: 501 }, { api_id: 501, api_current_ship_id: 506 },
] }
const samplePack = { data: { '501→506': { stages: { first: { 'useitem:2': 60, 'useitem:3': 45 }, convert: { 'useitem:2': 40, 'useitem:3': 15 } } } } }
const histories = new Map([
  [11, { hasEvents: true, afterMstIds: [506] }],
  [12, { hasEvents: true, afterMstIds: [501] }],
  [13, { hasEvents: false, afterMstIds: [] }],
])
const singleEntryEdges = [
  '73→501', '112→462', '117→555', '121→502', '129→503', '130→504', '136→911', '151→593',
  '215→652', '248→463', '253→464', '277→594', '278→698', '285→894', '288→461', '293→622',
  '307→663', '318→883', '325→955', '369→588', '390→903', '438→545', '692→628',
]

for (const edge of singleEntryEdges) test(`单向进入 ${edge}：无账本仅初次，真实需求照常计入`, () => {
  const [from, to] = edge.split('→').map(Number)
  const raw = Object.values(kc).find(s => s.ID === from)?.改造?.图纸
  const rt = remodelRuntime(fixture.raw, kc, { facts: pack }, {
    topLevelInstanceOf: id => id === from ? { id: 1, lv: 99 } : undefined,
  })
  const result = rt.needChipsHtml(raw, to, from, 1)
  assert.deepEqual(result.stages.map(g => g.stage), ['first'])
  assert.equal(result.stages[0].missing, false)
  assert.doesNotMatch(result.html, /往复|素材待补/)
  rt.buildRemodelNeeds()
  for (const need of result.needs.filter(n => n.kind === 'useitem')) {
    assert.equal(rt.useitemDemand(need.id).queueNeed, need.count, `${edge}/${need.id}`)
    assert.equal(rt.useitemDemand(need.id).queueShips, 1)
    assert.equal(rt.useitemDemand(need.id).switchNeed, 0)
  }
  if (edge === '73→501') assert.equal(rt.useitemDemand(58).queueNeed, 1)
})

test('单向进入穷举23边62格；19格表外素材及43个原生chip只归初次', () => {
  const entries = fixture.raw.api_mst_shipupgrade.filter(r => r.api_current_ship_id > 0 &&
    fixture.groups.some(g => g.includes(r.api_id)) &&
    !fixture.groups.some(g => g.includes(r.api_current_ship_id) && g.includes(r.api_id)))
    .map(r => `${r.api_current_ship_id}→${r.api_id}`)
  assert.deepEqual(entries.sort(), [...singleEntryEdges].sort())
  const needs = singleEntryEdges.flatMap(edge => {
    const [from, to] = edge.split('→').map(Number)
    return runtime.needChipsHtml(Object.values(kc).find(s => s.ID === from)?.改造?.图纸, to, from).needs
  })
  assert.equal(needs.length, 62)
  assert.ok(needs.every(n => n.stage === 'first'))
  assert.equal(needs.filter(n => nativeFields[`${n.kind}:${n.id}`]).length, 43)
  assert.equal(needs.filter(n => !nativeFields[`${n.kind}:${n.id}`]).length, 19)
  // 不显式给来路时仍须用选中的前进升级行判档。
  assert.deepEqual(runtime.needChipsHtml(null, 501).stages.map(g => g.stage), ['first'])
})

test('循环内所有方向无账本仍为两档，覆盖502⇄507及三形态循环', () => {
  for (const row of fixture.raw.api_mst_shipupgrade.filter(r =>
    fixture.groups.some(g => g.includes(r.api_current_ship_id) && g.includes(r.api_id)))) {
    assert.deepEqual(runtime.needChipsHtml(null, row.api_id, row.api_current_ship_id).stages.map(g => g.stage),
      ['first', 'convert'], `${row.api_current_ship_id}→${row.api_id}`)
  }
})

test('555边逐档消费对拍；HEAD旧输出冻结，白名单不扩张', () => {
  assert.equal(fixture.baselineHead, '176de57822f51c6376fc76b08868acc18a76b306')
  assert.equal(Object.keys(fixture.stageBaseline).length, 555)
  assert.equal(Object.keys(pack.data).length, 142)
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../assets/lodes/kcwiki-ships.json', import.meta.url))).digest('hex'), fixture.sourceHashes.kcwiki)
  for (const [edge, expected] of Object.entries(fixture.output)) {
    const [from, to] = edge.split('→').map(Number)
    const result = runtime.needChipsHtml(Object.values(kc).find(s => s.ID === from)?.改造?.图纸, to, from)
    assert.deepEqual(Object.fromEntries(result.stages.map(g => [g.stage, { missing: g.missing, needs: Object.fromEntries(g.needs.map(n => [`${n.kind}:${n.id ?? n.name}`, n.count])) }])), expected, edge)
  }
  for (const diff of fixture.differences) {
    assert.equal(diff.oldValue, fixture.stageBaseline[diff.edge]?.[diff.identity] ?? null)
    assert.equal(diff.newValue, fixture.output[diff.edge][diff.stage].needs[diff.identity] ?? null)
    // 只允许受分档影响的目标；普通不可换装边不可夹带改动。
    const target = Number(diff.edge.split('→')[1])
    assert.ok(fixture.groups.some(g => g.includes(target)), JSON.stringify(diff))
  }
  assert.equal(PLAYER_VIEW_WHITELIST.some(r => r.domain === '改造需求chip'), false)
})

test('事实形状只认已分档素材；身份、整数、未知档及空档校验', () => {
  assert.equal(validation.validateLodePack(pack).ok, true)
  for (const data of [
    { '215→652': { 'useitem:2': 55 } },
    ...[-1, 1.5, '5'].map(value => ({ '215→652': { stages: { first: { 'useitem:2': value } } } })),
    { '215→215': { stages: { first: { 'useitem:2': 5 } } } },
    { '215/652': { stages: { first: { 'useitem:2': 5 } } } },
    { '215→652': { stages: { unknown: { 'useitem:2': 5 } } } },
    { '215→652': { stages: { first: { prose: '需求说明' } } } },
    { '215→652': { stages: { first: {} } } }, { '215→652': { stages: {} } },
  ]) assert.equal(validation.validateLodePack({ ...pack, data }).ok, false, JSON.stringify(data))
  for (const [edge, row] of Object.entries(pack.data)) {
    const [from, to] = edge.split('→').map(Number)
    const native = fixture.raw.api_mst_shipupgrade.find(s => s.api_current_ship_id === from && s.api_id === to)
    if (!fixture.groups.some(g => g.includes(from) && g.includes(to))) assert.deepEqual(Object.keys(row.stages), ['first'])
    for (const materials of Object.values(row.stages)) for (const identity of Object.keys(materials)) assert.ok(!native || !Object.hasOwn(native, nativeFields[identity]))
  }
  for (const r of fixture.conflicts) if (r.resolution === undefined) assert.equal(pack.data[r.edge]?.stages?.[r.stage]?.[r.identity], undefined)
})

test('初回与2回目以降按列分开；单列无标注为档不明且生成器不收', () => {
  const html = '<table><tr><th>初回</th><th>2回目以降／コンバート</th></tr><tr><td>開発資材x45 + 高速建造材x60</td><td>開発資材x15 + 高速建造材x40</td></tr></table>'
  const parsed = parseRemodelStageColumns(html, fixture.raw)
  assert.deepEqual(parsed.map(r => [r.stage, r.materials]), [['first', { 'useitem:3': 45, 'useitem:2': 60 }], ['convert', { 'useitem:3': 15, 'useitem:2': 40 }]])
  assert.equal(classifyRemodelStage('初回／2回目以降'), 'unknown')
  assert.equal(parseRemodelStageColumns('<table><tr><th>换装</th></tr><tr><td>開発資材x15</td></tr></table>', fixture.raw)[0].stage, 'convert')
  const merged = html.replace('<tr><th>初回', '<tr><th colspan="2">必要資材</th></tr><tr><th>初回')
  assert.deepEqual(parseRemodelStageColumns(merged, fixture.raw).map(r => r.stage), ['first', 'convert'])
  const single = '<table><tr><th>改造素材</th></tr><tr><td>開発資材x999</td></tr></table>'
  assert.equal(parseRemodelStageColumns(single, fixture.raw)[0].stage, 'unknown')
  const result = reconcileStagedRemodel({}, {}, fixture.raw, '==可以进行转换改装的舰船==\n{|\n!\n|-\n!\n|}', [], [
    { html, edge: '501→506', site: 'wikiwiki', evidence: 'test:columns' },
    { html: single, edge: '501→506', site: 'kcwiki', evidence: 'test:single' },
  ])
  assert.deepEqual(result.data['501→506'], samplePack.data['501→506'])
  assert.equal(result.unknown.find(r => r.edge === '501→506').materials['useitem:3'], 999)
})

test('主数据穷举21直接对与3三形态循环，不把单向进入边当往复对', () => {
  const edges = fixture.raw.api_mst_shipupgrade.map(r => [r.api_current_ship_id, r.api_id])
  assert.deepEqual(remodelCycles(edges), fixture.groups)
  assert.equal(fixture.direct.length, 21)
  assert.deepEqual(fixture.groups.filter(g => g.length > 2), [[610, 646, 698], [622, 623, 624], [645, 650, 699]])
  assert.deepEqual(remodelStagesFor(false, 975), ['first'])
})

test('运行时按roster：到过往复、未到过初次、无事件/无实例两档并列', () => {
  const rt = remodelRuntime(sampleRaw, {}, { facts: samplePack }, { remodelHistories: histories })
  const seen = rt.needChipsHtml('高速建造材x999', 506, 501, 11)
  assert.deepEqual(seen.stages.map(g => g.stage), ['convert'])
  assert.equal(seen.needs.find(n => n.id === 2).count, 40)
  assert.match(seen.html, /往复/)
  assert.doesNotMatch(seen.html, /初次|999/)
  const first = rt.needChipsHtml(null, 506, 501, 12)
  assert.deepEqual(first.stages.map(g => g.stage), ['first'])
  assert.equal(first.needs.find(n => n.id === 2).count, 60)
  for (const roster of [13, undefined]) {
    const both = rt.needChipsHtml(null, 506, 501, roster)
    assert.deepEqual(both.stages.map(g => g.stage), ['first', 'convert'])
    assert.match(both.html, /初次.*60.*往复.*40/s)
    assert.match(both.html, /这艘舰第一次改装为此形态时的消耗。/)
    assert.match(both.html, /这艘舰曾改装为此形态，再次换装时的消耗。/)
  }
})

test('三隈正向初次按画面收40/35、往复不变；回程脚注40/15不串到初次', () => {
  const rt = remodelRuntime(fixture.raw, kc, { facts: pack }, { remodelHistories: new Map([[1, { hasEvents: true, afterMstIds: [] }], [2, { hasEvents: true, afterMstIds: [507] }]]) })
  const first = rt.needChipsHtml('开发资材x35 高速建造材x40', 507, 502, 1)
  assert.deepEqual(pack.data['502→507'].stages, {
    first: { 'useitem:2': 40, 'useitem:3': 35 }, convert: { 'useitem:2': 40, 'useitem:3': 35 },
  })
  assert.deepEqual(first.stages.map(g => g.stage), ['first'])
  assert.equal(first.needs.find(n => n.id === 2).count, 40)
  assert.equal(first.needs.find(n => n.id === 3).count, 35)
  assert.equal(first.needs.find(n => n.id === 94).count, 1)
  assert.doesNotMatch(first.html, /素材待补/)
  const back = rt.needChipsHtml(null, 507, 502, 2)
  assert.equal(back.needs.find(n => n.id === 2).count, 40)
  assert.equal(back.needs.find(n => n.id === 3).count, 35)
  assert.equal(back.needs.find(n => n.id === 94).count, 1)
  assert.deepEqual(pack.data['507→502'], { stages: { convert: { 'useitem:2': 40, 'useitem:3': 15 } } })
  const reverse = rt.needChipsHtml(null, 502, 507)
  assert.equal(reverse.stages.find(g => g.stage === 'first').needs.some(n => n.id === 2 || n.id === 3), false)
  assert.deepEqual(Object.fromEntries(reverse.stages.find(g => g.stage === 'convert').needs.filter(n => n.id === 2 || n.id === 3).map(n => [n.id, n.count])), { 2: 40, 3: 15 })
  assert.deepEqual(fixture.conflicts.filter(r => r.edge === '502→507').map(r => [r.stage, r.identity, r.values]), [
    ['first', 'useitem:2', { wikiwiki: 40, kcwiki: 40, kcwikiPage: 60 }],
    ['first', 'useitem:3', { wikiwiki: 45, kcwiki: 35, kcwikiPage: 45 }],
  ])
  assert.deepEqual(fixture.sourceErrors.filter(r => r.site === 'kcwikiTable').map(r => [r.edge, r.materials]), [
    ['502→507', { 'useitem:2': 40, 'useitem:3': 15 }], ['507→502', { 'useitem:2': 30, 'useitem:3': 45 }],
  ])
  assert.ok(pack.meta.evidence.some(r => r.edge === '502→507' && r.stage === 'convert' && r.sources.some(s => s.evidence?.includes('https://zekamashi.net/kancolle-kouryaku/singatakoukuu/'))))
})

test('三隈画面订正有维护者证据与日期，原始冲突已裁且错误来源单列', () => {
  const [correction] = MAINTAINER_REMODEL_CORRECTIONS
  assert.deepEqual(pack.meta.corrections, [correction])
  assert.equal(correction.basis, 'maintainer')
  assert.equal(correction.date, '2026-09-06')
  assert.match(correction.evidence, /公开游戏改装画面（2026-09 核）.*新型兵装資材1／高速建造材40／開発資材35/)
  const conflicts = fixture.conflicts.filter(r => r.edge === correction.edge && r.stage === correction.stage)
  assert.equal(conflicts.length, 2)
  for (const row of conflicts) {
    assert.deepEqual(row.resolution, { status: '已裁（画面证据）', count: correction.materials[row.identity],
      basis: correction.basis, evidence: correction.evidence, date: correction.date })
    assert.ok(pack.meta.evidence.find(r => r.edge === row.edge && r.stage === row.stage && r.identity === row.identity)
      .sources.some(s => s.basis === 'maintainer' && s.evidence === correction.evidence && s.date === correction.date))
  }
  assert.deepEqual(fixture.sourceErrors.filter(r => r.stage === 'first').map(r => [r.edge, r.site, r.materials]), [
    ['502→507', 'wikiwiki', { 'useitem:3': 45 }], ['502→507', 'kcwikiPage', { 'useitem:2': 60, 'useitem:3': 45 }],
  ])
  const native = pack.meta.evidence.find(r => r.edge === '502→507' && r.stage === 'first' && r.identity === 'useitem:94')
  assert.deepEqual(native.apiCheck, { field: 'api_arms_mat_count', count: 1 })
  assert.equal(pack.data['502→507'].stages.first['useitem:94'], undefined)
})

test('API显式零封住两档事实；逐边API行不串来路；事实显式零封旧包', () => {
  const raw = { ...sampleRaw, api_mst_shipupgrade: [{ api_id: 506, api_current_ship_id: 501, api_drawing_count: 0 }, sampleRaw.api_mst_shipupgrade[1]] }
  const facts = { data: { '501→506': { stages: { first: { 'useitem:58': 9 }, convert: { 'useitem:58': 8 } } }, '506→501': { stages: { convert: { 'useitem:58': 2 } } } } }
  const rt = remodelRuntime(raw, {}, { facts })
  assert.equal(rt.needChipsHtml('改装设计图x9', 506, 501).needs.length, 0)
  // store 会将原生行的数量字段规范成显式零；另一条不存在原生行的来路才由事实补充。
  facts.data['9999→506'] = { stages: { first: { 'useitem:58': 2 } } }
  assert.equal(rt.needChipsHtml(null, 506, 9999).needs.find(n => n.id === 58).count, 2)
  delete facts.data['9999→506']
  assert.equal(rt.needChipsHtml(null, 506, 9999).needs.length, 0)
  const noncycle = { ...sampleRaw, api_mst_shipupgrade: [] }
  const zero = remodelRuntime(noncycle, {}, { facts: { data: { '501→506': { stages: { first: { 'useitem:2': 0 } } } } } })
  assert.equal(zero.needChipsHtml('高速建造材x99', 506, 501).needs.length, 0)
})

test('需求反查与chip共享判档；未知历史两档不相加计入合计', () => {
  for (const [roster, expected] of [[11, 40], [12, 60], [13, 0]]) {
    const rt = remodelRuntime(sampleRaw, {}, { facts: samplePack }, { remodelHistories: histories, topLevelInstanceOf: id => id === 501 ? { id: roster, lv: 999 } : undefined })
    rt.buildRemodelNeeds()
    const demand = rt.useitemDemand(2)
    assert.equal(demand.switchNeed, expected)
    assert.equal(demand.queueNeed, 0)
    assert.equal(demand.switchShips, roster === 13 ? 0 : 1)
    assert.equal(demand.usages, roster === 13 ? 2 : 1)
  }
})

test('旧解析身份修正保留，球磨进入初次55、春雨改修资材5去重', () => {
  assert.equal(resolveMaterial('高速建造剤', fixture.raw).id, 2)
  assert.equal(resolveMaterial('改修资材', fixture.raw).id, 4)
  assert.equal(resolveMaterial('新型高温高压锅炉', fixture.raw).kind, 'slotitem')
  assert.equal(resolveMaterial('不存在的素材', fixture.raw), null)
  const kuma = runtime.needChipsHtml(kc['039a']?.改造?.图纸, 652, 215)
  assert.equal(kuma.stages.find(g => g.stage === 'first').needs.find(n => n.id === 2).count, 55)
  assert.equal(runtime.needChipsHtml('改修资材x5', 975, 323).needs.filter(n => n.id === 4).length, 1)
  assert.equal(fixture.corrections.length, 4)
  assert.equal(fixture.corrections.find(r => r.edge === '652→657').stage, 'first')
})

test('来源折叠区：三层全无才待补，有事实/API/kcwiki任一层均不挂牌', () => {
  const raw = { api_mst_ship: [], api_mst_shipupgrade: [], api_mst_useitem: [], api_mst_slotitem: [] }
  const absent = remodelRuntime(raw, {}, {})
  assert.match(absent.shipSourceFootHtml(false), /改造资料包待补/)
  assert.equal(absent.needChipsHtml(null, 652, 215).html, '')
  for (const packs of [{ facts: pack }, { kcwiki: { meta: { name: '舰娘百科' } } }]) assert.doesNotMatch(remodelRuntime(raw, {}, packs).shipSourceFootHtml(false), /改造资料包待补/)
  assert.doesNotMatch(runtime.shipSourceFootHtml(false), /改造资料包待补/)
})

test('既有queryShipLife真实SQL：改装摘要跨分页、隔离roster、无事件明确区分', () => {
  const source = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  const start = source.indexOf('  queryShipLife = (rosterId:'), end = source.indexOf('\n  /**', start)
  assert.ok(start > 0 && end > start)
  const code = transformSync(`return new class { constructor(db) { this.db = db } ${source.slice(start, end)} }(db)`, { loader: 'ts' }).code
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE ship_life_state (roster_id INTEGER, first_seen INTEGER, last_seen INTEGER);
      CREATE TABLE ship_life_events (id INTEGER PRIMARY KEY, roster_id INTEGER, ts INTEGER, kind TEXT, exp_delta INTEGER, map INTEGER, cell INTEGER, rank TEXT, is_boss INTEGER, practice INTEGER, mvp INTEGER, detail TEXT, damage_taken INTEGER, taiha INTEGER, damage_dealt INTEGER);`)
    const insert = db.prepare('INSERT INTO ship_life_events (roster_id,ts,kind,detail) VALUES (?,?,?,?)')
    insert.run(11, 1, 'remodel', '{"afterMstId":506}')
    for (let i = 2; i < 102; i++) insert.run(11, i, 'battle', '{}')
    insert.run(12, 1, 'remodel', '{"afterMstId":501}')
    insert.run(12, 2, 'battle', '{"afterMstId":506}')
    insert.run(14, 1, 'battle', '{}')
    const ledger = new Function('db', code)(db)
    const seen = ledger.queryShipLife(11, 1)
    assert.equal(seen.events.length, 1)
    assert.equal(seen.events[0].kind, 'battle')
    assert.deepEqual(seen.remodelHistory, histories.get(11))
    assert.deepEqual(ledger.queryShipLife(12, 1).remodelHistory, histories.get(12))
    assert.deepEqual(ledger.queryShipLife(13, 1).remodelHistory, histories.get(13))
    assert.deepEqual(ledger.queryShipLife(14, 1).remodelHistory, { hasEvents: true, afterMstIds: [] })
  } finally { db.close() }
})

test('账本异步刷新沿用queryShipLife，旧请求不能覆盖改装后的新判档', async () => {
  const calls = [], pending = [], cache = new Map([[11, histories.get(11)]])
  const state = { master: { upgrades: { 506: [{ currentShipId: 501 }], 501: [{ currentShipId: 506 }] } }, ships: { 11: { id: 11, shipId: 501 } } }
  let builds = 0
  const rt = runtimeHost().extract('src/renderer/modules/ji.ts', ['refreshRemodelHistories'], {
    mg: state, friendlyShips: new Map(sampleRaw.api_mst_ship.map(s => [s.api_id, s])), remodelHistories: cache,
    buildRemodelNeeds: () => { builds++ },
    queryShipLife: (id, limit) => { calls.push([id, limit]); return new Promise(resolve => pending.push(resolve)) },
  }).api
  const old = rt.refreshRemodelHistories()
  assert.equal(cache.size, 0)
  state.ships[11].shipId = 506
  const newer = rt.refreshRemodelHistories()
  pending[1]({ remodelHistory: histories.get(12) })
  await newer
  pending[0]({ remodelHistory: histories.get(11) })
  await old
  assert.deepEqual(cache.get(11), histories.get(12))
  assert.deepEqual(calls, [[11, 1], [11, 1]])
  assert.equal(builds, 3)
})

const emptyConversionTable = '==可以进行转换改装的舰船==\n{|\n!\n|-\n!\n|}'
const wikiNeed = count => [{ kind: 'useitem', id: 2, nameJp: '高速建造材', count }]

test('维护者订正只命中502→507初次的高建和开发，不扩散到往复、反向、邻边或其他素材', () => {
  const column = label => `<table><tr><th>${label}</th></tr><tr><td>高速建造材x60 + 開発資材x45 + 改修資材x7</td></tr></table>`
  const tables = [
    { edge: '502→507', html: column('初回'), site: 'wikiwiki' },
    { edge: '502→507', html: column('2回目以降'), site: 'wikiwiki' },
    { edge: '507→502', html: column('初回'), site: 'wikiwiki' },
    { edge: '501→506', html: column('初回'), site: 'wikiwiki' },
  ]
  const before = structuredClone(tables)
  const result = reconcileStagedRemodel({}, {}, fixture.raw, emptyConversionTable, [], tables)
  assert.deepEqual(tables, before)
  assert.deepEqual(result.data['502→507'].stages.first, { 'useitem:2': 40, 'useitem:3': 35, 'useitem:4': 7 })
  assert.deepEqual(result.data['502→507'].stages.convert, { 'useitem:4': 7 })
  for (const edge of ['507→502', '501→506']) {
    assert.deepEqual(result.data[edge].stages.first, { 'useitem:2': 60, 'useitem:3': 45, 'useitem:4': 7 })
  }
  assert.ok(result.conflicts.filter(r => r.stage === 'convert').every(r => r.resolution === undefined))
  assert.deepEqual(result.sourceErrors.map(r => [r.edge, r.stage, r.materials]), [
    ['502→507', 'first', { 'useitem:2': 60, 'useitem:3': 45 }],
  ])
  const withoutFirst = reconcileStagedRemodel({}, {}, fixture.raw, emptyConversionTable, [], tables.slice(1))
  assert.equal(withoutFirst.data['502→507'].stages.first, undefined)
  assert.equal(withoutFirst.sourceErrors.length, 0)
})

test('生成器不收单向进入边的convert，即使来源明确写了往复档', () => {
  const raw = { ...sampleRaw, api_mst_ship: [...sampleRaw.api_mst_ship, { api_id: 73, api_aftershipid: '501' }],
    api_mst_shipupgrade: [...sampleRaw.api_mst_shipupgrade, { api_current_ship_id: 73, api_id: 501 }] }
  const wiki = { 501: { fromShipId: 73, needs: wikiNeed(60), edges: [
    { fromShipId: 73, source: 'footnote', needs: wikiNeed(40) },
  ] } }
  const result = reconcileStagedRemodel({}, wiki, raw, emptyConversionTable)
  assert.deepEqual(result.data['73→501'], { stages: { first: { 'useitem:2': 60 } } })
  assert.ok(result.observations.some(r => r.edge === '73→501' && r.stage === 'convert'))
  for (const rows of [result.evidence, result.conflicts, result.missing]) {
    assert.equal(rows.some(r => r.edge === '73→501' && r.stage === 'convert'), false)
  }
})

test('wikiwiki结构：主条目为first，footnote为convert；同边两档不先合并', () => {
  const wiki = { 506: { targetShipId: 506, fromShipId: 501, needs: wikiNeed(60), raw: 'Lv90', edges: [
    { fromShipId: 501, needs: wikiNeed(40), source: 'footnote', raw: '费用补充' },
  ] } }
  const parsed = wikiwikiStageObservations(wiki, sampleRaw)
  assert.deepEqual(parsed.observations.map(r => [r.edge, r.stage, r.materials]), [
    ['501→506', 'first', { 'useitem:2': 60 }], ['501→506', 'convert', { 'useitem:2': 40 }],
  ])
  const result = reconcileStagedRemodel({}, wiki, sampleRaw, emptyConversionTable)
  assert.deepEqual(result.data['501→506'], { stages: { first: { 'useitem:2': 60 }, convert: { 'useitem:2': 40 } } })
  assert.ok(result.evidence.every(r => r.sources.every(s => s.basis)))
})

test('wikiwiki无footnote只有first；raw写返回也不覆盖主条目结构', () => {
  const wiki = { 506: { fromShipId: 501, needs: wikiNeed(60), raw: '戻す場合／再度／2回目' } }
  const result = reconcileStagedRemodel({}, wiki, sampleRaw, emptyConversionTable)
  assert.deepEqual(result.data['501→506'], { stages: { first: { 'useitem:2': 60 } } })
  assert.equal(result.evidence.find(r => r.edge === '501→506').sources[0].raw, wiki[506].raw)
})

test('同一对两个方向都可独立有初次和往复，主条目不得挪到另一个来路', () => {
  const wiki = { 506: { fromShipId: 501, needs: wikiNeed(60), edges: [{ fromShipId: 501, source: 'footnote', needs: wikiNeed(40) }] },
    501: { fromShipId: 506, needs: wikiNeed(70), edges: [{ fromShipId: 506, source: 'footnote', needs: wikiNeed(30) }] } }
  const result = reconcileStagedRemodel({}, wiki, sampleRaw, emptyConversionTable)
  assert.deepEqual(result.data['506→501'], { stages: { first: { 'useitem:2': 70 }, convert: { 'useitem:2': 30 } } })
  assert.equal(result.data['501→506'].stages.first['useitem:2'], 60)
})

test('百科单列同值归wikiwiki档，异值记录同档冲突，两档同值分别佐证', () => {
  const wiki = { 506: { fromShipId: 501, needs: wikiNeed(60), edges: [{ fromShipId: 501, source: 'footnote', needs: wikiNeed(40) }] } }
  const module = count => ({ x: { ID: 501, 改造: { 图纸: '高速建造材x' + count } } })
  assert.equal(reconcileStagedRemodel(module(40), wiki, sampleRaw, emptyConversionTable).observations.find(r => r.site === 'kcwiki').stage, 'convert')
  delete wiki[506].edges
  const conflict = reconcileStagedRemodel(module(50), wiki, sampleRaw, emptyConversionTable)
  assert.equal(conflict.conflicts[0].stage, 'first')
  assert.equal(conflict.data['501→506'], undefined)
  wiki[506].edges = [{ fromShipId: 501, source: 'footnote', needs: wikiNeed(60) }]
  assert.deepEqual(reconcileStagedRemodel(module(60), wiki, sampleRaw, emptyConversionTable).observations.filter(r => r.site === 'kcwiki').map(r => r.stage), ['first', 'convert'])
})

test('初次专属七种原生字段逐边核对；API显式零差异必须记冲突', () => {
  for (const [identity, field] of Object.entries(nativeFields)) {
    const [kind, id] = identity.split(':')
    const raw = { ...sampleRaw, api_mst_shipupgrade: [{ api_id: 506, api_current_ship_id: 501, [field]: 0 }] }
    const wiki = { 506: { fromShipId: 501, needs: [{ kind, id: Number(id), count: 1 }] } }
    const result = reconcileStagedRemodel({}, wiki, raw, emptyConversionTable)
    assert.deepEqual(result.conflicts.map(r => [r.edge, r.stage, r.identity, r.values]), [['501→506', 'first', identity, { wikiwiki: 1, api: 0 }]])
    assert.equal(result.data['501→506'], undefined)
  }
})

test('循环内初次补至20，普通初次101条保留；三组循环逐方向列出', () => {
  const cyclic = edge => fixture.groups.some(g => edge.split('→').map(Number).every(id => g.includes(id)))
  assert.equal(Object.entries(pack.data).filter(([edge, row]) => cyclic(edge) && row.stages.first).length, 20)
  assert.equal(Object.entries(pack.data).filter(([edge, row]) => !cyclic(edge) && row.stages.first).length, 101)
  assert.equal(fixture.direct.length, 21)
  assert.equal(fixture.groups.filter(g => g.length > 2).length, 3)
})

test('百科总表按箭头提取三隈原始两行，来源行错误与本地提取错误分开', () => {
  const text = '==可以进行转换改装的舰船==\n{|\n!标题\n|-\n!表头\n|-\n|302\n|三隈改二\n|航巡\n|89\n|⇒\n|307\n|三隈改二特\n|水母\n|1300\n|1700\n|高速建造材40・开发资材15\n|-\n|302\n|三隈改二\n|航巡\n|89\n|←\n|307\n|三隈改二特\n|水母\n|1300\n|1700\n|高速建造材30・开发资材45\n|}'
  const rows = parseCcConversionTable(text, { 302: { ID: 502 }, 307: { ID: 507 } }, fixture.raw)
  assert.deepEqual(rows.map(r => [r.edge, r.stage, r.materials]), [
    ['502→507', 'convert', { 'useitem:2': 40, 'useitem:3': 15 }], ['507→502', 'convert', { 'useitem:2': 30, 'useitem:3': 45 }],
  ])
})

test('百科单列用共有素材整列对齐；单侧缺项可收，同列素材不能拆档', () => {
  const wiki = { 506: { fromShipId: 501, needs: [{ kind: 'useitem', id: 58, count: 1 }] } }
  const module = { x: { ID: 501, 改造: { 图纸: '改装设计图x1 高速建造材x20 开发资材x10' } } }
  const result = reconcileStagedRemodel(module, wiki, sampleRaw, emptyConversionTable)
  assert.equal(result.data['501→506'].stages.first['useitem:2'], 20)
  assert.equal(result.data['501→506'].stages.first['useitem:3'], 10)
  assert.equal(result.missing.find(r => r.edge === '501→506' && r.identity === 'useitem:2').stage, 'first')
  wiki[506].needs = [{ kind: 'useitem', id: 2, count: 20 }, { kind: 'useitem', id: 3, count: 45 }]
  wiki[506].edges = [{ fromShipId: 501, source: 'footnote', needs: [{ kind: 'useitem', id: 2, count: 40 }, { kind: 'useitem', id: 3, count: 10 }] }]
  const mixed = reconcileStagedRemodel(module, wiki, sampleRaw, emptyConversionTable)
  assert.equal(mixed.observations.some(r => r.site === 'kcwiki'), false)
  assert.deepEqual(mixed.unknown.find(r => r.site === 'kcwiki').materials, { 'useitem:58': 1, 'useitem:2': 20, 'useitem:3': 10 })
})
