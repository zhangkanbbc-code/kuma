// 把 store.ts 里读**进点报文**字段的那几个纯函数原样切出来编译一遍：
// `MAT_NAMES` / `mapGains` / `nodeNote`（获得物，含 EO 终点报酬那一路）与
// `bossClearedOf`（api_bosscomp）。
//
// 为什么不直接 import：`store.ts` 一路拉到 `../env`（`app.getVersion()`），
// node --test 载不进 electron。而这几个读取器本身不碰任何模块状态——
// 切出来跑的就是线上那份源码，改错了会当场红（这跟「正则匹配源码文本」不是一回事）。
//
// 战果包那四个读取器在隔壁的 store-result-readers.mjs。
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

const MAP_GAINS = sliceBetween(
  "const MAT_NAMES = ['燃料',",
  'const applyMapMaterialDelta =',
  '进点获得物 mapGains / nodeNote',
)
const BOSS_COMP = sliceBetween(
  'const bossClearedOf = (body: any, fallback: boolean | null): boolean | null =>',
  'const setMapGauge = (',
  'api_bosscomp 读取器 bossClearedOf',
)

const HARNESS = `
${MAP_GAINS}
${BOSS_COMP}

export { mapGains, nodeNote, bossClearedOf }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-store-map-readers-'))
  const entry = path.join(dir, 'readers.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'readers.cjs')
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

export const { mapGains, nodeNote, bossClearedOf } = createRequire(import.meta.url)(bundle)
