// 渲染层内核：铭状态的本地缓存与订阅、秒级 ticker、公共工具。
// 各模块（铆装配的面板）只依赖这里，不直接碰 ipc。
import type {
  BattleSnapshot,
  BattleSnapshotSummary,
  AirBaseSquad,
  CategorySummary,
  Deck,
  EventArea,
  EventSortieCostReport,
  FirstEncounterIndex,
  MapGauge,
  MarriageCue,
  MaterialRow,
  MgMaster,
  MgPatch,
  MgPlayer,
  NodeHistoryIndexEntry,
  NodeHistoryReport,
  PowerupResultCue,
  Quest,
  ShipBossKillEntry,
  ShipLifeReport,
  ShipMemorialReport,
  SortieEscapedShip,
  SortieSunkShip,
  SortieView,
  UseitemHistoryChange,
} from '../shared/mg-types'
import type { QpFleetCheck, QpState } from '../shared/qp-types'
import { mourningShipsOf } from '../shared/sortie-mourning'
import { escapedShipsOf } from '../shared/sortie-escape'
import { detailsKey, focusSelector, runViewRestore, scrollUntouchedSince, settlersToRun } from '../shared/view-state'
import { safeEach } from './crash-guard'
import { captureListenerSite, timedEach } from './perf-guard'

const { ipcRenderer } = require('electron')
const kernelConfig = require('@electron/remote').require('./config')

// ---- UI 偏好持久化 ----
// 走主进程 config.json（%APPDATA%/kanso/），不用 localStorage：
// 渲染层是 file:// 源，Chromium 对它的本地存储不保证跨重启留存——布局记不住就是栽在这。
export const uiGet = <T>(key: string, fallback: T): T => {
  const value = kernelConfig.get(`ui.${key}`)
  return value === undefined || value === null ? fallback : (value as T)
}
export const uiSet = (key: string, value: unknown) => {
  // 深拷贝：config.set 用引用比较判断「值没变」，直接塞同一个对象会被判为无变化而不落盘
  kernelConfig.set(`ui.${key}`, JSON.parse(JSON.stringify(value)))
}

// 内部详情栏多由模块 render() 整块重建。关闭时若立刻 render，CSS 来不及播放退出过渡；
// 统一先移除打开态，等主要尺寸/位移过渡结束后再提交新 DOM。
export const exitWithMotion = (
  element: HTMLElement | null | undefined,
  activeClass: string,
  finish: () => void,
  fallbackMs = 240,
) => {
  if (!element || !element.classList.contains(activeClass) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element?.classList.remove(activeClass)
    finish()
    return
  }
  let finished = false
  const complete = () => {
    if (finished) return
    finished = true
    element.removeEventListener('transitionend', onEnd)
    finish()
  }
  const onEnd = (event: TransitionEvent) => {
    if (!['width', 'flex-basis', 'transform'].includes(event.propertyName)) return
    complete()
  }
  element.addEventListener('transitionend', onEnd)
  element.classList.remove(activeClass)
  window.setTimeout(complete, fallbackMs)
}

// ---- 界面缩放（字号）----
// 用渲染层整体缩放而非改字号：所有面板等比放大，坐标系随之一致（拖拽/弹窗定位不用改）；
// 游戏画面在 applyZoom 里按同一系数补偿，画质与点击坐标不受影响。
const { webFrame } = require('electron')
const ZOOM_MIN = 0.8
const ZOOM_MAX = 1.8
let uiZoom: number = uiGet('zoom', 1.15)
const zoomListeners: (() => void)[] = []

export const getUiZoom = () => uiZoom
export const onUiZoom = (cb: () => void) => {
  zoomListeners.push(cb)
  trackForMountScope(() => removeFrom(zoomListeners, cb))
}
export const setUiZoom = (z: number) => {
  uiZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
  webFrame.setZoomFactor(uiZoom)
  uiSet('zoom', uiZoom)
  safeEach('kernel:zoom', zoomListeners, (cb) => cb())
}
export const initUiZoom = () => webFrame.setZoomFactor(uiZoom)

export interface MgView {
  master: MgMaster
  basic: MgPlayer['basic']
  materials: number[] | null
  ships: Record<number, import('../shared/mg-types').PlayerShip>
  decks: Deck[]
  ndocks: import('../shared/mg-types').Ndock[]
  kdocks: import('../shared/mg-types').Kdock[]
  slotitems: Record<number, import('../shared/mg-types').SlotitemInstance>
  quests: Record<number, Quest>
  questsTs: MgPlayer['questsTs']
  questsFullTs: MgPlayer['questsFullTs']
  questActiveIds: MgPlayer['questActiveIds']
  questActiveTs: MgPlayer['questActiveTs']
  questExecCount: MgPlayer['questExecCount']
  useitems: Record<number, number>
  useitemsTs: number | null
  sortie: SortieView | null
  mapGauges: Record<number, MapGauge>
  eventAreas: Record<number, EventArea>
  practice: {
    list: {
      id: number
      name: string
      state: number
      level?: number
      rank?: string
      flagShipId?: number
    }[]
    ts: number
  } | null
  record: MgPlayer['record']
  payitems: MgPlayer['payitems'] // 课金道具持有清单（已购未用）；null = 从没同步过
  furnitures: number[] | null // 持有家具 mst id；null = 未同步过（当「未知」，不当「没有」）
  portLogs: MgPlayer['portLogs'] // 母港滚动消息（游戏自报，日文原文）
  combinedFlag: number // 0 未编成 / 1 空母機動 / 2 水上打撃 / 3 輸送護衛
  /** 友军要請（活动海域限定）。**缺席 = 未知，不等于「关」**，语义见 mg-types 的头注。 */
  friendlyRequest?: MgPlayer['friendlyRequest']
  airBases: AirBaseSquad[]
  airBasesTs: number | null
  lastPortTs: number | null
  /** 母港泊地修理的计时锚点，deckId → 归零时刻。随 decks 一起到，见 main/mg/index.ts。 */
  berthSince: Record<number, number>
  battleReconciliation: import('../shared/mg-types').BattleReconciliationSession
}

export const mg: MgView = {
  master: { ready: false, ships: {}, stypes: {}, slotitems: {}, missions: {}, upgrades: {}, bgms: {} },
  basic: null,
  materials: null,
  ships: {},
  decks: [],
  ndocks: [],
  kdocks: [],
  slotitems: {},
  quests: {},
  questsTs: null,
  questsFullTs: null,
  questActiveIds: null,
  questActiveTs: null,
  questExecCount: null,
  useitems: {},
  useitemsTs: null,
  sortie: null,
  mapGauges: {},
  eventAreas: {},
  practice: null,
  record: null,
  payitems: null,
  furnitures: null,
  portLogs: [],
  combinedFlag: 0,
  airBases: [],
  airBasesTs: null,
  lastPortTs: null,
  berthSince: {},
  battleReconciliation: { checked: 0, mismatched: 0, records: [] },
}

type PatchListener = (keys: string[]) => void
type TickListener = () => void
type SortieScreenListener = (ts: number) => void
type GameSceneListener = (scene: 'mission' | 'away') => void
type PowerupResultListener = (result: PowerupResultCue) => void
type MarriageListener = (cue: MarriageCue) => void

const patchListeners: PatchListener[] = []
const tickListeners: TickListener[] = []
const sortieScreenListeners: SortieScreenListener[] = []
const gameSceneListeners: GameSceneListener[] = []
const powerupResultListeners: PowerupResultListener[] = []
const marriageListeners: MarriageListener[] = []

// ---- 装配作用域：让「重试装配」能把上次挂了一半的订阅退掉 ----
//
// 内核总线只进不出，模块 mount 中途抛错再重试，成功那次会把 mount 前半段
// 已注册的回调再登记一遍：tick 探测双跑、通知点一次翻转两次。
// mountModule 在调 mod.mount 前圈起作用域，期间经内核注册的订阅都记在该模块
// 名下；重试前先 runMountCleanup 一把退掉。模块自己挂在 DOM 上的监听不经这里：
// 面板子树内的随 innerHTML 生灭；挂在面板【自身】上的委托 innerHTML 杀不掉，
// 靠重试时换一个全新面板元素解决（见 mu.ts freshPane）。ipcRenderer 等
// 进程级监听仍由模块自理——在 mount 同步段用 trackMountCleanup 挂退订。
let currentMountScope: string | null = null
const mountCleanups = new Map<string, (() => void)[]>()
const trackForMountScope = (cleanup: () => void) => {
  if (!currentMountScope) return
  const list = mountCleanups.get(currentMountScope) ?? []
  list.push(cleanup)
  mountCleanups.set(currentMountScope, list)
}
/** 供 first-encounter 等自管监听数组的模块把「退订」也挂进当前装配作用域 */
export const trackMountCleanup = trackForMountScope
export const beginMountScope = (id: string) => {
  currentMountScope = id
}
export const endMountScope = () => {
  currentMountScope = null
}
export const runMountCleanup = (id: string) => {
  for (const cleanup of mountCleanups.get(id) ?? []) {
    try {
      cleanup()
    } catch (_e) {
      /* 单个退订失败不拦其余 */
    }
  }
  mountCleanups.delete(id)
}
const removeFrom = <T>(list: T[], item: T) => {
  const at = list.indexOf(item)
  if (at >= 0) list.splice(at, 1)
}

