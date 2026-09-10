import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import periods from '../dist/shared/quest-period.js'
import qpTypes from '../dist/shared/qp-types.js'

const { questSameDayClause, questCodeFamily, questPeriodFromCode, questPeriodKey, questPeriodEnd } = periods
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')
const qn = read('../src/renderer/modules/qn.ts')
const ru = read('../src/renderer/modules/ru.ts')
const counter = read('../src/main/mg/quest-counter.ts')
const flaggedCodes = 'WC01 C5 C6 C7 Cm1 C9 Cs3 C13 C17 C18 C20 C21 C22 C23 Cs5 C25 C27 Cq1 C31 C32 C33 C34 C35 C37 Cq2 C39 Cq3'.split(' ')
const textOnlySamples = {
  C46: '使用该演习舰队在一日内达成4次以上【A胜】！',
  C51: '在同一日内在演习达成4次以上【S胜】！',
  C68: '于本日演习中达成4回以上的【S胜利】！',
  C70: '当日获得【S胜利】5次以上！',
  C73: '在本日的演习中取得“S判定”胜利4次以上！',
  C77: '在本日内取得演习【S判定】胜利5次以上！',
  '2606Cm1': '于本日内在演习中达成【A判定】胜利3次以上！',
  '2606Cw1': '于本日内在演习中达成【A判定】胜利3次以上！',
}

test('当日措辞覆盖八条正文样本与指定词组，不把无关描述当成当日要求', () => {
  for (const [code, text] of Object.entries(textOnlySamples)) {
    assert.equal(questCodeFamily(code), 'C')
    assert.equal(questSameDayClause(text), true, code)
  }
  for (const clause of ['一日内', '当日', '本日', '本日中', '同一天', '一天内', '今天内', '今天的', '一日演习']) {
    assert.equal(questSameDayClause(clause), true, clause)
  }
  for (const text of ['', '演习胜利四次', '每日更新对手', '一个任务周期内取得胜利']) {
    assert.equal(questSameDayClause(text), false, text)
  }
})

test('随包两份来源分别覆盖 27 条标记和 42 条正文，取并集 48 条', () => {
  const quests = JSON.parse(read('../assets/lodes/quests-scn.json')).data
  const reqs = JSON.parse(read('../assets/lodes/kcwiki-quest-req.json')).data
  const flagged = Object.keys(reqs).filter((id) => reqs[id].daily === true)
  const text = Object.keys(quests).filter((id) => questCodeFamily(quests[id].code) === 'C' &&
    questSameDayClause(`${quests[id].desc ?? ''}｜${quests[id].memo2 ?? ''}`))
  assert.deepEqual(flagged.map((id) => quests[id].code), flaggedCodes)
  assert.equal(text.length, 42)
  assert.equal(new Set([...flagged, ...text]).size, 48)
  assert.equal(text.filter((id) => !flagged.includes(id)).length, 21)
  for (const code of Object.keys(textOnlySamples)) {
    assert.ok(text.some((id) => quests[id].code === code), code)
    assert.ok(!flagged.some((id) => quests[id].code === code), code)
  }
})

test('Cq1 的任务周期在同季跨日仍为季，进度日键在 05:00 JST 切换', () => {
  const before = Date.parse('2026-09-07T19:59:59.999Z')
  const after = before + 1
  const period = questPeriodFromCode('Cq1')
  assert.equal(period, 'quarterly')
  assert.equal(questPeriodKey(period, before), questPeriodKey(period, after))
  assert.notEqual(questPeriodKey('daily', before), questPeriodKey('daily', after))
})

