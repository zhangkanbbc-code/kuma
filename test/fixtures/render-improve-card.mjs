// 把装备抽屉的「改修工厂」卡**原样切出来**真编译一遍，好让护栏对着返回的 HTML 下断言。
//
// 做法照搬 test/fixtures/render-ship-caption.mjs：整段从 ji.ts 切走，源码一个字不改，
// 它引用到的外部名字在这里补桩。**不断言源码文本**——分组条件写反、周历圆点点错天、
// 角标挂到别处去，正则一条也拦不住。
//
// 三个真判据引真的那一份，不补桩：改修预算（improve-budget）、置信档位
// （improveEntryTier）、以及卡自己渲染出来的段名与折叠默认集的对应关系。
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

const CHIPS = `${sliceBetween('const CALENDAR_WEEKDAY_CHIPS = [', '] as const', 'CALENDAR_WEEKDAY_CHIPS')}] as const`
const TIER = sliceBetween(
  'const improveTierMark = (',
  'const improvementHelperListHtml = (',
  'improveTierMark',
)
const HELPER_LIST = sliceBetween(
  'const improvementHelperListHtml = (',
  'const todayImprovementRows = (',
  'improvementHelperListHtml',
)
const CARD = sliceBetween(
  '// ---- 改修工厂（装备抽屉的那张卡）----',
  '// ---- 深海卷 ----',
  '改修工厂卡',
)
const FOLD_SET = sliceBetween('const OPEN_BY_DEFAULT = new Set(', '\n', 'OPEN_BY_DEFAULT')

const abs = (...parts) => path.join(ROOT, ...parts).replace(/\\/g, '/')

const HARNESS = `
import { improveEntryTier } from '${abs('src', 'shared', 'equip-sources.ts')}'
import type { EquipUpgradeRow } from '${abs('src', 'shared', 'equip-sources.ts')}'
import {
  IMPROVE_MAX,
  improveBudgetTo,
  improveRouteTotal,
  type CostPair,
  type ImproveCosts,
  type ImproveStageCost,
} from '${abs('src', 'shared', 'improve-budget.ts')}'

// ---- 可注入的模块级状态（每个用例自己摆）----
export const stub: any = {
  eo: null,
  equips: {},
  ships: {},
  items: {},
  materials: {},
  useitems: {},
  unlocked: {},
  day: 2,
  akashi: null,
  uncovered: false,
  coverageMax: 0,
}
export const setCoverage = (n: number) => {
  improveCoverageMax = n
}

const esc = (s: unknown) => \`\${s ?? ''}\`.replace(/[&<>"']/g, (c) => \`&#\${c.charCodeAt(0)};\`)
const eoByEquip = { get: (_id: number) => stub.eo }
const eoLode: any = { meta: { source: '第一方事实表' }, data: [] }
let improveCoverageMax = 0
const akashiListLode: any = { get meta() { return { source: 'akashi-list' } }, get data() { return stub.akashi } }
const mg: any = {
  get materials() { return stub.materials },
  get useitems() { return stub.useitems },
}
const friendlyEquips = { get: (id: number) => stub.equips[id] }
const friendlyShips = { get: (id: number) => stub.ships[id] }
const useitemMst = { get: (id: number) => stub.items[id] }
const unlockedEquipCount = (id: number) => stub.unlocked[id] ?? 0
const jstDayOfWeek = () => stub.day
const JST_WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const improvePackUncovered = (..._args: unknown[]) => stub.uncovered
const lodeCreditMark = (_meta: unknown, extra = '') =>
  \` <span class="credit-mark" title="\${esc(extra || '出处')}">源</span>\`
const elink = (domain: string, id: number, name: string) =>
  \`<a class="el" data-\${domain}="\${id}">\${esc(name)}</a>\`
const equipVisualLink = (mstId: number, label?: string) =>
  \`<span class="entity-visual">\${elink('mstEquip', mstId, label ?? stub.equips[mstId]?.api_name ?? \`#\${mstId}\`)}</span>\`
const improvementMaterialLink = (index: number, label: string) =>
  \`<a class="el" data-material="\${index}">\${label}</a>\`
const entityNamePlain = (_domain: string, _id: number, fallback: string) => fallback

${CHIPS}

${TIER}

${HELPER_LIST}

${CARD}

${FOLD_SET}

export { improveSectionHtml, OPEN_BY_DEFAULT }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-improve-card-'))
  const entry = path.join(dir, 'card.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'card.cjs')
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

/** 摆好这一轮的资料，然后渲染一张改修卡。 */
export const improveCardHtml = (setup = {}) => {
  const stub = loaded.stub
  stub.eo = setup.eo ?? null
  stub.equips = setup.equips ?? {}
  stub.ships = setup.ships ?? {}
  stub.items = setup.items ?? {}
  stub.materials = setup.materials ?? {}
  stub.useitems = setup.useitems ?? {}
  stub.unlocked = setup.unlocked ?? {}
  stub.day = setup.day ?? 2
  stub.akashi = setup.akashi ?? null
  stub.uncovered = setup.uncovered ?? false
  loaded.setCoverage(setup.coverageMax ?? 0)
  return loaded.improveSectionHtml(
    setup.equip ?? { api_id: 1, api_name: '样本装备' },
    setup.instances ?? [],
  )
}

/** 卡自己渲染出来的段名（折叠状态就是按它记的）。 */
export const sectionTitleOf = (html) => /<div class="sec-h">([^<]*)</.exec(html)?.[1] ?? ''

export const OPEN_BY_DEFAULT = loaded.OPEN_BY_DEFAULT
