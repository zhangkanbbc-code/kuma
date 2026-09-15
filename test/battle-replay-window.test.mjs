import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const read = (relative) =>
  fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `${label} 的源码锚点变了`)
  return source.slice(start, end)
}

const ruleBody = (css, selector) => {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `找不到 ${selector} 规则`)
  const bodyStart = css.indexOf('{', start) + 1
  const end = css.indexOf('}', bodyStart)
  assert.ok(end > bodyStart, `${selector} 规则没有闭合`)
  return css.slice(bodyStart, end)
}

const bundleHarness = (t, name, source) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kuma-${name}-`))
  const entry = path.join(dir, `${name}.ts`)
  const output = path.join(dir, `${name}.cjs`)
  fs.writeFileSync(entry, source)
  buildSync({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return require(output)
}

test('chron:battle-run returns every snapshot in one sortie in chronological order', (t) => {
  const ledger = read('src/main/mg/ledger.ts')
  const method = sliceBetween(
    ledger,
    '  queryBattleRun = (sortieId: number): BattleSnapshotSummary[] => {',
    '  queryBattleSnapshot = (id: number): BattleSnapshot | null => {',
    'queryBattleRun',
  )
  const { makeLedger } = bundleHarness(
    t,
    'battle-run-ledger',
    `class BattleRunLedger {
  db: any
  constructor(db: any) { this.db = db }
${method}
}
export const makeLedger = (db: any) => new BattleRunLedger(db)
`,
  )
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE battle_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      sortie_id INTEGER NOT NULL,
      battle_no INTEGER NOT NULL,
      map INTEGER NOT NULL,
      cell INTEGER NOT NULL,
      rank TEXT,
      is_boss INTEGER NOT NULL DEFAULT 0,
      practice INTEGER NOT NULL DEFAULT 0,
      snapshot TEXT NOT NULL,
      UNIQUE(sortie_id, battle_no, practice)
    )
  `)
  const insert = db.prepare(`
    INSERT INTO battle_snapshots
      (ts, sortie_id, battle_no, map, cell, rank, is_boss, practice, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
  `)
  insert.run(3000, 1700000000123, 3, 65, 9, 'S', 1, 0)
  insert.run(900, 1700000000999, 1, 11, 1, 'A', 0, 0)
  insert.run(1000, 1700000000123, 1, 65, 3, 'A', 0, 0)
  insert.run(2000, 1700000000123, 2, 65, 6, 'S', 0, 0)

  const rows = makeLedger(db).queryBattleRun(1700000000123)
  assert.deepEqual(
    rows.map((row) => ({
      ts: row.ts,
      sortieId: row.sortieId,
      battleNo: row.battleNo,
      map: row.map,
      cell: row.cell,
      rank: row.rank,
      isBoss: row.isBoss,
      practice: row.practice,
    })),
    [
      {
        ts: 1000,
        sortieId: 1700000000123,
        battleNo: 1,
        map: 65,
        cell: 3,
        rank: 'A',
        isBoss: false,
        practice: false,
      },
      {
        ts: 2000,
        sortieId: 1700000000123,
        battleNo: 2,
        map: 65,
        cell: 6,
        rank: 'S',
        isBoss: false,
        practice: false,
      },
      {
        ts: 3000,
        sortieId: 1700000000123,
        battleNo: 3,
        map: 65,
        cell: 9,
        rank: 'S',
        isBoss: true,
        practice: false,
      },
    ],
  )
})

