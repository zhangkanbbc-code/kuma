import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build, buildSync } from 'esbuild'

import {
  syntheticExpeditionPack,
  syntheticKcwikiPack,
  syntheticLocalizationPack,
  syntheticPoiPack,
  syntheticQuestPack,
} from './fixtures/quest-lodes.mjs'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-counter-rules-'))
const output = path.join(tempDir, 'quest-counter-rules.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/main/mg/quest-counter-rules.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const rules = require(output)
const lodeUrls = {
  quests: new URL('../assets/lodes/quests-scn.json', import.meta.url),
  localization: new URL('../assets/lodes/kcwiki-localization.json', import.meta.url),
  requirements: new URL('../assets/lodes/kcwiki-quest-req.json', import.meta.url),
  poi: new URL('../assets/lodes/poi-quest-goal.json', import.meta.url),
  expedition: new URL('../assets/lodes/kcwiki-expedition.json', import.meta.url),
}
const usingFullLodes = process.env.KANSO_TEST_FORCE_SYNTHETIC !== '1'
  && Object.values(lodeUrls).every((url) => fs.existsSync(url))
const loadLode = (url, fallback) => (
  usingFullLodes ? JSON.parse(fs.readFileSync(url, 'utf8')) : fallback
)
const questPack = loadLode(lodeUrls.quests, syntheticQuestPack)
const localizationPack = loadLode(lodeUrls.localization, syntheticLocalizationPack)
const kcwikiRequirementsPack = loadLode(lodeUrls.requirements, syntheticKcwikiPack)
const poiQuestPack = loadLode(lodeUrls.poi, syntheticPoiPack)
const expeditionPack = loadLode(lodeUrls.expedition, syntheticExpeditionPack)
const questLode = questPack.data
const localizationLode = localizationPack.data
// 与主进程同源：zh + ja + 历史别名（展示名改直译系后，kcQuests 文本仍写旧译）
const equipTypeIds = rules.buildEquipTypeNameIndex(localizationLode.entities.equipType)
const engineOutput = path.join(tempDir, 'quest-counter.cjs')
// 入口是**装配层**：这条用例要的是「线上那台引擎接线之后的行为」，
// 所以照旧把 electron/矿脉/账本/状态四样换成假的，从 ipcMain 那两个口取状态。
// 引擎本体不带 electron 的这件事，由下面 'the engine bundles and runs outside Electron' 单独钉。
await build({
  entryPoints: [fileURLToPath(new URL('../src/main/mg/quest-counter-host.ts', import.meta.url))],
  outfile: engineOutput,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
  plugins: [{
    name: 'quest-counter-harness',
    setup(build) {
      const virtual = (filter, name) => build.onResolve(
        { filter },
        () => ({ path: name, namespace: 'quest-counter-harness' }),
      )
      virtual(/^electron$/, 'electron')
      virtual(/^\.\.\/lode$/, 'lode')
      virtual(/^\.\/ledger$/, 'ledger')
      virtual(/^\.\/store$/, 'store')
      build.onLoad(
        { filter: /.*/, namespace: 'quest-counter-harness' },
        ({ path: moduleName }) => {
          const modules = {
            electron: `
              export const BrowserWindow = { getAllWindows: () => [] }
              export const ipcMain = {
                handle: (name, handler) => { globalThis.__qpHandlers[name] = handler }
              }
            `,
            lode: `
              export const getLode = (id) => globalThis.__qpLodes[id] ?? null
            `,
            ledger: `
              export default {
                loadQuestProgress: () => ({}),
                loadSnapshot: () => globalThis.__qpSnapshot ?? null,
                saveQuestProgress: () => {},
                deleteQuestProgress: () => {},
              }
            `,
            store: `
              export const getState = () => globalThis.__qpStore
            `,
          }
          return { contents: modules[moduleName], loader: 'js' }
        },
      )
    },
  }],
})
globalThis.__qpHandlers = {}
globalThis.__qpLodes = {
  'quests-scn': questPack,
  'kcwiki-localization': localizationPack,
  'kcwiki-quest-req': kcwikiRequirementsPack,
  'poi-quest-goal': poiQuestPack,
  'kcwiki-expedition': expeditionPack,
}
globalThis.__qpSnapshot = {
  body: {
    api_mst_ship: [
      { api_id: 20, api_name: '軽巡A', api_stype: 3, api_soku: 10, api_sortno: 1 },
      { api_id: 21, api_name: '駆逐A', api_stype: 2, api_soku: 10, api_sortno: 2 },
      { api_id: 22, api_name: '駆逐B', api_stype: 2, api_soku: 10, api_sortno: 3 },
      { api_id: 23, api_name: '駆逐C', api_stype: 2, api_soku: 10, api_sortno: 4 },
      { api_id: 30, api_name: '鳳翔', api_stype: 7, api_soku: 10, api_sortno: 5 },
      { api_id: 628, api_name: 'Fletcher Mk.II', api_stype: 2, api_soku: 10, api_sortno: 6, api_sort_id: 32511 },
      { api_id: 2001, api_name: '美艦A', api_stype: 9, api_soku: 5, api_sortno: 7, api_sort_id: 32512 },
      { api_id: 2002, api_name: '澳艦A', api_stype: 9, api_soku: 5, api_sortno: 8, api_sort_id: 38501 },
      { api_id: 900, api_name: '敵空母A', api_stype: 11, api_sortno: 0 },
      { api_id: 901, api_name: '敵空母B', api_stype: 7, api_sortno: 0 },
    ],
    api_mst_slotitem: [
      { api_id: 10, api_name: '零式艦戦21型', api_type: [0, 0, 6, 0] },
      { api_id: 11, api_name: '九六式艦戦', api_type: [0, 0, 6, 0] },
    ],
    api_mst_slotitem_equiptype: [],
    api_mst_useitem: [],
    api_mst_mission: [
      { api_id: 37, api_disp_no: '37', api_name: '東京急行' },
      { api_id: 38, api_disp_no: '38', api_name: '東京急行(弐)' },
    ],
    api_mst_stype: [],
  },
}
globalThis.__qpStore = {
  player: {
    questsTs: Date.now(),
    questActiveTs: Date.now(),
    quests: {
      103: { no: 103, state: 2, type: 1, category: 1, title: '水雷战队', progressFlag: 0 },
      201: { no: 201, state: 2, type: 1, category: 2, title: '击破敌舰队！', progressFlag: 0 },
      210: { no: 210, state: 2, type: 1, category: 2, title: '十场战斗', progressFlag: 1 },
      211: { no: 211, state: 2, type: 1, category: 2, title: '击沉敌方空母', progressFlag: 0 },
      214: { no: 214, state: 2, type: 2, category: 2, title: 'あ号作战', progressFlag: 0 },
      226: { no: 226, state: 2, type: 2, category: 2, title: '南西诸岛制海权', progressFlag: 0 },
      410: { no: 410, state: 2, type: 1, category: 4, title: '南方运输', progressFlag: 0 },
      504: { no: 504, state: 2, type: 1, category: 6, title: '舰队酒保节', progressFlag: 1 },
      626: { no: 626, state: 2, type: 4, category: 6, title: '零战任务', progressFlag: 0 },
      920: { no: 920, state: 2, type: 1, category: 2, title: '美英澳荷舰队', progressFlag: 0 },
    },
    decks: [
      { id: 1, name: '第一舰队', ships: [1000, 1001, 1002, 1003], mission: [0, 0, 0, 0] },
      { id: 2, name: '第二舰队', ships: [1004, 1001, 1002, 1003], mission: [1, 37, 0, 0] },
      { id: 3, name: '多国舰队', ships: [2000, 2001, 2002], mission: [0, 0, 0, 0] },
    ],
    ships: {
      1000: { id: 1000, shipId: 30, lv: 80, slot: [200] },
      1001: { id: 1001, shipId: 21, lv: 50 },
      1002: { id: 1002, shipId: 22, lv: 50 },
      1003: { id: 1003, shipId: 23, lv: 50 },
      1004: { id: 1004, shipId: 20, lv: 80 },
      2000: { id: 2000, shipId: 628, lv: 90 },
      2001: { id: 2001, shipId: 2001, lv: 90 },
      2002: { id: 2002, shipId: 2002, lv: 90 },
    },
    slotitems: {
      200: { mstId: 10, level: 0, alv: 5, locked: true },
      201: { mstId: 11, level: 0, alv: 0, locked: false },
      202: { mstId: 10, level: 0, alv: 0, locked: false },
    },
    materials: [10000, 10000, 10000, 10000, 100, 100, 100, 100],
    useitems: {},
  },
  sortie: {
    practice: false,
    mapArea: 1,
    mapNo: 1,
    currentCell: 1,
    deckId: 1,
    nodes: [{ cell: 1, eventId: 4 }],
    battle: {
      prediction: { perfect: false },
      eShips: [
        { mstId: 900, hpEnd: 0 },
        { mstId: 901, hpEnd: -2 },
        { mstId: 900, hpEnd: 1 },
      ],
    },
  },
}
const engine = require(engineOutput)

test.after(() => {
  delete globalThis.__qpHandlers
  delete globalThis.__qpLodes
  delete globalThis.__qpSnapshot
  delete globalThis.__qpStore
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('base practice quests get local counters even when EO has no tracker', () => {
  assert.deepEqual(
    rules.derivePracticeTasks('Cd1', '今天对其他司令官的舰队发起3次「演习」！', '无论胜负'),
    [{ kind: 'exercise', rank: 0, count: 3 }],
  )
  assert.deepEqual(
    rules.derivePracticeTasks('Cd2', '今天对其他司令官的舰队发起「演习」胜利5次以上！'),
    [{ kind: 'exercise', rank: 4, count: 5 }],
  )
  assert.deepEqual(
    rules.derivePracticeTasks('C32', '使用该舰队在本日演习中获得【S胜利】4次以上！'),
    [{ kind: 'exercise', rank: 6, count: 4 }],
  )
})

test('practice fallback refuses partial counters for composite quests', () => {
  assert.deepEqual(
    rules.derivePracticeTasks(
      'C15',
      '第一舰队演习胜利3次，并在之后将该舰队投入西南诸岛海域出击。',
    ),
    [],
  )
})

test('generic expedition counters distinguish dispatch from successful return', () => {
  assert.deepEqual(
    rules.deriveExpeditionTasks('D1', '舰队出发「远征」！', '任意远征1次'),
    [{ kind: 'action', action: 'expedition_start', label: '派出远征', count: 1 }],
  )
  assert.deepEqual(
    rules.deriveExpeditionTasks('Dw1', '本周「远征」成功30次！'),
    [{ kind: 'expedition', missionId: 0, count: 30 }],
  )
})

test('periodic counters wait for an active-set confirmation in the current reset period', () => {
  const player = globalThis.__qpStore.player
  const current = player.questActiveTs
  const before = globalThis.__qpHandlers['qp:get']().progress[504]
  player.questActiveTs = Date.now() - 2 * 86_400_000
  engine.onQuestApi('/kcsapi/api_req_hokyu/charge', {}, {})
  assert.deepEqual(globalThis.__qpHandlers['qp:get']().progress[504], before)
  player.questActiveTs = current
})

test('only the three generic daily sortie memos derive battle counters', () => {
  assert.deepEqual(
    rules.deriveSortieTasks('Bd1', '出击胜利一次'),
    [{ kind: 'battleWin', rank: 4, count: 1 }],
  )
  assert.deepEqual(
    rules.deriveSortieTasks('Bd3', '十场战斗可完成'),
    [{ kind: 'battleWin', rank: 0, count: 10 }],
  )
  assert.deepEqual(
    rules.deriveSortieTasks('Bd2', '出击一次（失败可完成）'),
    [{ kind: 'battleWin', rank: 0, count: 1 }],
  )
})

test('sortie fallback refuses composite, map-specific, and enemy-type objectives', () => {
  assert.deepEqual(
    rules.deriveSortieTasks('Bw1', '出击36次 进入BOSS点24次 BOSS战胜利12次 S胜6次'),
    [],
  )
  assert.deepEqual(
    rules.deriveSortieTasks('Bd7', '击破「南西群岛海域」任意BOSS点五次'),
    [],
  )
  assert.deepEqual(
    rules.deriveSortieTasks('Bd4', '击沉敌方3艘正规空母或轻空母 日期尾数为3/7/0时出现'),
    [],
  )
})

test('sortie fallback remains limited to the audited three quests', () => {
  const derived = Object.entries(questLode)
    .filter(([, quest]) => rules.deriveSortieTasks(quest.code ?? '', quest.memo2 ?? '').length > 0)
    .map(([id]) => Number(id))
  assert.deepEqual(derived, [201, 210, 216])
})

test('quest counter reports the audited synthetic-master coverage split', () => {
  const state = globalThis.__qpHandlers['qp:get']()
  if (usingFullLodes) {
    // ⚠ 这几个数只在**这份十条舰的合成主数据**下成立，不是真机口径：
    // 自研那几档要拿真实主数据解具名舰/装备/点位，合成主数据下大批规则整条弃用
    // （日志里那串「艦素规则 xxx 跳过」正是护栏在起作用）。真机数字看 packCredit。
    //
    // EO（quest-trackers）2026-08-21 整层退场，原来钉的 eo 163 一并撤销；
    // 它供的那 164 条现在按优先级落回 kcwiki / poi / 自研三层，
    // 所以 kcwiki 与 kanso 两栏都涨了，总数则因为「合成主数据解不出的整条弃用」而下降。
    assert.equal(Object.keys(state.trackers).length, 249)
    // 2026-08-20 第二批文案清扫：逐源拆分与源站名号撤出 packCredit（那是发布侧悬停），
    // 审计本身改从 trackers 直接算——覆盖数字仍要逐源钉死，只是不再摆给玩家。
    const split = {}
    for (const tracker of Object.values(state.trackers)) {
      split[tracker.source] = (split[tracker.source] ?? 0) + 1
    }
    // 2026-08-27 接上 kcwiki 的 simple/scrapship：603（原落中文散文兜底）与 609（原落 poi
    // 的 destroy_ship）改由结构化层供规则，kcwiki +2、text −1、poi −1，总数 249 不变。
    assert.deepEqual(split, { kcwiki: 148, poi: 25, text: 19, kanso: 57 })
    assert.match(state.packCredit, /精确计数覆盖 249 \/ 644 条/)
    assert.match(state.packCredit, / · 规则更新 \d{4}-\d{2}-\d{2}$/)
    assert.doesNotMatch(state.packCredit, /EO|KCWiki|poi/, '发布侧署名不该回潮')
    return
  }
  assert.match(state.packCredit, new RegExp(`/ ${Object.keys(questLode).length} 条`))
  assert.ok(Object.keys(state.trackers).length >= 10)
})

test('quest rule sources keep KCWiki, poi, kanso, and text in strict priority order', () => {
  const state = globalThis.__qpHandlers['qp:get']()
  assert.equal(state.trackers[410].source, 'kcwiki')
  assert.equal(state.trackers[605].source, 'poi')
  // 艦素自研排在两个上游之后、文本兜底之前：342/Cq4 两个上游都没有，落到自研；
  // 601/F1「「建造」舰船1次」自研这套也解不出（不是演习/远征/废弃），继续由文本兜底。
  assert.equal(state.trackers[342].source, 'kanso')
  assert.equal(state.trackers[601].source, 'text')
  // 上游有的，自研一条都不许抢——410 是 kcwiki 的远征任务，正是自研这批的射程之内
  assert.equal(state.trackers[433].source, 'kanso')
  assert.equal(state.trackers[402].source, 'kcwiki')
  // EO（quest-trackers）2026-08-21 整层退场：这个源号不该以任何形式回潮
  assert.ok(
    Object.values(state.trackers).every((tracker) => tracker.source !== 'eo'),
    'EO 已退场，不该再有 source==="eo" 的追踪器',
  )
})

test('one expedition result advances a shared alternative slot only once', () => {
  // missionId 由调用方在归约**前**抓好、经 context 传入——归约器处理 mission/result
  // 时会把 deck.mission 清零，事后从 state 读永远是 0，指定远征任务就全都不涨
  engine.onQuestApi(
    '/kcsapi/api_req_mission/result',
    { api_clear_result: 1 },
    { api_deck_id: '2' },
    { expeditionMissionId: 37 },
  )
  assert.deepEqual(globalThis.__qpHandlers['qp:get']().progress[410], [1])
})

test('expedition counting must not read deck.mission after reduction zeroed it', () => {
  // 不带 context（= 归约后 state 里已经没有 missionId）：指定远征不得误涨
  const before = globalThis.__qpHandlers['qp:get']().progress[410]?.[0] ?? 0
  engine.onQuestApi(
    '/kcsapi/api_req_mission/result',
    { api_clear_result: 1 },
    { api_deck_id: '2' },
  )
  assert.equal(globalThis.__qpHandlers['qp:get']().progress[410]?.[0] ?? 0, before)
})

test('fleet checks expose a readable difference for every deck', () => {
  const check = globalThis.__qpHandlers['qp:check-fleet']()
  assert.deepEqual(check[103].decks, [2])
  assert.equal(check[103].diffs[0].ok, false)
  assert.equal(check[103].diffs[0].lines[0].issue, '旗舰不符合「軽巡」')
  assert.equal(check[103].diffs[1].ok, true)
})

test('nationality gates resolve through api_sort_id and still admit the right deck', () => {
  // EO 退场前这道门由 EO 的条件树（tag 6）表达，测的是 920/B148；退场后它由自研的
  // fleetGoal 表达，编号段仍按 api_sort_id 算——与装备加成、图鉴筛选共用
  // shared/ship-nationality 那一份。判据没变：**只有多国舰队那一队能过门**。
  // 这里注入一条合成任务而不是继续钉 920：本套用例跑的是十条舰的合成主数据，
  // 真任务的旗舰具名舰在里面解析不出来，钉真任务等于钉住了「主数据够不够全」。
  const originalQuests = globalThis.__qpLodes['quests-scn']
  const player = globalThis.__qpStore.player
  globalThis.__qpLodes['quests-scn'] = {
    data: {
      ...originalQuests.data,
      9940: {
        code: 'C9940',
        name: '多国籍演习',
        desc: '编成包含美国、澳大利亚出身的舰娘2艘以上的演习舰队，本日中取得4次S胜！',
        memo: '',
        memo2: '',
        pre: [],
      },
    },
  }
  player.quests[9940] = { no: 9940, state: 2, type: 1, category: 2, title: '多国籍编队', progressFlag: 0 }
  try {
    engine.initQuestCounter()
    const goal = globalThis.__qpHandlers['qp:get']().trackers[9940].fleetGoal
    const nation = goal.groups.find((group) => group.amount === 2)
    // 628/2001 的 api_sort_id 落在美国段、2002 落在澳大利亚段；日本籍那几艘一个都不该进来
    assert.deepEqual([...nation.ships].sort((a, b) => a - b), [628, 2001, 2002])
    const check = globalThis.__qpHandlers['qp:check-fleet']()
    assert.equal(check[9940].hasCond, true)
    assert.deepEqual(check[9940].decks, [3])
  } finally {
    globalThis.__qpLodes['quests-scn'] = originalQuests
    delete player.quests[9940]
    engine.initQuestCounter()
  }
})

test('model conversion scraps count only while the secretary equipment gate is satisfied', () => {
  const firstDeck = globalThis.__qpStore.player.decks[0]
  const originalShips = firstDeck.ships
  firstDeck.ships = [-1, ...originalShips]
  let check = globalThis.__qpHandlers['qp:check-fleet']()
  assert.match(
    check[626].stateGoal.lines.find((line) => line.label.startsWith('秘书舰')).issue,
    /没有秘书舰/,
  )
  firstDeck.ships = originalShips

  check = globalThis.__qpHandlers['qp:check-fleet']()
  assert.equal(check[626].stateGoal.ok, false)
  assert.match(
    check[626].stateGoal.lines.find((line) => line.label === '零式艦戦21型').issue,
    /练度不满/,
  )

  engine.onQuestApi(
    '/kcsapi/api_req_kousyou/destroyitem2',
    {},
    { api_slotitem_ids: '201' },
  )
  assert.equal(globalThis.__qpHandlers['qp:get']().progress[626], undefined)

  globalThis.__qpStore.player.slotitems[200].alv = 7
  check = globalThis.__qpHandlers['qp:check-fleet']()
  assert.equal(check[626].stateGoal.ok, true)
  engine.onQuestApi(
    '/kcsapi/api_req_kousyou/destroyitem2',
    {},
    { api_slotitem_ids: '201' },
  )
  assert.deepEqual(globalThis.__qpHandlers['qp:get']().progress[626], [0, 1])
})

test('sortie results add every enemy sunk in the audited stypes', () => {
  engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'B' }, {})
  assert.deepEqual(globalThis.__qpHandlers['qp:get']().progress[211], [2])
})

test('battle results count B victories but not C defeats for generic sortie wins', () => {
  engine.onQuestApi('/kcsapi/api_req_quest/clearitemget', {}, { api_quest_id: '201' })
  engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'C' }, {})
  assert.equal(globalThis.__qpHandlers['qp:get']().progress[201], undefined)

  engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'B' }, {})
  assert.deepEqual(globalThis.__qpHandlers['qp:get']().progress[201], [1])
})

