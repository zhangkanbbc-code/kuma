import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { transformSync } from 'esbuild'
import { compiledMain, mountTiming } from './helpers/main-perf.mjs'
import crashContext from '../dist/shared/crash-context.js'

test('timeMain：sink 安装前静默丢弃，低于阈值不求 detail', () => {
  const h = mountTiming()
  const detail = mock.fn(() => 'ships')
  h.api.timeMain('patch', () => h.advance(60), detail)
  h.installSink()
  h.api.timeMain('patch', () => h.advance(49.9), detail)
  assert.equal(detail.mock.callCount(), 0)
  assert.deepEqual(h.entries, [])
})

test('timeMain：环境变量正数生效，无效值默认 50，等于阈值记录', () => {
  for (const [value, limit] of [[undefined, 50], ['', 50], ['bad', 50], ['0', 50], ['-1', 50], ['Infinity', 50], ['80', 80], ['0.5', 0.5]]) {
    const h = mountTiming(value)
    h.installSink()
    assert.equal(h.api.mainLongTaskMs(), limit)
    h.api.timeMain('patch', () => h.advance(limit - 0.1))
    assert.equal(h.entries.length, 0)
    h.api.timeMain('patch', () => h.advance(limit))
    assert.equal(h.entries.length, 1)
  }
  const h = mountTiming()
  h.env.KUMA_PERF_LONGTASK_MS = '60'
  assert.equal(h.api.mainLongTaskMs(), 60)
})

test('timeMain：返回值、原始异常透传，诊断失败不得覆盖业务结果', () => {
  const h = mountTiming()
  h.installSink()
  const value = {}, error = new Error('business')
  assert.equal(h.api.timeMain('patch', () => { h.advance(60); return value }), value)
  assert.throws(() => h.api.timeMain('patch', () => { h.advance(60); throw error }), (e) => e === error)
  assert.equal(h.entries.length, 2)
  h.api.setMainTimingSink(() => { throw new Error('sink') })
  assert.equal(h.api.timeMain('patch', () => { h.advance(60); return value }), value)
  assert.throws(() => h.api.timeMain('patch', () => { h.advance(60); throw error }), (e) => e === error)
})

for (const method of ['handle', 'on']) {
  test(`IPC ${method}：模块求值后注册即计时，event/this/入参/返回值/异常透传`, () => {
    const h = mountTiming()
    h.installSink()
    const event = {}, argument = {}, result = {}, error = new Error('business')
    let duration = 60, shouldThrow = false
    const registerResult = h.ipc[method]('mg:ship-life', function (receivedEvent, receivedArgument) {
      assert.equal(this, h.ipc)
      assert.equal(receivedEvent, event)
      assert.equal(receivedArgument, argument)
      h.advance(duration)
      if (shouldThrow) throw error
      return result
    })
    assert.equal(registerResult, method === 'on' ? h.ipc : undefined)
    const listener = method === 'handle' ? h.handlers.get('mg:ship-life') : h.ipc.rawListeners('mg:ship-life')[0]
    assert.equal(listener.call(h.ipc, event, argument), result)
    assert.deepEqual(h.entries, [{ scope: 'ipc:mg:ship-life', ms: 60, detail: '入参约 0 字节 · 对象' }])
    duration = 49
    assert.equal(listener.call(h.ipc, event, argument), result)
    assert.equal(h.entries.length, 1)
    duration = 60
    shouldThrow = true
    assert.throws(() => listener.call(h.ipc, event, argument), (e) => e === error)
    assert.equal(h.entries.length, 2)
  })

  test(`IPC ${method}：异步同步段与总时长分别过阈值，resolve/reject 原样传递`, async () => {
    for (const [sync, wait, reject] of [[60, 100, false], [10, 50, false], [10, 20, false], [60, 100, true]]) {
      const h = mountTiming()
      h.installSink()
      let settle
      const result = {}, error = new Error('rejected')
      h.ipc[method]('mg:archive', () => {
        h.advance(sync)
        return new Promise((resolve, fail) => { settle = () => reject ? fail(error) : resolve(result) })
      })
      const listener = method === 'handle' ? h.handlers.get('mg:archive') : h.ipc.rawListeners('mg:archive')[0]
      const pending = listener({})
      assert.deepEqual(h.entries.map((entry) => [entry.scope, entry.ms]), sync >= 50 ? [['ipc:mg:archive:sync', sync]] : [])
      h.advance(wait)
      settle()
      if (reject) await assert.rejects(pending, (e) => e === error)
      else assert.equal(await pending, result)
      const expected = []
      if (sync >= 50) expected.push(['ipc:mg:archive:sync', sync])
      if (sync + wait >= 50) expected.push(['ipc:mg:archive:total', sync + wait])
      assert.deepEqual(h.entries.map((entry) => [entry.scope, entry.ms]), expected)
    }
  })
}

