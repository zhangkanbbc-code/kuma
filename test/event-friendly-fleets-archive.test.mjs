import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { archiveMapIntelEvent } from '../scripts/archive-map-intel-event.mjs'
import { archiveFriendlyFleetPack, preserveFriendlyFleetHistory } from '../scripts/lib/event-friendly-fleets-history.mjs'
import { approveMapIntelCandidate, candidatePaths } from '../scripts/map-intel-review.mjs'
import validation from '../dist/main/lode-validation.js'

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data))
const config = { ...read(new URL('../scripts/map-intel-events.json', import.meta.url)).active, status: 'ended' }
const original = read(new URL('../assets/lodes/event-friendly-fleets.json', import.meta.url))
const now = new Date('2026-09-11T00:00:00Z')
const later = new Date('2026-09-12T00:00:00Z')

const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-event-archive-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.mkdirSync(path.join(root, 'assets', 'lodes'), { recursive: true })
  const output = path.join(root, 'assets', 'lodes', 'map-intel.json')
  const friendlyOutput = path.join(root, 'assets', 'lodes', 'event-friendly-fleets.json')
  const current = { meta: { version: '2026.09.06', fetchedAt: '2026-09-06' }, data: { maps: {
    '61-1': { event: { name: '往期', status: 'ended' }, difficulties: {} },
    ...Object.fromEntries(Object.keys(original.data.maps).map((key) => [key, {
      event: { name: config.name, status: 'active', until: config.until }, difficulties: {},
    }])),
  } } }
  write(path.join(root, 'scripts', 'map-intel-events.json'), { active: config })
  write(output, current)
  write(friendlyOutput, original)
  write(path.join(root, 'assets', 'lodes', 'event-map-intel.json'), read(new URL('../assets/lodes/event-map-intel.json', import.meta.url)))
  const files = candidatePaths(output)
  return { root, output, friendlyOutput, current, ...files,
    friendlyCandidate: path.join(path.dirname(files.candidate), 'event-friendly-fleets.candidate.json') }
}

test('结束脚本同时产生两包候选，五图不清空，待审与批准后重跑均逐字节幂等', (t) => {
  const f = fixture(t)
  archiveMapIntelEvent(f.root, { now })
  assert.deepEqual(read(f.output), f.current, '待审不能改正式 map-intel')
  assert.deepEqual(read(f.friendlyOutput), original, '待审不能改正式友军包')
  const candidate = read(f.candidate)
  assert.deepEqual(candidate.data.maps['61-1'], f.current.data.maps['61-1'])
  for (const key of Object.keys(original.data.maps)) assert.equal(candidate.data.maps[key].event.status, 'ended')
  const friends = read(f.friendlyCandidate)
  assert.deepEqual(friends.data.maps, original.data.maps)
  assert.equal(friends.data.history.length, 1)
  assert.deepEqual(friends.data.history[0], {
    name: config.name, mapAreaId: 62, status: 'ended', until: '2026-09-10', maps: original.data.maps,
  })
  assert.equal(Object.keys(friends.data.history[0].maps).length, 5)
  assert.equal(validation.validateLodePack(friends).ok, true)
  const report = read(f.report)
  assert.equal(report.friendlyFleets.history[0].name, config.name)
  assert.equal(report.friendlyFleets.history[0].status, 'ended')
  const snapshot = () => [f.output, f.friendlyOutput, f.candidate, f.friendlyCandidate, f.report]
    .map((file) => fs.readFileSync(file, 'utf8'))
  const pending = snapshot()
  archiveMapIntelEvent(f.root, { now: later })
  assert.deepEqual(snapshot(), pending)
  approveMapIntelCandidate(f.output)
  assert.deepEqual(read(f.output), candidate)
  assert.deepEqual(read(f.friendlyOutput), friends)
  const approved = snapshot()
  archiveMapIntelEvent(f.root, { now: later })
  assert.deepEqual(snapshot(), approved)
})

test('下一期重建保留旧期历史，结束新期后两期各一块且快照独立', () => {
  const archived = archiveFriendlyFleetPack(original, config, now)
  const data = { schemaVersion: 1, maps: Object.fromEntries(Object.entries(original.data.maps)
    .map(([key, value]) => [key.replace('62-', '63-'), structuredClone(value)])) }
  const rebuilt = { ...original, data: preserveFriendlyFleetHistory(data, archived) }
  const oldHistory = structuredClone(archived.data.history)
  assert.deepEqual(rebuilt.data.history, oldHistory)
  const next = archiveFriendlyFleetPack(rebuilt, { ...config, mapAreaId: 63, name: '下一期', until: '2027-01-01' }, later)
  assert.equal(next.data.history.length, 2)
  assert.deepEqual(next.data.history[0], oldHistory[0])
  assert.deepEqual(next.data.maps, data.maps)
  assert.equal(validation.validateLodePack(next).ok, true)
  next.data.maps['63-1'].friendlyFleets[0].ships[0].lv = 1
  assert.notEqual(next.data.history[1].maps['63-1'].friendlyFleets[0].ships[0].lv, 1)
  assert.deepEqual(archived.data.history, oldHistory)
})

