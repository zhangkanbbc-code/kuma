import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createGameAudioSettingsBridge, GAME_AUDIO_SETTINGS_CHANNEL } =
  require('../assets/preload/game-audio-settings-bridge.js')
const { gameAudioSettingsPayload, installGameAudioPush } = require('../dist/main/game-audio-push.js')
const initial = { volume: 1, voiceVolume: 1, bgmVolume: 1, mode: 'all' }

test('缓存桥原样返回 initial，推送后整份替换，非对象不覆盖', () => {
  const ipc = new EventEmitter()
  const bridge = createGameAudioSettingsBridge({ initial, ipc, channel: GAME_AUDIO_SETTINGS_CHANNEL })
  assert.equal(bridge.get(), initial)
  const next = { volume: '0.3' }
  ipc.emit(GAME_AUDIO_SETTINGS_CHANNEL, {}, next)
  assert.equal(bridge.get(), next)
  assert.equal(bridge.get().mode, undefined, '替换不能变成合并')
  for (const invalid of [null, undefined, false, 3, 'bad', () => {}]) {
    ipc.emit(GAME_AUDIO_SETTINGS_CHANNEL, {}, invalid)
    assert.equal(bridge.get(), next)
  }
})

test('缓存桥 get 一千次也不触发任何字段读取器', () => {
  let reads = 0
  const cached = Object.defineProperty({}, 'volume', { get: () => { reads++; return 1 } })
  const bridge = createGameAudioSettingsBridge({
    initial: cached, ipc: new EventEmitter(), channel: GAME_AUDIO_SETTINGS_CHANNEL,
  })
  for (let i = 0; i < 1000; i++) assert.equal(bridge.get(), cached)
  assert.equal(reads, 0)
})

test('主进程 payload 只读四键及默认值，保留原始值不钳制', () => {
  const calls = []
  const values = ['0.3', 9, -2, 'unknown']
  const payload = gameAudioSettingsPayload((key, fallback) => {
    calls.push([key, fallback])
    return values[calls.length - 1]
  })
  assert.deepEqual(calls, [
    ['kuma.gameAudio.volume', 1], ['kuma.gameAudio.voiceVolume', 1],
    ['kuma.gameAudio.bgmVolume', 1], ['kuma.gameAudio.mode', 'all'],
  ])
  assert.deepEqual(payload, { volume: '0.3', voiceVolume: 9, bgmVolume: -2, mode: 'unknown' })
})

const mountPush = () => {
  const config = new EventEmitter()
  const values = new Map()
  config.get = (key, fallback) => values.has(key) ? values.get(key) : fallback
  config.set = (key, value) => { values.set(key, value); config.emit('config.set', key, value) }
  const received = [[], []]
  const frames = received.map((messages) => ({ send: (...args) => messages.push(args) }))
  const game = { isDestroyed: () => false, mainFrame: { framesInSubtree: frames } }
  let current = game
  installGameAudioPush({ config, gameWebContents: () => current })
  return { config, received, frames, game, setCurrent: (value) => { current = value } }
}

test('音量变更与 restore 各给两帧恰好一份四键 payload，无关键不推', () => {
  const { config, received } = mountPush()
  config.set('kuma.cache.path', 'unused')
  assert.deepEqual(received, [[], []])
  config.set('kuma.gameAudio.volume', 0.3)
  const expected = [GAME_AUDIO_SETTINGS_CHANNEL, { ...initial, volume: 0.3 }]
  assert.deepEqual(received, [[expected], [expected]])
  config.emit('config.restore')
  assert.deepEqual(received, [[expected, expected], [expected, expected]])
})

test('没有游戏 webContents 或已销毁时静默跳过', () => {
  const { config, received, game, setCurrent } = mountPush()
  for (const absent of [null, undefined]) {
    setCurrent(absent)
    assert.doesNotThrow(() => config.set('kuma.gameAudio.volume', 0.3))
    assert.doesNotThrow(() => config.emit('config.restore'))
  }
  setCurrent(game)
  game.isDestroyed = () => true
  assert.doesNotThrow(() => config.set('kuma.gameAudio.volume', 0.4))
  assert.deepEqual(received, [[], []])
})

test('一帧导航走导致 send 抛错，仍然送达另一帧', () => {
  const { config, received, frames } = mountPush()
  frames[0].send = () => { throw new Error('frame navigated') }
  assert.doesNotThrow(() => config.set('kuma.gameAudio.volume', 0.3))
  assert.deepEqual(received, [[], [[GAME_AUDIO_SETTINGS_CHANNEL, { ...initial, volume: 0.3 }]]])
})

