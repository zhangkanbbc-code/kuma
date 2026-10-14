// 从装备卷切出图鉴装备列表的单行（equipBookRowHtml）真编译；外部状态、图标与名字渲染补桩，产物放临时目录。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const source = fs.readFileSync(new URL('../../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const start = source.indexOf('const equipBookRowHtml = (')
const end = source.indexOf('\nconst ', start + 1)
assert.ok(start >= 0 && end > start, '缺少 equipBookRowHtml')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-equip-book-row-'))
const entry = path.join(dir, 'row.ts')
const outfile = path.join(dir, 'row.cjs')
fs.writeFileSync(entry, `
let instances = new Map<number, [string, any][]>()
let once = new Set<number>()
let equippedIds = new Set<number>()
const equipState = { selected: 0, open: false }
const equipInstancesOf = (mstId: number) => instances.get(mstId) ?? []
const equipHeldOnce = (mstId: number) => once.has(mstId)
const equippedInstIds = () => equippedIds
const equipTypeIconHtml = () => '<i class="ico"></i>'
const entityNamePlain = (_d: string, _id: number, name: string) => name
const entityNameHtml = (_d: string, _id: number, name: string) => '<span class="nm-c">' + name + '</span>'
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
${source.slice(start, end)}
export const renderEquipBookRow = (input: any) => {
  instances = new Map(Object.entries(input.instances ?? {}).map(([mst, ids]: [string, any]) => [Number(mst), ids.map((id: number) => [String(id), { mstId: Number(mst), level: 0 }])]))
  once = new Set(input.once ?? [])
  equippedIds = new Set(input.equipped ?? [])
  return equipBookRowHtml(input.equip)
}
`)
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
export const { renderEquipBookRow } = createRequire(import.meta.url)(outfile)
