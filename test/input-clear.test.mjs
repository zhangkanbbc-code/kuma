import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

// 照 launch-glow 的 DOM 夹具跑真正编译后的模块；浏览窗也执行完整入口。
const compile = (name) => buildSync({
  entryPoints: [fileURLToPath(new URL(`../src/renderer/${name}.ts`, import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'cjs', logLevel: 'silent',
  external: ['electron', '@electron/remote'],
}).outputFiles[0].text
const moduleCode = compile('input-clear')
const browseCode = compile('browse-window')

function fixture(browse = false) {
  const observers = []
  class FakeEvent {
    constructor(type, options = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, options) }
    preventDefault() { this.defaultPrevented = true }
  }
  class Node {
    constructor(tag = '') {
      this.tagName = tag.toUpperCase()
      this.parentElement = null
      this.children = []
      this.listeners = new Map()
      this.attrs = new Map()
      this.style = {}
      this.classes = new Set()
      this.classList = {
        add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name),
        contains: (name) => this.classes.has(name),
      }
    }
    get isConnected() { return this === document.body || !!this.parentElement?.isConnected }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child }
    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null
      this.children = []
      for (const child of children) this.appendChild(child)
      for (const observer of observers) {
        if (observer.targets.has(this)) observer.pending = true
      }
    }
    setAttribute(name, value) { this.attrs.set(name, value) }
    hasAttribute(name) { return this.attrs.has(name) }
    addEventListener(type, handler, capture = false) {
      const list = this.listeners.get(type) ?? []
      list.push({ handler, capture })
      this.listeners.set(type, list)
    }
    dispatchEvent(event) {
      event.target = this
      if (this !== document && this.isConnected) {
        for (const { handler, capture } of document.listeners.get(event.type) ?? []) {
          if (capture) handler(event)
        }
      }
      for (const { handler } of this.listeners.get(event.type) ?? []) handler(event)
      if (event.bubbles && this !== document && this.isConnected) {
        for (const { handler, capture } of document.listeners.get(event.type) ?? []) {
          if (!capture) handler(event)
        }
      }
      return !event.defaultPrevented
    }
    focus() {
      if (document.activeElement === this || !this.isConnected) return
      const old = document.activeElement
      document.activeElement = this
      old?.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: this }))
      this.dispatchEvent(new FakeEvent('focus'))
      this.dispatchEvent(new FakeEvent('focusin', { bubbles: true }))
    }
  }
  class Input extends Node {
    constructor() {
      super('input')
      this.value = ''
      this.readOnly = false
      this.disabled = false
      this.maxLength = -1
      this.rect = { right: 240, top: 20, width: 200, height: 30 }
      this.rectReads = 0
    }
    get type() {
      const value = (this.attrs.get('type') ?? 'text').toLowerCase()
      return ['text', 'search', 'url', 'number', 'date', 'range', 'password', 'email'].includes(value) ? value : 'text'
    }
    getBoundingClientRect() { this.rectReads++; return this.rect }
    select() {}
  }
  const document = new Node()
  document.documentElement = { dataset: {}, style: { removeProperty(name) { delete this[name] } } }
  document.body = new Node('body')
  document.activeElement = null
  const registry = new Map()
  document.querySelector = (selector) => registry.get(selector) ?? null
  document.createElement = (tag) => tag === 'input' ? new Input() : new Node(tag)
  const window = new Node()
  window.kumaTheme = { get: () => Promise.resolve({ mode: 'dark', base: '' }), onChange: () => {} }
  const context = {
    matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    document, window, HTMLInputElement: Input, Event: FakeEvent,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this) }
      observe(target, options) { this.targets.set(target, options) }
      disconnect() { this.targets.clear(); this.pending = false }
    },
    module: { exports: {} }, URLSearchParams, URL,
    navigator: { userAgent: 'test-browser' }, location: { search: '' }, console,
  }
  const pane = document.body.appendChild(new Node('section'))
  const input = (options = {}) => {
    const el = pane.appendChild(new Input())
    el.value = '舰娘'
    Object.assign(el, options)
    return el
  }
  if (browse) {
    for (const id of ['nav-back', 'nav-forward', 'nav-home', 'browse-view']) {
      registry.set(`#${id}`, document.body.appendChild(new Node('div')))
    }
    registry.set('#nav-address', input())
    vm.runInNewContext(browseCode, context)
  } else {
    vm.runInNewContext(moduleCode, context)
    context.module.exports.initInputClear()
  }
  const button = document.body.children.find((el) => el.id === 'input-clear')
  const fire = (el, type, options = {}) => {
    const event = new FakeEvent(type, { bubbles: true, ...options })
    el.dispatchEvent(event)
    return event
  }
  const flushMutations = () => {
    for (const observer of observers) {
      if (observer.pending) { observer.pending = false; observer.callback() }
    }
  }
  return { document, window, pane, input, button, fire, observers, flushMutations, registry, Node }
}

