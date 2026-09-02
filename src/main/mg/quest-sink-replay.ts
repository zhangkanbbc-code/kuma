import { createQuestEngine } from './quest-counter'
import { reduceQuestList } from './quest-state'
import { isEnemyReallySunk } from '../../shared/enemy-sunk'
import {
  questAnnualMonth,
  questPeriodFromCode,
  questPeriodStart,
} from '../../shared/quest-period'

export interface QuestReplayEventRow {
  id: number
  ts: number
  path: string
  body: string | null
  postBody: string | null
}

export interface QuestReplayBattleRow {
  id: number
  ts: number
  map: number
  cell: number
  snapshot: string
}

export interface ExcludedSinkBattle {
  ts: number
  map: number
  cell: number
  mstId: number
  questId: number
  kind: string
}

export interface RecomputedQuestProgress {
  questId: number
  counts: number[] | null
  updated: number | null
  periodStart: number
}

export interface QuestSinkReplayResult {
  progress: Record<number, RecomputedQuestProgress>
  eligibleQuestIds: number[]
  failedQuestIds: number[]
  excluded: ExcludedSinkBattle[]
  missingBattleSnapshots: number[]
}

export interface QuestSinkReplayInput {
  targetQuestIds: number[]
  events: QuestReplayEventRow[]
  battles: QuestReplayBattleRow[]
  now: number
  masterRaw: any
  getLode: (id: string) => { data?: unknown } | null
}

export interface QuestProgressChange {
  questId: number
  oldCounts: number[] | null
  newCounts: number[] | null
  oldValue: number
  newValue: number
  diff: number
  updated: number | null
}

const RESULT_PATHS = new Set([
  '/kcsapi/api_req_sortie/battleresult',
  '/kcsapi/api_req_combined_battle/battleresult',
])

const parseJson = (raw: string): { ok: true; value: any } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (_error) {
    return { ok: false }
  }
}

const emptyReplayState = (): any => ({
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
})

const applyQuestLifecycle = (
  state: ReturnType<typeof emptyReplayState>,
  targetQuestId: number,
  apiPath: string,
  body: any,
  post: Record<string, string>,
  ts: number,
) => {
  const player = state.player
  if (apiPath === '/kcsapi/api_get_member/questlist') {
    const filteredBody = Array.isArray(body?.api_list)
      ? {
          ...body,
          api_list: body.api_list.filter((quest: any) => Number(quest?.api_no) === targetQuestId),
        }
      : body
    const update = reduceQuestList(player.quests, player.questActiveIds, filteredBody, post)
    if (!update) return
    player.quests = update.quests
    player.questActiveIds = update.activeIds
    player.questExecCount = update.execCount
    const tabId = parseInt(`${post.api_tab_id ?? -1}`, 10)
    if (tabId === 0 || tabId === 9) player.questActiveTs = ts
    if (tabId === 0) player.questsFullTs = ts
    player.questsTs = ts
    return
  }

  const questId = parseInt(`${post.api_quest_id ?? ''}`, 10)
  if (questId !== targetQuestId) return
  if (apiPath === '/kcsapi/api_req_quest/start') {
    const activeIds = player.questActiveIds
    const wasActive = activeIds?.includes(questId) ?? player.quests[questId]?.state === 2
    if (player.quests[questId]) player.quests[questId].state = 2
    if (activeIds) {
      player.questActiveIds = [...new Set([...activeIds, questId])]
      player.questActiveTs = ts
    }
    if (!wasActive && player.questExecCount != null) player.questExecCount += 1
    return
  }
  if (apiPath === '/kcsapi/api_req_quest/stop') {
    const quest = player.quests[questId]
    if (!quest) return
    quest.state = 1
    if (player.questActiveIds) {
      player.questActiveIds = player.questActiveIds.filter((id: number) => id !== questId)
      player.questActiveTs = ts
    }
    if (player.questExecCount != null) {
      player.questExecCount = Math.max(0, player.questExecCount - 1)
    }
    return
  }
  if (apiPath === '/kcsapi/api_req_quest/clearitemget') {
    const activeIds = player.questActiveIds
    const wasActive = activeIds?.includes(questId) ?? false
    if (player.quests[questId]) delete player.quests[questId]
    if (activeIds) {
      player.questActiveIds = activeIds.filter((id: number) => id !== questId)
      player.questActiveTs = ts
    }
    if (wasActive && player.questExecCount != null) {
      player.questExecCount = Math.max(0, player.questExecCount - 1)
    }
  }
}

const withoutQuestInfoLogs = <T>(run: () => T): T => {
  const log = console.log
  console.log = () => {}
  try {
    return run()
  } finally {
    console.log = log
  }
}

