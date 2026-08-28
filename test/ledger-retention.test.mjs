// 主账本的「记录保留与清理」护栏。
//
// ---- 这一改是口径反转，出处在这里 ----
// 2026-08-23 用户拍板：「我说的可不止配音，包括所有本来设定了日期自动清理的部分」。
// 语音「官方没有」台账那条裁定（见 voice-probe.test.mjs 的「90 天自动过期退役」）
// 同日推广到主账本：`RETENTION_DAYS = 90`（events / material_log / material_delta /
// battle_snapshots 每天定时 DELETE）与 `NOTIFY_RETENTION_DAYS = 14`（通知历史）
// 一并退役，**不设保留期就一行都不删**，清理权归玩家。
//
// 这里盯的每一条都是「写反了不报错、只是某天默默把玩家的记录删了」那一类：
//  · 保留期缺省兜底成 90 天 → 口径悄悄倒回去，界面上一模一样；
//  · 清理计划里混进一张永久表 → 遭遇志/精矿被删，要过很久才看得出来；
//  · 按月清理的区间算错一小时（夏令时）→ 月末最后一小时漏清或多清。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import retention from '../dist/shared/ledger-retention.js'
import calendar from '../dist/shared/local-calendar.js'

const {
  LEDGER_NOTIFY_TABLE,
  LEDGER_PERMANENT_TABLES,
  LEDGER_RETENTION_DAYS_MAX,
  LEDGER_ROLLING_TABLES,
  clampLedgerRetentionDays,
  foldLedgerMonthCounts,
  ledgerMonthOf,
  ledgerMonthsCovered,
  planLedgerMonthClear,
  planLedgerPrune,
} = retention
const { LOCAL_MONTHS_MAX, localDayOf, localMonthOf, localMonthRange, localMonthsBetween } = calendar

const ledgerSrc = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
const yuSrc = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')

const localAt = (year, month, day, hour = 12) =>
  new Date(year, month - 1, day, hour, 0, 0, 0).getTime()

// ---- ① 不设保留期 = 一行都不删 ----

test('没设保留期：清理计划是空的，一行都不删', () => {
  const now = localAt(2026, 8, 24)
  for (const raw of [undefined, null, 0, '', '0', -5, Number.NaN, 'abc', {}]) {
    assert.deepEqual(
      planLedgerPrune({ retentionDays: raw, now }),
      [],
      `保留期 ${JSON.stringify(raw)} 被当成了「该删」——口径悄悄倒回 90 天了`,
    )
  }
})

test('保留天数落值：0 = 不限，负数/乱填也回 0，上限封顶', () => {
  assert.equal(clampLedgerRetentionDays(0), 0)
  assert.equal(clampLedgerRetentionDays(''), 0)
  assert.equal(clampLedgerRetentionDays('  '), 0)
  assert.equal(clampLedgerRetentionDays(-1), 0)
  assert.equal(clampLedgerRetentionDays('乱填'), 0)
  assert.equal(clampLedgerRetentionDays(1), 1)
  assert.equal(clampLedgerRetentionDays('90'), 90)
  assert.equal(clampLedgerRetentionDays(30.9), 30, '小数没取整')
  assert.equal(clampLedgerRetentionDays(1e18), LEDGER_RETENTION_DAYS_MAX)
  assert.equal(clampLedgerRetentionDays(Number.POSITIVE_INFINITY), 0)
})

test('那两个写死的常量真的没了——留着就会有人照旧引用', () => {
  assert.equal(
    /const\s+(NOTIFY_)?RETENTION_DAYS\s*=/.test(ledgerSrc),
    false,
    '写死的保留期还在账本里：口径反转只做了一半',
  )
  // 「只留最近 500 场」那条条数上限同样退役：它也是系统替玩家决定哪些该忘，
  // 只是判据从日期换成了条数，而玩家看不到那一场是什么时候没的
  assert.equal(
    /LIMIT 500\)/.test(ledgerSrc),
    false,
    '战斗快照还在按条数自动淘汰——每存一场就挤掉第 501 场',
  )
  // 演进注释必须留痕：这个仓库的家法是口径反转要留得下出处
  assert.match(ledgerSrc, /2026-08-23/)
  const planSrc = fs.readFileSync(
    new URL('../src/shared/ledger-retention.ts', import.meta.url),
    'utf8',
  )
  assert.match(planSrc, /2026-08-23/)
  assert.match(planSrc, /清理权归玩家/)
})

