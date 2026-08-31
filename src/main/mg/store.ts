// 铭 · 领域状态。把被动监听到的 /kcsapi 响应归一化成当前状态。
// 状态形状的口径尽量对齐 poi redux（const/info 命名沿社区习惯）。
// 纪律：游戏没自然给到的数据一律保持 null（「等待游戏自然提供」）。
import {
  mergeNight,
  parseBaseDefenseBattle,
  parseBattle,
  reconcileBattle,
  upgradeBattleView,
} from './battle'
import { mergeAirBases, replaceAirBases } from './air-bases'
import { newSunkEntries } from '../../shared/sortie-mourning'
import { newEscapeEntries } from '../../shared/sortie-escape'
import { auditSortieHp } from '../../shared/sortie-hp-audit'
import { recordAbyssVoiceSightings } from '../abyss-voice-sightings'
import { restoreSortieAcrossRestart } from '../../shared/sortie-restore'
import { parseAirBaseStrikes } from '../../shared/air-base-strike'
import { mapIdOf } from '../../shared/map-id'
import { berthBankedDecks } from '../../shared/berth-repair'
import { detectEventAreas } from '../../shared/event-area'
import ledger from './ledger'
import { diffPayitemStocks, parsePayitemList, payitemUseEffect } from '../../shared/pay-log'
import { reduceQuestList } from './quest-state'
import { applySlotitemInventoryMutation } from '../../shared/slotitem-mutation'
import { combinedFleetTypeFromMutation } from '../../shared/combined-fleet'
import {
  patchMapGaugeFromBattleResult,
  patchMapGaugeFromSortiePayload,
} from '../../shared/map-gauge'

import type { FleetContext, FleetEquipmentContext } from './battle'
import type {
  Deck,
  Kdock,
  MasterShip,
  MasterShipUpgrade,
  MasterSlotitem,
  MasterMission,
  MgState,
  Ndock,
  PlayerShip,
  Section,
  SlotitemInstance,
  SortieAnchorageRepair,
  SortieView,
} from '../../shared/mg-types'

const state: MgState = {
  master: { ready: false, ships: {}, stypes: {}, slotitems: {}, missions: {}, upgrades: {}, bgms: {} },
  player: {
    basic: null,
    materials: null,
    ships: {},
    decks: [],
    ndocks: [],
    kdocks: [],
    slotitems: {},
    quests: {},
    questsTs: null,
    questsFullTs: null,
    questActiveIds: null,
    questActiveTs: null,
    questExecCount: null,
    useitems: {},
    useitemsTs: null,
    furnitures: null,
    portLogs: [],
    practice: null,
    record: null,
    payitems: null,
    combinedFlag: 0,
    airBases: [],
    airBasesTs: null,
    lastPortTs: null,
    berthSince: {},
  },
  sortie: null,
  mapGauges: {},
  eventAreas: {},
  battleReconciliation: { checked: 0, mismatched: 0, records: [] },
}

// 60 秒内完成的入渠会在 start 后立刻下发“该槽已空”的 ndock，
// 不会再给一份修复后的 ship；短暂保留本次目标用于补齐这一次权威状态跃迁。
let pendingNdockStart: { dockId: number; shipId: number; ts: number } | null = null

export const getState = (): MgState => state

/**
 * 把某支舰队的母港泊地修理计时拨回 0。
 *
 * 判据与出处逐条记在 shared/berth-repair.ts（`BERTH_RESET_REASONS` 及其上方查证），
 * 这里只说**这两个调用点为什么是这两个**：
 *   · 編成変更 —— 只收「艦の追加 / はずす / 入れ替え」。这是 ElectronicObserver kcmemo
 *     对「編成」给的精确定义，四源一致。因此
 *     `preset_select`（編成記録の展開）**不**调它——「预设明石修理」那套玩法正是
 *     靠展开预设不拨计时，拨了就把玩家真实的进度抹掉了。
 *     `api_ship_id === -2`（随伴艦一括解除）同样不调：kcmemo 明确把它排除在「編成」之外。
 *     ⚠️ 一括解除这一条**只有 kcmemo 一源**；判错的代价只是那支队的「停泊 N 分」，
 *     且一括解除之后队里只剩旗舰，本来也没几个人可修。
 *   · 回港落账 —— 见 api_port/port 里的落账探测。
 *
 * 出撃**不**在这里：多源一致「出撃中もカウントは継続」。
 * 遠征也不在这里：它属于「停止」而不是「归零」，那一半由界面按 mission 状态自己判。
 */
const touchBerth = (deckId: number, ts: number) => {
  if (deckId > 0) state.player.berthSince[deckId] = ts
}

// 重启回灌：把上次会话的领域状态（任务/道具/海域进度/演习/出击）放回去。
// 这些切片只在玩家打开对应界面时才由游戏自然下发，不回灌就得再点一遍才有数据。
export const hydrateDomain = (data: any) => {
  if (!data || typeof data !== 'object') return
  if (data.quests && typeof data.quests === 'object') state.player.quests = data.quests
  state.player.questsTs = typeof data.questsTs === 'number' ? data.questsTs : null
  state.player.questsFullTs = typeof data.questsFullTs === 'number' ? data.questsFullTs : null
  state.player.questActiveIds = Array.isArray(data.questActiveIds)
    ? data.questActiveIds.map(Number).filter((id: number) => id > 0)
    : null
  // 旧快照没有独立时间戳；已有权威集合时以当时 questlist 时刻做一次迁移。
  state.player.questActiveTs =
    typeof data.questActiveTs === 'number'
      ? data.questActiveTs
      : state.player.questActiveIds && typeof data.questsTs === 'number'
        ? data.questsTs
        : null
  state.player.questExecCount =
    typeof data.questExecCount === 'number' ? data.questExecCount : null
  if (data.useitems && typeof data.useitems === 'object') state.player.useitems = data.useitems
  if (typeof data.useitemsTs === 'number') state.player.useitemsTs = data.useitemsTs
  if (data.slotitems && typeof data.slotitems === 'object') state.player.slotitems = data.slotitems
  if (data.practice) state.player.practice = data.practice
  // 战绩按内嵌 ts 比新旧：port 快照重放的返港简版（2026-08-17 起）可能比
  // domain 里存的旧战绩页版本更新——回放顺位在后不代表数据更新，谁的 ts 新听谁的
  if (data.record && typeof data.record === 'object') {
    const existing = state.player.record
    if (!existing || (Number(data.record.ts) || 0) >= (existing.ts ?? 0)) {
      state.player.record = data.record
    }
  }
  // 课金持有基线必须跨重启：丢了它，重启后第一份 payitem 清单会被当成首次观测，
  // 现存持有全部漏记 diff（或反过来造假购买）
  if (data.payitems && typeof data.payitems === 'object' && data.payitems.items) {
    state.player.payitems = data.payitems
  }
  if (data.mapGauges && typeof data.mapGauges === 'object') state.mapGauges = data.mapGauges
  // 活动窗口必须跨重启保留——firstSeenTs 丢了就再也算不回来了
  if (data.eventAreas && typeof data.eventAreas === 'object') state.eventAreas = data.eventAreas
  if (data.sortie) {
    // 复盘态：上次出击已结束。`active` 强制 false + `sunkShips` / `anchorageRepairs`
    // / `escaped` 补成数组，
    // 判据与理由（尤其「为什么这条不只是账目问题，还管着母港的语音字幕」）
    // 收在 shared/sortie-restore —— 抽出去是为了让护栏能真跑：
    // 这个文件一 import 就会打开真账本并跑迁移，测试碰不得。
    const restored = restoreSortieAcrossRestart(data.sortie)
    if (restored.battle) restored.battle = upgradeBattleView(restored.battle)
    state.sortie = restored as typeof state.sortie
  }
  if (Array.isArray(data.airBases)) {
    state.player.airBases = data.airBases
    state.player.airBasesTs = data.airBasesTs ?? null
  }
  // 泊地修理的计时锚点：丢了就再也算不回来（游戏不下发它），所以旧快照里有就收
  if (data.berthSince && typeof data.berthSince === 'object') {
    state.player.berthSince = data.berthSince
  }
  // 母港舰队域（编成 / 入渠 / 建造）。**这三样此前完全不落盘**，重启后唯一的来源是
  // 回放 `api_port/port`（带 decks+ndocks）与 `api_get_member/require_info`（带 kdocks）
  // 两份原始快照——也就是「最后一次进母港 / 最后一次登录」那一刻的定格。
  //
  // 定格之后改过的那些，游戏不会再发一次 port，于是重启就丢：
  //   · 从远征页派出的那几支 —— `api_req_mission/start` + `api_get_member/deck`
  //   · 定格后开的入渠 —— `api_req_nyukyo/start` + `api_get_member/ndock`
  //   · 定格后开的建造 —— `api_req_kousyou/createship` + `api_get_member/kdock`
  // 这正是用户看到的「每次只丢一两支舰队的远征倒计时、其余还在」：丢的是回港之后
  // 才派出去的那几支（实测见 2026-08-27 22:37 那次重启：22:11:20 的 port 里三队在远征，
  // 22:11:25 又派了第四队，重启后只有前者活下来）。
  //
  // 陈旧性语义：完成时刻（mission[2] / completeTime）都是**绝对时间戳**，
  // 重启后倒计时天然算得对，连「已返港未收」也照实显示——游戏那头确实还没收。
  // 但编成本身可能落后于真实（艦素关着时玩家在游戏里动过队），下一个权威报文
  // （port / ship_deck / ship3 / deck）到达时整份覆盖，与既有哲学一致。
  //
  // 没有「重启复活旧状态」的风险：这三样都是纯数据，不像 sortie 那样带
  // 「本场还在进行中」的会话语义（那条得靠 restoreSortieAcrossRestart 把 active 抹成 false）。
  if (Array.isArray(data.decks)) state.player.decks = data.decks
  if (Array.isArray(data.ndocks)) state.player.ndocks = data.ndocks
  if (Array.isArray(data.kdocks)) state.player.kdocks = data.kdocks
  // 友军要請：只在玩家动开关那一刻下发一次，不回灌就等于每次重启都退回「未知」。
  // 旧快照没有这个键时**不写**——留着 undefined 才是「未知」，写成 {flag:0} 就成了
  // 凭空断言「没开」。
  if (data.friendlyRequest && typeof data.friendlyRequest === 'object') {
    state.player.friendlyRequest = {
      flag: Number(data.friendlyRequest.flag) || 0,
      type: Number(data.friendlyRequest.type) || 0,
    }
  }
}

// 需要跨重启保留的切片
export const domainSnapshot = () => ({
  quests: state.player.quests,
  questsTs: state.player.questsTs,
  questsFullTs: state.player.questsFullTs,
  questActiveIds: state.player.questActiveIds,
  questActiveTs: state.player.questActiveTs,
  questExecCount: state.player.questExecCount,
  useitems: state.player.useitems,
  useitemsTs: state.player.useitemsTs,
  slotitems: state.player.slotitems,
  practice: state.player.practice,
  record: state.player.record,
  payitems: state.player.payitems,
  mapGauges: state.mapGauges,
  eventAreas: state.eventAreas,
  sortie: state.sortie,
  airBases: state.player.airBases,
  airBasesTs: state.player.airBasesTs,
  berthSince: state.player.berthSince,
  // 母港舰队三件套：远征 / 入渠 / 建造的倒计时全靠它们跨重启（理由见 hydrateDomain 那侧）。
  // 体积很小（各 4 格定长），落盘频率跟着 1.5s 去抖，不值得为它另开一条通道。
  decks: state.player.decks,
  ndocks: state.player.ndocks,
  kdocks: state.player.kdocks,
  // 未观测过就是 undefined，JSON 序列化时整个键消失——回灌那边正好认「键缺席 = 未知」
  friendlyRequest: state.player.friendlyRequest,
})

// ---- 各字段的换算小工具 ----

const toShip = (raw: any): PlayerShip => ({
  id: raw.api_id,
  shipId: raw.api_ship_id,
  lv: raw.api_lv,
  expTotal: Array.isArray(raw.api_exp) ? raw.api_exp[0] : 0,
  expNext: Array.isArray(raw.api_exp) ? raw.api_exp[1] : 0,
  nowhp: raw.api_nowhp,
  maxhp: raw.api_maxhp,
  soku: raw.api_soku ?? 0,
  cond: raw.api_cond,
  fuel: raw.api_fuel,
  bull: raw.api_bull,
  ndockTime: raw.api_ndock_time,
  ndockItem: Array.isArray(raw.api_ndock_item) ? [raw.api_ndock_item[0], raw.api_ndock_item[1]] : [0, 0],
  locked: raw.api_locked === 1,
  slot: raw.api_slot ?? [],
  slotEx: raw.api_slot_ex ?? 0,
  onslot: raw.api_onslot ?? [],
  // 各格搭载上限，只有被格納庫増設扩过的舰才带这一项。
  //
  // 两条实测约束（2026-08-27，账本 + 快照）：
  // ① 稀疏——母港快照 433 艘舰里只有扩过的那 1 艘有 `api_onslot_max`，其余舰
  //    连键都没有；所以缺项要留 undefined，让上限回落主数据 maxEq。
  // ② **只有整份舰娘数据（port / ship3）才带它**，ship_deck、hokyu/charge 这些
  //    局部报文一律不带。所以「这次报文里没有」**不等于**「这艘舰没扩过」——
  //    缺项时沿用账上已有的那份，否则开一次编成画面就把上限抹掉一次。
  onslotMax: Array.isArray(raw.api_onslot_max)
    ? raw.api_onslot_max.map((value: unknown) => Number(value) || 0)
    : state.player.ships[raw.api_id]?.onslotMax,
  karyoku: Array.isArray(raw.api_karyoku) ? raw.api_karyoku[0] : 0,
  raisou: Array.isArray(raw.api_raisou) ? raw.api_raisou[0] : 0,
  taiku: Array.isArray(raw.api_taiku) ? raw.api_taiku[0] : 0,
  soukou: Array.isArray(raw.api_soukou) ? raw.api_soukou[0] : 0,
  kaihi: Array.isArray(raw.api_kaihi) ? raw.api_kaihi[0] : 0,
  taisen: Array.isArray(raw.api_taisen) ? raw.api_taisen[0] : 0,
  sakuteki: Array.isArray(raw.api_sakuteki) ? raw.api_sakuteki[0] : 0,
  // [1] = Lv99 上限（一手，婚后 [0] 会超过它）；图鉴三维成长的首选来源
  kaihiMax: Array.isArray(raw.api_kaihi) ? raw.api_kaihi[1] ?? 0 : 0,
  taisenMax: Array.isArray(raw.api_taisen) ? raw.api_taisen[1] ?? 0 : 0,
  sakutekiMax: Array.isArray(raw.api_sakuteki) ? raw.api_sakuteki[1] ?? 0 : 0,
  lucky: Array.isArray(raw.api_lucky) ? raw.api_lucky[0] : 0,
  kyouka: raw.api_kyouka ?? [],
  sallyArea: raw.api_sally_area ?? 0,
})

const toDeck = (raw: any): Deck => ({
  id: raw.api_id,
  name: raw.api_name,
  mission: raw.api_mission,
  ships: raw.api_ship,
})

