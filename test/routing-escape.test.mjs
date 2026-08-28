// 带路预测要扣退避舰。
//
// 游戏侧的规则一句话：**分歧判定是按下进击钮那一刻的舰队状态做的**
//（wikiwiki「ルート分岐」：判定は進撃時点）。护卫退避 / 单舰退避掉的舰已经回港，
// 那一刻她不在队里——索敌值不算她，舰种数与舰数条件也不算她。
//
// 而我们的带路上下文原先一律从母港编成建（deck.ships 全量），出击中有人退避之后
// 预测仍按原编成算：索敌虚高、舰种计数虚高、「唯一低速舰退避后全队变高速」这种
// 会真的改路线的变化也追不上。这一组钉的就是「按剩下的人算」。
//
// 三条边界一并钉住：非出击态 / 演习 / 沙盘 what-if 编成一律不扣——那三种场合
// 根本没有退避这回事，扣了就是凭空少一条舰。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  resetRoutingBaseCache,
  routingContextForDeck,
  routingFleetBase,
  routingRosterForDeck,
  routingShipsForDeck,
  setEscaped,
  setup,
} from './fixtures/routing-fleet-base.mjs'

// stype：2 駆逐 / 3 軽巡 / 9 戦艦。104 是队里**唯一的低速舰**，也是唯一带电探的。
const FLEET = [
  { id: 101, shipId: 1101, stype: 2, soku: 10, name: '雷' },
  { id: 102, shipId: 1102, stype: 2, soku: 10, name: '電' },
  { id: 103, shipId: 1103, stype: 3, soku: 10, name: '球磨' },
  { id: 104, shipId: 1104, stype: 9, soku: 5, name: '長門', slot: [500] },
  { id: 105, shipId: 1105, stype: 2, soku: 10, name: '暁' },
  { id: 106, shipId: 1106, stype: 2, soku: 10, name: '響' },
]
const RADAR = [{ instId: 500, mstId: 1500, name: '22号対水上電探', type2: 12, saku: 0 }]
const DECK1 = { id: 1, name: '第1艦隊', ships: [101, 102, 103, 104, 105, 106] }

const escapedEntry = (rosterId, role = 'escaped') => ({
  rosterId,
  mstId: rosterId + 1000,
  name: `舰${rosterId}`,
  role,
  cell: 12,
  ts: 1_700_000_000_000,
})

const sortieOf = (escaped, extra = {}) => ({
  active: true,
  practice: false,
  deckId: 1,
  escaped,
  ...extra,
})

const baseWith = (escaped, extra = {}) => {
  setup({
    ships: FLEET,
    items: RADAR,
    decks: [DECK1],
    sortie: escaped === null ? null : sortieOf(escaped, extra),
  })
  return routingFleetBase(1)
}

// ---- 出击中：退避舰不进任何一项分歧条件 ----

test('退避舰不进舰数、舰种计数与舰名表', () => {
  const before = baseWith([])
  assert.equal(before.shipCount, 6)
  assert.equal(before.counts.BB, 1)
  assert.equal(before.counts['BB系'], 1)
  assert.equal(before.counts.DD, 4)
  assert.ok(before.shipNames.includes('長門'))

  const after = baseWith([escapedEntry(104)])
  assert.equal(after.shipCount, 5, '舰数条件还按原编成算')
  assert.equal(after.counts.BB, undefined, '舰种条件还把退避的戦艦算进去')
  assert.equal(after.counts['BB系'], 0)
  assert.equal(after.counts.DD, 4, '没退避的舰不该受影响')
  assert.ok(!after.shipNames.includes('長門'), '「舰队中包含长门」这类条件会误判为真')
})

test('護衛退避是两艘一起走：陪走的护卫舰（role=tow）同样不算', () => {
  const after = baseWith([escapedEntry(104), escapedEntry(105, 'tow')])
  assert.equal(after.shipCount, 4)
  assert.ok(!after.shipNames.includes('暁'))
  assert.equal(after.counts.DD, 3)
})

