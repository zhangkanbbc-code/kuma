// EO 特别战果的去重按「EO 重置周期」算，不按战果月（2026-10-14 体检第 3 条，维护者「顺着处理」）。
//
// 游戏每月 1 日 05:00 JST 重置 EO 的血条与 cleared 位（shared/senka.ts 的 eoMonthResetTs）；
// 战果月却在前月末 22:00 JST 就翻页。两条线差 7 小时，于是同一个战果月里可以合法击破同一张 EO 两次：
//   10-31 23:10 击破（已算 11 月战果，属 10 月那一期 EO）→ 11-01 05:00 重置 → 11-01 06:00 再击破（11 月那一期）。
// 旧判据「同战果月同图只记一次」把第二次挡掉，每张图少记 75～250。
// 反过来，同一期 EO 里不可能击破两次（打掉之后 cleared 位一直是 1，直到重置），
// 跨了 22:00 月界又观测到一次（例如 21:30 打掉、23:10 又看到）只能是重复观测，必须挡住。
//
// 照 test/eo-senka-reported.test.mjs 的既例：把 ledger.ts 里 logEoClear 原样切出来在临时库上跑。
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
const ledgerSource = fs.readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'ledger.ts'), 'utf8').replace(/\r\n/g, '\n')
const sliceBetween = (from, to, label) => {
  const start = ledgerSource.indexOf(from)
  const end = ledgerSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ledger.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return ledgerSource.slice(start, end)
}
const LOG_EO_CLEAR = sliceBetween(
  '  logEoClear = (ts: number, mapId: number, reportedSenka?: number | null): boolean => {',
  '  logQuestSenka = (',
  'logEoClear',
)
const senkaLogDdl = (() => {
  const at = ledgerSource.indexOf('CREATE TABLE IF NOT EXISTS senka_log (')
  const end = ledgerSource.indexOf('\n      );', at)
  assert.ok(at >= 0 && end > at, 'ledger.ts 里没有 senka_log 建表语句了')
  return ledgerSource.slice(at, end + '\n      );'.length)
})()

// logEoClear 里用到的 shared/senka.ts 导出按名字自动引入（实现换用 senka.ts 里别的函数时这里不必跟着改）
const senkaSource = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'senka.ts'), 'utf8')
const senkaNames = [...senkaSource.matchAll(/^export const (\w+)/gm)].map((m) => m[1])
  .filter((name) => new RegExp(`\\b${name}\\b`).test(LOG_EO_CLEAR))
const HARNESS = `
import { ${senkaNames.join(', ')} } from './senka'
class EoLedger {
  db: any
  constructor(db: any) { this.db = db }
${LOG_EO_CLEAR}
}
export const makeLedger = (db: any) => new EoLedger(db)
`
const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-eo-reset-'))
  for (const name of fs.readdirSync(path.join(ROOT, 'src', 'shared'))) {
    if (name.endsWith('.ts')) fs.copyFileSync(path.join(ROOT, 'src', 'shared', name), path.join(dir, name))
  }
  const entry = path.join(dir, 'eo-harness.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'eo.cjs')
  buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return outfile
})()
const { makeLedger } = require(bundle)

const openLedger = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-eo-reset-db-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  db.exec(senkaLogDdl)
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, ledger: makeLedger(db) }
}
const eoCount = (db, mapId) => db.prepare(`SELECT count(*) n FROM senka_log WHERE kind = 'eo' AND note = ?`).get(`${mapId}`).n
const jst = (s) => Date.parse(`${s}+09:00`)

test('月末 22:00 后击破一次、1 日 05:00 重置后再击破一次：两笔都入账', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(jst('2026-10-31T23:10'), 15, 75), true)
  assert.equal(ledger.logEoClear(jst('2026-11-01T06:00'), 15, 75), true, '重置后是新的一期，该记')
  assert.equal(eoCount(db, 15), 2)
})

test('同一期 EO 里跨 22:00 月界又观测到一次：重复观测，挡住', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(jst('2026-10-31T21:30'), 15, 75), true)
  assert.equal(ledger.logEoClear(jst('2026-10-31T23:10'), 15, 75), false, '还没到 05:00 重置，打掉的图不可能再被打掉一次')
  assert.equal(eoCount(db, 15), 1)
})

test('同一期 EO 的月中重复观测照旧挡住；不同的图各记各的', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(jst('2026-11-01T06:00'), 15, 75), true)
  assert.equal(ledger.logEoClear(jst('2026-11-20T12:00'), 15, 75), false)
  assert.equal(ledger.logEoClear(jst('2026-11-20T12:00'), 16, 75), true)
  assert.equal(eoCount(db, 15), 1)
  assert.equal(eoCount(db, 16), 1)
})

test('相邻两个月各一期：照常各记一笔', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(jst('2026-10-05T12:00'), 15, 75), true)
  assert.equal(ledger.logEoClear(jst('2026-11-05T12:00'), 15, 75), true)
  assert.equal(eoCount(db, 15), 2)
})

test('海域页补记那一笔落在重置点：与月末 22:00 后那笔分属两期，互不挡', (t) => {
  // autoBookEoFromMapinfo 把「重置后观测到 cleared=1」的图记在重置点（1 日 05:00）
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logEoClear(jst('2026-10-31T23:10'), 15, 75), true)
  assert.equal(ledger.logEoClear(jst('2026-11-01T05:00'), 15, 75), true)
  assert.equal(eoCount(db, 15), 2)
})
