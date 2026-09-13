import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'
import test from 'node:test'
import { buildPack, compareItems, readModule, FORMAL_OUTPUT } from '../scripts/build-akashi-improve.mjs'
import akashi from '../dist/shared/akashi-improve.js'
import validation from '../dist/main/lode-validation.js'
import { improveCardHtml } from './fixtures/render-improve-card.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-akashi-tests-'))
const items = { 1: { item_name: { zh: '样本' }, item_intro: '説明', item_remodel: { 火力: ['+1', '+2', '+3'] } } }
const module = { items, date: '2026-02-24T14:59:55Z', revision: 182356 }
const run = args => spawnSync(process.execPath, [path.join(root, 'scripts/build-akashi-improve.mjs'), ...args], {
  cwd: root, encoding: 'utf8', windowsHide: true,
})

test('逐格严格相等才收，空串不收；不同、模块缺、模块多均不收且不压紧索引', () => {
  const upstream = structuredClone(items)
  upstream[1].item_remodel.火力.push('')
  upstream[2] = { item_name: { zh: '模块多' }, item_intro: 'extra' }
  const local = structuredClone(upstream)
  delete local[2]
  local[1].item_remodel.火力[1] = '+2.0'
  local[1].item_remodel.火力.push('+5')
  local[1].item_intro = '不同'
  const { data, report } = compareItems(upstream, local)
  assert.deepEqual(data.items, { 1: { item_remodel: { 火力: { 0: '+1', 2: '+3' } } } })
  assert.deepEqual(report.summary.item_remodel, { same: 3, different: 1, missing: 1, extra: 0 })
  assert.deepEqual(report.summary.item_intro, { same: 0, different: 1, missing: 0, extra: 1 })
})

test('离线 Lua/API JSON 保留模块时间；无日期拒绝出包；一致率过低停止', () => {
  const lua = 'local k = {}\nk.EquipUpdateTb = { ["1"] = { ["item_intro"] = "説明" } }\nreturn k'
  const parsed = readModule(JSON.stringify({ query: { pages: { 30856: { revisions: [{ '*': lua, timestamp: module.date, revid: 182356 }] } } } }))
  assert.equal(parsed.date, module.date)
  assert.equal(parsed.items[1].item_intro, '説明')
  assert.deepEqual(readModule(lua, module.date).items, parsed.items)
  assert.throws(() => buildPack({ items }, items), /日期缺失/)
  assert.throws(() => buildPack(module, { 1: { item_remodel: { 火力: ['+9'] } } }), /一致率偏低/)
})

test('命令行缺本机包拒写正式包，正式文件逐字不动；只能指定候选且标未过滤', () => {
  const input = path.join(dir, 'module.json')
  fs.writeFileSync(input, JSON.stringify({ ...module, moduleUpdatedAt: module.date }))
  const before = fs.readFileSync(FORMAL_OUTPUT)
  const args = ['--from-file', input, '--akashi', path.join(dir, 'missing.json')]
  for (const suffix of [[], ['--out', FORMAL_OUTPUT]]) {
    const result = run([...args, ...suffix])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /拒绝直接写正式包/)
    assert.deepEqual(fs.readFileSync(FORMAL_OUTPUT), before)
  }
  const candidate = path.join(dir, 'candidate.json')
  const result = run([...args, '--out', candidate])
  assert.equal(result.status, 0, result.stderr)
  const pack = JSON.parse(fs.readFileSync(candidate, 'utf8'))
  assert.equal(pack.meta.bundle, false)
  assert.equal(pack.meta.comparisonVerified, false)
  assert.equal(pack.data.items[1].item_intro, '説明')
  assert.equal(buildPack(module, null).report.summary, null, '没有本机票时不得报告对照一致')
})

test('离线命令读对照票不写回；一致值生成正式形状', () => {
  const input = path.join(dir, 'equal-module.json'), local = path.join(dir, 'akashi.json'), output = path.join(dir, 'verified.json')
  fs.writeFileSync(input, JSON.stringify({ ...module, moduleUpdatedAt: module.date }))
  fs.writeFileSync(local, JSON.stringify({ data: { items } }))
  const before = fs.readFileSync(local)
  const result = run(['--from-file', input, '--akashi', local, '--out', output])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readFileSync(local), before)
  const pack = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(pack.meta.comparisonVerified, true)
  assert.equal(validation.validateLodePack(pack).ok, true)
})

