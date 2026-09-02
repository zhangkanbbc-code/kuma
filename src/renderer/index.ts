// 镇（渲染层壳）：游戏区 + 工作区（铆装配的模块面板）。
// webview 参数与 UA 清洗移植自 poi views/kan-game-wrapper.tsx
// (https://github.com/poooi/poi, MIT License, Copyright (c) poi contributors)。
import { installCrashBadge, installCrashNet, recordCrash } from './crash-guard'
import { noteLearnedShipArt, noteShipCostumes, setGameHost } from './kcs-image'
import type { ShipArtPathEntry } from '../shared/ship-art-path'
import { loadVoiceArchive, noteVoiceArchived } from './voice-archive'
import { loadVoiceAbsent } from './voice-probe'
import type { VoiceArchiveEntry } from '../shared/voice-archive-plan'
import { loadArtArchive, noteArtArchived } from './art-archive'
import type { ArtArchiveEntry } from '../shared/art-archive-plan'
import { ensureBgmArchive, noteBgmArchived } from './bgm-archive'
import type { BgmArchiveEntry } from '../shared/bgm-archive-plan'
import { setVoiceHost } from './kcs-voice'
import { installEquipIconFallback } from './equip-icon'
import { installEntityArtFallback } from './entity-art'
import {
  getGameScaleMode,
  getGameScaleStep,
  noteGameScaleLive,
  setGameScaleApplier,
} from './game-scale'
import { GAME_WIDTH, computeGameLayout } from '../shared/game-scale'
import { getUiZoom, initKernel, initUiZoom, mg, onUiZoom, openBrowseWindow, setUiZoom } from './kernel'
import { initBgmPreview } from './bgm-preview'
import { initPreviewBar } from './preview-bar'
import { initLink } from './link'
import { initCommandPalette } from './command-palette'
import { initLocalization } from './localization'
import { initModules, isModuleShowing, launchGlowLayout, setLayoutDragHooks, toggleFocus } from './mu'
import {
  armLaunchGlow,
  armLaunchWelcome,
  setOverlayEntranceEnabled,
  type LaunchGlowHandle,
  type LaunchStage,
  type LaunchWelcomeHandle,
} from './launch-glow'
import {
  LAUNCH_BADGE_TIMING,
  LAUNCH_BATTLE_TIMING,
  LAUNCH_BRIEF_TIMING,
  LAUNCH_DISPATCH_TIMING,
  LAUNCH_GLOW_CONFIG_KEY,
  LAUNCH_GLOW_DEFAULT,
  LAUNCH_ORDER_TIMING,
  LAUNCH_ROSTER_TIMING,
  LAUNCH_STAGE_ITEM_CAP,
  LAUNCH_TOME_TIMING,
  LAUNCH_ZI_TIMING,
  digitCountOf,
  launchDigitsPlan,
  rippleOrder,
} from '../shared/launch-glow'
import { GAME_URL_CONFIG_KEY, normalizeGameUrl } from '../shared/game-url'
import { cleanUserAgent } from '../shared/user-agent'
import { initHeaderStatus } from './header-status'
import { initVoiceSubtitles } from './voice-subtitle'
// 模块导入即注册（Tab 顺序由各自 order 决定）
import './modules/ru'
import './modules/zi'
import './modules/ji'
import './modules/qn'
import './modules/di'
import './modules/shi'
import './modules/du'
import './modules/bi'
import './modules/lg'
import './modules/yu'
import './modules/mgstate'
import './modules/anchor'

const remote = require('@electron/remote')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const broadcaster = remote.require('./game-api-broadcaster')
const config = remote.require('./config')
initVoiceSubtitles(broadcaster)

const APP_ROOT: string = remote.getGlobal('ROOT')
const SCREENSHOT_PATH: string = remote.getGlobal('DEFAULT_SCREENSHOT_PATH')

installEquipIconFallback()
installEntityArtFallback()

const PRELOAD_URL = pathToFileURL(
  path.join(APP_ROOT, 'assets', 'preload', 'webview-preload.js'),
).href

// UA 清洗：去掉 Electron 与应用名那两段（poi 同款手法）。判据在 shared/user-agent，
// 浏览窗引的是同一个——这里原先自己写了一份找 `kanso/` 的正则，改名之后一直空转。
const USER_AGENT = cleanUserAgent(navigator.userAgent)

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`missing element: ${selector}`)
  return el
}

// ---- 游戏 webview ----
type WebviewTag = Electron.WebviewTag

const gameWrapper = $('#game-wrapper')
const gameArea = $('#game-area')
let webview: WebviewTag | null = null
let webviewReady = false

