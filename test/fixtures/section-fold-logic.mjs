// 把 section-fold 的**开合判据**真编译出来跑。
//
// 为什么要单独立一份：折叠这类分支写反了，源码文本照样匹配得上——
// 「默认全展开」被改成「默认全折起来」，`opened.has(name)` 与 `!closed.has(name)`
// 在源码里长得一样近（见共享层 source-pattern-guards-miss-logic-bugs）。
// 判据已经抽成纯函数（`sectionIsOpen` / `toggleSectionFold`），脱开 DOM 就能测。
//
// 整个模块真编译，只把 kernel 换成桩：`registerViewSettler` 要到
// `installSectionFolding` 里才会被调用，这份护栏不碰它。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-section-fold-'))
  fs.writeFileSync(
    path.join(dir, 'kernel.ts'),
    'export const registerViewSettler = (_root: unknown, _fn: () => void) => {}\n',
  )
  fs.copyFileSync(
    path.join(ROOT, 'src', 'renderer', 'section-fold.ts'),
    path.join(dir, 'section-fold.ts'),
  )
  const outfile = path.join(dir, 'section-fold.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'section-fold.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

export const sectionIsOpen = loaded.sectionIsOpen
export const toggleSectionFold = loaded.toggleSectionFold
