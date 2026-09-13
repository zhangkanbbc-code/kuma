// 从装备卷切出原函数真编译；仅外部状态与转义补桩，产物全部放临时目录。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const source = fs.readFileSync(new URL('../../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
const start = source.indexOf('const equipCollectionFootHtml = (): string =>')
const end = source.indexOf('\nconst EQUIP_STATS:', start)
assert.ok(start >= 0 && end > start)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-equip-book-foot-'))
const entry = path.join(dir, 'foot.ts')
const outfile = path.join(dir, 'foot.cjs')
fs.copyFileSync(new URL('../../src/shared/equip-book.ts', import.meta.url), path.join(dir, 'equip-book.ts'))
fs.writeFileSync(entry, `
import { EQUIP_BOOK_PAGE_SIZE } from './equip-book'
let friendlyEquips = new Map()
let held = new Set()
let once = new Set()
let pages: number[] = []
const equipInstancesOf = (id: number) => held.has(id) ? [{}] : []
const equipHeldOnce = (id: number) => once.has(id)
const equipBookPagesRead = () => pages
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
${source.slice(start, end)}
export const renderEquipBookFoot = (input) => {
  friendlyEquips = new Map(input.equips.map((e) => [e.api_id, e]))
  held = new Set(input.held ?? [])
  once = new Set(input.once ?? [])
  pages = input.pages ?? []
  return equipCollectionFootHtml()
}
`)
buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
export const { renderEquipBookFoot } = createRequire(import.meta.url)(outfile)
