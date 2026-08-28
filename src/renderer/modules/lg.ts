// 铃 (Lg) · 通知路由——13 稿全量。三纪律：
// ① 通知只送「时刻」，数据留在面板；② 每条必可跳转到具体面板；
// ③ 新事件默认只开「面板徽章」，升级路由（Toast/系统/声音）由用户手动开。
// 事件（10 类）：大破[阻断级锁死] / 远征返港[可提前1分] / 入渠 / 建造 / 任务达成[合并] /
//   演习刷新前未打完[前30分·靠上次打开演习页的快照] / 资源阈值[桶将满·螺丝告急·每日1次·阈值就地配] /
//   疲劳回复完成[按舰队·回港快照推算] / 日周月任重置前未清[前2小时] / 图鉴新登录[仅徽章]。
// 路由：面板徽章 / 右下 Toast（不拦游戏操作）/ 系统通知（仅后台）/ WebAudio 合成音（零资源）/
//   手机推送（ntfy / Bark，默认全关，出网只发生在主进程；人在电脑前时暂缓、离开后补发）。
// 出击勿扰：自动（出击在途暂留非阻断）+ 手动开关。记录落进账本（默认不自动清理，
//   保留天数在钥里；这里另有手动「清空历史」），规则/阈值持久化。
import {
  appendNotice,
  clearNotices,
  combinedEscortState,
  esc,
  markNoticesRead,
  mg,
  nextJstTime,
  nextMonthlyReset,
  nextWeeklyReset,
  onMarriage,
  commitPaneHtml,
  onMgChange,
  onPowerupResult,
  onQpChange,
  onTick,
  onTrayToggleDnd,
  pushTrayDnd,
  pushTrayUnread,
  queryNotices,
  queryQp,
  repairDuration,
  showMainWindow,
  sortieSunkShips,
  uiGet,
  uiSet,
} from '../kernel'
import { DAMAGE_TIER_WORDS, damageTierOf } from '../../shared/battle-damage'
import {
  ESCORT_FLAGSHIP_INDEX,
  flagshipHasDameconIn,
  isTaihaShip,
  taihaVerdictOf,
} from '../../shared/taiha-verdict'
import { navigate } from '../link'
import { entityNamePlain } from '../localization'
import { activateModule, registerModule } from '../mu'
import { observeOwnedShips } from '../ship-first-owned'

import type { EntityRef } from '../link'

import type {
  BattleShipView,
  MarriageCue,
  PowerupResultCue,
  PowerupStatKey,
} from '../../shared/mg-types'
import { qpTaskGroups } from '../../shared/qp-types'
import { USEITEM_MATERIAL_INDEX } from '../../shared/useitem-stock'
import type { QpState, QpStockGoal } from '../../shared/qp-types'
import {
  estimatedCond,
  FATIGUE_READY_COND,
  fatigueReadyTs,
  observeFatigue,
  observedCond,
} from '../fatigue'
import { clampPushIdleMinutes, PUSH_CONFIG_PATHS, PUSH_DEFAULTS } from '../../shared/push-config'

const { ipcRenderer } = require('electron')
const remote = require('@electron/remote')
const config = remote.require('./config')

// ---- 事件定义 ----

type Severity = 'crit' | 'gold' | 'blue' | 'ok' | 'warn'
type RouteKey = 'badge' | 'toast' | 'system' | 'sound' | 'push'

interface EventDef {
  id: string
  label: string
  note: string // 条件/频控说明（矩阵右列的静态部分）
  sev: Severity
  icon: string
  jump: string
  jumpLabel: string
  // 带 ref 时的真实落点。实体路由未必落在 def.jump 那个模块（入渠跳舰娘列表、
  // 建造跳图鉴、演习跳抬头），标签写死成模块名就等于对用户说了假话。
  refLabel?: string
  locked?: boolean // 阻断级：路由全开不可改
  na?: RouteKey[] // 该事件不提供的路由（仅徽章类）
}

const EVENTS: EventDef[] = [
  { id: 'taiha', label: '大破警告', note: '无条件', sev: 'crit', icon: '!', jump: 'di', jumpLabel: '战斗详情', locked: true },
  { id: 'expedition', label: '远征返港', note: '', sev: 'blue', icon: '⚓', jump: 'ru', jumpLabel: '编队 · 远征' },
  { id: 'dock', label: '入渠完成', note: '—', sev: 'blue', icon: '🔧', jump: 'lg', jumpLabel: '通知记录', refLabel: '舰娘列表' },
  { id: 'build', label: '建造完成', note: '—', sev: 'blue', icon: '🔨', jump: 'lg', jumpLabel: '通知记录', refLabel: '舰娘图鉴' },
  { id: 'quest', label: '任务完成 · 待领取', note: '同时完成时合并通知', sev: 'gold', icon: '✓', jump: 'qn', jumpLabel: '任务面板' },
  { id: 'pracRefresh', label: '演习刷新前未打完', note: '刷新前 30 分钟 · 按上次打开演习页时的记录', sev: 'warn', icon: '⚔', jump: 'lg', jumpLabel: '通知记录', refLabel: '抬头 · 演习' },
  { id: 'resource', label: '资源阈值', note: '', sev: 'warn', icon: '⚠', jump: 'zi', jumpLabel: '资源统计' },
  { id: 'condRecover', label: '疲劳预计已恢复', note: '后台估算 · 恢复至 30 · 按舰队', sev: 'ok', icon: '✦', jump: 'ru', jumpLabel: '编队展示' },
  { id: 'questReset', label: '重置前任务未清', note: '日/周/月同规则 · 重置前 2 小时', sev: 'warn', icon: '⏰', jump: 'qn', jumpLabel: '任务面板' },
  { id: 'newShip', label: '新舰入库', note: '首次入库 · 提醒上锁', sev: 'gold', icon: '★', jump: 'ji', jumpLabel: '舰娘图鉴', na: ['system', 'sound'] },
  { id: 'damecon', label: '应急修理发动', note: '同一舰同一战只报一次', sev: 'ok', icon: '修', jump: 'di', jumpLabel: '战斗详情', refLabel: '战斗详情' },
  { id: 'shipSunk', label: '舰娘被击沉', note: '无条件 · 每舰一次', sev: 'crit', icon: '沈', jump: 'di', jumpLabel: '战斗详情', refLabel: '战斗详情' },
  // 婚礼只可能是你亲手点的，人必在机前——系统通知与声音这两路没有意义（同新舰）。
  { id: 'marriage', label: '婚舰 · 结为誓约', note: 'ケッコンカッコカリ 结为誓约时即报 · 每次一条', sev: 'gold', icon: '誓', jump: 'ji', jumpLabel: '舰娘图鉴', refLabel: '舰娘列表', na: ['system', 'sound'] },
]

interface Routes {
  badge: boolean
  toast: boolean
  system: boolean
  sound: boolean
  push: boolean
}

// 默认路由（对齐 13 稿矩阵：白名单极小，徽章几乎全开，往上逐级收紧）。
//
// push（手机推送）这一列只对**时刻类**事件默认开：远征返港 / 入渠完成 /
// 建造完成 / 演习刷新前——这四件事的全部价值就是「几点该回来」，而人不在
// 机前时正是最需要它的时候。其余各类要么只在你正玩着的时候才发生（大破、
// 新舰、任务完成），要么不差这几分钟（疲劳、资源、重置前），推到手机上
// 只是噪音，默认关，用户想要再自己开。
// 另外：整列还压着一个总开关（钥 · 手机推送），它默认关且要用户亲手填地址，
// 所以这里的「默认开」在没配置之前一次也发不出去。
const DEFAULT_RULES: Record<string, Routes> = {
  taiha: { badge: true, toast: true, system: true, sound: true, push: false },
  expedition: { badge: true, toast: true, system: true, sound: true, push: true },
  dock: { badge: true, toast: true, system: true, sound: false, push: true },
  build: { badge: true, toast: true, system: false, sound: false, push: true },
  quest: { badge: true, toast: true, system: false, sound: false, push: false },
  pracRefresh: { badge: true, toast: true, system: false, sound: false, push: true },
  resource: { badge: true, toast: true, system: false, sound: false, push: false },
  condRecover: { badge: true, toast: false, system: false, sound: false, push: false },
  questReset: { badge: true, toast: false, system: false, sound: false, push: false },
  newShip: { badge: true, toast: false, system: false, sound: false, push: false },
  // 这两件都发生在「你正盯着战斗」的时候，靠置顶横幅就够；升级路由留给用户自己开。
  // push 一律不进默认名单——默认开的只有那四类「几点该回来」的时刻事件。
  damecon: { badge: true, toast: true, system: false, sound: false, push: false },
  shipSunk: { badge: true, toast: true, system: true, sound: false, push: false },
  // 婚礼：横幅接管前台，其余保守。push 一律不进默认名单（同上）。
  marriage: { badge: true, toast: true, system: false, sound: false, push: false },
}

// 可就地调的参数（矩阵条件列内联控件）
interface Extras {
  expeditionEarly: boolean // 远征提前 1 分钟
  bucketHigh: number // 高速修复材 ≥ 阈值 →「桶将满」
  screwLow: number // 改修资材 < 阈值 →「螺丝告急」
  manualDnd: boolean
}
const DEFAULT_EXTRAS: Extras = { expeditionEarly: false, bucketHigh: 2900, screwLow: 50, manualDnd: false }

const RULES_KEY = 'lg.rules'
const EXTRAS_KEY = 'lg.extras'
const LOG_KEY = 'lg.log'

let rules: Record<string, Routes> = JSON.parse(JSON.stringify(DEFAULT_RULES))
let extras: Extras = { ...DEFAULT_EXTRAS }
try {
  const savedRules = uiGet<Record<string, Routes>>(RULES_KEY, {})
  for (const [k, v] of Object.entries(savedRules)) {
    if (!rules[k]) continue
    // 大破的本机四路锁死（坏存档不许把强制提醒关掉），但**推送归用户**：
    // 它是出网动作，任何「强制」条款都不该替他打开。缺键 = 按大破自己的默认（关）。
    rules[k] = k === 'taiha' ? { ...rules[k], push: v?.push === true } : { ...rules[k], ...v }
  }
  extras = { ...extras, ...uiGet<Partial<Extras>>(EXTRAS_KEY, {}) }
} catch (_e) {
  /* 坏存档用默认 */
}
const saveRules = () => uiSet(RULES_KEY, rules)
const saveExtras = () => uiSet(EXTRAS_KEY, extras)

// ---- 通知记录 ----

interface Notice {
  key: string // DOM 定位用的本地唯一键；账本行号要等 INSERT 回来，不能拿它当 DOM id
  dbId: number | null // 账本行号；落盘完成前为 null
  session: number // 产生它的那次开机（见 SESSION）
  event: string
  title: string
  detail: string
  ts: number
  read: boolean
  ref?: EntityRef // 具体对象（那一艘/那支队/那条任务）；无则退回模块级跳转
  /**
   * 这一条的手机推送没发出去的原因。只活在本次运行的内存里，不进账本：
   * 它说的是「刚才那一下没成」，重开艦素后回看这条记录时它已无意义。
   */
  pushError?: string
}

interface NotifyPresentation {
  banner?: boolean
  /** 事件本身不固定色调时（应急修理的要員/女神两档）由调用方指定 */
  bannerTone?: BannerTone
  /** 同上：同一事件下分档的徽记（修 / 神）。只靠颜色分档，实机上并排看会糊。 */
  icon?: string
  priority?: 'default' | 'normal'
}

// 通知的落点：有具体对象就走实体路由，否则切到该事件的宿主模块
const goToNotice = (def: EventDef, ref?: EntityRef) => {
  if (ref) navigate(ref)
  else activateModule(def.jump)
}

// 「→ ×××」这行字必须和 goToNotice 真去的地方一致：带 ref 走实体路由，
// 没有 ref 才退回模块级跳转。两处口径分开写过一次，结果是通知写着
// 「→ 通知记录」、点下去落到舰娘列表。
const jumpLabelOf = (def: EventDef, ref?: EntityRef) =>
  ref && def.refLabel ? def.refLabel : def.jumpLabel

// ---- 置顶横幅（新舰庆祝 / 大破警示）----

