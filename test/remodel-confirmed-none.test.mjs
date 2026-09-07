import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { remodelRuntime } from '../scripts/lib/remodel-fact-runtime.mjs'
import { runtimeHost, runProductionSection, plainHtml } from '../scripts/lib/player-view-runtime.mjs'
import { parseWikiwikiRemodelPage, resolveWikiwikiRemodelSourceId } from '../scripts/lib/wikiwiki-remodel.mjs'
import { confirmedNoRemodelMaterials, reconcileStagedRemodel, parseCcConversionTable } from '../scripts/lib/remodel-stages.mjs'
import { REMODEL_STAGE_COPY } from '../src/shared/remodel-stage.ts'
import validation from '../dist/main/lode-validation.js'

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/remodel-facts.json', import.meta.url), 'utf8'))
const pack = JSON.parse(fs.readFileSync(new URL('../assets/lodes/remodel-facts.json', import.meta.url), 'utf8'))
const raw = { ...fixture.raw, api_mst_ship: fixture.raw.api_mst_ship.filter(s => [463, 468].includes(s.api_id)),
  api_mst_shipupgrade: fixture.raw.api_mst_shipupgrade.filter(s => [463, 468].includes(s.api_current_ship_id)) }

test('校验接受空first和convert档，拒绝空stages与非对象档', () => {
  for (const stages of [{ first: {} }, { convert: {} }, { first: {}, convert: {} }]) {
    assert.equal(validation.validateLodePack({ ...pack, data: { '463→468': { stages } } }).ok, true)
  }
  for (const stages of [{}, { first: [] }, { first: null }, { first: '' }]) {
    assert.equal(validation.validateLodePack({ ...pack, data: { '463→468': { stages } } }).ok, false)
  }
})