const preload = readFileSync(new URL('../assets/preload/webview-preload.js', import.meta.url), 'utf8')
const mountPreload = ({ threshold, observeThrows = false } = {}) => {
  const ipc = new EventEmitter()
  const sends = []
  const reads = []
  let bridge, observer, observed
  let hooks = 0
  ipc.send = (...args) => sends.push(args)
  const context = {
    require: (id) => {
      if (id === '@electron/remote') return { require: () => ({
        get: (key, fallback) => { reads.push(key); return fallback },
      }) }
      if (id === 'electron') return { ipcRenderer: ipc, contextBridge: {
        exposeInMainWorld: (_name, value) => { bridge = value },
        executeInMainWorld: () => { hooks++ },
      } }
      if (id === '../../dist/shared/env-names') return { readEnv: () => threshold }
      if (id === './game-audio-settings-bridge') return require('../assets/preload/game-audio-settings-bridge.js')
      if (id === './preview-duck') return require('../assets/preload/preview-duck.js')
      if (id === './resource-hack') return { createResourceResolver: () => () => {} }
      return new Proxy({}, { get: () => () => {} })
    },
    PerformanceObserver: class {
      constructor(callback) { observer = callback }
      observe(options) {
        observed = options.entryTypes
        if (observeThrows) throw new Error('unsupported')
      }
    },
    location: { pathname: '/kcs2/index.html', host: 'private.example', search: '?token=secret' },
    console,
  }
  context.window = {}
  context.window.top = context.window
  vm.runInNewContext(preload, context)
  return { bridge, ipc, sends, reads, observer, observed, hooks }
}

test('preload 音量入口不含 config.get/remote，且一千次实际调用不增加配置读取', () => {
  const body = preload.match(/getGameAudioSettings: \(\) => \{([\s\S]*?)\n  \},/)?.[1]
  assert.ok(body)
  assert.doesNotMatch(body, /config\.get|remote/)
  const { bridge, ipc, reads } = mountPreload()
  assert.deepEqual(reads, ['kuma.gameAudio.volume', 'kuma.gameAudio.voiceVolume', 'kuma.gameAudio.bgmVolume', 'kuma.gameAudio.mode'])
  const loadedReads = reads.length
  for (let i = 0; i < 1000; i++) assert.equal(bridge.getGameAudioSettings().volume, 1)
  assert.equal(reads.length - loadedReads, 0)
  ipc.emit(GAME_AUDIO_SETTINGS_CHANNEL, {}, { volume: '0.3', voiceVolume: 5, bgmVolume: -2, mode: 'voice' })
  assert.deepEqual({ ...bridge.getGameAudioSettings() }, { volume: 0.3, voiceVolume: 2, bgmVolume: 0, mode: 'voice' })
  ipc.emit('kuma:preview-audio-duck', {}, true)
  assert.equal(bridge.getGameAudioSettings().volume, 0)
  ipc.emit('kuma:preview-audio-duck', {}, false)
  assert.equal(bridge.getGameAudioSettings().volume, 0.3)
  ipc.emit(GAME_AUDIO_SETTINGS_CHANNEL, {}, { volume: 'bad', voiceVolume: NaN, bgmVolume: Infinity, mode: 'bad' })
  assert.deepEqual({ ...bridge.getGameAudioSettings() }, initial)
  assert.equal(reads.length - loadedReads, 0)
})

test('游戏 longtask 按阈值上报归因与 pathname，observe 抛错不阻断 preload', () => {
  for (const [threshold, limit] of [[undefined, 50], ['bad', 50], ['0', 50], ['-1', 50], ['80', 80]]) {
    const { observer, sends, observed } = mountPreload({ threshold })
    assert.deepEqual([...observed], ['longtask'])
    observer({ getEntries: () => [limit - 1, limit].map((duration) => ({
      duration, attribution: [{ containerType: 'iframe', containerId: 'game', containerName: 'game', containerSrc: '', name: 'self' }],
    })) })
    assert.equal(sends.length, 1)
    assert.equal(sends[0][0], 'kuma:perf')
    assert.deepEqual({ ...sends[0][1] }, {
      source: 'game', scope: 'longtask', ms: limit,
      detail: 'iframe#game · game · self @ /kcs2/index.html',
    })
  }
  const mounted = mountPreload({ observeThrows: true })
  assert.ok(mounted.hooks > 0)
  assert.equal(mounted.bridge.getGameAudioSettings().volume, 1)
})
