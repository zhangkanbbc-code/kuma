import assert from 'node:assert/strict'
import test from 'node:test'

import {
  patchMapGaugeFromBattleResult,
  patchMapGaugeFromSortiePayload,
} from '../dist/shared/map-gauge.js'

const gauge = (overrides = {}) => ({
  cleared: false,
  defeated: null,
  required: null,
  hpNow: 600,
  hpMax: 600,
  selectedRank: 4,
  gaugeType: 2,
  gaugeNum: 1,
  ...overrides,
})

test('sortie payloads refresh event HP without erasing difficulty or gauge stage', () => {
  const current = gauge()
  const next = patchMapGaugeFromSortiePayload(current, {
    api_eventmap: {
      api_now_maphp: 455,
      api_max_maphp: 600,
    },
  })
  assert.deepEqual(next, gauge({ hpNow: 455 }))
})

test('transport results accept numeric strings and apply authoritative TP instead of boss damage', () => {
  const next = patchMapGaugeFromBattleResult(gauge({ gaugeType: 3 }), {
    isBoss: true,
    firstClear: false,
    enemyFlagshipSunk: true,
    flagshipHpStart: 770,
    flagshipHpEnd: 0,
    landingHp: {
      api_now_hp: '500',
      api_max_hp: '600',
      api_sub_value: '82',
    },
  })
  assert.deepEqual(next, gauge({ hpNow: 418, gaugeType: 3 }))
})

test('transport gauges never fall back to enemy flagship damage without landing data', () => {
  const current = gauge({ hpNow: 500, gaugeType: 3 })
  assert.equal(
    patchMapGaugeFromBattleResult(current, {
      isBoss: true,
      firstClear: false,
      enemyFlagshipSunk: true,
      flagshipHpStart: 770,
      flagshipHpEnd: 0,
    }),
    current,
  )
})

test('boss HP gauges use real flagship damage and require a real sinking blow at zero', () => {
  const chipped = patchMapGaugeFromBattleResult(gauge({ hpNow: 200 }), {
    isBoss: true,
    firstClear: false,
    enemyFlagshipSunk: false,
    flagshipHpStart: 330,
    flagshipHpEnd: 180,
  })
  assert.equal(chipped.hpNow, 50)

  const notKilled = patchMapGaugeFromBattleResult(gauge({ hpNow: 40 }), {
    isBoss: true,
    firstClear: false,
    enemyFlagshipSunk: false,
    flagshipHpStart: 330,
    flagshipHpEnd: 280,
  })
  assert.equal(notKilled.hpNow, 1)

  const killed = patchMapGaugeFromBattleResult(gauge({ hpNow: 40 }), {
    isBoss: true,
    firstClear: true,
    enemyFlagshipSunk: true,
    flagshipHpStart: 330,
    flagshipHpEnd: 0,
  })
  assert.equal(killed.hpNow, 0)
  assert.equal(killed.cleared, true)
})

test('non-boss battles do not consume HP gauges while boss kills advance count gauges', () => {
  const current = gauge({ hpNow: 300 })
  assert.equal(
    patchMapGaugeFromBattleResult(current, {
      isBoss: false,
      firstClear: false,
      enemyFlagshipSunk: true,
      flagshipHpStart: 100,
      flagshipHpEnd: 0,
    }),
    current,
  )

  const counted = patchMapGaugeFromBattleResult(
    gauge({ hpNow: null, hpMax: null, defeated: 2, required: 5 }),
    {
      isBoss: true,
      firstClear: false,
      enemyFlagshipSunk: true,
      flagshipHpStart: 100,
      flagshipHpEnd: 0,
    },
  )
  assert.equal(counted.defeated, 3)
})