// 慢分发归因：注册时捕获调用点（监听器全是匿名箭头，cb.name 一律为空），
// perf-guard 计时超阈值时按这个定位是哪个模块吃掉了时间。
const listenerSites = new WeakMap<object, string>()
const siteOf = (cb: object): string => listenerSites.get(cb) ?? '(未知注册点)'

export const onMgChange = (cb: PatchListener) => {
  listenerSites.set(cb, captureListenerSite())
  patchListeners.push(cb)
  trackForMountScope(() => removeFrom(patchListeners, cb))
}

export const onTick = (cb: TickListener) => {
  listenerSites.set(cb, captureListenerSite())
  tickListeners.push(cb)
  trackForMountScope(() => removeFrom(tickListeners, cb))
}

export const onSortieScreen = (cb: SortieScreenListener) => {
  sortieScreenListeners.push(cb)
  trackForMountScope(() => removeFrom(sortieScreenListeners, cb))
}

export const onGameScene = (cb: GameSceneListener) => {
  gameSceneListeners.push(cb)
  trackForMountScope(() => removeFrom(gameSceneListeners, cb))
}

export const onPowerupResult = (cb: PowerupResultListener) => {
  powerupResultListeners.push(cb)
  trackForMountScope(() => removeFrom(powerupResultListeners, cb))
}

/** ケッコンカッコカリ 报文到达。退订随装配作用域（重试装配不会叠一份）。 */
export const onMarriage = (cb: MarriageListener) => {
  marriageListeners.push(cb)
  trackForMountScope(() => removeFrom(marriageListeners, cb))
}

// ---- 哀悼态：出击中沉了舰，到返港为止 ----
//
// 判据本体在 shared/sortie-mourning（主进程攒名单、这里读名单，两边共用一份）。
// 它**只从状态推导**：「当前出击仍在途 && 这次出击的沉没名单非空」⇒ 哀悼。
// 于是重开界面（甚至重开艦素后回灌到同一份 sortie）都会重新算出同一个答案，
// 返港时 store 把 sortie.active 落下，这里下一次同步就自动解除——没有「忘记复位」这条路。
//
// 入口放在内核而不是铃：失色作用于整个应用外壳（顶栏 / 侧栏 / 三坞），
// 而且锐的碎裂卡与铃的通知读的必须是**同一个**判据。挂在铃上则意味着
// 铃装配失败时全套哀悼视觉一起消失，那不是「关掉了」，是静默失效。
export const sortieSunkShips = (): SortieSunkShip[] => mourningShipsOf(mg.sortie)

export const isSunkInSortie = (rosterId: number): boolean =>
  sortieSunkShips().some((entry) => entry.rosterId === rosterId)

// ---- 退避态：她已经被送回港了，到返港为止不再参战 ----
//
// 判据本体在 shared/sortie-escape（主进程按 goback_port 攒名单、这里读名单，
// 两边共用一份），与哀悼态同一副骨架：**只从状态推导**，返港随 active 落下自动解除。
// 入口同样放在内核——锐的退场卡、制空/索敌/输送量/大破名单的排除，读的必须是同一个判据。
export const sortieEscapedShips = (): SortieEscapedShip[] => escapedShipsOf(mg.sortie)

/** 她退避了吗。null = 没有（照常参战）；有值时 `role` 区分退避舰与陪走的护卫舰。 */
export const escapedInSortie = (rosterId: number): SortieEscapedShip | null =>
  sortieEscapedShips().find((entry) => entry.rosterId === rosterId) ?? null

export const isEscapedInSortie = (rosterId: number): boolean => !!escapedInSortie(rosterId)

// 开关（钥 · 击沉特效）。初值自己从 config 读而不是等钥推过来——
// 钥装配失败时不该让一个用户已经关掉的特效偷偷生效（buildSpoiler 同款理由）。
let sunkEffectsOn = Boolean(kernelConfig.get('kanso.sunkEffects', true))
export const sunkEffectsEnabled = () => sunkEffectsOn

/** 失色只挂在艦素自己的外壳上；游戏画面容器不在名单里（CSS 侧逐个列出）。 */
const syncMourning = () => {
  document.body.classList.toggle('kanso-mourning', sunkEffectsOn && sortieSunkShips().length > 0)
}

type MourningListener = () => void
const mourningListeners: MourningListener[] = []
/** 哀悼态变化（含开关翻转）时重画自己的模块用。退订随装配作用域。 */
export const onMourningChange = (cb: MourningListener) => {
  mourningListeners.push(cb)
  trackForMountScope(() => removeFrom(mourningListeners, cb))
}

export const setSunkEffectsEnabled = (enabled: boolean) => {
  if (sunkEffectsOn === enabled) return
  sunkEffectsOn = enabled
  syncMourning()
  safeEach('kernel:mourning', mourningListeners, (cb) => cb())
}

// ---- 格納庫増設：读实例侧的一手上限 ----
//
// 游戏 2026-06-26 实装「格納庫増設」（useitem 105），逐槽抬高空母的搭载上限。
// 上限是**舰娘实例**侧的字段 `api_onslot_max`，已由 mg/store 落到 PlayerShip.onslotMax
// （端点 /kcsapi/api_req_kaisou/hangar_expand 同批接入）。这里直接读它。
//
// 这一段从前是**观测推断层**：拿 `onslot > maxEq` 反推这一格扩了几机，还要棘轮记忆
// 对抗战损把实载压低。一手字段到账后那层整个退役（shared/hangar-expansion 已删）。
// 一手值强在两处：战损期间照样说得出真上限；也不必再攒一份跨重启的观测记忆。
//
// onslotMax 是**稀疏**字段——没被扩过的舰连这个键都没有，所以一律回落主数据 maxEq，
// 不能直读下标。
const shipOnslotMax = (rosterId: number, slotIndex: number): number | undefined => {
  const own = mg.ships[rosterId]?.onslotMax?.[slotIndex]
  return Number.isFinite(own) ? own : undefined
}

/** 这一格比主数据原量多出的机数（格納庫増設抬高的部分）。没扩过就是 0。 */
export const hangarExpansionOf = (rosterId: number, slotIndex: number): number => {
  const own = shipOnslotMax(rosterId, slotIndex)
  if (own === undefined) return 0
  const base = mg.master.ships[mg.ships[rosterId]?.shipId ?? 0]?.maxEq?.[slotIndex] ?? 0
  return Math.max(0, own - base)
}

/** 这一格实际的搭载上限：扩过的舰读实例一手值，没扩过的回落主数据原量。 */
export const hangarSlotCapacity = (
  rosterId: number,
  slotIndex: number,
  baseCapacity: number,
): number => shipOnslotMax(rosterId, slotIndex) ?? baseCapacity

/**
 * 在册舰里这个**形态**的哪一艘这一格扩过（取增量最大的那艘）。
 * 上限记在实例上，所以连 rosterId 一起给出，供按形态展示的图鉴页如实指名。
 *
 * `base` 一并交回，是为了让悬停能写成「原量+增量」而两截同源：图鉴页面上显示的
 * 原量取自 wiki 的初期搭载表，与主数据 maxEq 未必逐格相等；增量是拿 maxEq 减出来的，
 * 拿 wiki 那个数去凑加法就可能凑出一个不存在的上限。
 */
export const ownedHangarExpansionOf = (
  mstId: number,
  slotIndex: number,
): { rosterId: number; base: number; extra: number } | null => {
  const base = mg.master.ships[mstId]?.maxEq?.[slotIndex] ?? 0
  let best: { rosterId: number; base: number; extra: number } | null = null
  // 逐舰扫在册表。绝大多数舰连 onslotMax 这个键都没有，两个条件先后短路掉。
  for (const ship of Object.values(mg.ships)) {
    if (ship.shipId !== mstId) continue
    const own = ship.onslotMax?.[slotIndex]
    if (!Number.isFinite(own)) continue
    const extra = (own as number) - base
    if (extra > 0 && (!best || extra > best.extra)) best = { rosterId: ship.id, base, extra }
  }
  return best
}

