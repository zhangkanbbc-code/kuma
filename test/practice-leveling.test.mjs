import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-practice-leveling-'))
const output = path.join(tempDir, 'practice-leveling.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/practice-leveling.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const {
  buildRemodelStageMap,
  isAdvancedRemodelTarget,
  isFinalRemodelTarget,
  levelingGroups,
} = require(output)

const ship = (over) => ({
  rosterId: 1,
  mstId: 100,
  level: 50,
  afterShipId: 200,
  afterLv: 60,
  progressive: true,
  expGap: null,
  ...over,
})

test('收藏置顶：两种排序里收藏都先于未收藏，组内再按各自口径', () => {
  const { oneWay } = levelingGroups([
    ship({ rosterId: 1, mstId: 101, level: 58, afterLv: 60 }), // 差 2 级，未收藏
    ship({ rosterId: 2, mstId: 102, level: 50, afterLv: 60, favorite: true }), // 差 10 级，收藏
    ship({ rosterId: 3, mstId: 103, level: 55, afterLv: 60, favorite: true }), // 差 5 级，收藏
  ])
  // 收藏的两艘都在未收藏之前；收藏组内仍按级差（5 < 10）
  assert.deepEqual(oneWay.map((r) => r.rosterId), [3, 2, 1])

  const { oneWay: byExp } = levelingGroups(
    [
      ship({ rosterId: 1, mstId: 101, level: 58, afterLv: 60, expGap: 1000 }),
      ship({ rosterId: 2, mstId: 102, level: 50, afterLv: 60, expGap: 90000, favorite: true }),
    ],
    'exp',
  )
  assert.deepEqual(byExp.map((r) => r.rosterId), [2, 1], '按经验排时收藏也要置顶')
})

test('最终改造判据：链尾/可逆环算最终段，中间段不算', () => {
  const after = (edges) => (id) => edges[id] ?? 0
  // 只有改一（海外舰典型）：未改(1)→改(2) 到头
  const single = after({ 1: 2 })
  assert.equal(isFinalRemodelTarget(2, single), true, '改一即链尾')
  assert.equal(isFinalRemodelTarget(1, single), false, '未改后面还有改一，不是最终段')
  // 传统改二：未改(1)→改(2)→改二(3)
  const kai2 = after({ 1: 2, 2: 3 })
  assert.equal(isFinalRemodelTarget(2, kai2), false, '早期改一是中间段')
  assert.equal(isFinalRemodelTarget(3, kai2), true)
  // 可逆环（翔鶴式）：改(2)→改二(3)⇄改二甲(4)——环内互指，环即最终档
  const loop = after({ 1: 2, 2: 3, 3: 4, 4: 3 })
  assert.equal(isFinalRemodelTarget(3, loop), true, '改二在可逆环里，算最终段')
  assert.equal(isFinalRemodelTarget(4, loop), true)
  assert.equal(isFinalRemodelTarget(2, loop), false)
  // 有改三（時雨式）：改二(3)之后还有改三(5)——最终段是改三那一步
  const kai3 = after({ 1: 2, 2: 3, 3: 5 })
  assert.equal(isFinalRemodelTarget(3, kai3), false, '改二后面还有改三')
  assert.equal(isFinalRemodelTarget(5, kai3), true)
  // 三节可逆环（夕張式多形态互转）也认
  const triLoop = after({ 1: 2, 2: 3, 3: 4, 4: 5, 5: 3 })
  assert.equal(isFinalRemodelTarget(3, triLoop), true)
  // 走进不含目标的环：判不了按非最终段处理，且不死循环
  assert.equal(isFinalRemodelTarget(1, after({ 1: 2, 2: 3, 3: 2 })), false)
  // 自指/无后继直接终止
  assert.equal(isFinalRemodelTarget(9, after({ 9: 9 })), true)
  assert.equal(isFinalRemodelTarget(9, after({})), true)
})

test('最终改造筛选：finalOnly 只留目标为链尾的行，默认不筛', () => {
  const ships = [
    ship({ rosterId: 1, mstId: 101, targetFinal: false }),
    ship({ rosterId: 2, mstId: 102, targetFinal: true }),
    ship({ rosterId: 3, mstId: 103, progressive: false, targetFinal: true }),
    ship({ rosterId: 4, mstId: 104, progressive: false, targetFinal: false }),
  ]
  const off = levelingGroups(ships)
  assert.deepEqual(off.oneWay.map((r) => r.rosterId), [1, 2], '默认（不传）不筛')
  assert.deepEqual(off.reversible.map((r) => r.rosterId), [3, 4])
  const on = levelingGroups(ships, 'level', { finalOnly: true })
  assert.deepEqual(on.oneWay.map((r) => r.rosterId), [2], '中间段的单向缺口被筛掉')
  assert.deepEqual(on.reversible.map((r) => r.rosterId), [3], '双向行同样按目标是否链尾筛')
})

