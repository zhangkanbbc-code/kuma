import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSync, transformSync } from 'esbuild'
import shared from '../dist/shared/fairy-salvo.js'
import gunTypes from '../dist/shared/equip-main-gun.js'
import voiceSlots from '../dist/shared/voice-scene-slots.js'
import dodge from '../dist/shared/caption-dodge.js'
import { mountYu, cardHtml } from './fixtures/render-yu.mjs'

const { salvoGunsOf, fairyMirrored, salvoAllowed, FAIRY_FACES_LEFT, FAIRY_MIRROR_UI_KEY } = shared
const output = buildSync({ entryPoints: [fileURLToPath(new URL('../src/renderer/fairy-salvo.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
const mod = { exports: {} }
new Function('module', 'exports', output)(mod, mod.exports)
const { armFairySalvo, initFairySalvo, setFairySalvoEnabled, refreshFairySalvo } = mod.exports

test('实战取图允许远端回退，连续攻击共用加载缓存并保持动画时间轴', async () => {
  const dom = install(), urls = ['file:///fairy/10.png', 'https://example.invalid/fairy/20.png']
  const resolved = []
  dom.data.imageUrl = (id) => { resolved.push(id); return urls[id === 10 ? 0 : 1] }
  const cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    assert.deepEqual(dom.requested, urls)
    assert.equal(actors(dom).length, 2)
    const timeline = () => ({ css: dom.layer().children[0].textContent,
      actors: actors(dom).map((actor) => [actor.style.animation, ...actor.children.map((el) => el.style.animation)]) })
    const firstTimeline = timeline()
    const old = dom.layer()
    await dom.fire()
    assert.notEqual(dom.layer(), old)
    assert.equal(old.parent, null)
    assert.equal(actors(dom).length, 2)
    assert.deepEqual(timeline(), firstTimeline, '连续攻击保持升沉、烟尘、双闪光和后坐时间轴')
    assert.deepEqual(dom.requested, urls, '连续攻击不重复请求本地或远端图片')
    assert.deepEqual([...new Set(resolved)], [10, 20])
    assert.deepEqual(dom.writes, [])
  } finally { cancel() }
})

test('实战缺址或图片加载失败时不绘制，失败缓存不重试', async () => {
  for (const url of [null, 'https://example.invalid/fairy.png']) {
    const dom = install({ deferred: true }); dom.data.imageUrl = () => url
    dom.guns([9])
    const cancel = armFairySalvo(true, dom.data)
    try {
      const attack = dom.fire()
      if (url) dom.pending[0](true)
      await attack
      assert.equal(dom.layer(), undefined)
      await dom.fire()
      assert.deepEqual(dom.requested, url ? [url] : [])
      assert.equal(dom.layer(), undefined)
    } finally { cancel() }
  }
})

test('选炮按格序、去重、封顶四件；空槽和非主炮不入选', () => {
  const master = { slotitems: Object.fromEntries(gunTypes.MAIN_GUN_TYPES.map((type2, i) => [10 + i, { type2 }])) }
  master.slotitems[99] = { type2: 4 }
  assert.deepEqual(salvoGunsOf({ slot: [-1, 99, 12, 12, 10, 11, 13, 14] }, master), [12, 10, 11, 13])
  assert.deepEqual(salvoGunsOf({ slot: [-1, 99] }, master), [])
  assert.deepEqual(salvoGunsOf(null, master), [])
})

test('镜像为共享表与用户覆盖的并集', () => {
  assert.equal(FAIRY_FACES_LEFT.size, 0)
  assert.equal(fairyMirrored(10, [10, 10]), true)
  assert.equal(fairyMirrored(11, [10]), false)
  FAIRY_FACES_LEFT.add(11)
  try { assert.equal(fairyMirrored(11, []), true) } finally { FAIRY_FACES_LEFT.delete(11) }
})

test('五门穷举：仅开启、非分心、可见、不减弱动画、非演习时允许', () => {
  for (let bits = 0; bits < 32; bits++) {
    const [enabled, distract, visible, reducedMotion, practice] = [0, 1, 2, 3, 4].map((i) => !!(bits & (1 << i)))
    assert.equal(salvoAllowed({ enabled, distract, visible, reducedMotion, practice }), bits === 5)
  }
})

class Target {
  listeners = new Map()
  addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set) }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) }
  fire(type, detail = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ target: this, ...detail }) }
  count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0) }
}
// 与 launch-glow 的迷你 DOM 同口径。Animation.currentTime 是夹具的可寻址时间轴，
// 只推进真实模块绑定的 animationend，不起 Electron 窗口、不等待真实时钟。
class Animation {
  constructor(element) { this.element = element; this.time = 0 }
  set currentTime(value) {
    this.time = value
    const [name, duration] = this.element.style.animation.split(' ')
    if (value >= parseFloat(duration)) this.element.fire('animationend', { animationName: name })
  }
  get currentTime() { return this.time }
}
class Element extends Target {
  children = []; dataset = {}; style = { setProperty(k, v) { this[k] = v } }; id = ''; className = ''
  classes = new Set()
  classList = { contains: (name) => this.classes.has(name) }
  appendChild(el) { el.parent = this; this.children.push(el); return el }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((el) => el !== this); this.parent = null }
  getAnimations() { return this.style.animation ? [this.animation ??= new Animation(this)] : [] }
  getBoundingClientRect() { return { left: 70, top: 45, width: 1200, height: 720, bottom: 765 } }
}
const find = (root, id) => root.id === id ? root : root.children.map((el) => find(el, id)).find(Boolean)
const install = ({ distract = false, reduce = false, visible = true, practice = false, fail = [], deferred = false } = {}) => {
  const body = new Element(), app = new Element(), game = new Element(), media = new Target()
  app.id = 'app'; game.id = 'game-wrapper'
  if (distract) app.classes.add('distract')
  body.appendChild(app); app.appendChild(game)
  media.matches = reduce
  const win = new Target(), doc = new Target()
  Object.assign(doc, { body, visibilityState: visible ? 'visible' : 'hidden',
    querySelector: (s) => find(body, s.slice(1)), createElement: () => new Element() })
  win.matchMedia = () => media
  globalThis.window = win; globalThis.document = doc
  const requested = [], pending = []
  globalThis.Image = class extends Element {
    naturalHeight = 200; naturalWidth = 180
    set src(value) { this.url = value; requested.push(value); const settle = (failed = fail.includes(Number(value))) => failed ? this.onerror?.() : this.onload?.(); if (deferred) pending.push(settle); else queueMicrotask(settle) }
    cloneNode() { const img = new Element(); img.src = this.url; return img }
  }
  let mirrors = [], active = true, guns = [10, 20], flagship = 100, shown = true
  const writes = [], sortieListeners = new Set()
  const data = {
    active: () => active, practice: () => practice, flagshipId: () => flagship, guns: () => guns,
    imageUrl: (id) => `${id}`, mirrors: () => mirrors,
    writeMirrors: (ids) => { mirrors = ids; writes.push([FAIRY_MIRROR_UI_KEY, ids]) },
    windowVisible: () => shown,
    onSortieChange: (cb) => { sortieListeners.add(cb); return () => sortieListeners.delete(cb) },
  }
  return { body, game, app, media, doc, win, data, requested, pending, writes,
    layer: () => find(body, 'fx-fairy'), buttons: () => find(body, 'fx-fairy-mirrors'),
    count: () => win.count() + doc.count() + media.count() + sortieListeners.size,
    active: (v) => { active = v; for (const fn of sortieListeners) fn() },
    guns: (v) => { guns = v }, flagship: (v) => { flagship = v }, shown: (v) => { shown = v },
    mirrors: (v) => { mirrors = v },
    fire: async (mstId = 100) => { win.fire('special-attack-fired', { detail: { mstId, voiceId: 900, pathname: '/900.mp3', ts: Date.now() } }); for (let i = 0; i < 8; i++) await Promise.resolve() },
  }
}
const actors = (dom) => dom.layer().children.filter((el) => el.className === 'fairy-actor')
const seek = (dom, ms) => { for (const el of actors(dom)) for (const animation of el.getAnimations()) animation.currentTime = ms }

