// 资源曲线的**逐日下沉**：史的「每日资源」原先把整段 material_log 搬回渲染层
// 再按自然日聚合。账本不再自动清理（数据能攒好几年）之后这条路开始咬人——
// 实测一年 ≈ 21 万行 / 全量查询 ≈ 177ms，而 DatabaseSync 是同步调用、跑在
// ipcMain.handle 里，这 177ms 就是**主进程被堵住**的 177ms。
// 现在「每日取当日最后一条」下沉到 SQL（ledger.queryDailyMaterials，≈30ms / 366 行）。
//
// ---- 这份护栏盯的是什么 ----
// 下沉唯一的正确性依据是「聚合行喂进渲染层管线 === 全量行喂进渲染层管线」。
// 逐日聚合写错了**不会报错**，只会让某几天的净变化悄悄少算一截，界面上看不出区别，
// 所以这里逐字段比对，例子专挑分组容易错的地方造：
//   · 日界前后一分钟各一条（23:59 与次日 00:01）；
//   · 一日多条（要取当天最后一条，不是第一条）；
//   · 整天一条都没有（曲线要平着走，不是断开）；
//   · **区间起点当天 00:00:00.000 那一条**（日初基线；写成 `ts < ?` 就会漏掉它）；
//   · **比 now 还新的行**（渲染层先取 now 再发 IPC，这中间进的变动就是这样；
//     不把它挡在聚合外面，它会顶替「今天最后一条」，而它本身又落在最后一格之外——
//     今天那一格于是塌成 0。这一条是造例子的时候撞出来的，不是设想出来的）。
//
// 还有一条同样是「写反了照样绿」的：CAST 掉了之后聚合会退化成全量行，
// 而全量行喂进管线**结果照样对**——只有行数会暴涨。所以行数上界是硬断言。
//
// 「全量行」这一侧的口径写死为**截到 now 为止的全部行**：管线本来就只看得到这些
// （每一格的 end 都 ≤ now，日初基线也只往前找），比它新的行两条路都该视而不见。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

import calendar from '../dist/shared/local-calendar.js'
import materialHistory from '../dist/shared/material-history.js'

const { localDayStart } = calendar
const { buildDailyMaterials } = materialHistory

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')

// ledger.ts 载不进 node --test（它经 ../env 拉 electron 的 app），所以照
// fit-observation-ledger 的老办法：把真 DDL 与真 SQL 原样取出来在临时库上跑。
// 测的是发货的那段 SQL 的行为，不是「源码里有某段文本」。
const sliceBetween = (from, to, what) => {
  const at = source.indexOf(from)
  assert.ok(at >= 0, `ledger.ts 里找不到${what}了（锚点：${from}）`)
  const end = source.indexOf(to, at + from.length)
  assert.ok(end > at, `${what}没有正常收尾`)
  return source.slice(at, end + to.length)
}

const materialDdl = () =>
  sliceBetween(
    'CREATE TABLE IF NOT EXISTS material_log (',
    'CREATE INDEX IF NOT EXISTS idx_material_ts ON material_log(ts);',
    'material_log 建表语句',
  )

const dailySql = () => {
  const anchor = 'private static readonly DAILY_MATERIALS_SQL = `'
  const at = source.indexOf(anchor)
  assert.ok(at >= 0, 'ledger.ts 里没有 DAILY_MATERIALS_SQL 了')
  const end = source.indexOf('`', at + anchor.length)
  assert.ok(end > at, 'DAILY_MATERIALS_SQL 没有正常收尾')
  return source.slice(at + anchor.length, end)
}

const COLUMNS = ['fuel', 'ammo', 'steel', 'bauxite', 'fastbuild', 'bucket', 'devmat', 'screw']
const rowOf = (r) => ({ ts: r.ts, values: COLUMNS.map((name) => r[name]) })
const offsetMs = (at) => -new Date(at).getTimezoneOffset() * 60000

const openDb = (t) => {
  const { DatabaseSync } = require('node:sqlite')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-material-daily-'))
  const db = new DatabaseSync(path.join(dir, 'test.sqlite'))
  db.exec(materialDdl())
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return db
}