const applyZoom = () => {
  if (!webview || !webviewReady) return
  const { width } = gameWrapper.getBoundingClientRect()
  if (width <= 0) return
  // 乘 UI 缩放：rect 是渲染层 CSS px，webview 的实际物理尺寸还要再乘一次页面缩放。
  // 锁定档也走这一路、不从档位另给一个数：量什么就配什么倍率，画面还没摆到位或分隔条
  // 正拖着时也不会出现「盒子一个大小、内容另一个」。反推丢不丢精度实测过（2026-08-30，
  // 真实例 + CDP）：锁定 100% 量出 1043.478271484375px，factor 与 getZoomFactor() 都是整 1。
  const factor = Math.round(((width * getUiZoom()) / GAME_WIDTH) * 100000) / 100000
  try {
    webview.setZoomFactor(factor)
    webview.executeJavaScript('window.align && window.align()').catch(() => {})
  } catch (_e) {
    /* webview not attached yet */
  }
}

// setZoomFactor 是跨进程同步调用，连续 resize 时每帧都打非常卡——120ms 防抖
let zoomTimer: ReturnType<typeof setTimeout> | null = null
const applyZoomDebounced = () => {
  if (zoomTimer) clearTimeout(zoomTimer)
  zoomTimer = setTimeout(applyZoom, 120)
}

// 按当前设置算这一屏该多大。界面缩放要带上：锁定档说的是「游戏的 1200 逻辑像素占
// 1200 个屏上 CSS 像素」，而 wrapper 的宽是渲染层坐标，两者差的正是一层页面缩放。
// 可用区取 rect 的小数值——clientWidth 会取整，「刚好装得下」会被判成装不下、白掉一档。
const gameLayoutNow = () => {
  const area = gameArea.getBoundingClientRect()
  return computeGameLayout({
    areaWidth: area.width,
    areaHeight: area.height,
    mode: getGameScaleMode(),
    lockStep: getGameScaleStep(),
    uiZoom: getUiZoom(),
  })
}

// 拖分隔条期间不许写 wrapper 的宽：那正是下面 dragHooks 冻起来的东西，
// 每帧改一次宽就是每帧让游戏进程重排一次，冻结缩放白做。
let dragging = false

/**
 * 摆一次游戏区。锁定档写死 wrapper 的宽（高由 aspect-ratio 跟上，居中与黑边由
 * #game-area 的 flex 与黑底自然成立）；自适应把宽度交还给样式表那条 min(100cqw, …)，
 * 一个字都不改——老玩家零感知。
 */
const applyGameLayout = (immediate = false) => {
  if (dragging) return
  const layout = gameLayoutNow()
  gameWrapper.style.width = layout.locked ? `${layout.width}px` : ''
  // 语音字幕画在界面层，游戏画面缩放它本来不跟。把量到的倍率挂成 wrapper 上的一个
  // 自定义属性，字号那道乘法交给样式表（见 index.html 的 --voice-caption-px）。
  // **挂 wrapper 不挂根元素**：自定义属性一改，那棵子树的样式就要重算一遍，而
  // 拖窗口时这一句每帧都会走到——wrapper 底下只有 webview 与两块字幕层。
  // 拖分隔条期间不写（函数开头就返回了）也不缺：那会儿 wrapper 整个挂着
  // transform: scale()，字幕跟着一起缩，松手时这里再补一次真值。
  gameWrapper.style.setProperty('--game-scale', `${layout.scale}`)
  noteGameScaleLive(layout.scale)
  if (immediate) applyZoom()
  else applyZoomDebounced()
}

const overlay = $('#game-overlay')
const overlayTitle = $('#overlay-title')
const overlayDetail = $('#overlay-detail')

const showLoadError = (code: number, description: string, url: string) => {
  overlayTitle.textContent = '游戏页面加载失败'
  overlayDetail.textContent =
    `${description} (${code})\n${url}\n\n` +
    `代理配置：设置 · 代理 · 配置后重试`
  overlayDetail.style.whiteSpace = 'pre-wrap'
  overlay.classList.add('visible')
}

const hideLoadError = () => {
  overlay.classList.remove('visible')
}

