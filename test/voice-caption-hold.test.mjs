// 语音字幕停留多久。2026-08-26 用户实报：长台词在没有下一句顶掉它的时候会提前消失，
// 语音还在播，屏幕上已经空了。根因是那条纯字数公式的 9 秒硬上限——时报/婚礼/长句
// 的音轨十几到二十几秒都有，字幕挂到 9 秒就走。
//
// 修法是「底部字幕以音轨真实时长为准」，判据在 src/shared/voice-caption-hold.ts。
// 这一份对着**真的那三个函数**下断言（不是正则匹配源码文本，
// 见 shared/source-pattern-guards-miss-logic-bugs）。

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CAPTION_TAIL_MS,
  captionHideAtMs,
  captionMinHoldMs,
  danmakuDurationSeconds,
} from '../src/shared/voice-caption-hold.ts'

test('第一段仍是旧公式：它的职责变成「什么时候去问真时长」，数一个都没改', () => {
  // 短句压在 4.2 秒下界
  assert.equal(captionMinHoldMs(0), 4_200)
  assert.equal(captionMinHoldMs(10), 4_200)
  // 中段按 2400 + 字数*95 走
  assert.equal(captionMinHoldMs(30), 5_250)
  // 长句仍撞 9 秒上限——正因为它撞得住，才需要到期之后那一次查询
  assert.equal(captionMinHoldMs(70), 9_000)
  assert.equal(captionMinHoldMs(200), 9_000)
})

test('查到真时长就照着音轨走：18 秒的长台词挂到 19.2 秒，远晚于旧的 9 秒上限', () => {
  const shownAtMs = 1_000_000
  const hideAt = captionHideAtMs({ shownAtMs, textLength: 60, audioMs: 18_000 })
  assert.equal(hideAt, shownAtMs + 18_000 + CAPTION_TAIL_MS)
  assert.equal(hideAt - shownAtMs, 19_200)
  // 这正是这次修的那件事：旧口径这一句 9 秒就走了，音轨还有 9 秒没播完
  assert.ok(hideAt - shownAtMs > 9_000, '长音轨没能盖过旧的 9 秒上限')
})

test('真时长比第一段还短的短句：到期即退，不会被兜底往后拖', () => {
  const shownAtMs = 1_000_000
  const textLength = 8
  const hideAt = captionHideAtMs({ shownAtMs, textLength, audioMs: 3_000 })
  // 调用方是在**最短展示到期之后**才拿这个值和 now 比的，
  // 算出来早于那一刻就是「立刻退」——语义正确，不是倒退
  assert.ok(hideAt <= shownAtMs + captionMinHoldMs(textLength), '短音轨反而被拖到更晚')
  assert.equal(hideAt, shownAtMs + 4_200)
})

test('查不到真时长就落回字数估算，而且比旧公式宽得多', () => {
  const shownAtMs = 0
  // 60 字：2400 + 60*220 = 15600，旧口径是 9000
  assert.equal(captionHideAtMs({ shownAtMs, textLength: 60, audioMs: null }), 15_600)
  // 24 秒的上限盖得住最长那批音轨，也不让一句话霸着屏幕不走
  assert.equal(captionHideAtMs({ shownAtMs, textLength: 200, audioMs: null }), 24_000)
  assert.equal(captionHideAtMs({ shownAtMs, textLength: 1_000, audioMs: null }), 24_000)
  // 下界压着第一段，不许出现「兜底比最短展示还短」这种倒挂
  for (const textLength of [0, 1, 5, 8, 12, 20]) {
    assert.ok(
      captionHideAtMs({ shownAtMs, textLength, audioMs: null }) >= captionMinHoldMs(textLength),
      `${textLength} 字的兜底比最短展示还早`,
    )
  }
})

test('拿到的不是个正数时一律当没查到——0 与负数不能把字幕当场收走', () => {
  const shownAtMs = 500
  const fallback = captionHideAtMs({ shownAtMs, textLength: 40, audioMs: null })
  assert.equal(captionHideAtMs({ shownAtMs, textLength: 40, audioMs: 0 }), fallback)
  assert.equal(captionHideAtMs({ shownAtMs, textLength: 40, audioMs: -1 }), fallback)
})

test('弹幕：14 字以内维持 6 秒，更长逐字加时，10 秒封顶', () => {
  assert.equal(danmakuDurationSeconds(0), 6)
  assert.equal(danmakuDurationSeconds(10), 6)
  assert.equal(danmakuDurationSeconds(14), 6)
  // 30 字：6 + 16*0.12
  assert.equal(danmakuDurationSeconds(30), 7.92)
  assert.equal(danmakuDurationSeconds(100), 10)
  assert.equal(danmakuDurationSeconds(500), 10)
  // 单调不减：越长的台词绝不会比短的走得更快
  let previous = 0
  for (let length = 0; length <= 200; length += 1) {
    const seconds = danmakuDurationSeconds(length)
    assert.ok(seconds >= previous, `${length} 字反而更快`)
    previous = seconds
  }
})

test('弹幕时长要原样写进 CSS 变量：不许带二进制小数的尾巴', () => {
  for (let length = 0; length <= 200; length += 1) {
    const seconds = danmakuDurationSeconds(length)
    assert.equal(`${seconds}`.replace(/^\d+(?:\.\d{1,2})?$/, ''), '', `${length} 字算出 ${seconds}`)
  }
})
