import assert from 'node:assert/strict'
import test from 'node:test'

import combinedFleetModule from '../dist/shared/combined-fleet.js'

const { combinedFleetTypeFromMutation } = combinedFleetModule

test('combined activation flag does not overwrite the requested fleet type', () => {
  assert.equal(combinedFleetTypeFromMutation(0, 1, 1), 1)
  assert.equal(combinedFleetTypeFromMutation(0, 1, 2), 2)
  assert.equal(combinedFleetTypeFromMutation(0, 1, 3), 3)
})

test('combined deactivation clears the type and incomplete legacy events preserve it', () => {
  assert.equal(combinedFleetTypeFromMutation(3, 0, 0), 0)
  assert.equal(combinedFleetTypeFromMutation(3, 1, undefined), 3)
})