test('唯一的低速舰退避之后，speed 按剩下的人报', () => {
  assert.equal(baseWith([]).speed, 5, '低速舰在队里时是低速')
  assert.equal(baseWith([escapedEntry(104)]).speed, 10, '「全队高速」这类分歧追不上退避')
  // 低速戦艦的单独计数走同一份名单
  assert.equal(baseWith([]).counts.lowSpeedBB, 1)
  assert.equal(baseWith([escapedEntry(104)]).counts.lowSpeedBB, 0)
})

test('退避舰身上的装备不再计入雷达/运输桶/大发的持有舰数', () => {
  assert.equal(baseWith([]).equipmentShipCounts.radar, 1)
  assert.equal(baseWith([escapedEntry(104)]).equipmentShipCounts.radar, 0)
})

// ---- 索敌：舰从输入里拿掉，空格补正随之演算 ----
//
// 这一组把全员面板索敌与提督 Lv 都摆成 0，于是 33 式只剩空格项：total = 2×空格数。
// 满编 6 舰 = 0；退避一艘后剩 5 舰，空出一格 = 2。
//
// 「退避舰从索敌排除」是 wikiwiki 明记的；**空位补正是否随退避 +2/舰没有查到独立
// 检证**，这里钉的是我们选定的口径（按「她已经不在舰队里」让公式自然演算），
// 不是把它当成游戏事实——哪天查到反证，改 losSlotCount 那一处，这几行跟着改。

test('退避舰不进索敌输入，剩下的空格按 33 式自然补正', () => {
  assert.equal(baseWith([]).los[1], 0, '满编没有空格')
  assert.equal(baseWith([escapedEntry(104)]).los[1], 2)
  assert.equal(baseWith([escapedEntry(104), escapedEntry(105, 'tow')]).los[1], 4)
  // 四档分歧点系数各算一遍，都走同一份舰表
  assert.deepEqual(Object.values(baseWith([escapedEntry(104)]).los), [2, 2, 2, 2])
})

test('遊撃部隊退避一人之后仍按 7 格算，不被读成普通 6 格队', () => {
  const strikeForce = [...FLEET, { id: 107, shipId: 1107, stype: 2, soku: 10, name: '暁改' }]
  const deck = { id: 3, name: '第3艦隊', ships: [101, 102, 103, 104, 105, 106, 107] }
  setup({ ships: strikeForce, items: RADAR, decks: [deck], sortie: sortieOf([], { deckId: 3 }) })
  assert.equal(routingFleetBase(3).los[1], 0, '7 舰坐满 7 格，没有空格')

  setup({
    ships: strikeForce,
    items: RADAR,
    decks: [deck],
    sortie: sortieOf([escapedEntry(104)], { deckId: 3 }),
  })
  const after = routingFleetBase(3)
  assert.equal(after.shipCount, 6)
  // 格子容量要按**编成**认（7 舰 = 遊撃），按扣完的人数认就会变成 6 格队、
  // 凭空吃掉这一格空位补正，los 会回到 0
  assert.equal(after.los[1], 2, '遊撃部隊被退避读成了 6 格队')
  assert.equal(routingRosterForDeck(3).length, 7, '容量口径读的必须是全量编成')
})

// ---- 連合舰队：退避舰可能在第二队 ----