test('关闭、分心、减少动态效果：零节点、零钩子、零预取', async () => {
  for (const options of [{ on: false }, { distract: true }, { reduce: true }]) {
    const dom = install(options)
    assert.equal(armFairySalvo(options.on ?? true, dom.data), null)
    await dom.fire(); dom.active(false); dom.active(true)
    assert.equal(dom.body.children.length, 1); assert.equal(dom.count(), 0); assert.deepEqual(dom.requested, [])
  }
})

test('动画在游戏矩形底部居中，只有 body 新根层；烟尘散尽后站 2200ms，4800ms 整层撤除', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    const layer = dom.layer()
    assert.equal(layer.parent, dom.body); assert.equal(dom.game.children.length, 0)
    assert.equal(layer.style.left, '70px'); assert.equal(layer.style.height, '720px')
    assert.equal(layer.style.pointerEvents, 'none'); assert.equal(layer.style.zIndex, '10000')
    const pair = actors(dom)
    assert.equal(pair.length, 2); assert.equal(pair[0].style.height, '288px')
    const center = pair.map((el) => parseFloat(el.style.left) + parseFloat(el.style.width) / 2)
    assert.equal((center[0] + center[1]) / 2, 600)
    assert.equal(pair[0].style.animation, 'fairy-rise 4800ms both')
    for (const time of [400, 900, 1040, 1070, 2000, 2200, 4399, 4400, 4799]) { seek(dom, time); assert.ok(dom.layer()) }
    seek(dom, 4800)
    assert.equal(dom.layer(), undefined); assert.equal(dom.buttons().children.length, 2)
    t.mock.timers.tick(4000); assert.equal(dom.buttons(), undefined)
  } finally { cancel(); t.mock.timers.reset() }
})

