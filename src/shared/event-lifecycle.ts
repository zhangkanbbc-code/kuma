export interface EventLifecycle {
  name: string
  from: string
  until: string | null
  status: 'active' | 'ended'
  phaseOpenedAt: string
}

interface EventLifecycleEntry {
  mapAreaId: number
  name: string
  from: string
  until: string | null
  status: 'active' | 'ended'
  phases: { openedAt: string; maps: number[] }[]
}

interface EventLifecyclePack {
  events: EventLifecycleEntry[]
}

/** 欢迎屏作战灯沿用登记的分段；没有登记时保留一条连续航线。 */
export const eventPhasesOf = (pack: unknown, mapAreaId: number): EventLifecycleEntry['phases'] =>
  (pack as EventLifecyclePack | null)?.events.find((entry) => entry.mapAreaId === mapAreaId)?.phases ?? []

export const eventLifecycleOf = (
  pack: unknown,
  mapAreaId: number,
): EventLifecycle | null => {
  if (!pack) return null
  const event = (pack as EventLifecyclePack).events.find(
    (entry) => entry.mapAreaId === mapAreaId,
  )
  if (!event) return null
  const phaseOpenedAt = event.phases.reduce((earliest, phase) =>
    Date.parse(phase.openedAt) < Date.parse(earliest.openedAt) ? phase : earliest,
  ).openedAt
  return {
    name: event.name,
    from: event.from,
    until: event.until,
    status: event.status,
    phaseOpenedAt,
  }
}
