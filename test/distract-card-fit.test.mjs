import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import fitRules from '../dist/shared/distract-card-fit.js'

const { DISTRACT_GAME_MIN_RATIO, DISTRACT_CARD_MIN_ZOOM, distractCardZoom } = fitRules
const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('卡片比例：剩余高度、不放大、空内容、默认与自定义下限', () => {
  assert.equal(DISTRACT_GAME_MIN_RATIO, 0.45)
  assert.equal(DISTRACT_CARD_MIN_ZOOM, 0.6)
  for (const [available, natural, expected] of [
    [400, 500, 0.8], [400, 400, 1], [400, 200, 1], [400, 0, 1],
    [300, 500, 0.6], [100, 500, 0.6], [0, 500, 0.6],
  ]) assert.equal(distractCardZoom(available, natural), expected)
  assert.equal(distractCardZoom(100, 500, 0.7), 0.7)
})

test('两遍输入输出：第二遍使用重排后的自然高，不累计相乘上一遍 zoom', () => {
  const first = distractCardZoom(360, 480)
  assert.equal(first, 0.75)
  assert.equal(distractCardZoom(360, 450), 0.8)
  assert.equal(distractCardZoom(360, 500), 0.72)
  assert.equal(distractCardZoom(360, 300), 1)
  assert.equal(distractCardZoom(360, 900), 0.6)
})

// 真编译并执行拟合控制器，只替换浏览器量尺与帧调度；不复制产品的算法或生命周期。
const controller = transformSync(read('src/renderer/distract-card-fit.ts'), { loader: 'ts', format: 'cjs' }).code
const style = () => {
  const values = new Map()
  return { setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key),
    get: (key) => values.get(key), values }
}
const makeFit = (heights = [500, 500]) => {
  const frames = new Map(), observers = [], reads = []
  let serial = 0
  const workbench = { clientHeight: 800, style: style() }
  const makeCard = (natural) => ({ style: style(), get scrollHeight() {
    reads.push(this.style.get('--distract-card-zoom'))
    return typeof natural === 'function' ? natural() : natural
  } })
  let n = 0
  let card = makeCard(() => heights[Math.min(n++, heights.length - 1)])
  const dock = { clientHeight: 798, offsetHeight: 800, style: style(), querySelector: () => card }
  const document = { querySelector: (selector) => selector === '#workbench' ? workbench : dock }
  class ResizeObserver {
    targets = []
    disconnected = false
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target) { this.targets.push(target) }
    disconnect() { this.disconnected = true }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'ResizeObserver', 'requestAnimationFrame',
    'cancelAnimationFrame', controller)(() => fitRules, module, module.exports, document, ResizeObserver,
    (callback) => { frames.set(++serial, callback); return serial }, (id) => frames.delete(id))
  return { ...module.exports, workbench, dock, observers, frames, reads, get card() { return card },
    replaceCard: (height) => { card = makeCard(height) },
    flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()) } }
}

for (const side of ['top', 'bottom', 'left', 'right']) {
  test(`${side} 侧按实际空间拟合，两遍量尺与 CSS 变量一致`, () => {
    const m = makeFit([600, 550])
    m.scheduleDistractCardFit(side)
    m.flush()
    const available = side === 'top' || side === 'bottom' ? 438 : 798
    const first = distractCardZoom(available, 600)
    const second = distractCardZoom(available, 550)
    assert.deepEqual(m.reads, ['1', `${first}`])
    assert.equal(m.card.style.get('--distract-card-zoom'), `${second}`)
    assert.equal(m.card.style.get('--distract-card-height'), `${available / second}px`)
    assert.equal(m.card.style.get('--distract-card-overflow'), 'hidden')
    assert.equal(m.workbench.style.get('--distract-game-min'), '45%')
    assert.deepEqual(m.observers[0].targets, [m.workbench, m.dock, m.card])
  })
}

test('短卡保留自然尺寸，过高卡停在 0.6 并允许内部滚动', () => {
  for (const [height, zoom, overflow] of [[200, 1, 'hidden'], [1200, 0.6, 'auto']]) {
    const m = makeFit([height])
    m.scheduleDistractCardFit('bottom')
    m.flush()
    assert.equal(m.card.style.get('--distract-card-zoom'), `${zoom}`)
    assert.equal(m.card.style.get('--distract-card-overflow'), overflow)
  }
})

