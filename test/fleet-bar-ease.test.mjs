// 编队血条、油弹条的平滑过渡（维护者裁决 2026-11-26：动画要客观、要有过渡）。
//
// 从 ru.ts 原样切出 easeFleetBars 那一段跑真代码，外部只补 dockOf / hitShakeEnabled 与一副假 DOM：
// 行按 data-ship 认，三根条子的宽度读行内 style，animate() 只记账（关键帧、时长、接续进度）。
// 钉的是「哪根条子走、从哪走到哪、什么时候不走」——这些写反了源码文本照样匹配得上。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ru.ts'), 'utf8').replace(/\r\n/g, '\n')
const from = source.indexOf('// ---- 血条、油弹条跟着数值平滑走')
const to = source.indexOf('const makeSvgEl = ', from)
assert.ok(from >= 0 && to > from, 'ru.ts 里找不到 easeFleetBars 那一段，这条测试的锚点要跟着改')

const HARNESS = `
export const env = { docked: new Set<number>(), hitShake: false, hidden: false, reduced: false }
const dockOf = (id: number) => (env.docked.has(id) ? { shipId: id } : undefined)
const hitShakeEnabled = () => env.hitShake
${source.slice(from, to)}
export { easeFleetBars, BAR_EASE_MS }
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-bar-ease-'))
fs.writeFileSync(path.join(dir, 'entry.ts'), HARNESS)
const out = path.join(dir, 'entry.cjs')
buildSync({ entryPoints: [path.join(dir, 'entry.ts')], bundle: true, format: 'cjs', platform: 'node', outfile: out, logLevel: 'silent' })

const animations = []
globalThis.document = { get visibilityState() { return lib.env.hidden ? 'hidden' : 'visible' } }
globalThis.window = { matchMedia: () => ({ matches: lib.env.reduced }) }
const lib = createRequire(import.meta.url)(out)

const barEl = (ship, key, width) => ({
  style: { width: `${width}%` },
  animate(frames, options) {
    const run = { ship, key, frames: frames.map((f) => f.width), duration: options.duration, currentTime: 0 }
    animations.push(run)
    return run
  },
})
const rowOf = (ship, { hp, fuel = 100, ammo = 100 }) => {
  const bars = {
    '.hpc .bar > i': barEl(ship, 'hp', hp),
    '.fa2 .fuel > i': barEl(ship, 'fuel', fuel),
    '.fa2 .ammo > i': barEl(ship, 'ammo', ammo),
  }
  return { dataset: { ship: String(ship) }, querySelector: (selector) => bars[selector] ?? null }
}
// 一次「提交新 DOM」：整块换成新元素（与 commitPaneHtml 换 innerHTML 同一回事）
const paneOf = (rows) => {
  const list = Object.entries(rows).map(([ship, widths]) => rowOf(Number(ship), widths))
  return {
    querySelectorAll: (selector) => (selector === '.fleet-body .ship[data-ship]' ? list : []),
    querySelector: (selector) => list.find((row) => selector === `.fleet-body .ship[data-ship="${row.dataset.ship}"]`) ?? null,
  }
}
// 每次提交默认先把时钟拨过一整段过渡（420ms），免得相邻两次提交被当成「重画后接着走」；
// 专测接续的那一条自己传 gap
let clock = null
const commit = (rows, { view = 'fleet:1', busy = [], gap = 1000 } = {}) => {
  clock?.tick(gap)
  animations.length = 0
  lib.easeFleetBars(paneOf(rows), view, new Set(busy))
  return animations.map(({ ship, key, frames, currentTime }) => ({ ship, key, frames, currentTime }))
}
const reset = (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  clock = t.mock.timers
  Object.assign(lib.env, { hitShake: false, hidden: false, reduced: false })
  lib.env.docked.clear()
  commit({}, { view: '' })
}

test('补给：油弹两根从旧值走到新值，血条没变不动；时长 420ms', (t) => {
  reset(t)
  commit({ 1: { hp: 80, fuel: 40, ammo: 60 } })
  assert.deepEqual(commit({ 1: { hp: 80, fuel: 100, ammo: 100 } }), [
    { ship: 1, key: 'fuel', frames: ['40%', '100%'], currentTime: 0 },
    { ship: 1, key: 'ammo', frames: ['60%', '100%'], currentTime: 0 },
  ])
  assert.equal(lib.BAR_EASE_MS, 420)
})

test('被弹动画关着：扣血、回血都平滑走；开着时扣血让给残影，回血照走', (t) => {
  reset(t)
  commit({ 1: { hp: 80 } })
  assert.deepEqual(commit({ 1: { hp: 30 } }).map((a) => a.frames), [['80%', '30%']])
  lib.env.hitShake = true
  assert.deepEqual(commit({ 1: { hp: 10 } }), [], '被弹动画开着时扣血由残影下降负责')
  assert.deepEqual(commit({ 1: { hp: 100 } }).map((a) => a.frames), [['10%', '100%']])
})

test('换页签、首次出现、修理演出在播：一律不走', (t) => {
  reset(t)
  commit({ 1: { hp: 50 } }, { view: 'fleet:1' })
  assert.deepEqual(commit({ 1: { hp: 90 } }, { view: 'fleet:2' }), [], '换了一屏不是数值变了')
  assert.deepEqual(commit({ 1: { hp: 90 }, 2: { hp: 40 } }, { view: 'fleet:2' }), [], '新出现的舰没有旧值')
  assert.deepEqual(commit({ 1: { hp: 20 }, 2: { hp: 100 } }, { view: 'fleet:2', busy: [2] }).map((a) => a.ship), [1])
  assert.deepEqual(commit({ 1: { hp: 70 } }, { view: '' }), [], '不在编队页')
})

test('入渠、出渠那一下血条宽度变了但血量没变：血条不走，油弹照常', (t) => {
  reset(t)
  commit({ 1: { hp: 30, fuel: 60 } })
  lib.env.docked.add(1)
  assert.deepEqual(commit({ 1: { hp: 45, fuel: 100 } }).map((a) => a.key), ['fuel'])
  lib.env.docked.delete(1)
  assert.deepEqual(commit({ 1: { hp: 100, fuel: 100 } }), [])
})

test('过渡途中又重画：新元素从已走过的进度接着走，不重头来', (t) => {
  reset(t)
  commit({ 1: { hp: 20 } })
  assert.deepEqual(commit({ 1: { hp: 90 } }).map((a) => a.currentTime), [0])
  assert.deepEqual(commit({ 1: { hp: 90 } }, { gap: 250 }), [{ ship: 1, key: 'hp', frames: ['20%', '90%'], currentTime: 250 }])
  assert.deepEqual(commit({ 1: { hp: 90 } }, { gap: 250 }), [], '走完之后重画就不再补')
  // 途中数值又变了、而这一下不归这里走（被弹动画开着时扣血）：不重播旧的那段
  commit({ 1: { hp: 30 } })
  lib.env.hitShake = true
  assert.equal(commit({ 1: { hp: 10 } }, { gap: 100 }).length, 0)
})

test('页面看不见或系统要求减少动画：不走，也不留半截账', (t) => {
  reset(t)
  commit({ 1: { hp: 20 } })
  lib.env.reduced = true
  assert.deepEqual(commit({ 1: { hp: 90 } }), [])
  lib.env.reduced = false
  lib.env.hidden = true
  assert.deepEqual(commit({ 1: { hp: 40 } }), [])
  lib.env.hidden = false
  assert.deepEqual(commit({ 1: { hp: 60 } }).map((a) => a.frames), [['40%', '60%']], '恢复后按最近一次提交的宽度为起点')
})
