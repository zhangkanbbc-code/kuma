// 「按端点自扣」那一族扣的必须是**真存在的那个道具号**。
//
// 2026-08-31 查账翻出来的：开增设槽扣的是 useitem 26、ケッコンカッコカリ扣的是 20，
// 而这两个号在主数据 api_mst_useitem 里都是**空条目**（连名字都没有），玩家的道具
// 全量下发里也从来不出现。于是这两处自扣一直在空转——
// 实证：13:43:02–13:43:37 连开五格增设，useitem_log 一笔没有，直到 13:52:13 的
// 全量下发才一口气差出「64 −5」，履历上那笔消耗的原因就落到了 13:52 在做的事上。
// 真号是 64「補強増設」与 55「書類一式＆指輪」（游戏主数据自证；64 还与
// shared/kcwiki-upgrade、qn 两张道具别名表同号）。
//
// 同族的 105 格納庫増設一直是对的（账本 08-28 11:01 三次开扩，三笔 −1 逐秒落账），
// 所以这里钉的是「号写错了不会报错、只会静静地不扣」这一类。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  REAL_EXSLOT_POST,
  TS,
  feedMarriage,
  feedOpenExslot,
  reset,
  ships,
  useitemLog,
  useitems,
} from './fixtures/store-self-deduct.mjs'

test('开增设槽扣 useitem 64「補強増設」，当场落账', () => {
  reset({ 7341: { mstId: 560, slotEx: 0 } }, { 64: 5 })
  const sections = feedOpenExslot(REAL_EXSLOT_POST)
  assert.deepEqual(sections.sort(), ['ships', 'useitems'])
  assert.equal(ships()[7341].slotEx, -1, '开了但空着记 -1，不是 0')
  assert.equal(useitems()[64], 4)
  assert.deepEqual(useitemLog(), [{ ts: TS, changes: [{ id: 64, delta: -1, total: 4 }] }])
})

test('连开五格就扣五个，每一格各落一笔', () => {
  reset(
    {
      7341: { mstId: 560, slotEx: 0 },
      567: { mstId: 561, slotEx: 0 },
      2737: { mstId: 562, slotEx: 0 },
      3447: { mstId: 969, slotEx: 0 },
      1005: { mstId: 503, slotEx: 0 },
    },
    { 64: 5 },
  )
  for (const id of ['7341', '567', '2737', '3447', '1005']) feedOpenExslot({ api_id: id })
  assert.equal(useitems()[64], 0)
  assert.equal(useitemLog().length, 5, '五格五笔——攒成一笔就说不清是哪一次开的')
})

test('已经开过的格不重复扣', () => {
  reset({ 7341: { mstId: 560, slotEx: -1 } }, { 64: 5 })
  assert.deepEqual(feedOpenExslot(REAL_EXSLOT_POST), [])
  assert.equal(useitems()[64], 5)
})

test('账上没有这件道具时不硬扣出负数，也不落空账', () => {
  reset({ 7341: { mstId: 560, slotEx: 0 } }, {})
  assert.deepEqual(feedOpenExslot(REAL_EXSLOT_POST), ['ships'], '格子照开，道具不报')
  assert.equal(useitemLog().length, 0)
})

test('ケッコンカッコカリ扣 useitem 55「書類一式＆指輪」', () => {
  reset({}, { 55: 2 })
  const sections = feedMarriage({ api_id: 941, api_ship_id: 667, api_lv: 100 })
  assert.deepEqual(sections.sort(), ['ships', 'useitems'])
  assert.equal(useitems()[55], 1)
  assert.deepEqual(useitemLog(), [{ ts: TS, changes: [{ id: 55, delta: -1, total: 1 }] }])
})

// 空号写回去不会报错、也不会有人发现——只会静静地不扣。所以把「不许再出现」写死。
test('这一族不再出现主数据里的空条目号', () => {
  const source = fs.readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  const ids = [...source.matchAll(/incrementUseitem\((\d+),/g)].map((match) => Number(match[1]))
  assert.deepEqual([...new Set(ids)].sort((a, b) => a - b), [55, 64, 91, 105])
})
