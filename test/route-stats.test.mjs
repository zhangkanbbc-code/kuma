import assert from 'node:assert/strict'
import test from 'node:test'

import routeStats from '../dist/shared/route-stats.js'

const { branchTallyByLetter, pathWalkedBound } = routeStats

// 真实形状：0 号是「进入出发点」的伪边，出发点自己在 spots 里叫 '1'。
// 6/13 两条边都通向 F —— 3-5 就是这样，这正是不能按 from_cell 分组的原因。
const ROUTE = {
  0: [null, '1'],
  1: ['1', 'F'],
  6: ['F', 'G'],
  7: ['F', 'K'],
  13: ['F', 'G'],
  20: ['G', 'Z'],
}

test('branch tallies group by the spot you were standing on, not by which edge you arrived by', () => {
  // 站在 F 往下走过 5 次：4 次去 G（其中 3 次记在 6 号边、1 次记在 13 号边）、1 次去 K。
  // 按 from_cell 分组会把这 5 次拆开，看上去像两个不相干的点。
  const tally = branchTallyByLetter(
    {
      1: { 6: 3, 7: 1 },
      13: { 13: 1 },
    },
    ROUTE,
  )
  assert.deepEqual(tally.get('F'), {
    total: 5,
    to: [
      { letter: 'G', count: 4 },
      { letter: 'K', count: 1 },
    ],
  })
})

test('the departure step is attributed to the start spot the fleet actually left from', () => {
  // from_cell = -1（出发点）：站着的那个点由这一步那条边自己的起点决定，
  // 双起点图靠这一条才分得清走的是 1 还是 2。
  const tally = branchTallyByLetter({ '-1': { 1: 7 } }, ROUTE)
  assert.equal(tally.get('1')?.total, 7)
  assert.deepEqual(tally.get('1')?.to, [{ letter: 'F', count: 7 }])
})

test('edges missing from the fcd table are skipped rather than pinned to a guessed spot', () => {
  const tally = branchTallyByLetter({ 1: { 999: 4, 6: 2 } }, ROUTE)
  assert.equal(tally.get('F')?.total, 2)
  assert.equal(tally.size, 1)
  assert.equal(branchTallyByLetter(null, ROUTE).size, 0)
  assert.equal(branchTallyByLetter({ 1: { 6: 2 } }, null).size, 0)
})

test('a whole path is bounded by its narrowest step, and says 0 when a step was never taken', () => {
  const tally = branchTallyByLetter({ '-1': { 1: 9 }, 1: { 6: 4, 7: 1 }, 6: { 20: 2 } }, ROUTE)
  // 1→F 9 次、F→G 4 次、G→Z 2 次 ⇒ 整条至多 2 次
  assert.equal(pathWalkedBound(tally, ['1', 'F', 'G', 'Z']), 2)
  // F→K 走过 1 次，但 K 之后没有记录 ⇒ 该步不存在，整条 0
  assert.equal(pathWalkedBound(tally, ['1', 'F', 'K', 'Z']), 0)
  // 单点谈不上「走成过」
  assert.equal(pathWalkedBound(tally, ['F']), null)
})
