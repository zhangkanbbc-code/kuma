// 战果日历（2026-09-29 玩家提议、维护者裁决）：像理财日盈亏那样，按日看战果增加与名次变化。
// 裁决：战果卡加「日历」入口、单独弹一张可拖的日历卡；格子写当天战果增加 + 名次与升降；
// 绿涨红跌（名次上升＝绿）；日界按 JST 0 点；格子底色按当天战果多少深浅。
// 战果增加取 kuma 自记（senka_log，每天都有）；名次取当天（按排行刷新时刻的 JST 日期）最后看到的本人名次。
import assert from 'node:assert/strict'
import test from 'node:test'
import calendarModule from '../dist/shared/senka-calendar.js'
import rankingModule from '../dist/shared/senka-ranking.js'

const { senkaDailyGains, buildSenkaCalendar, senkaMonthTailWindow } = calendarModule
const { ownRankByDay } = rankingModule
const jst = (s) => Date.parse(`${s}+09:00`)

test('按日汇总：JST 0 点为界，同一天各笔相加', () => {
  const gains = senkaDailyGains([
    { ts: jst('2026-09-28T23:30'), senka: 10.5 },
    { ts: jst('2026-09-29T00:10'), senka: 1.2 },
    { ts: jst('2026-09-29T21:00'), senka: 130 },
    { ts: jst('2026-09-30T23:59'), senka: 4 },
  ])
  assert.deepEqual(Object.keys(gains).sort(), ['2026-09-28', '2026-09-29', '2026-09-30'])
  assert.equal(gains['2026-09-28'], 10.5)
  assert.ok(Math.abs(gains['2026-09-29'] - 131.2) < 1e-9)
})

const cellOf = (cal, day) => cal.weeks.flat().find((c) => c && c.day === day)

test('月历网格：周一在前，月初前补空格，每周 7 格', () => {
  const cal = buildSenkaCalendar({ month: '2026-09', gains: {}, ranks: [], today: '2026-09-29' })
  const lead = (new Date(Date.UTC(2026, 8, 1)).getUTCDay() + 6) % 7
  assert.equal(cal.weeks[0].filter((c) => c === null).length, lead)
  assert.ok(cal.weeks.every((w) => w.length === 7))
  assert.equal(cal.weeks.flat().filter(Boolean).length, 30)
  assert.equal(cal.label, '2026年9月')
})

// 2026-09-29 真账本试跑发现：排行每月初从头重算，跨月比会在每月 1 日冒出「↓1191」这种假下降。
// 升降只在同一个月内比，每月第一次看到的名次不标升降。
test('格子：当天增加、当天最后看到的名次、与本月上一次有名次的日子比升降', () => {
  const cal = buildSenkaCalendar({
    month: '2026-09',
    gains: { '2026-09-28': 90, '2026-09-29': 131.6 },
    ranks: [
      { day: '2026-08-31', rank: 1327 },
      { day: '2026-09-08', rank: 747 },
      { day: '2026-09-28', rank: 141 },
      { day: '2026-09-29', rank: 165 },
    ],
    today: '2026-09-29',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(cellOf(cal, '2026-09-29'))), {
    day: '2026-09-29', date: 29, gain: 131.6, rank: 165, rankDelta: -24, future: false, today: true,
  })
  // 9/28 比的是 9/8（中间没看排行的日子跳过）：747 → 141 上升 606
  assert.equal(cellOf(cal, '2026-09-28').rankDelta, 606)
  // 9/8 是本月第一次看到名次：不与上月 8/31 的 1327 比
  assert.equal(cellOf(cal, '2026-09-08').rankDelta, null)
  // 没看排行的日子没有名次
  assert.equal(cellOf(cal, '2026-09-10').rank, null)
  assert.equal(cellOf(cal, '2026-09-10').rankDelta, null)
  assert.equal(cellOf(cal, '2026-09-10').gain, 0)
  // 今天之后的格子标未来，不写数
  assert.deepEqual(JSON.parse(JSON.stringify(cellOf(cal, '2026-09-30'))), {
    day: '2026-09-30', date: 30, gain: 0, rank: null, rankDelta: null, future: true, today: false, tail: 0,
  })
})

test('月汇总：本月合计增加、本月最后看到的名次、当月单日最多（底色深浅的基准）', () => {
  const cal = buildSenkaCalendar({
    month: '2026-09',
    gains: { '2026-08-31': 999, '2026-09-28': 90, '2026-09-29': 131.6 },
    ranks: [{ day: '2026-09-28', rank: 141 }, { day: '2026-09-29', rank: 165 }],
    today: '2026-09-29',
  })
  assert.ok(Math.abs(cal.total - 221.6) < 1e-9, '不算上月的')
  assert.equal(cal.latestRank, 165)
  assert.equal(cal.maxGain, 131.6)
})

