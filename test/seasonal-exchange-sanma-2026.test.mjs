// 秋刀鱼 2026 兑换目录（维护者裁决 2026-11-25：维护者截了游戏内兑换菜单 4 张）。
//   刺身：秋刀魚 ×3 → 弾薬 ×300 + 鋼材 ×150，不限次数
//   塩焼：秋刀魚 ×5 → 改修資材 ×1 + 開発資材 ×3，不限次数
//   蒲焼：秋刀魚 ×7 → ① 秋刀魚の缶詰 ×1 + 高速修復材 ×3　② 高速建造材 ×25；二选一、限 2 次
//   秋刀魚カレー改二偵：秋刀魚 ×27 → ① 工廠資源 ×6 + 12.7cm連装砲D型改三 ×1
//                                   ② 格納庫増設 ×6 + 熟練見張員 ★max ×4；二选一、限 1 次
// 选项内的先后照菜单从左到右；菜单截图里看不到次数，可兑换次数取舰娘百科
// 「季节性/2026年秋刀鱼祭典」兑换说明表（2026-11-25 版：蒲焼最多 2 次、カレー最多 1 次）。
// 罐头是道具框（与高速修復材同框），所以是道具「秋刀魚の缶詰」，不是同名装备。
// 菜单名「秋刀魚カレー改二偵」取运营公告 04（2026-11-24）
// https://x.com/KanColle_STAFF/status/2125186655267021084 。
//
// 有效期与南瓜同口径：起点取实装当天 00:00 JST 作账本统计下界，2027-01-01 00:00 JST 停显；
// 秋刀鱼实际消灭时刻等运营公告再登记（SEASONAL_CAMPAIGN_ENDS）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'

import campaign from '../dist/shared/seasonal-campaign.js'
import historyHtml from '../dist/shared/seasonal-history-html.js'
import ledgerModule from '../dist/main/mg/seasonal-ledger.js'

const { detectSeasonalCampaigns, SEASONAL_EXCHANGES } = campaign
const { SeasonalLedger } = ledgerModule

const jst = (s) => Date.parse(`${s}+09:00`)
const USEITEM_MST = [
  { id: 1, name: '高速修復材' },
  { id: 2, name: '高速建造材' },
  { id: 3, name: '開発資材' },
  { id: 4, name: '改修資材' },
  { id: 32, name: '弾薬' },
  { id: 33, name: '鋼材' },
  { id: 68, name: '秋刀魚' },
  { id: 69, name: '秋刀魚の缶詰' },
  { id: 96, name: '南瓜' },
  { id: 104, name: '工廠資源' },
  { id: 105, name: '格納庫増設' },
]
const SLOTITEM_MST = [
  { id: 129, name: '熟練見張員' },
  { id: 150, name: '秋刀魚の缶詰' },
  { id: 366, name: '12.7cm連装砲D型改三' },
  { id: 412, name: '水雷戦隊 熟練見張員' },
]
const sanma = (over = {}) =>
  detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    slotitemMst: SLOTITEM_MST,
    useitems: { 68: 30 },
    quests: [],
    now: jst('2026-11-25T12:00'),
    ...over,
  }).find((c) => c.key === 'sanma')

test('秋刀鱼企划带上 2026 兑换目录，名字解析成主数据 id，★max 记在那件装备上', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(sanma().exchange)), {
    season: 2026,
    startsAt: jst('2026-11-24T00:00'),
    expiresAt: jst('2027-01-01T00:00'),
    recipes: [
      {
        key: 'sashimi', jpName: '刺身', cost: 3, limit: null,
        choices: [[{ kind: 'useitem', id: 32, count: 300 }, { kind: 'useitem', id: 33, count: 150 }]],
      },
      {
        key: 'shioyaki', jpName: '塩焼', cost: 5, limit: null,
        choices: [[{ kind: 'useitem', id: 4, count: 1 }, { kind: 'useitem', id: 3, count: 3 }]],
      },
      {
        key: 'kabayaki', jpName: '蒲焼', cost: 7, limit: 2,
        choices: [
          [{ kind: 'useitem', id: 69, count: 1 }, { kind: 'useitem', id: 1, count: 3 }],
          [{ kind: 'useitem', id: 2, count: 25 }],
        ],
      },
      {
        key: 'curry', jpName: '秋刀魚カレー改二偵', cost: 27, limit: 1,
        choices: [
          [{ kind: 'useitem', id: 104, count: 6 }, { kind: 'slotitem', id: 366, count: 1 }],
          [{ kind: 'useitem', id: 105, count: 6 }, { kind: 'slotitem', id: 129, count: 4, level: 10 }],
        ],
      },
    ],
  })
})

