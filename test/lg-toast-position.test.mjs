// 弹卡落点可配（产品人 2026-08-29 定：游戏画面 / kuma 窗口 / 整块屏幕 各四角）。
//
// 这一份大半是**行为级**的：真造一张弹卡，看它最后挂在谁身上、认的是哪个角。
// 「读配置」这件事写反了源码文本照样匹配得上（把 anchor 那一路读成 corner，
// 正则一个字都不会红，而玩家那边是「点了没反应」），所以判据落在真跑一遍的结果上。
// 只有几何那一小段用源码文本——四个角的偏移是 CSS 说了算的，假 DOM 里没有布局。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { mountLgToast } from './fixtures/render-lg-toast.mjs'
import shared from '../dist/shared/toast-position.js'

const {
  readToastPosition,
  TOAST_ANCHOR_LABEL,
  TOAST_ANCHORS,
  TOAST_ANCHORS_READY,
  TOAST_CORNER_LABEL,
  TOAST_CORNERS,
  TOAST_POSITION_DEFAULTS,
  TOAST_POSITION_PATHS,
} = shared

const readWith = (stored) =>
  readToastPosition((path, fallback) => (path in stored ? stored[path] : fallback))

test('弹卡落点:一个键都没存过时,还是可配之前那个位置', () => {
  // 升级的人不该看出任何变化：游戏画面的右下角（用户 2026-08-11 定的）
  assert.deepEqual(readWith({}), { anchor: 'game', corner: 'br' })

  const lg = mountLgToast({ gameWrapper: true })
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  assert.equal(lg.boxHost(), 'game-wrapper', '默认没挂进游戏画面')
  assert.equal(lg.boxCorner(), 'br', '默认不是右下角')
})

test('弹卡落点:选 kuma 窗口就挂 body,游戏容器在场也不占用它', () => {
  const lg = mountLgToast({
    gameWrapper: true,
    config: { [TOAST_POSITION_PATHS.anchor]: 'app', [TOAST_POSITION_PATHS.corner]: 'tl' },
  })
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  assert.equal(lg.boxHost(), 'body')
  assert.equal(lg.boxCorner(), 'tl')
})

test('弹卡落点:四个角逐个都认,参照系不跟着变', () => {
  for (const corner of TOAST_CORNERS) {
    const lg = mountLgToast({
      gameWrapper: true,
      config: { [TOAST_POSITION_PATHS.corner]: corner },
    })
    lg.show('第1舰队有中破', '旗舰中破', 1, false)
    assert.equal(lg.boxCorner(), corner, `${corner} 这一角没落上`)
    assert.equal(lg.boxHost(), 'game-wrapper', `${corner} 把参照系也带跑了`)
  }
})

test('弹卡落点:选了游戏画面但容器被收起,退回 body 而不是跟着隐身', () => {
  // clientWidth=0 就是「游戏区被收起/还没就绪」那一档
  const lg = mountLgToast({
    gameWrapper: 0,
    config: { [TOAST_POSITION_PATHS.anchor]: 'game', [TOAST_POSITION_PATHS.corner]: 'tr' },
  })
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  assert.equal(lg.boxHost(), 'body', '游戏容器收起时通知跟着一起没了')
  assert.equal(lg.boxCorner(), 'tr', '退回 body 时把角落也丢了')
})

test('弹卡落点:改了设置,已经挂着的那一摞当场搬过去,卡不丢', () => {
  const lg = mountLgToast({ gameWrapper: true })
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  assert.equal(lg.boxHost(), 'game-wrapper')
  const card = lg.toast()

  // 界面上点一下参照系写的就是这一句（键与值同出一个元素，见 lg.ts 的 data-toast-part）
  lg.config.set(TOAST_POSITION_PATHS.anchor, 'app')
  lg.config.set(TOAST_POSITION_PATHS.corner, 'bl')
  lg.show('第2舰队疲劳', '橙脸出击', 2, false)
  assert.equal(lg.boxHost(), 'body', '换了参照系那一摞没搬家')
  assert.equal(lg.boxCorner(), 'bl')
  // 那一摞是整块搬过去的：已经在显示的卡还是原来那张（同类第二条照旧折进它）
  assert.equal(lg.toast(), card, '搬家把已经在显示的通知弄丢了')
  assert.equal(card.querySelector('.tx b').textContent, '出击前状态 ×2')
})

