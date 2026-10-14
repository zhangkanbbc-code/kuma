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
const fixturePrefs: Record<string, any> = {}
const uiGet = (key: string, fallback: any) => __kernel ? __kernel.uiGet(key, fallback) : fixturePrefs[key] ?? fallback
const onUiPreferenceChange = (key: string, cb: () => void) => { if (__kernel) __kernel.onUiPreferenceChange(key, cb) }
const uiSet = (key: string, value: any) => {
  writes.push([key, value])
  fixturePrefs[key] = value
  if (__kernel) __kernel.uiSet(key, value)
}
const scheduleRender = () => {}
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
// 装配入口也用原模块：监听挂到测试的真实 EventEmitter，开图经 addListener 分发。
let pane: any
let lastOpenedMapArea = 0
los33TipRegistered = true
const loadKcwikiShips = () => {}
const loadMasterNames = () => {}
const initMapIntel = async () => {}
const ensureShipStatsLode = () => {}
const initMetricsFoldCard = () => {}
const ResizeObserver = class { observe() {}; disconnect() {} }
const trackMountCleanup = (cb: () => void) => __kernel.trackMountCleanup(cb)
const onMgChange = (cb: any) => __kernel.onMgChange(cb)
const onMourningChange = () => {}
const onQpChange = () => {}
const onTick = (cb: any) => __kernel.onTick(cb)
const deferPassive = () => {}
const scheduleFleetQuestCheck = () => {}
const render = () => {}
const tickTimers = () => {}
const registerModule = (mod: any) => { moduleDef = mod }
let moduleDef: any
${cut('registerModule({', '\n})')}
})
export const mount = (el: any) => moduleDef.mount(el)
export const reset = (bases: any[], muted: number[] = [], eventAreas: any = {}) => {
  mg.airBases = bases
  mg.eventAreas = eventAreas
  mg.decks = []
  mg.sortie = null
  mutedAreas = [...muted]
  fixturePrefs[AIR_BASE_MUTE_KEY] = [...muted]
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
  external: ['@electron/remote'],
})
const compiled = fs.readFileSync(outfile, 'utf8')
export const makeAirBaseScene = (kernel = null, broadcaster = null) => {
  const module = { exports: {} }
  const require = createRequire(import.meta.url)
  new Function('require', 'module', 'exports', '__kernel', compiled)(
    (id) => id === '@electron/remote' ? { require: () => broadcaster } : require(id),
    module, module.exports, kernel,
  )
  return module.exports
}
export const scene = makeAirBaseScene()
