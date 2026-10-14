import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import fs from 'node:fs'
import { clock, cut, dom, evaluate, makeKernel, makeZi } from './fixtures/zi-refresh-runtime.mjs'

const senkaTime = runtimeHost().load('src/shared/senka.ts')
const summary = at => ({ monthStart: senkaTime.senkaMonthStart(at), total: 100, normal: 100, special: 0, entries: [], carry: null })
const ranking = key => ({ historyKey: key, ownRank: 101, history: undefined })
const form = '<div><input class="sd-cal-input"><select class="sd-qadd-pick"></select><button>以此为准</button></div>'
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

const setup = (overrides = {}, options = {}) => {
  const documentDom = overrides.documentDom ?? dom()
  const timer = overrides.timer ?? clock()
  const kernel = makeKernel(documentDom, timer, overrides.interaction)
  const pane = new documentDom.Element('DIV')
  pane.classList = { contains: () => true }
  const html = { value: form }, warnings = [], queries = [], renders = []
  const defaults = {
    ...documentDom, ...timer, ...kernel,
    console: { warn: (...args) => warnings.push(args) },
    pane, senka: summary(timer.Date.now()), senkaRanking: ranking('one'),
    senkaMonthLabel: senkaTime.senkaMonthLabel, nextSenkaViewBoundary: senkaTime.nextSenkaViewBoundary,
    senkaDetailBodyHtml: () => html.value, render: () => renders.push('pane'),
    senkaRolloverTimer: null,
    querySenka: async () => { queries.push('senka'); return summary(timer.Date.now()) },
    querySenkaRanking: async (_at, opts) => {
      queries.push(opts?.history ? 'history' : 'ranking')
      return { ...ranking('one'), ...(opts?.history ? { history: [] } : {}) }
    },
    querySenkaCalendar: async month => {
      queries.push(`calendar:${month ?? 'current'}`)
      return { month: month ?? new timer.Date(timer.Date.now() + 9 * 3600_000).toISOString().slice(0, 7) }
    },
    senkaCalendarHtml: model => `<div>${model.month}</div>`,
    pinCard: ({ body }) => {
      const card = new documentDom.Element('DIV')
      card.appendChild(new documentDom.Element('DIV', 'p-s')).innerHTML = body
      documentDom.document.body.appendChild(card)
      return card
    },
  }
  if (options.fullRefresh) Object.assign(defaults, {
    dayRolloverTimer: null, refreshGeneration: 0, refreshPending: false, lastRefresh: 0, loadError: null,
    todayHistory: [], todayHasBaseline: false, rollingDayHistory: [], rollingDayHasBaseline: false,
    deltas: [], activityAreaId: 0, activityHistory: [], activityHistoryHasBaseline: false,
    activityDeltas: [], activitySortieCosts: null, itemFlow: new Map(), qp: {}, senkaQuestNames: new Map(),
    activeEventArea: () => null, queryMaterialHistory: async start => {
      queries.push(`materials:${start}`); return [{ ts: timer.Date.now(), values: [88, 0, 0, 0, 0, 0, 0, 0] }]
    },
    queryDeltaSummary: async () => [], queryUseitemSummary: async () => [],
    queryFastbuildFlow: async (from, to) => {
      queries.push(`fastbuild:${from}:${to}`); return { gained: 5, spent: 2, changes: 2, lastTs: to }
    },
    queryQp: async () => ({}), queryLode: async () => null,
    prepareHistory: rows => ({ rows, hasBaseline: false, observedStart: null }),
    normalizeDeltaCategories: rows => rows, timedRun: (_tag, run) => run(),
  })
  else defaults.runPassiveRefresh = () => renders.push('boundary')
  if (options.opening) Object.assign(defaults, {
    senkaRecountArmed: false, senkaRecountResult: null, senkaAddOpen: false, senkaAddError: '',
    senkaDelArmId: 0, senkaDelError: '', loadSenkaQuestOptions: async () => {},
  })
  const api = makeZi({ ...defaults, ...overrides }, options)
  const makeHost = () => {
    const host = new documentDom.Element('DIV')
    host.appendChild(new documentDom.Element('SPAN', '', { senkaMonth: '' })).textContent = '2026-10 月'
    host.appendChild(new documentDom.Element('DIV', 'sd-body')).innerHTML = form
    documentDom.document.body.appendChild(host)
    return host
  }
  return { api, html, timer, kernel, ...documentDom, queries, warnings, renders, pane, makeHost }
}

