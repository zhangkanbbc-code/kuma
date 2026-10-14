import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compiledMain } from './helpers/main-perf.mjs'

const require = createRequire(import.meta.url)
const { MOD_NIGHT_DEFAULT, findModFilePathAsync } = require('../assets/preload/kcs-resource-path.js')
const { MOD_NIGHT_SETTINGS_CHANNEL, modNightSettingsPayload, createModNightSettingsBridge } =
  require('../assets/preload/mod-night-settings-bridge.js')
const { installModNightPush } = require('../dist/main/mod-night-push.js')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('设置载荷共用三个默认值，缓存桥收到推送立即替换', () => {
  const reads = []
  const initial = modNightSettingsPayload((key, fallback) => { reads.push([key, fallback]); return fallback })
  assert.deepEqual(initial, MOD_NIGHT_DEFAULT)
  assert.deepEqual(reads, [
    ['kuma.mod.night.enabled', false], ['kuma.mod.night.start', '18:00'], ['kuma.mod.night.end', '06:00'],
  ])
  const ipc = new EventEmitter()
  const bridge = createModNightSettingsBridge({ initial, ipc })
  assert.equal(bridge.get(), initial)
  const next = { enabled: true, start: '20:00', end: '05:00' }
  ipc.emit(MOD_NIGHT_SETTINGS_CHANNEL, {}, next)
  assert.equal(bridge.get(), next)
})

test('三键变更与 restore 逐帧推送，无关键不推；导航走的帧不阻断其他帧', () => {
  const config = new EventEmitter()
  const values = new Map()
  config.get = (key, fallback) => values.has(key) ? values.get(key) : fallback
  const received = []
  let current = { isDestroyed: () => false, mainFrame: { framesInSubtree: [
    { send: () => { throw new Error('frame navigated') } },
    { send: (...args) => received.push(args) },
  ] } }
  installModNightPush({ config, gameWebContents: () => current })
  config.emit('config.set', 'kuma.cache.path')
  assert.equal(received.length, 0)
  for (const [key, value] of [['enabled', true], ['start', '21:30'], ['end', '07:15']]) {
    values.set(`kuma.mod.night.${key}`, value)
    config.emit('config.set', `kuma.mod.night.${key}`)
    assert.deepEqual(received.at(-1), [MOD_NIGHT_SETTINGS_CHANNEL, modNightSettingsPayload(config.get)])
  }
  config.emit('config.restore')
  assert.equal(received.length, 4)
  assert.deepEqual(received[3], received[2])
  current = { isDestroyed: () => true }
  config.emit('config.restore')
  current = null
  config.emit('config.set', 'kuma.mod.night.enabled')
  assert.equal(received.length, 4)
})

test('真实图片解析器读配置一次；本机到点、改设置、关闭后立即按新时段查找', (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-push-'))
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }))
  const pathname = '/kcs2/img/a.png'
  for (const root of ['KanColle', 'KanColle-白天', 'KanColle-夜间']) {
    const file = path.join(cacheDir, root, '/kcs2/img/a.hack.png')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, root)
  }
  const ipc = new EventEmitter()
  const reads = []
  let hour = 17
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../assets/preload/resource-hack.js', import.meta.url), 'utf8'), {
    module,
    Date: class extends Date { constructor() { super(2026, 9, 14, hour, 0) } },
    require: (id) => id === 'electron' ? { ipcRenderer: ipc } : require(`../assets/preload/${id}`),
  })
  const remote = {
    getGlobal: () => cacheDir,
    require: () => ({ get: (key, fallback) => {
      reads.push(key)
      return key === 'kuma.cache.path' ? cacheDir : key === 'kuma.mod.night.enabled' ? true : fallback
    } }),
  }
  const lookup = module.exports.createResourceResolver(remote)
  assert.deepEqual(reads, ['kuma.cache.path', 'kuma.mod.night.enabled', 'kuma.mod.night.start', 'kuma.mod.night.end'])
  const url = `https://fixture${pathname}`
  assert.equal(lookup(url), `kuma-cache://resource-day${pathname}`)
  hour = 18
  assert.equal(lookup(url), `kuma-cache://resource-night${pathname}`)
  ipc.emit(MOD_NIGHT_SETTINGS_CHANNEL, {}, { enabled: true, start: '20:00', end: '06:00' })
  assert.equal(lookup(url), `kuma-cache://resource-day${pathname}`)
  ipc.emit(MOD_NIGHT_SETTINGS_CHANNEL, {}, MOD_NIGHT_DEFAULT)
  for (let i = 0; i < 1000; i++) assert.equal(lookup(url), `kuma-cache://resource${pathname}`)
  assert.equal(reads.length, 4)
})