test('改造段位图：链根数段、可逆环按进环段计、不死循环', () => {
  // 传统链：未改(1)→改(2)→改二(3)；海外单段：未改(10)→改(11)
  // 可逆环（朝潮式）：未改(20)→改(21)→改二(22)⇄改二丁(23)
  const stages = buildRemodelStageMap([
    { id: 1, afterId: 2 },
    { id: 2, afterId: 3 },
    { id: 3, afterId: 0 },
    { id: 10, afterId: 11 },
    { id: 11, afterId: 0 },
    { id: 20, afterId: 21 },
    { id: 21, afterId: 22 },
    { id: 22, afterId: 23 },
    { id: 23, afterId: 22 },
  ])
  assert.equal(stages.get(2), 1, '改一是第 1 段')
  assert.equal(stages.get(3), 2, '改二是第 2 段')
  assert.equal(stages.get(11), 1)
  assert.equal(stages.get(22), 2)
  assert.equal(stages.get(23), 3, '环里的丁按进环那一段计')
  assert.equal(stages.has(1), false, '链根不是任何改造的目标，不在图里')
  // 自指与全环（无链根）不炸也不误标
  const weird = buildRemodelStageMap([
    { id: 30, afterId: 30 },
    { id: 40, afterId: 41 },
    { id: 41, afterId: 40 },
  ])
  assert.equal(weird.has(30), false)
  assert.equal(weird.has(40), false, '全环无链根：正向走链走不进去，如实不标')
})

test('进阶改造判据：段≥2 或（链尾一段改 且 Lv≥45）', () => {
  const edges = { 1: 2, 2: 3, 10: 11, 50: 51 }
  const after = (id) => edges[id] ?? 0
  const stages = buildRemodelStageMap(
    Object.keys({ ...edges, 3: 0, 11: 0, 51: 0 }).map((id) => ({
      id: Number(id),
      afterId: edges[id] ?? 0,
    })),
  )
  assert.equal(isAdvancedRemodelTarget(3, 78, stages, after), true, '改二（段2）是进阶')
  assert.equal(isAdvancedRemodelTarget(2, 20, stages, after), false, '传统早期改一是中间段，不进阶')
  assert.equal(isAdvancedRemodelTarget(11, 75, stages, after), true, '海外改一 Lv75（链尾）是进阶')
  assert.equal(isAdvancedRemodelTarget(51, 37, stages, after), false, '低级链尾改一（海防式）不进阶')
  assert.equal(isAdvancedRemodelTarget(51, 45, stages, after), true, 'Lv45 是高级改一的下限（含）')
})

test('进阶分组置顶：两种排序都是 收藏→进阶→初段，组内再按各自口径', () => {
  const { oneWay } = levelingGroups([
    ship({ rosterId: 1, mstId: 101, level: 58, afterLv: 60 }), // 初段，差 2
    ship({ rosterId: 2, mstId: 102, level: 70, afterLv: 84, advanced: true }), // 进阶，差 14
    ship({ rosterId: 3, mstId: 103, level: 75, afterLv: 84, advanced: true }), // 进阶，差 9
    ship({ rosterId: 4, mstId: 104, level: 55, afterLv: 60, favorite: true }), // 收藏的初段，差 5
  ])
  // 收藏最优先（哪怕是初段），进阶整组在初段之前，组内按级差
  assert.deepEqual(oneWay.map((r) => r.rosterId), [4, 3, 2, 1])

  const { oneWay: byExp } = levelingGroups(
    [
      ship({ rosterId: 1, mstId: 101, expGap: 1000 }), // 初段，最便宜
      ship({ rosterId: 2, mstId: 102, expGap: 90000, advanced: true }),
      ship({ rosterId: 3, mstId: 103, expGap: 50000, advanced: true }),
    ],
    'exp',
  )
  assert.deepEqual(byExp.map((r) => r.rosterId), [3, 2, 1], '按经验时进阶也整组在前')
})

test('收藏不改变单向/双向分组，也不把无缺口的塞回列表', () => {
  const { oneWay, reversible } = levelingGroups([
    ship({ rosterId: 1, mstId: 101, progressive: false, favorite: true }), // 双向
    ship({ rosterId: 2, mstId: 102, level: 60, afterLv: 60, favorite: true }), // 已到级 → 不进
    ship({ rosterId: 3, mstId: 103 }),
  ])
  assert.deepEqual(oneWay.map((r) => r.rosterId), [3])
  assert.deepEqual(reversible.map((r) => r.rosterId), [1])
  assert.equal(oneWay[0].favorite, false)
  assert.equal(reversible[0].favorite, true)
})
