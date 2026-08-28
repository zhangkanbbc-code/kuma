// 友军遭遇志：把战斗报文里的 `api_friendly_info` 压成可永久保存的一条遭遇。
//
// 随包的 map-intel `operations.friendlyFleets` 是誊抄层（wiki 上有人写了才有），
// 这一层是本机一手：你自己在哪张图、哪个点、哪个难度、什么时候遇到过哪支友军。
// 两层在铎里并列显示，不合并——与敌编成区「目录/实测分层」同一口径。
//
// ---- 三条口径 ----
//
// ① **`api_production_type` 只存原值，永不解读。** 「2=強力」的二元假说 2026-08-26
//    当晚被实弹证伪：用户全程強力要請，21:09 那场是 2（4 舰）、21:25 那场是 3（5 舰）
//    ——同一要請档下两个值。语义未定，显示层一律不许拿它挂「强友军」标。
//    要請档位另有一手来源（`set_friendly_request` 的 `api_request_type`），走 requestType。
//
// ② **判重键＝编成指纹，不含血量。** 账本 7 次遭遇实测：同一支友军的
//    mstId / Lv / `api_Slot` / `api_slot_ex` 逐次完全一致，而 `api_nowhps` 会变
//    （潜水舰那支两次分别是 …,30,30 与 …,29,31——友军是带着伤来的）。
//    把血量算进指纹，同一支友军会裂成好几支。
//
// ③ **一次遭遇一行，合并发生在读取期。** 行的主键是（指纹, 时刻），
//    所以从 events 回放补录可以无限次重跑：同一份报文的时刻不变，`INSERT OR IGNORE`
//    第二次就是空操作。计次与「最近时刻」由 groupFriendlySightings 现算。
//
// ⚠️ `api_Slot` 是**大写 S**（battle.ts 的 buildNpcFriendShips 同款注解）。

/** 一艘友军舰。装备取 `api_Slot`（大写 S）+ `api_slot_ex`。 */
export interface FriendlyFleetShip {
  mstId: number
  lv: number
  /** api_Slot 那一行：装备 mstId，空格是 -1 */
  slot: number[]
  /** api_slot_ex：补强增设格 */
  slotEx: number
  maxHp: number
  /** api_Param：[火力, 雷装, 対空, 装甲] */
  param: number[]
  /** api_voice_id / api_voice_p_no：友军台词的语音号，游戏随编成一起下发 */
  voiceId: number
  voiceP: number
}

/** 一次遭遇。落表就是这一行，字段与 friendly_fleets 表一一对应。 */
export interface FriendlyFleetSighting {
  fleetKey: string
  ts: number
  /** area*10+no */
  map: number
  cell: number
  /** api_selected_rank：1丁 2丙 3乙 4甲；0 = 常规海域或不可知 */
  difficulty: number
  /** set_friendly_request 的 api_request_type：0 通常 / 1 強力。null = 关联不上 */
  requestType: number | null
  /** api_production_type 原值。**不解读** */
  productionType: number | null
  ships: FriendlyFleetShip[]
}

/** 同一支友军的全部遭遇聚合成一条。 */
export interface FriendlyFleetRecord {
  fleetKey: string
  map: number
  difficulty: number
  ships: FriendlyFleetShip[]
  count: number
  firstTs: number
  lastTs: number
  /** 遇到过的点位与各自次数，次数降序、同次数按点位号升序 */
  cells: { cell: number; count: number }[]
  /** 观测到的要請类型（升序去重）。空数组 = 每一次都关联不上 */
  requestTypes: number[]
  /** 关联不上要請类型的次数 */
  unknownRequest: number
  /** 观测到的 api_production_type 原值（升序去重），不解读 */
  productionTypes: number[]
}

const toInts = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'number' && Number.isFinite(item) ? Math.trunc(item) : 0))
    : []

const intAt = (list: number[], index: number) => list[index] ?? 0