test('IPC：1 MB Uint8Array/Buffer 只取 byteLength，字符串取 length，对象不遍历且从不 stringify', () => {
  const stringify = mock.fn(() => { throw new Error('must not stringify') })
  const h = mountTiming(undefined, { JSON: { ...JSON, stringify } })
  h.installSink()
  h.ipc.handle('mg:voice-archive-keep', () => h.advance(60))
  const listener = h.handlers.get('mg:voice-archive-keep')
  const object = { get secret() { throw new Error('must not inspect') } }
  listener({ secret: 'event excluded' }, new Uint8Array(1024 * 1024))
  listener({}, Buffer.alloc(1024 * 1024))
  listener({}, '中文', object, 123, null)
  assert.deepEqual(h.entries.map((entry) => entry.detail), ['入参约 1048576 字节', '入参约 1048576 字节', '入参约 2 字节 · 对象'])
  assert.equal(stringify.mock.callCount(), 0)
})

test('IPC on：原监听器可移除，once 仍只调用一次', () => {
  const h = mountTiming()
  const listener = mock.fn()
  h.ipc.on('remove', listener)
  h.ipc.removeListener('remove', listener)
  h.ipc.emit('remove', {})
  assert.equal(listener.mock.callCount(), 0)
  h.ipc.once('once', listener)
  h.ipc.emit('once', {})
  h.ipc.emit('once', {})
  assert.equal(listener.mock.callCount(), 1)
})

test('index.ts：env 后紧接 perf-log，先于所有业务模块；构建产物也保持顺序', () => {
  const source = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/^import\s+(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1])
  assert.deepEqual(imports.slice(0, 2), ['./env', './perf-log'])
  const compiled = compiledMain('index')
  const requires = [...compiled.matchAll(/require\("([^"\n]+)"\)/g)].map((match) => match[1])
  assert.deepEqual(requires.slice(0, 2), ['./env', './perf-log'])
})

test('atomicWriteJsonSync：计入序列化、写入、fsync、rename；detail 只有文件名和实际字节数', () => {
  const h = mountTiming()
  h.installSink()
  const calls = []
  const fs = {
    mkdirSync: () => calls.push('mkdir'), openSync: () => { calls.push('open'); return 7 },
    writeSync: (fd, json, position, encoding) => {
      assert.equal(fd, 7)
      assert.equal(position, null)
      assert.equal(encoding, 'utf8')
      calls.push('write')
      h.advance(10)
      return Buffer.byteLength(json)
    },
    fsyncSync: () => { calls.push('fsync'); h.advance(20) },
    closeSync: () => calls.push('close'),
    renameSync: () => { calls.push('rename'); h.advance(10) },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiledMain('atomic-json'), {
    module, exports: module.exports, process: { pid: 1 },
    require: (id) => {
      if (id === 'fs') return fs
      if (id === 'path') return path
      if (id === './perf-time') return h.api
      throw new Error(`unexpected require: ${id}`)
    },
  })
  const result = module.exports.atomicWriteJsonSync('C:\\private\\account\\snapshot.json', {
    toJSON() { h.advance(20); return { label: '中文' } },
  })
  assert.equal(result, undefined)
  assert.deepEqual(calls, ['mkdir', 'open', 'write', 'fsync', 'close', 'rename'])
  assert.deepEqual(h.entries, [{ scope: 'fs-write', ms: 60, detail: `snapshot.json ${Buffer.byteLength('{"label":"中文"}')} 字节` }])
  assert.doesNotMatch(h.entries[0].detail, /private|account|[\\/]|中文/)
})

