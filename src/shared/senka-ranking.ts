// 游戏排行路径中的混淆名由游戏决定，改版可能会变；只读取玩家已打开的页。
export const SENKA_RANKING_PATH = '/kcsapi/api_req_ranking/mxltvkpyuklh'
export const SENKA_RANK_FACTORS = [8931, 1201, 1156, 5061, 4569, 4732, 3779, 4568, 5695, 4619, 4912, 5669, 6586] as const

export const EQUIP_FULL_LIST_PATHS = [
  '/kcsapi/api_get_member/require_info',
  '/kcsapi/api_get_member/slot_item',
] as const

export const KNOWN_EQUIP_SOURCE_PATHS = [
  '/kcsapi/api_req_kousyou/createitem',
  '/kcsapi/api_req_kousyou/getship',
  '/kcsapi/api_req_quest/clearitemget',
  '/kcsapi/api_req_sortie/battleresult',
  '/kcsapi/api_req_combined_battle/battleresult',
  '/kcsapi/api_req_member/itemuse',
  '/kcsapi/api_req_member/payitemuse',
  '/kcsapi/api_req_member/get_event_selected_reward',
  '/kcsapi/api_req_kaisou/remodeling',
  '/kcsapi/api_req_kousyou/remodel_slot',
  // 另加改修恢复：本地装备变更处理会从 api_after_slot 写入恢复后的实例，来源可解释。
  '/kcsapi/api_req_kousyou/remodel_slot_recover',
] as const

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

export interface SenkaMonthHistory {
  monthStart: number
  own: { rank: number; senka: number; refreshAt: number } | null
  lines: Record<LineRank, { senka: number; refreshAt: number } | null>
  undecoded: number
}

export interface RankingRewardRow {
  ts: number
  item_id: number
  delta: number
  cause: string | null
}

export interface RankingRewardCandidate {
  kind?: 'item' | 'equip'
  itemId: number
  name: string
  level?: number
  count: number
  ts: number
}

export interface RankingRewardEquip {
  id: number
  mstId: number
  level: number
  firstTs: number
  source: string
  equipped: boolean
}

export interface PortLogMessage {
  type: number
  message: string
}

