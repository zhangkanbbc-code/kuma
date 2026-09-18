import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import observed from '../dist/shared/quest-observed.js'

const { questPeriodFromObserved, questCategoryLetterFromObserved } = observed
const unknown = { kind: null, label: null, cls: null, annualMonth: null }
for (const [type, labelType, kind, label, cls, annualMonth] of [
  [1, 2, 'daily', '日', 'd', null],
  [2, 3, 'weekly', '周', 'w', null],
  [3, 6, 'monthly', '月', 'm', null],
  [4, 1, 'once', '单', 'o', null],
  [5, 7, 'quarterly', '季', 'q', null],
  [5, 106, 'annual', '年', 'y', 6],
]) {
  test(`账本实测周期 (${type}, ${labelType}) → ${label}`, () => {
    assert.deepEqual(questPeriodFromObserved(type, labelType), { kind, label, cls, annualMonth })
  })
}

test('年任覆盖 101–112，未知周期不猜单发，旧快照日周月单仍按 type 判', () => {
  for (let month = 1; month <= 12; month++) {
    assert.deepEqual(questPeriodFromObserved(5, 100 + month), {
      kind: 'annual', label: '年', cls: 'y', annualMonth: month,
    })
  }
  for (const [type, labelType] of [[5, 8], [5, 0], [5, 100], [5, 113], [5, 106.5], [0, 7], [0, 0], [6, 106]]) {
    assert.deepEqual(questPeriodFromObserved(type, labelType), unknown)
  }
  for (const [type, labelType] of [[1, 2], [2, 3], [3, 6], [4, 1]]) {
    assert.deepEqual(questPeriodFromObserved(type, 0), questPeriodFromObserved(type, labelType))
  }
})

test('游戏 category 1–11 映射到既有分类字母，0/12 无分类', () => {
  for (const [category, letter] of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'B', 'B', 'B', 'F'].entries()) {
    assert.equal(questCategoryLetterFromObserved(category + 1), letter)
  }
  for (const category of [0, 12]) assert.equal(questCategoryLetterFromObserved(category), null)
})

// 执行线上函数原文，仅隔离 DOM/Electron；分类、文本归一化与月份回退不另抄实现。
const qn = fs.readFileSync(new URL('../src/renderer/modules/qn.ts', import.meta.url), 'utf8')
const categorySource = fs.readFileSync(new URL('../src/renderer/quest-category.ts', import.meta.url), 'utf8')
const { CAT_META } = new Function(transformSync(`${categorySource.replace(/^export /gm, '')}\nreturn { CAT_META }`, { loader: 'ts' }).code)()
const entity = fs.readFileSync(new URL('../src/renderer/task-entity-match.ts', import.meta.url), 'utf8')
const slice = (source, start, end) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + 1)
  assert.ok(from >= 0 && to > from, `找不到 ${start}`)
  return source.slice(from, to)
}
const code = [
  slice(entity, 'export const JP2CN', 'export const normalizeTaskEntityText').replace(/^export /gm, ''),
  'const simplifyJp = simplifyTaskEntityText',
  categorySource.replace(/^export /gm, ''),
  slice(qn, 'const catOf', '// ---- 重置倒计时'),
  slice(qn, 'const JST =', '// ---- 报酬关键词'),
  slice(qn, 'const periodOfRow =', '// 游戏只下发'),
  slice(qn, 'const questTextCache', '/**\n * 追踪器解出的条件行'),
  slice(qn, 'const annualResetHtml =', 'const questChainNode ='),
  'return { catOf, catColor, periodOfRow, questAnnualMonth, annualResetHtml, questText, invalidateQuestTextCache, categoryOf, CATEGORY_FILTERS, TASK_CATEGORIES }',
].join('\n')
const runtime = new Function('questPeriodFromObserved', 'questCategoryLetterFromObserved', 'fmtDurationLong',
  transformSync(code, { loader: 'ts' }).code)(questPeriodFromObserved, questCategoryLetterFromObserved, () => '倒计时')
