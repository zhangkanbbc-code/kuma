// 镇：主进程入口。启动顺序与命令行开关移植自 poi app.ts
// (https://github.com/poooi/poi, MIT License, Copyright (c) poi contributors)。
import './env' // 必须最先执行：设置 global 环境常量
import { APPDATA_PATH } from './env'
import * as electronRemote from '@electron/remote/main'
import { X509Certificate, createHash } from 'crypto'
import { app, BrowserWindow, ipcMain, screen, webContents } from 'electron'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { closeAllBrowseWindows, openBrowseWindow } from './browse-window'
import config from './config'
import { installCrashLogging, reportFatal } from './crash-log'
import { installPerfLogging } from './perf-log'
import { attachApplicationHotkeys, installHotkeys } from './hotkeys'
import { ROOT } from './env'
import { installQuitGuard, reapOrphanKansoProcesses } from './quit-guard'
import { flushShipArtPaths } from './ship-art-store'
import { flushShipCostumes } from './ship-costume-store'
import { flushAbyssVoiceSightings } from './abyss-voice-sightings'
import { flushVoiceArchive } from './voice-archive'
import { flushArtArchive } from './art-archive'
import { flushBgmArchive } from './bgm-archive'
import { flushVoiceProbe } from './voice-probe'
import { registerMapArtJson } from './map-art-json'
import {
  destroyTray,
  installTray,
  interceptWindowClose,
  handleWindowMinimize,
  setTrayDnd,
  setTrayUnread,
  showMainWindow,
} from './tray'
import {
  ensureModDir,
  registerKcsResourceScheme,
  registerKcsResourceProtocol,
  setKcsResourceGameWebContentsId,
} from './kcs-resource'
import { handleWebviewPreloadHack, handleNewWindow, stopFileNavigate } from './webcontent-utils'
import { DEFAULT_DISK_CACHE_MB, resolveDiskCacheMB } from '../shared/disk-cache'

// Chromium 的 Cookie / Local Storage / ServiceWorker 与业务数据共用稳定的 kanso 目录。
// 不能依赖 productName 推导默认 userData，否则开发版改名或打包为「艦素」后会像首次登录。
// 冒烟模式下 APPDATA_PATH 本身已经指向独立临时目录，仍保持零共享。
app.setPath('userData', APPDATA_PATH)

electronRemote.initialize()

// 尽早张网：下面每一个 require 都可能出事，而此刻还没有任何窗口能显示错误。
installCrashLogging()
// 慢操作哨兵 + 渲染进程挂死看门狗（perf.log）——卡顿不抛异常，crash.log 看不见它
installPerfLogging(() => mainWindow)

// Electron ≥28 没有 process.mainModule，@electron/remote 靠 module.parent 链
// 上溯找主模块，在本项目的加载方式下会失灵（相对路径 require 全部炸掉）。
// 用它提供的 remote-require 事件接管解析：相对路径一律按 dist/main 解析，
// 且只放行白名单模块（这个口子对游戏 webview 的 preload 也可达）。
const REMOTE_REQUIRE_ALLOWLIST = new Set(['./config', './game-api-broadcaster'])
app.on('remote-require' as any, (event: any, _contents: unknown, moduleName: unknown) => {
  if (typeof moduleName === 'string' && moduleName.startsWith('./')) {
    if (REMOTE_REQUIRE_ALLOWLIST.has(moduleName)) {
      event.returnValue = require(path.join(__dirname, moduleName))
    } else {
      event.defaultPrevented = true
    }
  }
})

require('./proxy')
require('./login-keeper')
require('./mg') // 铭：数据核心（账本 + 状态归一化 + 快照回放）
require('./lode') // 矿脉：社区数据包加载器
// akashi-fit 已于 2026-08-22 整层退役：该站未声明数据许可，运行时不再有它的出网点。
// 上游没收录的新装备改由「面板反推」的实测层兜（shared/fit-bonus.ts），零许可风险。
require('./yu') // 钥：缓存急救 + 重启
require('./push') // 手机推送（Bark）：全仓唯一的推送出网点，默认全关