test('丢失 animationend 时首播看门狗在总长加 200ms，即 5000ms 收层', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try { await dom.fire(); t.mock.timers.tick(4999); assert.ok(dom.layer()); t.mock.timers.tick(1); assert.equal(dom.layer(), undefined) }
  finally { cancel(); t.mock.timers.reset() }
})

test('镜像钮写入 ui 键、排序去重，只原地重放该炮一次', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    dom.mirrors([30, 30, 20]); await dom.fire()
    const left = actors(dom)[0].style.left
    seek(dom, 4800); dom.buttons().children[0].fire('click')
    assert.deepEqual(dom.writes, [[FAIRY_MIRROR_UI_KEY, [10, 20, 30]]])
    assert.equal(actors(dom).length, 1); assert.equal(actors(dom)[0].style.left, left)
    assert.equal(actors(dom)[0].children[0].style.transform, 'scaleX(-1)')
    assert.equal(actors(dom)[0].style.animation, 'fairy-replay 3900ms both')
    assert.match(actors(dom)[0].children[1].style.animation, /140ms 0ms/)
    for (const time of [140, 170, 1100, 1300, 3499, 3500, 3899]) { seek(dom, time); assert.ok(dom.layer()) }
    seek(dom, 3900); assert.equal(dom.layer(), undefined); assert.equal(dom.buttons().children.length, 1)
    dom.buttons().children[0].fire('click')
    assert.equal(actors(dom)[0].dataset.equip, '20')
    seek(dom, 3900); assert.equal(dom.layer(), undefined); assert.equal(dom.buttons(), undefined)
  } finally { cancel(); t.mock.timers.reset() }
})

test('镜像重放丢失 animationend 时看门狗在 4100ms 收层，剩余按钮仍按原四秒撤除', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire(); seek(dom, 4800)
    dom.buttons().children[0].fire('click')
    t.mock.timers.tick(3999); assert.ok(dom.layer())
    assert.equal(dom.buttons().children.length, 1)
    t.mock.timers.tick(1); assert.equal(dom.buttons(), undefined)
    assert.ok(dom.layer())
    t.mock.timers.tick(99); assert.ok(dom.layer())
    t.mock.timers.tick(1); assert.equal(dom.layer(), undefined)
  } finally { cancel(); t.mock.timers.reset() }
})

