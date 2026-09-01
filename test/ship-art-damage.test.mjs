// 中破/大破换受损立绘：阈值、URL 规则、就地换档、取不到时的回落。
//
// 三段都跑**真代码**，不靠断言源码文本（源码守卫放在最后一节，只兜住调用点）：
//   1. 阈值      —— dist/shared/ship-art-path.js 直接 import
//   2. URL 构造  —— 把真的 kcs-image.ts 连同两个桩编出来跑（它顶层要 electron/remote）
//   3. 换档与回落 —— 把真的 entity-art.ts 配一个可控的 kcs-image 桩编出来跑
//
// URL 那几条的期望值不是我算出来的，是**本机学到的真实路径**（游戏自己请求过、
// 由锚记进 ship-art-paths.json 的那批）：banner_dmg 262 条逐条比对，全部与按
// cipher 推算的一致，且一条都不带 api_filename 尾巴。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import shipArtPath from '../dist/shared/ship-art-path.js'

const { shipArtDamaged } = shipArtPath

const require_ = createRequire(import.meta.url)
const { buildSync } = require_('esbuild')
const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..')
const srcFile = (rel) => path.join(ROOT, 'src', rel)
const read = (file) => fs.readFileSync(file, 'utf8')

// ---- 迷你 DOM：只实现取图这条路上真正用到的那几样 ----
globalThis.CustomEvent ??= class CustomEvent {
  constructor(type) {
    this.type = type
  }
}

const matchesSelector = (el, selector) =>
  selector
    .split(/(?=[.[])/)
    .filter(Boolean)
    .every((part) =>
      part.startsWith('.')
        ? el.classes.has(part.slice(1))
        : part.startsWith('[')
          ? el.attrs.has(part.slice(1, -1))
          : true,
    )

class FakeElement {
  constructor(tag = 'span') {
    this.tagName = tag
    this.attrs = new Map()
    this.classes = new Set()
    this.children = []
    this.parentNode = null
    this.hidden = false
    this.writes = 0 // 属性写入次数：「档位没变不换 src」靠它数
    this.listeners = new Map()
  }
  get dataset() {
    const attrs = this.attrs
    return {
      get shipId() {
        return attrs.get('data-ship-id')
      },
    }
  }
  get classList() {
    return {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    }
  }
  hasAttribute(name) {
    return this.attrs.has(name)
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }
  setAttribute(name, value) {
    this.writes += 1
    this.attrs.set(name, String(value))
  }
  removeAttribute(name) {
    if (this.attrs.delete(name)) this.writes += 1
  }
  toggleAttribute(name, on) {
    const want = on ?? !this.attrs.has(name)
    if (want) this.setAttribute(name, '')
    else this.removeAttribute(name)
    return want
  }
  set src(value) {
    this.setAttribute('src', value)
  }
  get src() {
    return this.getAttribute('src')
  }
  set loading(v) {
    this.attrs.set('loading', v)
  }
  set decoding(v) {
    this.attrs.set('decoding', v)
  }
  set alt(v) {
    this.attrs.set('alt', v)
  }
  addEventListener(type, handler) {
    this.listeners.set(type, handler)
  }
  matches(selector) {
    return matchesSelector(this, selector)
  }
  closest(selector) {
    let node = this
    while (node) {
      if (matchesSelector(node, selector)) return node
      node = node.parentNode
    }
    return null
  }
  append(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }
  insertBefore(node, ref) {
    node.parentNode = this
    const at = ref ? this.children.indexOf(ref) : -1
    if (at < 0) this.children.push(node)
    else this.children.splice(at, 0, node)
    return node
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) return child
      const deep = child.querySelector(selector)
      if (deep) return deep
    }
    return null
  }
}
class FakeImage extends FakeElement {
  constructor() {
    super('img')
  }
}
globalThis.HTMLImageElement = FakeImage

const docListeners = new Map()
let docTree = []
globalThis.document = {
  addEventListener: (type, handler) => docListeners.set(type, handler),
  dispatchEvent: () => true,
  createElement: (tag) => (tag === 'img' ? new FakeImage() : new FakeElement(tag)),
  querySelectorAll: (selector) => docTree.filter((el) => matchesSelector(el, selector)),
}