// 横幅色调。绿色两档专属应急修理：要員(42)＝深玉绿，女神(43)＝亮玉绿，
// 两档 ΔE 26.1（token 与实算见 index.html 的 --damecon-crew / --damecon-goddess）。
// wedding＝ケッコンカッコカリ 的粉（--wedding），全屏唯一的粉色。
type BannerTone = 'celebrate' | 'danger' | 'repair' | 'goddess' | 'wedding'

interface EventBanner {
  notice: Notice
  def: EventDef
  tone: BannerTone
}

// 哪些事件有资格上置顶横幅。damecon 的两档由调用方按装备 mstId 指定，
// 所以它不在这张表里（见 notify 的 presentation.bannerTone）。
const BANNER_TONE: Record<string, BannerTone> = {
  taiha: 'danger',
  newShip: 'celebrate',
  marriage: 'wedding',
}

// 堆叠次序（flex order，与到达顺序无关）。严重度：婚礼 > 应急修理 > 大破 > 新舰。
// 应急修理压在大破之上是因为它**包含**大破——要員只回两成耐久，那艘舰发动后
// 通常仍是大破态，两条横幅会同时挂着；先看到的应当是「刚才差点沉了」。
//
// 婚礼排在最上面，这不是给「喜事」开的例外，而是同一条严重度规则如实套用：
// 婚礼报文只可能在**母港**产生（那个按钮在舰娘详情里），而大破/应急修理只可能在
// **出击途中**产生。两者同屏，就意味着那些警报来自一趟**已经结束**的出击——
// 「撤退」的行动窗口早关了，它们只是还没被手动关掉；此刻刚发生的只有婚礼。
const BANNER_ORDER: Record<BannerTone, number> = {
  wedding: 0,
  goddess: 1,
  repair: 1,
  danger: 2,
  celebrate: 3,
}

let eventBannerEffectsEnabled = Boolean(config.get('kanso.eventBannerEffects', true))
let bannerHost: HTMLElement | null = null
const activeBanners = new Map<string, EventBanner>()

const FRAME_CLASS: Record<BannerTone, string> = {
  danger: 'lg-frame-red',
  goddess: 'lg-frame-jade-bright',
  repair: 'lg-frame-jade',
  wedding: 'lg-frame-pink',
  celebrate: 'lg-frame-gold',
}
// 外框光效同时只能有一种颜色，红优先。
// **与横幅堆叠次序有意不同**：横幅是内容，最要紧的那条排在最上面；外框是环境警报，
// 它要回答的是「现在该做什么」——而应急修理发动之后该做的事仍然是「撤退」，
// 那正是红框在说的话。应急修理的细节就在最上面那张横幅里，不必再靠外框重复一遍。
// 婚礼的粉正因为同一条理由排在三档警报之后：它不指示任何行动。
// 粉压在新舰金之前，则是两档「无事可做」的庆祝之间比稀有度——戒指不可再生。
const FRAME_PRIORITY: BannerTone[] = ['danger', 'goddess', 'repair', 'wedding', 'celebrate']

const syncFrameGlow = () => {
  document.body.classList.remove(...Object.values(FRAME_CLASS))
  if (!eventBannerEffectsEnabled) return
  const tones = new Set([...activeBanners.values()].map((banner) => banner.tone))
  const winner = FRAME_PRIORITY.find((tone) => tones.has(tone))
  if (winner) document.body.classList.add(FRAME_CLASS[winner])
}

// ---- 花瓣（ケッコンカッコカリ 的庆祝层）----
//
// 与横幅/外框分开活：横幅与外框留到用户手动关（那是既有契约），花瓣是**一次仪式**，
// 到时自己退场。纯 CSS，只动 transform / opacity，且只落在两侧边带——
// 中间那块是游戏画面，它自己正在放婚礼动画，不该被糊上一层。
const WEDDING_PETAL_MS = 18_000
const WEDDING_FADE_MS = 1_200
const WEDDING_PETALS = 14

let weddingHost: HTMLElement | null = null
let weddingTimer: ReturnType<typeof setTimeout> | null = null

const stopWeddingPetals = () => {
  if (weddingTimer) clearTimeout(weddingTimer)
  weddingTimer = null
  weddingHost?.remove()
  weddingHost = null
}

/**
 * 撒一次花瓣。参数全部由序号推出来，不掷骰子：
 * 同一次庆祝重跑（重试装配、模拟连点）看到的是同一场，出了问题也复现得出来。
 * 左右交替入带，纵向相位错开，于是既不成列也不成阵。
 */
const startWeddingPetals = () => {
  if (!eventBannerEffectsEnabled) return
  stopWeddingPetals() // 连着办两场就重新计时，不叠两层花瓣
  const host = document.createElement('div')
  host.id = 'lg-wedding'
  host.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < WEDDING_PETALS; i += 1) {
    const petal = document.createElement('i')
    const rightBand = i % 2 === 1
    // 边带各占 15%：左 1%~15%，右 85%~99%
    const along = ((i * 37) % 100) / 100
    petal.className = 'petal'
    petal.style.setProperty('--petal-x', `${(rightBand ? 85 : 1) + along * 14}%`)
    // reduced-motion 那一档不落，就停在这个高度上当静态点缀
    petal.style.setProperty('--petal-y', `${4 + ((i * 61) % 100) * 0.88}%`)
    petal.style.setProperty('--petal-dur', `${7 + (i % 5) * 1.4}s`)
    petal.style.setProperty('--petal-delay', `${(i % 7) * 0.9}s`)
    petal.style.setProperty('--petal-drift', `${(rightBand ? -1 : 1) * (10 + (i % 4) * 9)}px`)
    host.appendChild(petal)
  }
  document.body.appendChild(host)
  weddingHost = host
  weddingTimer = setTimeout(() => {
    host.classList.add('fading')
    // 淡出结束再摘：不听 transitionend——窗口不可见时过渡根本不跑，
    // 那样花瓣层会一直挂在 DOM 上（本仓已吃过这个亏）。
    weddingTimer = setTimeout(stopWeddingPetals, WEDDING_FADE_MS + 200)
  }, WEDDING_PETAL_MS)
}

const ensureBannerHost = () => {
  if (!bannerHost) {
    bannerHost = document.createElement('div')
    bannerHost.id = 'lg-banners'
    bannerHost.setAttribute('aria-live', 'assertive')
    document.body.appendChild(bannerHost)
  }
  return bannerHost
}

/** 婚礼横幅一张都不剩了就收花瓣：手动关掉横幅＝「这场我看完了」，三样一起停。 */
const syncWeddingPetals = () => {
  if (![...activeBanners.values()].some((banner) => banner.tone === 'wedding')) {
    stopWeddingPetals()
  }
}

const closeEventBanner = (noticeKey: string) => {
  activeBanners.delete(noticeKey)
  bannerHost?.querySelector<HTMLElement>(`[data-banner-id="${noticeKey}"]`)?.remove()
  if (!bannerHost?.children.length) {
    bannerHost?.remove()
    bannerHost = null
  }
  syncFrameGlow()
  syncWeddingPetals()
}

const clearEventBanners = () => {
  activeBanners.clear()
  bannerHost?.remove()
  bannerHost = null
  syncFrameGlow()
  stopWeddingPetals()
}

export const setEventBannerEffectsEnabled = (enabled: boolean) => {
  eventBannerEffectsEnabled = enabled
  if (!enabled) clearEventBanners()
}

// 建造结果要不要提前报。**默认关**：造出来是谁，游戏本来要等你点开船坞才揭晓，
// createdShipId 在那之前就已下发，所以这是「能报但选择不报」。
// 开关放在这里而不是抬头，是因为口径必须只有一处——抬头的预览卡与这条通知
// 一起听它，否则会出现「通知不报、预览报了」这种自相矛盾。同理，通知的
// **舰名与跳转落点**也归这一个门管（见 tickDetect 里的建造分支）。
// 初值自己从 config 读：从前只等钥（设置）mount 时推过来，钥装配失败
// 这条用户设置就静默失效——退回默认「关」还算安全，反过来则不然。
let buildSpoilerEnabled = Boolean(config.get('kanso.buildSpoiler', false))
export const setBuildSpoilerEnabled = (enabled: boolean) => {
  buildSpoilerEnabled = enabled
}
export const isBuildSpoilerEnabled = () => buildSpoilerEnabled

const showEventBanner = (def: EventDef, notice: Notice, override?: BannerTone): boolean => {
  const tone = override ?? BANNER_TONE[def.id]
  if (!eventBannerEffectsEnabled || !tone) return false
  const banner: EventBanner = { notice, def, tone }
  activeBanners.set(notice.key, banner)

  const el = document.createElement('section')
  el.className = `lg-banner ${tone}`
  el.style.order = `${BANNER_ORDER[tone]}`
  el.dataset.bannerId = notice.key
  el.innerHTML = `<span class="mark" aria-hidden="true">${def.icon}</span>
    <span class="copy"><b>${esc(notice.title)}</b><span>${esc(notice.detail)}</span></span>
    <span class="actions">
      <button type="button" class="go">查看${esc(jumpLabelOf(def, notice.ref))}</button>
      <button type="button" class="close" title="关闭" aria-label="关闭">✕</button>
    </span>`
  el.querySelector('.go')?.addEventListener('click', () => goToNotice(def, notice.ref))
  el.querySelector('.close')?.addEventListener('click', () => closeEventBanner(notice.key))
  ensureBannerHost().appendChild(el)
  syncFrameGlow()
  return true
}

// 本次开机的标识。历史落在账本里，靠它区分「刚刚发生的」与「上次留下的」：
// 旧会话的条目只读不重放——`aa6c55c` 当初把历史整个删掉，就是因为重开后
// 陈旧通知会重新弹出来。回看和重放是两件事，这里只恢复前者。
const SESSION = Date.now()

let log: Notice[] = []
let nextKey = 1
const makeKey = () => `n${nextKey++}`
// 旧版把 14 日历史塞在 config.json 的 ui.lg.log 里，历史已改由账本承担；
// 清一次空数组，免得配置文件永远背着那份陈账。已经空了就别每次启动都写一遍盘。
if ((uiGet<unknown[]>(LOG_KEY, []) ?? []).length) uiSet(LOG_KEY, [])

// 未读只统计本次开机产生的：跨重启保留未读，等于把「陈旧通知」换个形式弹回来。
const unreadCount = () =>
  log.filter(
    (notice) =>
      !notice.read &&
      notice.session === SESSION &&
      (rules[notice.event] ?? DEFAULT_RULES[notice.event])?.badge,
  ).length

// 已读同时写回账本；dbId 为空说明 INSERT 还没回来，那条留给下次「全部已读」兜底
const markRead = (notices: Notice[]) => {
  const ids = notices.filter((n) => !n.read && n.dbId != null).map((n) => n.dbId!)
  notices.forEach((n) => (n.read = true))
  if (ids.length) void markNoticesRead(ids)
}

// 启动时把账本里的历史读回来。全部按已读处理——它们是拿来回看的，
// 不是拿来重新提醒的；未读徽章只反映本次开机。
// 只恢复一次。装配失败重试时 mount 会整个重跑，而 makeKey 每次发新键、
// 恢复又是「并回 log 再排序」，第二遍等于把同一段历史再并一份，界面上
// 每条通知显示两遍。守卫在 await 之前置位，两次调用叠在一起也只跑一趟。
let logRestored = false
const restoreLog = async () => {
  if (logRestored) return
  logRestored = true
  try {
    const rows = await queryNotices(400)
    if (!rows.length) return
    const restored: Notice[] = rows.map((row) => ({
      key: makeKey(),
      dbId: row.id,
      session: row.session,
      event: row.event,
      title: row.title,
      detail: row.detail,
      ts: row.ts,
      read: true,
      ref: parseRef(row.ref),
    }))
    // 恢复期间可能已经产生了本次会话的通知，按时刻并回去，新的在前
    log = [...log, ...restored].sort((a, b) => b.ts - a.ts).slice(0, 500)
    void markNoticesRead('all')
    renderIfActive()
  } catch (e) {
    // 这一趟没读进来，历史仍是空的——放开守卫，重试装配还能再取一次
    logRestored = false
    console.warn('[kanso] lg: 通知历史读取失败，本次只显示当前会话', e)
  }
}

