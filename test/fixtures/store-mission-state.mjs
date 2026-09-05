// 把 store.ts 的远征状态 reducer 原样切出来真编译一遍。
// ⚠️ 不许直接 import store.ts：那个文件一 import 就会打开用户的真账本并跑迁移。
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

const head = "'/kcsapi/api_get_member/mission': (body, _post, ts) => {"
const start = source.indexOf(head)
assert.ok(start >= 0, 'store.ts 里找不到远征状态 reducer')
const end = source.indexOf('\n  },\n', start)
assert.ok(end > start, '远征状态 reducer 没有可识别的结尾')
const reducer = `export const missionState = ${source.slice(start + head.indexOf('('), end + 4)}`

const harness = `
type Section = string
export const state: any = {
  player: {
    missionStates: {},
    missionStatesTs: null,
    missionLimitTs: null,
  },
}
${reducer}
`

const loaded = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-mission-state-'))
  const entry = path.join(dir, 'reducer.ts')
  fs.writeFileSync(entry, harness)
  const outfile = path.join(dir, 'reducer.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
})()

export const applyMissionState = (body, ts) => loaded.missionState(body, {}, ts)
export const missionStateSnapshot = () => ({ ...loaded.state.player })
