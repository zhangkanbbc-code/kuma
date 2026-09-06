import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import engine from '../dist/shared/routing-engine.js'
import routingRuleNames from '../dist/shared/routing-rule-name.js'
import {
  cleanupRoutingRuleFixture,
  renderedRulesOf,
  renderRoutingRules,
} from './fixtures/render-routing-rules.mjs'

const { evaluateRoutingRules } = engine
const { buildRoutingRuleShipNameIndex, normalizeRoutingRuleShipNames } = routingRuleNames
const routing = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/kcwiki-routing.json', import.meta.url), 'utf8'),
)
const localization = JSON.parse(
  fs.readFileSync(new URL('../assets/lodes/kcwiki-localization.json', import.meta.url), 'utf8'),
)
const index = buildRoutingRuleShipNameIndex(localization.data)

test.after(cleanupRoutingRuleFixture)

test('索引只收含假名的舰名，并按最长名字优先替换', () => {
  assert.equal(index.length, 6)
  assert.ok(index.every(([ja]) => /[\u3041-\u3096\u30A1-\u30FA\u30FD-\u30FF]/.test(ja)))

  const synthetic = buildRoutingRuleShipNameIndex({
    entities: {
      ship: {
        1: { ja: 'あきつ丸', zh: '短名' },
        2: { ja: 'あきつ丸改', zh: '完整名' },
        3: { ja: '祥鳳', zh: '祥凤' },
      },
    },
  })
  assert.equal(normalizeRoutingRuleShipNames('带あきつ丸改', synthetic), '带完整名')
})

test('中文带路条件渲染时把日文舰名换成随包中文名', () => {
  const data = {
    sample: {
      nodes: [{ from: 'A', rules: ['あきつ丸>=1 去B'] }],
    },
  }
  const html = renderRoutingRules('sample', data, localization.data)
  assert.deepEqual(renderedRulesOf(html), ['秋津丸&#62;=1 去B'])
  assert.equal(html.includes('あきつ丸'), false)
})

test('不含日文舰名的规则渲染逐字节不变', () => {
  const rule = 'BB系 < 2 & CVL>=1'
  const data = { sample: { nodes: [{ from: 'A', rules: [rule] }] } }
  assert.deepEqual(renderedRulesOf(renderRoutingRules('sample', data, localization.data)), [
    'BB系 &#60; 2 &#38; CVL&#62;=1',
  ])
})

test('已经是中文的舰名渲染逐字节不变', () => {
  const rule = '带祥凤 去B'
  const data = { sample: { nodes: [{ from: 'A', rules: [rule] }] } }
  assert.deepEqual(renderedRulesOf(renderRoutingRules('sample', data, localization.data)), [rule])
})

test('显示期归一不改带路数据，也不改 42 张图全部节点的引擎结果', () => {
  const context = {
    shipCount: 6,
    counts: {},
    shipNames: ['あきつ丸'],
    flagshipName: 'あきつ丸',
    flagshipTypes: ['LHA'],
    speed: 10,
    los: { 1: 50, 2: 50, 3: 50, 4: 50 },
    equipmentShipCounts: { radar: 0, drum: 0, landingCraft: 0 },
    passed: [],
    phase: null,
    difficulty: '甲',
  }
  const rawBefore = JSON.stringify(routing.data)
  const decisionsBefore = Object.values(routing.data).flatMap((map) =>
    map.nodes.map((node) => evaluateRoutingRules(node.rules, context)),
  )

  for (const code of Object.keys(routing.data)) {
    renderRoutingRules(code, routing.data, localization.data)
  }

  assert.equal(Object.keys(routing.data).length, 42)
  assert.equal(JSON.stringify(routing.data), rawBefore)
  const decisionsAfter = Object.values(routing.data).flatMap((map) =>
    map.nodes.map((node) => evaluateRoutingRules(node.rules, context)),
  )
  assert.deepEqual(decisionsAfter, decisionsBefore)
})