test('kcwiki map-range alternatives count into one boss-win slot', () => {
  const sortie = globalThis.__qpStore.sortie
  const before = {
    mapArea: sortie.mapArea,
    mapNo: sortie.mapNo,
    currentCell: sortie.currentCell,
    nodes: sortie.nodes,
  }
  Object.assign(sortie, {
    mapArea: 2,
    mapNo: 3,
    currentCell: 7,
    nodes: [{ cell: 7, eventId: 5 }],
  })
  for (let i = 0; i < 5; i += 1) {
    engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'B' }, {})
  }
  assert.deepEqual(globalThis.__qpHandlers['qp:get']().progress[226], [5])
  Object.assign(sortie, before)
})

test('a-gou advances sortie, boss arrival, boss victory, and S victory separately', () => {
  const sortie = globalThis.__qpStore.sortie
  const beforeProgress = (
    globalThis.__qpHandlers['qp:get']().progress[214] ?? [0, 0, 0, 0]
  ).slice()
  const before = {
    mapArea: sortie.mapArea,
    mapNo: sortie.mapNo,
    currentCell: sortie.currentCell,
    nodes: sortie.nodes,
  }
  Object.assign(sortie, {
    mapArea: 2,
    mapNo: 3,
    currentCell: 7,
    nodes: [{ cell: 7, eventId: 5 }],
  })
  engine.onQuestApi('/kcsapi/api_req_map/start', { api_no: 7 }, {})
  engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'S' }, {})
  const afterProgress = globalThis.__qpHandlers['qp:get']().progress[214]
  assert.deepEqual(
    afterProgress.map((count, index) => count - (beforeProgress[index] ?? 0)),
    [1, 1, 1, 1],
  )
  Object.assign(sortie, before)
})

