// 维护者裁决 2026-11-03：切片编译真实读取端，外部状态补桩，不启动窗口。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('../../', import.meta.url))
const ji = fs.readFileSync(path.join(root, 'src/renderer/modules/ji.ts'), 'utf8')
const forecast = fs.readFileSync(path.join(root, 'src/renderer/combat-forecast.ts'), 'utf8')
const slice = (source, begin, finish) => {
  const start = source.indexOf(begin)
  const end = source.indexOf(finish, start)
  assert.ok(start >= 0 && end > start, `读取端切片缺失：${begin}`)
  return source.slice(start, end)
}
const normalizerImport = (source) => source.match(/^import \{ normalizeInitialEquipment \} from .*$/m)?.[0] ?? ''
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-initial-equipment-'))
const compile = (name, contents, resolveDir) => {
  const outfile = path.join(dir, `${name}.cjs`)
  buildSync({ stdin: { contents, resolveDir, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return createRequire(import.meta.url)(outfile)
}

const ui = compile('slots', `
${normalizerImport(ji)}
import { equipTypeIconHtml } from '../equip-icon'
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const entityNamePlain = (_type, _id, name) => name
const elink = (type, id, name) => '<span class="el" data-etype="' + type + '" data-eid="' + id + '">' + esc(name) + '</span>'
let friendlyEquips, shipState, shipProfileByMst, ownedHangarExpansionOf
const growthGapNote = ''
export const render = (row, equips, expansions = {}, fallback = false) => {
  friendlyEquips = new Map(equips.map(eq => [eq.api_id, eq]))
  shipState = { selectedForm: row.ID }
  shipProfileByMst = new Map([[row.ID, { initialEquips: row.装备.初期装备 }]])
  ownedHangarExpansionOf = (_id, index) => expansions[index]
  const wikiEntry = row
  if (fallback) {
    ${slice(ji, '// kcwiki 没收这一形态时,初期装备按实体级回退取 wikiwiki 舰页档案', '\n        })()}')}
  }
  ${slice(ji, 'const slots = wikiEntry.装备?.初期装备', '\n        })()}')}
}
`, path.join(root, 'src/renderer/modules'))

const model = compile('stock', `
${normalizerImport(forecast)}
import { genericLoadoutByStype } from '../shared/practice-loadout'
let mg = { master: { slotitems: {}, ships: {} }, slotitems: {} }
let pending
const queryLode = () => pending
${slice(forecast, 'const friendlyEquipment =', '\nconst friendlyShip =')}
${slice(forecast, 'const enemyEquipment =', '\nconst enemyShip =')}
${slice(forecast, 'let stockEquipByMst =', '\nconst practiceOpponentShip =')}
export const load = async (rows, equips) => {
  mg.master.slotitems = Object.fromEntries(equips.map(eq => [eq.api_id, { ...eq, name: eq.api_name }]))
  stockEquipRequested = false
  pending = Promise.resolve({ data: rows })
  ensureStockEquip()
  await new Promise(setImmediate)
}
export const stock = stockEquipmentFor
export const direct = () => {
  mg.slotitems = { 1: { mstId: 122, level: 0, alv: 0 } }
  return [friendlyEquipment({ slot: [1], slotEx: -1, onslot: [-1] }), enemyEquipment({ kc3_slots: [122], api_maxeq: [-1] })]
}
`, path.join(root, 'src/renderer'))

export const renderInitialSlots = ui.render
export const loadStockEquipment = model.load
export const stockEquipment = model.stock
export const directEquipment = model.direct

// 随包 kcwiki-ships 的真实条目，只保留本单读取的字段。
export const akizukiKaiNi = { ID: 963, 装备: { 初期装备: [{ id: 122, star: 4 }, { id: 15, star: 2 }, 121, { id: 40, star: 4 }], 搭载: [-1, -1, -1, -1] } }
export const akizukiKai = { ID: 330, 装备: { 初期装备: [122, 106, 40], 搭载: [0, 0, 0] } }
export const equips = [
  [122, '10cm連装高角砲+高射装置', 16],
  [15, '61cm四連装(酸素)魚雷', 5],
  [121, '94式高射装置', 16],
  [40, '25mm三連装機銃', 15],
  [106, '13号対空電探改', 11],
].map(([api_id, api_name, iconId]) => ({ api_id, api_name, api_type: [0, 0, 0, iconId], type2: 1, iconId }))
