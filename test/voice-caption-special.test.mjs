import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import special from '../dist/shared/voice-caption-special.js'
import hold from '../dist/shared/voice-caption-hold.js'
import sections from '../dist/shared/settings-sections.js'
import { captionRuntime, captionsFromLodes } from './fixtures/render-ship-caption.mjs'
import { cardHtml, mountYu } from './fixtures/render-yu.mjs'

const { normalizeSpecialCaptionStyle, VOICE_CAPTION_SPECIAL_DEFAULT, VOICE_CAPTION_SPECIAL_PATH } = special
const html = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const cue = { kind: 'ship', mstId: 1, voiceId: 900 }
const row = { slot: 900, zh: '全舰，齐射！', ja: '全艦、一斉射！' }

// DOM 只补节点、样式与事件边界；分发、取词、道数和退场计时均跑生产模块。
class Element extends EventTarget {
  constructor(tag = 'div') {
    super()
    this.tagName = tag.toUpperCase()
    this.children = []
    this.className = ''
    this.ownText = ''
    this.properties = new Map()
    this.style = {
      setProperty: (key, value) => this.properties.set(key, value),
      getPropertyValue: key => this.properties.get(key) ?? '',
    }
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' ').trim() },
      remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' ') },
      toggle: (name, force) => force ? this.classList.add(name) : this.classList.remove(name),
    }
    this.widthReads = 0
    this.layoutWidth = 300
    this.layoutHeight = 56
  }
  get clientWidth() { this.widthReads++; return 1200 }
  get clientHeight() { return 720 }
  get offsetHeight() {
    if (this.className.split(' ').includes('voice-cutin-line')) assert.ok(this.parent, '插入后才能量布局高度')
    return this.layoutHeight
  }
  get offsetWidth() {
    if (this.className.split(' ').includes('voice-cutin-line')) assert.ok(this.parent, '插入后才能量布局宽度')
    this.widthReads++
    return this.layoutWidth
  }
  get childElementCount() { return this.children.length }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join('') }
  set textContent(value) { this.replaceChildren(); this.ownText = value }
  appendChild(child) { child.parent = this; this.children.push(child); return child }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this)
    this.parent = null
  }
  replaceChildren() { for (const child of [...this.children]) child.remove(); this.ownText = '' }
  querySelector(selector) { return this.children.find(child => child.className.split(' ').includes(selector.slice(1))) ?? null }
}

const setup = async (t, { style = true, battle = true, voiceRow = row, audio = () => null, boxWidth = 300, boxHeight = 56, anchor = 58, anchorY = 36, maxW = 56 } = {}) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const top = new Element()
  const cutin = new Element()
  const bottom = new Element()
  for (const name of ['voice-subtitle-speaker', 'voice-subtitle-line']) {
    const child = new Element()
    child.className = name
    bottom.appendChild(child)
  }
  const previous = globalThis.document
  const previousFrame = globalThis.requestAnimationFrame
  const previousComputedStyle = globalThis.getComputedStyle
  globalThis.getComputedStyle = element => {
    assert.equal(element, cutin)
    return { getPropertyValue: key => {
      assert.ok(['--cutin-x', '--cutin-y', '--cutin-max-w'].includes(key))
      return `${{ '--cutin-x': anchor, '--cutin-y': anchorY, '--cutin-max-w': maxW }[key]}%`
    } }
  }
  globalThis.requestAnimationFrame = callback => { callback(); return 1 }
  globalThis.document = {
    querySelector: selector => ({ '#voice-danmaku': top, '#voice-cutin': cutin, '#voice-subtitle': bottom,
      '#game-wrapper webview': { executeJavaScript: async () => audio() },
    })[selector] ?? null,
    createElement: tag => Object.assign(new Element(tag), { layoutWidth: boxWidth, layoutHeight: boxHeight }),
  }
  captionRuntime.setVoiceCaptionsEnabled(true)
  captionRuntime.setSpecialCaptionStyle(style)
  t.after(() => {
    captionRuntime.setVoiceCaptionsEnabled(false)
    globalThis.document = previous
    globalThis.requestAnimationFrame = previousFrame
    globalThis.getComputedStyle = previousComputedStyle
    t.mock.timers.reset()
  })
  const lines = await captionsFromLodes({
    mg: { sortie: battle ? { active: true, battle: {} } : null },
    lodes: { 'kuma-voice': { data: { ships: { '1': [voiceRow] } } } },
  }, cue)
  return { top, cutin, bottom, lines, show: (nextCue = cue, nextLines = lines) => captionRuntime.testDisplayAtPlaybackTime(nextCue, nextLines) }
}