// ---- あ号（Bw1/214）四轴口径的钉子 ----
//
// 钉子取自本机账本的真实场次：修正前多计、修正后不计。
// 口径出处见 kcwiki-quest-rules.ts 的 decodeAGou 与 quest-counter.ts 的 bossReach 分支。
const agouDelta = (run) => {
  const sortie = globalThis.__qpStore.sortie
  const before = {
    mapArea: sortie.mapArea,
    mapNo: sortie.mapNo,
    currentCell: sortie.currentCell,
    nodes: sortie.nodes,
  }
  const start = (globalThis.__qpHandlers['qp:get']().progress[214] ?? [0, 0, 0, 0]).slice()
  try {
    run(sortie)
  } finally {
    Object.assign(sortie, before)
  }
  const end = globalThis.__qpHandlers['qp:get']().progress[214] ?? [0, 0, 0, 0]
  return [0, 1, 2, 3].map((i) => (end[i] ?? 0) - (start[i] ?? 0))
}

test('a-gou: 到达 boss 后撤退不打，ボス到達 不计', () => {
  // 实弹：2026-08-12 01:28:41 6-5 cell18 到达 boss 未交战（本机账本共 7 次这样的场次）。
  // 修正前挂在 map/next 上照样 +1，游戏那边一次都没算。
  const delta = agouDelta((sortie) => {
    Object.assign(sortie, { mapArea: 6, mapNo: 5, currentCell: 18, nodes: [{ cell: 18, eventId: 5 }] })
    engine.onQuestApi('/kcsapi/api_req_map/next', { api_no: 18 }, {})
    // 提督在 boss 格按了撤退：没有任何 battleresult
  })
  assert.deepEqual(delta, [0, 0, 0, 0], '到达 boss 却没打，四轴一个都不该动')
})

