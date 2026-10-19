import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import ledgerModule from '../dist/main/mg/seasonal-ledger.js'
import html from '../dist/shared/seasonal-history-html.js'
import cause from '../dist/shared/useitem-cause.js'
import { makeLedger } from './fixtures/useitem-cause-ledger.mjs'
import { events, MASTER, POWERUP, reset, feed, sync, state, logs } from './fixtures/store-powerup.mjs'

const SYNC = '/kcsapi/api_get_member/useitem'
const { SeasonalLedger } = ledgerModule
const open = t => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, path TEXT, body TEXT, post_body TEXT);
    CREATE INDEX idx_events_path ON events(path);
    CREATE TABLE useitem_log(ts INTEGER, item_id INTEGER, delta INTEGER, total INTEGER, cause TEXT);
    CREATE TABLE event_archive(area_id INTEGER PRIMARY KEY, opened INTEGER, closed INTEGER, stats TEXT);`)
  t.after(() => db.close())
  const book = new SeasonalLedger(db)
  book.setMaster(MASTER)
  const ledger = makeLedger(db)
  ledger.seasonal = book
  return { db, book, ledger }
}
const put = (db, event) => Number(db.prepare('INSERT INTO events(ts,path,body,post_body) VALUES (?,?,?,?)')
  .run(event.ts, event.path, JSON.stringify(event.body), JSON.stringify(event.post ?? {})).lastInsertRowid)
const snapshot = (ts, count) => ({ ts, path: SYNC, body: { api_result: 1, api_data: [{ api_id: 96, api_count: count }] } })
const variant = (type, result = 1) => {
  const event = structuredClone(events[0])
  if (type == null) delete event.post.api_limited_feed_type
  else event.post.api_limited_feed_type = type
  event.body.api_result = result
  return event
}
const history = book => book.current({ 96: 0 }, events.at(-1).ts + 1000)[0]
const assertThree = h => {
  assert.equal(h.receipts.length, 3)
  assert.deepEqual(h.receipts.map(r => [r.recipe, r.cost, r.target]), events.map(() => ['powerup', 1, { rosterId: 4460, mstId: 916 }]))
  assert.deepEqual(h.uses, [{ recipe: 'powerup', count: 3, times: 3 }])
  assert.equal(h.spent, 3)
  assert.deepEqual(h.otherUses, [])
  assert.deepEqual(h.sources, [])
  assert.match(html.campaignSummaryHtml(h, { nameOf: () => '', time: String }), /去向 近代化改修 3 次/)
}

test('真实三次限定给餌当场扣南瓜 3→0、逐次落账通知；同步为 0 不再重复扣款', async t => {
  const { db, book, ledger } = open(t)
  await book.startBackfill()
  ledger.pointAtEvent(put(db, snapshot(events[0].ts - 1000, 3)))
  reset({ 96: 3 }, (ts, changes) => ledger.logUseitems(ts, changes))
  for (const [i, event] of events.entries()) {
    ledger.pointAtEvent(put(db, event))
    book.observe(event)
    assert.ok(feed(event).includes('useitems'))
    assert.equal(state.player.useitems[96], 2 - i)
  }
  assert.deepEqual(logs, events.map((e, i) => ({ ts: e.ts, changes: [{ id: 96, delta: -1, total: 2 - i }] })))
  assert.deepEqual(db.prepare('SELECT cause FROM useitem_log').all().map(r => r.cause), events.map(() => POWERUP))
  assertThree(history(book))
  const event = snapshot(events.at(-1).ts + 1000, 0)
  ledger.pointAtEvent(put(db, event))
  sync(event.body.api_data, event.ts)
  assert.equal(logs.length, 3)
  assertThree(history(book))
})

test('普通与无类型改修不扣不记；未知类型 2 跨扣数、收据和归因只 warn 一次', t => {
  const { book } = open(t)
  const warn = t.mock.method(console, 'warn', () => {})
  reset()
  for (const type of ['0', undefined, '2', '2']) {
    const event = variant(type)
    assert.ok(!feed(event).includes('useitems'))
    book.observe(event)
    assert.equal(cause.resolveUseitemCause({ itemId: 96, delta: -1 }, [{ ts: event.ts, path: POWERUP, postBody: event.post }]), null)
  }
  assert.equal(state.player.useitems[96], 3)
  assert.deepEqual(logs, [])
  assert.deepEqual(book.current({}, events[0].ts), [])
  assert.equal(warn.mock.callCount(), 1)
  assert.match(warn.mock.calls[0].arguments[0], /api_limited_feed_type 2/)
})

test('失败响应被真实入口门控，不扣不记；库存为 0 时成功改修也不扣成负数', t => {
  const { book } = open(t)
  reset()
  for (const result of [0, 2]) {
    const event = variant('1', result)
    assert.deepEqual(feed(event), [])
    book.observe(event)
  }
  assert.equal(state.player.useitems[96], 3)
  assert.deepEqual(book.current({}, events[0].ts), [])
  reset({ 96: 0 })
  assert.ok(!feed(events[0]).includes('useitems'))
  assert.equal(state.player.useitems[96], 0)
  assert.deepEqual(logs, [])
})

test('同步南瓜 −3 归因 powerup；同窗口其他道具减少和南瓜增加不归到 powerup', t => {
  const { db, ledger } = open(t)
  put(db, snapshot(events[0].ts - 1000, 3))
  for (const event of events) put(db, event)
  ledger.pointAtEvent(put(db, snapshot(events.at(-1).ts + 1000, 0)))
  ledger.logUseitems(events.at(-1).ts + 1000, [
    { id: 96, delta: -3, total: 0 }, { id: 58, delta: -1, total: 0 }, { id: 96, delta: 1, total: 1 },
  ])
  assert.deepEqual(db.prepare('SELECT cause FROM useitem_log ORDER BY rowid').all().map(r => r.cause), [POWERUP, null, null])
  assert.deepEqual(cause.USEITEM_CAUSE_RULES[POWERUP], { sign: '-', items: [96] })
})

test('已过游标的三次改修单独补回、重复运行幂等；旧改修不受影响，随后同步 −3 与收据配平', async t => {
  const { db, ledger } = open(t)
  const old = variant(undefined)
  old.post.api_useitem_id = '96'
  old.post.api_useitem_count = '2'
  put(db, snapshot(events[0].ts - 1000, 3))
  put(db, old)
  for (const event of events) put(db, event)
  // 已完成旧版季节回填，且普通历史正文不可重放。
  db.prepare('UPDATE events SET body = ? WHERE id = 1').run('{')
  db.exec('INSERT INTO seasonal_backfill_state VALUES (1, 5)')
  const book = new SeasonalLedger(db)
  book.setMaster(MASTER)
  book.observe = () => assert.fail('补回不得重放普通历史或走全量回填')
  await book.startBackfill()
  assert.equal(db.prepare('SELECT event_id FROM seasonal_backfill_state').get().event_id, 5)
  assert.equal(db.prepare('SELECT completed FROM seasonal_powerup_backfill_state').get().completed, 1)
  assertThree(history(book))
  const before = db.prepare('SELECT * FROM seasonal_exchange_log ORDER BY ts').all()
  const restarted = new SeasonalLedger(db)
  restarted.setMaster(MASTER)
  restarted.observe = () => assert.fail('已完成的历史不重放')
  await restarted.startBackfill()
  await restarted.startBackfill()
  assert.deepEqual(db.prepare('SELECT * FROM seasonal_exchange_log ORDER BY ts').all(), before)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM useitem_log').get().n, 0, '补回不追扣库存')
  ledger.seasonal = restarted
  reset({ 96: 3 }, (ts, changes) => ledger.logUseitems(ts, changes))
  const event = snapshot(events.at(-1).ts + 1000, 0)
  ledger.pointAtEvent(put(db, event))
  sync(event.body.api_data, event.ts)
  assert.deepEqual(logs, [{ ts: event.ts, changes: [{ id: 96, delta: -3, total: 0 }] }])
  assert.equal(db.prepare('SELECT cause FROM useitem_log').get().cause, POWERUP)
  assertThree(history(restarted))
})

test('专项补回分批保存、重启续填；进度写入失败时收据与专项进度同批回滚', async t => {
  const { db } = open(t)
  for (let i = 0; i < 12; i++) put(db, { ...events[0], ts: events[0].ts + i })
  db.exec('INSERT INTO seasonal_backfill_state VALUES (1, 12)')
  const first = new SeasonalLedger(db)
  first.setMaster(MASTER)
  assert.equal(first.backfillBatch(), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seasonal_exchange_log').get().n, 10)
  assert.equal(db.prepare('SELECT event_id FROM seasonal_powerup_backfill_state').get().event_id, 10)
  assert.equal(db.prepare('SELECT event_id FROM seasonal_backfill_state').get().event_id, 12)
  first.stop()
  const restarted = new SeasonalLedger(db)
  restarted.setMaster(MASTER)
  restarted.observe = () => assert.fail('专项补回不得重放原回填')
  db.exec(`CREATE TRIGGER fail_powerup_progress BEFORE UPDATE ON seasonal_powerup_backfill_state
    BEGIN SELECT RAISE(ABORT, 'powerup progress write failed'); END;`)
  assert.throws(() => restarted.backfillBatch(), /powerup progress write failed/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seasonal_exchange_log').get().n, 10)
  assert.equal(db.prepare('SELECT event_id FROM seasonal_powerup_backfill_state').get().event_id, 10)
  db.exec('DROP TRIGGER fail_powerup_progress')
  await restarted.startBackfill()
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seasonal_exchange_log').get().n, 12)
  assert.equal(db.prepare('SELECT completed FROM seasonal_powerup_backfill_state').get().completed, 1)
  assert.equal(db.prepare('SELECT event_id FROM seasonal_backfill_state').get().event_id, 12)
})