// 学到的美术路径也要赶在硬退之前落盘（攒批写盘还可能压着最后几条）
app.on('before-quit', () => flushShipArtPaths())
// 衣装归属同理：学它要玩家在游戏里翻一遍图鉴，丢了就得再翻一遍
app.on('before-quit', () => flushShipCostumes())
// 语音档案的索引同理：实物已经落盘了，索引丢了会让刚点亮的格子又灭回去
app.on('before-quit', () => flushVoiceArchive())
app.on('before-quit', () => flushAbyssVoiceSightings())
// 立绘档案同理：实物已经落盘了，索引丢了会让刚点亮的格子又灭回去
app.on('before-quit', () => flushArtArchive())
// BGM 档案同理：活动曲撤场之后档案里那一份就是唯一来源，索引丢不得
app.on('before-quit', () => flushBgmArchive())
// 「官方没有这一格」的探测台账同理：丢了就得再去问服务器一遍，
// 而那正是这个域最想避免的事（一次点击一次请求，别让玩家白点第二遍）
app.on('before-quit', () => flushVoiceProbe())

// 退出兜底必须**排在铭之后**注册：before-quit 按注册顺序回调，
// 账本存盘要先落地，再去关子进程、再谈强制退出。
installQuitGuard()

// kanso-cache:// 特权 scheme 必须在 app ready 前注册
registerKcsResourceScheme()

// —— poi 传承的命令行开关 ——
// 游戏音频自动播放
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// webview iframe 隔离 polyfill（preload 钩子依赖）
app.commandLine.appendSwitch('disable-site-isolation-trials')
// Windows 下遮挡计算导致的假死
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// —— 磁盘缓存上限（poi 没设，是艦素自己加的）——
//
// 不设这个开关时 Chromium 会自己挑一个很保守的上限。实测 2026-08-09：
// 这台机器 C 盘可用 914 GB，它只肯用 103 MB，而且已经满了在持续淘汰——
// 只是启动一次应用（没登录游戏）就把游戏资源条目从 455 挤到了 446。
//
// 更要命的是超限之后的行为：blockfile 后端不是逐条淘汰，而是**整盘推倒重来**。
// 对照实验（灌 400 MB 再重启）：上限 128 MB 的那组重启后只剩 0.6 MB，
// 上限 4096 MB 的那组 409.7 MB 一条不少。所以默认上限下玩一会就超，
// 下次启动缓存是空的——「每次登录立绘都要一张张重新跑出来」就是这么来的。
//
// 游戏素材本来就是 PIXI 按需逐个请求的，缓存再大也不会「一次性全出来」；
// 但命中缓存后每张图从一次网络往返变成一次本地读盘，差一个数量级。
const diskCacheMB = resolveDiskCacheMB(config.get('kanso.cache.diskCacheMB', DEFAULT_DISK_CACHE_MB))
app.commandLine.appendSwitch('disk-cache-size', String(diskCacheMB * 1024 * 1024))

app.setAppUserModelId('moe.kanso')

let mainWindow: BrowserWindow | null = null
let resourceTrendWindow: BrowserWindow | null = null
let questTreeWindow: BrowserWindow | null = null
let battleReplayWindow: BrowserWindow | null = null
let battleReplaySnapshotId = 0
let battleReplayReady = false
// 人生记录窗：**一艘一扇**，按在籍 id 记账。同一艘再点是把那扇拿到前面来
//（多开同一艘等于凭空造出两份互不同步的同一条时间轴）；换一艘才开新的一扇。
const shipLifeWindows = new Map<number, BrowserWindow>()
const appIcon = path.join(ROOT, 'assets', 'branding', 'kuma.png')

