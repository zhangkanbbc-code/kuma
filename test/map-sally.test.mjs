import assert from 'node:assert/strict'
import test from 'node:test'

import mapSally from '../dist/shared/map-sally.js'

const { decodeMapFleetAllowance, mapFleetAllowanceLabels } = mapSally

test('map sally flags decode normal, combined bitmasks, and seven-ship strike forces', () => {
  assert.deepEqual(decodeMapFleetAllowance([1, 0, 0]), {
    normal: true,
    carrierTaskForce: false,
    surfaceTaskForce: false,
    transportEscort: false,
    strikingForce: false,
  })
  assert.deepEqual(mapFleetAllowanceLabels([1, 7, 1]), [
    '通常舰队',
    '空母机动部队',
    '水上打击部队',
    '输送护卫部队',
    '七舰游击部队',
  ])
})
