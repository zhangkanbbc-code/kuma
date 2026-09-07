import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'

import {
  calculateSortieSupplyCost,
  mergeSortieSupplyCosts,
} from '../src/shared/sortie-supply-cost.ts'

// 沿用账本夹具：截取真实字段、方法和 schema，在临时库执行。
// 不能 import ledger.ts：其单例会打开正式账本并运行迁移。
const source = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
const sliceBetween = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `账本夹具锚点失效：${from}`)
  return source.slice(start, end)
}
const schema = sliceBetween('      CREATE TABLE IF NOT EXISTS events (', '\n    `)')
const cacheField = sliceBetween('  private unrecoverableSortieCosts', '\n')
const methods = sliceBetween('  private recoverOverwrittenSortieCosts =', '  querySortieForecast =')
const firstPortSql = sliceBetween('SELECT MIN(ts) portTs FROM events', '`')
const candidateSql = sliceBetween('SELECT sortie_id sortieId, start_ts startTs, supply_baseline baseline', '`')
const code = transformSync(`return new class {
  constructor(db) { this.db = db }
${cacheField}
${methods}
}(db)`, { loader: 'ts' }).code
const makeLedger = new Function('db', 'calculateSortieSupplyCost', 'mergeSortieSupplyCosts', code)

const attachLedger = (db) => {
  const calls = []
  const ledger = makeLedger({
    prepare(sql) {
      const statement = db.prepare(sql)
      return Object.fromEntries(['get', 'all', 'run'].map((method) => [method, (...args) => {
        calls.push({ sql, method, args })
        return statement[method](...args)
      }]))
    },
  }, calculateSortieSupplyCost, mergeSortieSupplyCosts)
  return { ledger, calls }
}

const openLedger = (t, filename = ':memory:') => {
  const db = new DatabaseSync(filename)
  db.exec(schema)
  t.after(() => db.close())
  return { db, ...attachLedger(db) }
}
const baseline = JSON.stringify([{ rosterId: 1, fuel: 100, ammo: 100 }])
const putSortie = (db, { id = 1, start = id * 1000, map = 621, fuel = 0, ammo = 0,
  supply = baseline, completed = 1 } = {}) => db.prepare(`
    INSERT INTO sortie_samples
      (sortie_id, start_ts, end_ts, map, fleet_signature, supply_baseline,
       completed, fuel_cost, ammo_cost)
    VALUES (?, ?, ?, ?, '1', ?, ?, ?, ?)
  `).run(id, start, start + 100, map, supply, completed, fuel, ammo)
const putPort = (db, ts) => db.prepare(
  "INSERT INTO events (ts, path) VALUES (?, '/kcsapi/api_port/port')",
).run(ts)
const putDeck = (db, ts, fuel, ammo) => db.prepare(
  "INSERT INTO events (ts, path, body) VALUES (?, '/kcsapi/api_get_member/ship_deck', ?)",
).run(ts, JSON.stringify({ api_data: { api_ship_data: [{ api_id: 1, api_fuel: fuel, api_bull: ammo }] } }))
const putCharge = (db, ts, fuel, ammo) => {
  db.prepare("INSERT INTO events (ts, path, post_body) VALUES (?, '/kcsapi/api_req_hokyu/charge', ?)")
    .run(ts, JSON.stringify({ api_id_items: '1' }))
  db.prepare("INSERT INTO material_delta (ts, category, fuel, ammo) VALUES (?, '补给', ?, ?)")
    .run(ts, -fuel, -ammo)
}
const firstPortCalls = (calls) => calls.filter(({ sql, method }) => sql === firstPortSql && method === 'get')
const rawCost = (db, id = 1) => ({ ...db.prepare(
  'SELECT end_ts, fuel_cost, ammo_cost FROM sortie_samples WHERE sortie_id = ?',
).get(id) })
const closeWindow = (db) => putSortie(db, { id: 2, map: 11, completed: 0 })

test('已关闭的真零消耗样本只扫描一次；新账本实例重新尝试', (t) => {
  const { db, ledger, calls } = openLedger(t)
  putSortie(db)
  closeWindow(db)
  const first = ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 1)
  assert.ok(ledger.unrecoverableSortieCosts.has(1))
  calls.length = 0
  assert.deepEqual(ledger.queryEventSortieCosts(62, 1000), first)
  assert.equal(firstPortCalls(calls).length, 0)
  assert.equal(calls.filter(({ method }) => method === 'get').length, 0, '缓存命中连 nextStart 也不执行')
  const reopened = attachLedger(db)
  assert.deepEqual(reopened.ledger.queryEventSortieCosts(62, 1000), first)
  assert.equal(firstPortCalls(reopened.calls).length, 1, '恢复结论不能跨实例持久化')
})

for (const [label, supply, evidence] of [
  ['基线 JSON 损坏', '{', 'none'],
  ['基线不是数组', '{}', 'none'],
  ['基线为空', '[]', 'none'],
  ['有返港但无可用快照和补给', baseline, 'port'],
  ['快照确认零消耗', baseline, 'zero'],
]) {
  test(`已关闭窗口的提前跳过分支也记忆：${label}`, (t) => {
    const { db, ledger, calls } = openLedger(t)
    putSortie(db, { supply })
    closeWindow(db)
    if (evidence !== 'none') putPort(db, 1100)
    if (evidence === 'zero') putDeck(db, 1050, 100, 100)
    if (supply === '{') t.mock.method(console, 'warn', () => {})
    ledger.queryEventSortieCosts(62, 1000)
    assert.ok(ledger.unrecoverableSortieCosts.has(1))
    calls.length = 0
    ledger.queryEventSortieCosts(62, 1000)
    assert.equal(calls.filter(({ method }) => method !== 'all').length, 0)
    assert.deepEqual(rawCost(db), { end_ts: 1100, fuel_cost: 0, ammo_cost: 0 })
  })
}

