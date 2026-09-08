import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, TS, reset, feed, player, useitemLog } from './fixtures/store-mission-result.mjs'

const item = (id, count, name = '') => ({
  api_useitem_id: id, api_useitem_count: count, api_useitem_name: name,
})
const screw = item(4, 1, '改修資材')
const furniture = item(10, 1, '家具箱（小）')
const check = (sections, gains, furnitureGain = 0) => {
  assert.deepEqual(player().materials, BASE.map((value, i) => value + (gains[i] ?? 0)))
  assert.deepEqual(player().useitems, { 10: 2 + furnitureGain })
  assert.deepEqual(useitemLog(), furnitureGain ? [
    { ts: TS, changes: [{ id: 10, delta: furnitureGain, total: 2 + furnitureGain }] },
  ] : [])
  assert.equal(sections.includes('materials'), Object.keys(gains).length > 0)
  assert.equal(sections.includes('useitems'), furnitureGain > 0)
}

test('① [3,4] 开发与改修资材连同燃弹钢铝入资源，不造道具流水', () => {
  reset()
  check(feed({ api_useitem_flag: [3, 4], api_get_item1: item(-1, 3), api_get_item2: screw,
    api_get_material: [450, 0, 225, 570] }), { 0: 450, 1: 0, 2: 225, 3: 570, 6: 3, 7: 1 })
})

test('② [0,4] 改修资材只增加资源下标 7', () => {
  reset()
  check(feed({ api_useitem_flag: [0, 4], api_get_item2: screw }), { 7: 1 })
})

test('③ [1,2] id -1 按 flag 分别增加桶与高速建造材', () => {
  reset()
  check(feed({ api_useitem_flag: [1, 2], api_get_item1: item(-1, 1), api_get_item2: item(-1, 2) }),
    { 5: 1, 4: 2 })
})

test('④ [4,0] 家具箱仍增加道具并落账', () => {
  reset()
  check(feed({ api_useitem_flag: [4, 0], api_get_item1: furniture }), {}, 1)
})

test('⑤ [4,1] 家具箱与桶分别记入道具和资源', () => {
  reset()
  check(feed({ api_useitem_flag: [4, 1], api_get_item1: furniture, api_get_item2: item(-1, 1) }),
    { 5: 1 }, 1)
})

test('⑥ 缺 flag 的 item id 4 仍按资材计入资源', () => {
  reset()
  check(feed({ api_get_item2: screw }), { 7: 1 })
})

test('⑦ materials 无基线时不推算、不报 materials，道具照常落账', () => {
  for (const body of [
    { api_useitem_flag: [4, 1], api_get_item1: furniture, api_get_item2: item(-1, 1) },
    { api_useitem_flag: [4, 4], api_get_item1: furniture, api_get_item2: screw },
  ]) {
    reset(null)
    const sections = feed({ ...body, api_get_material: [450, 0, 225, 570] })
    assert.equal(player().materials, null)
    assert.deepEqual(player().useitems, { 10: 3 })
    assert.deepEqual(useitemLog(), [{ ts: TS, changes: [{ id: 10, delta: 1, total: 3 }] }])
    assert.equal(sections.includes('materials'), false)
    assert.equal(sections.includes('useitems'), true)
  }
})

test('flag 4 与缺 flag 的 id 1–4 映射一致；缺 flag 的真道具照记', () => {
  for (const flag of [4, undefined]) {
    for (const [id, index] of [[1, 5], [2, 4], [3, 6], [4, 7]]) {
      reset()
      check(feed({ api_useitem_flag: flag == null ? undefined : [flag, 0],
        api_get_item1: item(id, 1) }), { [index]: 1 })
    }
  }
  reset()
  check(feed({ api_get_item1: furniture }), {}, 1)
})

test('id -1 在 flag 0 或缺席时不入账；[3,0] 单份开发资材只加下标 6', () => {
  for (const flags of [[0, 0], undefined]) {
    reset()
    check(feed({ api_useitem_flag: flags, api_get_item1: item(-1, 1) }), {})
  }
  reset()
  check(feed({ api_useitem_flag: [3, 0], api_get_item1: item(-1, 1) }), { 6: 1 })
})
