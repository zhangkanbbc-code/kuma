// 改修素材的游戏实测（维护者 2026-11-28 问：「可不可以让 kuma 识别『改修这个行为之后的装备变化』来判断素材？」
// 「能否区分开是普通改修还是保正改修？」）。
// 每次改修的响应交出吞掉的装备实例（api_use_slot_id）与扣完的资源（api_after_material），请求带打法（api_certain_flag）。
// 他账本里 11-24 那 8 次熟练见张员改修就是现成的证据：★6→7 只吞 1 个熟练见张员，★7 起每次再加 1 个战斗粮食，资料按档只写了前者。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { expandedOf, foldedOf, todayRows } from './fixtures/render-today-improve.mjs'
import { improveCardHtml } from './fixtures/render-improve-card.mjs'
import { openLedger } from './fixtures/phantom-consumable-ledger.mjs'
import {
  REAL_REMODEL_SLOT_BODY,
  REAL_REMODEL_SLOT_POST,
  IMPROVE_266,
  feedRemodelSlot,
  remodelLog,
  reset,
  slotitems,
} from './fixtures/store-remodel-cost.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const R = require(path.join(ROOT, 'dist/shared/improve-remodel.js'))
const { improveRemodelsFromEvents } = require(path.join(ROOT, 'dist/main/mg/improve-remodel-backfill.js'))
const retention = require(path.join(ROOT, 'dist/shared/ledger-retention.js'))

const LOOKOUT = 129 // 熟練見張員
const RATION = 145 // 戦闘糧食
const T0 = Date.parse('2026-11-24T20:40:00+09:00')
const rec = (level, fodder, extra = {}) => ({
  ts: T0 + level * 60e3,
  eq: LOOKOUT,
  level,
  afterEq: LOOKOUT,
  afterLevel: level + 1,
  certain: level >= 6,
  ok: true,
  helper: 69,
  fodder: fodder.map(([id, count]) => ({ id, count })),
  cost: { fuel: 20, bull: 20, steel: 20, baux: 20, devmats: level >= 6 ? 6 : 3, screws: level >= 6 ? 6 : 2 },
  source: 'backfill',
  ...extra,
})
// 他账本 11-24 的 8 次（★2→★10），逐条照抄素材与消耗
const LOOKOUT_RUNS = [
  rec(2, [[RATION, 1]]),
  rec(3, [[RATION, 1]]),
  rec(4, [[RATION, 1]]),
  rec(5, [[RATION, 1]]),
  rec(6, [[LOOKOUT, 1]]),
  rec(7, [[LOOKOUT, 1], [RATION, 1]]),
  rec(8, [[LOOKOUT, 1], [RATION, 1]]),
  rec(9, [[LOOKOUT, 1], [RATION, 1]]),
]
const LOOKOUT_TABLE = {
  eq_id: LOOKOUT,
  improvement: [{
    convert: null,
    helpers: [{ ship_ids: [69, 272, 427], days: [1, 2, 3] }],
    costs: {
      fuel: 20, ammo: 20, steel: 20, baux: 20,
      p1: { devmats: 3, devmats_sli: 4, screws: 2, screws_sli: 2, equips: [{ id: RATION, eq_count: 1 }], consumable: [] },
      p2: { devmats: 5, devmats_sli: 6, screws: 2, screws_sli: 6, equips: [{ id: LOOKOUT, eq_count: 1 }], consumable: [] },
    },
  }],
}

