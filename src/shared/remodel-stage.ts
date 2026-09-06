export type RemodelStage = 'first' | 'convert'

export interface RemodelHistory {
  hasEvents: boolean
  afterMstIds: number[]
}

// 主数据的直接互逆对之外，也保留加贺、夕张、宗谷的有向循环。
export const remodelCycles = (edges: [number, number][]): number[][] => {
  const next = new Map<number, number[]>()
  for (const [from, to] of edges) {
    if (from <= 0 || to <= 0 || from === to) continue
    next.set(from, [...(next.get(from) ?? []), to])
  }
  const reaches = (from: number, to: number): boolean => {
    const pending = [from], seen = new Set<number>()
    while (pending.length) {
      const id = pending.pop()!
      if (id === to) return true
      if (seen.has(id)) continue
      seen.add(id)
      pending.push(...(next.get(id) ?? []))
    }
    return false
  }
  const remaining = new Set([...next.keys()].sort((a, b) => a - b)), groups: number[][] = []
  for (const id of remaining) {
    const group = [...remaining].filter(other => reaches(id, other) && reaches(other, id))
    for (const member of group) remaining.delete(member)
    if (group.length > 1) groups.push(group)
  }
  return groups
}

export const remodelStagesFor = (
  convertible: boolean,
  targetId: number,
  history?: RemodelHistory,
): RemodelStage[] => {
  if (!convertible) return ['first']
  if (!history?.hasEvents) return ['first', 'convert']
  return [history.afterMstIds.includes(targetId) ? 'convert' : 'first']
}

export const REMODEL_STAGE_COPY: Record<RemodelStage, { label: string; tip: string }> = {
  first: { label: '初次', tip: '这艘舰第一次改装为此形态时的消耗。' },
  convert: { label: '往复', tip: '这艘舰曾改装为此形态，再次换装时的消耗。' },
}