// 推断层的旧记忆 `ui.kernel.hangarExpansion.v1` 再没人读写。清一次空，免得配置
// 文件永远背着那份陈账；已经空了就别每次启动都写一遍盘（同 lg 清陈账那一手）。
const RETIRED_HANGAR_MEMO_KEY = 'kernel.hangarExpansion.v1'
if (Object.keys(uiGet<Record<string, number>>(RETIRED_HANGAR_MEMO_KEY, {}) ?? {}).length) {
  uiSet(RETIRED_HANGAR_MEMO_KEY, {})
}

// 派发一律逐个隔离：从前这里是裸 forEach，一个模块的回调抛异常，
// 排在它后面的模块就再也收不到这次更新——而且每次派发都断在同一处，
// 表现是「部分面板卡在旧状态」，看不出跟某个模块有关。
const applyMgPatch = (patch: MgPatch) => {
  if (patch.master) invalidateMasterRaw() // 游戏更新了主数据 → 鉴的缓存失效
  Object.assign(mg, patch)
  const keys = Object.keys(patch)
  // 先于各模块回调：失色是应用外壳级状态，模块重画时应当已经看到最终的哀悼态
  if (keys.includes('sortie')) syncMourning()
  // 计时分发：慢了记 perf.log 并逐监听器归因（游戏画面与本界面同一根
  // 主线程合成，这里卡多久游戏就冻多久——2026-08-13 用户报 5-5 三段卡死）
  timedEach('kernel:patch', patchListeners, siteOf, (cb) => cb(keys))
}

/**
 * **仅调试**：把一份补丁按真实通道灌进来。
 *
 * 门控与诊断面板同一个（KANSO_DEBUG_UI=1），发布形态里调了也直接返回。
 * 存在的理由：应急修理与击沉这两类效果没法在真机上按需复现——前者要浪费一枚
 * 稀有道具，后者要真沉一艘舰。走 applyMgPatch 而不是另写一套 mock，
 * 是为了让模拟看到的东西**由生产代码路径产出**：探测、去重、横幅排序、失色推导
 * 全都是真的那一份，只有输入是编的。
 */
export const debugApplyPatch = (patch: MgPatch) => {
  if (process.env.KANSO_DEBUG_UI !== '1') return
  applyMgPatch(patch)
}

const dispatchMarriage = (cue: MarriageCue) => {
  safeEach('kernel:marriage', marriageListeners, (cb) => cb(cue))
}

/**
 * **仅调试**：按真实通道放一次婚舰 cue（门控同 debugApplyPatch）。
 *
 * 戒指不可再生，这个效果在真机上没有第二次验收机会——所以模拟必须走
 * 与报文到达完全同一条派发路径，看到的才是真结婚时会看到的东西。
 */
export const debugEmitMarriage = (cue: MarriageCue) => {
  if (process.env.KANSO_DEBUG_UI !== '1') return
  dispatchMarriage(cue)
}

let kernelInitPromise: Promise<void> | null = null
export const initKernel = (): Promise<void> => {
  if (kernelInitPromise) return kernelInitPromise

  const initialise = async () => {
    const queuedPatches: MgPatch[] = []
    let ready = false
    const onPatch = (_event: unknown, patch: MgPatch) => {
      if (ready) applyMgPatch(patch)
      else queuedPatches.push(patch)
    }
    const onSortieScreenCue = (_event: unknown, ts: number) => {
      safeEach('kernel:sortie-screen', sortieScreenListeners, (cb) => cb(ts))
    }
    const onGameSceneCue = (_event: unknown, scene: 'mission' | 'away') => {
      safeEach('kernel:game-scene', gameSceneListeners, (cb) => cb(scene))
    }
    const onPowerupResultCue = (_event: unknown, result: PowerupResultCue) => {
      safeEach('kernel:powerup-result', powerupResultListeners, (cb) => cb(result))
    }
    const onMarriageCue = (_event: unknown, cue: MarriageCue) => {
      dispatchMarriage(cue)
    }

    // 先订阅再取快照，避免 invoke 往返期间遗漏增量。
    ipcRenderer.on('mg:patch', onPatch)
    ipcRenderer.on('mg:sortie-screen', onSortieScreenCue)
    ipcRenderer.on('mg:game-scene', onGameSceneCue)
    ipcRenderer.on('mg:powerup-result', onPowerupResultCue)
    ipcRenderer.on('mg:marriage', onMarriageCue)
    try {
      const s = await ipcRenderer.invoke('mg:get-state')
      mg.master = s.master
      mg.basic = s.player.basic
      mg.materials = s.player.materials
      mg.ships = s.player.ships
      mg.decks = s.player.decks
      mg.ndocks = s.player.ndocks
      mg.kdocks = s.player.kdocks
      mg.slotitems = s.player.slotitems
      mg.quests = s.player.quests
      mg.questsTs = s.player.questsTs ?? null
      mg.questsFullTs = s.player.questsFullTs ?? null
      mg.questActiveIds = s.player.questActiveIds ?? null
      mg.questActiveTs = s.player.questActiveTs ?? null
      mg.questExecCount = s.player.questExecCount ?? null
      mg.useitems = s.player.useitems
      mg.useitemsTs = s.player.useitemsTs ?? null
      mg.sortie = s.sortie ?? null
      mg.mapGauges = s.mapGauges ?? {}
      mg.eventAreas = s.eventAreas ?? {}
      mg.battleReconciliation = s.battleReconciliation ?? { checked: 0, mismatched: 0, records: [] }
      mg.practice = s.player.practice ?? null
      mg.record = s.player.record ?? null
      mg.payitems = s.player.payitems ?? null
      mg.furnitures = s.player.furnitures ?? null
      mg.portLogs = s.player.portLogs ?? []
      mg.combinedFlag = s.player.combinedFlag ?? 0
      // 没有 `?? 缺省值`：缺席就该保持 undefined（未知），补一个 {flag:0} 等于替玩家说「没开」
      mg.friendlyRequest = s.player.friendlyRequest
      mg.airBases = s.player.airBases ?? []
      mg.airBasesTs = s.player.airBasesTs ?? null
      mg.lastPortTs = s.player.lastPortTs
      mg.berthSince = s.player.berthSince ?? {}
      // 首屏也要立刻反映哀悼态：出击中重开界面不该先亮一秒彩色再变灰
      syncMourning()
      const initialKeys = Object.keys(mg)
      timedEach('kernel:patch', patchListeners, siteOf, (cb) => cb(initialKeys))

      ready = true
      queuedPatches.forEach(applyMgPatch)
      setInterval(() => {
        timedEach('kernel:tick', tickListeners, siteOf, (cb) => cb())
      }, 1000)
    } catch (error) {
      ipcRenderer.removeListener('mg:patch', onPatch)
      ipcRenderer.removeListener('mg:sortie-screen', onSortieScreenCue)
      ipcRenderer.removeListener('mg:game-scene', onGameSceneCue)
      ipcRenderer.removeListener('mg:powerup-result', onPowerupResultCue)
      ipcRenderer.removeListener('mg:marriage', onMarriageCue)
      throw error
    }
  }

  kernelInitPromise = initialise().catch((error) => {
    kernelInitPromise = null
    throw error
  })
  return kernelInitPromise
}

export const queryMaterialHistory = (sinceTs: number): Promise<MaterialRow[]> =>
  ipcRenderer.invoke('mg:material-history', sinceTs)

/**
 * 逐日资源快照（史的「每日资源」）：每个本地自然日只回当天最后一条，外加日初基线。
 * 一年 366 行，与全量行喂进 buildDailyMaterials 的结果逐字段一致
 * （护栏 test/material-daily.test.mjs）。要原始行的（锱、资源趋势窗）仍走上面那个。
 *
 * @param sinceTs 区间第一天的本地 00:00；传 0 = 从账本最早一条起
 * @param untilTs 曲线最后一格截在哪一刻——**必须与画格子用的那个 now 是同一个数**，
 *   否则这中间新进的行会被当成「今天最后一条」，而它又落在最后一格之外
 */
export const queryDailyMaterialHistory = (
  sinceTs: number,
  untilTs: number,
): Promise<{ rows: MaterialRow[]; since: number | null }> =>
  ipcRenderer.invoke('mg:material-daily', sinceTs, untilTs)

// 只要窗口两头的用这个：整段曲线归 queryMaterialHistory，算「期初期末差额」的
// 别把活动期几万行搬进渲染层。窗口口径与 queryMaterialHistory 相同——
// 起算点之前的最后一条快照算期初，没有它才用窗口内第一条。
export const queryMaterialWindow = (
  sinceTs: number,
): Promise<{ first: MaterialRow | null; last: MaterialRow | null }> =>
  ipcRenderer.invoke('mg:material-window', sinceTs)

