import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import {
  SHIP_REMODEL_CATEGORY, QUEST_COST_CATEGORY, AIR_BASE_SORTIE_CATEGORY,
  buildDeltaDetail, createShipRemodelRefreshTracker, shipRemodelRefreshCategory,
  createQuestSettleRefreshTracker, questSettleRefreshCategory,
  createAirBaseSortieTracker, airBaseSortieCategory,
  createDeltaCategoryTrackers, resolveDeltaCategory, replayDeltaCategoryFixes,
} from '../dist/shared/material-delta-detail.js'
import { textErrors } from '../scripts/lib/evidence-text-audit.mjs'
import { destroyedSlotitemIds } from '../dist/shared/slotitem-mutation.js'

const pathOf = name => `/kcsapi/${name}`
const material = pathOf('api_get_member/material')
const port = pathOf('api_port/port')
const remodeling = pathOf('api_req_kaisou/remodeling')
const quest = pathOf('api_req_quest/clearitemget')
const air = pathOf('api_req_map/start_air_base')
const remodelDetail = { kind: 'shipRemodel', ship: 7, from: 11, to: 0 }

test('三种新增类别通过出处禁词表', () => {
  assert.deepEqual(textErrors([SHIP_REMODEL_CATEGORY, QUEST_COST_CATEGORY, AIR_BASE_SORTIE_CATEGORY].map(text => ({ file: 'material-delta-detail', field: 'category', text }))), [])
})

for (const gap of [-1, 0, 740, 3000, 3001]) test(`改造窗口 ${gap} ms 与一次认领`, () => {
  const tracker = createShipRemodelRefreshTracker()
  assert.equal(shipRemodelRefreshCategory(tracker, remodeling, 1000, { detail: remodelDetail }), null)
  shipRemodelRefreshCategory(tracker, pathOf('api_get_member/ship3'), 1100, { body: { api_ship_data: [{ api_id: 99, api_ship_id: 88 }, { api_id: 7, api_ship_id: 12 }] } })
  const valid = gap >= 0 && gap <= 3000
  assert.equal(shipRemodelRefreshCategory(tracker, material, 1000 + gap), valid ? SHIP_REMODEL_CATEGORY : null)
  assert.deepEqual(tracker.detail, valid ? { ...remodelDetail, to: 12 } : null)
  assert.equal(shipRemodelRefreshCategory(tracker, material, 1800), null)
})
for (const [delta, category, kind] of [[[-1, 0], '任务消耗', 'questCost'], [[0, 1], '任务', 'quest'], [[-1, 1], '任务', 'quest'], [[0, 0], '任务', 'quest']]) test(`任务结算差分 ${delta}`, () => {
  const tracker = createQuestSettleRefreshTracker()
  questSettleRefreshCategory(tracker, quest, 1000, { quest: 1107 })
  assert.equal(questSettleRefreshCategory(tracker, material, 25400, { delta }), category)
  assert.deepEqual(tracker.detail, { kind, quest: 1107 })
  assert.equal(questSettleRefreshCategory(tracker, material, 25500, { delta }), null)
})
for (const gap of [-1, 30000, 30001]) test(`任务窗口 ${gap} ms`, () => {
  const tracker = createQuestSettleRefreshTracker()
  questSettleRefreshCategory(tracker, quest, 1000, { quest: 677 })
  assert.equal(questSettleRefreshCategory(tracker, material, 1000 + gap, { delta: [-1] }), gap === 30000 ? '任务消耗' : null)
  assert.equal(tracker.pending, null)
})
test('基地队任意 port 落地即清；未武装回港、第二次回港均不认领', () => {
  const tracker = createAirBaseSortieTracker()
  assert.equal(airBaseSortieCategory(tracker, port, 1), null)
  airBaseSortieCategory(tracker, air, 2, { map: 621 })
  assert.equal(airBaseSortieCategory(tracker, material, 3), null)
  assert.equal(airBaseSortieCategory(tracker, port, 9999999), AIR_BASE_SORTIE_CATEGORY)
  assert.deepEqual(tracker.detail, { kind: 'airBaseSortie', map: 621 })
  assert.equal(airBaseSortieCategory(tracker, port, 10000000), null)
})
test('material 优先级：用道具 > 改造 > 任务；全部机器消费一次', () => {
  for (const paid of [true, false]) {
    const trackers = createDeltaCategoryTrackers()
    const run = (apiPath, ts, postBody = {}) => resolveDeltaCategory(trackers, { apiPath, ts, postBody, delta: [-1] })
    run(quest, 10, { api_quest_id: '657' })
    run(remodeling, 20, { api_id: '7' })
    if (paid) run(pathOf('api_req_member/payitemuse'), 30, { api_payitem_id: '5', api_token: '<REDACTED>' })
    const result = run(material, 40)
    assert.equal(result.category, paid ? '氪金道具' : '舰娘改造')
    assert.deepEqual(result.detail, paid ? { kind: 'itemUse', paid: true, item: 5 } : { kind: 'shipRemodel', ship: 7, from: 0, to: 0 })
    assert.deepEqual(run(material, 50), { category: '其他', detail: null })
  }
})

