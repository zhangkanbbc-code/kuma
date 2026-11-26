// 打开战斗复盘窗的请求形状（shared/battle-replay-request）：旧调用方只传快照 id，
// 「动画复盘」按钮传 { snapshotId, view }。主进程与复盘窗都用这一份解析。
import assert from 'node:assert/strict'
import test from 'node:test'

import request from '../dist/shared/battle-replay-request.js'

const { parseBattleReplayRequest } = request

test('旧形状：只给快照 id，视图不指定', () => {
  assert.deepEqual(parseBattleReplayRequest(42), { snapshotId: 42, view: null })
  assert.deepEqual(parseBattleReplayRequest('42'), { snapshotId: 42, view: null })
})

test('新形状：带 view 直达动画或详情；不认得的 view 当作不指定', () => {
  assert.deepEqual(parseBattleReplayRequest({ snapshotId: 7, view: 'animate' }), { snapshotId: 7, view: 'animate' })
  assert.deepEqual(parseBattleReplayRequest({ snapshotId: 7, view: 'detail' }), { snapshotId: 7, view: 'detail' })
  assert.deepEqual(parseBattleReplayRequest({ snapshotId: 7, view: 'video' }), { snapshotId: 7, view: null })
})

test('坏请求一律不开窗', () => {
  for (const bad of [0, -1, 1.5, 'x', null, undefined, {}, { snapshotId: 0 }, { view: 'animate' }]) {
    assert.equal(parseBattleReplayRequest(bad), null, JSON.stringify(bad))
  }
})
