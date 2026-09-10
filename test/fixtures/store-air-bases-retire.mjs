// 原样切出 start2 reducer 和 hydrateDomain 真编译；不 import 会打开真账本的 store.ts。
// 只替换账本与日志出口，活动判定、陆航清理和状态初始化均使用真实源码。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src/main/mg/store.ts'), 'utf8').replace(/\r\n/g, '\n')
const cut = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `store.ts 切片锚点失效：${from}`)
  return source.slice(start, end)
}
const initialState = cut('const state: MgState = {', '\n// 60 秒内完成的入渠')
const hydrate = cut('export const hydrateDomain = (data: any) => {', '\n// 需要跨重启保留的切片')
const converters = cut('const first = (v: unknown)', '\nconst reducers:')
const head = "'/kcsapi/api_start2/getData': (body, _post, ts) => {"
const reducer = cut(head, '\n  },\n')
const harness = `
import { retireAirBasesOfArea, retireClosedAreas } from './src/main/mg/air-bases'
import { detectEventAreas } from './src/shared/event-area'
import { restoreSortieAcrossRestart } from './src/shared/sortie-restore'
import { upgradeBattleView } from './src/main/mg/battle'
${initialState}
export { state }
export const logs: string[] = []
export const calls: any[] = []
const console = { log: (message: string) => logs.push(message) }
const ledger = Object.fromEntries(
  ['observeEventMapCatalog', 'closeEventMapCatalog', 'archiveEvent'].map((name) => [
    name, (...args: any[]) => calls.push({ name, args, airBases: state.player.airBases }),
  ]),
)
export const reset = () => {
  ${initialState.replace('const state: MgState', 'const initial')}
  Object.assign(state, initial)
  logs.length = 0
  calls.length = 0
}
${converters}
${hydrate}
export const start2 = ${reducer.slice(head.indexOf('('))}
}
`

const loaded = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-air-bases-retire-'))
  const outfile = path.join(dir, 'reducer.cjs')
  try {
    buildSync({
      stdin: { contents: harness, resolveDir: ROOT, loader: 'ts' },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    return createRequire(import.meta.url)(outfile)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})()

export const { state, logs, calls, reset, hydrateDomain, start2 } = loaded