test('详情以 body 上的弹窗为闸门根；聚焦时保持原控件，失焦后保留未提交值、选单和滚动', async () => {
  const env = setup({}, { opening: true })
  env.api.openSenkaDetail()
  await settle()
  const host = env.api.state().senkaCalendarEl ?? env.document.body.children.at(-1)
  const body = host.querySelector('.sd-body')
  const input = body.querySelector('.sd-cal-input'), select = body.querySelector('.sd-qadd-pick')
  input.value = '1234'; input.setSelectionRange(1, 3); input.focus()
  select.value = '42'; body.scrollTop = 240
  const before = body.writes
  env.html.value = form + '<p>已更新</p>'
  env.api.renderSenkaDetailPassive()
  assert.equal(body.writes, before)
  assert.equal(env.document.activeElement, input)
  assert.equal(env.api.state().senkaDetailPending, true)
  env.document.activeElement = env.document.body
  host.emit('focusout')
  env.timer.advance(0)
  assert.equal(body.writes, before + 1)
  assert.equal(body.querySelector('.sd-cal-input').value, '1234')
  assert.equal(body.querySelector('.sd-qadd-pick').value, '42')
  assert.equal(body.scrollTop, 240)
})

test('详情按下期间不重建；pointerup 后 click 先送达，再补画', () => {
  const documentDom = dom(), host = new documentDom.Element('DIV')
  const body = host.appendChild(new documentDom.Element('DIV', 'sd-body'))
  body.innerHTML = form
  host.appendChild(new documentDom.Element('SPAN', '', { senkaMonth: '' })).textContent = '2026-10 月'
  const button = body.querySelector('button')
  const timer = clock()
  const env = setup({ documentDom, timer, interaction: { pressedTarget: button, pressedAt: timer.Date.now() } })
  env.api.setHost(host)
  let clicked = 0
  button.addEventListener('click', () => clicked++)
  const before = body.writes
  env.html.value = form + '<p>新记录</p>'
  env.api.renderSenkaDetailPassive()
  assert.equal(body.writes, before)
  env.kernel.releasePointer()
  button.emit('click')
  assert.equal(clicked, 1)
  assert.equal(body.writes, before)
  env.timer.advance(0)
  assert.equal(body.writes, before + 1)
})

test('详情 IME 组合结束后仍等待输入控件失焦，主动换块恢复值、焦点与选区', () => {
  const documentDom = dom(), host = new documentDom.Element('DIV')
  const body = host.appendChild(new documentDom.Element('DIV', 'sd-body'))
  body.innerHTML = form
  host.appendChild(new documentDom.Element('SPAN', '', { senkaMonth: '' })).textContent = '2026-10 月'
  const input = body.querySelector('.sd-cal-input')
  const env = setup({ documentDom, interaction: { composingIn: input } })
  env.api.setHost(host)
  input.value = '123'; input.setSelectionRange(1, 2); input.focus()
  body.scrollTop = 125
  const before = body.writes
  env.html.value = form + '<p>组合中更新</p>'
  env.api.renderSenkaDetailPassive()
  assert.equal(body.writes, before)
  env.kernel.endComposition()
  env.timer.advance(0)
  assert.equal(body.writes, before)
  assert.equal(env.api.state().senkaDetailPending, true)
  // 主动渲染也执行真 withViewStateKept；被动路径则继续等失焦。
  env.api.renderSenkaDetail()
  const restored = body.querySelector('.sd-cal-input')
  assert.equal(env.document.activeElement, restored)
  assert.equal(restored.value, '123')
  assert.deepEqual([restored.selectionStart, restored.selectionEnd], [1, 2])
  assert.equal(body.scrollTop, 125)
})

test('详情内容不变时正文与标题不换 DOM；关闭后积压回调不重画新弹窗', () => {
  const env = setup()
  const host = env.makeHost(), body = host.querySelector('.sd-body'), title = host.querySelector('[data-senka-month]')
  env.api.setHost(host)
  env.api.renderSenkaDetailPassive()
  const writes = [body.writes, title.writes]
  env.api.renderSenkaDetailPassive()
  assert.deepEqual([body.writes, title.writes], writes)
  env.api.closeSenkaDetail()
  env.api.renderSenkaDetailPassive()
  assert.deepEqual([body.writes, title.writes], writes)
})

