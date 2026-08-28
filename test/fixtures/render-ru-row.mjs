// 把锐的编成行（`shipRow`）**原样切出来**真编译一遍，好让护栏对着产物 HTML 下断言。
//
// 退避的退场态与那一次性的离场动画类都住在这一段里，而它俩是典型的
// 「写反了不报错、只在界面上悄悄错」——正则匹配源码一条也拦不住：
// `.leaving` 该不该出现取决于**上一帧见过谁**，那是运行期状态。
//
// 判据本体（shared/sortie-escape → kernel 的退避三件套）**引真的那一份**，不补桩：
// 桩一写成「escaped 里有就算」，「返港要解除」这一半就在测试里被抹掉了。
// 行里其余的名字（改造档位、装备芯片、疲劳……）给最平淡的桩——这一段护栏只看退场态。
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
const ru = read('src', 'renderer', 'modules', 'ru.ts')

const KERNEL_ESCAPE = cut(
  kernel,
  'export const sortieEscapedShips = (): SortieEscapedShip[] => escapedShipsOf(mg.sortie)',
  '// 开关（钥 · 击沉特效）',
  'kernel 的退避三件套',
)
// 一次性动画的记忆（seenEscaped）与 shipRow 是一体的，切在一起
const SHIP_ROW = cut(
  ru,
  '// 已经见过谁退避了。',
  '\n/**\n * 出击前的基地航空队体检。',
  '锐的编成行 shipRow',
)

const SORTIE_ESCAPE = path.join(ROOT, 'src', 'shared', 'sortie-escape.ts').replace(/\\/g, '/')

const HARNESS = `
import { escapedShipsOf } from '${SORTIE_ESCAPE}'

type SortieEscapedShip = any
type Deck = any
type PlayerShip = any

export const mg: any = { sortie: null, master: { ships: {} }, ndocks: [] }

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

// 这一行真会执行到的名字，一律给最平淡的桩；退场态之外的分支不是这条护栏的事。
export let sunkShipIds: number[] = []
export const setSunkShipIds = (ids: number[]) => { sunkShipIds = ids }
const isSunkInSortie = (rosterId: number) => sunkShipIds.includes(rosterId)
const sunkEffectsEnabled = () => true
const SANDBOX_DECK_ID = -1
const dockOf = (_id: number) => undefined
const shipIssues = (ship: any) => ({
  taiha: ship.nowhp / (ship.maxhp || 1) <= 0.25,
  chuuha: false,
  unsupplied: false,
  docked: false,
  tired: false,
})
const masterShipName = (mstId: number) => mg.master.ships[mstId]?.name ?? \`#\${mstId}\`
const progressiveRemodelOf = (_ship: any) => null
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const entityNameHtml = (_kind: string, _id: number, name: string, _o?: any) => esc(name)
const elinkHtml = (_kind: string, _id: number, body: string) => body
const specialAttackChipsHtml = (_deck: any) => ''
const shipAbilityChipsHtml = (_ship: any) => ''
const hpClassOf = (_ship: any, _docked: boolean) => 'ok'
const hpLabelOf = (_ship: any, _docked: boolean) => ''
const eventRunningNow = () => false
const equipChips = (_ship: any) => ''
const condHtml = (_ship: any) => ''
const shipThumbHtml = (_id: number, _name: string, _o?: any) => '<i class="thumb"></i>'
const shipArtDamaged = (_now: number, _max: number) => false
const expanded = new Set<number>()

${KERNEL_ESCAPE}

${SHIP_ROW}

export { shipRow, seenEscaped }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-ru-row-'))
  const entry = path.join(dir, 'row.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'row.cjs')
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
 * 摆一局：出击切片 + 主数据舰名。
 *
 * 顺手把「上一帧见过谁退避」清空——那是一次性动画的记忆，逐例都要从零开始，
 * 否则第二个用例会因为第一个用例已经播过而拿不到 .leaving。
 */
export const reset = ({ sortie = null, names = {}, sunk = [] } = {}) => {
  loaded.mg.sortie = sortie
  loaded.mg.master.ships = {}
  for (const [mstId, name] of Object.entries(names)) loaded.mg.master.ships[+mstId] = { name }
  loaded.setSunkShipIds(sunk)
  loaded.seenEscaped.clear()
}

/**
 * 只换出击切片，**不动**「上一帧见过谁退避」那份记忆。
 *
 * 专给「返港之后再退一次还会不会重播」那一例：要证明的正是记忆随状态自己落下，
 * 而不是靠谁记得去清它。
 */
export const setSortie = (sortie) => {
  loaded.mg.sortie = sortie
}

const DECK = { id: 1, name: '第一舰队', ships: [] }

/** 渲染一行。`ship` 只写这条护栏关心的字段。 */
export const renderRow = (ship, { deck = DECK, isFlag = false } = {}) =>
  loaded.shipRow(deck, { lv: 50, nowhp: 40, maxhp: 40, fuel: 0, bull: 0, slot: [], onslot: [], ...ship }, isFlag)