test('embedded trail current state follows the snapshot rendered by that host', (t) => {
  const di = read('src/renderer/modules/di.ts')
  const trail = sliceBetween(
    di,
    'const trailHtml = (',
    '\n// 敌联合的夜战交战对象',
    'trailHtml',
  )
  const { renderTrail } = bundleHarness(
    t,
    'battle-trail-host',
    `const replay = { id: 1 }
const renderingEmbedded = true
const mg = { mapGauges: {} }
const formationPill = () => ''
const mapIdOf = (area: number, no: number) => area * 10 + no
const cellLetter = (_sortie: any, cell: number) => String.fromCharCode(64 + cell)
const nodeEventName = () => '战斗'
const spotBranches = () => []
const routeTallyFor = () => new Map()
const branchTallyText = () => ''
const branchLabelOf = () => ''
const mapKeyOf = () => ''
const fcdTopologyUsable = () => false
const fcdMap = null
const sortieMapOpen = false
const esc = (value: unknown) => String(value)
${trail}
const sortie = {
  practice: false,
  mapArea: 6,
  mapNo: 5,
  startTs: 1000,
  updatedTs: 3000,
  currentCell: 2,
  bossCell: 0,
  active: false,
  battle: null,
  nodes: [
    { cell: 1, eventId: 4, eventKind: 0, rank: 'A' },
    { cell: 2, eventId: 4, eventKind: 0, rank: 'S' },
  ],
}
const index = [
  { id: 1, ts: 1500, sortieId: 1000, battleNo: 1, map: 65, cell: 1, rank: 'A', isBoss: false, practice: false },
  { id: 2, ts: 2500, sortieId: 1000, battleNo: 2, map: 65, cell: 2, rank: 'S', isBoss: false, practice: false },
]
export const renderTrail = (snapshot: any) => trailHtml(sortie as any, snapshot, index)
`,
  )
  const linkedIds = (html) => [...html.matchAll(/data-replay-id="(\d+)"/g)].map((hit) => Number(hit[1]))

  assert.deepEqual(linkedIds(renderTrail({ id: 1 })), [2])
  assert.deepEqual(linkedIds(renderTrail({ id: 2 })), [1])

  const baseDefense = sliceBetween(
    di,
    "  if (act === 'bd-tuck') {",
    "  if (act === 'log-stage') {",
    '基地防空展开交互',
  )
  assert.doesNotMatch(baseDefense, /\breplay\b/)
  assert.match(baseDefense, /currentSnapshot\?\.sortie/)
})

test('main renderer keeps battle replay styles at the original cascade position via one shared file', () => {
  const index = read('src/renderer/index.html')
  const replay = read('src/renderer/battle-replay.html')
  const css = read('src/renderer/assets/battle-replay.css')
  const link = '<link rel="stylesheet" href="assets/battle-replay.css">'
  assert.equal(index.match(/assets\/battle-replay\.css/g)?.length, 1)
  assert.equal(replay.match(/assets\/battle-replay\.css/g)?.length, 1)
  assert.ok(index.indexOf(link) < index.indexOf('/* ══ 镖 · 远征规划'))
  assert.doesNotMatch(index, /\/\* ══ 镝 · 战斗详情/)
  assert.match(css, /^\/\* ══ 镝 · 战斗详情/)
  assert.match(css, /\.mod-di \.di-app/)
  assert.match(css, /#di-used-equipment-popover/)
})

test('only wide replay hosts scroll the full battle column while narrow mode keeps one page scrollbar', () => {
  const css = read('src/renderer/assets/battle-replay.css')
  const battleCol = ruleBody(css, '.mod-di .battle-col')
  const log = ruleBody(css, '.mod-di .log')
  const replayBattleCol = ruleBody(
    css,
    '.mod-di:where(.shi-battle-detail, #battle-replay-detail) .battle-col',
  )
  const replayLog = ruleBody(
    css,
    '.mod-di:where(.shi-battle-detail, #battle-replay-detail) .log',
  )
  const narrowApp = ruleBody(css, '.mod-di .di-app.narrow')
  const narrowBattleCol = ruleBody(css, '.mod-di .di-app.narrow .battle-col')
  const narrowLog = ruleBody(css, '.mod-di .di-app.narrow .log')

  assert.match(battleCol, /overflow:\s*hidden/)
  assert.doesNotMatch(battleCol, /overflow-y:\s*auto/)
  assert.match(log, /flex:\s*1(?:[;\s]|$)/)
  assert.match(log, /overflow-y:\s*auto/)
  assert.doesNotMatch(log, /max-height/)

  assert.match(replayBattleCol, /overflow-y:\s*auto/)
  assert.match(replayLog, /flex:\s*none/)
  assert.match(replayLog, /max-height:\s*46vh/)

  assert.match(narrowApp, /overflow-y:\s*auto/)
  assert.match(narrowBattleCol, /overflow:\s*visible/)
  assert.match(narrowBattleCol, /flex:\s*none/)
  assert.match(narrowLog, /max-height:\s*none/)
  assert.match(narrowLog, /overflow:\s*visible/)
  assert.match(narrowLog, /flex:\s*none/)
})

test('build emits the standalone battle replay page, bundle, and shared stylesheet', () => {
  const build = read('scripts/build.mjs')
  assert.match(
    build,
    /'battle-replay': path\.join\(root, 'src', 'renderer', 'battle-replay-window\.ts'\)/,
  )
  assert.match(build, /'battle-replay\.html'\),\s*path\.join\(rendererOut, 'battle-replay\.html'\)/)
  for (const relative of [
    'dist/renderer/battle-replay.html',
    'dist/renderer/battle-replay.js',
    'dist/renderer/assets/battle-replay.css',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `${relative} 没有进入 dist`)
  }
})

