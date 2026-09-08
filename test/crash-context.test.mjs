import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { transformSync } from 'esbuild'
import context from '../dist/shared/crash-context.js'
import envNames from '../dist/shared/env-names.js'
import { textErrors } from '../scripts/lib/evidence-text-audit.mjs'

const { createMemoryTrail, createLastApiMemo, formatMemoryTrail, formatLastApis, formatLastBreadcrumb, formatCrashDumps } = context
const MB = 1024 * 1024
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))

test('README 新增转储说明经过出处禁词表，不含禁词且明确不上传', () => {
  const line = read('../README.md').split('\n').find(line => line.includes('%APPDATA%/kuma/crash-dumps'))
  assert.ok(line)
  assert.match(line, /只存本地.*不上传.*本地排查/)
  assert.deepEqual(textErrors([{ file: 'README.md', field: '转储说明', text: line }]), [])
})

test('内存环形轨迹：上限、先后顺序、同轮合并和迟到补报', () => {
  const trail = createMemoryTrail(12)
  for (let ts = 0; ts <= 120_000; ts += 10_000) {
    trail.push({ ts, jsHeapUsed: ts })
    trail.push({ ts, private: ts })
  }
  assert.equal(trail.list().length, 12)
  assert.deepEqual(trail.list().map(s => s.ts), Array.from({ length: 12 }, (_, i) => (i + 1) * 10_000))
  trail.push({ ts: 20_000, residentSet: 123 })
  assert.deepEqual(trail.list()[1], { ts: 20_000, jsHeapUsed: 20_000, private: 20_000, residentSet: 123 })
  trail.push({ ts: 0, private: 456 })
  assert.equal(trail.list()[0].ts, 10_000)
  const snapshot = trail.list()
  snapshot[0].private = -1
  assert.equal(trail.list()[0].private, 10_000)
})

test('内存格式：KB 与字节各自换算、MB 取整、相对秒数和缺项', () => {
  assert.equal(formatMemoryTrail([], 100_000), '（尚无内存样本）')
  assert.equal(formatMemoryTrail([
    { ts: 10_000, private: 512 * 1024, residentSet: 640 * 1024, jsHeapUsed: 180 * MB, jsHeapTotal: 210 * MB },
    { ts: 98_400, private: 1.6 * 1024, jsHeapUsed: 0.49 * MB },
    { ts: 100_000, jsHeapTotal: 1.5 * MB, residentSet: 0 },
  ], 100_000), '-90s 私有 512 MB · 常驻 640 MB · JS 堆 180/210 MB\n-2s 私有 2 MB · JS 堆 0/? MB\n-0s 常驻 0 MB · JS 堆 ?/2 MB')
  assert.equal(formatMemoryTrail([{ ts: 101_000 }], 100_000), '-0s （内存指标不可用）')
})

test('最后报文：只留最近三条，入备忘前截掉整个查询串', () => {
  const memo = createLastApiMemo()
  for (let ts = 1; ts <= 4; ts++) memo.push({ path: `/kcsapi/api_${ts}?fixture=discard&extra=discard`, ts })
  assert.deepEqual(memo.list(), [2, 3, 4].map(ts => ({ path: `/kcsapi/api_${ts}`, ts })))
  memo.list()[0].path = 'changed'
  assert.equal(memo.list()[0].path, '/kcsapi/api_2')
  assert.equal(formatLastApis(memo.list(), 21_004), '/kcsapi/api_2 21s 前\n/kcsapi/api_3 21s 前\n/kcsapi/api_4 21s 前')
  assert.equal(formatLastApis([], 0), '（尚无报文记录）')
})

test('最近执行位置：年龄与未完成免责声明，含尚无记录', () => {
  assert.equal(formatLastBreadcrumb({ lastBreadcrumb: 'patch → panel.ts:42', breadcrumbTs: 79_000 }, 100_000),
    'patch → panel.ts:42（21s 前记录）（不代表该回调仍未完成）')
  assert.equal(formatLastBreadcrumb({ lastBreadcrumb: '(尚无分发记录)', breadcrumbTs: 0 }, 100_000),
    '(尚无分发记录)（不代表该回调仍未完成）')
})

test('转储格式：数量、最新文件名、一位小数 MB 与空态', () => {
  assert.equal(formatCrashDumps({ count: 0 }), '崩溃前后没有新转储')
  assert.equal(formatCrashDumps({ count: 1, latest: { name: 'sample.dmp', size: Math.round(2.3 * MB), mtime: 1000 } }),
    '崩溃转储 1 个：sample.dmp 2.3 MB')
})

