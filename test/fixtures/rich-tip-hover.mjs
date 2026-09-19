// 把富提示（`[data-tip]` 悬停卡）的收起逻辑**原样切出来**真跑一遍。
//
// 仓里没有 jsdom，所以这里手搓一个**够用就好**的假 DOM：只实现 initRichTips 真正
// 会碰的那几样（createElement / classList / addEventListener / closest /
// matches(':hover')），外加一条**确定性的定时器队列**——测悬停时序不能靠真 timer，
// 也不用 node 的 mock.timers（共享记忆：没还原会让 `node --test` 无输出地挂住）。
//
// 判据一个字不改：断言的是真代码的行为。「进卡→直接离卡收不收」这种事，
// 源码正则写反了照样绿。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const source = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'link.ts'), 'utf8')
  .replace(/\r\n/g, '\n')
const ruSource = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'modules', 'ru.ts'), 'utf8')
  .replace(/\r\n/g, '\n')

const sliceBetween = (from, to, label) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `link.ts 里找不到「${label}」，这条守卫的锚点要跟着改`)
  return source.slice(start, end)
}

const TIP_BODY = sliceBetween(
  'const tipBodyRenderers',
  '\nconst hideTip',
  'tipHtml 与 registerTipBody',
)
const HIDE_TIP = sliceBetween(
  "const hideTip = () => tipEl?.classList.remove('show')",
  '\nconst pinTip',
  'hideTip',
)
const PIN_TIP = sliceBetween('const pinTip = (target: HTMLElement) => {', '\nconst initRichTips', 'pinTip')
const INIT = sliceBetween('const initRichTips = () => {', '\nexport const initLink', 'initRichTips')
const los33Start = ruSource.indexOf('const los33TipBodyHtml = (target: HTMLElement): string => {')
const los33End = ruSource.indexOf('\nlet los33TipRegistered', los33Start)
assert.ok(los33Start >= 0 && los33End > los33Start, 'ru.ts 里找不到「los33TipBodyHtml」')
const LOS33_BODY = ruSource.slice(los33Start, los33End)

const HARNESS = `
declare const document: any
declare const window: any
declare function setTimeout(fn: () => void, ms: number): any
declare function clearTimeout(handle: any): void

let tipEl: any = null
let tipTimer: any = null
let pinnedCount = 0

// 这几样与本次要守的行为无关，补最小桩
const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
const hideMenu = () => {}
const hidePeek = () => {}
const placePinnedCard = () => {}
const removePeekCard = (card: any) => card.remove()

// placeAt 的真行为里，与收起相关的只有「加上 show」这一条
const placeAt = (el: any, _target: any) => { el.classList.add('show') }

${TIP_BODY}

${HIDE_TIP}

${PIN_TIP}

${INIT}

${LOS33_BODY}

export { initRichTips, hideTip, tipHtml, pinTip }
export const tipCard = () => tipEl
export const registerLos33 = () => registerTipBody('los33', los33TipBodyHtml)
`

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-rich-tip-'))
  const entry = path.join(dir, 'tip.ts')
  fs.writeFileSync(entry, HARNESS)
  const outfile = path.join(dir, 'tip.cjs')
  buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  return outfile
})()

// ---- 够用就好的假 DOM ----

