// 把内核的格納庫増設三件套（`hangarSlotCapacity` / `hangarExpansionOf` /
// `ownedHangarExpansionOf`）**原样切出来**真编译一遍，好让护栏对着返回值下断言。
//
// ⚠️ 渲染层整个打成 bundle、又 require('electron')，import 不进来；而这三件事
// 恰恰是「写反了不报错」的典型：一手值与主数据原量都是同一个下标上的数字，
// 正则匹配源码分不出「读了 onslotMax」和「读了 maxEq」，更看不出减法的方向。
// 所以走切片编译这条路，与 fixtures/store-hangar-expand 同一手法。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')

const kernel = read('src', 'renderer', 'kernel.ts')

const cut = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 从小节抬头切到「旧记忆退场」那一段之前：三个导出 + 私有的 shipOnslotMax 都在里面。
// 退场清理那几行读 uiGet/uiSet（要 @electron/remote），故意切在它前面。
const HANGAR = cut(
  kernel,
  '// ---- 格納庫増設：读实例侧的一手上限 ----',
  '// 推断层的旧记忆',
  '内核的格納庫増設三件套',
)

// 切片里那三个函数自带 `export const`，不要再补一行 re-export（同名重复导出，esbuild 直接报错）
const HARNESS = `
export const mg: any = { ships: {}, master: { ships: {} } }

${HANGAR}
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-kernel-hangar-'))
  const entry = path.join(dir, 'hangar.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'hangar.cjs')
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

/**
 * 摆一局在册表。
 *
 * @param ships `{ [rosterId]: { mstId, onslotMax? } }`——`onslotMax` 缺省 =
 *              这艘舰没被扩过（真报文里那个键根本不存在，不是空数组）
 * @param maxEq `{ [mstId]: number[] }` 主数据各格标准搭载
 */
export const reset = (ships = {}, maxEq = {}) => {
  loaded.mg.ships = {}
  loaded.mg.master.ships = {}
  for (const [id, one] of Object.entries(ships)) {
    const rosterId = +id
    loaded.mg.ships[rosterId] = {
      id: rosterId,
      shipId: one.mstId,
      ...(one.onslotMax ? { onslotMax: one.onslotMax } : {}),
    }
  }
  for (const [mstId, eq] of Object.entries(maxEq)) {
    loaded.mg.master.ships[+mstId] = { maxEq: eq }
  }
}

export const hangarSlotCapacity = (...args) => loaded.hangarSlotCapacity(...args)
export const hangarExpansionOf = (...args) => loaded.hangarExpansionOf(...args)
export const ownedHangarExpansionOf = (...args) => loaded.ownedHangarExpansionOf(...args)
