import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  applyLogStage,
  battleOf,
  renderBrow,
  renderHpNums,
  setSelectedLogStage,
  shipOf,
} from './fixtures/render-di-battle.mjs'

const hit = (side, stage, damage, target = 0, phase = 'gun1', repairItem = null) => ({
  side, stage, action: 0, phase, hits: [{ target, damage, repairItem }],
})
const lossOf = html => /<span class="hp-loss st9(?: [^"]+)?">-(\d+)<\/span>/.exec(html)?.[1] ?? null
const numsOf = html => html.slice(html.indexOf('<span class="nums">') + '<span class="nums">'.length, html.lastIndexOf('</span></span>'))
const friendly = () => {
  const ship = { ...shipOf(0, '我方'), hpStart: 37, hpMax: 37, hpEnd: 12 }
  const battle = battleOf({
    hasNight: true,
    fShips: [ship],
    attacks: [hit(1, 0, 7, 0, 'air'), hit(1, 1, 9), hit(1, 2, 9, 0, 'night')],
  })
  return { ship, battle }
}

test.afterEach(() => setSelectedLogStage(null))

test('37→12 默认显示夜战段 -9（与虚条同宽），点住 30→21 的阶段显示 -9，血量链保留', () => {
  const { ship, battle } = friendly()
  const followed = renderBrow(battle, 0, ship)
  assert.equal(lossOf(followed), '9')
  assert.match(followed, /title="37→30→21→12">12\/37<\/span><span class="hp-loss st9">-9<\/span><span class="st9"[^>]*>中破<\/span>/)
  // 数字与虚条同一截：都是夜战段掉的 9，不是整场累计 25。
  const ghost = Number(/class="dl" style="width:([\d.]+)%"/.exec(followed)[1])
  assert.ok(Math.abs(ghost - 9 / 37 * 100) < 0.01)
  setSelectedLogStage(1)
  const pinned = renderBrow(battle, 0, ship)
  assert.equal(lossOf(pinned), '9')
  assert.match(pinned, /title="37→30→21→12">21\/37<\/span>/)
  setSelectedLogStage(null)
  assert.equal(renderBrow(battle, 0, ship), followed)
})

const ghostLost = (html, hpMax) => Math.round(Number(/class="dl" style="width:([\d.]+)%"/.exec(html)[1]) * hpMax / 100)

test('不点流水时扣血数与虚条同一截：昼夜战只计夜战段，只有昼战计昼战合计，夜战没挨打不显示', () => {
  const cases = [
    ['昼 7+5、夜 13', [hit(1, 0, 7, 0, 'air'), hit(1, 1, 5), hit(1, 2, 13, 0, 'night')], 12, '13'],
    ['只有昼战 7+5', [hit(1, 0, 7, 0, 'air'), hit(1, 1, 5)], 25, '12'],
    ['昼 7+5、夜战只有敌方挨打', [hit(1, 0, 7, 0, 'air'), hit(1, 1, 5), hit(0, 2, 10, 0, 'night')], 25, null],
  ]
  for (const [label, attacks, hpEnd, lost] of cases) {
    const ship = { ...shipOf(0, '我方'), hpStart: 37, hpMax: 37, hpEnd }
    const battle = battleOf({ hasNight: true, fShips: [ship], attacks })
    const html = renderBrow(battle, 0, ship)
    assert.equal(lossOf(html), lost, label)
    assert.equal(ghostLost(html, 37), Number(lost ?? 0), `${label}：虚条同宽`)
  }
  // 点住时照旧只计那一阶段
  const ship = { ...shipOf(0, '我方'), hpStart: 37, hpMax: 37, hpEnd: 12 }
  const battle = battleOf({ hasNight: true, fShips: [ship], attacks: cases[0][1] })
  for (const [stage, lost] of [[0, '7'], [1, '5'], [2, '13']]) {
    setSelectedLogStage(stage)
    assert.equal(lossOf(renderBrow(battle, 0, ship)), lost, `阶段 ${stage}`)
  }
})

