// 改修日程的游戏实测（维护者 2026-11-28 定：「让 kuma 从游戏里面学并直接折叠掉实测出来无法改修的」）。
// 他实测周六村雨改二、夕云改二、日向改二当二号舰都改不了 22 号对水上电探，资料（舰百、akashi-list）却都说能；
// 游戏下发的改修清单（remodel_slotlist）就是「旗舰明石 + 这艘二号舰今天能改的全部」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { expandedOf, foldedOf, todayGroupsHtml, todayRows } from './fixtures/render-today-improve.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const obs = require(path.join(ROOT, 'dist/shared/improve-observed.js'))
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lodes/equip-improve.json'), 'utf8')).data
const SAT = 6
const AKASHI = 182
const MURASAME_K2 = 498

test('随包事实表确实说周六村雨改二能改 22 号对水上电探（这条测试钉住「资料过时」这一前提，事实表刷新改对了就该改这里）', () => {
  const entry = table.find((e) => e.eq_id === 28)
  assert.ok(entry.improvement.some((imp) => imp.helpers.some((h) => h.ship_ids.includes(MURASAME_K2) && h.days.includes(SAT))))
})

test('维护者实测垫底：周六村雨改二、夕云改二、日向改二改不了 22 号；村雨改二周六能改 61cm 四连装鱼雷', () => {
  const facts = obs.improveFactsOf([], table)
  for (const helper of [498, 542, 554]) {
    const fact = facts.get(obs.improveFactKey(28, helper, SAT))
    assert.equal(fact.ok, false)
    assert.equal(fact.source, 'maintainer')
  }
  assert.equal(facts.get(obs.improveFactKey(13, MURASAME_K2, SAT)).ok, true)
})

test('游戏清单倒推：资料说能、清单里没有 → 实测不可；清单里有 → 实测可（资料没写的也算）', () => {
  // 他 11-28 截图：旗舰明石、二号舰村雨改二，周六清单 12.7cm連装砲C型改二 / 25mm三連装機銃 / 61cm四連装魚雷
  const ts = Date.parse('2026-11-28T16:50:00+09:00')
  const facts = obs.improveFactsOf([{ ts, day: SAT, flagship: AKASHI, helper: MURASAME_K2, items: [266, 40, 13] }], table, [])
  assert.equal(facts.get(obs.improveFactKey(28, MURASAME_K2, SAT)).ok, false, '22 号不在清单里')
  assert.equal(facts.get(obs.improveFactKey(28, MURASAME_K2, SAT)).source, 'game')
  for (const eq of [266, 40, 13]) assert.equal(facts.get(obs.improveFactKey(eq, MURASAME_K2, SAT)).ok, true)
  assert.equal(facts.get(obs.improveFactKey(28, MURASAME_K2, 0)), undefined, '只说周六，不推别的星期')
  assert.equal(facts.get(obs.improveFactKey(28, 542, SAT))?.source ?? null, null, '只说这艘二号舰')
})

test('只认旗舰是明石的清单；同一艘二号舰同一个星期取最近一次；比维护者那条旧的不盖过去', () => {
  const day = (iso) => Date.parse(iso)
  const notAkashi = obs.improveFactsOf([{ ts: day('2026-11-28T10:00:00+09:00'), day: SAT, flagship: 1, helper: MURASAME_K2, items: [] }], table, [])
  assert.equal(notAkashi.size, 0, '旗舰不是明石，清单不作数')
  const two = obs.improveFactsOf(
    [
      { ts: day('2026-11-21T10:00:00+09:00'), day: SAT, flagship: AKASHI, helper: MURASAME_K2, items: [28, 40, 266] },
      { ts: day('2026-11-28T10:00:00+09:00'), day: SAT, flagship: 187, helper: MURASAME_K2, items: [266, 40, 13] },
    ],
    table,
    [],
  )
  assert.equal(two.get(obs.improveFactKey(28, MURASAME_K2, SAT)).ok, false, '最近一次（明石改当旗舰）说没有')
  const stale = obs.improveFactsOf([{ ts: day('2026-11-21T10:00:00+09:00'), day: SAT, flagship: AKASHI, helper: MURASAME_K2, items: [28, 40, 266] }], table)
  assert.equal(stale.get(obs.improveFactKey(28, MURASAME_K2, SAT)).source, 'maintainer', '本机那次比维护者实测早，不盖')
})

