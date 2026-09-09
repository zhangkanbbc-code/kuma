// 作用范围：真跑 ru 的编成范围、损管计舰和装备格 className；CSS 只钉描边声明，
// 不声称验证浏览器像素或其他制空/索敌度量（那些在 fixture 中补桩）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  metricFoldOrder, renderEquip, renderMetrics, setLedger, setMaster, shipOf,
} from './fixtures/render-ru-verdict.mjs'

test('编队损管芯片按整支联合编成计舰、下一枚分类、列位置并接入收纳', () => {
  setMaster({ ships: { 101: { name: '<甲>' }, 102: { name: '乙' }, 103: { name: '丙' } } })
  setLedger({
    fleets: {
      1: [shipOf(1, { shipId: 101, slot: [10, 11], slotEx: 12 })],
      2: [shipOf(2, { shipId: 102, slot: [-1, 13], slotEx: 0 }), shipOf(3, { shipId: 103, slot: [-1], slotEx: 14 })],
    },
    combinedFlag: 1, escaped: [3],
    slotitems: { 10: { mstId: 42 }, 11: { mstId: 43 }, 12: { mstId: 43 }, 13: { mstId: 43 }, 14: { mstId: 42 } },
  })
  const html = renderMetrics()
  assert.match(html, /class="mchip metric damecon"/)
  assert.match(html, /损管 <b>3<\/b> · 要员 <b style="color:var\(--damecon-crew\)">2<\/b> · 女神 <b style="color:var\(--damecon-goddess\)">1<\/b>/)
  assert.match(html, /&lt;甲&gt; · 第 1 格 · 応急修理要員\n乙 · 第 2 格 · 応急修理女神\n丙 · 增设 · 応急修理要員/)
  assert.ok(html.indexOf('data-mkey="soku"') < html.indexOf('data-mkey="damecon"'))
  assert.ok(html.indexOf('data-mkey="damecon"') < html.indexOf('data-mkey="lv"'))
  assert.equal(renderMetrics(2), html)
  assert.ok(metricFoldOrder.includes('damecon'))
  // 单队面板不可串到别队；空装备与空编成均不凭空出芯片。
  setLedger({ fleets: { 1: [shipOf(1)], 2: [shipOf(2, { slotEx: 14 })] }, slotitems: { 14: { mstId: 43 } } })
  assert.doesNotMatch(renderMetrics(1), /metric damecon/)
  assert.match(renderMetrics(2), /损管 <b>1<\/b>/)
  setLedger({ fleets: { 1: [] } })
  assert.equal(renderMetrics(), '')
})

test('装备常规格与增设位按 42/43 描色，增设保留金边，普通装备不染色', () => {
  setMaster({ slotitems: {
    42: { name: '応急修理要員', iconId: 23 }, 43: { name: '応急修理女神', iconId: 23 }, 5: { name: '主炮', iconId: 1 },
  } })
  const slotitems = { 10: { mstId: 42 }, 11: { mstId: 43 }, 12: { mstId: 5 } }
  for (const [ex, expected] of [[10, 'crew'], [11, 'goddess']]) {
    setLedger({ fleets: { 1: [shipOf(1, { slot: [10, 11, 12], slotEx: ex, onslot: [] })] }, slotitems })
    const html = renderEquip(1)
    assert.match(html, /class="equip-icon damecon-crew"/)
    assert.match(html, /class="equip-icon damecon-goddess"/)
    assert.match(html, new RegExp(`class="equip-icon exslot damecon-${expected}"`))
    assert.equal((html.match(/damecon-/g) ?? []).length, 3)
  }
  const css = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.match(css, /\.equip-icon\.damecon-crew \{ border: 1\.5px solid var\(--damecon-crew\); \}/)
  assert.match(css, /\.equip-icon\.damecon-goddess \{ border: 1\.5px solid var\(--damecon-goddess\); \}/)
  assert.match(css, /\.equip-icon\.exslot\.damecon-crew, \.equip-icon\.exslot\.damecon-goddess \{ box-shadow: 0 0 0 1px var\(--gold\); \}/)
})
