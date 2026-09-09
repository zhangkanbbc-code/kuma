import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
// 编译完整铆模块，真实执行初始化、重排、分隔条监听和拖动循环；只替换外部依赖与 DOM。
const compiled = transformSync(`${read('src/renderer/mu.ts')}\nexport { layout, layoutDock };`, {
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
  set innerHTML(value) {
    for (const child of this.children) child.parentNode = null
    this.children = []
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
    }
    return event
  }
  getBoundingClientRect() { return { left: 50, top: 40 } }
}

const makeMu = (saved = {}) => {
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
  const raf = new Map()
  let frame = 0
  const stubs = {
    electron: { ipcRenderer: { invoke: async () => {} } },
    '@electron/remote': { require: () => ({ get: (_key, fallback) => fallback }) },
    './kernel': {
      uiGet: (key, fallback) => { reads.push([key, fallback]); return store[key] ?? fallback },
      uiSet: (key, value) => { store[key] = structuredClone(value); writes.push([key, structuredClone(value)]) },
      beginMountScope() {}, endMountScope() {}, runMountCleanup() {}, onGameScene() {},
    },
    './crash-guard': { recordCrash: (_tag, error) => { throw error } },
    './launch-glow': { playOverlayEntrance() {} },
    './distract-card-fit': { scheduleDistractCardFit() {}, stopDistractCardFit() {} },
  }
  const fakeRequire = (id) => id in stubs ? stubs[id] : require(fileURLToPath(new URL(`../dist/shared/${id.split('/').at(-1)}.js`, import.meta.url)))
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', compiled)(
    fakeRequire, module, module.exports, document, { innerWidth: 1600, innerHeight: 1000 },
    (fn) => { raf.set(++frame, fn); return frame }, (id) => raf.delete(id),
  )
  const mu = module.exports
  for (const id of ['ji', 'di', 'du', 'zi', 'ru', 'qn', 'bi']) mu.registerModule({ id, title: id, mount() {} })
  mu.initModules()
  mu.setLayoutDragHooks({ start: () => drags.push('start'), end: () => drags.push('end') })
  return {
    ...mu, document, app, store, reads, writes, drags,
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

test('默认不锁；初始化读取独立持久化键，开关返回新状态并同步类、按钮与标题', () => {
  const m = makeMu()
  assert.equal(m.isLayoutLocked(), false)
  assert.ok(m.reads.some(([key, fallback]) => key === 'layout.locked' && fallback === false))
  assert.equal(m.app.classList.contains('layout-locked'), false)
  assert.equal(m.writes.some(([key]) => key === 'layout.locked'), false)
  const before = structuredClone(m.layout)
  for (const on of [true, false]) {
    assert.equal(m.toggleLayoutLock(), on)
    assert.equal(m.isLayoutLocked(), on)
    assert.equal(m.app.classList.contains('layout-locked'), on)
    assert.equal(m.document.querySelector('#btn-layout-lock').classList.contains('on'), on)
    assert.deepEqual(m.writes.at(-1), ['layout.locked', on])
    for (const [dock, label] of [['left', '左坞'], ['right', '右坞'], ['bottom', '底坞']]) {
      assert.equal(m.split(dock).title, on ? '布局已锁定' : `拖动调整${label} · 双击折叠`)
    }
    assert.equal(m.groupSplit().title, on ? '布局已锁定' : '拖动调整两格比例')
    assert.deepEqual(m.layout, before)
  }
})

test('重启恢复锁定；锁定期间重铺格间分隔条仍显示锁定提示', () => {
  const m = makeMu({ 'layout.locked': true })
  assert.equal(m.isLayoutLocked(), true)
  assert.equal(m.app.classList.contains('layout-locked'), true)
  const previous = m.groupSplit()
  m.layoutDock('bottom')
  assert.notEqual(m.groupSplit(), previous)
  assert.equal(m.groupSplit().title, '布局已锁定')
  m.setLayoutLocked(false)
  assert.equal(makeMu(m.store).isLayoutLocked(), false)
})

for (const dock of ['left', 'right', 'bottom']) {
  test(`${dock} 坞：锁定后按下、移动、松手均不拖动，解锁后恢复改尺寸与遮罩`, () => {
    const m = makeMu()
    m.setLayoutLocked(true)
    const before = structuredClone(m.layout), count = m.writes.length
    m.split(dock).dispatch('mousedown')
    m.move()
    assert.equal(m.document.querySelector('#drag-overlay'), null)
    m.up()
    assert.deepEqual(m.layout, before)
    assert.deepEqual(m.drags, [])
    assert.equal(m.writes.length, count)
    m.setLayoutLocked(false)
    m.split(dock).dispatch('mousedown')
    assert.equal(m.document.querySelector('#drag-overlay'), null)
    m.move()
    assert.ok(m.document.querySelector('#drag-overlay'))
    assert.notEqual(m.layout.dockSize[dock], before.dockSize[dock])
    m.up()
    assert.equal(m.document.querySelector('#drag-overlay'), null)
    assert.deepEqual(m.drags, ['start', 'end'])
  })

  test(`${dock} 坞：锁定挡住双击折叠与展开，解锁后三者入口恢复`, () => {
    const m = makeMu()
    m.setLayoutLocked(true)
    m.split(dock).dispatch('dblclick')
    assert.equal(m.layout.collapsed[dock], false)
    m.setLayoutLocked(false)
    m.split(dock).dispatch('dblclick')
    assert.equal(m.layout.collapsed[dock], true)
    m.setLayoutLocked(true)
    m.split(dock).dispatch('dblclick')
    m.split(dock).dispatch('mousedown')
    m.move()
    m.up()
    assert.equal(m.layout.collapsed[dock], true)
    assert.deepEqual(m.drags, [])
    m.setLayoutLocked(false)
    m.split(dock).dispatch('dblclick')
    assert.equal(m.layout.collapsed[dock], false)
  })
}

test('锁定时点击三坞的 × 不折叠、不改布局与持久化', () => {
  const m = makeMu({ 'layout.locked': true })
  const before = structuredClone(m.layout), count = m.writes.length
  for (const dock of ['left', 'right', 'bottom']) {
    m.fold(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], false)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), false)
  }
  assert.deepEqual(m.layout, before)
  assert.equal(m.writes.length, count)
})

