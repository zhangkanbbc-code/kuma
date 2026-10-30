// 维护者裁决 2026-10-30：卡底往期奖励、共享拼法与按版本取数。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { plainHtml } from '../scripts/lib/player-view-runtime.mjs'
import { clock, cut, dom, evaluate, makeKernel } from './fixtures/zi-refresh-runtime.mjs'
import { rewardHost, esc, elink } from './fixtures/senka-reward-runtime.mjs'
import { incentiveData, incentiveTs, equipNameOf } from './fixtures/incentive-20261030.mjs'

const host = rewardHost()
const time = host.load('src/shared/senka.ts')
const ranking = host.load('src/shared/senka-ranking.ts')
const views = host.load('src/renderer/senka-ranking-view.ts')
const zi = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
const monthStart = month => time.senkaMonthStart(Date.parse(`${month}-15T12:00:00+09:00`))
const SEP = monthStart('2026-09'), AUG = monthStart('2026-08')
const receipts = ranking.incentiveItems(incentiveData).map(item => ({ ...item, ts: incentiveTs }))
const months = () => [
  { monthStart: AUG, rewards: [
    { kind: 'equip', itemId: 22, name: '零式艦戦22型(251空)', level: 5, count: 1 },
    { kind: 'item', itemId: 57, name: '勋章', count: 2 },
  ] },
  { monthStart: SEP, rewards: [], rewardReceipts: ranking.rankingRewardReceipts(receipts, equipNameOf)[SEP] },
]
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

const card = (query = async () => ({ months: months() })) => {
  const documentDom = dom(), timer = clock(incentiveTs)
  // 最小 DOM 补上 details；展开保位仍执行生产 kernel。
  const descriptor = Object.getOwnPropertyDescriptor(documentDom.Element.prototype, 'innerHTML')
  Object.defineProperty(documentDom.Element.prototype, 'innerHTML', { ...descriptor, set(html) {
    descriptor.set.call(this, html)
    for (const match of html.matchAll(/<details[^>]*data-keep="([^"]+)"[^>]*>/g)) {
      const details = this.appendChild(new documentDom.Element('DETAILS', 'senka-rewards', { keep: match[1] }))
      details.open = false
    }
    if (html.includes('data-act="senka-more"')) this.appendChild(new documentDom.Element('DIV', 'senka-more', { act: 'senka-more' }))
  } })
  const kernel = makeKernel(documentDom, timer)
  const pane = new documentDom.Element('DIV')
  pane.classList = { contains: () => true }
  const warnings = []
  const api = evaluate([
    'let senkaRanking = { historyKey: "one" }, senkaRankingFailedAt = 0, senkaOpen = false;',
    'let senkaRewardsHtml = "", senkaRewardsAttempt, senkaRewardsRequest = 0;',
    cut(zi, 'const senkaHtml =', '// ---- 战果详情弹窗'),
    cut(zi, 'const render = (force', 'const renderPassiveChange ='),
  ].join('\n'), {
    ...time, ...views, ...documentDom, ...timer, ...kernel, esc, elink, pane,
    senka: { monthStart: monthStart('2026-10'), total: 10, normal: 10, special: 0,
      entries: Array.from({ length: 7 }, () => ({ ts: incentiveTs, kind: 'exp', expDelta: 1, senka: 1 })) },
    querySenkaRewards: query, deferPassive: (_pane, _key, run) => run(),
    console: { warn: (...args) => warnings.push(args) },
    materialCues: () => new Map(), loadError: null, TILE_ORDER: [], BREAKDOWN_RES: [],
    breakdownHtml: () => '', activityLedgerHtml: () => '', targetsHtml: () => '', strategicHtml: () => '',
    readinessCardHtml: () => '', eventMapsPresent: false, readinessHtml: () => '', syncTileGlow() {},
  }, `return { render, senkaHtml, refreshSenkaRewards,
    version(key) { senkaRanking = { historyKey: key } },
    state() { return { senkaRewardsAttempt, senkaRewardsHtml } }
  }`)
  return { ...api, ...documentDom, pane, timer, warnings }
}

