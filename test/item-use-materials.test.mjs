// 用道具带来的资源到账归属（shared/item-use-materials）。
//
// 夹具全是**实测出来的间隔**，不是随手编的数：
// - payitemuse → api_get_member/material：17 笔落在 221–244ms（2026-08-28 本机账本全量）
// - 同一条 material path 上的他族触发：任务领奖后 1640–2904ms、近代化改修后 223–285ms
//   （后者前面是 ship3，根本没有 payitemuse）
// 判据要同时做到「两端都认」和「他族一个都不吞」，所以下面的边界值一个都不能挪。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-item-use-materials-'))
const output = path.join(tempDir, 'item-use-materials.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/shared/item-use-materials.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const {
  ITEM_USE_CATEGORY,
  ITEM_USE_PATH,
  ITEM_USE_REFRESH_WINDOW_MS,
  MATERIAL_REFRESH_PATH,
  PAY_ITEM_CATEGORY,
  PAY_ITEM_USE_PATH,
  createItemUseRefreshTracker,
  itemUseMaterialCategory,
  replayItemUseMaterialCategories,
} = createRequire(import.meta.url)(output)

const QUEST_REWARD_PATH = '/kcsapi/api_req_quest/clearitemget'
const SHIP3_PATH = '/kcsapi/api_get_member/ship3'
const PORT_PATH = '/kcsapi/api_port/port'

/** 按 [path, 相对 0 的毫秒] 喂一串报文，收下每一包的归类结论。 */
const feed = (events) => {
  const tracker = createItemUseRefreshTracker()
  return events.map(([apiPath, ts]) => itemUseMaterialCategory(tracker, apiPath, ts))
}

test('实测间隔两端都认：221ms 与 244ms 都是氪金道具', () => {
  for (const gap of [221, 230, 244]) {
    assert.deepEqual(
      feed([
        [PAY_ITEM_USE_PATH, 0],
        [MATERIAL_REFRESH_PATH, gap],
      ]),
      [null, PAY_ITEM_CATEGORY],
      `间隔 ${gap}ms 应认作氪金道具`,
    )
  }
})

test('窗口是闭区间：正好 1000ms 认，1001ms 不认', () => {
  assert.equal(ITEM_USE_REFRESH_WINDOW_MS, 1000)
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 0],
      [MATERIAL_REFRESH_PATH, ITEM_USE_REFRESH_WINDOW_MS],
    ]),
    [null, PAY_ITEM_CATEGORY],
  )
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 0],
      [MATERIAL_REFRESH_PATH, ITEM_USE_REFRESH_WINDOW_MS + 1],
    ]),
    [null, null],
  )
})

test('任务领奖那族一笔都不吞：最快 1640ms，且前面根本没有用道具', () => {
  // 账本实测形状：clearitemget → 1640~2904ms → material。窗口没武装，自然落不到道具头上。
  assert.deepEqual(
    feed([
      [QUEST_REWARD_PATH, 0],
      [MATERIAL_REFRESH_PATH, 1640],
    ]),
    [null, null],
  )
  // 就算前面真有一次用道具，1640ms 也已经出了窗口——「其他」那侧的最快样本吞不进来
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 0],
      [QUEST_REWARD_PATH, 1],
      [MATERIAL_REFRESH_PATH, 1640],
    ]),
    [null, null, null],
  )
})

test('近代化改修那族不吞：间隔虽然同样是 223ms，但前面是 ship3 不是用道具', () => {
  assert.deepEqual(
    feed([
      [SHIP3_PATH, 0],
      [MATERIAL_REFRESH_PATH, 223],
    ]),
    [null, null],
  )
})

test('一次使用只认一次刷新：同一次用道具吞不下第二包余额', () => {
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 0],
      [MATERIAL_REFRESH_PATH, 230],
      [MATERIAL_REFRESH_PATH, 400],
    ]),
    [null, PAY_ITEM_CATEGORY, null],
  )
})