const recipePost = { api_item1: '30', api_item2: '40', api_item3: '50', api_item4: '60', api_item5: '20' }
const detailCases = [
  ['补给', 'api_req_hokyu/charge', { api_id_items: '7,8', api_kind: '3', api_onslot: '1' }, {}, {}, { kind: 'supply', ships: [7, 8], mode: 3, onslot: true }],
  ['入渠', 'api_req_nyukyo/start', { api_ship_id: '7', api_ndock_id: '2', api_highspeed: '1' }, {}, { before: { ships: { 7: 11 } } }, { kind: 'dock', ship: 7, mst: 11, ndock: 2, highspeed: true }],
  ['入渠', 'api_req_nyukyo/speedchange', { api_ndock_id: '2' }, {}, { before: { ships: { 7: 11 }, dockShip: 7 } }, { kind: 'dock', ship: 7, mst: 11, ndock: 2, highspeed: true }],
  ['建造', 'api_req_kousyou/createship', { ...recipePost, api_highspeed: '1', api_large_flag: '1', api_kdock_id: '3' }, {}, {}, { kind: 'build', recipe: [30, 40, 50, 60, 20], highspeed: true, large: true, kdock: 3 }],
  ['建造', 'api_req_kousyou/createship_speedchange', { api_kdock_id: '3' }, {}, {}, { kind: 'build', recipe: [0, 0, 0, 0, 0], highspeed: true, large: false, kdock: 3 }],
  ['开发', 'api_req_kousyou/createitem', { ...recipePost, api_multiple_flag: '1' }, { api_get_items: [{ api_slotitem_id: 10 }, { api_slotitem_id: -1 }] }, {}, { kind: 'craft', recipe: [30, 40, 50, 60], multiple: true, results: [10, -1] }],
  ['开发', 'api_req_kousyou/createitem', recipePost, { api_create_flag: 0 }, {}, { kind: 'craft', recipe: [30, 40, 50, 60], multiple: false, results: [-1] }],
  ['解体', 'api_req_kousyou/destroyship', { api_ship_id: '7,8', api_slot_dest_flag: '1' }, {}, { before: { ships: { 7: 11, 8: 12 } } }, { kind: 'scrap', ships: [{ id: 7, mst: 11 }, { id: 8, mst: 12 }], withSlots: true }],
  ['废弃返还', 'api_req_kousyou/destroyitem2', { api_slotitem_ids: '101,102' }, {}, { before: { slotitems: { 101: { mstId: 10 } } } }, { kind: 'discard', slotitems: [{ id: 101, mst: 10 }, { id: 102, mst: 0 }] }],
  ['改修', 'api_req_kousyou/remodel_slot', { api_slot_id: '101', api_certain_flag: '1' }, { api_remodel_flag: 1, api_after_slot: { api_id: 101, api_slotitem_id: 11, api_level: 0 } }, { before: { slotitems: { 101: { mstId: 10 } } } }, { kind: 'improve', slotitem: 101, mst: 10, certain: true, success: true, after: { mst: 11, level: 0 } }],
  ['远征', 'api_req_mission/result', { api_deck_id: '2' }, { api_clear_result: 2 }, { expedition: { mission: 21, deck: 2 } }, { kind: 'expedition', mission: 21, deck: 2, result: 'great' }],
  ['任务', 'api_req_quest/clearitemget', { api_quest_id: '677' }, { api_material: [0, 0, 0, 0] }, {}, { kind: 'quest', quest: 677 }],
  ['基地航空队', 'api_req_air_corps/set_plane', { api_area_id: '62', api_base_id: '2', api_squadron_id: '3' }, {}, {}, { kind: 'airBase', action: 'setPlane', area: 62, base: 2, squadron: 3 }],
  ['基地航空队', 'api_req_air_corps/supply', { api_area_id: '62', api_base_id: '2', api_squadron_id: '3' }, {}, {}, { kind: 'airBase', action: 'supply', area: 62, base: 2, squadron: 3 }],
  ['基地航空队出击', 'api_req_map/start_air_base', { api_strike_point_2: '4,4' }, {}, { sortie: { mapArea: 62, mapNo: 1 } }, { kind: 'airBaseSortie', map: 621 }],
  ['海域资源点', 'api_req_map/start', {}, { api_maparea_id: 2, api_mapinfo_no: 3, api_no: 4 }, {}, { kind: 'mapItem', map: 23, cell: 4, source: 'start' }],
  ['海域资源点', 'api_req_map/next', {}, { api_no: 5 }, { sortie: { mapArea: 2, mapNo: 3, currentCell: 5 } }, { kind: 'mapItem', map: 23, cell: 5, source: 'next' }],
  ['舰娘改造', 'api_req_kaisou/remodeling', { api_id: '7' }, {}, { before: { ships: { 7: 11 } }, after: { ships: { 7: 12 } } }, { kind: 'shipRemodel', ship: 7, from: 11, to: 12 }],
  ['氪金道具', 'api_req_member/payitemuse', { api_payitem_id: '5' }, { api_caution_flag: 0 }, {}, { kind: 'itemUse', item: 5, paid: true }],
  ['使用道具', 'api_req_member/itemuse', {}, {}, {}, { kind: 'itemUse', item: null, paid: false }],
]
for (const [category, api, postBody, body, context, expected] of detailCases) test(`detail ${category} / ${api} / ${expected.kind}`, () => {
  const detail = buildDeltaDetail({ apiPath: pathOf(api), postBody: { ...postBody, api_token: '<REDACTED>' }, body: { ...body, api_token: '<REDACTED>' }, ...context })
  assert.deepEqual(detail, expected)
  assert.doesNotMatch(JSON.stringify(detail), /token|REDACTED/)
  assert.deepEqual(buildDeltaDetail({ apiPath: pathOf(api), postBody, body: { api_data: body }, ...context }), expected)
})
test('缺失字段不猜图号、实例图鉴与开发结果；母港及未知包为 null', () => {
  assert.deepEqual(buildDeltaDetail({ apiPath: pathOf('api_req_map/next') }), { kind: 'mapItem', source: 'next' })
  assert.equal(buildDeltaDetail({ apiPath: port }), null)
  assert.equal(buildDeltaDetail({ apiPath: material }), null)
  assert.deepEqual(buildDeltaDetail({ apiPath: pathOf('api_req_hokyu/charge') }), { kind: 'supply', ships: [], onslot: false })
  assert.deepEqual(buildDeltaDetail({ apiPath: pathOf('api_req_kousyou/createitem'), body: { api_get_item: { api_slotitem_id: 15 } } }).results, [15])
  assert.equal(buildDeltaDetail({ apiPath: pathOf('api_req_kousyou/remodel_slot'), body: { api_remodel_flag: 0 } }).success, false)
})
test('回放与实时同口径，保留已归类行，空刷新及空回港消费武装', () => {
  const events = [
    [10, remodeling, { api_id: '7' }], [300, pathOf('api_get_member/ship3'), {}, { api_ship_data: [{ api_id: 7, api_ship_id: 12 }] }], [700, material], [800, material],
    [1000, quest, { api_quest_id: '1107' }], [3500, material],
    [4000, quest, { api_quest_id: '677' }], [6000, material],
    [7000, pathOf('api_req_map/start'), {}, { api_maparea_id: 62, api_mapinfo_no: 1 }], [8000, air], [9000, port], [10000, port],
    [11000, air], [12000, port], [13000, port],
    [14000, remodeling, { api_id: '7' }], [14500, material], [15000, material],
    [16000, quest, { api_quest_id: '657' }], [18000, material],
  ].map(([ts, path, postBody = {}, body]) => ({ ts, path, postBody: { ...postBody, api_token: '<REDACTED>' }, body }))
  const deltas = [700, 800, 3500, 6000, 9000, 10000, 13000, 15000, 18000].map(ts => ({ ts, category: ts === 18000 ? '补给' : ts >= 9000 && ts <= 13000 ? '母港校准' : '其他', values: ts === 6000 ? [1, 0] : [-1, 0] }))
  const replay = replayDeltaCategoryFixes(events, deltas)
  assert.deepEqual([...replay].map(([ts, result]) => [ts, result.category]), [[700, '舰娘改造'], [3500, '任务消耗'], [6000, '任务'], [9000, '基地航空队出击']])
  const trackers = createDeltaCategoryTrackers()
  let sortie = null
  for (const event of events) {
    if (event.path.endsWith('api_req_map/start')) sortie = { mapArea: 62, mapNo: 1 }
    const row = deltas.find(row => row.ts === event.ts)
    const result = resolveDeltaCategory(trackers, { apiPath: event.path, ...event, sortie, delta: row?.values })
    if (replay.has(event.ts)) assert.deepEqual(result, replay.get(event.ts))
    if (event.path === port) sortie = null
  }
})

