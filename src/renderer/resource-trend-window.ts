// 独立资源趋势窗口：只读取铭的本地账本，不创建游戏 webview，也不依赖锱模块保持打开。
import type { MaterialRow } from '../shared/mg-types'

import {
  esc,
  fmtK,
  fmtTime,
  initKernel,
  initUiZoom,
  mg,
  onMgChange,
  queryActionEvents,
  queryMaterialHistory,
  uiGet,
  uiSet,
} from './kernel'
import {
  activeEventAreaOf,
  naturalRegenCap,
  prepareMaterialHistory,
} from '../shared/material-history'
import { entityTermHtml } from './localization'

const RANGES: [string, number][] = [
  ['24h', 24 * 3600 * 1000],
  ['7日', 7 * 24 * 3600 * 1000],
  ['30日', 30 * 24 * 3600 * 1000],
  ['90日', 90 * 24 * 3600 * 1000],
]

const SERIES = [
  { idx: 0, id: 'l-fuel', label: '燃料', color: 'var(--r-fuel)', axis: 'left' },
  { idx: 1, id: 'l-ammo', label: '弹药', color: 'var(--r-ammo)', axis: 'left' },
  { idx: 2, id: 'l-steel', label: '钢材', color: 'var(--r-steel)', axis: 'left' },
  { idx: 3, id: 'l-baux', label: '铝土', color: 'var(--r-baux)', axis: 'left' },
  { idx: 5, id: 'l-bucket', label: '桶', color: '#7ac9b8', axis: 'right' },
] as const

const ACTION_MARKERS: Record<string, { label: string; glyph: string }> = {
  '/kcsapi/api_req_map/start': { label: '出击', glyph: '击' },
  '/kcsapi/api_req_mission/result': { label: '远征归来', glyph: '远' },
  '/kcsapi/api_req_quest/clearitemget': { label: '任务领取', glyph: '任' },
  '/kcsapi/api_req_nyukyo/start': { label: '入渠', glyph: '渠' },
  '/kcsapi/api_req_kousyou/createship': { label: '建造', glyph: '建' },
  '/kcsapi/api_req_kousyou/createitem': { label: '开发', glyph: '开' },
  '/kcsapi/api_req_kousyou/remodel_slot': { label: '改修', glyph: '改' },
}

const root = document.querySelector<HTMLElement>('#trend-root')!
let rangeIdx = Math.max(0, Math.min(RANGES.length - 1, uiGet<number>('zi.trendRange', 1)))
const disabled = new Set(uiGet<string[]>('zi.trendDisabled', []))
let history: MaterialRow[] = []
let historyWindowStart = 0
let historyWindowEnd = 0
let historyHasBaseline = false
let historyObservedStart: number | null = null
let chartEvents: { ts: number; path: string }[] = []
let activityAreaId = 0
// 悬停读数与拖选区间（审计 C3 的后两样）。都只影响显示，不碰账本。
let hoverTs: number | null = null
let dragFrom: number | null = null
let selection: { from: number; to: number } | null = null
let generation = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const niceMax = (value: number) => {
  if (value <= 0) return 100
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const multiplier of [1, 2, 5, 10]) {
    if (value <= multiplier * magnitude) return multiplier * magnitude
  }
  return 10 * magnitude
}

// fmtK 走 kernel 的单一出处（这个窗口本来就依赖 kernel：initKernel/mg/onMgChange
// 都从那儿来），曲线取数与活动区判据走 shared/material-history——
// 与锱同一份，免得两个界面对同一段时间给不同答案。
const prepareHistory = (rows: MaterialRow[], startTs: number, endTs: number) =>
  prepareMaterialHistory(rows, startTs, endTs, mg.lastPortTs ?? 0)

const activeEventArea = () => activeEventAreaOf(mg.eventAreas)

// 图表的横轴换算存一份给鼠标用：SVG 里是 viewBox 坐标，事件给的是 client 坐标。
// 不在 render 里现算，是因为量程随筛选变，两处各算一遍必然会错开。
let axis: { X0: number; X1: number; t0: number; t1: number } | null = null
// 画布几何：准星与选区就地挪位时要用，量程随筛选变，只在 chartHtml 里算一次
let geometry: { X0: number; X1: number; Y0: number; t0: number; t1: number } | null = null

