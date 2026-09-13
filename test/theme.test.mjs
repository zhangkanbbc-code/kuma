import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import theme from '../dist/shared/theme.js'

const { THEME_CONFIG_KEY, THEME_MODES, THEME_MODE_LABEL, THEME_CHANNEL, THEME_GET_CHANNEL,
  THEME_BASE_CONFIG_KEY, DEFAULT_THEME_BASE, NEUTRAL_TOKENS, deriveNeutrals,
  normalizeThemeMode, resolveTheme } = theme

test('主题档位与玩家标签保持三选一，未知值严格回深色', () => {
  assert.deepEqual(THEME_MODES, ['dark', 'light', 'system'])
  assert.deepEqual(THEME_MODE_LABEL, { dark: '深色', light: '浅色', system: '跟随系统' })
  for (const mode of THEME_MODES) assert.equal(normalizeThemeMode(mode), mode)
  for (const raw of [undefined, null, false, true, 0, 1, {}, [], 'garbage', '', 'Dark', 'LIGHT', 'SYSTEM', ' light ']) {
    assert.equal(normalizeThemeMode(raw), 'dark')
  }
})

test('跟随系统按系统偏好解析，固定档不受系统影响', () => {
  for (const dark of [true, false]) {
    assert.equal(resolveTheme('system', dark), dark ? 'dark' : 'light')
    assert.equal(resolveTheme('dark', dark), 'dark')
    assert.equal(resolveTheme('light', dark), 'light')
  }
})

const bootCode = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/theme-boot.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['electron', '@electron/remote'],
}).outputFiles[0].text

const renderer = ({ mode = 'dark', base = '', dark = true, bridge } = {}) => {
  const listeners = new Map(), mediaListeners = new Set(), writes = []
  let adds = 0, removes = 0
  const media = {
    matches: dark,
    addEventListener: (event, fn) => { assert.equal(event, 'change'); adds++; mediaListeners.add(fn) },
    removeEventListener: (event, fn) => { assert.equal(event, 'change'); removes++; mediaListeners.delete(fn) },
  }
  const config = {
    get: (key, fallback) => {
      assert.ok([THEME_CONFIG_KEY, THEME_BASE_CONFIG_KEY].includes(key))
      assert.equal(fallback, key === THEME_CONFIG_KEY ? 'dark' : '')
      return key === THEME_CONFIG_KEY ? mode : base
    },
    set: (...args) => writes.push(args),
  }
  const document = { documentElement: { dataset: {}, style: {
    setProperty(name, value) { this[name] = value },
    removeProperty(name) { delete this[name] },
  } } }
  const module = { exports: {} }
  vm.runInNewContext(bootCode, {
    module, exports: module.exports, document, window: { kumaTheme: bridge },
    matchMedia: query => { assert.equal(query, '(prefers-color-scheme: dark)'); return media },
    require: id => {
      assert.ok(!bridge, '浏览窗不应访问 Node 或 remote')
      if (id === '@electron/remote') return { require: id => { assert.equal(id, './config'); return config } }
      if (id === 'electron') return { ipcRenderer: { on: (channel, fn) => listeners.set(channel, fn) } }
      throw Error(`unexpected require ${id}`)
    },
  })
  return { ...module.exports, document, writes, listeners,
    value: () => document.documentElement.dataset.theme,
    counts: () => [adds, removes, mediaListeners.size],
    system: dark => { media.matches = dark; for (const fn of mediaListeners) fn({ matches: dark }) },
  }
}

