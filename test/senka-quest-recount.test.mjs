// 战果任务补记的**资格判据**与「重算任务战果」的撤回动作。
//
// 2026-08-31 用户账本实锤的错位事故：战果月在月末 **22:00 JST** 就翻页，
// 任务却要到次月 1 日 **05:00 JST** 才重置——中间这 7 小时里，月份数已经是
// 新月，季任却还挂着上一期（6–8 月）的「已完成」。旧判据只看月份数
// （季任认 3/6/9/12），于是 8 月早已上缴的 Bq8/Bq11/Bq12 共 +710
// 在翻月那一瞬被补记进了 9 月账（senka_log 856/857/858，ts 毫秒级相同）。
//
// 判据只有一条：**该任务当前周期的起点 ≥ 本战果月起点**。
// 下面既盖住那个现场，也盖住重置时刻过后必须重新放行。
//
// ⚠️ 2026-09-01 二次翻车之后，这一条**不再是入账闸**（入账只认 clearitemget
// 报文，判据与行为测试见 shared/senka-quest-book 与 senka-quest-evidence）；
// 它退成锱那张自检单子的**列不列**闸——没有它，一个 6 月交的季任会在 7、8
// 两个月一直挂在「没有领取记录」那张单子上。所以下面这些用例照旧要绿。
//
// ledger.ts 载不进 node --test（它经 ../env 拉 electron 的 app），照
// eo-senka-reported / fit-observation-ledger 的既例：把那两段方法**原样取出来**
// 在临时库上跑，测的是真 SQL 与真判据的行为。
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
const ledgerSource = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'ledger.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = ledgerSource.indexOf(from)
  const end = ledgerSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ledger.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return ledgerSource.slice(start, end)
}

// 一刀取到「查账」之前：中间正好是 logQuestSenka / questClearEvidenceTs /
// clearAutoBookedQuestSenka 三段
const QUEST_SENKA_METHODS = sliceBetween(
  '  logQuestSenka = (',
  '  /** 本战果月的逐笔账',
  'logQuestSenka / questClearEvidenceTs / clearAutoBookedQuestSenka',
)

// 建表语句也从 ledger.ts 原样取，别在测试里另写一份 DDL
const senkaLogDdl = (() => {
  const at = ledgerSource.indexOf('CREATE TABLE IF NOT EXISTS senka_log (')
  assert.ok(at >= 0, 'ledger.ts 里没有 senka_log 建表语句了')
  const end = ledgerSource.indexOf('\n      );', at)
  assert.ok(end > at, 'senka_log 建表语句没有正常收尾')
  return ledgerSource.slice(at, end + '\n      );'.length)
})()

