import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { transformSync } from 'esbuild'
import test from 'node:test'

const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const slice = (text, from, to) => {
  const start = text.indexOf(from), end = text.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `夹具锚点失效：${from}`)
  return text.slice(start, end)
}
const cjs = (text, require, globals = {}) => {
  const module = { exports: {} }
  vm.runInNewContext(transformSync(text, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, require, console, ...globals,
  })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))

test('脱敏快路径只跳过规范且已脱敏的平面对象，不重复 parse/stringify', () => {
  let parses = 0, stringifies = 0
  const api = cjs(source('src/main/mg/post-body-redact.ts'), null, { JSON: {
    parse: (...args) => { parses++; return JSON.parse(...args) },
    stringify: (...args) => { stringifies++; return JSON.stringify(...args) },
  } })
  for (const input of [
    '{"api_token":"<redacted>"}',
    '{"api_id":"1","api_token":"<redacted>","api_note":"api_token"}',
  ]) assert.equal(api.redactPostBody(input), input)
  assert.equal(parses, 0)
  assert.equal(stringifies, 0)
  for (const input of [
    '{"api_token":"<redacted>","api_token":"secret"}',
    '{"api_token":"<redacted>","api_id":"1","api_id":"2"}',
    '{"api_token":"<redacted>","\\u0061pi_token":"secret"}',
    '{"\\u0061pi_token":"secret"}',
    '{"api_note":"\\\"api_token\\\":\\\"<redacted>\\\"","api_token":"secret"}',
    '{ "api_token": "<redacted>", "api_id": "1" }',
    '{"api_token":["secret","other"],"api_id":["1","2"]}',
    '{"api_token":"secret","api_note":{"api_token":"business"}}',
    '{"api_token":"<redacted>","api_note":"escaped\\nline"}',
  ]) {
    const expected = JSON.parse(input)
    expected.api_token = '<redacted>'
    assert.equal(api.redactPostBody(input), JSON.stringify(expected))
  }
  assert.equal(parses, 9)
  assert.equal(stringifies, 9)
  assert.equal(api.redactPostBody('api_token=secret&api_id=1&api_token=other'), 'api_token=<redacted>&api_id=1&api_token=<redacted>')
  assert.equal(api.redactPostBody(null), null)
})

const ledgerSource = source('src/main/mg/ledger.ts')
const redact = cjs(source('src/main/mg/post-body-redact.ts'), null).redactPostBody
const ledgerFor = db => new Function('db', 'redactPostBody', transformSync(`
  ${slice(ledgerSource, 'const shipLifeEventOf = ', '\n// body 不入账')}
  return new class { constructor() { this.db = db }
    ${slice(ledgerSource, '  queryActionEvents = ', '\n  // v5')}
    ${slice(ledgerSource, '  queryRemodelHistories = ', '\n  /**')}
  }`, { loader: 'ts' }).code)(db, redact)
const indexSql = name => ledgerSource.match(new RegExp(`CREATE INDEX IF NOT EXISTS ${name}[^;]+;`))[0]

