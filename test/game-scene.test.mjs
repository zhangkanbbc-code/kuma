// 游戏进远征页 → kuma 切到远征；离开 → 切回进页前那一页（2026-09-25 修正离开判据）。
//
// 旧判据只认四种离开请求（母港/出击选图/演习/任务表）。维护者账本 2026-08-03～09-25：
// 进远征页 924 次，其中 349 次离开时先去了别的页面——编成、入渠、改装、道具、补给、战绩、
// 图鉴、工厂，或游戏整页重载——这些都不发那四种请求，kuma 一直停在远征（中位 28 秒，
// 一成超过 24 分钟）。远征页本身只会发下面这几种请求；在远征页期间出现任何别的请求，
// 都说明玩家已经离开。下面的序列取自账本里的真实请求顺序。
import assert from 'node:assert/strict'
import test from 'node:test'
import sceneModule from '../dist/shared/game-scene.js'

const { createMissionSceneTracker } = sceneModule
const run = (paths) => {
  const next = createMissionSceneTracker()
  return paths.map((p) => next(`/kcsapi/${p}`))
}

test('远征页内的出发、强制归还、结算与编队刷新都不算离开', () => {
  assert.deepEqual(
    run(['api_get_member/mission', 'api_req_mission/start', 'api_get_member/deck', 'api_req_mission/return_instruction', 'api_get_member/deck', 'api_req_mission/result']),
    ['mission', null, null, null, null, null],
  )
})

test('旧判据认的四种离开照旧', () => {
  for (const p of ['api_port/port', 'api_get_member/mapinfo', 'api_get_member/practice', 'api_get_member/questlist']) {
    assert.deepEqual(run(['api_get_member/mission', 'api_req_mission/start', 'api_get_member/deck', p]), ['mission', null, null, 'away'], p)
  }
})

test('从远征页直接去别的页面也算离开（账本里出现过的九种第一个请求）', () => {
  const firstElsewhere = [
    'api_get_member/preset_deck', // 编成
    'api_get_member/ndock', // 入渠
    'api_req_kaisou/can_preset_slot_select', // 改装
    'api_get_member/payitem', // 道具
    'api_req_hokyu/charge', // 补给
    'api_get_member/record', // 战绩
    'api_get_member/picture_book', // 图鉴
    'api_get_member/preset_dev_items', // 工厂
    'api_start2/get_option_setting', // 整页重载
  ]
  for (const p of firstElsewhere) {
    assert.deepEqual(run(['api_get_member/mission', 'api_req_mission/start', 'api_get_member/deck', p]), ['mission', null, null, 'away'], p)
  }
})

test('离开只报一次；不在远征页时别的请求一律不报', () => {
  assert.deepEqual(
    run(['api_port/port', 'api_get_member/ndock', 'api_get_member/mission', 'api_get_member/preset_deck', 'api_req_hensei/change', 'api_port/port']),
    [null, null, 'mission', 'away', null, null],
  )
})

test('离开后再进远征页照样跟过去，再离开照样切回', () => {
  assert.deepEqual(
    run(['api_get_member/mission', 'api_get_member/ndock', 'api_req_nyukyo/start', 'api_get_member/mission', 'api_req_mission/start', 'api_get_member/deck', 'api_port/port']),
    ['mission', 'away', null, 'mission', null, null, 'away'],
  )
})

test('连着两次进远征页（页内刷新）都报 mission，不误报离开', () => {
  assert.deepEqual(run(['api_get_member/mission', 'api_get_member/mission', 'api_get_member/deck']), ['mission', 'mission', null])
})

test('各追踪器互不串味', () => {
  const a = createMissionSceneTracker()
  const b = createMissionSceneTracker()
  assert.equal(a('/kcsapi/api_get_member/mission'), 'mission')
  assert.equal(b('/kcsapi/api_get_member/ndock'), null)
  assert.equal(a('/kcsapi/api_get_member/ndock'), 'away')
})
