// 图鉴 · 装备左侧列表显示装备中件数（2026-10-14 玩家建议、维护者裁决）：
// 原来每行只写「持有 ×N」，装备中的件数要点进详情才看得到。改为「持有 ×N · 装备中 M」，
// 装备中按舰上与基地航空队合计（与详情页、equippedInstIds 同一口径），为 0 时不写；曾持有 / 未持有照旧。
import assert from 'node:assert/strict'
import test from 'node:test'

import { renderEquipBookRow } from './fixtures/render-equip-book-row.mjs'

const 炮 = { api_id: 2, api_name: '12.7cm連装砲', api_rare: 1, api_type: [1, 1, 1, 1] }
/** 行里名字之后那一截说明文字（稀有度星 + 持有情况） */
const 说明 = (html) => /<div class="nm"><b>[\s\S]*?<\/b><span>([\s\S]*?)<\/span><\/div>/.exec(html)?.[1] ?? ''

test('有装备中的：持有 ×N · 装备中 M（舰上与基地航空队合计）', () => {
  const html = renderEquipBookRow({ equip: 炮, instances: { 2: [11, 12, 13, 14, 15] }, equipped: [11, 13, 15, 99] })
  assert.equal(说明(html), '★ · 持有 ×5 · 装备中 3')
})

test('一件都没装：只写持有，不写「装备中 0」', () => {
  const html = renderEquipBookRow({ equip: 炮, instances: { 2: [11, 12] }, equipped: [99] })
  assert.equal(说明(html), '★ · 持有 ×2')
  assert.ok(!html.includes('装备中'))
})

test('曾持有 / 未持有照旧', () => {
  assert.equal(说明(renderEquipBookRow({ equip: 炮, once: [2] })), '★ · 曾持有')
  assert.equal(说明(renderEquipBookRow({ equip: 炮 })), '★ · 未持有')
})

test('行的其余结构不变：选中态、灰行与 data-equip', () => {
  const html = renderEquipBookRow({ equip: 炮, instances: { 2: [11] }, equipped: [11] })
  assert.match(html, /^<div class="row" data-equip="2"/)
  assert.match(renderEquipBookRow({ equip: 炮 }), /^<div class="row ghost" data-equip="2"/)
  assert.match(renderEquipBookRow({ equip: 炮, once: [2] }), /^<div class="row ghost once" data-equip="2"/)
})
