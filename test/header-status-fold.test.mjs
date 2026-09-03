import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import headerFitModule from '../dist/shared/header-fit.js'
import {
  copiedFoldDetail,
  renderFoldGroup,
} from './fixtures/render-combined-escort.mjs'

const { headerFitStage } = headerFitModule

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
