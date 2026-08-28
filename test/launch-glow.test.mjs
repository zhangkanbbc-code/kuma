// 启动点亮动画（默认关）的两道护栏：
//   ① 顺序 / 抖动 / 点火变体是纯函数 + 注入随机数——定种子下结果确定、可断言，
//      任意种子下三条不变式（每格恰好一次、游戏恒最后、抖动不乱序）都得成立。
//      实机上四秒多就过去了，「洗牌漏了一格」「两拍抖到同一刻」肉眼认不出来。
//   ② 关掉时**零注入**、减少动态效果时**零注入**——编真的渲染层模块跑真逻辑
//      （护栏别只断言源码文本），拿一份迷你 DOM 数它到底动了什么。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

import shared from '../dist/shared/launch-glow.js'

const {
  LAUNCH_GLOW_CONFIG_KEY,
  LAUNCH_GLOW_DEFAULT,
  LAUNCH_GLOW_DOCK_ORDER,
  LAUNCH_GLOW_JITTER,
  LAUNCH_GLOW_TIMING,
  LAUNCH_GLOW_VARIANTS,
  LAUNCH_GUARD_TIMING,
  LAUNCH_BADGE_TIMING,
  LAUNCH_BATTLE_TIMING,
  LAUNCH_BRIEF_TIMING,
  LAUNCH_DISPATCH_TIMING,
  LAUNCH_ORDER_TIMING,
  LAUNCH_OVERLAY_TIMING,
  LAUNCH_STAGE_ITEM_CAP,
  LAUNCH_TOME_TIMING,
  LAUNCH_ZI_TIMING,
  LAUNCH_DIGITS_TIMING,
  LAUNCH_ROSTER_TIMING,
  LAUNCH_WELCOME_FALLBACK,
  LAUNCH_WELCOME_LEAD,
  LAUNCH_WELCOME_SIGNALS,
  LAUNCH_WELCOME_SKIP_HINT,
  LAUNCH_WELCOME_TIMING,
  digitCountOf,
  launchDigitsPlan,
  launchGlowSequence,
  launchGlowTotalMs,
  launchOverlayPlan,
  launchStaggerPlan,
  launchStaggerStep,
  launchWelcomeGateOpen,
  launchWelcomeGreeting,
  launchWelcomeLeaveAt,
  launchWelcomeName,
  rippleOrder,
  rippleRank,
  scrambleDigits,
} = shared

// 定种子伪随机（mulberry32）。要的只是「同种子同结果、跨种子够散」，
// 不是密码学质量——护栏喂它，运行时喂 Math.random。
const rngOf = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dock = (id, cells, collapsed = false) => ({ dock: id, cells, collapsed })
const FULL = { focus: false, docks: [dock('left', 1), dock('right', 1), dock('bottom', 3)] }
const nameOf = (step) =>
  step.target.kind === 'cell' ? `${step.target.dock}#${step.target.index}` : step.target.kind

// ---- 洗牌 ----

test('定种子下洗牌确定：同一个种子跑两遍，逐字段一模一样', () => {
  const once = launchGlowSequence(FULL, rngOf(20260823))
  const twice = launchGlowSequence(FULL, rngOf(20260823))
  assert.deepEqual(once, twice)
})

test('洗牌真的在洗：几十个种子里出得来好几种不同的顺序', () => {
  const orders = new Set()
  for (let seed = 1; seed <= 40; seed++) {
    orders.add(launchGlowSequence(FULL, rngOf(seed)).map(nameOf).join(','))
  }
  assert.ok(orders.size >= 10, `顺序只出了 ${orders.size} 种，洗牌形同虚设`)
})

test('任意种子：能看见的每一格恰好亮一次，导航条也在洗牌池里', () => {
  const expected = ['rail', 'left#0', 'bottom#0', 'bottom#1', 'bottom#2', 'right#0'].sort()
  for (let seed = 1; seed <= 200; seed++) {
    const steps = launchGlowSequence(FULL, rngOf(seed))
    const lit = steps.slice(0, -1).map(nameOf)
    assert.equal(new Set(lit).size, lit.length, `种子 ${seed}：有格子被点了两次`)
    assert.deepEqual([...lit].sort(), expected, `种子 ${seed}：漏了格子或多出了格子`)
    // 导航条不再固定第一，但必须仍在池子里
    assert.ok(lit.includes('rail'), `种子 ${seed}：导航条没进洗牌池`)
  }
})

test('任意种子：游戏永远最后，且整套里只有一步是游戏', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const steps = launchGlowSequence(FULL, rngOf(seed))
    assert.equal(steps[steps.length - 1].target.kind, 'game', `种子 ${seed}：游戏不是最后一步`)
    assert.equal(steps.filter((step) => step.target.kind === 'game').length, 1)
    assert.equal(steps[steps.length - 1].order, steps.length - 1)
  }
})

// ---- 节拍与抖动 ----

test('抖动只在 ±30% 以内，且抖不乱先后次序', () => {
  const { leadIn, step: beat } = LAUNCH_GLOW_TIMING
  const bound = beat * LAUNCH_GLOW_JITTER
  assert.ok(LAUNCH_GLOW_JITTER < 0.5, '抖动幅度超过半拍就可能把两拍抖成乱序')
  let sawNear = false
  for (let seed = 1; seed <= 200; seed++) {
    const lit = launchGlowSequence(FULL, rngOf(seed)).slice(0, -1)
    lit.forEach((step, index) => {
      const nominal = leadIn + index * beat
      const drift = Math.abs(step.delay - nominal)
      assert.ok(drift <= bound + 1, `种子 ${seed} 第 ${index} 拍抖出界：${drift}ms > ${bound}ms`)
      if (drift > bound * 0.8) sawNear = true
      assert.ok(step.delay > 0, '延时抖成了负数')
      assert.equal(step.duration, LAUNCH_GLOW_TIMING.fade)
    })
    for (let i = 1; i < lit.length; i++) {
      assert.ok(lit[i].delay > lit[i - 1].delay, `种子 ${seed}：第 ${i} 拍反超了前一拍`)
    }
  }
  assert.ok(sawNear, '两百个种子都没抖到接近上界，抖动幅度大概是没生效')
})

test('游戏等的是「最后一个亮透的」而不是「最后一拍」，再加 gameGap', () => {
  const timing = LAUNCH_GLOW_TIMING
  for (let seed = 1; seed <= 50; seed++) {
    const steps = launchGlowSequence(FULL, rngOf(seed))
    const game = steps[steps.length - 1]
    const litUntil = Math.max(...steps.slice(0, -1).map((step) => step.delay + step.duration))
    assert.equal(game.delay, litUntil + timing.gameGap)
    assert.equal(game.duration, timing.gameFade)
    assert.equal(launchGlowTotalMs(steps), game.delay + game.duration)
  }
})

test('时长参数表与总长：默认布局名义 4380ms，抖动只让它在 ±81ms 内浮动', () => {
  const timing = LAUNCH_GLOW_TIMING
  assert.deepEqual(timing, { leadIn: 390, step: 270, fade: 840, gameGap: 300, gameFade: 1500 })
  // 名义总长 = leadIn + 5×step + fade + gameGap + gameFade
  const nominal = timing.leadIn + 5 * timing.step + timing.fade + timing.gameGap + timing.gameFade
  assert.equal(nominal, 4380)
  const swing = timing.step * LAUNCH_GLOW_JITTER
  for (let seed = 1; seed <= 200; seed++) {
    const total = launchGlowTotalMs(launchGlowSequence(FULL, rngOf(seed)))
    assert.ok(
      Math.abs(total - nominal) <= swing + 1,
      `种子 ${seed} 总长 ${total}ms 偏离名义值超过一次抖动`,
    )
  }
})

// ---- 点火变体 ----

test('变体分配确定、只用登记在册的三套，且相邻两格必不同', () => {
  assert.deepEqual([...LAUNCH_GLOW_VARIANTS], ['a', 'b', 'c'])
  const known = new Set(LAUNCH_GLOW_VARIANTS)
  for (let seed = 1; seed <= 200; seed++) {
    const steps = launchGlowSequence(FULL, rngOf(seed))
    const lit = steps.slice(0, -1)
    lit.forEach((step, index) => {
      assert.ok(known.has(step.variant), `种子 ${seed}：冒出了没登记的变体 ${step.variant}`)
      if (index > 0) {
        assert.notEqual(
          step.variant,
          lit[index - 1].variant,
          `种子 ${seed} 第 ${index} 拍与上一格闪得一模一样`,
        )
      }
    })
    // 游戏区单独一档：大面积硬闪太刺眼，它走自己那套柔和脉冲
    assert.equal(steps[steps.length - 1].variant, 'game')
  }
})

test('三套变体都分得到：几十个种子里每一套都出现过', () => {
  const seen = new Set()
  for (let seed = 1; seed <= 40; seed++) {
    for (const step of launchGlowSequence(FULL, rngOf(seed)).slice(0, -1)) seen.add(step.variant)
  }
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c'])
})

// ---- 池子的组成（看不见的不占拍）----

test('空坞不占拍：一格都没摆出来的坞不进洗牌池', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const steps = launchGlowSequence(
      { focus: false, docks: [dock('left', 0), dock('right', 2), dock('bottom', 0)] },
      rngOf(seed),
    )
    assert.deepEqual(steps.map(nameOf).slice(0, -1).sort(), ['rail', 'right#0', 'right#1'])
    assert.equal(steps[steps.length - 1].target.kind, 'game')
  }
})

test('单坞：只有底坞有东西时，池子里就那几个，游戏照旧收尾', () => {
  const steps = launchGlowSequence({ focus: false, docks: [dock('bottom', 2)] }, rngOf(7))
  assert.deepEqual(steps.map(nameOf).slice(0, -1).sort(), ['bottom#0', 'bottom#1', 'rail'])
  assert.equal(steps[steps.length - 1].target.kind, 'game')
})

test('折叠的坞看不见，所以不点它——用户要的是「已经展开的模块」', () => {
  const steps = launchGlowSequence(
    { focus: false, docks: [dock('left', 1, true), dock('right', 1), dock('bottom', 3, true)] },
    rngOf(3),
  )
  assert.deepEqual(steps.map(nameOf).slice(0, -1).sort(), ['rail', 'right#0'])
})

test('专注模式：三坞全收，只剩导航条与游戏', () => {
  const steps = launchGlowSequence(FULL, rngOf(11))
  const focused = launchGlowSequence({ ...FULL, focus: true }, rngOf(11))
  assert.deepEqual(focused.map(nameOf), ['rail', 'game'])
  assert.ok(steps.length > focused.length)
})

test('一格都没有时也排得出序列：导航条一拍，然后游戏', () => {
  const steps = launchGlowSequence({ focus: false, docks: [] }, rngOf(5))
  assert.deepEqual(steps.map(nameOf), ['rail', 'game'])
  assert.equal(steps[1].delay, steps[0].delay + steps[0].duration + LAUNCH_GLOW_TIMING.gameGap)
})

test('坞的登记次序（洗牌前那份底稿）没变，定种子的护栏靠它才钉得住', () => {
  assert.deepEqual([...LAUNCH_GLOW_DOCK_ORDER], ['left', 'bottom', 'right'])
})

test('开关默认开：默认值只有这一份，config 的 DEFAULTS 引的就是它', () => {
  assert.equal(LAUNCH_GLOW_DEFAULT, true, '2026-08-26 用户裁定默认开（此前默认关等他实机验收）')
  assert.equal(LAUNCH_GLOW_CONFIG_KEY, 'kanso.launchGlow')
  // 钉的是**接线**不是字面量：谁把 config 里那行改回写死的 true/false，这里当场红。
  const configSource = fs.readFileSync(
    fileURLToPath(new URL('../src/main/config.ts', import.meta.url)),
    'utf8',
  )
  assert.match(configSource, /launchGlow: LAUNCH_GLOW_DEFAULT/)
})

// 关键帧本体是**数据**，所以下面几条是逐个数实算的语义断言，不是钉字面量：
// 谁把某个暗谷调深、把微斜坡拉宽成淡入、或者顺手加个 filter，都会当场红。
const styleSheet = () =>
  fs.readFileSync(fileURLToPath(new URL('../src/renderer/index.html', import.meta.url)), 'utf8')

/** 取一套关键帧：[{ pct, opacity, easing }]，按百分比升序。 */
const keyframesOf = (html, variant) => {
  const block = new RegExp(`@keyframes kanso-glow-${variant}\\s*\\{([\\s\\S]*?)\\n    \\}`).exec(html)
  assert.ok(block, `样式表里没有 kanso-glow-${variant}，JS 分配到它的格子会不动`)
  const frames = [...block[1].matchAll(/(\d+(?:\.\d+)?)%\s*\{([^}]*)\}/g)].map((hit) => ({
    pct: Number(hit[1]),
    opacity: Number(/opacity:\s*([\d.]+)/.exec(hit[2])[1]),
    easing: /animation-timing-function:\s*([a-z-]+)/.exec(hit[2])?.[1] ?? null,
  }))
  assert.ok(frames.length >= 4, `kanso-glow-${variant} 关键帧太少，成对平台撑不起来`)
  return { frames, body: block[1] }
}

test('三套点火关键帧与游戏区那套都真的写在样式表里，且只动 opacity', () => {
  const html = styleSheet()
  for (const variant of [...LAUNCH_GLOW_VARIANTS, 'game']) {
    const { body } = keyframesOf(html, variant)
    // 性能红线：点亮只准动 opacity，尤其不许出现 filter
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
    for (const prop of props) {
      assert.ok(
        prop === 'opacity' || prop === 'animation-timing-function',
        `kanso-glow-${variant} 里冒出了 ${prop}：点亮只准动 opacity`,
      )
    }
    assert.ok(!/filter/.test(body), `kanso-glow-${variant} 用了 filter`)
  }
})

test('点火关键帧：明暗切换只在 3~5% 的微斜坡里发生，其余时间是平台', () => {
  const html = styleSheet()
  const { fade } = LAUNCH_GLOW_TIMING
  for (const variant of LAUNCH_GLOW_VARIANTS) {
    const { frames } = keyframesOf(html, variant)
    // 收尾那一段是 ease-out 的缓升，本来就不该受斜坡窗约束
    const settleAt = frames.findIndex((frame) => frame.easing === 'ease-out')
    assert.ok(settleAt > 0, `kanso-glow-${variant} 没有 ease-out 收尾段`)
    let ramps = 0
    let plateaus = 0
    for (let i = 1; i <= settleAt; i++) {
      const span = frames[i].pct - frames[i - 1].pct
      if (frames[i].opacity === frames[i - 1].opacity) {
        plateaus += 1
        continue
      }
      ramps += 1
      assert.ok(
        span >= 3 && span <= 5,
        `kanso-glow-${variant} 在 ${frames[i - 1].pct}%→${frames[i].pct}% 的切换跨了 ${span}%`,
      )
      const ms = Math.round((fade * span) / 100)
      assert.ok(ms >= 25 && ms <= 42, `那一段实际 ${ms}ms，超出「快到像电火花、慢到不频闪」的窗`)
    }
    assert.ok(plateaus >= ramps - 1, `kanso-glow-${variant} 平台比斜坡还少，成对关键帧没搭起来`)
    // 收尾之外全靠成对关键帧撑平台，所以整条动画的时间函数必须是 linear
    assert.match(
      html,
      /body\.kanso-glow-run #element-rail,\s*\n\s*body\.kanso-glow-run \.dock-group \{\s*\n(?:[^}]*\n)?\s*animation-timing-function: linear;/,
      'steps() 是零毫秒硬跳，用户实机报过闪眼睛；平台要靠成对关键帧撑',
    )
  }
})

test('点火关键帧：首燃之后 opacity 不跌破 .35，且每个暗谷都比前一个浅', () => {
  const html = styleSheet()
  for (const variant of LAUNCH_GLOW_VARIANTS) {
    const { frames } = keyframesOf(html, variant)
    const levels = frames
      .map((frame) => frame.opacity)
      .filter((value, index, all) => index === 0 || value !== all[index - 1])
    assert.equal(levels[0], 0, `kanso-glow-${variant} 该从全暗起步`)
    assert.equal(levels[levels.length - 1], 1, `kanso-glow-${variant} 该收在全亮`)

    // 首燃 = 第一个非零亮度；从它往后，最暗的那一档就是「刺不刺眼」的判据
    const ignited = levels.slice(1)
    const floor = Math.min(...ignited)
    assert.ok(
      floor >= 0.3,
      `kanso-glow-${variant} 首燃后跌到 ${floor}：亮→近黑→亮才是真正闪眼睛的那一下`,
    )

    // 暗谷（内部极小值）必须一个比一个浅——整条要读成「越闪越亮」的预热
    const valleys = ignited.filter(
      (value, index) =>
        index > 0 && index < ignited.length - 1 && value < ignited[index - 1] && value < ignited[index + 1],
    )
    for (let i = 1; i < valleys.length; i++) {
      assert.ok(
        valleys[i] > valleys[i - 1],
        `kanso-glow-${variant} 第 ${i + 1} 个暗谷 ${valleys[i]} 没比前一个 ${valleys[i - 1]} 浅`,
      )
    }
    assert.ok(valleys.length <= 2, `kanso-glow-${variant} 有 ${valleys.length} 个暗谷，明暗超过三次`)
    assert.ok(valleys.length >= 1, `kanso-glow-${variant} 一个暗谷都没有，就不是点火了`)
  }
})