const HARNESS = `
import { senkaMonthStart, senkaQuestPeriodStartedInMonth } from './senka'
import { questPeriodStart } from './quest-period'
import { planQuestSenkaBooking, questIdFromClearItemGet } from './senka-quest-book'

export { senkaMonthStart, senkaQuestPeriodStartedInMonth, questPeriodStart }

class QuestSenkaLedger {
  db: any
  questScanState: any = null
  constructor(db: any) { this.db = db }
${QUEST_SENKA_METHODS}
}

export const makeLedger = (db: any) => new QuestSenkaLedger(db)
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-senka-quest-'))
  for (const name of ['senka.ts', 'quest-period.ts', 'senka-quest-book.ts']) {
    fs.copyFileSync(path.join(ROOT, 'src', 'shared', name), path.join(dir, name))
  }
  const entry = path.join(dir, 'quest-senka.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'quest-senka.cjs')
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
const { makeLedger, questPeriodStart, senkaMonthStart, senkaQuestPeriodStartedInMonth } =
  require(bundle)

const JST = 9 * 3600 * 1000
const jstUtc = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - JST

const eligible = (kind, at, annualMonth) =>
  senkaQuestPeriodStartedInMonth(kind, senkaMonthStart(at), at, annualMonth)

// ---- 判据：用户 2026-08-31 的现场 ----

test('错位窗口（8/31 22:00 JST 起的 7 小时）：季任一律不列——用户账本的那三笔', () => {
  // 战果月已经翻到 9 月……
  const at = jstUtc(2026, 8, 31, 22, 30)
  assert.equal(senkaMonthStart(at), jstUtc(2026, 8, 31, 22), '此刻已属 9 月战果月')
  // ……但季任那一期的起点还是 6 月 1 日 05:00 JST，落在 9 月战果月之前
  assert.equal(questPeriodStart('quarterly', at), jstUtc(2026, 6, 1, 5))
  assert.equal(eligible('quarterly', at), false, 'Bq8/Bq11/Bq12 那三笔正是这么进来的')
  // 同一个窗口里月任 / 周任 / 日任的旧判据都是恒真，同款隐患一并堵死
  assert.equal(eligible('monthly', at), false)
  assert.equal(eligible('weekly', at), false)
  assert.equal(eligible('daily', at), false)
  assert.equal(eligible('annual', at, 9), false, '9 月年任也要等到 9/1 05:00 才重置')
})

test('窗口的两端：21:59 还是 8 月的事，05:00 一到就放行', () => {
  // 月界之前：本月就是 8 月，季任的 6 月起点当然更早——照样不列
  const before = jstUtc(2026, 8, 31, 21, 59)
  assert.equal(senkaMonthStart(before), jstUtc(2026, 7, 31, 22))
  assert.equal(eligible('quarterly', before), false)
  assert.equal(eligible('monthly', before), true, '8 月任务的一期起点是 8/1 05:00，在 8 月战果月内')

  // 重置的那一刻：起点 = 9/1 05:00 = 月界 +7h，判据取等号
  const exact = jstUtc(2026, 9, 1, 5, 0)
  assert.equal(questPeriodStart('quarterly', exact), senkaMonthStart(exact) + 7 * 3600 * 1000)
  assert.equal(eligible('quarterly', exact), true)

  const after = jstUtc(2026, 9, 1, 5, 1)
  assert.equal(eligible('quarterly', after), true)
  assert.equal(eligible('monthly', after), true)
  assert.equal(eligible('daily', after), true)
  // 05:00 之前一分钟仍在窗口里
  assert.equal(eligible('daily', jstUtc(2026, 9, 1, 4, 59)), false)
})

test('周任跨月界：要等到本战果月里的头一个周一 05:00 才算得清', () => {
  // 2026-09-01 是周二，本周的周任一期起点是 8/31 05:00——早于 8/31 22:00 的月界
  assert.equal(new Date(jstUtc(2026, 9, 1, 12) + JST).getUTCDay(), 2)
  assert.equal(questPeriodStart('weekly', jstUtc(2026, 9, 1, 5, 1)), jstUtc(2026, 8, 31, 5))
  assert.equal(eligible('weekly', jstUtc(2026, 9, 1, 5, 1)), false)
  assert.equal(eligible('weekly', jstUtc(2026, 9, 6, 12)), false, '整周都还是上周那一期')
  // 头一个周一（9/7）05:00 起，这一期完全落在 9 月战果月里
  assert.equal(eligible('weekly', jstUtc(2026, 9, 7, 4, 59)), false)
  assert.equal(eligible('weekly', jstUtc(2026, 9, 7, 5, 0)), true)
})

test('月中的常态没被改坏：月任恒列、季任只在季首月、年任只在重置月', () => {
  const at = jstUtc(2026, 8, 17, 12)
  assert.equal(eligible('monthly', at), true)
  assert.equal(eligible('daily', at), true)
  assert.equal(eligible('weekly', at), true)
  assert.equal(eligible('quarterly', at), false, '8 月不是季首月')
  assert.equal(eligible('quarterly', jstUtc(2026, 9, 17, 12)), true, '9 月是季首月')
  assert.equal(eligible('annual', at, 8), true)
  assert.equal(eligible('annual', at, 3), false)
  // 重置月未知：定位不到周期就不猜，一律不列
  assert.equal(eligible('annual', at, null), false)
  assert.equal(eligible('annual', at, undefined), false)
  assert.equal(questPeriodStart('annual', at, null), null)
})

test('2 月这类短月：月界在 2/28 22:00，月任照样要等 3/1 05:00', () => {
  assert.equal(eligible('monthly', jstUtc(2026, 2, 15, 12)), true)
  const window = jstUtc(2026, 2, 28, 22, 30)
  assert.equal(senkaMonthStart(window), jstUtc(2026, 2, 28, 22), '已经是 3 月战果月')
  assert.equal(eligible('monthly', window), false)
  assert.equal(eligible('quarterly', window), false)
  const after = jstUtc(2026, 3, 1, 5, 1)
  assert.equal(eligible('monthly', after), true)
  assert.equal(eligible('quarterly', after), true, '3 月是季首月')
})

test('跨年：1 月的月界在去年 12/31 22:00，季任要等 1/1 05:00', () => {
  const window = jstUtc(2026, 12, 31, 22, 30)
  assert.equal(eligible('quarterly', window), false, '12 月那一期是 12/1 起的，早于月界')
  assert.equal(eligible('monthly', window), false)
  const after = jstUtc(2027, 1, 1, 5, 1)
  assert.equal(eligible('monthly', after), true)
  assert.equal(eligible('quarterly', after), false, '1 月不是季首月')
  assert.equal(eligible('annual', after, 1), true)
})

// ---- 撤回：重算任务战果 ----

const openLedger = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-senka-quest-db-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  db.exec(senkaLogDdl)
  // manual 是后加的列（建表语句里没有，ledger 用 ALTER 补）；撤回的 WHERE 里
  // 有它，少这一句整段会以「no such column」变成静默的 0 笔
  db.exec('ALTER TABLE senka_log ADD COLUMN manual INTEGER')
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, ledger: makeLedger(db) }
}

// node:sqlite 返回 null 原型对象，deepEqual 会因原型不同而红——摊平再比
const rows = (db) =>
  db
    .prepare(`SELECT ts, kind, note FROM senka_log ORDER BY id`)
    .all()
    .map((row) => ({ ts: row.ts, kind: row.kind, note: row.note }))

const MONTH = senkaMonthStart(jstUtc(2026, 9, 10, 12)) // 2026-08-31 22:00 JST
// 周期口径由调用方（主进程的 quests-scn）递进来；撤回这几条测的是指纹，
// 月任那一档就够用（周期去重的行为全测在 senka-quest-evidence）
const MONTHLY = { kind: 'monthly', annualMonth: null }

test('撤回只认合成行指纹：kind=quest 且 ts 恰等于本月月初', (t) => {
  const { db, ledger } = openLedger(t)
  // 老账里的合成行：入账时间取月初整值（新口径不再这么写，但老行还在）
  assert.equal(ledger.logQuestSenka(MONTH, 893, 300, MONTHLY), true)
  assert.equal(ledger.logQuestSenka(MONTH, 894, 410, MONTHLY), true)
  // 实时领奖的一笔：真实时间戳
  assert.equal(ledger.logQuestSenka(MONTH + 5 * 3600 * 1000, 895, 80, MONTHLY), true)
  // 同一刻的经验行与 EO 行（ts 撞上月初也不许被牵连）
  db.prepare(
    `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'exp', 1000, 0.7, NULL)`,
  ).run(MONTH)
  db.prepare(
    `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'eo', 0, 75, '15')`,
  ).run(MONTH)
  // 上个月的合成行（别的月份一概不碰）
  const prevMonth = senkaMonthStart(MONTH - 1)
  db.prepare(
    `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'quest', 0, 200, '801')`,
  ).run(prevMonth)

  assert.equal(ledger.clearAutoBookedQuestSenka(MONTH), 2, '只撤回本月那两笔合成行')
  assert.deepEqual(rows(db), [
    { ts: MONTH + 5 * 3600 * 1000, kind: 'quest', note: '895' },
    { ts: MONTH, kind: 'exp', note: null },
    { ts: MONTH, kind: 'eo', note: '15' },
    { ts: prevMonth, kind: 'quest', note: '801' },
  ])
  // 幂等：没有可撤的就是 0 笔
  assert.equal(ledger.clearAutoBookedQuestSenka(MONTH), 0)
})

test('撤回之后去重跟着让路：真该记的一笔补得回来', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.logQuestSenka(MONTH, 893, 300, MONTHLY), true)
  assert.equal(ledger.logQuestSenka(MONTH, 893, 300, MONTHLY), false, '同任务同期只记一次')
  assert.equal(ledger.clearAutoBookedQuestSenka(MONTH), 1)
  assert.equal(ledger.logQuestSenka(MONTH, 893, 300, MONTHLY), true, '撤回后有证据的能重新记进')
  assert.equal(rows(db).length, 1)
})