// 账本里的 ref 是 JSON 文本。形状对不上就当没有 ref——退回模块级跳转，
// 总好过拿一个残缺的实体去 navigate。
const parseRef = (raw: string | null): EntityRef | undefined => {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<EntityRef> | null
    if (!parsed || typeof parsed.type !== 'string') return undefined
    if (typeof parsed.id !== 'number' && typeof parsed.id !== 'string') return undefined
    return { type: parsed.type, id: parsed.id, ...(parsed.ctx ? { ctx: parsed.ctx } : {}) }
  } catch (_e) {
    return undefined
  }
}

// ---- 声音（WebAudio 合成，零资源）----

let audioCtx: AudioContext | null = null
const beep = (crit: boolean) => {
  try {
    audioCtx ??= new AudioContext()
    const play = (freq: number, at: number, dur: number) => {
      const osc = audioCtx!.createOscillator()
      const gain = audioCtx!.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.12, audioCtx!.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx!.currentTime + at + dur)
      osc.connect(gain).connect(audioCtx!.destination)
      osc.start(audioCtx!.currentTime + at)
      osc.stop(audioCtx!.currentTime + at + dur)
    }
    if (crit) {
      play(660, 0, 0.18)
      play(880, 0.2, 0.18)
      play(660, 0.4, 0.28)
    } else {
      play(880, 0, 0.12)
      play(1174, 0.13, 0.16)
    }
  } catch (_e) {
    /* 无音频设备等 */
  }
}

// ---- Toast（游戏画面右下堆叠 · 不拦游戏操作）----

let toastBox: HTMLElement | null = null
const ensureToastBox = () => {
  if (!toastBox) {
    toastBox = document.createElement('div')
    toastBox.id = 'lg-toasts'
  }
  // 挂游戏画面的右下角而非应用窗口右下（用户 2026-08-11 定的位置）。
  // 游戏容器没就绪或被收起（clientWidth=0）时退回 body 右下——通知不能
  // 跟着容器一起隐身。每次显示都重估宿主，搬 DOM 不丢已在显示的通知。
  const wrapper = document.querySelector<HTMLElement>('#game-wrapper')
  const host = wrapper && wrapper.clientWidth > 0 ? wrapper : document.body
  if (toastBox.parentElement !== host) host.appendChild(toastBox)
  return toastBox
}

// Toast 的自动关闭计时：合并进新内容时要清旧表重走，不能让先到的那条
// 带着整张合并卡提前消失
const toastTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
const TOAST_DURATION = 8000
const armToastTtl = (el: HTMLElement) => {
  const prior = toastTimers.get(el)
  if (prior) clearTimeout(prior)
  const ttl = el.querySelector<HTMLElement>('.ttl')
  if (ttl) {
    ttl.style.transition = 'none'
    ttl.style.width = '100%'
    void ttl.offsetWidth // 强制回流，让下一帧的过渡从满格重新走
    ttl.style.transition = `width ${TOAST_DURATION}ms linear`
    requestAnimationFrame(() => (ttl.style.width = '0%'))
  }
  toastTimers.set(el, setTimeout(() => el.remove(), TOAST_DURATION))
}

// 「任务完成 ×3」这类标题里的批量数；合并计数要接着它累加，不能从 1 重数
const toastCountOf = (title: string): number => Number(title.match(/×(\d+)/)?.[1]) || 1

// 溢出驱逐只赶普通 Toast：锁定级（大破 / 出击前状态）承诺「需手动关闭」，
// 被四条远征返港悄悄挤掉就是失信——挤不动就容许临时超过 4 条。
// 所有往 toastBox 里塞卡片的地方都必须走这里：另写一个「删最老一条」的
// 版本，就等于给锁定级留了一条被挤掉的后门（近改结果那处正是如此）。
const TOAST_MAX = 4
const evictOverflowToasts = (box: HTMLElement) => {
  while (box.children.length > TOAST_MAX) {
    const evictable = [...box.children].find((child) => !(child as HTMLElement).dataset.locked)
    if (!evictable) break
    evictable.remove()
  }
}

const showToast = (def: EventDef, title: string, detail: string, ref?: EntityRef) => {
  const box = ensureToastBox()
  // 同类合并（2026-08-17 用户点名「一次处理多了会瞬间占满那一条空间」）：
  // 同类型且非锁定的新通知折进已在显示的那张卡——标题计数 ×N、正文换最新
  // 一条、倒计时重走。锁定级（大破）承诺「需手动关闭」，永不参与合并。
  if (!def.locked) {
    const existing = [...box.children].find(
      (child): child is HTMLElement =>
        (child as HTMLElement).dataset?.event === def.id && !(child as HTMLElement).dataset.locked,
    )
    if (existing) {
      const count = (Number(existing.dataset.stack) || 1) + toastCountOf(title)
      existing.dataset.stack = `${count}`
      existing.dataset.merged = '1' // 合并卡点击进面板总览，不再指向第一条的详情
      const head = existing.querySelector<HTMLElement>('.tx b')
      if (head) head.textContent = `${def.label} ×${count}`
      const body = existing.querySelector<HTMLElement>('.tx > span:not(.act)')
      if (body) body.textContent = `最新：${detail}`
      // 合并卡的落点已经退回模块级，标签也得跟着退回去
      const act = existing.querySelector<HTMLElement>('.tx .act')
      if (act) act.textContent = `→ ${jumpLabelOf(def)}`
      armToastTtl(existing)
      return
    }
  }
  const el = document.createElement('div')
  el.className = `lg-toast ${def.sev}`
  el.dataset.event = def.id
  el.dataset.stack = `${toastCountOf(title)}`
  el.innerHTML = `<span class="ic">${def.icon}</span>
    <span class="tx"><b>${esc(title)}</b><span>${esc(detail)}</span><span class="act">→ ${esc(jumpLabelOf(def, ref))}</span></span>
    <span class="x" title="${def.locked ? '需手动关闭' : '关闭'}">✕</span>
    ${def.locked ? '' : '<span class="ttl"></span>'}`
  el.querySelector('.x')!.addEventListener('click', (e) => {
    e.stopPropagation()
    el.remove()
  })
  // 点击语义（用户 2026-08-27 定）：**卡面任意位置＝只关闭，只有「→ ××」那行字才跳转**。
  // 从前整卡都是跳转热区，于是「顺手把这条通知划掉」这个最常见的动作会把人弹到
  // 别的面板去——关掉一条通知与去处理它是两件事，不该共用一个热区。
  // 跳转这一路自己拦下冒泡：不拦的话卡面那条「只关闭」的监听器会跟着跑一遍。
  el.querySelector('.tx .act')!.addEventListener('click', (e) => {
    e.stopPropagation()
    goToNotice(def, el.dataset.merged ? undefined : ref)
    el.remove()
  })
  // 锁定级（大破 / 出击前状态）同样点一下就关：locked 承诺的是「不自动超时、
  // 不被溢出驱逐」，手动关掉本来就在允许之列（`.x` 那句「需手动关闭」说的正是这件事）。
  el.addEventListener('click', () => el.remove())
  if (def.locked) el.dataset.locked = '1'
  box.appendChild(el)
  evictOverflowToasts(box)
  if (!def.locked) armToastTtl(el)
}

const POWERUP_STAT: Record<PowerupStatKey, { label: string; cls: string }> = {
  firepower: { label: '火力', cls: 'fire' },
  torpedo: { label: '雷装', cls: 'torp' },
  antiAir: { label: '对空', cls: 'aa' },
  armor: { label: '装甲', cls: 'armor' },
  luck: { label: '运', cls: 'luck' },
  hp: { label: '耐久', cls: 'hp' },
  asw: { label: '对潜', cls: 'asw' },
}

// 近代化改修是一次性操作结果：留在画面侧面 7 秒，不占通知历史和徽章。
const showPowerupResultToast = (result: PowerupResultCue) => {
  const box = ensureToastBox()
  const original = mg.master.ships[result.mstId]?.name ?? `#${result.mstId}`
  const shipName = entityNamePlain('ship', result.mstId, original)
  const stats = result.stats.length
    ? result.stats
        .map((stat) => {
          const meta = POWERUP_STAT[stat.key]
          // room 是「还能再改修多少」：0 才是真满，null 是判不了（不说）。
          // 以前拿含装备的面板值比不含装备的裸上限，几乎项项都会挂个假的「满」。
          const room =
            stat.room == null
              ? ''
              : stat.room === 0
                ? '<em class="full">满</em>'
                : `<em>还可 +${stat.room}</em>`
          return `<span class="powerup-stat ${meta.cls}">
            <i>${meta.label}</i><strong>+${stat.delta}</strong>
            <small>${stat.before}→${stat.after}</small>${room}
          </span>`
        })
        .join('')
    : '<span class="powerup-empty">强化已生效 · 本次没有属性提升明细</span>'

  const el = document.createElement('div')
  el.className = 'lg-toast ok powerup-result'
  el.innerHTML = `<span class="ic">改</span>
    <span class="tx">
      <b>强化成功 · ${esc(shipName)}</b>
      <span class="powerup-caption">近代化改修 · 实际提升</span>
      <span class="powerup-grid">${stats}</span>
      <span class="act">→ 查看这艘舰</span>
    </span>
    <span class="x" title="关闭">✕</span>
    <span class="ttl"></span>`
  el.querySelector('.x')!.addEventListener('click', (event) => {
    event.stopPropagation()
    el.remove()
  })
  el.addEventListener('click', () => {
    navigate({ type: 'ship', id: result.rosterId })
    el.remove()
  })
  box.appendChild(el)
  evictOverflowToasts(box)

  const duration = 7000
  const ttl = el.querySelector<HTMLElement>('.ttl')
  if (ttl) {
    ttl.style.transition = `width ${duration}ms linear`
    ttl.style.width = '100%'
    requestAnimationFrame(() => (ttl.style.width = '0%'))
  }
  setTimeout(() => el.remove(), duration)
}

// 游戏刚进入海域选择页时的即时编成提醒：不写入长期通知历史，
// 只在临行这一刻出现；点击直接落到需要先处理的舰队。
export const showSortieReadinessToast = (
  title: string,
  detail: string,
  fleetId: number,
  critical: boolean,
  ref: EntityRef = { type: 'fleet', id: fleetId },
) => {
  showToast(
    {
      id: 'sortieReadiness',
      label: '出击前状态',
      note: '进入海域选择页时',
      sev: critical ? 'crit' : 'warn',
      icon: '!',
      jump: 'ru',
      jumpLabel: `检查第${fleetId}舰队`,
      locked: critical,
    },
    title,
    detail,
    ref,
  )
}

// ---- 出击勿扰（自动 + 手动）----

const dndActive = () => extras.manualDnd || (!!mg.sortie?.active && !mg.sortie.practice)

// 托盘的勿扰勾选跟着真状态走。出击自动勿扰也算在内——托盘上显示「勿扰开着」
// 而面板说是自动触发的，比显示成关着要诚实。
const syncTrayDnd = () => void pushTrayDnd(dndActive())

// 托盘菜单里点勿扰：只有手动那一档能被它切。出击中的自动勿扰不接受托盘干预，
// 否则用户会以为关掉了，实际下一条仍被暂留。
const toggleManualDnd = () => {
  extras.manualDnd = !extras.manualDnd
  saveExtras()
  if (!dndActive() && heldQueue.length) flushHeld()
  syncTrayDnd()
  renderIfActive()
}
interface HeldNotice {
  def: EventDef
  title: string
  detail: string
  toast: boolean
  system: boolean
  sound: boolean
  ref?: EntityRef
}
const heldQueue: HeldNotice[] = []
// 暂留上限。一次长出击攒上百条不是没有可能（远征×4 + 疲劳 + 任务），
// 全留着只会在归港那一刻糊住整块屏幕，还得逐条关。超出就丢最老的**送达**，
// 记录本身早在 notify 里进了 log，回看不受影响——所以送达时如实说一句。
const HELD_MAX = 50
let heldDropped = 0
const holdNotice = (item: HeldNotice) => {
  heldQueue.push(item)
  while (heldQueue.length > HELD_MAX) {
    heldQueue.shift()
    heldDropped++
  }
}

