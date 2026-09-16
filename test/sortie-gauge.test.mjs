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
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-sortie-gauge-'))
const compile = (name, contents, resolveDir) => {
  const outfile = path.join(dir, `${name}.cjs`)
  buildSync({ stdin: { contents, loader: 'ts', resolveDir }, outfile,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return require(outfile)
}

// 编译完整 store；仅隔离持久化、资源包和语音记录，测试不打开应用数据。
const source = read('src/main/mg/store.ts')
const isolated = source
  .replace("import ledger from './ledger'", 'const ledger = {}')
  .replace("import { getLode } from '../lode'", 'const getLode = () => null')
  .replace("import { recordAbyssVoiceSightings } from '../abyss-voice-sightings'", 'const recordAbyssVoiceSightings = () => {}')
assert.notEqual(isolated, source)
let store, makeLedger, feed
try {
  store = compile('store', isolated, path.join(root, 'src/main/mg'))
  const ledgerSource = read('src/main/mg/ledger.ts')
  const from = ledgerSource.indexOf('  logBattleSnapshot = ')
  const to = ledgerSource.indexOf('  queryBattleSnapshots = ', from)
  assert.ok(from >= 0 && to > from)
  ;({ makeLedger } = compile('snapshot', `
const mapIdOf = (area: number, no: number) => area * 10 + no
class SnapshotLedger {
  constructor(public db: any) {}
${ledgerSource.slice(from, to)}
}
export const makeLedger = (db: any) => new SnapshotLedger(db)
`, root))
  const index = read('src/main/mg/index.ts')
  const stateStep = index.match(/  const sections = timeMain\('api:state', [^\r\n]+/)?.[0]
  const snapshotStep = index.match(/  if \(\s*apiPath === '\/kcsapi\/api_req_sortie\/battleresult'[\s\S]*?\n  \}/)?.[0]
  assert.ok(stateStep && snapshotStep)
  assert.ok(index.indexOf(stateStep) < index.indexOf(snapshotStep))
  ;({ feed } = compile('feed', `
export const feed = (store: any, ledger: any, apiPath: string, body: any, ts: number) => {
  const postBody = {}
  const timeMain = (_name: string, run: () => any) => run()
${stateStep}
${snapshotStep}
  return sections
}
`, root))
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

const state = store.getState()
const start = (body = {}) => {
  state.mapGauges = {}
  state.sortie = null
  store.handle('/kcsapi/api_get_member/mapinfo', { api_map_info: [
    { api_id: 15, api_cleared: 0, api_defeat_count: 0, api_required_defeat_count: 4, api_gauge_type: 1 },
  ] }, {}, 100)
  store.handle('/kcsapi/api_req_map/start', {
    api_maparea_id: 1, api_mapinfo_no: 5, api_no: 1, api_bosscell_no: 1, api_event_id: 5, ...body,
  }, { api_deck_id: '1' }, 200)
}
const battle = () => {
  assert.ok(store.handle('/kcsapi/api_req_sortie/battle', {}, {}, 250).includes('sortie'))
}
const result = { api_win_rank: 'S', api_destsf: 1 }
const resultPath = '/kcsapi/api_req_sortie/battleresult'

test('map/start 在 payload 更新后复制进度，结算后值为空且不共用当前对象', () => {
  start({ api_eventmap: { api_now_maphp: 1200, api_max_maphp: 2400, api_gauge_type: 2 } })
  assert.deepEqual(state.sortie.gauge, { before: state.mapGauges[15], after: null })
  assert.equal(state.sortie.gauge.before.hpNow, 1200)
  assert.notEqual(state.sortie.gauge.before, state.mapGauges[15])
  state.mapGauges[15].hpNow = 900
  assert.equal(state.sortie.gauge.before.hpNow, 1200)
})

test('Boss 结算逐场重写前后进度，实际快照写入保留该场值', (t) => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE battle_snapshots (
    id INTEGER PRIMARY KEY, ts INTEGER, sortie_id INTEGER, battle_no INTEGER,
    map INTEGER, cell INTEGER, rank TEXT, is_boss INTEGER, practice INTEGER, snapshot TEXT,
    UNIQUE(sortie_id, battle_no, practice)
  )`)
  const ledger = makeLedger(db)
  start()
  battle()
  const baseline = structuredClone(state.mapGauges[15])
  assert.ok(feed(store, ledger, resultPath, result, 300).includes('mapGauges'))
  const first = structuredClone(state.sortie.gauge)
  assert.deepEqual(first.before, baseline)
  assert.equal(first.after.defeated, first.before.defeated + 1)
  assert.notEqual(state.sortie.gauge.before, state.mapGauges[15])
  assert.notEqual(state.sortie.gauge.after, state.mapGauges[15])
  const saved = () => db.prepare('SELECT snapshot FROM battle_snapshots ORDER BY battle_no').all()
    .map((row) => JSON.parse(row.snapshot))
  assert.deepEqual(saved()[0].gauge, first)
  assert.equal(saved()[0].active, false)
  store.handle('/kcsapi/api_req_map/next', { api_no: 2, api_bosscell_no: 2, api_event_id: 5 }, {}, 400)
  battle()
  feed(store, ledger, resultPath, result, 500)
  assert.deepEqual(state.sortie.gauge.before, first.after)
  assert.equal(state.sortie.gauge.after.defeated, 2)
  assert.deepEqual(saved().map((sortie) => sortie.gauge), [first, state.sortie.gauge])
  state.mapGauges[15].defeated = 4
  assert.equal(state.sortie.gauge.after.defeated, 2)
  assert.deepEqual(saved()[0].gauge, first)
})

test('道中结算前值取结算时的进度，覆盖出击时记录且保持独立对象', () => {
  start()
  state.mapGauges[15].defeated = 2
  state.sortie.currentCell = 2
  state.sortie.nodes.push({ cell: 2, eventId: 4 })
  battle()
  assert.ok(store.handle(resultPath, result, {}, 300).includes('sortie'))
  assert.equal(state.sortie.gauge.before.defeated, 2)
  assert.deepEqual(state.sortie.gauge.after, state.sortie.gauge.before)
  assert.notEqual(state.sortie.gauge.after, state.sortie.gauge.before)
})

test('未读取海域进度时保留 null，演习结算不写进度记录', () => {
  start()
  state.mapGauges = {}
  store.handle('/kcsapi/api_req_map/start', { api_maparea_id: 1, api_mapinfo_no: 5 }, {}, 200)
  assert.deepEqual(state.sortie.gauge, { before: null, after: null })
  battle()
  assert.ok(store.handle(resultPath, result, {}, 300).includes('sortie'))
  assert.deepEqual(state.sortie.gauge, { before: null, after: null })
  store.handle('/kcsapi/api_req_practice/battle', {}, {}, 400)
  assert.equal(state.sortie.practice, true)
  assert.equal(state.sortie.gauge, null)
  assert.ok(store.handle('/kcsapi/api_req_practice/battle_result', result, {}, 500).includes('sortie'))
  assert.equal(state.sortie.gauge, null)
})