test('往月整月都是过去，没有「未来」格；翻到的月份没数据也照样出网格', () => {
  const cal = buildSenkaCalendar({ month: '2026-08', gains: {}, ranks: [], today: '2026-09-29' })
  assert.ok(cal.weeks.flat().filter(Boolean).every((c) => !c.future && !c.today))
  assert.equal(cal.weeks.flat().filter(Boolean).length, 31)
  assert.equal(cal.latestRank, null)
  assert.equal(cal.total, 0)
})

// 名次按日：沿用排行解码链（系数顺带、挑不准不解），按刷新时刻的 JST 日期归日，取当天最后一次。
const RIGHT = [8931, 1201, 1156, 5061, 4569, 4732, 3779, 4568, 5695, 4619, 4912, 5669, 6586]
const pageOf = (from, scores, factor, ownRank) => scores.map((senka, i) => ({
  api_mxltvkpyuklh: from + i,
  api_mtjmdcwtvhdr: from + i === ownRank ? '本人' : `提督${from + i}`,
  api_wuhnhojjxmke: (senka + 91) * factor * RIGHT[(from + i) % 13],
}))
const scores = [4400, 4390, 4380, 4370, 4360, 4350, 4340, 4330, 4320, 4267]

test('名次按日：刷新时刻的 JST 日期归日，取当天最后一次；凌晨看到的是前一天 15:00 那次', () => {
  const series = ownRankByDay([
    { ts: jst('2026-09-28T22:53'), server: null, list: pageOf(132, scores, 76, 141) },
    { ts: jst('2026-09-29T02:30'), server: null, list: pageOf(142, scores, 76, 151) }, // 属 9/28 15:00 那次
    { ts: jst('2026-09-29T16:58'), server: null, list: pageOf(156, scores, 76, 165) },
  ], { nickname: '本人', ownHintAt: () => 4230 })
  assert.deepEqual(JSON.parse(JSON.stringify(series)), [
    { day: '2026-09-28', rank: 151, senka: 4267 },
    { day: '2026-09-29', rank: 165, senka: 4267 },
  ])
})

// 2026-09-30 维护者提出、裁决：战果月在月末那天 22:00 切换，日历却按自然日。
// 格子照旧按自然日；「本月合计」改按战果月（与战果卡一致）；月末那一格单独记 22 点后计入下月的那段（tail），
// 本月日历另记上月末 22 点后计入本月的那段（head）。
test('月末 22 点窗口：该月最后一天 22:00 到次月 1 日 0:00（JST）', () => {
  assert.deepEqual(senkaMonthTailWindow('2026-09'), { from: jst('2026-09-30T22:00'), to: jst('2026-10-01T00:00') })
  assert.deepEqual(senkaMonthTailWindow('2026-08'), { from: jst('2026-08-31T22:00'), to: jst('2026-09-01T00:00') })
  assert.deepEqual(senkaMonthTailWindow('2026-02'), { from: jst('2026-02-28T22:00'), to: jst('2026-03-01T00:00') })
  assert.deepEqual(senkaMonthTailWindow('2026-12'), { from: jst('2026-12-31T22:00'), to: jst('2027-01-01T00:00') })
})

test('本月合计按战果月：自然月合计 − 月末 22 点后 + 上月末 22 点后；月末那格带 tail，模型带 head', () => {
  const cal = buildSenkaCalendar({
    month: '2026-09',
    gains: { '2026-09-01': 100, '2026-09-30': 50 },
    ranks: [],
    today: '2026-09-30',
    tail: 8,
    head: 0.1,
  })
  assert.ok(Math.abs(cal.total - (150 - 8 + 0.1)) < 1e-9)
  assert.equal(cal.head, 0.1)
  assert.equal(cellOf(cal, '2026-09-30').tail, 8)
  assert.equal(cellOf(cal, '2026-09-30').gain, 50, '格子本身仍是自然日合计')
  assert.equal(cellOf(cal, '2026-09-29').tail, undefined, '只有月末那格带 tail')
  // 不传 tail/head 时按 0
  const plain = buildSenkaCalendar({ month: '2026-09', gains: { '2026-09-01': 100 }, ranks: [], today: '2026-09-30' })
  assert.equal(plain.total, 100)
  assert.equal(plain.head, 0)
  assert.equal(cellOf(plain, '2026-09-30').tail, 0)
})
