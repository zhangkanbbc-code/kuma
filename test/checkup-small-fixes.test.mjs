import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import { clock, dom, makeKernel } from './fixtures/zi-refresh-runtime.mjs'

const read = file => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const evaluate = (source, scope) => new Function(...Object.keys(scope), transformSync(source, { loader: 'ts' }).code)(...Object.values(scope))
const cut = (source, from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `生产段落已移动：${from}`)
  return source.slice(start, end)
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const jst = value => Date.parse(`${value}+09:00`)
const host = runtimeHost()
const { fmtJstDate, jstDayStart, jstHourOf } = host.load('src/shared/jst-day.ts')
const { localDayOf } = host.load('src/shared/local-calendar.ts')

test('限定目录默认日期在 JST 零点收窗，常驻掉落保留；不跟本机时区走', () => {
  const { applyMapIntelCatalog, mapIntelNode, nodeDropCatalog, confirmedDropSitesOf, endedDropSitesOf } = host.load('src/shared/map-intel.ts')
  applyMapIntelCatalog({ schemaVersion: 1, maps: { '9-1': { nodes: { A: { emptyDrop: 'unknown', ships: [
    { id: 700 }, { id: 701, limitedOnly: true, limited: { from: '2026-10-01', until: '2026-10-14' } },
  ] } } } } })
  const originalNow = Date.now, OriginalDate = globalThis.Date, timezone = process.env.TZ
  try {
    let now = jst('2026-10-14T23:59:59.999')
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [now])) }
      static now() { return now }
    }
    for (const tz of ['Asia/Shanghai', 'UTC', 'America/New_York']) {
      process.env.TZ = tz
      now = jst('2026-10-14T23:59:59.999')
      assert.equal(confirmedDropSitesOf(701).length, 1)
      now = jst('2026-10-15T00:00:00')
      assert.deepEqual(mapIntelNode('9-1', 'A').ships.map(ship => ship.id), [700])
      assert.deepEqual(nodeDropCatalog('9-1', 'A').ships.map(ship => ship.id), [700])
      assert.equal(confirmedDropSitesOf(701).length, 0)
      assert.equal(endedDropSitesOf(701).length, 1)
      assert.equal(confirmedDropSitesOf(700).length, 1)
    }
  } finally {
    globalThis.Date = OriginalDate
    Date.now = originalNow
    if (timezone == null) delete process.env.TZ
    else process.env.TZ = timezone
  }
})

test('捞船规划剩余天数及本地掉落往期归属在 JST 零点前进', () => {
  const Date = class extends globalThis.Date { static now() { return jst('2026-10-15T00:30:00') } }
  // 执行生产视图，而不是另写日期判定。
  const plan = host.extract('src/renderer/modules/ji.ts', ['huntPlanHtml'], {
    Date, fmtJstDate, fmtDate: () => '2026-10-14', chainOf: new Map([[701, []]]), chainInstances: () => [],
    eventStillRunning: () => true, confirmedDropSitesOf: () => [{ map: '1-1', nodes: ['A'], limitedUntil: '2026-10-16', limited: true }],
    masterShipName: () => '测试舰', shipThumbHtml: () => '', elink: () => '', esc: String,
    isFavoriteShipRoot: () => false, shipState: { huntFilter: '' },
    shipNationOf: () => '', shipTypeName: () => '', mst: null,
  }).api.huntPlanHtml
  assert.match(plan(), /1 天/)
  const local = host.extract('src/renderer/modules/ji.ts', ['localDropPoolHtml'], {
    Date, fmtJstDate, fmtDate: () => '2026-10-14',
    mapChronicle: new Map([[1, { localDrops: { battles: 2, ships: [
      { mstId: 701, lastTs: jst('2026-10-14T23:45:00'), cells: [], count: 1 },
      { mstId: 702, lastTs: jst('2026-10-15T00:15:00'), cells: [], count: 1 },
    ] } }]]),
    fcdMapLode: null, limitedWindowsOf: () => [{ window: { from: '2026-10-01', until: '2026-10-14' } }],
    masterShipName: () => '测试舰', shipThumbHtml: () => '', lodeCreditMark: () => '', mapDropWindowsLode: null,
    localDropCellsText: () => '', esc: String, elink: () => '', foldedNote: (title, body) => title + body,
  }).api.localDropPoolHtml
  assert.match(local('1-1', 1, new Set()), /往期/)
  assert.match(local('1-1', 1, new Set()), /限定期捞到 · 窗口已结束/)
  assert.match(local('1-1', 1, new Set()), /往期 <b>1<\/b>/, '收窗后新捞到的不能按本机前一天误算进窗口')
})

