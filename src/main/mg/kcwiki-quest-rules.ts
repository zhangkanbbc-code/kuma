import type {
  QpFleetDeckDiff,
  QpFleetGoal,
  QpFleetGoalGroup,
  QpStateGoal,
  QpStateGoalEquipment,
  QpStateGoalSecretary,
  QpStockGoal,
  QpTask,
} from '../../shared/qp-types'
import { isEscortGoalMap, qpTaskGroups } from '../../shared/qp-types'
import { hasEventMaps } from '../../shared/event-area'

type ShipSelector =
  | { kind: 'ships'; ids: number[] }
  | { kind: 'stypes'; ids: number[] }
  | { kind: 'any' }
  | { kind: 'other' }
  | { kind: 'speed'; min: number }
  | { kind: 'slowBattleship' }

export type EquipmentTarget =
  | { kind: 'category'; ids: number[] }
  | { kind: 'equip'; id: number }
  | { kind: 'useitem'; id: number }

export interface KcwikiRuleContext {
  shipIdsByName: Map<string, number[]>
  shipClassIdByName: Map<string, number>
  equipIdsByName: Map<string, number>
  equipTypeIdsByName: Map<string, number>
  useitemIdsByName: Map<string, number>
  missionIds: Set<number>
  missionIdsByDispNo: Map<string, number>
  /** 素名（链根）具名舰的整链展开；非链根形态原样返回（口径见 buildKcwikiRuleContext） */
  expandShipForms: (mstId: number) => number[]
  /** 该形态起前向可达的全部形态（不含自身）——只作 augment 的候选池，不直接进判定 */
  reachableForms: (mstId: number) => number[]
  /** 主数据里有没有活动海图（大活动进行中）。目前只有あ号用它决定标不标 ≈ */
  eventRunning: boolean
}

/**
 * 上游 requirements 里的**友军舰种词**（日文原文）→ 舰种号。
 *
 * 导出是给护栏用的：`shared/ship-type-name.ts` 的规范表必须覆盖这里的每一个键，
 * 上游哪天冒出新词，`test/ship-type-name.test.mjs` 当场红——修法是补规范表一格，
 * 而不是让那个词一路日文上屏。表本身仍以日文为键，转写忠实性不动。
 */
export const FRIENDLY_STYPE_TOKENS: Record<string, number[]> = {
  駆逐: [2],
  駆逐艦: [2],
  軽巡: [3],
  軽巡洋艦: [3],
  重巡: [5],
  重巡洋艦: [5],
  航巡: [6],
  航空巡洋艦: [6],
  空母: [7, 11, 18],
  正規空母: [11],
  軽母: [7],
  軽空母: [7],
  装甲空母: [18],
  戦艦: [8, 9],
  航戦: [10],
  航空戦艦: [10],
  海防艦: [1],
  潜水艦: [13],
  潜水空母: [14],
  潜水母艦: [20],
  水母: [16],
  水上機母艦: [16],
  練習巡洋艦: [21],
  重雷装巡洋艦: [4],
  補給艦: [22],
  揚陸艦: [17],
}

const ENEMY_STYPE_TOKENS: Record<string, number[]> = {
  敵補給艦: [15],
  敵空母: [7, 11],
  敵潜水艦: [13],
  空母: [7, 11],
}

const addNamedId = (index: Map<string, number[]>, name: unknown, id: unknown) => {
  if (typeof name !== 'string' || !Number.isInteger(id) || (id as number) <= 0) return
  const ids = index.get(name) ?? []
  ids.push(id as number)
  index.set(name, ids)
}

export const buildKcwikiRuleContext = (raw: any): KcwikiRuleContext => {
  const shipIdsByName = new Map<string, number[]>()
  const shipClassIdByName = new Map<string, number>()
  for (const ship of raw?.api_mst_ship ?? []) {
    if ((ship?.api_sortno ?? 0) <= 0) continue
    addNamedId(shipIdsByName, ship.api_name, ship.api_id)
    if (
      typeof ship.api_name === 'string' &&
      Number.isInteger(ship.api_ctype) &&
      ship.api_ctype > 0 &&
      !shipClassIdByName.has(ship.api_name)
    ) {
      shipClassIdByName.set(ship.api_name, ship.api_ctype)
    }
  }
  const equipIdsByName = new Map<string, number>()
  for (const equip of raw?.api_mst_slotitem ?? []) {
    if (typeof equip?.api_name === 'string' && Number.isInteger(equip.api_id) && equip.api_id > 0) {
      equipIdsByName.set(equip.api_name, equip.api_id)
    }
  }
  const equipTypeIdsByName = new Map<string, number>()
  for (const type of raw?.api_mst_slotitem_equiptype ?? []) {
    if (typeof type?.api_name === 'string' && Number.isInteger(type.api_id) && type.api_id > 0) {
      equipTypeIdsByName.set(type.api_name, type.api_id)
    }
  }
  const useitemIdsByName = new Map<string, number>()
  for (const item of raw?.api_mst_useitem ?? []) {
    if (typeof item?.api_name === 'string' && Number.isInteger(item.api_id) && item.api_id > 0) {
      useitemIdsByName.set(item.api_name, item.api_id)
    }
  }
  const missionIds = new Set<number>()
  const missionIdsByDispNo = new Map<string, number>()
  for (const mission of raw?.api_mst_mission ?? []) {
    if (!Number.isInteger(mission?.api_id) || mission.api_id <= 0) continue
    missionIds.add(mission.api_id)
    if (typeof mission.api_disp_no === 'string' && mission.api_disp_no) {
      missionIdsByDispNo.set(mission.api_disp_no, mission.api_id)
    }
  }
  // 具名舰的形态口径（2026-08-18 用户两轮实锤定谳）：
  // ① 素名（链根名，如「時雨」「扶桑」）＝任意形态——B61 队里的時雨改二
  //   必须算数，西村系任务拿扶桑改二跑也是游戏实况；
  // ② 写明形态（「白露改」）＝只认写明的。「写改则改二也算」曾按结构规则
  //   实现过，被用户否掉，且全量对账坐实：103 条结构展开只有 11 条有 wiki
  //   文本背书——kcwiki 的口径是逐条列举（「白露改二」/「摩耶改二可」），
  //   文本列举的追加形态由 augmentShipGroupsFromQuestText 按文本补入，
  //   这里不做任何结构推断。
  // 前向边 = api_aftershipid ∪ api_mst_shipupgrade（分支改造只在后者）。
  const forwardEdges = new Map<number, number[]>()
  const addEdge = (from: unknown, to: unknown) => {
    const source = Number(from)
    const target = Number(to)
    if (!Number.isInteger(source) || !Number.isInteger(target)) return
    if (source <= 0 || target <= 0 || source === target) return
    const edges = forwardEdges.get(source) ?? []
    if (!edges.includes(target)) {
      edges.push(target)
      forwardEdges.set(source, edges)
    }
  }
  for (const ship of raw?.api_mst_ship ?? []) {
    if ((ship?.api_sortno ?? 0) <= 0) continue
    addEdge(ship.api_id, Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10))
  }
  for (const upgrade of raw?.api_mst_shipupgrade ?? []) {
    addEdge(upgrade?.api_current_ship_id, upgrade?.api_id)
  }
  const pointedTo = new Set<number>()
  for (const edges of forwardEdges.values()) for (const target of edges) pointedTo.add(target)
  const reachCache = new Map<number, Set<number>>()
  const reachOf = (mstId: number): Set<number> => {
    const cached = reachCache.get(mstId)
    if (cached) return cached
    const reach = new Set<number>()
    const queue = [...(forwardEdges.get(mstId) ?? [])]
    while (queue.length) {
      const next = queue.shift()!
      if (next === mstId || reach.has(next)) continue
      reach.add(next)
      queue.push(...(forwardEdges.get(next) ?? []))
    }
    reachCache.set(mstId, reach)
    return reach
  }
  // 素名（链根，无人指向）整链展开；写明形态的原样返回，列举追加走 augment
  const expandShipForms = (mstId: number): number[] =>
    pointedTo.has(mstId) ? [mstId] : [mstId, ...reachOf(mstId)]
  const reachableForms = (mstId: number): number[] => [...reachOf(mstId)]
  return {
    shipIdsByName,
    shipClassIdByName,
    equipIdsByName,
    equipTypeIdsByName,
    useitemIdsByName,
    missionIds,
    missionIdsByDispNo,
    expandShipForms,
    reachableForms,
    eventRunning: hasEventMaps(raw),
  }
}

