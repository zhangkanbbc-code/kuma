import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import pop from '../dist/shared/pop-module.js'

const plain = (value) => JSON.parse(JSON.stringify(value))
const fixture = () => {
  const handlers = new Map(), created = [], prepared = [], saved = new Map(), writes = []
  class FakeWindow {
    static getAllWindows() { return created.filter((win) => !win.destroyed) }
    constructor(options = {}) {
      this.options = options
      this.events = new Map()
      this.sent = []
      this.calls = []
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      this.webContents = {
        id: created.length + 1,
        events: new Map(),
        send: (...args) => { this.sent.push(plain(args)) },
        on: (name, handler) => { this.webContents.events.set(name, handler) },
        setWindowOpenHandler: (handler) => { this.openHandler = handler },
      }
      created.push(this)
    }
    on(name, handler) { this.events.set(name, handler) }
    once(name, handler) { this.on(name, handler) }
    emit(name) { this.events.get(name)?.() }
    isDestroyed() { return !!this.destroyed }
    isMinimized() { return !!this.minimized }
    isMaximized() { return !!this.maximized }
    restore() { this.calls.push('restore'); this.minimized = false }
    focus() { this.calls.push('focus') }
    show() { this.calls.push('show') }
    showInactive() { this.calls.push('showInactive') }
    hide() { this.calls.push('hide') }
    maximize() { this.calls.push('maximize'); this.maximized = true }
    setMenu(menu) { this.menu = menu }
    loadFile(...args) { this.loaded = plain(args) }
    getNormalBounds() { return this.bounds }
    close() {
      this.emit('close')
      this.destroyed = true
      this.emit('closed')
    }
  }
  const main = new FakeWindow(), other = new FakeWindow()
  const primary = { x: 100, y: 50, width: 1920, height: 1080 }
  const secondary = { x: -1280, y: 0, width: 1280, height: 1024 }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../dist/main/pop-windows.js', import.meta.url), 'utf8'), {
    module, exports: module.exports,
    require: (id) => {
      if (id === 'electron') return {
        BrowserWindow: FakeWindow,
        ipcMain: { handle: (name, handler) => { assert.equal(handlers.has(name), false); handlers.set(name, handler) } },
        screen: { getPrimaryDisplay: () => ({ workArea: primary }),
          getAllDisplays: () => [primary, secondary].map((workArea) => ({ workArea })) },
      }
      if (id === '../shared/pop-module') return pop
      throw new Error(`unexpected require ${id}`)
    },
  })
  let currentMain = main
  const indexHtml = fileURLToPath(new URL('../dist/renderer/index.html', import.meta.url))
  const api = module.exports.installPopWindows({
    getMainWindow: () => currentMain,
    config: { get: (key, fallback) => saved.get(key) ?? fallback,
      set: (key, value) => { saved.set(key, plain(value)); writes.push([key, plain(value)]) } },
    indexHtml, icon: 'app-icon', backgroundColor: () => '#123456',
    prepare: (win) => { prepared.push(win) },
  })
  return { api, main, other, created, prepared, saved, writes, primary, indexHtml, handlers,
    clearMain: () => { currentMain = null },
    invoke: (channel, sender, ...args) => handlers.get(channel)({ sender }, ...args),
    messages: (win, channel) => win.sent.filter(([name]) => name === channel).map(([, value]) => value),
  }
}

test('同 id 只建一扇，已有最小化窗口先恢复再聚焦', () => {
  const f = fixture()
  assert.equal(f.api.open('yu'), false)
  assert.equal(f.created.length, 2)
  assert.equal(f.api.open('ji'), true)
  const win = f.created[2]
  win.minimized = true
  assert.equal(f.api.open('ji'), true)
  assert.equal(f.created.length, 3)
  assert.deepEqual(win.calls, ['restore', 'focus'])
  assert.equal(f.api.focus('di'), false)
  assert.equal(f.api.focus('ji'), true)
  assert.deepEqual(win.calls, ['restore', 'focus', 'focus'])
})

