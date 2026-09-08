// 切出远征结算真码，用桩 ledger 收集道具流水。
// 不许直接 import store.ts：它会打开用户真账本并跑迁移。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const source = fs.readFileSync(new URL('../../src/main/mg/store.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
const sliceBetween = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `远征夹具锚点失效：${from}`)
  return source.slice(start, end)
}
const materials = sliceBetween('const addMaterials4 =', '// 在现有资源上做扣减')
const increment = sliceBetween('const incrementUseitem =', '\nconst patchMaterialValues =')
const head = "'/kcsapi/api_req_mission/result': "
const reducer = sliceBetween(head, '\n  },\n').slice(head.length) + '\n}'
const harness = `
type Section = string
export const state: any = { player: { materials: null, useitems: {}, decks: [], ships: {} } }
export const useitemLog: any[] = []
const ledger = {
  logUseitems: (ts: number, changes: any[]) => { useitemLog.push({ ts, changes }) },
}
const patchBasicLevel = () => false
${materials}
${increment}
export const missionResult = ${reducer}
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mission-result-'))
const entry = path.join(dir, 'mission-result.ts')
const outfile = path.join(dir, 'mission-result.cjs')
fs.writeFileSync(entry, harness)
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const loaded = createRequire(import.meta.url)(outfile)

export const BASE = [1000, 2000, 3000, 4000, 50, 60, 70, 80]
export const TS = 1_788_154_000_000
export const reset = (materials = BASE, useitems = { 10: 2 }) => {
  loaded.state.player.materials = materials == null ? null : [...materials]
  loaded.state.player.useitems = { ...useitems }
  loaded.useitemLog.length = 0
}
export const feed = (body) => loaded.missionResult(
  body, { api_token: '<REDACTED>', api_deck_id: '2' }, TS,
)
export const player = () => loaded.state.player
export const useitemLog = () => loaded.useitemLog
