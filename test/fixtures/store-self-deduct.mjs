// 「报文不带消耗、按端点自扣」那一族的归约：切真码进来喂真报文。
//
// ⚠️ **不许直接 import store.ts**：一 import 就会打开用户的真账本并跑迁移。
// 手法与 fixtures/store-hangar-expand 同一套：判据一个字不改。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const storeSource = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = storeSource.indexOf(from)
  assert.ok(start >= 0, `找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = storeSource.indexOf(to, start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return storeSource.slice(start, end)
}

const TO_SHIP = sliceBetween(
  'const toShip = (raw: any): PlayerShip => ({',
  '\nconst toDeck =',
  '在籍舰归一化 toShip',
)
const INCREMENT_USEITEM = sliceBetween(
  'const incrementUseitem = (id: number, delta: number, ts: number): boolean => {',
  '\nconst patchMaterialValues =',
  '道具增减 incrementUseitem',
)

const asReducer = (name, head, label) => {
  const start = storeSource.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = storeSource.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return `export const ${name} = ${storeSource.slice(start + head.indexOf('('), end + 4)}`
}

const MARRIAGE = asReducer(
  'marriage',
  "'/kcsapi/api_req_kaisou/marriage': (body, _post, ts) => {",
  'ケッコンカッコカリ reducer',
)
const OPEN_EXSLOT = asReducer(
  'openExslot',
  "'/kcsapi/api_req_kaisou/open_exslot': (_body, post, ts) => {",
  '补强增设开孔 reducer',
)

const HARNESS = `
type PlayerShip = any
type Section = string

export const state: any = { player: { ships: {}, useitems: {} }, master: { ships: {} } }

export const useitemLog: any[] = []
const ledger = {
  logUseitems: (ts: number, changes: any[]) => { useitemLog.push({ ts, changes }) },
}

${TO_SHIP}

${INCREMENT_USEITEM}

${MARRIAGE}

${OPEN_EXSLOT}
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-selfdeduct-'))
  const entry = path.join(dir, 'selfdeduct.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'selfdeduct.cjs')
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

/** @param ships `{ [rosterId]: { mstId, slotEx } }`；slotEx 0 = 没开过增设格 */
export const reset = (ships = {}, useitemCounts = {}) => {
  loaded.state.player.ships = {}
  for (const [id, one] of Object.entries(ships)) {
    loaded.state.player.ships[+id] = { id: +id, shipId: one.mstId, slotEx: one.slotEx ?? 0 }
  }
  loaded.state.player.useitems = { ...useitemCounts }
  loaded.useitemLog.length = 0
}

export const feedOpenExslot = (post, ts = TS) => loaded.openExslot({}, post, ts)
export const feedMarriage = (body, ts = TS) => loaded.marriage(body, {}, ts)

export const ships = () => loaded.state.player.ships
export const useitems = () => loaded.state.player.useitems
export const useitemLog = () => loaded.useitemLog

export const TS = 1_788_154_000_000

/** 账本 events 的真样本（api_token 已脱敏）：2026-08-31 13:43:02 那次开孔。 */
export const REAL_EXSLOT_POST = { api_token: '<REDACTED>', api_verno: '1', api_id: '7341' }