test('演习敌舰 1/39 显示 -38，扣血数在击破标签之前', () => {
  const ship = { ...shipOf(0, '敌方'), hpStart: 39, hpMax: 39, hpEnd: 1, defeated: true }
  const battle = battleOf({ practice: true, eShips: [ship], attacks: [hit(0, 1, 100)] })
  for (const stage of [null, 1]) {
    setSelectedLogStage(stage)
    const html = renderBrow(battle, 1, ship)
    assert.equal(lossOf(html), '38')
    assert.match(html, /1\/39<\/span><span class="hp-loss st9">-38<\/span><span class="st9"[^>]*>击破<\/span>/)
  }
})

test('39 血挨 100 伤害只显示 -39，超杀不计', () => {
  const ship = { ...shipOf(0, '敌方'), hpStart: 39, hpMax: 39, hpEnd: 0, sunk: true }
  const battle = battleOf({ eShips: [ship], attacks: [hit(0, 1, 100)] })
  for (const stage of [null, 1]) {
    setSelectedLogStage(stage)
    assert.equal(lossOf(renderBrow(battle, 1, ship)), '39')
  }
})

test('未受伤、所选阶段无扣血、修理后血量上升都不显示扣血数', () => {
  const untouched = shipOf(0, '无伤')
  assert.equal(lossOf(renderBrow(battleOf(), 0, untouched)), null)
  const { ship, battle } = friendly()
  setSelectedLogStage(3)
  assert.equal(lossOf(renderBrow(battle, 0, ship)), null, '已经掉过血，但本阶段没有掉')
  const repaired = { ...shipOf(0, '女神'), hpStart: 20, hpMax: 40, hpEnd: 40, repairItemUsed: 43 }
  const repairBattle = battleOf({ fShips: [repaired], attacks: [hit(1, 1, 100, 0, 'gun1', 43)] })
  for (const stage of [null, 1]) {
    setSelectedLogStage(stage)
    const html = renderBrow(repairBattle, 0, repaired)
    assert.equal(lossOf(html), null)
    assert.doesNotMatch(html, /hp-loss|-0<\/span>/)
  }
})

test('敌我双方主力与护卫行共用扣血口径', () => {
  const rows = [0, 6].map(index => ({ ...shipOf(index, `舰${index}`), hpEnd: 40 }))
  const battle = battleOf({
    fShips: rows, eShips: rows,
    attacks: [hit(0, 1, 10), hit(0, 1, 10, 6), hit(1, 1, 10), hit(1, 1, 10, 6)],
  })
  for (const side of [0, 1]) {
    for (const ship of rows) {
      assert.equal(lossOf(renderBrow(battle, side, ship)), '10', `${side}/${ship.fleet}`)
    }
  }
})

test('unattackable 一直只显示敌后方，mismatch 仍显示正常扣血数', () => {
  const { ship, battle } = friendly()
  const hidden = { ...ship, unattackable: true }
  for (const stage of [null, 1]) {
    setSelectedLogStage(stage)
    const html = renderBrow(battle, 1, hidden)
    assert.match(html, /敌后方/)
    assert.doesNotMatch(html, /hp-loss|\d+\/\d+/)
  }
  battle.attacks = [hit(1, 0, 7)]
  for (const [stage, lost] of [[null, '25'], [0, '7']]) {
    setSelectedLogStage(stage)
    const html = renderBrow(battle, 0, ship)
    assert.match(html, /class="hp-approx"[^>]*>≈<\/span>/)
    assert.equal(lossOf(html), lost)
    assert.equal((html.match(/≈/g) ?? []).length, 1)
  }
})

