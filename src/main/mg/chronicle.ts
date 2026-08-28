// 铭 · 遭遇志（本地反哺）。把你自己的战斗遭遇与罗盘带路压缩成永久记录：
// - 遭遇：battleresult 时记 敌编成/阵形/评级/掉落/是否 Boss（此时信息最全）；
// - 带路：map/start（起点 -1→首格）与 map/next（上格→新格）各记一条边；
// - 演习不记（不是海域遭遇）；
// - 消费端：镝右栏「你的实测」与「线路预测」、海域图鉴的个人遭遇/掉落史。
// 这些表不入任何清理路径——一行几十字节，是账本原始报文被清掉之后仍留下的「精矿」。
import { ipcMain } from 'electron'

import ledger from './ledger'
import * as store from './store'
import { mapIdOf } from '../../shared/map-id'
import { los33Of } from '../../shared/fleet-los33'
import { friendlyFleetKey, parseFriendlyInfo } from '../../shared/friendly-fleet'

const predictionScopeOf = (sortie: { mapArea: number; mapNo: number }) => {
  const state = store.getState()
  const map = mapIdOf(sortie.mapArea, sortie.mapNo)
  return {
    map,
    difficulty: state.mapGauges[map]?.selectedRank ?? 0,
    eventKey: state.eventAreas[sortie.mapArea]?.firstSeenTs ?? 0,
    combinedType: state.player.combinedFlag,
  }
}

const fleetSignatureOf = (deckId: number): string => {
  const state = store.getState()
  const deckIds = [deckId]
  if (state.player.combinedFlag > 0 && deckId === 1) deckIds.push(2)
  return JSON.stringify(
    deckIds.map((id) => {
      const deck = state.player.decks.find((item) => item.id === id)
      return (deck?.ships ?? [])
        .filter((shipId) => shipId > 0)
        .map((shipId) => {
          const ship = state.player.ships[shipId]
          return ship ? [ship.shipId, ship.lv] : [0, 0]
        })
    }),
  )
}

// 通关阵容的装备搭配（2026-08-17：桶之类的特殊装备会引导路径）。
// 与签名同刻记录：[每队][每舰][{装备 mstId, 改修}]。签名只有舰型+等级，
// 装备没法事后回溯，所以必须在出击那一瞬落表。
const fleetEquipsOf = (deckId: number): { mstId: number; level: number }[][][] => {
  const state = store.getState()
  const deckIds = [deckId]
  if (state.player.combinedFlag > 0 && deckId === 1) deckIds.push(2)
  return deckIds.map((id) => {
    const deck = state.player.decks.find((item) => item.id === id)
    return (deck?.ships ?? [])
      .filter((rosterId) => rosterId > 0)
      .map((rosterId) => {
        const ship = state.player.ships[rosterId]
        if (!ship) return []
        const allSlots = ship.slotEx > 0 ? [...ship.slot, ship.slotEx] : ship.slot
        return allSlots.flatMap((instId) => {
          if (instId <= 0) return []
          const inst = state.player.slotitems[instId]
          return inst ? [{ mstId: inst.mstId, level: inst.level || 0 }] : []
        })
      })
  })
}

// 33 式索敌（2026-08-17：对进 Boss 点很重要）。分岐点係数按 ×1 记；
// 数学核与编成面板同一份（shared/fleet-los33），提督等级取出击那一刻。
const fleetLos33Of = (deckId: number): number | null => {
  const state = store.getState()
  const admiralLv = state.player.basic?.level ?? 0
  if (!(admiralLv > 0)) return null
  const deckIds = [deckId]
  if (state.player.combinedFlag > 0 && deckId === 1) deckIds.push(2)
  const ships = deckIds.flatMap((id) => {
    const deck = state.player.decks.find((item) => item.id === id)
    return (deck?.ships ?? [])
      .filter((rosterId) => rosterId > 0)
      .flatMap((rosterId) => {
        const ship = state.player.ships[rosterId]
        if (!ship) return []
        const allSlots = ship.slotEx > 0 ? [...ship.slot, ship.slotEx] : ship.slot
        const items = allSlots.flatMap((instId) => {
          if (instId <= 0) return []
          const inst = state.player.slotitems[instId]
          const mst = inst ? state.master.slotitems[inst.mstId] : undefined
          if (!inst || !mst) return []
          return [{ saku: mst.saku, type2: mst.type2, level: inst.level || 0 }]
        })
        return [{ panelLos: ship.sakuteki, items }]
      })
  })
  if (!ships.length) return null
  const slotCount = deckIds.length > 1 ? 12 : ships.length > 6 ? 7 : 6
  return los33Of(ships, admiralLv, 1, slotCount).total
}

