// 铆 (Mu) · 模块装配宿主。
// 布局总纲：游戏居中，三面环坞——
//   左坞「盯」= 常驻速览（编队/资源/任务），窄容器自动切小插件形态；
//   右坞「打」= 临战伴侣（战斗详情/活动仪表盘），出击时全程在旁；
//   底坞「管」= 工作台（图鉴/舰娘列表/远征/通知/设置/内核工具），要宽要表格。
// 每个坞可再切成**多个格**并排（底坞横切成列、左右坞纵切成行），每格一套标签页，
// 于是「图鉴 + 舰娘列表」「战斗 + 活动」这类可以真正并排看，而不是来回切 Tab。
// 最左是模块导航条：按功能名列出全部模块，点亮=已装配，点击=切到该模块（自动展开所在坞）。
// 布局（分格/分配/尺寸/折叠/激活页）本地持久化。

import { recordCrash } from './crash-guard'

export type DockId = 'left' | 'right' | 'bottom'

export interface KansoModule {
  id: string // 模块代码 id，如 'ru'（内部标识，玩家看不到）
  title: string // 功能名：Tab 标题、导航条、浮层页签都用它
  order?: number // Tab 排序（模块间 import 依赖会打乱注册顺序，显式声明）
  dock?: DockId // 默认坞位（不声明则按下方分配表）
  mount(pane: HTMLElement): void
  onShow?(): void
}

// 导航条的完整名录（含未装配的）：`[模块 id, 功能名]`。
// 次序 = 导航条自上而下的排列；功能名与各模块 registerModule 的 title 是同一个词。
const NAV_MODULES: [string, string][] = [
  ['anchor', '诊断'],
  ['mgstate', '记录'],
  ['mu', '布局'],
  ['link', '关联'],
  ['lg', '通知'],
  ['yu', '设置'],
  ['ji', '图鉴'],
  ['ru', '编队'],
  ['zi', '资源'],
  ['qn', '任务'],
  ['di', '战斗'],
  ['shi', '回顾'],
  ['du', '活动'],
  ['bi', '远征'],
]

// 无面板但已运行的系统模块
const SYSTEM_ACTIVE = new Set(['mgstate', 'mu', 'link'])

// 顶栏独立模块不占坞位，以大浮层承载回顾、通知与设置。
// 状态/事件流仍保留实现供诊断，但正式界面不装配；显式设置 KANSO_DEBUG_UI=1 才出现。
const OVERLAY_MODULES = ['shi', 'lg', 'yu', 'mgstate', 'anchor']
const DIAGNOSTIC_MODULES = new Set(['mgstate', 'anchor'])
const DEBUG_UI = process.env.KANSO_DEBUG_UI === '1'

// 默认坞位与分格（用户实机布局，2026-08-03 定）：
//   左 = 查阅（图鉴/列表）；右 = 临战（战斗/活动）；
//   底 = 三格并排：资源 | 编成 | 任务+远征
const DEFAULT_GROUPS: Record<DockId, string[][]> = {
  left: [['ji']],
  right: [['di', 'du']],
  bottom: [
    ['zi'],
    ['ru'],
    ['qn', 'bi'],
  ],
}
// 底坞前两格的默认定宽（最后一格吃剩余）
const DEFAULT_GROUP_SIZE: Record<DockId, number[]> = { left: [], right: [], bottom: [620, 620] }

const DOCKS: DockId[] = ['left', 'right', 'bottom']
const DOCK_LABEL: Record<DockId, string> = { left: '左坞·查阅', right: '右坞·临战', bottom: '底坞·常驻' }
const DEFAULT_SIZE: Record<DockId, number> = { left: 420, right: 420, bottom: 340 }
const DEFAULT_COLLAPSED: Record<DockId, boolean> = { left: false, right: false, bottom: false }
const MIN_DOCK = 220
const MIN_GROUP = 200

const isOverlay = (id: string) => OVERLAY_MODULES.includes(id)
const defaultPlace = (id: string): { dock: DockId; gi: number } => {
  for (const dock of DOCKS) {
    const gi = DEFAULT_GROUPS[dock].findIndex((g) => g.includes(id))
    if (gi >= 0) return { dock, gi }
  }
  return { dock: 'bottom', gi: 0 }
}

interface GroupState {
  mods: string[]
  active?: string
  size?: number // 该格在坞内的定尺寸（px）；最后一格永远吃剩余空间
}

interface Layout {
  docks: Record<DockId, GroupState[]>
  dockSize: Record<DockId, number>
  collapsed: Record<DockId, boolean>
  focus: boolean
  // 用户从导航条点掉的单个模块（2026-08-12 用户实锤：原来单击显示中的模块
  // 会收起整个坞，误伤同坞其他模块）。与 hiddenModules 的「暂不存在」不同：
  // 搁置的模块保留坞位与导航条元素块（变暗），再点或链接跳转即恢复。
  shelved: string[]
}

import { beginMountScope, endMountScope, onGameScene, runMountCleanup, uiGet, uiSet } from './kernel'
import { playOverlayEntrance } from './launch-glow'
import { layoutForPersist } from '../shared/dock-layout'
import { parseCompactModes, serializeCompactModes, toggledCompactModes } from '../shared/compact-mode'
// 只要类型：启动点亮的顺序判据是纯函数，铆这边只负责报一份布局快照给它。
import type { LaunchGlowLayout } from '../shared/launch-glow'