export const openResourceTrendWindow = (): Promise<void> =>
  ipcRenderer.invoke('window:resource-trend')

export const openQuestTreeWindow = (questId?: number): Promise<void> =>
  ipcRenderer.invoke('window:quest-tree', questId ?? 0)

// 人生记录窗：**一艘一扇**。同一个在籍 id 再调一次是把那扇拿到前面来，
// 换一艘才开新的（主进程按 rosterId 记账，见 main/index 的 shipLifeWindows）。
export const openShipLifeWindow = (rosterId: number): Promise<void> =>
  ipcRenderer.invoke('window:ship-life', rosterId)

/** 人生记录窗 → 主窗：把这一场战斗的复盘打开（跨窗，与任务树那条同一套骨架）。 */
export const openBattleInMainWindow = (snapshotId: number): Promise<void> =>
  ipcRenderer.invoke('window:ship-life-battle', snapshotId)

// 浏览窗：每调用一次开新的一扇，不复用已经开着的那些
export const openBrowseWindow = (): Promise<void> => ipcRenderer.invoke('window:browse')

// 托盘：未读数与勿扰态由铃单向推过去，托盘只显示不判定
export const pushTrayUnread = (count: number): Promise<void> =>
  ipcRenderer.invoke('tray:unread', count)

export const pushTrayDnd = (active: boolean): Promise<void> => ipcRenderer.invoke('tray:dnd', active)

// 窗口收进托盘后，renderer 里的 window.focus() 是无效的，得让主进程 show()
export const showMainWindow = (): Promise<void> => ipcRenderer.invoke('window:show')

export const onTrayToggleDnd = (fn: () => void) => {
  ipcRenderer.on('tray:toggle-dnd', fn)
  // 重试装配时退掉：双注册会让托盘点一次勿扰翻转两次 = 永远切不动
  trackForMountScope(() => ipcRenderer.removeListener('tray:toggle-dnd', fn))
}

export const focusQuestInMainWindow = (questId: number): Promise<void> =>
  ipcRenderer.invoke('window:quest-tree-focus', questId)

// 道具履历：某道具的持有数变化（05 稿的收支时间线）
export const queryUseitemHistory = (
  itemId: number,
  limit = 60,
): Promise<{ ts: number; delta: number; total: number }[]> =>
  ipcRenderer.invoke('mg:useitem-history', itemId, limit)

export const queryRecentUseitemChanges = (limit = 200): Promise<UseitemHistoryChange[]> =>
  ipcRenderer.invoke('mg:useitem-changes', limit)

// 通知历史（铃）。session 用来区分本次开机与上次留下的：
// 旧会话的条目只读不重放——既不弹 Toast，也不计入未读徽章。
export interface StoredNotice {
  id: number
  ts: number
  session: number
  event: string
  title: string
  detail: string
  ref: string | null
  read: number
}

export const appendNotice = (notice: {
  ts: number
  session: number
  event: string
  title: string
  detail: string
  ref: string | null
  read: boolean
}): Promise<number | null> => ipcRenderer.invoke('mg:notify-append', notice)

export const queryNotices = (limit = 400): Promise<StoredNotice[]> =>
  ipcRenderer.invoke('mg:notify-recent', limit)

export const markNoticesRead = (ids: number[] | 'all'): Promise<void> =>
  ipcRenderer.invoke('mg:notify-read', ids)

export const clearNotices = (): Promise<void> => ipcRenderer.invoke('mg:notify-clear')

// 时间窗内的操作类事件（道具履历归因用）。earliest = 账本最早一条，
// 早于它的变动无原因可考（events 可被清理，useitem_log 是永久表，两者会错位）
export const queryActionEvents = (
  fromTs: number,
  toTs: number,
): Promise<{ events: { ts: number; path: string; postBody: string | null }[]; earliest: number | null }> =>
  ipcRenderer.invoke('mg:action-events', fromTs, toTs)

// 道具收支合计：一次拿回区间内所有道具的增减（锱的战略道具卡）
export const queryUseitemSummary = (
  sinceTs: number,
): Promise<{ id: number; gained: number; spent: number; changes: number; lastTs: number }[]> =>
  ipcRenderer.invoke('mg:useitem-summary', sinceTs)

export const queryDeltaSummary = (sinceTs: number): Promise<CategorySummary[]> =>
  ipcRenderer.invoke('mg:material-deltas', sinceTs)

// 本机氪金记录（史模块）：查询永久表 / 手动补记 / 删除补记行（自动行不可删）
export const queryPayLog = (): Promise<import('../shared/pay-log').PayLogRow[]> =>
  ipcRenderer.invoke('mg:pay-log')

export const addManualPayLog = (entry: {
  ts: number
  itemId: number
  name: string
  count: number
  price: number | null
}): Promise<number | null> => ipcRenderer.invoke('mg:pay-log-add', entry)

export const removeManualPayLog = (id: number): Promise<boolean> =>
  ipcRenderer.invoke('mg:pay-log-remove', id)

export const queryFactoryStats = (
  sinceTs: number,
): Promise<import('../shared/mg-types').FactoryStatsReport> =>
  ipcRenderer.invoke('mg:factory-stats', sinceTs)

export const querySenka = (at?: number): Promise<import('../shared/senka').SenkaSummary> =>
  ipcRenderer.invoke('mg:senka', at)

// 任务战果的补记（连同 EO 的自动对账）都在主进程 mg:senka 查询时完成，渲染端
// 不经手：入账只认账本里存着的 clearitemget 报文，渲染层的「看着已完成」是推断，
// 推断不入账（2026-09-01 起，出处见 shared/senka-quest-book）。

// 重算任务战果：撤回本战果月自动补记的任务行（合成行，指纹见 ledger），
// 返回撤回的笔数。撤回之后重查一次账，有报文证据的自己回来，推断来的回不来。
export const clearAutoBookedSenkaQuests = (): Promise<number> =>
  ipcRenderer.invoke('mg:senka-clear-quest')

// 手动补记（2026-09-01）：季中才装上 kuma 的玩家，之前交过的任务账本里没有证据。
// 渲染层只递任务号，分值由主进程从 quests-scn 现解；去重与观测行共用同一个窗口。
export const querySenkaQuestOptions = (): Promise<import('../shared/senka').SenkaQuestOption[]> =>
  ipcRenderer.invoke('mg:senka-quest-options')

export const addManualSenkaQuest = (
  questId: number,
): Promise<import('../shared/senka-quest-book').QuestSenkaBookingReason | 'failed'> =>
  ipcRenderer.invoke('mg:senka-add-quest', questId)

export const removeManualSenkaQuest = (id: number): Promise<boolean> =>
  ipcRenderer.invoke('mg:senka-remove-quest', id)

export const queryExpSamples = (): Promise<import('../shared/mg-types').ExpSampleReport> =>
  ipcRenderer.invoke('mg:exp-samples')

export const queryEventSortieCosts = (
  areaId: number,
  sinceTs: number,
): Promise<EventSortieCostReport> =>
  ipcRenderer.invoke('chron:event-sortie-costs', areaId, sinceTs)

export const queryNodeHistoryIndex = (limit = 300): Promise<NodeHistoryIndexEntry[]> =>
  ipcRenderer.invoke('chron:node-history-index', limit)

export const queryNodeHistory = (
  map: number,
  cell: number,
  limit = 60,
): Promise<NodeHistoryReport> =>
  ipcRenderer.invoke('chron:node-history', map, cell, limit)

export const queryFirstEncounters = (): Promise<FirstEncounterIndex> =>
  ipcRenderer.invoke('chron:first-encounters')

export const queryRouteStats = (
  map: number,
): Promise<import('../shared/mg-types').RouteStatsReport> =>
  ipcRenderer.invoke('chron:route-stats', map)

export const queryExpeditionHistory = (
  missionId: number,
  limit = 30,
): Promise<import('../shared/mg-types').ExpeditionHistoryReport> =>
  ipcRenderer.invoke('mg:expedition-history', missionId, limit)

export const queryShipLife = (rosterId: number, limit = 80): Promise<ShipLifeReport> =>
  ipcRenderer.invoke('mg:ship-life', rosterId, limit)

export const queryShipMemorial = (mstIds: number[]): Promise<ShipMemorialReport> =>
  ipcRenderer.invoke('mg:ship-memorial', mstIds)

/** 她终结过的 boss（敌旗舰的最后一击是她打的）。时间倒序，判据见 shared/boss-kill。 */
export const queryBossKills = (
  rosterId: number,
  limit = 200,
): Promise<ShipBossKillEntry[]> => ipcRenderer.invoke('mg:ship-boss-kills', rosterId, limit)

