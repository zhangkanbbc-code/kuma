import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import deltaText from '../dist/shared/material-delta-text.js'
import { textErrors, codeEvidenceTexts } from '../scripts/lib/evidence-text-audit.mjs'

const { describeDeltaDetail, groupDeltaRows } = deltaText
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const resolvers = {
  shipByRoster: id => ({ 1: '甲', 2: '乙', 3: '丙', 4: '丁', 5: '戊', 6: '己', 7: '庚' })[id] ?? null,
  shipByMst: id => ({ 101: '甲改', 102: '甲改二' })[id] ?? null,
  slotitemByMst: id => ({ 10: '小口径主炮', 11: '中口径主炮' })[id] ?? null,
  questName: id => id === 100 ? { code: 'B1', name: '出击任务' } : null,
  missionName: id => id === 5 ? { no: 'A1', name: '远洋练习航海' } : null,
  mapName: id => id === 16 ? '1-6' : null,
  cellLetter: (map, cell) => map === 16 && cell === 5 ? 'E' : null,
  itemName: id => id === 31 ? '燃料' : null,
}

const examples = [
  [{ kind: 'supply', ships: [1, 2, 3], onslot: true }, '补给 3 艘：甲、乙、丙，含舰载机'],
  [{ kind: 'dock', ship: 1, mst: 101, ndock: 1, highspeed: true }, '入渠 甲 · 高速修复'],
  [{ kind: 'build', recipe: [30, 30, 30, 30, 1], highspeed: true, large: true, kdock: 1 }, '建造 30/30/30/30 · 大型建造 · 高速建造'],
  [{ kind: 'craft', recipe: [10, 10, 10, 10], multiple: true, results: [10, 11, -1] }, '开发 10/10/10/10 ×3 → 小口径主炮、中口径主炮、失败'],
  [{ kind: 'scrap', ships: [{ id: 1, mst: 101 }, { id: 2, mst: 102 }], withSlots: true }, '解体 甲、乙 · 装备一并解体'],
  [{ kind: 'discard', slotitems: [{ id: 1, mst: 10 }, { id: 2, mst: 11 }] }, '废弃装备 2 件：小口径主炮、中口径主炮'],
  [{ kind: 'improve', slotitem: 1, mst: 10, certain: true, success: true, after: { mst: 11, level: 3 } }, '改修 小口径主炮 → 中口径主炮 ★3 · 确实化'],
  [{ kind: 'expedition', mission: 5, deck: 2, result: 'great' }, '远征 A1 远洋练习航海 · 第 2 舰队 · 大成功'],
  [{ kind: 'quest', quest: 100 }, '任务 B1 出击任务'],
  [{ kind: 'questCost', quest: 100 }, '任务达成消耗 B1 出击任务'],
  [{ kind: 'airBase', action: 'setPlane', area: 1, base: 2, squadron: 3 }, '基地航空队 第 2 基地 第 3 中队 配置'],
  [{ kind: 'airBaseSortie', map: 16 }, '基地航空队出击 1-6'],
  [{ kind: 'mapItem', map: 16, cell: 5, source: 'next' }, '海域资源点 1-6 E 点'],
  [{ kind: 'shipRemodel', ship: 1, from: 101, to: 102 }, '改造 甲改 → 甲改二'],
  [{ kind: 'itemUse', item: 31, paid: true }, '氪金道具 燃料'],
  [null, '—'],
]
for (const [detail, expected] of examples) {
  test(`逐笔描述 ${detail?.kind ?? 'null'}：${expected}`, () => {
    assert.equal(describeDeltaDetail(detail, resolvers), expected)
  })
}