// ---- 第二幕：编队入场的时序 ----

test('入场时序：加载段之后各行等间隔错峰，行数少时用名义 step', () => {
  const t = LAUNCH_ROSTER_TIMING
  const plan = launchStaggerPlan(6)
  assert.equal(plan.loading, t.loading)
  assert.equal(plan.step, t.step)
  assert.deepEqual(
    plan.rows.map((row) => row.delay),
    [0, 1, 2, 3, 4, 5].map((i) => t.loading + t.handoff + i * t.step),
  )
  assert.ok(plan.rows.every((row) => row.duration === t.row))
  plan.rows.forEach((row, index) => assert.equal(row.index, index))
  // 单舰队六艘是最常见的一屏，总长要落在「1.5 秒上下」
  assert.equal(plan.total, 1530)
})

test('入场时序：行多时压缩 step——真会遇到的行数一个都不许拖过两秒', () => {
  const t = LAUNCH_ROSTER_TIMING
  const naive = t.loading + t.handoff + 23 * t.step + t.row // 不压缩会是这么长
  assert.ok(naive > 3300, '前提变了：名义 step 下 24 行本来就不长，这条护栏失去意义')
  // 实际能出现的最多 12 行（联合 6+6，沙盘 SANDBOX_CAP 也是 6）；一路查到 24 是留余量
  for (let count = 0; count <= 24; count++) {
    const plan = launchStaggerPlan(count)
    assert.ok(plan.step >= t.minStep, `${count} 行把 step 压到了 ${plan.step}ms，挤成同时出现了`)
    assert.ok(plan.step <= t.step, `${count} 行的 step 反而比名义值还大`)
    if (count > 1) {
      const span = plan.rows[count - 1].delay - plan.rows[0].delay
      assert.ok(span <= t.stepBudget, `${count} 行的错峰跨了 ${span}ms，超出预算`)
    }
    assert.ok(plan.total <= 2000, `${count} 行的第二幕 ${plan.total}ms，太拖了`)
    assert.ok(plan.total >= t.loading, `${count} 行的第二幕比加载段还短`)
  }
  // 联合舰队 12 行是真会遇到的形态，单独钉一下
  assert.equal(launchStaggerStep(12), Math.floor(t.stepBudget / 11))
})

test('入场时序：行数荒唐地多时，宁可超预算也不把行挤成同时出现', () => {
  const t = LAUNCH_ROSTER_TIMING
  // minStep 赢过预算是**故意的**（口径写在 launchStaggerStep 上）：27 行以上才碰得到，
  // 而真机上最多 12 行。这里钉的是「下限不许被预算压穿」，不是钉那个总长。
  for (const count of [40, 60, 120]) {
    const plan = launchStaggerPlan(count)
    assert.equal(plan.step, t.minStep, `${count} 行该刚好落在下限上`)
    const span = plan.rows[count - 1].delay - plan.rows[0].delay
    assert.equal(span, (count - 1) * t.minStep)
  }
})

test('入场时序：一行都没有就只放加载段，不硬造行', () => {
  const plan = launchStaggerPlan(0)
  assert.deepEqual(plan.rows, [])
  assert.equal(plan.total, LAUNCH_ROSTER_TIMING.loading)
  // 负数/小数（调用方数错了）也得给出一份能用的计划，不能抛
  assert.deepEqual(launchStaggerPlan(-3).rows, [])
  assert.equal(launchStaggerPlan(2.7).rows.length, 2)
})

// ---- 鉴 · 对角线波纹的次序 ----

const gridRects = (cols, rows, cell = 100) =>
  Array.from({ length: cols * rows }, (_unused, i) => ({
    left: (i % cols) * cell,
    top: Math.floor(i / cols) * cell,
    width: cell,
    height: cell,
  }))

test('波纹次序：左上先亮，右下最后，同一条反对角线同时亮', () => {
  const cols = 3
  const rects = gridRects(cols, 3)
  const host = { left: 0, top: 0, width: cols * 100, height: 3 * 100 }
  const order = rippleOrder(rects, (r) => r, host).map((r) => rects.indexOf(r))
  // 3×3 网格：反对角线分组是 [0] [1,3] [2,4,6] [5,7] [8]
  assert.deepEqual(order, [0, 1, 3, 2, 4, 6, 5, 7, 8])
  const ranks = rects.map((r) => rippleRank(r, host))
  assert.ok(ranks[0] < ranks[1], '左上没排在最前')
  assert.equal(ranks[1].toFixed(6), ranks[3].toFixed(6), '同一条反对角线名次该相同')
  assert.ok(ranks[8] === Math.max(...ranks), '右下没排在最后')
})

test('波纹次序：归一化让纵向真的起作用，不是按原始像素横扫', () => {
  // 面板宽 1200 高 200（坞里常见的扁形）。这一对是**判别性**的：
  // 拿原始像素相加会给出一个次序，归一化之后给出相反的次序。
  const host = { left: 0, top: 0, width: 1200, height: 200 }
  const rightTop = { left: 1100, top: 0, width: 100, height: 40 } // 中心 (1150, 20)
  const midBottom = { left: 250, top: 160, width: 100, height: 40 } // 中心 (300, 180)
  const raw = (r) => r.left + r.width / 2 + (r.top + r.height / 2)
  assert.ok(raw(midBottom) < raw(rightTop), '前提变了：这一对已经不判别了')
  assert.ok(
    rippleRank(rightTop, host) < rippleRank(midBottom, host),
    '按原始像素排了：扁面板上纵向几乎不起作用，波纹会退化成横扫',
  )
})

test('波纹次序：同名次保持文档顺序（结果必须可复现）', () => {
  const rects = gridRects(2, 2)
  const host = { left: 0, top: 0, width: 200, height: 200 }
  const items = rects.map((r, i) => ({ r, i }))
  const once = rippleOrder(items, (it) => it.r, host).map((it) => it.i)
  const twice = rippleOrder(items, (it) => it.r, host).map((it) => it.i)
  assert.deepEqual(once, twice)
  assert.deepEqual(once, [0, 1, 2, 3]) // [1] 与 [2] 同名次，按原序
})

test('波纹次序：宿主宽高为 0 时不炸（面板还没量出尺寸的那一瞬）', () => {
  const host = { left: 0, top: 0, width: 0, height: 0 }
  const rects = gridRects(2, 2)
  const order = rippleOrder(rects, (r) => r, host)
  assert.equal(order.length, 4)
  assert.ok(order.every((r) => Number.isFinite(rippleRank(r, host))))
})

test('元素数封顶：几百格的大网格不许逐格铺动画', () => {
  assert.equal(LAUNCH_STAGE_ITEM_CAP, 24)
  // 封顶之后最长的一幕（满 24 格的鉴）也得落在 1.8 秒内
  const plan = launchStaggerPlan(LAUNCH_STAGE_ITEM_CAP, LAUNCH_TOME_TIMING)
  assert.ok(plan.total <= 1800, `满格的鉴 ${plan.total}ms，超了`)
})

test('新三幕的节拍：性格各不相同，且都在 1.8 秒内收住', () => {
  const table = [
    ['鉴 · 开卷', LAUNCH_TOME_TIMING],
    ['钦 · 军令', LAUNCH_ORDER_TIMING],
    ['镖 · 调度', LAUNCH_DISPATCH_TIMING],
  ]
  for (const [label, timing] of table) {
    assert.equal(timing.loading, 0, `${label} 不该带罩`)
    for (let count = 0; count <= LAUNCH_STAGE_ITEM_CAP + 1; count++) {
      const plan = launchStaggerPlan(count, timing)
      assert.ok(plan.total <= 1800, `${label} ${count} 个元素 ${plan.total}ms，超了`)
      assert.ok(plan.step >= timing.minStep && plan.step <= timing.step)
    }
    // 不带罩又一个元素都没有 = 整幕跳过
    assert.equal(launchStaggerPlan(0, timing).total, 0)
  }
  // 镖比锐更快更密（调度板的利落劲），钦比锐更紧（命令一条条下达）
  assert.ok(LAUNCH_DISPATCH_TIMING.step < LAUNCH_ORDER_TIMING.step)
  assert.ok(LAUNCH_ORDER_TIMING.step < LAUNCH_ROSTER_TIMING.step)
  assert.ok(LAUNCH_DISPATCH_TIMING.row < LAUNCH_ROSTER_TIMING.row)
})

test('锱的节拍：真机上那十来块倒推得进资源数字的终点，塞不下也只是挤在开头', () => {
  assert.equal(LAUNCH_ZI_TIMING.loading, 0, '锱这一幕不带罩（对齐模式下罩本来也放不出来）')
  // 真机上的元素数：8 块磁贴 + 右栏五到七张卡。六位数（燃料/弹药）时终点是 1110ms，
  // 倒推之后第一块得有个正的起跑时刻——夹到 0 就意味着开头几块一起冒出来
  const end = launchDigitsPlan([6, 6, 6, 6, 2, 2, 3, 3]).end
  for (const count of [13, 14, 15]) {
    const plan = launchStaggerPlan(count, LAUNCH_ZI_TIMING, end)
    assert.equal(plan.total, end, `${count} 块时收官时刻与资源数字对不上`)
    assert.ok(plan.rows[0].delay > 0, `${count} 块倒推到头了，开头几块会一起冒出来`)
    assert.equal(plan.rows[count - 1].delay + LAUNCH_ZI_TIMING.row, end)
  }
  // 上限那一档也得收得住（右栏卡片哪天多起来，capped 截到 24 为止）
  const capped = launchStaggerPlan(LAUNCH_STAGE_ITEM_CAP, LAUNCH_ZI_TIMING, end)
  assert.equal(capped.total, end)
  assert.ok(capped.rows.every((row) => row.delay >= 0))
  // 一个数字都没有（锱还没出数、顶栏也空着）时退回自己的节奏，不是整幕跳过
  assert.equal(launchDigitsPlan([]).end, 0)
  assert.deepEqual(
    launchStaggerPlan(13, LAUNCH_ZI_TIMING, 0),
    launchStaggerPlan(13, LAUNCH_ZI_TIMING),
  )
  assert.ok(launchStaggerPlan(15, LAUNCH_ZI_TIMING).total <= 1800, '退路那一档拖太长了')
})

// ---- 第三幕：资源数字的仪表自检 ----

test('数位统计只数数字字符：千分位、k 后缀、空态都不算', () => {
  assert.equal(digitCountOf('300,000'), 6)
  assert.equal(digitCountOf('12.3k'), 3)
  assert.equal(digitCountOf('90'), 2)
  assert.equal(digitCountOf('—'), 0)
  assert.equal(digitCountOf(''), 0)
})

test('锁位时刻表从共同终点倒排：位数再不一样，最高位也在同一瞬间锁定', () => {
  const t = LAUNCH_DIGITS_TIMING
  // 六位（燃料）、两位（改修资材）、三位（顶栏 12.3k）、一位——真机上就是这样杂
  const plan = launchDigitsPlan([6, 2, 3, 1])
  assert.equal(plan.end, t.scramble + 5 * t.lockStep, '终点该由最长那个数字定')
  assert.equal(plan.total, plan.end + t.settle)
  for (const [k, count] of [6, 2, 3, 1].entries()) {
    const locks = plan.locks[k]
    assert.equal(locks.length, count)
    assert.equal(locks[count - 1], plan.end, `第 ${k} 个数字的最高位没落在共同终点`)
    // 位序仍是右到左：个位最早，逐位向高位推
    for (let i = 1; i < locks.length; i++) {
      assert.ok(locks[i] > locks[i - 1], '锁定次序不是从个位往高位')
      assert.equal(locks[i] - locks[i - 1], t.lockStep)
    }
    assert.equal(locks[0], plan.end - (count - 1) * t.lockStep, '个位的时刻不是从终点倒推的')
  }
  // 位数长的更早开始锁
  assert.ok(plan.locks[0][0] < plan.locks[1][0], '六位数该比两位数更早开始锁')
  assert.ok(plan.locks[3][0] === plan.end, '一位数从头滚到终点才锁')
})

test('锁位时刻表：任意位数组合下终点都一致，且没有一位排在乱滚期之前', () => {
  const t = LAUNCH_DIGITS_TIMING
  for (const counts of [[1], [6], [2, 2, 2], [1, 6], [4, 4, 6, 2, 3, 5, 1], [6, 6, 6, 6, 6, 6, 6, 6]]) {
    const plan = launchDigitsPlan(counts)
    const ends = new Set(plan.locks.map((locks) => locks[locks.length - 1]))
    assert.equal(ends.size, 1, `位数组合 ${counts} 下终点不止一个：${[...ends]}`)
    assert.equal([...ends][0], plan.end)
    const earliest = Math.min(...plan.locks.flat())
    assert.equal(earliest, t.scramble, '最早那一位该恰好在乱滚期结束时锁')
    assert.ok(plan.total >= t.scramble + t.settle)
    assert.ok(plan.total <= 1800, `${counts} 的第三幕 ${plan.total}ms，超出「1.2~1.8 秒」`)
  }
  // 一个数字都没有：给出零长的一幕，调用方据此直接收场
  assert.deepEqual(launchDigitsPlan([]), { end: 0, total: 0, locks: [] })
  assert.deepEqual(launchDigitsPlan([0, 0]).locks, [[], []])
})

test('乱滚：分隔符与长度全程不动，只有数字字形在换', () => {
  const plan = launchDigitsPlan([6])
  const rng = rngOf(4242)
  for (const elapsed of [0, 200, 560, 800, 1000]) {
    const out = scrambleDigits('300,000', elapsed, plan.end, LAUNCH_DIGITS_TIMING, rng)
    assert.equal(out.length, 7, '长度变了就会抖动/重排')
    assert.equal(out[3], ',', '千分位跑位了')
    assert.match(out, /^\d{3},\d{3}$/)
  }
  // k 后缀、空态原样不动
  assert.match(scrambleDigits('12.3k', 0, plan.end, LAUNCH_DIGITS_TIMING, rng), /^\d{2}\.\dk$/)
  assert.equal(scrambleDigits('—', 0, plan.end, LAUNCH_DIGITS_TIMING, rng), '—')
  assert.equal(scrambleDigits('', 0, plan.end, LAUNCH_DIGITS_TIMING, rng), '')
})

test('乱滚：逐位锁定确实是从个位往高位推进，到终点就是真值', () => {
  const t = LAUNCH_DIGITS_TIMING
  const real = '300,000' // 只含 3 和 0
  const plan = launchDigitsPlan([digitCountOf(real)])
  // 恒返回 7 的「随机」流：真值里没有 7，于是**未锁的位一眼可辨**，
  // 两个方向都能断言死。（乱滚撞上真数字本身无妨，规格里明说不规避——
  // 但那样就没法用「等于真值」当锁定判据了，所以护栏这边挑一个不会撞的流。）
  const never7 = () => 0.75
  const shot = (elapsed) => scrambleDigits(real, elapsed, plan.end, t, never7)

  // 乱滚期内一位都没锁
  assert.equal(shot(t.scramble - 1), '777,777')
  // 之后每过一个 lockStep 多锁一位，从个位（最右）往左推
  assert.equal(shot(t.scramble), '777,770')
  assert.equal(shot(t.scramble + t.lockStep), '777,700')
  assert.equal(shot(t.scramble + 2 * t.lockStep), '777,000')
  assert.equal(shot(t.scramble + 3 * t.lockStep), '770,000')
  assert.equal(shot(t.scramble + 4 * t.lockStep), '700,000')
  assert.equal(shot(t.scramble + 5 * t.lockStep), '300,000')
  // 终点即真值，之后也不再变
  assert.equal(shot(plan.end), real)
  assert.equal(shot(plan.total), real)
  assert.equal(shot(plan.total + 5000), real)

  // 两位数（改修资材那种）跟着同一个终点收：它一直滚到倒数第二步才开始锁
  const short = '90'
  const both = launchDigitsPlan([6, 2])
  const shortShot = (elapsed) => scrambleDigits(short, elapsed, both.end, t, never7)
  assert.equal(shortShot(t.scramble), '77', '短数字不该跟着最长那个一起早早开锁')
  assert.equal(shortShot(both.end - t.lockStep), '70')
  assert.equal(shortShot(both.end), '90')
  assert.equal(both.end, plan.end, '两个数字共用同一个终点')
})

test('乱滚：同一个种子跑两遍逐字符一样（随机是注入的，不是藏在里面的）', () => {
  const plan = launchDigitsPlan([6])
  const once = scrambleDigits('300,000', 120, plan.end, LAUNCH_DIGITS_TIMING, rngOf(99))
  const twice = scrambleDigits('300,000', 120, plan.end, LAUNCH_DIGITS_TIMING, rngOf(99))
  assert.equal(once, twice)
})

