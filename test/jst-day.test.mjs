// JST 自然日的真测试（2026-08-20 定：史的演习页日卡改按 JST 日分组）。
//
// 为什么值得单独抽出来测：渲染层打包成 iife，模块里的分组逻辑测不到，
// 只能钉源码文本；而「差一天」这种错，源码文本看着完全正常。
// 所以判据本身放进 src/shared，在这里跑真值。
//
// 全文用**绝对 UTC 时刻**构造样本，不碰 new Date().setHours()——
// 那个跟着跑测试的机器时区走，本机绿了别的机器可能红。
import assert from 'node:assert/strict'
import test from 'node:test'

import jstDay from '../dist/shared/jst-day.js'

const { jstDayStart, fmtJstDate } = jstDay.default ?? jstDay

const DAY = 86_400_000
const HOUR = 3_600_000
/** 一个绝对时刻（参数是 UTC 墙上时间） */
const utc = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h, min)
/** 若观察者在 UTC+offsetHours，这一刻属于哪个「本地自然日」（旧口径） */
const localDayKeyAt = (ts, offsetHours) =>
  Math.floor((ts + offsetHours * HOUR) / DAY) * DAY - offsetHours * HOUR

test('jstDayStart 切在 JST 00:00 上，而不是 UTC 或本地 00:00', () => {
  // JST 2026-08-20 00:00 == UTC 2026-08-19 15:00
  const jstMidnight = utc(2026, 8, 19, 15, 0)
  assert.equal(jstDayStart(jstMidnight), jstMidnight, '日界那一刻应当就是自己所在日的起点')
  assert.equal(jstDayStart(jstMidnight + DAY - 1), jstMidnight, '同一 JST 日的最后一毫秒仍归这一天')
  assert.equal(jstDayStart(jstMidnight - 1), jstMidnight - DAY, '日界前一毫秒归前一天')
  // 切在 UTC 00:00 上就会错：UTC 2026-08-19 15:00 的 UTC 日是 08-19，JST 日是 08-20
  assert.notEqual(jstDayStart(jstMidnight), Math.floor(jstMidnight / DAY) * DAY)
})

test('fmtJstDate 念的是 JST 日历日，不是本地日历日', () => {
  assert.equal(fmtJstDate(utc(2026, 8, 19, 15, 0)), '2026-08-20') // JST 00:00
  assert.equal(fmtJstDate(utc(2026, 8, 19, 14, 59)), '2026-08-19') // JST 23:59
  // 标签必须能直接喂 jstDayStart 的返回值——日卡就是这么用的
  const day = jstDayStart(utc(2026, 8, 19, 20, 12))
  assert.equal(fmtJstDate(day), '2026-08-20')
  // 反例钉死：同一个 day 值按 **UTC 日历**念是 08-19。kernel 的 fmtDate 按本地
  // 日历念，本机 UTC+8 下同样会念成 08-19——所以日卡标签不能走 fmtDate。
  assert.equal(new Date(day).toISOString().slice(0, 10), '2026-08-19')
})

test('跨本地午夜的演习场次落进同一张 JST 日卡（本机 UTC+8）', () => {
  // 晚场（JST 15:00–次日 03:00）横跨本地午夜：本机 UTC+8 比 JST 慢一小时，
  // JST 日界落在**本地 23:00**。
  const beforeLocalMidnight = utc(2026, 8, 19, 15, 30) // 本地 08-19 23:30 / JST 08-20 00:30
  const afterLocalMidnight = utc(2026, 8, 19, 16, 30) // 本地 08-20 00:30 / JST 08-20 01:30

  // 旧口径（本地自然日）把这两场劈进两张卡——这正是要修的
  assert.notEqual(
    localDayKeyAt(beforeLocalMidnight, 8),
    localDayKeyAt(afterLocalMidnight, 8),
    '样本没跨本地午夜，这条测试就没在测它想测的东西',
  )
  // 新口径：同一 JST 日、同一张卡、同一个标签
  assert.equal(jstDayStart(beforeLocalMidnight), jstDayStart(afterLocalMidnight))
  assert.equal(fmtJstDate(beforeLocalMidnight), '2026-08-20')
  assert.equal(fmtJstDate(afterLocalMidnight), '2026-08-20')
  // 这张 JST 日卡的起点，对 UTC+8 的观察者是**前一天的 23:00**
  assert.equal(jstDayStart(afterLocalMidnight), utc(2026, 8, 19, 15, 0))
})

test('晚场跨 JST 日界仍分两张卡——这是口径本身，不是漏网', () => {
  // 晚场定义就是「15:00–次日 03:00 JST」，页头也是这么写的：JST 00:00–03:00
  // 那一段属于**下一个** JST 日。日卡按 JST 日切，于是它落在次日卡上。
  // 把这一条钉住，免得后来者把它当 bug「修」成按场次起点归日。
  const eveningStart = utc(2026, 8, 19, 8, 0) // JST 08-19 17:00
  const eveningTail = utc(2026, 8, 19, 15, 30) // JST 08-20 00:30（同一个晚场的尾巴）
  assert.equal(fmtJstDate(eveningStart), '2026-08-19')
  assert.equal(fmtJstDate(eveningTail), '2026-08-20')
  assert.notEqual(jstDayStart(eveningStart), jstDayStart(eveningTail))
})
