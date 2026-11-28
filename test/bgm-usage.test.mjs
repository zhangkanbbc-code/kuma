// BGM 反查（2026-11-28）：配曲留存的分段判据、反查索引、海域页叫法，以及账本那两个方法的真 SQL。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

import { lastMapBgmRowOf, mapBgmCellsOf, planMapBgmSpans } from '../dist/shared/map-bgm-history.js'
import {
  bgmSlotLabels,
  bgmUsageKey,
  bgmUsagePlaces,
  buildBgmUsage,
  mapBgmEntriesOf,
  parseBgmUsageKey,
} from '../dist/shared/bgm-usage.js'
import { EVENT_MAP_BGM } from '../dist/shared/event-map-bgm.js'

const row = (id, moving, map, boss) => ({ api_id: id, api_moving_bgm: moving, api_map_bgm: map, api_boss_bgm: boss })
// 秋刀鱼期间 1-1 的真实配法（2026-11 主数据快照）：道中昼战与 Boss 换成 76
const SANMA_11 = row(11, 1, [76, 2], [76, 76])
const PLAIN_11 = row(11, 1, [1, 2], [3, 3])

test('拆格：零号不收、同一张图两行认第一行、坏行跳过', () => {
  assert.deepEqual(mapBgmCellsOf([SANMA_11, row(11, 9, [9, 9], [9, 9]), null, { api_id: 'x' }, row(12, 0, [0, 5], [0, 0])]), [
    { mapId: 11, slot: 'moving', bgm: 1 },
    { mapId: 11, slot: 'map-day', bgm: 76 },
    { mapId: 11, slot: 'map-night', bgm: 2 },
    { mapId: 11, slot: 'boss-day', bgm: 76 },
    { mapId: 11, slot: 'boss-night', bgm: 76 },
    { mapId: 12, slot: 'map-night', bgm: 5 },
  ])
})

const span = (id, mapId, slot, bgm, firstSeen, lastSeen, closed = null) => ({ id, mapId, slot, bgm, firstSeen, lastSeen, closed })

test('分段：第一次全部新开；原样再见只延长；换曲收旧开新；整张图撤了全收口', () => {
  const first = planMapBgmSpans([], mapBgmCellsOf([PLAIN_11]))
  assert.deepEqual(first.extend, [])
  assert.deepEqual(first.close, [])
  assert.equal(first.insert.length, 5)

  const open = [
    span(1, 11, 'moving', 1, 100, 100),
    span(2, 11, 'map-day', 1, 100, 100),
    span(3, 11, 'map-night', 2, 100, 100),
    span(4, 11, 'boss-day', 3, 100, 100),
    span(5, 11, 'boss-night', 3, 100, 100),
  ]
  const same = planMapBgmSpans(open, mapBgmCellsOf([PLAIN_11]))
  assert.deepEqual(same, { extend: [1, 2, 3, 4, 5], close: [], insert: [] })

  const swapped = planMapBgmSpans(open, mapBgmCellsOf([SANMA_11]))
  assert.deepEqual(swapped.extend, [1, 3])
  assert.deepEqual(swapped.close, [2, 4, 5])
  assert.deepEqual(swapped.insert, [
    { mapId: 11, slot: 'map-day', bgm: 76 },
    { mapId: 11, slot: 'boss-day', bgm: 76 },
    { mapId: 11, slot: 'boss-night', bgm: 76 },
  ])

  const gone = planMapBgmSpans(open, mapBgmCellsOf([row(12, 4, [4, 4], [5, 5])]))
  assert.deepEqual(gone.close, [1, 2, 3, 4, 5])
  assert.equal(gone.insert.length, 5)
})

test('分段：主数据一格都拆不出来时什么都不改（残缺报文不是「全部撤场」）', () => {
  const open = [span(1, 11, 'moving', 1, 100, 100)]
  assert.deepEqual(planMapBgmSpans(open, []), { extend: [], close: [], insert: [] })
})

test('分段：同一格留着两段没收口的，只延长一段、多的收掉', () => {
  const open = [span(1, 11, 'moving', 1, 100, 100), span(2, 11, 'moving', 1, 90, 100)]
  assert.deepEqual(planMapBgmSpans(open, [{ mapId: 11, slot: 'moving', bgm: 1 }]), { extend: [1], close: [2], insert: [] })
})

test('撤场后拼回最后一行：只取最后一次见到那一刻在场的格', () => {
  const spans = [
    span(1, 621, 'moving', 275, 100, 300, 400),
    span(2, 621, 'map-day', 276, 100, 300, 400),
    span(3, 621, 'map-night', 276, 100, 300, 400),
    // 期中某一步撤掉了配曲：更早那段不该被拿来填
    span(4, 621, 'boss-day', 277, 100, 200, 300),
    span(5, 621, 'boss-night', 277, 100, 300, 400),
  ]
  assert.deepEqual(lastMapBgmRowOf(spans, 621), {
    mapId: 621,
    api_moving_bgm: 275,
    api_map_bgm: [276, 276],
    api_boss_bgm: [0, 277],
  })
  assert.equal(lastMapBgmRowOf(spans, 622), null)
})

