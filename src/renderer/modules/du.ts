// 铎 (Du) · 活动仪表盘——14 稿。活动期自动点亮：
// - Hero：活动海域 pills（难度/血条/通关）+ 剩余说明；
// - 左栏：海域进度卡（mapinfo 血条/难度实时）/ 出击识别札卡（sallyArea 实测分组）；
// - 右栏：选中海域的血条阶段 + 基地航空 + 可持久标记的活动机关清单。
// 数据诚实度：活动倍卡/限时掉落/友军来自本地维护包；缺包只挂牌，绝不联网补猜。
import type { MaterialRow } from '../../shared/mg-types'

import { fleetAirPower } from '../fleet-calc'
import { equipTypeIconHtml } from '../equip-icon'
import { MATERIAL_ICON_BY_INDEX, materialIconHtml, shipThumbHtml } from '../entity-art'
import { commitPaneHtml, esc, fleetLabel, fmtDate, fmtDateTime, fmtK, fmtTime, forgetCommittedHtml, lodeCredit, mg, onMgChange, queryFriendlyFleets, queryLode, queryMasterRaw, queryMaterialWindow, uiGet, uiSet } from '../kernel'
import type { LodeMeta } from '../kernel'
import { cachedEventBonusLode, eventKeyOf, loadEventBonusLode } from '../combat-forecast'
import { airBaseCustomName } from '../../shared/air-base-name'
import { equippedSlotIds } from '../../shared/equipped-slots'
import { recommendLbas } from '../../shared/lbas-recommend'
import type { AaEvasionRow, LbasPlan, LbasSlotPick, LbasStockPlane } from '../../shared/lbas-recommend'
import { lbasBonusContext, planeGroupsOf } from '../../shared/lbas-event-bonus'
import type { LbasBonusContext, PlaneGroupTable } from '../../shared/lbas-event-bonus'
import { eventBonusPackPageOf } from '../../shared/event-bonus-nationality'
import { mapIdOf } from '../../shared/map-id'
import { LBAS_TARGET_LABEL } from '../../shared/lbas-target-power'
import type { LbasTargetKind } from '../../shared/lbas-target-power'
import { elink, elinkHtml } from '../link'
import { entityNameHtml, entityNamePlain, entityTermHtml, localizationVersion } from '../localization'
import { initMapIntel } from '../map-intel'
import { registerModule, setModuleVisible } from '../mu'
import { sallyTagColor } from '../sally-tag'
import { sallyTagNameOf } from '../../shared/sally-names'
import {
  SALLY_RULE_GENERAL_NOTE,
  sallyMapRuleOf,
  sallyRuleView,
} from '../../shared/sally-rules'
import { histFleetById } from '../../shared/hist-fleets'
import { searchFold, searchFoldMap } from '../search-fold'
import { KCWIKI_EQUIP_ALIAS, KCWIKI_ITEM_ALIAS } from '../../shared/kcwiki-upgrade'
import { buildShipRemodelChains } from '../../shared/ship-remodel-chain'
import { detectEventAreas } from '../../shared/event-area'
import { FRIENDLY_REQUEST_NAME, type FriendlyFleetRecord } from '../../shared/friendly-fleet'
import { EVENT_DIFFICULTIES, mapIntelEntry, mapIntelMap, type EventOperations } from '../../shared/map-intel'
import { mapFleetAllowanceLabels } from '../../shared/map-sally'
import {
  CAMPAIGN_PERIOD_LABEL,
  detectSeasonalCampaigns,
  type CampaignQuestPeriod,
  type SeasonalCampaign,
} from '../../shared/seasonal-campaign'

let pane: HTMLElement
let areaNames: Map<number, string> = new Map()
// 活动海域 / 活动海图：判定在 shared/event-area.ts，与铭、鉴、锱同一份。
// 只随主数据变，主数据到手时算一次存下来（渲染路径每轮要问好几遍）。
let eventAreas = detectEventAreas([])
// 季节企划（南瓜/秋刀魚这类收集兑换）：活动海域撤场后铎切到这套视图
let useitemMst: { id: number; name: string }[] = []
let questCatalog: Record<string, any> | null = null

const state = {
  selected: null as number | null, // 选中的活动图 mapId
}
const GIMMICK_PROGRESS_KEY = 'du.gimmick-progress.v1'
let gimmickProgress = uiGet<Record<string, true>>(GIMMICK_PROGRESS_KEY, {})
const AIR_TARGET_KEY = 'du.air-targets.v1'
let airTargets = uiGet<Record<string, string>>(AIR_TARGET_KEY, {})
let equipCost: Map<number, number> = new Map()
let aaEvasion: Map<number, AaEvasionRow> = new Map()
// 活动陆航特効分组事实表（C1/C2/C3 各有哪些机体）。缺包不挡路：推荐照出，
// 只是活动图上认不出特効机，退成纯二期的按威力排。
let planeGroups: PlaneGroupTable | null = null
let planeGroupsMeta: LodeMeta | null = null
// 「推荐搭配」默认收起，不持久化——它是查一次的东西，不该开着占版面
let adviceOpen = false
// 打哪一类目标。一期只有对舰/对陆两档（雷装 or 爆装）；二期细到具名陆上型，
// 因为砲台小鬼/離島棲姫/集積地棲姫 三类的特効倍率与施加位置都不一样，
// 同一批机体在三类之间排出来的名次会真的换位——不细分就等于给错建议。
let adviceTarget: LbasTargetKind = 'surface'

const RANK_NAME: Record<number, string> = { 1: '丁', 2: '丙', 3: '乙', 4: '甲' }


const applyMasterAreas = (raw: any) => {
  const areas: any[] = raw?.data?.api_mst_maparea ?? []
  areaNames = new Map(areas.map((a) => [a.api_id, a.api_name]))
  eventAreas = detectEventAreas(areas, raw?.data?.api_mst_mapinfo ?? [])
  useitemMst = (raw?.data?.api_mst_useitem ?? []).map((u: any) => ({
    id: Number(u.api_id) || 0,
    name: `${u.api_name ?? ''}`,
  }))
  // 配置消耗只在原始主数据里（MasterSlotitem 没有这一格），推荐搭配要拿它比性价比
  equipCost = new Map(
    (raw?.data?.api_mst_slotitem ?? [])
      .filter((item: any) => Number.isFinite(item?.api_cost))
      .map((item: any) => [Number(item.api_id), Number(item.api_cost)]),
  )
}

// detectSeasonalCampaigns 对**每个规格**都把全部现役任务过一遍（14 × N），
// 每次都重拼同一条目录正文；正文只由 questCatalog 与任务号决定，按任务号缓存
// 即可。缓存跟着 questCatalog 的对象身份失效（矿脉包异步落地时会换一份）。
let catalogEntryCache = new Map<number, { code: string; text: string; resetNote: string } | null>()
let catalogEntrySource: Record<string, any> | null = null

const catalogEntryOf = (no: number) => {
  if (catalogEntrySource !== questCatalog) {
    catalogEntrySource = questCatalog
    catalogEntryCache = new Map()
  }
  // 目录里没有这一号也要记住（缓存 null），否则这一半的任务每轮都重查
  const cached = catalogEntryCache.get(no)
  if (cached !== undefined) return cached
  const raw = questCatalog?.[no]
  const entry = raw
    ? {
        code: `${raw.code ?? ''}`,
        text: `${raw.name ?? ''}\n${raw.desc ?? ''}\n${raw.memo ?? ''}\n${raw.memo2 ?? ''}`,
        resetNote: `${raw.memo2 ?? ''}`,
      }
    : null
  catalogEntryCache.set(no, entry)
  return entry
}

const seasonalCampaigns = (): SeasonalCampaign[] =>
  detectSeasonalCampaigns({
    useitemMst,
    useitems: mg.useitems,
    quests: Object.values(mg.quests),
    catalogOf: catalogEntryOf,
  })

const eventMaps = (): any[] => eventAreas.eventMaps

const syncModuleVisibility = () => {
  // 活动图在场，或有进行中的季节企划（任务点名 / 持有>0），铎都该在场。
  // 收集道具随企划结束被服务器清零，不存在长期存货——清零同步到本地的
  // 那一刻两个信号都熄灭，坞位自动交还。
  setModuleVisible('du', eventMaps().length > 0 || seasonalCampaigns().length > 0)
}

// ---- 本活动期资源净变化（14 稿 Hero 行）----
//
// 起算点 = 该活动区首次出现在主数据里的时刻（铭的 eventAreas）。
// 这是「你首次看到这张图」而非官方开幕——对自身消耗统计正合适：
// 晚几天入场，那几天本来也没打。口径在 UI 上写明，不含糊。
const RES_LABEL: [number, string][] = [
  [0, '燃'],
  [1, '弹'],
  [2, '钢'],
  [3, '铝'],
  [5, '桶'],
]

let spentEnds: { first: MaterialRow | null; last: MaterialRow | null } = { first: null, last: null }
let spentAreaId = 0
// 面板不可见时资源去抖只置脏、不发查询；切回来由 onShow 补跑一次。
let spentDirty = false
// 读失败的活动区：latch 住不再从 render 里自动重查。查询持续失败时
// 「失败 → then(render) → render 又发起 → 再失败」是只被 IPC 往返限速的死循环；
// 下一次 materials 变化（去抖后的 refreshSpent）会清 latch 重试。
let spentFailedAreaId = 0
let spentPendingAreaId = 0
let spentTimer: ReturnType<typeof setTimeout> | null = null