/** 某时刻最近的一条记录（曲线是阶梯状的，取「不晚于该时刻的最后一条」才对） */
const rowAt = (ts: number): MaterialRow | null => {
  if (!history.length) return null
  let found: MaterialRow | null = null
  for (const row of history) {
    if (row.ts > ts) break
    found = row
  }
  return found ?? history[0]
}

const chartHtml = () => {
  if (history.length < 2) {
    return '<div class="chart-empty">记录不足，暂不能画</div>'
  }
  const X0 = 40
  const X1 = 600
  const Y0 = 220
  const gridY = [66, 143, 220]
  const t0 = historyWindowStart
  const t1 = historyWindowEnd
  const tx = (ts: number) => (t1 === t0 ? X0 : X0 + ((ts - t0) / (t1 - t0)) * (X1 - X0))
  axis = { X0, X1, t0, t1 }
  const leftEnabled = SERIES.filter((series) => series.axis === 'left' && !disabled.has(series.id))
  const rightEnabled = SERIES.filter((series) => series.axis === 'right' && !disabled.has(series.id))
  const leftMax = niceMax(Math.max(1, ...leftEnabled.flatMap((series) => history.map((row) => row.values[series.idx]))))
  const rightMax = niceMax(Math.max(1, ...rightEnabled.flatMap((series) => history.map((row) => row.values[series.idx]))))
  const yOf = (value: number, max: number) => Y0 - (value / max) * (Y0 - 66)

  const sampleSeries = (idx: number, maxPoints = 240): MaterialRow[] => {
    if (history.length <= maxPoints) return history
    const inner = history.slice(1, -1)
    const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2))
    const sampled: MaterialRow[] = [history[0]]
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const rows = inner.slice(
        Math.floor((bucket * inner.length) / bucketCount),
        Math.floor(((bucket + 1) * inner.length) / bucketCount),
      )
      if (!rows.length) continue
      let min = rows[0]
      let max = rows[0]
      for (const row of rows.slice(1)) {
        if (row.values[idx] < min.values[idx]) min = row
        if (row.values[idx] > max.values[idx]) max = row
      }
      sampled.push(...(min === max ? [min] : [min, max].sort((a, b) => a.ts - b.ts)))
    }
    sampled.push(history.at(-1)!)
    return sampled
  }

  const lines = SERIES.filter((series) => !disabled.has(series.id))
    .map((series) => {
      const max = series.axis === 'left' ? leftMax : rightMax
      const sampled = sampleSeries(series.idx)
      const points: string[] = []
      sampled.forEach((row, index) => {
        const x = tx(row.ts).toFixed(1)
        const y = yOf(row.values[series.idx], max).toFixed(1)
        if (index > 0) {
          const previousY = yOf(sampled[index - 1].values[series.idx], max).toFixed(1)
          points.push(`${x},${previousY}`)
        }
        points.push(`${x},${y}`)
      })
      return `<polyline id="${series.id}" class="res" stroke="${series.color}"${series.axis === 'right' ? ' stroke-dasharray="5 3"' : ''} points="${points}"/>`
    })
    .join('')

  const regenCap = naturalRegenCap(mg.basic?.level)
  const capLine =
    regenCap != null && regenCap <= leftMax
      ? `<line class="capline" x1="${X0}" y1="${yOf(regenCap, leftMax)}" x2="${X1}" y2="${yOf(regenCap, leftMax)}"/>
         <text class="axis" x="${X1 - 2}" y="${yOf(regenCap, leftMax) - 4}" text-anchor="end" fill="#efab30">自然回复线 ${regenCap.toLocaleString()}（Lv${mg.basic?.level}）</text>`
      : ''

  const isDay = t1 - t0 <= 26 * 3600 * 1000
  const fmtTick = (ts: number) => {
    const date = new Date(ts)
    const pad = (value: number) => `${value}`.padStart(2, '0')
    return isDay
      ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
      : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  const activityPeriod = activityAreaId ? mg.eventAreas[activityAreaId] : null
  const eventBand =
    activityPeriod && activityPeriod.firstSeenTs <= t1
      ? `<rect class="event-band" x="${Math.max(X0, tx(activityPeriod.firstSeenTs)).toFixed(1)}" y="40"
          width="${Math.max(0, X1 - Math.max(X0, tx(activityPeriod.firstSeenTs))).toFixed(1)}" height="${Y0 - 40}">
          <title>第 ${activityAreaId} 活动区统计区间 · 自 ${esc(fmtTime(activityPeriod.firstSeenTs))} 起</title>
        </rect>
        <line class="event-start" x1="${Math.max(X0, tx(activityPeriod.firstSeenTs)).toFixed(1)}" y1="40"
          x2="${Math.max(X0, tx(activityPeriod.firstSeenTs)).toFixed(1)}" y2="${Y0}"/>`
      : ''

  // 高频操作按约 20px 的时间桶聚合，独立大窗也不会被海量点位塞满。
  const markerBuckets = new Map<number, { ts: number[]; paths: string[] }>()
  for (const event of chartEvents) {
    if (event.ts < t0 || event.ts > t1 || !ACTION_MARKERS[event.path]) continue
    const bucket = Math.max(0, Math.min(27, Math.floor((tx(event.ts) - X0) / 20)))
    const group = markerBuckets.get(bucket) ?? { ts: [], paths: [] }
    group.ts.push(event.ts)
    group.paths.push(event.path)
    markerBuckets.set(bucket, group)
  }
  const eventMarkers = [...markerBuckets.values()].map((group) => {
    const counts = new Map<string, number>()
    for (const path of group.paths) counts.set(path, (counts.get(path) ?? 0) + 1)
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const x = group.ts.reduce((sum, ts) => sum + tx(ts), 0) / group.ts.length
    const total = group.paths.length
    const glyph = total === 1 ? ACTION_MARKERS[ordered[0][0]].glyph : total > 9 ? '9+' : `${total}`
    const detail = ordered.map(([path, count]) => `${ACTION_MARKERS[path].label} ×${count}`).join(' · ')
    return `<g class="chart-op">
      <line x1="${x.toFixed(1)}" y1="61" x2="${x.toFixed(1)}" y2="${Y0}"/>
      <circle cx="${x.toFixed(1)}" cy="54" r="7"/><text x="${x.toFixed(1)}" y="57" text-anchor="middle">${glyph}</text>
      <title>${esc(fmtTime(Math.min(...group.ts)))} · ${esc(detail)}</title>
    </g>`
  }).join('')

  // 准星与选区的节点先摆好、默认隐藏，之后由 paintPointer 就地挪位。
  // **不能在 mousemove 里重画整张图**：那会把 SVG 节点换掉，拖动到一半
  // 浏览器追踪的元素就没了，而且每动一下鼠标全量重建 DOM 也顶不住。
  const overlay = `<rect class="sel-band" x="0" y="40" width="0" height="${Y0 - 40}" hidden/>
    <line class="sel-edge" data-edge="from" x1="0" y1="40" x2="0" y2="${Y0}" hidden/>
    <line class="sel-edge" data-edge="to" x1="0" y1="40" x2="0" y2="${Y0}" hidden/>
    <line class="hover-line" x1="0" y1="40" x2="0" y2="${Y0}" hidden/>
    <g class="hover-dots">${SERIES.filter((series) => !disabled.has(series.id))
      .map(
        (series) =>
          `<circle class="hover-dot" data-series="${series.id}" data-idx="${series.idx}"
            data-max="${series.axis === 'left' ? leftMax : rightMax}" cx="0" cy="0" r="3"
            fill="${series.color}" hidden/>`,
      )
      .join('')}</g>`
  // 画布几何交给 paintPointer 用，省得两处各算一遍量程
  geometry = { X0, X1, Y0, t0, t1 }

  return `<svg class="chart" viewBox="0 0 620 252">
    ${eventBand}
    ${gridY.map((y) => `<line class="gline" x1="${X0}" y1="${y}" x2="${X1}" y2="${y}"/>`).join('')}
    <text class="axis" x="34" y="69" text-anchor="end">${fmtK(leftMax)}</text>
    <text class="axis" x="34" y="146" text-anchor="end">${fmtK(leftMax / 2)}</text>
    <text class="axis" x="34" y="223" text-anchor="end">0</text>
    ${rightEnabled.length ? `<text class="axis" x="604" y="69">${fmtK(rightMax)}</text><text class="axis" x="604" y="146">${fmtK(rightMax / 2)}</text><text class="axis" x="604" y="223">0</text>` : ''}
    ${capLine}${lines}${eventMarkers}${overlay}
    <text class="axis" x="${X0}" y="236">${fmtTick(t0)}</text>
    <text class="axis" x="${(X0 + X1) / 2}" y="236" text-anchor="middle">${fmtTick((t0 + t1) / 2)}</text>
    <text class="axis" x="${X1}" y="236" text-anchor="end">${fmtTick(t1)}</text>
  </svg>`
}

