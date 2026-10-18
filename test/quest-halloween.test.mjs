import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { halloweenMaster } from './fixtures/quest-halloween-master.mjs'
import { sortieMaster } from './fixtures/quest-sortie-master.mjs'
import { runProductionSection, runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-16T12:00:00+09:00') })
const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-halloween-test-'))
const output = path.join(temp, 'runtime.cjs')
buildSync({
  stdin: {
    contents: [
      'export { createQuestEngine } from "./src/main/mg/quest-counter"',
      'export { buildFleetRuleContext, deriveFleetRule } from "./src/main/mg/quest-fleet-rules"',
      'export { evaluateFleetGoal } from "./src/main/mg/kcwiki-quest-rules"',
      'export { buildScrapRuleContext, deriveScrapPreparation } from "./src/main/mg/quest-scrap-rules"',
      'export { QUEST_TEXT_CORRECTIONS, applyQuestTextCorrectionsToPack } from "./src/shared/quest-text-corrections"',
    ].join('\n'), resolveDir: root,
  }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const runtime = createRequire(import.meta.url)(output)
test.after(() => { mock.timers.reset(); fs.rmSync(temp, { recursive: true, force: true }) })
const pack = (id) => runtime.applyQuestTextCorrectionsToPack(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'lodes', `${id}.json`), 'utf8')))
const lodes = Object.fromEntries(['quests-scn', 'kcwiki-localization', 'kcwiki-quest-req', 'poi-quest-goal', 'kcwiki-expedition', 'poi-fcd-map'].map((id) => [id, pack(id)]))

test('985 的鹈来名单直接来自上游包，万圣节加载不依赖校正', () => {
  const upstream = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'lodes', 'quests-scn.json'), 'utf8'))
  assert.match(upstream.data['985'].memo2, /对马、鹈来、稻木/)
  assert.deepEqual(lodes['quests-scn'].data['985'], upstream.data['985'])
  assert.ok(!runtime.QUEST_TEXT_CORRECTIONS.some((fix) => fix.questId === 985))
})

const master = { ...halloweenMaster, api_mst_mapinfo: sortieMaster.api_mst_mapinfo }
const quiet = (fn) => {
  const log = console.log, warn = console.warn
  console.log = console.warn = () => {}
  try { return fn() } finally { console.log = log; console.warn = warn }
}
const idOf = (name) => {
  const ship = master.api_mst_ship.find((ship) => ship.api_name === name)
  assert.ok(ship, name)
  return ship.api_id
}
const view = (names) => names.map((name) => {
  const ship = master.api_mst_ship.find((ship) => ship.api_id === idOf(name))
  return { mstId: ship.api_id, stype: ship.api_stype, ctype: ship.api_ctype, soku: ship.api_soku, lv: 99 }
})
const ids = [359, 984, 985, 986, 1038, 1119, 920]
const world = () => {
  const player = {
    quests: Object.fromEntries(ids.map((id) => [id, { no: id, state: 2, type: 1, progressFlag: 0 }])),
    questActiveIds: ids, questActiveTs: Date.now(), questsTs: Date.now(),
    decks: [], ships: {}, slotitems: {}, materials: [], useitems: {}, basic: { furnitureCoins: 0 },
  }
  const state = { player, sortie: null }
  const engine = runtime.createQuestEngine({
    getLode: (id) => lodes[id] ?? null,
    ledger: { loadSnapshot: () => undefined, loadQuestProgress: () => ({}), saveQuestProgress: () => {}, deleteQuestProgress: () => {} },
    store: { getState: () => state }, send: () => {},
  })
  quiet(() => engine.init(master))
  const setFleet = (names) => {
    player.ships = Object.fromEntries(names.map((name, index) => [index + 1, { id: index + 1, shipId: idOf(name), lv: 99 }]))
    player.decks = [{ id: 1, ships: names.map((_, index) => index + 1) }]
  }
  return { state, engine, setFleet }
}

