import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

import scenes from '../dist/shared/launch-welcome-scene.js'
import timing from '../dist/shared/launch-glow.js'
import campaigns from '../dist/shared/seasonal-campaign.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const require = createRequire(import.meta.url)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-welcome-season-'))
const compile = (name, entry) => {
  const outfile = path.join(dir, `${name}.cjs`)
  buildSync({ entryPoints: [path.join(root, entry)], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  return require(outfile)
}
let armLaunchWelcome, createWelcomeSceneMemory, WELCOME_EVENT_TONES, store
try {
  const welcomeOut = path.join(dir, 'welcome.cjs')
  buildSync({ stdin: { contents: "export { armLaunchWelcome } from './launch-glow'; export { WELCOME_EVENT_TONES } from './launch-welcome-scene'",
    loader: 'ts', resolveDir: path.join(root, 'src/renderer') }, outfile: welcomeOut,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  ;({ armLaunchWelcome, WELCOME_EVENT_TONES } = require(welcomeOut))
  ;({ createWelcomeSceneMemory } = compile('memory', 'src/renderer/launch-welcome-memory.ts'))
  // 跑真实 mapinfo 归一化，隔离持久化与外部记录，不打开任何玩家数据。
  const source = read('src/main/mg/store.ts')
    .replace("import ledger from './ledger'", 'const ledger = {}')
    .replace("import { getLode } from '../lode'", 'const getLode = () => null')
    .replace("import { recordAbyssVoiceSightings } from '../abyss-voice-sightings'", 'const recordAbyssVoiceSightings = () => {}')
  const outfile = path.join(dir, 'store.cjs')
  buildSync({ stdin: { contents: source, loader: 'ts', resolveDir: path.join(root, 'src/main/mg') }, outfile,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  store = require(outfile)
} finally { fs.rmSync(dir, { recursive: true, force: true }) }

const { selectWelcomeScene, welcomeEventLamps, readWelcomeScene, rememberWelcomeScene, WELCOME_SCENE_CONFIG_KEY } = scenes
const { LAUNCH_WELCOME_TIMING, LAUNCH_GUARD_TIMING, LAUNCH_SEASON_TIMING } = timing
const now = Date.parse('2026-10-15T12:00:00+09:00')
const input = (keys = [], date = now) => ({
  master: { api_mst_maparea: [{ api_id: 1, api_type: 0 }], api_mst_mapinfo: [],
    api_mst_useitem: campaigns.SEASONAL_ITEMS.map((item, i) => ({ api_id: 100 + i, api_name: item.jpName })) },
  useitems: Object.fromEntries(campaigns.SEASONAL_ITEMS.map((item, i) => [100 + i, keys.includes(item.key) ? 1 : 0])),
  quests: [], mapGauges: {}, lifecycle: null, now: date,
})
const maps = Array.from({ length: 5 }, (_, i) => ({ api_id: 631 + i, api_maparea_id: 63, api_no: i + 1 }))
const lifecycle = { events: [{ mapAreaId: 63, phases: [
  { openedAt: '2026-10-01T00:00:00+09:00', maps: [1, 2, 3] },
  { openedAt: '2026-10-10T00:00:00+09:00', maps: [4, 5] },
] }] }
const rawGauges = (cleared, count = 5) => {
  store.handle('/kcsapi/api_get_member/mapinfo', { api_map_info: maps.slice(0, count).map((map, i) => ({
    api_id: map.api_id, api_cleared: i < cleared ? 1 : 0,
    api_eventmap: { api_selected_rank: i <= cleared ? 4 : 0, api_now_maphp: i < cleared ? 0 : 300, api_max_maphp: 600 },
  })) }, {}, now)
  return structuredClone(store.getState().mapGauges)
}
const eventScene = (cleared = 0) => welcomeEventLamps(maps, rawGauges(cleared), lifecycle, now)
const states = (scene) => scene.lamps.map((lamp) => lamp.state)
const memoryConfig = () => {
  const values = new Map(), writes = []
  return { values, writes, get: (key, fallback) => values.get(key) ?? fallback,
    set: (key, value) => { values.set(key, structuredClone(value)); writes.push([key, structuredClone(value)]) } }
}

test('活动选幕复用主数据标记，压过全部季节与日历；只有活动区没有活动图时不算活动', () => {
  const source = input(['pumpkin', 'kazari'], Date.parse('2026-12-24T00:00:00+09:00'))
  source.master.api_mst_maparea.push({ api_id: 63, api_type: 1 })
  source.master.api_mst_mapinfo = maps
  source.lifecycle = lifecycle
  assert.equal(selectWelcomeScene(source).key, 'event')
  source.master.api_mst_mapinfo = []
  assert.deepEqual(selectWelcomeScene(source), { key: 'halloween' })
  source.master.api_mst_mapinfo = maps
  source.master.api_mst_maparea[1].api_type = 0
  assert.deepEqual(selectWelcomeScene(source), { key: 'halloween' })
})

const priority = [['halloween', ['pumpkin']], ['newyear', ['kazari']], ['setsubun', ['setsubun']],
  ['valentine', ['choco']], ['spring', ['hishimochi', 'ribbon', 'tasuki']],
  ['tsuyu', ['umeboshi', 'rice', 'nori', 'tea', 'teruteru']], ['sanma', ['sanma', 'iwashi']]]
for (let i = 0; i < priority.length; i++) for (const key of priority[i][1]) {
  test(`道具 ${key} 选 ${priority[i][0]}，压过后续长线企划`, () => {
    assert.deepEqual(selectWelcomeScene(input([key, ...priority.slice(i + 1).flatMap((p) => p[1])])), { key: priority[i][0] })
  })
}
test('直接使用 detectSeasonalCampaigns 的现役任务信号：道具为零仍选幕，只有主数据名称不选', () => {
  const source = input()
  assert.deepEqual(selectWelcomeScene(source), { key: 'base' })
  source.quests = [{ no: 900, title: '南瓜を集めよう', detail: '' }]
  assert.deepEqual(selectWelcomeScene(source), { key: 'halloween' })
})
for (const offset of ['+08:00', '+09:00']) {
  const hour = offset === '+08:00' ? '23' : '00'
  const dates = offset === '+08:00' ? [
    ['2026-06-30T22:59:59.999', 'base'], ['2026-06-30T23:00:00.000', 'summer'],
    ['2026-08-31T22:59:59.999', 'summer'], ['2026-08-31T23:00:00.000', 'base'],
    ['2026-11-30T22:59:59.999', 'base'], ['2026-11-30T23:00:00.000', 'xmas'],
    ['2026-12-25T22:59:59.999', 'xmas'], ['2026-12-25T23:00:00.000', 'base'],
  ] : [
    ['2026-06-30T23:59:59.999', 'base'], ['2026-07-01T00:00:00.000', 'summer'],
    ['2026-08-31T23:59:59.999', 'summer'], ['2026-09-01T00:00:00.000', 'base'],
    ['2026-11-30T23:59:59.999', 'base'], ['2026-12-01T00:00:00.000', 'xmas'],
    ['2026-12-25T23:59:59.999', 'xmas'], ['2026-12-26T00:00:00.000', 'base'],
  ]
  test(`日历兜底的 JST 日界（输入时区 ${offset}，边界 ${hour} 点）`, () => {
    for (const [date, key] of dates) assert.deepEqual(selectWelcomeScene(input([], Date.parse(date + offset))), { key }, date)
  })
}
test('缓存先读上次幕与灯态；重算写配置供下次启动，基础版同样覆盖陈旧结果', () => {
  const config = memoryConfig()
  assert.deepEqual(readWelcomeScene(config, now), { key: 'base' })
  const event = eventScene(2)
  config.set(WELCOME_SCENE_CONFIG_KEY, event)
  assert.deepEqual(readWelcomeScene(config, now), event)
  const frozen = readWelcomeScene(config, now)
  assert.deepEqual(rememberWelcomeScene(config, input(['pumpkin'])), { key: 'halloween' })
  assert.equal(frozen.key, 'event')
  assert.deepEqual(states(frozen), ['done', 'done', 'current', 'empty', 'empty'])
  assert.deepEqual(rememberWelcomeScene(config, input()), { key: 'base' })
  assert.deepEqual(readWelcomeScene(config, Date.parse('2026-07-15T00:00:00+09:00')), { key: 'base' })
})
test('无缓存时按当前 JST 日历兜底', () => {
  assert.deepEqual(readWelcomeScene(memoryConfig(), Date.parse('2026-12-01T00:00:00+09:00')), { key: 'xmas' })
})
test('同一输入连续重算只写一次：基础版、季节幕与作战灯均按值去重', () => {
  const event = input()
  event.master.api_mst_maparea.push({ api_id: 63, api_type: 1 })
  event.master.api_mst_mapinfo = maps
  event.lifecycle = lifecycle
  event.mapGauges = rawGauges(2)
  for (const source of [input(), input(['pumpkin']), event]) {
    const config = memoryConfig()
    const selected = rememberWelcomeScene(config, source)
    for (let i = 0; i < 3; i++) assert.deepEqual(rememberWelcomeScene(config, structuredClone(source)), selected)
    assert.equal(config.writes.length, 1)
  }
})
test('已存作战灯即使对象键顺序不同，值相同也不写配置', () => {
  const source = input()
  source.master.api_mst_maparea.push({ api_id: 63, api_type: 1 })
  source.master.api_mst_mapinfo = maps
  source.lifecycle = lifecycle
  source.mapGauges = rawGauges(2)
  const config = memoryConfig(), selected = selectWelcomeScene(source)
  config.values.set(WELCOME_SCENE_CONFIG_KEY, {
    complete: selected.complete,
    lamps: selected.lamps.map((lamp) => ({ breakBefore: lamp.breakBefore, state: lamp.state, mapId: lamp.mapId })),
    mapAreaId: selected.mapAreaId, key: selected.key,
  })
  assert.deepEqual(rememberWelcomeScene(config, source), selected)
  assert.equal(config.writes.length, 0)
})
test('通关改变灯态会写配置；只变血量不写，全部通关与分段变化也会写', () => {
  const source = input()
  source.master.api_mst_maparea.push({ api_id: 63, api_type: 1 })
  source.master.api_mst_mapinfo = maps
  source.lifecycle = lifecycle
  source.mapGauges = rawGauges(0)
  const config = memoryConfig()
  rememberWelcomeScene(config, source)
  assert.equal(config.writes.length, 1)
  source.mapGauges[631].hpNow = 200
  rememberWelcomeScene(config, source)
  assert.equal(config.writes.length, 1)
  source.mapGauges = rawGauges(1)
  assert.deepEqual(states(rememberWelcomeScene(config, source)), ['done', 'current', 'empty', 'empty', 'empty'])
  assert.equal(config.writes.length, 2)
  rememberWelcomeScene(config, structuredClone(source))
  assert.equal(config.writes.length, 2)
  source.mapGauges = rawGauges(5)
  assert.equal(rememberWelcomeScene(config, source).complete, true)
  assert.equal(config.writes.length, 3)
  source.lifecycle = null
  assert.ok(rememberWelcomeScene(config, source).lamps.every((lamp) => !lamp.breakBefore))
  assert.equal(config.writes.length, 4)
  rememberWelcomeScene(config, source)
  assert.equal(config.writes.length, 4)
})

for (const [cleared, expected] of [[0, ['current', 'empty', 'empty', 'empty', 'empty']],
  [2, ['done', 'done', 'current', 'empty', 'empty']], [5, ['done', 'done', 'done', 'done', 'done']]]) {
  test(`真实 mapinfo 归一化后的作战灯：通关 ${cleared} 张`, () => {
    const event = eventScene(cleared)
    assert.deepEqual(states(event), expected)
    assert.deepEqual(event.lamps.map((lamp) => lamp.breakBefore), [false, false, false, true, false])
    assert.equal(event.complete, cleared === 5)
  })
}
test('后段未开放：保留登记的后段空圈，前段全通不庆祝，未到开放日期不呼吸', () => {
  const before = Date.parse('2026-10-09T23:59:59+09:00')
  for (const available of [maps, maps.slice(0, 3)]) {
    const event = welcomeEventLamps(available, rawGauges(3, 3), lifecycle, before)
    assert.deepEqual(states(event), ['done', 'done', 'done', 'empty', 'empty'])
    assert.equal(event.complete, false)
  }
  assert.deepEqual(states(welcomeEventLamps(maps, rawGauges(3), lifecycle, now)), ['done', 'done', 'done', 'current', 'empty'])
})
test('找不到 event-lifecycle phases：按主数据图号顺序连续排列，不臆造断口', () => {
  for (const pack of [null, { events: [] }]) {
    const event = welcomeEventLamps([...maps].reverse(), rawGauges(1), pack, now)
    assert.deepEqual(event.lamps.map((lamp) => lamp.mapId), maps.map((map) => map.api_id))
    assert.ok(event.lamps.every((lamp) => !lamp.breakBefore))
    assert.deepEqual(states(event), ['done', 'current', 'empty', 'empty', 'empty'])
  }
})
test('基调登记表留按活动海域 id 的入口，已结束夏活没有登记', () => {
  assert.deepEqual(Object.keys(WELCOME_EVENT_TONES), [])
})

const flush = () => new Promise((resolve) => setImmediate(resolve))
test('缓存订阅：关着零监听零读取；开启回填，相关补丁重算，关闭退订', async () => {
  const config = memoryConfig(), listeners = new Set(), errors = []
  let source = input(['pumpkin']), reads = 0
  const memory = createWelcomeSceneMemory({ config,
    input: async () => { reads++; return source },
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) }, report: (e) => errors.push(e) })
  memory.setEnabled(false)
  assert.equal(reads, 0); assert.equal(listeners.size, 0)
  memory.setEnabled(true); await flush()
  assert.equal(listeners.size, 1)
  assert.equal(readWelcomeScene(config, now).key, 'halloween')
  for (const cb of listeners) cb(['materials'])
  assert.equal(reads, 1)
  source = input(['sanma'])
  for (const cb of listeners) cb(['useitems', 'quests'])
  await flush()
  assert.equal(readWelcomeScene(config, now).key, 'sanma')
  memory.setEnabled(false)
  assert.equal(listeners.size, 0)
  assert.deepEqual(errors, [])
})
test('缓存异步竞争只认最新输入；关掉后晚到的请求不落盘；缺主数据保留缓存', async () => {
  const config = memoryConfig(), pending = [], listeners = new Set()
  config.set(WELCOME_SCENE_CONFIG_KEY, { key: 'newyear' })
  const memory = createWelcomeSceneMemory({ config,
    input: () => new Promise((resolve) => pending.push(resolve)), report: (e) => { throw e },
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) } })
  memory.setEnabled(true)
  for (const cb of listeners) cb(['mapGauges'])
  pending[1](input(['pumpkin'])); await flush()
  pending[0](input(['sanma'])); await flush()
  assert.equal(readWelcomeScene(config, now).key, 'halloween')
  for (const cb of listeners) cb(['master'])
  pending[2](null); await flush()
  assert.equal(readWelcomeScene(config, now).key, 'halloween')
  for (const cb of listeners) cb(['master'])
  memory.setEnabled(false)
  pending[3](input()); await flush()
  assert.equal(readWelcomeScene(config, now).key, 'halloween')
})

class Element {
  constructor(tag, created) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.className = ''; this.attrs = {}; this.dataset = {}; this.listeners = new Map(); this.textContent = ''
    this.style = { setProperty(key, value) { this[key] = value } }
    this.created = created
  }
  get classList() {
    return { contains: (key) => `${this.attrs.class ?? this.className}`.split(/\s+/).includes(key),
      add: (...keys) => {
        if (this.attrs.class != null) this.attrs.class = `${this.attrs.class} ${keys.join(' ')}`
        else this.className = `${this.className} ${keys.join(' ')}`
      },
      remove: (...keys) => { this.className = this.className.split(/\s+/).filter((key) => !keys.includes(key)).join(' ') } }
  }
  setAttribute(key, value) { this.attrs[key] = String(value) }
  getAttribute(key) { return this.attrs[key] ?? null }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child }
  insertBefore(child, before) { child.remove(); const i = this.children.indexOf(before); assert.ok(i >= 0); child.parentNode = this; this.children.splice(i, 0, child); return child }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null }
  getBoundingClientRect() {
    if (this.measuredRect) return this.measuredRect
    const width = this.measuredWidth ?? Math.min(560, 115 + String(this.children[1]?.textContent ?? '').length * 16)
    return { left: window.innerWidth / 2 - width / 2, top: (window.innerHeight - 62) / 2, width, height: 62 }
  }
  addEventListener(type, handler) { const set = this.listeners.get(type) ?? new Set(); set.add(handler); this.listeners.set(type, set) }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler) }
  fire(type, animationName, target = this) { for (const handler of this.listeners.get(type) ?? []) handler({ target, animationName }) }
  get listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0) }
}
const dom = (reduce = false, measuredWidth) => {
  const created = [], documentListeners = new Map(), windowListeners = new Map()
  let resizeAdds = 0
  const make = (tag) => { const node = new Element(tag, created); node.measuredWidth = measuredWidth; created.push(node); return node }
  const body = new Element('body', created)
  globalThis.document = { body, documentElement: { dataset: { theme: 'dark' } }, createElement: make, createElementNS: (_ns, tag) => make(tag),
    addEventListener(type, handler) { const set = documentListeners.get(type) ?? new Set(); set.add(handler); documentListeners.set(type, set) },
    removeEventListener(type, handler) { documentListeners.get(type)?.delete(handler) } }
  globalThis.window = { innerWidth: 1600, innerHeight: 900, matchMedia: () => ({ matches: reduce }),
    addEventListener(type, handler) {
      if (type === 'resize') resizeAdds++
      const set = windowListeners.get(type) ?? new Set(); set.add(handler); windowListeners.set(type, set)
    },
    removeEventListener(type, handler) { windowListeners.get(type)?.delete(handler) },
    dispatchEvent(event) { for (const handler of windowListeners.get(event.type) ?? []) handler(event) } }
  return { body, created, fire: (type) => { for (const handler of documentListeners.get(type) ?? []) handler({ type }) },
    resize(width, height) { window.innerWidth = width; window.innerHeight = height; window.dispatchEvent({ type: 'resize' }) },
    resizeAdds: () => resizeAdds,
    resizeListeners: () => windowListeners.get('resize')?.size ?? 0,
    listenerCount: () => [...documentListeners.values(), ...windowListeners.values()].reduce((n, set) => n + set.size, 0) + created.reduce((n, el) => n + el.listenerCount, 0) }
}
const nodes = (node) => [node, ...node.children.flatMap(nodes)]
const named = (tree, cls) => nodes(tree).filter((node) => node.classList.contains(cls))
const seasons = ['newyear', 'setsubun', 'valentine', 'spring', 'tsuyu', 'summer', 'sanma', 'halloween', 'xmas']
// 整棵欢迎屏（含铭牌、SVG/use；不把伪元素算作 DOM），以 560px 铭牌时的最大值为上限。
const nodeCaps = { newyear: 36, setsubun: 82, valentine: 88, spring: 189, tsuyu: 44, summer: 88,
  sanma: 182, halloween: 72, xmas: 142 }