// ---- 悬停读数与拖选区间（审计 C3）----

const fmtDelta = (value: number) =>
  `<b style="color:var(--${value >= 0 ? 'ok' : 'bad'})">${value >= 0 ? '+' : '−'}${Math.abs(value).toLocaleString()}</b>`

/**
 * 图表下方的读数条。三种状态：
 * 框选了一段 → 那段的净变化；只是悬停 → 该时刻各资源的余额；都没有 → 提示怎么用。
 *
 * 净变化用**区间两端的余额差**，不是把中间的收支相加——账本记的是余额快照，
 * 相加会把同一笔变动算两次。
 */
const readoutHtml = (): string => {
  if (history.length < 2) return ''
  const cells = (row: MaterialRow, base?: MaterialRow) =>
    SERIES.filter((series) => !disabled.has(series.id))
      .map((series) => {
        const value = row.values[series.idx]
        const body = base ? fmtDelta(value - base.values[series.idx]) : `<b>${value.toLocaleString()}</b>`
        return `<span class="ro-cell"><s style="background:${series.color}"></s>${esc(series.label)} ${body}</span>`
      })
      .join('')

  if (selection) {
    const from = Math.min(selection.from, selection.to)
    const to = Math.max(selection.from, selection.to)
    const start = rowAt(from)
    const end = rowAt(to)
    if (!start || !end) return ''
    const ops = chartEvents.filter((event) => event.ts >= from && event.ts <= to)
    const opCounts = new Map<string, number>()
    for (const event of ops) opCounts.set(event.path, (opCounts.get(event.path) ?? 0) + 1)
    const opText = [...opCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([path, count]) => `${ACTION_MARKERS[path].label}×${count}`)
      .join(' · ')
    const spanMin = Math.max(1, Math.round((to - from) / 60000))
    const spanText = spanMin >= 1440
      ? `${(spanMin / 1440).toFixed(1)} 天`
      : spanMin >= 60
        ? `${(spanMin / 60).toFixed(1)} 小时`
        : `${spanMin} 分钟`
    return `<div class="chart-readout sel">
      <span class="ro-k">框选 ${esc(fmtTime(from))} → ${esc(fmtTime(to))}<i>${esc(spanText)}</i></span>
      ${cells(end, start)}
      <span class="ro-ops">${opText ? esc(opText) : '这段里没有记录到操作'}</span>
      <span class="ro-x" data-clear-selection>清除框选</span>
    </div>`
  }
  if (hoverTs != null) {
    const row = rowAt(hoverTs)
    if (!row) return ''
    return `<div class="chart-readout">
      <span class="ro-k">${esc(fmtTime(row.ts))}<i>该时刻余额</i></span>${cells(row)}</div>`
  }
  return `<div class="chart-readout idle">
    <span class="ro-k">把鼠标移到图上看某一刻的余额，横向拖动框选一段看净变化。</span></div>`
}

