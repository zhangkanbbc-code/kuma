// 道具流水的「原因」一列：新行先读账本 cause，旧行才按全量窗口现算。
//
// 2026-08-27 两笔格納庫増設实证撞出两个缺口：活动选择奖励领取端点、以及新接的
// hangar_expand（当场自扣，归因能找到它自己）都不在名表里。这里各钉一颗钉子，
// 外加一条兜底对照——没有那条对照，把兜底文案改成一样也能让上面两条绿。
import assert from 'node:assert/strict'
import test from 'node:test'

import { cause, setup } from './fixtures/shi-item-cause.mjs'

const T = Date.UTC(2026, 7, 27, 2, 25, 0)

test('活动选择奖励领取：认出是领奖，不是「其他游戏操作」', () => {
  setup({ events: [{ ts: T, path: '/kcsapi/api_req_member/get_event_selected_reward' }] })
  assert.equal(cause(T + 200, { itemId: 78, delta: 1 }), '领取活动选择奖励')
})

test('格纳库扩容：旧行在全量窗口内认出消费动作', () => {
  setup({ events: [{ ts: T, path: '/kcsapi/api_req_kaisou/hangar_expand' }] })
  assert.equal(cause(T + 200), '格纳库扩容')
})

test('账本 cause 优先；明确的 NULL 不再拿邻近操作硬填', () => {
  setup({ events: [{ ts: T, path: '/kcsapi/api_req_kaisou/hangar_expand' }] })
  assert.equal(cause(T + 200, { cause: '/kcsapi/api_req_kaisou/open_exslot' }), '补强增设开孔')
  assert.equal(cause(T + 200, { cause: null }), '未识别对应操作')
})

test('旧行以全量同步为真窗口，窗口外操作不参与', () => {
  setup({
    events: [
      { ts: T, path: '/kcsapi/api_req_kaisou/hangar_expand' },
      { ts: T + 100, path: '/kcsapi/api_get_member/useitem' },
      { ts: T + 150, path: '/kcsapi/api_req_sortie/battleresult' },
    ],
  })
  assert.equal(cause(T + 200), '未识别对应操作')
})

test('旧行早于现存事件账本时，如实说明所选期间已清理', () => {
  setup({ events: [], earliest: T + 1 })
  assert.equal(cause(T), '所选期间记录已清理')
})
