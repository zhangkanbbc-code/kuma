// 格納庫増設：把 store 的归约与 ship-life 的落账**原样切出来**真编译一遍，
// 好让护栏喂真报文、对着 state 与舰历下断言。
//
// ⚠️ **不许直接 import store.ts / ship-life.ts**：那两个文件一 import 就会打开
// 用户的真账本并跑迁移。所以走切片编译这条路，与 fixtures/store-anchorage-reducer
// 同一手法：判据一个字不改，断言的是**真代码**的行为，不是源码正则——
// 「1-based 的格位有没有减一」这种事，正则写反了照样绿。
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
const lifeSource = read('src', 'main', 'mg', 'ship-life.ts')

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `找不到「${label}」，这条守卫的锚点要跟着改`)
  const end = source.indexOf(to, start)
  assert.ok(end > start, `「${label}」没有可识别的结尾`)
  return source.slice(start, end)
}

const TO_SHIP = sliceBetween(
  storeSource,
  'const toShip = (raw: any): PlayerShip => ({',
  '\nconst toDeck =',
  '在籍舰归一化 toShip',
)
const INCREMENT_USEITEM = sliceBetween(
  storeSource,
  'const incrementUseitem = (id: number, delta: number, ts: number): boolean => {',
  '\nconst patchMaterialValues =',
  '道具增减 incrementUseitem',
)
const RECORD_HANGAR_EXPAND = sliceBetween(
  lifeSource,
  'const recordHangarExpand = (',
  '\nconst recordDepartures =',
  '舰历落账 recordHangarExpand',
)

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

const HANGAR_EXPAND = asReducer(
  'hangarExpand',
  "'/kcsapi/api_req_kaisou/hangar_expand': (body, post, ts) => {",
  '格納庫増設 reducer',
)

// 战斗解析器取我方编成的那座桥。搭载容量就在这里算——扩过的格读实例一手上限，
// 没扩过的回落主数据 maxEq。切真代码进来，是因为这条判据写反了不会报错：
// 两个下标一样、只是取值来源换了，正则匹配源码分不出「读对了」和「读串了」。
const FLEET_SHIPS = asReducer('fleetShips', 'fleetShips: (deckId) => {', '编成桥 fleetShips')