test('补给按 mode 分燃弹，六艘边界不省略，超过六艘只列前六个', () => {
  const supply = { kind: 'supply', ships: [1], onslot: false }
  assert.equal(describeDeltaDetail({ ...supply, mode: 1 }, resolvers), '补给燃料 1 艘：甲')
  assert.equal(describeDeltaDetail({ ...supply, mode: 2 }, resolvers), '补给弹药 1 艘：甲')
  assert.equal(describeDeltaDetail({ ...supply, mode: 3, ships: [1, 2, 3, 4, 5, 6] }, resolvers), '补给 6 艘：甲、乙、丙、丁、戊、己')
  assert.equal(describeDeltaDetail({ ...supply, ships: [1, 2, 3, 4, 5, 6, 7], onslot: true }, resolvers), '补给 7 艘：甲、乙、丙、丁、戊、己等 7 艘，含舰载机')
})

test('离籍舰回查 detail 图鉴 id；在籍舰优先；改造保留两端历史形态', () => {
  assert.equal(describeDeltaDetail({ kind: 'dock', ship: 99, mst: 101, ndock: 1, highspeed: false }, resolvers), '入渠 甲改')
  assert.equal(describeDeltaDetail({ kind: 'scrap', ships: [{ id: 99, mst: 102 }], withSlots: false }, resolvers), '解体 甲改二')
  assert.equal(describeDeltaDetail({ kind: 'shipRemodel', ship: 1, from: 101, to: 102 }, resolvers), '改造 甲改 → 甲改二')
})

test('解析不到只回落对应编号，不推测舰名、装备名、任务名、远征名或道具名', () => {
  const unknown = Object.fromEntries(Object.keys(resolvers).map(key => [key, () => null]))
  const cases = [
    [{ kind: 'supply', ships: [123], onslot: false }, '补给 1 艘：#123'],
    [{ kind: 'dock', ship: 123, mst: 456, ndock: 1, highspeed: false }, '入渠 #456'],
    [{ kind: 'dock', ship: 123, mst: 0, ndock: 1, highspeed: false }, '入渠 #123'],
    [{ kind: 'craft', recipe: [10, 10, 10, 10], multiple: false, results: [123] }, '开发 10/10/10/10 → #123'],
    [{ kind: 'scrap', ships: [{ id: 123, mst: 0 }], withSlots: false }, '解体 #123'],
    [{ kind: 'discard', slotitems: [{ id: 1, mst: 123 }] }, '废弃装备 1 件：#123'],
    [{ kind: 'improve', slotitem: 123, mst: 0, success: false, certain: false }, '改修 #123 失败'],
    [{ kind: 'quest', quest: 123 }, '任务 #123'],
    [{ kind: 'questCost', quest: 123 }, '任务达成消耗 #123'],
    [{ kind: 'expedition', mission: 123, deck: 2, result: 'failed' }, '远征 #123 · 第 2 舰队 · 失败'],
    [{ kind: 'airBaseSortie', map: 123 }, '基地航空队出击 #123'],
    [{ kind: 'mapItem', map: 123, cell: 1, source: 'start' }, '海域资源点 #123'],
    [{ kind: 'shipRemodel', ship: 1, from: 123, to: 456 }, '改造 #123 → #456'],
    [{ kind: 'itemUse', item: 123, paid: false }, '使用道具 #123'],
  ]
  for (const [detail, expected] of cases) assert.equal(describeDeltaDetail(detail, unknown), expected)
})

test('改修成功无 after、失败忽略 after、确实化分支均如实显示', () => {
  const base = { kind: 'improve', slotitem: 1, mst: 10, success: true, certain: false }
  assert.equal(describeDeltaDetail(base, resolvers), '改修 小口径主炮 成功')
  assert.equal(describeDeltaDetail({ ...base, success: false, certain: true, after: { mst: 11, level: 3 } }, resolvers), '改修 小口径主炮 失败 · 确实化')
})