test('特殊攻击视觉加强使用布尔配置，非法值默认开启', () => {
  assert.equal(VOICE_CAPTION_SPECIAL_PATH, 'kuma.voiceCaptionsSpecial')
  assert.equal(VOICE_CAPTION_SPECIAL_DEFAULT, true)
  for (const value of [true, false]) assert.equal(normalizeSpecialCaptionStyle(value), value)
  for (const value of [undefined, null, '', 'TOP', ' cutin ', 'bottom', 0, 1, 'false', {}, []]) {
    assert.equal(normalizeSpecialCaptionStyle(value), true)
  }
})

for (const [legacy, enabled] of [['cutin', true], ['center', true], ['top', false]]) {
  test(`旧配置 ${legacy} 归一化为${enabled ? '开' : '关'}，钥显示与首次切换一致`, () => {
    assert.equal(normalizeSpecialCaptionStyle(legacy), enabled)
    const yu = mountYu({
      ui: { [sections.SETTINGS_SECTION_UI_KEY]: 'ui' },
      config: { [VOICE_CAPTION_SPECIAL_PATH]: legacy },
    })
    const card = () => cardHtml(yu.pane.innerHTML, 'ui-hints')
    assert.ok(card().includes(`class="ysw${enabled ? ' on' : ''}" data-toggle="${VOICE_CAPTION_SPECIAL_PATH}"`))
    yu.click({ toggle: VOICE_CAPTION_SPECIAL_PATH })
    assert.equal(yu.configOf(VOICE_CAPTION_SPECIAL_PATH), !enabled)
    assert.deepEqual(yu.specialCaptionStyles(), [!enabled])
  })
}

const animationEnd = (item, name) => {
  const event = new Event('animationend')
  Object.defineProperty(event, 'animationName', { value: name })
  item.dispatchEvent(event)
}
const tick = async (t, ms) => {
  t.mock.timers.tick(ms)
  for (let i = 0; i < 6; i++) await Promise.resolve()
  t.mock.timers.tick(0)
}

test('特殊 cue 突入式清场：中文优先一枚旗舰句，无舰名或冒号，另舰接僚舰位', async t => {
  const view = await setup(t)
  view.top.appendChild(new Element())
  view.show()
  assert.equal(view.top.childElementCount, 0)
  assert.equal(view.cutin.childElementCount, 1)
  const item = view.cutin.children[0]
  assert.equal(item.className, 'voice-cutin-line lead')
  assert.equal(view.lines.length, 1)
  assert.equal(item.childElementCount, 0)
  assert.equal(item.textContent, row.zh)
  assert.doesNotMatch(item.textContent, /舰1|：/)
  assert.equal(view.cutin.widthReads, 1)
  await tick(t, 300)
  view.show({ ...cue, mstId: 2 }, [{ ...view.lines[0], speaker: '另一舰', text: '僚舰台词' }])
  const next = view.cutin.children[1]
  assert.equal(next.className, 'voice-cutin-line wing')
  assert.equal(next.textContent, '僚舰台词')
  animationEnd(item, 'voice-cutin-in')
  assert.equal(view.cutin.childElementCount, 2)
  animationEnd(item, 'voice-cutin-out')
  assert.deepEqual(view.cutin.children, [next])
  animationEnd(next, 'voice-cutin-out')
  view.show()
  assert.equal(view.cutin.children[0].className, 'voice-cutin-line lead')
})

test('特殊 cue 顶部飘过只出一枚中文普通我方弹幕，热切只影响后续号令', async t => {
  const view = await setup(t, { style: false })
  const previous = view.top.appendChild(new Element())
  view.show()
  assert.equal(view.cutin.childElementCount, 0)
  assert.equal(view.top.childElementCount, 2)
  assert.equal(view.top.children[0], previous)
  assert.equal(view.top.children[1].className, 'voice-danmaku-item friendly')
  assert.equal(view.top.children[1].textContent, `舰1：${row.zh}`)
  captionRuntime.setSpecialCaptionStyle(true)
  view.show()
  assert.equal(view.cutin.childElementCount, 1)
  assert.equal(view.top.childElementCount, 0)
})