const row = (overrides = {}) => ({
  id: 900001, code: '?', name: '', desc: '', memo: '', memo2: '',
  observed: { category: 1, type: 5, labelType: 106, title: '', detail: '' },
  ...overrides,
})

test('未收录年任月份供抽屉和重置倒计时使用，memo2 优先，旧快照按编码回退', () => {
  assert.deepEqual(runtime.periodOfRow(row()), ['年', 'y'])
  assert.equal(runtime.questAnnualMonth(row()), 6)
  assert.match(runtime.annualResetHtml(row()), /6月1日 05:00 JST/)
  assert.match(runtime.annualResetHtml(row()), /data-cdl="\d+"/)
  assert.equal(runtime.questAnnualMonth(row({ memo2: '年常任务（2月）' })), 2)
  assert.deepEqual(runtime.periodOfRow(row({ code: 'Bq1', observed: { type: 5 } })), ['季', 'q'])
  assert.deepEqual(runtime.periodOfRow(row({ observed: { type: 1 } })), ['日', 'd'])
  assert.deepEqual(runtime.periodOfRow(row({ observed: { type: 5, labelType: 8 } })), ['单', 'o'])
  assert.equal(runtime.questAnnualMonth(row({ observed: { type: 5 } })), null)
})

test('未收录任务按游戏分类进入命名页和文本细分，已有编码优先且未知分类保留兜底', () => {
  for (const [category, title, expected] of [
    [1, '', 'formation'], [2, '', 'sortie'], [3, '', 'exercise'], [4, '', 'expedition'],
    [5, '補給', 'supply'], [5, '入渠', 'repair'], [6, '建造', 'build'], [6, '開発', 'develop'],
    [6, '廃棄', 'scrap'], [6, '改修', 'improve'], [7, '', 'remodel'], [8, '', 'sortie'], [9, '', 'sortie'],
    [10, '「第九戦隊」抜錨！前線展開せよッ！', 'sortie'],
    [11, '建造', 'build'], [11, '開発', 'develop'], [11, '廃棄', 'scrap'], [11, '改修', 'improve'],
  ]) {
    runtime.invalidateQuestTextCache()
    const r = row({ observed: { category, title } })
    assert.equal(runtime.categoryOf(r).key, expected, `${category}/${title}`)
    const pages = runtime.CATEGORY_FILTERS.filter((item) => item.test(r)).map((item) => item.key)
    assert.deepEqual(pages, [(category >= 5 && category <= 7) || category === 11 ? 'factory' : expected])
  }
  assert.equal(runtime.catOf(row({ code: 'B1', observed: { category: 1 } })), 'B')
  assert.equal(runtime.catColor(row({ observed: { category: 1 } })), CAT_META.A[1])
  runtime.invalidateQuestTextCache()
  assert.deepEqual(runtime.CATEGORY_FILTERS.filter((item) => item.test(row({ observed: { category: 0 } })))
    .map((item) => item.key), ['unclassified'])
})

test('未收录任务标题和说明参与简化文本，任务库补齐并失效缓存后恢复库文本', () => {
  runtime.invalidateQuestTextCache()
  const r = row({ observed: { title: '新任務', detail: '裝備を開発して廃棄' } })
  const text = runtime.questText(r)
  assert.match(text, /新任務/)
  assert.match(text, /开发/)
  assert.match(text, /废弃/)
  runtime.invalidateQuestTextCache()
  assert.equal(runtime.questText({ ...r, code: 'F1', name: '已收录', desc: '正文', memo2: '备注' }), '已收录 正文 备注')
})

