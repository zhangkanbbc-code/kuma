type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max
const isString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max
const isInteger = (value: unknown, min = 0, max = 1_000_000) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max
const isIntegerArray = (value: unknown, maxItems: number, min = 0, max = 1_000_000) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => isInteger(item, min, max))
const isDateText = (value: unknown) =>
  typeof value === 'string' && value.length <= 100 && /^\d{4}-\d{2}-\d{2}/.test(value)
const isCalendarDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isValidCalendarDate = (value: unknown): value is string => {
  if (!isCalendarDate(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const isIsoDateTime = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 100 &&
  ISO_DATE_TIME.test(value) &&
  isValidCalendarDate(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value))

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/
const SAFE_SPOT = /^[A-Za-z0-9]{1,8}$/
const SAFE_MAP = /^\d+-\d+$/
const SAFE_EDGE = /^\d+$/
const SAFE_NUMERIC_ID = /^\d{1,8}$/
const SAFE_EXTRA_VOICE_ID = /^\d{1,12}$/
const SAFE_EXPEDITION_ID = /^[A-Za-z0-9]{1,8}$/
const DANGEROUS_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const LOCALIZATION_DOMAINS = new Set([
  'ship',
  'abyssShip',
  'equip',
  'abyssEquip',
  'item',
  'map',
  'mapArea',
  'shipType',
  'equipType',
  'expedition',
  'quest',
])

interface JsonLimits {
  maxDepth: number
  maxNodes: number
  maxString: number
  maxArray: number
  maxObject: number
}

const validateBoundedJson = (
  value: unknown,
  prefix: string,
  limits: JsonLimits = {
    maxDepth: 16,
    maxNodes: 1_000_000,
    maxString: 20_000,
    maxArray: 10_000,
    maxObject: 10_000,
  },
): string | null => {
  let nodes = 0
  const walk = (current: unknown, depth: number, at: string): string | null => {
    nodes += 1
    if (nodes > limits.maxNodes) return `${prefix} 节点总数过多`
    if (depth > limits.maxDepth) return `${at} 嵌套过深`
    if (current === null || typeof current === 'boolean') return null
    if (typeof current === 'string') {
      return current.length <= limits.maxString ? null : `${at} 字符串过长`
    }
    if (typeof current === 'number') {
      return Number.isFinite(current) && Math.abs(current) <= 1_000_000_000_000_000
        ? null
        : `${at} 数值非法`
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maxArray) return `${at} 数组过长`
      for (let index = 0; index < current.length; index++) {
        const error = walk(current[index], depth + 1, `${at}[${index}]`)
        if (error) return error
      }
      return null
    }
    if (!isRecord(current)) return `${at} 含非 JSON 值`
    const entries = Object.entries(current)
    if (entries.length > limits.maxObject) return `${at} 对象字段过多`
    for (const [key, child] of entries) {
      if (
        !key.length ||
        key.length > 300 ||
        DANGEROUS_JSON_KEYS.has(key) ||
        /[\u0000-\u001f]/.test(key)
      ) {
        return `${at} 含危险或过长字段名`
      }
      const error = walk(child, depth + 1, `${at}.${key}`)
      if (error) return error
    }
    return null
  }
  return walk(value, 0, prefix)
}

const validateFcdMap = (data: unknown): string | null => {
  if (!isRecord(data)) return 'data 必须是对象'
  if (Object.keys(data).length > 500) return 'poi-fcd-map 海图条目过多'
  for (const [mapKey, rawMap] of Object.entries(data)) {
    if (!SAFE_MAP.test(mapKey) || !isRecord(rawMap)) return `非法海图项 ${mapKey}`
    const spots = rawMap.spots
    const route = rawMap.route
    if (spots !== undefined) {
      if (!isRecord(spots)) return `${mapKey}.spots 必须是对象`
      if (Object.keys(spots).length > 200) return `${mapKey}.spots 条目过多`
      for (const [spot, raw] of Object.entries(spots)) {
        if (!SAFE_SPOT.test(spot) || !Array.isArray(raw) || raw.length < 2) {
          return `${mapKey}.spots.${spot} 形状非法`
        }
        const [x, y, kind = ''] = raw
        if (
          typeof x !== 'number' ||
          !Number.isFinite(x) ||
          Math.abs(x) > 100_000 ||
          typeof y !== 'number' ||
          !Number.isFinite(y) ||
          Math.abs(y) > 100_000 ||
          (kind !== '' && kind !== 'start')
        ) {
          return `${mapKey}.spots.${spot} 坐标或类型非法`
        }
      }
    }
    if (route !== undefined) {
      if (!isRecord(route)) return `${mapKey}.route 必须是对象`
      if (Object.keys(route).length > 500) return `${mapKey}.route 条目过多`
      for (const [edge, raw] of Object.entries(route)) {
        if (!SAFE_EDGE.test(edge) || !Array.isArray(raw) || raw.length < 2) {
          return `${mapKey}.route.${edge} 形状非法`
        }
        const [from, to] = raw
        if (
          (from !== null && (typeof from !== 'string' || !SAFE_SPOT.test(from))) ||
          typeof to !== 'string' ||
          !SAFE_SPOT.test(to)
        ) {
          return `${mapKey}.route.${edge} 端点非法`
        }
      }
    }
  }
  return null
}

const EVENT_DIFFICULTIES = new Set(['甲', '乙', '丙', '丁'])
const LIMITED_DROP_STATUSES = new Set([
  'active_confirmed',
  'end_pending',
  'ended_confirmed',
  'ended_undated',
])

const validateLimitedWindow = (window: unknown): boolean => {
  if (!isRecord(window)) return false
  const status = window.status
  return !(
    !isCalendarDate(window.from) ||
    (window.until !== null && !isCalendarDate(window.until)) ||
    !isCalendarDate(window.lastConfirmedAt) ||
    (typeof window.until === 'string' && window.until < window.from) ||
    (status !== undefined && !LIMITED_DROP_STATUSES.has(status as string)) ||
    (window.statusChangedAt !== undefined && !isCalendarDate(window.statusChangedAt)) ||
    (status === 'end_pending' && window.until !== null) ||
    (status === 'ended_confirmed' && !isCalendarDate(window.until)) ||
    // 「上游说它终了、但从没公布哪天」——没有日子才是这一档的定义，
    // 写了日子说明该用 ended_confirmed，两档不许混
    (status === 'ended_undated' && window.until !== null) ||
    // 哪次活动/纪念带进来的（wikiwiki 限定页小节标题）；旧包没有，可缺
    (window.label !== undefined &&
      (typeof window.label !== 'string' || !window.label || window.label.length > 60))
  )
}

/**
 * 一条敌编成。底座包（map-intel）与第一方汇编包（map-enemy-comps）共用同一份界，
 * 免得两边各写一份、哪天松掉一边都不知道。
 */
const validateEnemyComp = (rawComp: unknown, at: string): string | null => {
  const formationOk =
    isRecord(rawComp) &&
    ((Number.isInteger(rawComp.formation) &&
      (rawComp.formation as number) >= 1 &&
      (rawComp.formation as number) <= 99) ||
      isText(rawComp.formation, 100))
  if (
    !isRecord(rawComp) ||
    !formationOk ||
    !Array.isArray(rawComp.ships) ||
    rawComp.ships.length < 1 ||
    rawComp.ships.length > 12 ||
    rawComp.ships.some(
      (ship) =>
        !(
          (Number.isInteger(ship) && (ship as number) > 0 && (ship as number) <= 1_000_000) ||
          isText(ship, 200)
        ),
    ) ||
    (rawComp.phase !== undefined && !isText(rawComp.phase, 100)) ||
    // 基础经验：给了就必须是正整数。0 会被读成「这一战没经验」，
    // 上限拦住把别的列（制空值之类）错认成 EXP 的情况。
    (rawComp.exp !== undefined &&
      !(Number.isInteger(rawComp.exp) && (rawComp.exp as number) > 0 && (rawComp.exp as number) <= 100_000))
  ) {
    return `${at} 非法`
  }
  // labels 是 wiki 标注文本，给了就必须与 ships 等长——**长度对不上比没有更危险**：
  // 展示层按下标取名，错位一格就是在战斗界面上对着玩家说错敌人是谁。
  if (rawComp.labels !== undefined) {
    if (
      !Array.isArray(rawComp.labels) ||
      rawComp.labels.length !== rawComp.ships.length ||
      rawComp.labels.some((label) => !isText(label, 200))
    ) {
      return `${at}.labels 非法（必须与 ships 等长）`
    }
  }
  // 印证票与冲突标：运行时一行都不读，界上只拦住形状离谱的东西
  if (
    rawComp.votes !== undefined &&
    (!Array.isArray(rawComp.votes) ||
      rawComp.votes.length > 8 ||
      rawComp.votes.some((vote) => !isText(vote, 40)))
  ) {
    return `${at}.votes 非法`
  }
  if (rawComp.conflict !== undefined && !isText(rawComp.conflict, 60)) {
    return `${at}.conflict 非法`
  }
  return null
}

const validateMapIntelNodes = (rawNodes: unknown, prefix: string): string | null => {
  if (!isRecord(rawNodes)) return `${prefix}.nodes 必须是对象`
  if (Object.keys(rawNodes).length > 200) return `${prefix}.nodes 条目过多`
  for (const [spot, rawNode] of Object.entries(rawNodes)) {
    if (!SAFE_SPOT.test(spot) || !isRecord(rawNode)) return `${prefix}.${spot} 节点非法`
    if (
      (rawNode.emptyDrop !== 'confirmed' && rawNode.emptyDrop !== 'unknown') ||
      !Array.isArray(rawNode.ships) ||
      rawNode.ships.length > 2_000 ||
      !Array.isArray(rawNode.enemyComps) ||
      rawNode.enemyComps.length > 100
    ) {
      return `${prefix}.${spot} 的掉落或敌编成列表非法`
    }
    for (const [index, rawShip] of rawNode.ships.entries()) {
      if (
        !isRecord(rawShip) ||
        !Number.isInteger(rawShip.id) ||
        (rawShip.id as number) <= 0 ||
        (rawShip.id as number) > 1_000_000 ||
        (rawShip.limitedOnly !== undefined && typeof rawShip.limitedOnly !== 'boolean')
      ) {
        return `${prefix}.${spot}.ships[${index}] 非法`
      }
      if (rawShip.limited !== undefined) {
        if (!validateLimitedWindow(rawShip.limited)) {
          return `${prefix}.${spot}.ships[${index}].limited 非法`
        }
      }
      if (
        rawShip.limitedHistory !== undefined &&
        (!Array.isArray(rawShip.limitedHistory) ||
          rawShip.limitedHistory.length > 100 ||
          rawShip.limitedHistory.some((window) => !validateLimitedWindow(window)))
      ) {
        return `${prefix}.${spot}.ships[${index}].limitedHistory 非法`
      }
      // 掉落的印证票（活动图 2026-08-24 起有）。与敌编成那一侧同一条界：
      // 运行时一行不读，这里只拦住形状离谱的东西。
      if (
        rawShip.votes !== undefined &&
        (!Array.isArray(rawShip.votes) ||
          rawShip.votes.length > 8 ||
          rawShip.votes.some((vote) => !isText(vote, 40)))
      ) {
        return `${prefix}.${spot}.ships[${index}].votes 非法`
      }
    }
    for (const [index, rawComp] of rawNode.enemyComps.entries()) {
      const error = validateEnemyComp(rawComp, `${prefix}.${spot}.enemyComps[${index}]`)
      if (error) return error
    }
  }
  return null
}

const validateEventOperations = (raw: unknown, prefix: string): string | null => {
  if (!isRecord(raw)) return `${prefix}.operations 必须是对象`
  const { gimmicks, specialShips, friendlyFleets, nodeDistances } = raw
  if (
    !Array.isArray(gimmicks) ||
    gimmicks.length > 30 ||
    !Array.isArray(specialShips) ||
    specialShips.length > 500 ||
    !Array.isArray(friendlyFleets) ||
    friendlyFleets.length > 100 ||
    !isRecord(nodeDistances) ||
    Object.keys(nodeDistances).length > 200
  ) {
    return `${prefix}.operations 条目非法`
  }
  for (const [index, gimmick] of gimmicks.entries()) {
    if (
      !isRecord(gimmick) ||
      !isText(gimmick.title, 300) ||
      !Array.isArray(gimmick.steps) ||
      gimmick.steps.length < 1 ||
      gimmick.steps.length > 100 ||
      gimmick.steps.some((step) => !isText(step, 500))
    ) {
      return `${prefix}.operations.gimmicks[${index}] 非法`
    }
  }
  for (const [index, ship] of specialShips.entries()) {
    if (
      !isRecord(ship) ||
      !isText(ship.label, 300) ||
      !isText(ship.effect, 500) ||
      (ship.id !== undefined &&
        (!Number.isInteger(ship.id) || (ship.id as number) <= 0 || (ship.id as number) > 1_000_000))
    ) {
      return `${prefix}.operations.specialShips[${index}] 非法`
    }
  }
  for (const [index, fleet] of friendlyFleets.entries()) {
    if (
      !isRecord(fleet) ||
      !Array.isArray(fleet.ships) ||
      fleet.ships.length > 12 ||
      fleet.ships.some(
        (ship) =>
          !isRecord(ship) ||
          !isText(ship.name, 300) ||
          (ship.id !== undefined &&
            (!Number.isInteger(ship.id) || (ship.id as number) <= 0 || (ship.id as number) > 1_000_000)),
      ) ||
      (fleet.note !== undefined && !isText(fleet.note, 500))
    ) {
      return `${prefix}.operations.friendlyFleets[${index}] 非法`
    }
  }
  for (const [node, distance] of Object.entries(nodeDistances)) {
    if (
      !SAFE_SPOT.test(node) ||
      !Number.isInteger(distance) ||
      (distance as number) < 0 ||
      (distance as number) > 99
    ) {
      return `${prefix}.operations.nodeDistances.${node} 非法`
    }
  }
  return null
}

const validateMapIntel = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.maps)) {
    return 'map-intel 必须是 schemaVersion=1 且含 maps 的对象'
  }
  if (Object.keys(data.maps).length > 500) return 'map-intel.maps 条目过多'
  for (const [mapKey, rawMap] of Object.entries(data.maps)) {
    if (!SAFE_MAP.test(mapKey) || !isRecord(rawMap)) return `非法海域情报 ${mapKey}`
    if (
      !isText(rawMap.source, 300) ||
      !isText(rawMap.sourceUrl, 4096) ||
      (rawMap.kcwikiUrl !== undefined && !isText(rawMap.kcwikiUrl, 4096)) ||
      !isCalendarDate(rawMap.checkedAt) ||
      !isText(rawMap.revision, 100)
    ) {
      return `${mapKey} 的来源、日期或版本非法`
    }
    if (rawMap.event !== undefined) {
      const event = rawMap.event
      if (
        !isRecord(event) ||
        !isText(event.name, 300) ||
        !isCalendarDate(event.from) ||
        (event.until !== null && !isCalendarDate(event.until)) ||
        (event.status !== 'active' && event.status !== 'ended') ||
        !isDateText(event.phaseOpenedAt) ||
        (event.lifecycleSourceUrl !== undefined && !isText(event.lifecycleSourceUrl, 4096)) ||
        (event.status === 'ended' && !isCalendarDate(event.until))
      ) {
        return `${mapKey}.event 生命周期非法`
      }
    }

    if (rawMap.rewards !== undefined) {
      if (!Array.isArray(rawMap.rewards) || rawMap.rewards.length > 12) {
        return `${mapKey}.rewards 非法`
      }
      for (const [index, reward] of rawMap.rewards.entries()) {
        if (!isRecord(reward) || !isText(reward.scope, 10) || !isText(reward.text, 2000)) {
          return `${mapKey}.rewards[${index}] 非法`
        }
      }
    }

    const hasNodes = rawMap.nodes !== undefined
    const hasDifficulties = rawMap.difficulties !== undefined
    if (hasNodes === hasDifficulties) {
      return `${mapKey} 必须且只能使用常规 nodes 或活动 difficulties 其中一种`
    }
    if (hasNodes) {
      const error = validateMapIntelNodes(rawMap.nodes, mapKey)
      if (error) return error
      continue
    }

    if (!isRecord(rawMap.difficulties)) return `${mapKey}.difficulties 必须是对象`
    const layers = Object.entries(rawMap.difficulties)
    if (!layers.length || layers.length > 4) return `${mapKey}.difficulties 数量非法`
    for (const [difficulty, rawLayer] of layers) {
      if (!EVENT_DIFFICULTIES.has(difficulty) || !isRecord(rawLayer)) {
        return `${mapKey}.${difficulty} 难度非法`
      }
      const error = validateMapIntelNodes(rawLayer.nodes, `${mapKey}.difficulties.${difficulty}`)
      if (error) return error
      if (rawLayer.operations !== undefined) {
        const operationError = validateEventOperations(
          rawLayer.operations,
          `${mapKey}.difficulties.${difficulty}`,
        )
        if (operationError) return operationError
      }
    }
  }
  return null
}

