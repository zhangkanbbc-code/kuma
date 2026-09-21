import assert from 'node:assert/strict'
import test from 'node:test'

import target from '../dist/shared/sortie-boss.js'

const { bossLettersOf, reachableSpots, sortieBossTarget } = target

const route75 = {"0":[null,"1"],"1":["1","A"],"2":["A","B"],"3":["B","C"],"4":["B","D"],"5":["D","E"],"6":["D","F"],"7":["F","G"],"8":["G","H"],"9":["H","I"],"10":["F","J"],"11":["H","K"],"12":["C","D"],"13":["E","F"],"14":["I","L"],"15":["I","M"],"16":["J","N"],"17":["N","O"],"18":["O","P"],"19":["O","Q"],"20":["L","M"],"21":["J","O"],"22":["P","R"],"23":["P","S"],"24":["P","T"],"25":["R","T"]}
const pairsToCells = (pairs) => pairs.map(([no, color]) => ({ no, color }))
const phase2 = pairsToCells([[0,0],[1,10],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,5],[12,4],[13,4],[14,4],[15,4],[16,4],[17,4],[18,4],[19,5],[20,4],[21,4]])
const phase1 = phase2.slice(0, 14)
const phase3 = Array.from({ length: 26 }, (_, no) => ({
  no,
  color: no === 11 || no === 19 || no === 24 ? 5 : no === 1 ? 10 : no === 0 ? 0 : 4,
}))

test('7-5 第 1 血条在出发点以 K 为 Boss', () => {
  const bossLetters = bossLettersOf(phase1, route75)
  assert.deepEqual(bossLetters, ['K'])
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 1, reachable: reachableSpots(route75, '1') }), 'K')
})

test('7-5 第 2 血条按当前位置选可达 Boss', () => {
  const bossLetters = bossLettersOf(phase2, route75)
  assert.deepEqual(bossLetters, ['K', 'Q'])
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 2, reachable: reachableSpots(route75, '1') }), 'Q')
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 2, reachable: reachableSpots(route75, 'O') }), 'Q')
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 2, reachable: reachableSpots(route75, 'H') }), 'K')
})

test('7-5 第 3 血条在 Q 点没有仍可达的 Boss', () => {
  const bossLetters = bossLettersOf(phase3, route75)
  assert.deepEqual(bossLetters, ['K', 'Q', 'T'])
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 3, reachable: reachableSpots(route75, '1') }), 'T')
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 3, reachable: reachableSpots(route75, 'Q') }), null)
})

test('血条号超过已揭开的 Boss 数时夹到最后一个', () => {
  assert.equal(sortieBossTarget({ bossLetters: ['K', 'Q'], gaugeNum: 3, reachable: null }), 'Q')
})

test('血条号未知时取第一个 Boss', () => {
  assert.equal(sortieBossTarget({ bossLetters: ['K', 'Q'], gaugeNum: null, reachable: null }), 'K')
})

test('多入边的单 Boss 字母去重', () => {
  const route = {"11":["H","K"],"17":["N","K"],"18":["J","K"]}
  assert.deepEqual(bossLettersOf(pairsToCells([[18, 5], [11, 5], [17, 5]]), route), ['K'])
})

test('没有色 5 边时没有 Boss 目标', () => {
  const bossLetters = bossLettersOf(pairsToCells([[0, 0], [1, 10], [2, 4]]), route75)
  assert.deepEqual(bossLetters, [])
  assert.equal(sortieBossTarget({ bossLetters, gaugeNum: 1, reachable: reachableSpots(route75, '1') }), null)
})

test('route 中不存在的色 5 边号跳过', () => {
  assert.deepEqual(bossLettersOf(pairsToCells([[11, 5], [99, 5], [19, 5]]), route75), ['K', 'Q'])
})

test('不提供可达集合时直接返回血条候选', () => {
  assert.equal(sortieBossTarget({ bossLetters: ['K', 'Q', 'T'], gaugeNum: 2, reachable: null }), 'Q')
})
