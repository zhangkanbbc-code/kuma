import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import dodge from '../dist/shared/caption-dodge.js'

const source = fs.readFileSync(new URL('../assets/preload/caption-dodge.js', import.meta.url), 'utf8')
const zone = { x0: 0.1, y0: 0.8, x1: 0.9, y1: 1 }
const fixture = (hasCanvas = true) => {
  const listeners = new Map(), channels = new Map(), frames = [], sent = []
  let reads = 0
  const canvas = { getBoundingClientRect: () => { reads++; return { left: 100, top: 200, width: 500, height: 300 } } }
  const document = {
    hidden: false,
    canvas: hasCanvas ? canvas : null,
    querySelector: selector => { assert.equal(selector, 'canvas'); return document.canvas },
    addEventListener: (name, callback, options) => {
      assert.equal(listeners.has(name), false, '监听只装一次')
      listeners.set(name, { callback, options })
    },
  }
  const ipcRenderer = {
    on: (name, callback) => channels.set(name, callback),
    send: (name, value) => { assert.equal(name, dodge.CAPTION_HOVER_CHANNEL); sent.push(value) },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, document, window: {},
    requestAnimationFrame: callback => { frames.push(callback); return frames.length },
    require: id => { assert.equal(id, '../../dist/shared/caption-dodge'); return dodge },
  })
  module.exports.installCaptionDodge(ipcRenderer)
  const event = (name, payload) => listeners.get(name)?.callback(payload)
  return {
    document, listeners, frames, sent,
    reads: () => reads,
    receive: value => channels.get(dodge.CAPTION_ZONE_CHANNEL)({}, value),
    move: (clientX = 350, clientY = 470) => event('mousemove', { clientX, clientY }),
    event,
    flush: () => { const callbacks = frames.splice(0); callbacks.forEach(callback => callback()) },
  }
}

test('没有字幕区时不监听、不评估、不发消息', () => {
  const f = fixture()
  f.move(); f.flush()
  assert.equal(f.listeners.size, 0)
  assert.equal(f.reads(), 0)
  assert.deepEqual(f.sent, [])
})

test('收到区域后按偏移画布坐标进入只发一次 true，区内继续移动不发', () => {
  const f = fixture()
  f.receive(zone); f.receive(zone)
  assert.equal(f.listeners.get('mousemove').options.passive, true)
  f.move(); f.flush()
  assert.deepEqual(f.sent, [true])
  f.move(400, 480); f.flush()
  assert.deepEqual(f.sent, [true])
})

test('移出区域只发一次 false', () => {
  const f = fixture()
  f.receive(zone); f.move(); f.flush()
  f.move(110, 220); f.flush()
  f.move(120, 230); f.flush()
  assert.deepEqual(f.sent, [true, false])
})

test('在区内清空或拒收区域发 false，后续移动不再评估', () => {
  for (const cleared of [null, { ...zone, x1: NaN }]) {
    const f = fixture()
    f.receive(zone); f.move(); f.flush()
    f.move(); f.receive(cleared); f.flush()
    f.move(); f.flush()
    assert.deepEqual(f.sent, [true, false])
    assert.equal(f.reads(), 1)
  }
})

test('本帧没有画布就不安装监听、不发消息', () => {
  const f = fixture(false)
  f.receive(zone); f.move(); f.flush()
  assert.equal(f.listeners.size, 0)
  assert.deepEqual(f.sent, [])
})

test('mouseleave 清除命中且待执行帧不能重新进入', () => {
  const f = fixture()
  f.receive(zone); f.move(); f.flush()
  f.move(); f.event('mouseleave'); f.flush()
  f.event('mouseleave')
  assert.deepEqual(f.sent, [true, false])
})

test('隐藏文档视为离开，恢复可见不会拿旧坐标重报', () => {
  const f = fixture()
  f.receive(zone); f.move(); f.flush()
  f.move(); f.document.hidden = true; f.event('visibilitychange'); f.flush()
  f.document.hidden = false; f.event('visibilitychange'); f.flush()
  assert.deepEqual(f.sent, [true, false])
})

test('一帧多次移动只评估一次且使用最新坐标', () => {
  const f = fixture()
  f.receive(zone)
  f.move(110, 220); f.move(); f.move(400, 480)
  assert.equal(f.frames.length, 1)
  assert.equal(f.reads(), 0)
  f.flush()
  assert.equal(f.reads(), 1)
  assert.deepEqual(f.sent, [true])
})

test('每次评估现查画布，替换、零尺寸及移除画布均恢复离开', () => {
  const f = fixture()
  f.receive(zone); f.move(); f.flush()
  f.document.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) }
  f.move(); f.flush()
  f.move(50, 90); f.flush()
  f.document.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 100 }) }
  f.move(); f.flush()
  f.document.canvas = null
  f.move(); f.flush()
  assert.deepEqual(f.sent, [true, false, true, false])
})

test('区域更新后用已有指针重算，只报告翻转', () => {
  const f = fixture()
  f.receive(zone); f.move(); f.flush()
  f.receive({ x0: 0, y0: 0, x1: 1, y1: 0.5 }); f.flush()
  assert.deepEqual(f.sent, [true, false])
})