test('随包优先到每格、每字段，本机仅补缺；缺格保持原星级', () => {
  const bundled = { items: { 1: { item_intro: 'CC', item_remodel: { 火力: { 0: '+1', 2: '+3' } } } } }
  const local = { items: { 1: { item_intro: 'local', item_remodel: { 火力: ['+9', '+2', '+9'], 命中: ['+1'] } } } }
  assert.equal(akashi.akashiImproveItem(1, bundled, local).item_intro, 'CC')
  assert.deepEqual(akashi.akashiImproveItem(1, bundled, local).item_remodel.火力.slice(0, 3), ['+1', '+2', '+3'])
  assert.deepEqual(akashi.akashiImproveItem(1, bundled, null).item_remodel.火力.slice(0, 3), ['+1', null, '+3'])
  assert.equal(akashi.akashiImproveItem(1, null, local).item_intro, 'local')
})

const eo = { eq_id: 1, improvement: [{ helpers: [], costs: {} }] }
test('真实改修卡：随包表显示值，缺格显示待补；完全缺失和改修提前返回也保留占位', () => {
  const html = improveCardHtml({ eo, bundledAkashi: { items: { 1: { item_remodel: { 火力: { 0: '+1', 2: '+3' } } } } } })
  assert.match(html, /<th>火力<\/th><td>\+1<\/td><td>待补<\/td><td>\+3<\/td>/)
  const rowMissing = improveCardHtml({ eo, bundledAkashi: { items: { 1: { item_remodel: { 火力: {}, 命中: { 0: '+1' } } } } } })
  assert.match(rowMissing, /<th>火力<\/th>(?:<td>待补<\/td>){10}/)
  for (const setup of [{ eo }, {}, { uncovered: true }]) {
    const empty = improveCardHtml(setup)
    assert.match(empty, /<summary>逐星加成<\/summary><div class="ak-empty">待补<\/div>/)
    assert.doesNotMatch(empty, /improve-star-table/)
  }
})

// 抽屉说明及悬浮摘要原样编译；只补外部 UI 状态，不重写被测条件。
const source = fs.readFileSync(path.join(root, 'src/renderer/modules/ji.ts'), 'utf8')
const introStart = source.indexOf('  // 図鑑説明:主数据快照不含 api_info')
const intro = source.slice(introStart, source.indexOf('\n\n  return `', introStart))
const peekStart = source.indexOf('  peek(ref) {', source.indexOf("registerEntityRoute('mstEquip',"))
const peek = source.slice(peekStart, source.indexOf("\n})\n", peekStart))
assert.ok(introStart > 0 && peekStart > 0)
const entry = path.join(dir, 'render.ts'), outfile = path.join(dir, 'render.cjs')
fs.writeFileSync(entry, `
import { akashiImproveItem } from '${path.join(root, 'src/shared/akashi-improve.ts').replaceAll('\\', '/')}'
let kcwikiAkashiLode: any = null, akashiListLode: any = null;
const e = { api_id: 1, api_name: '样本' };
const esc = (s: any) => String(s ?? '').replaceAll('<', '&lt;');
const foldedNote = (title: string, body: string) => '<details><summary>'+title+'</summary>'+body+'</details>';
const lodeCreditShort = (meta: any) => meta.source;
let eo: any;
const friendlyEquips = { get: () => e }, eoByEquip = { get: () => eo }, equipTypes = new Map();
const eoLode = null, improveCoverageMax = 0, LENG_LABEL = {};
const equipInstancesOf = () => [], equipStatValues = () => [], equippedInstIds = () => new Set();
const equipHeldOnce = () => false;
const equipTypeIconHtml = () => '', entityNamePlain = (_d: any, _id: any, fallback: string) => fallback;
const improvePackUncovered = () => true;
const route = { ${peek} };
export function render(bundled: any, local: any, improvement: any) {
 kcwikiAkashiLode = bundled ? { meta: { source: 'CC' }, data: bundled } : null;
 akashiListLode = local ? { meta: { source: 'local' }, data: local } : null;
 eo = improvement;
 ${intro}
 return { intro: introHtml, peek: route.peek({ num: 1 }) };
}
`)
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const { render } = createRequire(import.meta.url)(outfile)

