import { BrowserWindow } from 'electron'
import type { WebContents, WebFrameMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { ROOT } from './env'

const pages = new Set(['index.html', 'browse.html', 'resource-trend.html', 'quest-tree.html', 'ship-life.html', 'battle-replay.html'])
export const isKumaPage = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'file:') return false
    const file = fileURLToPath(url)
    return path.dirname(file) === path.join(ROOT, 'dist', 'renderer') && pages.has(path.basename(file))
  } catch {
    return false
  }
}

/** 只认应用窗口里的本地主帧；浏览 webview、游戏和窗口里的远程子帧均不属于 UI。 */
export const isKumaWindow = (contents: WebContents | null): contents is WebContents => {
  if (!contents || contents.isDestroyed() || contents.getType() !== 'window') return false
  const win = BrowserWindow.fromWebContents(contents)
  return !!win && !win.isDestroyed() && win.webContents === contents && isKumaPage(contents.getURL())
}

export const isKumaSender = (event: { sender: WebContents; senderFrame: WebFrameMain | null }): boolean =>
  isKumaWindow(event.sender) && event.senderFrame === event.sender.mainFrame && isKumaPage(event.senderFrame.url)
