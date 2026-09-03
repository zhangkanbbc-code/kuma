// 鉴 · 仓库（装备在籍轴）。与鉴的关系照搬舰娘那一侧：
// 装备图鉴 = 收藏轴（有哪些装备、怎么改修），仓库 = 在籍轴（我手上这几件在哪、能不能动）。
//
// 舰娘早就有列表 + 清理预设 + CSV，装备一侧只有图鉴——抬头点装备容量进的是图鉴，
// 想找「哪些能拆」得自己一件件翻。这一卷补的就是这条路径。
//
// 三条纪律：
// ① **三级收拢**。同一门炮持有 97 件，逐件铺开只是噪声：
//    款（12.7cm连装炮 ×97）→ 同状态档（装备中 ★0 ×55 / 闲置 ★0 未锁 ×40）
//    → 具体实例（装在哪艘舰的第几格）。
//    每级都「已装备的在前，其余按改修星级倒序」——装备中的动它要先卸下来，
//    改修过的别被误当素材拆掉。闲置档不再往下分：那几十件在每个字段上都一样。
// ② **「能不能动」只按游戏给的事实判**：装在谁身上、锁没锁。
//    不替用户判断「该不该拆」——那是他的事，这里只把依据摆全。
// ③ **不代操作**。废弃、改修、卸装一律在游戏里做，这里只出清单。
import { alvIconHtml } from '../alv-icon'
import { bgmPreviewHtml } from '../bgm-preview'
import { useItemIconHtml } from '../entity-art'
import {
  EQUIP_CHIPS,
  airborneEquipTypesOf,
  equipChipMatches,
  isAirborneEquip,
} from '../equip-category'
import {
  effectiveEquipCategory,
  equipCategoryFallbackName,
} from '../../shared/equip-high-angle'
import { equipTypeIconHtml } from '../equip-icon'
import { CAPACITY_EXEMPT_EQUIP_IDS, countCapacitySlotitems } from '../equip-capacity'
import { furnitureImageUrl } from '../kcs-image'
import {
  esc,
  masterShipName,
  mg,
  commitPaneHtml,
  deferPassive,
  onFilterInput,
  onMgChange,
  queryMasterRaw,
  uiGet,
  uiSet,
} from '../kernel'
import { elinkHtml, registerEntityRoute } from '../link'
import { firstTextTitle, installSectionFolding } from '../section-fold'
import { entityNameHtml, entityNamePlain } from '../localization'
import { isFavoriteEquipInstance, toggleFavoriteEquipInstance } from '../equip-personal'
import { csvText, saveTextFile, stampedFileName } from '../csv-export'

import type { SlotitemInstance } from '../../shared/mg-types'
import { compareDisplayNames } from '../../shared/name-order'
import { equipHolderMap } from '../../shared/equipped-slots'
import type { OccupiedHolder } from '../../shared/equipped-slots'
import { equipStockSignature } from '../../shared/equip-stock-signature'

// 「被谁占着」那两档住在 shared（三处判据的唯一出处）；仓库卷自己多一档「闲置」。
type Holder = { kind: 'idle' } | OccupiedHolder

interface Row {
  id: number // 装备实例 id
  inst: SlotitemInstance
  name: string
  type2: number
  type0: number // api_type[0] 大分類：分组 chip 的逐件陆航例外要用
  iconId: number
  holder: Holder
  sameMst: number // 同 mstId 的持有总数
  spare: boolean // 闲置且未锁 —— 「现在就能拿去用掉」的那一批
  exempt: boolean // 不占仓库容量（消耗品类）
}

// 装备类别名只在 api_start2 原始报文里（mg.master 没有这一张表）。
// 取一次存着；取不到就退回「分类 N」，不编名字。
let equipTypeNames = new Map<number, string>()

// ---- 装饰品（家具）----
// 主数据同样只在 start2 原始报文里；持有列表在 mg.furnitures（require_info/家具屋同步）。
// 名字是日文原名照排——家具没有可靠的中文翻译矿脉，不自己编译名。
interface FurnitureMst {
  id: number
  type: number
  title: string
  description: string
  rarity: number
  price: number
  saleflg: number
  bgmId: number // api_bgm_id：部分家具附带专属母港 BGM，0 = 无
}

// 六类中文名按日文原分类直译（床=日文「床」即地板）；原文进悬停
const FURNITURE_TYPE_LABELS: [string, string][] = [
  ['地板', '床'],
  ['壁纸', '壁紙'],
  ['窗', '窓'],
  ['壁挂', '壁掛'],
  ['家具', '家具'],
  ['桌子', '机'],
]

let furnitureMst: FurnitureMst[] = []
let furnitureMstRequested = false
// 等主数据到货的回调排成一列。原来只认第一位调用者：先开着装饰品视图、
// 再从任务奖励点家具进来，后来那一位就永远等不到重绘。
// 同一个回调不重复入列——装饰品视图每 render 一次就 ensure 一次，
// 不去重会攒出上百份同样的重绘。
const furnitureMstWaiters: (() => void)[] = []
const queueFurnitureMstWaiter = (onReady: () => void) => {
  if (!furnitureMstWaiters.includes(onReady)) furnitureMstWaiters.push(onReady)
}

// 装饰品视图正开着才值得为「主数据到货」重绘一次
const renderIfFurnitureView = () => {
  const host = pane
  if (!host?.isConnected || state.view !== 'furniture') return
  // 用户正按在这块面板上就让到抬起之后（按下与抬起之间换掉 DOM，click 不会发生）；
  // 正在用输入法打字同理，让到组合结束——换掉 DOM 会把搜索框连同组合会话一起换没。
  // 持续滚动时也让到安静窗之后，免得滚动中的 DOM 被替换。
  deferPassive(host, 'es', render)
}

const loadFurnitureMst = () => {
  if (furnitureMstRequested) return
  furnitureMstRequested = true
  void (async () => {
    let list: unknown = null
    try {
      const raw = await queryMasterRaw()
      list = raw?.data?.api_mst_furniture
    } catch (error) {
      console.warn('[kanso] 家具主数据读取失败', error)
    }
    if (!Array.isArray(list)) {
      // 首次运行还没抓到 api_start2。**必须复位**：锁死的话
      //「登录一次即可」那句承诺永远不会兑现（等着的回调也留在队里等下一次）。
      furnitureMstRequested = false
      return
    }
    furnitureMst = list.map((f: any) => ({
      id: Number(f.api_id),
      type: Number(f.api_type),
      title: `${f.api_title ?? ''}`,
      description: `${f.api_description ?? ''}`.replace(/<br\s*\/?>/gi, '\n'),
      rarity: Number(f.api_rarity ?? 0),
      price: Number(f.api_price ?? 0),
      saleflg: Number(f.api_saleflg ?? 0),
      bgmId: Number(f.api_bgm_id ?? 0),
    }))
    for (const notify of furnitureMstWaiters.splice(0)) {
      // 一个坏回调不许拖垮排在它后面的（内核派发同一条纪律）
      try {
        notify()
      } catch (error) {
        console.warn('[kanso] 家具主数据回调失败', error)
      }
    }
  })()
}

