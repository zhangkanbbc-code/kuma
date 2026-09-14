import { BrowserWindow, ipcMain, screen } from 'electron'
import type { NativeImage, WebContents } from 'electron'
import {
  isPopModuleId, popWindowTitle, POP_QUERY_KEY, POP_WINDOW_BOUNDS_KEY,
  POP_WINDOW_DEFAULT_SIZE, POP_WINDOW_MIN_SIZE, POP_OPEN_CHANNEL, POP_CLOSE_CHANNEL,
  POP_FOCUS_CHANNEL, POP_LIST_CHANNEL, POP_CLOSED_CHANNEL, POP_RELAY_CHANNEL, POP_RELAY_EVENT,
} from '../shared/pop-module'
import type { PopModuleId } from '../shared/pop-module'

type PopWindowDeps = {
  getMainWindow: () => BrowserWindow | null
  config: { get(path: string, fallback?: unknown): unknown; set(path: string, value: unknown): void }
  indexHtml: string
  icon: NativeImage | string | undefined
  backgroundColor: () => string
  prepare: (win: BrowserWindow) => void
}

export const installPopWindows = (deps: PopWindowDeps) => {
  const windows = new Map<PopModuleId, BrowserWindow>()
  let closingAll = false
  const list = (): PopModuleId[] => [...windows.keys()]
  const pushList = () => {
    const ids = list()
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(POP_LIST_CHANNEL, ids)
      } catch {
        // 广播期间刚销毁的窗口跳过，余下窗口仍要收到名单。
      }
    }
  }
  const isKumaSender = (contents: WebContents): boolean =>
    deps.getMainWindow()?.webContents === contents ||
    [...windows.values()].some((win) => win.webContents === contents)

  const focus = (id: unknown): boolean => {
    const win = isPopModuleId(id) ? windows.get(id) : undefined
    if (!win || win.isDestroyed()) return false
    if (win.isMinimized()) win.restore()
    win.focus()
    return true
  }
  const open = (id: unknown): boolean => {
    if (!isPopModuleId(id)) return false
    if (focus(id)) return true
    const saved = deps.config.get(POP_WINDOW_BOUNDS_KEY(id), {}) as {
      x?: number; y?: number; width?: number; height?: number; isMaximized?: boolean
    }
    const primary = screen.getPrimaryDisplay().workArea
    const width = Math.max(POP_WINDOW_MIN_SIZE.width, saved.width ?? POP_WINDOW_DEFAULT_SIZE.width)
    const height = Math.max(POP_WINDOW_MIN_SIZE.height, saved.height ?? POP_WINDOW_DEFAULT_SIZE.height)
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
    const win = new BrowserWindow({
      x, y, width, height,
      minWidth: POP_WINDOW_MIN_SIZE.width,
      minHeight: POP_WINDOW_MIN_SIZE.height,
      title: popWindowTitle(id),
      icon: deps.icon,
      backgroundColor: deps.backgroundColor(),
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    })
    windows.set(id, win)
    deps.prepare(win)
    win.setMenu(null)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => {
      win.show()
      if (saved.isMaximized) win.maximize()
    })
    win.on('close', () => {
      deps.config.set(POP_WINDOW_BOUNDS_KEY(id), {
        ...win.getNormalBounds(),
        isMaximized: win.isMaximized(),
      })
    })
    win.on('closed', () => {
      windows.delete(id)
      const main = deps.getMainWindow()
      if (!closingAll && main && !main.isDestroyed()) main.webContents.send(POP_CLOSED_CHANNEL, id)
      pushList()
    })
    win.loadFile(deps.indexHtml, { query: { [POP_QUERY_KEY]: id } })
    pushList()
    return true
  }
  const close = (id: unknown): boolean => {
    if (isPopModuleId(id)) windows.get(id)?.close()
    return true
  }
  const closeAll = () => {
    // closed 可能晚于 close() 返回；退出标记保持到整个管理器随主窗退场。
    closingAll = true
    for (const win of windows.values()) win.close()
  }
  const hideAll = () => {
    for (const win of windows.values()) win.hide()
  }
  const showAll = () => {
    for (const win of windows.values()) win.showInactive()
  }

  ipcMain.handle(POP_OPEN_CHANNEL, (event, id: unknown) => {
    if (!isKumaSender(event.sender)) return false
    return open(id)
  })
  ipcMain.handle(POP_CLOSE_CHANNEL, (event, id: unknown) => {
    if (!isKumaSender(event.sender)) return false
    return close(id)
  })
  ipcMain.handle(POP_FOCUS_CHANNEL, (event, id: unknown) => {
    if (!isKumaSender(event.sender)) return false
    return focus(id)
  })
  ipcMain.handle(POP_LIST_CHANNEL, (event) => {
    if (!isKumaSender(event.sender)) return false
    return list()
  })
  ipcMain.handle(POP_RELAY_CHANNEL, (event, raw: unknown) => {
    if (!isKumaSender(event.sender)) return false
    if (!raw || typeof raw !== 'object') return false
    const { to, kind, payload } = raw as { to?: unknown; kind?: unknown; payload?: unknown }
    if (typeof kind !== 'string' || kind.length === 0) return false
    const target = to === 'main' ? deps.getMainWindow() : isPopModuleId(to) ? windows.get(to) : undefined
    if (!target || target.isDestroyed()) return false
    target.webContents.send(POP_RELAY_EVENT, { kind, payload })
    return true
  })

  return { open, close, focus, list, closeAll, hideAll, showAll, isKumaSender }
}
