// 鉴 · 列表。按设计稿 11 实装：全宽工作表（在籍轴）+ 智能筛选 +
// 排序 + Shift 多选对比栏 + 单击进入这一艘的单独界面（整面板接管）。
// 与鉴的关系：图鉴 = 收藏轴，列表 = 在籍轴；窄容器把表格重排成多行卡片，
// 详情仍是同一套单独界面（2026-08-11 用户拍板，下接式预览与侧栏都被否掉）。
import type { PlayerShip, ShipLifeReport } from '../../shared/mg-types'

import {
  esc,
  fmtCountdown,
  fmtDate,
  fmtK,
  fleetLabel,
  masterShipName,
  mg,
  commitPaneHtml,
  deferPassive,
  forgetCommittedHtml,
  onFilterInput,
  onMgChange,
  onTick,
  openShipLifeWindow,
  queryLode,
  queryMasterRaw,
  queryShipLife,
  repairDuration,
  updateCountdowns,
} from '../kernel'
import { lifeEventHtml } from '../ship-life-events'
import { alvIconHtml } from '../alv-icon'
import { ensureShipStatsLode, panelBonusOf, shipGrowthEndpointsOf } from '../fleet-calc'
import { fatigueBand } from '../fatigue'
import { equipTypeIconHtml } from '../equip-icon'
import { shipThumbHtml } from '../entity-art'
import { planRepairs } from '../../shared/repair-schedule'
import { elink, elinkHtml, navigate, pinEntityPeek, registerEntityRoute } from '../link'
import { entityNameHtml, entityNamePlain, entityTermHtml } from '../localization'
import { activateModule } from '../mu'
import { ensureLevelExpLode, expNeededTo } from '../level-exp'
import { ensureMapCellLetters } from '../map-cell-letter'
import {
  buildRemodelStageMap,
  isAdvancedRemodelTarget,
  isFinalRemodelTarget,
} from '../practice-leveling'
import { invalidateRemodelOrder, progressiveRemodelOf } from '../remodel'
import {
  ensureFavoriteRoots,
  isFavoriteOwnedShip,
  isFavoriteRoster,
  setShipRosterNote,
  shipPersonal,
  shipPersonalRevision,
  shipRosterNote,
  toggleFavoriteRoster,
} from '../ship-personal'
import { parseNoteTags, tallyNoteTags, type NoteTagTally } from '../../shared/note-tags'
import { shipChipMatches, SHIP_CHIPS, STYPE_CN } from '../ship-category'
import { statRowLayered } from '../stat-bars'
import { shipLifeDamageText } from '../../shared/ship-life-damage'
import { MARRIED_LEVEL_CAP } from '../../shared/ship-growth'
import { compareDisplayNames } from '../../shared/name-order'
import { instanceStatRows, type GrowthInitValues } from '../../shared/ship-stat-layers'
import { csvText, saveTextFile, stampedFileName } from '../csv-export'

// 舰种口径与图鉴共用一份（见 ship-category，含 STYPE_CN 短名）——两处各写一份，
// 同一艘舰在图鉴与列表里会落进不同分类。收藏是图鉴独有的，这里去掉。
const STYPE_CHIPS: [string, number[]][] = SHIP_CHIPS.filter(([label]) => label !== '收藏')

let pane: HTMLElement
let mstShips: Map<number, any> = new Map()
let kcwikiByMst: Map<number, any> = new Map()
// 舰娘档案补缺(wikiwiki 舰页):只有 kcwiki-ships 停收的形态才有条目
let shipProfileByMst: Map<number, any> = new Map()
let initialized = false
// 上一次跑倒计时的时刻：用来认出「这一秒刚跨过某个入渠完工时刻」
let lastCountdownTick = Date.now()
let rosterResizeObserver: ResizeObserver | null = null
let revealRosterView: (() => void) | null = null

export const setRosterViewOpener = (open: () => void) => {
  revealRosterView = open
}

const showRosterView = () => {
  if (revealRosterView) revealRosterView()
  else activateModule('ji')
}

const state = {
  search: '',
  stypeChip: '全部',
  smart: null as string | null,
  sortKey: 'lv',
  sortDir: -1,
  selected: 0, // 舰娘实例 id
  compare: [] as number[],
  lvlFinal: false, // 临近改造的「最终改造」子筛选：只看目标是链尾的
  equipFilter: 0, // >0 时只显示装着该 mstId 装备的舰（装备图鉴「装备中清单」入口）
  equipFilterName: '',
  noteTags: [] as string[], // 选中的备注标签（#xxx）；空 = 不按标签筛
  tagsOpen: false, // 备注标签片是否摊开（收纳态默认只留一行）；模块级，跨重渲保留
}
const lifeReports = new Map<number, ShipLifeReport>()
const lifeLoading = new Set<number>()
const lifeLoaded = new Map<number, number>() // rosterId → 手上这份对应的代
const lifeFailed = new Set<number>()
let lifeGeneration = 0

// ---- 行数据加工 ----

interface Row {
  ship: PlayerShip
  mst: any
  typeCn: string
  yasen: number
  starSum: number
  dock: { id: number; completeTime: number } | null
  dup: boolean
  fav: boolean // 图鉴收藏（链根口径）：临近改造两轴置顶 + 行内 ★
  // 是否在编（2026-08-17 用户要的）：正在哪个编队、是不是旗舰。不在编为 null
  fleet: { deckId: number; name: string; flagship: boolean } | null
  // flip = 双向（可逆）形态切换还没到级：不算「下一改装」缺口，但推荐练级要单列
  // finalGoal = 目标是否已是链上最后一段（「最终改造」子筛选，口径见 practice-leveling.ts）
  // advanced = 目标是否「进阶改造」（临近改造视图的分组置顶，口径见 practice-leveling.ts）
  kai:
    | { state: 'final' }
    | { state: 'ready'; next: string; blueprint?: string }
    | { state: 'near'; next: string; gap: number; expGap: number | null; finalGoal: boolean; advanced: boolean }
    | { state: 'flip'; next: string; gap: number; expGap: number | null; finalGoal: boolean; advanced: boolean }
  modMax: boolean[] // [火,雷,空,甲] 近代化是否吃满
}

let rowCache: Row[] | null = null
const invalidateRowCache = () => {
  rowCache = null
}

// 收藏的两份表（图鉴链根收藏 / 实例收藏）不走 mg 补丁，也没有版本号可订阅
// （ship-personal 只有一份内存态）。它们却是 Row.fav 的输入，图鉴那边点一下
// ★ 就会让这里的行缓存变旧——旧口径要等下一个 mg 补丁才纠正，中间列表的
// ★ 与「临近改造」的收藏置顶都是上一版。签名并进失效判据，跨模块即时生效。
// 两个数组都是「收藏了几艘」量级（几十条），每次渲染 join 一遍的代价可忽略。
let rowCacheFavSignature = ''
const favoriteSignature = (): string => {
  const personal = shipPersonal()
  return `${personal.favoriteRoots.join(',')}|${personal.favoriteRosterIds.join(',')}`
}

// ---- 备注标签（2026-09-01 用户拍板）----
// 标签不是另一套数据，就是「这一艘的备注」正文里的 `#xxx`（口径见 shared/note-tags）。
// 备注同样不走 mg 补丁，处境与上面的收藏签名一样；但它的写入点只有 ship-personal
// 一处，那边给了一枚 revision，这里按它记忆——**不按键击重建**：备注框是
// change（提交/失焦）才落盘的，玩家打字的每一下都走不到这里，输入链的闸门一根没碰。
let noteTagRevision = -1
let noteTagsByRoster = new Map<number, string[]>()

const noteTagsOf = (rosterId: number): string[] => {
  const revision = shipPersonalRevision()
  if (revision !== noteTagRevision) {
    noteTagRevision = revision
    const next = new Map<number, string[]>()
    // 离籍的舰备注仍留着（收容库要回看），照解不碍事——这是按 id 查的表。
    for (const [key, note] of Object.entries(shipPersonal().rosterNotes)) {
      const tags = parseNoteTags(note)
      if (tags.length) next.set(Number(key), tags)
    }
    noteTagsByRoster = next
  }
  return noteTagsByRoster.get(rosterId) ?? []
}

const starSumOf = (ship: PlayerShip) =>
  [...ship.slot, ship.slotEx]
    .filter((id) => id > 0)
    .reduce((sum, id) => sum + (mg.slotitems[id]?.level ?? 0), 0)

const buildRows = (): Row[] => {
  const favSignature = favoriteSignature()
  if (rowCache && rowCacheFavSignature === favSignature) return rowCache
  rowCacheFavSignature = favSignature
  // 「总xxxx」经验差要等级经验表；矿脉包到手后重算重渲（表未就绪时留空，不猜）
  ensureLevelExpLode(() => {
    invalidateRowCache()
    deferPassive(pane, 'qa', render)
  })
  // 收藏置顶要链根表；同款「就绪后重算重渲」节奏
  ensureFavoriteRoots(() => {
    invalidateRowCache()
    deferPassive(pane, 'qa', render)
  })
  const countByMst = new Map<number, number>()
  for (const ship of Object.values(mg.ships)) {
    countByMst.set(ship.shipId, (countByMst.get(ship.shipId) ?? 0) + 1)
  }
  // 在编反查：编队位 -1 是空位。deck.name 是玩家在游戏里起的队名，悬停给全称
  const fleetByShip = new Map<number, Row['fleet']>()
  for (const deck of mg.decks) {
    deck.ships.forEach((sid, i) => {
      // 未改名的队 deck.name 就是游戏默认的「第N艦隊」；fleetLabel 已经把这层归一过，
      // 这里绕过它就会在悬停里露日文（镝那边走的是 fleetLabel）
      if (sid > 0) {
        const label = fleetLabel(deck)
        fleetByShip.set(sid, {
          deckId: deck.id,
          name: label.custom ?? label.canonical,
          flagship: i === 0,
        })
      }
    })
  }
  // 「最终改造」子筛选的判据输入——与演习卡同口径（practice-leveling.ts）
  const afterOf = (id: number) => mg.master.ships[id]?.afterShipId ?? 0
  // 进阶分组要段位图（形态→链上第几段）——同样与演习卡同口径
  const stageOf = buildRemodelStageMap(
    Object.entries(mg.master.ships).map(([id, master]) => ({
      id: Number(id),
      afterId: master.afterShipId ?? 0,
    })),
  )
  rowCache = Object.values(mg.ships).map((ship) => {
    const mst = mstShips.get(ship.shipId)
    const nextRemodel = progressiveRemodelOf(ship)
    // 到改造等级还差的总经验——与演习页推荐练级卡同一口径（实测经验表优先）
    const expGapTo = (target: number) =>
      expNeededTo({ lv: ship.lv, expTotal: ship.expTotal, expNext: ship.expNext }, target)
    let kai: Row['kai']
    if (!nextRemodel) {
      // 没有更高阶单向改造。但可逆（双向）形态切换若还没到级，推荐练级要能看到：
      // 主数据 afterShipId 互指即可逆，progressiveRemodelOf 对回边返回 null
      const master = mg.master.ships[ship.shipId]
      kai =
        master && master.afterShipId > 0 && master.afterLv > 0 && ship.lv < master.afterLv
          ? {
              state: 'flip',
              next: entityNamePlain('ship', master.afterShipId, masterShipName(master.afterShipId)),
              gap: master.afterLv - ship.lv,
              expGap: expGapTo(master.afterLv),
              finalGoal: isFinalRemodelTarget(master.afterShipId, afterOf),
              advanced: isAdvancedRemodelTarget(master.afterShipId, master.afterLv, stageOf, afterOf),
            }
          : { state: 'final' }
    } else {
      if (ship.lv >= nextRemodel.level) {
        kai = { state: 'ready', next: nextRemodel.name, blueprint: kcwikiByMst.get(ship.shipId)?.改造?.图纸 }
      } else {
        kai = {
          state: 'near',
          next: nextRemodel.name,
          gap: nextRemodel.level - ship.lv,
          expGap: expGapTo(nextRemodel.level),
          finalGoal: isFinalRemodelTarget(nextRemodel.shipId, afterOf),
          advanced: isAdvancedRemodelTarget(nextRemodel.shipId, nextRemodel.level, stageOf, afterOf),
        }
      }
    }
    const modMax = ['api_houg', 'api_raig', 'api_tyku', 'api_souk'].map((key, i) => {
      const pair = mst?.[key]
      return Array.isArray(pair) ? (ship.kyouka[i] ?? 0) >= pair[1] - pair[0] : false
    })
    return {
      ship,
      mst,
      typeCn: STYPE_CN[mst?.api_stype] ?? mg.master.stypes[mst?.api_stype] ?? '?',
      yasen: ship.karyoku + ship.raisou,
      starSum: starSumOf(ship),
      dock: mg.ndocks.find((d) => d.shipId === ship.id) ?? null,
      dup: (countByMst.get(ship.shipId) ?? 0) > 1 && !ship.locked,
      // 实例收藏（我这一艘）∪ 图鉴链根收藏，二者都算——置顶与 ★ 同一判据
      fav: isFavoriteOwnedShip(ship),
      fleet: fleetByShip.get(ship.id) ?? null,
      kai,
      modMax,
    }
  })
  return rowCache
}

