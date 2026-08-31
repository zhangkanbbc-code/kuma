// 浏览窗（渲染层外壳）：一排导航条 + 一层网页，别的什么都不做。
//
// 这一层没有 Node、没有 @electron/remote，也不碰账本——它就是个浏览器外壳，
// 里面那层网页的参数由主进程按死（main/browse-window.ts 的 will-attach-webview）。
// 初始要打开哪一条也是主进程经 loadFile 的 query 递进来的。
import { BROWSE_HOME_URL, normalizeBrowseInput } from '../shared/browse-url'
import { cleanUserAgent } from '../shared/user-agent'

type WebviewTag = Electron.WebviewTag

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`missing element: ${selector}`)
  return el
}

const back = $<HTMLButtonElement>('#nav-back')
const forward = $<HTMLButtonElement>('#nav-forward')
const home = $<HTMLButtonElement>('#nav-home')
const address = $<HTMLInputElement>('#nav-address')
const holder = $('#browse-view')

// UA 清洗：与游戏 webview 共用 shared/user-agent 那一份判据
const USER_AGENT = cleanUserAgent(navigator.userAgent)

const initialUrl =
  normalizeBrowseInput(new URLSearchParams(location.search).get('url')) ?? BROWSE_HOME_URL

const view = document.createElement('webview') as WebviewTag
view.setAttribute('useragent', USER_AGENT)
// allowpopups 才会走主进程那条 setWindowOpenHandler（不开的话页面弹窗直接没反应，
// DMM 的登录跳转就断在半路）。**不设 preload、不设 disablewebsecurity**：
// 这一层不是游戏页，抓包桥与 kanso-cache 换出都不该经过它。
view.setAttribute('allowpopups', '')
view.src = initialUrl
holder.appendChild(view)

// 地址栏跟着页面走，但玩家正在框里打字时不抢他的输入
let lastUrl = initialUrl
address.value = initialUrl

const syncAddress = (url: string) => {
  const editing = document.activeElement === address && address.value !== lastUrl
  lastUrl = url
  if (!editing) address.value = url
}

const syncButtons = () => {
  try {
    back.disabled = !view.canGoBack()
    forward.disabled = !view.canGoForward()
  } catch (_e) {
    // 还没挂上（dom-ready 之前）问不出来，下一个事件会再问一遍
  }
}
syncButtons()

const setTitle = (pageTitle: string) => {
  // 多扇同时开着时任务栏要分得出谁是谁，所以页面标题在前、窗口名在后
  document.title = pageTitle ? `${pageTitle} · kuma 浏览窗` : 'kuma · 浏览窗'
}

const navigate = (raw: string) => {
  const target = normalizeBrowseInput(raw)
  if (!target) {
    // 认不出就原地不动，把当前这条还回框里——**不替他猜**一条去打开
    address.value = lastUrl
    return
  }
  view.loadURL(target).catch((error) => {
    console.warn('[kanso] 浏览窗导航失败', target, error)
  })
}

view.addEventListener('dom-ready', syncButtons)
view.addEventListener('did-navigate', (e) => {
  syncAddress(e.url)
  syncButtons()
})
view.addEventListener('did-navigate-in-page', (e) => {
  if (!e.isMainFrame) return
  syncAddress(e.url)
  syncButtons()
})
view.addEventListener('did-stop-loading', syncButtons)
view.addEventListener('page-title-updated', (e) => setTitle(e.title))

back.addEventListener('click', () => {
  if (view.canGoBack()) view.goBack()
})
forward.addEventListener('click', () => {
  if (view.canGoForward()) view.goForward()
})
home.addEventListener('click', () => navigate(BROWSE_HOME_URL))
address.addEventListener('keydown', (e) => {
  // 输入法组合中的回车是敲定候选那一下（实测它照样带 isComposing）——
  // 当成「打开这条网址」的话，用中文搜东西永远只能打出半个词就跳走
  if (e.isComposing) return
  if (e.key !== 'Enter') return
  navigate(address.value)
})
// 点进地址栏就整条选中：改网址十有八九是整条换掉，不是在中间插一段
address.addEventListener('focus', () => address.select())
