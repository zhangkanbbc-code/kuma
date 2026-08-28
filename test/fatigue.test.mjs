import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSync } from 'esbuild'

const built = buildSync({
  entryPoints: ['src/renderer/fatigue.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
})
const module = { exports: {} }
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports)
const {
  FATIGUE_READY_COND,
  RED_FATIGUE_COND,
  estimatedCond,
  fatigueBand,
  fatigueReadyTs,
  observeFatigue,
} = module.exports

test('fatigue bands follow the game red, orange, and ready boundaries', () => {
  assert.equal(RED_FATIGUE_COND, 20)
  assert.equal(FATIGUE_READY_COND, 30)
  assert.equal(fatigueBand(19), 'red')
  assert.equal(fatigueBand(20), 'orange')
  assert.equal(fatigueBand(29), 'orange')
  assert.equal(fatigueBand(30), 'ready')
})

test('fatigue recovery reminders default to condition 30', () => {
  const observedAt = 1_000_000
  observeFatigue([{ id: 7, cond: 17 }], observedAt, true)
  assert.equal(fatigueReadyTs(7), observedAt + 5 * 180_000)
  assert.equal(estimatedCond(7, FATIGUE_READY_COND, observedAt + 4 * 180_000), 29)
  assert.equal(estimatedCond(7, FATIGUE_READY_COND, observedAt + 5 * 180_000), 30)
})