const mountDumps = (root, disabled) => {
  const calls = []
  let dumpPath
  const module = { exports: {} }
  vm.runInNewContext(read('../dist/main/crash-dumps.js'), {
    module, exports: module.exports,
    require: id => {
      if (id === 'electron') return {
        app: {
          setPath: (name, value) => { assert.ok(fs.statSync(value).isDirectory()); calls.push(['path', name, value]); dumpPath = value },
          getPath: name => { assert.equal(name, 'crashDumps'); return dumpPath },
        },
        crashReporter: { start: options => calls.push(['start', plain(options)]) },
      }
      if (id === 'fs') return fs
      if (id === 'path') return path
      if (id === './env') return { APPDATA_PATH: root, KUMA_VERSION: 'fixture' }
      if (id === './crash-log') return { safeConsole: (...args) => calls.push(['print', ...args]) }
      if (id === '../shared/env-names') return { readEnv: name => envNames.readEnv(name, { KUMA_CRASH_DUMPS: disabled }) }
      throw new Error(`unexpected require: ${id}`)
    },
  })
  return { ...module.exports, calls }
}

test('转储安装与枚举：隔离临时目录、准确选项、递归和 mtime 下界', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kuma-crash-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const h = mountDumps(root)
  h.installCrashDumps()
  const dumps = path.join(root, 'crash-dumps')
  assert.deepEqual(h.calls.slice(0, 2), [
    ['path', 'crashDumps', dumps],
    ['start', { productName: 'kuma', uploadToServer: false, rateLimit: false, compress: false, extra: { kumaVersion: 'fixture' } }],
  ])
  assert.match(h.calls[2][2], /崩溃转储：本地目录，不上传/)
  assert.deepEqual(plain(h.summarizeCrashDumps(100_000)), { count: 0 })
  for (const [file, ts, bytes] of [
    ['old.dmp', 98_999, 1], ['reports/boundary.dmp', 99_000, 2],
    ['pending/nested/new.DMP', 103_000, 3], ['pending/ignored.txt', 104_000, 4],
  ]) {
    const target = path.join(dumps, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, Buffer.alloc(bytes))
    utimesSync(target, new Date(ts), new Date(ts))
  }
  assert.deepEqual(plain(h.summarizeCrashDumps(100_000)), {
    count: 2, latest: { name: 'new.DMP', size: 3, mtime: 103_000 },
  })
  rmSync(dumps, { recursive: true })
  assert.deepEqual(plain(h.summarizeCrashDumps(100_000)), { count: 0 })
})

test('关闭转储时不建目录、不安装，也不读取默认转储目录', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kuma-crash-off-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const h = mountDumps(root, '0')
  h.installCrashDumps()
  assert.deepEqual(h.calls, [])
  assert.equal(fs.existsSync(path.join(root, 'crash-dumps')), false)
  assert.deepEqual(plain(h.summarizeCrashDumps(0)), { count: 0 })
})

const mountRenderer = (memory, getProcessMemoryInfo) => {
  const listeners = new Map(), sent = []
  const module = { exports: {} }
  const code = transformSync(read('../src/renderer/perf-guard.ts'), { loader: 'ts', format: 'cjs' }).code
  vm.runInNewContext(code, {
    module, exports: module.exports,
    Date: { now: () => 100_000 },
    performance: { now: () => 0, memory }, process: { getProcessMemoryInfo },
    PerformanceObserver: class { observe() {} },
    require: id => {
      if (id === 'electron') return { ipcRenderer: {
        on: (channel, cb) => listeners.set(channel, cb), send: (...args) => sent.push(plain(args)),
      } }
      if (id === '../shared/env-names') return { readEnv: () => undefined }
      if (id === './crash-guard') return { recordCrash() {} }
      throw new Error(`unexpected require: ${id}`)
    },
  })
  return { ping: listeners.get('kuma:perf-ping'), sent }
}

test('心跳实际行为：异步查询未结束就已回 alive 和 JS 堆，结束后同轮补报', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const h = mountRenderer({ usedJSHeapSize: 180 * MB, totalJSHeapSize: 210 * MB }, () => {
    assert.equal(h.sent[0][0], 'kuma:perf-alive')
    return pending
  })
  h.ping()
  assert.deepEqual(h.sent, [
    ['kuma:perf-alive'], ['kuma:perf-memory', { jsHeapUsed: 180 * MB, jsHeapTotal: 210 * MB }, 100_000],
  ])
  resolve({ residentSet: 640 * 1024, private: 512 * 1024 })
  await pending
  assert.deepEqual(h.sent[2], ['kuma:perf-memory', { residentSet: 640 * 1024, private: 512 * 1024 }, 100_000])
})

test('心跳实际行为：内存 API 缺失或拒绝都不影响同步 alive', async () => {
  for (const query of [undefined, () => Promise.reject(new Error('unavailable'))]) {
    const h = mountRenderer(undefined, query)
    h.ping()
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(h.sent, [['kuma:perf-alive'], ['kuma:perf-memory', {}, 100_000]])
  }
})

