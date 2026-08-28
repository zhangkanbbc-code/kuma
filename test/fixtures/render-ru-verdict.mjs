// 把锐的裁决框（`verdictHtml` 连同它新接上的分档判据 `sortieTaihaTier`）**原样切出来**
// 真编译一遍，好让护栏对着产物 HTML 下断言。
//
// 做法照搬 test/fixtures/render-ru-row.mjs：整段从 ru.ts 切走，源码一个字不改，
// 它引用到的外部名字在这里补桩。**不断言源码文本**——「风险句接的是哪一档」
// 是运行期判定，正则匹配 `tier === 'danger'` 这几个字对着写反的坐标一样会绿。
//
// 分档判定（shared/taiha-verdict）**引真的那一份**，不补桩：桩一写成「有大破就危险」，
// 二队旗舰的豁免有没有真接上就整个看不出来了。
// 联合的作用范围（inCombined / scopeShips / fleetShips）也一并切进来跑真的：
// 「联合时覆盖两队」正是坐标适配要对齐的那一条，桩掉就等于把要钉的东西钉在桩上。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(
  path.join(ROOT, 'src', 'renderer', 'modules', 'ru.ts'),
  'utf8',
).replace(/\r\n/g, '\n')

const cut = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ru.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const FLEET_SHIPS = cut(
  'const fleetShips = (deck: Deck): PlayerShip[] =>',
  '// ---- 模块状态 ----',
  '编成取数 fleetShips',
)
// 裁决框、它的分档判据、以及联合的作用范围切在一起：
// 坐标适配要对齐的正是「联合时两队怎么拼」，切了判据不切范围就对不上账。
const VERDICT = cut(
  '/**\n * 出击中的大破名单落在哪一档',
  'let lastSortieScreenCue = 0',
  '裁决框 verdictHtml（含 sortieTaihaTier / 联合作用范围）',
)

const TAIHA_VERDICT = path.join(ROOT, 'src', 'shared', 'taiha-verdict.ts').replace(/\\/g, '/')

const HARNESS = `
import {
  ESCORT_FLAGSHIP_INDEX,
  FLAGSHIP_INDEX,
  hasDameconEquipped,
  taihaVerdictOf,
  type TaihaShipRef,
} from '${TAIHA_VERDICT}'

type Deck = any
type PlayerShip = any

export const mg: any = {
  decks: [],
  ships: {},
  slotitems: {},
  master: { ships: {} },
  combinedFlag: 0,
  sortie: null,
}

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])

// 退避判据在这份护栏里不是被钉的对象（既有剔除本单不动），给一个由用例摆布的名单。
export let escapedIds: number[] = []
export const setEscaped = (ids: number[]) => { escapedIds = ids }
const engagedShips = <T extends { id: number }>(ships: readonly T[]): T[] =>
  ships.filter((ship) => !escapedIds.includes(ship.id))

// 破损档按血量比例给——那正是 shipIssues 里 taiha 那一条的真口径；
// 其余几项这条护栏不看，一律给「没问题」。
const dockOf = (_id: number) => undefined
const shipIssues = (ship: any) => ({
  taiha: ship.nowhp / (ship.maxhp || 1) <= 0.25,
  chuuha: ship.nowhp / (ship.maxhp || 1) > 0.25 && ship.nowhp / (ship.maxhp || 1) <= 0.5,
  unsupplied: false,
  docked: false,
  tired: false,
})
const masterShipName = (mstId: number) => mg.master.ships[mstId]?.name ?? \`#\${mstId}\`
const FATIGUE_READY_COND = 40
const fatigueReadyTs = (_id: number, _cond: number) => null
const fmtCountdownShort = (_ts: number) => '00:00'
// 陆航与札两枚芯片不是这条护栏的事，给空串（裁决框只是把它们原样挂上去）。
const airBaseFlagHtml = () => ''
const sallyFlagHtml = (_ships: any) => ''

${FLEET_SHIPS}
${VERDICT}

export { verdictHtml, sortieTaihaTier, inCombined, scopeShips }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-ru-verdict-'))
  const entry = path.join(dir, 'verdict.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'verdict.cjs')
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

/** 母港账本里的一艘舰；只有这条路真会读的那几个键。满血 50/50，5 就是大破。 */
export const shipOf = (id, patch = {}) => ({
  id,
  shipId: 100 + id,
  nowhp: 50,
  maxhp: 50,
  cond: 49,
  fuel: 99,
  bull: 99,
  slot: [-1, -1, -1, -1],
  slotEx: -1,
  ...patch,
})

/**
 * 摆一次母港账本 + 出击态。
 *
 * `fleets` 是「队号 → 该队的舰」（顺序就是舰位顺序，第 0 位是旗舰）；
 * `combinedFlag > 0` 才算联合编成（1/2 队合体）。
 */
export const setLedger = ({
  fleets,
  combinedFlag = 0,
  slotitems = {},
  sortieDeckId = 1,
  onSortie = true,
  escaped = [],
}) => {
  const ships = {}
  const decks = Object.entries(fleets).map(([id, list]) => {
    for (const ship of list) ships[ship.id] = ship
    return { id: Number(id), ships: list.map((ship) => ship.id) }
  })
  loaded.mg.decks = decks
  loaded.mg.ships = ships
  loaded.mg.slotitems = slotitems
  loaded.mg.combinedFlag = combinedFlag
  loaded.mg.sortie = onSortie
    ? { active: true, practice: false, deckId: sortieDeckId, mapArea: 3, mapNo: 5 }
    : null
  loaded.setEscaped(escaped)
  return decks
}

export const deckById = (id) => loaded.mg.decks.find((deck) => deck.id === id)
export const renderVerdict = (deckId = 1) => loaded.verdictHtml(deckById(deckId))
export const taihaTier = (deckId = 1) => loaded.sortieTaihaTier(deckById(deckId))