const ensureFurnitureMst = (onReady?: () => void) => {
  if (furnitureMst.length) return
  if (onReady) queueFurnitureMstWaiter(onReady)
  loadFurnitureMst()
}

// 装备类别名同样只在 start2 原始报文里。取不到就复位闩：主数据到货时再试。
let equipTypeNamesRequested = false
const loadEquipTypeNames = () => {
  if (equipTypeNamesRequested) return
  equipTypeNamesRequested = true
  void (async () => {
    let list: unknown = null
    try {
      const raw = await queryMasterRaw()
      list = raw?.data?.api_mst_slotitem_equiptype
    } catch (error) {
      console.warn('[kanso] 装备类别名读取失败', error)
    }
    if (!Array.isArray(list)) {
      equipTypeNamesRequested = false
      return
    }
    equipTypeNames = new Map(list.map((t: any) => [t.api_id, t.api_name]))
    const host = pane
    if (!host?.isConnected) return
    // 同上：按下期间与输入法组合期间都不换 DOM，持续滚动时也让到安静窗之后。
    deferPassive(host, 'es', render)
  })()
}

let pane: HTMLElement | null = null
let resizeObserver: ResizeObserver | null = null
let openStockView: (() => void) | null = null

export const setStockViewOpener = (open: () => void) => {
  openStockView = open
}

const state = {
  view: 'equip' as 'equip' | 'furniture', // 仓库两轴：装备 | 装饰品（家具）
  search: '',
  chip: '全部',
  smart: null as string | null,
  sortKey: 'star',
  sortDir: -1,
  selected: 0, // 选中的**实例** id，右侧预览用（0 = 不显示预览）
  expanded: new Set<number>(), // 展开到「同状态档」的 mstId
  openVariants: new Set<string>(), // 再展开到具体实例的档
  typeFilter: 0, // 「更多分类」选的精确 api_type[2]
  moreOpen: false,
  furnitureFocus: 0, // 从任务/链接跳进来要高亮的家具 id（一次性，不持久化）
  furnitureOpen: 0, // 点开详情（预览图 + 介绍）的家具 id，再点收起
  furnitureScope: 'owned' as 'owned' | 'all', // 持有 | 全部（未持有灰显，仍可看图看介绍）
}

// ---- 行数据 ----

// 装备实例 → 它现在在哪。舰上与陆航都要查：只查舰上会把陆航的机体报成闲置，
// 那是最危险的一种错——用户照着「闲置」去废弃，拆掉的是正在出击的攻击机。
// 判据本体在 shared/equipped-slots（ji 的改修素材口径用的是同一份）；
// 这里只管把当前母港喂进去，「不在表里 = 闲置」的兜底留在 buildRows。
const buildHolders = (): Map<number, OccupiedHolder> =>
  equipHolderMap(Object.values(mg.ships), mg.airBases)

let rowCache: Row[] | null = null
let rowCacheSignature = equipStockSignature(Object.values(mg.ships), mg.airBases, mg.slotitems)
const invalidateStockRowsIfEquipmentChanged = (): boolean => {
  const next = equipStockSignature(Object.values(mg.ships), mg.airBases, mg.slotitems)
  if (next === rowCacheSignature) return false
  rowCacheSignature = next
  rowCache = null
  return true
}

// 航空类别集合（熟练度列的判据）：**装配期按主数据算一次**，渲染只查表。
// 判据本身住在 equip-category（那边写了为什么是 api_distance 而不是类别白名单）；
// 这里只管「主数据换了就重算」——源对象换身份即失效，同 shipClassNameIndex 的写法。
let airborneSource: unknown = null
let airborneTypes: ReadonlySet<number> = airborneEquipTypesOf(null)
const airborneTypesNow = (): ReadonlySet<number> => {
  if (airborneSource !== mg.master.slotitems) {
    airborneSource = mg.master.slotitems
    airborneTypes = airborneEquipTypesOf(mg.master.slotitems)
  }
  return airborneTypes
}

const buildRows = (): Row[] => {
  if (rowCache) return rowCache
  rowCacheSignature = equipStockSignature(Object.values(mg.ships), mg.airBases, mg.slotitems)
  const holders = buildHolders()
  const countByMst = new Map<number, number>()
  for (const inst of Object.values(mg.slotitems)) {
    countByMst.set(inst.mstId, (countByMst.get(inst.mstId) ?? 0) + 1)
  }
  rowCache = Object.entries(mg.slotitems).map(([rawId, inst]) => {
    const id = Number(rawId)
    const mst = mg.master.slotitems[inst.mstId]
    const holder = holders.get(id) ?? { kind: 'idle' as const }
    return {
      id,
      inst,
      name: mst?.name ?? `装备 ${inst.mstId}`,
      type2: mst?.type2 ?? 0,
      type0: mst?.type0 ?? -1,
      iconId: mst?.iconId ?? 0,
      holder,
      sameMst: countByMst.get(inst.mstId) ?? 1,
      spare: holder.kind === 'idle' && !inst.locked,
      exempt: CAPACITY_EXEMPT_EQUIP_IDS.has(inst.mstId),
    }
  })
  return rowCache
}

const SMART_FILTERS: Record<string, { label: string; hint: string; test: (row: Row) => boolean }> = {
  spare: {
    label: '可动用',
    hint: '闲置且未锁',
    test: (row) => row.spare,
  },
  idle: { label: '闲置', hint: '未装备于舰娘或基地航空队 · 含已锁定项', test: (row) => row.holder.kind === 'idle' },
  unlocked: { label: '未锁', hint: '全部未锁定装备 · 含当前装备项', test: (row) => !row.inst.locked },
  dupe: {
    label: '重复',
    hint: '同款持有 2 件以上 · 当前项闲置未锁定',
    test: (row) => row.sameMst > 1 && row.spare,
  },
  starred: { label: '已改修', hint: '★ 1 以上', test: (row) => row.inst.level > 0 },
  starMax: { label: '★max', hint: '改修满级（★10）', test: (row) => row.inst.level >= 10 },
  skilled: { label: '熟练>0', hint: '有舰载机熟练度的机体', test: (row) => row.inst.alv > 0 },
}

const applyFilters = (rows: Row[]): Row[] => {
  let out = [...rows]
  // 精确类别优先于分组 chip：从「更多分类」选的就是要精确看那一类
  // 精确类别按**有效类别**判：小口径主炮里图标是高角的那一族单独成类
  //（游戏的筛选就是分开的；判据见 renderer/equip-category 的 effectiveEquipCategory）
  if (state.typeFilter) {
    return applyRest(
      out.filter((r) => effectiveEquipCategory(r.type2, r.iconId) === state.typeFilter),
    )
  }
  if (state.chip !== '全部') out = out.filter((r) => equipChipMatches(state.chip, r.type2, r.type0))
  return applyRest(out)
}