/** 受损档：舰C 的四档线（≤25% 大破 / ≤50% 中破 / ≤75% 小破 / 其余轻伤） */
const hurtBandOf = (ship: PlayerShip): { key: 'taiha' | 'chuha' | 'shouha' | 'light'; label: string } | null => {
  if (ship.maxhp <= 0 || ship.nowhp >= ship.maxhp) return null
  const ratio = ship.nowhp / ship.maxhp
  if (ratio <= 0.25) return { key: 'taiha', label: '大破' }
  if (ratio <= 0.5) return { key: 'chuha', label: '中破' }
  if (ratio <= 0.75) return { key: 'shouha', label: '小破' }
  return { key: 'light', label: '轻伤' }
}

const smartFilters: Record<string, (row: Row) => boolean> = {
  // 是否在编：正被编进某个舰队的
  infleet: (row) => !!row.fleet,
  kai: (row) => row.kai.state === 'ready',
  // 推荐练级（2026-08-12 用户提议）：还差几级就能改造/切形态的，单向双向都算
  leveling: (row) => row.kai.state === 'near' || row.kai.state === 'flip',
  marry: (row) => row.ship.lv === 99,
  tired: (row) => fatigueBand(row.ship.cond) !== 'ready' && !row.dock,
  dupe: (row) => row.dup,
  dock: (row) => !!row.dock,
  // 待修：受伤且**不在渠**的。已经在修的归 dock，混在一起会让「还要处理几艘」失真。
  repair: (row) => !row.dock && !!hurtBandOf(row.ship),
}

const applyFilters = (rows: Row[]): Row[] => {
  // 排序会原地修改数组；始终复制，避免当前视图的排序污染基础缓存。
  let out = [...rows]
  // 装备中清单（从装备图鉴右键进来）：谁身上装着这件装备
  if (state.equipFilter) {
    out = out.filter((r) =>
      [...r.ship.slot, r.ship.slotEx].some((id) => id > 0 && mg.slotitems[id]?.mstId === state.equipFilter),
    )
  }
  if (state.stypeChip !== '全部') {
    out = out.filter((r) => shipChipMatches(state.stypeChip, r.mst?.api_stype ?? 0))
  }
  if (state.smart && smartFilters[state.smart]) {
    out = out.filter(smartFilters[state.smart])
  }
  if (state.noteTags.length) {
    // 多选取**并集**：标签多半是玩家自己起的分组名（札名、编队名），一艘舰通常
    // 只带其中一个，取交集就是「点第二枚必空表」。「带其中任一个」才对得上
    // 「把这几组人一起摆出来」这件事——他要的就是照札名凑编队。
    out = out.filter((r) => noteTagsOf(r.ship.id).some((tag) => state.noteTags.includes(tag)))
  }
  if (state.smart === 'leveling' && state.lvlFinal) {
    // 「最终改造」子筛选：目标是中间段改造的不列（口径见 practice-leveling.ts）
    out = out.filter(
      (r) => (r.kai.state === 'near' || r.kai.state === 'flip') && r.kai.finalGoal,
    )
  }
  if (state.search) {
    const q = state.search.toLowerCase()
    // 门类与图鉴搜索同口径（2026-08-11 补）：舰级（级/型两种叫法）与舰种也可检索；
    // 单字查询只走名字类字段，免得「雷」拖出整个雷巡舰种
    const classVariants = [q]
    if (q.endsWith('级')) classVariants.push(`${q.slice(0, -1)}型`)
    else if (q.endsWith('型')) classVariants.push(`${q.slice(0, -1)}级`)
    out = out.filter((r) => {
      if (
        (r.mst?.api_name ?? '').toLowerCase().includes(q) ||
        (r.mst?.api_yomi ?? '').toLowerCase().includes(q) ||
        (kcwikiByMst.get(r.ship.shipId)?.中文名 ?? '').toLowerCase().includes(q) ||
        entityNamePlain('ship', r.ship.shipId, r.mst?.api_name ?? '').toLowerCase().includes(q)
      ) {
        return true
      }
      if (q.length < 2) return false
      // kcwiki 停收的形态(2023 起 89 个)舰级走 wikiwiki 舰页档案补缺
      const cls = `${kcwikiByMst.get(r.ship.shipId)?.级别?.[0] ?? shipProfileByMst.get(r.ship.shipId)?.shipClass?.[0] ?? ''}`.toLowerCase()
      if (cls && classVariants.some((v) => cls.includes(v))) return true
      const stype = r.mst?.api_stype ?? 0
      const typeNames = [
        r.typeCn,
        mg.master.stypes[stype] ?? '',
        entityNamePlain('shipType', stype, mg.master.stypes[stype] ?? ''),
      ]
      return typeNames.some((name) => name && name.toLowerCase().startsWith(q))
    })
  }
  return out
}

// 进阶分组置顶（2026-08-18 用户拍板）：只在「临近改造」视图里生效——
// 普通列表点「改造」表头排序时保持纯级差语义，不掺分组
const rowAdvanced = (row: Row): boolean =>
  (row.kai.state === 'near' || row.kai.state === 'flip') && row.kai.advanced
const advancedTier = (a: Row, b: Row): number =>
  state.smart === 'leveling' ? (rowAdvanced(b) ? 1 : 0) - (rowAdvanced(a) ? 1 : 0) : 0

/** 这一行在屏幕上写着的那个名字（中文译名，没有译名的舰是日文原名）——排序键与所见一致。 */
const displayNameOf = (row: Row): string =>
  entityNamePlain('ship', row.ship.shipId, row.mst?.api_name ?? '')

const SORTERS: Record<string, (a: Row, b: Row) => number> = {
  // 按舰名 = 显示中文名的拼音序（2026-08-21 用户拍板，口径见 shared/name-order）
  name: (a, b) => compareDisplayNames(displayNameOf(a), displayNameOf(b)),
  type: (a, b) => (a.mst?.api_stype ?? 0) - (b.mst?.api_stype ?? 0),
  // 主键只管等级。同级的次序不在这里排——见下面的 TIE_BREAKERS。
  lv: (a, b) => a.ship.lv - b.ship.lv,
  cond: (a, b) => a.ship.cond - b.ship.cond,
  luck: (a, b) => a.ship.lucky - b.ship.lucky,
  yasen: (a, b) => a.yasen - b.yasen,
  star: (a, b) => a.starSum - b.starSum,
  // 修理队列的排序轴：入渠时长。活动期「谁进渠、谁吃桶」就是按这个排的
  ndock: (a, b) => a.ship.ndockTime - b.ship.ndockTime,
  // 推荐练级的排序轴：收藏置顶（2026-08-16 用户提议，与演习卡同口径），
  // 组内按距下一段改造的级差，越临近越前；无缺口的沉底。
  // 同差距时等级高的在前——与演习页推荐练级卡同一套口径（practice-leveling.ts）
  kaigap: (a, b) => {
    const gapOf = (row: Row) =>
      row.kai.state === 'near' || row.kai.state === 'flip' ? row.kai.gap : Number.POSITIVE_INFINITY
    return (
      (b.fav ? 1 : 0) - (a.fav ? 1 : 0) ||
      advancedTier(a, b) ||
      gapOf(a) - gapOf(b) ||
      b.ship.lv - a.ship.lv
    )
  },
  // 「按经验」子分类（2026-08-13 用户提议）：级差不等价于经验差，
  // Lv97 差 3 级要的经验可能是 Lv30 差 5 级的几十倍。算不出的沉底。收藏同样置顶。
  kaiexp: (a, b) => {
    const expOf = (row: Row) =>
      (row.kai.state === 'near' || row.kai.state === 'flip') && row.kai.expGap != null
        ? row.kai.expGap
        : Number.POSITIVE_INFINITY
    return (
      (b.fav ? 1 : 0) - (a.fav ? 1 : 0) ||
      advancedTier(a, b) ||
      expOf(a) - expOf(b) ||
      b.ship.lv - a.ship.lv
    )
  },
}

/**
 * 主键相等时的次序。**不随 sortDir 翻转**——这是它和 SORTERS 的全部区别。
 *
 * 等级列的次键是「还差多少经验升级」。以前它写在 SORTERS.lv 里，
 * 于是被外层的 `sortDir * sorter(...)` 一起翻掉：升序时同级里快升级的在前，
 * 降序（等级列的默认方向）时同级里反而是刚升完级的在前。同一批 Lv99
 * 的顺序会随点一下表头整个倒过来，而「谁快升级」跟看升序还是降序无关。
 */