// ---- 把真模块编出来 ----
const compile = (name, files, entry, external = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kanso-${name}-`))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  const outfile = path.join(dir, `${name}.cjs`)
  buildSync({
    entryPoints: [path.join(dir, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external,
    logLevel: 'silent',
  })
  return { dir, outfile }
}

/** 用一个假的 require 把编出来的 CJS 跑起来：electron / remote 都由测试给桩 */
const loadCjs = (outfile, dir, stubs) => {
  const fakeRequire = (id) => (id in stubs ? stubs[id] : require_(id))
  fakeRequire.resolve = (id) => require_.resolve(id)
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', '__filename', '__dirname', read(outfile))(
    fakeRequire,
    mod,
    mod.exports,
    outfile,
    dir,
  )
  return mod.exports
}

// 档案索引的样本：**真实条目**（本机档案里村雨改二那套衣装的中破图，路径与指纹同形）。
// 用一个与其余断言不撞车的槽位，免得把「缓存空 → 远端」那几条改掉。
const ARCHIVE_APPDATA = path.join(os.tmpdir(), 'kanso-art-archive-appdata')
const ARCHIVED = [
  {
    pathname: '/kcs2/resources/ship/character_full_dmg/5310_1257.png',
    mstId: 5310,
    type: 'character_full_dmg',
    version: '61',
    sha1: '0123456789abcdef',
    bytes: 812_345,
    firstSeen: 1_000,
    lastSeen: 2_000,
    seen: 3,
  },
]

// ---- 真 kcs-image：只换掉 electron 与装备图标那两个外部依赖 ----
const kcsImage = (() => {
  const built = compile(
    'kcs-image',
    {
      'shared/ship-art-path.ts': read(srcFile('shared/ship-art-path.ts')),
      'shared/battle-damage.ts': read(srcFile('shared/battle-damage.ts')),
      'shared/ship-costume.ts': read(srcFile('shared/ship-costume.ts')),
      // 立绘档案是取图回退链的第二档（本地缓存 → 档案实物 → 远端）。用**真模块**：
      // 换成桩就测不出「档案里有的时候到底走没走档案」，而那正是 2026-08-31 补的东西。
      'shared/art-archive-plan.ts': read(srcFile('shared/art-archive-plan.ts')),
      'shared/voice-archive-plan.ts': read(srcFile('shared/voice-archive-plan.ts')),
      'renderer/art-archive.ts': read(srcFile('renderer/art-archive.ts')),
      'renderer/kcs-image.ts': read(srcFile('renderer/kcs-image.ts')),
      'renderer/equip-icon.ts': 'export const setEquipIconSpriteProvider = (_f: unknown) => {}\n',
      // 编译入口把档案那一半也导出来：回退链要断言「档案里有的时候走没走档案」，
      // 而喂索引的入口（loadArtArchive）在 art-archive 那边
      'renderer/test-entry.ts': [
        "export * from './kcs-image'",
        "export { loadArtArchive } from './art-archive'",
        '',
      ].join('\n'),
    },
    'renderer/test-entry.ts',
    ['electron', '@electron/remote'],
  )
  // 缓存目录指向一个空目录：一律未命中，走「回退游戏资源服务器」那条，
  // 于是断言看到的就是拼出来的 pathname 本身。
  const globals = {
    DEFAULT_CACHE_PATH: path.join(built.dir, 'empty-cache'),
    APPDATA_PATH: ARCHIVE_APPDATA,
    ROOT, // 让它 require 到真的 assets/preload/kcs-resource-path
  }
  const api = loadCjs(built.outfile, built.dir, {
    electron: {
      ipcRenderer: {
        invoke: async (channel) => (channel === 'mg:art-archive-entries' ? ARCHIVED : null),
        send: () => {},
      },
    },
    '@electron/remote': { getGlobal: (key) => globals[key] },
  })
  api.setGameHost('203.104.209.71')
  // api_filename 是全身立绘的文件名尾巴（真值，取自本机学到的 full 路径）
  api.setShipImageGraph([
    { api_id: 916, api_version: ['1'], api_filename: 'dtzdswuivstg' },
    { api_id: 426, api_version: ['1'], api_filename: 'rtkekdbkqrkg' },
    { api_id: 1587, api_version: ['1'] },
    { api_id: 1600, api_version: ['1'] },
    // 衣装构图也在 api_mst_shipgraph 里（本机实测：村雨改二那四套是 61/61/62/61）
    { api_id: 5310, api_version: ['61'], api_filename: 'tjbchpbtekqm' },
  ])
  return api
})()

// 索引到位之后再跑断言：没到位时档案那一档一律落空（那也是启动瞬间的真实行为）
await kcsImage.loadArtArchive()

const urlPath = (url) => (url == null ? null : new URL(url).pathname)

// ---- 真 entity-art：kcs-image 换成可控桩，好把「取不到」这一支也演出来 ----
//
// localization 用**真的**：缩略图的 title/aria/占位首字自 2026-08-25 起在这一层
// 查译名（此前 11 处调用只有一处记得查，缺图时格子里直接是日文首字）。
// 换成桩就把那条线测没了，所以这里连真模块一起编，kernel 只给它要的两样。
let artSource = () => null
const entityArtBundle = (() => {
  const built = compile(
    'entity-art',
    {
      'renderer/entity-art.ts': read(srcFile('renderer/entity-art.ts')),
      'renderer/localization.ts': read(srcFile('renderer/localization.ts')),
      'shared/abyssal-label.ts': read(srcFile('shared/abyssal-label.ts')),
      'renderer/kernel.ts': [
        'export const esc = (value: unknown): string =>',
        "  `${value ?? ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;')",
        "    .replaceAll('>', '&gt;').replaceAll('\"', '&quot;').replaceAll(\"'\", '&#39;')",
        'export const queryLode = async (_id: string): Promise<any> => null',
        '',
      ].join('\n'),
      'renderer/kcs-image.ts': [
        'export const shipImageUrl = (mstId: number, type: string, damaged = false): string | null =>',
        '  (globalThis as any).__artSource(mstId, type, damaged)',
        'export const useItemImageUrl = (_mstId: number): string | null => null',
        '',
      ].join('\n'),
      // 编译入口：把要断言的两侧一起导出来（entity-art 本身不转发译名表的写入口）
      'renderer/test-entry.ts': [
        "export * from './entity-art'",
        "export { registerLocalizedName } from './localization'",
        '',
      ].join('\n'),
    },
    'renderer/test-entry.ts',
  )
  return loadCjs(built.outfile, built.dir, {})
})()
const entityArt = entityArtBundle
globalThis.__artSource = (...args) => artSource(...args)

