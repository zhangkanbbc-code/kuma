// 改名首启的数据目录搬迁判定（2026-08-28 艦素 → kuma）。
//
// 判定是纯函数，四种情形穷举在这里；真正的 renameSync 在 src/main/env.ts，
// 它 import electron 测不了，所以那一侧靠源码护栏 + 一次真目录演练兜。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import dataDir from '../dist/shared/data-dir.js'

const { DATA_DIR_NAME, LEGACY_DATA_DIR_NAME, dataDirCandidates, planDataDir } = dataDir

const APPDATA = 'C:\\Users\\提督\\AppData\\Roaming'
const NEW = `${APPDATA}\\kuma`
const OLD = `${APPDATA}\\kanso`

test('目录名就是产品名，旧名留着只为搬迁', () => {
  assert.equal(DATA_DIR_NAME, 'kuma')
  assert.equal(LEGACY_DATA_DIR_NAME, 'kanso')
  assert.deepEqual(dataDirCandidates(APPDATA), { dir: NEW, legacyDir: OLD })
})

test('末尾多一个分隔符不会拼出双斜杠', () => {
  assert.deepEqual(dataDirCandidates(`${APPDATA}\\`), { dir: NEW, legacyDir: OLD })
  assert.deepEqual(dataDirCandidates('/home/t/.config'), {
    dir: '/home/t/.config/kuma',
    legacyDir: '/home/t/.config/kanso',
  })
})

test('①旧有新无：用新目录，搬', () => {
  const plan = planDataDir({ appData: APPDATA, legacyExists: true, currentExists: false })
  assert.deepEqual(plan, { dir: NEW, legacyDir: OLD, migrate: true })
})

test('②旧无：直接用新目录，不搬', () => {
  const fresh = planDataDir({ appData: APPDATA, legacyExists: false, currentExists: false })
  assert.deepEqual(fresh, { dir: NEW, legacyDir: OLD, migrate: false })
  const already = planDataDir({ appData: APPDATA, legacyExists: false, currentExists: true })
  assert.deepEqual(already, { dir: NEW, legacyDir: OLD, migrate: false })
})

test('③两个都在：用新目录，不搬也不删旧', () => {
  const plan = planDataDir({ appData: APPDATA, legacyExists: true, currentExists: true })
  assert.deepEqual(plan, { dir: NEW, legacyDir: OLD, migrate: false })
})

test('④KANSO_DATA_DIR 覆盖：一切照它，跳过搬迁', () => {
  const overridden = 'D:\\tmp\\kanso-quit-e2e'
  for (const legacyExists of [true, false]) {
    for (const currentExists of [true, false]) {
      const plan = planDataDir({
        appData: APPDATA,
        legacyExists,
        currentExists,
        override: overridden,
      })
      assert.deepEqual(
        plan,
        { dir: overridden, legacyDir: OLD, migrate: false },
        `覆盖模式下 legacy=${legacyExists} current=${currentExists} 竟然还想搬`,
      )
    }
  }
})

test('env.ts 真的照这个判定搬，而且搬不动时退回旧目录', () => {
  const env = fs.readFileSync(new URL('../src/main/env.ts', import.meta.url), 'utf8')
  assert.match(env, /planDataDir\(\{/, 'env.ts 不再走 shared/data-dir 的判定')
  assert.match(env, /override: process\.env\.KANSO_DATA_DIR/, '覆盖模式没传进判定')
  assert.match(env, /fs\.renameSync\(plan\.legacyDir, plan\.dir\)/, '搬迁不再是整目录 rename')
  // 失败分支的口径：数据可用性高于目录名——退回旧目录，且把原因交出去
  assert.match(env, /return \{\s*\n?\s*dir: plan\.legacyDir,/, '搬不动时没退回旧目录')
  assert.match(env, /export const DATA_DIR_MIGRATION_ERROR/, '失败原因没往外送')
  // 冒烟目录不参与搬迁：它与正式目录没有继承关系
  assert.match(env, /KANSO_SMOKE\) \{\s*\n\s*return \{ dir: path\.join\(os\.tmpdir\(\), 'kanso-smoke'\)/)

  const crash = fs.readFileSync(new URL('../src/main/crash-log.ts', import.meta.url), 'utf8')
  assert.match(crash, /if \(DATA_DIR_MIGRATION_ERROR\) \{/, '搬迁失败没记进 crash.log')
  assert.match(crash, /scope: 'data-dir-migrate'/)
})