const EMPTY_SPENT: { first: MaterialRow | null; last: MaterialRow | null } = { first: null, last: null }

const refreshSpent = async (areaId: number) => {
  const period = mg.eventAreas[areaId]
  if (!period) {
    spentEnds = EMPTY_SPENT
    spentAreaId = 0
    return
  }
  // 只取起算点窗口的首尾两行：首行即活动开始时的存量，末行即当前存量。
  // 读失败就保持「未取到」而不是留下半截状态——上层据此显示占位，不摆 0。
  spentPendingAreaId = areaId
  try {
    const ends = await queryMaterialWindow(period.firstSeenTs)
    spentAreaId = areaId
    spentEnds = ends
    spentFailedAreaId = 0
  } catch (error) {
    console.warn('[kanso] 活动期资源变化读取失败', error)
    spentAreaId = 0
    spentEnds = EMPTY_SPENT
    spentFailedAreaId = areaId
  } finally {
    if (spentPendingAreaId === areaId) spentPendingAreaId = 0
  }
}

// 去抖/补跑共用的一次重算：查完只在面板可见时重渲。
const reloadSpentAndRender = (areaId: number) => {
  void refreshSpent(areaId).then(() => {
    if (pane.classList.contains('active')) render()
  })
}

// ---- 你遇到的友军（本机遭遇志）----
// 与随包资料层并列不合并，同「目录/实测分层」口径。按「图 + 难度」取：
// 难度换了就是另一批友军，混着算等于把丙难度的实测挂到甲难度名下。
let friendlyRows: FriendlyFleetRecord[] = []
let friendlyScope = '' // friendlyRows 属于哪个 `map|difficulty`
let friendlyStale = true
let friendlyPendingScope = ''
// 读失败的 scope latch 住不再自动重查——「失败 → then(render) → render 又发起」
// 只被 IPC 往返限速（与上面 spent 那条同族）。切图/换难度/重进面板会清掉重试。
let friendlyFailedScope = ''

const friendlyScopeKey = (mapId: number, difficulty: number) => `${mapId}|${difficulty}`

const ensureFriendlyFleets = (mapId: number, difficulty: number) => {
  const scope = friendlyScopeKey(mapId, difficulty)
  if (scope === friendlyPendingScope || scope === friendlyFailedScope) return
  if (scope === friendlyScope && !friendlyStale) return
  friendlyPendingScope = scope
  void queryFriendlyFleets(mapId, difficulty)
    .then((rows) => {
      friendlyRows = rows
      friendlyScope = scope
      friendlyStale = false
      friendlyFailedScope = ''
    })
    .catch((error) => {
      // 手上已有的旧记录不清：那是真发生过的遭遇，读新的失败不能把它抹掉
      console.warn('[kanso] 友军遭遇志读取失败', error)
      friendlyFailedScope = scope
    })
    .finally(() => {
      if (friendlyPendingScope === scope) friendlyPendingScope = ''
      if (pane.classList.contains('active')) render()
    })
}

/** 只认当前 scope 的记录：切图那一拍宁可空着，也不拿上一张图的实测顶上。 */
const friendlyFleetsOf = (mapId: number, difficulty: number) =>
  friendlyScope === friendlyScopeKey(mapId, difficulty) ? friendlyRows : []

/** 打完一场 / 重新打开面板：下一次渲染重取，旧记录在此期间照常显示。 */
const invalidateFriendlyFleets = () => {
  friendlyStale = true
  friendlyFailedScope = ''
}

const spentHtml = (areaId: number): string => {
  const period = mg.eventAreas[areaId]
  if (!period) return ''
  const { first, last } = spentEnds
  // 只有一条快照（首末同一行）算不出差额，与原来「不足两行」同义
  if (spentAreaId !== areaId || !first || !last || first.ts === last.ts) {
    return `<div class="ev-spent"><span class="k">活动期净变化</span>
      <span class="sub9">记账中 · 自 ${fmtDate(period.firstSeenTs)} 起</span></div>`
  }
  const cells = RES_LABEL.map(([idx, label]) => {
    const delta = (last.values[idx] ?? 0) - (first.values[idx] ?? 0)
    const cls = delta < 0 ? 'out' : delta > 0 ? 'in' : ''
    // 千位缩写唯一出处是 kernel 的 fmtK（负号它自己带，只有正号要补）
    const shown = `${delta > 0 ? '+' : ''}${fmtK(delta)}`
    return `<span class="ev-res ${cls}">${materialIconHtml(MATERIAL_ICON_BY_INDEX[idx], { className: 'sm', title: label })}<b>${delta === 0 ? '—' : shown}</b></span>`
  }).join('')
  const days = Math.max(1, Math.round((Date.now() - period.firstSeenTs) / 86400000))
  return `<div class="ev-spent">
    <span class="k">活动期净变化</span>${cells}
    <span class="sub9">自 ${fmtTime(period.firstSeenTs)} 起（约 ${days} 天）
      <span class="credit-mark" title="含远征、任务与日常消耗">口径</span> ·
      ${elink('material', -1, '资源统计 →')}</span>
  </div>`
}

// ---- 渲染 ----

const mapKeyOfInfo = (info: any) => `${info.api_maparea_id}-${info.api_no}`

const difficultyOf = (info: any) =>
  RANK_NAME[mg.mapGauges[info.api_id]?.selectedRank ?? 0] as
    | (typeof EVENT_DIFFICULTIES)[number]
    | undefined

const operationsOf = (info: any): EventOperations | null => {
  const difficulty = difficultyOf(info)
  return difficulty ? (mapIntelMap(mapKeyOfInfo(info), difficulty)?.operations ?? null) : null
}

const airTargetKey = (info: any): string =>
  `${mapKeyOfInfo(info)}|${difficultyOf(info) ?? '?'}`

