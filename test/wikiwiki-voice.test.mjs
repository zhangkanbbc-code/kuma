import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  buildSmallDamageEvidence,
  normalizeWikiwikiShipName,
  normalizeWikiwikiVoiceRows,
  parseWikiwikiAbyssVoicePage,
  parseWikiwikiVoicePage,
} from '../scripts/lib/wikiwiki-voice.mjs'
import { normalizeVoiceLine } from '../src/shared/voice-lineage.ts'
import { foldVoiceLineForCompare } from '../src/shared/voice-scene-slots.ts'

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

const slotTable = readFileSync(new URL('./fixtures/wikiwiki-voice-slots.html', import.meta.url), 'utf8')

test('显式小破序号直接取槽，兼容全角与圈号且不推进普通小破计数', () => {
  for (const [one, two] of [['1', '2'], ['１', '２'], ['①', '②']]) {
    const html = `<table>
      <tr><th>イベント</th><th>セリフ</th><th><a href="/kancolle/花月">花月</a></th><th><a href="/kancolle/花月改">花月改</a></th></tr>
      <tr><td>小破${two}</td><td>いやっ…！お、おやめ、くださいっ！</td><td>○</td><td>○</td></tr>
      <tr><td>小破</td><td>きゃぁーっ！</td><td>○</td><td>×</td></tr>
      <tr><td>旗艦大破</td><td>いやっ…！お、おやめ、くださいっ！</td><td>○</td><td>○</td></tr>
    </table>`
    const forms = parseWikiwikiVoicePage(html, '花月')
    assert.deepEqual(forms.map(form => form.lines.map(row => [row.voiceId, row.ja])), [
      [[20, 'いやっ…！お、おやめ、くださいっ！'], [19, 'きゃぁーっ！']],
      [[20, 'いやっ…！お、おやめ、くださいっ！']],
    ])
    const rows = [
      { key: '花月#0-23', scene: `小破${two} / 無印・改`, ja: '小破二' },
      { key: '花月#0-22', scene: `小破${one}`, ja: '小破一' },
      { key: '花月#0-24', scene: '小破', ja: '按列首句', voiceId: 20 },
    ]
    const normalized = normalizeWikiwikiVoiceRows(rows)
    assert.deepEqual(normalized.map(row => row.voiceId), [20, 19, 19])
    assert.deepEqual(normalizeWikiwikiVoiceRows(normalized), normalized)
  }
})

test('已解析行按页／表内行序归一化，不改输入且重复执行不变', () => {
  const row = (table, index, scene, ja, voiceId = 20) => ({
    key: `霧島改二丙#${table}-${index}`, page: '霧島改二丙', scene, ja, voiceId,
  })
  const rows = [
    row(0, 36, '旗艦大破', '痛った…そんな馬鹿な！'),
    row(0, 30, '小破', '痛った…そんな馬鹿な！'),
    row(0, 29, '小破', 'はぁぁっ！'),
    row(0, 28, '小破', 'セリフ'),
    row(0, 15, '出撃', '出撃よ！', 14),
    row(0, 14, '編成', '出撃よ!', 13),
    row(0, 17, '出撃', '第十一戦隊旗艦、戦艦霧島、出撃します！', 14),
    row(1, 15, '出撃', '出撃よ！', 14),
    row(1, 29, '小破', '別表の小破'),
    { ...row(0, 15, '出撃', '出撃よ！', 14), key: '別ページ#0-15', page: '別ページ' },
  ]
  const original = structuredClone(rows)
  const actual = normalizeWikiwikiVoiceRows(rows)
  assert.deepEqual(rows, original)
  assert.deepEqual(actual.map(line => [line.key, line.voiceId]), [
    ['霧島改二丙#0-30', 20], ['霧島改二丙#0-29', 19],
    ['霧島改二丙#0-14', 13], ['霧島改二丙#0-17', 14],
    ['霧島改二丙#1-15', 14], ['霧島改二丙#1-29', 19], ['別ページ#0-15', 14],
  ])
  assert.deepEqual(normalizeWikiwikiVoiceRows(actual), actual)
  assert.throws(() => normalizeWikiwikiVoiceRows([{ ...rows[0], key: '不含行序' }]), /缺少表内行序/)
})