test('新窗使用主页面查询串及约定参数，阻止导航与新窗口但允许页面改标题', () => {
  const f = fixture()
  f.api.open('ji')
  const win = f.created[2]
  assert.deepEqual(f.prepared, [win])
  assert.equal(path.isAbsolute(f.indexHtml), true)
  assert.deepEqual(win.loaded, [f.indexHtml, { query: { pop: 'ji' } }])
  assert.deepEqual(plain(win.options), {
    x: 580, y: 230, width: 960, height: 720, minWidth: 420, minHeight: 320,
    title: 'kuma · ji', icon: 'app-icon', backgroundColor: '#123456', show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, spellcheck: false },
  })
  assert.equal(Object.hasOwn(win.options.webPreferences, 'webviewTag'), false)
  assert.equal(win.menu, null)
  assert.deepEqual(plain(win.openHandler()), { action: 'deny' })
  let prevented = 0
  win.webContents.events.get('will-navigate')({ preventDefault: () => { prevented += 1 } })
  assert.equal(prevented, 1)
  assert.equal(win.webContents.events.has('page-title-updated'), false)
  assert.deepEqual(win.calls, [])
  win.emit('ready-to-show')
  assert.deepEqual(win.calls, ['show'])
})

test('开窗与关窗各广播一次名单到全部存活窗口，名单保持插入序', () => {
  const f = fixture()
  f.api.open('ji')
  const ji = f.created[2]
  for (const win of [f.main, f.other, ji]) assert.deepEqual(f.messages(win, pop.POP_LIST_CHANNEL), [['ji']])
  f.api.open('ji')
  assert.deepEqual(f.messages(f.main, pop.POP_LIST_CHANNEL), [['ji']])
  f.api.open('di')
  assert.deepEqual(plain(f.api.list()), ['ji', 'di'])
  ji.close()
  for (const win of [f.main, f.other]) {
    assert.deepEqual(f.messages(win, pop.POP_LIST_CHANNEL), [['ji'], ['ji', 'di'], ['di']])
  }
  assert.deepEqual(f.messages(f.created[3], pop.POP_LIST_CHANNEL), [['ji', 'di'], ['di']])
  assert.deepEqual(f.messages(f.main, pop.POP_CLOSED_CHANNEL), ['ji'])
})

test('广播遇到已销毁的接收端仍继续给其余窗口推名单', () => {
  const f = fixture()
  f.other.webContents.send = () => { throw new Error('window destroyed') }
  assert.equal(f.api.open('ji'), true)
  assert.deepEqual(f.messages(f.created[2], pop.POP_LIST_CHANNEL), [['ji']])
})

test('整体关闭清空名单并存边界，不发送玩家关窗事件', () => {
  const f = fixture()
  f.api.open('ji')
  f.api.open('di')
  f.api.closeAll()
  assert.deepEqual(plain(f.api.list()), [])
  assert.deepEqual(f.messages(f.main, pop.POP_CLOSED_CHANNEL), [])
  assert.deepEqual(f.messages(f.main, pop.POP_LIST_CHANNEL), [['ji'], ['ji', 'di'], ['di'], []])
  assert.equal(f.writes.length, 2)
  f.api.closeAll()
  assert.equal(f.writes.length, 2)
})

test('整体关闭的异步 closed 回调仍不发送玩家关窗事件', () => {
  const f = fixture()
  f.api.open('ji')
  const win = f.created[2]
  win.close = () => win.emit('close')
  f.api.closeAll()
  win.destroyed = true
  win.emit('closed')
  assert.deepEqual(plain(f.api.list()), [])
  assert.deepEqual(f.messages(f.main, pop.POP_CLOSED_CHANNEL), [])
})