test('真实说明及摘要：CC 优先、日文转义、空态不消失，★10 缺值标待补', () => {
  const full = render({ items: { 1: { item_intro: '<説明>', item_remodel: { 火力: { 9: '+3.16' } } } } }, { items: { 1: { item_intro: '旧文' } } }, eo)
  assert.match(full.intro, /&lt;説明>/)
  assert.doesNotMatch(full.intro, /旧文/)
  assert.match(full.peek.lines.join(''), /★10 火力\+3.16/)
  for (const improvement of [eo, null]) {
    const empty = render(null, null, improvement)
    assert.match(empty.intro, /图鉴说明.*日文原文.*待补/)
    assert.match(empty.peek.lines.join(''), /★10 待补/)
  }
})

test('真包及稀疏形状合法；数组、越界索引、空值、数值类型和其他域拒绝', () => {
  const pack = JSON.parse(fs.readFileSync(FORMAL_OUTPUT, 'utf8'))
  assert.equal(validation.validateLodePack(pack).ok, true)
  for (const item of [
    { item_remodel: { 火力: ['+1'] } }, { item_remodel: { 火力: { 40: '+1' } } },
    { item_remodel: { 火力: { 0: null } } }, { item_remodel: { 火力: { 0: 1 } } },
    { item_remodel: { 火力: { 0: '' } } }, { item_intro: '' }, { item_stat: {} },
  ]) {
    assert.equal(validation.validateLodePack({ ...pack, data: { schemaVersion: 1, items: { 1: item } } }).ok, false)
  }
})

test('真实改修卡与悬浮摘要：只有推算格标推算，实收不标；新版拒收格不由本机绕过', () => {
  const items = { 1: { item_remodel: { 火力: { 0: '+0.20', 9: '+2.00' } }, remodel_basis: {
    火力: { 0: { basis: 'kcwiki' }, 9: { basis: 'formula', formula: '1/火力', compared: true } },
  } } }
  const bundled = { schemaVersion: 2, items }
  const html = improveCardHtml({ eo, bundledAkashi: bundled })
  assert.match(html, /<td>\+0.20<\/td>/)
  assert.match(html, /\+2.00<small class="muted" title="按装备类别公式推算，未经游戏内实测"> 推算<\/small>/)
  assert.equal((html.match(/> 推算<\/small>/g) ?? []).length, 1)
  const rendered = render(bundled, null, eo)
  assert.match(rendered.peek.lines.join(''), /★10 火力\+2.00<small.*> 推算<\/small>/)
  items[1].remodel_basis.火力[9] = { basis: 'kcwiki' }
  assert.doesNotMatch(improveCardHtml({ eo, bundledAkashi: bundled }), /推算/)
  assert.doesNotMatch(render(bundled, null, eo).peek.lines.join(''), /推算/)
  const merged = akashi.akashiImproveItem(1, bundled, { items: { 1: { item_remodel: { 火力: { 1: '+0.40' }, 对空: { 9: '+2.00' } } } } })
  assert.equal(merged.item_remodel.火力[1], null)
  assert.equal(merged.item_remodel.对空, undefined)
})

test('新版来源标记校验：实收/推算逐格有据，无值来源与不完整推算标记拒收', () => {
  const pack = JSON.parse(fs.readFileSync(FORMAL_OUTPUT, 'utf8'))
  const cell = { item_remodel: { 火力: { 0: '+0.20' } }, remodel_basis: { 火力: { 0: { basis: 'formula', formula: '1/火力', compared: false } } } }
  const valid = item => validation.validateLodePack({ ...pack, data: { schemaVersion: 2, items: { 1: item } } }).ok
  assert.equal(valid(cell), true)
  for (const mark of [{ basis: 'unknown' }, { basis: 'formula' }, { basis: 'formula', formula: '1/命中', compared: true },
    { basis: 'formula', formula: '1/火力', compared: 'yes' }, { basis: 'kcwiki', formula: '1/火力' }]) {
    assert.equal(valid({ ...cell, remodel_basis: { 火力: { 0: mark } } }), false)
  }
  assert.equal(valid({ item_remodel: cell.item_remodel }), false)
  assert.equal(valid({ ...cell, remodel_basis: { 火力: { 1: { basis: 'kcwiki' } } } }), false)
  assert.equal(valid({ ...cell, formula_added_stats: ['命中'] }), false)
  assert.equal(valid({ ...cell, formula_added_stats: ['火力', '火力'] }), false)
  assert.equal(valid({ ...cell, formula_added_stats: ['火力'] }), true)
})
