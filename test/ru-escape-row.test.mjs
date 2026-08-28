// 锐的「退场」态：退避的舰在编成里退到幕后——失色、让开一小段、挂一枚「退避」小标，
// 位置原样占着（下面的舰一格都不跳）。语义是「她已经离开战场」，**不是沉了**。
//
// 两件事各有各的坑：
//   · **从状态推导** —— 重开界面、重画多少次，读同一份 state 都得同一个答案；
//     返港（active 落下）自动恢复正常，没有「忘了复位」这条路。
//   · **一次性动画** —— 锐的整段 HTML 每次 HP 变化都会重渲（输出闸门只挡「一个字节
//     都没变」的那种）。离场动画若挂成常态类，她会在整趟出击里一遍遍滑出去。
//     所以 `.leaving` 只在状态翻转的那一次出现，之后只剩静态的 `.left`。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { renderRow, reset, setSortie } from './fixtures/render-ru-row.mjs'

const SHIP = { id: 102, shipId: 2, lv: 88, nowhp: 9, maxhp: 40 }
const NAMES = { 2: '鈴谷改二', 11: '由良改二' }

const escapedSortie = (role = 'escaped', patch = {}) => ({
  active: true,
  practice: false,
  escaped: [{ rosterId: 102, mstId: 2, name: '鈴谷改二', role, cell: 9, ts: 1_700_000_000_000 }],
  ...patch,
})

test('退避的舰进退场态：带「退避」小标、悬停说清楚她还在，只是不参战了', () => {
  reset({ sortie: escapedSortie(), names: NAMES })
  const html = renderRow(SHIP)
  assert.match(html, /class="ship left leaving/)
  assert.match(html, /data-escaped="escaped"/)
  assert.match(html, /<span class="esc-tag">退避<\/span>/)
  assert.match(html, /title="退避中，返港前不再参战"/)
  // 与碎裂卡拉开距离：不裂、不当她沉了
  assert.ok(!html.includes('shattered'))
  assert.ok(!html.includes('data-sunk'))
  // 大破的红底让位给退场态——她已经不在战场上了，那句警示说的不是她
  assert.ok(!/class="ship[^"]*\bcrit\b/.test(html))
})

test('护卫舰标「护卫」，同样退场', () => {
  reset({ sortie: escapedSortie('tow'), names: NAMES })
  const html = renderRow(SHIP)
  assert.match(html, /data-escaped="tow"/)
  assert.match(html, /<span class="esc-tag">护卫<\/span>/)
  assert.match(html, /class="ship left leaving/)
})

test('卡内只有那两个字，不放解释', () => {
  reset({ sortie: escapedSortie(), names: NAMES })
  const tag = renderRow(SHIP).match(/<span class="esc-tag">(.*?)<\/span>/)
  assert.ok(tag)
  assert.equal(tag[1], '退避')
})

test('一次性动画：同一份 state 渲两次，第二次不带 .leaving', () => {
  reset({ sortie: escapedSortie(), names: NAMES })
  assert.match(renderRow(SHIP), /class="ship left leaving/)
  const again = renderRow(SHIP)
  assert.match(again, /class="ship left"/)
  assert.ok(!again.includes('leaving'), '每次重渲都重播离场动画——HP 一变她就再滑一次')
  // 静态态一个字都不少
  assert.match(again, /<span class="esc-tag">退避<\/span>/)
  assert.match(again, /data-escaped="escaped"/)
})

test('返港后恢复正常：退场态整个撤掉，不需要动画', () => {
  reset({ sortie: escapedSortie(), names: NAMES })
  renderRow(SHIP)
  reset({ sortie: escapedSortie('escaped', { active: false }), names: NAMES })
  const html = renderRow(SHIP)
  assert.ok(!html.includes('esc-tag'))
  assert.ok(!html.includes('data-escaped'))
  assert.ok(!/class="ship[^"]*\bleft\b/.test(html))
  // 血还是大破，那条红底该回来了
  assert.match(html, /class="ship crit/)
})

test('返港后再退一次照样播：记忆随状态自己落下，不是一辈子只播一次', () => {
  reset({ sortie: escapedSortie(), names: NAMES })
  assert.match(renderRow(SHIP), /leaving/) // 第一趟：播过了
  assert.ok(!renderRow(SHIP).includes('leaving'))
  // 返港。这里**故意不清**那份记忆——要证明的正是它随状态自己落，
  // 而不是靠哪一处记得去复位。
  setSortie(escapedSortie('escaped', { active: false }))
  renderRow(SHIP)
  // 下一趟又退避
  setSortie(escapedSortie())
  assert.match(renderRow(SHIP), /class="ship left leaving/)
})

test('演习不算退避：那里没有退避这回事', () => {
  reset({ sortie: escapedSortie('escaped', { practice: true }), names: NAMES })
  const html = renderRow(SHIP)
  assert.ok(!html.includes('esc-tag'))
})

test('沉了优先于退避：碎裂卡不该被退场态盖掉', () => {
  reset({ sortie: escapedSortie(), names: NAMES, sunk: [102] })
  const html = renderRow(SHIP)
  assert.match(html, /class="ship shattered/)
  assert.match(html, /data-sunk="1"/)
  assert.ok(!html.includes('esc-tag'), '既沉又退避是坏状态，这时以「沉了」为准')
})

// 这一节是**文本检查**，而且只能是文本检查：上面那些用例断言的是「类挂对了没有」，
// 一个都答不上「这几个类到底有没有样式」。整段 CSS 漏了或被误删，产物 HTML 一模一样。
test('退场态的样式真在样式表里，且减少动态效果时会落到静态态', () => {
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('.fleet-skin .ship.left {'), '退场态静态样式没了')
  assert.ok(html.includes('.fleet-skin .ship.left.leaving {'), '一次性离场动画没了')
  assert.ok(html.includes('@keyframes ru-escape-out'), '离场动画的关键帧没了')
  assert.ok(html.includes('.fleet-skin .ship.left .esc-tag {'), '「退避 / 护卫」小标没了')
  // 减少动态效果：仓里已有的做法是在那个 media 块里逐条列出来
  const reduced = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce) {'))
  assert.ok(
    reduced.slice(0, reduced.indexOf('animation: none;')).includes('.fleet-skin .ship.left.leaving'),
    '减少动态效果时离场动画没被撤掉',
  )
})

test('没退避的舰一个字都不多', () => {
  reset({ sortie: { active: true, practice: false, escaped: [] }, names: NAMES })
  const html = renderRow(SHIP)
  assert.ok(!html.includes('esc-tag'))
  assert.ok(!html.includes('data-escaped'))
  assert.ok(!html.includes('leaving'))
  // 没在出击时同理
  reset({ sortie: null, names: NAMES })
  assert.ok(!renderRow(SHIP).includes('esc-tag'))
})