const fleetSupplyBaselineOf = (deckId: number) => {
  const state = store.getState()
  const deckIds = [deckId]
  if (state.player.combinedFlag > 0 && deckId === 1) deckIds.push(2)
  return deckIds.flatMap((id) => {
    const deck = state.player.decks.find((item) => item.id === id)
    return (deck?.ships ?? []).flatMap((rosterId) => {
      const ship = state.player.ships[rosterId]
      return ship
        ? [{ rosterId, fuel: ship.fuel, ammo: ship.bull }]
        : []
    })
  })
}

// 本会话真实进行中的出击（startTs）。崩溃残留的旧 sortie 会随 domain 快照回灌
// （active:false），下一次回港若拿当前燃弹去结算它的补给差额，离线期间补过一半的
// 场景会写进一个**错误但非零**的消耗——恢复逻辑只修 0 值，不会再碰它。
// 只有本会话观测到 active 的出击才允许结算；旧样本保持未完结（差额不可知）。
const sessionSorties = new Set<number>()

export const onChronicleApi = (apiPath: string, body: any, _post: Record<string, string>, ts: number) => {
  try {
    const sortie = store.getState().sortie
    if (!sortie || sortie.practice || sortie.mapArea <= 0) return
    if (sortie.active) sessionSorties.add(sortie.startTs)
    const scope = predictionScopeOf(sortie)

    if (apiPath === '/kcsapi/api_req_map/start') {
      ledger.startSortieSample({
        sortieId: sortie.startTs,
        ts,
        ...scope,
        deckId: sortie.deckId,
        bossCell: sortie.bossCell,
        fleetSignature: fleetSignatureOf(sortie.deckId),
        supplyBaseline: fleetSupplyBaselineOf(sortie.deckId),
        fleetEquips: fleetEquipsOf(sortie.deckId),
        los33: fleetLos33Of(sortie.deckId),
      })
      const to = sortie.nodes[sortie.nodes.length - 1]?.cell ?? -1
      if (to > 0) ledger.logRoute(ts, scope.map, -1, to)
      return
    }

    if (apiPath === '/kcsapi/api_req_map/next') {
      ledger.markLatestNodeAdvanced(sortie.startTs)
      // store 已把新格 push 进 nodes：上一格 = 倒数第二项（start 时不存在 → 起点 -1）
      const nodes = sortie.nodes
      const to = nodes[nodes.length - 1]?.cell ?? -1
      const from = nodes.length >= 2 ? nodes[nodes.length - 2].cell : -1
      if (to > 0) ledger.logRoute(ts, scope.map, from, to)
      return
    }

    if (apiPath === '/kcsapi/api_port/port') {
      // 回港时归约器已把 active 置 false；凭 sessionSorties 识别「这场是本会话打的」
      if (sessionSorties.has(sortie.startTs)) {
        ledger.finishSortieSample(sortie.startTs, ts, store.getState().player.ships)
        sessionSorties.delete(sortie.startTs)
      }
      return
    }

    // 友军遭遇：带 api_friendly_info 的（夜战）包一到就记一次。
    // 要請类型取本机最后一次 set_friendly_request 的 api_request_type；
    // 从没收到过那条报文时留 null——「不知道」不许回灌成「通常要請」。
    // api_production_type 原值直传，语义未定，落表也不解读。
    const friendly = parseFriendlyInfo(body?.api_friendly_info)
    if (friendly && sortie.currentCell > 0) {
      const requestType = store.getState().player.friendlyRequest?.type
      ledger.logFriendlyFleet({
        fleetKey: friendlyFleetKey(friendly.ships),
        ts,
        map: scope.map,
        cell: sortie.currentCell,
        difficulty: scope.difficulty,
        requestType: typeof requestType === 'number' ? requestType : null,
        productionType: friendly.productionType,
        ships: friendly.ships,
      })
    }

    if (
      apiPath === '/kcsapi/api_req_sortie/battleresult' ||
      apiPath === '/kcsapi/api_req_combined_battle/battleresult'
    ) {
      const battle = sortie.battle
      if (!battle) return
      const node = sortie.nodes.find((n) => n.cell === sortie.currentCell)
      const isBoss = node?.eventId === 5
      const rank = typeof body.api_win_rank === 'string' ? body.api_win_rank : null
      const deployed = battle.fShips.filter((ship) => ship.hpStart > 0 && !ship.escaped)
      const taihaCount = deployed.filter(
        (ship) =>
          !ship.sunk &&
          ship.hpEnd > 0 &&
          ship.hpEnd / Math.max(1, ship.hpMax) <= 0.25,
      ).length
      ledger.logEncounter(
        ts,
        scope.map,
        sortie.currentCell,
        isBoss,
        battle.eFormation,
        battle.eShips.map((x) => x.mstId),
        rank,
        body.api_get_ship?.api_ship_id ?? null,
        // 击沉掩码：eShips[i].sunk 已由战斗模型逐舰算好（含夜战），位 i 对应 comp[i]。
        // 演习没有真轰沉（sunk 仅作胜败判定），但演习本就不入遭遇志，这里到不了。
        battle.eShips.reduce((mask, s, i) => (s.sunk ? mask | (1 << i) : mask), 0),
        // 活动难度取自游戏下发的 api_selected_rank；常规海域没有这一项，留 null。
        // 甲乙丙丁的同名敌舰是不同的 mstId，不记下来就没法拿实测去核对资料包。
        store.getState().mapGauges?.[scope.map]?.selectedRank ?? null,
      )
      ledger.logNodeSample({
        sortieId: sortie.startTs,
        battleNo: sortie.battleCount,
        ts,
        ...scope,
        cell: sortie.currentCell,
        isBoss,
        formation: battle.eFormation,
        comp: battle.eShips.map((ship) => ship.mstId),
        rank,
        shipCount: deployed.length,
        taihaCount,
      })
      if (isBoss) ledger.markBossSample(sortie.startTs, rank)
    }
  } catch (e) {
    console.warn('[kanso] chronicle failed', apiPath, e)
  }
}

