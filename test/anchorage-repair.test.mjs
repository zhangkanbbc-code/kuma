// 緊急泊地修理：报文只给「修完之后的舰队」，消耗一个字都没有——钢材与緊急修理資材
// 全靠自己扣，扣错就是资源账在两次回港之间一路偏。
//
// 报文形状照 poi 仓里那份真样本
// （views/redux/info/__tests__/__fixtures__/api_req_map_anchorage_repair_repairs_multiple_ships.json）：
// `api_used_ship` = 修理舰的 **mst id**（450 = 秋津洲改，在籍 4814 的 api_ship_id 正是 450）、
// `api_repair_ships` = 被修舰的在籍 id、`api_ship_data` = 更新后的整支舰队（連合两队共 12 条）。
// **没有 api_material、没有 useitem**——用例照这个形状自造，不搬那份 fixture 进仓。
//
// 机制口径（wikiwiki「艦艇修理施設」，2019-08-31 实装）：消耗緊急修理資材（useitem 91）×1
// 与钢材 = 本次回复耐久合计 ×3。回复量是**算出来的**：覆盖前的耐久 vs 报文里的新耐久。
import assert from 'node:assert/strict'
import test from 'node:test'

import { renderNavCard, sortieOf } from './fixtures/render-di-battle.mjs'
import {
  feedAnchorageRepair,
  materials,
  repairBody,
  reset,
  shipData,
  sortie,
  useitemLog,
  useitems,
} from './fixtures/store-anchorage-reducer.mjs'

// 明石改一队里的三条：两条被修、一条陪跑
const ROSTER = {
  611: { mstId: 623, nowhp: 20, maxhp: 41, name: '朝潮改二丁' },
  250: { mstId: 427, nowhp: 50, maxhp: 57, name: '霞改二' },
  4814: { mstId: 450, nowhp: 36, maxhp: 36, name: '秋津洲改' },
}
const REPAIRED = [
  shipData(611, 623, 27, 41), // +7
  shipData(250, 427, 57, 57), // +7
  shipData(4814, 450, 36, 36), // 修理舰自己没变
]

test('回复量按覆盖前后作差算：钢材 = 合计 ×3，緊急修理資材 −1', () => {
  reset(ROSTER)
  const sections = feedAnchorageRepair(
    repairBody({ usedShip: 450, repairShips: [611, 250], shipData: REPAIRED }),
  )
  // 20→27 与 50→57，合计回复 14 ⇒ 钢材 42
  assert.equal(materials()[2], 1000 - 42)
  assert.equal(useitems()[91], 4)
  // 燃/弹/铝一分不动：这条报文只吃钢材
  assert.deepEqual(materials().slice(0, 2), [1000, 1000])
  assert.equal(materials()[3], 1000)
  assert.deepEqual(sections.sort(), ['materials', 'ships', 'sortie', 'useitems'])
  // 道具变动要进账本，否则道具页的历史里这一笔凭空消失
  assert.equal(useitemLog().length, 1)
  assert.deepEqual(useitemLog()[0].changes, [{ id: 91, delta: -1, total: 4 }])
})

test('出击上留一条：修在哪一格、谁修的、各舰前后耐久、扣了多少钢材', () => {
  reset(ROSTER, { sortie: { currentCell: 7 } })
  feedAnchorageRepair(
    repairBody({ usedShip: 450, repairShips: [611, 250], shipData: REPAIRED }),
    1_700_000_000_123,
  )
  assert.deepEqual(sortie().anchorageRepairs, [
    {
      cell: 7,
      ts: 1_700_000_000_123,
      repairerMst: 450,
      ships: [
        { rosterId: 611, mstId: 623, name: '朝潮改二丁', before: 20, after: 27 },
        { rosterId: 250, mstId: 427, name: '霞改二', before: 50, after: 57 },
      ],
      steel: 42,
    },
  ])
  // 在籍舰的耐久照样按报文覆盖（这条 reducer 原本就干这件事，别把它改丢了）
  assert.equal(sortie().updatedTs, 1_700_000_000_123)
})

test('回复量算不出（账上没有那艘舰）就不扣钢材，只扣资材', () => {
  // 中途启动艦素：账上只有 611，另一条被修舰从没见过 → 合计回不出来
  reset({ 611: ROSTER[611] })
  feedAnchorageRepair(
    repairBody({
      usedShip: 450,
      repairShips: [611, 250],
      shipData: [shipData(611, 623, 27, 41), shipData(250, 427, 57, 57)],
    }),
  )
  assert.equal(materials()[2], 1000, '合计不完整时钢材一分不扣——不猜')
  assert.equal(useitems()[91], 4, '资材每次固定一个，那件事不需要知道回了多少')
  assert.equal(sortie().anchorageRepairs[0].steel, 0)
  // 算得出的那一条照样记下来，只是这一次的钢材写 0
  assert.deepEqual(sortie().anchorageRepairs[0].ships.map((one) => one.rosterId), [611])
})

