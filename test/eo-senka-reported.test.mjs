// EO 特别战果的**主从关系**：游戏亲发的 `api_get_exmap_rate` 是主，
// `shared/senka.ts` 里手维护的 `EO_SENKA` 表退居兜底。
//
// 两侧各钉一半：
// - **读**：store.ts 的 `exmapSenkaOf` 对真报文（"75" 是**字符串**）严格转数；
// - **记**：ledger.ts 的 `logEoClear` 有游戏值就用游戏值、没有才查表，
//   而且**游戏给了值、表里没有这张图时照记不误**——那正是新 EO 图刚上线、表还没跟上的情形。
//
// ledger.ts 载不进 node --test（它经 ../env 拉 electron 的 app），照
// test/fit-observation-ledger.test.mjs 的既例：把那段方法**原样取出来**在临时库上跑，
// 测的是真 SQL 与真判据的行为，不是断言源码里有某段文本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

import { EO_SENKA, senkaMonthStart } from '../src/shared/senka.ts'
import { exmapSenkaOf } from './fixtures/store-result-readers.mjs'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ledgerSource = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'ledger.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = ledgerSource.indexOf(from)
  const end = ledgerSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ledger.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return ledgerSource.slice(start, end)
}

const LOG_EO_CLEAR = sliceBetween(
  '  logEoClear = (ts: number, mapId: number, reportedSenka?: number | null): boolean => {',
  '  /** 任务领取 → 一笔特别战果',
  'logEoClear',
)

// 建表语句也从 ledger.ts 原样取，别在测试里另写一份 DDL（写歪了就测不到真的那张表）
const senkaLogDdl = (() => {
  const at = ledgerSource.indexOf('CREATE TABLE IF NOT EXISTS senka_log (')
  assert.ok(at >= 0, 'ledger.ts 里没有 senka_log 建表语句了')
  const end = ledgerSource.indexOf('\n      );', at)
  assert.ok(end > at, 'senka_log 建表语句没有正常收尾')
  return ledgerSource.slice(at, end + '\n      );'.length)
})()