// 当前点：遭遇聚合 + 单点战斗估算样本（镝右栏）。
ipcMain.handle('chron:node', (_event, map: number, cell: number, rawScope?: any) => {
  const safeInt = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  const safeTs = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : -1
  const mapId = map | 0
  const cellId = cell | 0
  return {
    encounters: ledger.queryEncountersAt(mapId, cellId),
    // 本机确认掉落层：出击卡的「当前点掉落」要与离线目录并列显示这一段。
    // 挂在已有的 chron:node 上，不新开一条请求——出击时右栏本来就每场重取一次。
    localDrops: ledger.queryLocalDrops(mapId, cellId),
    forecast: ledger.querySortieForecast({
      map: mapId,
      cell: cellId,
      difficulty: safeInt(rawScope?.difficulty),
      eventKey: safeTs(rawScope?.eventKey) > 0 ? safeTs(rawScope?.eventKey) : 0,
      combinedType: safeInt(rawScope?.combinedType),
      excludeSortieId: safeTs(rawScope?.excludeSortieId),
      previewShipIds: Array.isArray(rawScope?.previewShipIds)
        ? rawScope.previewShipIds
            .map((id: unknown) => safeInt(id))
            .filter((id: number) => id > 0)
            .slice(0, 3)
        : [],
    }),
  }
})

