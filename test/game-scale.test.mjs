// 游戏画面缩放两档（2026-08-30，玩家报「自适应落在非整数倍率时画面糊」）。
//
// 守两件事：
//  ① **自适应那一支一字没动**。它是老玩家眼下看到的样子，改这一单不许把它带偏——
//     稳态宽度与拖分隔条期间那个 scale 都拿同一份判据算，两处各自与旧公式对齐。
//  ② **锁定档不裁画面**。装不下就按档退，退到底才回自适应；任何一档都不许溢出可用区
//     （#game-area 是 overflow:hidden，溢出的那部分是直接没了，不会有任何提示）。
import assert from 'node:assert/strict'
import test from 'node:test'

import gameScale from '../dist/shared/game-scale.js'
import sections from '../dist/shared/settings-sections.js'
import { cardHtml, cardsIn, mountYu } from './fixtures/render-yu.mjs'

const {
  GAME_HEIGHT,
  GAME_SCALE_DEFAULTS,
  GAME_SCALE_MODE_LABEL,
  GAME_SCALE_MODES,
  GAME_SCALE_PATHS,
  GAME_SCALE_STEPS,
  GAME_WIDTH,
  computeGameLayout,
  normalizeGameScaleMode,
  normalizeGameScaleStep,
} = gameScale
const { SETTINGS_SECTION_UI_KEY, settingsSectionOf } = sections

const layout = (over = {}) =>
  computeGameLayout({
    areaWidth: 1600,
    areaHeight: 900,
    mode: 'fit',
    lockStep: 1,
    uiZoom: 1,
    ...over,
  })

/**
 * 可配之前那条：宽取「区宽」与「区高 × 5/3」的小者。
 * 乘法的次序照抄样式表里那条 `min(100cqw, calc(100cqh * (1200 / 720)))`——
 * 先约比例再乘高，与先乘后除差一个末位，逐字同值就要连次序一起对。
 */
const legacyFitWidth = (areaWidth, areaHeight) =>
  Math.min(areaWidth, areaHeight * (GAME_WIDTH / GAME_HEIGHT))

// ---- ① 判据与默认值 ----

test('默认就是从前那一档：自适应、主档 100%', () => {
  assert.equal(GAME_SCALE_DEFAULTS.mode, 'fit')
  assert.equal(GAME_SCALE_DEFAULTS.step, 1)
  assert.deepEqual([...GAME_SCALE_MODES], ['fit', 'lock'])
  assert.equal(GAME_WIDTH, 1200)
  assert.equal(GAME_HEIGHT, 720)
  // 叶子路径：整对象读会读到 setByPath 留下的半份对象，从此不再回落默认值
  assert.equal(GAME_SCALE_PATHS.mode, 'kuma.gameScale.mode')
  assert.equal(GAME_SCALE_PATHS.step, 'kuma.gameScale.step')
})

test('档位表升序、含主档 1，且每一档都能被判据认回来', () => {
  const steps = [...GAME_SCALE_STEPS]
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b), '档位表不是升序')
  assert.ok(steps.includes(1), '主档 100% 不在表里')
  for (const step of steps) assert.equal(normalizeGameScaleStep(step), step)
})

test('认不出的模式/档位一律回默认，不画一个没人选过的倍率', () => {
  assert.equal(normalizeGameScaleMode('lock'), 'lock')
  for (const bogus of ['', 'LOCK', 'fitted', null, undefined, 7, {}]) {
    assert.equal(normalizeGameScaleMode(bogus), 'fit')
  }
  assert.equal(normalizeGameScaleStep('1.5'), 1.5, '字符串数字该被认回来')
  for (const bogus of ['', 'x', null, undefined, 0, -1, 1.1, 3, NaN, {}]) {
    assert.equal(normalizeGameScaleStep(bogus), 1)
  }
})

// ---- ② 自适应回归 ----

test('自适应：宽度与可配之前那条公式逐档同值', () => {
  for (const [areaWidth, areaHeight] of [
    [1600, 900],
    [1200, 900],
    [1920, 1000],
    [800, 700],
    [1000, 300],
    [377.4, 611.9],
  ]) {
    const got = layout({ areaWidth, areaHeight })
    assert.equal(got.width, legacyFitWidth(areaWidth, areaHeight), `${areaWidth}×${areaHeight}`)
    assert.equal(got.height, got.width / (GAME_WIDTH / GAME_HEIGHT))
    assert.equal(got.locked, false)
    assert.equal(got.step, null)
    // 装不下永远不裁：两个方向都不许超出可用区
    assert.ok(got.width <= areaWidth + 1e-9 && got.height <= areaHeight + 1e-9)
  }
})

