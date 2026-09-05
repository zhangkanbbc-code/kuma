import assert from 'node:assert/strict'
import test from 'node:test'

import overlap from '../dist/shared/quest-expedition-overlap.js'

const { buildExpeditionOverlap } = overlap

const expedition = (missionId, count = 1) => ({ kind: 'expedition', missionId, count })
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
    quests: [{ id: 1, code: 'D1' }, { id: 2, code: 'D2' }],
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
    (_, index) => ({ id: index + 1, code: `D${index + 1}` }),
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
    quests: [{ id: 1, code: 'D1' }, { id: 2, code: 'D2' }],
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
      { id: 1, code: 'D1' },
      { id: 2, code: 'D2' },
      { id: 3, code: 'D3' },
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
      { id: 1, code: 'D1' },
      { id: 2, code: 'D2' },
      { id: 3, code: 'D3' },
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
      { id: 1, code: 'D1' },
      { id: 2, code: 'D2' },
      { id: 3, code: 'D9' },
      { id: 4, code: 'D3' },
      { id: 5, code: 'D4' },
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
    quests: [{ id: 1, code: 'D1' }, { id: 2, code: 'D2' }],
    verdicts: new Map([[2, 'unknown']]),
  })
  assert.deepEqual(actual, [{
    questId: 2,
    status: 'unknown',
    items: [{ missionId: 4, count: 1 }],
  }])
})
