// 从 qn.ts 原样切出阵容记录渲染函数真编译；只给模块状态与公共渲染服务桩。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'qn.ts'), 'utf8')
const start = source.indexOf('const lineupSlotHtml = ')
const end = source.indexOf('\nconst expeditionTogetherHtml = ', start)
assert.ok(start >= 0 && end > start, 'qn.ts 里找不到 lineupSectionHtml，夹具锚点要跟着改')

const HARNESS = `
import { lineupApplies } from './src/shared/lineup-record'

let mg = { decks: [], ships: {}, master: { ships: {}, slotitems: {} } }
let fleetCheck = {}
let lineups = {}
const periodOfRow = (row) => [row.periodLabel, '']
const fmtDate = () => '2026-09-18'
const fmtTime = () => '14:20:30'
const masterShipName = (mstId) => mg.master.ships[mstId]?.name ?? \`#\${mstId}\`
const esc = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const entityNameHtml = (_kind, _id, name) => \`<b class="entity">\${esc(name)}</b>\`
const entityNamePlain = (_kind, _id, name) => name
const alvIconHtml = (alv) => alv > 0 ? \`<span class="alv">熟练\${alv}</span>\` : ''

${source.slice(start, end)}

export const renderLineup = (state, row) => {
  mg = state.mg
  fleetCheck = state.fleetCheck ?? {}
  lineups = state.lineups ?? {}
  return lineupSectionHtml(row)
}
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-qn-lineup-'))
const outfile = path.join(dir, 'qn-lineup.cjs')
buildSync({
  stdin: {
    contents: HARNESS,
    loader: 'ts',
    resolveDir: ROOT,
    sourcefile: path.join(dir, 'qn-lineup.ts'),
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})

export const { renderLineup } = createRequire(import.meta.url)(outfile)
