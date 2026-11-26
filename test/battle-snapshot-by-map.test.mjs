// 回顾按图看出击记录：全局只取最近 500 场，老海图（结束了的活动图）要能按图单独取全。
//
// 2026-11-26 维护者报「找不到活动关卡的复盘」：账本里夏活 62 区 1298 场快照都在，
// 回顾却只读全局最近 500 场再按图筛，活动结束两个月后整张图都筛成「暂无战斗记录」。
// 这里把 ledger.ts 的 queryBattleSnapshots 原样切出来，对着内存库跑真 SQL。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = fs.readFileSync(path.join(root, 'src/main/mg/ledger.ts'), 'utf8').replace(/\r\n/g, '\n')
const from = source.indexOf('  queryBattleSnapshots = ')
const to = source.indexOf('  queryBattleRun = ', from)
assert.ok(from >= 0 && to > from, 'ledger.ts 里找不到 queryBattleSnapshots，这条测试的锚点要跟着改')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-snap-by-map-'))
const outfile = path.join(dir, 'q.cjs')
buildSync({
  stdin: {
    contents: `class Q {\n  constructor(public db: any) {}\n${source.slice(from, to)}\n}\nexport const make = (db: any) => new Q(db)\n`,
    loader: 'ts',
    resolveDir: root,
  },
  outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const { make } = createRequire(import.meta.url)(outfile)
fs.rmSync(dir, { recursive: true, force: true })

const seed = () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE battle_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, sortie_id INTEGER NOT NULL, battle_no INTEGER NOT NULL,
    map INTEGER NOT NULL, cell INTEGER NOT NULL, rank TEXT, is_boss INTEGER NOT NULL DEFAULT 0, practice INTEGER NOT NULL DEFAULT 0,
    snapshot TEXT NOT NULL, UNIQUE(sortie_id, battle_no, practice))`)
  const insert = db.prepare('INSERT INTO battle_snapshots (ts, sortie_id, battle_no, map, cell, rank, is_boss, practice, snapshot) VALUES (?, ?, 1, ?, 3, ?, 0, 0, ?)')
  // 先打一段活动图（老），再打 800 场常规图（新），活动图全被挤到「最近 500 场」之外
  for (let i = 0; i < 300; i += 1) insert.run(1000 + i, 1000 + i, 621, 'S', '{}')
  for (let i = 0; i < 800; i += 1) insert.run(5000 + i, 5000 + i, i % 2 ? 15 : 54, 'A', '{}')
  return db
}

test('全局查询仍然只给最近 500 场，老活动图一场都不在里面', () => {
  const rows = make(seed()).queryBattleSnapshots(500)
  assert.equal(rows.length, 500)
  assert.ok(rows.every((row) => row.map !== 621))
})

test('按图查询取得到那一张图的全部场次（新到旧），不受全局 500 场限制', () => {
  const rows = make(seed()).queryBattleSnapshots(5000, 621)
  assert.equal(rows.length, 300)
  assert.ok(rows.every((row) => row.map === 621))
  assert.ok(rows[0].ts > rows.at(-1).ts, '按时间新到旧')
  assert.deepEqual(Object.keys(rows[0]).sort(), ['battleNo', 'cell', 'id', 'isBoss', 'map', 'practice', 'rank', 'sortieId', 'ts'])
})

test('按图查询的上限是 5000；不给图（或给 0）退回全局查询', () => {
  const q = make(seed())
  assert.equal(q.queryBattleSnapshots(99999, 621).length, 300)
  assert.equal(q.queryBattleSnapshots(500, 0).length, 500)
})

test('按图列表只铺最近 500 场、场数照报全部：练级图几千场时不整串拼几千行', async () => {
  const { runtimeHost } = await import('../scripts/lib/player-view-runtime.mjs')
  const rows = Array.from({ length: 1234 }, (_, i) => ({ id: i + 1, map: 32, cell: i % 2 ? 5 : 3, practice: false, isBoss: false, ts: 10_000 - i }))
  const shown = []
  const { nodeSnapshotsBlock, nodeBattlesBlock } = runtimeHost().extract('src/renderer/modules/shi.ts', ['MAP_LIST_LIMIT', 'listedCount', 'nodeSnapshotsBlock', 'nodeBattlesBlock'], {
    battlesOfMap: () => rows,
    battles: [],
    selectedNode: { map: 32, cell: 3 },
    battleHistoryHtml: (list) => { shown.push(list); return `<i data-n="${list.length}"></i>` },
    mapCode: () => '3-2',
    letterOf: () => 'C',
  }).api
  const block = nodeSnapshotsBlock(32)
  assert.equal(shown[0].length, 500)
  assert.equal(shown[0][0].id, 1, '从最近的一场起铺')
  assert.equal(block.title, '3-2 · 1234 场（列出最近 500 场） · 点击复盘')
  const node = nodeBattlesBlock()
  assert.equal(shown[1].length, 500)
  assert.equal(node.title, '3-2 · C 点 · 617 场（列出最近 500 场） · 点击复盘')
  // 不到上限照旧只报场数
  rows.length = 20
  assert.equal(nodeSnapshotsBlock(32).title, '3-2 · 20 场 · 点击复盘')
})
