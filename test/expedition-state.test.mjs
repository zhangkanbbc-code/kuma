import assert from 'node:assert/strict'
import test from 'node:test'

import expeditionState from '../dist/shared/expedition-state.js'
import {
  applyMissionState,
  missionStateSnapshot,
} from './fixtures/store-mission-state.mjs'

const { decksOnExpedition, expeditionGlow, expeditionResetLabel, expeditionRowState } =
  expeditionState
const base = {
  resetType: 1,
  observed: true,
  state: 1,
  limitTs: 2_000,
  now: 1_000,
}

test('未观测过远征状态时不标记', () => {
  assert.equal(expeditionRowState({ ...base, observed: false, state: undefined }), null)
})

test('api_state 0 标为尚未解锁', () => {
  assert.equal(expeditionRowState({ ...base, state: 0 }), 'locked')
})

test('已有观测但该远征不在列表里时标为尚未解锁', () => {
  assert.equal(expeditionRowState({ ...base, state: undefined }), 'locked')
})

test('月次远征 api_state 2 且尚未重置时标为本期已完成', () => {
  assert.equal(expeditionRowState({ ...base, state: 2 }), 'done')
  assert.equal(expeditionRowState({ ...base, state: 2, limitTs: null }), 'done')
})

test('月次远征 api_state 2 但重置时刻已过时不再标记', () => {
  assert.equal(expeditionRowState({ ...base, state: 2, now: 2_000 }), null)
  assert.equal(expeditionRowState({ ...base, state: 2, now: 2_001 }), null)
})

test('常规远征 api_state 2 不标记', () => {
  assert.equal(expeditionRowState({ ...base, resetType: 0, state: 2 }), null)
})

test('月次远征 api_state 1 不标记', () => {
  assert.equal(expeditionRowState(base), null)
})

test('重置标签使用本地 M/D HH:MM，已过或缺席时为空', () => {
  const limitTs = new Date(2026, 8, 15, 12, 0).getTime()
  assert.equal(expeditionResetLabel(limitTs, limitTs - 1), '至 9/15 12:00 重置')
  assert.equal(expeditionResetLabel(limitTs, limitTs), '')
  assert.equal(expeditionResetLabel(null, limitTs - 1), '')
})

test('没有舰队执行远征时无行光', () => {
  assert.equal(expeditionGlow({ missionState: undefined, returnTs: null, now: 1_000, fails: 0 }), null)
})

test('执行中且时间未到时为微黄光', () => {
  assert.equal(expeditionGlow({ missionState: 1, returnTs: 2_000, now: 1_000, fails: 0 }), 'running')
})

test('执行中且编成不符时为红光', () => {
  assert.equal(expeditionGlow({ missionState: 1, returnTs: 2_000, now: 1_000, fails: 2 }), 'unfit')
})

test('执行中但时间已到时不论编成均为绿光', () => {
  assert.equal(expeditionGlow({ missionState: 1, returnTs: 1_000, now: 1_000, fails: 2 }), 'collect')
})

test('已返港待收取时为绿光', () => {
  assert.equal(expeditionGlow({ missionState: 2, returnTs: null, now: 1_000, fails: 2 }), 'collect')
})

test('大成功等待项不计失败时仍为执行中微黄光', () => {
  assert.equal(expeditionGlow({ missionState: 1, returnTs: 2_000, now: 1_000, fails: 0 }), 'running')
})

test('指定远征只返回执行该远征的舰队并保留状态与返港时间', () => {
  assert.deepEqual(
    decksOnExpedition(
      [
        { id: 2, mission: [1, 42, 2_000] },
        { id: 3, mission: [2, 7, 3_000] },
      ],
      42,
    ),
    [{ deckId: 2, state: 1, returnTs: 2_000 }],
  )
})

test('任意远征返回全部远征中舰队、排除 state 0 并按舰队 id 升序', () => {
  assert.deepEqual(
    decksOnExpedition(
      [
        { id: 3, mission: [2, 7, 3_000] },
        { id: 1, mission: [0, 0, 0] },
        { id: 2, mission: [1, 42, 2_000] },
      ],
      0,
    ),
    [
      { deckId: 2, state: 1, returnTs: 2_000 },
      { deckId: 3, state: 2, returnTs: 3_000 },
    ],
  )
})

test('mission handler 全量替换三条状态并记录观测与重置时刻', () => {
  const ts = 1_789_000_000_123
  const limitSeconds = 1_789_441_200
  const sections = applyMissionState(
    {
      api_list_items: [
        { api_mission_id: 42, api_state: 2 },
        { api_mission_id: 132, api_state: 0 },
        { api_mission_id: 1, api_state: 1 },
      ],
      api_limit_time: [limitSeconds],
    },
    ts,
  )

  assert.deepEqual(sections, ['missionStates'])
  assert.deepEqual(missionStateSnapshot(), {
    missionStates: { 1: 1, 42: 2, 132: 0 },
    missionStatesTs: ts,
    missionLimitTs: limitSeconds * 1_000,
  })
})