test('关闭时不碰时段目录；空树各只检查一次，切换和上百张图片均无 accessSync', () => {
  const module = { exports: {} }
  const directories = []
  let accesses = 0
  vm.runInNewContext(fs.readFileSync(new URL('../assets/preload/kcs-resource-path.js', import.meta.url), 'utf8'), {
    module, URL,
    require: (id) => id === 'path' ? path : {
      readdirSync: (root) => { directories.push(root); return [] },
      accessSync: () => { accesses++; throw new Error('empty') },
    },
  })
  let period = null
  const lookup = module.exports.createResourceLookup('C:\\fixture', { period: () => period })
  const batch = () => {
    for (let i = 0; i < 200; i++) assert.equal(lookup(`https://fixture/kcs2/img/${i}.png`), undefined)
  }
  batch()
  assert.deepEqual(directories, [path.join('C:\\fixture', 'KanColle')])
  for (const next of ['day', 'night', null, 'day', 'night']) { period = next; batch() }
  assert.deepEqual(directories, ['KanColle', 'KanColle-白天', 'KanColle-夜间'].map(root => path.join('C:\\fixture', root)))
  assert.equal(accesses, 0)
})

const mountResource = (cacheDir) => {
  let request, serve
  let hour = 12
  const values = { 'kuma.cache.path': cacheDir, 'kuma.mod.night.enabled': true }
  const config = { get: (key, fallback) => key in values ? values[key] : fallback }
  const ses = {
    webRequest: { onBeforeRequest: (_filter, fn) => { request = fn } },
    protocol: { handle: (_scheme, fn) => { serve = fn } },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiledMain('kcs-resource'), {
    module, exports: module.exports, URL, Response, Headers, performance, console,
    Date: class extends Date { constructor() { super(2026, 9, 14, hour, 0) } },
    require: (id) => {
      if (id === 'electron') return { session: { defaultSession: ses }, net: {
        fetch: async (url) => new Response(fs.readFileSync(fileURLToPath(url))),
      } }
      if (['fs', 'path', 'url'].includes(id)) return require(id)
      if (id === './config') return config
      if (id === './env') return { ROOT, DEFAULT_CACHE_PATH: cacheDir }
      if (id === './perf-time') return { reportMainTiming: () => {} }
      if (id === './game-sender') return { isGameResourceRequest: async () => false }
      if (id === '../shared/voice-request-gate') return { createVoiceRequestGate: () => ({}) }
      if (path.isAbsolute(id)) return require(id)
      return {}
    },
  })
  module.exports.registerKcsResourceProtocol()
  return {
    api: module.exports, serve, values, setHour: (value) => { hour = value },
    request: async (pathname, resourceType) => {
      let result
      await request({ url: `https://fixture${pathname}`, resourceType, webContentsId: 1 }, (response) => { result = response })
      return { ...result }
    },
  }
}

test('白天/夜间打开 handler 先建目录；成功与失败返回原有形状', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-open-'))
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }))
  const h = mountResource(cacheDir)
  const handlers = new Map()
  let message = ''
  const opened = []
  const warnings = []
  const source = fs.readFileSync(new URL('../src/main/yu.ts', import.meta.url), 'utf8')
  const blocks = [...source.matchAll(/^ipcMain.handle\('yu:open-mod-(?:day|night)-dir', async \(\) => \{[\s\S]*?^\}\)/gm)]
  assert.equal(blocks.length, 2)
  vm.runInNewContext(blocks.map(match => match[0]).join('\n'), {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    ensureModDir: h.api.ensureModDir,
    shell: { openPath: async (dir) => {
      assert.equal(fs.statSync(dir).isDirectory(), true)
      opened.push(dir)
      return message
    } },
    console: { warn: (...args) => warnings.push(args) },
  })
  for (const [period, root] of [['day', 'KanColle-白天'], ['night', 'KanColle-夜间']]) {
    const handler = handlers.get(`yu:open-mod-${period}-dir`)
    const dir = path.join(cacheDir, root)
    message = ''
    assert.deepEqual({ ...await handler() }, { ok: true, path: dir, message: '' })
    fs.rmdirSync(dir)
    message = '无法打开'
    assert.deepEqual({ ...await handler() }, { ok: false, path: dir, message })
    assert.equal(opened.at(-1), dir)
  }
  assert.equal(warnings.length, 2)
})

