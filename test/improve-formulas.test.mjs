import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fitFormulas, fitRow, renderFormulaCell, rowMatches, IMPROVE_FORMULAS, categoryOf, formulaFor } from '../scripts/lib/improve-formulas.mjs'
import { fillFormulas, receivedItems } from '../scripts/build-improve-formulas.mjs'

const row = (fn, length = 10) => Object.fromEntries(Array.from({ length }, (_, i) => [i, `+${fn(i + 1).toFixed(2)}`]))
const equip = { api_type: [0, 0, 6, 6] }
const masters = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, equip]))
const sample = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, { item_remodel: { 対空: row(s => 0.2 * s) } }]))
const pack = items => ({ meta: { comparisonVerified: true }, data: { schemaVersion: 1, items } })

test('公式拟合：五张逐格吻合已证、一个反例整类未证、四张样本不足', () => {
  const items = sample(5)
  const formula = fitFormulas(items, masters)[0]
  assert.equal(formula.proven, true)
  assert.equal(formula.matchedCount, 5)
  assert.deepEqual(formula.sampleIds, [1, 2, 3, 4, 5])
  assert.equal(formula.formula.segments[0].a, 0.2)
  assert.equal(fitFormulas(sample(4), masters)[0].proven, false)
  items[5].item_remodel.対空[9] = '+9.99'
  const rejected = fitFormulas(items, masters)[0]
  assert.equal(rejected.proven, false)
  assert.deepEqual(rejected.mismatches, [5])
})

test('公式族：平方根、仿射、40格分段；按每格精度零误差，不将截断冒充四舍五入', () => {
  for (const values of [row(Math.sqrt), row(s => 0.3 * s + 1), row(s => Math.sqrt(s) * Math.ceil(s / 10), 40)]) {
    const formula = fitRow(values)
    assert.ok(formula)
    assert.equal(rowMatches(formula, values), true)
    assert.equal(renderFormulaCell(formula, 9), values[9])
  }
  const truncated = row(s => Math.floor(Math.sqrt(s) * 100) / 100)
  assert.equal(fitRow(truncated, ['round']), null)
  assert.equal(fitRow(truncated).rounding, 'truncate')
  assert.equal(fitRow({ 0: '+0.20' }), null)
  assert.equal(fitRow({ ...row(Math.sqrt), 5: '火力+1' }), null)
})

test('补全：缺表按已证公式生成；未证类别留缺；实收格保持且逐格标来源', () => {
  const items = sample(5), formulas = fitFormulas(items, masters)
  items[6] = { item_remodel: { 対空: { 0: '+9.00' } } }
  const local = { 6: { item_remodel: { 対空: row(s => s * 0.2) } }, 7: { item_remodel: { 対空: row(s => s * 0.2) } }, 8: { item_remodel: { 火力: row(Math.sqrt) } } }
  const result = fillFormulas(pack(items), local, masters, formulas)
  assert.equal(result.pack.data.items[7].item_remodel.対空[9], '+2.00')
  assert.deepEqual(result.pack.data.items[7].remodel_basis.対空[9], { basis: 'formula', formula: '6/対空', compared: true })
  assert.equal(result.pack.data.items[6].item_remodel.対空[0], '+9.00')
  assert.equal(result.pack.data.items[6].remodel_basis.対空[0].basis, 'kcwiki')
  assert.equal(result.pack.data.items[8]?.item_remodel?.火力, undefined)
  assert.equal(result.report.rows.find(r => r.id === 8).remaining.length, 10)
  const rerun = fillFormulas(result.pack, local, masters, formulas)
  assert.deepEqual(rerun.pack, result.pack)
  assert.equal(rerun.report.summary.addedCells, 0)
  assert.deepEqual(receivedItems(result.pack.data.items), items)
})