test('海域页叫法：与改动前 mapBgmLineHtml 的拼法逐张图一致', () => {
  // 改动前的写法原样抄过来当尺子
  const legacy = (r) => {
    const entries = []
    if (r.api_moving_bgm > 0) entries.push(['海图', r.api_moving_bgm])
    const day = r.api_map_bgm?.[0] ?? 0
    const night = r.api_map_bgm?.[1] ?? 0
    if (day > 0 && day === night) entries.push(['战斗', day])
    else {
      if (day > 0) entries.push(['昼战', day])
      if (night > 0) entries.push(['夜战', night])
    }
    const bossDay = r.api_boss_bgm?.[0] ?? 0
    const bossNight = r.api_boss_bgm?.[1] ?? 0
    if (bossDay > 0 && bossDay === bossNight) entries.push(['Boss', bossDay])
    else {
      if (bossDay > 0) entries.push(['Boss 昼', bossDay])
      if (bossNight > 0) entries.push(['Boss 夜', bossNight])
    }
    return entries
  }
  const rows = [
    SANMA_11, PLAIN_11, row(25, 0, [4, 3], [4, 5]), row(31, 7, [0, 0], [8, 0]), row(41, 7, [7, 7], [7, 7]),
    ...EVENT_MAP_BGM.flatMap((a) => a.maps).map((m) => ({ ...m, api_id: m.mapId })),
  ]
  for (const r of rows) assert.deepEqual(mapBgmEntriesOf(r), legacy(r), `map ${r.api_id}`)
  assert.deepEqual(bgmSlotLabels(['map-day', 'boss-day', 'boss-night']), ['昼战', 'Boss'])
})

test('反查：当前配法、留存里的旧配法、手抄留存、家具各归各位', () => {
  const history = [
    span(1, 11, 'map-day', 1, 100, 500, 600), // 秋刀鱼开始前 1-1 道中昼战是 1，留存里收口了
    span(2, 11, 'map-day', 76, 600, 900),
    span(3, 11, 'boss-day', 76, 600, 900),
    span(4, 11, 'boss-night', 76, 600, 900),
    span(5, 11, 'moving', 1, 100, 900),
    span(6, 11, 'map-night', 2, 100, 900),
    span(7, 631, 'boss-day', 124, 300, 400, 500), // 留存开始后撤场的活动图
  ]
  const usage = buildBgmUsage({
    master: [SANMA_11],
    history,
    archive: EVENT_MAP_BGM.flatMap((a) => a.maps),
    furniture: [{ id: 16, bgmId: 127 }, { id: 98, bgmId: 127 }, { id: 5, bgmId: 0 }],
  })
  const u76 = usage.get('battle:76')
  assert.deepEqual(u76.maps, [{
    mapId: 11,
    slots: [
      { slot: 'map-day', current: true, firstSeen: 600, lastSeen: 900, archived: false },
      { slot: 'boss-day', current: true, firstSeen: 600, lastSeen: 900, archived: false },
      { slot: 'boss-night', current: true, firstSeen: 600, lastSeen: 900, archived: false },
    ],
  }])
  // 1 号：1-1 海图当前在用；1-1 道中昼战是曾用
  const u1 = usage.get('battle:1')
  assert.deepEqual(u1.maps[0].slots.map((s) => [s.slot, s.current]), [['moving', true], ['map-day', false]])
  // 124：留存里 63-1 Boss 曾用 ＋ 手抄留存的 62-5 Boss（62 期整期都不在主数据和留存里）
  const u124 = usage.get('battle:124')
  assert.deepEqual(u124.maps.map((m) => m.mapId), [625, 631])
  assert.ok(u124.maps[0].slots.every((s) => s.archived && !s.current && s.firstSeen == null))
  assert.ok(u124.maps[1].slots.every((s) => !s.archived && !s.current && s.lastSeen === 400))
  // 家具：母港树，键带树名，不与战斗树同号混
  assert.deepEqual(usage.get('port:127').furniture, [16, 98])
  assert.equal(usage.get('battle:127'), undefined)
  assert.equal(bgmUsagePlaces(u124), 2)
  assert.equal(bgmUsagePlaces(usage.get('port:127')), 2)
  assert.equal(bgmUsagePlaces(null), 0)
})