test('打开加载一次历史，普通回港不重复解析；新排行版本和战果月界各再加载一次', async () => {
  let key = 'one', historyCalls = 0, normalCalls = 0
  const env = setup({ querySenkaRanking: async (_at, opts) => {
    if (opts?.history) { historyCalls++; return { ...ranking(key), history: [{ monthStart: 1, rewards: [] }] } }
    normalCalls++; return ranking(key)
  } })
  env.api.setHost(env.makeHost())
  await env.api.refreshSenkaDetail()
  assert.equal(historyCalls, 1)
  for (let i = 0; i < 4; i++) await env.api.refreshSenkaDetail()
  assert.equal(historyCalls, 1)
  assert.equal(normalCalls, 5)
  key = 'new-page'
  await env.api.refreshSenkaDetail()
  assert.equal(historyCalls, 2)
  key = 'new-month'
  await env.api.refreshSenkaDetail()
  assert.equal(historyCalls, 3)
})

test('历史与详情查询失败各落墓碑并保留旧数据；显式重试恢复', async () => {
  let failHistory = true, failSummary = false, historyCalls = 0, summaryCalls = 0
  const env = setup({
    senkaRanking: { ...ranking('one'), history: [{ monthStart: 1, rewards: [] }] },
    querySenka: async () => { summaryCalls++; if (failSummary) throw new Error('账本坏'); return summary(Date.now()) },
    querySenkaRanking: async (_at, opts) => {
      if (opts?.history) { historyCalls++; if (failHistory) throw new Error('历史坏'); return { ...ranking('one'), history: [] } }
      return ranking('one')
    },
  })
  env.api.setHost(env.makeHost())
  await env.api.refreshSenkaDetail()
  assert.ok(env.api.state().senkaHistoryFailedAt)
  assert.equal(env.api.state().senkaRanking.history.length, 1)
  await env.api.refreshSenkaDetail()
  assert.equal(historyCalls, 1)
  failSummary = true
  const old = env.api.state().senka
  await env.api.refreshSenkaDetail()
  const count = summaryCalls
  await env.api.refreshSenkaDetail()
  assert.equal(summaryCalls, count)
  assert.equal(env.api.state().senka, old)
  assert.ok(env.api.state().senkaDetailFailedAt)
  failSummary = false; failHistory = false
  await env.api.refreshSenkaDetail(true)
  assert.equal(env.api.state().senkaDetailFailedAt, 0)
})

test('排行 IPC 拒绝只显示排行失败，资源余额和建造材流水照常更新且短期不重复失败请求', async () => {
  let calls = 0
  const oldRanking = ranking('old')
  const env = setup({ senkaRanking: oldRanking, querySenkaRanking: async () => { calls++; throw new Error('排行解析坏') } }, { fullRefresh: true })
  await env.api.refresh()
  assert.equal(env.api.state().loadError, null)
  assert.equal(env.api.state().todayHistory[0].values[0], 88)
  assert.equal(env.api.state().itemFlow.get(2).gained, 5)
  assert.equal(env.api.state().senkaRanking, oldRanking)
  assert.ok(env.api.state().senkaRankingFailedAt)
  assert.equal(env.queries.filter(q => q.startsWith('materials:')).length, 2)
  assert.equal(env.queries.filter(q => q.startsWith('fastbuild:')).length, 1)
  await env.api.refresh()
  assert.equal(calls, 1)
})

test('日历打开失败仍有卡片和重试；同版本被动刷新不再查询', async () => {
  let fail = true, calls = 0
  const env = setup({ querySenkaCalendar: async () => { calls++; if (fail) throw new Error('日历坏'); return { month: '2026-10' } } })
  await env.api.toggleSenkaCalendar(new env.Element())
  const card = env.api.state().senkaCalendarEl
  assert.ok(card)
  assert.match(card.querySelector('.p-s').innerHTML, /读取失败/)
  assert.match(card.querySelector('.p-s').innerHTML, /重试/)
  await env.api.refreshSenkaCalendar()
  assert.equal(calls, 1)
  fail = false
  card.emit('click', { target: new env.Element('BUTTON', '', { calRetry: '' }) })
  await settle()
  assert.equal(calls, 2)
  assert.equal(env.api.state().senkaCalendarMonth, '2026-10')
  assert.doesNotMatch(card.querySelector('.p-s').innerHTML, /读取失败/)
})

test('日历翻月失败保持显示月份；再点上月仅查询前一个月，重试成功才推进状态', async () => {
  let fail = false
  const months = []
  const env = setup({ querySenkaCalendar: async month => {
    months.push(month); if (fail) throw new Error('翻月坏'); return { month: month ?? '2026-10' }
  } })
  await env.api.toggleSenkaCalendar(new env.Element())
  const card = env.api.state().senkaCalendarEl
  const prev = new env.Element('BUTTON', '', { calNav: '-1' })
  fail = true
  card.emit('click', { target: prev }); await settle()
  assert.equal(env.api.state().senkaCalendarMonth, '2026-10')
  assert.match(card.querySelector('.p-s').innerHTML, /2026-10/)
  card.emit('click', { target: prev }); await settle()
  assert.deepEqual(months, [undefined, '2026-09', '2026-09'])
  fail = false
  card.emit('click', { target: new env.Element('BUTTON', '', { calRetry: '' }) }); await settle()
  assert.equal(env.api.state().senkaCalendarMonth, '2026-09')
})