test('实际搜索筛选接入未收录任务的日文标题、说明及简化字，已收录行沿用原搜索字段', () => {
  runtime.invalidateQuestTextCache()
  const state = { status: 'all', category: null, period: null, quick: null, search: '' }
  const applyFilters = new Function('state', 'questText', 'isInferredCompleted',
    transformSync(`${slice(qn, 'const applyFilters =', '// 精确计数')}\nreturn applyFilters`, { loader: 'ts' }).code)(
    state, runtime.questText, () => false,
  )
  const r = row({ observed: { title: '新開発任務', detail: '裝備を廃棄' } })
  for (const search of ['新開発任務', '新开发任務', '裝備を廃棄', '装备', '废弃']) {
    state.search = search
    assert.deepEqual(applyFilters([r]), [r], search)
  }
  state.search = '废弃'
  assert.deepEqual(applyFilters([{ ...r, code: 'F1' }]), [])
})

// 执行实际行与进度模板，沿用上方真实分类/周期函数；外部状态和实体标题服务隔离。
// 仓内没有任务行 DOM/浏览器夹具，布局与颜色级联另用 CSS 规则守卫，不冒充像素验收。
const rowDeps = {
  periodOfRow: runtime.periodOfRow,
  categoryOf: runtime.categoryOf,
  isInferredCompleted: (r) => !!r.inferredCompleted,
  isObservedActive: (r) => r.observed?.state === 2,
  qpOf: (r) => r.precise ?? null,
  qp: null,
  questVerdicts: () => new Map(),
  state: { selected: null },
  esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  entityNamePlain: (_kind, _id, name) => name,
  PROSE_REPLACING_CATEGORIES: new Set(),
  taskProseHtml: (value) => value,
  rewardIcons: () => '奖励',
  sameDayResetHtml: () => '',
}
// 实体名的包装与类别 class 执行生产实现，只隔离译名数据表。
const localization = fs.readFileSync(new URL('../src/renderer/localization.ts', import.meta.url), 'utf8')
rowDeps.entityNameHtml = new Function('esc', 'tables', transformSync([
  slice(localization, 'const ENTITY_COLOR_CLASS_BY_DOMAIN', 'const ENTITY_COLOR_CLASS_BY_LINK_TYPE'),
  slice(localization, 'export const entityColorClass =', 'export const entityLinkColorClass'),
  slice(localization, 'const clean =', 'export const registerLocalizedName'),
  slice(localization, 'export const localizedEntry =', 'export const localizedEntityId'),
  slice(localization, 'export const bilingualNameHtml =', 'export const entityNamePlain'),
  'return entityNameHtml',
].join('\n').replace(/^export /gm, ''), { loader: 'ts' }).code)(rowDeps.esc, {})
const rowRuntime = new Function(...Object.keys(rowDeps), transformSync([
  slice(qn, 'const FLAG_TEXT =', 'const SYSTEM_BY_CATEGORY'),
  'return { rowHtml, progressHtml }',
].join('\n'), { loader: 'ts' }).code)(...Object.values(rowDeps))
const preciseProgress = (overrides = {}) => ({ pct: 50, text: '25/50', parts: [], approx: false, floored: false, ...overrides })

test('任务行真实模板按周期、编号、标题、进度、状态排列，保留常规态正文与奖励', () => {
  runtime.invalidateQuestTextCache()
  const html = rowRuntime.rowHtml(row({ code: 'Cd1', name: '演习任务标题', desc: '任务正文',
    observed: { state: 2, type: 1, title: '演习任务标题' }, precise: preciseProgress() }))
  const tokens = ['class="per d">日', 'class="q-nm"', 'class="id">Cd1', '<b title="演习任务标题">',
    'class="q-prog"', 'class="st-tag"']
  const indices = tokens.map((token) => html.indexOf(token))
  assert.ok(indices.every((index, at) => index >= 0 && (at === 0 || index > indices[at - 1])), html)
  assert.match(html, /class="plain">任务正文<\/span>/)
  assert.match(html, /class="q-rew">奖励<\/span>/)
  assert.match(html, /class="q-prog-label">本地计数<\/span>/)
  assert.match(html, /<span>25\/50<\/span>/)
})

