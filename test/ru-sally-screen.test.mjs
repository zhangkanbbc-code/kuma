import assert from 'node:assert/strict'
import test from 'node:test'
import { scene } from './fixtures/render-ru-sally-screen.mjs'

const sortie = (mapArea) => ({ active: true, practice: false, mapArea })
const visible = (limitFlag) => {
  assert.match(scene.flag(), /data-sally-jump="1"/)
  assert.match(scene.flag(), limitFlag ? /1 张图札限制检查中/ : /当前不查札/)
}

test('选图页最近摊开常规区时不显示札标签', () => {
  for (const limitFlag of [0, 1]) {
    scene.reset(1, true, null, limitFlag)
    assert.equal(scene.flag(), '')
  }
})

test('选图页最近摊开活动区时显示札标签', () => {
  for (const limitFlag of [0, 1]) {
    scene.reset(62, true, null, limitFlag)
    visible(limitFlag)
  }
})

test('选图页尚无开图线索时不显示札标签', () => {
  for (const limitFlag of [0, 1]) {
    scene.reset(null, true, null, limitFlag)
    assert.equal(scene.flag(), '')
  }
})

test('活动区出击以本趟海区为准显示札标签', () => {
  for (const limitFlag of [0, 1]) {
    scene.reset(1, false, sortie(62), limitFlag)
    visible(limitFlag)
  }
})

test('常规区出击以本趟海区为准不显示札标签', () => {
  for (const limitFlag of [0, 1]) {
    scene.reset(62, true, sortie(1), limitFlag)
    assert.equal(scene.flag(), '')
  }
})

test('开图信号从常规切到活动区后重画札标签', () => {
  for (const limitFlag of [0, 1]) {
    scene.reset(1, true, null, limitFlag)
    assert.equal(scene.flag(), '')
    scene.open(62)
    assert.equal(scene.flag(), '')
    assert.equal(scene.redraw(), 1)
    visible(limitFlag)
  }
})

test('缓存切区未发信号时保留札状态，常规出击校准后选图页撤下', () => {
  scene.reset(62)
  scene.render()
  visible(0)
  scene.mg.sortie = sortie(1)
  scene.noteSortieArea()
  scene.mg.sortie = null
  scene.render()
  assert.equal(scene.flag(), '')
})
