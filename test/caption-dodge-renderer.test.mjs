import assert from 'node:assert/strict'
import test from 'node:test'
import dodge from '../dist/shared/caption-dodge.js'
import hold from '../dist/shared/voice-caption-hold.js'
import sections from '../dist/shared/settings-sections.js'
import { captionRuntime, captionMessages, captionsFromLodes } from './fixtures/render-ship-caption.mjs'
import { cardHtml, mountYu } from './fixtures/render-yu.mjs'

test('钥默认开，首次点击关闭并热切；语音文字关闭时置灰且不切换', () => {
  const key = dodge.CAPTION_DODGE_CONFIG_KEY
  const yu = mountYu({ ui: { [sections.SETTINGS_SECTION_UI_KEY]: 'ui' } })
  const card = cardHtml(yu.pane.innerHTML, 'ui-hints')
  assert.ok(card.includes(`class="ysw on" data-toggle="${key}"`))
  assert.ok(card.indexOf('显示语音文字') < card.indexOf('鼠标移到字幕上时淡出'))
  assert.ok(card.indexOf('鼠标移到字幕上时淡出') < card.indexOf('特殊攻击视觉加强'))
  assert.ok(card.includes('指针停在字幕范围内时字幕变淡 · 移开恢复'))
  yu.click({ toggle: key })
  assert.equal(yu.configOf(key), false)
  assert.deepEqual(yu.captionDodge(), [false])
  const disabled = mountYu({
    ui: { [sections.SETTINGS_SECTION_UI_KEY]: 'ui' },
    config: { 'kuma.voiceCaptions': false },
  })
  const disabledCard = cardHtml(disabled.pane.innerHTML, 'ui-hints')
  assert.match(disabledCard, /class="yrow dis">\s*<span class="ytx"><b>鼠标移到字幕上时淡出<\/b>/)
  assert.ok(!disabledCard.includes(`data-toggle="${key}"`))
  disabled.click({ toggle: key })
  assert.equal(disabled.configOf(key), undefined)
  assert.deepEqual(disabled.captionDodge(), [])
})

const setup = async (t, audio = () => null) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const previous = { document: globalThis.document, window: globalThis.window, frame: globalThis.requestAnimationFrame }
  const classes = new Set(), frames = [], listeners = new Map(), events = new Map()
  const textNode = () => ({ textContent: '', replaceChildren() { this.textContent = '' } })
  const speaker = textNode(), line = textNode()
  let reads = 0
  const host = {
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
    querySelector: selector => selector === '.voice-subtitle-speaker' ? speaker : line,
    getBoundingClientRect: () => { reads++; return { left: 140, top: 450, width: 920, height: 50 } },
    offsetWidth: 920,
  }
  globalThis.document = {
    querySelector: selector => ({
      '#voice-subtitle': host,
      '#game-wrapper': { getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 500 }) },
      '#game-wrapper webview': { executeJavaScript: async () => audio() },
    })[selector] ?? null,
    fonts: { load: async () => [] },
  }
  globalThis.window = { addEventListener: (name, callback) => events.set(name, callback) }
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
  captionRuntime.setVoiceCaptionsEnabled(true)
  captionRuntime.setVoiceCaptionDodge(true)
  await captionsFromLodes({}, { kind: 'ship', mstId: 1, voiceId: 2 })
  captionRuntime.initVoiceSubtitles({ addListener: (name, callback) => listeners.set(name, callback) })
  frames.splice(0).forEach(callback => callback())
  captionMessages().length = 0
  t.after(() => {
    captionRuntime.setVoiceCaptionsEnabled(false)
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.requestAnimationFrame = previous.frame
    t.mock.timers.reset()
  })
  return {
    classes, frames, sent: captionMessages(), reads: () => reads,
    show: () => captionRuntime.testShowSubtitle({ speaker: '测试', text: '字幕', pathname: '/kcs/sound/test.mp3' }),
    flush: () => frames.splice(0).forEach(callback => callback()),
    hover: inside => listeners.get(dodge.CAPTION_HOVER_EVENT)(inside),
    resize: () => events.get('resize')(),
  }
}

test('宿主在显示后的下一帧推区域，悬停切类，resize 一帧只重算一次', async t => {
  const f = await setup(t)
  f.show()
  assert.deepEqual(f.sent, [[dodge.CAPTION_ZONE_CHANNEL, null]])
  f.flush()
  assert.equal(f.classes.has('show'), true)
  assert.equal(f.reads(), 0)
  f.flush()
  assert.deepEqual(f.sent.at(-1), [dodge.CAPTION_ZONE_CHANNEL, { x0: 0.04, y0: 0.8, x1: 0.96, y1: 0.9 }])
  f.hover(true); assert.equal(f.classes.has('dodge'), true)
  f.hover(false); assert.equal(f.classes.has('dodge'), false)
  f.resize(); f.resize(); f.resize()
  assert.equal(f.frames.length, 1)
  f.flush()
  assert.equal(f.reads(), 2)
})

test('宿主关闭淡出或语音文字立即清空，待执行区域帧与迟到悬停不能恢复', async t => {
  const f = await setup(t)
  f.show(); f.flush(); f.flush(); f.hover(true)
  f.resize()
  captionRuntime.setVoiceCaptionDodge(false)
  assert.equal(f.classes.has('dodge'), false)
  assert.deepEqual(f.sent.at(-1), [dodge.CAPTION_ZONE_CHANNEL, null])
  const count = f.sent.length
  f.flush(); f.hover(true)
  assert.equal(f.sent.length, count)
  assert.equal(f.classes.has('dodge'), false)
  captionRuntime.setVoiceCaptionDodge(true); f.flush(); f.hover(true)
  assert.equal(f.classes.has('dodge'), true)
  captionRuntime.setVoiceCaptionsEnabled(false)
  assert.equal(f.classes.has('show'), false)
  assert.equal(f.classes.has('dodge'), false)
  assert.deepEqual(f.sent.at(-1), [dodge.CAPTION_ZONE_CHANNEL, null])
  f.hover(true); f.resize(); f.flush()
  assert.equal(f.classes.has('dodge'), false)
})

test('显示帧执行前关闭语音文字，旧帧不重新显示字幕或发送区域', async t => {
  const f = await setup(t)
  f.show()
  captionRuntime.setVoiceCaptionsEnabled(false)
  f.flush(); f.flush()
  assert.equal(f.classes.has('show'), false)
  assert.ok(f.sent.every(([, value]) => value === null))
})

for (const duration of [null, 10000]) {
  test(`字幕${duration ? '续到音轨结束' : '最短展示结束'}退场时清区并摘淡出类`, async t => {
    const f = await setup(t, () => duration ? [{ voiceDurations: [{ path: '/kcs/sound/test.mp3', ms: duration }] }] : null)
    f.show(); f.flush(); f.flush(); f.hover(true)
    t.mock.timers.tick(hold.captionMinHoldMs(2))
    for (let i = 0; i < 8; i++) await Promise.resolve()
    if (duration) {
      assert.equal(f.classes.has('show'), true)
      t.mock.timers.tick(10000)
    }
    assert.equal(f.classes.has('show'), false)
    assert.equal(f.classes.has('dodge'), false)
    assert.deepEqual(f.sent.at(-1), [dodge.CAPTION_ZONE_CHANNEL, null])
  })
}
