// 把铃（通知路由）的右下弹卡真造出来、真点一遍。
//
// ## 为什么要真跑
//
// 这条护栏管的是**点哪儿会发生什么**：卡面点了只关闭、「→ ××」点了才跳转。
// 这一族判断写反了源码文本照样匹配得上（护栏只断言源码文本会漏，见 ~/.agents/memory
// 的 source-pattern-guards-miss-logic-bugs 那一条）——把两个 addEventListener 的
// 回调对调，任何正则都照旧全绿，而玩家那边是「想关掉一条通知，结果被弹去了别的面板」。
// 冒泡与 stopPropagation 更是纯运行时的事：`.act` 忘了拦冒泡，卡面那条监听器就会跟着跑。
//
// 做法照搬 test/fixtures/preview-bgm-dom.mjs：把 src 拷进临时目录、把牵着 electron 与
// 账本的那一圈换成桩，**与这条护栏有关的那一份用真的**——modules/lg 本体不桩，
// 否则测的就不是那段代码。入口是 lg 的三个口子：showSortieReadinessToast 直通
// showToast，runNotificationDemo 是 ▶ 测试通知那一路（走完整的 notify）；
// showPowerupResultToast 只在临时副本里改成导出，生产代码的可见性不变。三者都不必
// 先把整个模块 mount 起来。
//
// 账本、托盘徽标、ipc 三处桩都记账（`appendNoticeCalls` / `trayUnreadCalls` /
// `invokeCalls`），测试通知那条护栏要数的正是「演示途中这三样一次都没动过」。
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
    // 账本与托盘这几路各记一笔：▶ 测试通知那条护栏问的正是「有没有人偷偷写了一行」
    export const appendNotice = async (row: unknown) => {
      ((globalThis as any).__appendNotice ??= []).push(row)
      return null
    }
    export const clearNotices = async () => {}
    export const markNoticesRead = async (ids: unknown) => {
      ((globalThis as any).__markRead ??= []).push(ids)
    }
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
    export const pushTrayUnread = async (n: number) => {
      ((globalThis as any).__trayUnread ??= []).push(n)
    }
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
    export { runNotificationDemo, showPowerupResultToast, showSortieReadinessToast } from './modules/lg'
    // 出击态归内核那份 mg 管，勿扰要靠它才摆得出来（桩与铃看的是同一个对象）
    export { mg } from './kernel'
  `,
}

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-lg-'))
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true })
  const lgPath = path.join(dir, 'src', 'renderer', 'modules', 'lg.ts')
  const lgSource = fs.readFileSync(lgPath, 'utf8')
  const testableLgSource = lgSource.replace(
    'const showPowerupResultToast =',
    'export const showPowerupResultToast =',
  )
  assert.notEqual(testableLgSource, lgSource, 'lg.ts 里找不到 showPowerupResultToast，这份夹具的入口要跟着改')
  fs.writeFileSync(lgPath, testableLgSource)
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
    // add/remove 收可变参数：外框光效那一路是 `remove(...五个类名)`，只认第一个的话
    // 桩就在替真代码作答（横幅色调换挡时旧的那圈光会留在 body 上）
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
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
 *
 * `options.gameWrapper`：摆一个 #game-wrapper 进来（数字＝它的 clientWidth，
 * `true` 当 900 用，0 就是「容器被收起」那一档）。默认不摆——真机上游戏容器
 * 没就绪时就是这样，宿主退回 body。
 * `options.config`：配置底稿（键是 config 的完整路径），点击写进去的值也进这份表。
 */
export const mountLgToast = (options = {}) => {
  globalThis.__navigate = []
  globalThis.__activate = []
  globalThis.__lgModule = null
  globalThis.__appendNotice = []
  globalThis.__markRead = []
  globalThis.__trayUnread = []
  globalThis.__invoke = []

  const wrapper = options.gameWrapper == null ? null : new FakeElement('div')
  if (wrapper) {
    wrapper.id = 'game-wrapper'
    wrapper.clientWidth = options.gameWrapper === true ? 900 : Number(options.gameWrapper)
  }
  const doc = {
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => (selector === '#game-wrapper' ? wrapper : null),
    addEventListener: () => {},
    // 窗口有焦点：系统通知那一路就地返回，不去碰 Notification（这台上没有）
    hasFocus: () => true,
  }
  if (wrapper) doc.body.appendChild(wrapper)

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

  const stored = { ...(options.config ?? {}) }
  const config = {
    get: (path, fallback) => (path in stored ? stored[path] : fallback),
    set: (path, value) => {
      stored[path] = value
    },
  }
  const fakeRequire = (id) => {
    if (id === 'electron') {
      return {
        ipcRenderer: {
          on: () => {},
          send: () => {},
          invoke: async (channel, payload) => {
            globalThis.__invoke.push([channel, payload])
            return null
          },
        },
      }
    }
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
  assert.ok(typeof mod.exports.showPowerupResultToast === 'function', '铃没把强化结果弹卡入口导出来')
  assert.ok(typeof mod.exports.runNotificationDemo === 'function', '铃没把 ▶ 测试通知的入口导出来')

  // 整棵树里找那一摞：宿主是 body 还是 #game-wrapper 由玩家选的参照系决定
  const findBox = (el) => {
    for (const child of el.children) {
      if (child.id === 'lg-toasts') return child
      const found = findBox(child)
      if (found) return found
    }
    return null
  }
  const box = () => findBox(doc.body)
  const findById = (el, id) => {
    for (const child of el.children) {
      if (child.id === id) return child
      const found = findById(child, id)
      if (found) return found
    }
    return null
  }
  return {
    doc,
    /** 造一张弹卡。走的是真的 showToast（合并、驱逐、倒计时都是那一份） */
    show: (...args) => mod.exports.showSortieReadinessToast(...args),
    /** 造一张近代化改修结果卡。走的是真的 showPowerupResultToast */
    showPowerup: (result) => mod.exports.showPowerupResultToast(result),
    /** 点一下 ▶ 测试通知（三条里的后两条挂在计时器上，要 fireTimers 才到） */
    demo: () => mod.exports.runNotificationDemo(),
    /** 眼下挂着的置顶横幅 */
    banners: () => findById(doc.body, 'lg-banners')?.children ?? [],
    /** 外框光效那圈类名 */
    bodyClasses: () => [...doc.body.classes],
    /** 写进账本的通知行 */
    appendNoticeCalls: () => globalThis.__appendNotice,
    /** 推给托盘的未读数（updateBadge 一路） */
    trayUnreadCalls: () => globalThis.__trayUnread,
    /** 发出去的 ipc（推送就走这里） */
    invokeCalls: () => globalThis.__invoke,
    /** 内核那份战况。摆 sortie 进去就是「出击中」，自动勿扰随之生效 */
    mg: mod.exports.mg,
    /** 眼下还挂着的那些卡 */
    toasts: () => box()?.children ?? [],
    toast: (index = 0) => box()?.children[index] ?? null,
    /** 那一摞挂在谁身上（'body' / 'game-wrapper'），以及它认的是哪个角 */
    boxHost: () => box()?.parentElement?.id || box()?.parentElement?.tag || null,
    boxCorner: () => box()?.dataset.corner ?? null,
    config,
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
