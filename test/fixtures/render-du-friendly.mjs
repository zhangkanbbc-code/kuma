// 把铎的友军舰队一节（friendlyFleetsHtml）**原样切出来**真编译一遍，
// 好让护栏对着产物 HTML 下断言而不是源码文本。手法照搬 fixtures/render-di-arena.mjs。
//
// 「两层并列不合并」与「空态只在两层都空时出声」这两条只能对着产物验：
// 把本地层写成 `seen.length ? seen : pack` 这种择一显示，源码读起来一样自然，
// 正则也钉不住——只有真渲染一遍、数一数两个层标在不在，才看得出来。
//
// 要請类型的文案（通常要請/強力要請）引**真的那张表**：桩掉的话文案改错了护栏照样绿。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'du.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `du.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const SECTION = sliceBetween(
  '// 友军舰队一节。**两层并列不合并**',
  'const extrasCardHtml = (info: any): string => {',
  '友军舰队一节 friendlyFleetsHtml',
)

const SHARED = path.join(ROOT, 'src', 'shared', 'friendly-fleet.ts').replace(/\\/g, '/')

const HARNESS = `
import { FRIENDLY_REQUEST_NAME, type FriendlyFleetRecord } from '${SHARED}'

type EventOperations = any

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])
// 链与译名是**另外两个模块的事**，这里只需要认得出「它确实去连了这个号」
const elink = (domain: string, id: number | string, text: string): string =>
  '<a data-el="' + domain + ':' + id + '">' + text + '</a>'
const entityTermHtml = (domain: string, _id: unknown, text: string): string =>
  '<span data-term="' + domain + '">' + esc(text) + '</span>'
const entityNamePlain = (_domain: string, _id: number, fallbackJa = ''): string => fallbackJa
const fmtDateTime = (ts: number) => 'TS' + ts
// 头像壳子在真实现里就是个 <span class="ship-thumb ...">，里面还套一层 span——
// 这条护栏要盯的正是「.op-friend 里的 span 会不会又被压成块级」，所以壳子得留着。
const shipThumbHtml = (mstId: number, name: string, opt: any = {}): string =>
  '<span class="ship-thumb ' + (opt.className ?? '') + '" data-ship-id="' + mstId + '"' +
  ' title="' + esc(name) + '"><span class="ship-thumb-fallback">' + esc(name.charAt(0)) + '</span></span>'
const mg: any = { master: { ships: {}, slotitems: {} } }

${SECTION}

export { friendlyFleetsHtml, mg }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-du-friendly-'))
  const entry = path.join(dir, 'friendly-section.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'friendly-section.cjs')
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
 * 渲染友军舰队一节。
 *
 * `seen` = 本机遭遇志的聚合结果，`pack` = 随包资料层的编成。
 * `masterShips` 是这一轮的主数据舰表（`{ [mstId]: { name } }`），不给就当主数据没到手。
 * `masterItems` 同理，是装备表（`{ [mstId]: { name } }`）——悬停里的装备名从它来。
 */
export const renderFriendlySection = (seen = [], pack = [], masterShips = {}, masterItems = {}) => {
  loaded.mg.master = { ships: masterShips, slotitems: masterItems }
  return loaded.friendlyFleetsHtml(seen, pack)
}
