// 把「常规图特效舰」那一节真编出来渲染一遍，好让护栏对着**渲染产物**下断言而不是源码文本。
//
// 用它的护栏：test/normal-map-bonus.test.mjs。
// 做法照搬 test/fixtures/render-yu.mjs，只是这一节牵的东西少得多：
// 换成桩的只有牵 electron 的内核与另外两个模块自己的事（链、译名），
// **台账（shared/normal-map-bonus）与这一节的拼装逻辑一律用真的**——
// 「没数据的图零痕迹」「Boss 点标出来」这类判据写反了源码文本照样匹配得上。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const STUBS = {
  'renderer/kernel.ts': `
    const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    export const esc = (s: unknown): string =>
      String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c as keyof typeof ENT])
    // 主数据挂在 globalThis 上惰性取：一次编译要跑「主数据在场 / 不在场」两种用例
    export const mg: any = new Proxy({}, { get: (_t, key) => (globalThis as any).__mg?.[key] })
  `,
  // 链与译名是**另外两个模块的事**，这里只需要认得出「它确实去连了这个号」
  'renderer/link.ts': `
    export const elink = (type: string, id: number | string, text: string): string =>
      '<a data-el="' + type + ':' + id + '">' + text + '</a>'
  `,
  'renderer/localization.ts': `
    export const entityNameHtml = (
      domain: string,
      id: number | string,
      fallbackJa = '',
      _options: unknown = {},
    ): string => '<span data-name="' + domain + ':' + id + '">' + fallbackJa + '</span>'
  `,
}

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-mapbonus-'))
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true })
  for (const [rel, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, 'src', ...rel.split('/')), source)
  }
  const outfile = path.join(dir, 'map-bonus.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'src', 'renderer', 'map-bonus.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', '@electron/remote'],
    logLevel: 'silent',
  })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

/**
 * 渲染一张图的特效舰一节。
 *
 * `master` 是这一轮的主数据（`{ ships, stypes }`）；不给就当主数据还没到手，
 * 用来验兜底那条腿（台账自带的日文名顶上，而不是渲染出 undefined）。
 */
export const renderMapBonus = (code, master = null) => {
  globalThis.__mg = { master: master ?? { ships: {}, stypes: {} } }
  return loaded.mapSpecialBonusHtml(code)
}
