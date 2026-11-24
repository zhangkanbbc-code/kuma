import assert from 'node:assert/strict'
import test from 'node:test'

import { ON_SORTIE, runHourly } from './fixtures/hourly-voice-gate.mjs'

const kumano = { kind: 'ship', mstId: 125, voiceId: 48 }
const suzuya = { kind: 'ship', mstId: 124, voiceId: 48 }
const line = (speaker) => ({ speaker, text: speaker + '报时', delay: 0 })
const runKumano = (beforeHour, atFire) => runHourly({
  cue: kumano,
  lines: [line('熊野')],
  decks: [{ id: 2, ships: [22] }, { id: 1, ships: [11] }],
  ships: { 11: { shipId: 125 }, 22: { shipId: 464 }, 33: { shipId: 124 } },
  filenames: { 125: 'mlzpthwviwnf', 464: 'mqlroxfnufpz', 124: 'lvmlqrzbobpe' },
  beforeHour,
  atFire,
})

test('第一舰队旗舰仍是熊野，整点出熊野字幕', () => {
  const run = runKumano()
  assert.equal(run.shownBeforeHour, 0)
  assert.deepEqual(run.text, ['熊野报时'])
})

test('维护者实测 2026-11-21：换成霞改二后没有新预取，整点丢弃熊野字幕', () => {
  const run = runKumano(({ decks }) => { decks[1].ships = [22, 11] })
  assert.deepEqual(run.text, [])
})

test('换铃谷后收到新报时请求，整点只出铃谷字幕', () => {
  const run = runKumano((state, display) => {
    state.decks[1].ships = [33]
    display(suzuya, [line('铃谷')])
    assert.equal(state.timers.length, 1)
  })
  assert.equal(run.shownBeforeHour, 0)
  assert.deepEqual(run.text, ['铃谷报时'])
})

test('到点缺第一舰队、在籍舰或音轨目录时照出', () => {
  assert.deepEqual(runKumano((state) => { state.decks = [state.decks[0]] }).text, ['熊野报时'])
  assert.deepEqual(runKumano((state) => { state.ships = {} }).text, ['熊野报时'])
  const run = runKumano((state) => {
    state.decks[1].ships = [22]
    delete state.filenames[464]
  })
  assert.deepEqual(run.text, ['熊野报时'])
})

test('合成同目录样本：旗舰形态与预取 mstId 不同也照出', () => {
  const run = runKumano((state) => {
    state.ships[11] = { shipId: 99999 }
    state.filenames[99999] = state.filenames[125]
  })
  assert.deepEqual(run.text, ['熊野报时'])
})

test('熊野仍是旗舰，但出击中到点就丢弃', () => {
  assert.deepEqual(runKumano(undefined, ON_SORTIE).text, [])
})