const TIE_BREAKERS: Record<string, (a: Row, b: Row) => number> = {
  lv: (a, b) => a.ship.expNext - b.ship.expNext,
}

/** 列表与导出共用的一次排序：主键随 sortDir 翻，次键不翻。 */
const sortRows = (rows: Row[]): void => {
  const sorter = SORTERS[state.sortKey] ?? SORTERS.lv
  const tie = TIE_BREAKERS[state.sortKey]
  rows.sort((a, b) => state.sortDir * sorter(a, b) || (tie ? tie(a, b) : 0))
}

// ---- 渲染 ----

// fmtK / repairDuration 上提 kernel 单一出处（口径以锱为准：≥10000 取整 k）

interface ChipCounts {
  infleet: number
  kai: number
  leveling: number
  marry: number
  tired: number
  dupe: number
  dock: number
  repair: number
}

/** 筛选 chip 的角标 + 待修合账的清单，一遍走完。
 *  原来是八个 chip 各 `all.filter(...)` 扫一遍全表、待修合账再扫第九遍——
 *  四百多艘在籍舰 × 每个 mg 补丁都重渲，八份中间数组纯属白建。 */
const tallyRows = (rows: Row[]): { counts: ChipCounts; repairList: Row[] } => {
  const counts: ChipCounts = {
    infleet: 0,
    kai: 0,
    leveling: 0,
    marry: 0,
    tired: 0,
    dupe: 0,
    dock: 0,
    repair: 0,
  }
  const repairList: Row[] = []
  for (const row of rows) {
    if (smartFilters.infleet(row)) counts.infleet += 1
    if (smartFilters.kai(row)) counts.kai += 1
    if (smartFilters.leveling(row)) counts.leveling += 1
    if (smartFilters.marry(row)) counts.marry += 1
    if (smartFilters.tired(row)) counts.tired += 1
    if (smartFilters.dupe(row)) counts.dupe += 1
    if (smartFilters.dock(row)) counts.dock += 1
    if (smartFilters.repair(row)) repairList.push(row)
  }
  counts.repair = repairList.length
  return { counts, repairList }
}

/**
 * 待修清单的合账。单看一行只知道这艘要修多久，真正的决策是
 *「全都修完要多少燃钢、全用桶够不够」——活动期这笔账本来要自己心算。
 *
 * 桶按每艘 1 个算：高速修复材不论伤多重都是一艘一个。
 */
const repairSummaryHtml = (list: Row[]): string => {
  if (state.smart !== 'repair') return ''
  if (!list.length) return ''
  const now = Date.now()
  // 按现有渠位排程，而不是把时长一路相加——有几个渠就能并行几艘。
  // 占用中的渠要等当前这艘修完才腾得出来，所以 freeAt 取它的完工时刻。
  const plan = planRepairs({
    now,
    // api_ndock 永远下发 4 条，未租借的 state=-1——把它们当空渠会把并行度
    // 乐观一倍（只开 2 渠的账号按 4 渠算「全员就绪」）。旧快照缺 state 沿用旧口径。
    slots: mg.ndocks
      .filter((dock) => dock.state == null || dock.state >= 0)
      .map((dock) => ({
        freeAt: dock.shipId > 0 ? dock.completeTime : now,
      })),
    durations: list.map((r) => r.ship.ndockTime),
  })
  const fuel = list.reduce((sum, r) => sum + r.ship.ndockItem[0], 0)
  const steel = list.reduce((sum, r) => sum + r.ship.ndockItem[1], 0)
  const taiha = list.filter((r) => hurtBandOf(r.ship)?.key === 'taiha').length
  // 高速修复材住在 materials[5]（见 shared/useitem-stock 的 USEITEM_MATERIAL_INDEX）
  const buckets = mg.materials?.[5]
  const known = typeof buckets === 'number'
  const enough = known && buckets >= list.length
  return `<div class="qa-repair-sum">
    <span class="rs-k">待修 <b>${list.length}</b> 艘${taiha ? ` · 其中大破 <b class="bad">${taiha}</b>` : ''}</span>
    <span class="rs-k">${
      plan
        ? `全员就绪 <b>${repairDuration(plan.remainMs)}</b><i title="${esc(
            `${plan.slotCount} 渠并行估算${plan.queued ? ` · ${plan.queued} 艘排队等空渠` : ''}`,
          )}">${plan.slotCount} 渠并行${plan.queued ? ` · ${plan.queued} 艘排队` : ''}</i>`
        : '暂无可用入渠位'
    }</span>
    <span class="rs-k">合计 <b>${fuel.toLocaleString()}</b> 燃 <b>${steel.toLocaleString()}</b> 钢</span>
    <span class="rs-k">全用桶需 <b>${list.length}</b> 个${
      known ? `<i class="${enough ? 'ok' : 'bad'}">现有 ${buckets}${enough ? ' ✓' : ' 不足'}</i>` : '<i>库存未同步</i>'
    }</span>
  </div>`
}

const rowHtml = (row: Row) => {
  const { ship } = row
  const name = masterShipName(ship.shipId)
  const badges: string[] = []
  if (row.fleet) {
    badges.push(
      `<span class="infleet" title="正在第${row.fleet.deckId}舰队${row.fleet.flagship ? '（旗舰）' : ''} · ${esc(row.fleet.name)}">${row.fleet.deckId}队${row.fleet.flagship ? '·旗' : ''}</span>`,
    )
  }
  if (ship.lv === 99) badges.push('<span class="marry">Lv99 可誓约</span>')
  if (ship.sallyArea > 0) badges.push(`<span class="sally">标签 ${ship.sallyArea}</span>`)
  if (row.dup) badges.push('<span class="dup">重复 · 未锁</span>')
  // 备注标签：玩家自己写在「这一艘的备注」里的 #xxx。摆在行上，筛出来的这几艘
  // 是凭哪个标签进来的才看得出。行是这一页最挤的地方，最多摆三枚，其余折成 +N。
  const rowTags = noteTagsOf(ship.id)
  rowTags.slice(0, 3).forEach((tag) => badges.push(`<span class="ntag">#${esc(tag)}</span>`))
  if (rowTags.length > 3) {
    badges.push(
      `<span class="ntag more" title="${esc(rowTags.map((tag) => `#${tag}`).join(' '))}">+${rowTags.length - 3}</span>`,
    )
  }
  const hurt = hurtBandOf(ship)
  const dockSub = row.dock
    ? `<span class="sub">入渠中 · 渠${row.dock.id} · <span data-cd="${row.dock.completeTime}">${fmtCountdown(row.dock.completeTime)}</span></span>`
    : hurt
      ? // 活动期「谁进渠、谁吃桶」原本要自己心算：修多久、吃多少燃钢，摆出来
        `<span class="sub hurt-sub ${hurt.key}">${hurt.label} ${ship.nowhp}/${ship.maxhp} · 修 ${repairDuration(ship.ndockTime)} · ${ship.ndockItem[0]}燃 ${ship.ndockItem[1]}钢</span>`
      : ''
  const band = fatigueBand(ship.cond)
  const condClass = row.dock
    ? ' dock'
    : ship.cond >= 50
      ? ' sp'
      : band === 'red'
        ? ' bad'
        : band === 'orange'
          ? ' tired'
          : ''
  const condBody = row.dock ? '渠' : `${ship.cond >= 50 ? '<span class="s">✦</span>' : ''}${ship.cond}`
  let kaiHtml = '<span class="fin">无更高改造</span>'
  if (row.kai.state === 'ready') {
    kaiHtml = `<span class="go">可改造 ✓ ${esc(row.kai.next)}</span>${row.kai.blueprint ? `<span class="sub">${esc(row.kai.blueprint)}</span>` : ''}`
  } else if (row.kai.state === 'near') {
    kaiHtml = `<span class="near">${esc(row.kai.next)} · 差 <b>${row.kai.gap}</b> 级${row.kai.expGap != null ? `<i class="exp" title="到改造等级还差的总经验">总${row.kai.expGap.toLocaleString()}</i>` : ''}</span>`
  } else if (row.kai.state === 'flip') {
    // 双向转换与单向缺口不是一回事，中性色 + ⇄ 标出来，别混进待办
    kaiHtml = `<span class="flip" title="双向形态切换 · 达到等级后可双向切换">⇄ ${esc(row.kai.next)} · 差 <b>${row.kai.gap}</b> 级${row.kai.expGap != null ? `<i class="exp" title="到转换等级还差的总经验">总${row.kai.expGap.toLocaleString()}</i>` : ''}</span>`
  }
  const modDots = row.modMax
    .map((maxed, i) => `<s class="${maxed ? ['f', 't', 'a', 'r'][i] : 'o'}"></s>`)
    .join('')
  // 补强增设那一格描金边（exslot，与编队面板同一套），别的什么都不变：
  // 这条图标带把 slotEx 直接拼在常规格后面，样式一模一样，不描就只能靠
  // 「排在最后」认——而排在最后的未必是它（装满 5 格时它根本被 slice 切掉）。
  const equips = [...ship.slot, ship.slotEx]
    .filter((id) => id > 0)
    .slice(0, 5)
    .map((id) => {
      const inst = mg.slotitems[id]
      const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
      if (!mst) return ''
      return equipTypeIconHtml(mst.iconId, {
        className: id === ship.slotEx ? 'xs exslot' : 'xs',
        title: entityNamePlain('equip', inst!.mstId, mst.name),
      })
    })
    .join('')
  const cls = [
    ship.id === state.selected ? 'on' : '',
    state.compare.includes(ship.id) ? 'cmp' : '',
    row.dup ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ')
  // 婚后的上限只认 shared/ship-growth 的 MARRIED_LEVEL_CAP（依据 KC3Kai 经验表：
  // Lv188 到下一级 = 0）。这里原来手写 185，与同文件属性条图例的 188 自相矛盾。
  const marriedCap = ship.lv > 99 ? MARRIED_LEVEL_CAP : 99
  return `<tr class="${cls}" data-id="${ship.id}">
    <td class="nm"><span class="qa-namecell">${shipThumbHtml(ship.shipId, entityNamePlain('ship', ship.shipId, name), { className: 'table' })}<span class="qa-namecopy"><b>${entityNameHtml('ship', ship.shipId, name, { compact: true })}</b>${row.fav ? '<i class="fav-mini" title="已收藏">★</i>' : ''}${badges.join('')}${dockSub}</span></span></td>
    <td class="cls">${esc(row.typeCn)}</td>
    <td class="lv"><b>${ship.lv}</b><span class="xb"><i style="width:${Math.min(100, (ship.lv / marriedCap) * 100)}%"></i></span></td>
    <td class="nx cx">${ship.expNext > 0 ? fmtK(ship.expNext) : 'MAX'}</td>
    <td class="cd"><span class="cnd${condClass}">${condBody}</span></td>
    <td class="rmd">${kaiHtml}</td>
    <td class="mod cx">${modDots}</td>
    <td class="luck cx">${ship.lucky}</td>
    <td class="lk cx"><span class="${ship.locked ? 'on2' : 'off2'}">${ship.locked ? '●' : '○'}</span></td>
    <td class="eqs cx">${equips}</td>
  </tr>`
}