for (const type of [undefined, 'text', 'search', 'url', 'SEARCH', 'invalid']) {
  test(`有效文本类型可清空：${type ?? '省略 type'}`, () => {
    const f = fixture()
    const el = f.input()
    if (type !== undefined) el.setAttribute('type', type)
    el.focus()
    assert.equal(f.button.hidden, false)
  })
}

for (const [label, configure] of [
  ...['number', 'date', 'range', 'password', 'email'].map((type) => [type, (el) => el.setAttribute('type', type)]),
  ['readonly', (el) => { el.readOnly = true }],
  ['disabled', (el) => { el.disabled = true }],
  ['data-no-clear', (el) => el.setAttribute('data-no-clear', '')],
  ['窄框', (el) => { el.rect.width = 95 }],
  ['不可见', (el) => { el.rect.height = 0 }],
  ...[0, 3, 4].map((length) => [`maxlength=${length}`, (el) => { el.maxLength = length }]),
]) {
  test(`排除：${label}`, () => {
    const f = fixture()
    const el = f.input()
    configure(el)
    el.focus()
    f.fire(el, 'pointerover')
    assert.equal(f.button.hidden, true)
    assert.equal(el.classList.contains('has-clear'), false)
  })
}

test('textarea 不收；96px 与 maxlength=5 边界可收', () => {
  const f = fixture()
  const area = f.pane.appendChild(new f.Node('textarea'))
  area.value = '文字'
  area.focus()
  assert.equal(f.button.hidden, true)
  const el = f.input({ maxLength: 5 })
  el.rect.width = 96
  el.focus()
  assert.equal(f.button.hidden, false)
})

test('常驻一枚按钮：默认隐藏，焦点切换跟随，每次只量一次位置', () => {
  const f = fixture()
  assert.equal(f.button.hidden, true)
  assert.equal(f.button.type, 'button')
  assert.equal(f.button.title, '清空')
  assert.equal(f.button.textContent, '×')
  const first = f.input()
  first.focus()
  assert.equal(f.button.style.left, '220px')
  assert.equal(f.button.style.top, '27px')
  assert.equal(first.rectReads, 1)
  const second = f.input({ rect: { right: 400, top: 70, width: 120, height: 24 } })
  second.focus()
  assert.equal(f.button.style.left, '380px')
  assert.equal(f.button.style.top, '74px')
  assert.equal(first.classList.contains('has-clear'), false)
  assert.equal(second.classList.contains('has-clear'), true)
  assert.equal(f.document.body.children.filter((el) => el.id === 'input-clear').length, 1)
})

test('空值不显示，输入后出现，删空后移除留白', () => {
  const f = fixture()
  const el = f.input({ value: '' })
  el.focus()
  assert.equal(f.button.hidden, true)
  el.value = '舰'
  f.fire(el, 'input')
  assert.equal(f.button.hidden, false)
  el.value = ''
  f.fire(el, 'input')
  assert.equal(f.button.hidden, true)
  assert.equal(el.classList.contains('has-clear'), false)
})

for (const focused of [true, false]) {
  test(`点击清空：input → change 冒泡、归还焦点、隐藏（原已聚焦=${focused}）`, () => {
    const f = fixture()
    const el = f.input()
    if (focused) el.focus()
    else f.fire(el, 'pointerover')
    const events = []
    for (const type of ['input', 'change']) {
      f.document.addEventListener(type, (event) => events.push([event.type, event.target.value]))
    }
    assert.equal(f.fire(f.button, 'pointerdown').defaultPrevented, true)
    f.fire(f.button, 'click')
    assert.equal(el.value, '')
    assert.deepEqual(events, [['input', ''], ['change', '']])
    assert.equal(f.document.activeElement, el)
    assert.equal(f.button.hidden, true)
    assert.equal(el.classList.contains('has-clear'), false)
  })
}

test('悬停空框后输入可显示；指针往返输入框与 × 不隐藏，离开即隐藏', () => {
  const f = fixture()
  const el = f.input({ value: '' })
  f.fire(el, 'pointerover')
  assert.equal(f.button.hidden, true)
  el.value = '文字'
  f.fire(el, 'input')
  assert.equal(f.button.hidden, false)
  f.fire(el, 'pointerout', { relatedTarget: f.button })
  f.fire(f.button, 'pointerover', { relatedTarget: el })
  assert.equal(f.button.hidden, false)
  f.fire(f.button, 'pointerout', { relatedTarget: el })
  f.fire(el, 'pointerover', { relatedTarget: f.button })
  assert.equal(f.button.hidden, false)
  f.fire(el, 'pointerout', { relatedTarget: f.document.body })
  assert.equal(f.button.hidden, true)
  f.fire(el, 'pointerover')
  f.fire(el, 'pointerout', { relatedTarget: f.button })
  f.fire(f.button, 'pointerout', { relatedTarget: null })
  assert.equal(f.button.hidden, true)
})