// 这两条只守接线：periodOf 是引擎闭包，renderer 是依赖 Electron/DOM 的整包，
// 无独立导出。行为另由真实引擎夹具及下方转译的原函数测试，文本断言不代替行为证明。
test('源码接线：sameDay 优先于游戏 type，编成待调整读取本队 diffs', () => {
  const body = counter.slice(counter.indexOf('  const periodOf ='), counter.indexOf('  const sameQuestPeriod ='))
  assert.ok(body.indexOf("if (tracker.sameDay) return 'daily'") < body.indexOf('const type ='))
  assert.match(body, /if \(tracker\.sameDay\) return 'daily'/)
  const fleet = ru.slice(ru.indexOf('const fleetQuestHtml ='), ru.indexOf('const scheduleFleetQuestCheck ='))
  assert.match(fleet, /编成待调整/)
  assert.match(fleet, /check\.diffs/)
  assert.match(fleet, /deckIds\.includes\(diff\.deckId\)/)
  assert.match(qn.slice(qn.indexOf('const rowHtml ='), qn.indexOf('const SYSTEM_BY_CATEGORY')), /sameDayResetHtml\(row\)/)
  assert.match(qn.slice(qn.indexOf('const detailHtml =')), /annualResetHtml\(row\) \+ sameDayResetHtml\(row\)/)
})

