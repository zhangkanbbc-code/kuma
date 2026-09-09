// 海域详情按海域记分段开合；其他卷不带作用域，仍共享同名习惯。
// 续修：以上为首轮范围；现七卷详情都按词条记开合，无作用域段仍共享同名习惯。
// 与 ji-group-fold 一样编译真实模块，这里连安装、点击、重新施加和 revealSection 一起跑。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { installSectionFolding, revealSection } from './fixtures/section-fold-logic.mjs'

// 只模拟折叠模块用到的 DOM 操作；不认识的选择器直接报错，不能静默漏测。
class FoldElement {
  constructor(className = '', attrs = {}) {
    this.className = className
    this.attrs = new Map(Object.entries(attrs))
    this.children = []
    this.parentElement = null
    this.textContent = ''
    this.listeners = new Map()
  }
  get dataset() {
    return { foldScope: this.attrs.get('data-fold-scope') }
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
    return this
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...children)
  }
  hasAttribute(name) { return this.attrs.has(name) }
  setAttribute(name, value) { this.attrs.set(name, value) }
  removeAttribute(name) { this.attrs.delete(name) }
  toggleAttribute(name, force) {
    if (force) this.setAttribute(name, '')
    else this.removeAttribute(name)
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some((s) => this.matches(s.trim()))
    if (/^\.[\w-]+$/.test(selector)) return this.className === selector.slice(1)
    if (/^[a-z]+$/.test(selector)) return selector === 'div'
    if (selector === '[data-foldable]:not([data-open])') {
      return this.hasAttribute('data-foldable') && !this.hasAttribute('data-open')
    }
    const attr = /^\[([\w-]+)\]$/.exec(selector)
    assert.ok(attr, `假 DOM 不认识选择器：${selector}`)
    return this.hasAttribute(attr[1])
  }
  closest(selector) {
    for (let el = this; el; el = el.parentElement) {
      if (el.matches(selector)) return el
    }
    return null
  }
  contains(el) {
    for (; el; el = el.parentElement) if (el === this) return true
    return false
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }
  querySelector(selector) {
    if (selector.startsWith(':scope > ')) {
      return this.children.find((child) => child.matches(selector.slice(9))) ?? null
    }
    return this.querySelectorAll(selector)[0] ?? null
  }
  addEventListener(type, listener) { this.listeners.set(type, listener) }
}

const section = (title = '海域记录', scope) => {
  const head = new FoldElement('sec-h')
  head.textContent = title
  const body = new FoldElement('body')
  const sec = new FoldElement('sec', scope === undefined ? {} : { 'data-fold-scope': scope })
  sec.append(head, body)
  return { sec, head, body }
}
const isOpen = ({ sec }) => sec.hasAttribute('data-open')
const harness = (t, options = {}, initial = []) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver')
  let observed
  globalThis.MutationObserver = class {
    constructor(callback) { observed = callback }
    observe() {}
  }
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'MutationObserver', previous)
    else delete globalThis.MutationObserver
  })
  const root = new FoldElement().append(...initial)
  const opened = installSectionFolding(root, [{
    section: '.sec', head: '.sec-h', title: (head) => head.textContent, ...options,
  }])
  return {
    root, opened,
    observe: () => observed(),
    click: ({ head }) => root.listeners.get('click')({ target: head }),
    show: (scope, ...sections) => {
      const detail = new FoldElement('detail', scope === undefined ? {} : { 'data-fold-scope': scope })
      root.replaceChildren(detail.append(...sections.map(({ sec }) => sec)))
      root.settle()
    },
  }
}

test('同名段按海域各记各的，换页重建 DOM 后返回仍记得各自开合', (t) => {
  const h = harness(t)
  const a = section()
  h.show('map:3-5', a)
  assert.equal(isOpen(a), false)
  h.click(a)
  assert.equal(isOpen(a), true)
  const b = section()
  h.show('map:62-3', b)
  assert.equal(isOpen(b), false, '另一海域首次必须使用自己的默认态')
  h.click(b)
  h.click(b)
  const returned = section()
  h.show('map:3-5', returned)
  assert.equal(isOpen(returned), true)
  h.show('map:62-3', section())
  assert.equal(h.root.querySelector('.sec').hasAttribute('data-open'), false)
  assert.deepEqual([...h.opened], ['map:3-5:海域记录'])
})

