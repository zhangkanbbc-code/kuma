import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'
import redaction from '../dist/shared/redact-detail.js'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const resourcePath = require('../assets/preload/kcs-resource-path.js')
const load = (name, modules) => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist', 'main', `${name}.js`), 'utf8'), {
    module, exports: module.exports, URL, Response, Headers, console, performance,
    require: (id) => {
      if (Object.hasOwn(modules, id)) return modules[id]
      if (id.startsWith('../shared/')) return require(path.join(root, 'dist', 'main', id))
      if (['fs', 'path', 'url', 'events', 'querystring'].includes(id)) return require(id)
      throw new Error(`unexpected require ${id}`)
    },
  })
  return module.exports
}

const uiFixture = () => {
  const windows = new Map()
  const api = load('kuma-sender', {
    electron: { BrowserWindow: { fromWebContents: (contents) => windows.get(contents) } }, './env': { ROOT: root },
  })
  const window = (page = 'index.html', type = 'window') => {
    const url = pathToFileURL(path.join(root, 'dist', 'renderer', page)).href + '?pop=book'
    const frame = { url }
    const contents = { getURL: () => frame.url, getType: () => type, isDestroyed: () => false, mainFrame: frame }
    windows.set(contents, { webContents: contents, isDestroyed: () => false })
    return { sender: contents, senderFrame: frame, reply() {} }
  }
  return { api, window }
}

test('两个权限处理器：只放本地窗口主帧的写剪贴板/通知，所有远程与未知权限拒绝', () => {
  const f = uiFixture()
  let check, request
  load('permissions', {
    electron: { session: { defaultSession: {
      setPermissionCheckHandler: (handler) => { check = handler },
      setPermissionRequestHandler: (handler) => { request = handler },
    } } }, './kuma-sender': f.api,
  }).installPermissionHandlers()
  const subjects = [f.window(), f.window('index.html'), f.window('ship-life.html'), f.window('browse.html')]
  const guest = f.window('index.html', 'webview')
  const remote = f.window(); remote.senderFrame.url = 'https://guide.example/'
  for (const event of [...subjects, guest, remote]) {
    for (const isMainFrame of [true, false]) {
      for (const permission of ['clipboard-sanitized-write', 'notifications', 'clipboard-read', 'deprecated-sync-clipboard-read',
        'media', 'geolocation', 'openExternal', 'fullscreen', 'pointerLock', 'unknown']) {
        const details = { isMainFrame, requestingUrl: event.senderFrame.url }
        const expected = subjects.includes(event) && isMainFrame && ['clipboard-sanitized-write', 'notifications'].includes(permission)
        assert.equal(check(event.sender, permission, 'file://', details), expected)
        let result
        request(event.sender, permission, (value) => { result = value }, details)
        assert.equal(result, expected)
      }
    }
  }
  assert.equal(check(subjects[0].sender, 'notifications', 'file://', { isMainFrame: true }), false)
  assert.equal(check(subjects[0].sender, 'notifications', 'https://ad.example', { isMainFrame: true, requestingUrl: 'https://ad.example/' }), false)
  assert.equal(check(null, 'notifications', 'file://', { isMainFrame: true }), false)
})

const protocolFixture = (cacheDir, overrides = {}) => {
  let handler, beforeRequest
  const fetched = [], remembered = []
  const modules = {
    electron: { session: { defaultSession: {
      protocol: { handle: (_scheme, callback) => { handler = callback } },
      webRequest: { onBeforeRequest: (_filter, callback) => { beforeRequest = callback } },
    } }, net: { fetch: async (url) => { fetched.push(url); return new Response(fs.readFileSync(fileURLToPath(url))) } } },
    './env': { ROOT: root, DEFAULT_CACHE_PATH: cacheDir }, './config': { get: (_key, fallback) => fallback },
    './perf-time': { reportMainTiming() {} }, './game-sender': { isGameResourceRequest: async () => false, setGameSenderId() {} },
    './game-api-broadcaster': { emit() {}, setCurrentBgm() {} },
    './bgm-archive': { rememberBgmHeard: (value) => { remembered.push(value); return false } },
    './voice-archive': { rememberVoiceHeard: (value) => { remembered.push(value); return false } },
    './ship-art-store': { rememberShipArtPath: () => false },
    './art-archive': { rememberArtSeen: () => false },
    './asset-archive': { rememberAssetSeen: (value) => { remembered.push(value); return false } },
    [path.join(root, 'assets', 'preload', 'kcs-resource-path')]: resourcePath,
    [path.join(root, 'assets', 'preload', 'mod-night-settings-bridge')]: require('../assets/preload/mod-night-settings-bridge.js'),
    ...overrides,
  }
  const api = load('kcs-resource', modules)
  api.registerKcsResourceProtocol()
  return { api, handler, beforeRequest, fetched, remembered }
}

