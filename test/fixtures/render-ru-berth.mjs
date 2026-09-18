// 把锐的**泊地修理整页**与**页签条**原样切出来真编译一遍，好让护栏对着产物 HTML 下断言。
//
// 为什么非得切真的：这一页上「谁在覆盖内」「挂哪个短标」「估算出不出现」全是
// 运行期状态算出来的，正则匹配源码一条也拦不住——覆盖位次算成 `<=` 还是 `<`、
// 估算的三个前提少判一个，源码文本都一模一样。
//
// 判据本体（shared/berth-repair 的覆盖表、门槛、20 分闸门、估算公式）**引真的那一份**，
// 不补桩：桩一写成「有伤就算在修」，中破那一半就在测试里被抹掉了。
// 页签条一并切进来，是为了「泊地修理排在沙盘之后」这条能对着真产物验，
// 而不是去数源码里两个函数谁写在前面。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ru = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ru.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const cut = (from, to, label) => {
  const start = ru.indexOf(from)
  const end = ru.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `ru.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return ru.slice(start, end)
}

const DOCK_OF = cut(
  'const dockOf = (shipId: number) =>',
  '\n\n// repairDuration 上提',
  '入渠查询 dockOf',
)
const HP_CLASS = cut(
  'const hpClassOf = (ship: PlayerShip, docked: boolean) => {',
  '\nconst hpLabelOf =',
  'HP 档位 hpClassOf',
)
const FLEET_SHIPS = cut(
  'const fleetShips = (deck: Deck): PlayerShip[] =>',
  '\n\n// ---- 模块状态 ----',
  '舰队成员 fleetShips',
)
const TABS = cut(
  'const fleetTabsHtml = (activeId: number) =>',
  '\n\n/** 沙盘抬头',
  '页签条 fleetTabsHtml',
)
const BERTH = cut(
  '// ---- 泊地修理页（母港泊地修理 / 明石タイマー）----',
  '\nconst fleetHeaderHtml = (deck: Deck) => {',
  '泊地修理整页',
)

const SHARED = path.join(ROOT, 'src', 'shared', 'berth-repair.ts').replace(/\\/g, '/')
const PROVISION = path.join(ROOT, 'src', 'shared', 'provision-ship.ts').replace(/\\/g, '/')

const HARNESS = `
import {
  BERTH_WARMUP_MS,
  REPAIR_FACILITY_MST_ID,
  REPAIR_SHIP_STYPE,
  berthCoverage,
  berthEstimateHp,
  berthHalt,
  berthShipState,
  berthWarmupRatio,
} from '${SHARED}'
import {
  PROVISION_COND_CAP,
  PROVISION_WARMUP_MS,
  provisionEstimate,
  provisionHalt,
  provisionShipAt,
  provisionShipState,
} from '${PROVISION}'

type Deck = any
type PlayerShip = any

export const mg: any = {
  decks: [],
  ships: {},
  ndocks: [],
  slotitems: {},
  master: { ships: {} },
  berthSince: {},
  provisionSince: null,
  combinedFlag: 0,
  sortie: null,
}

// 页签条真会执行到的名字，一律给最平淡的桩——这条护栏只看「泊地修理这一枚排在哪」。
const AIR_BASE_TAB_ID = 0
const SANDBOX_TAB_ID = -1
const SANDBOX_CAP = 6
const combinedFleetLabel = () => '联合舰队'
// 与 ru.ts 本尊同一逻辑（一行判据，出击态用它认「一队带二队」）
const inCombined = (deck: any) => mg.combinedFlag > 0 && (deck.id === 1 || deck.id === 2)
const deckOnSortie = (deckId: number) =>
  !!mg.sortie?.active && !mg.sortie.practice && mg.sortie.deckId === deckId
