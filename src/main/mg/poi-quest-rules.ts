import type { QpTask } from '../../shared/qp-types'

export interface PoiQuestContext {
  missionIdsByName: Map<string, number>
}

export interface PoiTrackerDraft {
  tasks: QpTask[]
  partial: boolean
}

export const buildPoiQuestContext = (
  masterRaw: any,
  expeditionData: unknown,
): PoiQuestContext => {
  const missionIdsByName = new Map<string, number>()
  const missionIdsByDispNo = new Map<string, number>()
  for (const mission of masterRaw?.api_mst_mission ?? []) {
    if (!Number.isInteger(mission?.api_id) || mission.api_id <= 0) continue
    if (typeof mission.api_name === 'string' && mission.api_name.trim()) {
      missionIdsByName.set(mission.api_name.trim(), mission.api_id)
    }
    if (typeof mission.api_disp_no === 'string' && mission.api_disp_no.trim()) {
      missionIdsByDispNo.set(mission.api_disp_no.trim(), mission.api_id)
    }
  }
  if (expeditionData && typeof expeditionData === 'object' && !Array.isArray(expeditionData)) {
    for (const [dispNo, raw] of Object.entries<any>(expeditionData)) {
      const missionId = missionIdsByDispNo.get(dispNo)
      if (!missionId || !raw || typeof raw !== 'object') continue
      for (const name of [raw.nameJp, raw.nameZh]) {
        if (typeof name === 'string' && name.trim()) {
          missionIdsByName.set(name.trim(), missionId)
        }
      }
    }
  }
  return { missionIdsByName }
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const onlyFields = (goal: Record<string, any>, allowed: string[]): boolean => {
  const fields = new Set(['description', 'required', 'init', ...allowed])
  return Object.keys(goal).every((key) => fields.has(key))
}

const requiredCount = (goal: Record<string, any>): number | null => {
  if (!Number.isInteger(goal.required) || goal.required <= 0) return null
  const initial = goal.init === undefined ? 0 : goal.init
  if (!Number.isInteger(initial) || initial < 0 || initial >= goal.required) return null
  return goal.required - initial
}

const mapRefs = (raw: unknown): [number, number][] | null => {
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) return null
  const maps: [number, number][] = []
  for (const encoded of raw) {
    if (!Number.isInteger(encoded) || encoded < 11 || encoded > 109) return null
    const area = Math.floor(encoded / 10)
    const info = encoded % 10
    if (area <= 0 || area > 10 || info <= 0) return null
    const map: [number, number] = [area, info]
    if (!maps.some(([a, i]) => a === area && i === info)) maps.push(map)
  }
  return maps
}

const integerList = (raw: unknown, max = 1_000): number[] | null => {
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > 100 ||
    raw.some((value) => !Number.isInteger(value) || value <= 0 || value > max)
  ) return null
  return [...new Set(raw)]
}

