// 道具履历「变动原因」那一列：把史的归因判据**原样切出来**真编译一遍。
//
// 渲染层打成 bundle，import 不进来；而这段的判据（窗口右端二分、120 秒窗口、
// 端点 → 标签）写反了照样能跑——正则匹配源码分不出「取窗口右端」和「取左端」，
// 所以切真码，喂真事件表下断言。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'shi.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf(to, start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return source.slice(start, end)
}

const WINDOW = sliceBetween('const CAUSE_WINDOW_MS = ', '\n', '归因时间窗')
const CAUSE = sliceBetween(
  'const CAUSE_LABEL: Record<string, string> = {',
  '\n// ---- 本机氪金记录 ----',
  '归因表与 causeOf',
)

const HARNESS = `
type ActionEvent = { ts: number; path: string; postBody: string | null }
type UseitemHistoryChange = { ts: number; delta: number; total: number }

let actionEvents: ActionEvent[] = []
let actionEarliest: number | null = null
let actionEventsLoaded = false

export const load = (events: ActionEvent[], earliest: number | null, loaded = true) => {
  actionEvents = events
  actionEarliest = earliest
  actionEventsLoaded = loaded
}

${WINDOW}

${CAUSE}

export { causeOf, CAUSE_LABEL, CAUSE_WINDOW_MS }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-cause-'))
  const entry = path.join(dir, 'cause.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'cause.cjs')
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

/** 摆一份主进程交回来的操作事件表（按 ts 升序，与 queryActionEvents 的 ORDER BY 同）。 */
export const load = (events, earliest = null, isLoaded = true) =>
  loaded.load(events, earliest, isLoaded)
export const causeOf = (change) => loaded.causeOf(change)
export const causeLabel = () => loaded.CAUSE_LABEL
export const causeWindowMs = () => loaded.CAUSE_WINDOW_MS