test('初值立即应用，推送生效，system 只挂一次监听且离开时摘掉', () => {
  const r = renderer({ mode: 'light' })
  r.installThemeBoot()
  assert.equal(r.value(), 'light')
  assert.deepEqual(r.counts(), [0, 0, 0])
  r.listeners.get(THEME_CHANNEL)({}, { mode: 'system', base: '' })
  assert.equal(r.value(), 'dark')
  r.applyThemeMode('system')
  assert.deepEqual(r.counts(), [1, 0, 1])
  r.system(false)
  assert.equal(r.value(), 'light')
  r.applyThemeMode('dark')
  assert.equal(r.value(), 'dark')
  assert.deepEqual(r.counts(), [1, 1, 0])
  r.system(false)
  assert.equal(r.value(), 'dark')
  r.applyThemeMode('system')
  assert.deepEqual(r.counts(), [2, 1, 1])
  r.applyThemeMode(undefined)
  assert.equal(r.value(), 'dark')
  assert.deepEqual(r.counts(), [2, 2, 0])
})

test('setter 保存规范档位并立即更新本窗口', () => {
  const r = renderer({ dark: false })
  for (const [raw, saved, visible] of [['light', 'light', 'light'], ['system', 'system', 'light'], ['LIGHT', 'dark', 'dark']]) {
    r.setThemeMode(raw)
    assert.deepEqual(r.writes.at(-1), [THEME_CONFIG_KEY, saved])
    assert.equal(r.value(), visible)
  }
})

test('自定义底色逐键应用，两枚默认底色与清空均彻底撤销覆盖', () => {
  const r = renderer({ mode: 'system', base: '#123456' })
  r.installThemeBoot()
  const style = r.document.documentElement.style
  const customKeys = () => Object.keys(style).filter(key => key.startsWith('--')).sort()
  assert.deepEqual(customKeys(), NEUTRAL_TOKENS.map(key => '--' + key).sort())
  for (const key of NEUTRAL_TOKENS) assert.equal(style['--' + key], deriveNeutrals('#123456')[key])
  r.system(false)
  assert.equal(r.value(), 'dark')
  for (const [ground, base] of Object.entries(DEFAULT_THEME_BASE)) {
    r.setThemeBase('#abcdef')
    r.setThemeBase(base)
    assert.equal(r.value(), ground)
    assert.deepEqual(customKeys(), [])
  }
  r.setThemeBase('#ABCDEF')
  assert.deepEqual(r.writes.at(-1), [THEME_BASE_CONFIG_KEY, '#abcdef'])
  assert.equal(r.value(), 'light')
  r.clearThemeBase()
  assert.deepEqual(r.writes.at(-1), [THEME_BASE_CONFIG_KEY, ''])
  assert.deepEqual(customKeys(), [])
  assert.equal(r.value(), 'light')
  r.system(true)
  assert.equal(r.value(), 'dark')
  r.applyTheme({ mode: 'light', base: '#202020' })
  assert.equal(r.value(), 'dark')
  assert.deepEqual(r.writes.at(-1), [THEME_BASE_CONFIG_KEY, ''], '预览不落盘')
  r.applyTheme({ mode: 'dark', base: 'invalid' })
  assert.deepEqual(customKeys(), [])
})