const HARNESS = `
type PlayerShip = any
type Section = string
type FleetEquipmentContext = any

export const state: any = {
  player: { ships: {}, useitems: {}, decks: [], slotitems: {} },
  master: { ships: {} },
}

// 落账本是真代码里的副作用，这里只记一笔好让护栏看得见它被调过。
export const useitemLog: any[] = []
export const lifeLog: any[] = []
const ledger = {
  logUseitems: (ts: number, changes: any[]) => { useitemLog.push({ ts, changes }) },
  logShipLifeEvents: (events: any[]) => { for (const one of events) lifeLog.push(one) },
}

// ship-life 里的两个外部依赖：自己的差分基线、以及读 store 现状。
export const baselines = new Map<number, any>()
const store = { getState: () => state }

${TO_SHIP}

${INCREMENT_USEITEM}

${HANGAR_EXPAND}

${FLEET_SHIPS}

${RECORD_HANGAR_EXPAND}

export { toShip, recordHangarExpand }
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-hangar-'))
  const entry = path.join(dir, 'hangar.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'hangar.cjs')
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
 * @param ships   在籍舰现状：`{ [rosterId]: { mstId, onslot, onslotMax?, maxEq? } }`
 *                `onslotMax` 缺省 = 这艘舰没被扩过（真报文里那个键根本不存在）
 * @param options `useitems` 道具持有
 */
export const reset = (ships = {}, options = {}) => {
  loaded.state.player.ships = {}
  loaded.state.master.ships = {}
  loaded.state.player.decks = []
  loaded.state.player.slotitems = {}
  loaded.baselines.clear()
  for (const [id, one] of Object.entries(ships)) {
    const rosterId = +id
    loaded.state.player.ships[rosterId] = {
      id: rosterId,
      shipId: one.mstId,
      onslot: one.onslot ?? [],
      ...(one.onslotMax ? { onslotMax: one.onslotMax } : {}),
    }
    loaded.state.master.ships[one.mstId] = {
      name: one.name ?? `舰${one.mstId}`,
      maxEq: one.maxEq ?? [],
    }
    loaded.baselines.set(rosterId, { rosterId, mstId: one.mstId })
  }
  loaded.state.player.useitems = options.useitems ?? { 105: 3 }
  loaded.useitemLog.length = 0
  loaded.lifeLog.length = 0
}

/** 归约之前那一刻的各格上限——index.ts 里 hangarCapsBefore 那一段的口径。 */
export const capsBefore = (rosterId) => {
  const ship = loaded.state.player.ships[rosterId]
  if (!ship) return null
  return ship.onslotMax ?? loaded.state.master.ships[ship.shipId]?.maxEq ?? null
}

/**
 * 喂一条格納庫増設报文，走**与真链路同序**的两步：先取归约前的上限，
 * 再归约，最后落舰历。顺序反了「原来是几」就说不出来了——这正是要钉的事。
 */
export const feedHangarExpand = (post, body, ts = 1_700_000_000_000) => {
  const before = capsBefore(Number(post.api_ship_id))
  const sections = loaded.hangarExpand(body, post, ts)
  loaded.recordHangarExpand(post, body, before, ts)
  return sections
}

/** 只跑归约，不落舰历（单看道具账时用）。 */
export const feedReducerOnly = (post, body, ts = 1_700_000_000_000) =>
  loaded.hangarExpand(body, post, ts)

/**
 * 把这些在籍舰摆进第一舰队、每格插一件占位装备，然后走**真的** fleetShips 桥，
 * 取回它给每一格算出来的搭载容量与搭载数。
 *
 * 装备是什么不影响容量（容量只由「哪艘舰 + 哪一格」决定），所以给最平淡的桩。
 * 返回 `{ rosterId, capacities, counts }`，只含常规格（补强格不谈搭载）。
 */
export const fleetCapacities = (rosterIds) => {
  loaded.state.player.slotitems = {}
  let nextInst = 1
  for (const rosterId of rosterIds) {
    const ship = loaded.state.player.ships[rosterId]
    if (!ship) continue
    const maxEq = loaded.state.master.ships[ship.shipId]?.maxEq ?? []
    const width = Math.max(ship.onslot?.length ?? 0, maxEq.length, ship.onslotMax?.length ?? 0)
    ship.nowhp = 10
    ship.maxhp = 10
    ship.slot = []
    for (let i = 0; i < width; i += 1) {
      const instId = nextInst
      nextInst += 1
      loaded.state.player.slotitems[instId] = { mstId: 900 + i, level: 0, alv: 0 }
      ship.slot.push(instId)
    }
  }
  loaded.state.player.decks = [{ id: 1, ships: rosterIds }]
  return loaded.fleetShips(1).map((one) => {
    const regular = one.equipments.filter((eq) => eq.slot !== 'ex')
    return {
      rosterId: one.rosterId,
      capacities: regular.map((eq) => eq.planeCapacity),
      counts: regular.map((eq) => eq.planeCount),
    }
  })
}

export const ships = () => loaded.state.player.ships
export const useitems = () => loaded.state.player.useitems
export const useitemLog = () => loaded.useitemLog
export const lifeLog = () => loaded.lifeLog
export const toShip = (raw) => loaded.toShip(raw)

/**
 * 账本 events 22606 的真样本（token 已脱敏）。
 *
 * post 的 `api_ship_id` 是**在籍 id**（不是图鉴 mstId），`api_slot_pos` 是 **1-based**；
 * 响应体 `api_data` 只有一项 `api_onslot_max`，是**整舰各格的新上限数组**，不是增量。
 */
export const REAL_POST = {
  api_token: '<REDACTED>',
  api_verno: '1',
  api_ship_id: '939',
  api_slot_pos: '4',
}
export const REAL_BODY = { api_onslot_max: [18, 15, 15, 3, 0] }