const validateEventLifecycle = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.events)) {
    return 'event-lifecycle 必须是 schemaVersion=1 且含 events 的对象'
  }
  const validZhTable = (value: unknown) =>
    value === undefined ||
    (isRecord(value) && Object.values(value).every((text) => isText(text, 500)))
  for (const [index, event] of data.events.entries()) {
    if (
      !isRecord(event) ||
      !isInteger(event.mapAreaId, 1, 999) ||
      !isText(event.name, 300) ||
      (event.nameZh !== undefined && !isText(event.nameZh, 300)) ||
      !isValidCalendarDate(event.from) ||
      (event.until !== null && !isValidCalendarDate(event.until)) ||
      (event.status !== 'active' && event.status !== 'ended') ||
      (event.status === 'ended' && !isValidCalendarDate(event.until)) ||
      !Array.isArray(event.phases) ||
      !event.phases.length ||
      !validZhTable(event.mapNamesZh) ||
      !validZhTable(event.operationNamesZh)
    ) {
      return `event-lifecycle.events[${index}] 非法`
    }
    for (const [phaseIndex, phase] of event.phases.entries()) {
      if (
        !isRecord(phase) ||
        !isIsoDateTime(phase.openedAt) ||
        !Array.isArray(phase.maps) ||
        !phase.maps.every(Number.isInteger)
      ) {
        return `event-lifecycle.events[${index}].phases[${phaseIndex}] 非法`
      }
    }
  }
  return null
}

/**
 * 常规海域敌编成的第一方汇编包。
 *
 * 与 map-intel 底座的区别只有一处：这里的节点值**直接就是编成数组**
 *（没有 ships/emptyDrop 那两格——掉落与空掉落仍归底座管，一个域一个包）。
 */
const validateMapEnemyComps = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.maps)) {
    return 'map-enemy-comps 必须是 schemaVersion=1 且含 maps 的对象'
  }
  if (!isCalendarDate(data.compiledAt)) return 'map-enemy-comps.compiledAt 非法'
  if (Object.keys(data.maps).length > 500) return 'map-enemy-comps.maps 条目过多'
  if (data.voters !== undefined) {
    if (!isRecord(data.voters) || Object.keys(data.voters).length > 20) {
      return 'map-enemy-comps.voters 非法'
    }
    for (const [key, value] of Object.entries(data.voters)) {
      if (!isText(key, 40) || !isText(value, 300)) return `map-enemy-comps.voters.${key} 非法`
    }
  }
  for (const [mapKey, rawMap] of Object.entries(data.maps)) {
    if (!SAFE_MAP.test(mapKey) || !isRecord(rawMap)) return `非法海域敌编成 ${mapKey}`
    if (
      !isText(rawMap.source, 300) ||
      !isText(rawMap.sourceUrl, 4096) ||
      !isCalendarDate(rawMap.checkedAt) ||
      !isText(rawMap.revision, 100) ||
      (rawMap.contentDate !== undefined && !isCalendarDate(rawMap.contentDate))
    ) {
      return `${mapKey} 的来源、日期或版本非法`
    }
    if (!isRecord(rawMap.nodes)) return `${mapKey}.nodes 必须是对象`
    if (Object.keys(rawMap.nodes).length > 200) return `${mapKey}.nodes 条目过多`
    for (const [spot, rawComps] of Object.entries(rawMap.nodes)) {
      if (!SAFE_SPOT.test(spot)) return `${mapKey}.${spot} 点位非法`
      if (!Array.isArray(rawComps) || !rawComps.length || rawComps.length > 400) {
        return `${mapKey}.${spot} 的敌编成列表非法`
      }
      for (const [index, rawComp] of rawComps.entries()) {
        const error = validateEnemyComp(rawComp, `${mapKey}.${spot}[${index}]`)
        if (error) return error
      }
    }
  }
  return null
}

/**
 * 常规海域确认掉落的第一方汇编包。
 *
 * 节点值是 `{ emptyDrop, ships: [{ id, votes }] }`——**没有限定期那几格**：
 * `limited` / `limitedOnly` / `limitedHistory` 归底座 map-intel 管，装配时从底座带过去。
 * 这里出现限定期字段就是有人把两个域混进了一个包，直接拦。
 */
const validateMapDrops = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.maps)) {
    return 'map-drops 必须是 schemaVersion=1 且含 maps 的对象'
  }
  if (!isCalendarDate(data.compiledAt)) return 'map-drops.compiledAt 非法'
  if (Object.keys(data.maps).length > 500) return 'map-drops.maps 条目过多'
  if (data.voters !== undefined) {
    if (!isRecord(data.voters) || Object.keys(data.voters).length > 20) {
      return 'map-drops.voters 非法'
    }
    for (const [key, value] of Object.entries(data.voters)) {
      if (!isText(key, 40) || !isText(value, 300)) return `map-drops.voters.${key} 非法`
    }
  }
  if (data.sourceNotes !== undefined) {
    if (
      !Array.isArray(data.sourceNotes) ||
      data.sourceNotes.length > 20 ||
      data.sourceNotes.some((note) => !isText(note, 500))
    ) {
      return 'map-drops.sourceNotes 非法'
    }
  }
  for (const [mapKey, rawMap] of Object.entries(data.maps)) {
    if (!SAFE_MAP.test(mapKey) || !isRecord(rawMap)) return `非法海域掉落 ${mapKey}`
    if (
      !isText(rawMap.source, 300) ||
      !isText(rawMap.sourceUrl, 4096) ||
      !isCalendarDate(rawMap.checkedAt) ||
      !isText(rawMap.revision, 100) ||
      (rawMap.contentDate !== undefined && !isCalendarDate(rawMap.contentDate))
    ) {
      return `${mapKey} 的来源、日期或版本非法`
    }
    if (!isRecord(rawMap.nodes)) return `${mapKey}.nodes 必须是对象`
    if (Object.keys(rawMap.nodes).length > 200) return `${mapKey}.nodes 条目过多`
    for (const [spot, rawNode] of Object.entries(rawMap.nodes)) {
      if (!SAFE_SPOT.test(spot) || !isRecord(rawNode)) return `${mapKey}.${spot} 点位非法`
      if (
        (rawNode.emptyDrop !== 'confirmed' && rawNode.emptyDrop !== 'unknown') ||
        !Array.isArray(rawNode.ships) ||
        rawNode.ships.length > 2_000
      ) {
        return `${mapKey}.${spot} 的掉落列表非法`
      }
      if (
        rawNode.emptyDropVotes !== undefined &&
        (!Array.isArray(rawNode.emptyDropVotes) ||
          rawNode.emptyDropVotes.length > 8 ||
          rawNode.emptyDropVotes.some((vote) => !isText(vote, 40)))
      ) {
        return `${mapKey}.${spot}.emptyDropVotes 非法`
      }
      for (const [index, rawShip] of rawNode.ships.entries()) {
        if (
          !isRecord(rawShip) ||
          !Number.isInteger(rawShip.id) ||
          (rawShip.id as number) <= 0 ||
          (rawShip.id as number) > 1_000_000
        ) {
          return `${mapKey}.${spot}.ships[${index}] 非法`
        }
        if (
          rawShip.votes !== undefined &&
          (!Array.isArray(rawShip.votes) ||
            rawShip.votes.length > 8 ||
            rawShip.votes.some((vote) => !isText(vote, 40)))
        ) {
          return `${mapKey}.${spot}.ships[${index}].votes 非法`
        }
        if (
          rawShip.limited !== undefined ||
          rawShip.limitedOnly !== undefined ||
          rawShip.limitedHistory !== undefined
        ) {
          return `${mapKey}.${spot}.ships[${index}] 带了限定期字段——那一域仍归 map-intel 管`
        }
      }
    }
  }
  return null
}

/**
 * 战斗曲曲名表（`kcwiki-bgm`，2026-08-24）：战斗树资源号 → 官方曲名。
 *
 * 号的合法范围钉在 1–999：资源路径里就是三位数（`bgm/battle/275_1741.mp3`），
 * 越界的键说明解析器把站方的上传序号当成资源号写进来了——那正是这个包最容易
 * 出的错，宁可整包判非法也不要让顶栏显示一首**别的曲子**的名字。
 */
const validateKcwikiBgm = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.battle)) {
    return 'kcwiki-bgm 必须是 schemaVersion=1 且含 battle 的对象'
  }
  const entries = Object.entries(data.battle)
  if (!entries.length) return 'kcwiki-bgm.battle 为空'
  if (entries.length > 999) return 'kcwiki-bgm.battle 条目过多'
  for (const [id, name] of entries) {
    if (!SAFE_NUMERIC_ID.test(id) || !isInteger(Number(id), 1, 999)) {
      return `kcwiki-bgm.battle.${id} 资源号非法`
    }
    if (!isText(name, 120)) return `kcwiki-bgm.battle.${id} 曲名非法`
  }
  return null
}