const showSystemNotice = (
  def: EventDef,
  title: string,
  detail: string,
  ref?: EntityRef,
) => {
  if (document.hasFocus()) return
  try {
    const notice = new Notification(`kuma · ${title}`, { body: detail, silent: true })
    notice.onclick = () => {
      // 窗口可能已收进托盘：此时 window.focus() 什么也不做，得让主进程 show()
      void showMainWindow()
      window.focus()
      goToNotice(def, ref)
      notice.close()
    }
  } catch (_e) {
    /* 系统通知不可用 */
  }
}

// 勿扰解除（归港 / 手动关）时一次性送达。三件事必须在这里收口，
// 因为暂留队列天然是「一口气 N 条」，而不是零散来的：
// ① 声音：N 条各起一个振荡器是同一刻叠加，出来是爆音而不是提示音——
//    队列里只要有一条要响，就响一声；
// ② 系统通知：按事件类型合并，一类一条。十条远征返港刷十条系统通知，
//    信息量还是那一条，代价是通知中心被顶掉别的应用；
// ③ 出队要逐条 shift + try/catch：从前是裸循环 + 循环外清空，一条抛
//    异常就把后面全丢了，而且整队原封留着，下次 flush 会重放一遍。
const flushHeld = () => {
  const dropped = heldDropped
  heldDropped = 0
  let wantSound = false
  const systemMerged = new Map<string, { item: HeldNotice; count: number }>()
  while (heldQueue.length) {
    const h = heldQueue.shift()!
    if (h.sound) wantSound = true
    if (h.system) {
      const prior = systemMerged.get(h.def.id)
      if (prior) {
        prior.count++
        prior.item = h // 正文取最新那条
      } else {
        systemMerged.set(h.def.id, { item: h, count: 1 })
      }
    }
    if (!h.toast) continue
    try {
      showToast(h.def, h.title, h.detail, h.ref)
    } catch (e) {
      console.warn('[kanso] lg: 暂留通知送达失败', h.def.id, e)
    }
  }
  if (wantSound) beep(false)
  for (const { item, count } of systemMerged.values()) {
    try {
      showSystemNotice(
        item.def,
        count > 1 ? `${item.def.label} ×${count}` : item.title,
        count > 1 ? `最新：${item.detail}` : item.detail,
        // 合并后指向的不再是某一条，退回模块级跳转
        count > 1 ? undefined : item.ref,
      )
    } catch (e) {
      console.warn('[kanso] lg: 暂留系统通知送达失败', item.def.id, e)
    }
  }
  if (dropped > 0) {
    showToast(
      {
        id: 'dndOverflow',
        label: '暂留积压',
        note: '',
        sev: 'warn',
        icon: '⋯',
        jump: 'lg',
        jumpLabel: '通知记录',
      },
      `另有 ${dropped} 条更早的暂留未展开`,
      `勿扰期间积压超过 ${HELD_MAX} 条`,
    )
  }
}

// ---- 发射 ----

const updateBadge = () => {
  const unread = unreadCount()
  // 托盘上的数字必须和面板红点同源，否则会出现「托盘说 3 条、点开一条没有」
  void pushTrayUnread(unread)
  // 顶栏弹窗按钮上的红点计数（铃是弹窗类模块，没有常驻 Tab）
  const dot = document.querySelector<HTMLElement>('[data-badge="lg"]')
  if (dot) dot.textContent = unread > 0 ? `${unread > 99 ? '99+' : unread}` : ''
  // 兼容：若被用户挪进坞位当常驻页，Tab 上也带计数
  const tab = document.querySelector<HTMLElement>('.ws-tab[data-mod="lg"]')
  if (tab) tab.textContent = unread > 0 ? `通知 (${unread})` : '通知'
}

// ---- 手机推送 ----

/** push:send 的三种结局。铃这边只认这三档 */
type PushOutcome = 'sent' | 'deferred' | 'failed'

/**
 * 补发时给标题挂的时距标记。时距文本只认 kernel 那一份口径（repairDuration），
 * 这里不另写一套格式化。不到一分钟不挂——那不叫补发，就是当刻。
 */
const HELD_PUSH_MARK_MS = 60000
const heldPushTitle = (title: string, heldMs: number): string =>
  heldMs >= HELD_PUSH_MARK_MS ? `${title}（${repairDuration(heldMs)}前）` : title

/**
 * 铃只知道「要不要推」，怎么推、往哪推、加不加密、这一刻该不该推，全在主进程。
 * 渲染层从头到尾不发一个网络请求——出网只有 main/push.ts 那一处。
 *
 * `occurredTs` 是**事件发生的时刻**，不是发送时刻：补发时用它算出「几分前」挂在
 * 标题后面，手机上才分得清「刚返港」和「半小时前就返港了」。当刻发送时两者相等，
 * 标题原样。
 */
const sendNoticePush = (
  notice: Notice,
  title: string,
  detail: string,
  group: string,
  occurredTs: number,
): Promise<PushOutcome> =>
  ipcRenderer
    .invoke('push:send', {
      title: heldPushTitle(title, Date.now() - occurredTs),
      body: detail,
      group,
    })
    .then(
      (
        result: { ok?: boolean; skipped?: boolean; deferred?: boolean; message?: string } | null,
      ): PushOutcome => {
        // deferred = 人还在电脑前，这条一个字节都没出网。不是失败（别栽红字），
        // 交给补发队列等他离开。
        if (result?.deferred) return 'deferred'
        // skipped = 总开关没开 / 地址还没填。那也不是失败
        if (result?.ok || result?.skipped) return 'sent'
        markPushFailed(notice, result?.message || '推送失败（未回报原因）')
        return 'failed'
      },
    )
    .catch((error: unknown): PushOutcome => {
      markPushFailed(notice, error instanceof Error ? error.message : `${error}`)
      return 'failed'
    })

/**
 * 失败只做两件事：写一行 console.warn，给那条记录挂个标注。
 *
 * **绝不能再 notify() 一条「推送失败」通知**——那条新通知会再次命中推送路由、
 * 再失败、再生一条，一路自激（同一台机器上已经有过 console.error 在自己的
 * 错误处理里再抛 EPIPE、把日志滚到 606MB 的先例）。这个函数里不出现
 * notify / sendNoticePush，就是那条护栏的实体。
 */
const markPushFailed = (notice: Notice, message: string) => {
  notice.pushError = message
  console.warn('[kanso] lg: 手机推送失败', notice.event, message)
  renderIfActive()
}

/**
 * 推送总开关的**显示副本**（钥里改了会推过来）。判定权在主进程：
 * 这里绝不能拿它去挡发送，否则就成了两处各存一份、迟早分家的第二道门。
 * 它只负责让规则矩阵那行小字说实话——不然用户看着一列亮着的圆点，
 * 却怎么也等不到手机响。
 */
let pushEnabledHint = config.get(PUSH_CONFIG_PATHS.enabled, PUSH_DEFAULTS.enabled) === true
export const setPushEnabled = (enabled: boolean) => {
  pushEnabledHint = enabled
  renderIfActive()
}

// ---- 离场补发队列 ----
//
// 主进程判「人还在电脑前」时那条推送没有出网，收进这里；等键鼠空闲跨过阈值，
// 再按发生顺序补上、标题带「几分前」。三条纪律照抄勿扰暂留队列的教训：
// ① 有上限，超出丢最老——一次长离场攒下的旧时刻，补出来也早过期了；
// ② 出队逐条隔离，一条抛异常不许把后面的全带走；
// ③ 失败仍只走 sendNoticePush 那一条老路（标注，不再生通知）——绝不自激。
interface HeldPush {
  notice: Notice
  title: string
  detail: string
  group: string
  /** 事件发生的时刻，补发时据此算「几分前」 */
  ts: number
}
const heldPushQueue: HeldPush[] = []
const HELD_PUSH_MAX = 30
const holdPush = (item: HeldPush) => {
  heldPushQueue.push(item)
  while (heldPushQueue.length > HELD_PUSH_MAX) {
    const dropped = heldPushQueue.shift()!
    // 记录本身早在 notify 里进了通知记录，回看不受影响；丢的只是补推那一下
    console.warn('[kanso] lg: 补发队列超过上限，丢掉最老的一条', dropped.notice.event)
  }
}

/** 事件发生即发；被主进程判为「人在电脑前」的收进补发队列 */
const pushOrHold = (notice: Notice, title: string, detail: string, group: string) => {
  const ts = Date.now()
  void sendNoticePush(notice, title, detail, group, ts).then((outcome) => {
    if (outcome === 'deferred') holdPush({ notice, title, detail, group, ts })
  })
}

let flushingHeldPush = false
/**
 * 按序补发。**一条一条来，每条都重新过主进程那道门**：补发途中人又回到电脑前，
 * 那条会再收到 deferred，于是就地停下——剩下的原样留在队列里，顺序也不乱
 * （停下的这条还在队首，没有被 shift 掉）。
 */
const flushHeldPush = async () => {
  if (flushingHeldPush) return
  flushingHeldPush = true
  try {
    while (heldPushQueue.length) {
      // 先出队再发：在飞的这条不留在队列里。同一刻若有新的暂缓进来把队列顶到
      // 上限，丢掉的也只会是别的旧条目，绝不会把正在发的这条从底下抽走。
      const held = heldPushQueue.shift()!
      let outcome: PushOutcome = 'failed'
      try {
        outcome = await sendNoticePush(held.notice, held.title, held.detail, held.group, held.ts)
      } catch (e) {
        // 逐条隔离：一条炸了不许把后面的全丢了（勿扰暂留队列当年正是栽在这上面）
        console.warn('[kanso] lg: 补发推送出错', held.notice.event, e)
      }
      // 人又回到电脑前：这条原样退回队首，剩下的继续等下一轮（顺序不乱）
      if (outcome === 'deferred') {
        heldPushQueue.unshift(held)
        break
      }
    }
  } finally {
    flushingHeldPush = false
  }
}

/**
 * 在场门槛的**显示副本 + 轮询节拍**（钥里改了会推过来）。判定权同样在主进程：
 * 这里读它只决定「要不要试一次补发」，试早了主进程会再回一个 deferred、队列原样
 * 留着——所以它不构成第二道门（与上面 pushEnabledHint 同一条纪律）。
 */
let pushPresenceHoldHint =
  config.get(PUSH_CONFIG_PATHS.presenceHold, PUSH_DEFAULTS.presenceHold) !== false
let pushIdleSecondsHint =
  clampPushIdleMinutes(
    config.get(PUSH_CONFIG_PATHS.presenceIdleMinutes, PUSH_DEFAULTS.presenceIdleMinutes),
  ) * 60
export const setPushPresence = (hold: boolean, idleMinutes: number) => {
  pushPresenceHoldHint = hold
  // 分钟 → 秒只在这里换算一次；比较那一侧拿到的已经是秒
  pushIdleSecondsHint = clampPushIdleMinutes(idleMinutes) * 60
  // 门槛关掉就没有「等人离开」这回事了：攒着的立刻补上（发不发仍由主进程说了算）
  if (!hold && heldPushQueue.length) void flushHeldPush()
  renderIfActive()
}

// 每秒问一次空闲时间是没必要的 IPC——阈值本身是分钟级，30 秒的粒度绰绰有余。
const PUSH_IDLE_POLL_MS = 30000
let lastIdlePollTs = 0
const pollPushPresence = () => {
  if (!heldPushQueue.length || flushingHeldPush) return
  const now = Date.now()
  if (now - lastIdlePollTs < PUSH_IDLE_POLL_MS) return
  lastIdlePollTs = now
  if (!pushPresenceHoldHint) {
    // 门槛在攒着的这段时间里被关掉了：这些没有理由再等
    void flushHeldPush()
    return
  }
  void ipcRenderer
    .invoke('push:idle-seconds')
    .then((seconds: unknown) => {
      const idle = Number(seconds)
      if (Number.isFinite(idle) && idle >= pushIdleSecondsHint) void flushHeldPush()
    })
    .catch((error: unknown) => {
      // 不静默吞：这一轮不补，下一轮再问
      console.warn('[kanso] lg: 读不出系统空闲时间，这一轮不补发', error)
    })
}

