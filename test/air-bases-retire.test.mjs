import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceAirBases, retireAirBasesOfArea, retireClosedAreas } from '../dist/main/mg/air-bases.js'
import { state, logs, calls, reset, hydrateDomain, start2 } from './fixtures/store-air-bases-retire.mjs'

const squads = () => replaceAirBases(
  [[6, 1], [7, 1], [62, 1], [62, 2], [62, 3], [63, 1]].map(([areaId, rid]) => ({
    api_area_id: areaId,
    api_rid: rid,
    api_plane_info: [{ api_slotid: areaId * 10 + rid, api_count: 18 }],
  })),
  100,
)
const period = (closed = false) => ({ firstSeenTs: 10, lastSeenTs: 100, closed })
const body = (...eventIds) => ({
  api_mst_maparea: [6, 7, ...eventIds].map((id) => ({
    api_id: id, api_type: id <= 7 ? 0 : 1, api_name: `海域 ${id}`,
  })),
})
const seed = () => {
  reset()
  state.player.airBases = squads()
  state.player.airBasesTs = 100
  state.player.slotitems = { 621: { id: 621, slotitemId: 1 } }
  state.eventAreas = { 62: period(), 63: period() }
  return state.player.airBases
}

test('撤场纯函数：只撤指定区全部中队，6/7 与其他活动区原样保留，不改输入', () => {
  const previous = squads()
  const before = structuredClone(previous)
  const kept = retireAirBasesOfArea(previous, 62)
  assert.deepEqual(kept.map((s) => s.areaId), [6, 7, 63])
  assert.deepEqual(previous, before)
  kept.forEach((s, i) => assert.equal(s, previous[[0, 1, 5][i]]))
})

test('撤场纯函数：无目标区或空数组返回原引用', () => {
  const previous = squads()
  assert.equal(retireAirBasesOfArea(previous, 61), previous)
  const empty = []
  assert.equal(retireAirBasesOfArea(empty, 62), empty)
})

test('回灌纯函数：仅 closed === true 撤场，false/缺失/其他真值均保留', () => {
  const previous = squads()
  for (const closed of [false, undefined, 1, 'true']) {
    assert.equal(retireClosedAreas(previous, { 62: period(closed) }), previous)
  }
  assert.equal(retireClosedAreas(previous, {}), previous)
  assert.deepEqual(retireClosedAreas(previous, { 62: period(true), 63: period(false) }),
    [previous[0], previous[1], previous[5]])
})

test('回灌纯函数：多个已关闭区一起剔除，保留常设中队', () => {
  const previous = squads()
  assert.deepEqual(retireClosedAreas(previous, { 62: period(true), 63: period(true) }), previous.slice(0, 2))
})

test('start2：62 消失后先归档再撤三队，更新时间戳并通知 airBases', () => {
  const previous = seed()
  const slotitems = state.player.slotitems
  const slotitemsBefore = structuredClone(slotitems)
  assert.deepEqual(start2(body(63), {}, 200), ['master', 'eventAreas', 'airBases'])
  assert.deepEqual(state.player.airBases, [previous[0], previous[1], previous[5]])
  assert.equal(state.player.airBasesTs, 200)
  assert.deepEqual(state.eventAreas[62], { firstSeenTs: 10, lastSeenTs: 200, closed: true })
  assert.equal(state.master.ready, true)
  assert.deepEqual(calls.filter((c) => c.name !== 'observeEventMapCatalog'), [
    { name: 'closeEventMapCatalog', args: [62, 200], airBases: previous },
    { name: 'archiveEvent', args: [62, 10, 200], airBases: previous },
  ])
  assert.ok(logs.includes('[kuma] mg: 活动海域 62 已关闭，撤下基地航空队 3 队'))
  assert.equal(state.player.slotitems, slotitems)
  assert.deepEqual(slotitems, slotitemsBefore)
})

test('start2：62 仍在，一队不动，时间戳和 sections 保持原语义', () => {
  const previous = seed()
  assert.deepEqual(start2(body(62, 63), {}, 200), ['master', 'eventAreas'])
  assert.equal(state.player.airBases, previous)
  assert.equal(state.player.airBasesTs, 100)
  assert.deepEqual(state.eventAreas[62], { firstSeenTs: 10, lastSeenTs: 200, closed: false })
  assert.equal(calls.some((c) => c.name === 'archiveEvent'), false)
  assert.equal(logs.length, 0)
})

