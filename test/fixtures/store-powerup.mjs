// 切出真实 reducer、库存归约与广播入口的失败门控；不 import 会打开真实账本的 store。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replaceAll('\r\n', '\n')
const source = read('src', 'main', 'mg', 'store.ts')
const ingress = read('src', 'main', 'mg', 'index.ts')
const slice = (text, from, to) => {
  const start = text.indexOf(from)
  const end = text.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `真实代码切片锚点失效：${from}`)
  return text.slice(start, end)
}
const head = "'/kcsapi/api_req_kaisou/powerup': "
const reducer = slice(source, head, '\n  },\n').slice(head.length) + '\n  }'
const shared = path.join(ROOT, 'dist', 'shared', 'powerup-useitem.js').replaceAll('\\', '/')
const harness = `
import { powerupUseitemCost } from ${JSON.stringify(shared)}
type PlayerShip = any
type Deck = any
type Section = string
export const state: any = { player: { ships: {}, decks: [], slotitems: {}, useitems: {} } }
export const logs: any[] = []
let sink = (_ts: number, _changes: any[]) => {}
export const setSink = (next: typeof sink) => { sink = next }
const ledger = { logUseitems: (ts: number, changes: any[]) => { logs.push({ ts, changes }); sink(ts, changes) } }
${slice(source, 'const toShip =', '\nconst toNdock =')}
${slice(source, 'const removeRosterShips =', '\n// 只在出击中认装备消失')}
${slice(source, 'const applyDeckUpdates =', '\n// ---- 出击/战斗 ----')}
${slice(source, 'const applyUseitems =', '\nconst patchMaterialValues =')}
const powerup = ${reducer}
export const feed = (parsed: any, post: any, ts: number) => {
${slice(ingress, '    if (parsed?.api_result !== undefined', '\n    // 开发方向')}
  return powerup(parsed?.api_data ?? parsed, post, ts)
}
export const sync = applyUseitems
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-powerup-store-'))
const entry = path.join(dir, 'store.ts')
const outfile = path.join(dir, 'store.cjs')
fs.writeFileSync(entry, harness)
buildSync({ entryPoints: [entry], outfile, bundle: true, external: [shared], platform: 'node', format: 'cjs', logLevel: 'silent' })
const loaded = createRequire(import.meta.url)(outfile)
fs.rmSync(dir, { recursive: true, force: true })

export const reset = (counts = { 96: 3 }, sink = () => {}) => {
  loaded.state.player = { ships: {}, decks: [], slotitems: {}, useitems: { ...counts } }
  loaded.logs.length = 0
  loaded.setSink(sink)
}
export const feed = event => loaded.feed(event.body, event.post, event.ts) ?? []
export const sync = (items, ts) => loaded.sync(items, ts)
export const state = loaded.state
export const logs = loaded.logs

// 维护者账本 2026-10-19：请求值均为字符串；响应没有道具数量。
export const POWERUP = '/kcsapi/api_req_kaisou/powerup'
export const MASTER = { api_mst_useitem: [{ api_id: 96, api_name: '南瓜' }] }
export const events = [13, 26, 45].map((second, i) => ({
  ts: Date.parse(`2026-10-19T16:25:${second}+08:00`), path: POWERUP,
  post: { api_verno: '1', api_id: '4460', api_id_items: '11563,11562,11561', api_slot_dest_flag: '1', api_limited_feed_type: '1' },
  body: { api_result: 1, api_data: { api_powerup_flag: 1,
    api_ship: { api_id: 4460, api_ship_id: 916, api_kyouka: [0, 0, 0, 0, 7 + i * 2] }, api_deck: [] } },
}))
