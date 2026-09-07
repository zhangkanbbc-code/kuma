import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import catalogLayout from '../dist/shared/catalog-row-layout.js'

test('目录离屏布局仅用于安全的单列宽度，窄栏与多列都回到完整布局', () => {
  for (const width of [0, 190, 250, 299.9, 620, 890, NaN, Infinity]) {
    assert.equal(catalogLayout.canDeferCatalogRows(width), false, String(width))
  }
  for (const width of [300, 329.12, 400, 440.12, 600, 619.9]) {
    assert.equal(catalogLayout.canDeferCatalogRows(width), true, String(width))
  }
})

test('只有短副标题且没有额外收藏标记的行使用固有高度', () => {
  assert.equal(catalogLayout.canDeferCatalogRow('あ'.repeat(18), false), true)
  assert.equal(catalogLayout.canDeferCatalogRow('あ'.repeat(19), false), false)
  assert.equal(catalogLayout.canDeferCatalogRow('短', true), false)
})

const source = fs.readFileSync(new URL('../src/renderer/kernel.ts', import.meta.url), 'utf8')
const start = source.indexOf('const scrollKeyOf =')
const end = source.indexOf('// ---- 「换完', start)
assert.ok(start >= 0 && end > start)
const compiled = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs' }).code
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports })
const { captureScrollProfile, applyScrollProfile } = module.exports

test('离屏内容不读滚动属性，编号仍推进，后面的同类容器不会串位', () => {
  const skipped = {
    className: 'scroller', tagName: 'DIV',
    checkVisibility: options => {
      assert.equal(options.contentVisibilityAuto, true)
      return false
    },
    get scrollTop() { throw new Error('must not wake skipped content') },
    get scrollLeft() { throw new Error('must not wake skipped content') },
  }
  const visible = { className: 'scroller', tagName: 'DIV', checkVisibility: () => true, scrollTop: 80, scrollLeft: 12 }
  const saved = captureScrollProfile({ querySelectorAll: () => [skipped, visible] })
  assert.equal(saved.size, 1)
  const savedEntry = [...saved][0]
  const baseline = captureScrollProfile({ querySelectorAll: () => [
    { className: 'scroller', tagName: 'DIV', scrollTop: 0, scrollLeft: 0 }, visible,
  ] })
  assert.equal(savedEntry[0], [...baseline.keys()][0])
  assert.deepEqual({ ...savedEntry[1] }, { top: 80, left: 12 })
})

test('没有可见性 API 时保持旧行为，可见元素的两个滚动轴照常保存', () => {
  const elements = [
    { className: 'first', tagName: 'DIV', scrollTop: 40, scrollLeft: 0 },
    { className: 'second', tagName: 'DIV', checkVisibility: () => true, scrollTop: 0, scrollLeft: 25 },
    { className: 'idle', tagName: 'DIV', checkVisibility: () => true, scrollTop: 0, scrollLeft: 0 },
  ]
  const saved = captureScrollProfile({ querySelectorAll: () => elements })
  assert.deepEqual([...saved.values()].map(value => ({ ...value })), [{ top: 40, left: 0 }, { top: 0, left: 25 }])
})

test('恢复剖面时跳过没有记录的离屏内容，有记录的容器仍恢复并重置其它可见滚动', () => {
  const skipped = {
    className: 'skipped', tagName: 'DIV', checkVisibility: () => false,
    get scrollTop() { throw new Error('must not wake skipped content') },
    get scrollLeft() { throw new Error('must not wake skipped content') },
  }
  const target = { className: 'target', tagName: 'DIV', scrollTop: 70, scrollLeft: 15 }
  const profile = captureScrollProfile({ querySelectorAll: () => [target] })
  target.scrollTop = 0
  target.scrollLeft = 0
  target.checkVisibility = () => false
  const other = { className: 'other', tagName: 'DIV', checkVisibility: () => true, scrollTop: 10, scrollLeft: 20 }
  applyScrollProfile({ querySelectorAll: () => [skipped, target, other] }, profile)
  assert.equal(target.scrollTop, 70)
  assert.equal(target.scrollLeft, 15)
  assert.equal(other.scrollTop, 0)
  assert.equal(other.scrollLeft, 0)
})