test('操作事件覆盖索引保持全量边界、闭区间及同毫秒入账顺序，并脱敏旧行', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER, path TEXT, post_body TEXT, body TEXT);
    CREATE INDEX idx_events_ts ON events(ts);`)
  const put = db.prepare('INSERT INTO events (ts, path, post_body) VALUES (?, ?, ?)')
  for (const [ts, pathname] of [
    [9, '/kcsapi/api_req_member/itemuse'], [10, '/kcsapi/api_req_z/action'],
    [10, '/kcsapi/api_get_member/useitem'], [10, '/kcsapi/api_get_member/ship2'],
    [10, '/kcsapi/api_req_a/action'], [11, '/kcsapi/api_get_member/require_info'],
    [11, '/kcsapi/api_port/port'], [11, '/kcsapi/api_start2/getData'],
    [11, '/kcsapi/api_req_member/itemuse'], [12, '/kcsapi/api_req_member/itemuse'],
  ]) put.run(ts, pathname, '{"api_token":"secret","api_id":"1"}')
  const ledger = ledgerFor(db)
  const before = ledger.queryActionEvents(10, 11)
  db.exec(indexSql('idx_events_actions_ts'))
  assert.deepEqual(ledger.queryActionEvents(10, 11), before)
  assert.deepEqual(before.map(row => row.path), [
    '/kcsapi/api_req_z/action', '/kcsapi/api_get_member/useitem', '/kcsapi/api_req_a/action',
    '/kcsapi/api_get_member/require_info', '/kcsapi/api_req_member/itemuse',
  ])
  assert.ok(before.every(row => JSON.parse(row.postBody).api_token === '<redacted>'))
})

test('批量改造摘要与完整履历口径一致，空历史/坏 detail/副舰/分页均不串档', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE ship_life_state (roster_id INTEGER, first_seen INTEGER, last_seen INTEGER);
    CREATE TABLE ship_life_events (id INTEGER PRIMARY KEY, roster_id INTEGER, ts INTEGER, kind TEXT,
      exp_delta INTEGER, map INTEGER, cell INTEGER, rank TEXT, is_boss INTEGER, practice INTEGER,
      mvp INTEGER, detail TEXT, damage_taken INTEGER, taiha INTEGER, damage_dealt INTEGER);
    CREATE INDEX idx_ship_life_roster ON ship_life_events(roster_id, ts DESC);`)
  db.exec(indexSql('idx_ship_life_remodel'))
  const put = db.prepare('INSERT INTO ship_life_events (roster_id, ts, kind, detail) VALUES (?, ?, ?, ?)')
  for (const [id, ts, kind, detail] of [
    [1, 1, 'remodel', '{"afterMstId":10}'], [1, 2, 'remodel', '{"afterMstId":11}'],
    [1, 3, 'remodel', '{"afterMstId":10}'], [1, 4, 'remodel', 'bad json'],
    [1, 5, 'remodel', '{"afterMstId":null}'], [1, 6, 'remodel', '{"afterMstId":"12"}'],
    [1, 7, 'remodel', '{"afterMstId":-1}'], [1, 8, 'battle', '{}'],
    [2, 9, 'join', '{}'], [4, 1, 'remodel', '{"afterMstId":99}'],
  ]) put.run(id, ts, kind, detail)
  let statements = 0
  const ledger = ledgerFor({ prepare: (...args) => { statements++; return db.prepare(...args) } })
  const result = ledger.queryRemodelHistories([1, 2, 3, 1])
  assert.equal(statements, 2)
  assert.deepEqual(result, [1, 2, 3].map(rosterId => ({ rosterId, history: ledger.queryShipLife(rosterId, 1).remodelHistory })))
  assert.deepEqual(result[0].history.afterMstIds, [12, 10, 11])
  assert.deepEqual(result[1].history, { hasEvents: true, afterMstIds: [] })
  assert.deepEqual(result[2].history, { hasEvents: false, afterMstIds: [] })
  statements = 0
  assert.deepEqual(ledger.queryRemodelHistories([]), [])
  assert.equal(statements, 0)
})

const refreshHarness = () => {
  const text = source('src/renderer/modules/ji.ts')
  const code = slice(text, 'const remodelHistories = ', '\nconst remodelStageLabelHtml')
  const mg = { master: { upgrades: { 11: [{ currentShipId: 10 }], 10: [{ currentShipId: 11 }] } }, ships: {} }
  const queries = [], builds = []
  const cycles = cjs(source('src/shared/remodel-stage.ts'), null).remodelCycles
  const run = new Function('mg', 'friendlyShips', 'remodelCycles', 'queryRemodelHistories', 'buildRemodelNeeds', transformSync(`${code}
    return { refresh: refreshRemodelHistories, histories: remodelHistories }`, { loader: 'ts' }).code)
  const api = run(mg, new Map([[9, { api_aftershipid: 10 }]]), cycles, ids => new Promise((resolve, reject) => queries.push({ ids, resolve, reject })), () => builds.push(plain([...api.histories])))
  return { ...api, mg, queries, builds }
}
const answer = (query, afterMstIds = [11]) => query.resolve(query.ids.map(rosterId => ({ rosterId, history: { hasEvents: true, afterMstIds } })))