test('第二幕的关键帧只动 opacity 与 transform', () => {
  const html = styleSheet()
  for (const name of ['kanso-roster-veil', 'kanso-roster-sweep', 'kanso-roster-row']) {
    const block = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n    \\}`).exec(html)
    assert.ok(block, `样式表里没有 ${name}`)
    const props = [...block[1].matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
    for (const prop of props) {
      assert.ok(
        prop === 'opacity' || prop === 'transform',
        `${name} 里冒出了 ${prop}：入场只准动 opacity 与 transform`,
      )
    }
  }
  // 罩层不许挡点击——锐的加载光带与镝的扫描线共用同一条形态规则
  const shell = /\.kanso-roster-load, \.kanso-battle-scan \{([^}]*)\}/.exec(html)
  assert.ok(shell, '罩层的共用形态规则不见了')
  assert.match(shell[1], /pointer-events: none;/, '罩层没写 pointer-events:none，会把面板点死')
})

test('第二幕认的是锐的行标记：两头的接线必须对得上', () => {
  // 钉的是**接线**：锐改了行的类名/属性，第二幕会静默退化成「只有加载段」，
  // 那是最不容易被发现的一种坏法。
  const wiring = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/index.ts', import.meta.url)),
    'utf8',
  )
  const ru = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/modules/ru.ts', import.meta.url)),
    'utf8',
  )
  assert.match(wiring, /'\.ships \.ship\[data-ship\]'/, '镇壳取行的选择器变了')
  assert.match(ru, /class="ships/, '锐不再输出 .ships 容器')
  assert.match(ru, /data-ship="\$\{ship\.id\}"/, '锐的舰娘行不再带 data-ship')
})

test('游戏区那套不跟着改：仍是柔和的双段脉冲，没有平台也没有硬切', () => {
  const { frames } = keyframesOf(styleSheet(), 'game')
  assert.equal(frames[0].opacity, 1)
  assert.equal(frames[frames.length - 1].opacity, 0)
  // 每一帧都换值 = 全程插值，没有「保持帧」，于是读不出任何一次硬切
  for (let i = 1; i < frames.length; i++) {
    assert.notEqual(frames[i].opacity, frames[i - 1].opacity, '罩层出现了平台，那会变成硬切')
  }
  // 两段脉冲：中途回压两次（罩层变浓），其余一路变淡
  const rebounds = frames.filter((frame, index) => index > 0 && frame.opacity > frames[index - 1].opacity)
  assert.equal(rebounds.length, 2, '罩层该是两段轻脉冲再放亮')
  assert.ok(Math.max(...frames.map((f) => f.opacity)) <= 1)
})

// ---- 零注入 / 减少动态效果：编真模块，拿迷你 DOM 数它动了什么 ----

// 加/摘类的**流水账**：仪式态的交接是「先挂进场动画、再摘祖先类」，
// 次序反了就会闪一帧全亮——那正是这次要修的毛病，所以次序本身要能断言。
let classEvents = []

class FakeElement {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.parentNode = null
    this.style = {}
    this.attrs = {}
    // dataset 现在是进场标记的落点（不再用 class，理由见 launch-glow 的 MARK）：
    // 读写都要如实记账，「接手在现身之前」那条断言靠它
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = value
        classEvents.push({ el: this, action: 'mark', name: `${String(key)}=${value}` })
        return true
      },
      deleteProperty: (target, key) => {
        delete target[key]
        classEvents.push({ el: this, action: 'unmark', name: String(key) })
        return true
      },
    })
    this.groups = []
    this.classes = new Set()
    this.listeners = new Map()
    this.text = ''
  }
  // 数字乱滚改的就是 textContent；写入也记进流水账，好断言「接手」发生在「现身」之前
  get textContent() {
    return this.text
  }
  set textContent(value) {
    this.text = value
    classEvents.push({ el: this, action: 'text', name: value })
  }
  /** 离开文档的旧引用不许被写回旧值（锱一重渲，新 DOM 上才是新的真值） */
  get isConnected() {
    return this.parentNode !== null
  }
  get classList() {
    return {
      add: (...names) =>
        names.forEach((name) => {
          this.classes.add(name)
          classEvents.push({ el: this, action: 'add', name })
        }),
      remove: (...names) =>
        names.forEach((name) => {
          this.classes.delete(name)
          classEvents.push({ el: this, action: 'remove', name })
        }),
      contains: (name) => this.classes.has(name),
    }
  }
  setAttribute(name, value) {
    this.attrs[name] = value
  }
  appendChild(node) {
    node.parentNode?.removeChild(node)
    node.parentNode = this
    this.children.push(node)
    return node
  }
  removeChild(node) {
    this.children = this.children.filter((child) => child !== node)
    node.parentNode = null
  }
  remove() {
    this.parentNode?.removeChild(this)
  }
  querySelectorAll(selector) {
    return selector === '.dock-group' ? this.groups : []
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((fn) => fn !== handler))
  }
  // animationend 会冒泡，且行里还住着别的动画——所以事件必须带 animationName，
  // 生产代码认名字才收场，这里也就得如实喂名字
  fire(type, animationName) {
    for (const handler of [...(this.listeners.get(type) ?? [])]) {
      handler({ type, target: this, animationName })
    }
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0)
  }
}

// 一次装一副新的 DOM：每个用例都要能独立数「动了什么」
const installDom = ({ reduce = false, cells = { left: 1, bottom: 3, right: 1 } } = {}) => {
  classEvents = []
  const registry = new Map()
  const body = new FakeElement('body')
  const gameArea = new FakeElement('div')
  const rail = new FakeElement('nav')
  registry.set('#game-area', gameArea)
  registry.set('#element-rail', rail)
  const docks = {}
  for (const [id, count] of Object.entries(cells)) {
    const el = new FakeElement('aside')
    el.groups = Array.from({ length: count }, () => new FakeElement('div'))
    docks[id] = el
    registry.set(`.dock[data-dock="${id}"]`, el)
  }
  const created = []
  const docListeners = new Map()
  globalThis.document = {
    body,
    createElement: (tag) => {
      const el = new FakeElement(tag)
      created.push(el)
      return el
    },
    querySelector: (selector) => registry.get(selector) ?? null,
    addEventListener: (type, handler) => {
      const list = docListeners.get(type) ?? []
      list.push(handler)
      docListeners.set(type, list)
    },
    removeEventListener: (type, handler) => {
      docListeners.set(type, (docListeners.get(type) ?? []).filter((fn) => fn !== handler))
    },
  }
  globalThis.window = { matchMedia: (query) => ({ matches: reduce && /reduced-motion/.test(query) }) }
  const fireDoc = (type) => {
    for (const handler of [...(docListeners.get(type) ?? [])]) handler({ type })
  }
  const docListenerCount = () =>
    [...docListeners.values()].reduce((sum, list) => sum + list.length, 0)
  return { body, gameArea, rail, docks, created, fireDoc, docListenerCount }
}

// 渲染层模块直接编出来跑：它只依赖 shared/launch-glow 与 document/window，
// 不碰 electron，所以不必像铆那样打桩，原样 bundle 即可。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-launch-glow-'))
const outfile = path.join(tempDir, 'launch-glow.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/launch-glow.ts', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const { armLaunchGlow, armLaunchWelcome, playOverlayEntrance, setOverlayEntranceEnabled } =
  createRequire(import.meta.url)(outfile)

// ---- 顶栏浮层（铃/史/钥）· 打开时的入场 ----
//
// 与仪式各幕不是一回事：触发是**每次打开**，浮层又是玩游戏时高频开合的东西，
// 所以钉的全是「连开连关」逼出来的那几条。

const fakeOverlayBody = (blockCount) => {
  const body = new FakeElement('div')
  const pane = new FakeElement('div')
  body.appendChild(pane)
  const app = new FakeElement('div')
  pane.appendChild(app)
  const blocks = Array.from({ length: blockCount }, () => new FakeElement('div'))
  for (const block of blocks) app.appendChild(block)
  return { body, blocks }
}

test('浮层入场：开关关着 = 彻底空转，一个标记都不打', () => {
  installDom()
  setOverlayEntranceEnabled(false)
  const { body, blocks } = fakeOverlayBody(3)
  playOverlayEntrance(body)
  assert.ok(blocks.every((el) => el.dataset.kansoOpen === undefined))
  assert.ok(blocks.every((el) => el.style.animationDelay === undefined))
  setOverlayEntranceEnabled(false) // 复位，别影响后面的用例
})

test('浮层入场：系统要求减少动态效果时也不放', () => {
  installDom({ reduce: true })
  setOverlayEntranceEnabled(true) // 开关开着，但 reduceMotion 该把它按下去
  const { body, blocks } = fakeOverlayBody(3)
  playOverlayEntrance(body)
  assert.ok(blocks.every((el) => el.dataset.kansoOpen === undefined))
  setOverlayEntranceEnabled(false)
})

test('浮层入场：内容块拿到微错峰，总长不超 300ms', () => {
  installDom()
  setOverlayEntranceEnabled(true)
  try {
    const { body, blocks } = fakeOverlayBody(3)
    playOverlayEntrance(body)
    const plan = launchOverlayPlan(3)
    blocks.forEach((el, index) => {
      assert.equal(el.dataset.kansoOpen, '1', `第 ${index} 块没入场`)
      assert.equal(el.style.animationDelay, `${plan.blocks[index].delay}ms`)
      assert.equal(el.style.animationDuration, `${LAUNCH_OVERLAY_TIMING.blockRow}ms`)
    })
    assert.ok(plan.total <= LAUNCH_OVERLAY_TIMING.cap)
    // 放完就擦干净：静止态不许留下任何行内动画属性（更不许留 transform）
    blocks[2].fire('animationend', 'kanso-overlay-block')
    assert.ok(blocks.every((el) => el.dataset.kansoOpen === undefined), '标记没摘')
    assert.ok(blocks.every((el) => el.style.animationDelay === ''), '行内延时没擦')
    assert.ok(blocks.every((el) => el.style.animationDuration === ''))
  } finally {
    setOverlayEntranceEnabled(false)
  }
})

test('浮层入场：块数封顶——超出的随面板一起现身，不参与错峰', () => {
  installDom()
  setOverlayEntranceEnabled(true)
  try {
    const { body, blocks } = fakeOverlayBody(9)
    playOverlayEntrance(body)
    const marked = blocks.filter((el) => el.dataset.kansoOpen === '1')
    assert.equal(marked.length, LAUNCH_OVERLAY_TIMING.blockCap, '封顶没生效，会超出 300ms')
    assert.ok(blocks.slice(LAUNCH_OVERLAY_TIMING.blockCap).every((el) => el.dataset.kansoOpen === undefined))
  } finally {
    setOverlayEntranceEnabled(false)
  }
})

test('浮层入场：快速连开三次不叠加——上一次先收干净，监听不残留', () => {
  installDom()
  setOverlayEntranceEnabled(true)
  try {
    const { body, blocks } = fakeOverlayBody(3)
    // 同一批元素被反复接手（浮层的 pane 是复用的，连开就是同一批节点）
    for (let round = 0; round < 3; round++) playOverlayEntrance(body)
    for (const el of blocks) {
      assert.equal(el.dataset.kansoOpen, '1')
      assert.ok(el.listenerCount <= 1, `连开三次之后监听叠了 ${el.listenerCount} 个`)
    }
    assert.equal(blocks[2].listenerCount, 1, '结束信号该只挂在最后一块上，且只有一份')
    assert.equal(blocks[0].listenerCount, 0)
    // 只需一次 animationend 就收干净——叠加的话会剩下没摘的标记
    blocks[2].fire('animationend', 'kanso-overlay-block')
    assert.ok(blocks.every((el) => el.dataset.kansoOpen === undefined))
    assert.ok(blocks.every((el) => el.listenerCount === 0), '监听残留')
  } finally {
    setOverlayEntranceEnabled(false)
  }
})

test('浮层入场：关掉开关会把还在演的那一次收掉', () => {
  installDom()
  setOverlayEntranceEnabled(true)
  const { body, blocks } = fakeOverlayBody(3)
  playOverlayEntrance(body)
  assert.equal(blocks[0].dataset.kansoOpen, '1')
  setOverlayEntranceEnabled(false)
  assert.ok(blocks.every((el) => el.dataset.kansoOpen === undefined), '关了开关还留着标记')
  assert.ok(blocks.every((el) => el.listenerCount === 0))
})

test('浮层入场：开着时内容重渲不重播——标记只挂在「打开」那一瞬间', () => {
  installDom()
  setOverlayEntranceEnabled(true)
  try {
    const { body, blocks } = fakeOverlayBody(3)
    playOverlayEntrance(body)
    // 模块重渲：旧块离开文档，换上新的一批（模块输出里没有任何标记）
    const app = blocks[0].parentNode
    app.children = []
    for (const el of blocks) el.parentNode = null
    const fresh = Array.from({ length: 3 }, () => new FakeElement('div'))
    for (const el of fresh) app.appendChild(el)
    assert.ok(fresh.every((el) => el.dataset.kansoOpen === undefined), '往重渲后的新 DOM 上重播了')
    // 兜底收场只碰旧引用，新 DOM 一个字不动
    setOverlayEntranceEnabled(false)
    assert.ok(fresh.every((el) => el.dataset.kansoOpen === undefined))
    assert.ok(fresh.every((el) => el.style.animationDelay === undefined))
  } finally {
    setOverlayEntranceEnabled(false)
  }
})

test('浮层入场：一块内容都没有时什么都不做', () => {
  installDom()
  setOverlayEntranceEnabled(true)
  try {
    const empty = new FakeElement('div')
    assert.doesNotThrow(() => playOverlayEntrance(empty))
    assert.doesNotThrow(() => playOverlayEntrance(null))
    assert.equal(launchOverlayPlan(0).total, 0)
  } finally {
    setOverlayEntranceEnabled(false)
  }
})

test('浮层入场：样式与接线——关键帧只动 opacity/transform，铆在打开时调它', () => {
  const html = styleSheet()
  const block = /@keyframes kanso-overlay-block\s*\{([\s\S]*?)\n    \}/.exec(html)
  assert.ok(block, '没有 kanso-overlay-block')
  const props = [...block[1].matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
  for (const prop of props) {
    assert.ok(prop === 'opacity' || prop === 'transform', `冒出了 ${prop}`)
  }
  // 位移 4~6px：浮层是高频开合的，位移大了每次点开都像在晃
  const shift = /translate3d\(0, (\d+)px, 0\)/.exec(block[1])
  assert.ok(shift && Number(shift[1]) <= 6, `位移 ${shift?.[1]}px 太大`)
  // 减少动态效果那一档有双保险
  assert.match(html, /\[data-kanso-open\] \{ animation: none !important; \}/)
  // 接线：铆的 openOverlay 里调，而且排在 showModule 之后（那一步可能触发重渲）
  const mu = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/mu.ts', import.meta.url)),
    'utf8',
  )
  const openFn = /export const openOverlay[\s\S]*?\n\}/.exec(mu)
  assert.ok(openFn, '找不到 openOverlay')
  assert.match(openFn[0], /playOverlayEntrance\(overlayBody\)/, '浮层打开时没放入场')
  assert.ok(
    openFn[0].indexOf('showModule(id)') < openFn[0].indexOf('playOverlayEntrance'),
    '入场排在 showModule 之前：那一步可能触发重渲，标记会白打',
  )
})

test('开关关着：一个类、一个节点、一个监听都不加', () => {
  const dom = installDom()
  assert.equal(armLaunchGlow(false), null)
  assert.equal(dom.created.length, 0, '关着还建了节点')
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.docListenerCount(), 0)
  assert.deepEqual(dom.rail.style, {})
})

test('系统要求减少动态效果：整套跳过，同样零注入', () => {
  const dom = installDom({ reduce: true })
  assert.equal(armLaunchGlow(true), null)
  assert.equal(dom.created.length, 0)
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.docListenerCount(), 0)
})

test('开着：罩暗 → 逐格点火 → 放完把类、行内动画属性和罩层全部撤干净', () => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  assert.ok(handle)

  // 装配之前就该是暗的：坞位还没铺，body 上的类先到位，第一帧就不会先亮一下
  assert.ok(dom.body.classes.has('kanso-glow'))
  assert.ok(!dom.body.classes.has('kanso-glow-run'))
  assert.equal(dom.gameArea.children.length, 1)
  const veil = dom.gameArea.children[0]
  assert.equal(veil.id, 'game-glow')
  assert.equal(veil.attrs['aria-hidden'], 'true')

  handle.run({
    focus: false,
    docks: [
      { dock: 'left', cells: 1, collapsed: false },
      { dock: 'right', cells: 1, collapsed: false },
      { dock: 'bottom', cells: 3, collapsed: false },
    ],
  })
  assert.ok(dom.body.classes.has('kanso-glow-run'))

  // 六个可见元素各拿到一套关键帧 + 自己的延时（JS 只写一趟，错峰交给 CSS）
  const lit = [
    dom.rail,
    dom.docks.left.groups[0],
    dom.docks.bottom.groups[0],
    dom.docks.bottom.groups[1],
    dom.docks.bottom.groups[2],
    dom.docks.right.groups[0],
  ]
  const delays = lit.map((el) => Number.parseInt(el.style.animationDelay, 10))
  assert.equal(new Set(delays).size, lit.length, '有两格被排到了同一刻')
  for (const el of lit) {
    assert.match(el.style.animationName, /^kanso-glow-[abc]$/, `没分到点火变体：${el.style.animationName}`)
    assert.equal(el.style.animationDuration, '840ms')
    assert.ok(Number.isFinite(Number.parseInt(el.style.animationDelay, 10)))
  }
  // 顺序每次随机，所以只钉「谁最后亮透」与罩层的接续关系，不钉具体是哪一格
  const litUntil = Math.max(...delays) + 840
  assert.equal(veil.style.animationName, 'kanso-glow-game', '游戏区不该跟着硬闪')
  assert.equal(veil.style.animationDelay, `${litUntil + 300}ms`)
  assert.equal(veil.style.animationDuration, '1500ms')

  // 罩层是最后一个结束的，它的 animationend 就是「第一幕放完了」；
  // 这一局没给第二幕的取景函数，于是紧接着整场落幕
  veil.fire('animationend', 'kanso-glow-game')
  assert.equal(dom.body.classes.size, 0, '类没撤干净：面板会永远停在动画的终态规则里')
  assert.equal(dom.gameArea.children.length, 0, '罩层没从 DOM 里摘掉：常驻合成层')
  for (const el of lit) {
    assert.equal(el.style.animationName, '', '行内动画名没擦掉')
    assert.equal(el.style.animationDelay, '', '行内延时没擦掉')
    assert.equal(el.style.animationDuration, '')
  }
  assert.equal(dom.docListenerCount(), 0, '跳过用的监听没退')
  assert.equal(veil.listenerCount, 0)
})

test('点一下就到终态：罩层撤掉、面板全亮，且这一下点击照旧送到原目标', () => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  handle.run({ focus: false, docks: [{ dock: 'bottom', cells: 2, collapsed: false }] })
  assert.equal(dom.gameArea.children.length, 1)

  dom.fireDoc('pointerdown')
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.docListenerCount(), 0)
  // 再点一次不该出事（监听已退，finish 也幂等）
  dom.fireDoc('pointerdown')
  assert.equal(dom.gameArea.children.length, 0)
})

test('启动失败时 cancel：罩层立刻撤，绝不把玩家留在一片黑里', () => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  assert.equal(dom.gameArea.children.length, 1)
  handle.cancel()
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.gameArea.children.length, 0)
  // cancel 之后 run 是空转：不会把已经撤掉的罩层又请回来
  handle.run({ focus: false, docks: [{ dock: 'bottom', cells: 1, collapsed: false }] })
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.docListenerCount(), 0)
})

// ---- 第二幕：接线、门条、被打断 ----

const ONLY_BOTTOM = { focus: false, docks: [{ dock: 'bottom', cells: 1, collapsed: false }] }

// 注册表里的一条：护栏用的是**真的那几条**的形状（见 index.ts 的 LAUNCH_STAGES）
const rosterStage = (pick) => ({
  kind: 'stagger',
  id: 'roster',
  hides: '.ws-pane.mod-ru .ships .ship',
  mark: 'roster',
  animation: 'kanso-roster-row',
  overlay: { className: 'kanso-roster-load', animation: 'kanso-roster-veil' },
  timing: LAUNCH_ROSTER_TIMING,
  pick,
})
const digitsStage = (pick) => ({
  kind: 'digits',
  id: 'digits',
  hides: '.ws-pane.mod-zi .tiles .tile .v',
  pick,
})
const stagesOf = (roster, digits) => [
  ...(roster ? [rosterStage(roster)] : []),
  ...(digits ? [digitsStage(digits)] : []),
]

/** 仪式态：漏摘一条退出路径 = 那一块内容永远隐身，是这套东西最大的风险面 */
const CEREMONY = 'kanso-ceremony'

// 看门狗宽限与第一幕尾巴的长度：并行各幕从「最后一格亮透」起跑，与游戏区那段
// 淡入并排走，所以「整场该在什么时候被强行收掉」要按两者里长的那个算。
const ACT1_REST = LAUNCH_GLOW_TIMING.gameGap + LAUNCH_GLOW_TIMING.gameFade
const stageWatchdogAt = (longest) =>
  Math.max(longest, ACT1_REST) + LAUNCH_GUARD_TIMING.watchdogSlack

/** 这一局最后亮透的是哪一格：骨架只给那一格挂了 animationend（各幕接手的信号源） */
const lastLitOf = (dom) =>
  [dom.rail, ...Object.values(dom.docks).flatMap((el) => el.groups)].find(
    (el) => (el.listeners.get('animationend') ?? []).length > 0,
  ) ?? null

/** 最后一格亮透：并行各幕从这一刻接手，而游戏区那 1.8 秒的淡入还在跑 */
const handOff = (dom) => {
  const el = lastLitOf(dom)
  assert.ok(el, '没有哪一格挂着接手信号：各幕又要干等第一幕落幕了')
  el.fire('animationend', el.style.animationName)
  return el
}

/** 第一幕落幕：游戏区那层黑罩淡完 */
const endAct1 = (dom) => dom.gameArea.children[0]?.fire('animationend', 'kanso-glow-game')

/** 起一幕：装配 → 放第一幕 → 最后一格亮透，于是接上并行的各幕 */
const playToAct2 = (roster, digits) => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  handle.run(ONLY_BOTTOM, stagesOf(roster, digits))
  const veil = dom.gameArea.children[0]
  handOff(dom)
  return { dom, handle, veil }
}

/** 一组数字元素：锱那种带千分位的，和顶栏那种带 k 后缀的 */
const fakeDigits = (...values) => {
  const holder = new FakeElement('div')
  return values.map((value) => {
    const el = new FakeElement('b')
    holder.appendChild(el) // 有父节点 = isConnected，收场时才会被写回真值
    el.textContent = value
    return el
  })
}

const fakeRoster = (rowCount) => {
  const host = new FakeElement('div')
  const items = Array.from({ length: rowCount }, () => new FakeElement('div'))
  return { host, items }
}

test('第二幕接在最后一格亮透处：游戏区还在淡入，加载罩就已经盖上了', () => {
  const targets = fakeRoster(6)
  const { dom } = playToAct2(() => targets)

  // 第一幕**还没收**：游戏区那层黑罩还在淡，坞位的点亮态也还挂着。
  // 各幕与它并排跑，这正是这次要的——尾巴上原先干等 1.8 秒。
  assert.equal(dom.gameArea.children.length, 1, '各幕接手时游戏区那层黑罩就该还在淡')
  assert.ok(dom.body.classes.has('kanso-glow-run'), '第一幕还没放完，点亮态不该撤')
  assert.ok(!dom.body.classes.has(CEREMONY), '接手了却没摘仪式态：各幕会全程隐身')

  // 加载罩挂在锐的面板上，带一条扫动光带；两者的时长都由 JS 写在行内
  assert.equal(targets.host.children.length, 1)
  const loader = targets.host.children[0]
  assert.equal(loader.className, 'kanso-roster-load')
  assert.equal(loader.attrs['aria-hidden'], 'true')
  assert.equal(loader.style.animationDuration, `${LAUNCH_ROSTER_TIMING.loading}ms`)
  assert.equal(loader.children.length, 1, '缺了那条扫动光带')
  assert.equal(loader.children[0].style.animationDuration, `${LAUNCH_ROSTER_TIMING.loading}ms`)

  const plan = launchStaggerPlan(6)
  targets.items.forEach((row, index) => {
    assert.ok(row.dataset.kansoIn === 'roster', `第 ${index} 行没进场`)
    assert.equal(row.style.animationDelay, `${plan.rows[index].delay}ms`)
    assert.equal(row.style.animationDuration, `${plan.rows[index].duration}ms`)
  })
  // 各行延时严格递增 = 一排排出现，而不是一起冒出来
  const delays = targets.items.map((row) => Number.parseInt(row.style.animationDelay, 10))
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1])

  // 最后一行落定：这一幕自己收干净了，但整场还没落幕——游戏区那层黑罩还在淡
  targets.items[5].fire('animationend', 'kanso-roster-row')
  assert.equal(targets.host.children.length, 0, '加载罩没摘掉')
  for (const row of targets.items) {
    assert.ok(row.dataset.kansoIn !== 'roster')
    assert.equal(row.style.animationDelay, '')
    assert.equal(row.style.animationName, '')
  }
  assert.equal(dom.gameArea.children.length, 1, '各幕先收工就把游戏区的淡入撕掉了')
  assert.equal(dom.docListenerCount(), 2, '第一幕还没放完，跳过用的监听得留着')

  // 游戏区淡完，这才是整场落幕
  endAct1(dom)
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.docListenerCount(), 0, '跳过用的监听没退')
})

test('尾巴不再空着：各幕开演早于游戏区淡完整整 gameGap + gameFade', () => {
  const targets = fakeRoster(6)
  const dom = installDom()
  const handle = armLaunchGlow(true)
  try {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets))
    // 接手的信号挂在**最后亮透**的那一格上（delay + duration 最大的那个），
    // 不是随便哪一格，也不是罩层——挂错了各幕就会早开或晚开
    const lit = [dom.rail, ...Object.values(dom.docks).flatMap((el) => el.groups)].filter(
      (el) => el.style.animationName,
    )
    const endOf = (el) =>
      Number.parseInt(el.style.animationDelay, 10) +
      Number.parseInt(el.style.animationDuration, 10)
    const litUntil = Math.max(...lit.map(endOf))
    const signal = lastLitOf(dom)
    assert.equal(endOf(signal), litUntil, '接手的信号没挂在最后亮透的那一格上')

    // 而游戏区那层罩要到 litUntil + gameGap + gameFade 才淡完：两者之间正是
    // 用户说的那 1.8 秒空窗，现在被各幕填上了
    const veil = dom.gameArea.children[0]
    assert.equal(endOf(veil), litUntil + ACT1_REST)
    assert.ok(targets.items.every((row) => row.dataset.kansoIn === undefined), '还没到就先演了')

    handOff(dom)
    assert.ok(targets.items.every((row) => row.dataset.kansoIn === 'roster'), '亮透了各幕还没接手')
  } finally {
    handle.cancel()
  }
})

test('接手认名字：格子里别的动画结束不算数（animationend 会冒泡）', () => {
  const targets = fakeRoster(6)
  const dom = installDom()
  const handle = armLaunchGlow(true)
  try {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets))
    lastLitOf(dom).fire('animationend', 'ru-shatter-in')
    assert.ok(
      targets.items.every((row) => row.dataset.kansoIn === undefined),
      '被格子里无关的动画提前唤起来了：各幕会在格子还暗着的时候开演',
    )
    handOff(dom)
    assert.ok(targets.items.every((row) => row.dataset.kansoIn === 'roster'))
  } finally {
    handle.cancel()
  }
})

test('接手的兜底定时器：animationend 没来也会在 litUntil 那一刻准时接手', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const targets = fakeRoster(6)
    const dom = installDom()
    const handle = armLaunchGlow(true)
    handle.run(ONLY_BOTTOM, stagesOf(() => targets))
    const signal = lastLitOf(dom)
    const litUntil =
      Number.parseInt(signal.style.animationDelay, 10) +
      Number.parseInt(signal.style.animationDuration, 10)
    t.mock.timers.tick(litUntil - 1)
    assert.ok(targets.items.every((row) => row.dataset.kansoIn === undefined), '提前开演了')
    t.mock.timers.tick(1)
    assert.ok(
      targets.items.every((row) => row.dataset.kansoIn === 'roster'),
      'animationend 丢了就再也接不上手：各幕连同仪式态一起被漏在半路',
    )
    // 迟到的 animationend 不许再放一遍（接手是幂等的）
    const before = classEvents.length
    signal.fire('animationend', signal.style.animationName)
    assert.equal(classEvents.length, before, '同一幕被接手了两次')
    handle.cancel()
  } finally {
    t.mock.timers.reset()
  }
})

test('第二幕认名字才收场：行里别的动画（击沉碎裂卡）结束不算数', () => {
  const targets = fakeRoster(3)
  playToAct2(() => targets)
  // 碎裂卡的 animationend 会从子节点冒泡上来；不认名字的话整幕会被它提前收掉
  targets.items[2].fire('animationend', 'ru-shatter-in')
  assert.equal(targets.host.children.length, 1, '被无关动画提前收场了')
  assert.ok(targets.items[0].dataset.kansoIn === 'roster')
  targets.items[2].fire('animationend', 'kanso-roster-row')
  assert.equal(targets.host.children.length, 0)
})

test('第二幕门条：锐没摆出来就整幕跳过，一个节点都不加', () => {
  const targets = fakeRoster(6)
  const { dom } = playToAct2(() => null)
  assert.equal(targets.host.children.length, 0)
  assert.ok(targets.items.every((row) => row.dataset.kansoIn !== 'roster'))
  assert.ok(!dom.body.classes.has(CEREMONY), '整幕跳过也要摘仪式态')
  // 一幕都没得演也不当场落幕：游戏区那层黑罩还在淡，撕掉它画面会「啪」地跳亮
  assert.equal(dom.gameArea.children.length, 1)
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0, '整幕跳过之后监听也该退干净')
})

test('第二幕空态：面板上一行都没有时只放加载段，不硬造行', () => {
  const targets = fakeRoster(0)
  playToAct2(() => targets)
  assert.equal(targets.host.children.length, 1)
  // 这一局最后结束的是加载罩自己
  targets.host.children[0].fire('animationend', 'kanso-roster-veil')
  assert.equal(targets.host.children.length, 0)
})

test('第一幕被点掉时第二幕不再上演（同一场仪式，一起取消）', () => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  const targets = fakeRoster(6)
  handle.run(ONLY_BOTTOM, stagesOf(() => targets))
  const veil = dom.gameArea.children[0]
  dom.fireDoc('pointerdown')
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(targets.host.children.length, 0, '第一幕都跳过了，第二幕不该再来')
  assert.ok(targets.items.every((row) => row.dataset.kansoIn !== 'roster'))
  // 迟到的罩层 animationend 也不该把第二幕唤起来（点掉之后整场就是落幕了）
  veil.fire('animationend', 'kanso-glow-game')
  assert.equal(targets.host.children.length, 0)
  assert.equal(dom.docListenerCount(), 0)
})

test('各幕与游戏区正并排跑时被点一下：两边一起到终态，一次点击收全场', () => {
  const targets = fakeRoster(6)
  const { dom } = playToAct2(() => targets)
  assert.equal(targets.host.children.length, 1)
  assert.equal(dom.gameArea.children.length, 1, '这一刻游戏区应当还在淡入')
  dom.fireDoc('pointerdown')
  assert.equal(targets.host.children.length, 0)
  // 「点一下直接到位」是整场一起到位：并行开来之后多出的这段窗口里，
  // 收掉各幕却把游戏区那层黑罩留着，就是点完还得再等一秒八
  assert.equal(dom.gameArea.children.length, 0, '点了跳过，游戏区那层黑罩却还留着')
  assert.ok(targets.items.every((row) => row.dataset.kansoIn !== 'roster'))
  assert.ok(targets.items.every((row) => row.style.animationDelay === ''))
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.docListenerCount(), 0)
})

test('被模块重渲打断：体面收场——不重挂、不碰新 DOM、旧引用上清理不抛', () => {
  const targets = fakeRoster(6)
  const { dom, handle } = playToAct2(() => targets)
  const loader = targets.host.children[0]

  // 模拟锐的一次真重渲：commitPaneHtml 里 root.innerHTML = html，
  // 加载罩与所有旧行一起离开文档，换上一批全新的行
  targets.host.children = []
  loader.parentNode = null
  for (const row of targets.items) row.parentNode = null
  const fresh = Array.from({ length: 6 }, () => new FakeElement('div'))
  for (const row of fresh) targets.host.appendChild(row)

  // 这条路上没有 animationend（节点都不在文档里了），收尾人是看门狗——
  // 它跑的就是 cancel 这一套。旧引用上清理必须是空转，不能抛。
  assert.doesNotThrow(() => handle.cancel())

  // 新 DOM 一个字没被碰过：它本来就是终态，这才是「体面」
  for (const row of fresh) {
    assert.ok(row.dataset.kansoIn !== 'roster', '往新 DOM 上重挂了动画')
    assert.deepEqual(row.style, {})
  }
  assert.deepEqual(targets.host.children, fresh, '把新行挤掉了')
  // 旧引用上的残留状态清干净了（它们可能还被别处引用着）
  for (const row of targets.items) {
    assert.ok(row.dataset.kansoIn !== 'roster')
    assert.equal(row.style.animationDelay, '')
  }
  assert.equal(dom.docListenerCount(), 0)
})

// ---- 仪式态：编队行从开场就隐身，且每一条退出路径都必须把它摘掉 ----
//
// 漏摘一条 = 「编队永远隐身」，是这套东西最大的风险面，所以逐条钉。
//（CEREMONY 这个常量声明在上面的公共段里，各幕的用例都要用它。）

test('仪式态从罩暗那一刻就挂上——不是等第二幕开场才藏行', () => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  assert.ok(
    dom.body.classes.has(CEREMONY),
    '装配阶段就该挂仪式态：第一幕点亮锐那一格时行必须已经是隐的',
  )
  // 而且是**和罩暗同时**上的，中间没有任何一拍空窗
  const added = classEvents.filter((e) => e.el === dom.body && e.action === 'add')
  assert.deepEqual(added.map((e) => e.name), ['kanso-glow', CEREMONY])
  handle.cancel() // 收掉装配看门狗，别让它把整个测试进程吊着
})

test('仪式态靠祖先规则压住锐的行：任何时刻新生的行天生隐身', () => {
  const html = styleSheet()
  const rule = /body\.kanso-ceremony ([^{]+)\{([^}]*)\}/.exec(html)
  assert.ok(rule, '样式表里没有仪式态压行的规则')
  const selector = rule[1].trim()
  // 必须是**祖先选择器**：不能要求行自己带某个类，否则第一幕期间锐重渲出来的新行
  // 就漏网了（这次的 bug 正是「藏」发生得太晚）
  assert.match(selector, /\.mod-ru/, '压的不是锐的面板')
  assert.match(selector, /\.ships \.ship$/, '压的不是舰娘行')
  assert.ok(!/kanso-roster/.test(selector), '祖先规则不许依赖逐行加的类')
  // 只压 opacity：面板框架照常跟着格子点亮，也不许动布局
  const props = [...rule[2].matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
  assert.deepEqual(props, ['opacity'], '仪式态只准压 opacity')
  assert.match(rule[2], /opacity:\s*0/)
})

test('交接无闪帧：先给各行挂进场动画，再摘仪式态（次序即判据）', (t) => {
  const targets = fakeRoster(6)
  const { dom, handle } = playToAct2(() => targets)
  t.after(() => handle.cancel()) // 收掉第二幕看门狗
  assert.ok(!dom.body.classes.has(CEREMONY), '第二幕开场后仪式态该摘了')

  const removeAt = classEvents.findIndex(
    (e) => e.el === dom.body && e.action === 'remove' && e.name === CEREMONY,
  )
  assert.ok(removeAt >= 0, '仪式态一直没摘')
  for (const row of targets.items) {
    const addAt = classEvents.findIndex(
      (e) => e.el === row && e.action === 'mark' && e.name === 'kansoIn=roster',
    )
    assert.ok(addAt >= 0, '有行没拿到进场动画')
    assert.ok(
      addAt < removeAt,
      '先摘仪式态再挂动画：这一帧行会全亮一下，正是用户报的「先全看一遍再重演」',
    )
  }
})

test('第二幕整幕跳过（锐没摆出来）也要摘仪式态，否则编队永远隐身', () => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  handle.run(ONLY_BOTTOM, stagesOf(() => null))
  assert.ok(dom.body.classes.has(CEREMONY))
  // 摘仪式态跟着**接手**走，不跟着第一幕落幕走：整幕跳过也得在这一刻摘掉
  handOff(dom)
  assert.ok(!dom.body.classes.has(CEREMONY), '锐没摆出来就把编队藏死了')
  endAct1(dom)
  assert.equal(dom.body.classes.size, 0)
})

test('每一条退出路径都摘仪式态，且编队行与资源数字都回到可见的真值', () => {
  // 每一局都同时带上编队行与资源数字：仪式态压的是两处，漏摘的后果也是两处
  const REAL = ['300,000', '90']
  const played = (setUp) => {
    const targets = fakeRoster(6)
    const cells = fakeDigits(...REAL)
    const dom = installDom()
    const handle = armLaunchGlow(true)
    setUp({ dom, handle, targets, cells })
    // 仪式态摘了 = 两处都不再被压着；数字还得是真值而不是停在乱滚的某一帧
    assert.ok(!dom.body.classes.has(CEREMONY), '漏摘仪式态：编队与资源数字会永远隐身')
    assert.ok(targets.items.every((row) => row.dataset.kansoIn !== 'roster'))
    cells.forEach((cell, i) => assert.equal(cell.textContent, REAL[i], '数字停在乱滚态了'))
    assert.equal(dom.docListenerCount(), 0)
    return dom
  }

  // ① run 之前就 cancel（启动失败：startupFailed 走的就是这条）
  played(({ handle }) => handle.cancel())
  // ② 第一幕进行中被点掉
  played(({ dom, handle, targets, cells }) => {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets, () => cells))
    dom.fireDoc('pointerdown')
  })
  // ③ 第一幕进行中 cancel
  played(({ handle, targets, cells }) => {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets, () => cells))
    handle.cancel()
  })
  // ④ 各幕与游戏区正并排跑时被点掉（并行开来之后新多出的那段窗口）
  played(({ dom, handle, targets, cells }) => {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets, () => cells))
    handOff(dom)
    dom.fireDoc('pointerdown')
  })
  // ⑤ 被模块重渲打断后由收尾人清理（行与数字都换了新 DOM）
  played(({ dom, handle, targets, cells }) => {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets, () => cells))
    handOff(dom)
    targets.host.children = []
    for (const row of targets.items) row.parentNode = null
    handle.cancel()
  })
  // ⑥ 锐没展开、锱也没数字：两幕都整幕跳过，落幕仍要等游戏区淡完
  played(({ dom, handle }) => {
    handle.run(ONLY_BOTTOM, stagesOf(() => null, () => []))
    handOff(dom)
    endAct1(dom)
  })
  // ⑦ 各幕自己放完了，收尾人是第一幕：并行之后「谁最后收工」可能是游戏区
  played(({ dom, handle, targets, cells }) => {
    handle.run(ONLY_BOTTOM, stagesOf(() => targets, () => cells))
    handOff(dom)
    targets.items[5].fire('animationend', 'kanso-roster-row')
    handle.cancel() // 数字那幕还在滚，由收尾人一并收掉
  })
})

// ---- 第三幕：并行、接手、退出 ----

test('第三幕与第二幕并行开演：数字在摘仪式态之前就被接手成乱滚态', () => {
  const targets = fakeRoster(6)
  const cells = fakeDigits('300,000', '90', '12.3k')
  const real = ['300,000', '90', '12.3k']
  const { dom, handle } = playToAct2(() => targets, () => cells)
  try {
    // 长度与分隔符全程不动
    cells.forEach((cell, i) => {
      assert.equal(cell.textContent.length, real[i].length, '长度变了会抖动')
      assert.equal(
        cell.textContent.replace(/\d/g, '#'),
        real[i].replace(/\d/g, '#'),
        '分隔符/后缀跑位了',
      )
    })
    // 「接手在现身之前」：每个数字都在 body 摘掉仪式态**之前**被写过一次
    const removeAt = classEvents.findIndex(
      (e) => e.el === dom.body && e.action === 'remove' && e.name === CEREMONY,
    )
    assert.ok(removeAt >= 0)
    for (const cell of cells) {
      const firstWrite = classEvents.findIndex(
        (e, i) => i > 0 && e.el === cell && e.action === 'text' && i < removeAt,
      )
      assert.ok(firstWrite > 0, '数字还没被接手就把仪式态摘了：会闪一下真值')
    }
    // 编队那边照常并行进行
    assert.equal(targets.host.children.length, 1, '第三幕不该妨碍第二幕')
    assert.ok(targets.items[0].dataset.kansoIn === 'roster')
  } finally {
    handle.cancel()
  }
})

test('三方都收工才整场落幕：各幕之外，游戏区那段淡入也算一方', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const targets = fakeRoster(6)
    const cells = fakeDigits('300,000')
    const { dom } = playToAct2(() => targets, () => cells)
    // 第二幕先收工（最后一行落定），第三幕还在滚
    targets.items[5].fire('animationend', 'kanso-roster-row')
    assert.equal(targets.host.children.length, 0, '第二幕自己该收干净')
    assert.notEqual(cells[0].textContent, '300,000', '第三幕不该被第二幕拖着一起收')
    assert.equal(dom.docListenerCount(), 2, '还没落幕，跳过用的监听得留着')
    // 第三幕也跑到共同终点：并行之后这仍然不算落幕——游戏区还在淡入
    t.mock.timers.tick(launchDigitsPlan([6]).end + LAUNCH_DIGITS_TIMING.tick)
    assert.equal(cells[0].textContent, '300,000', '到终点该显示真值')
    assert.equal(dom.gameArea.children.length, 1, '各幕收工就把游戏区的淡入撕掉了')
    assert.equal(dom.docListenerCount(), 2, '游戏区还在淡，不该落幕')
    // 游戏区淡完，三方齐了
    endAct1(dom)
    assert.equal(dom.docListenerCount(), 0, '都收工了才该落幕')
    assert.equal(dom.body.classes.size, 0)
  } finally {
    t.mock.timers.reset()
  }
})

test('第三幕只用一只共享 interval，收场即停', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const cells = fakeDigits('300,000', '90', '12.3k', '1,234', '56', '7')
    const { handle } = playToAct2(() => null, () => cells)
    const writesBefore = classEvents.filter((e) => e.action === 'text').length
    t.mock.timers.tick(LAUNCH_DIGITS_TIMING.tick)
    const afterOneTick = classEvents.filter((e) => e.action === 'text').length
    assert.ok(afterOneTick > writesBefore, '一拍下去六个数字该一起被重画')
    handle.cancel()
    const afterCancel = classEvents.filter((e) => e.action === 'text').length
    t.mock.timers.tick(LAUNCH_DIGITS_TIMING.tick * 20)
    assert.equal(
      classEvents.filter((e) => e.action === 'text').length,
      afterCancel,
      '收场之后表还在走：这就是常驻定时器了',
    )
  } finally {
    t.mock.timers.reset()
  }
})

test('第三幕门条：锱没展开且顶栏没数字时整幕跳过，不拦着第二幕落幕', () => {
  const targets = fakeRoster(6)
  const { dom } = playToAct2(() => targets, () => [])
  targets.items[5].fire('animationend', 'kanso-roster-row')
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0, '第三幕空着却把落幕吊住了')
  assert.equal(dom.body.classes.size, 0)
})

test('第三幕：只有空态数字（—）也当没有，不硬滚', () => {
  const cells = fakeDigits('—', '')
  const { dom } = playToAct2(() => null, () => cells)
  assert.equal(cells[0].textContent, '—')
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0, '没有可滚的数字就该当场落幕')
})

test('第三幕被点掉/取消：数字立刻回到真值', () => {
  for (const stop of ['click', 'cancel']) {
    const cells = fakeDigits('300,000', '90')
    const { dom, handle } = playToAct2(() => null, () => cells)
    if (stop === 'click') dom.fireDoc('pointerdown')
    else handle.cancel()
    assert.equal(cells[0].textContent, '300,000', `${stop} 之后数字没回真值`)
    assert.equal(cells[1].textContent, '90')
    assert.ok(!dom.body.classes.has(CEREMONY), `${stop} 之后仪式态没摘，数字会永远隐身`)
  }
})

test('第三幕看门狗兜底：一拍都没跑到也会把数字还回去', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const cells = fakeDigits('300,000')
    const { dom } = playToAct2(() => null, () => cells)
    // 看门狗至少要等到游戏区那段淡入也该收尾了才动手（见 stageWatchdogAt）
    t.mock.timers.tick(stageWatchdogAt(launchDigitsPlan([6]).total) + 10)
    assert.equal(cells[0].textContent, '300,000')
    assert.equal(dom.body.classes.size, 0)
  } finally {
    t.mock.timers.reset()
  }
})

test('第三幕被模块重渲打断：旧引用不写回旧值，新 DOM 一个字不碰', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const cells = fakeDigits('300,000', '90')
    const { handle } = playToAct2(() => null, () => cells)
    t.mock.timers.tick(LAUNCH_DIGITS_TIMING.tick * 2)
    // 锱重渲：旧的数字元素离开文档，新元素上是**新的**真值
    const holder = cells[0].parentNode
    const fresh = new FakeElement('b')
    holder.appendChild(fresh)
    fresh.textContent = '312,450' // 登录后资源同步过来，值已经变了
    for (const cell of cells) cell.parentNode = null
    const freshWrites = classEvents.filter((e) => e.el === fresh).length
    const staleWrites = () => classEvents.filter((e) => cells.includes(e.el)).length

    // 离开文档之后就不该再被写：我们手上那份 real 已经是过期的值了
    const staleBefore = staleWrites()
    t.mock.timers.tick(LAUNCH_DIGITS_TIMING.tick * 3)
    assert.equal(staleWrites(), staleBefore, '还在往已经被换掉的旧元素上写')

    handle.cancel()
    assert.equal(fresh.textContent, '312,450', '拿旧值把新 DOM 覆盖了')
    assert.equal(
      classEvents.filter((e) => e.el === fresh).length,
      freshWrites,
      '收场时去碰了新 DOM',
    )
    assert.equal(staleWrites(), staleBefore, '收场时又拿旧值往旧元素上写了一遍')
    t.mock.timers.tick(LAUNCH_DIGITS_TIMING.tick * 20)
    assert.equal(classEvents.filter((e) => e.el === fresh).length, freshWrites, '表没停')
  } finally {
    t.mock.timers.reset()
  }
})

test('仪式态把两处数字都压住：锱面板与顶栏各一条祖先规则', () => {
  const html = styleSheet()
  const rule = /body\.kanso-ceremony ([^{]*\.hs-res b)[^{]*\{([^}]*)\}/.exec(html)
  assert.ok(rule, '顶栏数字没被仪式态压住——它不在第一幕罩暗范围里，从头就看得见')
  assert.match(rule[1], /#header-status/)
  assert.match(rule[0], /\.mod-zi \.tiles \.tile \.v/, '锱的资源数字没被压住')
  const props = [...rule[2].matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
  assert.deepEqual(props, ['opacity'], '仪式态只准压 opacity')
  assert.match(rule[2], /opacity:\s*0\s*;/, '压是压了，值却不是 0——等于没压')
  // 乱滚不许引起重排：两处数字都得是等宽/tabular-nums
  assert.match(html, /\.mod-zi \.tile \.v \{[^}]*font-variant-numeric: tabular-nums/)
  assert.match(html, /#header-status \.hs-res b \{[^}]*font-variant-numeric: tabular-nums/)
})

test('锱 · 资源盘那一幕：磁贴外壳与右栏各卡预隐，数字那一格不许被隐第二次', () => {
  const html = styleSheet()
  const wiring = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/index.ts', import.meta.url)),
    'utf8',
  )
  // 预隐两条：磁贴外壳、右栏各卡。压的都是**块**这一层，不是块里的内容
  //（锱在第一幕期间随时可能首渲/重渲，压这一层才管得住那一刻新生的块）
  const rule = /body\.kanso-ceremony (\.ws-pane\.mod-zi \.tiles \.tile,[^{]*)\{([^}]*)\}/.exec(html)
  assert.ok(rule, '锱的磁贴外壳没被仪式态压住：第一幕点亮锱那一格时它会先露一遍')
  assert.match(rule[1], /\.ws-pane\.mod-zi \.side > \*/, '右栏各卡没被压住')
  const props = [...rule[2].matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
  assert.deepEqual(props, ['opacity'], '仪式态只准压 opacity')
  assert.match(rule[2], /opacity:\s*0\s*;/)
  // **不许再压一次数字**：`.tile .v` 归数字自检那一幕，两幕压同一个元素就要靠运气摘了
  assert.ok(!/\.v\b/.test(rule[1]), '资源盘那条预隐把数字也圈进来了')

  const stage = /id: 'zi',[\s\S]*?\n  \},/.exec(wiring)
  assert.ok(stage, '注册表里找不到锱那一幕')
  assert.ok(
    !/\.tiles \.tile \.v/.test(stage[0]),
    '锱这一幕把数字也当成了自己的元素：数字自检幕已经接管它了',
  )
  assert.match(stage[0], /kids\(host, '\.tiles \.tile'\)/, '磁贴外壳没进这一幕')
  assert.match(stage[0], /kids\(host, '\.side > \*'\)/, '右栏各卡没进这一幕')
  assert.match(stage[0], /items: capped\(/, '锱这一幕没封顶')
})

test('第三幕认的是锱与顶栏的数字标记：三头接线必须对得上', () => {
  const wiring = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/index.ts', import.meta.url)),
    'utf8',
  )
  const zi = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/modules/zi.ts', import.meta.url)),
    'utf8',
  )
  const header = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/header-status.ts', import.meta.url)),
    'utf8',
  )
  assert.match(wiring, /'\.tiles \.tile \.v'/, '镇壳取锱数字的选择器变了')
  assert.match(wiring, /'#header-status \.hs-res b'/, '镇壳取顶栏数字的选择器变了')
  assert.match(zi, /<div class="tiles">/, '锱不再输出 .tiles 容器')
  assert.match(zi, /<div class="v">/, '锱的资源数字不再住在 .v 里')
  assert.match(header, /class="hs-res/, '顶栏不再输出 .hs-res')
  assert.match(header, /<b>\$\{fmtShort\(value\)\}<\/b>/, '顶栏的资源数字不再住在 <b> 里')
})

// ---- 镝 / 铎：右坞那一格，当前页是谁谁演 ----

const staggerStage = (over) => ({
  kind: 'stagger',
  id: 'x',
  hides: '.x',
  mark: 'battle',
  animation: 'kanso-battle-',
  overlay: { className: 'kanso-battle-scan', animation: 'kanso-battle-veil' },
  timing: LAUNCH_BATTLE_TIMING,
  ...over,
})

const playStages = (stages) => {
  const dom = installDom()
  const handle = armLaunchGlow(true)
  handle.run(ONLY_BOTTOM, stages)
  handOff(dom)
  return { dom, handle }
}

test('镝 · 战术屏：扫描线盖上去，左右两栏交错着相向合拢', () => {
  const targets = fakeRoster(6)
  const { dom, handle } = playStages([staggerStage({ pick: () => targets })])
  try {
    const scan = targets.host.children[0]
    assert.equal(scan.className, 'kanso-battle-scan', '扫描线没盖上')
    assert.equal(scan.style.animationDuration, `${LAUNCH_BATTLE_TIMING.loading}ms`)
    assert.equal(scan.children.length, 1, '缺了那条扫描亮带')
    const plan = launchStaggerPlan(6, LAUNCH_BATTLE_TIMING)
    targets.items.forEach((el, index) => {
      assert.equal(el.dataset.kansoIn, 'battle', `第 ${index} 块没进场`)
      assert.equal(el.style.animationDelay, `${plan.rows[index].delay}ms`)
      assert.equal(el.style.animationDuration, `${LAUNCH_BATTLE_TIMING.row}ms`)
    })
    assert.ok(!dom.body.classes.has(CEREMONY))
    // 收场认的是**前缀**：一幕两条变体（左 kanso-battle-l / 右 kanso-battle-r）都收得住
    targets.items[5].fire('animationend', 'kanso-battle-r')
    assert.equal(targets.host.children.length, 0, '扫描线没摘掉')
    assert.ok(targets.items.every((el) => el.dataset.kansoIn === undefined))
  } finally {
    handle.cancel()
  }
})

test('镝 · 左栏那一条变体同样收得住（前缀匹配不是只认右栏）', () => {
  const targets = fakeRoster(3)
  const { handle } = playStages([staggerStage({ pick: () => targets })])
  try {
    targets.items[2].fire('animationend', 'kanso-battle-l')
    assert.equal(targets.host.children.length, 0)
  } finally {
    handle.cancel()
  }
})

test('镝 · 空态（待机/上次快照的空壳）只演扫描线，不硬造分区', () => {
  const targets = fakeRoster(0)
  const { dom } = playStages([staggerStage({ pick: () => targets })])
  assert.equal(targets.host.children.length, 1, '空态该只剩一条扫描线')
  targets.host.children[0].fire('animationend', 'kanso-battle-veil')
  assert.equal(targets.host.children.length, 0)
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0)
})

test('铎 · 作战公告不带罩：一个节点都不加，只逐块垂下', () => {
  const targets = fakeRoster(5)
  const brief = {
    kind: 'stagger',
    id: 'brief',
    hides: '.y',
    mark: 'brief',
    animation: 'kanso-brief-drop',
    timing: LAUNCH_BRIEF_TIMING,
    pick: () => targets,
  }
  const { dom, handle } = playStages([brief])
  try {
    assert.equal(targets.host.children.length, 0, '不带罩的幕不该往宿主里塞节点')
    const plan = launchStaggerPlan(5, LAUNCH_BRIEF_TIMING)
    assert.equal(plan.loading, 0)
    targets.items.forEach((el, index) => {
      assert.equal(el.dataset.kansoIn, 'brief')
      assert.equal(el.style.animationDelay, `${plan.rows[index].delay}ms`)
    })
    assert.ok(!dom.body.classes.has(CEREMONY))
  } finally {
    handle.cancel()
  }
})

test('铎 · 不带罩又一块都没有 = 整幕跳过（活动期外它本来就退场了）', () => {
  const targets = fakeRoster(0)
  const brief = {
    kind: 'stagger',
    id: 'brief',
    hides: '.y',
    mark: 'brief',
    animation: 'kanso-brief-drop',
    timing: LAUNCH_BRIEF_TIMING,
    pick: () => targets,
  }
  const { dom } = playStages([brief])
  assert.equal(targets.host.children.length, 0)
  assert.ok(!dom.body.classes.has(CEREMONY), '整幕跳过也得摘仪式态')
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0, '没得演却把落幕吊住了')
  assert.equal(dom.body.classes.size, 0)
})

test('选择器失配的静默退化：带罩的只剩罩，不带罩的整幕跳过——都不许卡住落幕', () => {
  // 接线层的选择器哪天与模块对不上，pick() 会给出空 items。这是**静默**的坏法，
  // 所以两种形态各钉一条：仪式照旧走完、内容照旧现身，只是少了那一下动画。
  const withScan = fakeRoster(0)
  const noScan = fakeRoster(0)
  const { dom } = playStages([
    staggerStage({ pick: () => withScan }),
    { kind: 'stagger', id: 'brief', hides: '.y', mark: 'brief', animation: 'kanso-brief-drop', timing: LAUNCH_BRIEF_TIMING, pick: () => noScan },
  ])
  assert.equal(withScan.host.children.length, 1, '带罩的幕该退化成「只剩罩」')
  assert.equal(noScan.host.children.length, 0, '不带罩的幕该整幕跳过')
  withScan.host.children[0].fire('animationend', 'kanso-battle-veil')
  endAct1(dom)
  assert.equal(dom.body.classes.size, 0, '仪式没走完，内容会永远隐身')
  assert.equal(dom.docListenerCount(), 0)
})

test('并行各幕：全部收工才落幕，谁都不许拖垮别人', () => {
  const a = fakeRoster(4)
  const b = fakeRoster(3)
  const { dom } = playStages([
    rosterStage(() => a),
    staggerStage({ pick: () => b }),
  ])
  a.items[3].fire('animationend', 'kanso-roster-row')
  assert.equal(a.host.children.length, 0, '第一幕自己该收干净')
  assert.equal(b.host.children.length, 1, '被别人拖着一起收了')
  assert.equal(dom.docListenerCount(), 2, '还没落幕，跳过用的监听得留着')
  b.items[2].fire('animationend', 'kanso-battle-l')
  assert.equal(dom.docListenerCount(), 2, '游戏区还在淡入，不该落幕')
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0, '全收工了才该落幕')
  assert.equal(dom.body.classes.size, 0)
})

// ---- 顶栏角标 · 收官对齐资源数字 ----

test('对齐排程：最后一个恰好落在给定终点，其余往回倒排', () => {
  const t = LAUNCH_BADGE_TIMING
  const END = 1110 // 六位数时资源数字的共同终点
  for (const count of [1, 2, 4, 5]) {
    const plan = launchStaggerPlan(count, t, END)
    assert.equal(plan.loading, 0, '对齐模式下不该还有罩')
    assert.equal(
      plan.rows[count - 1].delay + t.row,
      END,
      `${count} 组：最后一组没落在终点上，顶栏就成了一半先停一半还在动`,
    )
    assert.equal(plan.total, END)
    for (let i = 1; i < count; i++) {
      assert.equal(plan.rows[i].delay - plan.rows[i - 1].delay, plan.step, '组间不是等距')
    }
    assert.ok(plan.rows[0].delay >= 0, '倒推出了负的起跑时刻')
  }
})

test('对齐排程：终点近到装不下时夹到 0，且 total 如实报出真正的收尾时刻', () => {
  const t = LAUNCH_BADGE_TIMING
  const plan = launchStaggerPlan(6, t, 200) // 200ms 连一个 row(300ms) 都放不下
  assert.ok(plan.rows.every((row) => row.delay >= 0), '倒推出了负的起跑时刻')
  assert.equal(plan.rows[0].delay, 0)
  // 终点比一个 row 还近时**对不齐是必然的**：动画本身就比整个窗口长。
  // 这时 total 要如实报 row 结束的那一刻，不能谎报成 endAt——看门狗按 total 定时。
  assert.equal(plan.total, t.row)
  assert.equal(plan.rows[5].delay + t.row, t.row)
  // 真机上够不到这个区间：只要有一个数字，终点至少是 scramble(560) > row(300)
  assert.ok(LAUNCH_DIGITS_TIMING.scramble > t.row, '前提变了，夹紧区间可能被真机碰到')
  assert.equal(launchDigitsPlan([1]).end, LAUNCH_DIGITS_TIMING.scramble)
})

test('对齐排程：不给终点（或给 0）就退回自己的节奏', () => {
  const t = LAUNCH_BADGE_TIMING
  assert.deepEqual(launchStaggerPlan(4, t, 0), launchStaggerPlan(4, t))
  // 没有任何资源数字时 launchDigitsPlan 给出的终点就是 0，正是这条退路
  assert.equal(launchDigitsPlan([]).end, 0)
  assert.equal(launchDigitsPlan([0, 0]).end, 0)
})

test('顶栏角标与资源数字同刻收官：两幕各算各的，结果必须一致', () => {
  // 这是「不共享状态、各自用同一个纯函数算一遍」那条设计的核心断言：
  // 只要两边喂的是同一份位数，终点就必然相同。
  for (const counts of [[6, 6, 6, 2, 3], [3, 3], [6], [2, 5, 4, 6, 6, 3, 2, 2]]) {
    const digits = launchDigitsPlan(counts)
    const badges = launchStaggerPlan(4, LAUNCH_BADGE_TIMING, digits.end)
    assert.equal(
      badges.rows[3].delay + LAUNCH_BADGE_TIMING.row,
      digits.end,
      `位数 ${counts} 下两幕收官时刻对不上`,
    )
  }
})

test('骨架真的把 alignEnd 接到了排程上（注册表说要对齐，元素就得按倒排落位）', () => {
  const targets = fakeRoster(4)
  const END = 1110
  const { handle } = playStages([
    {
      kind: 'stagger',
      id: 'badge',
      hides: '.h',
      mark: 'badge',
      animation: 'kanso-badge-lit',
      timing: LAUNCH_BADGE_TIMING,
      alignEnd: () => END,
      pick: () => targets,
    },
  ])
  try {
    const delays = targets.items.map((el) => Number.parseInt(el.style.animationDelay, 10))
    assert.deepEqual(delays, launchStaggerPlan(4, LAUNCH_BADGE_TIMING, END).rows.map((r) => r.delay))
    assert.equal(
      delays[3] + LAUNCH_BADGE_TIMING.row,
      END,
      'alignEnd 没被接上：角标会按自己的节奏收，跟数字对不齐',
    )
    // 不给 alignEnd 的幕照旧走自己的节奏（这条顺带钉住「对齐是可选的」）
    const plain = fakeRoster(4)
    const other = playStages([
      {
        kind: 'stagger',
        id: 'plain',
        hides: '.h',
        mark: 'badge',
        animation: 'kanso-badge-lit',
        timing: LAUNCH_BADGE_TIMING,
        pick: () => plain,
      },
    ])
    assert.equal(
      Number.parseInt(plain.items[0].style.animationDelay, 10),
      launchStaggerPlan(4, LAUNCH_BADGE_TIMING).rows[0].delay,
    )
    other.handle.cancel()
  } finally {
    handle.cancel()
  }
})

test('顶栏角标：形态克制——顶栏只有一行高，位移必须很小', () => {
  const html = styleSheet()
  const block = /@keyframes kanso-badge-lit\s*\{([\s\S]*?)\n    \}/.exec(html)
  assert.ok(block, '没有 kanso-badge-lit')
  const shift = /translate3d\(0, (-?\d+)px, 0\)/.exec(block[1])
  assert.ok(shift, '角标的关键帧没写位移')
  assert.ok(Math.abs(Number(shift[1])) <= 3, `位移 ${shift[1]}px：顶栏只有一行高，会读成抖动`)
  assert.match(block[1], /opacity: 0/)
})

test('鉴/钦/镖三幕：不带罩，各自的标记与节拍都对得上', () => {
  const cases = [
    ['tome', 'kanso-tome-lit', LAUNCH_TOME_TIMING, 9],
    ['order', 'kanso-order-in', LAUNCH_ORDER_TIMING, 12],
    ['dispatch', 'kanso-dispatch-tick', LAUNCH_DISPATCH_TIMING, 8],
  ]
  for (const [mark, animation, timing, count] of cases) {
    const targets = fakeRoster(count)
    const { dom, handle } = playStages([
      { kind: 'stagger', id: mark, hides: '.h', mark, animation, timing, pick: () => targets },
    ])
    try {
      assert.equal(targets.host.children.length, 0, `${mark} 不带罩，不该往宿主里塞节点`)
      const plan = launchStaggerPlan(count, timing)
      targets.items.forEach((el, index) => {
        assert.equal(el.dataset.kansoIn, mark, `${mark} 第 ${index} 个没进场`)
        assert.equal(el.style.animationDelay, `${plan.rows[index].delay}ms`)
        assert.equal(el.style.animationDuration, `${timing.row}ms`)
      })
      assert.ok(!dom.body.classes.has(CEREMONY))
      // 各行延时严格递增 = 一条条推进来，而不是一起冒出来
      const delays = targets.items.map((el) => Number.parseInt(el.style.animationDelay, 10))
      for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1])
      targets.items[count - 1].fire('animationend', animation)
      assert.ok(targets.items.every((el) => el.dataset.kansoIn === undefined), `${mark} 没清干净`)
    } finally {
      handle.cancel()
    }
  }
})

test('镖 · 右栏详情排在队尾：总表逐行点完，它才整块现身', () => {
  const targets = fakeRoster(6) // 前 5 个当总表行，最后一个当右栏详情
  const { handle } = playStages([
    {
      kind: 'stagger',
      id: 'dispatch',
      hides: '.h',
      mark: 'dispatch',
      animation: 'kanso-dispatch-tick',
      timing: LAUNCH_DISPATCH_TIMING,
      pick: () => targets,
    },
  ])
  try {
    const delays = targets.items.map((el) => Number.parseInt(el.style.animationDelay, 10))
    assert.equal(delays[5], Math.max(...delays), '详情没排在队尾，就不是「随后」现身了')
  } finally {
    handle.cancel()
  }
})

test('鉴 · 空态（那一卷什么都没有）：整幕跳过，不拦着别人落幕', () => {
  const targets = fakeRoster(0)
  const { dom } = playStages([
    {
      kind: 'stagger',
      id: 'tome',
      hides: '.h',
      mark: 'tome',
      animation: 'kanso-tome-lit',
      timing: LAUNCH_TOME_TIMING,
      pick: () => targets,
    },
  ])
  assert.equal(targets.host.children.length, 0)
  endAct1(dom)
  assert.equal(dom.docListenerCount(), 0, '没得演却把落幕吊住了')
  assert.equal(dom.body.classes.size, 0)
})

test('鉴 · 大网格封顶：超出上限的不打标记，随所在区块整体现身', () => {
  // 接线层用 capped() 截断，这里照它的形状喂：给 40 个、只有前 24 个进来
  const all = Array.from({ length: 40 }, () => new FakeElement('div'))
  const host = new FakeElement('div')
  for (const el of all) host.appendChild(el)
  const { handle } = playStages([
    {
      kind: 'stagger',
      id: 'tome',
      hides: '.h',
      mark: 'tome',
      animation: 'kanso-tome-lit',
      timing: LAUNCH_TOME_TIMING,
      pick: () => ({ host, items: all.slice(0, LAUNCH_STAGE_ITEM_CAP) }),
    },
  ])
  try {
    const marked = all.filter((el) => el.dataset.kansoIn === 'tome')
    assert.equal(marked.length, LAUNCH_STAGE_ITEM_CAP, '封顶没生效，几百格会各起一个合成层')
    assert.ok(
      all.slice(LAUNCH_STAGE_ITEM_CAP).every((el) => el.dataset.kansoIn === undefined),
      '超出上限的还是被逐个铺了动画',
    )
    // 没打标记的那些不靠动画现身——摘掉仪式态它们就在了
    assert.equal(all[30].style.animationDelay, undefined)
  } finally {
    handle.cancel()
  }
})

const skeletonSource = () =>
  fs.readFileSync(fileURLToPath(new URL('../src/renderer/launch-glow.ts', import.meta.url)), 'utf8')

test('兜底宽限收进参数表：骨架里一个毫秒字面量都不留', () => {
  assert.deepEqual(
    Object.keys(LAUNCH_GUARD_TIMING).sort(),
    ['armCap', 'overlaySlack', 'watchdogSlack', 'welcomeFadeSlack'],
  )
  // 数值原样搬过来（这一笔只搬家，不调参）
  assert.equal(LAUNCH_GUARD_TIMING.watchdogSlack, 1500)
  assert.equal(LAUNCH_GUARD_TIMING.armCap, 12000)
  assert.equal(LAUNCH_GUARD_TIMING.overlaySlack, 400)
  assert.equal(LAUNCH_GUARD_TIMING.welcomeFadeSlack, 300)
  // 装配封顶必须明显晚于第零幕的封顶，否则「仪式先被自己的看门狗收掉，接着才轮到
  // 点火」——行为那条另有一用例真跑一遍最坏路径，这里只钉住两个数的先后
  assert.ok(LAUNCH_WELCOME_TIMING.cap < LAUNCH_GUARD_TIMING.armCap)

  const skeleton = skeletonSource()
  assert.match(skeleton, /LAUNCH_GUARD_TIMING/, '骨架没去引参数表')
  // 注释里写多少毫秒无所谓，代码里不许再有：文件自称「时长口径的单一出处是 shared」，
  // 散着几个字面量就是说的和做的对不上
  const code = skeleton.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(
    !/const\s+[A-Z][A-Z0-9_]*\s*=\s*\d+/.test(code),
    '骨架里又声明了一个毫秒常量（口径归 shared，这边只解构）',
  )
  for (const [name, value] of Object.entries(LAUNCH_GUARD_TIMING)) {
    assert.ok(
      !new RegExp(`\\b${value}\\b`).test(code),
      `骨架里又出现了字面量 ${value}（${name} 的口径在 shared）`,
    )
  }
})

test('减少动态效果：样式表那道双保险把点亮的每一处都摁到终态', () => {
  const html = styleSheet()
  const at = html.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(at > 0, '没有减少动态效果那一档')
  const block = html.slice(at)
  // JS 那边 armLaunchGlow 直接返回 null，所以这几条平时用不上；真会咬人的是
  // **仪式放到一半系统才被切成减少动态效果**——matchMedia 已经问过了，JS 不回头。
  const rules = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((hit) => [hit[1], hit[2]])
  const ruleFor = (selector) => rules.find((rule) => rule[0].includes(selector))
  for (const selector of [
    'body.kanso-glow #element-rail',
    'body.kanso-glow .dock-group',
    '[data-kanso-in]',
  ]) {
    const rule = ruleFor(selector)
    assert.ok(rule, `${selector} 没有减少动态效果的兜底：它会一直停在暗态`)
    assert.match(rule[1], /animation:\s*none\s*!important/, `${selector} 的动画没被摁停`)
    assert.match(rule[1], /opacity:\s*1\s*!important/, `${selector} 停了动画却还压着 opacity`)
  }
  // 游戏区那层黑罩反着来：终态是**透明**，照抄 opacity: 1 就是把游戏画面永久蒙黑
  const veil = ruleFor('body.kanso-glow-run #game-glow')
  assert.ok(veil, '游戏区那层黑罩没有兜底：减少动态效果时画面会一直黑着')
  assert.match(veil[1], /animation:\s*none\s*!important/)
  assert.match(veil[1], /opacity:\s*0\s*!important/, '把游戏画面永久蒙黑了')
})

test('接线层的截断与层级挑选：给多少截多少、太稀就往下探一层', () => {
  // 这两条规则住在 index.ts（DOM 知识归接线层），这里钉的是它们确实在那儿、且用的是
  // 共享的上限常量——写死一个数字或者忘了截断，都是「几百格逐格铺动画」那条路
  const wiring = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/index.ts', import.meta.url)),
    'utf8',
  )
  assert.match(wiring, /items\.slice\(0, LAUNCH_STAGE_ITEM_CAP\)/, '截断没用共享上限常量')
  assert.match(wiring, /layer\.length < 4/, '「太稀就往下探一层」的规则不见了')
  assert.match(wiring, /rippleOrder\(layer, rectOf, rectOf\(body!\)\)/, '鉴没按波纹次序排')

  // **每一幕都得封顶**，不是只有当初想得起来的那几幕。锐/镝/铎当初漏了：
  // 单舰队 6 行、联合 12 行看着够不着上限，可「够不着」是数据说了算的，
  // 而这套东西的判据是「面板上有多少就铺多少」——哪天那几处的元素多起来，
  // 表现是几十上百个合成层，且在实机上只表现为卡一下，认不出是这儿的锅。
  const registry = /const LAUNCH_STAGES: readonly LaunchStage\[\] = \[([\s\S]*?)\n\]/.exec(wiring)
  assert.ok(registry, '找不到镇壳里的幕注册表')
  const ids = [...registry[1].matchAll(/\n {4}id: '([\w-]+)',/g)].map((hit) => hit[1])
  assert.ok(ids.length >= 8, `注册表只认出 ${ids.length} 幕，封顶对账不成立`)
  for (const id of ids) {
    const block = new RegExp(`id: '${id}',[\\s\\S]*?\\n  \\},`).exec(registry[1])[0]
    // 数字自检那一幕没有逐元素标记（改的是文本），也就没有「铺合成层」这回事
    if (!/mark: '/.test(block)) continue
    assert.match(block, /capped\(/, `「${id}」那一幕没封顶：元素多起来就是几十个合成层`)
  }
})

test('注册表与样式表对账：每一幕都要有预隐规则、有关键帧，且只动 opacity/transform', () => {
  const html = styleSheet()
  const wiring = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/index.ts', import.meta.url)),
    'utf8',
  )
  // 从镇壳的注册表里把每一幕的 hides / mark / animation 抠出来对账——
  // 加了幕却忘了预隐规则或关键帧，是这套收敛之后最容易犯的错
  const registry = /const LAUNCH_STAGES: readonly LaunchStage\[\] = \[([\s\S]*?)\n\]/.exec(wiring)
  assert.ok(registry, '找不到镇壳里的幕注册表')
  const hides = [...registry[1].matchAll(/hides: '([^']+)'/g)].map((hit) => hit[1])
  const marks = [...registry[1].matchAll(/mark: '([^']+)'/g)].map((hit) => hit[1])
  const anims = [...registry[1].matchAll(/animation: '([^']+)'/g)].map((hit) => hit[1])
  assert.ok(hides.length >= 8, `注册表只认出 ${hides.length} 幕，对账不成立`)
  assert.equal(new Set(marks).size, marks.length, '两幕用了同一个标记，它们会互相顶替动画')
  // 要和资源数字同刻收官的那几幕（锱的资源盘、顶栏角标）必须声明对齐，且对齐的
  // 都是同一份终点——否则整条顶栏、整块资源盘会一半先停一半还在动
  //（这是接线，不是字面量：它决定几幕收不收得到一块）
  for (const id of ['zi', 'badge']) {
    const block = new RegExp(`id: '${id}',[\\s\\S]*?\\n  \\},`).exec(registry[1])
    assert.ok(block, `注册表里找不到「${id}」那一幕`)
    assert.match(block[0], /alignEnd: digitsEnd,/, `${id} 没声明对齐，会按自己的节奏收`)
  }
  assert.match(
    wiring,
    /const digitsEnd = \(\): number =>\s*\n?\s*launchDigitsPlan\(digitCells\(\)/,
    '对齐用的终点不是从资源数字那份 DOM 算出来的',
  )

  const ceremonyRules = [...html.matchAll(/body\.kanso-ceremony[^{]*\{[^}]*\}/g)].join('\n')
  for (const selector of hides) {
    assert.ok(
      ceremonyRules.includes(selector),
      `幕的预隐规则缺了「${selector}」：那一块会先把真容看一遍再重演`,
    )
  }
  // 每个标记都得有样式，而且要能顺出它用的关键帧名——**从注册表推导，不写死清单**，
  // 于是新加的幕自动被这条覆盖（写死清单的话，加了幕忘了补清单，护栏就悄悄漏了）
  const keyframeNames = new Set()
  for (const mark of marks) {
    const rules = [...html.matchAll(
      new RegExp(`\\[data-kanso-in='${mark}'\\][^{]*\\{([^}]*)\\}`, 'g'),
    )]
    assert.ok(rules.length, `没有 [data-kanso-in='${mark}'] 的样式，这一幕打了标记也不会动`)
    for (const rule of rules) {
      const name = /animation-name:\s*([\w-]+)/.exec(rule[1])?.[1]
      assert.ok(name, `[data-kanso-in='${mark}'] 那条没写 animation-name`)
      keyframeNames.add(name)
    }
  }
  // 罩层用的那两条也一起查
  for (const overlay of [...registry[1].matchAll(/animation: '(kanso-[\w-]+veil)'/g)]) {
    keyframeNames.add(overlay[1])
  }
  assert.ok(keyframeNames.size >= 6, `只顺出了 ${keyframeNames.size} 条关键帧，对账不成立`)
  // 关键帧都存在，且只动 opacity / transform
  for (const name of keyframeNames) {
    const block = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n    \\}`).exec(html)
    assert.ok(block, `样式表里没有 ${name}`)
    const props = [...block[1].matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
    for (const prop of props) {
      assert.ok(
        prop === 'opacity' || prop === 'transform',
        `${name} 里冒出了 ${prop}：入场只准动 opacity 与 transform`,
      )
    }
  }
  // 收场认的名字必须真的是某条关键帧的前缀，否则那一幕永远等不到「放完了」
  for (const prefix of anims.filter((name) => name.startsWith('kanso-'))) {
    assert.match(html, new RegExp(`@keyframes ${prefix}`), `没有以 ${prefix} 开头的关键帧`)
  }
  assert.ok(!/filter/.test(registry[1]))
})