test('a-gou: boss 战打输，ボス到達 照计、ボス撃破 不计', () => {
  // 到達与胜负无关（C 败也 +1），撃破要 B 以上
  //（wikiwiki 任務攻略データ：「ボス勝利はAやBでも良い」）。
  const delta = agouDelta((sortie) => {
    Object.assign(sortie, { mapArea: 2, mapNo: 3, currentCell: 7, nodes: [{ cell: 7, eventId: 5 }] })
    engine.onQuestApi('/kcsapi/api_req_map/next', { api_no: 7 }, {})
    engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'C' }, {})
  })
  assert.deepEqual(delta, [0, 1, 0, 0], 'C 败：只进ボス到達')
})

test('a-gou: 出撃按出港次数计，零战斗也算', () => {
  // 6-1 带 2 战舰走 B 格「気のせいだった」，一场不打直接回港，出撃仍 +1
  //（wikiwiki 6-1 页 + ElectronicObserver kcmemo「戦闘を行う必要はない」）。
  const delta = agouDelta((sortie) => {
    Object.assign(sortie, { mapArea: 6, mapNo: 1, currentCell: 2, nodes: [{ cell: 2, eventId: 6 }] })
    engine.onQuestApi('/kcsapi/api_req_map/start', { api_no: 2 }, {})
  })
  assert.deepEqual(delta, [1, 0, 0, 0], '零战斗出港：只进出撃轴')
})