const replayOneQuest = (
  input: QuestSinkReplayInput,
  questId: number,
  periodStart: number,
): {
  progress: RecomputedQuestProgress
  failed: boolean
  excluded: ExcludedSinkBattle[]
  missingBattleSnapshots: number[]
} => {
  const state = emptyReplayState()
  let updated: number | null = null
  const snapshotQueues = new Map<number, QuestReplayBattleRow[]>()
  for (const battle of input.battles) {
    if (battle.ts < periodStart) continue
    const queue = snapshotQueues.get(battle.ts) ?? []
    queue.push(battle)
    snapshotQueues.set(battle.ts, queue)
  }
  const engine = createQuestEngine({
    getLode: input.getLode,
    ledger: {
      loadSnapshot: () => undefined,
      loadQuestProgress: () => ({}),
      saveQuestProgress: (savedQuestId) => {
        if (savedQuestId === questId) updated = Date.now()
      },
      deleteQuestProgress: (deletedQuestId) => {
        if (deletedQuestId === questId) updated = null
      },
    },
    store: { getState: () => state as any },
    send: () => {},
  })
  withoutQuestInfoLogs(() => engine.init(input.masterRaw))
  const tracker = engine.state().trackers[questId]
  const excluded: ExcludedSinkBattle[] = []
  const missingBattleSnapshots: number[] = []
  const masterStypes = new Map<number, number>(
    (input.masterRaw?.api_mst_ship ?? []).map((ship: any) => [
      Number(ship?.api_id),
      Number(ship?.api_stype),
    ]),
  )
  const sinkStypes = tracker.tasks.flatMap((task: any) =>
    task.kind === 'sinkEnemy' ? task.stypes : [],
  )
  const realNow = Date.now
  let failed = false
  try {
    for (const row of input.events) {
      if (row.ts < periodStart || row.body == null) continue
      const parsedBody = parseJson(row.body)
      if (!parsedBody.ok) {
        console.warn(`[kanso] 任务回算事件正文损坏 quest=${questId} event=${row.id}`)
        failed = true
        break
      }
      const parsedPost = row.postBody == null ? { ok: true as const, value: {} } : parseJson(row.postBody)
      if (!parsedPost.ok) {
        console.warn(`[kanso] 任务回算任务参数损坏 quest=${questId} event=${row.id}`)
        failed = true
        break
      }
      const parsed = parsedBody.value
      const post = parsedPost.value
      if (!parsed || (parsed.api_result !== undefined && parsed.api_result !== 1)) continue
      const body = parsed.api_data ?? parsed
      Date.now = () => row.ts
      applyQuestLifecycle(state, questId, row.path, body, post, row.ts)

      let snapshot: QuestReplayBattleRow | undefined
      if (RESULT_PATHS.has(row.path)) {
        const targetActive = engine.state().trackers[questId]?.blocked == null
        snapshot = snapshotQueues.get(row.ts)?.shift()
        if (snapshot) {
          try {
            state.sortie = JSON.parse(snapshot.snapshot)
          } catch (_error) {
            state.sortie = null
            if (targetActive) {
              missingBattleSnapshots.push(row.id)
              console.warn(
                `[kanso] 任务回算战斗快照损坏 quest=${questId} event=${row.id} snapshot=${snapshot.id}`,
              )
              failed = true
              break
            }
          }
        } else {
          state.sortie = null
          if (targetActive) {
            missingBattleSnapshots.push(row.id)
            console.warn(`[kanso] 任务回算缺少战斗快照 quest=${questId} event=${row.id}`)
            failed = true
            break
          }
        }
      }

      if (
        snapshot &&
        state.sortie?.battle &&
        engine.state().trackers[questId]?.blocked == null
      ) {
        for (const ship of state.sortie.battle.eShips ?? []) {
          const stype = masterStypes.get(Number(ship?.mstId)) ?? -1
          if (
            state.sortie.battle.kind === 'subAirRaid' &&
            Number(ship?.hpEnd) <= 0 &&
            sinkStypes.includes(stype) &&
            !isEnemyReallySunk(ship)
          ) {
            excluded.push({
              ts: row.ts,
              map: snapshot.map,
              cell: snapshot.cell,
              mstId: Number(ship.mstId),
              questId,
              kind: state.sortie.battle.kind,
            })
          }
        }
      }
      withoutQuestInfoLogs(() => engine.onApi(row.path, body, post))
    }
    Date.now = () => input.now
    withoutQuestInfoLogs(() => engine.resetExpired(input.now))
  } finally {
    Date.now = realNow
  }
  return {
    progress: {
      questId,
      counts: engine.state().progress[questId] ?? null,
      updated,
      periodStart,
    },
    failed,
    excluded,
    missingBattleSnapshots,
  }
}

