// 浏览窗：能同时开好几扇的独立浏览器窗口（poi「一心二用 / 内蔵ブラウザ」同款定位——
// 主窗那份跑游戏，这边留给边玩边查、以及逛 DMM 的其他页面）。
//
// 三件要害：
//
// ① **会话必须与主窗是同一个**。代理设在 session.defaultSession 上（proxy.ts），
//    游戏 webview 也没写 partition，两边本来就在 defaultSession 里。所以这里
//    **绝不给 partition**：换一个会话就是要玩家再登录一次 DMM，代理也得再配一遍。
//
// ② **里面那层网页不是游戏页**。抓包桥认游戏 webContents 靠的是 preload 路径比对
//    （index.ts 的 will-attach-webview → did-attach-webview 记 id），浏览窗这层
//    既不挂那份 preload、也不经过那条认定，于是 kcsapi 不会被记账、语音/立绘/BGM
//    不会入档、字幕不会出。玩家真在这儿开一局游戏也不拦——只是那一局不进账本。
//
// ③ **退出治理不必新写**。quit-guard 的第三道防线挂在 app.on('web-contents-created')
//    上，任何 webContents 一出生就被记 PID，浏览窗与它里面那层网页天然在名单里；
//    主窗关掉时这边逐扇 close（见 index.ts），窗口全关 → window-all-closed → quit。

import { BrowserWindow, screen } from 'electron'
import path from 'path'

import config from './config'
import { ROOT } from './env'
import { BROWSE_HOME_URL, normalizeBrowseInput } from '../shared/browse-url'
import { stopFileNavigate } from './webcontent-utils'

const MIN_WIDTH = 640
const MIN_HEIGHT = 480
const BOUNDS_KEY = 'kuma.browseWindow'
/** 多扇同时开着时错开一点，免得后开的把先开的整个盖住、看着像只开了一扇。 */
const CASCADE_STEP = 28

const openWindows = new Set<BrowserWindow>()
/** 每扇窗开出来时错开了多少：关窗存位置要把这一段减回去，否则窗口会一次比一次靠右下。 */
const cascadeOf = new WeakMap<BrowserWindow, number>()

interface SavedBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

/** 上次关窗那扇的大小位置当模板；跨显示器失效就回主屏居中（同仓内两扇副窗的写法）。 */
const nextBounds = () => {
  const saved = config.get(BOUNDS_KEY, {}) as SavedBounds
  const primary = screen.getPrimaryDisplay().workArea
  const width = Math.max(MIN_WIDTH, saved.width ?? Math.min(primary.width, 1100))
  const height = Math.max(MIN_HEIGHT, saved.height ?? Math.min(primary.height, 800))
  let { x, y } = saved
  const onDisplay = screen.getAllDisplays().some(({ workArea }) =>
    x != null && y != null &&
    x >= workArea.x && x < workArea.x + workArea.width &&
    y >= workArea.y && y < workArea.y + workArea.height
  )
  if (!onDisplay) {
    x = primary.x + Math.max(0, Math.floor((primary.width - width) / 2))
    y = primary.y + Math.max(0, Math.floor((primary.height - height) / 2))
  }
  const cascade = CASCADE_STEP * openWindows.size
  return { x: x! + cascade, y: y! + cascade, width, height, cascade }
}

/**
 * 开一扇新的浏览窗。每调用一次就是新的一扇，互不影响、各自关各自的。
 *
 * `rawUrl` 只有一个来源：窗口里的页面自己弹出的新窗口（target=_blank 一类）。
 * 那是不可信输入，所以照样过一遍地址栏的判据，认不出就当没给、开主页。
 */
export const openBrowseWindow = (rawUrl?: unknown) => {
  const url = normalizeBrowseInput(rawUrl) ?? BROWSE_HOME_URL
  const { cascade, ...bounds } = nextBounds()
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'kuma · 浏览窗',
    icon: path.join(ROOT, 'assets', 'branding', 'kuma.png'),
    backgroundColor: '#0d1318',
    show: false,
    webPreferences: {
      // 这一层只是导航条外壳，自己不需要 Node，也不需要 @electron/remote。
      // 要加载的那条网址由 loadFile 的 query 递进来，不经 IPC。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  openWindows.add(win)
  cascadeOf.set(win, cascade)
  win.setMenu(null)

  // 外壳自己不许被导航走：它一旦离开本地那份 html，导航条就没了，
  // 而玩家看到的还是一扇「kuma 的窗口」。
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // 里面那层网页的参数在这里定死，不看 <webview> 标签上写了什么。
  // **preload 一定要清掉**：游戏 preload 是抓包桥与 kuma-cache 换出的入口，
  // 这一层拿到它就等于多出一个能伪造游戏流量的页面。
  win.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.webviewTag = false
  })
  win.webContents.on('did-attach-webview', (_event, guest) => {
    // file: 不该从页面自己的跳转里进来（地址栏那一道判据在 shared/browse-url）
    stopFileNavigate(guest.id)
    // 页面弹新窗口 → 再开一扇浏览窗，而不是甩给系统浏览器：
    // 系统浏览器是另一套 Cookie，DMM 那边的登录跳转会当场断在半路。
    guest.setWindowOpenHandler(({ url: popupUrl }) => {
      if (normalizeBrowseInput(popupUrl)) openBrowseWindow(popupUrl)
      return { action: 'deny' }
    })
  })

  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(ROOT, 'dist', 'renderer', 'browse.html'), { query: { url } })

  win.on('close', () => {
    if (win.isDestroyed()) return
    // 存的是「没错开之前」的位置：不减回去，开一扇存一扇，窗口会一路往右下爬出屏幕。
    // 最大化态也不单独记：下一扇按满屏开出来会盖住一切，而多扇正是这个功能的用法。
    const { x, y, width, height } = win.getNormalBounds()
    const step = cascadeOf.get(win) ?? 0
    config.set(BOUNDS_KEY, { x: x - step, y: y - step, width, height })
  })
  win.on('closed', () => {
    openWindows.delete(win)
  })
  return win
}

/** 主窗没了就把浏览窗全带走（它们是主窗的附属，不该把应用留在后台）。 */
export const closeAllBrowseWindows = () => {
  for (const win of [...openWindows]) {
    if (!win.isDestroyed()) win.close()
  }
}