const openResourceTrendWindow = () => {
  if (resourceTrendWindow && !resourceTrendWindow.isDestroyed()) {
    if (resourceTrendWindow.isMinimized()) resourceTrendWindow.restore()
    resourceTrendWindow.show()
    resourceTrendWindow.focus()
    return
  }

  const saved = config.get('kanso.resourceTrendWindow', {}) as {
    x?: number
    y?: number
    width?: number
    height?: number
    isMaximized?: boolean
  }
  const primary = screen.getPrimaryDisplay().workArea
  const width = Math.max(760, saved.width ?? Math.min(primary.width, 1180))
  const height = Math.max(480, saved.height ?? Math.min(primary.height, 760))
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

  const trend = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 760,
    minHeight: 480,
    title: 'kuma · 资源增减折线图',
    icon: appIcon,
    backgroundColor: '#0d1318',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  resourceTrendWindow = trend
  electronRemote.enable(trend.webContents)
  trend.setMenu(null)
  trend.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  trend.webContents.on('will-navigate', (event) => event.preventDefault())
  trend.once('ready-to-show', () => {
    trend.show()
    if (saved.isMaximized) trend.maximize()
  })
  trend.loadFile(path.join(ROOT, 'dist', 'renderer', 'resource-trend.html'))
  trend.on('close', () => {
    if (trend.isDestroyed()) return
    config.set('kanso.resourceTrendWindow', {
      ...trend.getNormalBounds(),
      isMaximized: trend.isMaximized(),
    })
  })
  trend.on('closed', () => {
    resourceTrendWindow = null
  })
}

ipcMain.handle('window:resource-trend', () => openResourceTrendWindow())

let questTreeFocusId = 0

const sendQuestTreeFocus = () => {
  if (!questTreeWindow || questTreeWindow.isDestroyed() || questTreeFocusId <= 0) return
  questTreeWindow.webContents.send('quest-tree:focus', questTreeFocusId)
}

const openQuestTreeWindow = (rawFocusId?: unknown) => {
  const focusId = Number(rawFocusId)
  if (Number.isInteger(focusId) && focusId > 0) questTreeFocusId = focusId
  if (questTreeWindow && !questTreeWindow.isDestroyed()) {
    if (questTreeWindow.isMinimized()) questTreeWindow.restore()
    questTreeWindow.show()
    questTreeWindow.focus()
    sendQuestTreeFocus()
    return
  }

  const saved = config.get('kanso.questTreeWindow', {}) as {
    x?: number
    y?: number
    width?: number
    height?: number
    isMaximized?: boolean
  }
  const primary = screen.getPrimaryDisplay().workArea
  const width = Math.max(860, saved.width ?? Math.min(primary.width, 1280))
  const height = Math.max(600, saved.height ?? Math.min(primary.height, 820))
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

  const tree = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 860,
    minHeight: 600,
    title: 'kuma · 完整任务树',
    icon: appIcon,
    backgroundColor: '#0d1318',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  questTreeWindow = tree
  electronRemote.enable(tree.webContents)
  tree.setMenu(null)
  tree.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  tree.webContents.on('will-navigate', (event) => event.preventDefault())
  tree.webContents.once('did-finish-load', () => sendQuestTreeFocus())
  tree.once('ready-to-show', () => {
    tree.show()
    if (saved.isMaximized) tree.maximize()
  })
  tree.loadFile(path.join(ROOT, 'dist', 'renderer', 'quest-tree.html'))
  tree.on('close', () => {
    if (tree.isDestroyed()) return
    config.set('kanso.questTreeWindow', {
      ...tree.getNormalBounds(),
      isMaximized: tree.isMaximized(),
    })
  })
  tree.on('closed', () => {
    questTreeWindow = null
  })
}