/** 滚动消息按多重集扣除旧条目，新增条目保留本次报文的顺序。 */
export const newPortLogMessages = (
  prev: readonly PortLogMessage[],
  next: readonly PortLogMessage[],
): PortLogMessage[] => {
  const remaining = new Map<string, number>()
  const keyOf = (entry: PortLogMessage) => JSON.stringify([entry.type, entry.message])
  for (const entry of prev) {
    const key = keyOf(entry)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  return next.filter(entry => {
    const key = keyOf(entry)
    const count = remaining.get(key) ?? 0
    if (!count) return true
    remaining.set(key, count - 1)
    return false
  })
}

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
  history?: (SenkaMonthHistory & { rewards: RankingRewardCandidate[] })[]
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

function* decodedRankingPages(
  pages: readonly RankingPage[],
  nickname: string,
  ownHintAt: (cutoff: number) => number | null,
) {
  let lastFactor: number | null = null
  for (const page of [...pages].sort((a, b) => a.ts - b.ts)) {
    const cutoff = rankingCutoffAt(page.ts)
    const decoded = decodeRankingPage(page.list, { nickname, ownHint: ownHintAt(cutoff), lastFactor })
    if (decoded) lastFactor = decoded.factor
    yield { page, cutoff, decoded }
  }
}

export const ownRankByDay = (
  pages: readonly RankingPage[],
  { nickname, ownHintAt }: { nickname: string; ownHintAt: (cutoff: number) => number | null },
): { day: string; rank: number; senka: number }[] => {
  const days = new Map<string, { rank: number; senka: number }>()
  for (const { page, decoded } of decodedRankingPages(pages, nickname, ownHintAt)) {
    if (!decoded?.own) continue
    const day = new Date(rankingRefreshAt(page.ts) + 9 * HOUR).toISOString().slice(0, 10)
    days.set(day, decoded.own)
  }
  return [...days].map(([day, own]) => ({ day, ...own }))
}

export const senkaMonthHistory = (
  pages: readonly RankingPage[],
  { nickname, ownHintAt, monthStartOf, before }: {
    nickname: string
    ownHintAt: (cutoff: number) => number | null
    monthStartOf: (ts: number) => number
    before: number
  },
): SenkaMonthHistory[] => {
  const months = new Map<number, SenkaMonthHistory>()
  for (const { page, cutoff, decoded } of decodedRankingPages(pages, nickname, ownHintAt)) {
    const monthStart = monthStartOf(cutoff)
    if (monthStart >= before) continue
    let month = months.get(monthStart)
    if (!month) {
      month = { monthStart, own: null, lines: { 5: null, 20: null, 100: null, 500: null }, undecoded: 0 }
      months.set(monthStart, month)
    }
    if (!decoded) {
      month.undecoded++
      continue
    }
    const refreshAt = rankingRefreshAt(page.ts)
    if (decoded.own) month.own = { ...decoded.own, refreshAt }
    for (const row of decoded.rows) {
      if (RANKS.includes(row.rank as LineRank)) month.lines[row.rank as LineRank] = { senka: row.senka, refreshAt }
    }
  }
  return [...months.values()].sort((a, b) => b.monthStart - a.monthStart)
}

export const rankingRewardCandidates = (
  rows: readonly RankingRewardRow[],
  { boundaries, monthStartOf, nameOf, equips = [], knownEquipEventTs = [], equipNameOf = String }: {
    boundaries: readonly number[]
    monthStartOf: (ts: number) => number
    nameOf: (itemId: number) => string
    equips?: readonly RankingRewardEquip[]
    knownEquipEventTs?: readonly number[]
    equipNameOf?: (mstId: number) => string
  },
): Record<number, RankingRewardCandidate[]> => {
  const months: Record<number, RankingRewardCandidate[]> = {}
  for (const [index, boundary] of boundaries.entries()) {
    // 次月中下旬也可能发奖；每个交界直到下一交界的候选仍归上一个战果月。
    const end = boundaries[index + 1] ?? Infinity
    const items = new Map<number, RankingRewardCandidate>()
    for (const row of rows) {
      if (row.ts < boundary || row.ts >= end || row.cause != null || row.delta <= 0) continue
      const item = items.get(row.item_id)
      if (item) {
        item.count += row.delta
        item.ts = Math.min(item.ts, row.ts)
      } else {
        items.set(row.item_id, { kind: 'item', itemId: row.item_id, name: nameOf(row.item_id), count: row.delta, ts: row.ts })
      }
    }
    const equipment = new Map<string, RankingRewardCandidate>()
    for (const row of equips) {
      if (row.firstTs < boundary || row.firstTs >= end || row.equipped ||
        !EQUIP_FULL_LIST_PATHS.some(path => path === row.source) ||
        knownEquipEventTs.some(ts => ts >= row.firstTs - 10 * 60_000 && ts <= row.firstTs)) continue
      const key = `${row.mstId}:${row.level}`
      const equip = equipment.get(key)
      if (equip) {
        equip.count++
        equip.ts = Math.min(equip.ts, row.firstTs)
      } else {
        equipment.set(key, {
          kind: 'equip', itemId: row.mstId, name: equipNameOf(row.mstId),
          level: row.level, count: 1, ts: row.firstTs,
        })
      }
    }
    const candidates = [...items.values(), ...equipment.values()]
    if (candidates.length) months[monthStartOf(boundary - 1)] = candidates.sort((a, b) => a.ts - b.ts)
  }
  return months
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
  const rows = new Map<number, SenkaRankingView['rows'][number]>()
  const snapshots: { ts: number; rows: RankingRow[] }[] = []
  for (const { page, cutoff, decoded } of decodedRankingPages(pages, nickname, ownHintAt)) {
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