// 海域图鉴的整图规划：一次 SQL 聚合返回终点统计与全部节点样本。
// 与战斗现场的 chron:node 分开，避免为了十几个节点发十几次请求。
ipcMain.handle('chron:forecast-map', (_event, map: number, rawScope?: any) => {
  const safeInt = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  const safeTs = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : -1
  return ledger.querySortieForecast({
    map: map | 0,
    cell: -1,
    difficulty: safeInt(rawScope?.difficulty),
    eventKey: safeTs(rawScope?.eventKey) > 0 ? safeTs(rawScope?.eventKey) : 0,
    combinedType: safeInt(rawScope?.combinedType),
    excludeSortieId: safeTs(rawScope?.excludeSortieId),
    previewShipIds: [],
  })
})

// 整图：各点遭遇/掉落汇总（海域图鉴）
ipcMain.handle('chron:map', (_event, map: number) => ledger.queryMapChronicle(map | 0))

// 你在这张图这个难度上遇到过的友军（铎的友军舰队区块，与随包资料并列不合并）
ipcMain.handle('chron:friendly-fleets', (_event, map: number, difficulty: number) =>
  ledger.queryFriendlyFleets(map | 0, difficulty | 0),
)

// 通关阵容（2026-08-17）：打赢过 Boss 的编成聚合，作个人带路参考。
// 难度/活动代按当前状态解析——与出击样本落表时的口径（predictionScopeOf）一致
ipcMain.handle('chron:map-clear-fleets', (_event, map: number) => {
  const mapId = map | 0
  const state = store.getState()
  return ledger.queryMapClearFleets(
    mapId,
    state.mapGauges[mapId]?.selectedRank ?? 0,
    state.eventAreas[Math.floor(mapId / 10)]?.firstSeenTs ?? 0,
  )
})

ipcMain.handle('chron:node-history-index', (_event, limit?: number) =>
  ledger.queryNodeHistoryIndex(typeof limit === 'number' ? limit : 300),
)

ipcMain.handle('chron:node-history', (_event, map: number, cell: number, limit?: number) =>
  ledger.queryNodeHistory(map | 0, cell | 0, typeof limit === 'number' ? limit : 60),
)

ipcMain.handle('chron:event-sortie-costs', (_event, areaId: number, sinceTs: number) =>
  ledger.queryEventSortieCosts(areaId | 0, Number.isFinite(sinceTs) ? Math.trunc(sinceTs) : 0),
)

// 活动归档（鉴的活动卷）：历次活动的期间统计
ipcMain.handle('chron:event-archives', () => ledger.queryEventArchives())

// 手动补档：活动还开着时也能先结一次账（数据随时间增长，可反复覆盖同一行）
ipcMain.handle('chron:archive-event', (_event, areaId: number, opened: number, closed: number) =>
  ledger.archiveEvent(areaId | 0, opened, closed),
)

// 深海舰 → 你在哪些图遇到过它（鉴的深海卷 Peek / 右键「出现海域」）
ipcMain.handle('chron:abyss-maps', () => ledger.abyssSeenMaps())

// 某舰的掉落地点反查（鉴的「掉落海域」）：你自己捞到过的图/点
ipcMain.handle('chron:ship-drops', (_event, mstId: number) => ledger.queryShipDropSites(mstId | 0))

// 深海舰遭遇/击破统计（鉴的深海卷）：mstId → {met, killed, withMask}
ipcMain.handle('chron:abyss-kills', () => Object.fromEntries(ledger.abyssKillStats()))

// 首见志：每艘舰在本地遭遇志里最早的一条掉落/击沉，供全域「初」标记使用
ipcMain.handle('chron:first-encounters', () => ledger.queryFirstEncounters())

// 这张图上你自己每个分歧点的实际去向次数（战斗现场的分歧提示 / 鉴的可达路线）
ipcMain.handle('chron:route-stats', (_event, map: number) => ledger.queryRouteStats(map | 0))

ipcMain.handle('chron:battles', (_event, limit?: number) =>
  ledger.queryBattleSnapshots(typeof limit === 'number' ? limit : 40),
)

ipcMain.handle('chron:battle', (_event, id: number) => ledger.queryBattleSnapshot(id | 0))
