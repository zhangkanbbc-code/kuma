// 字幕字号跟着游戏画面倍率走（2026-08-31，玩家报「游戏缩小了字幕还是原来那么大」）。
//
// 守三件事：
//  ① **判据**：实际 = 基准 × 倍率，游戏 100% 时实际就等于基准（玩家能对上的那个等式）。
//  ② **那道乘法真的接上了**：样式表里字号取的是 `--voice-caption-px`，而不是从前那条
//     跟着窗口宽走的 clamp；两个变量分别由字幕层与镇壳写。只断言判据是不够的——
//     算得再对，CSS 那头没接上，屏幕上一个像素都不会变。
//  ③ **两块字幕层的落位仍是相对量**：写死像素的话，固定倍率 75% 与 200% 两档差着三倍。
//     底部字幕的留白 2026-09-01 退回 3.5%（玩家否掉了 12% 那一版），弹幕带同日收到
//     画面上沿；带高那条还要兜住「字号调大之后四行装不装得下」。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import captionSize from '../dist/shared/voice-caption-size.js'
import sections from '../dist/shared/settings-sections.js'
import { cardHtml, cardsIn, mountYu } from './fixtures/render-yu.mjs'

const {
  VOICE_CAPTION_SIZE_CHIPS,
  VOICE_CAPTION_SIZE_DEFAULT,
  VOICE_CAPTION_SIZE_MAX,
  VOICE_CAPTION_SIZE_MIN,
  VOICE_CAPTION_SIZE_PATH,
  VOICE_CAPTION_SIZE_STEP,
  VOICE_DANMAKU_SIZE_RATIO,
  effectiveVoiceCaptionPx,
  normalizeVoiceCaptionSize,
} = captionSize
const { SETTINGS_SECTION_UI_KEY, settingsSectionOf } = sections

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ---- ① 判据 ----

test('默认就是可配之前那条 clamp 的封顶档，常用档里有它', () => {
  assert.equal(VOICE_CAPTION_SIZE_DEFAULT, 20)
  assert.ok(
    VOICE_CAPTION_SIZE_CHIPS.includes(VOICE_CAPTION_SIZE_DEFAULT),
    '默认那一档不在常用档里，开箱第一眼没有一个亮着的',
  )
  // 叶子路径：整对象读会读到 setByPath 留下的半份对象，从此不再回落默认值
  assert.equal(VOICE_CAPTION_SIZE_PATH, 'kanso.voiceCaptionSize')
  assert.equal(VOICE_CAPTION_SIZE_STEP, 1)
})

test('常用档升序、都落在上下限之内', () => {
  const chips = [...VOICE_CAPTION_SIZE_CHIPS]
  assert.deepEqual(chips, [...chips].sort((a, b) => a - b), '常用档不是升序')
  for (const chip of chips) {
    assert.ok(chip >= VOICE_CAPTION_SIZE_MIN && chip <= VOICE_CAPTION_SIZE_MAX, `${chip} 出界`)
    assert.equal(normalizeVoiceCaptionSize(chip), chip)
  }
})

test('认不出的值一律回默认，出界的收回上下限', () => {
  // 空串/空数组过 Number() 都是 0：那是「这一格是空的」，不是「他选了 0px」
  for (const bogus of ['', '   ', 'x', null, undefined, NaN, {}, [], Infinity]) {
    assert.equal(normalizeVoiceCaptionSize(bogus), VOICE_CAPTION_SIZE_DEFAULT)
  }
  // 真给了个数才收进上下限——加减按钮递过来的越界值走的就是这一支
  assert.equal(normalizeVoiceCaptionSize(0), VOICE_CAPTION_SIZE_MIN)
  assert.equal(normalizeVoiceCaptionSize(-40), VOICE_CAPTION_SIZE_MIN)
  assert.equal(normalizeVoiceCaptionSize(999), VOICE_CAPTION_SIZE_MAX)
  assert.equal(normalizeVoiceCaptionSize('18'), 18, '字符串数字该被认回来')
  assert.equal(normalizeVoiceCaptionSize(17.6), 18, '半个像素调不出来，收成整数')
})

test('游戏 100% 时实际字号就是基准——玩家能对上的那个等式', () => {
  for (const base of VOICE_CAPTION_SIZE_CHIPS) {
    assert.equal(effectiveVoiceCaptionPx(base, 1), base)
  }
})

test('倍率乘上去：75% 明显小、200% 明显大，一位小数够写在卡上', () => {
  assert.equal(effectiveVoiceCaptionPx(20, 0.75), 15)
  assert.equal(effectiveVoiceCaptionPx(20, 1.25), 25)
  assert.equal(effectiveVoiceCaptionPx(20, 2), 40)
  // 自适应落在非整数倍率上（这正是固定倍率那一档要治的场面）
  assert.equal(effectiveVoiceCaptionPx(20, 0.8695), 17.4)
})

test('倍率还没量出来（0 / 负数 / NaN）就按 1 算，绝不给一个 0px 的字幕', () => {
  for (const bogus of [0, -1, NaN, null, undefined, 'x']) {
    assert.equal(effectiveVoiceCaptionPx(20, bogus), 20)
  }
})

