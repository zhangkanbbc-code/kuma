import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
const start = source.indexOf('const lodeCache =')
const end = source.indexOf('// 「谁说的', start)
assert.ok(start >= 0 && end > start)
const compiled = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' }).code
const mount = invoke => {
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, ipcRenderer: { invoke } })
  return module.exports.queryLode
}

test('同 ID 并发请求合并，不同 ID 独立，成功后复用同一个结果', async () => {
  const calls = [], complete = new Map()
  const query = mount((channel, id) => {
    calls.push([channel, id])
    return new Promise(resolve => complete.set(id, resolve))
  })
  const a = Array.from({ length: 12 }, () => query('a'))
  const b = query('b')
  assert.deepEqual(calls, [['lode:get', 'a'], ['lode:get', 'b']])
  const value = { meta: { id: 'a' }, data: { rows: [1, 2] } }
  complete.get('a')(value)
  complete.get('b')(null)
  assert.ok((await Promise.all(a)).every(result => result === value))
  assert.equal(await b, null)
  assert.equal(await query('a'), value)
  assert.equal(await query('b'), null)
  assert.equal(calls.length, 2)
})

test('失败向全部等待者传播且不缓存为空，下一次可重试', async () => {
  let reject, count = 0
  const failure = new Error('read failed')
  const value = { meta: { id: 'a' }, data: [] }
  const query = mount(() => ++count === 1 ? new Promise((_resolve, fail) => { reject = fail }) : Promise.resolve(value))
  const pending = [query('a'), query('a')]
  reject(failure)
  const results = await Promise.allSettled(pending)
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure))
  assert.equal(await query('a'), value)
  assert.equal(count, 2)
})

test('invoke 同步抛错也不留下在途占位，undefined 沿用缺包语义', async () => {
  let calls = 0
  const query = mount(() => { if (++calls === 1) throw new Error('channel unavailable'); return Promise.resolve(undefined) })
  await assert.rejects(query('a'), /channel unavailable/)
  assert.equal(await query('a'), null)
  assert.equal(await query('a'), null)
  assert.equal(calls, 2)
})