test('锁定时点击三坞的折叠把手不展开、不改布局与持久化', () => {
  const m = makeMu()
  for (const dock of ['left', 'right', 'bottom']) m.fold(dock).dispatch('click')
  m.setLayoutLocked(true)
  const before = structuredClone(m.layout), count = m.writes.length
  for (const dock of ['left', 'right', 'bottom']) {
    assert.equal(m.layout.collapsed[dock], true)
    m.stub(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], true)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), true)
  }
  assert.deepEqual(m.layout, before)
  assert.equal(m.writes.length, count)
})

test('解锁后 × 折叠与把手展开均恢复，布局尺寸与格比例保持', () => {
  const m = makeMu({ 'layout.locked': true })
  const before = structuredClone(m.layout)
  m.setLayoutLocked(false)
  for (const dock of ['left', 'right', 'bottom']) {
    m.fold(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], true)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), true)
    assert.equal(m.store['layout.v3'].collapsed[dock], true)
    m.stub(dock).dispatch('click')
    assert.equal(m.layout.collapsed[dock], false)
    assert.equal(m.stub(dock).closest('.dock').classList.contains('collapsed'), false)
    assert.equal(m.store['layout.v3'].collapsed[dock], false)
  }
  assert.deepEqual(m.layout, before)
})

test('折叠钮与把手 title 随锁定同步，初始化与锁定期间重铺也保留正确提示', () => {
  const m = makeMu({ 'layout.locked': true })
  const checkTitles = (locked) => {
    for (const [dock, label] of [['left', '左坞·查阅'], ['right', '右坞·临战'], ['bottom', '底坞·常驻']]) {
      assert.equal(m.fold(dock).title, locked ? '布局已锁定' : '折叠此坞（导航条点元素可再展开）')
      assert.equal(m.stub(dock).title, locked ? '布局已锁定' : `展开${label}`)
    }
  }
  checkTitles(true)
  for (const dock of ['left', 'right', 'bottom']) {
    const previous = m.fold(dock)
    m.layoutDock(dock)
    assert.notEqual(m.fold(dock), previous)
  }
  checkTitles(true)
  for (const locked of [false, true, false]) {
    m.setLayoutLocked(locked)
    checkTitles(locked)
  }
})

test('格间按下：锁定不创建遮罩、不改 size；解锁后恢复两格比例拖动', () => {
  const m = makeMu()
  const before = structuredClone(m.layout.docks.bottom)
  m.setLayoutLocked(true)
  m.groupSplit().dispatch('mousedown')
  m.move()
  assert.equal(m.document.querySelector('#drag-overlay'), null)
  m.up()
  assert.deepEqual(m.layout.docks.bottom, before)
  assert.deepEqual(m.drags, [])
  m.setLayoutLocked(false)
  m.groupSplit().dispatch('mousedown')
  m.move()
  assert.ok(m.document.querySelector('#drag-overlay'))
  m.up()
  assert.equal(m.layout.docks.bottom[0].size, 650)
  assert.deepEqual(m.drags, ['start', 'end'])
})

test('样式与快捷键接线：锁定光标和常态色、按钮高亮、改键标题同步', () => {
  const html = read('src/renderer/index.html'), index = read('src/renderer/index.ts')
  assert.match(html, /#app\.layout-locked \.splitter, #app\.layout-locked \.splitter\.g \{ cursor: default; \}/)
  assert.match(html, /#app\.layout-locked \.splitter:hover \{ background: var\(--line-soft\); \}/)
  assert.match(html, /#app\.layout-locked \.splitter\.g:hover \{ background: var\(--line\); \}/)
  assert.match(html, /#app\.layout-locked \.dock-fold-btn, #app\.layout-locked \.dock-stub \{ cursor: default; \}/)
  assert.match(html, /#app\.layout-locked \.dock-fold-btn:hover \{ color: var\(--dim\); \}/)
  assert.match(html, /#app\.layout-locked \.dock-stub:hover \{ background: var\(--bg1\); color: var\(--dim\); \}/)
  assert.match(html, /#btn-layout-lock\.on, \.ov-btn\.on \{[^}]*background: var\(--accent-dim\)/)
  assert.match(index, /\$\('#btn-layout-lock'\)\.addEventListener\('click', toggleLayoutLock\)/)
  assert.match(index, /id === 'layoutLock'\) toggleLayoutLock\(\)/)
  assert.match(index, /const syncHotkeyTitles = \(\) => \{[\s\S]*?hotkeyTitle\('layoutLock'\)/)
  assert.match(index, /addEventListener\('kuma-hotkeys-changed', syncHotkeyTitles\)/)
  assert.match(read('src/main/hotkeys.ts'), /layoutLock: readAccelerator\('layoutLock'\)/)
})