const toNdock = (raw: any): Ndock => ({
  id: raw.api_id,
  shipId: raw.api_ship_id,
  completeTime: raw.api_complete_time,
  state: typeof raw.api_state === 'number' ? raw.api_state : undefined,
})

const toKdock = (raw: any): Kdock => ({
  id: raw.api_id,
  state: raw.api_state,
  createdShipId: raw.api_created_ship_id,
  completeTime: raw.api_complete_time,
  recipeFuel: raw.api_item1 ?? 0,
})

// 持有家具列表 → mst id 升序去重。实测（2026-08-17 账本快照）api_furniture_id
// 与 api_id 同值，均为家具主数据 id；优先前者、回退后者。形状不对返回 null（不动账）。
const toFurnitureIds = (list: unknown): number[] | null =>
  Array.isArray(list)
    ? [
        ...new Set(
          list
            .map((f: any) => Number(f?.api_furniture_id ?? f?.api_id))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ].sort((a, b) => a - b)
    : null

const toSlotitemMap = (raw: any): Record<number, SlotitemInstance> => {
  const map: Record<number, SlotitemInstance> = {}
  for (const item of raw ?? []) {
    map[item.api_id] = {
      mstId: item.api_slotitem_id,
      level: item.api_level ?? 0,
      alv: item.api_alv ?? 0,
      locked: item.api_locked === 1,
    }
  }
  return map
}

// 在现有资源上做增量（4 项收益数组：燃弹钢铝，远征/任务报酬口径）
const addMaterials4 = (gain: any): boolean => {
  if (!Array.isArray(gain) || !state.player.materials) return false
  const m = [...state.player.materials]
  gain.slice(0, 4).forEach((v, i) => {
    if (typeof v === 'number') m[i] += v
  })
  state.player.materials = m
  return true
}

// 在现有资源上做扣减（下标 → 数量）
const subtractMaterials = (costs: [number, number][]): boolean => {
  if (!state.player.materials) return false
  const m = [...state.player.materials]
  for (const [idx, amount] of costs) {
    if (amount > 0) m[idx] = Math.max(0, m[idx] - amount)
  }
  state.player.materials = m
  return true
}

// api_material 形如 [{api_id: 1..8, api_value}]，也可能是纯数字数组（hokyu/charge）
const toMaterials = (raw: any, prev: number[] | null): number[] => {
  const m = prev ? [...prev] : [0, 0, 0, 0, 0, 0, 0, 0]
  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => {
      if (typeof entry === 'number') {
        m[i] = entry
      } else if (entry && typeof entry.api_id === 'number') {
        m[entry.api_id - 1] = entry.api_value
      }
    })
  }
  return m
}

const applyShipUpdates = (rawShips: any) => {
  if (!Array.isArray(rawShips)) return
  for (const raw of rawShips) {
    state.player.ships[raw.api_id] = toShip(raw)
  }
}

const removeRosterShips = (ids: number[]) => {
  const removed = new Set(ids.filter((id) => id > 0))
  if (!removed.size) return
  for (const id of removed) delete state.player.ships[id]
  for (const deck of state.player.decks) {
    deck.ships = deck.ships.map((id) => (removed.has(id) ? -1 : id))
  }
}

const equippedSlotitemIds = (rosterIds: number[]): number[] => {
  const result = new Set<number>()
  for (const rosterId of rosterIds) {
    const ship = state.player.ships[rosterId]
    if (!ship) continue
    for (const id of [...ship.slot, ship.slotEx]) {
      if (id > 0) result.add(id)
    }
  }
  return [...result]
}

const removeSlotitems = (ids: number[]): boolean => {
  let changed = false
  for (const id of ids) {
    if (id > 0 && state.player.slotitems[id]) {
      delete state.player.slotitems[id]
      changed = true
    }
  }
  return changed
}

const applyDeckUpdates = (rawDecks: any, replaceAll: boolean) => {
  if (!Array.isArray(rawDecks)) return
  if (replaceAll) {
    state.player.decks = rawDecks.map(toDeck)
    return
  }
  for (const raw of rawDecks) {
    const deck = toDeck(raw)
    const idx = state.player.decks.findIndex((d) => d.id === deck.id)
    if (idx >= 0) state.player.decks[idx] = deck
    else state.player.decks.push(deck)
  }
}

// ---- 出击/战斗 ----

// 战斗解析器取我方舰队信息的桥（敌名用主数据，深海也在 start2 里）
const fleetContext: FleetContext = {
  fleetShips: (deckId) => {
    const deck = state.player.decks.find((d) => d.id === deckId)
    if (!deck) return []
    return deck.ships
      .map((id) => {
        if (id <= 0) return null
        const ship = state.player.ships[id]
        if (!ship) return null
        const mstId = ship?.shipId ?? 0
        const masterShip = state.master.ships[mstId]
        const equipmentAt = (
          instanceId: number,
          slot: number | 'ex',
        ): FleetEquipmentContext | null => {
          if (!(instanceId > 0)) return null
          const item = state.player.slotitems[instanceId]
          if (!item) return null
          // 容量取这一格的**实际**搭载上限：扩过的舰读实例一手值，其余回落主数据。
          //
          // 两代写法的由来：最早是 maxEq ?? onslot（只在主数据缺项时退到 onslot）。
          // 格納庫増設（2026-06-26 实装的 useitem 105，逐槽抬高搭载上限）之后，
          // 扩过的格 onslot 会**超过** maxEq，那时 maxEq 不是缺项、只是偏低——照抄
          // 它会让战斗详情写出「搭载 26/24」这种上限小于实载的数。当时字段名还未知，
          // 只能拿 max(maxEq, onslot) 当观测证据顶着。
          //
          // 现在一手上限已经在账上（onslotMax，见 toShip），直接读它。比旧证据强在：
          // 战损把 onslot 压到上限以下时，一手值照样说得出真上限。onslotMax 稀疏，
          // 缺项回落 maxEq。
          const capacity = slot === 'ex'
            ? 0
            : (ship.onslotMax?.[slot] ?? masterShip?.maxEq?.[slot] ?? 0)
          return {
            instanceId,
            mstId: item.mstId,
            slot,
            planeCount: slot === 'ex' || capacity <= 0 ? null : (ship.onslot?.[slot] ?? capacity),
            planeCapacity: slot === 'ex' || capacity <= 0 ? null : capacity,
            level: item.level,
            alv: item.alv,
          }
        }
        const equipments = (ship.slot ?? [])
          .map((instanceId, slot) => equipmentAt(instanceId, slot))
          .filter((item): item is FleetEquipmentContext => item != null)
        const ex = equipmentAt(ship.slotEx, 'ex')
        if (ex) equipments.push(ex)
        return {
          rosterId: id,
          mstId,
          name: state.master.ships[mstId]?.name ?? `#${mstId}`,
          lv: ship?.lv ?? 0,
          nowHp: ship.nowhp,
          maxHp: ship.maxhp,
          equipments,
        }
      })
  },
  masterName: (mstId) => state.master.ships[mstId]?.name ?? `深海${mstId}`,
  masterMaxEq: (mstId) => state.master.ships[mstId]?.maxEq ?? [],
  combinedType: () => state.player.combinedFlag,
}

// 昼战/空袭/长距离雷达射击型端点（新建 BattleView）
const DAY_BATTLE_PATHS = [
  '/kcsapi/api_req_sortie/battle',
  '/kcsapi/api_req_sortie/airbattle',
  '/kcsapi/api_req_sortie/ld_airbattle',
  '/kcsapi/api_req_sortie/ld_shooting',
  '/kcsapi/api_req_combined_battle/battle',
  '/kcsapi/api_req_combined_battle/battle_water',
  '/kcsapi/api_req_combined_battle/airbattle',
  '/kcsapi/api_req_combined_battle/ld_airbattle',
  '/kcsapi/api_req_combined_battle/ld_shooting',
  '/kcsapi/api_req_combined_battle/ec_battle',
  '/kcsapi/api_req_combined_battle/each_battle',
  '/kcsapi/api_req_combined_battle/each_battle_water',
  '/kcsapi/api_req_combined_battle/ec_night_to_day',
]

// 夜战端点（并入昼战；开幕夜战/单独夜战则新建）
const NIGHT_BATTLE_PATHS = [
  '/kcsapi/api_req_battle_midnight/battle',
  '/kcsapi/api_req_battle_midnight/sp_midnight',
  '/kcsapi/api_req_combined_battle/midnight_battle',
  '/kcsapi/api_req_combined_battle/sp_midnight',
  '/kcsapi/api_req_combined_battle/ec_midnight_battle',
]

// 非战斗点实况：资源获得（api_itemget）与涡潮损失（api_happening）
const MAT_NAMES = ['燃料', '弹药', '钢材', '铝土', '高速建造材', '高速修复材', '开发资材', '改修资材']

/**
 * 一格里游戏发下来的**全部**获得物。
 *
 * 两个来源，结构相同（`api_usemst` / `api_id` / `api_getcount`），只是挂的键不一样：
 * - `api_itemget`：常规的终点 / 资源格发放；
 * - `api_itemget_eo_comment`：EO（終点報酬）那一笔。账本 3 次全在 1-6
 *   （燃料 700、钢材 100、燃料 1000），**同一行的 `api_itemget` 是 undefined**，
 *   所以两者不会重复计一笔；分开读就会漏掉这一路——材料账只看得见总量在涨，
 *   说不出是哪趟拿的。
 *
 * 记账、上屏、道具三个消费者共用这一份，免得「有的地方算了、有的地方没算」。
 */
const mapGains = (body: any): any[] => {
  const asList = (raw: any): any[] => (Array.isArray(raw) ? raw : raw ? [raw] : [])
  return [...asList(body?.api_itemget), ...asList(body?.api_itemget_eo_comment)]
}

const nodeNote = (body: any): string | null => {
  const parts: string[] = []
  const items = mapGains(body)
  for (const it of items) {
    if (!it || typeof it.api_getcount !== 'number') continue
    const name = it.api_usemst === 4 ? (MAT_NAMES[it.api_id - 1] ?? `资源${it.api_id}`) : `道具#${it.api_id}`
    parts.push(`获得 ${name}×${it.api_getcount}`)
  }
  const hap = body.api_happening
  if (hap && typeof hap.api_count === 'number') {
    parts.push(`涡潮 ${MAT_NAMES[(hap.api_mst_id ?? 0) - 1] ?? '资源'} -${hap.api_count}${hap.api_dentan ? '（电探减免）' : ''}`)
  }
  return parts.length ? parts.join(' · ') : null
}

const applyMapMaterialDelta = (body: any): boolean => {
  if (!state.player.materials) return false
  const next = [...state.player.materials]
  let changed = false
  const gains = mapGains(body)
  for (const gain of gains) {
    if (gain?.api_usemst != null && Number(gain.api_usemst) !== 4) continue
    const gainIndex = Number(gain?.api_id) - 1
    const gainCount = Number(gain?.api_getcount)
    if (gainIndex >= 0 && gainIndex < next.length && gainCount > 0) {
      next[gainIndex] += gainCount
      changed = true
    }
  }
  const loss = body?.api_happening
  const lossIndex = Number(loss?.api_mst_id) - 1
  const lossCount = Number(loss?.api_count)
  if (lossIndex >= 0 && lossIndex < next.length && lossCount > 0) {
    next[lossIndex] = Math.max(0, next[lossIndex] - lossCount)
    changed = true
  }
  if (changed) state.player.materials = next
  return changed
}

const applyMapUseitemGains = (body: any, ts: number): boolean => {
  const gains = mapGains(body)
  let changed = false
  for (const gain of gains) {
    if (Number(gain?.api_usemst) !== 5) continue
    if (incrementUseitem(Number(gain.api_id), Number(gain.api_getcount), ts)) changed = true
  }
  return changed
}

/**
 * 掉落舰的入手台词（`api_get_ship.api_ship_getmes`）。
 *
 * 日文原文照录——台词是作品表达，走「台词原文列保原文」那一条，不机翻也不改写。
 * 只做一件事：把 `<br>` 换成真正的换行，好让显示端按行摆。
 */
