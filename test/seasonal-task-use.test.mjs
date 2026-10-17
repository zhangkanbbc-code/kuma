import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import ledgerModule from '../dist/main/mg/seasonal-ledger.js'
import campaign from '../dist/shared/seasonal-campaign.js'
import html from '../dist/shared/seasonal-history-html.js'
import preparation from '../dist/main/mg/quest-scrap-rules.js'
import claimsModule from '../dist/shared/quest-claims.js'
import { unnumberedMaster } from './fixtures/quest-unnumbered-master.mjs'

const { SeasonalLedger } = ledgerModule
const pack = JSON.parse(fs.readFileSync(new URL('../assets/lodes/quests-scn.json', import.meta.url)))
const localization = JSON.parse(fs.readFileSync(new URL('../assets/lodes/kcwiki-localization.json', import.meta.url)))
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/pumpkin-ledger-20261014.json', import.meta.url)))
const entry = pack.unnumbered['2610F1']
const catalog = campaign.SEASONAL_EXCHANGES[0]
const ts = catalog.startsAt + 10_000
const no = 9004
const claimPath = '/kcsapi/api_req_quest/clearitemget'
const master = { ...unnumberedMaster, api_mst_useitem: [...unnumberedMaster.api_mst_useitem,
  { api_id: 78, api_name: '新型兵装資材' }, { api_id: 58, api_name: '改装設計図' }] }
const numberedPack = () => ({ ...pack, data: { ...pack.data, [no]: entry } })
const claim = (time = ts + 100, reward = 0, questNo = no) => ({ ts: time, path: claimPath,
  post: { api_quest_id: `${questNo}` }, body: { api_data: { api_material: reward ? [] : [0, 0, 0, 0, 0, 0, 45, 0],
    api_bounus: reward ? [{ api_type: 13, api_item: { api_id: 96, api_count: reward } }] : [] } } })
const seen = (title = entry.titleJa) => ({ ts, path: '/kcsapi/api_get_member/questlist', post: {},
  body: { api_data: { api_list: [{ api_no: no, api_title: title, api_detail: '南瓜を準備' }] } } })
const exchange = () => ({ ts: ts + 200, path: '/kcsapi/api_req_member/itemuse',
  post: { api_useitem_id: '96', api_exchange_type: '110' }, body: { api_data: { api_material: [0, 0, 0, 0, 0, 0, 6, 4] } } })
const getLode = source => id => id === 'quests-scn' ? source : id === 'kcwiki-localization' ? localization : null
const open = (t, source = numberedPack()) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-seasonal-task-use-'))
  const file = path.join(dir, 'ledger.sqlite')
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, path TEXT, body TEXT, post_body TEXT);
    CREATE TABLE useitem_log(ts INTEGER, item_id INTEGER, delta INTEGER, total INTEGER, cause TEXT);
    CREATE TABLE event_archive(area_id INTEGER PRIMARY KEY, opened INTEGER, closed INTEGER, stats TEXT);`)
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const book = new SeasonalLedger(db, () => '', getLode(source))
  book.setMaster(master)
  const put = event => {
    db.prepare('INSERT INTO events(ts,path,body,post_body) VALUES (?,?,?,?)')
      .run(event.ts, event.path, JSON.stringify(event.body), JSON.stringify(event.post ?? {}))
    book.observe(event)
  }
  book.observe(seen())
  const sync = (delta, cause = null, time = ts + 1000) =>
    db.prepare('INSERT INTO useitem_log VALUES (?,96,?,?,?)').run(time, delta, 10 + delta, cause)
  return { db, book, put, sync }
}
const history = book => book.history('pumpkin', catalog.startsAt)
const count = (h, recipe) => h.uses.filter(u => u.recipe === recipe).reduce((n, u) => n + u.count, 0)
const ctx = { nameOf: () => '未识别', time: time => `时刻${time}` }

test('2610F1 非南瓜奖励：同步 −2，任务消耗2、其他0；准备条件同源', t => {
  const { book, put, sync } = open(t)
  put(claim()); sync(-2)
  const h = history(book)
  assert.deepEqual([count(h, 'quest'), count(h, 'other'), h.spent, h.gained - h.spent], [2, 0, 2, -2])
  const context = preparation.buildScrapRuleContext(master, localization.data)
  const goals = preparation.deriveScrapPreparation(entry.desc, entry.memo2, context).stockGoals
  assert.equal(h.taskUses[0].count, goals.find(g => g.kind === 'useitem' && g.id === 96).count)
  assert.deepEqual(h.uses, [{ recipe: 'quest', no, code: '2610F1', title: entry.name, count: 2, times: 1 }])
  assert.match(html.campaignSummaryHtml(h, ctx), /去向 任务消耗 2610F1 \/ #9004 反潜装备的整理整顿！2026 1 次 · 2 个/)
  assert.match(html.campaignRecordsHtml(h, ctx), new RegExp(`时刻${ts + 100} · 任务消耗 · 花 2 个 · 2610F1 / #9004 反潜装备的整理整顿！2026`))
})

