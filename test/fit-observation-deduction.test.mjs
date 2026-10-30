// 维护者裁决 2026-10-30：扣其它装备只派生显示，原始观察与配装事实才可落盘。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import * as observation from '../src/shared/fit-observation.ts'
import * as bonus from '../src/shared/fit-bonus.ts'

const { deductFitObservation, fitObservationDispositions, fitObservationKey, groupFitObservations, fitObservationRecordsOf } = observation
const total = { fire: 4, aa: 2, evasion: 3, los: 2 }
const expected = (stats = {}, lines = [], uncovered = []) => ({ stats, lines, uncovered, complete: !uncovered.length && lines.every((one) => one.state === 'counted') })
const line = (equipId, stats, state = 'counted') => ({ equipId, stats, state })
const sample = (deduction, overrides = {}) => ({ rosterId: 1, formId: 550, name: '萨拉托加', lv: 99, stars: [1], stats: total, soleCandidate: true, deduction, ...overrides })
const record = (equipMstId, stats, stars = [0], overrides = {}) => ({ key: fitObservationKey(equipMstId, 550, stars), equipMstId, formId: 550, stars, count: stars.length, stats, sole: true, seenAt: 1_700_000_000_000, ...overrides })
const names = { 543: 'SBD VS-2', 544: 'SBD VB-2', 589: 'XF6F-6', 600: '未知装备' }
const entry = (id, rules = []) => ({ id, rules })
const rule = (stats, need) => ({ row: 1, who: { forms: [550] }, gain: { kind: 'flat', flat: stats }, stack: 'perEquip', need })
const pack = (equips = {}) => ({ schemaVersion: 1, equipGroups: {}, equips: { 565: entry(565), ...equips }, unresolved: [] })

test('无条目优先实测补值，范围内无实测明确按零；不修改输入', () => {
  const disposition = [{ equipId: 544, kind: 'observed', stats: { fire: 1, evasion: 1 } }, { equipId: 543, kind: 'zero' }]
  const result = deductFitObservation(total, expected(), disposition)
  assert.deepEqual(result.stats, { fire: 3, aa: 2, evasion: 2, los: 2 })
  assert.equal(result.clean, true)
  assert.equal(result.changed, true)
  assert.deepEqual(result.details.map((one) => [one.equipId, one.source]), [[543, 'zero'], [544, 'observed']])
  assert.deepEqual(total, { fire: 4, aa: 2, evasion: 3, los: 2 })
  assert.deepEqual(disposition[0].stats, { fire: 1, evasion: 1 })
})

test('加成表合计逐项扣掉，逐件明细聚合规则行；只扣面板七项', () => {
  const result = deductFitObservation(total, expected({ fire: 2, accuracy: 3 }, [line(52, { fire: 1 }), line(52, { fire: 1, accuracy: 3 })]), [], [52, 136])
  assert.deepEqual(result.stats, { fire: 2, aa: 2, evasion: 3, los: 2 })
  assert.deepEqual(result.details, [{ equipId: 52, source: 'table', stats: { fire: 2 } }, { equipId: 136, source: 'table', stats: {} }])
})

test('扣除后的 title 只列非零扣减，保留按无加成计名单及完整 details', () => {
  // 维护者裁决 2026-10-30：表内与实测的零扣减都不列为「扣除」。
  const deduction = deductFitObservation(total,
    expected({ aa: -1 }, [line(10, { aa: -1 }), line(52, {}), line(136, { fire: 0 })]),
    [{ equipId: 544, kind: 'observed', stats: { fire: 1, evasion: 1 } },
      { equipId: 543, kind: 'zero' }, { equipId: 600, kind: 'observed', stats: { fire: 0 } }])
  const details = structuredClone(deduction.details)
  const equipNames = { 10: '表内非零装备', 52: '流星改', 136: '水中防御隔壁', 543: 'SBD VS-2', 544: 'SBD VB-2', 600: '零实测装备' }
  const presentation = observation.fitObservationPresentation(total, false, false, deduction,
    (id) => equipNames[id], bonus.fitStatsText)
  assert.equal(presentation.label, '扣除其它装备后')
  assert.equal(presentation.title,
    '合计 火力+4 对空+2 回避+3 索敌+2；扣除 表内非零装备：对空-1（加成表）；扣除 SBD VB-2：火力+1 回避+1（实测）；SBD VS-2 加成表无记录，按无加成计')
  assert.deepEqual(presentation.stats, { fire: 3, aa: 3, evasion: 2, los: 2 })
  assert.deepEqual(deduction.details, details)
  assert.equal(deduction.details.length, 6)
})