test('a-gou: 道中 S 胜计入 S勝利，演習 S 胜不计', () => {
  // 「S勝利は道中でも良く」——不限 boss 格；演習走 practice 分支，与出撃任务无关。
  const roaming = agouDelta((sortie) => {
    Object.assign(sortie, { mapArea: 2, mapNo: 3, currentCell: 4, nodes: [{ cell: 4, eventId: 4 }] })
    engine.onQuestApi('/kcsapi/api_req_sortie/battleresult', { api_win_rank: 'S' }, {})
  })
  assert.deepEqual(roaming, [0, 0, 0, 1], '道中 S：只进 S勝利轴，不碰 boss 两轴')

  const practice = agouDelta(() => {
    engine.onQuestApi('/kcsapi/api_req_practice/battle_result', { api_win_rank: 'S' }, {})
  })
  assert.deepEqual(practice, [0, 0, 0, 0], '演習 S 胜一轴都不该动')
})

test('server progress flags expose a lower bound without overwriting or lowering local counts', () => {
  let state = globalThis.__qpHandlers['qp:get']()
  assert.deepEqual(state.serverFloors[504], { flag: 1, counts: [8] })
  assert.equal(state.progress[504], undefined)

  for (let i = 0; i < 9; i += 1) {
    engine.onQuestApi('/kcsapi/api_req_hokyu/charge', {}, {})
  }
  state = globalThis.__qpHandlers['qp:get']()
  assert.deepEqual(state.progress[504], [9])

  globalThis.__qpStore.player.quests[504].progressFlag = 0
  engine.onQuestApi('/kcsapi/api_get_member/questlist', { api_list: [] }, {})
  state = globalThis.__qpHandlers['qp:get']()
  assert.equal(state.serverFloors[504], undefined)
  assert.deepEqual(state.progress[504], [9])
})

