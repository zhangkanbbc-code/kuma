import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import ts from 'typescript'
import scenes from '../dist/shared/launch-welcome-scene.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-welcome-recorded-'))
let createWelcomeSceneMemory
try {
  const outfile = path.join(dir, 'memory.cjs')
  buildSync({ entryPoints: [path.join(root, 'src/renderer/launch-welcome-memory.ts')], outfile,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  ;({ createWelcomeSceneMemory } = require(outfile))
} finally { fs.rmSync(dir, { recursive: true, force: true }) }

const { selectWelcomeScene, calendarWelcomeScene, WELCOME_SCENE_CONFIG_KEY } = scenes
const now = Date.parse('2026-10-23T12:00:00+09:00')
const input = () => ({
  master: { api_mst_maparea: [{ api_id: 1, api_type: 0 }], api_mst_mapinfo: [],
    api_mst_useitem: [{ api_id: 100, api_name: '南瓜' }] },
  useitems: { 100: 0 }, quests: [], mapGauges: {}, lifecycle: null, now,
})
const configOf = () => {
  const values = new Map([[WELCOME_SCENE_CONFIG_KEY, { key: 'base' }]])
  const writes = []
  return { writes, get: (key, fallback) => values.get(key) ?? fallback,
    set: (key, value) => { values.set(key, structuredClone(value)); writes.push([key, structuredClone(value)]) } }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const persistedConfig = (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-welcome-config-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'config.json')
  fs.writeFileSync(file, JSON.stringify({ kuma: { launchWelcomeScene: { v1: { key: 'base' } } } }))
  // 使用真实配置读写及原子落盘，仅替换存储目录和窗口广播依赖。
  const configSource = fs.readFileSync(path.join(root, 'src/main/config.ts'), 'utf8')
    .replace("import { APPDATA_PATH, DEFAULT_CACHE_PATH } from './env'",
      `const APPDATA_PATH = ${JSON.stringify(folder)}, DEFAULT_CACHE_PATH = ${JSON.stringify(path.join(folder, 'cache'))}`)
  const outfile = path.join(folder, 'config.cjs')
  buildSync({ stdin: { contents: configSource, loader: 'ts', resolveDir: path.join(root, 'src/main') }, outfile,
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
  const module = { exports: {} }
  const isolatedRequire = (id) => id === 'electron' ? { BrowserWindow: { getAllWindows: () => [] }, ipcMain: {} } : require(id)
  new Function('require', 'module', 'exports', fs.readFileSync(outfile, 'utf8'))(isolatedRequire, module, module.exports)
  const config = module.exports
  config.writes = []
  config.on('config.set', (key, value) => config.writes.push([key, structuredClone(value)]))
  return { config, read: () => JSON.parse(fs.readFileSync(file, 'utf8')).kuma.launchWelcomeScene.v1 }
}

// 只执行真实启动接线，隔离 DOM、IPC 和玩家文件；不复制输入装配的实现。
const source = ts.createSourceFile('index.ts', fs.readFileSync(path.join(root, 'src/renderer/index.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const calls = []
const visit = (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'installWelcomeSceneMemory') calls.push(node)
  ts.forEachChild(node, visit)
}
visit(source)
assert.equal(calls.length, 1)
const install = (dependencies) => {
  const code = ts.transpileModule(calls[0].getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
}
const startup = (overrides = {}) => {
  const config = overrides.config ?? configOf(), errors = [], listeners = new Set(), queries = []
  const state = input()
  let sources, memory
  install({ config, snapshotReady: Promise.resolve(), mg: state,
    LAUNCH_GLOW_CONFIG_KEY: 'kuma.launchGlow', LAUNCH_GLOW_DEFAULT: true,
    onMgChange: (changed) => { listeners.add(changed); return () => listeners.delete(changed) },
    recordCrash: (...args) => errors.push(args),
    queryMasterRaw: async () => { queries.push('master'); return { data: state.master } },
    queryLode: async (key) => { queries.push(key); return { data: state.lifecycle } },
    querySeasonalHistory: async () => { queries.push('history'); return [{ key: 'pumpkin' }] },
    ...overrides,
    installWelcomeSceneMemory: (next, enabled) => {
      sources = next
      memory = createWelcomeSceneMemory(next)
      memory.setEnabled(enabled)
    },
  })
  return { config, errors, listeners, queries, state, sources, memory }
}

test('10 月 23 日：南瓜花光、任务为空时，本季记录选万圣节；无记录按实际日历兜底', () => {
  const state = input()
  assert.deepEqual(calendarWelcomeScene(now), { key: 'base' })
  assert.deepEqual(selectWelcomeScene(state), calendarWelcomeScene(now))
  assert.deepEqual(selectWelcomeScene({ ...state, recordedCampaignKeys: ['pumpkin'] }), { key: 'halloween' })
})

test('持有南瓜或任务点名南瓜仍选万圣节，有活动图仍优先活动幕', () => {
  for (const signal of [{ useitems: { 100: 1 } }, { quests: [{ no: 900, title: '南瓜を集めよう' }] }]) {
    const state = { ...input(), ...signal }
    assert.deepEqual(selectWelcomeScene(state), { key: 'halloween' })
    assert.deepEqual(selectWelcomeScene({ ...state, recordedCampaignKeys: ['pumpkin'] }), { key: 'halloween' })
  }
  const state = { ...input(), recordedCampaignKeys: ['pumpkin'] }
  state.master.api_mst_maparea.push({ api_id: 63, api_type: 1 })
  state.master.api_mst_mapinfo.push({ api_id: 631, api_maparea_id: 63, api_no: 1 })
  assert.equal(selectWelcomeScene(state).key, 'event')
})

test('真实启动输入 → 记忆订阅 → 已存 base 改回万圣节，下一次刷新不重复写', async (t) => {
  const saved = persistedConfig(t)
  const run = startup({ config: saved.config })
  try {
    assert.deepEqual(saved.read(), { key: 'base' })
    assert.deepEqual(run.config.get(WELCOME_SCENE_CONFIG_KEY, null), { key: 'base' })
    await flush()
    assert.deepEqual((await run.sources.input()).recordedCampaignKeys, ['pumpkin'])
    assert.deepEqual(run.config.get(WELCOME_SCENE_CONFIG_KEY, null), { key: 'halloween' })
    assert.deepEqual(saved.read(), { key: 'halloween' })
    assert.deepEqual(run.config.writes, [[WELCOME_SCENE_CONFIG_KEY, { key: 'halloween' }]])
    for (const changed of run.listeners) changed(['useitems'])
    await flush()
    assert.equal(run.config.writes.length, 1)
    assert.deepEqual(run.errors, [])
  } finally { run.memory.setEnabled(false) }
})

test('输入装配先等快照；其后才查询主数据、活动生命周期与本季记录', async () => {
  let release
  const snapshotReady = new Promise((resolve) => { release = resolve })
  const run = startup({ snapshotReady })
  try {
    await flush()
    assert.deepEqual(run.queries, [])
    release()
    await flush()
    assert.deepEqual(run.queries, ['master', 'event-lifecycle', 'history'])
    assert.deepEqual(run.config.get(WELCOME_SCENE_CONFIG_KEY, null), { key: 'halloween' })
  } finally { run.memory.setEnabled(false) }
})

test('本季记录查询失败：上报原错误，输入带空列表，持有、任务、活动与日历信号照常选幕', async () => {
  const error = new Error('seasonal history unavailable')
  const run = startup({ querySeasonalHistory: async () => { throw error } })
  try {
    await flush()
    assert.deepEqual(run.errors, [['startup:welcome-scene-memory', error]])
    const assembled = await run.sources.input()
    assert.ok(assembled)
    assert.deepEqual(assembled.recordedCampaignKeys, [])
    assert.deepEqual(selectWelcomeScene({ ...assembled, now }), calendarWelcomeScene(now))
    run.state.useitems[100] = 1
    for (const changed of run.listeners) changed(['useitems'])
    await flush()
    assert.deepEqual(run.config.get(WELCOME_SCENE_CONFIG_KEY, null), { key: 'halloween' })
    run.state.useitems[100] = 0
    run.state.quests.push({ no: 900, title: '南瓜を集めよう' })
    assert.deepEqual(selectWelcomeScene(await run.sources.input()), { key: 'halloween' })
    run.state.master.api_mst_maparea.push({ api_id: 63, api_type: 1 })
    run.state.master.api_mst_mapinfo.push({ api_id: 631, api_maparea_id: 63, api_no: 1 })
    assert.equal(selectWelcomeScene(await run.sources.input()).key, 'event')
    assert.ok(run.errors.every(([stage, reported]) => stage === 'startup:welcome-scene-memory' && reported === error))
  } finally { run.memory.setEnabled(false) }
})