test('进度真实模板隔离所有说明标签，隐藏标签仍保留数值、下限、预估符号和分段条', () => {
  for (const [label, number, overrides] of [
    ['链上确认', '100%', { inferredCompleted: true }],
    ['资料', '—', { observed: null }],
    ['完成', '100%', { observed: { state: 3 } }],
    ['本地计数', '25/50', { precise: preciseProgress() }],
    ['下限校正', '≥25/50', { precise: preciseProgress({ floored: true, text: '≥25/50' }) }],
    ['已保留', '25/50', { observed: { state: 1 }, precise: preciseProgress() }],
    ['尚未领取', '—', { observed: { state: 1 } }],
    ['游戏显示', '≥80%', { observed: { state: 2, progressFlag: 2 } }],
  ]) {
    const html = rowRuntime.progressHtml(row({ observed: { state: 2 }, ...overrides }))
    assert.ok(html.includes(`<span class="q-prog-label">${label}</span>`), label)
    const narrowContent = html.replace(/<span class="q-prog-label">[^<]*<\/span>/g, '')
    assert.ok(narrowContent.includes(`<span>${number}</span>`), label)
    assert.ok(!narrowContent.includes(`>${label}<`), label)
  }
  const html = rowRuntime.progressHtml(row({ observed: { state: 2 }, precise: preciseProgress({
    approx: true, text: '1/2 项', parts: [
      { ratio: 1, label: '条件一', now: 1, cap: 1 },
      { ratio: 0.5, label: '条件二', now: 1, cap: 2 },
    ],
  }) }))
  assert.match(html, /class="pb seg"><b class="ok"><i style="width:100%"/)
  assert.match(html, /<b><i style="width:50%"/)
  assert.match(html, /class="q-prog-label">本地计数<\/span><span title="[^"]+">≈<\/span>/)
  assert.match(html, /<span>1\/2 项<\/span>/)
})

test('任务行分类变量沿用真实分类色，左条读取变量，未收录编号保留金色优先类', () => {
  const colors = new Set()
  for (const [code, name, expected] of [
    ['A1', '', 'var(--qcat-A)'], ['B1', '', 'var(--qcat-B)'], ['C1', '', 'var(--qcat-C)'],
    ['D1', '', 'var(--qcat-D)'], ['E1', '补给', 'var(--qcat-E)'], ['E2', '入渠', 'var(--qcat-E-repair)'],
    ['F1', '开发', 'var(--qcat-F-develop)'], ['G1', '', 'var(--qcat-G)'], ['S1', '', 'var(--gold)'],
  ]) {
    runtime.invalidateQuestTextCache()
    const html = rowRuntime.rowHtml(row({ code, name }))
    assert.ok(html.includes(`class="q-row" style="--q-cat:${expected}"`), code)
    assert.match(html, /class="bar-l" style="background:var\(--q-cat\)"/)
    assert.ok(html.includes(`class="id">${code}</span>`), code)
    colors.add(expected)
  }
  assert.equal(colors.size, 9)
  runtime.invalidateQuestTextCache()
  const html = rowRuntime.rowHtml(row({ observed: { category: 3, type: 1 } }))
  assert.match(html, /class="q-row" style="--q-cat:var\(--qcat-C\)"/)
  assert.match(html, /class="id unlisted" title="[^"]+">#900001<\/span>/)
})