test('multi-task quests never get per-slot floors from the whole-quest flag', () => {
  // 用户实弹撞到的：自报 ≥50% 是整条任务的口径，四个废弃子项里三满一零
  // 平均照样过半——把它摊到每个槽会把没做的那项凭空抬到 ≥10/20，
  // 玩家反而不知道还要拆多少。多计数槽的任务不允许从粗档推逐槽下限。
  const quest214 = globalThis.__qpStore.player.quests[214]
  const originalFlag = quest214.progressFlag
  quest214.progressFlag = 1
  try {
    const state = globalThis.__qpHandlers['qp:get']()
    assert.ok(state.trackers[214].tasks.length > 1, 'あ号必须是多子项样本')
    assert.equal(state.serverFloors[214], undefined)
  } finally {
    quest214.progressFlag = originalFlag
  }
})

test('equipment-category scrapping derives counts and marks resource preparation partial', () => {
  assert.deepEqual(
    rules.deriveFallbackTracker(
      questLode[673].code,
      questLode[673].desc,
      questLode[673].memo2,
      equipTypeIds,
    ),
    {
      tasks: [{ kind: 'scrapCategory', category: 1, count: 4 }],
      partial: false,
    },
  )
  assert.deepEqual(
    rules.deriveFallbackTracker(
      questLode[676].code,
      questLode[676].desc,
      questLode[676].memo2,
      equipTypeIds,
    ),
    {
      tasks: [
        { kind: 'scrapCategory', category: 2, count: 3 },
        { kind: 'scrapCategory', category: 4, count: 3 },
      ],
      partial: true,
    },
  )
})

test('equipment-category scrapping remains limited to the audited fourteen quests', () => {
  // 这一条钉的是**文本兜底解析器自己**的射程，与「最后谁供给这条任务」无关
  // （EO 退场前这里拿 EO 覆盖集当排除项，那只是当时的一个代理；1139/F124 与
  // 1151/F132 就是被那个代理挡掉的两条，射程里本来就有它们）。
  // 现役废弃类基本已由 kcwiki/poi/自研推导接住，兜底解析器只该在这十四条上开火；
  // 多一条就说明正则放宽了，少一条说明它哑了。
  const derived = Object.entries(questLode)
    .filter(([, quest]) => (
      rules.deriveFallbackTracker(
        quest.code ?? '',
        quest.desc ?? '',
        quest.memo2 ?? '',
        equipTypeIds,
      ).tasks.some((task) => task.kind === 'scrapCategory')
    ))
    .map(([id]) => Number(id))
  assert.deepEqual(derived, [657, 661, 662, 663, 665, 673, 675, 676, 679, 682, 691, 692, 1139, 1151])
})

test('factory fallback keeps material names and specified equipment out of action counters', () => {
  assert.deepEqual(rules.deriveActionTasks('准备高速建造材5个及开发资材10个。'), [])
  assert.deepEqual(rules.deriveActionTasks('废弃「零式舰战21型」×2。'), [])
  assert.deepEqual(
    rules.deriveActionTasks('从各舰队入渠5艘以上需要整备的舰艇，实施大规模整备！'),
    [{ kind: 'action', action: 'nyukyo', label: '入渠', count: 5 }],
  )
})

test('batched factory APIs increment by actual operations instead of requests', () => {
  assert.equal(rules.actionIncrement('destroyship', {}, { api_ship_id: '11,12,13' }), 3)
  // 一括廃棄＝1 回：613「资源的再利用」按操作回数计，不是件数。
  // 真报文样本（一次勾十件按「廃棄」）——2026-08-27 用户实测就是这么弃的，游戏只给了 1 回。
  assert.equal(
    rules.actionIncrement(
      'destroyitem',
      {},
      { api_slotitem_ids: '1381,1382,1383,1384,1385,1386,1387,1388,1389,1390' },
    ),
    1,
  )
  assert.equal(rules.actionIncrement('destroyitem', {}, { api_slotitem_ids: '21,22' }), 1)
  assert.equal(rules.actionIncrement('destroyitem', {}, { api_slotitem_ids: '21' }), 1)
  // batch:true 那一族（624 等）反过来按件：同一份批量报文要给出 +n。
  assert.equal(
    rules.actionIncrement(
      'destroyitem',
      {},
      { api_slotitem_ids: '1381,1382,1383,1384,1385,1386,1387' },
      { perItem: true },
    ),
    7,
  )
  assert.equal(
    rules.actionIncrement('destroyitem', {}, { api_slotitem_ids: '21' }, { perItem: true }),
    1,
  )
  // perItem 只对废弃生效：解体本来就按艘，补给这类没有件数概念的仍是每次操作 +1。
  assert.equal(
    rules.actionIncrement('charge', {}, { api_slotitem_ids: '21,22' }, { perItem: true }),
    1,
  )
  assert.equal(
    rules.actionIncrement(
      'createitem',
      { api_get_items: [{ api_id: 1 }, { api_id: -1 }, { api_id: 2 }] },
      {},
    ),
    3,
  )
  assert.equal(rules.actionIncrement('nyukyo', {}, {}), 1)
})

