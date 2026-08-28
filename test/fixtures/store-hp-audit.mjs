// 把 store.ts 的权威 HP 对账（`runSortieHpAudit`）连同它的调用现场
// （`api_get_member/ship_deck` 归约器与它脚下的 `applyShipUpdates` / `toShip`）
// **原样切出来**真编译一遍，好让护栏喂真 ship_deck 报文、对着 state 下断言。
//
// ⚠️ **不许直接 import store.ts**：那个文件一路拉到 `../env`（`app.getVersion()`），
// node --test 载不进 electron；而且 import 就会打开用户的真账本并跑迁移。
// 手法与 fixtures/store-battle-reducers.mjs、fixtures/practice-session-reducers.mjs 相同。
//
// `auditSortieHp`（判据本体）与 `mapIdOf` 一律**引真的那一份**，不补桩：
// 桩一写成「血不一样就算漏报大破」，危险方向到底判没判对就整个看不出来了。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// store.ts 是 CRLF 存的；锚点里写 \n 会一个都对不上，先统一成 LF 再切。
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

/** toShip + toDeck：applyShipUpdates / applyDeckUpdates 脚下的那两个转换器。 */
const CONVERTERS = sliceBetween(
  'const toShip = (raw: any): PlayerShip => ({',
  '\nconst toNdock',
  '舰船/编队转换器 toShip、toDeck',
)

const APPLY_SHIPS = sliceBetween(
  'const applyShipUpdates = (rawShips: any) => {',
  '\nconst removeRosterShips',
  'applyShipUpdates',
)

const APPLY_DECKS = sliceBetween(
  'const applyDeckUpdates = (rawDecks: any, replaceAll: boolean) => {',
  '// ---- 出击/战斗 ----',
  'applyDeckUpdates',
)

/** 对账本体。切到下一段（战斗 HP 回写）的注释为止。 */
const AUDIT = sliceBetween(
  'const runSortieHpAudit = (ts: number, announce: boolean): Section[] => {',
  '\n// 战斗 HP 推演实时回写舰船状态',
  '权威 HP 对账 runSortieHpAudit',
)

const NEW_SORTIE = (() => {
  const head = 'const newSortie = (partial: Partial<SortieView>): SortieView => ({'
  const start = source.indexOf(head)
  assert.ok(start >= 0, 'store.ts 里找不到 newSortie，这条守卫的锚点要跟着改')
  const end = source.indexOf('\n})', start)
  assert.ok(end > start, 'newSortie 没有可识别的结尾')
  return source.slice(start, end + 3)
})()

/**
 * 切一个归约器出来，改写成具名导出函数，**主体一个字不动**。
 * 结尾按它自己的终止符（2 空格缩进的 `},`）找；那个逗号不能带上，
 * 带上就成了逗号表达式，下一个 export 当场语法错。
 */
const asReducer = (name, head, label) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return `export const ${name} = ${source.slice(start + head.indexOf('('), end + 4)}`
}

const SHIP_DECK = asReducer(
  'onShipDeck',
  "'/kcsapi/api_get_member/ship_deck': (body, _post, ts) => {",
  'ship_deck 归约器',
)

/**
 * 回港那一支只测「不补喊」这一件事，所以直接调真的 `runSortieHpAudit(ts, false)`——
 * port 归约器本体牵着入渠、泊地修理落账、活动海域探测一大串，切进来得补十几个桩，
 * 而那些跟对账一个字的关系都没有。**接线**另有一条断言（见测试文件末尾）盯着
 * port 里那一行还在、且传的仍是 false。
 */
const abs = (...parts) => path.join(ROOT, ...parts).replace(/\\/g, '/')

