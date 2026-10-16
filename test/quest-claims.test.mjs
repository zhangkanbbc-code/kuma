import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import { MAINTAINER_QUEST_NO_CORRECTIONS, parseKcwikiQuestPages } from '../scripts/lib/kcwiki-quests-scn.mjs'
import { unnumberedMaster } from './fixtures/quest-unnumbered-master.mjs'
import { sortieMaster } from './fixtures/quest-sortie-master.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-quest-claims-'))
const output = path.join(temp, 'runtime.cjs')
buildSync({
  stdin: { contents: [
    'export { resolveQuestClaims } from "./src/shared/quest-claims"',
    'export { createQuestEngine } from "./src/main/mg/quest-counter"',
    'export { reduceQuestList } from "./src/main/mg/quest-state"',
    'export { validateLodePack } from "./src/main/lode-validation"',
    'export { applyQuestTextCorrectionsToPack } from "./src/shared/quest-text-corrections"',
  ].join('\n'), resolveDir: root },
  outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const runtime = createRequire(import.meta.url)(output)
test.after(() => fs.rmSync(temp, { recursive: true, force: true }))
const entry = (code = '2610B9', titleJa = '南瓜祭り!  Buono?') => ({ code, titleJa, name: '南瓜任务', desc: '中文说明', memo: '奖励:南瓜×1', memo2: '备注', pre: ['B1'] })
const pack = { data: {}, unnumbered: { '2610B9': entry() } }
const observed = (title = entry().titleJa, category = 10, no = 9001) => ({ no, title, category, state: 2, type: 4, progressFlag: 0 })
const resolve = (title, category, source = pack) => runtime.resolveQuestClaims(source, [observed(title, category)])

test('认领只 trim：逐字相等通过，错字、全半角及内部空白变化全部拒绝', () => {
  assert.equal(resolve().data[9001].code, '2610B9')
  assert.equal(resolve(' \n南瓜祭り!  Buono?\t').data[9001].code, '2610B9')
  for (const title of ['南瓜祭ら!  Buono?', '南瓜祭り！  Buono?', '南瓜祭り!  Buono？', '南瓜祭り! Buono?', '南瓜祭り!   Buono?', '南瓜祭り!  Bu ono?', '']) {
    assert.deepEqual(resolve(title).claims, [], title)
  }
  const padded = structuredClone(pack)
  padded.unnumbered['2610B9'].titleJa = `  ${entry().titleJa}\n`
  assert.equal(resolve(undefined, undefined, padded).claims.length, 1)
})

test('同标题先要求唯一，类别不符、未知类别、空标题、已定号全部拒绝', () => {
  const duplicate = { ...pack, unnumbered: { ...pack.unnumbered, F9: entry('F9') } }
  assert.deepEqual(resolve(undefined, 10, duplicate).claims, [], '即使只有一条类别相符也不得消歧')
  for (const category of [0, 1, 3, 4, 5, 6, 7, 11, 12]) assert.deepEqual(resolve(undefined, category).claims, [])
  const numbered = { ...pack, data: { 9001: { ...entry('B1'), titleJa: undefined } } }
  const before = structuredClone(numbered)
  const result = resolve(undefined, 10, numbered)
  assert.deepEqual(result.claims, [])
  assert.deepEqual(result.data, numbered.data)
  assert.deepEqual(numbered, before, '原包不被改写')
  assert.deepEqual(runtime.resolveQuestClaims({ data: {} }, [observed()]).claims, [])
})

test('类别表：A=1，B=2/8/9/10，C=3，D=4，E=5，F=6/11，G=7', () => {
  for (const [letter, categories] of Object.entries({ A: [1], B: [2, 8, 9, 10], C: [3], D: [4], E: [5], F: [6, 11], G: [7] })) {
    for (const category of categories) {
      const code = `2610${letter}1`
      assert.equal(resolve(undefined, category, { data: {}, unnumbered: { [code]: entry(code) } }).data[9001].code, code)
    }
  }
})

const load = id => runtime.applyQuestTextCorrectionsToPack(JSON.parse(fs.readFileSync(path.join(root, 'assets/lodes', `${id}.json`), 'utf8')))
const lodes = Object.fromEntries(['quests-scn', 'kcwiki-localization', 'kcwiki-quest-req', 'poi-quest-goal', 'kcwiki-expedition', 'poi-fcd-map'].map(id => [id, load(id)]))
const master = { ...unnumberedMaster, api_mst_mapinfo: sortieMaster.api_mst_mapinfo }
const quiet = fn => {
  const log = console.log, warn = console.warn
  console.log = console.warn = () => {}
  try { return fn() } finally { console.log = log; console.warn = warn }
}
const world = (source, quests = {}) => {
  const player = { quests, decks: [], ships: {}, slotitems: {}, materials: [], useitems: {}, questActiveIds: Object.keys(quests).map(Number), questActiveTs: Date.now(), questsTs: Date.now() }
  const state = { player, sortie: null }
  const sent = []
  const engine = runtime.createQuestEngine({
    getLode: id => id === 'quests-scn' ? source : lodes[id] ?? null,
    ledger: { loadSnapshot: () => undefined, loadQuestProgress: () => ({}), saveQuestProgress: () => {}, deleteQuestProgress: () => {} },
    store: { getState: () => state }, send: (...args) => sent.push(args),
  })
  quiet(() => engine.init(master))
  const receive = rows => {
    const body = { api_list: rows, api_exec_count: rows.length }
    const post = { api_tab_id: '0' }
    const update = runtime.reduceQuestList(player.quests, player.questActiveIds, body, post)
    player.quests = update.quests; player.questActiveIds = update.activeIds
    quiet(() => engine.onApi('/kcsapi/api_get_member/questlist', body, post))
  }
  return { engine, player, receive, sent }
}
const rawQuest = (no, title, category) => ({ api_no: no, api_title: title, api_category: category, api_state: 2, api_type: 4, api_progress_flag: 0 })

test('984/2610B1：临时移除维护者定号后，规则、编成门、准备条件逐字段等价', () => {
  const row = lodes['quests-scn'].data[984]
  const title = '【期間限定任務】14年目実りの秋、南瓜始め！'
  const page = `{{任务表|编号=2610B1|<!---->|日文任务名字=${title}|中文任务名字=${row.name}|中文任务说明=${row.desc}|奖励=${row.memo.replace(/^奖励:/, '')}|备注=${row.memo2}|${row.pre.map((pre, index) => `前置${index || ''}=${pre}`).join('|')}}}`
  const normal = parseKcwikiQuestPages([page], new Map())
  assert.deepEqual(normal.quests[984], row)
  const index = MAINTAINER_QUEST_NO_CORRECTIONS.findIndex(correction => correction.id === 984)
  const [correction] = MAINTAINER_QUEST_NO_CORRECTIONS.splice(index, 1)
  let parsed
  try { parsed = parseKcwikiQuestPages([page], new Map()) }
  finally { MAINTAINER_QUEST_NO_CORRECTIONS.splice(index, 0, correction) }
  assert.deepEqual(parsed.quests, {})
  assert.equal(parsed.unnumbered['2610B1'].titleJa, title)
  const source = structuredClone(lodes['quests-scn'])
  delete source.data[984]
  source.unnumbered['2610B1'] = parsed.unnumbered['2610B1']
  const expected = world(lodes['quests-scn'], { 984: observed(title, 10, 984) }).engine.state().trackers[984]
  assert.ok(expected.tasks.length)
  assert.ok(expected.fleetGoal)
  const live = world(source)
  assert.equal(live.engine.state().trackers[984], undefined)
  live.receive([rawQuest(984, title, 10)])
  assert.deepEqual(live.engine.state().trackers[984], expected)
  assert.deepEqual(world(source, { 984: observed(title, 10, 984) }).engine.state().trackers[984], expected, '恢复现有任务观测即可重推')
})

test('1119：有准备项的工厂任务，认领与定号的完整追踪器相同', () => {
  const source = structuredClone(lodes['quests-scn'])
  source.unnumbered['2610Fm1'] = { ...source.data[1119], titleJa: '【期間限定】Halloweenの南瓜、食べりゅ?' }
  delete source.data[1119]
  const expected = world(lodes['quests-scn'], { 1119: observed(source.unnumbered['2610Fm1'].titleJa, 11, 1119) }).engine.state().trackers[1119]
  assert.ok(expected.stockGoals.length)
  const live = world(source)
  live.receive([rawQuest(1119, source.unnumbered['2610Fm1'].titleJa, 11)])
  assert.deepEqual(live.engine.state().trackers[1119], expected)
})

test('恢复领域状态后 reconcile 立即认领；标题或类别改变即撤销，重新下发可重推', () => {
  const row = lodes['quests-scn'].data[984]
  const title = '【期間限定任務】14年目実りの秋、南瓜始め！'
  const source = structuredClone(lodes['quests-scn'])
  delete source.data[984]
  source.unnumbered[row.code] = { ...row, titleJa: title }
  const live = world(source)
  live.player.quests = { 984: observed(title, 10, 984) }
  live.player.questActiveIds = [984]
  quiet(() => live.engine.reconcile())
  const expected = live.engine.state().trackers[984]
  assert.ok(expected.fleetGoal)
  assert.ok(live.sent.some(([channel, payload]) => channel === 'qp:state' && payload.trackers[984]))
  live.receive([rawQuest(984, `${title}x`, 10)])
  assert.equal(live.engine.state().trackers[984], undefined)
  live.receive([rawQuest(984, title, 11)])
  assert.equal(live.engine.state().trackers[984], undefined)
  live.receive([rawQuest(984, title, 10)])
  assert.deepEqual(live.engine.state().trackers[984], expected)
})

test('全库：六条新认领只增加对应编号，既有每个追踪器、编成门和准备条件逐字段不变', () => {
  const before = world(lodes['quests-scn']).engine.state().trackers
  const live = world(lodes['quests-scn'])
  const codes = ['2610Bw2', '2610Bm1', '2610Bm2', '2610B4', '2610F1', 'B218']
  const rows = codes.map((code, index) => rawQuest(9000 + index, lodes['quests-scn'].unnumbered[code].titleJa, code === '2610F1' ? 11 : 10))
  live.receive(rows)
  const after = live.engine.state().trackers
  for (const id of Object.keys(lodes['quests-scn'].data)) assert.deepEqual(after[id], before[id], id)
  for (const [id, tracker] of Object.entries(before)) assert.deepEqual(after[id], tracker, id)
  const numbered = structuredClone(lodes['quests-scn'])
  for (const [index, code] of codes.entries()) {
    const { titleJa: _titleJa, ...entry } = numbered.unnumbered[code]
    numbered.data[9000 + index] = entry
  }
  const normal = world(numbered)
  normal.receive(rows)
  assert.deepEqual(after, normal.engine.state().trackers, '新条目也完全沿用定号装配；不改变现有推导能力')
  assert.ok(after[9000]?.tasks.length)
  for (let index = 0; index < 4; index++) assert.ok(after[9000 + index]?.fleetGoal, codes[index])
  assert.ok(after[9005]?.fleetGoal, 'B218')
  assert.ok(after[9004]?.stockGoals.length, '2610F1')
})

test('未知编号按包内条目装配、实际计数及准备门生效；只在新认领时记一行日志', () => {
  const text = '废弃「小口径主炮」×3，准备「九九式舰爆」「九七式舰攻」各10个'
  const source = { data: {}, unnumbered: { F999: { ...entry('F999', '新しい工廠任務?'), desc: text, memo2: text } } }
  const live = world(source)
  const messages = []
  const log = console.log
  console.log = (...args) => messages.push(args.join(' '))
  try {
    live.player.quests = { 9001: observed('新しい工廠任務?', 11) }
    live.player.questActiveIds = [9001]
    live.engine.onApi('/kcsapi/api_get_member/questlist', { api_list: [rawQuest(9001, '新しい工廠任務?', 11)] }, {})
    live.engine.onApi('/kcsapi/api_get_member/questlist', { api_list: [rawQuest(9001, '新しい工廠任務?', 11)] }, {})
  } finally { console.log = log }
  assert.deepEqual(messages.filter(line => line.includes('任务认领')), ['[kuma] qp: 任务认领 9001 ↔ F999 ↔ 新しい工廠任務?'])
  const tracker = live.engine.state().trackers[9001]
  assert.deepEqual(tracker.tasks.map(({ kind, count }) => [kind, count]), [['scrapCategory', 3]])
  assert.ok(tracker.stockGoals.length)
  const numbered = world({ data: { 9001: { ...source.unnumbered.F999 } } }, live.player.quests)
  assert.deepEqual(tracker, numbered.engine.state().trackers[9001])
  const equip = master.api_mst_slotitem.find(item => item.api_type[2] === 1)
  quiet(() => live.engine.onApi('/kcsapi/api_req_kousyou/destroyitem2', {}, { api_slotitem_ids: '1,2' }, { destroyedSlotitems: { 1: { mstId: equip.api_id }, 2: { mstId: equip.api_id } } }))
  assert.deepEqual(live.engine.state().progress[9001], [2])
  assert.ok(live.sent.some(([channel, payload]) => channel === 'qp:state' && payload.trackers[9001]))
})

test('任务列表生产链：在已打开的列表认领后显示中文说明及奖励，原包和定号显示不变', () => {
  const mg = { quests: { 9001: observed() } }
  const host = runtimeHost()
  const bindings = {
    mg, scnLode: pack, wwByCode: new Map(), lib: new Map(), libByCode: new Map(), rowsCache: null,
    invalidateQuestTextCache: () => {}, inferredCompletedCodes: () => new Set(), registerLocalizedName: () => {},
  }
  const renderer = host.extract('src/renderer/modules/qn.ts', ['rebuildQuestLibrary', 'buildRowsUncached'], bindings).api
  const before = structuredClone(pack)
  assert.equal(renderer.buildRowsUncached()[0].desc, '')
  renderer.rebuildQuestLibrary()
  const row = renderer.buildRowsUncached()[0]
  assert.equal(row.code, '2610B9'); assert.equal(row.desc, '中文说明'); assert.equal(row.memo, '奖励:南瓜×1')
  const render = host.extract('src/renderer/modules/qn.ts', ['rowHtml'], {
    periodOfRow: () => ['单', 'o'], isInferredCompleted: () => false, isObservedActive: () => false,
    categoryOf: () => ({ key: 'test', color: 'red', label: '任务' }), state: { selected: null },
    entityNamePlain: () => row.name, entityNameHtml: () => row.name, taskProseHtml: value => value,
    progressHtml: () => '', rewardIcons: value => value, sameDayResetHtml: () => '', qp: null,
    esc: value => value, qpOf: () => null, qpNeedHtml: () => '', questVerdicts: () => new Map(),
  }).api
  assert.match(render.rowHtml(row), /中文说明/)
  assert.match(render.rowHtml(row), /奖励:南瓜×1/)
  assert.doesNotMatch(render.rowHtml(row), /以游戏内文本为准/)
  assert.match(render.rowHtml({ ...row, desc: '', code: '?' }), /以游戏内文本为准/)
  const numbered = { data: { 9001: { ...entry(), titleJa: undefined } } }
  const normalBindings = { ...bindings, scnLode: numbered }
  const normal = host.extract('src/renderer/modules/qn.ts', ['rebuildQuestLibrary', 'buildRowsUncached'], normalBindings).api
  normal.rebuildQuestLibrary()
  assert.deepEqual(normal.buildRowsUncached(), renderer.buildRowsUncached())
  assert.deepEqual(pack, before)
})

test('包校验接受可选未定号区，拒绝坏标题和坏奖励字段，旧包仍兼容', () => {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'assets/lodes/quests-scn.json'), 'utf8'))
  assert.equal(runtime.validateLodePack(source).ok, true)
  const legacy = structuredClone(source); delete legacy.unnumbered
  assert.equal(runtime.validateLodePack(legacy).ok, true)
  for (const [field, value] of [['titleJa', 123], ['memo', {}], ['pre', [123]], ['code', 'B0']]) {
    const bad = structuredClone(source); bad.unnumbered.B218[field] = value
    assert.equal(runtime.validateLodePack(bad).ok, false, field)
  }
})

test('全库显示：加入未定号区不改变任何现有任务行，也不提前显示未认领条目', () => {
  const source = lodes['quests-scn']
  const legacy = { ...source }; delete legacy.unnumbered
  const host = runtimeHost()
  const rows = pack => {
    const { api } = host.extract('src/renderer/modules/qn.ts', ['rebuildQuestLibrary', 'buildRowsUncached'], {
      mg: { quests: {} }, scnLode: pack, wwByCode: new Map(), lib: new Map(), libByCode: new Map(), rowsCache: null,
      invalidateQuestTextCache: () => {}, inferredCompletedCodes: () => new Set(), registerLocalizedName: () => {},
    })
    api.rebuildQuestLibrary()
    return api.buildRowsUncached()
  }
  assert.equal(rows(source).length, Object.keys(source.data).length)
  assert.deepEqual(rows(source), rows(legacy))
})