// 与现有编队网格护栏一样读取样式表；不开窗口，不声称做了浏览器测量。
test('扣血元素沿用 nums/st9 的字号和颜色，只按逐行档位隐藏，舰绘窄档不动', () => {
  const css = fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')
    .replace(/\/\*[^]*?\*\//g, '')
  const { ship, battle } = friendly()
  assert.match(renderBrow(battle, 0, ship), /<span class="hp-loss st9">-9<\/span>/)
  const compact = [...css.matchAll(/@container \(max-width: 470px\) \{([^]*?)\n\}/g)]
    .map(match => match[1]).join('\n')
  assert.match(compact, /\.mod-di \.brow \.nm > \.ship-thumb \{ width: 22px; \}/, '沿用编队舰绘的容器窄档')
  assert.doesNotMatch(compact, /hp-loss/)
  assert.doesNotMatch(css, /\.mod-di \.di-app\.narrow \.hpx \.hp-loss\s*\{/)
  const hiding = [...css.matchAll(/([^{}]+)\{\s*display: none;\s*\}/g)]
    .filter(match => match[1].includes('hp-loss'))
  assert.equal(hiding.length, 1)
  assert.deepEqual(hiding[0][1].trim().split(/,\s*/), [
    '.mod-di .hpx .hp-loss.hp-loss-hidden',
    '.mod-di .di-app.narrow .hpx .hp-loss.hp-loss-wide',
  ], '只能按扣血元素的档位类隐藏')
  assert.match(css, /\.mod-di \.hpx \.nums \{[^}]*font-family: var\(--mono\); font-size: 8\.5px; color: var\(--dim\);/)
  assert.match(css, /\.mod-di \.hpx \.nums \.st9 \{ font-size: 8\.5px; \}/)
  assert.doesNotMatch(css, /\.hp-loss\s*\{[^}]*(?:color|font-size|width):/)
  // 主窗和独立复盘窗浅色现有 --dim 在白底上均超过 4.5:1。
  const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  for (const name of ['index', 'battle-replay']) {
    const html = fs.readFileSync(new URL(`../src/renderer/${name}.html`, import.meta.url), 'utf8')
    const light = /:root\[data-theme="light"\]\s*\{([^}]+)\}/.exec(html)[1]
    const token = name => new RegExp(`--${name}: (#[a-f0-9]{6});`).exec(light)[1]
    const text = luminance(token('dim'))
    const bg = luminance(token('bg1'))
    assert.ok((Math.max(text, bg) + .05) / (Math.min(text, bg) + .05) >= 4.5)
  }
})

// 用真实样式表的隐藏选择器作用到产物类名，分别断言宽/窄档；不模拟字体量宽。
const lossVisible = (html, narrow) => {
  const classes = /<span class="(hp-loss [^"]+)"/.exec(html)?.[1].split(' ')
  if (!classes) return false
  const css = fs.readFileSync(new URL('../src/renderer/assets/battle-replay.css', import.meta.url), 'utf8')
    .replace(/\/\*[^]*?\*\//g, '')
  const hiding = [...css.matchAll(/([^{}]+)\{\s*display: none;\s*\}/g)]
    .flatMap(match => match[1].trim().split(/,\s*/))
    .filter(selector => selector.includes('.hp-loss'))
  return !hiding.some(selector => {
    if (selector.includes('.di-app.narrow') && !narrow) return false
    const target = selector.split(/\s+/).at(-1)
    return [...target.matchAll(/\.([\w-]+)/g)].every(match => classes.includes(match[1]))
  })
}

for (const [label, hp, hpMax, hpLost, state, mismatch, wide, narrow] of [
  ['12/37 -25 中破，N=8', 12, 37, 25, '中破', false, true, true],
  ['45/100 -55 中破，N=9', 45, 100, 55, '中破', false, true, false],
  ['123/390 -267 中破，N=11', 123, 390, 267, '中破', false, true, false],
  ['1/390 -389 击破，N=9', 1, 390, 389, '击破', false, true, false],
  ['45/100 -55 无标签，N=9', 45, 100, 55, null, false, true, true],
  ['≈12/37 -25 中破，N=9', 12, 37, 25, '中破', true, true, false],
  ['≈123/390 -267 中破，N=12', 123, 390, 267, '中破', true, false, false],
  ['123/1390 -1267 无标签，N=13', 123, 1390, 1267, null, false, true, false],
  ['12/3900 -3888 无标签，N=12', 12, 3900, 3888, null, false, true, true],
  ['≈12/3900 -3888 无标签，N=13', 12, 3900, 3888, null, true, true, false],
  ['123/99999 -99876 无标签，N=15', 123, 99999, 99876, null, false, true, false],
  ['≈123/99999 -99876 无标签，N=16', 123, 99999, 99876, null, true, false, false],
]) {
  test(`逐行扣血适配：${label}`, () => {
    const html = renderHpNums({
      hp, hpMax, hpLost, state: state ? [state, 'var(--warn)'] : null, mismatch, chain: '',
    })
    assert.equal(lossOf(html), String(hpLost))
    assert.equal(lossVisible(html, false), wide, '宽档')
    assert.equal(lossVisible(html, true), narrow, '窄档')
    assert.ok(html.includes(`>${hp}/${hpMax}</span>`), '血量保留')
    if (state) assert.ok(html.endsWith(`>${state}</span>`), '状态标签保留')
    assert.equal(html.includes('≈'), mismatch)
  })
}

