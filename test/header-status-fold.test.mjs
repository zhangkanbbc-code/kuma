import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import headerFitModule from '../dist/shared/header-fit.js'
import { renderer } from './fixtures/render-return-clock.mjs'
import {
  copiedFoldDetail,
  renderFoldGroup,
} from './fixtures/render-combined-escort.mjs'

const { headerFitStage } = headerFitModule

// 依据 shared/source-pattern-guards-miss-logic-bugs：执行真实渲染、预览和 tick，
// 用产物文字与 class 守到点判据，不能只证明源码里出现了 <= 或 data-cds-done。
const buildChips = (html) => [...html.matchAll(/<span class="(el hs-chip build [^"]*)" data-etype="kdock" data-eid="(\d+)"[^>]*><i>\d+<\/i><b([^>]*)>([^<]*)<\/b><\/span>/g)]
  .map(([, className, id, attrs, label]) => ({ className, id: Number(id), attrs, label }))

const setupBuildDocks = (t, spoil) => {
  const now = 1800000000000
  t.mock.method(Date, 'now', () => now)
  renderer.extras.buildSpoiler = spoil
  renderer.mg.master.ships = { 1: { name: '秋云' }, 2: { name: '潮' }, 3: { name: '测试舰娘' }, 4: { name: '时雨' } }
  renderer.mg.kdocks = [
    { id: 1, state: 2, completeTime: now - 1, createdShipId: 1, recipeFuel: 30 },
    { id: 2, state: 3, completeTime: now + 3000, createdShipId: 2, recipeFuel: 30 },
    { id: 3, state: 2, completeTime: now + 34 * 60000, createdShipId: 3, recipeFuel: 1500 },
    { id: 4, state: 2, completeTime: now - 60000, createdShipId: 4, recipeFuel: 1500 },
  ]
  return now
}

for (const spoil of [false, true]) {
  test(`建造坞已过点 state 2 与 state 3 文字和 class 相同，剧透${spoil ? '开' : '关'}`, (t) => {
    setupBuildDocks(t, spoil)
    const html = renderer.buildDocksHtml()
    const chips = buildChips(html)
    assert.deepEqual(chips.map(({ id, label, className }) => [id, label, className]), [
      [2, spoil ? '潮' : '待领', 'el hs-chip build ready'],
      [1, spoil ? '秋云' : '待领', 'el hs-chip build ready'],
      [4, spoil ? '时雨' : '待领', 'el hs-chip build ready'],
      [3, '34分', 'el hs-chip build on'],
    ])
    assert.match(html, /class="hs-count" title="建造坞使用数">4\/4</)
    assert.doesNotMatch(html, /完成/)
    for (const id of [1, 4]) {
      const before = chips.find((chip) => chip.id === id)
      renderer.mg.kdocks.find((dock) => dock.id === id).state = 3
      assert.deepEqual(buildChips(renderer.buildDocksHtml()).find((chip) => chip.id === id), before)
    }
  })

  test(`建造坞归零同拍更新抬头及折叠浮层文字和 class，剧透${spoil ? '开' : '关'}`, (t) => {
    const now = setupBuildDocks(t, spoil)
    const dock = renderer.mg.kdocks[2]
    dock.completeTime = now + 1
    const [chip] = buildChips(renderer.buildDocksHtml()).filter((entry) => entry.id === 3)
    const makeRoot = () => {
      const classes = new Set(chip.className.split(' '))
      const countdown = { textContent: chip.label, dataset: {
        cds: /data-cds="(\d+)"/.exec(chip.attrs)[1],
        cdsDone: /data-cds-done="([^"]*)"/.exec(chip.attrs)[1],
      } }
      const element = {
        classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
        querySelector: () => countdown,
      }
      return { classes, countdown, querySelectorAll: (selector) =>
        selector === '[data-cds]' ? [countdown] : selector === '.hs-chip.build:has([data-cds])' ? [element] : [] }
    }
    const main = makeRoot()
    const popover = makeRoot()
    for (const [time, ready, label] of [[now, false, '1分'], [now + 1, true, spoil ? '测试' : '待领'], [now + 2, true, spoil ? '测试' : '待领']]) {
      Date.now.mock.mockImplementation(() => time)
      renderer.runHeaderTick(main, popover)
      for (const root of [main, popover]) {
        assert.equal(root.countdown.textContent, label)
        assert.equal(root.classes.has('ready'), ready)
        assert.equal(root.classes.has('on'), !ready)
      }
    }
    assert.equal(dock.state, 2)
    assert.equal(buildChips(renderer.buildDocksHtml()).find((entry) => entry.id === 3).className, 'el hs-chip build ready')
  })

  test(`建造坞到点预览显示完成待领且不再报抢完材料，剧透${spoil ? '开' : '关'}`, (t) => {
    const now = setupBuildDocks(t, spoil)
    const dock = renderer.mg.kdocks[2]
    for (const time of [dock.completeTime - 1, dock.completeTime, dock.completeTime + 1]) {
      Date.now.mock.mockImplementation(() => time)
      const peek = renderer.routes.kdock.peek({ num: 3 })
      const ready = time >= dock.completeTime
      assert.equal(peek.lines[0], ready ? '大型建造 · <b>完成待领</b>' : '大型建造 · 建造中')
      assert.equal(peek.lines.some((line) => line.includes('抢完需高速建造材')), !ready)
      assert.equal(peek.lines.some((line) => line.startsWith('剩余')), !ready)
      assert.equal(peek.lines.includes('结果 测试舰娘'), spoil)
      assert.equal(Boolean(peek.media), spoil)
    }
    Date.now.mock.mockImplementation(() => now)
    for (const id of [1, 2, 4]) assert.match(renderer.routes.kdock.peek({ num: id }).lines[0], /完成待领/)
  })
}

