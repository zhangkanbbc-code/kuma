import assert from 'node:assert/strict'
import test from 'node:test'

import { parseWikiwikiQuestPage } from '../scripts/lib/wikiwiki-quests.mjs'
import { normalizeJpName } from '../scripts/lib/quest-pre-reconcile.mjs'

// 2026-08 任務/編成任務 实页的表结构：两行表头（獲得ボーナス跨 5 列）+
// 任務名列带 <a class="anchor" name="id-XX">，開放条件列用 (码)名 達成後
const page = (rows) => `<table><tbody>
  <tr><th>ID</th><th>任務名</th><th>内容</th><th colspan="5">獲得ボーナス</th><th>開放条件/備考</th><th>実装</th></tr>
  <tr><th>燃料</th><th>弾薬</th><th>鋼材</th><th>ボーキ</th><th>その他</th></tr>
  ${rows}
</tbody></table>`

const row = (code, name, cond, extra = '') => `<tr>
  <td>${code}</td>
  <td><a class="anchor" name="id-${code}"></a>${name}</td>
  <td>内容文</td><td>20</td><td>20</td><td>0</td><td>0</td><td></td>
  <td>${cond}</td>${extra}
</tr>`

test('前提码只在達成後语境收，及び 连接的多前置全收', () => {
  const html = page(
    row('A1', 'はじめての「編成」！', '', '<td rowspan="3">2013<br>4/23</td>') +
      row('A2', '「駆逐隊」を編成せよ！', '<a href="#id-A1">(A1)はじめての「編成」！</a><br>達成後') +
      row('A44', '第五戦隊', '(A35)「第五戦隊」を編成せよ！<br>及び<br>(B14)「西村艦隊」出撃せよ！<br>達成後'),
  )
  const { entries, warnings } = parseWikiwikiQuestPage(html, '任務/編成任務')
  assert.equal(warnings.length, 0)
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))
  assert.deepEqual(byCode.get('A1').pre, [])
  assert.deepEqual(byCode.get('A2').pre, ['A1'])
  assert.deepEqual(byCode.get('A44').pre, ['A35', 'B14'])
  assert.equal(byCode.get('A2').uncertain, false)
})

test('跨页链接的锚点码也认（前置在别的分类页）', () => {
  const html = page(
    row('G2', '改装せよ', '<a href="/kancolle/%E4%BB%BB%E5%8B%99%2F%E5%87%BA%E6%92%83%E4%BB%BB%E5%8B%99#id-B31">「第二戦隊」抜錨！</a> 達成後'),
  )
  const { entries } = parseWikiwikiQuestPage(html, '任務/改装任務')
  assert.deepEqual(entries[0].pre, ['B31'])
})

test('wiki 自标不确定（達成後？/検証中/空括号）如实带出', () => {
  const html = page(
    row('A51', '対潜哨戒', '(B42)「第六駆逐隊」対潜哨戒なのです！<br>及び<br>()<br>達成後？') +
      row('B76', '出撃せよ', '【検証中】 (条件不明) 達成後'),
  )
  const { entries } = parseWikiwikiQuestPage(html, '任務/出撃任務')
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))
  assert.deepEqual(byCode.get('A51').pre, ['B42'])
  assert.equal(byCode.get('A51').uncertain, true)
  assert.deepEqual(byCode.get('B76').pre, [])
  assert.equal(byCode.get('B76').uncertain, true)
})

test('非達成後语境提到的码不当前置，落 mentioned', () => {
  const html = page(row('A90', '拡張六水戦', '(A86)と同時に受領可能'))
  const { entries } = parseWikiwikiQuestPage(html, '任務/編成任務')
  assert.deepEqual(entries[0].pre, [])
  assert.deepEqual(entries[0].mentioned, ['A86'])
})

test('锚点码与 ID 列不符 = 表错位，整行报警不收', () => {
  const html = page(
    `<tr><td>A2</td><td><a class="anchor" name="id-A3"></a>错位行</td>
      <td>x</td><td>0</td><td>0</td><td>0</td><td>0</td><td></td><td></td></tr>` +
      row('A4', '正常行', ''),
  )
  const { entries, warnings } = parseWikiwikiQuestPage(html, '任務/編成任務')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].code, 'A4')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /A2/)
})

test('周期码与结婚码都在 ID 认定范围内', () => {
  const html = page(row('Bq13', '季常', '') + row('WB02', '結婚任務', '') + row('Bd1', '日常', ''))
  const { entries } = parseWikiwikiQuestPage(html, '任務/出撃定期')
  assert.deepEqual(entries.map((entry) => entry.code), ['Bq13', 'WB02', 'Bd1'])
})

test('EO 公证用的日文名归一吸收四类实测排版差异', () => {
  // A12 引号、B171 转义斜杠、WB02 的 ※注记、全半角
  assert.equal(normalizeJpName('空母機動部隊を編成せよ！'), normalizeJpName('「空母機動部隊」を編成せよ！'))
  assert.equal(
    normalizeJpName('【作戦準備】第二段階任務(対地/対空整備)'),
    normalizeJpName('【作戦準備】第二段階任務(対地\\/対空整備)'),
  )
  assert.equal(
    normalizeJpName('二人でする初めての任務！ ※編成ではなく出撃任務'),
    normalizeJpName('二人でする初めての任務！'),
  )
  assert.notEqual(normalizeJpName('あ号作戦'), normalizeJpName('い号作戦'), '不同任务不能被归一成同名')
})
