import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
// 编译完整铆模块，真实执行初始化、重排、分隔条监听和拖动循环；只替换外部依赖与 DOM。
const compiled = transformSync(`${read('src/renderer/mu.ts')}\nexport { layout, layoutDock, locate, moveModule, shelveModule, showDockMenu, saveLayout, followGameMissionScene, restoreGameMissionScene };`, {
  loader: 'ts', format: 'cjs', target: 'node20',
}).code

class Element {
  children = []
  parentNode = null
  dataset = {}
  style = {}
  classes = new Set()
  handlers = new Map()
  title = ''
  classList = {
    toggle: (name, on = !this.classes.has(name)) => {
      if (on) this.classes.add(name)
      else this.classes.delete(name)
      return on
    },
    add: (name) => this.classes.add(name),
    remove: (name) => this.classes.delete(name),
    contains: (name) => this.classes.has(name),
  }
  set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)) }
  get className() { return [...this.classes].join(' ') }
  html = ''
  get innerHTML() { return this.html }
  set innerHTML(value) {
    this.html = value
    for (const child of this.children) child.parentNode = null
    this.children = []
    for (const [, attrs, text] of value.matchAll(/<div ([^>]*class="[^"]*\bmi\b[^"]*"[^>]*)>(.*?)<\/div>/g)) {
      const child = new Element()
      child.className = /class="([^"]*)"/.exec(attrs)[1]
      child.textContent = text
      for (const [, key, val] of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) child.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val
      this.append(child)
    }
    if (value.includes('<span class="dk"></span>')) {
      const dot = new Element()
      dot.className = 'dk'
      this.append(dot)
    }
    // 铆的浮层框架；本用例不操作浮层内容。
    if (this.id === 'overlay-host') {
      for (const name of ['ov-back', 'ov-body', 'ov-tabs', 'ov-x']) {
        const child = new Element()
        child.className = name
        this.append(child)
      }
    }
    // 从实际工具条 HTML 建立折叠钮，保留生成时的 title 与事件冒泡层级。
    if (this.classes.has('dock-fold')) {
      for (const [, title] of value.matchAll(/<span class="dock-fold-btn" data-fold="1" title="([^"]*)">×<\/span>/g)) {
        const child = new Element()
        child.className = 'dock-fold-btn'
        child.dataset.fold = '1'
        child.title = title
        this.append(child)
      }
    }
  }
  append(...nodes) { for (const node of nodes) this.appendChild(node) }
  appendChild(node) {
    node.remove()
    node.parentNode = this
    this.children.push(node)
    return node
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this)
    this.parentNode = null
  }
  matches(selector) {
    const relation = /^(.*?)(\s*>\s*|\s+)([^\s>]+)$/.exec(selector)
    if (relation) {
      const [, ancestor, combinator, own] = relation
      if (!this.matches(own)) return false
      if (combinator.includes('>')) return this.parentNode?.matches(ancestor) ?? false
      return this.parentNode?.closest(ancestor) != null
    }
    const id = /#([\w-]+)/.exec(selector)
    if (id && this.id !== id[1]) return false
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(name)) return false
    for (const [, attr, value] of selector.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)) {
      const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      if (!(key in this.dataset) || (value !== undefined && this.dataset[key] !== value)) return false
    }
    return true
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ])
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  addEventListener(type, handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
  }
  removeEventListener(type, handler) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((fn) => fn !== handler))
  }
  dispatch(type, props = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true }, ...props }
    for (let node = this; node; node = node.parentNode) {
      for (const handler of [...(node.handlers.get(type) ?? [])]) handler(event)
      node[`on${type}`]?.(event)
    }
    return event
  }
  getBoundingClientRect() { return { left: 50, top: 40 } }
}

export const makeMu = (saved = {}, { search = '', ids = ['ji', 'di', 'du', 'zi', 'ru', 'qn', 'bi'], mounts = [], shows = [] } = {}) => {
  const document = new Element()
  document.body = new Element()
  document.append(document.body)
  document.createElement = () => new Element()
  const app = new Element()
  app.id = 'app'
  document.body.append(app)
  for (const id of ['btn-layout-lock', 'element-rail']) {
    const el = new Element()
    el.id = id
    app.append(el)
  }
  for (const dock of ['left', 'right', 'bottom']) {
    const el = new Element(), splitter = new Element()
    el.className = 'dock'
    el.dataset.dock = dock
    splitter.className = 'splitter'
    splitter.dataset.split = dock
    app.append(el, splitter)
  }
  const store = structuredClone(saved), reads = [], writes = [], drags = []
  const calls = [], listeners = new Map(), scenes = []
  const raf = new Map()
  let frame = 0
  const stubs = {
    electron: { ipcRenderer: { invoke: async (...args) => { calls.push(args) }, on: (channel, listener) => { listeners.set(channel, listener) } } },
    '@electron/remote': { require: () => ({ get: (_key, fallback) => fallback }) },
    './kernel': {
      uiGet: (key, fallback) => { reads.push([key, fallback]); return store[key] ?? fallback },
      uiSet: (key, value) => { store[key] = structuredClone(value); writes.push([key, structuredClone(value)]) },
      beginMountScope() {}, endMountScope() {}, runMountCleanup() {}, onGameScene(fn) { scenes.push(fn) },
    },
    './crash-guard': { recordCrash: (_tag, error) => { throw error } },
    './launch-glow': { playOverlayEntrance() {} },
    './distract-card-fit': { scheduleDistractCardFit() {}, stopDistractCardFit() {} },
    './link': { receiveEntityRelay() {} },
    './module-command': { receiveModuleCommand() {} },
  }
  const fakeRequire = (id) => id in stubs ? stubs[id] : require(fileURLToPath(new URL(`../../dist/shared/${id.split('/').at(-1)}.js`, import.meta.url)))
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'location', compiled)(
    fakeRequire, module, module.exports, document, { innerWidth: 1600, innerHeight: 1000, dispatchEvent() {} },
    (fn) => { raf.set(++frame, fn); return frame }, (id) => raf.delete(id), { search },
  )
  const mu = module.exports
  for (const id of ids) mu.registerModule({ id, title: id, mount(pane) { mounts.push([id, pane]) }, onShow() { shows.push(id) } })
  mu.initModules()
  mu.setLayoutDragHooks({ start: () => drags.push('start'), end: () => drags.push('end') })
  return {
    ...mu, document, app, store, reads, writes, drags, calls, scenes,
    emit: (channel, payload) => listeners.get(channel)?.({}, payload),
    split: (dock) => document.querySelector(`.splitter[data-split="${dock}"]`),
    groupSplit: () => document.querySelector('.splitter.g[data-gsplit]'),
    fold: (dock) => document.querySelector(`.dock[data-dock="${dock}"] .dock-fold-btn`),
    stub: (dock) => document.querySelector(`.dock[data-dock="${dock}"] .dock-stub`),
    move: () => {
      document.dispatch('mousemove', { clientX: 700, clientY: 600 })
      for (const fn of raf.values()) fn()
      raf.clear()
    },
    up: () => document.dispatch('mouseup'),
  }
}