// 智能筛选与搜索：走精确类别或走分组 chip 都要过这一关
const applyRest = (rows: Row[]): Row[] => {
  let out = rows
  const smart = state.smart ? SMART_FILTERS[state.smart] : null
  if (smart) out = out.filter(smart.test)
  if (state.search) {
    const q = state.search.toLowerCase()
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        entityNamePlain('equip', r.inst.mstId, r.name).toLowerCase().includes(q),
    )
  }
  return out
}

// 排序键都取「越大越靠前」的自然方向，方向由 sortDir 统一翻
const HOLDER_RANK: Record<Holder['kind'], number> = { idle: 0, airBase: 1, ship: 2 }

// 一款装备一组。同一门炮持有 97 件，逐件铺开只是噪声——
// 列表按款显示，点开才看实例。
interface Group {
  mstId: number
  name: string
  type2: number
  iconId: number
  exempt: boolean
  rows: Row[] // 通过筛选的实例
  owned: number // 该款持有总数（不受筛选影响）
  onShip: number
  onAir: number
  idle: number
  locked: number
  spare: number
  maxStar: number
  maxAlv: number
}

/**
 * 展开后的实例顺序：**已装备的在前，其余按改修星级倒序**。
 * 装备中的那几件是「动它要先卸下来」的，先看到才好判断；
 * 剩下的按 ★ 从高到低，改修过的不容易被误当成素材拆掉。
 */
const instanceOrder = (a: Row, b: Row): number => {
  const equipped = (row: Row) => (row.holder.kind === 'idle' ? 1 : 0)
  return (
    equipped(a) - equipped(b) ||
    b.inst.level - a.inst.level ||
    b.inst.alv - a.inst.alv ||
    a.id - b.id
  )
}

const groupRows = (rows: Row[], all: Row[]): Group[] => {
  const ownedByMst = new Map<number, number>()
  for (const row of all) ownedByMst.set(row.inst.mstId, (ownedByMst.get(row.inst.mstId) ?? 0) + 1)
  const byMst = new Map<number, Row[]>()
  for (const row of rows) {
    const list = byMst.get(row.inst.mstId)
    if (list) list.push(row)
    else byMst.set(row.inst.mstId, [row])
  }
  return [...byMst.entries()].map(([mstId, list]) => {
    const sorted = [...list].sort(instanceOrder)
    return {
      mstId,
      name: sorted[0].name,
      type2: sorted[0].type2,
      iconId: sorted[0].iconId,
      exempt: sorted[0].exempt,
      rows: sorted,
      owned: ownedByMst.get(mstId) ?? sorted.length,
      onShip: sorted.filter((r) => r.holder.kind === 'ship').length,
      onAir: sorted.filter((r) => r.holder.kind === 'airBase').length,
      idle: sorted.filter((r) => r.holder.kind === 'idle').length,
      locked: sorted.filter((r) => r.inst.locked).length,
      spare: sorted.filter((r) => r.spare).length,
      maxStar: Math.max(...sorted.map((r) => r.inst.level)),
      maxAlv: Math.max(...sorted.map((r) => r.inst.alv)),
    }
  })
}

/**
 * 同状态档：一款之内，改修 / 熟练 / 锁定 / 去向类别都相同的实例算一档。
 * 闲置的那几十件在这些字段上全都一样，逐条列出来没有任何信息量。
 */
interface Variant {
  key: string
  kind: Holder['kind']
  level: number
  alv: number
  locked: boolean
  rows: Row[]
  /** 还能不能再往下分：装在舰上/陆航的能看「在谁身上」，闲置的往下全一样 */
  drillable: boolean
}

const variantsOf = (group: Group): Variant[] => {
  const byKey = new Map<string, Row[]>()
  for (const row of group.rows) {
    const key = `${group.mstId}:${row.holder.kind}:${row.inst.level}:${row.inst.alv}:${row.inst.locked ? 1 : 0}`
    const list = byKey.get(key)
    if (list) list.push(row)
    else byKey.set(key, [row])
  }
  return [...byKey.entries()]
    .map(([key, rows]) => ({
      key,
      kind: rows[0].holder.kind,
      level: rows[0].inst.level,
      alv: rows[0].inst.alv,
      locked: rows[0].inst.locked,
      rows: [...rows].sort(instanceOrder),
      drillable: rows[0].holder.kind !== 'idle',
    }))
    .sort(
      (a, b) =>
        HOLDER_RANK[b.kind] - HOLDER_RANK[a.kind] || // 装备中在前
        b.level - a.level ||
        b.alv - a.alv ||
        Number(a.locked) - Number(b.locked),
    )
}

const SORTERS: Record<string, (a: Group, b: Group) => number> = {
  // 按装备名 = 显示中文名的拼音序（2026-08-21 用户拍板，口径见 shared/name-order）。
  // group.name 是日文原名，只当没有译名时的回退——屏幕上写的是 entityName 解出来的那个。
  name: (a, b) =>
    compareDisplayNames(
      entityNamePlain('equip', a.mstId, a.name),
      entityNamePlain('equip', b.mstId, b.name),
    ),
  type: (a, b) => a.type2 - b.type2 || a.mstId - b.mstId,
  star: (a, b) => a.maxStar - b.maxStar,
  alv: (a, b) => a.maxAlv - b.maxAlv,
  // 「所在」按最靠近可动用的那一端排：闲置多的靠前
  where: (a, b) => b.idle - a.idle,
  // 「锁」列的轴：这一款当前列出的实例里有几件锁着（就是那一格显示的数）。
  // 与 star/alv 同样写成升序，方向交给 sortDir；首击给 1（见点表头那段），
  // 于是箭头 ▴ 与「件数由少到多」对得上，锁得最少的浮在最前——
  // 看这一列本来就是在挑动得了的，全锁死的排后面才对。
  locked: (a, b) => a.locked - b.locked,
  // 表头上不再有入口（那一列改挂 locked 了），但这个轴仍然活着：
  // openEquipCleanup 默认按它排，且存档恢复要靠 SORTERS[saved.sortKey] 认出它。
  dupe: (a, b) => a.rows.length - b.rows.length,
}

// ---- 渲染 ----

const holderHtml = (holder: Holder): string => {
  if (holder.kind === 'idle') return '<span class="es-idle">闲置</span>'
  if (holder.kind === 'airBase') {
    return `<span class="es-air">基地航空 第${holder.rid}队 · ${holder.slot} 格</span>`
  }
  const name = masterShipName(holder.shipId)
  const slot = holder.ex ? '补强增设' : `${holder.slot} 格`
  return `<span class="es-ship">${elinkHtml('ship', holder.rosterId, entityNameHtml('ship', holder.shipId, name, { compact: true }))} · ${slot}</span>`
}

const starHtml = (level: number) =>
  level > 0
    ? `<b class="es-star${level >= 10 ? ' max' : ''}">★${level >= 10 ? 'max' : `+${level}`}</b>`
    : '<span class="es-dim">—</span>'

// 熟练度只有舰载机才有；非舰载机显示 — 而不是 0，0 会被读成「熟练度是零」
const alvHtml = (row: Row) => {
  if (!isAirborneEquip(row.type2, airborneTypesNow())) return '<span class="es-dim">—</span>'
  return row.inst.alv > 0 ? alvIconHtml(row.inst.alv) : '<span class="es-dim">0</span>'
}

