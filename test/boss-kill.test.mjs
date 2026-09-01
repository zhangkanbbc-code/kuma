// 「谁给了 boss 最后一击」的归属。
//
// 这里钉住的是**归属纪律**：只有 side=0 且 attacker>=0 的那一击才落到单舰头上；
// 航空/支援是阶段伤害，报文本来就没给逐舰归属，不摊给任何人；
// NPC 友军 / 敌方终结敌旗舰一律当异常处理——不写归属，交给调用方 warn。
import assert from 'node:assert/strict'
import test from 'node:test'

import bossKill from '../dist/shared/boss-kill.js'

const { resolveBossKill, enemyFlagshipOf, bossKillAnomalyText } = bossKill

// 敌单队 6 舰
const single = [0, 1, 2, 3, 4, 5].map((i) => ({
  index: i,
  fleet: 'main',
  position: i,
  mstId: 1500 + i,
}))
// 敌联合 12 舰：主力 0-5 + 护卫 6-11。旗舰仍是主力 #0。
const combined = [
  ...single,
  ...[0, 1, 2, 3, 4, 5].map((i) => ({
    index: 6 + i,
    fleet: 'escort',
    position: i,
    mstId: 1600 + i,
  })),
]

let seq = 0
const atk = (phase, side, attacker, hits, stage = 1) => ({
  phase,
  side,
  attacker,
  stage,
  action: seq++,
  hits: hits.map((h) => ({ target: h.target, sunk: h.sunk === true })),
})
const reset = () => {
  seq = 0
}

test('敌旗舰认的是主力 #0，联合敌军也一样', () => {
  assert.equal(enemyFlagshipOf(single)?.mstId, 1500)
  assert.equal(enemyFlagshipOf(combined)?.mstId, 1500)
  assert.equal(enemyFlagshipOf(combined)?.index, 0)
  assert.equal(enemyFlagshipOf([]), null)
})

test('单队 · 昼战炮击终结：归到那一舰位', () => {
  reset()
  const verdict = resolveBossKill(single, [
    atk('gun1', 0, 3, [{ target: 2, sunk: true }]),
    atk('gun1', 0, 1, [{ target: 0, sunk: true }]),
  ])
  assert.equal(verdict.flagshipIndex, 0)
  assert.equal(verdict.flagshipMstId, 1500)
  assert.equal(verdict.flagshipSunk, true)
  assert.deepEqual(verdict.agent, { kind: 'ship', index: 1 })
  assert.equal(verdict.at.phase, 'gun1')
  assert.deepEqual(verdict.anomalies, [])
})

test('夜战终结：昼战没打死，夜战那一击才是终点（按 stage/action 排序，不看数组顺序）', () => {
  reset()
  // 故意把夜战那一击排在数组前面：真实顺序只由 stage/action 说了算
  const night = atk('night', 0, 4, [{ target: 0, sunk: true }], 5)
  const day = atk('gun2', 0, 2, [{ target: 3, sunk: true }], 3)
  const verdict = resolveBossKill(single, [night, day])
  assert.deepEqual(verdict.agent, { kind: 'ship', index: 4 })
  assert.equal(verdict.at.phase, 'night')
})

test('联合舰队护卫队出终结：视图舰位 >= 6 原样带出，不被折回主力', () => {
  reset()
  const verdict = resolveBossKill(combined, [
    atk('night', 0, 10, [{ target: 0, sunk: true }], 6),
  ])
  assert.deepEqual(verdict.agent, { kind: 'ship', index: 10 })
})

test('航空终结：attacker=-1，不归任何一舰', () => {
  for (const phase of ['air', 'air2', 'lbas', 'injection']) {
    reset()
    const verdict = resolveBossKill(single, [atk(phase, 0, -1, [{ target: 0, sunk: true }])])
    assert.deepEqual(verdict.agent, { kind: 'aircraft', phase }, phase)
    assert.equal(verdict.flagshipSunk, true)
    assert.deepEqual(verdict.anomalies, [], `${phase} 不是异常，只是没有逐舰归属`)
  }
})

test('支援终结：同样不归任何一舰', () => {
  reset()
  const verdict = resolveBossKill(single, [atk('support', 0, -1, [{ target: 0, sunk: true }])])
  assert.deepEqual(verdict.agent, { kind: 'support', phase: 'support' })
  assert.deepEqual(verdict.anomalies, [])
})

test('NPC 友军终结敌旗舰：登记异常、不写归属（机制说不该发生，但不硬编成「打不死」）', () => {
  reset()
  const verdict = resolveBossKill(single, [
    atk('friendly', 2, 1, [{ target: 0, sunk: true }], 4),
  ])
  assert.equal(verdict.flagshipSunk, true, '数据说沉了就是沉了，不改写事实')
  assert.equal(verdict.agent, null, '归属留空')
  assert.equal(verdict.anomalies.length, 1)
  assert.equal(verdict.anomalies[0].kind, 'npc-final-blow')
  assert.match(bossKillAnomalyText(verdict.anomalies[0]), /友军/)
})

test('敌方打沉敌旗舰：舰位错位的征兆，同样只登记异常', () => {
  reset()
  const verdict = resolveBossKill(single, [atk('gun1', 1, 2, [{ target: 0, sunk: true }])])
  assert.equal(verdict.agent, null)
  assert.equal(verdict.anomalies[0].kind, 'enemy-final-blow')
})

test('多条终结击：取最后一条，并把「多条」记成异常', () => {
  reset()
  const verdict = resolveBossKill(single, [
    atk('gun1', 0, 1, [{ target: 0, sunk: true }], 2),
    atk('night', 0, 5, [{ target: 0, sunk: true }], 5),
  ])
  assert.deepEqual(verdict.agent, { kind: 'ship', index: 5 }, '最后那一次才是这一战的终点')
  assert.equal(verdict.anomalies.length, 1)
  assert.equal(verdict.anomalies[0].kind, 'multiple-final-blows')
  assert.equal(verdict.anomalies[0].count, 2)
})

test('名单外的无归属阶段：不猜档，登记异常', () => {
  reset()
  const verdict = resolveBossKill(single, [
    atk('someNewPhase', 0, -1, [{ target: 0, sunk: true }]),
  ])
  assert.equal(verdict.agent, null)
  assert.equal(verdict.anomalies[0].kind, 'unattributed-phase')
})

test('boss 没沉：flagshipSunk=false，归属留空，不算异常', () => {
  reset()
  const verdict = resolveBossKill(single, [
    atk('gun1', 0, 1, [{ target: 0, sunk: false }]),
    atk('gun1', 0, 2, [{ target: 1, sunk: true }]),
  ])
  assert.equal(verdict.flagshipSunk, false)
  assert.equal(verdict.agent, null)
  assert.equal(verdict.at, null)
  assert.deepEqual(verdict.anomalies, [])
})

test('沉的是护卫旗舰不是敌旗舰：一样算 boss 没沉', () => {
  reset()
  const verdict = resolveBossKill(combined, [
    atk('gun1', 0, 1, [{ target: 6, sunk: true }]),
  ])
  assert.equal(verdict.flagshipSunk, false)
  assert.equal(verdict.agent, null)
})

test('敌表为空：返回 null（这场压根没得判，不是「没人终结」）', () => {
  reset()
  assert.equal(resolveBossKill([], [atk('gun1', 0, 1, [{ target: 0, sunk: true }])]), null)
})