test('图鉴只按可往复舰的实例/形态重查；HP/补给/无关舰/顺序变化不发 IPC；结果到齐才换表', async () => {
  const h = refreshHarness()
  h.mg.ships = { 1: { id: 1, shipId: 10, hp: 5 }, 2: { id: 2, shipId: 9 }, 3: { id: 3, shipId: 99 } }
  const first = h.refresh()
  assert.deepEqual(h.queries[0].ids, [1, 2])
  answer(h.queries[0]); await first
  const old = plain([...h.histories])
  h.mg.ships[1].hp = 1; h.mg.ships[1].fuel = 0; h.mg.ships[3].shipId = 98
  h.mg.ships = { 3: h.mg.ships[3], 2: h.mg.ships[2], 1: h.mg.ships[1] }
  await h.refresh()
  assert.equal(h.queries.length, 1)
  h.mg.ships[1].shipId = 11
  const second = h.refresh()
  assert.equal(h.queries.length, 2)
  assert.deepEqual(plain([...h.histories]), old)
  assert.ok(h.builds.every(rows => rows.length > 0))
  answer(h.queries[1], [10, 11]); await second
  assert.deepEqual(h.histories.get(1).afterMstIds, [10, 11])
  delete h.mg.ships[2]
  const third = h.refresh(); answer(h.queries[2]); await third
  assert.equal(h.histories.has(2), false)
  h.mg.ships[4] = { id: 4, shipId: 10 }
  const fourth = h.refresh(); answer(h.queries[3]); await fourth
  assert.equal(h.histories.has(4), true)
})

test('图鉴批量请求竞争只接纳最新；失败保留旧表且下次允许重试', async () => {
  const h = refreshHarness()
  h.mg.ships = { 1: { id: 1, shipId: 10 } }
  const a = h.refresh()
  h.mg.ships[1].shipId = 11
  const b = h.refresh()
  answer(h.queries[1], [11]); await b
  answer(h.queries[0], [10]); await a
  assert.deepEqual(h.histories.get(1).afterMstIds, [11])
  h.mg.ships[1].shipId = 10
  const c = h.refresh(); h.queries[2].reject(new Error('query failed'))
  await assert.rejects(c, /query failed/)
  assert.deepEqual(h.histories.get(1).afterMstIds, [11])
  const d = h.refresh(); answer(h.queries[3], [10]); await d
  assert.deepEqual(h.histories.get(1).afterMstIds, [10])
})

