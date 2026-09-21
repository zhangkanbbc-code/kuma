// 战斗航迹的 Boss 点机制由维护者 2026-09-21 实机报出，账本 924 次
// `api_req_map/start` 出击核过：
// - 多血条图的 `api_bosscell_no` 永远只报第 1 血条 Boss 的入边。7-5 第 1～3
//   血条六次出击都是 11（H→K），7-2、活动图 62-1～62-5 也只报 P1 那条。
// - 真正随相位走的是 `api_cell_data`：`color === 5` 的边就是通往 Boss 点的边。
//   7-5 P1 的色 5 只有 11（K）；P2 是 11 与 19（O→Q）；P3 再加 24（P→T）。
// - 色 5 边按 fcd 终点字母去重保序后，单血条图恰好一个字母，多血条图第 N
//   血条对应第 N 个字母：7-2 [G]→[G,M]，7-5 [K]→[K,Q]→[K,Q,T]，
//   62-4 [D]→…→[D,N,S,X,Z]。62-5 P3 首次只揭到 [G,J2]，字母数少于
//   血条号时只能取最后一个。
// - 1-6 没有 Boss，色 5 集合为空，而 `api_bosscell_no` 报 1。

export type SortieBossRoute = Record<string, [string | null, string]>

export const bossLettersOf = (
  cellData: readonly { no: number; color: number }[],
  route: SortieBossRoute,
): string[] => {
  const letters: string[] = []
  for (const cell of [...cellData].sort((left, right) => left.no - right.no)) {
    if (cell.color !== 5) continue
    const letter = route[String(cell.no)]?.[1]
    if (letter && !letters.includes(letter)) letters.push(letter)
  }
  return letters
}

export const reachableSpots = (route: SortieBossRoute, from: string): Set<string> => {
  const reached = new Set<string>([from])
  const queue = [from]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const [start, end] of Object.values(route)) {
      if (start !== current || reached.has(end)) continue
      reached.add(end)
      queue.push(end)
    }
  }
  reached.delete(from)
  return reached
}

export const sortieBossTarget = ({
  bossLetters,
  gaugeNum,
  reachable,
}: {
  bossLetters: readonly string[]
  gaugeNum: number | null
  reachable: ReadonlySet<string> | null
}): string | null => {
  if (bossLetters.length === 0) return null
  const index = Math.max(0, Math.min((gaugeNum ?? 1) - 1, bossLetters.length - 1))
  const candidate = bossLetters[index]
  if (reachable === null || reachable.has(candidate)) return candidate
  for (let fallback = bossLetters.length - 1; fallback >= 0; fallback -= 1) {
    if (reachable.has(bossLetters[fallback])) return bossLetters[fallback]
  }
  return null
}
