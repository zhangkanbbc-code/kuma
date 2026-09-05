import { app, BrowserWindow, globalShortcut, ipcMain, webContents } from 'electron'

import config from './config'
import {
  BOSS_HOTKEY_ENABLED_CONFIG_KEY,
  HOTKEY_CONFIG_KEYS,
  HOTKEY_DEFAULTS,
  isAcceptableAccelerator,
  matchesInput,
  parseAccelerator,
  planBossToggle,
  serializeAccelerator,
} from '../shared/hotkeys'

import type { WebContents } from 'electron'
import type {
  Accelerator,
  ApplicationHotkeyId,
  BossAction,
  BossSnapshot,
  HotkeyId,
} from '../shared/hotkeys'

export type BossHotkeyStatus = 'registered' | 'conflict' | 'disabled'

let resolveMainWindow: () => BrowserWindow | null = () => null
let bossStatus: BossHotkeyStatus = 'disabled'
let bossSnapshot: BossSnapshot | null = null
let recording = false
let recordingSender: WebContents | null = null
let applicationAccelerators: Record<ApplicationHotkeyId, Accelerator>

const readAccelerator = (id: HotkeyId): Accelerator => {
  const configured = parseAccelerator(config.get(HOTKEY_CONFIG_KEYS[id], HOTKEY_DEFAULTS[id]))
  if (configured && isAcceptableAccelerator(configured)) return configured
  return parseAccelerator(HOTKEY_DEFAULTS[id]) as Accelerator
}

function readApplicationAccelerators(): Record<ApplicationHotkeyId, Accelerator> {
  return {
    reload: readAccelerator('reload'),
    focus: readAccelerator('focus'),
    capture: readAccelerator('capture'),
  }
}

const currentBossAccelerator = (): string => {
  const configured = config.get(HOTKEY_CONFIG_KEYS.boss, HOTKEY_DEFAULTS.boss)
  const parsed = parseAccelerator(configured)
  return serializeAccelerator(
    parsed && isAcceptableAccelerator(parsed)
      ? parsed
      : (parseAccelerator(HOTKEY_DEFAULTS.boss) as Accelerator),
  )
}

applicationAccelerators = readApplicationAccelerators()

const snapshotBossState = (): BossSnapshot => ({
  windows: BrowserWindow.getAllWindows().map((window) => ({
    id: window.id,
    visible: window.isVisible(),
    minimized: window.isMinimized(),
    focused: window.isFocused(),
  })),
  audio: webContents.getAllWebContents().map((contents) => ({
    id: contents.id,
    muted: contents.isAudioMuted(),
  })),
})

const executeBossAction = (action: BossAction) => {
  if (action.type === 'set-audio-muted') {
    const contents = webContents.fromId(action.id)
    if (contents && !contents.isDestroyed()) contents.setAudioMuted(action.muted)
    return
  }

  const window = BrowserWindow.fromId(action.id)
  if (!window || window.isDestroyed()) return
  if (action.type === 'hide-window') window.hide()
  else if (action.type === 'show-window') window.show()
  else if (action.type === 'minimize-window') window.minimize()
  else window.focus()
}

export const restoreFromBoss = (): boolean => {
  if (!bossSnapshot) return false
  for (const action of planBossToggle(true, bossSnapshot)) executeBossAction(action)
  bossSnapshot = null
  return true
}

export const toggleBoss = () => {
  if (bossSnapshot) {
    restoreFromBoss()
    return
  }
  const snapshot = snapshotBossState()
  bossSnapshot = snapshot
  for (const action of planBossToggle(false, snapshot)) executeBossAction(action)
}

const registerBoss = (): BossHotkeyStatus => {
  globalShortcut.unregisterAll()
  if (config.get(BOSS_HOTKEY_ENABLED_CONFIG_KEY, true) === false) return 'disabled'
  return globalShortcut.register(currentBossAccelerator(), toggleBoss) ? 'registered' : 'conflict'
}

const finishRecordingOnSenderExit = () => {
  if (recording) applyHotkeys()
}

const detachRecordingSender = () => {
  if (!recordingSender) return
  recordingSender.removeListener('destroyed', finishRecordingOnSenderExit)
  recordingSender.removeListener('did-navigate', finishRecordingOnSenderExit)
  recordingSender = null
}

export const applyHotkeys = (): { boss: BossHotkeyStatus } => {
  detachRecordingSender()
  recording = false
  applicationAccelerators = readApplicationAccelerators()
  bossStatus = registerBoss()
  return { boss: bossStatus }
}

/**
 * 应用内三键放在 WebContents 的 before-input-event，而不是宿主 DOM：
 * 焦点进入游戏 webview 后，guest 的键盘事件不会冒泡到主页面；主窗与 guest 各挂一份
 * 才能得到同一行为。命中后拦掉页面 keydown，避免浏览器默认动作或宿主再处理一次。
 */
export const attachApplicationHotkeys = (contents: WebContents) => {
  contents.on('before-input-event', (event, input) => {
    if (recording) return
    const matched = (Object.keys(applicationAccelerators) as ApplicationHotkeyId[]).find((id) =>
      matchesInput(input, applicationAccelerators[id]),
    )
    if (!matched) return
    event.preventDefault()
    const mainWindow = resolveMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('kanso:hotkey', matched)
    }
  })
}

export const installHotkeys = (getMainWindow: () => BrowserWindow | null) => {
  resolveMainWindow = getMainWindow
  bossStatus = applyHotkeys().boss
}

ipcMain.handle('hotkeys:apply', () => applyHotkeys())
ipcMain.handle('hotkeys:status', () => ({ boss: bossStatus }))
ipcMain.handle('hotkeys:recording', (event, active: unknown) => {
  recording = active === true
  if (recording) {
    detachRecordingSender()
    recordingSender = event.sender
    recordingSender.once('destroyed', finishRecordingOnSenderExit)
    recordingSender.once('did-navigate', finishRecordingOnSenderExit)
    globalShortcut.unregisterAll()
    return { boss: bossStatus }
  }
  return applyHotkeys()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
