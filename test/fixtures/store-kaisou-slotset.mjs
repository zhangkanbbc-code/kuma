// 换装三条（slotset / slotset_ex / unsetslot_all）：把 store 的归约**原样切出来**
// 真编译一遍，好让护栏喂真报文、对着 state 下断言。
//
// ⚠️ **不许直接 import store.ts**：它一 import 就会打开用户的真账本并跑迁移。
// 所以走切片编译这条路，与 fixtures/store-hangar-expand 同一手法：判据一个字不改，
// 断言的是**真代码**的行为，不是源码正则——「0-based 的格位有没有多减一」
// 「卸下落 -1 还是落 0」这种事，正则写反了照样绿。
//
// 顺带把锐里数修理施設那一行（berthFacilityCount）也切进来：本单要闭的环是
// 「换装之后，读装备的功能拿到的是新数据」，那就得让**真的取数函数**吃真的 state。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// 跨行锚点按 \n 写，所以读进来先归一，免得行尾一变锚点凭空找不到
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const storeSource = read('src', 'main', 'mg', 'store.ts')
const ruSource = read('src', 'renderer', 'modules', 'ru.ts')

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf(to, start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return source.slice(start, end)
}

/** 切一个 reducer 出来，改写成具名导出函数，**主体一个字不动**。 */
const asReducer = (name, head, label) => {
  const start = storeSource.indexOf(head)
  assert.ok(start >= 0, `store.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = storeSource.indexOf('\n  },\n', start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  // end 指向终止符（换行 + 两空格 + 右花括号 + 逗号）的开头；取 4 个字符正好拿到
  // 「换行 + 两空格 + 右花括号」，**不要**把那个逗号一起带上。
  return `export const ${name} = ${storeSource.slice(start + head.indexOf('('), end + 4)}`
}

const SLOTSET = asReducer(
  'slotset',
  "'/kcsapi/api_req_kaisou/slotset': (_body, post) => {",
  '换装 slotset reducer',
)
const SLOTSET_EX = asReducer(
  'slotsetEx',
  "'/kcsapi/api_req_kaisou/slotset_ex': (_body, post) => {",
  '补强増設换装 slotset_ex reducer',
)
const UNSETSLOT_ALL = asReducer(
  'unsetslotAll',
  "'/kcsapi/api_req_kaisou/unsetslot_all': (_body, post) => {",
  '一括解除 unsetslot_all reducer',
)

// 锐里数「旗舰身上有几个艦艇修理施設」的那一行。切真代码进来，是因为本单要证的
// 正是它的**输入**在换装之后是对的；自己照抄一遍等于两边一起错也发现不了。
const BERTH_FACILITY_COUNT = sliceBetween(
  ruSource,
  'const berthFacilityCount = (flag: PlayerShip): number =>',
  '\n/** 页上那一格 HP 条',
  '锐 · 修理施設计数 berthFacilityCount',
)

const HARNESS = `
type PlayerShip = any
type Section = string

export const state: any = {
  player: { ships: {}, slotitems: {}, decks: [], useitems: {} },
  master: { ships: {} },
}

// 锐读的是渲染进程那份镜像；本护栏让它与主进程 state 指同一张表，
// 「换装之后读装备的功能看到什么」才问得出来。
export const mg: any = { slotitems: state.player.slotitems }

import { REPAIR_FACILITY_MST_ID } from '${path
  .join(ROOT, 'src', 'shared', 'berth-repair.ts')
  .replace(/\\/g, '/')}'

${SLOTSET}

${SLOTSET_EX}

${UNSETSLOT_ALL}

${BERTH_FACILITY_COUNT}

export { berthFacilityCount, REPAIR_FACILITY_MST_ID }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-slotset-'))
  const entry = path.join(dir, 'slotset.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'slotset.cjs')
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

/** 真报文里常规格恒为 5 项、空位是 -1（母港快照 423/423 艘都如此）。 */
const EMPTY_SLOTS = () => [-1, -1, -1, -1, -1]

/**
 * 从零摆一局。
 *
 * @param ships     `{ [rosterId]: { slot?, slotEx? } }`，slot 缺省 = 五格全空，
 *                  slotEx 缺省 0（= 补强増設没开过）
 * @param slotitems `{ [instanceId]: mstId }`，装备实例库存
 */
export const reset = (ships = {}, slotitems = {}) => {
  for (const key of Object.keys(loaded.state.player.ships)) delete loaded.state.player.ships[key]
  // slotitems 这张表是与 mg 共用的同一个对象，只能就地清，不能整替
  for (const key of Object.keys(loaded.state.player.slotitems)) {
    delete loaded.state.player.slotitems[key]
  }
  for (const [id, one] of Object.entries(ships)) {
    const rosterId = +id
    loaded.state.player.ships[rosterId] = {
      id: rosterId,
      slot: one.slot ? [...one.slot] : EMPTY_SLOTS(),
      slotEx: one.slotEx ?? 0,
    }
  }
  for (const [id, mstId] of Object.entries(slotitems)) {
    loaded.state.player.slotitems[+id] = { mstId }
  }
}

/** 响应体：这三条真样一律只有 api_result，一个字的舰船数据都没有。 */
export const OK_BODY = { api_result: 1, api_result_msg: '成功' }

export const feedSlotset = (post, body = OK_BODY) => loaded.slotset(body, post, 1_700_000_000_000)
export const feedSlotsetEx = (post, body = OK_BODY) =>
  loaded.slotsetEx(body, post, 1_700_000_000_000)
export const feedUnsetslotAll = (post, body = OK_BODY) =>
  loaded.unsetslotAll(body, post, 1_700_000_000_000)

export const shipAt = (rosterId) => loaded.state.player.ships[rosterId]
export const ships = () => loaded.state.player.ships
export const slotitems = () => loaded.state.player.slotitems
export const berthFacilityCount = (flag) => loaded.berthFacilityCount(flag)
export const REPAIR_FACILITY_MST_ID = loaded.REPAIR_FACILITY_MST_ID

/**
 * 账本 events 的真样本（api_token 已脱敏）。
 *
 * 三条的 POST 参数逐个对过实样：`api_id` 是**在籍 id**，`api_slot_idx` 是常规格
 * 下标且 **0-based**（实样取值 0..4），`api_item_id` 是装备**实例 id**、
 * **-1 = 卸下**。unsetslot_all 只有 `api_id`，没有第四个参数。
 */
export const REAL = {
  /** events 27872：把实例 13482 装到在籍 443 的第 5 格（idx 4）。 */
  slotset: {
    api_token: '<REDACTED>',
    api_verno: '1',
    api_id: '443',
    api_item_id: '13482',
    api_slot_idx: '4',
  },
  /** events 2558：把在籍 877 的第 4 格（idx 3）卸空。 */
  slotsetUnset: {
    api_token: '<REDACTED>',
    api_verno: '1',
    api_id: '877',
    api_item_id: '-1',
    api_slot_idx: '3',
  },
  /** events 27698：把实例 17190 装进在籍 7209 的补强増設格。 */
  slotsetEx: {
    api_token: '<REDACTED>',
    api_verno: '1',
    api_id: '7209',
    api_item_id: '17190',
  },
  /** events 2966：把在籍 1339 的补强増設格卸空。 */
  slotsetExUnset: {
    api_token: '<REDACTED>',
    api_verno: '1',
    api_id: '1339',
    api_item_id: '-1',
  },
  /** events 27174：把在籍 3212 的常规格一括解除。 */
  unsetslotAll: {
    api_token: '<REDACTED>',
    api_verno: '1',
    api_id: '3212',
  },
}