test('出击转 active 时各图只预热一次；失败跳过且不重试', async () => {
  const dom = install({ fail: [20] }); dom.active(false)
  const cancel = armFairySalvo(true, dom.data)
  try {
    dom.active(true); assert.deepEqual(dom.requested, ['10', '20'])
    dom.active(true); dom.active(false); dom.active(true)
    await dom.fire(); assert.equal(actors(dom).length, 1)
    await dom.fire(); assert.deepEqual(dom.requested, ['10', '20'])
  } finally { cancel() }
})

test('旗舰不符、演习、隐藏文档或老板键隐藏窗口均不画', async () => {
  for (const options of [{ practice: true }, { visible: false }, { mismatch: true }, { boss: true }]) {
    const dom = install(options), cancel = armFairySalvo(true, dom.data)
    try {
      if (options.boss) dom.shown(false)
      await dom.fire(options.mismatch ? 101 : 100)
      assert.equal(dom.layer(), undefined); assert.deepEqual(dom.requested, [])
    } finally { cancel() }
  }
})

test('关闭与进入分心立即撤层并卸载钩子；异步图到达也不能复活', async () => {
  const dom = install({ deferred: true })
  initFairySalvo(dom.data, true)
  await dom.fire()
  dom.app.classes.add('distract'); refreshFairySalvo()
  assert.equal(dom.count(), 0)
  for (const settle of dom.pending) settle()
  await dom.fire(); assert.equal(dom.layer(), undefined)
  dom.app.classes.delete('distract'); refreshFairySalvo()
  assert.ok(dom.count() > 0)
  setFairySalvoEnabled(false); assert.equal(dom.count(), 0)
})

test('四只按原高摆放，超宽才等比缩小；不跟随窗口 resize，重放保持原尺寸', async () => {
  const dom = install(); dom.guns([10, 20, 30, 40])
  const cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire(); assert.equal(actors(dom)[0].style.height, '288px')
    dom.game.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 720, bottom: 720 })
    dom.win.fire('resize'); assert.equal(dom.layer().style.width, '1200px')
    await dom.fire(); const row = actors(dom)
    assert.ok(parseFloat(row[0].style.height) < 288)
    assert.ok(parseFloat(row.at(-1).style.left) + parseFloat(row.at(-1).style.width) <= 600.001)
    const height = row[0].style.height, left = row[0].style.left
    seek(dom, 4800); dom.buttons().children[0].fire('click')
    assert.equal(actors(dom)[0].style.height, height); assert.equal(actors(dom)[0].style.left, left)
  } finally { cancel() }
})

test('所有关键帧仅含 transform/opacity；升起400ms、站定500ms，烟尘散尽再站2200ms、沉回400ms', async () => {
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    const css = dom.layer().children[0].textContent
    for (const [, prop] of css.matchAll(/([\w-]+)\s*:/g)) assert.ok(['transform', 'opacity'].includes(prop), prop)
    // 从真实 CSS 百分比反算毫秒，确认拉长尾段没有拖慢升起、开火或下沉。
    // 本轮按新节奏检查：回弹比例保留，首播与原地重放的尾段相同。
    const rise = css.slice(css.indexOf('@keyframes fairy-rise'), css.indexOf('@keyframes fairy-replay'))
    const replay = css.slice(css.indexOf('@keyframes fairy-replay'), css.indexOf('@keyframes fairy-flash'))
    const frameTimes = (section, duration) => [...section.matchAll(/([\d.]+)%\s*\{/g)].map(([, p]) => Number(p) * duration / 100)
    const near = (actual, expected) => { assert.equal(actual.length, expected.length); actual.forEach((ms, i) => assert.ok(Math.abs(ms - expected[i]) < .01, `${ms} ≈ ${expected[i]}`)) }
    near(frameTimes(rise, 4800), [0, 67.2, 336, 400, 4400, 4800])
    near(frameTimes(replay, 3900), [3500, 3900])
    const children = actors(dom)[0].children
    const [name, duration, delay] = children.at(-1).style.animation.split(' ')
    assert.equal(name, 'fairy-smoke')
    const smokeEnd = parseFloat(delay) + parseFloat(duration)
    const sinkAt = frameTimes(rise, 4800).at(-2)
    assert.ok(Math.abs(sinkAt - smokeEnd - 2200) < .01)
    assert.ok(Math.abs(4800 - sinkAt - 400) < .01)
  } finally { cancel() }
})

