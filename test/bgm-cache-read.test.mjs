import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../assets/preload/bgm-archive.js', import.meta.url), 'utf8')
const URL_ = 'https://example.invalid/kcs2/resources/bgm/battle/279_7311.mp3?version=2'

const mount = (fetcher = () => { throw new Error('cache miss') }) => {
  const calls = []
  const sends = []
  const mod = { exports: {} }
  new Function('require', 'module', 'window', 'fetch', source)(
    () => ({ ipcRenderer: { send: (...args) => sends.push(args) } }), mod,
    { location: { href: 'https://example.invalid/game', origin: 'https://example.invalid' } },
    (url, options) => {
      calls.push([url, options])
      assert.deepEqual(options, { cache: 'only-if-cached', mode: 'same-origin' })
      return fetcher(url, options)
    },
  )
  return { ...mod.exports, calls, sends }
}

test('游戏缓存：整文件命中只读一次，保留完整 URL 并交 IPC', async () => {
  const ui = mount(() => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }))
  await ui.readFromCache(URL_)
  assert.equal(ui.calls.length, 1)
  assert.equal(ui.calls[0][0], URL_)
  assert.equal(ui.sends.length, 1)
  const [channel, payload] = ui.sends[0]
  assert.equal(channel, 'kuma:bgm-archive-blob')
  assert.equal(payload.url, URL_)
  assert.equal(payload.pathname, '/kcs2/resources/bgm/battle/279_7311.mp3')
  assert.deepEqual(payload.bytes, new Uint8Array([1, 2]))
})

test('游戏缓存：整文件 miss 即停止，不补取也不交 IPC', async () => {
  const ui = mount()
  await ui.readFromCache(URL_)
  assert.equal(ui.calls.length, 1)
  assert.deepEqual(ui.sends, [])
})

test('游戏缓存：拒绝 206 与失败响应，不读取响应体也不补取', async () => {
  for (const result of [{ ok: true, status: 206 }, { ok: false, status: 504 }]) {
    let bodyReads = 0
    const ui = mount(() => ({ ...result, arrayBuffer: async () => {
      bodyReads++
      return new Uint8Array([1]).buffer
    } }))
    await ui.readFromCache(URL_)
    assert.equal(bodyReads, 0)
    assert.equal(ui.calls.length, 1)
    assert.deepEqual(ui.sends, [])
  }
})

test('游戏缓存：空文件与超过 8 MiB 的整文件不入档', async () => {
  for (const size of [0, 8 * 1024 * 1024 + 1]) {
    const ui = mount(() => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(size).buffer }))
    await ui.readFromCache(URL_)
    assert.equal(ui.calls.length, 1)
    assert.deepEqual(ui.sends, [])
  }
})

test('游戏缓存：同 URL 并发只读一份，结束后释放 inFlight', async () => {
  let release
  const ui = mount(() => new Promise((resolve) => { release = resolve }))
  const first = ui.readFromCache(URL_)
  await ui.readFromCache(URL_)
  assert.equal(ui.calls.length, 1)
  release({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer })
  await first
  const second = ui.readFromCache(URL_)
  assert.equal(ui.calls.length, 2)
  release({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer })
  await second
})