const LAYOUT_KEY = 'layout.v3'

const layout: Layout = {
  docks: { left: [], right: [], bottom: [] },
  dockSize: { ...DEFAULT_SIZE },
  collapsed: { ...DEFAULT_COLLAPSED },
  focus: false,
  shelved: [],
}
try {
  const saved = uiGet<any>(LAYOUT_KEY, {})
  for (const dock of DOCKS) {
    if (Array.isArray(saved?.docks?.[dock])) layout.docks[dock] = saved.docks[dock]
  }
  Object.assign(layout.dockSize, saved?.dockSize ?? {})
  Object.assign(layout.collapsed, saved?.collapsed ?? {})
  layout.focus = !!saved?.focus
  if (Array.isArray(saved?.shelved)) {
    layout.shelved = saved.shelved.filter((id: unknown) => typeof id === 'string')
  }
} catch (_e) {
  /* 坏存档用默认布局 */
}
// 落盘前过一道 layoutForPersist：**跟着游戏临时切过去的那一页不许被固化成默认页**
//（2026-08-22 用户实机：钦/镖那格每次启动都停在镖，理由见 shared/dock-layout）。
// missionTabRestore 在下面几十行处声明，这里靠函数体延迟求值拿到它。
const saveLayout = () => uiSet(LAYOUT_KEY, layoutForPersist(layout, missionTabRestore))

const modules: KansoModule[] = []
const paneOf = new Map<string, HTMLElement>()
const tabOf = new Map<string, HTMLElement>()
// 临时模块（目前是活动仪表盘）可按游戏主数据动态退场。这里只隐藏装配，
// 不删除用户布局；下次活动出现时仍回到原坞位。
const hiddenModules = new Set<string>()
const moduleVisible = (id: string) =>
  !hiddenModules.has(id) && (DEBUG_UI || !DIAGNOSTIC_MODULES.has(id))
// 「此刻要不要摆进坞里」：存在（moduleVisible）且没被用户搁置
const isShelved = (id: string) => layout.shelved.includes(id)
const displayed = (id: string) => moduleVisible(id) && !isShelved(id)

export const registerModule = (mod: KansoModule) => {
  modules.push(mod)
}

// ---- 紧凑模式 ----
// 开关摆在坞标签条右端、折叠坞的 × 左边（用户点的位置）。模块自愿登记，
// 登记过的模块被激活时那一格才摆得出这枚钮；一格里两个模块各记各的开关。
const COMPACT_KEY = 'compact.v1'
let compactOn = parseCompactModes(uiGet<unknown>(COMPACT_KEY, []))
const compactHooks = new Map<string, () => void>()

/**
 * 登记紧凑模式。`onChange` 在开关翻转后同步调用，模块自己重渲。
 * 按 id 覆盖登记：重试装配走第二遍也不会叠成两份回调。
 */
export const registerCompactMode = (id: string, onChange: () => void) => {
  compactHooks.set(id, onChange)
}

export const isCompactMode = (id: string) => compactOn.has(id)

const toggleCompactMode = (id: string) => {
  compactOn = toggledCompactModes(compactOn, id)
  uiSet(COMPACT_KEY, serializeCompactModes(compactOn))
  syncGroupTools()
  compactHooks.get(id)?.()
}

const modById = (id: string) => modules.find((m) => m.id === id)
const dockEl = (dock: DockId) => document.querySelector<HTMLElement>(`.dock[data-dock="${dock}"]`)!
const splitEl = (dock: DockId) => document.querySelector<HTMLElement>(`.splitter[data-split="${dock}"]`)!

// 模块所在的 {坞, 格序号}
const locate = (id: string): { dock: DockId; gi: number } | null => {
  for (const dock of DOCKS) {
    const gi = layout.docks[dock].findIndex((g) => g.mods.includes(id))
    if (gi >= 0) return { dock, gi }
  }
  return null
}
const dockOfModule = (id: string): DockId => locate(id)?.dock ?? defaultPlace(id).dock
const dockHasMods = (dock: DockId) =>
  layout.docks[dock].some((g) => g.mods.some(displayed))

// 存档与注册表对账：丢弃未知/弹窗类 id、补入新模块、清空格
const reconcile = () => {
  const known = new Set(modules.map((m) => m.id).filter((id) => !isOverlay(id)))
  layout.shelved = layout.shelved.filter((id) => known.has(id))
  const placed = new Set<string>()
  for (const dock of DOCKS) {
    layout.docks[dock] = layout.docks[dock]
      .map((g) => ({
        ...g,
        mods: g.mods.filter((id) => known.has(id) && !placed.has(id) && (placed.add(id), true)),
      }))
      .filter((g) => g.mods.length > 0)
  }
  const ordered = [...modules].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  for (const mod of ordered) {
    if (placed.has(mod.id) || isOverlay(mod.id)) continue
    const at = defaultPlace(mod.id)
    const dock = mod.dock ?? at.dock
    const groups = layout.docks[dock]
    while (groups.length <= at.gi) {
      const gi = groups.length
      groups.push({ mods: [], size: DEFAULT_GROUP_SIZE[dock][gi] })
    }
    groups[at.gi].mods.push(mod.id)
    placed.add(mod.id)
  }
  for (const dock of DOCKS) {
    for (const g of layout.docks[dock]) {
      // 组内按 order 排；激活页失效则退回第一个
      g.mods.sort((a, b) => (modById(a)?.order ?? 99) - (modById(b)?.order ?? 99))
      if (!g.active || !g.mods.includes(g.active)) g.active = g.mods[0]
    }
  }
}