test('作用域可在段根或任一祖先，最近一层优先，空值仍按裸标题记', (t) => {
  const h = harness(t)
  const own = section('海域记录', 'map:62-3')
  const inherited = section('确认编成')
  const empty = section('全图与路线预测', '')
  const outer = new FoldElement('', { 'data-fold-scope': 'map:3-5' })
  h.root.replaceChildren(outer.append(new FoldElement().append(own.sec, inherited.sec, empty.sec)))
  h.root.settle()
  for (const s of [own, inherited, empty]) h.click(s)
  assert.deepEqual([...h.opened], ['map:62-3:海域记录', 'map:3-5:确认编成', '全图与路线预测'])
})

test('无作用域同名段仍共享开合，且与海域的账隔离', (t) => {
  const h = harness(t)
  const a = section()
  h.show(undefined, a)
  h.click(a)
  const b = section()
  h.show(undefined, b)
  assert.equal(isOpen(b), true)
  const map = section()
  h.show('map:3-5', map)
  assert.equal(isOpen(map), false)
  h.show(undefined, b)
  h.click(b)
  h.show(undefined, a)
  assert.equal(isOpen(a), false)
  assert.equal(h.opened.size, 0)
})

test('openByDefault 在每个作用域首次出现时落账，手动折起后重渲与观察回调都不回弹', (t) => {
  const h = harness(t, { openByDefault: new Set(['海域记录']) })
  assert.equal(h.opened.size, 0, '没有出现的段不提前落裸标题的账')
  for (const scope of ['map:3-5', 'map:62-3', undefined]) {
    const first = section()
    h.show(scope, first)
    assert.equal(isOpen(first), true)
    assert.ok(h.opened.has(scope ? `${scope}:海域记录` : '海域记录'))
    h.click(first)
    h.observe()
    assert.equal(isOpen(first), false)
    const rerendered = section()
    h.show(scope, rerendered)
    assert.equal(isOpen(rerendered), false)
  }
  const returned = section()
  h.show('map:3-5', returned)
  assert.equal(isOpen(returned), false)
  assert.equal(h.opened.size, 0)
})

test('安装时已经存在的作用域也按裸标题应用默认展开', (t) => {
  const a = section('海域记录', 'map:3-5')
  const h = harness(t, { openByDefault: new Set(['海域记录']) }, [a.sec])
  assert.equal(isOpen(a), true)
  assert.deepEqual([...h.opened], ['map:3-5:海域记录'])
})

test('默认全展开仍记折起的段，作用域间隔离且返回保留', (t) => {
  const h = harness(t, { openAllByDefault: true })
  const a = section()
  h.show('map:3-5', a)
  assert.equal(isOpen(a), true)
  h.click(a)
  assert.equal(isOpen(a), false)
  const b = section()
  h.show('map:62-3', b)
  assert.equal(isOpen(b), true)
  h.show('map:3-5', a)
  assert.equal(isOpen(a), false)
  h.click(a)
  assert.equal(isOpen(a), true)
  assert.equal(h.opened.size, 0, '默认全展开不能改 opened 账')
})

test('revealSection 写入作用域展开账，重渲保持展开且不传给别的海域或无作用域段', (t) => {
  const h = harness(t)
  const a = section()
  h.show('map:3-5', a)
  assert.equal(revealSection(a.body), true)
  assert.deepEqual([...h.opened], ['map:3-5:海域记录'])
  const returned = section()
  h.show('map:3-5', returned)
  assert.equal(isOpen(returned), true)
  for (const scope of ['map:62-3', undefined]) {
    const other = section()
    h.show(scope, other)
    assert.equal(isOpen(other), false)
  }
})

test('revealSection 对默认全展开只撤销当前作用域的折起账', (t) => {
  const h = harness(t, { openAllByDefault: true })
  for (const scope of ['map:3-5', 'map:62-3']) {
    const s = section()
    h.show(scope, s)
    h.click(s)
  }
  const a = section()
  h.show('map:3-5', a)
  assert.equal(revealSection(a.body), true)
  h.root.settle()
  assert.equal(isOpen(a), true)
  const b = section()
  h.show('map:62-3', b)
  assert.equal(isOpen(b), false)
  assert.equal(h.opened.size, 0)
})