const openShipLifeWindow = (rawRosterId: unknown) => {
  const rosterId = Number(rawRosterId)
  if (!Number.isInteger(rosterId) || rosterId <= 0) return
  const open = shipLifeWindows.get(rosterId)
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore()
    open.show()
    open.focus()
    return
  }

  const saved = config.get('kanso.shipLifeWindow', {}) as {
    x?: number
    y?: number
    width?: number
    height?: number
    isMaximized?: boolean
  }
  const primary = screen.getPrimaryDisplay().workArea
  const width = Math.max(720, saved.width ?? Math.min(primary.width, 1120))
  const height = Math.max(520, saved.height ?? Math.min(primary.height, 820))
  // 存的是一份位置，而这里可能同时开着好几艘：后开的逐扇错开一点，
  // 免得三扇严丝合缝地叠在一起，看起来像只开了一扇。
  const cascade = (shipLifeWindows.size % 6) * 26
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
  if (x != null && y != null && cascade > 0) {
    x = Math.min(x + cascade, primary.x + Math.max(0, primary.width - width))
    y = Math.min(y + cascade, primary.y + Math.max(0, primary.height - height))
  }

  const life = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 720,
    minHeight: 520,
    title: 'kuma · 人生记录',
    icon: appIcon,
    backgroundColor: '#0d1318',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  shipLifeWindows.set(rosterId, life)
  electronRemote.enable(life.webContents)
  life.setMenu(null)
  life.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  life.webContents.on('will-navigate', (event) => event.preventDefault())
  life.once('ready-to-show', () => {
    life.show()
    if (saved.isMaximized) life.maximize()
  })
  // 是哪一艘走查询串，不走 did-finish-load 后补发：页面一开始就知道自己在讲谁，
  // 中间没有「还不知道要显示谁」的那一帧。
  life.loadFile(path.join(ROOT, 'dist', 'renderer', 'ship-life.html'), {
    query: { roster: `${rosterId}` },
  })
  life.on('close', () => {
    if (life.isDestroyed()) return
    config.set('kanso.shipLifeWindow', {
      ...life.getNormalBounds(),
      isMaximized: life.isMaximized(),
    })
  })
  life.on('closed', () => {
    // 只在还是自己那一扇时销账：这一艘要是已经被换成新的一扇，别把新的抹掉
    if (shipLifeWindows.get(rosterId) === life) shipLifeWindows.delete(rosterId)
  })
}

ipcMain.handle('window:ship-life', (_event, rawRosterId: unknown) =>
  openShipLifeWindow(rawRosterId),
)

const openBattleReplayWindow = (rawSnapshotId: unknown, sender: Electron.WebContents) => {
  const snapshotId = Number(rawSnapshotId)
  if (!Number.isInteger(snapshotId) || snapshotId <= 0) return
  battleReplaySnapshotId = snapshotId
  if (battleReplayWindow && !battleReplayWindow.isDestroyed()) {
    if (battleReplayReady) {
      if (battleReplayWindow.isMinimized()) battleReplayWindow.restore()
      battleReplayWindow.webContents.send('battle-replay:open', snapshotId)
      battleReplayWindow.show()
      battleReplayWindow.focus()
    }
    return
  }

  const saved = config.get('kanso.battleReplayWindow', {}) as {
    x?: number
    y?: number
    width?: number
    height?: number
    isMaximized?: boolean
  }
  const senderWindow = BrowserWindow.fromWebContents(sender)
  const senderBounds = senderWindow && !senderWindow.isDestroyed() ? senderWindow.getBounds() : null
  const display = senderBounds
    ? screen.getDisplayMatching(senderBounds)
    : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const minWidth = Math.min(860, workArea.width)
  const minHeight = Math.min(560, workArea.height)
  const width = Math.min(
    workArea.width,
    Math.max(minWidth, saved.width ?? Math.min(workArea.width, 1280)),
  )
  const height = Math.min(
    workArea.height,
    Math.max(minHeight, saved.height ?? Math.min(workArea.height, 820)),
  )
  const savedFitsDisplay =
    saved.x != null &&
    saved.y != null &&
    saved.x >= workArea.x &&
    saved.y >= workArea.y &&
    saved.x + width <= workArea.x + workArea.width &&
    saved.y + height <= workArea.y + workArea.height
  let x: number
  let y: number
  if (savedFitsDisplay) {
    x = saved.x!
    y = saved.y!
  } else {
    x = senderBounds
      ? senderBounds.x + 32
      : workArea.x + Math.floor((workArea.width - width) / 2)
    y = senderBounds
      ? senderBounds.y + 32
      : workArea.y + Math.floor((workArea.height - height) / 2)
  }
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height))

  const replayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth,
    minHeight,
    title: '战斗复盘',
    icon: appIcon,
    backgroundColor: '#0d1318',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  battleReplayWindow = replayWindow
  battleReplayReady = false
  electronRemote.enable(replayWindow.webContents)
  replayWindow.setMenu(null)
  replayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  replayWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  replayWindow.once('ready-to-show', () => {
    battleReplayReady = true
    if (battleReplaySnapshotId !== snapshotId) {
      replayWindow.webContents.send('battle-replay:open', battleReplaySnapshotId)
    }
    replayWindow.show()
    if (saved.isMaximized) replayWindow.maximize()
  })
  replayWindow.loadFile(path.join(ROOT, 'dist', 'renderer', 'battle-replay.html'), {
    query: { snapshot: `${snapshotId}` },
  })
  replayWindow.on('close', () => {
    if (replayWindow.isDestroyed()) return
    config.set('kanso.battleReplayWindow', {
      ...replayWindow.getNormalBounds(),
      isMaximized: replayWindow.isMaximized(),
    })
  })
  replayWindow.on('closed', () => {
    if (battleReplayWindow === replayWindow) {
      battleReplayWindow = null
      battleReplayReady = false
    }
  })
}