test('run 始终没来（启动半路静默挂掉）：看门狗把仪式态也撤了', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const dom = installDom()
    armLaunchGlow(true) // 只装配，永远不 run 也不 cancel
    assert.ok(dom.body.classes.has(CEREMONY))
    t.mock.timers.tick(LAUNCH_GUARD_TIMING.armCap)
    assert.ok(!dom.body.classes.has(CEREMONY), '没人来 run 就把编队藏死了')
    assert.equal(dom.gameArea.children.length, 0, '游戏区还盖着黑罩')
    assert.equal(dom.body.classes.size, 0)
  } finally {
    t.mock.timers.reset()
  }
})

test('开关关闭 / 减少动态效果：仪式态根本不挂（零注入不变）', () => {
  const off = installDom()
  assert.equal(armLaunchGlow(false), null)
  assert.ok(!off.body.classes.has(CEREMONY))
  assert.equal(off.body.classes.size, 0)
  const reduced = installDom({ reduce: true })
  assert.equal(armLaunchGlow(true), null)
  assert.ok(!reduced.body.classes.has(CEREMONY))
  assert.equal(reduced.body.classes.size, 0)
})

test('看门狗兜底：animationend 一个都没来，第二幕也会自己收场', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const targets = fakeRoster(6)
    const { dom } = playToAct2(() => targets)
    assert.equal(targets.host.children.length, 1)
    const plan = launchStaggerPlan(6)
    const at = stageWatchdogAt(plan.total)
    t.mock.timers.tick(at - 1) // 到点之前一毫秒：还留着
    assert.equal(targets.host.children.length, 1)
    t.mock.timers.tick(1) // 宽限到点（这一幕比游戏区那段淡入短，按长的那个算）
    assert.equal(targets.host.children.length, 0, '看门狗没把第二幕收掉')
    assert.ok(targets.items.every((row) => row.dataset.kansoIn !== 'roster'))
    assert.equal(dom.docListenerCount(), 0)
  } finally {
    // 还原了才不会把后面的用例挂死（mock.timers 不还原＝测试没有输出地卡住）
    t.mock.timers.reset()
  }
})