test('范围外缺资料、pending、area 都不能扣干净；列出卡住的装备', () => {
  assert.deepEqual(deductFitObservation(total, expected({}, [], [600]), [{ equipId: 600, kind: 'missing' }]).blocked, [600])
  for (const state of ['pending', 'area']) {
    const result = deductFitObservation(total, expected({}, [line(544, {}, state)]), [])
    assert.equal(result.clean, false)
    assert.deepEqual(result.blocked, [544])
  }
  assert.equal(deductFitObservation(total, { ...expected(), complete: false }, []).clean, false)
  assert.equal(deductFitObservation(total, expected({}, [], [600]), [{ equipId: 600, kind: 'observed', stats: { fire: 1 } }]).clean, true)
})

test('实测补值严格匹配形态、★多重集、件数且仅认 sole；表内条目优先', () => {
  const items = [{ mstId: 544, star: 2 }, { mstId: 544, star: 0 }]
  const valid = record(544, { fire: 3 }, [0, 2])
  const map = new Map([[valid.key, valid]])
  const find = (formId = 550, equipment = items, hasEntry = () => false) => fitObservationDispositions(formId, equipment, map, hasEntry, () => false)
  assert.equal(find()[0].kind, 'observed')
  assert.equal(find(551)[0].kind, 'zero')
  assert.equal(find(550, [items[0]])[0].kind, 'zero')
  assert.equal(find(550, [{ mstId: 544, star: 2 }, { mstId: 544, star: 2 }])[0].kind, 'zero')
  assert.equal(find(550, [{ mstId: 543, star: 2 }])[0].kind, 'zero')
  assert.deepEqual(find(550, items, () => true), [])
  valid.sole = false
  assert.equal(find()[0].kind, 'zero')
  valid.sole = true
  valid.count = 1
  assert.equal(find()[0].kind, 'zero')
})

test('相同合计但扣减不同不合并；实测非零取消 sole；混★不扣，同★多件仍扣', () => {
  const a = deductFitObservation(total, expected(), [{ equipId: 544, kind: 'observed', stats: { fire: 1 } }])
  const b = deductFitObservation(total, expected(), [{ equipId: 544, kind: 'observed', stats: { fire: 2 } }])
  assert.equal(groupFitObservations([sample(a), sample(b, { rosterId: 2 })]).length, 2)
  const rows = groupFitObservations([sample(a, { stars: [1, 1] })])
  assert.equal(rows[0].sole, false)
  assert.equal(rows[0].count, 2)
  const [mixed] = groupFitObservations([sample(a, { stars: [0, 1] })])
  assert.equal(mixed.deduction, undefined)
  assert.equal(mixed.sole, false)
  const zero = deductFitObservation(total, expected(), [{ equipId: 544, kind: 'zero' }])
  assert.equal(groupFitObservations([sample(zero)])[0].sole, true)
  assert.equal(groupFitObservations([sample(zero), sample(deductFitObservation(total, expected(), [{ equipId: 543, kind: 'zero' }]), { rosterId: 2 })]).length, 2)
  const cancelling = deductFitObservation(total, expected({ fire: -1 }, [line(52, { fire: -1 })]), [{ equipId: 544, kind: 'observed', stats: { fire: 1 } }])
  assert.equal(cancelling.changed, false)
  assert.equal(groupFitObservations([sample(cancelling)])[0].sole, false)
})