export const queryBattleSnapshots = (limit = 40): Promise<BattleSnapshotSummary[]> =>
  ipcRenderer.invoke('chron:battles', limit)

export const queryBattleSnapshot = (id: number): Promise<BattleSnapshot | null> =>
  ipcRenderer.invoke('chron:battle', id)

export const queryEventArchives = (): Promise<any[]> =>
  ipcRenderer.invoke('chron:event-archives')

export const queryFriendlyFleets = (
  map: number,
  difficulty: number,
): Promise<import('../shared/friendly-fleet').FriendlyFleetRecord[]> =>
  ipcRenderer.invoke('chron:friendly-fleets', map, difficulty)

// 全量主数据（api_start2 原始形状），渲染层缓存一份；start2 更新时在 patch 处失效
let masterRaw: any = null
export const queryMasterRaw = async (): Promise<any> => {
  if (!masterRaw) {
    masterRaw = await ipcRenderer.invoke('mg:master-raw')
  }
  return masterRaw
}
export const invalidateMasterRaw = () => {
  masterRaw = null
}

// 任务精确计数（钦）：主进程引擎的状态镜像 + 增量订阅
let qpState: QpState | null = null
let qpInitPromise: Promise<QpState> | null = null
const qpListeners: (() => void)[] = []

// 各模块会把 queryQp() 返回的对象保存下来。主进程在 start2 / questlist 后会下发
// 一份完整状态；若直接替换 qpState，钦、铃、镖仍会握着旧引用，此后的实时 patch
// 只改新对象，界面就会一直停在旧进度，直到重启重新取状态。完整同步也必须原地更新。
const applyQpState = (state: QpState) => {
  if (!qpState) {
    qpState = state
    return
  }
  qpState.trackers = state.trackers
  qpState.progress = state.progress
  qpState.serverFloors = state.serverFloors
  qpState.packCredit = state.packCredit
}

const applyQpPatch = (patch: Record<string, number[] | null>) => {
  if (!qpState) return
  for (const [qid, counts] of Object.entries(patch)) {
    if (counts == null) delete qpState.progress[+qid]
    else qpState.progress[+qid] = counts
  }
  safeEach('kernel:qp', qpListeners, (cb) => cb())
}

export const queryQp = (): Promise<QpState> => {
  if (qpState) return Promise.resolve(qpState)
  if (qpInitPromise) return qpInitPromise

  const initialise = async (): Promise<QpState> => {
    const queuedPatches: Record<string, number[] | null>[] = []
    const queuedStates: QpState[] = []
    let ready = false
    const onPatch = (_event: unknown, patch: Record<string, number[] | null>) => {
      if (ready) applyQpPatch(patch)
      else queuedPatches.push(patch)
    }
    const onState = (_event: unknown, state: QpState) => {
      if (ready) {
        applyQpState(state)
        safeEach('kernel:qp', qpListeners, (cb) => cb())
      } else {
        queuedStates.push(state)
      }
    }

    ipcRenderer.on('qp:patch', onPatch)
    ipcRenderer.on('qp:state', onState)
    try {
      applyQpState((await ipcRenderer.invoke('qp:get')) as QpState)
      ready = true
      for (const state of queuedStates) applyQpState(state)
      queuedPatches.forEach(applyQpPatch)
      return qpState!
    } catch (error) {
      ipcRenderer.removeListener('qp:patch', onPatch)
      ipcRenderer.removeListener('qp:state', onState)
      throw error
    }
  }

  qpInitPromise = initialise().catch((error) => {
    qpInitPromise = null
    throw error
  })
  return qpInitPromise
}
export const onQpChange = (cb: () => void) => {
  qpListeners.push(cb)
  trackForMountScope(() => removeFrom(qpListeners, cb))
}

// 编成条件实时判定（钦的「当前编成可直接做」）。随编队变化重查，不做缓存。
export const queryFleetCheck = (): Promise<QpFleetCheck> => ipcRenderer.invoke('qp:check-fleet')

// 矿脉数据包（缓存按 id）
export interface LodeMeta {
  id: string
  name: string
  version: string
  source: string
  sourceUrl?: string
  fetchedAt: string
  upstreamUpdatedAt?: string | null
  note?: string
}
const lodeCache = new Map<string, { meta: LodeMeta; data: any } | null>()
export const queryLode = async (id: string): Promise<{ meta: LodeMeta; data: any } | null> => {
  if (!lodeCache.has(id)) {
    lodeCache.set(id, await ipcRenderer.invoke('lode:get', id))
  }
  return lodeCache.get(id) ?? null
}
// 「谁说的、多新」页脚文本：优先展示上游更新时间（而非我们的抓取时间）
export const lodeCredit = (meta: LodeMeta) => {
  const fresh = meta.upstreamUpdatedAt
    ? `资料更新 ${meta.upstreamUpdatedAt.slice(0, 10)}`
    : `下载于 ${meta.fetchedAt.slice(0, 10)}`
  return `${meta.source} · ${fresh}${meta.note ? ` · ${meta.note}` : ''}`
}

/**
 * 出处收纳成小记号：常驻只留一枚「源」，完整的「谁说的·多新」进悬停。
 * 2026-08-16 口径：出处要**可查**，不要**常驻**——「谁说的、多新」本是给施工方
 * 的选源纪律，不是要向玩家反复报告；玩家几乎不读，但一 hover 必须就在。
 * 2026-08-21 收窄：常驻只放「玩家玩游戏时要直接看」的东西。数值旁的单短标注
 * （估算/推定/?/占位）与当下状态（未同步/读取失败/空态）照旧常驻；句子型的严谨
 * 说明进折叠或 extra 悬停；**新鲜度/停更/来源健康一律不进模块**，只在钥的矿脉
 * 健康度里报一次（见 shared/lode-health.ts 的 DISCONTINUED_UPSTREAM）。
 */
export const lodeCreditMark = (meta: LodeMeta, extra = '') =>
  `<span class="credit-mark" title="${esc(lodeCredit(meta))}${extra ? ` ｜ ${esc(extra)}` : ''}">源</span>`

/**
 * 同上，但不带 note。note 是给维护者看的口径备忘（「普查 §3.2」这类），
 * 挤在署名里会把一行撑成三行——署名要成排列出来时用这个。
 */
export const lodeCreditShort = (meta: LodeMeta) => {
  const fresh = meta.upstreamUpdatedAt
    ? `资料更新 ${meta.upstreamUpdatedAt.slice(0, 10)}`
    : `下载于 ${meta.fetchedAt.slice(0, 10)}`
  return `${meta.source} · ${fresh}`
}

// 全量重渲染时保住用户的「就位状态」：滚动位置、展开的 <details>、正在输入的那一格。
//
// innerHTML 重建会把这三样一起打回初始，而游戏事件流触发的被动重渲染频率很高
// （一次 materials 变化就能重渲整个图鉴）——玩家展开一段资料、或正在写舰娘备注，
// 会毫无预兆地被拽回最初状态。备注框尤其伤：它用 change 提交，
// 没 blur 就重建 = 已经敲进去的字直接没了。
//
// 三样都不需要调用方申报——判据本来就在运行时可测：
//   滚动 = scrollTop/scrollLeft 非零者即是，键用「class + 同 class 内序号」
//   展开 = <details open>，键同上（data-keep 优先）
//   焦点 = document.activeElement 落在 root 内
// 原先滚动这一项要求各模块传一份选择器清单，11 个模块共 36 条，天然会腐坏：
// 补齐过一轮之后仍旧漏了 5 处，还得再写一条测试去扫 CSS 对账那份清单——
// 为了维护清单又多出一份要维护的东西。判据既然能测，就别让人申报。
// 展开态与焦点的键在 shared/view-state 里（纯逻辑，可脱离 DOM 测试）。
const detailsKeyOf = (el: HTMLDetailsElement, seen: Map<string, number>): string =>
  detailsKey({ keep: el.dataset.keep, className: el.className }, seen)

const focusKeyOf = (el: Element): string | null =>
  focusSelector({ id: el.id, attributes: el.attributes })

// selectionStart 只在文本类 input 上可读；range/checkbox 上访问会抛。
const selectionOf = (el: Element): [number, number] | null => {
  try {
    const input = el as HTMLInputElement
    if (input.selectionStart == null || input.selectionEnd == null) return null
    return [input.selectionStart, input.selectionEnd]
  } catch (_error) {
    return null
  }
}

// 滚动容器的键。必须对**每个**元素都推进计数器，不能只给滚动着的编号——
// 否则保存与还原两次遍历的序号对不上，会把位置放到隔壁那个容器里。
const scrollKeyOf = (el: HTMLElement, seen: Map<string, number>): string => {
  // SVG 元素的 className 是 SVGAnimatedString 对象（恒真），直接拼键会让所有
  // SVG 共享一把 "[object SVGAnimatedString]#N"，计数器序号整体错位
  const cls = (typeof el.className === 'string' && el.className) || el.tagName
  const n = seen.get(cls) ?? 0
  seen.set(cls, n + 1)
  return `${cls}#${n}`
}

