// 把史的**道具流水归因**（CAUSE_LABEL + 窗口二分 + causeOf）原样切出来真编译一遍，
// 好让护栏问的是「这一笔会显示成哪四个字」，而不是「源码里有没有这行字面量」。
//
// 为什么不用正则钉源码：名表写对了、causeOf 却把兜底提前 return，正则照样绿。
// 窗口常数也一并切真的——用例里那句「同一秒内发生」得跟线上同一把尺子。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const shi = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'shi.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const cut = (from, to, label) => {
  const start = shi.indexOf(from)
  const end = shi.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `shi.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return shi.slice(start, end)
}

const WINDOW = cut('const CAUSE_WINDOW_MS =', '\n', '归因窗口 CAUSE_WINDOW_MS')
const CAUSE = cut(
  'const CAUSE_LABEL: Record<string, string> = {',
  '\n// ---- 本机氪金记录 ----',
  '原因名表与 causeOf',
)

const HARNESS = `
interface ActionEvent {
  ts: number
  path: string
  postBody: string | null
}
type UseitemHistoryChange = { ts: number }

// ---- 可写的局（每条用例前 setup 一次）----
let actionEvents: ActionEvent[] = []
let actionEarliest: number | null = null
let actionEventsLoaded = false

${WINDOW}

${CAUSE}

/** 摆一局。paths 按 ts 升序给（线上由 ledger 的 ORDER BY 保证，二分依赖它）。 */
export const setup = (next: any = {}) => {
  actionEvents = (next.events ?? []).map((e: any) => ({ ts: e.ts, path: e.path, postBody: null }))
  actionEarliest = next.earliest ?? null
  actionEventsLoaded = next.loaded !== false
}

/** 一笔道具变动落在 ts，问它显示成什么。 */
export const cause = (ts: number) => causeOf({ ts })
export const windowMs = () => CAUSE_WINDOW_MS
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-shi-cause-'))
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

export const setup = loaded.setup
export const cause = loaded.cause
export const windowMs = loaded.windowMs
