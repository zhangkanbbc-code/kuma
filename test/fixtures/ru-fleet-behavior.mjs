// 把铃的出击就绪提醒与札提醒循环原样切出来运行。
// 判定本体 deckOnSortie 引 kernel 真码；外围只为舰队状态、问题计数与通知出口提供最小桩。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const kernel = read('src', 'renderer', 'kernel.ts')
const ru = read('src', 'renderer', 'modules', 'ru.ts')

const cutFrom = (src, from, to, label) => {
  const start = src.indexOf(from)
  assert.ok(start >= 0, `切不到「${label}」的起点，这条守卫的锚点要跟着改`)
  const end = to === null ? src.length : src.indexOf(to, start + from.length)
  assert.ok(end > start, `切不到「${label}」的终点，这条守卫的锚点要跟着改`)
  return src.slice(start, end)
}

const ESCORT_STATE = cutFrom(
  kernel,
  'export const deckOnSortie =',
  null,
  '内核的 deckOnSortie / combinedEscortState',
)
const READINESS = cutFrom(
  ru,
  'let lastSortieScreenCue = 0',
  '\nonSortieScreen(warnSortieReadiness)',
  '铃的出击画面就绪提醒',
)
const SALLY_LOOP = cutFrom(
  ru,
  '  if (eventArea) {',
  '\n  // 陆航：只数摊开这个区的中队',
  '铃的札提醒舰队循环',
)

const HARNESS = `
type Deck = any
type PlayerShip = any

export const mg: any = {
  decks: [],
  ships: {},
  slotitems: {},
  basic: null,
  combinedFlag: 0,
  sortie: null,
}

${ESCORT_STATE}

const fleetShips = (deck: Deck): PlayerShip[] => deck.ships
const inCombined = (deck: Deck) => mg.combinedFlag > 0 && (deck.id === 1 || deck.id === 2)
const scopeShips = (deck: Deck): PlayerShip[] =>
  inCombined(deck)
    ? mg.decks.filter((entry: Deck) => entry.id === 1 || entry.id === 2).flatMap(fleetShips)
    : fleetShips(deck)
const engagedShips = (ships: PlayerShip[]) => ships
const shipIssues = (ship: PlayerShip) => ship.issue
const fleetLabel = (deck: Deck) => ({ canonical: \`第\${deck.id}舰队\` })
const countCapacitySlotitems = (_items: any) => 0
export const toasts: any[] = []
const showSortieReadinessToast = (
  title: string,
  detail: string,
  deckId: number,
  critical: boolean,
  ref: any,
) => toasts.push({ title, detail, deckId, critical, ref })

${READINESS}

const currentSallyVerdict = (ships: PlayerShip[]) => ({
  kind: 'checking',
  untagged: ships.length,
})

export const sallyWarningParts = (): string[] => {
  const parts: string[] = []
  const eventArea = true
${SALLY_LOOP}
  return parts
}

export { warnSortieReadiness }
`

const loaded = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-ru-fleet-behavior-'))
  const entry = path.join(dir, 'ru-fleet-behavior.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'ru-fleet-behavior.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
})()

let readinessTs = 4_000

export const resetRuFleetBehavior = ({ fleets = [], combinedFlag = 0, sortie = null } = {}) => {
  loaded.mg.decks = fleets.map((fleet) => ({
    id: fleet.id,
    mission: fleet.mission ?? [0, 0, 0, 0],
    ships: fleet.empty ? [] : [{ issue: { unsupplied: true } }],
  }))
  loaded.mg.ships = Object.fromEntries(loaded.mg.decks.map((deck) => [deck.id, deck.ships[0] ?? {}]))
  loaded.mg.combinedFlag = combinedFlag
  loaded.mg.sortie = sortie
  loaded.toasts.length = 0
}

export const readinessToasts = () => {
  loaded.warnSortieReadiness(readinessTs)
  readinessTs += 4_000
  return [...loaded.toasts]
}

export const sallyWarningParts = () => loaded.sallyWarningParts()
