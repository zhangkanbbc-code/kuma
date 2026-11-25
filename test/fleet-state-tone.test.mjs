// 编队状态着色（维护者裁决 2026-11-25），钥「界面」一张卡开关，默认关。
//   · 从左侧向整条舰娘条辐射的泛光＝受损程度：小破 / 中破 / 大破；
//   · 左侧竖条＝其余状态，一次只亮最要紧的一种：入渠 > 泊地修理中 > 红疲劳 > 橙疲劳 > 未补给 > 闪光；
//   · 鼠标移到竖条上，提示列出这位舰娘当前的全部状态（受损在前，其余按上面的次序）。
// 叫法沿用仓里已有的：橙疲劳 / 红疲劳 / 未补给 / 闪光（维护者口头说的「缺补给」「战意高扬」同指这两种）。
// 判档是纯函数 src/shared/fleet-state-tone.ts；编队行在开关打开时把结果挂成
// data-damage / data-state 与一根带提示的 .state-bar，关着时一切照旧。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { renderRow, reset, setFleetTone } from './fixtures/render-ru-row.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const toneModule = () => {
  const file = path.join(ROOT, 'dist', 'shared', 'fleet-state-tone.js')
  assert.ok(fs.existsSync(file), '缺少 src/shared/fleet-state-tone.ts（构建后在 dist/shared/fleet-state-tone.js）')
  return require(file)
}
const flat = (html) => html.replace(/\s+/g, ' ')

const base = { nowhp: 40, maxhp: 40, docked: false, anchorage: false, fatigue: 'ready', sparkle: false, unsupplied: false }

// ---- 判档 ----

test('受损三档按耐久比例：75% 以下小破、50% 以下中破、25% 以下大破；满血与 75% 以上不亮', () => {
  const { fleetStateTone } = toneModule()
  const damage = (nowhp) => fleetStateTone({ ...base, nowhp, maxhp: 100 }).damage
  assert.equal(damage(100), null)
  assert.equal(damage(76), null)
  assert.equal(damage(75), 'minor')
  assert.equal(damage(51), 'minor')
  assert.equal(damage(50), 'moderate')
  assert.equal(damage(26), 'moderate')
  assert.equal(damage(25), 'heavy')
  assert.equal(damage(1), 'heavy')
})

test('竖条只亮最要紧的一种：入渠 > 泊地修理中 > 红疲劳 > 橙疲劳 > 未补给 > 闪光', () => {
  const { fleetStateTone } = toneModule()
  const state = (patch) => fleetStateTone({ ...base, ...patch }).state
  assert.equal(state({}), null)
  assert.equal(state({ sparkle: true }), 'sparkle')
  assert.equal(state({ sparkle: true, unsupplied: true }), 'unsupplied')
  assert.equal(state({ unsupplied: true, fatigue: 'orange' }), 'fatigue')
  assert.equal(state({ unsupplied: true, fatigue: 'red' }), 'redFatigue')
  assert.equal(state({ fatigue: 'red', anchorage: true }), 'anchorage')
  assert.equal(state({ anchorage: true, docked: true }), 'dock')
})

test('提示列出全部状态：受损在前，其余按竖条的次序；叫法沿用仓里已有的', () => {
  const { fleetStateTone, FLEET_TONE_LABEL } = toneModule()
  assert.deepEqual({ ...FLEET_TONE_LABEL }, {
    minor: '小破', moderate: '中破', heavy: '大破',
    dock: '入渠', anchorage: '泊地修理中', redFatigue: '红疲劳', fatigue: '橙疲劳', unsupplied: '未补给', sparkle: '闪光',
  })
  const tone = fleetStateTone({ ...base, nowhp: 18, maxhp: 40, fatigue: 'red', unsupplied: true })
  assert.deepEqual({ ...tone, labels: [...tone.labels] }, { damage: 'moderate', state: 'redFatigue', labels: ['中破', '红疲劳', '未补给'] })
  assert.deepEqual([...fleetStateTone(base).labels], [])
  assert.deepEqual([...fleetStateTone({ ...base, nowhp: 9, docked: true }).labels], ['大破', '入渠'])
})

// ---- 编队行 ----