test('反查：手抄留存只补前两份都没有的图；留存里有这张图就以留存为准', () => {
  const usage = buildBgmUsage({
    master: [],
    history: [span(1, 625, 'boss-day', 999, 10, 20, 30)],
    archive: EVENT_MAP_BGM.flatMap((a) => a.maps),
  })
  assert.deepEqual(usage.get('battle:124'), undefined, '62-5 在留存里有记录，手抄的 124 不再补')
  assert.deepEqual(usage.get('battle:999').maps[0].mapId, 625)
  assert.ok(usage.get('battle:276').maps.some((m) => m.mapId === 621), '62-1 留存里没有，照手抄补')
})

test('反查：一首曲又配回原来那一格，只按当前那段算，不再列成曾用', () => {
  const usage = buildBgmUsage({
    master: [PLAIN_11],
    history: [span(1, 11, 'map-day', 1, 100, 200, 300), span(2, 11, 'map-day', 1, 400, 500)],
  })
  const slots = usage.get('battle:1').maps[0].slots.filter((s) => s.slot === 'map-day')
  assert.deepEqual(slots, [{ slot: 'map-day', current: true, firstSeen: 400, lastSeen: 500, archived: false }])
})

test('键：两棵树各一套号，解析只认合法的键', () => {
  assert.equal(bgmUsageKey('battle', 76), 'battle:76')
  assert.deepEqual(parseBgmUsageKey('port:108'), { kind: 'port', id: 108 })
  for (const bad of ['battle:0', 'battle:1000', 'ship:1', '76', '', null, undefined]) {
    assert.equal(parseBgmUsageKey(bad), null, `${bad}`)
  }
})

// ---- 账本：observeMapBgm / queryMapBgmHistory 原样切出来，对着内存库跑真 SQL ----
const root = fileURLToPath(new URL('..', import.meta.url))
const ledgerSource = fs.readFileSync(path.join(root, 'src/main/mg/ledger.ts'), 'utf8').replace(/\r\n/g, '\n')
const cutFrom = ledgerSource.indexOf('  observeMapBgm = ')
const cutTo = ledgerSource.indexOf('  // ---- 活动归档 ----', cutFrom)
const tableFrom = ledgerSource.indexOf('      CREATE TABLE IF NOT EXISTS map_bgm_history (')
const tableTo = ledgerSource.indexOf(');', tableFrom) + 2
assert.ok(cutFrom >= 0 && cutTo > cutFrom && tableFrom >= 0, 'ledger.ts 的配曲留存锚点要跟着改')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-map-bgm-'))
const outfile = path.join(dir, 'q.cjs')
buildSync({
  stdin: {
    contents: `import { mapBgmCellsOf, planMapBgmSpans, type MapBgmSpan } from './src/shared/map-bgm-history'
class Q {
  constructor(public db: any) {}
  private runBatch = (_count: number, fn: () => void) => fn()
${ledgerSource.slice(cutFrom, cutTo)}
}
export const make = (db: any) => new Q(db)
`,
    loader: 'ts',
    resolveDir: root,
  },
  outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
const { make } = createRequire(import.meta.url)(outfile)
fs.rmSync(dir, { recursive: true, force: true })
const ledger = () => {
  const db = new DatabaseSync(':memory:')
  db.exec(ledgerSource.slice(tableFrom, tableTo))
  return make(db)
}

test('账本：换曲收口、启动回放同一份不改、比账本旧的那份不改', () => {
  const q = ledger()
  q.observeMapBgm([PLAIN_11], 100)
  q.observeMapBgm([PLAIN_11], 200)
  let rows = q.queryMapBgmHistory()
  assert.equal(rows.length, 5)
  assert.ok(rows.every((r) => r.firstSeen === 100 && r.lastSeen === 200 && r.closed === null))

  q.observeMapBgm([SANMA_11], 300)
  rows = q.queryMapBgmHistory()
  assert.equal(rows.length, 8)
  const day = rows.filter((r) => r.slot === 'map-day')
  assert.deepEqual(day.map((r) => [r.bgm, r.firstSeen, r.lastSeen, r.closed]), [[1, 100, 200, 300], [76, 300, 300, null]])

  // 启动回放：最近那份再灌一遍，一格不动
  const before = JSON.stringify(q.queryMapBgmHistory())
  q.observeMapBgm([SANMA_11], 300)
  assert.equal(JSON.stringify(q.queryMapBgmHistory()), before)
  // 比账本里最后见到的还旧的一份：不改（否则会把秋刀鱼的配法错收口）
  q.observeMapBgm([PLAIN_11], 250)
  assert.equal(JSON.stringify(q.queryMapBgmHistory()), before)
  // 空表、非数组：不动
  q.observeMapBgm([], 400)
  q.observeMapBgm(undefined, 400)
  assert.equal(JSON.stringify(q.queryMapBgmHistory()), before)
})