// ---- 造例：约 400 天，专挑分组容易错的形状 ----

const DAYS = 400
const today = localDayStart(Date.now())
/** 「现在」：今天 15:37。今天这一格截在这儿，之后还会再往后塞几条比它新的行。 */
const NOW = today + 15 * 3600_000 + 37 * 60_000
/** 第 i 天（0 = 最早那天）的本地 00:00 */
const dayAt = (i) => {
  const date = new Date(today)
  date.setDate(date.getDate() - (DAYS - 1 - i))
  return date.getTime()
}
/** 那几个区间档的起点当天，落在第几号 */
const startDayIndex = (days) => DAYS - days

const buildFixture = () => {
  const rows = []
  let tick = 0
  const push = (ts) => {
    tick += 1
    // 八项各走各的步长，某一项串到别项上会当场看出来
    rows.push({ ts, values: COLUMNS.map((_name, index) => tick * (index + 1) + index * 17) })
  }
  // 各档区间的起点当天必须有「00:00:00.000 一条 + 当天更晚一条」：
  // 日初基线写成 `ts < ?` 会把那条 00:00 整个漏掉（它不是当天最后一条，
  // 聚合那一支也不收），base 于是退到前一天，那一天的净变化少算一截。
  const startDays = new Set([7, 30, 90, 180, 365].map(startDayIndex))
  for (let i = 0; i < DAYS; i += 1) {
    const day = dayAt(i)
    if (i % 7 === 3 && !startDays.has(i)) continue // 整天没有记录
    if (i % 11 === 5 && !startDays.has(i)) {
      push(day) // 全天只有 00:00:00.000 这一条
      continue
    }
    // 00:00:00.000 整那一条：不是每天都有；最早那天故意不给，
    // 好让「全部」档的第一天真的缺日初基线（真账本的第一条也不会正好落在午夜）
    if (i !== 0 && (startDays.has(i) || i % 3 === 0)) push(day)
    push(day + 60_000) // 日界后一分钟
    // 白天一小时一条：真账本一天几十上百条，行数太少压不出「全量 vs 逐日」的差别
    for (let hour = 1; hour <= 14; hour += 1) push(day + hour * 3600_000)
    if (i === DAYS - 1) continue // 今天先停在 14:00，比 now 新的那几条单独塞
    push(day + 24 * 3600_000 - 60_000) // 日界前一分钟
  }
  // 比 now 还新的行：渲染层先取 now、再发 IPC，这中间进的资源变动就长这样。
  // 聚合不把它挡掉就会顶替「今天最后一条」，而它自己又画不进最后一格。
  push(NOW + 5_000)
  push(NOW + 90_000)
  return rows
}

