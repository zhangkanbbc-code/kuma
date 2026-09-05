import type { QpTask } from './qp-types'
import type { QuestAvailability } from './quest-availability'

export interface ExpeditionOverlapItem {
  missionId: number
  count: number
}

export interface ExpeditionOverlap {
  questId: number
  status?: QuestAvailability
  items: ExpeditionOverlapItem[]
}

export interface ExpeditionOverlapInput {
  questId: number
  trackers: Record<number, { tasks: QpTask[] }>
  quests: Array<{ id: number; code: string }>
  verdictOf: (id: number) => QuestAvailability | undefined
  missionCodeOf: (missionId: number) => string | undefined
}

const compareMission = (
  left: ExpeditionOverlapItem,
  right: ExpeditionOverlapItem,
  missionCodeOf: ExpeditionOverlapInput['missionCodeOf'],
): number => {
  // 「任意远征」能与每条指定远征一起推进，但不能抢在更具体、更有用的搭车项前面。
  if (left.missionId === 0 || right.missionId === 0) {
    return left.missionId === right.missionId ? 0 : left.missionId === 0 ? 1 : -1
  }
  const leftCode = missionCodeOf(left.missionId) ?? `${left.missionId}`
  const rightCode = missionCodeOf(right.missionId) ?? `${right.missionId}`
  const leftNumeric = /^\d+$/.test(leftCode)
  const rightNumeric = /^\d+$/.test(rightCode)
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  if (leftNumeric) {
    const difference = Number(leftCode) - Number(rightCode)
    if (difference) return difference
  } else if (leftCode !== rightCode) {
    return leftCode < rightCode ? -1 : 1
  }
  return left.missionId - right.missionId
}

export const buildExpeditionOverlap = (
  input: ExpeditionOverlapInput,
): ExpeditionOverlap[] => {
  const currentMissions = new Set(
    (input.trackers[input.questId]?.tasks ?? [])
      .filter((task): task is Extract<QpTask, { kind: 'expedition' }> =>
        task.kind === 'expedition' && task.missionId !== 0)
      .map((task) => task.missionId),
  )
  if (!currentMissions.size) return []

  const unavailable = new Set<QuestAvailability>(['done', 'locked', 'claimable'])
  const rows: Array<ExpeditionOverlap & { code: string }> = []
  for (const quest of input.quests) {
    if (quest.id === input.questId) continue
    // 裁决合并了周期边界与前置链，所以筛选和标记不能直接使用 observed.state。
    const verdict = input.verdictOf(quest.id)
    if (verdict && unavailable.has(verdict)) continue
    const items = (input.trackers[quest.id]?.tasks ?? [])
      .filter((task): task is Extract<QpTask, { kind: 'expedition' }> =>
        task.kind === 'expedition' &&
        (task.missionId === 0 || currentMissions.has(task.missionId)))
      .map(({ missionId, count }) => ({ missionId, count }))
      .sort((left, right) => compareMission(left, right, input.missionCodeOf))
    if (items.length) {
      rows.push({
        questId: quest.id,
        code: quest.code,
        ...(verdict ? { status: verdict } : {}),
        items,
      })
    }
  }

  return rows
    .sort((left, right) => {
      const byMission = compareMission(left.items[0], right.items[0], input.missionCodeOf)
      if (byMission) return byMission
      return left.code < right.code ? -1 : left.code > right.code ? 1 : 0
    })
    .map(({ questId, status, items }) => ({
      questId,
      ...(status ? { status } : {}),
      items,
    }))
}
