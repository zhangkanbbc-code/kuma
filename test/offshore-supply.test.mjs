import assert from 'node:assert/strict'
import test from 'node:test'
import { state, newSortie, handle, describeDeltaDetail, OFFSHORE_SUPPLY_RATES, planOffshoreSupply,
  planOffshoreSupplyConsumption, offshoreSupplyNote, rationNote, logMaterialChanges } from './fixtures/store-offshore-reducers.mjs'
import { setLedger as seedRu, renderVerdict, setSortie } from './fixtures/render-ru-verdict.mjs'
import { renderOffshoreSupplyBanner } from './fixtures/render-di-battle.mjs'

for (const [kind, rates] of Object.entries({ normal: [0.25, 0.36, 0.47], combined: [0.15, 0.275, 0.4] })) {
  rates.forEach((rate, i) => test(`${kind} 第 ${i + 1} 档逐舰油弹取整`, () => {
    assert.equal(OFFSHORE_SUPPLY_RATES[kind][i], rate)
    const ships = Object.freeze([Object.freeze({ rosterId: 7, fuel: 10, bull: 20, fuelMax: 101, bullMax: 127 })])
    assert.deepEqual(planOffshoreSupply(ships, i + 1, kind === 'combined'), [
      { rosterId: 7, fuel: 10 + Math.floor(101 * rate), bull: 20 + Math.floor(127 * rate) },
    ])
  }))
}
test('逐舰分别封顶，超过三个按第三档，原数组不改', () => {
  const ships = [{ rosterId: 1, fuel: 99, bull: 0, fuelMax: 100, bullMax: 100 },
    { rosterId: 2, fuel: 0, bull: 99, fuelMax: 100, bullMax: 100 }]
  assert.deepEqual(planOffshoreSupply(ships, 4, false), [{ rosterId: 1, fuel: 100, bull: 47 }, { rosterId: 2, fuel: 47, bull: 100 }])
  assert.deepEqual(planOffshoreSupply(ships, 10, true), planOffshoreSupply(ships, 3, true))
  assert.equal(ships[0].fuel, 99)
})
test('消耗按常规格顺序只取前 N 个 146，不足只取有的，最多三个', () => {
  const slots = Object.freeze([11, 12, -1, 13, 14, 15])
  const mst = id => ({ 11: 146, 12: 145, 13: 146, 14: 146, 15: 146 })[id]
  assert.deepEqual(planOffshoreSupplyConsumption(slots, mst, 1), [11])
  assert.deepEqual(planOffshoreSupplyConsumption(slots, mst, 2), [11, 13])
  assert.deepEqual(planOffshoreSupplyConsumption(slots, mst, 9), [11, 13, 14])
  assert.deepEqual(planOffshoreSupplyConsumption([12, -1, 11], mst, 3), [11])
})
test('备注定稿，联合 27.5% 不带浮点尾数', () => {
  assert.equal(offshoreSupplyNote(1, 0.25), '洋上补给 ×1 · 全队油弹 +25%')
  assert.equal(offshoreSupplyNote(2, 0.275), '洋上补给 ×2 · 全队油弹 +27.5%')
  assert.equal(rationNote(), '战斗粮食已用')
  assert.equal(describeDeltaDetail({ kind: 'offshoreSupply', map: 55, cell: 4, useNum: 1, estimated: true }, {
    mapName: () => '5-5', cellLetter: () => 'A',
  }), '洋上补给 ×1 · 5-5 A 点（油弹估算）')
})

