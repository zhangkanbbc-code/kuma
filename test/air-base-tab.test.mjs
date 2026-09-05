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

const squad = (actionKind, planes) => ({ actionKind, planes })

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
