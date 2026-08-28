// 首见志的纯判定层：从遭遇记录折出「每艘舰最早的一次掉落 / 击沉」。
//
// 主进程建索引、渲染层判定徽章都走这里，两边不会各算一套口径。
//
// 诚实边界（这个功能最容易骗人的地方就在这）：
// - 「首次」只指**本地遭遇志内的第一次**。账本开始之前的获得与击沉无从得知，
//   所以索引一并给出起点，消费端必须把这个边界说出来。
// - sunk_mask 是后加的列。老记录为 null 表示「这一场谁沉了不可知」，
//   绝不能当成「一艘都没沉」——否则首杀会被错记到后面某一场，凭空造出一个假里程碑。
import type { FirstEncounterIndex, FirstEncounterRecord } from './mg-types'

export interface EncounterFold {
  ts: number
  map: number
  cell: number
  isBoss: boolean
  comp: number[]
  dropMst: number | null
  sunkMask: number | null
}

export const emptyFirstEncounterIndex = (): FirstEncounterIndex => ({
  drops: {},
  kills: {},
  dropsFrom: null,
  killsFrom: null,
  metSince: {},
})

/** 把一条遭遇记录并入索引。可乱序调用——始终只留时间最早的那条。 */
export const foldFirstEncounter = (
  index: FirstEncounterIndex,
  entry: EncounterFold,
): void => {
  const { ts } = entry
  if (!Number.isFinite(ts)) return
  const at = { ts, map: entry.map, cell: entry.cell, isBoss: entry.isBoss }
  const earlier = (seen: FirstEncounterRecord | undefined) => !seen || ts < seen.ts
  index.dropsFrom = index.dropsFrom == null ? ts : Math.min(index.dropsFrom, ts)

  const dropMst = Number(entry.dropMst ?? 0)
  if (dropMst > 0 && earlier(index.drops[dropMst])) {
    index.drops[dropMst] = { mstId: dropMst, ...at }
  }

  // 遭遇本身与掩码无关：这一场谁沉了可以不知道，但「见过它」是确定的。
  // 首杀能不能算数要靠它——若在掩码上线前就遇到过，那之前很可能已经沉过了。
  entry.comp.forEach((mstId) => {
    if (!Number.isFinite(mstId) || mstId <= 0) return
    const seen = index.metSince[mstId]
    if (seen == null || ts < seen) index.metSince[mstId] = ts
  })

  // 击沉不可知的老场次整场跳过，也不推进 killsFrom——那条起点代表的是
  // 「从这一刻起逐舰击沉才是可信的」。
  const mask = entry.sunkMask
  if (mask == null || !Number.isFinite(mask)) return
  index.killsFrom = index.killsFrom == null ? ts : Math.min(index.killsFrom, ts)
  entry.comp.forEach((mstId, i) => {
    if (i > 30 || !(mask & (1 << i))) return
    if (!Number.isFinite(mstId) || mstId <= 0) return
    if (earlier(index.kills[mstId])) index.kills[mstId] = { mstId, ...at }
  })
}

export const buildFirstEncounterIndex = (
  entries: Iterable<EncounterFold>,
): FirstEncounterIndex => {
  const index = emptyFirstEncounterIndex()
  for (const entry of entries) foldFirstEncounter(index, entry)
  return index
}

/**
 * 出击现场没有逐条时间戳，用「地点 + 本轮起始时刻」界定眼前这一条是不是首见：
 * 首见记录落在本轮出击开始之后、且就在这个点位。
 */
export const isFirstEncounterHere = (
  record: FirstEncounterRecord | null | undefined,
  map: number,
  cell: number,
  sinceTs: number,
): boolean => !!record && record.map === map && record.cell === cell && record.ts >= sinceTs

/**
 * 这条击沉能不能当成「你第一次击沉它」。
 *
 * 逐舰击沉是 sunk_mask 上线后才有的。若在那之前就遭遇过这艘深海舰，
 * 那些场次谁沉了不可知——很可能早就沉过了，于是这条「最早」不作数。
 */
export const isTrustedFirstKill = (
  index: FirstEncounterIndex,
  record: FirstEncounterRecord,
): boolean => {
  if (index.killsFrom == null) return false
  const met = index.metSince[record.mstId]
  return met == null || met >= index.killsFrom
}