const attacks = [
  ['..%2f', '/kcs2/..%2f..%2fsecret.png'],
  ['..%5c', '/kcs2/..%5c..%5csecret.png'],
  ['%2e%2e', '/kcs2/%2e%2e%2f%2e%2e%2fsecret.png'],
  ['盘符', '/kcs2/C:%5cWindows%5cwin.ini'],
  ['UNC', '/kcs2/%5c%5cserver%5cshare%5csecret.png'],
  ['时段兄弟根', '/kcs2/..%2f..%2fKanColle-夜间%2fkcs2%2fok.png'],
]

for (const [name, pathname] of attacks) {
  test(`preload、异步查找与协议都拒绝 ${name}，非空三根也不探测出界文件`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-security-'))
    try {
      for (const mod of ['KanColle', 'KanColle-白天', 'KanColle-夜间']) {
        fs.mkdirSync(path.join(dir, mod, 'kcs2'), { recursive: true })
        fs.writeFileSync(path.join(dir, mod, 'kcs2', 'ok.png'), mod)
      }
      fs.writeFileSync(path.join(dir, 'secret.png'), 'outside')
      fs.writeFileSync(path.join(dir, 'secret.hack.png'), 'outside hack')
      const original = fs.accessSync, asyncOriginal = fs.promises.access
      const probes = []
      fs.accessSync = (...args) => { probes.push(args[0]); return original(...args) }
      fs.promises.access = async (...args) => { probes.push(args[0]); return asyncOriginal(...args) }
      try {
        const h = protocolFixture(dir)
        for (const period of [null, 'day', 'night']) {
          const attempt = name === '时段兄弟根' && period === 'night' ? pathname.replace('夜间', '白天') : pathname
          const lookup = resourcePath.createResourceLookup(dir, { period: () => period })
          for (const includeOrigin of [false, true]) assert.equal(lookup(`https://x${attempt}`, includeOrigin), undefined)
          assert.equal(await resourcePath.findModFilePathAsync(dir, decodeURIComponent(attempt), { period }), undefined)
          assert.equal((await h.handler({ url: `kuma-cache://resource${period ? `-${period}` : ''}${attempt}` })).status, 404)
        }
        assert.equal(probes.length, 0, '拒绝必须发生在 access 之前')
        assert.equal(h.fetched.length, 0)
      } finally { fs.accessSync = original; fs.promises.access = asyncOriginal }
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}

test('协议保留常驻/白天/夜间优先级与 override-only，并独立拒绝根外查找结果', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-security-'))
  try {
    for (const mod of ['KanColle', 'KanColle-白天', 'KanColle-夜间']) {
      fs.mkdirSync(path.join(dir, mod, 'kcs2'), { recursive: true })
      fs.writeFileSync(path.join(dir, mod, 'kcs2', 'ok.png'), mod)
    }
    fs.writeFileSync(path.join(dir, 'KanColle', 'kcs2', 'ok.hack.png'), 'base hack')
    const h = protocolFixture(dir)
    for (const [period, expected] of [['', 'base hack'], ['-day', 'KanColle-白天'], ['-night', 'KanColle-夜间']]) {
      const response = await h.handler({ url: `kuma-cache://resource${period}/kcs2/ok.png` })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), expected)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    }
    assert.equal(await (await h.handler({ url: 'kuma-cache://resource-day/kcs2/ok.png?override-only=1' })).text(), 'base hack')
    const forged = protocolFixture(dir, {
      [path.join(root, 'assets', 'preload', 'kcs-resource-path')]: {
        ...resourcePath, findModFilePathAsync: async () => path.join(dir, 'secret.png'),
      },
    })
    assert.equal((await forged.handler({ url: 'kuma-cache://resource/kcs2/ok.png' })).status, 404)
    assert.equal(forged.fetched.length, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

const gameFixture = (entry = 'https://play.games.dmm.com/game/kancolle') => {
  const main = { url: entry, parent: null, sources: [], queries: 0,
    executeJavaScript: async function (script) {
      this.queries++
      return vm.runInNewContext(script, { document: { querySelectorAll: (selector) => {
        assert.equal(selector, 'iframe#game_frame, iframe#htmlWrap')
        return this.sources.map((src) => ({ src }))
      } } })
    } }
  const contents = { id: 17, mainFrame: main, getType: () => 'webview', isDestroyed: () => false }
  const api = load('game-sender', {
    electron: { webContents: { fromId: (id) => id === 17 ? contents : null } },
    './config': { get: () => entry },
  })
  api.setGameSenderId(17)
  const child = (url, parent = main) => ({ url, parent, sources: [], queries: 0, executeJavaScript: main.executeJavaScript })
  return { api, contents, main, child }
}

test('游戏门：父页指定的动态服务器帧可收货，第三方帧/伪造源/同形路径/旧页面不可收货', async () => {
  const f = gameFixture()
  const game = f.child('https://dynamic-game.example/kcs2/index.php?api_token=secret')
  f.main.sources.push(game.url)
  const ad = f.child('https://ad.example/widget', game)
  const forged = f.child('https://ad.example/kcs2/index.php')
  f.main.sources.push('https://ad.example/widget')
  const payload = 'https://dynamic-game.example/kcsapi/api_port/port'
  for (const frame of [game, ad, forged, f.main, null]) {
    assert.equal(await f.api.isGameApiSender({ sender: f.contents, senderFrame: frame }, payload, '/kcsapi/api_port/port'), frame === game)
  }
  assert.equal(await f.api.isGameApiSender({ sender: f.contents, senderFrame: game }, 'https://ad.example/kcsapi/api_port/port', '/kcsapi/api_port/port'), false)
  assert.equal(await f.api.isGameApiSender({ sender: f.contents, senderFrame: game }, payload, '/kcsapi/other'), false)
  assert.equal(await f.api.isGameApiSender({ sender: { ...f.contents, id: 18 }, senderFrame: game }, payload, '/kcsapi/api_port/port'), false)
  for (let i = 0; i < 20; i++) assert.equal(await f.api.isGameFrame(f.contents, game), true)
  assert.equal(f.main.queries, 2, '每个候选帧一次父 DOM 查询，资源热路径复用结果')
  game.url = 'https://ad.example/kcs2/index.php'
  assert.equal(await f.api.isGameFrame(f.contents, game), false)
  f.api.setGameSenderId(null)
  assert.equal(await f.api.isGameFrame(f.contents, game), false)
})

test('直连任意 http(s) 主机可用，资源收货只认真实游戏帧及其服务器主机', async () => {
  const f = gameFixture('http://private.example/direct?api_token=secret')
  const ad = f.child('https://ad.example/widget')
  assert.equal(await f.api.isGameApiSender({ sender: f.contents, senderFrame: f.main }, 'http://private.example/kcsapi/api_port/port', '/kcsapi/api_port/port'), true)
  for (const [frame, host, expected] of [[f.main, 'private.example', true], [f.main, 'ad.example', false], [ad, 'ad.example', false]]) {
    assert.equal(await f.api.isGameResourceRequest({ webContentsId: 17, frame }, new URL(`https://${host}/kcs2/resources/map/001/01_info.json`)), expected)
  }
  assert.equal(await f.api.isGameResourceRequest({ webContentsId: 17 }, new URL('https://private.example/kcs2/x')), false)
})

test('资源 onBeforeRequest 实际收货：第三方同形路径不进档，真实游戏服务器请求仍入档', async () => {
  const f = gameFixture('https://private.example/kcs2/index.php')
  const h = protocolFixture('unused', { './game-sender': f.api })
  h.api.setKcsResourceGameWebContentsId(17)
  const ad = f.child('https://ad.example/widget')
  const pathname = '/kcs2/resources/map/001/01_info.json'
  for (const [frame, hostname] of [[ad, 'ad.example'], [f.main, 'ad.example']]) {
    let replied = false
    await h.beforeRequest({ url: `https://${hostname}${pathname}`, resourceType: 'xhr', webContentsId: 17, frame }, () => { replied = true })
    assert.equal(replied, true)
    assert.equal(h.remembered.length, 0)
  }
  await h.beforeRequest({ url: `https://private.example${pathname}`, resourceType: 'xhr', webContentsId: 17, frame: f.main }, () => {})
  assert.equal(h.remembered.length, 1)
  assert.equal(h.remembered[0].pathname, pathname)
})

test('DMM gadget 嵌套链沿父页实际 frame.src 认动态服务器，导航期间不接受旧判定', async () => {
  const f = gameFixture()
  const gadget = f.child('https://osapi.dmm.com/gadgets/ifr')
  const game = f.child('https://another-game.example/kcs2/index.php', gadget)
  f.main.sources.push(gadget.url); gadget.sources.push(game.url)
  assert.equal(await f.api.isGameFrame(f.contents, game), true)
  const racing = f.child('https://race.example/kcs2/index.php')
  let finish
  f.main.executeJavaScript = () => new Promise((resolve) => { finish = resolve })
  const result = f.api.isGameFrame(f.contents, racing)
  await Promise.resolve(); await Promise.resolve()
  racing.url = 'https://ad.example/kcs2/index.php'
  finish(['https://race.example/kcs2/index.php'])
  assert.equal(await result, false)
})

test('广播器实际 IPC：第三方帧不能伪造永久记账事件，合法帧保持 request/response/error', async () => {
  const f = gameFixture('https://private.example/kcs2/index.php')
  const handlers = new Map()
  const broadcaster = load('game-api-broadcaster', {
    electron: { ipcMain: { on: (channel, handler) => handlers.set(channel, handler) } },
    './env': { ROOT: root }, './game-sender': f.api,
  })
  const events = []
  for (const kind of ['request', 'response', 'error']) broadcaster.on(`network.${kind === 'error' ? '' : 'on.'}${kind}`, (...args) => events.push(args))
  const payload = { method: 'POST', pathname: '/kcsapi/api_port/port', responseURL: 'https://private.example/kcsapi/api_port/port',
    request: '', response: 'svdata={"api_result":1}', responseType: 'text', status: 200 }
  const receive = handlers.get('kuma:game-api')
  const ad = f.child('https://ad.example/widget')
  for (const kind of ['request', 'response', 'error']) await receive({ sender: f.contents, senderFrame: ad }, kind, payload)
  assert.equal(events.length, 0)
  for (const kind of ['request', 'response', 'error']) await receive({ sender: f.contents, senderFrame: f.main }, kind, payload)
  assert.equal(events.length, 3)
})

test('四个抓档实际通道：本地主窗、弹窗和独立窗可以抓档，游戏/浏览/远程子帧不调用抓档', async () => {
  const f = uiFixture(), handlers = new Map(), captured = []
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'mg', 'index.ts'), 'utf8')
  for (const kind of ['art', 'voice', 'bgm', 'asset']) {
    const start = source.indexOf(`ipcMain.on('kuma:archive-capture-${kind}'`)
    assert.ok(start >= 0)
    const end = source.indexOf('\n})', start) + 3
    vm.runInNewContext(transformSync(source.slice(start, end), { loader: 'ts' }).code, {
      ipcMain: { on: (channel, handler) => handlers.set(channel, handler) }, isKumaSender: f.api.isKumaSender,
      broadcaster: { emit() {} },
      ...Object.fromEntries(['Art', 'Voice', 'Bgm', 'Asset'].map((name) => [`captureDisplayed${name}`, async () => { captured.push(name); return {} }])),
    })
  }
  const main = f.window(), pop = f.window(), independent = f.window('ship-life.html'), game = f.window('index.html', 'webview')
  const remote = f.window(); remote.senderFrame.url = 'https://guide.example/'
  const subframe = { sender: main.sender, senderFrame: { url: main.senderFrame.url } }
  for (const handler of handlers.values()) {
    for (const event of [game, remote, subframe]) handler(event, { pathname: '/kcs2/x', url: 'https://ad.example/x' })
  }
  assert.equal(captured.length, 0)
  for (const handler of handlers.values()) for (const event of [main, pop, independent]) handler(event, { pathname: '/kcs2/x', url: 'https://game.example/x' })
  assert.equal(captured.length, 12)
  await Promise.resolve()
})

for (const suffix of ['?api_token=query-secret&x=1', '#api_token=hash-secret']) {
  test(`加载失败实际浮层去掉凭据：${suffix.startsWith('?') ? '查询串' : 'hash'}`, () => {
    const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.ts'), 'utf8')
    const start = source.indexOf('const showLoadError =')
    const end = source.indexOf('\nconst hideLoadError', start)
    const overlayTitle = {}, overlayDetail = { style: {} }, classes = []
    vm.runInNewContext(transformSync(source.slice(start, end) + '\nshowLoadError(-2, "ERR_FAILED", input)', { loader: 'ts' }).code, {
      POP_MODULE: null, diagnosticUrl: redaction.diagnosticUrl, overlayTitle, overlayDetail,
      overlay: { classList: { add: (value) => classes.push(value) } }, input: `https://user:pass@game.example/kcs2/index.php${suffix}`,
    })
    assert.equal(overlayTitle.textContent, '游戏页面加载失败')
    assert.equal(overlayDetail.textContent, 'ERR_FAILED (-2)\nhttps://game.example/kcs2/index.php\n\n代理配置：设置 · 代理 · 配置后重试')
    assert.deepEqual(classes, ['visible'])
  })
}
