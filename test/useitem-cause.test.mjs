import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

import useitemCause from '../dist/shared/useitem-cause.js'
import { makeLedger } from './fixtures/useitem-cause-ledger.mjs'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const {
  USEITEM_CAUSE_RULES,
  resolveUseitemCause,
} = useitemCause

const SYNC = '/kcsapi/api_get_member/useitem'
const BATTLE = '/kcsapi/api_req_sortie/battleresult'
const REMODEL_SLOT = '/kcsapi/api_req_kousyou/remodel_slot'
const OPEN_EXSLOT = '/kcsapi/api_req_kaisou/open_exslot'

test('按符号与可消耗道具过滤后取最近动作，不再把返港负差值归给战果', () => {
  const actions = [
    { ts: 10, path: REMODEL_SLOT, postBody: '{"api_slot_id":"4346"}' },
    { ts: 20, path: BATTLE, postBody: { api_btime: '17339656' } },
  ]
  assert.equal(resolveUseitemCause({ itemId: 78, delta: -1 }, actions), REMODEL_SLOT)
  assert.equal(resolveUseitemCause({ itemId: 75, delta: -1 }, actions), REMODEL_SLOT)
  assert.equal(resolveUseitemCause({ itemId: 78, delta: 2 }, actions), BATTLE)
  assert.equal(resolveUseitemCause({ itemId: 64, delta: -1 }, actions), null)
})

test('开孔只消费补强增设；改修消费集合来自事实表的实际 11 种', () => {
  assert.deepEqual(USEITEM_CAUSE_RULES[OPEN_EXSLOT], { sign: '-', items: [64] })
  assert.deepEqual(
    USEITEM_CAUSE_RULES[REMODEL_SLOT],
    { sign: '-', items: [57, 70, 71, 75, 77, 78, 92, 94, 95, 100, 104] },
  )
  assert.equal(
    resolveUseitemCause(
      { itemId: 64, delta: -5 },
      [
        { ts: 10, path: OPEN_EXSLOT },
        { ts: 20, path: BATTLE },
      ],
    ),
    OPEN_EXSLOT,
  )
  assert.equal(resolveUseitemCause({ itemId: 105, delta: -1 }, [{ ts: 10, path: OPEN_EXSLOT }]), null)
})

const openDb = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-useitem-cause-db-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      method TEXT,
      path TEXT NOT NULL,
      body TEXT,
      post_body TEXT
    );
    CREATE TABLE useitem_log (
      ts INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      total INTEGER NOT NULL,
      cause TEXT
    );
  `)
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return db
}

const insertEvent = (db, ts, path, postBody = null) =>
  db.prepare('INSERT INTO events (ts, path, post_body) VALUES (?, ?, ?)').run(
    ts,
    path,
    postBody == null || typeof postBody === 'string' ? postBody : JSON.stringify(postBody),
  )

const insertChange = (db, ts, itemId, delta, total) =>
  db.prepare('INSERT INTO useitem_log (ts, item_id, delta, total) VALUES (?, ?, ?, ?)').run(
    ts,
    itemId,
    delta,
    total,
  )

const causeRows = (db) =>
  db
    .prepare('SELECT ts, item_id AS itemId, delta, cause FROM useitem_log ORDER BY ts, rowid')
    .all()
    .map((row) => ({ ...row }))

test('v12 真 SQL 回算截图三行，且第二次迁移是空操作', (t) => {
  const db = openDb(t)
  const openSync = 1788154952479
  insertEvent(db, openSync, SYNC)
  for (const ts of [1788154982370, 1788154991571, 1788155003189, 1788155009855, 1788155017403]) {
    insertEvent(db, ts, OPEN_EXSLOT, { api_id: '7341' })
  }
  insertEvent(db, 1788155472345, BATTLE)
  const openDiff = 1788155533643
  insertEvent(db, openDiff, SYNC)
  insertChange(db, openDiff, 64, -5, 0)

  const improveSync = 1788334188044
  insertEvent(db, improveSync, SYNC)
  insertEvent(db, 1788334963605, REMODEL_SLOT, '{"api_slot_id":"4346","api_certain_flag":"1"}')
  insertEvent(db, 1788335580868, BATTLE)
  const improveDiff = 1788335617635
  insertEvent(db, improveDiff, SYNC)
  insertChange(db, improveDiff, 75, -1, 11)
  insertChange(db, improveDiff, 78, -1, 3)

  const rewardTs = improveDiff + 1000
  insertEvent(db, rewardTs, BATTLE)
  insertChange(db, rewardTs, 78, 2, 5)

  const ledger = makeLedger(db)
  assert.deepEqual(ledger.migrate(), { total: 4, resolved: 4, unresolved: 0 })
  assert.deepEqual(causeRows(db), [
    { ts: openDiff, itemId: 64, delta: -5, cause: OPEN_EXSLOT },
    { ts: improveDiff, itemId: 75, delta: -1, cause: REMODEL_SLOT },
    { ts: improveDiff, itemId: 78, delta: -1, cause: REMODEL_SLOT },
    { ts: rewardTs, itemId: 78, delta: 2, cause: BATTLE },
  ])
  const beforeSecondRun = causeRows(db)
  assert.deepEqual(ledger.migrate(), { total: 0, resolved: 0, unresolved: 0 })
  assert.deepEqual(causeRows(db), beforeSecondRun)
})

test('实时落账把同一共享函数算出的 cause path 一并写入', (t) => {
  const db = openDb(t)
  insertEvent(db, 100, SYNC)
  const action = insertEvent(db, 200, REMODEL_SLOT, { api_slot_id: '4346' })
  const ledger = makeLedger(db)
  ledger.pointAtEvent(Number(action.lastInsertRowid))
  ledger.logUseitems(200, [{ id: 78, delta: -1, total: 3 }])
  assert.deepEqual(causeRows(db), [
    { ts: 200, itemId: 78, delta: -1, cause: REMODEL_SLOT },
  ])
})

test('v12 schema 接线与未解释负差值都如实留空', (t) => {
  const ledgerSource = fs.readFileSync(
    new URL('../src/main/mg/ledger.ts', import.meta.url),
    'utf8',
  )
  assert.match(ledgerSource, /\['useitem_log', 'cause', 'TEXT'\]/)
  assert.match(ledgerSource, /if \(previousVersion < 12\) this\.backfillUseitemCausesV12\(\)/)
  assert.match(ledgerSource, /PRAGMA user_version = \$\{questProgressV13 \? 13 : 12\}/)

  const db = openDb(t)
  insertEvent(db, 100, SYNC)
  insertEvent(db, 200, BATTLE)
  insertEvent(db, 300, SYNC)
  insertChange(db, 300, 64, -1, 0)
  assert.deepEqual(makeLedger(db).migrate(), { total: 1, resolved: 0, unresolved: 1 })
  assert.equal(causeRows(db)[0].cause, null)
})
