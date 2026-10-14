import assert from 'node:assert/strict'
import test from 'node:test'
import { fastbuildFlow, openMaterialDb, makeLedger } from './fixtures/zi-ledger.mjs'

// 旧渲染层算法作为独立对照；生产方法和 SQL 原样在隔离库执行。
const previousFlow = (rows, start, end) => {
  const flow = { gained: 0, spent: 0, changes: 0, lastTs: 0 }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].ts < start || rows[i].ts > end) continue
    const delta = rows[i].values[4] - rows[i - 1].values[4]
    if (!delta) continue
    if (delta > 0) flow.gained += delta
    else flow.spent -= delta
    flow.changes++; flow.lastTs = rows[i].ts
  }
  return flow
}
const row = (ts, value) => ({ ts, values: [11, 22, 33, 44, value, 55, 66, 77] })

test('主进程建造材汇总与旧算法一致：基线、端点、首笔、空窗、零差额和空值', () => {
  const cases = [[], [row(10, 100)], [row(9, 100), row(10, 103), row(20, 99), row(21, 200)],
    [row(11, 100), row(12, 102), row(15, 102)],
    [row(9, null), row(11, 10), row(12, null), row(13, 5)],
    [row(8, 100), row(9, 120), row(11, 120), row(12, 125), row(25, 200)]]
  for (const all of cases) {
    const before = all.filter(r => r.ts < 10).at(-1)
    const window = [...(before ? [before] : []), ...all.filter(r => r.ts >= 10)]
    assert.deepEqual(fastbuildFlow(all, 10, 20), previousFlow(window, 10, 20))
  }
})

test('三十日约 1.7 万条余额只返回四个汇总数，新增窗口后数据不影响已截定的结果', () => {
  const db = openMaterialDb()
  try {
    const insert = db.prepare('INSERT INTO material_log VALUES (?, 1, 2, 3, 4, ?, 5, 6, 7)')
    const rows = []
    for (let i = 0; i < 17000; i++) { rows.push(row(i, 500 + (i % 17))); insert.run(i, rows.at(-1).values[4]) }
    const result = makeLedger(db).queryFastbuildFlow(1, 16998)
    assert.deepEqual(result, previousFlow(rows, 1, 16998))
    assert.deepEqual(Object.keys(result), ['gained', 'spent', 'changes', 'lastTs'])
    assert.ok(JSON.stringify(result).length < 100)
    insert.run(18000, 9999)
    assert.deepEqual(makeLedger(db).queryFastbuildFlow(1, 16998), result)
  } finally { db.close() }
})

test('历史奖励版本：普通回港与首次出现之后的整表同步不变，新增候选和早期证据才失效', () => {
  const db = openMaterialDb()
  try {
    db.exec(`CREATE TABLE useitem_log (ts INTEGER, item_id INTEGER, delta INTEGER, total INTEGER, cause TEXT);
      CREATE TABLE slotitem_seen (id INTEGER, first_ts INTEGER);
      CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER, path TEXT);
      INSERT INTO slotitem_seen VALUES (1, 100);
      INSERT INTO events VALUES (1, 90, '/kcsapi/api_get_member/require_info');`)
    const ledger = makeLedger(db)
    const before = ledger.rankingRewardStamp()
    db.exec(`INSERT INTO events VALUES (2, 200, '/kcsapi/api_port/port');
      INSERT INTO events VALUES (3, 201, '/kcsapi/api_get_member/require_info');`)
    assert.equal(ledger.rankingRewardStamp(), before)
    db.exec("INSERT INTO useitem_log VALUES (200, 1, 1, 1, NULL)")
    const item = ledger.rankingRewardStamp()
    assert.notEqual(item, before)
    db.exec("INSERT INTO useitem_log VALUES (201, 1, 1, 2, '任务')")
    assert.equal(ledger.rankingRewardStamp(), item)
    db.exec('INSERT INTO slotitem_seen VALUES (2, 300)')
    const equip = ledger.rankingRewardStamp()
    assert.notEqual(equip, item)
    db.exec("INSERT INTO events VALUES (4, 250, '/kcsapi/api_req_quest/clearitemget')")
    assert.notEqual(ledger.rankingRewardStamp(), equip)
  } finally { db.close() }
})