test('特殊弹幕无中文回日文单行，顶部也只一枚，无文本不造节点，超时兜底移除整枚', async t => {
  const view = await setup(t, { voiceRow: { ...row, zh: '' } })
  view.show()
  const item = view.cutin.children[0]
  assert.equal(view.lines.length, 1)
  assert.equal(view.cutin.childElementCount, 1)
  assert.equal(item.childElementCount, 0)
  assert.equal(item.textContent, row.ja)
  captionRuntime.setSpecialCaptionStyle(false)
  view.show()
  assert.equal(view.top.childElementCount, 1)
  assert.equal(view.top.children[0].className, 'voice-danmaku-item friendly')
  assert.equal(view.top.children[0].textContent, `舰1：${row.ja}`)
  captionRuntime.setSpecialCaptionStyle(true)
  await tick(t, 220 + 5000)
  assert.match(item.className, /leaving/)
  await tick(t, 759)
  assert.equal(view.cutin.childElementCount, 1)
  await tick(t, 1)
  assert.equal(view.cutin.childElementCount, 0)
  view.show(cue, [])
  assert.equal(view.cutin.childElementCount, 0)
})

test('普通与敌方语音不受特殊样式影响，特殊槽两段边界都走突入式且不堆积', async t => {
  const view = await setup(t)
  for (const style of [true, false]) {
    captionRuntime.setSpecialCaptionStyle(style)
    for (const voiceId of [899, 904, 989, 994]) view.show({ ...cue, voiceId }, [view.lines[0]])
    view.show({ kind: 'enemy', voiceId: 900 }, [view.lines[0]])
  }
  assert.equal(view.cutin.childElementCount, 0)
  assert.equal(view.top.childElementCount, 10)
  assert.equal(view.top.children.filter(item => item.className.endsWith('enemy')).length, 2)
  captionRuntime.setSpecialCaptionStyle('invalid')
  for (const voiceId of [900, 901, 902, 903, 990, 991, 992, 993]) {
    view.show({ ...cue, voiceId })
    assert.equal(view.cutin.childElementCount, 1)
    assert.equal(view.cutin.children[0].className, 'voice-cutin-line lead')
  }
})

test('母港特殊号令只显示中文单条，关闭总开关清空三处并禁止再画', async t => {
  const view = await setup(t, { battle: false })
  for (const style of [true, false]) {
    captionRuntime.setSpecialCaptionStyle(style)
    view.show()
    assert.equal(view.bottom.querySelector('.voice-subtitle-line').textContent, row.zh)
  }
  assert.equal(view.cutin.childElementCount, 0)
  assert.equal(view.top.childElementCount, 0)
  // 同一生产清场入口也应清掉已在飞行的两种弹幕。
  view.cutin.appendChild(new Element())
  view.top.appendChild(new Element())
  captionRuntime.setVoiceCaptionsEnabled(false)
  view.show()
  assert.equal(view.bottom.textContent, '')
  assert.equal(view.top.childElementCount + view.cutin.childElementCount, 0)
})

test('战斗总开关清空在飞弹幕，关着时视觉加强两态与敌方均零节点', async t => {
  const view = await setup(t)
  view.show()
  captionRuntime.setSpecialCaptionStyle(false)
  view.show()
  captionRuntime.setVoiceCaptionsEnabled(false)
  for (const style of [true, false]) {
    captionRuntime.setSpecialCaptionStyle(style)
    view.show()
    view.show({ kind: 'enemy', voiceId: 900 }, [view.lines[0]])
  }
  assert.equal(view.top.childElementCount + view.cutin.childElementCount, 0)
})