test('南瓜目录仍是第一份且原样不动；秋刀鱼目录追加在后', () => {
  assert.equal(SEASONAL_EXCHANGES[0].campaignKey, 'pumpkin')
  assert.ok(SEASONAL_EXCHANGES.some((c) => c.campaignKey === 'sanma' && c.season === 2026))
})

test('秋刀鱼目录只在本季有效：实装当天之前与 2027 年元旦之后都不带', () => {
  assert.equal(sanma({ now: jst('2026-11-23T23:59') }).exchange, undefined)
  assert.ok(sanma({ now: jst('2026-12-31T23:59') }).exchange)
  const late = sanma({ now: jst('2027-01-01T00:00') })
  assert.ok(late, '企划检测不该受目录有效期影响')
  assert.equal(late.exchange, undefined)
})

// ---- 季节企划卡（铎）----

const zhNames = {
  item: { 1: '高速修复材', 2: '高速建造材', 3: '开发资材', 4: '改修资材', 32: '弹药', 33: '钢材', 69: '秋刀鱼罐头', 104: '工厂资源', 105: '格纳库增设' },
  equip: { 129: '熟练见张员', 366: '12.7cm连装炮D型改三' },
}
const du = readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
const a = du.indexOf('const CAMPAIGN_PERIOD_ORDER'), b = du.indexOf('const render = () =>', a)
assert.ok(a >= 0 && b > a, '缺少季节企划视图段')
const context = vm.createContext({
  campaignHistory: [],
  campaignSummaryHtml: historyHtml.campaignSummaryHtml,
  campaignRecordsHtml: historyHtml.campaignRecordsHtml,
  fmtDateTime: () => '2026-11-25 12:00',
  fmtDurationLong: () => '1周0时',
  mg: {
    quests: {}, useitemsTs: null,
    master: { slotitems: Object.fromEntries(SLOTITEM_MST.map((item) => [item.id, item])) },
  },
  useitemMst: USEITEM_MST,
  entityNamePlain: (domain, id, jpName) => {
    const mst = domain === 'item' ? USEITEM_MST : SLOTITEM_MST
    assert.equal(jpName, mst.find((item) => item.id === id)?.name)
    assert.ok(zhNames[domain]?.[id], `奖励域或 id 错误：${domain}/${id}`)
    return zhNames[domain][id]
  },
  esc: (s) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
  elink: (_d, id, name) => `<a data-quest="${id}">${name}</a>`,
  fmtTime: () => '20:39:14',
  CAMPAIGN_PERIOD_LABEL: { unknown: '目录未收录' },
})
vm.runInContext(transformSync(`${du.slice(a, b)}\nglobalThis.view = campaignViewHtml`, { loader: 'ts', format: 'cjs' }).code, context)

test('企划卡：四道菜单、次数规则、中文奖励；★max 紧跟装备名、数量在后', () => {
  const html = context.view([sanma()])
  assert.match(html, /刺身<\/b> · 秋刀鱼 ×3/)
  assert.match(html, /弹药 ×300 \+ 钢材 ×150/)
  assert.match(html, /塩焼<\/b> · 秋刀鱼 ×5/)
  assert.match(html, /改修资材 ×1 \+ 开发资材 ×3/)
  assert.match(html, /蒲焼<\/b> · 秋刀鱼 ×7/)
  assert.match(html, /1\. 秋刀鱼罐头 ×1 \+ 高速修复材 ×3/)
  assert.match(html, /2\. 高速建造材 ×25/)
  assert.match(html, /二选一 · 限 2 次/)
  assert.match(html, /秋刀魚カレー改二偵<\/b> · 秋刀鱼 ×27/)
  assert.match(html, /1\. 工厂资源 ×6 \+ 12\.7cm连装炮D型改三 ×1/)
  assert.match(html, /2\. 格纳库增设 ×6 \+ 熟练见张员★max ×4/)
  assert.match(html, /二选一 · 限 1 次/)
  // 没有改修等级的奖励不带星
  assert.doesNotMatch(html, /12\.7cm连装炮D型改三★/)
})