test('一份响应整理成一条记录：实例对成装备号，改修前星级从改修后倒推，更新只在 ★max；确保看 api_certain_flag', () => {
  const inventory = { 16194: 28, 16897: 28 }
  const r = R.remodelOfResponse({
    ts: 1, body: REAL_REMODEL_SLOT_BODY, post: REAL_REMODEL_SLOT_POST, target: null,
    mstOf: (id) => inventory[id], helper: 498, cost: null, source: 'backfill',
  })
  assert.deepEqual(
    { eq: r.eq, level: r.level, afterEq: r.afterEq, certain: r.certain, ok: r.ok, fodder: r.fodder },
    { eq: 266, level: 10, afterEq: 267, certain: true, ok: true, fodder: [{ id: 28, count: 2 }] },
  )
  const plain = R.remodelOfResponse({
    ts: 1, body: { api_remodel_flag: 1, api_remodel_id: [129, 129], api_after_slot: { api_slotitem_id: 129, api_level: 7 }, api_use_slot_id: [5, 6] },
    post: { api_certain_flag: '0' }, target: null, mstOf: (id) => ({ 5: LOOKOUT, 6: RATION })[id], helper: null, cost: null, source: 'live',
  })
  assert.equal(plain.level, 6)
  assert.equal(plain.certain, false)
  assert.deepEqual(plain.fodder, [{ id: LOOKOUT, count: 1 }, { id: RATION, count: 1 }], '按装备号升序')
  assert.equal(R.fodderOfInstances([5, 7], (id) => ({ 5: 1 })[id]), null, '有一件对不上就整条说不出，不拿半截学')
  assert.deepEqual(R.fodderOfInstances([], () => null), [], '没吞东西是「无」，不是说不出')
  const fail = R.remodelOfResponse({
    ts: 1, body: { api_remodel_flag: 0, api_remodel_id: [266, 266] }, post: {}, target: { mstId: 266, level: 4 },
    mstOf: () => null, helper: null, cost: null, source: 'live',
  })
  assert.deepEqual({ level: fail.level, ok: fail.ok, afterEq: fail.afterEq }, { level: 4, ok: false, afterEq: null }, '失败星级不动，用改修前那件的')
  assert.deepEqual(
    R.remodelCostOf([100, 100, 100, 100, 0, 0, 50, 40], [80, 80, 80, 80, 0, 0, 44, 34]),
    { fuel: 20, bull: 20, steel: 20, baux: 20, devmats: 6, screws: 6 },
  )
  assert.equal(R.remodelCostOf(null, [1, 2, 3, 4, 5, 6, 7, 8]), null)
})

test('按星学：熟练见张员 ★6 只吞 1 个熟练见张员、★7-9 再加 1 个战斗粮食 → 整档对不上的那一项不冒充整档，按星取', () => {
  const p2 = R.learnedImproveStage(LOOKOUT_RUNS, LOOKOUT, 'p2')
  assert.deepEqual(p2.mixed, ['fodder'])
  assert.equal(p2.fodder, undefined)
  assert.deepEqual([p2.certain.devmats, p2.certain.screws], [6, 6], '确保改修的资材整档一致')
  assert.equal(p2.normal, undefined, '★6-9 这几次都是确保，普通那一侧没测过')
  assert.deepEqual(R.learnedImproveLevel(LOOKOUT_RUNS, LOOKOUT, 6).fodder.items, [{ id: LOOKOUT, count: 1 }])
  assert.deepEqual(R.learnedImproveLevel(LOOKOUT_RUNS, LOOKOUT, 7).fodder.items, [{ id: LOOKOUT, count: 1 }, { id: RATION, count: 1 }])
  const groups = R.learnedFodderGroups(R.learnedImproveByLevel(LOOKOUT_RUNS, LOOKOUT, 'p2'))
  assert.deepEqual(groups.map((g) => [g.from, g.to, g.items.length]), [[6, 6, 1], [7, 9, 2]])
  // ★0-5 四次一致 → 整档；★0、★1 没测过也取整档
  assert.deepEqual(R.learnedImproveLevel(LOOKOUT_RUNS, LOOKOUT, 0).fodder.items, [{ id: RATION, count: 1 }])
  const without9 = LOOKOUT_RUNS.filter((r) => r.level !== 9)
  assert.equal(R.learnedImproveLevel(without9, LOOKOUT, 9)?.fodder, undefined, '★9 没测过、档内又不一致：说不出就不说')
})

