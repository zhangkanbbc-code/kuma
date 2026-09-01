// 在籍舰人生记录：只记录 API 能确认的实例级事实。
// - 首次同步建立基线，不把已有舰伪装成「新加入」；
// - 经验/装备/改造靠完整舰队快照做前后差分；
// - 出击与战绩在对应 API 结算点逐舰落账；
// - 全部写永久精矿表，原始 events 被清掉也不受影响。
import ledger from './ledger'
import * as store from './store'

import { damageTakenIn, taihaIn } from '../../shared/battle-damage'
import { bossKillAnomalyText, resolveBossKill } from '../../shared/boss-kill'
import { mapIdOf } from '../../shared/map-id'
import {
  matchShipJoinOrigins,
  SHIP_JOIN_ORIGIN_WINDOW_MS,
  type ShipBuildReceipt,
  type ShipDropSighting,
  type ShipJoinRecord,
} from '../../shared/ship-join-origin'
import type {
  PlayerShip,
  Section,
  ShipLifeEquipment,
} from '../../shared/mg-types'
import type { ShipLifeEventInput, ShipLifeStateRow } from './ledger'

const baselines = ledger.loadShipLifeState()
let primed = baselines.size > 0
const pendingRemodels = new Map<number, number>()

// 「加入镇守府」的出处登记簿：掉落与建造各一本，等 join 来认领。
//
// 为什么要等：掉落舰要到**下一次回港**才出现在舰队列表里，join 是那时才检出的；
// 建造虽然同一个包里就入籍，但归因判据同属一处，一起走 shared 的匹配器。
// 只放内存——认领窗口只有半天，而中途重启会让 primeShipLife 重建基线，
// 那些舰根本不会再产生 join 事件（老记录靠 ledger 的一次性回算补）。
let pendingDrops: ShipDropSighting[] = []
let pendingBuilds: ShipBuildReceipt[] = []

const prunePendingOrigins = (ts: number) => {
  const cutoff = ts - SHIP_JOIN_ORIGIN_WINDOW_MS
  if (pendingDrops.some((row) => row.ts < cutoff)) {
    pendingDrops = pendingDrops.filter((row) => row.ts >= cutoff)
  }
  if (pendingBuilds.some((row) => row.ts < cutoff)) {
    pendingBuilds = pendingBuilds.filter((row) => row.ts >= cutoff)
  }
}

/**
 * 战斗结算带 `api_get_ship`：登记一条待认领的掉落。
 *
 * 地点取这一战的图与点（与遭遇志 logEncounter 同一批字段，一处口径）。
 * 点位说不出（currentCell <= 0）就整条不登记——地点是这条记录存在的理由，
 * 只剩一张图号不值得写进履历，更不该拿 `#0` 冒充一个点。
 */
const registerDropSighting = (body: any, ts: number) => {
  const mstId = Number(body?.api_get_ship?.api_ship_id)
  if (!(mstId > 0)) return
  const sortie = store.getState().sortie
  if (!sortie || sortie.practice || sortie.mapArea <= 0 || !(sortie.currentCell > 0)) return
  const node = sortie.nodes.find((item) => item.cell === sortie.currentCell)
  prunePendingOrigins(ts)
  pendingDrops.push({
    ts,
    mstId,
    map: mapIdOf(sortie.mapArea, sortie.mapNo),
    cell: sortie.currentCell,
    isBoss: node?.eventId === 5,
  })
}

/**
 * 领取建造结果：登记一条待认领的建造。
 *
 * `api_ship.api_id` 是**在籍 id**，精确到这一个实例；顶层 `api_id` 是同一个数，
 * 只作兜底。同一个包里 store 已把她并进舰队，紧接着的 syncShipStates 就会认领。
 */
const registerBuildReceipt = (body: any, ts: number) => {
  const rosterId = Number(body?.api_ship?.api_id ?? body?.api_id)
  if (!(rosterId > 0)) return
  const mstId = Number(body?.api_ship?.api_ship_id ?? body?.api_ship_id)
  prunePendingOrigins(ts)
  pendingBuilds.push({ ts, rosterId, mstId: mstId > 0 ? mstId : 0 })
}

