// 母港泊地修理（明石タイマー）的判据与推算。
//
// 这一份**直接 import 真模块**（dist/shared/berth-repair.js），断言的是真代码的行为：
// 门槛的比较写反、20 分闸门的方向写反、覆盖表少加一、取整取成向上，
// 这里逐条都会红——正是源码正则拦不住的那一类。
//
// 机制出处逐条记在 src/shared/berth-repair.ts 的头注里（每条带来源与源数），
// 这里只钉行为。要改口径先去改那份头注，别只改数字。
import assert from 'node:assert/strict'
import test from 'node:test'

import berth from '../dist/shared/berth-repair.js'

const {
  BERTH_WARMUP_MS,
  REPAIR_FACILITY_MST_ID,
  REPAIR_SHIP_STYPE,
  BERTH_RESET_REASONS,
  berthBankedDecks,
  berthCoverage,
  berthEstimateHp,
  berthHalt,
  berthShipState,
  berthWarmupRatio,
} = berth

const MIN = 60_000

// ---- ① 覆盖范围：施設数 → 覆盖到第几艘 ----

test('覆盖表：不带施設是 2 艘，每多一个多一艘，带满 4 个覆盖全队', () => {
  // 四源一致（含 KancolleSniffer 源码的 `施設数 + 2`），见 shared 头注 ②
  assert.equal(berthCoverage(0), 2)
  assert.equal(berthCoverage(1), 3)
  assert.equal(berthCoverage(2), 4)
  assert.equal(berthCoverage(3), 5)
  assert.equal(berthCoverage(4), 6)
})

test('覆盖数封顶在 6：一支舰队就 6 个位置，装再多也没人可修', () => {
  assert.equal(berthCoverage(5), 6)
  assert.equal(berthCoverage(99), 6)
})

test('施設数是负数或小数也不会算出怪覆盖', () => {
  assert.equal(berthCoverage(-3), 2)
  assert.equal(berthCoverage(2.9), 4) // 向下取整，不会靠小数偷到第 5 位
})

// ---- ② 门槛：HP 比例的边界 ----

test('门槛卡在 HP 比例 50%：刚好 50% 不修，50% 以上才修', () => {
  // 「中破以上不修」四源一致（shared 头注 ③）。中破的界限与编队表同一把尺：
  // 比例 ≤ 0.5 即中破。边界两侧各取一格，写成 >= 或 > 反了都会红。
  assert.equal(berthShipState({ nowhp: 20, maxhp: 40 }, false), 'hurt') // 正好 50%
  assert.equal(berthShipState({ nowhp: 21, maxhp: 40 }, false), 'repairing') // 52.5%
  assert.equal(berthShipState({ nowhp: 10, maxhp: 40 }, false), 'hurt') // 大破也一样够不着
})

test('满血不算在修，入渠中的舰压过其余一切', () => {
  assert.equal(berthShipState({ nowhp: 40, maxhp: 40 }, false), 'full')
  // 入渠最先判：她正在别处修，说「满血 / 中破」都答非所问
  assert.equal(berthShipState({ nowhp: 39, maxhp: 40 }, true), 'docked')
  assert.equal(berthShipState({ nowhp: 5, maxhp: 40 }, true), 'docked')
  assert.equal(berthShipState({ nowhp: 40, maxhp: 40 }, true), 'docked')
})

// ---- ③ 整队停摆 ----

test('旗舰中破以上整队不修，边界同样卡在 50%', () => {
  // 三源一致（kcmemo 的执行条件 / KancolleSniffer 源码 / kamigame），见 shared 头注 ⑤
  const idle = { onMission: false, flagDocked: false }
  assert.equal(berthHalt({ nowhp: 20, maxhp: 40 }, idle), 'flagHurt')
  assert.equal(berthHalt({ nowhp: 21, maxhp: 40 }, idle), null)
})

test('远征压过旗舰状态，旗舰在渠也停', () => {
  const healthy = { nowhp: 40, maxhp: 40 }
  assert.equal(berthHalt(healthy, { onMission: true, flagDocked: false }), 'mission')
  assert.equal(berthHalt(healthy, { onMission: false, flagDocked: true }), 'flagDocked')
  // 人都不在泊地，旗舰什么状态都不用问了
  assert.equal(
    berthHalt({ nowhp: 1, maxhp: 40 }, { onMission: true, flagDocked: true }),
    'mission',
  )
})

// ---- ④ 20 分钟闸门前后的估算值 ----

const SHIP = (nowhp, maxhp, ndockMin) => ({ nowhp, maxhp, ndockTime: ndockMin * MIN })

test('不满 20 分钟一点都不回，满 20 分钟那一刻才开始', () => {
  const ship = SHIP(38, 40, 22) // 缺 2 点、入渠 22 分 → 每点 11 分
  assert.equal(berthEstimateHp(ship, 0), 0)
  assert.equal(berthEstimateHp(ship, 19 * MIN), 0)
  assert.equal(berthEstimateHp(ship, BERTH_WARMUP_MS - 1), 0, '差 1 毫秒都不该给')
  assert.equal(berthEstimateHp(ship, BERTH_WARMUP_MS), 1)
})