// 滚动剖面：root 内所有滚动容器的 scrollTop/Left 快照（键 = 类名#出现序号）。
// withViewStateKept 用它跨一次重建保位；图鉴导航历史用它把「上一层」连滚动一起存档。
export type ScrollProfile = Map<string, { top: number; left: number }>

export const captureScrollProfile = (root: HTMLElement): ScrollProfile => {
  const saved: ScrollProfile = new Map()
  const scrollSeen = new Map<string, number>()
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const key = scrollKeyOf(el, scrollSeen)
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      saved.set(key, { top: el.scrollTop, left: el.scrollLeft })
    }
  })
  return saved
}

// 按剖面**整体**还原：剖面里没有的滚动容器归零。历史还原要的是「离开时的样子」，
// 不归零的话，本次导航前的滚动会借同名键（各卷目录同构）漏进回来的那一页。
// 同步套用一次，再补一帧：抽屉宽度过渡/容器形态切换会在布局后触发滚动锚定。
export const applyScrollProfile = (root: HTMLElement, profile: ScrollProfile) => {
  const apply = () => {
    const seen = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const hit = profile.get(scrollKeyOf(el, seen))
      if (hit) {
        el.scrollTop = hit.top
        el.scrollLeft = hit.left
      } else if (el.scrollTop > 0 || el.scrollLeft > 0) {
        el.scrollTop = 0
        el.scrollLeft = 0
      }
    })
  }
  apply()
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply)
}

// ---- 「换完 DOM、还原滚动之前」必须同步跑完的收尾 ----
//
// 分段折叠不是渲染出口写进 HTML 的，是渲染之后由 JS 施加的（section-fold 用一个
// MutationObserver 统一施加，免得十来个渲染出口逐个补调用）。而 MutationObserver
// 的回调是**微任务**——它排在这里同步还原滚动的后面。于是：换完 DOM 那一刻整页
// 是「全展开」的高度，滚动按那个高度还原得好好的；微任务一到，几段折回默认态，
// 页面矮下去，浏览器把 scrollTop 夹上去。玩家看到的就是「点一下播放，被往上拉了
// 好几屏」（2026-08-23 实机报，潮的台词卷；真浏览器复现：装了折叠丢 328px，
// 不装折叠丢 0px——那一页短，实机那页更长，丢得更多）。
//
// 所以这类收尾要在还原之前**同步**跑一次。判据（哪些该跑）在 shared/view-state
// 的 settlersToRun，脱开 DOM 可测。MutationObserver 那条不撤：它管的是不走这里的
// DOM 变动，apply 本身是幂等的，多跑一次不花什么。
const viewSettlers: { root: HTMLElement; settle: () => void }[] = []

export const registerViewSettler = (root: HTMLElement, settle: () => void) => {
  viewSettlers.push({ root, settle })
}

const settleView = (root: HTMLElement) => {
  const live = viewSettlers.filter((entry) => entry.root.isConnected)
  if (live.length !== viewSettlers.length) viewSettlers.splice(0, viewSettlers.length, ...live)
  const due = settlersToRun(
    live.map((entry) => ({ root: entry.root, connected: true, settle: entry.settle })),
    root,
    (ancestor, node) => ancestor.contains(node),
  )
  safeEach('kernel:view-settle', due, (entry) => entry.settle())
}

export const withViewStateKept = (root: HTMLElement, mutate: () => void) => {
  const saved = captureScrollProfile(root)

  const openDetails = new Set<string>()
  const detailsSeen = new Map<string, number>()
  root.querySelectorAll<HTMLDetailsElement>('details').forEach((el) => {
    const key = detailsKeyOf(el, detailsSeen)
    if (el.open) openDetails.add(key)
  })

  const active = document.activeElement
  const focus =
    active && active !== document.body && root.contains(active)
      ? (() => {
          const key = focusKeyOf(active)
          if (!key) return null
          const selection = selectionOf(active)
          // 正在编辑但尚未提交的值：备注框走 change，重建会把没敲完的字冲掉。
          const value = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
            ? active.value
            : null
          return { key, selection, value }
        })()
      : null

  mutate()

  // details 先恢复：展开会撑高内容，必须赶在还原 scrollTop 之前，
  // 否则滚动位置会被当时较矮的内容截断。
  const restoreDetails = () => {
    const restoredSeen = new Map<string, number>()
    root.querySelectorAll<HTMLDetailsElement>('details').forEach((el) => {
      const key = detailsKeyOf(el, restoredSeen)
      if (openDetails.has(key)) el.open = true
    })
  }

  const restoreFocus = () => {
    if (!focus) return
    // 恢复焦点是锦上添花，任何一步出岔子都不该把整次重渲染拖垮。
    const el = (() => {
      try {
        return root.querySelector<HTMLElement>(focus.key)
      } catch (_error) {
        return null
      }
    })()
    if (!el) return
    // preventScroll：focus 自带的滚动会跟下面的滚动还原打架
    el.focus({ preventScroll: true })
    if (
      focus.value != null &&
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.value !== focus.value
    ) {
      el.value = focus.value
    }
    if (focus.selection) {
      try {
        ;(el as HTMLInputElement).setSelectionRange(focus.selection[0], focus.selection[1])
      } catch (_error) {
        // 类型不支持文本选区（range/checkbox 等）——焦点已经回去了，到此为止
      }
    }
  }

  // 还原自己写进去的值记下来，供下一帧那次对账：**只在位置还是我们放的那个时**
  // 才允许再写一次。否则「快照 → 重建 → 还原 → 下一帧再还原」的最后一步会把
  // 用户在这一帧里刚滚出去的距离原样拽回来（实测：重渲后滚 500px，两帧后回到原位）。
  // 尾随还原本来是为了对付「容器形态切换/抽屉过渡在布局后又触发一次滚动锚定」——
  // 那种情况位置是被浏览器改的，用户没动手；用户动过手就该由用户说了算。
  const written = new Map<HTMLElement, { top: number; left: number }>()
  const restore = (onlyIfUntouched: boolean) => {
    if (!saved.size) return
    const seen = new Map<string, number>()
    root.querySelectorAll<HTMLElement>('*').forEach((el) => {
      const hit = saved.get(scrollKeyOf(el, seen))
      if (!hit) return
      // 判据是纯逻辑，放在 shared/view-state 里可脱离 DOM 测（错了不报错，只是滚动被拽回）
      if (onlyIfUntouched && !scrollUntouchedSince({ top: el.scrollTop, left: el.scrollLeft }, written.get(el))) {
        return
      }
      el.scrollTop = hit.top
      el.scrollLeft = hit.left
      // 写回读到的实际值：内容还没撑开时 scrollTop 会被浏览器夹住，记下夹后的数才对得上
      written.set(el, { top: el.scrollTop, left: el.scrollLeft })
    })
  }
  // 次序即判据，写在 shared/view-state 的 VIEW_RESTORE_ORDER 上（那里能脱开 DOM 测）：
  // 会改高度的两步（settle / details）必须排在 scroll 前面。
  runViewRestore({
    settle: () => settleView(root),
    details: restoreDetails,
    focus: restoreFocus,
    scroll: () => restore(false),
  })
  // 容器形态切换/抽屉宽度过渡可能在同步布局后再次触发滚动锚定；
  // 下一帧复原一次，仍在同一绘制周期内，不会产生可见跳动。
  if (saved.size && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => restore(true))
}

// ---- 被动重渲的两道闸门 ----
//
// 游戏报文的到达频率很高，一次收远征就是 result → port → useitem 三条，连收三趟
// 就是九条；每条都让各模块整块 innerHTML 重建。实测（2026-08-21，真账本副本 + CDP）：
// 连收三次远征 = 图鉴 9 次全量重建、钦 18 次、锐 15 次，主线程被占住合计 906ms。
// 而同一段时间里这些面板**产出的 HTML 逐字节没变**——图鉴 24 次重渲只有 2 次真变了。
// 代价是玩家实测得到的：滚动在那几百毫秒里不动（合成后一次跳过去），
// 按下与抬起之间赶上一次重建，click 干脆不发生。
//
// 三道闸门都放在「换 DOM」这一步，不动数据流：
//   ① 输出没变就别换（commitPaneHtml）——比输入签名更硬：签名漏了一个输入会
//      「该更新的不更新」，逐字节比较不会。代价只是多留一份字符串。
//   ② 指针按下期间推迟到抬起（deferWhilePressed）——click 的成立条件是按下与
//      抬起落在同一元素上，中途换掉 DOM 就没有 click。封顶 PRESS_DEFER_CAP，
//      按住不放不会把界面冻在旧状态。
//   ③ 输入法组合期间推迟到组合结束（deferWhileComposing）——见下方那一段。