test('連合舰队：第二队退避的舰同样从第一队代表的这支队里扣掉', () => {
  const escort = [
    { id: 201, shipId: 1201, stype: 3, soku: 10, name: '阿武隈' },
    { id: 202, shipId: 1202, stype: 2, soku: 10, name: '朝潮' },
    { id: 203, shipId: 1203, stype: 2, soku: 10, name: '霞' },
    { id: 204, shipId: 1204, stype: 2, soku: 10, name: '荒潮' },
    { id: 205, shipId: 1205, stype: 2, soku: 10, name: '満潮' },
    { id: 206, shipId: 1206, stype: 2, soku: 10, name: '大潮' },
  ]
  const decks = [DECK1, { id: 2, name: '第2艦隊', ships: [201, 202, 203, 204, 205, 206] }]
  const combined = { ships: [...FLEET, ...escort], items: RADAR, decks, combinedFlag: 1 }

  setup({ ...combined, sortie: sortieOf([]) })
  assert.equal(routingFleetBase(1).shipCount, 12)
  assert.equal(routingFleetBase(1).los[1], 0, '連合满编 12 格坐满')

  // 退避名单存的是**在籍 id**（舰位换算在 shared/sortie-escape 落账时就做完了），
  // 所以消费侧不必再推一次位次：她在一队还是二队，按 id 对上就行。
  setup({ ...combined, sortie: sortieOf([escapedEntry(205)]) })
  const after = routingFleetBase(1)
  assert.equal(after.shipCount, 11)
  assert.ok(!after.shipNames.includes('満潮'))
  assert.equal(after.los[1], 2, '連合的空格数没跟着退避走')

  // 第一队的人退避，走的是同一条路
  setup({ ...combined, sortie: sortieOf([escapedEntry(104)]) })
  assert.equal(routingFleetBase(1).speed, 10)
  assert.equal(routingFleetBase(1).shipCount, 11)
})

// ---- 三条边界：没有退避这回事的场合，全量编成照旧 ----

test('不在出击就不扣：母港里读到的是全量编成', () => {
  const base = baseWith(null)
  assert.equal(base.shipCount, 6)
  assert.equal(base.speed, 5)
  assert.equal(base.los[1], 0)
})

test('返港即解除：出击结束后名单还在，也一律不扣', () => {
  setup({
    ships: FLEET,
    items: RADAR,
    decks: [DECK1],
    sortie: { active: false, practice: false, deckId: 1, escaped: [escapedEntry(104)] },
  })
  assert.equal(routingFleetBase(1).shipCount, 6)
})

test('演习没有退避这回事，照旧全量', () => {
  setup({
    ships: FLEET,
    items: RADAR,
    decks: [DECK1],
    sortie: { active: true, practice: true, deckId: 1, escaped: [escapedEntry(104)] },
  })
  assert.equal(routingFleetBase(1).shipCount, 6)
  assert.equal(routingFleetBase(1).speed, 5)
})

test('沙盘是母港里的 what-if 编成，不跟着真出击的退避掉人', () => {
  setup({
    ships: FLEET,
    items: RADAR,
    decks: [DECK1],
    sortie: sortieOf([escapedEntry(104)]),
    sandboxShips: [101, 102, 103, 104, 105, 106],
  })
  assert.equal(routingShipsForDeck(-1).length, 6, '沙盘里被扣掉了一条舰')
  assert.equal(routingFleetBase(-1).speed, 5)
  // 同一局里真实第一舰队照扣不误
  assert.equal(routingFleetBase(1).shipCount, 5)
})

// ---- 缓存：退避变了必须失效 ----

test('队伍侧按 deckId 缓存，退避变化后不 reset 就会拿着上一套编成的结果', () => {
  setup({ ships: FLEET, items: RADAR, decks: [DECK1], sortie: sortieOf([]) })
  assert.equal(routingContextForDeck(1).shipCount, 6)

  setEscaped([escapedEntry(104)])
  assert.equal(routingContextForDeck(1).shipCount, 6, '缓存本来就该挡住重算')

  resetRoutingBaseCache()
  assert.equal(routingContextForDeck(1).shipCount, 5)
  assert.equal(routingContextForDeck(1).speed, 10)
})

test('sortie 一变就清队伍侧缓存：退避名单挂在 sortie 上', () => {
  const atlas = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const branch = atlas.slice(
    atlas.indexOf("if (keys.includes('sortie')) {"),
    atlas.indexOf('if (keys.includes(\'master\')) {'),
  )
  assert.ok(branch.length > 100, '取到的 sortie 订阅片段不对')
  assert.match(branch, /resetRoutingBaseCache\(\)/)
})
