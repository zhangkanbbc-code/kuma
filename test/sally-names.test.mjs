import assert from 'node:assert/strict'
import test from 'node:test'

import sallyNames from '../dist/shared/sally-names.js'
import histFleets from '../dist/shared/hist-fleets.js'

const { SALLY_TAG_NAMES, sallyTagLabel, sallyTagNameOf } = sallyNames
const { histFleetById } = histFleets

test('札真名表：同一区内札号唯一，名字非空', () => {
  const seen = new Set()
  for (const entry of SALLY_TAG_NAMES) {
    const key = `${entry.area}:${entry.tag}`
    assert.ok(!seen.has(key), `札撞车：${key}`)
    seen.add(key)
    assert.ok(entry.tag > 0, '札号从 1 起')
    assert.ok(entry.name.trim(), `${key} 没有名字`)
    assert.ok(['front', 'rear'].includes(entry.phase), `${key} 段别非法`)
  }
})

test('62 区落的是 13 枚，前段 6 后段 7', () => {
  const area62 = SALLY_TAG_NAMES.filter((entry) => entry.area === 62)
  assert.equal(area62.length, 13)
  assert.deepEqual(
    area62.map((entry) => entry.tag),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  )
  // 账本实证钉住的就是这条分界：E-4（后段首图）产出的是 7 与 8
  assert.equal(area62.filter((entry) => entry.phase === 'front').length, 6)
  assert.equal(area62.filter((entry) => entry.phase === 'rear').length, 7)
  assert.equal(sallyTagNameOf(62, 7).phase, 'rear')
  assert.equal(sallyTagNameOf(62, 6).phase, 'front')
})

test('13 枚札都录了日文原名（2026-08-26 转录自 wikiwiki 主表），拼写照源保留', () => {
  for (const entry of SALLY_TAG_NAMES) {
    assert.ok(entry.ja?.trim(), `札 ${entry.area}:${entry.tag} 缺日文原名`)
    assert.notEqual(entry.ja, entry.name, `札 ${entry.area}:${entry.tag} 的日名与中文名不该同字`)
  }
  // 这三枚在游戏里是图片，录的是 wiki 档名转写——**不是笔误，别「修正」拼写**
  assert.equal(sallyTagNameOf(62, 9).ja, '2-eme Escadre Leoele')
  assert.equal(sallyTagNameOf(62, 11).ja, 'Force de Raid')
  assert.equal(sallyTagNameOf(62, 12).ja, 'Force H')
  // 日名与中文名按同一支部队配对，不按两份名单的行号配对（5/6 两号序次存疑，
  // 详见 sally-names 表头的注记）——配错了这两格会当场露馅
  assert.equal(sallyTagNameOf(62, 5).ja, 'ウルシー攻撃部隊')
  assert.equal(sallyTagNameOf(62, 5).name, '乌利西攻击部队')
  assert.equal(sallyTagNameOf(62, 6).ja, '第六艦隊')
  assert.equal(sallyTagNameOf(62, 6).name, '第六舰队')
})

test('札名与史实编队库互链，引的 id 必须真存在', () => {
  for (const entry of SALLY_TAG_NAMES) {
    if (!entry.fleetId) continue
    assert.ok(histFleetById(entry.fleetId), `札 ${entry.area}:${entry.tag} 引了不存在的编队 ${entry.fleetId}`)
  }
  assert.equal(sallyTagNameOf(62, 1).fleetId, 'sq-31-e1')
})

test('查不到就回退成编号，绝不编名字', () => {
  assert.equal(sallyTagLabel(62, 4), '联合舰队')
  // 没录过的区、没录过的号、非法输入，一律回退
  assert.equal(sallyTagLabel(61, 1), '札 1')
  assert.equal(sallyTagLabel(62, 99), '札 99')
  assert.equal(sallyTagLabel(null, 1), '札 1')
  assert.equal(sallyTagNameOf(62, 0), null)
  assert.equal(sallyTagNameOf(undefined, 3), null)
})