// 组行的「所在」：一眼看出这一款有多少动得了、多少要先卸下来
const groupWhereHtml = (group: Group): string => {
  const parts = [
    group.idle ? `<span class="es-idle">闲置 ${group.idle}</span>` : '',
    group.onShip ? `<span class="es-ship">舰上 ${group.onShip}</span>` : '',
    group.onAir ? `<span class="es-air">陆航 ${group.onAir}</span>` : '',
  ].filter(Boolean)
  return parts.join('<span class="es-dim"> · </span>')
}

const groupRowHtml = (group: Group) => {
  const open = state.expanded.has(group.mstId)
  const filtered = group.rows.length < group.owned
  return `<tr class="es-group${open ? ' open' : ''}${group.spare ? ' spare' : ''}" data-mst="${group.mstId}">
    <td class="nm"><span class="es-namecell"><span class="es-caret">${open ? '▾' : '▸'}</span>${equipTypeIconHtml(
      group.iconId,
      { className: 'xs' },
    )}<span class="es-namecopy">
      <b>${elinkHtml('mstEquip', group.mstId, entityNameHtml('equip', group.mstId, group.name, { compact: true }))}</b>
      <span class="es-count"${
        filtered ? ` title="${esc(`持有 ${group.owned} 件，其中 ${group.rows.length} 件符合当前筛选`)}"` : ''
      }>${filtered ? `${group.rows.length}/${group.owned}` : `×${group.owned}`}</span>
      ${group.rows.some((r) => isFavoriteEquipInstance(r.id)) ? '<i class="fav-mini" title="含收藏项">★</i>' : ''}
      ${group.exempt ? '<span class="es-exempt">不占容量</span>' : ''}
    </span></span></td>
    <td class="st cx">${starHtml(group.maxStar)}</td>
    <td class="av cx">${isAirborneEquip(group.type2, airborneTypesNow()) && group.maxAlv > 0 ? alvIconHtml(group.maxAlv) : '<span class="es-dim">—</span>'}</td>
    <td class="wh">${groupWhereHtml(group)}</td>
    <td class="lk cx">${group.locked ? `<span class="on2">${group.locked}</span>` : '<span class="off2">—</span>'}</td>
  </tr>`
}

const VARIANT_KIND_TEXT: Record<Holder['kind'], string> = {
  ship: '装备中',
  airBase: '在陆航',
  idle: '闲置',
}

const variantRowHtml = (variant: Variant, airborne: boolean): string => {
  // 只有一件时再分一级是空转，直接当实例行显示
  if (variant.rows.length === 1 && variant.drillable) return instanceRowHtml(variant.rows[0])
  const open = state.openVariants.has(variant.key)
  const caret = variant.drillable
    ? `<span class="es-caret">${open ? '▾' : '▸'}</span>`
    : '<span class="es-caret dim">·</span>'
  return `<tr class="es-variant${open ? ' open' : ''}${
    variant.kind === 'idle' && !variant.locked ? ' spare' : ''
  }" data-variant="${esc(variant.key)}">
    <td class="nm"><span class="es-namecell">${caret}<span class="es-variantname">${
      VARIANT_KIND_TEXT[variant.kind]
    } <b>×${variant.rows.length}</b></span></span></td>
    <td class="st cx">${starHtml(variant.level)}</td>
    <td class="av cx">${
      airborne && variant.alv > 0 ? alvIconHtml(variant.alv) : '<span class="es-dim">—</span>'
    }</td>
    <td class="wh"><span class="es-dim">${
      variant.drillable ? `${variant.rows.length} 处` : '未装备'
    }</span></td>
    <td class="lk cx"><span class="${variant.locked ? 'on2' : 'off2'}">${variant.locked ? '●' : '○'}</span></td>
  </tr>`
}

const instanceRowHtml = (row: Row) => {
  const cls = [row.id === state.selected ? 'on' : '', row.spare ? 'spare' : ''].filter(Boolean).join(' ')
  const fav = isFavoriteEquipInstance(row.id)
  return `<tr class="es-inst ${cls}" data-eid="${row.id}">
    <td class="nm"><span class="es-instname">${
      row.holder.kind === 'idle' ? '闲置一件' : '装备中'
    }</span><button class="es-fav${fav ? ' on' : ''}" data-fav-equip="${row.id}"
      title="${fav ? '取消收藏这一件' : '收藏这一件'}">${fav ? '★' : '☆'}</button></td>
    <td class="st cx">${starHtml(row.inst.level)}</td>
    <td class="av cx">${alvHtml(row)}</td>
    <td class="wh">${holderHtml(row.holder)}</td>
    <td class="lk cx"><span class="${row.inst.locked ? 'on2' : 'off2'}">${row.inst.locked ? '●' : '○'}</span></td>
  </tr>`
}

/**
 * 右侧（窄布局时在下方）的这一款分布：这一款在你手上的全部分布。
 * 「能动几件」是清理与凑素材真正要的那个数，单看一行看不出来。
 *
 * 只在**明确点了某一件实例**时出现，且可以关掉——原来展开一款就自动选中
 * 第一件，于是这块面板一展开就冒出来、又没有关闭入口，成了「关不掉的页面」。
 *
 * 星级按档汇总（★+3 ×3 · ★0 ×42），不逐颗列：45 件就是 45 个 ★，那不是信息。
 * 逐件的去向表格里已经有了（款 → 同状态档 → 实例），这里不重复。
 */
const previewHtml = (): string => {
  if (!state.selected) return ''
  const current = buildRows().find((r) => r.id === state.selected)
  if (!current) return ''
  const family = buildRows().filter((r) => r.inst.mstId === current.inst.mstId)
  const spare = family.filter((r) => r.spare).length
  const locked = family.filter((r) => r.inst.locked).length
  const onShip = family.filter((r) => r.holder.kind === 'ship').length
  const onAir = family.filter((r) => r.holder.kind === 'airBase').length
  const byStar = new Map<number, number>()
  for (const row of family) byStar.set(row.inst.level, (byStar.get(row.inst.level) ?? 0) + 1)
  const stars = [...byStar.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([level, n]) => `${level > 0 ? `★+${level}` : '★0'} ×${n}`)
    .join(' · ')

  return `<div class="es-preview">
    <div class="es-pv-head">${equipTypeIconHtml(current.iconId, { className: 'sm' })}
      <span><b>${elinkHtml('mstEquip', current.inst.mstId, entityNameHtml('equip', current.inst.mstId, current.name))}</b>
      <span>持有 ${family.length} 件 · ${esc(stars)}</span></span>
      <span class="es-pv-x" data-close-preview title="关闭">×</span></div>
    <div class="es-pv-tally">
      <span class="es-tally ok"><b>${spare}</b>件可动用</span>
      <span class="es-tally"><b>${locked}</b>件已锁</span>
      <span class="es-tally"><b>${onShip}</b>件在舰上</span>
      <span class="es-tally"><b>${onAir}</b>件在陆航</span>
    </div>
    <div class="es-pv-cur">选中的这一件：${starHtml(current.inst.level)} ${holderHtml(current.holder)}${
      current.inst.locked ? ' <span class="es-lockword">已锁</span>' : ''
    }</div>
  </div>`
}