/** 各面板上一次真正提交过的 HTML。按 root 元素弱引用：重试装配换了新面板元素，记忆自然作废。 */
const committedHtml = new WeakMap<HTMLElement, Map<string, string>>()

/**
 * 局部换块（只改子节点 innerHTML）之后必须调这个作废记忆——否则 DOM 已经不是
 * 上次提交的那份，下一次全量渲染若恰好生成同样的字符串就会被误判成「没变」而跳过。
 */
export const forgetCommittedHtml = (root: HTMLElement, key: string) => {
  committedHtml.get(root)?.delete(key)
}

/**
 * 全量重渲的统一提交口：输出与上次逐字节相同就整段跳过。
 *
 * 返回 false = 这次没有换 DOM，调用方**必须**把随后的重绑/补挂也一起跳过
 * （那些元素还是老的，重绑就是监听叠加——「绑定收支」的另一头）。
 *
 * `inside` 在 withViewStateKept 的 mutate 回调**内部**跑：嵌入式持久节点要在那里
 * 接回文档流，晚一步 scrollTop 就已经被浏览器丢掉了。
 */
export const commitPaneHtml = (
  root: HTMLElement,
  key: string,
  html: string,
  inside?: () => void,
): boolean => {
  if (!paneHtmlDiffers(root, key, html)) return false
  withViewStateKept(root, () => {
    root.innerHTML = html
    inside?.()
  })
  rememberPaneHtml(root, key, html)
  return true
}

/**
 * commitPaneHtml 的裸版：给「已经在 withViewStateKept 回调里面、且换块前后各有一段
 * 必须紧贴着跑的处理」的渲染用（镝的血条两拍动画就是这样）。别再套一层 withViewStateKept。
 * 返回 false = 输出与上次一样，调用方应当把前后那两段处理一起跳掉。
 */
export const applyPaneHtml = (root: HTMLElement, key: string, html: string): boolean => {
  if (!paneHtmlDiffers(root, key, html)) return false
  root.innerHTML = html
  rememberPaneHtml(root, key, html)
  return true
}

const paneHtmlDiffers = (root: HTMLElement, key: string, html: string): boolean =>
  // firstElementChild 兜底：面板被别处清空过（mu 的重试装配）就不能信记忆
  !(committedHtml.get(root)?.get(key) === html && root.firstElementChild)

const rememberPaneHtml = (root: HTMLElement, key: string, html: string) => {
  const memo = committedHtml.get(root)
  if (memo) memo.set(key, html)
  else committedHtml.set(root, new Map([[key, html]]))
}

// 指针按下的落点与时刻。用捕获阶段登记：模块自己的 handler 里 stopPropagation 也拦不住。
const PRESS_DEFER_CAP = 700
let pressedTarget: Node | null = null
let pressedAt = 0
const deferredRenders = new Map<string, () => void>()

const flushDeferredRenders = () => {
  if (!deferredRenders.size) return
  const pending = [...deferredRenders.values()]
  deferredRenders.clear()
  for (const run of pending) {
    try {
      run()
    } catch (_error) {
      /* 一个模块补渲失败不拦其余——与 safeEach 同一纪律 */
    }
  }
}

// 抬起之后**再排一个任务**才补渲。在 pointerup 里就换 DOM 还是白搭：
// click 是在 pointerup → mouseup **之后**才派发的，那时元素已经没了
// （实测：只挂 pointerup 时合成点击照样被吞，加了这一拍才送达）。
const releasePointer = () => {
  pressedTarget = null
  if (deferredRenders.size) setTimeout(flushDeferredRenders, 0)
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      pressedTarget = event.target as Node
      pressedAt = Date.now()
    },
    true,
  )
  document.addEventListener('pointerup', releasePointer, true)
  document.addEventListener('pointercancel', releasePointer, true)
}

/**
 * 用户正按在这块面板上时，把这次**被动**重渲推迟到手指抬起来。
 * 返回 true = 已经排队，调用方本次直接返回。用户自己点出来的渲染不要走这里。
 */
export const deferWhilePressed = (root: HTMLElement, key: string, run: () => void): boolean => {
  if (!pressedTarget || !root.contains(pressedTarget)) return false
  const heldFor = Date.now() - pressedAt
  if (heldFor >= PRESS_DEFER_CAP) return false
  deferredRenders.set(key, run)
  // pointerup 可能永远不来（指针捕获被别处抢走、窗口失焦）——封顶补跑一次，
  // 界面不会因为一次没收到的抬起就冻在旧状态。
  setTimeout(() => {
    if (deferredRenders.get(key) === run) {
      deferredRenders.delete(key)
      try {
        run()
      } catch (_error) {
        /* 同上 */
      }
    }
  }, PRESS_DEFER_CAP - heldFor)
  return true
}

// ---- 第三道闸门：中文输入法组合期间不换 DOM ----
//
// 组合会话（composition）绑在**输入框元素本身**上。整块面板 innerHTML 一重建，
// 那个元素连同组合一起没了，浏览器当场中止组合：候选框闪一下就关，已经敲进去的
// 拼音字母作为普通字符落在框里。2026-08-31 玩家实报「搜索栏无法使用微软输入法：
// 输入法只会闪一下候选框然后直接输入字符」，说的就是这件事。
//
// **withViewStateKept 挡不住它**：那里保的是 value、选区、焦点，换完 DOM 再放回
// **新元素**上——对滚动和光标够用，对组合无效，因为组合不在值里，在元素上。
// 隔离实例 + CDP（Input.imeSetComposition）复现到的事件流正是：
//   compositionstart → compositionupdate(n) → input(isComposing) → 此时锚点已离开文档
//
// 组合不封顶。按下那道闸门要封顶是因为「按住不放」可以无限久，而组合一定会结束
// （敲定、取消、失焦都会派发 compositionend）；封顶反而会在玩家还在选字时换掉 DOM，
// 正是这里要防的那一下。焦点离开正在组合的框再兜一次底，免得漏掉的 compositionend
// 把面板永久冻在旧状态。
let composingIn: Node | null = null
const composingDeferred = new Map<string, () => void>()

const flushComposingDeferred = () => {
  if (!composingDeferred.size) return
  const pending = [...composingDeferred.values()]
  composingDeferred.clear()
  for (const run of pending) {
    try {
      run()
    } catch (_error) {
      /* 一个模块补渲失败不拦其余——与 safeEach 同一纪律 */
    }
  }
}

const endComposition = () => {
  composingIn = null
  // 与按下那道闸门同理，补渲再排一个任务：组合结束这一拍浏览器自己还要收尾
  // （compositionend 之后还有 keyup），换 DOM 让给它做完。
  if (composingDeferred.size) setTimeout(flushComposingDeferred, 0)
}

if (typeof document !== 'undefined') {
  // 捕获阶段登记：模块自己的 handler 里 stopPropagation 也拦不住
  document.addEventListener('compositionstart', (event) => {
    composingIn = event.target as Node
  }, true)
  document.addEventListener('compositionend', endComposition, true)
  document.addEventListener('focusout', (event) => {
    if (event.target === composingIn) endComposition()
  }, true)
}

/** 这块面板里是否正有一个进行中的输入法组合会话。 */
export const isComposingIn = (root: HTMLElement): boolean => {
  // 正在组合的元素被别的路径摘走时，compositionend 未必会来——Chromium 移除
  // 聚焦元素并不保证派发 blur/focusout，上面那条兜底也就跟着落空。留着它，
  // 这块面板的被动重渲会永远排队，界面停在旧状态且没有任何报错，
  // 比原来那个「输入法被打断」更难查。离开文档就当这次组合已经结束。
  if (composingIn && !composingIn.isConnected) endComposition()
  return !!composingIn && root.contains(composingIn)
}

/**
 * 玩家正在这块面板里用输入法打字时，把这次**被动**重渲推迟到组合结束。
 * 返回 true = 已经排队，调用方本次直接返回。玩家自己点出来的渲染不要走这里。
 *
 * 排队的是渲染函数本身而不是那一份 HTML：组合结束后重跑一次是照当时的状态全量重画，
 * 不会把组合期间攒下的其他变化落下。
 */
export const deferWhileComposing = (root: HTMLElement, key: string, run: () => void): boolean => {
  if (!isComposingIn(root)) return false
  composingDeferred.set(key, run)
  return true
}

