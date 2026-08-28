// 把「今日改修」的整条行渲染（todayImprovementRows）**原样切出来**真编译一遍。
//
// 做法照搬 test/fixtures/render-ship-caption.mjs：整段从 ji.ts 切走，源码一个字不改，
// 外部名字在这里补桩。**不断言源码文本**——「不在手边」数错队、折叠态漏答一问、
// 缺口又被截断，正则一条也拦不住。
//
// 载荷判据引真的那一份，不补桩：装备实例索引、闲置未锁计数、在籍舰在不在外面
// （shipAwayIndex / equipHolderShipIndex）——这几件正是这份护栏要盯的东西。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ji.ts'), 'utf8')
const kernelSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'kernel.ts'), 'utf8')

// 「这件装备跟着舰出门了」要认联合出击的第 2 舰队，判据本体从 kernel.ts 原样切走，
// **不打桩**：桩一写成「联合就算出击」，编队中与出击中的分界就在测试里被抹平了。
const ESCORT_STATE = (() => {
  const anchor = "export type CombinedEscortState = 'sortie' | 'formed'"
  const start = kernelSource.indexOf(anchor)
  assert.ok(start >= 0, 'kernel.ts 里找不到 combinedEscortState，这条守卫的锚点要跟着改')
  return kernelSource.slice(start)
})()

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `ji.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const EQUIP_INDEX = sliceBetween('let equipIndexSource', '\n// ---- 模块状态 ----', '装备实例索引')
// 组根那一层用真的：折叠接不接得上、`.grp-box` 有没有裹住行，正是这份护栏要盯的。
const GROUP_BOX = sliceBetween(
  '/**\n * 分类分组的组头 + 组内容',
  '\n// ---- 舰娘卷 ----',
  'groupBoxHtml',
)
const ROW_TYPE = sliceBetween(
  'interface TodayImprovementRow {',
  '// 改修素材的口径与仓库卷一致',
  'TodayImprovementRow',
)
const STOCK = sliceBetween(
  '// 改修素材的口径与仓库卷一致',
  'const improvementMaterialLink = (',
  '闲置未锁 / 在不在外面',
)
const HELPER_LIST = sliceBetween(
  'const improvementHelperListHtml = (',
  'const todayImprovementRows = (',
  'improvementHelperListHtml',
)
// 这一段的尾巴正好把 `todayImprovementGroupsHtml`（按类别分组 + 接可折叠组头）
// 一并切进来——它就写在 `todayImprovementRows` 与「更多分类」之间。
const TODAY = sliceBetween(
  'const todayImprovementRows = (',
  '\n/**\n * 「更多分类 · 装备类别」',
  'todayImprovementRows',
)
const COST_CELL = sliceBetween(
  'const improveCostCell = (',
  'const improveCostPairCell = (',
  'improveCostCell',
)
const FODDER = sliceBetween(
  'const improveFodderHtml = (',
  '/** 七枚圆点的周历',
  'improveFodderHtml',
)

const abs = (...parts) => path.join(ROOT, ...parts).replace(/\\/g, '/')

const HARNESS = `
import { IMPROVE_MAX, type ImproveStageCost } from '${abs('src', 'shared', 'improve-budget.ts')}'
// 「已装备的不算素材」引真的那一份（三处判据的唯一出处），不打桩：
// 桩一写成「只查舰上」，陆航里飞着的机体就会被当成素材，正是这份护栏要盯的错法。
import { equippedSlotIds } from '${abs('src', 'shared', 'equipped-slots.ts')}'

// ---- 可注入的模块级状态（每个用例自己摆）----
export const stub: any = {
  eo: [],
  equips: {},
  ships: {},
  items: {},
  equipTypes: {},
  state: {},
  day: 2,
}

