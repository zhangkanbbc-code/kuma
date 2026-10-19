import assert from 'node:assert/strict'
import test from 'node:test'
import { state, events, feed, metrics, reset } from './fixtures/settlement-experience.mjs'

const MISSION = '/kcsapi/api_req_mission/result'
const SORTIE = '/kcsapi/api_req_sortie/battleresult'
const COMBINED = '/kcsapi/api_req_combined_battle/battleresult'
const PRACTICE = '/kcsapi/api_req_practice/battle_result'
const PORT = '/kcsapi/api_port/port'
const rawShip = (patch = {}) => ({
  api_id: 14, api_ship_id: 1, api_lv: 72, api_exp: [296114, 86, 99],
  api_slot: [], api_slot_ex: 0, api_nowhp: 30, api_maxhp: 30, ...patch,
})
const setup = (practice = false, escort = false) => reset([rawShip()], [{
  rosterId: 14, fleet: escort ? 'escort' : 'main', position: 0,
  hpStart: 30, hpEnd: 30, damageDealt: 0,
}], practice)
const body = (route, gains = [140]) => ({
  api_win_rank: 'S', api_ship_id: [-1, 14],
  ...(route === COMBINED ? {
    api_get_ship_exp_combined: gains,
    api_get_exp_lvup_combined: [[296114, 296200, 307400]],
  } : {
    api_get_ship_exp: gains,
    api_get_exp_lvup: [[296114, 296200, 307400]],
  }),
})
const expEvents = () => events.filter((event) => event.kind === 'exp')
const assertSettlement = () => {
  assert.equal(state.player.ships[14].lv, 73)
  assert.equal(state.player.ships[14].expTotal, 296254)
  assert.equal(state.player.ships[14].expNext, 11146)
}

for (const [route, gains] of [
  [MISSION, [140]], [SORTIE, [140]], [SORTIE, [-1, 140]],
  [PRACTICE, [140]], [COMBINED, [-1, 140]],
]) {
  test(`结算前经验加本次获得；回港只留一条 72→73：${route} / ${gains}`, () => {
    setup(route === PRACTICE, route === COMBINED)
    feed(route, body(route, gains), 1000)
    assertSettlement()
    assert.deepEqual(expEvents(), [{
      ts: 1000, rosterId: 14, mstId: 1, kind: 'exp', expDelta: 140,
      detail: { levelBefore: 72, levelAfter: 73, totalAfter: 296254 },
    }])
    if (route !== MISSION) {
      const ship = state.sortie.battle.fShips[0]
      assert.equal(ship.expGained, 140)
      assert.equal(ship.expTotalAfter, 296254)
      assert.equal(ship.expNextTotal, 307400)
      assert.ok(metrics(ship).includes(`距升级 ${(307400 - 296254).toLocaleString()}`))
    }
    feed(PORT, { api_ship: [rawShip({ api_lv: 73, api_exp: [296254, 11146, 0] })] }, 2000)
    assertSettlement()
    assert.equal(expEvents().length, 1)
  })
}

for (const route of [MISSION, SORTIE]) {
  test(`获得无效或缺失：经验不动，等级照加：${route}`, () => {
    for (const gain of [undefined, null, '140', -1, NaN, Infinity, -Infinity]) {
      setup()
      // [-1] 在战斗中是哨兵，其后仍缺获得值；远征不偏移。
      feed(route, body(route, [gain]), 1000)
      assert.equal(state.player.ships[14].lv, 73, String(gain))
      assert.equal(state.player.ships[14].expTotal, 296114, String(gain))
      assert.equal(state.player.ships[14].expNext, 86, String(gain))
      assert.equal(expEvents().length, 0)
      if (route !== MISSION) {
        assert.equal(state.sortie.battle.fShips[0].expTotalAfter, undefined)
        assert.equal(state.sortie.battle.fShips[0].expNextTotal, undefined)
      }
    }
    setup()
    const missing = body(route)
    delete missing.api_get_ship_exp
    feed(route, missing, 1000)
    assert.equal(state.player.ships[14].lv, 73)
    assert.equal(state.player.ships[14].expTotal, 296114)
    assert.equal(state.player.ships[14].expNext, 86)
  })
  test(`获得为零有效，距升级不小于零：${route}`, () => {
    setup()
    feed(route, body(route, [0]), 1000)
    assert.equal(state.player.ships[14].expTotal, 296114)
    assert.equal(state.player.ships[14].expNext, 11286)
    setup()
    feed(route, body(route, [20000]), 1000)
    assert.equal(state.player.ships[14].expNext, 0)
  })
}
