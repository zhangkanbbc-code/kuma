import assert from 'node:assert/strict'
import test from 'node:test'
import consumables from '../dist/shared/sortie-consumables.js'
import restore from '../dist/shared/sortie-restore.js'
import { state, newSortie, handle } from './fixtures/store-offshore-reducers.mjs'

const { SORTIE_CONSUMABLE_MST_IDS, diffConsumedInstances } = consumables
const ship = (rosterId, slots) => ({ rosterId, slots })
const mstIdOf = id => ({ 11: 145, 12: 42, 13: 1, 14: 146, 15: 43, 16: 150, 17: 241 })[id]

test('六种消耗品：只有消失且在名单内的实例才算，输入保持原样', () => {
  assert.deepEqual(SORTIE_CONSUMABLE_MST_IDS, [42, 43, 145, 150, 241, 146])
  const before = [ship(1, [11, 12, 13, 14, 15, 16, 17, -1, 0])]
  const copy = structuredClone(before)
  assert.deepEqual(diffConsumedInstances(before, [ship(1, [12])], mstIdOf),
    [11, 14, 15, 16, 17].map(instId => ({ rosterId: 1, instId, mstId: mstIdOf(instId) })))
  assert.deepEqual(before, copy)
})
test('挪到同包另一舰不算', () => {
  assert.deepEqual(diffConsumedInstances([ship(1, [11]), ship(2, [])], [ship(1, []), ship(2, [11])], mstIdOf), [])
})
test('名单外或实例表缺失的装备消失不算', () => {
  assert.deepEqual(diffConsumedInstances([ship(1, [13, 999])], [ship(1, [])], mstIdOf), [])
})
test('after 没出现的舰不算', () => {
  assert.deepEqual(diffConsumedInstances([ship(1, [11]), ship(2, [12])], [ship(2, [12])], mstIdOf), [])
})
test('增设位消失算，同舰移格不算', () => {
  assert.deepEqual(diffConsumedInstances([ship(1, [-1, -1, 12])], [ship(1, [-1, -1, 0])], mstIdOf),
    [{ rosterId: 1, instId: 12, mstId: 42 }])
  assert.deepEqual(diffConsumedInstances([ship(1, [11, -1])], [ship(1, [-1, 11])], mstIdOf), [])
})

const seed = (mstId = 145, partial = {}) => {
  state.player.ships = {
    1: { id: 1, shipId: 10, cond: 49, slot: [11], slotEx: 0 },
    2: { id: 2, shipId: 20, cond: 49, slot: [12], slotEx: 0 },
  }
  state.player.slotitems = { 11: { mstId }, 12: { mstId: 150 } }
  state.master.ships = { 10: { name: '赤城' }, 20: { name: '加賀' } }
  state.player.decks = []
  state.sortie = newSortie({ currentCell: 4, battleCount: 2,
    nodes: [{ cell: 4, rationUsed: true, note: '战斗粮食已用' }], ...partial })
}
const rawShip = (id = 1, slots = [-1], extra = {}) => ({
  api_id: id, api_ship_id: id * 10, api_slot: slots, api_slot_ex: 0, api_cond: 63, ...extra,
})
const feed = (ships = [rawShip()], api = 'ship_deck', ts = 123) => handle(`/kcsapi/api_get_member/${api}`,
  api === 'ship2' ? ships : { api_ship_data: ships, api_deck_data: [] }, {}, ts)