test('实际友军生成器离线重建下一期仍携带旧历史', (t) => {
  const f = fixture(t)
  const archived = archiveFriendlyFleetPack(original, config, now)
  write(f.friendlyOutput, archived)
  write(path.join(f.root, 'scripts', 'map-intel-events.json'), {
    active: { ...config, mapAreaId: 63, name: '下一期', status: 'active' },
  })
  write(path.join(f.root, 'scripts', 'lode-sources.json'),
    read(new URL('../scripts/lode-sources.json', import.meta.url)))
  const ships = read(new URL('../assets/lodes/kcwiki-ships.json', import.meta.url))
  // 与现有友军解析夹具相同的六条主数据名，合入临时名表；不读取用户快照。
  for (const [name, id] of [
    ['Saratoga Mk.II', 545], ['Fletcher Mk.II', 629], ['L.d.S.D.d.Abruzzi改', 693],
    ['Z1 zwei', 179], ['Z3 zwei', 180], ['Phoenix改', 734],
  ]) ships.data[`fixture-${id}`] = { ID: id, 日文名: name }
  write(path.join(f.root, 'assets', 'lodes', 'kcwiki-ships.json'), ships)
  const html = path.join(f.root, 'friendly.html')
  fs.copyFileSync(new URL('./fixtures/kcwiki-event-friendly-20260906.html', import.meta.url), html)
  const builder = path.join(f.root, 'scripts', 'build-event-friendly-fleets.mjs')
  buildSync({
    entryPoints: [fileURLToPath(new URL('../scripts/build-event-friendly-fleets.mjs', import.meta.url))],
    outfile: builder, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  })
  execFileSync(process.execPath, [builder, '--from-file', html], { cwd: f.root, windowsHide: true, stdio: 'pipe' })
  const rebuilt = read(f.friendlyOutput)
  assert.deepEqual(Object.keys(rebuilt.data.maps), ['63-1', '63-2', '63-3', '63-4', '63-5'])
  assert.deepEqual(rebuilt.data.history, archived.data.history)
  assert.equal(validation.validateLodePack(rebuilt).ok, true)
})

test('友军缺图或活动尚未结束时拒绝归档，不产生候选', (t) => {
  const f = fixture(t)
  const incomplete = structuredClone(original)
  delete incomplete.data.maps['62-5']
  write(f.friendlyOutput, incomplete)
  assert.throws(() => archiveMapIntelEvent(f.root, { now }), /海图与活动/)
  assert.equal(fs.existsSync(f.candidate), false)
  write(path.join(f.root, 'scripts', 'map-intel-events.json'), { active: { ...config, status: 'active' } })
  assert.throws(() => archiveMapIntelEvent(f.root, { now }), /将 active.status 改为 ended/)
  assert.equal(fs.existsSync(f.candidate), false)
})

for (const target of ['friendlyOutput', 'friendlyCandidate']) {
  test(`两包一起批准前校验友军指纹：${target} 变化拒绝且两正式包不动`, (t) => {
    const f = fixture(t)
    archiveMapIntelEvent(f.root, { now })
    const changed = read(f[target])
    changed.meta.version = 'changed'
    write(f[target], changed)
    const before = [f.output, f.friendlyOutput].map((file) => fs.readFileSync(file, 'utf8'))
    assert.throws(() => approveMapIntelCandidate(f.output), /友军.*拒绝批准/)
    assert.deepEqual([f.output, f.friendlyOutput].map((file) => fs.readFileSync(file, 'utf8')), before)
  })
}

test('友军历史形状拒绝坏活动字段、重复期与坏编成', () => {
  const good = archiveFriendlyFleetPack(original, config, now)
  for (const mutate of [
    (p) => { p.data.history = {} },
    (p) => { p.data.history[0].name = '' },
    (p) => { p.data.history[0].status = 'active' },
    (p) => { p.data.history[0].until = '2026-99-99' },
    (p) => { p.data.history[0].mapAreaId = 63 },
    (p) => { p.data.history.push(structuredClone(p.data.history[0])) },
    (p) => { p.data.history[0].maps['62-1'].friendlyFleets[0].ships[0].id = 0 },
  ]) {
    const bad = structuredClone(good)
    mutate(bad)
    assert.equal(validation.validateLodePack(bad).ok, false)
  }
})