// ---- DOM 铺设 ----

// 格右端那撮工具。紧凑钮写功能名不写符号（顶栏按钮同规矩），紧挨着折叠坞的 ×。
const groupToolsHtml = (dock: DockId, gi: number, fold: boolean) => {
  const active = layout.docks[dock][gi]?.active
  const compact =
    active && compactHooks.has(active) && displayed(active)
      ? `<span class="dock-compact-btn${compactOn.has(active) ? ' on' : ''}" data-compact="${active}">紧凑</span>`
      : ''
  return (
    compact +
    (fold ? `<span class="dock-fold-btn" data-fold="1" title="折叠此坞（导航条点元素可再展开）">×</span>` : '')
  )
}

// 激活页一换、开关一翻，就地重画各格工具条。整坞重铺（layoutDock）会把 tab/pane
// 元素摘下来再放回去，为一枚钮走那条路等于每次切标签都动一遍模块 DOM。
const syncGroupTools = () => {
  for (const dock of DOCKS) {
    for (const tools of dockEl(dock).querySelectorAll<HTMLElement>('.dock-tabs > .dock-fold')) {
      const gi = Number(tools.dataset.gi)
      tools.innerHTML = groupToolsHtml(dock, gi, tools.dataset.fold === '1')
    }
  }
}

const applyDockChrome = (dock: DockId) => {
  const el = dockEl(dock)
  const empty = !dockHasMods(dock)
  el.classList.toggle('empty', empty)
  el.classList.toggle('collapsed', layout.collapsed[dock])
  if (!empty && !layout.collapsed[dock]) el.style.flexBasis = `${layout.dockSize[dock]}px`
  splitEl(dock).classList.toggle('off', empty)
}

// 重铺某坞：把已挂载的 tab/pane 元素搬进对应的格（元素本身不重建，模块状态不丢）
const layoutDock = (dock: DockId) => {
  const el = dockEl(dock)
  const groups = layout.docks[dock]
  // 先把 tab/pane 摘出来（仍被 map 引用，DOM 清空不会丢）
  for (const g of groups) {
    for (const id of g.mods) {
      tabOf.get(id)?.remove()
      paneOf.get(id)?.remove()
    }
  }
  el.innerHTML = ''
  const visibleGroups = groups
    .map((g, gi) => ({ g, gi, mods: g.mods.filter(displayed) }))
    .filter((entry) => entry.mods.length > 0)
  visibleGroups.forEach(({ g, gi, mods }, shownIndex) => {
    if (!mods.includes(g.active ?? '')) g.active = mods[0]
    const groupEl = document.createElement('div')
    groupEl.className = 'dock-group'
    groupEl.dataset.gi = `${gi}`
    if (shownIndex < visibleGroups.length - 1 && g.size) groupEl.style.flex = `0 0 ${g.size}px`
    else groupEl.style.flex = '1 1 0'

    // 标签条每一格都摆，独占一格的也摆（2026-08-30 产品拍板）。右键标签出「移动到」
    // 是换坞换格唯一的入口，藏掉标签那一格就再也挪不动：玩家得先把两个模块凑进同一格
    // 才看得见标签，而凑模块本身就得用这个菜单。原先资源/编队/图鉴独占时省掉标签栏，
    // 省下的那点高度换不来这个死循环（玩家反馈「编队能不能挪到侧面」的根因）。
    const tabs = document.createElement('div')
    tabs.className = 'dock-tabs'
    const panes = document.createElement('div')
    panes.className = 'dock-panes'
    for (const id of mods) {
      const tab = tabOf.get(id)
      const pane = paneOf.get(id)
      if (!tab || !pane) continue
      const on = g.active === id
      tab.classList.toggle('active', on)
      pane.classList.toggle('active', on)
      tabs.appendChild(tab)
      panes.appendChild(pane)
    }
    // 格工具条：紧凑开关（登记过的模块当前被激活时才有）+ 折叠坞（只在最后一格）。
    // 每一格都摆这个容器，空着时靠 :empty 收掉——激活页一换，工具就地重画，
    // 不必为一枚钮重铺整个坞。
    const tools = document.createElement('span')
    tools.className = 'dock-fold'
    tools.dataset.gi = `${gi}`
    if (shownIndex === visibleGroups.length - 1) tools.dataset.fold = '1'
    tools.innerHTML = groupToolsHtml(dock, gi, shownIndex === visibleGroups.length - 1)
    tabs.appendChild(tools)

    groupEl.append(tabs, panes)
    el.appendChild(groupEl)

    if (shownIndex < visibleGroups.length - 1) {
      const sp = document.createElement('div')
      sp.className = `splitter g ${dock === 'bottom' ? 'v' : 'h'}`
      sp.dataset.gsplit = `${gi}`
      sp.title = '拖动调整两格比例'
      el.appendChild(sp)
    }
  })
  // 收起时留一条带模块名的把手（否则用户找不到怎么再打开）
  const stub = document.createElement('div')
  stub.className = 'dock-stub'
  stub.title = `展开${DOCK_LABEL[dock]}`
  stub.innerHTML =
    `<span class="st-h">${DOCK_LABEL[dock]}</span>` +
    groups
      .flatMap((g) => g.mods)
      .filter(displayed)
      .map((id) => `<span class="st-c">${modById(id)?.title ?? ''}</span>`)
      .join('') +
    `<span class="st-a">${dock === 'bottom' ? '▴' : dock === 'left' ? '▸' : '◂'}</span>`
  stub.addEventListener('click', () => setCollapsed(dock, false))
  el.appendChild(stub)
  applyDockChrome(dock)
  refreshRail()
}