/** 常态 / 受损 / 沉没三档各给一个好认的地址 */
const threeTierArt = (mstId, type, damaged) => {
  if (type === 'banner_g') return `g://${mstId}`
  if (type === 'banner') return damaged ? `dmg://${mstId}` : `ok://${mstId}`
  return null
}

/** 从渲染出的 HTML 里挑出这几件要断言的事，不做真解析 */
const thumb = (html) => ({
  src: /<img[^>]*\ssrc="([^"]*)"/.exec(html)?.[1] ?? null,
  fallback: /data-thumb-fallback="([^"]*)"/.exec(html)?.[1] ?? null,
  damaged: / data-ship-damaged/.test(html),
  sunk: / data-ship-sunk/.test(html),
  hasImg: /<img/.test(html),
  textOnly: /class="[^"]*\bfallback\b/.test(html), // 一张图都没有，只剩文字占位
})

// ============================ 1. 阈值 ============================

test('受损立绘从中破线（HP ≤ 50%）起换，大破不再换第二张', () => {
  // 游戏硬规则：中破线是 50%，含等号——51% 还是好好的那张
  assert.equal(shipArtDamaged(51, 100), false)
  assert.equal(shipArtDamaged(50, 100), true)
  assert.equal(shipArtDamaged(5, 10), true)
  // 大破（≤25%）与中破共用同一张：官方每种图只有常态与 _dmg 两个变体
  assert.equal(shipArtDamaged(25, 100), true)
  assert.equal(shipArtDamaged(1, 100), true)
  // 满血、以及「掉了一点点」的小破都不换
  assert.equal(shipArtDamaged(100, 100), false)
  assert.equal(shipArtDamaged(75, 100), false)
})

test('血量说不清时不换图，绝不拿 0/0 算出个「受损」', () => {
  assert.equal(shipArtDamaged(0, 0), false) // 主数据还没到，maxhp 是 0
  assert.equal(shipArtDamaged(Number.NaN, 30), false)
  assert.equal(shipArtDamaged(30, Number.NaN), false)
  assert.equal(shipArtDamaged(30, -1), false)
  // 沉没（0 HP）在档位上算受损，视觉上由沉没那一档吃掉（见下面 entity-art 的用例）
  assert.equal(shipArtDamaged(0, 30), true)
})

