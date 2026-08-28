// 把铃（通知路由）的右下弹卡真造出来、真点一遍。
//
// ## 为什么要真跑
//
// 这条护栏管的是**点哪儿会发生什么**：卡面点了只关闭、「→ ××」点了才跳转。
// 这一族判断写反了源码文本照样匹配得上（只断言源码文本的护栏在这里会漏）——
// 把两个 addEventListener 的
// 回调对调，任何正则都照旧全绿，而玩家那边是「想关掉一条通知，结果被弹去了别的面板」。
// 冒泡与 stopPropagation 更是纯运行时的事：`.act` 忘了拦冒泡，卡面那条监听器就会跟着跑。
//
// 做法照搬 test/fixtures/preview-bgm-dom.mjs：把 src 拷进临时目录、把牵着 electron 与
// 账本的那一圈换成桩，**与这条护栏有关的那一份用真的**——modules/lg 本体不桩，
// 否则测的就不是那段代码。入口走 showSortieReadinessToast：它是 lg 里唯一一个
// 导出的、直通 showToast 的口子，不必先把整个模块 mount 起来。
//
// ## 这副假 DOM 只做真代码会用到的那几样
//
// innerHTML 会被解析成真的节点树（`.tx .act` 这类选择器得查得到），点击按**捕获时
// 算好的冒泡路径**逐级派发（stopPropagation 当场截断）——这两件事就是判据本身，
// 假不得。其余一律从简。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// 铃要用的联合判定：内核整份被换成桩了，这一支**从 kernel.ts 原样切回来**。
// 随手补一个 `() => null` 的假货也能编过，但那等于在桩里替这条判定作了答——
// 弹卡这条护栏虽然不问它，桩一旦说谎，下一个借这份夹具的人就接了个坑。
const kernelSource = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'kernel.ts'), 'utf8')
const ESCORT_STATE = (() => {
  const anchor = "export type CombinedEscortState = 'sortie' | 'formed'"
  const start = kernelSource.indexOf(anchor)
  assert.ok(start >= 0, 'kernel.ts 里找不到 combinedEscortState，这份桩的锚点要跟着改')
  return kernelSource.slice(start)
})()

const STUBS = {
  'renderer/kernel.ts': `
    const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    export const esc = (s: unknown): string =>
      String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c as keyof typeof ENT])
    export const mg: any = { sortie: null, ships: {}, decks: [], ndocks: [], master: { ships: {} }, combinedFlag: 0 }
${ESCORT_STATE}
    export const appendNotice = async (_row: unknown) => null
    export const clearNotices = async () => {}
    export const markNoticesRead = async (_ids: unknown) => {}
    export const queryNotices = async () => []
    export const queryQp = async () => null
    export const nextJstTime = (_h: number, _m: number) => 0
    export const nextMonthlyReset = () => 0
    export const nextWeeklyReset = () => 0
    export const onMarriage = (_cb: unknown) => {}
    export const commitPaneHtml = (_root: unknown, _key: string, _html: string) => false
    export const onMgChange = (_cb: unknown) => {}
    export const onPowerupResult = (_cb: unknown) => {}
    export const onQpChange = (_cb: unknown) => {}
    export const onTick = (_cb: unknown) => {}
    export const onTrayToggleDnd = (_cb: unknown) => {}
    export const pushTrayDnd = async (_on: boolean) => {}
    export const pushTrayUnread = async (_n: number) => {}
    export const repairDuration = (_a: unknown, _b: unknown) => 0
    export const showMainWindow = () => {}
    export const sortieSunkShips = () => []
    export const uiGet = <T,>(_key: string, fallback: T): T => fallback
    export const uiSet = (_key: string, _value: unknown) => {}
  `,
  // 跳转的两条落点各记一笔账：带 ref 走实体路由，没 ref 退回模块级——
  // 「合并卡点进面板总览」与「单卡点进那一条」的区别全在这里看得出来
  'renderer/link.ts': `
    export interface EntityRef { type: string; id: number }
    export const navigate = (ref: EntityRef) => { ((globalThis as any).__navigate ??= []).push(ref) }
    export const elink = (_k: string, _id: number, text: string) => text
  `,
  'renderer/mu.ts': `
    export const registerModule = (def: unknown) => { (globalThis as any).__lgModule = def }
    export const activateModule = (id: string) => { ((globalThis as any).__activate ??= []).push(id) }
  `,
  'renderer/localization.ts': `
    export const entityNamePlain = (_k: string, _id: number, name: string) => name
    export const entityNameHtml = (_k: string, _id: number, name: string) => name
    export const entityTermHtml = (_k: string, _id: number, term: string) => term
  `,
  'renderer/ship-first-owned.ts': 'export const observeOwnedShips = (_cb: unknown) => {}\n',
  'renderer/fatigue.ts': `
    export const FATIGUE_READY_COND = 30
    export const estimatedCond = (_a: unknown, _b: unknown) => 49
    export const fatigueReadyTs = (_a: unknown, _b: unknown) => 0
    export const observeFatigue = (_a: unknown) => {}
    export const observedCond = (_a: unknown) => null
  `,
  'renderer/lg-test-entry.ts': `
    export { showSortieReadinessToast } from './modules/lg'
  `,
}

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-lg-'))
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true })
  for (const [rel, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, 'src', ...rel.split('/')), source)
  }
  const outfile = path.join(dir, 'lg.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'src', 'renderer', 'lg-test-entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', '@electron/remote'],
    logLevel: 'silent',
  })
  return fs.readFileSync(outfile, 'utf8')
})()

