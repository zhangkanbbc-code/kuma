// 掉落舰的入手台词（`api_get_ship.api_ship_getmes`）。
//
// **日文原文照录，不机翻。** 台词是作品表达，走「台词原文列保原文」那一条——
// 这里只做一件事：把原文里的 `<br>` 换成真正的换行。
// 呈现刻意低调：掉落卡上只做悬停，不占版面，不抢掉落本身的戏。
//
// 真报文取自本机账本 2026-08-03 那次掉落（初春），账本本身不入仓。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { battleOf, renderDropChip, sortieOf } from './fixtures/render-di-battle.mjs'
import { dropShipGetMessage } from './fixtures/store-result-readers.mjs'

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-result-coverage.json', import.meta.url), 'utf8'),
)
const fixtureOf = (name) => {
  const found = fixtures.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

// ---- 读 ----

test('真报文：<br> 换成换行，其余一个字不动', () => {
  const { body } = fixtureOf('result-drop-getmes')
  assert.equal(body.api_get_ship.api_ship_name, '初春')
  assert.equal(
    dropShipGetMessage(body.api_get_ship),
    'わらわが初春じゃ。\nよろしく頼みますぞ。',
  )
})

test('原文照录：不翻译、不改写、不加标点', () => {
  const { body } = fixtureOf('result-drop-getmes')
  const text = dropShipGetMessage(body.api_get_ship)
  assert.ok(text.includes('わらわが初春じゃ。'), '日文原句必须原样在')
  assert.ok(!/[一-鿿]{2,}的/.test(text), '不许出现中译痕迹')
  assert.ok(!text.includes('<br>'))
})

test('<BR> / <br/> / <br /> 三种写法都吃', () => {
  assert.equal(dropShipGetMessage({ api_ship_getmes: 'あ<BR>い<br/>う<br />え' }), 'あ\nい\nう\nえ')
})

test('空台词、字段缺席、非字符串：一律当没有', () => {
  assert.equal(dropShipGetMessage({ api_ship_getmes: '' }), '')
  assert.equal(dropShipGetMessage({ api_ship_getmes: '   ' }), '')
  assert.equal(dropShipGetMessage({}), '')
  assert.equal(dropShipGetMessage(null), '')
  assert.equal(dropShipGetMessage(undefined), '')
})

test('空行不留：<br> 连着来也只摆有字的那几行', () => {
  assert.equal(dropShipGetMessage({ api_ship_getmes: 'あ<br><br>い<br>' }), 'あ\nい')
})

// ---- 渲染产物 ----

const resultOf = (patch = {}) => ({
  rank: 'S',
  mvp: -1,
  mvpCombined: -1,
  baseExp: 100,
  dropShipMstId: 38,
  dropShipName: '初春',
  firstClear: false,
  ...patch,
})
const dropHtml = (patch) =>
  renderDropChip(sortieOf(), battleOf({ result: resultOf(patch) }))

test('渲染：台词只进悬停，不占版面', () => {
  const html = dropHtml({ dropShipMessage: 'わらわが初春じゃ。\nよろしく頼みますぞ。' })
  assert.match(html, /title="わらわが初春じゃ。\nよろしく頼みますぞ。"/)
  // 一眼位置仍然只有「捞到 + 舰名」，台词不在正文里
  assert.ok(!/>[^<]*わらわが初春/.test(html), '台词跑到正文里去了，会抢掉落本身的戏')
})

test('渲染：没有台词时不多一个空悬停', () => {
  const html = dropHtml()
  assert.match(html, /捞到/)
  assert.ok(!html.includes('title=""'))
})

test('渲染：没掉落就整个不出卡（台词不能把空卡撑出来）', () => {
  const html = renderDropChip(
    sortieOf(),
    battleOf({ result: resultOf({ dropShipMstId: null, dropShipName: null, dropShipMessage: 'あ' }) }),
  )
  assert.equal(html, '')
})

test('渲染：台词里的引号被转义，不撑破属性', () => {
  const html = dropHtml({ dropShipMessage: 'あ"い<う&え' })
  assert.match(html, /title="あ&quot;い&lt;う&amp;え"/)
})
