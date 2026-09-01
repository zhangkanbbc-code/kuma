// 史 · 回顾：把分散在资源、战斗、活动和图鉴里的历史数据汇成一个时间视角。
// 所有数据都来自本地账本；详情仍跳回各自的权威页面，避免复制判定与资料口径。
import type {
  BattleSnapshot,
  BattleSnapshotSummary,
  FactoryRecipeStats,
  FactoryStatsReport,
  NodeHistoryIndexEntry,
  NodeHistoryReport,
  UseitemHistoryChange,
} from '../../shared/mg-types'

import type { PayLogRow } from '../../shared/pay-log'

import {
  addManualPayLog,
  esc,
  fmtTime,
  jstHourOf,
  mg,
  commitPaneHtml,
  deferWhileComposing,
  deferWhilePressed,
  forgetCommittedHtml,
  onMgChange,
  openResourceTrendWindow,
  queryActionEvents,
  queryBattleSnapshot,
  queryBattleSnapshots,
  queryEventArchives,
  queryFactoryStats,
  queryLode,
  queryMasterRaw,
  queryDailyMaterialHistory,
  queryNodeHistory,
  queryNodeHistoryIndex,
  queryPayLog,
  queryRecentUseitemChanges,
  queryUseitemSummary,
  removeManualPayLog,
  uiGet,
  uiSet,
  fmtDate,
  fmtDateTime,
} from '../kernel'
import { MATERIAL_ICON_BY_INDEX, materialIconHtml, shipThumbHtml, useItemIconHtml } from '../entity-art'
import { equipTypeIconHtml } from '../equip-icon'
import {
  ensureFirstEncounters,
  firstDropBadgeHtml,
  firstDropOf,
  firstKillBadgeHtml,
  onFirstEncountersChange,
} from '../first-encounter'
import { elink, elinkHtml } from '../link'
import { entityNamePlain, entityTermHtml } from '../localization'
import { registerModule } from '../mu'
import { unownedShipBadgeHtml } from '../ship-ownership'
import { fmtJstDate, jstDayStart } from '../../shared/jst-day'
import { localDayStart } from '../../shared/local-calendar'
import { dropFurnitureBoxes, isFurnitureBoxId } from '../../shared/furniture-box'
import { buildDailyMaterials, type DailyMaterial } from '../../shared/material-history'
import { mapAreaOf, mapCodeOf } from '../../shared/map-id'
import { PERSONAL_RATE_MIN_SAMPLES } from '../../shared/statistics'
import {
  handleBattleReplayDetailClick,
  renderBattleReplayDetail,
} from './di'

type ReviewView = 'overview' | 'resources' | 'factory' | 'practice' | 'nodes' | 'events' | 'items'

interface UseitemSummary {
  id: number
  gained: number
  spent: number
  changes: number
  lastTs: number
}

interface ActionEvent {
  ts: number
  path: string
  postBody: string | null
}

interface EventArchive {
  areaId: number
  areaName: string | null
  opened: number
  closed: number
  maps: { api_id?: number; api_no?: number }[]
  stats: {
    sorties?: number
    battles?: number
    bosses?: number
    killed?: number
    drops?: { mstId?: number; n?: number }[]
    resNet?: number[] | null
    useitems?: { id: number; gained: number; spent: number }[]
    resCoversFullWindow?: boolean
  }
}

const RESOURCE_META = [
  { label: '燃料', color: 'var(--r-fuel)' },
  { label: '弹药', color: 'var(--r-ammo)' },
  { label: '钢材', color: 'var(--r-steel)' },
  { label: '铝土', color: 'var(--r-baux)' },
  { label: '高速建造材', color: 'var(--r-build)' },
  { label: '高速修复材', color: 'var(--r-repair)' },
  { label: '开发资材', color: 'var(--r-dev)' },
  { label: '改修资材', color: 'var(--r-screw)' },
]
const VIEW_META: { id: ReviewView; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'resources', label: '资源' },
  { id: 'factory', label: '工厂' },
  { id: 'practice', label: '演习' },
  { id: 'nodes', label: '节点' },
  { id: 'events', label: '活动' },
  { id: 'items', label: '道具' },
]
// 0 = 全部（从账本最早一条起）。2026-08-23 放开到这几档：账本不再自动清理，
// 数据能攒好几年，而逐日聚合已经下沉到 SQL（一年 366 行），拉长区间不再堵主进程。
const RANGE_OPTIONS = [7, 30, 90, 180, 365, 0]
const rangeLabelOf = (days: number) => (days ? `${days}日` : '全部')
const clampRangeDays = (days: unknown) => {
  const value = Number(days)
  return RANGE_OPTIONS.includes(value) ? value : 30
}
const DAY_MS = 24 * 3600 * 1000
const CAUSE_WINDOW_MS = 120000
const WIN_RANKS = new Set(['S', 'A', 'B'])
const FORMATION: Record<number, string> = {
  1: '单纵阵',
  2: '复纵阵',
  3: '轮形阵',
  4: '梯形阵',
  5: '单横阵',
  6: '警戒阵',
  11: '第一警戒航行序列',
  12: '第二警戒航行序列',
  13: '第三警戒航行序列',
  14: '第四警戒航行序列',
}

let pane: HTMLElement
let activeView = uiGet<ReviewView>('shi.view', 'overview')
let rangeDays = clampRangeDays(uiGet<number>('shi.rangeDays', 30))
let selectedResource = Math.max(0, Math.min(7, uiGet<number>('shi.resource', 0)))
let dailyMaterials: DailyMaterial[] = []
let battles: BattleSnapshotSummary[] = []
let nodeIndex: NodeHistoryIndexEntry[] = []
let selectedNode: { map: number; cell: number } | null = null
let selectedNodeReport: NodeHistoryReport | null = null
let nodeLoadingKey = ''
let nodeLoadFailed = false // 读失败要说读失败，不能渲染成「该点没有可读取的记录」；原文只进 console
let eventArchives: EventArchive[] = []
let factoryStats: FactoryStatsReport | null = null
let factoryKind: 'ship' | 'item' = 'ship'
// 工厂实测的两层展开态。跟击杀簿的 expandedBosses 一个道理：状态活在渲染之外，
// mg 补丁随时把整页重建一遍，记在 DOM 上的话摊开的那几行会自己合上。
const factoryOpenRecipes = new Set<string>() // 结果超 8 种的那些配方，键见 factoryRecipeKey
const factoryOpenLists = new Set<'ship' | 'item'>() // 配方行超 12 条的那一档，建造/开发各记各的
let useitemSummary: UseitemSummary[] = []
// 本机氪金记录（2026-08-19 用户定名）：永久表行 + 补记表单状态。
// 表单值存模块变量：mg 补丁随时会触发重渲染，不存就会丢玩家输入到一半的内容。
let payLog: PayLogRow[] = []
let payitemCatalog: { id: number; name: string; price: number | null }[] = []
let payFormOpen = false
let payForm: { itemId: number; count: number; date: string } = { itemId: 0, count: 1, date: '' }
let payDelArmId = 0 // 两段式删除：第一次点武装，第二次点才真删
let payFormError = '' // 补记被主进程退回时的原因；不清空表单，让玩家改了再提交
let payDelError = '' // 删除补记没成功时的原因（自动行不可删 / 行已不在）
let useitemIdByName = new Map<string, number>() // 课金道具按名字反查 useitem id 配图标
let itemChanges: UseitemHistoryChange[] = []
let actionEvents: ActionEvent[] = []
let actionEarliest: number | null = null
// 操作事件账本只有「道具」视图的原因栏读得到，量却是全部查询里最大的一份
// （全量，一年下来 ~15 万行 / 20 MB，还要跨进程序列化一遍）。
// 所以懒拉：切到该视图时拉一次，此后随 refresh 一起更新；没拉过就别声称「没找到原因」。
let actionEventsLoaded = false
let useitemNames = new Map<number, string>()
let shipNames = new Map<number, string>()
let mapAreaNames = new Map<number, string>()
let selectedItemId = Math.max(0, uiGet<number>('shi.itemId', 0))
// 家具箱一天能进十几个，会把真正稀有的道具挤出流水。默认关＝现状不变。
let hideFurnitureBox = uiGet<boolean>('shi.hideFurnitureBox', false) === true
let loading = true
let loadFailed = false // 同上：面板只说「读取失败」，异常原文进 console
let lastRefresh = 0
let refreshGeneration = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshPending = false // 不可见期间攒下的变更，onShow 时一次补
let enterNextView = false
let selectedBattle: BattleSnapshot | null = null
let selectedBattleLoadingId = 0
let battleLoadGeneration = 0
let selectedBattleError = ''
let selectedPracticeDay: number | null = null
let selectedPracticeSession: 'morning' | 'evening' | null = null
let selectedResourceDay: number | null = null
let selectedNodeMap: number | null = null
// 海图卡此刻画的是哪张图。不能从 DOM 上读 data-shi-map：缺 fcd 资料时的回退卡
// 一个节点都没有，读出来恒 0，于是「换一张图」的局部补丁永远不触发，卡片卡在上一张。
let shownMapCard = 0
let fcdMapData: any = null
// 五张主数据派生表按 masterRaw 的对象身份缓存：kernel 那份是模块级缓存，
// start2 更新才换新对象，没换就不必把 ~1600 项再 filter/map 一遍。
let masterDerivedFrom: unknown = null

// 资源等「我这台机器上的一天」的账走本地自然日（shared/local-calendar 的
// localDayStart，主进程的逐日聚合与这里是同一把尺）；演习那一套走 JST 日
// （shared/jst-day.ts），两者别互相顶替——见那两个文件开头的分工说明。
//
// 「rangeDays-1 天前的本地 0:00」按日历日往回数，不按固定 24h 乘：
// 夏令时的那一天只有 23 或 25 小时，乘出来的起点会落在 23:00/01:00，
// 此后每个「日」的分界都跟着歪一小时（本机无 DST，换个时区就会咬人）。
// rangeDays = 0（全部）没有固定起点，起点由账本最早一条定，见 refresh。
const rangeStart = (now = Date.now()) => {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (rangeDays - 1))
  return date.getTime()
}
// 与镝/铃同一口径：演习 03:00 / 15:00 JST 刷新，03–15 为早场，其余为晚场。
const practiceSessionOf = (ts: number): 'morning' | 'evening' => {
  const hour = jstHourOf(ts)
  return hour >= 3 && hour < 15 ? 'morning' : 'evening'
}
// 图表刻度专用的 M/D 超短格式——宽度所限，是 kernel fmtMonthDay 口径的唯一豁免
const fmtShortDay = (ts: number) => {
  const date = new Date(ts)
  return `${date.getMonth() + 1}/${date.getDate()}`
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString()}`
const groupByDay = <T extends { ts: number }>(
  rows: readonly T[],
  dayStart: (ts: number) => number = localDayStart,
) => {
  const groups: { day: number; rows: T[] }[] = []
  for (const row of rows) {
    const day = dayStart(row.ts)
    const last = groups.at(-1)
    if (last && last.day === day) last.rows.push(row)
    else groups.push({ day, rows: [row] })
  }
  return groups
}
/**
 * 日轴。两个值绑定的是**同一个坐标系**，不是两个独立开关：
 *   · `local` —— 出击快照列，按本机自然日切，不分场次；
 *   · `jstSession` —— 演习列，按 **JST 自然日**切并拆早/晚场。场次本来就是
 *     JST 定义的（03:00/15:00 刷新），日卡再按本地日切就会在本地午夜把
 *     一个场次劈成两张卡（本机 UTC+8：JST 日界在本地 23:00）。
 */
type HistoryDayAxis = 'local' | 'jstSession'
const battleHistoryHtml = (
  rows: readonly BattleSnapshotSummary[],
  titleOf: (row: BattleSnapshotSummary) => string,
  axis: HistoryDayAxis = 'local',
): string => {
  const jst = axis === 'jstSession'
  const groups = groupByDay(rows, jst ? jstDayStart : localDayStart)
  if (!groups.length) return ''
  const rowsHtml = (list: readonly BattleSnapshotSummary[]) =>
    list
      .map(
        (row) => `<div class="shi-history-row">
          <time>${fmtTime(row.ts)}</time>
          ${elink('battle', row.id, titleOf(row), 'shi')}
          <span class="shi-rank ${WIN_RANKS.has(row.rank ?? '') ? 'win' : 'loss'}">${esc(row.rank ?? '—')}</span>
        </div>`,
      )
      .join('')
  return groups
    .map((group) => {
      const body = jst
        ? (
            [
              ['morning', '早场'] as const,
              ['evening', '晚场'] as const,
            ]
              .map(([session, label]) => {
                const list = group.rows.filter((row) => practiceSessionOf(row.ts) === session)
                return list.length ? `<h5>${label} · ${list.length} 场</h5>${rowsHtml(list)}` : ''
              })
              .join('')
          )
        : rowsHtml(group.rows)
      return `<div class="shi-history-day">
        <h4>${jst ? fmtJstDate(group.day) : fmtDate(group.day)} · ${group.rows.length} 场</h4>
        ${body}
      </div>`
    })
    .join('')
}
const mapAreaLabel = (area: number) =>
  entityNamePlain('mapArea', area, mapAreaNames.get(area) ?? `海域区 ${area}`)
const letterOf = (map: number, cell: number): string =>
  fcdMapData?.[mapCodeOf(map)]?.route?.[`${cell}`]?.[1] ?? `#${cell}`
