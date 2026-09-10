import assert from 'node:assert/strict'
import test from 'node:test'

import edgeCost from '../dist/shared/remodel-edge-cost.js'

const { remodelEdgeCost } = edgeCost
const oldWiki = { 等级: 0, 弹药: 0, 钢材: 0 }
const yamashiro = { api_aftershipid: '749', api_afterlv: 92, api_afterbull: 3200, api_afterfuel: 5400 }

test('412 → 749：主数据 92/3200/5400 优先于 kcwiki 的 0 占位', () => {
  assert.deepEqual(remodelEdgeCost(yamashiro, 749, oldWiki), {
    level: 92, bull: 3200, fuel: 5400, source: 'master',
  })
})

test('119 → 1071：主数据等级 88 与弹钢优先于 kcwiki 的 0 占位', () => {
  // 弹钢为测试输入，只验证取值优先级，不宣称是该形态的实测消耗。
  const kitakami = { api_aftershipid: 1071, api_afterlv: 88, api_afterbull: 3200, api_afterfuel: 5400 }
  assert.deepEqual(remodelEdgeCost(kitakami, 1071, oldWiki), {
    level: 88, bull: 3200, fuel: 5400, source: 'master',
  })
})

test('主数据指向别的形态时，采用 wiki 这条边的值', () => {
  assert.deepEqual(remodelEdgeCost(yamashiro, 748, { 等级: 80, 弹药: 1000, 钢材: 2000 }), {
    level: 80, bull: 1000, fuel: 2000, source: 'wiki',
  })
})

test('两边都没有整数值时，三项均为未知', () => {
  for (const absent of [null, undefined, {}]) {
    assert.deepEqual(remodelEdgeCost(absent, 749, absent), {
      level: '?', bull: '?', fuel: '?', source: 'none',
    })
  }
})

test('主数据边匹配且完整时，不需要 wiki', () => {
  assert.deepEqual(remodelEdgeCost(yamashiro, 749, undefined), {
    level: 92, bull: 3200, fuel: 5400, source: 'master',
  })
})

test('主数据任一项不是整数时，整组退回 wiki，不混用两种来源', () => {
  for (const field of ['api_afterlv', 'api_afterbull', 'api_afterfuel']) {
    for (const invalid of [undefined, 1.5, NaN, Infinity, '92']) {
      assert.deepEqual(remodelEdgeCost({ ...yamashiro, [field]: invalid }, 749, oldWiki), {
        level: 0, bull: 0, fuel: 0, source: 'wiki',
      })
    }
  }
})

test('wiki 部分字段是整数时保留有效项，其余显示未知', () => {
  for (const [field, output] of [['等级', 'level'], ['弹药', 'bull'], ['钢材', 'fuel']]) {
    assert.deepEqual(remodelEdgeCost(null, 749, { 等级: 1.5, 弹药: NaN, 钢材: Infinity, [field]: 0 }), {
      level: '?', bull: '?', fuel: '?', [output]: 0, source: 'wiki',
    })
  }
  assert.deepEqual(remodelEdgeCost(null, 749, { 等级: 1.5, 弹药: NaN, 钢材: Infinity }), {
    level: '?', bull: '?', fuel: '?', source: 'none',
  })
})

test('主数据这条边的整数 0 是有效值', () => {
  assert.deepEqual(remodelEdgeCost({ api_aftershipid: '749', api_afterlv: 0, api_afterbull: 0, api_afterfuel: 0 }, 749, { 等级: 92, 弹药: 3200, 钢材: 5400 }), {
    level: 0, bull: 0, fuel: 0, source: 'master',
  })
})