test('浏览窗异步初值应用前隐藏内容，期间的新推送不会被旧初值覆盖', async () => {
  for (const pushed of [false, true]) {
    let finish, listener
    const r = renderer({ bridge: {
      get: () => new Promise(resolve => { finish = resolve }),
      onChange: fn => { listener = fn },
    } })
    r.installThemeBoot()
    assert.equal(r.document.documentElement.style.visibility, 'hidden')
    if (pushed) listener({ mode: 'light', base: '#ffffff' })
    finish({ mode: 'dark', base: '' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(r.value(), pushed ? 'light' : 'dark')
    assert.equal(r.document.documentElement.style.visibility, undefined)
    listener({ mode: 'light', base: '' })
    assert.equal(r.value(), 'light')
  }
})

test('主进程广播两枚主题键的完整状态，六窗底色同步并跟随系统更新', () => {
  const handlers = new Map(), events = new Map(), sent = [], backgrounds = []
  let mode = 'light', base = '', updated
  const nativeTheme = { shouldUseDarkColors: true, on: (name, fn) => { assert.equal(name, 'updated'); updated = fn } }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../dist/main/theme-push.js', import.meta.url), 'utf8'), {
    module, exports: module.exports,
    require: id => {
      if (id === '../shared/theme') return theme
      if (id === './config') return {
        get: key => {
          assert.ok([THEME_CONFIG_KEY, THEME_BASE_CONFIG_KEY].includes(key))
          return key === THEME_CONFIG_KEY ? mode : base
        },
        on: (event, fn) => events.set(event, fn),
      }
      if (id === 'electron') return {
        nativeTheme,
        ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
        BrowserWindow: { getAllWindows: () => Array.from({ length: 6 }, (_, i) => ({
          setBackgroundColor: color => backgrounds.push([i, color]),
          webContents: { send: (...args) => sent.push([i, ...args]) },
        })) },
      }
      throw Error(`unexpected require ${id}`)
    },
  })
  module.exports.installThemePush()
  const state = () => JSON.parse(JSON.stringify(handlers.get(THEME_GET_CHANNEL)()))
  assert.deepEqual(state(), { mode: 'light', base: '' })
  assert.equal(module.exports.themeBackgroundColor(), DEFAULT_THEME_BASE.light)
  events.get('config.set')('kuma.other', 'dark')
  assert.deepEqual(sent, [])
  for (const [raw, expected] of [['system', 'system'], ['LIGHT', 'dark']]) {
    mode = raw
    events.get('config.set')(THEME_CONFIG_KEY, raw)
    assert.deepEqual(JSON.parse(JSON.stringify(sent.splice(0))), Array.from({ length: 6 }, (_, i) => [i, THEME_CHANNEL, { mode: expected, base: '' }]))
    assert.deepEqual(state(), { mode: expected, base: '' })
    assert.deepEqual(backgrounds.splice(0), Array.from({ length: 6 }, (_, i) => [i, DEFAULT_THEME_BASE.dark]))
  }
  base = '#ABCDEF'
  events.get('config.set')(THEME_BASE_CONFIG_KEY, base)
  assert.deepEqual(state(), { mode: 'dark', base: '#abcdef' })
  assert.deepEqual(backgrounds.splice(0), Array.from({ length: 6 }, (_, i) => [i, '#abcdef']))
  assert.equal(sent.splice(0).length, 6)
  assert.equal(module.exports.themeBackgroundColor(), '#abcdef')
  mode = 'system'
  base = ''
  nativeTheme.shouldUseDarkColors = false
  updated()
  assert.deepEqual(backgrounds.splice(0), Array.from({ length: 6 }, (_, i) => [i, DEFAULT_THEME_BASE.light]))
  assert.equal(sent.splice(0).length, 6)
  mode = 'dark'
  updated()
  assert.deepEqual(backgrounds, [])
})

test('浏览窗桥只暴露主题读取和订阅，使用异步 invoke 并剥离 IPC 事件', async () => {
  let bridge, listener
  vm.runInNewContext(fs.readFileSync(new URL('../dist/main/theme-preload.js', import.meta.url), 'utf8'), {
    exports: {},
    require: id => {
      if (id === '../shared/theme') return theme
      if (id === 'electron') return {
        contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'kumaTheme'); bridge = api } },
        ipcRenderer: {
          invoke: channel => { assert.equal(channel, THEME_GET_CHANNEL); return Promise.resolve({ mode: 'light', base: '' }) },
          on: (channel, fn) => { assert.equal(channel, THEME_CHANNEL); listener = fn },
        },
      }
      throw Error(`unexpected require ${id}`)
    },
  })
  assert.deepEqual(Object.keys(bridge), ['get', 'onChange'])
  assert.deepEqual(await bridge.get(), { mode: 'light', base: '' })
  const received = []
  bridge.onChange((...args) => received.push(args))
  listener({ sender: 'opaque' }, { mode: 'system', base: '#123456' })
  assert.deepEqual(received, [[{ mode: 'system', base: '#123456' }]])
})