test('钥特殊攻击视觉加强开关默认、两态热切与总开关灰态', () => {
  const yu = mountYu({ ui: { [sections.SETTINGS_SECTION_UI_KEY]: 'ui' } })
  const card = () => cardHtml(yu.pane.innerHTML, 'ui-hints')
  const setting = () => card().match(/<div class="yrow(?: dis)?">\s*<span class="ytx"><b>特殊攻击视觉加强<\/b>[\s\S]*?<\/div>/)[0]
  assert.match(card(), /显示语音文字[\s\S]*特殊攻击视觉加强[\s\S]*新舰 \/ 大破/)
  assert.match(setting(), /<b>特殊攻击视觉加强<\/b><span>开关炫酷特殊攻击字幕<\/span>/)
  assert.match(setting(), /class="ysw on" data-toggle="kuma.voiceCaptionsSpecial"/)
  assert.doesNotMatch(card(), /data-special-caption/)
  for (const enabled of [false, true]) {
    yu.click({ toggle: VOICE_CAPTION_SPECIAL_PATH })
    assert.equal(yu.configOf(VOICE_CAPTION_SPECIAL_PATH), enabled)
    assert.ok(setting().includes(`class="ysw${enabled ? ' on' : ''}" data-toggle="${VOICE_CAPTION_SPECIAL_PATH}"`))
    assert.equal((card().match(/data-toggle="kuma.voiceCaptionsSpecial"/g) ?? []).length, 1)
  }
  assert.deepEqual(yu.specialCaptionStyles(), [false, true])
  yu.click({ toggle: 'kuma.voiceCaptions' })
  assert.match(setting(), /class="yrow dis"/)
  assert.match(setting(), /class="ysw on"/)
  assert.doesNotMatch(setting(), /data-toggle=/)
  yu.click({ toggle: VOICE_CAPTION_SPECIAL_PATH })
  assert.equal(yu.configOf(VOICE_CAPTION_SPECIAL_PATH), true)
  assert.deepEqual(yu.specialCaptionStyles(), [false, true])
  yu.click({ toggle: 'kuma.voiceCaptions' })
  yu.click({ toggle: VOICE_CAPTION_SPECIAL_PATH })
  assert.equal(yu.configOf(VOICE_CAPTION_SPECIAL_PATH), false)
  assert.match(setting(), /class="ysw" data-toggle="kuma.voiceCaptionsSpecial"/)
})