test('修正名单：实测不可的去掉、实测可而资料没写的补上；全被否掉就是空名单', () => {
  const facts = obs.improveFactsOf([], table)
  const r = obs.applyImproveFacts(28, SAT, [87, 498, 542, 554, 674], facts)
  assert.deepEqual(r.helpers, [87, 674])
  assert.deepEqual(r.removed.map((f) => f.helper), [498, 542, 554])
  const torp = obs.applyImproveFacts(13, SAT, [], facts)
  assert.deepEqual(torp.helpers, [MURASAME_K2])
  assert.deepEqual(obs.applyImproveFacts(28, SAT, [498, 542], facts).helpers, [], '全被否掉')
})

test('编队与图鉴：只读游戏已下发的改修清单，记下旗舰与二号舰；今日改修把全被否掉的方案折叠到页底', () => {
  const store = fs.readFileSync(path.join(ROOT, 'src/main/mg/store.ts'), 'utf8')
  const reducer = store.slice(store.indexOf("'/kcsapi/api_req_kousyou/remodel_slotlist': (body, _post, ts) => {"), store.indexOf("'/kcsapi/api_req_kousyou/remodel_slot': (body, post, ts) => {"))
  assert.match(reducer, /ledger\.observeImproveList\(\s*ts,\s*improveObservationDay\(ts\),\s*mstOf\(deck\?\.ships\?\.\[0\]\),\s*mstOf\(deck\?\.ships\?\.\[1\]\),/)
  assert.doesNotMatch(reducer, /fetch|request|invoke|send\(/, '不发任何请求')
  const index = fs.readFileSync(path.join(ROOT, 'src/main/mg/index.ts'), 'utf8')
  assert.match(index, /if \(apiPath === '\/kcsapi\/api_req_kousyou\/remodel_slotlist' \|\| apiPath === '\/kcsapi\/api_req_kousyou\/remodel_slot'\) broadcastImproveObserved\(\)/)
  const ji = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ji.ts'), 'utf8')
  assert.match(ji, /const observedOut = !noHelperNeeded && keptIds\.length \+ added\.length === 0/)
  assert.match(ji, /const rows = allRows\.filter\(\(row\) => !row\.observedOut\)\s*\n\s*const out = allRows\.filter\(\(row\) => row\.observedOut\)/)
  assert.match(ji, /<details class="today-observed-out"><summary[^>]*>实测今日不可 <i>/, '默认合上的折叠')
  const retention = fs.readFileSync(path.join(ROOT, 'src/shared/ledger-retention.ts'), 'utf8')
  assert.match(retention, /'improve_observations',/, '实测是永久表')
})

// ---- 账本：observeImproveList / queryImproveObservations 原样切出来跑真 SQL ----
const ledgerSource = fs.readFileSync(path.join(ROOT, 'src/main/mg/ledger.ts'), 'utf8').replace(/\r\n/g, '\n')
const cutFrom = ledgerSource.indexOf('  observeImproveList = ')
const cutTo = ledgerSource.indexOf('  // ---- 海域配曲留存 ----', cutFrom)
const tableFrom = ledgerSource.indexOf('      CREATE TABLE IF NOT EXISTS improve_observations (')
const tableTo = ledgerSource.indexOf(');', tableFrom) + 2
assert.ok(cutFrom >= 0 && cutTo > cutFrom && tableFrom >= 0, 'ledger.ts 的改修实测锚点要跟着改')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-improve-obs-'))
const outfile = path.join(dir, 'q.cjs')
buildSync({
  stdin: { contents: `class Q {\n  constructor(public db: any) {}\n${ledgerSource.slice(cutFrom, cutTo)}\n}\nexport const make = (db: any) => new Q(db)\n`, loader: 'ts', resolveDir: ROOT },
  outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const { make } = createRequire(import.meta.url)(outfile)
fs.rmSync(dir, { recursive: true, force: true })

test('账本：同一艘二号舰同一天一模一样的清单只刷新时间；换了内容另记一条；查出来新到旧', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(ledgerSource.slice(tableFrom, tableTo).replace(/--[^\n]*/g, ''))
  const q = make(db)
  const t0 = Date.parse('2026-11-28T16:50:00+09:00')
  const torp = { id: 13, fuel: 70, bull: 100, steel: 70, baux: 20, devmats: 1, screws: 1 }
  q.observeImproveList(t0, SAT, AKASHI, MURASAME_K2, [13, 40, 266, 40])
  q.observeImproveList(t0 + 60e3, SAT, AKASHI, MURASAME_K2, [266, 13, 40], [torp])
  let rows = q.queryImproveObservations()
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { ts: t0 + 60e3, day: SAT, flagship: AKASHI, helper: MURASAME_K2, items: [13, 40, 266], detail: [torp] }, '重复的那次补上消耗')
  q.observeImproveList(t0 + 120e3, SAT, AKASHI, 542, [40])
  q.observeImproveList(t0 + 180e3, SAT, AKASHI, null, [])
  rows = q.queryImproveObservations()
  assert.deepEqual(rows.map((r) => r.helper), [null, 542, MURASAME_K2])
})

// ---- 今日改修的真渲染（夹具原样切出 todayImprovementRows / todayImprovementGroupsHtml）----
const 账本 = (eo, facts) => ({
  day: SAT,
  facts,
  equips: {
    28: { api_id: 28, api_name: '22号対水上電探', api_type: [5, 8, 12, 11] },
    90: { api_id: 90, api_name: '试验电探', api_type: [5, 8, 12, 11] },
  },
  equipTypes: { 12: '小型电探' },
  shipMst: { 182: { api_id: 182, api_name: '明石' }, 498: { api_id: 498, api_name: '村雨改二' }, 50: { api_id: 50, api_name: '島風' } },
  eo,
  mg: {
    ships: {
      1: { id: 1, shipId: 182, lv: 60, slot: [-1, -1, -1, -1], slotEx: 0 },
      2: { id: 2, shipId: MURASAME_K2, lv: 83, slot: [-1, -1, -1, -1], slotEx: 0 },
    },
    slotitems: {
      101: { mstId: 28, level: 2, alv: 0, locked: false },
      102: { mstId: 28, level: 0, alv: 0, locked: false },
      201: { mstId: 90, level: 0, alv: 0, locked: false },
    },
    decks: [{ id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] }],
    materials: { 0: 9999, 1: 9999, 2: 9999, 3: 9999, 6: 9999, 7: 9999 },
  },
})
const costs = { fuel: 10, ammo: 0, steel: 30, baux: 30, p1: { devmats: 4, devmats_sli: 5, screws: 2, screws_sli: 3, equips: [{ id: 28, eq_count: 1 }] } }

test('今日改修（真渲染）：周六村雨改二被实测否掉、还有别的二号舰 → 不再写「今日可改修」，改成需换二号舰，展开层写明谁实测不可', () => {
  const eo = [{ eq_id: 28, improvement: [{ helpers: [{ ship_ids: [498, 50], days: [SAT] }], costs }] }]
  const before = todayRows(账本(eo, new Map()))
  assert.equal(before[0].ready, true, '没有实测时照资料：村雨改二今天能改')
  const facts = obs.improveFactsOf([], table)
  const [row] = todayRows(账本(eo, facts))
  assert.equal(row.ready, false)
  assert.equal(row.observedOut, false, '島風还在，不折叠')
  assert.match(foldedOf(row.html), /需换二号舰/)
  assert.match(expandedOf(row.html), /实测今日不可 <a class="el" data-mstShip="498">村雨改二<\/a><i>（维护者实测 11-28）<\/i>/)
})

test('今日改修（真渲染）：今天的二号舰全被实测否掉 → 收进页底默认合上的「实测今日不可」，不进类别组也不算进方案数', () => {
  const eo = [
    { eq_id: 28, improvement: [{ helpers: [{ ship_ids: [498], days: [SAT] }], costs }] },
    { eq_id: 90, improvement: [{ helpers: [{ ship_ids: [498], days: [SAT] }], costs: { ...costs, p1: { ...costs.p1, equips: [] } } }] },
  ]
  const setup = 账本(eo, obs.improveFactsOf([], table))
  const rows = todayRows(setup)
  assert.equal(rows.find((r) => r.equipId === 90).observedOut, false, '另一件照常')
  assert.equal(rows.find((r) => r.equipId === 28).observedOut, true)
  assert.match(foldedOf(rows.find((r) => r.equipId === 28).html), /实测今日不可/)
  const html = todayGroupsHtml(setup)
  const fold = html.slice(html.indexOf('<details class="today-observed-out">'))
  assert.ok(html.indexOf('<details class="today-observed-out">') > html.indexOf('data-equip="90"'), '折叠在页底')
  assert.match(fold, /^<details class="today-observed-out"><summary[^>]*>实测今日不可 <i>1<\/i><\/summary>/, '默认合上（没有 open）')
  assert.match(fold, /data-equip="28"/)
  assert.doesNotMatch(html.slice(0, html.indexOf('<details class="today-observed-out">')), /data-equip="28"/, '类别组里不再列它')
})

test('今日改修（真渲染）：实测可而资料没写的补上——资料里周六没有村雨改二，游戏清单里有，就照样列出来并标实测', () => {
  const eo = [{ eq_id: 28, improvement: [{ helpers: [{ ship_ids: [50], days: [4] }], costs }] }]
  const facts = obs.improveFactsOf([{ ts: Date.parse('2026-11-29T10:00:00+09:00'), day: SAT, flagship: AKASHI, helper: MURASAME_K2, items: [28] }], [], [])
  const [row] = todayRows(账本(eo, facts))
  assert.ok(row, '资料说今天不开，实测可就列出来')
  assert.equal(row.ready, true)
  assert.match(foldedOf(row.html), /村雨改二<\/a> ✓ <span class="ti-observed"[^>]*>实测<\/span>/)
  assert.match(expandedOf(row.html), /实测今日可/)
})

test('新装备：资料完全没收录、游戏今天的清单里有 → 照清单给的消耗自动新增一行，二号舰是清单当时那艘，挂实测', () => {
  const pl = { id: 585, fuel: 30, bull: 10, steel: 0, baux: 20, devmats: 2, screws: 1 }
  const facts = obs.improveFactsOf([{ ts: Date.parse('2026-11-28T16:50:00+09:00'), day: SAT, flagship: AKASHI, helper: MURASAME_K2, items: [585], detail: [pl] }], table, [])
  assert.deepEqual(facts.get(obs.improveFactKey(585, MURASAME_K2, SAT)).cost, pl, '清单的消耗进结论')
  const setup = 账本([], facts)
  setup.equips[585] = { api_id: 585, api_name: 'PL101(偵察)', api_type: [5, 7, 9, 9, 63] }
  setup.mg.slotitems[401] = { mstId: 585, level: 0, alv: 0, locked: false }
  const [row] = todayRows(setup).filter((r) => r.equipId === 585)
  assert.ok(row, '自动新增')
  assert.equal(row.ready, true, '明石旗舰、村雨改二在二号位、资源够')
  assert.match(foldedOf(row.html), /村雨改二<\/a> ✓ <span class="ti-observed"[^>]*>实测<\/span>/)
  assert.match(foldedOf(row.html), /开发<\/a> 2 · <a class="el" data-material="7">改修<\/a> 1/)
  assert.match(expandedOf(row.html), /资料未收录这件的改修 · 游戏清单里今天有/)
  assert.match(expandedOf(row.html), /素材 <span class="dim">资料未收录<\/span>/)
  // 换个星期：清单只说周六
  assert.equal(todayRows({ ...setup, day: 5 }).some((r) => r.equipId === 585), false)
  // 资源不够：照实说缺
  const poor = 账本([], facts)
  poor.equips[585] = setup.equips[585]
  poor.mg.slotitems[401] = setup.mg.slotitems[401]
  poor.mg.materials = { ...poor.mg.materials, 6: 1 }
  const [short] = todayRows(poor).filter((r) => r.equipId === 585)
  assert.equal(short.ready, false)
  assert.deepEqual(short.missing, ['开发资材缺 1'])
})

test('装备详情（真渲染）：二号舰周历跟着实测——周六实测不可的村雨改二、夕云改二、日向改二单拆一行、星期六划掉，其余照资料', async () => {
  const { improveCardHtml } = await import('./fixtures/render-improve-card.mjs')
  const entry = table.find((e) => e.eq_id === 28)
  const names = { 498: '村雨改二', 542: '夕雲改二', 554: '日向改二', 88: '日向改' }
  const html = improveCardHtml({
    eo: entry,
    day: SAT,
    equip: { api_id: 28, api_name: '22号対水上電探' },
    ships: Object.fromEntries(Object.entries(names).map(([id, api_name]) => [id, { api_name }])),
    facts: obs.improveFactsOf([], table),
  })
  const rowOf = (shipId) => html.split('<div class="ak-row">').find((part) => part.includes(`data-mstShip="${shipId}"`)) ?? ''
  const murasame = rowOf(498)
  assert.match(murasame, /<span class="day out" title="星期六 · 实测不可（维护者实测 11-28）">六<\/span>/)
  assert.match(murasame, /<span class="ti-observed" title="村雨改二 星期六实测不可（维护者实测 11-28）">实测<\/span>/)
  assert.doesNotMatch(murasame, /class="day on"[^>]*>六</, '周六不再亮')
  const hyuga = rowOf(88)
  assert.ok(hyuga && !/data-mstShip="554"/.test(hyuga), '日向改二从日向改那一行拆出来')
  assert.match(hyuga, /<span class="day on" title="星期六">六<\/span>/, '日向改照资料周六能改')
  assert.doesNotMatch(hyuga, /ti-observed/)
})