const createGameView = () => {
  webviewReady = false
  const view = document.createElement('webview') as WebviewTag
  // 参数组合的讲究（原版注释）：contextIsolation 让页面主世界回归标准
  // web 安全，会挡掉缓存资源换入与跨源 iframe 遍历（截图），所以配
  // disablewebsecurity 维持旧行为；隔离世界仍把 Node/remote 挡在游戏页之外。
  view.setAttribute('allowpopups', '')
  view.setAttribute('nodeintegrationinsubframes', '')
  view.setAttribute('disablewebsecurity', '')
  view.setAttribute(
    'webpreferences',
    'allowRunningInsecureContent=no, backgroundThrottling=no, contextIsolation=yes, sandbox=no, nodeIntegrationInSubFrames=yes',
  )
  view.setAttribute('preload', PRELOAD_URL)
  view.setAttribute('useragent', USER_AGENT)
  // 网址是玩家可配的（钥 · 游戏页面网址）。**必须过一遍判据**：配置里那条写坏了
  // 就回落到默认，否则一次手滑就是整块游戏区白着，而且在设置里改回来也救不了——
  // 那时候他已经看不出白屏是自己粘错了一行造成的。
  view.src = normalizeGameUrl(config.get(GAME_URL_CONFIG_KEY))

  view.addEventListener('dom-ready', () => {
    webviewReady = true
    hideLoadError()
    applyZoom()
  })
  view.addEventListener('did-fail-load', (e) => {
    // -3 = ERR_ABORTED（正常跳转打断），忽略
    if (e.isMainFrame && e.errorCode !== -3) {
      showLoadError(e.errorCode, e.errorDescription, e.validatedURL)
    }
  })
  // 渲染进程崩溃 → 原地重挂（poi 同款自愈）
  view.addEventListener('render-process-gone' as any, () => {
    console.warn('[kanso] game webview crashed, remounting')
    view.remove()
    webview = createGameView()
  })
  gameWrapper.appendChild(view)
  return view
}

$('#btn-retry').addEventListener('click', () => {
  hideLoadError()
  webview?.reload()
})

webview = createGameView()
new ResizeObserver(() => applyZoomDebounced()).observe(gameWrapper)
// 可用区变了要重算档位（锁定档可能从装得下变成装不下）。观察的是 #game-area 而不是
// wrapper：wrapper 的宽正是这里写进去的，盯着它改它就是自己追自己。
new ResizeObserver(() => applyGameLayout()).observe(gameArea)

// ---- 头部按钮 ----
$('#btn-reload').addEventListener('click', () => {
  webview?.reload()
})
// 浏览窗：按一次开一扇新的，各开各的、各关各的
$('#btn-browse').addEventListener('click', () => {
  void openBrowseWindow()
})
$('#btn-capture').addEventListener('click', async () => {
  if (!webview) return
  try {
    const dataUrl: string | undefined = await webview.executeJavaScript('window.capture()')
    if (!dataUrl) {
      console.warn('[kanso] capture returned nothing (game canvas not found?)')
      return
    }
    fs.mkdirSync(SCREENSHOT_PATH, { recursive: true })
    const file = path.join(SCREENSHOT_PATH, `kanso-${Date.now()}.png`)
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('[kanso] screenshot saved:', file)
  } catch (e) {
    console.error('[kanso] capture failed', e)
  }
})

// ---- 服务器识别 ----
const serverBadge = $('#server-badge')

const validGameHost = (host: unknown): host is string =>
  typeof host === 'string' && /^[\w.-]+$/.test(host)

// Chromium 会持久缓存远端静态资源，但生成资源 URL 仍需要服务器主机名。
// 重启后先恢复上次识别值，避免图鉴必须等到首次 kcsapi 请求才出现图片。
const rememberedGameHost = config.get('kanso.lastGameHost', '')
if (validGameHost(rememberedGameHost)) {
  setGameHost(rememberedGameHost)
  setVoiceHost(rememberedGameHost)
}

// 游戏刚下过某张舰船美术：记下的真实路径可能是我们推不出来的那种
// （新深海舰的立绘带随机串），拿到就让图鉴重画一次。
broadcaster.addListener('kancolle.shipart.learn', (entry: ShipArtPathEntry) => {
  noteLearnedShipArt(entry)
})

// 玩家刚翻了图鉴（或启动回灌补完了历史）：衣装归属表变了，
// 立绘页的衣装格该跟着变。整表广播——它只有几百条，比逐条并入省心。
broadcaster.addListener('kancolle.shipcostume.learn', (map: unknown) => {
  noteShipCostumes(map)
})

// 刚有一句语音进了持久档案：图鉴里那一格该点亮了。
// 索引先在启动时拉一次（图鉴渲染时逐行判点亮，不能临时去问主进程）。
void loadVoiceArchive()
broadcaster.addListener('kancolle.voice.archived', (entry: VoiceArchiveEntry) => {
  // 新并进来的才广播：玩家如果正看着那一页，那一格得**当场**升档，
  // 而不是等下次切页（「播放即入档」之后入档就发生在他盯着这一页的时候）。
  if (noteVoiceArchived(entry)) notifyArchiveLit('voice', entry.mstId)
})

// 「官方没有这一格」的名单也在启动时取一次：台词卷逐行判骨架时不能临时发同步 IPC。
void loadVoiceAbsent()