// ---------------------------------------------------------------- 假 DOM

/** `<span class="tx" title="…">文字</span>` 这一档标记够用的一台解析器 */
const parseHtml = (html, parent, make) => {
  const TOKEN = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*\/?>/g
  const stack = [parent]
  let cursor = 0
  let token
  while ((token = TOKEN.exec(html))) {
    const text = html.slice(cursor, token.index)
    if (text.trim()) stack[stack.length - 1].text += text.trim()
    cursor = token.index + token[0].length
    if (token[1]) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const el = make(token[2])
    for (const [, name, value] of token[3].matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (name === 'class') el.className = value
      else el.setAttribute(name, value)
    }
    stack[stack.length - 1].appendChild(el)
    stack.push(el)
  }
  const tail = html.slice(cursor)
  if (tail.trim()) stack[stack.length - 1].text += tail.trim()
}

/** `.tx > span:not(.act)` 这一档选择器：后代/子代、标签、类、:not(.类) */
const parseSelector = (selector) =>
  selector
    .trim()
    .split(/\s+/)
    .reduce((steps, piece) => {
      if (piece === '>') {
        steps.push({ child: true })
        return steps
      }
      const step = steps.length && !steps[steps.length - 1].parsed ? steps.pop() : {}
      step.parsed = true
      step.classes = [...piece.matchAll(/\.([\w-]+)(?![^(]*\))/g)].map((m) => m[1])
      step.not = [...piece.matchAll(/:not\(\.([\w-]+)\)/g)].map((m) => m[1])
      step.tag = /^[a-zA-Z][\w-]*/.exec(piece)?.[0]?.toLowerCase() ?? null
      steps.push(step)
      return steps
    }, [])

const matchesStep = (el, step) =>
  (!step.tag || el.tag === step.tag) &&
  step.classes.every((name) => el.classes.has(name)) &&
  step.not.every((name) => !el.classes.has(name))