const esc = (s: unknown) => \`\${s ?? ''}\`.replace(/[&<>"']/g, (c) => \`&#\${c.charCodeAt(0)};\`)
const mg: any = new Proxy({}, { get: (_t, key: string) => stub.state[key] })
const eoByEquip = { values: () => stub.eo as any[] }
const friendlyEquips = { get: (id: number) => stub.equips[id] }
const friendlyShips = { get: (id: number) => stub.ships[id] }
const useitemMst = { get: (id: number) => stub.items[id] }
const equipMatches = (_equip: any) => true
const jstDayOfWeek = () => stub.day
const masterShipName = (mstId: number) => stub.ships[mstId]?.api_name ?? \`舰娘 #\${mstId}\`
const elink = (domain: string, id: number, name: string) =>
  \`<a class="el" data-\${domain}="\${id}">\${esc(name)}</a>\`
const elinkHtml = (domain: string, id: number, inner: string) =>
  \`<a class="el" data-\${domain}="\${id}">\${inner}</a>\`
const entityNameHtml = (_domain: string, _id: number, name: string) => esc(name)
const entityNamePlain = (_domain: string, _id: number, fallback: string) => fallback
const equipTypeIconHtml = (_iconId: number, _opts: unknown) => '<i class="eqicon"></i>'
const equipVisualLink = (mstId: number, label?: string) =>
  \`<span class="entity-visual">\${elink('mstEquip', mstId, label ?? stub.equips[mstId]?.api_name ?? \`#\${mstId}\`)}</span>\`
const improvementMaterialLink = (index: number, label: string) =>
  \`<a class="el" data-material="\${index}">\${label}</a>\`
// 分组那一层要用的：类别名表与「术语挂号」外壳。挂号只影响悬停释义，与分组无关，
// 这里原样吐出标签就够。
const equipTypes = { get: (id: number): string | undefined => stub.equipTypes[id] }
const entityTermHtml = (_type: string, _id: unknown, text: unknown) => esc(text)

${ESCORT_STATE}

${GROUP_BOX}

${EQUIP_INDEX}

${ROW_TYPE}

${STOCK}

${HELPER_LIST}

${TODAY}

${COST_CELL}

${FODDER}

export { todayImprovementRows, todayImprovementGroupsHtml, invalidateEquippedInstIds }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-today-improve-'))
  const entry = path.join(dir, 'today.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'today.cjs')
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
 * 摆好这一轮的账本，然后跑一遍今日改修。
 *
 * `setup.mg` 直接就是模块看到的那份 mg：ships / slotitems / decks / ndocks /
 * sortie / materials / useitems / airBases 缺省都补空，用例只写它关心的那几样。
 */
export const todayRows = (setup = {}) => {
  const stub = loaded.stub
  stub.eo = setup.eo ?? []
  stub.equips = setup.equips ?? {}
  stub.ships = setup.shipMst ?? {}
  stub.items = setup.items ?? {}
  stub.equipTypes = setup.equipTypes ?? {}
  stub.day = setup.day ?? 2
  stub.state = {
    ships: {},
    slotitems: {},
    decks: [],
    ndocks: [],
    sortie: null,
    // 缺省必须显式给 0：mg 是个 Proxy，缺项读出来是 undefined，而
    // `undefined <= 0` 是 false——联合判定会在「没编成」的局面里一路走下去
    combinedFlag: 0,
    materials: {},
    useitems: {},
    airBases: [],
    ...(setup.mg ?? {}),
  }
  loaded.invalidateEquippedInstIds()
  return loaded.todayImprovementRows()
}

/**
 * 今日改修按装备类别分组之后的整段 HTML（组头 + 组内容都在里面）。
 *
 * 摆法与 `todayRows` 相同，另加 `equipTypes`（类别 id → 类别名）——组头写的就是它。
 */
export const todayGroupsHtml = (setup = {}) => loaded.todayImprovementGroupsHtml(todayRows(setup))

/** 折叠态那一截（<summary> 里的行）。 */
export const foldedOf = (html) => /<summary>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? ''

/** 展开层那一截。 */
export const expandedOf = (html) => /<div class="ti-more">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? ''
