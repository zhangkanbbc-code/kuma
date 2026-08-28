import assert from 'node:assert/strict'
import test from 'node:test'

import factoryLookupModule from '../dist/shared/factory-lookup.js'

const { factoryLookup, recipeText } = factoryLookupModule

const ROWS = [
  {
    recipe: [30, 30, 20, 10],
    attempts: 40,
    firstTs: 1,
    lastTs: 9,
    // 开发失败在账本里是 mstId = -1，不能被当成某件装备
    outcomes: [{ mstId: 12, count: 3 }, { mstId: -1, count: 20 }],
  },
  {
    recipe: [10, 10, 10, 10],
    attempts: 100,
    firstTs: 2,
    lastTs: 8,
    outcomes: [{ mstId: 12, count: 5 }, { mstId: 4, count: 30 }],
  },
  {
    recipe: [20, 20, 20, 20],
    attempts: 7,
    firstTs: 3,
    lastTs: 4,
    outcomes: [{ mstId: 4, count: 1 }],
  },
]

test('looking a result up gathers only the recipes that actually produced it', () => {
  const found = factoryLookup(ROWS, 12)
  assert.equal(found.hits, 8)
  // 分母只算出过它的那两个配方（40 + 100），不含从没出过它的第三个
  assert.equal(found.attempts, 140)
  // 全量分母另给，两个都摆出来
  assert.equal(found.totalAttempts, 147)
  assert.deepEqual(found.recipes.map((r) => [r.recipe.join('/'), r.hits]), [
    ['10/10/10/10', 5],
    ['30/30/20/10', 3],
  ])
})

test('a result never produced reports zero hits but still reports the total tries', () => {
  const missing = factoryLookup(ROWS, 999)
  assert.equal(missing.hits, 0)
  assert.equal(missing.recipes.length, 0)
  assert.equal(missing.totalAttempts, 147)
})

test('development failures are not a result and cannot be looked up', () => {
  // -1 是「开发失败」的占位；当成装备查会把失败次数报成出货
  assert.equal(factoryLookup(ROWS, -1).hits, 0)
  assert.equal(factoryLookup(null, 12).hits, 0)
})

test('recipe text keeps the extra build columns instead of dropping them', () => {
  assert.equal(recipeText([30, 30, 20, 10]), '30/30/20/10')
  assert.equal(recipeText([400, 100, 600, 30, 10, 1]), '400/100/600/30 · 开发资材 10 · 大型')
  assert.equal(recipeText([]), '配方不详')
})

test('secretary dev-table classification follows the wikiwiki chart, quirks included', () => {
  // 口径：wikiwiki「開発」页（实证 2026-08-10）。三个反直觉归属是这张表的
  // 存在理由——凭舰种直觉猜必错：航戦・航巡在空母系，工作艦在砲戦系，補給艦在水雷系。
  const { devSecretaryTypeOf } = factoryLookupModule
  assert.equal(devSecretaryTypeOf(10), '空母系') // 航空戦艦
  assert.equal(devSecretaryTypeOf(6), '空母系') // 航空巡洋艦
  assert.equal(devSecretaryTypeOf(19), '砲戦系') // 工作艦
  assert.equal(devSecretaryTypeOf(22), '水雷系') // 補給艦
  // 四系各抽一个常规代表
  assert.equal(devSecretaryTypeOf(9), '砲戦系') // 戦艦
  assert.equal(devSecretaryTypeOf(2), '水雷系') // 駆逐
  assert.equal(devSecretaryTypeOf(11), '空母系') // 正規空母
  assert.equal(devSecretaryTypeOf(13), '潜水系') // 潜水艦
  assert.equal(devSecretaryTypeOf(14), '潜水系') // 潜水空母
  assert.equal(devSecretaryTypeOf(20), '潜水系') // 潜水母艦
  // 玩家侧不存在的舰种宁缺毋滥
  assert.equal(devSecretaryTypeOf(12), null)
  assert.equal(devSecretaryTypeOf(15), null)
  assert.equal(devSecretaryTypeOf(0), null)
})

test('reverse lookup carries the secretary table through to each recipe row', () => {
  const rows = [
    { recipe: [10, 10, 10, 10], attempts: 30, firstTs: 1, lastTs: 2, secretary: '水雷系', outcomes: [{ mstId: 12, count: 2 }] },
    { recipe: [10, 10, 10, 10], attempts: 10, firstTs: 3, lastTs: 4, secretary: null, outcomes: [{ mstId: 12, count: 1 }] },
  ]
  const found = factoryLookupModule.factoryLookup(rows, 12)
  // 同配方不同秘书舰是两行——滚的本来就是两张表，不许合并
  assert.deepEqual(found.recipes.map((r) => r.secretary), ['水雷系', null])
})

test('dev reference recipes derive from the published rule, not folklore', () => {
  // 两条都是 wikiwiki「開発」明文规则：理論値=廃棄×10（每项下限 10），
  // 四项最高者决定表。推导必须还原出社区经典配方，否则就是推错了。
  const { devReferenceRecipe } = factoryLookupModule
  // 46cm三連装砲 廃棄 [0,24,25,0]：弹药表 = 弹药抬到严格最高
  assert.deepEqual(devReferenceRecipe([0, 24, 25, 0], '弹药'), [10, 251, 250, 10])
  // 同一装备的铝表：铝从下限 10 抬到 251
  assert.deepEqual(devReferenceRecipe([0, 24, 25, 0], '铝'), [10, 240, 250, 251])
  // 钢/燃表按钢给例：钢已是严格最高就不再抬
  assert.deepEqual(devReferenceRecipe([0, 3, 9, 0], '钢/燃'), [10, 30, 90, 10])
  // 全零廃棄的小装备：一切压在每项下限 10 上，目标表 11
  assert.deepEqual(devReferenceRecipe([0, 0, 0, 0], '弹药'), [10, 11, 10, 10])
  // 数据缺失或未知表名：宁可不显示
  assert.equal(devReferenceRecipe(null, '弹药'), null)
  assert.equal(devReferenceRecipe([1, 2], '弹药'), null)
  assert.equal(devReferenceRecipe([0, 24, 25, 0], '不存在的表'), null)
})