const cellsOfLetter = (map: number, letter: string): number[] => {
  const route = fcdMapData?.[mapCodeOf(map)]?.route
  if (!route) return []
  return Object.entries(route)
    .filter(([, pair]) => Array.isArray(pair) && pair[1] === letter)
    .map(([id]) => Number(id))
    .filter((id) => Number.isFinite(id))
}
const pickCellForSpot = (map: number, letter: string): number | null => {
  const cells = cellsOfLetter(map, letter)
  const indexed = nodeIndex.filter(
    (node) => node.map === map && (cells.includes(node.cell) || letterOf(node.map, node.cell) === letter),
  )
  if (indexed.length) {
    indexed.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
    return indexed[0].cell
  }
  return cells[0] ?? null
}
const nodeMapSvgHtml = (map: number): string => {
  const code = mapCodeOf(map)
  const fcd = fcdMapData?.[code]
  if (!fcd?.spots || !fcd?.route) {
    return `<div class="shi-mapgraph-card"><div class="shi-chart-title"><b>海图 ${esc(code)}</b><span>海图资料尚未就绪</span></div></div>`
  }
  const spots: Record<string, [number, number, string]> = fcd.spots
  const route: Record<string, [string | null, string]> = fcd.route
  const here = nodeIndex.filter((node) => node.map === map)
  const battlesAt = new Map<string, number>()
  const bossLetters = new Set<string>()
  for (const node of here) {
    const letter = letterOf(node.map, node.cell)
    battlesAt.set(letter, (battlesAt.get(letter) ?? 0) + node.count)
    if (node.bosses) bossLetters.add(letter)
  }
  const selectedLetter =
    selectedNode?.map === map ? letterOf(selectedNode.map, selectedNode.cell) : ''
  const xs = Object.values(spots).map((spot) => spot[0])
  const ys = Object.values(spots).map((spot) => spot[1])
  const PAD = 34
  const [x0, y0] = [Math.min(...xs) - PAD, Math.min(...ys) - PAD]
  const [w, h] = [Math.max(...xs) - Math.min(...xs) + PAD * 2, Math.max(...ys) - Math.min(...ys) + PAD * 2]
  const S = Math.max(w / 620, h / 280, 1)
  const R = 12 * S
  const FS = 11 * S
  const foughtEdges = new Set<string>()
  for (const node of here) {
    const path = route[`${node.cell}`]
    if (path?.[0] && path[1]) foughtEdges.add(`${path[0]}→${path[1]}`)
  }
  const seen = new Set<string>()
  const edges = Object.values(route)
    .filter((pair) => pair[0] && spots[pair[0]] && spots[pair[1]])
    .map((pair) => {
      const key = `${pair[0]}→${pair[1]}`
      if (seen.has(key)) return ''
      seen.add(key)
      const [ax, ay] = spots[pair[0]!]
      const [bx, by] = spots[pair[1]]
      const fought = foughtEdges.has(key)
      return `<line class="mg-e${fought ? ' on' : ''}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke-width="${(
        (fought ? 2.4 : 1.2) * S
      ).toFixed(1)}"></line>`
    })
    .join('')
  const nodes = Object.entries(spots)
    .map(([letter, [x, y, type]]) => {
      const battles = battlesAt.get(letter) ?? 0
      const isStart = type === 'start'
      const isBoss = bossLetters.has(letter)
      const openable = pickCellForSpot(map, letter) != null
      const on = selectedLetter === letter
      const cls = [
        'shi-spot',
        isStart ? 'start' : '',
        isBoss ? 'boss' : '',
        battles ? 'fought' : '',
        on ? 'on' : '',
        openable ? 'openable' : '',
      ]
        .filter(Boolean)
        .join(' ')
      const tip = [
        isStart ? '出击起点' : battles ? `你在此打过 ${battles} 战` : '尚无本地战斗记录',
        isBoss ? 'Boss 点' : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const radius = isBoss ? R * 1.25 : R
      return `<g class="${cls}" data-shi-map="${map}" data-shi-spot="${esc(letter)}">
        <circle cx="${x}" cy="${y}" r="${radius.toFixed(1)}" stroke-width="${((on ? 2.8 : isBoss ? 2.2 : 1.5) * S).toFixed(1)}"/>
        <text x="${x}" y="${(y + FS * 0.35).toFixed(1)}" text-anchor="middle" font-size="${FS.toFixed(1)}">${esc(letter)}</text>
        <title>${esc(letter)} · ${esc(tip)}</title>
      </g>`
    })
    .join('')
  const caption =
    selectedNodeMap == null && selectedNode?.map !== map ? '最近有记录的图' : ''
  return `<div class="shi-mapgraph-card">
    <div class="shi-chart-title"><b>海图 ${esc(code)}</b><span>${caption}</span></div>
    <div class="shi-mapgraph-frame"><svg class="shi-mapgraph" viewBox="${x0} ${y0} ${w} ${h}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">${edges}${nodes}</svg></div>
  </div>`
}
const officialRate = (value: number | null): string =>
  value == null
    ? '—'
    : `${value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}%`

const officialRecordHtml = (): string => {
  const record = mg.record
  if (!record) {
    return `<section class="shi-official-record empty">
      <header><div><b>游戏官方生涯统计</b><span>服务器永久累计</span></div></header>
      <p>返港一次就自动同步；更完整的一份，打开游戏内「戦績表示」页补齐</p>
    </section>`
  }
  const airBase = record.airBaseMaintenance.length
    ? `<div class="shi-record-airbase"><small>基地航空队整备等级</small>${record.airBaseMaintenance
        .map(
          (entry) =>
            `<span>${entityTermHtml('mapArea', entry.areaId, entityNamePlain('mapArea', entry.areaId, mapAreaNames.get(entry.areaId) ?? `海域区 ${entry.areaId}`))} <b>Lv ${entry.level}</b></span>`,
        )
        .join('')}</div>`
    : ''
  return `<section class="shi-official-record">
    <header><div><b>游戏官方生涯统计</b><span>服务器累计 · ${fmtTime(record.ts)} 同步</span>${
      mg.basic?.medals ? `<span class="shi-medals" title="甲种勋章（甲级作战通关章）">甲章 ×${mg.basic.medals}</span>` : ''
    }</div></header>
    <div class="shi-record-grid">
      <span><small>出击</small><b>${record.sortieWin.toLocaleString()} 胜</b><i>${record.sortieLose.toLocaleString()} 负 · ${officialRate(record.sortieRate)}</i></span>
      <span><small>演习</small><b>${record.practiceWin.toLocaleString()} 胜</b><i>${record.practiceLose.toLocaleString()} 负 · ${officialRate(record.practiceRate)}</i></span>
      <span><small>远征</small><b>${record.missionSuccess.toLocaleString()} 成功</b><i>${record.missionCount.toLocaleString()} 次 · ${officialRate(record.missionRate)}</i></span>
      <span><small>自然恢复上限</small><b>${record.materialMax?.toLocaleString() ?? '—'}</b><i>四项基础资源</i></span>
      <span><small>舰娘</small><b>${record.shipCount?.toLocaleString() ?? '—'}</b><i>/ ${record.shipCapacity?.toLocaleString() ?? '—'} 船位</i></span>
      <span><small>装备</small><b>${record.slotitemCount?.toLocaleString() ?? '—'}</b><i>/ ${record.slotitemCapacity?.toLocaleString() ?? '—'} 槽位</i></span>
    </div>
    ${airBase}
    ${portLogsHtml()}
  </section>`
}

// 母港滚动消息（port api_log，2026-08-17 启用）：游戏自报的「最近发生」，
// 日文原文照排——它是官方措辞的一部分，不编译名。与铃的实时通知不重复计：
// 这里只是返港快照，用来核对「刚才游戏说发生了什么」。
const portLogsHtml = (): string => {
  if (!mg.portLogs.length) return ''
  return `<div class="shi-port-logs"><small>母港滚动消息</small>
    ${mg.portLogs.map((log) => `<span>${esc(log.message)}</span>`).join('')}
  </div>`
}
const deltaClass = (value: number) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat')
const mapCode = mapCodeOf
// 道具名一律从这里出：主数据给的是日文原名，先过译名表再上屏
//（2026-08-25 汉化清点：同一道具曾有两种写法）。
const itemName = (id: number) => entityNamePlain('item', id, useitemNames.get(id) ?? `道具 #${id}`)

const DAY_COL = 56
const lineChart = (values: readonly (number | null)[], color: string): string => {
  if (!values.length) return ''
  const width = values.length * DAY_COL
  const height = 116
  const padY = 12
  const finite = values.filter((value): value is number => value != null)
  const maxAbs = Math.max(1, ...finite.map((value) => Math.abs(value)))
  const x = (index: number) => DAY_COL * index + DAY_COL / 2
  const y = (value: number) => height / 2 - (value / maxAbs) * (height / 2 - padY)
  const segments: string[] = []
  let current: string[] = []
  values.forEach((value, index) => {
    if (value == null) {
      if (current.length) {
        segments.push(current.join(' '))
        current = []
      }
      return
    }
    current.push(`${x(index).toFixed(1)},${y(value).toFixed(1)}`)
  })
  if (current.length) segments.push(current.join(' '))
  const polylines = segments
    .map((points) => `<polyline points="${points}" style="--series:${color}"></polyline>`)
    .join('')
  const lastFinite = values.reduce((found, value, index) => (value != null ? index : found), -1)
  const dots = values
    .map((value, index) =>
      value == null
        ? ''
        : `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${index === lastFinite ? 3.3 : 1.8}">
          <title>${signed(value)}</title>
        </circle>`,
    )
    .join('')
  return `<svg class="shi-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="每日净增减曲线">
    <line class="zero" x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}"></line>
    ${polylines}
    <g style="--series:${color}">${dots}</g>
  </svg>`
}

const viewTabsHtml = () =>
  `<div class="shi-tabs">${VIEW_META.map(
    (view) =>
      `<button class="${activeView === view.id ? 'on' : ''}" data-shi-view="${view.id}">${view.label}</button>`,
  ).join('')}</div>`

const resourceChipsHtml = () =>
  `<div class="shi-resource-chips">${RESOURCE_META.map(
    (meta, index) =>
      `<button class="${selectedResource === index ? 'on' : ''}" data-shi-resource="${index}" style="--series:${meta.color}">
        ${materialIconHtml(MATERIAL_ICON_BY_INDEX[index], { className: 'sm', title: meta.label })}
        ${entityTermHtml('material', index, meta.label)}
      </button>`,
  ).join('')}</div>`

const resourceViewHtml = (): string => {
  const meta = RESOURCE_META[selectedResource]
  const complete = dailyMaterials.filter((day) => day.complete)
  const values = complete.map((day) => day.values[selectedResource] ?? 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  const today = dailyMaterials.at(-1)
  const average = values.length ? Math.round(total / values.length) : 0
  const series = dailyMaterials.map((day) =>
    day.complete ? (day.values[selectedResource] ?? 0) : null,
  )
  const cells = dailyMaterials
    .map((day) => {
      const value = day.values[selectedResource] ?? 0
      const on = selectedResourceDay === day.start
      return `<button type="button" class="shi-day-cell${day.complete ? '' : ' partial'}${on ? ' on' : ''}" data-shi-resource-day="${day.start}" title="${fmtDate(day.start)} · ${
        day.complete ? signed(value) : '缺少日初基线'
      }">
        <small>${fmtShortDay(day.start)}</small>
        <b class="${deltaClass(value)}">${day.complete ? signed(value) : '—'}</b>
      </button>`
    })
    .join('')
  return `<div class="shi-view shi-resources">
    <div class="shi-view-head">
      <div><b>每日资源增减</b><span>按本地自然日</span></div>
      <div class="shi-range">${RANGE_OPTIONS.map(
        (days) =>
          `<button class="${rangeDays === days ? 'on' : ''}" data-shi-range="${days}">${rangeLabelOf(days)}</button>`,
      ).join('')}</div>
    </div>
    ${resourceChipsHtml()}
    <div class="shi-kpis">
      <span><small>今日</small><b class="${deltaClass(today?.values[selectedResource] ?? 0)}">${
        today?.complete ? signed(today.values[selectedResource] ?? 0) : '—'
      }</b></span>
      <span><small>${rangeLabelOf(rangeDays)}合计</small><b class="${deltaClass(total)}">${signed(total)}</b></span>
      <span><small>日均</small><b class="${deltaClass(average)}">${signed(average)}</b></span>
      <span><small>当前持有</small><b>${(mg.materials?.[selectedResource] ?? 0).toLocaleString()}</b></span>
    </div>
    <div class="shi-chart-card">
      <div class="shi-chart-title"><b>${entityTermHtml('material', selectedResource, meta.label)}</b></div>
      ${
        dailyMaterials.length
          ? `<div class="shi-chart-scroll"><div class="shi-chart-track" style="grid-template-columns: repeat(${dailyMaterials.length}, minmax(${DAY_COL}px, 1fr))">
              ${lineChart(series, meta.color)}
              ${cells}
            </div></div>`
          : '<div class="shi-empty">这个区间暂无记录</div>'
      }
    </div>
    <button class="shi-primary" data-open-resource-chart>打开独立大图</button>
  </div>`
}

const practiceRows = () => battles.filter((battle) => battle.practice)
const practiceViewHtml = (): string => {
  const rows = practiceRows()
  const wins = rows.filter((row) => row.rank && WIN_RANKS.has(row.rank)).length
  const sWins = rows.filter((row) => row.rank === 'S').length
  const morningRows = rows.filter((row) => practiceSessionOf(row.ts) === 'morning')
  const eveningRows = rows.filter((row) => practiceSessionOf(row.ts) === 'evening')
  // 日卡按 **JST 自然日**分组：场次判定（practiceSessionOf）本来就按 JST，
  // 日卡再按本地日切，本地午夜就会把一个场次劈成两张卡（本机 UTC+8：
  // JST 日界落在本地 23:00，那一小时打的场会掉进前一张卡里）。
  const byDay = new Map<number, { total: number; wins: number; s: number; morning: number; evening: number }>()
  for (const row of rows) {
    const day = jstDayStart(row.ts)
    const stats = byDay.get(day) ?? { total: 0, wins: 0, s: 0, morning: 0, evening: 0 }
    stats.total += 1
    if (row.rank && WIN_RANKS.has(row.rank)) stats.wins += 1
    if (row.rank === 'S') stats.s += 1
    if (practiceSessionOf(row.ts) === 'morning') stats.morning += 1
    else stats.evening += 1
    byDay.set(day, stats)
  }
  const days = [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .filter(
      ([day, stats]) =>
        day === selectedPracticeDay ||
        selectedPracticeSession == null ||
        stats[selectedPracticeSession] > 0,
    )
  const dailyHtml = rows.length
    ? [
        `<button type="button" class="shi-practice-day${selectedPracticeDay == null ? ' on' : ''}" data-shi-practice-day="0">
          <time>全部日期</time><b>${rows.length} 战</b>
          <span>B+ ${wins}</span><span>早 ${morningRows.length}</span><span>晚 ${eveningRows.length}</span>
        </button>`,
        ...days.map(
          ([day, stats]) => `<button type="button" class="shi-practice-day${
            selectedPracticeDay === day ? ' on' : ''
          }" data-shi-practice-day="${day}">
            <time>${fmtJstDate(day)}</time><b>${stats.total} 战</b>
            <span>B+ ${stats.wins}</span><span>早 ${stats.morning}</span><span>晚 ${stats.evening}</span>
          </button>`,
        ),
      ].join('')
    : '<div class="shi-empty">暂无演习结算记录</div>'
  const visible = rows.filter((row) => {
    if (selectedPracticeDay != null && jstDayStart(row.ts) !== selectedPracticeDay) return false
    if (selectedPracticeSession && practiceSessionOf(row.ts) !== selectedPracticeSession) return false
    return true
  })
  const recent = battleHistoryHtml(visible, (row) => `演习 · ${row.rank ?? '未记录评价'}`, 'jstSession')
  const sessionNote =
    selectedPracticeSession == null ? '' : selectedPracticeSession === 'morning' ? '早场 · ' : '晚场 · '
  const recentTitle =
    selectedPracticeDay == null
      ? `${sessionNote}结算记录 ${visible.length} 场 · 点击复盘`
      : `${sessionNote}${fmtJstDate(selectedPracticeDay)} · ${visible.length} 场 · 点击复盘`
  return `<div class="shi-view">
    <div class="shi-view-head"><div><b>演习回顾</b><span>B 以上计胜利 · 早场 03:00–15:00 JST / 晚场 15:00–次日 03:00</span></div></div>
    <div class="shi-kpis">
      <span><small>已记录</small><b>${rows.length}</b></span>
      <span><small>B+ 胜利</small><b>${wins}</b></span>
      <span><small>S 胜</small><b>${sWins}</b></span>
      <span><small>胜率</small><b>${rows.length ? `${Math.round((wins / rows.length) * 100)}%` : '—'}</b></span>
      <span><small>早场</small><b>${morningRows.length}</b></span>
      <span><small>晚场</small><b>${eveningRows.length}</b></span>
    </div>
    <div class="shi-session-chips">
      <button type="button" class="${selectedPracticeSession == null ? 'on' : ''}" data-shi-practice-session="">全部场次</button>
      <button type="button" class="${selectedPracticeSession === 'morning' ? 'on' : ''}" data-shi-practice-session="morning">早场</button>
      <button type="button" class="${selectedPracticeSession === 'evening' ? 'on' : ''}" data-shi-practice-session="evening">晚场</button>
    </div>
    <div class="shi-two-col">
      <section class="shi-panel"><h3>按日（JST）· 点击筛选</h3><div class="shi-practice-days">${dailyHtml}</div></section>
      <section class="shi-panel"><h3>${recentTitle}</h3><div class="shi-history-list">${
        recent || '<div class="shi-empty">暂无可回放记录</div>'
      }</div></section>
    </div>
  </div>`
}

const nodeTimelineHtml = (): string => {
  if (!selectedNode) return '<div class="shi-empty">选择一个节点</div>'
  const key = `${selectedNode.map}:${selectedNode.cell}`
  if (nodeLoadingKey === key) return '<div class="shi-empty">正在读取该点的长期记录……</div>'
  if (selectedNodeReport?.entries.length) {
    return selectedNodeReport.entries
      .map((entry) => {
        let sunk = 0
        if (entry.sunkMask != null) {
          for (let mask = entry.sunkMask; mask; mask >>= 1) sunk += mask & 1
        }
        // 首杀标记逐位对齐 sunkMask（位 i ↔ comp[i]，与遭遇志写入端同口径）；
        // 同一场里两艘同型舰只有靠前的那一艘算首杀，掩码那边也只落一次。
        const killMarked = new Set<number>()
        const enemies = entry.comp
          .map((mstId, i) => {
            const name = shipNames.get(mstId) ?? `#${mstId}`
            const link = mstId >= 1500
              ? elink('abyssShip', mstId, name)
              : elink('mstShip', mstId, name)
            if (entry.sunkMask == null || !(entry.sunkMask & (1 << i)) || killMarked.has(mstId)) {
              return link
            }
            const badge = firstKillBadgeHtml(mstId, entry.ts, true)
            if (badge) killMarked.add(mstId)
            return `${link}${badge}`
          })
          .join(' · ')
        return `<div class="shi-node-battle">
          <time>${esc(fmtDateTime(entry.ts))}</time>
          <div><b>${entry.isBoss ? 'Boss · ' : ''}${esc(FORMATION[entry.formation] ?? `阵形 ${entry.formation}`)}</b>
            ${entry.rank ? `<span class="shi-rank ${WIN_RANKS.has(entry.rank) ? 'win' : 'loss'}">${esc(entry.rank)}</span>` : ''}
            ${entry.sunkMask != null ? `<span>击沉 ${sunk}/${entry.comp.length}</span>` : ''}
            ${entry.dropMst ? `<span class="drop">掉落 ${elink('mstShip', entry.dropMst, shipNames.get(entry.dropMst) ?? `#${entry.dropMst}`)}${firstDropBadgeHtml(entry.dropMst, entry.ts, true)}${unownedShipBadgeHtml(entry.dropMst)}</span>` : '<span class="dim">空掉落</span>'}
          </div>
          <small>${enemies}</small>
        </div>`
      })
      .join('')
  }
  if (nodeLoadFailed) {
    return `<div class="shi-empty">该点的记录读取失败。
      <button class="pf-btn" data-shi-node="${key}">重试</button></div>`
  }
  return '<div class="shi-empty">该点没有可读取的记录。</div>'
}

// 海图、点选、芯片共用同一张「当前图」：出击快照必须跟这张图走，不能在「全部海图」时混进别的海域。
const shownNodeMap = (): number => selectedNodeMap ?? selectedNode?.map ?? nodeIndex[0]?.map ?? 0

const nodeSnapshotsBlock = (
  map: number,
): { title: string; list: string } => {
  const rows = battles.filter((battle) => !battle.practice && (map <= 0 || battle.map === map))
  const list = battleHistoryHtml(
    rows,
    (battle) =>
      `${mapCode(battle.map)} · ${battle.isBoss ? 'Boss' : `${letterOf(battle.map, battle.cell)}点`}`,
  )
  return {
    title: map > 0
      ? `${mapCode(map)} · ${rows.length} 场 · 点击复盘`
      : `出击记录 ${rows.length} 场 · 点击复盘`,
    list: list || '<div class="shi-empty">暂无战斗记录</div>',
  }
}

// 选中点位专属的一块：整图那块照旧，这块只收「这一格」的快照，省得回到下面的长列表里翻。
// 口径跟右边的遭遇志一致——按 map+cell 精确取，不按字母合并（同一个字母可能有多条进路边，
// 索引里本来就是分开的两行，合并会让这块的场数跟上面的遭遇志对不上）。
const nodeBattlesBlock = (): { title: string; list: string } | null => {
  if (!selectedNode) return null
  const { map, cell } = selectedNode
  const rows = battles.filter(
    (battle) => !battle.practice && battle.map === map && battle.cell === cell,
  )
  const list = battleHistoryHtml(
    rows,
    (battle) =>
      `${mapCode(battle.map)} · ${battle.isBoss ? 'Boss' : `${letterOf(battle.map, battle.cell)}点`}`,
  )
  const head = `${mapCode(map)} · ${letterOf(map, cell)} 点`
  return {
    // 遭遇志留着、快照被清掉的点很常见，空态只报「这里没有可回放的」，不摆成故障。
    title: rows.length ? `${head} · ${rows.length} 场 · 点击复盘` : `${head} · 0 场`,
    list: list || '<div class="shi-empty">这一点暂无可回放快照</div>',
  }
}

const nodeViewHtml = (): string => {
  const sortieBattles = battles.filter((battle) => !battle.practice)
  const total = nodeIndex.reduce((sum, node) => sum + node.count, 0)
  const boss = nodeIndex.reduce((sum, node) => sum + node.bosses, 0)
  const allMaps = [...new Set(nodeIndex.map((node) => node.map))].sort((a, b) => a - b)
  const visibleIndex = selectedNodeMap
    ? nodeIndex.filter((node) => node.map === selectedNodeMap)
    : nodeIndex
  const maps = new Map<number, NodeHistoryIndexEntry[]>()
  for (const node of visibleIndex) {
    const list = maps.get(node.map) ?? []
    list.push(node)
    maps.set(node.map, list)
  }
  const mapOrder = [...maps.keys()].sort((a, b) => a - b)
  const areaOrder: number[] = []
  const mapsByArea = new Map<number, number[]>()
  for (const map of mapOrder) {
    const area = mapAreaOf(map)
    if (!mapsByArea.has(area)) {
      mapsByArea.set(area, [])
      areaOrder.push(area)
    }
    mapsByArea.get(area)!.push(map)
  }
  const mapChips = allMaps.length
    ? `<div class="shi-node-maps">
        <button type="button" class="${selectedNodeMap == null ? 'on' : ''}" data-shi-node-map="0">全部海图</button>
        ${allMaps
          .map(
            (map) =>
              `<button type="button" class="${selectedNodeMap === map ? 'on' : ''}" data-shi-node-map="${map}">${esc(mapCode(map))}</button>`,
          )
          .join('')}
      </div>`
    : ''
  const nodes = mapOrder.length
    ? areaOrder
        .map((area) => {
          const mapsInArea = mapsByArea.get(area) ?? []
          return `<div class="shi-map-area">
            <h4>${esc(mapAreaLabel(area))}</h4>
            ${mapsInArea
              .map((map) => {
                const list = [...(maps.get(map) ?? [])].sort((a, b) => a.cell - b.cell)
                const fights = list.reduce((sum, node) => sum + node.count, 0)
                const open =
                  selectedNodeMap === map ||
                  selectedNode?.map === map ||
                  (selectedNodeMap == null && selectedNode == null && map === mapOrder[0])
                // 点位索引是动态列表（新打一张图就插一行），光靠「同 class 内序号」
                // 认键会把展开态错位到隔壁那张图上——图号本身就是稳定键。
                return `<details class="shi-map-group" data-keep="map-group:${map}"${open ? ' open' : ''}>
                  <summary>${esc(mapCode(map))} · ${list.length} 点 · ${fights} 战</summary>
                  ${list
                    .map(
                      (node) => `<button type="button" class="shi-node-row${
                        selectedNode?.map === node.map && selectedNode.cell === node.cell ? ' on' : ''
                      }" data-shi-node="${node.map}:${node.cell}">
                        <span>${elink('map', node.map, mapCode(node.map))}</span>
                        <b>${esc(letterOf(node.map, node.cell))} 点</b>
                        <small>${node.count} 战${node.bosses ? ` · Boss ${node.bosses}` : ''}</small>
                        <time>${fmtDate(node.lastTs)}</time>
                      </button>`,
                    )
                    .join('')}
                </details>`
              })
              .join('')}
          </div>`
        })
        .join('')
    : '<div class="shi-empty">暂无永久节点遭遇记录</div>'
  const previewMap = shownNodeMap()
  // 记下这次整页渲染把海图卡画成了哪张图（0 = 没有卡），换点时的局部补丁据此判断该不该换卡。
  shownMapCard = previewMap > 0 ? previewMap : 0
  const snapshots = nodeSnapshotsBlock(previewMap)
  const nodeSnaps = nodeBattlesBlock()
  return `<div class="shi-view shi-nodes">
    <div class="shi-view-head"><div><b>出击节点记录</b><span>遭遇志永久累计</span></div></div>
    <div class="shi-kpis">
      <span><small>有记录点位</small><b>${nodeIndex.length}</b></span>
      <span><small>节点战斗</small><b>${total}</b></span>
      <span><small>Boss 战</small><b>${boss}</b></span>
      <span><small>近期可回放</small><b>${sortieBattles.length}</b></span>
    </div>
    ${mapChips}
    ${previewMap > 0 ? nodeMapSvgHtml(previewMap) : ''}
    <div class="shi-two-col">
      <section class="shi-panel"><h3>点位索引</h3><div class="shi-node-list">${nodes}</div></section>
      <section class="shi-panel"><h3 data-shi-node-title>${
        selectedNode
          ? `${mapCode(selectedNode.map)} · ${esc(letterOf(selectedNode.map, selectedNode.cell))} 点`
          : '节点详情'
      }</h3><div class="shi-node-timeline">${nodeTimelineHtml()}</div></section>
    </div>
    <div class="shi-nodes-foot">
      <section class="shi-panel shi-recent-battles"><h3 data-shi-snapshots-title>${
        snapshots.title
      }</h3><div class="shi-history-list">${snapshots.list}</div></section>
      <section class="shi-panel shi-node-battles" data-shi-node-snapshots${
        nodeSnaps ? '' : ' hidden'
      }><h3 data-shi-node-snapshots-title>${
        nodeSnaps ? esc(nodeSnaps.title) : ''
      }</h3><div class="shi-history-list">${nodeSnaps?.list ?? ''}</div></section>
    </div>
  </div>`
}

const archiveItemHtml = (rows: { id: number; gained: number; spent: number }[] = []) =>
  rows
    .filter((row) => row.gained || row.spent)
    .slice(0, 8)
    .map((row) => {
      const name = itemName(row.id)
      return `<span class="shi-event-item">
        ${useItemIconHtml(row.id, name, { className: 'sm' })}
        ${elink('useitem', row.id, name)}
        ${row.gained ? `<b class="up">+${row.gained}</b>` : ''}
        ${row.spent ? `<b class="down">−${row.spent}</b>` : ''}
      </span>`
    })
    .join('')

// 归档掉落按舰种聚合，没有逐条时间戳——「初」改用活动窗口界定：
// 这艘舰的首见落在本次活动期间，就是这次活动第一次到手的。
const archiveDropHtml = (
  rows: { mstId?: number; n?: number }[] = [],
  window: { opened: number; closed: number } | null = null,
) => {
  const valid = rows.filter((row) => Number(row.mstId) > 0)
  if (!valid.length) return ''
  const chips = valid
    .map((row) => {
      const mstId = Number(row.mstId)
      const name = shipNames.get(mstId) ?? `#${mstId}`
      const first = firstDropOf(mstId)
      const inWindow =
        !!window && !!first && first.ts >= window.opened && first.ts <= window.closed
      return `<span class="shi-event-drop">${shipThumbHtml(mstId, name, { className: 'drop' })}
        ${elink('mstShip', mstId, name)}${Number(row.n) > 1 ? `<b>×${Number(row.n)}</b>` : ''}
        ${inWindow ? firstDropBadgeHtml(mstId, first!.ts, true) : ''}${unownedShipBadgeHtml(mstId)}</span>`
    })
    .join('')
  // 归档列表会随新活动结账插入新行，光靠序号认会错位到隔壁活动，给个稳定 key。
  return `<details class="shi-event-drops"${window ? ` data-keep="event-drops:${window.opened}"` : ''}>
    <summary>掉落明细 · ${valid.length} 种</summary><div>${chips}</div></details>`
}

const eventViewHtml = (): string => {
  if (!eventArchives.length) {
    return `<div class="shi-view">
      <div class="shi-view-head"><div><b>往期活动</b></div></div>
      <div class="shi-empty large">暂无已结束活动的归档</div>
    </div>`
  }
  const cards = eventArchives
    .map((archive) => {
      const stats = archive.stats ?? {}
      const firstMap = archive.maps?.[0]
      const mapId = Number(firstMap?.api_id ?? (firstMap?.api_no ? archive.areaId * 10 + firstMap.api_no : 0))
      const net = Array.isArray(stats.resNet)
        ? stats.resNet
            .slice(0, 4)
            .map(
              (value, index) =>
                `<span>${materialIconHtml(MATERIAL_ICON_BY_INDEX[index], { className: 'sm', title: RESOURCE_META[index].label })}
                  <b class="${deltaClass(Number(value) || 0)}">${signed(Number(value) || 0)}</b></span>`,
            )
            .join('')
        : '<i>资源窗口不完整</i>'
      return `<article class="shi-event-card">
        <header><div><b>${esc(archive.areaName ?? `活动海域 ${archive.areaId}`)}</b>
          <span>${fmtDate(archive.opened)} — ${fmtDate(archive.closed)}</span></div>
          ${mapId > 0 ? elink('map', mapId, '打开活动海图') : '<span class="dim">海图资料未归档</span>'}
        </header>
        <div class="shi-event-kpis">
          <span><small>出击</small><b>${Number(stats.sorties ?? 0)}</b></span>
          <span><small>战斗</small><b>${Number(stats.battles ?? 0)}</b></span>
          <span><small>Boss</small><b>${Number(stats.bosses ?? 0)}</b></span>
          <span><small>击破</small><b>${Number(stats.killed ?? 0)}</b></span>
          <span><small>掉落种类</small><b>${Array.isArray(stats.drops) ? stats.drops.length : 0}</b></span>
        </div>
        <div class="shi-event-net"><small>活动期账号净变化${
          stats.resCoversFullWindow === false ? ' · 前段记录已清理' : ''
        }</small>${net}</div>
        ${archiveDropHtml(Array.isArray(stats.drops) ? stats.drops : [], {
          opened: Number(archive.opened) || 0,
          closed: Number(archive.closed) || 0,
        })}
        ${
          stats.useitems?.length
            ? `<div class="shi-event-items"><small>特殊道具积攒 / 消耗</small>${archiveItemHtml(stats.useitems)}</div>`
            : ''
        }
      </article>`
    })
    .join('')
  return `<div class="shi-view">
    <div class="shi-view-head"><div><b>往期活动</b><span>${eventArchives.length} 次归档</span></div></div>
    <div class="shi-event-list">${cards}</div>
  </div>`
}

const CAUSE_LABEL: Record<string, string> = {
  '/kcsapi/api_req_member/itemuse': '使用或兑换道具',
  '/kcsapi/api_req_quest/clearitemget': '领取任务奖励',
  '/kcsapi/api_req_member/get_event_selected_reward': '领取活动选择奖励',
  '/kcsapi/api_req_mission/result': '远征归来',
  '/kcsapi/api_req_sortie/battleresult': '出击战果',
  '/kcsapi/api_req_combined_battle/battleresult': '联合舰队战果',
  '/kcsapi/api_req_kousyou/remodel_slot': '改修工厂',
  '/kcsapi/api_req_kaisou/remodeling': '舰娘改造',
  '/kcsapi/api_req_kaisou/slotset_ex': '补强增设开孔',
  '/kcsapi/api_req_kaisou/hangar_expand': '使用格納庫増設',
}
// actionEvents 由主进程按 ts ASC 取出（ledger.queryActionEvents 的 ORDER BY），
// 所以「窗口右端」二分即可：原先每渲染一行都从头线扫，攒满一年是每行十几万次比较。
const lastActionAtOrBefore = (ts: number): ActionEvent | null => {
  let lo = 0
  let hi = actionEvents.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (actionEvents[mid].ts <= ts) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found >= 0 ? actionEvents[found] : null
}
const causeOf = (change: UseitemHistoryChange): string => {
  // 还没拉到事件账本时不能说「没找到」——那是把「还没查」报告成「查过了，没有」。
  if (!actionEventsLoaded) return '正在读取记录……'
  const best = lastActionAtOrBefore(change.ts)
  if (best && best.ts >= change.ts - CAUSE_WINDOW_MS) {
    return CAUSE_LABEL[best.path] ?? '其他游戏操作'
  }
  if (actionEarliest != null && change.ts < actionEarliest) return '那段记录已清理'
  return '未找到邻近操作'
}

// ---- 本机氪金记录 ----

const PAY_KIND_LABEL: Record<PayLogRow['kind'], string> = { buy: '购买', use: '消耗', manual: '补记' }

// 道具图标：课金商品与 useitem 同名时直接用它的图标（2026-08-19 用户指出光秃秃的字不行）
const payItemIconHtml = (name: string): string => {
  const useitemId = useitemIdByName.get(name)
  return useitemId ? useItemIconHtml(useitemId, name, { className: 'sm' }) : ''
}

// 消耗行的效果摘要：已知字段译成人话，认不出的保留原样进悬停，不硬造解释
const payEffectText = (detail: string | null): { text: string; hover: string } => {
  if (!detail) return { text: '', hover: '' }
  try {
    const fx = JSON.parse(detail)
    const parts: string[] = []
    if (typeof fx.api_max_chara === 'number') parts.push(`船位上限 → ${fx.api_max_chara}`)
    if (typeof fx.api_max_slotitem === 'number') parts.push(`槽位上限 → ${fx.api_max_slotitem}`)
    return { text: parts.join(' · ') || '效果已记录', hover: detail }
  } catch (_e) {
    return { text: '', hover: detail }
  }
}

// 补记的时刻取所选日期的本地正午（避开时区与夏令时把日期挪到前后一天）。
const payFormTs = (day: string): number => new Date(`${day}T12:00:00`).getTime()
// 主进程会把越界的补记原样退回一个 null（main/mg/index.ts 的 mg:pay-log-add），
// 没有理由可读。所以这里照着同一套判据先说清楚是哪一条不合格——
// 退回时既不关表单也不刷新，玩家改一改就能再提交。
const PAY_MIN_TS = Date.UTC(2013, 0, 1)
const payFormReject = (
  item: { id: number; name: string; price: number | null } | undefined,
  ts: number,
  count: number,
): string => {
  if (!payitemCatalog.length) return '课金商品目录还没同步'
  if (!item) return '先选一件道具'
  if (!Number.isFinite(ts)) return '日期没填完整'
  if (ts < PAY_MIN_TS) return '日期早于游戏开服（2013-01-01）'
  if (ts > Date.now() + DAY_MS) return '日期不能超过明天'
  if (!Number.isInteger(count) || count < 1 || count > 99) return '数量要在 1–99 之间'
  return ''
}
const payFormHtml = (): string => {
  if (!payFormOpen) return ''
  // 日期输入直接把必败区间挡在外面：下界与主进程的 2013-01-01 同源，
  // 上界给到明天（主进程收 now + 1 天）——「后天」这类填了必被退回的值就选不出来。
  const dateMax = fmtDate(Date.now() + DAY_MS)
  const options = payitemCatalog
    .map(
      (item) =>
        `<option value="${item.id}"${payForm.itemId === item.id ? ' selected' : ''}>${esc(item.name)}${
          item.price != null ? `（${item.price.toLocaleString()} 点）` : ''
        }</option>`,
    )
    .join('')
  return `<div class="shi-pay-form">
    <label>道具 <select data-shi-pay-item>${options}</select></label>
    <label>数量 <input type="number" min="1" max="99" value="${payForm.count}" data-shi-pay-count></label>
    <label>日期 <input type="date" min="2013-01-01" max="${dateMax}" value="${payForm.date}" data-shi-pay-date></label>
    <button class="shi-pay-submit" data-shi-pay-submit>记一笔</button>
    <button class="shi-pay-cancel" data-shi-pay-cancel>取消</button>
    ${
      payFormError
        ? `<i class="shi-pay-error" style="color:var(--bad);font-style:normal;font-size:9px">没记上：${esc(payFormError)}</i>`
        : ''
    }
  </div>`
}

const payLogPanelHtml = (): string => {
  const spentPoints = payLog
    .filter((row) => row.kind === 'buy' || row.kind === 'manual')
    .reduce((sum, row) => sum + (row.price ?? 0) * row.count, 0)
  const stock = mg.payitems
  const stockEntries = stock ? Object.entries(stock.items) : []
  const stockHtml = !stock
    ? `<div class="shi-pay-stock"><small>已购未用</small><i>尚未同步 · 在 kuma 里开一次游戏内道具商店</i></div>`
    : `<div class="shi-pay-stock"><small>已购未用</small>${
        stockEntries.length
          ? stockEntries
              .map(
                ([, item]) =>
                  `<span class="chip">${payItemIconHtml(item.name)}${esc(item.name)} ×${item.count}${
                    item.price != null ? `<i>${(item.price * item.count).toLocaleString()} 点</i>` : ''
                  }</span>`,
              )
              .join('')
          : '<i>没有已购未用的课金道具</i>'
      }<time>同步于 ${fmtTime(stock.ts)}</time></div>`
  const rows = payLog
    .map((row) => {
      const fx = row.kind === 'use' ? payEffectText(row.detail) : { text: '', hover: '' }
      const points =
        row.kind === 'use'
          ? ''
          : row.price != null
            ? `${(row.price * row.count).toLocaleString()} 点`
            : '点数不详'
      return `<div class="shi-pay-row kind-${row.kind}">
        <time>${fmtDateTime(row.ts)}</time>
        <i class="k">${PAY_KIND_LABEL[row.kind]}</i>
        <span class="name">${payItemIconHtml(row.name)}${esc(row.name)}</span>
        <b>×${row.count}</b>
        <span class="pts">${points}</span>
        <span class="fx"${fx.hover ? ` title="${esc(fx.hover)}"` : ''}>${esc(fx.text)}</span>
        ${
          row.kind === 'manual'
            ? `<button class="shi-pay-del${payDelArmId === row.id ? ' arm' : ''}" data-shi-pay-del="${row.id}" title="删除这条补记">${
                payDelArmId === row.id ? '确认删除' : '×'
              }</button>`
            : ''
        }
      </div>`
    })
    .join('')
  return `<section class="shi-panel shi-pay">
    <h3>本机氪金记录
      <span class="shi-pay-total" title="点数按商店定价折算">${
        payLog.length ? `累计 ${spentPoints.toLocaleString()} 点（≈日元） · ${payLog.filter((r) => r.kind !== 'use').length} 笔` : ''
      }</span>
      <button class="shi-pay-add" data-shi-pay-add title="补记一笔 kuma 之外的氪金">＋ 补记</button>
    </h3>
    ${stockHtml}
    ${payFormHtml()}
    ${payDelError ? `<div class="shi-note" style="color:var(--bad)">${esc(payDelError)}</div>` : ''}
    <div class="shi-pay-rows">${
      rows || '<div class="shi-empty">暂无记录 · 此前的可用「补记」登记</div>'
    }</div>
  </section>`
}

const itemViewHtml = (): string => {
  // 开关一开就在源头掐掉：累计、流水、上面四个数都读这两份，少一处漏就是数对不上行。
  const visibleSummaries = dropFurnitureBoxes(
    useitemSummary,
    (row) => row.id,
    useitemNames,
    hideFurnitureBox,
  )
  const visibleChanges = dropFurnitureBoxes(
    itemChanges,
    (change) => change.itemId,
    useitemNames,
    hideFurnitureBox,
  )
  const summaries = [...visibleSummaries].sort(
    (a, b) => b.lastTs - a.lastTs || b.gained + b.spent - (a.gained + a.spent),
  )
  const gained = summaries.reduce((sum, row) => sum + row.gained, 0)
  const spent = summaries.reduce((sum, row) => sum + row.spent, 0)
  const rows = summaries
    .map((row) => {
      const name = itemName(row.id)
      return `<button class="shi-item-row${selectedItemId === row.id ? ' on' : ''}" data-shi-item="${row.id}">
        ${useItemIconHtml(row.id, name, { className: 'sm' })}
        <span class="name">${elinkHtml('useitem', row.id, entityTermHtml('useitem', row.id, name))}</span>
        <span>现有 <b>${(mg.useitems[row.id] ?? 0).toLocaleString()}</b></span>
        <span class="up">累计 +${row.gained.toLocaleString()}</span>
        <span class="down">累计 −${row.spent.toLocaleString()}</span>
        <time>${fmtTime(row.lastTs)}</time>
      </button>`
    })
    .join('')
  const filteredChanges = selectedItemId
    ? visibleChanges.filter((change) => change.itemId === selectedItemId)
    : visibleChanges
  const timeline = filteredChanges
    .slice(0, 120)
    .map((change) => {
      const name = itemName(change.itemId)
      return `<div class="shi-item-change">
        <time>${fmtTime(change.ts)}</time>
        ${useItemIconHtml(change.itemId, name, { className: 'sm' })}
        ${elink('useitem', change.itemId, name)}
        <b class="${deltaClass(change.delta)}">${signed(change.delta)}</b>
        <span>→ ${change.total}</span>
        <i>${esc(causeOf(change))}</i>
      </div>`
    })
    .join('')
  return `<div class="shi-view">
    <div class="shi-view-head"><div><b>特殊道具积攒与兑换</b><span>特殊道具永久累计 · 原因为推断</span></div>
      <div class="shi-item-filter"><button type="button" class="${
        hideFurnitureBox ? 'on' : ''
      }" data-shi-hide-furniture>隐藏家具箱</button></div>
    </div>
    <div class="shi-kpis">
      <span><small>有变化道具</small><b>${summaries.length}</b></span>
      <span><small>累计获得</small><b class="up">+${gained.toLocaleString()}</b></span>
      <span><small>累计消耗</small><b class="down">−${spent.toLocaleString()}</b></span>
      <span><small>变化记录</small><b>${visibleChanges.length}${
        // 「+」认的是**取数被截断**（只取最近 240 条），与隐藏与否无关
        itemChanges.length >= 240 ? '+' : ''
      }</b></span>
    </div>
    ${payLogPanelHtml()}
    <div class="shi-two-col">
      <section class="shi-panel"><h3>道具累计</h3><div class="shi-item-list">${
        rows || '<div class="shi-empty">暂无特殊道具变化</div>'
      }</div></section>
      <section class="shi-panel"><h3>最近变化 / 兑换线索
        ${selectedItemId ? `<button class="shi-inline-clear" data-shi-item="0">显示全部 ×</button>` : ''}
      </h3><div class="shi-item-timeline">${
        timeline || '<div class="shi-empty">暂无变化记录</div>'
      }</div></section>
    </div>
  </div>`
}

// 两处裁切的档位。两层都不再静默截断：超出的部分挂在可点开的展开行后面。
const FACTORY_OUTCOME_LIMIT = 8
const FACTORY_RECIPE_LIMIT = 12

// 展开态的键要跨重渲认得出同一行。行本身没有 id，聚合口径就是「配方 × 秘书舰类型」
// （见 factory-stats 的分组键），照抄这一对即可，与列表顺序无关。
const factoryRecipeKey = (row: FactoryRecipeStats, kind: 'ship' | 'item'): string =>
  `${kind}:${row.recipe.join('/')}:${row.secretary ?? ''}`

const factoryRecipeText = (row: FactoryRecipeStats, kind: 'ship' | 'item'): string => {
  const [fuel = 0, ammo = 0, steel = 0, baux = 0, devmat = 0, large = 0] = row.recipe
  return kind === 'ship'
    ? `${large ? '大型 · ' : ''}${fuel}/${ammo}/${steel}/${baux} · 开发资材 ${devmat}`
    : `${fuel}/${ammo}/${steel}/${baux}`
}

const factoryOutcomeHtml = (
  outcome: FactoryRecipeStats['outcomes'][number],
  attempts: number,
  kind: 'ship' | 'item',
): string => {
  const pct = attempts > 0 ? (outcome.count / attempts) * 100 : 0
  const enoughSamples = attempts >= PERSONAL_RATE_MIN_SAMPLES
  const metric = enoughSamples
    ? `<span class="factory-outcome-metric"><b>${pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`}</b><small>${outcome.count}/${attempts}</small></span>`
    : `<span class="factory-outcome-metric"><b>${outcome.count} 次</b><small>样本 ${attempts}/${PERSONAL_RATE_MIN_SAMPLES}</small></span>`
  if (outcome.mstId <= 0) {
    return `<div class="factory-outcome fail">
      <span class="factory-outcome-media"><i>×</i></span><span class="factory-outcome-name">开发失败</span>${metric}
    </div>`
  }
  if (kind === 'ship') {
    const name = mg.master.ships[outcome.mstId]?.name ?? `舰娘 #${outcome.mstId}`
    return `<div class="factory-outcome">
      <span class="factory-outcome-media">${shipThumbHtml(
        outcome.mstId,
        entityNamePlain('ship', outcome.mstId, name),
        { className: 'factory' },
      )}</span>
      <span class="factory-outcome-name">${elink('mstShip', outcome.mstId, name)}</span>${metric}
    </div>`
  }
  const master = mg.master.slotitems[outcome.mstId]
  const name = master?.name ?? `装备 #${outcome.mstId}`
  return `<div class="factory-outcome">
    <span class="factory-outcome-media">${equipTypeIconHtml(master?.iconId ?? 0, {
      className: 'xs',
      title: entityNamePlain('equip', outcome.mstId, name),
    })}</span>
    <span class="factory-outcome-name">${elink('mstEquip', outcome.mstId, name)}</span>${metric}
  </div>`
}

const factoryViewHtml = (): string => {
  if (!factoryStats) {
    return `<div class="shi-view"><div class="shi-loading">正在读取本地建造与开发记录……</div></div>`
  }
  const list = factoryStats[factoryKind]
  const total = list.reduce((sum, row) => sum + row.attempts, 0)
  // 开发行按「配方 × 秘书舰类型」分行——秘书舰决定滚哪张开发表，混在一起的
  // 出货率对不上任何一张配方表。老账没有这一维度，标「未记录」，不猜不回补。
  const secretaryChip = (row: FactoryRecipeStats): string =>
    factoryKind !== 'item'
      ? ''
      : row.secretary
        ? `<em class="factory-secretary">${esc(row.secretary)}秘书</em>`
        : '<em class="factory-secretary unknown">秘书舰未记录</em>'
  const listOpen = factoryOpenLists.has(factoryKind)
  const shownRecipes = listOpen ? list : list.slice(0, FACTORY_RECIPE_LIMIT)
  const rows = shownRecipes
    .map((row) => {
      const key = factoryRecipeKey(row, factoryKind)
      const open = factoryOpenRecipes.has(key)
      const hidden = row.outcomes.length - FACTORY_OUTCOME_LIMIT
      const shown = open ? row.outcomes : row.outcomes.slice(0, FACTORY_OUTCOME_LIMIT)
      return `<div class="factory-recipe">
        <div class="factory-recipe-head">
          <b>${esc(factoryRecipeText(row, factoryKind))}</b>${secretaryChip(row)}
          <span>${row.attempts} 次 · ${fmtDate(row.firstTs)}—${fmtDate(row.lastTs)}</span>
        </div>
        <div class="factory-outcomes">${shown
          .map((outcome) => factoryOutcomeHtml(outcome, row.attempts, factoryKind))
          .join('')}</div>
        ${
          hidden > 0
            ? `<button type="button" class="factory-more" data-factory-more="${esc(key)}"
                aria-expanded="${open}">${open ? '收起 ▴' : `另有 ${hidden} 种结果 ▾`}</button>`
            : ''
        }
      </div>`
    })
    .join('')
  const hiddenRecipes = list.length - FACTORY_RECIPE_LIMIT
  const listMore =
    hiddenRecipes > 0
      ? `<button type="button" class="factory-list-more" data-factory-list-more
          aria-expanded="${listOpen}">${listOpen ? '收起 ▴' : `另有 ${hiddenRecipes} 个配方 ▾`}</button>`
      : ''
  const caveats: string[] = []
  if (factoryKind === 'ship' && factoryStats.pendingShips) {
    caveats.push(`${factoryStats.pendingShips} 次建造尚未领取`)
  }
  if (factoryKind === 'ship' && factoryStats.unmatchedShipResults) {
    caveats.push(
      `${factoryStats.unmatchedShipResults} 次领取找不到对应的建造记录`,
    )
  }
  return `<div class="shi-view">
    <div class="shi-view-head"><div><b>工厂实测</b><span>已确认 ${total} 次</span></div>
      <div class="factory-tabs">
        <button class="${factoryKind === 'ship' ? 'on' : ''}" data-factory-kind="ship">建造 ${factoryStats.ship.reduce((sum, row) => sum + row.attempts, 0)}</button>
        <button class="${factoryKind === 'item' ? 'on' : ''}" data-factory-kind="item">开发 ${factoryStats.item.reduce((sum, row) => sum + row.attempts, 0)}</button>
      </div>
    </div>
    <div class="factory-panel">
      <div class="factory-list">${rows || `<div class="shi-empty large">暂无${factoryKind === 'ship' ? '已领取的建造' : '开发'}记录</div>`}</div>
      ${listMore}
      ${caveats.length ? `<div class="factory-foot">${caveats.join(' ')}</div>` : ''}
    </div>
  </div>`
}

const overviewHtml = (): string => {
  const practices = practiceRows()
  const practiceWins = practices.filter((row) => row.rank && WIN_RANKS.has(row.rank)).length
  const totalNodes = nodeIndex.reduce((sum, node) => sum + node.count, 0)
  const itemSpent = useitemSummary.reduce((sum, row) => sum + row.spent, 0)
  const factoryAttempts = factoryStats
    ? [...factoryStats.ship, ...factoryStats.item].reduce((sum, row) => sum + row.attempts, 0)
    : 0
  const today = dailyMaterials.at(-1)
  const primary = [0, 1, 2, 3]
    .map((index) => {
      const value = today?.values[index] ?? 0
      return `<span>${materialIconHtml(MATERIAL_ICON_BY_INDEX[index], { className: 'sm', title: RESOURCE_META[index].label })}
        ${entityTermHtml('material', index, RESOURCE_META[index].label)}
        <b class="${deltaClass(value)}">${today?.complete ? signed(value) : '—'}</b></span>`
    })
    .join('')
  const cards = [
    ['resources', '每日资源', '0:00 起净变化', primary, `${rangeLabelOf(rangeDays)}曲线与逐日数值`],
    [
      'factory',
      '工厂',
      '建造与开发',
      `<strong>${factoryAttempts}</strong><span>次确认结果</span>`,
      '配方、出货与个人样本',
    ],
    [
      'practice',
      '演习',
      `${practices.length} 场记录`,
      `<strong>${practiceWins}</strong><span>次 B+ 胜利</span>`,
      '按日统计与逐场复盘',
    ],
    [
      'nodes',
      '出击节点',
      `${nodeIndex.length} 个点位`,
      `<strong>${totalNodes}</strong><span>场永久遭遇</span>`,
      '节点索引与近期战斗',
    ],
    [
      'events',
      '往期活动',
      `${eventArchives.length} 次归档`,
      `<strong>${eventArchives.reduce((sum, archive) => sum + Number(archive.stats?.sorties ?? 0), 0)}</strong><span>次活动出击</span>`,
      '日期、消耗、掉落与道具',
    ],
    [
      'items',
      '特殊道具',
      `${useitemSummary.length} 种有变化`,
      `<strong>${itemSpent}</strong><span>件累计消耗</span>`,
      '积攒、使用与兑换线索',
    ],
  ]
    .map(
      ([view, title, meta, body, foot]) => `<button class="shi-overview-card" data-shi-view="${view}">
        <header><b>${title}</b><span>${meta}</span></header>
        <div>${body}</div><footer>${foot} →</footer>
      </button>`,
    )
    .join('')
  return `<div class="shi-view shi-overview">
    <div class="shi-view-head"><div><b>提督回顾</b></div></div>
    ${officialRecordHtml()}
    <div class="shi-overview-grid">${cards}</div>
  </div>`
}

const bodyHtml = () => {
  if (loading) return '<div class="shi-loading">正在整理本地账本……</div>'
  // 读不出来要说读不出来。摆一堆「还没有记录」等于把故障报告成事实。
  if (loadFailed) {
    return `<div class="shi-empty">本地账本读取失败
      <button class="pf-btn" data-shi-retry>重试</button></div>`
  }
  if (activeView === 'resources') return resourceViewHtml()
  if (activeView === 'factory') return factoryViewHtml()
  if (activeView === 'practice') return practiceViewHtml()
  if (activeView === 'nodes') return nodeViewHtml()
  if (activeView === 'events') return eventViewHtml()
  if (activeView === 'items') return itemViewHtml()
  return overviewHtml()
}

const paintNodeSelection = (): boolean => {
  if (!pane || activeView !== 'nodes') return false
  const timeline = pane.querySelector('.shi-node-timeline')
  const title = pane.querySelector('[data-shi-node-title]')
  if (!timeline || !title) return false
  if (selectedNode && shownMapCard > 0 && shownMapCard !== selectedNode.map) {
    const card = pane.querySelector('.shi-mapgraph-card')
    if (!card) return false
    card.outerHTML = nodeMapSvgHtml(selectedNode.map)
    shownMapCard = selectedNode.map
  }
  // 局部换块：DOM 已经不是上次全量提交的那份（见 kernel commitPaneHtml）
  forgetCommittedHtml(pane, 'shi')
  title.textContent = selectedNode
    ? `${mapCode(selectedNode.map)} · ${letterOf(selectedNode.map, selectedNode.cell)} 点`
    : '节点详情'
  timeline.innerHTML = nodeTimelineHtml()
  const snapshots = nodeSnapshotsBlock(shownNodeMap())
  const snapTitle = pane.querySelector('[data-shi-snapshots-title]')
  const snapList = pane.querySelector('.shi-recent-battles .shi-history-list')
  if (snapTitle) snapTitle.textContent = snapshots.title
  if (snapList) snapList.innerHTML = snapshots.list
  // 选中点专属那块也走这条补丁链：整块常驻 DOM，没选点时靠 hidden 收起来，
  // 换点只改标题和列表——别让它变成「结构变了就得整页重渲」的理由。
  const nodeSnapPanel = pane.querySelector('[data-shi-node-snapshots]')
  if (nodeSnapPanel instanceof HTMLElement) {
    const nodeSnaps = nodeBattlesBlock()
    nodeSnapPanel.hidden = !nodeSnaps
    const nodeSnapTitle = nodeSnapPanel.querySelector('[data-shi-node-snapshots-title]')
    const nodeSnapList = nodeSnapPanel.querySelector('.shi-history-list')
    if (nodeSnapTitle) nodeSnapTitle.textContent = nodeSnaps?.title ?? ''
    if (nodeSnapList) nodeSnapList.innerHTML = nodeSnaps?.list ?? ''
  }
  pane.querySelectorAll('.shi-spot.on').forEach((el) => el.classList.remove('on'))
  pane.querySelectorAll('.shi-node-row.on').forEach((el) => el.classList.remove('on'))
  if (!selectedNode) return true
  const letter = letterOf(selectedNode.map, selectedNode.cell)
  pane
    .querySelector(`[data-shi-map="${selectedNode.map}"][data-shi-spot="${CSS.escape(letter)}"]`)
    ?.classList.add('on')
  const row = pane.querySelector(`[data-shi-node="${selectedNode.map}:${selectedNode.cell}"]`)
  if (row instanceof HTMLElement) {
    row.classList.add('on')
    const group = row.closest('details')
    if (group) group.open = true
    const scroller = row.closest('.shi-node-list')
    if (scroller instanceof HTMLElement) {
      const rowRect = row.getBoundingClientRect()
      const box = scroller.getBoundingClientRect()
      if (rowRect.top < box.top) scroller.scrollTop -= box.top - rowRect.top
      else if (rowRect.bottom > box.bottom) scroller.scrollTop += rowRect.bottom - box.bottom
    }
  }
  return true
}

const selectNode = async (map: number, cell: number) => {
  const key = `${map}:${cell}`
  selectedNode = { map, cell }
  selectedNodeReport = null
  nodeLoadFailed = false
  nodeLoadingKey = key
  // 点选只补丁详情/高亮。整页 render 会把海图和列表拆掉重建，框就会闪并被撑高。
  paintNodeSelection()
  try {
    const report = await queryNodeHistory(map, cell, 200)
    if (nodeLoadingKey !== key) return
    selectedNodeReport = report
  } catch (error) {
    console.warn('[kanso] 回顾节点记录读取失败', map, cell, error)
    if (nodeLoadingKey === key) nodeLoadFailed = true
  } finally {
    if (nodeLoadingKey === key) nodeLoadingKey = ''
    paintNodeSelection()
  }
}

const battleDrawerTitle = (battle: BattleSnapshot): string =>
  battle.practice
    ? `演习 · ${battle.rank ?? '未记录评价'}`
    : `${mapCode(battle.map)} · ${
        battle.isBoss ? 'Boss' : `${letterOf(battle.map, battle.cell)} 点`
      } · ${battle.rank ?? '未记录评价'}`

const openReviewBattle = async (id: number) => {
  if (!Number.isFinite(id) || id <= 0) return
  const generation = ++battleLoadGeneration
  selectedBattle = null
  selectedBattleLoadingId = id
  selectedBattleError = ''
  render()
  try {
    const snapshot = await queryBattleSnapshot(id)
    if (generation !== battleLoadGeneration) return
    if (snapshot) selectedBattle = snapshot
    else selectedBattleError = '这场战斗的记录已清理'
  } catch (error) {
    if (generation !== battleLoadGeneration) return
    selectedBattleError = '战斗记录读取失败'
    console.warn('[kanso] 回顾战斗快照读取失败', id, error)
  } finally {
    if (generation !== battleLoadGeneration) return
    selectedBattleLoadingId = 0
    render()
  }
}

const closeReviewBattle = () => {
  battleLoadGeneration += 1
  selectedBattle = null
  selectedBattleLoadingId = 0
  selectedBattleError = ''
  render()
}

// 复盘详情的常驻宿主（鉴的 rosterHost 同款）。镝把「pin 住的阶段 / 展开的舰行 /
// 流水展开」按宿主元素存在 WeakMap 里（di 的 battlePaneStates），每次 render 现建一个
// div 就等于每次被动刷新都换一个主人：状态归零，battleExpansionIdentity 还会再 clear 一遍。
// 元素常驻、每次渲染接回去，那份视图状态才跨得过资源/舰船补丁引发的重渲染。
const battleDetailHost = document.createElement('div')
battleDetailHost.className = 'shi-battle-detail mod-di'
battleDetailHost.setAttribute('data-shi-battle-detail', '')

const battleDrawerHtml = (): string => {
  if (!selectedBattle && !selectedBattleLoadingId && !selectedBattleError) return ''
  const title = selectedBattle
    ? battleDrawerTitle(selectedBattle)
    : selectedBattleLoadingId
      ? `战斗记录 #${selectedBattleLoadingId}`
      : '战斗复盘'
  // 有快照时详情由常驻宿主填（render 里 appendChild 回来），这里只留占位/失败文案。
  const body = selectedBattle
    ? ''
    : `<div class="shi-battle-placeholder">${esc(
        selectedBattleError || '正在读取这场战斗的本地记录……',
      )}</div>`
  return `<aside class="shi-battle-drawer">
    <header><div><b>${esc(title)}</b><span>回顾内复盘</span></div>
      <button data-shi-battle-close title="关闭战斗详情">✕</button></header>
    ${body}
  </aside>`
}

const render = () => {
  if (!pane) return
  const enter = enterNextView
  enterNextView = false
  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const committed = commitPaneHtml(
    pane,
    'shi',
    `<div class="shi-app${selectedBattle || selectedBattleLoadingId || selectedBattleError ? ' battle-open' : ''}">
      <header class="shi-head"><div><b>回顾</b></div>${viewTabsHtml()}</header>
      <div class="shi-stage"><main class="shi-body">${bodyHtml()}</main>${battleDrawerHtml()}</div>
      <footer class="shi-foot">${lastRefresh ? `同步于 ${fmtTime(lastRefresh)}` : '等待读取'}</footer>
    </div>`,
    () => {
      // 宿主必须在这个回调**内部**接回：还原紧跟回调之后跑，那时它若还没回到树上，
      // 滚动/展开态就找不到落点（鉴踩过一次：正看着详情，游戏一加载就被拽回顶部）。
      if (selectedBattle) {
        const detail = battleDetailHost
        pane.querySelector<HTMLElement>('.shi-battle-drawer')?.appendChild(detail)
        renderBattleReplayDetail(detail, selectedBattle)
      }
    },
  )
  // 复盘宿主的内容不在史生成的 HTML 里（它是持久节点），跳过整块重建时也得让它自己跟上
  if (!committed) {
    if (selectedBattle) renderBattleReplayDetail(battleDetailHost, selectedBattle)
    return
  }
  if (enter) pane.querySelector<HTMLElement>('.shi-view')?.classList.add('enter')
}

const refresh = async () => {
  const generation = ++refreshGeneration
  const now = Date.now()
  // 「全部」档（rangeDays = 0）没有固定起点：传 0 让账本从最早一条给起，
  // 第一天是哪天要等它把 since 回来才知道（下面 dailyMaterials 那一行）。
  const materialSince = rangeDays ? rangeStart(now) : 0
  loading = !lastRefresh
  if (loading) render()
  // 操作事件账本只有「道具」视图的原因栏读得到，其余视图连着拉是纯浪费
  // （全量、数 MB 起，还得跨进程序列化），而 refresh 是出击中高频键触发的。
  // 在这个视图上时每次 refresh 都跟着更新；离开就不再拉，手上那份留着不删——
  // 下次回来先按旧的显示，新的到了再静默换上。
  const wantActions = activeView === 'items'
  // 账本查询失败不再被下层吞成空数组：读不出来就说读不出来，
  // 否则整页会摆出一堆「还没有记录」，把故障说成事实。
  let rows
  try {
    rows = await Promise.all([
      queryDailyMaterialHistory(materialSince, now),
      queryBattleSnapshots(500),
      queryNodeHistoryIndex(600),
      queryEventArchives(),
      queryFactoryStats(now - 90 * DAY_MS),
      queryUseitemSummary(0),
      queryRecentUseitemChanges(240),
      wantActions ? queryActionEvents(now - 90 * DAY_MS, now) : Promise.resolve(null),
      queryMasterRaw(),
      queryLode('poi-fcd-map').catch(() => null),
      queryPayLog(),
    ])
  } catch (error) {
    if (generation !== refreshGeneration) return
    console.warn('[kanso] 回顾数据读取失败', error)
    loadFailed = true
    loading = false
    render()
    return
  }
  if (generation !== refreshGeneration) return
  loadFailed = false
  const [materials, snapshots, nodes, archives, factory, summaries, changes, actions, master, fcd, payRows] = rows
  // 起点用账本回来的那一个，不在这里另算：「全部」档的第一天由账本最早一条定，
  // 而它必须与主进程查日初基线用的是同一个数。一条记录都没有就只画今天这一格。
  const start = materials.since ?? localDayStart(now)
  dailyMaterials = buildDailyMaterials(materials.rows, start, now, mg.materials)
  battles = snapshots
  nodeIndex = nodes
  eventArchives = archives as EventArchive[]
  factoryStats = factory
  useitemSummary = summaries as UseitemSummary[]
  if (selectedItemId && !useitemSummary.some((row) => row.id === selectedItemId)) selectedItemId = 0
  itemChanges = changes
  if (actions) {
    actionEvents = actions.events
    actionEarliest = actions.earliest
    actionEventsLoaded = true
  }
  fcdMapData = fcd?.data ?? null
  // 选中的日卡还在不在，判据必须跟日卡自己的分组同一把尺（演习＝JST 日）
  if (selectedPracticeDay != null && !battles.some((row) => row.practice && jstDayStart(row.ts) === selectedPracticeDay)) {
    selectedPracticeDay = null
  }
  if (selectedNodeMap != null && !nodeIndex.some((node) => node.map === selectedNodeMap)) {
    selectedNodeMap = null
  }
  if (selectedResourceDay != null && !dailyMaterials.some((day) => day.start === selectedResourceDay)) {
    selectedResourceDay = null
  }
  payLog = payRows as PayLogRow[]
  // 下面五张派生表只随主数据变。queryMasterRaw 在 kernel 里是模块级缓存，
  // start2 更新（invalidateMasterRaw）之前一直是同一个对象——身份没变就不必把
  // ~1600 项舰船/道具再 filter/map 一遍，而 refresh 是高频键触发的。
  if (master !== masterDerivedFrom) {
    masterDerivedFrom = master
    // 补记表单的商品目录（主数据 api_mst_payitem，32 件，含点数定价）
    payitemCatalog = (master?.data?.api_mst_payitem ?? [])
      .filter((item: any) => Number(item?.api_id) > 0 && `${item?.api_name ?? ''}`.trim())
      .map((item: any) => ({
        id: Number(item.api_id),
        name: `${item.api_name}`.trim(),
        price: Number.isFinite(Number(item.api_price)) && Number(item.api_price) > 0 ? Number(item.api_price) : null,
      }))
    useitemNames = new Map(
      (master?.data?.api_mst_useitem ?? [])
        .filter((item: any) => Number(item?.api_id) > 0)
        .map((item: any) => [Number(item.api_id), `${item.api_name ?? `道具 #${item.api_id}`}`]),
    )
    // 课金道具多与 useitem 同名（母港拡張=53），按名字反查即可复用道具图标管线
    useitemIdByName = new Map([...useitemNames].map(([id, name]) => [name, id]))
    shipNames = new Map(
      (master?.data?.api_mst_ship ?? [])
        .filter((ship: any) => Number(ship?.api_id) > 0)
        .map((ship: any) => [Number(ship.api_id), `${ship.api_name ?? `#${ship.api_id}`}`]),
    )
    mapAreaNames = new Map(
      (master?.data?.api_mst_maparea ?? [])
        .filter((area: any) => Number(area?.api_id) > 0)
        .map((area: any) => [Number(area.api_id), `${area.api_name ?? `海域区 ${area.api_id}`}`]),
    )
  }
  loading = false
  lastRefresh = Date.now()
  render()
}

const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void refresh(), 450)
}

registerModule({
  id: 'shi',
  title: '回顾',
  order: 3.5,
  mount(element) {
    pane = element
    new ResizeObserver(() => pane.classList.toggle('narrow', pane.clientWidth < 700)).observe(pane)
    pane.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-shi-battle-close]')) {
        closeReviewBattle()
        return
      }
      const battleDetail = target.closest<HTMLElement>('[data-shi-battle-detail]')
      if (
        battleDetail &&
        selectedBattle &&
        // 航迹上点另一场：就地在抽屉里换成那一场，不走镝的 openBattleSnapshot
        // （那条路自己会把工作区切去镝，抽屉本来就是为了「不切模块看复盘」
        // 才有的）。换片走史自己的既有通道 openReviewBattle：同一套代号
        // 防串档 + 读失败在抽屉里如实说。
        handleBattleReplayDetailClick(battleDetail, selectedBattle, target, {
          openSnapshot: (id) => void openReviewBattle(id),
        })
      ) {
        return
      }
      const battleLink = target.closest<HTMLElement>(
        '.el[data-etype="battle"][data-ectx="shi"]',
      )
      if (battleLink) {
        event.preventDefault()
        event.stopPropagation()
        void openReviewBattle(Number(battleLink.dataset.eid))
        return
      }
      if (target.closest('.el')) return
      const view = target.closest<HTMLElement>('[data-shi-view]')
      if (view) {
        activeView = view.dataset.shiView as ReviewView
        uiSet('shi.view', activeView)
        enterNextView = true
        render()
        // 「道具」的原因栏要事件账本，而那份只在这个视图上才拉：进来补一次
        // （走去抖，免得连点标签连发查询；进场动画也能跑完）。
        if (activeView === 'items') scheduleRefresh()
        return
      }
      const range = target.closest<HTMLElement>('[data-shi-range]')
      if (range) {
        // `|| 30` 不能用：「全部」这一档的值就是 0，会被当成没填而弹回 30 日
        rangeDays = clampRangeDays(range.dataset.shiRange)
        uiSet('shi.rangeDays', rangeDays)
        void refresh()
        return
      }
      if (target.closest('[data-shi-retry]')) {
        loadFailed = false
        lastRefresh = 0
        void refresh()
        return
      }
      // ---- 本机氪金记录：补记表单与两段式删除 ----
      if (target.closest('[data-shi-pay-add]')) {
        payFormOpen = !payFormOpen
        payFormError = ''
        if (payFormOpen) {
          payForm = { itemId: payitemCatalog[0]?.id ?? 0, count: 1, date: fmtDate(Date.now()) }
        }
        render()
        return
      }
      if (target.closest('[data-shi-pay-cancel]')) {
        payFormOpen = false
        payFormError = ''
        render()
        return
      }
      if (target.closest('[data-shi-pay-submit]')) {
        const item = payitemCatalog.find((entry) => entry.id === payForm.itemId)
        const ts = payFormTs(payForm.date)
        const count = Math.floor(payForm.count)
        // 失败要说失败：以前不看返回值就关表单刷新，被主进程退回的那笔
        // 在表里根本不出现，看着像「记上了又自己没了」。
        const reject = payFormReject(item, ts, count)
        if (reject || !item) {
          payFormError = reject || '先选一件道具'
          render()
          return
        }
        void addManualPayLog({
          ts,
          itemId: item.id,
          name: item.name,
          count,
          price: item.price,
        })
          .then((id) => {
            if (id == null) {
              payFormError = '日期或数量超出允许范围'
              render()
              return
            }
            payFormOpen = false
            payFormError = ''
            void refresh()
          })
          .catch((error) => {
            console.warn('[kanso] 回顾补记氪金失败', error)
            payFormError = '写入失败'
            render()
          })
        return
      }
      const payDel = target.closest<HTMLElement>('[data-shi-pay-del]')
      if (payDel) {
        const id = Number(payDel.dataset.shiPayDel)
        if (payDelArmId !== id) {
          payDelArmId = id
          payDelError = '' // 上一次的失败提示别挂在这次操作旁边
          render()
          return
        }
        payDelArmId = 0
        payDelError = ''
        // 删不掉也要说：主进程对自动行与不存在的 id 一律返回 false，
        // 不看返回值就刷新的话，那行原地不动，看着像点了没反应。
        void removeManualPayLog(id)
          .then((ok) => {
            if (!ok) payDelError = '只有补记行可删'
            void refresh()
          })
          .catch((error) => {
            console.warn('[kanso] 回顾删除补记失败', error)
            payDelError = '删除失败'
            render()
          })
        return
      }
      const resource = target.closest<HTMLElement>('[data-shi-resource]')
      if (resource) {
        selectedResource = Number(resource.dataset.shiResource) || 0
        uiSet('shi.resource', selectedResource)
        render()
        return
      }
      const resourceDay = target.closest<HTMLElement>('[data-shi-resource-day]')
      if (resourceDay) {
        const day = Number(resourceDay.dataset.shiResourceDay)
        selectedResourceDay = selectedResourceDay === day ? null : day
        render()
        return
      }
      const practiceDay = target.closest<HTMLElement>('[data-shi-practice-day]')
      if (practiceDay) {
        const day = Number(practiceDay.dataset.shiPracticeDay)
        selectedPracticeDay = day > 0 ? day : null
        render()
        return
      }
      const practiceSession = target.closest<HTMLElement>('[data-shi-practice-session]')
      if (practiceSession) {
        const session = practiceSession.dataset.shiPracticeSession
        selectedPracticeSession = session === 'morning' || session === 'evening' ? session : null
        render()
        return
      }
      const nodeMap = target.closest<HTMLElement>('[data-shi-node-map]')
      if (nodeMap) {
        const map = Number(nodeMap.dataset.shiNodeMap)
        selectedNodeMap = map > 0 ? map : null
        render()
        return
      }
      const mapSpot = target.closest<HTMLElement>('[data-shi-spot]')
      if (mapSpot) {
        const map = Number(mapSpot.dataset.shiMap)
        const letter = mapSpot.dataset.shiSpot ?? ''
        const cell = map > 0 && letter ? pickCellForSpot(map, letter) : null
        if (cell != null) void selectNode(map, cell)
        return
      }
      // 纯前端展开：手上的数据一个字都没变，不再查一次账本
      const factoryMore = target.closest<HTMLElement>('[data-factory-more]')
      if (factoryMore) {
        const key = factoryMore.dataset.factoryMore ?? ''
        if (factoryOpenRecipes.has(key)) factoryOpenRecipes.delete(key)
        else factoryOpenRecipes.add(key)
        render()
        return
      }
      if (target.closest('[data-factory-list-more]')) {
        if (factoryOpenLists.has(factoryKind)) factoryOpenLists.delete(factoryKind)
        else factoryOpenLists.add(factoryKind)
        render()
        return
      }
      const factory = target.closest<HTMLElement>('[data-factory-kind]')
      if (factory) {
        const kind = factory.dataset.factoryKind as 'ship' | 'item'
        if (['ship', 'item'].includes(kind) && kind !== factoryKind) {
          factoryKind = kind
          render()
        }
        return
      }
      if (target.closest('[data-open-resource-chart]')) {
        void openResourceTrendWindow()
        return
      }
      const node = target.closest<HTMLElement>('[data-shi-node]')
      if (node) {
        const [map, cell] = `${node.dataset.shiNode}`.split(':').map(Number)
        if (map > 0 && cell >= 0) void selectNode(map, cell)
        return
      }
      if (target.closest('[data-shi-hide-furniture]')) {
        hideFurnitureBox = !hideFurnitureBox
        uiSet('shi.hideFurnitureBox', hideFurnitureBox)
        // 选中的那件正要被藏起来：连选择一起撤，别留一个指向看不见的行的筛选
        if (hideFurnitureBox && selectedItemId && isFurnitureBoxId(selectedItemId, useitemNames)) {
          selectedItemId = 0
          uiSet('shi.itemId', 0)
        }
        render()
        return
      }
      const item = target.closest<HTMLElement>('[data-shi-item]')
      if (item) {
        selectedItemId = Math.max(0, Number(item.dataset.shiItem) || 0)
        uiSet('shi.itemId', selectedItemId)
        render()
      }
    })
    // 补记表单值随打随存进模块变量：mg 补丁触发的重渲染会重建 DOM，
    // 不存的话玩家输入到一半的内容会被冲掉
    pane.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      if (target.matches('[data-shi-pay-item]')) payForm.itemId = Number(target.value) || 0
      else if (target.matches('[data-shi-pay-count]')) {
        payForm.count = Math.max(1, Math.min(99, Math.floor(Number(target.value)) || 1))
      } else if (target.matches('[data-shi-pay-date]')) payForm.date = target.value
    })
    onMgChange((keys) => {
      if (
        keys.some((key) =>
          ['materials', 'useitems', 'sortie', 'eventAreas', 'master', 'kdocks', 'slotitems', 'ships', 'record', 'payitems'].includes(key),
        )
      ) {
        // 一次 refresh 是 9 个账本查询 + 整页 innerHTML 重建。出击中 materials/ships
        // 频繁变化，浮层根本没打开也全套跑一遍是纯浪费——不可见就攒脏标记，
        // 打开时（onShow）一次补上。（ji/qa/du 同款守卫，这里曾是唯一漏网）
        // 用户正按在这块面板上就让到抬起之后（按下与抬起之间换掉 DOM，click 不会发生）
        // 正在用输入法打字也让路：换掉 DOM 会把组合会话一起换没
        if (pane.classList.contains('active')) {
          if (
            !deferWhilePressed(pane, 'shi', scheduleRefresh) &&
            !deferWhileComposing(pane, 'shi', scheduleRefresh)
          ) {
            scheduleRefresh()
          }
        } else refreshPending = true
      }
    })
    void ensureFirstEncounters()
    onFirstEncountersChange(() => {
      if (pane.classList.contains('active')) render()
      else refreshPending = true
    })
    render()
    void refresh()
  },
  onShow() {
    if (refreshPending || Date.now() - lastRefresh > 30000) {
      refreshPending = false
      scheduleRefresh()
    }
  },
})