const holderText = (holder: Holder): string => {
  if (holder.kind === 'idle') return '闲置'
  if (holder.kind === 'airBase') return `基地航空 第${holder.rid}队 ${holder.slot}格`
  return `${entityNamePlain('ship', holder.shipId, masterShipName(holder.shipId))} ${holder.ex ? '补强增设' : `${holder.slot}格`}`
}

// 导出的唯一反馈就是这枚徽章（成功与失败都走它），过几秒回到原文案
const flashExportBadge = (text: string) => {
  const badge = pane?.querySelector('.es-export')
  if (!badge) return
  badge.textContent = text
  setTimeout(() => badge && (badge.textContent = '导出 CSV'), 2600)
}

// 转义/BOM/文件名戳/对话框写盘走 csv-export 的共用收口（与列表、编成互通同一份）。
const exportCsv = async (rows: Row[]) => {
  const header = ['装备名', '改修★', '熟练度', '所在', '锁定', '同款持有数', '可动用', '占仓库容量']
  const table: (string | number)[][] = [header]
  for (const r of rows) {
    table.push([
      entityNamePlain('equip', r.inst.mstId, r.name),
      r.inst.level,
      isAirborneEquip(r.type2, airborneTypesNow()) ? r.inst.alv : '',
      holderText(r.holder),
      r.inst.locked ? '●' : '',
      r.sameMst,
      r.spare ? '是' : '',
      r.exempt ? '否' : '是',
    ])
  }
  const outcome = await saveTextFile(
    {
      title: '导出装备仓库',
      defaultPath: stampedFileName('kanso-equips', 'csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      logLabel: '装备仓库导出 CSV',
    },
    csvText(table),
  )
  // 用户自己取消不算失败，徽章不动
  if (outcome.status === 'canceled') return
  // 盘满、只读目录、路径被占……失败要说出来：原来这里什么都不做，
  // 徽章停在「导出 CSV」，用户以为存下了，其实一个字节也没写。
  flashExportBadge(outcome.status === 'failed' ? '导出失败 ✗' : `已导出 ${rows.length} 行 ✓`)
}

/**
 * 「更多分类」。顶栏的 chip 是常用分组，这里把**你实际持有的**每一个装备类别
 * 逐个列出来——图鉴那边按主数据列（有哪些类），仓库按在籍列（你有哪些类），
 * 两边的数字含义不同，各自标清楚。
 */
const moreCategoriesHtml = (): string => {
  if (!state.moreOpen) return ''
  const counts = new Map<number, number>()
  for (const row of buildRows()) {
    const category = effectiveEquipCategory(row.type2, row.iconId)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const cells = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([type2, n]) => {
      const name = equipCategoryFallbackName(type2, equipTypeNames.get(type2))
      return `<span class="cat-cell${state.typeFilter === type2 ? ' on' : ''}" data-equip-type="${type2}">
        ${esc(name)}<i>${n}</i></span>`
    })
  return `<div class="cat-more">
    <div class="cat-more-h">按装备类别精确筛选<span>共 ${cells.length} 类</span></div>
    <div class="cat-grid">${cells.join('')}</div>
  </div>`
}

const SORT_COLUMNS: [string, string, string][] = [
  ['name', 'nm', '装备'],
  ['star', 'st cx', '改修'],
  ['alv', 'av cx', '熟练'],
  ['where', 'wh', '所在'],
  // 这一列显示的是锁定件数，排序轴就该是锁定件数（dupe 轴仍在 SORTERS 里，只是没有表头入口）。
  ['locked', 'lk cx', '锁'],
]

// 仓库两轴的切换钮（两个视图共用一段）
const viewModeHtml = () =>
  `<div class="es-mode">
    <button class="${state.view === 'equip' ? 'on' : ''}" data-es-view="equip">装备</button>
    <button class="${state.view === 'furniture' ? 'on' : ''}" data-es-view="furniture">装饰品</button>
  </div>`

const furnitureRowHtml = (f: FurnitureMst, owned: boolean, placed: boolean, focus: boolean) => {
  const stars = f.rarity > 0 ? `<span class="fst-star">${'★'.repeat(Math.min(f.rarity, 6))}</span>` : ''
  const price = f.saleflg > 0 && f.price > 0 ? `${f.price.toLocaleString()} 币可购` : '非卖品'
  const open = state.furnitureOpen === f.id
  const row = `<div class="fst-row${focus ? ' focus' : ''}${owned ? '' : ' lack'}${open ? ' open' : ''}" data-fid="${f.id}">
    <span class="fst-name">${esc(f.title)}</span>${stars}
    ${placed ? '<span class="fst-active">布置中</span>' : ''}
    ${owned ? '' : '<span class="fst-lack">未持有</span>'}
    <span class="fst-price">${price}</span>
  </div>`
  if (!open) return row
  // 详情：摆放完整图优先；部分家具（壁挂类）没有 normal 树，404 时回退
  // reward 展示卡（家具屋预览那张，实测全员覆盖）。取不到 URL 就只给文字。
  const url = furnitureImageUrl(f.id, 'normal')
  const rewardUrl = furnitureImageUrl(f.id, 'reward')
  return `${row}<div class="fst-detail">
    ${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" data-fst-img${rewardUrl && rewardUrl !== url ? ` data-fst-fallback="${esc(rewardUrl)}"` : ''}>` : ''}
    <div class="fst-desc">${esc(f.description)}</div>
    ${f.bgmId > 0 ? `<div class="fst-bgm">附带母港 BGM：${bgmPreviewHtml(f.bgmId, 'port')}</div>` : ''}
    <div class="fst-meta">${esc(FURNITURE_TYPE_LABELS[f.type]?.[0] ?? '装饰品')}${
      f.rarity > 0 ? ` · ${'★'.repeat(Math.min(f.rarity, 6))}` : ''
    } · ${price}${placed ? ' · 布置中' : ''}</div>
  </div>`
}

// 装饰品视图：默认在籍轴（只列持有的），可切「全部」浏览整本目录——
// 未持有灰显但同样可点开看图看介绍。持有数据未同步时如实说、不打「未持有」。
const renderFurniture = () => {
  if (!pane) return
  ensureFurnitureMst(renderIfFurnitureView)
  const ownedIds = mg.furnitures
  const ownedKnown = ownedIds != null
  const ownedSet = new Set(ownedIds ?? [])
  const placed = new Set(mg.basic?.furnitureLayout ?? [])
  const coins = mg.basic?.furnitureCoins
  const focus = state.furnitureFocus
  const scopeAll = state.furnitureScope === 'all'
  let body: string
  if (!furnitureMst.length) {
    body = '<div class="es-empty">尚未同步游戏数据 · 登录后同步</div>'
  } else if (!scopeAll && !ownedKnown) {
    body = '<div class="es-empty">尚未同步家具数据 · 登录后同步</div>'
  } else {
    body = FURNITURE_TYPE_LABELS.map(([label, jp], type) => {
      const all = furnitureMst.filter((f) => f.type === type)
      const mine = all.filter((f) => ownedSet.has(f.id))
      const shown = scopeAll ? all : mine
      const rows = shown
        .slice()
        .sort(
          (a, b) =>
            (placed.has(b.id) ? 1 : 0) - (placed.has(a.id) ? 1 : 0) ||
            (ownedSet.has(b.id) ? 1 : 0) - (ownedSet.has(a.id) ? 1 : 0) ||
            b.rarity - a.rarity ||
            a.id - b.id,
        )
        .map((f) =>
          furnitureRowHtml(f, !ownedKnown || ownedSet.has(f.id), placed.has(f.id), f.id === focus),
        )
        .join('')
      return `<div class="fst-group">
        <div class="fst-head" title="${esc(jp)}">${label}<i>持有 ${ownedKnown ? mine.length : '?'} / ${all.length}</i></div>
        ${rows || '<div class="fst-none">这一类暂无持有</div>'}
      </div>`
    }).join('')
  }
  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const html = `<div class="es-app">
      <div class="es-bar">
        ${viewModeHtml()}
        <div class="type-chips">
          <span class="chip${scopeAll ? '' : ' on'}" data-fst-scope="owned">持有 ${ownedKnown ? ownedIds!.length : '?'}</span>
          <span class="chip${scopeAll ? ' on' : ''}" data-fst-scope="all">全部 ${furnitureMst.length || '—'}</span>
        </div>
        <span class="es-sp"></span>
        <span class="es-cap fst-coins">${useItemIconHtml(44, '家具币', { className: 'sm' })} ${elinkHtml(
          'useitem',
          44,
          '家具币',
        )} <b>${typeof coins === 'number' ? coins.toLocaleString() : '未同步'}</b>${
          ownedIds ? ` · 持有 <b>${ownedIds.length}</b> / ${furnitureMst.length || '—'}` : ''
        }${placed.size ? ` · 布置中 ${placed.size}` : ''}</span>
      </div>
      <div class="es-furniture">${body}</div>
    </div>`
  // 没换 DOM 就不能重绑：下面那些 error 监听是逐元素绑的，再绑一遍就是监听叠加
  if (!commitPaneHtml(pane!, 'es', html)) return
  // 摆放图 404 兜底（逐元素绑：error 不冒泡，委托接不到；CSP 禁内联 onerror）：
  // 先回退 reward 展示卡，再不行落文字
  pane.querySelectorAll<HTMLImageElement>('[data-fst-img]').forEach((img) => {
    img.addEventListener('error', () => {
      const fallback = img.dataset.fstFallback
      if (fallback) {
        delete img.dataset.fstFallback
        img.src = fallback
        return
      }
      const note = document.createElement('div')
      note.className = 'fst-img-missing'
      note.textContent = '图不可用'
      img.replaceWith(note)
    })
  })
  wire()
}

const render = () => {
  if (!pane) return
  if (state.view === 'furniture') {
    renderFurniture()
    return
  }
  const all = buildRows()
  const rows = applyFilters(all)
  const groups = groupRows(rows, all)
  // 收藏整款置顶（2026-08-16 用户定的），组内再按所选排序轴——仓库是
  // 「找我的东西」的操作清单，常用件先见比严格轴序更值钱
  const favRank = new Map(
    groups.map((g) => [g.mstId, g.rows.some((r) => isFavoriteEquipInstance(r.id)) ? 0 : 1]),
  )
  groups.sort(
    (a, b) =>
      favRank.get(a.mstId)! - favRank.get(b.mstId)! ||
      (SORTERS[state.sortKey] ?? SORTERS.star)(a, b) * state.sortDir ||
      a.mstId - b.mstId,
  )

  const capacity = mg.basic?.maxSlotitems ?? 0
  const used = countCapacitySlotitems(mg.slotitems)
  const spareCount = all.filter((r) => r.spare).length
  const chips =
    EQUIP_CHIPS.map(
      (label) =>
        `<span class="chip${label === state.chip && !state.typeFilter ? ' on' : ''}" data-chip="${esc(label)}">${label}</span>`,
    ).join('') +
    `<span class="chip more${state.moreOpen ? ' on' : ''}" data-more-cat>更多分类 ${state.moreOpen ? '▴' : '▾'}</span>` +
    (state.typeFilter
      ? `<span class="chip on linked" data-clear-type>${esc(
          entityNamePlain('equipType', state.typeFilter, equipTypeNames.get(state.typeFilter) ?? `分类 ${state.typeFilter}`),
        )} ×</span>`
      : '')
  const smartChips = Object.entries(SMART_FILTERS)
    .map(
      ([key, def]) =>
        `<span class="chip sm${state.smart === key ? ' on' : ''}" data-smart="${key}" title="${esc(def.hint)}">${def.label}</span>`,
    )
    .join('')
  const head = SORT_COLUMNS.map(
    ([key, cls, label]) =>
      `<th class="${cls}" data-sort="${key}">${label}${state.sortKey === key ? (state.sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`,
  ).join('')

  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const html = `<div class="es-app">
      <div class="es-bar">
        ${viewModeHtml()}
        <input class="es-search" placeholder="搜装备名" value="${esc(state.search)}">
        <div class="type-chips">${chips}</div>
        <span class="es-sp"></span>
        <span class="es-cap"${capacity > 0 ? ` title="不计消耗品类装备"` : ''}>
          仓库 <b>${used}</b>${capacity > 0 ? ` / ${capacity}` : ''}${
            capacity > 0 ? ` · 余 ${Math.max(0, capacity - used)}` : ''
          }</span>
        <span class="es-lk es-export" data-act="export">导出 CSV</span>
      </div>
      <div class="es-bar sub">
        <div class="type-chips">${smartChips}</div>
        <span class="es-sp"></span>
        <span class="es-hint">可动用 <b>${spareCount}</b> 件 · 当前列出 <b>${groups.length}</b> 款 / <b>${rows.length}</b> 件</span>
      </div>
      ${moreCategoriesHtml()}
      <div class="es-body">
        <div class="es-table-wrap">
          <table class="es-table"><thead><tr>${head}</tr></thead>
            <tbody>${
              groups
                .map((group) => {
                  if (!state.expanded.has(group.mstId)) return groupRowHtml(group)
                  const airborne = isAirborneEquip(group.type2, airborneTypesNow())
                  const inner = variantsOf(group)
                    .map(
                      (variant) =>
                        variantRowHtml(variant, airborne) +
                        (variant.drillable && variant.rows.length > 1 && state.openVariants.has(variant.key)
                          ? variant.rows.map(instanceRowHtml).join('')
                          : ''),
                    )
                    .join('')
                  return groupRowHtml(group) + inner
                })
                .join('') ||
              '<tr><td colspan="5" class="es-empty">暂无符合条件的装备</td></tr>'
            }</tbody></table>
        </div>
        ${(() => {
          const preview = previewHtml() // 判断与渲染共用一次（它每次都全表 filter）
          return preview ? `<aside class="es-side">${preview}</aside>` : ''
        })()}
      </div>
    </div>`
  if (!commitPaneHtml(pane, 'es', html)) return
  wire()
}

let wired = false
const wire = () => {
  if (!pane || wired) return
  wired = true
  // 走 onFilterInput 而不是裸 input：重渲会把输入框元素整个换掉，
  // 输入法的组合会话绑在那个元素上，换一次就断（见 kernel 第三道闸门）。
  // compositionend 也冒泡，委托写法照旧成立。
  onFilterInput(pane, (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('.es-search')
    if (!input) return
    state.search = input.value.trim()
    render()
  })
  pane.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    // 实体链接自己会处理跳转，别被行选中吃掉
    if (target.closest('.el')) return
    const viewBtn = target.closest<HTMLElement>('[data-es-view]')
    if (viewBtn) {
      const view = viewBtn.dataset.esView as typeof state.view
      if (view !== state.view) {
        state.view = view
        state.furnitureFocus = 0 // 手动切换就撤掉跳转高亮
        saveView()
        render()
      }
      return
    }
    const scopeChip = target.closest<HTMLElement>('[data-fst-scope]')
    if (scopeChip) {
      const scope = scopeChip.dataset.fstScope as typeof state.furnitureScope
      if (scope !== state.furnitureScope) {
        state.furnitureScope = scope
        saveView()
        render()
      }
      return
    }
    const furnitureRow = target.closest<HTMLElement>('[data-fid]')
    if (furnitureRow) {
      const id = Number(furnitureRow.dataset.fid)
      state.furnitureOpen = state.furnitureOpen === id ? 0 : id
      render()
      return
    }
    const favBtn = target.closest<HTMLElement>('[data-fav-equip]')
    if (favBtn) {
      toggleFavoriteEquipInstance(Number(favBtn.dataset.favEquip))
      render()
      return
    }
    if (target.closest('[data-more-cat]')) {
      state.moreOpen = !state.moreOpen
      render()
      return
    }
    if (target.closest('[data-clear-type]')) {
      state.typeFilter = 0
      saveView()
      render()
      return
    }
    const typeCell = target.closest<HTMLElement>('[data-equip-type]')
    if (typeCell) {
      const type2 = Number(typeCell.dataset.equipType)
      state.typeFilter = state.typeFilter === type2 ? 0 : type2
      state.chip = '全部'
      state.moreOpen = false
      saveView()
      render()
      return
    }
    const chip = target.closest<HTMLElement>('[data-chip]')
    if (chip) {
      state.chip = chip.dataset.chip!
      state.typeFilter = 0
      saveView()
      render()
      return
    }
    const smart = target.closest<HTMLElement>('[data-smart]')
    if (smart) {
      state.smart = state.smart === smart.dataset.smart ? null : smart.dataset.smart!
      saveView()
      render()
      return
    }
    const sort = target.closest<HTMLElement>('[data-sort]')
    if (sort) {
      const key = sort.dataset.sort!
      if (state.sortKey === key) state.sortDir = -state.sortDir as 1 | -1
      else {
        state.sortKey = key
        // 首击方向：名字/类别从小到大念着顺；「锁」首击要让**未锁的**浮上来
        // （挑动得了的东西是这一列的用途），其余数值列首击都是大的在前
        state.sortDir = key === 'name' || key === 'type' || key === 'locked' ? 1 : -1
      }
      saveView()
      render()
      return
    }
    if (target.closest('[data-act="export"]')) {
      void exportCsv(applyFilters(buildRows()))
      return
    }
    if (target.closest('[data-close-preview]')) {
      state.selected = 0
      render()
      return
    }
    const variant = target.closest<HTMLElement>('[data-variant]')
    if (variant) {
      const key = variant.dataset.variant!
      if (state.openVariants.has(key)) state.openVariants.delete(key)
      else state.openVariants.add(key)
      render()
      return
    }
    // 点组行 = 展开/收起；点实例行 = 选中（右侧看这一款的全部分布）
    const group = target.closest<HTMLElement>('[data-mst]')
    if (group) {
      const mstId = Number(group.dataset.mst)
      if (state.expanded.has(mstId)) {
        state.expanded.delete(mstId)
        // 收起这一款时，把它下面展开过的档一并收掉，免得下次展开还留着旧状态
        for (const key of [...state.openVariants]) {
          if (key.startsWith(`${mstId}:`)) state.openVariants.delete(key)
        }
      } else {
        state.expanded.add(mstId)
      }
      // **不自动选中**：那会让右侧预览一展开就冒出来且关不掉。
      // 预览只在用户明确点某一件实例时出现。
      render()
      return
    }
    const row = target.closest<HTMLElement>('[data-eid]')
    if (row) {
      const id = Number(row.dataset.eid)
      state.selected = state.selected === id ? 0 : id
      render()
    }
  })
}

const VIEW_KEY = 'equipStock.view'
const saveView = () =>
  uiSet(VIEW_KEY, {
    view: state.view,
    furnitureScope: state.furnitureScope,
    chip: state.chip,
    smart: state.smart,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    typeFilter: state.typeFilter,
  })

/**
 * 跳转入口带来的**一次性意图**。宿主是懒挂载的：每会话第一次跳进来，
 * `openStockView()` 那一步才第一次跑 `mountStockView`，而它末尾要从存档恢复
 * 视图状态——入口先设好的意图会被存档整个盖掉（点抬头的装备容量落不到
 *「可动用」、从任务奖励点家具落在装备表上）。
 *
 * 所以意图先挂起，等挂载恢复完存档再重放：**存档只是默认值，一次性意图优先**。
 */
let pendingIntent: (() => void) | null = null

const enterStockView = (intent: () => void) => {
  pendingIntent = intent
  openStockView?.() // 首次进来这一步会懒挂载仓库卷，挂载会替我们重放意图
  if (!pendingIntent) return // 已被挂载重放（并渲染）过
  if (!pane) return // 宿主还没挂载（模块被隐藏等）：意图留着，等挂载时再落
  pendingIntent = null
  intent()
  render() // 仓库卷已在前台时宿主不会刷新这里，自己补
}

/**
 * 从抬头的装备容量点进来：直接落在「可动用」上，并按 SORTERS.dupe 排，
 * 堆得最多的排最前——那是清理时最先想动的。
 *
 * dupe 数的是**当前筛选后剩下的件数**（`group.rows.length`），不是这一款的
 * 持有总数（那个是 `group.owned`）。清理场景下这才是想要的口径：这里已经
 * 先筛到「可动用」（闲置且未锁），于是这个数就是「这一款现在真能动几件」——
 * 攒了 20 件却 19 件挂在舰上的，不该排在能直接拆的那几款前面。
 *
 * **不写进持久化**：这是一次性意图。存下来的话，从抬头点过一次以后，
 * 用户平时打开仓库也永远停在这个筛选上。
 */
export const openEquipCleanup = () => {
  enterStockView(() => {
    state.view = 'equip' // 清理是装备轴的事，正停在装饰品也要切回来
    state.smart = 'spare'
    state.chip = '全部'
    state.search = ''
    state.sortKey = 'dupe'
    state.sortDir = -1
    state.selected = 0
    state.expanded.clear()
    state.typeFilter = 0 // 清理入口要看全部类别，不能被上次的精确筛选挡住
    state.moreOpen = false
  })
}

// installSectionFolding 每调一次就挂一副事件委托 + MutationObserver，而
// mountStockView 是可重入的（切视图、重试装配都会再进来一次）。按元素记一次，别叠加。
const stockFoldingWired = new WeakSet<HTMLElement>()

export const mountStockView = (element: HTMLElement) => {
  pane = element
  invalidateStockRowsIfEquipmentChanged()
  if (!stockFoldingWired.has(element)) {
    stockFoldingWired.add(element)
    // 装饰品按家具类别分组，组头接可折叠（**默认全展开**，与图鉴各卷目录同一口径）。
    // .fst-group / .fst-head 本来就是「组根 + 直接子标题」的形状，不用补容器；
    // 标题是组头里第一个文本节点（类别名），计数在后面的 <i> 里，firstTextTitle 正好。
    installSectionFolding(element, [
      { section: '.fst-group', head: '.fst-head', title: firstTextTitle, openAllByDefault: true },
    ])
  }
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      const narrow = element.clientWidth < 760
      if (element.classList.contains('narrow') === narrow) return
      element.classList.toggle('narrow', narrow)
      render()
    })
    resizeObserver.observe(element)
  }
  element.classList.toggle('narrow', element.clientWidth < 760)
  loadEquipTypeNames()
  ensureFurnitureMst(renderIfFurnitureView)
  const saved = uiGet<Partial<typeof state>>(VIEW_KEY, {})
  if (saved.view === 'equip' || saved.view === 'furniture') state.view = saved.view
  if (saved.furnitureScope === 'owned' || saved.furnitureScope === 'all') {
    state.furnitureScope = saved.furnitureScope
  }
  if (saved.chip && EQUIP_CHIPS.includes(saved.chip)) state.chip = saved.chip
  if (saved.smart === null || (saved.smart && SMART_FILTERS[saved.smart])) state.smart = saved.smart ?? null
  if (saved.sortKey && SORTERS[saved.sortKey]) state.sortKey = saved.sortKey
  if (saved.sortDir === 1 || saved.sortDir === -1) state.sortDir = saved.sortDir
  if (typeof saved.typeFilter === 'number') state.typeFilter = saved.typeFilter
  // 存档恢复完才轮到入口的一次性意图——反过来就是「跳转意图被存档盖掉」那个 bug
  const intent = pendingIntent
  pendingIntent = null
  intent?.()
  render()
}

export const refreshStockView = () => {
  if (pane?.isConnected) deferPassive(pane, 'es', render)
}

/**
 * slotitems / ships / airBases 只是「数据可能变了」：先用行缓存自己的失效键复核。
 * 相同就不作废、不重画；不同才让仓库与鉴的装备占用缓存一起换代。
 */
export const refreshStockViewIfEquipmentChanged = (): boolean => {
  if (!invalidateStockRowsIfEquipmentChanged()) return false
  refreshStockView()
  return true
}

// 任务奖励等处家具链接的落点：装饰品视图 + 高亮那一件（未持有则出横幅行）
export const revealFurnitureInStock = (furnitureId: number) => {
  // 跳转是一次性意图，不写进持久化（与 openEquipCleanup 同一条纪律），
  // 且必须排在挂载恢复存档之后——见 enterStockView
  enterStockView(() => {
    state.view = 'furniture'
    state.furnitureFocus = furnitureId
    state.furnitureOpen = furnitureId // 跳过来就是想看这一件，直接展开详情
    // 目标未持有（或持有未知）时切到「全部」，否则它根本不在清单里
    if (!mg.furnitures?.includes(furnitureId)) state.furnitureScope = 'all'
  })
}

// 家具实体：peek 给「有没有 / 是什么」，点击进装饰品清单。
// 持有判定三态：有 / 没有 / 未同步（mg.furnitures 为 null 时不下「没有」的结论——
// 识别不到就标灰会把玩家真有的说成没有，2026-08-17 用户点名要避免的坑）。
registerEntityRoute('furniture', {
  colorClass: 'e-item',
  open(ref) {
    ensureFurnitureMst()
    revealFurnitureInStock(ref.num)
  },
  peek(ref) {
    ensureFurnitureMst()
    const f = furnitureMst.find((entry) => entry.id === ref.num)
    if (!f) return null
    const typeLabel = FURNITURE_TYPE_LABELS[f.type]?.[0] ?? '装饰品'
    const owned = mg.furnitures
    const placed = (mg.basic?.furnitureLayout ?? []).includes(f.id)
    const ownershipLine = !owned
      ? '<span style="opacity:.6">持有情况尚未同步 · 登录后同步</span>'
      : owned.includes(f.id)
        ? `<b style="color:var(--ok)">已持有</b>${placed ? ' · 布置中' : ''}`
        : '<span style="opacity:.75">未持有</span>'
    const lines = [
      `${esc(typeLabel)}${f.rarity > 0 ? ` · ${'★'.repeat(Math.min(f.rarity, 6))}` : ''}`,
      ownershipLine,
      f.saleflg > 0 && f.price > 0 ? `家具屋 ${f.price.toLocaleString()} 币可购入` : '非卖品',
      ...(f.description ? [`<span style="opacity:.75">${esc(f.description.split('\n')[0])}</span>`] : []),
    ]
    // 速览卡用 reward 展示卡：全员覆盖且尺寸方正，normal 树部分家具缺失
    const url = furnitureImageUrl(f.id, 'reward')
    return {
      title: f.title,
      typeLabel: '装饰品',
      media: url ? `<img class="furniture-preview" src="${esc(url)}" alt="" loading="lazy">` : undefined,
      lines,
      primary: '仓库 · 装饰品',
    }
  },
})

// 主数据换版（api_start2 重下）：家具表与装备类别名只在原始报文里，
// 不重取就一直缺新加的那几件，而首次运行取不到时更是要靠这里兑现
//「登录一次即可」。旧数据留着显示，新的到了静默换上——不清空再拉。
//
// 注册在模块导入期（同上面的实体路由），不落进任何装配作用域：
// 仓库卷是鉴的常驻单例子视图，永久有效正是要的（口径同 qa 的在籍轴）。
onMgChange((keys) => {
  if (!keys.includes('master')) return
  // 取过、或有人正等着的才重取：没进过仓库就不为它拉一遍主数据
  if (furnitureMst.length || furnitureMstWaiters.length) {
    furnitureMstRequested = false
    queueFurnitureMstWaiter(renderIfFurnitureView)
    loadFurnitureMst()
  }
  if (pane) {
    // pane 非空 = mountStockView 跑过 = 类别名取过（成功或失败），两种都该重来
    equipTypeNamesRequested = false
    loadEquipTypeNames()
  }
})
