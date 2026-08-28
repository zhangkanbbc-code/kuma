import assert from 'node:assert/strict'
import test from 'node:test'

import sortieRoute from '../dist/shared/sortie-route.js'

const { travelledEdges } = sortieRoute

// poi fcd 的真实形状（1-1 原样）：0 号是「进入出发点」的伪边，
// 出发点自己也是 spots 里的一个点（名字是数字，type = 'start'）。
const MAP_1_1 = {
  0: [null, '1'],
  1: ['1', 'A'],
  2: ['A', 'B'],
  3: ['A', 'C'],
}

test('travelled edges include the leg from the start spot to the first node', () => {
  // 节点记录里的 cell 是边号：走了 1 号边（起点→A）与 2 号边（A→B）
  assert.deepEqual(travelledEdges(MAP_1_1, [1, 2]), [
    { from: '1', to: 'A' },
    { from: 'A', to: 'B' },
  ])
})

// 双起点图（6-4/6-5/5-6 与多数 E 图都是这样）：光看字母连不出走的是哪个起点，
// 边号才说得清。这是把「首尾相连」换成「按边画」的真正理由。
const TWO_STARTS = {
  0: [null, '1'],
  1: ['1', 'A'],
  19: [null, '2'],
  20: ['2', 'A'],
}

test('travelled edges pick the start the fleet actually departed from', () => {
  assert.deepEqual(travelledEdges(TWO_STARTS, [1]), [{ from: '1', to: 'A' }])
  assert.deepEqual(travelledEdges(TWO_STARTS, [20]), [{ from: '2', to: 'A' }])
})

test('pseudo-edges and unknown edge numbers draw nothing rather than a wrong line', () => {
  // 0 号边是 [null, 起点]，没有线可画；999 是 fcd 里没有的边（新图/改版）
  assert.deepEqual(travelledEdges(MAP_1_1, [0, 999]), [])
  assert.deepEqual(travelledEdges(null, [1, 2]), [])
  assert.deepEqual(travelledEdges(MAP_1_1, []), [])
})