test('边界按模块保存，离屏位置重开后居中，使用普通边界并恢复最大化', () => {
  const f = fixture()
  f.api.open('ji')
  const win = f.created[2]
  win.bounds = { x: 9000, y: 9000, width: 1000, height: 800 }
  win.maximized = true
  win.close()
  assert.deepEqual(f.writes, [['kuma.popWindow.ji', { ...win.bounds, isMaximized: true }]])
  f.api.open('ji')
  const reopened = f.created[3]
  assert.deepEqual(plain(reopened.bounds), { x: 560, y: 190, width: 1000, height: 800 })
  reopened.emit('ready-to-show')
  assert.deepEqual(reopened.calls, ['show', 'maximize'])
})

test('副屏位置保持不变，小尺寸钳到最小，workArea 右下边缘不算屏内', () => {
  const f = fixture()
  f.saved.set('kuma.popWindow.ji', { x: -1200, y: 100, width: 1, height: 2 })
  f.api.open('ji')
  assert.deepEqual(plain(f.created[2].bounds), { x: -1200, y: 100, width: 420, height: 320 })
  for (const [id, x, y] of [['di', 2020, 50], ['ru', 100, 1130]]) {
    f.saved.set(pop.POP_WINDOW_BOUNDS_KEY(id), { x, y })
    f.api.open(id)
    assert.deepEqual(plain(f.created.at(-1).bounds), { x: 580, y: 230, width: 960, height: 720 })
  }
})

test('隐藏和恢复保留弹出名单，恢复用 showInactive 且不报关窗', () => {
  const f = fixture()
  f.api.open('ji')
  f.api.open('di')
  f.api.hideAll()
  f.api.showAll()
  for (const win of f.created.slice(2)) assert.deepEqual(win.calls, ['hide', 'showInactive'])
  assert.deepEqual(plain(f.api.list()), ['ji', 'di'])
  assert.deepEqual(f.messages(f.main, pop.POP_CLOSED_CHANNEL), [])
  assert.equal(f.writes.length, 0)
})

test('托盘只在实际收起主窗时隐藏弹出窗，恢复主窗时带回弹出窗', () => {
  const f = fixture(), settings = new Map(), appEvents = new Map()
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../dist/main/tray.js', import.meta.url), 'utf8'), {
    module, exports: module.exports,
    require: (id) => {
      if (id === 'electron') return {
        app: { on: (name, handler) => appEvents.set(name, handler) },
        Menu: { buildFromTemplate: (template) => template },
        Tray: class { on() {} setContextMenu() {} setToolTip() {} },
      }
      if (id === 'fs') return { existsSync: () => true }
      if (id === 'path') return path
      if (id === './env') return { ROOT: fileURLToPath(new URL('..', import.meta.url)) }
      if (id === '../shared/env-names') return { readEnv: () => undefined }
      if (id === './hotkeys') return { restoreFromBoss: () => false }
      if (id === './config') return { get: (key, fallback) => settings.get(key) ?? fallback }
      if (id === './crash-log') return { safeConsole: (...args) => assert.fail(args.join(' ')) }
      throw new Error(`unexpected require ${id}`)
    },
  })
  const tray = module.exports
  tray.installTray(() => f.main)
  tray.setTrayPopWindows(f.api)
  f.api.open('ji')
  const win = f.created[2]
  tray.handleWindowMinimize(f.main)
  assert.deepEqual(win.calls, [])
  settings.set('kuma.tray.minimizeToTray', true)
  tray.handleWindowMinimize(f.main)
  assert.deepEqual(f.main.calls, ['hide'])
  assert.deepEqual(win.calls, ['hide'])
  f.main.isVisible = () => false
  f.main.minimized = true
  tray.showMainWindow()
  assert.deepEqual(f.main.calls, ['hide', 'show', 'restore', 'focus'])
  assert.deepEqual(win.calls, ['hide', 'showInactive'])
  appEvents.get('before-quit')()
  tray.handleWindowMinimize(f.main)
  assert.deepEqual(win.calls, ['hide', 'showInactive'])
  assert.deepEqual(f.messages(f.main, pop.POP_CLOSED_CHANNEL), [])
})