/**
 * 输入即过滤的搜索框统一挂这里：`handle` 负责「读框里的值 → 重渲」，
 * 组合期间一次都不跑，组合结束之后补跑一次。
 *
 * **不能只写 `if (isComposing) return`**。实测（Electron 43，CDP 模拟微软拼音）
 * 敲定候选那一下的次序是：
 *   compositionupdate(你) → input[isComposing=true] → compositionend(你)
 * 提交那一次的 input **仍然带 isComposing=true**，compositionend 排在它后面——
 * 只跳过不补做的话，中文永远进不了搜索状态，框里有字而列表纹丝不动。
 *
 * compositionend 会冒泡，所以委托挂在面板上的用法与直接挂在输入框上一样管用。
 */
export const onFilterInput = (target: HTMLElement, handle: (event: Event) => void): void => {
  target.addEventListener('input', (event) => {
    if ((event as InputEvent).isComposing) return
    handle(event)
  })
  target.addEventListener('compositionend', handle)
}

// 刷新容器内所有 data-cd（时:分:秒）/ data-cds（短格式）/ data-cdl（月周日时）倒计时文本
export const updateCountdowns = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>('[data-cd]').forEach((el) => {
    el.textContent = fmtCountdown(parseInt(el.dataset.cd!, 10))
  })
  root.querySelectorAll<HTMLElement>('[data-cds]').forEach((el) => {
    el.textContent = fmtCountdownShort(
      parseInt(el.dataset.cds!, 10),
      el.dataset.cdsDone ?? '完成',
    )
  })
  root.querySelectorAll<HTMLElement>('[data-cdl]').forEach((el) => {
    el.textContent = fmtDurationLong(parseInt(el.dataset.cdl!, 10))
  })
}

// ---- 公共工具 ----

export const esc = (s: unknown) => `${s ?? ''}`.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export const fmtTime = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 日期一律 ISO（YYYY-MM-DD）。裸 `toLocaleDateString()` 跟系统 locale 走，
// 这台机器给出的是「09/08/2026」——对玩家有日/月歧义，而且同一个来源区块里
// 会和写死的 ISO 串（「资料更新 2026-08-06」）并排出现，看着像两个不同的时间。
export const fmtDate = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const fmtDateTime = (ts: number) => `${fmtDate(ts)} ${fmtTime(ts)}`

// 措辞分工（各模块页脚共用同一套语义，别再各说各话）：
//   「同步于 HH:MM:SS」= 游戏报文/本机账本落地的时刻；
//   「更新于 YYYY-MM-DD」= 外部资料（矿脉包/主数据）的版本日期。
// 月-日短格式共用这一份；史的图表刻度因宽度用更短的 M/D，是唯一豁免。
export const fmtMonthDay = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 千位缩写唯一口径：≥10000 取整 k、1000–9999 一位小数 k、以下原样。
// 曾有两套（铨对 ≥10000 还带一位小数），同一个数在锱和铨长得不一样。
export const fmtK = (v: number) =>
  Math.abs(v) >= 10000
    ? `${(v / 1000).toFixed(0)}k`
    : Math.abs(v) >= 1000
      ? `${(v / 1000).toFixed(1)}k`
      : `${v}`

// 入渠工时的唯一口径：ndockTime（毫秒）→「N天M小时 / N小时M分 / N分」。
// 向上取整到分钟——报价 90 秒说「1分」会让人以为一分钟就好；负数（已过点）当 0。
// 锐的编成页脚与鉴的入渠排程原先各写一份逐字节相同的实现，收到这里。
export const repairDuration = (milliseconds: number): string => {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60000))
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}天${Math.floor((minutes % 1440) / 60)}小时`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}小时${minutes % 60}分`
  return `${minutes}分`
}

// H:MM:SS 倒计时；到点返回「完成」
export const fmtCountdown = (completeTime: number) => {
  const remain = completeTime - Date.now()
  if (remain <= 0) return '完成'
  const s = Math.floor(remain / 1000)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

// 短格式：37分 / 3:56 （给 Tab 角标用）
export const fmtCountdownShort = (completeTime: number, doneText = '完成') => {
  const remain = completeTime - Date.now()
  if (remain <= 0) return doneText
  const min = Math.ceil(remain / 60000)
  if (min < 60) return `${min}分`
  return `${Math.floor(min / 60)}:${`${min % 60}`.padStart(2, '0')}`
}

// 下一个 JST 整点时刻（返回本地 ts）。任务重置 [5] / 演习刷新 [3,15] 共用同一口径。
const JST_OFFSET = 9 * 3600 * 1000
export const jstDayOfWeek = (ts = Date.now()): number =>
  new Date(ts + JST_OFFSET).getUTCDay()

export const jstHourOf = (ts: number): number => new Date(ts + JST_OFFSET).getUTCHours()

export const nextJstTime = (hours: number[]): number => {
  const nowJst = Date.now() + JST_OFFSET
  const dayStart = Math.floor(nowJst / 86400000) * 86400000
  for (let day = 0; day < 2; day++) {
    for (const h of hours) {
      const t = dayStart + day * 86400000 + h * 3600000
      if (t > nowJst) return t - JST_OFFSET
    }
  }
  return dayStart + 86400000 + hours[0] * 3600000 - JST_OFFSET
}

export const nextWeeklyReset = (): number => {
  let target = nextJstTime([5])
  while (jstDayOfWeek(target) !== 1) target += 86400000
  return target
}

export const nextMonthlyReset = (): number => {
  const nowJst = Date.now() + JST_OFFSET
  const now = new Date(nowJst)
  const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 5)
  const target =
    nowJst < thisMonth
      ? thisMonth
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 5)
  return target - JST_OFFSET
}

// 长周期格式：月+周+日+时（月任/季任/活动截止这类跨日倒计时）；不足一日退化为 时+分
export const fmtDurationLong = (completeTime: number) => {
  let s = Math.floor((completeTime - Date.now()) / 1000)
  if (s <= 0) return '已重置'
  const DAY = 86400
  const months = Math.floor(s / (30 * DAY))
  s %= 30 * DAY
  const weeks = Math.floor(s / (7 * DAY))
  s %= 7 * DAY
  const days = Math.floor(s / DAY)
  s %= DAY
  const hours = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (months) parts.push(`${months}月`)
  if (weeks) parts.push(`${weeks}周`)
  if (days) parts.push(`${days}日`)
  if (parts.length) {
    parts.push(`${hours}时`)
    return parts.join('')
  }
  return `${hours}时${`${mins}`.padStart(2, '0')}分`
}

export const masterShipName = (mstId: number) => mg.master.ships[mstId]?.name ?? `#${mstId}`

// 舰队并列名：canonical = 按当前编成语义生成的标准名，custom = 玩家自定义名。
// 第3舰队实际出现 7 个有效栏位时就是游击部队；只改艦素展示，不回写游戏原名。
export const fleetLabel = (deck: Deck): { canonical: string; custom: string | null } => {
  const numbered = `第${deck.id}舰队`
  const isStrikeForce = deck.id === 3 && deck.ships.filter((id) => id > 0).length === 7
  const canonical = isStrikeForce ? '游击舰队' : numbered
  const isDefault =
    new RegExp(`^第${deck.id}艦隊$`).test(deck.name) ||
    deck.name === numbered ||
    deck.name === canonical
  return { canonical, custom: isDefault ? null : deck.name }
}

// 联合编成里的第 2 舰队（随伴舰队）。
//
// 她是「无远征 = 空闲」这条推断唯一会翻车的一格：联合编成下游戏不允许第 2 舰队
// 单独派远征，所以她的 `deck.mission` 恒为 [0,0,0,0]——凡是只看 mission 位的地方
// 都会把她读成「空闲/待命/可派」，而实际上她要么正随第 1 舰队在海上，要么被锁在
// 编成里动不了。2026-08-27 用户报的顶栏「联合出击中却显示空闲」就是这条。
//
// 判据集中在这里而不是各处各写一遍：消费面有五处（顶栏芯片、铉的甘特条与舰队
// 选择芯片、铉的空闲舰队清单、锐的舰队悬停卡），散着写就是散着漏。
//
// 「出击中」排除演习（与 ru.ts fleetTabsHtml 的 onSortie 同一判据）：演习不是出击，
// 联合编成照样只是「编队中」。sortie.deckId 恒为 1——联合出击由第 1 舰队具名，
// 第 2 舰队不会自己出现在 deckId 上，这正是各处漏判她的原因。
export type CombinedEscortState = 'sortie' | 'formed'

export const combinedEscortState = (deckId: number): CombinedEscortState | null => {
  if (deckId !== 2 || mg.combinedFlag <= 0) return null
  const sortie = mg.sortie
  return sortie?.active && !sortie.practice && sortie.deckId === 1 ? 'sortie' : 'formed'
}
