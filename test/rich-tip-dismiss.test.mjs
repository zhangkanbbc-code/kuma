// 悬停卡「进卡后直接离开」必须收起（2026-08-25 用户实机报的）。
//
// ---- 病理 ----
// 触发字的 mouseout 里有一条**豁免**：
//     tipTimer = setTimeout(() => { if (!tipEl?.matches(':hover')) hideTip() }, 180)
// 指针从触发字挪进卡片时不收，好让卡里的字能选中复制。可收起的责任就此交给了
// 卡片自己——而卡片从前**没有任何 mouseleave 出路**。于是：
//   悬停触发字 → 出卡 → 指针移进卡片停一会 → 从卡片直接离开（不回触发字）
//   → 触发字不会再发 mouseout → 卡片永远挂在屏幕上。
// 只有绕回触发字再移开才收得掉。用户走的路径是锐的「≈ 演习 N 场」场次换算卡。
//
// ---- 为什么这批能真跑 ----
// 仓里没有 jsdom，所以夹具手搓了一个够用的假 DOM + 确定性定时器，
// 把 initRichTips 原样切出来跑（见 fixtures/rich-tip-hover.mjs）。
// 「卡片有没有收起出路」这种事，源码正则写反了照样绿。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { mountRichTips } from './fixtures/rich-tip-hover.mjs'

test('卡片自己挂着 mouseleave——收起的出路存在', () => {
  const ui = mountRichTips()
  assert.ok(ui.card.hasListener('mouseleave'), '悬停卡没有 mouseleave，进卡之后就再也收不起来了')
  assert.ok(ui.card.hasListener('mouseenter'), '悬停卡没有 mouseenter，指针停在卡上会被定时器收掉')
})

test('进卡 → 直接离卡：卡片收起（这条就是用户报的那个 bug）', () => {
  const ui = mountRichTips()
  const trigger = ui.trigger()

  ui.hoverTrigger(trigger)
  ui.clock.advance(260) // 悬停 260ms 出卡
  assert.equal(ui.shown(), true, '卡没出来，后面的断言就没意义了')

  // 指针挪进卡片：触发字发 mouseout，但豁免让它不收
  ui.enterCard()
  ui.leaveTrigger(trigger)
  ui.clock.advance(180)
  assert.equal(ui.shown(), true, '进卡就被收掉了——卡里的字没法选中复制')

  // 在卡里停一会，然后**从卡片直接离开**，不回触发字
  ui.clock.advance(3000)
  assert.equal(ui.shown(), true, '停在卡上却被收掉了')
  ui.leaveCard()
  ui.clock.advance(180)
  assert.equal(ui.shown(), false, '从卡片直接离开后卡片没收起——正是用户报的那个 bug')
})

test('老路径不许坏：进卡 → 回触发字 → 再移开，照样收起', () => {
  const ui = mountRichTips()
  const trigger = ui.trigger()
  ui.hoverTrigger(trigger)
  ui.clock.advance(260)

  ui.enterCard()
  ui.leaveTrigger(trigger)
  ui.clock.advance(180)
  assert.equal(ui.shown(), true)

  // 回到触发字上（卡片发 mouseleave），再从触发字移开
  ui.leaveCard()
  ui.hoverTrigger(trigger)
  ui.clock.advance(260)
  assert.equal(ui.shown(), true, '回到触发字反而收掉了')
  ui.leaveTrigger(trigger)
  ui.clock.advance(180)
  assert.equal(ui.shown(), false, '回触发字再移开没收起——老路径坏了')
})

test('指针停在卡片上不许被收走（豁免仍然成立）', () => {
  const ui = mountRichTips()
  const trigger = ui.trigger()
  ui.hoverTrigger(trigger)
  ui.clock.advance(260)
  ui.enterCard()
  ui.leaveTrigger(trigger)
  // 停很久：卡里的字要能慢慢选中复制
  ui.clock.advance(10_000)
  assert.equal(ui.shown(), true, '停在卡上被收掉了——卡里的字没法选')
})

test('从卡片直接挪到另一个触发字：收旧卡、出新卡，不留两张', () => {
  const ui = mountRichTips()
  const first = ui.trigger('第一张')
  const second = ui.trigger('第二张')
  ui.hoverTrigger(first)
  ui.clock.advance(260)
  ui.enterCard()
  ui.leaveTrigger(first)
  ui.clock.advance(180)

  // 直接从卡片挪到另一个触发字上
  ui.leaveCard()
  ui.hoverTrigger(second)
  ui.clock.advance(260)
  // 富提示只有一个卡片节点（复用），所以「不留两张」＝它仍是显示态且内容换了
  assert.equal(ui.shown(), true, '挪到新触发字上却没有卡')
})

test('同族的另外三张卡也各有收起出路（同病同修的清点）', () => {
  // 这一条守的是「以后新增悬浮卡别再漏掉收起出路」。三张卡各自的收起写法不同，
  // 但都必须有：卡片自己的 mouseleave（或等价的调度收起）。
  const read = (rel) => fs.readFileSync(new URL(`../src/renderer/${rel}`, import.meta.url), 'utf8')
  const link = read('link.ts')
  const di = read('modules/di.ts')
  const ru = read('modules/ru.ts')
  // 实体速览卡（Peek）
  assert.ok(
    /peekEl\.addEventListener\('mouseleave'/.test(link),
    'Peek 卡的 mouseleave 没了',
  )
  // 富提示卡（本次修的）
  assert.ok(
    /tipEl\.addEventListener\('mouseleave'/.test(link),
    '富提示卡的 mouseleave 没了——进卡之后又收不起来了',
  )
  // 镝的「已用装备」浮层
  assert.ok(
    /usedEquipmentPopover\.addEventListener\('mouseleave'/.test(di),
    '已用装备浮层的 mouseleave 没了',
  )
  // 锐的度量收纳卡
  assert.ok(
    /metricsFoldCard\.addEventListener\('mouseleave'/.test(ru),
    '度量收纳卡的 mouseleave 没了',
  )
})