// ============================ 2. URL 构造 ============================

test('受损横幅走 banner_dmg，路径与游戏自己下过的那条一模一样', () => {
  // 期望值取自本机学到的真实路径表（游戏请求过的原文），不是本测试算出来的
  assert.equal(urlPath(kcsImage.shipImageUrl(916, 'banner')), '/kcs2/resources/ship/banner/0916_2878.png')
  assert.equal(
    urlPath(kcsImage.shipImageUrl(916, 'banner', true)),
    '/kcs2/resources/ship/banner_dmg/0916_4038.png',
  )
  assert.equal(
    urlPath(kcsImage.shipImageUrl(426, 'banner', true)),
    '/kcs2/resources/ship/banner_dmg/0426_5095.png',
  )
})

test('横幅系不带 api_filename 尾巴，只有全身立绘带', () => {
  // 916 的 api_filename 是 dtzdswuivstg（真值）。带错尾巴就是稳定 404。
  const banner = urlPath(kcsImage.shipImageUrl(916, 'banner', true))
  assert.ok(!banner.includes('dtzdswuivstg'), `横幅不该带 api_filename 尾巴：${banner}`)
  assert.equal(
    urlPath(kcsImage.shipImageUrl(916, 'full', true)),
    '/kcs2/resources/ship/full_dmg/0916_7130_dtzdswuivstg.png',
  )
  assert.equal(
    urlPath(kcsImage.shipImageUrl(426, 'full', true)),
    '/kcs2/resources/ship/full_dmg/0426_8547_rtkekdbkqrkg.png',
  )
})

test('中破与大破指向同一张受损图：换档只有两档，没有第三张', () => {
  const medium = kcsImage.shipImageUrl(916, 'banner', shipArtDamaged(5, 10))
  const heavy = kcsImage.shipImageUrl(916, 'banner', shipArtDamaged(1, 10))
  assert.equal(medium, heavy)
  assert.notEqual(medium, kcsImage.shipImageUrl(916, 'banner', shipArtDamaged(10, 10)))
})

test('深海舰没有受损变体：要了也只会拿回常态那张（北方栖姫系除外）', () => {
  // 本机学到的 262 条 banner_dmg 里一条深海都没有；poi 也是直接把 damaged 抹回 false
  assert.equal(kcsImage.shipImageUrl(1600, 'banner', true), kcsImage.shipImageUrl(1600, 'banner'))
  // 北方栖姫系是官方的例外，仍走 _dmg（这条例外掉了就会显示错的一张）
  assert.equal(
    urlPath(kcsImage.shipImageUrl(1587, 'banner', true)),
    '/kcs2/resources/ship/banner_dmg/1587_1897.png',
  )
})

test('衣装构图号也在 1500 以上，但它有中破图：不许被深海那条规则抹回常态', () => {
  // 归属由 picture_book 学到；没学到之前 5310 在这一层与深海舰无从区分
  assert.equal(
    kcsImage.shipImageUrl(5310, 'character_full', true),
    kcsImage.shipImageUrl(5310, 'character_full'),
    '还没学到归属时按号段处理，这是现状',
  )
  kcsImage.noteShipCostumes({ 5310: [498], 5403: [498] })
  // 期望值取自本机真实档案里的那两条路径（游戏自己请求过的），不是这里算出来的。
  // 断言的是**资源路径**而不是最终地址：中破那条档案里有实物，地址会是 file://
  assert.equal(
    kcsImage.shipImagePath(5310, 'character_full'),
    '/kcs2/resources/ship/character_full/5310_1985.png',
  )
  assert.equal(
    kcsImage.shipImagePath(5310, 'character_full', true),
    '/kcs2/resources/ship/character_full_dmg/5310_1257.png',
    '衣装的中破图确实存在，抹回常态会让两格长同一个样——而且不报错',
  )
  // 真深海舰照旧被抹回常态：这条规则的适用范围只是被收窄，不是被拆掉
  assert.equal(kcsImage.shipImageUrl(1600, 'banner', true), kcsImage.shipImageUrl(1600, 'banner'))
})