/**
 * 鼠标 → 时间轴。SVG 用 viewBox 缩放，client 坐标要按实际渲染宽度换算回去，
 * 直接拿 offsetX 会在窗口不是 620px 宽时整体偏移。
 */
const tsAtPointer = (svg: SVGSVGElement, clientX: number): number | null => {
  if (!axis) return null
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0) return null
  const viewX = ((clientX - rect.left) / rect.width) * 620
  const ratio = (viewX - axis.X0) / (axis.X1 - axis.X0)
  return axis.t0 + Math.max(0, Math.min(1, ratio)) * (axis.t1 - axis.t0)
}

/**
 * 就地重画准星、选区与读数条。
 *
 * **不走 render()**：那会把整张 SVG 换掉，拖动到一半浏览器追踪的节点就没了
 * （实测：拖选完全不生效，因为脱离文档的节点 getBoundingClientRect 全是 0），
 * 而且每动一下鼠标全量重建 DOM 也顶不住。
 */
const paintPointer = () => {
  const svg = root.querySelector<SVGSVGElement>('svg.chart')
  if (!svg || !geometry) return
  const { X0, X1, Y0, t0, t1 } = geometry
  const tx = (ts: number) => (t1 === t0 ? X0 : X0 + ((ts - t0) / (t1 - t0)) * (X1 - X0))
  const clampX = (ts: number) => Math.max(X0, Math.min(X1, tx(ts)))
  const show = (el: Element | null, on: boolean) => el?.toggleAttribute('hidden', !on)

  const band = svg.querySelector('.sel-band')
  const edgeFrom = svg.querySelector('[data-edge="from"]')
  const edgeTo = svg.querySelector('[data-edge="to"]')
  if (selection) {
    const left = clampX(selection.from)
    const right = clampX(selection.to)
    band?.setAttribute('x', `${Math.min(left, right).toFixed(1)}`)
    band?.setAttribute('width', `${Math.abs(right - left).toFixed(1)}`)
    for (const [edge, x] of [
      [edgeFrom, left],
      [edgeTo, right],
    ] as const) {
      edge?.setAttribute('x1', `${x.toFixed(1)}`)
      edge?.setAttribute('x2', `${x.toFixed(1)}`)
    }
  }
  show(band, !!selection)
  show(edgeFrom, !!selection)
  show(edgeTo, !!selection)

  const line = svg.querySelector('.hover-line')
  const dots = [...svg.querySelectorAll<SVGCircleElement>('.hover-dot')]
  const row = hoverTs != null ? rowAt(hoverTs) : null
  if (hoverTs != null && row) {
    const x = clampX(hoverTs).toFixed(1)
    line?.setAttribute('x1', x)
    line?.setAttribute('x2', x)
    for (const dot of dots) {
      const idx = Number(dot.dataset.idx)
      const max = Number(dot.dataset.max) || 1
      dot.setAttribute('cx', x)
      dot.setAttribute('cy', `${(Y0 - (row.values[idx] / max) * (Y0 - 66)).toFixed(1)}`)
      dot.toggleAttribute('hidden', false)
    }
  } else {
    for (const dot of dots) dot.toggleAttribute('hidden', true)
  }
  show(line, hoverTs != null && !!row)

  const readout = root.querySelector('.chart-readout')
  if (readout) readout.outerHTML = readoutHtml()
  root.querySelector<HTMLElement>('[data-clear-selection]')?.addEventListener('click', () => {
    selection = null
    paintPointer()
  })
}

