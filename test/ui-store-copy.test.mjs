import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { transformSync } from 'esbuild'

const kernelSource = fs
  .readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')

const UI_STORE_BLOCK = (() => {
  const from = 'export const uiGet = '
  const to = '\n\n// 内部详情栏'
  const start = kernelSource.indexOf(from)
  const end = kernelSource.indexOf(to, start)
  assert.ok(start >= 0 && end > start, 'kernel.ts 里找不到 uiGet/uiSet，这条守卫的锚点要跟着改')
  return kernelSource.slice(start, end)
})()

const store = (() => {
  const source = `
let remoteValue = 'B'
const remoteObject: Record<string, string> = {}
Object.defineProperty(remoteObject, '2-1', {
  enumerable: true,
  get: () => remoteValue,
  set: (value: string) => { remoteValue = value },
})
const values: Record<string, unknown> = {
  'ui.object': remoteObject,
  'ui.string': '原样',
  'ui.number': 7,
  'ui.boolean': false,
  'ui.null': null,
  'ui.undefined': undefined,
  'ui.large': { rows: Array.from({ length: 1024 }, (_, id) => ({ id, nested: { selected: false } })) },
}
let reads = 0
const writes: [string, string][] = []
const kernelConfig = {
  get: () => { throw new Error('remote object must not cross the read boundary') },
  getUiJson: (key: string) => { reads++; return JSON.stringify(values['ui.' + key]) },
  set: () => { throw new Error('remote object must not cross the write boundary') },
  setUiJson: (key: string, value: string) => { writes.push([key, value]); values['ui.' + key] = JSON.parse(value) },
}
${UI_STORE_BLOCK}
export const sourceValue = () => remoteValue
export const readCount = () => reads
export const writeCalls = () => writes
export const replaceValue = (key: string, value: unknown) => { values['ui.' + key] = value }
`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-ui-store-copy-'))
  const file = path.join(dir, 'store.cjs')
  fs.writeFileSync(file, transformSync(source, { loader: 'ts', format: 'cjs' }).code)
  return createRequire(fileURLToPath(import.meta.url))(file)
})()

test('uiGet 把 remote 对象变成本地副本，可以删除且赋值不回写源对象', () => {
  const value = store.uiGet('object', {})
  assert.doesNotThrow(() => {
    delete value['2-1']
  })
  assert.equal(Object.hasOwn(value, '2-1'), false)

  const second = store.uiGet('object', {})
  second['2-1'] = 'A'
  assert.equal(second['2-1'], 'A')
  assert.equal(store.sourceValue(), 'B')
})

test('uiGet 原始值原样返回，null 与 undefined 走 fallback', () => {
  assert.equal(store.uiGet('string', 'fallback'), '原样')
  assert.equal(store.uiGet('number', 0), 7)
  assert.equal(store.uiGet('boolean', true), false)

  const nullFallback = { source: 'null' }
  const undefinedFallback = { source: 'undefined' }
  assert.equal(store.uiGet('null', nullFallback), nullFallback)
  assert.equal(store.uiGet('undefined', undefinedFallback), undefinedFallback)
})

test('uiGet 大对象只请求一次 JSON，每次解析独立副本并读取最新主进程值', () => {
  const before = store.readCount()
  const first = store.uiGet('large', null)
  assert.equal(store.readCount() - before, 1)
  assert.equal(first.rows.length, 1024)
  first.rows[10].nested.selected = true
  const second = store.uiGet('large', null)
  assert.equal(second.rows[10].nested.selected, false)
  store.replaceValue('large', { rows: [{ id: 7 }] })
  assert.deepEqual(store.uiGet('large', null), { rows: [{ id: 7 }] })
})

test('uiSet 只发送 JSON 字符串，写后读取没有代理或共享引用', () => {
  const value = { rows: [{ id: 1 }] }
  store.uiSet('write', value)
  assert.deepEqual(store.writeCalls().at(-1), ['write', '{"rows":[{"id":1}]}'])
  value.rows[0].id = 2
  assert.deepEqual(store.uiGet('write', null), { rows: [{ id: 1 }] })
  store.uiSet('write', value)
  assert.deepEqual(store.uiGet('write', null), { rows: [{ id: 2 }] })
})
