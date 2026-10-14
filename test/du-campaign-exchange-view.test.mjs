import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'

import campaign from '../dist/shared/seasonal-campaign.js'
import historyHtml from '../dist/shared/seasonal-history-html.js'

const { detectSeasonalCampaigns } = campaign
// 使用另设的 id，奖励名须经解析与本地化，不能靠写死 id 或日文奖励名。
const useitemMst = [
  { id: 1001, name: '南瓜' },
  { id: 1002, name: '改修資材' },
  { id: 1003, name: '開発資材' },
  { id: 1004, name: '改装設計図' },
]
const slotitemMst = [
  { id: 2001, name: '二式大艇' },
  { id: 2002, name: '二式陸上偵察機(熟練)' },
  { id: 2003, name: '熟練甲板要員+航空整備員' },
]
const zhNames = {
  item: { 1002: '改修材料', 1003: '开发材料', 1004: '改装设计图' },
  equip: { 2001: '二式大艇', 2002: '二式陆上侦察机(熟练)', 2003: '熟练甲板人员+航空整备员' },
}
const du = readFileSync(new URL('../src/renderer/modules/du.ts', import.meta.url), 'utf8')
const a = du.indexOf('const CAMPAIGN_PERIOD_ORDER'), b = du.indexOf('const render = () =>', a)
assert.ok(a >= 0 && b > a, '缺少季节企划视图段')
const context = vm.createContext({
  campaignHistory: [],
  campaignSummaryHtml: historyHtml.campaignSummaryHtml,
  campaignRecordsHtml: historyHtml.campaignRecordsHtml,
  fmtDateTime: () => '2026-10-15 12:00',
  mg: {
    quests: {}, useitemsTs: null,
    master: { slotitems: Object.fromEntries(slotitemMst.map((item) => [item.id, item])) },
  },
  useitemMst,
  entityNamePlain: (domain, id, jpName) => {
    const mst = domain === 'item' ? useitemMst : slotitemMst
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

const render = (stock, now = Date.parse('2026-10-15T00:00:00+09:00')) => context.view(detectSeasonalCampaigns({
  useitemMst, slotitemMst, useitems: { 1001: stock }, quests: [], now,
}))

test('真实记录进入本季卡；已领 Party 按记录显示选项日期，不再报持有差额', () => {
  const receipt = { ts: Date.parse('2026-10-15T12:00:00+09:00'), recipe: 'party', exchangeType: null, cost: 14, rewards: [{ kind: 'useitem', id: 1004, count: 4 }] }
  context.campaignHistory = [{ key: 'pumpkin', opened: Date.parse('2026-10-14T00:00:00+09:00'), gained: 14, spent: 14, stock: 0,
    sources: [{ no: 984, title: '任务984', count: 14, times: 1 }], uses: [{ recipe: 'party', count: 14, times: 1 }],
    receipts: [receipt], rewards: receipt.rewards, party: [receipt], quests: [], otherUses: [] }]
  try {
    const output = context.view(detectSeasonalCampaigns({ useitemMst, slotitemMst, useitems: {}, quests: [],
      now: receipt.ts, recordedKeys: ['pumpkin'] }))
    assert.match(output, /本季记录/)
    assert.match(output, /<div class="cq-row"><b>获得 14 · 花掉 14 · 现有 0<\/b><\/div>/)
    assert.match(output, /已领：改装设计图 ×4 · 2026-10-15 12:00/)
    assert.doesNotMatch(output, /还差 14 个/)
    assert.match(output, /兑换记录/)
  } finally { context.campaignHistory = [] }
})

test('本季合计突出，来源去向只列次数，任务名字与逐笔去向收进淡色明细', () => {
  const receipt = { ts: Date.parse('2026-10-15T12:00:00+09:00'), recipe: 'yokan', exchangeType: 110, cost: 3,
    rewards: [{ kind: 'material', id: 7, count: 6 }, { kind: 'material', id: 8, count: 4 }] }
  context.campaignHistory = [{ key: 'pumpkin', opened: Date.parse('2026-10-14T00:00:00+09:00'), gained: 5, spent: 3, stock: 2,
    sources: [{ no: 984, title: '秋日南瓜', count: 1, times: 1 }, { no: 359, title: 'Halloween艦隊 実りの秋、最新演習！', count: 1, times: 1 }, { no: 1119, title: '万圣节南瓜', count: 3, times: 1 }],
    uses: [{ recipe: 'yokan', count: 3, times: 1 }], receipts: [receipt], rewards: receipt.rewards, party: [], quests: [], otherUses: [] }]
  try {
    const output = render(2)
    assert.match(output, /<div class="cq-row"><b>获得 5 · 花掉 3 · 现有 2<\/b><\/div>/)
    assert.match(output, /<div class="gnote2">来源 任务 3 次<\/div>/)
    assert.match(output, /<div class="gnote2">去向 南瓜羊羹 1 次<\/div>/)
    const detail = output.slice(output.indexOf('data-keep="campaign:pumpkin:'))
    assert.match(detail, /#359 Halloween艦隊 実りの秋、最新演習！ · 得到 1 个/)
    assert.match(detail, /#1119 万圣节南瓜 · 得到 3 个/)
    assert.match(detail, /南瓜羊羹 · 花 3 个 · 开发资材 ×6 \+ 改修资材 ×4/)
    assert.match(output, /<div class="gnote2">兑换记录<\/div>/)
    assert.doesNotMatch(output, /次 \/ .*个|<b>兑换记录<\/b>/)
  } finally { context.campaignHistory = [] }
})

test('兑换区在持有数之下，显示游戏原名、消耗及中文奖励数量', () => {
  const html = render(7)
  assert.ok(html.indexOf('持有 <b>7</b>') < html.indexOf('>兑换<'))
  assert.match(html, /南瓜羊羹<\/b> · 南瓜 ×3/)
  assert.match(html, /Halloween Party 2026<\/b> · 南瓜 ×14/)
  assert.match(html, /改修材料 ×4 \+ 开发材料 ×6/)
  assert.match(html, /1\. 改装设计图 ×4/)
  assert.match(html, /2\. 二式大艇 ×1 \+ 二式陆上侦察机\(熟练\) ×2/)
  assert.match(html, /3\. 熟练甲板人员\+航空整备员 ×1/)
  assert.match(html, /三选一 · 限 1 次/)
  assert.match(html, /兑换目录来自游戏内菜单（2026-10-14）/)
  assert.match(html, /截止日期以游戏内公告为准/)
  assert.doesNotMatch(html, /期间限定|在途|一格/)
})

test('不限次按持有量向下取整，Party 不够时显示差额', () => {
  assert.match(render(7), /class="cq-chip on">够换 2 次<\/span>/)
  assert.match(render(7), /class="cq-chip">还差 7 个<\/span>/)
  assert.match(render(13), /class="cq-chip on">够换 4 次<\/span>/)
  assert.match(render(13), /class="cq-chip">还差 1 个<\/span>/)
  assert.doesNotMatch(render(13), /可以领/)
})

test('抬头同行显示状态，规则用次要小字，奖励在下方沿用淡色类', () => {
  const html = render(1)
  const headers = [...html.matchAll(/<div class="cq-row">([\s\S]*?)<\/div>/g)].map((m) => m[1])
  assert.equal(headers.length, 2)
  assert.match(headers[0], /^<span><b>南瓜羊羹<\/b> · 南瓜 ×3/)
  assert.match(headers[0], /<small class="gnote2">不限次数<\/small>/)
  assert.match(headers[0], /<span class="cq-chip">还差 2 个<\/span>$/)
  assert.match(headers[1], /<small class="gnote2">三选一 · 限 1 次<\/small>/)
  assert.match(headers[1], /<span class="cq-chip">还差 13 个<\/span>$/)
  assert.match(html, /<\/span><\/div>\s*<div class="gnote2"><div>改修材料 ×4 \+ 开发材料 ×6<\/div>/)
  assert.match(html, /<\/span><\/div>\s*<div class="gnote2"><div>1\. 改装设计图 ×4<\/div>/)
  for (const stock of [1, 2]) {
    assert.match(render(stock), new RegExp(`class="cq-chip">还差 ${3 - stock} 个<\\/span>`))
    assert.doesNotMatch(render(stock), /够换 0 次/)
  }
  assert.match(render(3), /class="cq-chip on">够换 1 次<\/span>/)
})

test('限次兑换按实际选项数量显示几选一', () => {
  for (const [count, label] of [[2, '二'], [3, '三'], [4, '四'], [10, '十'], [11, '11']]) {
    const active = detectSeasonalCampaigns({
      useitemMst, slotitemMst, useitems: { 1001: 14 }, quests: [],
      now: Date.parse('2026-10-15T00:00:00+09:00'),
    })
    const party = active[0].exchange.recipes.find((recipe) => recipe.key === 'party')
    party.choices = Array.from({ length: count }, (_, i) => party.choices[i % party.choices.length])
    const html = context.view(active)
    assert.ok(html.includes(`<small class="gnote2">${label}选一 · 限 1 次</small>`))
    if (count !== 3) assert.doesNotMatch(html, /三选一/)
  }
})

test('Party 刚够和超过消耗都可以领，羊羹次数照持有数计算', () => {
  for (const stock of [14, 15, 28]) {
    const html = render(stock)
    assert.match(html, /class="cq-chip on">可以领<\/span>/)
    assert.ok(html.includes(`class="cq-chip on">够换 ${Math.floor(stock / 3)} 次</span>`))
    assert.doesNotMatch(html, /还差/)
  }
})

test('目录到 JST 截止时隐藏，企划卡与持有数保留', () => {
  assert.match(render(14, Date.parse('2026-12-31T23:59:59.999+09:00')), />兑换</)
  for (const now of [Date.parse('2027-01-01T00:00:00+09:00'), Date.parse('2027-10-15T00:00:00+09:00')]) {
    const html = render(14, now)
    assert.match(html, /持有 <b>14<\/b>/)
    assert.doesNotMatch(html, />兑换<|南瓜羊羹|Halloween Party|可以领|还差/)
  }
})

test('任务点名而持有为零时仍展示目录与两道兑换的完整差额', () => {
  const active = detectSeasonalCampaigns({
    useitemMst, slotitemMst, useitems: {},
    quests: [{ no: 984, title: '南瓜収穫作戦' }],
    now: Date.parse('2026-10-15T00:00:00+09:00'),
  })
  const html = context.view(active)
  assert.match(html, /持有 <b>0<\/b>/)
  assert.match(html, /class="cq-chip">还差 3 个<\/span>/)
  assert.match(html, /class="cq-chip">还差 14 个<\/span>/)
  assert.doesNotMatch(html, /够换 0 次/)
})
