// 海域计量条「计的是什么」那张手工表的护栏。
//
// 这张表存在的理由就是：主数据 `api_required_defeat_count` 没有单位，
// 语义按图而异，任何一句固定的「需击破 N 次」都必然在某些图上说谎
// （5-6 的 280 是输送 TP、7-5 的 2 只是第一段），2026-09-01 因此整个撤下过一次。
// 所以这里守的第一件事不是「表在不在」，而是**表说的话是不是真的**。
//
// 三层：
// ① 结构：段不能空、量必须是正整数、计量类型只能是那三种；
// ② 交叉校验：**主数据的 api_required_defeat_count 恒等于表里第一段的量**——
//    判据取自游戏自己下发的主数据，与表的资料源（wikiwiki 原文）互不相干，
//    抄错一位数就会被顶出来（「验证判据不能取自被验证系统自身」）。
//    另外表收录的图必须与主数据里有这个字段的常规图**一张不多一张不少**；
// ③ 原文自证：每一段的量必须真的出现在它自己的 `sourceJp` 原文里
//    （计次类还要求是「N回」那个形态）——这条只拦转录与字段对不上，
//    拦不住整句抄错的图，所以它是补充，不是主判据。
//
// 展示端的判据落在**渲染产物**上（见 test/fixtures/render-map-gauge-pills.mjs），
// 不断言源码文本：「表里没有的图一枚都不出」写反了，源码里照样有那个函数名。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import metric from '../dist/shared/map-gauge-metric.js'
import mapId from '../dist/shared/map-id.js'

import { mapGaugePillsHtml, pillTexts } from './fixtures/render-map-gauge-pills.mjs'

const {
  MAP_GAUGE_SEGMENTS,
  mapGaugeSegments,
  mapGaugeSegmentLabels,
  mapGaugeLabelText,
  mapGaugeSummaryText,
  mapGaugeMetricCodes,
} = metric
const { mapCodeOf } = mapId

// 游戏主数据 `api_mst_mapinfo` 里 `api_required_defeat_count` 非空的常规海域，
// 原样抄自 api_start2 快照（2026-09-01）。这是**游戏自报的客观事实**，
// 与表的资料源（wikiwiki 各海域页原文）是两份互不相干的东西，正好互证。
const MASTER_REQUIRED = {
  15: 4,
  16: 7,
  25: 4,
  35: 4,
  44: 4,
  45: 5,
  52: 4,
  53: 5,
  54: 5,
  55: 5,
  56: 280,
  62: 3,
  63: 4,
  64: 5,
  65: 6,
  71: 3,
  72: 3,
  73: 3,
  74: 5,
  75: 2,
}

// ---- ① 结构 ----

test('每张图至少一段，量是正整数，计量类型只有那三种', () => {
  const allowed = new Set(['defeat', 'arrival', 'transport'])
  for (const [key, segments] of Object.entries(MAP_GAUGE_SEGMENTS)) {
    const code = mapCodeOf(Number(key))
    assert.ok(Array.isArray(segments) && segments.length > 0, `${code} 的分段是空的`)
    for (const [index, segment] of segments.entries()) {
      assert.ok(allowed.has(segment.metric), `${code} 第 ${index + 1} 段的计量类型 ${segment.metric} 不认识`)
      assert.ok(
        Number.isInteger(segment.amount) && segment.amount > 0,
        `${code} 第 ${index + 1} 段的量不是正整数`,
      )
      assert.ok(segment.sourceJp.trim().length > 0, `${code} 第 ${index + 1} 段没留原文`)
    }
  }
})

test('表里没有的图给空数组，而不是抛或者猜一个出来', () => {
  // 常规图里没有计量条的（1-1）、以及活动图（62-1）都该是空的
  assert.deepEqual(mapGaugeSegments(11), [])
  assert.deepEqual(mapGaugeSegments(621), [])
  assert.deepEqual(mapGaugeSegmentLabels(11), [])
  assert.equal(mapGaugeSummaryText(11), '')
})

// ---- ② 交叉校验：拿游戏主数据顶表 ----

test('主数据的 api_required_defeat_count 恒等于表里第一段的量', () => {
  for (const [key, required] of Object.entries(MASTER_REQUIRED)) {
    const segments = mapGaugeSegments(Number(key))
    const code = mapCodeOf(Number(key))
    assert.ok(segments.length, `${code} 主数据有计量条，表里却没有`)
    assert.equal(
      segments[0].amount,
      required,
      `${code} 第一段的量与主数据对不上——两份资料只要有一份抄错就会走到这里`,
    )
  }
})

test('收录范围与主数据一致：一张不多一张不少', () => {
  assert.deepEqual(
    mapGaugeMetricCodes(),
    Object.keys(MASTER_REQUIRED)
      .map(Number)
      .sort((left, right) => left - right)
      .map(mapCodeOf),
  )
})

test('那三张多段图正是主数据说不清的图：整图总量远大于主数据那个数', () => {
  // 5-6 / 7-2 / 7-3 / 7-5：主数据只报第一段，拿它当整图需求必然说谎。
  // 这条把「为什么要有这张表」钉成断言，别哪天有人又把主数据直接标出去。
  for (const [key, total] of [
    [56, 280 + 2 + 3],
    [72, 3 + 4],
    [73, 3 + 4],
    [75, 2 + 3 + 3],
  ]) {
    const segments = mapGaugeSegments(key)
    assert.ok(segments.length > 1, `${mapCodeOf(key)} 该是多段`)
    assert.equal(
      segments.reduce((sum, segment) => sum + segment.amount, 0),
      total,
    )
    assert.notEqual(segments[0].amount, total, `${mapCodeOf(key)} 的第一段不等于整图`)
  }
})