test('自适应：拖分隔条期间那个 scale 与旧写法逐档同值', () => {
  // 旧写法：min(区宽 / 冻结宽, 区高 / 冻结高)。冻结下来的那块本身就是 5:3，
  // 所以它与「新宽 ÷ 冻结宽」是同一个数——这条等式就是「拖动手感没变」的凭据
  for (const frozenWidth of [900, 1200, 1487.5]) {
    const frozenHeight = (frozenWidth * GAME_HEIGHT) / GAME_WIDTH
    for (const [areaWidth, areaHeight] of [
      [1600, 900],
      [1000, 900],
      [1600, 500],
      [420, 260],
    ]) {
      const legacy = Math.min(areaWidth / frozenWidth, areaHeight / frozenHeight)
      const now = layout({ areaWidth, areaHeight }).width / frozenWidth
      assert.ok(
        Math.abs(legacy - now) < 1e-12,
        `冻结 ${frozenWidth} · 区 ${areaWidth}×${areaHeight}：${legacy} vs ${now}`,
      )
    }
  }
})

test('自适应：倍率就是 webview 该拿到的 zoomFactor，界面缩放要乘进去', () => {
  const got = layout({ areaWidth: 600, areaHeight: 900, uiZoom: 1.15 })
  assert.equal(got.width, 600)
  assert.equal(got.scale, (600 * 1.15) / 1200)
})

test('自适应：黑边只长在被卡住的那一边', () => {
  const wide = layout({ areaWidth: 1600, areaHeight: 600 }) // 高卡住
  assert.equal(wide.barY, 0)
  assert.ok(wide.barX > 0)
  const tall = layout({ areaWidth: 1000, areaHeight: 900 }) // 宽卡住
  assert.equal(tall.barX, 0)
  assert.ok(tall.barY > 0)
})

// ---- ③ 锁定档：居中、黑边、装不下怎么退 ----

test('锁定 100%：游戏的 1200×720 逻辑像素占同样多的屏上 CSS 像素，四周黑边居中', () => {
  const got = layout({ areaWidth: 1600, areaHeight: 900, mode: 'lock', lockStep: 1 })
  assert.equal(got.locked, true)
  assert.equal(got.step, 1)
  assert.equal(got.scale, 1)
  assert.equal(got.width, 1200)
  assert.equal(got.height, 720)
  assert.equal(got.barX, 200)
  assert.equal(got.barY, 90)
})

test('锁定档的 wrapper 宽要除掉界面缩放，倍率才落在选中的那一档上', () => {
  const got = layout({ areaWidth: 1600, areaHeight: 900, mode: 'lock', lockStep: 1, uiZoom: 1.15 })
  assert.equal(got.locked, true)
  assert.equal(got.width, 1200 / 1.15)
  // 镇壳算 zoomFactor 用的就是这一式：宽 × 界面缩放 ÷ 1200
  assert.ok(Math.abs((got.width * 1.15) / GAME_WIDTH - 1) < 1e-12)
})

test('锁定档逐档居中：黑边两侧等分，画面永远不溢出可用区', () => {
  for (const step of GAME_SCALE_STEPS) {
    const areaWidth = 2600
    const areaHeight = 1600
    const got = layout({ areaWidth, areaHeight, mode: 'lock', lockStep: step })
    assert.equal(got.locked, true, `${step} 在 ${areaWidth}×${areaHeight} 里该装得下`)
    assert.equal(got.step, step)
    assert.equal(got.width, step * GAME_WIDTH)
    assert.equal(got.barX, (areaWidth - got.width) / 2)
    assert.equal(got.barY, (areaHeight - got.height) / 2)
    assert.ok(got.width <= areaWidth && got.height <= areaHeight)
  }
})

test('刚好装得下就算装得下：一格不多的可用区不许把整档判掉', () => {
  const exact = layout({ areaWidth: 1200, areaHeight: 720, mode: 'lock', lockStep: 1 })
  assert.equal(exact.locked, true)
  assert.equal(exact.barX, 0)
  assert.equal(exact.barY, 0)
  // 浮点尾数级别的差额同样算装得下（布局粒度是 1/64 CSS px，画不出来）
  const hair = layout({
    areaWidth: 1200 - 1e-9,
    areaHeight: 720 - 1e-9,
    mode: 'lock',
    lockStep: 1,
  })
  assert.equal(hair.locked, true)
})

test('装不下就按档往下退，退到还装得下的最大一档', () => {
  // 1100 宽装不下 100%（1200），750 高装得下 75%（540）
  const got = layout({ areaWidth: 1100, areaHeight: 750, mode: 'lock', lockStep: 1.5 })
  assert.equal(got.locked, true)
  assert.equal(got.step, 0.75)
  assert.equal(got.scale, 0.75)
  assert.equal(got.width, 900)
  assert.equal(got.height, 540)
})

test('退档只往下不往上：选了小档就不许自作主张放大', () => {
  const got = layout({ areaWidth: 2600, areaHeight: 1600, mode: 'lock', lockStep: 0.75 })
  assert.equal(got.step, 0.75)
  assert.equal(got.width, 900)
})

test('高度不够照样退档：横向够宽也不许把画面下半截裁掉', () => {
  const got = layout({ areaWidth: 2600, areaHeight: 700, mode: 'lock', lockStep: 2 })
  assert.equal(got.locked, true)
  assert.equal(got.step, 0.75)
  assert.ok(got.height <= 700)
})

