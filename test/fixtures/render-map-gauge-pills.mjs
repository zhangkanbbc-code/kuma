// 把海域卡那几枚计量条词条（ji.ts 的 mapGaugePillsHtml）**原样切出来**真编译一遍。
//
// 做法照搬 test/fixtures/render-abyss-groups.mjs：整段从 ji.ts 切走、源码一个字不改，
// 外部名字只补 `esc` 一个桩；**资料表（shared/map-gauge-metric）用真的**。
// 不断言源码文本——「表里没有的图一枚都不出」「多段图按攻略顺序各出一枚且带段序」
// 这两条判据写反了，正则一条也拦不住（源码里照样有那几个函数名）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ji.ts'), 'utf8')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `ji.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// 下界锚在下一个声明上，不锚在它的注释首行（注释是会重写的）
const PILLS = sliceBetween(
  'const mapGaugePillsHtml = (mapId: number): string =>',
  '\nconst mapDrawerHtml = ()',
  'mapGaugePillsHtml',
)

const HARNESS = `
import { mapGaugeSegmentLabels } from './map-gauge-metric'

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c])

${PILLS}

export { mapGaugePillsHtml }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-map-gauge-pills-'))
  for (const name of ['map-gauge-metric.ts', 'map-id.ts']) {
    fs.copyFileSync(path.join(ROOT, 'src', 'shared', name), path.join(dir, name))
  }
  const entry = path.join(dir, 'pills.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'pills.cjs')
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

export const { mapGaugePillsHtml } = createRequire(import.meta.url)(bundle)

/** 渲染产物里每一枚 own-pill 的纯文本（标签去掉、空白折平）。 */
export const pillTexts = (html) =>
  [...String(html).matchAll(/<span class="own-pill">([\s\S]*?)<\/span>/g)].map((match) =>
    match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
