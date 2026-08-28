// 把深海舰目录的「按舰种分组」（abyssShipGroupsHtml）**原样切出来**真编译一遍。
//
// 做法照搬 test/fixtures/render-today-improve.mjs：整段从 ji.ts 切走，源码一个字不改，
// 外部名字在这里补桩。**不断言源码文本**——组根有没有裹住行、组头的计数报的是形态数
// 还是编号数、筛空的舰种有没有留下一个空组头，正则一条也拦不住。
//
// 三样用真的、不补桩：`groupBoxHtml`（组根那一层，正是折叠接得上与否的关键）、
// `stypeLabelOf`（「主数据把 8 和 9 都叫戦艦、要按名字归并」那条口径）、
// 以及被测函数本身。
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

const GROUP_BOX = sliceBetween(
  '/**\n * 分类分组的组头 + 组内容',
  '\n// ---- 舰娘卷 ----',
  'groupBoxHtml',
)
const STYPE_LABEL = sliceBetween(
  'const stypeLabelOf = (id: number): string =>',
  '\n/**\n * 主数据把 8 和 9 都写作「戦艦」',
  'stypeLabelOf',
)
const GROUPS = sliceBetween(
  '/**\n * 深海舰目录按舰种分组',
  '\nconst abyssCatalogHtml = ()',
  'abyssShipGroupsHtml',
)

const HARNESS = `
// ---- 可注入的模块级状态（每个用例自己摆）----
export const stub: any = { stypes: {}, selected: 0, open: false }

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c])
const mg: any = { master: { get stypes() { return stub.stypes } } }
const abyssState: any = {
  get selected() { return stub.selected },
  get open() { return stub.open },
}
// 本地化在这份护栏里不是被测对象：原样吐出主数据里的名字就够
const entityNamePlain = (_type: string, _id: unknown, fallback: unknown) => \`\${fallback ?? ''}\`
const entityNameHtml = (_type: string, _id: unknown, text: unknown, _opts?: unknown) => esc(text)
const entityTermHtml = (_type: string, _id: unknown, text: unknown) => esc(text)
const shipThumbHtml = (id: number, _alt: string, _opts: unknown) => \`<img data-thumb="\${id}">\`

${GROUP_BOX}

${STYPE_LABEL}

${GROUPS}

export { abyssShipGroupsHtml }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-abyss-groups-'))
  const entry = path.join(dir, 'abyss.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'abyss.cjs')
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
 * 摆好舰种名表，把这批深海舰跑成分组 HTML。
 *
 * `setup.stypes` = 舰种 id → 名字（主数据 `api_mst_stype` 的口径）；
 * `setup.selected` / `setup.open` 是「从别处跳进某个编号」时的高亮态。
 */
export const abyssGroupsHtml = (list, setup = {}) => {
  const stub = loaded.stub
  stub.stypes = setup.stypes ?? {}
  stub.selected = setup.selected ?? 0
  stub.open = setup.open ?? false
  return loaded.abyssShipGroupsHtml(list)
}

/** 一艘深海舰的最小形状。同名同 yomi 的几条会被归成同一个「形态」。 */
export const abyssShip = (id, name, stype, yomi = '-') => ({
  api_id: id,
  api_name: name,
  api_stype: stype,
  api_yomi: yomi,
})

/**
 * 切出每个 `.grp-box` 组：返回 `{ key, head, body }`。
 *
 * 按 `<div class="grp-box">` 硬切而不是整只正则匹配——组内的行自己带一层层 `<div>`，
 * 想用一条正则配平括号是自找的。组头里只有 `<b>` 与 `<span>`，所以头那一截
 * 用非贪婪配到第一个 `</div>` 是准的。
 */
export const groupsOf = (html) =>
  html
    .split('<div class="grp-box">')
    .slice(1)
    .map((chunk) => {
      const head = /^<div class="grp" data-grp-key="([^"]*)">([\s\S]*?)<\/div>/.exec(chunk)
      return {
        key: head?.[1] ?? '',
        head: head?.[2] ?? '',
        body: chunk.slice(head?.[0].length ?? 0),
      }
    })