test('start2：关闭区没有中队时仍归档，不改陆航时间戳、不发 airBases', () => {
  seed()
  const previous = state.player.airBases = retireAirBasesOfArea(state.player.airBases, 62)
  assert.deepEqual(start2(body(63), {}, 200), ['master', 'eventAreas'])
  assert.equal(state.player.airBases, previous)
  assert.equal(state.player.airBasesTs, 100)
  assert.ok(calls.some((c) => c.name === 'archiveEvent' && c.args[0] === 62))
  assert.equal(logs.some((s) => s.includes('撤下')), false)
})

test('start2：多个活动区同时关闭只通知一次，再次登录不重复归档或置时间戳', () => {
  const previous = seed()
  assert.deepEqual(start2(body(), {}, 200), ['master', 'eventAreas', 'airBases'])
  assert.deepEqual(state.player.airBases, previous.slice(0, 2))
  assert.equal(calls.filter((c) => c.name === 'archiveEvent').length, 2)
  const kept = state.player.airBases
  assert.deepEqual(start2(body(), {}, 300), ['master', 'eventAreas'])
  assert.equal(state.player.airBases, kept)
  assert.equal(state.player.airBasesTs, 200)
  assert.equal(calls.filter((c) => c.name === 'archiveEvent').length, 2)
})

test('hydrateDomain：旧快照已关闭区补撤场，时间戳取回灌时刻并记队数', (t) => {
  reset()
  t.mock.method(Date, 'now', () => 500)
  const snapshot = { airBases: squads(), airBasesTs: 100, eventAreas: { 62: period(true), 63: period() }, slotitems: { 621: { id: 621 } } }
  const before = structuredClone(snapshot)
  hydrateDomain(snapshot)
  assert.deepEqual(state.player.airBases, [snapshot.airBases[0], snapshot.airBases[1], snapshot.airBases[5]])
  assert.equal(state.player.airBasesTs, 500)
  assert.deepEqual(logs, ['[kuma] mg: 回灌时撤下已关闭活动海域的基地航空队 3 队'])
  assert.equal(state.player.slotitems, snapshot.slotitems)
  assert.deepEqual(snapshot, before)
  assert.equal(calls.length, 0)
})

test('hydrateDomain：closed=false 保留全部中队及原时间戳，不写撤场日志', () => {
  reset()
  const previous = squads()
  hydrateDomain({ airBases: previous, airBasesTs: 100, eventAreas: { 62: period(false) } })
  assert.equal(state.player.airBases, previous)
  assert.equal(state.player.airBasesTs, 100)
  assert.deepEqual(logs, [])
})

test('hydrateDomain：旧快照没有 eventAreas 保留陆航，不用残留状态静默隐藏', () => {
  reset()
  state.eventAreas = { 62: period(true) }
  const previous = squads()
  hydrateDomain({ airBases: previous, airBasesTs: 100 })
  assert.equal(state.player.airBases, previous)
  assert.equal(state.player.airBasesTs, 100)
  assert.deepEqual(logs, [])
})

test('hydrateDomain：已关闭区无中队，保留数组与空时间戳', () => {
  reset()
  const previous = retireAirBasesOfArea(squads(), 62)
  hydrateDomain({ airBases: previous, eventAreas: { 62: period(true) } })
  assert.equal(state.player.airBases, previous)
  assert.equal(state.player.airBasesTs, null)
  assert.deepEqual(logs, [])
})

test('hydrateDomain：清理后的快照再次回灌不更新陆航时间戳、不重复日志', () => {
  reset()
  hydrateDomain({ airBases: squads(), airBasesTs: 100, eventAreas: { 62: period(true) } })
  const airBases = state.player.airBases
  const airBasesTs = state.player.airBasesTs
  logs.length = 0
  hydrateDomain({ airBases, airBasesTs, eventAreas: state.eventAreas })
  assert.equal(state.player.airBases, airBases)
  assert.equal(state.player.airBasesTs, airBasesTs)
  assert.deepEqual(logs, [])
})