// 刚有一张立绘进了持久档案：图鉴立绘卷那一格该点亮了。同语音侧，
// 索引在启动时拉一次（逐格判点亮不能临时去问主进程）。
void loadArtArchive()
broadcaster.addListener('kancolle.shipart.archived', (entry: ArtArchiveEntry) => {
  if (noteArtArchived(entry)) notifyArchiveLit('art', entry.mstId)
})

// 刚有一首 BGM 进了持久档案：海域卷那一个 ♪ 该改走档案实物了（零网络）。
// 与上面两族同一条路：索引启动时拉一次，之后靠广播增量并入。
void ensureBgmArchive()
broadcaster.addListener('kancolle.bgm.archived', (entry: BgmArchiveEntry) => {
  // BGM 档案的归属不是某一艘舰，mstId 一栏无意义——统一给 0，
  // 消费端本来就把 0 当「不知道是谁，保险起见重画一次」。
  if (noteBgmArchived(entry)) notifyArchiveLit('bgm', 0)
})

/**
 * 「档案刚多了一份」的广播。**用 DOM 事件而不是直接调模块**：
 * 这里是装配层，不该知道哪个模块正开着哪一页；由模块自己判断
 *（同 kcs-image 的 `kanso:art-source-change` 那条既有路子）。
 *
 * `mstId` 可能是 0——语音档案的归属是渲染时现算的，存的时候并不知道是谁
 *（见 shared/voice-archive-plan 的「先收后认」）。消费端因此不能只认 id 相等，
 * 0 要当成「不知道是谁，保险起见重画一次」。
 */
function notifyArchiveLit(kind: 'art' | 'voice' | 'bgm', mstId: number) {
  document.dispatchEvent(new CustomEvent('kanso:archive-lit', { detail: { kind, mstId } }))
}

broadcaster.addListener('kancolle.server.change', (server: { name?: string; ip?: string }) => {
  // 美术资源未缓存时的回退目标（只在识别出服务器时才可能回退）
  setGameHost(server.ip ?? null)
  setVoiceHost(server.ip ?? null)
  if (validGameHost(server.ip)) config.set('kanso.lastGameHost', server.ip)
  // 泊地名后的地址收进悬停（2026-08-16 用户定的「可查不常驻」同口径）：
  // 常驻只留泊地名，IP 想查 hover 就有，截图也不再顺手带出服务器地址。
  if (server.name && server.name !== '__UNKNOWN') {
    serverBadge.textContent = server.name
    serverBadge.title = `${server.name} · ${server.ip ?? ''}`
    serverBadge.className = 'known'
  } else {
    serverBadge.textContent = '未识别服务器'
    serverBadge.title = `${server.ip ?? ''}`
    serverBadge.className = ''
  }
})

// 极少数启动顺序下，主进程可能先于 renderer listener 识别服务器；立即补读一次。
const initialServer = broadcaster.serverInfo as { name?: string; ip?: string }
if (validGameHost(initialServer?.ip)) {
  setGameHost(initialServer.ip)
  setVoiceHost(initialServer.ip)
  config.set('kanso.lastGameHost', initialServer.ip)
}

// ---- 坞位分隔条：拖动时游戏区冻结缩放 ----
// 绕开 webview 的跨进程 resize：拖动期间把游戏 wrapper 冻结为定尺寸
// （webview 布局盒不变 → 游戏进程零重排），画面用 CSS transform 缩放
// （纯 GPU 合成，每帧顺滑），坞位布局实时跟手；松手恢复流式布局 +
// 一次真正的 setZoomFactor 恢复清晰度与点击坐标。
// 铆负责算尺寸，这里只管游戏区的冻结/缩放/复原。
// 拖动期间的 scale 用的是与松手后同一份布局判据（computeGameLayout），所以拖到哪儿
// 看到的就是松手后的样子：自适应连续缩，锁定档黑边跟着变、装不下时按档降下来。
let frozen: DOMRect | null = null
setLayoutDragHooks({
  start: () => {
    dragging = true
    frozen = gameWrapper.getBoundingClientRect()
    gameWrapper.style.width = `${frozen.width}px`
    gameWrapper.style.transformOrigin = 'center center'
  },
  move: () => {
    if (!frozen || frozen.width <= 0) return
    gameWrapper.style.transform = `scale(${gameLayoutNow().width / frozen.width})`
  },
  end: () => {
    frozen = null
    dragging = false
    gameWrapper.style.transform = ''
    applyGameLayout(true) // 立即执行一次真缩放，画面恢复清晰
  },
})