// ---- ③ 原文自证 ----

test('每一段的量都能在它自己的原文里找到', () => {
  for (const [key, segments] of Object.entries(MAP_GAUGE_SEGMENTS)) {
    const code = mapCodeOf(Number(key))
    for (const [index, segment] of segments.entries()) {
      const where = `${code} 第 ${index + 1} 段`
      assert.ok(
        segment.sourceJp.includes(String(segment.amount)),
        `${where} 的量 ${segment.amount} 在原文里根本没出现`,
      )
      if (segment.metric !== 'transport') {
        assert.match(
          segment.sourceJp,
          new RegExp(`${segment.amount}回`),
          `${where} 是计次的，原文里该有「${segment.amount}回」`,
        )
      }
    }
  }
})

test('计量类型确实按图分开了：1-6 是到达、5-6 第一段是输送、其余是击破', () => {
  // 这三条正是当初把固定标签打穿的那几张图
  assert.equal(mapGaugeSegments(16)[0].metric, 'arrival')
  assert.match(mapGaugeSegments(16)[0].sourceJp, /到達/)
  assert.equal(mapGaugeSegments(56)[0].metric, 'transport')
  assert.match(mapGaugeSegments(56)[0].sourceJp, /輸送ゲージ/)
  assert.equal(mapGaugeSegments(15)[0].metric, 'defeat')
  const metrics = new Set(
    Object.values(MAP_GAUGE_SEGMENTS).flatMap((segments) => segments.map((s) => s.metric)),
  )
  assert.deepEqual([...metrics].sort(), ['arrival', 'defeat', 'transport'])
})

// ---- 文案 ----

test('单段图不带段序，多段图按攻略顺序各带一个段序', () => {
  assert.deepEqual(mapGaugeSegmentLabels(15).map(mapGaugeLabelText), ['需击破 4 次'])
  assert.deepEqual(mapGaugeSegmentLabels(16).map(mapGaugeLabelText), ['需到达终点 7 次'])
  assert.deepEqual(mapGaugeSegmentLabels(56).map(mapGaugeLabelText), [
    '第一段 · 需输送 TP 280',
    '第二段 · 需击破 2 次',
    '第三段 · 需击破 3 次',
  ])
  assert.deepEqual(mapGaugeSegmentLabels(75).map(mapGaugeLabelText), [
    '第一段 · 需击破 2 次',
    '第二段 · 需击破 3 次',
    '第三段 · 需击破 3 次',
  ])
})

test('摘要行：单段就是那一段，多段先报段数再按顺序串', () => {
  assert.equal(mapGaugeSummaryText(15), '需击破 4 次')
  assert.equal(mapGaugeSummaryText(16), '需到达终点 7 次')
  assert.equal(mapGaugeSummaryText(72), '两段 · 需击破 3 次 → 需击破 4 次')
  assert.equal(mapGaugeSummaryText(56), '三段 · 需输送 TP 280 → 需击破 2 次 → 需击破 3 次')
})

test('输送段不带「次」——它计的是量，不是次数', () => {
  const [transport] = mapGaugeSegmentLabels(56)
  assert.equal(transport.tail, '')
  assert.ok(!mapGaugeLabelText(transport).includes('次'))
})

// ---- 展示端（对着渲染产物）----

test('海域卡：单段一枚词条，数值加粗', () => {
  const html = mapGaugePillsHtml(15)
  assert.deepEqual(pillTexts(html), ['需击破 4 次'])
  assert.match(html, /<b>4<\/b>/)
})

test('海域卡：多段各出一枚、顺序即攻略顺序', () => {
  assert.deepEqual(pillTexts(mapGaugePillsHtml(56)), [
    '第一段 · 需输送 TP 280',
    '第二段 · 需击破 2 次',
    '第三段 · 需击破 3 次',
  ])
  assert.deepEqual(pillTexts(mapGaugePillsHtml(75)), [
    '第一段 · 需击破 2 次',
    '第二段 · 需击破 3 次',
    '第三段 · 需击破 3 次',
  ])
})

test('表里没有的图：一个字都不出（沿撤下之后的现状）', () => {
  for (const id of [11, 24, 51, 621]) {
    assert.equal(mapGaugePillsHtml(id), '', `${mapCodeOf(id)} 不该出现任何计量条词条`)
  }
})

// ---- 接线：两处展示都只能从这张表取词 ----

test('海域卡与悬停卡都走这张表，且旧的「一句话套所有图」不许回来', () => {
  const ji = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')
  assert.ok(ji.includes('mapGaugePillsHtml(info.api_id)'), '海域卡没接上计量条词条')
  assert.ok(ji.includes('mapGaugeSummaryText(id)'), '悬停卡摘要没接上计量条')
  // 撤下的正是「拿 api_required_defeat_count 当一句固定标签」这件事：
  // 它要是回到任何一处展示里，这张表就白做了
  assert.ok(
    !/需?击破\s*\$\{[^}]*api_required_defeat_count/.test(ji),
    'api_required_defeat_count 又被直接当成击破次数标出去了',
  )
})