/**
 * 常规海域限定期窗口的第一方台账（`map-drop-windows`，2026-08-22 批次 4）。
 *
 * 与前两个汇编包的区别：它**不是抓来的**，是人一条一条写下来的。所以这里多守两件事：
 *  ① 每条必须有 `evidence`（凭什么这么写 + 录入日期）。方案 §3.3 三条纪律之一——
 *    没有凭据的台账条目与凭空捏造无法区分，而它看起来和有凭据的一模一样；
 *  ② 每条必须有 `window`。空条目占着键位却什么都不说，比没有这一条更坏。
 */
const LIMITED_EVIDENCE_KINDS = new Set(['official', 'ledger', 'community'])

const validateMapDropWindows = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.maps)) {
    return 'map-drop-windows 必须是 schemaVersion=1 且含 maps 的对象'
  }
  if (!isCalendarDate(data.compiledAt)) return 'map-drop-windows.compiledAt 非法'
  if (!isCalendarDate(data.checkedAt)) return 'map-drop-windows.checkedAt 非法'
  if (!isText(data.source, 300) || !isText(data.revision, 100)) {
    return 'map-drop-windows 的来源或版本非法'
  }
  if (Object.keys(data.maps).length > 500) return 'map-drop-windows.maps 条目过多'
  if (data.voters !== undefined) {
    if (!isRecord(data.voters) || Object.keys(data.voters).length > 20) {
      return 'map-drop-windows.voters 非法'
    }
    for (const [key, value] of Object.entries(data.voters)) {
      if (!isText(key, 40) || !isText(value, 300)) return `map-drop-windows.voters.${key} 非法`
    }
  }
  for (const [mapKey, rawMap] of Object.entries(data.maps)) {
    if (!SAFE_MAP.test(mapKey) || !isRecord(rawMap)) return `非法限定期海域 ${mapKey}`
    if (Object.keys(rawMap).length > 200) return `${mapKey} 的点位过多`
    for (const [spot, rawList] of Object.entries(rawMap)) {
      if (!SAFE_SPOT.test(spot)) return `${mapKey}.${spot} 点位非法`
      if (!Array.isArray(rawList) || !rawList.length || rawList.length > 500) {
        return `${mapKey}.${spot} 的限定期列表非法`
      }
      for (const [index, raw] of rawList.entries()) {
        const at = `${mapKey}.${spot}[${index}]`
        if (
          !isRecord(raw) ||
          !Number.isInteger(raw.id) ||
          (raw.id as number) <= 0 ||
          (raw.id as number) > 1_000_000 ||
          (raw.limitedOnly !== undefined && typeof raw.limitedOnly !== 'boolean')
        ) {
          return `${at} 非法`
        }
        if (!validateLimitedWindow(raw.window)) return `${at}.window 非法`
        if (
          raw.history !== undefined &&
          (!Array.isArray(raw.history) ||
            raw.history.length > 100 ||
            raw.history.some((window) => !validateLimitedWindow(window)))
        ) {
          return `${at}.history 非法`
        }
        // 没有凭据的台账条目与凭空捏造无法区分——这是这个包与抓来的包最大的不同
        const evidence = raw.evidence
        if (
          !isRecord(evidence) ||
          !LIMITED_EVIDENCE_KINDS.has(evidence.kind as string) ||
          !isText(evidence.note, 500) ||
          !isCalendarDate(evidence.recordedAt)
        ) {
          return `${at}.evidence 非法（台账每条都必须写清凭什么与录入日期）`
        }
        if (
          raw.votes !== undefined &&
          (!Array.isArray(raw.votes) ||
            raw.votes.length > 8 ||
            raw.votes.some((vote) => !isText(vote, 40)))
        ) {
          return `${at}.votes 非法`
        }
        if (raw.conflict !== undefined && !isText(raw.conflict, 60)) {
          return `${at}.conflict 非法`
        }
      }
    }
  }
  return null
}

const validateLocalization = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.entities)) {
    return 'kcwiki-localization 必须是 schemaVersion=1 且含 entities 的对象'
  }
  for (const [domain, rawTable] of Object.entries(data.entities)) {
    if (!LOCALIZATION_DOMAINS.has(domain) || !isRecord(rawTable)) {
      return `非法翻译域 ${domain}`
    }
    if (Object.keys(rawTable).length > 5_000) return `${domain} 译名条目过多`
    for (const [id, raw] of Object.entries(rawTable)) {
      if (!/^\d{1,8}$/.test(id) || !isRecord(raw) || !isText(raw.ja, 500) || !isText(raw.zh, 500)) {
        return `${domain}.${id} 译名非法`
      }
      if (raw.source !== undefined && !isText(raw.source, 100)) {
        return `${domain}.${id}.source 非法`
      }
    }
  }
  return null
}

const DEV_SECRETARY_TYPES = new Set(['砲戦系', '水雷系', '空母系', '潜水系'])
const DEV_RESOURCE_TABLES = new Set(['钢/燃', '弹药', '铝'])

const validateDevRecipes = (data: unknown): string | null => {
  if (!isRecord(data)) return 'dev-recipes 必须是对象'
  const { equipment } = data
  if (!isRecord(equipment)) return 'dev-recipes.equipment 必须是对象'
  const names = Object.keys(equipment)
  if (!names.length) return 'dev-recipes.equipment 为空'
  if (names.length > 2_000) return 'dev-recipes.equipment 条目过多'
  for (const name of names) {
    if (!isText(name, 120)) return `dev-recipes.${name} 装备名非法`
    const list = (equipment as Record<string, unknown>)[name]
    if (!Array.isArray(list) || !list.length || list.length > 40) {
      return `dev-recipes.${name} 组合列表非法`
    }
    for (const entry of list) {
      if (
        !isRecord(entry) ||
        !DEV_SECRETARY_TYPES.has(entry.secretary as string) ||
        !DEV_RESOURCE_TABLES.has(entry.table as string) ||
        // 出货率是百分比：0 表示开不出，本来就不该收进来；>100 说明列错位了
        typeof entry.rate !== 'number' ||
        !Number.isFinite(entry.rate) ||
        entry.rate <= 0 ||
        entry.rate > 100
      ) {
        return `dev-recipes.${name} 组合非法`
      }
    }
  }
  return null
}

const BUILD_TARGETS = new Set(['駆逐艦', '軽巡洋艦', '重巡洋艦', '戦艦', '空母', '潜水艦'])

const validateBuildRecipes = (data: unknown): string | null => {
  if (!isRecord(data)) return 'build-recipes 必须是对象'
  const { recipes, times } = data
  if (!Array.isArray(recipes) || recipes.length < 10 || recipes.length > 400) {
    return 'build-recipes.recipes 条目数不在合理范围'
  }
  for (const entry of recipes) {
    if (
      !isRecord(entry) ||
      !BUILD_TARGETS.has(entry.target as string) ||
      !Array.isArray(entry.recipe) ||
      entry.recipe.length !== 4 ||
      // 通常建造投入的合法域：每项 30～999（上游是报告配方，超界说明列错位）
      (entry.recipe as unknown[]).some(
        (v) => typeof v !== 'number' || !Number.isInteger(v) || v < 30 || v > 999,
      ) ||
      !isString(entry.note ?? '', 400)
    ) {
      return 'build-recipes.recipes 配方非法'
    }
  }
  if (!Array.isArray(times) || times.length < 20 || times.length > 300) {
    return 'build-recipes.times 条目数不在合理范围'
  }
  for (const entry of times) {
    if (
      !isRecord(entry) ||
      !/^\d{2}:\d{2}:\d{2}$/.test(`${entry.time}`) ||
      !isText(entry.stype, 20) ||
      !Array.isArray(entry.ships) ||
      !Array.isArray(entry.largeOnly) ||
      [...(entry.ships as unknown[]), ...(entry.largeOnly as unknown[])].some(
        (name) => !isText(name, 40),
      )
    ) {
      return 'build-recipes.times 行非法'
    }
  }
  return null
}

// 等级经验表的数值上限。实测上游表到 Lv188，累计 20,200,000；
// 留一档余量给以后放宽等级，同时仍然挡住明显离谱的数字。
const MAX_SHIP_EXP = 50_000_000

const validateShipExp = (data: unknown): string | null => {
  if (!isRecord(data)) return 'ship-exp 必须是对象'
  const entries = Object.entries(data)
  if (!entries.length) return 'ship-exp 为空'
  if (entries.length > 500) return 'ship-exp 条目过多'
  let previous: number | null = null
  for (const [level, raw] of entries.sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (!SAFE_NUMERIC_ID.test(level)) return `ship-exp.${level} 等级非法`
    if (!Array.isArray(raw) || raw.length < 2) return `ship-exp.${level} 应为 [下一级所需, 累计]`
    const [next, cumulative] = raw
    // 这张表的数量级远超 isInteger 的默认上限（一百万）：Lv188 的累计是
    // 两千万出头，升一级最多要一百六十万。照默认走会把**整个包**判为非法，
    // 而包被丢掉之后界面只是安静地不显示经验换算，一句报错都不给。
    if (!isInteger(next, 0, MAX_SHIP_EXP) || !isInteger(cumulative, 0, MAX_SHIP_EXP)) {
      return `ship-exp.${level} 数值非法`
    }
    // 累计经验必须单调不减——错序的表会让「还差多少经验」算出负数
    if (previous != null && cumulative < previous) return `ship-exp.${level} 累计经验倒退`
    previous = cumulative
  }
  return null
}

const validateAbyssalStats = (data: unknown): string | null => {
  if (!isRecord(data)) return 'abyssal-stats 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 5_000) return 'abyssal-stats 条目过多'
  const numericFields = [
    'api_taik',
    'api_souk',
    'api_houg',
    'api_raig',
    'api_tyku',
    'api_luck',
    'api_leng',
    'api_soku',
    'kc3_asw',
    'kc3_evas',
    'kc3_los',
    'kc3_tacc',
  ]
  for (const [id, raw] of entries) {
    if (!SAFE_NUMERIC_ID.test(id) || !isRecord(raw) || !isInteger(raw.api_id, 1)) {
      return `abyssal-stats.${id} 条目非法`
    }
    if (`${raw.api_id}` !== id) return `abyssal-stats.${id}.api_id 不一致`
    for (const field of numericFields) {
      const value = raw[field]
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000)
      ) {
        return `abyssal-stats.${id}.${field} 非法`
      }
    }
    if (raw.kc3_oasw !== undefined && typeof raw.kc3_oasw !== 'boolean') {
      return `abyssal-stats.${id}.kc3_oasw 非法`
    }
    if (raw.api_maxeq !== undefined && !isIntegerArray(raw.api_maxeq, 20, 0)) {
      return `abyssal-stats.${id}.api_maxeq 非法`
    }
    if (raw.kc3_slots !== undefined && !isIntegerArray(raw.kc3_slots, 20, 0)) {
      return `abyssal-stats.${id}.kc3_slots 非法`
    }
  }
  return null
}

const validateAkashiList = (data: unknown): string | null => {
  if (
    !isRecord(data) ||
    !isRecord(data.items) ||
    !Array.isArray(data.pre_star) ||
    data.pre_star.length > 100 ||
    data.pre_star.some((item) => !isString(item, 100)) ||
    !Array.isArray(data.week) ||
    data.week.length > 20 ||
    data.week.some((item) => !isString(item, 100))
  ) {
    return 'akashi-list 根结构非法'
  }
  const items = Object.entries(data.items)
  if (items.length > 5_000) return 'akashi-list.items 条目过多'
  for (const [id, raw] of items) {
    if (
      !SAFE_NUMERIC_ID.test(id) ||
      !isRecord(raw) ||
      !isInteger(raw.id, 1) ||
      `${raw.id}` !== id ||
      !isRecord(raw.item_name) ||
      !isString(raw.item_name.ja, 500) ||
      !isString(raw.item_name.zh, 500) ||
      (raw.item_remodel !== undefined && !isRecord(raw.item_remodel))
    ) {
      return `akashi-list.items.${id} 非法`
    }
  }
  return null
}

const validateKcwikiShips = (data: unknown): string | null => {
  if (!isRecord(data)) return 'kcwiki-ships 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 5_000) return 'kcwiki-ships 条目过多'
  for (const [key, raw] of entries) {
    if (
      !SAFE_EXPEDITION_ID.test(key) ||
      !isRecord(raw) ||
      !isInteger(raw.ID, 1) ||
      !isString(raw['日文名'], 500) ||
      !isString(raw['中文名'], 500) ||
      (raw['舰种'] !== undefined && !isInteger(raw['舰种'], 0, 1_000)) ||
      (raw['改造'] !== undefined && raw['改造'] !== null && !isRecord(raw['改造'])) ||
      (raw['数据'] !== undefined && !isRecord(raw['数据'])) ||
      (raw['消耗'] !== undefined && !isRecord(raw['消耗']))
    ) {
      return `kcwiki-ships.${key} 非法`
    }
  }
  return null
}