test('普通建造、单次开发失败及无结果、无图鉴废弃、远征结果、陆航补给、道具与地点缺省', () => {
  const cases = [
    [{ kind: 'build', recipe: [30, 30, 30, 30, 1], highspeed: false, large: false, kdock: 1 }, '建造 30/30/30/30'],
    [{ kind: 'craft', recipe: [10, 10, 10, 10], multiple: false, results: [-1] }, '开发 10/10/10/10 → 失败'],
    [{ kind: 'craft', recipe: [10, 10, 10, 10], multiple: false, results: [] }, '开发 10/10/10/10'],
    [{ kind: 'discard', slotitems: [{ id: 123, mst: 0 }] }, '废弃装备 1 件'],
    [{ kind: 'expedition', mission: 5, deck: 2, result: 'success' }, '远征 A1 远洋练习航海 · 第 2 舰队 · 成功'],
    [{ kind: 'expedition', mission: 5, deck: 2, result: 'failed' }, '远征 A1 远洋练习航海 · 第 2 舰队 · 失败'],
    [{ kind: 'airBase', action: 'supply', area: 1, base: 2, squadron: 3 }, '基地航空队 第 2 基地 第 3 中队 补给'],
    [{ kind: 'itemUse', item: 31, paid: false }, '使用道具 燃料'],
    [{ kind: 'itemUse', item: null, paid: true }, '氪金道具'],
    [{ kind: 'itemUse', item: null, paid: false }, '使用道具'],
    [{ kind: 'mapItem', map: 16, cell: 99, source: 'next' }, '海域资源点 1-6'],
    [{ kind: 'mapItem', source: 'start' }, '海域资源点'],
  ]
  for (const [detail, expected] of cases) assert.equal(describeDeltaDetail(detail, resolvers), expected)
})

const row = (category, ts, values) => ({ category, ts, values: [...values, ...Array(8 - values.length).fill(0)], detail: null })
test('全部按四项净值绝对值之和排序，同分按类别名，附属资材不影响排序', () => {
  const groups = groupDeltaRows([
    row('甲', 1, [10, -20]), row('乙', 2, [-50]), row('丙', 3, [40]),
    row('甲', 4, [-10, 20]), row('丁', 5, [0, 0, 0, 0, 999]), row('戊', 6, [40]),
  ], null)
  const tie40 = ['丙', '戊'].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const tie0 = ['甲', '丁'].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  assert.deepEqual(groups.map(g => g.category), ['乙', ...tie40, ...tie0])
  assert.equal(groups.find(g => g.category === '甲').count, 2)
})

