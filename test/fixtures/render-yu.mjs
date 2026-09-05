// 把钥（设置）真编出来渲染一遍，好让护栏对着**渲染产物**下断言而不是源码文本。
//
// 钥顶层就要 electron / @electron/remote，还牵着内核、铆、铃和一串副作用模块。
// 这里把那一圈换成桩（shared 那些纯模块原样用真的），剩下的就是这个模块自己的渲染逻辑。
// 用它的护栏：test/settings-sections.test.mjs（分类分页）、test/lode-health.test.mjs（矿脉健康度）。
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
    export const fmtDateTime = (t: number) => 'T' + t
    export const getUiZoom = () => 1.15
    export const setUiZoom = (_z: number) => {}
    export const lodeCredit = (_meta: unknown) => 'credit'
    export const onUiZoom = (_cb: () => void) => {}
    export const queryLode = async (_id: string) => null
    export const setSunkEffectsEnabled = (_v: boolean) => {}
    export const trackMountCleanup = (_cb: () => void) => {}
    export const withViewStateKept = (_root: unknown, mutate: () => void) => { mutate() }
    export const uiGet = <T>(key: string, fallback: T): T => {
      const store = (globalThis as any).__uiStore ?? {}
      return key in store ? store[key] : fallback
    }
    export const uiSet = (key: string, value: unknown) => {
      ;((globalThis as any).__uiWrites ??= []).push([key, value])
    }
    export interface LodeMeta { id: string; name: string }
  `,
  'renderer/mu.ts': `
    export const registerModule = (def: unknown) => { (globalThis as any).__yuModule = def }
  `,
  'renderer/crash-guard.ts': `
    export const crashLog = () => (globalThis as any).__crashes ?? []
    export const onCrash = (_cb: () => void) => () => {}
  `,
  'renderer/kcs-image.ts': 'export const setAllowRemoteArt = (_v: boolean) => {}\n',
  'renderer/kcs-voice.ts': 'export const setAllowRemoteVoice = (_v: boolean) => {}\n',
  // 字幕字号的热切：改一档钥要当场推给字幕层，所以记账而不是空转
  'renderer/voice-subtitle.ts': `
    export const setVoiceCaptionsEnabled = (_v: boolean) => {}
    export const setVoiceCaptionSize = (px: unknown) => {
      ;((globalThis as any).__captionSizes ??= []).push(px)
    }
  `,
  // 浮层入场的热切：翻开关时钥要当场调它，所以记账而不是空转
  'renderer/launch-glow.ts': `
    export const setOverlayEntranceEnabled = (v: boolean) => {
      ;((globalThis as any).__overlayEntrance ??= []).push(v)
    }
  `,
  'renderer/voice-probe.ts': 'export const reloadVoiceAbsent = async () => {}\n',
  'renderer/modules/lg.ts': `
    export const setBuildSpoilerEnabled = (_v: boolean) => {}
    export const setEventBannerEffectsEnabled = (_v: boolean) => {}
    export const setPushEnabled = (_v: boolean) => {}
    export const setPushPresence = (_a: boolean, _b: number) => {}
  `,
}

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-yu-'))
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true })
  for (const [rel, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, 'src', ...rel.split('/')), source)
  }
  const outfile = path.join(dir, 'yu.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'src', 'renderer', 'modules', 'yu.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', '@electron/remote'],
    logLevel: 'silent',
  })
  return fs.readFileSync(outfile, 'utf8')
})()

const require_ = createRequire(import.meta.url)

/** 一副够钥用的假面板：innerHTML 是产物，滚动容器只认 .yu-app */
const fakePane = () => {
  const app = { scrollTop: 0 }
  return {
    innerHTML: '',
    handlers: new Map(),
    app,
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    addEventListener(type, handler) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
    },
    querySelector: (selector) => (selector === '.yu-app' ? app : null),
    querySelectorAll: () => [],
  }
}

/** 点在带 `data-xxx` 的东西上：closest 只认属性选择器，`closest('input')` 一律落空 */
const clickOn = (attrs) => ({
  closest: (selector) => {
    const hit = /^\[data-([a-z-]+)\]$/.exec(selector)
    if (!hit || !(hit[1] in attrs)) return null
    const key = hit[1].replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
    return { dataset: { [key]: attrs[hit[1]] } }
  },
})

/**
 * 在某个输入框上改完值松手（change）。钥里这些分支认的是 `input[data-xxx]`，
 * 与点击那边的 `[data-xxx]` 不是同一种选择器，所以单独一副。
 */
const changeOn = (attr, value) => {
  const key = attr.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
  const self = { dataset: { [key]: '' }, value }
  return {
    closest: (selector) => (selector === `input[data-${attr}]` ? self : null),
  }
}

/**
 * 装一次钥：桩好 electron 与 config，跑 mount，把面板交回来。
 *
 * `lodes` 那一路是**异步**的（mount 里那个 IIFE），所以刚 mount 完拿到的是加载态；
 * 要看缺包清单得 `await yu.settled()` 等它落地。
 */
export const mountYu = ({
  ui = {},
  config = {},
  lodes = null,
  appdataPath = 'C:\\kanso',
  debugUi = false,
} = {}) => {
  // 门与铭/锚同一道：`process.env.KANSO_DEBUG_UI === '1'`，在模块顶层求值。
  // 每次 mountYu 都重新跑一遍 bundle，所以这里改了环境变量当场生效。
  if (debugUi) process.env.KANSO_DEBUG_UI = '1'
  else delete process.env.KANSO_DEBUG_UI
  globalThis.__uiStore = ui
  globalThis.__uiWrites = []
  globalThis.__overlayEntrance = []
  globalThis.__captionSizes = []
  globalThis.__yuModule = null
  globalThis.document = {
    ...(globalThis.document ?? {}),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.window = { dispatchEvent: () => true }
  globalThis.requestAnimationFrame = (cb) => {
    cb()
    return 1
  }
  const configStore = { ...config }
  const invoked = []
  const stubs = {
    electron: {
      ipcRenderer: {
        invoke: (channel) => {
          invoked.push(channel)
          if (channel === 'lode:list') return Promise.resolve(lodes)
          if (channel === 'yu:appdata-path') return Promise.resolve(appdataPath)
          if (channel === 'hotkeys:status') return Promise.resolve({ boss: 'registered' })
          return Promise.resolve(null)
        },
        on: () => {},
        removeListener: () => {},
      },
    },
    '@electron/remote': {
      require: () => ({
        get: (key, fallback) => (key in configStore ? configStore[key] : fallback),
        set: (key, value) => {
          configStore[key] = value
        },
      }),
      shell: { openPath: () => Promise.resolve('') },
    },
  }
  const fakeRequire = (id) => (id in stubs ? stubs[id] : require_(id))
  fakeRequire.resolve = (id) => require_.resolve(id)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundle)(
    fakeRequire,
    mod,
    mod.exports,
    'yu.cjs',
    '.',
  )
  const def = globalThis.__yuModule
  assert.ok(def && typeof def.mount === 'function', '钥没注册上来')
  const pane = fakePane()
  def.mount(pane)
  return {
    pane,
    def,
    invoked,
    click: (attrs) => {
      for (const handler of pane.handlers.get('click') ?? []) handler({ target: clickOn(attrs) })
    },
    /** 在 `input[data-<attr>]` 上填一个值并松手 */
    change: (attr, value) => {
      for (const handler of pane.handlers.get('change') ?? []) {
        handler({ target: changeOn(attr, value) })
      }
    },
    /** 此刻主进程 config 里存着什么（桩里那份） */
    configOf: (key) => configStore[key],
    writes: () => globalThis.__uiWrites,
    /** 钥调 setOverlayEntranceEnabled 的流水账（装配时一次，之后每翻一次开关一次） */
    overlayEntrance: () => globalThis.__overlayEntrance,
    /** 钥调 setVoiceCaptionSize 的流水账（每改一档字幕字号一次） */
    captionSizes: () => globalThis.__captionSizes,
    /** 等 mount 里那个异步 IIFE 把清单读完并重渲一次 */
    settled: async () => {
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      return pane.innerHTML
    },
  }
}

/** 产物里这一屏摆了哪些卡（次序照产物） */
export const cardsIn = (html) => [...html.matchAll(/data-ycard="([^"]+)"/g)].map((hit) => hit[1])

/** 产物里的页签：[类名, 是不是选中, 显示文字] */
export const tabsIn = (html) =>
  [...html.matchAll(/<span class="ytab( on)?" data-ysection="([^"]+)">([^<]*)<\/span>/g)].map(
    (hit) => [hit[2], Boolean(hit[1]), hit[3]],
  )

/** 单张卡的那一段产物（下一张卡的身份标记之前） */
export const cardHtml = (html, id) => {
  const at = html.indexOf(`data-ycard="${id}"`)
  if (at < 0) return ''
  const next = html.indexOf('data-ycard="', at + 1)
  return html.slice(at, next < 0 ? undefined : next)
}