const ready = (welcome) => { for (const signal of ['snapshot', 'lode', 'panes']) welcome.noteReady(signal, '长门') }
const cleaned = (installed) => {
  assert.equal(installed.body.children.length, 0)
  assert.equal(installed.listenerCount(), 0, '旧引用上的监听也要摘掉，不能靠移除节点蒙混过关')
}
test('欢迎屏关闭：所有幕都是零节点、零监听、零读 DOM', () => {
  const installed = dom()
  for (const key of ['base', ...seasons, 'event']) assert.equal(armLaunchWelcome(false, { key }), null)
  assert.equal(installed.resizeAdds(), 0)
  assert.equal(installed.created.length, 0); cleaned(installed)
})
test('基础版保持原有两个直系子节点；不挂场景、包裹与装饰', () => {
  const installed = dom(), welcome = armLaunchWelcome(true)
  const layer = installed.body.children[0]
  assert.equal(layer.children.length, 2)
  assert.equal(nodes(layer).length, 5)
  assert.equal(layer.children[0].className, 'kw-box')
  assert.equal(installed.resizeAdds(), 0)
  welcome.cancel(); cleaned(installed)
})
for (const key of seasons) {
  test(`${key}：整棵欢迎屏 DOM 上限、装饰不在裁切盒中、长名字不造 HTML`, () => {
    const installed = dom(), welcome = armLaunchWelcome(true, { key }), layer = installed.body.children[0]
    welcome.noteReady('snapshot', '<script>' + '提督'.repeat(40))
    assert.ok(nodes(layer).length <= nodeCaps[key], `${key}: ${nodes(layer).length} nodes`)
    assert.equal(named(layer, 'kw-box').length, 1)
    const box = named(layer, 'kw-box')[0]
    assert.equal(box.children.length, 2)
    assert.equal(box.children[1].textContent, '<script>' + '提督'.repeat(40))
    assert.equal(named(layer, 'ks-deco')[0].parentNode, box.parentNode)
    if (key === 'summer') assert.equal(named(layer, 'ks-fw-sparks').length * 2, 114)
    if (key === 'spring') assert.equal(nodes(layer).filter((node) => node.attrs.href?.endsWith('#sym-petal')).length, 37)
    if (key === 'xmas') {
      assert.equal(nodes(layer).filter((node) => node.attrs.href?.endsWith('#sym-fir')).length, 3)
      assert.equal(nodes(layer).filter((node) => node.attrs.href?.endsWith('#sym-star')).length, 1)
      assert.equal(named(layer, 'ks-snowbank').length, 1)
    }
    welcome.cancel(); cleaned(installed)
  })
  for (const route of ['skip', 'fade', 'watchdog', 'cancel']) {
    test(`${key}：${route} 收摊后无节点、无监听`, (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      try {
        const installed = dom(), welcome = armLaunchWelcome(true, { key }), layer = installed.body.children[0]
        const scene = named(layer, 'ks-scene')[0]
        assert.equal(installed.resizeListeners(), 1)
        let handed = 0; welcome.done(() => handed++)
        if (route === 'skip') installed.fire('pointerdown')
        if (route === 'cancel') { welcome.cancel(); welcome.cancel() }
        if (route === 'fade') {
          ready(welcome); t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow)
          layer.fire('animationend', 'kuma-season-fade')
          assert.equal(installed.body.children.length, 1)
          layer.fire('animationend', 'kuma-welcome-out')
        }
        if (route === 'watchdog') {
          t.mock.timers.tick(LAUNCH_WELCOME_TIMING.cap)
          t.mock.timers.tick(LAUNCH_WELCOME_TIMING.fade + LAUNCH_GUARD_TIMING.welcomeFadeSlack)
        }
        cleaned(installed)
        const oldTransform = scene?.style.transform
        installed.resize(1200, 800)
        assert.equal(scene?.style.transform, oldTransform, '收摊后旧场景不再响应视口变化')
        assert.equal(handed, route === 'cancel' ? 0 : 1)
      } finally { t.mock.timers.reset() }
    })
  }
  test(`${key}：减少动态效果只挂静止构图，完全不写动画或动画变量`, () => {
    const installed = dom(true), welcome = armLaunchWelcome(true, { key }), layer = installed.body.children[0]
    for (const node of installed.created) for (const [property, value] of Object.entries(node.style)) {
      if (/animation|motion|composition/.test(property)) assert.ok(value === '' || typeof value === 'function', `${property}: ${value}`)
    }
    if (key === 'tsuyu') assert.equal(named(layer, 'ks-rain').length, 0)
    if (key === 'halloween') assert.equal(nodes(layer).filter((node) => node.attrs.href?.endsWith('#sym-bat')).length, 0)
    welcome.cancel(); cleaned(installed)
  })
}
test('花火只在自己的上升轨迹 animationiteration 时换位置，收摊后旧节点不再响应', () => {
  const installed = dom(), welcome = armLaunchWelcome(true, { key: 'summer' }), layer = installed.body.children[0]
  const shell = named(layer, 'ks-firework')[0], trail = named(layer, 'ks-fw-trail')[0], reflection = named(layer, 'ks-fw-reflection')[0]
  const original = shell.style.left
  shell.fire('animationiteration', 'kuma-season-fw-trail-o', trail)
  assert.equal(shell.style.left, original)
  shell.fire('animationiteration', 'kuma-season-fw-trail', trail)
  assert.notEqual(shell.style.left, original)
  assert.equal((parseFloat(reflection.style.left) + 50).toFixed(1), parseFloat(shell.style.left).toFixed(1))
  welcome.cancel()
  const stopped = shell.style.left
  shell.fire('animationiteration', 'kuma-season-fw-trail', trail)
  assert.equal(shell.style.left, stopped); cleaned(installed)
})
test('海图幕按玩家状态画灯；全通连接断口、灯依次跳、描金边；静态时灯与金线直接到终态', () => {
  for (const cleared of [0, 2, 5]) for (const reduce of [false, true]) {
    const installed = dom(reduce), scene = eventScene(cleared), welcome = armLaunchWelcome(true, scene), layer = installed.body.children[0]
    assert.equal(named(layer, 'ks-lamp').length, 5)
    assert.equal(named(layer, 'ks-lamp-done').length, cleared)
    assert.equal(named(layer, 'ks-lamp-current').length, cleared === 5 ? 0 : 1)
    assert.equal(named(layer, 'ks-route').filter((node) => !node.classList.contains('ks-route-done')).length, 3)
    assert.equal(named(layer, 'ks-ring').length, cleared === 5 ? 1 : 0)
    assert.ok(nodes(layer).length <= 24)
    if (cleared === 5 && !reduce) {
      const motions = named(layer, 'ks-lamp').map((node) => node.style['--lamp-motion'])
      assert.ok(motions.every((value) => value.includes('kuma-season-lamp-wave')))
      const starts = motions.map((value) => Number(/lamp-wave \d+ms ease-out (\d+)ms/.exec(value)[1]))
      assert.deepEqual(starts.slice(1).map((value, i) => value - starts[i]), [70, 70, 70, 70])
      assert.equal(named(layer, 'ks-route-done').length, 4)
    }
    if (reduce) for (const node of installed.created) assert.equal(node.style.animation, undefined)
    welcome.cancel(); cleaned(installed)
  }
})
test('快照只更新名字与尺寸，缓存选幕重算不改变本次节点、幕 key 或动画', () => {
  const config = memoryConfig(); config.set(WELCOME_SCENE_CONFIG_KEY, { key: 'spring' })
  const installed = dom(), welcome = armLaunchWelcome(true, readWelcomeScene(config, now)), layer = installed.body.children[0]
  const before = nodes(layer), animations = before.map((node) => node.style.animation)
  rememberWelcomeScene(config, input(['pumpkin']))
  welcome.noteReady('snapshot', '长门')
  assert.equal(layer.dataset.welcomeScene, 'spring')
  assert.deepEqual(nodes(layer), before)
  assert.deepEqual(before.map((node) => node.style.animation), animations)
  welcome.cancel(); cleaned(installed)
})
test('场景整体先淡入 600ms；蝙蝠终点在屏外、鱼群从屏外进、雨圈延迟前透明、豆从屏外落', () => {
  const installed = dom(), welcome = armLaunchWelcome(true, { key: 'halloween' }), layer = installed.body.children[0]
  assert.match(named(layer, 'ks-scene')[0].style.animation, /600ms/)
  for (const node of nodes(layer).filter((node) => node.style['--x3'])) {
    const x = parseFloat(node.style['--x3']); assert.ok(x < -40 || x > 1600)
  }
  welcome.cancel()
  const html = read('src/renderer/index.html')
  assert.match(html, /@keyframes kuma-season-ripple \{ 0% \{ transform: scale\(\.06\); opacity: 0;/)
  assert.match(html, /@keyframes kuma-season-bean-drop[\s\S]*?translateY\(-470\.000px\)/)
  assert.equal(LAUNCH_SEASON_TIMING.sceneFade, 600)
})

test('新增关键帧只声明 opacity/transform；季节样式不声明毫秒常量，时长来自 shared', () => {
  const html = read('src/renderer/index.html')
  const blocks = [...html.matchAll(/@keyframes kuma-season-[\w-]+\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)]
  assert.ok(blocks.length >= 40)
  for (const block of blocks) for (const property of block[1].matchAll(/([a-z-]+)\s*:/g)) {
    assert.ok(['opacity', 'transform'].includes(property[1]), `${block[0].slice(0, 70)}: ${property[1]}`)
  }
  const section = html.slice(html.indexOf('/* 季节层只挂'), html.indexOf('body.kuma-glow #element-rail'))
  assert.doesNotMatch(section, /\b\d+(?:\.\d+)?m?s\b/)
  const source = read('src/renderer/launch-welcome-scene.ts')
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval|innerHTML|\bfilter\s*[:=]/)
  assert.doesNotMatch(source, /(?:const|let)\s+\w*(?:Ms|_MS|duration|Duration)\w*\s*=\s*\d+/)
  assert.match(source, /LAUNCH_SEASON_TIMING/)
})
test('SVG 图形路径保留定稿的 symbol，负原点 symbol 的外层从零起', () => {
  const asset = read('src/renderer/assets/launch-welcome.svg')
  for (const id of ['pumpkin', 'pk-face', 'bat', 'saury', 'saury-glint', 'petal', 'heart', 'fir', 'star', 'bow', 'teru']) {
    assert.match(asset, new RegExp(`<symbol id="sym-${id}"`))
  }
  assert.match(asset, /sym-petal" viewBox="-12 -13 24 25"/)
  assert.match(asset, /sym-heart" viewBox="-12 -11 24 22"/)
  const installed = dom(), welcome = armLaunchWelcome(true, { key: 'spring' })
  for (const svg of installed.created.filter((node) => node.tagName === 'svg')) assert.match(svg.attrs.viewBox, /^0 0 /)
  welcome.cancel(); cleaned(installed)
})
test('构建出的深浅 sprite 从现有主题表取全部 token，渐变 stop 所需颜色不缺项', () => {
  const html = read('src/renderer/index.html')
  const tokenMap = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const dark = tokenMap(html.match(/:root\s*\{([^}]+)/)[1])
  const light = { ...dark, ...tokenMap(html.match(/:root\[data-theme="light"\]\s*\{([^}]+)/)[1]) }
  for (const [theme, expected] of [['dark', dark], ['light', light]]) {
    const sprite = read(`dist/renderer/assets/launch-welcome-${theme}.svg`)
    assert.doesNotMatch(sprite, /undefined/)
    const actual = tokenMap(sprite.match(/<style>:root\{([^}]+)/)[1])
    for (const match of sprite.matchAll(/var\((--[\w-]+)\)/g)) assert.equal(actual[match[1]], expected[match[1]], `${theme} ${match[1]}`)
    const installed = dom()
    document.documentElement.dataset.theme = theme
    const welcome = armLaunchWelcome(true, { key: 'spring' })
    for (const node of installed.created.filter((node) => node.attrs.href)) assert.match(node.attrs.href, new RegExp(`welcome-${theme}\\.svg#`))
    welcome.cancel(); cleaned(installed)
  }
})
test('宽至 560px 的铭牌也满足整棵 DOM 上限；名字回填时灯线、日轮、南瓜光晕跟着尺寸走，不重播', () => {
  for (const key of seasons) {
    const installed = dom(false, 560), welcome = armLaunchWelcome(true, { key }), layer = installed.body.children[0]
    assert.ok(nodes(layer).length <= nodeCaps[key], `${key}: ${nodes(layer).length}`)
    if (key === 'xmas') assert.equal(nodes(layer).length, nodeCaps.xmas)
    welcome.cancel(); cleaned(installed)
  }
  for (const key of ['newyear', 'halloween', 'xmas']) {
    const installed = dom(), welcome = armLaunchWelcome(true, { key }), layer = installed.body.children[0]
    const oldNodes = nodes(layer), animations = oldNodes.map((node) => node.style.animation)
    const sun = named(layer, 'ks-sun')[0], glow = named(layer, 'ks-pumpkin-halo')[1], wire = named(layer, 'ks-wire')[0]
    const before = sun?.style.width ?? glow?.style.left ?? wire?.attrs.d
    welcome.noteReady('snapshot', '提督'.repeat(40))
    const after = sun?.style.width ?? glow?.style.left ?? wire?.attrs.d
    assert.notEqual(after, before)
    assert.deepEqual(nodes(layer), oldNodes)
    assert.deepEqual(oldNodes.map((node) => node.style.animation), animations)
    welcome.cancel(); cleaned(installed)
  }
})

for (const key of ['halloween', 'xmas', 'newyear']) for (const reduce of [false, true]) {
  test(`${key}：${reduce ? '静态' : '动画中'}视口缩放与窗口变形重新对齐铭牌，不换节点、不写动画`, () => {
    const installed = dom(reduce), welcome = armLaunchWelcome(true, { key }), layer = installed.body.children[0]
    const box = named(layer, 'kw-box')[0], scene = named(layer, 'ks-scene')[0], deco = named(layer, 'ks-deco')[0]
    const art = named(scene, 'ks-art')[0]
    const before = nodes(layer), createdCount = installed.created.length
    const animations = before.map((node) => Object.fromEntries(Object.entries(node.style).filter(([property]) => /animation|motion|composition/.test(property))))
    // 即使重写相同的 animation 串也算重播风险，直接拦住每次赋值。
    for (const node of before) for (const property of Object.keys(node.style).filter((name) => /animation|motion|composition/.test(name))) {
      const value = node.style[property]
      Object.defineProperty(node.style, property, { enumerable: true, get: () => value,
        set: () => assert.fail(`resize 重写了 ${property}`), configurable: true })
    }
    const close = (actual, expected) => assert.ok(Math.abs(Number.parseFloat(actual) - expected) <= .051, `${actual} != ${expected}`)
    const check = () => {
      const scale = window.innerWidth / 1600, height = window.innerHeight / scale, rect = box.getBoundingClientRect()
      const p = { x: rect.left / scale, y: rect.top / scale, w: rect.width / scale, h: rect.height / scale }
      assert.equal(scene.style.transform, `scale(${scale})`)
      assert.equal(deco.style.transform, `scale(${scale})`)
      assert.equal(scene.style.width, '1600.0px'); close(scene.style.height, height)
      close(deco.style.width, p.w); close(deco.style.height, p.h)
      assert.equal(art.parentNode, scene)
      if (key === 'halloween') {
        for (const [i, pumpkin] of named(layer, 'ks-pumpkin').entries()) {
          const w = [118, 92, 66][i], x = p.x + [-150, p.w + 34, p.w + 138][i]
          close(pumpkin.style.left, x); close(pumpkin.style.top, p.y + p.h + 38 - w * 100 / 120)
          const halo = named(layer, 'ks-pumpkin-halo')[i]
          close(halo.style.left, x - w * .9); close(halo.style.top, p.y + p.h + 38 - w * 100 / 120 * .45 - w * 1.4)
        }
      }
      if (key === 'xmas') {
        const x = p.x - 175, t = (x + 40) / 1680, ground = p.y + p.h + 200, crest = p.y + p.h + 20
        const star = named(layer, 'ks-star')[0]
        close(star.style.left, x - 13); close(star.style.top, ground - 2 * t * (1 - t) * (ground - crest) + 6 - 300 + 300 * .025 - 13)
        assert.ok(named(layer, 'ks-snowbank')[0].attrs.d.endsWith(`L1640 ${height + 40}L-40 ${height + 40}Z`))
        const groundSvg = named(layer, 'ks-snowbank')[0].parentNode
        const viewBox = groundSvg.attrs.viewBox.split(' ').map(Number)
        assert.deepEqual(viewBox.slice(0, 3), [0, 0, 1600]); close(viewBox[3], height)
        const decoration = named(layer, 'ks-wire')[0].parentNode
        const bounds = decoration.attrs.viewBox.split(' ').map(Number)
        close(bounds[2], p.w); close(bounds[3], p.h)
      }
      if (key === 'newyear') {
        const d = Math.max(240, Math.min(320, p.w * 1.15)), sun = named(layer, 'ks-sun')[0]
        close(sun.style.left, p.x + p.w / 2 - d / 2); close(sun.style.top, p.y + p.h + 70 - d * .78)
        close(sun.style.width, d); close(sun.style['--rise'], d * .95)
      }
      assert.equal(installed.created.length, createdCount)
      assert.deepEqual(nodes(layer), before)
      assert.deepEqual(before.map((node) => Object.fromEntries(Object.entries(node.style).filter(([property]) => /animation|motion|composition/.test(property)))), animations)
      assert.equal(installed.resizeAdds(), 1); assert.equal(installed.resizeListeners(), 1)
    }
    try {
      // 默认 1.15 缩放后 CSS 视口缩小，随后名字快照仍走原同步口。
      installed.resize(1600 / 1.15, 900 / 1.15); check()
      welcome.noteReady('snapshot', '长门'); check()
      // 改窗口比例，同时改变铭牌尺寸与位置，排除只改整体 scale 的假修复。
      box.measuredRect = { left: 421, top: 287, width: 380, height: 74 }
      installed.resize(1200, 780); check()
      box.measuredRect = { left: 640, top: 510, width: 440, height: 68 }
      installed.resize(1920, 1200); check()
    } finally {
      // dispose 会清包裹动画，先恢复其可写属性。
      for (const [i, node] of before.entries()) for (const [property, value] of Object.entries(animations[i])) {
        Object.defineProperty(node.style, property, { value, writable: true, enumerable: true, configurable: true })
      }
      welcome.cancel(); cleaned(installed)
    }
  })
}
test('按活动海域 id 登记基调即可叠场景，通用网格与作战灯照常存在', () => {
  try {
    WELCOME_EVENT_TONES[63] = (stage) => {
      const node = stage.html(stage.scene, 'ks-test-tone')
      stage.motion(node, ['fade', LAUNCH_SEASON_TIMING.sceneFade])
    }
    const installed = dom(), welcome = armLaunchWelcome(true, eventScene(2)), layer = installed.body.children[0]
    assert.equal(named(layer, 'ks-test-tone').length, 1)
    assert.equal(named(layer, 'ks-grid').length, 1)
    assert.equal(named(layer, 'ks-lamp').length, 5)
    welcome.cancel(); cleaned(installed)
  } finally { delete WELCOME_EVENT_TONES[63] }
})
for (const route of ['skip', 'fade', 'watchdog', 'cancel']) test(`海图幕：${route} 收摊无节点、无监听`, (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const installed = dom(), welcome = armLaunchWelcome(true, eventScene(5)), layer = installed.body.children[0]
    assert.equal(installed.resizeListeners(), 1)
    if (route === 'skip') installed.fire('pointerdown')
    if (route === 'cancel') welcome.cancel()
    if (route === 'fade') { ready(welcome); t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow); layer.fire('animationend', 'kuma-welcome-out') }
    if (route === 'watchdog') { t.mock.timers.tick(LAUNCH_WELCOME_TIMING.cap); t.mock.timers.tick(LAUNCH_WELCOME_TIMING.fade + LAUNCH_GUARD_TIMING.welcomeFadeSlack) }
    cleaned(installed)
  } finally { t.mock.timers.reset() }
})
test('缓存接线走现有配置与本地查询；开关在设置里当场退订；不添加玩家可见文案', () => {
  const source = read('src/renderer/index.ts'), settings = read('src/renderer/modules/yu.ts')
  assert.match(source, /ceremonyOn \? readWelcomeScene\(config, Date\.now\(\)\)/)
  assert.match(source, /queryMasterRaw\(\), queryLode\('event-lifecycle'\)/)
  assert.match(source, /input: async \(\) => \{\s*await snapshotReady/)
  assert.match(settings, /setWelcomeSceneMemoryEnabled\(next\)/)
  assert.equal(WELCOME_SCENE_CONFIG_KEY, 'kuma.launchWelcomeScene.v1')
})