ipcMain.handle('window:battle-replay', (event, rawSnapshotId: unknown) =>
  openBattleReplayWindow(rawSnapshotId, event.sender),
)

// 旧版人生记录窗 → 主窗的兼容入口；当前独立窗已改走 window:battle-replay。
ipcMain.handle('window:ship-life-battle', (_event, rawSnapshotId: unknown) => {
  const snapshotId = Number(rawSnapshotId)
  if (!Number.isInteger(snapshotId) || snapshotId <= 0 || !mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('window:ship-life-battle', snapshotId)
})

// 浏览窗：每按一次开新的一扇（不复用、不聚焦已有的那扇——多开本来就是它的用途）。
// 不把 BrowserWindow 回给渲染层：那东西过不了 IPC 序列化。
ipcMain.handle('window:browse', () => {
  openBrowseWindow()
})

ipcMain.handle('window:quest-tree', (_event, rawFocusId?: unknown) => openQuestTreeWindow(rawFocusId))
ipcMain.handle('window:quest-tree-focus', (_event, rawQuestId: unknown) => {
  const questId = Number(rawQuestId)
  if (!Number.isInteger(questId) || questId <= 0 || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('window:quest-tree-focus', questId)
})

// 单实例
if (!app.requestSingleInstanceLock()) {
  console.error('[kanso] another instance is running, exiting')
  app.quit()
} else {
  // 拿到锁才清残留：此刻没有别的正常实例，同名进程一律是上次没退干净的僵尸。
  // 放在拿锁之前清，会把正在用的那个实例误杀掉。
  reapOrphanKansoProcesses()
  // 收进托盘后再点一次启动：restore+focus 对隐藏窗口是无效的，走托盘那条统一的唤回
  app.on('second-instance', () => showMainWindow())
}

app.on('window-all-closed', () => {
  app.quit()
})

// 托盘 → 铃：未读数与勿扰态由渲染端推过来（判定归铃，托盘只显示）
ipcMain.handle('tray:unread', (_event, count: unknown) =>
  setTrayUnread(typeof count === 'number' ? count : 0),
)
ipcMain.handle('tray:dnd', (_event, active: unknown) => setTrayDnd(active === true))
// 系统通知点开时用：窗口若已收进托盘，renderer 的 window.focus() 是无效的
ipcMain.handle('window:show', () => showMainWindow())

app.on('ready', () => {
  registerKcsResourceProtocol()
  registerMapArtJson()
  // 魔改目录先建出来：玩家只要把文件丢进去就行，不必自己新建、也不必找 %APPDATA%。
  // 建不出来不拦启动（函数内部自己吞并 warn 一条）
  ensureModDir()

  // 窗口位置恢复 + 跨显示器有效性校验（移植自 poi app.ts）
  const { workArea } = screen.getPrimaryDisplay()
  const saved = config.get('kanso.window', {}) as {
    x?: number
    y?: number
    width?: number
    height?: number
    isMaximized?: boolean
  }
  let { x, y } = saved
  const width = saved.width ?? Math.min(workArea.width, 1600)
  const height = saved.height ?? Math.min(workArea.height, 900)
  const validate = (n: number | undefined, min: number, range: number) =>
    n != null && n >= min && n < min + range
  const withinDisplay = (d: Electron.Display) => {
    const wa = d.workArea
    return validate(x, wa.x, wa.width) && validate(y, wa.y, wa.height)
  }
  if (!screen.getAllDisplays().some(withinDisplay)) {
    x = workArea.x
    y = workArea.y
  }

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    title: 'kuma',
    icon: appIcon,
    backgroundColor: '#0d1318',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  mainWindow = win
  attachApplicationHotkeys(win.webContents)
  installHotkeys(() => mainWindow)

  // 窗口一建好就露面，不等 ready-to-show（渲染层首帧）：2.2 MB 的渲染层 bundle 要解析
  // 执行完才有首帧，用户实机感受是「双击后要等两秒才弹窗」（2026-08-26 他裁）。
  // 背景色 #0d1318 与工作台同色，先弹一块暗底、欢迎屏铭牌随后淡入接上，读成一次连续暗转。
  // 先 maximize 再 show，免得先小后大跳一下。
  if (saved.isMaximized) {
    win.maximize()
  }
  win.show()

  electronRemote.enable(win.webContents)
  const trustedWebviewPreload = path.join(ROOT, 'assets', 'preload', 'webview-preload.js')
  let gameWebContentsId: number | null = null

  // ---- 试听时压住游戏声音 ----
  // 渲染层任一试听真的在响就报一声（两个播放器的状态在 renderer/preview-audio 合并过，
  // 变了才发），这里转给游戏页的 preload——那边把游戏总音量乘 0，试听一停再乘回 1。
  //
  // **瞬态内存态，绝不 config.set**：它几十秒内就要恢复，落盘只会在崩溃之后
  // 留下一台永远哑着的游戏，而玩家在钥里根本找不到是谁把音量按住的。
  let previewDucking = false
  const sendPreviewDuck = (active: boolean) => {
    previewDucking = active
    const game = gameWebContentsId == null ? null : webContents.fromId(gameWebContentsId)
    if (game && !game.isDestroyed()) game.send('kanso:preview-audio-duck', active)
  }
  ipcMain.on('kanso:preview-audio-active', (event, active: unknown) => {
    // 只认主窗口那一个渲染进程：游戏页里的脚本不该按得住自己的喇叭
    if (event.sender.id !== win.webContents.id) return
    sendPreviewDuck(active === true)
  })
  // 报信的那一端没了（重载 / 崩溃 / 关窗），那声「恢复」就再也不会来了——
  // 游戏不能因此一直哑着，所以在这里替它发。
  const clearPreviewDuck = () => {
    if (previewDucking) sendPreviewDuck(false)
  }
  win.webContents.on('did-navigate', clearPreviewDuck)
  win.webContents.once('destroyed', clearPreviewDuck)
  win.webContents.addListener('will-attach-webview', (event, webPreferences, params) => {
    const current = gameWebContentsId == null ? null : webContents.fromId(gameWebContentsId)
    let preloadMatches = false
    try {
      const preload = params.preload?.startsWith('file:')
        ? fileURLToPath(params.preload)
        : params.preload
      preloadMatches =
        typeof preload === 'string' &&
        path.resolve(preload).toLowerCase() === path.resolve(trustedWebviewPreload).toLowerCase()
    } catch (error) {
      console.warn('[kanso] rejected webview with invalid preload URL', error)
    }

    // 主页面需要 webviewTag 承载游戏，但矿脉数据也会进入该页面的 innerHTML。
    // 只接受应用同步创建的首个游戏视图；额外 webview 即使伪造标签也不能附着。
    if ((current && !current.isDestroyed() && !current.isCrashed()) || !preloadMatches) {
      event.preventDefault()
      console.warn('[kanso] rejected unexpected webview attachment')
      return
    }
    webPreferences.preload = trustedWebviewPreload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = true
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = false
    webPreferences.webSecurity = false
    webPreferences.allowRunningInsecureContent = false
    webPreferences.webviewTag = false
  })
  win.webContents.addListener('did-attach-webview', (_event, webContent) => {
    gameWebContentsId = webContent.id
    setKcsResourceGameWebContentsId(webContent.id)
    attachApplicationHotkeys(webContent)
    // 换了一页游戏就是换了一份 preload，那边的试听系数从 1 起——正在试听的话补一声
    if (previewDucking) sendPreviewDuck(true)
    webContent.once('destroyed', () => {
      if (gameWebContentsId === webContent.id) {
        gameWebContentsId = null
        setKcsResourceGameWebContentsId(null)
      }
    })
    electronRemote.enable(webContent)
    stopFileNavigate(webContent.id)
    handleNewWindow(webContent.id)
  })
  // 嵌套 iframe preload 失效兜底
  handleWebviewPreloadHack(win.webContents.id)
  // 主窗口自己的 target=_blank（图鉴「史实」页外链等）也走系统默认浏览器——
  // 此前只有游戏 webview 挂了这层，主窗口会孵出一个没菜单没会话的裸 Electron
  // 窗口，外站基本打不开（2026-08-19 用户实测「弹出来的浏览器没用」）
  handleNewWindow(win.webContents.id)

  win.setMenu(null)
  installTray(() => mainWindow)
  win.loadFile(path.join(ROOT, 'dist', 'renderer', 'index.html'))

  win.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  const saveBounds = () => {
    if (win.isDestroyed()) return
    config.set('kanso.window', {
      ...win.getNormalBounds(),
      isMaximized: win.isMaximized(),
    })
  }
  // 关闭/最小化到托盘：位置照存（隐藏后窗口还在，下次 show 要回到原处），
  // 但事件本身交给托盘接管。默认不开，X 键仍然是退出。
  win.on('close', (e) => {
    saveBounds()
    if (interceptWindowClose(win)) e.preventDefault()
  })
  win.on('minimize', () => handleWindowMinimize(win))
  win.on('closed', () => {
    mainWindow = null
    destroyTray()
    if (resourceTrendWindow && !resourceTrendWindow.isDestroyed()) {
      resourceTrendWindow.close()
    }
    if (questTreeWindow && !questTreeWindow.isDestroyed()) {
      questTreeWindow.close()
    }
    if (battleReplayWindow && !battleReplayWindow.isDestroyed()) {
      battleReplayWindow.close()
    }
    // 人生记录窗同理（可能开着好几扇）：主窗没了它们不该把应用留在后台——
    // 窗口全关才有 window-all-closed → app.quit()，留一扇在那儿等于关不掉。
    for (const life of [...shipLifeWindows.values()]) {
      if (!life.isDestroyed()) life.close()
    }
    shipLifeWindows.clear()
    // 浏览窗是主窗的附属：主窗没了它们不该把应用留在后台（窗口全关才有
    // window-all-closed → app.quit()，留一扇在那儿等于关不掉）
    closeAllBrowseWindows()
  })

  // DNS over HTTPS（移植自 poi）
  app.configureHostResolver({
    enableBuiltInResolver: true,
  })

  if (process.env.KANSO_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
  // 冒烟测试同时打开完整任务树，并等到真实任务节点渲染后才算启动成功。
  // 这样辅助窗口脚本/IPC/矿脉读取任一处崩溃都不会被主窗口的假绿掩盖。
  if (process.env.KANSO_SMOKE) {
    openQuestTreeWindow()
    const started = Date.now()
    // 主窗口的模块装配自查。铆做了逐模块隔离之后，某个模块崩掉不再是黑屏，
    // 而是安静地少一格——冒烟必须主动读铆记的那本装配账，否则这道防线
    // 反倒把「模块装不上」藏了起来，冒烟照样一片绿。
    const probeMainModules = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        console.error('[kanso] smoke: 主窗口已不在')
        app.quit()
        return
      }
      void mainWindow.webContents
        .executeJavaScript(
          "JSON.stringify({mounted: document.body.dataset.kansoMounted ?? '', crashed: document.body.dataset.kansoCrashed ?? ''})",
          true,
        )
        .then((raw: string) => {
          const { mounted, crashed } = JSON.parse(raw) as { mounted: string; crashed: string }
          const [ok, total] = mounted.split('/').map(Number)
          if (crashed) {
            console.error(`[kanso] smoke: 模块装配失败 → ${crashed}`)
            app.quit()
          } else if (total > 0 && ok === total) {
            console.log(`[kanso] smoke: modules ${mounted}`)
            console.log('[kanso] smoke: window ok, quitting')
            app.quit()
          } else if (Date.now() - started < 20000) {
            setTimeout(probeMainModules, 250)
          } else {
            console.error(`[kanso] smoke: 模块未装配完（${mounted || '无装配账'}）`)
            app.quit()
          }
        })
        .catch((error) => {
          console.error('[kanso] smoke: 主窗口模块探测失败', error)
          app.quit()
        })
    }
    // 任务树探针分两件事看，别只数节点：
    //  · 渲染有没有跑完（body.dataset.kansoQuestTree 存在）——中途崩掉就没有；
    //  · 目录包在不在（kansoQuestPack）——缺 quests-scn 时零节点是**正确的降级**，
    //    不是故障。只数节点会把这两种混成一个「did not render」，于是
    //    「零包」降级冒烟必然误报红，而为了让它变绿又只能去放宽正常档的判据。
    //    两件事分开记之后：有包就必须有节点，没包只要求渲染跑完（占位是对的）。
    const probeQuestTree = () => {
      const tree = questTreeWindow
      if (!tree || tree.isDestroyed()) {
        app.quit()
        return
      }
      void tree.webContents.executeJavaScript(
        "JSON.stringify({nodes: document.body.dataset.kansoQuestTree ?? '', pack: document.body.dataset.kansoQuestPack ?? ''})",
        true,
      ).then((raw: string) => {
        const { nodes, pack } = JSON.parse(raw) as { nodes: string; pack: string }
        const rendered = nodes !== ''
        const count = Number(nodes) || 0
        if (rendered && (pack === '0' || count > 0)) {
          console.log(
            pack === '0'
              ? '[kanso] smoke: quest tree 无任务目录包，占位渲染完成（降级档口径）'
              : `[kanso] smoke: quest tree ${count} nodes`,
          )
          probeMainModules()
        } else if (Date.now() - started < 20000) {
          setTimeout(probeQuestTree, 250)
        } else {
          console.error(
            rendered
              ? `[kanso] smoke: 任务目录包在位却一个节点都没渲染出来（nodes=${count}）`
              : '[kanso] smoke: quest tree did not render',
          )
          app.quit()
        }
      }).catch((error) => {
        console.error('[kanso] smoke: quest tree probe failed', error)
        app.quit()
      })
    }
    questTreeWindow?.webContents.once('did-finish-load', probeQuestTree)
  }
})

// —— 自定义 CA / 证书信任（本地 MITM 代理场景，移植自 poi app.ts）——
let caCert: X509Certificate | undefined
let caCertError = false

const ensureCACert = () => {
  if (caCertError || caCert) {
    return
  }
  const customCertificateAuthority = config.get('kanso.network.customCertificateAuthority', '')
  if (customCertificateAuthority) {
    try {
      const ca = fs.readFileSync(customCertificateAuthority, 'utf8')
      caCert = new X509Certificate(ca)
    } catch (e) {
      console.error('[kanso] CA error', e)
      caCertError = true
    }
  }
}

const caVerifyCache = new Map<string, boolean>()
const verifyCACert = (data: string) => {
  if (caVerifyCache.has(data)) {
    return caVerifyCache.get(data)!
  }
  ensureCACert()
  let result = false
  if (caCert) {
    try {
      result = new X509Certificate(data).verify(caCert.publicKey)
    } catch (_e) {
      result = false
    }
  }
  caVerifyCache.set(data, result)
  return result
}

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  const trusted: string[] = config.get('kanso.trustedCerts', [])
  if (verifyCACert(certificate.data)) {
    event.preventDefault()
    callback(true)
    return
  }
  const hash = createHash('sha256').update(certificate.data).digest('base64')
  if (trusted.includes(hash)) {
    event.preventDefault()
    callback(true)
  } else {
    console.warn(`[kanso] certificate error for ${url}, sha256=${hash}`)
    console.warn('[kanso] 如需信任该证书，把上面的 sha256 加进 config.json 的 kanso.trustedCerts')
    callback(false)
  }
})

// 主进程的最后一道。不退出——被动只读的工具进程活着比干净地死掉有用得多，
// 但必须留下痕迹，否则「用了一天忽然某个功能不灵了」永远查不到头。
// 处理逻辑放在 crash-log 里：这里绝不能出现裸 console，它自己就是会抛的那一个。
process.on('uncaughtException', (e) => reportFatal('uncaughtException', e))
process.on('unhandledRejection', (reason) => reportFatal('unhandledRejection', reason))