const layoutAll = () => {
  for (const dock of DOCKS) layoutDock(dock)
}

/**
 * 启动点亮动画要的那份布局快照：每个坞此刻**真正摆出来**几格、折没折、是不是专注模式。
 *
 * 格数按 `displayed` 过滤后再数，与 layoutDock 铺出来的 `.dock-group` 一一对应
 * （搁置/隐藏的模块占不出格来）——点亮序列按序号找元素，两边数不上就会错位。
 */
export const launchGlowLayout = (): LaunchGlowLayout => ({
  focus: layout.focus,
  docks: DOCKS.map((dock) => ({
    dock,
    cells: layout.docks[dock].filter((g) => g.mods.some(displayed)).length,
    collapsed: layout.collapsed[dock],
  })),
})

export const setModuleVisible = (id: string, visible: boolean) => {
  const changed = visible ? hiddenModules.delete(id) : !hiddenModules.has(id)
  if (!visible) hiddenModules.add(id)
  if (!changed) return
  const at = locate(id)
  if (!visible && at) {
    const group = layout.docks[at.dock][at.gi]
    if (group?.active === id) group.active = group.mods.find(displayed)
  }
  const rail = document.querySelector<HTMLElement>(`.element-tile[data-mod="${id}"]`)
  if (rail) rail.hidden = !visible
  // initModules 完成前还没有坞 DOM；异步活动主数据只会在装配后到达。
  if (document.querySelector('.dock[data-dock]')) layoutAll()
}

// ---- 折叠 / 专注 ----

const setCollapsed = (dock: DockId, collapsed: boolean) => {
  layout.collapsed[dock] = collapsed
  applyDockChrome(dock)
  refreshRail()
  saveLayout()
}

export const toggleFocus = (): boolean => {
  layout.focus = !layout.focus
  document.querySelector('#app')!.classList.toggle('focus', layout.focus)
  refreshRail()
  saveLayout()
  return layout.focus
}

// ---- 激活 ----

const activateIn = (dock: DockId, gi: number, id: string) => {
  const group = layout.docks[dock][gi]
  if (!group) return
  group.active = id
  for (const other of group.mods) {
    const on = other === id
    tabOf.get(other)?.classList.toggle('active', on)
    paneOf.get(other)?.classList.toggle('active', on)
    if (on) showModule(other)
  }
  syncGroupTools() // 紧凑钮跟着激活页走：换到没登记的模块就该收掉
  refreshRail()
  saveLayout()
}

// ---- 顶栏弹窗宿主（回顾/通知/设置；诊断模式额外提供状态/事件流）----

let overlayHost: HTMLElement | null = null
let overlayBody: HTMLElement | null = null
let overlayTabs: HTMLElement | null = null
let overlayOpen: string | null = null
const overlayStore = document.createElement('div') // 关闭时 pane 的暂存处（不在文档流里）

// 顶栏/浮层页签上的那个词：模块的功能名
const funcName = (id: string) => modById(id)?.title ?? id

const renderOverlayTabs = () => {
  if (!overlayTabs) return
  overlayTabs.innerHTML = OVERLAY_MODULES.filter((id) => modById(id) && moduleVisible(id))
    .map((id) => `<span class="ov-tab${overlayOpen === id ? ' on' : ''}" data-ov="${id}">${funcName(id)}</span>`)
    .join('')
  for (const btn of document.querySelectorAll<HTMLElement>('#overlay-bar [data-ov]')) {
    btn.classList.toggle('on', overlayOpen === btn.dataset.ov)
  }
}

export const closeOverlay = () => {
  if (!overlayOpen || !overlayHost) return
  const pane = paneOf.get(overlayOpen)
  if (pane) {
    pane.classList.remove('active')
    overlayStore.appendChild(pane)
  }
  overlayOpen = null
  overlayHost.classList.remove('show')
  renderOverlayTabs()
  refreshRail()
}

export const openOverlay = (id: string) => {
  if (!overlayHost || !overlayBody || !modById(id) || !moduleVisible(id)) return
  if (overlayOpen === id) return closeOverlay()
  if (overlayOpen) closeOverlay()
  const pane = paneOf.get(id)!
  overlayBody.innerHTML = ''
  overlayBody.appendChild(pane)
  pane.classList.add('active')
  overlayOpen = id
  overlayHost.classList.add('show')
  renderOverlayTabs()
  refreshRail()
  showModule(id)
  // 打开的那一瞬间放一小段内容入场（与启动仪式同一个开关；关着时是彻底的空转）。
  // 必须排在 showModule 之后——那一步可能触发模块重渲，先打标记就白打了。
  playOverlayEntrance(overlayBody)
}