const HARNESS = `
import { auditSortieHp } from '${abs('src', 'shared', 'sortie-hp-audit.ts')}'
import { mapIdOf } from '${abs('src', 'shared', 'map-id.ts')}'

type PlayerShip = any
type Deck = any
type Section = string
type SortieView = any

export const state: any = {
  player: { ships: {}, decks: [], materials: null },
  sortie: null,
  battleReconciliation: { checked: 0, mismatched: 0, records: [] },
}

// 哨兵日志：护栏要问「记了几条、每条写的什么」，所以接下来不打屏幕，进这张表。
export const warned: string[] = []
const console = { warn: (line: string) => { warned.push(line) } }

${CONVERTERS}

${APPLY_SHIPS}

${APPLY_DECKS}

${NEW_SORTIE}

${AUDIT}

const reducers: any = {
  ${SHIP_DECK.replace('export const onShipDeck = ', 'onShipDeck: ')},
}
export const onShipDeck = reducers.onShipDeck
export { newSortie, runSortieHpAudit, applyShipUpdates }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-hp-audit-'))
  const entry = path.join(dir, 'audit.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'audit.cjs')
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

/** 战斗视图里的一艘舰；只有对账真会读的那几个键。 */
export const shipOf = (index, patch = {}) => ({
  index,
  fleet: index >= 6 ? 'escort' : 'main',
  position: index % 6,
  mstId: 200 + index,
  rosterId: 100 + index,
  name: `我舰${index + 1}`,
  hpStart: 40,
  hpEnd: 40,
  hpMax: 40,
  sunk: false,
  defeated: false,
  escaped: false,
  repairItemUsed: null,
  equipment: [],
  ...patch,
})

/**
 * 摆一局出击。
 *
 * @param fShips  战斗视图里的我方编成（解析产物）
 * @param ledgerHp  `{ [rosterId]: nowhp }`——账本此刻的耐久（syncBattleHp 回写的结果）
 * @param sortie  出击切片补丁
 * @param battle  战斗视图补丁
 */
export const reset = ({ fShips = [], ledgerHp = {}, sortie = {}, battle = {} } = {}) => {
  loaded.warned.length = 0
  loaded.state.player.ships = {}
  for (const ship of fShips) {
    loaded.state.player.ships[ship.rosterId] = {
      id: ship.rosterId,
      shipId: ship.mstId,
      nowhp: ledgerHp[ship.rosterId] ?? ship.hpEnd,
      maxhp: ship.hpMax,
      slot: [],
      slotEx: 0,
    }
  }
  loaded.state.player.decks = [{ id: 1, name: '第1艦隊', mission: [], ships: fShips.map((s) => s.rosterId) }]
  loaded.state.battleReconciliation = { checked: 0, mismatched: 0, records: [] }
  loaded.state.sortie = loaded.newSortie({
    mapArea: 6,
    mapNo: 5,
    currentCell: 12,
    battleCount: 2,
    startTs: 1000,
    battle: {
      kind: 'day',
      practice: false,
      hasNight: false,
      fShips,
      eShips: [],
      friendShips: [],
      ...battle,
    },
    ...sortie,
  })
  return loaded.state
}

/** 喂一份真形状的 ship_deck 报文（`{ [rosterId]: nowhp }` → api_ship_data）。 */
export const shipDeckBody = (hpById, decks = null) => ({
  api_ship_data: Object.entries(hpById).map(([id, nowhp]) => ({
    api_id: Number(id),
    api_ship_id: 200 + (Number(id) - 100),
    api_lv: 99,
    api_nowhp: nowhp,
    api_maxhp: 40,
    api_slot: [-1, -1, -1, -1],
    api_slot_ex: 0,
    api_cond: 49,
    api_exp: [0, 0, 0],
  })),
  api_deck_data: decks,
})

export const runShipDeck = (body, ts = 5000) => loaded.onShipDeck(body, {}, ts)
export const runAudit = (ts, announce) => loaded.runSortieHpAudit(ts, announce)
export const stateOf = () => loaded.state
export const warnings = () => loaded.warned.slice()

/** store.ts 原文，供接线断言用（切片本身已经证明锚点还在）。 */
export const storeSource = source