// 13 稿第二纪律「每条必可跳转到具体面板位置」：带 ref 的通知走实体路由
// （落到那一艘/那支队/那条任务），没有具体对象的才退回模块级跳转。
const notify = (
  eventId: string,
  title: string,
  detail: string,
  ref?: EntityRef,
  presentation: NotifyPresentation = {},
) => {
  const def = EVENTS.find((e) => e.id === eventId)
  if (!def) return
  const displayDef: EventDef =
    presentation.priority === 'normal'
      ? { ...def, sev: 'warn', icon: '破', locked: false }
      : presentation.icon
        ? { ...def, icon: presentation.icon }
        : def
  const route = rules[eventId] ?? DEFAULT_RULES[eventId]
  const notice: Notice = {
    key: makeKey(),
    dbId: null,
    session: SESSION,
    event: eventId,
    title,
    detail,
    ts: Date.now(),
    read: false,
    ref,
  }
  log.unshift(notice)
  log = log.slice(0, 500)
  void appendNotice({
    ts: notice.ts,
    session: SESSION,
    event: eventId,
    title,
    detail,
    ref: ref ? JSON.stringify(ref) : null,
    read: false,
  }).then((id) => {
    notice.dbId = id
    // 落盘慢于用户点击时，那次点击只改了内存态；补一次写回
    if (id != null && notice.read) void markNoticesRead([id])
  })
  if (route.badge) updateBadge()
  const blocking = presentation.priority !== 'normal' && !!def.locked
  // 置顶横幅接管新舰与大破的前台视觉，避免再叠一张内容重复的右下 Toast。
  // 设置关闭横幅时，大破仍回退到原有强制 Toast，不会丢掉安全提醒。
  const promotedToBanner =
    presentation.banner !== false && showEventBanner(displayDef, notice, presentation.bannerTone)
  // na（该事件不提供的路由）要在**决策**这一步就过滤，不能只挡系统通知那一路：
  // 矩阵把 na 的圆点渲染成不可点，旧存档里若躺着一个 newShip.sound=true，
  // 用户在界面上根本关不掉，却每来一艘新舰都响一声。
  const routed = (key: RouteKey) => route[key] && !displayDef.na?.includes(key)
  const toast = (routed('toast') || blocking) && !promotedToBanner
  const sound = routed('sound') || blocking
  const system = routed('system')
  // 手机推送：**不进勿扰暂留、不合并、不跟 blocking**，事件发生即发
  // （唯一的例外是主进程那道在场门槛：人还在电脑前时它不出网，改由补发队列接手）。
  // ① 不暂留：默认开的那四类是「时刻」（远征返港、入渠、建造、演习刷新前），
  //    它们的全部价值就在当刻到达。出击勿扰要挡的是「在机前游玩时被打断」，
  //    与手机上收到提醒本就不是同一件事——攒到归港再一口气推十条，
  //    恰好把唯一有用的那条信息（几点该回来）毁掉。可预期性优先。
  // ② 不合并：一个时刻一条，手机通知栏上数得清。
  // ③ 不跟 blocking：强制提醒承诺的是「在这台机器上一定看得见」，
  //    而推送是出网动作，只由用户手动打开，任何强制条款都不替他开。
  if (routed('push')) pushOrHold(notice, title, detail, displayDef.label)
  if (!blocking && dndActive() && (toast || sound || system)) {
    holdNotice({ def: displayDef, title, detail, toast, system, sound, ref })
  } else {
    if (toast) showToast(displayDef, title, detail, ref)
    if (sound) beep(blocking)
    if (system) showSystemNotice(displayDef, title, detail, ref)
  }
  renderIfActive()
}

// ---- 探测器 ----

// 已发提醒的去重表。**必须落盘**：纯内存 Set 一重启就失忆，而「日任重置前 2 小时」
// 这类窗口期提醒只要还在窗口内、每次启动都会重新判定成立——实测凌晨 02:05–02:26
// 连发 6 条，正好对应 6 次重启。疲劳恢复、资材告急等所有走 fireOnce 的提醒同病。
// 存 {key: 记录时刻}：所有 key 都带具体时刻（resetTs / completeTime / gameDayKey），
// 过两天必然不会再命中，顺手按 TTL 丢掉，免得这张表无限长。
const FIRED_KEY = 'lg.fired'
const FIRED_TTL = 48 * 3600 * 1000

const loadFired = (): Map<string, number> => {
  const saved = uiGet<Record<string, number>>(FIRED_KEY, {})
  const now = Date.now()
  const out = new Map<string, number>()
  for (const [key, ts] of Object.entries(saved ?? {})) {
    if (typeof ts === 'number' && ts <= now && now - ts < FIRED_TTL) out.set(key, ts)
  }
  return out
}

const fired = loadFired()
let firedSaveTimer: ReturnType<typeof setTimeout> | null = null

/** 记一笔已发。写盘防抖：armTimers 启动时会一次性标记一批。 */
const markFired = (key: string) => {
  fired.set(key, Date.now())
  if (firedSaveTimer) return
  firedSaveTimer = setTimeout(() => {
    firedSaveTimer = null
    uiSet(FIRED_KEY, Object.fromEntries(fired))
  }, 500)
}

const fireOnce = (key: string, fn: () => void) => {
  if (fired.has(key)) return
  markFired(key)
  fn()
}

// JST 时刻工具（重置/演习刷新计算）统一由 kernel 提供。
const nextDailyReset = () => nextJstTime([5])

// 启动时把已过期的时刻标记为已触发（只在运行中「穿越时刻」才响）
let armed = false
const expFireTs = (returnTs: number) => returnTs - (extras.expeditionEarly ? 60000 : 0)
const armTimers = () => {
  const now = Date.now()
  for (const deck of mg.decks) {
    if (deck.mission?.[0] > 0 && expFireTs(deck.mission[2]) <= now) markFired(`exp-${deck.id}-${deck.mission[2]}`)
  }
  for (const dock of mg.ndocks) {
    if (dock.shipId > 0 && dock.completeTime <= now) markFired(`dock-${dock.id}-${dock.completeTime}`)
  }
  for (const dock of mg.kdocks) {
    if (dock.state === 2 && dock.completeTime <= now) markFired(`build-${dock.id}-${dock.completeTime}`)
  }
  armed = true
}

// 疲劳回复 · 后台计时器。游戏的 cond 自然回复（3 分钟 +3，上限 49）只在切回母港
// 界面时才同步数值——所以不等游戏，本地按「该舰 cond 最后一次被观测到变化的时刻」推算：
// estCond = cond + 3 × floor(经过分钟 / 3)，全队推算 ≥30 且曾有疲劳(<30) 即通知。
const trackCond = (confirmed = false) => {
  const ts = confirmed && mg.lastPortTs ? mg.lastPortTs : Date.now()
  observeFatigue(Object.values(mg.ships), ts, confirmed)
}
let lastCondSnapshotTs = 0
const condRecoveryInfo = (deckId: number): { tired: boolean; ready: boolean; readyTs: number } => {
  const deck = mg.decks.find((d) => d.id === deckId)
  if (!deck) return { tired: false, ready: false, readyTs: 0 }
  let tired = false
  let ready = true
  let readyTs = 0
  for (const id of deck.ships) {
    if (id <= 0) continue
    const seen = observedCond(id)
    if (!seen) continue
    if (seen.cond < FATIGUE_READY_COND) {
      tired = true
      const shipReady = fatigueReadyTs(id, FATIGUE_READY_COND) ?? seen.ts
      readyTs = Math.max(readyTs, shipReady)
      if (
        (estimatedCond(id, FATIGUE_READY_COND) ?? FATIGUE_READY_COND) <
        FATIGUE_READY_COND
      ) {
        ready = false
      }
    }
  }
  return { tired, ready, readyTs }
}

const gameDayKey = () => {
  // JST 05:00 是游戏日界线：UTC +9 后再减 5 小时，用 UTC 日期取稳定 key。
  const d = new Date(Date.now() + 4 * 3600000)
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}-${`${d.getUTCDate()}`.padStart(2, '0')}`
}

const tickDetect = () => {
  if (!mg.master.ready) return
  if (!armed) armTimers()
  const now = Date.now()
  // 远征返港（可提前 1 分）
  for (const deck of mg.decks) {
    if (deck.mission?.[0] > 0 && deck.mission[2] > 0 && expFireTs(deck.mission[2]) <= now) {
      fireOnce(`exp-${deck.id}-${deck.mission[2]}`, () => {
        const m = mg.master.missions[deck.mission[1]]
        const early = extras.expeditionEarly && deck.mission[2] > now
        notify(
          'expedition',
          `远征 ${m?.dispNo ?? deck.mission[1]} ${early ? '即将返港' : '返港'}`,
          // 远征名的译名键是 dispNo 不是 api id（header-status.ts:156/531 同一实体的写法）
          `第${deck.id}舰队 ·${m ? ` ${entityNamePlain('expedition', m.dispNo, m.name)} ·` : ''} ${early ? '1 分钟内返回' : '可再次派遣'}`,
          { type: 'fleet', id: deck.id },
        )
      })
    }
  }
  // 入渠 / 建造
  for (const dock of mg.ndocks) {
    if (dock.shipId > 0 && dock.completeTime > 0 && dock.completeTime <= now) {
      fireOnce(`dock-${dock.id}-${dock.completeTime}`, () => {
        const ship = mg.ships[dock.shipId]
        // 通知这一族同时推系统通知与手机 Bark，落地就是玩家手机上的一行字。
        // 紧挨着的「建造完成」走了译名表，这条没走——直取主数据就是日文舰名。
        const name = ship
          ? entityNamePlain('ship', ship.shipId, mg.master.ships[ship.shipId]?.name ?? `#${ship.shipId}`)
          : '舰娘'
        notify('dock', `${name} 入渠完成`, `渠${dock.id} 空闲`, ship ? { type: 'ship', id: ship.id } : undefined)
      })
    }
  }
  for (const dock of mg.kdocks) {
    if (dock.state === 2 && dock.completeTime > 0 && dock.completeTime <= now) {
      fireOnce(`build-${dock.id}-${dock.completeTime}`, () => {
        // 剧透门禁只有这一个开关：舰名和「点通知落到哪」同开同关。
        // 从前只挡了名字，ref 照旧带着 mstShip——通知写「建造完成」，
        // 点一下直接跳进那艘舰的图鉴，等于绕过门把答案递到脸上。
        const spoil = buildSpoilerEnabled && dock.createdShipId > 0
        const name = spoil
          ? entityNamePlain(
              'ship',
              dock.createdShipId,
              mg.master.ships[dock.createdShipId]?.name ?? `#${dock.createdShipId}`,
            )
          : ''
        notify(
          'build',
          name ? `建造完成 · ${name}` : '建造完成',
          `坞${dock.id} · 前往工厂接收`,
          spoil ? { type: 'mstShip', id: dock.createdShipId } : undefined,
        )
      })
    }
  }
  // 演习刷新前 30 分未打完（JST 3:00 / 15:00 刷新；靠上次演习页快照，无快照不猜）
  const pracReset = nextJstTime([3, 15])
  if (pracReset - now <= 30 * 60000 && mg.practice) {
    const remain = mg.practice.list.filter((e) => e.state === 0).length
    const fresh = mg.practice.ts > pracReset - 12 * 3600000 // 快照属于本刷新周期
    if (remain > 0 && fresh) {
      fireOnce(`prac-${pracReset}`, () =>
        notify(
          'pracRefresh',
          `演习还剩 ${remain} 场未打`,
          `刷新前 30 分钟（记录时间 ${fmtTm(mg.practice!.ts)}）`,
          { type: 'practice', id: 'current' },
        ),
      )
    }
  }
  // 资源阈值（每日各 1 次）
  if (mg.materials) {
    const bucket = mg.materials[5] ?? 0
    const screw = mg.materials[7] ?? 0
    if (extras.bucketHigh > 0 && bucket >= extras.bucketHigh) {
      fireOnce(`res-bucket-${gameDayKey()}`, () =>
        notify('resource', `高速修复材将满：${bucket}`, `阈值 ≥${extras.bucketHigh}`, { type: 'material', id: 5 }),
      )
    }
    if (extras.screwLow > 0 && screw < extras.screwLow) {
      fireOnce(`res-screw-${gameDayKey()}`, () =>
        notify('resource', `改修资材告急：${screw}`, `阈值 <${extras.screwLow}`, { type: 'material', id: 7 }),
      )
    }
  }
  // 疲劳回复完成（后台计时推算 · 按舰队；远征中/出击中的队不看）
  for (const deck of mg.decks) {
    if (deck.mission?.[0] > 0) continue
    if (mg.sortie?.active && !mg.sortie.practice && mg.sortie.deckId === deck.id) continue
    // 联合出击时第 2 舰队也在海上，可上一行看不见她（sortie.deckId 恒为 1）：
    // 人还没回港就喊「疲劳已恢复」，玩家什么也做不了。只抑制出击态——
    // 编队中的她在母港里，恢复完了照样值得说一声。
    if (combinedEscortState(deck.id) === 'sortie') continue
    const { tired, ready, readyTs } = condRecoveryInfo(deck.id)
    if (tired && ready && readyTs > 0 && readyTs <= now) {
      fireOnce(`cond-${deck.id}-${readyTs}`, () =>
        notify('condRecover', `第${deck.id}舰队 疲劳预计已恢复`, `士气估算已恢复至 ${FATIGUE_READY_COND}`, {
          type: 'fleet',
          id: deck.id,
        }),
      )
    }
  }
  // 日/周/月任务重置前 2 小时未清（type 1 日 2 周 3 月）
  const resetDefs: [number, string, number][] = [
    [1, '日任', nextDailyReset()],
    [2, '周任', nextWeeklyReset()],
    [3, '月任', nextMonthlyReset()],
  ]
  for (const [type, label, resetTs] of resetDefs) {
    if (resetTs - now > 2 * 3600000) continue
    const remain = Object.values(mg.quests).filter((q) => q.type === type && q.state === 2).length
    if (remain > 0) {
      fireOnce(`qreset-${type}-${resetTs}`, () =>
        notify(
          'questReset',
          `${label}重置前 2 小时 · ${remain} 项进行中未完成`,
          '',
          { type: 'timer', id: `reset:${type === 1 ? 'daily' : type === 2 ? 'weekly' : 'monthly'}` },
        ),
      )
    }
  }
}

