import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { transformSync } from 'esbuild'
import bgmPlan from '../dist/shared/bgm-archive-plan.js'
import artPlan from '../dist/shared/art-archive-plan.js'
import assetPlan from '../dist/shared/asset-archive-plan.js'
import voicePlan from '../dist/shared/voice-archive-plan.js'
import voiceGate from '../dist/shared/voice-request-gate.js'

const pathname = '/kcs2/resources/bgm/battle/279_7311.mp3'
const url = 'https://example.invalid' + pathname + '?version=2'
const source = fs.readFileSync(new URL('../src/main/archive-capture.ts', import.meta.url), 'utf8')
const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code

const mount = ({ cached = null, enabled = true, remote = new Uint8Array([1, 2, 3]) } = {}) => {
  const requests = []
  const kept = []
  const timers = []
  const cleared = []
  const stubs = {
    fs: { readFileSync: () => cached }, path,
    electron: { net: { fetch: async (...args) => {
      requests.push(args)
      return { ok: true, arrayBuffer: async () => remote.buffer }
    } } },
    './config': { get: (key, fallback) => key === 'kuma.remoteArt' ? enabled : fallback },
    './env': { ROOT: '.', DEFAULT_CACHE_PATH: 'cache' },
    './crash-log': { safeConsole: () => {} },
    './art-archive': {}, './voice-archive': {},
    './asset-archive': {},
    '../shared/asset-archive-plan': assetPlan,
    './bgm-archive': { keepBgmBlob: (value) => { kept.push(value); return value } },
    '../shared/bgm-archive-plan': bgmPlan,
    '../shared/art-archive-plan': artPlan,
    '../shared/voice-archive-plan': voicePlan,
    '../shared/voice-request-gate': voiceGate,
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(
    (id) => id.endsWith('kcs-resource-path')
      ? { getCacheCandidatePaths: () => cached ? ['cached.mp3'] : [] }
      : stubs[id] ?? assert.fail('unexpected import: ' + id),
    mod, mod.exports,
    (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    (id) => cleared.push(id),
  )
  return { capture: mod.exports.captureDisplayedBgm, requests, kept, timers, cleared }
}

test('BGM 主进程现取：缓存优先，离线也能入档；版本与路径交 keepBgmBlob', async () => {
  const bytes = new Uint8Array([3, 2, 1])
  const main = mount({ cached: bytes, enabled: false })
  await main.capture(pathname, url)
  assert.deepEqual(main.requests, [])
  assert.deepEqual(main.kept, [{ pathname, version: '2', bytes }])
})

test('BGM 主进程现取：无缓存且开关开启才取一次，沿用 12 秒超时和单条上限', async () => {
  const main = mount()
  assert.ok(await main.capture(pathname, url))
  assert.equal(main.requests.length, 1)
  assert.equal(main.requests[0][0], url)
  assert.equal(main.timers[0].delay, 12_000)
  main.timers[0].callback()
  assert.equal(main.requests[0][1].signal.aborted, true)
  assert.deepEqual(main.cleared, [1])
  const off = mount({ enabled: false })
  assert.equal(await off.capture(pathname, url), null)
  assert.deepEqual(off.requests, [])
  const large = mount({ remote: new Uint8Array(bgmPlan.BGM_ARCHIVE_MAX_ENTRY_BYTES + 1) })
  assert.equal(await large.capture(pathname, url), null)
  assert.deepEqual(large.kept, [])
})

test('BGM 主进程现取：路径正则拒绝越界、其他资源及无效曲树', async () => {
  const main = mount()
  for (const invalid of [null, '', '/kcsapi/test', '/kcs2/resources/bgm/fanfare/001_1234.mp3', '/kcs2/resources/bgm/battle/../279_7311.mp3']) {
    assert.equal(await main.capture(invalid, url), null)
  }
  assert.deepEqual(main.requests, [])
  assert.deepEqual(main.kept, [])
})

test('BGM UI 收货口：形状不合不调用，UI sender 可用，成功广播、失败回执', async () => {
  // 执行生产注册段；其余 mg 装配会打开账本，所以只隔离这一段，绝不载入用户数据。
  const mg = fs.readFileSync(new URL('../src/main/mg/index.ts', import.meta.url), 'utf8')
  const start = mg.indexOf("ipcMain.on('kuma:archive-capture-bgm'")
  const end = mg.indexOf('\n})', start) + 3
  assert.ok(start > 0 && end > start)
  let handler
  let result = { pathname, bytes: 3 }
  const captures = []
  const emitted = []
  const replies = []
  const event = { sender: { id: 999, isDestroyed: () => false }, reply: (...args) => replies.push(args) }
  new Function('ipcMain', 'captureDisplayedBgm', 'broadcaster',
    transformSync(mg.slice(start, end), { loader: 'ts' }).code)(
    { on: (channel, fn) => { assert.equal(channel, 'kuma:archive-capture-bgm'); handler = fn } },
    async (...args) => { captures.push(args); return result },
    { emit: (...args) => emitted.push(args) },
  )
  for (const bad of [null, 'x', [], {}, { pathname, url: 1 }, { pathname: 1, url }]) handler(event, bad)
  assert.deepEqual(captures, [])
  handler(event, { pathname, url })
  await Promise.resolve()
  assert.deepEqual(captures, [[pathname, url]])
  assert.deepEqual(emitted, [['kancolle.bgm.archived', result]])
  assert.deepEqual(replies, [])
  result = null
  handler(event, { pathname, url })
  await Promise.resolve()
  assert.deepEqual(replies, [['kuma:archive-capture-bgm-failed', pathname]])
})
