import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { mountTiming } from './helpers/main-perf.mjs'
import { transformSync } from 'esbuild'
import crashContext from '../dist/shared/crash-context.js'

const compiled = readFileSync(new URL('../dist/main/perf-log.js', import.meta.url), 'utf8')
const mountPerf = (threshold, gcUnsupported = false, windowOf = () => null) => {
  const timing = mountTiming(threshold)
  const { ipc } = timing
  const entries = []
  let gcObserver, gcOptions
  let tick, period, enabled = 0, resets = 0, unrefs = 0
  let now = 0
  const histogram = {
    max: 123_400_000, mean: 12_600_000,
    percentile: (value) => { assert.equal(value, 99); return 28_700_000 },
    enable: () => { enabled++ },
    reset: () => { resets++; histogram.max = 0 },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date: { now: () => now },
    require: (id) => {
      if (id === 'electron') return { ipcMain: ipc }
      if (id === 'path') return path
      if (id === './env') return { APPDATA_PATH: 'unused' }
      if (id === './crash-log') return { createRollingLog: () => ({ append: (...args) => entries.push(args) }) }
      if (id === './perf-time') return timing.api
      if (id === '../shared/crash-context') return crashContext
      if (id === '../shared/env-names') return { readEnv: (key) => { assert.equal(key, 'KUMA_PERF_LONGTASK_MS'); return threshold } }
      if (id === 'perf_hooks') return { monitorEventLoopDelay: (options) => {
        assert.equal(options.resolution, 10)
        return histogram
      }, PerformanceObserver: class {
        constructor(callback) { gcObserver = callback }
        observe(options) {
          if (gcUnsupported) throw new Error('unsupported')
          gcOptions = options
        }
      } }
      throw new Error(`unexpected require: ${id}`)
    },
    setInterval: (callback, ms) => { tick = callback; period = ms; return { unref: () => { unrefs++ } } },
  })
  module.exports.installPerfLogging(windowOf)
  return { ipc, entries, histogram, tick, gcObserver, gcOptions, timing, advance: ms => { now += ms }, recentMemoryTrail: module.exports.recentMemoryTrail, lastBreadcrumbInfo: module.exports.lastBreadcrumbInfo, redactPerfDetail: module.exports.redactPerfDetail, stats: () => ({ period, enabled, resets, unrefs }) }
}

test('内存 IPC：两次报数合占一格，十二轮保留顺序，空值与无效指标不污染轨迹', () => {
  const h = mountPerf()
  for (let ts = 0; ts < 130_000; ts += 10_000) {
    h.ipc.emit('kuma:perf-memory', {}, { jsHeapUsed: ts, jsHeapTotal: ts + 1 }, ts)
    h.ipc.emit('kuma:perf-memory', {}, { private: ts + 2, residentSet: ts + 3 }, ts)
  }
  const samples = h.recentMemoryTrail()
  assert.equal(samples.length, 12)
  assert.deepEqual(samples[0], { ts: 10_000, jsHeapUsed: 10_000, jsHeapTotal: 10_001, private: 10_002, residentSet: 10_003 })
  for (const raw of [undefined, {}, { private: -1, residentSet: NaN, jsHeapUsed: 'invalid', jsHeapTotal: Infinity }]) {
    h.ipc.emit('kuma:perf-memory', {}, raw, 130_000)
  }
  h.ipc.emit('kuma:perf-memory', {}, { private: 1 }, undefined)
  assert.deepEqual(h.recentMemoryTrail(), samples)
  assert.equal(h.entries.length, 0)
})

test('最近执行位置导出保留记录时间，供崩溃现场读取', () => {
  const h = mountPerf()
  h.advance(21_000)
  h.ipc.emit('kuma:perf-breadcrumb', {}, 'patch → panel.ts:42')
  assert.deepEqual(JSON.parse(JSON.stringify(h.lastBreadcrumbInfo())), {
    lastBreadcrumb: 'patch → panel.ts:42', breadcrumbTs: 21_000,
  })
})

