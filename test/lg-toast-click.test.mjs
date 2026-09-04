// 右下弹卡的点击语义（用户 2026-08-27 定）：
// **卡面任意位置点了只是关闭，只有「→ ××」那行字点了才跳转**。
//
// 从前整张卡都是跳转热区，于是最常见的那个动作——顺手把一条看过的通知划掉——
// 会把人弹到别的面板去。关掉一条通知与去处理它是两件事，不该共用一个热区。
//
// 这一份全是**行为级**断言：卡真造出来、点真派发一遍（冒泡与 stopPropagation 都算数）。
// 理由见 test/fixtures/render-lg-toast.mjs 的头注——两个回调对调，源码文本照样匹配得上。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { mountLgToast } from './fixtures/render-lg-toast.mjs'

test('强化成功弹卡:点卡面只关闭,不跳转', () => {
  const lg = mountLgToast()
  lg.mg.master.ships[601] = { name: '叢雲' }
  lg.showPowerup({ ts: 1, rosterId: 3813, mstId: 601, stats: [] })
  assert.equal(lg.toasts().length, 1, '强化成功弹卡没造出来')

  lg.click(lg.toast().querySelector('.tx b'))
  assert.deepEqual(lg.navigateCalls(), [], '点强化成功卡面竟然跳到了舰娘')
  assert.equal(lg.toasts().length, 0, '点了强化成功卡面却没关掉')
})

test('强化成功弹卡:只有「→ 查看这艘舰」跳转,且只关闭一次', () => {
  const lg = mountLgToast()
  lg.mg.master.ships[601] = { name: '叢雲' }
  lg.showPowerup({ ts: 1, rosterId: 3813, mstId: 601, stats: [] })
  const card = lg.toast()

  lg.click(card.querySelector('.tx .act'))
  assert.deepEqual(lg.navigateCalls(), [{ type: 'ship', id: 3813 }], '点查看入口没跳到这艘舰')
  assert.equal(lg.toasts().length, 0, '跳转之后强化成功弹卡该跟着关掉')
  assert.equal(card.removeCalls, 1, '查看入口没拦住冒泡，卡面监听器又关闭了一次')
})

test('弹卡:点卡面只关闭,不跳转', () => {
  const lg = mountLgToast()
  lg.show('第1舰队有中破', '旗舰中破，出击前先看一眼', 1, false)
  assert.equal(lg.toasts().length, 1, '弹卡没造出来')

  const card = lg.toast()
  // 点在卡面上（图标、标题、正文都算卡面——这里点最容易误触的那一处：标题）
  lg.click(card.querySelector('.tx b'))
  assert.deepEqual(lg.navigateCalls(), [], '点卡面竟然走了实体路由')
  assert.deepEqual(lg.activateCalls(), [], '点卡面竟然切了面板')
  assert.equal(lg.toasts().length, 0, '点了卡面却没关掉')

  // 卡片本体也一样（点在图标与文字之间的空隙上）
  lg.show('第2舰队疲劳', '橙脸出击', 2, false)
  lg.click(lg.toast())
  assert.deepEqual(lg.navigateCalls(), [])
  assert.deepEqual(lg.activateCalls(), [])
  assert.equal(lg.toasts().length, 0)
})

test('弹卡:只有「→ ××」那行字点了才跳转,跳完照样关掉', () => {
  const lg = mountLgToast()
  lg.show('第1舰队有中破', '旗舰中破，出击前先看一眼', 1, false)
  const act = lg.toast().querySelector('.tx .act')
  // 那行字写的是它真要去的地方（带 ref 时走实体路由，标签是「检查第N舰队」）
  assert.equal(act.textContent, '→ 检查第1舰队')

  const card = lg.toast()
  lg.click(act)
  assert.deepEqual(lg.navigateCalls(), [{ type: 'fleet', id: 1 }], '点「→ ××」没跳到那支舰队')
  assert.equal(lg.toasts().length, 0, '跳转之后弹卡该跟着关掉')
  assert.deepEqual(lg.activateCalls(), [], '带 ref 时不该再退回模块级')
  // 跳转这一路必须自己拦下冒泡：不拦的话卡面那条「只关闭」会跟着再关一次。
  // 两次关闭在画面上看不出区别（第二次是空操作），所以这里数的是**动作次数**。
  assert.equal(card.removeCalls, 1, '冒泡没拦住，卡面那条监听器也跟着跑了一遍')
})