class FakeEl {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag
    this.style = {}
    this.dataset = attrs.dataset ?? {}
    this.parent = attrs.parent ?? null
    this.hovered = false
    this._classes = new Set()
    this._listeners = new Map()
    this._children = new Map()
    this._className = ''
    this._innerHTML = ''
    this.offsetLeft = 0
    this.offsetTop = 0
    this.offsetWidth = 320
    this.offsetHeight = 200
    this.removed = false
  }

  set className(value) {
    this._className = value
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean))
  }

  get className() {
    return this._className
  }

  set innerHTML(value) {
    this._innerHTML = value
    this._children.clear()
    for (const name of ['p-t', 'p-s', 'pin-x']) {
      const match = name === 'p-s'
        ? value.match(/<div class="p-s">([\s\S]*)<\/div>$/)
        : value.match(new RegExp(`<[^>]+class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`))
      if (!match) continue
      const child = new FakeEl(name === 'pin-x' ? 'span' : 'div', { parent: this })
      child.className = name
      child._innerHTML = match[1]
      this._children.set(`.${name}`, child)
    }
  }

  get innerHTML() {
    return this._innerHTML
  }

  get classList() {
    return {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
      toggle: (c, on) => (on ? this._classes.add(c) : this._classes.delete(c)),
    }
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(handler)
  }

  /** 有没有人给这个类型挂过监听——「卡片压根没有收起出路」就是靠它抓的 */
  hasListener(type) {
    return (this._listeners.get(type) ?? []).length > 0
  }

  fire(type, event = {}) {
    for (const handler of this._listeners.get(type) ?? []) handler({ target: this, ...event })
  }

  matches(selector) {
    if (selector === ':hover') return this.hovered
    return false
  }

  closest(selector) {
    let node = this
    while (node) {
      if (selector === '[data-tip]' && node.dataset?.tip != null) return node
      if (selector.startsWith('.') && node._classes.has(selector.slice(1))) return node
      node = node.parent
    }
    return null
  }

  querySelector(selector) {
    return this._children.get(selector) ?? null
  }

  querySelectorAll() {
    return []
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }
  }

  remove() {
    this.removed = true
  }
}

/** 确定性定时器：只有 advance() 能推动时间。 */
const makeClock = () => {
  let now = 0
  let seq = 0
  const queue = new Map()
  return {
    setTimeout: (fn, ms) => {
      const id = ++seq
      queue.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => queue.delete(id),
    advance: (ms) => {
      now += ms
      for (const [id, task] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (task.at <= now) {
          queue.delete(id)
          task.fn()
        }
      }
    },
  }
}

/** 装好假 DOM，跑一次 initRichTips，返回操作句柄。 */
export const mountRichTips = () => {
  const clock = makeClock()
  const docListeners = new Map()
  const created = []
  const appended = []
  const fakeDocument = {
    createElement: (tag) => {
      const el = new FakeEl(tag)
      created.push(el)
      return el
    },
    body: { appendChild: (el) => appended.push(el) },
    addEventListener: (type, handler) => {
      if (!docListeners.has(type)) docListeners.set(type, [])
      docListeners.get(type).push(handler)
    },
    removeEventListener: (type, handler) => {
      const handlers = docListeners.get(type) ?? []
      docListeners.set(type, handlers.filter((candidate) => candidate !== handler))
    },
  }
  globalThis.document = fakeDocument
  globalThis.window = { innerWidth: 1920, innerHeight: 1080 }
  globalThis.setTimeout = clock.setTimeout
  globalThis.clearTimeout = clock.clearTimeout

  const mod = createRequire(import.meta.url)(bundle)
  mod.initRichTips()
  const card = mod.tipCard()

  const fireDoc = (type, target, extra = {}) => {
    for (const handler of docListeners.get(type) ?? []) {
      handler({ target, stopPropagation: () => {}, preventDefault: () => {}, ...extra })
    }
  }

  return {
    card,
    clock,
    /** 一个挂了 data-tip 的触发字 */
    trigger: (tip = '一行\n两行', dataset = {}, parent = null) =>
      new FakeEl('span', { dataset: { tip, tipTitle: '说明', ...dataset }, parent }),
    panel: (narrow = false) => {
      const panel = new FakeEl('section')
      if (narrow) panel.classList.add('narrow')
      return panel
    },
    html: (el, pinned = false) => mod.tipHtml(el, pinned),
    pinCard: (opts) => mod.pinCard({
      anchor: new FakeEl('button'),
      ...opts,
    }),
    registerLos33: mod.registerLos33,
    hoverTrigger: (el) => fireDoc('mouseover', el),
    leaveTrigger: (el) => fireDoc('mouseout', el),
    pinTrigger: (el) => fireDoc('click', el),
    pinnedCards: () => appended.filter((el) => el !== card && !el.removed),
    fireDocument: (type, event) => fireDoc(type, event.target, event),
    enterCard: () => {
      card.hovered = true
      card.fire('mouseenter')
    },
    leaveCard: () => {
      card.hovered = false
      card.fire('mouseleave')
    },
    shown: () => card.classList.contains('show'),
  }
}