test('普通与确保各学各的：素材两种打法一样，开发 / 改修资材分开记；资料确保侧不被普通的实测悄悄替换', () => {
  const runs = [
    rec(2, [[RATION, 1]], { certain: false, cost: { fuel: 20, bull: 20, steel: 20, baux: 20, devmats: 3, screws: 2 } }),
    rec(3, [[RATION, 1]], { certain: true, cost: { fuel: 20, bull: 20, steel: 20, baux: 20, devmats: 4, screws: 3 } }),
  ]
  const learned = R.learnedImproveStage(runs, LOOKOUT, 'p1')
  assert.deepEqual([learned.normal.devmats, learned.normal.screws, learned.certain.devmats, learned.certain.screws], [3, 2, 4, 3])
  const { stage, changed } = R.applyLearnedStage(LOOKOUT_TABLE.improvement[0].costs.p1, learned)
  assert.deepEqual([stage.devmats, stage.devmats_sli, stage.screws, stage.screws_sli], [3, 4, 2, 3])
  assert.deepEqual(changed, ['screws_sli'], '资料确保改修资材写 2，实测 3')
  const onlyNormal = R.learnedImproveStage(runs.slice(0, 1), LOOKOUT, 'p1')
  const kept = R.applyLearnedStage({ devmats: 9, screws: 9 }, onlyNormal)
  assert.deepEqual([kept.stage.devmats, kept.stage.devmats_sli], [3, 9], '确保侧照资料（缺省＝资料的普通价）')
  assert.deepEqual(R.applyLearnedStage(LOOKOUT_TABLE.improvement[0].costs.p1, null).changed, [])
})

test('更新档按目标分、失败的更新不学；给了二号舰就只认这些二号舰做的（说不出二号舰的照认）', () => {
  const conv = (afterEq, ok, helper, id) => ({
    ts: T0 + id, eq: 266, level: 10, afterEq: ok ? afterEq : null, afterLevel: 0, certain: true, ok, helper,
    fodder: [{ id, count: 2 }], cost: null, source: 'live',
  })
  const runs = [conv(267, true, 498, 28), conv(470, true, 961, 2), conv(null, false, 498, 99)]
  assert.deepEqual(R.learnedImproveStage(runs, 266, 'conv', { afterEq: 267 }).fodder.items, [{ id: 28, count: 2 }])
  assert.deepEqual(R.learnedImproveStage(runs, 266, 'conv', { afterEq: 470 }).fodder.items, [{ id: 2, count: 2 }])
  assert.equal(R.learnedImproveStage(runs, 266, 'conv'), null, '不知道冲的是哪个目标就不学')
  const p1 = [
    { ...rec(1, [[RATION, 1]]), helper: 69 },
    { ...rec(2, [[LOOKOUT, 1]]), helper: 272, ts: T0 + 999e3 },
  ]
  assert.deepEqual(R.learnedImproveLevel(p1, LOOKOUT, 1, { helpers: [69] }).fodder.items, [{ id: RATION, count: 1 }])
  assert.deepEqual(R.learnedImproveLevel([{ ...p1[0], helper: null }], LOOKOUT, 1, { helpers: [427] }).fodder.items, [{ id: RATION, count: 1 }])
})