const realRequire = createRequire(new URL('../dist/main/asset-archive.js', import.meta.url))
const archiveHarness = (kind, dir) => {
  let now = 0, serial = 0, fsyncs = 0
  const timers = new Map()
  const atomic = cjs(source('src/main/atomic-json.ts'), id => {
    if (id === 'fs') return { ...fs, fsyncSync: fd => { fsyncs++; fs.fsyncSync(fd) } }
    if (id === './perf-time') return { timeMain: (_name, fn) => fn() }
    return realRequire(id)
  }, { process, Atomics, SharedArrayBuffer })
  const api = cjs(source(`src/main/${kind}-archive.ts`), id => {
    if (id === './env') return { APPDATA_PATH: dir }
    if (id === './config') return { get: () => 0 }
    if (id === './crash-log') return { safeConsole: () => {} }
    if (id === './atomic-json') return atomic
    if (id === './ship-costume-store') return { costumeOwnerOf: id => id }
    return realRequire(id)
  }, { process, Uint8Array, Buffer,
    setTimeout: (fn, delay) => { const timer = { id: ++serial, unref() {} }; timers.set(timer, { fn, at: now + delay }); return timer },
    clearTimeout: timer => timers.delete(timer),
  })
  return { api, fsyncs: () => fsyncs, advance: ms => {
    now += ms
    for (const [timer, task] of [...timers]) if (task.at <= now) { timers.delete(timer); task.fn() }
  } }
}
for (const [kind, noun, pathname] of [
  ['asset', 'Seen', '/kcs2/resources/slot/card/0001_1234.png'],
  ['art', 'Seen', '/kcs2/resources/ship/full/0001_1234.png'],
  ['voice', 'Heard', '/kcs/sound/kc1/1.mp3'],
  ['bgm', 'Heard', '/kcs2/resources/bgm/battle/001_1234.mp3'],
]) test(`${kind} 档案：计数合并无 fsync，新事实提早刷盘，退出计数可重载`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-index-flush-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const h = archiveHarness(kind, dir), cap = kind[0].toUpperCase() + kind.slice(1)
  const remember = h.api[`remember${cap}${noun}`], flush = h.api[`flush${cap}Archive`]
  const entries = h.api[`${kind}ArchiveEntries`]
  const index = () => JSON.parse(fs.readFileSync(path.join(dir, `${kind}-archive/index.json`)))
  const count = noun === 'Seen' ? 'seen' : 'heard'
  const tsKey = noun === 'Seen' ? 'lastSeen' : 'lastHeard'
  const input = { pathname, version: 'v1', ts: 1 }
  assert.equal(remember(input), true)
  h.advance(3000)
  assert.equal(h.fsyncs(), 1)
  assert.equal(index().entries[0][count], 1)
  for (let i = 2; i <= 5; i++) { remember({ ...input, ts: i }); h.advance(3000) }
  assert.equal(h.fsyncs(), 1)
  assert.equal(index().entries[0][count], 1)
  h.advance(48_000)
  assert.equal(index().entries[0][count], 5)
  assert.equal(h.fsyncs(), 1)
  flush()
  assert.equal(h.fsyncs(), 2)
  assert.equal(index().entries[0][count], 5)
  remember({ ...input, ts: 6 })
  assert.equal(remember({ ...input, pathname: pathname.replace(/0001|kc1|001_/, match => ({ '0001': '0002', kc1: 'kc2', '001_': '002_' }[match])), ts: 7 }), true)
  h.advance(3000)
  assert.equal(h.fsyncs(), 3)
  assert.equal(index().entries.length, 2)
  remember({ ...input, ts: 8 })
  flush()
  assert.equal(h.fsyncs(), 4)
  assert.deepEqual(index().entries, plain(entries()))
  const reload = archiveHarness(kind, dir)
  const reloaded = plain(reload.api[`${kind}ArchiveEntries`]())
  assert.equal(reloaded.find(entry => entry.pathname === pathname)[count], 7)
  assert.equal(reloaded.find(entry => entry.pathname === pathname)[tsKey], 8)
  flush()
  assert.equal(h.fsyncs(), 4)
  const keep = h.api[`keep${cap}Blob`]
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])
  remember({ ...input, ts: 9 })
  assert.ok(keep({ ...input, bytes, ts: 10 }))
  h.advance(3000)
  assert.equal(h.fsyncs(), 5)
  assert.equal(remember({ ...input, ts: 11 }), false)
  assert.equal(keep({ ...input, bytes, ts: 12 }), null)
  h.advance(3000)
  assert.equal(h.fsyncs(), 5)
  assert.equal(keep({ ...input, version: 'v2', bytes, ts: 13 }), null)
  h.advance(3000)
  assert.equal(h.fsyncs(), 6)
  assert.equal(index().entries.find(entry => entry.pathname === pathname && entry.bytes > 0).version, 'v2')
  assert.deepEqual(index().entries, plain(entries()))
})

test('改造摘要 renderer/main 桥一次传完整实例列表并原样返回摘要', async () => {
  const calls = [], result = [{ rosterId: 1, history: { hasEvents: true, afterMstIds: [11] } }]
  const kernel = cjs(slice(source('src/renderer/kernel.ts'), 'export const queryRemodelHistories = ', '\nexport const queryShipMemorial'), null, {
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(result) } },
  })
  const ids = [1, 2]
  assert.equal(await kernel.queryRemodelHistories(ids), result)
  assert.deepEqual(calls, [['mg:remodel-histories', ids]])
  let handler
  new Function('ipcMain', 'ledger', transformSync(slice(source('src/main/mg/index.ts'), "ipcMain.handle('mg:remodel-histories'", "ipcMain.handle('mg:ship-memorial'"), { loader: 'ts' }).code)(
    { handle: (name, fn) => { assert.equal(name, 'mg:remodel-histories'); handler = fn } },
    { queryRemodelHistories: received => { assert.equal(received, ids); return result } },
  )
  assert.equal(handler({}, ids), result)
})