/**
 * 给这一批新检出的 join 补出处，并把认领掉的登记划走。
 *
 * 事件对象是引用，认到了就地补 map/cell/is_boss 与 detail.origin；
 * 认不到的原样落账——**确认不了就不标**，履历那一行照旧只写 Lv。
 */
const attachJoinOrigins = (joins: ShipLifeEventInput[]) => {
  if (!joins.length) return
  const records: ShipJoinRecord[] = joins.map((event) => ({
    ts: event.ts,
    rosterId: event.rosterId,
    mstId: event.mstId,
  }))
  const origins = matchShipJoinOrigins(records, { drops: pendingDrops, builds: pendingBuilds })
  const usedDrops = new Set<number>()
  const usedBuilds = new Set<number>()
  origins.forEach((origin, at) => {
    if (!origin) return
    const event = joins[at]
    if (origin.origin === 'build') {
      usedBuilds.add(origin.sourceIndex)
      event.detail = { ...(event.detail ?? {}), origin: 'build' }
      return
    }
    usedDrops.add(origin.sourceIndex)
    event.map = origin.map
    event.cell = origin.cell
    event.isBoss = origin.isBoss
    event.detail = { ...(event.detail ?? {}), origin: 'drop' }
  })
  // 认领掉的立刻划走：一条掉落只能供一艘认亲，留着会被下一艘同名舰再认一次
  if (usedDrops.size) pendingDrops = pendingDrops.filter((_row, at) => !usedDrops.has(at))
  if (usedBuilds.size) pendingBuilds = pendingBuilds.filter((_row, at) => !usedBuilds.has(at))
}

const equipmentOf = (ship: PlayerShip): ShipLifeEquipment[] => {
  const state = store.getState()
  const result: ShipLifeEquipment[] = []
  ship.slot.forEach((instanceId, slot) => {
    if (instanceId <= 0) return
    const instance = state.player.slotitems[instanceId]
    result.push({
      slot,
      instanceId,
      mstId: instance?.mstId ?? 0,
      level: instance?.level ?? 0,
      alv: instance?.alv ?? 0,
    })
  })
  if (ship.slotEx > 0) {
    const instance = state.player.slotitems[ship.slotEx]
    result.push({
      slot: 'ex',
      instanceId: ship.slotEx,
      mstId: instance?.mstId ?? 0,
      level: instance?.level ?? 0,
      alv: instance?.alv ?? 0,
    })
  }
  return result
}

const assignmentSignature = (items: ShipLifeEquipment[]) =>
  items.map((item) => `${item.slot}:${item.instanceId}`).join('|')

const equipmentChanged = (
  before: ShipLifeEquipment[],
  after: ShipLifeEquipment[],
): boolean => {
  if (assignmentSignature(before) !== assignmentSignature(after)) return true
  const prior = new Map(before.map((item) => [`${item.slot}:${item.instanceId}`, item]))
  return after.some((item) => {
    const old = prior.get(`${item.slot}:${item.instanceId}`)
    // 首次拿到 slotitem 元数据（mstId 0 → 实值）只是补全基线，不算玩家换装。
    if (!old || old.mstId <= 0 || item.mstId <= 0) return false
    // 改修等级与舰载机熟练度会在同一装备实例上变化；那是装备成长/战损，
    // 不是玩家把装备换上或换下，不能污染永久“换装”次数。
    return old.mstId !== item.mstId
  })
}

const stateOf = (ship: PlayerShip, ts: number, firstSeen = ts): ShipLifeStateRow => ({
  rosterId: ship.id,
  mstId: ship.shipId,
  level: ship.lv,
  expTotal: ship.expTotal,
  equipment: equipmentOf(ship),
  firstSeen,
  lastSeen: ts,
})