/**
 * 按任务文本补入 wiki 显式列举的追加形态（2026-08-18 用户定的口径）。
 * kcwiki 的备注惯例是逐条写明：「白露改」/「白露改二」为旗舰、「摩耶改二可」、
 * 「阳炎改二和不知火改二也可以完成任务」——数据字段常只带最低形态，列举藏在
 * 文本里。这里对每个具名舰组：取组内形态的前向可达形态作候选，只有名字被
 * 文本**独立**提到的才补入（最长匹配扫描——「黑潮改二」不会给「潮改」组
 * 背书「潮改二」）。不在候选池里的文本舰名一概不采，负面提及的早期形态
 * （B54「千岁改造成轻母之前不能达成」）天然不在前向候选里。
 */
export const augmentShipGroupsFromQuestText = (
  draft: { fleetGoal?: QpFleetGoal; stateGoal?: QpStateGoal },
  context: KcwikiRuleContext,
  questText: string,
  zhNameOf: Map<number, string> = new Map(),
): void => {
  if (!questText) return
  if (!draft.fleetGoal && !draft.stateGoal?.secretary) return
  // 名字→ids 索引（日文名 + 中文译名，长度 ≥2——候选全是「X改…」类形态名）
  const namesToIds = new Map<string, number[]>()
  const addName = (name: string | undefined, id: number) => {
    if (!name || name.length < 2) return
    const ids = namesToIds.get(name) ?? []
    if (!ids.includes(id)) {
      ids.push(id)
      namesToIds.set(name, ids)
    }
  }
  for (const [name, ids] of context.shipIdsByName) for (const id of ids) addName(name, id)
  for (const [id, zh] of zhNameOf) addName(zh, id)
  let maxLen = 0
  for (const name of namesToIds.keys()) maxLen = Math.max(maxLen, name.length)
  // 最长匹配扫描：每个位置贪心取最长舰名并整体跳过，短名不借长名的尸体还魂
  const namedIds = new Set<number>()
  for (let i = 0; i < questText.length; ) {
    let consumed = 0
    for (let len = Math.min(maxLen, questText.length - i); len >= 2; len--) {
      const ids = namesToIds.get(questText.slice(i, i + len))
      if (ids) {
        for (const id of ids) namedIds.add(id)
        consumed = len
        break
      }
    }
    i += consumed || 1
  }
  if (!namedIds.size) return
  const augment = (ships: number[] | 'any' | 'other') => {
    if (!Array.isArray(ships)) return
    for (const id of [...ships]) {
      for (const formId of context.reachableForms(id)) {
        if (namedIds.has(formId) && !ships.includes(formId)) ships.push(formId)
      }
    }
  }
  for (const group of draft.fleetGoal?.groups ?? []) augment(group.ships)
  const secretary = draft.stateGoal?.secretary
  if (secretary) augment(secretary.ships)
}

export const resolveFriendlyShipToken = (
  context: KcwikiRuleContext,
  rawToken: string,
): ShipSelector | null => {
  const token = rawToken.trim()
  if (token === '艦') return { kind: 'any' }
  if (token === '他の艦') return { kind: 'other' }
  if (token === '高速艦') return { kind: 'speed', min: 10 }
  if (token === '低速戦艦') return { kind: 'slowBattleship' }
  const stypes = FRIENDLY_STYPE_TOKENS[token]
  if (stypes) return { kind: 'stypes', ids: [...stypes] }
  const ships = context.shipIdsByName.get(token)
  if (!ships?.length) return null
  // 具名舰展开为「写明的形态及其之后的改造」（口径见 buildKcwikiRuleContext）
  return {
    kind: 'ships',
    ids: [...new Set(ships.flatMap((mstId) => context.expandShipForms(mstId)))],
  }
}

export const resolveEnemyStypes = (rawToken: string): number[] | null => {
  const ids = ENEMY_STYPE_TOKENS[rawToken.trim()]
  return ids ? [...ids] : null
}