const wireChartPointer = () => {
  const svg = root.querySelector<SVGSVGElement>('svg.chart')
  if (!svg) return
  // 拖动小于这个像素当作点击（清除框选），否则一次误触就把整段选区盖掉
  const DRAG_MIN_PX = 4
  let downX = 0
  svg.addEventListener('mousemove', (event) => {
    const ts = tsAtPointer(svg, event.clientX)
    if (ts == null) return
    hoverTs = ts
    if (dragFrom != null) selection = { from: dragFrom, to: ts }
    paintPointer()
  })
  svg.addEventListener('mouseleave', () => {
    // 拖到图外松手的情况：保留已框选的区间，只收掉悬停态
    hoverTs = null
    dragFrom = null
    paintPointer()
  })
  svg.addEventListener('mousedown', (event) => {
    downX = event.clientX
    dragFrom = tsAtPointer(svg, event.clientX)
    event.preventDefault() // 否则会拖出浏览器的文本选中
  })
  svg.addEventListener('mouseup', (event) => {
    if (dragFrom != null && Math.abs(event.clientX - downX) < DRAG_MIN_PX) selection = null
    dragFrom = null
    paintPointer()
  })
}

const render = () => {
  const observedEnd = history.at(-1)?.ts ?? historyWindowEnd
  const observedMs = historyObservedStart == null ? 0 : Math.max(0, observedEnd - historyObservedStart)
  const fmtSpan = (ms: number) =>
    ms >= 48 * 3600 * 1000
      ? `${Math.floor(ms / (24 * 3600 * 1000))}日`
      : `${Math.max(1, Math.round(ms / 3600000))}小时`
  const rangeNote = historyHasBaseline
    ? `${RANGES[rangeIdx][0]}起始数据完整`
    : historyObservedStart != null
      ? `历史仅覆盖 ${fmtSpan(observedMs)}`
      : '暂无历史记录'
  const netFuel = history.length ? history.at(-1)!.values[0] - history[0].values[0] : null
  const netLabel = historyHasBaseline
    ? `${RANGES[rangeIdx][0]}净增`
    : `已记录 ${fmtSpan(observedMs)}净增`

  root.innerHTML = `<div class="trend-head">
      <span class="trend-title"><b>资源增减折线图</b><small>本地记录</small></span>
      <div class="range-strip">${RANGES.map(([label], index) =>
        `<button class="rchip${index === rangeIdx ? ' on' : ''}" data-range="${index}">${label}</button>`).join('')}</div>
      <div class="series-strip">${SERIES.map((series) =>
        `<button class="schip${disabled.has(series.id) ? ' off' : ''}" data-series="${series.id}">
          <s style="background:${series.color}"></s>${entityTermHtml('material', series.idx, series.label)}${series.axis === 'right' ? ' · 右轴' : ''}
        </button>`).join('')}</div>
    </div>
    <div class="trend-body"><div class="chart-card">
      <div class="chart-wrap">${chartHtml()}</div>
      ${readoutHtml()}
      <div class="chart-note">
        <span>${rangeNote}</span>
        ${netFuel != null ? `<span>${netLabel} <b style="color:var(--${netFuel >= 0 ? 'ok' : 'bad'})">${netFuel >= 0 ? '+' : ''}${fmtK(netFuel)}</b>（燃料）</span>` : ''}
        ${chartEvents.length ? '<span class="event-key"><i></i>操作标记（悬停看明细）</span>' : ''}
        ${activityAreaId ? '<span class="event-band-key"><i></i>活动统计区间</span>' : ''}
      </div>
    </div></div>`

  wireChartPointer()
  // 整块重建之后把准星/选区的位置补回去，否则切量程或切系列会把框选抹掉
  paintPointer()
  root.querySelectorAll<HTMLElement>('[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      rangeIdx = parseInt(button.dataset.range!, 10)
      uiSet('zi.trendRange', rangeIdx)
      void refresh()
    })
  })
  root.querySelectorAll<HTMLElement>('[data-series]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.series!
      if (disabled.has(id)) disabled.delete(id)
      else disabled.add(id)
      uiSet('zi.trendDisabled', [...disabled])
      render()
    })
  })
}