test('任务行 CSS 仅窄态换行、铺满标题与进度、贯穿色条并隐藏说明，编号金色优先', () => {
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const rule = (selector) => {
    const start = html.indexOf(`${selector} {`)
    assert.ok(start >= 0, selector)
    return html.slice(start, html.indexOf('}', start) + 1)
  }
  const narrowRow = rule('.mod-qn.narrow .q-row')
  for (const declaration of ['position: relative;', 'flex-wrap: wrap;', 'row-gap: 3px;']) assert.ok(narrowRow.includes(declaration))
  assert.match(rule('.mod-qn.narrow .bar-l'), /position: absolute; left: 0; top: 0; bottom: 0;/)
  assert.match(rule('.mod-qn.narrow .q-nm'), /flex: 1 1 0; min-width: 0;/)
  assert.match(rule('.mod-qn.narrow .q-row::after'), /content: ''; flex-basis: 100%; order: 1;/)
  assert.match(rule('.mod-qn.narrow .q-prog'), /order: 2;.*display: flex;.*flex: 1 1 auto; width: auto;/)
  assert.match(rule('.mod-qn.narrow .q-prog .pb'), /flex: 1;/)
  assert.match(rule('.mod-qn.narrow .q-prog .pt'), /flex: none;.*margin-top: 0; margin-left: auto;/)
  assert.match(rule('.mod-qn.narrow .q-row > .st-tag'), /order: 2;/)
  assert.match(rule('.mod-qn.narrow .st-tag'), /flex-basis: 60px; width: 60px;/)
  assert.match(rule('.mod-qn.narrow .q-prog-label'), /display: none;/)
  assert.match(rule('.mod-qn.narrow .q-nm .plain, .mod-qn.narrow .q-rew, .mod-qn.narrow .q-cat-label'), /display: none;/)
  assert.equal(rule('.mod-qn .q-row'), '.mod-qn .q-row { display: flex; align-items: center; gap: 9px; padding: 8px 14px 8px 12px; }')
  assert.match(rule('.mod-qn .q-prog'), /flex: none; width: 130px;/)
  assert.match(rule('.mod-qn .st-tag'), /flex: 0 0 68px; width: 68px;/)
  assert.match(rule('.mod-qn .q-nm .t b'), /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/)
  assert.match(rule('.mod-qn .q-nm .t b'), /color: var\(--q-cat\); font-size: 12.5px; font-weight: 600;/)
  assert.match(rule('.mod-qn .q-zh > b'), /color: var\(--q-cat\);/)
  assert.match(rule('.mod-qn .q-nm .plain'), /color: var\(--sub\);/)
  assert.match(rule('.mod-qn .q-cat-label'), /background: var\(--bg3\);[\s\S]*color: var\(--sub\);/)
  assert.match(rule('.mod-qn .q.ghost'), /opacity: 0.6;/)
  // 默认深色仍为原金色的 7% 淡底，同时允许浅色主题覆盖该基色。
  const darkPalette = html.match(/:root\s*\{([^}]+)\}/)[1]
  assert.match(rule('.mod-qn .q.done-row'), /background: linear-gradient\(90deg, color-mix\(in srgb, var\(--gold\) 7%, transparent\), transparent 60%\);/)
  assert.match(darkPalette, /--gold:\s*#e8c66a;/)
  assert.match(rule('.mod-qn .q-drawer-head b'), /color: var\(--accent\);/)
  // 四种周期各自保留原值，引用处也必须使用对应语义 token。
  for (const [period, token, color] of [
    ['d', 'expedition-soft', '#5ab8d8'], ['w', 'ok', '#67c98a'],
    ['m', 'warn', '#e8a04c'], ['q', 'event-soft', '#b489ff'],
  ]) {
    assert.ok(rule(`.mod-qn .per.${period}`).includes(`color: var(--${token});`))
    assert.ok(darkPalette.includes(`--${token}: ${color};`))
  }
  // :where 内的层级不增加权重，未收录的三类选择器继续胜过普通编号的两类选择器。
  assert.match(rule('.mod-qn :where(.q-nm .t) .id'), /color: var\(--q-cat\);/)
  assert.match(rule('.mod-qn .id.unlisted'), /color: var\(--gold\)/)
  assert.doesNotMatch(html, /\.mod-qn \.q-prog-label\s*\{/)
})

// 旧值仅作迁移记录；逐类执行真实分类函数并钉住新值，覆盖所有细分色。
const categoryMigration = [
  ['limited', 'S1', '', 'var(--gold)', 'var(--gold)', 'var(--gold)'],
  ['formation', 'A1', '', '#67c98a', 'var(--qcat-A)', '#67c98a'],
  ['sortie', 'B1', '', '#e06c75', 'var(--qcat-B)', '#e06c75'],
  ['exercise', 'C1', '', '#5ab8d8', 'var(--qcat-C)', '#a3dc6f'],
  ['expedition', 'D1', '', '#8fb8e0', 'var(--qcat-D)', '#3fcab4'],
  ['supply', 'E1', '补给', '#c9a86a', 'var(--qcat-E)', '#e0c455'],
  ['repair', 'E2', '入渠', '#d7a76f', 'var(--qcat-E-repair)', '#d4b048'],
  ['build', 'F1', '建造', '#a08a6a', 'var(--qcat-F)', '#b8895a'],
  ['develop', 'F2', '开发', '#b69a75', 'var(--qcat-F-develop)', '#c69a70'],
  ['scrap', 'F3', '废弃', '#9d806d', 'var(--qcat-F-scrap)', '#ad805e'],
  ['improve', 'F4', '改修', '#b489ff', 'var(--qcat-G)', '#b489ff'],
  ['remodel', 'G1', '', '#c59aff', 'var(--qcat-G)', '#b489ff'],
]

test('十二种任务分类旧值到新值对照逐项精确匹配，模板沿用全部细分色', () => {
  assert.deepEqual(runtime.TASK_CATEGORIES.map(({ key }) => key), categoryMigration.map(([key]) => key))
  for (const [key, code, name, previous, expected, dark] of categoryMigration) {
    runtime.invalidateQuestTextCache()
    const r = row({ code, name })
    assert.equal(runtime.categoryOf(r).key, key)
    assert.equal(runtime.categoryOf(r).color, expected, `${key}: ${previous} → ${expected}`)
    assert.equal(paletteColor(expected), paletteColor(dark), `${key}: 深色保留裁定原值`)
    assert.ok(rowRuntime.rowHtml(r).includes(`style="--q-cat:${expected}"`), key)
  }
})

test('八种字母回退色精确匹配，工厂筛选与独立任务树共用同表', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CAT_META).map(([key, [, color]]) => [key, color])), {
    A: 'var(--qcat-A)', B: 'var(--qcat-B)', C: 'var(--qcat-C)', D: 'var(--qcat-D)',
    E: 'var(--qcat-E)', F: 'var(--qcat-F)', G: 'var(--qcat-G)', S: 'var(--gold)',
  })
  for (const [letter, [, color]] of Object.entries(CAT_META)) {
    assert.equal(runtime.catColor(row({ code: `${letter}1` })), color)
  }
  assert.equal(runtime.CATEGORY_FILTERS.find(({ key }) => key === 'factory').color, CAT_META.F[1])
  const tree = fs.readFileSync(new URL('../src/renderer/quest-tree-window.ts', import.meta.url), 'utf8')
  assert.match(qn, /import \{ CAT_META, CAT_DETAIL_COLORS \} from '\.\.\/quest-category'/)
  assert.match(tree, /import \{ CAT_META \} from '\.\/quest-category'/)
  const treeMeta = new Function('CAT_META', `${slice(tree, 'const CATEGORY_META', 'const STATUS_META')}\nreturn CATEGORY_META`)(CAT_META)
  assert.deepEqual(treeMeta, Object.fromEntries(Object.entries(CAT_META).map(([key, [label, color]]) => [key, { label, color }])))
  assert.doesNotMatch(qn + tree + categorySource, /#5ab8d8|#8fb8e0/)
})

