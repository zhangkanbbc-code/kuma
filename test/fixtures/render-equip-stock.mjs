// 把装备仓库「更多分类」的整块 HTML 原样切出来真编译一遍。
// 外围只摆在籍装备、类别主数据与本地化边界；断言看最终格子，不看源码字样。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(
  path.join(ROOT, 'src', 'renderer', 'modules', 'equip-stock.ts'),
  'utf8',
)

const start = source.indexOf('const moreCategoriesHtml = (): string => {')
const end = source.indexOf('\nconst SORT_COLUMNS:', start)
assert.ok(start >= 0 && end > start, '找不到装备仓库 moreCategoriesHtml，夹具锚点要跟着改')
const MORE_CATEGORIES = source.slice(start, end)
const applyRestStart = source.indexOf('const applyRest = (rows: Row[]): Row[] => {')
const applyRestEnd = source.indexOf('\n\n// 排序键', applyRestStart)
assert.ok(applyRestStart >= 0 && applyRestEnd > applyRestStart, '找不到装备仓库 applyRest，夹具锚点要跟着改')
const APPLY_REST = source.slice(applyRestStart, applyRestEnd)
const searchFoldModule = path.join(ROOT, 'src', 'renderer', 'search-fold.ts').replace(/\\/g, '/')

const HARNESS = `
import { searchFold } from '${searchFoldModule}'

interface Row {
  name: string
  inst: { mstId: number }
}

export const state = {
  moreOpen: true,
  typeFilter: 0,
  smart: null as string | null,
  search: '',
}
export const equipTypeNames = new Map<number, string>()
export const rows: Array<{ type2: number; iconId: number }> = []
const SMART_FILTERS: Record<string, { test: (row: Row) => boolean }> = {}

const buildRows = () => rows
const effectiveEquipCategory = (type2: number, _iconId: number) => type2
const equipCategoryFallbackName = (type2: number, name?: string) => name ?? \`分类 \${type2}\`
const esc = (value: unknown): string =>
  \`\${value ?? ''}\`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const entityNameHtml = (domain: string, id: number, fallback: string): string => {
  if (domain === 'equipType' && id === 6) return '舰上战斗机'
  return esc(fallback)
}
const entityNamePlain = (_domain: string, _id: number, fallback: string): string => fallback

${MORE_CATEGORIES}
${APPLY_REST}

export { applyRest, moreCategoriesHtml }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-equip-stock-'))
  const entry = path.join(dir, 'equip-stock.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'equip-stock.cjs')
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

export const renderEquipCategories = () => {
  loaded.equipTypeNames.clear()
  loaded.equipTypeNames.set(6, '艦上戦闘機')
  loaded.rows.splice(0, loaded.rows.length, { type2: 6, iconId: 6 })
  loaded.state.moreOpen = true
  loaded.state.typeFilter = 0
  return loaded.moreCategoriesHtml()
}

export const filterEquipNames = (search, names) => {
  loaded.state.smart = null
  loaded.state.search = search
  return loaded.applyRest(
    names.map((name, index) => ({ name, inst: { mstId: index + 1 } })),
  ).map((row) => row.name)
}
