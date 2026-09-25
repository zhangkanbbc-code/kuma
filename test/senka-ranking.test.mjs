// 排行榜战果解码（2026-09-25 维护者要的：打开排行页时读出各名次的具体战果，
// 详情弹窗列表 + 第 5/20/100/500 名按日曲线，本人那一行自动校准）。
//
// 口径来源：公开实现 yamatosaki/yahagi-kancolle-browser（senka_reducer.dart，2026-09-12 仍在更新）
// 与 rsky/logbook-kai-plugins rankingchart —— 战果 = api_wuhnhojjxmke ÷ 名次系数[名次 % 13] ÷ 玩家系数 − 91；
// api_mtjmdcwtvhdr 是昵称，api_mxltvkpyuklh 是名次。玩家系数会变（维护者账本 09-10 前后 88 → 76），
// 只能从同页编码值的公因数里挑，再拿本人自记战果当锚点。
// 维护者账本 227 页实测：名次系数整除率 100%；挑出的系数解出本人战果与 kuma 自记差 30～60；
// 统计截止取「刷新前 1 小时」（02:00 / 14:00 JST）与自记增量平均差最小（1.7）。
import assert from 'node:assert/strict'
import test from 'node:test'
import rankingModule from '../dist/shared/senka-ranking.js'

const {
  SENKA_RANK_FACTORS,
  rankingRefreshAt,
  rankingCutoffAt,
  decodeRankingPage,
  senkaLineSeries,
  assembleSenkaRanking,
  fillLineGaps,
} = rankingModule

const RIGHT = [8931, 1201, 1156, 5061, 4569, 4732, 3779, 4568, 5695, 4619, 4912, 5669, 6586]
const encode = (rank, senka, factor) => (senka + 91) * factor * RIGHT[rank % 13]
const pageOf = (from, scores, factor, ownRank = null) => scores.map((senka, i) => ({
  api_mxltvkpyuklh: from + i,
  api_mtjmdcwtvhdr: from + i === ownRank ? '本人' : `提督${from + i}`,
  api_wuhnhojjxmke: encode(from + i, senka, factor),
}))
const H = 3600e3
const jst = (s) => Date.parse(`${s}+09:00`)

test('名次系数表与公开实现一致（13 项）', () => {
  assert.deepEqual([...SENKA_RANK_FACTORS], RIGHT)
})

test('刷新时刻取不晚于它的最近一个 03:00 / 15:00 JST，统计截止再早 1 小时', () => {
  assert.equal(rankingRefreshAt(jst('2026-09-25T09:40')), jst('2026-09-25T03:00'))
  assert.equal(rankingRefreshAt(jst('2026-09-25T15:00')), jst('2026-09-25T15:00'))
  assert.equal(rankingRefreshAt(jst('2026-09-25T23:59')), jst('2026-09-25T15:00'))
  assert.equal(rankingRefreshAt(jst('2026-09-26T02:59')), jst('2026-09-25T15:00'))
  assert.equal(rankingCutoffAt(jst('2026-09-25T09:40')), jst('2026-09-25T02:00'))
  assert.equal(rankingCutoffAt(jst('2026-09-25T16:10')), jst('2026-09-25T14:00'))
})

const scores = [1500, 1490, 1480, 1470, 1460, 1450, 1440, 1430, 1420, 1385]

test('本人在页上：从公因数候选里挑出与自记战果最接近的系数，整页解码', () => {
  // 系数 76 时公因数候选为 19/38/76，本人 1385、自记 1350
  const page = pageOf(221, scores, 76, 230)
  const out = decodeRankingPage(page, { nickname: '本人', ownHint: 1350, lastFactor: null })
  assert.equal(out.factor, 76)
  assert.deepEqual(out.own, { rank: 230, senka: 1385 })
  assert.deepEqual(out.rows.map((r) => r.senka), scores)
  assert.deepEqual(out.rows.map((r) => r.rank), Array.from({ length: 10 }, (_, i) => 221 + i))
  assert.equal(out.rows[0].nickname, '提督221')
})

test('本人不在页上：沿用上次的系数（仍能整除时）', () => {
  const page = pageOf(1, [9000, 8800, 8700, 8600, 8500, 8400, 8300, 8200, 8100, 8000], 76)
  const out = decodeRankingPage(page, { nickname: '本人', ownHint: 1350, lastFactor: 76 })
  assert.equal(out.factor, 76)
  assert.equal(out.own, null)
  assert.equal(out.rows[4].senka, 8500)
})

test('系数换了：上次的系数不再整除时，按本人那一行重新挑', () => {
  const page = pageOf(221, scores, 76, 230)
  const out = decodeRankingPage(page, { nickname: '本人', ownHint: 1350, lastFactor: 88 })
  assert.equal(out.factor, 76)
})

test('上次的系数虽能整除、但本人解出来离自记太远：不沿用，改按本人挑', () => {
  // 真系数 76；上次记的 38 也能整除，但解出来是本人 2861，离自记 1350 太远
  const page = pageOf(221, scores, 76, 230)
  const out = decodeRankingPage(page, { nickname: '本人', ownHint: 1350, lastFactor: 38 })
  assert.equal(out.factor, 76)
})

