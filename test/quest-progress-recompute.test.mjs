import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import battleModule from '../dist/main/mg/battle.js'
import replayModule from '../dist/main/mg/quest-sink-replay.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const { parseBattle } = battleModule
const {
  overwriteQuestProgress,
  planQuestProgressChanges,
  recomputeSinkQuestProgress,
} = replayModule

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NOW = Date.UTC(2026, 8, 2, 12)
const WEEK_START = Date.UTC(2026, 7, 30, 20)
const DAY_START = Date.UTC(2026, 8, 1, 20)
const RESULT = '/kcsapi/api_req_sortie/battleresult'

const lodeIds = [
  'quests-scn',
  'kcwiki-localization',
  'kcwiki-quest-req',
  'poi-quest-goal',
  'kcwiki-expedition',
  'poi-fcd-map',
]
const lodes = Object.fromEntries(
  lodeIds.map((id) => [
    id,
    JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'lodes', `${id}.json`), 'utf8')),
  ]),
)
const masterRaw = {
  api_mst_ship: [
    { api_id: 900, api_name: '空母ヲ級', api_stype: 11, api_sortno: 0 },
    { api_id: 1530, api_name: '潜水ヨ級', api_stype: 13, api_sortno: 0 },
    { api_id: 1532, api_name: '潜水カ級', api_stype: 13, api_sortno: 0 },
    { api_id: 2310, api_name: '軽母ヌ級 elite', api_stype: 7, api_sortno: 0 },
  ],
  api_mst_slotitem: [],
  api_mst_slotitem_equiptype: [],
  api_mst_useitem: [],
  api_mst_mission: [],
  api_mst_stype: [],
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'battle-field-coverage.json'), 'utf8'),
).find((entry) => entry.name === 'sortie-battle-sub-air-raid')
assert.ok(fixture, 'fixture 里没有真实对潜空袭报文 #29731')
const battleContext = {
  fleetShips: (deckId) =>
    Array.from({ length: 6 }, (_unused, index) => ({
      rosterId: deckId * 100 + index,
      mstId: deckId * 100 + index,
      name: `D${deckId}-${index + 1}`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => 0,
}
const hiddenBattle = parseBattle(
  fixture.path,
  structuredClone(fixture.battle),
  battleContext,
  WEEK_START,
)
const trueCarrierBattle = {
  kind: 'day',
  prediction: { perfect: false },
  eShips: [{ mstId: 900, hpEnd: 0, sunk: true, unattackable: false }],
}
const sortieSnapshot = (battle, ts) => JSON.stringify({
  active: false,
  practice: false,
  mapArea: 62,
  mapNo: 1,
  deckId: 3,
  bossCell: -1,
  nodes: [{ cell: 41, eventId: 4 }],
  currentCell: 41,
  battle,
  startTs: ts - 1000,
  battleCount: 1,
})
const apiEvent = (id, ts, apiPath, data = {}, post = {}) => ({
  id,
  ts,
  path: apiPath,
  body: JSON.stringify({ api_result: 1, api_data: data }),
  postBody: JSON.stringify(post),
})
const quest = (id, type) => ({
  api_no: id,
  api_category: 2,
  api_type: type,
  api_state: 2,
  api_title: `${id}`,
  api_progress_flag: 0,
})
const questList = (id, ts, quests = [quest(211, 1), quest(217, 0), quest(220, 2)]) => apiEvent(
  id,
  ts,
  '/kcsapi/api_get_member/questlist',
  { api_list: quests, api_exec_count: quests.length },
  { api_tab_id: '9' },
)

const replayFixture = () => {
  let id = 1
  const events = [
    questList(id++, WEEK_START - 1000, [quest(220, 2)]),
    apiEvent(id++, WEEK_START - 500, RESULT, { api_win_rank: 'S' }),
    questList(id++, WEEK_START + 100),
    apiEvent(id++, WEEK_START + 200, RESULT, { api_win_rank: 'S' }),
    questList(id++, DAY_START + 100),
    apiEvent(id++, DAY_START + 200, RESULT, { api_win_rank: 'S' }),
    apiEvent(id++, DAY_START + 250, '/kcsapi/api_req_quest/stop', {}, { api_quest_id: '217' }),
    apiEvent(id++, DAY_START + 300, RESULT, { api_win_rank: 'S' }),
    apiEvent(id++, DAY_START + 500, RESULT, { api_win_rank: 'S' }),
    apiEvent(id++, DAY_START + 700, RESULT, { api_win_rank: 'S' }),
    apiEvent(id++, DAY_START + 800, '/kcsapi/api_req_quest/clearitemget', {}, { api_quest_id: '211' }),
    apiEvent(id++, DAY_START + 900, RESULT, { api_win_rank: 'S' }),
    apiEvent(id++, DAY_START + 1000, '/kcsapi/api_req_quest/start', {}, { api_quest_id: '211' }),
    apiEvent(id++, DAY_START + 1100, RESULT, { api_win_rank: 'S' }),
    apiEvent(id++, DAY_START + 1200, '/kcsapi/api_req_quest/start', {}, { api_quest_id: '217' }),
  ]
  const battleByTs = new Map([
    [WEEK_START - 500, hiddenBattle],
    [WEEK_START + 200, hiddenBattle],
    [DAY_START + 200, hiddenBattle],
    [DAY_START + 300, trueCarrierBattle],
    [DAY_START + 500, trueCarrierBattle],
    [DAY_START + 700, trueCarrierBattle],
    [DAY_START + 900, trueCarrierBattle],
    [DAY_START + 1100, trueCarrierBattle],
  ])
  let battleId = 1
  const battles = [...battleByTs].map(([ts, battle]) => ({
    id: battleId++,
    ts,
    map: 621,
    cell: 41,
    snapshot: sortieSnapshot(battle, ts),
  }))
  return { events, battles }
}

const replay = () => {
  const { events, battles } = replayFixture()
  return recomputeSinkQuestProgress({
    targetQuestIds: [220, 211, 217],
    events,
    battles,
    now: NOW,
    masterRaw,
    getLode: (id) => lodes[id] ?? null,
  })
}

test('生产引擎按各自当前周期重放受领、放弃、交付与真实击沉', () => {
  const result = replay()
  assert.deepEqual(result.eligibleQuestIds, [211, 217, 220])
  assert.deepEqual(
    Object.fromEntries(
      result.eligibleQuestIds.map((id) => [id, result.progress[id].counts?.[0] ?? 0]),
    ),
    { 211: 1, 217: 0, 220: 5 },
  )
  assert.equal(result.progress[211].periodStart, DAY_START)
  assert.equal(result.progress[217].periodStart, WEEK_START - 1000)
  assert.equal(result.progress[220].periodStart, WEEK_START)
  assert.deepEqual(result.missingBattleSnapshots, [])
  assert.deepEqual(
    [...new Set(result.excluded.map((row) => row.ts))].sort((left, right) => left - right),
    [WEEK_START + 200, DAY_START + 200],
    '上周期与未受领窗口里的后方空母不该进入剔除清单',
  )
  assert.equal(result.excluded.length, 5, '周初两条任务、本日三条任务分别命中剔除')
})

const openDb = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-quest-progress-v13-'))
  const file = path.join(dir, 'mg.sqlite')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE quest_progress (
      quest_id INTEGER PRIMARY KEY,
      counts TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      path TEXT NOT NULL,
      body TEXT,
      post_body TEXT
    );
    CREATE TABLE battle_snapshots (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      map INTEGER NOT NULL,
      cell INTEGER NOT NULL,
      practice INTEGER NOT NULL DEFAULT 0,
      snapshot TEXT NOT NULL
    );
  `)
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, dir, file }
}

const seedOldProgress = (db) => {
  const insert = db.prepare(
    'INSERT INTO quest_progress (quest_id, counts, updated) VALUES (?, ?, ?)',
  )
  insert.run(211, '[9]', 1)
  insert.run(217, '[1]', 1)
  insert.run(220, '[14]', 1)
  insert.run(999, '[7]', 1)
}
const progressRows = (db) =>
  db.prepare('SELECT quest_id AS questId, counts, updated FROM quest_progress ORDER BY quest_id')
    .all()
    .map((row) => ({ ...row }))

const seedReplayRows = (db) => {
  const { events, battles } = replayFixture()
  const insertEvent = db.prepare(
    'INSERT INTO events (id, ts, path, body, post_body) VALUES (?, ?, ?, ?, ?)',
  )
  for (const row of events) insertEvent.run(row.id, row.ts, row.path, row.body, row.postBody)
  const insertBattle = db.prepare(
    'INSERT INTO battle_snapshots (id, ts, map, cell, snapshot) VALUES (?, ?, ?, ?, ?)',
  )
  for (const row of battles) insertBattle.run(row.id, row.ts, row.map, row.cell, row.snapshot)
}

const replayFromDb = (db, targetQuestIds) => recomputeSinkQuestProgress({
  targetQuestIds,
  events: db.prepare(
    'SELECT id, ts, path, body, post_body AS postBody FROM events ORDER BY ts ASC, id ASC',
  ).all(),
  battles: db.prepare(
    'SELECT id, ts, map, cell, snapshot FROM battle_snapshots ORDER BY ts ASC, id ASC',
  ).all(),
  now: NOW,
  masterRaw,
  getLode: (id) => lodes[id] ?? null,
})

const collectWarnings = (run) => {
  const original = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    return { value: run(), warnings }
  } finally {
    console.warn = original
  }
}

test('v13 真 SQLite 覆盖最终值，重复执行幂等且不动非目标任务', (t) => {
  const { db } = openDb(t)
  seedOldProgress(db)
  const result = replay()
  const first = planQuestProgressChanges(db, result)
  assert.deepEqual(
    first.map(({ questId, oldValue, newValue, diff }) => ({ questId, oldValue, newValue, diff })),
    [
      { questId: 211, oldValue: 9, newValue: 1, diff: -8 },
      { questId: 217, oldValue: 1, newValue: 0, diff: -1 },
      { questId: 220, oldValue: 14, newValue: 5, diff: -9 },
    ],
  )
  overwriteQuestProgress(db, first)
  const afterFirst = progressRows(db)
  assert.deepEqual(
    afterFirst.map((row) => [row.questId, row.counts]),
    [[211, '[1]'], [220, '[5]'], [999, '[7]']],
  )

  const second = planQuestProgressChanges(db, result)
  assert.deepEqual(second.map((change) => change.diff), [0, 0, 0])
  overwriteQuestProgress(db, second)
  assert.deepEqual(progressRows(db), afterFirst)
})

test('事件正文 JSON 损坏时警告并保留该任务原进度', (t) => {
  const { db } = openDb(t)
  seedOldProgress(db)
  seedReplayRows(db)
  db.prepare('UPDATE events SET body = ? WHERE ts = ?').run('{', DAY_START + 100)

  const { value: result, warnings } = collectWarnings(() => replayFromDb(db, [211]))
  assert.deepEqual(result.failedQuestIds, [211])
  assert.match(warnings.join('\n'), /\[kanso\].*事件正文损坏.*quest=211/)
  assert.deepEqual(planQuestProgressChanges(db, result), [])
  overwriteQuestProgress(db, [])
  assert.equal(db.prepare('SELECT counts FROM quest_progress WHERE quest_id = 211').get().counts, '[9]')
})

test('任务参数 JSON 损坏时警告并保留该任务原进度', (t) => {
  const { db } = openDb(t)
  seedOldProgress(db)
  seedReplayRows(db)
  db.prepare('UPDATE events SET post_body = ? WHERE path = ?').run(
    '{',
    '/kcsapi/api_req_quest/stop',
  )

  const { value: result, warnings } = collectWarnings(() => replayFromDb(db, [217]))
  assert.deepEqual(result.failedQuestIds, [217])
  assert.match(warnings.join('\n'), /\[kanso\].*任务参数损坏.*quest=217/)
  assert.deepEqual(planQuestProgressChanges(db, result), [])
  assert.equal(db.prepare('SELECT counts FROM quest_progress WHERE quest_id = 217').get().counts, '[1]')
})

test('战斗快照 JSON 损坏时计入 missingBattleSnapshots 并保留该任务原进度', (t) => {
  const { db } = openDb(t)
  seedOldProgress(db)
  seedReplayRows(db)
  db.prepare('UPDATE battle_snapshots SET snapshot = ? WHERE ts = ?').run('{', DAY_START + 300)
  const eventId = Number(db.prepare('SELECT id FROM events WHERE ts = ?').get(DAY_START + 300).id)

  const { value: result, warnings } = collectWarnings(() => replayFromDb(db, [220]))
  assert.deepEqual(result.failedQuestIds, [220])
  assert.deepEqual(result.missingBattleSnapshots, [eventId])
  assert.match(warnings.join('\n'), /\[kanso\].*战斗快照损坏.*quest=220/)
  assert.deepEqual(planQuestProgressChanges(db, result), [])
  assert.equal(db.prepare('SELECT counts FROM quest_progress WHERE quest_id = 220').get().counts, '[14]')
})

test('旧 counts 损坏与无旧记录分开处理：损坏时警告并保留原值', (t) => {
  const { db } = openDb(t)
  seedOldProgress(db)
  db.prepare('UPDATE quest_progress SET counts = ? WHERE quest_id = 211').run('{')

  const { value: changes, warnings } = collectWarnings(() =>
    planQuestProgressChanges(db, replay()),
  )
  assert.deepEqual(changes.map((change) => change.questId), [217, 220])
  assert.match(warnings.join('\n'), /\[kanso\].*旧进度损坏.*quest=211/)
  overwriteQuestProgress(db, changes)
  assert.equal(db.prepare('SELECT counts FROM quest_progress WHERE quest_id = 211').get().counts, '{')

  db.prepare('DELETE FROM quest_progress WHERE quest_id = 211').run()
  const missing = planQuestProgressChanges(db, replay()).find((change) => change.questId === 211)
  assert.equal(missing.oldCounts, null)
  assert.equal(missing.oldValue, 0)
})

test('维护者脚本默认只读 dry-run，--write 才覆盖同一副本', (t) => {
  const { db, dir, file } = openDb(t)
  seedOldProgress(db)
  const { events, battles } = replayFixture()
  const insertEvent = db.prepare(
    'INSERT INTO events (id, ts, path, body, post_body) VALUES (?, ?, ?, ?, ?)',
  )
  for (const row of events) insertEvent.run(row.id, row.ts, row.path, row.body, row.postBody)
  const insertBattle = db.prepare(
    'INSERT INTO battle_snapshots (id, ts, map, cell, snapshot) VALUES (?, ?, ?, ?, ?)',
  )
  for (const row of battles) {
    insertBattle.run(row.id, row.ts, row.map, row.cell, row.snapshot)
  }
  fs.mkdirSync(path.join(dir, 'snapshots'))
  fs.writeFileSync(
    path.join(dir, 'snapshots', 'kcsapi_api_start2_getData.json'),
    JSON.stringify({ body: masterRaw }),
  )
  const before = progressRows(db)

  const script = path.join(ROOT, 'scripts', 'quest-progress-recompute.mjs')
  const dry = spawnSync(
    process.execPath,
    [
      script,
      '--db',
      file,
      '--quest',
      '220,211,217',
      '--now',
      new Date(NOW).toISOString(),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /模式：dry-run（只读，不写）/)
  assert.match(dry.stdout, /211\s+9\s+1\s+-8/)
  assert.match(dry.stdout, /217\s+1\s+0\s+-1/)
  assert.match(dry.stdout, /220\s+14\s+5\s+-9/)
  assert.match(dry.stdout, /被剔除的对潜空袭：2 场\/舰/)

  const check = new DatabaseSync(file, { readOnly: true })
  assert.deepEqual(progressRows(check), before)
  check.close()

  const written = spawnSync(
    process.execPath,
    [
      script,
      '--db',
      file,
      '--quest',
      '220,211,217',
      '--write',
      '--now',
      new Date(NOW).toISOString(),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.equal(written.status, 0, written.stderr)
  assert.match(written.stdout, /模式：write（最终值覆盖）/)
  const finalDb = new DatabaseSync(file, { readOnly: true })
  assert.deepEqual(
    progressRows(finalDb).map((row) => [row.questId, row.counts]),
    [[211, '[1]'], [220, '[5]'], [999, '[7]']],
  )
  finalDb.close()
})

test('ledger 构造器在临时 SQLite 真跑 v13，升版、覆盖与重跑幂等', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-ledger-v13-constructor-'))
  const file = path.join(dir, 'mg.sqlite')
  const seed = new DatabaseSync(file)
  seed.exec(`
    CREATE TABLE quest_progress (
      quest_id INTEGER PRIMARY KEY,
      counts TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      method TEXT,
      path TEXT NOT NULL,
      body TEXT,
      post_body TEXT
    );
    CREATE TABLE battle_snapshots (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      sortie_id INTEGER NOT NULL DEFAULT 0,
      battle_no INTEGER NOT NULL DEFAULT 1,
      map INTEGER NOT NULL,
      cell INTEGER NOT NULL,
      rank TEXT,
      is_boss INTEGER NOT NULL DEFAULT 0,
      practice INTEGER NOT NULL DEFAULT 0,
      snapshot TEXT NOT NULL,
      UNIQUE(sortie_id, battle_no, practice)
    );
    PRAGMA user_version = 12;
  `)
  seedOldProgress(seed)
  const { events, battles } = replayFixture()
  const insertEvent = seed.prepare(
    'INSERT INTO events (id, ts, path, body, post_body) VALUES (?, ?, ?, ?, ?)',
  )
  for (const row of events) insertEvent.run(row.id, row.ts, row.path, row.body, row.postBody)
  const insertBattle = seed.prepare(
    `INSERT INTO battle_snapshots
       (id, ts, sortie_id, battle_no, map, cell, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const row of battles) {
    insertBattle.run(row.id, row.ts, row.id, 1, row.map, row.cell, row.snapshot)
  }
  seed.close()
  fs.mkdirSync(path.join(dir, 'snapshots'))
  fs.writeFileSync(
    path.join(dir, 'snapshots', 'kcsapi_api_start2_getData.json'),
    JSON.stringify({ body: masterRaw }),
  )

  const outfile = path.join(dir, 'ledger.cjs')
  globalThis.__questV13Lodes = lodes
  await build({
    entryPoints: [path.join(ROOT, 'src', 'main', 'mg', 'ledger.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [{
      name: 'ledger-v13-harness',
      setup(bundle) {
        const virtual = (filter, name) => bundle.onResolve(
          { filter },
          () => ({ path: name, namespace: 'ledger-v13-harness' }),
        )
        virtual(/^electron$/, 'electron')
        virtual(/^\.\.\/env$/, 'env')
        virtual(/^\.\.\/config$/, 'config')
        virtual(/^\.\.\/lode$/, 'lode')
        bundle.onLoad(
          { filter: /.*/, namespace: 'ledger-v13-harness' },
          ({ path: moduleName }) => ({
            contents: {
              electron: 'export const ipcMain = { handle: () => {} }',
              env: `export const APPDATA_PATH = ${JSON.stringify(dir)}`,
              config: 'export default { get: (_path, fallback) => fallback }',
              lode: 'export const getLode = (id) => globalThis.__questV13Lodes[id] ?? null',
            }[moduleName],
            loader: 'js',
          }),
        )
      },
    }],
  })

  const loadLedger = () => {
    delete require.cache[require.resolve(outfile)]
    return require(outfile).default
  }
  const realNow = Date.now
  Date.now = () => NOW
  const firstLedger = loadLedger()
  firstLedger.closeDatabase()
  const afterFirstDb = new DatabaseSync(file)
  assert.equal(afterFirstDb.prepare('PRAGMA user_version').get().user_version, 13)
  const afterFirst = progressRows(afterFirstDb)
  assert.deepEqual(
    afterFirst.map((row) => [row.questId, row.counts]),
    [[211, '[1]'], [220, '[5]'], [999, '[7]']],
  )
  afterFirstDb.exec('PRAGMA user_version = 12')
  afterFirstDb.close()

  Date.now = () => NOW
  const secondLedger = loadLedger()
  secondLedger.closeDatabase()
  const afterSecondDb = new DatabaseSync(file, { readOnly: true })
  assert.equal(afterSecondDb.prepare('PRAGMA user_version').get().user_version, 13)
  assert.deepEqual(progressRows(afterSecondDb), afterFirst)
  afterSecondDb.close()

  t.after(() => {
    Date.now = realNow
    delete globalThis.__questV13Lodes
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
