export type ExpeditionRowState = 'done' | 'locked' | null
export type ExpeditionGlow = 'collect' | 'unfit' | 'running' | null

export const decksOnExpedition = (
  decks: ReadonlyArray<{ id: number; mission: number[] }>,
  missionId: number,
): Array<{ deckId: number; state: number; returnTs: number }> =>
  decks
    .filter(
      (deck) =>
        deck.mission[0] > 0 && (missionId === 0 || deck.mission[1] === missionId),
    )
    .map((deck) => ({
      deckId: deck.id,
      state: deck.mission[0],
      returnTs: deck.mission[2],
    }))
    .sort((a, b) => a.deckId - b.deckId)

export const expeditionGlow = (input: {
  missionState: number | undefined
  returnTs: number | null
  now: number
  fails: number
}): ExpeditionGlow => {
  // 可收取必须压过编成不符与执行中：返港态或倒计时已到时，这条远征当前要做的是收取。
  // fails 只由调用方统计 mark='no'；大成功与无法自动判定都是 wait，天然不进入红光。
  if (
    input.missionState === 2 ||
    (input.missionState === 1 && input.returnTs != null && input.now >= input.returnTs)
  ) {
    return 'collect'
  }
  if (input.missionState === 1 && input.fails > 0) return 'unfit'
  if (input.missionState === 1) return 'running'
  return null
}

export const expeditionRowState = (input: {
  resetType: number
  observed: boolean
  state: number | undefined
  limitTs: number | null
  now: number
}): ExpeditionRowState => {
  if (!input.observed) return null
  if (input.state === 0 || input.state === undefined) return 'locked'
  if (
    input.resetType === 1 &&
    input.state === 2 &&
    (input.limitTs == null || input.now < input.limitTs)
  ) {
    return 'done'
  }
  return null
}

export const expeditionResetLabel = (limitTs: number | null, now: number): string => {
  if (limitTs == null || now >= limitTs) return ''
  const date = new Date(limitTs)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `至 ${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())} 重置`
}
