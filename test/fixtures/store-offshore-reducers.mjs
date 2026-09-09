// 原样编译报文处理器与所依赖的状态函数。账本只用内存桩，不 import store 或用户账本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('../..', import.meta.url))
const source = fs.readFileSync(path.join(root, 'src/main/mg/store.ts'), 'utf8')
const ast = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true)
const declarations = new Map(ast.statements.filter(ts.isVariableStatement)
  .flatMap(statement => statement.declarationList.declarations.map(d => [d.name.getText(ast), d])))
const pick = name => {
  const declaration = declarations.get(name)
  assert.ok(declaration, name)
  return `const ${declaration.getText(ast)}`
}
const paths = ['api_req_map/next', 'api_get_member/ship_deck', 'api_get_member/ship2', 'api_get_member/ship3']
const reducers = declarations.get('reducers').initializer.properties.filter(p => paths.some(api => p.name.text === `/kcsapi/${api}`))
assert.equal(reducers.length, paths.length)
const index = fs.readFileSync(path.join(root, 'src/main/mg/index.ts'), 'utf8')
const ledgerStart = index.indexOf('  const materials = store.getState().player.materials', index.indexOf('// 资源变动记入 material_log'))
const ledgerEnd = index.indexOf('  broadcast(sections)', ledgerStart)
assert.ok(ledgerStart >= 0 && ledgerEnd > ledgerStart)
const shared = name => JSON.stringify(path.join(root, `src/shared/${name}.ts`))
const harness = `
import { OFFSHORE_SUPPLY_RATES, planOffshoreSupply, planOffshoreSupplyConsumption, offshoreSupplyNote, rationNote } from ${shared('offshore-supply')}
import { mapIdOf } from ${shared('map-id')}
import { diffConsumedInstances } from ${shared('sortie-consumables')}
import { patchMapGaugeFromSortiePayload } from ${shared('map-gauge')}
export { describeDeltaDetail } from ${shared('material-delta-text')}
type Section = string
${['state', 'toShip', 'toDeck', 'applyShipUpdates', 'applySortieShipUpdates', 'applyDeckUpdates', 'removeSlotitems',
  'MAT_NAMES', 'mapGains', 'nodeNote', 'applyMapMaterialDelta', 'applyMapUseitemGains',
  'enemyPreviewOf', 'cellFlavorOf', 'sortieNodeOf', 'cellDataOf', 'selectRouteOf',
  'newSortie', 'bossClearedOf', 'setMapGauge'].map(pick).join('\n')}
// 本夹具聚焦补给与资源；HP 对账、基地战斗和道具库存各有独立护栏。
const runSortieHpAudit = () => []
const incrementUseitem = () => false
const fleetContext = {}
const parseBaseDefenseBattle = () => { throw new Error('本用例未设置基地战斗') }
const reducers = { ${reducers.map(p => p.getText(ast)).join(',\n')} }
${source.slice(source.indexOf('export const handle ='))}
export { state, newSortie, OFFSHORE_SUPPLY_RATES, planOffshoreSupply, planOffshoreSupplyConsumption, offshoreSupplyNote, rationNote }
export const logMaterialChanges = (prevMaterials, offshoreBefore, sections, deltaResolution) => {
  const store = { getState: () => state }
  const rows = []
  const ledger = { logMaterials: () => {}, logDelta: (ts, category, values, detail) => rows.push({ category, values, detail }) }
  const ts = 1
${index.slice(ledgerStart, ledgerEnd)}
  return rows
}
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-offshore-'))
try {
  const outfile = path.join(dir, 'reducers.cjs')
  buildSync({ stdin: { contents: harness, loader: 'ts', resolveDir: root }, outfile,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  var loaded = createRequire(import.meta.url)(outfile)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
export const { state, newSortie, handle, describeDeltaDetail, OFFSHORE_SUPPLY_RATES, planOffshoreSupply,
  planOffshoreSupplyConsumption, offshoreSupplyNote, rationNote, logMaterialChanges } = loaded
