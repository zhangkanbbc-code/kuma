import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'

const source = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
const sliceBetween = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `账本夹具锚点变了：${from}`)
  return source.slice(start, end)
}
// 只执行实际查询和行映射，不加载会打开默认账本的模块实例。
const mapper = sliceBetween('const shipLifeEventOf = ', '\n// body 不入账')
const query = sliceBetween('  queryShipLife = (rosterId:', '\n  /**')
const code = transformSync(`${mapper}
return new class { constructor(db) { this.db = db } ${query} }(db)`, { loader: 'ts' }).code

const openLedger = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-life-report-'))
  const db = new DatabaseSync(path.join(dir, 'test.sqlite'))
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  db.exec(`
    CREATE TABLE ship_life_state (roster_id INTEGER PRIMARY KEY, first_seen INTEGER, last_seen INTEGER);
    CREATE TABLE ship_life_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, roster_id INTEGER, ts INTEGER, kind TEXT,
      exp_delta INTEGER, map INTEGER, cell INTEGER, rank TEXT, is_boss INTEGER,
      practice INTEGER, mvp INTEGER, detail TEXT, damage_taken INTEGER, taiha INTEGER, damage_dealt INTEGER
    );
  `)
  const insert = db.prepare(`INSERT INTO ship_life_events
    (roster_id, ts, kind, exp_delta, map, cell, rank, is_boss, practice, mvp, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const put = (rosterId, ts, kind, over = {}) => Number(insert.run(
    rosterId, ts, kind, over.expDelta ?? 0, over.map ?? null, over.cell ?? null,
    over.rank ?? null, over.isBoss ? 1 : 0, over.practice ? 1 : 0, over.mvp ? 1 : 0,
    JSON.stringify(over.detail ?? {}),
  ).lastInsertRowid)
  return { ledger: new Function('db', code)(db), put }
}

test('加入摘要跨过分页保留最老事件的时间、出处及全部映射字段', (t) => {
  const { ledger, put } = openLedger(t)
  const ts = Date.UTC(2026, 0, 1)
  const id = put(11, ts, 'join', { map: 15, cell: 10, isBoss: true, detail: { origin: 'drop' } })
  for (let i = 1; i <= 5; i++) put(11, ts + i, 'battle')
  put(12, ts - 1, 'join', { detail: { origin: 'build' } })
  const report = ledger.queryShipLife(11, 2)
  assert.deepEqual(report.events.map(event => event.ts), [ts + 5, ts + 4])
  assert.ok(report.events.every(event => event.kind === 'battle'))
  assert.deepEqual(report.join, {
    id, ts, kind: 'join', expDelta: 0, map: 15, cell: 10, rank: null,
    isBoss: true, practice: false, mvp: false, detail: { origin: 'drop' },
  })
  assert.deepEqual(ledger.queryShipLife(11, 6).events.at(-1), report.join)
  assert.equal(report.marriage, null)
})

test('无加入或誓约的舰返回 null，不借用别舰事件', (t) => {
  const { ledger, put } = openLedger(t)
  put(11, 1, 'join')
  put(11, 2, 'marriage')
  put(12, 3, 'battle')
  for (const rosterId of [12, 13]) {
    const report = ledger.queryShipLife(rosterId, 1)
    assert.equal(report.join, null)
    assert.equal(report.marriage, null)
  }
})

test('两条誓约取时间最早的一条，即使它不在第一页', (t) => {
  const { ledger, put } = openLedger(t)
  put(12, 1, 'marriage')
  put(11, 30, 'marriage', { detail: { level: 120 } })
  const id = put(11, 20, 'marriage', { detail: { level: 99 } })
  put(11, 40, 'battle')
  const report = ledger.queryShipLife(11, 1)
  assert.equal(report.events[0].kind, 'battle')
  assert.equal(report.marriage.id, id)
  assert.equal(report.marriage.ts, 20)
  assert.deepEqual(report.marriage.detail, { level: 99 })
})

test('加入与誓约同时间时按 id 升序取首条，分页仍按 id 降序', (t) => {
  const { ledger, put } = openLedger(t)
  for (const kind of ['join', 'marriage']) {
    put(11, 30, kind)
    const first = put(11, 20, kind, { detail: { first: true } })
    put(11, 20, kind, { detail: { first: false } })
    const report = ledger.queryShipLife(11, 10)
    assert.equal(report[kind].id, first)
    assert.equal(report[kind].detail.first, true)
    const tied = report.events.filter(event => event.kind === kind && event.ts === 20)
    assert.deepEqual(tied.map(event => event.id), [first + 1, first])
  }
})
