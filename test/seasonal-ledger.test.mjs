import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import ledgerModule from '../dist/main/mg/seasonal-ledger.js'
import campaign from '../dist/shared/seasonal-campaign.js'
import html from '../dist/shared/seasonal-history-html.js'
import retention from '../dist/shared/ledger-retention.js'

const { SeasonalLedger } = ledgerModule
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/pumpkin-ledger-20261014.json', import.meta.url)))
const catalog = campaign.SEASONAL_EXCHANGES[0]
const master = {
  api_mst_useitem: [{ api_id: 96, api_name: '南瓜' }, { api_id: 58, api_name: '改装設計図' }, { api_id: 57, api_name: '勲章' }, { api_id: 68, api_name: '秋刀魚' }],
  api_mst_slotitem: [{ api_id: 138, api_name: '二式大艇' }, { api_id: 312, api_name: '二式陸上偵察機(熟練)' }, { api_id: 478, api_name: '熟練甲板要員+航空整備員' }],
}
const make = t => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY, ts INTEGER, path TEXT, body TEXT, post_body TEXT);
    CREATE INDEX idx_events_path ON events(path);
    CREATE TABLE useitem_log(ts INTEGER, item_id INTEGER, delta INTEGER, total INTEGER, cause TEXT);
    CREATE TABLE event_archive(area_id INTEGER PRIMARY KEY, opened INTEGER, closed INTEGER, stats TEXT);
    CREATE TABLE material_log(ts INTEGER); CREATE TABLE material_delta(ts INTEGER); CREATE TABLE battle_snapshots(ts INTEGER); CREATE TABLE notify_log(ts INTEGER);`)
  const book = new SeasonalLedger(db, no => `中文任务 ${no}`)
  book.setMaster(master)
  t.after(() => db.close())
  return { db, book }
}
const put = (db, event) => db.prepare('INSERT INTO events(ts,path,body,post_body) VALUES (?,?,?,?)').run(event.ts, event.path, JSON.stringify(event.body), JSON.stringify(event.post ?? {}))
const log = (db, ts, delta, cause, id = 96) => db.prepare('INSERT INTO useitem_log VALUES (?,?,?,?,?)').run(ts, id, delta, 0, cause)
const seed = db => {
  for (const e of fixture.events) put(db, e)
  for (const r of fixture.useitemLog) db.prepare('INSERT INTO useitem_log VALUES (?,?,?,?,?)').run(r.ts, r.item_id, r.delta, r.total, r.cause)
}
const list = (ts, no, title = '【期間限定任務】南瓜任務', detail = '') => ({ ts, path: '/kcsapi/api_get_member/questlist', post: { api_tab_id: '0' }, body: { api_data: { api_list: [{ api_no: no, api_title: title, api_detail: detail }] } } })
const ctx = { nameOf: r => ({ 'useitem:58': '改装设计图', 'slotitem:138': '二式大艇' }[`${r.kind}:${r.id}`] ?? '未识别'), time: ts => `时刻${ts}` }
const finish = (book, over = {}) => book.settle({ now: catalog.expiresAt + 1000, stock: {}, stockTs: catalog.expiresAt + 1, quests: [], questsTs: catalog.expiresAt + 1, ...over })

test('旧questlist正文置空后重启回填：永久任务观测逐字段不变，领奖正文仍在', async t => {
  const { db, book } = make(t)
  seed(db)
  await book.startBackfill()
  const before = db.prepare('SELECT * FROM quest_observations ORDER BY observation_key').all()
  const claims = db.prepare('SELECT * FROM events WHERE path = ? ORDER BY id').all('/kcsapi/api_req_quest/clearitemget')
  db.prepare('UPDATE events SET body = NULL WHERE path = ?').run('/kcsapi/api_get_member/questlist')
  const restarted = new SeasonalLedger(db)
  restarted.setMaster(master)
  await restarted.startBackfill()
  assert.equal(restarted.backfillDone, true)
  assert.deepEqual(db.prepare('SELECT * FROM quest_observations ORDER BY observation_key').all(), before)
  assert.deepEqual(db.prepare('SELECT * FROM events WHERE path = ? ORDER BY id').all('/kcsapi/api_req_quest/clearitemget'), claims)
})

test('真实报文：任务分笔奖励合并、三次共5个、羊羹3个换6开发4改修，不复记快照', async t => {
  const { db, book } = make(t)
  seed(db)
  await book.startBackfill()
  const h = book.current({ 96: 2 }, fixture.events.at(-1).ts)[0]
  assert.deepEqual([h.gained, h.spent, h.stock], [5, 3, 2])
  assert.deepEqual(h.sources.map(s => [s.no, s.count, s.times]), [[984, 1, 1], [359, 1, 1], [1119, 3, 1]])
  assert.deepEqual(h.uses, [{ recipe: 'yokan', count: 3, times: 1 }])
  assert.deepEqual(h.rewards, [{ kind: 'material', id: 7, count: 6 }, { kind: 'material', id: 8, count: 4 }])
  assert.equal(h.receipts.length, 1)
  assert.equal(h.receipts[0].exchangeType, 110)
  assert.deepEqual(h.quests.find(q => q.no === 1119).claims.map(c => [c.selectNo, c.selectNo2]), [['2', '3']])
  assert.equal(h.party.length, 0)
  assert.doesNotMatch(html.campaignSummaryHtml(h, ctx), /已领/)
  assert.match(html.campaignSummaryHtml(h, ctx), /开发资材 ×6 \+ 改修资材 ×4/)
})

test('359 靠领奖绑定企划后，任务与来源都回落到最近一次普通任务观测标题', async t => {
  const { db } = make(t)
  const book = new SeasonalLedger(db)
  book.setMaster(master)
  seed(db)
  for (let i = 0; i < 7; i++) put(db, list(catalog.startsAt + 1000 + i, 359,
    i === 6 ? 'Halloween艦隊 実りの秋、最新演習！' : 'Halloween艦隊 過去の演習'))
  await book.startBackfill()
  const h = book.current({ 96: 2 }, fixture.events.at(-1).ts)[0]
  assert.equal(h.quests.find(q => q.no === 359).title, 'Halloween艦隊 実りの秋、最新演習！')
  assert.equal(h.sources.find(s => s.no === 359).title, 'Halloween艦隊 実りの秋、最新演習！')
  const translated = new SeasonalLedger(db, no => no === 359 ? '万圣节舰队演习' : '')
  translated.setMaster(master)
  const zh = translated.current({ 96: 2 }, fixture.events.at(-1).ts)[0]
  assert.equal(zh.quests.find(q => q.no === 359).title, '万圣节舰队演习')
  assert.equal(zh.sources.find(s => s.no === 359).title, '万圣节舰队演习')
})

for (const prefix of ['【期間限定任務】', '【期間限定】', '【期间限定任务】', '【期间限定】']) {
  test(`本季与海域任务均识别前缀 ${prefix}，没有领奖仍记未完成`, async t => {
    const { db, book } = make(t)
    put(db, list(catalog.startsAt + 1000, 1119, `${prefix}Halloween`))
    await book.startBackfill()
    for (const key of [undefined, 'pumpkin']) {
      const tasks = book.tasks(catalog.startsAt, catalog.expiresAt, key)
      assert.deepEqual(tasks.map(q => [q.no, q.claims.length]), [[1119, 0]])
    }
  })
}

test('任务库的中文限时前缀也可识别，未观测且无任务库名字时才回落到编号', async t => {
  const { db } = make(t)
  const book = new SeasonalLedger(db, no => no === 1119 ? '【期间限定任务】万圣节' : '')
  book.setMaster(master)
  seed(db)
  put(db, list(catalog.startsAt + 1000, 1119, 'Halloween'))
  await book.startBackfill()
  assert.equal(book.tasks(catalog.startsAt, catalog.expiresAt)[0].no, 1119)
  const h = book.current({ 96: 2 }, fixture.events.at(-1).ts)[0]
  assert.equal(h.sources.find(s => s.no === 359).title, '任务 359')
})

test('建表回填可重入；重复实时报文不重复记；清掉全部滚动表仍能合计并归档', async t => {
  const { db, book } = make(t)
  seed(db)
  await book.startBackfill()
  const second = new SeasonalLedger(db)
  second.setMaster(master)
  await second.startBackfill()
  for (const event of fixture.events) second.observe(event)
  assert.equal(db.prepare('SELECT count(*) n FROM quest_observations WHERE kind = ?').get('claim').n, 3)
  assert.equal(db.prepare('SELECT count(*) n FROM seasonal_exchange_log').get().n, 1)
  for (const step of retention.planLedgerPrune({ retentionDays: 7, now: catalog.expiresAt })) db.prepare(`DELETE FROM ${step.table} WHERE ts >= ? AND ts < ?`).run(step.from, step.to)
  assert.equal(db.prepare('SELECT count(*) n FROM events').get().n, 0)
  finish(second)
  const h = second.archives()[0]
  assert.deepEqual([h.gained, h.spent, h.receipts.length, h.quests.length], [5, 3, 1, 3])
  for (const table of ['seasonal_exchange_log', 'quest_observations', 'seasonal_archive']) assert.ok(retention.LEDGER_PERMANENT_TABLES.includes(table))
})

test('结束须到期、零库存与新完整任务全集；未接受任务仍挡住结账；结账后迟到事实可更新', async t => {
  const { db, book } = make(t)
  seed(db)
  await book.startBackfill()
  for (const over of [{ now: catalog.expiresAt - 1 }, { stock: { 96: 1 } }, { stockTs: catalog.expiresAt - 1 }, { questsTs: catalog.expiresAt - 1 }, { questsTs: null }, { quests: [{ no: 1, title: '南瓜任务' }] }]) {
    finish(book, over)
    assert.equal(book.archives().length, 0)
  }
  finish(book)
  const late = structuredClone(fixture.events[0]); late.ts += 1000
  book.observe(late)
  finish(book)
  assert.equal(book.archives().length, 1)
  assert.equal(book.archives()[0].gained, 6)
})

test('任务按季独立：每日压缩首末时刻，窗口内领奖才完成；夏活只补任务不改原统计', async t => {
  const { db, book } = make(t)
  const summer = Date.parse('2026-08-01T00:00:00+09:00')
  put(db, list(summer + 1000, 984))
  put(db, list(summer + 2000, 984))
  const summerClaim = structuredClone(fixture.events[0]); summerClaim.ts = summer + 3000
  put(db, summerClaim)
  put(db, list(catalog.startsAt + 1000, 984))
  put(db, list(catalog.startsAt + 2000, 999, '通常任務', '南瓜を集める'))
  db.prepare('INSERT INTO event_archive VALUES (?,?,?,?)').run(62, summer, summer + 9999, JSON.stringify({ sorties: 23, drops: [{ mstId: 1, n: 5 }] }))
  await book.startBackfill()
  const summerStats = JSON.parse(db.prepare('SELECT stats FROM event_archive').get().stats)
  assert.equal(summerStats.sorties, 23)
  assert.deepEqual(summerStats.drops, [{ mstId: 1, n: 5 }])
  assert.equal(summerStats.quests[0].claims.length, 1)
  assert.equal(summerStats.quests[0].firstSeen, summer + 1000)
  assert.equal(summerStats.quests[0].lastSeen, summer + 2000)
  const autumn = book.tasks(catalog.startsAt, catalog.expiresAt, 'pumpkin')
  assert.deepEqual(autumn.map(q => [q.no, q.claims.length]), [[984, 0], [999, 0]])
  assert.match(html.questHistoryHtml(autumn, 'autumn', ctx), /未完成/)
  assert.equal(book.tasks(summer + 1200, summer + 1800).length, 0, '首末见到之间没有观测，不能推成整个时段都出现过')
})

test('Party 未知类型：实际扣14且奖励命中才记已领；混合与无法解析回应如实保留', async t => {
  const { db, book } = make(t)
  await book.startBackfill()
  const ts = catalog.startsAt + 10000
  const event = { ts, path: '/kcsapi/api_req_member/itemuse', post: { api_useitem_id: '96', api_exchange_type: '999' }, body: { api_data: { api_material: [], api_getitem: [{ api_useitem: { api_id: 58, api_count: 4 } }] } } }
  book.observe(event)
  assert.equal(book.current({}, ts)[0].party.length, 0, '响应没有扣款证据不能猜 Party')
  log(db, ts + 1000, -14, event.path)
  const h = book.current({}, ts)[0]
  assert.equal(h.party.length, 1)
  assert.equal(h.party[0].exchangeType, 999, '不得把合成类型号填入目录')
  assert.match(html.campaignSummaryHtml(h, ctx), /已领：改装设计图 ×4/)
  assert.equal(catalog.recipes.find(r => r.key === 'party').exchangeType, undefined)
  assert.equal(db.prepare('SELECT cost FROM seasonal_exchange_log').get().cost, 14, '实际扣款要固化，不能只留在渲染结果')
  assert.deepEqual(book.parseRewards({ api_material: [1], api_getitem: [{ api_slotitem: { api_slotitem_id: 138 } }, { api_type: 456, api_id: 12345, api_count: 2 }, null] }), [
    { kind: 'material', id: 1, count: 1 }, { kind: 'slotitem', id: 138, count: 1 }, { kind: 'unknown', id: 12345, count: 2 },
  ])
  assert.match(html.campaignRewardsHtml([{ kind: 'unknown', id: 1, count: 2 }], ctx), /未识别 ×2/)
  assert.equal(html.campaignRewardsHtml(book.parseRewards({ api_getitem: [{ api_id: 12345 }] }), ctx), '未识别')
})

test('未知消耗进其他；只有报文明示才记改修对象；失败和取消不记兑换', async t => {
  const { db, book } = make(t)
  seed(db)
  await book.startBackfill()
  log(db, fixture.events.at(-1).ts + 10000, -2, null)
  assert.deepEqual(book.current({}, fixture.events.at(-1).ts)[0].otherUses.map(u => u.count), [2])
  const e = { ts: fixture.events.at(-1).ts + 20000, path: '/kcsapi/api_req_kaisou/powerup', post: { api_id: '42', api_useitem_id: '96', api_useitem_count: '2' }, body: { api_data: { api_ship: { api_ship_id: 100 } } } }
  book.observe(e)
  log(db, e.ts + 100, -2, e.path)
  assert.deepEqual(book.current({}, e.ts)[0].receipts.at(-1).target, { rosterId: 42, mstId: 100 })
  const canceled = structuredClone(fixture.events.at(-1)); canceled.ts = e.ts + 1000; canceled.body.api_data.api_caution_flag = 1
  book.observe(canceled)
  canceled.body.api_result = 0; canceled.body.api_data.api_caution_flag = 0
  book.observe(canceled)
  assert.equal(book.current({}, e.ts)[0].receipts.length, 2)
})

test('缺领奖报文的永久道具增量仍计入其他；同步延迟超过一分钟仍按两次道具变动边界配款', async t => {
  const { db, book } = make(t)
  seed(db)
  await book.startBackfill()
  log(db, fixture.events.at(-1).ts + 10000, 2, '/kcsapi/api_req_quest/clearitemget')
  const ts = fixture.events.at(-1).ts + 20000
  book.observe({ ts, path: '/kcsapi/api_req_member/itemuse', post: { api_useitem_id: '96', api_exchange_type: '999' }, body: { api_data: { api_getitem: [{ api_useitem_id: 58, api_count: 4 }] } } })
  log(db, ts + 120000, -14, '/kcsapi/api_req_member/itemuse')
  book.reconcileUseitems([96])
  const h = book.current({}, ts + 120000)[0]
  assert.equal(h.gained, 7)
  assert.equal(h.sources.at(-1).count, 2)
  assert.equal(h.party.length, 1)
  assert.equal(db.prepare("SELECT recipe FROM seasonal_exchange_log WHERE exchange_type = 999").get().recipe, 'party')
})

test('秋刀鱼也落永久企划；排除罐头任务；无截止目录不误结账；最近3笔与完整展开分开', async t => {
  const { db, book } = make(t)
  await book.startBackfill()
  book.observe(list(catalog.startsAt, 1, '秋刀魚の缶詰任務'))
  assert.equal(book.current({}, catalog.startsAt).length, 0)
  book.observe(list(catalog.startsAt + 1, 2, '秋刀鱼任务'))
  assert.equal(book.current({}, catalog.startsAt + 1)[0].key, 'sanma')
  finish(book)
  assert.equal(book.archives().length, 0)
  const h = { ...book.current({}, catalog.startsAt + 1)[0], receipts: [1, 2, 3, 4].map(ts => ({ ts, recipe: 'unknown', exchangeType: 9, cost: null, rewards: [] })) }
  const out = html.campaignRecordsHtml(h, ctx)
  const [recent, expanded] = out.split('<details class="op-more"')
  assert.doesNotMatch(recent, /时刻1 /)
  assert.match(expanded, /全部记录 · 4/)
  assert.match(expanded, /data-keep="campaign-records:sanma:/)
  assert.match(html.campaignRecordsHtml(h, ctx, true), /来源与去向/)
})