test('四形态小破按各列计数，占位不占槽，出撃和旗艦大破不重复产出', () => {
  const forms = parseWikiwikiVoicePage(slotTable, '霧島改二丙')
  assert.equal(forms.length, 4)
  for (const { name, lines } of forms) {
    const small1 = ['霧島', '霧島改'].includes(name) ? 'きゃあっ！' : 'はぁぁっ！'
    assert.deepEqual(lines.filter(line => [19, 20].includes(line.voiceId)).map(line => [line.voiceId, line.ja]), [
      [19, small1], [20, '痛った…そんな馬鹿な！'],
    ])
    assert.deepEqual(lines.filter(line => [13, 14].includes(line.voiceId)).map(line => [line.voiceId, line.ja]), [
      [13, '出撃よ！さて、どう出てくるかしら？'],
      ...(name === '霧島改二丙' ? [[14, '第十一戦隊旗艦、戦艦霧島、出撃します！']] : []),
    ])
    assert.ok(lines.every(line => line.ja !== 'セリフ' && line.scene !== '旗艦大破'))
  }
})

test('旗艦大破与中破同句时不占 20；独有句保留 20', () => {
  const html = `<table>
    <tr><th>イベント</th><th>セリフ</th><th><a href="/kancolle/玉波改二">玉波改二</a></th></tr>
    <tr><td>旗艦大破</td><td>あぁ！？ 応急修理を急いで！ 浸水を止めて！ まだ戦います！</td><td>○</td></tr>
    <tr><td rowspan="2">小破</td><td>あはぁ！</td><td>○</td></tr>
    <tr><td>なっ！ 爆発！？ なに！？ ……潜水艦？</td><td>○</td></tr>
    <tr><td>中破/大破</td><td>あぁ!?応急修理を急いで!浸水を止めて!まだ戦います!</td><td>○</td></tr>
  </table>`
  const lines = parseWikiwikiVoicePage(html, '玉波改二')[0].lines
  assert.deepEqual(lines.map(line => line.voiceId), [19, 20, 21])
  assert.equal(lines[1].ja, 'なっ！ 爆発！？ なに！？ ……潜水艦？')
  const unique = parseWikiwikiVoicePage(html.replace('あぁ！？ 応急修理を急いで！ 浸水を止めて！ まだ戦います！', '独自の台詞'), '玉波改二')[0].lines
  assert.equal(unique.find(line => line.scene === '旗艦大破').voiceId, 20)
})

test('同句匹配只看本形态；占位行插在小破首行前也不推进计数', () => {
  const html = slotTable.replace('<td>○</td><td>○</td><td>○</td><td>○</td><td></td></tr>', '<td>○</td><td>○</td><td>○</td><td>×</td><td></td></tr>')
    .replace('<td rowspan="4">小破</td><td>きゃあっ！</td>', '<td rowspan="5">小破</td><td>セリフ</td><td>○</td><td>○</td><td>○</td><td>○</td><td></td></tr><tr><td>きゃあっ！</td>')
  const lines = parseWikiwikiVoicePage(html, '霧島改二丙').find(form => form.name === '霧島改二丙').lines
  assert.equal(lines.filter(line => line.voiceId === 14).length, 2)
  assert.equal(lines.find(line => line.voiceId === 19).ja, 'はぁぁっ！')
})

const damageFold = ja => foldVoiceLineForCompare(normalizeVoiceLine(ja))
const damageEvidence = entries => new Map(entries.map(([ja, slot]) => [damageFold(ja), slot]))
const haruShips = [
  { api_id: 405, api_aftershipid: '323' },
  { api_id: 323, api_aftershipid: '975' },
  { api_id: 975, api_aftershipid: '0' },
  { api_id: 999, api_aftershipid: '0' },
]
const haruSubtitle = { 405: { 19: 'きゃぁっ！ ', 20: 'や、やめて～！ ' } }
const haruKcwiki = { 405: [
  { key: '205-LightDmg1', ja: 'きゃぁっ！' },
  { key: '205-LightDmg2', ja: 'や、やめて～！' },
] }
const haruRows = [
  { key: '春雨改二#0-26', scene: '小破', ja: 'や、やめて～！', voiceId: 19 },
  { key: '春雨改二#0-27', scene: '小破', ja: 'きゃぁっ！', voiceId: 20 },
]

