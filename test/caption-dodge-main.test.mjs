import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import dodge from '../dist/shared/caption-dodge.js'

const fixture = () => {
  const handlers = new Map(), sent = [], emitted = []
  const host = {}, guest = { getType: () => 'webview' }
  let current = { isDestroyed: () => false, mainFrame: { framesInSubtree: [
    { send: (channel, value) => sent.push([0, channel, value]) },
    { send: () => { throw new Error('frame navigated') } },
    { send: (channel, value) => sent.push([2, channel, value]) },
  ] } }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(new URL('../dist/main/caption-dodge.js', import.meta.url), 'utf8'), {
    module, exports: module.exports,
    require: id => {
      if (id === 'electron') return { ipcMain: { on: (name, fn) => handlers.set(name, fn) } }
      if (id === './game-api-broadcaster') return { emit: (...args) => emitted.push(args) }
      if (id === '../shared/caption-dodge') return dodge
      throw new Error(`unexpected require ${id}`)
    },
  })
  module.exports.installCaptionDodge({ hostWebContents: host, gameWebContents: () => current })
  return { host, guest, sent, emitted,
    game: value => { current = value },
    send: (channel, sender, value) => handlers.get(channel)({ sender }, value),
  }
}

test('主进程只收主窗口区域，逐帧发送且跳过已导航帧', () => {
  const f = fixture()
  const zone = { x0: 0, y0: 0.8, x1: 1, y1: 1 }
  f.send(dodge.CAPTION_ZONE_CHANNEL, f.guest, zone)
  assert.deepEqual(f.sent, [])
  f.send(dodge.CAPTION_ZONE_CHANNEL, f.host, zone)
  assert.deepEqual(f.sent, [[0, dodge.CAPTION_ZONE_CHANNEL, zone], [2, dodge.CAPTION_ZONE_CHANNEL, zone]])
  f.send(dodge.CAPTION_ZONE_CHANNEL, f.host, { x0: 2 })
  assert.deepEqual(f.sent.slice(2), [[0, dodge.CAPTION_ZONE_CHANNEL, null], [2, dodge.CAPTION_ZONE_CHANNEL, null]])
})

test('游戏不存在或已销毁时不转发区域', () => {
  const f = fixture()
  for (const game of [null, undefined, { isDestroyed: () => true }]) {
    f.game(game)
    f.send(dodge.CAPTION_ZONE_CHANNEL, f.host, null)
  }
  assert.deepEqual(f.sent, [])
})

test('悬停入口只收 webview 并将状态转换为布尔广播', () => {
  const f = fixture()
  f.send(dodge.CAPTION_HOVER_CHANNEL, { getType: () => 'window' }, true)
  assert.deepEqual(f.emitted, [])
  f.send(dodge.CAPTION_HOVER_CHANNEL, f.guest, 1)
  f.send(dodge.CAPTION_HOVER_CHANNEL, f.guest, 0)
  assert.deepEqual(f.emitted, [[dodge.CAPTION_HOVER_EVENT, true], [dodge.CAPTION_HOVER_EVENT, false]])
})
