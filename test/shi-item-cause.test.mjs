// 道具流水的「原因」一列：名表查不到就写「其他游戏操作」——那四个字对玩家等于没说。
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
  assert.equal(cause(T + 200), '领取活动选择奖励')
})

test('格納庫増設：认出是用掉了这件道具', () => {
  setup({ events: [{ ts: T, path: '/kcsapi/api_req_kaisou/hangar_expand' }] })
  assert.equal(cause(T + 200), '使用格納庫増設')
})

test('名表外的端点仍然兜底——上面两条不是靠兜底文案蒙对的', () => {
  setup({ events: [{ ts: T, path: '/kcsapi/api_req_member/get_incentive' }] })
  assert.equal(cause(T + 200), '其他游戏操作')
})
