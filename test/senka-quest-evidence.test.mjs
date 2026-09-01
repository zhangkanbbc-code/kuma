// 任务战果**只认硬证据**入账（2026-09-01 用户拍板，二次翻车之后立的）。
//
// 现场：9 月账凭空多出五笔任务战果（quest 284/845/854/872/893，共 +1460，
// 官方真值 35）。其中 854/872 用户**从没做过**——账本 quest_progress 一行都没有，
// events 里一条 clearitemget 都没有。按「重算任务战果」删掉，同一判据立刻又补回来。
// 根因是「已完成」这个结论本身是**推断**（前置满足 + 不在任务表 = 已交付），
// 而任务表在月初重置那一刻本来就会失真——闸是好的，被它放行的结论是编的。
//
// 新口径三条（正文与出处见 shared/senka-quest-book）：
//   ① 入账只认账本里存着的 clearitemget 报文；推断永远不入账；
//   ② 归属月看证据的时间戳，不看「现在是几月」；
//   ③ 循环任务一个周期只计一次，计在完成动作发生的那个月。
//
// 判定那一层是纯算术，直接 import dist 跑；账本那一层（真 SQL、真 events 表、
// 真 v11 迁移）照 senka-quest-recount 的既例把方法**原样取出来**在临时库上跑。
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

const LEDGER_PARTS = [
  sliceBetween(
    '  private runBatch = (count: number, fn: () => void) => {',
    '  record = (',
    'runBatch',
  ),
  sliceBetween(
    '  private revokeUnevidencedQuestSenkaV11 = () => {',
    '  // 任务领域快照曾经只 merge 页面',
    'revokeUnevidencedQuestSenkaV11',
  ),
  sliceBetween(
    '  logQuestSenka = (',
    '  /** 本战果月的逐笔账',
    'logQuestSenka / questClearEvidenceTs / clearAutoBookedQuestSenka',
  ),
  sliceBetween(
    '  // 任务战果补记的增量扫描位置',
    '  /** 校准之后的账内新增',
    'autoBookQuestSenkaFromEvents',
  ),
  // 继承里「前月特别」含不含手动补记行，只有跑真的 querySenka 才答得上来
  sliceBetween(
    '  /** 本战果月的逐笔账',
    '  // EO 自动对账的增量扫描位置',
    'querySenka',
  ),
].join('\n')

// 建表语句一律从 ledger.ts 原样取，别在测试里另写一份 DDL
const ddl = (marker, label) => {
  const at = ledgerSource.indexOf(marker)
  assert.ok(at >= 0, `ledger.ts 里没有${label}建表语句了`)
  const end = ledgerSource.indexOf('\n      );', at)
  assert.ok(end > at, `${label}建表语句没有正常收尾`)
  return ledgerSource.slice(at, end + '\n      );'.length)
}
const SCHEMA = [
  ddl('CREATE TABLE IF NOT EXISTS senka_log (', 'senka_log'),
  ddl('CREATE TABLE IF NOT EXISTS events (', 'events'),
].join('\n')