test('连点五下タンカー徴用：五对「使用→刷新」交替到达，五笔全中', () => {
  // 2026-08-27 23:40:24~29 的实测形状：每对间隔 227~238ms，两次使用相距约 930~1360ms
  const events = []
  let ts = 0
  for (let i = 0; i < 5; i++) {
    events.push([PAY_ITEM_USE_PATH, ts])
    events.push([MATERIAL_REFRESH_PATH, ts + 230])
    ts += 1100
  }
  const verdicts = feed(events)
  assert.deepEqual(
    verdicts.filter((one) => one !== null),
    Array(5).fill(PAY_ITEM_CATEGORY),
  )
})

test('中间夹别的报文不影响武装', () => {
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 0],
      [PORT_PATH, 100],
      [MATERIAL_REFRESH_PATH, 230],
    ]),
    [null, null, PAY_ITEM_CATEGORY],
  )
})

test('时间倒流不认（回放喂错序时不许瞎认）', () => {
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 500],
      [MATERIAL_REFRESH_PATH, 400],
    ]),
    [null, null],
  )
})

test('免费道具单独一类，绝不混进氪金那一格', () => {
  assert.notEqual(ITEM_USE_CATEGORY, PAY_ITEM_CATEGORY)
  assert.deepEqual(
    feed([
      [ITEM_USE_PATH, 0],
      [MATERIAL_REFRESH_PATH, 230],
    ]),
    [null, ITEM_USE_CATEGORY],
  )
})

test('家具箱那条实测形状不落任何一类：后面根本没有 material 包', () => {
  // 2026-08-28 11:06:08 的原样序列：itemuse → useitem(+393ms) → basic(+648ms)
  assert.deepEqual(
    feed([
      [ITEM_USE_PATH, 0],
      ['/kcsapi/api_get_member/useitem', 393],
      ['/kcsapi/api_get_member/basic', 648],
    ]),
    [null, null, null],
  )
})

test('母港拡張那条实测形状不落任何一类：跟的是 basic 不是 material', () => {
  // 2026-08-19 12:37:04 的原样序列，api_item 全 0 —— 没有资源变动就没有这一笔
  assert.deepEqual(
    feed([
      [PAY_ITEM_USE_PATH, 0],
      ['/kcsapi/api_get_member/basic', 234],
      [PORT_PATH, 4834],
    ]),
    [null, null, null],
  )
})

test('回放与实时归因是同一台状态机：混合序列产出「时刻 → 类名」', () => {
  // 2026-08-28 00:52:15~18 的原样形状：タンカー徴用×2 接アルミ大量産×2，
  // 中间穿插 port，末尾一笔补给的资源刷新不在窗口里。
  const events = [
    { path: PAY_ITEM_USE_PATH, ts: 1000 },
    { path: MATERIAL_REFRESH_PATH, ts: 1224 },
    { path: PAY_ITEM_USE_PATH, ts: 1894 },
    { path: MATERIAL_REFRESH_PATH, ts: 2119 },
    { path: ITEM_USE_PATH, ts: 2829 },
    { path: MATERIAL_REFRESH_PATH, ts: 3057 },
    { path: QUEST_REWARD_PATH, ts: 5000 },
    { path: MATERIAL_REFRESH_PATH, ts: 6800 },
  ]
  const found = replayItemUseMaterialCategories(events)
  assert.deepEqual(
    [...found.entries()].sort((a, b) => a[0] - b[0]),
    [
      [1224, PAY_ITEM_CATEGORY],
      [2119, PAY_ITEM_CATEGORY],
      [3057, ITEM_USE_CATEGORY],
    ],
  )
  // 任务领奖那一笔留在外面，回放不去碰它
  assert.equal(found.has(6800), false)
})

test('回放空输入是空操作', () => {
  assert.equal(replayItemUseMaterialCategories([]).size, 0)
})
