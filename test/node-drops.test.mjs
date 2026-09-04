import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const read = (relative) =>
  fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `${label} 的源码锚点变了`)
  return source.slice(start, end)
}

const bundleHarness = (t, name, source) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kanso-${name}-`))
  const entry = path.join(dir, `${name}.ts`)
  const output = path.join(dir, `${name}.cjs`)
  fs.writeFileSync(entry, source)
  buildSync({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return require(output)
}

const makeEncountersDb = (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE IF NOT EXISTS encounters (
      ts INTEGER NOT NULL,
      map INTEGER NOT NULL,          -- area*10+no
      cell INTEGER NOT NULL,         -- 罗盘 api_no
      is_boss INTEGER NOT NULL,
      formation INTEGER,             -- 敌阵形
      comp TEXT NOT NULL,            -- 敌编成 mstId 数组 JSON（联合 12 舰）
      rank TEXT,                     -- 实际评级
      drop_mst INTEGER,               -- 掉落舰 mstId（无 = NULL）
      sunk_mask INTEGER          -- comp 第 i 位是否被击沉的位掩码；NULL = 该列上线前的老记录
    );
  `)
  const insert = db.prepare(`
    INSERT INTO encounters
      (ts, map, cell, is_boss, formation, comp, rank, drop_mst, sunk_mask)
    VALUES (?, ?, ?, ?, 1, '[]', ?, ?, NULL)
  `)
  insert.run(100, 11, 1, 0, 'S', 101)
  insert.run(200, 11, 1, 1, 'A', 102)
  insert.run(300, 11, 1, 0, 'S', null)
  insert.run(400, 11, 1, 1, 'S', 101)
  insert.run(500, 11, 2, 0, 'B', null)
  insert.run(600, 11, 2, 1, 'S', 103)
  insert.run(700, 12, 3, 0, 'A', 104)
  insert.run(800, 12, 3, 1, 'S', 105)
  return db
}

test('node drop index only lists points with drops in latest-drop order', (t) => {
  const ledger = read('src/main/mg/ledger.ts')
  const method = sliceBetween(
    ledger,
    '  queryNodeDropIndex = (limit = 300): NodeDropIndex => {',
    '  queryNodeHistory = (map: number, cell: number, limit = 60): NodeHistoryReport => {',
    'queryNodeDropIndex',
  )
  const { makeLedger } = bundleHarness(
    t,
    'node-drop-index-ledger',
    `type NodeDropIndex = any
class NodeDropIndexLedger {
  db: any
  constructor(db: any) { this.db = db }
${method}
}
export const makeLedger = (db: any) => new NodeDropIndexLedger(db)
`,
  )
  const report = makeLedger(makeEncountersDb(t)).queryNodeDropIndex(3)

  assert.deepEqual(report, {
    kinds: 5,
    entries: [
      { map: 12, cell: 3, drops: 2, kinds: 2, lastTs: 800 },
      { map: 11, cell: 2, drops: 1, kinds: 1, lastTs: 600 },
      { map: 11, cell: 1, drops: 3, kinds: 2, lastTs: 400 },
    ],
  })
  assert.deepEqual(
    makeLedger(makeEncountersDb(t)).queryNodeDropIndex(1),
    {
      kinds: 5,
      entries: [{ map: 12, cell: 3, drops: 2, kinds: 2, lastTs: 800 }],
    },
  )

  const crossNodeDb = makeEncountersDb(t)
  crossNodeDb.exec(`
    DELETE FROM encounters;
    INSERT INTO encounters
      (ts, map, cell, is_boss, formation, comp, rank, drop_mst, sunk_mask)
    VALUES
      (100, 11, 1, 0, 1, '[]', 'S', 101, NULL),
      (200, 11, 2, 0, 1, '[]', 'S', 101, NULL);
  `)
  assert.deepEqual(makeLedger(crossNodeDb).queryNodeDropIndex(3), {
    kinds: 1,
    entries: [
      { map: 11, cell: 2, drops: 1, kinds: 1, lastTs: 200 },
      { map: 11, cell: 1, drops: 1, kinds: 1, lastTs: 100 },
    ],
  })
})

test('node drops summarize every battle but only return drops newest first', (t) => {
  const ledger = read('src/main/mg/ledger.ts')
  const method = sliceBetween(
    ledger,
    '  queryNodeDrops = (map: number, cell: number, limit = 60): NodeDropReport => {',
    '  // 某点出发的带路分布：to_cell → 次数',
    'queryNodeDrops',
  )
  const { makeLedger } = bundleHarness(
    t,
    'node-drops-ledger',
    `type NodeDropReport = any
class NodeDropsLedger {
  db: any
  constructor(db: any) { this.db = db }
${method}
}
export const makeLedger = (db: any) => new NodeDropsLedger(db)
`,
  )
  const ledgerHarness = makeLedger(makeEncountersDb(t))

  assert.deepEqual(ledgerHarness.queryNodeDrops(11, 1, 500), {
    map: 11,
    cell: 1,
    battles: 4,
    sWins: 3,
    drops: 3,
    kinds: 2,
    entries: [
      { ts: 400, isBoss: true, rank: 'S', mstId: 101 },
      { ts: 200, isBoss: true, rank: 'A', mstId: 102 },
      { ts: 100, isBoss: false, rank: 'S', mstId: 101 },
    ],
  })
  assert.deepEqual(
    ledgerHarness.queryNodeDrops(11, 1, 2).entries.map((entry) => entry.ts),
    [400, 200],
  )
  assert.deepEqual(ledgerHarness.queryNodeDrops(99, 9), {
    map: 99,
    cell: 9,
    battles: 0,
    sWins: 0,
    drops: 0,
    kinds: 0,
    entries: [],
  })
})

test('node drop view keeps the shared node selection wiring', () => {
  const shi = read('src/renderer/modules/shi.ts')
  assert.match(shi, /data-shi-node-sub="drops"/)
  assert.match(shi, /data-keep="drop-group:\$\{map\}"/)
  assert.match(shi, /queryNodeDrops\(map, cell, 500\)/)
})