const validateExpeditions = (data: unknown): string | null => {
  if (!isRecord(data)) return 'kcwiki-expedition 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 1_000) return 'kcwiki-expedition 条目过多'
  for (const [id, raw] of entries) {
    if (
      !SAFE_EXPEDITION_ID.test(id) ||
      !isRecord(raw) ||
      raw.id !== id ||
      !isText(raw.nameJp, 500) ||
      !isText(raw.nameZh, 500) ||
      typeof raw.time !== 'string' ||
      !/^\d{1,3}:\d{2}$/.test(raw.time) ||
      (raw.flagLv !== null && !isInteger(raw.flagLv, 0, 1_000)) ||
      !isInteger(raw.minShips, 1, 12) ||
      (raw.tags !== undefined &&
        (!Array.isArray(raw.tags) ||
          raw.tags.length > 100 ||
          raw.tags.some((tag) => !isText(tag, 200)))) ||
      (raw.rewards !== undefined && raw.rewards !== null && !isRecord(raw.rewards))
    ) {
      return `kcwiki-expedition.${id} 非法`
    }
  }
  return null
}

const validateWikiwikiExpeditions = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-expedition 必须是对象'
  const entries = Object.entries(data)
  if (entries.length < 1 || entries.length > 1_000) return 'wikiwiki-expedition 条目数非法'
  const rewardPairOk = (value: unknown) =>
    value === null ||
    (Array.isArray(value) &&
      value.length === 2 &&
      isInteger(value[0], 1, 1_000_000) &&
      (value[1] === null || isInteger(value[1], 0, 1_000_000)))
  const rewardItemsOk = (value: unknown) =>
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item) =>
        isRecord(item) &&
        !Object.keys(item).some((key) => !['name', 'count', 'min'].includes(key)) &&
        isText(item.name, 500) &&
        isInteger(item.count, 1, 100_000) &&
        isInteger(item.min, 0, 100_000),
    )
  const statsOk = (value: unknown) =>
    value === null ||
    (isRecord(value) &&
      Object.keys(value).length <= 4 &&
      Object.entries(value).every(
        ([key, amount]) =>
          ['火力', '对空', '对潜', '索敌'].includes(key) &&
          isInteger(amount, 0, 100_000),
      ))
  for (const [id, raw] of entries) {
    if (
      !SAFE_EXPEDITION_ID.test(id) ||
      !isRecord(raw) ||
      raw.id !== id ||
      !isText(raw.nameJp, 500) ||
      !isText(raw.difficulty, 100) ||
      !isString(raw.descriptionJp, 5_000) ||
      typeof raw.time !== 'string' ||
      !/^\d{1,3}:\d{2}$/.test(raw.time) ||
      !isString(raw.useFuelText, 100) ||
      !isString(raw.useBullText, 100) ||
      !Array.isArray(raw.tags) ||
      raw.tags.length > 20 ||
      raw.tags.some((tag) => !isText(tag, 100)) ||
      typeof raw.monthly !== 'boolean' ||
      (raw.combat !== null && !isText(raw.combat, 100)) ||
      (raw.flagLv !== null && !isInteger(raw.flagLv, 0, 1_000)) ||
      (raw.fleetLv !== null && !isInteger(raw.fleetLv, 0, 10_000)) ||
      !isInteger(raw.minShips, 1, 12) ||
      (raw.composition !== null && !isText(raw.composition, 5_000)) ||
      !isText(raw.rawComposition, 20_000) ||
      !statsOk(raw.stats) ||
      (raw.drumTotal !== null && !isInteger(raw.drumTotal, 1, 100)) ||
      (raw.drumShips !== null && !isInteger(raw.drumShips, 1, 12)) ||
      (raw.greatNote !== null && !isText(raw.greatNote, 5_000)) ||
      !isRecord(raw.rewards)
    ) {
      return `wikiwiki-expedition.${id} 非法`
    }
    const rewards = raw.rewards
    if (
      Object.keys(rewards).some(
        (key) =>
          ![
            'hqExp',
            'shipExp',
            'fuel',
            'ammo',
            'steel',
            'baux',
            'items',
            'greatItems',
          ].includes(key),
      ) ||
      !isInteger(rewards.hqExp, 0, 1_000_000) ||
      !isInteger(rewards.shipExp, 0, 1_000_000) ||
      !rewardPairOk(rewards.fuel) ||
      !rewardPairOk(rewards.ammo) ||
      !rewardPairOk(rewards.steel) ||
      !rewardPairOk(rewards.baux) ||
      !rewardItemsOk(rewards.items) ||
      !rewardItemsOk(rewards.greatItems)
    ) {
      return `wikiwiki-expedition.${id}.rewards 非法`
    }
  }
  return null
}

const validateScnQuests = (data: unknown): string | null => {
  if (!isRecord(data)) return 'quests-scn 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 5_000) return 'quests-scn 条目过多'
  for (const [id, raw] of entries) {
    if (
      !SAFE_NUMERIC_ID.test(id) ||
      !isRecord(raw) ||
      !isText(raw.code, 100) ||
      !isString(raw.name, 1_000) ||
      !isString(raw.desc, 10_000) ||
      !isString(raw.memo, 10_000) ||
      !isString(raw.memo2, 10_000) ||
      !Array.isArray(raw.pre) ||
      raw.pre.length > 100 ||
      raw.pre.some((code) => !isText(code, 100))
    ) {
      return `quests-scn.${id} 非法`
    }
  }
  return null
}

const validateEoQuests = (data: unknown): string | null => {
  if (!Array.isArray(data) || data.length > 5_000) return 'eo-quests 必须是有限数组'
  for (const [index, raw] of data.entries()) {
    if (
      !isRecord(raw) ||
      !isInteger(raw.api_id, 1) ||
      !isText(raw.code, 100) ||
      !isString(raw.name_jp, 2_000) ||
      !isString(raw.desc_jp, 20_000) ||
      (raw.name_en !== undefined && raw.name_en !== null && !isString(raw.name_en, 2_000)) ||
      (raw.desc_en !== undefined && raw.desc_en !== null && !isString(raw.desc_en, 20_000))
    ) {
      return `eo-quests[${index}] 非法`
    }
  }
  return null
}

const QUEST_CODE_PATTERN = /^[A-Z]{1,2}[a-z]?\d+$/
const validateWikiwikiQuests = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-quests 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 5_000) return 'wikiwiki-quests 条数异常'
  for (const [code, raw] of entries) {
    const okCodes = (list: unknown, max: number) =>
      Array.isArray(list) && list.length <= max && list.every((item) => isText(item, 20))
    if (
      !QUEST_CODE_PATTERN.test(code) ||
      !isRecord(raw) ||
      raw.code !== code ||
      !isText(raw.nameJp, 500) ||
      !okCodes(raw.pre, 50) ||
      !isString(raw.condRaw, 1_000) ||
      !isString(raw.page, 200) ||
      (raw.mentioned !== undefined && !okCodes(raw.mentioned, 50)) ||
      (raw.uncertain !== undefined && raw.uncertain !== true) ||
      (raw.aligned !== undefined && raw.aligned !== false)
    ) {
      return `wikiwiki-quests.${code} 非法`
    }
  }
  return null
}

// 道具兑换（wikiwiki アイテム页表格化目录）：键为 useitem id，
// yearly（秋刀魚式年次表）/ fixed（菱餅式两列表）/ history（活动史表的
// 年份+詳細原文速览，節分の豆/南瓜等）至少有其一
const validateWikiwikiItemExchange = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-item-exchange 必须是对象'
  const entries = Object.entries(data)
  if (!entries.length || entries.length > 200) return 'wikiwiki-item-exchange 条数异常'
  for (const [key, raw] of entries) {
    if (!/^\d+$/.test(key) || !isRecord(raw) || !isText(raw.name, 100)) {
      return `wikiwiki-item-exchange.${key} 非法`
    }
    const yearly = raw.yearly
    const fixed = raw.fixed
    const history = raw.history
    if (
      yearly === undefined &&
      fixed === undefined &&
      history === undefined &&
      raw.overview === undefined &&
      raw.usage === undefined
    ) {
      return `wikiwiki-item-exchange.${key} 空条目`
    }
    if (raw.overview !== undefined && !isText(raw.overview, 700)) {
      return `wikiwiki-item-exchange.${key}.overview 非法`
    }
    if (raw.usage !== undefined) {
      if (!Array.isArray(raw.usage) || !raw.usage.length || raw.usage.length > 60) {
        return `wikiwiki-item-exchange.${key}.usage 非法`
      }
      for (const line of raw.usage) {
        if (!isText(line, 500)) return `wikiwiki-item-exchange.${key}.usage 行非法`
      }
    }
    if (history !== undefined) {
      if (!Array.isArray(history) || !history.length || history.length > 100) {
        return `wikiwiki-item-exchange.${key}.history 非法`
      }
      for (const row of history) {
        if (!isRecord(row) || !isText(row.year, 20) || !isText(row.detail, 2_000)) {
          return `wikiwiki-item-exchange.${key}.history 行非法`
        }
      }
    }
    if (yearly !== undefined) {
      if (!Array.isArray(yearly) || !yearly.length || yearly.length > 500) {
        return `wikiwiki-item-exchange.${key}.yearly 非法`
      }
      for (const row of yearly) {
        if (
          !isRecord(row) ||
          !isText(row.year, 20) ||
          !isString(row.offer, 100) ||
          !isString(row.cost, 40) ||
          !isText(row.gets, 500) ||
          !isString(row.note, 200)
        ) {
          return `wikiwiki-item-exchange.${key}.yearly 行非法`
        }
      }
    }
    if (fixed !== undefined) {
      if (!Array.isArray(fixed) || !fixed.length || fixed.length > 100) {
        return `wikiwiki-item-exchange.${key}.fixed 非法`
      }
      for (const row of fixed) {
        if (!isRecord(row) || !isText(row.offer, 100) || !isText(row.gets, 500)) {
          return `wikiwiki-item-exchange.${key}.fixed 行非法`
        }
      }
    }
  }
  return null
}

const KCWIKI_QUEST_CATEGORIES = new Set([
  'a-gou',
  'and',
  'equipexchange',
  'excercise',
  'expedition',
  'fleet',
  'modelconversion',
  'modernization',
  'or',
  'scrapequipment',
  'simple',
  'sink',
  'sortie',
  'then',
])

const validateKcwikiQuestReq = (data: unknown): string | null => {
  if (!isRecord(data)) return 'kcwiki-quest-req 必须是对象'
  const entries = Object.entries(data)
  if (!entries.length || entries.length > 2_000) return 'kcwiki-quest-req 条目数非法'
  for (const [questId, requirements] of entries) {
    if (
      !SAFE_NUMERIC_ID.test(questId) ||
      !isRecord(requirements) ||
      !isText(requirements.category, 100) ||
      !KCWIKI_QUEST_CATEGORIES.has(requirements.category as string)
    ) {
      return `kcwiki-quest-req.${questId} 非法`
    }
    const bounded = validateBoundedJson(requirements, `kcwiki-quest-req.${questId}`, {
      maxDepth: 12,
      maxNodes: 10_000,
      maxString: 10_000,
      maxArray: 1_000,
      maxObject: 1_000,
    })
    if (bounded) return bounded
  }
  return null
}

const validatePoiQuestGoal = (data: unknown): string | null => {
  if (!isRecord(data)) return 'poi-quest-goal 必须是对象'
  const entries = Object.entries(data)
  if (!entries.length || entries.length > 2_000) return 'poi-quest-goal 条目数非法'
  for (const [questId, rawQuest] of entries) {
    if (
      !SAFE_NUMERIC_ID.test(questId) ||
      !isRecord(rawQuest) ||
      !isInteger(rawQuest.type, 0, 999) ||
      (rawQuest.fuzzy !== undefined && typeof rawQuest.fuzzy !== 'boolean') ||
      (rawQuest.resetInterval !== undefined && !isInteger(rawQuest.resetInterval, 0, 1_000))
    ) {
      return `poi-quest-goal.${questId} 非法`
    }
    const goals = Object.entries(rawQuest)
      .filter(([key]) => !['type', 'fuzzy', 'resetInterval'].includes(key))
    if (!goals.length || goals.length > 100) return `poi-quest-goal.${questId} 目标数非法`
    for (const [key, rawGoal] of goals) {
      if (
        !key.length ||
        key.length > 200 ||
        /[\u0000-\u001f]/.test(key) ||
        DANGEROUS_JSON_KEYS.has(key) ||
        !isRecord(rawGoal) ||
        !isInteger(rawGoal.required, 1) ||
        (rawGoal.init !== undefined && !isInteger(rawGoal.init, 0)) ||
        (rawGoal.description !== undefined && !isString(rawGoal.description, 1_000))
      ) {
        return `poi-quest-goal.${questId}.${key} 非法`
      }
      for (const field of ['shipType', 'maparea', 'mapcell', 'slotitemType2']) {
        if (rawGoal[field] !== undefined && !isIntegerArray(rawGoal[field], 1_000, 0)) {
          return `poi-quest-goal.${questId}.${key}.${field} 非法`
        }
      }
      if (
        rawGoal.mission !== undefined &&
        (
          !Array.isArray(rawGoal.mission) ||
          rawGoal.mission.length > 100 ||
          rawGoal.mission.some((mission) => !isText(mission, 500))
        )
      ) {
        return `poi-quest-goal.${questId}.${key}.mission 非法`
      }
    }
    const bounded = validateBoundedJson(rawQuest, `poi-quest-goal.${questId}`, {
      maxDepth: 12,
      maxNodes: 20_000,
      maxString: 10_000,
      maxArray: 2_000,
      maxObject: 1_000,
    })
    if (bounded) return bounded
  }
  return null
}