test('日历被动换块走卡片闸门，输入版本不变不重画也不重查', async () => {
  const env = setup()
  await env.api.toggleSenkaCalendar(new env.Element())
  const card = env.api.state().senkaCalendarEl, body = card.querySelector('.p-s')
  const before = body.writes, queries = env.queries.length
  await env.api.refreshSenkaCalendar()
  assert.equal(body.writes, before)
  assert.equal(env.queries.length, queries)
})

test('日历主动翻月在查询/提交期间不会被被动刷新覆盖；迟到的旧请求不改月份', async () => {
  const resolvers = []
  const env = setup({ querySenkaCalendar: month => new Promise(resolve => resolvers.push({ month, resolve })) })
  const opening = env.api.toggleSenkaCalendar(new env.Element())
  resolvers.shift().resolve({ month: '2026-10' }); await opening
  const card = env.api.state().senkaCalendarEl
  const prev = new env.Element('BUTTON', '', { calNav: '-1' })
  card.emit('click', { target: prev })
  await env.api.refreshSenkaCalendar()
  assert.equal(resolvers.length, 1)
  assert.equal(resolvers[0].month, '2026-09')
  card.emit('click', { target: prev })
  assert.equal(resolvers.length, 2)
  resolvers[1].resolve({ month: '2026-09' }); await settle()
  resolvers[0].resolve({ month: '2026-10' }); await settle()
  assert.equal(env.api.state().senkaCalendarMonth, '2026-09')
})

test('被动日历输出被按下闸门挡住时，月份状态也等提交成功才推进', async () => {
  const documentDom = dom(), held = new documentDom.Element('BUTTON')
  const timer = clock()
  const env = setup({ documentDom, timer, interaction: { pressedTarget: held, pressedAt: timer.Date.now() } })
  await env.api.toggleSenkaCalendar(new env.Element())
  const card = env.api.state().senkaCalendarEl
  card.appendChild(held)
  const before = card.querySelector('.p-s').writes
  await env.api.refreshSenkaCalendar('2026-09', true)
  assert.equal(env.api.state().senkaCalendarMonth, '2026-10')
  assert.equal(card.querySelector('.p-s').writes, before)
  await env.api.refreshSenkaCalendar()
  env.kernel.releasePointer(); timer.advance(0)
  assert.equal(env.api.state().senkaCalendarMonth, '2026-09')
  assert.equal(card.querySelector('.p-s').writes, before + 1)
})

test('basic 连续补丁只走三秒去抖刷新，不立即查询详情或全量历史', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/zi.ts', import.meta.url), 'utf8')
  const timer = clock(), calls = []
  let patch
  evaluate(cut(source, '    onMgChange((keys) => {', '    render(true)'), {
    ...timer, onMgChange: handler => { patch = handler },
    mg: { sortie: null }, previousSortie: null, queryTimer: null,
    sortieJustEnded: () => false, runPassiveRefresh: () => calls.push('refresh'),
    renderPassiveChange: () => calls.push('render'), scheduleShipsRender: () => calls.push('ships'),
    refreshSenkaDetail: () => calls.push('detail'), senkaDetailEl: {},
  }, '')
  for (let i = 0; i < 5; i++) patch(['basic'])
  assert.equal(calls.filter(c => c === 'detail').length, 0)
  assert.equal(calls.filter(c => c === 'refresh').length, 0)
  timer.advance(3000)
  assert.equal(calls.filter(c => c === 'refresh').length, 1)
})