const refresh = async () => {
  const currentGeneration = ++generation
  const now = Date.now()
  const rangeStart = now - RANGES[rangeIdx][1]
  const active = activeEventArea()
  // 账本读失败会真的抛上来（下层不再吞成空数组）。这个窗口只有一张图，
  // 读不出来就把上一张留在屏幕上并记一笔，别画一条平坦的假曲线。
  let rows
  let actions
  try {
    ;[rows, actions] = await Promise.all([
      queryMaterialHistory(rangeStart),
      queryActionEvents(rangeStart, now),
    ])
  } catch (error) {
    console.warn('[kanso] 资源曲线读取失败', error)
    return
  }
  if (currentGeneration !== generation) return
  const prepared = prepareHistory(rows, rangeStart, now)
  history = prepared.rows
  historyWindowStart = rangeStart
  historyWindowEnd = now
  historyHasBaseline = prepared.hasBaseline
  historyObservedStart = prepared.observedStart
  chartEvents = actions.events.filter((event) => Boolean(ACTION_MARKERS[event.path]))
  activityAreaId = active?.[0] ?? 0
  render()
}

const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void refresh(), 500)
}

const start = async () => {
  initUiZoom()
  await initKernel()
  onMgChange((keys) => {
    if (keys.some((key) => ['materials', 'basic', 'eventAreas'].includes(key))) scheduleRefresh()
  })
  await refresh()
}

void start().catch((error) => {
  console.error('[kanso] resource trend window failed', error)
  root.innerHTML = '<div class="loading">无法读取资源账本，请关闭窗口后重试。</div>'
})