// ---- 回填：临时账本里摆旧报文，真函数补出记录 ----
const LEDGER_EVENTS_DDL = `
  CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, method TEXT, path TEXT NOT NULL, body TEXT, post_body TEXT);
  CREATE TABLE slotitem_seen(id INTEGER PRIMARY KEY, mst_id INTEGER NOT NULL, level INTEGER NOT NULL, first_ts INTEGER NOT NULL, source TEXT NOT NULL, equipped INTEGER NOT NULL);
  CREATE TABLE material_delta(ts INTEGER NOT NULL, category TEXT NOT NULL, fuel INTEGER, ammo INTEGER, steel INTEGER, bauxite INTEGER, fastbuild INTEGER, bucket INTEGER, devmat INTEGER, screw INTEGER);
`
const seedEvents = (db) => {
  const add = db.prepare('INSERT INTO events(ts, path, body, post_body) VALUES (?, ?, ?, ?)')
  const delta = db.prepare("INSERT INTO material_delta VALUES (?, '改修', ?, ?, ?, ?, 0, 0, ?, ?)")
  // 整表：目标 ★5 熟练见张员（实例 10）、两件糧食（20、21）
  add.run(T0, '/kcsapi/api_get_member/slot_item', JSON.stringify({ api_data: [
    { api_id: 10, api_slotitem_id: LOOKOUT, api_level: 5 },
    { api_id: 20, api_slotitem_id: RATION, api_level: 0 },
    { api_id: 21, api_slotitem_id: RATION, api_level: 0 },
  ] }), null)
  // 整表之后才开发出来的熟练见张员（实例 30）
  add.run(T0 + 10, '/kcsapi/api_req_kousyou/createitem', JSON.stringify({ api_data: { api_get_items: [{ api_id: 30, api_slotitem_id: LOOKOUT }] } }), null)
  // ★5→6 普通，吞糧食 20
  add.run(T0 + 20, '/kcsapi/api_req_kousyou/remodel_slot', JSON.stringify({ api_data: {
    api_remodel_flag: 1, api_remodel_id: [LOOKOUT, LOOKOUT], api_voice_ship_id: 69,
    api_after_slot: { api_id: 10, api_slotitem_id: LOOKOUT, api_level: 6 }, api_use_slot_id: [20],
    api_after_material: [0, 0, 0, 0, 0, 0, 0, 0],
  } }), JSON.stringify({ api_id: '934', api_slot_id: '10', api_certain_flag: '0' }))
  delta.run(T0 + 20, -20, -20, -20, -20, -3, -2)
  // ★6 失败（普通），吞开发出来的 30：星级从整表 + 上一次改修的结果认
  add.run(T0 + 30, '/kcsapi/api_req_kousyou/remodel_slot', JSON.stringify({ api_data: {
    api_remodel_flag: 0, api_remodel_id: [LOOKOUT, LOOKOUT], api_voice_ship_id: 0, api_use_slot_id: [30],
    api_after_material: [0, 0, 0, 0, 0, 0, 0, 0],
  } }), JSON.stringify({ api_id: '934', api_slot_id: '10', api_certain_flag: '0' }))
  delta.run(T0 + 30, -20, -20, -20, -20, -5, -2)
  // ★6→7 确保，吞一件整表与开发里都没有、只在 slotitem_seen 里的（40），外加一件谁都不认得的（41）
  add.run(T0 + 40, '/kcsapi/api_req_kousyou/remodel_slot', JSON.stringify({ api_data: {
    api_remodel_flag: 1, api_remodel_id: [LOOKOUT, LOOKOUT], api_voice_ship_id: 69,
    api_after_slot: { api_id: 10, api_slotitem_id: LOOKOUT, api_level: 7 }, api_use_slot_id: [40, 41],
    api_after_material: [0, 0, 0, 0, 0, 0, 0, 0],
  } }), JSON.stringify({ api_id: '934', api_slot_id: '10', api_certain_flag: '1' }))
  db.prepare("INSERT INTO slotitem_seen VALUES (40, ?, 0, ?, 'port', 0)").run(LOOKOUT, T0 + 35)
}

test('回填：素材实例取改修前最近一份整表、补上其后新得的；资源差额取同一刻的「改修」那一行；二号舰取 api_voice_ship_id', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(LEDGER_EVENTS_DDL)
  seedEvents(db)
  const rows = improveRemodelsFromEvents(db)
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((r) => [r.level, r.ok, r.certain, r.helper, JSON.stringify(r.fodder), r.cost && [r.cost.devmats, r.cost.screws]]),
    [
      [5, true, false, 69, JSON.stringify([{ id: RATION, count: 1 }]), [3, 2]],
      [6, false, false, null, JSON.stringify([{ id: LOOKOUT, count: 1 }]), [5, 2]],
      [6, true, true, 69, 'null', null],
    ],
  )
  assert.ok(rows.every((r) => r.source === 'backfill'))
  db.close()
})