test('建造坞未提供正完成时刻不按本地到点待领，占用数仍包含它', (t) => {
  setupBuildDocks(t, false)
  renderer.mg.kdocks = [{ id: 1, state: 2, completeTime: 0, createdShipId: 0, recipeFuel: 30 }]
  assert.equal(buildChips(renderer.buildDocksHtml())[0].className, 'el hs-chip build on')
  assert.match(renderer.buildDocksHtml(), /title="建造坞使用数">1\/1</)
})

test('顶栏常规宽度装得下时保持 fit', () => {
  assert.equal(
    headerFitStage(
      { scrollWidth: 900, clientWidth: 900 },
      { scrollWidth: 700, clientWidth: 900 },
      2,
    ),
    'fit',
  )
})

test('顶栏宽度相差 1px 时按取整误差保持 fit', () => {
  assert.equal(
    headerFitStage(
      { scrollWidth: 901, clientWidth: 900 },
      { scrollWidth: 900, clientWidth: 900 },
      2,
    ),
    'fit',
  )
})

test('顶栏常规宽度相差 2px、紧凑宽度装得下时进入 compact', () => {
  assert.equal(
    headerFitStage(
      { scrollWidth: 902, clientWidth: 900 },
      { scrollWidth: 900, clientWidth: 900 },
      2,
    ),
    'compact',
  )
})

test('顶栏常规与紧凑宽度都相差 2px 时进入 folded', () => {
  assert.equal(
    headerFitStage(
      { scrollWidth: 902, clientWidth: 900 },
      { scrollWidth: 902, clientWidth: 900 },
      2,
    ),
    'folded',
  )
})

test('顶栏容差为 0 时相差 1px 也算溢出', () => {
  assert.equal(
    headerFitStage(
      { scrollWidth: 901, clientWidth: 900 },
      { scrollWidth: 901, clientWidth: 900 },
      0,
    ),
    'folded',
  )
})

test('顶栏尺寸监听盯 header，调用统一传入 2px 容差', () => {
  const source = fs.readFileSync(
    new URL('../src/renderer/header-status.ts', import.meta.url),
    'utf8',
  )
  assert.match(source, /const HEADER_FIT_TOLERANCE_PX = 2/)
  assert.match(
    source,
    /headerFitStage\(regular, regular, HEADER_FIT_TOLERANCE_PX\)/,
  )
  assert.match(
    source,
    /headerFitStage\(regular, compact, HEADER_FIT_TOLERANCE_PX\)/,
  )
  assert.match(
    source,
    /new ResizeObserver\(fitHeader\)\.observe\(host\.closest\('header'\)!\)/,
  )
})

test('折叠态的远渠建各由一枚单字芯片占位，原芯片统一藏在详情容器', () => {
  const detail = '<span class="hs-chip on">甲</span><span class="hs-chip">乙</span>'
  const groups = [
    ['expedition', '远', '远征 · 悬停展开'],
    ['dock', '渠', '入渠 · 悬停展开'],
    ['build', '建', '建造 · 悬停展开'],
  ]
  for (const [group, label, title] of groups) {
    const html = renderFoldGroup(group, label, title, detail)
    assert.match(html, new RegExp(`<span class="hs-group" data-group="${group}">`))
    assert.equal((html.match(/\bhs-fold-chip\b/g) ?? []).length, 1)
    assert.match(html, new RegExp(`data-group="${group}"[\\s\\S]*title="${title}">${label}</span>`))
    assert.match(html, new RegExp(`<span class="hs-group-detail">${detail}</span>`))
  }

  const css = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(
    css,
    /#header-status\.folded \.hs-group\[data-group\] > \.hs-group-detail \{ display: none; \}/,
  )
  assert.match(
    css,
    /#header-status\.folded \.hs-group\[data-group\] > \.hs-chip\.hs-fold-chip \{ display: inline-flex; \}/,
  )
})

test('悬停浮层复制出的内容与组内详情 HTML 完全一致', () => {
  const detail =
    '<span class="hs-count">2/4</span><span class="el hs-chip dock on" data-timer="ndock:1"><b data-cds="123">0:01</b></span>'
  const group = renderFoldGroup('dock', '渠', '入渠 · 悬停展开', detail)
  assert.equal(copiedFoldDetail(group), detail)
})