// ---- ② 设了保留期：按天删，且只删该删的那几张表 ----

test('设了保留期：按天算截止时刻，四张滚动表 + 通知历史一起清', () => {
  const now = localAt(2026, 8, 24)
  const plan = planLedgerPrune({ retentionDays: 30, now })
  assert.equal(plan.length, LEDGER_ROLLING_TABLES.length + 1)
  const cutoff = now - 30 * 86_400_000
  for (const step of plan) {
    assert.equal(step.from, 0, '起点不是 0——中间那段会被漏掉')
    assert.equal(step.to, cutoff)
  }
  assert.deepEqual(
    plan.map((step) => step.table),
    [...LEDGER_ROLLING_TABLES, LEDGER_NOTIFY_TABLE],
  )
  // 通知历史跟随同一个设置（原先它是单独的 14 天，那条也退役了）
  assert.equal(
    plan.some((step) => step.table === LEDGER_NOTIFY_TABLE && step.to === cutoff),
    true,
  )
})

test('now 读不出来时不删——别拿一个 NaN 截止时刻去 DELETE', () => {
  for (const now of [0, -1, Number.NaN, undefined, null]) {
    assert.deepEqual(planLedgerPrune({ retentionDays: 30, now }), [])
  }
  // 保留期比「现在」还长（刚开始记账那几天设了 3650 天）：cutoff 落到 1970 以前，
  // 什么都不该删，也不该拿一个负数去查
  assert.deepEqual(planLedgerPrune({ retentionDays: 3650, now: 86_400_000 }), [])
})

// ---- ③ 永久表：任何清理路径都不许碰 ----

test('永久表一张都不在清理计划里（自动清理与按月清理都验）', () => {
  const permanent = new Set(LEDGER_PERMANENT_TABLES)
  assert.ok(permanent.size >= 10, '永久表名单缩水了，这条护栏在空转')
  // 两张名单不许有交集——同一张表既在滚动又在永久，判据本身就自相矛盾
  for (const table of LEDGER_ROLLING_TABLES) {
    assert.equal(permanent.has(table), false, `${table} 同时出现在滚动表和永久表名单里`)
  }
  assert.equal(permanent.has(LEDGER_NOTIFY_TABLE), false)
  const plans = [
    planLedgerPrune({ retentionDays: 1, now: localAt(2026, 8, 24) }),
    planLedgerPrune({ retentionDays: LEDGER_RETENTION_DAYS_MAX, now: localAt(2026, 8, 24) }),
    planLedgerMonthClear('2026-08'),
    planLedgerMonthClear('1970-01'),
  ]
  for (const plan of plans) {
    for (const step of plan) {
      assert.equal(permanent.has(step.table), false, `清理计划里出现了永久表 ${step.table}`)
    }
  }
})