const decodeGoal = (
  kind: string,
  goal: Record<string, any>,
  context: PoiQuestContext,
): QpTask[] | null => {
  const count = requiredCount(goal)
  if (count == null) return null
  const bare = () => onlyFields(goal, [])

  if (kind === 'battle' && bare()) return [{ kind: 'battleWin', rank: 0, count }]
  if (kind === 'battle_win' && bare()) return [{ kind: 'battleWin', rank: 4, count }]
  if (kind === 'battle_rank_s' && bare()) return [{ kind: 'battleWin', rank: 6, count }]

  const bossRanks: Record<string, number> = {
    battle_boss_win: 4,
    battle_boss_win_rank_a: 5,
    battle_boss_win_rank_s: 6,
  }
  if (bossRanks[kind] !== undefined) {
    if (!onlyFields(goal, ['maparea'])) return null
    const maps = mapRefs(goal.maparea)
    if (!maps) return null
    return maps.map((map) => ({
      kind: 'bossKill',
      map,
      rank: bossRanks[kind],
      count,
    }))
  }

  if (kind === 'sinking') {
    if (!onlyFields(goal, ['shipType'])) return null
    const stypes = integerList(goal.shipType, 1_000)
    return stypes?.length ? [{ kind: 'sinkEnemy', stypes, count }] : null
  }

  if (kind === 'mission_success') {
    if (!onlyFields(goal, ['mission'])) return null
    if (goal.mission === undefined) {
      return [{ kind: 'expedition', missionId: 0, count }]
    }
    if (
      !Array.isArray(goal.mission) ||
      !goal.mission.length ||
      goal.mission.length > 100
    ) return null
    const missionIds: number[] = []
    for (const rawName of goal.mission) {
      if (typeof rawName !== 'string') return null
      const missionId = context.missionIdsByName.get(rawName.trim())
      if (!missionId) return null
      if (!missionIds.includes(missionId)) missionIds.push(missionId)
    }
    return missionIds.map((missionId) => ({ kind: 'expedition', missionId, count }))
  }

  if (kind === 'destory_item') {
    if (!onlyFields(goal, ['slotitemType2'])) return null
    const categories = integerList(goal.slotitemType2, 1_000)
    return categories?.map((category) => ({ kind: 'scrapCategory', category, count })) ?? null
  }

  const practiceRanks: Record<string, number> = {
    practice: 0,
    practice_win: 4,
    practice_win_a: 5,
    practice_win_s: 6,
  }
  if (practiceRanks[kind] !== undefined && bare()) {
    return [{ kind: 'exercise', rank: practiceRanks[kind], count }]
  }

  const actions = {
    create_ship: { action: 'createship', label: '建造舰娘' },
    create_item: { action: 'createitem', label: '开发装备' },
    destroy_ship: { action: 'destroyship', label: '解体舰娘' },
    remodel_item: { action: 'remodel_slot', label: '改修装备' },
    remodel_ship: { action: 'powerup', label: '近代化改修' },
    repair: { action: 'nyukyo', label: '入渠' },
    supply: { action: 'charge', label: '补给' },
  } as const
  const action = actions[kind as keyof typeof actions]
  return action && bare()
    ? [{ kind: 'action', action: action.action, label: action.label, count }]
    : null
}

export const decodePoiQuestGoal = (
  rawQuest: unknown,
  context: PoiQuestContext,
): PoiTrackerDraft | null => {
  if (!isRecord(rawQuest)) return null
  const goals = Object.entries(rawQuest)
    .filter(([key]) => !['type', 'fuzzy', 'resetInterval'].includes(key))
  if (!goals.length || goals.length > 100) return null
  const splitKeys = goals.map(([key]) => {
    const at = key.indexOf('@')
    return {
      key,
      kind: at >= 0 ? key.slice(0, at) : key,
      suffix: at >= 0 ? key.slice(at + 1) : null,
    }
  })
  const exactLabeledCompound = splitKeys.every(
    ({ kind, suffix }) =>
      Boolean(suffix) && (kind === 'mission_success' || kind === 'destory_item'),
  )
  // fuzzy/@ 的通用语法不解释；只对白名单内、字段可交叉核对的远征和废弃复合目标开口。
  if ((rawQuest.fuzzy === true || splitKeys.some(({ suffix }) => suffix)) && !exactLabeledCompound) {
    return null
  }
  const tasks: QpTask[] = []
  let slot = 0
  for (let index = 0; index < goals.length; index += 1) {
    const [, rawGoal] = goals[index]
    const { kind, suffix } = splitKeys[index]
    if (!isRecord(rawGoal)) return null
    if (
      suffix &&
      kind === 'mission_success' &&
      (
        !Array.isArray(rawGoal.mission) ||
        rawGoal.mission.length !== 1 ||
        rawGoal.mission[0] !== suffix
      )
    ) return null
    if (
      suffix &&
      kind === 'destory_item' &&
      typeof rawGoal.description === 'string' &&
      !rawGoal.description.includes(suffix)
    ) return null
    const decoded = decodeGoal(kind, rawGoal, context)
    if (!decoded?.length) return null
    tasks.push(...decoded.map((task) => ({ ...task, slot })))
    slot += 1
  }
  return { tasks, partial: false }
}
