// 把 BGM 试听（bgm-preview）、那道总机（renderer/preview-audio）与悬浮迷你播放条
// （renderer/preview-bar）连起来真跑一遍。
//
// 为什么要真跑：这一族的判断全是「点第二下该不该重设 src」「拖动期间该不该听 timeupdate」
// 这类分支，写反了源码文本照样匹配得上（护栏只断言源码文本会漏，见 ~/.agents/memory 那一条）。
// 所以这里摆一副够用的假 DOM 与假 Audio：src 的每一次赋值都记账、条子上的每个格子都读得出来，
// 「续播没重设 src」「拖动没被 timeupdate 顶跑」才判得出来。
//
// 做法照搬 test/fixtures/render-mgstate.mjs：把 src 拷进临时目录、把牵着 electron 与
// 曲名表的那一圈换成桩，**与这条护栏有关的三个模块用真的**——bgm-preview（点击循环）、
// preview-audio（互斥 + 上报合并 + 当前这一条是谁）与 preview-bar（条子本身），
// 否则测的就不是那份代码。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const STUBS = {
  'renderer/kernel.ts': `
    const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    export const esc = (s: unknown): string =>
      String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c as keyof typeof ENT])
  `,
  'renderer/kcs-image.ts': `
    export const bgmAudioUrl = (bgmId: number, kind: 'port' | 'battle'): string | null =>
      'https://example.invalid/bgm/' + kind + '/' + bgmId + '.mp3'
    export const remoteArtState = () => ({ enabled: true })
  `,
  'renderer/kcs-voice.ts': 'export const previewVoiceVolume = () => 0.5\n',
  'renderer/bgm-names.ts': `
    export const bgmNameOf = (_kind: string, id: number): string | null => '曲' + id
    export const ensureBgmNames = () => {}
  `,
  'renderer/bgm-archive.ts': `
    export const archivedBgmUrl = (_kind: string, _id: number): string | null => null
    export const ensureBgmArchive = async () => {}
  `,
  'renderer/preview-test-entry.ts': `
    export { bgmPreviewHtml, initBgmPreview } from './bgm-preview'
    export { initPreviewBar } from './preview-bar'
    export {
      activePreview,
      claimPreviewPlayback,
      notePreviewStopped,
      registerPreviewPlayer,
      toggleActivePreview,
    } from './preview-audio'
  `,
}

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-preview-'))
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true })
  for (const [rel, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, 'src', ...rel.split('/')), source)
  }
  const outfile = path.join(dir, 'preview.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'src', 'renderer', 'preview-test-entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'silent',
  })
  return fs.readFileSync(outfile, 'utf8')
})()

const require_ = createRequire(import.meta.url)

/** 一枚 ♪ 词条。classList 是真集合，`.playing`/`.paused` 记号看得见摸得着。 */
const makeEntry = (doc, url, label) => {
  const classes = new Set(['bgm-pv'])
  const el = {
    dataset: { bgmUrl: url, ...(label === undefined ? {} : { bgmLabel: label }) },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    classes,
    closest: (selector) => (selector === '[data-bgm-url]' ? el : null),
  }
  doc.entries.push(el)
  return el
}

/**
 * 迷你条那几个格子够用的一副假元素。**属性一律照生产代码真写的那几个**
 * （className / value / disabled / textContent / aria-label），断言读的就是它写下的东西。
 */
class FakeElement {
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.parent = null
    this.classes = new Set()
    this.attrs = {}
    this.textContent = ''
    this.listeners = new Map()
    // 行内样式：挪窝那一段写的就是这四个键，断言直接读它
    this.style = {}
    /**
     * 量出来的位置与尺寸。**故意不跟着 style 走**——生产代码写下 left/top 之后，
     * 这里若自动跟着变，测的就成了「假 DOM 会不会自己动」。断言一律读 style，
     * rect 只当作「布局此刻是什么样」的输入，由用例自己摆。
     */
    this.rect = { left: 0, top: 0, width: 0, height: 0 }
    /** 拿到指针捕获的那些 pointerId。松手不放就是「条子粘在手上」，这一条要验得出来 */
    this.captured = new Set()
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    }
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
  }

  /** 只够 `'button, input'` 这类纯标签名选择器用——挪窝那段让开控件靠的就是它 */
  closest(selector) {
    const tags = selector.split(',').map((part) => part.trim())
    for (let node = this; node; node = node.parent) if (tags.includes(node.tag)) return node
    return null
  }

  setPointerCapture(id) {
    this.captured.add(id)
  }

  hasPointerCapture(id) {
    return this.captured.has(id)
  }

  releasePointerCapture(id) {
    this.captured.delete(id)
  }

  get className() {
    return [...this.classes].join(' ')
  }

  set className(value) {
    this.classes.clear()
    for (const name of `${value}`.split(/\s+/).filter(Boolean)) this.classes.add(name)
  }

  setAttribute(name, value) {
    this.attrs[name] = `${value}`
  }

  getAttribute(name) {
    return this.attrs[name] ?? null
  }

  appendChild(child) {
    this.children.push(child)
    child.parent = this
    return child
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((fn) => fn !== handler))
  }

  /**
   * 派发一枚事件。`extra` 补上这一枚特有的那几样（指针事件的 pointerId/clientX/button…），
   * `target` 默认是自己——指针捕获之后 move/up 落回宿主节点，但 target 仍是按下时那一个，
   * 用例要能照着摆。
   */
  fire(type, extra = {}) {
    const event = { type, target: this, preventDefault: () => {}, ...extra }
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
    return event
  }
}