// 逐舰轻量签名：把差分关心的全部字段（形态/等级/经验/各槽实例与其改修熟练）
// 拼成一个字符串。绝大多数包只动个位数舰只，但差分曾对**全部在籍舰**（数百艘）
// 重建 equipment 对象数组再 JSON.stringify 比较——签名没变的舰整个跳过，
// 每包的固定开销降一个量级。签名覆盖面就是 stateOf/equipmentChanged 的读取面，
// 漏一个字段这里就会静默漏差分，改动那边时要同步这里。
const shipSignatures = new Map<number, string>()
const signatureOf = (ship: PlayerShip): string => {
  const slotitems = store.getState().player.slotitems
  let sig = `${ship.shipId}|${ship.lv}|${ship.expTotal}`
  for (const instanceId of ship.slot) {
    if (instanceId <= 0) continue
    const inst = slotitems[instanceId]
    sig += `|${instanceId}:${inst?.mstId ?? 0}:${inst?.level ?? 0}:${inst?.alv ?? 0}`
  }
  if (ship.slotEx > 0) {
    const inst = slotitems[ship.slotEx]
    sig += `|x${ship.slotEx}:${inst?.mstId ?? 0}:${inst?.level ?? 0}:${inst?.alv ?? 0}`
  }
  return sig
}

const syncShipStates = (ts: number, apiPath = '') => {
  const ships = Object.values(store.getState().player.ships)
  if (!ships.length) return
  const states: ShipLifeStateRow[] = []
  const events: ShipLifeEventInput[] = []
  // 这一批新入籍的（与 events 里的是同一批对象），出处统一在循环后补
  const joins: ShipLifeEventInput[] = []

  for (const ship of ships) {
    const prior = baselines.get(ship.id)
    const signature = signatureOf(ship)
    if (prior && shipSignatures.get(ship.id) === signature) continue
    shipSignatures.set(ship.id, signature)
    const next = stateOf(ship, ts, prior?.firstSeen ?? ts)
    if (!prior) {
      if (primed) {
        const join: ShipLifeEventInput = {
          ts,
          rosterId: ship.id,
          mstId: ship.shipId,
          kind: 'join',
          detail: { level: ship.lv },
        }
        events.push(join)
        joins.push(join)
      }
      baselines.set(ship.id, next)
      states.push(next)
      continue
    }

    if (ship.expTotal > prior.expTotal) {
      events.push({
        ts,
        rosterId: ship.id,
        mstId: ship.shipId,
        kind: 'exp',
        expDelta: ship.expTotal - prior.expTotal,
        detail: {
          levelBefore: prior.level,
          levelAfter: ship.lv,
          totalAfter: ship.expTotal,
        },
      })
    }
    const pendingRemodelTs = pendingRemodels.get(ship.id)
    const confirmedRemodel =
      ship.shipId !== prior.mstId &&
      apiPath === '/kcsapi/api_get_member/ship3' &&
      pendingRemodelTs != null &&
      ts >= pendingRemodelTs &&
      ts - pendingRemodelTs <= 30000
    const changedEquipment = equipmentChanged(prior.equipment, next.equipment)
    if (confirmedRemodel) {
      events.push({
        ts,
        rosterId: ship.id,
        mstId: ship.shipId,
        kind: 'remodel',
        detail: {
          beforeMstId: prior.mstId,
          afterMstId: ship.shipId,
          level: ship.lv,
          equipmentBefore: changedEquipment ? prior.equipment : undefined,
          equipmentAfter: changedEquipment ? next.equipment : undefined,
        },
      })
      pendingRemodels.delete(ship.id)
    }
    // 改造往往同时卸下/重排装备；已经并进改造详情，不能再刷一条重复“装备变更”。
    if (changedEquipment && !confirmedRemodel) {
      events.push({
        ts,
        rosterId: ship.id,
        mstId: ship.shipId,
        kind: 'equipment',
        detail: {
          before: prior.equipment,
          after: next.equipment,
        },
      })
    }

    const changed =
      prior.mstId !== next.mstId ||
      prior.level !== next.level ||
      prior.expTotal !== next.expTotal ||
      JSON.stringify(prior.equipment) !== JSON.stringify(next.equipment)
    if (changed) {
      baselines.set(ship.id, next)
      states.push(next)
    }
  }

  primed = true
  attachJoinOrigins(joins)
  ledger.saveShipLifeStates(states)
  ledger.logShipLifeEvents(events)
}

