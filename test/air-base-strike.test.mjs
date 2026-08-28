import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import strikeModule from '../dist/shared/air-base-strike.js'

const { airBaseWavesAt, parseAirBaseStrikes } = strikeModule

test('照抄实机请求：每队两波，队号在参数名后缀里', () => {
  // 本机 2026-08-07 打 62-4 时的真实 post body（token 已脱敏）
  const strikes = parseAirBaseStrikes({
    api_token: '<REDACTED>',
    api_verno: '1',
    api_strike_point_2: '40,40',
    api_strike_point_3: '40,40',
  })
  assert.deepEqual(strikes, { 2: [40, 40], 3: [40, 40] })
  // 第 1 队留防空，参数里根本没有 _1——按数组下标读会把第 2 队当第 1 队
  assert.equal(strikes[1], undefined)
})

test('两波可以打不同点', () => {
  assert.deepEqual(parseAirBaseStrikes({ api_strike_point_1: '23,40' }), { 1: [23, 40] })
})

test('非派遣参数一概不认', () => {
  assert.deepEqual(parseAirBaseStrikes({ api_token: 'x', api_deck_id: '1' }), {})
  assert.deepEqual(parseAirBaseStrikes({ api_strike_point: '40' }), {}) // 没有队号后缀
  assert.deepEqual(parseAirBaseStrikes(null), {})
  assert.deepEqual(parseAirBaseStrikes('40,40'), {})
  // 未派遣时游戏会给 -1；不是合法点位
  assert.deepEqual(parseAirBaseStrikes({ api_strike_point_1: '-1,-1' }), {})
})

test('数波数按点位算，派往别处的不计', () => {
  const strikes = { 2: [40, 40], 3: [40, 23] }
  assert.equal(airBaseWavesAt(strikes, 40), 3)
  assert.equal(airBaseWavesAt(strikes, 23), 1)
  assert.equal(airBaseWavesAt(strikes, 38), 0) // 道中点没派陆航，不能白送输出
  assert.equal(airBaseWavesAt(null, 40), 0)
  assert.equal(airBaseWavesAt(strikes, 0), 0)
})

test('出击状态要真的存下派遣目标，否则预测无从判断该不该算陆航', () => {
  const store = readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
  assert.match(store, /'\/kcsapi\/api_req_map\/start_air_base'/)
  assert.match(store, /parseAirBaseStrikes\(post\)/)
  assert.match(store, /sortie\.airBaseStrikes = strikes/)
  // 派遣是每次出击重设的，新出击必须清空，不能把上一轮的目标点带过来
  assert.match(store, /airBaseStrikes: \{\},/)
})