test('筛资源先删零变动行，再计算笔数与八项净值；净值相抵仍保留分类', () => {
  const rows = [row('甲', 1, [5, -8, 2, 3, 4, 5, 6, 7]), row('甲', 3, [-5, 3]), row('甲', 2, [0, 900]), row('乙', 4, [0, 99]), row('丙', 5, [-6])]
  const original = structuredClone(rows)
  const groups = groupDeltaRows(rows, 0)
  assert.deepEqual(groups.map(g => [g.category, g.count]), [['丙', 1], ['甲', 2]])
  assert.deepEqual(groups[1].values, [0, -5, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(groups[1].rows.map(r => r.ts), [3, 1])
  assert.deepEqual(rows, original)
  assert.deepEqual(groupDeltaRows(rows, 3).map(g => [g.category, g.count]), [['甲', 1]])
  assert.deepEqual(groupDeltaRows([], null), [])
  assert.deepEqual(groupDeltaRows([row('甲', 1, [0, 0, 0, 0, 1])], 0), [])
})

test('逐个资源筛选后笔数、行集合、净值一致，输入行只归入一个分类', () => {
  const rows = [row('甲', 1, [5, 0, 2, 3, 1, 2, 3, 4]), row('乙', 2, [0, 7, 0, 1]), row('甲', 3, [-5, -2, -2, -3])]
  for (const resource of [null, 0, 1, 2, 3]) {
    const expected = rows.filter(r => resource == null || r.values[resource] !== 0)
    const groups = groupDeltaRows(rows, resource)
    assert.equal(groups.reduce((sum, g) => sum + g.count, 0), expected.length)
    assert.deepEqual(groups.flatMap(g => g.rows).sort((a, b) => a.ts - b.ts), expected)
    for (const group of groups) {
      assert.equal(group.count, group.rows.length)
      assert.deepEqual(group.values, Array.from({ length: 8 }, (_, idx) => group.rows.reduce((sum, r) => sum + r.values[idx], 0)))
    }
  }
})

// renderer 打包成依赖 Electron/DOM 的单一 IIFE，不能由 dist 直接 import。
// 这两条仅用源码断言守住依赖与调用位置；描述、分组行为由上面的纯函数用例验证。
test('主动明细视图不导入补丁订阅或被动刷新闸门', () => {
  const source = read('../src/renderer/modules/zi-delta-detail.ts')
  const ast = ts.createSourceFile('zi-delta-detail.ts', source, ts.ScriptTarget.Latest, true)
  const imports = ast.statements.filter(ts.isImportDeclaration).map(node => node.getText(ast)).join('\n')
  assert.doesNotMatch(imports, /\b(?:onMgChange|deferPassive)\b/)
})

test('锱 refresh 的并行查询列表不包含逐笔查询', () => {
  const source = read('../src/renderer/modules/zi.ts')
  const refresh = source.slice(source.indexOf('const refresh = async () =>'))
  const queries = refresh.match(/rows = await Promise\.all\(\[([\s\S]*?)\]\)/)?.[1]
  assert.ok(queries, '应找到锱的刷新查询列表，避免失效时空匹配放行')
  assert.doesNotMatch(queries, /\bqueryDeltaRows\b/)
})

test('新增描述与解释文案通过出处禁词表，README 使用已裁定引号', () => {
  const entries = examples.map(([detail, text]) => ({ file: 'material-delta-text', field: detail?.kind ?? 'null', text }))
  for (const file of ['../src/shared/material-delta-text.ts', '../src/renderer/modules/zi-delta-detail.ts']) {
    const source = read(file)
    entries.push(...codeEvidenceTexts(source, file))
    // 这次裁定也覆盖普通描述与悬停；它们不一定属于 audit 默认选择的出处字段。
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        entries.push({ file, field: 'copy', text: node.text })
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const readme = read('../README.md').split('\n').find(line => line.includes('| `zi` |'))
  entries.push({ file: 'README.md', field: 'zi', text: readme })
  assert.deepEqual(textErrors(entries), [])
  assert.doesNotMatch(readme, /[“”]/)
})

// 轻量 DOM 替身只验证事件与异步生命周期，不声称验证浏览器布局。
// 执行真实模块转译结果，替换 Electron 边界，整个测试不启动应用、不读写存档。
const deltaDialogHarness = (saved = {}) => {
  const hosts = []
  const listeners = new Map()
  const queries = []
  const preferences = { ...saved }
  const preferenceWrites = []
  const exports = {}
  const activeElement = { focus() {} }
  const document = {
    activeElement,
    createElement: () => {
      const body = { innerHTML: '' }, status = { textContent: '' }
      const buttons = []
      const host = {
        isConnected: false,
        set innerHTML(value) {
          for (const match of value.matchAll(/data-(range|resource)="([^"]+)"/g)) buttons.push({
            dataset: { [match[1]]: match[2] }, classList: { toggle() {} }, setAttribute() {},
          })
        },
        querySelector: selector => selector === '.zd-body' ? body : selector === '.zd-status' ? status : activeElement,
        querySelectorAll: selector => buttons.filter(b => selector === '[data-range]' ? b.dataset.range != null : b.dataset.resource != null),
        addEventListener: (_, fn) => { host.click = data => fn({ target: { closest: () => ({ dataset: data }) } }) },
        remove: () => { host.isConnected = false },
        body, status,
      }
      return host
    },
    body: { appendChild: host => { host.isConnected = true; hosts.push(host) } },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) },
  }
  const dependencies = {
    '../../shared/material-delta-text': deltaText,
    '../../shared/map-id': { mapCodeOf: id => `${Math.floor(id / 10)}-${id % 10}` },
    '../kernel': {
      esc: value => `${value}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
      fmtDateTime: () => '2026-09-07 12:34:56',
      mg: { ships: { 1: { shipId: 101 } }, master: { ships: { 101: { name: '<甲>' } }, slotitems: {}, missions: {} } },
      queryDeltaRows: since => new Promise((resolve, reject) => queries.push({ since, resolve, reject })),
      queryLode: async () => null,
      queryMasterRaw: async () => ({ data: { api_mst_useitem: [{ api_id: 31, api_name: '普通道具' }], api_mst_payitem: [{ api_id: 31, api_name: '付费商品' }] } }),
      uiGet: (key, fallback) => preferences[key] ?? fallback,
      uiSet: (key, value) => { preferences[key] = value; preferenceWrites.push([key, value]) },
    },
    '../entity-art': { MATERIAL_ICON_BY_INDEX: Array.from({ length: 8 }, (_, idx) => idx), materialIconHtml: idx => `<img data-material="${idx}">` },
    '../localization': { entityNamePlain: (_domain, _id, name) => name, registerLocalizedName() {} },
    '../expedition-name-index': { buildTaskExpeditionNameIndex: () => [], normalizeExpeditionDispNo: value => value },
    '../kcwiki-zh': { simplifyKcwikiExpeditionData: value => value },
    '../map-cell-letter': { ensureMapCellLetters() {}, mapCellLetter: () => '#5' },
  }
  const source = ts.transpileModule(read('../src/renderer/modules/zi-delta-detail.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(source, { exports, document, Date, console: { warn() {} }, require: name => {
    assert.ok(dependencies[name], `测试应显式替换依赖 ${name}`)
    return dependencies[name]
  } })
  return { open: () => exports.openDeltaDetail(resolvers.questName), hosts, queries, preferences, preferenceWrites, listeners }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('弹窗打开一次查询，分类默认收起，筛资源和展开不重查，超过 300 笔才显示展开全部', async () => {
  const h = deltaDialogHarness()
  const before = Date.now()
  h.open()
  const host = h.hosts[0]
  assert.equal(h.queries.length, 1)
  assert.ok(h.queries[0].since >= before - 7 * 86400000 && h.queries[0].since <= Date.now() - 7 * 86400000)
  assert.equal(host.status.textContent, '读取中……')
  const rows = Array.from({ length: 301 }, (_, idx) => ({ ...row('补给', idx, [-1]), detail: { kind: 'supply', ships: [1], onslot: false } }))
  h.queries[0].resolve({ rows, truncated: true })
  await settle()
  assert.match(host.body.innerHTML, /只显示最近 6000 笔，缩小时间范围可看更早的/)
  assert.match(host.body.innerHTML, /补给 · 301 笔/)
  assert.doesNotMatch(host.body.innerHTML, /class="zd-row"/)
  host.click({ act: 'group', category: '补给' })
  assert.equal((host.body.innerHTML.match(/class="zd-row"/g) ?? []).length, 300)
  assert.match(host.body.innerHTML, /展开全部 301 笔/)
  assert.match(host.body.innerHTML, /09-07 12:34/)
  assert.match(host.body.innerHTML, /补给 1 艘：&lt;甲&gt;/)
  host.click({ act: 'more', category: '补给' })
  assert.equal((host.body.innerHTML.match(/class="zd-row"/g) ?? []).length, 301)
  host.click({ act: 'resource', resource: '1' })
  assert.match(host.body.innerHTML, /暂无记录/)
  assert.equal(h.queries.length, 1)
  assert.equal(h.preferenceWrites.length, 0)
  host.click({ act: 'resource', resource: '-1' })
  host.click({ act: 'refresh' })
  assert.equal(h.queries.length, 2)
  assert.match(host.body.innerHTML, /补给 · 301 笔/)
  h.queries[1].resolve({ rows: rows.slice(0, 300), truncated: false })
  await settle()
  assert.doesNotMatch(host.body.innerHTML, /展开全部|只显示最近 6000/)
})

test('切范围记忆并拒绝迟到结果，刷新读取期间保留旧正文，失败可重试', async () => {
  const h = deltaDialogHarness()
  h.open()
  const host = h.hosts[0]
  host.click({ act: 'range', range: 'today' })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  assert.equal(h.queries[1].since, today.getTime())
  assert.equal(h.preferences['zi.deltaDetail.range'], 'today')
  h.queries[1].resolve({ rows: [row('今天', 1, [5])], truncated: false })
  await settle()
  h.queries[0].resolve({ rows: [row('过期范围', 1, [9])], truncated: false })
  await settle()
  assert.match(host.body.innerHTML, /今天 · 1 笔/)
  assert.doesNotMatch(host.body.innerHTML, /过期范围/)
  const previous = host.body.innerHTML
  host.click({ act: 'refresh' })
  assert.equal(host.body.innerHTML, previous)
  h.queries[2].reject(new Error('read failed'))
  await settle()
  assert.equal(host.body.innerHTML, previous)
  assert.equal(host.status.textContent, '读取失败，请刷新重试')
  host.click({ act: 'refresh' })
  h.queries[3].resolve({ rows: [], truncated: false })
  await settle()
  assert.match(host.body.innerHTML, /暂无记录/)
  assert.equal(host.status.textContent, '')
})

test('弹窗只保留一个宿主，关闭移除 Esc 监听与迟到回写，重新打开资源回到全部', async () => {
  const h = deltaDialogHarness({ 'zi.deltaDetail.range': '30' })
  const before = Date.now()
  h.open()
  assert.ok(h.queries[0].since >= before - 30 * 86400000 && h.queries[0].since <= Date.now() - 30 * 86400000)
  const old = h.hosts[0]
  old.click({ act: 'resource', resource: '3' })
  h.open()
  assert.equal(old.isConnected, false)
  assert.equal(h.hosts.filter(host => host.isConnected).length, 1)
  const host = h.hosts[1]
  h.queries[1].resolve({ rows: [row('燃料', 1, [1])], truncated: false })
  await settle()
  assert.match(host.body.innerHTML, /燃料 · 1 笔/)
  const oldBody = old.body.innerHTML
  h.queries[0].resolve({ rows: [row('已关闭', 1, [1])], truncated: false })
  await settle()
  assert.equal(old.body.innerHTML, oldBody)
  h.listeners.get('keydown')({ key: 'Escape' })
  assert.equal(host.isConnected, false)
  assert.equal(h.listeners.has('keydown'), false)
  h.open()
  h.hosts[2].click({ act: 'close' })
  assert.equal(h.hosts[2].isConnected, false)
  assert.equal(h.listeners.size, 0)
})

test('付费与普通道具同号也按各自目录解析；解释文字仅作为表头 title', async () => {
  const h = deltaDialogHarness()
  h.open()
  const host = h.hosts[0]
  h.queries[0].resolve({ rows: [
    { ...row('母港校准', 1, [1]), detail: { kind: 'itemUse', item: 31, paid: true } },
    { ...row('母港校准', 2, [1]), detail: { kind: 'itemUse', item: 31, paid: false } },
    row('基地航空队出击', 3, [-1]),
  ], truncated: false })
  await settle()
  assert.match(host.body.innerHTML, /title="两次返港之间账上没有单独记到的变化，含自然回复"/)
  assert.match(host.body.innerHTML, /title="含出击期间的自然回复"/)
  assert.doesNotMatch(host.body.innerHTML.replaceAll(/title="[^"]*"/g, ''), /自然回复/)
  host.click({ act: 'group', category: '母港校准' })
  assert.match(host.body.innerHTML, /氪金道具 付费商品/)
  assert.match(host.body.innerHTML, /使用道具 普通道具/)
})