// 启动回灌只能说明“当前最后已知状态”，不能证明离线期间做过哪次操作。
// 因此只重建差分基线，绝不在启动时补写改造/换装事件。
export const primeShipLife = (ts: number) => {
  const states = Object.values(store.getState().player.ships).map((ship) => {
    const next = stateOf(ship, ts, baselines.get(ship.id)?.firstSeen ?? ts)
    baselines.set(ship.id, next)
    shipSignatures.set(ship.id, signatureOf(ship))
    return next
  })
  if (states.length) ledger.saveShipLifeStates(states)
  primed = true
}

/**
 * ケッコンカッコカリ。与 remodel 同族：这一艘**实例**身上一次性的永久变化。
 *
 * 与 remodel 不同的是它不需要「等下一份完整舰队快照来确认」——remodel 那道确认
 * 是因为 api_req_kaisou/remodeling 的响应不带改造后的舰，得等 ship3 才知道成了没；
 * 而这条 path 只要到达就意味着服务器已经受理（api_result !== 1 的响应在锚那一层
 * 就没进来）。所以确认的对象只有「是哪一艘」：认不出就不落账，绝不猜一艘。
 *
 * **必须在 syncShipStates 之前调**：差分基线一旦跟到 Lv100，「当时等级」就再也
 * 说不出来了。取不到基线时 level 留 null（显示成「Lv ?」），不拿婚后的 100 冒充。
 */
const recordMarriage = (rosterId: number | null, ts: number) => {
  if (rosterId == null || !(rosterId > 0)) return
  const prior = baselines.get(rosterId)
  const ship = store.getState().player.ships[rosterId]
  const mstId = prior?.mstId ?? ship?.shipId ?? 0
  if (!(mstId > 0)) return
  ledger.logShipLifeEvents([
    {
      ts,
      rosterId,
      mstId,
      kind: 'marriage',
      detail: { level: prior?.level ?? null },
    },
  ])
}

/**
 * 格納庫増設。与 marriage / remodel 同族：这一艘**实例**身上一次性的永久变化，
 * path 到达即成立（api_result !== 1 的响应在锚那一层就没进来）。
 *
 * 旧上限由调用方在**归约之前**取好传进来（见 index.ts 的 hangarCapsBefore）：
 * 归约跑完 ship.onslotMax 已经是新值了。取不到旧值就只写新上限、不写箭头——
 * 同一格能扩不止一次，第二次再拿主数据的原量作差就会写出「2→4」这种没发生过的事。
 * 这与「等级取不到就写 ?」是同一条：宁可少说一句，不拿算得出的数冒充。
 */
const recordHangarExpand = (
  post: Record<string, string>,
  body: any,
  capsBefore: number[] | null,
  ts: number,
) => {
  const rosterId = parseInt(post.api_ship_id, 10)
  const slotPos = parseInt(post.api_slot_pos, 10) // 1-based，实测 "4" = 第 4 格
  const caps = body?.api_onslot_max
  if (!(rosterId > 0) || !(slotPos > 0) || !Array.isArray(caps)) return
  const after = Number(caps[slotPos - 1])
  if (!Number.isFinite(after) || after <= 0) return
  const prior = baselines.get(rosterId)
  const mstId = prior?.mstId ?? store.getState().player.ships[rosterId]?.shipId ?? 0
  if (!(mstId > 0)) return
  const before = Number(capsBefore?.[slotPos - 1])
  ledger.logShipLifeEvents([
    {
      ts,
      rosterId,
      mstId,
      kind: 'hangar_expand',
      detail: {
        slot: slotPos,
        before: Number.isFinite(before) && before > 0 ? before : null,
        after,
      },
    },
  ])
}

const recordDepartures = (
  ids: number[],
  kind: 'scrap' | 'material',
  ts: number,
  detail: Record<string, any> = {},
) => {
  const events = [...new Set(ids)]
    .map((rosterId): ShipLifeEventInput | null => {
      const prior = baselines.get(rosterId)
      if (!prior) return null
      return {
        ts,
        rosterId,
        mstId: prior.mstId,
        kind,
        detail: {
          level: prior.level,
          equipment: prior.equipment,
          ...detail,
        },
      }
    })
    .filter(Boolean) as ShipLifeEventInput[]
  ledger.logShipLifeEvents(events)
}