const HARNESS = `
import { EO_SENKA } from './senka'
import { senkaMonthStart } from './senka'

class EoLedger {
  db: any
  constructor(db: any) { this.db = db }
${LOG_EO_CLEAR}
}

export const makeLedger = (db: any) => new EoLedger(db)
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-eo-senka-'))
  fs.copyFileSync(path.join(ROOT, 'src', 'shared', 'senka.ts'), path.join(dir, 'senka.ts'))
  const entry = path.join(dir, 'eo.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'eo.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()
const { makeLedger } = require(bundle)

const openLedger = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-eo-db-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  db.exec(senkaLogDdl)
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, ledger: makeLedger(db) }
}
// node:sqlite 返回的是 null 原型对象，deepEqual 会因为原型不同而红——摊平成普通对象再比
const eoRows = (db) =>
  db
    .prepare(`SELECT note, senka FROM senka_log WHERE kind = 'eo' ORDER BY id`)
    .all()
    .map((row) => ({ note: row.note, senka: row.senka }))

// 落在某个战果月中段的一刻，免得样例贴着月界
const AT = senkaMonthStart(Date.UTC(2026, 7, 18)) + 5 * 24 * 3600 * 1000

// ---- 读：字符串型的严格转数 ----

test('真报文的 "75" 是字符串，严格转成数字 75', () => {
  const fixtures = JSON.parse(
    fs.readFileSync(new URL('./fixtures/battle-result-coverage.json', import.meta.url), 'utf8'),
  )
  const one = fixtures.find((entry) => entry.name === 'result-eo-first-clear')
  assert.ok(one, 'fixture 里没有 result-eo-first-clear')
  assert.equal(typeof one.body.api_get_exmap_rate, 'string', '它本来就是字符串型')
  assert.equal(exmapSenkaOf(one.body), 75)
  // 这一次正是 1-5 的首破，与本地表对得上——「主」与「从」在这一点上重合
  assert.equal(EO_SENKA[15], 75)
})

test('非 EO 的场次发 0：当没有，别记成一笔 0 战果', () => {
  assert.equal(exmapSenkaOf({ api_get_exmap_rate: 0 }), null)
  assert.equal(exmapSenkaOf({ api_get_exmap_rate: '0' }), null)
  assert.equal(exmapSenkaOf({}), null)
  assert.equal(exmapSenkaOf({ api_get_exmap_rate: null }), null)
})

test('转不出数的一律当没有，不塞 NaN 进账', () => {
  for (const raw of ['', '  ', 'abc', '7.5', -75, {}, []]) {
    assert.equal(exmapSenkaOf({ api_get_exmap_rate: raw }), null, `${JSON.stringify(raw)} 不该成数`)
  }
})

// ---- 记：主从 ----

test('游戏给了值就用游戏的，本地表让位', (t) => {
  const { db, ledger } = openLedger(t)
  // 1-5 表里是 75；假设官方哪天调成 90，账上要记 90
  assert.equal(ledger.logEoClear(AT, 15, 90), true)
  assert.deepEqual(eoRows(db), [{ note: '15', senka: 90 }])
})

test('游戏没给值时退回本地表（老数据回灌、mapinfo 观测补记都走这条）', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(AT, 35, null), true)
  assert.equal(ledger.logEoClear(AT + 1000, 45), true)
  assert.deepEqual(eoRows(db), [
    { note: '35', senka: EO_SENKA[35] },
    { note: '45', senka: EO_SENKA[45] },
  ])
})

test('游戏给了值、表里根本没有这张图：照记不误（新 EO 图刚上线的情形）', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(EO_SENKA[85], undefined, '8-5 本来就不在表里')
  assert.equal(ledger.logEoClear(AT, 85, 260), true)
  assert.deepEqual(eoRows(db), [{ note: '85', senka: 260 }])
})

test('两边都没有就不记：不猜一个分值出来', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(AT, 85, null), false)
  assert.equal(ledger.logEoClear(AT, 11), false, '1-1 不是 EO 图')
  assert.deepEqual(eoRows(db), [])
})

test('游戏值是 0 / 负数 / 小数时不当数：退回本地表', (t) => {
  const { db, ledger } = openLedger(t)
  for (const bad of [0, -75, 7.5, Number.NaN]) {
    db.exec(`DELETE FROM senka_log`)
    assert.equal(ledger.logEoClear(AT, 15, bad), true)
    assert.deepEqual(eoRows(db), [{ note: '15', senka: EO_SENKA[15] }], `${bad} 不该被当成游戏值`)
  }
})

test('同一战果月同一海域只记一次——去重不因为换了分值就失效', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(AT, 15, 75), true)
  assert.equal(ledger.logEoClear(AT + 3600_000, 15, 999), false, '第二次不许再记')
  assert.deepEqual(eoRows(db), [{ note: '15', senka: 75 }])
})

test('跨到下一个战果月是新的一笔', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(AT, 15, 75), true)
  const nextMonth = senkaMonthStart(AT + 40 * 24 * 3600 * 1000) + 24 * 3600 * 1000
  assert.equal(ledger.logEoClear(nextMonth, 15, 75), true)
  assert.equal(eoRows(db).length, 2)
})

// ---- 表的现状：它还不能删 ----

test('EO_SENKA 表仍是「哪几张图算 EO」的名单，兜底之外还有这层用途', () => {
  // 退役条件写在 logEoClear 的头注里：等回灌与补记两条路都拿得到游戏值，分值才可以删；
  // 但名单这层用途与分值无关（锱的 EO 缺口那一排靠它列图），删了那一排就空了。
  const ids = Object.keys(EO_SENKA).map(Number)
  assert.ok(ids.length >= 9, 'EO 图名单不该变空')
  assert.ok(ids.every((id) => EO_SENKA[id] > 0))
})
