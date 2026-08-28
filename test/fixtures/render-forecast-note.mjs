// 把镝的「预测口径」折叠段（`forecastAssumptionsHtml`）真编出来渲染一遍。
//
// 用它的护栏：test/forecast-assumption-fold.test.mjs。
// 做法照搬 fixtures/render-di-heading.mjs：整段从 di.ts 原样切出来，源码一个字不改，
// 它引用到的外部名字（只有 esc）在这里补桩。
//
// 另把 di.ts 里那条折叠登记的选择器也切出来给护栏读：段根类名改了而登记没跟着改，
// 产物长得一模一样、折叠却当场失效——两边必须对着同一份文本核。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'di.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `di.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const NOTE = sliceBetween(
  'const forecastAssumptionsHtml =',
  'const preBattleIntelHtml =',
  '预测口径折叠段 forecastAssumptionsHtml',
)

const HARNESS = `
const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

${NOTE}

export { forecastAssumptionsHtml }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-forecast-note-'))
  const entry = path.join(dir, 'note.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'note.cjs')
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

/** 渲染一次「预测口径」段。入参就是模型给的 `band.assumptions`。 */
export const renderAssumptionsNote = (assumptions) => loaded.forecastAssumptionsHtml(assumptions)

/**
 * 镝 mount 时给这一段登记的折叠选择器（段根 / 段头）。
 *
 * 从 `installSectionFolding` 那份清单里认 `.prebattle-model-note` 那一条——
 * 认不到就说明登记被删了或改了名，折叠会静静地不生效，产物一个字都不变。
 */
export const foldSpecSelectors = (() => {
  const at = source.indexOf("section: '.prebattle-model-note'")
  assert.ok(at >= 0, 'di.ts 的 installSectionFolding 里没有「预测口径」那一条登记')
  const block = source.slice(at, source.indexOf('}', at))
  const head = /head: '([^']+)'/.exec(block)
  const title = /title: (\w+)/.exec(block)
  assert.ok(head && title, '「预测口径」那条登记缺 head 或 title')
  return { section: '.prebattle-model-note', head: head[1], title: title[1], block }
})()

/** 这一段有没有被写进「默认展开」名单——它必须**不在**里面。 */
export const foldSpecOpensByDefault = /openByDefault|openAllByDefault|alwaysOpen/.test(
  foldSpecSelectors.block,
)