test('webRequest 按本机时段重定向；协议只按主机名取文件，关闭后旧时段地址仍可供出', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-protocol-'))
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }))
  const h = mountResource(cacheDir)
  for (const [period, root] of [[null, 'KanColle'], ['day', 'KanColle-白天'], ['night', 'KanColle-夜间']]) {
    assert.equal(h.api.ensureModDir(period), path.join(cacheDir, root))
    const file = path.join(cacheDir, root, '/kcs2/style.hack.css')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, root)
  }
  for (const [hour, host, root] of [[12, 'resource-day', 'KanColle-白天'], [18, 'resource-night', 'KanColle-夜间']]) {
    h.setHour(hour)
    const url = `kuma-cache://${host}/kcs2/style.css`
    assert.deepEqual(await h.request('/kcs2/style.css', 'stylesheet'), { redirectURL: url })
    assert.equal(await (await h.serve({ url })).text(), root)
  }
  h.values['kuma.mod.night.enabled'] = false
  assert.deepEqual(await h.request('/kcs2/style.css', 'stylesheet'), { redirectURL: 'kuma-cache://resource/kcs2/style.css' })
  assert.equal(await (await h.serve({ url: 'kuma-cache://resource/kcs2/style.css' })).text(), 'KanColle')
  assert.equal(await (await h.serve({ url: 'kuma-cache://resource-day/kcs2/style.css' })).text(), 'KanColle-白天')
  assert.equal(await (await h.serve({ url: 'kuma-cache://resource-night/kcs2/style.css' })).text(), 'KanColle-夜间')
})

test('时段原文件优先于常驻覆盖；脚本只认覆盖；协议回退常驻并保留目录边界', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-mod-priority-'))
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }))
  const put = (root, rel, content) => {
    const file = path.join(cacheDir, root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }
  const dayOrigin = put('KanColle-白天', '/kcs2/test.js', 'day')
  const baseHack = put('KanColle', '/kcs2/test.hack.js', 'base')
  const h = mountResource(cacheDir)
  assert.equal(await findModFilePathAsync(cacheDir, '/kcs2/test.js', { period: 'day' }), dayOrigin)
  assert.equal(await findModFilePathAsync(cacheDir, '/kcs2/test.js', { period: 'day', overrideOnly: true }), baseHack)
  const scriptRequest = await h.request('/kcs2/test.js', 'script')
  assert.deepEqual(scriptRequest, { redirectURL: 'kuma-cache://resource-day/kcs2/test.js?override-only=1' })
  assert.equal(await (await h.serve({ url: scriptRequest.redirectURL })).text(), 'base')
  assert.equal(await (await h.serve({ url: 'kuma-cache://resource-day/kcs2/test.js' })).text(), 'day')
  fs.unlinkSync(dayOrigin)
  assert.equal(await (await h.serve({ url: 'kuma-cache://resource-day/kcs2/test.js' })).text(), 'base')
  const outsideName = `${path.basename(cacheDir)}-outside`
  const outsideFile = path.join(path.dirname(cacheDir), `${outsideName}.hack.css`)
  fs.writeFileSync(outsideFile, 'outside')
  t.after(() => fs.unlinkSync(outsideFile))
  const traversal = `/kcs2/%2e%2e%2f%2e%2e%2f%2e%2e%2f${outsideName}.css`
  for (const host of ['resource', 'resource-day', 'resource-night']) {
    assert.equal((await h.serve({ url: `kuma-cache://${host}${traversal}` })).status, 404)
  }
})