test('2610F1 选南瓜×4：同步 +2，获得4、花掉2，奖励抵消也不漏花掉', t => {
  const { book, put, sync } = open(t)
  put(claim(ts + 100, 4)); sync(2, claimPath)
  const h = history(book)
  assert.deepEqual([h.gained, h.spent, h.gained - h.spent, count(h, 'other')], [4, 2, 2, 0])
})

for (const [reward, delta, cause] of [[0, -5, null], [4, -1, claimPath], [0, -5, '/kcsapi/api_req_member/itemuse']]) {
  test(`同一同步窗口任务与羊羹按成本拆分：奖励${reward}，净变动${delta}，归因${cause}`, t => {
    const { book, put, sync } = open(t)
    put(claim(ts + 100, reward)); put(exchange()); sync(delta, cause)
    const h = history(book)
    assert.deepEqual([count(h, 'yokan'), count(h, 'quest'), count(h, 'other')], [3, 2, 0])
    assert.equal(h.gained - h.spent, delta)
  })
}

test('只靠永久观测日文标题：仅trim且唯一；一字之差、内部空格、重复候选不计入', t => {
  for (const [title, source, expected] of [
    [` \t${entry.titleJa}\n`, pack, 2],
    [entry.titleJa.replace('整理', '整里'), pack, 0],
    [entry.titleJa.replace('対潜', '対 潜'), pack, 0],
    [entry.titleJa, { ...pack, unnumbered: { ...pack.unnumbered, duplicate: { ...entry } } }, 0],
  ]) {
    const { book, db, put, sync } = open(t, source)
    db.exec('DELETE FROM quest_observations')
    book.observe(seen(title)); put(claim()); sync(-2)
    const h = history(book)
    assert.equal(count(h, 'quest'), expected, title)
    assert.equal(count(h, 'other'), 2 - expected, title)
  }
  assert.equal(claimsModule.resolveQuestClaims(pack, [{ no, title: entry.titleJa }]).data[no].code, '2610F1')
  assert.equal(claimsModule.resolveQuestClaims(pack, [{ no, title: entry.titleJa, category: 10 }]).data[no], undefined)
})

test('已定号data优先，不被同标题未定号条目覆盖', t => {
  const source = numberedPack()
  source.data[no] = { ...entry, code: 'F999', desc: '准备「南瓜」9个！', memo2: '' }
  const { book, put, sync } = open(t, source)
  put(claim()); sync(-2)
  const h = history(book)
  assert.equal(count(h, 'quest'), 0)
  assert.equal(count(h, 'other'), 2)
})

test('明确消耗说明才计入；数量只来自解析，不按2610F1手工固定', t => {
  const source = numberedPack()
  source.data[no] = { ...entry, desc: '准备「南瓜」3个！（准备的道具将被消耗）', memo2: '' }
  const { book, put, sync } = open(t, source)
  put(claim()); sync(-3)
  assert.equal(count(history(book), 'quest'), 3)
  for (const desc of ['准备「南瓜」3个！', '准备「南瓜」3个！（准备的道具不会消失）']) {
    source.data[no].desc = desc
    assert.equal(count(history(book), 'quest'), 0)
    assert.equal(count(history(book), 'other'), 3)
  }
})

test('解析不出或partial时不猜，主进程同条任务只打一行日志', t => {
  for (const desc of ['准备「南瓜」若干个！（准备的道具将被消耗）', '准备「南瓜」2个、未知道具3个！（准备的道具将被消耗）']) {
    const source = numberedPack()
    source.data[no] = { ...entry, desc, memo2: '' }
    const { book, put, sync } = open(t, source)
    put(claim()); sync(-2)
    const messages = []
    const warn = console.warn
    console.warn = (...args) => messages.push(args.join(' '))
    try {
      for (let i = 0; i < 2; i++) {
        const h = history(book)
        assert.deepEqual([count(h, 'quest'), count(h, 'other')], [0, 2])
      }
    } finally { console.warn = warn }
    assert.deepEqual(messages, ['[kuma] mg: 季节任务消耗未解析 9004 2610F1'])
  }
})

test('1119家具币、F136新型兵装资材不进入南瓜卡', t => {
  const { book, put, sync } = open(t, pack)
  put(claim(ts + 100, 0, 1119)); put(claim(ts + 200, 0, 1158)); sync(-2)
  const h = history(book)
  assert.deepEqual([count(h, 'quest'), count(h, 'other'), h.spent], [0, 2, 2])
})

