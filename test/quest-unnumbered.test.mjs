import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import { runFleetGateAudit } from '../scripts/quest-fleet-gate-audit.mjs'
import { unnumberedMaster } from './fixtures/quest-unnumbered-master.mjs'
import { halloweenMaster } from './fixtures/quest-halloween-master.mjs'
import { sortieMaster } from './fixtures/quest-sortie-master.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-unnumbered-test-'))
const output = path.join(temp, 'runtime.cjs')
buildSync({
  stdin: { contents: [
    'export { createQuestEngine } from "./src/main/mg/quest-counter"',
    'export { buildFleetRuleContext, deriveFleetRule } from "./src/main/mg/quest-fleet-rules"',
    'export { evaluateFleetGoal } from "./src/main/mg/kcwiki-quest-rules"',
    'export { applyQuestTextCorrectionsToPack } from "./src/shared/quest-text-corrections"',
  ].join('\n'), resolveDir: root },
  outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const runtime = createRequire(import.meta.url)(output)
test.after(() => fs.rmSync(temp, { recursive: true, force: true }))
const load = id => runtime.applyQuestTextCorrectionsToPack(JSON.parse(fs.readFileSync(path.join(root, 'assets/lodes', `${id}.json`), 'utf8')))
const lodes = Object.fromEntries(['quests-scn', 'kcwiki-localization', 'kcwiki-quest-req', 'poi-quest-goal', 'kcwiki-expedition', 'poi-fcd-map'].map(id => [id, load(id)]))
const master = { ...unnumberedMaster, api_mst_mapinfo: sortieMaster.api_mst_mapinfo }
const ctx = runtime.buildFleetRuleContext(master, lodes['kcwiki-localization'].data)
const cases = [
  { code: '2610Bw2', count: 4, names: ['対馬', '樫', '朝潮', '巻波', '浜波', '阿武隈', '鵜来', '稲木', '能美'], pass: ['対馬改', '樫改', '朝潮改二', '巻波改'], ctypes: [104] },
  { code: '2610Bm1', count: 3, flag: true, names: ['Roma', 'Luigi Torelli', 'Maestrale', 'Grecale', 'Libeccio', 'Scirocco', 'Jervis', '伊47', '伊201', '鈴谷', '村雨', '朧', '曙'], pass: ['Roma改', 'Luigi Torelli改', 'Maestrale改'] },
  { code: '2610Bm2', count: 3, flag: true, names: ['朧', '夕立', '野分', '早波', '熊野丸', '迅鯨改', 'Tuscaloosa', 'Indiana'], pass: ['迅鯨改', '夕立改二', '熊野丸改'] },
  { code: '2610B4', count: 3, flag: true, names: ['Minneapolis', 'Tuscaloosa', 'Gambier Bay', 'Johnston', '鈴谷', '阿武隈', '曙', '朧', '清霜', '樫'], pass: ['Minneapolis改', '清霜改二', '樫改'] },
  { code: 'B218', pass: ['天霧改二', '狭霧改二'] },
]
const codes = [...cases.map(sample => sample.code), '2610F1']
const idOfCode = code => 9000 + codes.indexOf(code)
const shipOf = name => {
  const ship = master.api_mst_ship.find(ship => ship.api_name === name)
  assert.ok(ship, `夹具必须包含 ${name}`)
  return ship
}
const view = names => names.map(name => {
  const ship = shipOf(name)
  return { mstId: ship.api_id, stype: ship.api_stype, ctype: ship.api_ctype, soku: ship.api_soku, lv: 99 }
})
const quiet = fn => {
  const log = console.log, warn = console.warn
  console.log = console.warn = () => {}
  try { return fn() } finally { console.log = log; console.warn = warn }
}
const world = (scn = lodes['quests-scn']) => {
  const quests = Object.fromEntries(codes.map(code => {
    const no = idOfCode(code)
    return [no, { no, title: scn.unnumbered[code].titleJa, category: code === '2610F1' ? 11 : 10, state: 2, type: 4, progressFlag: 0 }]
  }))
  const player = { quests, questActiveIds: Object.keys(quests).map(Number), questActiveTs: Date.now(), questsTs: Date.now(), decks: [], ships: {}, slotitems: {}, materials: [], useitems: {} }
  const state = { player, sortie: null }
  const engine = runtime.createQuestEngine({
    getLode: id => id === 'quests-scn' ? scn : lodes[id] ?? null,
    ledger: { loadSnapshot: () => undefined, loadQuestProgress: () => ({}), saveQuestProgress: () => {}, deleteQuestProgress: () => {} },
    store: { getState: () => state }, send: () => {},
  })
  quiet(() => engine.init(master))
  const setFleet = names => {
    player.ships = Object.fromEntries(names.map((name, index) => [index + 1, { id: index + 1, shipId: shipOf(name).api_id, lv: 99 }]))
    player.decks = [{ id: 1, ships: names.map((_, index) => index + 1) }]
  }
  return { engine, state, setFleet }
}

for (const sample of cases) {
  test(`${sample.code}：认领后候选、数量、旗舰及实际计数均过具体编成门`, () => {
    const { engine, state, setFleet } = world()
    const id = idOfCode(sample.code)
    const tracker = engine.state().trackers[id]
    assert.ok(tracker?.fleetGoal, `${sample.code} 不允许无门通过`)
    const goal = tracker.fleetGoal
    if (sample.names) {
      assert.equal(goal.groups.length, 1)
      const group = goal.groups[0]
      assert.equal(group.amount, sample.count)
      assert.equal(Boolean(group.flagship), Boolean(sample.flag))
      assert.deepEqual(new Set(group.ships), new Set(sample.names.flatMap(name => {
        const ids = ctx.shipIdsOf(name)
        assert.ok(ids?.length, name)
        return ids
      })))
      assert.deepEqual(group.ctypes ?? [], sample.ctypes ?? [])
    } else {
      assert.deepEqual(goal.groups.map(({ ships, amount, flagship }) => ({ ships, amount, flagship })), [
        { ships: [shipOf('天霧改二').api_id, shipOf('天霧改二丁').api_id], amount: 1, flagship: undefined },
        { ships: [shipOf('狭霧改二').api_id], amount: 1, flagship: undefined },
      ])
    }
    const evaluate = names => runtime.evaluateFleetGoal(goal, view(names), 1).ok
    assert.equal(evaluate(sample.pass), true)
    assert.equal(evaluate(sample.pass.slice(0, -1)), false)
    const rejects = [sample.pass.slice(0, -1)]
    if (sample.flag) {
      rejects.push(['睦月', ...sample.pass])
      assert.equal(evaluate(rejects.at(-1)), false)
    }
    if (sample.code === '2610Bw2') {
      const ding = master.api_mst_ship.filter(ship => ship.api_ctype === 104)
      assert.equal(ding.length, 6, '丁型三艘及其改全部进入夹具')
      assert.equal(evaluate(['第四号海防艦改', '第三〇号海防艦改', '第二十二号海防艦改', '能美改']), true)
      assert.equal(evaluate(['睦月', ...sample.pass]), true, '无旗舰限制')
    }
    if (sample.code === '2610Bm2') {
      rejects.push([sample.pass[0]], sample.pass.slice(0, 2), ['迅鯨', '夕立改二', '熊野丸改'])
      for (const names of rejects) assert.equal(evaluate(names), false, names.join('/'))
      assert.equal(goal.groups[0].ships.includes(shipOf('迅鯨').api_id), false, '只点名迅鲸改')
    }
    if (sample.code === 'B218') {
      assert.equal(evaluate(['天霧改二丁', '狭霧改二']), true)
      rejects.push(['天霧改', '狭霧改二'], ['天霧改二', '狭霧改'])
    }
    const task = tracker.tasks[0]
    state.sortie = { deckId: 1, practice: false, mapArea: task.map[0], mapNo: task.map[1], currentCell: 1, nodes: [{ cell: 1, eventId: 5 }] }
    const fire = names => {
      setFleet(names)
      quiet(() => engine.onApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'S' }, {}))
    }
    for (const names of rejects) fire(names)
    assert.equal(engine.state().progress[id]?.[0] ?? 0, 0)
    fire(sample.code === '2610Bw2' ? ['第四号海防艦改', '第三〇号海防艦改', '第二十二号海防艦改', '能美改'] : sample.pass)
    assert.equal(engine.state().progress[id][0], 1)
  })
}