test('完整备份对话框默认文件名与 CSV 同属本机日，东八区凌晨不退到 UTC 前一天', async () => {
  const source = cut(read('main/yu.ts'), "ipcMain.handle('yu:backup-ledger'", "ipcMain.handle('yu:restore-ledger'")
  const timezone = process.env.TZ
  let run, picked
  try {
    process.env.TZ = 'Asia/Shanghai'
    const at = new globalThis.Date('2026-10-14T16:30:00Z')
    const Date = class extends globalThis.Date { constructor(...args) { super(...(args.length ? args : [at.getTime()])) } static now() { return at.getTime() } }
    evaluate(source, {
      Date, localDayOf, path: { join: (...args) => args.join('/') }, app: { getPath: () => '/documents' },
      ipcMain: { handle: (_channel, fn) => { run = fn } },
      dialog: { showSaveDialog: async options => { picked = options; return { canceled: true } } },
    })
    assert.deepEqual(await run(), { ok: false, canceled: true })
    assert.equal(picked.defaultPath, '/documents/kuma 完整备份-2026-10-15.kuma-backup')
    const { stampedFileName } = host.load('src/shared/csv-text.ts')
    assert.equal(stampedFileName('export', 'csv', at), 'export-20261015.csv')
  } finally {
    if (timezone == null) delete process.env.TZ
    else process.env.TZ = timezone
  }
})

test('阵容钉卡在按下期间保持页签，释放后各卡分别刷新；相同内容不换 DOM', () => {
  const documentDom = dom(), timer = clock()
  const cards = new Map(), bodies = new Map()
  for (const questId of [1, 2]) {
    const card = new documentDom.Element('DIV')
    const body = card.appendChild(new documentDom.Element('DIV', 'p-s'))
    body.innerHTML = '旧页签'
    documentDom.document.body.appendChild(card)
    cards.set(questId, { card, mapKey: '11', html: '旧页签' })
    bodies.set(questId, body)
  }
  const kernel = makeKernel(documentDom, timer, {
    pressedTarget: cards.get(1).card, pressedAt: timer.Date.now(),
    scrollTarget: cards.get(2).card, scrollAt: timer.Date.now(),
  })
  const api = evaluate(`${cut(read('renderer/modules/qn.ts'), 'const refreshLineupCard =', 'const openLineupCard =')}\nreturn { refreshLineupCards }`, {
    lineupCards: cards, buildRows: () => [{ id: 1 }, { id: 2 }], selectedLineupMap: (_row, key) => key,
    lineupCardBodyHtml: (id, key) => `新页签 ${id}/${key}`, deferPassive: kernel.deferPassive,
  })
  let patch
  evaluate(cut(read('renderer/modules/qn.ts'), '    onMgChange((keys) => {', '    let lastQuickFilterMinute'), {
    onMgChange: fn => { patch = fn }, lineupCards: cards, refreshLineupCards: api.refreshLineupCards,
    scheduleFleetCheck: () => {}, pane: { classList: { contains: () => false } },
  })
  for (const key of ['ships', 'decks', 'slotitems']) patch([key])
  assert.deepEqual([...bodies.values()].map(body => body.innerHTML), ['旧页签', '旧页签'])
  cards.get(1).mapKey = '12'
  kernel.releasePointer()
  timer.advance(601)
  assert.deepEqual([...bodies.values()].map(body => body.innerHTML), ['新页签 1/12', '新页签 2/11'])
  const writes = [...bodies.values()].map(body => body.writes)
  api.refreshLineupCards()
  assert.deepEqual([...bodies.values()].map(body => body.writes), writes)
})