// 对共享 token 的两个主题分别实算，避免字符串换成 var() 后跳过色相与对比度。
const paletteSource = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const palettes = [...paletteSource.matchAll(/:root(?:\[data-theme="light"\])?\s*\{([^}]+)\}/g)]
  .map(m => Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map(v => [v[1], v[2]])))
const paletteColor = (value, mode = 0) => value.startsWith('var(') ? palettes[mode][value.slice(6, -1)] : value
const luminance = hex => hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
  .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
const hue = hex => {
  const [r, g, b] = hex.slice(1).match(/../g).map(v => parseInt(v, 16))
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  return d === 0 ? 0 : ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360
}

test('具名分类两个主题在 bg0 与 bg1 上均达到 4.5:1，浅色色相偏差不超过 15°', () => {
  const colors = [...runtime.TASK_CATEGORIES.map(({ color }) => color), ...Object.values(CAT_META).map(([, color]) => color)]
  for (const color of colors) {
    const deviation = Math.abs(hue(paletteColor(color)) - hue(paletteColor(color, 1)))
    assert.ok(Math.min(deviation, 360 - deviation) <= 15, color)
    for (const mode of [0, 1]) {
      for (const bg of ['bg0', 'bg1']) {
        const a = luminance(paletteColor(color, mode)), b = luminance(palettes[mode][bg])
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        assert.ok(ratio >= 4.5, color + '/' + bg + ': ' + ratio)
      }
    }
  }
})