test('账本：真构造器只回填一次（完成标记与条目同批），再开不重复；两张表都是永久表', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-remodel-backfill-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  db.exec(`PRAGMA user_version=15; ${LEDGER_EVENTS_DDL}`)
  seedEvents(db)
  let ledger = openLedger(dir)
  ledger.close()
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM improve_remodels').get().n
  assert.equal(count(), 3)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM improve_remodel_backfill_state').get().n, 1)
  const first = db.prepare('SELECT * FROM improve_remodels ORDER BY ts LIMIT 1').get()
  assert.deepEqual(
    { eq: first.eq, level: first.level, certain: first.certain, ok: first.ok, helper: first.helper, fodder: JSON.parse(first.fodder), source: first.source },
    { eq: LOOKOUT, level: 5, certain: 0, ok: 1, helper: 69, fodder: [{ id: RATION, count: 1 }], source: 'backfill' },
  )
  const warn = t.mock.method(console, 'warn', () => {})
  ledger = openLedger(dir)
  ledger.close()
  assert.equal(count(), 3, '再开不重复')
  assert.equal(warn.mock.calls.filter((call) => String(call.arguments[0]).includes('improve remodel')).length, 0, '再开不重扫（重扫会撞完成标记的主键、整批回滚报警告）')
  warn.mock.restore()
  for (const name of ['improve_remodels', 'improve_remodel_backfill_state']) {
    assert.ok(retention.LEDGER_PERMANENT_TABLES.includes(name))
    assert.ok(!retention.planLedgerPrune({ retentionDays: 1, now: T0 + 86400e3 * 30 }).some((r) => r.table === name))
  }
})

test('账本：查询把 JSON 列还原，说不出的仍是 null（原样切出 queryImproveRemodels 跑真 SQL）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/main/mg/ledger.ts'), 'utf8').replace(/\r\n/g, '\n')
  const ddlFrom = source.indexOf('      CREATE TABLE IF NOT EXISTS improve_remodels (')
  const ddlTo = source.indexOf(');', ddlFrom) + 2
  const recFrom = source.indexOf('  recordImproveRemodel = ')
  const recTo = source.indexOf('  // 只在首次建表后从旧报文补一次', recFrom)
  const qFrom = source.indexOf('  queryImproveRemodels = ')
  const qTo = source.indexOf('\n  }\n', source.indexOf("console.warn('[kuma] mg: improve remodel query failed'", qFrom)) + 4
  assert.ok(ddlFrom > 0 && recFrom > 0 && recTo > recFrom && qFrom > 0 && qTo > qFrom, 'ledger.ts 的改修实测锚点要跟着改')
  const { buildSync } = require('esbuild')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-remodel-q-'))
  const outfile = path.join(dir, 'q.cjs')
  buildSync({
    stdin: { contents: `class Q {\n  constructor(public db: any) {}\n${source.slice(recFrom, recTo)}\n${source.slice(qFrom, qTo)}\n}\nexport const make = (db: any) => new Q(db)\n`, loader: 'ts', resolveDir: ROOT },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  })
  const { make } = require(outfile)
  fs.rmSync(dir, { recursive: true, force: true })
  const db = new DatabaseSync(':memory:')
  db.exec(source.slice(ddlFrom, ddlTo).replace(/--[^\n]*/g, ''))
  const q = make(db)
  q.recordImproveRemodel(LOOKOUT_RUNS[5])
  q.recordImproveRemodel({ ...LOOKOUT_RUNS[0], level: null, fodder: null, cost: null, helper: null, source: 'live' })
  const rows = q.queryImproveRemodels()
  assert.deepEqual(rows[0], { ...LOOKOUT_RUNS[5] }, '新到旧，逐项往返')
  assert.deepEqual([rows[1].level, rows[1].fodder, rows[1].cost, rows[1].helper, rows[1].source], [null, null, null, null, 'live'])
})

