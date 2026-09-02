import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { buildSync } from 'esbuild'

const built = buildSync({
  entryPoints: ['src/renderer/fatigue.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
})
const module = { exports: {} }
new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports)
const {
  FATIGUE_FULL_COND,
  FATIGUE_READY_COND,
  RED_FATIGUE_COND,
  estimatedCond,
  fatigueBand,
  fatigueReadyTs,
  fleetFatigueEta,
  observeFatigue,
} = module.exports

test('fatigue bands follow the game red, orange, and ready boundaries', () => {
  assert.equal(RED_FATIGUE_COND, 20)
  assert.equal(FATIGUE_READY_COND, 30)
  assert.equal(fatigueBand(19), 'red')
  assert.equal(fatigueBand(20), 'orange')
  assert.equal(fatigueBand(29), 'orange')
  assert.equal(fatigueBand(30), 'ready')
})

test('fatigue recovery reminders default to condition 30', () => {
  const observedAt = 1_000_000
  observeFatigue([{ id: 7, cond: 17 }], observedAt, true)
  assert.equal(fatigueReadyTs(7), observedAt + 5 * 180_000)
  assert.equal(estimatedCond(7, FATIGUE_READY_COND, observedAt + 4 * 180_000), 29)
  assert.equal(estimatedCond(7, FATIGUE_READY_COND, observedAt + 5 * 180_000), 30)
})

test('fleet header labels the future full-morale time as estimated', () => {
  const ru = fs.readFileSync(new URL('../src/renderer/modules/ru.ts', import.meta.url), 'utf8')
  assert.match(ru, /title = `全队预计回满至 \$\{FATIGUE_FULL_COND\}/)
  assert.match(ru, />预计回满 \$\{fmtTime\(ts\)\}<\/small>/)
  assert.doesNotMatch(ru, />士气回满 \$\{fmtTime\(ts\)\}<\/small>/)
})

// 编队抬头那格「士气回满 HH:MM:SS」的算式。守两件事：
// ① 它就是舰行那份单舰估算取 max，不许长出第二套推算；
// ② 缺观测锚点的舰不许被当成「她回满了」——那正是「说没有之前先穷举」那条的形状。
test('fleet fatigue eta is the latest single-ship estimate in the fleet', () => {
  const observedAt = 2_000_000
  observeFatigue(
    [
      { id: 11, cond: 20 }, // 到 49 要 ceil(29/3)=10 步
      { id: 12, cond: 40 }, // 到 49 要 ceil(9/3)=3 步
      { id: 13, cond: 49 }, // 已经到顶，不参与
    ],
    observedAt,
    true,
  )
  assert.equal(FATIGUE_FULL_COND, 49)
  const latest = fatigueReadyTs(11, FATIGUE_FULL_COND)
  assert.equal(latest, observedAt + 10 * 180_000)
  // 全队取的就是最晚那艘的那个数，逐字节相等
  assert.deepEqual(
    fleetFatigueEta(
      [
        { id: 11, cond: 20 },
        { id: 12, cond: 40 },
        { id: 13, cond: 49 },
      ],
      FATIGUE_FULL_COND,
      observedAt,
    ),
    { ts: latest, unknown: 0 },
  )
  // 过了那个点：全队都回满，ts 归 null（抬头那格翻成「士气已回满」）
  assert.deepEqual(
    fleetFatigueEta(
      [
        { id: 11, cond: 20 },
        { id: 12, cond: 40 },
      ],
      FATIGUE_FULL_COND,
      latest,
    ),
    { ts: null, unknown: 0 },
  )
  // 目标位换成 30 就该退回舰行那一档，同一个函数、同一个锚点
  assert.deepEqual(
    fleetFatigueEta([{ id: 11, cond: 20 }], FATIGUE_READY_COND, observedAt),
    { ts: fatigueReadyTs(11, FATIGUE_READY_COND), unknown: 0 },
  )
  // 没观测过的舰：算不出时刻就如实计数，绝不静默当成已回满
  assert.deepEqual(
    fleetFatigueEta([{ id: 999, cond: 12 }], FATIGUE_FULL_COND, observedAt),
    { ts: null, unknown: 1 },
  )
})
