import assert from 'node:assert/strict'
import test from 'node:test'

import slotMatching from '../dist/shared/slot-matching.js'

const { isFullMatch, matchSlots } = slotMatching

// 坑位用「收哪些舰种」表示，候选是 {name, stype}
const slot = (...types) => ({ types })
const ship = (name, stype, lv = 1) => ({ name, stype, lv })
const accepts = (s, c) => s.types.includes(c.stype)
const names = (holder) => holder.map((x) => x?.name ?? null)

test('先到先得会漏掉的解，匹配能找出来', () => {
  // 要求 A 收「軽巡或雷巡」，要求 B 只收「雷巡」；手上恰好一軽一雷。
  // 先到先得把唯一那艘雷巡填进 A，B 就没人了——这正是原来「有解报无解」的那个形状。
  const slots = [slot('軽巡', '雷巡'), slot('雷巡')]
  const pool = [ship('球磨', '軽巡'), ship('北上', '雷巡')]
  const holder = matchSlots(slots, pool, accepts)
  assert.ok(isFullMatch(holder), '两个坑都该有人')
  assert.deepEqual(names(holder), ['球磨', '北上'])
})

test('候选顺序反过来也能凑满（增广要能把占位者挪走）', () => {
  const slots = [slot('軽巡', '雷巡'), slot('雷巡')]
  const pool = [ship('北上', '雷巡'), ship('球磨', '軽巡')]
  const holder = matchSlots(slots, pool, accepts)
  assert.ok(isFullMatch(holder))
  // 北上先来占了第一个坑，球磨来的时候必须把它挪到第二个坑去
  assert.deepEqual(names(holder), ['球磨', '北上'])
})

test('真的凑不出时如实报缺，不硬塞', () => {
  const slots = [slot('雷巡'), slot('雷巡')]
  const holder = matchSlots(slots, [ship('北上', '雷巡'), ship('球磨', '軽巡')], accepts)
  assert.equal(isFullMatch(holder), false)
  assert.deepEqual(names(holder), ['北上', null])
})

test('偏好靠前的候选优先入选，且不因此牺牲总数', () => {
  // 三个坑：两个只收駆逐，一个谁都收。四艘候选按「越靠前越想用」排好。
  const slots = [slot('駆逐'), slot('駆逐'), slot('駆逐', '軽巡', '戦艦')]
  const pool = [
    ship('睦月', '駆逐'),
    ship('如月', '駆逐'),
    ship('弥生', '駆逐'),
    ship('長門', '戦艦'),
  ]
  const holder = matchSlots(slots, pool, accepts)
  assert.ok(isFullMatch(holder))
  // 保证的是**选中哪一组**（最省的一组），不是每艘落在第几格——
  // 增广会把已占位的挪走，格子顺序本来就不固定。
  assert.deepEqual(new Set(names(holder)), new Set(['睦月', '如月', '弥生']))
  // 三艘駆逐都排在長門前面，所以长门不该被拉进来
  assert.ok(!names(holder).includes('長門'))
  // 每个坑收下的都必须是它收得下的
  holder.forEach((c, i) => assert.ok(accepts(slots[i], c), `坑 ${i} 收了收不下的`))
})

test('多队拼成一张图跑同一次匹配：能同时派就一定填满', () => {
  // 甲队要一艘雷巡 + 一艘任意，乙队要一艘軽巡。
  // 一队一队地凑：甲队的「任意」格可能把唯一的軽巡吃掉，乙队就凑不出。
  const jointSlots = [
    slot('雷巡'), // 甲 1
    slot('駆逐', '軽巡', '雷巡'), // 甲 2（任意）
    slot('軽巡'), // 乙 1
  ]
  const pool = [ship('球磨', '軽巡'), ship('北上', '雷巡'), ship('睦月', '駆逐')]
  const holder = matchSlots(jointSlots, pool, accepts)
  assert.ok(isFullMatch(holder), '三个坑应当都能填上')
  assert.equal(holder[0].name, '北上')
  assert.equal(holder[2].name, '球磨')
  // 甲队的任意格只能是剩下那艘
  assert.equal(holder[1].name, '睦月')
})

test('同一艘不会被两支队同时用掉', () => {
  const jointSlots = [slot('雷巡'), slot('雷巡')]
  const holder = matchSlots(jointSlots, [ship('北上', '雷巡')], accepts)
  const used = holder.filter(Boolean)
  assert.equal(used.length, 1)
  assert.equal(new Set(used.map((s) => s.name)).size, 1)
})

test('空坑位与空候选都不炸', () => {
  assert.deepEqual(matchSlots([], [ship('北上', '雷巡')], accepts), [])
  assert.deepEqual(matchSlots([slot('雷巡')], [], accepts), [null])
  assert.equal(isFullMatch([]), true)
})

test('坑位多于候选时，尽可能多填，其余留 null', () => {
  const slots = [slot('駆逐'), slot('駆逐'), slot('駆逐')]
  const holder = matchSlots(slots, [ship('睦月', '駆逐'), ship('如月', '駆逐')], accepts)
  assert.equal(holder.filter(Boolean).length, 2)
  assert.equal(holder.filter((x) => x === null).length, 1)
})

test('一条长增广链能整体挪位', () => {
  // 坑 0 只收 A，坑 1 收 A/B，坑 2 收 B/C。
  // 候选按 c(C) → b(B) → a(A) 的顺序进来，最后一艘要迫使前面两艘各挪一格。
  const slots = [slot('A'), slot('A', 'B'), slot('B', 'C')]
  const pool = [ship('c', 'C'), ship('b', 'B'), ship('a', 'A')]
  const holder = matchSlots(slots, pool, accepts)
  assert.ok(isFullMatch(holder))
  assert.deepEqual(names(holder), ['a', 'b', 'c'])
})
