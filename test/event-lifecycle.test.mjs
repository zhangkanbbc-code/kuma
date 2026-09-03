import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import ts from 'typescript'

import lifecycleModule from '../dist/shared/event-lifecycle.js'

const { eventLifecycleOf } = lifecycleModule
const jiSource = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

const compileJiDeclaration = (start, end) => {
  const source = jiSource.slice(jiSource.indexOf(start), jiSource.indexOf(end))
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const eventPeriodDeclaration = compileJiDeclaration(
  'const eventPeriodOf =',
  'const selectedMapDifficulty =',
)
const eventPeriodOf = new Function(
  'eventAreaIds',
  'EVENT_DIFFICULTIES',
  'mapIntelMap',
  'eventLifecycleOf',
  'eventLifecycleLode',
  'mg',
  'eventArchives',
  'fmtDate',
  `${eventPeriodDeclaration}\nreturn eventPeriodOf`,
)
const eventLifecycleCreditDeclaration = compileJiDeclaration(
  'const eventLifecycleCredit =',
  'const allowedFleets =',
)
const eventLifecycleCreditOf = new Function(
  'eventPeriod',
  'eventLifecycleLode',
  'EVENT_DIFFICULTIES',
  'mapIntelMap',
  'code',
  `${eventLifecycleCreditDeclaration}\nreturn eventLifecycleCredit`,
)

const periodHarness = (pack, intel) => {
  const eventLifecycleLode = { meta: { id: 'event-lifecycle' }, data: pack }
  const period = eventPeriodOf(
    new Set([62]),
    ['甲', '乙', '丙', '丁'],
    (code) => (code === '62-1' ? { event: intel } : null),
    eventLifecycleOf,
    eventLifecycleLode,
    { eventAreas: { 62: { closed: false } } },
    null,
    (ts) => new Date(ts).toISOString().slice(0, 10),
  )({ api_maparea_id: 62, api_no: 1 })
  const credit = eventLifecycleCreditOf(
    period,
    eventLifecycleLode,
    ['甲', '乙', '丙', '丁'],
    (code) => (code === '62-1' ? { event: intel } : null),
    '62-1',
  )
  return { period, credit, eventLifecycleLode }
}

test('活动生命周期按海域取条目，并取最早一期的开图时间', () => {
  const pack = {
    schemaVersion: 1,
    events: [
      {
        mapAreaId: 61,
        name: '上一期活动',
        from: '2026-01-01',
        until: '2026-02-01',
        status: 'ended',
        phases: [{ openedAt: '2026-01-01T12:00:00+09:00', maps: [1] }],
      },
      {
        mapAreaId: 62,
        name: '反撃！第三十一戦隊の戦い',
        from: '2026-07-08',
        until: '2026-09-10',
        status: 'active',
        phases: [
          { openedAt: '2026-07-19T02:03:00+09:00', maps: [4, 5] },
          { openedAt: '2026-07-08T21:59:00+09:00', maps: [1, 2, 3] },
        ],
      },
    ],
  }

  assert.deepEqual(eventLifecycleOf(pack, 62), {
    name: '反撃！第三十一戦隊の戦い',
    from: '2026-07-08',
    until: '2026-09-10',
    status: 'active',
    phaseOpenedAt: '2026-07-08T21:59:00+09:00',
  })
  assert.equal(eventLifecycleOf(pack, 63), null)
  assert.equal(eventLifecycleOf(undefined, 62), null)
})

test('第一方生命周期与 map-intel event 同时存在时以第一方为准并署第一方包', () => {
  const pack = {
    schemaVersion: 1,
    events: [
      {
        mapAreaId: 62,
        name: '第一方登记',
        from: '2026-07-08',
        until: '2026-09-10',
        status: 'active',
        phases: [{ openedAt: '2026-07-08T21:59:00+09:00', maps: [1] }],
      },
    ],
  }
  const intel = {
    name: '旧 map-intel',
    from: '2026-07-01',
    until: null,
    status: 'active',
    phaseOpenedAt: '2026-07-01T12:00:00+09:00',
  }

  const { period, credit, eventLifecycleLode } = periodHarness(pack, intel)
  assert.deepEqual(period, {
    active: true,
    ended: false,
    text: '2026/07/08—2026/09/10',
    basis: '离线活动资料',
    source: 'lifecycle',
  })
  assert.equal(credit, eventLifecycleLode)
})

test('第一方生命周期没有该海域时退回 map-intel event 且不署第一方包', () => {
  const pack = {
    schemaVersion: 1,
    events: [
      {
        mapAreaId: 61,
        name: '上一期活动',
        from: '2026-01-01',
        until: '2026-02-01',
        status: 'ended',
        phases: [{ openedAt: '2026-01-01T12:00:00+09:00', maps: [1] }],
      },
    ],
  }
  const intel = {
    name: 'map-intel 兜底',
    from: '2026-07-01',
    until: '2026-09-01',
    status: 'active',
    phaseOpenedAt: '2026-07-01T12:00:00+09:00',
  }

  const { period, credit } = periodHarness(pack, intel)
  assert.deepEqual(period, {
    active: true,
    ended: false,
    text: '2026/07/01—2026/09/01',
    basis: '离线活动资料',
    source: 'intel',
  })
  assert.equal(credit, null)
})
