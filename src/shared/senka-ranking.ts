// 游戏排行路径中的混淆名由游戏决定，改版可能会变；只读取玩家已打开的页。
export const SENKA_RANKING_PATH = '/kcsapi/api_req_ranking/mxltvkpyuklh'
export const SENKA_RANK_FACTORS = [8931, 1201, 1156, 5061, 4569, 4732, 3779, 4568, 5695, 4619, 4912, 5669, 6586] as const

const HOUR = 3600_000
const RANKS = [5, 20, 100, 500] as const
type LineRank = typeof RANKS[number]

export interface RankingServer {
  num: number
  name: string
  host: string
}

export interface RankingRowData {
  api_mxltvkpyuklh: number
  api_mtjmdcwtvhdr: string
  api_wuhnhojjxmke: number
}

export interface RankingPage {
  ts: number
  list: RankingRowData[]
  server: RankingServer | null
}

interface RankingRow {
  rank: number
  nickname: string
  senka: number
}

type SenkaLines = Record<LineRank, { day: string; senka: number }[]>

/** 只在相邻真实点之间按 JST 日历日插值；真实点原样保留，首尾不外推。 */
export const fillLineGaps = (
  points: readonly { day: string; senka: number }[],
): { day: string; senka: number; estimated?: true }[] => {
  const filled: { day: string; senka: number; estimated?: true }[] = []
  const dayMs = 24 * HOUR
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    if (i > 0) {
      const previous = points[i - 1]
      const from = Date.parse(`${previous.day}T00:00:00+09:00`)
      const to = Date.parse(`${point.day}T00:00:00+09:00`)
      for (let ts = from + dayMs; ts < to; ts += dayMs) {
        filled.push({
          day: new Date(ts + 9 * HOUR).toISOString().slice(0, 10),
          senka: Math.round(previous.senka + (point.senka - previous.senka) * (ts - from) / (to - from)),
          estimated: true,
        })
      }
    }
    filled.push(point)
  }
  return filled
}

export interface SenkaRankingView {
  refreshAt: number | null
  rows: (RankingRow & { own: boolean })[]
  lines: SenkaLines
  undecoded: number
  ownCalibration: { value: number; ts: number } | null
  /** 本月最后解出的本人名次，不随列表切换刷新而丢失。 */
  ownRank: number | null
  server: RankingServer | null
  serverInferred: boolean
}

/** 不晚于观测时刻的 03:00 / 15:00 JST 刷新。 */
export const rankingRefreshAt = (ts: number): number =>
  Math.floor((ts + 6 * HOUR) / (12 * HOUR)) * 12 * HOUR - 6 * HOUR

// 排行统计截止比刷新早一小时（02:00 / 14:00 JST）。
export const rankingCutoffAt = (ts: number): number => rankingRefreshAt(ts) - HOUR

export const decodeRankingPage = (
  list: readonly RankingRowData[],
  { nickname, ownHint, lastFactor }: {
    nickname: string
    ownHint: number | null
    lastFactor: number | null
  },
): { factor: number; rows: RankingRow[]; own: { rank: number; senka: number } | null } | null => {
  if (!list.length) return null
  const quotients = list.map(row => row.api_wuhnhojjxmke / SENKA_RANK_FACTORS[row.api_mxltvkpyuklh % 13])
  if (quotients.some(value => !Number.isInteger(value))) return null
  const candidates = Array.from({ length: 90 }, (_, i) => i + 10)
    .filter(factor => quotients.every(value => value % factor === 0))
  const ownIndex = list.findIndex(row => row.api_mtjmdcwtvhdr === nickname)
  const close = (factor: number) => ownHint == null ||
    Math.abs(quotients[ownIndex] / factor - 91 - ownHint) <= Math.max(60, ownHint * 0.1)
  let factor: number | null = null
  if (lastFactor != null && candidates.includes(lastFactor) && (ownIndex < 0 || close(lastFactor))) {
    factor = lastFactor
  } else if (ownIndex >= 0 && ownHint != null) {
    const near = candidates.filter(close)
    if (near.length === 1) factor = near[0]
  }
  if (factor == null && candidates.length === 1) factor = candidates[0]
  if (factor == null) return null
  const rows = list.map((row, i) => ({
    rank: row.api_mxltvkpyuklh,
    nickname: row.api_mtjmdcwtvhdr,
    senka: quotients[i] / factor - 91,
  }))
  const own = ownIndex < 0 ? null : { rank: rows[ownIndex].rank, senka: rows[ownIndex].senka }
  return { factor, rows, own }
}

export const senkaLineSeries = (
  snapshots: readonly { ts: number; rows: readonly { rank: number; senka: number }[] }[],
): SenkaLines => {
  const days = { 5: new Map<string, number>(), 20: new Map<string, number>(), 100: new Map<string, number>(), 500: new Map<string, number>() }
  for (const snapshot of [...snapshots].sort((a, b) => a.ts - b.ts)) {
    const day = new Date(rankingRefreshAt(snapshot.ts) + 9 * HOUR).toISOString().slice(0, 10)
    for (const row of snapshot.rows) {
      if (RANKS.includes(row.rank as LineRank)) days[row.rank as LineRank].set(day, row.senka)
    }
  }
  const lines: SenkaLines = { 5: [], 20: [], 100: [], 500: [] }
  for (const rank of RANKS) lines[rank] = [...days[rank]].map(([day, senka]) => ({ day, senka }))
  return lines
}

export const assembleSenkaRanking = (
  pages: readonly RankingPage[],
  { nickname, monthStart, monthEnd, fallbackServer, ownHintAt }: {
    nickname: string
    monthStart: number
    monthEnd: number
    fallbackServer: RankingServer | null
    ownHintAt: (cutoff: number) => number | null
  },
): SenkaRankingView => {
  const view: SenkaRankingView = {
    refreshAt: null, rows: [], lines: { 5: [], 20: [], 100: [], 500: [] },
    undecoded: 0, ownCalibration: null, ownRank: null, server: null, serverInferred: false,
  }
  let lastFactor: number | null = null
  const rows = new Map<number, SenkaRankingView['rows'][number]>()
  const snapshots: { ts: number; rows: RankingRow[] }[] = []
  for (const page of pages) {
    const cutoff = rankingCutoffAt(page.ts)
    const decoded = decodeRankingPage(page.list, { nickname, ownHint: ownHintAt(cutoff), lastFactor })
    if (decoded) lastFactor = decoded.factor
    // 上月的页只传递系数，本月列表、曲线和校准都按统计截止归月。
    if (cutoff < monthStart || cutoff >= monthEnd) continue
    const refreshAt = rankingRefreshAt(page.ts)
    if (view.refreshAt !== refreshAt) rows.clear()
    view.refreshAt = refreshAt
    view.server = page.server ?? fallbackServer
    view.serverInferred = page.server == null && fallbackServer != null
    if (!decoded) {
      view.undecoded++
      continue
    }
    for (const row of decoded.rows) rows.set(row.rank, { ...row, own: row.nickname === nickname })
    snapshots.push({ ts: page.ts, rows: decoded.rows })
    if (decoded.own) {
      view.ownCalibration = { value: decoded.own.senka, ts: cutoff }
      view.ownRank = decoded.own.rank
    }
  }
  view.rows = [...rows.values()].sort((a, b) => a.rank - b.rank)
  view.lines = senkaLineSeries(snapshots)
  return view
}
