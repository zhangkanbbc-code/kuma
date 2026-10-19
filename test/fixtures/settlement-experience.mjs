// 只编译结算、回港和舰历差分真码；所有状态与落账均留在测试内存里。
// 不 import store / ledger 默认实例，避免打开玩家数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const storeSource = read('../../src/main/mg/store.ts')
const lifeSource = read('../../src/main/mg/ship-life.ts')
const diSource = read('../../src/renderer/modules/di.ts')
const cut = (source, from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `结算经验夹具锚点失效：${from}`)
  return source.slice(start, end)
}
const reducer = (route, name) => {
  const head = `'${route}': `
  return `const ${name} = ${cut(storeSource, head, '\n  },\n').slice(head.length)}\n}`
}
const battleRoutes = [...storeSource.matchAll(/'(\/kcsapi\/[^']+)': onBattleResult,/g)]
  .map((match) => `${JSON.stringify(match[1])}: onBattleResult`).join(',\n')

const harness = `
type PlayerShip = any
type ShipLifeEquipment = any
type ShipLifeStateRow = any
type ShipLifeEventInput = any
type SortieView = any
type Section = string
type BattleView = any
type BattleShipView = any
export const state: any = { player: {}, sortie: null }
export const events: any[] = []
export const baselines = new Map<number, any>()
let primed = false
const pendingRemodels = new Map<number, number>()
const store = { getState: () => state }
const ledger = {
  saveShipLifeStates: () => {},
  logShipLifeEvents: (rows: any[]) => events.push(...rows),
}
const attachJoinOrigins = () => {}
const dropShipGetMessage = () => ''
const exmapSenkaOf = () => null
const nextMapIdsOf = () => []
const escapeOfferOf = () => null
const reconcileBattle = () => []
const patchBasicLevel = () => false
const incrementUseitem = () => false
const mapIdOf = () => 0
const patchMapGaugeFromBattleResult = () => null
const setMapGauge = () => false
const collectSunkShips = () => false
const addMaterials4 = () => false
const addMaterialAt = () => false
const toMaterials = (_raw: any, prior: any) => prior
const applyDeckUpdates = () => {}
const toNdock = (raw: any) => raw
const berthBankedDecks = () => []
const touchBerth = () => {}
const provisionBanked = () => false
const touchProvision = () => {}
const runSortieHpAudit = () => []
${cut(storeSource, 'const toShip =', '\nconst toDeck =')}
${cut(storeSource, 'const applyShipUpdates =', '\nconst removeRosterShips =')}
${cut(storeSource, 'const newSortie =', '\n\n/**\n * `api_bosscomp`')}
${cut(storeSource, 'const onBattleResult =', '\n/**\n * 玩家真点了「退避」')}
${reducer('/kcsapi/api_req_mission/result', 'missionResult')}
${reducer('/kcsapi/api_port/port', 'port')}
${cut(lifeSource, 'const equipmentOf =', '\n/**\n * ケッコンカッコカリ。')}
const battleHitState = (hit: any) => hit.hitState
${cut(diSource, 'const shipCombatMetricsHtml =', '\nconst battleEquipmentHtml =')}
const routes = {
  ${battleRoutes},
  '/kcsapi/api_req_mission/result': missionResult,
  '/kcsapi/api_port/port': port,
}
export const feed = (route: string, body: any, ts: number) => {
  const sections = routes[route](body, { api_deck_id: '2' }, ts)
  if (sections.includes('ships') || sections.includes('slotitems')) syncShipStates(ts, route)
  return sections
}
export const metrics = (ship: any) => shipCombatMetricsHtml({ attacks: [] }, 0, ship)
export const reset = (ships: any[], battleShips: any[], practice = false) => {
  state.player = { ships: {}, slotitems: {}, ndocks: [], decks: [], materials: null }
  for (const ship of ships) state.player.ships[ship.api_id] = toShip(ship)
  state.sortie = beginSortie({ practice, currentCell: 1, battle: { fShips: battleShips, eShips: [], result: null } })
  state.battleReconciliation = { checked: 0, mismatched: 0, records: [] }
  state.mapGauges = {}
  baselines.clear()
  shipSignatures.clear()
  pendingRemodels.clear()
  events.length = 0
  primeShipLife(0)
}
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-settlement-exp-'))
const entry = path.join(dir, 'settlement.ts')
const outfile = path.join(dir, 'settlement.cjs')
fs.writeFileSync(entry, harness)
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
export const { state, events, feed, metrics, reset } = createRequire(import.meta.url)(outfile)