test('开关打开：行挂 data-damage / data-state，竖条带全部状态的提示', () => {
  reset({ names: { 1: '吹雪' } })
  setFleetTone(true, { 5: { damage: 'moderate', state: 'redFatigue', labels: ['中破', '红疲劳', '未补给'] } })
  const html = flat(renderRow({ id: 5, shipId: 1, nowhp: 18 }))
  assert.match(html, /<div class="ship[^"]*"[^>]*\sdata-damage="moderate"/)
  assert.match(html, /<div class="ship[^"]*"[^>]*\sdata-state="redFatigue"/)
  assert.match(html, /<span class="state-bar" title="中破 · 红疲劳 · 未补给"/)
})

test('只有受损、没有别的状态：只挂 data-damage，竖条照样给提示', () => {
  reset({ names: { 1: '吹雪' } })
  setFleetTone(true, { 5: { damage: 'minor', state: null, labels: ['小破'] } })
  const html = flat(renderRow({ id: 5, shipId: 1, nowhp: 29 }))
  assert.match(html, /\sdata-damage="minor"/)
  assert.doesNotMatch(html, /\sdata-state=/)
  assert.match(html, /<span class="state-bar" title="小破"/)
})

test('什么状态都没有：不挂属性，不出竖条', () => {
  reset({ names: { 1: '吹雪' } })
  setFleetTone(true, { 5: { damage: null, state: null, labels: [] } })
  const html = flat(renderRow({ id: 5, shipId: 1 }))
  assert.doesNotMatch(html, /data-damage=|data-state=|state-bar/)
})

test('开关关着（默认）：一切照旧，不挂属性也不出竖条', () => {
  reset({ names: { 1: '吹雪' } })
  setFleetTone(false, { 5: { damage: 'heavy', state: 'dock', labels: ['大破', '入渠'] } })
  const html = flat(renderRow({ id: 5, shipId: 1, nowhp: 5 }))
  assert.doesNotMatch(html, /data-damage=|data-state=|state-bar/)
})

test('退避、击沉的行保持各自的样式，不叠着色', () => {
  reset({ names: { 1: '吹雪' }, sortie: { active: true, practice: false, escaped: [{ rosterId: 5, role: 'escaped' }] } })
  setFleetTone(true, { 5: { damage: 'heavy', state: null, labels: ['大破'] } })
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 5 })), /data-damage=|state-bar/)
  reset({ names: { 1: '吹雪' }, sortie: { active: true, practice: false, escaped: [] }, sunk: [5] })
  setFleetTone(true, { 5: { damage: 'heavy', state: null, labels: ['大破'] } })
  assert.doesNotMatch(flat(renderRow({ id: 5, shipId: 1, nowhp: 0 })), /data-damage=|state-bar/)
})

// ---- 钥「界面」 ----

test('钥「界面」有一张编队状态着色卡，开关默认关', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  assert.match(read('src/shared/settings-sections.ts'), /'fleet-tone'/)
  const host = runtimeHost()
  // toggleHtml 用的 esc 来自 kernel（会拉起 Electron），宿主里直接给一份同口径的转义
  const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const card = (value) => host.extract('src/renderer/modules/yu.ts', ['fleetToneCardHtml'], {
    config: { get: (key, fallback) => (key === 'kuma.fleetStateTone' ? (value ?? fallback) : fallback) },
    esc: (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]),
  }).api.fleetToneCardHtml()
  const off = flat(card(undefined))
  assert.match(off, /<b>编队状态着色<\/b>/)
  assert.match(off, /<span class="ysw" data-toggle="kuma\.fleetStateTone">/)
  assert.match(flat(card(true)), /<span class="ysw on" data-toggle="kuma\.fleetStateTone">/)
})

test('颜色是主题变量：深浅两套都有九个着色变量', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8')
  const block = (selector) => {
    const at = html.indexOf(`${selector} {`)
    return at < 0 ? '' : html.slice(at, html.indexOf('}', at))
  }
  for (const name of ['minor', 'moderate', 'heavy', 'dock', 'anchorage', 'red-fatigue', 'fatigue', 'unsupplied', 'sparkle']) {
    assert.match(block(':root'), new RegExp(`--tone-${name}:\\s*#[0-9a-fA-F]{6};`), `深色缺 --tone-${name}`)
    assert.match(block(':root[data-theme="light"]'), new RegExp(`--tone-${name}:\\s*#[0-9a-fA-F]{6};`), `浅色缺 --tone-${name}`)
  }
})
