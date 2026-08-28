// 实测观察的**落盘**：账本表 fit_observations 的两条硬口径。
//
//   ① 升星是**新增一条**，不覆盖旧星级那一条 —— ★在主键里；
//   ② 同一 (装备,形态,★,件数) 再观察到时更新读数与 last_seen，**first_seen 保持不动**。
//
// ledger.ts 载不进 node --test（它经 ../env 拉 electron 的 app），所以这里把它里面
// 那两段 SQL **原样取出来在临时库上跑**——测的是真 DDL / 真 upsert 子句的行为，
// 不是断言源码里有某段文本。写反了（比如把 stars 挪出主键、或让 first_seen 也被更新）
// 会当场红。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

import { fitObservationRecordsOf } from '../src/shared/fit-observation.ts'

const require = createRequire(import.meta.url)
const source = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')

/** 从 ledger.ts 里取出建表语句（到匹配的 `);` 为止）。 */
const createTableSql = () => {
  const at = source.indexOf('CREATE TABLE IF NOT EXISTS fit_observations (')
  assert.ok(at >= 0, 'ledger.ts 里没有 fit_observations 建表语句了')
  const end = source.indexOf('\n      );', at)
  assert.ok(end > at, 'fit_observations 建表语句没有正常收尾')
  return source.slice(at, end + '\n      );'.length)
}

/** 取出 upsert 语句（模板字面量整段）。 */
const upsertSql = () => {
  const at = source.indexOf('`INSERT INTO fit_observations')
  assert.ok(at >= 0, 'ledger.ts 里没有 fit_observations 的写入语句了')
  const end = source.indexOf('`', at + 1)
  assert.ok(end > at, '写入语句没有正常收尾')
  return source.slice(at + 1, end)
}

const openDb = (t) => {
  const { DatabaseSync } = require('node:sqlite')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-fit-obs-'))
  const db = new DatabaseSync(path.join(dir, 'test.sqlite'))
  db.exec(createTableSql())
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return db
}

// 绑定顺序与 ledger.recordFitObservations 一致
const put = (db, sql, { equip = 342, form = 599, stars = [0], stats = {}, sole = 1, ts }) =>
  db
    .prepare(sql)
    .run(
      equip,
      form,
      stars.join('.'),
      stars.length,
      JSON.stringify(stats),
      sole,
      ts,
      ts,
    )

test('升星是新增一条，旧星级那一条原样留着', (t) => {
  const db = openDb(t)
  const sql = upsertSql()
  put(db, sql, { stars: [2], stats: { fire: 3 }, ts: 1_000 })
  put(db, sql, { stars: [6], stats: { fire: 4 }, ts: 2_000 })
  const rows = db
    .prepare('SELECT stars, stats FROM fit_observations ORDER BY stars')
    .all()
  assert.deepEqual(
    rows.map((row) => [row.stars, JSON.parse(row.stats).fire]),
    [
      ['2', 3],
      ['6', 4],
    ],
    '★2 那次的读数被★6 覆盖了——那等于把已经做过的实验删掉',
  )
})

test('件数也在键里：同★装两件是另一条观察', (t) => {
  const db = openDb(t)
  const sql = upsertSql()
  put(db, sql, { stars: [6], stats: { fire: 4 }, ts: 1_000 })
  put(db, sql, { stars: [6, 6], stats: { fire: 8 }, ts: 1_000 })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fit_observations').get().n, 2)
})

test('混★ 与同★ 不是同一条：★0/★2 各一件自成一行', (t) => {
  const db = openDb(t)
  const sql = upsertSql()
  put(db, sql, { stars: [0, 2], stats: { fire: 5 }, ts: 1_000 })
  put(db, sql, { stars: [2, 2], stats: { fire: 6 }, ts: 1_000 })
  const rows = db.prepare('SELECT stars FROM fit_observations ORDER BY stars').all()
  assert.deepEqual(rows.map((row) => row.stars), ['0.2', '2.2'])
})

test('同一条再观察到：读数与 last_seen 更新，first_seen 不动', (t) => {
  const db = openDb(t)
  const sql = upsertSql()
  put(db, sql, { stars: [2], stats: { fire: 3 }, ts: 1_000 })
  put(db, sql, { stars: [2], stats: { fire: 3, evasion: 1 }, ts: 9_000 })
  const row = db
    .prepare('SELECT stats, first_seen, last_seen FROM fit_observations')
    .get()
  assert.deepEqual(JSON.parse(row.stats), { fire: 3, evasion: 1 })
  assert.equal(row.first_seen, 1_000, 'first_seen 被改了——「头一次测到是什么时候」就丢了')
  assert.equal(row.last_seen, 9_000)
})

test('不同舰形态各占一行：同一件装备在别的舰上是另一条观察', (t) => {
  const db = openDb(t)
  const sql = upsertSql()
  put(db, sql, { form: 599, stars: [0], stats: { fire: 2 }, ts: 1_000 })
  put(db, sql, { form: 600, stars: [0], stats: { fire: 1 }, ts: 1_000 })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fit_observations').get().n, 2)
})

test('显示行拆回落盘记录：一行并了几艘就出几条，键逐条带★', () => {
  const records = fitObservationRecordsOf(
    342,
    [
      {
        key: 'x',
        ships: [
          { rosterId: 1, formId: 599, name: '甲', lv: 99 },
          { rosterId: 2, formId: 600, name: '乙', lv: 98 },
        ],
        count: 1,
        stars: [2],
        starLabel: '★2',
        mixedStar: false,
        stats: { fire: 3 },
        sole: true,
        allZero: false,
      },
    ],
    1_700_000_000_000,
  )
  assert.equal(records.length, 2)
  assert.deepEqual(
    records.map((one) => one.key),
    ['342|599|★2|x1', '342|600|★2|x1'],
  )
  assert.ok(records.every((one) => one.sole && one.seenAt === 1_700_000_000_000))
  // 读数是拷贝，不是同一个对象——落盘记录不该跟着显示行一起被改
  records[0].stats.fire = 99
  assert.equal(records[1].stats.fire, 3)
})