test('both ship-life battle buttons open the shared replay window without routing through main', () => {
  const life = read('src/renderer/ship-life-window.ts')
  const kernel = read('src/renderer/kernel.ts')
  assert.equal(life.match(/data-battle=/g)?.length, 2)
  assert.match(life, /openBattleReplayWindow\(snapshotId\)/)
  assert.doesNotMatch(life, /openBattleInMainWindow/)
  assert.match(kernel, /openBattleReplayWindow[\s\S]*?ipcRenderer\.invoke\('window:battle-replay', snapshotId\)/)
  assert.match(life, /title="打开本战复盘"/)
})

test('ship-life shows load more at 200 events and the click raises the query limit to 400', () => {
  const life = read('src/renderer/ship-life-window.ts')
  const ledger = read('src/main/mg/ledger.ts')
  const query = sliceBetween(
    ledger,
    '  queryShipLife = (rosterId: number, limit = 80): ShipLifeReport => {',
    '\n  /**\n   * 这一艘给谁送过终。',
    'queryShipLife',
  )
  assert.match(life, /const EVENT_PAGE_SIZE = 200/)
  assert.match(life, /report\.events\.length >= eventLimit[\s\S]*?data-life-more>加载更多<\/button>/)
  assert.match(life, /const nextLimit = eventLimit \+ EVENT_PAGE_SIZE/)
  assert.match(life, /queryShipLife\(rosterId, nextLimit\)/)
  assert.match(life, /target\.closest<HTMLButtonElement>\('\[data-life-more\]'\)/)
  assert.match(life, /timeline\.insertAdjacentHTML\('beforeend', appended\)/)
  assert.match(life, /body\.scrollTop = scrollTop/)
  assert.match(query, /\.all\(rosterId, Math\.max\(1, limit \| 0\)\)/)
  assert.doesNotMatch(query, /Math\.min\(200,\s*limit/)
})

const shipLifeHeroHarness = (t) => {
  const life = read('src/renderer/ship-life-window.ts')
  const events = read('src/renderer/ship-life-events.ts')
  const origin = sliceBetween(events, 'export const lifeJoinOriginText = ', '\n/** 这一条 battle', '加入出处')
  const art = sliceBetween(life, 'const artHtml = ', '\n// 图挂了', '顶栏立绘')
  const hero = sliceBetween(life, 'const heroHtml = ', '\nconst kpisHtml = ', '履历顶栏')
  const mapText = read('src/renderer/map-cell-letter.ts')
  const place = mapText.slice(mapText.indexOf('export const mapPlaceText = '))
  return bundleHarness(t, 'ship-life-hero', `
const mg = { ships: {}, master: { ships: {}, stypes: {} } }
const rosterId = 11
const DAY_MS = 24 * 3600 * 1000
const MARRIED_LEVEL_CAP = 180
const esc = (value: unknown) => String(value)
const fmtDate = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const mapCodeOf = (map: number) => Math.floor(map / 10) + '-' + map % 10
const mapCellLetter = () => 'J'
const kpisHtml = () => ''
${place}
${origin}
${art}
${hero}
export const renderHero = heroHtml
`)
}

const heroJoin = { ts: Date.UTC(2026, 0, 1), kind: 'join', map: 15, cell: 10, isBoss: true, detail: { origin: 'drop' } }
const heroMarriage = { ts: Date.UTC(2026, 0, 3), kind: 'marriage', detail: {} }

test('履历第一页没有加入和誓约时，顶栏仍显示加入天数、出处及誓约日期', (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 0, 11, 12))
  const { renderHero } = shipLifeHeroHarness(t)
  const html = renderHero({
    events: [{ ts: Date.UTC(2026, 0, 10), kind: 'battle' }],
    join: heroJoin, marriage: heroMarriage, trackingSince: Date.UTC(2025, 0, 1),
  })
  assert.match(html, /加入 <b>10<\/b> 天/)
  assert.match(html, /<b>2026-01-01<\/b> 加入镇守府<span class="where"> · 掉落于 1-5 J 点（Boss）<\/span>/)
  assert.match(html, /誓约 <b>2026-01-03<\/b>/)
  assert.doesNotMatch(html, /已记录/)
})

test('履历顶栏仅在旧报告缺少摘要键时兼容分页事件', (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 0, 11, 12))
  const { renderHero } = shipLifeHeroHarness(t)
  const html = renderHero({ events: [heroJoin, heroMarriage] })
  assert.match(html, /加入 <b>10<\/b> 天/)
  assert.match(html, /掉落于 1-5 J 点（Boss）/)
  assert.match(html, /誓约 <b>2026-01-03<\/b>/)
})