const buildOverlay = () => {
  const bar = document.querySelector<HTMLElement>('#overlay-bar')
  if (bar) {
    bar.innerHTML = OVERLAY_MODULES.filter((id) => modById(id) && moduleVisible(id))
      .map(
        (id) =>
          `<button class="ov-btn" data-ov="${id}" title="${modById(id)!.title}（弹窗）">${funcName(id)}<span class="ov-badge" data-badge="${id}"></span></button>`,
      )
      .join('')
    bar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ov]')
      if (btn) openOverlay(btn.dataset.ov!)
    })
  }
  overlayHost = document.createElement('div')
  overlayHost.id = 'overlay-host'
  overlayHost.innerHTML = `<div class="ov-back"></div>
    <div class="ov-panel">
      <div class="ov-head"><span class="ov-tabs"></span><span class="ov-x" title="关闭（Esc）">✕</span></div>
      <div class="ov-body"></div>
    </div>`
  document.body.appendChild(overlayHost)
  overlayBody = overlayHost.querySelector('.ov-body')
  overlayTabs = overlayHost.querySelector('.ov-tabs')
  overlayHost.querySelector('.ov-back')!.addEventListener('click', closeOverlay)
  overlayHost.querySelector('.ov-x')!.addEventListener('click', closeOverlay)
  overlayTabs!.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-ov]')
    if (tab) openOverlay(tab.dataset.ov!)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayOpen) closeOverlay()
  })
}

// 切到指定模块（链的跳转路由用）：展开所在坞 / 弹出浮层，退出专注模式
export const activateModule = (id: string) => {
  if (isOverlay(id)) {
    if (overlayOpen !== id) openOverlay(id)
    return
  }
  if (!moduleVisible(id)) return
  // 被搁置的模块要能被跳转唤回——链接指过来却毫无反应等于坏了
  if (isShelved(id)) {
    layout.shelved = layout.shelved.filter((x) => x !== id)
    layoutAll()
    saveLayout()
  }
  const at = locate(id)
  if (!at) return
  if (layout.focus) {
    layout.focus = false
    document.querySelector('#app')!.classList.remove('focus')
  }
  if (layout.collapsed[at.dock]) setCollapsed(at.dock, false)
  activateIn(at.dock, at.gi, id)
}

// 游戏打开远征页时，把镖所在那一格切到远征；离开时还原进页前的标签。
// 本来就在远征：记下的还是 bi，还原等于不动。
//
// **这是临时视图，不是玩家的选择**：它非空期间 saveLayout 会把这一格的 active
// 写成 `id`（进页前那一页）而不是当下的 bi，否则每天开局派一次远征就把默认页
// 钉死成远征一次（2026-08-22 用户实机报出）。判据在 shared/dock-layout。
let missionTabRestore: { dock: DockId; gi: number; id: string } | null = null

const followGameMissionScene = () => {
  if (!displayed('bi')) return
  const at = locate('bi')
  if (!at) return
  const group = layout.docks[at.dock][at.gi]
  if (!group || missionTabRestore) return
  const prev = group.active ?? group.mods.find(displayed)
  if (!prev) return
  missionTabRestore = { dock: at.dock, gi: at.gi, id: prev }
  if (prev !== 'bi') activateModule('bi')
}

const restoreGameMissionScene = () => {
  const saved = missionTabRestore
  missionTabRestore = null
  if (!saved) return
  const group = layout.docks[saved.dock][saved.gi]
  if (!group?.mods.includes(saved.id) || group.active === saved.id) return
  activateModule(saved.id)
}

// 该模块此刻是否真的看得见
const isShowing = (id: string): boolean => {
  if (!displayed(id)) return false
  if (isOverlay(id)) return overlayOpen === id
  const at = locate(id)
  if (!at || layout.focus || layout.collapsed[at.dock]) return false
  return layout.docks[at.dock][at.gi]?.active === id
}

// 搁置单个模块：只从坞里摘掉它这一页，同坞其他模块不动；
// 坞里全空时坞才会跟着消失。导航条元素块保留（shelved 态变暗），再点即恢复。
const shelveModule = (id: string) => {
  if (isShelved(id)) return
  layout.shelved.push(id)
  const at = locate(id)
  if (at) {
    const group = layout.docks[at.dock][at.gi]
    if (group?.active === id) group.active = group.mods.find(displayed)
  }
  layoutAll()
  saveLayout()
}

export const isModuleAvailable = (id: string): boolean => !!modById(id) && moduleVisible(id)

/**
 * 这个模块此刻是不是**真的摆在屏幕上**：坞没折、不在专注模式、且是所在格的当前页。
 * 启动点亮的第二幕拿它当门条——面板在别的标签底下时放入场动画等于白放。
 */
export const isModuleShowing = (id: string): boolean => isShowing(id)

// ---- 换坞 / 分格 ----

const removeFrom = (id: string) => {
  const at = locate(id)
  if (!at) return
  const group = layout.docks[at.dock][at.gi]
  group.mods = group.mods.filter((x) => x !== id)
  if (group.active === id) group.active = group.mods[0]
  if (!group.mods.length) layout.docks[at.dock].splice(at.gi, 1)
}

