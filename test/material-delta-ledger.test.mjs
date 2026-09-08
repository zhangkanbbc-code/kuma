import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { openLedger } from './fixtures/phantom-consumable-ledger.mjs'

const temporaryLedger = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-delta-v15-'))
  const file = path.join(dir, 'mg.sqlite')
  const db = new DatabaseSync(file)
  // 真 V14 形状没有 detail 列；构造器必须 ALTER 后才能迁移。
  db.exec(`PRAGMA user_version = 14;
    CREATE TABLE material_delta (ts INTEGER NOT NULL, category TEXT NOT NULL,
      fuel INTEGER, ammo INTEGER, steel INTEGER, bauxite INTEGER,
      fastbuild INTEGER, bucket INTEGER, devmat INTEGER, screw INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      method TEXT, path TEXT NOT NULL, body TEXT, post_body TEXT, secretary_mst INTEGER);
    CREATE TABLE ship_life_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      roster_id INTEGER NOT NULL, mst_id INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE expedition_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      mission_id INTEGER NOT NULL, deck_id INTEGER NOT NULL, result TEXT NOT NULL, materials TEXT NOT NULL, items TEXT NOT NULL);
  `)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const event = (ts, api, post = {}, body = null) => db.prepare('INSERT INTO events (ts, path, post_body, body) VALUES (?, ?, ?, ?)')
    .run(ts, `/kcsapi/${api}`, JSON.stringify({ ...post, api_token: '<REDACTED>' }), body === null ? null : JSON.stringify({ api_result: 1, api_data: body }))
  const delta = (ts, category, values = [-1]) => db.prepare('INSERT INTO material_delta VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ts, category, ...Array.from({ length: 8 }, (_, i) => values[i] ?? 0))
  return { dir, file, db, event, delta }
}

