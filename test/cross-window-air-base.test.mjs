import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { crossWindowRuntime } from './fixtures/cross-window-runtime.mjs'
import { makeAirBaseScene } from './fixtures/render-ru-air-base-mute.mjs'

const pane = () => {
  const listeners = []
  return {
    dataset: {}, classList: { add() {}, contains: () => false },
    addEventListener: (type, cb) => { if (type === 'click') listeners.push(cb) },
    clickMute: (areaId) => {
      const button = { dataset: { areaId: String(areaId) }, closest: (selector) => selector === '[data-act="air-base-mute"]' ? button : null }
      for (const cb of listeners) cb({ target: button })
    },
  }
}

// 验收 3：真 ru.mount 接真实广播器，真面板委托点击，经 config/kernel 的 IPC 同步。
test('弹窗静默海域后，两份编队的真实开图监听都用新集合，恢复亦同步', () => {
  const runtime = crossWindowRuntime(), broadcaster = new EventEmitter()
  const scenes = [runtime.renderer(), runtime.renderer()].map(({ kernel }) => makeAirBaseScene(kernel, broadcaster))
  const panes = [pane(), pane()]
  const squad = { areaId: 6, rid: 1, name: '', actionKind: 1, distance: 7,
    planes: [{ slotId: 1, count: 17, maxCount: 18, cond: 3, state: 1 }] }
  for (let i = 0; i < scenes.length; i++) {
    scenes[i].reset([squad])
    scenes[i].mount(panes[i])
  }
  assert.equal(broadcaster.listenerCount('kancolle.map.open'), 2)
  broadcaster.emit('kancolle.map.open', { areaId: 6, ts: 10000 })
  assert.deepEqual(scenes.map((scene) => scene.toasts.length), [1, 1], '先确认缺补给和红疲劳真的会提醒')
  panes[1].clickMute(6)
  // 先广播开图，再送达偏好通知：即时提醒也必须现读已经写入的静默集合。
  broadcaster.emit('kancolle.map.open', { areaId: 6, ts: 20000 })
  assert.deepEqual(scenes.map((scene) => scene.toasts.length), [1, 1], '静默后不应再追加提示')
  runtime.flush()
  for (const scene of scenes) {
    assert.match(scene.airBaseAreaHtml(6, [squad]), /已静默/)
    assert.doesNotMatch(scene.airBaseAreaHtml(6, [squad]), /需要补给|存在红疲劳/)
  }
  panes[0].clickMute(6)
  runtime.flush()
  broadcaster.emit('kancolle.map.open', { areaId: 6, ts: 30000 })
  assert.deepEqual(scenes.map((scene) => scene.toasts.length), [2, 2])
})
