import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'

const built = buildSync({
  entryPoints: ['src/shared/equipability.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
})
const module = { exports: {} }
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports)
const {
  equipableFriendlyShipIds,
  equipableTypeRulesForShip,
  shipCanEquipItem,
} = module.exports

const master = {
  api_mst_ship: [
    { api_id: 1, api_sortno: 1, api_stype: 2 },
    { api_id: 2, api_sortno: 2, api_stype: 2 },
    { api_id: 3, api_sortno: 3, api_stype: 3 },
    { api_id: 1500, api_sortno: 0, api_stype: 2 },
  ],
  api_mst_stype: [
    { api_id: 2, api_equip_type: { 24: 0, 30: 1 } },
    { api_id: 3, api_equip_type: { 24: 0, 30: 1 } },
  ],
  api_mst_slotitem: [
    { api_id: 68, api_type: [8, 14, 24, 20, 0] },
    { api_id: 75, api_type: [9, 19, 30, 25, 0] },
    { api_id: 355, api_type: [8, 45, 24, 20, 0] },
  ],
  api_mst_equip_ship: {
    2: { api_equip_type: { 24: [68], 30: null } },
    3: { api_equip_type: { 24: null } },
  },
}

test('ship-specific equipability overrides the ship-type defaults', () => {
  assert.deepEqual(equipableTypeRulesForShip(master, 1), [{ id: 30, only: null }])
  assert.deepEqual(equipableTypeRulesForShip(master, 2), [
    { id: 24, only: [68] },
    { id: 30, only: null },
  ])
  assert.deepEqual(equipableTypeRulesForShip(master, 3), [{ id: 24, only: null }])
})

test('specific equipment limits are applied to reverse ship lookups', () => {
  assert.equal(shipCanEquipItem(master, 2, 68), true)
  assert.equal(shipCanEquipItem(master, 2, 355), false)
  assert.equal(shipCanEquipItem(master, 3, 68), true)
  // 舰 3 的单舰矩阵没有运输桶类别；不能再回退舰种默认把它放进来。
  assert.equal(shipCanEquipItem(master, 3, 75), false)
  assert.deepEqual(equipableFriendlyShipIds(master, 75), [1, 2])
  assert.deepEqual(equipableFriendlyShipIds(master, 68), [2, 3])
})