test('当日完成任务的正文标 JST，悬停说明和其余文字保留', () => {
  const reset = host.extract('src/renderer/modules/qn.ts', ['sameDayResetHtml'], {
    qp: { trackers: { 1: { sameDay: true } } }, nextReset: () => 1234, fmtDurationLong: () => '1小时',
  }).api.sameDayResetHtml
  assert.equal(reset({ id: 1 }), '<div class="annual-reset" title="须在同一天内完成；每日 05:00 JST 清零本地计数，任务本身的更新周期不变">当日内完成 · JST 05:00 重置 ·\n    距下次重置 <b data-same-day-reset data-cdl="1234">1小时</b></div>')
  assert.equal(reset({ id: 2 }), '')
})

test('演习晚场跨 JST 零点分到次日日卡，03:00和15:00只换场；筛选与复盘同尺', () => {
  const rows = [
    { ts: jst('2026-10-15T15:00:00'), practice: true, rank: 'S' },
    { ts: jst('2026-10-16T00:30:00'), practice: true, rank: 'A' },
    { ts: jst('2026-10-16T02:59:59.999'), practice: true, rank: 'B' },
    { ts: jst('2026-10-16T03:00:00'), practice: true, rank: 'S' },
    { ts: jst('2026-10-16T14:59:59.999'), practice: true, rank: 'A' },
    { ts: jst('2026-10-16T15:00:00'), practice: true, rank: 'S' },
  ]
  const render = (selectedPracticeDay = null, selectedPracticeSession = null) => host.extract('src/renderer/modules/shi.ts', ['practiceViewHtml'], {
    battles: rows, selectedPracticeDay, selectedPracticeSession,
    jstHourOf,
    battleHistoryHtml: list => `<div data-history-count="${list.length}"></div>`,
  }).api.practiceViewHtml()
  const html = render()
  assert.match(html, /<time>2026-10-15<\/time><b>1 战<\/b>\s*<span>B\+ 1<\/span><span>早 0<\/span><span>晚 1<\/span>/)
  assert.match(html, /<time>2026-10-16<\/time><b>5 战<\/b>\s*<span>B\+ 5<\/span><span>早 2<\/span><span>晚 3<\/span>/)
  const day = jst('2026-10-15T00:00:00')
  assert.match(render(day, 'evening'), /data-history-count="1"/)
  assert.match(render(day + 86400_000, 'evening'), /data-history-count="3"/)
  const { battleHistoryHtml } = host.extract('src/renderer/modules/shi.ts', ['battleHistoryHtml'], {
    jstHourOf, fmtDateTime: String, fmtTime: String,
    fmtDate: localDayOf, reviewBattleId: null, elink: () => '', esc: String,
  }).api
  const history = battleHistoryHtml(rows.slice(0, 3), () => '演习', 'jstSession')
  assert.match(history, /2026-10-15 · 1 场/)
  assert.match(history, /2026-10-16 · 2 场/)
  const refreshSelection = selectedPracticeDay => evaluate(
    `${cut(read('renderer/modules/shi.ts'), '    if (snapshots) {', '    if (nodes) {')}\nreturn selectedPracticeDay`,
    { snapshots: rows.slice(1, 3), battles: [], selectedPracticeDay, jstDayStart },
  )
  assert.equal(refreshSelection(day + 86400_000), day + 86400_000, '次日零点后的晚场保持次日日卡选中态')
  assert.equal(refreshSelection(day), null, '前一天日卡已无演习记录，清除选中态')
})

