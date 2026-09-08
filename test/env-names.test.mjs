import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import compiled from '../dist/shared/env-names.js'
import { ENV_ALIASES, readEnv } from '../src/shared/env-names.ts'
import { userDataDir, userDataPathIfAny } from '../scripts/lib/data-dir.mjs'
import { defaultDataDir } from '../scripts/player-view-audit.mjs'

const names = [
  'KUMA_DATA_DIR', 'KUMA_SMOKE', 'KUMA_DEBUG_UI', 'KUMA_DEVTOOLS',
  'KUMA_QUIT_TRACE', 'KUMA_PERF_SLOW_MS', 'KUMA_PERF_PART_MS', 'KUMA_PERF_LONGTASK_MS',
]

test('运行时清单包含八个迁移开关与一个无旧名的本地转储开关，源码与构建产物一致', () => {
  assert.deepEqual(Object.keys(ENV_ALIASES), [...names, 'KUMA_CRASH_DUMPS'])
  assert.deepEqual(compiled.ENV_ALIASES, ENV_ALIASES)
  assert.equal(new Set(Object.values(ENV_ALIASES)).size, names.length + 1)
})

test('本地转储开关只读新名，未设置、空串与显式关闭保持原值', () => {
  assert.equal(ENV_ALIASES.KUMA_CRASH_DUMPS, undefined)
  for (const read of [readEnv, compiled.readEnv]) {
    assert.equal(read('KUMA_CRASH_DUMPS', {}), undefined)
    assert.equal(read('KUMA_CRASH_DUMPS', { KUMA_CRASH_DUMPS: '' }), '')
    assert.equal(read('KUMA_CRASH_DUMPS', { KUMA_CRASH_DUMPS: '0' }), '0')
  }
})

for (const name of names) {
  test(`${name}：新名优先、旧名兜底、空串不回退，源码与产物同口径`, () => {
    const legacy = ENV_ALIASES[name]
    for (const read of [readEnv, compiled.readEnv]) {
      assert.equal(read(name, {}), undefined)
      assert.equal(read(name, { [legacy]: 'old' }), 'old')
      assert.equal(read(name, { [name]: 'new' }), 'new')
      assert.equal(read(name, { [name]: 'new', [legacy]: 'old' }), 'new')
      assert.equal(read(name, { [name]: '', [legacy]: 'old' }), '')
      assert.equal(read(name, { [name]: '0', [legacy]: '1' }), '0')
    }
  })
}

test('维护脚本的数据目录也使用同一别名表，并在调用时读取环境', (t) => {
  const legacy = ENV_ALIASES.KUMA_DATA_DIR
  const env = { [legacy]: 'C:/fixture/legacy', KUMA_DATA_DIR: 'C:/fixture/current' }
  t.mock.property(process, 'env', env)
  assert.equal(userDataDir(), 'C:/fixture/current')
  delete env.KUMA_DATA_DIR
  assert.equal(userDataDir(), 'C:/fixture/legacy')
  env.KUMA_DATA_DIR = ''
  assert.equal(userDataPathIfAny('unused'), null)
})

test('口径审计数据目录兼容旧名、新名优先、空串屏蔽旧名并沿用目录回退', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-audit-env-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const legacyOverride = path.join(root, 'legacy-override')
  const currentOverride = path.join(root, 'current-override')
  const env = { APPDATA: root, KANSO_DATA_DIR: legacyOverride }
  t.mock.property(process, 'env', env)

  assert.equal(defaultDataDir(), legacyOverride)
  env.KUMA_DATA_DIR = currentOverride
  assert.equal(defaultDataDir(), currentOverride)
  env.KUMA_DATA_DIR = ''
  const current = path.join(root, 'kuma')
  const legacy = path.join(root, 'kanso')
  assert.equal(defaultDataDir(), current)
  fs.mkdirSync(legacy)
  assert.equal(defaultDataDir(), legacy)
  fs.mkdirSync(current)
  assert.equal(defaultDataDir(), current)
})