test('尺寸通知合并一帧、侧位取最新值，render 换卡后重新观察新节点', () => {
  const m = makeFit()
  m.scheduleDistractCardFit('bottom')
  m.scheduleDistractCardFit('right')
  assert.equal(m.frames.size, 1)
  m.flush()
  assert.equal(m.card.style.get('--distract-card-zoom'), '1')
  m.workbench.clientHeight = 600
  m.dock.clientHeight = 598
  m.observers[0].callback()
  m.observers[0].callback()
  assert.equal(m.frames.size, 1)
  m.flush()
  assert.equal(m.observers.length, 1)
  m.replaceCard(1000)
  m.scheduleDistractCardFit('top')
  m.flush()
  assert.ok(m.observers[0].disconnected)
  assert.equal(m.observers.length, 2)
  assert.ok(m.observers[1].targets.includes(m.card))
  assert.equal(m.card.style.get('--distract-card-zoom'), '0.6')
})

test('退出断开观察器、取消未执行帧、清除全部分心拟合变量', () => {
  const m = makeFit()
  m.scheduleDistractCardFit('bottom')
  m.flush()
  m.observers[0].callback()
  m.stopDistractCardFit()
  assert.ok(m.observers[0].disconnected)
  assert.equal(m.frames.size, 0)
  for (const element of [m.workbench, m.dock, m.card]) assert.equal(element.style.values.size, 0)
  const pending = makeFit()
  pending.scheduleDistractCardFit('top')
  pending.stopDistractCardFit()
  pending.flush()
  assert.equal(pending.observers.length, 0)
})

// 本单禁止启动窗口，Node 没有 CSS 排版与原生 ResizeObserver；源码守卫仅检查
// 网格和跨模块接线，不能据此声称验证了实机布局。算法与控制器行为由上面的执行用例覆盖。
test('源码接线：上下卡行 auto、游戏保底共享 45%，左右列与行高不变', () => {
  const html = read('src/renderer/index.html')
  for (const [side, rows, columns] of [
    ['top', 'auto minmax(var(--distract-game-min), 1fr)', 'minmax(0, 1fr)'],
    ['bottom', 'minmax(var(--distract-game-min), 1fr) auto', 'minmax(0, 1fr)'],
    ['left', 'minmax(0, 1fr)', '380px minmax(0, 1fr)'],
    ['right', 'minmax(0, 1fr)', 'minmax(0, 1fr) 380px'],
  ]) {
    const rule = html.match(new RegExp(`#app\\.distract\\[data-distract-side='${side}'\\] #workbench \\{([^}]+)`))[1]
    assert.ok(rule.includes(`grid-template-rows: ${rows};`))
    assert.ok(rule.includes(`grid-template-columns: ${columns};`))
  }
  assert.match(html, /zoom: var\(--distract-card-zoom, 1\)/)
  assert.match(read('src/renderer/distract-card-fit.ts'), /setProperty\('--distract-card-zoom'/)
  assert.match(html, /#app\.distract \.dock\[data-distract-card\] \{[^}]*overflow: hidden/)
  assert.match(html, /body\.kuma-distract \.mod-di \.result \{[^}]*flex-wrap: nowrap/)
})

test('源码接线：镝 render 末尾拟合、退出分心断开 ResizeObserver', () => {
  const di = read('src/renderer/modules/di.ts')
  const render = di.slice(di.indexOf('const render = (pane:'), di.indexOf('// 回顾窗口复用镝'))
  assert.match(render, /if \(getDistractState\(\)\.on\) fitDistractCard\(\)\s*\}\s*$/)
  const mu = read('src/renderer/mu.ts')
  assert.match(mu, /if \(distract\.on\) fitDistractCard\(\)\s*else stopDistractCardFit\(\)/)
  assert.match(mu, /export const exitDistract =[\s\S]*?distract\.on = false[\s\S]*?syncDistractChrome\(\)/)
  assert.match(read('src/renderer/distract-card-fit.ts'), /export const stopDistractCardFit = \(\) => \{\s*observer\?\.disconnect\(\)/)
})