const voiceFixture = ({ enabled = true, failing = true, graphFailing = false } = {}) => {
  let now = 100_000, reads = 0, rawReads = 0, builds = 0, master
  const listeners = {}, emitted = [], captions = [], warnings = []
  const resolver = runtimeHost().extract('src/renderer/kcs-voice.ts', ['resolveVoiceRequest', 'setShipGraph']).api
  const api = runtimeHost().extract('src/renderer/voice-subtitle.ts', ['initVoiceSubtitles', 'setVoiceCaptionsEnabled'], {
    config: { get: (_key, fallback) => _key === 'kuma.voiceCaptions' ? enabled : fallback },
    Date: class extends Date { static now() { return now } },
    ...resolver, queryMasterRaw: async () => {
      rawReads++
      if (graphFailing) throw new Error('主数据失败')
      return { data: { api_mst_shipgraph: [{ api_id: 100, api_filename: 'test' }] } }
    },
    queryLode: async () => { reads++; if (failing) throw new Error('资料包失败'); return { data: {} } },
    installZhSimplifier: () => {}, applyVoiceOverlay: () => ({ data: {}, warnings: [] }),
    buildAbyssVoiceSameNameForms: () => new Map(), buildVoiceFallbackIds: () => new Map(),
    buildVoiceZhByJa: () => new Map(), supplementVoiceZhByJa: () => {}, voiceOverlayJaIndex: () => new Map(),
    planVoiceCorrections: () => { builds++; return { rowsByForm: new Map() } },
    seasonOccupiedFrom: () => new Map(), kcwikiSlotIndex: () => new Map(), seasonalTextIndex: () => new Map(),
    window: { addEventListener: () => {}, dispatchEvent: event => emitted.push(event.detail) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    document: { querySelector: () => null, fonts: { load: async () => [] } },
    console: { warn: (...args) => warnings.push(args) }, onMgChange: fn => { master = fn },
    scheduleCaptionZone: () => {}, clearCaptionVisuals: () => {},
    mg: { sortie: { active: true, practice: false } },
    captionsFor: () => [{ text: '字幕' }], displayAtPlaybackTime: (...args) => captions.push(args),
    ipcRenderer: { invoke: () => assert.fail('资料失败不应产生未匹配误报') },
  }).api
  api.initVoiceSubtitles({ addListener: (key, fn) => { listeners[key] = fn } })
  return { api, emitted, captions, warnings,
    counts: () => ({ reads, rawReads, builds }), master: () => master(['master']),
    next: ms => { now += ms }, succeed: () => { failing = false; graphFailing = false },
    fire: (path = '/kcs/sound/kctest/900.mp3') => listeners['kancolle.voice']({ pathname: path, ts: now }),
  }
}

test('字幕资料失败冷却一分钟，连续语音和 master 补丁不重读；到期成功才消费队列', async () => {
  const env = voiceFixture()
  await settle()
  assert.equal(env.counts().reads, 13)
  for (let i = 0; i < 5; i++) { env.fire(); await settle() }
  env.master(); await settle()
  assert.equal(env.counts().reads, 13)
  assert.equal(env.captions.length, 0)
  assert.equal(env.emitted.length, 1, '资料包失败仍应有妖精彩蛋信号')
  env.next(59_999); env.fire(); await settle()
  assert.equal(env.counts().reads, 13)
  env.succeed(); env.next(1); env.fire(); await settle()
  assert.equal(env.counts().reads, 26)
  assert.equal(env.counts().builds, 1)
  assert.equal(env.captions.length, 1, '恢复后队列去重且展示字幕')
  env.fire('/kcs/sound/kctest/901.mp3'); await settle()
  assert.equal(env.counts().reads, 26, '成功结果继续复用')
})

test('关闭字幕只读特殊攻击所需主数据，不读字幕包；主数据变更仍能发信号，开启后再读字幕', async () => {
  const env = voiceFixture({ enabled: false, failing: false })
  await settle(); env.fire(); await settle()
  assert.deepEqual(env.counts(), { reads: 0, rawReads: 1, builds: 0 })
  assert.equal(env.emitted.length, 1)
  assert.equal(env.captions.length, 0)
  env.next(3000); env.master(); await settle(); env.fire(); await settle()
  assert.deepEqual(env.counts(), { reads: 0, rawReads: 2, builds: 0 })
  assert.equal(env.emitted.length, 2)
  env.api.setVoiceCaptionsEnabled(true); env.fire('/kcs/sound/kctest/901.mp3'); await settle()
  assert.equal(env.counts().reads, 13)
  assert.equal(env.captions.length, 1)
})

test('字幕关闭时信号主数据失败也有冷却，恢复后仍可发妖精彩蛋', async () => {
  const env = voiceFixture({ enabled: false, graphFailing: true })
  await settle()
  for (let i = 0; i < 5; i++) { env.fire(); await settle() }
  assert.equal(env.counts().rawReads, 1)
  assert.equal(env.counts().reads, 0)
  env.next(60_000); env.succeed(); env.fire(); await settle()
  assert.equal(env.counts().rawReads, 2)
  assert.equal(env.emitted.length, 1)
})