// ---- 专注模式（三坞全收，只留游戏）----
const focusBtn = $('#btn-focus')
const syncFocusBtn = (on: boolean) => {
  focusBtn.textContent = on ? '退出专注' : '专注'
}
focusBtn.addEventListener('click', () => syncFocusBtn(toggleFocus()))
document.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    e.preventDefault()
    syncFocusBtn(toggleFocus())
    return
  }
  // 界面缩放：Ctrl +/-/0（游戏画面自动跟着补偿，不会走形）
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    setUiZoom(getUiZoom() + 0.05)
  } else if (e.ctrlKey && e.key === '-') {
    e.preventDefault()
    setUiZoom(getUiZoom() - 0.05)
  } else if (e.ctrlKey && e.key === '0') {
    e.preventDefault()
    setUiZoom(1.15)
  }
})
// 界面缩放改了要重摆：锁定档的 wrapper 宽是「倍率 ÷ 界面缩放」，分母动了宽就得跟着动
onUiZoom(() => applyGameLayout())
// 钥里改档位/模式时由这里回摆。登记的这一下也顺手把开机的初始档摆上
setGameScaleApplier(() => applyGameLayout())

// ---- 启动点亮（测试性功能，钥里默认关）----
// **在这里就罩暗**，而不是等模块装完：游戏 webview 在本文件顶部就已经开始加载，
// 晚一步玩家会先看见登录页再被罩黑一次。坞位那边正相反——此刻还没有 .dock-group，
// 等它们生出来时 body 上已经有类，第一帧就是暗的。罩暗只是加一个兄弟节点，
// webview 的加载一毫秒都不推迟。
// 这一句跑在 installCrashNet 张网之前（它得赶在游戏画面出来之前），所以自带一层 try：
// 一个测试性的装饰绝不允许因为读配置出岔子就把整个渲染层拖成黑屏。
// 第零幕（欢迎屏）与第一幕（罩暗 → 点火）是**两个把手**：减少动态效果时第一幕
// 整场不放（armLaunchGlow 返回 null），欢迎屏照挂——它是等舰C进游戏的缓冲，
// 不是动画。先罩暗再盖欢迎屏：万一后一句出岔子，前一句留下的罩暗态还有
// ARM_CAP_MS 那只看门狗兜着，反过来则会留一层撤不掉的欢迎屏。
let glow: LaunchGlowHandle | null = null
let welcome: LaunchWelcomeHandle | null = null
try {
  const ceremonyOn: boolean = config.get(LAUNCH_GLOW_CONFIG_KEY, LAUNCH_GLOW_DEFAULT)
  // 同一个开关也管顶栏浮层的打开入场（一个实验开关管整个动画家族）
  setOverlayEntranceEnabled(ceremonyOn)
  glow = armLaunchGlow(ceremonyOn)
  welcome = armLaunchWelcome(ceremonyOn)
} catch (error) {
  recordCrash('startup:launch-glow-arm', error)
  glow?.cancel()
  welcome?.cancel()
  glow = null
  welcome = null
}

/**
 * 并行各幕的**注册表**。仪式的骨架（预隐 → 接手 → 错峰 → 收场 → 各条退出路径）
 * 全在 renderer/launch-glow.ts，这里只交代「哪个模块、取哪些元素、用哪套节奏」。
 * 加一幕＝往这个数组里加一条 + 样式表里一段关键帧 + 一条预隐规则。
 *
 * 每个 `pick()` 都在**第一幕最后一格亮透那一刻**才被调用（游戏区那 1.8 秒的淡入
 * 与各幕并排跑，不再干等），读到的是当时的实况：
 * 哪个模块还摆在屏幕上、面板里有几块内容。`hides` 是这一幕的预隐选择器，
 * 与样式表里那条 `body.kanso-ceremony …` 一一对应（护栏逐条对账，防止加了幕忘了预隐）。
 *
 * 选择器全部取**结构位置**而不是内容类名（`.battle-col > *` 而不是逐个分区的类名）：
 * 模块内部改版时不至于静默失配。真失配了也只是退化成「只剩扫描线」或「整块直接现身」，
 * 各有一条护栏钉着。
 */
const paneOf = (id: string): HTMLElement | null =>
  isModuleShowing(id) ? document.querySelector<HTMLElement>(`.ws-pane.mod-${id}`) : null

/** 把两列并成「自上而下」的一串：左一右一交替，长的那列的尾巴接在后面。 */
const zipColumns = (left: readonly HTMLElement[], right: readonly HTMLElement[]): HTMLElement[] => {
  const out: HTMLElement[] = []
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]) out.push(left[i])
    if (right[i]) out.push(right[i])
  }
  return out
}

const kids = (root: ParentNode | null, selector: string): HTMLElement[] =>
  root ? [...root.querySelectorAll<HTMLElement>(selector)] : []

/** 超出上限的不打标记——它们随所在容器一起现身（退化本身有护栏钉着）。 */
const capped = (items: readonly HTMLElement[]): HTMLElement[] =>
  items.slice(0, LAUNCH_STAGE_ITEM_CAP)