test('取图回退链：本地缓存 → 档案实物 → 远端，本机已经有的字节永远优先', () => {
  // 缓存目录是空的，而档案里恰好有这一条（5310 的中破图）——必须走档案那份 file://，
  // 而不是再去游戏服务器要一遍。这正是 2026-08-31 用户实机报的那处脱节：
  // 字节明明在盘上，取图这一侧却看不见。
  const url = kcsImage.shipImageUrl(5310, 'character_full', true)
  assert.match(url, /^file:\/\//, `档案里有实物却没走档案：${url}`)
  assert.match(
    decodeURIComponent(url),
    /art\/character_full_dmg\/5310_1257\.0123456789abcdef\.png$/,
    '取到的不是档案里那一份实物文件',
  )
  // 档案里没有的照旧回退远端（开关开着时）
  assert.match(kcsImage.shipImageUrl(5310, 'character_full'), /^https:\/\//)
})

test('「本机有没有」的判据要连档案一起看，不然屏幕上会摆一句错话', () => {
  // 用户实机报的那半句：六张图正从档案里显示着，脚注却说它们「还没落到缓存」。
  const missing = kcsImage.missingShipImages(5310).map((m) => m.label)
  assert.ok(
    !missing.includes('立绘 · 中破'),
    `档案里有实物的图种仍被算成「本机没有」：${missing.join('、')}`,
  )
  // 档案里没有的那些照旧如实列出来
  assert.ok(missing.includes('立绘'), '档案里没有的图种不该被说成本机已有')
})

test('沉没横幅照旧只有损伤形态，不被受损档挤掉', () => {
  assert.equal(
    urlPath(kcsImage.shipImageUrl(916, 'banner_g')),
    '/kcs2/resources/ship/banner_g_dmg/0916_4212.png',
  )
})

// ============================ 3. 缩略图换档 ============================

test('受损档渲染成 banner_dmg，并把常态横幅备成后路', () => {
  artSource = threeTierArt
  const hurt = thumb(entityArt.shipThumbHtml(916, '大鳳', { damaged: true }))
  assert.equal(hurt.src, 'dmg://916')
  assert.equal(hurt.fallback, 'ok://916', '受损图取不到时要能退回常态，不能掉成裂图/文字')
  assert.equal(hurt.damaged, true)

  const fine = thumb(entityArt.shipThumbHtml(916, '大鳳', { damaged: false }))
  assert.equal(fine.src, 'ok://916')
  assert.equal(fine.fallback, null)
  assert.equal(fine.damaged, false)
})

test('沉了就是沉了：沉没档压过受损档，两个标记不会同时挂着', () => {
  artSource = threeTierArt
  const sunk = thumb(entityArt.shipThumbHtml(916, '大鳳', { sunk: true, damaged: true }))
  assert.equal(sunk.src, 'g://916', '沉没横幅优先——已经沉的舰不该显示中破那张')
  assert.equal(sunk.fallback, 'ok://916')
  assert.equal(sunk.sunk, true)
  assert.equal(sunk.damaged, false)
})

test('受损图推不出来时回落常态图，不留裂图', () => {
  artSource = (mstId, type, damaged) => (damaged ? null : `ok://${mstId}`)
  const hurt = thumb(entityArt.shipThumbHtml(916, '大鳳', { damaged: true }))
  assert.equal(hurt.src, 'ok://916')
  assert.equal(hurt.fallback, null, '备用地址与主地址相同时不该再挂一层回落')

  // 深海那种「受损=常态同址」的情况同理：不多绕一圈错误处理
  artSource = (mstId) => `ok://${mstId}`
  const same = thumb(entityArt.shipThumbHtml(1600, '深海棲艦', { damaged: true }))
  assert.equal(same.src, 'ok://1600')
  assert.equal(same.fallback, null)
})

test('连常态横幅都没有时照旧只剩文字占位，不会画一个空 img', () => {
  artSource = () => null
  const none = thumb(entityArt.shipThumbHtml(916, '大鳳', { damaged: true }))
  assert.equal(none.hasImg, false)
  assert.equal(none.textOnly, true)
})

// ---- 就地换档（镝按阶段拨血条那条路） ----

const madeThumb = (mstId, { sunk = false, damaged = false } = {}) => {
  const host = new FakeElement('span')
  host.classes.add('ship-thumb')
  host.setAttribute('data-ship-id', String(mstId))
  if (sunk) host.setAttribute('data-ship-sunk', '')
  if (damaged) host.setAttribute('data-ship-damaged', '')
  const img = new FakeImage()
  img.setAttribute('data-ship-thumb', '')
  img.setAttribute('src', threeTierArt(mstId, sunk ? 'banner_g' : 'banner', damaged))
  if (sunk || damaged) img.setAttribute('data-thumb-fallback', `ok://${mstId}`)
  host.append(img)
  const text = new FakeElement('span')
  text.classes.add('ship-thumb-fallback')
  host.append(text)
  host.writes = 0
  img.writes = 0
  return { host, img }
}

test('就地换档：正常 → 受损换 src 并备好后路，档位没变时一个字节都不动', () => {
  artSource = threeTierArt
  const { host, img } = madeThumb(916)

  entityArt.setShipThumbTier(host, { damaged: true })
  assert.equal(img.getAttribute('src'), 'dmg://916')
  assert.equal(img.getAttribute('data-thumb-fallback'), 'ok://916')
  assert.equal(host.hasAttribute('data-ship-damaged'), true)

  // 同一档再拨一次（战斗里每来一条补丁都会走这里）：不许重设 src，
  // 一重设浏览器就重走取图与解码，肉眼就是每拍闪一次图
  const writesBefore = img.writes + host.writes
  entityArt.setShipThumbTier(host, { damaged: true })
  entityArt.setShipThumbTier(host, { damaged: true, sunk: false })
  assert.equal(img.writes + host.writes, writesBefore, '档位没变却动了属性')
})

test('就地换档：pin 回受损前的阶段要换回常态图', () => {
  artSource = threeTierArt
  const { host, img } = madeThumb(916, { damaged: true })
  entityArt.setShipThumbTier(host, { damaged: false })
  assert.equal(img.getAttribute('src'), 'ok://916')
  assert.equal(img.getAttribute('data-thumb-fallback'), null, '常态没有更后面的后路了')
  assert.equal(host.hasAttribute('data-ship-damaged'), false)
})

test('就地换档：沉没那一档同样跟着阶段走，且吃掉受损档', () => {
  artSource = threeTierArt
  const { host, img } = madeThumb(916, { damaged: true })
  entityArt.setShipThumbTier(host, { sunk: true, damaged: true })
  assert.equal(img.getAttribute('src'), 'g://916')
  assert.equal(host.hasAttribute('data-ship-sunk'), true)
  assert.equal(host.hasAttribute('data-ship-damaged'), false)
  // 再拨回它还活着的那一刻
  entityArt.setShipThumbTier(host, { sunk: false, damaged: true })
  assert.equal(img.getAttribute('src'), 'dmg://916')
})

test('就地换档：上一档 404 被藏起来之后，换到新一档要重新露面', () => {
  artSource = threeTierArt
  const { host, img } = madeThumb(916, { damaged: true })
  img.hidden = true // 受损图 404 过，错误处理把它藏了
  host.classes.add('fallback')
  entityArt.setShipThumbTier(host, { damaged: false })
  assert.equal(img.hidden, false)
  assert.equal(host.classes.has('fallback'), false)
})

// ---- 补图与 404 回落（真的错误处理） ----

test('补图按元素上挂的档位取，不会把受损/沉没横幅补成常态那张', () => {
  artSource = threeTierArt
  entityArt.installEntityArtFallback()
  const empty = new FakeElement('span')
  empty.classes.add('ship-thumb')
  empty.setAttribute('data-ship-id', '916')
  empty.setAttribute('data-ship-damaged', '')
  empty.append(Object.assign(new FakeElement('span'), { classes: new Set(['ship-thumb-fallback']) }))
  docTree = [empty]

  docListeners.get('kanso:art-source-change')?.()
  const img = empty.querySelector('[data-ship-thumb]')
  assert.ok(img, '美术源变了要把缺的图补上')
  assert.equal(img.getAttribute('src'), 'dmg://916')
  assert.equal(img.getAttribute('data-thumb-fallback'), 'ok://916')
  docTree = []
})

test('受损图 404 时退回常态横幅；常态也没有才掉到文字占位', () => {
  artSource = threeTierArt
  entityArt.installEntityArtFallback()
  const onError = docListeners.get('error')
  assert.ok(onError, '错误处理要在捕获阶段挂在 document 上')

  const { host, img } = madeThumb(916, { damaged: true })
  onError({ target: img })
  assert.equal(img.getAttribute('src'), 'ok://916', '受损图取不到要退回常态横幅')
  assert.equal(img.getAttribute('data-thumb-fallback'), null)
  assert.equal(img.hidden, false)
  assert.equal(host.classes.has('fallback'), false, '还有一张能显示时不该掉成文字')

  onError({ target: img }) // 常态那张也 404
  assert.equal(img.hidden, true)
  assert.equal(host.classes.has('fallback'), true)
})

// ============================ 4. 调用点守卫 ============================

/** 抓出一个文件里全部 shipThumbHtml(...) 调用的原文（括号配平到底，别按 } 截断） */
const thumbCalls = (source) => {
  const out = []
  for (const hit of source.matchAll(/shipThumbHtml\(/g)) {
    let depth = 1
    let i = hit.index + hit[0].length
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') depth -= 1
      i += 1
    }
    out.push(source.slice(hit.index, i))
  }
  return out
}

test('在籍舰的缩略图一律按当前 HP 选档，没有哪个调用点漏掉', () => {
  // 「某一处漏传」正是这条要守的：同一艘舰在两个面板一破一好，看的人只会当是 bug
  const ruCalls = thumbCalls(read(srcFile('renderer/modules/ru.ts'))).filter((call) =>
    call.includes('ship.shipId'),
  )
  assert.ok(ruCalls.length >= 2, `编队里画在籍舰缩略图的地方不止一处，只找到 ${ruCalls.length}`)
  for (const call of ruCalls) {
    assert.match(call, /damaged: shipArtDamaged\(ship\.nowhp, ship\.maxhp\)/, `没按 HP 选档：${call}`)
  }
  const diCalls = thumbCalls(read(srcFile('renderer/modules/di.ts')))
  for (const call of diCalls.filter((c) => c.includes('ship.shipId, name'))) {
    assert.match(call, /damaged: shipArtDamaged\(ship\.nowhp, ship\.maxhp\)/, `没按 HP 选档：${call}`)
  }
})

test('对战行的图跟着当前阶段的血走，敌我同一套判据', () => {
  const di = read(srcFile('renderer/modules/di.ts'))
  const brow = thumbCalls(di).find((call) => call.includes('ship.mstId, ship.name'))
  assert.ok(brow, '没找到对战行的缩略图调用')
  assert.match(brow, /damaged: browArtDamaged\(view\)/, '对战行没有按阶段 HP 选图')
  assert.match(brow, /sunk: view\.sunkVisual/, '沉没那一档的既有处理不能丢')
  // 判据里只许有血量：阵营与 id 段都不在这一层判——演习对手是玩家舰、有受损变体，
  // 出击时的深海由 kcs-image 的 resolveDamagedSuffix 统一抹回常态。
  // 在这儿再写一遍 `side === 0` 或 `mstId > 1500` 就是把同一条规则拆成两份。
  // `unattackable` 那一项不是阵营判据：对潜空袭战里打不到的那一位根本没有 HP，
  // view.hp/hpMax 是解析层兜出来的 0/1，按它算永远落在受损档。
  const body = /const browArtDamaged = \([^)]*\)[^=]*=>\s*\r?\n?\s*(.+)/.exec(di)?.[1]
  assert.equal(
    body?.trim(),
    '!view.ship.unattackable && shipArtDamaged(view.hp, view.hpMax)',
    '受损档要对敌我一视同仁：抹回常态是取图那一层的事，di 不该自己再判阵营/id 段',
  )
})

test('演习对手（玩家舰）真的换受损图，出击时的深海则被抹回常态', () => {
  // 演习对手 mstId < 1500，受损变体实锤存在（期望值取自游戏真实请求过的路径）
  const foeHurt = kcsImage.shipImageUrl(426, 'banner', true)
  assert.equal(urlPath(foeHurt), '/kcs2/resources/ship/banner_dmg/0426_5095.png')
  assert.notEqual(foeHurt, kcsImage.shipImageUrl(426, 'banner'), '演习对手该换的图没换过去')
  // 深海敌方要了也只拿回常态那张：不会因为敌方也判 damaged 而出裂图
  assert.equal(
    kcsImage.shipImageUrl(1600, 'banner', true),
    kcsImage.shipImageUrl(1600, 'banner'),
    '深海没有 _dmg 变体，必须被抹回常态路径',
  )
})

test('镝按阶段拨血条时，舰图与血条/划线在同一拍结算', () => {
  const di = read(srcFile('renderer/modules/di.ts'))
  const settle = /animateHpBar\(bar, \{[^}]*\}, \(\) => \{([\s\S]*?)\n    \}\)/.exec(di)?.[1]
  assert.ok(settle, '没找到按阶段拨血条的结算回调')
  assert.match(settle, /setShipThumbTier\(/, '拨到别的阶段时舰图停在原地，与血条自相矛盾')
  assert.match(settle, /sunk: view\.sunkVisual/)
  assert.match(settle, /damaged: browArtDamaged\(view\)/)
})

test('缩略图的 title/aria/占位首字都走译名表：缺图时格子里不许是日文首字', () => {
  // 调用方照旧传主数据的日文原名，这一层自己查表
  entityArtBundle.registerLocalizedName('ship', 461, '長門', '长门', 'test')
  entityArtBundle.registerLocalizedName('abyssShip', 1523, '軽母ヌ級', '轻母ヌ级', 'test')
  artSource = () => null // 一张图都取不到，占位首字这条支路才演得出来

  const ship = entityArtBundle.shipThumbHtml(461, '長門')
  assert.match(ship, /title="长门"/, 'title 还在说日文')
  assert.match(ship, /aria-label="长门"/, '读屏那份还在说日文')
  assert.match(ship, />长<\/span>/, '缺图时的占位首字还是日文首字')

  // 深海舰的标注名带着形态标注：基名换中文，标注**原样保留**（形态信息，不丢不翻）
  const abyss = entityArtBundle.shipThumbHtml(1523, '軽母ヌ級elite')
  assert.match(abyss, /title="轻母ヌ级elite"/)

  // 查不到的照旧保原文，绝不硬翻
  const unknown = entityArtBundle.shipThumbHtml(99_999, '謎の艦')
  assert.match(unknown, /title="謎の艦"/)
})

test('道具图标同一条口径：14 处调用有 8 处直接摆日文原名，查表放在这一层', () => {
  // 与舰图那条同源。道具图标的 title/aria 过去完全跟着调用方——记得先过
  // entityNamePlain 的出中文、忘了的出日文，同一个界面上两种写法并存。
  entityArtBundle.registerLocalizedName('item', 54, '給糧艦「間宮」', '给粮舰“间宫”', 'test')

  // ① 调用方传日文原名（qn.ts / shi.ts 那 8 处的写法）
  const raw = entityArtBundle.useItemIconHtml(54, '給糧艦「間宮」')
  assert.match(raw, /title="给粮舰/, 'title 还在说日文')
  assert.match(raw, /aria-label="给粮舰/, '读屏那份还在说日文')
  assert.match(raw, />给</, '缺图时的占位首字还是日文首字')

  // ② 调用方已经查过表（bi.ts / ji.ts / zi.ts 那 6 处）——不许被改二次
  const already = entityArtBundle.useItemIconHtml(54, '给粮舰“间宫”')
  assert.match(already, /title="给粮舰/)
  assert.equal(already, raw, '两种调用写法渲染结果不一致，说明查表不是幂等的')

  // ③ 包里没有的新道具：如实保原文
  const unknown = entityArtBundle.useItemIconHtml(99_999, '謎の道具')
  assert.match(unknown, /title="謎の道具"/)
})

test('阈值只有一处：受损档不许在别处再写一遍 0.5', () => {
  // 破损档的线（≤25% 大破 / ≤50% 中破）单一出处是 shared/battle-damage 的 damageTierOf
  const shared = read(srcFile('shared/ship-art-path.ts'))
  assert.match(shared, /damageTierOf/, '受损判据要走 damageTierOf，不能自己写一个 0.5')
  for (const file of ['renderer/entity-art.ts', 'renderer/modules/ru.ts']) {
    assert.ok(
      !/(nowhp|hp)\s*\/\s*(maxhp|hpMax)\s*<=\s*0\.5/.test(read(srcFile(file))),
      `${file} 自己写了一遍中破线`,
    )
  }
})