const effects = (actor, name) => actor.children.filter((el) => el.style.animation?.startsWith(`${name} `))

test('每只妖精六团烟尘，漂移随序号递增至横向1.3倍宽、纵向负0.55倍高', async () => {
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    for (const actor of actors(dom)) {
      const smoke = effects(actor, 'fairy-smoke')
      assert.equal(smoke.length, 6)
      for (const [i, puff] of smoke.entries()) {
        assert.ok(Math.abs(parseFloat(puff.style['--dx']) / parseFloat(actor.style.width) - (.45 + i * .17)) < 1e-9)
        assert.ok(Math.abs(parseFloat(puff.style['--dy']) / parseFloat(actor.style.height) + (.2 + i * .07)) < 1e-9)
      }
    }
  } finally { cancel() }
})

test('烟尘直径为妖精宽42%，暖灰白渐变、峰值透明度.95、膨胀至3倍且无滤镜', async () => {
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    for (const actor of actors(dom)) for (const puff of effects(actor, 'fairy-smoke')) {
      assert.equal(puff.style.width, '42%')
      assert.equal(parseFloat(puff.style.height), parseFloat(actor.style.width) * .42)
      assert.equal(puff.style.background, 'radial-gradient(circle,rgba(255,250,235,.95) 0%,rgba(225,218,200,.75) 45%,transparent 75%)')
      assert.equal(puff.style.filter, undefined)
    }
    const css = dom.layer().children[0].textContent
    assert.match(css, /12%\s*\{ opacity:\.95 \}/)
    assert.match(css, /scale\(3\.0\);opacity:0/)
  } finally { cancel() }
})

test('烟尘每团1100ms、错峰40ms，首播900ms起、重放立即起', async () => {
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    for (const delay of [900, 0]) {
      for (const actor of actors(dom)) for (const [i, puff] of effects(actor, 'fairy-smoke').entries()) {
        assert.equal(puff.style.animation, `fairy-smoke 1100ms ${delay + i * 40}ms both`)
      }
      if (delay) { seek(dom, 4800); dom.buttons().children[0].fire('click') }
    }
  } finally { cancel() }
})

test('闪光140ms、尺寸26%，第二枚淡外晕38%且同关键帧延迟30ms', async () => {
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    for (const delay of [900, 0]) {
      const flashes = effects(actors(dom)[0], 'fairy-flash')
      assert.equal(flashes.length, 2)
      assert.deepEqual(flashes.map((el) => [el.style.width, el.style.height, el.style.animation]),
        [['26%', '26%', `fairy-flash 140ms ${delay}ms both`], ['38%', '38%', `fairy-flash 140ms ${delay + 30}ms both`]])
      assert.equal(flashes[1].style.background, 'radial-gradient(circle,rgba(255,255,255,.35) 0%,rgba(255,244,176,.18) 35%,transparent 70%)')
      if (delay) { seek(dom, 4800); dom.buttons().children[0].fire('click') }
    }
  } finally { cancel() }
})

