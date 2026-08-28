// 把「玩家真点了退避」那个归约器（两条 goback_port 端点共用的 onGobackPort）
// **原样切出来**真编译一遍，好让护栏喂真形状的会话、对着 sortie.escaped 下断言。
//
// ⚠️ **不许直接 import store.ts**：那个文件一 import 就会打开用户的真账本并跑迁移。
// 手法与 fixtures/practice-session-reducers.mjs、fixtures/store-anchorage-reducer.mjs 相同：
// 判据一个字不改。「連合第二队的位要不要偏移 6」这种事，正则写反了照样绿。
//
// 舰位换在籍 id 的规则本身在 shared/sortie-escape，这里**引真的那一份**、不补桩：
// 桩一写成「position 就是下标」，被修掉的坐标 bug 就在测试里复活了。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const GOBACK_PORT = sliceBetween(
  'const onGobackPort = (_body: any, _post: Record<string, string>, ts: number): Section[] => {',
  '// 换装/补给后游戏只回受影响的那个中队',
  '退避落账 onGobackPort',
)

const NEW_SORTIE = (() => {
  const head = 'const newSortie = (partial: Partial<SortieView>): SortieView => ({'
  const start = source.indexOf(head)
  assert.ok(start >= 0, 'store.ts 里找不到 newSortie，这条守卫的锚点要跟着改')
  const end = source.indexOf('\n})', start)
  assert.ok(end > start, 'newSortie 没有可识别的结尾')
  return source.slice(start, end + 3)
})()

// esbuild 是 bundle 模式、入口写在临时目录，所以给绝对路径（正斜杠，Windows 也认）
const SORTIE_ESCAPE = path.join(ROOT, 'src', 'shared', 'sortie-escape.ts').replace(/\\/g, '/')

const HARNESS = `
import { newEscapeEntries } from '${SORTIE_ESCAPE}'

type SortieView = any
type Section = string

export const state: any = {
  player: { ships: {}, decks: [], combinedFlag: 0 },
  master: { ships: {} },
  sortie: null,
}

export const warnings: string[] = []
// 模块作用域里遮住 console：被切出来的那句 console.warn 落进这张表，
// 既能断言它响过，又**不去动测试进程真正的 console**（改全局会漏到别的用例上）。
const console = {
  warn: (...args: any[]) => { warnings.push(args.map((one) => String(one)).join(' ')) },
}

${NEW_SORTIE}

export const onGobackPort = ${GOBACK_PORT.slice(GOBACK_PORT.indexOf('('))}

export { newSortie }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-escape-'))
  const entry = path.join(dir, 'escape.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'escape.cjs')
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
 * 摆一局。
 *
 * @param options.decks         `{ [deckId]: rosterId[] }`，编成位上的在籍 id（空位写 -1）
 * @param options.ships         `{ [rosterId]: { mstId, name } }`
 * @param options.combinedFlag  联合编成类型（0 = 不联合）
 * @param options.sortie        出击切片补丁；`null` = 没在出击
 * @param options.offer         上一场战果里的退避选项（undefined = 游戏没问过）
 */
export const reset = ({
  decks = { 1: [101, 102, 103, 104, 105, 106] },
  ships = {},
  combinedFlag = 0,
  sortie = {},
  offer,
} = {}) => {
  loaded.state.player.decks = Object.entries(decks).map(([id, list]) => ({ id: +id, ships: list }))
  loaded.state.player.ships = {}
  loaded.state.master.ships = {}
  for (const [id, one] of Object.entries(ships)) {
    loaded.state.player.ships[+id] = { id: +id, shipId: one.mstId }
    loaded.state.master.ships[one.mstId] = { name: one.name }
  }
  loaded.state.player.combinedFlag = combinedFlag
  loaded.state.sortie =
    sortie === null
      ? null
      : loaded.newSortie({
          deckId: 1,
          currentCell: 12,
          ...sortie,
          battle: offer === undefined ? (sortie.battle ?? null) : { result: { escapeOffer: offer } },
        })
  loaded.warnings.length = 0
}

/** 喂一条 goback_port（报文本身是空的——谁走了全靠上一场的 offer）。 */
export const feedGobackPort = (ts = 1_700_000_000_000) => loaded.onGobackPort({}, {}, ts)

export const sortie = () => loaded.state.sortie
export const warnings = () => loaded.warnings
