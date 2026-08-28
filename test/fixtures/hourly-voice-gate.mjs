// 把时报字幕那条延时路 **原样切出来** 真编译一遍，好让护栏对着「到底出没出字幕」下断言。
//
// 做法照搬 test/fixtures/render-ship-caption.mjs：整段从 voice-subtitle.ts 切走，
// 源码一个字不改，它引用到的外部名字在这里补桩。**不断言源码文本**——
// 门写反了（查成 `!mg.sortie?.active`）、门排在 setTimeout 外面（变成查排定时刻）、
// 或者写成顺延而不是丢弃，正则一条也拦不住。
//
// 时间不用 mock.timers：在 harness 作用域里 **遮蔽** setTimeout/clearTimeout，
// 被测代码引到的就是这一份。计时器攒在手上，用例自己决定什么时候「到点」，
// 顺手还能把排定的延迟拿出来核对。（mock.timers 忘了还原会让 node --test 无声挂住，
// 见 shared/node-test-mock-timers-hang。）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'voice-subtitle.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `voice-subtitle.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const BODY = sliceBetween(
  'const modeFor = (cue: VoiceRequestCue): CaptionMode => {',
  '/**\n * 路径 → 上一次为它出字幕的时刻',
  'modeFor + renderLine + scheduleLines + displayAtPlaybackTime',
)

const HARNESS = `
type VoiceRequestCue = any
type CaptionMode = any
type CaptionLine = any

// ---- 可注入的模块级状态（每个用例自己摆）----
export const stub: any = {
  sortie: null,
  lines: [],
  shown: [],
  timers: [],
}

// 母港态就是 sortie 为 null；出击/演习各摆各的。**读的是当下这一刻**，
// 用例可以在「排定」和「到点」之间把它换掉——门查的是哪一刻，一试便知。
const mg: any = { get sortie() { return stub.sortie } }

const captionsEnabled = true
const captionsFor = (_cue: VoiceRequestCue): CaptionLine[] => stub.lines
const showSubtitle = (line: CaptionLine) => { stub.shown.push({ mode: 'bottom', line }) }
const showDanmaku = (line: CaptionLine, direction: any) => { stub.shown.push({ mode: direction, line }) }

// ---- 遮蔽计时器：攒在手上，不真等 ----
let timerSeq = 0
const setTimeout: any = (fn: any, ms: number) => {
  const id = ++timerSeq
  stub.timers.push({ id, fn, ms })
  return id
}
const clearTimeout: any = (id: any) => {
  stub.timers = stub.timers.filter((entry: any) => entry.id !== id)
}

let hourlyTimer: any = null
const lineTimers = new Set<any>()

${BODY}

export { displayAtPlaybackTime, modeFor }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-hourly-gate-'))
  const entry = path.join(dir, 'hourly.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'hourly.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

/** 母港：`mg.sortie` 为 null。出击/演习按 kernel 的形状摆。 */
export const AT_PORT = null
export const ON_SORTIE = { active: true, practice: false, deckId: 1 }
export const IN_BATTLE = { active: true, practice: false, deckId: 1, battle: {} }
export const IN_PRACTICE = { active: true, practice: true, deckId: 1 }

const HOURLY_CUE = { kind: 'ship', mstId: 1, voiceId: 30 }

/**
 * 走一遍真路径：`atSchedule` 那一刻收到预取 → 换成 `atFire` 那一刻到点。
 *
 * 省略 `atFire` 就表示这两刻状态一样（到点时还在原地）。
 */
export const runHourly = ({ atSchedule = AT_PORT, atFire, cue = HOURLY_CUE, lines } = {}) => {
  const stub = loaded.stub
  stub.sortie = atSchedule
  stub.lines = lines ?? [{ speaker: '雪风', text: '一点です。', delay: 0 }]
  stub.shown = []
  stub.timers = []

  loaded.displayAtPlaybackTime(cue)
  const scheduled = stub.timers.map((entry) => entry.ms)
  const shownBeforeHour = stub.shown.length

  // ——到点——
  if (atFire !== undefined) stub.sortie = atFire
  const due = stub.timers.splice(0)
  for (const entry of due) entry.fn()

  return {
    /** 排定时挂了几个计时器、各自延迟多少毫秒 */
    scheduled,
    /** 到点之前就冒出来的字幕条数（时报路应恒为 0，否则就是剧透） */
    shownBeforeHour,
    /** 到点之后屏幕上出现的字幕 */
    shown: stub.shown,
    text: stub.shown.map((entry) => entry.line?.text ?? ''),
    /** 到点跑完还挂在手上的计时器——「丢弃不顺延」要求它是空的 */
    remaining: stub.timers.map((entry) => entry.ms),
  }
}

export const millisToNextHour = () => {
  const next = new Date()
  next.setHours(next.getHours() + 1, 0, 0, 0)
  return +next - Date.now()
}