/** 够 bgm-preview 与 preview-bar 用的一副假 document：只认它俩真的会写的那几样 */
const makeDocument = () => {
  const handlers = []
  const body = new FakeElement('body')
  const doc = {
    body,
    entries: [],
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, handler) => {
      if (type === 'click') handlers.push(handler)
    },
    querySelectorAll: (selector) => {
      const want = selector.split('.').filter(Boolean)
      return doc.entries.filter((el) => want.every((name) => el.classes.has(name)))
    },
    querySelector: (selector) => doc.querySelectorAll(selector)[0] ?? null,
    click: (el) => {
      for (const handler of handlers) handler({ target: el })
    },
  }
  return doc
}

/**
 * 一副假 Audio。两处要害：
 * ① **src 的每一次赋值都记一笔**——「续播不重设 src」这条判据靠它才验得出来
 *    （真 Audio 上表现为 currentTime 归零）。
 * ② duration 默认 NaN、换源归零——真 Audio 拿到元数据之前就是这样，
 *    「时长不可用时滑条禁用」这条判据得在这个起点上验。
 */
class FakeAudio {
  constructor(registry) {
    this.srcWrites = []
    this.playCalls = 0
    this.paused = true
    this.ended = false
    this.volume = 1
    this.duration = Number.NaN
    this.currentTime = 0
    this.listeners = new Map()
    let value = ''
    Object.defineProperty(this, 'src', {
      get: () => value,
      set: (next) => {
        value = `${next}`
        this.srcWrites.push(value)
        // 真 Audio 换源就是重新开始：进度归零、时长待定、ended 撤销
        this.ended = false
        this.currentTime = 0
        this.duration = Number.NaN
      },
    })
    registry.push(this)
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((fn) => fn !== handler))
  }

  emit(type) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type, target: this })
  }

  play() {
    this.playCalls += 1
    if (this.failNext) {
      this.failNext = false
      return Promise.reject(new Error('播不出来'))
    }
    this.paused = false
    this.ended = false
    this.emit('play')
    return Promise.resolve()
  }

  pause() {
    this.paused = true
    this.emit('pause')
  }

  /** 元数据到手：时长有了 */
  loadMetadata(duration) {
    this.duration = duration
    this.emit('durationchange')
    this.emit('loadedmetadata')
  }

  /** 走到某一刻（真 Audio 每秒来四次 timeupdate） */
  advance(seconds) {
    this.currentTime = seconds
    this.emit('timeupdate')
  }

  /** 播完：真 Audio 会 paused=true、ended=true，并发一枚 ended */
  finish() {
    this.paused = true
    this.ended = true
    this.emit('ended')
  }

  /** 半路断流 / 文件坏掉：play() 早兑现过了，只来一枚 error */
  fail() {
    this.paused = true
    this.emit('error')
  }
}

/** 让 play() 的那一拍微任务落地 */
export const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

