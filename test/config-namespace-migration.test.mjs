import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import namespace from '../dist/shared/config-namespace.js'
import runtimeEnv from '../dist/shared/env-names.js'

const { CONFIG_ROOT, LEGACY_CONFIG_ROOT, planConfigMigration } = namespace
const mainDir = fileURLToPath(new URL('../dist/main/', import.meta.url))

test('配置命名空间：新名与永久迁移所需旧名', () => {
  assert.equal(CONFIG_ROOT, 'kuma')
  assert.equal(LEGACY_CONFIG_ROOT, 'kanso')
})

for (const [hasLegacy, hasCurrent, migrate] of [
  [true, false, true],
  [false, false, false],
  [false, true, false],
  [true, true, false],
]) {
  test(`配置迁移判定：旧=${hasLegacy} 新=${hasCurrent} → 搬=${migrate}`, () => {
    assert.deepEqual(planConfigMigration({ hasLegacy, hasCurrent }), { migrate })
  })
}

// 加载真实构建产物；仅替换 Electron 的 app 与进程环境，所有 fs 和 save 均走真实实现。
// appData 也指向夹具内部，连 existsSync 都不接触玩家的正式目录，不启动 Electron。
const fixture = (t, initial) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-config-migration-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(initial))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const loadModule = (name, overrides, processStub = process) => {
    const filename = path.join(mainDir, name)
    const localRequire = createRequire(filename)
    const module = { exports: {} }
    const requireStub = (id) => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id)
    const run = new Function('require', 'module', 'exports', '__dirname', 'process', 'global',
      fs.readFileSync(filename, 'utf8'))
    run(requireStub, module, module.exports, mainDir, processStub, {})
    return module.exports
  }
  const start = () => {
    const env = loadModule('env.js', {
      electron: { app: { getVersion: () => 'fixture', getPath: () => path.join(dir, 'appData') } },
      '../shared/env-names': { readEnv: (name) => runtimeEnv.readEnv(name, { KUMA_DATA_DIR: dir }) },
    }, { env: { KUMA_DATA_DIR: dir } })
    assert.equal(env.APPDATA_PATH, dir)
    assert.equal(env.DATA_DIR_OVERRIDDEN, true)
    return loadModule('config.js', { './env': env })
  }
  return { file, start, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) }
}

test('UI JSON 读取在主进程序列化，只读 ui 命名空间且不缓存旧值', (t) => {
  const f = fixture(t, { ui: { nested: { value: [1, { label: '舰娘' }] }, nil: null, zero: 0 }, kuma: { secret: 'not-ui' } })
  const config = f.start()
  assert.equal(typeof config.getUiJson('nested'), 'string')
  const copy = JSON.parse(config.getUiJson('nested'))
  copy.value[1].label = 'changed'
  assert.equal(config.get('ui.nested').value[1].label, '舰娘')
  assert.equal(config.getUiJson('missing'), undefined)
  assert.equal(config.getUiJson('nil'), 'null')
  assert.equal(config.getUiJson('zero'), '0')
  assert.equal(config.getUiJson('kuma.secret'), undefined)
  const events = []
  config.on('config.set', (...args) => events.push(args))
  config.setUiJson('nested', '{"value":[2]}')
  assert.deepEqual(JSON.parse(config.getUiJson('nested')), { value: [2] })
  assert.deepEqual(f.read().ui.nested, { value: [2] })
  assert.deepEqual(events, [['ui.nested', { value: [2] }]])
  assert.throws(() => config.setUiJson('nested', '{invalid'))
  assert.deepEqual(config.get('ui.nested'), { value: [2] })
})

// 合成数据，按施工单的 46 叶子形状造；不从玩家 config.json 取任何值。
const legacyFixture = () => ({
  proxy: { use: 'http', http: { host: '127.0.0.1', port: 8118, requirePassword: false } },
  kanso: {
    homepage: 'http://127.0.0.1/fixture',
    dmmcookie: false,
    persistLogin: true,
    disablenetworkalert: false,
    cache: { path: 'fixture-cache' },
    lastGameHost: 'fixture.invalid',
    voiceCaptions: false,
    gameAudio: { volume: 0, voiceVolume: 0.7, bgmVolume: 0.4, mode: 'all' },
    eventBannerEffects: false,
    sunkEffects: true,
    launchGlow: false,
    network: { customCertificateAuthority: 'fixture-ca.pem' },
    trustedCerts: ['fixture-sha256'],
    battleFlyby: true,
    ...Object.fromEntries(['window', 'questTreeWindow', 'resourceTrendWindow', 'shipLifeWindow', 'battleReplayWindow']
      .map((name, i) => [name, { x: -100 + i, y: i * 10, width: 900 + i, height: 600 + i, isMaximized: i === 0 }])),
    browseWindow: { x: 20, y: 30, width: 960, height: 640 },
  },
  ui: Object.fromEntries(['ji', 'qn', 'ru', 'shi', 'du', 'lg'].map((name, i) => [name, {
    collapsed: false, selected: i, sort: 'name', filter: '', columns: ['name', 'level'],
    nested: { visible: true, width: 120 + i },
  }])),
})

