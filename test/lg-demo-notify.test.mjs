// ▶ 测试通知是**纯演示**（用户 2026-08-30 定）：玩家点它是想看弹窗落在哪一角、
// 横幅长什么样，不是要在账本里添三行，更不是要把自己的手机叫醒
// （三条里的「远征返港」默认就开着手机推送，从前点一下测试按钮它是真推的）。
//
// 这一份全是**行为级**断言：三条演示真弹一遍，然后数账本、托盘徽标、ipc 三处。
// 「不落账、不推手机」这类判定写反了，只断言源码文本的护栏照样全绿
// （见 ~/.agents/memory 的 source-pattern-guards-miss-logic-bugs）。
// 反过来，「一次都没调」这种断言若是因为演示压根没跑起来才成立，那就是假绿——
// 所以每条都先验「展示层真的动了」（横幅/弹卡在），再验那三样一次没动。
import assert from 'node:assert/strict'
import test from 'node:test'

import { mountLgToast } from './fixtures/render-lg-toast.mjs'

/** 三条演示：第一条当场发，另两条错开 450 / 900ms 挂在计时器上 */
const runDemo = (lg) => {
  lg.demo()
  lg.fireTimers()
}

test('测试通知:该弹的照弹——新舰与大破上横幅,远征落弹卡', () => {
  const lg = mountLgToast()
  runDemo(lg)

  // 新舰（庆祝）与大破（警示）各一张置顶横幅；大破被横幅接管后不再另叠弹卡
  assert.equal(lg.banners().length, 2, '两张置顶横幅没出来')
  assert.deepEqual(
    lg.banners().map((banner) => banner.dataset.bannerId != null),
    [true, true],
    '横幅没挂本地键，关不掉',
  )
  // 远征那条没有横幅色调，走的是右下弹卡
  assert.equal(lg.toasts().length, 1, '远征那条演示没弹出来')
  assert.equal(lg.toast().dataset.event, 'expedition')
  // 外框光效也照常跟着横幅走（红优先）
  assert.ok(lg.bodyClasses().includes('lg-frame-red'), '大破的外框红光没亮')
})

test('测试通知:不写通知历史,不点未读徽标,不推手机', () => {
  const lg = mountLgToast()
  runDemo(lg)

  // 先确认展示层真的走完了——否则下面三条「一次都没有」只是没跑起来
  assert.equal(lg.banners().length, 2)
  assert.equal(lg.toasts().length, 1)

  assert.deepEqual(lg.appendNoticeCalls(), [], '演示往账本里写了通知历史')
  assert.deepEqual(lg.trayUnreadCalls(), [], '演示点了未读徽标（托盘那份与面板红点同源）')
  assert.deepEqual(
    lg.invokeCalls().filter(([channel]) => channel === 'push:send'),
    [],
    '演示把通知推到手机上了',
  )
  // 出网入口只有 push:send 一处，但演示这一路干脆一个 ipc 都不该发
  assert.deepEqual(lg.invokeCalls(), [], '演示途中发了 ipc')
})

test('测试通知:出击勿扰期间照样当场弹出来', () => {
  const lg = mountLgToast()
  // 出击中＝自动勿扰。非出击自身产生的非阻断真事件会被攒进暂留队列，等归港再一口气送达；
  // 演示不行——玩家专门点了那个按钮就是要当场看见效果。
  lg.mg.sortie = { active: true, practice: false }
  runDemo(lg)

  assert.equal(lg.banners().length, 2, '勿扰把演示的横幅也扣下了')
  assert.equal(lg.toasts().length, 1, '勿扰把演示的弹卡扣下了')
  assert.deepEqual(lg.appendNoticeCalls(), [], '演示往账本里写了通知历史')
  assert.deepEqual(lg.invokeCalls(), [], '演示途中发了 ipc')
})
