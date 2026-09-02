// 联合编成的第 2 舰队「不在家」的三个出口（66d900b 穷举时查到，这一改补上）。
//
// 上一改只修了「显示成空闲」那一族（顶栏芯片、空闲舰队清单、甘特条、悬停卡），
// 同族还有三处**行为级**的：系统仍把她当成在家，于是
//   ① 远征规划把她的舰凑进候选池——等于建议玩家拆掉随伴舰队去跑远征；
//   ② 图鉴/今日改修把她舰上的装备算成「在手边」——「空闲 N」把出海的也数了进去；
//   ③ 联合出击打到一半，还给她发「疲劳预计已恢复」——人在海上，这声喊了也没用。
//
// 三处共用同一条判据 `combinedEscortState`（kernel.ts），各自取用不同的态：
// 候选池两态都剔（她怎么都派不出去），装备与通知只认 'sortie'（编队中她在母港）。
// 断言全部对着真码跑出来的返回值/产物下——这一族 bug 的全部形态都是「少了一格判断」，
// 源码文本看上去完全正常。
import assert from 'node:assert/strict'
import test from 'node:test'

import { availableShipIds, reset } from './fixtures/render-combined-escort.mjs'
import { expandedOf, todayRows } from './fixtures/render-today-improve.mjs'
import { detectCond, notifiedDeckIds } from './fixtures/lg-cond-recovery.mjs'

const SORTIE = { active: true, practice: false, deckId: 1 }

// ---------------------------------------------------------------- ① 远征候选池

// 四支队各一艘：11 在一队、21/22 在二队、31 在三队、41 在四队；另有 90 闲置。
const 四队各一艘 = {
  fleets: [
    { id: 1, ships: [11] },
    { id: 2, ships: [21, 22] },
    { id: 3, ships: [31] },
    { id: 4, ships: [41] },
  ],
  ships: { 11: {}, 21: {}, 22: {}, 31: {}, 41: {}, 90: {} },
}

test('联合编成时，二队的舰不进远征候选池——方案不许去拆随伴舰队', () => {
  reset({ ...四队各一艘, combinedFlag: 1, sortie: SORTIE })
  const pool = availableShipIds()
  assert.ok(!pool.includes(21) && !pool.includes(22), `二队的舰还在候选池里：${pool}`)
  // 别的队一个都不许误伤：一队虽然也在联合里，但她本来就是「出击中的舰照旧列出」
  // 那一档（这次不动那条口径），三四队更是完全无关
  for (const id of [11, 31, 41, 90]) {
    assert.ok(pool.includes(id), `第 ${id} 舰被误剔出候选池了`)
  }
})

test('联合但没出击（编队中）也照剔：那支队一样派不出远征', () => {
  reset({ ...四队各一艘, combinedFlag: 3, sortie: null })
  const pool = availableShipIds()
  assert.ok(!pool.includes(21) && !pool.includes(22), `编队中的二队舰还在候选池里：${pool}`)
})

test('没联合就照旧：二队的舰是正经的候选（这条守的是没有误剔）', () => {
  reset({ ...四队各一艘, combinedFlag: 0, sortie: null })
  const pool = availableShipIds()
  for (const id of [11, 21, 22, 31, 41, 90]) {
    assert.ok(pool.includes(id), `非联合局面下第 ${id} 舰不该被剔`)
  }
})

test('联合解编后二队立刻回到候选池，不留残影', () => {
  reset({ ...四队各一艘, combinedFlag: 2, sortie: SORTIE })
  assert.ok(!availableShipIds().includes(21))
  reset({ ...四队各一艘, combinedFlag: 0, sortie: null })
  assert.ok(availableShipIds().includes(21), '解编了还剔着')
})

test('远征在途仍然照剔，联合这条判据没把原来那条挤掉', () => {
  reset({
    fleets: [
      { id: 1, ships: [11] },
      { id: 2, ships: [21] },
      { id: 3, ships: [31], mission: [1, 5, 0, 0] },
      { id: 4, ships: [41] },
    ],
    ships: { 11: {}, 21: {}, 31: {}, 41: {} },
    combinedFlag: 1,
    sortie: SORTIE,
  })
  const pool = availableShipIds()
  assert.ok(!pool.includes(31), '远征在途的舰漏进候选池了')
  assert.ok(!pool.includes(21), '联合二队的舰漏进候选池了')
})