test('崩溃事件实际行为：原行后追加现场、3 秒后列转储、定时器 unref', () => {
  const app = new EventEmitter(), ipcMain = new EventEmitter(), records = [], timers = [], since = []
  ipcMain.handle = () => {}
  let unrefs = 0, clock = 100_000
  const module = { exports: {} }
  class FakeDate extends Date { static now() { return clock } }
  vm.runInNewContext(read('../dist/main/crash-log.js'), {
    module, exports: module.exports, Date: FakeDate, console: { error() {}, warn() {} },
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return { unref: () => { unrefs++ } } },
    require: id => {
      if (id === 'electron') return { app, ipcMain }
      if (id === 'path') return path
      if (id === 'fs') return { mkdirSync() {}, statSync: () => ({ size: 0 }), appendFileSync: (_file, block) => records.push(block) }
      if (id === './env') return { APPDATA_PATH: 'fixture', KUMA_VERSION: 'fixture' }
      if (id === '../shared/crash-context') return context
      if (id === './crash-dumps') return { summarizeCrashDumps: ts => { since.push(ts); return { count: 1, latest: { name: 'sample.dmp', size: Math.round(2.3 * MB), mtime: clock } } } }
      if (id === './mg') return { lastApiPaths: () => [{ path: '/kcsapi/api_req_sortie/battleresult', ts: 79_000 }] }
      if (id === './perf-log') return {
        lastBreadcrumbInfo: () => ({ lastBreadcrumb: 'patch → panel.ts:42', breadcrumbTs: 98_000 }),
        recentMemoryTrail: () => [{ ts: 10_000, private: 512 * 1024, residentSet: 640 * 1024, jsHeapUsed: 180 * MB, jsHeapTotal: 210 * MB }],
      }
      throw new Error(`unexpected require: ${id}`)
    },
  })
  module.exports.installCrashLogging()
  app.emit('render-process-gone', {}, { getURL: () => 'fixture-window' }, { reason: 'crashed', exitCode: -1073741819 })
  assert.equal(records.length, 2)
  assert.match(records[0], /render-process-gone · crashed exit=-1073741819 · vfixture\nfixture-window/)
  assert.match(records[1], /crash-context · crashed · vfixture\n最后报文：\n\/kcsapi\/api_req_sortie\/battleresult 21s 前\n最近执行位置：patch → panel.ts:42（2s 前记录）（不代表该回调仍未完成）\n内存轨迹：\n-90s 私有 512 MB · 常驻 640 MB · JS 堆 180\/210 MB/)
  assert.equal(timers[0].ms, 3000)
  assert.equal(unrefs, 1)
  clock += 3000
  timers[0].callback()
  assert.deepEqual(since, [100_000])
  assert.match(records[2], /crash-dumps · renderer\/crashed · vfixture\n崩溃转储 1 个：sample.dmp 2.3 MB/)
  app.emit('child-process-gone', {}, { reason: 'clean-exit', type: 'GPU' })
  assert.equal(timers.length, 1)
  app.emit('child-process-gone', {}, { reason: 'crashed', type: 'GPU' })
  assert.equal(timers.length, 2)
  assert.equal(unrefs, 2)
  timers[1].callback()
  assert.match(records.at(-1), /crash-dumps · GPU\/crashed/)
})

// 初始化顺序与同步调用位置是源码结构契约；Electron 入口无法在 Node 中直接导入，
// 导入铭还会回放账本。这里只断言接线，格式化、采样和事件行为已在上面真实执行。
test('源码接线：目录与安装顺序、同步心跳，以及路径备忘先于解析', () => {
  const main = read('../src/main/index.ts')
  const installed = main.indexOf('installCrashDumps()')
  assert.ok(installed > main.indexOf("app.setPath('userData'"))
  assert.ok(installed < main.indexOf('installCrashLogging()'))
  assert.ok(installed < main.indexOf("app.on('ready'"))
  assert.ok(installed < main.indexOf('new BrowserWindow('))
  const dumps = read('../src/main/crash-dumps.ts')
  assert.ok(dumps.indexOf("app.setPath('crashDumps'") < dumps.indexOf('crashReporter.start('))
  const renderer = read('../src/renderer/perf-guard.ts')
  assert.match(renderer, /ipcRenderer\.on\('kuma:perf-ping', \(\) => \{\s*try \{\s*ipcRenderer\.send\('kuma:perf-alive'\)/)
  const mg = read('../src/main/mg/index.ts')
  assert.match(mg, /if \(!apiPath\?\.startsWith\('\/kcsapi'\)\) return\s+lastApis\.push\(\{ path: apiPath, ts \}\)/)
  assert.match(mg, /export const lastApiPaths = \(\) => lastApis\.list\(\)/)
})

test('编译后的日志模块加载不提前加载铭或性能日志，避免改变启动顺序', () => {
  const required = []
  const module = { exports: {} }
  const localRequire = createRequire(new URL('../dist/main/crash-log.js', import.meta.url))
  vm.runInNewContext(read('../dist/main/crash-log.js'), {
    module, exports: module.exports,
    require: id => {
      required.push(id)
      if (id === 'electron') return {}
      if (id === './env') return { APPDATA_PATH: 'fixture' }
      if (id === './crash-dumps') return {}
      return localRequire(id)
    },
  })
  assert.ok(!required.includes('./mg'))
  assert.ok(!required.includes('./perf-log'))
})