// 实例属性条（2026-08-11 用户要的三层拆解）：目前裸值 / 装备给予 / 可提升。
// 条条与图鉴属性区同一根标尺同一套色语；计算口径见 shared/ship-stat-layers.ts。
const QA_STAT_LEGEND_HTML = `<div class="stat-legend">
  <span><i style="background:var(--accent-dim)"></i>目前裸值</span>
  <span><i style="background:var(--stat-equip)"></i>装备给予</span>
  <span><i style="background:var(--stat-grow)"></i>成长余量→99</span>
  <span><i style="background:var(--stat-over99)"></i>婚后→${MARRIED_LEVEL_CAP}</span>
  <span><i style="background:var(--stat-marriage)"></i>结婚耐久</span>
  <span><i style="background:var(--stat-mod)"></i>改修余量</span>
</div>`

const instanceStatBarsHtml = (row: Row): string => {
  const { ship } = row
  const mst = mg.master.ships[ship.shipId]
  // 主数据未就绪时退回文字药丸——画一半的条比不画更误导
  if (!mst) {
    return `<div class="pv-stats">
      <span class="s">运 <b>${ship.lucky}</b></span>
      <span class="s">回避 <b>${ship.kaihi}</b></span>
      <span class="s">对潜 <b>${ship.taisen}</b></span>
      <span class="s">索敌 <b>${ship.sakuteki}</b></span>
    </div>`
  }
  const equips = [...ship.slot, ship.slotEx]
    .filter((id) => id > 0)
    .map((id) => mg.slotitems[id])
    .filter(Boolean)
    .map((inst) => mg.master.slotitems[inst!.mstId])
    .filter(Boolean)
  // 三维初始值：2026-08-22 起统一走第一方 `ship-stats` 汇编包（口径同图鉴属性区，
  // 一处汇编两处用）。原先是 kcwiki 直读 + wikiwiki 舰页兜底两段拼，两边各写一份口径。
  const init: GrowthInitValues = {
    kaihi: shipGrowthEndpointsOf(ship.shipId, 'evasion', ship.kaihiMax).init,
    taisen: shipGrowthEndpointsOf(ship.shipId, 'asw', ship.taisenMax).init,
    sakuteki: shipGrowthEndpointsOf(ship.shipId, 'los', ship.sakutekiMax).init,
  }
  const bars = instanceStatRows(ship, mst, equips, init)
    .map((r) => statRowLayered(r.label, r.bare, r.segments, r.tip))
    .join('')
  return `<div class="pv-statbars">${QA_STAT_LEGEND_HTML}<div class="stat-grid">${bars}</div></div>`
}

// 装备加成（面板反推）：口径同锐的编队详情与鉴的「装备加成」Tab，一处实现三处用。
// 全 ★0 时差值即纯装备加成；带改修时是「加成 + 改修」合计，措辞分开不含糊。
const bonusLineHtml = (ship: PlayerShip) => {
  const bonus = panelBonusOf(ship)
  if (!bonus?.any) return ''
  const cells = bonus.rows
    .filter((r) => r.observed !== 0)
    .map((r) => `<span class="s">${r.label} <b style="color:var(--${r.observed > 0 ? 'ok' : 'bad'})">${r.observed > 0 ? '+' : ''}${r.observed}</b></span>`)
    .join('')
  return `<div class="pv-stats">
    <span class="s" style="color:var(--dim)">${bonus.pure ? '装备加成' : '装备加成+改修★'}</span>${cells}</div>`
}

// 履历行的措辞、点色与日期格式都在 ../ship-life-events 里（人生记录弹窗摆的是
// 同一条时间轴，文案源只许有一份）。这里只管把它嵌进卡片。

/** 卡标题行右侧那枚开窗钮。弹窗与这张卡说的是同一艘，所以按钮就长在标题行上。 */
const lifeWindowButtonHtml = (rosterId: number) =>
  `<button class="life-pop" data-act="life-window">弹窗</button>
    <span class="r">舰娘 ID ${rosterId}</span>`

const lifeCardHtml = (row: Row | undefined): string => {
  if (!row) return ''
  const report = lifeReports.get(row.ship.id)
  if (!report) {
    const state = lifeFailed.has(row.ship.id)
      ? '本地记录读取失败'
      : lifeLoading.has(row.ship.id)
        ? '正在读取本地记录……'
        : '记录读取中'
    return `<div class="pcard life-card"><div class="h"><b>人生记录</b>${lifeWindowButtonHtml(row.ship.id)}</div>
      <div class="life-empty">${state}</div></div>`
  }
  const winRate = report.winRate == null ? '—' : `${Math.round(report.winRate * 100)}%`
  const practiceWinRate =
    report.practiceWinRate == null ? '—' : `${Math.round(report.practiceWinRate * 100)}%`
  const hurt = shipLifeDamageText(report)
  const events = report.events.slice(0, 40).map((event) => lifeEventHtml(event)).join('')
  const since = report.trackingSince
    ? `自 ${fmtDate(report.trackingSince)} 起记录`
    : '等待下一次舰队同步'
  return `<div class="pcard life-card">
    <div class="h"><b>人生记录</b>${lifeWindowButtonHtml(row.ship.id)}</div>
    <div class="life-metrics">
      <span><small>记录经验</small><b>+${report.expGained.toLocaleString()}</b></span>
      <span><small>出击</small><b>${report.sorties}</b></span>
      <span title="B 以上计胜利"><small>出击胜利 B+</small><b>${report.wins}/${report.battles} · ${winRate}</b></span>
      <span><small>演习胜利 B+</small><b>${report.practiceWins}/${report.practiceBattles} · ${practiceWinRate}</b></span>
      <span><small>MVP</small><b>${report.mvps}</b></span>
      <span class="hurt${hurt.partial ? ' partial' : ''}" title="${esc(hurt.dealtTitle)}"><small>造成伤害${
        hurt.partial ? '（部分）' : ''
      }</small><b>${hurt.dealt}</b></span>
      <span class="hurt${hurt.partial ? ' partial' : ''}" title="${esc(hurt.title)}"><small>承受伤害${
        hurt.partial ? '（部分）' : ''
      }</small><b>${hurt.damage}</b></span>
      <span class="hurt${hurt.partial ? ' partial' : ''}" title="${esc(hurt.title)}"><small>大破</small><b>${hurt.taiha}</b></span>
    </div>
    <div class="life-sub">Boss ${report.bossBattles} 战 · 改造 ${report.remodels} 次</div>
    <div class="life-timeline">${events || '<div class="life-empty">暂无事件</div>'}</div>
    <div class="life-foot">${esc(since)}</div>
  </div>`
}

// 现在装着什么——「装备给予」条的段是它们给的，装备清单必须能就地对读
const equipLinesHtml = (ship: PlayerShip): string => {
  const entries: { instId: number; ex: boolean; idx: number }[] = []
  ship.slot.forEach((instId, idx) => {
    if (instId > 0) entries.push({ instId, ex: false, idx })
  })
  if (ship.slotEx > 0) entries.push({ instId: ship.slotEx, ex: true, idx: -1 })
  if (!entries.length) {
    return '<div class="dv-eq-empty">未装备</div>'
  }
  const rows = entries
    .map(({ instId, ex, idx }) => {
      const inst = mg.slotitems[instId]
      const mstEq = inst ? mg.master.slotitems[inst.mstId] : undefined
      if (!inst || !mstEq) {
        return `<div class="dv-eq"><span class="nm" style="color:var(--dim)">装备 ${instId}（名称未同步）</span></div>`
      }
      const onslot = !ex && Array.isArray(ship.onslot) ? ship.onslot[idx] : null
      return `<div class="dv-eq">${equipTypeIconHtml(mstEq.iconId, {
        className: 'xs',
        title: entityNamePlain('equip', inst.mstId, mstEq.name),
      })}<span class="nm">${elink('mstEquip', inst.mstId, mstEq.name)}</span>
        ${inst.level > 0 ? `<b class="star">★${inst.level}</b>` : ''}
        ${inst.alv > 0 ? alvIconHtml(inst.alv) : ''}
        ${ex ? '<i class="tag">增设</i>' : onslot != null && onslot > 0 ? `<i class="tag">搭载 ${onslot}</i>` : ''}
      </div>`
    })
    .join('')
  return `<div class="dv-eqs">${rows}</div>`
}