test('过了闸门按入渠速度折算：22 分 2 点的舰，20 分回 1 点、22 分回 2 点', () => {
  // 这个算例在多家攻略里流传，两个开源实现的公式都算得出它（shared 头注 ⑥）
  const ship = SHIP(38, 40, 22)
  assert.equal(berthEstimateHp(ship, 20 * MIN), 1)
  assert.equal(berthEstimateHp(ship, 21 * MIN), 1)
  assert.equal(berthEstimateHp(ship, 22 * MIN), 2)
})

test('最低保证 1 点：每点 HP 要 40 分的大型舰，20 分时也给 1 点', () => {
  // 这条才是「大型舰每 20 分钟回一次港比正常入渠快」的原理——
  // 此处 floor 本身算出的是 0，被下限夹到 1。夹取写没了这里就会红。
  const big = SHIP(9, 10, 40) // 缺 1 点、入渠 40 分
  assert.equal(Math.floor((20 * MIN) / (40 * MIN)), 0, '前提：floor 本来给 0')
  assert.equal(berthEstimateHp(big, 20 * MIN), 1)
})

test('回复量不会超过缺的那几点', () => {
  const ship = SHIP(38, 40, 22)
  assert.equal(berthEstimateHp(ship, 100 * MIN), 2, '缺 2 点就只能回 2 点')
  assert.equal(berthEstimateHp(SHIP(40, 40, 0), 100 * MIN), 0, '满血没什么可回')
})

test('经过时间先截到整分钟：秒的零头不许把估算顶上去', () => {
  // kcmemo 的 floor(秒/60)*60。这一步做没了，22 分那一格会提前几十秒跳数。
  const ship = SHIP(38, 40, 22)
  assert.equal(berthEstimateHp(ship, 21 * MIN + 59_000), 1, '21 分 59 秒仍按 21 分算')
  assert.equal(berthEstimateHp(ship, 22 * MIN), 2)
})

test('不知道入渠要多久就不猜', () => {
  assert.equal(berthEstimateHp({ nowhp: 30, maxhp: 40, ndockTime: 0 }, 100 * MIN), 0)
  assert.equal(berthEstimateHp({ nowhp: 30, maxhp: 40, ndockTime: -1 }, 100 * MIN), 0)
})

test('预热进度只在 0..1 之间，满 20 分钟就是满格', () => {
  assert.equal(berthWarmupRatio(0), 0)
  assert.equal(berthWarmupRatio(10 * MIN), 0.5)
  assert.equal(berthWarmupRatio(BERTH_WARMUP_MS), 1)
  assert.equal(berthWarmupRatio(99 * MIN), 1)
  assert.equal(berthWarmupRatio(-5), 0)
})

// ---- ⑤ 回港落账探测 ----

const DECKS = [
  { id: 1, ships: [101, 102, 103] },
  { id: 2, ships: [201, -1, -1] },
]

test('回港前后耐久涨了 → 那支队算结过账', () => {
  const banked = berthBankedDecks(
    DECKS,
    new Map([[101, 30], [102, 20], [103, 40], [201, 15]]),
    new Set(),
    new Map([[101, 30], [102, 22], [103, 40], [201, 15]]), // 102 涨了 2
  )
  assert.deepEqual(banked, [1])
})

test('在渠的那艘涨血不算：那是入渠的功劳', () => {
  const banked = berthBankedDecks(
    DECKS,
    new Map([[101, 30], [102, 20], [201, 15]]),
    new Set([102]), // 102 正在渠里
    new Map([[101, 30], [102, 40], [201, 15]]),
  )
  assert.deepEqual(banked, [])
})

test('掉血、没动、以及空位都不算落账', () => {
  const same = new Map([[101, 30], [102, 20], [201, 15]])
  assert.deepEqual(berthBankedDecks(DECKS, same, new Set(), same), [])
  // 出击回来是掉血，不该被当成修好了
  assert.deepEqual(
    berthBankedDecks(DECKS, same, new Set(), new Map([[101, 30], [102, 5], [201, 15]])),
    [],
  )
  // 账上还没有这艘舰时不猜
  assert.deepEqual(berthBankedDecks(DECKS, new Map(), new Set(), same), [])
})

test('两支队各自结账，互不牵连', () => {
  const banked = berthBankedDecks(
    DECKS,
    new Map([[101, 30], [102, 20], [201, 15]]),
    new Set(),
    new Map([[101, 31], [102, 20], [201, 16]]),
  )
  assert.deepEqual(banked, [1, 2])
})

// ---- ⑥ 常量本身 ----

test('几个判据常量钉住，改了要有人知道', () => {
  assert.equal(BERTH_WARMUP_MS, 20 * MIN)
  assert.equal(REPAIR_FACILITY_MST_ID, 31, '艦艇修理施設的装备 id（取自仓里的真主数据样本）')
  assert.equal(REPAIR_SHIP_STYPE, 19, '工作艦：明石 / 明石改 / 朝日改 就是它的全部')
})

test('重置清单只有查证站得住的那两条', () => {
  // 有意留短。补给/装备/入渠/出击各家说法不一或只有单源，一条都没进来；
  // 遠征属于「停止」而不是「归零」，走 berthHalt 那条路。
  // 谁要往里加一条，先去 shared 头注 ⑧ 补出处。
  assert.deepEqual([...BERTH_RESET_REASONS], ['hensei', 'banked'])
})