test('弹卡落点:还没实装的参照系与乱值都退回默认,弹卡永远有归宿', () => {
  // 「整块屏幕」界面上是灰的，但配置文件是人能手改的——存进来照样不能让弹卡没地方去
  assert.ok(!TOAST_ANCHORS_READY.includes('screen'), '整块屏幕成了可用档,这条守卫要跟着改')
  assert.equal(readWith({ [TOAST_POSITION_PATHS.anchor]: 'screen' }).anchor, 'game')
  assert.equal(readWith({ [TOAST_POSITION_PATHS.anchor]: '左上' }).anchor, 'game')
  assert.equal(readWith({ [TOAST_POSITION_PATHS.corner]: 'middle' }).corner, 'br')
  assert.equal(readWith({ [TOAST_POSITION_PATHS.corner]: null }).corner, 'br')
  // 一边坏不该把另一边也带下水
  assert.deepEqual(readWith({ [TOAST_POSITION_PATHS.anchor]: 'screen', [TOAST_POSITION_PATHS.corner]: 'tl' }), {
    anchor: 'game',
    corner: 'tl',
  })

  const lg = mountLgToast({ gameWrapper: true, config: { [TOAST_POSITION_PATHS.anchor]: 'screen' } })
  lg.show('第1舰队有中破', '旗舰中破', 1, false)
  assert.equal(lg.boxHost(), 'game-wrapper')
  assert.equal(lg.toasts().length, 1, '存了个做不出来的落点,弹卡就没了')
})

test('弹卡落点:每个参照系与每个角都有玩家看得懂的名字', () => {
  for (const id of TOAST_ANCHORS) assert.ok(TOAST_ANCHOR_LABEL[id], `${id} 没有名字`)
  for (const id of TOAST_CORNERS) assert.ok(TOAST_CORNER_LABEL[id], `${id} 没有名字`)
  assert.ok(TOAST_ANCHORS.includes(TOAST_POSITION_DEFAULTS.anchor))
  assert.ok(TOAST_CORNERS.includes(TOAST_POSITION_DEFAULTS.corner))
})

test('弹卡落点:四个角的偏移在 CSS 里都摆得出来', () => {
  // ---- 为什么这一段用源码文本（家法要求注明理由）----
  // 钉的是**几何**：贴哪条边是 CSS 说了算的，假 DOM 里没有布局，量不出来。
  // 「哪个角生效」那一半上面已经真跑过了。
  const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const rule = (selector) =>
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(html)?.[0]

  assert.match(rule('#lg-toasts[data-corner$="l"]') ?? '', /left: 12px/, '左两角没贴左边')
  assert.match(rule('#lg-toasts[data-corner$="r"]') ?? '', /right: 12px/, '右两角没贴右边')
  assert.match(rule('#lg-toasts[data-corner^="b"]') ?? '', /bottom: 12px/, '下两角没贴下边')
  // kuma 窗口的上两角要让开顶栏（34px）——不让就压在顶栏按钮上
  assert.match(rule('#lg-toasts[data-corner^="t"]') ?? '', /top: 42px/, '上两角没让开顶栏')
  // 游戏画面里没有顶栏，让开那 42px 就成了凭空一道空当
  assert.match(
    rule('#game-wrapper > #lg-toasts[data-corner^="t"]') ?? '',
    /top: 12px/,
    '游戏画面里的上两角没把顶栏那档让位撤掉',
  )
  // 基础规则里不许再写死某一条边，否则四角互相打架
  const base = rule('#lg-toasts')
  assert.ok(base, '#lg-toasts 那条基础规则不见了')
  assert.doesNotMatch(base, /right:|bottom:|left:|top:/, '基础规则里还钉着某一条边')
  // 试听条只占右下角，抬高那一档不该跟去别的角
  assert.match(html, /body\.kuma-preview-on #lg-toasts\[data-corner="br"\] \{ bottom: 54px; \}/)
})