test('挑不准就不解：本人不在页上且没有可沿用的系数、候选不止一个', () => {
  const page = pageOf(1, [9000, 8800, 8700, 8600, 8500, 8400, 8300, 8200, 8100, 8000], 76)
  assert.equal(decodeRankingPage(page, { nickname: '本人', ownHint: 1350, lastFactor: null }), null)
})

test('挑不准就不解：月初数值小、自记附近有不止一个候选', () => {
  // 真系数 88；各行（战果+91）都是 21 的倍数，公因数 1848 让 77/84/88 都成了候选，
  // 本人解出来分别是 53/41/35，都落在自记 30 的容差（60）里——分不出来就不解
  const page = pageOf(2511, [140, 119, 98, 77, 56, 56, 56, 35, 35, 35], 88, 2520)
  assert.equal(decodeRankingPage(page, { nickname: '本人', ownHint: 30, lastFactor: null }), null)
  // 同一页若上次的系数 88 仍能整除、且本人解出来在容差内：沿用，照常解
  assert.equal(decodeRankingPage(page, { nickname: '本人', ownHint: 30, lastFactor: 88 }).factor, 88)
})

test('本人在页上但所有候选都离自记太远：不解', () => {
  const page = pageOf(221, scores, 76, 230)
  assert.equal(decodeRankingPage(page, { nickname: '本人', ownHint: 9000, lastFactor: null }), null)
})

test('编码值不能被名次系数整除（口径变了）：整页不解', () => {
  const page = pageOf(221, scores, 76, 230)
  page[3].api_wuhnhojjxmke += 1
  assert.equal(decodeRankingPage(page, { nickname: '本人', ownHint: 1350, lastFactor: 76 }), null)
})

test('按日曲线：第 5/20/100/500 名各取当天最后一次看到的值，没看到的日子不出点', () => {
  const snap = (ts, rows) => ({ ts, rows })
  const series = senkaLineSeries([
    snap(jst('2026-09-10T04:00'), [{ rank: 5, senka: 3000 }, { rank: 6, senka: 2990 }]),
    snap(jst('2026-09-10T16:00'), [{ rank: 5, senka: 3100 }, { rank: 20, senka: 2500 }]),
    snap(jst('2026-09-11T05:00'), [{ rank: 5, senka: 3300 }]),
    snap(jst('2026-09-12T15:30'), [{ rank: 100, senka: 1800 }, { rank: 500, senka: 900 }]),
    // 同一刷新内先后看到两次：以后一次为准
    snap(jst('2026-09-12T16:00'), [{ rank: 100, senka: 1810 }]),
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(series)), {
    5: [{ day: '2026-09-10', senka: 3100 }, { day: '2026-09-11', senka: 3300 }],
    20: [{ day: '2026-09-10', senka: 2500 }],
    100: [{ day: '2026-09-12', senka: 1810 }],
    500: [{ day: '2026-09-12', senka: 900 }],
  })
})

test('按日曲线的「日」按刷新时刻的 JST 日期算：凌晨 02:30 看到的是前一天 15:00 那次刷新', () => {
  const series = senkaLineSeries([{ ts: jst('2026-09-11T02:30'), rows: [{ rank: 5, senka: 3200 }] }])
  assert.deepEqual(JSON.parse(JSON.stringify(series[5])), [{ day: '2026-09-10', senka: 3200 }])
  assert.deepEqual(series[20], [])
})

// ---- 整份视图：主进程只取数，拼装全在这里 ----
// 服务器：排行按服务器分开排。新页随报文记下当时的服务器；记录之前的旧页没有主机信息，
// 舰C账号不能换服务器，按当前账号的服务器补上并标 serverInferred。
const YOKOSUKA = { num: 1, name: '横須賀鎮守府', host: 'w01y.kancolle-server.com' }
const SEP = { monthStart: Date.parse('2026-08-31T22:00+09:00'), monthEnd: Date.parse('2026-09-30T22:00+09:00') }
const ownPage = (ts, own, factor = 76, server = null) => ({ ts, server, list: pageOf(221, [...scores.slice(0, 9), own], factor, 230) })