// ---- 第零幕 · 欢迎返港 ----
//
// 这一幕与其余各幕的差别在**它不是装饰**：舰C那边正在黑屏加载，玩家盯着的就是它。
// 所以钉的东西也不一样——落幕的两个条件（三件真事到齐 且 铭牌摆满 minShow）、
// 称呼的回退、三条兜底（封顶看门狗 / 点一下跳过 / 减少动态效果时照挂但不动），
// 外加一条最要命的接续：**第一幕必须接在它落幕之后**，早一步就是动画在欢迎屏底下演。
//
// 2026-08-25 简化成单块铭牌之后又多钉一条：**进度条不许回来**。它前 95% 是演的，
// 撤掉是用户裁决；节点、类名、样式规则三处都对一遍，免得哪天顺手又摆回去。

/** 屏幕上那一层（挂在 body 上，不挂进任何面板）。没挂上就是 null。 */
const welcomeOf = (dom) => dom.body.children.find((child) => child.id === 'kanso-welcome') ?? null

/** 拆出屏幕上的东西：铭牌（含左右两段）、最底那行小字。 */
const partsOf = (layer) => {
  const [box, skip] = layer.children
  const [lead, name] = box.children
  return { box, skip, lead, name }
}

/** 一层里所有节点（含自己），用来数「屏幕上到底摆了什么」。 */
const nodesOf = (el) => [el, ...el.children.flatMap(nodesOf)]

