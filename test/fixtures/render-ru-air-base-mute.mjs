// 四处出口切真实函数执行；偏好落盘用内存桩，绝不接触玩家账本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ru = fs.readFileSync(path.join(ROOT, 'src/renderer/modules/ru.ts'), 'utf8').replace(/\r\n/g, '\n')
const cut = (from, to) => {
  const start = ru.indexOf(from)
  const end = ru.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `陆航静默夹具锚点缺失：${from}`)
  return ru.slice(start, end)
}
const HARNESS = `
import { AIR_BASE_MUTE_KEY, isAirBaseAreaMuted, toggleAirBaseAreaMute, unmutedAirBaseSquads } from './src/shared/air-base-mute'
import { airBaseTabGlow } from './src/shared/air-base-tab'
import { airBaseCustomName } from './src/shared/air-base-name'
type AirBaseSquad = any
export const mg: any = { airBases: [], eventAreas: {}, decks: [], slotitems: {}, master: { slotitems: {} }, sortie: null }
export const writes: any[] = []
export const toasts: any[] = []
const uiGet = (_key: string, fallback: any) => fallback
const uiSet = (key: string, value: any) => writes.push([key, value])
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const entityNamePlain = (_kind: any, _id: any, name: any) => name
const entityTermHtml = entityNamePlain
const elink = entityNamePlain
const mapAreaNames = new Map()
const equipPeekIconHtml = () => ''
const equipTypeIconHtml = () => ''
const fmtTime = (ts: number) => String(ts)
const fleetAirPower = () => ({ min: 10, max: 20 })
const metricsRowHtml = (_row: any, _order: any, chips: string[]) => chips.join('')
const AIR_BASE_METRIC_FOLD_ORDER = []
const AIR_BASE_TAB_ID = 900
const SANDBOX_TAB_ID = -1
const BERTH_TAB_ID = -2
const SANDBOX_CAP = 6
const sandboxDeck = () => ({ ships: [] })
const berthFlagshipOf = () => null
const fleetShips = (deck: any) => deck.ships
const scopeShips = fleetShips
const deckOnSortie = () => false
const inCombined = () => false
const fleetLabel = (deck: any) => ({ canonical: '第' + deck.id + '舰队' })
const shipIssues = () => ({})
const currentSallyVerdict = () => ({ kind: 'event', untagged: 2 })
const activeAreasNow = () => new Set(Object.keys(mg.eventAreas).map(Number))
const showSortieReadinessToast = (...args: any[]) => toasts.push(args)
${cut('const airBaseReadiness = ', '\n/**')}
${cut('let lastSallyCue = ', '\nconst AIR_BASE_ACTION')}
${cut('const AIR_BASE_ACTION', '\n// ---- 头部度量收纳')}
${cut('let mutedAreas = ', '\nconst metricsHtml')}
${cut('const fleetTabsHtml = ', '\n/** 沙盘抬头')}
${cut('const bindFleetPanelDelegates = ', '\nconst focusFleet = ')}
export const reset = (bases: any[], muted: number[] = [], eventAreas: any = {}) => {
  mg.airBases = bases
  mg.eventAreas = eventAreas
  mg.decks = []
  mg.sortie = null
  mutedAreas = [...muted]
  writes.length = 0
  toasts.length = 0
  lastSallyCue = 0
}
export { airBaseAreaHtml, airBaseHeaderHtml, fleetTabsHtml, warnOnEventMapOpen, bindFleetPanelDelegates }
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ru-air-base-mute-'))
const outfile = path.join(dir, 'mute.cjs')
buildSync({
  stdin: { contents: HARNESS, resolveDir: ROOT, sourcefile: 'air-base-mute-fixture.ts', loader: 'ts' },
  outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
})
export const scene = createRequire(import.meta.url)(outfile)