test('春雨三列无证据按页序，有前置形态证据对齐 19/20，旗艦大破仍不产出', () => {
  const html = `<table>
    <tr><th>イベント</th><th>セリフ</th><th><a href="/kancolle/春雨">春雨</a></th><th><a href="/kancolle/春雨改">春雨改</a></th><th><a href="/kancolle/春雨改二">春雨改二</a></th></tr>
    <tr><td rowspan="2">小破</td><td>や、やめて～！</td><td>○</td><td>○</td><td>○</td></tr>
    <tr><td>きゃぁっ！</td><td>○</td><td>○</td><td>○</td></tr>
    <tr><td rowspan="2">旗艦大破</td><td>きゃぁっ！</td><td>○</td><td>○</td><td>×</td></tr>
    <tr><td>や、やめて～！</td><td>×</td><td>×</td><td>○</td></tr>
    <tr><td>中破/大破</td><td>や、やられました…</td><td>○</td><td>○</td><td>○</td></tr>
  </table>`
  const forms = parseWikiwikiVoicePage(html, '春雨改二')
  assert.deepEqual(forms.map(form => form.name), ['春雨', '春雨改', '春雨改二'])
  for (const [index, form] of forms.entries()) {
    assert.deepEqual(form.lines.map(row => [row.voiceId, row.ja]), [
      [19, 'や、やめて～！'], [20, 'きゃぁっ！'], [21, 'や、やられました…'],
    ])
    const evidence = buildSmallDamageEvidence({
      mstId: [405, 323, 975][index], ships: haruShips, subtitleJa: haruSubtitle, kcwikiVoice: haruKcwiki,
    })
    const original = structuredClone(form.lines)
    const diagnostics = []
    const actual = normalizeWikiwikiVoiceRows(form.lines, evidence, diagnostics)
    assert.deepEqual(actual, form.lines.map((row, i) => ({ ...row, voiceId: [20, 19, 21][i] })))
    assert.deepEqual(form.lines, original)
    assert.ok(actual.every(row => row.scene !== '旗艦大破'))
    assert.deepEqual(diagnostics.map(note => note.type), ['swap'])
    assert.deepEqual(normalizeWikiwikiVoiceRows(actual, evidence), actual)
  }
})

test('小破证据分别支持字幕与档名，沿反向链继承且不跨谱系或读取后继形态', () => {
  const expected = damageEvidence([['きゃぁっ！', 19], ['や、やめて～！', 20]])
  for (const [subtitleJa, kcwikiVoice] of [[haruSubtitle, {}], [{}, haruKcwiki], [haruSubtitle, haruKcwiki]]) {
    assert.deepEqual(buildSmallDamageEvidence({ mstId: 975, ships: haruShips, subtitleJa, kcwikiVoice }), expected)
    assert.equal(buildSmallDamageEvidence({ mstId: 999, ships: haruShips, subtitleJa, kcwikiVoice }).size, 0)
  }
  assert.equal(buildSmallDamageEvidence({
    mstId: 405, ships: haruShips, subtitleJa: { 975: haruSubtitle[405] }, kcwikiVoice: {},
  }).size, 0)
  assert.equal(buildSmallDamageEvidence({
    mstId: 975, ships: haruShips, subtitleJa: {},
    kcwikiVoice: { 405: [{ key: '205-DockLightDmg', ja: '入渠' }, { key: '205-LightDmg1Extra', ja: '別句' }] },
  }).size, 0)
})

test('同一句证据既为 19 又为 20 时丢弃，后续同槽证据不能恢复它', () => {
  const evidence = buildSmallDamageEvidence({
    mstId: 975, ships: haruShips,
    subtitleJa: { 975: { 19: 'きゃぁっ！' }, 323: { 20: 'きゃぁっ!' }, ...haruSubtitle },
    kcwikiVoice: haruKcwiki,
  })
  assert.deepEqual(evidence, damageEvidence([['や、やめて～！', 20]]))
})