// ---------------------------------------------------------------- ② 装备在不在手边

// 「今日改修」的展开层数「这几件同款现在都在哪」。五件同款 mstId=2：
// 101 在库、102 在库、103 挂在二队的舰上、104 挂在三队的舰上、105 也在库。
const 改修账本 = (over = {}) => ({
  equips: { 1: { api_id: 1, api_name: '12.7cm連装砲', api_type: [1, 1, 1, 1] }, 2: { api_id: 2, api_name: '12.7cm連装砲B型改二', api_type: [1, 1, 1, 1] } },
  shipMst: { 182: { api_id: 182, api_name: '明石' }, 91: { api_id: 91, api_name: '白露改二' }, 500: { api_id: 500, api_name: '出门舰' } },
  day: 2,
  eo: [
    {
      eq_id: 2,
      improvement: [
        {
          helpers: [{ ship_ids: [91], days: [2] }],
          costs: { p1: { devmats: 4, screws: 3 }, fuel: 10, ammo: 10, steel: 10, baux: 0 },
        },
      ],
    },
  ],
  mg: {
    ships: {
      1: { id: 1, shipId: 182, lv: 60, slot: [-1, -1, -1, -1], slotEx: 0 },
      2: { id: 2, shipId: 91, lv: 80, slot: [-1, -1, -1, -1], slotEx: 0 },
      20: { id: 20, shipId: 500, lv: 50, slot: [103, -1, -1, -1], slotEx: 0 },
      30: { id: 30, shipId: 500, lv: 50, slot: [104, -1, -1, -1], slotEx: 0 },
    },
    slotitems: {
      101: { mstId: 2, level: 0, alv: 0, locked: false },
      102: { mstId: 2, level: 0, alv: 0, locked: false },
      103: { mstId: 2, level: 0, alv: 0, locked: false },
      104: { mstId: 2, level: 0, alv: 0, locked: false },
      105: { mstId: 2, level: 0, alv: 0, locked: false },
    },
    decks: [
      { id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] },
      { id: 2, name: '第2', mission: [0], ships: [20, -1, -1, -1, -1, -1] },
      { id: 3, name: '第3', mission: [0], ships: [30, -1, -1, -1, -1, -1] },
    ],
    ndocks: [],
    sortie: null,
    combinedFlag: 0,
    materials: { 0: 9999, 1: 9999, 2: 9999, 3: 9999, 6: 9999, 7: 9999 },
    useitems: {},
    airBases: [],
    ...(over.mg ?? {}),
  },
  ...over,
})

const 当前不可用 = (over) => {
  const rows = todayRows(改修账本(over))
  assert.equal(rows.length, 1, '这份账本该正好出一条方案')
  const hit = /当前不可用 远征中 (\d+) · 出击中 (\d+) · <span[^>]*>入渠中 (\d+)</.exec(
    expandedOf(rows[0].html),
  )
  assert.ok(hit, '展开层里找不到「当前不可用」那一行')
  return { mission: +hit[1], sortie: +hit[2], ndock: +hit[3] }
}

test('联合出击时，二队舰上的装备算「出击中」——不许当成手边能动用的', () => {
  const 数 = 当前不可用({
    mg: { ...改修账本().mg, combinedFlag: 1, sortie: { active: true, practice: false, deckId: 1 } },
  })
  // 103 在二队（联合出击 → 出击中）、104 在三队（没出击 → 在手边）
  assert.equal(数.sortie, 1, '二队舰上那件装备被算成在手边了')
  assert.equal(数.mission, 0)
  assert.equal(数.ndock, 0)
})

test('联合但只是编队中：她在母港，装备照旧够得着', () => {
  const 数 = 当前不可用({ mg: { ...改修账本().mg, combinedFlag: 1, sortie: null } })
  assert.equal(数.sortie, 0, '编队中被当成了出击中')
})