/**
 * 报文 → 友军编成。不是友军战（没有这一段、或者一艘舰都没有）就返回 null。
 *
 * `api_Slot` 大写 S 是游戏的真字段；小写只是防上游哪天改名，别把它当成已知别名。
 */
export const parseFriendlyInfo = (
  info: any,
): { productionType: number | null; ships: FriendlyFleetShip[] } | null => {
  if (!info || typeof info !== 'object') return null
  const ids = toInts(info.api_ship_id).filter((id) => id > 0)
  if (!ids.length) return null
  const lvs = toInts(info.api_ship_lv)
  const maxhps = toInts(info.api_maxhps)
  const slotEx = toInts(info.api_slot_ex)
  const voiceIds = toInts(info.api_voice_id)
  const voicePs = toInts(info.api_voice_p_no)
  const rawSlots = info.api_Slot ?? info.api_slot
  const slots: number[][] = Array.isArray(rawSlots) ? rawSlots.map(toInts) : []
  const rawParams = info.api_Param ?? info.api_param
  const params: number[][] = Array.isArray(rawParams) ? rawParams.map(toInts) : []
  const ships = ids.map((mstId, i) => ({
    mstId,
    lv: intAt(lvs, i),
    slot: slots[i] ?? [],
    slotEx: intAt(slotEx, i),
    maxHp: intAt(maxhps, i),
    param: params[i] ?? [],
    voiceId: intAt(voiceIds, i),
    voiceP: intAt(voicePs, i),
  }))
  const productionType =
    typeof info.api_production_type === 'number' && Number.isFinite(info.api_production_type)
      ? Math.trunc(info.api_production_type)
      : null
  return { productionType, ships }
}

/**
 * 编成指纹。舰序有意义（友军的旗舰位置是编成的一部分），所以按下发顺序拼。
 * 刻意写成人读得懂的串而不是哈希——排查时能一眼看出是哪支友军。
 */
export const friendlyFleetKey = (ships: FriendlyFleetShip[]): string =>
  ships.map((s) => `${s.mstId}.${s.lv}.${s.slot.join('-')}.${s.slotEx}`).join('|')

/**
 * 把一堆遭遇按「哪张图的哪个难度遇到的哪支友军」聚合。
 * 调用方通常已经按 map/difficulty 筛过，这里仍然把两者算进分组键——
 * 喂进跨图的行时不至于把点位混到一起。
 */
