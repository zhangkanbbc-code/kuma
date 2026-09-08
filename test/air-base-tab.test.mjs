import assert from 'node:assert/strict'
import test from 'node:test'

import airBaseTab from '../dist/shared/air-base-tab.js'

const { airBaseTabGlow } = airBaseTab

const plane = (patch = {}) => ({
  slotId: 1,
  count: 18,
  maxCount: 18,
  cond: 0,
  ...patch,
})

const squad = (actionKind, planes, areaId = 6) => ({ areaId, actionKind, planes })

test('被打空报红：待机中队也不能藏掉已经归零的机位', () => {
  assert.equal(airBaseTabGlow([squad(0, [plane({ count: 0 })])]), 'bad')
})

test('出击中的中队未补给报黄', () => {
  assert.equal(airBaseTabGlow([squad(1, [plane({ count: 17 })])]), 'warn')
})

test('只有待机中队未补给不亮黄', () => {
  assert.equal(airBaseTabGlow([squad(0, [plane({ count: 17 })])]), null)
})

test('全部满载且没有疲劳不着色', () => {
  assert.equal(
    airBaseTabGlow([
      squad(1, [plane()]),
      squad(2, [plane({ slotId: 2 })]),
      squad(0, [plane({ slotId: 3 })]),
    ]),
    null,
  )
})

test('打空与未补给并存时红色优先', () => {
  assert.equal(
    airBaseTabGlow([
      squad(0, [plane({ count: 0 })]),
      squad(1, [plane({ slotId: 2, count: 17 })]),
    ]),
    'bad',
  )
})

test('静默海域的未补给与红橙疲劳均不点黄', () => {
  for (const patch of [{ count: 17 }, { cond: 2 }, { cond: 3 }]) {
    assert.equal(airBaseTabGlow([squad(1, [plane(patch)])], { mutedAreas: [6] }), null)
  }
})

test('静默海域被打空不点红、未静默海域仍点红，包括待机中队', () => {
  for (const action of [0, 1, 2]) {
    const wiped = squad(action, [plane({ count: 0 })])
    assert.equal(airBaseTabGlow([wiped], { mutedAreas: [6] }), null)
    assert.equal(airBaseTabGlow([wiped], { mutedAreas: [] }), 'bad')
    assert.equal(airBaseTabGlow([wiped, squad(action, [plane({ count: 0 })], 7)], { mutedAreas: [6] }), 'bad')
    assert.equal(airBaseTabGlow([wiped, squad(1, [plane({ count: 17 })], 7)], { mutedAreas: [6] }), 'warn')
  }
})

test('静默一个海域不影响其它海域的未就绪提醒', () => {
  assert.equal(airBaseTabGlow([
    squad(1, [plane({ cond: 3 })]),
    squad(2, [plane({ count: 17 })], 7),
  ], { mutedAreas: [6] }), 'warn')
})