test('弹幕比底部字幕小一号，比例正是可配之前那两条 clamp 的封顶之比', () => {
  assert.equal(VOICE_DANMAKU_SIZE_RATIO, 19 / 20)
  assert.equal(effectiveVoiceCaptionPx(20, 1) * VOICE_DANMAKU_SIZE_RATIO, 19)
})

// ---- ② 样式表那头真的接上了 ----

const skin = read('src/renderer/index.html')
const ruleOf = (selector) => {
  const at = skin.indexOf(`\n    ${selector} {`)
  assert.ok(at >= 0, `样式表里找不到 ${selector}`)
  return skin.slice(at, skin.indexOf('}', at))
}

test('底部字幕的字号取 --voice-caption-px，不再跟着窗口宽走', () => {
  const rule = ruleOf('#voice-subtitle')
  assert.match(rule, /font-size:\s*var\(--voice-caption-px\)/)
  assert.equal(/font-size:\s*clamp\(/.test(rule), false, '还挂着那条按 vw 走的 clamp')
})

test('战斗弹幕同一条链，只是按比例小一号', () => {
  const rule = ruleOf('#voice-danmaku .voice-danmaku-item')
  assert.match(
    rule,
    new RegExp(`font-size:\\s*calc\\(var\\(--voice-caption-px\\) \\* ${VOICE_DANMAKU_SIZE_RATIO}\\)`),
  )
})

test('乘法本体：基准 × 倍率，两个变量都留了兜底值', () => {
  assert.match(
    skin,
    /--voice-caption-px:\s*calc\(var\(--voice-caption-base,\s*20px\)\s*\*\s*var\(--game-scale,\s*1\)\)/,
  )
  // 兜底值就是可配之前那两条 clamp 的封顶档，两个变量都没写上时屏幕上还是原样
  assert.equal(VOICE_CAPTION_SIZE_DEFAULT, 20)
})

test('两个变量各有一处写入：基准归字幕层，倍率归镇壳', () => {
  assert.match(
    read('src/renderer/voice-subtitle.ts'),
    /setProperty\(\s*'--voice-caption-base'/,
    '字幕层不写基准字号，钥改了没人接',
  )
  assert.match(
    read('src/renderer/index.ts'),
    /setProperty\('--game-scale', `\$\{layout\.scale\}`\)/,
    '镇壳摆完游戏区没把量到的倍率交出去',
  )
})

test('底边留白是相对量：写死像素的话两档倍率下留白差着三倍', () => {
  const rule = ruleOf('#voice-subtitle')
  const bottom = /bottom:\s*([\d.]+)(%|px)/.exec(rule)
  assert.ok(bottom, '底部字幕没有 bottom')
  assert.equal(bottom[2], '%', `底边留白写成了 ${bottom[1]}px`)
  // 2026-08-31 曾抬到 12%，玩家 2026-09-01 当面否掉（「底部的字幕其实可以不用动」），
  // 退回原位 3.5%。这条钉的是那次退回本身：字号那条链另有判据，不受它牵连。
  assert.equal(Number(bottom[1]), 3.5, `底部字幕又被挪到 ${bottom[1]}% 了`)
})

test('弹幕收在画面上沿：带子与弹道都是相对量，四行不许被裁', () => {
  const band = ruleOf('#voice-danmaku')
  const inset = /inset:\s*([\d.]+)%\s+0\s+auto/.exec(band)
  assert.ok(inset, `弹幕带的上沿不是百分比：${band}`)
  assert.ok(Number(inset[1]) <= 2, `上沿掉到 ${inset[1]}%，没贴着画面顶`)
  // 带高：常用字号档下是那个百分比，字号调大到四行装不下时由后半段兜住——
  // 写死一个百分比的话，最下面那条弹幕会被 overflow: hidden 裁掉半截。
  const height = /height:\s*max\(\s*([\d.]+)%\s*,\s*calc\(var\(--voice-caption-px[^)]*\)\s*\*\s*([\d.]+)\)\s*\)/.exec(band)
  assert.ok(height, `弹幕带高不是「百分比与四行所需取大」：${band}`)
  assert.ok(Number(inset[1]) + Number(height[1]) <= 26, '带子伸到画面中段去了')

  // 弹道间距 == line-height：行与行严丝合缝，这是不动字号能做到的最紧一档。
  const item = ruleOf('#voice-danmaku .voice-danmaku-item')
  const lane = /top:\s*calc\(var\(--voice-lane\)\s*\*\s*([\d.]+)em\)/.exec(item)
  const lineHeight = /line-height:\s*([\d.]+)/.exec(item)
  assert.ok(lane && lineHeight, `弹道间距或行高读不出来：${item}`)
  assert.equal(Number(lane[1]), Number(lineHeight[1]), '弹道间距与行高对不上：不是叠字就是留了死空')
  // 四条弹道（voice-subtitle.ts 的 % 4）都要落在带子里
  const laneCount = 4
  const neededEm = (laneCount - 1) * Number(lane[1]) + Number(lineHeight[1])
  assert.ok(
    neededEm * VOICE_DANMAKU_SIZE_RATIO <= Number(height[2]),
    `四行需要 ${neededEm}em，带高只兜到 ${height[2]} × 字幕字号`,
  )
})

// ---- ③ 钥里那张卡 ----

const UI = { [SETTINGS_SECTION_UI_KEY]: 'ui' }
const cardOf = (yu) => cardHtml(yu.pane.innerHTML, 'caption-size')

test('卡摆在「界面」类里，紧跟游戏画面', () => {
  assert.equal(settingsSectionOf('caption-size'), 'ui')
  const cards = cardsIn(mountYu({ ui: UI }).pane.innerHTML)
  assert.equal(cards[cards.indexOf('caption-size') - 1], 'game-scale')
})

test('没改过的人开出来落在默认那一档，基准与实际两个数都写着', () => {
  const card = cardOf(mountYu({ ui: UI }))
  assert.match(card, /class="ychip on" data-caption-size="20">20px</)
  for (const chip of VOICE_CAPTION_SIZE_CHIPS) {
    assert.ok(card.includes(`data-caption-size="${chip}"`), `${chip} 这一档没摆出来`)
  }
  // 玩家调的是基准，卡上写的是实际生效值——两个都要在，只写一个都对不上眼睛
  assert.match(card, /基准 20px · 实际 20px/)
})

test('点一档：落盘、当场推给字幕层、卡上两个读数跟着变', () => {
  const yu = mountYu({ ui: UI })
  yu.click({ 'caption-size': '28' })
  assert.equal(yu.configOf(VOICE_CAPTION_SIZE_PATH), 28)
  assert.deepEqual(yu.captionSizes(), [28], '改完没推给字幕层，要重开才生效')
  assert.match(cardOf(yu), /class="ychip on" data-caption-size="28"/)
  assert.match(cardOf(yu), /基准 28px · 实际 28px/)
})

test('加减各动一格，顶到上下限就停住，且不再白写一遍盘', () => {
  const yu = mountYu({ ui: UI })
  yu.click({ act: 'caption-size-inc' })
  assert.equal(yu.configOf(VOICE_CAPTION_SIZE_PATH), 21)
  yu.click({ act: 'caption-size-dec' })
  assert.equal(yu.configOf(VOICE_CAPTION_SIZE_PATH), 20)

  const top = mountYu({ ui: UI, config: { [VOICE_CAPTION_SIZE_PATH]: VOICE_CAPTION_SIZE_MAX } })
  top.click({ act: 'caption-size-inc' })
  assert.equal(top.configOf(VOICE_CAPTION_SIZE_PATH), VOICE_CAPTION_SIZE_MAX)
  assert.deepEqual(top.captionSizes(), [], '顶到上限还在写盘重画')

  const floor = mountYu({ ui: UI, config: { [VOICE_CAPTION_SIZE_PATH]: VOICE_CAPTION_SIZE_MIN } })
  floor.click({ act: 'caption-size-dec' })
  assert.equal(floor.configOf(VOICE_CAPTION_SIZE_PATH), VOICE_CAPTION_SIZE_MIN)
})

test('配置里存着认不出的值也开得出来，卡上落在默认那一档', () => {
  const yu = mountYu({ ui: UI, config: { [VOICE_CAPTION_SIZE_PATH]: 'huge' } })
  assert.match(cardOf(yu), /class="ychip on" data-caption-size="20"/)
})

test('卡上是标签语：不叙事、不解释、不替玩家说他在想什么', () => {
  const card = cardOf(mountYu({ ui: UI }))
  for (const word of ['您', '我们', '建议', '推荐', '为了', '因为', '可以让', '不妨']) {
    assert.equal(card.includes(word), false, `卡上写了「${word}」`)
  }
})

// ---- ④ 任务详情抬头一行摆完 ----

test('任务详情抬头：编号那半与状态那半同一行，中间一个破折号', () => {
  const source = read('src/renderer/modules/qn.ts')
  assert.match(
    source,
    /<small>\$\{esc\(row\.code\)\} · \$\{periodOfRow\(row\)\[0\]\}任 · \$\{categoryOf\(row\)\.label\} — <\/small><b>/,
    '抬头条的两半之间没有分隔符',
  )
  const rule = ruleOf('.mod-qn .q-drawer-head')
  assert.equal(
    /display:\s*block/.test(skin.slice(skin.indexOf('.mod-qn .q-drawer-head small'), skin.indexOf('.mod-qn .q-drawer-head b'))),
    false,
    '那半小字还是 display:block，仍旧独占一行',
  )
  // 收高：两行时要 45px，一行之后只剩关闭钮（27）+ 上下 padding（14）撑着
  const min = /min-height:\s*(\d+)px/.exec(rule)
  assert.ok(min && Number(min[1]) === 41, `抬头条的最小高是 ${min?.[1]}px，没跟着收`)
})