test('合并后仍逐舰保留排序配装；落盘是合计和事实，没有扣减结果', () => {
  const deduction = deductFitObservation(total, expected({ fire: 2 }), [])
  const rows = groupFitObservations([
    sample(deduction, { otherEquips: [{ mstId: 544, star: 2 }, { mstId: 543, star: 0 }, { mstId: 544, star: 0 }] }),
    sample(deduction, { rosterId: 2, otherEquips: [] }),
  ])
  assert.equal(rows.length, 1)
  const saved = fitObservationRecordsOf(589, rows, Date.now())
  assert.deepEqual(saved[0].otherEquips, [{ mstId: 543, star: 0 }, { mstId: 544, star: 0 }, { mstId: 544, star: 2 }])
  assert.deepEqual(saved[1].otherEquips, [])
  assert.deepEqual(saved[0].stats, total)
  assert.equal('deduction' in saved[0], false)
})

// 执行 ji.ts 的真实函数体，用替身替换 Electron/DOM 边界；不以源码文本断言行为。
const source = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const cut = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}
const functions = cut('const equipObservedRows =', '// ---- 实测观察的落盘与回看 ----') + cut('const FIT_OBS_TTL_MS =', 'const equipFitHtml =')
const harness = (options = {}) => {
  const fixture = { carriers: [], calls: [], warnings: [], sends: [], data: pack(), ...options }
  const deps = {
    ...bonus, ...observation,
    fitLode: { data: fixture.data },
    mg: { master: { slotitems: {} } },
    fitGroupState: () => 'unknown',
    fitShipView: (formId) => ({ formId, ctype: 1, stype: 11 }),
    fitLoadoutOf: (ship) => ship.equips.map((one) => ({ mstId: one.mstId, star: one.level ?? 0 })),
    equipCarrierIndex: () => new Map([[589, fixture.carriers]]),
    shipEquipInstances: (ship) => ship.equips,
    panelBonusOf: () => ({ any: true, stats: total, rows: Object.entries(total).map(([key, observed]) => ({ key, observed })) }),
    masterShipName: () => '萨拉托加',
    cfEquipName: (id) => names[id] ?? `装备 #${id}`,
    esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    elink: (_kind, id, name) => `<a data-id="${id}">${name}</a>`,
    fmtDate: () => '2026-10-30',
    scheduleRender: () => {},
    jiIpc: {
      invoke: (...args) => { fixture.calls.push(args); return fixture.invoke ? fixture.invoke(...args) : Promise.resolve([]) },
      send: (...args) => fixture.sends.push(args),
    },
    console: { warn: (...args) => fixture.warnings.push(args) },
  }
  const code = transformSync(`const { ${Object.keys(deps).join(',')} } = deps;\n${functions}\nreturn {
    equipObservedRows, fitObsRowHtml, fitObsHistoryHtml, persistFitObservations, ensureFitSoleObservations,
    fitObsSoleCache, fitObsHistoryDeduction,
    setSole: (records) => { fitObsSoleByKey = new Map(records.map((one) => [one.key, one])) },
    setHistory: (rows) => fitObsCache.set(589, { rows, ts: Date.now(), failed: false, loading: false }),
  }`, { loader: 'ts' }).code
  return { ...new Function('deps', code)(deps), fixture }
}
const ship = (id = 1, equips = [{ mstId: 589, level: 1 }, { mstId: 544, level: 0 }, { mstId: 543, level: 0 }]) => ({ id, shipId: 550, lv: 99, equips })