/**
 * 从 root 往下挑「够数又不至于爆炸」的一层：这一层太稀（不足 4 个）就再往下一层。
 *
 * 图鉴的落地页形态很多（卷标签下面可能是几块大区、也可能是一张大网格），写死层数
 * 一定会在某一卷上失灵。往下探到有点数量为止，再由 capped 封顶——
 * 于是「粒度取顶层区块或前若干卡」这条要求由结构本身满足，不用逐卷特判。
 */
const denseLayer = (root: HTMLElement | null): HTMLElement[] => {
  if (!root) return []
  let layer = [...root.children] as HTMLElement[]
  for (let depth = 0; depth < 3 && layer.length > 0 && layer.length < 4; depth++) {
    const next = layer.flatMap((el) => [...el.children] as HTMLElement[])
    if (!next.length) break
    layer = next
  }
  return layer
}

/** 资源数字所在的那些元素：锱的资源格 + 顶栏那一排。要对齐的几幕都按它算终点。 */
const digitCells = (): HTMLElement[] => [
  ...kids(paneOf('zi'), '.tiles .tile .v'),
  ...kids(document, '#header-status .hs-res b'),
]

/**
 * 资源数字那一幕的共同终点。要和它同刻收官的幕（锱的资源盘、顶栏角标）各调一次
 * ——**不共享状态**：喂的是同一份 DOM、同一个纯函数，结果必然一致。
 * 算得到 0 就是此刻没有数字可对，那几幕按自己的节奏走。
 */
const digitsEnd = (): number =>
  launchDigitsPlan(digitCells().map((el) => digitCountOf(el.textContent ?? ''))).end

const rectOf = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