for (const api of ['ship_deck', 'ship2', 'ship3']) test(`${api} 出击中粮食消失：删实例、记消耗、点舰名，士气取报文真值`, () => {
  seed()
  const sections = feed([rawShip()], api)
  assert.equal(state.player.slotitems[11], undefined)
  assert.deepEqual(state.sortie.consumedItems, [{ rosterId: 1, mstId: 145, cell: 4, battleCount: 2, ts: 123 }])
  assert.deepEqual(state.sortie.nodes[0].rationShips, [1])
  assert.equal(state.sortie.nodes[0].note, '战斗粮食已用 · 赤城')
  assert.equal(state.player.ships[1].cond, 63)
  assert.deepEqual(state.player.ships[1].slot, [-1])
  for (const section of ['ships', 'slotitems', 'sortie']) assert.ok(sections.includes(section))
  feed([rawShip()], api, 124)
  assert.equal(state.sortie.consumedItems.length, 1, '重复报文不得重复记账')
})
for (const mode of ['无出击', '母港卸装', '演习']) test(`${mode} 不删消耗品实例、不记消耗，士气照常更新`, () => {
  seed(145, mode === '演习' ? { practice: true } : { active: false })
  if (mode === '无出击') state.sortie = null
  const sections = feed()
  assert.equal(state.player.slotitems[11].mstId, 145)
  assert.deepEqual(state.sortie?.consumedItems ?? [], [])
  assert.equal(state.player.ships[1].cond, 63)
  assert.ok(!sections.includes('slotitems'))
})
for (const mstId of [42, 43, 146]) test(`${mstId} 消失只删实例与记录，节点备注不变`, () => {
  seed(mstId)
  feed()
  assert.equal(state.player.slotitems[11], undefined)
  assert.deepEqual(state.sortie.consumedItems, [{ rosterId: 1, mstId, cell: 4, battleCount: 2, ts: 123 }])
  assert.equal(state.sortie.nodes[0].note, '战斗粮食已用')
  assert.equal(state.sortie.nodes[0].rationShips, undefined)
})
test('多个舰分包消耗、同舰多个饭团：最近标记节点累计舰名且去重，其他备注保留', () => {
  seed(241, { nodes: [
    { cell: 2, rationUsed: true, note: '战斗粮食已用' },
    { cell: 3, rationUsed: true, note: '获得 燃料×5 · 战斗粮食已用 · 涡潮 燃料 -43' },
    { cell: 4, note: null },
  ] })
  state.player.ships[1].slotEx = 13
  state.player.slotitems[13] = { mstId: 145 }
  feed()
  feed([rawShip(2)])
  assert.equal(state.sortie.consumedItems.length, 3)
  assert.deepEqual(state.sortie.nodes[1].rationShips, [1, 2])
  assert.equal(state.sortie.nodes[1].note, '获得 燃料×5 · 战斗粮食已用 · 赤城、加賀 · 涡潮 燃料 -43')
  assert.equal(state.sortie.nodes[0].note, '战斗粮食已用')
  assert.equal(state.sortie.nodes[2].note, null)
})
test('没有 rationUsed 时落当前节点；同包多舰粮食合列', () => {
  seed(145, { nodes: [{ cell: 4, note: null }] })
  feed([rawShip(), rawShip(2)])
  assert.deepEqual(state.sortie.nodes[0].rationShips, [1, 2])
  assert.equal(state.sortie.nodes[0].note, '战斗粮食已用 · 赤城、加賀')
})
test('store 同包移舰与未出现舰均不误删', () => {
  seed()
  feed([rawShip(), rawShip(2, [12, 11])])
  assert.deepEqual(state.sortie.consumedItems, [])
  assert.equal(state.player.slotitems[11].mstId, 145)
  seed()
  feed([rawShip(2, [12])])
  assert.equal(state.player.slotitems[11].mstId, 145)
  assert.deepEqual(state.sortie.consumedItems, [])
})
test('洋上补给估算已删的 id 回到舰上时不猜测恢复实例', () => {
  seed(146)
  delete state.player.slotitems[11]
  state.player.ships[1].slot = [-1]
  feed([rawShip(1, [11])])
  assert.deepEqual(state.player.ships[1].slot, [11])
  assert.equal(state.player.slotitems[11], undefined)
  assert.deepEqual(state.sortie.consumedItems, [])
})
test('新出击消耗记录为空且数组独立；旧快照补空，已有记录保留', () => {
  const first = newSortie({})
  const second = newSortie({})
  assert.deepEqual(first.consumedItems, [])
  assert.notEqual(first.consumedItems, second.consumedItems)
  assert.deepEqual(restore.restoreSortieAcrossRestart({ active: true }).consumedItems, [])
  const items = [{ rosterId: 1, mstId: 145, cell: 4, battleCount: 2, ts: 123 }]
  assert.equal(restore.restoreSortieAcrossRestart({ consumedItems: items }).consumedItems, items)
})
