import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { openLedger } from './fixtures/phantom-consumable-ledger.mjs'

const seed = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-life-level-repair-'))
  const file = path.join(dir, 'mg.sqlite')
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE ship_life_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, roster_id INTEGER NOT NULL,
    mst_id INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL, exp_delta INTEGER NOT NULL DEFAULT 0,
    map INTEGER, cell INTEGER, rank TEXT, is_boss INTEGER NOT NULL DEFAULT 0,
    practice INTEGER NOT NULL DEFAULT 0, mvp INTEGER NOT NULL DEFAULT 0,
    detail TEXT NOT NULL DEFAULT '{}', damage_taken INTEGER, taiha INTEGER, damage_dealt INTEGER
  ); PRAGMA user_version = 15;`)
  const insert = db.prepare('INSERT INTO ship_life_events (ts, roster_id, kind, exp_delta, detail) VALUES (?, ?, ?, ?, ?)')
  const add = (ship, ts, kind, detail, exp = 0) => Number(insert.run(
    ts, ship, kind, exp, typeof detail === 'string' ? detail : JSON.stringify(detail),
  ).lastInsertRowid)
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  return { dir, db, add }
}
const rows = (db) => db.prepare('SELECT * FROM ship_life_events ORDER BY id').all().map((row) => ({ ...row }))
const onlyLevelBefore = (row, level) => ({
  ...row, detail: JSON.stringify({ ...JSON.parse(row.detail), levelBefore: level }),
})

test('历史修正：入籍/经验/改造/结婚作前驱，只下调经验起始等级，其他行逐字保留', (t) => {
  const { dir, db, add } = seed(t)
  add(14, 100, 'join', { level: 72 })
  const broken = add(14, 200, 'exp', { levelBefore: 73, levelAfter: 73, totalAfter: 296254, extra: '原样' }, 140)
  add(14, 300, 'exp', ' { "levelBefore": 73, "levelAfter": 73, "totalAfter": 296454 } ', 200)
  // 晚插入的较早事件检验按时间排序；同毫秒则按 id。
  add(15, 500, 'marriage', { level: 100, equipment: [1, 2] })
  add(15, 400, 'join', { level: 99 })
  add(15, 500, 'equipment', ' { "level": 170, "before": [], "after": [1] } ')
  const married = add(15, 500, 'exp', { levelBefore: 101, levelAfter: 101, totalAfter: 1000100 }, 100)
  add(15, 600, 'remodel', { level: 105, beforeMstId: 1, afterMstId: 2 })
  const remodel = add(15, 700, 'exp', { levelBefore: 106, levelAfter: 106 }, 200)
  add(15, 800, 'exp', { levelBefore: 105, levelAfter: 106 }, 200) // 小于前驱不改
  add(16, 100, 'exp', ' { "levelBefore": 150, "levelAfter": 150 } ', 100) // 无前驱
  add(17, 100, 'join', { level: 80 })
  add(17, 200, 'battle', ' { "level": 160, "levelBefore": 170 } ')
  add(17, 300, 'exp', { totalAfter: 1000 }, 100) // 缺等级不打断前驱
  const skipped = add(17, 400, 'exp', { levelBefore: 81, levelAfter: 81 }, 100)
  const before = rows(db)
  const expectedLevels = new Map([[broken, 72], [married, 100], [remodel, 105], [skipped, 80]])
  const expected = before.map((row) => expectedLevels.has(row.id)
    ? onlyLevelBefore(row, expectedLevels.get(row.id)) : row)

  openLedger(dir).close() // 真构造器调用真迁移
  assert.deepEqual(rows(db), expected)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ship_life_level_repair_state').get().n, 1)
  const ledger = openLedger(dir)
  try {
    assert.equal(ledger.repairShipLifeExpLevels(), 0)
    assert.deepEqual(rows(db), expected)
    // 强制去掉标记重跑，算法本身仍幂等。
    db.exec('DELETE FROM ship_life_level_repair_state')
    assert.equal(ledger.repairShipLifeExpLevels(), 0)
    assert.deepEqual(rows(db), expected)
    add(18, 100, 'join', { level: 72 })
    add(18, 200, 'exp', { levelBefore: 73, levelAfter: 73 }, 140)
    const marked = rows(db)
    assert.equal(ledger.repairShipLifeExpLevels(), 0)
    assert.deepEqual(rows(db), marked) // 有标记时确实不再扫描修正
  } finally { ledger.close() }
  openLedger(dir).close()
  assert.equal(JSON.parse(rows(db).at(-1).detail).levelBefore, 73)
})

test('历史修正：合成 5 万条事件，计时真启动迁移且核对 49500 条修正', (t) => {
  const { dir, db, add } = seed(t)
  db.exec('BEGIN')
  for (let ship = 1; ship <= 500; ship++) {
    add(ship, 0, 'join', { level: 72 })
    for (let step = 1; step < 100; step++) {
      add(ship, step, 'exp', { levelBefore: 72 + step, levelAfter: 72 + step, totalAfter: 1000000 + step * 140 }, 140)
    }
  }
  db.exec('COMMIT')
  const started = performance.now()
  openLedger(dir).close()
  const elapsed = performance.now() - started
  t.diagnostic(`50000 条事件：构造器迁移及关闭 ${elapsed.toFixed(2)} ms`)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ship_life_events
    WHERE kind = 'exp' AND json_extract(detail, '$.levelAfter') - json_extract(detail, '$.levelBefore') = 1`).get().n, 49500)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ship_life_level_repair_state').get().n, 1)
})
