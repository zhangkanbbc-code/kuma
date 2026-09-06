// 把 store.ts 的战果归约器 `onBattleResult` 原样切出来真编译一遍，
// 用来核对战果经验数组怎样同时落到在籍等级与本场升级记录。
//
// 不直接 import store.ts：它会经 ../env 拉起 Electron 并打开用户账本。
// 与同目录其余 store-* 夹具一样，只有本测试无关的外围协作者用桩；
// `onBattleResult` 本体一个字不改。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sortieStart = source.indexOf(
  'const newSortie = (partial: Partial<SortieView>): SortieView => ({',
)
const sortieEnd = source.indexOf(
  '\n\n/**\n * `api_bosscomp`',
  sortieStart,
)
assert.ok(
  sortieStart >= 0 && sortieEnd > sortieStart,
  'store.ts 里找不到出击升级生命周期，这条守卫的锚点要跟着改',
)
const SORTIE_LIFECYCLE = source.slice(sortieStart, sortieEnd)

const start = source.indexOf(
  'const onBattleResult = (body: any, _post: Record<string, string>, ts: number): Section[] => {',
)
const end = source.indexOf(
  '\n/**\n * 玩家真点了「退避」',
  start,
)
assert.ok(start >= 0 && end > start, 'store.ts 里找不到 onBattleResult，这条守卫的锚点要跟着改')
const ON_BATTLE_RESULT = source.slice(start, end)

const HARNESS = `
type Section = string
type SortieView = any

export const state: any = {
  player: { ships: {}, practice: null },
  sortie: null,
  lastSortieLevelUps: null,
  battleReconciliation: { checked: 0, mismatched: 0, records: [] },
  mapGauges: {},
}

const dropShipGetMessage = (_ship: any) => ''
const exmapSenkaOf = (_body: any) => null
const nextMapIdsOf = (_body: any) => []
const escapeOfferOf = (_body: any) => null
const reconcileBattle = (_battle: any, _body: any) => []
const patchBasicLevel = (_body: any) => false
const incrementUseitem = (_id: number, _count: number, _ts: number) => false
const mapIdOf = (_area: number, _map: number) => 0
const patchMapGaugeFromBattleResult = (_gauge: any, _input: any) => null
const setMapGauge = (_mapId: number, _gauge: any) => false
const collectSunkShips = (_ts: number) => false

${SORTIE_LIFECYCLE}

${ON_BATTLE_RESULT}

export { beginSortie, finishSortieLevelUps, onBattleResult }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-store-battle-result-'))
  const entry = path.join(dir, 'result.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'result.cjs')
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

export const reset = ({ ships, battleShips }) => {
  loaded.state.player.ships = Object.fromEntries(
    ships.map((ship) => [ship.id, { expTotal: 0, expNext: 0, ...ship }]),
  )
  loaded.state.sortie = loaded.beginSortie({
    currentCell: 1,
    battle: {
      fShips: battleShips.map((ship) => ({ ...ship })),
      eShips: [],
      result: null,
    },
    updatedTs: 0,
  })
  loaded.state.battleReconciliation = { checked: 0, mismatched: 0, records: [] }
}

export const feedBattleResult = (body, ts) => loaded.onBattleResult(body, {}, ts)
export const beginSortie = (patch = {}) => {
  loaded.state.sortie = loaded.beginSortie(patch)
  return loaded.state.sortie
}
export const finishSortie = (ts) => loaded.finishSortieLevelUps(ts)
export const lastSortieLevelUps = () => loaded.state.lastSortieLevelUps
export const sortie = () => loaded.state.sortie
export const playerShips = () => loaded.state.player.ships
