import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'

const built = buildSync({
  entryPoints: ['src/shared/sortie-supply-cost.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
})
const module = { exports: {} }
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports)
const { calculateSortieSupplyCost, mergeSortieSupplyCosts } = module.exports

test('sortie supply costs require every deployed ship and preserve exact fuel/ammo deltas', () => {
  const baseline = [
    { rosterId: 11, fuel: 30, ammo: 40 },
    { rosterId: 12, fuel: 15, ammo: 20 },
  ]
  assert.deepEqual(
    calculateSortieSupplyCost(baseline, [
      { rosterId: 11, fuel: 24, ammo: 32 },
      { rosterId: 12, fuel: 12, ammo: 16 },
    ]),
    { fuel: 9, ammo: 12 },
  )
  assert.equal(
    calculateSortieSupplyCost(baseline, [{ rosterId: 11, fuel: 24, ammo: 32 }]),
    null,
  )
})

test('historical recovery keeps the stronger of ship-deck and resupply evidence', () => {
  assert.deepEqual(
    mergeSortieSupplyCosts(
      { fuel: 50, ammo: 64 },
      { fuel: 47, ammo: 61 },
    ),
    { fuel: 50, ammo: 64 },
  )
  assert.deepEqual(
    mergeSortieSupplyCosts(
      { fuel: 76, ammo: 104 },
      { fuel: 105, ammo: 169 },
    ),
    { fuel: 105, ammo: 169 },
  )
})
