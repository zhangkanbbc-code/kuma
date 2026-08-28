// 把 store.ts 里读**战果包**字段的那四个纯函数原样切出来编译一遍，好让护栏对真报文下断言：
// `dropShipGetMessage` / `exmapSenkaOf` / `nextMapIdsOf` / `escapeOfferOf`。
//
// 为什么不直接 import：`store.ts` 一路拉到 `../env`（`app.getVersion()`），
// node --test 载不进 electron。而这几个读取器本身不碰任何模块状态——
// 切出来跑的就是线上那份源码，改错了会当场红（这跟「正则匹配源码文本」不是一回事）。
//
// 进点报文那几个读取器在隔壁的 store-map-readers.mjs。
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

const RESULT_READERS = sliceBetween(
  'const dropShipGetMessage = (dropShip: any): string => {',
  'const enemyPreviewOf =',
  '战果包字段读取器',
)

const HARNESS = `
${RESULT_READERS}

export { dropShipGetMessage, exmapSenkaOf, nextMapIdsOf, escapeOfferOf }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-store-result-readers-'))
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

export const { dropShipGetMessage, exmapSenkaOf, nextMapIdsOf, escapeOfferOf } =
  createRequire(import.meta.url)(bundle)