test('UPDATE changes 为零的已关闭窗口也不再尝试', (t) => {
  const { db, ledger, calls } = openLedger(t)
  putSortie(db)
  closeWindow(db)
  putPort(db, 1100)
  putCharge(db, 1200, 20, 30)
  // 真 SQL 返回 changes=0，覆盖「算出 cost 但 UPDATE 没有写入」的分支。
  db.exec(`CREATE TRIGGER ignore_cost_update BEFORE UPDATE ON sortie_samples
    BEGIN SELECT RAISE(IGNORE); END;`)
  ledger.queryEventSortieCosts(62, 1000)
  assert.equal(calls.filter(({ method }) => method === 'run').length, 1)
  assert.ok(ledger.unrecoverableSortieCosts.has(1))
  calls.length = 0
  ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 0)
})

test('最新窗口保持重试，晚到的返港与匹配补给恢复燃弹并退出候选', (t) => {
  const { db, ledger, calls } = openLedger(t)
  putSortie(db)
  ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 1)
  assert.equal(ledger.unrecoverableSortieCosts.size, 0)
  putPort(db, 1100)
  putCharge(db, 1200, 20, 30)
  calls.length = 0
  const recovered = ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 1)
  assert.deepEqual(rawCost(db), { end_ts: 1100, fuel_cost: 20, ammo_cost: 30 })
  assert.equal(ledger.unrecoverableSortieCosts.size, 0, '成功恢复不进入无法恢复集合')
  assert.deepEqual(db.prepare(candidateSql).all(620, 629, 1000), [])
  calls.length = 0
  assert.deepEqual(ledger.queryEventSortieCosts(62, 1000), recovered)
  assert.equal(firstPortCalls(calls).length, 0)
})

test('最新窗口直到下一次出击开始才停止失败重试', (t) => {
  const { db, ledger, calls } = openLedger(t)
  putSortie(db)
  ledger.queryEventSortieCosts(62, 1000)
  ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 2)
  assert.equal(ledger.unrecoverableSortieCosts.size, 0)
  closeWindow(db)
  ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 3)
  assert.ok(ledger.unrecoverableSortieCosts.has(1))
  ledger.queryEventSortieCosts(62, 1000)
  assert.equal(firstPortCalls(calls).length, 3)
})

test('账本 schema 幂等建立 path/ts 索引，旧库重复打开且 firstPort 计划使用它', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-event-sortie-costs-'))
  const filename = path.join(dir, 'ledger.sqlite')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const oldDb = new DatabaseSync(filename)
  oldDb.exec(schema)
  oldDb.exec('DROP INDEX idx_events_path_ts; PRAGMA user_version = 13;')
  putPort(oldDb, 1100)
  oldDb.close()
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = new DatabaseSync(filename)
    try {
      db.exec(schema)
      assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' ORDER BY name")
        .all().map(({ name }) => name), ['idx_events_path', 'idx_events_path_ts', 'idx_events_ts'])
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${firstPortSql}`).all(1000, 2000)
      assert.match(plan.map(({ detail }) => detail).join('\n'), /idx_events_path_ts/)
      assert.equal(db.prepare(firstPortSql).get(1000, 2000).portTs, 1100)
    } finally {
      db.close()
    }
  }
})

test('有无复合索引、有无恢复集合的四种组合汇总逐字相同', (t) => {
  const expected = JSON.stringify({
    areaId: 62, sinceTs: 1000, sorties: 3, skipped: 2, fuel: 25, ammo: 37,
    maps: [
      { map: 621, sorties: 2, fuel: 20, ammo: 30 },
      { map: 622, sorties: 1, fuel: 5, ammo: 7 },
    ],
  })
  for (const indexed of [false, true]) {
    for (const cached of [false, true]) {
      const { db, ledger, calls } = openLedger(t)
      if (!indexed) db.exec('DROP INDEX idx_events_path_ts')
      putSortie(db)
      putSortie(db, { id: 2 })
      putDeck(db, 2050, 80, 90)
      putPort(db, 2100)
      putCharge(db, 2200, 15, 30)
      putSortie(db, { id: 3, map: 622, fuel: 5, ammo: 7 })
      putSortie(db, { id: 4, map: 622, fuel: null, ammo: null, supply: '[]' })
      putSortie(db, { id: 5, map: 623, fuel: null, ammo: null, supply: '[]' })
      putSortie(db, { id: 6, completed: 0 })
      putSortie(db, { id: 7, map: 11, fuel: 80, ammo: 90 })
      putSortie(db, { id: 8, start: 500, fuel: 99, ammo: 99 })
      for (let attempt = 0; attempt < 2; attempt++) {
        // 每次读之前清空集合，模拟没有负结果记忆的原例程。
        if (!cached) ledger.unrecoverableSortieCosts.clear()
        calls.length = 0
        assert.equal(JSON.stringify(ledger.queryEventSortieCosts(62, 1000)), expected,
          `index=${indexed}, cache=${cached}, attempt=${attempt}`)
        if (attempt === 1) assert.equal(firstPortCalls(calls).length, cached ? 0 : 1)
      }
      assert.deepEqual(rawCost(db, 2), { end_ts: 2100, fuel_cost: 20, ammo_cost: 30 })
      assert.equal(ledger.unrecoverableSortieCosts.has(2), false)
    }
  }
})