const HARNESS = `
import {
  CARRY_EXP_DIVISOR,
  CARRY_SPECIAL_DIVISOR,
  capSenkaEntries,
  senkaCarryWindows,
  senkaMonthEnd,
  senkaMonthStart,
} from './senka'
import {
  manualQuestSenkaTs,
  planManualQuestSenkaBooking,
  planQuestSenkaBooking,
  questCountsObservedFull,
  questIdFromClearItemGet,
  questSenkaBookingWindow,
} from './senka-quest-book'
import { questPeriodEnd, questPeriodStart } from './quest-period'

export {
  manualQuestSenkaTs,
  planManualQuestSenkaBooking,
  planQuestSenkaBooking,
  questCountsObservedFull,
  questIdFromClearItemGet,
  questSenkaBookingWindow,
  questPeriodEnd,
  questPeriodStart,
  senkaMonthStart,
  senkaMonthEnd,
}

class QuestSenkaLedger {
  db: any
  questScanState: any = null
  constructor(db: any) { this.db = db }
${LEDGER_PARTS}
  runV11() { return this.revokeUnevidencedQuestSenkaV11() }
}

export const makeLedger = (db: any) => new QuestSenkaLedger(db)
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-senka-evidence-'))
  for (const name of ['senka.ts', 'quest-period.ts', 'senka-quest-book.ts']) {
    fs.copyFileSync(path.join(ROOT, 'src', 'shared', name), path.join(dir, name))
  }
  const entry = path.join(dir, 'quest-evidence.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'quest-evidence.cjs')
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
const {
  makeLedger,
  manualQuestSenkaTs,
  planManualQuestSenkaBooking,
  planQuestSenkaBooking,
  questCountsObservedFull,
  questIdFromClearItemGet,
  questSenkaBookingWindow,
  questPeriodEnd,
  questPeriodStart,
  senkaMonthStart,
  senkaMonthEnd,
} = require(bundle)

const JST = 9 * 3600 * 1000
const jstUtc = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - JST

// ---- ① 报文怎么读出任务号 ----

test('证据解析：存下来的 post_body 是 JSON 串，不是表单串', () => {
  // 用户账本里的真形态（抓包桥 querystring.parse → JSON.stringify，凭据洗过）
  assert.equal(
    questIdFromClearItemGet('{"api_token":"<redacted>","api_verno":"1","api_quest_id":"893"}'),
    893,
  )
  // 表单串兜底：格式意外不该让「有没有证据」悄悄退化成「没有」
  assert.equal(questIdFromClearItemGet('api_token=x&api_quest_id=284&api_verno=1'), 284)
  // 说不出任务号的一律 null——绝不猜一个出来
  assert.equal(questIdFromClearItemGet(null), null)
  assert.equal(questIdFromClearItemGet(''), null)
  assert.equal(questIdFromClearItemGet('{"api_verno":"1"}'), null)
  assert.equal(questIdFromClearItemGet('{"api_quest_id":"0"}'), null)
  assert.equal(questIdFromClearItemGet('{"api_quest_id":"abc"}'), null)
})

// ---- ② 周期区间 ----

test('周期终点：一期的右边界就是下一期的起点，跨年跨季自己进位', () => {
  const at = jstUtc(2026, 9, 15, 12)
  assert.equal(questPeriodEnd('daily', at), questPeriodStart('daily', at) + 86_400_000)
  assert.equal(questPeriodEnd('weekly', at), questPeriodStart('weekly', at) + 7 * 86_400_000)
  assert.equal(questPeriodEnd('monthly', at), jstUtc(2026, 10, 1, 5))
  assert.equal(questPeriodEnd('quarterly', at), jstUtc(2026, 12, 1, 5))
  assert.equal(questPeriodEnd('annual', at, 9), jstUtc(2027, 9, 1, 5))
  // 12 月那一季要进位到次年 3 月（Date.UTC 自己会算，不许手写年份进位）
  assert.equal(questPeriodEnd('quarterly', jstUtc(2026, 12, 20, 12)), jstUtc(2027, 3, 1, 5))
  // 年任重置月未知：起点定不下来，区间就不成立
  assert.equal(questPeriodEnd('annual', at, null), null)
  // 自反：终点前 1ms 还是这一期，终点那一刻已经是下一期
  for (const [kind, annual] of [['daily'], ['weekly'], ['monthly'], ['quarterly'], ['annual', 9]]) {
    const end = questPeriodEnd(kind, at, annual)
    assert.equal(questPeriodStart(kind, end - 1, annual), questPeriodStart(kind, at, annual), kind)
    assert.notEqual(questPeriodStart(kind, end, annual), questPeriodStart(kind, at, annual), kind)
  }
})

test('去重窗口 = 周期 ∪ 战果月：两头都要盖住', () => {
  // 季任在季中：周期比战果月宽，窗口就是那一季
  const sep = jstUtc(2026, 10, 15, 12) // 10 月 15 日，属 9–11 月那一季
  const wide = questSenkaBookingWindow('quarterly', sep)
  assert.equal(wide.from, jstUtc(2026, 9, 1, 5))
  assert.equal(wide.to, jstUtc(2026, 12, 1, 5))
  // 月任在月中：周期起点（1 日 05:00）晚于月界（前月末 22:00），
  // 取并集才框得住那些 ts 被钉在月初整值上的老合成行
  const mid = jstUtc(2026, 9, 15, 12)
  const monthly = questSenkaBookingWindow('monthly', mid)
  assert.equal(monthly.from, senkaMonthStart(mid), '并集的左端必须退到月界，不是 1 日 05:00')
  assert.ok(monthly.from < questPeriodStart('monthly', mid))
  // 右端同理往后让 7 小时（下月 1 日 05:00 晚于月末 22:00 的月界）：
  // 9/30 23:00 交的月任已经算 10 月战果月，但仍是 9 月那一期，同一期不许记第二笔
  assert.equal(monthly.to, questPeriodEnd('monthly', mid))
  assert.ok(monthly.to > senkaMonthEnd(mid))
  // 周期定位不到（年任重置月未知 / 不是常设编码）：只剩战果月那一段，不放大也不缩小
  assert.deepEqual(questSenkaBookingWindow(null, mid), {
    from: senkaMonthStart(mid),
    to: senkaMonthEnd(mid),
  })
  assert.deepEqual(questSenkaBookingWindow('annual', mid, null), {
    from: senkaMonthStart(mid),
    to: senkaMonthEnd(mid),
  })
})

// ---- ③ 入账裁决 ----

const plan = (over) =>
  planQuestSenkaBooking({ senka: 300, kind: 'quarterly', annualMonth: null, bookedTs: [], ...over })

test('没有证据就不入账——推断出来的「已完成」一律拦在门外', () => {
  const verdict = plan({ evidenceTs: null })
  assert.equal(verdict.book, false)
  assert.equal(verdict.reason, 'no-evidence')
  assert.equal(verdict.ts, null, '不入账时连时刻都不许编一个出来')
  // 不是战果任务（解不出固定分值）同样不入账，且要说得出是哪一种「不」
  assert.equal(plan({ senka: 0, evidenceTs: jstUtc(2026, 9, 3, 12) }).reason, 'no-senka')
})

test('归属看证据的时间戳：入账时刻就是观测到报文的那一刻', () => {
  const evidenceTs = jstUtc(2026, 9, 3, 21, 47)
  const verdict = plan({ evidenceTs })
  assert.equal(verdict.book, true)
  assert.equal(verdict.ts, evidenceTs)
  assert.equal(senkaMonthStart(verdict.ts), senkaMonthStart(evidenceTs))
})

test('循环任务一个周期只计一次：同期后续月份看到「已完成」也不再计', () => {
  // 9–11 月那一季：9/3 交的那一笔已经在账里
  const booked = jstUtc(2026, 9, 3, 12)
  // 同一季的 10 月再想记一笔（旧口径按「同任务同月」判会放行——那就是重复计算）
  const october = plan({ evidenceTs: jstUtc(2026, 10, 20, 12), bookedTs: [booked] })
  assert.equal(october.book, false)
  assert.equal(october.reason, 'already-booked')
  // 下一季（12 月）是新的一期，该记还得记
  const december = plan({ evidenceTs: jstUtc(2026, 12, 5, 12), bookedTs: [booked] })
  assert.equal(december.book, true)
  // 月任：8 月记过一笔，9 月是新一期，照记
  const monthly = { kind: 'monthly', annualMonth: null }
  assert.equal(
    planQuestSenkaBooking({
      ...monthly,
      senka: 80,
      evidenceTs: jstUtc(2026, 9, 10, 12),
      bookedTs: [jstUtc(2026, 8, 10, 12)],
    }).book,
    true,
  )
})

test('跨月的那一期：8/31 22:00–9/1 05:00 这 7 小时两边都封得住', () => {
  // 事故那一刻：战果月已翻到 9 月，季任那一期还是 6 月起的。
  // 8/12 那笔真账（在 8 月账里）落在同一期内 → 9 月这一笔记不进来。
  const augEvidence = jstUtc(2026, 8, 12, 17, 14)
  const slip = plan({ evidenceTs: jstUtc(2026, 8, 31, 22, 30), bookedTs: [augEvidence] })
  assert.equal(slip.book, false)
  assert.equal(slip.reason, 'already-booked', '旧口径正是在这里放行了 Bq8/Bq11/Bq12')
  // 镜像方向：9/30 23:00 交的月任，战果月已是 10 月、任务周期还是 9 月那一期。
  // 「计在完成动作发生的那个月」→ 记进 10 月，入账时刻就是 9/30 23:00。
  const lateEvidence = jstUtc(2026, 9, 30, 23, 0)
  const late = planQuestSenkaBooking({
    senka: 80,
    kind: 'monthly',
    annualMonth: null,
    evidenceTs: lateEvidence,
    bookedTs: [],
  })
  assert.equal(late.book, true)
  assert.equal(late.ts, lateEvidence)
  assert.equal(senkaMonthStart(late.ts), jstUtc(2026, 9, 30, 22), '归属 10 月战果月')
  // 但同一期若在 9 月已经记过，10 月这一笔照样不许再记
  assert.equal(
    planQuestSenkaBooking({
      senka: 80,
      kind: 'monthly',
      annualMonth: null,
      evidenceTs: lateEvidence,
      bookedTs: [jstUtc(2026, 9, 10, 12)],
    }).reason,
    'already-booked',
  )
})

test('老账兼容：ts 被钉在月初整值上的合成行照样挡得住重复', () => {
  // 老口径的合成行 ts = 战果月起点（8/31 22:00 JST），早于月任 9/1 05:00 的周期起点，
  // 只按周期框就框不住它——并集窗口就是为这个留的
  const synthetic = senkaMonthStart(jstUtc(2026, 9, 15, 12))
  const verdict = planQuestSenkaBooking({
    senka: 80,
    kind: 'monthly',
    annualMonth: null,
    evidenceTs: jstUtc(2026, 9, 15, 12),
    bookedTs: [synthetic],
  })
  assert.equal(verdict.book, false)
  assert.equal(verdict.reason, 'already-booked')
})

// ---- ④ 账本那一层：真 SQL、真 events ----

// senka_log.manual 是后加的列（建表语句里没有，ledger 用 ALTER 补）。
// 测试库照抄同一条，并守住 ledger 里那一行还在——漏了它下面全部手动补记用例
// 会以「no such column」整片红，而不是安静地测错。
assert.ok(
  /\['senka_log', 'manual', 'INTEGER'\]/.test(ledgerSource),
  'ledger.ts 的补列清单里没有 senka_log.manual 了',
)

const openLedger = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-senka-evidence-db-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  db.exec(SCHEMA)
  db.exec('ALTER TABLE senka_log ADD COLUMN manual INTEGER')
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, ledger: makeLedger(db) }
}

const claim = (db, ts, questId) =>
  db
    .prepare(`INSERT INTO events (ts, method, path, body, post_body) VALUES (?, 'POST', ?, NULL, ?)`)
    .run(
      ts,
      '/kcsapi/api_req_quest/clearitemget',
      JSON.stringify({ api_token: '<redacted>', api_verno: '1', api_quest_id: `${questId}` }),
    )

const questRows = (db) =>
  db
    .prepare(`SELECT ts, note, senka FROM senka_log WHERE kind = 'quest' ORDER BY ts, note`)
    .all()
    .map((row) => ({ ts: row.ts, note: row.note, senka: Number(row.senka) }))

const SCN = {
  284: { senka: 80, kind: 'weekly', annualMonth: null },
  845: { senka: 330, kind: 'quarterly', annualMonth: null },
  854: { senka: 350, kind: 'quarterly', annualMonth: null },
  872: { senka: 400, kind: 'quarterly', annualMonth: null },
  893: { senka: 300, kind: 'quarterly', annualMonth: null },
  403: { senka: 0, kind: 'weekly', annualMonth: null },
}
const resolve = (id) => (SCN[id]?.senka ? SCN[id] : null)

test('证据查询：只认那一条 path，任务号在 JS 侧解（LIKE 凑不出正确答案）', (t) => {
  const { db, ledger } = openLedger(t)
  const at = jstUtc(2026, 9, 3, 21, 47)
  claim(db, at, 893)
  claim(db, at + 60_000, 8931) // 前缀撞车：SQL 里拿 LIKE '%893%' 会一并命中
  // 别的报文不许被当成领奖证据
  db.prepare(
    `INSERT INTO events (ts, method, path, body, post_body) VALUES (?, 'POST', ?, NULL, ?)`,
  ).run(at + 120_000, '/kcsapi/api_req_quest/start', '{"api_quest_id":"845"}')
  const from = senkaMonthStart(at)
  const to = senkaMonthEnd(at)
  assert.equal(ledger.questClearEvidenceTs(893, from, to), at)
  assert.equal(ledger.questClearEvidenceTs(8931, from, to), at + 60_000)
  assert.equal(ledger.questClearEvidenceTs(845, from, to), null, 'start 不是领奖')
  // 窗口外的观测不作数——归属月由证据时刻定，不由查询时刻定
  const prevMonth = senkaMonthStart(from - 1)
  assert.equal(ledger.questClearEvidenceTs(893, prevMonth, from), null)
})

test('补记扫描只按报文来：用户 9 月那五笔，一笔都进不来', (t) => {
  const { db, ledger } = openLedger(t)
  const when = jstUtc(2026, 9, 15, 12)
  // 用户账本的真实情况：9 月一条 clearitemget 都没有（284/845/854/872/893 全无观测）
  claim(db, jstUtc(2026, 9, 1, 10, 32), 503) // 有报文，但不是战果任务
  claim(db, jstUtc(2026, 8, 13, 0, 34), 893) // 有报文，但在 8 月——归 8 月
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(when, resolve), [])
  assert.deepEqual(questRows(db), [], '推断进不来账，一分钱都不许多')
})

test('补记扫描：有报文的记进来，入账时刻是报文时刻；重扫幂等', (t) => {
  const { db, ledger } = openLedger(t)
  const when = jstUtc(2026, 9, 15, 12)
  const gotIt = jstUtc(2026, 9, 3, 21, 47)
  claim(db, gotIt, 845)
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(when, resolve), [845])
  assert.deepEqual(questRows(db), [{ ts: gotIt, note: '845', senka: 330 }])
  // 再扫一次不许多出一笔（游标 + 去重两道都要成立）
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(when, resolve), [])
  ledger.questScanState = null // 游标作废了也照样不许重复
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(when, resolve), [])
  assert.equal(questRows(db).length, 1)
})

test('撤回之后重扫：有报文的落回真实时刻，没报文的回不来', (t) => {
  const { db, ledger } = openLedger(t)
  const when = jstUtc(2026, 9, 15, 12)
  const monthStart = senkaMonthStart(when)
  const gotIt = jstUtc(2026, 9, 3, 21, 47)
  claim(db, gotIt, 845)
  // 老口径写下的五笔合成行（ts 一律月初整值），其中只有 845 有报文撑腰
  for (const [id, senka] of [
    [284, 80],
    [845, 330],
    [854, 350],
    [872, 400],
    [893, 300],
  ]) {
    db.prepare(
      `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'quest', 0, ?, ?)`,
    ).run(monthStart, senka, `${id}`)
  }
  assert.equal(ledger.clearAutoBookedQuestSenka(monthStart), 5, '五笔合成行全撤')
  const booked = ledger.autoBookQuestSenkaFromEvents(when, resolve)
  assert.deepEqual(booked, [845])
  assert.deepEqual(
    questRows(db),
    [{ ts: gotIt, note: '845', senka: 330 }],
    '回来的只有有报文那一笔，且落在真实领奖时刻',
  )
})

test('v11 迁移：撤回本月无报文的合成行，有报文的留着，历史月一行不碰', (t) => {
  const { db, ledger } = openLedger(t)
  // 迁移读的是 Date.now()，所以数据按**当下**这个战果月摆
  const now = Date.now()
  const monthStart = senkaMonthStart(now)
  const prevMonthStart = senkaMonthStart(monthStart - 1)
  const evidenceTs = monthStart + 3 * 24 * 3600 * 1000
  claim(db, evidenceTs, 845)
  const put = (ts, senka, note) =>
    db
      .prepare(`INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, ?, 0, ?, ?)`)
      .run(ts, 'quest', senka, note)
  put(monthStart, 330, '845') // 本月合成行，有报文 → 留
  put(monthStart, 350, '854') // 本月合成行，无报文 → 撤
  put(monthStart, 400, '872') // 同上
  put(evidenceTs + 1000, 80, '284') // 本月实时行（ts 不是月初整值）→ 不在指纹里，留
  put(prevMonthStart, 200, '801') // 上个月的合成行 → 历史不追溯，留
  db.prepare(
    `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'eo', 0, 75, '15')`,
  ).run(monthStart) // ts 撞上月初的 EO 行也不许被牵连

  ledger.runV11()

  assert.deepEqual(questRows(db), [
    { ts: prevMonthStart, note: '801', senka: 200 },
    { ts: monthStart, note: '845', senka: 330 },
    { ts: evidenceTs + 1000, note: '284', senka: 80 },
  ])
  assert.equal(
    db.prepare(`SELECT COUNT(*) n FROM senka_log WHERE kind = 'eo'`).get().n,
    1,
    'EO 行不许被牵连',
  )
  // 幂等：再跑一次没有可撤的
  ledger.runV11()
  assert.equal(questRows(db).length, 3)
})

// ---- ⑤ 提示单的入场券：kuma 自家的观测计数（2026-09-01 二次收紧）----
//
// f3543a3 只换了**入账**那一层；「看着已完成、账里没有」那张提示单还是由推断填的，
// 于是用户那五条从没做过的任务（quest_progress 一行都没有）照旧全表挂在自检里。
// 现在提示也只认自家观测：钦的追踪计数在本周期真数满，才谈得上「可能交付过」。

test('计数判据：本周期数满才算，没满 / 一格没数过一律不算', () => {
  const one = (counts, extra = {}) =>
    questCountsObservedFull({ targets: [{ slot: 0, target: 3 }], counts, ...extra })
  assert.equal(one([3]), true, '数满了')
  assert.equal(one([4]), true, '超了也算满')
  assert.equal(one([2]), false, '差一个就不算')
  assert.equal(one([0]), false, '零不是满')
  assert.equal(one([]), false)
  assert.equal(one(null), false, '从没观测过')
  assert.equal(one(undefined), false)
  assert.equal(
    questCountsObservedFull({ targets: [], counts: [7] }),
    false,
    '没有可计数动作的任务，观测不出满不满',
  )
})

test('计数判据：多槽要逐槽满，且认槽号不认下标', () => {
  const four = [
    { slot: 0, target: 1 },
    { slot: 1, target: 1 },
    { slot: 2, target: 1 },
    { slot: 3, target: 1 },
  ]
  assert.equal(questCountsObservedFull({ targets: four, counts: [1, 1, 1, 1] }), true)
  assert.equal(questCountsObservedFull({ targets: four, counts: [1, 1, 1, 0] }), false)
  // 备选任务共用一个槽时，槽号与 tasks 下标会错位（镖曾因此串位）。
  // 按下标读会把 2 号槽的 0 读成 1 号槽的 1，判成「满了」。
  const sparse = [
    { slot: 0, target: 2 },
    { slot: 2, target: 1 },
  ]
  assert.equal(questCountsObservedFull({ targets: sparse, counts: [2, 0, 1] }), true)
  assert.equal(
    questCountsObservedFull({ targets: sparse, counts: [2, 1, 0] }),
    false,
    '2 号槽是 0，按下标读会误判成满',
  )
})

test('计数判据：计满 ≠ 交付过的那几族（approx / partial / 状态门库存门）一律不列', () => {
  const full = { targets: [{ slot: 0, target: 1 }], counts: [1] }
  assert.equal(questCountsObservedFull(full), true)
  assert.equal(questCountsObservedFull({ ...full, approx: true }), false, '计数本身就是推定')
  assert.equal(questCountsObservedFull({ ...full, partial: true }), false, '只覆盖部分条件')
  assert.equal(questCountsObservedFull({ ...full, extraGoals: true }), false, '还有状态/库存门')
})

test('用户那五条的现场：计数全空，改后一条都进不了提示单', () => {
  // 284/845/854/872/893——账本 quest_progress 一行都没有，就是「counts 取不到」
  for (const targets of [
    [{ slot: 0, target: 4 }],
    [
      { slot: 0, target: 1 },
      { slot: 1, target: 1 },
      { slot: 2, target: 1 },
    ],
  ]) {
    assert.equal(questCountsObservedFull({ targets, counts: undefined }), false)
    assert.equal(questCountsObservedFull({ targets, counts: [] }), false)
    assert.equal(questCountsObservedFull({ targets, counts: [0, 0, 0] }), false)
  }
})

// ---- ⑥ 手动补记：落账时刻与双向去重 ----

test('手动补记的落账时刻 = 本战果月起点与本周期起点里较晚的那个', () => {
  // 季任 9 月那一期从 9/1 05:00 起，而 9 月战果月从 8/31 22:00 起——差 7 小时。
  // 钉在月初的话这一笔落在上一期的区间里，10 月的真报文按周期框根本框不到它。
  assert.equal(
    manualQuestSenkaTs('quarterly', jstUtc(2026, 9, 15, 12)),
    jstUtc(2026, 9, 1, 5),
    '周期起点更晚 → 取周期起点',
  )
  // 同一期的第二个月：周期起点早于月界，取月界
  assert.equal(
    manualQuestSenkaTs('quarterly', jstUtc(2026, 10, 15, 12)),
    senkaMonthStart(jstUtc(2026, 10, 15, 12)),
  )
  assert.equal(manualQuestSenkaTs('quarterly', jstUtc(2026, 10, 15, 12)), jstUtc(2026, 9, 30, 22))
  // 年任在自己的重置月里同款
  assert.equal(manualQuestSenkaTs('annual', jstUtc(2026, 6, 20, 12), 6), jstUtc(2026, 6, 1, 5))
  assert.equal(
    manualQuestSenkaTs('annual', jstUtc(2026, 9, 20, 12), 6),
    senkaMonthStart(jstUtc(2026, 9, 20, 12)),
  )
  // 周期定位不到（年任重置月未知）就退回月界：定位不到不猜
  assert.equal(
    manualQuestSenkaTs('annual', jstUtc(2026, 9, 20, 12), null),
    senkaMonthStart(jstUtc(2026, 9, 20, 12)),
  )
  assert.equal(
    manualQuestSenkaTs(null, jstUtc(2026, 9, 20, 12)),
    senkaMonthStart(jstUtc(2026, 9, 20, 12)),
  )
  // 落账时刻必须落在自己的去重窗口里，否则挡不住后来的真报文
  const at = jstUtc(2026, 9, 15, 12)
  const window = questSenkaBookingWindow('quarterly', at, null)
  const ts = manualQuestSenkaTs('quarterly', at)
  assert.ok(ts >= window.from && ts < window.to)
})

test('手动补记的判定：本期已有账就挡回来，没有才给记', () => {
  const at = jstUtc(2026, 9, 15, 12)
  const base = { senka: 330, kind: 'quarterly', annualMonth: null, at }
  const plan = planManualQuestSenkaBooking({ ...base, bookedTs: [] })
  assert.equal(plan.book, true)
  assert.equal(plan.reason, 'booked')
  assert.equal(plan.ts, jstUtc(2026, 9, 1, 5))
  // 同一季度里已有一笔真报文 → 玩家再手动补也不许多记
  assert.equal(
    planManualQuestSenkaBooking({ ...base, bookedTs: [jstUtc(2026, 9, 3, 21, 47)] }).reason,
    'already-booked',
  )
  // 上一季度那笔挡不住这一笔
  assert.equal(
    planManualQuestSenkaBooking({ ...base, bookedTs: [jstUtc(2026, 7, 3, 21)] }).book,
    true,
  )
  // 解不出固定战果的一律不记
  assert.equal(planManualQuestSenkaBooking({ ...base, senka: 0, bookedTs: [] }).reason, 'no-senka')
})

const questRowsFull = (db) =>
  db
    .prepare(
      `SELECT id, ts, note, senka, manual FROM senka_log WHERE kind = 'quest' ORDER BY ts, note`,
    )
    .all()
    .map((row) => ({
      id: Number(row.id),
      ts: row.ts,
      note: row.note,
      senka: Number(row.senka),
      manual: Number(row.manual) === 1,
    }))

test('手动补记落进账本：带 manual 标记，时刻是本期与本月的共同起点', (t) => {
  const { db, ledger } = openLedger(t)
  const at = jstUtc(2026, 9, 15, 12)
  assert.equal(ledger.addManualQuestSenka(at, 845, 330, SCN[845]), 'booked')
  assert.deepEqual(questRowsFull(db), [
    { id: 1, ts: jstUtc(2026, 9, 1, 5), note: '845', senka: 330, manual: true },
  ])
  // 同一期里再补一次不许多出一笔
  assert.equal(ledger.addManualQuestSenka(at, 845, 330, SCN[845]), 'already-booked')
  assert.equal(questRowsFull(db).length, 1)
})

test('双向去重①：9 月手动补了，10 月同任务的真报文不再入账（坑占到该周期结束）', (t) => {
  const { db, ledger } = openLedger(t)
  assert.equal(ledger.addManualQuestSenka(jstUtc(2026, 9, 15, 12), 845, 330, SCN[845]), 'booked')
  // 同一个季度（9–11 月）的下一个月来了真报文
  claim(db, jstUtc(2026, 10, 8, 20, 15), 845)
  assert.deepEqual(
    ledger.autoBookQuestSenkaFromEvents(jstUtc(2026, 10, 20, 12), resolve),
    [],
    '同周期只计一次，手动那一笔已经占了坑',
  )
  assert.deepEqual(questRowsFull(db), [
    { id: 1, ts: jstUtc(2026, 9, 1, 5), note: '845', senka: 330, manual: true },
  ])
  // 12 月是新的一季，那时的报文照记不误
  claim(db, jstUtc(2026, 12, 5, 20), 845)
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(jstUtc(2026, 12, 9, 12), resolve), [845])
  assert.equal(questRowsFull(db).length, 2)
})

test('双向去重②：已有报文证据的任务，手动补记被挡回来（跨月同样挡）', (t) => {
  const { db, ledger } = openLedger(t)
  const gotIt = jstUtc(2026, 9, 3, 21, 47)
  claim(db, gotIt, 845)
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(jstUtc(2026, 9, 15, 12), resolve), [845])
  assert.equal(
    ledger.addManualQuestSenka(jstUtc(2026, 9, 20, 12), 845, 330, SCN[845]),
    'already-booked',
  )
  assert.equal(
    ledger.addManualQuestSenka(jstUtc(2026, 10, 20, 12), 845, 330, SCN[845]),
    'already-booked',
    '同一季度的下个月也挡',
  )
  assert.deepEqual(questRowsFull(db), [{ id: 1, ts: gotIt, note: '845', senka: 330, manual: false }])
})

test('选单的置灰判据与入账共用一个窗口：说已记的，按下去必然被挡', (t) => {
  const { db, ledger } = openLedger(t)
  const at = jstUtc(2026, 10, 20, 12)
  claim(db, jstUtc(2026, 9, 3, 21, 47), 845)
  ledger.autoBookQuestSenkaFromEvents(jstUtc(2026, 9, 15, 12), resolve)
  ledger.addManualQuestSenka(jstUtc(2026, 9, 16, 12), 854, 350, SCN[854])
  const quests = [845, 854, 872].map((id) => ({ id, ...SCN[id] }))
  assert.deepEqual(ledger.questSenkaTaken(at, quests), { 845: 'evidence', 854: 'manual' })
  for (const id of [845, 854]) {
    assert.equal(ledger.addManualQuestSenka(at, id, SCN[id].senka, SCN[id]), 'already-booked')
  }
  assert.equal(ledger.addManualQuestSenka(at, 872, 400, SCN[872]), 'booked', '没标已记的补得进')
})

test('只有手动行可删：观测记下的那一笔删不掉', (t) => {
  const { db, ledger } = openLedger(t)
  claim(db, jstUtc(2026, 9, 3, 21, 47), 845)
  ledger.autoBookQuestSenkaFromEvents(jstUtc(2026, 9, 15, 12), resolve)
  ledger.addManualQuestSenka(jstUtc(2026, 9, 16, 12), 854, 350, SCN[854])
  const rows = questRowsFull(db)
  const evidence = rows.find((row) => !row.manual)
  const manual = rows.find((row) => row.manual)
  assert.equal(ledger.removeManualQuestSenka(evidence.id), false, '账不许涂改')
  assert.equal(questRowsFull(db).length, 2)
  assert.equal(ledger.removeManualQuestSenka(manual.id), true)
  assert.deepEqual(
    questRowsFull(db).map((row) => row.note),
    [`${evidence.note}`],
  )
  // 删过之后同一期可以再补一次（坑腾出来了）
  assert.equal(ledger.addManualQuestSenka(jstUtc(2026, 9, 20, 12), 854, 350, SCN[854]), 'booked')
  // 行不在了照实返回 false，不假装删成功
  assert.equal(ledger.removeManualQuestSenka(9999), false)
  assert.equal(ledger.removeManualQuestSenka(0), false)
})

test('删掉手动行之后，被它挡下的真报文补得回来（扫描游标要跟着作废）', (t) => {
  const { db, ledger } = openLedger(t)
  const when = jstUtc(2026, 9, 20, 12)
  assert.equal(ledger.addManualQuestSenka(jstUtc(2026, 9, 15, 12), 845, 330, SCN[845]), 'booked')
  // 同一期里真报文到了：被手动那一笔挡下不入账，但游标照样走过了它
  const gotIt = jstUtc(2026, 9, 18, 20, 15)
  claim(db, gotIt, 845)
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(when, resolve), [])
  // 玩家发现补错了，把手动那一笔删掉——真报文这时必须能补回来
  const manual = questRowsFull(db).find((row) => row.manual)
  assert.equal(ledger.removeManualQuestSenka(manual.id), true)
  assert.deepEqual(ledger.autoBookQuestSenkaFromEvents(when, resolve), [845])
  assert.deepEqual(questRowsFull(db), [
    { id: 2, ts: gotIt, note: '845', senka: 330, manual: false },
  ])
})

test('「重算任务战果」与 v11 迁移都不碰手动行', (t) => {
  const { db, ledger } = openLedger(t)
  const monthStart = senkaMonthStart(Date.now())
  // 手动行与老口径的合成行指纹会撞（同为月初整值），只有 manual 分得开
  db.prepare(
    `INSERT INTO senka_log (ts, kind, exp_delta, senka, note) VALUES (?, 'quest', 0, 350, '854')`,
  ).run(monthStart)
  db.prepare(
    `INSERT INTO senka_log (ts, kind, exp_delta, senka, note, manual)
     VALUES (?, 'quest', 0, 400, '872', 1)`,
  ).run(monthStart)
  assert.equal(ledger.clearAutoBookedQuestSenka(monthStart), 1, '只撤合成行那一笔')
  assert.deepEqual(
    questRowsFull(db).map((row) => ({ note: row.note, manual: row.manual })),
    [{ note: '872', manual: true }],
  )
  ledger.runV11()
  assert.deepEqual(
    questRowsFull(db).map((row) => row.note),
    ['872'],
    '迁移的那一刀也绕开手动行',
  )
})

test('继承的「前月特别」含手动补记行：玩家认下的账与观测行同等参与', (t) => {
  const { ledger } = openLedger(t)
  // 9 月手动补一笔（落账时刻 = 9/1 05:00），10 月查账时它要进「上月特别」
  assert.equal(ledger.addManualQuestSenka(jstUtc(2026, 9, 15, 12), 845, 330, SCN[845]), 'booked')
  const october = ledger.querySenka(jstUtc(2026, 10, 15, 12))
  assert.equal(october.carry.fromSpecial, 330 / 35)
  assert.equal(october.special, 0, '上个月那一笔不算进本月')
  // 本月的手动行照样算本月特别，且带着 manual 标记与行号发给渲染层
  assert.equal(ledger.addManualQuestSenka(jstUtc(2026, 10, 15, 12), 854, 350, SCN[854]), 'booked')
  const again = ledger.querySenka(jstUtc(2026, 10, 15, 12))
  assert.equal(again.special, 350)
  assert.equal(again.carry.fromSpecial, 330 / 35, '继承不受本月新增影响')
  const manualRows = again.entries.filter((entry) => entry.manual)
  assert.deepEqual(
    manualRows.map((entry) => entry.note),
    ['854'],
  )
  assert.ok(manualRows[0].id > 0, '删除要按行号定位，id 必须发出去')
})