const validateEquipUpgrades = (data: unknown): string | null => {
  if (!Array.isArray(data) || data.length > 5_000) return 'equip-upgrades 必须是有限数组'
  for (const [index, raw] of data.entries()) {
    if (
      !isRecord(raw) ||
      !isInteger(raw.eq_id, 1) ||
      !Array.isArray(raw.improvement) ||
      raw.improvement.length > 100 ||
      raw.improvement.some((entry) => !isRecord(entry)) ||
      !Array.isArray(raw.convert_to) ||
      raw.convert_to.length > 100 ||
      raw.convert_to.some((entry) => !isRecord(entry)) ||
      !isIntegerArray(raw.upgrade_for, 1_000, 1)
    ) {
      return `equip-upgrades[${index}] 非法`
    }
  }
  return null
}

/**
 * 改修事实表（第一方，随包）。
 *
 * 与退役的 `equip-upgrades` 不同的两处：没有 `convert_to`/`upgrade_for`
 *（那两个字段是上游 schema 的遗留，本表用不到），每行多一个 `basis`
 * ——那是这一格的置信等级，缺了就等于把「照资料整理的」和「游戏里实测过的」
 * 混成一句话，正是这张表最不该丢的东西。
 */
const validateEquipImprove = (data: unknown): string | null => {
  if (!Array.isArray(data) || data.length > 5_000) return 'equip-improve 必须是有限数组'
  for (const [index, raw] of data.entries()) {
    if (!isRecord(raw) || !isInteger(raw.eq_id, 1)) return `equip-improve[${index}] 非法`
    if (!Array.isArray(raw.improvement) || raw.improvement.length > 100) {
      return `equip-improve[${index}].improvement 非法`
    }
    for (const [at, row] of raw.improvement.entries()) {
      if (!isRecord(row)) return `equip-improve[${index}].improvement[${at}] 非法`
      if (typeof row.basis !== 'string' || !row.basis || row.basis.length > 200) {
        return `equip-improve[${index}].improvement[${at}] 缺 basis`
      }
      if (!Array.isArray(row.helpers) || row.helpers.length > 100) {
        return `equip-improve[${index}].improvement[${at}].helpers 非法`
      }
      for (const helper of row.helpers) {
        // ship_ids 的下界是 **-1** 不是 1：`[-1]` 是「这一档不要二号舰」的哨兵，
        // 是真语义不是脏数据（游戏里确实有不需要二号舰就能改的档）。
        // 卡成 1 会把那几行判非法，整包加载失败。
        if (
          !isRecord(helper) ||
          !isIntegerArray(helper.ship_ids, 200, -1) ||
          !isIntegerArray(helper.days, 7, 0, 6)
        ) {
          return `equip-improve[${index}].improvement[${at}].helpers 非法`
        }
      }
      if (!isRecord(row.costs)) return `equip-improve[${index}].improvement[${at}].costs 非法`
      if (row.convert != null && !isRecord(row.convert)) {
        return `equip-improve[${index}].improvement[${at}].convert 非法`
      }
    }
    if (raw.pending != null) {
      if (
        !Array.isArray(raw.pending) ||
        raw.pending.length > 20 ||
        raw.pending.some((one) => typeof one !== 'string' || !one || one.length > 500)
      ) {
        return `equip-improve[${index}].pending 非法`
      }
    }
  }
  return null
}

/**
 * 对空射击回避事实表。
 *
 * 两个补正是**乘数**，取值只在 0 与 1 之间（1 = 不减免）；档位符号只认原文那五个。
 * 卡死符号集合是有意的：写错一个字符就会在排序里静默变成「无档」，
 * 而无档与最低档 △ 在游戏里差着 40% 的加重対空減免——这种错不许悄悄过。
 */
const AA_EVASION_TIERS = new Set(['❀', '☆', '◎', '◯', '△'])
const validateEquipAaEvasion = (data: unknown): string | null => {
  if (!Array.isArray(data) || data.length > 2_000) return 'equip-aa-evasion 必须是有限数组'
  const seen = new Set<number>()
  for (const [index, raw] of data.entries()) {
    if (!isRecord(raw) || !isInteger(raw.eq_id, 1)) return `equip-aa-evasion[${index}] 非法`
    if (seen.has(raw.eq_id as number)) {
      return `equip-aa-evasion[${index}] 的 eq_id ${raw.eq_id} 重复`
    }
    seen.add(raw.eq_id as number)
    for (const key of ['weighted_aa', 'fleet_aa'] as const) {
      const value = raw[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
        return `equip-aa-evasion[${index}].${key} 应是 (0,1] 之间的补正倍率`
      }
    }
    if (typeof raw.tier !== 'string' || !AA_EVASION_TIERS.has(raw.tier)) {
      return `equip-aa-evasion[${index}].tier 不是已知档位符号`
    }
    if (!isString(raw.basis, 200) || !raw.basis) return `equip-aa-evasion[${index}] 缺 basis`
  }
  return null
}

const validateVoice = (data: unknown): string | null => {
  if (!isRecord(data)) return 'kcwiki-voice 必须是对象'
  const ships = Object.entries(data)
  if (ships.length > 5_000) return 'kcwiki-voice 舰娘条目过多'
  for (const [shipId, rawLines] of ships) {
    if (!SAFE_NUMERIC_ID.test(shipId) || !Array.isArray(rawLines) || rawLines.length > 500) {
      return `kcwiki-voice.${shipId} 非法`
    }
    for (const [index, raw] of rawLines.entries()) {
      if (
        !isRecord(raw) ||
        !isString(raw.key, 300) ||
        !isString(raw.scene, 1_000) ||
        !isString(raw.ja, 10_000) ||
        !isString(raw.zh, 10_000) ||
        (!raw.key && !raw.scene)
      ) {
        return `kcwiki-voice.${shipId}[${index}] 非法`
      }
    }
  }
  return null
}

// 季节限定台词。与 kcwiki-voice 是两套形状：这里按「季节表 + 形态表」分开落，
// 每条只有中文译文（日文原文按发布口径不进分发物），外加可选的官方语音槽位。
const validateSeasonalVoice = (data: unknown): string | null => {
  if (!isRecord(data)) return 'kcwiki-seasonal-voice 必须是对象'
  if (data.schemaVersion !== 1) return 'kcwiki-seasonal-voice.schemaVersion 非法'
  const seasons = data.seasons
  if (!isRecord(seasons)) return 'kcwiki-seasonal-voice.seasons 必须是对象'
  const seasonIds = Object.entries(seasons)
  if (seasonIds.length > 1_000) return 'kcwiki-seasonal-voice.seasons 条目过多'
  const known = new Set<string>()
  for (const [seasonId, raw] of seasonIds) {
    if (
      seasonId.length > 120 ||
      !isRecord(raw) ||
      !isText(raw.title, 200) ||
      !isText(raw.name, 200) ||
      !isText(raw.page, 300) ||
      (raw.year !== undefined && !isInteger(raw.year, 2_000, 2_999)) ||
      (raw.updatedAt !== undefined && !isDateText(raw.updatedAt))
    ) {
      return `kcwiki-seasonal-voice.seasons.${seasonId} 非法`
    }
    known.add(seasonId)
  }
  const ships = data.ships
  if (!isRecord(ships)) return 'kcwiki-seasonal-voice.ships 必须是对象'
  const forms = Object.entries(ships)
  if (forms.length > 5_000) return 'kcwiki-seasonal-voice.ships 形态过多'
  for (const [shipId, rawLines] of forms) {
    if (!SAFE_NUMERIC_ID.test(shipId) || !Array.isArray(rawLines) || rawLines.length > 500) {
      return `kcwiki-seasonal-voice.ships.${shipId} 非法`
    }
    for (const [index, raw] of rawLines.entries()) {
      if (
        !isRecord(raw) ||
        !isText(raw.key, 300) ||
        typeof raw.season !== 'string' ||
        !known.has(raw.season) ||
        !isString(raw.zh, 10_000) ||
        // 日文原文这一列 2026-08-22 起必须在场（值可空：上游没转日文的行照实空着）
        !isString(raw.ja, 10_000) ||
        (raw.scene !== undefined && !isText(raw.scene, 1_000)) ||
        // 槽位就是官方语音编号空间：1..53（30..53 是时报）。越界的一律拦下——
        // 这个数会被拿去算音轨文件名，放行等于让包里的脏数据决定去请求什么。
        (raw.slot !== undefined && !isInteger(raw.slot, 1, 53))
      ) {
        return `kcwiki-seasonal-voice.ships.${shipId}[${index}] 非法`
      }
    }
  }
  // 短剧/群像语音：多位舰娘同台的一段演出，档名是裸编号，没有形态归属。
  // 这一栏可以不存在（老包没有它），有就得是干净的。
  const skits = data.skits
  if (skits !== undefined) {
    if (!isRecord(skits)) return 'kcwiki-seasonal-voice.skits 必须是对象'
    const entries = Object.entries(skits)
    if (entries.length > 500) return 'kcwiki-seasonal-voice.skits 条目过多'
    for (const [key, raw] of entries) {
      if (
        // 键会被拿去拼 /kcs/sound/kc9997/{key}.mp3，形状钉死在裸编号上
        !/^\d{1,6}$/.test(key) ||
        !isRecord(raw) ||
        typeof raw.season !== 'string' ||
        !known.has(raw.season) ||
        !isString(raw.zh, 10_000) ||
        !isString(raw.ja, 10_000) ||
        (raw.scene !== undefined && !isText(raw.scene, 1_000))
      ) {
        return `kcwiki-seasonal-voice.skits.${key} 非法`
      }
    }
  }
  return null
}

/**
 * 台词自补层（`kanso-voice`，2026-08-22）：**第一方译文**，抓不回来，随源码走。
 *
 * 这里守三件事：
 *  ① **`ja` 日文原文必须在场**。这一条 2026-08-22 当天**反转过**：原来钉的是
 *    「不许出现日文字段」（沿任务域「日文原文不进分发物」的类推），同日用户重算法理
 *    后撤销——逐字转写权利归 C2，这一列与随包早就有的 `kcwiki-voice.ja`、`subtitle-ja`
 *    同级同灰度，不加深。台词卷是**对照**功能，缺了这一列就只剩半张表，所以判据反过来：
 *    每行都得有这个键。**值允许是空串**——上游确实没转日文的行照实空着，不许编。
 *  ② `slot` 必须落在官方语音编号空间 1..53。这个数会被拿去算音轨文件名，
 *    放行等于让包里的脏数据决定去请求什么。
 *  ③ `basis` 必须是四档之一（见下面那个集合旁的注释）。播放键给不给全看它——
 *    写个别的值等于把判据绕过去。
 *
 * 键仍旧钉在白名单上：多一个没人认识的字段就该当成包被人动过。
 */
const KANSO_VOICE_ROW_KEYS = new Set(['key', 'scene', 'slot', 'basis', 'ja', 'zh', 'draft'])
// ⚠️ `key-only` **故意不在这个集合里**（2026-08-23）。这一层的槽位来源只有一个——
// wikiwiki 舰娘页的场合列——所以它的名字就该是 `wikiwiki-mapped`，标出处而不是标「没校验」。
// 真有一份包写着 `key-only` 送进来，说明它是按旧口径编的：那时候这一档**不给键**，
// 收下它会让整层静默变暗（比报错难查得多）。所以让它当场失败。
const KANSO_VOICE_BASIS = new Set([
  'key-confirmed',
  'wikiwiki-mapped',
  'divergent',
  'ambiguous',
])

