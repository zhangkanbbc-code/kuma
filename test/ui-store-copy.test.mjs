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
}
const kernelConfig = {
  get: (key: string) => values[key],
  set: (_key: string, _value: unknown) => {},
}
${UI_STORE_BLOCK}
export const sourceValue = () => remoteValue
`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-ui-store-copy-'))
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
