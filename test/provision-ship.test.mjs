// 母港给粮舰（野埼计时器）的纯判据与回港落账探测。
// 直接 import 构建后的真模块；位置、门槛、判定顺序与 >49 证据都按行为钉住。
import assert from 'node:assert/strict'
import test from 'node:test'

import provision from '../dist/shared/provision-ship.js'

const {
  PROVISION_COND_CAP,
  PROVISION_MIN_COND,
  PROVISION_SHIPS,
  PROVISION_WARMUP_MS,
  provisionBanked,
  provisionEstimate,
  provisionHalt,
  provisionShipAt,
} = provision

const mst = new Map([[101, 996], [102, 1002], [103, 988], [104, 1]])
const mstOf = (id) => mst.get(id)

test('只认 0/1 位的野埼与野埼改；两位都有时旗舰优先', () => {
  assert.deepEqual(provisionShipAt([101, 102, -1], mstOf), { rosterId: 101, index: 0, gain: 2 })
  assert.deepEqual(provisionShipAt([104, 102, 101], mstOf), { rosterId: 102, index: 1, gain: 3 })
  assert.equal(provisionShipAt([104, -1, 101], mstOf), null, '3 号位以后不算')
  assert.equal(provisionShipAt([103, 104], mstOf), null, '南海 mst 988 同为舰种 22，也不是给粮舰')
})

test('停摆五种原因按远征→在渠→未补给→小破→疲劳的顺序判，全部通过才是 null', () => {
  const healthy = { nowhp: 40, maxhp: 40, cond: 30, fuel: 10, bull: 10 }
  const idle = { onMission: false, flagDocked: false, fuelMax: 10, bullMax: 10 }
  assert.equal(provisionHalt(healthy, { ...idle, onMission: true, flagDocked: true }), 'mission')
  assert.equal(provisionHalt(healthy, { ...idle, flagDocked: true, fuelMax: 20 }), 'flagDocked')
  assert.equal(provisionHalt({ ...healthy, fuel: 9, nowhp: 20, cond: 1 }, idle), 'flagUnsupplied')
  assert.equal(provisionHalt({ ...healthy, nowhp: 30, cond: 1 }, idle), 'flagHurt')
  assert.equal(provisionHalt({ ...healthy, cond: 29 }, idle), 'flagTired')
  assert.equal(provisionHalt(healthy, idle), null)
})

test('估算按单次增量增加并封顶 54', () => {
  assert.equal(provisionEstimate(49, 3), 52)
  assert.equal(provisionEstimate(53, 3), 54)
  assert.equal(PROVISION_COND_CAP, 54)
  assert.equal(PROVISION_MIN_COND, 30)
  assert.equal(PROVISION_WARMUP_MS, 15 * 60_000)
  assert.deepEqual(PROVISION_SHIPS, { 996: 2, 1002: 3 })
})

const DECK = [{ id: 1, ships: [101, 104, -1] }]

test('回港 49→52 越过自然回复封顶，认作给粮舰结账', () => {
  assert.equal(
    provisionBanked(DECK, new Map([[101, 40], [104, 49]]), new Set(), new Map([[101, 40], [104, 52]]), mstOf),
    true,
  )
})

test('回港 40→46 与自然回复分不开，故意不认', () => {
  assert.equal(
    provisionBanked(DECK, new Map([[101, 40], [104, 40]]), new Set(), new Map([[101, 40], [104, 46]]), mstOf),
    false,
  )
})

test('在渠舰的上涨不认', () => {
  assert.equal(
    provisionBanked(DECK, new Map([[101, 40], [104, 49]]), new Set([104]), new Map([[101, 40], [104, 52]]), mstOf),
    false,
  )
})

test('给粮舰自己涨了不认', () => {
  assert.equal(
    provisionBanked(DECK, new Map([[101, 49], [104, 49]]), new Set(), new Map([[101, 52], [104, 49]]), mstOf),
    false,
  )
})

test('0/1 位没有给粮舰不认', () => {
  const decks = [{ id: 1, ships: [104, 103, 101] }]
  assert.equal(
    provisionBanked(decks, new Map([[104, 49]]), new Set(), new Map([[104, 52]]), mstOf),
    false,
  )
})