test('通用名单指代：无“舰”字的伴随、逗号后的其中N僚舰、其一旗舰各自能独立读全', () => {
  for (const tail of ['中3艘作为旗舰和伴随的舰队', '中的一艘为旗舰，并配备其中2艘以上为僚舰的舰队', '中的一艘为旗舰，并配备其中二艘以上为僚舰的舰队', '中3名舰娘并以其一作为旗舰的舰队']) {
    const rule = runtime.deriveFleetRule(9900, 'B999', `以「朧」「夕立」「野分」「熊野丸」${tail}出击`, '', ctx)
    assert.equal(rule.fleetGoal.groups[0].amount, 3, tail)
    assert.equal(rule.fleetGoal.groups[0].flagship, true, tail)
    assert.equal(runtime.evaluateFleetGoal(rule.fleetGoal, view(['朧改', '夕立改二', '熊野丸改']), 1).ok, true)
  }
})

test('B117/Cy16/B204：同类既有任务的完整编成门与修前快照逐字段一致', () => {
  // 2026-10-16 修前实际引擎输出，仅保留这三道门；不是从本次解析结果反推期望。
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/quest-unnumbered-gate-baseline.json'), 'utf8'))
  const { engine } = world()
  for (const id of [884, 377, 1017]) assert.deepEqual(engine.state().trackers[id].fleetGoal, baseline[id], String(id))
})