test('整份视图：沿时间顺序带着系数走，只收本战果月；列表取最近一次刷新里看过的各页', () => {
  const hints = new Map()
  const view = assembleSenkaRanking([
    // 上月末那页（统计截止 08-31 14:00，属上个战果月）：只用来把系数带进本月，不进列表与曲线
    ownPage(jst('2026-08-31T20:00'), 1300),
    ownPage(jst('2026-09-10T22:37'), 1385),
    // 同一次刷新（09-10 15:00）里又翻到第 1 页：本人不在页上，沿用 76
    { ts: jst('2026-09-10T22:40'), server: YOKOSUKA, list: pageOf(1, [3500, 3400, 3300, 3200, 3100, 3000, 2900, 2800, 2700, 2600], 76) },
  ].map((p, i) => ({ ...p, server: p.server ?? (i === 0 ? null : YOKOSUKA) })), {
    nickname: '本人', ...SEP, fallbackServer: YOKOSUKA,
    ownHintAt: (cutoff) => { hints.set(cutoff, true); return 1350 },
  })
  assert.equal(view.refreshAt, jst('2026-09-10T15:00'))
  assert.deepEqual(view.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230])
  assert.deepEqual(view.rows.filter((r) => r.own).map((r) => r.rank), [230])
  assert.deepEqual(JSON.parse(JSON.stringify(view.lines[5])), [{ day: '2026-09-10', senka: 3100 }])
  assert.equal(view.undecoded, 0)
  // 本人自记锚点按统计截止时刻（刷新前 1 小时）去问
  assert.ok(hints.has(jst('2026-09-10T14:00')))
  // 自动校准：本月最近一次解出的本人战果，时刻取统计截止
  assert.deepEqual(view.ownCalibration, { value: 1385, ts: jst('2026-09-10T14:00') })
  assert.deepEqual(view.server, YOKOSUKA)
  assert.equal(view.serverInferred, false)
})

test('刷新换了：列表只留新一次刷新里看过的页，旧刷新的页不混进来', () => {
  const view = assembleSenkaRanking([
    ownPage(jst('2026-09-10T22:37'), 1385, 76, YOKOSUKA),
    { ts: jst('2026-09-10T22:40'), server: YOKOSUKA, list: pageOf(1, [3500, 3400, 3300, 3200, 3100, 3000, 2900, 2800, 2700, 2600], 76) },
    ownPage(jst('2026-09-11T05:00'), 1420, 76, YOKOSUKA),
  ], { nickname: '本人', ...SEP, fallbackServer: YOKOSUKA, ownHintAt: () => 1400 })
  assert.equal(view.refreshAt, jst('2026-09-11T03:00'))
  assert.deepEqual(view.rows.map((r) => r.rank), [221, 222, 223, 224, 225, 226, 227, 228, 229, 230])
  assert.equal(view.rows.at(-1).senka, 1420)
  assert.deepEqual(view.ownCalibration, { value: 1420, ts: jst('2026-09-11T02:00') })
})

test('旧页没有服务器记录：按当前账号的服务器补上并标明是推定', () => {
  const view = assembleSenkaRanking([ownPage(jst('2026-09-10T22:37'), 1385, 76, null)],
    { nickname: '本人', ...SEP, fallbackServer: YOKOSUKA, ownHintAt: () => 1350 })
  assert.deepEqual(view.server, YOKOSUKA)
  assert.equal(view.serverInferred, true)
})

test('解不出的页计数、不进列表与曲线；本月一页都没有时是空视图', () => {
  const bad = ownPage(jst('2026-09-12T10:00'), 1385, 76, YOKOSUKA)
  bad.list[2].api_wuhnhojjxmke += 1
  const view = assembleSenkaRanking([bad], { nickname: '本人', ...SEP, fallbackServer: YOKOSUKA, ownHintAt: () => 1350 })
  assert.equal(view.undecoded, 1)
  assert.deepEqual(view.rows, [])
  assert.equal(view.ownCalibration, null)
  const empty = assembleSenkaRanking([], { nickname: '本人', ...SEP, fallbackServer: null, ownHintAt: () => null })
  assert.equal(empty.refreshAt, null)
  assert.deepEqual(empty.rows, [])
  assert.deepEqual(JSON.parse(JSON.stringify(empty.lines)), { 5: [], 20: [], 100: [], 500: [] })
  assert.equal(empty.server, null)
})

// 2026-09-25 维护者裁决：某天没看到那一名时，不沿用前一天画成平线；
// 在前后两个真实点之间按日期线性插值补点、标成估算（界面画灰点），折线才连得起来。
// 只在第一个与最后一个真实点之间补，首尾之外不外推。
test('曲线补点：两个真实点之间缺的日子按日期线性插值并标估算，首尾之外不外推', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(fillLineGaps([
    { day: '2026-09-10', senka: 3000 },
    { day: '2026-09-13', senka: 3300 },
    { day: '2026-09-14', senka: 3350 },
  ]))), [
    { day: '2026-09-10', senka: 3000 },
    { day: '2026-09-11', senka: 3100, estimated: true },
    { day: '2026-09-12', senka: 3200, estimated: true },
    { day: '2026-09-13', senka: 3300 },
    { day: '2026-09-14', senka: 3350 },
  ])
  // 插值取整
  assert.deepEqual(JSON.parse(JSON.stringify(fillLineGaps([
    { day: '2026-09-30', senka: 100 },
    { day: '2026-10-03', senka: 200 },
  ]))).map((p) => p.senka), [100, 133, 167, 200])
  assert.deepEqual(fillLineGaps([]), [])
  assert.deepEqual(JSON.parse(JSON.stringify(fillLineGaps([{ day: '2026-09-10', senka: 3000 }]))), [{ day: '2026-09-10', senka: 3000 }])
})
