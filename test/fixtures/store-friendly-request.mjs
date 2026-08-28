// 把友军要請那条 reducer、以及跨重启的一对（domainSnapshot / hydrateDomain）
// **原样切出来**真编译一遍，与 fixtures/store-berth-reducer.mjs 同一手法。
//
// ⚠️ **不许直接 import store.ts**：那个文件一 import 就会打开用户的真账本并跑迁移。
//
// 为什么非得测真代码：这一条的全部难点在「未知 ≠ 关」。
// `friendlyRequest` 缺席时若被回灌成 `{ flag: 0 }`，源码读起来一样自然，
// 消费端却会从「不知道」变成「确定没开」——只有真跑一趟往返才看得见差别。
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

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 回灌与快照是一对，中间没有别的东西，一刀切下来省得两处锚点各自漂移。
const SNAPSHOT_PAIR = sliceBetween(
  'export const hydrateDomain = (data: any) => {',
  '// ---- 各字段的换算小工具 ----',
  '跨重启的回灌与快照 hydrateDomain / domainSnapshot',
)

/** 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。 */
const asReducer = (name, head, label) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return `export const ${name} = ${source.slice(start + head.indexOf('('), end + 4)}`
}

const SET_FRIENDLY = asReducer(
  'setFriendlyRequest',
  "'/kcsapi/api_req_member/set_friendly_request': (_body, post) => {",
  '友军要請 reducer',
)

const HARNESS = `
type Section = string

export const state: any = {
  player: {},
  mapGauges: {},
  eventAreas: {},
  sortie: null,
}

${SNAPSHOT_PAIR}
${SET_FRIENDLY}
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-friendly-request-'))
  const entry = path.join(dir, 'reducer.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'reducer.cjs')
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

/** 清成「这台机器从没收到过 set_friendly_request」的局面。 */
export const reset = () => {
  loaded.state.player = {}
}

/** 报文原样：post 参数都是数字字符串，游戏就是这么发的。 */
export const setFriendlyRequest = (flag, type) =>
  loaded.setFriendlyRequest(
    { api_result: 1 },
    { api_request_flag: `${flag}`, api_request_type: `${type}` },
    0,
  )

/** 参数缺席/不是数（防未来字段改名把账写成 NaN）。 */
export const setFriendlyRequestRaw = (post) => loaded.setFriendlyRequest({ api_result: 1 }, post, 0)

export const friendlyRequest = () => loaded.state.player.friendlyRequest

/** 关一次机再开：快照落盘 → JSON 往返 → 回灌。 */
export const restart = () => {
  const persisted = JSON.parse(JSON.stringify(loaded.domainSnapshot()))
  reset()
  loaded.hydrateDomain(persisted)
  return persisted
}
