import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'
import versions from '../dist/shared/lode-version.js'
import validation from '../dist/main/lode-validation.js'
import corrections from '../dist/shared/quest-text-corrections.js'

const { compareLodeVersions } = versions
for (const [label, user, builtin, expected] of [
  ['新', '2026.09.06', '2026.08.27', 1],
  ['旧', '2026.08.27', '2026.09.06', -1],
  ['相等', '2026.09.06', '2026.09.06', 0],
  ['缺用户版本', undefined, '2026.09.06', null],
  ['缺内置版本', '2026.09.06', undefined, null],
  ['不可解析', '2026..09', '2026.09.06', null],
  ['数字逐段比较', '1.10', '1.9', 1],
  ['日期分隔符', '2026-09-06', '2026.9.6', 0],
  ['补零', '1.0', '1', 0],
  ['摘要版本字符串比较', '1.44dd26204c0d', '1.33dd26204c0d', 1],
  ['超出数字精度', '9007199254740992', '1', null],
]) test(`资料包版本比较：${label}`, () => assert.equal(compareLodeVersions(user, builtin), expected))

const source = fs.readFileSync(new URL('../src/main/lode.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code
const pack = (version, name) => ({
  meta: { id: 'event-bonus', name, ...(version === undefined ? {} : { version }), source: 'fixture', fetchedAt: '2026-09-06' },
  data: { events: {} },
})
const assemble = (userVersion, builtinVersion) => {
  const handlers = new Map()
  const warnings = []
  const root = path.resolve('fixture-builtin')
  const userDir = path.resolve('fixture-user')
  const fakeFs = {
    readdirSync: () => ['event-bonus.json'],
    statSync: () => ({ mtimeMs: 1, size: 100 }),
    readFileSync: (file) => JSON.stringify(file.startsWith(root)
      ? pack(builtinVersion, '随包资料') : pack(userVersion, '导入资料')),
    mkdirSync: () => {}, // 禁止测试加载器碰真实用户目录
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console: { warn: (line) => warnings.push(line) },
    require: (id) => {
      if (id === 'electron') return { ipcMain: { handle: (id, fn) => handlers.set(id, fn) } }
      if (id === 'fs') return fakeFs
      if (id === 'path') return path
      if (id === './env') return { ROOT: root, APPDATA_PATH: userDir }
      if (id === './lode-validation') return validation
      if (id === '../shared/quest-text-corrections') return corrections
      if (id === '../shared/lode-version') return versions
      throw new Error(`unexpected import ${id}`)
    },
  })
  return { selected: module.exports.getLode('event-bonus'), metas: handlers.get('lode:list')(), warnings }
}

for (const [label, user, builtin, selected, warning] of [
  ['内置新', '2026.08.27', '2026.09.06', '随包资料', '用户包旧于内置'],
  ['用户新', '2026.09.06', '2026.08.27', '导入资料', null],
  ['相等', '2026.09.06', '2026.09.06', '导入资料', null],
  ['用户缺版本', undefined, '2026.09.06', '导入资料', '版本缺失或解析失败'],
  ['内置缺版本', '2026.09.06', undefined, '导入资料', '版本缺失或解析失败'],
  ['解析失败', '2026..09', '2026.09.06', '导入资料', '版本缺失或解析失败'],
]) test(`资料包装配：${label}`, () => {
  const result = assemble(user, builtin)
  assert.equal(result.selected.meta.name, selected)
  assert.equal(result.metas[0].ignoredUserVersion, selected === '随包资料' ? user : undefined)
  assert.equal(result.warnings.length, warning ? 1 : 0)
  if (warning) {
    assert.ok(result.warnings[0].startsWith('[kuma] lode: event-bonus '))
    assert.ok(result.warnings[0].includes(warning))
    assert.ok(result.warnings[0].includes(`用户版本 ${user ?? '缺失'}`))
    assert.ok(result.warnings[0].includes(`内置版本 ${builtin ?? '缺失'}`))
  }
})

test('资料页仅显示被弃用的导入版本并转义名称', () => {
  const settings = fs.readFileSync(new URL('../src/renderer/modules/yu.ts', import.meta.url), 'utf8')
  const start = settings.indexOf('const lodeCreditCardHtml =')
  const end = settings.indexOf('\n}', start) + 2
  const render = (lodes) => {
    const scope = {
      lodes, LODE_CREDIT_SOURCES: [], LODE_CREDIT_INTRO: {}, LODE_CREDIT_SHARE_ALIKE: '',
      esc: (v) => String(v ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    }
    return vm.runInNewContext(transformSync(settings.slice(start, end), { loader: 'ts' }).code + '\nlodeCreditCardHtml()', scope)
  }
  assert.ok(!render(assemble('2026.09.06', '2026.08.27').metas).includes('旧于随包版本'))
  const metas = assemble('2026.08.27', '2026.09.06').metas
  metas[0].name = '<资料>'
  assert.ok(render(metas).includes('导入的 &lt;资料&gt; 版本 2026.08.27 旧于随包版本 2026.09.06，已改用随包'))
})
