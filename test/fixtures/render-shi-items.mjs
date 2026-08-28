// 把史的**道具视图整页**、开关的**初值读取**与**点击分支**原样切出来真编译一遍，
// 好让护栏对着产物 HTML 与真实的 config 键下断言。
//
// 为什么非得切真的（同 render-ru-berth 的理由）：「隐藏家具箱」开着时哪些行不见了、
// 上面四个数跟没跟着对，全是运行期算出来的——正则匹配源码一条也拦不住。
// 识别判据引真的那一份（shared/furniture-box），不补桩：桩一写成「按 id 认」，
// 「新变种自动落网」那一半就在测试里被抹掉了。
//
// 初值读取与点击分支一并切进来，是为了「读的键」与「写的键」对着同一个字符串验，
// 而不是去源码里肉眼比对两处字面量。
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

const SIGNED = cut('const signed = (value: number) =>', '\n', '带符号数 signed')
const DELTA_CLASS = cut('const deltaClass = (value: number) =>', '\n', '涨跌档 deltaClass')
const ITEM_NAME = cut('const itemName = (id: number) =>', '\n', '道具名 itemName')
const ITEM_VIEW = cut(
  'const itemViewHtml = (): string => {',
  '\nconst factoryRecipeText =',
  '道具视图整页',
)
const PERSISTED_INIT = cut(
  'let hideFurnitureBox = uiGet<boolean>',
  '\nlet loading = true',
  '开关初值读取',
)
const TOGGLE_CLICK = cut(
  "if (target.closest('[data-shi-hide-furniture]')) {",
  '\n      const item = target.closest<HTMLElement>',
  '开关点击分支',
)

const SHARED = path.join(ROOT, 'src', 'shared', 'furniture-box.ts').replace(/\\/g, '/')

const HARNESS = `
import { dropFurnitureBoxes, isFurnitureBoxId } from '${SHARED}'

type UseitemSummary = any
type UseitemHistoryChange = any

// ---- 可写的局（测试每条用例前 setup 一次）----
let useitemSummary: UseitemSummary[] = []
let itemChanges: UseitemHistoryChange[] = []
let useitemNames = new Map<number, string>()
let hideFurnitureBox = false
let selectedItemId = 0
export const mg: any = { useitems: {} }

// ---- 持久化：一份假 config，键名与值都要能被断言看见 ----
export const configStore: Record<string, unknown> = {}
export const configWrites: { key: string; value: unknown }[] = []
const uiGet = <T>(key: string, fallback: T): T => {
  const value = configStore['ui.' + key]
  return value === undefined || value === null ? fallback : (value as T)
}
const uiSet = (key: string, value: unknown) => {
  configStore['ui.' + key] = value
  configWrites.push({ key, value })
}

// 这一页真会执行到、但与「隐藏家具箱」无关的名字，一律给最平淡的桩。
let rendered = 0
const render = () => { rendered += 1 }
export const renderCount = () => rendered
const esc = (text: string) => String(text)
const fmtTime = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const entityTermHtml = (_kind: string, _id: number, name: string) => String(name)
const elink = (_kind: string, _id: number, name: string) => String(name)
const elinkHtml = (_kind: string, _id: number, inner: string) => String(inner)
const useItemIconHtml = (_id: number, _name: string, _opt?: any) => ''
// 氪金记录面板是同一页上的另一块，与这条护栏无关：留空，免得把整段账本管线拖进来
const payLogPanelHtml = () => ''
const causeOf = (_change: UseitemHistoryChange) => '推断'

${SIGNED}
${DELTA_CLASS}
${ITEM_NAME}
${ITEM_VIEW}

/** 摆一局。names 是主数据名表（api_mst_useitem 的 api_name）。 */
export const setup = (next: any = {}) => {
  useitemSummary = next.summaries ?? []
  itemChanges = next.changes ?? []
  useitemNames = new Map(next.names ?? [])
  hideFurnitureBox = next.hide === true
  selectedItemId = next.selectedItemId ?? 0
  mg.useitems = next.owned ?? {}
  rendered = 0
}

export const renderItems = () => itemViewHtml()
export const selectedItem = () => selectedItemId

/** 开关初值：照 shi.ts 本尊那一行读 config。 */
export const readPersisted = () => {
  ${PERSISTED_INIT}
  return hideFurnitureBox
}

/** 点一下开关：照 shi.ts 本尊那个分支跑。 */
export const clickToggle = () => {
  const target: any = {
    closest: (selector: string) => (selector === '[data-shi-hide-furniture]' ? {} : null),
  }
  ${TOGGLE_CLICK}
  throw new Error('开关分支没有接住这一下点击')
}

export const toggleState = () => hideFurnitureBox
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-shi-items-'))
  const entry = path.join(dir, 'items.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'items.cjs')
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

/** 主数据名表：三种家具箱 + 几件别的道具。名字照 api_mst_useitem 的日文原名。 */
export const MASTER_NAMES = [
  [10, '家具箱（小）'],
  [11, '家具箱（中）'],
  [12, '家具箱（大）'],
  [44, '改修資材'],
  [54, '勲章'],
  [68, '甲種勲章'],
]

export const setup = loaded.setup
export const renderItems = loaded.renderItems
export const readPersisted = loaded.readPersisted
export const clickToggle = loaded.clickToggle
export const toggleState = loaded.toggleState
export const selectedItem = loaded.selectedItem
export const configStore = loaded.configStore
export const configWrites = loaded.configWrites
export const renderCount = loaded.renderCount
