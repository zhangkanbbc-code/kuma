import type { Quest } from '../../shared/mg-types'

export interface QuestStateUpdate {
  quests: Record<number, Quest>
  activeIds: number[] | null
  execCount: number | null
}

const toQuest = (raw: any): Quest => ({
  no: raw.api_no,
  category: raw.api_category ?? 0,
  type: raw.api_type ?? 0,
  state: raw.api_state ?? 1,
  title: raw.api_title ?? '',
  detail: raw.api_detail ?? '',
  getMaterial: Array.isArray(raw.api_get_material)
    ? raw.api_get_material.slice(0, 4).map((value: unknown) => Number(value) || 0)
    : undefined,
  bonusFlag: raw.api_bonus_flag ?? 0,
  progressFlag: raw.api_progress_flag ?? 0,
})

export const reduceQuestList = (
  current: Record<number, Quest>,
  currentActiveIds: number[] | null,
  body: any,
  post: Record<string, string>,
): QuestStateUpdate | null => {
  if (!Array.isArray(body?.api_list)) return null
  const incoming: Record<number, Quest> = {}
  for (const raw of body.api_list) {
    if (!raw || typeof raw !== 'object' || Number(raw.api_no) <= 0) continue
    const quest = toQuest(raw)
    incoming[quest.no] = quest
  }
  const tabId = parseInt(`${post.api_tab_id ?? -1}`, 10)
  const listedActive = Object.values(incoming)
    .filter((quest) => quest.state === 2)
    .map((quest) => quest.no)
  let quests = { ...current }
  let activeIds = currentActiveIds ? [...currentActiveIds] : null

  if (tabId === 0) {
    quests = incoming
    activeIds = listedActive
  } else if (tabId === 9) {
    const active = new Set(listedActive)
    for (const quest of Object.values(quests)) {
      if (quest.state === 2 && !active.has(quest.no)) quest.state = 1
    }
    Object.assign(quests, incoming)
    activeIds = listedActive
  } else {
    Object.assign(quests, incoming)
    if (activeIds) {
      const active = new Set(activeIds)
      for (const quest of Object.values(incoming)) {
        if (quest.state === 2) active.add(quest.no)
        else active.delete(quest.no)
      }
      activeIds = [...active]
    }
  }
  const execCount =
    typeof body.api_exec_count === 'number'
      ? body.api_exec_count
      : activeIds?.length ?? null
  return { quests, activeIds, execCount }
}