const deployedRosterIds = (): number[] => {
  const state = store.getState()
  const sortie = state.sortie
  if (!sortie) return []
  const deckIds = [sortie.deckId]
  if (state.player.combinedFlag > 0 && sortie.deckId === 1) deckIds.push(2)
  const ids = new Set<number>()
  for (const deckId of deckIds) {
    const deck = state.player.decks.find((item) => item.id === deckId)
    for (const rosterId of deck?.ships ?? []) {
      if (rosterId > 0) ids.add(rosterId)
    }
  }
  return [...ids]
}

const recordSortie = (ts: number) => {
  const state = store.getState()
  const sortie = state.sortie
  if (!sortie || sortie.practice) return
  const map = mapIdOf(sortie.mapArea, sortie.mapNo)
  const events = deployedRosterIds()
    .map((rosterId): ShipLifeEventInput | null => {
      const ship = state.player.ships[rosterId]
      if (!ship) return null
      return {
        ts,
        rosterId,
        mstId: ship.shipId,
        kind: 'sortie',
        map,
        cell: sortie.currentCell,
        detail: {
          deckId: sortie.deckId,
          combined: state.player.combinedFlag > 0,
        },
      }
    })
    .filter(Boolean) as ShipLifeEventInput[]
  ledger.logShipLifeEvents(events)
}

const recordBattle = (body: any, ts: number) => {
  const sortie = store.getState().sortie
  const battle = sortie?.battle
  if (!sortie || !battle?.result) return
  const node = sortie.nodes.find((item) => item.cell === sortie.currentCell)
  const mainMvp = typeof body?.api_mvp === 'number' ? body.api_mvp - 1 : -1
  const escortMvp =
    typeof body?.api_mvp_combined === 'number' ? 6 + body.api_mvp_combined - 1 : -1
  const isBoss = !sortie.practice && node?.eventId === 5
  // 谁给了 boss 最后一击。只有 boss 战问这一句：常规点的敌旗舰不是 boss，
  // 演习更没有「击沉」可言（HP 底线 1）。判据全在这一场的 attacks 里。
  const bossKill = isBoss ? resolveBossKill(battle.eShips, battle.attacks) : null
  for (const anomaly of bossKill?.anomalies ?? []) {
    console.warn('[kanso] mg: boss 击杀归属异常 —', bossKillAnomalyText(anomaly))
  }
  // 只有归到单舰那一档才落账：航空/支援终结的场次没有单舰归属，如实缺席。
  const killer =
    bossKill?.agent?.kind === 'ship'
      ? { index: bossKill.agent.index, bossMstId: bossKill.flagshipMstId }
      : null
  const seen = new Set<number>()
  const events: ShipLifeEventInput[] = []
  for (const ship of battle.fShips) {
    if (ship.rosterId == null || ship.hpStart <= 0 || ship.escaped || seen.has(ship.rosterId)) continue
    seen.add(ship.rosterId)
    events.push({
      ts,
      rosterId: ship.rosterId,
      mstId: ship.mstId,
      kind: 'battle',
      map: sortie.practice ? null : mapIdOf(sortie.mapArea, sortie.mapNo),
      cell: sortie.practice ? null : sortie.currentCell,
      rank: battle.result.rank,
      isBoss,
      practice: sortie.practice,
      mvp: ship.index === mainMvp || ship.index === escortMvp,
      damageTaken: damageTakenIn(ship),
      taiha: taihaIn(ship),
      // battle.ts 只在 attacker >= 0 时累加，航空/支援这些阶段伤害本来就不在里面
      damageDealt: ship.damageDealt,
      detail: {
        perfect: battle.prediction.perfect,
        fleet: ship.fleet,
        position: ship.position,
        snapshotId: battle.result.snapshotId ?? null,
        // 敌旗舰的深海 mstId。只有终结那一击的那一艘带这个键，其余舰整个不写这一列
        // ——「没有这一格」就是「不是她终结的」，不需要一个表示「无」的值。
        ...(killer && ship.index === killer.index ? { bossKill: killer.bossMstId } : {}),
      },
    })
    // 演习的 sunk 只是 HP 降至 1 的胜负判定，绝不能写成实例舰真正沉没。
    if (ship.sunk && !sortie.practice) {
      events.push({
        ts,
        rosterId: ship.rosterId,
        mstId: ship.mstId,
        kind: 'sunk',
        map: sortie.practice ? null : mapIdOf(sortie.mapArea, sortie.mapNo),
        cell: sortie.practice ? null : sortie.currentCell,
        rank: battle.result.rank,
        isBoss,
        detail: {
          level: ship.lv,
          fleet: ship.fleet,
          position: ship.position,
          equipment: baselines.get(ship.rosterId)?.equipment ?? [],
        },
      })
    }
  }
  ledger.logShipLifeEvents(events)
}

