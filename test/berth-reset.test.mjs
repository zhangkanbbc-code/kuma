// 「哪些操作把泊地修理的计时拨回 0」——逐条对着真 reducer 验。
//
// 这张清单是**有意留短**的：只收查证站得住的两条（编成变更 / 回港落账），
// 补给、装备变更、入渠、出撃 各家说法不一或只有单源，一条都没进来。
// 出处与源数逐条记在 src/shared/berth-repair.ts 的头注 ⑧。
//
// 「回港落账」那一半在 berth-repair.test.mjs 里对着 `berthBankedDecks` 验（纯函数），
// 这一份管的是**编成这一侧**：哪几种编成动作算、哪几种不算。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  berthSince,
  deckUpdates,
  decks,
  henseiChange,
  presetSelect,
  reset,
} from './fixtures/store-berth-reducer.mjs'

const TS = 1_700_000_000_000
const FLEETS = [
  { id: 1, ships: [101, 102, 103, -1, -1, -1] },
  { id: 2, ships: [201, 202, -1, -1, -1, -1] },
]

// ---- 会拨零的 ----

test('往队里加一艘 → 那支队的计时拨回 0', () => {
  reset(FLEETS)
  henseiChange({ deckId: 1, idx: 3, shipId: 999, ts: TS })
  assert.deepEqual(berthSince(), { 1: TS })
})

test('把某位撤下来 → 拨回 0', () => {
  reset(FLEETS)
  henseiChange({ deckId: 1, idx: 1, shipId: -1, ts: TS })
  assert.deepEqual(berthSince(), { 1: TS })
  assert.deepEqual(decks()[0].ships, [101, 103, -1, -1, -1, -1])
})

test('从别队把人换过来 → **两支队**的计时都拨回 0', () => {
  // 对调动了两支队的编成，只拨一边的话，另一边会继续按老锚点报「停泊 N 分」
  reset(FLEETS)
  henseiChange({ deckId: 1, idx: 1, shipId: 201, ts: TS })
  assert.deepEqual(berthSince(), { 1: TS, 2: TS })
  assert.deepEqual(decks()[0].ships, [101, 201, 103, -1, -1, -1])
  assert.deepEqual(decks()[1].ships, [102, 202, -1, -1, -1, -1])
})

test('拨的是最近一次的时刻，不是第一次', () => {
  reset(FLEETS)
  henseiChange({ deckId: 1, idx: 3, shipId: 999, ts: TS })
  henseiChange({ deckId: 1, idx: 4, shipId: 998, ts: TS + 60_000 })
  assert.deepEqual(berthSince(), { 1: TS + 60_000 })
})

// ---- 不该拨零的 ----

test('预设展开**不**拨计时：「预设明石修理」那套玩法全靠这一条', () => {
  // 四源一致（kcmemo / wikiwiki / note.com / murasame）：編成記録の展開不算「編成」。
  // 哪天有人顺手给这个 reducer 补一句 touchBerth，玩家真实的进度就被抹掉了。
  reset(FLEETS)
  presetSelect({ deckId: 1, ships: [101, 301, 302, -1, -1, -1], ts: TS })
  assert.deepEqual(berthSince(), {}, '预设展开把计时拨零了')
  assert.equal(deckUpdates().length, 1, '前提：这个 reducer 确实跑到了底')
})

test('随伴舰一括解除**不**拨计时', () => {
  // kcmemo 明确把它排除在「編成」之外（⚠️ 单源，理由见 shared 头注 ⑧ 与 store 的注）
  reset(FLEETS)
  henseiChange({ deckId: 1, idx: 1, shipId: -2, ts: TS })
  assert.deepEqual(berthSince(), {})
  assert.deepEqual(decks()[0].ships, [101, -1, -1, -1, -1, -1], '前提：确实把随伴清空了')
})

test('动的是别队，本队的计时不受牵连', () => {
  reset(FLEETS)
  henseiChange({ deckId: 2, idx: 1, shipId: 999, ts: TS })
  assert.deepEqual(berthSince(), { 2: TS })
})

test('认不出的编成请求不拨计时', () => {
  reset(FLEETS)
  henseiChange({ deckId: 9, idx: 1, shipId: 999, ts: TS }) // 没有第 9 队
  assert.deepEqual(berthSince(), {})
})