const seed = (combined = false) => {
  state.player.ships = Object.fromEntries([1, 2, 3].map(id => [id,
    { id, shipId: 10, fuel: 10, bull: 20, cond: 49, slot: id === 1 ? [11, 12, 13] : [15], slotEx: id === 1 ? 14 : -1 }]))
  state.player.slotitems = Object.fromEntries([11, 12, 13, 14, 15].map(id => [id, { mstId: id === 15 ? 145 : 146 }]))
  state.master.ships = { 10: { fuelMax: 100, bullMax: 120 } }
  state.player.materials = [1000, 1000, 1000, 1000, 10, 10, 10, 10]
  state.player.decks = [{ id: 1, ships: [1, 2, -1] }, { id: 2, ships: [3] }]
  state.player.combinedFlag = combined ? 1 : 0
  state.sortie = newSortie({ mapArea: 5, mapNo: 5 })
}
const feed = (body, post = {}) => handle('/kcsapi/api_req_map/next', { api_no: 4, ...body }, post, 1)
const supplyBody = given => ({ api_offshore_supply: { api_supply_ship: 1, api_given_ship: given, api_use_num: 1 } })

test('next 数组受补舰：油弹、常规格与实例、节点、估算标记、库存与 sections 同步', () => {
  seed()
  const sections = feed(supplyBody([1, 2]), { api_supply_flag: '1' })
  for (const key of ['ships', 'slotitems', 'materials', 'sortie']) assert.ok(sections.includes(key))
  assert.deepEqual([state.player.ships[1].fuel, state.player.ships[1].bull], [35, 50])
  assert.deepEqual([state.player.ships[2].fuel, state.player.ships[2].bull], [35, 50])
  assert.deepEqual(state.player.ships[1].slot, [-1, 12, 13])
  assert.equal(state.player.slotitems[11], undefined)
  assert.equal(state.player.ships[1].slotEx, 14)
  assert.equal(state.player.slotitems[14].mstId, 146)
  assert.deepEqual(state.sortie.nodes[0].offshoreSupply, { supplyShip: 1, givenShips: [1, 2], useNum: 1 })
  assert.equal(state.sortie.nodes[0].note, '洋上补给 ×1 · 全队油弹 +25%')
  assert.equal(state.sortie.supplyEstimated, true)
  assert.deepEqual(state.player.materials.slice(0, 2), [950, 940])
})
test('回包单值受补舰也发动；未列出的舰保持原值', () => {
  seed()
  feed(supplyBody(2))
  assert.deepEqual(state.sortie.nodes[0].offshoreSupply.givenShips, [2])
  assert.equal(state.player.ships[1].fuel, 10)
  assert.equal(state.player.ships[2].fuel, 35)
})
for (const combined of [false, true]) test(`空受补舰回退全出击编成：combined=${combined}`, () => {
  seed(combined)
  feed(supplyBody([]))
  assert.deepEqual(state.sortie.nodes[0].offshoreSupply.givenShips, combined ? [1, 2, 3] : [1, 2])
  assert.equal(state.player.ships[1].fuel, combined ? 25 : 35)
  assert.equal(state.player.ships[3].fuel, combined ? 25 : 10)
})
test('只有请求标记时按补给舰常规格估算数量，增设位第四个不消耗', () => {
  seed()
  feed({}, { api_supply_flag: '1' })
  assert.equal(state.sortie.nodes[0].offshoreSupply.useNum, 3)
  assert.deepEqual(state.player.ships[1].slot, [-1, -1, -1])
  assert.equal(state.player.slotitems[14].mstId, 146)
})
test('库存不足从旗舰起按序补，油弹各自封顶，库存不为负', () => {
  seed()
  state.player.materials[0] = 30
  state.player.materials[1] = 10
  feed(supplyBody([2, 1]))
  assert.deepEqual([state.player.ships[1].fuel, state.player.ships[1].bull], [35, 30])
  assert.deepEqual([state.player.ships[2].fuel, state.player.ships[2].bull], [15, 20])
  assert.deepEqual(state.player.materials.slice(0, 2), [0, 0])
})
for (const api of ['ship_deck', 'ship2', 'ship3']) test(`${api} 油弹报文校正并广播 sortie`, () => {
  seed()
  feed(supplyBody([1, 2]))
  const raw = [{ api_id: 1, api_ship_id: 10, api_fuel: 34, api_bull: 49, api_slot: [-1, 12, 13] }]
  const sections = handle(`/kcsapi/api_get_member/${api}`, api === 'ship2' ? raw : { api_ship_data: raw, api_deck_data: [] }, {}, 2)
  assert.equal(state.sortie.supplyEstimated, false)
  assert.equal(state.player.ships[1].fuel, 34)
  assert.ok(sections.includes('sortie'))
})
test('漩涡不扣母港，备注保留；资源获得照常累计', () => {
  seed()
  const before = [...state.player.materials]
  feed({ api_happening: { api_mst_id: 1, api_count: 43 } })
  assert.deepEqual(state.player.materials, before)
  assert.equal(state.sortie.nodes[0].note, '涡潮 燃料 -43')
  feed({ api_itemget: { api_usemst: 4, api_id: 1, api_getcount: 5 }, api_happening: { api_mst_id: 1, api_count: 43 } })
  assert.equal(state.player.materials[0], before[0] + 5)
  assert.equal(state.sortie.nodes[1].note, '获得 燃料×5 · 涡潮 燃料 -43')
})
test('饭团仅认请求；只标节点，不改士气、装备与库存；备注共存', () => {
  seed()
  const before = structuredClone(state.player)
  feed({ api_ration_flag: 1 })
  assert.equal(state.sortie.nodes[0].rationUsed, undefined)
  feed({ api_ration_flag: 0 }, { api_ration_flag: '1' })
  assert.equal(state.sortie.nodes[1].rationUsed, true)
  assert.equal(state.sortie.nodes[1].note, '战斗粮食已用')
  assert.deepEqual(state.player, before)
  feed({ ...supplyBody([1]), api_happening: { api_mst_id: 1, api_count: 43 } }, { api_ration_flag: '1' })
  assert.equal(state.sortie.nodes[2].note, '涡潮 燃料 -43 · 洋上补给 ×1 · 全队油弹 +25% · 战斗粮食已用')
})
for (const gain of [0, 7, 25]) test(`账本真入口分账，资源格油收益 ${gain}，含净额抵消`, () => {
  seed()
  const prevMaterials = [...state.player.materials]
  const offshoreBefore = structuredClone(Object.values(state.player.ships))
  const body = supplyBody(1)
  state.player.ships[1].bull = 120
  offshoreBefore[0].bull = 120
  if (gain) body.api_itemget = { api_usemst: 4, api_id: 1, api_getcount: gain }
  const sections = feed(body)
  const detail = { kind: 'mapItem', map: 55, cell: 4, source: 'next' }
  const rows = logMaterialChanges(prevMaterials, offshoreBefore, sections, { category: '海域资源点', detail })
  assert.deepEqual(rows[0], { category: '洋上补给', values: [-25, 0, 0, 0, 0, 0, 0, 0],
    detail: { kind: 'offshoreSupply', map: 55, cell: 4, useNum: 1, estimated: true } })
  assert.equal(rows.length, gain ? 2 : 1)
  if (gain) assert.deepEqual(rows[1], { category: '海域资源点', values: [gain, 0, 0, 0, 0, 0, 0, 0], detail })
})
test('编队与战斗渲染实际 HTML：发动即显示，校正后只去限定词', () => {
  seed()
  feed(supplyBody([1, 2]))
  seedRu({ fleets: { 1: [{ id: 1, shipId: 10, nowhp: 50, maxhp: 50, slot: [], cond: 49 }] } })
  setSortie(state.sortie)
  assert.match(renderVerdict(), /已洋上补给 ×1（油弹估算）/)
  assert.match(renderOffshoreSupplyBanner(state.sortie), /洋上补给 ×1 · 全队油弹 \+25%（估算，下一战校正）/)
  state.sortie.supplyEstimated = false
  assert.match(renderVerdict(), /已洋上补给 ×1/)
  assert.doesNotMatch(renderVerdict(), /油弹估算/)
  assert.doesNotMatch(renderOffshoreSupplyBanner(state.sortie), /估算/)
  assert.equal(renderOffshoreSupplyBanner(newSortie({})), '')
})