test('履历顶栏尊重明确的 null 摘要，缺少加入事件才显示已记录天数', (t) => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 0, 11, 12))
  const { renderHero } = shipLifeHeroHarness(t)
  const html = renderHero({
    events: [heroJoin, heroMarriage], join: null, marriage: null, trackingSince: Date.UTC(2026, 0, 6),
  })
  assert.match(html, /已记录 <b>5<\/b> 天/)
  assert.doesNotMatch(html, /加入镇守府|掉落于|誓约/)
})

test('main process owns one replay window on the sender display and leaves the legacy route intact', () => {
  const main = read('src/main/index.ts')
  const open = sliceBetween(
    main,
    'const openBattleReplayWindow = (',
    "ipcMain.handle('window:ship-life-battle'",
    'openBattleReplayWindow',
  )
  assert.match(main, /let battleReplayWindow: BrowserWindow \| null = null/)
  assert.match(open, /config\.get\('kuma\.battleReplayWindow'/)
  assert.match(open, /BrowserWindow\.fromWebContents\(sender\)/)
  assert.match(open, /screen\.getDisplayMatching\(senderBounds\)/)
  assert.match(open, /workArea\.width - width/)
  assert.match(open, /workArea\.height - height/)
  assert.match(open, /webContents\.send\('battle-replay:open', snapshotId\)/)
  assert.match(open, /battleReplayWindow\.focus\(\)/)
  assert.match(open, /if \(battleReplayReady\)/)
  assert.match(open, /if \(battleReplaySnapshotId !== snapshotId\)/)
  assert.doesNotMatch(open, /mainWindow/)
  assert.equal(open.match(/new BrowserWindow\(/g)?.length, 1)
  assert.match(main, /ipcMain\.handle\('window:battle-replay'/)
  assert.match(main, /ipcMain\.handle\('window:ship-life-battle'/)
  assert.match(
    main,
    /if \(battleReplayWindow && !battleReplayWindow\.isDestroyed\(\)\) \{\s*battleReplayWindow\.close\(\)/,
  )
})

test('standalone replay keeps one root, swaps snapshots in place, and pins the missing-record state', () => {
  const page = read('src/renderer/battle-replay-window.ts')
  const html = read('src/renderer/battle-replay.html')
  assert.match(page, /let battleLoadGeneration = 0/)
  assert.match(page, /const generation = \+\+battleLoadGeneration/)
  assert.match(page, /generation !== battleLoadGeneration/)
  assert.match(page, /queryBattleRun\(snapshot\.sortieId\)/)
  assert.match(page, /renderBattleReplayDetail\(detail, snapshot, \{ trailIndex \}\)/)
  assert.match(page, /handleBattleReplayDetailClick\(detail, currentSnapshot/)
  assert.match(page, /openSnapshot: \(id\) => void loadSnapshot\(id\)/)
  assert.match(page, /ipcRenderer\.on\('battle-replay:open'/)
  assert.ok(
    page.indexOf("ipcRenderer.on('battle-replay:open'") < page.indexOf('const start = async'),
    '换片监听必须在异步初始化前就登记，启动期连点不能丢',
  )
  assert.match(page, /pendingSnapshotId = id/)
  assert.match(page, /readyToLoad = true\s*void loadSnapshot\(pendingSnapshotId\)/)
  assert.match(page, /const missingText = '暂无这一场的复盘记录'/)
  assert.match(page, /const loadingText = '复盘读取中'/)
  assert.match(page, /const failedText = '复盘读取失败'/)
  assert.match(page, /const trailFailedText = '同次出击航迹读取失败'/)
  assert.match(page, /catch \(error\) \{[\s\S]*?showStatus\(failedText\)/)
  assert.match(page, /queryBattleRun[\s\S]*?catch\(\(error\) => \{[\s\S]*?showStatus\(trailFailedText\)/)
  assert.match(page, /if \(!currentSnapshot\) \{\s*detail\.hidden = true/)
  assert.match(page, /const next = detail\.clientWidth < 700/)
  assert.match(page, /if \(next === narrow\) return/)
  assert.doesNotMatch(page, /onMgChange/)
  assert.doesNotMatch(page, /initLink|initModules|registerEntityRoute/)
  assert.match(
    read('src/renderer/modules/di.ts'),
    /mount\(pane\) \{\s*diPane = pane\s*registerBattleEntityRoutes\(\)/,
  )
  assert.equal(html.match(/id="battle-replay-detail"/g)?.length, 1)
  assert.match(html, /<title>战斗复盘<\/title>/)
  assert.match(html, /id="battle-replay-status">复盘读取中<\/div>/)
})