// ---- 季节账本：目录登记前已开的窗口 ----

const master = {
  api_mst_useitem: USEITEM_MST.map((u) => ({ api_id: u.id, api_name: u.name })),
  api_mst_slotitem: SLOTITEM_MST.map((s) => ({ api_id: s.id, api_name: s.name })),
}
const openLedger = (t) => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, path TEXT, body TEXT, post_body TEXT);
    CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
    CREATE TABLE IF NOT EXISTS useitem_log(ts INTEGER, item_id INTEGER, delta INTEGER, total INTEGER, cause TEXT);
    CREATE TABLE IF NOT EXISTS event_archive(area_id INTEGER PRIMARY KEY, opened INTEGER, closed INTEGER, stats TEXT);
    CREATE TABLE IF NOT EXISTS material_log(ts INTEGER); CREATE TABLE IF NOT EXISTS material_delta(ts INTEGER);
    CREATE TABLE IF NOT EXISTS battle_snapshots(ts INTEGER); CREATE TABLE IF NOT EXISTS notify_log(ts INTEGER);`)
  const book = new SeasonalLedger(db, (no) => `中文任务 ${no}`)
  book.setMaster(master)
  t.after(() => db.close())
  return { db, book }
}
const questList = (ts, no, title) => ({
  ts, path: '/kcsapi/api_get_member/questlist', post: { api_tab_id: '0' },
  body: { api_data: { api_list: [{ api_no: no, api_title: title, api_detail: '' }] } },
})
const sanmaRows = (db) => db
  .prepare("SELECT campaign, opened, expires_at, item_id, name, closed FROM seasonal_archive WHERE campaign = 'sanma' ORDER BY opened")
  .all()
  .map((row) => ({ ...row }))

test('目录登记前旧版已开的无期限窗口：并入目录那一季（起点与期限跟目录），不另开第二行', async (t) => {
  const { db, book } = openLedger(t)
  await book.startBackfill()
  // 旧版在 11-24 维护后看到秋刀鱼任务时写下的那一行：起点是看到的时刻，没有期限。
  const seenAt = jst('2026-11-24T20:32')
  db.prepare('INSERT INTO seasonal_archive(campaign, opened, expires_at, item_id, name) VALUES (?, ?, ?, ?, ?)')
    .run('sanma', seenAt, null, 68, '2026 秋刀鱼')
  const now = jst('2026-11-25T16:00')
  book.observe(questList(now, 2, '秋刀鱼任务'))
  assert.deepEqual(sanmaRows(db), [{
    campaign: 'sanma',
    opened: jst('2026-11-24T00:00'),
    expires_at: jst('2027-01-01T00:00'),
    item_id: 68,
    name: '2026 秋刀鱼',
    closed: null,
  }])
  // 铎按「目录起点＝窗口起点」认本季记录，这一行要对得上。
  const current = book.current({}, now)
  assert.equal(current.length, 1)
  assert.equal(current[0].key, 'sanma')
  assert.equal(current[0].opened, jst('2026-11-24T00:00'))
})

test('旧窗口起点不在目录有效期内就不动它，目录那一季照常另开', async (t) => {
  const { db, book } = openLedger(t)
  await book.startBackfill()
  const before = jst('2026-10-14T00:00')
  db.prepare('INSERT INTO seasonal_archive(campaign, opened, expires_at, item_id, name) VALUES (?, ?, ?, ?, ?)')
    .run('sanma', before, null, 68, '2026 秋刀鱼')
  book.observe(questList(jst('2026-11-25T16:00'), 2, '秋刀鱼任务'))
  assert.deepEqual(sanmaRows(db).map((row) => [row.opened, row.expires_at]), [
    [before, null],
    [jst('2026-11-24T00:00'), jst('2027-01-01T00:00')],
  ])
})

test('已有期限的窗口不被改写；同一季重复观测不重复开行', async (t) => {
  const { db, book } = openLedger(t)
  await book.startBackfill()
  book.observe(questList(jst('2026-11-25T16:00'), 2, '秋刀鱼任务'))
  book.observe(questList(jst('2026-11-26T09:00'), 2, '秋刀鱼任务'))
  assert.deepEqual(sanmaRows(db).map((row) => [row.opened, row.expires_at]), [
    [jst('2026-11-24T00:00'), jst('2027-01-01T00:00')],
  ])
})
