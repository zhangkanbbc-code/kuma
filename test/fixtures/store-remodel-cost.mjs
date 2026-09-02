// 改造的道具自扣：把 store 的归约**原样切出来**真编译一遍，好让护栏喂真报文、
// 对着 state 与道具账下断言。
//
// ⚠️ **不许直接 import store.ts**：一 import 就会打开用户的真账本并跑迁移。所以走
// 切片编译这条路，与 fixtures/store-hangar-expand 同一手法：判据一个字不改，断言的是
// **真代码**的行为——「改造表按哪一头认行」这种事，正则匹配源码分不出认对了还是认反了。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const storeSource = read('src', 'main', 'mg', 'store.ts')

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf(to, start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return source.slice(start, end)
}

// 主数据里建改造表的那一段，就在 api_start2/getData 的归约体内。整段切出来包一层
// 函数：护栏喂的是 api_mst_shipupgrade 的**真行**，字段名与形状都由真代码去认。
const UPGRADES_BLOCK = sliceBetween(
  storeSource,
  "const upgrades: MgState['master']['upgrades'] = {}",
  '    const bgms: Record<number, string> = {}',
  '改造表建索引',
)
const REMODEL_COSTS = sliceBetween(
  storeSource,
  'const REMODEL_USEITEM_COSTS: [keyof MasterShipUpgrade, number][] = [',
  '\n// api_mst_ship 的成长属性是',
  '改造与改修的道具消耗查表',
)
const APPLY_USEITEMS = sliceBetween(
  storeSource,
  'const applyUseitems = (list: any[], ts: number) => {',
  '\nconst incrementUseitem =',
  '道具全量作差 applyUseitems',
)
const INCREMENT_USEITEM = sliceBetween(
  storeSource,
  'const incrementUseitem = (id: number, delta: number, ts: number): boolean => {',
  '\nconst patchMaterialValues =',
  '道具增减 incrementUseitem',
)

/** 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。 */
const asReducer = (name, head, label) => {
  const start = storeSource.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = storeSource.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return `export const ${name} = ${storeSource.slice(start + head.indexOf('('), end + 4)}`
}

const REMODELING = asReducer(
  'remodeling',
  "'/kcsapi/api_req_kaisou/remodeling': (_body, post, ts) => {",
  '改造 reducer',
)
const REMODEL_SLOT = asReducer(
  'remodelSlot',
  "'/kcsapi/api_req_kousyou/remodel_slot': (body, post, ts) => {",
  '改修 reducer',
)
const OPEN_EXSLOT = asReducer(
  'openExslot',
  "'/kcsapi/api_req_kaisou/open_exslot': (_body, post, ts) => {",
  '补强增设开孔 reducer',
)
const HANGAR_EXPAND = asReducer(
  'hangarExpand',
  "'/kcsapi/api_req_kaisou/hangar_expand': (body, post, ts) => {",
  '格纳库增设 reducer',
)

