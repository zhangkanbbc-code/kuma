// 「跳过去之前先把那一段展开」这件事，**编真代码跑一遍**。
//
// 为什么非得跑：折起来的段是 `display: none`（index.html 里
// `[data-foldable]:not([data-open]) > *:not([data-fold-head])`），没有盒子——
// `scrollIntoView` 一寸不滚、脉冲一个像素不闪、rect 全是 0，整次点击静默空转。
// 「滚之前有没有先展开」是个**顺序**问题，源码正则写反了照样绿
// （共享记忆 source-pattern-guards-miss-logic-bugs）。所以这里把
// section-fold 的 revealSection 与 ji 的点击处理体原样切出来，
// 配一个够用就好的假 DOM 真跑，断言的是行为不是文本。
//
// 仓里没有 jsdom，假 DOM 只实现这两段真正会碰的那几样：
// closest / querySelector(':scope > x') / matches / contains / classList /
// setAttribute 族 / scrollIntoView。选择器只认这几种形状，遇到不认得的直接抛，
// 免得「没匹配上」被静默当成「没有」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { transformSync } from 'esbuild'

const read = (rel) =>
  fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const foldSource = read('src/renderer/section-fold.ts')
const jiSource = read('src/renderer/modules/ji.ts')

const sliceBetween = (source, from, to, label) => {
  const start = source.indexOf(from)
  const end = to === null ? source.length : source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

// ---- 真代码：两本账的登记处 + revealSection + ji 的点击处理体 ----

const BOOKS_BLOCK = sliceBetween(
  foldSource,
  'interface FoldBooks {',
  '\nconst applySpec = (',
  'FoldBooks 与 foldBooks 登记处',
)
const REVEAL_BLOCK = sliceBetween(
  foldSource,
  'export const revealSection = ',
  null,
  'revealSection',
)
const HANDLER_BLOCK = sliceBetween(
  jiSource,
  '      const hit = (event.target as Element | null)?.closest',
  "\n    })\n  })\n  pane.querySelector<HTMLElement>('[data-map-chronicle-retry]')",
  '节点图点击委托的处理体',
)

const HARNESS = `
declare const globalThis: any
type FoldSpec = any
type Element = any
type HTMLElement = any

${BOOKS_BLOCK}

${REVEAL_BLOCK}

// 测试专用登记口：把一棵假树按真形状记进 foldBooks（真代码里这一句在
// installSectionFolding 内，而它要 kernel + MutationObserver，这里不牵进来）
export const registerBooks = (root: any, books: any) => { foldBooks.set(root, books) }

// ---- ji 的点击处理体 ----
const MAP_NODE_JUMP_ATTR: string = globalThis.__kansoReveal.MAP_NODE_JUMP_ATTR
const enemyCompRowSelector: any = globalThis.__kansoReveal.enemyCompRowSelector
declare function requestAnimationFrame(fn: () => void): void
declare function setTimeout(fn: () => void, ms: number): any

export const makeJumpHandler = (pane: any) => (event: any) => {
${HANDLER_BLOCK}
}
`

export const loadHarness = ({ MAP_NODE_JUMP_ATTR, enemyCompRowSelector }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-section-reveal-'))
  const file = path.join(dir, 'harness.cjs')
  fs.writeFileSync(file, transformSync(HARNESS, { loader: 'ts', format: 'cjs' }).code)
  globalThis.__kansoReveal = { MAP_NODE_JUMP_ATTR, enemyCompRowSelector }
  // 处理体里的 rAF 与 setTimeout：跑成确定性的，别把真 timer 拖进来
  // （共享记忆：mock.timers 没还原会让 `node --test` 无输出地挂住）
  globalThis.requestAnimationFrame = (fn) => fn()
  return createRequire(fileURLToPath(import.meta.url))(file)
}

// ---- 够用就好的假 DOM ----

/** 只认 `.cls` / `[a]` / `[a="v"]` / `:not(...)` 拼起来的复合选择器 */
const matchOne = (el, selector) => {
  const parts = selector.match(/:not\([^)]*\)|\[[^\]]*\]|\.[-\w]+/g) ?? []
  assert.ok(parts.length, `假 DOM 不认得选择器：${selector}`)
  assert.equal(
    parts.join(''),
    selector.trim(),
    `假 DOM 只认 .cls / [a] / [a="v"] / :not(...) 的拼接，收到：${selector}`,
  )
  return parts.every((part) => {
    if (part.startsWith(':not(')) return !matchOne(el, part.slice(5, -1))
    if (part.startsWith('.')) return el.classes.has(part.slice(1))
    const m = /^\[([-\w]+)(?:="([^"]*)")?\]$/.exec(part)
    assert.ok(m, `假 DOM 不认得属性选择器：${part}`)
    return m[2] === undefined ? el.attrs.has(m[1]) : el.attrs.get(m[1]) === m[2]
  })
}

