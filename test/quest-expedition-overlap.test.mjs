import assert from 'node:assert/strict'
import test from 'node:test'

import overlap from '../dist/shared/quest-expedition-overlap.js'

const { buildExpeditionOverlap } = overlap

const expedition = (missionId, count = 1) => ({ kind: 'expedition', missionId, count })
const quest = (id, code, pre = []) => ({ id, code, pre })
const run = ({
  questId = 1,
  trackers,
  quests,
  verdicts = new Map(),
  missionCodes = {},
}) =>
  buildExpeditionOverlap({
    questId,
    trackers,
    quests,
    verdictOf: (id) => verdicts.get(id),
    missionCodeOf: (id) => missionCodes[id] ?? `${id}`,
  })

test('a quest sharing one expedition is listed while the current quest is excluded', () => {
  const actual = run({
    trackers: {
      1: { tasks: [expedition(4)] },
      2: { tasks: [expedition(4, 2)] },
    },
    quests: [quest(1, 'D1'), quest(2, 'D2')],
  })
  assert.deepEqual(actual, [{ questId: 2, items: [{ missionId: 4, count: 2 }] }])
})

test('done, locked, and claimable quests are omitted while active, open, unknown, and unjudged quests remain', () => {
  const statuses = ['done', 'locked', 'claimable', 'active', 'open', 'unknown']
  const verdicts = new Map(statuses.map((status, index) => [index + 2, status]))
  const trackers = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [index + 1, { tasks: [expedition(4)] }]),
  )
  const quests = Array.from(
    { length: 8 },
    (_, index) => quest(index + 1, `D${index + 1}`),
  )
  const actual = run({ trackers, quests, verdicts })
  assert.deepEqual(actual.map(({ questId }) => questId), [5, 6, 7, 8])
  assert.deepEqual(actual.map(({ status }) => status), ['active', 'open', 'unknown', undefined])
  assert.equal(Object.hasOwn(actual[3], 'status'), false)
})

test('two shared expeditions from one quest are combined into one row', () => {
  const actual = run({
    trackers: {
      1: { tasks: [expedition(4), expedition(5)] },
      2: { tasks: [expedition(5, 3), expedition(4, 2)] },
    },
    quests: [quest(1, 'D1'), quest(2, 'D2')],
  })
  assert.deepEqual(actual, [{
    questId: 2,
    items: [{ missionId: 4, count: 2 }, { missionId: 5, count: 3 }],
  }])
})

test('an any-expedition quest is listed after quests sharing a specific expedition', () => {
  const actual = run({
    trackers: {
      1: { tasks: [expedition(4)] },
      2: { tasks: [expedition(0, 3)] },
      3: { tasks: [expedition(4)] },
    },
    quests: [
      quest(1, 'D1'),
      quest(2, 'D2'),
      quest(3, 'D3'),
    ],
  })
  assert.deepEqual(actual.map(({ questId }) => questId), [3, 2])
  assert.equal(actual.every((row) => !Object.hasOwn(row, 'status')), true)
})

test('a current quest with only an any-expedition condition returns no overlap', () => {
  const actual = run({
    trackers: {
      1: { tasks: [expedition(0, 3)] },
      2: { tasks: [expedition(0)] },
      3: { tasks: [expedition(4)] },
    },
    quests: [
      quest(1, 'D1'),
      quest(2, 'D2'),
      quest(3, 'D3'),
    ],
  })
  assert.deepEqual(actual, [])
})

test('numeric expedition codes sort numerically before alphabetic codes and ties sort by quest code', () => {
  const actual = run({
    trackers: {
      1: { tasks: [expedition(103), expedition(110), expedition(201)] },
      2: { tasks: [expedition(110)] },
      3: { tasks: [expedition(103)] },
      4: { tasks: [expedition(201)] },
      5: { tasks: [expedition(103)] },
    },
    quests: [
      quest(1, 'D1'),
      quest(2, 'D2'),
      quest(3, 'D9'),
      quest(4, 'D3'),
      quest(5, 'D4'),
    ],
    missionCodes: { 103: '3', 110: '10', 201: 'A1' },
  })
  assert.deepEqual(actual.map(({ questId }) => questId), [5, 3, 2, 4])
  assert.equal(actual.every((row) => !Object.hasOwn(row, 'status')), true)
})

test('unknown verdict is passed through as unknown', () => {
  const actual = run({
    trackers: {
      1: { tasks: [expedition(4)] },
      2: { tasks: [expedition(4)] },
    },
    quests: [quest(1, 'D1'), quest(2, 'D2')],
    verdicts: new Map([[2, 'unknown']]),
  })
  assert.deepEqual(actual, [{
    questId: 2,
    status: 'unknown',
    items: [{ missionId: 4, count: 1 }],
  }])
})

test('ancestors and descendants are omitted from quests that can be completed together', () => {
  // 手算：D2 的祖先是 D1，后代是 D3、D4；D5 与任务链无关，所以只留 D5。
  const quests = [
    quest(1, 'D1'),
    quest(2, 'D2', ['D1']),
    quest(3, 'D3', ['D2']),
    quest(4, 'D4', ['D3']),
    quest(5, 'D5'),
  ]
  const trackers = Object.fromEntries(quests.map(({ id }) => [id, { tasks: [expedition(4)] }]))
  const actual = run({ questId: 2, trackers, quests })
  assert.deepEqual(actual.map(({ questId }) => questId), [5])
})

test('either side of multiple prerequisites counts as an ancestor', () => {
  // 手算：D2 同时要 D1 和「兼」，两条都是直接上级；D3 无关，所以只留 D3。
  const quests = [
    quest(1, 'D1'),
    quest(2, 'D2', ['D1', '兼']),
    quest(3, '兼'),
    quest(4, 'D3'),
  ]
  const trackers = Object.fromEntries(quests.map(({ id }) => [id, { tasks: [expedition(4)] }]))
  const actual = run({ questId: 2, trackers, quests })
  assert.deepEqual(actual.map(({ questId }) => questId), [4])
})

test('a circular prerequisite chain terminates and remains excluded', () => {
  // 手算：C1→C2→C1 成环，已访问节点不再走；C2 是链上亲属，C3 无关，所以只留 C3。
  const quests = [
    quest(1, 'C1', ['C2']),
    quest(2, 'C2', ['C1']),
    quest(3, 'C3'),
  ]
  const trackers = Object.fromEntries(quests.map(({ id }) => [id, { tasks: [expedition(4)] }]))
  const actual = run({ questId: 1, trackers, quests })
  assert.deepEqual(actual.map(({ questId }) => questId), [3])
})