const dropShipGetMessage = (dropShip: any): string => {
  const raw = `${dropShip?.api_ship_getmes ?? ''}`
  if (!raw.trim()) return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * EO 海域击破时游戏亲发的战果值（`api_get_exmap_rate`）。
 *
 * **字符串型**（`"75"` / `"150"` / `"100"`，账本 3/3 实测），非 EO 场次发的是数字 0，
 * 所以既不能 `=== 75` 比数字，也不能见到就当有值。这里严格转数：
 * 非有限数、非正整数一律返回 null，交给调用方退回本地那张 EO 战果表。
 */
const exmapSenkaOf = (body: any): number | null => {
  const raw = body?.api_get_exmap_rate
  if (raw == null) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null
  return value
}

/**
 * 本次通关解锁的新海域 id（`api_next_map_ids`）。
 *
 * **混型**：常规海域是数字、活动海域是字符串，所以逐项转数；转不出来的整项丢掉，
 * 不硬塞一个 NaN 进去让下游显示成「解锁 NaN-NaN」。
 */
const nextMapIdsOf = (body: any): number[] =>
  Array.isArray(body?.api_next_map_ids)
    ? body.api_next_map_ids
        .map((raw: unknown) => Number(raw))
        .filter((id: number) => Number.isInteger(id) && id > 0)
    : []

/**
 * 战斗结束时游戏**提供**的护卫退避选项（`api_escape_flag` + `api_escape`）。
 *
 * 与战斗包里那个同名的 `api_escape_idx` 不是一回事：那个说「谁已经退避掉了」，
 * 这个说「现在问你要不要让这几条退」。舰位是 1 基的，这里换成 0 基视图舰位。
 *
 * 两组各读各的：`api_escape_idx` 是要退的舰，`api_tow_idx` 是陪她一起走的护卫舰
 *（護衛退避是两艘一起离场；単艦退避没有护卫，那一组就是空的）。
 * ⚠️ 本机账本里唯一那次样本 `api_escape_idx` 有两个舰位、且**没有** `api_tow_idx`，
 * 所以这里只照字段读，一个字都不替游戏解释。
 *
 * `api_escape_type` 语义未确认（账本仅 1 次、取值 1），原值保留但不解释。
 */
const escapeOfferOf = (
  body: any,
): { escape: number[]; tow: number[]; type: number } | null => {
  if (Number(body?.api_escape_flag) !== 1) return null
  const raw = body?.api_escape
  const zeroBased = (list: unknown): number[] =>
    Array.isArray(list)
      ? list
          .map((v: unknown) => Number(v) - 1)
          .filter((v: number) => Number.isInteger(v) && v >= 0)
      : []
  const escape = zeroBased(raw?.api_escape_idx)
  const tow = zeroBased(raw?.api_tow_idx)
  if (!escape.length && !tow.length) return null
  return { escape, tow, type: Number(raw?.api_escape_type) || 0 }
}

const enemyPreviewOf = (body: any): SortieView['nodes'][number]['enemyPreview'] => {
  if (!Array.isArray(body?.api_e_deck_info)) return undefined
  const decks = body.api_e_deck_info.flatMap((raw: any) => {
    const shipIds = Array.isArray(raw?.api_ship_ids)
      ? raw.api_ship_ids.map(Number).filter((id: number) => id > 0).slice(0, 3)
      : []
    return shipIds.length ? [{ kind: Number(raw?.api_kind) || 0, shipIds }] : []
  })
  return decks.length ? decks : undefined
}

const cellFlavorOf = (body: any): SortieView['nodes'][number]['flavor'] => {
  const raw = body?.api_cell_flavor
  if (!raw || typeof raw.api_message !== 'string') return undefined
  const message = raw.api_message
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
  return message ? { type: Number(raw.api_type) || 0, message } : undefined
}

const sortieNodeOf = (body: any): SortieView['nodes'][number] => ({
  cell: body.api_no ?? -1,
  eventId: body.api_event_id ?? 0,
  eventKind: body.api_event_kind ?? 0,
  rank: null,
  note: nodeNote(body),
  enemyPreview: enemyPreviewOf(body),
  flavor: cellFlavorOf(body),
})

const cellDataOf = (body: any): SortieView['cellData'] =>
  Array.isArray(body?.api_cell_data)
    ? body.api_cell_data.flatMap((raw: any) => {
        const no = Number(raw?.api_no)
        if (!Number.isInteger(no) || no < 0) return []
        return [{
          id: Number(raw.api_id) || 0,
          no,
          color: Number(raw.api_color_no) || 0,
          passed: raw.api_passed === 1,
          distance:
            typeof raw.api_distance === 'number' && Number.isFinite(raw.api_distance)
              ? raw.api_distance
              : null,
        }]
      })
    : []

const selectRouteOf = (body: any): number[] =>
  Array.isArray(body?.api_select_route?.api_select_cells)
    ? body.api_select_route.api_select_cells
        .map(Number)
        .filter((cell: number) => Number.isInteger(cell) && cell > 0)
    : []

const newSortie = (partial: Partial<SortieView>): SortieView => ({
  active: true,
  practice: false,
  mapArea: 0,
  mapNo: 0,
  deckId: 1,
  bossCell: -1,
  nodes: [],
  currentCell: -1,
  cellData: [],
  selectRoute: [],
  practiceOpponent: null,
  battle: null,
  battleCount: 0,
  drops: [],
  sunkShips: [],
  anchorageRepairs: [],
  escaped: [],
  airBaseStrikes: {},
  bossCleared: null,
  taihaCorrections: 0,
  startTs: 0,
  updatedTs: 0,
  ...partial,
})

/**
 * `api_bosscomp`：游戏自报「这张图的 Boss 本期是否已击破」。
 *
 * 是**假说**不是定论——判据只有账本方向自洽（常规图恒 1、没打的 EO 图恒 0，
 * 1-5 与 3-5 各翻过一次 0→1，两次都紧跟在该图 EO 击破之后），社区文档一处都查不到。
 * 验收点是**月初 EO 重置**：若重置后不跟着翻回 0，这条判读连同显示一起撤掉。
 * 值不是 0/1 之外的数也照实转成布尔（>0 即已击破），字段缺席时保持 null＝不知道。
 */
const bossClearedOf = (body: any, fallback: boolean | null): boolean | null =>
  typeof body?.api_bosscomp === 'number' ? body.api_bosscomp > 0 : fallback

const setMapGauge = (
  mapId: number,
  next: MgState['mapGauges'][number] | null | undefined,
): boolean => {
  if (!(mapId > 0) || !next || state.mapGauges[mapId] === next) return false
  state.mapGauges[mapId] = next
  return true
}

/**
 * 出击途中的权威 HP 对账（哨兵）。ship_deck / port 把权威耐久盖上来之后调一次。
 *
 * 这件事到底挡得住什么，判据与 2026-08-27 的时序实测都写在 shared/sortie-hp-audit
 * 的头注里。一句话：ship_deck 是**进击这个动作自己带出来的**（实测 161/161 次后面
 * 隔 0.3～0.7 秒就是 api_req_map/next，撤退那一支根本没有 ship_deck），
 * 所以它挡不住这一步，挡的是下一步——以及给下一个解析 bug 留证据。
 *
 * `announce` 只在出击还要往下走时给 true。回港那一支不补喊大破：舰队已经到家，
 * 「继续前进可能被击沉」说的不是那个局面，而锐的编成面板此刻直接读权威耐久，
 * 大破本来就摆在眼前。
 *
 * 一致（绝大多数场次）时返回空数组：不改视图、不派发、不记日志。
 */
const runSortieHpAudit = (ts: number, announce: boolean): Section[] => {
  const sortie = state.sortie
  if (!sortie || !sortie.active || sortie.practice) return []
  const battle = sortie.battle
  if (!battle || battle.practice) return []

  const reconciliation = state.battleReconciliation
  // 每次覆盖都算查过一次。一致时**不**派发 battleReconciliation：这个计数
  // 会随下一条 battleresult 的派发一起到（每个战斗点位必有一条），
  // 不值得为它单独触发一次整表重渲。
  reconciliation.checked += 1

  const mismatches = auditSortieHp(battle.fShips, (id) => state.player.ships[id]?.nowhp)
  if (!mismatches.length) return []

  // 战斗视图当场纠正：镝的警告条与大破名单读的是它，而它是解析产物、不跟账本自动走。
  for (const ship of battle.fShips) {
    const fixed = ship.rosterId == null
      ? undefined
      : mismatches.find((m) => m.rosterId === ship.rosterId)
    if (fixed) ship.hpEnd = fixed.authoritative
  }

  reconciliation.mismatched += 1
  reconciliation.records.unshift({
    ts,
    map: mapIdOf(sortie.mapArea, sortie.mapNo),
    cell: sortie.currentCell,
    practice: false,
    discrepancies: mismatches.map((m) => ({
      kind: 'hp' as const,
      ours: m.parsed,
      game: m.authoritative,
      who: m.name,
    })),
  })
  reconciliation.records.length = Math.min(reconciliation.records.length, 100)
  // 解析路径要留在日志里：`kind` 就是 battle.ts 定的那一档（battleKindOf，按报文路径，
  // 对潜空袭那一档另看报文特征），夜战合并是另一条代码路径，所以 hasNight 一并记。
  const at = `${sortie.mapArea}-${sortie.mapNo} 节点 ${sortie.currentCell}`
  const path = `${battle.kind}${battle.hasNight ? '+night' : ''}`
  for (const m of mismatches) {
    console.warn(
      `[kanso] 对账 hp: ${m.name} 我们 ${m.parsed} 游戏 ${m.authoritative}/${m.hpMax}` +
        `${m.dangerous ? ' 漏报大破' : ''} @ ${at} ${path}`,
    )
  }

  if (announce && mismatches.some((m) => m.dangerous)) {
    sortie.taihaCorrections = (sortie.taihaCorrections ?? 0) + 1
  }
  return ['sortie', 'ships', 'battleReconciliation']
}

// 战斗 HP 推演实时回写舰船状态（锐的出击中血条跟真；ship_deck/port 到来时以权威值覆盖）。
// 演习伤害不持久（游戏设定），不回写。
const syncBattleHp = (battle: import('../../shared/mg-types').BattleView): boolean => {
  if (battle.practice) return false
  let changed = false
  for (const bs of battle.fShips) {
    if (bs.rosterId == null) continue
    const ship = state.player.ships[bs.rosterId]
    if (ship && ship.nowhp !== bs.hpEnd) {
      ship.nowhp = bs.hpEnd
      changed = true
    }
  }
  return changed
}

/**
 * 把当前节点战斗里沉掉的我方舰并进出击级名单。
 *
 * 只认 `ship.sunk`——与遭遇志、人生记录（ship-life.recordBattle）同一个判据。
 * 演习整场跳过：那边的「击沉」只是 HP 打到 1 的胜负判定，不是真沉。
 * 已在名单里的不再重复推（幂等）：同一场昼夜战会解析两遍，夜战合并后还要再走一次。
 *
 * **即时派发**：报文一到、battle.ts 把这个事实结算出来，就立刻收进名单，
 * 不等 battleresult。本工作台的哲学是全程先知，不做防剧透——
 * 「比游戏动画早一两分钟知道」正是它存在的理由，不是要修的时序问题。
 */
const collectSunkShips = (ts: number): boolean => {
  const sortie = state.sortie
  if (!sortie || sortie.practice) return false
  const fresh = newSunkEntries(sortie.battle, sortie.sunkShips, {
    cell: sortie.currentCell,
    battleNo: sortie.battleCount,
    ts,
  })
  sortie.sunkShips.push(...fresh)
  return fresh.length > 0
}

// 昼战/空袭/雷达射击包：一律新建 BattleView 顶掉上一场，从不 merge。
// 所以进点报文挂上来的基地防空占位（kind='baseDefense'）到这里天然会被替换掉，
// 不必额外排除。onNightBattle 因为要并昼战才有分支，那边的排除表见其注释。
const onDayBattle = (apiPath: string) => (body: any, _post: Record<string, string>, ts: number): Section[] => {
  const battle = parseBattle(apiPath, body, fleetContext, ts)
  if (!state.sortie || !state.sortie.active) {
    // 没有 map/start 的战斗（如中途启动 kanso）也能立一个最小会话
    state.sortie = newSortie({ startTs: ts })
  }
  state.sortie.battle = battle
  state.sortie.battleCount += 1
  // 深海开幕语音的亲历台账：官方在战斗报文里同时给了「哪一艘」与「哪一条音轨」
  //（api_voice_id 就是 kc9998 的档名），那是深海开幕语音**唯一**的官方档名来源。
  // 记在这里而不是 battle.ts：那个文件被几份测试直接 import，不能让它牵进
  // 依赖 electron 的落盘层。纯被动，一次请求都不发。
  recordAbyssVoiceSightings(battle.flavorVoices, ts)
  state.sortie.updatedTs = ts
  collectSunkShips(ts)
  return syncBattleHp(battle) ? ['sortie', 'ships'] : ['sortie']
}

const onNightBattle = (apiPath: string) => (body: any, _post: Record<string, string>, ts: number): Section[] => {
  if (!state.sortie || !state.sortie.active) {
    state.sortie = newSortie({ startTs: ts })
  }
  const prev = state.sortie.battle
  // 只有「这一格刚打完的昼战」才配被夜战包并进去。三种不配：
  // - 已经并过一次夜战（hasNight）；
  // - 本身就是开幕夜战（nightonly）——那是上一场，不是这一包的前半；
  // - 基地防空（baseDefense）：它不是这一格的战斗，只是 map/start、map/next 把进点报文
  //   内嵌的 api_destruction_battle 结算挂在 sortie.battle 上占位（见那两处的注释：
  //   「若该点还有普通战斗，稍后的 battle/each_battle 会自然替换」）。防空点紧接
  //   開幕夜戦（sp_midnight）时若并进去，mergeNight 的 anchor 会拿夜战的 api_f_nowhps
  //   直接改写 prev.fShips——那三列是基地耐久，会被夜战伤害污染。
  //
  // 与 onDayBattle 的对照：那边对防空占位是无条件 `state.sortie.battle = battle` +
  // battleCount += 1（新战斗，替换而非 merge），所以本来就没有这个洞。这里的 else 分支
  // 做的正是同一件事，把 baseDefense 排除掉即等于与它同口径——两个入口对「防空占位还在场时
  // 来了本格的战斗包」必须给出一致的行为。
  if (prev && !prev.hasNight && prev.kind !== 'nightonly' && prev.kind !== 'baseDefense') {
    state.sortie.battle = mergeNight(prev, body, fleetContext, ts)
  } else {
    state.sortie.battle = parseBattle(apiPath, body, fleetContext, ts)
    state.sortie.battleCount += 1
  }
  recordAbyssVoiceSightings(state.sortie.battle?.flavorVoices ?? [], ts)
  state.sortie.updatedTs = ts
  collectSunkShips(ts)
  return syncBattleHp(state.sortie.battle) ? ['sortie', 'ships'] : ['sortie']
}

// ---- 归约器表：path → (api_data, postBody, ts) => 变更的 section 列表 ----

type Reducer = (body: any, postBody: Record<string, string>, ts: number) => Section[]

const onBattleResult = (body: any, _post: Record<string, string>, ts: number): Section[] => {
  const sortie = state.sortie
  if (!sortie || !sortie.battle) return []
  const changedSections = new Set<Section>(['sortie', 'battleReconciliation'])
  const dropShip = body.api_get_ship
  // 入手台词：日文原文照录，只把 <br> 换成换行。台词是作品表达，不机翻。
  const getMessage = dropShipGetMessage(dropShip)
  const exmapSenka = exmapSenkaOf(body)
  const nextMapIds = nextMapIdsOf(body)
  const escapeOffer = escapeOfferOf(body)
  sortie.battle.result = {
    rank: `${body.api_win_rank ?? '?'}`,
    mvp: typeof body.api_mvp === 'number' ? body.api_mvp - 1 : -1,
    mvpCombined: typeof body.api_mvp_combined === 'number' ? body.api_mvp_combined - 1 : -1,
    baseExp: body.api_get_base_exp ?? 0,
    dropShipMstId: dropShip?.api_ship_id ?? null,
    dropShipName: dropShip?.api_ship_name ?? null,
    ...(getMessage ? { dropShipMessage: getMessage } : {}),
    firstClear: body.api_first_clear === 1,
    ...(exmapSenka != null ? { exmapSenka } : {}),
    ...(nextMapIds.length ? { nextMapIds } : {}),
    ...(escapeOffer ? { escapeOffer } : {}),
  }
  sortie.battle.enemyDeckName =
    typeof body.api_enemy_info?.api_deck_name === 'string' &&
    body.api_enemy_info.api_deck_name.trim()
      ? body.api_enemy_info.api_deck_name.trim()
      : undefined
  sortie.battle.enemyFlagshipSunk =
    typeof body.api_destsf === 'number' ? body.api_destsf === 1 : undefined
  const applyShipExp = (
    fleet: 'main' | 'escort',
    gains: unknown,
    lvups: unknown,
  ) => {
    if (!Array.isArray(gains)) return
    const ships = sortie.battle!.fShips
      .filter((ship) => ship.fleet === fleet)
      .sort((left, right) => left.position - right.position)
    const gainOffset = gains.length > 0 && Number(gains[0]) < 0 ? 1 : 0
    const rows = Array.isArray(lvups) ? lvups : []
    for (const [index, ship] of ships.entries()) {
      const gain = gains[index + gainOffset]
      if (typeof gain === 'number' && gain >= 0) ship.expGained = gain
      const row = rows[index]
      if (Array.isArray(row)) {
        if (typeof row[0] === 'number') ship.expTotalAfter = row[0]
        const nextTotal = row.at(-1)
        if (typeof nextTotal === 'number') ship.expNextTotal = nextTotal
        const roster = ship.rosterId == null ? null : state.player.ships[ship.rosterId]
        if (roster && typeof row[0] === 'number') {
          roster.expTotal = row[0]
          roster.expNext =
            typeof nextTotal === 'number' && nextTotal >= row[0]
              ? nextTotal - row[0]
              : 0
          // api_get_exp_lvup 为 [结算后累计, 下一等级阈值]；
          // 每跨一级会在中间多插入一个阈值，故长度超出 2 的部分就是实际升级数。
          roster.lv += Math.max(0, row.length - 2)
          changedSections.add('ships')
        }
      }
    }
  }
  applyShipExp('main', body.api_get_ship_exp, body.api_get_exp_lvup)
  applyShipExp(
    'escort',
    body.api_get_ship_exp_combined,
    body.api_get_exp_lvup_combined,
  )
  const discrepancies = reconcileBattle(sortie.battle, body)
  sortie.battle.discrepancies = discrepancies
  const reconciliation = state.battleReconciliation
  reconciliation.checked += 1
  if (discrepancies.length) {
    reconciliation.mismatched += 1
    reconciliation.records.unshift({
      ts,
      map: sortie.practice ? 0 : mapIdOf(sortie.mapArea, sortie.mapNo),
      cell: sortie.currentCell,
      practice: sortie.practice,
      discrepancies,
    })
    reconciliation.records.length = Math.min(reconciliation.records.length, 100)
    const at = sortie.practice ? '演习' : `${sortie.mapArea}-${sortie.mapNo}`
    for (const item of discrepancies) {
      console.warn(`[kanso] 对账 ${item.kind}: 我们 ${item.ours} 游戏 ${item.game} @ ${at}`)
    }
  }
  const node = sortie.nodes.find((n) => n.cell === sortie.currentCell)
  if (node) node.rank = sortie.battle.result.rank
  // 掉落累计：整轮保持显示（下次出击才清）
  if (dropShip?.api_ship_id) {
    sortie.drops.push({
      cell: sortie.currentCell,
      mstId: dropShip.api_ship_id,
      name: dropShip.api_ship_name ?? `#${dropShip.api_ship_id}`,
    })
  }
  if (patchBasicLevel(body)) changedSections.add('basic')
  const getUseitem = body?.api_get_useitem
  if (
    incrementUseitem(
      Number(getUseitem?.api_useitem_id),
      Number(getUseitem?.api_useitem_count) || 1,
      ts,
    )
  ) {
    changedSections.add('useitems')
  }
  if (incrementUseitem(Number(body?.api_get_exmap_useitem_id), 1, ts)) {
    changedSections.add('useitems')
  }
  if (sortie.practice && state.player.practice && sortie.practiceOpponent?.id) {
    const opponent = state.player.practice.list.find(
      (entry) => entry.id === sortie.practiceOpponent?.id,
    )
    if (opponent && opponent.state === 0) {
      opponent.state = 1
      changedSections.add('practice')
    }
  }
  let gaugeChanged = false
  if (!sortie.practice && sortie.mapArea > 0 && sortie.mapNo > 0) {
    const mapId = mapIdOf(sortie.mapArea, sortie.mapNo)
    const currentNode = sortie.nodes.find((entry) => entry.cell === sortie.currentCell)
    const enemyFlagship = sortie.battle.eShips.find(
      (ship) => ship.fleet === 'main' && ship.position === 0,
    )
    gaugeChanged = setMapGauge(
      mapId,
      patchMapGaugeFromBattleResult(state.mapGauges[mapId], {
        isBoss: sortie.currentCell === sortie.bossCell || currentNode?.eventId === 5,
        firstClear: body.api_first_clear === 1,
        enemyFlagshipSunk:
          typeof body.api_destsf === 'number' ? body.api_destsf === 1 : undefined,
        flagshipHpStart: enemyFlagship?.hpStart ?? null,
        flagshipHpEnd: enemyFlagship?.hpEnd ?? null,
        landingHp: body.api_landing_hp,
      }),
    )
  }
  // 结算点再收一次：昼夜两个报文各自解析时都收过，这里是幂等兜底
  // （中途启动艦素、只赶上 battleresult 的那种场次靠它）。
  collectSunkShips(ts)
  sortie.updatedTs = ts
  if (gaugeChanged) changedSections.add('mapGauges')
  return [...changedSections]
}

/**
 * 玩家真点了「退避」（`api_req_sortie/goback_port` / `api_req_combined_battle/goback_port`）。
 *
 * 报文本身是**空的**，一个字段都没有——谁走了要靠上一场战果里那份 offer
 *（`escapeOffer`：escape = 要退的舰，tow = 陪她走的护卫舰）。所以顺序是：
 * battleresult 记下「游戏问了什么」，这条端点到了才算「玩家答应了」。
 * 只在这里落账，是因为游戏问过而玩家没点的场次一样会发 battleresult。
 *
 * 舰位换在籍 id 的规则收在 shared/sortie-escape（連合第二队偏移、遊撃 7 舰单队都在那）。
 * 到了这里却没有 offer 属于异常：记一条 warn，**不**猜是谁走了。
 */
const onGobackPort = (_body: any, _post: Record<string, string>, ts: number): Section[] => {
  const sortie = state.sortie
  if (!sortie?.active || sortie.practice) return []
  const offer = sortie.battle?.result?.escapeOffer
  if (!offer) {
    console.warn('[kanso] mg: goback_port 到了，但上一场战果里没有退避选项——这一次不记谁走了')
    return []
  }
  const combined = state.player.combinedFlag > 0 && sortie.deckId === 1
  const deckShips = (deckId: number): number[] =>
    state.player.decks.find((deck) => deck.id === deckId)?.ships ?? []
  const fresh = newEscapeEntries(
    offer,
    { main: deckShips(sortie.deckId), escort: combined ? deckShips(2) : [] },
    sortie.escaped,
    { cell: sortie.currentCell, ts },
    (rosterId) => {
      const mstId = state.player.ships[rosterId]?.shipId ?? 0
      return { mstId, name: state.master.ships[mstId]?.name ?? `#${rosterId}` }
    },
  )
  if (!fresh.length) return []
  sortie.escaped.push(...fresh)
  sortie.updatedTs = ts
  return ['sortie']
}

// 换装/补给后游戏只回受影响的那个中队，就地替换
const patchAirBase = (body: any, post: Record<string, string>, ts: number): Section[] => {
  const sections = new Set<Section>()
  if (patchMaterialValues(body)) sections.add('materials')
  const raw = body?.api_plane_info ? body : null
  const areaId = parseInt(`${post?.api_area_id ?? 0}`, 10)
  const rid = parseInt(`${post?.api_base_id ?? 0}`, 10)
  if (!raw || !rid) return [...sections]
  const idx = state.player.airBases.findIndex((b) => b.rid === rid && (!areaId || b.areaId === areaId))
  if (idx < 0) return [...sections]
  // 回体只含 plane_info，其余字段沿用原快照
  const prev = state.player.airBases[idx]
  const planes = [...prev.planes]
  for (const [fallbackIndex, p] of (raw.api_plane_info ?? []).entries()) {
    const declaredIndex = Number(p?.api_squadron_id) - 1
    const planeIndex =
      Number.isInteger(declaredIndex) && declaredIndex >= 0 ? declaredIndex : fallbackIndex
    planes[planeIndex] = {
      slotId: p?.api_slotid ?? 0,
      count: p?.api_count ?? 0,
      maxCount: p?.api_max_count ?? 0,
      state: p?.api_state ?? 0,
      cond: p?.api_cond ?? 1,
    }
  }
  const distanceRaw = raw.api_distance
  const distance =
    typeof distanceRaw === 'object' && distanceRaw
      ? (distanceRaw.api_base ?? 0) + (distanceRaw.api_bonus ?? 0)
      : typeof distanceRaw === 'number'
        ? distanceRaw
        : prev.distance
  state.player.airBases[idx] = {
    ...prev,
    ts,
    distance,
    planes,
  }
  state.player.airBasesTs = ts
  sections.add('airBases')
  return [...sections]
}

// 道具全量表 → 差分入账。持有数本就每次全量下发，记差分即得履历。
// 首次观测（之前没有任何道具记录）不记账：那不是「获得」，是基线。
const applyUseitems = (list: any[], ts: number) => {
  const p = state.player
  const prev = p.useitems
  const hadBaseline = Object.keys(prev).length > 0
  const next: Record<number, number> = {}
  for (const item of list) {
    if (item?.api_id != null) next[item.api_id] = item.api_count ?? 0
  }
  if (hadBaseline) {
    const changes: { id: number; delta: number; total: number }[] = []
    for (const idStr of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      const id = +idStr
      const before = prev[id] ?? 0
      const after = next[id] ?? 0
      if (after !== before) changes.push({ id, delta: after - before, total: after })
    }
    if (changes.length) ledger.logUseitems(ts, changes)
  }
  p.useitems = next
  p.useitemsTs = ts
}

const incrementUseitem = (id: number, delta: number, ts: number): boolean => {
  if (!(id > 0) || !Number.isFinite(delta) || delta === 0) return false
  const before = state.player.useitems[id] ?? 0
  const after = Math.max(0, before + delta)
  if (after === before) return false
  state.player.useitems[id] = after
  ledger.logUseitems(ts, [{ id, delta: after - before, total: after }])
  return true
}

const patchMaterialValues = (body: any): boolean => {
  const current = state.player.materials
  if (!current) return false
  const next = [...current]
  let changed = false
  const apply = (index: number, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || next[index] === value) return
    next[index] = value
    changed = true
  }
  apply(0, body?.api_after_fuel)
  apply(3, body?.api_after_bauxite)
  if (changed) state.player.materials = next
  return changed
}