test('一个本机分歧拒绝整列；该装备无对照列也不收，其他一致列仍可收', () => {
  const items = sample(5)
  for (const item of Object.values(items)) {
    item.item_remodel.対潜 = row(s => s * 0.2)
    item.item_remodel.火力 = row(s => s * 0.2)
  }
  const formulas = fitFormulas(items, masters)
  const local = { 6: { item_remodel: { 対空: { ...row(s => s * 0.2), 9: '+5.00' }, 火力: row(s => s * 0.2) } } }
  const result = fillFormulas(pack(items), local, masters, formulas)
  assert.equal(result.pack.data.items[6].item_remodel.対空, undefined)
  assert.equal(result.pack.data.items[6].item_remodel.対潜, undefined)
  assert.equal(result.pack.data.items[6].item_remodel.火力[9], '+2.00')
  assert.equal(result.report.exceptions.length, 1)
  assert.deepEqual(result.report.exceptions[0].differences, [{ index: 9, star: 10, formulaValue: '+2.00', localValue: '+5.00' }])
  local[6].item_remodel.対空[9] = '+2.00'
  const accepted = fillFormulas(pack(items), local, masters, formulas)
  assert.equal(accepted.pack.data.items[6].remodel_basis.対潜[9].compared, false)
  assert.equal(accepted.report.noComparison.length, 10)
})

test('推算格不能回流成拟合样本；随包证据只认非推算格', () => {
  const items = sample(5)
  items[5].remodel_basis = { 対空: Object.fromEntries(Object.keys(items[5].item_remodel.対空).map(i => [i, { basis: 'formula' }])) }
  assert.equal(fitFormulas(items, masters)[0].matchedCount, 4)
  assert.equal(fitFormulas(items, masters)[0].proven, false)
})

test('类别边界来自主数据；普通舰爆不为零式爆战的空列作证', () => {
  assert.notEqual(categoryOf({ api_type: [3, 5, 7, 7, 12] }, '爆装'), categoryOf({ api_type: [3, 5, 7, 7, 15] }, '爆装'))
  const items = sample(5)
  for (const item of Object.values(items)) item.item_remodel = { 爆装: item.item_remodel.対空 }
  const bombers = Object.fromEntries(Object.keys(items).map(id => [id, { api_type: [3, 5, 7, 7, 15] }]))
  const formulas = fitFormulas(items, bombers)
  const local = { 6: { item_remodel: { 対空: row(s => s * 0.2) } } }
  const result = fillFormulas(pack(items), local, { ...bombers, 6: { api_type: [3, 5, 7, 7, 12] } }, formulas)
  assert.equal(result.pack.data.items[6], undefined)
})

test('真包推算格与已证公式逐格一致；实收仍为24079格且不参与来源升级', () => {
  const bundled = JSON.parse(fs.readFileSync(new URL('../assets/lodes/kcwiki-akashi-improve.json', import.meta.url), 'utf8'))
  let received = 0, calculated = 0
  for (const [id, item] of Object.entries(bundled.data.items)) for (const [stat, cells] of Object.entries(item.item_remodel ?? {})) {
    for (const [i, value] of Object.entries(cells)) {
      const mark = item.remodel_basis[stat][i]
      if (mark.basis === 'kcwiki') { received++; continue }
      calculated++
      const formula = IMPROVE_FORMULAS.find(f => `${f.category}/${f.stat}` === mark.formula)
      assert.equal(formula?.proven, true)
      assert.equal(renderFormulaCell(formulaFor(formula, id), +i), value)
    }
  }
  assert.equal(received, 24079)
  assert.ok(calculated > 0)
  for (const entry of IMPROVE_FORMULAS.filter(f => f.proven)) {
    assert.ok(entry.sampleIds.length >= 5)
    assert.ok(entry.mismatches.length === 0 || (entry.sampleIds.length >= 10 && entry.mismatches.length === 1))
    for (const id of entry.sampleIds) {
      const item = bundled.data.items[id]
      const receivedRow = Object.fromEntries(Object.entries(item.item_remodel[entry.stat])
        .filter(([i]) => item.remodel_basis[entry.stat][i].basis === 'kcwiki'))
      assert.equal(rowMatches(formulaFor(entry, id), receivedRow), true, `${entry.category}/${entry.stat} #${id}`)
      const exception = entry.exceptions.find(ex => ex.id === id)
      if (exception) {
        assert.deepEqual(exception.cells, receivedRow)
        assert.equal(exception.formula.rounding, entry.formula.rounding)
      }
    }
  }
})

