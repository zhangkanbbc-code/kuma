// 锐的基地航空队机位与制空值：两条真实路径切出来放在同一份账本桩上。
//
// 机位 HTML 必须直接显示报文的 count/maxCount；制空值必须按装备 type2 判机种。
// 这样 icon 47 的東海、icon 48 的キ102乙、icon 46 的 TBM-3D 都不会被图标表拦掉。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8').replace(/\r\n/g, '\n')
const cut = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const ru = read('src', 'renderer', 'modules', 'ru.ts')
const fleetCalc = read('src', 'renderer', 'fleet-calc.ts')
const AIR_POWER_TABLES = cut(
  fleetCalc,
  'const AIRCRAFT_EXP = ',
  '\nexport interface AirPower',
  '制空熟练度表',
)
const FLEET_AIR_POWER = cut(
  fleetCalc,
  '/** 制空值。landbase: 0 舰队 / 1 基地出击 / 2 基地防空 */',
  '\n/**\n * 索敌 33 式',
  'fleetAirPower',
)
const AIR_BASE_PLANE = cut(
  ru,
  'const airBasePlaneHtml = ',
  '\nconst airBaseAreaHtml = ',
  'airBasePlaneHtml',
)

const HARNESS = `
type AirBaseSquad = any
type AirSlots = any
interface AirPower { basic: number; min: number; max: number }

export const mg: any = { slotitems: {}, master: { slotitems: {} } }

const ENT: any = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c: string) => ENT[c])
const entityNamePlain = (_kind: string, _id: number, name: string) => name
const elink = (_kind: string, _id: number, name: string) => name
const entityTermHtml = (_kind: string, _id: number | undefined, name: string) => name
const equipTypeIconHtml = (iconId: number, options: any = {}) =>
  \`<span class="equip-icon \${options.className ?? ''}" data-icon="\${iconId}"></span>\`
const equipPeekIconHtml = (_mstId: number, iconId: number, _name: string, options: any = {}) =>
  equipTypeIconHtml(iconId, options)

${AIR_POWER_TABLES}
${FLEET_AIR_POWER}
${AIR_BASE_PLANE}

export { airBasePlaneHtml }
`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ru-air-base-'))
const entry = path.join(dir, 'air-base.ts')
fs.writeFileSync(entry, HARNESS)
const outfile = path.join(dir, 'air-base.cjs')
buildSync({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const loaded = createRequire(import.meta.url)(outfile)

export const reset = (masters) => {
  loaded.mg.slotitems = {}
  loaded.mg.master.slotitems = {}
  masters.forEach((master, index) => {
    const slotId = index + 1
    loaded.mg.slotitems[slotId] = {
      id: slotId,
      mstId: master.id,
      level: master.level ?? 0,
      alv: master.alv ?? 0,
    }
    loaded.mg.master.slotitems[master.id] = master
  })
}

export const renderPlane = (plane) => loaded.airBasePlaneHtml(plane)
export const airPower = (counts, landbase = 1) =>
  loaded.fleetAirPower(
    [{ slot: counts.map((_count, index) => index + 1), onslot: counts }],
    landbase,
  )