const mgSource = readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
const runTs = (source, context) => vm.runInNewContext(transformSync(source, { loader: 'ts' }).code, context)

test('API 分段计时：状态→任务→遭遇志→舰历的参数、顺序与返回切片保持一致', () => {
  const start = mgSource.indexOf("  const sections = timeMain('api:state'")
  const end = mgSource.indexOf('  // 任务领取 →', start)
  assert.ok(start >= 0 && end > start)
  // 资源归因位于计时段之间，其完整行为由 material-delta-detail 的 handleEvent 用例执行。
  const deltaStart = mgSource.indexOf('  const deltaMaterials =', start)
  const deltaEnd = mgSource.indexOf('  const powerupResult =', deltaStart)
  assert.ok(deltaStart > start && deltaEnd > deltaStart && deltaEnd < end)
  const h = mountTiming()
  h.installSink()
  const calls = []
  const body = { private: 'must not appear in timing detail' }
  const postBody = { api_token: 'must not appear in timing detail' }
  const sections = ['master']
  const result = runTs(`${mgSource.slice(start, deltaStart)}${mgSource.slice(deltaEnd, end)}\nsections`, {
    apiPath: '/kcsapi/api_start2/getData', body, postBody, ts: 123,
    destroyedSlotitems: undefined, expeditionMissionId: 0, powerupShipIds: undefined, hangarCapsBefore: null,
    timeMain: h.api.timeMain,
    store: { handle: (...args) => { calls.push(['state', ...args]); h.advance(60); return sections } },
    onQuestApi: (...args) => { calls.push(['quests', ...args]); h.advance(70) },
    onChronicleApi: (...args) => { calls.push(['chronicle', ...args]); h.advance(80) },
    onShipLifeApi: (...args) => { calls.push(['ship-life', ...args]); h.advance(90) },
  })
  assert.equal(result, sections)
  assert.deepEqual(calls.map(([name]) => name), ['state', 'quests', 'chronicle', 'ship-life'])
  for (const [, apiPath, actualBody, actualPost] of calls) {
    assert.equal(apiPath, '/kcsapi/api_start2/getData')
    assert.equal(actualBody, body)
    assert.equal(actualPost, postBody)
  }
  assert.equal(calls[3][5], sections)
  assert.deepEqual(h.entries.map(({ scope, ms }) => [scope, ms]), [
    ['api:state', 60], ['api:quests', 70], ['api:chronicle', 80], ['api:ship-life', 90],
  ])
  assert.ok(h.entries.every(entry => entry.detail === '/kcsapi/api_start2/getData'))
})

