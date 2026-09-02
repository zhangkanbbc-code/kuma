// 锱 (Zi) · 资源统计。按设计稿 07 实装：8 磁贴 +
// 收支分解 + 储备目标（可编辑，达成日按实测速率外推）+ 战略道具 + 活动就绪度。
// 数据边界：所持数与资源曲线为本地账本实测；
// 战略道具收支来自 useitem 差分账本，队列需求来自鉴的下一步改造反查；
// 一次性任务/活动道具不按日均捏造“补齐日期”。
import type {
  CategorySummary,
  EventSortieCostReport,
  MaterialRow,
} from '../../shared/mg-types'

import {
  EO_SENKA,
  questFixedSenka,
  senkaMonthLabel,
  senkaQuestPeriodStartedInMonth,
} from '../../shared/senka'
import type { SenkaEntry, SenkaQuestOption, SenkaSummary } from '../../shared/senka'
import { questCountsObservedFull } from '../../shared/senka-quest-book'
import { qpTaskGroups } from '../../shared/qp-types'
import type { QpState } from '../../shared/qp-types'
import { questAnnualMonth, questPeriodFromCode } from '../../shared/quest-period'
import type { QuestPeriodKind } from '../../shared/quest-period'
import { resolveUseitemStock } from '../../shared/useitem-stock'
import {
  activeEventAreaOf,
  naturalRegenCap,
  prepareMaterialHistory,
} from '../../shared/material-history'
import { addManualSenkaQuest, clearAutoBookedSenkaQuests, commitPaneHtml, deferWhileComposing, deferWhilePressed, esc, fmtDateTime, fmtK, fmtMonthDay, fmtTime, mg, onMgChange, queryLode, queryQp, querySenka, querySenkaQuestOptions, queryDeltaSummary, queryEventSortieCosts, queryMaterialHistory, queryMasterRaw, queryUseitemSummary, removeManualSenkaQuest, uiGet, uiSet } from '../kernel'
import { mapCodeOf } from '../../shared/map-id'
import { hasEventMaps } from '../../shared/event-area'
import { MATERIAL_ICON_BY_INDEX, materialIconHtml, useItemIconHtml } from '../entity-art'
import { elink, navigate, registerEntityRoute } from '../link'
import { bilingualNameHtml, entityNameHtml, entityNamePlain, entityTermHtml, entityTermTrustedHtml } from '../localization'
import { activateModule, isModuleAvailable, registerModule } from '../mu'
import { focusExpeditionsForResource } from './bi'
import { demandedUseitemIds, onUseitemDemandReady, useitemDemand } from './ji'
import { searchInManager } from './qn'

const TILE_ORDER = [0, 1, 2, 3, 5, 4, 6, 7]
const TILE_META: Record<number, { label: string; ch: string; color: string }> = {
  0: { label: '燃料', ch: '燃', color: 'var(--r-fuel)' },
  1: { label: '弹药', ch: '弹', color: 'var(--r-ammo)' },
  2: { label: '钢材', ch: '钢', color: 'var(--r-steel)' },
  3: { label: '铝土', ch: '铝', color: 'var(--r-baux)' },
  4: { label: '高速建造材', ch: '建', color: 'var(--r-build)' },
  5: { label: '高速修复材', ch: '桶', color: 'var(--r-repair)' },
  6: { label: '开发资材', ch: '开', color: 'var(--r-dev)' },
  7: { label: '改修资材', ch: '螺', color: 'var(--r-screw)' },
}
let pane: HTMLElement
let todayHistory: MaterialRow[] = [] // 本地自然日 00:00 至当前，磁贴净变化用
let todayHasBaseline = false
let rollingDayHistory: MaterialRow[] = [] // 固定近 24h，储备目标 ETA 用
let rollingDayHasBaseline = false
let deltas: CategorySummary[] = [] // 近 7 日收支分类汇总
let activityAreaId = 0
let activityHistory: MaterialRow[] = []
let activityHistoryHasBaseline = false
let activityDeltas: CategorySummary[] = []
let activitySortieCosts: EventSortieCostReport | null = null
let breakdownRes = 0 // 收支分解当前查看的资源下标（0-3）
let highlightTile: number | null = null // 从别处跳进来时高亮的磁贴（15 稿：对应磁贴高亮）
let queryTimer: ReturnType<typeof setTimeout> | null = null
let dayRolloverTimer: ReturnType<typeof setTimeout> | null = null
let refreshGeneration = 0
let loadError: string | null = null
type MaterialDeltaCue = {
  delta: number
  phase: 'active' | 'leaving'
  holdTimer: ReturnType<typeof setTimeout> | null
  removeTimer: ReturnType<typeof setTimeout> | null
}
const MATERIAL_DELTA_HOLD_MS = 2400
const MATERIAL_DELTA_FADE_MS = 420
const materialDeltaCues = new Map<number, MaterialDeltaCue>()
let materialBaseline: number[] | null = null

const queueMaterialDelta = (idx: number, delta: number) => {
  const cue = materialDeltaCues.get(idx) ?? {
    delta: 0,
    phase: 'active' as const,
    holdTimer: null,
    removeTimer: null,
  }
  if (cue.holdTimer) clearTimeout(cue.holdTimer)
  if (cue.removeTimer) clearTimeout(cue.removeTimer)
  cue.delta += delta
  cue.phase = 'active'
  cue.holdTimer = null
  cue.removeTimer = null
  if (cue.delta === 0) {
    materialDeltaCues.delete(idx)
    return
  }
  materialDeltaCues.set(idx, cue)
  cue.holdTimer = setTimeout(() => {
    if (materialDeltaCues.get(idx) !== cue) return
    cue.phase = 'leaving'
    cue.holdTimer = null
    render()
    cue.removeTimer = setTimeout(() => {
      if (materialDeltaCues.get(idx) !== cue) return
      materialDeltaCues.delete(idx)
      render()
    }, MATERIAL_DELTA_FADE_MS)
  }, MATERIAL_DELTA_HOLD_MS)
}

// 只比较已建立基线后的实时变化：首次载入/重启回灌只记基线，不冒充刚发生的收支。
const observeMaterialChanges = () => {
  const current = mg.materials
  if (!Array.isArray(current) || current.length < 8) {
    materialBaseline = null
    return
  }
  if (materialBaseline) {
    for (let idx = 0; idx < 8; idx++) {
      const before = Number(materialBaseline[idx])
      const after = Number(current[idx])
      if (Number.isFinite(before) && Number.isFinite(after) && after !== before) {
        queueMaterialDelta(idx, after - before)
      }
    }
  }
  materialBaseline = [...current]
}

// 活动区判据 / 自然回复上限 / 曲线取数：与独立资源趋势窗共用
// shared/material-history 那一份（原先两边各写一份，同一段时间两个答案）
const activeEventArea = () => activeEventAreaOf(mg.eventAreas)

const regenCap = () => naturalRegenCap(mg.basic?.level)

const normalizeDeltaCategories = (rows: CategorySummary[]): CategorySummary[] => {
  const combined = new Map<string, number[]>()
  for (const row of rows) {
    // 旧账本已经把 port 差额写成「自然回复」；显示时迁移到诚实口径，
    // 与新版写入的「母港校准」合并，避免同一来源出现两行。
    const category = row.category === '自然回复' ? '母港校准' : row.category
    const values = combined.get(category) ?? Array(8).fill(0)
    for (let index = 0; index < 8; index++) values[index] += Number(row.values[index] ?? 0)
    combined.set(category, values)
  }
  return [...combined].map(([category, values]) => ({ category, values }))
}

const prepareHistory = (rows: MaterialRow[], startTs: number, endTs: number) =>
  prepareMaterialHistory(rows, startTs, endTs, mg.lastPortTs ?? 0)

const windowDelta = (rows: MaterialRow[], hasBaseline: boolean, idx: number): number | null => {
  if (!hasBaseline || !rows.length) return null
  const first = rows[0]
  const last = rows[rows.length - 1]
  return last.values[idx] - first.values[idx]
}

// 磁贴按本地自然日统计：今日 00:00 至当前的余额净变化，不做滚动 24h 或短窗口日化。
const todayDelta = (idx: number): number | null => windowDelta(todayHistory, todayHasBaseline, idx)

// 储备目标仍按完整近 24h 速度外推，避免凌晨的短自然日窗口放大 ETA 波动。
const rollingDayRate = (idx: number): number | null => windowDelta(rollingDayHistory, rollingDayHasBaseline, idx)

const materialDeltaCueHtml = (idx: number) => {
  const cue = materialDeltaCues.get(idx)
  if (!cue || cue.delta === 0) return ''
  const positive = cue.delta > 0
  const sign = positive ? '+' : '−'
  return `<span class="live-delta ${positive ? 'up' : 'dn'}${cue.phase === 'leaving' ? ' leaving' : ''}" title="刚刚 ${sign}${Math.abs(cue.delta).toLocaleString()}">${sign}${Math.abs(cue.delta).toLocaleString()}</span>`
}

