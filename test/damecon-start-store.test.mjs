import assert from 'node:assert/strict'
import test from 'node:test'
import { state, newSortie, handle, consumeBattleStartRepairItems } from './fixtures/store-offshore-reducers.mjs'
import { renderLog, renderBrow, battleOf, shipOf } from './fixtures/render-di-battle.mjs'

const seed = (ex = false) => {
  state.player.ships = { 1: { id: 1, shipId: 10, lv: 1, nowhp: 4, maxhp: 39,
    slot: ex ? [-1, -1, -1] : [-1, -1, 9001], slotEx: ex ? 9001 : -1 } }
  state.player.slotitems = { 9001: { mstId: 43, level: 0, alv: 0 } }
  state.player.decks = [{ id: 1, ships: [1] }]
  state.player.combinedFlag = 0
  state.master.ships = { 10: { name: '测试舰', maxEq: [] } }
  state.sortie = newSortie({ mapArea: 1, mapNo: 6, currentCell: 4, battleCount: 2 })
}
const body = () => ({ api_deck_id: 1, api_f_nowhps: [39], api_f_maxhps: [39],
  api_ship_ke: [1501], api_ship_lv: [1], api_e_nowhps: [30], api_e_maxhps: [30] })
const feed = (api, data = body(), ts = 10) => handle(`/kcsapi/${api}`, data, {}, ts)

for (const [label, api, ex] of [
  ['昼战常规格', 'api_req_sortie/battle', false],
  ['开幕夜战增设格', 'api_req_battle_midnight/sp_midnight', true],
]) test(`${label}：开战当场摘格、删实例、广播并记一次；后续 ship_deck 不重记`, () => {
  seed(ex)
  const sections = feed(api)
  assert.deepEqual(state.player.ships[1].slot, [-1, -1, -1])
  assert.equal(state.player.ships[1].slotEx, -1)
  assert.equal(state.player.slotitems[9001], undefined)
  assert.equal(state.player.ships[1].nowhp, 39)
  assert.deepEqual(state.sortie.consumedItems, [{ rosterId: 1, mstId: 43, cell: 4, battleCount: 3, ts: 10 }])
  for (const section of ['sortie', 'ships', 'slotitems']) assert.ok(sections.includes(section))
  assert.deepEqual(consumeBattleStartRepairItems(state.sortie.battle, 11), [], '同一视图再次结算必须幂等')
  assert.equal(state.sortie.consumedItems.length, 1)
  feed('api_get_member/ship_deck', { api_ship_data: [{ api_id: 1, api_ship_id: 10,
    api_nowhp: 39, api_maxhp: 39, api_slot: [-1, -1, -1], api_slot_ex: -1 }], api_deck_data: [] }, 12)
  assert.deepEqual(state.sortie.consumedItems, [{ rosterId: 1, mstId: 43, cell: 4, battleCount: 3, ts: 10 }])
})

test('昼战合并夜战保留开战事实，不重复结算；剩余第二枚夜战仍可发动', () => {
  seed()
  state.player.ships[1].slotEx = 9002
  state.player.slotitems[9002] = { mstId: 42, level: 0, alv: 0 }
  feed('api_req_sortie/battle')
  const night = body()
  night.api_hougeki = { api_at_list: [0], api_at_eflag: [1], api_df_list: [[0]], api_damage: [[50]], api_cl_list: [[1]] }
  const sections = feed('api_req_battle_midnight/battle', night, 11)
  assert.equal(state.sortie.battleCount, 3)
  assert.equal(state.sortie.battle.fShips[0].repairItemUsedAtStart, 43)
  assert.equal(state.sortie.battle.fShips[0].repairItemUsed, 42)
  assert.equal(state.sortie.battle.fShips[0].hpEnd, 7)
  assert.equal(state.sortie.consumedItems.length, 1)
  assert.ok(!sections.includes('slotitems'))
})

for (const [mstId, hpStart, copy] of [
  [43, 39, '女神进击时发动 · 开战耐久全满'],
  [42, 19, '要员进击时发动 · 开战耐久约半'],
]) test(`镝开战 ${mstId}：无攻击也显示一次标签，逐舰档位按实际 hpEnd`, () => {
  const ship = { ...shipOf(0, '测试舰'), rosterId: 1, hpMax: 39, hpStart, hpEnd: 4,
    repairItemUsedAtStart: mstId, repairItemInstanceAtStart: 9001 }
  const battle = battleOf({ fShips: [ship], eShips: [], attacks: [], stages: [] })
  const html = renderLog(battle, false)
  assert.equal(html.split(copy).length - 1, 1)
  assert.match(html, /data-log-stage="-1"/)
  assert.match(renderBrow(battle, 0, ship), /大破/)
  assert.doesNotMatch(renderBrow(battle, 0, ship), />女神<|>要员</)
  delete ship.repairItemUsedAtStart
  delete ship.repairItemInstanceAtStart
  assert.doesNotMatch(renderLog(battle, false), /进击时发动/)
})