test('弹卡:合并之后监听器还在,且点「→ ××」退回模块级落点', () => {
  const lg = mountLgToast()
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  lg.show('第1舰队有中破', '二号舰也中破了', 1, false)
  // 同类非锁定的第二条折进同一张卡（正文换最新一条）
  assert.equal(lg.toasts().length, 1, '同类通知没合并')
  const card = lg.toast()
  assert.equal(card.querySelector('.tx b').textContent, '出击前状态 ×2')

  // 合并卡指向的是模块总览而不是第一条的详情，那行字也跟着退回去。
  // **合并时只改 textContent、不重建节点**——重建就把监听器丢了，这一点是本条的要害。
  const act = card.querySelector('.tx .act')
  assert.equal(act.textContent, '→ 检查第1舰队')
  lg.click(act)
  assert.deepEqual(lg.activateCalls(), ['ru'], '合并卡点「→ ××」没落到模块级')
  assert.deepEqual(lg.navigateCalls(), [], '合并卡不该再指向第一条的实体')
  assert.equal(lg.toasts().length, 0)
})

test('弹卡:锁定级不自动超时,但手动点一下同样关得掉', () => {
  const lg = mountLgToast()
  lg.show('第1舰队大破', '大破进击会沉', 1, true)
  const card = lg.toast()
  assert.equal(card.dataset.locked, '1', '锁定级没打上记号')

  // 「需手动关闭」承诺的是不自动超时：催一遍计时器它还在
  lg.fireTimers()
  assert.equal(lg.toasts().length, 1, '锁定级被自动关掉了')

  // 但手动点掉本来就在允许之列，卡面这一下同样只关不跳
  lg.click(card.querySelector('.tx b'))
  assert.equal(lg.toasts().length, 0, '锁定级的卡面点不掉')
  assert.deepEqual(lg.navigateCalls(), [])
  assert.deepEqual(lg.activateCalls(), [])
})

test('弹卡:右上角那枚 ✕ 照旧只关不跳', () => {
  const lg = mountLgToast()
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  const card = lg.toast()
  // 锁定级那句「需手动关闭」是给 ✕ 的文案，非锁定卡写「关闭」——这一改不动它
  assert.equal(card.querySelector('.x').getAttribute('title'), '关闭')
  lg.click(card.querySelector('.x'))
  assert.equal(lg.toasts().length, 0)
  assert.deepEqual(lg.navigateCalls(), [])
  assert.deepEqual(lg.activateCalls(), [])
})

test('弹卡:「→ ××」的点击热区比那行 10px 的字大一圈,且排版一像素没动', () => {
  // ---- 为什么这一条用源码文本（家法要求注明理由）----
  // 钉的是**样式**：热区大小是 CSS 说了算的，假 DOM 里没有布局，量不出来。
  // 语义那一半已经在上面几条里真点过了。
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const act = /\.lg-toast \.tx \.act \{[^}]*\}/.exec(html)?.[0]
  assert.ok(act, '.lg-toast .tx .act 那条规则不见了')
  // 它现在是整张卡上唯一的跳转热区，10px 的字点不中——padding 撑开一圈
  assert.match(act, /padding: 3px 4px/, '跳转热区没撑开')
  // 撑开的那几像素由等量负 margin 抵回去：文字位置与卡片高度都照旧
  assert.match(act, /margin: -1px -4px -3px/, '负 margin 没抵掉，排版会跟着变')
  assert.match(act, /cursor: pointer/, '跳转热区没给手型')
  // 卡面仍是手型——含义从「点了跳转」变成了「点了关闭」，但它照旧可点
  assert.match(html, /\.lg-toast \{[^}]*cursor: pointer/)
})
