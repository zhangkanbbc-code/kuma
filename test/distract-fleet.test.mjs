import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { renderDistractFleet, changeFleet, sortieOf } from './fixtures/render-di-battle.mjs'

const stateOf = (combinedFlag = 0, deckId = 3) => ({
  sortie: sortieOf({ deckId }),
  combinedFlag,
  decks: [
    { id: 3, ships: [1, 2, 3, 4, 5, 6, -1] },
    { id: 2, ships: [7, 8, 9, 10, 11, 12] },
    { id: 1, ships: [1, 2, 3, 4, 5, 6] },
  ],
  master: { ships: { 101: { name: '测试舰<&>', fuelMax: 80, bullMax: 100 } } },
  ships: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, {
    id: i + 1, shipId: 101, lv: 20 + i, nowhp: [100, 75, 50, 25, 0, 76][i % 6], maxhp: 100,
    fuel: 20, bull: 60, cond: [19, 20, 29, 30, 49, 50][i % 6],
  }])),
})
const rowsOf = (html) => [...html.matchAll(/<div class="distract-fleet-row"[^>]*>[\s\S]*?<\/div>/g)].map(([row]) => row)
const idsOf = (html) => [...html.matchAll(/data-fleet-ship="(\d+)"/g)].map(([, id]) => Number(id))

test('分心编队：默认开启，出击舰队六行，实时耐久、破损色、燃弹与疲劳阈值', () => {
  const html = renderDistractFleet(stateOf())
  const rows = rowsOf(html)
  assert.equal(rows.length, 6)
  assert.deepEqual(idsOf(html), [1, 2, 3, 4, 5, 6])
  for (const [i, [hp, tier, cond, cls]] of [
    [100, 'hp-g', 19, 'bad'], [75, 'hp-y', 20, 'tired'], [50, 'hp-o', 29, 'tired'],
    [25, 'hp-r', 30, ''], [0, 'hp-r', 49, ''], [76, 'hp-g', 50, 'sp'],
  ].entries()) {
    assert.ok(rows[i].includes(`class="df-hp ${tier}"><i style="width:${hp}%"></i><span>${hp}/100</span>`))
    assert.match(rows[i], /class="b fuel low"><i style="width:25%"/)
    assert.match(rows[i], /class="b ammo"><i style="width:60%"/)
    assert.ok(rows[i].includes(`class="cond ${cls}">${cond}</span>`))
    assert.ok(rows[i].includes(`· Lv${20 + i}`))
    assert.match(rows[i], /测试舰&lt;&amp;&gt;/)
    assert.match(rows[i], /data-fleet-deck="3"/)
  }
  assert.doesNotMatch(html, />沉<|>退避</) // HP 为零也不能冒充沉没名单。
})

test('分心编队：开关关、分心关、未出击、无出击、演习分别为空', () => {
  assert.equal(renderDistractFleet(stateOf(), true, false), '')
  assert.equal(renderDistractFleet(stateOf(), false, true), '')
  for (const sortie of [null, sortieOf({ active: false }), sortieOf({ practice: true })]) {
    assert.equal(renderDistractFleet({ ...stateOf(), sortie }), '')
  }
})

test('分心编队：三种联合编队都先主队后护卫队，普通出击不误带第二队', () => {
  for (const flag of [1, 2, 3]) {
    const html = renderDistractFleet(stateOf(flag, 1))
    assert.deepEqual(idsOf(html), Array.from({ length: 12 }, (_, i) => i + 1))
    assert.deepEqual(rowsOf(html).map((row) => Number(row.match(/data-fleet-deck="(\d+)"/)[1])),
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
    assert.equal(rowsOf(renderDistractFleet(stateOf(flag, 3))).length, 6)
  }
})

test('分心编队：退避与陪同舰保留舰位，沉没名单优先，HP 为零不独立判沉', () => {
  const state = stateOf()
  state.sortie.escaped = [{ rosterId: 2, role: 'escape' }, { rosterId: 3, role: 'tow' }]
  state.sortie.sunkShips = [{ rosterId: 3 }]
  const rows = rowsOf(renderDistractFleet(state))
  assert.equal(rows.length, 6)
  assert.match(rows[1], /class="df-state">退避</)
  assert.match(rows[2], /class="df-state">沉</)
  assert.doesNotMatch(rows[2], />退避</)
  assert.doesNotMatch(rows[4], />沉</)
  state.sortie.sunkShips = []
  assert.match(rowsOf(renderDistractFleet(state))[2], /class="df-state">退避</)
})

test('分心编队：真实铭监听器在 ships 更新时立即重画，在 sortie 结束时清空', () => {
  const state = stateOf()
  renderDistractFleet(state)
  const ships = { ...state.ships, 1: { ...state.ships[1], nowhp: 24, fuel: 40, bull: 25 } }
  const rows = rowsOf(changeFleet(['ships'], { ships }))
  assert.match(rows[0], /class="df-hp hp-r"><i style="width:24%"><\/i><span>24\/100/)
  assert.match(rows[0], /class="b fuel"><i style="width:50%"/)
  assert.match(rows[0], /class="b ammo low"><i style="width:25%"/)
  assert.equal(changeFleet(['sortie'], { sortie: { ...state.sortie, active: false } }), '')
})

test('分心编队接线：实时状态置于战斗列前，外壳放行并复用锐的配色，设置事件触发重画', () => {
  const di = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(di, /\$\{distractFleetStripHtml\(mg\.sortie\)\}\s*<div class="battle-col">/)
  assert.match(di, /entityNameHtml\('ship', ship\.shipId, masterShipName\(ship\.shipId\), \{ compact: true \}\)/)
  assert.doesNotMatch(di, /from ['"](?:\.\/|.*modules\/)ru['"]|require\(['"].*\/ru['"]\)/)
  assert.match(di, /const refreshDistractFleet = \(\) => render\(pane\)/)
  assert.match(di, /addEventListener\('kuma-distract-changed', refreshDistractFleet\)/)
  assert.match(di, /removeEventListener\('kuma-distract-changed', refreshDistractFleet\)/)
  assert.match(css, /\.di-app > :not\(\.battle-col\):not\(\.distract-fleet-strip\)/)
  assert.match(css, /\.distract-fleet-row \{[^}]*height: 16px;/)
  assert.match(renderDistractFleet(stateOf()), /class="distract-fleet-strip fleet-skin"/)
})