test('两条清理路径都只按计划执行，没有绕开计划自己拼一条 DELETE', () => {
  // 判据在 shared 已按数据验过；这里补的是执行侧。
  // ⚠️ 只看这两个方法的方法体：账本里别处也有 DELETE（撤销手动补记的一笔氪金、
  // 删一条任务进度、一次性迁移修数据），那些是**针对某一行的定点操作**，
  // 与「按时间批量清」不是一回事，不归这条护栏管。
  for (const marker of ['private prune = () => {', 'clearLedgerMonth = (month: string): number => {']) {
    const at = ledgerSrc.indexOf(marker)
    assert.ok(at > 0, `找不到 ${marker}`)
    const body = ledgerSrc.slice(at, ledgerSrc.indexOf('\n  }\n', at))
    const deletes = [...body.matchAll(/DELETE FROM (\S+)/g)].map((m) => m[1])
    assert.ok(deletes.length > 0, `${marker} 里一条 DELETE 都没有？`)
    for (const table of deletes) {
      assert.equal(table, '${step.table}', `清理路径里写死了表名：${table}`)
    }
  }
  assert.match(ledgerSrc, /DELETE FROM \$\{step\.table\} WHERE ts >= \? AND ts < \?/)
  assert.match(ledgerSrc, /const plan = planLedgerPrune\(\{/)
  assert.match(ledgerSrc, /if \(!plan\.length\) return/)
  // 按月清理那条同样先问计划，形状不对就一行都不删
  assert.match(ledgerSrc, /const plan = planLedgerMonthClear\(month\)/)
  assert.match(ledgerSrc, /if \(!plan\.length\) return 0/)
})

// ---- ④ 按月清理：只落在目标月 ----

test('按月清理：区间是那一月的本地 [月初, 下月初)，四张滚动表各一条', () => {
  const plan = planLedgerMonthClear('2026-08')
  assert.deepEqual(
    plan.map((step) => step.table),
    [...LEDGER_ROLLING_TABLES],
  )
  const { from, to } = plan[0]
  assert.equal(from, new Date(2026, 7, 1).getTime())
  assert.equal(to, new Date(2026, 8, 1).getTime())
  // 月内的落在区间里，月末最后一毫秒也算在内；下月第一毫秒不算
  assert.ok(localAt(2026, 8, 1, 0) >= from)
  assert.ok(to - 1 >= from && localMonthOf(to - 1) === '2026-08')
  assert.equal(localMonthOf(to), '2026-09')
  // 上一月的一个字节都不碰
  assert.ok(localAt(2026, 7, 31, 23) < from)
})

test('月份形状不对：一行都不删（宁可什么都没发生，也不要清掉别的月）', () => {
  for (const bad of ['', '2026', '2026-8', '2026-13', '2026-00', 'all', null, undefined, '乱填']) {
    assert.deepEqual(planLedgerMonthClear(bad), [], `月份 ${JSON.stringify(bad)} 被当成了合法月份`)
  }
})

test('跨年边界：12 月的区间接到下一年 1 月，不折回同年', () => {
  const plan = planLedgerMonthClear('2025-12')
  assert.equal(plan[0].from, new Date(2025, 11, 1).getTime())
  assert.equal(plan[0].to, new Date(2026, 0, 1).getTime())
  assert.equal(localMonthOf(plan[0].to), '2026-01')
})

test('二月与闰年按真实天数走，不是写死 30 天', () => {
  const leap = planLedgerMonthClear('2024-02')
  assert.equal((leap[0].to - leap[0].from) / 86_400_000, 29)
  const common = planLedgerMonthClear('2026-02')
  assert.equal((common[0].to - common[0].from) / 86_400_000, 28)
})

// ---- ⑤ 按月分组的收尾 ----

test('逐月行数：合并同月、丢掉 0 行的月、新月在前', () => {
  assert.deepEqual(
    foldLedgerMonthCounts([
      { month: '2026-07', count: 5 },
      { month: '2026-08', count: 3 },
      { month: '2026-08', count: 4 },
      { month: '2026-06', count: 0 },
      { month: '乱填', count: 9 },
      { month: '2026-05', count: -3 },
    ]),
    [
      { month: '2026-08', count: 7 },
      { month: '2026-07', count: 5 },
    ],
  )
  assert.deepEqual(foldLedgerMonthCounts([]), [])
  assert.deepEqual(foldLedgerMonthCounts(null), [])
})

test('月份枚举：从最早到最晚、新月在前，两端读不出就空', () => {
  assert.deepEqual(ledgerMonthsCovered(localAt(2026, 6, 20), localAt(2026, 8, 3)), [
    '2026-08',
    '2026-07',
    '2026-06',
  ])
  // 同一个月里的一整段只出一个月份
  assert.deepEqual(ledgerMonthsCovered(localAt(2026, 8, 1), localAt(2026, 8, 31)), ['2026-08'])
  assert.deepEqual(ledgerMonthsCovered(0, localAt(2026, 8, 3)), [])
  assert.deepEqual(ledgerMonthsCovered(localAt(2026, 8, 3), localAt(2026, 6, 20)), [], '次序反了就不猜')
  // 上界：时间戳坏成 1 时不许铺出几万行
  assert.ok(localMonthsBetween(1, localAt(2026, 8, 3)).length <= LOCAL_MONTHS_MAX)
})

test('本地日历那一份两处共用：账本与语音台账的年月换算不许分叉', () => {
  const at = localAt(2026, 8, 24)
  assert.equal(ledgerMonthOf(at), localMonthOf(at))
  assert.equal(localDayOf(at), '2026-08-24')
  assert.equal(localMonthOf(at), '2026-08')
  assert.equal(localDayOf(0), '')
  assert.equal(localMonthRange('2026-08').from, new Date(2026, 7, 1).getTime())
  assert.equal(localMonthRange('2026-8'), null)
  // 语音台账那一侧读的是同一份（分叉的话，同一天点两个清理钮会落在两个不同的月上）
  const voiceSrc = fs.readFileSync(
    new URL('../src/shared/voice-probe-plan.ts', import.meta.url),
    'utf8',
  )
  assert.match(voiceSrc, /from '\.\/local-calendar'/)
})

// ---- ⑥ 钥里那个区 ----

test('钥里「记录保留与清理」：两块记录同一张卡，判据只消费不自备', () => {
  assert.match(yuSrc, /记录保留与清理/)
  // 账本与语音台账在同一张卡里（分成两张就是两个孤岛）
  const cardAt = yuSrc.indexOf('const retentionCardHtml = ()')
  assert.ok(cardAt > 0, '找不到那张卡')
  const card = yuSrc.slice(cardAt, yuSrc.indexOf('\n}\n', cardAt))
  assert.match(card, /事件・资源・战斗记录/)
  assert.match(card, /语音「官方没有」记录/)
  assert.match(card, /data-ledger-clear/)
  assert.match(card, /data-absent-clear/)
  // 「永久保留 / 保留 N 天」是状态，摆在抬头一眼看得见的位置
  assert.match(card, /永久保留/)
  // 天数落值用 shared 那一份，钥里不自备一套
  assert.match(yuSrc, /clampLedgerRetentionDays\(retentionInput\.value\)/)
  assert.equal(/retentionDays.*Number\.parseInt/.test(yuSrc), false, '钥里另算了一遍保留天数')
  // 永久表那一句要如实说出来：不然玩家会以为按下去连遭遇志一起没了
  assert.match(yuSrc, /遭遇志、舰娘人生、道具履历、装备实测与活动履历/)
})

test('账本清理只走既有 IPC，且月份在主进程再判一次形状', () => {
  const mgSrc = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  assert.match(mgSrc, /ipcMain\.handle\('mg:ledger-retention'/)
  assert.match(mgSrc, /ipcMain\.handle\('mg:ledger-clear-month'/)
  assert.match(mgSrc, /if \(!\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(month\)\) return 0/)
  assert.match(yuSrc, /ipcRenderer\.invoke\('mg:ledger-clear-month', \{ month \}\)/)
})

test('旧格式快照的升级器链写明了「永远删不掉」——保留期没了，旧快照不再自己消失', () => {
  assert.match(ledgerSrc, /升级器链\*\*永远删不掉\*\*|永远删不掉/)
  assert.match(ledgerSrc, /upgradeBattleView\(sortie\.battle\)/)
})
