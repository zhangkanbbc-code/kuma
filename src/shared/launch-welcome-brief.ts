// 开幕「上次退出」快照简报：只采白名单业务字段，不含提督昵称与提督编号。
// 供科技控制台与机甲舱门在游戏加载完成前展示上次退出前的资源、远征、入渠与现役任务。

export const WELCOME_BRIEF_CONFIG_KEY = 'kuma.launchWelcomeBrief.v1'

export interface WelcomeBriefExpedition {
  fleet: number
  missionId: number
  returnAt: number
}

export interface WelcomeBriefNdock {
  dock: number
  shipName?: string
  completeAt: number
}

export interface WelcomeBriefCache {
  savedAt: number
  admiralLevel?: number
  admiralRank?: number
  materials: [number, number, number, number]
  buckets: number
  ships: [number, number]
  expeditions: WelcomeBriefExpedition[]
  ndocks: WelcomeBriefNdock[]
  activeQuests: number
  senka?: number
}

export interface WelcomeBriefPlayerInput {
  basic?: {
    level?: number
    rank?: number
    maxShips?: number
  } | null
  materials?: readonly number[] | null
  ships?: Record<number | string, { id?: number; shipId: number }> | null
  decks?: readonly { id: number; mission?: readonly number[] }[] | null
  ndocks?: readonly { id: number; shipId: number; completeTime: number; state?: number }[] | null
  quests?: Record<number | string, { no?: number; state: number }> | null
}

const finiteOr = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * 从当前玩家状态提取只读快照摘要；缺提督信息或资源时返回 null，绝不编造数字。
 */
export const welcomeBriefOf = (
  player: WelcomeBriefPlayerInput | null | undefined,
  now: number,
  shipNameOf?: (mstId: number) => string | undefined,
): WelcomeBriefCache | null => {
  if (!player?.basic || !Array.isArray(player.materials) || player.materials.length < 4) return null

  const materials: [number, number, number, number] = [
    finiteOr(player.materials[0]),
    finiteOr(player.materials[1]),
    finiteOr(player.materials[2]),
    finiteOr(player.materials[3]),
  ]
  const buckets = finiteOr(player.materials[5])
  const shipsMap = player.ships ?? {}
  const ownedCount = Object.keys(shipsMap).length
  const maxShips = finiteOr(player.basic.maxShips)

  const expeditions: WelcomeBriefExpedition[] = []
  for (const deck of player.decks ?? []) {
    if (deck.id < 2 || deck.id > 4) continue
    const mission = deck.mission
    if (!mission || finiteOr(mission[0]) <= 0) continue
    expeditions.push({
      fleet: deck.id,
      missionId: finiteOr(mission[1]),
      returnAt: finiteOr(mission[2]),
    })
  }
  expeditions.sort((a, b) => a.fleet - b.fleet)

  const ndocks: WelcomeBriefNdock[] = []
  for (const dock of player.ndocks ?? []) {
    if (!dock || finiteOr(dock.shipId) <= 0) continue
    const ship = shipsMap[dock.shipId]
    const rawName = ship && shipNameOf ? shipNameOf(ship.shipId) : undefined
    const shipName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined
    const entry: WelcomeBriefNdock = {
      dock: finiteOr(dock.id),
      completeAt: finiteOr(dock.completeTime),
    }
    if (shipName) entry.shipName = shipName
    ndocks.push(entry)
  }
  ndocks.sort((a, b) => a.dock - b.dock)

  let activeQuests = 0
  for (const quest of Object.values(player.quests ?? {})) {
    if (quest && (quest.state === 2 || quest.state === 3)) activeQuests += 1
  }

  const out: WelcomeBriefCache = {
    savedAt: finiteOr(now),
    materials,
    buckets,
    ships: [ownedCount, maxShips],
    expeditions,
    ndocks,
    activeQuests,
  }
  if (typeof player.basic.level === 'number' && Number.isFinite(player.basic.level)) {
    out.admiralLevel = player.basic.level
  }
  if (typeof player.basic.rank === 'number' && Number.isFinite(player.basic.rank)) {
    out.admiralRank = player.basic.rank
  }
  return out
}

const isFiniteNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const isWelcomeBriefCache = (value: unknown): value is WelcomeBriefCache => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!isFiniteNum(v.savedAt) || !isFiniteNum(v.buckets) || !isFiniteNum(v.activeQuests)) return false
  if (!Array.isArray(v.materials) || v.materials.length !== 4 || !v.materials.every(isFiniteNum)) return false
  if (!Array.isArray(v.ships) || v.ships.length !== 2 || !v.ships.every(isFiniteNum)) return false
  if (!Array.isArray(v.expeditions) || !Array.isArray(v.ndocks)) return false
  return true
}

export interface WelcomeBriefConfig {
  get(key: string, fallback: unknown): unknown
  set(key: string, value: WelcomeBriefCache): void
}

export const readWelcomeBrief = (config: Pick<WelcomeBriefConfig, 'get'>): WelcomeBriefCache | null => {
  const raw = config.get(WELCOME_BRIEF_CONFIG_KEY, null)
  return isWelcomeBriefCache(raw) ? raw : null
}

/** 按内容值判重（忽略 savedAt 时间戳），避免游戏静默补丁触发无意义落盘。 */
export const sameWelcomeBriefData = (
  a: WelcomeBriefCache | null,
  b: WelcomeBriefCache | null,
): boolean => {
  if (!a || !b) return false
  if (a.admiralLevel !== b.admiralLevel || a.admiralRank !== b.admiralRank) return false
  if (a.buckets !== b.buckets || a.activeQuests !== b.activeQuests || a.senka !== b.senka) return false
  if (a.ships[0] !== b.ships[0] || a.ships[1] !== b.ships[1]) return false
  for (let i = 0; i < 4; i++) if (a.materials[i] !== b.materials[i]) return false
  if (a.expeditions.length !== b.expeditions.length) return false
  for (let i = 0; i < a.expeditions.length; i++) {
    const x = a.expeditions[i]
    const y = b.expeditions[i]
    if (x.fleet !== y.fleet || x.missionId !== y.missionId || x.returnAt !== y.returnAt) return false
  }
  if (a.ndocks.length !== b.ndocks.length) return false
  for (let i = 0; i < a.ndocks.length; i++) {
    const x = a.ndocks[i]
    const y = b.ndocks[i]
    if (x.dock !== y.dock || x.shipName !== y.shipName || x.completeAt !== y.completeAt) return false
  }
  return true
}

/** 舰C 提督军衔代号（api_rank 1..10）。 */
export const ADMIRAL_RANK_LABELS: Readonly<Record<number, string>> = {
  1: '元帅',
  2: '大将',
  3: '中将',
  4: '少将',
  5: '大佐',
  6: '中佐',
  7: '新米中佐',
  8: '少佐',
  9: '中坚少佐',
  10: '新米少佐',
}