const patchBasicLevel = (body: any): boolean => {
  const level = Number(body?.api_member_lv)
  if (!state.player.basic || !(level > 0) || state.player.basic.level === level) return false
  state.player.basic.level = level
  return true
}

// 改造消耗的道具：主数据 api_mst_shipupgrade 的计数字段 → api_mst_useitem 编号。
//
// 58 与 100 有实测对账：本机账本 2026-08-28 23:39 那次 Richelieu改 → Richelieu Deux，
// 改造表那一行是 drawing=1、tech=2，账上落的正是 58 −1 与 100 −2。其余四项按主数据
// 自己的道具名对齐，与 shared/kcwiki-upgrade 的别名表逐条同号。
//
// **boilerCount 不在这张表里**：新型高温高圧缶是装备（slotitem 87）不是道具，
// 而且改造后紧跟的 slot_item 全量会把装备账补齐，这里插手只会记重。
const REMODEL_USEITEM_COSTS: [keyof MasterShipUpgrade, number][] = [
  ['drawingCount', 58], // 改装設計図
  ['catapultCount', 65], // 試製甲板カタパルト
  ['reportCount', 78], // 戦闘詳報
  ['aviationMatCount', 77], // 新型航空兵装資材
  ['armsMatCount', 75], // 新型砲熕兵装資材
  ['techCount', 100], // 海外艦最新技術
]

// 「改造前是这一艘」→ 改造表的那一行。主数据按**改造后**形态建索引（同一目标可以有
// 多行，可逆改装的每条来路各一行），而改造请求只给在籍 id，当刻只知道改造前是谁，
// 所以反着找。非 0 的 api_current_ship_id 在主数据里不重号（2026-08-31 快照 359 行
// 全查过），这一头认得唯一——不必等 ship3 说出改造后是谁。
const upgradeRowFrom = (currentShipId: number): MasterShipUpgrade | null => {
  if (!(currentShipId > 0)) return null
  for (const rows of Object.values(state.master.upgrades)) {
    for (const row of rows) if (row.currentShipId === currentShipId) return row
  }
  return null
}

// api_mst_ship 的成长属性是 [初始, 最大]；取初始值（裸值）
const first = (v: unknown): number => (Array.isArray(v) ? (v[0] ?? 0) : 0)
const last = (v: unknown): number =>
  Array.isArray(v) ? (Number(v[1] ?? v[0]) || 0) : 0
const pair = (v: unknown): [number, number] =>
  Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0]
const four = (v: unknown): [number, number, number, number] =>
  Array.isArray(v)
    ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0, Number(v[3]) || 0]
    : [0, 0, 0, 0]