class FakeEl {
  constructor(classes = [], attrs = {}) {
    this.classes = new Set(classes)
    this.attrs = new Map(Object.entries(attrs))
    this.children = []
    this.parentElement = null
    this.text = ''
    this.scrollCalls = []
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
    }
  }

  append(...kids) {
    for (const kid of kids) {
      kid.parentElement = this
      this.children.push(kid)
    }
    return this
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value))
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }

  hasAttribute(name) {
    return this.attrs.has(name)
  }

  matches(selector) {
    return matchOne(this, selector)
  }

  closest(selector) {
    let node = this
    while (node) {
      if (matchOne(node, selector)) return node
      node = node.parentElement
    }
    return null
  }

  contains(node) {
    let cursor = node
    while (cursor) {
      if (cursor === this) return true
      cursor = cursor.parentElement
    }
    return false
  }

  querySelector(selector) {
    if (selector.startsWith(':scope > ')) {
      const rest = selector.slice(':scope > '.length)
      return this.children.find((kid) => matchOne(kid, rest)) ?? null
    }
    const walk = (node) => {
      for (const kid of node.children) {
        if (matchOne(kid, selector)) return kid
        const deep = walk(kid)
        if (deep) return deep
      }
      return null
    }
    return walk(this)
  }

  /** 真 CSS 的那一条：折起来的段，除了标题以外的子孙一律没有盒子 */
  get visible() {
    let node = this.parentElement
    while (node) {
      if (node.attrs.has('data-foldable') && !node.attrs.has('data-open')) return false
      node = node.parentElement
    }
    return true
  }

  scrollIntoView(options) {
    // 记下**滚的那一刻**它有没有盒子——「先展开再滚」是顺序问题，只看终态看不出来
    this.scrollCalls.push({ options, visibleAtCall: this.visible })
  }
}

/** 标题元素里第一个非空文本（与 section-fold 的 firstTextTitle 同口径） */
const headTitle = (head) => head.text.trim()

/**
 * 搭一棵与真海域抽屉同形状的树：
 * pane（装了折叠的根）→ .sec[敌编成]（可折、默认折起来）→ .rt-row[锚]
 * 另有一张节点图，圈上带可跳标记。
 */
export const buildDrawer = ({ node = 'Z', open = false } = {}) => {
  const head = new FakeEl(['sec-h'])
  head.text = '敌编成'
  head.setAttribute('data-fold-head', '')
  const row = new FakeEl(['rt-row'], { 'data-comp-node': node })
  const sec = new FakeEl(['sec'], { 'data-foldable': '' })
  if (open) sec.setAttribute('data-open', '')
  sec.append(head, row)

  const circle = new FakeEl(['mg-circle'])
  const group = new FakeEl(['mg-n', 'mg-jump'], { 'data-mg-jump': node })
  group.append(circle)
  const graph = new FakeEl(['mapgraph'])
  graph.append(group)

  const pane = new FakeEl(['mod-ji'])
  pane.append(graph, sec)

  const books = {
    specs: [{ section: '.sec', head: '.sec-h', title: headTitle }],
    opened: new Set(),
    closed: new Set(),
  }
  return { pane, sec, head, row, group, circle, books }
}
