// 退避的**消费侧**：谁读了那份名单、读完做对了没有。
//
// 三段原样切出来编一遍，共用同一份 `mg`：
//   · kernel 的退避三件套（sortieEscapedShips / escapedInSortie / isEscapedInSortie）
//   · fleet-calc 的 `engagedShips`（制空/索敌/输送量/大破名单都从它过一道）
//   · 铃（lg.ts）的 `detectTaiha`（大破警告对已退避的舰不再喊）
//
// 判据本体 shared/sortie-escape 与 shared/taiha-verdict **都引真的那一份**，不补桩：
// 桩一写成「escaped 里有就算」就把「返港要解除」这一半在测试里抹掉了，
// 大破分档同理——补一个永远返回红档的桩，就看不出旗舰特例有没有接上。
// 这几个文件顶层都要 electron / @electron/remote，直接 import 载不进 node --test，
// 所以走切片编译这条路，与 fixtures/render-di-battle.mjs 同一手法。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const cut = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const kernel = read('src', 'renderer', 'kernel.ts')
const fleetCalc = read('src', 'renderer', 'fleet-calc.ts')
const lg = read('src', 'renderer', 'modules', 'lg.ts')

const KERNEL_ESCAPE = cut(
  kernel,
  'export const sortieEscapedShips = (): SortieEscapedShip[] => escapedShipsOf(mg.sortie)',
  '// 开关（钥 · 击沉特效）',
  'kernel 的退避三件套',
)
const ENGAGED = cut(
  fleetCalc,
  'export const engagedShips =',
  '\nexport interface Los33',
  'fleet-calc 的 engagedShips',
)
// 这一段连 protected 档的出击级去重（protectedTaihaSeen）一起切进来——它就住在
// taihaSeen 旁边。那一档的行为本身钉在 test/taiha-verdict-consumers.test.mjs，
// 这里只需要它能编译、能跑：所以上面的 import 要把它用到的名字带齐。
const DETECT_TAIHA = cut(
  lg,
  'let taihaSeen = new Set<string>()',
  '\n// 应急修理（要員 42 / 女神 43）',
  '铃的大破警告 detectTaiha',
)

// esbuild 是 bundle 模式、入口写在临时目录，所以给绝对路径（正斜杠，Windows 也认）
const SORTIE_ESCAPE = path.join(ROOT, 'src', 'shared', 'sortie-escape.ts').replace(/\\/g, '/')
const TAIHA_VERDICT = path.join(ROOT, 'src', 'shared', 'taiha-verdict.ts').replace(/\\/g, '/')

const HARNESS = `
import { escapedShipsOf } from '${SORTIE_ESCAPE}'
import { ESCORT_FLAGSHIP_INDEX, flagshipHasDameconIn, isTaihaShip, taihaVerdictOf } from '${TAIHA_VERDICT}'

type SortieEscapedShip = any
type BattleShipView = any
type EntityRef = any

// ships / slotitems 是旗舰 damecon 的账本回退要查的两张表；这几条切片不测那条路，
// 摆成空表即可（查不到就是没带，与真代码同一个答案）。
export const mg: any = { sortie: null, ships: {}, slotitems: {} }

// 铃那一段真会执行到的外部名字；其余分支里的留成自由变量。
export const notices: any[] = []
const notify = (kind: string, title: string, detail: string, ref?: any, opts?: any) => {
  notices.push({ kind, title, detail, ref, opts })
}
const entityNamePlain = (_kind: string, _mstId: number, name: string) => name
const heldQueue: any[] = []
const dndActive = () => false
const flushHeld = () => {}

${KERNEL_ESCAPE}

${ENGAGED}

${DETECT_TAIHA}

export { detectTaiha }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-escape-consumers-'))
  const entry = path.join(dir, 'consumers.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'consumers.cjs')
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

/** 摆一份出击切片（null = 没在出击）。 */
export const setSortie = (sortie) => {
  loaded.mg.sortie = sortie
  loaded.notices.length = 0
}

export const engagedShips = (ships) => loaded.engagedShips(ships)
export const isEscapedInSortie = (rosterId) => loaded.isEscapedInSortie(rosterId)
export const escapedInSortie = (rosterId) => loaded.escapedInSortie(rosterId)
export const detectTaiha = () => loaded.detectTaiha()
export const notices = () => loaded.notices