test('本体开火时后坐120ms、30ms到负3%后回正，镜像与升沉不被覆盖', async () => {
  const dom = install(), cancel = armFairySalvo(true, dom.data)
  try {
    await dom.fire()
    const css = dom.layer().children[0].textContent
    assert.match(css, /@keyframes fairy-recoil \{ 0%,100% \{ transform:translateX\(0\) scaleX\(var\(--fairy-facing\)\) \}\s*25% \{ transform:translateX\(-3%\) scaleX\(var\(--fairy-facing\)\) \}/)
    for (const delay of [900, 0]) {
      const actor = actors(dom)[0], art = actor.children[0]
      assert.equal(art.style.animation, `fairy-recoil 120ms ${delay}ms both`)
      assert.equal(art.style['--fairy-facing'], delay ? '1' : '-1')
      assert.equal(actor.style.animation, delay ? 'fairy-rise 4800ms both' : 'fairy-replay 3900ms both')
      art.fire('animationend', { animationName: 'fairy-recoil' })
      actor.fire('animationend', { target: art, animationName: 'fairy-recoil' })
      assert.ok(dom.layer(), '后坐结束不提前收层')
      if (delay) { seek(dom, 4800); dom.buttons().children[0].fire('click') }
    }
  } finally { cancel() }
})

const voiceSource = fs.readFileSync(new URL('../src/renderer/voice-subtitle.ts', import.meta.url), 'utf8')
const voiceBody = voiceSource.slice(voiceSource.indexOf('const specialAttackShownAt ='), voiceSource.indexOf('/**\n * **仅调试**'))
const initBody = voiceSource.slice(voiceSource.indexOf('export const initVoiceSubtitles =')).replace('export const', 'const')
const voiceCode = transformSync(`${voiceBody}\n${initBody}\nreturn { consume, initVoiceSubtitles }`, { loader: 'ts', target: 'es2022' }).code
const voice = ({ enabled = true, practice = false, captionGate = true, noText = false } = {}) => {
  const emitted = [], captions = [], callbacks = {}
  let now = 10000
  const context = {
    mg: { sortie: { active: true, practice } }, Date: { now: () => now },
    window: { dispatchEvent: (e) => emitted.push(e), addEventListener: () => {} }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    CAPTION_HOVER_EVENT: dodge.CAPTION_HOVER_EVENT,
    captionsEnabled: enabled, captionShownAt: new Map(), shouldRenderCaption: () => captionGate,
    isSpecialAttackVoiceSlot: voiceSlots.isSpecialAttackVoiceSlot,
    document: { querySelector: () => null, fonts: { load: async () => [] } },
    resolveVoiceRequest: (pathname) => ({ kind: pathname.includes('enemy') ? 'enemy' : 'ship', mstId: 100, voiceId: Number(pathname.split('/').at(-1).replace('.mp3', '')) }),
    ipcRenderer: { invoke: async () => {} }, captionsFor: () => noText ? [] : [{ text: '台词' }],
    displayAtPlaybackTime: (...args) => captions.push(args), ready: true, ensureData: async () => {},
    onMgChange: () => {}, flushPending: () => {},
  }
  const api = new Function(...Object.keys(context), voiceCode)(...Object.values(context))
  api.initVoiceSubtitles({ addListener: (type, fn) => { callbacks[type] = fn } })
  return { emitted, captions, next: (ms) => { now += ms },
    fire: (pathname = '/900.mp3') => callbacks['kancolle.voice']({ pathname, ts: now }) }
}

test('真实语音消费入口：字幕关闭、没有文本都照发特殊攻击事件', () => {
  for (const opts of [{ enabled: false }, { noText: true }]) {
    const v = voice(opts); v.fire()
    assert.deepEqual(v.emitted.map((e) => [e.type, e.detail]), [['special-attack-fired', { mstId: 100, voiceId: 900, pathname: '/900.mp3', ts: 10000 }]])
    assert.equal(v.captions.length, 0)
  }
})

test('特殊族字幕豁免普通节流，同路径三秒去重，紧接的另舰路径立即显示', () => {
  const v = voice({ captionGate: false })
  v.fire('/lead/900.mp3')
  v.next(300)
  v.fire('/wing/901.mp3')
  assert.equal(v.captions.length, 2)
  v.fire('/lead/900.mp3')
  v.next(2699)
  v.fire('/lead/900.mp3')
  assert.equal(v.captions.length, 2)
  v.next(1)
  v.fire('/lead/900.mp3')
  assert.equal(v.captions.length, 3)
  for (const slot of [902, 903, 990, 991, 992, 993]) v.fire(`/wing/${slot}.mp3`)
  assert.equal(v.captions.length, 9)
  v.fire('/899.mp3')
  v.fire('/enemy/900.mp3')
  assert.equal(v.captions.length, 9)
})

test('演习不发；仅900–903/990–993；同路径三秒去重、不同路径独立', () => {
  const practice = voice({ practice: true }); practice.fire(); assert.equal(practice.emitted.length, 0)
  const v = voice(); v.fire(); v.next(2999); v.fire(); assert.equal(v.emitted.length, 1)
  v.fire('/901.mp3'); assert.equal(v.emitted.length, 2)
  v.next(1); v.fire(); assert.equal(v.emitted.length, 3)
  for (const id of [899, 904, 989, 994]) v.fire(`/${id}.mp3`)
  v.fire('/enemy/902.mp3'); assert.equal(v.emitted.length, 3)
  for (const id of [902, 903, 990, 991, 992, 993]) v.fire(`/${id}.mp3`)
  assert.equal(v.emitted.length, 9)
})

test('钥的实验性卡默认关、即时切换；列装备名并逐项移除镜像', () => {
  const yu = mountYu({ ui: { 'yu.section': 'experimental', [FAIRY_MIRROR_UI_KEY]: [10, 20] } })
  const html = cardHtml(yu.pane.innerHTML, 'fairy-salvo')
  assert.match(html, /特殊攻击时召唤主炮妖精开火（彩蛋）/)
  assert.match(html, /class="ysw" data-toggle="kuma.fx.fairySalvo"/)
  assert.match(html, /试用主炮/)
  yu.click({ toggle: 'kuma.fx.fairySalvo' }); assert.equal(yu.configOf('kuma.fx.fairySalvo'), true)
  assert.deepEqual(yu.fairySalvo(), [true])
  yu.click({ 'fairy-unmirror': '10' })
  assert.deepEqual(yu.writes().at(-1), [FAIRY_MIRROR_UI_KEY, [20]])
})

test('镇壳真实接线：按出击队取旗舰、实例解成装备主数据编号，联合取第一队', () => {
  const source = fs.readFileSync(new URL('../src/renderer/index.ts', import.meta.url), 'utf8')
  const section = source.slice(source.indexOf('const salvoFlagship ='), source.indexOf('initVoiceSubtitles(broadcaster)'))
  const compiled = transformSync(section, { loader: 'ts' }).code
  let data
  const mg = { combinedFlag: 0, sortie: { deckId: 3, active: true },
    decks: [{ id: 1, ships: [11] }, { id: 2, ships: [22] }, { id: 3, ships: [33, 11] }],
    ships: { 11: { shipId: 100, slot: [90] }, 22: { shipId: 200, slot: [] }, 33: { shipId: 300, slot: [92, 91, 92] } },
    slotitems: { 90: { mstId: 10 }, 91: { mstId: 11 }, 92: { mstId: 12 } },
    master: { slotitems: { 10: { type2: 3 }, 11: { type2: 4 }, 12: { type2: 1 } } } }
  const bindings = { mg, initFairySalvo: (value) => { data = value }, salvoGunsOf,
    config: { get: (_key, fallback) => fallback }, ...shared }
  new Function(...Object.keys(bindings), compiled)(...Object.values(bindings))
  assert.equal(data.flagshipId(), 300); assert.deepEqual(data.guns(), [12])
  mg.combinedFlag = 1; mg.sortie.deckId = 1
  assert.equal(data.flagshipId(), 100); assert.deepEqual(data.guns(), [10])
  mg.sortie.deckId = 3
  assert.equal(data.flagshipId(), 300, '母港联合编成标记不能覆盖第三队单独出击')
})