const scopeShips = (deck: any) => fleetShips(deck)
const shipIssues = (_s: any) => ({ taiha: false, chuuha: false, unsupplied: false, docked: false, tired: false })
const trackedAirBases = () => []
const airBaseTabGlow = (_squads: any[]) => null
const airBaseReadiness = () => null
const mutedAreas: number[] = []
const unmutedAirBaseSquads = (squads: any[]) => squads
const sandboxDeck = () => ({ id: -1, ships: [] })
const fleetLabel = (deck: any) => ({ canonical: \`第\${deck.id}舰队\`, custom: '' })
const masterShipName = (mstId: number) => mg.master.ships[mstId]?.name ?? \`#\${mstId}\`
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const entityTermHtml = (_kind: string, _id: number, name: string) => String(name)
const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&#38;').replace(/"/g, '&#34;')
const fmtTime = (ts: number) => \`T\${ts}\`
const FATIGUE_FULL_COND = 49
const estimatedCond = (rosterId: number, cap: number) => {
  const ship = mg.ships[rosterId]
  return ship ? Math.min(cap, ship.estimatedCond ?? ship.cond) : null
}
const fatigueReadyTs = (_rosterId: number, _target: number) => null
const fleetFatigueEta = (_ships: any[], _target: number) => ({ ts: null, unknown: 0 })

${DOCK_OF}
${HP_CLASS}
${FLEET_SHIPS}
${BERTH}
${TABS}

export { berthViewHtml, berthHeaderHtml, fleetTabsHtml, fleetFatigueHtml, BERTH_TAB_ID, REPAIR_FACILITY_MST_ID }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ru-berth-'))
  const entry = path.join(dir, 'berth.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'berth.cjs')
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

export const BERTH_TAB_ID = loaded.BERTH_TAB_ID

/** 明石改：工作舰（stype 19），4 个常规格。 */
export const AKASHI = { mstId: 187, name: '明石改', stype: 19 }
/** 雪风改二：随便一艘驱逐，用来占随伴位。 */
export const DD = { mstId: 656, name: '雪風改二', stype: 2 }
/** 野埼 / 野埼改：只按 mst 点名，stype 22 本身不构成资格。 */
export const NOZAKI = { mstId: 996, name: '野埼', stype: 22, fuelMax: 20, bullMax: 10 }
export const NOZAKI_KAI = { mstId: 1002, name: '野埼改', stype: 22, fuelMax: 25, bullMax: 15 }

/**
 * 摆一局。
 *
 * `fleets` 每项：{ id, ships: [{ id, mstId, nowhp, maxhp, ndockTime, facilities }], mission, since }
 * `facilities` 只对旗舰有意义——它决定给旗舰塞几个艦艇修理施設。
 */
export const reset = ({ fleets = [], docked = [], sortie = null, provisionSince = null } = {}) => {
  mgReset()
  let slotSeq = 1000
  for (const fleet of fleets) {
    const deck = { id: fleet.id, name: `第${fleet.id}舰队`, mission: fleet.mission ?? [0, 0, 0, 0], ships: [] }
    for (const ship of fleet.ships) {
      const spec = ship.spec ?? DD
      loaded.mg.master.ships[spec.mstId] = {
        name: spec.name,
        stype: spec.stype,
        fuelMax: spec.fuelMax ?? 10,
        bullMax: spec.bullMax ?? 10,
      }
      const slot = []
      for (let i = 0; i < (ship.facilities ?? 0); i += 1) {
        const slotId = (slotSeq += 1)
        // 取真模块的常量，别写字面量：写死的那份跟着源码一起错过一次，护栏照样全绿
        loaded.mg.slotitems[slotId] = { mstId: loaded.REPAIR_FACILITY_MST_ID }
        slot.push(slotId)
      }
      loaded.mg.ships[ship.id] = {
        id: ship.id,
        shipId: spec.mstId,
        nowhp: ship.nowhp,
        maxhp: ship.maxhp,
        ndockTime: ship.ndockTime ?? 0,
        cond: ship.cond ?? 49,
        estimatedCond: ship.estimatedCond,
        fuel: ship.fuel ?? (spec.fuelMax ?? 10),
        bull: ship.bull ?? (spec.bullMax ?? 10),
        slot,
        slotEx: 0,
      }
      deck.ships.push(ship.id)
    }
    loaded.mg.decks.push(deck)
    if (fleet.since !== undefined) loaded.mg.berthSince[fleet.id] = fleet.since
  }
  loaded.mg.ndocks = docked.map((shipId, i) => ({ id: i + 1, shipId, completeTime: 0, state: 1 }))
  loaded.mg.sortie = sortie
  loaded.mg.provisionSince = provisionSince
}

const mgReset = () => {
  loaded.mg.decks = []
  loaded.mg.ships = {}
  loaded.mg.ndocks = []
  loaded.mg.slotitems = {}
  loaded.mg.master.ships = {}
  loaded.mg.berthSince = {}
  loaded.mg.provisionSince = null
  loaded.mg.combinedFlag = 0
  loaded.mg.sortie = null
}

export const renderBerth = () => loaded.berthViewHtml()
export const renderBerthHead = () => loaded.berthHeaderHtml()
export const renderTabs = (activeId = 1) => loaded.fleetTabsHtml(activeId)
export const renderFleetFatigue = (deckId = 1) =>
  loaded.fleetFatigueHtml(loaded.mg.decks.find((deck) => deck.id === deckId))
export const mgView = () => loaded.mg