const cases = [
  { id: 359, count: 4, names: ['鈴谷', '阿武隈', '曙', '朧', '村雨', '夕立', '野分', '朝潮', '早波', '浜波', '伊201', 'Jervis', 'Minneapolis', 'Johnston'], pass: ['鈴谷航改二', '伊201改', 'Jervis改', 'Minneapolis改'], rank: 'A' },
  { id: 984, count: 3, flag: true, names: ['鈴谷', '村雨', '夕立', '曙', '朧', '朝潮', '野分', '迅鯨', '長鯨'], pass: ['鈴谷改二', '村雨改二', '夕立改二'] },
  { id: 985, count: 3, names: ['対馬', '鵜来', '稲木', '大泊', '迅鯨', '長鯨', '朝日', '村雨', '巻波', '早波', '浜波', '樫'], pass: ['鵜来改', '対馬改', '稲木改'] },
  { id: 986, count: 3, names: ['Minneapolis', 'Tuscaloosa', 'Gambier Bay', 'Brooklyn', 'Johnston', 'Richard P.Leary', 'Indiana'], pass: ['Minneapolis改', 'Tuscaloosa改', 'Gambier Bay Mk.II'] },
  { id: 1038, count: 4, flag: true, names: ['鈴谷', '曙', '朧', '樫', '朝日', '迅鯨', '長鯨', '瑞穂', 'Johnston', 'Richard P.Leary'], pass: ['鈴谷航改二', '曙改二', '朧改', '樫改'] },
]
const ctx = runtime.buildFleetRuleContext(master, lodes['kcwiki-localization'].data)
for (const sample of cases) {
  test(`${sample.id}：完整名单及改造链，刚好够数通过、少一艘拒绝，实际计数也过门`, () => {
    const { state, engine, setFleet } = world()
    const tracker = engine.state().trackers[sample.id]
    const group = tracker.fleetGoal.groups[0]
    assert.equal(group.amount, sample.count)
    assert.equal(Boolean(group.flagship), Boolean(sample.flag))
    const expected = new Set(sample.names.flatMap((name) => ctx.shipIdsOf(name)))
    assert.deepEqual(new Set(group.ships), expected)
    const evaluate = (names) => runtime.evaluateFleetGoal(tracker.fleetGoal, view(names), 1).ok
    assert.equal(evaluate(sample.pass), true)
    assert.equal(evaluate(sample.pass.slice(0, -1)), false)
    if (sample.flag) assert.equal(evaluate(['睦月', ...sample.pass]), false)
    else assert.equal(evaluate(['睦月', ...sample.pass]), true)
    if (sample.id === 986) {
      assert.equal(evaluate(['Iowa', 'South Dakota', 'Washington']), false)
      assert.equal(evaluate([...sample.pass.slice(0, -1), 'Iowa']), false)
    }
    const task = tracker.tasks[0]
    assert.equal(task.count, sample.id === 359 ? 5 : sample.id === 1038 ? 4 : sample.id === 985 ? 1 : 2)
    state.sortie = { deckId: 1, practice: sample.id === 359, mapArea: task.map?.[0], mapNo: task.map?.[1], currentCell: 1, nodes: [{ cell: 1, eventId: 5 }] }
    const event = sample.id === 359 ? '/kcsapi/api_req_practice/battle_result' : '/kcsapi/api_req_sortie/battleresult'
    const fire = () => engine.onApi(event, { api_win_rank: sample.rank ?? 'S' }, {})
    setFleet(sample.pass.slice(0, -1)); fire()
    assert.equal(engine.state().progress[sample.id]?.[0] ?? 0, 0)
    if (sample.flag) {
      setFleet(['睦月', ...sample.pass]); fire()
      assert.equal(engine.state().progress[sample.id]?.[0] ?? 0, 0)
    }
    if (sample.id === 986) {
      setFleet(['Iowa', 'South Dakota', 'Washington']); fire()
      assert.equal(engine.state().progress[sample.id]?.[0] ?? 0, 0)
    }
    if (sample.id === 359) {
      setFleet(sample.pass)
      engine.onApi(event, { api_win_rank: 'B' }, {})
      assert.equal(engine.state().progress[sample.id]?.[0] ?? 0, 0)
    }
    setFleet(sample.pass); fire()
    assert.equal(engine.state().progress[sample.id][0], 1)
  })
}

test('同类编成写法：合计、前置数量、其中旗舰与名单后的美国舰队都保留名单边界', () => {
  for (const desc of [
    '以包含「铃谷」「村雨」「夕立」中合计2艘以上且以其中一艘为旗舰的舰队出击',
    '以包含2艘以上指定舰娘（铃谷、村雨、夕立）且其中一艘为旗舰的舰队出击',
    '以「铃谷」「村雨」「夕立」为旗舰以及1艘伴随舰以上的舰队出击',
  ]) {
    const rule = runtime.deriveFleetRule(9000, 'B999', desc, '', ctx)
    assert.equal(rule.fleetGoal.groups[0].amount, 2, desc)
    assert.equal(rule.fleetGoal.groups[0].flagship, true, desc)
    assert.equal(runtime.evaluateFleetGoal(rule.fleetGoal, view(['鈴谷航改二', '村雨']), 1).ok, true)
    assert.equal(runtime.evaluateFleetGoal(rule.fleetGoal, view(['睦月', '鈴谷', '村雨']), 1).ok, false)
  }
  const rule = runtime.deriveFleetRule(9001, 'B999', '以包含「Minneapolis」「Tuscaloosa」「Gambier Bay」中2艘以上的美国舰队出击', '', ctx)
  assert.equal(runtime.evaluateFleetGoal(rule.fleetGoal, view(['Iowa', 'Washington']), 1).ok, false)
  assert.equal(runtime.evaluateFleetGoal(rule.fleetGoal, view(['Minneapolis', 'Tuscaloosa']), 1).ok, true)
})

