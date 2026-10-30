// 维护者裁决 2026-10-30：领取留档、排行归月、确认行优先，推断保留作退路。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'
import { cut, evaluate } from './fixtures/zi-refresh-runtime.mjs'
import { openLedger } from './fixtures/phantom-consumable-ledger.mjs'
import { incentiveData, incentiveTs, equipNameOf } from './fixtures/incentive-20261030.mjs'
import { rewardHost } from './fixtures/senka-reward-runtime.mjs'

const host = rewardHost()
const ranking = host.load('src/shared/senka-ranking.ts')
const senka = host.load('src/shared/senka.ts')
const retention = host.load('src/shared/ledger-retention.ts')
const { senkaRankingHtml } = host.load('src/renderer/senka-ranking-view.ts')
const { incentiveItems, rankingRewardReceipts, rankingRewardMonth } = ranking
const monthStart = month => senka.senkaMonthStart(Date.parse(`${month}-15T12:00:00+09:00`))
const SEP = monthStart('2026-09'), AUG = monthStart('2026-08')
const receipts = data => incentiveItems(data).map(item => ({ ...item, ts: incentiveTs }))
const confirmed = () => rankingRewardReceipts(receipts(incentiveData), equipNameOf)
const past = (start, over = {}) => ({ monthStart: start, own: null,
  lines: { 5: null, 20: null, 100: null, 500: null }, undecoded: 0, rewards: [], ...over })
const render = history => senkaRankingHtml({ ...ranking.failedSenkaRanking(1), history })
const rewardLines = html => html.match(/<div class="sd-rank-rewards"[^>]*>.*?<\/div>/g) ?? []

test('实样解析：九月三群两件装备，缺省 ★0、明确 ★1，原字段保留', () => {
  assert.deepEqual(incentiveItems(incentiveData), incentiveData.api_item.map(item => ({ api_slotitem_level: 0, ...item })))
  assert.deepEqual(confirmed(), { [SEP]: [
    { ts: incentiveTs, month: 9, rankFrom: 101, rankTo: 500, type: 2, itemId: 466, level: 0, name: '流星改(熟練)' },
    { ts: incentiveTs, month: 9, rankFrom: 101, rankTo: 500, type: 2, itemId: 589, level: 1, name: 'XF6F-6' },
  ] })
})

test('归月最多三个已结束战果月；未匹配回最近结束月，跨年与 22 点月界一致', () => {
  for (const [textMonth, expected] of [[9, SEP], [8, AUG], [7, monthStart('2026-07')], [6, SEP], [10, SEP]]) {
    assert.equal(rankingRewardMonth(incentiveTs, textMonth), expected)
  }
  const august = structuredClone(incentiveData)
  august.api_item.forEach(item => { item.api_getmes = item.api_getmes.replace('九月', '八月') })
  assert.equal(Object.keys(rankingRewardReceipts(receipts(august), equipNameOf))[0], `${AUG}`)
  assert.equal(rankingRewardMonth(Date.parse('2027-01-20T20:47:00+09:00'), 12), monthStart('2026-12'))
  const boundary = Date.parse('2026-10-31T22:00:00+09:00')
  assert.equal(rankingRewardMonth(boundary - 1, 10), SEP)
  assert.equal(rankingRewardMonth(boundary, 10), monthStart('2026-10'))
})

test('确认行替代同月疑似行，无领取记录的月份沿用勋章×2夹具', () => {
  const inferred = [{ itemId: 57, name: '勋章', count: 2, ts: Date.parse('2026-09-01T03:12+09:00') }]
  const html = render([past(SEP, { rewards: inferred, rewardReceipts: confirmed()[SEP] }), past(AUG, { rewards: inferred })])
  assert.deepEqual(rewardLines(html), [
    '<div class="sd-rank-rewards">排行奖励 · 三群（101～500位）：<span class="el e-equip" data-etype="mstEquip" data-eid="466">流星改(熟練)</span>、<span class="el e-equip" data-etype="mstEquip" data-eid="589">XF6F-6</span>★+1</div>',
    '<div class="sd-rank-rewards" title="战果月交界后到下一次交界之间来路不明的道具与新装备，尚未与游戏报文核对">疑似排行奖励：勋章×2</div>',
  ])
  assert.equal(rewardLines(render([past(SEP, { rewards: inferred, rewardReceipts: [] })])).length, 1)
  assert.deepEqual(rewardLines(render([past(SEP)])), [])
})