for (const [label, stages] of [
  ['确认无', { first: {}, convert: {} }], ['缺失', {}],
  ['有素材', { first: { 'useitem:2': 40 }, convert: { 'useitem:2': 40 } }],
]) test(`真实chip与链摘要：${label}`, () => {
  const rt = remodelRuntime(raw, {}, { facts: { data: { '463→468': { stages } } } })
  const result = rt.needChipsHtml(null, 468, 463)
  const { remodelStageLabelHtml } = runtimeHost().extract('src/renderer/modules/ji.ts',
    ['remodelStageLabelHtml']).api
  // 执行链摘要的真实内联函数及真实药丸函数，不把同样的判断抄到测试里。
  const summary = runProductionSection('src/renderer/modules/ji.ts', '      const needPillOf =',
    '      // kcsapi 字段名陷阱', { specialNeeds: result, remodelStageLabelHtml, REMODEL_STAGE_COPY,
      needStockOf: () => ({ have: 99, enough: true }), esc: String },
    'globalThis.result = stagePills(specialNeeds, "朝潮")').result
  for (const html of [result.html, summary]) {
    if (label === '确认无') {
      assert.match(plainHtml(html), /初次\s*无特殊素材.*往复\s*无特殊素材/)
      assert.doesNotMatch(html, /素材待补|class="(?:nd (?:no|ok)|rm-needs)/)
    } else if (label === '缺失') {
      assert.match(html, /素材待补/)
      assert.doesNotMatch(html, /无特殊素材/)
    } else {
      assert.match(html, /高速建造材/)
      assert.doesNotMatch(html, /无特殊素材|素材待补/)
    }
  }
  assert.equal(result.needs.length, label === '有素材' ? 2 : 0)
  assert.ok(result.stages.every(g => g.missing === (label === '缺失')))
})

const zeroSources = () => ({
  kc: { 263: { ID: 463, 改造: { 改造后: '268' } }, 268: { ID: 468, 改造: { 改造后: '263', 图纸: '' } } },
  wiki: { 468: { targetShipId: 468, fromShipId: 463, needs: [], raw: 'Lv85' },
    463: { targetShipId: 463, fromShipId: 468, needs: [], raw: 'Lv85' } },
  raw: structuredClone(raw), conversionRows: [],
})
const confirmed = s => confirmedNoRemodelMaterials(s.kc, s.wiki, s.raw, s.conversionRows)
test('三源齐全两向first与直接互逆convert都生成空对象及证据', () => {
  const s = zeroSources(), before = structuredClone(s)
  const result = reconcileStagedRemodel(s.kc, s.wiki, s.raw, '==可以进行转换改装的舰船==\n{|\n!\n|-\n!\n|}')
  for (const edge of ['463→468', '468→463']) {
    assert.deepEqual(result.data[edge], { stages: { first: {}, convert: {} } })
    for (const stage of ['first', 'convert']) assert.deepEqual([...new Set(result.evidence.find(r => r.edge === edge && r.stage === stage).sources.map(s => s.site))],
      stage === 'first' ? ['wikiwiki', 'api', 'kcwiki'] : ['wikiwiki', 'api', 'kcwiki', 'kcwikiTable'])
  }
  assert.deepEqual(s, before)
})

for (const [label, mutate] of [
  ['wikiwiki主条目缺失', s => { delete s.wiki[468] }],
  ['wikiwiki主条目needs非空', s => { s.wiki[468].needs = [{ kind: 'useitem', id: 2, count: 1 }] }],
  ['wikiwiki主条目needs缺失', s => { delete s.wiki[468].needs }],
  ['API同边行缺失', s => { s.raw.api_mst_shipupgrade = s.raw.api_mst_shipupgrade.filter(r => r.api_id !== 468) }],
  ['API任意新增计数非零', s => { s.raw.api_mst_shipupgrade.find(r => r.api_id === 468).api_future_count = 1 }],
  ['API没有任何计数字段', s => { s.raw.api_mst_shipupgrade = s.raw.api_mst_shipupgrade.map(r => r.api_id === 468 ? { api_current_ship_id: 463, api_id: 468 } : r) }],
  ['百科出发行缺失', s => { delete s.kc[263] }],
  ['百科改造行缺失', s => { delete s.kc[263].改造 }],
  ['百科改造后不是同目标', s => { s.kc[263].改造.改造后 = '263' }],
  ['百科有图纸栏', s => { s.kc[263].改造.图纸 = '高速建造材x1' }],
]) test(`确认无拒收：${label}`, () => {
  const s = zeroSources(); mutate(s)
  const result = confirmed(s)
  assert.equal(result.some(r => r.edge === '463→468'), false)
  assert.equal(result.some(r => r.stage === 'convert'), false)
})

for (const [label, mutate] of [
  ['正向脚注边', s => { s.wiki[468].edges = [{ source: 'footnote', fromShipId: 463, needs: [] }] }],
  ['反向脚注边', s => { s.wiki[463].edges = [{ source: 'footnote', fromShipId: 468, needs: [] }] }],
  ['百科转换段有反向行', s => { s.conversionRows = [{ edge: '468→463', materials: { 'useitem:2': 1 } }] }],
]) test(`first仍确认无，但convert拒收：${label}`, () => {
  const s = zeroSources(); mutate(s)
  assert.deepEqual(confirmed(s).map(r => r.stage), ['first', 'first'])
})

test('非直接互逆仅first；无关对脚注与转换段不阻断本对', () => {
  const s = zeroSources()
  s.wiki[468].edges = [{ source: 'footnote', fromShipId: 999, needs: [] }]
  s.conversionRows = [{ edge: '501→506' }]
  assert.equal(confirmed(s).filter(r => r.stage === 'convert').length, 2)
  s.raw.api_mst_shipupgrade = s.raw.api_mst_shipupgrade.filter(r => r.api_id === 468)
  assert.deepEqual(confirmed(s).map(r => [r.edge, r.stage]), [['463→468', 'first']])
})

test('随包79条first与6条convert逐边有三源证据；冲突与Glorious不收', () => {
  const empty = Object.entries(pack.data).flatMap(([edge, row]) => Object.entries(row.stages)
    .filter(([, materials]) => !Object.keys(materials).length).map(([stage]) => edge + '/' + stage))
  assert.equal(empty.length, 85)
  assert.deepEqual(empty.sort(), fixture.confirmedNone.map(r => r.edge + '/' + r.stage).sort())
  for (const row of fixture.confirmedNone) {
    for (const site of ['wikiwiki', 'api']) assert.ok(row.sources.some(s => s.site === site))
    assert.ok(row.sources.some(s => s.site.startsWith('kcwiki')))
  }
  assert.equal(fixture.confirmedNone.filter(r => r.stage === 'first').length, 79)
  assert.equal(fixture.confirmedNone.filter(r => r.stage === 'convert').length, 6)
  for (const edge of ['463→468', '468→463', '464→470', '470→464', '911→916']) assert.deepEqual(pack.data[edge], { stages: { first: {}, convert: {} } })
  assert.deepEqual(pack.data['916→911'].stages.convert, { 'useitem:2': 50, 'useitem:3': 50 })
  assert.deepEqual(pack.data['646→698'], { stages: { convert: {} } })
  for (const edge of ['740→741', '741→740']) assert.equal(pack.data[edge], undefined)
  for (const edge of ['506→501', '629→628']) {
    assert.equal(pack.data[edge], undefined)
    assert.equal(fixture.conflicts.filter(r => r.edge === edge && r.stage === 'convert').length, 2)
  }
})

for (const source of [248, undefined]) test(`普通单向first仍要求同来路：${source}`, () => {
  const s = zeroSources()
  s.wiki[468].fromShipId = source
  s.raw.api_mst_shipupgrade = s.raw.api_mst_shipupgrade.filter(r => r.api_id === 468)
  assert.deepEqual(confirmed(s), [])
})

test('直接互逆回程允许常规路径主条目；证据保留不同来路与两向无成本核对', () => {
  const s = zeroSources(); s.wiki[463].fromShipId = 248
  const rows = confirmed(s)
  assert.equal(rows.length, 4)
  const reverse = rows.find(r => r.edge === '468→463' && r.stage === 'first')
  assert.match(reverse.sources[0].basis, /fromShipId=248.*出发468不同.*常规路径/)
  assert.deepEqual(reverse.sources.find(r => r.site === 'kcwikiTable').raw, [])
  for (const row of rows.filter(r => r.stage === 'convert')) {
    assert.ok(row.sources.some(s => s.site === 'kcwikiTable' && s.basis.includes('463→468')))
    assert.ok(row.sources.some(s => s.site === 'kcwikiTable' && s.basis.includes('468→463')))
  }
})

for (const [label, mutate] of [
  ['非直接互逆', s => { s.raw.api_mst_shipupgrade = s.raw.api_mst_shipupgrade.filter(r => r.api_id === 463) }],
  ['目标主条目缺失', s => { delete s.wiki[463] }],
  ['目标needs非空', s => { s.wiki[463].needs = [{ kind: 'useitem', id: 2, count: 1 }] }],
  ['API计数非零', s => { s.raw.api_mst_shipupgrade.find(r => r.api_id === 463).api_drawing_count = 1 }],
  ['百科指向别的目标', s => { s.kc[268].改造.改造后 = '268' }],
  ['百科有图纸', s => { s.kc[268].改造.图纸 = '高速建造材x1' }],
  ['同向脚注即使空成本', s => { s.wiki[463].edges = [{ source: 'footnote', fromShipId: 468, needs: [] }] }],
  ['转换段同向有成本', s => { s.conversionRows = [{ edge: '468→463', materials: { 'useitem:2': 1 } }] }],
]) test(`回程first拒收：${label}`, () => {
  const s = zeroSources(); s.wiki[463].fromShipId = 248; mutate(s)
  assert.equal(confirmed(s).some(r => r.edge === '468→463'), false)
})

const emptyConversion = () => {
  const s = zeroSources()
  s.wiki[463].fromShipId = 248
  s.kc[268].改造.图纸 = '高速建造材x50'
  s.wiki[463].edges = [{ source: 'footnote', fromShipId: 468, needs: [{ kind: 'useitem', id: 2, count: 50 }] }]
  s.conversionRows = [{ edge: '463→468', raw: '-', materials: {}, explicitEmptyCost: true }]
  return s
}
test('显式空成本convert独立确认：反向first未知和反向脚注不阻断', () => {
  const rows = confirmed(emptyConversion())
  assert.deepEqual(rows.map(r => [r.edge, r.stage]), [['463→468', 'first'], ['463→468', 'convert']])
  const row = rows[1]
  assert.deepEqual(row.sources.map(s => s.site), ['wikiwiki', 'kcwikiTable', 'api'])
  assert.deepEqual(row.sources[1].raw, [{ edge: '463→468', raw: '-', materials: {} }])
})
test('回程first允许同向显式空成本，convert只收该方向', () => {
  const s = zeroSources(); s.wiki[463].fromShipId = 248
  s.conversionRows = [{ edge: '468→463', raw: '', materials: {}, explicitEmptyCost: true }]
  assert.deepEqual(confirmed(s).map(r => [r.edge, r.stage]).sort(),
    [['463→468', 'first'], ['468→463', 'first'], ['468→463', 'convert']].sort())
})
for (const [label, mutate] of [
  ['非显式空成本', s => { delete s.conversionRows[0].explicitEmptyCost }],
  ['带成本', s => { s.conversionRows[0].materials = { 'useitem:2': 1 } }],
  ['同向脚注', s => { s.wiki[468].edges = [{ source: 'footnote', fromShipId: 463, needs: [] }] }],
  ['API同边缺失', s => { s.raw.api_mst_shipupgrade = s.raw.api_mst_shipupgrade.filter(r => r.api_id !== 468) }],
  ['API计数缺失', s => { s.raw.api_mst_shipupgrade = [{ api_current_ship_id: 463, api_id: 468 }] }],
  ['API新增计数非零', s => { s.raw.api_mst_shipupgrade.find(r => r.api_id === 468).api_future_count = 1 }],
]) test(`空成本convert拒收：${label}`, () => {
  const s = emptyConversion(); mutate(s)
  assert.equal(confirmed(s).some(r => r.stage === 'convert'), false)
})

test('转换段解析区分空白、横线和缺成本格，保留箭头方向及原文', () => {
  for (const [cost, expected] of [['\n| ', true], ['\n| -', true], ['', false]]) {
    const text = '==可以进行转换改装的舰船==\n{|\n!\n|-\n!\n|-\n| 263\n| A\n|\n|\n| ←\n| 268\n| B\n|\n|\n|' + cost + '\n|}'
    const [row] = parseCcConversionTable(text, zeroSources().kc, raw)
    assert.equal(row.edge, '468→463')
    assert.equal(row.explicitEmptyCost, expected)
    assert.equal(row.raw, cost.includes('-') ? '-' : '')
  }
})

test('74条单向空档：真实chip和链摘要均不显示任何文字，保留confirmedNone', () => {
  const rt = remodelRuntime(fixture.raw, {}, { facts: pack })
  const { remodelStageLabelHtml } = runtimeHost().extract('src/renderer/modules/ji.ts', ['remodelStageLabelHtml']).api
  let count = 0
  for (const [edge, row] of Object.entries(pack.data).filter(([, r]) => r.stages.first && !Object.keys(r.stages.first).length)) {
    const [from, to] = edge.split('→').map(Number)
    const result = rt.needChipsHtml(null, to, from)
    if (result.convertible) continue
    count++
    assert.equal(result.stages[0].confirmedNone, true, edge)
    assert.equal(result.html, '', edge)
    const summary = runProductionSection('src/renderer/modules/ji.ts', '      const needPillOf =',
      '      // kcsapi 字段名陷阱', { specialNeeds: result, remodelStageLabelHtml, REMODEL_STAGE_COPY,
        needStockOf: () => ({ have: 99, enough: true }), esc: String },
      'globalThis.result = stagePills(specialNeeds, "单向")').result
    assert.equal(summary, '', edge)
  }
  assert.equal(count, 74)
})

test('单档确认无不填另一档，也不覆盖API正数', () => {
  const facts = { data: { '463→468': { stages: { first: {} } } } }
  const result = remodelRuntime(raw, {}, { facts }).needChipsHtml(null, 468, 463)
  assert.equal(result.stages[0].confirmedNone, true)
  assert.equal(result.stages[1].missing, true)
  const positive = structuredClone(raw)
  positive.api_mst_shipupgrade.find(s => s.api_id === 468).api_drawing_count = 1
  const native = remodelRuntime(positive, {}, { facts }).needChipsHtml(null, 468, 463)
  assert.equal(native.stages[0].confirmedNone, false)
  assert.equal(native.stages[0].needs[0].count, 1)
})

test('Glorious注记按舰种拆来路，缺注记或重复候选不猜', () => {
  const ships = [
    { api_id: 740, api_name: 'Glorious改', api_stype: 8 },
    { api_id: 741, api_name: 'Glorious改', api_stype: 11 },
  ]
  assert.equal(resolveWikiwikiRemodelSourceId('Glorious改(正規空母)', ships), 741)
  assert.equal(resolveWikiwikiRemodelSourceId('Glorious改（巡洋戦艦）', ships), 740)
  assert.equal(resolveWikiwikiRemodelSourceId('Glorious改', ships), 0)
  assert.equal(resolveWikiwikiRemodelSourceId(undefined, ships), 0)
  assert.equal(resolveWikiwikiRemodelSourceId('Glorious改(巡洋戦艦)', [...ships, ships[0]]), 0)
  const html = '<table><tr><th>改造チャート</th></tr><tr><td>' +
    '<a title="Glorious改(正規空母)">Glorious改</a>(Lv50) ⇔ ' +
    '<a title="Glorious改(巡洋戦艦)">Glorious改</a>(Lv65)</td></tr></table>'
  const rows = parseWikiwikiRemodelPage(html, 'Glorious')
  assert.equal(resolveWikiwikiRemodelSourceId(rows[1].sourceName, ships), 741)
  assert.equal(resolveWikiwikiRemodelSourceId(rows[1].targetName, ships), 740)
})
