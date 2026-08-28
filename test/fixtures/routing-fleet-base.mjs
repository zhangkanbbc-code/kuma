// 带路预测的**队伍侧**：分歧条件读到的到底是哪几条舰。
//
// 鉴（ji.ts）里从取舰到 routingFleetBase 那一整段原样切出来编一遍，和它一起编的还有
// 它真正依赖的几处判据——都引真的那一份，不补桩：
//   · kernel 的退避三件套 + fleet-calc 的 engagedShips（「谁还在参战」）
//   · fleet-calc 的 fleetLos33 与 shared/fleet-los33 的数学核（空格补正就在核里）
//   · combat-forecast 的 forecastDeckScope（連合两队算一支）
// 桩一写成「escaped 里有就算」，「返港即解除」「演习不算」这两半就在测试里没了；
// 索敌补个假的，「退避之后空格数怎么变」这条正要验的行为也就无从验起。
//
// ji.ts / fleet-calc.ts / kernel.ts 顶层都要 electron，直接 import 载不进 node --test，
// 所以走切片编译这条路，与 fixtures/escape-consumers.mjs 同一手法。
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
const forecast = read('src', 'renderer', 'combat-forecast.ts')
const sandbox = read('src', 'renderer', 'sandbox-fleet.ts')
const atlas = read('src', 'renderer', 'modules', 'ji.ts')

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
const FLEET_LOS33 = cut(
  fleetCalc,
  'export const fleetLos33 = (',
  '\n// ---- TP（輸送物資量）----',
  'fleet-calc 的 fleetLos33',
)
const DECK_SCOPE = cut(
  forecast,
  'export interface ForecastDeckScope {',
  '\nexport const forecastFleetForDeck',
  'combat-forecast 的 forecastDeckScope',
)
const SANDBOX_ID = cut(
  sandbox,
  'export const SANDBOX_DECK_ID = -1',
  '\nexport const SANDBOX_CAP',
  '沙盘的 deck id',
)
const ROUTING = cut(
  atlas,
  'const routingRosterForDeck = (deckId: number) => {',
  '\nconst mapDifficultyRank',
  '鉴的带路队伍侧',
)

// esbuild 是 bundle 模式、入口写在临时目录，所以给绝对路径（正斜杠，Windows 也认）
const abs = (...rel) => path.join(ROOT, ...rel).replace(/\\/g, '/')
const SORTIE_ESCAPE = abs('src', 'shared', 'sortie-escape.ts')
const FLEET_LOS33_CORE = abs('src', 'shared', 'fleet-los33.ts')
const KCNAV = abs('src', 'shared', 'kcnav-routing.ts')

const HARNESS = `
import { escapedShipsOf } from '${SORTIE_ESCAPE}'
import { los33Of } from '${FLEET_LOS33_CORE}'
import { KCNAV_STYPE_CODE, kcnavFleetComposition } from '${KCNAV}'

type SortieEscapedShip = any
type RoutingFleetContext = any
type PlayerShip = any
type Los33 = any
type Deck = any

export const mg: any = {
  sortie: null,
  ships: {},
  decks: [],
  slotitems: {},
  master: { ships: {}, slotitems: {} },
  combinedFlag: 0,
  basic: { level: 0 },
}

// 沙盘的成员在真代码里从 uiGet 读，这里由测试直接摆；包成 Deck 的形状照 sandbox-fleet。
export const sandboxState: { ships: number[] } = { ships: [] }

const ROUTING_STYPE_CODE = KCNAV_STYPE_CODE
const entityNamePlain = (_kind: string, _mstId: number, name: string) => name

${SANDBOX_ID}

const sandboxDeck = (): Deck => ({
  id: SANDBOX_DECK_ID,
  name: '沙盘编成',
  mission: [0, 0, 0, 0],
  ships: sandboxState.ships.filter((id) => mg.ships[id]),
})

${KERNEL_ESCAPE}

${ENGAGED}

${FLEET_LOS33}

${DECK_SCOPE}

${ROUTING}

export {
  resetRoutingBaseCache,
  routingContextForDeck,
  routingFleetBase,
  routingRosterForDeck,
  routingShipsForDeck,
}
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-routing-fleet-'))
  const entry = path.join(dir, 'routing.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'routing.cjs')
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
 * 摆一局：舰娘、主数据、编队、（可选）出击。
 *
 * `ships` 每条给 { id, shipId, stype, soku, sakuteki?, slot?, slotEx? }；
 * 主数据里的 soku 与在籍值一致（真代码是 `ship.soku || master.soku`，这里不测那条回退）。
 */
export const setup = ({
  ships = [],
  items = [],
  decks = [],
  sortie = null,
  combinedFlag = 0,
  sandboxShips = [],
  admiralLv = 0,
} = {}) => {
  loaded.mg.ships = {}
  loaded.mg.master.ships = {}
  loaded.mg.slotitems = {}
  loaded.mg.master.slotitems = {}
  for (const item of items) {
    loaded.mg.slotitems[item.instId] = { mstId: item.mstId, level: item.level ?? 0, alv: item.alv ?? 0 }
    loaded.mg.master.slotitems[item.mstId] = {
      id: item.mstId,
      name: item.name,
      type2: item.type2,
      saku: item.saku ?? 0,
    }
  }
  for (const ship of ships) {
    loaded.mg.ships[ship.id] = {
      id: ship.id,
      shipId: ship.shipId,
      soku: ship.soku,
      sakuteki: ship.sakuteki ?? 0,
      slot: ship.slot ?? [],
      slotEx: ship.slotEx ?? 0,
    }
    loaded.mg.master.ships[ship.shipId] = {
      id: ship.shipId,
      name: ship.name ?? `舰${ship.shipId}`,
      stype: ship.stype,
      soku: ship.soku,
    }
  }
  loaded.mg.decks = decks
  loaded.mg.sortie = sortie
  loaded.mg.combinedFlag = combinedFlag
  loaded.mg.basic = { level: admiralLv }
  loaded.sandboxState.ships = sandboxShips
  loaded.resetRoutingBaseCache()
}

/** 只换退避名单，别的不动（缓存**故意不清**，留给缓存那条护栏用）。 */
export const setEscaped = (escaped) => {
  if (loaded.mg.sortie) loaded.mg.sortie.escaped = escaped
}

export const routingFleetBase = (deckId) => loaded.routingFleetBase(deckId)
export const routingShipsForDeck = (deckId) => loaded.routingShipsForDeck(deckId)
export const routingRosterForDeck = (deckId) => loaded.routingRosterForDeck(deckId)
export const routingContextForDeck = (deckId, passed = [], phase = null) =>
  loaded.routingContextForDeck(deckId, passed, phase)
export const resetRoutingBaseCache = () => loaded.resetRoutingBaseCache()