test('当场记（真 reducer）：素材实例与资源在被删掉、被换掉之前读；二号舰从第一舰队认，请求的 api_id 是方案号不是舰船', () => {
  reset(
    { 1: 187, 2: 498, 170: 961 },
    {
      fleet: [1, 2],
      materials: [8000, 10400, 91700, 5950, 508, 52, 140, 103],
      slotitems: { 4346: { mstId: 266, level: 10 }, 16194: { mstId: 28 }, 16897: { mstId: 28 } },
      improveEntries: [IMPROVE_266],
      useitems: { 75: 12, 78: 4 },
    },
  )
  feedRemodelSlot(REAL_REMODEL_SLOT_POST, REAL_REMODEL_SLOT_BODY)
  assert.equal(slotitems()[16194], undefined, '素材确实被删了')
  const [row] = remodelLog()
  assert.deepEqual(
    { eq: row.eq, level: row.level, afterEq: row.afterEq, certain: row.certain, ok: row.ok, helper: row.helper, fodder: row.fodder, source: row.source },
    { eq: 266, level: 10, afterEq: 267, certain: true, ok: true, helper: 498, fodder: [{ id: 28, count: 2 }], source: 'live' },
  )
  assert.deepEqual(row.cost, { fuel: 131, bull: 54, steel: 29, baux: 35, devmats: 32, screws: 17 })
})

// ---- 今日改修 / 装备详情的真渲染 ----
const MON = 1
const 账本 = (remodels, level, extra = {}) => ({
  day: MON,
  remodels,
  equips: {
    [LOOKOUT]: { api_id: LOOKOUT, api_name: '熟練見張員', api_type: [17, 30, 39, 32] },
    [RATION]: { api_id: RATION, api_name: '戦闘糧食', api_type: [23, 31, 43, 49] },
  },
  shipMst: { 182: { api_id: 182, api_name: '明石' }, 69: { api_id: 69, api_name: '鳥海改' } },
  eo: [LOOKOUT_TABLE],
  mg: {
    ships: {
      1: { id: 1, shipId: 182, lv: 60, slot: [-1, -1, -1, -1], slotEx: 0 },
      2: { id: 2, shipId: 69, lv: 83, slot: [-1, -1, -1, -1], slotEx: 0 },
    },
    slotitems: {
      101: { mstId: LOOKOUT, level, alv: 0, locked: true },
      // 闲置未锁的 ★max 熟练见张员：只当素材（没有更新路线，不出自己的行）
      102: { mstId: LOOKOUT, level: 10, alv: 0, locked: false },
      ...(extra.slotitems ?? {}),
    },
    decks: [{ id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] }],
    materials: { 0: 9999, 1: 9999, 2: 9999, 3: 9999, 6: 9999, 7: 9999 },
  },
})

test('今日改修（真渲染）：★7 照实测要熟练见张员 + 战斗粮食，资料只写前者 → 素材换成实测并挂角标，缺粮食就不算能改', () => {
  const [plain] = todayRows(账本([], 7))
  assert.equal(plain.ready, true, '没有实测时照资料：只要 1 个熟练见张员，手上有')
  const [row] = todayRows(账本(LOOKOUT_RUNS, 7))
  assert.equal(row.ready, false)
  assert.deepEqual(row.missing, ['戦闘糧食缺 1'])
  assert.match(expandedOf(row.html), /素材 .*熟練見張員<\/a><\/span>×1 · .*戦闘糧食<\/a><\/span>×1 <span class="ti-observed" title="游戏实测 11-24 · 资料写 素材 熟練見張員×1">实测<\/span>/)
  const [stocked] = todayRows(账本(LOOKOUT_RUNS, 7, { slotitems: { 103: { mstId: RATION, level: 0, alv: 0, locked: false } } }))
  assert.equal(stocked.ready, true, '粮食到手就能改')
  // ★6 实测跟资料一样：不挂角标
  const [six] = todayRows(账本(LOOKOUT_RUNS, 6))
  assert.doesNotMatch(expandedOf(six.html), /ti-observed/)
  assert.equal(six.ready, true)
  // 确保改修资材实测 6/6，资料 6/6：对得上，折叠行不挂
  assert.doesNotMatch(foldedOf(row.html), /ti-observed/)
})