test('mg:patch：计时包住整段 send 循环，payload 原样，不序列化，detail 只有 sections', () => {
  const source = mgSource.slice(mgSource.indexOf('const broadcast ='), mgSource.indexOf('const broadcastSortieScreen ='))
  assert.ok(source.includes("send('mg:patch'"))
  const h = mountTiming()
  h.installSink()
  const payload = { get secret() { throw new Error('must not inspect') } }
  const sends = []
  const windows = [false, true, false].map((destroyed) => ({
    isDestroyed: () => destroyed,
    webContents: { send: (channel, value) => { sends.push([channel, value]); h.advance(30) } },
  }))
  const stringify = mock.fn(() => { throw new Error('must not stringify') })
  const broadcast = runTs(`${source}\nbroadcast`, {
    BrowserWindow: { getAllWindows: () => windows },
    pickSections: () => payload, timeMain: h.api.timeMain, JSON: { stringify },
  })
  broadcast([])
  assert.equal(sends.length, 0)
  broadcast(['ships', 'decks'])
  assert.equal(sends.length, 2)
  for (const [channel, value] of sends) {
    assert.equal(channel, 'mg:patch')
    assert.equal(value, payload)
  }
  assert.deepEqual(h.entries, [{ scope: 'patch', ms: 60, detail: 'ships,decks' }])
  assert.equal(stringify.mock.callCount(), 0)
})

test('network.on.response：采用同一阈值，原有分段日志格式保持', () => {
  const start = mgSource.indexOf("broadcaster.addListener(\n  'network.on.response'")
  const end = mgSource.indexOf('// (曾在这里跟踪', start)
  assert.ok(start >= 0 && end > start)
  for (const [threshold, duration, count] of [[undefined, 49, 0], [undefined, 50, 1], ['80', 60, 0], ['80', 80, 1]]) {
    const h = mountTiming(threshold)
    let listener
    const entries = [], calls = []
    const lastApis = crashContext.createLastApiMemo()
    runTs(mgSource.slice(start, end), {
      lastApis,
      broadcaster: { addListener: (channel, fn) => { assert.equal(channel, 'network.on.response'); listener = fn } },
      performance: h.performance, mainLongTaskMs: h.api.mainLongTaskMs,
      ledger: { record: (...args) => { calls.push(args); h.advance(duration) } },
      handleEvent: () => calls.push('handleEvent'),
      appendPerf: (...args) => entries.push(args),
    })
    listener('POST', ['', '/kcsapi/api_port/port'], '{"api_result":1,"api_data":{}}', '{}', 123)
    assert.deepEqual(lastApis.list(), [{ path: '/kcsapi/api_port/port', ts: 123 }])
    assert.equal(calls.length, 2)
    assert.equal(entries.length, count)
    if (count) assert.deepEqual(entries[0], [
      'main', 'network-event', `/kcsapi/api_port/port 处理 ${duration}ms（解析 0 · 记账 ${duration} · 归约 0，报文 0KB）`,
    ])
  }
})

test('network.on.response：非 API 不记，解析失败也保留最近路径且不保留查询串', () => {
  const start = mgSource.indexOf("broadcaster.addListener(\n  'network.on.response'")
  const end = mgSource.indexOf('// (曾在这里跟踪', start)
  let listener
  const lastApis = crashContext.createLastApiMemo()
  runTs(mgSource.slice(start, end), {
    broadcaster: { addListener: (_channel, fn) => { listener = fn } },
    lastApis, performance: { now: () => 0 },
  })
  listener('GET', ['', '/kcs2/fixture'], 'invalid', '', 1)
  assert.deepEqual(lastApis.list(), [])
  for (let ts = 2; ts <= 5; ts++) {
    listener('POST', ['', `/kcsapi/api_${ts}?fixture=discard`], 'invalid', '', ts)
  }
  assert.deepEqual(lastApis.list(), [3, 4, 5].map(ts => ({ path: `/kcsapi/api_${ts}`, ts })))
})