test('V15 真构造器：改判、对象回填、版本 15、重开及强制重跑幂等', t => {
  const { dir, file, db, event, delta } = temporaryLedger(t)
  const logs = []
  t.mock.method(console, 'log', message => logs.push(message))
  event(1000, 'api_req_kaisou/remodeling', { api_id: '7' })
  event(1400, 'api_get_member/ship3', {}, { api_ship_data: [{ api_id: 7, api_ship_id: 12 }] })
  event(1700, 'api_get_member/material')
  delta(1700, '其他', [0, -20, -30])
  db.prepare('INSERT INTO ship_life_events (ts, roster_id, mst_id, kind, detail) VALUES (?, ?, ?, ?, ?)')
    .run(1400, 7, 12, 'remodel', JSON.stringify({ beforeMstId: 11, afterMstId: 12, level: 30 }))
  event(2000, 'api_req_quest/clearitemget', { api_quest_id: '1107' })
  event(26400, 'api_get_member/material')
  delta(26400, '其他', [0, 0, -24000])
  event(30000, 'api_req_quest/clearitemget', { api_quest_id: '677' })
  event(32000, 'api_get_member/material')
  delta(32000, '其他', [0, 0, 0, 0, 0, 1])
  event(40000, 'api_req_map/start', {}, { api_maparea_id: 62, api_mapinfo_no: 1, api_no: 2 })
  event(40100, 'api_req_map/start_air_base', { api_strike_point_2: '4,4' })
  event(50000, 'api_port/port')
  delta(50000, '母港校准', [-57, -28])
  event(51000, 'api_port/port')
  delta(51000, '母港校准', [3, 3])
  event(52000, 'api_get_member/material')
  delta(52000, '其他', [3, 3])
  event(60000, 'api_req_member/payitemuse', { api_payitem_id: '5' })
  event(60230, 'api_get_member/material')
  delta(60230, '氪金道具', [1200])
  event(70000, 'api_req_hokyu/charge', { api_id_items: '7,8', api_kind: '3', api_onslot: '1' })
  delta(70000, '补给')
  event(71000, 'api_req_nyukyo/start', { api_ship_id: '7', api_ndock_id: '2', api_highspeed: '1' })
  delta(71000, '入渠')
  event(72000, 'api_req_kousyou/createship', { api_item1: '30', api_item2: '40', api_item3: '50', api_item4: '60', api_item5: '20', api_kdock_id: '2' })
  delta(72000, '建造')
  event(73000, 'api_req_kousyou/createitem', { api_multiple_flag: '1' }, { api_get_items: [{ api_slotitem_id: 15 }, { api_slotitem_id: -1 }] })
  delta(73000, '开发')
  event(74000, 'api_req_kousyou/remodel_slot', { api_slot_id: '101', api_certain_flag: '1' }, { api_remodel_flag: 1, api_after_slot: { api_slotitem_id: 16, api_level: 6 } })
  delta(74000, '改修')
  event(75000, 'api_req_mission/result', { api_deck_id: '2' }, { api_clear_result: 2 })
  delta(75000, '远征', [30, 40])
  db.prepare('INSERT INTO expedition_history (ts, mission_id, deck_id, result, materials, items) VALUES (?, ?, ?, ?, ?, ?)')
    .run(75000, 21, 2, 'great', '[30,40]', '[]')
  event(76000, 'api_req_kousyou/destroyship', { api_ship_id: '7,8', api_slot_dest_flag: '1' })
  delta(76000, '解体', [1, 1])
  for (const [id, mst] of [[7, 12], [8, 13]]) db.prepare('INSERT INTO ship_life_events (ts, roster_id, mst_id, kind, detail) VALUES (?, ?, ?, ?, ?)')
    .run(76000, id, mst, 'scrap', '{}')
  event(77000, 'api_req_kousyou/destroyitem2', { api_slotitem_ids: '101,102' })
  delta(77000, '废弃返还', [1, 1])
  event(78000, 'api_req_quest/clearitemget', { api_quest_id: '657' }, { api_material: [1, 2, 3, 4] })
  delta(78000, '任务', [1, 2, 3, 4])
  event(79000, 'api_req_air_corps/supply', { api_area_id: '62', api_base_id: '2', api_squadron_id: '3' })
  delta(79000, '基地航空队')
  event(80000, 'api_req_map/next', {}, { api_no: 6 })
  delta(80000, '海域资源点', [1])
  // 已有归类不能因附近有武装改写。
  event(81000, 'api_get_member/material')
  delta(81000, '补给')
  const eventsBefore = db.prepare('SELECT * FROM events').all()
  const lifeBefore = db.prepare('SELECT * FROM ship_life_events').all()
  db.close()

  const first = openLedger(dir)
  const report = first.queryDeltaRows(0)
  first.close()
  const byTs = new Map(report.rows.map(row => [row.ts, row]))
  const expected = new Map([
    [1700, ['舰娘改造', { kind: 'shipRemodel', ship: 7, from: 11, to: 12 }]],
    [26400, ['任务消耗', { kind: 'questCost', quest: 1107 }]],
    [32000, ['任务', { kind: 'quest', quest: 677 }]],
    [50000, ['基地航空队出击', { kind: 'airBaseSortie', map: 621 }]],
    [51000, ['母港校准', null]], [52000, ['其他', null]],
    [60230, ['氪金道具', { kind: 'itemUse', item: 5, paid: true }]],
    [70000, ['补给', { kind: 'supply', ships: [7, 8], mode: 3, onslot: true }]],
    [71000, ['入渠', { kind: 'dock', ship: 7, mst: 0, ndock: 2, highspeed: true }]],
    [72000, ['建造', { kind: 'build', recipe: [30, 40, 50, 60, 20], highspeed: false, large: false, kdock: 2 }]],
    [73000, ['开发', { kind: 'craft', recipe: [0, 0, 0, 0], multiple: true, results: [15, -1] }]],
    [74000, ['改修', { kind: 'improve', slotitem: 101, mst: 0, certain: true, success: true, after: { mst: 16, level: 6 } }]],
    [75000, ['远征', { kind: 'expedition', mission: 21, deck: 2, result: 'great' }]],
    [76000, ['解体', { kind: 'scrap', ships: [{ id: 7, mst: 12 }, { id: 8, mst: 13 }], withSlots: true }]],
    [77000, ['废弃返还', { kind: 'discard', slotitems: [{ id: 101, mst: 0 }, { id: 102, mst: 0 }] }]],
    [78000, ['任务', { kind: 'quest', quest: 657 }]],
    [79000, ['基地航空队', { kind: 'airBase', action: 'supply', area: 62, base: 2, squadron: 3 }]],
    [80000, ['海域资源点', { kind: 'mapItem', cell: 6, source: 'next' }]],
    [81000, ['补给', null]],
  ])
  for (const [ts, [category, detail]] of expected) {
    assert.equal(byTs.get(ts).category, category, `${ts} category`)
    assert.deepEqual(byTs.get(ts).detail, detail, `${ts} detail`)
  }
  assert.doesNotMatch(JSON.stringify(report), /token|REDACTED/)
  assert.ok(logs.includes('[kuma] mg: ledger 迁移 — V15 资源归类补正 4 行'))
  const read = new DatabaseSync(file)
  assert.equal(read.prepare('PRAGMA user_version').get().user_version, 15)
  assert.deepEqual(read.prepare('SELECT * FROM events').all(), eventsBefore)
  // V15 不改舰历；列由历史通用 ALTER 补齐，因此比较原有字段。
  assert.deepEqual(read.prepare('SELECT id, ts, roster_id, mst_id, kind, detail FROM ship_life_events').all(), lifeBefore)
  const saved = read.prepare('SELECT * FROM material_delta ORDER BY ts').all()
  read.close()
  const second = openLedger(dir)
  assert.deepEqual(second.queryDeltaRows(0), report)
  second.close()
  const force = new DatabaseSync(file)
  force.exec('PRAGMA user_version = 14')
  force.close()
  openLedger(dir).close()
  const after = new DatabaseSync(file, { readOnly: true })
  assert.deepEqual(after.prepare('SELECT * FROM material_delta ORDER BY ts').all(), saved)
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 15)
  after.close()
  assert.ok(logs.includes('[kuma] mg: ledger 迁移 — V15 资源归类补正 0 行'))
})