/** 装一次 BGM 试听 + 迷你条。每次调用都重新执行一遍 bundle，模块级单例因此是干净的。 */
export const mountBgmPreview = () => {
  const doc = makeDocument()
  const audios = []
  const sends = []
  // 一副够用的假 window：挪窝那一段拿它夹视口、也靠它在窗口变大小时重夹一次
  const resizeHandlers = []
  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: (type, handler) => {
      if (type === 'resize') resizeHandlers.push(handler)
    },
    removeEventListener: () => {},
  }
  globalThis.window = win
  globalThis.document = doc
  globalThis.Audio = class extends FakeAudio {
    constructor() {
      super(audios)
    }
  }

  const fakeElectron = {
    ipcRenderer: { send: (channel, ...args) => sends.push([channel, ...args]) },
  }
  const requireWithElectron = (id) => (id === 'electron' ? fakeElectron : require_(id))

  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundle)(
    requireWithElectron,
    mod,
    mod.exports,
    'preview.cjs',
    '.',
  )
  assert.equal(typeof mod.exports.initBgmPreview, 'function', 'bgm-preview 没编出来')
  assert.equal(typeof mod.exports.initPreviewBar, 'function', 'preview-bar 没编出来')
  mod.exports.initBgmPreview()
  mod.exports.initPreviewBar()

  /** 条子上那四个格子。名字/钮/滑条/时间按 preview-bar 挂进去的顺序排。 */
  const parts = () => {
    const host = doc.body.children.find((el) => el.id === 'preview-bar') ?? null
    if (!host) return null
    const [name, toggle, seek, time] = host.children
    return { host, name, toggle, seek, time }
  }

  return {
    api: mod.exports,
    entry: (url, label) => makeEntry(doc, url, label),
    click: (el) => doc.click(el),
    /** 当前那个 Audio 实例（这个模块只会有一个） */
    audio: () => audios[audios.length - 1] ?? null,
    audios,
    /** 发往主进程的那些 IPC，形如 ['kanso:preview-audio-active', true] */
    sends,
    /** 上报过的「在响没有」序列 */
    activeSends: () =>
      sends.filter(([channel]) => channel === 'kanso:preview-audio-active').map(([, value]) => value),
    marks: (el) => [...el.classes].filter((name) => name !== 'bgm-pv').sort(),

    // ---- 迷你条：读的全是它自己写进节点的东西 ----
    /** 条子此刻长什么样。null = 连节点都没挂上（那是 bug，不是「没显示」） */
    bar: () => {
      const found = parts()
      if (!found) return null
      return {
        shown: found.host.classes.has('show'),
        bodyLifted: doc.body.classes.has('kanso-preview-on'),
        name: found.name.textContent,
        toggle: found.toggle.textContent,
        toggleLabel: found.toggle.getAttribute('aria-label'),
        seekValue: found.seek.value,
        seekMax: found.seek.max,
        seekDisabled: found.seek.disabled,
        time: found.time.textContent,
      }
    },
    /** 条子那枚节点本身。「常驻、不重建」这条判据靠对象同一性来判 */
    barHost: () => parts()?.host ?? null,
    /** body 底下挂着几枚条子。重建过就会多出来一枚 */
    barNodeCount: () => doc.body.children.filter((el) => el.id === 'preview-bar').length,
    /** 模块面板被动重渲：整块重画，长在里面的 ♪ 词条连同记号一起没了 */
    wipeEntries: () => {
      doc.entries.length = 0
    },
    /** 点条子上的播放/暂停钮 */
    clickToggle: () => parts().toggle.fire('click'),

    // ---- 挪窝：位置写在行内样式上，断言读的就是它写下的那四个键 ----
    /** 摆一次布局：条子此刻量出来在哪、多大。不摆的话尺寸是 0，夹取那一段会自行让开 */
    layoutBar: (box) => Object.assign(parts().host.rect, box),
    /** 条子行内样式此刻是什么。默认位时四个键都该是空串 */
    barStyle: () => ({ ...parts().host.style }),
    /** 拖拽期的那层挡板在不在（游戏区会吃掉鼠标事件，靠它挡住） */
    barDragging: () => parts().host.classes.has('pb-dragging'),
    /** 还攥着哪些指针。松手后不清空就是「条子粘在手上」 */
    barCaptured: () => [...parts().host.captured],
    /**
     * 按下。`on` 给 'toggle' / 'seek' 就是按在控件上——那一下不该被拖拽劫持。
     * 事件挂在宿主节点上，所以一律从宿主派发，只把 target 换掉（真 DOM 的冒泡同理）。
     */
    pressBar: (x, y, on) => {
      const found = parts()
      const target = on ? found[on] : found.host
      return found.host.fire('pointerdown', { target, pointerId: 7, button: 0, clientX: x, clientY: y })
    },
    moveBar: (x, y) =>
      parts().host.fire('pointermove', { pointerId: 7, clientX: x, clientY: y }),
    dropBar: () => parts().host.fire('pointerup', { pointerId: 7 }),
    /** 指针被系统收走（切窗口、手势接管） */
    cancelBar: () => parts().host.fire('pointercancel', { pointerId: 7 }),
    /** 窗口变大小 / 换了一块屏 / 界面缩放系数变了 */
    resizeViewport: (width, height) => {
      win.innerWidth = width
      win.innerHeight = height
      for (const handler of [...resizeHandlers]) handler({ type: 'resize' })
    },
    /** 手按在滑条上拖到某一秒（还没松手） */
    dragTo: (seconds) => {
      const seek = parts().seek
      seek.value = `${seconds}`
      seek.fire('input')
    },
    /** 松手 */
    drop: () => parts().seek.fire('change'),
  }
}