const rendererPerf = transformSync(readFileSync(new URL('../src/renderer/perf-guard.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
const mountRendererPerf = (ipc) => {
  const module = { exports: {} }
  vm.runInNewContext(rendererPerf, {
    module, exports: module.exports, performance: { now: () => 0 },
    PerformanceObserver: class { observe() {} },
    require: id => {
      if (id === 'electron') return { ipcRenderer: { on() {}, send: (channel, ...args) => ipc.emit(channel, {}, ...args) } }
      if (id === '../shared/env-names') return { readEnv: () => undefined }
      if (id === './crash-guard') return { recordCrash() {} }
      throw new Error(`unexpected require: ${id}`)
    },
  })
  return module.exports
}

test('已结束的回调后发生无应答：只报告最近位置，不断言回调未完成', () => {
  const win = { isDestroyed: () => false, webContents: { isCrashed: () => false, send() {} } }
  const h = mountPerf(undefined, false, () => win)
  const renderer = mountRendererPerf(h.ipc)
  let completed = 0
  h.advance(1000)
  renderer.timedRun('finished-run', () => { completed++ })
  renderer.timedEach('finished-listener', [1], () => 'returned.ts:42', () => { completed++ })
  assert.equal(completed, 2)
  h.advance(29000)
  h.tick()
  const entries = h.entries.filter(([, scope]) => scope === 'renderer-hang')
  assert.equal(entries.length, 1)
  assert.equal(entries[0][2], '渲染进程 30s 无应答；最近执行位置：finished-listener → returned.ts:42（29s 前记录）（不代表该回调仍未完成）')
  h.tick()
  assert.equal(h.entries.filter(([, scope]) => scope === 'renderer-hang').length, 1)
})

test('渲染进程已崩溃：不重复报挂死，恢复后重新计算心跳且清除旧位置', () => {
  let crashed = true
  const sent = []
  const win = { isDestroyed: () => false, webContents: { isCrashed: () => crashed, send: channel => sent.push(channel) } }
  const h = mountPerf(undefined, false, () => win)
  h.ipc.emit('kuma:perf-breadcrumb', {}, 'old-renderer')
  h.advance(30000)
  h.tick()
  assert.equal(sent.length, 0)
  assert.equal(h.entries.filter(([, scope]) => scope === 'renderer-hang').length, 0)
  crashed = false
  h.advance(10000)
  h.tick()
  assert.equal(h.entries.filter(([, scope]) => scope === 'renderer-hang').length, 0)
  h.ipc.emit('kuma:perf-alive', {})
  h.advance(26000)
  h.tick()
  const hangs = h.entries.filter(([, scope]) => scope === 'renderer-hang')
  assert.equal(hangs.length, 1)
  assert.match(hangs[0][2], /26s 无应答/)
  assert.doesNotMatch(hangs[0][2], /old-renderer/)
})

test('主进程计时 sink：安装后按现有 main scope 格式记录', () => {
  const { timing, entries } = mountPerf()
  timing.api.timeMain('patch', () => timing.advance(60), () => 'ships,decks')
  assert.deepEqual(entries, [['main', 'patch', '耗时 60.0ms · ships,decks']])
})

test('GC：只记达到阈值的条目，种类与 flags 读取 entry.detail', () => {
  for (const threshold of [undefined, '80']) {
    const limit = threshold ? 80 : 50
    const { gcObserver, gcOptions, entries } = mountPerf(threshold)
    assert.deepEqual([...gcOptions.entryTypes], ['gc'])
    gcObserver({ getEntries: () => [
      { duration: limit - 0.1, detail: { kind: 1, flags: 0 } },
      { duration: limit, detail: { kind: 4, flags: 2 }, get kind() { throw new Error('deprecated getter') } },
    ] })
    assert.deepEqual(entries, [['main', 'gc', `耗时 ${limit.toFixed(1)}ms · kind 4 · flags 2`]])
  }
})

test('GC：observe 不支持时不抛错，IPC 与事件循环仍可记录', () => {
  const { ipc, entries, tick } = mountPerf(undefined, true)
  ipc.emit('kuma:perf', {}, { scope: 'longtask', ms: 80 })
  tick()
  assert.deepEqual(entries.map((entry) => entry[1]), ['longtask', 'loop-lag'])
})

test('redactPerfDetail：隐去 & 前、串尾与空白前的 api_token/token，无凭据原样返回', () => {
  const { redactPerfDetail } = mountPerf()
  for (const [detail, expected] of [
    ['?api_token=abc&api_root=/kcsapi', '?api_token=［已隐去］&api_root=/kcsapi'],
    ['api_token=abc', 'api_token=［已隐去］'],
    ['token=abc', 'api_token=［已隐去］'],
    ['token=abc&api_token=def @ /game', 'api_token=［已隐去］&api_token=［已隐去］ @ /game'],
    ['token=abc\nself', 'api_token=［已隐去］\nself'],
    ['token=', 'api_token=［已隐去］'],
    ['iframe#htmlWrap · /kcs2/index.php @ /game/kancolle', 'iframe#htmlWrap · /kcs2/index.php @ /game/kancolle'],
    ['', ''],
  ]) {
    assert.equal(redactPerfDetail(detail), expected)
  }
})

test('perf IPC：game 与 renderer 的 detail 都在写日志前隐去凭据', () => {
  const { ipc, entries } = mountPerf()
  for (const source of ['game', 'renderer']) {
    ipc.emit('kuma:perf', {}, {
      source, scope: 'longtask', ms: 80,
      detail: '/index.php?api_token=abc&token=def @ /game',
    })
  }
  assert.equal(entries.length, 2)
  for (const [, , message] of entries) {
    assert.equal(message, '长任务 80ms · 大头：/index.php?api_token=［已隐去］&api_token=［已隐去］ @ /game')
  }
})

// 执行 preload 中真实的探针安装与回调，不加载音频、抓包等无关钩子。
const preload = readFileSync(new URL('../assets/preload/webview-preload.js', import.meta.url), 'utf8')
const probeStart = preload.indexOf('// 隔离世界与游戏主世界共用主线程')
const probeEnd = preload.indexOf('// 桥进页面主世界的特权 API。', probeStart)
assert.ok(probeStart >= 0 && probeEnd > probeStart)
const mountGameProbe = (frame = 'top') => {
  const window = {}
  Object.defineProperty(window, 'top', { get: () => {
    if (frame === 'throws') throw new Error('cross-origin access denied')
    return frame === 'top' ? window : {}
  } })
  const sends = []
  let observer, installed = 0, observed
  vm.runInNewContext(preload.slice(probeStart, probeEnd), {
    window, URL,
    location: { pathname: '/game/kancolle' },
    readEnv: () => undefined,
    ipcRenderer: { send: (...args) => sends.push(args) },
    PerformanceObserver: class {
      constructor(callback) { installed++; observer = callback }
      observe(options) { observed = options.entryTypes }
    },
  })
  return { sends, observer, installed, observed }
}

test('游戏顶层 longtask：归因只保留路径，不包含地址、query 或 hash', () => {
  const { sends, observer, installed, observed } = mountGameProbe()
  assert.equal(installed, 1)
  assert.deepEqual([...observed], ['longtask'])
  observer({ getEntries: () => [{ duration: 80, attribution: [{
    containerType: 'iframe', containerId: 'htmlWrap', containerName: 'game', name: 'unknown',
    containerSrc: 'https://w09s.kancolle-server.com/kcs2/index.php?api_root=/kcsapi&api_token=abc#fragment',
  }] }] })
  assert.equal(sends.length, 1)
  assert.equal(sends[0][0], 'kuma:perf')
  const entry = sends[0][1]
  assert.deepEqual({ ...entry }, {
    source: 'game', scope: 'longtask', ms: 80,
    detail: 'iframe#htmlWrap · game · /kcs2/index.php · unknown @ /game/kancolle',
  })
  assert.doesNotMatch(entry.detail, /api_token|\?|w09s\.kancolle-server\.com|https?:|#fragment/)
})

test('游戏 longtask：空地址或解析失败时省略路径段', () => {
  const { sends, observer } = mountGameProbe()
  for (const containerSrc of ['', 'invalid?api_token=abc']) {
    observer({ getEntries: () => [{ duration: 80, attribution: [{
      containerType: 'iframe', containerId: 'htmlWrap', containerName: '', name: 'unknown', containerSrc,
    }] }] })
  }
  assert.equal(sends.length, 2)
  for (const [, entry] of sends) {
    assert.equal(entry.detail, 'iframe#htmlWrap · unknown @ /game/kancolle')
  }
})

for (const frame of ['child', 'throws']) {
  test(`游戏 longtask：${frame === 'child' ? '非顶层帧' : '访问 top 抛错'}不安装观测器`, () => {
    const { installed, observed, sends } = mountGameProbe(frame)
    assert.equal(installed, 0)
    assert.equal(observed, undefined)
    assert.deepEqual(sends, [])
  })
}

test('perf IPC：只有 game 来源写 game · longtask，其余保持 renderer', () => {
  const { ipc, entries } = mountPerf()
  for (const source of ['game', 'renderer', 'unknown', undefined, null]) {
    ipc.emit('kuma:perf', {}, { source, scope: 'longtask', ms: 75.6, detail: 'self @ /kcs2/index.html' })
  }
  assert.deepEqual(entries.map(([source]) => source), ['game', 'renderer', 'renderer', 'renderer', 'renderer'])
  for (const [, scope, message] of entries) {
    assert.equal(scope, 'longtask')
    assert.equal(message, '长任务 76ms · 大头：self @ /kcs2/index.html')
  }
})

test('事件循环直方图复用 10s 看门狗，无窗口也记录并每拍 reset', () => {
  const { tick, entries, stats } = mountPerf()
  assert.deepEqual(stats(), { period: 10000, enabled: 1, resets: 0, unrefs: 1 })
  tick()
  assert.deepEqual(entries, [[
    'main', 'loop-lag',
    '10s 内事件循环最大延迟 123.4ms · p99 28.7ms · 均值 12.6ms（采样分辨率 10ms）',
  ]])
  tick()
  assert.equal(entries.length, 1, 'reset 后不得重复报上一拍峰值')
  assert.equal(stats().resets, 2)
})

test('事件循环阈值接受正数，无效值默认 50ms，等于阈值也记录', () => {
  for (const [threshold, limit] of [[undefined, 50], ['bad', 50], ['0', 50], ['-1', 50], ['80', 80]]) {
    const { tick, entries, histogram, stats } = mountPerf(threshold)
    histogram.max = (limit - 0.1) * 1e6
    tick()
    assert.equal(entries.length, 0)
    histogram.max = limit * 1e6
    tick()
    assert.equal(entries.length, 1)
    assert.equal(stats().resets, 2)
  }
})