test('今日改修（真渲染）：资料没收录的新装备改过之后，素材照实测列出并算进能不能改，资材分普通 / 确保', () => {
  const obsMod = require(path.join(ROOT, 'dist/shared/improve-observed.js'))
  const facts = obsMod.improveFactsOf(
    [{ ts: T0, day: MON, flagship: 182, helper: 69, items: [585], detail: [{ id: 585, fuel: 30, bull: 10, steel: 0, baux: 20, devmats: 2, screws: 1 }] }],
    [], [],
  )
  const runs = [
    { ts: T0, eq: 585, level: 0, afterEq: 585, afterLevel: 1, certain: false, ok: true, helper: 69, fodder: [{ id: RATION, count: 2 }], cost: { fuel: 30, bull: 10, steel: 0, baux: 20, devmats: 3, screws: 2 }, source: 'live' },
    { ts: T0 + 1, eq: 585, level: 1, afterEq: 585, afterLevel: 2, certain: true, ok: true, helper: 69, fodder: [{ id: RATION, count: 2 }], cost: { fuel: 30, bull: 10, steel: 0, baux: 20, devmats: 4, screws: 3 }, source: 'live' },
  ]
  const setup = { ...账本(runs, 0), facts, eo: [] }
  setup.equips[585] = { api_id: 585, api_name: 'PL101(偵察)', api_type: [5, 7, 9, 9, 63] }
  setup.mg.slotitems = { 401: { mstId: 585, level: 2, alv: 0, locked: false }, 103: { mstId: RATION, level: 0, alv: 0, locked: false } }
  const [row] = todayRows(setup).filter((r) => r.equipId === 585)
  assert.deepEqual(row.missing, ['戦闘糧食缺 1'], '实测要 2 个粮食，手上 1 个')
  assert.match(expandedOf(row.html), /素材 .*戦闘糧食<\/a><\/span>×2 <span class="ti-observed" title="游戏实测 [0-9-]+ · 资料未收录">实测<\/span>/)
  assert.match(foldedOf(row.html), /开发<\/a> 3 <i>\(4\)<\/i> · <a class="el" data-material="7">改修<\/a> 2 <i>\(3\)<\/i>/, '普通 3/2，确保 4/3')
})

test('装备详情（真渲染）：★6-9 那一格按星分组列实测素材；资料没收录的装备按档列出普通 / 确保两种打法的实测', () => {
  const card = improveCardHtml({
    eo: LOOKOUT_TABLE,
    equip: { api_id: LOOKOUT, api_name: '熟練見張員' },
    equips: { [LOOKOUT]: { api_name: '熟練見張員' }, [RATION]: { api_name: '戦闘糧食' } },
    ships: { 69: { api_name: '鳥海改' } },
    remodels: LOOKOUT_RUNS,
  })
  const p2Row = /<td class="rng">★6-9<\/td>[\s\S]*?<\/tr>/.exec(card)[0]
  assert.match(p2Row, /<i>★6<\/i> .*熟練見張員<\/a><\/span>×1 · <i>★7-9<\/i> .*熟練見張員<\/a><\/span>×1 · .*戦闘糧食<\/a><\/span>×1 <span class="ti-observed"/)
  const p1Row = /<td class="rng">★0-5<\/td>[\s\S]*?<\/tr>/.exec(card)[0]
  assert.doesNotMatch(p1Row, /ti-observed/, '★0-5 实测与资料一样')
  const uncovered = improveCardHtml({
    eo: null,
    uncovered: true,
    equip: { api_id: LOOKOUT, api_name: '熟練見張員' },
    equips: { [LOOKOUT]: { api_name: '熟練見張員' }, [RATION]: { api_name: '戦闘糧食' } },
    remodels: [
      rec(2, [[RATION, 1]], { certain: false, cost: { fuel: 20, bull: 20, steel: 20, baux: 20, devmats: 3, screws: 2 } }),
      rec(3, [[RATION, 1]], { certain: true, cost: { fuel: 20, bull: 20, steel: 20, baux: 20, devmats: 4, screws: 2 } }),
    ],
  })
  assert.match(uncovered, /<div class="ak-learned">★0-5 · 普通 <a class="el" data-material="6">开发<\/a> 3 · <a class="el" data-material="7">改修<\/a> 2；确保 <a class="el" data-material="6">开发<\/a> 4 · <a class="el" data-material="7">改修<\/a> 2 · 素材 ★2-3 .*戦闘糧食<\/a><\/span>×1<i>（游戏实测 11-24）<\/i><\/div>/)
})
