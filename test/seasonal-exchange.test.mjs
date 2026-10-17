// 季节企划的兑换目录（2026-10-14 维护者在游戏内打开南瓜兑换菜单截图，裁决在企划卡里加「兑换」一节）：
//   南瓜羊羹：南瓜 ×3 → 改修資材 ×4 + 開発資材 ×6，不限次数
//   Halloween Party 2026 · Party Gift：南瓜 ×14，今秋限 1 次、三选一
//     ① 改装設計図 ×4　② 二式大艇 ×1 + 二式陸上偵察機(熟練) ×2　③ 熟練甲板要員+航空整備員 ×1
// 兑换菜单不经服务器（打开菜单不发请求，只有道具画面的 payitem），所以目录随包写，来源是游戏内菜单截图。
// 沿用本模块的纪律：按精确日文名对主数据解析 id，绝不硬编码 id；任一项解析不到，那一道兑换整条不出。
// 目录只对当季有效：2026 年这份到 2027-01-01 00:00 JST 为止，明年南瓜回来时不能还显示今年的菜单。
import assert from 'node:assert/strict'
import test from 'node:test'

import campaign from '../dist/shared/seasonal-campaign.js'

const { detectSeasonalCampaigns } = campaign

const jst = (s) => Date.parse(`${s}+09:00`)
const USEITEM_MST = [
  { id: 3, name: '開発資材' },
  { id: 4, name: '改修資材' },
  { id: 58, name: '改装設計図' },
  { id: 96, name: '南瓜' },
]
const SLOTITEM_MST = [
  { id: 138, name: '二式大艇' },
  { id: 312, name: '二式陸上偵察機(熟練)' },
  { id: 478, name: '熟練甲板要員+航空整備員' },
]
const pumpkin = (over = {}) =>
  detectSeasonalCampaigns({
    useitemMst: USEITEM_MST,
    slotitemMst: SLOTITEM_MST,
    useitems: { 96: 7 },
    quests: [],
    now: jst('2026-10-15T00:00'),
    ...over,
  }).find((c) => c.key === 'pumpkin')

test('南瓜企划带上今年的兑换目录，名字解析成主数据 id', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(pumpkin().exchange)), {
    season: 2026,
    startsAt: jst('2026-10-14T00:00'),
    expiresAt: jst('2027-01-01T00:00'),
    recipes: [
      {
        key: 'yokan', jpName: '南瓜羊羹', exchangeType: 110, cost: 3, limit: null,
        choices: [[{ kind: 'useitem', id: 4, count: 4 }, { kind: 'useitem', id: 3, count: 6 }]],
      },
      {
        key: 'party', jpName: 'Halloween Party 2026', exchangeType: 101, cost: 14, limit: 1,
        choices: [
          [{ kind: 'useitem', id: 58, count: 4 }],
          [{ kind: 'slotitem', id: 138, count: 1 }, { kind: 'slotitem', id: 312, count: 2 }],
          [{ kind: 'slotitem', id: 478, count: 1 }],
        ],
      },
    ],
  })
})

test('过了当季就不带目录；企划本身照常检测', () => {
  assert.equal(pumpkin({ now: jst('2026-10-13T23:59') }).exchange, undefined)
  const late = pumpkin({ now: jst('2027-01-01T00:00') })
  assert.ok(late, '企划检测不该受目录有效期影响')
  assert.equal(late.exchange, undefined)
  assert.ok(pumpkin({ now: jst('2026-12-31T23:59') }).exchange)
})

test('永久未结账记录让花光后的本季卡继续在场；已结账才交还', () => {
  assert.equal(pumpkin({ useitems: {} }), undefined)
  const recorded = pumpkin({ useitems: {}, recordedKeys: ['pumpkin'] })
  assert.equal(recorded.stock, 0)
  assert.ok(recorded.exchange)
  assert.equal(pumpkin({ useitems: {}, recordedKeys: [] }), undefined)
})

test('任一项在主数据里解析不到：那一道兑换整条不出，另一道照常', () => {
  const ex = pumpkin({ slotitemMst: SLOTITEM_MST.filter((e) => e.id !== 312) }).exchange
  assert.deepEqual(ex.recipes.map((r) => r.key), ['yokan'])
  const none = pumpkin({ useitemMst: USEITEM_MST.filter((u) => u.id !== 4), slotitemMst: [] })
  assert.equal(none.exchange, undefined, '两道都出不来时不带空目录')
})

test('没有兑换目录的企划不带 exchange；不传 slotitemMst / now 时与原来一致', () => {
  const sanma = detectSeasonalCampaigns({
    useitemMst: [{ id: 68, name: '秋刀魚' }],
    useitems: { 68: 3 },
    quests: [],
  })
  assert.equal(sanma.length, 1)
  assert.equal(sanma[0].exchange, undefined)
  const legacy = detectSeasonalCampaigns({ useitemMst: USEITEM_MST, useitems: { 96: 7 }, quests: [] })
  assert.equal(legacy[0].exchange, undefined)
})
