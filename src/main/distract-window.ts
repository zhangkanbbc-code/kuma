import { ipcMain, screen } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import config from './config'
import { DISTRACT_DEFAULT_SIZE, DISTRACT_PATHS, fitBoundsToWorkArea } from '../shared/distract-mode'

let distractPrev: { bounds: Rectangle; isMaximized: boolean } | null = null

export const exitDistractWindow = (win: BrowserWindow) => {
  if (!distractPrev) return false
  // 先收好小窗边界，再还原常规窗口；关闭时也复用这一顺序。
  config.set(DISTRACT_PATHS.bounds, win.getNormalBounds())
  win.setAlwaysOnTop(false)
  const prev = distractPrev
  distractPrev = null
  if (win.isMaximized()) win.unmaximize()
  win.setBounds(prev.bounds)
  if (prev.isMaximized) win.maximize()
  return true
}

export const installDistractWindow = (getWindow: () => BrowserWindow | null) => {
  ipcMain.handle('window:distract-enter', (_event, { alwaysOnTop }) => {
    const win = getWindow()
    if (!win || distractPrev) return
    const current = win.getNormalBounds()
    const workArea = screen.getDisplayMatching(win.getBounds()).workArea
    distractPrev = { bounds: current, isMaximized: win.isMaximized() }
    if (distractPrev.isMaximized) win.unmaximize()
    win.setBounds(fitBoundsToWorkArea(
      config.get(DISTRACT_PATHS.bounds, {}), workArea, { ...current, ...DISTRACT_DEFAULT_SIZE },
    ))
    win.setAlwaysOnTop(!!alwaysOnTop)
  })
  ipcMain.handle('window:distract-exit', () => {
    const win = getWindow()
    if (win) exitDistractWindow(win)
  })
  ipcMain.handle('window:distract-always-on-top', (_event, on: boolean) => {
    const win = getWindow()
    if (win && distractPrev) win.setAlwaysOnTop(on)
    config.set(DISTRACT_PATHS.alwaysOnTop, on)
  })
}