const HARNESS = `
type Section = string
type MgState = any
type MasterShipUpgrade = any
type SlotitemInstance = any

export const state: any = {
  player: { ships: {}, useitems: {}, slotitems: {}, materials: null },
  master: { ships: {}, upgrades: {} },
}
let improveEntries: any[] = []
const getLode = (id: string) => id === 'equip-improve' ? { data: improveEntries } : null

// 落账本是真代码里的副作用，这里只记一笔好让护栏看得见它被调过。
export const useitemLog: any[] = []
const ledger = {
  logUseitems: (ts: number, changes: any[]) => { useitemLog.push({ ts, changes }) },
}

export const buildUpgrades = (body: any) => {
${UPGRADES_BLOCK}
  return upgrades
}

const toMaterials = (body: any) => [...body]
const applySlotitemInventoryMutation = (
  inventory: Record<number, any>,
  _path: string,
  body: any,
) => {
  const after = body?.api_after_slot
  if (!after?.api_id) return false
  inventory[Number(after.api_id)] = {
    id: Number(after.api_id),
    mstId: Number(after.api_slotitem_id),
    level: Number(after.api_level) || 0,
  }
  return true
}

${REMODEL_COSTS}

${APPLY_USEITEMS}

${INCREMENT_USEITEM}

${REMODELING}

${REMODEL_SLOT}

${OPEN_EXSLOT}

${HANGAR_EXPAND}

export const setImproveEntries = (entries: any[]) => { improveEntries = entries }
export { applyUseitems, upgradeRowFrom, REMODEL_USEITEM_COSTS, remodelSlotUseitemCosts }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-remodel-'))
  const entry = path.join(dir, 'remodel.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'remodel.cjs')
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
 * @param ships    在籍舰现状：`{ [rosterId]: mstId }`（改造前的形态）
 * @param options  道具、装备与改修改造事实
 */
export const reset = (ships = {}, options = {}) => {
  loaded.state.player.ships = {}
  for (const [id, mstId] of Object.entries(ships)) {
    loaded.state.player.ships[+id] =
      typeof mstId === 'object'
        ? { id: +id, shipId: mstId.mstId, slotEx: mstId.slotEx ?? 0 }
        : { id: +id, shipId: mstId }
  }
  // 拷一份：归约会当场改这张表，直接挂调用方的对象会把护栏之间的局面串起来
  loaded.state.player.useitems = { ...(options.useitems ?? {}) }
  loaded.state.player.slotitems = Object.fromEntries(
    Object.entries(options.slotitems ?? {}).map(([id, item]) => [
      +id,
      { id: +id, mstId: item.mstId, level: item.level ?? 0 },
    ]),
  )
  loaded.state.player.materials = options.materials ? [...options.materials] : null
  loaded.state.master.upgrades = loaded.buildUpgrades({
    api_mst_shipupgrade: options.upgradeRows ?? [],
  })
  loaded.setImproveEntries(options.improveEntries ?? [])
  loaded.useitemLog.length = 0
}

/** 喂一条改造报文，走真归约。 */
export const feedRemodeling = (post, body = REAL_BODY, ts = REMODEL_TS) =>
  loaded.remodeling(body, post, ts)
export const feedRemodelSlot = (post, body, ts = REMODEL_TS) =>
  loaded.remodelSlot(body, post, ts)
export const feedOpenExslot = (post, ts = REMODEL_TS) =>
  loaded.openExslot({}, post, ts)
export const feedHangarExpand = (post, body, ts = REMODEL_TS) =>
  loaded.hangarExpand(body, post, ts)

/** 喂一份道具全量下发（api_get_member/useitem 的 api_data 形状）。 */
export const feedUseitemSync = (counts, ts = REMODEL_TS + 300_000) =>
  loaded.applyUseitems(
    Object.entries(counts).map(([id, count]) => ({ api_id: +id, api_count: count })),
    ts,
  )

export const useitems = () => loaded.state.player.useitems
export const useitemLog = () => loaded.useitemLog
export const slotitems = () => loaded.state.player.slotitems
export const materials = () => loaded.state.player.materials
export const upgrades = () => loaded.state.master.upgrades
export const upgradeRowFrom = (mstId) => loaded.upgradeRowFrom(mstId)
export const costTable = () => loaded.REMODEL_USEITEM_COSTS

/** 2026-09-02 15:42:43：12cm30連装噴進砲改二 ★max → 改三。 */
export const REAL_REMODEL_SLOT_POST = {
  api_token: '<REDACTED>',
  api_verno: '1',
  api_id: '170',
  api_slot_id: '4346',
  api_certain_flag: '1',
}
export const REAL_REMODEL_SLOT_BODY = {
  api_remodel_flag: 1,
  api_remodel_id: [266, 267],
  api_after_material: [7869, 10346, 91671, 5915, 508, 52, 108, 86],
  api_voice_ship_id: 498,
  api_voice_id: 10,
  api_after_slot: {
    api_id: 4346,
    api_slotitem_id: 267,
    api_locked: 0,
    api_level: 0,
  },
  api_use_slot_id: [16194, 16897],
}
export const IMPROVE_266 = {
  eq_id: 266,
  improvement: [
    {
      convert: { id_after: 267, lvl_after: 0 },
      helpers: [{ ship_ids: [490, 498], days: [3, 4, 5, 6] }],
      costs: {
        p1: { consumable: [] },
        p2: { consumable: [] },
        conv: {
          consumable: [
            { id: 75, eq_count: 1 },
            { id: 78, eq_count: 1 },
          ],
        },
      },
    },
    {
      convert: { id_after: 470, lvl_after: 0 },
      helpers: [{ ship_ids: [961], days: [3, 4, 5, 6] }],
      costs: {
        p1: { consumable: [] },
        p2: { consumable: [] },
        conv: {
          consumable: [
            { id: 75, eq_count: 1 },
            { id: 94, eq_count: 1 },
          ],
        },
      },
    },
  ],
}

/**
 * 账本 events 的真样本（api_token 已脱敏）：2026-08-28 23:39:27 的那次改造，
 * 在籍 3447 = Richelieu改（mst 392）→ Richelieu Deux（mst 969）。
 * 响应体只有 api_result / api_result_msg，一个字的舰船与道具数据都没有。
 */
export const REAL_POST = { api_token: '<REDACTED>', api_verno: '1', api_id: '3447' }
export const REAL_BODY = { api_result: 1, api_result_msg: '成功' }
export const REMODEL_TS = 1787931567000 // 2026-08-28 23:39:27

/** 主数据 api_mst_shipupgrade 的真行（2026-08-31 快照逐字）。 */
export const ROW_RICHELIEU_DEUX = {
  api_id: 969,
  api_current_ship_id: 392,
  api_original_ship_id: 492,
  api_upgrade_type: 1,
  api_upgrade_level: 2,
  api_drawing_count: 1,
  api_catapult_count: 0,
  api_report_count: 0,
  api_aviation_mat_count: 0,
  api_arms_mat_count: 0,
  api_tech_count: 2,
  api_sortno: 569,
}
/** 大和改二：唯一带 api_boiler_count 的一行（缶是装备，不是道具）。 */
export const ROW_YAMATO_K2 = {
  api_id: 911,
  api_current_ship_id: 136,
  api_original_ship_id: 131,
  api_upgrade_type: 1,
  api_upgrade_level: 2,
  api_drawing_count: 3,
  api_catapult_count: 0,
  api_report_count: 1,
  api_aviation_mat_count: 0,
  api_arms_mat_count: 0,
  api_tech_count: 0,
  api_boiler_count: 2,
  api_sortno: 511,
}
/** 同一目标两行：赤城改→赤城改二要素材，赤城改二戊→赤城改二是回边，全零。 */
export const ROW_AKAGI_K2_FROM_KAI = {
  api_id: 594,
  api_current_ship_id: 277,
  api_original_ship_id: 83,
  api_upgrade_type: 1,
  api_upgrade_level: 2,
  api_drawing_count: 2,
  api_catapult_count: 1,
  api_report_count: 1,
  api_aviation_mat_count: 2,
  api_arms_mat_count: 0,
  api_tech_count: 0,
  api_sortno: 404,
}
export const ROW_AKAGI_K2_FROM_BOTAI = {
  api_id: 594,
  api_current_ship_id: 599,
  api_original_ship_id: 83,
  api_upgrade_type: 1,
  api_upgrade_level: 4,
  api_drawing_count: 0,
  api_catapult_count: 0,
  api_report_count: 0,
  api_aviation_mat_count: 0,
  api_arms_mat_count: 0,
  api_tech_count: 0,
  api_sortno: 404,
}