test('实时 HTML：扣除后显示净值与唯一新增标签，title 包含合计、实测和零假设', () => {
  const h = harness({ carriers: [ship()] })
  h.setSole([record(544, { fire: 1, evasion: 1 })])
  const [row] = h.equipObservedRows(589)
  const html = h.fitObsRowHtml(row)
  assert.match(html, />扣除其它装备后<\/span>/)
  assert.match(html, /火力 <b>\+3<\/b>/)
  assert.match(html, /回避 <b>\+2<\/b>/)
  assert.match(html, /title="合计 火力\+4 对空\+2 回避\+3 索敌\+2；扣除 SBD VB-2：火力\+1 回避\+1（实测）；SBD VS-2 加成表无记录，按无加成计"/)
  assert.doesNotMatch(html.replace(/title="[^"]*"/g, ''), /合计 火力|扣除 SBD|按无加成计|差值就是/)
  assert.equal(row.sole, false)
})

test('实时 HTML：扣不干净保留合计；全零扣减列出无条目名单；混★原样', () => {
  const missing = harness({ carriers: [ship(1, [{ mstId: 589, level: 1 }, { mstId: 600, level: 0 }])] })
  const html = missing.fitObsRowHtml(missing.equipObservedRows(589)[0])
  assert.match(html, /title="未知装备没有完整加成资料，扣不干净">整条配装合计/)
  assert.match(html, /火力 <b>\+4<\/b>/)
  const zero = harness({ carriers: [ship()] })
  const htmlZero = zero.fitObsRowHtml(zero.equipObservedRows(589)[0])
  assert.match(htmlZero, /SBD VS-2、SBD VB-2 加成表无记录，按无加成计">只有这一件/)
  assert.doesNotMatch(htmlZero.replace(/title="[^"]*"/g, ''), /按无加成计|差值就是/)
  const mixed = harness({ carriers: [ship(1, [{ mstId: 589, level: 1 }, { mstId: 589, level: 0 }, { mstId: 544, level: 0 }])] })
  mixed.setSole([record(544, { fire: 1 })])
  const mixedHtml = mixed.fitObsRowHtml(mixed.equipObservedRows(589)[0])
  assert.match(mixedHtml, /混★ · 不可直读/)
  assert.match(mixedHtml, /火力 <b>\+4<\/b>/)
  assert.doesNotMatch(mixedHtml, /扣除其它装备后/)
})

test('其它装备一起求值，条件互相可见；本件参与的协同留在净值里', () => {
  const data = pack({ 544: entry(544, [rule({ fire: 1 }, { with: [{ any: [543] }] }), rule({ fire: 2 }, { with: [{ any: [589] }] })]) })
  const h = harness({ carriers: [ship()], data })
  h.setSole([record(544, { fire: 99 })])
  const [row] = h.equipObservedRows(589)
  assert.equal(row.deduction.stats.fire, 3)
  assert.equal(row.verdict, 'unknown') // 本件 589 超出表的覆盖范围，扣减不改变整条配装的比对。
  assert.match(h.fitObsRowHtml(row), /SBD VB-2：火力\+1（加成表）/)
})

test('同★多件格子显示合计贡献，不按件数摊平；pending 与 area 保留合计并点名', () => {
  const h = harness({ carriers: [ship(1, [{ mstId: 589, level: 1 }, { mstId: 589, level: 1 }, { mstId: 544, level: 0 }])] })
  h.setSole([record(544, { fire: 1 })])
  const html = h.fitObsRowHtml(h.equipObservedRows(589)[0])
  assert.match(html, /2 件/)
  assert.match(html, /火力 <b>\+3<\/b>/)
  assert.match(html, />扣除其它装备后<\/span>/)
  const pending = harness({ carriers: [ship()], data: pack({ 544: entry(544, [rule({ fire: 1 }, { with: [{ group: 'unknown' }] })]) }) })
  assert.match(pending.fitObsRowHtml(pending.equipObservedRows(589)[0]), /SBD VB-2没有完整加成资料，扣不干净">整条配装合计/)
  const areaRule = { ...rule({}), gain: { kind: 'byArea', areas: [{ area: '3', stats: { fire: 1 } }] } }
  const area = harness({ carriers: [ship()], data: pack({ 544: entry(544, [areaRule]) }) })
  assert.match(area.fitObsRowHtml(area.equipObservedRows(589)[0]), /SBD VB-2没有完整加成资料，扣不干净">整条配装合计/)
})

test('历史有配装快照按当前表与实测重算；NULL 旧行照旧，不以净值覆写合计', () => {
  const h = harness()
  const past = record(589, total, [1], { sole: false, otherEquips: [{ mstId: 544, star: 0 }, { mstId: 543, star: 0 }] })
  h.setHistory([past])
  h.setSole([record(544, { fire: 1 })])
  const html = h.fitObsHistoryHtml(589, new Set())
  assert.match(html, /扣除其它装备后/)
  assert.match(html, /class="fb-obs-k"[^>]*>扣除其它装备后<\/span>/)
  assert.match(html, /火力 <b>\+3<\/b>/)
  h.setSole([record(544, { fire: 2 })])
  assert.match(h.fitObsHistoryHtml(589, new Set()), /火力 <b>\+2<\/b>/)
  h.fixture.data.equips[544] = entry(544, [rule({ fire: 3 })])
  assert.match(h.fitObsHistoryHtml(589, new Set()), /火力 <b>\+1<\/b>/)
  assert.deepEqual(past.stats, total)
  past.otherEquips = null
  const legacy = h.fitObsHistoryHtml(589, new Set())
  assert.match(legacy, /整条配装合计/)
  assert.match(legacy, /火力 <b>\+4<\/b>/)
  assert.doesNotMatch(legacy, /扣除其它装备后|加成表无记录/)
})

test('历史同样展示缺资料、按零假设和混★，空配装快照可重算，NULL 不重算', () => {
  const h = harness()
  const past = record(589, total, [1], { sole: false, otherEquips: [{ mstId: 600, star: 0 }] })
  h.setHistory([past])
  assert.match(h.fitObsHistoryHtml(589, new Set()), /未知装备没有完整加成资料，扣不干净/)
  assert.match(h.fitObsHistoryHtml(589, new Set()), /火力 <b>\+4<\/b>/)
  past.otherEquips = [{ mstId: 544, star: 0 }]
  assert.match(h.fitObsHistoryHtml(589, new Set()), /SBD VB-2 加成表无记录，按无加成计/)
  assert.match(h.fitObsHistoryHtml(589, new Set()), />只有这一件<\/span>/)
  past.otherEquips = []
  assert.match(h.fitObsHistoryHtml(589, new Set()), />只有这一件<\/span>/)
  past.stars = [0, 1]
  past.otherEquips = [{ mstId: 544, star: 0 }]
  h.setSole([record(544, { fire: 1 })])
  assert.match(h.fitObsHistoryHtml(589, new Set()), /混★ · 不可直读/)
  assert.match(h.fitObsHistoryHtml(589, new Set()), /火力 <b>\+4<\/b>/)
  past.otherEquips = null
  assert.doesNotMatch(h.fitObsHistoryHtml(589, new Set()), /混★ · 不可直读|扣除其它装备后/)
})

test('实时先截 24 艘、历史先截 12 条；配装快照进入发送签名', () => {
  const h = harness({ carriers: Array.from({ length: 60 }, (_, i) => ship(i + 1)) })
  let rows = h.equipObservedRows(589)
  assert.equal(rows.reduce((sum, one) => sum + one.ships.length, 0), 24)
  h.persistFitObservations(589, rows)
  h.persistFitObservations(589, rows)
  assert.equal(h.fixture.sends.length, 1)
  assert.deepEqual(h.fixture.sends[0][1][0].stats, total)
  h.fixture.carriers[0].equips.push({ mstId: 136, level: 0 })
  rows = h.equipObservedRows(589)
  h.persistFitObservations(589, rows)
  assert.equal(h.fixture.sends.length, 2)
  h.setHistory(Array.from({ length: 20 }, (_, i) => record(589, total, [i % 10], { formId: 550 + i, otherEquips: [] })))
  assert.equal((h.fitObsHistoryHtml(589, new Set()).match(/class="fb-obs"/g) ?? []).length, 12)
})

test('全部 sole 一次 IPC、TTL 内不重复；失败按无实测处理并从现有错误口上报', async () => {
  let fail = false
  const h = harness({ carriers: [ship()], invoke: () => fail ? Promise.reject(new Error('test')) : Promise.resolve([record(544, { fire: 1 })]) })
  h.ensureFitSoleObservations()
  h.ensureFitSoleObservations()
  await new Promise(setImmediate)
  assert.deepEqual(h.fixture.calls, [['mg:fit-observations-sole']])
  assert.equal(h.equipObservedRows(589)[0].deduction.stats.fire, 3)
  h.ensureFitSoleObservations()
  assert.equal(h.fixture.calls.length, 1)
  fail = true
  h.fitObsSoleCache.ts = Date.now() - 60_001
  h.ensureFitSoleObservations()
  await new Promise(setImmediate)
  assert.equal(h.equipObservedRows(589)[0].sole, true)
  assert.equal(h.fixture.warnings.length, 1)
  assert.equal(h.fitObsSoleCache.failed, true)
  h.ensureFitSoleObservations()
  assert.equal(h.fixture.calls.length, 2)
})