test('only 与 alwaysOpen 仍按裸标题判断，带前缀的名单不能误命中', (t) => {
  const h = harness(t, {
    only: new Set(['海域记录', '确认编成', '全图与路线预测', 'map:3-5:敌编成']),
    alwaysOpen: new Set(['确认编成', 'map:3-5:全图与路线预测']),
  })
  const normal = section()
  const always = section('确认编成')
  const prefixedAlways = section('全图与路线预测')
  const excluded = section('敌编成')
  h.show('map:3-5', normal, always, prefixedAlways, excluded)
  assert.equal(normal.sec.hasAttribute('data-foldable'), true)
  h.click(normal)
  assert.equal(isOpen(normal), true)
  assert.equal(always.sec.hasAttribute('data-foldable'), false)
  assert.equal(always.head.hasAttribute('data-fold-head'), false)
  assert.equal(prefixedAlways.sec.hasAttribute('data-foldable'), true)
  assert.equal(excluded.sec.hasAttribute('data-foldable'), false)
  assert.equal(excluded.head.hasAttribute('data-fold-head'), false)
})

test('ji 作用范围：七个抽屉根都带各自前缀的作用域，前缀互不相同', () => {
  const source = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  const drawers = [
    ['shipDrawerHtml', 'ship', 'esc(form.api_id)'],
    ['equipDrawerHtml', 'equip', 'esc(e.api_id)'],
    ['abyssEquipDrawerHtml', 'abyss-equip', 'esc(e.api_id)'],
    ['abyssDrawerHtml', 'abyss', 'esc(s.api_id)'],
    ['itemDrawerHtml', 'item', 'esc(u.api_id)'],
    ['npcDrawerHtml', 'npc', 'esc(group.name)'],
    ['mapDrawerHtml', 'map', 'code'],
  ]
  assert.equal(new Set(drawers.map(([, prefix]) => prefix)).size, 7)
  for (const [name, prefix, id] of drawers) {
    const start = source.indexOf(`const ${name} = `)
    const end = source.indexOf('\n}\n', start)
    assert.ok(start >= 0 && end > start, `${name} 必须存在完整函数体`)
    const roots = [...source.slice(start, end).matchAll(/<div class="detail"[^>]*>/g)]
    assert.deepEqual(roots.map(([html]) => html), [
      '<div class="detail" data-fold-scope="' + prefix + ':${' + id + '}">',
    ], `${name} 的详情根必须按当前词条标识隔离`)
  }
  assert.equal([...source.matchAll(/data-fold-scope/g)].length, 7,
    '作用域仅加在七个抽屉根，分类目录不加')
  const start = source.indexOf('const mapDrawerHtml = () => {')
  const end = source.indexOf('\nconst mapOfficialInfoHtml = ', start)
  assert.ok(start >= 0 && end > start)
  const mapDrawer = source.slice(start, end)
  assert.match(mapDrawer, /const code = `\$\{info\.api_maparea_id\}-\$\{info\.api_no\}`/)
  assert.match(mapDrawer, /<div class="detail" data-fold-scope="map:\$\{code\}">/)
})

test('舰娘同名段按词条独立记开合，openByDefault 在每个词条首次展开', (t) => {
  const h = harness(t, { openByDefault: new Set(['装备槽']) })
  const showShip = (scope) => {
    const drops = section('掉落海域')
    const slots = section('装备槽')
    h.show(scope, drops, slots)
    return { drops, slots }
  }
  const first = showShip('ship:1')
  assert.equal(isOpen(first.drops), false)
  assert.equal(isOpen(first.slots), true)
  h.click(first.drops)
  h.click(first.slots)
  assert.equal(isOpen(first.drops), true)
  assert.equal(isOpen(first.slots), false)

  const second = showShip('ship:2')
  assert.equal(isOpen(second.drops), false, '另一词条不继承已展开的掉落海域')
  assert.equal(isOpen(second.slots), true, '另一词条首次仍按 openByDefault 展开')
  h.click(second.drops)
  h.click(second.drops)
  h.observe()
  assert.equal(isOpen(second.drops), false)
  assert.equal(isOpen(second.slots), true)

  const returned = showShip('ship:1')
  h.observe()
  assert.equal(isOpen(returned.drops), true, '返回原词条仍记得展开')
  assert.equal(isOpen(returned.slots), false, '手动折起的默认展开段不回弹')
  const secondReturned = showShip('ship:2')
  assert.equal(isOpen(secondReturned.drops), false, '返回另一词条仍记得折起')
  assert.equal(isOpen(secondReturned.slots), true)
  assert.deepEqual([...h.opened], ['ship:1:掉落海域', 'ship:2:装备槽'])
})
