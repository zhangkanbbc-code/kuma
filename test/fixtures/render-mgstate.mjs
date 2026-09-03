// 把铭（诊断面板）真编出来渲染一遍，好让护栏对着**渲染产物**下断言而不是源码文本。
//
// 用它的护栏：test/kcs-bgm.test.mjs 的「按号试听」那一节。
// 判断写反了源码文本照样匹配得上，所以「1000 收不收」「档案在不在场」这类判据
// 必须真跑一遍渲染。做法照搬 test/fixtures/render-yu.mjs：把牵着 electron 的那一圈换成桩，
// **和这条护栏有关的那几个模块一律用真的**——bgm-preview（播放链）、bgm-names 与
// shared/kcs-bgm（曲名收口）、shared/bgm-heard（耳测层）都不桩，否则测的就不是复用。
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
    // 与真的同义：输出逐字节没变就不换块，返回 false 让调用方跳过后续重绑
    export const applyPaneHtml = (root: any, key: string, html: string): boolean => {
      const memo = ((globalThis as any).__paneHtml ??= new Map())
      if (memo.get(key) === html && root.innerHTML) return false
      root.innerHTML = html
      memo.set(key, html)
      return true
    }
    export const debugApplyPatch = (patch: unknown) => { ((globalThis as any).__patches ??= []).push(patch) }
    export const debugEmitMarriage = (cue: unknown) => { ((globalThis as any).__cues ??= []).push(cue) }
    export const combinedEscortState = (_deckId: number) => null
    export const deckOnSortie = (_deckId: number) => false
    export const fleetLabel = (_deck: any) => ({ canonical: '第一舰队', custom: '' })
    export const fmtCountdown = (_t: number) => '00:00'
    export const fmtTime = (t: number) => 'T' + t
    export const masterShipName = (id: number) => '舰' + id
    export const mg: any = (globalThis as any).__mg
    export const onMgChange = (cb: (keys: string[]) => void) => { ((globalThis as any).__onMgChange ??= []).push(cb) }
    export const onTick = (cb: () => void) => { ((globalThis as any).__onTick ??= []).push(cb) }
    export const queryLode = async (id: string) => ((globalThis as any).__lodes ?? {})[id] ?? null
  `,
  'renderer/fleet-calc.ts': `
    export const ensureShipStatsLode = (_cb: () => void) => {}
    export const growthGateReport = () => ({ packed: false, tally: {}, failures: [] })
  `,
  'renderer/voice-subtitle.ts': 'export const debugShowVoiceCue = (_cue: unknown) => {}\n',
  'renderer/link.ts': 'export const elink = (_k: string, _id: number, text: string) => text\n',
  'renderer/mu.ts': `
    export const registerModule = (def: unknown) => { (globalThis as any).__mgModule = def }
  `,
  'renderer/localization.ts': `
    export const entityNameHtml = (_k: string, _id: number, name: string) => name
    export const entityTermHtml = (_k: string, _id: number, term: string) => term
  `,
  // 播放源那两档的桩：试听地址与「联不联网」由测试逐例摆，好把三条分支都走一遍
  'renderer/kcs-image.ts': `
    export const bgmAudioUrl = (bgmId: number, kind: 'port' | 'battle'): string | null => {
      ((globalThis as any).__bgmUrlCalls ??= []).push([bgmId, kind])
      if (!(globalThis as any).__remoteArt) return null
      return 'https://example.invalid/kcs2/resources/bgm/' + kind + '/' + String(bgmId).padStart(3, '0') + '_0000.mp3'
    }
    export const remoteArtState = () => ({ enabled: (globalThis as any).__remoteArt === true })
  `,
  'renderer/kcs-voice.ts': 'export const previewVoiceVolume = () => 0.5\n',
  'renderer/bgm-archive.ts': `
    export const archivedBgmUrl = (kind: string, id: number): string | null =>
      ((globalThis as any).__archive ?? {})[kind + '/' + id] ?? null
    export const ensureBgmArchive = async () => {}
  `,
}

const bundle = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-mg-'))
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true })
  for (const [rel, source] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(dir, 'src', ...rel.split('/')), source)
  }
  const outfile = path.join(dir, 'mgstate.cjs')
  buildSync({
    entryPoints: [path.join(dir, 'src', 'renderer', 'modules', 'mgstate.ts')],
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

/**
 * 一副够铭用的假面板。
 *
 * `querySelector` **只认已经渲染进 innerHTML 的类名**——这一点是这副假面板的关键：
 * 发布形态里「按号试听」那张卡整块不生成，取不到元素才是真实情形；
 * 若无脑对任何选择器都返回一个元素，门条那一测就永远绿。
 */
const fakePane = () => {
  const made = new Map()
  return {
    innerHTML: '',
    isConnected: true,
    handlers: new Map(),
    classList: { contains: (name) => name === 'active', add: () => {}, remove: () => {} },
    addEventListener(type, handler) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
    },
    querySelector(selector) {
      const name = selector.replace(/^\./, '')
      if (!this.innerHTML.includes(name)) return null
      if (!made.has(selector)) {
        // 属性得从产物里读回来：输入框的默认号写在 value="…" 上，
        // 凭空给个空串就等于把「一装上就能听」这件事测没了
        const tag = new RegExp(`<[^>]*class="[^"]*\\b${name}\\b[^"]*"[^>]*>`).exec(this.innerHTML)
        // 下拉框的 value 不在标签上，在被 selected 的那个 option 上——真 DOM 就是这么读的。
        // 直接照 `value="…"` 抓会抓到第一个 option 的值，那等于把「默认选中哪一棵树」测没了。
        const select = tag?.[0].startsWith('<select')
          ? new RegExp(`<select[^>]*\\b${name}\\b[^>]*>([\\s\\S]*?)</select>`).exec(this.innerHTML)
          : null
        const selected = select
          ? (/<option[^>]*\bvalue="([^"]*)"[^>]*\bselected/.exec(select[1]) ??
            /<option[^>]*\bvalue="([^"]*)"/.exec(select[1]))?.[1]
          : /value="([^"]*)"/.exec(tag?.[0] ?? '')?.[1]
        made.set(selector, {
          innerHTML: '',
          textContent: '',
          className: '',
          value: selected ?? '',
        })
      }
      return made.get(selector)
    },
    querySelectorAll: () => [],
  }
}

const emptyMg = () => ({
  lastPortTs: 0,
  materials: null,
  decks: [],
  ships: {},
  ndocks: [],
  kdocks: [],
  sortie: null,
  master: { bgms: {} },
})

/**
 * 装一次铭。
 *
 * `lodes` 走的是异步那一路（bgm-names 的 ensureBgmNames），刚 mount 完曲名表还没到，
 * 要 `await mg.settled()` 才看得见曲名——先显示编号正是真机上的样子。
 */
export const mountMgstate = ({
  debugUi = false,
  lodes = {},
  archive = {},
  remoteArt = true,
} = {}) => {
  // 门与铆/钥同一道：`process.env.KANSO_DEBUG_UI === '1'`，在模块顶层求值。
  if (debugUi) process.env.KANSO_DEBUG_UI = '1'
  else delete process.env.KANSO_DEBUG_UI
  globalThis.__mg = emptyMg()
  globalThis.__lodes = lodes
  globalThis.__archive = archive
  globalThis.__remoteArt = remoteArt
  globalThis.__bgmUrlCalls = []
  globalThis.__paneHtml = new Map()
  globalThis.__patches = []
  globalThis.__cues = []
  globalThis.__onMgChange = []
  globalThis.__onTick = []
  globalThis.__mgModule = null

  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundle)(
    require_,
    mod,
    mod.exports,
    'mgstate.cjs',
    '.',
  )
  const def = globalThis.__mgModule
  assert.ok(def && typeof def.mount === 'function', '铭没注册上来')
  const pane = fakePane()
  def.mount(pane)

  const fire = (type, event) => {
    for (const handler of pane.handlers.get(type) ?? []) handler(event)
  }
  return {
    pane,
    def,
    /** 产物里那一枚 ♪ 词条（发布形态下取不到，返回 null） */
    probeHtml: () => pane.querySelector('.mg-bgm-slot')?.innerHTML ?? null,
    /** 在输入框里填一个号，走的是真的那条 input 委托 */
    typeBgmNo: (value) => {
      const input = pane.querySelector('.mg-bgm-no')
      assert.ok(input, '发布形态里没有这个输入框')
      input.value = `${value}`
      fire('input', { target: { classList: { contains: (name) => name === 'mg-bgm-no' } } })
    },
    /** 切换树，走的是真的那条 change 委托（下拉框在真 DOM 上发的就是 change） */
    pickBgmTree: (value) => {
      const select = pane.querySelector('.mg-bgm-tree')
      assert.ok(select, '发布形态里没有这个下拉框')
      select.value = `${value}`
      fire('change', { target: { classList: { contains: (name) => name === 'mg-bgm-tree' } } })
    },
    /** 当前下拉框读出来的值（默认档是产物里带 selected 的那个 option） */
    bgmTree: () => pane.querySelector('.mg-bgm-tree')?.value ?? null,
    bgmUrlCalls: () => globalThis.__bgmUrlCalls,
    /** 等 ensureBgmNames 那个 promise 落地并补渲一拍 */
    settled: async () => {
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      return pane.querySelector('.mg-bgm-slot')?.innerHTML ?? null
    },
  }
}
