import assert from 'node:assert/strict'
import test from 'node:test'
import mute from '../dist/shared/air-base-mute.js'

const { AIR_BASE_MUTE_KEY, isAirBaseAreaMuted, toggleAirBaseAreaMute, unmutedAirBaseSquads } = mute

test('陆航静默使用独立 ui 偏好键', () => {
  assert.equal(AIR_BASE_MUTE_KEY, 'ru.airBase.muted')
})

test('未设置、静默、恢复三态，常规与活动区均按区号切换', () => {
  for (const areaId of [6, 7, 62]) {
    assert.equal(isAirBaseAreaMuted([], areaId), false)
    const muted = toggleAirBaseAreaMute([], areaId)
    assert.equal(isAirBaseAreaMuted(muted, areaId), true)
    const restored = toggleAirBaseAreaMute(muted, areaId)
    assert.equal(isAirBaseAreaMuted(restored, areaId), false)
    assert.deepEqual(restored, [])
  }
})

test('每次切换均去重并按数字排序，不修改输入；恢复删除全部重复区号', () => {
  const original = Object.freeze([62, 7, 7, 6, 62])
  assert.deepEqual(toggleAirBaseAreaMute(original, 12), [6, 7, 12, 62])
  assert.deepEqual(toggleAirBaseAreaMute(original, 7), [6, 62])
  assert.deepEqual(original, [62, 7, 7, 6, 62])
})

test('中队过滤只排除静默海域，保留顺序、实例及其它属性', () => {
  const squads = Object.freeze([{ areaId: 7, rid: 2 }, { areaId: 6, rid: 1 }, { areaId: 62, rid: 1 }, { areaId: 7, rid: 1 }])
  const filtered = unmutedAirBaseSquads(squads, [6, 62])
  assert.deepEqual(filtered, [squads[0], squads[3]])
  assert.equal(filtered[0], squads[0])
  assert.deepEqual(unmutedAirBaseSquads(squads, []), squads)
  assert.deepEqual(unmutedAirBaseSquads(squads, [6, 7, 62]), [])
  assert.deepEqual(unmutedAirBaseSquads([], [6]), [])
})
