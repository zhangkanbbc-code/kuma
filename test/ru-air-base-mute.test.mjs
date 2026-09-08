import assert from 'node:assert/strict'
import test from 'node:test'
import { scene } from './fixtures/render-ru-air-base-mute.mjs'

const squad = (areaId, patch = {}) => ({
  areaId, rid: 1, name: '', actionKind: 1, distance: 7,
  planes: [{ slotId: 1, count: 17, maxCount: 18, cond: 3, state: 1 }],
  ...patch,
})

test('海域分节按钮两态：静默隐藏中队警示与标签，搭载与制空保留', () => {
  const bases = [squad(6)]
  scene.reset(bases)
  const before = scene.airBaseAreaHtml(6, bases)
  assert.match(before, /class="ab-squad warn"/)
  assert.match(before, /需要补给/)
  assert.match(before, /存在红疲劳/)
  assert.match(before, /aria-pressed="false"[^>]*>静默提示<\/button>/)
  assert.match(before, /title="不再提示该海域陆航的未补给、疲劳与被打空"/)
  scene.reset(bases, [6])
  const after = scene.airBaseAreaHtml(6, bases)
  assert.match(after, /class="ab-squad"/)
  assert.doesNotMatch(after, /ab-squad warn|需要补给|存在[红橙]疲劳/)
  assert.match(after, /aria-pressed="true"[^>]*>已静默 · 恢复提示<\/button>/)
  assert.match(after, /title="恢复该海域陆航的未补给、疲劳与被打空提示"/)
  assert.match(after, /提示已静默/)
  for (const html of [before, after]) {
    assert.match(html, /搭载 17\/18/)
    assert.match(html, /<b>17\/18<\/b>/)
    assert.match(html, /出击制空 <b>10–20<\/b>/)
    assert.match(html, /防空制空 <b>10–20<\/b>/)
  }
})

test('静默只影响对应海域，橙疲劳标签亦可恢复', () => {
  const bases = [squad(7, { planes: [{ slotId: 1, count: 18, maxCount: 18, cond: 2 }] })]
  scene.reset(bases, [6])
  assert.match(scene.airBaseAreaHtml(7, bases), /存在橙疲劳/)
  scene.reset(bases, [7])
  assert.doesNotMatch(scene.airBaseAreaHtml(7, bases), /存在橙疲劳|ab-squad warn/)
  scene.reset(bases)
  assert.match(scene.airBaseAreaHtml(7, bases), /存在橙疲劳/)
})

test('抬头短缺和疲劳排除静默区，海域及航空队总数保留，待机判据不变', () => {
  scene.reset([squad(6), squad(7, { actionKind: 0 }), squad(62)], [6, 62])
  const html = scene.airBaseHeaderHtml()
  assert.match(html, /data-mkey="areas">海域 <b>3<\/b>/)
  assert.match(html, /data-mkey="squads">航空队 <b>3<\/b>/)
  assert.match(html, /data-mkey="short" title="已静默 2 个海域">待补给 <b>1<\/b>/)
  assert.match(html, /data-mkey="tired" title="1 队有疲劳机体，其中 1 队已到红疲劳 · 已静默 2 个海域">疲劳 <b>1<\/b><em> 红1/)
})

test('全静默时抬头两枚警示芯片归零，无静默时不添加静默说明', () => {
  const bases = [squad(6)]
  scene.reset(bases, [6])
  const html = scene.airBaseHeaderHtml()
  assert.doesNotMatch(html, /class="mchip (?:bad|warn)"/)
  assert.match(html, /待补给 <b>0<\/b>/)
  assert.match(html, /疲劳 <b>0<\/b>/)
  scene.reset(bases)
  assert.doesNotMatch(scene.airBaseHeaderHtml(), /已静默/)
})

test('页签提示排除静默区计数与被打空，未静默区被打空仍报红', () => {
  scene.reset([squad(6), squad(7)], [6])
  let html = scene.fleetTabsHtml(900)
  assert.match(html, /glow-warn/)
  assert.match(html, /title="基地航空队未就绪：未补给 1 队 · 红疲劳 1 队 · 1 个海域已静默提示"/)
  scene.reset([squad(6)], [6])
  html = scene.fleetTabsHtml(900)
  assert.doesNotMatch(html, /glow-warn|未补给|红疲劳/)
  assert.match(html, /title="基地航空队 · 1 个海域已静默提示"/)
  const wiped = squad(6, { actionKind: 0, planes: [{ slotId: 1, count: 0, maxCount: 18, cond: 3 }] })
  scene.reset([wiped], [6])
  html = scene.fleetTabsHtml(900)
  assert.doesNotMatch(html, /glow-bad|glow-warn|被打空|未补给|红疲劳/)
  assert.match(html, /title="基地航空队 · 1 个海域已静默提示"/)
  scene.reset([wiped, squad(7)], [6])
  html = scene.fleetTabsHtml(900)
  assert.match(html, /glow-warn/)
  assert.doesNotMatch(html, /glow-bad|被打空/)
  scene.reset([wiped, { ...wiped, areaId: 7 }], [6])
  html = scene.fleetTabsHtml(900)
  assert.match(html, /glow-bad/)
  assert.match(html, /title="有航空队被打空 · 1 个海域已静默提示"/)
  scene.reset([wiped])
  assert.match(scene.fleetTabsHtml(900), /glow-bad/)
})

