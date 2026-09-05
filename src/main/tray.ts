// 镇 · 系统托盘。为「开着挂机」那种用法准备：远征、入渠、建造都是等时刻的事，
// 艦素多数时间在后台，窗口收起来不该等于停止观测。
//
// 两条纪律：
// ① **默认不改 X 键的语义**。关闭到托盘要用户在钥里显式打开——
//    悄悄把「关闭」变成「隐藏」，用户会以为退出了，实际进程还在占着账本与登录态。
// ② **托盘不是第二套通知**。它只显示未读条数，事件本身仍归铃管；
//    这里不弹气泡、不抢焦点，否则同一件事会被提醒两遍。
import { app, Menu, Tray } from 'electron'
import fs from 'fs'
import path from 'path'

import config from './config'
import { safeConsole } from './crash-log'
import { ROOT } from './env'
import { restoreFromBoss } from './hotkeys'

import type { BrowserWindow } from 'electron'

const ICON_PATH = path.join(ROOT, 'assets', 'branding', 'kuma.ico')

let tray: Tray | null = null
let getWindow: () => BrowserWindow | null = () => null
let unread = 0
let dnd = false
// 退出中：close 事件此时必须放行，否则「退出艦素」会被隐藏逻辑吃掉，永远退不掉
let quitting = false

export const trayEnabled = () => config.get('kanso.tray.enabled', true) === true
export const closeToTray = () => tray != null && config.get('kanso.tray.closeToTray', false) === true
export const minimizeToTray = () =>
  tray != null && config.get('kanso.tray.minimizeToTray', false) === true

/** 从托盘/通知里把主窗口拉回来。隐藏过的窗口 focus() 是无效的，必须先 show() */
export const showMainWindow = () => {
  if (restoreFromBoss()) return
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

const tooltip = () => (unread > 0 ? `kuma · ${unread} 条未读` : 'kuma')

const rebuildMenu = () => {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: unread > 0 ? `显示 kuma（${unread} 条未读）` : '显示 kuma', click: showMainWindow },
      { type: 'separator' },
      {
        label: '勿扰',
        type: 'checkbox',
        checked: dnd,
        // 勿扰的真状态在铃那边（还含「出击中自动勿扰」），这里只发意向、不自己记账，
        // 免得托盘和面板各存一份，出现「面板说开、托盘说关」
        click: () => getWindow()?.webContents.send('tray:toggle-dnd'),
      },
      { type: 'separator' },
      {
        label: '退出 kuma',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.setToolTip(tooltip())
}

/** 未读数由铃推过来；托盘只显示，不参与判定 */
export const setTrayUnread = (count: number) => {
  const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (next === unread) return
  unread = next
  rebuildMenu()
}

export const setTrayDnd = (active: boolean) => {
  if (active === dnd) return
  dnd = active
  rebuildMenu()
}

export const destroyTray = () => {
  tray?.destroy()
  tray = null
}

/**
 * 装托盘。必须在主窗口创建之后调用。
 * 冒烟模式下不装：托盘会让进程在窗口关闭后继续活着，冒烟就永远等不到退出。
 */
export const installTray = (resolveWindow: () => BrowserWindow | null) => {
  getWindow = resolveWindow
  app.on('before-quit', () => {
    quitting = true
  })
  if (process.env.KANSO_SMOKE || !trayEnabled()) return
  try {
    if (!fs.existsSync(ICON_PATH)) {
      safeConsole('warn', '[kanso] 找不到托盘图标，跳过托盘', ICON_PATH)
      return
    }
    // 直接给路径，不要先 createFromPath：这个 .ico 里有 16→256 共 9 档，
    // 预加载只会拿到 256 那张，再由 Electron 缩到 16px，托盘上就是糊的。
    // 交给系统自己按 DPI 挑档才清晰。
    tray = new Tray(ICON_PATH)
    tray.on('click', showMainWindow)
    tray.on('double-click', showMainWindow)
    rebuildMenu()
  } catch (error) {
    // 托盘装不上不该拖垮启动——没有托盘，艦素照常能用
    safeConsole('warn', '[kanso] 托盘创建失败', error)
    tray = null
  }
}

/**
 * 把窗口的关闭/最小化接到托盘上。返回 true 表示这次事件已被托盘接管，
 * 调用方应当阻止默认行为。
 */
export const interceptWindowClose = (win: BrowserWindow): boolean => {
  if (quitting || !closeToTray()) return false
  win.hide()
  return true
}

/**
 * 最小化到托盘。Electron 的 'minimize' 不带 event（窗口此时已经缩下去了），
 * 没有 preventDefault 可用——直接 hide() 把它从任务栏收走即可。
 */
export const handleWindowMinimize = (win: BrowserWindow) => {
  if (quitting || !minimizeToTray()) return
  win.hide()
}
