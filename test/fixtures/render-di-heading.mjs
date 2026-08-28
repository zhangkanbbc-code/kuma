// 把镝的战果槽（`outcomeBannerHtml`，含航行中那枚 ▶）真编出来渲染一遍，
// 好让护栏对着**渲染产物**下断言而不是源码文本。
//
// 用它的护栏：test/sortie-heading.test.mjs。
// 做法照搬 test/air-special-attack.test.mjs 的「渲染产物」一节：整段从 di.ts 原样切出来，
// 源码一个字不改，它引用到的外部名字在这里补桩。
// **角度算式（shared/sortie-route）用真的**——「不知道方向就别转」这类判据写反了
// 源码文本照样匹配得上，只有真渲染一遍才看得见产物里到底有没有那个 transform。
//
// 只补航行中/演习两条路上**真的会执行到**的名字；其余分支（结算/预测/防空…）里的
// 名字留成自由变量，那几条路这份护栏不走。
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

// 从**箭头形状那个常量**切起：headingArrowHtml 引用它，只切函数本身会漏掉它。
const BANNER = sliceBetween(
  'const HEADING_ARROW_SVG =',
  '// 对空CI 只有编号是游戏口径',
  '战果槽 HEADING_ARROW_SVG + headingArrowHtml + outcomeBannerHtml',
)

const HARNESS = `
import { sortieHeadingDeg } from './shared/sortie-route'

type SortieView = any
type BattleView = any

let fcdMap: any = null

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])
const mapKeyOf = (s: any): string => \`\${s.mapArea}-\${s.mapNo}\`
const BATTLE_EVENTS = new Set([4, 5, 7, 10])
const nodeEventName = (n: any): string => (n.eventId === 5 ? 'Boss 战' : '战斗')
// 与 di.ts 同义：边号查 route，查不到就照实写编号
const cellLetter = (s: any, cell: number): string =>
  fcdMap?.data?.[mapKeyOf(s)]?.route?.[cell]?.[1] ?? \`\${cell}\`

${BANNER}

export const setFcd = (data: any): void => {
  fcdMap = data ? { meta: {}, data } : null
}
export { outcomeBannerHtml }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-di-heading-'))
  fs.mkdirSync(path.join(dir, 'shared'))
  fs.copyFileSync(
    path.join(ROOT, 'src', 'shared', 'sortie-route.ts'),
    path.join(dir, 'shared', 'sortie-route.ts'),
  )
  const entry = path.join(dir, 'banner.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'banner.cjs')
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

/**
 * 渲染一次战果槽。
 *
 * `fcd` 是这一轮的随包海图（`{ "2-4": { route, spots } }`）；给 `{}` 就是
 * 「这张图不在资料里」那一档，用来验兜底那条腿。
 */
export const renderOutcomeBanner = (sortie, fcd = null) => {
  loaded.setFcd(fcd)
  return loaded.outcomeBannerHtml(sortie)
}