test('抽屉根模板从选中任务取得同一细分类色，切换与关闭不遗留旧色', () => {
  const opening = qn.match(/<aside class="q-drawer[^\n]+/)
  assert.ok(opening)
  const drawer = new Function('selected', 'drawerAlreadyOpen', 'categoryOf', `return \`${opening[0]}\``)
  for (const [, code, name, , expected] of categoryMigration) {
    runtime.invalidateQuestTextCache()
    for (const stable of [false, true]) {
      assert.ok(drawer(row({ code, name }), stable, runtime.categoryOf).includes(`style="--q-cat:${expected}"`))
    }
  }
  assert.match(drawer(null, false, runtime.categoryOf), /style="--q-cat:" aria-hidden="true"/)
  assert.match(slice(qn, 'const detailHtml =', '// 三张下拉'), /<div class="q-zh"><b>\$\{entityNameHtml\('quest', row.id,/)
})

// 本次事故只钉了 b 的 color，实体名 span 自带色，分类色没有落到可见文字。
// 护栏须同时验证真实模板的内层 span 与它的 --entity-color，不能再用裸文本替身。
test('列表与抽屉标题的可见文字由真实实体名 span 承载', () => {
  const detailDeps = {
    ...rowDeps,
    simplifyJp: (value) => value,
    qpDetailHtml: () => '',
    noCounterHtml: () => '',
    questChainHtml: () => '',
    annualResetHtml: () => '',
    lineupSectionHtml: () => '',
    expeditionTogetherHtml: () => '',
    entityChipsHtml: () => '',
    rewardSectionsHtml: () => '',
    scnLode: null,
  }
  const drawer = new Function(...Object.keys(detailDeps), transformSync([
    slice(qn, 'const detailHtml =', '// 三张下拉'),
    'return detailHtml',
  ].join('\n'), { loader: 'ts' }).code)(...Object.values(detailDeps))
  runtime.invalidateQuestTextCache()
  const r = row({ code: 'C1', name: '演习任务标题', observed: { title: '演习任务标题', state: 2 } })
  assert.match(rowRuntime.rowHtml(r), /<b title="演习任务标题"><span class="entity-term e-quest">演习任务标题<\/span><\/b>/)
  assert.match(drawer(r), /<div class="q-zh"><b><span class="entity-term e-quest">演习任务标题<\/span><\/b>/)
})

test('分类色只覆盖列表与抽屉标题内层变量，其他任务实体保留全局紫色', () => {
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const override = html.match(/([^{}]+)\{\s*--entity-color:\s*var\(--q-cat\);\s*\}/g)
  assert.equal(override?.length, 1)
  const selectors = override[0].slice(0, override[0].indexOf('{')).split(',').map((selector) => selector.trim())
  assert.deepEqual(selectors, ['.mod-qn .q-nm .t b .entity-term', '.mod-qn .q-zh > b .entity-term'])
  assert.match(html, /\.e-quest\s*\{\s*--entity-color:\s*var\(--entity-quest\);\s*\}/)
  assert.ok(html.indexOf(override[0].trim()) > html.indexOf('.e-quest {'))
})