const previewHtml = (row: Row) => {
  const { ship } = row
  const name = masterShipName(ship.shipId)
  const wiki = kcwikiByMst.get(ship.shipId)
  const chainCount = Object.values(mg.ships).filter((s) => s.shipId === ship.shipId).length
  let chainHtml = `<span class="pv-node on">${entityNameHtml('ship', ship.shipId, name, { compact: true })}</span><span class="pv-arr">无更高改造</span>`
  if (row.kai.state !== 'final') {
    const req =
      row.kai.state === 'ready'
        ? `条件已满足 ✓${row.kai.blueprint ? `<br>${esc(row.kai.blueprint)}` : ''}`
        : `${row.kai.state === 'flip' ? '双向转换 · ' : ''}距转换等级 ${row.kai.gap} 级${row.kai.expGap != null ? ` · 总${row.kai.expGap.toLocaleString()}` : ''}`
    chainHtml = `<span class="pv-node on">${entityNameHtml('ship', ship.shipId, name, { compact: true })}</span><span class="pv-arr">${req}</span>
      <span class="pv-node"${row.kai.state === 'ready' ? ' style="border-color:var(--ok);color:#a5e0bb"' : ''}>${esc(row.kai.next)}</span>`
  }
  return `
    ${shipThumbHtml(ship.shipId, name, { className: 'preview' })}
    <div class="pv-name">${elink('mstShip', ship.shipId, name)}<button class="pv-fav${isFavoriteRoster(ship.id) ? ' on' : ''}" data-act="fav-roster"
      title="收藏当前舰娘 · 临近改造中置顶">${isFavoriteRoster(ship.id) ? '★ 已收藏' : '☆ 收藏'}</button></div>
    <div class="pv-yomi">${esc(row.mst?.api_yomi ?? '')}${(() => {
      const cls = wiki?.级别 ?? shipProfileByMst.get(ship.shipId)?.shipClass
      return Array.isArray(cls) ? ` · ${esc(cls[0])} ${cls[1]}号舰` : ''
    })()}</div>
    <div class="pv-line">
      <span class="pv-pill">Lv <b${ship.lv === 99 ? ' style="color:var(--gold)"' : ''}>${ship.lv}</b></span>
      <span class="pv-pill">累计经验 <b>${ship.expTotal.toLocaleString()}</b></span>
      <span class="pv-pill">士气 <b${
        ship.cond >= 50
          ? ' style="color:var(--gold)"'
          : fatigueBand(ship.cond) === 'red'
            ? ' style="color:var(--bad)"'
            : fatigueBand(ship.cond) === 'orange'
              ? ' style="color:var(--warn)"'
              : ''
      }>${ship.cond >= 50 ? '✦' : ''}${ship.cond}</b></span>
      <span class="pv-pill">HP <b>${ship.nowhp}/${ship.maxhp}</b></span>
      <span class="pv-pill">同形态 <b>×${chainCount}</b></span>
    </div>
    ${
      ship.nowhp < ship.maxhp && !row.dock && ship.ndockTime > 0
        ? `<div class="pv-line repair-quote"><span class="pv-pill">预计修理 <b>${repairDuration(ship.ndockTime)}</b></span>
          <span class="pv-pill">${entityTermHtml('material', 0, '燃料')} <b>${ship.ndockItem[0]}</b></span>
          <span class="pv-pill">${entityTermHtml('material', 2, '钢材')} <b>${ship.ndockItem[1]}</b></span></div>`
        : ''
    }
    <div class="pv-chain">${chainHtml}</div>
    ${instanceStatBarsHtml(row)}
    ${equipLinesHtml(ship)}
    <div class="pv-stats">
      <span class="s">夜战 <b>${row.yasen}</b></span>
      <span class="s">改修★合计 <b>${row.starSum}</b></span>
    </div>
    ${bonusLineHtml(ship)}
    <label class="pv-personal"><span>本舰备注 · ID ${ship.id}</span>
      <input id="qa-roster-note" maxlength="120" value="${esc(shipRosterNote(ship.id))}"
        placeholder="与图鉴共用 · 写 #标签 可进筛选"></label>
    ${(() => {
      // 备注里认出来的标签摆一排：框里是纯文本（input 描不了色），玩家看不出
      // 「#水打」到底算没算数——认出来的原样摆在下面，就是这一层的回执。
      // 点一枚 = 回列表只看这个标签，与右边的「筛选同名」同一种去向。
      const tags = noteTagsOf(ship.id)
      if (!tags.length) return ''
      return `<div class="pv-ntags">${tags
        .map((tag) => `<span class="ntag" data-ntag="${esc(tag)}" title="回列表只看带 #${esc(tag)} 的舰娘">#${esc(tag)}</span>`)
        .join('')}</div>`
    })()}
    <div class="pv-acts">
      <span class="pv-act" data-act="filter-same">筛选同名 ${chainCount} 艘</span>
      <span class="pv-act" data-act="compare">${state.compare.includes(ship.id) ? '移出对比' : '加入对比'}</span>
    </div>`
}

const cmpbarHtml = (rows: Row[]) => {
  if (state.compare.length < 2) return ''
  const items = state.compare
    .map((id) => rows.find((r) => r.ship.id === id))
    .filter(Boolean) as Row[]
  if (items.length < 2) return ''
  const best = {
    yasen: Math.max(...items.map((r) => r.yasen)),
    kaihi: Math.max(...items.map((r) => r.ship.kaihi)),
    lucky: Math.max(...items.map((r) => r.ship.lucky)),
    star: Math.max(...items.map((r) => r.starSum)),
  }
  const mark = (v: number, m: number) => (v === m ? `<span class="win">${v}</span>` : `${v}`)
  const cells = items
    .map(
      (r) => `<span class="cb"><b>${entityNameHtml('ship', r.ship.shipId, masterShipName(r.ship.shipId), { compact: true })}</b>
        <span class="cv">夜战 ${mark(r.yasen, best.yasen)} · 回避 ${mark(r.ship.kaihi, best.kaihi)} · 运 ${mark(r.ship.lucky, best.lucky)} · ★${mark(r.starSum, best.star)}</span></span>`,
    )
    .join('<span style="color:var(--dim)">vs</span>')
  return `<div class="cmpbar">${cells}
    <span style="color:var(--dim);font-size:10px">绿 = 占优</span>
    <span class="x9" data-act="clear-cmp">✕</span></div>`
}

// ---- 筛选的配套排序（2026-08-18 用户拍板砍掉视图预设行）----
// 预设行原来是「筛选 + 排序」的打包快捷键，四个带筛选的预设与筛选 chip
// 一一重复（改造规划=可改造、推荐练级=临近改造、清理=未锁重复、修理队列=待修），
// 纯排序的两个（练度/活动准备）与表头排序重复。现在点亮筛选 chip 时顺手
// 套上它的自然排序，之后点表头可覆盖；关闭筛选不动排序。
const SMART_SORTS: Record<string, { sortKey: string; sortDir: number }> = {
  kai: { sortKey: 'lv', sortDir: -1 },
  // 推荐练级：与演习页的卡同一套口径，但这页不随游戏切到演习而自动跳转
  leveling: { sortKey: 'kaigap', sortDir: 1 },
  dupe: { sortKey: 'lv', sortDir: 1 }, // 清理从低级开始
  repair: { sortKey: 'ndock', sortDir: -1 },
  dock: { sortKey: 'ndock', sortDir: -1 },
}
const applySmart = (smart: string | null) => {
  state.smart = smart
  const bundled = smart ? SMART_SORTS[smart] : undefined
  if (bundled) {
    state.sortKey = bundled.sortKey
    state.sortDir = bundled.sortDir
  }
}

export const openRosterCleanup = () => {
  showRosterView()
  // 与另三个外部入口（locateShipInList / locateRosterInList / locateEquipHolders）
  // 同一套清场：搜索词与「装备中清单」也得清，否则「清理视图」可能带着上一次的
  // 装备过滤进来，chip 上的数与表里的行对不上。
  state.search = ''
  state.stypeChip = '全部'
  state.equipFilter = 0
  state.equipFilterName = ''
  state.noteTags = []
  applySmart('dupe')
  state.selected = 0
  render()
}

