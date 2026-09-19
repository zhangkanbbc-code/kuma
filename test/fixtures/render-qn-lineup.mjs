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
import { captureLineup, LINEUP_GENERAL_KEY, lineupApplies, lineupMapKey } from './src/shared/lineup-record'

let mg = { decks: [], ships: {}, slotitems: {}, master: { ships: {}, slotitems: {} } }
let fleetCheck = {}
let lineups = {}
const lineupCards = new Map()
let qp = { trackers: {} }
let state = { lineupOpen: false, lineupMap: {}, rows: [], maps: {} }
const periodOfRow = (row) => [row.periodLabel, '']
const questMapRefs = (row) => state.maps[row.id] ?? row.mapIds ?? []
const mapCodeOf = (id) => \`\${Math.floor(id / 10)}-\${id % 10}\`
const buildRows = () => state.rows
const fmtDate = () => '2026-09-18'
const fmtTime = () => '14:20:30'
const masterShipName = (mstId) => mg.master.ships[mstId]?.name ?? \`#\${mstId}\`
const esc = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const entityNameHtml = (_kind, _id, name) => \`<span class="entity-term e-ship">\${esc(name)}</span>\`
const entityNamePlain = (_kind, _id, name) => name
const alvIconHtml = (alv) => alv > 0 ? \`<span class="alv">熟练\${alv}</span>\` : ''

const pinCard = () => { throw new Error('render fixture does not open cards') }

${source.slice(start, end)}

const applyState = (inputState, row) => {
  state = {
    lineupOpen: false,
    lineupMap: {},
    rows: row ? [row] : [],
    maps: {},
    ...inputState,
  }
  mg = { slotitems: {}, ...inputState.mg }
  fleetCheck = inputState.fleetCheck ?? {}
  lineups = inputState.lineups ?? {}
  qp = inputState.qp ?? { trackers: {} }
}

export const renderLineup = (inputState, row) => {
  applyState(inputState, row)
  return lineupSectionHtml(row)
}

export const renderLineupCard = (inputState, questId, mapKey) => {
  applyState(inputState)
  return lineupCardBodyHtml(questId, mapKey)
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

export const { renderLineup, renderLineupCard } = createRequire(import.meta.url)(outfile)