test('详情生产视图把读取失败与暂无记录分开，并保留已有账内数字与排行', () => {
  for (const [ledgerFailure, rankFailure, historyFailure, text] of [
    [1, 0, 0, '战果账读取失败'], [0, 1, 0, '战果排行读取失败'], [0, 0, 1, '往月排行读取失败'],
  ]) {
    const { senkaDetailBodyHtml } = runtimeHost().extract('src/renderer/modules/zi.ts', ['senkaDetailBodyHtml'], {
      senka: summary(Date.now()), senkaDetailFailedAt: ledgerFailure,
      senkaRankingFailedAt: rankFailure, senkaHistoryFailedAt: historyFailure,
      senkaRanking: { ownRank: 101 }, senkaRankingHtml: view => `<p>排行第${view.ownRank}名</p>`,
      mg: { mapGauges: {} }, computeQuestMisses: () => [],
      EO_SENKA: {}, elink: () => '', questSenkaBlockHtml: () => '',
      eoSenkaLabelHtml: () => '', questSenkaLabelHtml: () => '',
      senkaRecountArmed: false, senkaRecountResult: null, esc: String,
      fmtDateTime: String, entityNamePlain: (_kind, _id, name) => name,
    }).api
    const html = senkaDetailBodyHtml()
    assert.ok(html.includes(text))
    assert.ok(html.includes('不是「没有记录」'))
    assert.ok(html.includes('重试'))
    assert.ok(html.includes('排行第101名'))
    assert.ok(html.includes('<b>100</b>'))
  }
})

test('补记选单读取失败保留已有选项，显示独立失败文案', async () => {
  const { loadSenkaQuestOptions, questSenkaBlockHtml } = runtimeHost().extract('src/renderer/modules/zi.ts',
    ['loadSenkaQuestOptions', 'questSenkaBlockHtml'], {
      senkaQuestOptions: [{ id: 42, code: 'X', name: '任务', senka: 100, taken: false }],
      senkaAddOpen: true, senkaAddError: '', senkaDelError: '', senkaDelArmId: 0,
      esc: String, questSenkaLabelHtml: String,
      querySenkaQuestOptions: async () => { throw new Error('选单坏') }, console: { warn() {} },
    }).api
  await loadSenkaQuestOptions()
  const html = questSenkaBlockHtml([], String)
  assert.ok(html.includes('<option value="42"'))
  assert.ok(html.includes('补记选单读取失败'))
})

test('JST 月末 22:00 即使资源面板隐藏也刷新详情标题和往月；JST 00:00 日历今天继续前进', async () => {
  const timer = clock(Date.parse('2026-10-31T12:59:59Z'))
  let historyCalls = 0, calendarCalls = 0
  const env = setup({ timer, querySenkaRanking: async (_at, opts) => {
    const month = senkaTime.senkaMonthLabel(senkaTime.senkaMonthStart(timer.Date.now()))
    return { ...ranking(month), ...(opts?.history ? { history: (++historyCalls, [{ monthStart: senkaTime.senkaMonthStart(Date.parse('2026-10-14T00:00:00Z')), rewards: [] }]) } : {}) }
  }, querySenkaCalendar: async month => { calendarCalls++; return { month: month ?? new timer.Date(timer.Date.now() + 9 * 3600_000).toISOString().slice(0, 7), today: new timer.Date(timer.Date.now() + 9 * 3600_000).toISOString().slice(0, 10) } },
    senkaCalendarHtml: model => `<div>${model.month} ${model.today}</div>` }, { fullRefresh: true })
  env.pane.classList.contains = () => false
  const host = env.makeHost()
  env.api.setHost(host)
  await env.api.refreshSenkaDetail()
  await env.api.toggleSenkaCalendar(new env.Element())
  env.api.scheduleSenkaRollover(timer.Date.now())
  assert.equal(timer.next(), Date.parse('2026-10-31T13:00:00.100Z'))
  timer.advance(1100); await settle()
  assert.equal(host.querySelector('[data-senka-month]').textContent, '2026-11 月')
  assert.equal(historyCalls, 2)
  assert.equal(env.api.state().senkaRanking.history.length, 1)
  assert.equal(timer.next(), Date.parse('2026-10-31T15:00:00.100Z'))
  timer.advance(2 * 3600_000); await settle()
  assert.equal(env.api.state().senkaCalendarMonth, '2026-11')
  assert.match(env.api.state().senkaCalendarEl.querySelector('.p-s').innerHTML, /2026-11-01/)
  assert.ok(calendarCalls >= 2)
})

test('战果视图边界纯函数按 JST 日界与月末 22 点，包括闰年二月', () => {
  for (const [from, to] of [
    ['2026-10-14T14:59:00Z', '2026-10-14T15:00:00Z'],
    ['2026-10-31T12:59:00Z', '2026-10-31T13:00:00Z'],
    ['2026-10-31T13:00:00Z', '2026-10-31T15:00:00Z'],
    ['2024-02-29T12:59:00Z', '2024-02-29T13:00:00Z'],
  ]) assert.equal(senkaTime.nextSenkaViewBoundary(Date.parse(from)), Date.parse(to))
})