// ---- 导出 CSV（11/07 稿）：导出「当前筛选+排序后所见」，所见即所得 ----
// 转义/BOM/文件名戳/对话框写盘走 csv-export 的共用收口（与仓库、编成互通同一份）；
// 反馈仍是这枚 .lk2 角标，文案不变。
const exportCsv = async (rows: Row[]) => {
  const header = ['舰名', '舰种', 'Lv', '距升级经验', '士气', '改造', '近代化改修', '运', '锁', '装备★合计', '锁船标签', '备注']
  const table: (string | number)[][] = [header]
  for (const r of rows) {
    const kai =
      r.kai.state === 'final'
        ? '无更高改造'
        : r.kai.state === 'ready'
          ? `可改造 → ${r.kai.next}`
          : r.kai.state === 'flip'
            ? `双向转换 ⇄ ${r.kai.next} 差 ${r.kai.gap} 级${r.kai.expGap != null ? ` 总${r.kai.expGap}` : ''}`
            : `${r.kai.next} 差 ${r.kai.gap} 级${r.kai.expGap != null ? ` 总${r.kai.expGap}` : ''}`
    table.push([
      masterShipName(r.ship.shipId),
      r.typeCn,
      r.ship.lv,
      r.ship.expNext,
      r.ship.cond,
      kai,
      r.modMax.every(Boolean) ? '已满' : r.modMax.filter(Boolean).length + '/4',
      r.ship.lucky,
      r.ship.locked ? '●' : '',
      r.starSum,
      r.ship.sallyArea > 0 ? `标签${r.ship.sallyArea}` : '',
      shipRosterNote(r.ship.id),
    ])
  }
  const outcome = await saveTextFile(
    {
      title: '导出舰娘列表',
      defaultPath: stampedFileName('kanso-ships', 'csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      logLabel: '舰娘列表 CSV 导出',
    },
    csvText(table),
  )
  // 用户自己取消不算失败，角标不动
  if (outcome.status === 'canceled') return
  // 写盘会失败（目标目录被占、只读介质、杀软拦截）。原来没有 catch，抛出去之后
  // 角标一直挂着「导出 CSV」，看起来像什么都没发生——失败必须照实说失败。
  const badge = pane.querySelector('.lk2')
  if (badge) {
    badge.textContent = outcome.status === 'failed' ? '导出失败 ✕' : `已导出 ${rows.length} 行 ✓`
    setTimeout(() => badge && (badge.textContent = '导出 CSV'), 2600)
  }
}

const loadLife = async (rosterId: number) => {
  const generation = lifeGeneration
  // 履历里的图/点要写成玩家认的字母，字母表到手后重渲一次（没到手先写 `#号`）
  ensureMapCellLetters(() => {
    if (pane?.isConnected) deferPassive(pane, 'qa', render)
  })
  // 「手上这份是不是最新代」取代「有没有数据」当去重条件——数据现在不会被清空了
  if (lifeLoaded.get(rosterId) === generation || lifeLoading.has(rosterId)) return
  lifeLoading.add(rosterId)
  try {
    const report = await queryShipLife(rosterId, 80)
    lifeFailed.delete(rosterId)
    if (generation === lifeGeneration) {
      lifeReports.set(rosterId, report)
      lifeLoaded.set(rosterId, generation)
    }
  } catch (error) {
    // 不要塞一份全 0 的报告顶上——那等于告诉玩家「这艘舰没打过任何仗」，
    // 是把读取故障报告成事实。记成失败，让 UI 照实说读不出来。
    console.warn('[kanso] 舰娘人生记录读取失败', rosterId, error)
    lifeFailed.add(rosterId)
    // 失败也记为「这一代已处理」，否则每次重渲染都会再打一遍同一个必败的查询
    lifeLoaded.set(rosterId, generation)
  } finally {
    lifeLoading.delete(rosterId)
  }
  if (state.selected === rosterId && pane?.isConnected) deferPassive(pane, 'qa', render)
}

// 详情页的进场动画只在用户主动打开时放一次；mg 数据推着的重渲染不再重播
let detailEnter = false

/** 单独界面（2026-08-11 用户拍板）：点行后整个面板切到这一艘的详情页，
 *  不是行下展开也不是侧栏——「详情预览」那套下接式被他当场否掉。 */
const detailHtml = (row: Row): string => {
  const name = masterShipName(row.ship.shipId)
  return `<div class="qa-detail${detailEnter ? ' enter' : ''}">
    <div class="dv-head">
      <span class="back" data-act="dv-back" title="返回列表（Esc）">← 返回列表</span>
      <span class="crumb">${esc(row.typeCn)} › <b>${entityNameHtml('ship', row.ship.shipId, name, { compact: true })}</b></span>
      <span class="sp"></span>
      <span class="r" data-act="pv-open">在图鉴中打开 →</span>
    </div>
    <div class="dv-body">
      <div class="dv-cols">
        <div class="pcard"><div id="qa-pv">${previewHtml(row)}</div></div>
        ${lifeCardHtml(row)}
      </div>
    </div>
  </div>`
}

/** 回列表时还原**进详情前的滚动位置**——单独界面接管过整个面板，
 *  列表滚动在切换时留不住（结构不同，视图状态键对不上），所以进详情时自己记。
 *  不能改回「把那一艘滚回视野中央」：在详情里收藏/取消收藏会改她的排序位次，
 *  追着行滚会把视口带去她的新位置（2026-08-16 用户实锤：
 *  顶端取消收藏一艘后返回，列表翻到了一页开外）。 */
let listScrollTop = 0

/** 当前布局下**真正在滚**的那个容器。宽态是 .twrap（表格自己滚）；窄态
 *  CSS 把 .twrap 设成 overflow:visible、改由 .qa-app 整页滚（index.html 的
 *  `.mod-qa.narrow .qa-app` 一段）。一律打在 .twrap 上的话，窄布局里
 *  捕获拿到 0、还原也写进一个不滚的元素，「详情→返回」永远回顶部。
 *  narrow 类只决定优先顺序，真正的判据是「谁装不下自己的内容」。 */
const listScrollerOf = (): HTMLElement | null => {
  const order = pane.classList.contains('narrow')
    ? ['.qa-app', '.twrap']
    : ['.twrap', '.qa-app']
  const candidates = order
    .map((selector) => pane.querySelector<HTMLElement>(selector))
    .filter((element): element is HTMLElement => !!element)
  return candidates.find((element) => element.scrollHeight > element.clientHeight)
    ?? candidates[0]
    ?? null
}

const backToList = () => {
  state.selected = 0
  render()
  requestAnimationFrame(() => {
    const scroller = listScrollerOf()
    if (scroller) scroller.scrollTop = listScrollTop
  })
}

/** 临近改造视图的分组分界（2026-08-18 用户拍板的「分组置顶」）：排序已保证
 *  收藏→进阶→初段，这里只在两组之间插一条说明行——不筛掉、不藏内容。
 *  只有按「按等级/按经验」正序时组才是连续的；用户改用别的表头排序就不插。 */
const levelingTbodyHtml = (rows: Row[]): string => {
  const grouped =
    state.smart === 'leveling' &&
    (state.sortKey === 'kaigap' || state.sortKey === 'kaiexp') &&
    state.sortDir === 1
  const boundary = grouped ? rows.findIndex((row) => !row.fav && !rowAdvanced(row)) : -1
  return rows
    .map(
      (row, i) =>
        `${
          i === boundary && boundary > 0
            ? '<tr class="lvl-tier-row"><td colspan="10" title="目标是链上第一段改，改造等级不到 45">—— 初段改造 ——</td></tr>'
            : ''
        }${rowHtml(row)}`,
    )
    .join('')
}

// ---- 筛选区那排标签片的收纳（2026-09-01 用户提）----
// 「#内容会平铺开 如果量大了不就会挤占下文内容？」——标签是玩家自己写在备注里的，
// 写多少就有多少枚片。平铺下去筛选区一路长高，把表顶到看不见。所以默认只留一行。
//
// 两档，都是**量**出来的，不掐死枚数：片宽随标签字数变（`#E1` 与 `#E1_甲战力保存`
// 差一倍不止），面板还有宽窄两档并且可以拖，任何一个固定 N 都会在一半的情形下说谎
// ——宽面板收得太狠，窄面板照样撑高。
//   ① 就地摆得下（这一排没换行）：一枚不收，钮也不出现。两三个标签的档与收纳
//      之前逐像素一致，玩家看不出这里多了一套机关。
//   ② 摆不下：整排挪到**自己那一行**（上面那枚 8px 间隔变成换行符），只留这一行，
//      余下的收进「更多 N ▾」。挪行是必须的——不挪的话这一排是从上一行的尾巴上
//      起头的，尾巴上剩多宽全看筛选片排到哪，实测有大半的宽度档剩不下一枚，
//      「只留一行」就成了「一枚都不给看」。挪到自己那一行，量的才是整条面板宽。
// 做法照 ru 的度量收纳（foldMetricsRow）：摊开量一次、按次序从尾巴往回收、每收一枚
// 复核一拍，直到真的只剩一行。次序就是片的次序（tallyNoteTags：用得多的在前），
// 所以收掉的总是最少用的那几枚。
//
// 一条不让步的：**选中的片一枚都不收**。收进去就是「筛选生效了，可玩家看不见是哪个
// 标签在筛」，而筛选区里已经没有片能把它点掉（口径同 ji 的 .cat-picked：状态不许跟着
// 内容一起藏）。选中的多到一行摆不下时宁可让这一排换行，也不藏——那是玩家自己点出来的。
let tagFold = { signature: '', folded: [] as string[], ownRow: false }

const applyTagFold = (
  chips: HTMLElement[],
  more: HTMLElement,
  gap: HTMLElement,
  folded: string[],
  ownRow: boolean,
) => {
  for (const chip of chips) chip.classList.toggle('nt-folded', folded.includes(chip.dataset.ntag!))
  // 一枚都没收就没有「更多」这回事
  more.classList.toggle('nt-folded', folded.length === 0)
  gap.classList.toggle('nt-row', ownRow)
  const count = more.querySelector('i')
  if (count && folded.length) count.textContent = `${folded.length}`
}

const foldNoteTagChips = () => {
  if (!pane?.isConnected) return
  // 摊开态整排照摆，一枚不收：钮上写着「收起」，此刻不该还有东西藏着
  if (state.tagsOpen) return
  const bar = pane.querySelector<HTMLElement>('.filters')
  if (!bar) return // 详情页没有筛选区
  const chips = [...bar.querySelectorAll<HTMLElement>('.fchip.ntag[data-ntag]')]
  const more = bar.querySelector<HTMLElement>('[data-ntag-more]')
  const gap = bar.querySelector<HTMLElement>('[data-ntag-gap]')
  if (!chips.length || !more || !gap) return
  // 行宽 0 = 面板还没显示（模块没激活 / 分区切走了）。此刻量出来的结论是「全都放不下」，
  // 会把整排收干净；真显示出来时 ResizeObserver 还会来一次，不必在这里瞎猜。
  const probe = bar.clientWidth
  if (probe <= 0) return
  const signature = `${probe}|${chips
    .map((chip) => `${chip.dataset.ntag}${chip.classList.contains('on') ? '*' : ''}`)
    .join(',')}`
  // 缓存命中是**照着重贴一遍**，不是跳过：重渲会把 DOM 整个换掉（收纳类跟着没了），
  // 而同样的宽度、同样的片、同样的选中，结论本来就是同一份。
  if (signature === tagFold.signature) {
    applyTagFold(chips, more, gap, tagFold.folded, tagFold.ownRow)
    return
  }
  // 先按①的样子量：全摊开、不挪行、钮藏起来。量的必须是「就这么摆放不放得下」——
  // 连钮一起量的话，本来正好摆下的一排会因为钮自己换了行而被判成放不下。
  for (const chip of chips) chip.classList.remove('nt-folded')
  more.classList.add('nt-folded')
  gap.classList.remove('nt-row')
  const flatTop = chips[0].offsetTop
  if (chips.every((chip) => chip.offsetTop === flatTop)) {
    applyTagFold(chips, more, gap, [], false)
    tagFold = { signature, folded: [], ownRow: false }
    return
  }
  // ②：挪到自己那一行再收
  gap.classList.add('nt-row')
  more.classList.remove('nt-folded')
  const baseTop = chips[0].offsetTop
  const fits = () =>
    chips.every((chip) => chip.classList.contains('nt-folded') || chip.offsetTop === baseTop) &&
    more.offsetTop === baseTop
  const folded: string[] = []
  for (let i = chips.length - 1; i >= 0; i -= 1) {
    if (fits()) break
    const chip = chips[i]
    if (chip.classList.contains('on')) continue
    chip.classList.add('nt-folded')
    folded.unshift(chip.dataset.ntag!)
  }
  if (folded.length === chips.length) {
    // 一枚都没剩（面板窄到连一枚片加一枚钮都摆不下）。宁可多占一行，也不摆一排
    // 「什么都没有的收纳钮」——那看着就是功能坏了。
    chips[0].classList.remove('nt-folded')
    folded.shift()
  }
  // 收纳只改类，不动 innerHTML：commitPaneHtml 记的那份字符串仍与 DOM 对得上——
  // 下一次渲染生成同样的字符串就该整段跳过，收纳结果本来就是同一份。
  // 唯一被改掉的一处文本是钮上的枚数（写在 <i> 里，渲染出来是占位的 0）：它只有
  // 量完才知道，而重渲换回占位之后这一趟又会重新填上，两边始终自洽。
  applyTagFold(chips, more, gap, folded, true)
  tagFold = { signature, folded, ownRow: true }
}

const render = () => {
  if (!pane) return
  if (!Object.keys(mg.ships).length || !mstShips.size) {
    forgetCommittedHtml(pane, 'qa') // 这一支绕开 commitPaneHtml，记忆不能留着
    pane.innerHTML = `<div class="pane-waiting">
      尚未同步舰娘列表</div>`
    return
  }
  const all = buildRows()
  // 正被查看的实例离开仓库（解体/当素材/击沉）时退回列表，不留一页空详情
  if (state.selected && !all.some((r) => r.ship.id === state.selected)) state.selected = 0
  const detailRow = all.find((r) => r.ship.id === state.selected)
  if (detailRow) {
    // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）；没换 DOM 就不能重绑
    if (!commitPaneHtml(pane, 'qa', detailHtml(detailRow))) return
    detailEnter = false
    wireDetail(detailRow)
    void loadLife(detailRow.ship.id)
    return
  }
  // 备注标签的片：只数**在籍**的（离籍舰的备注还留着，把它算进角标就是
  // 「片上写 3、点开只有 2」）。一个标签都没写过时这一段是空的，筛选区
  // 不会多出任何东西。
  const tagTally = tallyNoteTags(all.map((r) => shipRosterNote(r.ship.id)))
  if (state.noteTags.length) {
    // 备注被改掉、或带着这个标签的舰离籍之后，条件本身就没了。留着它只会是
    // 一张永远空的表，而筛选区里已经没有任何一枚片能把它点掉。
    const alive = new Set(tagTally.map((entry) => entry.tag))
    state.noteTags = state.noteTags.filter((tag) => alive.has(tag))
  }
  const rows = applyFilters(all)
  sortRows(rows)

  const { counts, repairList } = tallyRows(all)
  const smartChip = (key: string, label: string, extra = '') =>
    `<span class="fchip q ${extra}${state.smart === key ? ' on' : ''}" data-smart="${key}"><b style="font-weight:400">${label}</b><i>${counts[key as keyof typeof counts]}</i></span>`

  const tagChip = (entry: NoteTagTally) =>
    `<span class="fchip ntag${state.noteTags.includes(entry.tag) ? ' on' : ''}" data-ntag="${esc(entry.tag)}" title="备注里写着 #${esc(entry.tag)} 的舰娘 · 多选 = 带其中任一个">#${esc(entry.tag)}<i>${entry.count}</i></span>`

  // 收纳钮。收起态默认藏着（class nt-folded），由 foldNoteTagChips 量完再决定露不露、
  // 数字写多少——摆得下就一直藏着，玩家看到的与没有这套收纳时一模一样。
  // 反过来「默认露着、放不下才藏」的话，量之前那一帧会先闪一枚「更多 0」。
  const tagMoreChip = state.tagsOpen
    ? '<span class="fchip ntag more on" data-ntag-more="1" title="标签收回一行">收起 ▴</span>'
    : '<span class="fchip ntag more nt-folded" data-ntag-more="1" title="展开其余标签">更多 <i>0</i> ▾</span>'

  const th = (key: string, label: string, extra = '') =>
    `<th class="${extra}${state.sortKey === key ? ' sort' : ''}" data-sort="${key}">${label}${state.sortKey === key ? (state.sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`
  const mobileSort = [
    ['name', '舰名'],
    ['type', '舰种'],
    ['lv', '等级'],
    ['cond', '状态'],
    ['luck', '运'],
    ['star', '装备★'],
  ]
    .map(([key, label]) => `<span class="${state.sortKey === key ? 'on' : ''}" data-sort="${key}">${label}${state.sortKey === key ? (state.sortDir < 0 ? ' ▼' : ' ▲') : ''}</span>`)
    .join('')

  const html = `<div class="qa-app">
      <div class="main">
        <div class="topbar">
          <div class="search">⌕<input id="qa-search" placeholder="名字 / 假名 / 舰级 / 舰种" value="${esc(state.search)}"></div>
        </div>
        ${
          state.equipFilter
            ? `<div class="eqfilter">装备中清单：<b>${elinkHtml(
                'mstEquip',
                state.equipFilter,
                // 调用方（ji.ts 装备图鉴的右键目标）传的是主数据的日文 api_name；
                // 在这里查表，免得「装备中清单：12.7cm連装砲」这样上屏
                entityTermHtml(
                  'mstEquip',
                  state.equipFilter,
                  entityNamePlain(
                    state.equipFilter >= 1500 ? 'abyssEquip' : 'equip',
                    state.equipFilter,
                    state.equipFilterName,
                  ),
                ),
              )}</b>
                <span>共 ${rows.length} 艘装备中</span>
                <span class="x9" data-act="clear-eqfilter" title="取消此筛选">✕</span></div>`
            : ''
        }
        <div class="filters">
          ${STYPE_CHIPS.map(([label]) => `<span class="fchip${label === state.stypeChip ? ' on' : ''}" data-stype="${label}">${label}</span>`).join('')}
          <span style="width:8px"></span>
          ${smartChip('kai', '可改造')}
          ${smartChip('leveling', '临近改造')}
          ${
            state.smart === 'leveling'
              ? `<span class="fchip lvlsub${state.sortKey === 'kaigap' ? ' on' : ''}" data-lvlorder="kaigap" title="按缺少等级排序">按等级</span><span class="fchip lvlsub${state.sortKey === 'kaiexp' ? ' on' : ''}" data-lvlorder="kaiexp" title="按缺少总经验排序">按经验</span><span class="fchip lvlsub${state.lvlFinal ? ' on' : ''}" data-lvlfinal="1" title="仅显示下一段改造为链尾的舰娘">最终改造</span>`
              : ''
          }
          ${smartChip('marry', 'Lv99 待誓约', 'gold ')}
          ${smartChip('tired', '疲劳', 'warn ')}
          ${smartChip('dupe', '未锁重复')}
          ${smartChip('infleet', '在编')}
          ${smartChip('dock', '入渠中')}
          ${smartChip('repair', '待修', 'warn ')}
          ${
            tagTally.length
              ? `<span class="nt-gap${state.tagsOpen ? ' nt-row' : ''}" data-ntag-gap="1"></span>${tagTally
                  .map(tagChip)
                  .join('')}${tagMoreChip}`
              : ''
          }
        </div>
        ${repairSummaryHtml(repairList)}
        <div class="qa-sort-mobile"><b>排序</b>${mobileSort}</div>
        <div class="twrap"><table>
          <thead><tr>
            ${th('name', '舰名')}${th('type', '类')}${th('lv', 'Lv')}<th class="cx" style="text-align:right">距升级</th>
            ${th('cond', '士气', 'cd ')}${th('kaigap', '改造')}<th class="cx">近代化</th>
            ${th('luck', '运', 'cx ')}<th class="cx" style="text-align:center">锁</th>${th('star', '装备★', 'cx ')}
          </tr></thead>
          <tbody>${levelingTbodyHtml(rows)}</tbody>
        </table></div>
        ${cmpbarHtml(all)}
        <div class="statusbar">
          持有 <b>${all.length}</b> · 显示 <b>${rows.length}</b> · 选中 <b>${state.compare.length}</b>
          <span>Shift=对比 · Alt=钉小窗</span>
          <span class="lk2" data-act="export-csv" title="导出当前筛选与排序后的 ${rows.length} 行">导出 CSV</span>
        </div>
      </div>
    </div>`
  if (!commitPaneHtml(pane, 'qa', html)) return

  wire()
  // 换过 DOM 才需要重收：输出没变的那一支上面已经 return，DOM 与收纳结果都还是原样
  foldNoteTagChips()
}

// ---- 交互 ----

const wire = () => {
  const searchInput = pane.querySelector<HTMLInputElement>('#qa-search')
  // 走 onFilterInput 而不是裸 input：重渲会把输入框元素整个换掉，
  // 输入法的组合会话绑在那个元素上，换一次就断（见 kernel 第三道闸门）
  if (searchInput) {
    onFilterInput(searchInput, () => {
      state.search = searchInput.value
      render()
      pane.querySelector<HTMLInputElement>('#qa-search')?.focus()
    })
  }
  pane.querySelector('.filters')?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.fchip')
    if (!chip) return
    if (chip.dataset.stype) {
      state.stypeChip = chip.dataset.stype
    } else if (chip.dataset.smart) {
      // 点亮筛选时套上配套排序（SMART_SORTS），关闭时排序保持原样
      applySmart(state.smart === chip.dataset.smart ? null : chip.dataset.smart)
    } else if (chip.dataset.lvlorder) {
      // 临近改造的「按等级/按经验」子分类：直接切排序轴，两个都是小的在前
      state.sortKey = chip.dataset.lvlorder
      state.sortDir = 1
    } else if (chip.dataset.lvlfinal) {
      // 「最终改造」子筛选开关，与排序子分类同排
      state.lvlFinal = !state.lvlFinal
    } else if (chip.dataset.ntag) {
      // 备注标签可以并选（并集），所以这一枚是**加减**，不是像舰种那样的互斥切换
      const tag = chip.dataset.ntag
      state.noteTags = state.noteTags.includes(tag)
        ? state.noteTags.filter((picked) => picked !== tag)
        : [...state.noteTags, tag]
    } else if (chip.dataset.ntagMore) {
      // 摊开/收回那一排标签片。这是玩家自己按的，重渲随便换 DOM——
      // 与被动补丁引发的重渲不同，没有「把正按着的那颗钮的 click 吃掉」这回事。
      state.tagsOpen = !state.tagsOpen
    }
    render()
  })
  pane.querySelectorAll<HTMLElement>('[data-sort]').forEach((control) => {
    control.addEventListener('click', () => {
      const key = control.dataset.sort!
      if (state.sortKey === key) state.sortDir *= -1
      else {
        state.sortKey = key
        // 名字/舰种/改造级差是「小的在前」才符合直觉，其余数值列默认降序
        state.sortDir = key === 'name' || key === 'type' || key === 'kaigap' ? 1 : -1
      }
      render()
    })
  })
  pane.querySelector('[data-act="export-csv"]')?.addEventListener('click', () => {
    const sorted = applyFilters(buildRows())
    sortRows(sorted)
    void exportCsv(sorted)
  })
  pane.querySelector('tbody')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.el')) return
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]')
    if (!tr) return
    const me = e as MouseEvent
    const id = parseInt(tr.dataset.id!, 10)
    // Shift 对比 / Alt 钉窗两条老路径先于打开详情，不能被它吃掉
    if (me.altKey || me.ctrlKey) {
      pinEntityPeek({ type: 'ship', id }, tr)
      return
    }
    if (me.shiftKey) {
      if (state.compare.includes(id)) {
        state.compare = state.compare.filter((x) => x !== id)
      } else if (state.compare.length < 4) {
        state.compare.push(id)
      }
      render()
      return
    }
    // 单击 = 进入这一艘的单独界面（整面板接管；下接式预览已被用户否掉）
    listScrollTop = listScrollerOf()?.scrollTop ?? 0 // 返回时还原到这里（窄宽两套容器）
    state.selected = id
    detailEnter = true
    render()
  })
  pane.querySelector('[data-act="clear-cmp"]')?.addEventListener('click', () => {
    state.compare = []
    render()
  })
  pane.querySelector('[data-act="clear-eqfilter"]')?.addEventListener('click', () => {
    state.equipFilter = 0
    state.equipFilterName = ''
    render()
  })
}