const classList = () => {
  const names = new Set()
  return { toggle: (name, on) => on ? names.add(name) : names.delete(name) }
}
const liveRow = (battle, side, ship) => {
  const html = renderBrow(battle, side, ship)
  const nums = { innerHTML: numsOf(html) }
  const pieces = Object.fromEntries(['rm', 'dl', 'dd'].map(cls => {
    const width = new RegExp(`class="${cls}[^"\\n]*" style="width:([^%]+)%"`).exec(html)[1] + '%'
    const style = { width, setProperty(name, value) { this[name] = value } }
    return ['.' + cls, { style }]
  }))
  const bar = { classList: classList(), isConnected: true, querySelector: selector => pieces[selector] }
  const row = {
    dataset: { battleSide: String(side), battleIndex: String(ship.index) },
    classList: classList(),
    querySelector: selector => ({ '.hpx .bar': bar, '.hpx .nums': nums })[selector] ?? null,
  }
  return { nums, row }
}

test('同一行就地切阶段，扣血与血量/状态在第二拍一起更新，回到跟随恢复本段', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { ship, battle } = friendly()
  const { nums, row } = liveRow(battle, 0, ship)
  const pane = {
    querySelectorAll: selector => selector === '.brow[data-battle-index]' ? [row] : [],
    querySelector: () => null,
  }
  const followed = nums.innerHTML
  assert.equal(lossOf(followed), '9')
  for (const [stage, lost, hp] of [[1, '9', 21], [0, '7', 30], [3, null, 12], [null, '9', 12]]) {
    const previous = nums.innerHTML
    applyLogStage(pane, battle, stage)
    if (stage !== null) assert.equal(nums.innerHTML, previous, '旧虚条第一拍时数字不提前跳')
    t.mock.timers.tick(230)
    assert.equal(lossOf(nums.innerHTML), lost)
    assert.ok(nums.innerHTML.includes(`>${hp}/37</span>`))
    assert.equal(nums.innerHTML, numsOf(renderBrow(battle, 0, ship)), '就地更新与整行渲染逐字一致')
  }
  assert.equal(nums.innerHTML, followed)
})

test('就地切阶段同步重算档位，501px 右坞的窄档逐行显示，回到跟随再隐藏', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ship = { ...shipOf(0, '我方'), hpStart: 100, hpMax: 100, hpEnd: 45 }
  const battle = battleOf({
    fShips: [ship], attacks: [hit(1, 0, 45), hit(1, 1, 1), hit(1, 2, 9)],
  })
  const { nums, row } = liveRow(battle, 0, ship)
  const pane = {
    querySelectorAll: selector => selector === '.brow[data-battle-index]' ? [row] : [],
    querySelector: () => null,
  }
  const followed = nums.innerHTML
  assert.equal(lossVisible(followed, true), false, '45/100 -55 中破，N=9')
  for (const [stage, narrow] of [[1, true], [null, false]]) {
    const previous = nums.innerHTML
    applyLogStage(pane, battle, stage)
    assert.equal(nums.innerHTML, previous, '档位与数字都不提前于第二拍')
    t.mock.timers.tick(230)
    assert.equal(lossVisible(nums.innerHTML, true), narrow, '窄档')
    assert.equal(lossVisible(nums.innerHTML, false), true, '宽档')
    assert.equal(nums.innerHTML, numsOf(renderBrow(battle, 0, ship)))
  }
  assert.equal(nums.innerHTML, followed)
})