const reducers: Record<string, Reducer> = {
  '/kcsapi/api_start2/getData': (body, _post, ts) => {
    const ships: Record<number, MasterShip> = {}
    for (const s of body.api_mst_ship ?? []) {
      ships[s.api_id] = {
        name: s.api_name,
        yomi: s.api_yomi,
        stype: s.api_stype,
        ctype: s.api_ctype ?? 0,
        sortId: s.api_sort_id ?? 0,
        slotNum: s.api_slot_num ?? 0,
        kai: s.api_getmes === '<br>',
        soku: s.api_soku ?? 0,
        fuelMax: s.api_fuel_max ?? 0,
        bullMax: s.api_bull_max ?? 0,
        maxEq: Array.isArray(s.api_maxeq) ? s.api_maxeq.map((value: unknown) => Number(value) || 0) : [],
        afterShipId: parseInt(s.api_aftershipid ?? '0', 10) || 0,
        afterLv: s.api_afterlv ?? 0,
        // 字段名陷阱：api_afterbull=弹药、api_afterfuel=钢材（见 MasterShip 注释）
        afterAmmo: s.api_afterbull ?? 0,
        afterSteel: s.api_afterfuel ?? 0,
        buildTime: s.api_buildtime ?? 0,
        powup: four(s.api_powup),
        baseHoug: first(s.api_houg),
        baseRaig: first(s.api_raig),
        baseTyku: first(s.api_tyku),
        baseSouk: first(s.api_souk),
        baseTaik: first(s.api_taik),
        baseKaihi: first(s.api_kaih),
        baseTais: first(s.api_tais),
        baseLuck: first(s.api_luck),
        maxHoug: last(s.api_houg),
        maxRaig: last(s.api_raig),
        maxTyku: last(s.api_tyku),
        maxSouk: last(s.api_souk),
        maxTaik: last(s.api_taik),
        maxKaihi: last(s.api_kaih),
        maxTais: last(s.api_tais),
        maxLuck: last(s.api_luck),
      }
    }
    const stypes: Record<number, string> = {}
    for (const t of body.api_mst_stype ?? []) {
      stypes[t.api_id] = t.api_name
    }
    const slotitems: Record<number, MasterSlotitem> = {}
    for (const i of body.api_mst_slotitem ?? []) {
      slotitems[i.api_id] = {
        name: i.api_name,
        iconId: Array.isArray(i.api_type) ? i.api_type[3] : 0,
        type0: Array.isArray(i.api_type) ? i.api_type[0] : 0,
        type2: Array.isArray(i.api_type) ? i.api_type[2] : 0,
        // 航続距離：只有航空装备带这一格，非航空装备整个字段不存在 → 0
        distance: i.api_distance ?? 0,
        tyku: i.api_tyku ?? 0,
        saku: i.api_saku ?? 0,
        baku: i.api_baku ?? 0,
        tais: i.api_tais ?? 0,
        houk: i.api_houk ?? 0,
        houm: i.api_houm ?? 0,
        houg: i.api_houg ?? 0,
        raig: i.api_raig ?? 0,
        souk: i.api_souk ?? 0,
      }
    }
    const missions: Record<number, MasterMission> = {}
    for (const m of body.api_mst_mission ?? []) {
      missions[m.api_id] = {
        name: m.api_name,
        time: m.api_time ?? 0,
        dispNo: m.api_disp_no ?? `${m.api_id}`,
        useFuel: m.api_use_fuel ?? 0,
        useBull: m.api_use_bull ?? 0,
        deckNum: m.api_deck_num ?? 0,
        mapArea: m.api_maparea_id ?? 0,
        difficulty: m.api_difficulty ?? 0,
        winItem1: pair(m.api_win_item1),
        winItem2: pair(m.api_win_item2),
        sampleFleet: Array.isArray(m.api_sample_fleet)
          ? m.api_sample_fleet.map((value: unknown) => Number(value) || 0)
          : [],
        details: typeof m.api_details === 'string' ? m.api_details : '',
      }
    }
    const upgrades: MgState['master']['upgrades'] = {}
    for (const raw of body.api_mst_shipupgrade ?? []) {
      const targetShipId = Number(raw.api_id) || 0
      if (targetShipId <= 0) continue
      // 同目标多行（可逆改装的每条来路一行），全部保留——收成单行会把素材挂错前置
      ;(upgrades[targetShipId] ??= []).push({
        targetShipId,
        currentShipId: Number(raw.api_current_ship_id) || 0,
        originalShipId: Number(raw.api_original_ship_id) || 0,
        stage: Number(raw.api_upgrade_level) || 0,
        drawingCount: Number(raw.api_drawing_count) || 0,
        catapultCount: Number(raw.api_catapult_count) || 0,
        reportCount: Number(raw.api_report_count) || 0,
        aviationMatCount: Number(raw.api_aviation_mat_count) || 0,
        armsMatCount: Number(raw.api_arms_mat_count) || 0,
        techCount: Number(raw.api_tech_count) || 0,
        boilerCount: Number(raw.api_boiler_count) || 0,
      })
    }
    const bgms: Record<number, string> = {}
    for (const raw of body.api_mst_bgm ?? []) {
      const id = Number(raw.api_id) || 0
      const name = typeof raw.api_name === 'string' ? raw.api_name.trim() : ''
      if (id > 0 && name && name !== '-') bgms[id] = name
    }
    state.master = { ready: true, ships, stypes, slotitems, missions, upgrades, bgms }
    // 活动窗口侦测：活动海域只在活动期间存在于主数据里，它进出 api_start2 的时刻
    // 就是我们被动能观测到的活动开启/关闭。判定本身在 shared/event-area.ts
    // （铭、铎、鉴、锱同引一份）。
    const areas: any[] = body.api_mst_maparea ?? []
    const seen = new Set<number>()
    for (const areaId of detectEventAreas(areas).eventAreaIds) {
      if (areaId) seen.add(areaId)
    }
    for (const areaId of seen) {
      const prev = state.eventAreas[areaId]
      if (prev) {
        prev.lastSeenTs = ts
        prev.closed = false // 又出现了（同 id 复用极罕见，但不硬判死）
      } else {
        state.eventAreas[areaId] = { firstSeenTs: ts, lastSeenTs: ts, closed: false }
        console.log(`[kanso] mg: 侦测到活动海域 ${areaId} 上线（首次观测 ${new Date(ts).toLocaleString()}）`)
      }
      const period = state.eventAreas[areaId]
      const area = areas.find((candidate) => Number(candidate?.api_id) === areaId)
      ledger.observeEventMapCatalog(
        areaId,
        `${area?.api_name ?? `活动海域 ${areaId}`}`,
        period.firstSeenTs,
        ts,
        body.api_mst_mapinfo ?? [],
      )
    }
    for (const [idStr, period] of Object.entries(state.eventAreas)) {
      if (!seen.has(+idStr) && !period.closed) {
        period.closed = true
        // 关闭上界取「首次确认已消失」的时刻。若沿用上一次 start2 中仍存在的时刻，
        // 两次登录之间发生的最后几天出击会被活动归档错误排除。
        period.lastSeenTs = ts
        ledger.closeEventMapCatalog(+idStr, ts)
        console.log(`[kanso] mg: 活动海域 ${idStr} 已从主数据消失（判定活动结束）`)
        // 就地结账：events/material_log 是可清理的滚动表，活动约一个月，
        // 此刻数据还齐；等它们被清掉就再也算不回来了。归档表本身永久保留。
        ledger.archiveEvent(+idStr, period.firstSeenTs, period.lastSeenTs)
      }
    }
    return ['master', 'eventAreas']
  },

  '/kcsapi/api_port/port': (body, _post, ts) => {
    const p = state.player
    if (body.api_basic) {
      p.basic = {
        nickname: body.api_basic.api_nickname,
        level: body.api_basic.api_level,
        rank: body.api_basic.api_rank,
        maxShips: body.api_basic.api_max_chara ?? 0,
        maxSlotitems: body.api_basic.api_max_slotitem ?? 0,
        furnitureCoins:
          typeof body.api_basic.api_fcoin === 'number' ? body.api_basic.api_fcoin : undefined,
        furnitureLayout: Array.isArray(body.api_basic.api_furniture)
          ? body.api_basic.api_furniture.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
          : undefined,
        // 同时进行任务上限在 port **顶层**，不在 api_basic 里
        parallelQuestCount:
          typeof body.api_parallel_quest_count === 'number' && body.api_parallel_quest_count > 0
            ? body.api_parallel_quest_count
            : p.basic?.parallelQuestCount,
        // 甲章：实测 port 里可能给 0（不下发真值），只信 >0；playtime/max_kagu
        // 同样全 0，干脆不收——展示假 0 比不展示更糟
        medals:
          typeof body.api_basic.api_medals === 'number' && body.api_basic.api_medals > 0
            ? body.api_basic.api_medals
            : p.basic?.medals,
        experience:
          typeof body.api_basic.api_experience === 'number'
            ? body.api_basic.api_experience
            : undefined,
      }
      // 生涯战绩简版（2026-08-17 用户拍板）：每次回港都带，胜负计数与时间戳
      // 实时刷新。port 报文本身携带的字段一并跟着刷（船位/槽位上限在 api_basic，
      // 舰数即 api_ship 全量名册——氪金扩容后战绩页快照不该继续显示旧上限）；
      // 只有战绩页才有的字段（资源上限/装备计数/整备等级）保留旧值：装备计数
      // 不拿本机装备表折算——战绩页 api_slotitem[0] 是否含免计装备未验证过。
      // rate 自算成百分数，与 record 端点归一后的口径一致。
      const rawBasic = body.api_basic
      if (typeof rawBasic.api_st_win === 'number') {
        const prev = p.record
        const pct = (win: number, lose: number): number | null =>
          win + lose > 0 ? (win / (win + lose)) * 100 : null
        const cap = (value: unknown): number | null => {
          const parsed = Number(value)
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null
        }
        const stWin = rawBasic.api_st_win
        const stLose = Number(rawBasic.api_st_lose) || 0
        const ptWin = Number(rawBasic.api_pt_win) || 0
        const ptLose = Number(rawBasic.api_pt_lose) || 0
        const msCount = Number(rawBasic.api_ms_count) || 0
        const msSuccess = Number(rawBasic.api_ms_success) || 0
        p.record = {
          ts,
          sortieWin: stWin,
          sortieLose: stLose,
          sortieRate: pct(stWin, stLose),
          practiceWin: ptWin,
          practiceLose: ptLose,
          practiceRate: pct(ptWin, ptLose),
          missionCount: msCount,
          missionSuccess: msSuccess,
          missionRate: msCount > 0 ? (msSuccess / msCount) * 100 : null,
          materialMax: prev?.materialMax ?? null,
          shipCount: Array.isArray(body.api_ship) ? body.api_ship.length : prev?.shipCount ?? null,
          shipCapacity: cap(rawBasic.api_max_chara) ?? prev?.shipCapacity ?? null,
          slotitemCount: prev?.slotitemCount ?? null,
          slotitemCapacity: cap(rawBasic.api_max_slotitem) ?? prev?.slotitemCapacity ?? null,
          airBaseMaintenance: prev?.airBaseMaintenance ?? [],
        }
      }
    }
    p.materials = toMaterials(body.api_material, p.materials)
    // 母港滚动消息（游戏自报的「最近发生」，日文原文照存）
    if (Array.isArray(body.api_log)) {
      p.portLogs = body.api_log
        .filter((entry: any) => typeof entry?.api_message === 'string' && entry.api_message)
        .map((entry: any) => ({ type: Number(entry.api_type) || 0, message: entry.api_message }))
    }
    p.combinedFlag = body.api_combined_flag ?? 0
    // 泊地修理落账探测的取样点：必须赶在下面覆盖 ships/decks/ndocks **之前**。
    // 判据要用**回港前**的那套编成与入渠状态——正在计时的是它，不是刚下发的新一份。
    const hpBefore = new Map<number, number>()
    for (const was of Object.values(p.ships)) hpBefore.set(was.id, was.nowhp)
    const dockedBefore = new Set(p.ndocks.filter((d) => d.shipId > 0).map((d) => d.shipId))
    const decksBefore = p.decks.map((d) => ({ id: d.id, ships: [...d.ships] }))
    p.ships = {}
    applyShipUpdates(body.api_ship)
    applyDeckUpdates(body.api_deck_port, true)
    p.ndocks = (body.api_ndock ?? []).map(toNdock)
    p.lastPortTs = ts
    // 回港前后耐久涨了 → 上一段停泊已经结账，计时从这一刻重新起算（判据与理由都在
    // shared/berth-repair 的 `berthBankedDecks`）。这同时就是「估算归零重算」本身：
    // 锚点一挪，估算自然从 0 开始，不需要谁去记得清它。
    //
    // 高速修復材走 nyukyo/speedchange，那条 reducer 当场就把耐久改了，
    // 到这里比不出差值，因此也不会被误认成落账。
    const hpAfter = new Map<number, number>()
    for (const now of Object.values(p.ships)) hpAfter.set(now.id, now.nowhp)
    for (const deckId of berthBankedDecks(decksBefore, hpBefore, dockedBefore, hpAfter)) {
      touchBerth(deckId, ts)
    }
    const sections: Section[] = ['basic', 'materials', 'ships', 'decks', 'ndocks', 'record', 'portLogs']
    // 本趟最后一战没有 ship_deck 跟在后面（撤退与归港这两支游戏都不发），
    // 这里是它唯一的对账机会。不补喊大破：舰队已经到家，announce 给 false。
    sections.push(...runSortieHpAudit(ts, false))
    // 回港 = 出击/演习会话结束（保留最近一场供镝复盘，标记非现役）
    if (state.sortie?.active) {
      state.sortie.active = false
      state.sortie.updatedTs = ts
      sections.push('sortie')
    }
    return sections
  },

  '/kcsapi/api_get_member/basic': (body) => {
    if (!body || typeof body.api_nickname !== 'string') return []
    const prev = state.player.basic
    state.player.basic = {
      nickname: body.api_nickname,
      level: body.api_level,
      rank: body.api_rank,
      maxShips: body.api_max_chara ?? 0,
      maxSlotitems: body.api_max_slotitem ?? 0,
      furnitureCoins: typeof body.api_fcoin === 'number' ? body.api_fcoin : undefined,
      // 这份报文没有的字段沿用旧值，别把 port 学来的整体冲掉
      furnitureLayout: prev?.furnitureLayout,
      parallelQuestCount: prev?.parallelQuestCount,
      medals:
        typeof body.api_medals === 'number' && body.api_medals > 0
          ? body.api_medals
          : prev?.medals,
      experience:
        typeof body.api_experience === 'number' ? body.api_experience : prev?.experience,
    }
    return ['basic']
  },

  // 基地航空队按海域分别请求。保留其他海域的最近快照，才能同时统计 6/7 图与活动陆航。
  '/kcsapi/api_get_member/base_air_corps': (body, post, ts) => {
    if (!Array.isArray(body)) return []
    const requestedArea = parseInt(`${post?.api_area_id ?? 0}`, 10) || 0
    state.player.airBases = mergeAirBases(state.player.airBases, body, requestedArea, ts)
    state.player.airBasesTs = ts
    return ['airBases']
  },
  // 换装/改行动/补给：游戏只回单个中队，就地替换那一条，不整表作废
  '/kcsapi/api_req_air_corps/set_plane': (body, post, ts) => patchAirBase(body, post, ts),
  '/kcsapi/api_req_air_corps/supply': (body, post, ts) => patchAirBase(body, post, ts),
  '/kcsapi/api_req_air_corps/change_deployment_base': (body, post, ts) => {
    if (!Array.isArray(body?.api_base_items)) return []
    const sections = new Set<Section>()
    for (const raw of body.api_base_items) {
      const rid = Number(raw?.api_rid)
      if (!(rid > 0)) continue
      for (const section of patchAirBase(
        raw,
        { ...post, api_base_id: `${rid}` },
        ts,
      )) {
        sections.add(section)
      }
    }
    return [...sections]
  },
  '/kcsapi/api_req_air_corps/change_name': (_body, post, ts) => {
    const areaId = parseInt(`${post.api_area_id ?? 0}`, 10)
    const rid = parseInt(`${post.api_base_id ?? 0}`, 10)
    const name = `${post.api_name ?? ''}`
    const squad = state.player.airBases.find(
      (entry) => entry.rid === rid && (!areaId || entry.areaId === areaId),
    )
    if (!squad || squad.name === name) return []
    squad.name = name
    squad.ts = ts
    state.player.airBasesTs = ts
    return ['airBases']
  },
  '/kcsapi/api_req_air_corps/set_action': (_body, post, ts) => {
    // set_action 不回中队体，只回 ok；行动类型从请求参数取
    const rids = `${post?.api_base_id ?? ''}`.split(',').map((x) => parseInt(x, 10))
    const kinds = `${post?.api_action_kind ?? ''}`.split(',').map((x) => parseInt(x, 10))
    const areaId = parseInt(`${post?.api_area_id ?? 0}`, 10)
    let hit = false
    rids.forEach((rid, i) => {
      const squad = state.player.airBases.find((b) => b.rid === rid && (!areaId || b.areaId === areaId))
      if (squad && !Number.isNaN(kinds[i])) {
        squad.actionKind = kinds[i]
        squad.ts = ts
        hit = true
      }
    })
    if (!hit) return []
    state.player.airBasesTs = ts
    return ['airBases']
  },

  // 游戏内编成/解除联合舰队：不等回港就更新，锐的联合状态条即时跟手
  '/kcsapi/api_req_hensei/combined': (body, post) => {
    state.player.combinedFlag = combinedFleetTypeFromMutation(
      state.player.combinedFlag,
      body?.api_combined,
      post?.api_combined_type,
    )
    return ['decks']
  },

  /**
   * 友军舰队要請开关（活动海域限定）。响应体只有 `api_result: 1`，**状态全在 post 里**，
   * 两个参数都是数字字符串（本机账本 2026-08-26 的两条实测：
   * 18:39 `api_request_flag=1 api_request_type=1`、18:47 `api_request_flag=1 api_request_type=0`）。
   *
   * 字段语义与「缺席 = 未知」的纪律写在 shared/mg-types 的 `friendlyRequest` 头注上。
   * 这里只在参数真能转成数的时候写账：转不出来就什么都不动，宁可留着「未知」。
   */
  '/kcsapi/api_req_member/set_friendly_request': (_body, post) => {
    const flag = parseInt(`${post?.api_request_flag ?? ''}`, 10)
    const type = parseInt(`${post?.api_request_type ?? ''}`, 10)
    if (Number.isNaN(flag) || Number.isNaN(type)) return []
    state.player.friendlyRequest = { flag, type }
    return ['friendlyRequest']
  },

  '/kcsapi/api_get_member/require_info': (body, _post, ts) => {
    const p = state.player
    p.kdocks = (body.api_kdock ?? []).map(toKdock)
    p.slotitems = toSlotitemMap(body.api_slot_item)
    if (Array.isArray(body.api_useitem)) {
      applyUseitems(body.api_useitem, ts)
    }
    const sections: Section[] = ['kdocks', 'slotitems', 'useitems']
    // 持有家具全列表随登录下发；缺席（异常/未来字段变动）时保持原值，不清空
    const furnitures = toFurnitureIds(body.api_furniture)
    if (furnitures) {
      p.furnitures = furnitures
      sections.push('furnitures')
    }
    return sections
  },

  // 进家具屋/更换家具时游戏重新下发完整持有列表——买了新家具不用等下次登录。
  // body 按 require_info 的 api_furniture 同构（数组直达）处理，形状对不上就不动账。
  '/kcsapi/api_get_member/furniture': (body) => {
    const furnitures = toFurnitureIds(Array.isArray(body) ? body : body?.api_furniture)
    if (!furnitures) return []
    state.player.furnitures = furnitures
    return ['furnitures']
  },

  '/kcsapi/api_get_member/useitem': (body, _post, ts) => {
    if (!Array.isArray(body)) return []
    applyUseitems(body, ts)
    return ['useitems']
  },

  '/kcsapi/api_get_member/slot_item': (body) => {
    state.player.slotitems = toSlotitemMap(body)
    return ['slotitems']
  },

  '/kcsapi/api_get_member/material': (body) => {
    state.player.materials = toMaterials(body, state.player.materials)
    return ['materials']
  },

  '/kcsapi/api_get_member/ndock': (body, _post, ts) => {
    state.player.ndocks = (body ?? []).map(toNdock)
    const sections: Section[] = ['ndocks']
    if (pendingNdockStart) {
      const { dockId, shipId } = pendingNdockStart
      const dock = state.player.ndocks.find((entry) => entry.id === dockId)
      const ship = state.player.ships[shipId]
      if (ts - pendingNdockStart.ts <= 10_000 && dock?.shipId === 0 && ship) {
        ship.nowhp = ship.maxhp
        ship.ndockTime = 0
        if (ship.cond < 40) ship.cond = 40
        sections.push('ships')
      }
      pendingNdockStart = null
    }
    return sections
  },

  '/kcsapi/api_get_member/kdock': (body) => {
    state.player.kdocks = (body ?? []).map(toKdock)
    return ['kdocks']
  },

  '/kcsapi/api_get_member/deck': (body) => {
    applyDeckUpdates(body, true)
    return ['decks']
  },

  // 出击途中这一条是**进击动作自己带出来的**权威刷新（时序实测见 shared/sortie-hp-audit）。
  // 权威耐久盖上来的同时对一次账：解析漏报的大破就在这里被抓出来。
  '/kcsapi/api_get_member/ship_deck': (body, _post, ts) => {
    applyShipUpdates(body.api_ship_data)
    applyDeckUpdates(body.api_deck_data, false)
    return ['ships', 'decks', ...runSortieHpAudit(ts, true)]
  },

  '/kcsapi/api_get_member/ship2': (body) => {
    if (!Array.isArray(body)) return []
    applyShipUpdates(body)
    return ['ships']
  },

  '/kcsapi/api_get_member/ship3': (body) => {
    applyShipUpdates(body.api_ship_data)
    applyDeckUpdates(body.api_deck_data, true)
    return ['ships', 'decks']
  },

  // 编成变更。语义对齐游戏行为：-1 撤下该位（后续补位），-2 旗舰以外全撤，
  // 目标舰已在其他位置时对调
  '/kcsapi/api_req_hensei/change': (_body, post, ts) => {
    const deckId = parseInt(post.api_id, 10)
    const shipIdx = parseInt(post.api_ship_idx, 10)
    const shipId = parseInt(post.api_ship_id, 10)
    const deck = state.player.decks.find((d) => d.id === deckId)
    if (!deck || Number.isNaN(shipIdx)) return []

    if (shipId === -2) {
      deck.ships = deck.ships.map((s, i) => (i === 0 ? s : -1))
      // 随伴艦一括解除**不**拨计时（理由见 touchBerth 的注）
    } else if (shipId === -1) {
      deck.ships.splice(shipIdx, 1)
      deck.ships.push(-1)
      touchBerth(deck.id, ts)
    } else {
      // 若目标舰已在任一舰队，则与当前位置对调
      const prev = deck.ships[shipIdx]
      for (const d of state.player.decks) {
        const at = d.ships.indexOf(shipId)
        if (at >= 0) {
          d.ships[at] = prev
          // 对调动了两支队的编成，两边的计时都得拨
          if (d.id !== deck.id) touchBerth(d.id, ts)
        }
      }
      deck.ships[shipIdx] = shipId
      touchBerth(deck.id, ts)
    }
    return ['decks']
  },

  '/kcsapi/api_req_hensei/preset_select': (body) => {
    if (!body || !(Number(body.api_id) > 0) || !Array.isArray(body.api_ship)) return []
    applyDeckUpdates([body], false)
    return ['decks']
  },

  '/kcsapi/api_req_member/updatedeckname': (_body, post) => {
    const deck = state.player.decks.find((entry) => entry.id === Number(post.api_deck_id))
    const name = `${post.api_name ?? ''}`
    if (!deck || !name || deck.name === name) return []
    deck.name = name
    return ['decks']
  },

  '/kcsapi/api_req_hensei/lock': (body, post) => {
    const ship = state.player.ships[Number(post.api_ship_id)]
    if (!ship || typeof body?.api_locked !== 'number') return []
    const locked = body.api_locked === 1
    if (ship.locked === locked) return []
    ship.locked = locked
    return ['ships']
  },

  '/kcsapi/api_req_kaisou/lock': (body, post) =>
    applySlotitemInventoryMutation(
      state.player.slotitems,
      '/kcsapi/api_req_kaisou/lock',
      body,
      post,
    )
      ? ['slotitems']
      : [],

  '/kcsapi/api_req_kaisou/slot_exchange_index': (body) => {
    const raw = body?.api_ship_data
    if (!raw?.api_id) return []
    state.player.ships[raw.api_id] = toShip(raw)
    return ['ships']
  },

  '/kcsapi/api_req_kaisou/slot_deprive': (body) => {
    const raw = body?.api_ship_data
    const ships = [raw?.api_set_ship, raw?.api_unset_ship].filter(
      (entry) => entry?.api_id,
    )
    if (!ships.length) return []
    applyShipUpdates(ships)
    return ['ships']
  },

  // ---- 换装三条（slotset / slotset_ex / unsetslot_all）----
  //
  // 这三条的响应体**只有 api_result**，一个字的舰船数据都没有（账本实样 941 /
  // 88 / 56 份，无一例外），所以要变的状态只能照 POST 参数自己推。
  //
  // 参数名与编号基逐个对着账本实样核过：
  // · `api_id` 是**在籍 id**；
  // · `api_slot_idx` 是常规格下标，**0-based**（实样取值 0..4）；
  // · `api_item_id` 是装备**实例 id**，**-1 = 把这一格卸空**
  //   （slotset 18 份、slotset_ex 3 份 -1 实样）。
  //
  // 为什么明明有 ship3 兜底还要补：游戏每次换装后**自己会再请求一次**
  // `api_get_member/ship3`，账本里 941/941 紧跟其后、且 200/200 请求的正是刚动过
  // 的那艘舰，间隔 ≤731ms——所以这个缺口平时只漏不到一秒，不是什么长期错账。
  // 补它是为了别把账面正确性挂在「客户端一定会补那一枪」上：那一枪掉了
  // （断线、艦素中途启动、报文丢包）就再没有第二个人来纠。

  '/kcsapi/api_req_kaisou/slotset': (_body, post) => {
    const ship = state.player.ships[Number(post.api_id)]
    const idx = Number(post.api_slot_idx)
    if (!ship || !Array.isArray(ship.slot)) return []
    if (!Number.isInteger(idx) || idx < 0 || idx >= ship.slot.length) return []
    const raw = Number(post.api_item_id)
    const next = Number.isInteger(raw) && raw > 0 ? raw : -1
    let changed = false
    // 一件实例只能待在一个地方。装上来之前先把它从这艘舰的别处摘掉，否则同一件
    // 会在两格里各算一次——泊地修理的覆盖数、制空、对空 CI 数的都是「格数」。
    if (next > 0) {
      for (let i = 0; i < ship.slot.length; i += 1) {
        if (i !== idx && ship.slot[i] === next) {
          ship.slot[i] = -1
          changed = true
        }
      }
      if (ship.slotEx === next) {
        ship.slotEx = -1
        changed = true
      }
    }
    if (ship.slot[idx] !== next) {
      ship.slot[idx] = next
      changed = true
    }
    return changed ? ['ships'] : []
  },

  '/kcsapi/api_req_kaisou/slotset_ex': (_body, post) => {
    const ship = state.player.ships[Number(post.api_id)]
    if (!ship) return []
    const raw = Number(post.api_item_id)
    // 补强増設格的三种取值与 open_exslot 同一套：0 = 没开过，-1 = 开了但空着，
    // 正数 = 那件实例。所以「卸下」落 **-1**，落 0 等于把开好的格子又关上。
    const next = Number.isInteger(raw) && raw > 0 ? raw : -1
    let changed = false
    if (next > 0 && Array.isArray(ship.slot)) {
      for (let i = 0; i < ship.slot.length; i += 1) {
        if (ship.slot[i] === next) {
          ship.slot[i] = -1
          changed = true
        }
      }
    }
    if (ship.slotEx !== next) {
      ship.slotEx = next
      changed = true
    }
    return changed ? ['ships'] : []
  },

  // 一括解除**只清常规格**：补强増設格在游戏里是单独一颗按钮，而这条的响应体同样
  // 什么都不带（56 份实样），账上没有任何东西能证明它跟着清。不知道就不动——
  // 多清一格会把玩家真装着的东西从账面上抹掉，比漏清难查得多。
  '/kcsapi/api_req_kaisou/unsetslot_all': (_body, post) => {
    const ship = state.player.ships[Number(post.api_id)]
    if (!ship || !Array.isArray(ship.slot)) return []
    let changed = false
    for (let i = 0; i < ship.slot.length; i += 1) {
      if (ship.slot[i] !== -1) {
        ship.slot[i] = -1
        changed = true
      }
    }
    return changed ? ['ships'] : []
  },

  '/kcsapi/api_req_kaisou/marriage': (body, _post, ts) => {
    if (!body?.api_id) return []
    state.player.ships[body.api_id] = toShip(body)
    const sections: Section[] = ['ships']
    // ケッコンカッコカリ消耗的是游戏主数据 useitem **55**「書類一式＆指輪」。
    // （原先写的 20 在主数据里是空条目：自扣一直空转，消耗只能等下一次全量作差。）
    if (incrementUseitem(55, -1, ts)) sections.push('useitems')
    return sections
  },

  '/kcsapi/api_req_kaisou/open_exslot': (_body, post, ts) => {
    const ship = state.player.ships[Number(post.api_id)]
    if (!ship || ship.slotEx !== 0) return []
    ship.slotEx = -1
    const sections: Section[] = ['ships']
    // api_mst_useitem **64**「補強増設」每次开槽消耗一个。
    // （原先写的 26 在主数据里是空条目，自扣空转：2026-08-31 13:43 连开五格，
    // 账上一笔没有，直到 13:52 的全量下发才一口气差出 −5——原因也就记到了那一刻。
    // 64 这个号在 shared/kcwiki-upgrade 与 qn 的道具别名表里本来就是对的。）
    if (incrementUseitem(64, -1, ts)) sections.push('useitems')
    return sections
  },

  // 格納庫増設（api_mst_useitem 105，2026-06-26 实装）：逐槽把舰载机搭载上限抬高。
  //
  // 与开增设槽 / 结婚 / 泊地修理同族——报文里**既没有 api_material 也没有 useitem
  // 字段**，消耗全靠按端点自扣。不扣的后果是实测过的：道具走通用报酬路径记了 +1，
  // 消耗没人扣，回顾/史的道具数就一直停在消耗前。
  //
  // 报文形状（账本 events 22606 实样）：
  // - post `api_ship_id` 是**在籍 id**（游戏这个参数名起得有歧义，不是图鉴 mstId）；
  // - post `api_slot_pos` 是格位，**1-based**（实测 "4" = 第 4 格 = 数组下标 3）；
  // - 响应 `api_onslot_max` 是这艘舰**全部常规槽的新上限数组**，不是增量。
  '/kcsapi/api_req_kaisou/hangar_expand': (body, post, ts) => {
    const sections: Section[] = []
    const ship = state.player.ships[Number(post.api_ship_id)]
    const next = body?.api_onslot_max
    if (ship && Array.isArray(next)) {
      ship.onslotMax = next.map((value: unknown) => Number(value) || 0)
      sections.push('ships')
    }
    // 认不出是哪一艘也照扣：道具确实少了一个，这件事与「上限落在谁身上」无关。
    if (incrementUseitem(105, -1, ts)) sections.push('useitems')
    return sections
  },

  // 改造。响应体**只有 api_result**：舰体状态靠紧跟的 ship3 恢复，**道具没有对应的
  // 恢复**——持有数只在全量下发（api_get_member/useitem）时作差落账，于是消耗要等到
  // 下一次全量才被差出来。而「变动原因」是按落账时刻附近的操作推的（史那一列），
  // 于是那笔消耗记到了当刻碰巧在做的事上：2026-08-28 23:39 那次改造的改装設計図与
  // 海外艦最新技術，落在 23:44:51 的远征归来那一刻；08-20 铃谷改二的图纸更是隔了
  // 两小时零十五分。所以这条与开增设槽 / 格納庫増設同族：按端点自扣。
  //
  // 不会记重：自扣当场就把 state 里的持有数改成扣后的数，下一次全量作差是拿
  // state 当基准的（applyUseitems 的 prev），看到的是同一个数，不再产生第二笔。
  //
  // 认不出这艘舰、或主数据里查不到这次改造的行（不要道具的普通改造大多没有行），
  // 就一个字不动——不知道消耗几个，就不猜。
  '/kcsapi/api_req_kaisou/remodeling': (_body, post, ts) => {
    const ship = state.player.ships[Number(post.api_id)]
    const upgrade = ship ? upgradeRowFrom(ship.shipId) : null
    if (!upgrade) return []
    let changed = false
    for (const [field, itemId] of REMODEL_USEITEM_COSTS) {
      const count = upgrade[field]
      if (count > 0 && incrementUseitem(itemId, -count, ts)) changed = true
    }
    return changed ? ['useitems'] : []
  },

  // 緊急泊地修理：明石改 / 朝日改 / 秋津洲改 在泊地格上给舰队回耐久。
  //
  // 报文只给「修完之后的整支舰队」（連合两队都在 api_ship_data 里），
  // **既没有 api_material 也没有 useitem** —— 消耗全靠自己扣，否则资源账在
  // 两次回港之间会一路偏高。所以先把被修舰当前的耐久记下来，覆盖之后再作差：
  // 回复耐久合计 ×3 = 钢材，另加緊急修理資材（useitem 91）一个。
  //
  // 差值算不出来（账上还没有那艘舰：中途启动艦素）就**只扣资材、不扣钢材**——
  // 资材是每次固定一个，那件事不需要知道回了多少；钢材需要，不知道就不猜。
  '/kcsapi/api_req_map/anchorage_repair': (body, _post, ts) => {
    if (!Array.isArray(body?.api_ship_data)) return []
    const repaired = Array.isArray(body?.api_repair_ships)
      ? body.api_repair_ships.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
      : []
    const before = new Map<number, number>()
    for (const id of repaired) {
      const ship = state.player.ships[id]
      if (ship) before.set(id, ship.nowhp)
    }
    applyShipUpdates(body.api_ship_data)
    const sections: Section[] = ['ships']
    if (!repaired.length) return sections
    const entries: SortieAnchorageRepair['ships'] = []
    let healed = 0
    let complete = true
    for (const id of repaired) {
      const ship = state.player.ships[id]
      const start = before.get(id)
      if (!ship || start == null) {
        complete = false
        continue
      }
      healed += Math.max(0, ship.nowhp - start)
      entries.push({
        rosterId: id,
        mstId: ship.shipId,
        name: state.master.ships[ship.shipId]?.name ?? `#${ship.shipId}`,
        before: start,
        after: ship.nowhp,
      })
    }
    // 消耗：资材恒扣一个；钢材只在**每一艘都算得出**回复量时才扣。
    const steel = complete && healed > 0 ? healed * 3 : 0
    if (steel > 0 && subtractMaterials([[2, steel]])) sections.push('materials')
    if (incrementUseitem(91, -1, ts)) sections.push('useitems')
    const sortie = state.sortie
    if (sortie?.active && !sortie.practice) {
      sortie.anchorageRepairs.push({
        cell: sortie.currentCell,
        ts,
        repairerMst: Number(body?.api_used_ship) || 0,
        ships: entries,
        steel,
      })
      sortie.updatedTs = ts
      sections.push('sortie')
    }
    return sections
  },

  '/kcsapi/api_req_hokyu/charge': (body) => {
    for (const raw of body.api_ship ?? []) {
      const ship = state.player.ships[raw.api_id]
      if (ship) {
        ship.fuel = raw.api_fuel
        ship.bull = raw.api_bull
        if (Array.isArray(raw.api_onslot)) ship.onslot = raw.api_onslot
      }
    }
    state.player.materials = toMaterials(body.api_material, state.player.materials)
    return ['ships', 'materials']
  },

  // 入渠开始：扣入渠费（舰娘自带 [燃,钢] 报价）；高速修复再扣桶并立即满血
  '/kcsapi/api_req_nyukyo/start': (_body, post, ts) => {
    const sections: Section[] = []
    const ship = state.player.ships[parseInt(post.api_ship_id, 10)]
    const highspeed = parseInt(post.api_highspeed, 10) === 1
    const costs: [number, number][] = ship ? [[0, ship.ndockItem[0]], [2, ship.ndockItem[1]]] : []
    if (highspeed) costs.push([5, 1])
    if (costs.length && subtractMaterials(costs)) sections.push('materials')
    if (highspeed && ship) {
      ship.nowhp = ship.maxhp
      ship.ndockTime = 0
      if (ship.cond < 40) ship.cond = 40
      sections.push('ships')
    } else if (ship) {
      const dockId = parseInt(post.api_ndock_id, 10)
      if (dockId > 0) pendingNdockStart = { dockId, shipId: ship.id, ts }
    }
    return sections
  },

  // ---- 分类记账相关：让资源在两次回港之间也保持准确 ----

  '/kcsapi/api_req_mission/start': (body, post) => {
    const deck = state.player.decks.find((entry) => entry.id === Number(post.api_deck_id))
    const missionId = Number(post.api_mission ?? post.api_mission_id)
    const completeTime = Number(body?.api_complatetime)
    if (!deck || !(missionId > 0) || !(completeTime > 0)) return []
    deck.mission = [1, missionId, completeTime, 0]
    return ['decks']
  },

  '/kcsapi/api_req_mission/return_instruction': (body, post) => {
    const deck = state.player.decks.find((entry) => entry.id === Number(post.api_deck_id))
    if (!deck || !Array.isArray(body?.api_mission)) return []
    deck.mission = [...body.api_mission]
    return ['decks']
  },

  // 远征结算：收益、舰队返港、舰娘经验与提督等级都由同一响应给出。
  '/kcsapi/api_req_mission/result': (body, post, ts) => {
    const sections = new Set<Section>()
    if (Array.isArray(body.api_get_material) && addMaterials4(body.api_get_material)) {
      sections.add('materials')
    }
    const deck = state.player.decks.find((entry) => entry.id === Number(post.api_deck_id))
    if (deck) {
      deck.mission = [0, 0, 0, 0]
      sections.add('decks')
    }
    const rosterIds = Array.isArray(body.api_ship_id)
      ? body.api_ship_id.map(Number).filter((id: number) => id > 0)
      : []
    const expRows = Array.isArray(body.api_get_exp_lvup) ? body.api_get_exp_lvup : []
    for (const [index, rosterId] of rosterIds.entries()) {
      const ship = state.player.ships[rosterId]
      const row = expRows[index]
      if (!ship || !Array.isArray(row) || typeof row[0] !== 'number') continue
      const nextTotal = row.at(-1)
      ship.expTotal = row[0]
      ship.expNext =
        typeof nextTotal === 'number' && nextTotal >= row[0] ? nextTotal - row[0] : 0
      ship.lv += Math.max(0, row.length - 2)
      sections.add('ships')
    }
    for (const reward of [body.api_get_item1, body.api_get_item2]) {
      if (
        incrementUseitem(
          Number(reward?.api_useitem_id),
          Number(reward?.api_useitem_count) || 0,
          ts,
        )
      ) {
        sections.add('useitems')
      }
    }
    if (patchBasicLevel(body)) sections.add('basic')
    return [...sections]
  },

  // 任务交付：报酬燃弹钢铝 + 从任务列表移除
  '/kcsapi/api_req_quest/clearitemget': (body, post, ts) => {
    const sections: Section[] = []
    if (addMaterials4(body.api_material)) sections.push('materials')
    // 任务响应把桶/开发资材/螺丝等放在 api_bounus(type=1)，
    // 不在上面的四项 api_material 里；按官方 material id 1..8 直接累加。
    const bonuses = body.api_bounus ?? body.api_bonus
    if (state.player.materials && Array.isArray(bonuses)) {
      const next = [...state.player.materials]
      let changed = false
      for (const bonus of bonuses) {
        if (bonus?.api_type !== 1) continue
        const index = Number(bonus?.api_item?.api_id) - 1
        const count = Number(bonus?.api_count)
        if (index >= 0 && index < next.length && count > 0) {
          next[index] += count
          changed = true
        }
      }
      if (changed) {
        state.player.materials = next
        if (!sections.includes('materials')) sections.push('materials')
      }
    }
    const questId = parseInt(post.api_quest_id, 10)
    if (!Number.isNaN(questId)) {
      const activeIds = state.player.questActiveIds
      const wasActive = activeIds?.includes(questId) ?? false
      if (state.player.quests[questId]) delete state.player.quests[questId]
      if (activeIds) {
        state.player.questActiveIds = activeIds.filter((id) => id !== questId)
        state.player.questActiveTs = ts
      }
      if (wasActive && state.player.questExecCount != null) {
        state.player.questExecCount = Math.max(0, state.player.questExecCount - 1)
      }
      sections.push('quests')
    }
    return sections
  },

  // 建造：postBody 是花费（燃弹钢铝+开发资材），高速建造再扣一个高速建造材
  '/kcsapi/api_req_kousyou/createship': (_body, post) => {
    const costs: [number, number][] = [
      [0, parseInt(post.api_item1, 10) || 0],
      [1, parseInt(post.api_item2, 10) || 0],
      [2, parseInt(post.api_item3, 10) || 0],
      [3, parseInt(post.api_item4, 10) || 0],
      [6, parseInt(post.api_item5, 10) || 0],
    ]
    if (parseInt(post.api_highspeed, 10) === 1) {
      costs.push([4, parseInt(post.api_large_flag, 10) === 1 ? 10 : 1])
    }
    return subtractMaterials(costs) ? ['materials'] : []
  },

  '/kcsapi/api_req_kousyou/createship_speedchange': (_body, post) => {
    const dock = state.player.kdocks.find((entry) => entry.id === Number(post.api_kdock_id))
    if (!dock) return []
    const sections: Section[] = []
    if (dock.state !== 3 || dock.completeTime !== 0) {
      dock.state = 3
      dock.completeTime = 0
      sections.push('kdocks')
    }
    if (subtractMaterials([[4, dock.recipeFuel > 1000 ? 10 : 1]])) {
      sections.push('materials')
    }
    return sections
  },

  // 领取建造结果：响应直接带新舰、初始装备与最新建造槽，不必等下一次回港。
  '/kcsapi/api_req_kousyou/getship': (body) => {
    const sections: Section[] = []
    if (body?.api_ship?.api_id) {
      state.player.ships[body.api_ship.api_id] = toShip(body.api_ship)
      sections.push('ships')
    }
    if (Array.isArray(body?.api_kdock)) {
      state.player.kdocks = body.api_kdock.map(toKdock)
      sections.push('kdocks')
    }
    if (
      applySlotitemInventoryMutation(
        state.player.slotitems,
        '/kcsapi/api_req_kousyou/getship',
        body,
        {},
      )
    ) {
      sections.push('slotitems')
    }
    return sections
  },

  // 开发：响应带完整资源数组与本次新装备，立即并入库存。
  '/kcsapi/api_req_kousyou/createitem': (body) => {
    const sections: Section[] = []
    if (Array.isArray(body.api_material)) {
      state.player.materials = toMaterials(body.api_material, state.player.materials)
      sections.push('materials')
    }
    if (
      applySlotitemInventoryMutation(
        state.player.slotitems,
        '/kcsapi/api_req_kousyou/createitem',
        body,
        {},
      )
    ) {
      sections.push('slotitems')
    }
    return sections
  },

  // 解体：请求里的在籍 id 是离籍强证据；同步删除舰与编队位置，不等下一次回港。
  '/kcsapi/api_req_kousyou/destroyship': (body, post) => {
    const ids = `${post.api_ship_id ?? ''}`
      .split(',')
      .map((id) => parseInt(id, 10))
      .filter((id) => id > 0)
    const destroyedEquipment =
      Number(post.api_slot_dest_flag) !== 0 ? equippedSlotitemIds(ids) : []
    removeRosterShips(ids)
    const sections: Section[] = ids.length ? ['ships', 'decks'] : []
    if (removeSlotitems(destroyedEquipment)) sections.push('slotitems')
    if (Array.isArray(body.api_material)) {
      state.player.materials = toMaterials(body.api_material, state.player.materials)
      sections.push('materials')
    }
    return sections
  },

  // 近代化改修：api_id_items 是被作为素材消耗的在籍 id；响应同时给目标舰与最新编队。
  '/kcsapi/api_req_kaisou/powerup': (body, post) => {
    const materialIds = `${post.api_id_items ?? ''}`
      .split(',')
      .map((id) => parseInt(id, 10))
      .filter((id) => id > 0)
    const destroyedEquipment =
      Number(post.api_slot_dest_flag) !== 0 ? equippedSlotitemIds(materialIds) : []
    removeRosterShips(materialIds)
    if (body.api_ship?.api_id) state.player.ships[body.api_ship.api_id] = toShip(body.api_ship)
    if (Array.isArray(body.api_deck)) applyDeckUpdates(body.api_deck, false)
    const sections: Section[] = materialIds.length || body.api_ship ? ['ships', 'decks'] : []
    if (removeSlotitems(destroyedEquipment)) sections.push('slotitems')
    return sections
  },

  // 废弃装备：请求给出被删的实例 id，响应给返还燃弹钢铝。
  '/kcsapi/api_req_kousyou/destroyitem2': (body, post) => {
    const sections: Section[] = []
    if (
      applySlotitemInventoryMutation(
        state.player.slotitems,
        '/kcsapi/api_req_kousyou/destroyitem2',
        body,
        post,
      )
    ) {
      sections.push('slotitems')
    }
    if (addMaterials4(body.api_get_material)) sections.push('materials')
    return sections
  },

  // 改修：响应同时带完整资源数组、被消耗的素材实例与改修后目标实例。
  '/kcsapi/api_req_kousyou/remodel_slot': (body) => {
    const sections: Section[] = []
    if (Array.isArray(body.api_after_material)) {
      state.player.materials = toMaterials(body.api_after_material, state.player.materials)
      sections.push('materials')
    }
    if (
      applySlotitemInventoryMutation(
        state.player.slotitems,
        '/kcsapi/api_req_kousyou/remodel_slot',
        body,
        {},
      )
    ) {
      sections.push('slotitems')
    }
    return sections
  },

  '/kcsapi/api_req_kousyou/remodel_slot_recover': (body) =>
    applySlotitemInventoryMutation(
      state.player.slotitems,
      '/kcsapi/api_req_kousyou/remodel_slot_recover',
      body,
      {},
    )
      ? ['slotitems']
      : [],

  '/kcsapi/api_req_member/itemuse': (body, post) =>
    applySlotitemInventoryMutation(
      state.player.slotitems,
      '/kcsapi/api_req_member/itemuse',
      body,
      post,
    )
      ? ['slotitems']
      : [],

  // 任务列表。tab 0（全部）与 tab 9（进行中）提供权威集合；其他分类页只做局部更新。
  // 旧实现永远 merge，取消/交付后的 state=2 因不再出现在当前页而永久残留，
  // 会同时污染 UI 数量与任务计数门。
  '/kcsapi/api_get_member/questlist': (body, post, ts) => {
    const update = reduceQuestList(
      state.player.quests,
      state.player.questActiveIds,
      body,
      post,
    )
    if (!update) return []
    state.player.quests = update.quests
    state.player.questActiveIds = update.activeIds
    const tabId = parseInt(`${post.api_tab_id ?? -1}`, 10)
    if (tabId === 0 || tabId === 9) state.player.questActiveTs = ts
    // tab 0「全部」一次给全（实测 118 条，不分页），拿到它才敢说
    // 「不在表里 = 已交付或未解锁」。分类页只给那一类，当不了全集。
    if (tabId === 0) state.player.questsFullTs = ts
    state.player.questExecCount = update.execCount
    state.player.questsTs = ts
    return ['quests']
  },

  // 领取任务：这个动作本身就是权威状态变化，不必再等下一次 questlist。
  '/kcsapi/api_req_quest/start': (_body, post, ts) => {
    const questId = parseInt(post.api_quest_id, 10)
    if (!(questId > 0)) return []
    const activeIds = state.player.questActiveIds
    const wasActive = activeIds?.includes(questId) ?? state.player.quests[questId]?.state === 2
    if (state.player.quests[questId]) state.player.quests[questId].state = 2
    if (activeIds) {
      state.player.questActiveIds = [...new Set([...activeIds, questId])]
      state.player.questActiveTs = ts
    }
    if (!wasActive && state.player.questExecCount != null) state.player.questExecCount += 1
    return ['quests']
  },

  // 放弃任务
  '/kcsapi/api_req_quest/stop': (_body, post, ts) => {
    const questId = parseInt(post.api_quest_id, 10)
    const quest = state.player.quests[questId]
    if (quest) {
      quest.state = 1
      if (state.player.questActiveIds) {
        state.player.questActiveIds = state.player.questActiveIds.filter((id) => id !== questId)
        state.player.questActiveTs = ts
      }
      if (state.player.questExecCount != null) {
        state.player.questExecCount = Math.max(0, state.player.questExecCount - 1)
      }
      return ['quests']
    }
    return []
  },

  // ---- 出击/战斗 ----

  '/kcsapi/api_req_map/select_eventmap_rank': (body, post) => {
    const mapArea = parseInt(post.api_maparea_id, 10)
    const mapNo = parseInt(post.api_map_no, 10)
    const mapId = mapArea * 10 + mapNo
    const selectedRank = parseInt(post.api_rank, 10)
    return setMapGauge(
      mapId,
      patchMapGaugeFromSortiePayload(
        state.mapGauges[mapId],
        body,
        Number.isFinite(selectedRank) ? selectedRank : null,
      ),
    )
      ? ['mapGauges']
      : []
  },

  // 出击开始：postBody 有舰队号；body 有海域、首格、Boss 格
  '/kcsapi/api_req_map/start': (body, post, ts) => {
    state.sortie = newSortie({
      mapArea: body.api_maparea_id ?? 0,
      mapNo: body.api_mapinfo_no ?? 0,
      deckId: parseInt(post.api_deck_id, 10) || 1,
      bossCell: body.api_bosscell_no ?? -1,
      nodes: [sortieNodeOf(body)],
      currentCell: body.api_no ?? -1,
      cellData: cellDataOf(body),
      selectRoute: selectRouteOf(body),
      bossCleared: bossClearedOf(body, null),
      startTs: ts,
      updatedTs: ts,
      battle: body.api_destruction_battle
        ? parseBaseDefenseBattle(body.api_destruction_battle, fleetContext, ts)
        : null,
    })
    const mapId = state.sortie.mapArea * 10 + state.sortie.mapNo
    const gaugeChanged = setMapGauge(
      mapId,
      patchMapGaugeFromSortiePayload(state.mapGauges[mapId], body),
    )
    const sections: Section[] = ['sortie']
    if (gaugeChanged) sections.push('mapGauges')
    if (applyMapMaterialDelta(body)) sections.push('materials')
    if (applyMapUseitemGains(body, ts)) sections.push('useitems')
    return sections
  },

  // 基地航空队派遣：出击时明确告知「第 N 队打哪个点」，每队两波。
  // 只在请求参数里（api_strike_point_2 = "40,40"），响应体不回，所以从 post 取。
  // 队号来自参数名后缀，不是数组下标——玩家可能只派第 2、3 队，第 1 队留防空。
  '/kcsapi/api_req_map/start_air_base': (_body, post, ts) => {
    const sortie = state.sortie
    if (!sortie?.active) return []
    const strikes = parseAirBaseStrikes(post)
    if (!Object.keys(strikes).length) return []
    sortie.airBaseStrikes = strikes
    sortie.updatedTs = ts
    return ['sortie']
  },

  // 进击到下一格
  '/kcsapi/api_req_map/next': (body, _post, ts) => {
    const sortie = state.sortie
    if (!sortie) return []
    sortie.nodes.push(sortieNodeOf(body))
    sortie.currentCell = body.api_no ?? -1
    const nextCells = cellDataOf(body)
    if (nextCells.length) sortie.cellData = nextCells
    sortie.selectRoute = selectRouteOf(body)
    // 基地防空结算内嵌在进点报文，不会另发战斗端点；先显示它，
    // 若该点还有普通战斗，稍后的 battle/each_battle 会自然替换。
    sortie.battle = body.api_destruction_battle
      ? parseBaseDefenseBattle(body.api_destruction_battle, fleetContext, ts)
      : null
    if (typeof body.api_bosscell_no === 'number') sortie.bossCell = body.api_bosscell_no
    sortie.bossCleared = bossClearedOf(body, sortie.bossCleared)
    sortie.updatedTs = ts
    const mapId = mapIdOf(sortie.mapArea, sortie.mapNo)
    const gaugeChanged = setMapGauge(
      mapId,
      patchMapGaugeFromSortiePayload(state.mapGauges[mapId], body),
    )
    const sections: Section[] = ['sortie']
    if (gaugeChanged) sections.push('mapGauges')
    if (applyMapMaterialDelta(body)) sections.push('materials')
    if (applyMapUseitemGains(body, ts)) sections.push('useitems')
    return sections
  },

  // 选择演习对手时游戏已下发完整舰娘 ID 与等级；先建立“开战前”会话，
  // 让镝立即显示预测。响应没有装备/最终面板，绝不在这里补造。
  '/kcsapi/api_req_member/get_practice_enemyinfo': (body, _post, ts) => {
    const ships = Array.isArray(body?.api_deck?.api_ships)
      ? body.api_deck.api_ships.flatMap((ship: any) => {
          const mstId = Number(ship?.api_ship_id)
          if (!Number.isInteger(mstId) || mstId <= 0) return []
          return [{
            mstId,
            level: Math.max(1, Number(ship?.api_level) || 1),
            star: Math.max(0, Number(ship?.api_star) || 0),
          }]
        })
      : []
    if (!ships.length) return []
    state.sortie = newSortie({
      // **看一眼对手的编成不是一场会话。** newSortie 默认 active: true，从前这里
      // 没覆盖，于是玩家一点开演习对手，就诞生一个 active 的「演习会话」——
      // 而 voice-subtitle 的演习拦截是 `active && practice`，整场零字幕从那一刻
      // 生效，直到下一条回港报文才解除。不打演习只看看，窗口任意长。
      // 用户报的「字幕间歇性消失」就是它：看对手 → 回编成页调舰队 → 编成语音静默。
      //
      // 这里要的只是把对手编成喂给未卜先知（practiceOpponent），预测那条路判的是
      // `practice && practiceOpponent && !battle`，一个字都不看 active。
      // 真开战的 api_req_practice/battle 会重建 active:true 并继承 practiceOpponent，
      // 战斗语义原样不动。
      active: false,
      practice: true,
      deckId: 1,
      startTs: ts,
      updatedTs: ts,
      practiceOpponent: {
        id: Number(body?.api_member_id) || 0,
        name: typeof body?.api_nickname === 'string' ? body.api_nickname : '',
        level: Math.max(0, Number(body?.api_level) || 0),
        rank: typeof body?.api_rank === 'string' ? body.api_rank : '',
        deckName: typeof body?.api_deckname === 'string' ? body.api_deckname : '',
        ships,
        ts,
      },
    })
    return ['sortie']
  },

  // 演习：同一解析器，标记 practice（无航迹/罗盘/大破撤退语义）
  '/kcsapi/api_req_practice/battle': (body, post, ts) => {
    const practiceOpponent =
      state.sortie?.practice ? state.sortie.practiceOpponent ?? null : null
    state.sortie = newSortie({
      practice: true,
      deckId: parseInt(post.api_deck_id, 10) || 1,
      startTs: ts,
      updatedTs: ts,
      practiceOpponent,
    })
    state.sortie.battle = parseBattle('/kcsapi/api_req_practice/battle', body, fleetContext, ts)
    state.sortie.battleCount = 1
    return ['sortie']
  },
  '/kcsapi/api_req_practice/midnight_battle': (body, _post, ts) => {
    const sortie = state.sortie
    if (!sortie?.battle) return []
    sortie.battle = mergeNight(sortie.battle, body, fleetContext, ts)
    sortie.updatedTs = ts
    return ['sortie']
  },
  '/kcsapi/api_req_practice/battle_result': onBattleResult,

  // 演习对手列表（打开演习页时自然产生；铃的「刷新前未打完」提醒数据源）
  '/kcsapi/api_get_member/practice': (body, _post, ts) => {
    if (!Array.isArray(body?.api_list)) return []
    state.player.practice = {
      list: body.api_list.map((e: any) => ({
        id: e.api_enemy_id ?? 0,
        name: e.api_enemy_name ?? '',
        state: e.api_state ?? 0,
        level: typeof e.api_enemy_level === 'number' ? e.api_enemy_level : undefined,
        rank: typeof e.api_enemy_rank === 'string' ? e.api_enemy_rank : undefined,
        flagShipId:
          typeof e.api_enemy_flag_ship === 'number' ? e.api_enemy_flag_ship : undefined,
      })),
      ts,
    }
    return ['practice']
  },

  // 游戏战绩页的官方生涯累计值。只保留统计字段，不保存留言、头像 URL 或 member id。
  '/kcsapi/api_get_member/record': (body, _post, ts) => {
    const n = (value: unknown): number => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const rate = (value: unknown): number | null => {
      const parsed = Number(value)
      // record 的胜率字段历史上口径不一致：api_war 实测会给 "0.99"，
      // 远征/演习则给 "98.99"。统一归一成 UI 使用的百分数。
      return Number.isFinite(parsed)
        ? parsed >= 0 && parsed <= 1
          ? parsed * 100
          : parsed
        : null
    }
    state.player.record = {
      ts,
      sortieWin: n(body?.api_war?.api_win),
      sortieLose: n(body?.api_war?.api_lose),
      sortieRate: rate(body?.api_war?.api_rate),
      practiceWin: n(body?.api_practice?.api_win),
      practiceLose: n(body?.api_practice?.api_lose),
      practiceRate: rate(body?.api_practice?.api_rate),
      missionCount: n(body?.api_mission?.api_count),
      missionSuccess: n(body?.api_mission?.api_success),
      missionRate: rate(body?.api_mission?.api_rate),
      materialMax:
        typeof body?.api_material_max === 'number' ? body.api_material_max : null,
      shipCount: Array.isArray(body?.api_ship) ? n(body.api_ship[0]) : null,
      shipCapacity: Array.isArray(body?.api_ship) ? n(body.api_ship[1]) : null,
      slotitemCount: Array.isArray(body?.api_slotitem) ? n(body.api_slotitem[0]) : null,
      slotitemCapacity: Array.isArray(body?.api_slotitem) ? n(body.api_slotitem[1]) : null,
      airBaseMaintenance: Array.isArray(body?.api_air_base_expanded_info)
        ? body.api_air_base_expanded_info.flatMap((entry: any) => {
            const areaId = n(entry?.api_area_id)
            return areaId > 0
              ? [{ areaId, level: n(entry?.api_maintenance_level) }]
              : []
          })
        : [],
    }
    return ['record']
  },

  // 课金道具持有清单（开アイテム屋/付款后自然产生）。前后两份相减出购买记录：
  // 只有增加算购买（减少走 payitemuse），首次观测只立基线不造记录——
  // 现存持有不知何时买的，交给玩家在史模块手动补记。
  '/kcsapi/api_get_member/payitem': (body, _post, ts) => {
    const next = parsePayitemList(body)
    if (next === null) return [] // 形状不认识：不动基线，否则下份真清单会造假购买
    const prev = state.player.payitems
    for (const purchase of diffPayitemStocks(prev?.items ?? null, next)) {
      ledger.recordPayLog({
        ts,
        kind: 'buy',
        itemId: purchase.itemId,
        name: purchase.name,
        count: purchase.count,
        price: purchase.price,
        detail: null,
      })
    }
    state.player.payitems = { items: next, ts }
    return ['payitems']
  },

  // 用掉一个课金道具：记消耗行（效果字段入 detail），持有基线同步减一。
  // 母港拡張的回包直接带新上限，顺手让顶栏立即正确，不用等下次回港。
  '/kcsapi/api_req_member/payitemuse': (body, post, ts) => {
    const itemId = parseInt(post.api_payitem_id, 10)
    if (!Number.isInteger(itemId) || itemId <= 0) return []
    const holding = state.player.payitems
    const held = holding?.items[itemId]
    ledger.recordPayLog({
      ts,
      kind: 'use',
      itemId,
      name: held?.name ?? `课金道具 #${itemId}`,
      count: 1,
      price: held?.price ?? null,
      detail: payitemUseEffect(body),
    })
    const sections: Section[] = []
    if (holding && held) {
      held.count -= 1
      if (held.count <= 0) delete holding.items[itemId]
      holding.ts = ts
      sections.push('payitems')
    }
    const b = state.player.basic
    if (b && typeof body?.api_max_chara === 'number' && body.api_max_chara > 0) {
      b.maxShips = body.api_max_chara
      if (typeof body?.api_max_slotitem === 'number' && body.api_max_slotitem > 0) {
        b.maxSlotitems = body.api_max_slotitem
      }
      sections.push('basic')
    }
    return sections
  },

  '/kcsapi/api_req_sortie/battleresult': onBattleResult,
  '/kcsapi/api_req_combined_battle/battleresult': onBattleResult,
  // 玩家真点了「退避」。两条端点同一件事（通常舰队 / 連合舰队），共用一个归约器。
  '/kcsapi/api_req_sortie/goback_port': onGobackPort,
  '/kcsapi/api_req_combined_battle/goback_port': onGobackPort,

  // 海域攻略进度（打开出击图时自然产生）：Boss 血条/击破计数
  '/kcsapi/api_get_member/mapinfo': (body, _post, ts) => {
    const list = body?.api_map_info ?? body
    if (!Array.isArray(list)) return []
    state.mapGauges = {}
    for (const raw of list) {
      if (!raw || typeof raw.api_id !== 'number') continue
      state.mapGauges[raw.api_id] = {
        cleared: raw.api_cleared === 1,
        defeated: raw.api_defeat_count ?? null,
        required: raw.api_required_defeat_count ?? null,
        hpNow: raw.api_eventmap?.api_now_maphp ?? null,
        hpMax: raw.api_eventmap?.api_max_maphp ?? null,
        selectedRank: raw.api_eventmap?.api_selected_rank ?? null,
        limitFlag: raw.api_eventmap?.api_limit_flag ?? null,
        gaugeType: raw.api_gauge_type ?? null,
        gaugeNum: raw.api_gauge_num ?? null,
      }
    }
    const sections: Section[] = ['mapGauges']
    if (Array.isArray(body?.api_air_base)) {
      state.player.airBases = replaceAirBases(body.api_air_base, ts)
      state.player.airBasesTs = ts
      sections.push('airBases')
    }
    return sections
  },

  '/kcsapi/api_req_nyukyo/speedchange': (_body, post) => {
    const ndockId = parseInt(post.api_ndock_id, 10)
    const dock = state.player.ndocks.find((d) => d.id === ndockId)
    if (dock && dock.shipId > 0) {
      const sections: Section[] = ['ships', 'ndocks']
      const ship = state.player.ships[dock.shipId]
      if (ship) {
        ship.nowhp = ship.maxhp
        if (ship.cond < 40) ship.cond = 40
      }
      dock.shipId = 0
      dock.completeTime = 0
      if (subtractMaterials([[5, 1]])) sections.push('materials')
      return sections
    }
    return []
  },
}

// 战斗端点批量登记（解析器需要知道 path 来区分昼/夜/空袭形态）
for (const p of DAY_BATTLE_PATHS) reducers[p] = onDayBattle(p)
for (const p of NIGHT_BATTLE_PATHS) reducers[p] = onNightBattle(p)

export const handle = (
  apiPath: string,
  body: any,
  postBody: Record<string, string>,
  ts: number,
): Section[] => {
  const reducer = reducers[apiPath]
  if (!reducer) return []
  try {
    return reducer(body, postBody, ts)
  } catch (e) {
    console.warn('[kanso] mg: reducer failed for', apiPath, e)
    return []
  }
}