const validateKansoVoice = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1) return 'kanso-voice 必须是 schemaVersion=1 的对象'
  if (!isCalendarDate(data.compiledAt)) return 'kanso-voice.compiledAt 非法'
  const ships = data.ships
  if (!isRecord(ships)) return 'kanso-voice.ships 必须是对象'
  const forms = Object.entries(ships)
  if (forms.length > 5_000) return 'kanso-voice.ships 形态过多'
  for (const [shipId, rawLines] of forms) {
    if (!SAFE_NUMERIC_ID.test(shipId) || !Array.isArray(rawLines) || rawLines.length > 500) {
      return `kanso-voice.ships.${shipId} 非法`
    }
    for (const [index, raw] of rawLines.entries()) {
      const at = `kanso-voice.ships.${shipId}[${index}]`
      if (!isRecord(raw)) return `${at} 非法`
      for (const field of Object.keys(raw)) {
        if (!KANSO_VOICE_ROW_KEYS.has(field)) return `${at} 出现了不该有的字段 ${field}`
      }
      if (
        !isText(raw.key, 300) ||
        !isText(raw.scene, 1_000) ||
        !isText(raw.zh, 10_000) ||
        // 日文原文这一列**必须在场**，值可以是空串（上游没转的行照实空着）
        !isString(raw.ja, 10_000) ||
        !isInteger(raw.slot, 1, 53) ||
        typeof raw.basis !== 'string' ||
        !KANSO_VOICE_BASIS.has(raw.basis) ||
        (raw.draft !== undefined && raw.draft !== true)
      ) {
        return `${at} 非法`
      }
    }
  }
  return null
}

const VOICE_OVERLAY_KEY = /^[0-9]{3}[a-z]?-[A-Za-z0-9]+$/
const VOICE_OVERLAY_PACKS = new Set(['kcwiki-voice', 'kcwiki-seasonal-voice'])
const VOICE_OVERLAY_ENTRY_KEYS = new Set(['pack', 'ja', 'zh', 'draft'])
const VOICE_OVERLAY_BY_JA_KEYS = new Set(['ja', 'zh'])

const validateKansoVoiceZh = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1) {
    return 'kanso-voice-zh 必须是 schemaVersion=1 的对象'
  }
  if (!isCalendarDate(data.compiledAt)) return 'kanso-voice-zh.compiledAt 非法'
  if (!isRecord(data.entries)) return 'kanso-voice-zh.entries 必须是对象'
  const entries = Object.entries(data.entries)
  if (entries.length > 20_000) return 'kanso-voice-zh.entries 条目过多'
  for (const [key, raw] of entries) {
    const at = `kanso-voice-zh.entries.${key}`
    if (!VOICE_OVERLAY_KEY.test(key) || !isRecord(raw)) return `${at} 非法`
    for (const field of Object.keys(raw)) {
      if (!VOICE_OVERLAY_ENTRY_KEYS.has(field)) return `${at} 出现了不该有的字段 ${field}`
    }
    if (
      typeof raw.pack !== 'string' ||
      !VOICE_OVERLAY_PACKS.has(raw.pack) ||
      !isText(raw.ja, 10_000) ||
      !isText(raw.zh, 10_000) ||
      (raw.draft !== undefined && raw.draft !== true)
    ) {
      return `${at} 非法`
    }
  }
  if (!Array.isArray(data.byJa) || data.byJa.length > 20_000) {
    return 'kanso-voice-zh.byJa 非法'
  }
  for (const [index, raw] of data.byJa.entries()) {
    const at = `kanso-voice-zh.byJa[${index}]`
    if (!isRecord(raw)) return `${at} 非法`
    for (const field of Object.keys(raw)) {
      if (!VOICE_OVERLAY_BY_JA_KEYS.has(field)) return `${at} 出现了不该有的字段 ${field}`
    }
    if (!isText(raw.ja, 10_000) || !isText(raw.zh, 10_000)) return `${at} 非法`
  }
  return null
}


const validateWikiwikiVoice = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-voice 必须是对象'
  const ships = Object.entries(data)
  if (ships.length > 5_000) return 'wikiwiki-voice 舰娘条目过多'
  for (const [shipId, rawLines] of ships) {
    if (!SAFE_NUMERIC_ID.test(shipId) || !Array.isArray(rawLines) || rawLines.length > 1_000) {
      return `wikiwiki-voice.${shipId} 非法`
    }
    for (const [index, raw] of rawLines.entries()) {
      if (
        !isRecord(raw) ||
        !isText(raw.key, 1_000) ||
        !isText(raw.scene, 1_000) ||
        !isText(raw.ja, 10_000) ||
        !isText(raw.page, 1_000) ||
        (raw.voiceId !== undefined && !isInteger(raw.voiceId, 1, 53))
      ) {
        return `wikiwiki-voice.${shipId}[${index}] 非法`
      }
    }
  }
  return null
}

const validateWikiwikiAbyssVoice = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-abyss-voice 必须是对象'
  const ships = Object.entries(data)
  if (ships.length > 5_000) return 'wikiwiki-abyss-voice 深海舰条目过多'
  for (const [shipId, rawLines] of ships) {
    if (
      !SAFE_NUMERIC_ID.test(shipId) ||
      Number(shipId) < 1_500 ||
      !Array.isArray(rawLines) ||
      rawLines.length > 1_000
    ) {
      return `wikiwiki-abyss-voice.${shipId} 非法`
    }
    for (const [index, raw] of rawLines.entries()) {
      if (
        !isRecord(raw) ||
        !isText(raw.key, 1_000) ||
        !isText(raw.scene, 1_000) ||
        !isText(raw.ja, 10_000) ||
        !isText(raw.page, 1_000) ||
        (raw.slot !== undefined && !['opening', 'attack', 'damage', 'sunk'].includes(`${raw.slot}`)) ||
        (raw.suffix !== undefined && ![10, 20, 21, 30, 31, 40, 41].includes(Number(raw.suffix))) ||
        (raw.transport !== undefined && !['original', 'mirror'].includes(`${raw.transport}`))
      ) {
        return `wikiwiki-abyss-voice.${shipId}[${index}] 非法`
      }
    }
  }
  return null
}

const isWikiwikiRemodelNeed = (need: unknown): boolean =>
  isRecord(need) &&
  ['useitem', 'slotitem', 'unknown'].includes(`${need.kind}`) &&
  isText(need.nameJp, 500) &&
  isInteger(need.count, 1, 100_000) &&
  (need.kind === 'unknown' ? need.id === undefined : isInteger(need.id, 1, 100_000))

const validateWikiwikiRemodel = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-remodel 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 5_000) return 'wikiwiki-remodel 条目过多'
  for (const [shipId, raw] of entries) {
    if (
      !SAFE_NUMERIC_ID.test(shipId) ||
      !isRecord(raw) ||
      raw.targetShipId !== Number(shipId) ||
      (raw.fromShipId !== undefined && !isInteger(raw.fromShipId, 1, 100_000)) ||
      !isInteger(raw.level, 1, 1_000) ||
      !isText(raw.page, 1_000) ||
      !isText(raw.raw, 10_000) ||
      (raw.pageUpdatedAt !== undefined && !isDateText(raw.pageUpdatedAt)) ||
      !Array.isArray(raw.needs) ||
      raw.needs.length > 100
    ) {
      return `wikiwiki-remodel.${shipId} 非法`
    }
    for (const [index, need] of raw.needs.entries()) {
      if (!isWikiwikiRemodelNeed(need)) {
        return `wikiwiki-remodel.${shipId}.needs[${index}] 非法`
      }
    }
    // 同目标的其他来路（可逆循环的回环边、脚注回程边）：每条边必须声明 fromShipId。
    if (raw.edges === undefined) continue
    if (!Array.isArray(raw.edges) || raw.edges.length > 8) {
      return `wikiwiki-remodel.${shipId}.edges 非法`
    }
    for (const [index, edge] of raw.edges.entries()) {
      if (
        !isRecord(edge) ||
        !isInteger(edge.fromShipId, 1, 100_000) ||
        (edge.level !== undefined && !isInteger(edge.level, 1, 1_000)) ||
        !isText(edge.raw, 10_000) ||
        (edge.source !== undefined && !['chart', 'footnote', 'index'].includes(`${edge.source}`)) ||
        !Array.isArray(edge.needs) ||
        edge.needs.length > 100 ||
        !edge.needs.every(isWikiwikiRemodelNeed)
      ) {
        return `wikiwiki-remodel.${shipId}.edges[${index}] 非法`
      }
    }
  }
  return null
}

const WIKIWIKI_SHIP_MAX_STAT_FIELDS = [
  'kaihi', 'taisen', 'sakuteki', 'kaihiInit', 'taisenInit', 'sakutekiInit',
] as const

const validateWikiwikiShipMax = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-ship-max 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 5_000) return 'wikiwiki-ship-max 条目过多'
  for (const [shipId, raw] of entries) {
    // 六个数值字段全部可选（wiki 用「--」标未实测的一侧，拿到哪半存哪半），
    // 但存在的必须合法，且至少要有一项——空壳条目没有资格占坑
    if (
      !SAFE_NUMERIC_ID.test(shipId) ||
      !isRecord(raw) ||
      raw.shipId !== Number(shipId) ||
      !isText(raw.nameJp, 200) ||
      !isText(raw.no, 20) ||
      WIKIWIKI_SHIP_MAX_STAT_FIELDS.some(
        (field) => raw[field] !== undefined && !isInteger(raw[field], 0, 300),
      ) ||
      !WIKIWIKI_SHIP_MAX_STAT_FIELDS.some((field) => raw[field] !== undefined) ||
      (raw.source !== undefined && raw.source !== 'ship-page')
    ) {
      return `wikiwiki-ship-max.${shipId} 非法`
    }
  }
  return null
}

const SHIP_STATS_KEYS = ['evasion', 'asw', 'los'] as const
const SHIP_STATS_STATES = new Set(['ledger', 'multi', 'patched', 'single'])

// 成长三维端点（第一方汇编）。值与印证档必须成对：有值就得说得出这一格凭什么，
// 有档却没值是空口白话——两边都拒。
const validShipStatPair = (raw: unknown): boolean => {
  if (raw === undefined) return true
  if (!isRecord(raw)) return false
  for (const end of ['init', 'max'] as const) {
    const value = raw[end]
    const state = raw[end === 'init' ? 'initState' : 'maxState']
    const hasValue = value !== null && value !== undefined
    const hasState = state !== null && state !== undefined
    if (hasValue !== hasState) return false
    if (hasValue && !isInteger(value, 0, 300)) return false
    if (hasState && !SHIP_STATS_STATES.has(String(state))) return false
  }
  return true
}

const validateShipStats = (data: unknown): string | null => {
  if (!isRecord(data)) return 'ship-stats 必须是对象'
  if (data.schemaVersion !== 1) return 'ship-stats schemaVersion 不认识'
  if (!isText(data.compiledAt, 40)) return 'ship-stats compiledAt 非法'
  if (!isRecord(data.voters)) return 'ship-stats voters 非法'
  const forms = data.forms
  if (!isRecord(forms)) return 'ship-stats forms 必须是对象'
  const entries = Object.entries(forms)
  if (entries.length > 5_000) return 'ship-stats 条目过多'
  for (const [formId, raw] of entries) {
    if (!SAFE_NUMERIC_ID.test(formId) || !isRecord(raw) || !isText(raw.name, 200)) {
      return `ship-stats.${formId} 非法`
    }
    for (const key of SHIP_STATS_KEYS) {
      if (!validShipStatPair(raw[key])) return `ship-stats.${formId}.${key} 非法`
    }
  }
  return null
}

const validateWikiwikiShipProfile = (data: unknown): string | null => {
  if (!isRecord(data)) return 'wikiwiki-ship-profile 必须是对象'
  const entries = Object.entries(data)
  if (entries.length > 2_000) return 'wikiwiki-ship-profile 条目过多'
  for (const [shipId, raw] of entries) {
    // 四个档案字段全部可选(舰页缺哪项照实不发),但空壳条目没资格占坑
    if (
      !SAFE_NUMERIC_ID.test(shipId) ||
      !isRecord(raw) ||
      raw.shipId !== Number(shipId) ||
      !isText(raw.nameJp, 200) ||
      (raw.cv !== undefined && !isText(raw.cv, 100)) ||
      (raw.artist !== undefined && !isText(raw.artist, 100)) ||
      (raw.shipClass !== undefined &&
        !(Array.isArray(raw.shipClass) && raw.shipClass.length === 2 &&
          isText(raw.shipClass[0], 40) && isInteger(raw.shipClass[1], 1, 999))) ||
      (raw.initialEquips !== undefined &&
        !(Array.isArray(raw.initialEquips) && raw.initialEquips.length <= 6 &&
          raw.initialEquips.every((id: unknown) => isInteger(id, -1, 100_000)))) ||
      !['cv', 'artist', 'shipClass', 'initialEquips'].some((field) => raw[field] !== undefined)
    ) {
      return `wikiwiki-ship-profile.${shipId} 非法`
    }
  }
  return null
}

