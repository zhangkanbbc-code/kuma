import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeWikiwikiShipName,
  parseWikiwikiAbyssVoicePage,
  parseWikiwikiVoicePage,
} from '../scripts/lib/wikiwiki-voice.mjs'

const page = `
<table>
  <tr><th rowspan="2">イベント</th><th rowspan="2">セリフ</th><th colspan="2">改装段階</th><th>備考</th></tr>
  <tr><th><a href="/kancolle/%E6%B8%85%E9%9C%9C">清<br>霜</a></th><th><a href="/kancolle/%E6%B8%85%E9%9C%9C%E6%94%B9%E4%BA%8C">清霜改二</a></th><th>備考</th></tr>
  <tr><td>入手/ログイン</td><td>旧形态台词</td><td>◯</td><td>×</td><td></td></tr>
  <tr><td>入手/ログイン</td><td>改二专属台词</td><td>×</td><td>〇</td><td></td></tr>
  <tr><td>母港1</td><td>共用台词</td><td>○</td><td>◯</td><td></td></tr>
  <tr><td>梅雨</td><td>期间限定台词</td><td></td><td>◯</td><td></td></tr>
</table>
<table>
  <tr><th rowspan="2">時刻</th><th rowspan="2">セリフ</th><th colspan="2">改装段階</th><th>備考</th></tr>
  <tr><th><a href="/kancolle/%E6%B8%85%E9%9C%9C">清霜</a></th><th><a href="/kancolle/%E6%B8%85%E9%9C%9C%E6%94%B9%E4%BA%8C">清霜改二</a></th><th>備考</th></tr>
  <tr><td>00</td><td>零点报时</td><td>×</td><td>◯</td><td></td></tr>
  <tr><td>23</td><td>二十三点报时</td><td>×</td><td>◯</td><td></td></tr>
</table>`

test('wikiwiki voice tables keep remodel forms isolated and map stable voice ids', () => {
  const forms = parseWikiwikiVoicePage(page, '清霜改二')
  const base = forms.find((form) => form.name === '清霜')
  const kai2 = forms.find((form) => form.name === '清霜改二')

  // 母港1 → 语音编号 2（2026-08-12 实测钉死:kcwiki 日文回连 poi-subtitle,
  // 秘书舰1→2 共 108 例无一例外;此前写成 3,刺鲅母港台词文不对音）
  assert.deepEqual(base.lines.map((line) => [line.voiceId, line.ja]), [
    [1, '旧形态台词'],
    [2, '共用台词'],
  ])
  assert.deepEqual(kai2.lines.map((line) => [line.voiceId, line.ja]), [
    [1, '改二专属台词'],
    [2, '共用台词'],
    [undefined, '期间限定台词'],
    [30, '零点报时'],
    [53, '二十三点报时'],
  ])
})

test('wikiwiki ship names normalize spacing without collapsing different forms', () => {
  assert.equal(normalizeWikiwikiShipName('清 霜 改 二'), '清霜改二')
  assert.notEqual(normalizeWikiwikiShipName('清霜改'), normalizeWikiwikiShipName('清霜改二'))
})

test('wikiwiki voice parser accepts the read-only mirror link shape', () => {
  const mirrored = page.replaceAll('href="/kancolle/', 'href="/./')
  const forms = parseWikiwikiVoicePage(mirrored, '清霜改二')
  assert.equal(forms.find((form) => form.name === '清霜改二').lines[0].ja, '改二专属台词')
})

test('wikiwiki abyss voice parser keeps exact No. ids and audited sound suffixes', () => {
  const html = `
    <h3>(No.2297) 駆逐ラ級ζ-壊 (A)</h3>
    <h3>(No.2298) 駆逐ラ級ζ-壊 (B)</h3>
    <table>
      <tr><th>セリフ</th><th>CV：未発表</th></tr>
      <tr><th>北海道防衛作戦</th><th>北海道防衛作戦</th></tr>
      <tr><td>開幕前</td><td>開幕原文</td></tr>
      <tr><td>砲撃</td><td>砲撃原文</td></tr>
      <tr><td>砲撃（装甲破砕）</td><td>破砕砲撃原文</td></tr>
      <tr><td>被弾</td><td>被弾原文</td></tr>
      <tr><td>被弾（装甲破砕）</td><td>破砕被弾原文</td></tr>
      <tr><td>撃沈</td><td>撃沈原文</td></tr>
    </table>`
  const parsed = parseWikiwikiAbyssVoicePage(html, '駆逐ラ級ζ-壊')
  assert.deepEqual(parsed.ids, [2297, 2298])
  assert.deepEqual(
    parsed.lines.map((line) => [line.scene, line.slot, line.suffix]),
    [
      ['開幕前', 'opening', 10],
      ['砲撃', 'attack', 20],
      ['砲撃（装甲破砕）', 'attack', 21],
      ['被弾', 'damage', 30],
      ['被弾（装甲破砕）', 'damage', 31],
      ['撃沈', 'sunk', 41],
    ],
  )
})