class FakeElement {
  constructor(tag) {
    this.tag = tag.toLowerCase()
    this.attrs = {}
    this.classes = new Set()
    this.dataset = {}
    this.style = {}
    this.children = []
    this.text = ''
    this.parentElement = null
    this.listeners = new Map()
    this.offsetWidth = 0
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    }
  }

  get className() {
    return [...this.classes].join(' ')
  }

  set className(value) {
    this.classes = new Set(`${value}`.split(/\s+/).filter(Boolean))
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value) {
    this.children = []
    this.text = `${value}`
  }

  get innerHTML() {
    return this.html ?? ''
  }

  set innerHTML(value) {
    this.html = `${value}`
    this.children = []
    this.text = ''
    parseHtml(this.html, this, (tag) => new FakeElement(tag))
  }

  setAttribute(name, value) {
    this.attrs[name] = `${value}`
  }

  getAttribute(name) {
    return this.attrs[name] ?? null
  }

  appendChild(child) {
    child.parentElement?.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    this.children = this.children.filter((node) => node !== child)
    child.parentElement = null
  }

  /**
   * 摘下去。**已经摘过一次也照样记账**：`removeCalls` 是「关闭这个动作发生了几次」，
   * 不是「现在还在不在树上」——跳转那一路要是忘了拦冒泡，卡面那条监听器会跟着
   * 再关一次，而两次关闭在画面上看不出任何区别（第二次是空操作），只有这个计数看得见。
   */
  remove() {
    this.removeCalls = (this.removeCalls ?? 0) + 1
    this.parentElement?.removeChild(this)
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  querySelectorAll(selector) {
    const steps = parseSelector(selector)
    const found = []
    const walk = (el) => {
      for (const child of el.children) {
        if (matchesChain(child, steps)) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

/** 从末一段往回走：`>` 只认亲爹，其余可以隔代 */
const matchesChain = (el, steps) => {
  let node = el
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]
    if (i === steps.length - 1) {
      if (!matchesStep(node, step)) return false
      continue
    }
    if (steps[i + 1].child) {
      node = node.parentElement
      if (!node || !matchesStep(node, step)) return false
      continue
    }
    let ancestor = node.parentElement
    while (ancestor && !matchesStep(ancestor, step)) ancestor = ancestor.parentElement
    if (!ancestor) return false
    node = ancestor
  }
  return true
}

/**
 * 点一下。
 *
 * **冒泡路径在派发前就算好**——真 DOM 就是这样：监听器把自己从树上摘下去
 * （弹卡的每条监听器最后都 `el.remove()`），事件照样继续往上走。
 * 路径若改成边走边读 parentElement，「卡面点了只关闭」会因为节点已摘而假绿。
 */
const clickOn = (el) => {
  const path = []
  for (let node = el; node; node = node.parentElement) path.push(node)
  let stopped = false
  const event = {
    type: 'click',
    target: el,
    stopPropagation: () => {
      stopped = true
    },
  }
  for (const node of path) {
    for (const handler of [...(node.listeners.get('click') ?? [])]) handler(event)
    if (stopped) return
  }
}

const require_ = createRequire(import.meta.url)

/**
 * 装一次铃，把弹卡那一路的家伙什都交出来。
 *
 * 计时器是假的（`timers.fire()` 手动催），所以 8 秒的自动关闭不会把
 * `node --test` 拖住 8 秒，也不会留下悬着的句柄。
 */
export const mountLgToast = () => {
  globalThis.__navigate = []
  globalThis.__activate = []
  globalThis.__lgModule = null

  const doc = {
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    // #game-wrapper 不在场：宿主退回 body（真机上游戏容器没就绪时就是这样）
    querySelector: () => null,
    addEventListener: () => {},
  }

  const timers = []
  const fakeSetTimeout = (fn, ms) => {
    timers.push({ fn, ms, id: timers.length + 1 })
    return timers.length
  }
  const fakeClearTimeout = (id) => {
    const found = timers.find((timer) => timer.id === id)
    if (found) found.cleared = true
  }
  const frames = []

  const config = { get: (_path, fallback) => fallback, set: () => {} }
  const fakeRequire = (id) => {
    if (id === 'electron') return { ipcRenderer: { on: () => {}, send: () => {}, invoke: async () => null } }
    if (id === '@electron/remote') return { require: () => config }
    return require_(id)
  }

  const mod = { exports: {} }
  // document / setTimeout 这几样用**形参**递进去，只在这份产物里生效——
  // 覆盖 globalThis 会连 node --test 自己的计时一起换掉
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    'document',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    bundle,
  )(
    fakeRequire,
    mod,
    mod.exports,
    'lg.cjs',
    '.',
    doc,
    fakeSetTimeout,
    fakeClearTimeout,
    (fn) => frames.push(fn),
  )

  assert.ok(typeof mod.exports.showSortieReadinessToast === 'function', '铃没把弹卡入口导出来')

  const box = () => doc.body.children.find((child) => child.id === 'lg-toasts') ?? null
  return {
    doc,
    /** 造一张弹卡。走的是真的 showToast（合并、驱逐、倒计时都是那一份） */
    show: (...args) => mod.exports.showSortieReadinessToast(...args),
    /** 眼下还挂在右下角的那些卡 */
    toasts: () => box()?.children ?? [],
    toast: (index = 0) => box()?.children[index] ?? null,
    click: clickOn,
    navigateCalls: () => globalThis.__navigate,
    activateCalls: () => globalThis.__activate,
    /** 催一次自动关闭（8 秒那一档），没被 clearTimeout 掉的才跑 */
    fireTimers: () => {
      for (const timer of [...timers]) if (!timer.cleared && !timer.fired) {
        timer.fired = true
        timer.fn()
      }
    },
    frames,
  }
}
