import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import compiled from '../dist/shared/env-names.js'
import { RUNTIME_ENV_NAMES, readEnv } from '../src/shared/env-names.ts'
import { userDataDir, userDataPathIfAny } from '../scripts/lib/data-dir.mjs'
import { defaultDataDir } from '../scripts/player-view-audit.mjs'

// 改名前的旧变量名与旧数据目录名（维护者裁决 2026-11-26 撤除）：只在这里出现，用来证明设了也不认
const RETIRED_PREFIX = 'KANSO_'
const RETIRED_DIR = 'kanso'

const names = [
  'KUMA_DATA_DIR', 'KUMA_SMOKE', 'KUMA_DEBUG_UI', 'KUMA_DEVTOOLS', 'KUMA_QUIT_TRACE',
  'KUMA_PERF_SLOW_MS', 'KUMA_PERF_PART_MS', 'KUMA_PERF_LONGTASK_MS', 'KUMA_CRASH_DUMPS',
]

test('运行时开关清单只有新名，源码与构建产物一致', () => {
  assert.deepEqual([...RUNTIME_ENV_NAMES], names)
  assert.deepEqual(compiled.RUNTIME_ENV_NAMES, RUNTIME_ENV_NAMES)
  assert.equal(compiled.ENV_ALIASES, undefined)
})

for (const name of names) {
  test(`${name}：原样读取，未设置为 undefined、空串保持空串，旧名不兜底`, () => {
    const retired = name.replace('KUMA_', RETIRED_PREFIX)
    assert.notEqual(retired, name)
    for (const read of [readEnv, compiled.readEnv]) {
      assert.equal(read(name, {}), undefined)
      assert.equal(read(name, { [retired]: 'old' }), undefined)
      assert.equal(read(name, { [name]: 'new', [retired]: 'old' }), 'new')
      assert.equal(read(name, { [name]: '' }), '')
      assert.equal(read(name, { [name]: '0' }), '0')
    }
  })
}

test('维护脚本的数据目录：显式覆盖优先，旧变量名不认，调用时现读环境', (t) => {
  const env = { APPDATA: 'C:/fixture/appdata', [`${RETIRED_PREFIX}DATA_DIR`]: 'C:/fixture/legacy', KUMA_DATA_DIR: 'C:/fixture/current' }
  t.mock.property(process, 'env', env)
  assert.equal(userDataDir(), 'C:/fixture/current')
  delete env.KUMA_DATA_DIR
  assert.equal(userDataDir(), path.join('C:/fixture/appdata', 'kuma'))
  env.KUMA_DATA_DIR = ''
  assert.equal(userDataDir(), path.join('C:/fixture/appdata', 'kuma'))
  delete env.APPDATA
  assert.equal(userDataPathIfAny('unused'), null)
})

test('口径审计数据目录只认新目录：旧目录在、新目录不在也不回退', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-audit-env-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const override = path.join(root, 'override')
  const env = { APPDATA: root, KUMA_DATA_DIR: override }
  t.mock.property(process, 'env', env)

  assert.equal(defaultDataDir(), override)
  env.KUMA_DATA_DIR = ''
  const current = path.join(root, 'kuma')
  assert.equal(defaultDataDir(), current)
  fs.mkdirSync(path.join(root, RETIRED_DIR))
  assert.equal(defaultDataDir(), current)
})