test('2610F1：三个指定装备按实际废弃数量计数，三项准备不足或未同步均不显示完成', () => {
  const { engine, state } = world()
  const id = idOfCode('2610F1')
  const tracker = engine.state().trackers[id]
  assert.deepEqual(tracker.tasks.map(({ kind, equipId, count }) => [kind, equipId, count]), [['scrapEquip', 44, 12], ['scrapEquip', 226, 8], ['scrapEquip', 46, 6]])
  assert.deepEqual(tracker.stockGoals.map(({ kind, id, count }) => [kind, id, count]), [['useitem', 96, 2], ['equip', 45, 5], ['material', 6, 30]])
  assert.equal(tracker.approx, false)
  assert.equal(tracker.partial, false)
  const destroyed = Object.fromEntries([[44, 12], [226, 8], [46, 6]].flatMap(([mstId, count], index) => Array.from({ length: count }, (_, n) => [`${index * 20 + n + 1}`, { mstId }])))
  quiet(() => engine.onApi('/kcsapi/api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: Object.keys(destroyed).join(',') }, { destroyedSlotitems: destroyed }))
  assert.deepEqual(engine.state().progress[id], [12, 8, 6])
  const mg = { ...state.player, master: { slotitems: {} } }
  const notifications = []
  const qpState = { trackers: { [id]: tracker }, progress: { [id]: [12, 8, 6] } }
  const host = runtimeHost()
  const { api } = host.extract('src/renderer/modules/lg.ts', ['detectQuestComplete'], { mg, qpState, questNotified: new Set(), notify: (...args) => notifications.push(args), entityNamePlain: () => '2610F1' })
  const stocked = (pumpkins, equips, devmats) => {
    mg.useitems = { 96: pumpkins }
    mg.slotitems = Object.fromEntries(Array.from({ length: equips }, (_, i) => [i + 1, { mstId: 45 }]))
    mg.materials = [0, 0, 0, 0, 0, 0, devmats, 0]
  }
  stocked(1, 5, 30); api.detectQuestComplete()
  stocked(2, 4, 30); api.detectQuestComplete()
  stocked(2, 5, 29); api.detectQuestComplete()
  mg.useitems[3] = 99999; api.detectQuestComplete()
  stocked(2, 5, 30); mg.materials = null; api.detectQuestComplete()
  assert.equal(notifications.length, 0)
  stocked(2, 5, 30); api.detectQuestComplete()
  assert.equal(notifications.length, 1)
  const unsupported = structuredClone(lodes['quests-scn'])
  unsupported.unnumbered['2610F1'].desc = unsupported.unnumbered['2610F1'].desc.replace('「南瓜」', '「未收录的准备道具」')
  const partialTracker = world(unsupported).engine.state().trackers[id]
  assert.equal(partialTracker.partial, true)
  const partialNotifications = []
  const partial = host.extract('src/renderer/modules/lg.ts', ['detectQuestComplete'], {
    mg, qpState: { trackers: { [id]: partialTracker }, progress: { [id]: [12, 8, 6] } },
    questNotified: new Set(), notify: (...args) => partialNotifications.push(args), entityNamePlain: () => '2610F1',
  }).api
  partial.detectQuestComplete()
  assert.equal(partialNotifications.length, 0, '准备项未读全，不允许按已计满的部分宣布完成')
})

test('未定号也进入全库审计：完整夹具五道门齐全，缺舰夹具必须暴露缺门', async () => {
  const complete = await runFleetGateAudit({ master, lodes })
  assert.deepEqual(complete.missing, [])
  assert.equal(complete.unnumbered.length, 6)
  for (const sample of cases) assert.ok(complete.rows.some(row => row.code === sample.code), sample.code)
  const incomplete = await runFleetGateAudit({ master: { ...halloweenMaster, api_mst_mapinfo: sortieMaster.api_mst_mapinfo }, lodes })
  assert.ok(incomplete.missing.some(row => row.code === 'B218' && row.reason === '未读出编成门'))
})