export const onShipLifeApi = (
  apiPath: string,
  body: any,
  _post: Record<string, string>,
  ts: number,
  sections: Section[],
  extras: { hangarCapsBefore?: number[] | null } = {},
) => {
  try {
    for (const [rosterId, requestedAt] of pendingRemodels) {
      if (ts - requestedAt > 30000) pendingRemodels.delete(rosterId)
    }
    if (apiPath === '/kcsapi/api_req_kaisou/remodeling') {
      const targetId = parseInt(_post.api_id, 10)
      if (targetId > 0) pendingRemodels.set(targetId, ts)
    }
    // 认舰先认请求侧的 api_id（同族路径都是这个键），响应体只做兜底：
    // 这条 path 在本机账本里零样本，响应形状未经实证，不深挖它的字段。
    if (apiPath === '/kcsapi/api_req_kaisou/marriage') {
      recordMarriage(
        [parseInt(_post.api_id, 10), Number(body?.api_id)].find((id) => id > 0) ?? null,
        ts,
      )
    }
    // 与 marriage 同理放在 syncShipStates 之前：基线一旦跟上去，这条就再没有
    // 「当时」可言了。认舰只认 post 的 api_ship_id（响应体里没有舰的身份）。
    if (apiPath === '/kcsapi/api_req_kaisou/hangar_expand') {
      recordHangarExpand(_post, body, extras.hangarCapsBefore ?? null, ts)
    }
    // 出处登记必须在 syncShipStates 之前：建造是同一个包里入籍的，
    // 登记晚一步，那条 join 就已经写完并且再也不会重来。
    if (apiPath === '/kcsapi/api_req_kousyou/getship') registerBuildReceipt(body, ts)
    if (
      apiPath === '/kcsapi/api_req_sortie/battleresult' ||
      apiPath === '/kcsapi/api_req_combined_battle/battleresult'
    ) {
      registerDropSighting(body, ts)
    }
    if (sections.includes('ships') || sections.includes('slotitems')) {
      syncShipStates(ts, apiPath)
    }
    if (apiPath === '/kcsapi/api_req_kousyou/destroyship') {
      recordDepartures(
        `${_post.api_ship_id ?? ''}`.split(',').map((id) => parseInt(id, 10)).filter((id) => id > 0),
        'scrap',
        ts,
        { destroyEquipment: parseInt(_post.api_slot_dest_flag, 10) !== 0 },
      )
    }
    if (apiPath === '/kcsapi/api_req_kaisou/powerup') {
      recordDepartures(
        `${_post.api_id_items ?? ''}`.split(',').map((id) => parseInt(id, 10)).filter((id) => id > 0),
        'material',
        ts,
        {
          targetRosterId: parseInt(_post.api_id, 10) || null,
          success: body?.api_powerup_flag === 1,
        },
      )
    }
    if (apiPath === '/kcsapi/api_req_map/start') recordSortie(ts)
    if (
      apiPath === '/kcsapi/api_req_sortie/battleresult' ||
      apiPath === '/kcsapi/api_req_combined_battle/battleresult' ||
      apiPath === '/kcsapi/api_req_practice/battle_result'
    ) {
      recordBattle(body, ts)
    }
  } catch (error) {
    console.warn('[kanso] mg: ship life tracking failed', apiPath, error)
  }
}