test('突入宿主盖满游戏区，字号收紧、56% 均衡折行，动画只动 transform 与 opacity', () => {
  assert.match(html, /id="game-wrapper"[\s\S]*id="voice-danmaku"[^>]*><\/div>\s*<div id="voice-cutin"/)
  const host = html.match(/#voice-cutin \{([^}]+)\}/)[1]
  for (const property of ['用户实机后微调', '--cutin-x: 58%', '--cutin-y: 36%', '--cutin-max-w: 56%', 'position: absolute', 'z-index: 8', 'inset: 0', 'pointer-events: none', 'overflow: hidden', 'container-type: size']) assert.ok(host.includes(property), property)
  const item = html.match(/\.voice-cutin-line \{([^}]+)\}/)[1]
  for (const property of ['left: var(--cutin-x)', 'top: var(--cutin-y)', 'transform: translate(-50%, -50%)', 'width: max-content', 'max-width: var(--cutin-max-w)', 'text-wrap: balance', 'text-align: center', 'white-space: normal', 'overflow-wrap: anywhere', 'font-size: min(calc(var(--voice-caption-px) * 1.35), 6.5cqh)', 'letter-spacing: 0', 'line-height: 1.2', 'animation: voice-cutin-in 220ms ease-out forwards']) assert.ok(item.includes(property), property)
  const wing = html.match(/\.voice-cutin-line.wing \{([^}]+)\}/)[1]
  for (const property of ['left: calc(var(--cutin-x) - 9%)', 'top: calc(var(--cutin-y) + 15%)', 'font-size: min(calc(var(--voice-caption-px) * 1.1), 6.5cqh)']) assert.ok(wing.includes(property), property)
  assert.doesNotMatch(item, /white-space: nowrap|line-clamp|overflow: hidden/)
  assert.doesNotMatch(html, /\.voice-cutin-line.wrapped/)
  assert.match(html, /voice-cutin-out 260ms ease-out forwards/)
  const enter = html.match(/@keyframes voice-cutin-in \{\s*0% \{([^}]+)\}\s*60% \{([^}]+)\}\s*100% \{([^}]+)\}/)
  const leave = html.match(/@keyframes voice-cutin-out \{\s*from \{([^}]+)\}\s*to \{([^}]+)\}/)
  assert.deepEqual(enter.slice(1).map(s => s.trim()), [
    'transform: translate(-50%,-50%) scale(var(--cutin-scale, 2.4)); opacity: 0;',
    'transform: translate(-50%,-50%) scale(.94); opacity: 1;',
    'transform: translate(-50%,-50%) scale(1); opacity: 1;',
  ])
  assert.deepEqual(leave.slice(1).map(s => s.trim()), [
    'transform: translate(-50%,-50%) scale(1); opacity: 1;',
    'transform: translate(-50%,-50%) scale(1.06); opacity: 0;',
  ])
  assert.doesNotMatch(html.match(/#voice-subtitle \.voice-subtitle-line \{([^}]+)\}/)[1], /white-space: pre-line/)
  assert.match(html, /--voice-special: light-dark\(#[\da-f]+, #[\da-f]+\)/)
})

test('突入停留固定 5000ms，任意字数与已知或未知音轨均不影响', () => {
  assert.equal(hold.CUTIN_HOLD_MS, 5000)
  assert.equal(hold.cutinHoldMs(), 5000)
  // 旧调用即使仍传字数与音轨，也不能恢复随语音或字数延长的口径。
  for (const length of [0, 1, 30, 100, 200, 10000]) {
    for (const ms of [null, 1, 500, 2200, 2201, 6000, 18400, 40000]) {
      assert.equal(hold.cutinHoldMs(length, ms), 5000)
    }
  }
})

test('旗舰与僚舰各自入场后固定停住 5 秒，长短语音与字数不改变退场时刻', async t => {
  const view = await setup(t, { audio: () => [
    { voiceDurations: [{ path: '/lead.mp3', ms: 1000 }, { path: '/wing.mp3', ms: 2000 }] },
    { voiceDurations: [{ path: '/wing.mp3', ms: 40000 }] },
  ] })
  view.show(cue, [{ ...view.lines[0], pathname: '/lead.mp3' }])
  const lead = view.cutin.children[0]
  await tick(t, 300)
  view.show({ ...cue, mstId: 2 }, [{ ...view.lines[0], text: '长'.repeat(200), pathname: '/wing.mp3' }])
  const wing = view.cutin.children[1]
  await tick(t, 220 + 5000 - 300 - 1)
  assert.doesNotMatch(lead.className, /leaving/)
  await tick(t, 1)
  assert.match(lead.className, /leaving/)
  assert.doesNotMatch(wing.className, /leaving/)
  animationEnd(lead, 'voice-cutin-out')
  await tick(t, 299)
  assert.doesNotMatch(wing.className, /leaving/)
  await tick(t, 1)
  assert.match(wing.className, /leaving/)
  await tick(t, 760)
  assert.equal(view.cutin.childElementCount, 0)
})

test('第三句只替换僚舰，同舰新句重新成为旗舰', async t => {
  const view = await setup(t)
  view.show(cue, [{ ...view.lines[0], text: '长'.repeat(30) }])
  const lead = view.cutin.children[0]
  assert.equal(lead.className, 'voice-cutin-line lead')
  view.show({ ...cue, mstId: 2 })
  const oldWing = view.cutin.children[1]
  view.show({ ...cue, mstId: 3 })
  assert.equal(view.cutin.childElementCount, 2)
  assert.equal(view.cutin.children[0], lead)
  assert.ok(!view.cutin.children.includes(oldWing))
  view.show()
  assert.equal(view.cutin.childElementCount, 1)
  assert.equal(view.cutin.children[0].className, 'voice-cutin-line lead')
})

test('长句按插入后的实际盒宽居中，僚舰跟随旗舰且两侧保留余量', async t => {
  const view = await setup(t, { boxWidth: 672 })
  const line = { ...view.lines[0], text: '大和，突击！武藏，跟上！第一战队，全部主炮，全力齐射！' }
  view.show(cue, [line])
  view.show({ ...cue, mstId: 2 }, [line])
  const [lead, wing] = view.cutin.children
  assert.equal(lead.style.left, '50%')
  assert.equal(wing.style.left, '41%')
  assert.equal(lead.properties.get('--cutin-scale'), (1.68).toFixed(2))
  assert.equal(wing.properties.get('--cutin-scale'), (1.36).toFixed(2))
  for (const item of [lead, wing]) {
    assert.equal(item.widthReads, 1)
    assert.equal(item.textContent, line.text)
    const center = parseFloat(item.style.left), halfWidth = item.layoutWidth / 1200 * 50
    assert.ok(center - halfWidth >= 3)
    assert.ok(center + halfWidth <= 97)
  }
  // 用户微调锚点后仍走同一夹住算法，覆盖左右两端而非钉死 58%。
  const computedStyle = globalThis.getComputedStyle
  for (const [anchor, expected] of [[95, '69%'], [5, `${672 / 1200 * 50 + 3}%`]]) {
    delete lead.style.left
    globalThis.getComputedStyle = element => element === view.cutin
      ? { getPropertyValue: key => key === '--cutin-x' ? `${anchor}%` : computedStyle(element).getPropertyValue(key) } : computedStyle(element)
    view.show({ ...cue, mstId: 2 }, [line])
    assert.equal(view.cutin.children[1].style.left, expected)
    assert.equal(view.cutin.children[1].widthReads, 1)
  }
})

test('短句在 58% 锚点获得完整 2.40 倍砸出', async t => {
  const view = await setup(t, { boxWidth: 240 })
  view.show()
  const item = view.cutin.children[0]
  assert.equal(item.style.left, '58%')
  assert.equal(item.properties.get('--cutin-scale'), '2.40')
  assert.equal(item.widthReads, 1)
})

for (const [boxWidth, expectedLeft] of [[670, '58%'], [671, '50%'], [672, '50%']]) {
  test(`折行判据含 0.1 个百分点容差：${boxWidth}px 旗舰位于 ${expectedLeft}`, async t => {
    const view = await setup(t, { boxWidth })
    view.show(cue, [{ ...view.lines[0], text: '长'.repeat(200) }])
    const item = view.cutin.children[0]
    assert.equal(item.style.left, expectedLeft)
    assert.equal(item.layoutWidth, boxWidth)
    assert.ok(item.layoutWidth <= 672)
    assert.equal(item.properties.get('--cutin-scale'), boxWidth === 670 ? '1.40' : (1.68).toFixed(2))
    assert.equal(item.widthReads, 1)
  })
}

test('折行上限读取宿主自定义属性，50% 上限的 600px 旗舰整块居中', async t => {
  const view = await setup(t, { boxWidth: 600, maxW: 50 })
  view.show()
  const item = view.cutin.children[0]
  assert.equal(item.style.left, '50%')
  assert.equal(item.properties.get('--cutin-scale'), '1.88')
  assert.equal(item.widthReads, 1)
  assert.equal(view.cutin.widthReads, 1)
})

test('短僚舰跟随折行旗舰当前中心减 9%，按自身宽度定砸出倍率', async t => {
  const view = await setup(t, { boxWidth: 672 })
  view.show()
  const lead = view.cutin.children[0]
  const createElement = globalThis.document.createElement
  globalThis.document.createElement = tag => Object.assign(createElement(tag), { layoutWidth: 240 })
  view.show({ ...cue, mstId: 2 })
  const wing = view.cutin.children[1]
  assert.equal(lead.style.left, '50%')
  assert.equal(wing.style.left, '41%')
  assert.equal(wing.properties.get('--cutin-scale'), '2.40')
  assert.deepEqual([lead.widthReads, wing.widthReads], [1, 1])
})

for (const [anchor, expectedLeft, expectedWing] of [[5, '13%', '13%'], [95, '87%', '78%']]) {
  test(`短句在 ${anchor}% 锚点夹住后仍保留 1.15 倍砸出下限`, async t => {
    const view = await setup(t, { boxWidth: 240, anchor })
    view.show()
    view.show({ ...cue, mstId: 2 })
    const [lead, wing] = view.cutin.children
    assert.equal(lead.style.left, expectedLeft)
    assert.equal(lead.properties.get('--cutin-scale'), '1.15')
    assert.equal(wing.style.left, expectedWing)
    assert.equal(wing.properties.get('--cutin-scale'), anchor === 5 ? '1.15' : '1.90')
    assert.deepEqual([lead.widthReads, wing.widthReads], [1, 1])
  })
}

test('短句仍在用户微调锚点，僚舰横坐标减 9%，不把所有句子挪到正中', async t => {
  const view = await setup(t, { boxWidth: 120, anchor: 61 })
  view.show()
  view.show({ ...cue, mstId: 2 })
  assert.deepEqual(view.cutin.children.map(item => item.style.left), ['61%', '52%'])
  assert.deepEqual(view.cutin.children.map(item => item.widthReads), [1, 1])
})

test('单行旗舰保留 CSS top，僚舰按两枚实际高度接排', async t => {
  const view = await setup(t)
  view.show()
  view.show({ ...cue, mstId: 2 })
  const [lead, wing] = view.cutin.children
  const leadHeight = 56 / 720 * 100, wingHeight = 56 / 720 * 100
  assert.equal(Object.hasOwn(lead.style, 'top'), false)
  assert.equal(wing.style.top, `${36 + leadHeight / 2 + 2 + wingHeight / 2}%`)
  assert.deepEqual([lead.widthReads, wing.widthReads], [1, 1])
})

test('僚舰读取旗舰此刻的三行高度，顶边与旗舰底边留出间隔', async t => {
  const view = await setup(t)
  view.show()
  const lead = view.cutin.children[0]
  lead.layoutHeight = 168
  view.show({ ...cue, mstId: 2 })
  const wing = view.cutin.children[1]
  const leadBottom = 36 + 168 / 720 * 50
  const wingHalfHeight = 56 / 720 * 50
  assert.equal(Object.hasOwn(lead.style, 'top'), false)
  assert.equal(parseFloat(wing.style.top), leadBottom + 2 + wingHalfHeight)
  assert.ok(parseFloat(wing.style.top) - wingHalfHeight >= leadBottom + 2)
})

test('极高旗舰上移给两行僚舰留位，僚舰接在其下且底边不超过 97%', async t => {
  const view = await setup(t, { anchorY: 60, boxWidth: 672, boxHeight: 432 })
  view.show()
  const lead = view.cutin.children[0]
  const createElement = globalThis.document.createElement
  globalThis.document.createElement = tag => Object.assign(createElement(tag), { layoutHeight: 112 })
  view.show({ ...cue, mstId: 2 })
  const wing = view.cutin.children[1]
  assert.deepEqual([lead.style.left, wing.style.left], ['50%', '41%'])
  const leadHeight = 432 / 720 * 100, wingHeight = 112 / 720 * 100
  const leadBottom = 100 - 3 - 16 - 2
  assert.equal(parseFloat(lead.style.top), leadBottom - leadHeight / 2)
  assert.ok(parseFloat(lead.style.top) < 60)
  assert.ok(parseFloat(lead.style.top) - leadHeight / 2 >= 3)
  assert.equal(parseFloat(wing.style.top), leadBottom + 2 + wingHeight / 2)
  assert.ok(parseFloat(wing.style.top) - wingHeight / 2 >= leadBottom + 2)
  assert.ok(parseFloat(wing.style.top) + wingHeight / 2 <= 97)
  assert.deepEqual([lead.widthReads, wing.widthReads], [1, 1])
})

test('旗舰未写行内 top 时，僚舰读取当前 CSS 锚点并夹住自身底边', async t => {
  const view = await setup(t, { anchorY: 42 })
  view.show()
  const lead = view.cutin.children[0]
  assert.equal(Object.hasOwn(lead.style, 'top'), false)
  const computedStyle = globalThis.getComputedStyle
  for (const anchorY of [48, 90]) {
    globalThis.getComputedStyle = element => element === view.cutin
      ? { getPropertyValue: key => key === '--cutin-y' ? `${anchorY}%` : computedStyle(element).getPropertyValue(key) } : computedStyle(element)
    view.show({ ...cue, mstId: 2 })
    const wing = view.cutin.children[1]
    const halfHeight = 56 / 720 * 50
    assert.equal(parseFloat(wing.style.top), Math.min(anchorY + halfHeight + 2 + halfHeight, 97 - halfHeight))
    assert.equal(Object.hasOwn(lead.style, 'top'), false)
    assert.equal(wing.widthReads, 1)
  }
})

test('突入不查询音轨，看门狗兜底移除，关闭后不再触发退场计时器', async t => {
  let audioQueries = 0
  const view = await setup(t, { audio: () => { audioQueries++; return null } })
  view.show(cue, [{ ...view.lines[0], pathname: '/lead.mp3' }])
  await tick(t, 220 + 5000)
  await tick(t, 760)
  assert.equal(view.cutin.childElementCount, 0)
  view.show(cue, [{ ...view.lines[0], pathname: '/lead.mp3' }])
  const item = view.cutin.children[0]
  captionRuntime.setVoiceCaptionsEnabled(false)
  await tick(t, 50000)
  assert.doesNotMatch(item.className, /leaving/)
  assert.equal(view.cutin.childElementCount, 0)
  assert.equal(audioQueries, 0, '突入字幕不应查询音轨')
})