test('五个 IPC 处理器先拒绝游戏及其他窗口 sender，零副作用', () => {
  const f = fixture()
  f.api.open('ji')
  const win = f.created[2]
  const snapshot = () => plain({ count: f.created.length, writes: f.writes,
    list: f.api.list(), windows: f.created.map((item) => ({ calls: item.calls, sent: item.sent })) })
  const before = snapshot()
  assert.equal(f.handlers.size, 5)
  for (const sender of [{ getType: () => 'webview' }, f.other.webContents]) {
    for (const [channel, arg] of [
      [pop.POP_OPEN_CHANNEL, 'di'], [pop.POP_CLOSE_CHANNEL, 'ji'],
      [pop.POP_FOCUS_CHANNEL, 'ji'], [pop.POP_LIST_CHANNEL],
      [pop.POP_RELAY_CHANNEL, { to: 'ji', kind: 'select', payload: 1 }],
    ]) assert.equal(f.invoke(channel, sender, arg), false)
  }
  assert.deepEqual(snapshot(), before)
  assert.equal(f.api.isKumaSender(f.main.webContents), true)
  assert.equal(f.api.isKumaSender(win.webContents), true)
  assert.equal(f.api.isKumaSender(f.other.webContents), false)
})

test('主窗和弹出窗可调用开、聚焦、名单及幂等关闭 IPC', () => {
  const f = fixture()
  assert.equal(f.invoke(pop.POP_OPEN_CHANNEL, f.main.webContents, 'ji'), true)
  const win = f.created[2]
  assert.equal(f.invoke(pop.POP_OPEN_CHANNEL, win.webContents, 'di'), true)
  assert.equal(f.invoke(pop.POP_FOCUS_CHANNEL, win.webContents, 'di'), true)
  assert.deepEqual(plain(f.invoke(pop.POP_LIST_CHANNEL, win.webContents)), ['ji', 'di'])
  assert.equal(f.invoke(pop.POP_CLOSE_CHANNEL, f.main.webContents, 'ji'), true)
  assert.equal(f.invoke(pop.POP_CLOSE_CHANNEL, f.main.webContents, 'ji'), true)
  assert.equal(f.api.close('qn'), true)
  assert.equal(f.api.isKumaSender(win.webContents), false)
})

test('relay 双向转发 kind 与原 payload，目标缺失或已销毁及空 kind 返回 false', () => {
  const f = fixture()
  const request = { to: 'ji', kind: 'select', payload: { id: 7 } }
  assert.equal(f.invoke(pop.POP_RELAY_CHANNEL, f.main.webContents, request), false)
  f.api.open('ji')
  const win = f.created[2]
  let delivered
  const send = win.webContents.send
  win.webContents.send = (channel, value) => { delivered = value; send(channel, value) }
  assert.equal(f.invoke(pop.POP_RELAY_CHANNEL, f.main.webContents, request), true)
  assert.equal(delivered.payload, request.payload)
  assert.deepEqual(f.messages(win, pop.POP_RELAY_EVENT), [{ kind: 'select', payload: { id: 7 } }])
  assert.equal(f.invoke(pop.POP_RELAY_CHANNEL, win.webContents, { to: 'main', kind: 'back', payload: null }), true)
  assert.deepEqual(f.messages(f.main, pop.POP_RELAY_EVENT), [{ kind: 'back', payload: null }])
  for (const raw of [null, {}, { ...request, kind: '' }, { ...request, kind: 3 }, { ...request, to: 'yu' }]) {
    assert.equal(f.invoke(pop.POP_RELAY_CHANNEL, f.main.webContents, raw), false)
  }
  win.destroyed = true
  assert.equal(f.invoke(pop.POP_RELAY_CHANNEL, f.main.webContents, request), false)
  f.clearMain()
  assert.equal(f.invoke(pop.POP_RELAY_CHANNEL, win.webContents, { to: 'main', kind: 'back' }), false)
})