test('联合打演习不算出击：二队舰上的装备还在手边', () => {
  const 数 = 当前不可用({
    mg: { ...改修账本().mg, combinedFlag: 1, sortie: { active: true, practice: true, deckId: 1 } },
  })
  assert.equal(数.sortie, 0, '演习被算成了出击')
})

test('非联合出击照旧只算具名那一队：一队出击不牵连二队', () => {
  const 数 = 当前不可用({
    mg: { ...改修账本().mg, combinedFlag: 0, sortie: { active: true, practice: false, deckId: 3 } },
  })
  // 出击的是三队（104 在三队）；二队的 103 没被牵连
  assert.equal(数.sortie, 1, '出击那一队该数 1 件')
})

test('远征那一格不被联合带偏：二队在联合、三队在远征，两项各数各的', () => {
  const 数 = 当前不可用({
    mg: {
      ...改修账本().mg,
      decks: [
        { id: 1, name: '第1', mission: [0], ships: [1, 2, -1, -1, -1, -1] },
        { id: 2, name: '第2', mission: [0], ships: [20, -1, -1, -1, -1, -1] },
        { id: 3, name: '第3', mission: [1, 5, 0], ships: [30, -1, -1, -1, -1, -1] },
      ],
      combinedFlag: 2,
      sortie: { active: true, practice: false, deckId: 1 },
    },
  })
  assert.equal(数.sortie, 1, '联合二队那件该算出击中')
  assert.equal(数.mission, 1, '远征那件被算错了格')
})

// ---------------------------------------------------------------- ③ 疲劳恢复通知

const 三支队 = [
  { id: 1, ships: [11, -1] },
  { id: 2, ships: [21, -1] },
  { id: 3, ships: [31, -1] },
]

test('联合出击中不给二队发「疲劳已恢复」——人在海上，这声喊了也没用', () => {
  const notices = detectCond({
    fleets: 三支队,
    tired: [11, 21, 31],
    combinedFlag: 1,
    sortie: { active: true, practice: false, deckId: 1 },
  })
  const decks = notifiedDeckIds(notices)
  assert.ok(!decks.includes(2), `联合出击中还是给二队响了：${JSON.stringify(notices)}`)
  // 出击那一队本来就被跳过；三队在家，照响
  assert.ok(!decks.includes(1), '出击中的一队本来就该跳过')
  assert.deepEqual(decks, [3])
})

test('联合编队中照发：她在母港，恢复完了值得说一声', () => {
  const decks = notifiedDeckIds(
    detectCond({ fleets: 三支队, tired: [11, 21, 31], combinedFlag: 1, sortie: null }),
  )
  assert.deepEqual(decks, [1, 2, 3], '编队中被连坐抑制了')
})

test('没联合就照旧：二队疲劳恢复照响（这条守的是没有误抑制）', () => {
  const decks = notifiedDeckIds(
    detectCond({
      fleets: 三支队,
      tired: [11, 21, 31],
      combinedFlag: 0,
      sortie: { active: true, practice: false, deckId: 1 },
    }),
  )
  assert.deepEqual(decks, [2, 3], '一队在出击该跳过，二三队照响')
})

test('联合打演习不算出击：二队照响', () => {
  const decks = notifiedDeckIds(
    detectCond({
      fleets: 三支队,
      tired: [11, 21, 31],
      combinedFlag: 1,
      sortie: { active: true, practice: true, deckId: 1 },
    }),
  )
  assert.ok(decks.includes(2), '演习被当成了出击')
})

test('通知本体没被改坏：文案与落点照旧', () => {
  const notices = detectCond({ fleets: 三支队, tired: [31], combinedFlag: 0, sortie: null })
  assert.equal(notices.length, 1)
  assert.equal(notices[0].eventId, 'condRecover')
  assert.match(notices[0].title, /^第3舰队 疲劳估算已恢复$/)
  assert.deepEqual(notices[0].ref, { type: 'fleet', id: 3 })
})

test('还没恢复到点的队不响——联合这条判据没把「够不够时候」那条挤掉', () => {
  const decks = notifiedDeckIds(
    detectCond({ fleets: 三支队, tired: [31], stillTired: [11, 21], combinedFlag: 0, sortie: null }),
  )
  assert.deepEqual(decks, [3])
})