test('惯例检测区分运算顺序；同类所有样本共用小数位和惯例', () => {
  const beforeMultiply = Object.fromEntries(['+1.30', '+1.83', '+2.25', '+2.60', '+2.90', '+3.17', '+3.43', '+3.67', '+3.90', '+4.11'].map((v, i) => [i, v]))
  const formula = fitRow(beforeMultiply)
  assert.equal(formula.rounding, 'truncate-base')
  assert.equal(formula.segments[0].a, 1.3)
  assert.equal(rowMatches(formula, beforeMultiply), true)
  const items = sample(5)
  for (const item of Object.values(items)) item.item_remodel.対空 = row(s => Math.trunc(Math.sqrt(s) * 100) / 100)
  assert.equal(fitFormulas(items, masters)[0].proven, true)
  items[5].item_remodel.対空 = row(Math.sqrt)
  assert.equal(fitFormulas(items, masters)[0].proven, false)
  items[5].item_remodel.対空 = Object.fromEntries(Object.entries(items[1].item_remodel.対空).map(([i, v]) => [i, v + '0']))
  assert.equal(fitFormulas(items, masters)[0].proven, false)
})

test('十张允许一张逐格自证特例；九张、两张反例或无法自证均不通过', () => {
  const items = sample(10)
  items[10].item_remodel.対空 = row(s => s * 0.3)
  const entry = fitFormulas(items, masters)[0]
  assert.equal(entry.proven, true)
  assert.equal(entry.matchedCount, 9)
  assert.deepEqual(entry.mismatches, [10])
  assert.equal(entry.exceptions[0].formula.segments[0].a, 0.3)
  assert.deepEqual(entry.exceptions[0].cells, items[10].item_remodel.対空)
  assert.equal(rowMatches(formulaFor(entry, 10), items[10].item_remodel.対空), true)
  assert.equal(fitFormulas(Object.fromEntries(Object.entries(items).slice(1)), masters)[0].proven, false)
  items[9].item_remodel.対空 = row(s => s * 0.3)
  assert.equal(fitFormulas(items, masters)[0].proven, false)
  items[9].item_remodel.対空 = row(s => s * 0.2)
  items[10].item_remodel.対空[5] = '+8.88'
  assert.equal(fitFormulas(items, masters)[0].proven, false)
})

test('类别公式多种惯例同值时，仍须选择能让特例共同零误差的惯例', () => {
  const items = sample(10)
  items[10].item_remodel.対空 = row(s => Math.trunc(Math.sqrt(s) * 100) / 100)
  const entry = fitFormulas(items, masters)[0]
  assert.equal(entry.proven, true)
  assert.equal(entry.formula.rounding, 'truncate')
  assert.equal(entry.exceptions[0].formula.rounding, 'truncate')
})

test('特例补缺使用自身公式；部分列缺格可补；本机精度不反向改变已证格式', () => {
  const items = sample(10)
  items[10].item_remodel.対空 = row(s => s * 0.3)
  const formulas = fitFormulas(items, masters)
  delete items[10].item_remodel.対空[9]
  const local = { 10: { item_remodel: { 対空: row(s => s * 0.3) } } }
  const result = fillFormulas(pack(items), local, masters, formulas)
  assert.equal(result.pack.data.items[10].item_remodel.対空[9], '+3.00')
  assert.equal(result.pack.data.items[10].remodel_basis.対空[9].basis, 'formula')
  assert.equal(result.report.summary.filledPartialItems, 1)
  assert.equal(result.report.summary.addedCells, 1)
  local[10].item_remodel.対空[9] = '+3.000'
  const rejected = fillFormulas(pack(items), local, masters, formulas)
  assert.equal(rejected.pack.data.items[10].item_remodel.対空[9], undefined)
  assert.equal(rejected.report.exceptions.length, 1)
})

test('已有推算的值和标记保留；不因新公式或比较分歧而撤回', () => {
  const items = sample(5), formulas = fitFormulas(items, masters)
  const mark = { basis: 'formula', formula: '6/対空', compared: false }
  items[6] = { item_remodel: { 対空: { 0: '+9.00' } }, remodel_basis: { 対空: { 0: mark } }, formula_added_stats: ['対空'] }
  const local = { 6: { item_remodel: { 対空: { ...row(s => s * 0.2), 0: '+8.00' } } } }
  const result = fillFormulas(pack(items), local, masters, formulas)
  assert.deepEqual(result.pack.data.items[6], items[6])
  assert.equal(result.report.summary.preservedFormulaCells, 1)
  assert.equal(result.report.summary.addedCells, 0)
})