const wireDetail = (row: Row) => {
  pane.querySelector('[data-act="dv-back"]')?.addEventListener('click', backToList)
  pane.querySelector('[data-act="pv-open"]')?.addEventListener('click', () => {
    navigate({ type: 'mstShip', id: row.ship.shipId })
  })
  pane.querySelector('[data-act="filter-same"]')?.addEventListener('click', () => {
    // 筛选是列表的事：带着「同名」条件回列表
    state.search = masterShipName(row.ship.shipId)
    state.stypeChip = '全部'
    state.smart = null
    state.noteTags = []
    state.selected = 0
    render()
  })
  pane.querySelectorAll<HTMLElement>('.pv-ntags [data-ntag]').forEach((chip) => {
    chip.addEventListener('click', () => {
      // 详情里点标签 = 带着这一个标签回列表，与「筛选同名」同一种去向
      state.search = ''
      state.stypeChip = '全部'
      state.smart = null
      state.noteTags = [chip.dataset.ntag!]
      state.selected = 0
      render()
    })
  })
  pane.querySelector('[data-act="fav-roster"]')?.addEventListener('click', () => {
    toggleFavoriteRoster(row.ship.id)
    invalidateRowCache() // 行上的 ★ 与临近改造排序都吃这份缓存
    render()
  })
  // 弹窗：同一艘再点一次是把已经开着的那扇拿到前面来，不会开出第二扇
  //（主进程按在籍 id 记着开过哪几扇）。
  pane.querySelector('[data-act="life-window"]')?.addEventListener('click', () => {
    void openShipLifeWindow(row.ship.id)
  })
  pane.querySelector('[data-act="compare"]')?.addEventListener('click', () => {
    const id = row.ship.id
    if (state.compare.includes(id)) state.compare = state.compare.filter((x) => x !== id)
    else if (state.compare.length < 4) state.compare.push(id)
    render()
  })
  const rosterNote = pane.querySelector<HTMLInputElement>('#qa-roster-note')
  rosterNote?.addEventListener('change', () => {
    setShipRosterNote(row.ship.id, rosterNote.value)
    // change 只在**提交/失焦**时来一次（不是每键击），所以这里重渲一次把
    // 刚认出来的标签摆到框下面，输入链上的三道闸门一根都没碰。
    // 但要走推迟闸门：change 是被 mousedown 的失焦带出来的，此刻按下与抬起
    // 之间——直接换 DOM 会把玩家正点着的那颗按钮的 click 吃掉。
    deferPassive(pane, 'qa', render)
  })
  rosterNote?.addEventListener('keydown', (e) => {
    // 组合中的回车是敲定候选那一下（实测它照样带 isComposing），
    // 当成「填完了」把框失焦，玩家的词就被打断在半路
    if (e.isComposing) return
    if (e.key === 'Enter') rosterNote.blur()
  })
}