const mountWebRequest = (threshold, { accessMs = 60, missing = false, staticResource = true } = {}) => {
  const h = mountTiming(threshold)
  h.installSink()
  let listener
  const accesses = []
  const ses = {
    webRequest: { onBeforeRequest: (_filter, callback) => { listener = callback } },
    protocol: { handle: () => {} },
  }
  const module = { exports: {} }
  const unusedModules = new Set([
    './game-api-broadcaster', '../shared/kcs-bgm', './bgm-archive', '../shared/ship-art-path',
    './ship-art-store', './voice-archive', './art-archive', '../shared/art-archive-plan',
  ])
  vm.runInNewContext(compiledMain('kcs-resource'), {
    module, exports: module.exports, URL, performance: h.performance,
    require: (id) => {
      if (id === 'electron') return { session: { defaultSession: ses } }
      if (id === 'fs') return { constants: { R_OK: 4 }, promises: { access: async (file) => {
        accesses.push(file)
        h.advance(accessMs)
        if (missing) throw new Error('missing')
      } } }
      if (id === 'path') return path
      if (id === 'url') return {}
      if (id === './env') return { ROOT: 'C:\\fixture', DEFAULT_CACHE_PATH: 'C:\\private-cache' }
      if (id === './config') return { get: (_key, fallback) => fallback }
      if (id === './perf-time') return h.api
      if (id === '../shared/voice-request-gate') return { createVoiceRequestGate: () => ({}) }
      if (id === path.join('C:\\fixture', 'assets', 'preload', 'kcs-resource-path')) return {
        isStaticResource: () => { h.advance(10); return staticResource },
        getCacheCandidatePaths: () => ['C:\\private-cache\\hack.css', 'C:\\private-cache\\plain.css'],
      }
      if (unusedModules.has(id)) return {}
      throw new Error(`unexpected require: ${id}`)
    },
  })
  module.exports.registerKcsResourceProtocol()
  return { ...h, listener, accesses }
}

test('webRequest：异步查找后放行/重定向计到 callback，排除 callback 自身耗时且不漏地址', async () => {
  for (const missing of [false, true]) {
    const h = mountWebRequest(undefined, { missing })
    const responses = []
    await h.listener({ url: 'https://private-host/kcs2/style.css?api_token=secret#fragment', resourceType: 'stylesheet' }, (response) => {
      assert.equal(h.entries.length, 0, '先调用原 callback，再落日志')
      responses.push({ ...response })
      h.advance(100)
    })
    assert.deepEqual(responses, [missing ? {} : { redirectURL: 'kuma-cache://resource/kcs2/style.css' }])
    assert.equal(h.accesses.length, missing ? 2 : 1)
    assert.deepEqual(h.entries, [{ scope: 'webrequest', ms: missing ? 130 : 70, detail: 'stylesheet /kcs2/style.css' }])
    assert.doesNotMatch(h.entries[0].detail, /private|secret|token|https|\?|#|C:/)
  }
})

test('webRequest：阈值默认 50，可覆盖，低于阈值不记录', async () => {
  for (const [threshold, accessMs, count] of [[undefined, 39, 0], [undefined, 40, 1], ['80', 60, 0], ['80', 70, 1]]) {
    const h = mountWebRequest(threshold, { accessMs })
    const callback = mock.fn()
    await h.listener({ url: 'https://host/kcs2/style.css', resourceType: 'stylesheet' }, callback)
    assert.equal(callback.mock.callCount(), 1)
    assert.equal(h.entries.length, count)
  }
})

test('webRequest：不支持类型、非静态资源与 URL 解析失败的早退路径仍原样 callback', async () => {
  for (const [url, resourceType, staticResource, expectedDetail] of [
    ['https://host/kcs2/image.png?token=secret', 'image', true, 'image /kcs2/image.png'],
    ['https://host/kcs2/other?token=secret', 'stylesheet', false, 'stylesheet /kcs2/other'],
    ['invalid?token=secret', 'stylesheet', true, 'stylesheet '],
  ]) {
    const h = mountWebRequest(undefined, { staticResource })
    const responses = []
    await h.listener({ get url() { h.advance(60); return url }, resourceType }, (response) => responses.push({ ...response }))
    assert.deepEqual(responses, [{}])
    assert.equal(h.accesses.length, 0)
    assert.equal(h.entries.length, 1)
    assert.equal(h.entries[0].detail, expectedDetail)
  }
})