test('卡底默认收起，两月倒序、共享奖励文字/title/装备链接，重画保留展开', async () => {
  let calls = 0
  const env = card(async () => {
    const data = months()
    data[0].rewards[1].count += calls++
    return { months: [...data, { monthStart: monthStart('2026-07'), rewards: [] }] }
  })
  env.render(); await settle()
  const html = env.pane.innerHTML
  const section = env.state().senkaRewardsHtml
  assert.match(section, /^<details class="senka-rewards" data-keep="senka-rewards">/)
  assert.match(section, /<summary class="senka-more">往期奖励（2）<\/summary>/)
  assert.ok(html.indexOf('data-act="senka-more"') < html.indexOf('data-keep="senka-rewards"'))
  assert.ok(section.indexOf('2026年9月') < section.indexOf('2026年8月'))
  assert.match(plainHtml(section), /2026年9月 · 三群（101～500位）：流星改\(熟練\)、XF6F-6★\+1/)
  assert.match(plainHtml(section), /2026年8月 · 疑似：零式艦戦22型\(251空\)★\+5×1、勋章×2/)
  const expectedTitle = '战果月交界后到下一次交界之间来路不明的道具与新装备，尚未与游戏报文核对'
  assert.ok(section.includes(`title="${expectedTitle}"`))
  for (const id of [466, 589, 22]) assert.ok(section.includes(`data-etype="mstEquip" data-eid="${id}"`))
  assert.doesNotMatch(section, /data-eid="57"/)
  for (const month of months()) {
    const history = views.senkaRankingHtml({ ...ranking.failedSenkaRanking(1), history: [
      { ...month, own: null, lines: { 5: null, 20: null, 100: null, 500: null }, undecoded: 0 },
    ] })
    const row = /<div class="sd-rank-rewards"[^>]*>.*?<\/div>/.exec(history)[0]
    assert.equal(row, views.senkaRankingRewardHtml(month))
    const cardRow = views.senkaRankingRewardHtml(month, true)
    assert.equal(plainHtml(cardRow).split(' · ').slice(1).join(' · ').replace(/^疑似：/, ''),
      plainHtml(row).replace(/^排行奖励 · |^疑似排行奖励：/, ''))
    if (month.monthStart === AUG) assert.ok(row.includes(`title="${expectedTitle}"`))
  }
  const detail = env.pane.querySelector('[data-keep="senka-rewards"]')
  assert.equal(detail.open, false)
  detail.open = true
  // 同版本「展开全部」以及新版本奖励内容变化都走生产 render/commitPaneHtml。
  const writes = env.pane.writes
  env.pane.querySelector('[data-act="senka-more"]').emit('click')
  env.timer.advance(0)
  assert.ok(env.pane.writes > writes)
  assert.equal(env.pane.querySelector('[data-keep="senka-rewards"]').open, true)
  env.version('two'); env.render(); await settle(); env.timer.advance(0)
  assert.match(env.pane.innerHTML, /勋章×3/)
  assert.equal(env.pane.querySelector('[data-keep="senka-rewards"]').open, true)
})

test('没有奖励月份时整节不出现；只有空月份也不计数', async () => {
  for (const data of [[], [{ monthStart: SEP, rewards: [], rewardReceipts: [] }]]) {
    const env = card(async () => ({ months: data }))
    env.render(); await settle()
    assert.doesNotMatch(env.senkaHtml(), /往期奖励|senka-rewards/)
  }
})

test('成功/返回失败/抛错均按版本请求一次，变化才重拉，失败隐藏且不影响战果卡', async () => {
  for (const failure of ['return', 'throw']) {
    let calls = 0, fail = false
    const env = card(async () => {
      calls++
      if (fail && failure === 'throw') throw new Error('奖励失败')
      return fail ? { months: [], failedAt: incentiveTs } : { months: months() }
    })
    env.render(); env.render(); await settle(); env.render()
    assert.equal(calls, 1)
    assert.match(env.senkaHtml(), /往期奖励（2）/)
    fail = true; env.version('two'); env.render(); await settle()
    for (let i = 0; i < 4; i++) env.render()
    assert.equal(calls, 2)
    assert.equal(env.state().senkaRewardsAttempt, 'two')
    assert.doesNotMatch(env.senkaHtml(), /往期奖励/)
    assert.match(env.senkaHtml(), /class="senka-sum"/)
    assert.equal(env.warnings.length, failure === 'throw' ? 1 : 0)
    fail = false; env.version('three'); env.render(); await settle()
    assert.equal(calls, 3)
    assert.match(env.senkaHtml(), /往期奖励（2）/)
  }
})