// 上面那条只钉纯函数。这两条走**真派发**，把「同一份批量报文，两族任务各走各的口径」按住：
// 613 那种「任意装备废弃 N 回」按操作回数 +1，626 那种「××を2つ廃棄」仍按件数 +n。
// 这两族同走 destroyitem2，改错一边不会被纯函数用例照出来。
test('one batch scrap advances the any-equipment quest by a single operation', {
  skip: !usingFullLodes,
}, () => {
  const player = globalThis.__qpStore.player
  // 613「资源的再利用」（Fw1，memo2 写「废弃装备24次」）。2026-08-27 用户实测：
  // 批量弃 10+10+2 件后游戏进度远不到一半，逐件弃到第 24 次操作才达成。
  player.quests[613] = {
    no: 613,
    state: 2,
    type: 3,
    category: 6,
    title: '资源的再利用',
    progressFlag: 0,
  }
  try {
    const tracker = globalThis.__qpHandlers['qp:get']().trackers[613]
    assert.deepEqual(
      tracker.tasks.map((task) => [task.kind, task.action, task.count]),
      [['action', 'destroyitem', 24]],
      '613 必须还是走 action 轴的 destroyitem 任务，否则这条用例护不到东西',
    )
    const before = globalThis.__qpHandlers['qp:get']().progress[613]?.[0] ?? 0
    engine.onQuestApi(
      '/kcsapi/api_req_kousyou/destroyitem2',
      { api_get_material: [0, 0, 20, 4] },
      { api_slotitem_ids: '1381,1382,1383,1384,1385,1386,1387,1388,1389,1390' },
    )
    assert.equal(
      globalThis.__qpHandlers['qp:get']().progress[613][0],
      before + 1,
      '一次批量弃十件只算 1 回；按件计会直接虚报成 10',
    )
  } finally {
    delete player.quests[613]
    delete globalThis.__qpHandlers['qp:get']().progress[613]
  }
})

test('a batch scrap fills a per-item quest by the number of items', {
  skip: !usingFullLodes,
}, () => {
  const player = globalThis.__qpStore.player
  // 624「试作舣装的准备」（F21）：上游 kcwiki 标 batch:true，任务正文写「7 个装备道具废弃」、
  // memo2 写「废弃 7 个装备完成任务」——个≠次，所以一次批量弃 7 件就该直接满。
  player.quests[624] = {
    no: 624,
    state: 2,
    type: 1,
    category: 6,
    title: '试作舣装的准备',
    progressFlag: 0,
  }
  try {
    const tracker = globalThis.__qpHandlers['qp:get']().trackers[624]
    assert.equal(tracker.source, 'kcwiki', '624 必须走 kcwiki 结构化层，否则这条护不到 batch 分流')
    assert.deepEqual(
      tracker.tasks.map((task) => [task.kind, task.action, task.count, task.perItem ?? false]),
      [['action', 'destroyitem', 7, true]],
      '624 得是标了 perItem 的 destroyitem 任务',
    )
    const before = globalThis.__qpHandlers['qp:get']().progress[624]?.[0] ?? 0
    engine.onQuestApi(
      '/kcsapi/api_req_kousyou/destroyitem2',
      { api_get_material: [0, 0, 14, 3] },
      { api_slotitem_ids: '1381,1382,1383,1384,1385,1386,1387' },
    )
    assert.equal(
      globalThis.__qpHandlers['qp:get']().progress[624][0],
      before + 7,
      '一括廃棄 7 件要一次填满；按操作回数只会 +1、少计到永远差 6 格',
    )
  } finally {
    delete player.quests[624]
    delete globalThis.__qpHandlers['qp:get']().progress[624]
  }
})

test('a batch dismantle advances the scrap-ship quest once per ship', {
  skip: !usingFullLodes,
}, () => {
  const player = globalThis.__qpStore.player
  // 609「军缩条约对应！」（Fd5）：上游 kcwiki 给了 scrapship，接上之后不该再穿透到散文层。
  // 口径按**艘**——2026-08-27 用户实测一次批量解体 2 艘直接达成（11:51:15 解体 → 11:52:13 领奖），
  // 尽管 memo2 那栏写的是「解体舰船2次」。
  player.quests[609] = {
    no: 609,
    state: 2,
    type: 2,
    category: 6,
    title: '军缩条约对应！',
    progressFlag: 0,
  }
  try {
    const tracker = globalThis.__qpHandlers['qp:get']().trackers[609]
    assert.equal(tracker.source, 'kcwiki', '609 得从 kcwiki 的 scrapship 拿规则，不再走中文散文兜底')
    assert.deepEqual(
      tracker.tasks.map((task) => [task.kind, task.action, task.count]),
      [['action', 'destroyship', 2]],
    )
    const before = globalThis.__qpHandlers['qp:get']().progress[609]?.[0] ?? 0
    engine.onQuestApi(
      '/kcsapi/api_req_kousyou/destroyship',
      { api_material: [0, 0, 0, 0] },
      { api_ship_id: '301,302' },
    )
    assert.equal(
      globalThis.__qpHandlers['qp:get']().progress[609][0],
      before + 2,
      '一次批量解体 2 艘要 +2 并直接达成',
    )
  } finally {
    delete player.quests[609]
    delete globalThis.__qpHandlers['qp:get']().progress[609]
  }
})

