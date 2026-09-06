import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { renderAbyssVoice } from './fixtures/render-abyss-voice.mjs'

const bundled = JSON.parse(fs.readFileSync(
  new URL('../assets/lodes/kuma-abyss-voice.json', import.meta.url), 'utf8',
))
const forms = [
  { id: 2204, name: '米駆逐棲姫' },
  { id: 2205, name: '米駆逐棲姫' },
  { id: 2207, name: '米駆逐棲姫-壊' },
]
const rows = bundled.data.ships['2204']
const kuma = { meta: bundled.meta, data: { ships: { 2204: rows } } }

test('深海语音页签：只有随包自译时出现，本形态和同名族回退均保留语音选中态与正文', () => {
  assert.ok(rows.length > 0 && rows.every((row) => row.zh.trim()))
  // 2205 没有自己的桶，必须通过正文同一套同名族回退取得 2204；其余包全未加载。
  for (const mstId of [2204, 2205]) {
    const result = renderAbyssVoice(mstId, { forms, kuma })
    assert.deepEqual(result.tabs.map((tab) => tab.id), ['a-cg', 'a-voice', 'a-map'])
    assert.equal(result.selected, 'a-voice')
    assert.equal(result.panel, result.regular, '加载判据不得挡住仅有随包自译的正文')
    assert.equal((result.panel.match(/class="vo-row"/g) ?? []).length, rows.length)
    for (const row of rows) {
      assert.ok(result.panel.includes(row.zh), `${mstId} 没有显示 ${row.key} 的译文`)
      assert.ok(result.panel.includes(row.ja), `${mstId} 没有显示 ${row.key} 的原文`)
    }
    assert.ok(result.panel.includes('炮击|'), 'suffix 场合名沿用正文的真实查表')
  }
})

test('深海语音页签：三路无本形态或同名族台词且无字幕音轨、档案时不出现', () => {
  for (const setup of [
    { forms },
    { forms, kuma: { meta: bundled.meta, data: { ships: {} } }, wikiwiki: { data: {} }, kcwiki: { data: {} } },
    // 有其它角色的译文也不算；「壊」不能借普通形态，重归属出去的 kcwiki 行也不算。
    { forms, kuma, corrected: [[2207, [{ key: 'moved', fix: 'reattributed' }]]] },
  ]) {
    const result = renderAbyssVoice(2207, setup)
    assert.deepEqual(result.tabs.map((tab) => tab.id), ['a-cg', 'a-map'])
    assert.equal(result.selected, 'a-cg')
    assert.equal(result.regular, '')
    assert.doesNotMatch(result.panel, /class="vo-row"/)
  }
})
