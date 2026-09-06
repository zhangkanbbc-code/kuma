import assert from 'node:assert/strict'
import test from 'node:test'

import { airPower, renderPlane, reset } from './fixtures/render-ru-air-base.mjs'

const masters = [
  { id: 269, name: '試製東海', type2: 47, iconId: 47, tyku: 0, baku: 0, houk: 0, houm: 0, saku: 5 },
  { id: 453, name: 'キ102乙', type2: 47, iconId: 48, tyku: 4, baku: 19, houk: 0, houm: 4, saku: 0 },
  { id: 257, name: 'TBM-3D', type2: 8, iconId: 46, tyku: 1, baku: 8, houk: 0, houm: 2, saku: 4 },
]

test.beforeEach(() => reset(masters))

test('陆航机位直接显示 count/maxCount，不按東海的 icon 47 过滤', () => {
  const html = renderPlane({ slotId: 1, count: 18, maxCount: 18, cond: 1, state: 1 })
  assert.match(html, /data-icon="47"/)
  assert.match(html, /試製東海/)
  assert.match(html, /<b>18\/18<\/b>/)
})

test('陆航制空按 type2 计算東海、キ102乙与 TBM-3D，不读取 iconId', () => {
  const expected = { basic: 20, min: 20, max: 22 }
  assert.deepEqual(airPower([18, 18, 18]), expected)
  reset(masters.map((master) => ({ ...master, iconId: 25 })))
  assert.deepEqual(airPower([18, 18, 18]), expected, '图标全换成ドラム缶也不应改变制空值')
})