// 转译源码中的原函数，注入外部状态；只隔离 DOM/Electron，不复刻渲染逻辑。
// ru 整包依赖 DOM 且 fleetQuestHtml 没有独立导出，接线只能做源码文本断言；
// 下方原函数转译夹具另验两组的显示/隐藏行为，文本守卫本身不证明浏览器布局。
test('编队两组任务名之后都接近似标记和编成专用说明', () => {
  const fleet = ru.slice(ru.indexOf('const fleetQuestHtml ='), ru.indexOf('const scheduleFleetQuestCheck ='))
  for (const body of [
    fleet.slice(fleet.indexOf('const matchedHtml ='), fleet.indexOf('const nearShown =')),
    fleet.slice(fleet.indexOf('const nearHtml ='), fleet.indexOf('return `<div class="fleet-quests">${matchedHtml}')),
  ]) {
    assert.match(body, /elink\('quest'/)
    assert.match(body, /fleetQuestCheck\[id\]\.approx \? '<span class="approx" title="编成判定含拿不准的项，可能比游戏松">≈<\/span>' : ''/)
  }
})

const compile = (source, start, end, name, deps) => {
  const js = transformSync(`${source.slice(source.indexOf(start), source.indexOf(end))}\nreturn ${name}`, { loader: 'ts' }).code
  return new Function(...Object.keys(deps), js)(...Object.values(deps))
}
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

test('当日提示复用日任倒计时，解释只放 title；季任务有本地进度才按日提前量入筛选', () => {
  const now = Date.parse('2026-09-07T19:00:00Z')
  const qp = { trackers: { 1: { sameDay: true }, 2: { sameDay: false } }, progress: { 1: [3] } }
  const nextReset = (kind) => questPeriodEnd(kind, now)
  const render = compile(qn, 'const sameDayResetHtml =', 'const annualResetHtml =', 'sameDayResetHtml', {
    qp, nextReset, fmtDurationLong: (ts) => `${(ts - now) / 3600000}小时`,
  })
  assert.match(render({ id: 1 }), /当日内完成 · 05:00 重置/)
  assert.match(render({ id: 1 }), /data-same-day-reset data-cdl="1788811200000">1小时/)
  assert.match(render({ id: 1 }), /title="[^"]*清零本地计数[^"]*"/)
  assert.doesNotMatch(render({ id: 1 }).replace(/title="[^"]*"/, ''), /清零本地计数/)
  assert.equal(render({ id: 2 }), '')
  const filters = compile(qn, 'const RESET_SOON:', '// qp 与编成判定', 'QUICK_FILTERS', {
    qp, nextReset, Date: { now: () => now }, isObservedActive: (r) => r.active,
    periodOfRow: () => ['季'], questAnnualMonth: () => null,
  })
  assert.equal(filters.resetSoon.test({ id: 1, active: true }), true)
  qp.progress[1] = [0]
  assert.equal(filters.resetSoon.test({ id: 1, active: true }), false)
  qp.progress[1] = [3]
  assert.equal(filters.resetSoon.test({ id: 1, active: false }), false)
})

test('编队分组只收本队遂行中 nearMiss，链接 title 列出全部失败，限四条并保留失败标', () => {
  const line = (kind, issue, ok = false) => ({ kind, issue, ok })
  const diff = (deckId, lines) => ({ deckId, lines, ok: lines.every((l) => l.ok) })
  const fleetQuestCheck = {
    1: { hasCond: true, decks: [1], diffs: [diff(1, [])] },
    2: { hasCond: true, decks: [], diffs: [diff(1, [line('flagship', '旗舰不符合「轻巡」'), line('fleet', '仅限第2舰队')])] },
    3: { hasCond: true, decks: [], diffs: [diff(2, [line('position', '2号位不符合「驱逐」')])] },
    4: { hasCond: true, decks: [], diffs: [diff(1, [line('count', '还差 1 艘')])] },
    5: { hasCond: true, decks: [], diffs: [diff(1, [line('flagship', '未领取')])] },
    6: { hasCond: true, decks: [] },
  }
  const mg = { quests: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i, { state: i === 5 ? 1 : 2 }])) }
  const deps = {
    fleetQuestCheck, mg, inCombined: (deck) => deck.combined,
    classifyFleetDiff: qpTypes.classifyFleetDiff, fleetQuestFailed: false, esc,
    questName: (id) => `任务${id}`,
    elink: (type, id, text, ctx, attrs) => `<a data-id="${id}"${attrs ? ` title="${esc(attrs.title)}"` : ''}>${text}</a>`,
  }
  const render = (deck, failed = false) => compile(ru, 'const fleetQuestHtml =', 'const scheduleFleetQuestCheck =', 'fleetQuestHtml', { ...deps, fleetQuestFailed: failed })(deck)
  const html = render({ id: 1 })
  assert.equal((html.match(/class="fleet-quests"/g) ?? []).length, 1)
  assert.equal((html.match(/class="fq-group"/g) ?? []).length, 2)
  assert.ok(html.indexOf('满足编成条件') < html.indexOf('编成待调整'))
  const failedHtml = render({ id: 1 }, true)
  assert.equal((failedHtml.match(/class="fleet-quests"/g) ?? []).length, 1)
  assert.equal((failedHtml.match(/class="fq-group"/g) ?? []).length, 3)
  assert.ok(failedHtml.indexOf('满足编成条件') < failedHtml.indexOf('编成待调整'))
  assert.match(failedHtml, /编成待调整[\s\S]*<span class="fq-group"><span class="more" title="[^"]*">编成任务读取失败 · 上次读取结果 · 返港后重试<\/span><\/span><\/div>$/)
  assert.match(html, /title="旗舰不符合「轻巡」\n仅限第2舰队"/)
  assert.doesNotMatch(html, /class="approx"/)
  fleetQuestCheck[1].approx = true
  fleetQuestCheck[2].approx = true
  const approximateHtml = render({ id: 1 })
  for (const id of [1, 2]) {
    assert.match(approximateHtml, new RegExp(`任务${id}</a><span class="approx" title="编成判定含拿不准的项，可能比游戏松">≈</span>`))
  }
  fleetQuestCheck[1].approx = false
  fleetQuestCheck[2].approx = false
  assert.doesNotMatch(render({ id: 1 }), /class="approx"/)
  for (const id of [3, 4, 5, 6]) assert.doesNotMatch(html, new RegExp(`data-id="${id}"`))
  assert.match(render({ id: 1, combined: true }), /data-id="3"/)
  for (const id of [7, 8, 9, 10]) fleetQuestCheck[id] = fleetQuestCheck[2]
  assert.match(render({ id: 1 }), /另 1 项/)
  assert.doesNotMatch(render({ id: 1 }), /data-id="10"/)
  assert.equal(render({ id: 4 }), '')
  const failedOnlyHtml = render({ id: 4 }, true)
  assert.equal((failedOnlyHtml.match(/class="fleet-quests"/g) ?? []).length, 1)
  assert.doesNotMatch(failedOnlyHtml, /class="fq-group"/)
  assert.match(failedOnlyHtml, /^<div class="fleet-quests"><span class="more" title="[^"]*">编成任务读取失败 · 返港后重试<\/span><\/div>$/)
  delete fleetQuestCheck[1]
  assert.match(render({ id: 1 }, true), /编成待调整[\s\S]*上次读取结果/)
})
