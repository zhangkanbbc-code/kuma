// 把「哪些操作会把泊地修理计时拨回 0」那几个 reducer **原样切出来**真编译一遍。
//
// ⚠️ **不许直接 import store.ts**：那个文件一 import 就会打开用户的真账本并跑迁移。
// 走切片编译这条路，与 fixtures/store-anchorage-reducer.mjs 同一手法。
//
// 为什么非得测真代码：重置清单是**有意留短**的（补给/装备/入渠/出撃 各家说法不一或只有
// 单源，一条都没进来），而「少调了一次 touchBerth」和「多调了一次」在源码文本上都很像。
// 尤其 `preset_select` 不重置这一条——它是「预设明石修理」那套玩法的前提，
// 哪天有人顺手给它补上一句 touchBerth，只有真跑一遍才拦得住。
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

const TOUCH_BERTH = sliceBetween(
  'const touchBerth = (deckId: number, ts: number) => {',
  '\n\n// 重启回灌',
  '计时拨零 touchBerth',
)

/** 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。 */
const asReducer = (name, head, label) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return `export const ${name} = ${source.slice(start + head.indexOf('('), end + 4)}`
}

const HENSEI = asReducer(
  'henseiChange',
  "'/kcsapi/api_req_hensei/change': (_body, post, ts) => {",
  '编成变更 reducer',
)
const PRESET = asReducer(
  'presetSelect',
  "'/kcsapi/api_req_hensei/preset_select': (body) => {",
  '预设展开 reducer',
)

const HARNESS = `
type Section = string

export const state: any = { player: { decks: [], berthSince: {} } }

// 预设展开真正做的事（把整支队换成预设内容）不是这条护栏要看的东西，
// 这里只需要它**被调过**，好证明 reducer 确实跑到了底。
export const deckUpdates: any[] = []
const applyDeckUpdates = (data: any, _replace: boolean) => { deckUpdates.push(data) }

${TOUCH_BERTH}

${HENSEI}
${PRESET}
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-berth-reducer-'))
  const entry = path.join(dir, 'reducer.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'reducer.cjs')
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

/** 摆一局：几支队各有哪些在籍舰 id（-1 = 空位）。 */
export const reset = (decks) => {
  loaded.state.player.decks = decks.map((d) => ({ id: d.id, ships: [...d.ships] }))
  loaded.state.player.berthSince = {}
  loaded.deckUpdates.length = 0
}

export const berthSince = () => ({ ...loaded.state.player.berthSince })
export const decks = () => loaded.state.player.decks.map((d) => ({ id: d.id, ships: [...d.ships] }))
export const deckUpdates = () => loaded.deckUpdates

/** 编成变更：`api_ship_id` 用游戏那套语义（-1 撤下该位，-2 旗舰以外全撤）。 */
export const henseiChange = ({ deckId, idx, shipId, ts }) =>
  loaded.henseiChange(
    null,
    { api_id: String(deckId), api_ship_idx: String(idx), api_ship_id: String(shipId) },
    ts,
  )

export const presetSelect = ({ deckId, ships, ts }) =>
  loaded.presetSelect({ api_id: deckId, api_ship: ships }, {}, ts)