export const recomputeSinkQuestProgress = (
  input: QuestSinkReplayInput,
): QuestSinkReplayResult => {
  const firstEventTs = input.events[0]?.ts ?? input.now
  const scn = input.getLode('quests-scn')?.data as Record<number, any> | undefined
  const probeState = emptyReplayState()
  const probe = createQuestEngine({
    getLode: input.getLode,
    ledger: {
      loadSnapshot: () => undefined,
      loadQuestProgress: () => ({}),
      saveQuestProgress: () => {},
      deleteQuestProgress: () => {},
    },
    store: { getState: () => probeState as any },
    send: () => {},
  })
  withoutQuestInfoLogs(() => probe.init(input.masterRaw))
  const trackers = probe.state().trackers
  const eligibleQuestIds = [...new Set(input.targetQuestIds)]
    .filter((questId) => {
      const tasks = trackers[questId]?.tasks ?? []
      return (
        tasks.length > 0 &&
        tasks.every((task: any) => task.kind === 'sinkEnemy') &&
        tasks.some((task: any) =>
          task.stypes.some((stype: number) => stype === 7 || stype === 11),
        )
      )
    })
    .sort((left, right) => left - right)
  const progress: Record<number, RecomputedQuestProgress> = {}
  const failedQuestIds: number[] = []
  const excluded: ExcludedSinkBattle[] = []
  const missingBattleSnapshots: number[] = []
  for (const questId of eligibleQuestIds) {
    const quest = scn?.[questId]
    const resetNote = `${quest?.memo2 ?? ''}`
    const period = questPeriodFromCode(`${quest?.code ?? ''}`, resetNote)
    const start = period
      ? questPeriodStart(period, input.now, questAnnualMonth(resetNote)) ?? firstEventTs
      : firstEventTs
    const replayed = replayOneQuest(input, questId, start)
    progress[questId] = replayed.progress
    if (replayed.failed) failedQuestIds.push(questId)
    excluded.push(...replayed.excluded)
    missingBattleSnapshots.push(...replayed.missingBattleSnapshots)
  }
  return {
    progress,
    eligibleQuestIds,
    failedQuestIds,
    excluded,
    missingBattleSnapshots: [...new Set(missingBattleSnapshots)].sort((left, right) => left - right),
  }
}

const countsOf = (raw: unknown): { ok: true; value: number[] } | { ok: false } => {
  if (typeof raw !== 'string') return { ok: false }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((value) => Number.isFinite(value))
      ? { ok: true, value: parsed.map(Number) }
      : { ok: false }
  } catch (_error) {
    return { ok: false }
  }
}

export const planQuestProgressChanges = (
  db: any,
  replay: QuestSinkReplayResult,
): QuestProgressChange[] => {
  const select = db.prepare('SELECT counts FROM quest_progress WHERE quest_id = ?')
  return replay.eligibleQuestIds.flatMap((questId) => {
    if (replay.failedQuestIds.includes(questId)) return []
    const oldRow = select.get(questId)
    let oldCounts: number[] | null = null
    if (oldRow) {
      const parsed = countsOf(oldRow.counts)
      if (!parsed.ok) {
        console.warn(`[kanso] 任务回算旧进度损坏 quest=${questId}`)
        return []
      }
      oldCounts = parsed.value
    }
    const recomputed = replay.progress[questId]
    const newCounts = recomputed?.counts ?? null
    const oldValue = Number(oldCounts?.[0] ?? 0)
    const newValue = Number(newCounts?.[0] ?? 0)
    return [{
      questId,
      oldCounts,
      newCounts,
      oldValue,
      newValue,
      diff: newValue - oldValue,
      updated: recomputed?.updated ?? null,
    }]
  })
}

export const overwriteQuestProgress = (
  db: any,
  changes: QuestProgressChange[],
) => {
  const upsert = db.prepare(
    `INSERT INTO quest_progress (quest_id, counts, updated) VALUES (?, ?, ?)
     ON CONFLICT(quest_id) DO UPDATE SET counts = excluded.counts, updated = excluded.updated`,
  )
  const remove = db.prepare('DELETE FROM quest_progress WHERE quest_id = ?')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const change of changes) {
      if (change.newCounts) {
        upsert.run(change.questId, JSON.stringify(change.newCounts), change.updated ?? 0)
      } else {
        remove.run(change.questId)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