test('the same batch still advances a named-equipment scrap quest once per item', () => {
  const player = globalThis.__qpStore.player
  // 626 是「零式艦戦21型×2、九六式艦戦×1」——指定装备件数任务，一次弃两件目标装备就该 +2。
  player.slotitems = { ...player.slotitems }
  player.slotitems[200].alv = 7 // 秘书舰装备门（同上一条用例）
  player.slotitems[210] = { mstId: 10, level: 0, alv: 0, locked: false }
  player.slotitems[211] = { mstId: 10, level: 0, alv: 0, locked: false }
  const slot0 = globalThis.__qpHandlers['qp:get']().progress[626]?.[0] ?? 0
  engine.onQuestApi(
    '/kcsapi/api_req_kousyou/destroyitem2',
    { api_get_material: [0, 0, 4, 0] },
    { api_slotitem_ids: '210,211' },
  )
  assert.equal(
    globalThis.__qpHandlers['qp:get']().progress[626][0],
    slot0 + 2,
    '指定装备件数任务不受废弃回数改动影响，一次弃两件仍 +2',
  )
})

test('every standalone practice quest gets a safe fallback counter from its text alone', {
  skip: !usingFullLodes,
}, () => {
  let checked = 0
  for (const [, quest] of Object.entries(questLode)) {
    const text = `${quest?.desc ?? ''} ${quest?.memo2 ?? ''}`.normalize('NFKC')
    if (!quest?.code?.startsWith('C') || !/演习/.test(text)) continue
    if (/出击|废弃|解体|搭载|装备于|配置于|之后/.test(text)) continue
    const tasks = rules.derivePracticeTasks(quest.code, quest.desc, quest.memo2)
    assert.equal(tasks.length, 1, `${quest.code} ${quest.name}`)
    assert.equal(tasks[0].kind, 'exercise')
    assert.ok(tasks[0].count >= 1)
    checked += 1
  }
  assert.ok(checked >= 20)
})

test('convertible remodels still satisfy bare-name fleet gates after reinit', () => {
  // 实弹事故（2026-08-10）：初夏限定 1031 的编成判定不认榛名改二乙/丙、
  // 夕張改二/特/丁、宗谷后两形态——单值 prev 反向链被可逆改装的回环边覆盖，
  // 链根回溯走进环就折返，真实主数据 332 个改造家族里 23 个因此分裂。
  // 这里以最小家族复刻：340→341→342⇄343 回环 + 344 只在原生升级表里有边。
  //
  // 2026-08-21 EO 退场后这条路改由 kcwiki 的具名舰组走（形态展开在装载期完成，
  // 判定期不再回溯改造链），复刻的注入源随之从 quest-trackers 换成 kcwiki-quest-req；
  // 咬人的那个判据一个字没变：**素名必须展开到整条链，回环与升级表独占分支都要认**。
  const originalKcwiki = globalThis.__qpLodes['kcwiki-quest-req']
  const originalQuests = globalThis.__qpLodes['quests-scn']
  const player = globalThis.__qpStore.player
  globalThis.__qpLodes['kcwiki-quest-req'] = {
    data: {
      ...originalKcwiki.data,
      9931: { category: 'fleet', groups: [{ ship: '回归舰' }] },
    },
  }
  globalThis.__qpLodes['quests-scn'] = {
    data: {
      ...originalQuests.data,
      9931: { code: 'A9931', name: '可逆改装回归', desc: '', memo: '', memo2: '', pre: [] },
    },
  }
  player.quests[9931] = { no: 9931, state: 2, type: 1, category: 2, title: '可逆改装回归', progressFlag: 0 }
  player.decks.push({ id: 4, name: '回归舰队', ships: [4001], mission: [0, 0, 0, 0] })
  player.ships[4001] = { id: 4001, shipId: 343, lv: 90 }
  try {
    engine.initQuestCounter({
      ...globalThis.__qpSnapshot.body,
      api_mst_ship: [
        ...globalThis.__qpSnapshot.body.api_mst_ship,
        { api_id: 340, api_name: '回归舰', api_stype: 3, api_soku: 10, api_sortno: 90, api_aftershipid: '341' },
        { api_id: 341, api_name: '回归舰改', api_stype: 3, api_soku: 10, api_sortno: 91, api_aftershipid: '342' },
        { api_id: 342, api_name: '回归舰改二', api_stype: 3, api_soku: 10, api_sortno: 92, api_aftershipid: '343' },
        { api_id: 343, api_name: '回归舰改二乙', api_stype: 3, api_soku: 10, api_sortno: 93, api_aftershipid: '342' },
        { api_id: 344, api_name: '回归舰改二丙', api_stype: 3, api_soku: 10, api_sortno: 94 },
      ],
      api_mst_shipupgrade: [
        { api_id: 344, api_current_ship_id: 342, api_original_ship_id: 340, api_upgrade_level: 2 },
      ],
    })
    // 改二乙（回环成员）在队 → 素名「回归舰」的编成门必须认
    const check = globalThis.__qpHandlers['qp:check-fleet']()
    assert.deepEqual(check[9931].decks, [4])
    // 升级表独占的分支形态（没有 aftershipid 指向它）同样要认
    player.ships[4001].shipId = 344
    assert.deepEqual(globalThis.__qpHandlers['qp:check-fleet']()[9931].decks, [4])
    // 展开集合本身也钉住：五个形态一个都不能漏（漏了就是链又被劈开了）
    const goal = globalThis.__qpHandlers['qp:get']().trackers[9931].fleetGoal
    assert.deepEqual([...goal.groups[0].ships].sort((a, b) => a - b), [340, 341, 342, 343, 344])
  } finally {
    globalThis.__qpLodes['kcwiki-quest-req'] = originalKcwiki
    globalThis.__qpLodes['quests-scn'] = originalQuests
    delete player.quests[9931]
    player.decks.pop()
    delete player.ships[4001]
    engine.initQuestCounter()
  }
})