const seed = (db, rows) => {
  const insert = db.prepare(
    `INSERT INTO material_log (ts, fuel, ammo, steel, bauxite, fastbuild, bucket, devmat, screw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  db.exec('BEGIN')
  for (const row of rows) insert.run(row.ts, ...row.values)
  db.exec('COMMIT')
}

/** 旧路：截到 now 为止的全部行（管线看得到的就是这些） */
const allRows = (db, untilTs) =>
  db.prepare('SELECT * FROM material_log WHERE ts <= ? ORDER BY ts ASC').all(untilTs).map(rowOf)

const dailyRows = (db, sinceTs, untilTs, sql = dailySql()) =>
  db.prepare(sql).all(sinceTs, sinceTs, untilTs, offsetMs(Date.now())).map(rowOf)

// ---- ① 前提：本机时区在这段区间里不能换偏移 ----

test('日号换算的前提：整段区间里时区偏移恒定（中国/日本无夏令时）', () => {
  assert.equal(
    offsetMs(dayAt(0)),
    offsetMs(today),
    '这台机器的时区在这 400 天里发生了夏令时切换。' +
      '逐日聚合的日号是 `(ts + 固定偏移) / 86400000` 算的（见 shared/local-calendar 的' +
      ' localDayOffsetMs），偏移一变就与渲染层的 localDayStart 不再是同一把尺——' +
      '这个护栏在这样的时区里本来就该红，不是测试写错了。',
  )
})

// ---- ② 等价性：聚合行 === 全量行，逐字段 ----

for (const days of [7, 30, 90, 180, 365]) {
  for (const [what, current] of [
    ['当前持有比最后一条快照新', COLUMNS.map((_name, index) => 900_000 + index)],
    ['没有当前持有', null],
  ]) {
    test(`${days} 日 · ${what}：SQL 逐日聚合喂进渲染层管线，与全量行逐字段一致`, (t) => {
      const db = openDb(t)
      seed(db, buildFixture())
      const start = dayAt(startDayIndex(days))

      const expected = buildDailyMaterials(allRows(db, NOW), start, NOW, current)
      const actual = buildDailyMaterials(dailyRows(db, start, NOW), start, NOW, current)

      assert.equal(expected.length, days, '逐日格数不对，例子本身造歪了')
      assert.deepEqual(actual, expected)
      assert.ok(
        expected.every((day) => day.complete),
        '这批例子里每一天都该有日初基线（起点前一天有记录）',
      )
      assert.ok(
        expected.filter((day) => day.values.some((value) => value !== 0)).length > days / 2,
        '大半天数都是 0 的话这个比对没有意义',
      )
    })
  }
}

test('全部：起点落在账本最早一条那天，与全量行一致', (t) => {
  const db = openDb(t)
  const fixture = buildFixture()
  seed(db, fixture)
  const earliest = db.prepare('SELECT MIN(ts) t FROM material_log WHERE ts <= ?').get(NOW).t
  assert.equal(earliest, fixture[0].ts)
  // queryDailyMaterials 在 sinceTs <= 0 时就是这么定起点的（见 ledger 那三行）
  const start = localDayStart(earliest)

  const expected = buildDailyMaterials(allRows(db, NOW), start, NOW, null)
  const actual = buildDailyMaterials(dailyRows(db, start, NOW), start, NOW, null)
  assert.equal(expected.length, DAYS)
  assert.deepEqual(actual, expected)
  // 最早那一天没有日初基线：只能标「—」，不能画成 0
  assert.equal(expected[0].complete, false)
  assert.equal(expected.at(-1).complete, true)
})

test('「全部」的起点必须先落到那一天的 00:00，直接拿 0 去查会漏掉日初基线', (t) => {
  const db = openDb(t)
  // 专造一个「最早那条正好落在午夜」的账本：它不是当天最后一条，
  // 聚合那一支不收；收它的是日初基线那一支，而基线查的是「起点当刻及之前」。
  // 起点传 0 等于那一支什么也没查到，第一天于是变成「缺基线」。
  const day0 = dayAt(DAYS - 3)
  seed(db, [
    { ts: day0, values: COLUMNS.map((_n, i) => 100 + i) },
    { ts: day0 + 12 * 3600_000, values: COLUMNS.map((_n, i) => 200 + i) },
    { ts: day0 + 86_400_000 + 12 * 3600_000, values: COLUMNS.map((_n, i) => 300 + i) },
  ])
  const naive = buildDailyMaterials(dailyRows(db, 0, NOW), day0, NOW, null)
  const proper = buildDailyMaterials(dailyRows(db, day0, NOW), day0, NOW, null)
  assert.equal(proper[0].complete, true)
  assert.deepEqual(proper[0].values, COLUMNS.map(() => 100))
  assert.equal(naive[0].complete, false, '起点传 0 竟然也拿到了基线——那这道推导就白写了')
})

test('账本一条都没有：聚合空手而归，最早时刻是 null，不编日期', (t) => {
  const db = openDb(t)
  assert.deepEqual(dailyRows(db, 0, NOW), [])
  assert.equal(db.prepare('SELECT MIN(ts) t FROM material_log WHERE ts <= ?').get(NOW).t, null)
})

test('比 now 还新的行不许顶替「今天最后一条」', (t) => {
  const db = openDb(t)
  seed(db, buildFixture())
  const start = dayAt(startDayIndex(7))
  const rows = dailyRows(db, start, NOW)
  assert.ok(
    rows.every((row) => row.ts <= NOW),
    '聚合把比 now 新的行也收进来了：它会顶掉今天真正的最后一条，' +
      '而它自己落在最后一格之外——今天那一格塌成 0，界面上看不出是错的',
  )
  // 闸门形同虚设时会怎样（untilTs 放到无穷远）：今天这一格当场塌成 0。
  // 这一条不是为了测 SQLite，是把「这道闸门在挡什么」钉在纸面上。
  const leaked = dailyRows(db, start, Number.MAX_SAFE_INTEGER)
  const todayCell = buildDailyMaterials(leaked, start, NOW, null).at(-1)
  assert.deepEqual(
    todayCell.values,
    COLUMNS.map(() => 0),
    '闸门放开之后今天这一格居然还是对的——例子里没造出「比 now 新」的行，先修例子',
  )
})

// ---- ③ 行数上界：下沉之所以成立的全部理由 ----

test('一年的窗口只回 366 行上下——聚合退化成全量行时结果照样对，只有行数会露馅', (t) => {
  const db = openDb(t)
  seed(db, buildFixture())
  const start = dayAt(startDayIndex(365))
  const total = db.prepare('SELECT COUNT(*) c FROM material_log').get().c
  const rows = dailyRows(db, start, NOW)
  assert.ok(total > 1000, `例子只有 ${total} 行，压不出「全量 vs 逐日」的差别`)
  // 365 天 + 日初基线那一条（基线正好是起点当天 00:00 那条时会与聚合行重合）
  assert.ok(
    rows.length <= 366,
    `逐日聚合回了 ${rows.length} 行（账本共 ${total} 行）——分组没生效，整段又被搬回渲染层了`,
  )
  assert.ok(rows.length >= 300, `只回了 ${rows.length} 行，聚合把日子吃掉了`)
})

test('CAST(? AS INTEGER) 是承重的：去掉它，node:sqlite 把参数绑成 REAL，分组当场失效', (t) => {
  const db = openDb(t)
  seed(db, buildFixture())
  const start = dayAt(startDayIndex(365))
  const shipped = dailySql()
  assert.ok(
    shipped.includes('CAST(? AS INTEGER)'),
    'DAILY_MATERIALS_SQL 里没有 CAST 了——下面那条对照就失去意义，先看 ledger 里那段注释',
  )
  const withoutCast = shipped.replace('CAST(? AS INTEGER)', '?')
  const broken = dailyRows(db, start, NOW, withoutCast)
  // 整除变成浮点除，GROUP BY 每行自成一组：一整年原样回来。
  // 这一条不是为了测 SQLite，是把「删掉 CAST 会怎样」钉在纸面上——
  // 它不报错，也不影响画出来的曲线，只是把主进程重新堵回去。
  assert.ok(
    broken.length > 1000,
    `去掉 CAST 之后只回了 ${broken.length} 行：这个坑可能已经不存在了，` +
      '确认之后再决定 ledger 里那段注释与 CAST 要不要留',
  )
  assert.deepEqual(
    buildDailyMaterials(broken, start, NOW, null),
    buildDailyMaterials(allRows(db, NOW), start, NOW, null),
    '正是因为坏掉的聚合画出来照样对，行数才必须自己有断言',
  )
})

// ---- ④ 消费端边界：要原始行的那几个不能被顺手改掉 ----

test('要原始行的消费端仍走全量通道（锱、资源趋势窗）', () => {
  const zi = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const trend = fs.readFileSync(
    new URL('../src/renderer/resource-trend-window.ts', import.meta.url),
    'utf8',
  )
  const shi = fs.readFileSync(new URL('../src/renderer/modules/shi.ts', import.meta.url), 'utf8')
  assert.ok(
    zi.includes('queryMaterialHistory('),
    '锱改成逐日聚合了：它要的是原始行（磁贴的近 24h、储备 ETA 都按分钟级读数算）',
  )
  assert.ok(trend.includes('queryMaterialHistory('), '资源趋势窗要的是原始行，不能吃逐日聚合')
  assert.ok(
    !shi.includes('queryMaterialHistory('),
    '史又拉了一遍全量行：逐日只该有一条代码路，新旧并存迟早分叉',
  )
  assert.ok(
    shi.includes('queryDailyMaterialHistory('),
    '史没走逐日通道',
  )
})