export const groupFriendlySightings = (
  sightings: FriendlyFleetSighting[],
): FriendlyFleetRecord[] => {
  const byKey = new Map<string, FriendlyFleetRecord & { cellTally: Map<number, number> }>()
  for (const one of sightings) {
    const groupKey = `${one.map}:${one.difficulty}:${one.fleetKey}`
    let record = byKey.get(groupKey)
    if (!record) {
      record = {
        fleetKey: one.fleetKey,
        map: one.map,
        difficulty: one.difficulty,
        ships: one.ships,
        count: 0,
        firstTs: one.ts,
        lastTs: one.ts,
        cells: [],
        requestTypes: [],
        unknownRequest: 0,
        productionTypes: [],
        cellTally: new Map(),
      }
      byKey.set(groupKey, record)
    }
    record.count++
    if (one.ts < record.firstTs) record.firstTs = one.ts
    if (one.ts > record.lastTs) {
      record.lastTs = one.ts
      // 编成以最近一次看到的为准：同指纹下本来就该一样，真不一样时新的更可信
      record.ships = one.ships
    }
    record.cellTally.set(one.cell, (record.cellTally.get(one.cell) ?? 0) + 1)
    if (one.requestType === null) record.unknownRequest++
    else if (!record.requestTypes.includes(one.requestType)) record.requestTypes.push(one.requestType)
    if (one.productionType !== null && !record.productionTypes.includes(one.productionType)) {
      record.productionTypes.push(one.productionType)
    }
  }
  return [...byKey.values()]
    .map(({ cellTally, ...record }) => ({
      ...record,
      cells: [...cellTally.entries()]
        .map(([cell, count]) => ({ cell, count }))
        .sort((a, b) => b.count - a.count || a.cell - b.cell),
      requestTypes: [...record.requestTypes].sort((a, b) => a - b),
      productionTypes: [...record.productionTypes].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.lastTs - a.lastTs)
}

/** 要請类型的显示名。0/1 之外的值不认（游戏只发过这两个）。 */
export const FRIENDLY_REQUEST_NAME: Record<number, string> = {
  0: '通常要請',
  1: '強力要請',
}

// ---- 从原始事件流回放 ----
//
// 友军舰队 2026-08-26 才上线，本表更晚——那几场的报文还躺在 events 里，
// 报文在、结论不在。回放只用 events 自己，不去问别的表：
//   mapinfo / select_eventmap_rank → 难度
//   map/start · map/next           → 图与点位
//   set_friendly_request           → 要請类型（时序关联：取此刻之前最后一次设置）
//   带 api_friendly_info 的战斗包   → 编成
// 与实时收录读的是同一批字段（难度都来自 api_eventmap.api_selected_rank），
// 所以补录出来的行与当场记下的行没有口径差。

export interface FriendlyReplayEvent {
  ts: number
  path: string
  /** 响应体。整包（含 api_data）与已解包两种都吃 */
  body: any
  /** 请求参数，已解析成对象 */
  post?: Record<string, any> | null
}

const asInt = (value: unknown): number | null => {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * 事件流 → 友军遭遇。事件必须按时刻升序喂进来。
 *
 * 关联不上要請类型（这台机器在那之前从没收到过 set_friendly_request）时
 * requestType 留 null——「不知道」与「通常要請」是两回事，不许回灌成 0。
 */
export const replayFriendlySightings = (
  events: Iterable<FriendlyReplayEvent>,
): FriendlyFleetSighting[] => {
  const out: FriendlyFleetSighting[] = []
  const difficultyByMap = new Map<number, number>()
  let map = 0
  let cell = 0
  let requestType: number | null = null
  for (const event of events) {
    const data = event.body?.api_data ?? event.body
    if (!data || typeof data !== 'object') continue
    const path = event.path
    if (path === '/kcsapi/api_get_member/mapinfo') {
      const list = Array.isArray(data?.api_map_info) ? data.api_map_info : data
      if (!Array.isArray(list)) continue
      for (const raw of list) {
        const id = asInt(raw?.api_id)
        const rank = asInt(raw?.api_eventmap?.api_selected_rank)
        if (id !== null && rank !== null) difficultyByMap.set(id, rank)
      }
      continue
    }
    if (path === '/kcsapi/api_req_map/select_eventmap_rank') {
      const area = asInt(event.post?.api_maparea_id)
      const no = asInt(event.post?.api_map_no)
      const rank = asInt(event.post?.api_rank)
      if (area !== null && no !== null && rank !== null) {
        difficultyByMap.set(area * 10 + no, rank)
      }
      continue
    }
    if (path === '/kcsapi/api_req_map/start' || path === '/kcsapi/api_req_map/next') {
      const area = asInt(data.api_maparea_id)
      const no = asInt(data.api_mapinfo_no)
      map = area !== null && no !== null ? area * 10 + no : 0
      cell = asInt(data.api_no) ?? 0
      continue
    }
    if (path === '/kcsapi/api_req_member/set_friendly_request') {
      // 全部状态都在请求参数里，响应只有 api_result
      const type = asInt(event.post?.api_request_type)
      if (type !== null) requestType = type
      continue
    }
    const parsed = parseFriendlyInfo(data.api_friendly_info)
    // 位置不明的遭遇不落表：难度/点位对不上号的行会挂到错的那一栏去
    if (!parsed || map <= 0 || cell <= 0) continue
    out.push({
      fleetKey: friendlyFleetKey(parsed.ships),
      ts: event.ts,
      map,
      cell,
      difficulty: difficultyByMap.get(map) ?? 0,
      requestType,
      productionType: parsed.productionType,
      ships: parsed.ships,
    })
  }
  return out
}