test('聚焦有字时指针扫过其他元素，清空钮保持显示；失焦后隐藏', () => {
  const f = fixture()
  const el = f.input()
  const other = f.pane.appendChild(new f.Node('div'))
  el.focus()
  assert.equal(f.button.hidden, false)
  f.fire(el, 'pointerover')
  f.fire(el, 'pointerout', { relatedTarget: other })
  assert.equal(f.button.hidden, false)
  f.fire(other, 'pointerover', { relatedTarget: el })
  assert.equal(f.button.hidden, false)
  assert.equal(el.classList.contains('has-clear'), true)
  f.fire(f.button, 'pointerout', { relatedTarget: other })
  assert.equal(f.button.hidden, false)
  // 不可清空的输入框也不能撤掉仍聚焦的框所用的按钮。
  for (const excluded of [f.input({ value: '' }), f.input({ readOnly: true }),
    f.input({ rect: { right: 100, top: 0, width: 95, height: 30 } })]) {
    f.fire(excluded, 'pointerover')
    assert.equal(f.button.hidden, false)
    assert.equal(el.classList.contains('has-clear'), true)
  }
  other.focus()
  assert.equal(f.button.hidden, true)
  assert.equal(el.classList.contains('has-clear'), false)
})

test('未聚焦仅悬停有字的文本框，指针离开后隐藏清空钮', () => {
  const f = fixture()
  const el = f.input()
  f.fire(el, 'pointerover')
  assert.notEqual(f.document.activeElement, el)
  assert.equal(f.button.hidden, false)
  f.fire(el, 'pointerout', { relatedTarget: f.pane })
  assert.equal(f.button.hidden, true)
  assert.equal(el.classList.contains('has-clear'), false)
  assert.equal(f.observers[0].targets.size, 0)
})

test('失焦、capture scroll（不冒泡）、resize 均隐藏', () => {
  for (const trigger of [
    (f) => f.document.body.focus(),
    (f) => f.fire(f.pane, 'scroll', { bubbles: false }),
    (f) => f.fire(f.window, 'resize'),
  ]) {
    const f = fixture()
    const el = f.input()
    el.focus()
    trigger(f, el)
    assert.equal(f.button.hidden, true)
    assert.equal(el.classList.contains('has-clear'), false)
    assert.equal(f.observers[0].targets.size, 0)
  }
})

test('重画移除输入框或整层面板，无额外用户事件也隐藏；新框自动接入', () => {
  for (const wholePane of [false, true]) {
    const f = fixture()
    const el = f.input()
    el.focus()
    for (const options of f.observers[0].targets.values()) {
      assert.equal(options.childList, true)
      assert.equal(options.subtree, undefined)
    }
    const unrelated = f.pane.appendChild(new f.Node('div'))
    unrelated.replaceChildren()
    f.flushMutations()
    assert.equal(f.button.hidden, false)
    if (wholePane) f.document.body.replaceChildren(f.button)
    else f.pane.replaceChildren()
    f.flushMutations()
    assert.equal(el.isConnected, false)
    assert.equal(f.button.hidden, true)
    assert.equal(el.classList.contains('has-clear'), false)
    assert.equal(f.observers[0].targets.size, 0)
    if (wholePane) f.document.body.appendChild(f.pane)
    const replacement = f.input()
    replacement.focus()
    assert.equal(f.button.hidden, false)
  }
})

test('清空事件监听同步重画面板时仍派发 change，按钮不滞留', () => {
  const f = fixture()
  const el = f.input()
  const events = []
  el.addEventListener('input', () => { events.push('input'); f.pane.replaceChildren() })
  el.addEventListener('change', () => events.push('change'))
  el.focus()
  f.fire(f.button, 'click')
  f.flushMutations()
  assert.deepEqual(events, ['input', 'change'])
  assert.equal(f.button.hidden, true)
})

test('浏览窗实际入口挂共享清空逻辑，地址栏清空后仍保留焦点', () => {
  const f = fixture(true)
  const el = f.registry.get('#nav-address')
  assert.ok(el.value.length > 0)
  el.focus()
  assert.equal(f.button.hidden, false)
  f.fire(f.button, 'click')
  assert.equal(el.value, '')
  assert.equal(f.document.activeElement, el)
  assert.equal(f.button.hidden, true)
  const html = fs.readFileSync(new URL('../src/renderer/browse.html', import.meta.url), 'utf8')
  assert.match(html, /<script src="\.\/browse\.js"><\/script>/)
})