const LAUNCH_STAGES: readonly LaunchStage[] = [
  {
    // 锐 · 编队：加载光带扫过，舰娘行一排排落位。
    // 行的标记来自锐 shipRow 的 `.ships > .ship[data-ship]`；DOM 顺序就是视觉从上到下，
    // 联合舰队的主力/护卫两段天然接得上。
    kind: 'stagger',
    id: 'roster',
    hides: '.ws-pane.mod-ru .ships .ship',
    mark: 'roster',
    animation: 'kanso-roster-row',
    overlay: { className: 'kanso-roster-load', animation: 'kanso-roster-veil' },
    timing: LAUNCH_ROSTER_TIMING,
    pick: () => {
      const host = paneOf('ru')
      return host ? { host, items: capped(kids(host, '.ships .ship[data-ship]')) } : null
    },
  },
  {
    // 镝 · 战术屏开机：扫描线横扫，随后左右两栏**相向合拢**。
    // 交错成「左一右一」而不是先左栏后右栏——相向归位要两边一起动才读得出对阵的气质。
    // 待机/空态（还没打过、或只有上次快照的空壳）就只演扫描线，不硬造分区。
    kind: 'stagger',
    id: 'battle',
    hides: '.ws-pane.mod-di .di-app',
    mark: 'battle',
    animation: 'kanso-battle-',
    overlay: { className: 'kanso-battle-scan', animation: 'kanso-battle-veil' },
    timing: LAUNCH_BATTLE_TIMING,
    pick: () => {
      const host = paneOf('di')
      if (!host) return null
      return {
        host,
        items: capped(zipColumns(kids(host, '.battle-col > *'), kids(host, '.sidebar > *'))),
      }
    },
  },
  {
    // 铎 · 作战公告揭幕：Hero 在前，两列的卡片交错成自上而下，逐块垂下。不带罩。
    // 铎在非活动期会被动态退场（setModuleVisible），那时 isModuleShowing 直接为假。
    kind: 'stagger',
    id: 'brief',
    hides: '.ws-pane.mod-du .du-app',
    mark: 'brief',
    animation: 'kanso-brief-drop',
    timing: LAUNCH_BRIEF_TIMING,
    pick: () => {
      const host = paneOf('du')
      if (!host) return null
      return {
        host,
        items: capped([
          ...kids(host, '.du-app > *:not(.body2)'),
          ...zipColumns(kids(host, '.body2 > .colL > *'), kids(host, '.body2 > .colR > *')),
        ]),
      }
    },
  },
  {
    // 鉴 · 开卷：书架按**对角线波纹**（左上 → 右下）一格格点起来。
    // 落地页可能是几百格的大网格，所以粒度取「够数的那一层」再封顶 24——
    // 剩下的跟着所在区块整体现身，绝不逐格铺几百个合成层。
    kind: 'stagger',
    id: 'tome',
    hides: '.ws-pane.mod-ji .ji-app > *:not(.book-tabs)',
    mark: 'tome',
    animation: 'kanso-tome-lit',
    timing: LAUNCH_TOME_TIMING,
    pick: () => {
      const host = paneOf('ji')
      if (!host) return null
      // 卷标签是框架、随第一幕已经亮了；正文那一块才是要点灯的书架
      const body = kids(host, '.ji-app > *:not(.book-tabs)')[0] ?? null
      const layer = denseLayer(body)
      if (!layer.length) return { host, items: [] }
      return { host, items: capped(rippleOrder(layer, rectOf, rectOf(body!))) }
    },
  },
  {
    // 钦 · 军令下达：任务行从左侧一条条推进来。抽屉（选中的那条的详情）不参与
    // 逐行，它随内容容器一起现身——一次只会有一个抽屉，逐行的节奏里塞一块大的反而乱。
    kind: 'stagger',
    id: 'order',
    hides: '.ws-pane.mod-qn .q-work',
    mark: 'order',
    animation: 'kanso-order-in',
    timing: LAUNCH_ORDER_TIMING,
    pick: () => {
      const host = paneOf('qn')
      return host ? { host, items: capped(kids(host, '.q-work .list > *')) } : null
    },
  },
  {
    // 镖 · 出航调度：总表行自上而下快速逐行点亮，**右栏详情作为最后一个元素**
    // 随后整块现身——「随后」这层意思由它排在队尾自然得到，不必另开一段编排。
    kind: 'stagger',
    id: 'dispatch',
    hides: '.ws-pane.mod-bi .elist',
    mark: 'dispatch',
    animation: 'kanso-dispatch-tick',
    timing: LAUNCH_DISPATCH_TIMING,
    pick: () => {
      const host = paneOf('bi')
      if (!host) return null
      return {
        host,
        items: [...capped(kids(host, '.elist > *')), ...kids(host, '.bi-app > .detail')],
      }
    },
  },
  {
    // 锱 · 资源盘通电：磁贴一块块亮起，右栏各卡跟着推上来。
    // **数字本身不归这一幕**——`.tiles .tile .v` 由下面那幕接管（乱滚后逐位锁定），
    // 这里只管磁贴外壳与右栏各卡。两幕压同一个元素的话，摘的时候就要靠运气了。
    // 收官对齐资源数字的共同终点：数字就住在磁贴里，磁贴先落定、数字还在滚
    // （或者反过来）都读不成「一台仪表同时完成自检」。
    kind: 'stagger',
    id: 'zi',
    hides: '.ws-pane.mod-zi .side > *',
    mark: 'zi',
    animation: 'kanso-zi-lit',
    timing: LAUNCH_ZI_TIMING,
    alignEnd: digitsEnd,
    pick: () => {
      const host = paneOf('zi')
      if (!host) return null
      // 先磁贴（左侧资源盘，DOM 顺序就是从左上到右下）再右栏各卡，读成一条自然的视线
      return { host, items: capped([...kids(host, '.tiles .tile'), ...kids(host, '.side > *')]) }
    },
  },
  {
    // 锱 + 顶栏 · 资源数字自检。顶栏是内核层、不占坞位，所以不看 isModuleShowing
    // ——它一直在屏幕上（也正因如此它必须被预隐，否则从头就把真值看了个遍）。
    kind: 'digits',
    id: 'digits',
    hides: '.ws-pane.mod-zi .tiles .tile .v',
    pick: digitCells,
  },
  {
    // 顶栏非资源角标（远/渠/建/演/库）· 逐组点亮。
    // **收官对齐资源数字的共同终点**：整条顶栏要读成「同一台仪表同刻完成自检」，
    // 一半先停一半还在动就散了。两幕不共享状态——各自拿 launchDigitsPlan 在同一份
    // DOM 上算一遍那个终点，于是天然一致（算得到 0 就是没数字可对，按自己的节奏走）。
    kind: 'stagger',
    id: 'badge',
    hides: '#header-status .hs-group:not(.resources)',
    mark: 'badge',
    animation: 'kanso-badge-lit',
    timing: LAUNCH_BADGE_TIMING,
    alignEnd: digitsEnd,
    pick: () => {
      const items = kids(document, '#header-status .hs-group:not(.resources)')
      return items.length ? { host: document.body, items: capped(items) } : null
    },
  },
]