/**
 * 样式表里某条规则的某个声明。取不到（规则不在 / 那条声明没写）就是 null。
 * 字号这种「玩家一眼看到的档位」写在样式表里，护栏就得能读到它。
 */
const cssDecl = (html, selector, prop) => {
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const block = rule.exec(html)
  if (!block) return null
  const hit = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`).exec(block[1])
  return hit ? hit[1].trim() : null
}

/** 三件真事一起报到（顺序无所谓，护栏里也不该依赖顺序）。 */
const allReady = (handle, nickname) => {
  for (const signal of LAUNCH_WELCOME_SIGNALS) {
    handle.noteReady(signal, signal === 'snapshot' ? nickname : undefined)
  }
}

// ---- 纯函数：曲线、门、称呼 ----

test('称呼回退：拿得到提督名就用它，拿不到就叫「提督」', () => {
  assert.equal(launchWelcomeName('赤城改二'), '赤城改二')
  assert.equal(launchWelcomeName('  两头带空格  '), '两头带空格')
  for (const empty of [null, undefined, '', '   ', '　　', 0, 42, {}, [], true]) {
    assert.equal(
      launchWelcomeName(empty),
      LAUNCH_WELCOME_FALLBACK,
      `${JSON.stringify(empty)} 该退回回退称呼`,
    )
  }
  // 全角空格也算空：快照里存的是玩家在游戏里起的名字，中间可能只有空白
  assert.equal(launchWelcomeName('　'), '提督')
})

test('玩家可见文案：屏幕上那几个字就是这几个字', () => {
  // 铭牌是分成两段写进 DOM 的，但连起来读必须还是一句整话
  assert.equal(LAUNCH_WELCOME_LEAD, '欢迎返港，')
  assert.equal(launchWelcomeGreeting(null), '欢迎返港，提督')
  assert.equal(launchWelcomeGreeting('长门'), '欢迎返港，长门')
  assert.equal(LAUNCH_WELCOME_LEAD + launchWelcomeName('长门'), launchWelcomeGreeting('长门'))
  assert.equal(LAUNCH_WELCOME_SKIP_HINT, '点击跳过动画（也可在设置关闭）')
  assert.equal(LAUNCH_WELCOME_FALLBACK, '提督')
})

test('落幕时刻：三件到齐与摆满 minShow 两个条件，谁后到听谁的', () => {
  const { minShow } = LAUNCH_WELCOME_TIMING
  // 本地起得飞快，三件真事在半秒内全到：照样得把最短展示摆满
  assert.equal(launchWelcomeLeaveAt(0), minShow)
  assert.equal(launchWelcomeLeaveAt(400), minShow)
  assert.equal(launchWelcomeLeaveAt(minShow - 1), minShow)
  // 门开在最短展示之后：听门的，一分钟不多等
  assert.equal(launchWelcomeLeaveAt(minShow), minShow)
  assert.equal(launchWelcomeLeaveAt(minShow + 1800), minShow + 1800)
  // 全程单调不减：门晚开一毫秒，落幕不可能反而提前
  let previous = -1
  for (let openedAt = 0; openedAt <= minShow * 3; openedAt += 17) {
    const at = launchWelcomeLeaveAt(openedAt)
    assert.ok(at >= previous, `门开在 ${openedAt}ms 时落幕反而提前了：${previous} → ${at}`)
    assert.ok(at >= openedAt, '门还没开就先落幕了')
    assert.ok(at >= minShow, `落幕在 ${at}ms：最短展示没摆满，开机第一屏一闪而过`)
    previous = at
  }
})

test('参数表：进度条那几档全撤了，只剩最短展示 / 淡入淡出 / 封顶', () => {
  assert.deepEqual(Object.keys(LAUNCH_WELCOME_TIMING).sort(), ['cap', 'fade', 'minShow'])
  assert.equal(LAUNCH_WELCOME_TIMING.minShow, 2400)
  assert.equal(LAUNCH_WELCOME_TIMING.fade, 420)
  assert.equal(LAUNCH_WELCOME_TIMING.cap, 9000)
  // 撤掉的是「演出来的百分比」这件事本身：连着门限与曲线一起，别顺手又摆回去
  for (const gone of ['LAUNCH_WELCOME_GATE', 'launchWelcomeProgress', 'launchWelcomeTotalMs']) {
    assert.equal(shared[gone], undefined, `${gone} 又回来了：进度条是用户裁掉的`)
  }
  // 最短展示必须明显短于封顶，否则封顶那一路会被最短展示反过来卡住
  assert.ok(LAUNCH_WELCOME_TIMING.minShow < LAUNCH_WELCOME_TIMING.cap)
})

test('就绪门：三件缺一不开，齐了就开，不认识的信号不算数', () => {
  assert.equal(LAUNCH_WELCOME_SIGNALS.length, 3)
  assert.ok(!launchWelcomeGateOpen([]))
  for (const missing of LAUNCH_WELCOME_SIGNALS) {
    const partial = LAUNCH_WELCOME_SIGNALS.filter((signal) => signal !== missing)
    assert.ok(!launchWelcomeGateOpen(partial), `少了「${missing}」也开门了：那 5% 就白留了`)
    assert.ok(!launchWelcomeGateOpen([...partial, '别的什么']), '拿不认识的信号凑数也能开门')
  }
  assert.ok(launchWelcomeGateOpen(LAUNCH_WELCOME_SIGNALS))
  assert.ok(launchWelcomeGateOpen([...LAUNCH_WELCOME_SIGNALS, ...LAUNCH_WELCOME_SIGNALS]))
})

// ---- 屏幕上：挂上去、走起来、收干净 ----

test('第零幕：开关关着，一个节点、一个监听都不加', () => {
  const dom = installDom()
  assert.equal(armLaunchWelcome(false), null)
  assert.equal(dom.created.length, 0, '关着还建了节点')
  assert.equal(dom.body.children.length, 0)
  assert.equal(dom.docListenerCount(), 0)
})

test('第零幕：欢迎屏挂在 body 上，铭牌两段就位，此外什么都没有', () => {
  const dom = installDom()
  const hello = armLaunchWelcome(true)
  try {
    const layer = welcomeOf(dom)
    assert.ok(layer, '欢迎屏没挂上去')
    assert.equal(layer.parentNode, dom.body, '浮层必须挂 body：面板既裁 overflow 又有包含块')
    // 屏幕上就两块：铭牌、最底一行小字
    assert.equal(layer.children.length, 2, '欢迎屏上多摆了东西：用户要的是单块铭牌')
    const { box, skip, lead, name } = partsOf(layer)
    assert.equal(box.children.length, 2, '铭牌里多摆了东西')
    // 开屏这一刻快照还没回来，先摆回退称呼；两段拼起来仍是一整句
    assert.equal(lead.textContent, '欢迎返港，')
    assert.equal(name.textContent, '提督')
    assert.equal(lead.textContent + name.textContent, launchWelcomeGreeting(null))
    assert.equal(skip.textContent, LAUNCH_WELCOME_SKIP_HINT)
    // 淡入时长从参数表写进行内，样式表里不写死毫秒数
    assert.equal(box.style.animationDuration, `${LAUNCH_WELCOME_TIMING.fade}ms`)
    assert.equal(skip.style.animationDuration, `${LAUNCH_WELCOME_TIMING.fade}ms`)
  } finally {
    hello.cancel()
  }
})

test('第零幕：屏幕上没有进度条——节点、类名、样式规则三处都不许有', () => {
  const dom = installDom()
  const hello = armLaunchWelcome(true)
  try {
    const layer = welcomeOf(dom)
    for (const el of nodesOf(layer)) {
      assert.notEqual(el.tagName, 'i', '欢迎屏上又冒出一根填充条')
      assert.ok(
        !/^kw-(bar|hail)$/.test(el.className ?? ''),
        `欢迎屏上又冒出 .${el.className}：进度条是用户裁掉的`,
      )
      assert.equal(el.style.transform, undefined, '有人在给欢迎屏上的东西写 transform')
      assert.equal(el.style.transitionDuration, undefined, '有人又给欢迎屏挂了插值')
    }
  } finally {
    hello.cancel()
  }
  const html = styleSheet()
  for (const gone of ['.kw-bar', '.kw-hail']) {
    assert.ok(!html.includes(gone), `样式表里还留着 ${gone}：进度条的壳子该一起撤`)
  }
})

test('第零幕：铭牌的字号档就是 13 / 24，两段分色', () => {
  const html = styleSheet()
  assert.equal(cssDecl(html, '#kanso-welcome .kw-lead', 'font-size'), '13px')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-name', 'font-size'), '24px')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-lead', 'color'), 'var(--sub)')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-name', 'color'), 'var(--text)')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-lead', 'font-family'), 'var(--sans)')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-name', 'font-family'), 'var(--mono)')
  // 铭牌本体：一块框，不是一片空白
  assert.equal(cssDecl(html, '#kanso-welcome .kw-box', 'background'), 'var(--bg1)')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-box', 'border'), '1px solid var(--line)')
  // 提督名可长可短：一行装不下就省略号，不换行（换行会把铭牌撑成两层）
  assert.equal(cssDecl(html, '#kanso-welcome .kw-box', 'white-space'), 'nowrap')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-box', 'text-overflow'), 'ellipsis')
  // 最底那行小字维持原样：压暗一档、贴底 28px
  assert.equal(cssDecl(html, '#kanso-welcome .kw-skip', 'font-size'), '10.5px')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-skip', 'color'), 'var(--dim)')
  assert.equal(cssDecl(html, '#kanso-welcome .kw-skip', 'bottom'), '28px')
})

test('第零幕：门没开就一直摆着，等多久都不自己落幕', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const hello = armLaunchWelcome(true)
    let ignited = 0
    hello.done(() => { ignited += 1 })
    // 最短展示早就过了，三件真事一件没来：铭牌照摆（封顶那一路单独有一条）
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow * 3)
    const layer = welcomeOf(dom)
    assert.ok(layer, '门没开就把欢迎屏撤了')
    assert.ok(!layer.classes.has('kw-out'), '门没开就开始淡出了')
    assert.equal(ignited, 0, '门没开就点了第一幕的火')
    hello.cancel()
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕：三件早早到齐也得把最短展示摆满，一秒都不少', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const hello = armLaunchWelcome(true)
    let ignited = 0
    hello.done(() => { ignited += 1 })
    allReady(hello) // 本地起得飞快：开屏那一刻三件就全到了
    const layer = welcomeOf(dom)
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow - 1)
    assert.ok(!layer.classes.has('kw-out'), '还没摆满最短展示就开始淡出：一闪而过')
    assert.ok(welcomeOf(dom))
    t.mock.timers.tick(1)
    assert.ok(layer.classes.has('kw-out'), '摆满了却不落幕')
    assert.equal(ignited, 0, '淡出还没完就点火了')
    layer.fire('animationend', 'kanso-welcome-out')
    assert.equal(welcomeOf(dom), null)
    assert.equal(ignited, 1)
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕：门开得比最短展示晚，就听门的——齐了才淡出，淡完才轮到点火', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const glow = armLaunchGlow(true)
    const hello = armLaunchWelcome(true)
    let ignited = 0
    hello.done(() => {
      ignited += 1
      glow.run(ONLY_BOTTOM)
    })
    const layer = welcomeOf(dom)

    hello.noteReady('snapshot', '雪风')
    hello.noteReady('lode')
    // 最短展示早就摆满了，第三件还没来：不许落幕
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow * 2)
    assert.ok(!layer.classes.has('kw-out'), '还差一件就开门了')
    assert.ok(welcomeOf(dom))

    hello.noteReady('panes')
    // 门开在最短展示之后：一刻不多等，当场淡出
    assert.ok(layer.classes.has('kw-out'), '门开了却没落幕')
    assert.equal(layer.style.animationDuration, `${LAUNCH_WELCOME_TIMING.fade}ms`)
    assert.equal(ignited, 0, '淡出还没完就点火了：第一幕会在欢迎屏底下演')
    assert.ok(!dom.body.classes.has('kanso-glow-run'))

    layer.fire('animationend', 'kanso-welcome-out')
    assert.equal(ignited, 1)
    assert.equal(welcomeOf(dom), null, '淡完了没把欢迎屏摘掉：它盖着整个窗口')
    assert.ok(dom.body.classes.has('kanso-glow-run'), '第一幕没接上')
    // 收干净：表停了、接力不会被二次调起
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.cap * 2)
    assert.equal(ignited, 1, '落幕之后还有人来敲门')
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕：提督名跟着快照到，铭牌当场换成真名；同一件报第二次不改回去', () => {
  const dom = installDom()
  const hello = armLaunchWelcome(true)
  try {
    const { lead, name } = partsOf(welcomeOf(dom))
    assert.equal(name.textContent, '提督')
    hello.noteReady('snapshot', '时雨')
    assert.equal(name.textContent, '时雨')
    // 换的只是名字那一段，左半那句招呼一个字都不动
    assert.equal(lead.textContent, LAUNCH_WELCOME_LEAD)
    assert.equal(lead.textContent + name.textContent, launchWelcomeGreeting('时雨'))
    hello.noteReady('snapshot') // 重试路径又报了一次，这次没带名字
    assert.equal(name.textContent, '时雨', '第二次上报把已经写好的名字擦掉了')
  } finally {
    hello.cancel()
  }
})

test('第零幕：快照失败也算到齐——门照开，铭牌留在回退称呼上', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const hello = armLaunchWelcome(true)
    let ignited = 0
    hello.done(() => { ignited += 1 })
    const layer = welcomeOf(dom)
    const { lead, name } = partsOf(layer)
    allReady(hello) // 三件都来了，但一件都没带出提督名（各自的 catch 分支）
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow)
    assert.equal(lead.textContent + name.textContent, '欢迎返港，提督')
    assert.ok(layer.classes.has('kw-out'), '一件抛异常就把玩家钉在了欢迎屏上')
    layer.fire('animationend', 'kanso-welcome-out')
    assert.equal(ignited, 1)
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕封顶：门永远不开，到点也强制落幕', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const hello = armLaunchWelcome(true)
    let ignited = 0
    hello.done(() => { ignited += 1 })
    const layer = welcomeOf(dom)
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.cap - 100)
    assert.ok(!layer.classes.has('kw-out'), '没到封顶就自己走了')
    assert.equal(ignited, 0)
    t.mock.timers.tick(100)
    assert.ok(layer.classes.has('kw-out'), '封顶到点了还摆着：玩家被钉死在欢迎屏')
    // 淡出的 animationend 也不来（窗口被最小化那一路）：还有一只兜底表
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.fade + 400)
    assert.equal(welcomeOf(dom), null, '淡出没人收场，欢迎屏留在了屏幕上')
    assert.equal(ignited, 1)
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕：点一下就跳过——欢迎屏立刻撤，整套仪式一起到终态', () => {
  const dom = installDom()
  const glow = armLaunchGlow(true)
  const hello = armLaunchWelcome(true)
  let ignited = 0
  hello.done(() => { ignited += 1 })
  assert.ok(dom.body.classes.has(CEREMONY))
  assert.equal(dom.gameArea.children.length, 1)

  dom.fireDoc('pointerdown')
  assert.equal(welcomeOf(dom), null, '点了没撤欢迎屏')
  assert.ok(!dom.body.classes.has(CEREMONY), '仪式态没摘：那几块内容会永远隐身')
  assert.equal(dom.body.classes.size, 0)
  assert.equal(dom.gameArea.children.length, 0, '游戏区还盖着黑罩')
  assert.equal(dom.docListenerCount(), 0, '两边的跳过监听都得退')
  assert.equal(ignited, 1)
  // 跳过之后第一幕是空转：不会把已经撤掉的罩层又请回来
  glow.run(ONLY_BOTTOM)
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.body.classes.size, 0)
})

test('第零幕：按键同样走这个收场口（Esc / Enter 都在里头）', () => {
  const dom = installDom()
  const glow = armLaunchGlow(true)
  const hello = armLaunchWelcome(true)
  let ignited = 0
  hello.done(() => { ignited += 1 })
  dom.fireDoc('keydown')
  assert.equal(welcomeOf(dom), null, '按键没跳过')
  assert.ok(!dom.body.classes.has(CEREMONY))
  assert.equal(dom.gameArea.children.length, 0)
  assert.equal(dom.docListenerCount(), 0)
  assert.equal(ignited, 1)
  glow.cancel()
})

test('第零幕：启动失败时 cancel——欢迎屏立刻撤，且不放行第一幕', () => {
  const dom = installDom()
  const hello = armLaunchWelcome(true)
  let ignited = 0
  hello.cancel()
  assert.equal(welcomeOf(dom), null, '欢迎屏盖着「启动失败」那张说明')
  assert.equal(dom.docListenerCount(), 0)
  // 收摊之后注册的接力也不该被调起来：屏幕上要摆的是错误说明，不是动画
  hello.done(() => { ignited += 1 })
  assert.equal(ignited, 0)
  hello.cancel() // 幂等
  assert.equal(ignited, 0)
})

test('第零幕：落幕比启动还早时，接力当场就调（第一幕不会等不到人）', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const hello = armLaunchWelcome(true)
    allReady(hello)
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow)
    welcomeOf(dom).fire('animationend', 'kanso-welcome-out')
    let ignited = 0
    hello.done(() => { ignited += 1 }) // 装配比欢迎屏慢，这会儿才来注册
    assert.equal(ignited, 1, '落幕之后才注册的接力被吞了：第一幕永远等不到人')
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕：减少动态效果时照挂（它是缓冲不是动画），最短展示照等、淡入淡出改硬切', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom({ reduce: true })
    // 第一幕在这种系统设置下整场不放（既有口径不变），第零幕照挂
    assert.equal(armLaunchGlow(true), null)
    const hello = armLaunchWelcome(true)
    let ignited = 0
    hello.done(() => { ignited += 1 })
    const layer = welcomeOf(dom)
    assert.ok(layer, '减少动态效果就把这段缓冲也一起省了')
    const { box, skip, lead, name } = partsOf(layer)
    // 铭牌照摆、字照写，只是没有任何时长
    assert.equal(lead.textContent + name.textContent, launchWelcomeGreeting(null))
    assert.equal(box.style.animationDuration, undefined, '淡入不该有时长')
    assert.equal(skip.style.animationDuration, undefined, '淡入不该有时长')
    // 三件当场到齐，但**最短展示照等**——它是功能性缓冲，不受「减少动态效果」影响
    allReady(hello)
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.minShow - 1)
    assert.ok(welcomeOf(dom), '静态时把最短展示一起省了：开机第一屏一闪而过')
    assert.equal(ignited, 0)
    t.mock.timers.tick(1)
    assert.equal(welcomeOf(dom), null, '静态时该硬切，不做淡出')
    assert.ok(!layer.classes.has('kw-out'))
    assert.equal(ignited, 1)
    assert.equal(dom.docListenerCount(), 0)
  } finally {
    t.mock.timers.reset()
  }
})

test('两只看门狗的先后：第零幕封顶落幕时，第一幕还没被自己的看门狗收掉', (t) => {
  // 第一幕在第零幕落幕之后才点火，两只看门狗要是同刻到点，就会变成
  // 「仪式先被自己的 ARM_CAP 收掉，接着才轮到点火」——表现是整场动画一次都不放。
  // 所以这条不去比两个数字的大小，而是真跑一遍最坏路径：三件真事一件都不来。
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  try {
    const dom = installDom()
    const glow = armLaunchGlow(true)
    const hello = armLaunchWelcome(true)
    hello.done(() => glow.run(ONLY_BOTTOM))
    t.mock.timers.tick(LAUNCH_WELCOME_TIMING.cap)
    assert.ok(dom.body.classes.has(CEREMONY), '第零幕还没落幕，仪式态就先被撤了')
    welcomeOf(dom).fire('animationend', 'kanso-welcome-out')
    assert.ok(dom.body.classes.has('kanso-glow-run'), '第零幕封顶落幕之后，第一幕点不着火了')
    assert.equal(dom.gameArea.children.length, 1)
  } finally {
    t.mock.timers.reset()
  }
})

test('第零幕对账：屏幕上用到的每一个类都在样式表里，关键帧只动 opacity', () => {
  const dom = installDom()
  const hello = armLaunchWelcome(true)
  const html = styleSheet()
  const layer = welcomeOf(dom)
  assert.match(html, new RegExp(`#${layer.id}\\s*\\{`), `样式表里没有 #${layer.id}`)

  // 从**真的挂上去的那棵树**里顺类名，不写死清单：以后加一行内容，这条自动覆盖它
  const names = new Set()
  const walk = (el) => {
    if (el.className) names.add(el.className)
    for (const child of el.children) walk(child)
  }
  walk(layer)
  assert.ok(names.size >= 4, `只顺出了 ${names.size} 个类名，对账不成立`)
  for (const name of names) {
    assert.ok(
      html.includes(`.${name}`),
      `样式表里没有 .${name}：这一块会一丝不挂地摆在开机第一屏上`,
    )
  }
  hello.cancel()

  for (const name of ['kanso-welcome-in', 'kanso-welcome-out']) {
    const line = new RegExp(`@keyframes ${name} \\{.*`).exec(html)?.[0] ?? ''
    assert.ok(line, `样式表里没有 ${name}`)
    const props = [...line.matchAll(/([a-z-]+)\s*:/g)].map((hit) => hit[1])
    assert.ok(props.length >= 2, `${name} 里一条声明都没有`)
    for (const prop of props) {
      assert.equal(prop, 'opacity', `${name} 里冒出了 ${prop}：这一层只准淡入淡出`)
    }
  }
  // 淡出那个类是 JS 落幕时才加的，静止态的树上顺不到，单独对一次
  assert.match(html, /#kanso-welcome\.kw-out/, '淡出那条规则不在样式表里')
})