test('一档都装不下就回自适应：宁可倍率不整，也不裁画面、不出滚动条', () => {
  for (const [areaWidth, areaHeight] of [
    [800, 700],
    [2600, 400],
    [0, 0],
  ]) {
    const got = layout({ areaWidth, areaHeight, mode: 'lock', lockStep: 2 })
    assert.equal(got.locked, false, `${areaWidth}×${areaHeight} 不该算成锁定`)
    assert.equal(got.step, null)
    assert.equal(got.width, legacyFitWidth(areaWidth, areaHeight))
    assert.ok(got.width <= areaWidth + 1e-9 && got.height <= areaHeight + 1e-9)
  }
})

test('负数尺寸不产出负宽：面板还没摆开时读到的就是这种数', () => {
  const got = layout({ areaWidth: -10, areaHeight: -10, mode: 'lock', lockStep: 1 })
  assert.equal(got.locked, false)
  assert.equal(got.width, 0)
  assert.equal(got.height, 0)
})

test('自适应模式下选中的档位一律不参与计算', () => {
  for (const step of GAME_SCALE_STEPS) {
    assert.deepEqual(layout({ lockStep: step }), layout({ lockStep: 1 }))
  }
})

// ---- ④ 钥里那张卡 ----

const UI = { [SETTINGS_SECTION_UI_KEY]: 'ui' }
const cardOf = (yu) => cardHtml(yu.pane.innerHTML, 'game-scale')

test('卡摆在「界面」类里，紧跟外观且位于界面缩放之后', () => {
  assert.equal(settingsSectionOf('game-scale'), 'ui')
  const cards = cardsIn(mountYu({ ui: UI }).pane.innerHTML)
  assert.equal(cards[cards.indexOf('game-scale') - 1], 'theme')
  assert.ok(cards.indexOf('zoom') < cards.indexOf('game-scale'))
})

test('没改过的人开出来仍是自适应，档位那一行不摆', () => {
  const card = cardOf(mountYu({ ui: UI }))
  assert.match(card, /data-game-scale-mode="fit"[^>]*>自适应/)
  assert.match(card, /class="ychip on" data-game-scale-mode="fit"/)
  assert.equal(/data-game-scale-step/.test(card), false, '自适应下摆着一行用不上的档位')
})

test('选固定倍率：档位那一行出来，选中的那一档亮着', () => {
  const yu = mountYu({
    ui: UI,
    config: { [GAME_SCALE_PATHS.mode]: 'lock', [GAME_SCALE_PATHS.step]: 1.5 },
  })
  const card = cardOf(yu)
  assert.match(card, /class="ychip on" data-game-scale-mode="lock"/)
  assert.match(card, /class="ychip on" data-game-scale-step="1.5">150%</)
  for (const step of GAME_SCALE_STEPS) {
    assert.ok(card.includes(`data-game-scale-step="${step}"`), `${step} 这一档没摆出来`)
  }
})

test('点一下就落盘，也当场重画：换模式那一行档位跟着出现/收走', () => {
  const yu = mountYu({ ui: UI })
  yu.click({ 'game-scale-mode': 'lock' })
  assert.equal(yu.configOf(GAME_SCALE_PATHS.mode), 'lock')
  assert.match(cardOf(yu), /data-game-scale-step="1"/)

  yu.click({ 'game-scale-step': '2' })
  assert.equal(yu.configOf(GAME_SCALE_PATHS.step), 2)
  assert.match(cardOf(yu), /class="ychip on" data-game-scale-step="2">200%</)

  yu.click({ 'game-scale-mode': 'fit' })
  assert.equal(yu.configOf(GAME_SCALE_PATHS.mode), 'fit')
  assert.equal(/data-game-scale-step/.test(cardOf(yu)), false)
})

test('配置里存着认不出的值也开得出来，卡上落在默认那一档', () => {
  const yu = mountYu({
    ui: UI,
    config: { [GAME_SCALE_PATHS.mode]: 'nonesuch', [GAME_SCALE_PATHS.step]: 9 },
  })
  assert.match(cardOf(yu), /class="ychip on" data-game-scale-mode="fit"/)
})

test('卡上不许出现清晰度承诺：倍率是整的，物理像素上糊不糊还看系统缩放', () => {
  const card = cardOf(mountYu({ ui: UI, config: { [GAME_SCALE_PATHS.mode]: 'lock' } }))
  for (const word of ['清晰', '锐利', '不失真', '不模糊', '像素级', '绝对']) {
    assert.equal(card.includes(word), false, `卡上写了「${word}」`)
  }
  // 模式名与档位名同处 shared 一份，别在渲染层另写一张表
  assert.equal(GAME_SCALE_MODE_LABEL.fit, '自适应')
  assert.equal(GAME_SCALE_MODE_LABEL.lock, '固定倍率')
})