test('小破证据只命中任一句时另一句取剩余槽，并报告部分匹配', () => {
  for (const [ja, slot] of [['や、やめて～！', 20], ['きゃぁっ！', 19], ['や、やめて～！', 19], ['きゃぁっ！', 20]]) {
    const evidence = damageEvidence([[ja, slot]])
    const diagnostics = []
    const actual = normalizeWikiwikiVoiceRows(haruRows, evidence, diagnostics)
    assert.equal(actual.find(row => row.ja === ja).voiceId, slot)
    assert.equal(actual.find(row => row.ja !== ja).voiceId, 39 - slot)
    assert.deepEqual(diagnostics.filter(note => note.type === 'partial').map(note => note.rows), [haruRows])
    assert.deepEqual(normalizeWikiwikiVoiceRows(actual, evidence), actual)
  }
})

test('小破证据两句命中同槽时保持页序并报告冲突，无命中也保持页序', () => {
  for (const slot of [19, 20]) {
    const diagnostics = []
    const evidence = damageEvidence(haruRows.map(row => [row.ja, slot]))
    const actual = normalizeWikiwikiVoiceRows(haruRows, evidence, diagnostics)
    assert.deepEqual(actual, haruRows)
    assert.deepEqual(diagnostics, [{ type: 'conflict', reason: 'same-slot', rows: haruRows, slots: [slot, slot] }])
    assert.deepEqual(normalizeWikiwikiVoiceRows(actual, evidence), actual)
  }
  const diagnostics = []
  assert.deepEqual(normalizeWikiwikiVoiceRows(haruRows, new Map(), diagnostics), haruRows)
  assert.deepEqual(diagnostics, [])
})

test('证据与显式小破1/2矛盾时显式优先并报告，同表无序号行保持原判定', () => {
  for (const [scene, slot] of [['小破1', 19], ['小破２', 20], ['小破①', 19]]) {
    const explicit = { key: '春雨改二#0-25', scene, ja: '明示された台詞', voiceId: slot }
    const rows = [explicit, ...haruRows]
    const evidence = damageEvidence([['明示された台詞', 39 - slot], ['や、やめて～！', 20], ['きゃぁっ！', 19]])
    const diagnostics = []
    const actual = normalizeWikiwikiVoiceRows(rows, evidence, diagnostics)
    assert.deepEqual(actual, rows)
    assert.deepEqual(diagnostics, [{ type: 'conflict', reason: 'explicit-slot', rows: [explicit], slots: [39 - slot] }])
    assert.deepEqual(normalizeWikiwikiVoiceRows(actual, evidence), actual)
  }
})

test('规律⑤只处理无序号小破两行，不移动单行或三行的槽位', () => {
  const evidence = damageEvidence([['や、やめて～！', 20], ['きゃぁっ！', 19]])
  for (const rows of [haruRows.slice(0, 1), [...haruRows, { key: '春雨改二#0-28', scene: '小破', ja: '第三句' }]]) {
    assert.deepEqual(normalizeWikiwikiVoiceRows(rows, evidence), normalizeWikiwikiVoiceRows(rows))
  }
})

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

test('wikiwiki voice parser decodes named and numeric HTML entities in Japanese lines', () => {
  const html = page.replace(
    '<td>共用台词</td>',
    '<td>Enchant&eacute;e / &Ccedil;a / arr&egrave;s-midi / &#199; / &#xE7; / &unknown;</td>',
  )
  const forms = parseWikiwikiVoicePage(html, '清霜改二')
  assert.equal(
    forms.find((form) => form.name === '清霜改二').lines[1].ja,
    'Enchantée / Ça / arrès-midi / Ç / ç / &unknown;',
  )
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

test('wikiwiki abyss voice parser also decodes HTML entities in Japanese lines', () => {
  const parsed = parseWikiwikiAbyssVoicePage(
    `
      <h3>(No.2297) 深海测试舰</h3>
      <table>
        <tr><th>セリフ</th><th>CV：未発表</th></tr>
        <tr><td>開幕前</td><td>&Ccedil;a &#233; &#xEA;</td></tr>
      </table>`,
    '深海测试舰',
  )
  assert.equal(parsed.lines[0].ja, 'Ça é ê')
})
