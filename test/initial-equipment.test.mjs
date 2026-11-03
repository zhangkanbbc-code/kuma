// 维护者裁决 2026-11-03：混合初始装备保留星级，负搭载视为没有数据。
import assert from 'node:assert/strict'
import test from 'node:test'
import sources from '../dist/shared/equip-sources.js'
import initial from '../dist/shared/initial-equipment.js'
import { akizukiKaiNi, akizukiKai, equips, renderInitialSlots, loadStockEquipment, stockEquipment, directEquipment } from './fixtures/initial-equipment.mjs'

const namesOf = (html) => [...html.matchAll(/data-eid="\d+">([^<]+)<\/span>(★\+\d+)?/g)].map(match => match[1] + (match[2] ?? ''))

test('共用归一化只接收数字或带 id、star 的对象，保留空槽 -1', () => {
  assert.deepEqual(initial.normalizeInitialEquipment(122), { id: 122, star: 0 })
  assert.deepEqual(initial.normalizeInitialEquipment(-1), { id: -1, star: 0 })
  assert.deepEqual(initial.normalizeInitialEquipment({ id: 122, star: 4 }), { id: 122, star: 4 })
  for (const entry of [null, undefined, '122', {}, [], { id: 122 }, { id: '122', star: 4 }, { id: 122, star: '4' }, NaN]) {
    assert.equal(initial.normalizeInitialEquipment(entry), null)
  }
})

test('963 初始装备显示四格及真实星级，不显示负搭载或格纳库增量', () => {
  const html = renderInitialSlots(akizukiKaiNi, equips, { 0: { rosterId: 1, base: 0, extra: 1 } })
  assert.equal((html.match(/class="slot"/g) ?? []).length, 4)
  assert.deepEqual(namesOf(html), ['10cm連装高角砲+高射装置★+4', '61cm四連装(酸素)魚雷★+2', '94式高射装置', '25mm三連装機銃★+4'])
  assert.doesNotMatch(html, /搭载 -1|class="hx"|含格納庫増設/)
  const empty = renderInitialSlots({ ID: 963, 装备: { 初期装备: [-1], 搭载: [-1] } }, equips)
  assert.match(empty, /空槽/)
  assert.doesNotMatch(empty, /搭载 -1/)
})

test('330 纯数字初始装备保留原有三格、白板名称和搭载 0', () => {
  const html = renderInitialSlots(akizukiKai, equips)
  assert.deepEqual(namesOf(html), ['10cm連装高角砲+高射装置', '13号対空電探改', '25mm三連装機銃'])
  assert.equal((html.match(/初始装备 · 搭载 0/g) ?? []).length, 3)
  assert.doesNotMatch(html, /★/)
})

test('wikiwiki 档案回退仍显示纯数字条目，也共用混合条目读法', () => {
  assert.deepEqual(namesOf(renderInitialSlots(akizukiKai, equips, {}, true)), namesOf(renderInitialSlots(akizukiKai, equips)))
  assert.deepEqual(namesOf(renderInitialSlots(akizukiKaiNi, equips, {}, true)), ['10cm連装高角砲+高射装置★+4', '61cm四連装(酸素)魚雷★+2', '94式高射装置', '25mm三連装機銃★+4'])
})

test('122、15、121、40 的初始装备来源都包含 963', () => {
  for (const id of [122, 15, 121, 40]) assert.deepEqual(sources.initialEquipShips([akizukiKaiNi], id), [963])
})

test('963 演习通用配装四件完整传入星级，负搭载全部归零', async () => {
  await loadStockEquipment([akizukiKaiNi, akizukiKai], equips)
  assert.deepEqual(stockEquipment(963).map(item => [item.mstId, item.level, item.planeCount]), [[122, 4, 0], [15, 2, 0], [121, 0, 0], [40, 4, 0]])
  assert.deepEqual(stockEquipment(330).map(item => [item.mstId, item.level, item.planeCount]), [[122, 0, 0], [106, 0, 0], [40, 0, 0]])
})

test('空槽及非法形状跳过时，后续装备仍取原槽位的搭载', async () => {
  const row = { ID: 999, 装备: { 初期装备: [-1, null, { id: 122, star: 4 }], 搭载: [1, 2, 7] } }
  await loadStockEquipment([row], equips)
  assert.deepEqual(stockEquipment(999).map(item => [item.mstId, item.level, item.planeCount]), [[122, 4, 7]])
  const html = renderInitialSlots(row, equips)
  assert.equal((html.match(/class="slot"/g) ?? []).length, 2)
  assert.match(html, /空槽<i>搭载 1/)
  assert.match(html, /初始装备 · 搭载 7/)
})

test('其它预测装备入口也不会传入负机数', async () => {
  await loadStockEquipment([akizukiKaiNi], equips)
  for (const equipment of directEquipment()) assert.equal(equipment[0].planeCount, 0)
})

test('搭载 0 仍可显示持有实例的格纳库增设', () => {
  const html = renderInitialSlots(akizukiKai, equips, { 0: { rosterId: 1, base: 0, extra: 1 } })
  assert.match(html, /含格納庫増設/)
  assert.match(html, /class="hx"[^>]*>\+1/)
})