// 任务达成。两条通道：
// ① 确认通道：questlist 观测到 state → 3（游戏只在打开任务所时发，天然滞后）；
// ② 推定通道：精确计数引擎的本地计数打满 → 事件发生的瞬间即通知「达成（推定）」。
// 同一任务两通道只响一次（questNotified 去重，交付后清除）。
let questStates: Record<number, number> = {}
const questNotified = new Set<number>()
let qpState: QpState | null = null

const detectQuests = () => {
  // 同批达成到达于同一个 questlist 补丁 → 一次调用天然合并，无需延时窗
  const newlyDone: { id: number; title: string }[] = []
  for (const [idStr, quest] of Object.entries(mg.quests)) {
    const id = parseInt(idStr, 10)
    if (quest.state === 3 && questStates[id] !== undefined && questStates[id] !== 3 && !questNotified.has(id)) {
      questNotified.add(id)
      // quests-scn 已有全量中文任务名（qn.ts:604 注册进 quest 域），这里查一下表就是中文
      newlyDone.push({ id, title: entityNamePlain('quest', id, quest.title) })
    }
    if (quest.state !== 3 && quest.state !== 2) questNotified.delete(id)
  }
  // 交付后任务从列表消失 → 允许下周期再响
  for (const id of [...questNotified]) {
    if (!mg.quests[id]) questNotified.delete(id)
  }
  questStates = Object.fromEntries(Object.entries(mg.quests).map(([k, q]) => [k, q.state]))
  if (!newlyDone.length) return
  notify(
    'quest',
    `任务完成${newlyDone.length > 1 ? ` ×${newlyDone.length}` : ''} · 待领取`,
    newlyDone.slice(0, 3).map((entry) => entry.title).join('、') + (newlyDone.length > 3 ? ` 等 ${newlyDone.length} 项` : ''),
    newlyDone.length === 1
      ? { type: 'quest', id: newlyDone[0].id }
      : { type: 'questBatch', id: newlyDone.map((entry) => entry.id).join(',') },
  )
}

const stockGoalCurrent = (goal: QpStockGoal): number | null => {
  if (goal.kind === 'material') return mg.materials?.[goal.id] ?? null
  if (goal.kind === 'useitem') {
    // 单一出处（shared/useitem-stock）：三处各抄一份 {1:5,2:4,3:6,4:7} 的话，
    // 将来扩 31-34 资源类 useitem 时改漏一处，铃的推定通道就和主进程静默分家
    return USEITEM_MATERIAL_INDEX[goal.id] != null
      ? mg.materials?.[USEITEM_MATERIAL_INDEX[goal.id]] ?? null
      : mg.useitems[goal.id] ?? 0
  }
  const instances = Object.values(mg.slotitems)
  if (goal.kind === 'equip') {
    return instances.filter((item) => item.mstId === goal.id).length
  }
  return instances.filter((item) =>
    goal.ids.includes(mg.master.slotitems[item.mstId]?.type2 ?? -1),
  ).length
}

// 推定通道：本地计数全打满且当前持有条件满足，才视为达成。
const detectQuestComplete = () => {
  if (!qpState) return
  for (const [idStr, tracker] of Object.entries(qpState.trackers)) {
    if (tracker.partial) continue
    if (tracker.stateGoal && tracker.stateGoalReady !== true) continue
    const id = parseInt(idStr, 10)
    const quest = mg.quests[id]
    if (!quest || quest.state !== 2 || questNotified.has(id)) continue
    const counts = qpState.progress[id]
    if (!counts || !tracker.tasks.length) continue
    if (
      tracker.stockGoals?.some((goal) => {
        const current = stockGoalCurrent(goal)
        return current == null || current < goal.count
      })
    ) continue
    const complete = qpTaskGroups(tracker.tasks).every(
      ({ slot, entries }) => (counts[slot] ?? 0) >= ((entries[0].task as any).count || 1),
    )
    if (complete) {
      questNotified.add(id)
      notify('quest', `任务预计完成 · 待领取`, `${entityNamePlain('quest', id, quest.title)}${tracker.approx ? ' · 部分条件为近似计算' : ''}`, {
        type: 'quest',
        id,
      })
    }
  }
}

// 图鉴新登录（仅徽章）：在籍 mstId 集合差分；首轮建基线不响
// 基线本体搬到 ship-first-owned：首见志要的是同一个判定（按谱系、只增不减、
// 首次运行不误报），不该两处各存一份。这里只管拿新到手的名单发通知。
const detectNewShips = () => {
  const fresh = observeOwnedShips()
  if (fresh.length) {
    const names = fresh.map((id) => {
      const original = mg.master.ships[id]?.name ?? `#${id}`
      return entityNamePlain('ship', id, original)
    })
    notify(
      'newShip',
      `新舰入库：${names.slice(0, 3).join('、')}${fresh.length > 3 ? ` 等 ${fresh.length} 艘` : ''}`,
      '请确认已上锁',
      { type: 'mstShip', id: fresh[0] }, // 多舰时落到第一艘
    )
  }
}

// 大破（阻断级）
let taihaSeen = new Set<string>()
// protected 档（只有联合二队旗舰大破）另有一层**出击级**去重，见下面 detectTaiha 里的注释。
let protectedTaihaSeen = new Set<string>()
// 上一次已经喊过的对账更正。键含 startTs，所以「回港那一帧没走到」直接开下一趟
// 也不会把新出击的第一次更正误当成旧的（那时 startTs 已经变了）。
let taihaCorrectionSeen = ''
const detectTaiha = () => {
  const s = mg.sortie
  if (!s || !s.active || s.practice || !s.battle) {
    if (!s?.active) {
      taihaSeen = new Set()
      protectedTaihaSeen = new Set()
      taihaCorrectionSeen = ''
      if (heldQueue.length && !dndActive()) flushHeld() // 归港：送达暂留
    }
    return
  }
  // 权威 HP 对账把「解析说没大破」纠正成「权威说大破」了（铭侧 runSortieHpAudit
  // 把计数推了一格）。这一条是**更正**，不是重复：底下两层去重一律豁免，
  // 措辞也要让人看出来这是对账后的改口，而不是同一件事又说一遍。
  const correctionKey =
    (s.taihaCorrections ?? 0) > 0 ? `${s.startTs}:${s.taihaCorrections}` : ''
  const correcting = correctionKey !== '' && correctionKey !== taihaCorrectionSeen
  if (correcting) taihaCorrectionSeen = correctionKey
  // 已退避的舰不再喊：她被送回港了，「大破后继续前进可能被击沉」说的不是她。
  // 判据用战斗视图自带的 escaped（报文的 api_escape_idx / 血量 -1），与镝同一份。
  const isTaiha = (x: BattleShipView) => isTaihaShip(x)
  const node = s.nodes.find((entry) => entry.cell === s.currentCell)
  const atBoss =
    (s.bossCell > 0 && s.currentCell === s.bossCell) || node?.eventId === 5
  // 同一战里多艘大破只发一条：一战三破弹三次横幅，只会让人急着点掉，
  // 反而看不清到底谁破了。夜战后又新增大破时才再发一条，且内容列出当前全部。
  const taiha = s.battle.fShips.filter(isTaiha)
  if (!taiha.length) return
  // 舰名走本地化（与新舰、应急修理两条同一份来源）。原先这里直接用战斗报文里的
  // 主数据原名，于是应急修理与大破两条横幅同屏时会一条写「铃谷改二」、
  // 一条写「鈴谷改二」——同一艘舰在相邻两行里换了字形，看起来就像出了错。
  const names = taiha.map((ship) => entityNamePlain('ship', ship.mstId, ship.name))
  // 该喊撤退、还是该说「没有进击选项」/「她不会被击沉」——判据与出处见
  // shared/taiha-verdict，与镝的警告条同一份，别在这儿另算一遍。
  const verdict = taihaVerdictOf(
    taiha.map((ship, at) => ({ index: ship.index, name: names[at] })),
    s.battle.fShips.some((ship) => ship.fleet === 'escort'),
    flagshipHasDameconIn(s.battle.fShips, mg),
  )
  if (!verdict) return
  // protected 档**整趟出击只说一次**：她受系统保护不会被击沉，这个事实不随战斗变化，
  // 而下面的 taihaSeen 只按单场去重，于是她留在大破名单里的每一场都会再弹一遍同样的话。
  //
  // 只有这一档进这道闸：danger 每场都有真实的进击/撤退决策要做，每场提醒是功能不是噪音；
  // forced 本来就随强制返航一次性。某场从 protected 升级成 danger（又有别的舰大破了）时
  // 走的是 danger 那一支，不看这个集合，照发。
  //
  // 键含出击标识 startTs（账本侧 ledger.ts 也拿它当出击键）：回港时随上面的 !active
  // 一并清空，与 taihaSeen 同一族；万一没经过 active=false 的那一帧（直接开下一趟），
  // startTs 也变了，新出击照样重新可发。
  //
  // 闸在 atBoss 分档之前，所以 Boss 那一场也一并收进来：她在道中已经报过一次，
  // 到了 Boss 还是同一件事（大破、不会沉），换个措辞再说一遍仍是重复。
  // 「整趟出击只说一次」就是用户要的那一次。
  if (verdict.tier === 'protected') {
    // 这一档按定义只有二队旗舰一艘（taiha-verdict：danger 为空才落到 protected）。
    const her = taiha.find((ship) => ship.index === ESCORT_FLAGSHIP_INDEX) ?? taiha[0]
    const key = `${s.startTs}:${her.rosterId ?? her.index}`
    if (protectedTaihaSeen.has(key) && !correcting) return
    protectedTaihaSeen.add(key)
  }
  const signature = `${s.battleCount}:${taiha
    .map((ship) => ship.rosterId ?? ship.index)
    .sort((a, b) => a - b)
    .join(',')}`
  if (taihaSeen.has(signature) && !correcting) return
  taihaSeen.add(signature)

  const lead = taiha[0]
  // 大破跳镝（战斗详情）而非舰娘图鉴——当下要看的是这一战的局面，不是这艘舰的资料
  const ref: EntityRef | undefined =
    lead.rosterId != null ? { type: 'battleCurrent', id: lead.rosterId } : undefined
  const nameList = (list: readonly string[]) =>
    list.length === 1 ? list[0] : `${list[0]} 等 ${list.length} 舰`
  const who = nameList(names)
  // Boss 后没有进击选择，一切降为战损陈述——这一档的措辞与路由都维持原样。
  const [title, tail] = atBoss
    ? [`${who}在 Boss 战中大破`, names.length > 1 ? ` · ${names.join('、')}` : '']
    : verdict.tier === 'forced'
      ? [
          verdict.others.length
            ? `旗舰${verdict.flagship}、${verdict.others.join('、')} 大破 — 本战结束后将强制返航`
            : `旗舰${verdict.flagship}大破 — 本战结束后将强制返航`,
          ' · 没有进击选项',
        ]
      : verdict.tier === 'protected'
        ? [`二队旗舰${verdict.escortFlagship}大破`, ' · 她不会被击沉，可以继续进击']
        : [
            `${nameList(verdict.names)}大破 — 请撤退！`,
            verdict.names.length > 1 ? ` · ${verdict.names.join('、')}` : '',
          ]
  notify(
    'taiha',
    title,
    // 标题按三档照旧；「修正：」只加在正文头上，让人知道这是对账后的改口。
    `${correcting ? '修正：' : ''}${s.mapArea}-${s.mapNo} ${atBoss ? 'Boss 战' : `第 ${s.battleCount} 战`}${tail}`,
    ref,
    atBoss ? { banner: false, priority: 'normal' } : undefined,
  )
}