export const resolveEquipmentTarget = (
  context: KcwikiRuleContext,
  rawName: string,
): EquipmentTarget | null => {
  const name = rawName.trim()
  if (name === '電探') return { kind: 'category', ids: [12, 13] }
  const category = context.equipTypeIdsByName.get(name)
  if (category) return { kind: 'category', ids: [category] }
  const equip = context.equipIdsByName.get(name)
  if (equip) return { kind: 'equip', id: equip }
  const useitem = context.useitemIdsByName.get(name)
  return useitem ? { kind: 'useitem', id: useitem } : null
}

export const resolveMissionId = (
  context: KcwikiRuleContext,
  rawId: unknown,
): number | null => {
  if (Number.isInteger(rawId) && context.missionIds.has(rawId as number)) return rawId as number
  if (typeof rawId === 'string') return context.missionIdsByDispNo.get(rawId) ?? null
  return null
}

export interface KcwikiTrackerDraft {
  tasks: QpTask[]
  partial: boolean
  fleetGoal?: QpFleetGoal
  stateGoal?: QpStateGoal
  stockGoals?: QpStockGoal[]
  /** 计数可能偏多（UI 标 ≈）。缺省 false——这一源绝大多数条目是精确的。 */
  approx?: boolean
}

const decodeExpedition = (
  requirement: any,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => {
  if (!Array.isArray(requirement.objects) || !requirement.objects.length) return null
  const tasks: QpTask[] = []
  for (const [slot, object] of requirement.objects.entries()) {
    if (!Number.isInteger(object?.times) || object.times <= 0) return null
    const refs = object.id === undefined
      ? [0]
      : (Array.isArray(object.id) ? object.id : [object.id])
    if (!refs.length) return null
    const missionIds: number[] = []
    for (const ref of refs) {
      if (ref === 0) {
        missionIds.push(0)
        continue
      }
      const missionId = resolveMissionId(context, ref)
      if (missionId == null) return null
      if (!missionIds.includes(missionId)) missionIds.push(missionId)
    }
    for (const missionId of missionIds) {
      tasks.push({
        kind: 'expedition',
        missionId,
        count: object.times,
        slot,
      })
    }
  }
  return {
    tasks,
    partial: Boolean(requirement.groups || requirement.disallowed || requirement.resources),
  }
}

const decodeSink = (requirement: any): KcwikiTrackerDraft | null => {
  if (!Number.isInteger(requirement.amount) || requirement.amount <= 0) return null
  if (typeof requirement.ship !== 'string') return null
  const stypes = resolveEnemyStypes(requirement.ship)
  if (!stypes?.length) return null
  return {
    tasks: [{ kind: 'sinkEnemy', stypes, count: requirement.amount }],
    partial: false,
  }
}

const minimum = (raw: unknown, fallback = 1): number | null => {
  const value = Array.isArray(raw) ? raw[0] : (raw ?? fallback)
  return Number.isInteger(value) && (value as number) > 0 ? value as number : null
}

const amountBounds = (raw: unknown): { min: number; max?: number } | null => {
  const source = raw ?? 1
  if (!Array.isArray(source)) {
    return Number.isInteger(source) && (source as number) > 0
      ? { min: source as number }
      : null
  }
  if (
    source.length < 2 ||
    !Number.isInteger(source[0]) ||
    !Number.isInteger(source[1]) ||
    source[0] < 0 ||
    source[1] < source[0]
  ) return null
  return { min: source[0], max: source[1] }
}

const decodeFleetGroup = (
  raw: any,
  context: KcwikiRuleContext,
): QpFleetGoalGroup | null => {
  if (!raw || typeof raw !== 'object') return null
  if (raw.shipclass !== undefined && raw.ship !== undefined) return null

  let tokens: string[] = []
  let selectors: (ShipSelector | null)[] = []
  let ctypes: number[] = []
  if (raw.shipclass !== undefined) {
    const rawClasses = Array.isArray(raw.shipclass) ? raw.shipclass : [raw.shipclass]
    if (!rawClasses.length) return null
    tokens = rawClasses
      .map((token: unknown) => typeof token === 'string' ? token.trim() : '')
      .filter(Boolean)
    if (tokens.length !== rawClasses.length) return null
    for (const token of tokens) {
      const ctype = context.shipClassIdByName.get(token)
      if (!ctype) return null
      if (!ctypes.includes(ctype)) ctypes.push(ctype)
    }
  } else {
    const rawTokens: unknown[] = Array.isArray(raw.ship) ? raw.ship : [raw.ship]
    tokens = rawTokens
      .flatMap((token: unknown) => typeof token === 'string' ? token.split(',') : [])
      .map((token: string) => token.trim())
      .filter(Boolean)
    if (!tokens.length) return null
    selectors = tokens.map(
      (token: string) => resolveFriendlyShipToken(context, token),
    )
    if (selectors.some((selector: ShipSelector | null) => !selector)) return null
  }

  const special = selectors.filter((selector: ShipSelector | null) =>
    selector?.kind === 'any' ||
    selector?.kind === 'other' ||
    selector?.kind === 'speed' ||
    selector?.kind === 'slowBattleship',
  ) as ShipSelector[]
  if (special.length && (special.length !== 1 || selectors.length !== 1)) return null

  if (raw.select !== undefined && raw.amount !== undefined) return null
  const bounds = amountBounds(raw.select ?? raw.amount)
  const lv = raw.lv === undefined ? undefined : minimum(raw.lv)
  if (!bounds || (raw.lv !== undefined && lv == null)) return null
  const amount = bounds.min
  const position = raw.place === undefined ? undefined : minimum(raw.place)
  if (
    (raw.place !== undefined && (position == null || position > 7 || amount !== 1)) ||
    (raw.flagship === true && position !== undefined && position !== 1)
  ) return null
  const group: QpFleetGoalGroup = {
    label: ctypes.length ? tokens.map((token) => `${token}级`).join(' / ') : tokens.join(' / '),
    ships: [],
    stypes: [],
    amount,
  }
  if (ctypes.length) group.ctypes = ctypes
  if (bounds.max !== undefined) group.maxAmount = bounds.max
  if (raw.flagship === true) group.flagship = true
  if (position != null) group.position = position
  if (lv != null) group.lv = lv

  const one = special[0]
  if (one?.kind === 'any') group.ships = 'any'
  else if (one?.kind === 'other') group.ships = 'other'
  else if (one?.kind === 'speed') {
    group.ships = 'any'
    group.speedMin = one.min
  } else if (one?.kind === 'slowBattleship') {
    group.stypes = [8, 9]
    group.speedMax = 5
  } else {
    const shipIds: number[] = []
    const stypes: number[] = []
    for (const selector of selectors) {
      if (selector?.kind === 'ships') shipIds.push(...selector.ids)
      if (selector?.kind === 'stypes') stypes.push(...selector.ids)
    }
    group.ships = [...new Set(shipIds)]
    group.stypes = [...new Set(stypes)]
  }
  return group
}

const decodeFleetGoal = (
  requirement: any,
  context: KcwikiRuleContext,
): QpFleetGoal | null => {
  const rawGroups = requirement.groups === undefined ? [] : requirement.groups
  if (!Array.isArray(rawGroups)) return null
  const groups = rawGroups.map((group: any) => decodeFleetGroup(group, context))
  if (groups.some((group: QpFleetGoalGroup | null) => !group)) return null
  const goal: QpFleetGoal = { groups: groups as QpFleetGoalGroup[] }
  if (requirement.fleetid !== undefined) {
    if (!Number.isInteger(requirement.fleetid) || requirement.fleetid <= 0) return null
    goal.fleetId = requirement.fleetid
  }
  if (requirement.disallowed !== undefined) {
    if (typeof requirement.disallowed !== 'string') return null
    const selector = resolveFriendlyShipToken(context, requirement.disallowed)
    if (!selector) return null
    if (selector.kind === 'other' && goal.groups.length) {
      // 「任意组×k + 他の艦禁止」是 kcwiki 对「合計N隻以下」的编码（By2：
      // 海防艦3+艦2+他の艦 = 海防≥3 且总数≤5）。任意组是允许额度不是下限：
      // 照下限校验，3 海防 + 1 任意舰的 4 隻合规编成会被「其它舰 0」误杀
      //（2026-08-12 用户实锤）；总数上限也从没人管——6 海防反而能过。
      // 全库核对过：带 disallowed 的任意组只有 By2 这一种用法，
      // 不带 disallowed 的「艦×k」（满编类任务）仍按下限处理，不受影响。
      const plainAny = goal.groups.filter(
        (group) =>
          group.ships === 'any' &&
          !group.flagship &&
          group.position === undefined &&
          group.lv === undefined &&
          group.speedMin === undefined &&
          group.speedMax === undefined &&
          group.maxAmount === undefined,
      )
      if (plainAny.length) {
        goal.maxShips = goal.groups.reduce((sum, group) => sum + group.amount, 0)
        goal.groups = goal.groups.filter((group) => !plainAny.includes(group))
      } else {
        goal.allowOnlyGoalShips = true
      }
    } else if (selector.kind === 'stypes') goal.disallowedStypes = selector.ids
    else return null
  }
  return goal.groups.length ||
    goal.fleetId !== undefined ||
    goal.disallowedStypes?.length ||
    goal.maxShips !== undefined
    ? goal
    : null
}

const decodeFleet = (
  requirement: any,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => {
  const fleetGoal = decodeFleetGoal(requirement, context)
  return fleetGoal ? { tasks: [], partial: false, fleetGoal } : null
}

const SORTIE_RANK: Record<string, number> = {
  C: 3,
  B: 4,
  A: 5,
  S: 6,
}

const parseMap = (raw: unknown): [number, number] | null => {
  if (typeof raw !== 'string') return null
  const match = raw.trim().match(/^(\d+)-(\d+)$/)
  if (!match) return null
  const area = parseInt(match[1], 10)
  const info = parseInt(match[2], 10)
  // 活动海域的多 Boss 判据没有实测；宁可暂不生成规则。
  return area > 0 && area <= 10 && info > 0 ? [area, info] : null
}

const sortieMaps = (raw: unknown): [number, number][] | null => {
  if (raw === undefined) return []
  const source = Array.isArray(raw) ? raw : [raw]
  const maps: [number, number][] = []
  for (const value of source) {
    if (typeof value !== 'string') return null
    const range = value.trim().match(/^(\d+)-(\d+)\s*~\s*(\d+)-(\d+)$/)
    if (range) {
      const startArea = parseInt(range[1], 10)
      const startInfo = parseInt(range[2], 10)
      const endArea = parseInt(range[3], 10)
      const endInfo = parseInt(range[4], 10)
      if (startArea !== endArea || startArea <= 0 || startArea > 10 || startInfo > endInfo) return null
      for (let info = startInfo; info <= endInfo; info += 1) maps.push([startArea, info])
      continue
    }
    const parsed = parseMap(value)
    if (!parsed) return null
    maps.push(parsed)
  }
  return [...new Map(maps.map((map) => [`${map[0]}-${map[1]}`, map] as const)).values()]
}

const decodeSortie = (
  requirement: any,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => {
  if (!Number.isInteger(requirement.times) || requirement.times <= 0) return null
  const maps = sortieMaps(requirement.map)
  if (!maps) return null
  const result = requirement.result
  if (result !== undefined && result !== 'クリア' && SORTIE_RANK[result] === undefined) return null
  if (result === 'クリア' && !maps.length) return null
  if (requirement.boss === true && !maps.length) return null

  let fleetGoal: QpFleetGoal | undefined
  if (
    requirement.groups !== undefined ||
    requirement.disallowed !== undefined ||
    requirement.fleetid !== undefined
  ) {
    const decoded = decodeFleetGoal(requirement, context)
    if (!decoded) return null
    fleetGoal = decoded
  }

  const rank = result === undefined ? 0 : SORTIE_RANK[result] ?? 0
  // map 的两种写法在 kcwiki 库里语义不同(2026-08-12 用户报出 905 的四图 Boss 胜
  // 被并成「或」后全包核对):
  //   范围字符串「2-1 ~ 2-5」= 范围内**任意图**凑 times 次——实存仅 226/229/241,
  //   全是周常池计数 → 共享一个槽(或);
  //   数组 ["1-1","1-2",…] = **逐图各** times 次——实存 30+ 条(291/292 各图×2 等),
  //   236 另有 EO 独立编码逐图分槽的交叉印证 → 每图一个槽(且)。
  // 逐图型不得并成共享槽(slot:0):那样打任意一图就算满,是会误导的错。
  const pooled = typeof requirement.map === 'string' && /~/.test(requirement.map)
  const tasks: QpTask[] = maps.length
    ? maps.map((map, index) => {
        const slot = pooled ? 0 : index
        if (result === 'クリア') {
          // 护航图（1-6）没有 Boss：「クリア」= 到达终点，每次都算；
          // 按海域首通口径的话，已通关提督永远无法计数（2026-08-12 用户实锤）
          return isEscortGoalMap(map)
            ? { kind: 'mapGoal', map, count: requirement.times, slot }
            : { kind: 'mapFirstClear', map, count: requirement.times, slot }
        }
        if (requirement.boss === true) {
          return { kind: 'bossKill', map, rank, count: requirement.times, slot }
        }
        return {
          kind: 'battleNode',
          map,
          rank,
          count: requirement.times,
          nodes: [],
          name: null,
          slot,
        }
      })
    : [{ kind: 'battleWin', rank, count: requirement.times }]
  return { tasks, partial: false, ...(fleetGoal ? { fleetGoal } : {}) }
}

const decodeScraps = (
  rawList: unknown,
  context: KcwikiRuleContext,
): { tasks: QpTask[]; stockGoals: QpStockGoal[] } | null => {
  if (!Array.isArray(rawList)) return null
  const tasks: QpTask[] = []
  const stockGoals: QpStockGoal[] = []
  let slot = 0
  for (const raw of rawList) {
    if (typeof raw?.name !== 'string' || !Number.isInteger(raw.amount) || raw.amount <= 0) return null
    const target = resolveEquipmentTarget(context, raw.name)
    if (!target) return null
    if (target.kind === 'useitem') {
      stockGoals.push({ kind: 'useitem', id: target.id, label: raw.name, count: raw.amount })
      continue
    }
    if (target.kind === 'equip') {
      tasks.push({ kind: 'scrapEquip', equipId: target.id, count: raw.amount, slot })
    } else {
      for (const category of target.ids) {
        tasks.push({ kind: 'scrapCategory', category, count: raw.amount, slot })
      }
    }
    slot += 1
  }
  return { tasks, stockGoals }
}

const decodeStockList = (
  rawList: unknown,
  context: KcwikiRuleContext,
  kind: 'equipment' | 'consumption',
): QpStockGoal[] | null => {
  if (rawList === undefined) return []
  if (!Array.isArray(rawList)) return null
  const goals: QpStockGoal[] = []
  for (const raw of rawList) {
    if (typeof raw?.name !== 'string' || !Number.isInteger(raw.amount) || raw.amount <= 0) return null
    const target = resolveEquipmentTarget(context, raw.name)
    if (!target) return null
    if (kind === 'equipment') {
      if (target.kind === 'equip') {
        goals.push({ kind: 'equip', id: target.id, label: raw.name, count: raw.amount })
      } else if (target.kind === 'category') {
        goals.push({ kind: 'equipCategory', ids: target.ids, label: raw.name, count: raw.amount })
      } else {
        goals.push({ kind: 'useitem', id: target.id, label: raw.name, count: raw.amount })
      }
    } else {
      if (target.kind !== 'useitem') return null
      goals.push({ kind: 'useitem', id: target.id, label: raw.name, count: raw.amount })
    }
  }
  return goals
}

const MATERIAL_LABELS = ['燃料', '弹药', '钢材', '铝土']

const decodeResourceGoals = (raw: unknown): QpStockGoal[] | null => {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length < 4) return null
  const goals: QpStockGoal[] = []
  for (let id = 0; id < 4; id += 1) {
    const count = raw[id]
    if (!Number.isInteger(count) || count < 0) return null
    if (count > 0) goals.push({ kind: 'material', id, label: MATERIAL_LABELS[id], count })
  }
  return goals
}

const decodeFactory = (
  requirement: any,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => {
  const scrapSource = requirement.category === 'scrapequipment'
    ? requirement.list
    : requirement.scraps
  const scraps = scrapSource === undefined
    ? { tasks: [], stockGoals: [] }
    : decodeScraps(scrapSource, context)
  if (!scraps) return null
  const equipments = decodeStockList(requirement.equipments, context, 'equipment')
  const consumptions = decodeStockList(requirement.consumptions, context, 'consumption')
  const resources = decodeResourceGoals(requirement.resources)
  if (!equipments || !consumptions || !resources) return null
  const stockGoals = [...scraps.stockGoals, ...equipments, ...resources, ...consumptions]
  if (!scraps.tasks.length && !stockGoals.length) return null
  return {
    tasks: scraps.tasks,
    ...(stockGoals.length ? { stockGoals } : {}),
    partial: false,
  }
}

/**
 * あ号作戦（Bw1 / 214）。四轴口径逐条都有出处：
 * - 出撃 36：字面的**出港次数**，不需要打起来（6-1 带 2 战舰走 B 格「気のせいだった」
 *   零战斗回港照样 +1，见 wikiwiki 6-1 页与 ElectronicObserver 的 kcmemo），故用 action:sortie
 *   计在 `api_req_map/start`；
 * - ボス到達 24：**在 boss 格打完一战**才计，与胜负无关（理由见 quest-counter 的 bossReach 分支）；
 * - ボス撃破 12：B 勝利以上即可（wikiwiki 任務攻略データ：「ボス勝利はAやBでも良い」）；
 * - S勝利 6：**道中 S 也算**、不限 boss 格（同上：「S勝利は道中でも良く」），演習不算
 *   （演習走 practice 分支，本引擎在那条路上只认 exercise 任务）。
 *
 * `approx`：活动开着的时候这条任务**做不到精确**。多血条活动海域里只有**最终血条**的
 * boss 格才被判进あ号，而中间血条的 boss 格在报文里同样是 `api_event_id == 5`，
 * 从 API 分不出来——日本社区叫「イベあ号問題」，KancolleSniffer 与 ElectronicObserver
 * 的 FAQ 都写明各自修不了（前者原话「判別する手段がありません」）。
 * 我们同样分不出来，所以**不假装精确**：活动期间标 ≈，让玩家知道这个数可能偏多；
 * 平时（主数据里没有活动海图）四轴都是精确的，不打这个标。
 *
 * 反例注意：常规图 7-2 有两个 boss 格（G / M），**第一个 boss 也算**
 * （wikiwiki 任務攻略データ 明写），别把活动图那条规则推广到常规图。
 */
const decodeAGou = (context: KcwikiRuleContext): KcwikiTrackerDraft => ({
  tasks: [
    { kind: 'action', action: 'sortie', label: '出击', count: 36, slot: 0 },
    { kind: 'bossReach', count: 24, slot: 1 },
    { kind: 'bossWin', rank: 4, count: 12, slot: 2 },
    { kind: 'battleWin', rank: 6, count: 6, slot: 3 },
  ],
  partial: false,
  approx: context.eventRunning,
})

const decodeSimple = (requirement: any): KcwikiTrackerDraft | null => {
  if (!Number.isInteger(requirement.times) || requirement.times <= 0) return null
  const count = requirement.times
  if (requirement.subcategory === 'battle') {
    return { tasks: [{ kind: 'battleWin', rank: 0, count }], partial: false }
  }
  const actions = {
    resupply: { action: 'charge', label: '补给' },
    repair: { action: 'nyukyo', label: '入渠' },
    scrapequipment: { action: 'destroyitem', label: '废弃装备' },
    scrapship: { action: 'destroyship', label: '解体舰船' },
  } as const
  const target = actions[requirement.subcategory as keyof typeof actions]
  if (!target) return null
  // kcwiki 的 batch 字段：上游 kcwikizh/kcwiki-quest-data 的 types/index.ts 在
  // simple/scrapequipment 上把它注释为「for scrapequipment / scrapping together is ok」——
  // 即 batch:true = 一括廃棄可 = **按件**计，batch:false/缺省 = **按操作回数**计。
  // 已用游戏日文原文逐条复核，量词切得干干净净、两族零重叠：
  //   batch:false ←→ 「N 回「廃棄」」：610（4回）/611（2回）/612（3回），604/617 同族
  //     613「資源の再利用」正文只写「なるべく多く」不带数字，24 回来自 wiki；
  //     已由用户实测钉死：批量弃 10+10+2 件进度几乎没动，改逐件弃才在第 24 次操作达成
  //     （见 quest-counter-rules 的 actionIncrement 出处）。
  //   batch:true  ←→ 「装備アイテムを N つ「廃棄」」：624（7つ）/625（9つ）/634（9つ）/635（5つ）
  //     wikiwiki「任務/工廠任務」逐条备注「まとめて複数廃棄しても可」，
  //     且对 613 反过来写「まとめて廃棄すると『廃棄1回分』としてカウントされるので注意」。
  // 635 专查：本地 quests-scn 的 memo2 写「废弃装备五次」，与 batch:true 冲突——查实是中文
  // **误译**。日文原文为「「工廠」で装備アイテムを5つ「廃棄」して、新装備配備の準備をします。」
  // ——「5つ」是件数不是回数，同任务正文的中文 desc 也写作「废弃 5 件装备」，与 625/634 同型。
  // 即上游 batch 标注对 635 是对的，错的是 memo2 那一栏。memo2 的「次」本就不可当量词读：
  // 609 已独立证伪（memo2 写「解体舰船2次」，而用户实测一次批量解体 2 艘即达成 = 按艘）。
  // 这两句误译本身已于 2026-08-27 走 shared/quest-text-corrections 在加载期校正
  //（635→「废弃5件装备」、609→「解体2艘舰船」）；上面引的是**上游原文**，
  // 判定不读 memo2 那一栏，所以这条 batch 分流的依据不受校正影响。
  const perItem = target.action === 'destroyitem' && requirement.batch === true
  return {
    tasks: [{
      kind: 'action',
      action: target.action,
      label: target.label,
      count,
      ...(perItem ? { perItem: true as const } : {}),
    }],
    partial: false,
  }
}

const decodeSecretary = (
  raw: unknown,
  context: KcwikiRuleContext,
): QpStateGoalSecretary | null => {
  const source = Array.isArray(raw) ? raw : [raw]
  const tokens = source
    .map((token) => typeof token === 'string' ? token.trim() : '')
    .filter(Boolean)
  if (!tokens.length || tokens.length !== source.length) return null
  const selectors = tokens.map((token) => resolveFriendlyShipToken(context, token))
  if (selectors.some((selector) => !selector)) return null
  if (selectors.some((selector) => selector?.kind === 'any')) {
    return selectors.length === 1
      ? { label: '任意舰', ships: 'any', stypes: [] }
      : null
  }
  const ships: number[] = []
  const stypes: number[] = []
  for (const selector of selectors) {
    if (selector?.kind === 'ships') ships.push(...selector.ids)
    else if (selector?.kind === 'stypes') stypes.push(...selector.ids)
    else return null
  }
  return {
    label: tokens.join(' / '),
    ships: [...new Set(ships)],
    stypes: [...new Set(stypes)],
  }
}

const modelEquipmentGoal = (
  rawName: unknown,
  context: KcwikiRuleContext,
  options: { slot?: unknown; fullySkilled?: unknown; maxModified?: unknown } = {},
): QpStateGoalEquipment | null => {
  if (typeof rawName !== 'string' || !rawName.trim()) return null
  const target = resolveEquipmentTarget(context, rawName)
  if (!target || target.kind !== 'equip') return null
  if (
    (options.fullySkilled !== undefined && typeof options.fullySkilled !== 'boolean') ||
    (options.maxModified !== undefined && typeof options.maxModified !== 'boolean')
  ) return null
  const slot = options.slot === undefined ? undefined : minimum(options.slot)
  if (options.slot !== undefined && (slot == null || slot > 5)) return null
  return {
    label: rawName.trim(),
    mstIds: [target.id],
    ...(slot != null ? { slot } : {}),
    ...(options.fullySkilled === true ? { fullySkilled: true } : {}),
    ...(options.maxModified === true ? { maxModified: true } : {}),
  }
}

const decodeModelConversion = (
  requirement: any,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => {
  const equipment: QpStateGoalEquipment[] = []
  if (requirement.equipment !== undefined) {
    const source = Array.isArray(requirement.equipment)
      ? requirement.equipment
      : [requirement.equipment]
    if (!source.length) return null
    for (const rawName of source) {
      const goal = modelEquipmentGoal(rawName, context, {
        fullySkilled: requirement.fullyskilled,
        maxModified: requirement.maxmodified,
      })
      if (!goal) return null
      equipment.push(goal)
    }
  }
  if (requirement.slots !== undefined) {
    if (!Array.isArray(requirement.slots) || !requirement.slots.length) return null
    for (const raw of requirement.slots) {
      const goal = modelEquipmentGoal(raw?.equipment, context, {
        slot: raw?.slot,
        fullySkilled: raw?.fullyskilled,
        maxModified: raw?.maxmodified,
      })
      if (!goal) return null
      equipment.push(goal)
    }
  }

  const secretaryRaw = requirement.secretary ?? (equipment.length ? '艦' : undefined)
  const secretary = secretaryRaw === undefined
    ? undefined
    : decodeSecretary(secretaryRaw, context)
  if (secretaryRaw !== undefined && !secretary) return null
  const stateGoal: QpStateGoal | undefined = secretary || equipment.length
    ? {
        ...(secretary ? { secretary } : {}),
        ...(equipment.length ? { equipment } : {}),
      }
    : undefined

  const scraps = requirement.scraps === undefined
    ? { tasks: [], stockGoals: [] }
    : decodeScraps(requirement.scraps, context)
  if (!scraps) return null
  // modelconversion 的 consumptions 同时会放 useitem 与普通装备，统一按库存目标解析。
  const consumptions = decodeStockList(requirement.consumptions, context, 'equipment')
  const resources = decodeResourceGoals(requirement.resources)
  if (!consumptions || !resources) return null
  const stockGoals = [...scraps.stockGoals, ...resources, ...consumptions]
  if (!stateGoal && !scraps.tasks.length && !stockGoals.length) return null
  return {
    tasks: scraps.tasks,
    ...(stateGoal ? { stateGoal } : {}),
    ...(stockGoals.length ? { stockGoals } : {}),
    // use_skilled_crew 的含义尚未查证；不把它硬造为库存门，并阻止本地推定完成。
    partial: requirement.use_skilled_crew === true,
  }
}

const decodeExercise = (
  requirement: any,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => {
  if (!Number.isInteger(requirement.times) || requirement.times <= 0) return null
  if (requirement.victory !== undefined && requirement.victory !== true) return null
  let fleetGoal: QpFleetGoal | undefined
  if (requirement.groups !== undefined) {
    const decoded = decodeFleetGoal(requirement, context)
    if (!decoded) return null
    fleetGoal = decoded
  }
  return {
    tasks: [{
      kind: 'exercise',
      rank: requirement.victory === true ? 4 : 0,
      count: requirement.times,
    }],
    partial: false,
    ...(fleetGoal ? { fleetGoal } : {}),
  }
}

const hasDraftContent = (draft: KcwikiTrackerDraft): boolean =>
  draft.tasks.length > 0 ||
  Boolean(draft.fleetGoal) ||
  Boolean(draft.stateGoal) ||
  Boolean(draft.stockGoals?.length)

const sameFleetGoal = (left: QpFleetGoal, right: QpFleetGoal): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

function decodeKcwikiRequirementAt(
  requirement: unknown,
  context: KcwikiRuleContext,
  depth: number,
): KcwikiTrackerDraft | null {
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) return null
  const raw = requirement as any
  if (raw.category === 'and' || raw.category === 'or' || raw.category === 'then') {
    // 当前规则库没有超过一层的可靠样本；拒绝嵌套组合，避免无限递归和半条规则。
    if (depth >= 1 || !Array.isArray(raw.list) || !raw.list.length) return null
    const children = raw.list.map((child: unknown) =>
      decodeKcwikiRequirementAt(child, context, depth + 1),
    )
    if (
      children.some((child: KcwikiTrackerDraft | null) => !child || !hasDraftContent(child))
    ) return null
    const decoded = children as KcwikiTrackerDraft[]

    if (raw.category === 'or') {
      if (
        decoded.some((child) =>
          !child.tasks.length ||
          child.stockGoals?.length ||
          child.stateGoal ||
          qpTaskGroups(child.tasks).length !== 1,
        )
      ) return null
      return {
        tasks: decoded.flatMap((child) =>
          child.tasks.map((task) => ({
            ...task,
            slot: 0,
            ...(child.fleetGoal ? { fleetGoal: child.fleetGoal } : {}),
          })),
        ),
        partial: decoded.some((child) => child.partial),
      }
    }

    const taskBearingChildren = decoded.filter((child) => child.tasks.length)
    const firstGoal = taskBearingChildren[0]?.fleetGoal
    const commonFleetGoal = firstGoal && taskBearingChildren.every(
      (child) => child.fleetGoal && sameFleetGoal(firstGoal, child.fleetGoal),
    )
      ? firstGoal
      : undefined
    let nextSlot = 0
    const tasks: QpTask[] = []
    for (const child of decoded) {
      const slotMap = new Map<number, number>()
      for (const group of qpTaskGroups(child.tasks)) {
        slotMap.set(group.slot, nextSlot)
        nextSlot += 1
      }
      child.tasks.forEach((task, index) => {
        const originalSlot = Number.isInteger(task.slot) ? task.slot as number : index
        tasks.push({
          ...task,
          slot: slotMap.get(originalSlot),
          ...(!commonFleetGoal && child.fleetGoal ? { fleetGoal: child.fleetGoal } : {}),
        })
      })
    }
    const stockGoals = decoded.flatMap((child) => child.stockGoals ?? [])
    const stateGoals = decoded
      .map((child) => child.stateGoal)
      .filter((goal): goal is QpStateGoal => Boolean(goal))
    const stateGoal = stateGoals[0]
    if (stateGoals.some((goal) => !stateGoal || JSON.stringify(goal) !== JSON.stringify(stateGoal))) {
      return null
    }
    return {
      tasks,
      ...(commonFleetGoal ? { fleetGoal: commonFleetGoal } : {}),
      ...(stateGoal ? { stateGoal } : {}),
      ...(stockGoals.length ? { stockGoals } : {}),
      partial: raw.category === 'then' || decoded.some((child) => child.partial),
    }
  }
  if (raw.category === 'expedition') return decodeExpedition(raw, context)
  if (raw.category === 'sink') return decodeSink(raw)
  if (raw.category === 'fleet') return decodeFleet(raw, context)
  if (raw.category === 'sortie') return decodeSortie(raw, context)
  if (raw.category === 'excercise') return decodeExercise(raw, context)
  if (raw.category === 'modelconversion') return decodeModelConversion(raw, context)
  if (raw.category === 'scrapequipment' || raw.category === 'equipexchange') {
    return decodeFactory(raw, context)
  }
  if (raw.category === 'simple') return decodeSimple(raw)
  if (raw.category === 'a-gou') return decodeAGou(context)
  return null
}

export interface FleetGoalShipView {
  mstId: number
  stype: number
  ctype: number
  soku: number
  lv: number
}

const selectorMatches = (
  group: QpFleetGoalGroup,
  ship: FleetGoalShipView,
  concreteGroups: QpFleetGoalGroup[],
): boolean => {
  let selected = false
  if (group.ships === 'any') selected = true
  else if (group.ships === 'other') {
    selected = !concreteGroups.some((candidate) =>
      selectorMatches(candidate, ship, []),
    )
  } else {
    selected =
      group.ships.includes(ship.mstId) ||
      group.stypes.includes(ship.stype) ||
      Boolean(group.ctypes?.includes(ship.ctype))
  }
  if (!selected) return false
  if (group.lv !== undefined && ship.lv < group.lv) return false
  if (group.speedMin !== undefined && ship.soku < group.speedMin) return false
  if (group.speedMax !== undefined && ship.soku > group.speedMax) return false
  return true
}

const groupsCanUseDistinctShips = (
  groups: QpFleetGoalGroup[],
  fleet: FleetGoalShipView[],
): boolean => {
  const concrete = groups.filter((group) => group.ships !== 'any' && group.ships !== 'other')
  // overlapOk 伞组（「含旗舰/含具名舰」口径）不占去重名额：它的成员本来就
  // 允许与其他组是同一艘，数量线在 evaluateFleetGoal 的逐组计数里独立把关。
  const needs = groups.filter((group) => !group.overlapOk).flatMap((group, groupIndex) =>
    Array.from({ length: group.amount }, (_, amountIndex) => ({
      groupIndex,
      candidates: fleet
        .map((ship, index) => ({ ship, index }))
        .filter(({ ship, index }) =>
          (!group.flagship || amountIndex > 0 || index === 0) &&
          (group.position === undefined || index === group.position - 1) &&
          selectorMatches(group, ship, concrete),
        )
        .map(({ index }) => index),
    })),
  ).sort((left, right) => left.candidates.length - right.candidates.length)
  const used = new Set<number>()
  const assign = (index: number): boolean => {
    if (index >= needs.length) return true
    for (const candidate of needs[index].candidates) {
      if (used.has(candidate)) continue
      used.add(candidate)
      if (assign(index + 1)) return true
      used.delete(candidate)
    }
    return false
  }
  return assign(0)
}

export const evaluateFleetGoal = (
  goal: QpFleetGoal,
  fleet: FleetGoalShipView[],
  deckId: number,
): QpFleetDeckDiff => {
  const lines: QpFleetDeckDiff['lines'] = []
  if (goal.fleetId !== undefined && deckId !== goal.fleetId) {
    lines.push({
      label: `第${goal.fleetId}舰队`,
      current: deckId,
      required: goal.fleetId,
      ok: false,
      issue: `仅限第${goal.fleetId}舰队`,
    })
  }
  const concrete = goal.groups.filter((group) => group.ships !== 'any' && group.ships !== 'other')
  for (const group of goal.groups) {
    const candidates = group.position === undefined
      ? fleet
      : fleet.slice(group.position - 1, group.position)
    const current = candidates.filter((ship) => selectorMatches(group, ship, concrete)).length
    const flagshipOk = !group.flagship ||
      Boolean(fleet[0] && selectorMatches(group, fleet[0], concrete))
    const maximumOk = group.maxAmount === undefined || current <= group.maxAmount
    const ok = flagshipOk && current >= group.amount && maximumOk
    lines.push({
      label: group.label,
      current,
      required: group.amount,
      ok,
      issue: ok
        ? null
        : !flagshipOk
          ? `旗舰不符合「${group.label}」`
          : group.position !== undefined
            ? `${group.position}号位不符合「${group.label}」`
            : !maximumOk
              ? `「${group.label}」最多 ${group.maxAmount} 艘（当前 ${current}）`
          : `还差 ${Math.max(0, group.amount - current)} 艘「${group.label}」`,
    })
  }
  if (goal.maxShips !== undefined) {
    // 「合計N隻以下」：超编不通过；没编满不扣分（以下=至多，不是恰好）
    lines.push({
      label: '总数上限',
      current: fleet.length,
      required: goal.maxShips,
      ok: fleet.length <= goal.maxShips,
      issue: fleet.length <= goal.maxShips ? null : `最多 ${goal.maxShips} 艘（当前 ${fleet.length}）`,
    })
  }
  if (goal.disallowedStypes?.length) {
    const disallowed = fleet.filter((ship) => goal.disallowedStypes!.includes(ship.stype)).length
    lines.push({
      label: '禁止舰种',
      current: disallowed,
      required: 0,
      ok: disallowed === 0,
      issue: disallowed ? `含 ${disallowed} 艘禁止舰种` : null,
    })
  }
  if (goal.allowOnlyGoalShips) {
    const extras = fleet.filter((ship) =>
      !concrete.some((group) => selectorMatches(group, ship, concrete)),
    ).length
    lines.push({
      label: '其它舰',
      current: extras,
      required: 0,
      ok: extras === 0,
      issue: extras ? `含 ${extras} 艘要求以外的舰娘` : null,
    })
  }
  if (
    lines.every((line) => line.ok) &&
    !groupsCanUseDistinctShips(goal.groups, fleet)
  ) {
    lines.push({
      label: '编成成员',
      current: fleet.length,
      required: goal.groups.reduce((sum, group) => sum + group.amount, 0),
      ok: false,
      issue: '同一艘舰不能同时满足多个名额',
    })
  }
  return { deckId, ok: lines.every((line) => line.ok), lines }
}

export const decodeKcwikiRequirement = (
  requirement: unknown,
  context: KcwikiRuleContext,
): KcwikiTrackerDraft | null => decodeKcwikiRequirementAt(requirement, context, 0)