test('逐笔查询：排序、双端闭窗口、6000 边界、截断、JSON 与八项数值往返', t => {
  const { dir, db } = temporaryLedger(t)
  db.close()
  const ledger = openLedger(dir)
  try {
  assert.deepEqual(ledger.queryDeltaRows(0), { rows: [], truncated: false })
  const detail = { kind: 'questCost', quest: 677 }
  ledger.logDelta(20, '任务消耗', [0, 0, -3600, 0, 0, 0, 0, 0], detail)
  ledger.logDelta(10, '其他', [1])
  ledger.logDelta(30, '其他', [-1])
  assert.deepEqual(ledger.queryDeltaRows(10, 20), { rows: [
    { ts: 20, category: '任务消耗', values: [0, 0, -3600, 0, 0, 0, 0, 0], detail },
    { ts: 10, category: '其他', values: [1, 0, 0, 0, 0, 0, 0, 0], detail: null },
  ], truncated: false })
  assert.deepEqual(ledger.queryDeltaRows(20, 10), { rows: [], truncated: false })
  for (let i = 0; i < 6000; i++) ledger.logDelta(1000 + i, '任务', [i], { kind: 'quest', quest: 1 })
  assert.equal(ledger.queryDeltaRows(1000).rows.length, 6000)
  assert.equal(ledger.queryDeltaRows(1000).truncated, false)
  ledger.logDelta(7000, '其他', [1])
  const truncated = ledger.queryDeltaRows(1000)
  assert.equal(truncated.rows.length, 6000)
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.rows[0].ts, 7000)
  assert.equal(truncated.rows.at(-1).ts, 1001)
  assert.equal(ledger.queryDeltaRows(1000, 6999).truncated, false)
  } finally {
    ledger.close()
  }
})

test('V15 7357 行批量回填完整，未解析行保持 NULL', t => {
  const { dir, db, event, delta } = temporaryLedger(t)
  db.exec('BEGIN')
  for (let i = 1; i <= 7357; i++) {
    event(i, 'api_req_hokyu/charge', { api_id_items: '7', api_kind: '1', api_onslot: '0' })
    delta(i, '补给')
  }
  db.exec('COMMIT')
  db.close()
  const ledger = openLedger(dir)
  ledger.close()
  const read = new DatabaseSync(path.join(dir, 'mg.sqlite'), { readOnly: true })
  assert.equal(read.prepare('SELECT COUNT(*) AS n FROM material_delta WHERE detail IS NOT NULL').get().n, 7357)
  read.close()
})