test('档位共用联合/一群/二群/三群，其他区间只写名次；其它 type 原文去领取后缀并转义', () => {
  const reward = confirmed()[SEP][0]
  for (const [rankTo, name] of [[5, '联合'], [20, '一群'], [100, '二群'], [500, '三群'], [1000, '']]) {
    const label = name ? `${name}（1～${rankTo}位）` : `1～${rankTo}位`
    assert.ok(render([past(SEP, { rewardReceipts: [{ ...reward, rankFrom: 1, rankTo }] })]).includes(`排行奖励 · ${label}：`))
  }
  const data = { api_item: [{ ...incentiveData.api_item[0], api_type: 97,
    api_getmes: '九月作戦 主力艦隊第三群(101～500位)<br><b>記念品</b> を獲得しました！' }] }
  const out = rankingRewardReceipts(receipts(data), () => { throw new Error('其它 type 不查装备主数据') })
  assert.equal(out[SEP][0].name, '<b>記念品</b>')
  const html = render([past(SEP, { rewardReceipts: out[SEP] })])
  assert.ok(html.includes('&#60;b&#62;記念品&#60;/b&#62;'))
  assert.doesNotMatch(html, /を獲得しました|<b>記念品/)
})

const ledgerSource = fs.readFileSync(new URL('../src/main/mg/ledger.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ledger.ts', ledgerSource, ts.ScriptTarget.Latest, true)
const ledgerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'Ledger')
const method = name => {
  const node = ledgerClass.members.find(node => node.name?.getText(ast) === name)
  assert.ok(node, `生产方法已移动：${name}`)
  return node.getText(ast)
}
const makeDbLedger = db => evaluate(`class TestLedger {
  constructor(public db: any) {}
  ${['runBatch', 'record', 'recordIncentives', 'backfillIncentives', 'queryIncentiveReceipts', 'rankingRewardStamp'].map(method).join('\n')}
}`, { db, ...ranking, SNAPSHOT_ONLY_PATHS: new Set(), redactPostBody: body => body }, 'return new TestLedger(db)')
const schema = cut(ledgerSource, 'CREATE TABLE IF NOT EXISTS incentive_receipts (', 'CREATE TABLE IF NOT EXISTS material_log (')
const memoryDb = t => {
  const db = new DatabaseSync(':memory:')
  db.exec(`${schema}
    CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, method TEXT, path TEXT, body TEXT, post_body TEXT, secretary_mst INTEGER);
    CREATE TABLE useitem_log(ts INTEGER, item_id INTEGER, delta INTEGER, cause TEXT);
    CREATE TABLE slotitem_seen(id INTEGER, first_ts INTEGER);`)
  t.after(() => db.close())
  return db
}

test('实时 record 写入全部 api_item，零次/无条目不写；同事件同序号幂等，写入后奖励缓存失效', t => {
  const db = memoryDb(t), ledger = makeDbLedger(db)
  const before = ledger.rankingRewardStamp()
  const record = data => ledger.record('POST', '/kcsapi/api_req_member/get_incentive', JSON.stringify({ api_data: data }), '', incentiveTs)
  record({ api_count: 0 }); record({ api_count: 1 }); record({ api_count: 0, api_item: incentiveData.api_item })
  assert.deepEqual(ledger.queryIncentiveReceipts(), [])
  assert.equal(ledger.rankingRewardStamp(), before)
  record(incentiveData)
  assert.deepEqual(ledger.queryIncentiveReceipts().map(r => ({ ...r })), receipts(incentiveData))
  const stamp = ledger.rankingRewardStamp()
  assert.notEqual(stamp, before)
  ledger.recordIncentives(4, incentiveTs, incentiveData)
  assert.equal(ledger.queryIncentiveReceipts().length, 2)
  assert.equal(ledger.rankingRewardStamp(), stamp)
  const nonRanking = { api_item: [
    { ...incentiveData.api_item[0], api_mode: 1, api_type: 99, api_getmes: 'ログイン記念<br>記念品 を獲得しました！' },
    { ...incentiveData.api_item[0], api_getmes: '九月 主力艦隊第三群(101～500位)<br>記念品 を獲得しました！' },
    { ...incentiveData.api_item[0], api_getmes: '九月作戦 主力艦隊第三群<br>記念品 を獲得しました！' },
  ] }
  record(nonRanking)
  const rows = ledger.queryIncentiveReceipts()
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.slice(2).map(row => row.api_getmes), nonRanking.api_item.map(item => item.api_getmes))
  assert.equal(Object.values(rankingRewardReceipts(rows, equipNameOf)).flat().length, 2)
  assert.deepEqual(rankingRewardReceipts(rows.slice(2), equipNameOf), {})
})

