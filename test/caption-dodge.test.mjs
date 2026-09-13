import assert from 'node:assert/strict'
import test from 'node:test'
import dodge from '../dist/shared/caption-dodge.js'

const { captionZoneOf, sanitizeCaptionZone, pointerInZone } = dodge
const wrapper = { left: 100, top: 50, width: 1000, height: 500 }

test('字幕区域按游戏区矩形换算为分数', () => {
  assert.deepEqual(captionZoneOf({ left: 140, top: 450, width: 920, height: 50 }, wrapper), {
    x0: 0.04, y0: 0.8, x1: 0.96, y1: 0.9,
  })
})

test('字幕区域越界夹紧，完全在外或任一矩形零尺寸返回 null', () => {
  assert.deepEqual(captionZoneOf({ left: 0, top: 0, width: 1200, height: 600 }, wrapper), {
    x0: 0, y0: 0, x1: 1, y1: 1,
  })
  assert.equal(captionZoneOf({ left: 1200, top: 50, width: 50, height: 50 }, wrapper), null)
  for (const key of ['width', 'height']) {
    assert.equal(captionZoneOf({ ...wrapper, [key]: 0 }, wrapper), null)
    assert.equal(captionZoneOf(wrapper, { ...wrapper, [key]: 0 }), null)
  }
})

test('字幕区域只接收四个有限且有序的 0–1 数值', () => {
  const valid = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 1 }
  assert.deepEqual(sanitizeCaptionZone(valid), valid)
  assert.notEqual(sanitizeCaptionZone(valid), valid)
  for (const raw of [null, undefined, false, 1, 'zone', [], {},
    ...Object.keys(valid).flatMap(key => [NaN, Infinity, -Infinity, '0.5', null, undefined].map(value => ({ ...valid, [key]: value }))),
    { ...valid, x0: -0.1 }, { ...valid, x1: 1.1 }, { ...valid, y0: -0.1 }, { ...valid, y1: 1.1 },
    { ...valid, x0: 0.9 }, { ...valid, x0: 1 }, { ...valid, y0: 1 }, { ...valid, y1: 0.7 },
  ]) assert.equal(sanitizeCaptionZone(raw), null)
})

test('指针命中包含四边与角点，排除区域外及非有限坐标', () => {
  const zone = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 1 }
  for (const x of [0.1, 0.5, 0.9]) {
    for (const y of [0.8, 0.9, 1]) assert.equal(pointerInZone(zone, x, y), true)
  }
  for (const [x, y] of [[0.09, 0.9], [0.91, 0.9], [0.5, 0.79], [0.5, 1.01], [NaN, 0.9], [0.5, Infinity]]) {
    assert.equal(pointerInZone(zone, x, y), false)
  }
})