test('B148：带数字的 Fletcher改 Mod.2 恢复原文旗舰条件，三艘同盟舰包含旗舰', () => {
  const { engine } = world()
  const goal = engine.state().trackers[920].fleetGoal
  assert.equal(runtime.evaluateFleetGoal(goal, view(['Fletcher改 Mod.2', 'Iowa', 'Washington']), 1).ok, true)
  assert.equal(runtime.evaluateFleetGoal(goal, view(['Fletcher', 'Iowa', 'Washington']), 1).ok, false)
  assert.equal(runtime.evaluateFleetGoal(goal, view(['Iowa', 'Fletcher改 Mod.2', 'Washington']), 1).ok, false)
})

test('1119：废弃计数与准备项分离；装备或家具币不足、未同步均不显示预估完成', () => {
  const { state, engine } = world()
  const tracker = engine.state().trackers[1119]
  assert.deepEqual(tracker.tasks.map(({ kind, category, count }) => [kind, category, count]), [['scrapCategory', 1, 9], ['scrapCategory', 2, 9], ['scrapCategory', 10, 9]])
  assert.deepEqual(tracker.stockGoals.map(({ label, count }) => [label, count]), [['九九式舰爆', 10], ['九七式舰攻', 10], ['家具币', 1031]])
  assert.equal(tracker.partial, false)
  const destroyed = Object.fromEntries(['12cm単装砲', '14cm単装砲', '零式水上偵察機'].flatMap((name, index) => {
    const mstId = master.api_mst_slotitem.find((item) => item.api_name === name).api_id
    return Array.from({ length: 9 }, (_, n) => [index * 9 + n + 1, { mstId }])
  }))
  engine.onApi('/kcsapi/api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: Object.keys(destroyed).join(',') }, { destroyedSlotitems: destroyed })
  assert.deepEqual(engine.state().progress[1119], [9, 9, 9])
  const notifications = []
  const qpState = { trackers: { 1119: tracker }, progress: { 1119: engine.state().progress[1119] } }
  const mg = { ...state.player, basic: { furnitureCoins: 0 }, master: { slotitems: {} } }
  const { api } = runtimeHost().extract('src/renderer/modules/lg.ts', ['detectQuestComplete'], {
    mg, qpState, questNotified: new Set(), notify: (...args) => notifications.push(args), entityNamePlain: () => '1119',
  })
  const detail = runtimeHost().extract('src/renderer/modules/qn.ts', ['qpStockCurrent'], {
    mg, useitemNames: new Map([[44, '家具コイン']]),
  }).api
  const main = runProductionSection('src/main/mg/quest-counter.ts', '  const stockGoalCurrent = (', '  const equipmentGoalsUseDistinctSlots = (', {
    store: { getState: () => state }, master: {}, USEITEM_MATERIAL_INDEX: {},
  }, 'globalThis.stockGoalCurrent = stockGoalCurrent;')
  state.player.basic.furnitureCoins = 1031
  assert.equal(main.stockGoalCurrent(tracker.stockGoals[2]), 1031)
  state.player.useitems[44] = 99999
  delete state.player.basic.furnitureCoins
  assert.equal(main.stockGoalCurrent(tracker.stockGoals[2]), null)
  const stocked = (counts) => {
    mg.slotitems = Object.fromEntries(tracker.stockGoals.slice(0, 2).flatMap((goal, index) => Array.from({ length: counts[index] }, (_, n) => [`${index}-${n}`, { mstId: goal.id }])))
  }
  stocked([9, 10]); mg.basic.furnitureCoins = 1031; api.detectQuestComplete()
  assert.deepEqual(tracker.stockGoals.map(detail.qpStockCurrent), [9, 10, 1031])
  stocked([10, 9]); api.detectQuestComplete()
  stocked([10, 10]); mg.basic.furnitureCoins = 1030; api.detectQuestComplete()
  mg.useitems[44] = 99999; api.detectQuestComplete() // 不能拿道具入口库存代替家具币。
  delete mg.basic.furnitureCoins; api.detectQuestComplete()
  assert.equal(detail.qpStockCurrent(tracker.stockGoals[2]), null)
  assert.equal(notifications.length, 0)
  mg.basic.furnitureCoins = 1031; api.detectQuestComplete()
  assert.equal(notifications.length, 1)
})

test('分配式准备清单复用解析；任一装备或附加道具读不出时标 partial', () => {
  const context = runtime.buildScrapRuleContext(master, lodes['kcwiki-localization'].data)
  const rule = (text) => runtime.deriveScrapPreparation(text, '', context)
  assert.deepEqual(rule('准备「九九式舰爆」「九七式舰攻」各2个、家具币2,000枚！').stockGoals.map((goal) => goal.count), [2, 2, 2000])
  assert.equal(rule('准备「未知装备」「九七式舰攻」各2个！').partial, true)
  assert.equal(rule('准备「九九式舰爆」「九七式舰攻」各2个、未收录道具3个！').partial, true)
})
