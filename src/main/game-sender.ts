import { webContents } from 'electron'
import type { WebContents, WebFrameMain } from 'electron'
import config from './config'
import { GAME_URL_CONFIG_KEY, normalizeGameUrl } from '../shared/game-url'

let gameId: number | null = null
export const setGameSenderId = (id: number | null) => { gameId = id }
const nominations = new WeakMap<WebFrameMain, { url: string; parentUrl: string; nominated: Promise<boolean> }>()

const nominatedByParent = (frame: WebFrameMain): Promise<boolean> => {
  const parent = frame.parent!
  const remembered = nominations.get(frame)
  if (remembered?.url === frame.url && remembered.parentUrl === parent.url) return remembered.nominated
  const url = frame.url, parentUrl = parent.url
  // 与 capture-page 的既有 DMM 游戏容器一致；普通广告 iframe 不能提名服务器。
  const nominated = parent.executeJavaScript(`Array.from(document.querySelectorAll('iframe#game_frame, iframe#htmlWrap'), el => el.src)`)
    .then((sources: unknown) => {
      if (frame.url !== url || parent.url !== parentUrl) return false
      const target = httpUrl(url)
      return Array.isArray(sources) && sources.some((source) => {
        const parsed = typeof source === 'string' ? httpUrl(source) : null
        return parsed && parsed.origin === target?.origin && parsed.pathname === target?.pathname
      })
    }).catch(() => false)
  nominations.set(frame, { url, parentUrl, nominated })
  return nominated
}

const httpUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw)
    return /^https?:$/.test(url.protocol) ? url : null
  } catch { return null }
}

/** 从应用选定的入口和真实帧树认游戏，不用 IPC 自报的 host 学信任。 */
export const isGameFrame = async (contents: WebContents, frame: WebFrameMain | null): Promise<boolean> => {
  try {
    if (gameId == null || contents.id !== gameId || contents.isDestroyed() || !frame) return false
    const main = contents.mainFrame
    const entry = httpUrl(normalizeGameUrl(config.get(GAME_URL_CONFIG_KEY)))!
    const mainUrl = httpUrl(main.url)
    if (!mainUrl || mainUrl.origin !== entry.origin) return false
    // 自定义直连入口由玩家指定；默认 DMM 入口只作启动器，不认作游戏服务器。
    const launcher = /(^|\.)dmm\.com$/i.test(entry.hostname)
    const roleOf = async (current: WebFrameMain): Promise<'launcher' | 'game' | null> => {
      const url = httpUrl(current.url)
      if (!url) return null
      if (current === main) return launcher ? (url.pathname === entry.pathname ? 'launcher' : null) : 'game'
      if (!current.parent) return null
      const parentRole = await roleOf(current.parent)
      const parentUrl = httpUrl(current.parent.url)
      if (parentRole === 'game') return url.origin === parentUrl?.origin ? 'game' : null
      if (parentRole !== 'launcher') return null
      // 子帧自行导航到同形路径不能成为游戏；地址必须由可信父页的 frame.src 指定。
      // 只读父页 DOM、按帧/父页导航缓存，不让资源热路径反复跨进程查询。
      if (!await nominatedByParent(current)) return null
      // DMM 启动器指定的游戏文档 / gadget 才能建立动态服务器来源；广告帧不传递信任。
      if (/^\/kcs2\/index\.(?:php|html)$/i.test(url.pathname)) return 'game'
      if (url.pathname.startsWith('/gadget_html5/')) return 'game'
      if (url.hostname === 'osapi.dmm.com' && url.pathname.startsWith('/gadgets/')) return 'launcher'
      return null
    }
    const accepted = await roleOf(frame) === 'game'
    return accepted && main.url === mainUrl.href && !contents.isDestroyed() && contents.id === gameId
  } catch {
    // 导航/销毁期间读取帧属性可能抛错，此时不收货。
    return false
  }
}

export const isGameApiSender = async (event: { sender: WebContents; senderFrame: WebFrameMain | null }, rawUrl: string, pathname: string): Promise<boolean> => {
  const frame = event.senderFrame, frameUrlBefore = frame?.url
  if (!await isGameFrame(event.sender, frame) || frame?.url !== frameUrlBefore) return false
  const url = httpUrl(rawUrl)
  const frameUrl = httpUrl(event.senderFrame!.url)
  return !!url && url.origin === frameUrl?.origin && url.pathname === pathname && pathname.startsWith('/kcs')
}

/** 资源身份按 pathname 记账，但来源必须是游戏文档所在的服务器。 */
export const isGameResourceRequest = async (details: { webContentsId?: number; frame?: WebFrameMain | null }, url: URL): Promise<boolean> => {
  if (gameId == null || details.webContentsId !== gameId) return false
  const contents = webContents.fromId(gameId)
  const frameUrlBefore = details.frame?.url
  if (!contents || !await isGameFrame(contents, details.frame ?? null) || details.frame?.url !== frameUrlBefore) return false
  const frameUrl = httpUrl(details.frame!.url)
  return /^https?:$/.test(url.protocol) && url.host === frameUrl?.host
}