test('两次领奖累计次数并逐笔显示；不同窗口及任务窗口的其他来源不被任务奖励吞掉', t => {
  const { book, put, sync } = open(t)
  put(claim(ts + 100, 4)); sync(2)
  sync(3, null, ts + 2000)
  put(claim(ts + 3000)); sync(-2, null, ts + 4000)
  const h = history(book)
  assert.deepEqual([h.gained, h.spent, h.gained - h.spent], [7, 4, 3])
  assert.deepEqual(h.uses.map(u => [u.recipe, u.count, u.times]), [['quest', 4, 2]])
  assert.equal((html.campaignRecordsHtml(h, ctx).match(/· 任务消耗 · 花 2 个/g) ?? []).length, 2)
  put(claim(ts + 5000, 4)); sync(5, null, ts + 6000)
  const next = history(book)
  assert.deepEqual([next.gained, next.spent, next.gained - next.spent], [14, 6, 8])
  assert.deepEqual(next.sources.find(s => s.no == null), { no: null, title: '其他', count: 6, times: 2 })
})

test('已领奖且回填进度越过：旧实例没企划任务解析，升级history直接补上且不写新记录、不重放', async t => {
  const { db, put, sync } = open(t, null)
  put(claim()); sync(-2)
  db.prepare('INSERT INTO seasonal_backfill_state VALUES (1,?)').run(999)
  // 模拟已清除的滚动事件正文；只留下永久seen/claim事实。
  db.exec('DELETE FROM events')
  const before = db.prepare('SELECT * FROM quest_observations ORDER BY observation_key').all()
  const upgraded = new SeasonalLedger(db, () => '', getLode(pack))
  upgraded.setMaster(master)
  upgraded.observe = () => assert.fail('不应重新observe历史')
  assert.deepEqual([history(upgraded).spent, count(history(upgraded), 'other')], [2, 0])
  await upgraded.startBackfill()
  assert.equal(db.prepare('SELECT event_id FROM seasonal_backfill_state').get().event_id, 999)
  assert.deepEqual(db.prepare('SELECT * FROM quest_observations ORDER BY observation_key').all(), before)
  assert.equal(db.prepare('SELECT count(*) n FROM seasonal_exchange_log').get().n, 0)
})

test('升级不改已结账旧企划的存档；原有迟到事实结账机制仍按旧口径', async t => {
  const { db, book, put, sync } = open(t, null)
  put(claim()); sync(-2)
  await book.startBackfill()
  const settle = target => target.settle({ now: catalog.expiresAt + 1, stock: {}, stockTs: catalog.expiresAt + 1,
    quests: [], questsTs: catalog.expiresAt + 1 })
  settle(book)
  const before = db.prepare('SELECT stats FROM seasonal_archive').get().stats
  const upgraded = new SeasonalLedger(db, () => '', getLode(pack))
  upgraded.setMaster(master)
  await upgraded.startBackfill()
  upgraded.reconcileUseitems([96]); settle(upgraded)
  assert.equal(db.prepare('SELECT stats FROM seasonal_archive').get().stats, before)
  assert.equal(count(upgraded.archives()[0], 'quest'), 0)
})

test('最后同步后的领奖、兑换、任务消耗按事实计入，不抵消之前区间其他来源', t => {
  const { book, put, sync } = open(t)
  sync(3, null, ts + 50)
  put(claim(ts + 100, 4)); put(exchange())
  const h = history(book)
  assert.deepEqual([h.gained, h.spent, count(h, 'quest'), count(h, 'yokan'), count(h, 'other')], [7, 5, 2, 3, 0])
  assert.deepEqual(h.sources.find(s => s.no == null), { no: null, title: '其他', count: 3, times: 1 })
  assert.deepEqual(h.otherUses, [])
  assert.equal(h.taskUses.length, 1)
  assert.equal(h.receipts.length, 1)
})

test('真实账本夹具启用任务解析前后输出逐字段相同', async t => {
  const { db, book, put } = open(t, null)
  db.exec('DELETE FROM quest_observations; DELETE FROM seasonal_archive')
  for (const event of fixture.events) put(event)
  for (const row of fixture.useitemLog) db.prepare('INSERT INTO useitem_log VALUES (?,?,?,?,?)')
    .run(row.ts, row.item_id, row.delta, row.total, row.cause)
  await book.startBackfill()
  const before = history(book)
  const upgraded = new SeasonalLedger(db, () => '', getLode(pack))
  upgraded.setMaster(master)
  assert.deepEqual(history(upgraded), before)
  assert.deepEqual([before.gained, before.spent], [5, 3])
})
