// 把铃的「疲劳回复完成」那一轮探测**原样切出来**真跑一遍。
//
// 这条护栏管的是「谁该被跳过」：远征在途的队、出击在外的队，以及联合出击时随第 1
// 舰队一起在海上的第 2 舰队。这一族判断漏一格源码文本照样人畜无害——把那行 continue
// 删掉，任何正则都全绿，而玩家手机上会在打仗打到一半时收到「第2舰队 疲劳预计已恢复」。
//
// 判定本体引真的两份，不打桩：
// - `combinedEscortState`（从 kernel.ts 原样切走）——出击 / 编队两态的分界正是要守的东西；
// - `condRecoveryInfo`（从 lg.ts 原样切走）——「全队都恢复了才算」那道且判定。
// 桩只给最外围的三样：士气观测（fatigue.ts 的三个原语）、去重（fireOnce）、出口（notify）。
// 去重不是这条护栏要守的东西，桩成一张 Set 就够；notify 桩成记账，好数「响了几声」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const kernel = read('src', 'renderer', 'kernel.ts')
const lg = read('src', 'renderer', 'modules', 'lg.ts')

const cutFrom = (src, from, to, label) => {
  const start = src.indexOf(from)
  assert.ok(start >= 0, `切不到「${label}」的起点，这条守卫的锚点要跟着改`)
  const end = to === null ? src.length : src.indexOf(to, start + from.length)
  assert.ok(end > start, `切不到「${label}」的终点，这条守卫的锚点要跟着改`)
  return src.slice(start, end)
}

const ESCORT_STATE = cutFrom(
  kernel,
  "export type CombinedEscortState = 'sortie' | 'formed'",
  null,
  '内核的 combinedEscortState',
)

const COND_INFO = cutFrom(
  lg,
  'const condRecoveryInfo = (deckId: number)',
  '\nconst gameDayKey = ',
  '铃的 condRecoveryInfo',
)

// tickDetect 里的一段循环（不是一个函数），所以在这里裹进函数壳再编——
// 壳里只补一个 `now`，循环体一个字不改。
const COND_LOOP = cutFrom(
  lg,
  '  // 疲劳回复完成（后台计时推算 · 按舰队；远征中/出击中的队不看）',
  '\n  // 日/周/月任务重置前 2 小时未清',
  '铃的疲劳回复探测',
)

const HARNESS = `
export const mg: any = { decks: [], ships: {}, combinedFlag: 0, sortie: null }

// 士气观测：用例直接摆「这艘舰现在多少士气、几时能恢复」，真跑 condRecoveryInfo
export const condLedger = new Map<number, { cond: number; readyTs: number; est: number }>()
const FATIGUE_READY_COND = 30
const observedCond = (id: number) => {
  const seen = condLedger.get(id)
  return seen ? { cond: seen.cond, ts: 0 } : null
}
const fatigueReadyTs = (id: number, _target: number) => condLedger.get(id)?.readyTs ?? null
const estimatedCond = (id: number, _target: number) => condLedger.get(id)?.est ?? null

// 去重与出口：都不是这条护栏要守的东西
const firedKeys = new Set<string>()
const fireOnce = (key: string, fn: () => void) => {
  if (firedKeys.has(key)) return
  firedKeys.add(key)
  fn()
}
export const notices: { eventId: string; title: string; detail: string; ref: any }[] = []
const notify = (eventId: string, title: string, detail: string, ref?: any) => {
  notices.push({ eventId, title, detail, ref })
}

${ESCORT_STATE}
${COND_INFO}

export const detectCondRecovery = (now: number) => {
${COND_LOOP}
}

export const resetFired = () => firedKeys.clear()
`

const loaded = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-lg-cond-'))
  const entry = path.join(dir, 'cond.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'cond.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
})()

const NOW = 1_700_000_000_000

/**
 * 摆一局，跑一次探测，把发出去的通知交出来。
 *
 * `fleets`  每项 { id, mission?: [state, missionId, returnTs, 0], ships?: number[] }
 * `tired`   疲劳过、现已恢复的在籍 id（会在 NOW 之前到点）
 * `stillTired` 疲劳过、还没恢复的在籍 id
 * `combinedFlag` / `sortie` 同 render-combined-escort 的口径
 */
export const detectCond = ({ fleets = [], tired = [], stillTired = [], combinedFlag = 0, sortie = null } = {}) => {
  loaded.mg.decks = fleets.map((f) => ({
    id: f.id,
    mission: f.mission ?? [0, 0, 0, 0],
    ships: f.ships ?? [],
  }))
  loaded.mg.combinedFlag = combinedFlag
  loaded.mg.sortie = sortie
  loaded.condLedger.clear()
  // 士气 20（<30 即「疲劳过」）；恢复时刻落在 NOW 之前，估算值已回到 30 → 该响
  for (const id of tired) loaded.condLedger.set(id, { cond: 20, readyTs: NOW - 60_000, est: 30 })
  // 还没到点的：估算值仍低于 30，整队的 ready 就是 false
  for (const id of stillTired) loaded.condLedger.set(id, { cond: 20, readyTs: NOW + 600_000, est: 25 })
  loaded.notices.length = 0
  loaded.resetFired()
  loaded.detectCondRecovery(NOW)
  return [...loaded.notices]
}

/** 这一轮响过的舰队号 */
export const notifiedDeckIds = (notices) =>
  notices.map((n) => Number(/^第(\d+)舰队/.exec(n.title)?.[1] ?? -1))
