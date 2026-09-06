import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditPlayerView, assembleModes, compareViews } from '../scripts/player-view-audit.mjs'
import { parityErrors, differenceFingerprint } from '../scripts/lib/player-view-parity.mjs'
import { PLAYER_VIEW_WHITELIST } from './fixtures/player-view-whitelist.mjs'
import { BUNDLED_LODE_IDS } from '../scripts/lib/bundled-lodes.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

test('玩家视角：真实用户层只许命中逐域冻结的输出差异，豁免命中 0 即红', async () => {
  const report = await auditPlayerView()
  if (report.noDeveloperLayer) console.log('无开发机层，口径检查按随包即开发机通过')
  else for (const row of report.domains) console.log(`${row.domain}：玩家缺/差/多 ${row.differences.length} 格，开发机 ${row.developerCells} 格`)
  assert.deepEqual(parityErrors(report, PLAYER_VIEW_WHITELIST), [])
})

test('空数据目录：随包即开发机通过，不创建目录、不污染默认来源缓存', async () => {
  const dir = path.join(os.tmpdir(), `kuma-no-developer-${process.pid}`)
  assert.equal(fs.existsSync(dir), false)
  const { player, developer } = assembleModes(dir)
  assert.deepEqual([...player.keys()].sort(), BUNDLED_LODE_IDS)
  assert.deepEqual([...player], [...developer])
  const report = await auditPlayerView({ dataDir: dir })
  assert.equal(report.noDeveloperLayer, true)
  assert.deepEqual(parityErrors(report, PLAYER_VIEW_WHITELIST), [])
  assert.equal(fs.existsSync(dir), false)
})

const difference = (key = 'A5/火力', player = null, developer = 280) => ({ domain: '远征', key, kind: player == null ? '缺' : '差', player, developer })
const base = [difference()]
const allowed = [{ domain: '远征', reason: '测试夹具的明确存量差异', decidedAt: '2026-09-06', cells: 1, fingerprint: differenceFingerprint(base) }]
const reportOf = differences => ({ domains: [{ domain: '远征', differences }] })

test('护栏行为：同域新增一格、同数换格、两端改值及旧格消失均拒绝', () => {
  assert.deepEqual(parityErrors(reportOf(base), allowed), [])
  for (const rows of [[...base, difference('44/桶', null, 6)], [difference('A6/火力')], [difference('A5/火力', null, 281)], [difference('A5/火力', 200, 280)], []]) {
    assert.ok(parityErrors(reportOf(rows), allowed).length > 0)
  }
  assert.match(parityErrors(reportOf([]), allowed).join('\n'), /命中 0/)
  assert.ok(parityErrors(reportOf(base), []).length > 0)
})

test('白名单自身：缺原因、日期、指纹、非正数与重复域均拒绝', () => {
  for (const patch of [{ reason: '' }, { decidedAt: '' }, { cells: 0 }, { fingerprint: '' }]) assert.ok(parityErrors(reportOf(base), [{ ...allowed[0], ...patch }]).length)
  assert.ok(parityErrors(reportOf(base), [...allowed, ...allowed]).length)
})

test('输出比较：开发机独有域、玩家独有格和空值都不会漏掉', () => {
  const rows = compareViews({ 远征: { a: 1, blank: null } }, { 远征: { b: 2 }, 新域: { c: 3 } })
  assert.deepEqual(rows.map(row => [row.domain, row.differences.map(d => d.kind)]), [['远征', ['多', '缺']], ['新域', ['缺']]])
})

test('装配注入：同进程先开发再玩家仍隔离，用户版本新/旧/等均执行生产规则', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-player-sources-'))
  const builtinDir = path.join(dir, 'builtin'), userDir = path.join(dir, 'user')
  fs.mkdirSync(builtinDir); fs.mkdirSync(userDir)
  const pack = (version, name) => ({ meta: { id: 'event-bonus', name, version, source: 'fixture', fetchedAt: '2026-09-06' }, data: { events: {} } })
  fs.writeFileSync(path.join(builtinDir, 'event-bonus.json'), JSON.stringify(pack('2026.09.06', '随包')))
  for (const version of ['2026.09.05', '2026.09.06', '2026.09.07']) {
    fs.writeFileSync(path.join(userDir, 'event-bonus.json'), JSON.stringify(pack(version, '用户')))
    const { loadAll } = runtimeHost({ './env': { ROOT: dir, APPDATA_PATH: dir } }).extract('src/main/lode.ts', ['loadAll']).api
    const sources = { builtinDir, builtinIds: ['event-bonus'] }
    assert.equal(loadAll({ ...sources, userDir }).get('event-bonus').meta.name, version < '2026.09.06' ? '随包' : '用户')
    assert.equal(loadAll(sources).get('event-bonus').meta.name, '随包')
  }
})