// 外部定位入口（鉴的「舰娘列表定位」目标）
export const locateShipInList = (mstId: number) => {
  const instance = Object.values(mg.ships).find((s) => s.shipId === mstId)
  if (instance) {
    locateRosterInList(instance.id)
    return
  }
  showRosterView()
  state.search = masterShipName(mstId)
  state.stypeChip = '全部'
  state.smart = null
  state.noteTags = []
  state.equipFilter = 0
  state.selected = 0
  render()
}

/** 外部定位入口：按玩家持有实例 ID 直接打开她的单独界面，不在副舰之间串档。 */
export const locateRosterInList = (rosterId: number) => {
  const instance = mg.ships[rosterId]
  if (!instance) return
  showRosterView()
  state.search = ''
  state.stypeChip = '全部'
  state.smart = null
  state.noteTags = []
  state.equipFilter = 0
  state.selected = rosterId
  detailEnter = true
  render()
}

/** 装备图鉴的「装备中清单」：筛出身上装着这件装备的在籍舰 */
export const locateEquipHolders = (equipMstId: number, name: string) => {
  showRosterView()
  state.search = ''
  state.stypeChip = '全部'
  state.smart = null
  state.noteTags = []
  state.selected = 0
  state.equipFilter = equipMstId
  state.equipFilterName = name
  render()
}

// 在籍舰实例实体（instance 级——与 mstShip 的图鉴级区分）
registerEntityRoute('ship', {
  colorClass: 'e-ship',
  open(ref) {
    const id = ref.num
    locateRosterInList(id)
  },
  peek(ref) {
    const id = ref.num
    const ship = mg.ships[id]
    if (!ship) return null
    const b = (v: unknown) => `<b style="color:var(--text)">${v}</b>`
    return {
      title: `${entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId))} Lv${ship.lv}`,
      typeLabel: '现有舰娘',
      media: shipThumbHtml(ship.shipId, entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId)), { className: 'preview' }),
      lines: [
        `<span style="font-family:var(--mono);font-size:10px">火${b(ship.karyoku)} 雷${b(ship.raisou)} 空${b(ship.taiku)} 甲${b(ship.soukou)} 避${b(ship.kaihi)}</span>`,
        `<span style="font-family:var(--mono);font-size:10px">潜${b(ship.taisen)} 索${b(ship.sakuteki)} 运${b(ship.lucky)} · ★${b(starSumOf(ship))}</span>`,
        `HP ${ship.nowhp}/${ship.maxhp} · 士气 ${ship.cond}${ship.locked ? ' · 已锁定' : ' · 未锁定'}`,
      ],
      primary: '舰娘列表',
    }
  },
  targets(ref) {
    const id = ref.num
    const ship = mg.ships[id]
    const deck = ship ? mg.decks.find((entry) => entry.ships.includes(ship.id)) : null
    return ship
      ? [
          ...(deck
            ? [{
                label: `编队 · 定位第${deck.id}舰队中的这艘舰娘`,
                run: () => navigate({ type: 'fleetShip', id: ship.id }),
              }]
            : []),
          { label: '图鉴 · 改装链与资料', run: () => navigate({ type: 'mstShip', id: ship.shipId }) },
        ]
      : [{ label: '舰娘图鉴', disabled: true, hint: '当前未持有该舰娘' }]
  },
})

registerEntityRoute('shipCapacity', {
  colorClass: 'e-ship',
  open: openRosterCleanup,
  peek() {
    const current = Object.keys(mg.ships).length
    const maximum = mg.basic?.maxShips ?? 0
    return {
      title: '舰娘仓库',
      typeLabel: '容量',
      lines: [
        `当前 <b>${current}</b> / ${maximum || '—'}`,
        maximum ? `剩余 <b>${Math.max(0, maximum - current)}</b> 格` : '容量上限尚未同步 · 返港后同步',
      ],
      primary: '舰娘列表 · 清理视图',
    }
  },
})

/** 主数据的形态表。活动开幕/游戏更新会下发新的 start2——只在装配时建一次的话，
 *  会话中途新增的形态在列表里 mst 一直是 undefined（舰种、近代化上限全空）。
 *  与钦的九张反查索引同一节奏：收到 master 补丁就整表重建。
 *  先建新表再整体换上，中途不会出现「空表」被 render 当成主数据未就绪。 */
const loadMasterShips = async (): Promise<boolean> => {
  const raw = await queryMasterRaw()
  if (!raw?.data) return false
  const next = new Map<number, any>()
  for (const s of raw.data.api_mst_ship ?? []) {
    if (s.api_sortno) next.set(s.api_id, s)
  }
  mstShips = next
  return true
}

const initializeRosterView = () => {
  if (initialized) return
  initialized = true
  // 初始视图：全部舰种 + 按 Lv 降序（原「练度」预设的口径；预设行 2026-08-18 已砍）
  // Esc 从单独界面回列表（返回按钮的键盘同义词）。输入框里按 Esc 不劫持——
  // 那是「放弃编辑」的语义，不该顺手把整页也关了。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (!state.selected || !pane?.isConnected || !pane.offsetWidth) return
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
    e.preventDefault()
    backToList()
  })
  void (async () => {
    await loadMasterShips()
    const kcwiki = await queryLode('kcwiki-ships')
    kcwikiByMst = new Map()
    if (kcwiki?.data) {
      for (const entry of Object.values<any>(kcwiki.data)) {
        if (entry?.ID) kcwikiByMst.set(entry.ID, entry)
      }
    }
    const shipProfile = await queryLode('wikiwiki-ship-profile')
    shipProfileByMst = new Map()
    for (const entry of Object.values<any>(shipProfile?.data ?? {})) {
      if (Number(entry?.shipId) > 0) shipProfileByMst.set(Number(entry.shipId), entry)
    }
    // 三维初始值走第一方 ship-stats 汇编包（与面板反推共用 fleet-calc 那一份，不各拉各的）
    await ensureShipStatsLode()
    invalidateRowCache()
    if (pane?.isConnected) deferPassive(pane, 'qa', render)
  })()
  onMgChange((keys) => {
    if (keys.includes('master')) {
      invalidateRemodelOrder()
      // 新 start2 到手 → 形态表整体重建；建好再作废行缓存重渲一次
      void loadMasterShips().then((rebuilt) => {
        if (!rebuilt) return
        invalidateRowCache()
        if (pane?.isConnected) deferPassive(pane, 'qa', render)
      })
    }
    // decks 也要作废行缓存：在编标注读的是编队反查表，改编成后不作废就是旧账
    if (keys.some((k) => ['ships', 'slotitems', 'ndocks', 'decks', 'basic', 'master'].includes(k))) {
      invalidateRowCache()
    }
    if (keys.some((k) => ['ships', 'slotitems', 'sortie'].includes(k))) {
      // 一场战斗会同时改变多艘舰，所以整批作废而不是只作废当前选中的那艘。
      // 但只推进代号、不 clear：直接清掉会让正在看的「人生记录」塌成
      // 「正在读取…」再填回来，出击中每场战斗闪一次。新数据到了静默换上。
      lifeGeneration += 1
    }
    if (
      pane?.isConnected &&
      keys.some((k) => ['ships', 'slotitems', 'ndocks', 'decks', 'basic', 'master', 'sortie'].includes(k))
    ) {
      // 用户正按在这块面板上就让到抬起之后（按下与抬起之间换掉 DOM，click 不会发生）；
      // 正在用输入法打字同理，让到组合结束——换掉 DOM 会把组合会话一起换没。
      // 持续滚动时也让到安静窗之后，免得滚动中的 DOM 被替换。
      deferPassive(pane, 'qa', render)
    }
  })
  // 行内的入渠倒计时（data-cd）原本永不刷新：qa 没有 onTick，而抬头状态条的
  // updateCountdowns 只扫它自己的 host，够不到这个宿主。挂机时数字冻在渲染那一刻。
  // qa 是常驻单例（initialized 闸保证只跑一次），这里的永久注册与上面的
  // onMgChange 同一口径——宿主断开时靠 isConnected 空转，不会漏活也不会叠。
  onTick(() => {
    if (!pane?.isConnected || !pane.offsetWidth) return
    const now = Date.now()
    // 刚跨过完工时刻的那一秒重渲一次：fmtCountdown 到期只会把文字翻成「完成」，
    // 而整行的状态（士气格的「渠」、待修合账、入渠中角标）还挂在 row.dock 上。
    // 干等游戏的下一个 ndocks 补丁的话，挂机时可能几分钟都停在旧样子。
    const crossed = [...pane.querySelectorAll<HTMLElement>('[data-cd]')].some((el) => {
      const at = parseInt(el.dataset.cd!, 10)
      return Number.isFinite(at) && at > lastCountdownTick && at <= now
    })
    lastCountdownTick = now
    if (crossed) deferPassive(pane, 'qa', render)
    else updateCountdowns(pane)
  })
}

/** 由「鉴」的列表分区挂载；切走分区后宿主会断开，再次进入时接回同一份筛选状态。 */
export const mountRosterView = (element: HTMLElement) => {
  pane = element
  if (!rosterResizeObserver) {
    rosterResizeObserver = new ResizeObserver(() => {
      const narrow = element.clientWidth < 700
      // 窄态把表格重排成多行卡片、并把滚动容器从 .twrap 换成 .qa-app
      // （CSS 在 index.html 的 .mod-qa.narrow 一段）。跨过阈值时渲染出的
      // 结构与滚动落点都不同，得重渲染一次。
      if (element.classList.contains('narrow') !== narrow) {
        element.classList.toggle('narrow', narrow)
        render()
      }
      // 宽度一变，「一行摆得下几枚标签」就跟着变。跨没跨窄档阈值都要重量一次：
      // 跨阈值那次只是换了个类，render 生成的字符串多半与上次一模一样、整段跳过，
      // 收纳挂在它后面就永远等不到。
      foldNoteTagChips()
    })
    rosterResizeObserver.observe(element)
  }
  element.classList.toggle('narrow', element.clientWidth < 700)
  initializeRosterView()
  render()
}

export const refreshRosterView = () => {
  if (pane?.isConnected) render()
}
