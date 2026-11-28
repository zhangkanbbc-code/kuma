// 把锐的持续战损记录（`damageStates` + `shipHitFracture`）**原样切出来**真编译一遍。
//
// 这一段决定「哪一行拿到随机裂纹变量」，而它在 shipRow 之外——编成行夹具里只能给它打桩，
// 桩一写就把「实验开关关着时击沉行也不许变」这一半抹掉了。所以单独切真的那一份，
// 只给它依赖的几个名字（开关、入渠、击沉）打可设的桩；头像裁角变量与空战损记录引真的 shared/hit-glass、shared/hit-damage。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ru = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ru.ts'), 'utf8').replace(/\r\n/g, '\n')

const start = ru.indexOf('const damageStates = new Map')
const end = ru.indexOf('\nconst fleetDivisionHtml', start)
assert.ok(start >= 0 && end > start, '找不到 ru.ts 里的 damageStates … shipHitFracture 一段，这条守卫的锚点要跟着改')
const FRACTURE = ru.slice(start, end)

const HIT_GLASS = path.join(ROOT, 'src', 'shared', 'hit-glass.ts').replace(/\\/g, '/')
const HIT_DAMAGE = path.join(ROOT, 'src', 'shared', 'hit-damage.ts').replace(/\\/g, '/')

const HARNESS = `
import { hitAvatarCssVars } from '${HIT_GLASS}'
import { emptyDamageState, syntheticDamageState } from '${HIT_DAMAGE}'

type PlayerShip = any

export const state = { enabled: false, docked: new Set<number>(), sunk: new Set<number>(), sortie: new Set<number>() }
const hitShakeEnabled = () => state.enabled
const dockOf = (id: number) => (state.docked.has(id) ? { completeTime: 0 } : undefined)
const isSunkInSortie = (id: number) => state.sunk.has(id)
const shipInSortie = (id: number) => state.sortie.has(id)
const isSubShip = (_ship: PlayerShip) => false
${FRACTURE}

export { shipHitFracture, damageStates, syntheticPending }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-hit-fracture-'))
  const entry = path.join(dir, 'fracture.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'fracture.cjs')
  buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return outfile
})()

const loaded = createRequire(import.meta.url)(bundle)

/** 摆一局：实验开关、入渠中的舰、本次出击击沉的舰。顺手清空种子记忆。 */
export const setFracture = ({ enabled = false, docked = [], sunk = [] } = {}) => {
  loaded.state.enabled = enabled
  loaded.state.docked = new Set(docked)
  loaded.state.sunk = new Set(sunk)
  loaded.damageStates.clear()
  loaded.syntheticPending.clear()
}

/** 只改开关/入渠/击沉，不清种子记忆（验「带伤期间不跳位」用）。 */
export const updateFracture = ({ enabled, docked, sunk } = {}) => {
  if (enabled !== undefined) loaded.state.enabled = enabled
  if (docked !== undefined) loaded.state.docked = new Set(docked)
  if (sunk !== undefined) loaded.state.sunk = new Set(sunk)
}

export const fractureOf = (ship) => loaded.shipHitFracture({ maxhp: 40, ...ship })
