import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import logout from '../dist/shared/dmm-logout.js'
import gameUrl from '../dist/shared/game-url.js'
import navigationError from '../dist/shared/navigation-error.js'

const { dmmLogoutTargets } = logout
const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const evaluate = (source, scope) => new Function(...Object.keys(scope), transformSync(source, { loader: 'ts' }).code)(...Object.values(scope))

test('退出目标按 DMM 域边界选择，删除 URL 保留协议和路径，源去重且只有 https', () => {
  const domains = ['dmm.com', '.dmm.com', 'login.dmm.com', '.osapi.dmm.com', 'dmm.co.jp', '.dmm.co.jp', 'login.dmm.co.jp']
  const excluded = ['kancolle-server.test', 'osapi.example.test', 'kuma.test', 'evildmm.com', 'dmm.com.example.test', 'dmm.co.jp.example.test', undefined]
  const cookies = [...domains, ...excluded].map((domain, i) => ({ domain, name: `cookie-${i}`, secure: i % 2 === 0, path: '/login/' }))
  const result = dmmLogoutTargets(cookies)
  assert.deepEqual(result.cookies.map((cookie) => cookie.name), domains.map((_, i) => `cookie-${i}`))
  assert.equal(result.cookies[0].url, 'https://dmm.com/login/')
  assert.equal(result.cookies[1].url, 'http://dmm.com/login/')
  assert.deepEqual(result.origins, ['https://dmm.com', 'https://login.dmm.com', 'https://osapi.dmm.com', 'https://dmm.co.jp', 'https://login.dmm.co.jp'])
  assert.deepEqual(dmmLogoutTargets([]), { cookies: [], origins: [] })
})

const mountLogout = ({ failAt, navigationFailure, noGame = false } = {}) => {
  const calls = []
  const warnings = []
  const step = async (name, data) => {
    calls.push([name, data])
    if (failAt === name) throw new Error(`失败：${name}`)
  }
  const cookies = [{ domain: '.dmm.com', name: 'session', secure: true }, { domain: 'game.test', name: 'keep' }]
  const ses = {
    cookies: {
      get: async (filter) => { await step('get', filter); return cookies },
      remove: (url, name) => step('remove', { url, name }),
      flushStore: () => step('flush'),
    },
    clearStorageData: (options) => step('storage', options),
  }
  const game = {
    isDestroyed: () => false, getType: () => 'webview', session: ses,
    loadURL: async (url) => {
      await step('navigate', url)
      if (navigationFailure) throw navigationFailure
    },
    mainFrame: { framesInSubtree: [
      { url: 'https://dmm.com/login', executeJavaScript: (script) => {
        new Function('location', 'sessionStorage', script)({ origin: 'https://dmm.com' }, { clear: () => calls.push(['sessionstorage']) })
        // frame 在执行前已导航到第三方时，也不能清它。
        new Function('location', 'sessionStorage', script)({ origin: 'https://game.test' }, { clear: () => assert.fail('清到了第三方') })
        return Promise.resolve()
      } },
      { url: 'https://game.test/', executeJavaScript: () => assert.fail('不应执行第三方 frame') },
    ] },
  }
  const source = read('main/yu.ts')
  const start = source.indexOf('const reloadGameUrl =')
  const end = source.indexOf('/**', source.indexOf("ipcMain.handle('yu:logout-dmm'", start))
  const handlers = new Map()
  evaluate(source.slice(start, end), {
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    session: { defaultSession: ses }, dmmLogoutTargets,
    ...navigationError, console: { warn: (...args) => warnings.push(args) },
    webContents: { getAllWebContents: () => noGame ? [] : [game] },
    config: { get: () => 'https://dmm.com/configured-game' }, ...gameUrl,
  })
  return { run: handlers.get('yu:logout-dmm'), reload: handlers.get('yu:reload-game-url'), calls, warnings }
}

test('退出依序枚举、删除、按源清理、flush、复用首页导航，并返回计数', async () => {
  const fixture = mountLogout()
  assert.deepEqual(await fixture.run(), { removed: 1, origins: 1, aborted: false })
  assert.deepEqual(fixture.calls, [
    ['get', {}], ['remove', { url: 'https://dmm.com/', name: 'session' }],
    ['storage', { origin: 'https://dmm.com', storages: ['localstorage', 'indexdb', 'cachestorage'] }],
    ['sessionstorage'], ['flush', undefined], ['navigate', 'https://dmm.com/configured-game'],
  ])
})

test('退出各阶段错误传给调用方，清理失败不导航，找不到游戏页不报成功', async () => {
  for (const failAt of ['get', 'remove', 'storage', 'flush', 'navigate']) {
    const fixture = mountLogout({ failAt })
    await assert.rejects(fixture.run(), { message: `失败：${failAt}` })
    assert.equal(fixture.calls.at(-1)[0], failAt)
  }
  await assert.rejects(mountLogout({ noGame: true }).run(), /游戏页面尚未就绪/)
})