test('演习与非出击都不落到出击上，但消耗照扣', () => {
  reset(ROSTER, { sortie: null })
  const noSortie = feedAnchorageRepair(
    repairBody({ usedShip: 450, repairShips: [611], shipData: REPAIRED }),
  )
  assert.ok(!noSortie.includes('sortie'))
  assert.equal(materials()[2], 1000 - 21)

  reset(ROSTER, { sortie: { practice: true } })
  const practice = feedAnchorageRepair(
    repairBody({ usedShip: 450, repairShips: [611], shipData: REPAIRED }),
  )
  assert.ok(!practice.includes('sortie'))
  assert.deepEqual(sortie().anchorageRepairs, [])
})

test('没有 api_ship_data 就整条不认：一分资源、一个道具都不动', () => {
  reset(ROSTER)
  assert.deepEqual(feedAnchorageRepair({ api_used_ship: 450, api_repair_ships: [611] }), [])
  assert.equal(materials()[2], 1000)
  assert.equal(useitems()[91], 5)
})

test('被修名单是空的：舰况照覆盖，但不扣钢材也不扣资材', () => {
  reset(ROSTER)
  const sections = feedAnchorageRepair(repairBody({ shipData: REPAIRED }))
  assert.deepEqual(sections, ['ships'])
  assert.equal(materials()[2], 1000)
  assert.equal(useitems()[91], 5)
})

test('资源基线还没到（materials 为 null）时不扣钢材，资材照扣', () => {
  reset(ROSTER, { materials: null })
  feedAnchorageRepair(repairBody({ usedShip: 450, repairShips: [611], shipData: REPAIRED }))
  assert.equal(materials(), null)
  assert.equal(useitems()[91], 4)
})

test('新出击的默认值里就有这张空表，不是 undefined', () => {
  reset(ROSTER)
  assert.deepEqual(sortie().anchorageRepairs, [])
})

// ---- 镝：带路节点上的那一行 ----

const NON_BATTLE_NODE = { cell: 12, eventId: 6, eventKind: 0, rank: null, note: null }
const repairAt = (cell, patch = {}) => ({
  cell,
  ts: 1_700_000_000_000,
  repairerMst: 450,
  ships: [
    { rosterId: 611, mstId: 623, name: '朝潮改二丁', before: 20, after: 27 },
    { rosterId: 250, mstId: 427, name: '霞改二', before: 50, after: 57 },
  ],
  steel: 42,
  ...patch,
})

test('节点卡上多一行：修了几艘、一共回了多少', () => {
  const html = renderNavCard(
    sortieOf({ currentCell: 12, nodes: [NON_BATTLE_NODE], anchorageRepairs: [repairAt(12)] }),
  )
  assert.match(html, /泊地修理 · 2 艘 \+14/)
  // 逐舰的前后耐久留在悬停里，不占正文
  assert.match(html, /朝潮改二丁 20→27/)
  // 玩家看得见的位置不放机制解释
  assert.ok(!html.includes('触发'))
  assert.ok(!html.includes('緊急修理資材'))
})

test('只报**当前格**的那一次：走过了就不再挂着', () => {
  const html = renderNavCard(
    sortieOf({ currentCell: 15, nodes: [{ ...NON_BATTLE_NODE, cell: 15 }], anchorageRepairs: [repairAt(12)] }),
  )
  assert.ok(!html.includes('泊地修理'))
})

test('回复量算不出时只说修过，不报一个编出来的 +0', () => {
  const html = renderNavCard(
    sortieOf({
      currentCell: 12,
      nodes: [NON_BATTLE_NODE],
      anchorageRepairs: [repairAt(12, { ships: [], steel: 0 })],
    }),
  )
  assert.match(html, /泊地修理/)
  assert.ok(!html.includes('艘'))
  assert.ok(!html.includes('+0'))
})

test('没修过就一个字都不出', () => {
  assert.ok(
    !renderNavCard(sortieOf({ currentCell: 12, nodes: [NON_BATTLE_NODE] })).includes('泊地修理'),
  )
  // 老快照没有这个字段：当成没修过，不是崩
  const legacy = sortieOf({ currentCell: 12, nodes: [NON_BATTLE_NODE] })
  delete legacy.anchorageRepairs
  assert.ok(!renderNavCard(legacy).includes('泊地修理'))
})