const selectedAirTarget = (
  info: any,
  distances: Record<string, number>,
): string | null => {
  const saved = airTargets[airTargetKey(info)]
  if (saved && distances[saved] != null) return saved
  // 尚未选择时用资料中行动半径最大的点作保守参照，但明确标成“最远点”，
  // 不把它擅自称为 Boss 点。
  return Object.entries(distances)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

const setAirTarget = (info: any, node: string) => {
  const key = airTargetKey(info)
  // 先删后插：碰过的键回到插入序末尾，容量裁剪才裁得掉真正最久没动的那批。
  // 原来只在新键时追加，改过好几次的常用海域反而排在最前，先被裁掉。
  delete airTargets[key]
  if (node) airTargets[key] = node
  const keys = Object.keys(airTargets)
  if (keys.length > 200) {
    airTargets = Object.fromEntries(keys.slice(-160).map((item) => [item, airTargets[item]]))
  }
  uiSet(AIR_TARGET_KEY, airTargets)
}

const progressToken = (text: string) => {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const gimmickStepKey = (
  info: any,
  groupIndex: number,
  stepIndex: number,
  content: string,
): string => {
  const resolvedDifficulty = difficultyOf(info)
  const difficulty = resolvedDifficulty ?? '?'
  const intel = resolvedDifficulty
    ? mapIntelMap(mapKeyOfInfo(info), resolvedDifficulty)
    : null
  return `${mapKeyOfInfo(info)}|${difficulty}|${intel?.revision ?? 'unknown'}|${groupIndex}|${stepIndex}|${progressToken(content)}`
}

const toggleGimmickStep = (key: string) => {
  if (gimmickProgress[key]) delete gimmickProgress[key]
  else gimmickProgress[key] = true
  // 活动一多旧 revision 会自然失效；给本地存档设硬边界，避免永远增长。
  const keys = Object.keys(gimmickProgress)
  if (keys.length > 1000) {
    gimmickProgress = Object.fromEntries(keys.slice(-800).map((item) => [item, true]))
  }
  uiSet(GIMMICK_PROGRESS_KEY, gimmickProgress)
}

const heroHtml = (maps: any[]): string => {
  const areaId = maps[0].api_maparea_id
  const pills = maps
    .map((info) => {
      const mapId = info.api_id
      const gauge = mg.mapGauges[mapId]
      const code = `E-${info.api_no}`
      if (!gauge) return `<span class="mpill lock" data-map="${mapId}">${code} ？</span>`
      const rank = gauge.selectedRank ? (RANK_NAME[gauge.selectedRank] ?? '') : ''
      if (gauge.cleared) return `<span class="mpill done${state.selected === mapId ? ' cur' : ''}" data-map="${mapId}">${code} ${rank} ✓</span>`
      const pct = gauge.hpMax ? Math.round(((gauge.hpNow ?? 0) / gauge.hpMax) * 100) : 0
      return `<span class="mpill${state.selected === mapId ? ' cur' : ''}" data-map="${mapId}">${code} ${rank} <span class="gg"><i style="width:${pct}%"></i></span>${gauge.gaugeNum ? `第${gauge.gaugeNum}血条` : ''}</span>`
    })
    .join('')
  return `<div class="ehero">
    <span class="badge">限时活动</span>
    <h1>${entityNameHtml('mapArea', areaId, areaNames.get(areaId) ?? `活动海域 ${areaId}`)}</h1>
    <span class="cd">共 ${maps.length} 图</span>
    <span class="sp"></span>
    <div class="maps">${pills}</div>
    ${spentHtml(areaId)}
  </div>`
}

const mapCardHtml = (maps: any[]): string => {
  const rows = maps
    .map((info) => {
      const mapId = info.api_id
      const gauge = mg.mapGauges[mapId]
      const known = !!gauge
      const status = !known
        ? '<span class="mst lk">未同步</span>'
        : gauge.cleared
          ? '<span class="mst ok">✓ 通关</span>'
          : '<span class="mst cur">进行中</span>'
      const sub = known
        ? [
            gauge.gaugeNum ? `第${gauge.gaugeNum}血条` : '',
            gauge.hpMax ? `${Math.round(((gauge.hpNow ?? 0) / gauge.hpMax) * 100)}%` : '',
            // 扣血口径:剩几管扣到 0 击破,与游戏一致(不写成 1/6→6/6)
            gauge.required != null && gauge.required > 0
              ? `Boss 剩 ${Math.max(0, gauge.required - (gauge.defeated ?? 0))}/${gauge.required}`
              : '',
          ]
            .filter(Boolean)
            .join(' · ') || '—'
        : '血条/难度未同步'
      const diff = gauge?.selectedRank ? `<span class="diff">${RANK_NAME[gauge.selectedRank] ?? '?'}</span>` : ''
      return `<div class="mrow${state.selected === mapId ? ' on' : ''}${known ? '' : ' lockx'}" data-map="${mapId}">
        <span class="mid">E-${info.api_no}</span>
        <span class="nm"><b title="${esc(entityNamePlain('map', info.api_id, info.api_name))}">${entityNameHtml('map', info.api_id, info.api_name, { compact: true })}</b><span>${esc(sub)}</span></span>
        ${diff}${status}
      </div>`
    })
    .join('')
  return `<div class="card" style="--hc:var(--evt)">
    <div class="h"><b>海域</b><span class="aux">${elink('map', state.selected ?? maps[0].api_id, '当前海域图鉴 →')}</span></div>
    ${rows}
  </div>`
}

let tagExpanded: number | null = null

const sallyCardHtml = (areaId: number): string => {
  const groups = new Map<number, { rosterId: number; mstId: number; name: string; lv: number }[]>()
  for (const ship of Object.values(mg.ships)) {
    const list = groups.get(ship.sallyArea) ?? []
    list.push({ rosterId: ship.id, mstId: ship.shipId, name: mg.master.ships[ship.shipId]?.name ?? `#${ship.shipId}`, lv: ship.lv })
    groups.set(ship.sallyArea, list)
  }
  const tagged = [...groups.entries()].filter(([tag]) => tag > 0).sort((a, b) => a[0] - b[0])
  const free = groups.get(0)?.length ?? 0
  if (!tagged.length) {
    return `<div class="card" style="--hc:var(--gold)">
      <div class="h"><b>锁船标签（札）</b></div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.8">暂无被活动标签锁定的舰娘</div>
    </div>`
  }
  const rows = tagged
    .map(([tag, ships]) => {
      const color = sallyTagColor(tag)
      const expanded = tagExpanded === tag
      const names = expanded
        ? `<div class="tag-ships">${ships
            .sort((a, b) => b.lv - a.lv)
            .map((s) => `<span class="tag-ship">${shipThumbHtml(s.mstId, entityNamePlain('ship', s.mstId, s.name), { className: 'battle' })}${elinkHtml('ship', s.rosterId, entityNameHtml('ship', s.mstId, s.name, { compact: true }))}<i>${s.lv}</i></span>`)
            .join('')}</div>`
        : ''
      // 札的真名（第一方每期手录，shared/sally-names）。没录到就照旧只显示编号——
      // 名字是玩家真正在用的叫法，编号仍留着，攻略表按编号排。
      const named = sallyTagNameOf(areaId, tag)
      const chip = named
        ? `<span class="tchip" style="background:${color}">${esc(named.name)}<i class="tno">札${tag}</i></span>`
        : `<span class="tchip" style="background:${color}">札 ${tag}</span>`
      // 这一支同时是史实编队库里的条目时，把链挂上——两边同一份出处
      const fleet = named?.fleetId ? histFleetById(named.fleetId) : null
      return `<div class="trow" data-tag="${tag}">
        ${chip}
        <span class="who">${fleet ? elink('histFleet', fleet.id, '图鉴 · 同队成员') : ''}</span>
        <span class="n">已锁定 ${ships.length} 艘</span><span class="lk">${expanded ? '收起 ↑' : '查看 →'}</span>
      </div>${names}`
    })
    .join('')
  return `<div class="card" style="--hc:var(--gold)">
    <div class="h"><b>锁船标签（札）</b><span class="aux">返港后更新</span></div>
    ${rows}
    <div class="trow tfree"><span class="tchip" style="background:var(--bg3);color:var(--sub)">未锁定</span>
      <span class="who"></span><span class="n">${free} 艘</span></div>
  </div>`
}

// 基地航空队（14 稿）。数据随 mapinfo 自然下发，故是快照式。
// 半径/搭载/疲劳都是实测值；制空値走 fleet-calc 的基地口径（出撃=1 / 防空=2）。
const AIR_ACTION: Record<number, [string, string]> = {
  0: ['待机', ''],
  1: ['出击', 'ok'],
  2: ['防空', 'ok'],
  3: ['退避', 'dim'],
  4: ['休息', 'dim'],
}
const PLANE_COND: Record<number, string> = { 2: '橙疲劳', 3: '红疲劳' }

/**
 * 现在这张海图能拿去配陆航的机体。
 *
 * 池子 = 闲置的 + 本海域三支航空队里现有的。把本海域已配的算进来不是偷懒：
 * 同一作战海域的三支航空队之间换防不花配置成本也不用等转换，玩家本来就能自由调。
 * 装在舰娘身上的、以及**别的**海域陆航里的一律不算——那些要先卸下来。
 */
const lbasStockOf = (areaId: number): LbasStockPlane[] => {
  const busy = equippedSlotIds(
    Object.values(mg.ships),
    mg.airBases.filter((squad) => squad.areaId !== areaId),
  )
  const byMst = new Map<number, LbasStockPlane>()
  for (const [rawId, inst] of Object.entries(mg.slotitems)) {
    if (busy.has(Number(rawId))) continue
    const mst = mg.master.slotitems[inst.mstId]
    if (!mst) continue
    const known = byMst.get(inst.mstId)
    if (known) {
      known.count += 1
      known.level = Math.max(known.level, inst.level)
      continue
    }
    byMst.set(inst.mstId, {
      mstId: inst.mstId,
      name: entityNamePlain('equip', inst.mstId, mst.name),
      type2: mst.type2,
      torpedo: mst.raig ?? 0,
      bomb: mst.baku ?? 0,
      distance: mst.distance ?? 0,
      cost: equipCost.get(inst.mstId) ?? 0,
      count: 1,
      level: inst.level,
    })
  }
  return [...byMst.values()]
}

/** 这张海图在倍卡表里的编号（E4/E5…）；不是活动图就是 null。判据借 combat-forecast 那一份。 */
const eventKeyOfInfo = (info: any): string | null =>
  eventKeyOf(mapIdOf(Number(info?.api_maparea_id) || 0, Number(info?.api_no) || 0))

/**
 * 本图本点生效的陆航特効；**null = 走纯二期逻辑**。
 *
 * 三道门任一不过就是 null：不是活动图 / 该点没有陆航特効记载（本期 E1–E3 全图如此）/
 * 分组表的期号与倍卡包对不上（换期了）。判据一律借既有的单一出处——
 * 海域号→E 编号走 `eventKeyOf`，scope→点位走 `scopeApplies`，别在铎里另立一套。
 */
const lbasBonusOf = (info: any, node: string | null): LbasBonusContext | null => {
  const key = eventKeyOfInfo(info)
  if (!key || !node) return null
  const lode = cachedEventBonusLode()
  const entries = lode?.data?.events?.[key]?.entries
  if (!entries) return null
  return lbasBonusContext(
    entries,
    node,
    planeGroups,
    eventBonusPackPageOf(lode?.meta?.sourceUrl),
    planeGroupsMeta ? lodeCredit(planeGroupsMeta) : null,
  )
}

// 组合择优要枚举几万套搭配，而铎每收到一份 patch 就重渲一次。同一个目标点、
// 同一份库存算出来的必然是同一套方案，按「目标点 × 目标档 × 库存」记一格就够
//（面板一次只显示一套，多留几格没有意义）。
let advicePlanCache: { key: string; plan: LbasPlan | null } | null = null

const advicePlanFor = (
  stock: LbasStockPlane[],
  targetNeed: number | null,
  bonus: LbasBonusContext | null,
): LbasPlan | null => {
  const key = [
    adviceTarget,
    targetNeed ?? '-',
    bonus ? [...bonus.rates].map(([group, rate]) => `${group}=${rate}`).join(',') : '-',
    stock.map((plane) => `${plane.mstId}x${plane.count}+${plane.level}`).join('|'),
  ].join('#')
  if (advicePlanCache?.key === key) return advicePlanCache.plan
  const plan = recommendLbas({
    stock,
    targetRadius: targetNeed,
    target: adviceTarget,
    evasionOf: (mstId) => aaEvasion.get(mstId) ?? null,
    bonus,
  })
  advicePlanCache = { key, plan }
  return plan
}

const TIER_HINT: Record<string, string> = {
  '❀': '加重对空 ×0.4 · 舰队防空 ×0.4',
  '☆': '加重对空 ×0.5 · 舰队防空 ×0.5',
  '◎': '加重对空 ×0.5 · 舰队防空 ×0.7',
  '◯': '加重对空 ×0.6 · 舰队防空 ×0.7',
  '△': '加重对空 ×0.6 · 舰队防空不减',
}

/** 目标档按钮。标签取短的，悬停给全名与该类的特効口径。 */
const TARGET_TABS: ReadonlyArray<[LbasTargetKind, string, string]> = [
  ['surface', '对舰', '水上舰：用雷装，不吃对地特効'],
  ['land', '陆上', '没有具名特効的陆上型（飛行場姫・港湾棲姫 等）：用爆装，资料未给这一类的特効倍率'],
  ['pillbox', '砲台', '砲台小鬼：基地航空特効 ×1.6（威力上限前）· 爆撃特効 ×1.55（上限后，只有陆攻与舰爆吃得到）'],
  ['isolated', '離島', '離島棲姫：基地航空特効 ×1.18（威力上限前）· 爆撃特効 ×1.7（上限后，只有陆攻与舰爆吃得到）'],
  ['supply', '集積地', '集積地棲姫：爆撃特効 ×2.1 后再加 +100（两项都在威力上限之后）'],
]

/** 威力那一格的悬停拆解：基础 → 基地航空特効 → 爆撃特効，逐步给数。 */
const powerHint = (slot: LbasSlotPick): string => {
  const d = slot.detail
  if (d.power <= 0) return '这一格在本口径下打不动'
  const steps = [`基础 ${d.base.toFixed(1)}`]
  if (adviceTarget !== 'surface') {
    steps.push(`特効后 ${d.afterAirBonus}`)
    if (d.gotBombBonus > 1) steps.push(`爆撃特効 ×${d.gotBombBonus} → ${d.afterBombBonus}`)
    else steps.push('不吃爆撃特効（只有陆攻与舰爆吃得到）')
  }
  if (slot.plane.type2 === 47) steps.push('陆攻补正 ×1.8')
  if (d.capped) steps.push('已触威力上限，超出部分开方压缩')
  steps.push(`本格 ${Math.round(slot.power)}`)
  return steps.join(' · ')
}

const airAdviceHtml = (info: any, targetNeed: number | null, target: string | null): string => {
  const head = `<div class="ab-adv-h" data-air-advice="1">
      <b>推荐搭配</b>
      <span class="ab-adv-x">${adviceOpen ? '收起 ↑' : '展开 →'}</span>
    </div>`
  if (!adviceOpen) return head
  const areaId = info?.api_maparea_id ?? 0
  const bonus = lbasBonusOf(info, target)
  const plan = advicePlanFor(lbasStockOf(areaId), targetNeed, bonus)
  const modes = `<div class="ab-adv-mode">${TARGET_TABS.map(
    ([kind, label, hint]) =>
      `<button data-air-mode="${kind}" class="${adviceTarget === kind ? 'on' : ''}" title="${esc(hint)}">${label}</button>`,
  ).join('')}</div>`
  if (!plan) {
    const why = targetNeed != null && target
      ? `手上的机体凑不出能到 ${esc(target)}点的一队`
      : '手上没有能用的攻击机'
    return `${head}<div class="ab-adv">${modes}<div class="tnote">${why}</div></div>`
  }
  const rows = plan.slots
    .map((slot) => {
      const tier = slot.tier
        ? `<span class="ab-adv-t" title="${esc(TIER_HINT[slot.tier] ?? '')}">${slot.tier}</span>`
        : `<span class="ab-adv-t none" title="资料未收录这一件">—</span>`
      // 打不动的那一格：能延半径的标「延程」，纯为整队倍率而入队的标「特効」
      const groups = planeGroupsOf(bonus, slot.plane.mstId)
      const role =
        slot.role !== 'extender'
          ? ''
          : groups.length && slot.plane.distance < plan.radius
            ? '<i class="ab-adv-role buff">特効</i>'
            : '<i class="ab-adv-role">延程</i>'
      // 整队倍率那一枚：写清是哪一组、乘多少、作用于整队。悬停给分组出处。
      const bonusChip = groups.length
        ? `<i class="ab-adv-bonus" title="${esc(
            `${groups.join('・')} 组${bonus?.credit ? ` ｜ ${bonus.credit}` : ''}`,
          )}">${esc(groups.join('・'))} ×${groups
            .map((group) => bonus?.rates.get(group) ?? 1)
            .reduce((product, rate) => product * rate, 1)
            .toFixed(2)
            .replace(/\.?0+$/, '')} 整队</i>`
        : ''
      return `<div class="ab-adv-row">
        <span class="ab-adv-n">${elink('mstEquip', slot.plane.mstId, slot.plane.name)}<b>×${slot.capacity}</b>${role}${bonusChip}</span>
        ${tier}
        <span class="ab-adv-p" title="${esc(powerHint(slot))}">${Math.round(slot.power)}</span>
        <span class="ab-adv-d">半径 ${slot.plane.distance}</span>
        <span class="ab-adv-b">铝 ${slot.bauxite}</span>
      </div>`
    })
    .join('')
  // 命中不建模：上游自己写着「命中率…データ不足であり要検証」，没有公式可抄。
  // 与其编一个，不如把这条边界摆在玩家眼前。
  const caveat = adviceTarget === 'land'
    ? '威力按各机种对陆口径算；这一档没有具名特効倍率可用，实战会更高。命中未计入。'
    : '威力已按机种与该类目标的特効算过；命中未计入（尚无公开公式）。'
  // 整队特効的两个数：吃到多少倍，以及「不把特効算进选法」时会是多少
  //（两套选法撞在一起时不摆对照——同一个数摆两遍不是信息）
  const bonusPart = plan.bonusGroups.length
    ? ` · 特効 <b>×${plan.bonusMultiplier.toFixed(4).replace(/\.?0+$/, '')}</b>`
    : ''
  const versus =
    plan.bonusGroups.length && Math.round(plan.plainPower) !== Math.round(plan.power)
      ? `<i class="ab-adv-vs">不计特効选法 ${Math.round(plan.plainPower)}</i>`
      : ''
  // 活动图但这一点没有陆航特効记载：说出来，别让空白冒充「查过了没有」
  const noBonus =
    !bonus && eventKeyOfInfo(info) ? '<i class="ab-adv-vs">本点无陆航特効</i>' : ''
  const approx = plan.approx ? '<i class="ab-adv-vs">近似</i>' : ''
  return `${head}<div class="ab-adv">
    ${modes}
    <div class="ab-adv-sum">半径 <b>${plan.radius}</b> · 打${esc(LBAS_TARGET_LABEL[adviceTarget])}一波 <b>${Math.round(plan.power)}</b>${bonusPart} · 配置 <b>铝 ${plan.bauxite}</b>${versus}${noBonus}${approx}</div>
    ${rows}
    <div class="tnote">${caveat}</div>
  </div>`
}

const airBaseCardHtml = (info: any): string => {
  const all = mg.airBases
  if (!all.length) {
    return `<div class="card" style="--hc:#8fb8e0">
      <div class="h"><b>基地航空</b></div>
      <div style="font-size:11.5px;color:var(--dim)">尚未同步：在游戏里打开一次出击海域选择页</div>
    </div>`
  }
  // 只显示本活动海域的中队；对不上就全显示并标注
  const areaId = info?.api_maparea_id ?? 0
  const mine = all.filter((b) => b.areaId === areaId)
  const squads = mine.length ? mine : all
  const operations = operationsOf(info)
  const distances = operations?.nodeDistances ?? {}
  const target = selectedAirTarget(info, distances)
  const targetNeed = target ? distances[target] : null
  const targetSelect = Object.keys(distances).length
    ? `<label class="ab-target">目标点
        <select data-air-target="${info.api_id}">
          ${Object.entries(distances)
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
            .map(([node, need]) => `<option value="${esc(node)}"${node === target ? ' selected' : ''}>${esc(node)}点 · 半径${need}</option>`)
            .join('')}
        </select>
        <span>${airTargets[airTargetKey(info)] ? '手动选择' : '最远点'}</span>
      </label>`
    : ''
  const rows = squads
    .map((squad) => {
      const [actLabel, actCls] = AIR_ACTION[squad.actionKind] ?? ['未知行动', '']
      // 制空値：按该队当前行动的口径算（出撃 1 / 防空 2；待機等按出撃口径给参考值）
      const landbase = squad.actionKind === 2 ? 2 : 1
      const air = fleetAirPower(
        [{ slot: squad.planes.map((p) => p.slotId), onslot: squad.planes.map((p) => p.count) }],
        landbase,
      )
      const planes = squad.planes
        .filter((p) => p.slotId > 0)
        .map((p) => {
          const inst = mg.slotitems[p.slotId]
          const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
          const fullName = mst
            ? entityNamePlain('equip', inst!.mstId, mst.name)
            : '未知机体'
          const short = fullName.slice(0, 8)
          const low = p.count < p.maxCount
          const cond = PLANE_COND[p.cond]
          const equip = inst && mst
            ? `${equipTypeIconHtml(mst.iconId, { className: 'xs', title: fullName })}${elink('mstEquip', inst.mstId, short)}`
            : esc(short)
          return `<span class="ab-plane${cond ? ' tired' : ''}" title="${esc(fullName)}${
            cond ? ` · ${cond}` : ''
          }">${equip} <b class="${low ? 'low' : ''}">${p.count}/${p.maxCount}</b>${cond ? ' ✦' : ''}</span>`
        })
        .join('')
      const needSupply = squad.planes.some((p) => p.slotId > 0 && p.count < p.maxCount)
      const tired = squad.planes.some((p) => p.slotId > 0 && p.cond >= 2)
      const gap = targetNeed == null ? null : squad.distance - targetNeed
      const reachHtml = target && targetNeed != null
        ? `<div class="ab-reach ${gap! >= 0 ? 'ok' : 'bad'}">
            <b>${esc(target)}点</b>需半径 ${targetNeed} · ${gap! >= 0 ? `可以到达，航程多出 ${gap}` : `无法到达，还差 ${Math.abs(gap!)}`}
          </div>`
        : ''
      // 玩家起的名字原样保留；游戏默认的「第N基地航空隊」不上屏——判定与锐共用
      // 一个出口（shared/air-base-name），两处各写一份必然漂移
      const customName = airBaseCustomName(squad)
      return `<div class="ab-row">
        <div class="ab-h">
          <b>第${squad.rid}中队</b>${customName ? `<span class="ab-nm">${entityTermHtml('fleet', `air:${squad.areaId}:${squad.rid}`, customName)}</span>` : ''}
          <span class="ab-act ${actCls}">${actLabel}</span>
          <span class="ab-r">半径 <b>${squad.distance}</b> · 制空 <b>${air.min === air.max ? air.min : `${air.min}–${air.max}`}</b></span>
        </div>
        <div class="ab-planes">${planes || '<span style="color:var(--dim);font-size:10.5px">未配备机体</span>'}</div>
        ${reachHtml}
        ${
          needSupply || tired
            ? `<div class="ab-warn">${needSupply ? '⚠ 有机槽未补满' : ''}${needSupply && tired ? ' · ' : ''}${tired ? '✦ 有疲劳机队' : ''}</div>`
            : ''
        }
      </div>`
    })
    .join('')
  return `<div class="card" style="--hc:#8fb8e0">
    <div class="h"><b>基地航空</b><span class="aux">${
      mine.length ? '当前海域' : '全部中队'
    } · 同步于 ${mg.airBasesTs ? fmtTime(mg.airBasesTs) : '—'}</span></div>
    ${targetSelect}
    ${rows}
    ${airAdviceHtml(info, targetNeed, target)}
    ${Object.keys(distances).length ? '' : '<div class="tnote">本地资料暂无当前难度的确认航程</div>'}
  </div>`
}

// 改造链归属只认 shared/ship-remodel-chain。这里原来手搓了第二套并查集，还拿
// 「api_mst_shipupgrade 非空」做全局二选一——而升级表**盖不全**（不需要设计图
// 的改造根本没有条目，实测 Tuscaloosa 923→928 即是），一旦它非空，全部
// aftershipid 边就被整体丢弃。拿主数据快照实测：862 艘友舰里 527 艘因此掉成
// 孤立家族（睦月/如月/綾波/潮 全中），特效舰匹配对着一整柜舰娘报
// 「没有能准确匹配的特效舰」。
let shipFamilySource: typeof mg.master.ships | null = null
let shipUpgradeFamilySource: typeof mg.master.upgrades | null = null
let shipFamilyRootOf = new Map<number, number>()

const shipFamilyId = (mstId: number): number => {
  if (
    shipFamilySource !== mg.master.ships ||
    shipUpgradeFamilySource !== mg.master.upgrades
  ) {
    shipFamilySource = mg.master.ships
    shipUpgradeFamilySource = mg.master.upgrades
    shipFamilyRootOf = buildShipRemodelChains(
      Object.entries(mg.master.ships).map(([idText, ship]) => ({
        id: Number(idText),
        // 铭的主数据摘要不留 api_sortno；sortNo 只用于稳定地挑链根与排链内顺序，
        // 不影响「谁和谁同族」的划分，用 api_sort_id 兜底即可。
        sortNo: ship.sortId || Number(idText),
        afterId: ship.afterShipId > 0 ? ship.afterShipId : 0,
      })),
      Object.values(mg.master.upgrades)
        .flat()
        .map((upgrade) => ({
          targetId: upgrade.targetShipId,
          currentShipId: upgrade.currentShipId,
          originalShipId: upgrade.originalShipId,
          stage: upgrade.stage,
        })),
    ).rootOf
  }
  return shipFamilyRootOf.get(mstId) ?? mstId
}

const ownedSpecialHtml = (
  specials: EventOperations['specialShips'],
): string => {
  const exact = specials.filter((ship): ship is typeof ship & { id: number } => Boolean(ship.id))
  if (!exact.length) {
    return '<div class="sub9">资料只有舰种与国籍倍率，没有点名到具体舰娘</div>'
  }
  const exactByFamily = new Map<number, EventOperations['specialShips']>()
  for (const entry of exact) {
    const familyId = shipFamilyId(entry.id)
    const list = exactByFamily.get(familyId) ?? []
    list.push(entry)
    exactByFamily.set(familyId, list)
  }
  const matched = new Map<number, EventOperations['specialShips']>()
  for (const ship of Object.values(mg.ships)) {
    const effects = exactByFamily.get(shipFamilyId(ship.shipId)) ?? []
    if (effects.length) matched.set(ship.id, effects)
  }
  if (!matched.size) return '<div class="sub9">仓库里没有点名到的特效舰</div>'

  const assigned = new Set<number>()
  const deckRows = mg.decks.flatMap((deck) => {
    const ships = deck.ships.flatMap((rosterId) => {
      if (rosterId <= 0 || !matched.has(rosterId)) return []
      const ship = mg.ships[rosterId]
      if (!ship) return []
      assigned.add(rosterId)
      const mst = mg.master.ships[ship.shipId]
      const effects = matched.get(rosterId)!
      const summary = [...new Set(effects.map((entry) => entry.effect))].join(' · ')
      return [`<span class="op-owned-ship" title="${esc(summary)}">
        ${
          // 这一格被 .op-owned-ship 压成 36×22 的小横框——小框裁横幅必须用 avatar 档
          // 的取景偏移（68%），battle 档贴右裁出来只剩发梢/舾装（2026-08-24 用户实机报）。
          shipThumbHtml(ship.shipId, mst?.name ?? `#${ship.shipId}`, { className: 'avatar' })
        }
        ${elink('ship', rosterId, entityNamePlain('ship', ship.shipId, mst?.name ?? `#${ship.shipId}`))}
        <i>Lv${ship.lv}${ship.sallyArea ? ` · 札${ship.sallyArea}` : ''}</i>
      </span>`]
    })
    return ships.length
      ? [`<div class="op-owned-row"><b>${elink('fleet', deck.id, fleetLabel(deck).custom ?? fleetLabel(deck).canonical)}</b><div>${ships.join('')}</div></div>`]
      : []
  })
  // 活动期打开这栏就是为了挑人编队，所以按练度降序——原来是 roster id 顺序，
  // 等于按入库先后排，最想要的高练度舰可能落在最后。
  const reserve = [...matched.keys()]
    .filter((rosterId) => !assigned.has(rosterId))
    .sort((a, b) => (mg.ships[b]?.lv ?? 0) - (mg.ships[a]?.lv ?? 0))
  const RESERVE_CAP = 40
  const shown = reserve.slice(0, RESERVE_CAP)
  const reserveHtml = reserve.length
    ? `<details class="op-more" data-keep="op-reserve"><summary>仓库另有 ${reserve.length} 艘${
        reserve.length > RESERVE_CAP ? `（按等级列前 ${RESERVE_CAP}）` : ''
      }</summary>
        <div class="op-list">${shown.map((rosterId) => {
          const ship = mg.ships[rosterId]
          const mst = mg.master.ships[ship.shipId]
           return `<span class="op-chip">${elink('ship', rosterId, entityNamePlain('ship', ship.shipId, mst?.name ?? `#${ship.shipId}`))} <b>Lv${ship.lv}${ship.sallyArea ? ` · 札${ship.sallyArea}` : ''}</b></span>`
        }).join('')}</div>
      </details>`
    : ''
  return `${deckRows.join('') || '<div class="sub9">四支舰队里没有特效舰</div>'}${reserveHtml}`
}

// 友军舰队一节。**两层并列不合并**（与镝的敌编成区同一口径，2026-08-22 拍板）：
// `seen` 是你自己遇到过的（本机遭遇志），`pack` 是随包资料记载的这个难度有哪些编成。
// 两边回答的不是同一个问题，所以谁也不顶替谁、谁也不去重谁。
//
// 空态只有**两层都空**时才出声：本地有实测却显示「还没有资料」，
// 等于当着玩家的面否认他昨晚亲眼见过的事。
const friendlyFleetsHtml = (
  seen: FriendlyFleetRecord[],
  pack: EventOperations['friendlyFleets'],
): string => {
  // 一艘友军一格：头像 + 舰名（+ 调用方追加的练度）。排布照 ownedSpecialHtml 的
  // .op-owned-ship，横排交给 .op-friend-ships 的 flex，不再拿「·」当分隔。
  //
  // 头像这一格被压成 36×22 的小横框——小框裁横幅必须用 avatar 档的取景偏移（68%），
  // battle 档贴右裁出来只剩发梢/舾装（2026-08-24 用户实机报）。
  //
  // 资料层的舰名是从 wiki 誊抄的，连不上主数据就没有 mstId：**无号不放头像**，
  // 也不去猜哪一艘，只把名字原样摆出来。
  const shipCell = (
    mstId: number | undefined,
    name: string,
    { title = '', tail = '' }: { title?: string; tail?: string } = {},
  ): string =>
    `<span class="op-friend-ship"${title ? ` title="${esc(title)}"` : ''}>${
      mstId ? shipThumbHtml(mstId, name, { className: 'avatar' }) : ''
    }${
      mstId ? elink('mstShip', mstId, name) : entityTermHtml('mstShip', undefined, name)
    }${tail}</span>`
  // 装备只进悬停，不进一眼位置：这一层的一眼位置是「来的是哪几艘、什么练度」。
  const equipTitle = (ship: FriendlyFleetRecord['ships'][number]): string => {
    const nameOf = (mstId: number): string => {
      const mst = mg.master.slotitems[mstId]
      return mst ? entityNamePlain('equip', mstId, mst.name) : `#${mstId}`
    }
    const names = ship.slot.filter((id) => id > 0).map(nameOf)
    if (ship.slotEx > 0) names.push(`增设 ${nameOf(ship.slotEx)}`)
    return names.join(' · ')
  }
  const seenRow = (record: FriendlyFleetRecord) => {
    const ships = record.ships
      .map((ship) => {
        const name = entityNamePlain('ship', ship.mstId, mg.master.ships[ship.mstId]?.name ?? `#${ship.mstId}`)
        return shipCell(ship.mstId, name, { title: equipTitle(ship), tail: `<i>Lv${ship.lv}</i>` })
      })
      .join('')
    // 要請类型关联不上就整段不出现（不知道 ≠ 通常要請）。
    // api_production_type 有意不上屏：语义未定，实弹已证伪「2=強力」那套二元假说。
    const meta = [
      record.requestTypes.map((type) => FRIENDLY_REQUEST_NAME[type]).filter(Boolean).join(' / '),
      record.cells.map((one) => `点位 ${one.cell} ×${one.count}`).join(' · '),
      `最近 ${fmtDateTime(record.lastTs)}`,
    ]
      .filter(Boolean)
      .join(' · ')
    return `<div class="op-friend seen"><div class="op-friend-ships">${ships}</div><span class="op-fnote">${meta}</span></div>`
  }
  const packRow = (fleet: EventOperations['friendlyFleets'][number]) =>
    `<div class="op-friend"><div class="op-friend-ships">${
      fleet.ships.map((ship) => shipCell(ship.id, ship.name)).join('') || '无友军支援'
    }</div>${fleet.note ? `<span class="op-fnote">${esc(fleet.note)}</span>` : ''}</div>`
  const layerHtml = <T,>(
    rows: T[],
    title: string,
    keep: string,
    row: (item: T) => string,
  ): string =>
    rows.length
      ? `<div class="op-sub">${title}</div>${rows.slice(0, 12).map(row).join('')}${
          rows.length > 12
            ? `<details class="op-more" data-keep="${keep}"><summary>展开其余 ${rows.length - 12} 支</summary>${rows.slice(12).map(row).join('')}</details>`
            : ''
        }`
      : ''
  const seenHtml = layerHtml(seen, '你遇到的友军', 'op-friends-seen', seenRow)
  const packHtml = layerHtml(pack, '友军编成资料', 'op-friends', packRow)
  return seenHtml || packHtml
    ? `${seenHtml}${packHtml}`
    : '<div class="sub9">这个难度暂无友军编成资料</div>'
}

const extrasCardHtml = (info: any): string => {
  const mapKey = mapKeyOfInfo(info)
  const selected = RANK_NAME[mg.mapGauges[info.api_id]?.selectedRank ?? 0]
  const layers = EVENT_DIFFICULTIES.map((difficulty) => {
    const ready = Boolean(mapIntelMap(mapKey, difficulty))
    return `<span class="diff" style="${ready ? 'border-color:#2f5f45;color:var(--ok)' : 'color:var(--dim);border-color:var(--line)'}">
      ${difficulty}${difficulty === selected ? ' · 当前' : ''} · ${ready ? '已收录' : '待补'}
    </span>`
  }).join('')
  const operations = operationsOf(info)
  const specials = operations?.specialShips ?? []
  const specialChip = (ship: EventOperations['specialShips'][number]) =>
    `<span class="op-chip">${ship.id ? elink('mstShip', ship.id, ship.label) : entityTermHtml('mstShip', undefined, ship.label)} <b>${esc(ship.effect)}</b></span>`
  const specialHtml = specials.length
    ? `${ownedSpecialHtml(specials)}
      <details class="op-more" data-keep="op-specials"><summary>展开完整特效资料（${specials.length} 条）</summary>
        <div class="op-list">${specials.map(specialChip).join('')}</div>
      </details>`
    : '<div class="sub9">这个难度暂无特效舰资料</div>'
  const difficultyRank = mg.mapGauges[info.api_id]?.selectedRank ?? 0
  ensureFriendlyFleets(info.api_id, difficultyRank)
  const friendHtml = friendlyFleetsHtml(
    friendlyFleetsOf(info.api_id, difficultyRank),
    operations?.friendlyFleets ?? [],
  )
  return `
  <div class="card" style="--hc:#e08a97">
    <div class="h"><b>限时掉落 · 敌编成</b></div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px">${layers}</div>
    <div class="op-head">当前仓库的特效舰匹配 / 完整倍率</div>${specialHtml}
    <div class="op-head">友军舰队</div>${friendHtml}
  </div>`
}

// 奖励原文连字成链（2026-08-12 用户提议：活动词条要能点进图鉴）：
// **全名等值命中、最长优先、逐字扫描**——命中的名字变实体链接
// （舰娘/装备/道具），命不中的照旧纯文本，不模糊匹配不猜。
// 单字名（杉、松那批舰）不进索引：奖励正文里撞上同字的误链比漏链伤人。
// 「等值」按 searchFold 口径（2026-08-12 用户抓的实锤）：wiki 原文写
// 「20.3cm / 50」（斜线带空格）「Modele 1927」（无重音），字面比对连不上链。
// 除主数据日文名外，kcwiki 简中译名与别名也进索引（同日实锤：wiki 原文写
// 「九七式中战车(中三)」，主数据是「九七式中戦車(チハ)」，折叠救不了译名；
// 连不上会让用户误以为图鉴没收录）。每个名字仍是完整全名，不是模糊匹配。
let rewardIndexCache: {
  byChar: Map<string, { folded: string; domain: 'mstShip' | 'mstEquip' | 'useitem'; id: number }[]>
  key: string
} | null = null
// kcwiki 的简中意译与日文名不是字符转换关系（新型火炮兵装资材 ↔ 新型砲熕兵装資材），
// 复用任务奖励那张已对齐的表当别名，两处口径一致。
const rewardAliasById = (source: Record<string, number>) => {
  const byId = new Map<number, string[]>()
  for (const [cn, id] of Object.entries(source)) {
    const list = byId.get(id)
    if (list) list.push(cn)
    else byId.set(id, [cn])
  }
  return byId
}
const equipAliasById = rewardAliasById(KCWIKI_EQUIP_ALIAS)
const itemAliasById = rewardAliasById(KCWIKI_ITEM_ALIAS)
const rewardEntityIndex = () => {
  // 译名表启动后异步落地，缓存键要跟着本地化版本走：
  // 否则先渲染的卡片会把「还没有译名」的索引永久缓存住
  const key = `${Object.keys(mg.master.ships).length}:${Object.keys(mg.master.slotitems).length}:${useitemMst.length}:${localizationVersion()}`
  if (rewardIndexCache && rewardIndexCache.key === key) return rewardIndexCache.byChar
  const entries: { folded: string; domain: 'mstShip' | 'mstEquip' | 'useitem'; id: number }[] = []
  const seen = new Set<string>()
  const push = (domain: 'mstShip' | 'mstEquip' | 'useitem', id: number, name: string) => {
    const folded = searchFold(name ?? '')
    if (folded.length < 2) return
    const dupKey = `${domain}:${id}:${folded}`
    if (seen.has(dupKey)) return
    seen.add(dupKey)
    entries.push({ folded, domain, id })
  }
  for (const [id, ship] of Object.entries(mg.master.ships)) {
    if (Number(id) >= 1500 || (ship?.name?.length ?? 0) < 2) continue
    push('mstShip', Number(id), ship.name)
    push('mstShip', Number(id), entityNamePlain('ship', id, ship.name))
  }
  for (const [id, item] of Object.entries(mg.master.slotitems)) {
    if (Number(id) >= 1500 || (item?.name?.length ?? 0) < 2) continue
    push('mstEquip', Number(id), item.name)
    push('mstEquip', Number(id), entityNamePlain('equip', id, item.name))
    for (const alias of equipAliasById.get(Number(id)) ?? []) push('mstEquip', Number(id), alias)
  }
  for (const item of useitemMst) {
    if (item.id <= 0 || item.name.length < 2) continue
    push('useitem', item.id, item.name)
    push('useitem', item.id, entityNamePlain('item', item.id, item.name))
    for (const alias of itemAliasById.get(item.id) ?? []) push('useitem', item.id, alias)
  }
  entries.sort((a, b) => b.folded.length - a.folded.length)
  const byChar = new Map<string, typeof entries>()
  for (const entry of entries) {
    const list = byChar.get(entry.folded[0]) ?? []
    list.push(entry)
    byChar.set(entry.folded[0], list)
  }
  rewardIndexCache = { byChar, key }
  return byChar
}
const linkifyRewardText = (text: string): string => {
  const byChar = rewardEntityIndex()
  const { folded, map } = searchFoldMap(text)
  let out = ''
  let emitted = 0
  for (let i = 0; i < folded.length; ) {
    // 折叠会并字（è→e、㎜→mm、/ 两侧吞空格），命中两端必须落在原文字符边界上，
    // 不许把某个原文字符「切一半」算命中
    const atBoundary = i === 0 || map[i - 1] !== map[i]
    const hit = atBoundary
      ? byChar.get(folded[i])?.find((entry) => {
          if (!folded.startsWith(entry.folded, i)) return false
          const end = i + entry.folded.length
          return end === folded.length || map[end] !== map[end - 1]
        })
      : undefined
    if (!hit) {
      i += 1
      continue
    }
    const start = map[i]
    const lastAt = map[i + hit.folded.length - 1]
    const end = lastAt + ((text.codePointAt(lastAt) ?? 0) > 0xffff ? 2 : 1)
    out += esc(text.slice(emitted, start)) + elink(hit.domain, hit.id, text.slice(start, end))
    emitted = end
    i += hit.folded.length
  }
  return out + esc(text.slice(emitted))
}

// 突破奖励：wiki 原文照录（共通 + 各难度追加行），当前选择的难度行点亮。
// 装备名保留日文——资料源原文，不硬造译名；包里没收录时整卡不渲染，不占位。
const rewardCardHtml = (info: any): string => {
  const rewards = mapIntelEntry(mapKeyOfInfo(info))?.rewards
  if (!rewards?.length) return ''
  const selected = RANK_NAME[mg.mapGauges[info.api_id]?.selectedRank ?? 0] ?? ''
  const rows = rewards
    .map((reward) => {
      const mine = reward.scope === '共通' || reward.scope === selected
      const label = reward.scope === '共通' ? '共通' : `${reward.scope}追加`
      return `<div class="reward-row${mine ? ' mine' : ''}"><b>${esc(label)}</b><span>${linkifyRewardText(reward.text)}</span></div>`
    })
    .join('')
  return `<div class="card" style="--hc:var(--gold)">
    <div class="h"><b>突破奖励</b><span class="aux">${selected ? `当前难度 ${selected}` : ''}
      <span class="credit-mark" title="「某难度追加」是在共通之上的追加份">口径</span></span></div>
    ${rows}
  </div>`
}

// 出击札：这张图贴哪几枚、哪几枚禁入（图级，出处见 shared/sally-rules——
// wikiwiki 活动页主表 2026-08-26 逐格核对）。**只摆攻略表本身**，
// 不对具体某支舰队下「进不进得去」的判断，那条口径在 shared/sally-lock 没变。
// 札的配色与「锁船标签」卡共用 sallyTagColor，同一枚札两处长得一样。
const sallyRuleHtml = (info: any): string => {
  const areaId = info?.api_maparea_id
  const view = sallyRuleView(sallyMapRuleOf(areaId, info?.api_no))
  if (!view) return ''
  const chip = (tag: number, banned: boolean) => {
    const named = sallyTagNameOf(areaId, tag)
    const body = named ? `${esc(named.name)}<i>札${tag}</i>` : `札 ${tag}`
    return `<span class="sr-chip${banned ? ' ban' : ''}" style="--tag:${sallyTagColor(tag)}">${body}</span>`
  }
  const grantRow = view.grants.length
    ? `<div class="sr-row"><span class="sr-k">出击贴</span>${view.grants
        .map((tag) => chip(tag, false))
        .join('')}</div>`
    : ''
  const banChips = [
    ...view.banned.map((tag) => chip(tag, true)),
    // 上游没确认是哪一枚，照原文摆一枚灰的，不并进正常名单
    ...view.unconfirmed.map(
      (text) =>
        `<span class="sr-chip unk" title="${esc('wiki 未确认项，原文如此')}">${esc(text)}</span>`,
    ),
  ].join('')
  const banRow = banChips
    ? `<div class="sr-row"><span class="sr-k">${esc(view.bannedLabel)}</span>${banChips}</div>`
    : ''
  return `<div class="sally-rule" title="${esc(SALLY_RULE_GENERAL_NOTE)}">
    ${grantRow}${banRow}
    <div class="sr-foot">${esc(view.footnote)}</div>
  </div>`
}

const gaugeCardHtml = (info: any): string => {
  const gauge = mg.mapGauges[info.api_id]
  if (!gauge) {
    return `<div class="card" style="--hc:var(--bad)">
      <div class="h"><b>血条阶段</b></div>
      <div style="font-size:11.5px;color:var(--dim)">尚未同步：在游戏里打开一次出击地图</div>
      ${sallyRuleHtml(info)}
    </div>`
  }
  const pct = gauge.hpMax ? Math.round(((gauge.hpNow ?? 0) / gauge.hpMax) * 100) : null
  const allowedFleets = mapFleetAllowanceLabels(info.api_sally_flag)
  const bar =
    pct != null
      ? // 两条一律「剩余」语义:攻略完＝剩 0＝条空,与下面的击破计数同向,
        // 也与游戏内血条同向。通关跳回满格会被读成「血条又满了」。
        // 通关态由文字「✓ 已完成」与 .gaug.done 的绿色标识,不靠条的长度。
        `<div class="gaug${gauge.cleared ? ' done' : ''}"><span class="k">${gauge.gaugeNum ? `第${gauge.gaugeNum}血条` : '血条'}</span>
          <span class="bar"><i style="width:${gauge.cleared ? 0 : pct}%;background:linear-gradient(90deg,#a33448,var(--bad))"></i></span>
          <span class="v">${gauge.cleared ? '✓ 已完成' : `${pct}% (${gauge.hpNow}/${gauge.hpMax})`}</span></div>`
      : gauge.required != null && gauge.required > 0
        ? // 扣血口径:条画剩余、数到 0/N 击破,与血条制/游戏内一致
          `<div class="gaug${gauge.cleared ? ' done' : ''}"><span class="k">击破计数</span><span class="bar"><i style="width:${gauge.cleared ? 0 : Math.round((Math.max(0, gauge.required - (gauge.defeated ?? 0)) / gauge.required) * 100)}%;background:linear-gradient(90deg,#a33448,var(--bad))"></i></span><span class="v">${gauge.cleared ? '✓ 击破' : `剩 ${Math.max(0, gauge.required - (gauge.defeated ?? 0))}/${gauge.required}`}</span></div>`
        : '<div style="font-size:11px;color:var(--dim)">该图无血条数据</div>'
  return `<div class="card" style="--hc:var(--bad)">
    <div class="h"><b>血条阶段</b><span class="aux">难度 ${gauge.selectedRank ? RANK_NAME[gauge.selectedRank] : '未选'}
      <span class="credit-mark" title="以游戏内提示为准">口径</span></span></div>
    ${bar}
    ${allowedFleets.length ? `<div class="fleet-allow"><span>可出击编成</span>${allowedFleets.map((label) => `<b>${esc(label)}</b>`).join('')}</div>` : ''}
    ${sallyRuleHtml(info)}
  </div>`
}

const gimmickCardHtml = (info: any): string => {
  const operations = operationsOf(info)
  const gimmicks = operations?.gimmicks ?? []
  if (gimmicks.length) {
    const total = gimmicks.reduce((sum, gimmick) => sum + gimmick.steps.length, 0)
    let completed = 0
    const groups = gimmicks
      .map((gimmick, groupIndex) => {
        const steps = gimmick.steps
          .map((step, stepIndex) => {
            const key = gimmickStepKey(
              info,
              groupIndex,
              stepIndex,
              `${gimmick.title}\0${step}`,
            )
            const done = Boolean(gimmickProgress[key])
            if (done) completed++
            return `<button class="gm-step${done ? ' done' : ''}" data-gimmick-step="${esc(key)}" aria-pressed="${done}">
              <i>${done ? '✓' : '□'}</i><span>${esc(step)}</span>
            </button>`
          })
          .join('')
        return `<div class="gm-group"><b>${esc(gimmick.title)}</b>${steps}</div>`
      })
      .join('')
    return `<div class="card" style="--hc:var(--evt)">
      <div class="h"><b>开路 · 破甲机关</b><span class="aux">当前难度 · ${completed}/${total} 已标记</span></div>
      <div class="gm-progress"><i style="width:${total ? (completed / total) * 100 : 0}%"></i></div>
      ${groups}
      <div class="gnote2"><span class="credit-mark" title="最终完成状态仍以游戏内提示音和动画为准">口径</span></div>
    </div>`
  }
  return `<div class="card" style="--hc:var(--evt)">
    <div class="h"><b>开路 · 破甲机关</b><span class="aux">当前难度资料待补</span></div>
    <div class="gnote2">E-${info.api_no} 这个难度暂无机关资料</div>
  </div>`
}

// ---- 季节企划视图（活动海域未开放期间的收集兑换看板）----

const CAMPAIGN_PERIOD_ORDER: CampaignQuestPeriod[] = [
  'limited', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'once', 'unknown',
]

const campaignQuestRow = (no: number): string => {
  const quest = mg.quests[no]
  const title = quest?.title ?? `任务 ${no}`
  const chip = !quest
    ? ''
    : quest.state === 3
      ? '<span class="cq-chip done">待领奖励</span>'
      : quest.state === 2
        ? `<span class="cq-chip on">进行中${quest.progressFlag === 2 ? ' · 80%+' : quest.progressFlag === 1 ? ' · 50%+' : ''}</span>`
        : '<span class="cq-chip">尚未领取</span>'
  return `<div class="cq-row">${elink('quest', no, title)}${chip}</div>`
}

const campaignCardHtml = (campaign: SeasonalCampaign): string => {
  const groups = CAMPAIGN_PERIOD_ORDER
    .map((period) => ({ period, list: campaign.quests.filter((q) => q.period === period) }))
    .filter((group) => group.list.length > 0)
    .map((group) => `<div class="cq-group">
      <span class="cq-k">${CAMPAIGN_PERIOD_LABEL[group.period]}</span>
      <div class="cq-list">${group.list.map((q) => campaignQuestRow(q.no)).join('')}</div>
    </div>`)
    .join('')
  return `<div class="card" style="--hc:var(--gold)">
    <div class="h"><b>${esc(campaign.zhLabel)}</b><span>${esc(campaign.jpName)}</span>
      <span class="aux">历届时节：${esc(campaign.seasonNote)}</span></div>
    <div class="cq-stock">持有 <b>${campaign.stock}</b>${
      mg.useitemsTs ? `<span class="ts"> · 同步于 ${fmtTime(mg.useitemsTs)}</span>` : ''
    }</div>
    ${groups || '<div class="gnote2">现役任务里没有点名该道具的</div>'}
  </div>`
}

const campaignViewHtml = (active: SeasonalCampaign[]): string =>
  `<div class="du-app">
    <div class="ehero"><span class="badge">季节企划</span><h1>收集与兑换</h1><span class="sp"></span>
      <span class="cd">活动海域未开放</span></div>
    <div class="camp-body">
      ${active.map(campaignCardHtml).join('')}
      <div class="note9"><span class="credit-mark" title="持有数与任务状态由游戏实时同步 ｜ 任务周期来自本地任务目录 ｜ 兑换选项与截止日期以游戏内公告为准">源</span></div>
    </div>
  </div>`

const render = () => {
  if (!pane) return
  const maps = eventMaps()
  if (!maps.length) {
    const campaigns = seasonalCampaigns()
    if (campaigns.length) {
      // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
      commitPaneHtml(pane, 'du', campaignViewHtml(campaigns))
      return
    }
    forgetCommittedHtml(pane, 'du') // 这一支绕开 commitPaneHtml，记忆不能留着
    pane.innerHTML = `<div class="du-empty">
      <div class="t">活动仪表盘</div>
      <div class="d">当前没有限时活动海域</div>
    </div>`
    return
  }
  if (state.selected == null || !maps.some((m) => m.api_id === state.selected)) {
    // 默认选中第一张未通关的图
    const cur = maps.find((m) => mg.mapGauges[m.api_id] && !mg.mapGauges[m.api_id].cleared)
    state.selected = (cur ?? maps[0]).api_id
  }
  const selected = maps.find((m) => m.api_id === state.selected)!
  // 本活动已消耗：起算点变了才重查账本；在途/已失败的不再从这里发起
  const areaId = maps[0].api_maparea_id
  if (
    spentAreaId !== areaId &&
    spentPendingAreaId !== areaId &&
    spentFailedAreaId !== areaId &&
    mg.eventAreas[areaId]
  ) {
    reloadSpentAndRender(areaId)
  }
  commitPaneHtml(pane, 'du', `<div class="du-app${pane.clientWidth < 700 ? ' narrow' : ''}">
      ${heroHtml(maps)}
      <div class="body2">
        <div class="colL">
          ${mapCardHtml(maps)}
          ${sallyCardHtml(areaId)}
          ${extrasCardHtml(selected)}
        </div>
        <div class="colR">
          ${gaugeCardHtml(selected)}
          ${rewardCardHtml(selected)}
          ${airBaseCardHtml(selected)}
          ${gimmickCardHtml(selected)}
          <div class="note9"><span class="credit-mark" title="血条、难度和锁船标签由游戏实时同步 ｜ 活动机关与掉落来自本地资料">源</span></div>
        </div>
      </div>
    </div>`)
}

// ---- 模块 ----

registerModule({
  id: 'du',
  title: '活动',
  order: 7.5,
  mount(el) {
    pane = el
    new ResizeObserver(() => {
      const app = pane.querySelector('.du-app')
      if (app) app.classList.toggle('narrow', pane.clientWidth < 700)
    }).observe(pane)
    pane.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('.el')) return
      const gimmickStep = t.closest<HTMLElement>('[data-gimmick-step]')
      if (gimmickStep) {
        toggleGimmickStep(gimmickStep.dataset.gimmickStep!)
        render()
        return
      }
      const adviceMode = t.closest<HTMLElement>('[data-air-mode]')
      if (adviceMode) {
        const kind = adviceMode.dataset.airMode as LbasTargetKind
        if (LBAS_TARGET_LABEL[kind]) adviceTarget = kind
        render()
        return
      }
      if (t.closest('[data-air-advice]')) {
        adviceOpen = !adviceOpen
        render()
        return
      }
      const tagRow = t.closest<HTMLElement>('[data-tag]')
      if (tagRow) {
        const tag = parseInt(tagRow.dataset.tag!, 10)
        tagExpanded = tagExpanded === tag ? null : tag
        render()
        return
      }
      const mapEl = t.closest<HTMLElement>('[data-map]')
      if (mapEl) {
        state.selected = parseInt(mapEl.dataset.map!, 10)
        render()
      }
    })
    pane.addEventListener('change', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-air-target]')
      if (!target) return
      const info = eventMaps().find((map) => map.api_id === Number(target.dataset.airTarget))
      if (!info) return
      setAirTarget(info, target.value)
      render()
    })
    void (async () => {
      const [raw, catalog, evasion, groups] = await Promise.all([
        queryMasterRaw(),
        queryLode('quests-scn'),
        queryLode('equip-aa-evasion'),
        queryLode('event-plane-groups'),
        initMapIntel(),
        // 倍卡包与镝共用同一份模块级缓存，这里只负责把它取回来
        loadEventBonusLode(),
      ])
      applyMasterAreas(raw)
      questCatalog = (catalog as any)?.data ?? null
      // 缺包不挡路：推荐照出，只是回避档那一列显示未收录、排序退成看威力与耗铝
      aaEvasion = new Map(
        (((evasion as any)?.data ?? []) as AaEvasionRow[]).map((row) => [row.eq_id, row]),
      )
      // 同上：缺分组表就认不出特効机，活动图退成纯二期的按威力排
      planeGroups = ((groups as any)?.data ?? null) as PlaneGroupTable | null
      planeGroupsMeta = ((groups as any)?.meta ?? null) as LodeMeta | null
      syncModuleVisibility()
      render()
    })()
    onMgChange((keys) => {
      // 一份 patch 常常同时带好几段（回港一次就是 basic/materials/ships/decks/
      // ndocks/record/portLogs 七段）。原来是 if/else-if 链：materials 排在前面时
      // 札卡与特效编队卡要等 3 秒去抖才更新，quests/useitems 排在前面时反过来
      // 吞掉 materials 的去抖。各段各判各的，谁也不吞谁；立即重渲仍最多一次。
      if (keys.includes('materials')) {
        // 资源变动 → 重算「已消耗」，3 秒去抖（一场战斗会连着改好几次）
        if (spentTimer) clearTimeout(spentTimer)
        spentTimer = setTimeout(() => {
          const areaId = eventMaps()[0]?.api_maparea_id
          if (!areaId) return
          // 面板不可见时不发查询，只记一笔脏；onShow 补跑
          if (!pane.classList.contains('active')) {
            spentDirty = true
            return
          }
          reloadSpentAndRender(areaId)
        }, 3000)
      }
      if (keys.includes('master')) {
        // 主数据重取后必然重渲一次，同一份 patch 里的其他段一并带上
        void (async () => {
          applyMasterAreas(await queryMasterRaw())
          syncModuleVisibility()
          render()
        })()
        return
      }
      // 打完一场就可能多一支友军：下一次渲染重取（旧记录在此期间照常显示）
      if (keys.includes('sortie')) invalidateFriendlyFleets()
      if (keys.some((k) => k === 'quests' || k === 'useitems')) {
        // 企划的开闭信号在任务列表/道具存量里，不在主数据里——
        // 南瓜任务上线的那次 questlist 就该把铎点亮，哪怕主数据没动
        syncModuleVisibility()
      }
      if (
        keys.some((k) =>
          ['quests', 'useitems', 'mapGauges', 'ships', 'decks', 'airBases', 'slotitems', 'eventAreas'].includes(k),
        ) &&
        pane.classList.contains('active')
      ) {
        render()
      }
    })
    render()
  },
  onShow: () => {
    invalidateFriendlyFleets()
    // 不可见期间攒下的资源变动在这里补一次，否则 render 里的「起算点没变就不重查」
    // 会一直拿着过期的净变化
    if (spentDirty) {
      spentDirty = false
      const areaId = eventMaps()[0]?.api_maparea_id
      if (areaId) reloadSpentAndRender(areaId)
    }
    render()
  },
})
