import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
import { clock, cut, evaluate } from './fixtures/zi-refresh-runtime.mjs'

const source = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
const senka = runtimeHost().load('src/shared/senka.ts')
const ranking = runtimeHost().load('src/shared/senka-ranking.ts')
const setup = () => {
  const timer = clock(), handlers = new Map(), warnings = []
  let bad = '', version = 1, parses = 0, historyParses = 0
  const view = { ...ranking.failedSenkaRanking(1), failedAt: undefined, ownCalibration: { value: 100, ts: timer.Date.now() - 1000 }, ownRank: 100 }
  const ledger = {
    rankingEventStamp: () => { if (bad === 'stamp') throw new Error('版本读取失败'); return { count: version, maxId: version } },
    rankingRewardStamp: () => 'rewards',
    queryRankingPages: from => { parses++; if (bad === 'ranking' || (bad === 'history' && from == null)) throw new Error('排行页失败'); return [] },
    earliestEventTs: () => null, latestEquipSyncBefore: () => null,
    queryRankingRewardRows: () => [], querySlotitemSeen: () => [], queryEquipSyncTs: () => [], queryLateEquipEventTs: () => [],
    querySenka: () => ({ total: 50, monthStart: senka.senkaMonthStart(timer.Date.now()) }),
    sumSenkaBetween: () => 3,
  }
  const api = evaluate([
    cut(source, 'let rankingFailure:', 'let calendarRanks:'),
    cut(source, "ipcMain.handle('mg:senka-ranking'", '// 「渲染层递一个任务号'),
  ].join('\n'), {
    ...senka, ...ranking, ...timer, ledger,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    store: { getState: () => ({ player: { basic: { nickname: '提督' } }, master: { slotitems: {} } }) },
    currentRankingServer: () => ({}), rankingOwnHintAt: () => () => 0,
    reconcileSenka: () => { if (bad === 'reconcile') throw new Error('校准失败') },
    assembleSenkaRanking: () => ({ ...view }), ensureMasterRaw: () => null,
    senkaMonthHistory: () => { historyParses++; return [] }, rankingRewardCandidates: () => ({}),
    config: { get: () => null }, console: { warn: (...args) => warnings.push(args) },
  }, 'return { querySenkaRanking }')
  return { ...api, timer, handlers, warnings,
    fail: reason => { bad = reason }, nextVersion: () => version++,
    counts: () => ({ parses, historyParses }) }
}

test('mg:senka-ranking 解析失败返回自己的失败态；mg:senka 仍返回账内结果，墓碑挡住重复解析', () => {
  const env = setup()
  env.fail('ranking')
  const failed = env.handlers.get('mg:senka-ranking')({}, undefined)
  assert.ok(failed.failedAt)
  assert.equal(failed.ownCalibration, null)
  assert.equal(env.handlers.get('mg:senka')({}, undefined).total, 50)
  assert.equal(env.counts().parses, 1)
  assert.equal(env.warnings.length, 1)
  env.fail('')
  assert.ok(env.handlers.get('mg:senka-ranking')({}, undefined).failedAt)
  const restored = env.handlers.get('mg:senka-ranking')({}, undefined, { retry: true })
  assert.equal(restored.failedAt, undefined)
  assert.equal(env.counts().parses, 2)
  assert.equal(env.handlers.get('mg:senka')({}, undefined).calibration.current, 103)
})

test('排行墓碑允许新排行版本和超时后重新读取，版本查询本身失败也不会重复刷屏', () => {
  const env = setup()
  env.fail('ranking')
  env.querySenkaRanking(env.timer.Date.now())
  env.nextVersion()
  env.querySenkaRanking(env.timer.Date.now())
  assert.equal(env.counts().parses, 2)
  env.timer.advance(30_001)
  env.querySenkaRanking(env.timer.Date.now())
  assert.equal(env.counts().parses, 3)
  const stamp = setup()
  stamp.fail('stamp')
  for (let i = 0; i < 5; i++) assert.ok(stamp.handlers.get('mg:senka-ranking')({}, undefined).failedAt)
  assert.equal(stamp.warnings.length, 1)
})

test('排行处理器中的 reconcile 与历史异常均返回失败态，常规查询不解析全量历史', () => {
  const env = setup(), handler = env.handlers.get('mg:senka-ranking')
  assert.equal(handler({}, undefined).historyFailedAt, undefined)
  assert.equal(env.counts().historyParses, 0)
  env.fail('history')
  const history = handler({}, undefined, { history: true })
  assert.ok(history.historyFailedAt)
  assert.equal(history.failedAt, undefined)
  assert.equal(history.ownRank, 100)
  const other = setup()
  other.fail('reconcile')
  assert.ok(other.handlers.get('mg:senka-ranking')({}, undefined).failedAt)
})