test('退出回首页被登录页导航打断仍返回成功和 aborted', async () => {
  const fixture = mountLogout({ navigationFailure: { code: 'ERR_ABORTED', errno: -3 } })
  assert.deepEqual(await fixture.run(), { removed: 1, origins: 1, aborted: true })
  assert.equal(fixture.calls.at(-1)[0], 'navigate')
  assert.deepEqual(fixture.warnings, [])
})

test('退出回首页的真实导航错误仍原样抛出', async () => {
  const error = Object.assign(new Error('ERR_NAME_NOT_RESOLVED (-105)'), { code: 'ERR_NAME_NOT_RESOLVED', errno: -105 })
  await assert.rejects(mountLogout({ navigationFailure: error }).run(), (actual) => actual === error)
})

test('普通重新载入仍成功返回，缺少游戏页返回未就绪，真实错误保留警告且不抛', async () => {
  const url = 'https://dmm.com/configured-game'
  assert.deepEqual(await mountLogout().reload(), { ok: true, url })
  assert.deepEqual(await mountLogout({ noGame: true }).reload(), { ok: false, url })
  const error = new Error('ERR_CONNECTION_REFUSED (-102)')
  const fixture = mountLogout({ navigationFailure: error })
  assert.deepEqual(await fixture.reload(), { ok: true, url })
  assert.deepEqual(fixture.warnings, [['[kuma] yu: 游戏页重新载入未完成', url, error]])
})

test('普通重新载入遇导航中断仍成功并标记 aborted', async () => {
  const fixture = mountLogout({ navigationFailure: { code: 'ERR_ABORTED', errno: -3 } })
  assert.deepEqual(await fixture.reload(), { ok: true, url: 'https://dmm.com/configured-game', aborted: true })
  assert.deepEqual(fixture.warnings, [])
})

test('登录保鲜的真实监听器忽略删除事件，仍复写新增 DMM 会话 cookie 为 180 天', async () => {
  const source = read('main/login-keeper.ts')
  let changed
  const writes = []
  const ses = { cookies: { on: (_event, fn) => { changed = fn }, set: async (cookie) => writes.push(cookie) } }
  evaluate(source.slice(source.indexOf('const shouldPersist ='), source.indexOf("app.on('before-quit'")), {
    PERSIST_DOMAINS: ['dmm.com', 'dmm.co.jp'], PERSIST_DAYS: 180, FLUSH_INTERVAL_MS: 1,
    app: { on: (_event, fn) => fn() }, session: { defaultSession: ses },
    config: { get: () => true }, setInterval: () => {}, flushCookies: () => {},
    loginHealth: {}, publishLoginHealth: () => {}, recordLoginError: (error) => { throw error },
  })
  const cookie = { name: 'session', value: 'fixture', domain: '.dmm.com', session: true, secure: true }
  await changed({}, cookie, 'explicit', true)
  await changed({}, { ...cookie, session: false }, 'explicit', false)
  await changed({}, { ...cookie, domain: 'game.test' }, 'explicit', false)
  assert.equal(writes.length, 0)
  const before = Date.now() / 1000
  await changed({}, cookie, 'explicit', false)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].url, 'https://dmm.com/')
  assert.ok(writes[0].expirationDate >= before + 180 * 86400)
  assert.ok(writes[0].expirationDate <= Date.now() / 1000 + 180 * 86400)
})

test('地区兼容沿用页面 DOMContentLoaded，每次回到 DMM 页面会再次设置', () => {
  const source = fs.readFileSync(new URL('../assets/preload/cookie-hack.js', import.meta.url), 'utf8')
  let loaded
  const writes = []
  const config = { get: () => true }
  const remote = { require: () => config, getCurrentWebContents: () => ({ session: { getUserAgent: () => 'fixture', setUserAgent: () => {} } }) }
  evaluate(source.slice(0, source.indexOf('// MAIN WORLD')), {
    require: (id) => id === '@electron/remote' ? remote : gameUrl,
    document: { addEventListener: (name, fn) => { assert.equal(name, 'DOMContentLoaded'); loaded = fn }, set cookie(value) { writes.push(value) } },
    location: { hostname: 'www.dmm.com', href: 'https://www.dmm.com/' },
  })
  loaded()
  const first = [...writes]
  assert.ok(first.some((value) => value.startsWith('cklg=welcome;')))
  assert.ok(first.some((value) => value.startsWith('ckcy=1;')))
  loaded()
  assert.equal(writes.length, first.length * 2)
})