const validateKcnavRouting = (data: unknown): string | null => {
  if (
    !isRecord(data) ||
    data.schemaVersion !== 1 ||
    !isRecord(data.window) ||
    !isCalendarDate(data.window.start) ||
    !isCalendarDate(data.window.end) ||
    !isInteger(data.minCount, 1, 1_000_000) ||
    !isRecord(data.maps)
  ) {
    return 'kcnav-routing 根结构非法'
  }
  const maps = Object.entries(data.maps)
  if (maps.length > 500) return 'kcnav-routing 海图条目过多'
  for (const [map, rawMap] of maps) {
    if (!SAFE_MAP.test(map) || !isRecord(rawMap) || !isRecord(rawMap.branches)) {
      return `kcnav-routing.${map} 非法`
    }
    if (rawMap.retrieved !== null && !isDateText(rawMap.retrieved)) {
      return `kcnav-routing.${map}.retrieved 非法`
    }
    const branches = Object.entries(rawMap.branches)
    if (branches.length > 200) return `kcnav-routing.${map}.branches 过多`
    for (const [from, rawBranch] of branches) {
      if (
        !isText(from, 100) ||
        !isRecord(rawBranch) ||
        !Array.isArray(rawBranch.edges) ||
        rawBranch.edges.length < 2 ||
        rawBranch.edges.length > 100
      ) {
        return `kcnav-routing.${map}.branches.${from} 非法`
      }
      for (const [edgeIndex, edge] of rawBranch.edges.entries()) {
        if (
          !isRecord(edge) ||
          !isInteger(edge.edgeId, 1, 100_000) ||
          !isText(edge.to, 100) ||
          !Array.isArray(edge.comps) ||
          edge.comps.length > 1_000
        ) {
          return `kcnav-routing.${map}.branches.${from}.edges[${edgeIndex}] 非法`
        }
        for (const comp of edge.comps) {
          if (
            !isRecord(comp) ||
            !isIntegerArray(comp.fleetTypes, 100, 0) ||
            !Array.isArray(comp.fleet1Comp) ||
            comp.fleet1Comp.length > 12 ||
            comp.fleet1Comp.some((value) => !isText(value, 30)) ||
            !Array.isArray(comp.fleet2Comp) ||
            comp.fleet2Comp.length > 12 ||
            comp.fleet2Comp.some((value) => !isText(value, 30)) ||
            !isInteger(comp.count, 1, 1_000_000_000)
          ) {
            return `kcnav-routing.${map}.branches.${from}.edges[${edgeIndex}].comps 非法`
          }
        }
      }
    }
  }
  return null
}

const validateWikiwikiRouting = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.maps)) {
    return 'wikiwiki-routing 根结构非法'
  }
  const maps = Object.entries(data.maps)
  if (maps.length > 500) return 'wikiwiki-routing 海图条目过多'
  for (const [map, rawMap] of maps) {
    if (
      !SAFE_MAP.test(map) ||
      !isRecord(rawMap) ||
      !isText(rawMap.page, 1_000) ||
      !isText(rawMap.sourceUrl, 4_096) ||
      (rawMap.checkedAt !== null && !isCalendarDate(rawMap.checkedAt)) ||
      !Array.isArray(rawMap.nodes) ||
      rawMap.nodes.length > 200
    ) {
      return `wikiwiki-routing.${map} 非法`
    }
    for (const [nodeIndex, node] of rawMap.nodes.entries()) {
      if (
        !isRecord(node) ||
        !isText(node.from, 20) ||
        !SAFE_SPOT.test(`${node.from}`) ||
        !Array.isArray(node.routes) ||
        node.routes.length > 100
      ) {
        return `wikiwiki-routing.${map}.nodes[${nodeIndex}] 非法`
      }
      for (const [routeIndex, route] of node.routes.entries()) {
        if (
          !isRecord(route) ||
          !isText(route.to, 20) ||
          !SAFE_SPOT.test(`${route.to}`) ||
          !isText(route.conditionJp, 10_000)
        ) {
          return `wikiwiki-routing.${map}.nodes[${nodeIndex}].routes[${routeIndex}] 非法`
        }
      }
    }
  }
  return null
}

const validateSubtitle = (data: unknown, id: string): string | null => {
  if (!isRecord(data)) return `${id} 必须是对象`
  const ships = Object.entries(data)
  if (ships.length > 5_000) return `${id} 舰娘条目过多`
  for (const [shipId, rawTable] of ships) {
    if (shipId === 'version') {
      if (!isText(rawTable, 100)) return `${id}.version 非法`
      continue
    }
    if (!SAFE_NUMERIC_ID.test(shipId) || !isRecord(rawTable)) return `${id}.${shipId} 非法`
    const lines = Object.entries(rawTable)
    if (lines.length > 1_000) return `${id}.${shipId} 台词条目过多`
    for (const [voiceId, text] of lines) {
      if (!SAFE_NUMERIC_ID.test(voiceId) || !isText(text, 10_000)) {
        return `${id}.${shipId}.${voiceId} 非法`
      }
    }
  }
  return null
}

const validateExtraSubtitle = (data: unknown, id: string): string | null => {
  if (!isRecord(data)) return `${id} 必须是对象`
  const entries = Object.entries(data)
  if (entries.length > 5_000) return `${id} 台词条目过多`
  const validateLine = (raw: unknown, at: string, timed: boolean): string | null => {
    if (
      !isRecord(raw) ||
      !isText(raw.name, 1_000) ||
      !isText(raw.jp, 10_000) ||
      !isText(raw.zh, 10_000) ||
      (raw.en !== undefined && !isText(raw.en, 10_000)) ||
      (timed && !isInteger(raw.time, 0, 600_000))
    ) {
      return `${at} 非法`
    }
    return null
  }
  for (const [voiceId, raw] of entries) {
    // kc9998 的文件名不是 master id；现有深海音轨包含 9 位数字，不能套用 8 位实体 id 上限。
    if (!SAFE_EXTRA_VOICE_ID.test(voiceId)) return `${id}.${voiceId} 非法`
    if (Array.isArray(raw)) {
      if (!raw.length || raw.length > 100) return `${id}.${voiceId} 短剧条目过多或为空`
      for (const [index, line] of raw.entries()) {
        const error = validateLine(line, `${id}.${voiceId}[${index}]`, true)
        if (error) return error
      }
    } else {
      const error = validateLine(raw, `${id}.${voiceId}`, false)
      if (error) return error
    }
  }
  return null
}