test('旧版本请求迟到时不能覆盖新版本奖励', async () => {
  const pending = []
  const env = card(() => new Promise(resolve => pending.push(resolve)))
  env.render(); env.version('two'); env.render()
  pending[1]({ months: months() }); await settle()
  pending[0]({ months: [] }); await settle()
  assert.match(env.senkaHtml(), /往期奖励（2）/)
})

test('奖励专用 IPC 复用归月/候选算法，常规刷新零奖励计算，奖励请求零排行页解析', () => {
  const handlers = new Map(), warnings = []
  let rewardCalls = 0, historyCalls = 0, currentCalls = 0, bad = false
  evaluate(cut(main, "ipcMain.handle('mg:senka-ranking'", "ipcMain.handle('mg:senka',"), {
    ...time, ...ranking,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    querySenkaRanking: () => { currentCalls++; return {} }, rankingFailure: null,
    rankingOwnHintAt: () => () => 0,
    store: { getState: () => ({ player: { basic: {} }, master: { slotitems: {
      466: { name: equipNameOf(466) }, 589: { name: equipNameOf(589) },
    } } }) },
    ensureMasterRaw: () => ({ data: { api_mst_useitem: [{ api_id: 57, api_name: '勋章' }] } }),
    ledger: {
      queryRankingPages: () => { historyCalls++; return [] }, earliestEventTs: () => AUG,
      latestEquipSyncBefore: () => null, querySlotitemSeen: () => [], queryEquipSyncTs: () => [], queryLateEquipEventTs: () => [],
      queryIncentiveReceipts: () => receipts,
      queryRankingRewardRows: () => {
        rewardCalls++; if (bad) throw new Error('奖励失败')
        return [ { ts: monthStart('2026-09'), item_id: 57, delta: 2, cause: null },
          { ts: monthStart('2026-10'), item_id: 57, delta: 3, cause: null } ]
      },
    }, console: { warn: (...args) => warnings.push(args) },
  }, '')
  const handler = handlers.get('mg:senka-ranking')
  for (let i = 0; i < 4; i++) handler({}, incentiveTs)
  assert.equal(rewardCalls, 0)
  assert.equal(historyCalls, 0)
  const result = handler({}, incentiveTs, { rewards: true })
  assert.equal(currentCalls, 4)
  assert.equal(historyCalls, 0)
  assert.deepEqual(result.months.map(month => month.monthStart), [SEP, AUG])
  assert.equal(result.months[0].rewardReceipts.length, 2)
  assert.deepEqual(result.months[0].rewards, [])
  assert.equal(result.months[1].rewards[0].count, 2)
  const history = handler({}, incentiveTs, { history: true })
  assert.equal(historyCalls, 1)
  assert.deepEqual(history.history.map(({ monthStart, rewards, rewardReceipts }) => ({ monthStart, rewards, rewardReceipts })), result.months)
  bad = true
  assert.ok(handler({}, incentiveTs, { rewards: true }).failedAt)
  assert.equal(warnings.length, 1)
})

test('kernel 奖励调用只传 rewards 旗标，往月调用仍传 history', async () => {
  const calls = []
  const api = host.extract('src/renderer/kernel.ts', ['querySenkaRewards', 'querySenkaRanking'], {
    ipcRenderer: { invoke: async (...args) => { calls.push(args); return {} } },
  }).api
  await api.querySenkaRewards()
  await api.querySenkaRanking(undefined, { history: true })
  assert.deepEqual(calls, [
    ['mg:senka-ranking', undefined, { rewards: true }],
    ['mg:senka-ranking', undefined, { history: true }],
  ])
})