// 应急修理（要員 42 / 女神 43）
//
// **有没有字段**：有——`BattleShipView.repairItemUsed`（42/43，两个 id 已对 2026-08-20
// 的 api_start2 主数据核实：42 応急修理要員、43 応急修理女神）。但它不是游戏自报的：
// 战斗报文里没有任何一个字段说「这一发被损管挡了」，是铭的战斗回放
// （main/mg/battle.ts useRepairItem）按「这一击会把她打到 0 且她身上带着 42/43」
// 结算出来的，并据此把 hpEnd 拉回去。所以横幅报的与全局血条报的是同一份推演，
// 不是另开一套猜测；下面的措辞只陈述这份推演已经写进状态的事实（发动了、现在多少血），
// 不去替游戏宣布任何我们没算的东西。
//
// 机制依据（wikiwiki「応急修理要員」条目原文，2026-08-20 由主会话核实）：
// - 発動条件：大破状态下进击，在下一点受到超过剩余耐久的伤害时发动；
// - 「ダメコン発動して復帰した艦娘は大破状態のままだが、その戦闘中
//   （航空戦→夜戦(追撃)の一連動作まで）でなら再度轟沈することは無い」
//   ⇒ 本场战斗（含夜战）安全，风险在「继续进击」；
// - 「1艦娘が1戦闘中に複数消費することは無い」；
// - 恢复量：战斗中归零发动一律回两成（KC3Kai/kancolle-replay 两实现一致，
//   已查证 battle.ts 现状正确）；wiki 的「旗舰回约 50%」说的是旗舰大破进击时
//   **开战前**消耗的那一枚（已体现在 hpStart 里），不归战斗结算层，别照它「修」。
//   下面的破损档**从我们实际算出的 hpEnd 读**，不照抄规则文本。
//
// **即时派发**：报文一到就报，不等 battleresult、不等游戏把动画放完。
// 本工作台的哲学是全程先知，不做防剧透——「比屏幕上的动画早一两分钟知道」
// 正是它存在的理由。
let dameconSeen = new Set<string>()
const detectDamecon = () => {
  const s = mg.sortie
  if (!s || !s.active || s.practice || !s.battle) {
    if (!s?.active) dameconSeen = new Set()
    return
  }
  for (const ship of s.battle.fShips) {
    if (ship.repairItemUsed == null) continue
    // 同一舰同一战只报一次：昼战解析 + 夜战合并会让同一条 repairItemUsed 被看到两遍。
    const signature = `${s.battleCount}:${ship.rosterId ?? ship.index}:${ship.repairItemUsed}`
    if (dameconSeen.has(signature)) continue
    dameconSeen.add(signature)
    notify(...dameconNotice(ship, s.battleCount, `${s.mapArea}-${s.mapNo}`))
  }
}

/** 文案单独拆出来：模拟入口与真实探测必须一字不差地共用同一份措辞。 */
const dameconNotice = (
  ship: BattleShipView,
  battleNo: number,
  mapLabel: string,
): [string, string, string, EntityRef | undefined, NotifyPresentation] => {
  const goddess = ship.repairItemUsed === 43
  const itemName = entityNamePlain(
    'equip',
    ship.repairItemUsed ?? 0,
    mg.master.slotitems[ship.repairItemUsed ?? 0]?.name ?? '应急修理',
  )
  const shipName = entityNamePlain('ship', ship.mstId, ship.name)
  const tier = damageTierOf(ship.hpEnd, ship.hpMax)
  const tierWord = tier ? DAMAGE_TIER_WORDS.ship[tier] : '完好'
  // 「本场安全、进击危险」是这条通知唯一要传达的行动含义。女神回满血，
  // 继续进击的风险与常规无异；要員回两成通常仍是大破，再进击就是裸奔。
  const advice = goddess
    ? '本场不会再被击沉 · 女神已消耗'
    : `本场不会再被击沉 · 已消耗${tier === 'heavy' ? '，她仍是大破' : ''}`
  return [
    'damecon',
    `${shipName} ${itemName}发动`,
    `${mapLabel} 第 ${battleNo} 战 · 耐久 ${ship.hpEnd}/${ship.hpMax}（${tierWord}）· ${advice}`,
    ship.rosterId != null ? { type: 'battleCurrent', id: ship.rosterId } : undefined,
    { bannerTone: goddess ? 'goddess' : 'repair', icon: goddess ? '神' : '修' },
  ]
}

// 击沉。判据与失色/碎裂视觉同源——都读内核的 sortieSunkShips()，
// 那是从 sortie 状态推导的名单，不是这里发一次通知就算数。
let sunkSeen = new Set<number>()
const detectSunk = () => {
  const sunk = sortieSunkShips()
  if (!sunk.length) {
    sunkSeen = new Set()
    return
  }
  for (const entry of sunk) {
    if (sunkSeen.has(entry.rosterId)) continue
    sunkSeen.add(entry.rosterId)
    const name = entityNamePlain('ship', entry.mstId, entry.name)
    const s = mg.sortie
    const where = s && !s.practice ? `${s.mapArea}-${s.mapNo} 第 ${entry.battleNo} 战` : `第 ${entry.battleNo} 战`
    notify(
      'shipSunk',
      `${name} Lv${entry.lv} 被击沉`,
      where,
      { type: 'mstShip', id: entry.mstId },
    )
  }
}

// ケッコンカッコカリ（婚舰）。
//
// 判据是**报文到达**这一件事本身，不是任何一个响应字段：这条 path 在本机账本里
// 零样本（这台机器上的婚舰都早于艦素），响应形状没经过本地实证，深挖它等于拿猜的
// 当依据。舰的后续状态（Lv100、耐久上抬）由随后的 ship/port 报文自然到账。
//
// 认不出是哪一艘时**照常庆祝，只是不指名**——粉光与花瓣是「镇守府今天办喜事」，
// 那件事无论如何都成立；指名却指错才是真的错。
const marriageNotice = (
  cue: MarriageCue,
): [string, string, string, EntityRef | undefined] => {
  const rosterId = cue.rosterId != null && cue.rosterId > 0 ? cue.rosterId : null
  // 形态优先取当刻在籍表（cue 里那份是婚前快照，两者只在极端时序下不同）
  const mstId = (rosterId != null ? mg.ships[rosterId]?.shipId : 0) || cue.mstId || 0
  const name = mstId > 0 ? entityNamePlain('ship', mstId, mg.master.ships[mstId]?.name ?? `#${mstId}`) : ''
  if (!name) {
    return [
      'marriage',
      'ケッコンカッコカリ',
      '没能确认是哪一艘',
      undefined,
    ]
  }
  return [
    'marriage',
    `ケッコンカッコカリ：${name}`,
    `${cue.level != null ? `Lv ${cue.level} 时` : ''}结为誓约`,
    rosterId != null ? { type: 'ship', id: rosterId } : undefined,
  ]
}

const detectMarriage = (cue: MarriageCue) => {
  notify(...marriageNotice(cue), { bannerTone: 'wedding' })
  // 花瓣与横幅/外框同一个总闸（startWeddingPetals 自己把住 eventBannerEffectsEnabled），
  // 但退场方式有意不同：横幅与粉光留到手动关，花瓣是一次仪式，到时自己散。
  startWeddingPetals()
}

// ---- 通知中心面板 ----

let pane: HTMLElement | null = null
const collapsed = new Set<string>() // 折叠的日期组（默认除「今天」外全折）
let collapseInit = false
// 展开的合并堆（key = 日期组 + 事件类型）。合并只发生在**显示层**：
// 已读状态仍然一条一条算，所以第 10 条进来不会把前 9 条的已读抹掉。
const expandedStacks = new Set<string>()
/** 少于这个数不合并——两三条挤在一起本来就看得清，合了反而多一次点击 */
const STACK_MIN = 3

const fmtTm = (ts: number) => {
  const d = new Date(ts)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 一条通知行。inStack = 它属于一个已展开的同类堆，缩进以示从属。
 *
 * 已读状态一条一条算，跟堆叠无关——堆只是显示层的收纳，
 * 新来一条不会把同类里已经读过的那些重新标成未读。
 */
const noticeRowHtml = (n: Notice, inStack: boolean): string => {
  const def = EVENTS.find((e) => e.id === n.event)
  const prev = n.session !== SESSION
  return `<div class="nrow${n.read ? ' read' : ''}${prev ? ' prev' : ''}${inStack ? ' in-stack' : ''}" data-nid="${n.key}"${
    prev ? ' title="上次开机时的记录"' : ''
  }>
    ${n.read ? '' : '<span class="unread"></span>'}
    <span class="sev" style="background:${SEV_COLOR[def?.sev ?? 'blue']}"></span>
    <span class="ic" style="color:${SEV_COLOR[def?.sev ?? 'blue']}">${def?.icon ?? '·'}</span>
    <span class="tx"><b>${esc(n.title)}</b><span>${esc(n.detail)}</span>
      <span class="jump">→ ${esc(def ? jumpLabelOf(def, n.ref) : '面板')}</span>${
        // 推送失败就在这条记录上说一句，而不是再发一条通知（那会自激）
        n.pushError ? `<span class="pusherr" title="${esc(n.pushError)}">推送失败</span>` : ''
      }</span>
    <span class="tm">${fmtTm(n.ts)}</span>
  </div>`
}


const dayLabel = (ts: number): string => {
  const d = new Date(ts)
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= midnight) return '今天'
  if (ts >= midnight - 86400000) return '昨天'
  return `${d.getMonth() + 1}-${d.getDate()}`
}

const SEV_COLOR: Record<Severity, string> = {
  crit: 'var(--bad)',
  gold: 'var(--gold)',
  blue: 'var(--dock)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
}

// 矩阵条件列：静态说明 + 就地控件（远征提前 1 分 / 资源阈值输入）
const condCellHtml = (def: EventDef): string => {
  if (def.id === 'expedition') {
    return `提前 1 分钟 <span class="lk" data-extra="expeditionEarly">${extras.expeditionEarly ? '✓ 开' : '关'}</span>`
  }
  if (def.id === 'resource') {
    return `桶 ≥<input class="thres" data-extra-num="bucketHigh" value="${extras.bucketHigh}"> · 螺丝 <<input class="thres" data-extra-num="screwLow" value="${extras.screwLow}"> · 每日各 1 次`
  }
  return esc(def.note)
}

// 从别处（timer 实体的「为它设提醒」）跳进来时，高亮对应规则行
let highlightEvent: string | null = null

/** 打开通知规则并定位到某个事件行 */
export const openNotifyRule = (eventId: string) => {
  if (!EVENTS.some((e) => e.id === eventId)) return
  highlightEvent = eventId
  activateModule('lg')
  render()
  pane?.querySelector(`[data-evrow="${eventId}"]`)?.scrollIntoView({ block: 'center' })
  setTimeout(() => {
    highlightEvent = null
    if (pane?.classList.contains('active')) render()
  }, 2600)
}