// ---- 启动 ----
// 这段从前是裸的 `void (async ...)()`：中途任何一步抛异常，Promise 静默 reject，
// 界面就停在一片空白上，连一行提示都没有——历史上两次「黑屏」都是从这里开始的。
// 现在启动的每一步都单独交代成败，整体失败则把错误原文摆到屏幕上。
const startupFailed = (stage: string, error: unknown) => {
  // 起不来就别放动画了：罩层留着＝玩家眼前一片黑，比没有动画糟得多。
  // 欢迎屏更要撤——它盖住整个窗口，留着就是把「启动失败」那张说明也一起盖住了。
  glow?.cancel()
  welcome?.cancel()
  recordCrash(`startup:${stage}`, error)
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  overlayTitle.textContent = `启动失败：${stage}`
  overlayDetail.textContent = '游戏画面不受影响 · 修复后重启 kuma'
  overlayDetail.style.whiteSpace = 'pre-wrap'
  // 堆栈、账本位置、crash.log 是报障时才用得上的东西：收进折叠，别摆在玩家眼前。
  const more = document.createElement('details')
  more.className = 'overlay-more'
  const summary = document.createElement('summary')
  summary.textContent = '详细信息'
  const body = document.createElement('pre')
  body.textContent = `${detail}\n\n账本与配置在 %APPDATA%\\kuma\\，本次错误已记入 crash.log`
  more.append(summary, body)
  overlayDetail.append(more)
  overlay.classList.add('visible')
}

void (async () => {
  installCrashNet() // 先张网，后面每一步出的事才有地方落
  initUiZoom() // 先恢复界面缩放，避免装配后再抖一次
  const snapshotReady = initKernel()
  const lodeReady = initLocalization()
  // 欢迎屏那三件「真就绪」里的头两件。**失败也当到齐**：那一屏是缓冲不是守卫，
  // 为了一件永远不会来的事把玩家钉在欢迎屏上，比少等一步糟得多
  //（真出了事，下面的 startupFailed 会把欢迎屏撤掉、把错误摆到屏幕上）。
  // 提督名只有快照这一路带得出来——它就是那一刻才第一次到渲染层的。
  void snapshotReady.then(
    () => welcome?.noteReady('snapshot', mg.basic?.nickname),
    () => welcome?.noteReady('snapshot'),
  )
  void lodeReady.then(
    () => welcome?.noteReady('lode'),
    () => welcome?.noteReady('lode'),
  )
  try {
    await Promise.all([snapshotReady, lodeReady])
  } catch (error) {
    // 内核起不来则模块无从装配（它们全都直接读 mg），只能到此为止。
    startupFailed('数据内核', error)
    return
  }
  // 以下每一步都独立隔离：互链或抬头状态坏掉不该拖累模块装配，反之亦然。
  try {
    initLink()
  } catch (error) {
    recordCrash('startup:link', error)
  }
  try {
    initBgmPreview()
  } catch (error) {
    recordCrash('startup:bgm-preview', error)
  }
  // 试听的迷你播放条。单独隔离：它挂不上去不该连累 ♪ 词条本身还能不能点。
  try {
    initPreviewBar()
  } catch (error) {
    recordCrash('startup:preview-bar', error)
  }
  try {
    initCommandPalette()
  } catch (error) {
    recordCrash('startup:command-palette', error)
  }
  try {
    initHeaderStatus(broadcaster)
  } catch (error) {
    recordCrash('startup:header-status', error)
  }
  // 此处不接战斗开场动画：发行版里不该有那一族。
  try {
    initModules()
  } catch (error) {
    // 单个模块的 mount 失败已经由铆自己隔离了；能漏到这里的是装配框架本身出事。
    startupFailed('模块装配', error)
    return
  }
  installCrashBadge()
  syncFocusBtn(document.querySelector('#app')!.classList.contains('focus'))
  // 这一步从前是裸调的。它就排在点亮仪式前面，抛出来的话整个 IIFE 静默 reject，
  // 仪式态就永远挂着（游戏区盖着黑罩、编队行隐身）——比缩放没校准严重得多。
  try {
    applyZoom() // 坞位布局恢复后校一次缩放
  } catch (error) {
    recordCrash('startup:apply-zoom', error)
  }
  // 第三件真事：模块都挂上去了，且浏览器**真把第一帧画出来了**。
  // rAF 之外再补一记定时：窗口开在托盘里/被系统节流时 rAF 可以一直不来，
  // 那会把欢迎屏一路拖到封顶。noteReady 认的是集合，报两次没有副作用。
  const notePanesReady = () => welcome?.noteReady('panes')
  requestAnimationFrame(notePanesReady)
  setTimeout(notePanesReady, 400)
  // 第一幕的点火**接在第零幕落幕之后**：欢迎屏淡完 → 露出罩暗态的正常面板 → 点火。
  // 布局也是那一刻才取（而不是这会儿就取一份快照）——中间隔着好几秒。
  // 玩家中途点过一下的话，第一幕自己那份监听早就把整场收了，这里的 run 是空转。
  const ignite = () => {
    try {
      glow?.run(launchGlowLayout(), LAUNCH_STAGES)
    } catch (error) {
      glow?.cancel() // 排不出序列也不能把界面留在暗态
      recordCrash('startup:launch-glow', error)
    }
  }
  if (welcome) welcome.done(ignite)
  else ignite()
  console.log('[kanso] renderer ready')
})()
