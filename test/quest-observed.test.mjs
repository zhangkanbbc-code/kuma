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
  slice(qn, 'const CAT_META', '// ---- 重置倒计时'),
  slice(qn, 'const JST =', '// ---- 报酬关键词'),
  slice(qn, 'const periodOfRow =', '// 游戏只下发'),
  slice(qn, 'const questTextCache', '/**\n * 追踪器解出的条件行'),
  slice(qn, 'const annualResetHtml =', 'const questChainNode ='),
  'return { catOf, catColor, periodOfRow, questAnnualMonth, annualResetHtml, questText, invalidateQuestTextCache, categoryOf, CATEGORY_FILTERS }',
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
  assert.equal(runtime.catColor(row({ observed: { category: 1 } })), 'var(--ok)')
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