const render = () => {
  if (!pane) return
  const root = pane
  const unread = unreadCount()
  const groups: { label: string; items: Notice[] }[] = []
  for (const notice of log) {
    const label = dayLabel(notice.ts)
    const group = groups[groups.length - 1]
    if (group?.label === label) group.items.push(notice)
    else groups.push({ label, items: [notice] })
  }
  if (!collapseInit && groups.length) {
    groups.forEach((g) => {
      if (g.label !== '今天') collapsed.add(g.label)
    })
    collapseInit = true
  }
  const listHtml = groups
    .map((g) => {
      const isCollapsed = collapsed.has(g.label)
      const head = `<div class="c-grp" data-grp="${esc(g.label)}">${esc(g.label)} · ${g.items.length} 条 ${isCollapsed ? '▾' : '▴'}</div>`
      if (isCollapsed) return head
      // 同类堆叠：一天里「任务待领取」能占一半，堆成一条后重要的才不被淹。
      // 堆的位置按该类最新一条的时间算，时间线仍然有序。
      const byEvent = new Map<string, typeof g.items>()
      for (const notice of g.items) {
        const list = byEvent.get(notice.event)
        if (list) list.push(notice)
        else byEvent.set(notice.event, [notice])
      }
      const rendered: { ts: number; html: string }[] = []
      for (const [event, list] of byEvent) {
        if (list.length < STACK_MIN) continue
        const def = EVENTS.find((e) => e.id === event)
        const stackKey = `${g.label}::${event}`
        const open = expandedStacks.has(stackKey)
        const unread = list.filter((notice) => !notice.read).length
        rendered.push({
          ts: list[0].ts,
          html: `<div class="nrow stack${unread ? '' : ' read'}" data-stack="${esc(stackKey)}">
            ${unread ? '<span class="unread"></span>' : ''}
            <span class="sev" style="background:${SEV_COLOR[def?.sev ?? 'blue']}"></span>
            <span class="ic" style="color:${SEV_COLOR[def?.sev ?? 'blue']}">${def?.icon ?? '·'}</span>
            <span class="tx"><b>${list.length} 项${esc(def?.label ?? event)}</b><span>${
              unread ? `其中 ${unread} 条未读 · ` : ''
            }最新：${esc(list[0].detail || list[0].title)}</span>
              <span class="jump">${open ? '收起 ▴' : '展开 ▾'}</span></span>
            <span class="tm">${fmtTm(list[0].ts)}</span>
          </div>`,
        })
      }
      const stacked = new Set(
        [...byEvent.entries()].filter(([, list]) => list.length >= STACK_MIN).map(([event]) => event),
      )
      const loose = g.items.filter(
        (notice) => !stacked.has(notice.event) || expandedStacks.has(`${g.label}::${notice.event}`),
      )
      return (
        head +
        [
          ...rendered,
          ...loose.map((n) => ({ ts: n.ts, html: noticeRowHtml(n, stacked.has(n.event)) })),
        ]
          .sort((a, b) => b.ts - a.ts)
          .map((entry) => entry.html)
          .join('')
      )
    })
    .join('')

  const matrix = EVENTS.map((def) => {
    const route = rules[def.id]
    const dot = (key: RouteKey) => {
      // 强制提醒（大破）锁死的只是**本机**那四路。推送要出网，不该被任何
      // 强制条款自动打开，所以这一格照常可点、默认关。
      if (def.locked && key !== 'push') return '<span class="dot lock"></span>'
      if (def.na?.includes(key)) return '<span class="dot na"></span>'
      return `<span class="dot${route[key] ? ' on' : ''}" data-ev="${def.id}" data-route="${key}"></span>`
    }
    return `<tr class="ev-row${highlightEvent === def.id ? ' hl' : ''}" data-evrow="${def.id}">
      <td class="ev"><span class="sv" style="background:${SEV_COLOR[def.sev]}"></span>${esc(def.label)}${def.locked ? '<i>强制提醒 · 不可关闭</i>' : ''}</td>
      <td>${dot('badge')}</td><td>${dot('toast')}</td><td>${dot('system')}</td><td>${dot('sound')}</td><td>${dot('push')}</td>
      <td class="cond">${condCellHtml(def)}</td>
    </tr>`
  }).join('')

  const dnd = dndActive()
  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  commitPaneHtml(root, 'lg', `<div class="lg-app${root.clientWidth < 700 ? ' narrow' : ''}">
    <aside class="center">
      <div class="c-head">
        <span class="bell">🔔${unread ? `<span class="n">${unread}</span>` : ''}</span><b>通知中心</b>
        <span class="sp"></span>
        <span class="dnd${dnd ? ' on' : ''}" data-act="dnd" title="出击期间自动开启"><span class="sw"></span>勿扰${
          dnd ? (extras.manualDnd ? '（手动）' : '（出击中）') : ''
        }${heldQueue.length ? ` 暂留 ${heldQueue.length}` : ''}</span>
        <span class="lk" data-act="readall">全部已读</span>
      </div>
      <div class="c-list">${listHtml || '<div style="padding:30px 16px;color:var(--dim);font-size:12px;line-height:1.8">还没有通知</div>'}</div>
      <div class="c-foot"><span class="lk" data-act="clear" title="删除账本里的全部通知历史，不影响规则与阈值">清空历史</span><span class="lk" data-act="test">▶ 测试通知</span></div>
    </aside>
    <div class="right">
      <div class="rcard" style="--hc:var(--gold)">
        <div class="h"><b>通知规则</b><span class="aux">事件 × 通知方式</span></div>
        <div class="g-row">
          <span class="g-pill">前台 Toast · 后台系统通知</span>
          <span class="g-pill">出击自动勿扰 + 手动</span>
          <span class="g-pill">声音两档</span>
          <span class="g-pill">推送 → 手机（ntfy / Bark）<b style="color:${
            pushEnabledHint ? 'var(--ok)' : 'var(--dim)'
          }">${pushEnabledHint ? '已启用' : '总开关未开'}</b>${
            // 攒着几条要说出来：不然「手机怎么没响」只能靠猜
            heldPushQueue.length ? ` · 待补 ${heldPushQueue.length}` : ''
          }</span>
        </div>
        <table class="rules">
          <thead><tr><th>事件</th><th>面板徽章</th><th>Toast</th><th>系统通知</th><th>声音</th><th>手机推送</th><th style="text-align:left">条件 / 频控</th></tr></thead>
          <tbody>${matrix}</tbody>
        </table>
        <div class="rules-note">手机推送另有一道总开关（设置）</div>
      </div>
    </div>
  </div>`)
}

const renderIfActive = () => {
  if (pane?.classList.contains('active')) render()
  else updateBadge()
}

// ---- 模块 ----

registerModule({
  id: 'lg',
  title: '通知',
  order: 8.5,
  mount(el) {
    pane = el
    new ResizeObserver(() => {
      const app = pane?.querySelector('.lg-app')
      if (app && pane) app.classList.toggle('narrow', pane.clientWidth < 700)
    }).observe(el)
    el.addEventListener('change', (e) => {
      const input = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-extra-num]')
      if (!input) return
      const key = input.dataset.extraNum as 'bucketHigh' | 'screwLow'
      const value = parseInt(input.value, 10)
      if (!Number.isNaN(value) && value >= 0) {
        extras[key] = value
        saveExtras()
      }
      render()
    })
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('input')) return
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'readall') {
        log.forEach((n) => (n.read = true))
        void markNoticesRead('all')
        updateBadge()
        render()
        return
      }
      if (act === 'clear') {
        if (!confirm('删除全部通知历史？\n（通知规则、阈值与勿扰设置都会保留）')) return
        log = []
        void clearNotices()
        updateBadge()
        render()
        return
      }
      if (act === 'dnd') {
        toggleManualDnd()
        render()
        return
      }
      if (act === 'test') {
        notify('newShip', '测试 · 新舰入库：矶风', '请确认已上锁 · 金色横幅需手动关闭')
        setTimeout(() => notify('expedition', '测试 · 远征返港', '普通提醒示例（按当前通知规则发送）'), 450)
        setTimeout(() => notify('taiha', '测试 · 大破警告', '红色横幅需手动关闭'), 900)
        return
      }
      const extraToggle = t.closest<HTMLElement>('[data-extra]')
      if (extraToggle) {
        const key = extraToggle.dataset.extra as 'expeditionEarly'
        extras[key] = !extras[key]
        saveExtras()
        render()
        return
      }
      const stack = t.closest<HTMLElement>('[data-stack]')
      if (stack) {
        const key = stack.dataset.stack!
        if (expandedStacks.has(key)) expandedStacks.delete(key)
        else expandedStacks.add(key)
        render()
        return
      }
      const grp = t.closest<HTMLElement>('[data-grp]')
      if (grp) {
        const label = grp.dataset.grp!
        if (collapsed.has(label)) collapsed.delete(label)
        else collapsed.add(label)
        render()
        return
      }
      const dot = t.closest<HTMLElement>('.dot[data-ev]')
      if (dot) {
        const ev = dot.dataset.ev!
        const route = dot.dataset.route as RouteKey
        rules[ev][route] = !rules[ev][route]
        saveRules()
        render()
        return
      }
      const row = t.closest<HTMLElement>('[data-nid]')
      if (row) {
        const notice = log.find((n) => n.key === row.dataset.nid)
        if (notice) {
          markRead([notice])
          updateBadge()
          const def = EVENTS.find((x) => x.id === notice.event)
          if (def) goToNotice(def, notice.ref)
        }
      }
    })
    onMgChange((keys) => {
      if (keys.includes('quests')) detectQuests()
      if (keys.includes('sortie')) {
        // 次序即记录次序：应急修理在前（它是「刚才差点沉了」），大破在后。
        // 横幅的**堆叠**次序不靠这里，由 BANNER_ORDER 的 flex order 保证。
        detectDamecon()
        detectSunk()
        detectTaiha() // 归港时它顺带送达暂留队列
        // 出击自动勿扰随 sortie 起停：不同步的话托盘勾选停在「勿扰关」，
        // 而通知实际都在暂留——恰是 syncTrayDnd 注释里说要避免的不诚实。
        syncTrayDnd()
        if (pane?.classList.contains('active')) render()
      }
      if (keys.includes('ships')) {
        // 战斗中的 HP 回写也会产生 ships 补丁，但那不是新的 cond 观测点。
        // 只有回港时点前进才允许用“相同 cond”重锚；真实 cond 变化仍会由普通观察捕获。
        const portTs = mg.lastPortTs ?? 0
        const confirmed = portTs > 0 && portTs !== lastCondSnapshotTs
        if (confirmed) lastCondSnapshotTs = portTs
        trackCond(confirmed)
        detectNewShips()
      }
      if (keys.some((k) => ['decks', 'ndocks', 'kdocks', 'practice'].includes(k)) && pane?.classList.contains('active')) render()
    })
    onTick(tickDetect)
    // 离场补发的节拍。单开一个监听而不是塞进 tickDetect：那一个开头就
    // `if (!mg.master.ready) return`，而补发跟主数据到没到毫无关系。
    onTick(pollPushPresence)
    onPowerupResult(showPowerupResultToast)
    onMarriage(detectMarriage)
    // 精确计数打满 → 达成推定（事件瞬间即通知，不等 questlist）。
    // 订阅必须在 mount 的同步段登记：内核的装配作用域只圈 mod.mount 那一跳，
    // 从前写在 queryQp().then 里，等回调跑起来 currentMountScope 早已置空，
    // trackForMountScope 直接把退订丢掉——重试装配就双注册、一次达成响两声。
    // detectQuestComplete 自己有 `if (!qpState) return`，早注册也不会误判。
    onQpChange(detectQuestComplete)
    void queryQp().then((s) => {
      qpState = s
    })
    questStates = Object.fromEntries(Object.entries(mg.quests).map(([k, q]) => [k, q.state]))
    lastCondSnapshotTs = mg.lastPortTs ?? 0
    trackCond(lastCondSnapshotTs > 0)
    detectNewShips() // 建基线（首轮静默）
    void restoreLog() // 账本里的历史（只回看、不重放）
    onTrayToggleDnd(toggleManualDnd)
    syncTrayDnd()
    render()
    updateBadge()
  },
  onShow: () => render(),
})