test('静默常规或活动区不弹陆航段落，包括被打空，未静默区照常提醒', () => {
  for (const areaId of [6, 7, 62]) {
    for (const count of [0, 17]) {
      const bases = [squad(areaId, { planes: [{ slotId: 1, count, maxCount: 18, cond: 3 }] })]
      scene.reset(bases, [areaId], { 62: {} })
      scene.warnOnEventMapOpen(areaId, 10000)
      assert.deepEqual(scene.toasts, [])
      scene.reset(bases, [], { 62: {} })
      scene.warnOnEventMapOpen(areaId, 10000)
      assert.equal(scene.toasts.length, 1)
      assert.equal(scene.toasts[0][1], '基地航空 1 队未补给、基地航空 1 队红疲劳')
    }
  }
})

test('被打空的中队按海域静默警示与标签，搭载 0/N 保留，恢复后重新提示', () => {
  const bases = [squad(6, { planes: [{ slotId: 1, count: 0, maxCount: 18, cond: 3 }] })]
  for (const muted of [[], [6], [7], []]) {
    scene.reset(bases, muted)
    const html = scene.airBaseAreaHtml(6, bases)
    assert.match(html, /搭载 0\/18/)
    assert.match(html, /<b>0\/18<\/b>/)
    if (muted.includes(6)) {
      assert.doesNotMatch(html, /class="ab-squad (?:warn|bad)"|需要补给|存在[红橙]疲劳/)
      assert.match(html, /class="ab-squad"/)
      assert.doesNotMatch(scene.airBaseHeaderHtml(), /class="mchip (?:bad|warn)"/)
    } else {
      assert.match(html, /class="ab-squad warn"/)
      assert.match(html, /需要补给/)
      assert.match(html, /存在红疲劳/)
    }
  }
})

test('活动区静默仍弹札段落，防抖继续生效', () => {
  scene.reset([squad(62)], [62], { 62: {} })
  scene.mg.decks = [{ id: 1, ships: [1, 2], mission: [0] }]
  scene.warnOnEventMapOpen(62, 10000)
  scene.warnOnEventMapOpen(62, 11000)
  assert.equal(scene.toasts.length, 1)
  assert.equal(scene.toasts[0][1], '第1舰队 2 艘未锁定 · 出击后永久打札')
  scene.warnOnEventMapOpen(62, 19000)
  assert.equal(scene.toasts.length, 2)
})

test('面板点击委托按区切换，落盘去重排序并重画；恢复后四处提示回来', () => {
  const bases = [squad(6)]
  scene.reset(bases, [62, 7, 7])
  const handlers = []
  let renders = 0
  scene.bindFleetPanelDelegates({ addEventListener: (kind, fn) => { if (kind === 'click') handlers.push(fn) } }, () => {}, () => { renders++ })
  const click = () => {
    const button = { dataset: { areaId: '6' } }
    const event = { target: { closest: (selector) => selector === '[data-act="air-base-mute"]' ? button : null } }
    handlers.forEach((fn) => fn(event))
  }
  click()
  assert.deepEqual(scene.writes, [['ru.airBase.muted', [6, 7, 62]]])
  assert.equal(renders, 1)
  assert.match(scene.airBaseAreaHtml(6, bases), /已静默 · 恢复提示/)
  click()
  assert.deepEqual(scene.writes[1], ['ru.airBase.muted', [7, 62]])
  assert.equal(renders, 2)
  assert.match(scene.airBaseAreaHtml(6, bases), /需要补给/)
  assert.match(scene.airBaseHeaderHtml(), /待补给 <b>1<\/b>/)
  assert.match(scene.fleetTabsHtml(900), /glow-warn/)
  scene.warnOnEventMapOpen(6, 10000)
  assert.equal(scene.toasts.length, 1)
})