// 原样执行 handleEvent；只替换 IO 与归约依赖，验证取对象发生在破坏性归约之前。
const indexSource = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const between = (start, end) => {
  const a = indexSource.indexOf(start)
  const b = indexSource.indexOf(end, a)
  assert.ok(a >= 0 && b > a)
  return indexSource.slice(a, b)
}
const handlerSource = transformSync(
  between('const DELTA_CATEGORY:', '\n// 用道具 →') + '\n' + between('const handleEvent =', '\nconst DOMAIN_SECTIONS ='),
  { loader: 'ts' },
).code
const makeHandler = () => {
  const state = {
    player: { ships: { 7: { shipId: 11 }, 8: { shipId: 12 } }, slotitems: { 101: { mstId: 10 } },
      ndocks: [{ id: 2, shipId: 7 }], decks: [{ id: 2, mission: [1, 21] }], materials: Array(8).fill(1000) },
    mapGauges: {}, master: { ships: {} }, sortie: { mapArea: 62, mapNo: 1, currentCell: 4 },
  }
  const rows = []
  let reduce = () => {}
  const noop = () => {}
  const context = {
    ITEM_USE_CATEGORY: '使用道具', deltaCategoryTrackers: createDeltaCategoryTrackers(), resolveDeltaCategory,
    destroyedSlotitemIds, MARRIAGE_PATH: pathOf('api_req_kaisou/marriage'), HANGAR_EXPAND_PATH: pathOf('api_req_kaisou/hangar_expand'),
    store: { getState: () => state, handle: (...args) => { reduce(...args); return ['materials'] } },
    timeMain: (_label, fn) => fn(), onQuestApi: noop, onChronicleApi: noop, onShipLifeApi: noop,
    questSenkaInfo: () => null, broadcast: noop, broadcastGameScene: noop, missionScene: () => null,
    ledger: { logDelta: (...row) => rows.push(row), logMaterials: noop, logExpeditionResult: noop },
    DOMAIN_SECTIONS: new Set(),
  }
  const handle = new Function(...Object.keys(context), `${handlerSource}; return handleEvent`)(...Object.values(context))
  return { state, rows, run: (api, post = {}, body = {}, ts = 1000, mutate = () => {}) => {
    reduce = mutate
    handle(pathOf(api), body, { ...post, api_token: '<REDACTED>' }, ts)
  }, change: () => { state.player.materials = state.player.materials.map(v => v - 1) } }
}
for (const [api, post, mutate, expected] of [
  ['api_req_kousyou/destroyship', { api_ship_id: '7,8', api_slot_dest_flag: '1' }, state => { state.player.ships = {} }, { kind: 'scrap', ships: [{ id: 7, mst: 11 }, { id: 8, mst: 12 }], withSlots: true }],
  ['api_req_kousyou/destroyitem2', { api_slotitem_ids: '101' }, state => { delete state.player.slotitems[101] }, { kind: 'discard', slotitems: [{ id: 101, mst: 10 }] }],
  ['api_req_kousyou/remodel_slot', { api_slot_id: '101' }, state => { state.player.slotitems[101].mstId = 15 }, { kind: 'improve', slotitem: 101, mst: 10, certain: false, success: false }],
  ['api_req_nyukyo/speedchange', { api_ndock_id: '2' }, state => { state.player.ndocks[0].shipId = 0 }, { kind: 'dock', ship: 7, mst: 11, ndock: 2, highspeed: true }],
  ['api_req_mission/result', { api_deck_id: '2' }, state => { state.player.decks[0].mission = [0, 0] }, { kind: 'expedition', mission: 21, deck: 2, result: 'failed' }],
]) test(`handleEvent 在归约前抓取 ${expected.kind}`, () => {
  const h = makeHandler()
  h.run(api, post, {}, 1000, () => { mutate(h.state); h.change() })
  assert.equal(h.rows.length, 1)
  assert.deepEqual(h.rows[0][3], expected)
  assert.doesNotMatch(JSON.stringify(h.rows), /token|REDACTED/)
})
test('handleEvent 改造前形态与 ship3 新形态跨包落地，任务用本包差分，空 port 清武装', () => {
  const h = makeHandler()
  h.run('api_req_kaisou/remodeling', { api_id: '7' })
  h.run('api_get_member/ship3', {}, { api_ship_data: [{ api_id: 7, api_ship_id: 15 }] }, 1400, () => { h.state.player.ships[7].shipId = 15 })
  h.run('api_get_member/material', {}, [], 1700, h.change)
  assert.deepEqual(h.rows[0].slice(1), ['舰娘改造', Array(8).fill(-1), { kind: 'shipRemodel', ship: 7, from: 11, to: 15 }])
  h.run('api_req_quest/clearitemget', { api_quest_id: '1107' }, {}, 2000)
  h.run('api_get_member/material', {}, [], 4000, h.change)
  assert.deepEqual(h.rows[1].slice(1), ['任务消耗', Array(8).fill(-1), { kind: 'questCost', quest: 1107 }])
  h.run('api_req_map/start_air_base', {}, {}, 5000)
  h.run('api_port/port', {}, {}, 6000)
  h.run('api_port/port', {}, {}, 7000, h.change)
  assert.equal(h.rows[2][1], '母港校准')
  assert.equal(h.rows[2][3], null)
  h.run('api_req_map/start_air_base', {}, {}, 8000)
  h.run('api_port/port', {}, {}, 9000, h.change)
  assert.deepEqual(h.rows[3][3], { kind: 'airBaseSortie', map: 621 })
})