test('第零幕接线对账：三件真事各有人报，且第一幕真的接在落幕之后', () => {
  const wiring = fs.readFileSync(
    fileURLToPath(new URL('../src/renderer/index.ts', import.meta.url)),
    'utf8',
  )
  assert.match(wiring, /armLaunchWelcome\(/, '镇壳压根没挂欢迎屏')
  // **从信号表推导，不写死清单**：以后多一件真事，忘了接线这条当场红
  for (const signal of LAUNCH_WELCOME_SIGNALS) {
    assert.match(
      wiring,
      new RegExp(`noteReady\\('${signal}'`),
      `第零幕的门少了一件真事：没人报 ${signal}，进度条会一路停到封顶`,
    )
  }
  // 点火只能出现在接力里：直接裸调就是第一幕在欢迎屏底下演
  const ignite = /const ignite = \(\) => \{[\s\S]*?\n  \}/.exec(wiring)
  assert.ok(ignite, '找不到第一幕的点火接力')
  assert.match(ignite[0], /glow\?\.run\(launchGlowLayout\(\), LAUNCH_STAGES\)/)
  assert.match(wiring, /welcome\.done\(ignite\)/, '点火没接在第零幕落幕之后')
  assert.equal(
    [...wiring.matchAll(/glow\?\.run\(/g)].length,
    1,
    '第一幕被点了不止一次火：只许接力里那一处',
  )
  // 启动失败那一路必须把欢迎屏也撤掉，否则错误说明被盖在底下
  const failed = /const startupFailed = [\s\S]*?\n\}/.exec(wiring)
  assert.ok(failed)
  assert.match(failed[0], /welcome\?\.cancel\(\)/, '启动失败时欢迎屏没撤：错误说明被它盖住了')
})