const leaves = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
  const name = prefix ? `${prefix}.${key}` : key
  return child !== null && typeof child === 'object' && !Array.isArray(child)
    ? leaves(child, name) : [[name, child]]
})
const at = (value, key) => key.split('.').reduce((current, part) => current[part], value)

test('覆盖目录内真迁移：46 叶子、ui 逐键、proxy、旧对象、缩进与二次启动幂等', (t) => {
  const initial = legacyFixture()
  const disk = fixture(t, initial)
  const config = disk.start()
  const migrated = disk.read()
  assert.equal(leaves(initial.kanso).length, 46)
  for (const [key, value] of leaves(initial.kanso)) {
    assert.deepEqual(at(migrated.kuma, key), value, `kuma.${key}`)
    assert.deepEqual(config.get(`kuma.${key}`), value)
  }
  assert.equal(leaves(initial.ui).length, 42)
  for (const [key, value] of leaves(initial.ui)) {
    assert.deepEqual(at(migrated.ui, key), value, `ui.${key}`)
  }
  assert.equal(JSON.stringify(migrated.ui), JSON.stringify(initial.ui))
  assert.deepEqual(migrated.proxy, initial.proxy)
  assert.deepEqual(migrated.kanso, initial.kanso)
  assert.deepEqual(migrated, { ...initial, kuma: initial.kanso })
  const bytes = fs.readFileSync(disk.file)
  assert.equal(bytes.toString('utf8'), JSON.stringify(migrated, null, 2))
  // 人为设置旧时间，第二次若重写同样的字节，mtime 也会揭穿它。
  fs.utimesSync(disk.file, new Date('2000-01-01Z'), new Date('2000-01-01Z'))
  const stamp = fs.statSync(disk.file).mtimeMs
  disk.start()
  assert.deepEqual(fs.readFileSync(disk.file), bytes)
  assert.equal(fs.statSync(disk.file).mtimeMs, stamp)
  config.get('kuma.window').x = 321
  assert.equal(config.snapshot().kanso.window.x, initial.kanso.window.x, '新旧对象不能共用引用')
})

test('两个都在：新值为准、不合并、不删旧，set 只更新新对象', (t) => {
  const initial = { kanso: { x: 'old', onlyOld: 7 }, kuma: { x: 'new' }, ui: { x: 9 } }
  const disk = fixture(t, initial)
  const before = fs.readFileSync(disk.file)
  const config = disk.start()
  assert.equal(config.get('kuma.x'), 'new')
  assert.equal(config.get('kuma.onlyOld'), 7)
  assert.deepEqual(config.snapshot(), initial)
  assert.deepEqual(fs.readFileSync(disk.file), before)
  config.set('kuma.x', 'changed')
  assert.deepEqual(disk.read(), { ...initial, kuma: { x: 'changed' } })
})

test('旧配置只有 kanso.x：读时兜底只读不写，优先于默认值与调用方 fallback', (t) => {
  const disk = fixture(t, {})
  const config = disk.start()
  // 构造后恢复旧快照，确保测到 get 的兜底，而不是构造器复制后的新值。
  const old = { kanso: { x: { nested: ['old'] }, dmmcookie: false, n: null, empty: '', zero: 0 } }
  config.restoreSnapshot(old)
  const before = fs.readFileSync(disk.file)
  assert.deepEqual(config.get('kuma.x'), old.kanso.x)
  assert.equal(config.get('kuma.dmmcookie', true), false)
  for (const key of ['n', 'empty', 'zero']) assert.equal(config.get(`kuma.${key}`, 'fallback'), old.kanso[key])
  assert.equal(config.get('kuma.missing', 'fallback'), 'fallback')
  assert.equal(config.get('ui.x', 'fallback'), 'fallback')
  assert.deepEqual(config.snapshot(), old)
  assert.deepEqual(fs.readFileSync(disk.file), before)
})

test('已有新值 false、0、空串、null 不回落；全新与仅新配置不写文件', (t) => {
  for (const initial of [{}, { kuma: { dmmcookie: false, x: 0 } }, {
    kanso: { a: true, b: 1, c: 'old', d: 'old' },
    kuma: { a: false, b: 0, c: '', d: null },
  }]) {
    const disk = fixture(t, initial)
    const before = fs.readFileSync(disk.file)
    const config = disk.start()
    for (const [key, value] of Object.entries(initial.kuma ?? {})) {
      assert.equal(config.get(`kuma.${key}`, 'fallback'), value)
    }
    if (!initial.kuma) assert.equal(config.get('kuma.dmmcookie'), true)
    assert.deepEqual(fs.readFileSync(disk.file), before)
  }
})
