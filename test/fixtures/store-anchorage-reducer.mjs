// 把緊急泊地修理那个 reducer **原样切出来**真编译一遍，好让护栏喂真形状的报文、
// 对着 state 下断言（资源扣了多少、道具扣没扣、出击上落没落）。
//
// ⚠️ **不许直接 import store.ts**：那个文件一 import 就会打开用户的真账本并跑迁移。
// 所以走切片编译这条路，与 fixtures/practice-session-reducers.mjs 同一手法：
// 判据一个字不改，断言的是**真代码**的行为，不是源码正则——
// 「回复量算不出时该不该扣钢材」这种事，正则写反了照样绿。
//
// 一并切进来的还有它真正调用到的那几个纯函数（toShip / applyShipUpdates /
// subtractMaterials / incrementUseitem / newSortie），只有落账本那一步是桩。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// 跨行锚点按 \n 写，所以读进来先归一，免得行尾一变锚点凭空找不到
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'main', 'mg', 'store.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const TO_SHIP = sliceBetween(
  'const toShip = (raw: any): PlayerShip => ({',
  '\nconst toDeck =',
  '在籍舰归一化 toShip',
)
const SUBTRACT_MATERIALS = sliceBetween(
  'const subtractMaterials = (costs: [number, number][]): boolean => {',
  '\n// api_material 形如',
  '资源扣减 subtractMaterials',
)
const APPLY_SHIP_UPDATES = sliceBetween(
  'const applyShipUpdates = (rawShips: any) => {',
  '\nconst removeRosterShips =',
  '在籍舰覆盖 applyShipUpdates',
)
const INCREMENT_USEITEM = sliceBetween(
  'const incrementUseitem = (id: number, delta: number, ts: number): boolean => {',
  '\nconst patchMaterialValues =',
  '道具增减 incrementUseitem',
)

/** `newSortie` 的默认值表——`anchorageRepairs: []` 就住在这里，切它是为了不把默认值抄第二遍。 */
const NEW_SORTIE = (() => {
  const head = 'const newSortie = (partial: Partial<SortieView>): SortieView => ({'
  const start = source.indexOf(head)
  assert.ok(start >= 0, 'store.ts 里找不到 newSortie，这条守卫的锚点要跟着改')
  const end = source.indexOf('\n})', start)
  assert.ok(end > start, 'newSortie 没有可识别的结尾')
  return source.slice(start, end + 3)
})()

/** 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。 */
const asReducer = (name, head, label) => {
  const start = source.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  // end 指向终止符（换行 + 两空格 + 右花括号 + 逗号）的开头；取 4 个字符正好拿到
  // 「换行 + 两空格 + 右花括号」，**不要**把那个逗号一起带上。
  return `export const ${name} = ${source.slice(start + head.indexOf('('), end + 4)}`
}

const ANCHORAGE = asReducer(
  'anchorageRepair',
  "'/kcsapi/api_req_map/anchorage_repair': (body, _post, ts) => {",
  '泊地修理 reducer',
)

const HARNESS = `
type PlayerShip = any
type SortieView = any
type SortieAnchorageRepair = any
type Section = string

export const state: any = {
  player: { ships: {}, materials: null, useitems: {} },
  master: { ships: {} },
  sortie: null,
}

// 落账本是真代码里的副作用，这里只记一笔好让护栏看得见它被调过。
export const useitemLog: any[] = []
const ledger = { logUseitems: (ts: number, changes: any[]) => { useitemLog.push({ ts, changes }) } }

${TO_SHIP}

${SUBTRACT_MATERIALS}

${APPLY_SHIP_UPDATES}

${INCREMENT_USEITEM}

${NEW_SORTIE}

${ANCHORAGE}

export { newSortie }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-anchorage-'))
  const entry = path.join(dir, 'anchorage.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'anchorage.cjs')
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
 * 从零摆一局。
 *
 * @param ships    在籍舰现状：`{ [rosterId]: { mstId, nowhp, maxhp } }`
 * @param options  `materials` 八项资源；`useitems` 道具持有；`sortie` 出击切片补丁（null = 没在出击）
 */
export const reset = (ships = {}, options = {}) => {
  loaded.state.player.ships = {}
  loaded.state.master.ships = {}
  for (const [id, one] of Object.entries(ships)) {
    loaded.state.player.ships[+id] = {
      id: +id,
      shipId: one.mstId,
      nowhp: one.nowhp,
      maxhp: one.maxhp ?? one.nowhp,
    }
    loaded.state.master.ships[one.mstId] = { name: one.name ?? `舰${one.mstId}` }
  }
  // `?? 默认值` 在这里是错的：`materials: null`（资源基线还没到）是一种要测的状态，
  // 不是「没传」。用 in 判断，才让调用方能显式摆出 null。
  loaded.state.player.materials =
    'materials' in options ? options.materials : [1000, 1000, 1000, 1000, 0, 0, 0, 0]
  loaded.state.player.useitems = options.useitems ?? { 91: 5 }
  loaded.state.sortie =
    options.sortie === null ? null : loaded.newSortie({ currentCell: 12, ...(options.sortie ?? {}) })
  loaded.useitemLog.length = 0
}

/** 喂一条泊地修理报文，返回 reducer 报出的 section 列表。 */
export const feedAnchorageRepair = (body, ts = 1_700_000_000_000) =>
  loaded.anchorageRepair(body, {}, ts)

export const state = () => loaded.state
export const materials = () => loaded.state.player.materials
export const useitems = () => loaded.state.player.useitems
export const sortie = () => loaded.state.sortie
export const useitemLog = () => loaded.useitemLog
export const newSortie = loaded.newSortie

/**
 * 一条最小可用的泊地修理报文。
 *
 * 形状照 poi 仓里那份真报文
 * （views/redux/info/__tests__/__fixtures__/api_req_map_anchorage_repair_repairs_multiple_ships.json）：
 * `api_used_ship` 是修理舰的 **mst id**，`api_repair_ships` 是被修舰的**在籍 id**，
 * `api_ship_data` 是修完之后的整支舰队。**报文里没有 api_material、也没有 useitem。**
 */
export const repairBody = ({ usedShip = 450, repairShips = [], shipData = [] } = {}) => ({
  api_used_ship: usedShip,
  api_repair_ships: repairShips,
  api_ship_data: shipData,
})

/** 一条 api_ship_data 里的舰（只写这条护栏关心的字段，其余留 undefined）。 */
export const shipData = (rosterId, mstId, nowhp, maxhp = nowhp) => ({
  api_id: rosterId,
  api_ship_id: mstId,
  api_nowhp: nowhp,
  api_maxhp: maxhp,
})