const validateFitBonus = (data: unknown): string | null => {
  if (!Array.isArray(data) || data.length > 5_000) return 'fit-bonus 必须是有限数组'
  const selectors = [
    'shipX',
    'shipS',
    'shipClass',
    'shipType',
    'requires',
    'requiresType',
  ]
  const bonusSlots = ['bonus', 'bonusSR', 'bonusAR', 'bonusAccR']
  for (const [index, raw] of data.entries()) {
    if (!isRecord(raw)) return `fit-bonus[${index}] 非法`
    const idsOk = raw.ids === undefined || isIntegerArray(raw.ids, 1_000, 1)
    const typesOk = raw.types === undefined || isIntegerArray(raw.types, 1_000, 1)
    if (
      !idsOk ||
      !typesOk ||
      (!Array.isArray(raw.ids) && !Array.isArray(raw.types)) ||
      !Array.isArray(raw.bonuses) ||
      raw.bonuses.length > 500
    ) {
      return `fit-bonus[${index}] 选择器或 bonuses 非法`
    }
    for (const [bonusIndex, bonus] of raw.bonuses.entries()) {
      if (!isRecord(bonus)) return `fit-bonus[${index}].bonuses[${bonusIndex}] 非法`
      for (const selector of selectors) {
        if (bonus[selector] !== undefined && !isIntegerArray(bonus[selector], 1_000, 0)) {
          return `fit-bonus[${index}].bonuses[${bonusIndex}].${selector} 非法`
        }
      }
      if (
        bonus.shipNationality !== undefined &&
        (!Array.isArray(bonus.shipNationality) ||
          bonus.shipNationality.length > 100 ||
          bonus.shipNationality.some(
            (nationality) => !isString(nationality, 200) && !isInteger(nationality, 0, 1_000),
          ))
      ) {
        return `fit-bonus[${index}].bonuses[${bonusIndex}].shipNationality 非法`
      }
      for (const slot of bonusSlots) {
        const stats = bonus[slot]
        if (
          stats !== undefined &&
          (!isRecord(stats) ||
            Object.keys(stats).length > 100 ||
            Object.values(stats).some(
              (value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000,
            ))
        ) {
          return `fit-bonus[${index}].bonuses[${bonusIndex}].${slot} 非法`
        }
      }
    }
  }
  return null
}

// 第一方装备加成包（zh.kcwiki 底表 + 抓取时翻好的 id 空间）。
// 字段规范在 scripts/fit-bonus-schema.md；这里只挡形状与量级，语义由抓取器负责。
const FIT_BONUS_STATS = new Set([
  'fire',
  'torpedo',
  'bomb',
  'aa',
  'armor',
  'evasion',
  'asw',
  'los',
  'accuracy',
  'range',
])
const FIT_BONUS_STACKS = new Set(['perEquip', 'once', 'table'])

const isFitBonusStats = (value: unknown): boolean =>
  isRecord(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).length <= FIT_BONUS_STATS.size &&
  Object.entries(value).every(
    ([key, stat]) => FIT_BONUS_STATS.has(key) && isInteger(stat, -100, 100),
  )

const isFitBonusSelector = (value: unknown, label: string): string | null => {
  if (value === undefined) return null
  if (!isRecord(value)) return `${label} 非法`
  for (const key of Object.keys(value)) {
    if (!['forms', 'classes', 'types', 'all'].includes(key)) return `${label}.${key} 不是已知的选择器`
  }
  if (value.all !== undefined && value.all !== true) return `${label}.all 只能是 true`
  for (const key of ['forms', 'classes', 'types']) {
    const list = value[key]
    if (list !== undefined && !isIntegerArray(list, 2_000, 1, 100_000)) return `${label}.${key} 非法`
  }
  return null
}

const validateKcwikiFitBonus = (data: unknown): string | null => {
  if (!isRecord(data) || data.schemaVersion !== 1) return 'kcwiki-fit-bonus 缺 schemaVersion'
  if (!isRecord(data.equipGroups) || Object.keys(data.equipGroups).length > 50) {
    return 'kcwiki-fit-bonus.equipGroups 非法'
  }
  for (const [key, group] of Object.entries(data.equipGroups)) {
    if (!SAFE_ID.test(key) || !isRecord(group) || !isText(group.zh, 100)) {
      return `kcwiki-fit-bonus.equipGroups.${key} 非法`
    }
  }
  if (!isRecord(data.equips) || Object.keys(data.equips).length > 2_000) {
    return 'kcwiki-fit-bonus.equips 非法'
  }
  if (!Array.isArray(data.unresolved) || data.unresolved.length > 2_000) {
    return 'kcwiki-fit-bonus.unresolved 必须是有限数组'
  }
  for (const [key, entry] of Object.entries(data.equips)) {
    if (!/^\d{1,5}$/.test(key) || !isRecord(entry)) return `kcwiki-fit-bonus.equips.${key} 非法`
    if (
      !isInteger(entry.id, 1, 100_000) ||
      Number(key) !== entry.id ||
      !isText(entry.nameJa, 200) ||
      !isString(entry.nameZh, 200) ||
      !Array.isArray(entry.rules) ||
      entry.rules.length === 0 ||
      entry.rules.length > 100
    ) {
      return `kcwiki-fit-bonus.equips.${key} 的头部字段非法`
    }
    for (const [index, rule] of entry.rules.entries()) {
      const at = `kcwiki-fit-bonus.equips.${key}.rules[${index}]`
      if (!isRecord(rule) || !isInteger(rule.row, 1, 100)) return `${at} 非法`
      for (const [label, selector] of [
        [`${at}.who`, rule.who],
        [`${at}.not`, rule.not],
      ] as const) {
        const error = isFitBonusSelector(selector, label)
        if (error) return error
      }
      if (!isRecord(rule.who) || !Object.keys(rule.who).length) return `${at}.who 是空的`
      if (typeof rule.stack !== 'string' || !FIT_BONUS_STACKS.has(rule.stack)) {
        return `${at}.stack 非法`
      }
      if (rule.cap !== undefined && !isInteger(rule.cap, 1, 10)) return `${at}.cap 非法`
      if (rule.setTotal !== undefined && !isFitBonusStats(rule.setTotal)) return `${at}.setTotal 非法`
      if (rule.need !== undefined) {
        if (!isRecord(rule.need)) return `${at}.need 非法`
        if (rule.need.star !== undefined && !isInteger(rule.need.star, 1, 10)) return `${at}.need.star 非法`
        if (rule.need.with !== undefined) {
          if (!Array.isArray(rule.need.with) || rule.need.with.length > 10) return `${at}.need.with 非法`
          for (const slot of rule.need.with) {
            if (!isRecord(slot)) return `${at}.need.with 的槽位非法`
            const hasAny = slot.any !== undefined && isIntegerArray(slot.any, 50, 1, 100_000)
            const hasGroup =
              typeof slot.group === 'string' && Object.hasOwn(data.equipGroups, slot.group)
            if (!hasAny && !hasGroup) return `${at}.need.with 的槽位既不是装备也不是已知类目`
          }
        }
      }
      const gain = rule.gain
      if (!isRecord(gain)) return `${at}.gain 非法`
      if (gain.kind === 'flat') {
        if (!isFitBonusStats(gain.flat)) return `${at}.gain.flat 非法`
      } else if (gain.kind === 'byStar') {
        if (!Array.isArray(gain.steps) || !gain.steps.length || gain.steps.length > 20) {
          return `${at}.gain.steps 非法`
        }
        for (const step of gain.steps) {
          if (
            !isRecord(step) ||
            !isInteger(step.from, 0, 10) ||
            (step.to !== null && !isInteger(step.to, 0, 10)) ||
            !isFitBonusStats(step.stats)
          ) {
            return `${at}.gain.steps 的分档非法`
          }
        }
      } else if (gain.kind === 'byCount') {
        if (!Array.isArray(gain.counts) || !gain.counts.length || gain.counts.length > 20) {
          return `${at}.gain.counts 非法`
        }
        for (const step of gain.counts) {
          if (!isRecord(step) || !isInteger(step.count, 1, 20) || !isFitBonusStats(step.stats)) {
            return `${at}.gain.counts 的分档非法`
          }
        }
      } else if (gain.kind === 'byArea') {
        if (!Array.isArray(gain.areas) || !gain.areas.length || gain.areas.length > 20) {
          return `${at}.gain.areas 非法`
        }
        for (const step of gain.areas) {
          if (!isRecord(step) || !isText(step.area, 50) || !isFitBonusStats(step.stats)) {
            return `${at}.gain.areas 的分档非法`
          }
        }
      } else {
        return `${at}.gain.kind 不是已知的收益形状`
      }
    }
  }
  return null
}

const validateRouting = (data: unknown): string | null => {
  if (!isRecord(data)) return 'kcwiki-routing 必须是对象'
  const maps = Object.entries(data)
  if (maps.length > 500) return 'kcwiki-routing 海图条目过多'
  for (const [map, raw] of maps) {
    if (
      !SAFE_MAP.test(map) ||
      !isRecord(raw) ||
      !Array.isArray(raw.nodes) ||
      raw.nodes.length > 200 ||
      !isString(raw.credit, 2_000) ||
      !isText(raw.page, 2_000) ||
      !isCalendarDate(raw.contentDate)
    ) {
      return `kcwiki-routing.${map} 非法`
    }
    for (const [index, node] of raw.nodes.entries()) {
      if (
        !isRecord(node) ||
        !isText(node.from, 300) ||
        !Array.isArray(node.rules) ||
        node.rules.length > 500 ||
        node.rules.some((rule) => !isText(rule, 2_000))
      ) {
        return `kcwiki-routing.${map}.nodes[${index}] 非法`
      }
    }
  }
  return null
}

type LodeDataValidator = (data: unknown) => string | null

// 活动倍卡：矿脉里唯一「每次活动整包换掉」的战斗规则数据，所以结构校验要卡死，
// 免得活动页改版后灌进一包形状不对的东西，运行时才炸。
const validateEventBonus = (data: unknown): string | null => {
  if (!isRecord(data)) return 'event-bonus 必须是对象'
  const events = data.events
  if (!isRecord(events)) return 'event-bonus.events 必须是对象'
  if (Object.keys(events).length > 20) return 'event-bonus.events 条目过多'
  for (const [key, rawEvent] of Object.entries(events)) {
    if (!/^E\d{1,2}$/.test(key)) return `event-bonus.${key} 不是合法的活动图编号`
    if (!isRecord(rawEvent)) return `event-bonus.${key} 必须是对象`
    const entries = rawEvent.entries
    if (!Array.isArray(entries) || entries.length > 500) {
      return `event-bonus.${key}.entries 非法`
    }
    for (const [index, rawEntry] of entries.entries()) {
      if (
        !isRecord(rawEntry) ||
        typeof rawEntry.scope !== 'string' ||
        rawEntry.scope.length > 80 ||
        typeof rawEntry.by !== 'string' ||
        rawEntry.by.length > 40 ||
        typeof rawEntry.key !== 'string' ||
        rawEntry.key.length > 80 ||
        typeof rawEntry.value !== 'number' ||
        !Number.isFinite(rawEntry.value) ||
        // 倍率合理区间：小于 1 的「补正」是削弱，本表里不存在；上限留足余量
        rawEntry.value < 1 ||
        rawEntry.value > 100 ||
        typeof rawEntry.certain !== 'boolean'
      ) {
        return `event-bonus.${key}.entries[${index}] 非法`
      }
    }
    const groups = rawEvent.equipGroups
    if (groups !== undefined) {
      if (!isRecord(groups) || Object.keys(groups).length > 40) {
        return `event-bonus.${key}.equipGroups 非法`
      }
      for (const [group, members] of Object.entries(groups)) {
        if (!Array.isArray(members) || members.length > 100) {
          return `event-bonus.${key}.equipGroups.${group} 非法`
        }
        if (members.some((m) => typeof m !== 'string' || m.length > 120)) {
          return `event-bonus.${key}.equipGroups.${group} 成员名非法`
        }
      }
    }
  }
  if (data.conflicts !== undefined && !Array.isArray(data.conflicts)) {
    return 'event-bonus.conflicts 必须是数组'
  }
  if (data.unmodeled !== undefined && !Array.isArray(data.unmodeled)) {
    return 'event-bonus.unmodeled 必须是数组'
  }
  return null
}

/**
 * 活动陆航特効分组事实表。
 *
 * `event` 是期号（与 event-bonus 包的 page= 对齐），**不许空**——空了就等于
 * 这张名单对任何一期都生效，换期后会拿上一期的分组去套新图。
 * 组代号只认 C 组：舰上那一侧（A/B）本表不收，收了也没有消费端。
 */
const PLANE_GROUP_CODES = /^C\d$/

const validateEventPlaneGroups = (data: unknown): string | null => {
  if (!isRecord(data)) return 'event-plane-groups 必须是对象'
  if (!isString(data.event, 120) || !data.event) return 'event-plane-groups.event 缺期号'
  if (!isString(data.basis, 200) || !data.basis) return 'event-plane-groups.basis 缺置信度'
  const groups = data.groups
  if (!isRecord(groups) || !Object.keys(groups).length || Object.keys(groups).length > 10) {
    return 'event-plane-groups.groups 非法'
  }
  const seen = new Set<number>()
  for (const [group, members] of Object.entries(groups)) {
    if (!PLANE_GROUP_CODES.test(group)) return `event-plane-groups.groups.${group} 不是合法组代号`
    if (!Array.isArray(members) || !members.length || members.length > 200) {
      return `event-plane-groups.groups.${group} 非法`
    }
    for (const member of members) {
      if (!isInteger(member, 1)) return `event-plane-groups.groups.${group} 成员 id 非法`
      // 同一件装备在同一期落进两个 C 组＝名单读错了（多半是解析错位），当场拦下
      if (seen.has(member as number)) {
        return `event-plane-groups 里装备 ${member} 同时落在两个组`
      }
      seen.add(member as number)
    }
  }
  if (data.names !== undefined && !isRecord(data.names)) {
    return 'event-plane-groups.names 必须是对象'
  }
  return null
}

const CJK_TEXT = /\p{Script=Han}/u

const validateOpenccT2s = (data: unknown): string | null => {
  if (
    !isRecord(data) ||
    data.schemaVersion !== 1 ||
    !isRecord(data.chars) ||
    !isRecord(data.phrases)
  ) {
    return 'opencc-t2s 必须是 schemaVersion=1 且含 chars/phrases 的对象'
  }
  for (const [name, dictionary] of [
    ['chars', data.chars],
    ['phrases', data.phrases],
  ] as const) {
    for (const [key, value] of Object.entries(dictionary)) {
      if (
        !CJK_TEXT.test(key) ||
        typeof value !== 'string' ||
        !CJK_TEXT.test(value)
      ) {
        return `opencc-t2s.${name}.${key} 必须是含 CJK 的 string→string`
      }
    }
  }
  return null
}

const LODE_DATA_VALIDATORS: Record<string, LodeDataValidator> = {
  'abyssal-stats': validateAbyssalStats,
  'wikiwiki-ship-profile': validateWikiwikiShipProfile,
  'ship-exp': validateShipExp,
  'dev-recipes': validateDevRecipes,
  'build-recipes': validateBuildRecipes,
  'akashi-list': validateAkashiList,
  'kcwiki-ships': validateKcwikiShips,
  'kcwiki-expedition': validateExpeditions,
  'kcwiki-bgm': validateKcwikiBgm,
  'wikiwiki-expedition': validateWikiwikiExpeditions,
  'quests-scn': validateScnQuests,
  'eo-quests': validateEoQuests,
  'wikiwiki-quests': validateWikiwikiQuests,
  'wikiwiki-item-exchange': validateWikiwikiItemExchange,
  'kcwiki-quest-req': validateKcwikiQuestReq,
  'poi-quest-goal': validatePoiQuestGoal,
  'poi-fcd-map': validateFcdMap,
  'equip-upgrades': validateEquipUpgrades,
  'equip-improve': validateEquipImprove,
  'equip-aa-evasion': validateEquipAaEvasion,
  'kcwiki-voice': validateVoice,
  'kcwiki-seasonal-voice': validateSeasonalVoice,
  'kanso-voice': validateKansoVoice,
  'kanso-voice-zh': validateKansoVoiceZh,
  'wikiwiki-voice': validateWikiwikiVoice,
  'wikiwiki-remodel': validateWikiwikiRemodel,
  'wikiwiki-ship-max': validateWikiwikiShipMax,
  'ship-stats': validateShipStats,
  'wikiwiki-abyss-voice': validateWikiwikiAbyssVoice,
  'subtitle-zh': (data) => validateSubtitle(data, 'subtitle-zh'),
  'subtitle-ja': (data) => validateSubtitle(data, 'subtitle-ja'),
  'subtitle-npc': (data) => validateExtraSubtitle(data, 'subtitle-npc'),
  'subtitle-enemies': (data) => validateExtraSubtitle(data, 'subtitle-enemies'),
  'fit-bonus': validateFitBonus,
  'kcwiki-fit-bonus': validateKcwikiFitBonus,
  'kcwiki-routing': validateRouting,
  'wikiwiki-routing': validateWikiwikiRouting,
  'kcnav-routing': validateKcnavRouting,
  'map-intel': validateMapIntel,
  'map-enemy-comps': validateMapEnemyComps,
  'map-drops': validateMapDrops,
  'map-drop-windows': validateMapDropWindows,
  'event-lifecycle': validateEventLifecycle,
  'event-bonus': validateEventBonus,
  'event-plane-groups': validateEventPlaneGroups,
  'opencc-t2s': validateOpenccT2s,
  'kcwiki-localization': validateLocalization,
}

export const SUPPORTED_LODE_IDS = Object.freeze(Object.keys(LODE_DATA_VALIDATORS))

export interface ValidatedLodePack {
  meta: {
    id: string
    name: string
    version: string
    source: string
    sourceUrl?: string
    fetchedAt: string
    upstreamUpdatedAt?: string | null
    note?: string
    [key: string]: unknown
  }
  data: unknown
}

export const validateLodePack = (
  value: unknown,
): { ok: true; pack: ValidatedLodePack } | { ok: false; error: string } => {
  if (!isRecord(value) || !isRecord(value.meta) || value.data === undefined) {
    return { ok: false, error: '缺少 meta 或 data' }
  }
  const meta = value.meta
  if (
    typeof meta.id !== 'string' ||
    !SAFE_ID.test(meta.id) ||
    !isText(meta.name, 200) ||
    !isText(meta.version, 100) ||
    !isText(meta.source, 300) ||
    !isDateText(meta.fetchedAt) ||
    (meta.upstreamUpdatedAt !== undefined &&
      meta.upstreamUpdatedAt !== null &&
      !isDateText(meta.upstreamUpdatedAt))
  ) {
    return { ok: false, error: 'meta 字段非法' }
  }
  const sourceUrl = meta.sourceUrl
  if (sourceUrl !== undefined && sourceUrl !== null && !isText(sourceUrl, 4096)) {
    return { ok: false, error: 'meta.sourceUrl 必须是有限长度的字符串' }
  }
  const note = meta.note
  if (note !== undefined && note !== null && !isText(note, 2000)) {
    return { ok: false, error: 'meta.note 必须是有限长度的字符串' }
  }
  const validator = LODE_DATA_VALIDATORS[meta.id]
  if (!validator) return { ok: false, error: `不支持的矿脉包 ${meta.id}` }
  const boundedError = validateBoundedJson(value.data, meta.id)
  if (boundedError) return { ok: false, error: boundedError }
  const error = validator(value.data)
  if (error) return { ok: false, error }
  return { ok: true, pack: value as unknown as ValidatedLodePack }
}
