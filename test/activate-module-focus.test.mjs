import assert from 'node:assert/strict'
import test from 'node:test'

import { activateModule, reset, snapshot } from './fixtures/activate-module.mjs'

test.beforeEach(reset)

test('自动切页在专注态只换 active，不退出专注也不展开坞', () => {
  activateModule('bi', { auto: true })
  assert.deepEqual(snapshot(), {
    focus: true,
    collapsed: { left: true, right: true, bottom: true },
    active: 'bi',
    removedClasses: [],
  })
})

test('玩家导航照旧退出专注、展开所在坞并切到目标页', () => {
  activateModule('bi')
  assert.deepEqual(snapshot(), {
    focus: false,
    collapsed: { left: true, right: true, bottom: false },
    active: 'bi',
    removedClasses: ['focus'],
  })
})