const tileHtml = (idx: number) => {
  const meta = TILE_META[idx]
  const value = mg.materials?.[idx]
  const delta = todayDelta(idx)
  let trend = delta == null
    ? '<span class="tr flat">今日记录不足</span>'
    : '<span class="tr flat">─</span>'
  if (delta != null && Math.abs(delta) >= 1) {
    trend = delta > 0 ? `<span class="tr up">▲${fmtK(Math.round(delta))}/日</span>` : `<span class="tr dn">▼${fmtK(Math.round(-delta))}/日</span>`
  }
  let status = ''
  const cap = regenCap()
  if (value != null) {
    if (idx <= 3 && cap != null) {
      status = value < cap ? '<span class="st regen">回复中</span>' : '<span class="st">超回复线</span>'
    } else if (idx === 5 && 3000 - value <= 300) {
      status = `<span class="st near">距上限 ${3000 - value}</span>`
    } else if (idx === 7 && value < 50) {
      status = '<span class="st low">低于阈值 50</span>'
    }
  }
  return `<div class="tile${highlightTile === idx ? ' hl' : ''}"><div class="h"><span class="ic" style="background:${meta.color}">${materialIconHtml(MATERIAL_ICON_BY_INDEX[idx], { title: meta.label })}</span>${entityTermHtml('material', idx, meta.label)}${materialDeltaCueHtml(idx)}</div>
    <div class="v">${value != null ? value.toLocaleString() : '—'}</div>
    <div class="s">${value != null ? trend : ''}${status}</div></div>`
}

// 收支分解卡：近 7 日按来源的进出条（设计稿 07 右栏首卡口径）
const breakdownHtml = () => {
  const resource = TILE_META[breakdownRes]
  const scope = `<div class="br-scope">当前分解：<b>${entityTermHtml('material', breakdownRes, resource.label)}</b></div>`
  const rows = deltas
    .map((d) => ({ category: d.category, value: d.values[breakdownRes] }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  if (!rows.length) {
    return `${scope}<div class="placeholder">近 7 日暂无资源变动</div>`
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value)))
  const net = rows.reduce((sum, r) => sum + r.value, 0)
  const bars = rows
    .map(
      (r) => `<div class="br-row ${r.value >= 0 ? 'in' : 'out'}"><span class="k">${esc(r.category)}</span>
        <span class="bar"><i style="width:${(Math.abs(r.value) / max) * 100}%"></i></span>
        <span class="n" title="${resource.label} ${r.value >= 0 ? '+' : '−'}${Math.abs(r.value).toLocaleString()}">${r.value >= 0 ? '+' : '−'}${Math.abs(r.value).toLocaleString()}</span></div>`,
    )
    .join('')
  return `${scope}${bars}<div class="br-net"><span>${entityTermHtml('material', breakdownRes, resource.label)} · 7 日净变化</span><b${net < 0 ? ' class="neg"' : ''}>${net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}</b></div>`
}

const BREAKDOWN_RES: [number, string, string][] = [
  [0, '燃料', 'var(--r-fuel)'],
  [1, '弹药', 'var(--r-ammo)'],
  [2, '钢材', 'var(--r-steel)'],
  [3, '铝土', 'var(--r-baux)'],
]