// target: 目标坞 + 格序号（-1 = 新建一格）
const moveModule = (id: string, dock: DockId, gi: number) => {
  const before = locate(id)
  if (before && before.dock === dock && before.gi === gi) return
  // 先钉住目标格的**对象**再摘人：removeFrom 清空源格时会 splice 掉那个格，
  // 同坞且源格序号 < 目标序号时，事后的 groups[gi] 已指向别的格（或越界）——
  // 「移到钦镖那格」会变成塞进新建的一格。
  const targetGroup = gi >= 0 && gi < layout.docks[dock].length ? layout.docks[dock][gi] : null
  removeFrom(id)
  const groups = layout.docks[dock]
  if (!targetGroup || !groups.includes(targetGroup)) {
    groups.push({ mods: [id], active: id })
  } else {
    targetGroup.mods.push(id)
    targetGroup.mods.sort((a, b) => (modById(a)?.order ?? 99) - (modById(b)?.order ?? 99))
    targetGroup.active = id
  }
  if (layout.collapsed[dock]) layout.collapsed[dock] = false
  layoutAll()
  const at = locate(id)!
  activateIn(at.dock, at.gi, id)
  saveLayout()
}

// 换坞菜单（复用链的 .cmenu 皮肤）
let dockMenu: HTMLElement | null = null
const hideDockMenu = () => dockMenu?.classList.remove('show')
const showDockMenu = (id: string, x: number, y: number) => {
  if (!dockMenu) {
    dockMenu = document.createElement('div')
    dockMenu.className = 'cmenu'
    document.body.appendChild(dockMenu)
  }
  const mod = modById(id)
  const at = locate(id)
  const items: string[] = []
  for (const dock of DOCKS) {
    const groups = layout.docks[dock]
    groups.forEach((g, gi) => {
      const here = at?.dock === dock && at.gi === gi
      const names = g.mods
        .filter((x) => x !== id)
        .map((x) => modById(x)?.title ?? x)
        .join('、')
      items.push(
        `<div class="mi${here ? ' dis' : ''}" data-dock="${dock}" data-gi="${gi}">${DOCK_LABEL[dock]} · 格${gi + 1}${names ? `（${names}）` : ''}${here ? '<span class="k">当前</span>' : ''}</div>`,
      )
    })
    items.push(`<div class="mi" data-dock="${dock}" data-gi="-1">${DOCK_LABEL[dock]} · <b>新建一格</b></div>`)
  }
  dockMenu.innerHTML = `<div class="m-t">${mod?.title ?? id} · 移动到</div>${items.join('')}`
  dockMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`
  dockMenu.style.top = `${Math.min(y, window.innerHeight - 40 - items.length * 24)}px`
  dockMenu.classList.add('show')
  dockMenu.onclick = (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-dock]')
    if (!target || target.classList.contains('dis')) return
    moveModule(id, target.dataset.dock as DockId, parseInt(target.dataset.gi!, 10))
    hideDockMenu()
  }
}
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.cmenu')) hideDockMenu()
})

// ---- 模块导航条 ----

let railEl: HTMLElement

const refreshRail = () => {
  if (!railEl) return
  for (const tile of railEl.querySelectorAll<HTMLElement>('.element-tile[data-mod]')) {
    const id = tile.dataset.mod!
    // 搁置的模块元素块必须留在导航条上（变暗）——这是唯一的恢复入口
    tile.hidden = !moduleVisible(id)
    tile.classList.toggle('showing', isShowing(id))
    tile.classList.toggle('shelved', isShelved(id))
    const dot = tile.querySelector<HTMLElement>('.dk')
    if (dot) dot.className = `dk ${isOverlay(id) ? 'overlay' : dockOfModule(id)}`
  }
}

const buildRail = () => {
  railEl = document.querySelector<HTMLElement>('#element-rail')!
  for (const [navId, name] of NAV_MODULES) {
    const mod = modById(navId)
    const system = SYSTEM_ACTIVE.has(navId)
    const tile = document.createElement('div')
    tile.className = `element-tile${mod ? ' active mounted' : system ? ' active' : ''}`
    tile.innerHTML = `${name}${mod ? '<span class="dk"></span>' : ''}`
    if (mod) {
      tile.dataset.mod = mod.id
      tile.hidden = !moduleVisible(mod.id)
      tile.title = isOverlay(mod.id)
        ? `${name}\n单击弹出`
        : `${name}\n单击切换显示 · 右键调整位置`
      tile.addEventListener('click', () => {
        if (isOverlay(mod.id)) {
          openOverlay(mod.id) // openOverlay 自带开关语义
        } else if (isShowing(mod.id)) {
          // 只收这一个模块（2026-08-12 用户实锤：原来这里收整个坞，
          // 误伤同坞并排的其他模块）；整坞折叠走坞角的 × 按钮
          shelveModule(mod.id)
        } else {
          activateModule(mod.id)
        }
      })
      if (!isOverlay(mod.id)) {
        tile.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          showDockMenu(mod.id, e.clientX, e.clientY)
        })
      }
    } else if (system) {
      // 「布局」这一格没有面板（铆自己就是装配宿主），所以换坞换格的操作说明只能挂在它的悬停上。
      tile.title =
        navId === 'mu'
          ? `${name} · 系统内核 · 运行中\n面板标签或模块名上右键 →「移动到」，换坞、换格或新建一格`
          : `${name} · 系统内核 · 运行中`
    } else {
      tile.title = `${name} · 未装配`
    }
    railEl.appendChild(tile)
  }
}

// ---- 拖拽（游戏区冻结缩放的钩子由镇壳注入）----

interface DragHooks {
  start?: () => void
  move?: () => void
  end?: () => void
}
let dragHooks: DragHooks = {}
export const setLayoutDragHooks = (hooks: DragHooks) => {
  dragHooks = hooks
}

// 通用拖拽循环：apply(客户坐标) 负责改尺寸
const beginDrag = (cursor: string, apply: (x: number, y: number) => void, onDone: () => void) => {
  // 遮罩推迟到**第一次 mousemove** 才铺（2026-08-30 修）。从前一按下就铺满全屏，
  // 于是 mouseup 落在遮罩上而不是分隔条上，浏览器再也合成不出 click/dblclick——
  // wireDockSplitter 那行「双击折叠」的监听器从来没被调用过，三条分隔条 title 里
  // 写着的「双击折叠」是句空话。实测两组对照：铺了遮罩这组连 click 都没有；
  // 只摘掉遮罩、其余不动那组 click detail=1/2 与 dblclick 依次到齐。
  // 按下不动＝纯点击，遮罩不铺，双击照常合成；只要真动了就在那一拍立刻铺上，
  // 拖拽期挡 webview 吞鼠标事件的语义分毫不变（apply 改尺寸在 rAF 里，
  // 排在铺遮罩之后，`body:has(#drag-overlay) .dock { transition: none }` 照旧命中）。
  let overlay: HTMLElement | null = null
  const ensureOverlay = () => {
    if (overlay) return
    overlay = document.createElement('div')
    overlay.id = 'drag-overlay'
    overlay.style.cursor = cursor
    document.body.append(overlay)
  }
  dragHooks.start?.()
  let raf = 0
  let last = { x: 0, y: 0 }
  const tick = () => {
    raf = 0
    apply(last.x, last.y)
    dragHooks.move?.()
  }
  const onMove = (e: MouseEvent) => {
    ensureOverlay()
    last = { x: e.clientX, y: e.clientY }
    if (!raf) raf = requestAnimationFrame(tick)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (raf) cancelAnimationFrame(raf)
    overlay?.remove()
    if (last.x || last.y) apply(last.x, last.y)
    dragHooks.end?.()
    onDone()
    saveLayout()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 坞尺寸分隔条
const wireDockSplitter = (dock: DockId) => {
  const el = splitEl(dock)
  el.addEventListener('dblclick', () => setCollapsed(dock, !layout.collapsed[dock]))
  el.addEventListener('mousedown', (down) => {
    down.preventDefault()
    if (layout.collapsed[dock]) setCollapsed(dock, false)
    beginDrag(
      dock === 'bottom' ? 'row-resize' : 'col-resize',
      (x, y) => {
        const maxW = window.innerWidth * 0.55
        const maxH = window.innerHeight * 0.7
        let size: number
        if (dock === 'left') size = Math.min(Math.max(x - 44, MIN_DOCK), maxW)
        else if (dock === 'right') size = Math.min(Math.max(window.innerWidth - x, MIN_DOCK), maxW)
        else size = Math.min(Math.max(window.innerHeight - y, MIN_DOCK), maxH)
        layout.dockSize[dock] = Math.round(size)
        dockEl(dock).style.flexBasis = `${layout.dockSize[dock]}px`
      },
      () => {},
    )
  })
}

// 格间分隔条（底坞横向、左右坞纵向）
const wireGroupSplitters = () => {
  document.addEventListener('mousedown', (e) => {
    const sp = (e.target as HTMLElement).closest<HTMLElement>('.splitter.g[data-gsplit]')
    if (!sp) return
    e.preventDefault()
    const dock = (sp.closest('.dock') as HTMLElement).dataset.dock as DockId
    const gi = parseInt(sp.dataset.gsplit!, 10)
    const groupEl = dockEl(dock).querySelector<HTMLElement>(`.dock-group[data-gi="${gi}"]`)!
    const rect = groupEl.getBoundingClientRect()
    beginDrag(
      dock === 'bottom' ? 'col-resize' : 'row-resize',
      (x, y) => {
        const size =
          dock === 'bottom' ? Math.max(MIN_GROUP, x - rect.left) : Math.max(MIN_GROUP, y - rect.top)
        layout.docks[dock][gi].size = Math.round(size)
        groupEl.style.flex = `0 0 ${Math.round(size)}px`
      },
      () => {},
    )
  })
}

// ---- 装配 ----

// 装配账：谁装上了、谁没装上。写到 body 的 data 属性上，是给冒烟测试看的——
// 隔离做完之后「模块崩了」不再表现为黑屏，冒烟就再也发现不了它，
// 必须另给一个能主动读到的信号，否则这道防线反而把问题藏了起来。
const mountedModules = new Set<string>()
const crashedModules = new Set<string>()
let expectedModules = 0
const syncMountReport = () => {
  document.body.dataset.kansoMounted = `${mountedModules.size}/${expectedModules}`
  document.body.dataset.kansoCrashed = crashedModules.size
    ? [...crashedModules].join(',')
    : ''
}

// 面板元素统一在这里造并登记：装配失败重试时要换一张新的（见下方 freshPane），
// 两条路径建出来的必须一模一样，模块的 CSS 全挂在 .mod-xx 上。
const createPane = (id: string): HTMLElement => {
  const pane = document.createElement('div')
  pane.className = `ws-pane mod-${id}`
  pane.dataset.mod = id
  paneOf.set(id, pane) // 建了就登记：坞位重铺与浮层开合一律经 paneOf 找当前元素
  return pane
}

// 重试装配换一张全新的面板，而不是清空旧元素重挂。
// runMountCleanup 只退得掉经内核注册的订阅；模块 mount 挂在**面板本身**上的委托
// 监听（九个模块清一色 `pane = el` 后 pane.addEventListener）与观察面板的
// ResizeObserver，元素还在监听就还在，退不掉。复用元素 = 成功那次监听叠加：
// 展开/收起、勾选这类翻转交互一次点击跑两遍，净效果为零＝用户眼里的死按钮。
// 换元素则旧监听连同旧元素一起被丢弃（ResizeObserver 也随观察目标一起消失）。
const freshPane = (id: string, stale: HTMLElement): HTMLElement => {
  const pane = createPane(id)
  // 只继承「此刻是不是显示中」；narrow / fleet-skin 之类是模块自己加的，重挂时会再加一遍
  pane.classList.toggle('active', stale.classList.contains('active'))
  // 坞格里 / 浮层里 / 暂存处——原地顶替，父容器是谁都不必知道。
  // 搁置中的面板本就被 layoutDock 摘下（无父节点），此时是空转，等下次重铺照样摆回去。
  stale.replaceWith(pane)
  return pane
}

// 装配隔离：从前这里是裸 `mod.mount(pane)`，一个模块抛异常，整个装配循环当场结束，
// 排在它后面的模块全部装不上——那就是黑屏。现在坏掉的模块只黑自己那一格，
// 并把错误原文摆在格子里（正式包没有 DevTools，不摆出来就查无可查），旁边给一个重试。
const mountModule = (mod: KansoModule, pane: HTMLElement): boolean => {
  // 重试前把上次 mount 挂了一半的内核订阅退掉，否则成功那次会双注册：
  // tick 探测双跑、托盘勿扰点一次翻转两次。首次装配时这是空转。
  runMountCleanup(mod.id)
  beginMountScope(mod.id)
  try {
    mod.mount(pane)
    mountedModules.add(mod.id)
    crashedModules.delete(mod.id)
    syncMountReport()
    return true
  } catch (error) {
    mountedModules.delete(mod.id)
    crashedModules.add(mod.id)
    syncMountReport()
    recordCrash(`mount:${mod.id}`, error)
    const message = error instanceof Error ? error.message || error.name : String(error)
    pane.innerHTML = ''
    const box = document.createElement('div')
    box.className = 'mod-crashed'
    box.innerHTML =
      `<b>${escapeText(mod.title)} 装配失败</b>` +
      `<p>${escapeText(message)}</p>` +
      `<small>可重试 · 仍失败时打开「设置 · 运行诊断」查看 crash.log</small>`
    const retry = document.createElement('button')
    retry.textContent = '重试装配'
    retry.addEventListener('click', () => {
      mountModule(mod, freshPane(mod.id, pane))
    })
    box.appendChild(retry)
    pane.appendChild(box)
    return false
  } finally {
    endMountScope()
  }
}

const escapeText = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// onShow 同理：切标签时某个模块的 onShow 抛异常，从前会连累整个激活流程，
// 于是标签点了没反应、其余模块的 active 状态也停在半路。
const showModule = (id: string) => {
  const mod = modById(id)
  if (!mod?.onShow) return
  try {
    mod.onShow()
  } catch (error) {
    recordCrash(`onShow:${id}`, error)
  }
}

export const initModules = () => {
  buildRail()
  reconcile()
  buildOverlay()

  // 挂载：tab/pane 先建好，再由 layoutDock 搬进对应格
  const ordered = [...modules].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  expectedModules = ordered.filter((mod) => moduleVisible(mod.id)).length
  syncMountReport() // 先把分母写上：中途整体崩了也能看出「装到第几个断的」
  for (const mod of ordered) {
    if (!moduleVisible(mod.id)) continue
    if (isOverlay(mod.id)) {
      // 弹窗类：只建 pane，挂在暂存处，openOverlay 时搬进浮层
      const pane = createPane(mod.id)
      overlayStore.appendChild(pane)
      mountModule(mod, pane)
      continue
    }
    const tab = document.createElement('button')
    tab.className = 'ws-tab'
    tab.dataset.mod = mod.id
    tab.textContent = mod.title
    tab.title = `${mod.title}（右键调整位置）`
    tab.addEventListener('click', () => {
      const at = locate(mod.id)
      if (at) activateIn(at.dock, at.gi, mod.id)
    })
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showDockMenu(mod.id, e.clientX, e.clientY)
    })
    tabOf.set(mod.id, tab)

    const pane = createPane(mod.id)
    document.body.appendChild(pane) // 暂挂：mount 里可能读尺寸
    mountModule(mod, pane)
  }

  layoutAll()
  for (const dock of DOCKS) wireDockSplitter(dock)
  wireGroupSplitters()

  // 格工具条：紧凑开关 + 折叠坞
  document.addEventListener('click', (e) => {
    const compact = (e.target as HTMLElement).closest<HTMLElement>('.dock-fold [data-compact]')
    if (compact) {
      toggleCompactMode(compact.dataset.compact!)
      return
    }
    const fold = (e.target as HTMLElement).closest<HTMLElement>('.dock-fold [data-fold]')
    if (!fold) return
    const dock = (fold.closest('.dock') as HTMLElement).dataset.dock as DockId
    setCollapsed(dock, true)
  })

  if (layout.focus) document.querySelector('#app')!.classList.add('focus')
  refreshRail()
  saveLayout()
  onGameScene((scene) => {
    if (scene === 'mission') followGameMissionScene()
    else restoreGameMissionScene()
  })
}