test('真实构造器从 events 一次性补入两条；再次启动不重复也不再扫描', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-incentive-backfill-'))
  const db = new DatabaseSync(path.join(dir, 'mg.sqlite'))
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  db.exec('PRAGMA user_version=15; CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, method TEXT, path TEXT, body TEXT, post_body TEXT)')
  const add = db.prepare("INSERT INTO events(ts,path,body) VALUES (?,'/kcsapi/api_req_member/get_incentive',?)")
  add.run(incentiveTs - 1, JSON.stringify({ api_data: { api_count: 0 } }))
  add.run(incentiveTs, JSON.stringify({ api_data: incentiveData }))
  let ledger = openLedger(dir)
  assert.equal(ledger.queryIncentiveReceipts().length, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incentive_backfill_state').get().n, 1)
  ledger.close()
  // 完成标记后故意加入不可解析的旧事件，证明重启不重扫。
  add.run(incentiveTs + 1, 'completed-marker-must-skip')
  ledger = openLedger(dir)
  assert.deepEqual(ledger.queryIncentiveReceipts().map(r => ({ ...r })), receipts(incentiveData))
  ledger.close()
})

test('补写失败时条目与完成标记一起回滚，再试可恢复', t => {
  const db = memoryDb(t), ledger = makeDbLedger(db)
  db.prepare('INSERT INTO events(ts,path,body) VALUES (?,?,?)').run(incentiveTs, '/kcsapi/api_req_member/get_incentive', JSON.stringify({ api_data: incentiveData }))
  db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON incentive_receipts WHEN NEW.item_index=1 BEGIN SELECT RAISE(FAIL, 'stop'); END")
  assert.throws(() => ledger.backfillIncentives(), /stop/)
  assert.equal(ledger.queryIncentiveReceipts().length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM incentive_backfill_state').get().n, 0)
  db.exec('DROP TRIGGER fail_second')
  ledger.backfillIncentives(); ledger.backfillIncentives()
  assert.equal(ledger.queryIncentiveReceipts().length, 2)
})

test('永久白名单保护领取表与标记表，自动及按月清理计划不触及', () => {
  for (const name of ['incentive_receipts', 'incentive_backfill_state']) {
    assert.ok(retention.LEDGER_PERMANENT_TABLES.includes(name))
    assert.ok(!retention.planLedgerPrune({ retentionDays: 1, now: incentiveTs }).some(r => r.table === name))
    assert.ok(!retention.planLedgerMonthClear('2026-10').some(r => r.table === name))
  }
})

test('主进程历史装配：仅有领取时也创建往月，有记录月移除候选、无记录月保留候选', () => {
  const source = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const handlers = new Map()
  const view = { ...ranking.failedSenkaRanking(1), failedAt: undefined }
  evaluate(cut(source, "ipcMain.handle('mg:senka-ranking'", "ipcMain.handle('mg:senka',"), {
    ...ranking, ...senka, rankingFailure: null, querySenkaRanking: () => ({ ...view }),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    store: { getState: () => ({ player: { basic: {} }, master: { slotitems: { 466: { name: equipNameOf(466) }, 589: { name: equipNameOf(589) } } } }) },
    rankingOwnHintAt: () => () => 0, ensureMasterRaw: () => ({ data: { api_mst_useitem: [{ api_id: 57, api_name: '勋章' }] } }),
    ledger: {
      queryRankingPages: () => [], earliestEventTs: () => AUG, latestEquipSyncBefore: () => null,
      queryRankingRewardRows: () => [
        { ts: monthStart('2026-09'), item_id: 57, delta: 2, cause: null },
        { ts: monthStart('2026-10'), item_id: 57, delta: 3, cause: null },
      ],
      querySlotitemSeen: () => [], queryEquipSyncTs: () => [], queryLateEquipEventTs: () => [],
      queryIncentiveReceipts: () => receipts(incentiveData),
    },
  }, '')
  const result = handlers.get('mg:senka-ranking')({}, incentiveTs, { history: true })
  assert.equal(result.historyFailedAt, undefined)
  assert.deepEqual(result.history.map(row => row.monthStart), [SEP, AUG])
  assert.equal(result.history[0].rewardReceipts.length, 2)
  assert.deepEqual(result.history[0].rewards, [])
  assert.equal(result.history[1].rewards[0].count, 2)
  assert.deepEqual(result.history[1].rewardReceipts, [])
  assert.equal(rewardLines(senkaRankingHtml(result)).length, 2)
})