// ---- 活动窗口账号账 ----
//
// 当前数据可以准确回答「活动存在的这段时间里，账号资源怎样变化、哪些操作类别
// 贡献了变化」，但不能把补给/入渠自动归属到某一张活动图。因此 UI 明示为账号账，
// 不把它包装成“活动纯消耗”。活动结束后由顶栏「回顾」永久结账。
const activityLedgerHtml = (): string => {
  const period = activityAreaId ? mg.eventAreas[activityAreaId] : null
  if (!period) return ''
  const rangeDays = Math.max(1, Math.ceil((Date.now() - period.firstSeenTs) / 86400000))
  const hasNet = activityHistoryHasBaseline && activityHistory.length >= 2
  const first = activityHistory[0]
  const last = activityHistory.at(-1)
  const indices = [0, 1, 2, 3, 5]
  const net = hasNet && first && last
    ? indices.map((idx) => ({ idx, value: (last.values[idx] ?? 0) - (first.values[idx] ?? 0) }))
    : []
  const netHtml = hasNet
    ? `<div class="ev-account-net">${net.map(({ idx, value }) =>
        `<span class="${value < 0 ? 'dn' : value > 0 ? 'up' : ''}">
          ${materialIconHtml(MATERIAL_ICON_BY_INDEX[idx], { className: 'sm', title: TILE_META[idx].label })}
          <i>${value > 0 ? '+' : ''}${value === 0 ? '—' : fmtK(value)}</i>
        </span>`).join('')}</div>`
    : `<div class="placeholder">活动开始前暂无资源记录</div>`

  const categoryRows = activityDeltas
    .map((row) => ({
      ...row,
      weight: indices.reduce((sum, idx) => sum + Math.abs(row.values[idx] ?? 0), 0),
    }))
    .filter((row) => row.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((row) => {
      const values = indices
        .filter((idx) => row.values[idx])
        .map((idx) => {
          const value = row.values[idx]
          return `<span class="${value < 0 ? 'dn' : 'up'}">${TILE_META[idx].ch}${value > 0 ? '+' : ''}${fmtK(value)}</span>`
        })
        .join('')
      const category = row.category === '母港校准'
        ? '<b title="与上次已知余额的差额，含自然回复">母港校准</b>'
        : `<b>${esc(row.category)}</b>`
      return `<div class="ev-account-row">${category}<span>${values}</span></div>`
    })
    .join('')

  const sortieCostHtml = activitySortieCosts?.sorties
    ? `<div class="ev-sortie-cost">
        <div class="ev-sortie-cost-head"><b>活动出击航行消耗</b><span>已完整记录 ${activitySortieCosts.sorties} 次</span></div>
        <div class="ev-sortie-cost-total">
          <span>${materialIconHtml(MATERIAL_ICON_BY_INDEX[0], { className: 'sm', title: '燃料' })}${entityTermHtml('material', 0, '燃料')} <b>−${activitySortieCosts.fuel.toLocaleString()}</b></span>
          <span>${materialIconHtml(MATERIAL_ICON_BY_INDEX[1], { className: 'sm', title: '弹药' })}${entityTermHtml('material', 1, '弹药')} <b>−${activitySortieCosts.ammo.toLocaleString()}</b></span>
        </div>
        <div class="ev-sortie-maps">${activitySortieCosts.maps.map((row) =>
          `<span>${mapCodeOf(row.map)} · ${row.sorties} 次 · 燃−${row.fuel} 弹−${row.ammo}</span>`).join('')}</div>
        ${activitySortieCosts.skipped ? `<div class="ph2">另有 ${activitySortieCosts.skipped} 次因出发记录不完整而未计入</div>` : ''}
      </div>`
    : `<div class="ev-sortie-cost empty"><b>活动出击航行消耗</b><span>暂无完整记录的活动出击</span></div>`

  return `<div class="scard activity-ledger">
    <div class="h">活动期间账号收支<span class="aux">第 ${activityAreaId} 活动区 · ${rangeDays} 天</span></div>
    ${sortieCostHtml}
    ${netHtml}
    ${categoryRows ? `<div class="ev-account-cats">${categoryRows}</div>` : '<div class="ph2">分类收支记账中……</div>'}
    <div class="ph2">自 ${fmtTime(period.firstSeenTs)} 起
      <span class="credit-mark" title="期初期末差额，含远征、任务与日常操作">口径</span>
      ${
        isModuleAvailable('du')
          ? '<button class="ev-open-du" data-open-du>查看活动进度 →</button>'
          : '<button class="ev-open-du" disabled title="活动海域数据尚未同步，活动面板当前不可用">活动进度暂不可用</button>'
      }</div>
  </div>`
}

// ---- 储备目标（07 稿右栏）：目标额度可编辑，达成日按近 24h 实测速率外推 ----

const TARGET_ORDER = [0, 1, 2, 3, 5, 7]
const DEFAULT_TARGETS: Record<number, number> = { 0: 100000, 1: 100000, 2: 100000, 3: 50000, 5: 3000, 7: 300 }
// 硬上限（kcwiki 口径）：燃弹钢铝 35 万，桶/建造/开发/改修 3000
const HARD_CAP: Record<number, number> = { 0: 350000, 1: 350000, 2: 350000, 3: 350000, 4: 3000, 5: 3000, 6: 3000, 7: 3000 }

// 目标覆盖值只读一次盘。uiGet 是同步 remote IPC，而 getTargets 挂在 render 上、
// render 又挂在 mg:patch 的派发链（= 游戏 XHR 回调）上——出击中每场要跑好几次。
// 「游戏线程路径禁止同步 IPC」的既定纪律：读进模块变量，编辑提交时同步更新它。
const TARGETS_KEY = 'zi.targets'
let targetOverrides: Record<number, number> = uiGet<Record<number, number>>(TARGETS_KEY, {})
const getTargets = (): Record<number, number> => ({ ...DEFAULT_TARGETS, ...targetOverrides })

interface TargetStatus {
  idx: number
  current: number
  target: number
  pct: number
  done: boolean
  rate: number | null
  etaTs: number | null // 达成时刻；null = 按当前趋势到不了
  nearCap: boolean
}

const targetStatus = (idx: number, target: number): TargetStatus | null => {
  const current = mg.materials?.[idx]
  if (current == null || target <= 0) return null
  const rate = rollingDayRate(idx)
  const done = current >= target
  const cap = HARD_CAP[idx]
  const nearCap = cap != null && current >= cap * 0.95
  let etaTs: number | null = null
  if (!done && rate != null && rate > 0) etaTs = Date.now() + ((target - current) / rate) * 86400000
  return { idx, current, target, pct: Math.min(100, (current / target) * 100), done, rate, etaTs, nearCap }
}


const targetsHtml = () => {
  const targets = getTargets()
  const rows = TARGET_ORDER.map((idx) => {
    const st = targetStatus(idx, targets[idx] ?? 0)
    if (!st) return ''
    const meta = TILE_META[idx]
    let verdict: string
    if (st.done) {
      verdict = st.nearCap ? '<span class="tg-ok">已接近上限 ✓</span>' : '<span class="tg-ok">已达到目标 ✓</span>'
    } else if (st.etaTs) {
      const days = (st.etaTs - Date.now()) / 86400000
      verdict = `按 ${st.rate! > 0 ? '+' : ''}${fmtK(Math.round(st.rate!))}/日 → <b>${fmtMonthDay(st.etaTs)}</b>${days > 60 ? ' <span class="tg-warn">(远)</span>' : ''}`
    } else {
      verdict = `<span class="tg-bad">${
        st.rate == null
          ? '24h 记录不足 · 暂无法估算'
          : st.rate < 0
            ? '▼ 下降中 · 当前趋势低于目标所需'
            : '速率不足，暂无法预估'
      }</span>`
    }
    return `<div class="tg-row">
      <span class="tg-ic" style="background:${meta.color}">${meta.ch}</span>
      <span class="tg-bar"><i style="width:${st.pct}%;background:${meta.color}"></i></span>
      <span class="tg-num">${st.current.toLocaleString()} / <b class="tg-edit" data-target="${idx}" title="点击编辑目标">${st.target.toLocaleString()}</b></span>
      <span class="tg-pct">${st.pct.toFixed(1)}%</span>
      <span class="tg-eta">${verdict}${
        st.done
          ? ''
          : ` <button class="tg-exp" data-exp-resource="${idx}">找补充远征 →</button>`
      }</span>
    </div>`
  }).join('')
  return rows
}

// ---- 战略道具（07 稿）----
// 三档数据都是实测：所持（require_info 全量下发）、队列需求（鉴的改造反查，同一口径）、
// 近 30 日收支（useitem_log 差分）。
// 唯独不给「补齐预计」——战略道具靠任务/活动一次性发放，不是匀速流入，
// 拿收支除以天数外推出来的日期是编的，不如把最近一次到手的时间摆出来。

// 按主数据名匹配，不硬编 id（游戏更新只改数据不改代码）
const STRATEGIC_NAMES = [
  '改装設計図', '戦闘詳報', '試製甲板カタパルト', '新型砲熕兵装資材',
  '新型航空兵装資材', '熟練搭乗員', '勲章', '甲種勲章', 'プレゼント箱',
]
// 応急修理女神/応急修理要員是装备实例，不在 useitem 里
const GODDESS_NAMES = ['応急修理女神', '応急修理要員']

let useitemMst: { id: number; name: string }[] = []
// 大活动进行中（主数据里有活动海图）——判定在 shared/event-area.ts，铎/鉴/铭同引。
// 只随主数据变，所以跟着 queryMasterRaw 一起取。
let eventMapsPresent = false
let itemFlow = new Map<number, { gained: number; spent: number; changes: number; lastTs: number }>()

// 主数据到手：战略道具名表 + 「有没有活动海图」一起更新（两者都只随主数据变）
const applyMaster = (raw: any) => {
  useitemMst = (raw?.data?.api_mst_useitem ?? []).map((u: any) => ({ id: u.api_id, name: u.api_name }))
  eventMapsPresent = hasEventMaps(raw?.data)
}

const daysAgo = (ts: number) => {
  const d = (Date.now() - ts) / 86400000
  if (d < 1) return '今天'
  if (d < 2) return '昨天'
  return `${Math.floor(d)} 天前`
}

// 持有数的单一出处：api_mst_useitem 同时收录真实道具、四资源入口（31–34）、
// 家具币和部分装备的商店入口，裸读 mg.useitems 会在后几类上给出 0。
// 鉴的 useitemDemand 判「够不够」用的就是这份解析——这里另读一份就是同一行里
// 两套库存口径，持有数和缺口迟早说法打架。
const useitemStock = (id: number, name: string) =>
  resolveUseitemStock(id, name, {
    materials: mg.materials,
    furnitureCoins: mg.basic?.furnitureCoins,
    useitems: mg.useitems,
    useitemsTs: mg.useitemsTs,
    slotitems: mg.slotitems,
    slotitemMasters: mg.master.slotitems,
    // require_info 同时给出完整装备表与非零道具表；旧快照已有装备实例时基线也算存在
    slotitemsKnown: mg.useitemsTs != null || Object.keys(mg.slotitems).length > 0,
  })

// 显示哪些道具：固定清单（按日文名匹配主数据）+ 凡是改造要用到的（按 id，不靠手打名字）。
// 后者让游戏新增改造道具时无需改代码，也避免了日文名打错就静默消失。
const strategicIds = (): number[] => {
  const ids: number[] = []
  for (const name of STRATEGIC_NAMES) {
    const hit = useitemMst.find((u) => u.name === name)
    if (hit) ids.push(hit.id) // 该服/该版本没有此道具就不显示，不占位
  }
  const seen = new Set(ids)
  for (const id of demandedUseitemIds()) {
    if (seen.has(id)) continue
    const hit = useitemMst.find((u) => u.id === id)
    if (!hit) continue
    // ji 侧只滤掉住在 materials 里的那几个（USEITEM_MATERIAL_INDEX），装备镜像型
    // 条目漏在外面——它们的持有数住在装备实例里，下面女神那一行已按实例单列，
    // 自动扩充再列一次就是同一批东西数两遍。
    if (useitemStock(id, hit.name).source === 'slotitems') continue
    ids.push(id)
  }
  return ids
}

const strategicHtml = () => {
  if (!useitemMst.length) return '<div class="placeholder">道具数据加载中</div>'
  const rows: string[] = []
  for (const id of strategicIds()) {
    const hit = useitemMst.find((u) => u.id === id)!
    const name = hit.name
    const count = useitemStock(hit.id, name).count
    const demand = useitemDemand(hit.id)
    const flow = itemFlow.get(hit.id)

    // 队列：在籍舰下一步改造合计要用几个，够不够
    let need = ''
    if (demand?.queueNeed) {
      const gap = demand.queueNeed - count
      need =
        gap > 0
          ? `<span class="si-q bad" title="${demand.queueShips} 艘舰娘的下一步改造合计需要 ${demand.queueNeed}">队列需 ${demand.queueNeed} · 缺 ${gap}</span>`
          : `<span class="si-q ok" title="${demand.queueShips} 艘舰娘的下一步改造合计需要 ${demand.queueNeed}">队列需 ${demand.queueNeed} ✓</span>`
    }

    // 近 30 日收支：账本里真有变动才显示，没有就不占位
    let flowHtml = ''
    if (flow && flow.changes > 0) {
      const parts: string[] = []
      if (flow.gained) parts.push(`<i class="up">+${flow.gained}</i>`)
      if (flow.spent) parts.push(`<i class="dn">−${flow.spent}</i>`)
      flowHtml = `<span class="si-f" title="最近一次变动 ${fmtTime(flow.lastTs)}">${parts.join(' ')} <em>${daysAgo(flow.lastTs)}</em></span>`
    }

    rows.push(`<div class="si-row" data-useitem="${hit.id}">
      ${useItemIconHtml(hit.id, entityNamePlain('item', hit.id, name), { className: 'sm' })}
      <span class="si-nm">${entityNameHtml('item', hit.id, name, { compact: true })}</span>
      ${need}${flowHtml}
      <b class="si-n${demand && demand.queueNeed > count ? ' short' : ''}">${count}</b></div>`)
  }
  // 女神类按装备实例统计
  const goddessIds = new Set(
    Object.entries(mg.master.slotitems)
      .filter(([, m]) => GODDESS_NAMES.includes(m.name))
      .map(([id]) => +id),
  )
  if (goddessIds.size) {
    const n = Object.values(mg.slotitems).filter((s) => goddessIds.has(s.mstId)).length
    rows.push(`<div class="si-row"><span class="si-nm">${entityTermTrustedHtml('mstEquip', undefined, bilingualNameHtml('应急修理女神 / 要员', '応急修理女神 / 要員', { compact: true }))}</span><b class="si-n">${n}</b></div>`)
  }
  if (!rows.length) return '<div class="placeholder">未持有，或尚未同步</div>'
  return `${rows.join('')}${itemFlow.size ? '<div class="ph2">收支为近 30 日本地账本</div>' : ''}`
}

// ---- 活动就绪度（07 稿）：由储备目标聚合，不另设口径 ----

const readinessHtml = () => {
  const targets = getTargets()
  const list = TARGET_ORDER.map((idx) => targetStatus(idx, targets[idx] ?? 0)).filter(Boolean) as TargetStatus[]
  if (!list.length) return '<div class="placeholder">尚未同步资源数据</div>'
  const ok = list.filter((s) => s.done).length
  const pct = Math.round((ok / list.length) * 100)
  const rows = list
    .map((st) => {
      const meta = TILE_META[st.idx]
      const icon = st.done ? '<span class="rd-ic ok">✓</span>' : st.etaTs ? '<span class="rd-ic mid">◐</span>' : '<span class="rd-ic bad">⚠</span>'
      const note = st.done
        ? '达标'
        : st.etaTs
          ? `预计 ${fmtMonthDay(st.etaTs)}`
          : '趋势不利'
      return `<div class="rd-row">${icon}<span class="rd-nm">${entityTermHtml('material', st.idx, meta.label)}</span>
        <span class="rd-note">${note}</span></div>`
    })
    .join('')
  return `<div class="rd-head"><b class="rd-pct">${pct}%</b>
      <span>${ok} / ${list.length} 项储备达标${ok < list.length ? ` · 缺口 ${list.length - ok} 项` : ''}</span></div>
    ${rows}`
}

/**
 * 活动准备度卡的外壳。
 *
 * **大活动进行中就整张不出**（2026-08-21 用户拍板）：活动已经开打了，「准备得
 * 怎么样」这一问就过期了，该看的是铎里的真实消耗与海域进度。活动结束、活动海域
 * 从主数据里消失，条件自然翻转，卡回来。
 *
 * 只认**有额外海图**的大活动——秋刀魚祭那类季节企划照旧显示（铎会切到企划视图，
 * 但那不是「活动准备度」失效的理由）。上面的「储备目标」卡不受影响，它讲的是
 * 长期存货，跟活动在不在进行没关系。
 *
 * 判定与外壳分开，是为了能对着两态各跑一遍：见 test/event-area.test.mjs。
 */
const readinessCardHtml = (eventMaps: boolean, bodyHtml: () => string): string => {
  if (eventMaps) return ''
  return `<div class="scard"><div class="h">活动准备度</div>
          ${bodyHtml()}</div>`
}

let senka: SenkaSummary | null = null
// 钦的精确计数镜像。自检那张提示单只认它——「计数本周期数满了」是 kuma
// 自家的观测，与「看着已完成」那条推断链没有关系（判据见 computeQuestMisses）。
// queryQp 返回的是主进程状态的**同一个对象**，实时 patch 原地改，握着引用即可。
let qp: QpState | null = null
let senkaOpen = false
// 战果账本只存了任务编号（note），名字从任务资料库现查。
// 「任务 893」这种裸编号等于让玩家自己再去翻一遍任务列表（2026-08-12 用户点名）。
let senkaQuestNames: Map<
  number,
  {
    code: string
    name: string
    senka: number | null
    periodKind: QuestPeriodKind | null
    annualMonth: number | null
  }
> | null = null

const questSenkaLabelHtml = (note: string): string => {
  const id = Number(note) || 0
  if (!(id > 0)) return `任务 ${esc(note)}`
  const known = senkaQuestNames?.get(id)
  // 资料库没收录也照样给链接——任务管理器按编号打开不依赖资料库
  return `任务 ${elink('quest', id, known ? `${known.code}「${known.name}」` : `${id}`)}`
}

const eoSenkaLabelHtml = (note: string): string => {
  const mapId = Number(note) || 0
  return mapId > 0
    ? `EO 攻略 ${elink('map', mapId, mapCodeOf(mapId))}`
    : `EO 攻略 ${esc(note)}`
}

/**
 * 战果账。
 *
 * 游戏**不下发战果数值**，但 wikiwiki「称号・戦果」给了公式，而公式的输入
 * （提督经验）API 是给的：通常戦果 = 该月经验 × 7/10000。所以这一栏里
 * 「通常」是换算出来的，「特别」（EO 攻略）是查表来的——两者性质不同，分开列。
 *
 * **只统计开始记账之后的部分**：提督经验的历史值没有入库
 * （port 报文走的是覆盖式快照），月初到记账日之间那段补不回来。
 */
const senkaHtml = (): string => {
  if (!senka) return '<div class="scard"><div class="h">战果</div><div class="l">战果账读取中</div></div>'
  const fmt = (value: number) => (value >= 100 ? value.toFixed(0) : value.toFixed(2))
  const monthLabel = senkaMonthLabel(senka.monthStart)
  const rows = senka.entries
    .slice(0, senkaOpen ? 60 : 6)
    .map((entry) => {
      const when = new Date(entry.ts)
      const pad = (n: number) => `${n}`.padStart(2, '0')
      const label =
        entry.kind === 'exp'
          ? `提督经验 +${entry.expDelta.toLocaleString()}`
          : entry.kind === 'eo'
            ? eoSenkaLabelHtml(entry.note)
            : questSenkaLabelHtml(entry.note)
      return `<div class="senka-row">
        <span class="t">${pad(when.getMonth() + 1)}/${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}</span>
        <span class="w ${entry.kind}">${label}</span>
        <span class="v">+${fmt(entry.senka)}</span>
      </div>`
    })
    .join('')
  // 累计曲线：按时间正序把每笔叠上去。资源折线是「余量随时间」，
  // 战果是「只增不减的累计」，量纲也差几个数量级，所以单独画一条小的，
  // 不塞进资源那张图里——同图会让战果压成贴地的一条直线。
  const chart = (() => {
    const ordered = [...senka!.entries].sort((a, b) => a.ts - b.ts)
    if (ordered.length < 2) return ''
    const from = senka!.recordedFrom ?? ordered[0].ts
    const to = Math.max(Date.now(), ordered[ordered.length - 1].ts)
    const span = Math.max(1, to - from)
    let acc = 0
    const points = ordered.map((entry) => {
      acc += entry.senka
      return [((entry.ts - from) / span) * 100, acc] as const
    })
    const top = Math.max(1, acc)
    const d = points
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${(28 - (y / top) * 26).toFixed(2)}`)
      .join(' ')
    return `<svg class="senka-chart" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path d="${d}" fill="none" stroke="var(--entity-quest)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
    </svg>`
  })()
  return `<div class="scard senka-card"><div class="h">战果<span class="aux">${monthLabel} 月 · 换算自提督经验
    <span class="credit-mark" title="通常 = 该月提督经验 ×7/10000；EO 攻略按固定分值查表，与游戏排名页可能有小数差">口径</span></span><span class="senka-detail-link" data-act="senka-detail">详情</span></div>
    ${chart}
    <div class="senka-sum">
      <span class="big">${fmt(senka.calibration ? senka.calibration.current : senka.total)}</span>
      <span class="parts">${senka.carry ? `继承 ${fmt(senka.carry.total)} · ` : ''}通常 ${fmt(senka.normal)}${senka.special ? ` · 特别 ${fmt(senka.special)}` : ''}</span>
    </div>
    ${
      senka.calibration
        ? `<div class="senka-cal-tag" title="大数字 = 官方校准值 + 此后新增">已按官方值校准 ${fmtMonthDay(senka.calibration.ts)} · 基准 ${senka.calibration.value.toLocaleString()}</div>`
        : ''
    }
    ${rows || '<div class="l">本月暂无新增战果</div>'}
    ${
      senka.entries.length > 6
        ? `<div class="senka-more" data-act="senka-more">${senkaOpen ? '收起' : `展开全部 ${senka.entries.length} 笔`}</div>`
        : ''
    }
  </div>`
}

// ---- 战果详情弹窗（2026-08-17 用户要的）----
// 挂 body：底坞面板既裁 overflow 又有 transform 包含块，absolute 会被裁、
// fixed 会飞（浮层一律挂 body 的既定纪律）。
let senkaDetailEl: HTMLElement | null = null

const closeSenkaDetail = () => {
  senkaDetailEl?.remove()
  senkaDetailEl = null
}

// 周期文案：periodKind 由 shared/quest-period 在 refresh 里算好，展示层直接用。
// （曾经在展示层再按 code.charAt(1) 猜一遍——同一份数据两套规则，
// 期间限定编码 2606Bm1 那类里 questPeriodFromCode 判 null、charAt 判「月任」。）
const QUEST_PERIOD_LABEL: Record<QuestPeriodKind, string> = {
  daily: '日任',
  weekly: '周任',
  monthly: '月任',
  quarterly: '季任',
  annual: '年任',
}

/**
 * 「kuma 自己数满了、账里却暂无领取记录」的战果任务——**只提示，不入账**。
 *
 * 2026-09-01 第二次收紧（用户抓的残留）。f3543a3 把**入账**换成了硬证据，
 * 但这张提示单还是由推断填的（前置满足 + 不在任务表 = 已交付），于是他那五条
 * 从没做过的任务（284/845/854/872/893，quest_progress 一行都没有）照旧全表挂在
 * 这里。推断换个地方继续说话，还是推断。
 *
 * 现在的入场券只有一张：**钦的追踪计数在本周期真数满了**（判据在
 * shared/senka-quest-book 的 questCountsObservedFull，计数天然只属本周期——
 * quest-counter 跨重置线就把它删了）。计数没满、或一格都没有的，一个字不显示。
 *
 * 另两道门保留：
 * - 账里已有这个任务的行（观测行或手动补记行）就不列；
 * - 当前周期的起点要落在本战果月之内（判据在 shared/senka）——没有它，
 *   一个 6 月交的季任会在 7、8 两个月一直挂在这张单子上。
 */
const computeQuestMisses = (): {
  id: number
  name: string
  senka: number
  periodKind: QuestPeriodKind
}[] => {
  if (!senka || !senkaQuestNames || !qp) return []
  const logged = new Set(
    senka.entries.filter((e) => e.kind === 'quest').map((e) => Number(e.note) || 0),
  )
  return [...senkaQuestNames.entries()]
    .filter(([id, info]) => {
      if (!info.senka || logged.has(id) || !info.periodKind) return false
      const tracker = qp!.trackers[id]
      if (!tracker) return false
      const full = questCountsObservedFull({
        targets: qpTaskGroups(tracker.tasks).map(({ slot, entries }) => ({
          slot,
          target: (entries[0]?.task as { count?: number })?.count || 1,
        })),
        counts: qp!.progress[id],
        approx: tracker.approx,
        partial: tracker.partial,
        extraGoals: Boolean(tracker.stateGoal) || Boolean(tracker.stockGoals?.length),
      })
      if (!full) return false
      return senkaQuestPeriodStartedInMonth(
        info.periodKind,
        senka!.monthStart,
        Date.now(),
        info.annualMonth,
      )
    })
    // 上面的 filter 已经把 senka/periodKind 为空的挡掉了
    .map(([id, info]) => ({
      id,
      name: info.name,
      senka: info.senka!,
      periodKind: info.periodKind!,
    }))
}

// 「重算任务战果」的两步确认状态与上一次结果。只活在这一次打开的弹窗里，
// 每次开弹窗都归零——按钮不该开着「确认」态等下一次打开。
let senkaRecountArmed = false
let senkaRecountResult: string | null = null

// 手动补记（照氪金那族的形态）：选单、表单开合、失败原因、两步删除的武装行。
// 全部只活在这一次打开的弹窗里，openSenkaDetail 归零。
let senkaQuestOptions: SenkaQuestOption[] = []
let senkaAddOpen = false
let senkaAddError = ''
let senkaDelArmId = 0
let senkaDelError = ''

const SENKA_ADD_REJECT: Record<string, string> = {
  'no-senka': '任务资料库里查不到固定战果',
  'already-booked': '本期已记录',
  'no-evidence': '该笔未写入账本',
  failed: '该笔未写入账本',
}

/**
 * 本月任务战果 + 手动补记入口（2026-09-01 用户要的权利：季中才装上 kuma 的玩家，
 * 之前交过的任务账本里不可能有证据）。
 *
 * 形态照氪金记录那族的手动补记（shi 的 pay_log）：手动行带记号、只有手动行可删、
 * 删除两步确认。选单里「本期已记录」的置灰——判据由主进程给（与入账共用同一个
 * 去重窗口），选不中也就手滑不了。
 */
const questSenkaBlockHtml = (
  questRows: SenkaEntry[],
  fmt: (value: number) => string,
): string => {
  const rows = questRows
    .map(
      (entry) =>
        `<div class="sd-quest"><span>${questSenkaLabelHtml(entry.note)}${
          entry.manual ? '<i class="sd-manual" title="手动补记 · 记在本月起点">手动</i>' : ''
        }</span><b>+${fmt(entry.senka)}</b>${
          entry.manual
            ? `<button class="sd-qdel${senkaDelArmId === entry.id ? ' arm' : ''}" data-senka-qdel="${entry.id}" title="删除这条补记">${
                senkaDelArmId === entry.id ? '确认删除' : '×'
              }</button>`
            : ''
        }</div>`,
    )
    .join('')
  const options = senkaQuestOptions
    .map(
      (option) =>
        `<option value="${option.id}"${option.taken ? ' disabled' : ''}>${esc(option.code)}「${esc(
          option.name,
        )}」 +${option.senka}${option.taken ? ' · 本期已记录' : ''}</option>`,
    )
    .join('')
  const form = !senkaAddOpen
    ? ''
    : `<div class="sd-qadd">
        ${
          options
            ? `<select class="sd-qadd-pick"><option value="">选一条任务</option>${options}</select>
               <button class="sd-cal-btn" data-act="senka-quest-add">记一笔</button>`
            : '<i class="sd-pend">暂无可补记的任务</i>'
        }
        <button class="sd-cal-btn ghost" data-act="senka-quest-add-cancel">取消</button>
      </div>${senkaAddError ? `<div class="sd-note2 bad">记录失败 · 请检查：${esc(senkaAddError)}</div>` : ''}`
  return `<div class="sd-block">
    <div class="sd-h">本月任务战果
      <button class="sd-cal-btn ghost sd-qadd-open" data-act="senka-quest-add-open" title="补记一笔账外的任务战果">＋ 补记</button>
    </div>
    ${form}
    ${senkaDelError ? `<div class="sd-note2 bad">${esc(senkaDelError)}</div>` : ''}
    ${rows || '<div class="sd-note2">本月暂无任务战果</div>'}
  </div>`
}

const senkaDetailBodyHtml = (): string => {
  if (!senka) return '<p class="sd-empty">战果账暂未读出</p>'
  const fmt = (value: number) => (value >= 100 ? value.toFixed(0) : value.toFixed(2))
  const carry = senka.carry
  // EO 缺口：本月已记的图 vs 全表
  const clearedEo = new Set(
    senka.entries.filter((e) => e.kind === 'eo').map((e) => Number(e.note) || 0),
  )
  const eoCells = Object.entries(EO_SENKA)
    .map(([id, value]) => ({ id: Number(id), value }))
    .sort((a, b) => a.id - b.id)
    .map(({ id, value }) => {
      const done = clearedEo.has(id)
      return `<span class="sd-eo${done ? ' done' : ''}" title="${done ? '本战果月已记录' : '本战果月尚未记录'}">${
        done ? '✓' : '◌'
      } ${elink('map', id, mapCodeOf(id))} <b>${value}</b></span>`
    })
    .join('')
  const eoRemain = Object.entries(EO_SENKA)
    .filter(([id]) => !clearedEo.has(Number(id)))
    .reduce((sum, [, value]) => sum + value, 0)
  const questRows = senka.entries.filter((e) => e.kind === 'quest')
  const cal = senka.calibration
  // ---- 自检：账外差值（2026-09-01 二次收紧）----
  // 经验：换设备/离线获得的在下次返港按差值自动入账。
  // EO：主进程在每次查账时按本月海域页（mapinfo）观测自动补记——重置点后
  //     观测到击破必属本月，机器判得了，不再让玩家肉眼确认。
  // 战果任务：主进程在同一次查账里按本月的 clearitemget 报文补记（入账时刻取
  //     报文观测时刻）。留在这张单子上的，是**自家计数已经数满、却没有领奖报文**
  //     的那几条（判据见 computeQuestMisses）——推断出来的「已完成」不再进这张单子。
  // 两类残余都只提示、都不写账；补不上的用下面的「补记」或实际校准兜底。
  const clearedEoSet = new Set(
    senka.entries.filter((e) => e.kind === 'eo').map((e) => Number(e.note) || 0),
  )
  const eoMisses = Object.entries(EO_SENKA)
    .map(([id, value]) => ({ id: Number(id), value }))
    .filter(({ id }) => mg.mapGauges[id]?.cleared && !clearedEoSet.has(id))
  const questMisses = computeQuestMisses()
  const selfCheckBlock = `
    <div class="sd-block">
      <div class="sd-h">自检 · 账外差值${
        !eoMisses.length && !questMisses.length ? '<i>未发现账外差值</i>' : ''
      }</div>
      ${
        eoMisses.length
          ? `<div class="sd-check-group">检测到旧的击破状态、但本月没有击破记录：</div>${eoMisses
              .map(
                ({ id, value }) =>
                  `<div class="sd-check-row"><span>${eoSenkaLabelHtml(`${id}`)} <b>+${value}</b></span><i class="sd-pend">定位不到本月</i></div>`,
              )
              .join('')}<div class="sd-note2">其他设备本月出击：打开游戏出击海域选择页同步</div>`
          : ''
      }
      ${
        questMisses.length
          ? `<div class="sd-check-group">计数已满但本月暂无领取记录的战果任务：</div>${questMisses
              .map((q) => {
                const periodLabel = QUEST_PERIOD_LABEL[q.periodKind]
                return `<div class="sd-check-row"><span><i class="sd-period">${periodLabel}</i>${questSenkaLabelHtml(`${q.id}`)} <b>+${q.senka}</b></span><i class="sd-pend" title="本期计数已满 · 本月无领奖报文">暂无领取记录</i></div>`
              })
              .join('')}<div class="sd-note2">已交付任务可在「本月任务战果」补记</div>`
          : ''
      }
      <div class="sd-recount">
        ${
          senkaRecountArmed
            ? `<button class="sd-cal-btn" data-act="senka-recount-do">确认重算</button><button class="sd-cal-btn ghost" data-act="senka-recount-cancel">取消</button>`
            : `<button class="sd-cal-btn ghost" data-act="senka-recount-arm" title="撤回本月自动补记的任务战果，再按领奖报文重记一遍">重算任务战果</button>`
        }
        ${senkaRecountResult ? `<i class="sd-pend">${esc(senkaRecountResult)}</i>` : ''}
      </div>
    </div>`
  // ⚠️ 下面那句指路里的 `戦績表示 → ランキング` **是游戏菜单的原字，不许汉化**。
  // 这是全仓语言总则（玩家可见文案统一中文）的一条**刻意例外**：指路文案的作用是
  // 让玩家照着在游戏界面里找到那一项，游戏里写的就是 `戦績表示`。此前前半被简中化成
  // 「战绩表示」、后半留着片假名，半中半日，玩家照着找菜单对不上——那不只是语言问题，
  // 是指错了路（2026-08-25 汉化清点）。改这一句之前先去游戏里看菜单实际写什么。
  const calibrationBlock = `
    <div class="sd-block">
      <div class="sd-h">实际校准</div>
      ${
        cal
          ? `<div class="sd-cal-now">${fmtDateTime(cal.ts)} 校准为 <b>${cal.value.toLocaleString()}</b> · 此后账内 +${fmt(cal.gainedSince)} → 当前估算 <b class="cur">${fmt(cal.current)}</b></div>${
              cal.current - senka.total > 0.5
                ? `<div class="sd-note2">比账内估算多 ${fmt(cal.current - senka.total)}</div>`
                : '<div class="sd-note2">与账内估算一致</div>'
            }`
          : '<div class="sd-note2" title="当前总值 = 校准值 + 此后账内新增 · 战果月结束后失效">到游戏「戦績表示 → ランキング」抄下官方战果填入</div>'
      }
      <div class="sd-cal-row">
        <input class="sd-cal-input" type="number" min="0" step="1" placeholder="排名页看到的战果值"
          title="统计存在「未使用 kuma 之前」的经验差值，kuma 仅能统计使用期间数据">
        <button class="sd-cal-btn" data-act="senka-calibrate">${cal ? '重新校准' : '以此为准'}</button>
        ${cal ? '<button class="sd-cal-btn ghost" data-act="senka-cal-clear">清除校准</button>' : ''}
      </div>
    </div>`
  return `
    ${calibrationBlock}
    ${selfCheckBlock}
    <div class="sd-block">
      <div class="sd-total"><b>${fmt(senka.total)}</b><span>本战果月合计（账内估算）</span></div>
      <div class="sd-parts">
        <span><small>继承</small><b>${carry ? fmt(carry.total) : '—'}</b>${
          carry ? `<i>经验部分 ${fmt(carry.fromExp)} + 上月特别 ${fmt(carry.fromSpecial)}</i>` : '<i>窗口内无记录</i>'
        }</span>
        <span><small>通常</small><b>${fmt(senka.normal)}</b><i>提督经验 ×7/10000</i></span>
        <span><small>特别</small><b>${fmt(senka.special)}</b><i>EO/任务查表</i></span>
      </div>
      ${
        carry && !carry.complete
          ? '<div class="sd-note">账内估算未含窗口外记录</div>'
          : ''
      }
    </div>
    <div class="sd-block">
      <div class="sd-h">EO 攻略${eoRemain ? `<i>还可补 <b>${eoRemain}</b> 战果</i>` : '<i>本月已全部记到</i>'}</div>
      <div class="sd-eo-grid">${eoCells}</div>
    </div>
    ${questSenkaBlockHtml(questRows, fmt)}
    <div class="sd-foot">继承 =（当年 1/1 起提督经验 ÷ 50000）+（前月特别战果 ÷ 35）</div>`
}

/**
 * 重算任务战果（2026-08-31 用户要的自愈动作）：撤回本战果月**自动补记**的
 * 任务行（合成行，指纹与「为什么允许删」见 ledger.clearAutoBookedQuestSenka），
 * 再重查一次账——主进程在查账时按本月的 clearitemget 报文重扫，有报文的自己
 * 回来（且落在真实领奖时刻），靠推断混进来的回不来。只管本月，历史月份不追溯。
 */
const recountQuestSenka = async () => {
  senkaRecountArmed = false
  let removed = 0
  try {
    removed = await clearAutoBookedSenkaQuests()
  } catch (error) {
    console.warn('[kanso] 战果任务重算失败', error)
    senkaRecountResult = '重算失败'
    await refreshSenkaDetail()
    return
  }
  senkaRecountResult = removed > 0 ? `已重算 · 撤回 ${removed} 笔` : '已重算 · 无补记行'
  await refreshSenkaDetail()
}

// 补记选单：拿不到就留空（表单里显示「暂无可补记的任务」），不拿旧的凑
const loadSenkaQuestOptions = async () => {
  try {
    senkaQuestOptions = await querySenkaQuestOptions()
  } catch (error) {
    console.warn('[kanso] 战果任务补记选单读取失败', error)
    senkaQuestOptions = []
  }
}

const addManualQuestSenka = async (questId: number) => {
  senkaAddError = ''
  let reason: string
  try {
    reason = await addManualSenkaQuest(questId)
  } catch (error) {
    console.warn('[kanso] 战果任务补记失败', questId, error)
    reason = 'failed'
  }
  // 补进去了就收表单；被挡回来的留着表单，玩家改选一条即可
  if (reason === 'booked') senkaAddOpen = false
  else senkaAddError = SENKA_ADD_REJECT[reason] ?? '该笔未写入账本'
  await loadSenkaQuestOptions()
  await refreshSenkaDetail()
}

const removeManualQuestSenka = async (id: number) => {
  senkaDelArmId = 0
  senkaDelError = ''
  try {
    if (!(await removeManualSenkaQuest(id))) senkaDelError = '只有补记行可删'
  } catch (error) {
    console.warn('[kanso] 战果任务补记删除失败', id, error)
    senkaDelError = '删除失败'
  }
  await loadSenkaQuestOptions()
  await refreshSenkaDetail()
}

const openSenkaDetail = () => {
  closeSenkaDetail()
  senkaRecountArmed = false
  senkaRecountResult = null
  senkaAddOpen = false
  senkaAddError = ''
  senkaDelArmId = 0
  senkaDelError = ''
  const monthLabel = senka ? senkaMonthLabel(senka.monthStart) : ''
  senkaDetailEl = document.createElement('div')
  senkaDetailEl.className = 'senka-detail-host'
  senkaDetailEl.innerHTML = `<div class="sd-back"></div>
    <div class="sd-panel">
      <div class="sd-head"><b>战果详情</b><span>${monthLabel} 月</span><span class="sd-x" title="关闭（Esc）">✕</span></div>
      <div class="sd-body">${senkaDetailBodyHtml()}</div>
    </div>`
  document.body.appendChild(senkaDetailEl)
  senkaDetailEl.querySelector('.sd-back')!.addEventListener('click', closeSenkaDetail)
  senkaDetailEl.querySelector('.sd-x')!.addEventListener('click', closeSenkaDetail)
  senkaDetailEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-act="senka-calibrate"]')) {
      const input = senkaDetailEl!.querySelector<HTMLInputElement>('.sd-cal-input')
      const value = Number(input?.value)
      if (!Number.isFinite(value) || value < 0 || !input?.value.trim()) {
        input?.focus()
        return
      }
      uiSet('senka.calibration', { value, ts: Date.now() })
      void refreshSenkaDetail()
      return
    }
    if (target.closest('[data-act="senka-cal-clear"]')) {
      uiSet('senka.calibration', null)
      void refreshSenkaDetail()
      return
    }
    // 重算是删行的动作，隔一步确认防误触
    if (target.closest('[data-act="senka-recount-arm"]')) {
      senkaRecountArmed = true
      senkaRecountResult = null
      void refreshSenkaDetail()
      return
    }
    if (target.closest('[data-act="senka-recount-cancel"]')) {
      senkaRecountArmed = false
      void refreshSenkaDetail()
      return
    }
    if (target.closest('[data-act="senka-recount-do"]')) {
      void recountQuestSenka()
      return
    }
    // ---- 手动补记 ----
    if (target.closest('[data-act="senka-quest-add-open"]')) {
      senkaAddOpen = true
      senkaAddError = ''
      senkaDelError = ''
      void (async () => {
        await loadSenkaQuestOptions()
        await refreshSenkaDetail()
      })()
      return
    }
    if (target.closest('[data-act="senka-quest-add-cancel"]')) {
      senkaAddOpen = false
      senkaAddError = ''
      void refreshSenkaDetail()
      return
    }
    if (target.closest('[data-act="senka-quest-add"]')) {
      const pick = senkaDetailEl!.querySelector<HTMLSelectElement>('.sd-qadd-pick')
      const questId = Number(pick?.value)
      if (!Number.isInteger(questId) || questId <= 0) {
        senkaAddError = '尚未选择任务'
        void refreshSenkaDetail()
        return
      }
      void addManualQuestSenka(questId)
      return
    }
    // 删补记也是两步：第一次点武装成「确认删除」，第二次点才真删
    const del = target.closest<HTMLElement>('[data-senka-qdel]')
    if (del) {
      const id = Number(del.dataset.senkaQdel)
      if (!Number.isInteger(id) || id <= 0) return
      if (senkaDelArmId !== id) {
        senkaDelArmId = id
        senkaDelError = ''
        void refreshSenkaDetail()
        return
      }
      void removeManualQuestSenka(id)
      return
    }
  })
  // 选单要现查一次：taken 是账本此刻的状态，攒着上一次打开的结果会说谎
  void (async () => {
    await loadSenkaQuestOptions()
    const body = senkaDetailEl?.querySelector('.sd-body')
    if (body) body.innerHTML = senkaDetailBodyHtml()
  })()
}

// 校准写入后：重查战果（主进程组装校准段）→ 弹窗换块 + 主卡重渲
const refreshSenkaDetail = async () => {
  senka = await querySenka()
  const body = senkaDetailEl?.querySelector('.sd-body')
  if (body) body.innerHTML = senkaDetailBodyHtml()
  render()
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && senkaDetailEl) closeSenkaDetail()
})

const render = (force = false) => {
  if (!pane || (!force && !pane.classList.contains('active'))) return
  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const html = `<div class="zi-app">
      <div class="main">
        ${
          loadError
            ? `<div class="placeholder">本地资源账本读取失败（${esc(loadError)}）
                <button class="zi-retry" data-act="zi-retry">重试</button></div>`
            : ''
        }
        <div class="tiles">${TILE_ORDER.map(tileHtml).join('')}</div>
      </div>
      <aside class="side">
        <div class="scard"><div class="h">收支分解<span class="aux">近 7 日 · 单项按来源</span></div>
          <div class="res-sel">${BREAKDOWN_RES.map(
            ([idx, label, color]) =>
              `<span class="rs${idx === breakdownRes ? ' on' : ''}" data-res="${idx}"><s style="background:${color}"></s>${entityTermHtml('material', idx, label)}</span>`,
          ).join('')}</div>
          ${breakdownHtml()}</div>
        ${senkaHtml()}
        ${activityLedgerHtml()}
        <div class="scard"><div class="h">储备目标<span class="aux">点击数值可编辑</span></div>
          ${targetsHtml()}</div>
        <div class="scard"><div class="h">战略道具<span class="aux">当前持有</span></div>
          ${strategicHtml()}</div>
        ${readinessCardHtml(eventMapsPresent, readinessHtml)}
      </aside>
    </div>`
  // 没换 DOM 就不能重绑：逐元素监听还在老元素上，再绑一遍就是监听叠加
  if (!commitPaneHtml(pane, 'zi', html)) return

  pane.querySelector<HTMLElement>('[data-act="senka-more"]')?.addEventListener('click', () => {
    senkaOpen = !senkaOpen
    render()
  })
  pane.querySelector<HTMLElement>('[data-act="senka-detail"]')?.addEventListener('click', () => {
    openSenkaDetail()
  })
  pane.querySelector<HTMLElement>('[data-act="zi-retry"]')?.addEventListener('click', () => {
    loadError = null
    void refresh()
  })
  pane.querySelectorAll<HTMLElement>('.rs').forEach((chip) => {
    chip.addEventListener('click', () => {
      breakdownRes = parseInt(chip.dataset.res!, 10)
      render()
    })
  })
  // 储备目标就地编辑：点数值 → input，Enter/失焦保存，Esc 取消
  pane.querySelectorAll<HTMLElement>('.tg-edit').forEach((cell) => {
    cell.addEventListener('click', () => {
      const idx = parseInt(cell.dataset.target!, 10)
      const old = getTargets()[idx] ?? 0
      const input = document.createElement('input')
      input.className = 'tg-input'
      input.value = `${old}`
      cell.replaceWith(input)
      input.focus()
      input.select()
      let settled = false
      const commit = (save: boolean) => {
        if (settled) return
        settled = true
        if (save) {
          const v = Math.max(0, Math.round(parseFloat(input.value.replace(/[,\s]/g, '')) || 0))
          // 先更新模块变量再写盘：读侧一律走 targetOverrides，不再回头 uiGet
          targetOverrides = { ...targetOverrides, [idx]: v }
          uiSet(TARGETS_KEY, targetOverrides)
        }
        render()
      }
      input.addEventListener('keydown', (e) => {
        // 组合中的回车/Esc 是给输入法的（敲定候选、取消这一段），别当成存盘/放弃
        if (e.isComposing) return
        if (e.key === 'Enter') commit(true)
        else if (e.key === 'Escape') commit(false)
      })
      input.addEventListener('blur', () => commit(true))
    })
  })
  pane.querySelectorAll<HTMLElement>('.si-row[data-useitem]').forEach((row) => {
    row.addEventListener('click', () => navigate({ type: 'useitem', id: parseInt(row.dataset.useitem!, 10) }))
  })
  pane.querySelectorAll<HTMLElement>('[data-exp-resource]').forEach((button) => {
    button.addEventListener('click', () => {
      focusExpeditionsForResource(parseInt(button.dataset.expResource!, 10))
    })
  })
  pane.querySelector<HTMLElement>('[data-open-du]')?.addEventListener('click', () => activateModule('du'))
}

// 出击中 ships 每次伤害回写都会 patch，锱只从里面数几件装备实例（女神行）。
// 跟着每条 patch 整块重渲染是白付账，350ms 去抖只认最后一次（qn 的同一手法）。
let shipsRenderTimer: ReturnType<typeof setTimeout> | null = null
const scheduleShipsRender = () => {
  if (shipsRenderTimer) clearTimeout(shipsRenderTimer)
  shipsRenderTimer = setTimeout(() => {
    shipsRenderTimer = null
    if (pane && deferWhilePressed(pane, 'zi', () => render())) return
    if (pane && deferWhileComposing(pane, 'zi', () => render())) return
    render()
  }, 350)
}

// 跨自然日重排：磁贴统计的是「今日 00:00 至现在」，过了零点必须自己重查一次。
// 必须与账本读取的成败无关——挂在成功路径上时，一次读失败就让日界线刷新永久停摆
// （下一次重排只能等别的事件顺手触发 refresh），磁贴会一直显示昨天的窗口。
const scheduleDayRollover = (now: number) => {
  if (dayRolloverTimer) clearTimeout(dayRolloverTimer)
  const nextDay = new Date(now)
  nextDay.setHours(24, 0, 0, 0)
  dayRolloverTimer = setTimeout(() => void refresh(), Math.max(1000, nextDay.getTime() - Date.now() + 100))
}

const refresh = async () => {
  const generation = ++refreshGeneration
  const now = Date.now()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayStart = today.getTime()
  const rollingDayStart = now - 24 * 3600 * 1000
  const active = activeEventArea()
  // 账本查询失败不再被吞成空数组：读不出来就说读不出来，别摆一堆 0 当事实。
  let rows
  try {
    rows = await Promise.all([
      queryMaterialHistory(todayStart),
      queryMaterialHistory(rollingDayStart),
      queryDeltaSummary(now - 7 * 24 * 3600 * 1000),
      queryUseitemSummary(now - 30 * 24 * 3600 * 1000),
      active ? queryMaterialHistory(active[1].firstSeenTs) : Promise.resolve([] as MaterialRow[]),
      active ? queryDeltaSummary(active[1].firstSeenTs) : Promise.resolve([] as CategorySummary[]),
      active
      ? queryEventSortieCosts(active[0], active[1].firstSeenTs)
        : Promise.resolve<EventSortieCostReport | null>(null),
      querySenka(),
      // 任务名资料库（kernel 按 id 缓存，重复 refresh 不产生新 IPC）。
      // 拿不到只影响战果行显示裸编号，不该拖垮整个账本。
      senkaQuestNames ? Promise.resolve(null) : queryLode('quests-scn').catch(() => null),
    ])
  } catch (error) {
    if (generation !== refreshGeneration) return
    console.warn('[kanso] 资源账本读取失败', error)
    loadError = `${(error as Error)?.message ?? error}`
    scheduleDayRollover(now)
    render()
    return
  }
  if (generation !== refreshGeneration) return
  loadError = null
  const [todayRows, rollingDayRows, dl, flow, activeRows, activeDeltaRows, activeSortieCostRows, senkaRows, questLode] = rows
  if (!senkaQuestNames && questLode?.data) {
    senkaQuestNames = new Map()
    for (const [idStr, raw] of Object.entries<any>(questLode.data)) {
      const id = parseInt(idStr, 10)
      if (id > 0) {
        senkaQuestNames.set(id, {
          code: `${raw.code ?? '?'}`,
          name: `${raw.name ?? ''}`,
          // 固定战果值与周期口径顺手解析（自检要对照「战果任务是否完成」）
          senka: questFixedSenka([raw.memo, raw.memo2].filter(Boolean).join(' | ')),
          periodKind: questPeriodFromCode(`${raw.code ?? ''}`, `${raw.memo2 ?? ''}`),
          annualMonth: questAnnualMonth(`${raw.memo2 ?? ''}`),
        })
      }
    }
  }
  const naturalDay = prepareHistory(todayRows, todayStart, now)
  const rollingDay = prepareHistory(rollingDayRows, rollingDayStart, now)
  const activePrepared = active
    ? prepareHistory(activeRows, active[1].firstSeenTs, now)
    : { rows: [] as MaterialRow[], hasBaseline: false, observedStart: null }
  todayHistory = naturalDay.rows
  todayHasBaseline = naturalDay.hasBaseline
  rollingDayHistory = rollingDay.rows
  rollingDayHasBaseline = rollingDay.hasBaseline
  deltas = normalizeDeltaCategories(dl)
  activityAreaId = active?.[0] ?? 0
  activityHistory = activePrepared.rows
  activityHistoryHasBaseline = activePrepared.hasBaseline
  activityDeltas = normalizeDeltaCategories(activeDeltaRows)
  activitySortieCosts = activeSortieCostRows
  itemFlow = new Map(flow.map((r) => [r.id, r]))
  senka = senkaRows
  // 账外差值不在这里补：EO 与任务的补记都在主进程 mg:senka 那一次查账里按
  // 账本存着的观测完成了，渲染层只负责把补不了的那几笔照实列出来（不入账）。
  // 自检那张单子还要读钦的精确计数——取不到就不列任务（拿不到观测就不说话）。
  if (!qp) {
    try {
      qp = await queryQp()
    } catch (error) {
      console.warn('[kanso] 战果自检读取精确计数失败', error)
    }
    if (generation !== refreshGeneration) return
  }
  render()
  scheduleDayRollover(now)
}

// ---- 资源/材料实体（15 稿注册表）----
// 单击 → 资源统计并高亮对应磁贴；右键 → 收支分解 / 提供该资源的任务 / 储备目标

const focusMaterial = (idx: number) => {
  activateModule('zi')
  const exact = TILE_META[idx] ? idx : null
  if (exact != null && exact <= 3) breakdownRes = exact // 收支分解只有燃弹钢铝四种
  highlightTile = exact
  render()
  setTimeout(() => {
    highlightTile = null
    if (pane?.classList.contains('active')) render()
  }, 2200)
}

registerEntityRoute('material', {
  colorClass: 'e-material',
  open(ref) {
    focusMaterial(ref.num)
  },
  peek(ref) {
    const idx = ref.num
    const meta = TILE_META[idx]
    const value = mg.materials?.[idx]
    if (!meta || value == null) return null
    const delta = todayDelta(idx)
    const target = getTargets()[idx] ?? 0
    const st = target > 0 ? targetStatus(idx, target) : null
    const lines = [
      `当前 <b style="font-family:var(--mono)">${value.toLocaleString()}</b>`,
      delta != null && Math.abs(delta) >= 1
        ? `今日 ${delta > 0 ? '▲' : '▼'}${fmtK(Math.round(Math.abs(delta)))}/日`
        : delta == null
          ? '今日记录不足'
          : '今日基本持平',
    ]
    if (st) {
      lines.push(
        st.done
          ? `储备目标 ${st.target.toLocaleString()} 已达到 ✓`
          : `储备目标 ${st.target.toLocaleString()}（${st.pct.toFixed(0)}%）${st.etaTs ? ` · 预计 ${fmtMonthDay(st.etaTs)}` : ' · 趋势不利'}`,
      )
    }
    return {
      title: meta.label,
      typeLabel: '资源',
      media: materialIconHtml(MATERIAL_ICON_BY_INDEX[idx], { className: 'lg', title: meta.label }),
      lines,
      primary: '资源统计',
    }
  },
  targets(ref) {
    const idx = ref.num
    const meta = TILE_META[idx]
    if (!meta) {
      return [{ label: '打开资源统计', run: () => focusMaterial(-1) }]
    }
    return [
      idx <= 3
        ? { label: '收支分解 · 按来源', run: () => focusMaterial(idx) }
        : { label: '收支分解', disabled: true, hint: '仅燃弹钢铝有分类记账' },
      { label: '提供该资源的任务', run: () => searchInManager(meta?.label ?? '') },
      {
        label: `补充${meta?.label ?? '资源'}的远征`,
        run: () => focusExpeditionsForResource(idx),
      },
      { label: '储备目标 · 设阈值', run: () => focusMaterial(idx) },
    ]
  },
})

registerModule({
  id: 'zi',
  title: '资源',
  order: 3,
  mount(el) {
    pane = el
    observeMaterialChanges()
    new ResizeObserver(() => {
      pane.classList.toggle('narrow', pane.clientWidth < 700)
    }).observe(pane)
    // 战略道具按名字匹配主数据（不硬编 id）；活动海图在不在也从这份里读
    void queryMasterRaw().then((raw) => {
      applyMaster(raw)
      render()
    })
    // 队列需求来自鉴的改造反查，矿脉是异步加载的——建好了再重画一次
    onUseitemDemandReady(() => render())
    onMgChange((keys) => {
      // 资源/道具变动后要重查账本（3 秒去抖，连续变动只查一次）；其余只重画
      if (keys.includes('materials')) observeMaterialChanges()
      // 主数据换了一版就重取一份：活动海图的进出（＝活动准备度卡的开关）只写在这里，
      // kernel 已在派发之前把 queryMasterRaw 的缓存作废，这里拿到的一定是新的。
      if (keys.includes('master')) {
        void queryMasterRaw().then((raw) => {
          applyMaster(raw)
          // 同下面那条：按下与抬起之间换掉 DOM，click 不会发生；组合中换掉 DOM 则断输入法
          if (!deferWhilePressed(pane, 'zi', () => render()) && !deferWhileComposing(pane, 'zi', () => render())) render()
        })
      }
      if (keys.includes('eventAreas')) {
        void refresh()
      } else if (keys.some((k) => ['materials', 'useitems', 'sortie', 'kdocks'].includes(k))) {
        if (queryTimer) clearTimeout(queryTimer)
        queryTimer = setTimeout(() => void refresh(), keys.includes('sortie') ? 500 : 3000)
      }
      // sortie 不在直接重渲染名单里：上面那条 500ms 去抖 refresh 走完就会 render，
      // 出击中每个节点重复画两遍等于白付一次全量重建。
      if (keys.some((k) => ['materials', 'useitems', 'slotitems', 'master', 'basic', 'eventAreas'].includes(k))) {
        // 用户正按在这块面板上就让到抬起之后（按下与抬起之间换掉 DOM，click 不会发生）；
        // 正在用输入法打字同理，让到组合结束——换掉 DOM 会把组合会话一起换没
        if (!deferWhilePressed(pane, 'zi', () => render()) && !deferWhileComposing(pane, 'zi', () => render())) render()
      } else if (keys.includes('ships')) {
        scheduleShipsRender()
      }
    })
    render(true)
    void refresh()
  },
  onShow: () => void refresh(),
})
