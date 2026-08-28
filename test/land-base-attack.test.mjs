import assert from 'node:assert/strict'
import test from 'node:test'

import lbas from '../dist/shared/land-base-attack.js'

const { kindMultiplier, landBaseWavePower, planeBasePower, wavesForCell } = lbas

const plane = (over = {}) => ({ type2: 47, torpedo: 12, bomb: 9, level: 0, count: 18, ...over })
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `期望 ${b}，实得 ${a}`)

test('種別倍率照抄原文，别把陸攻和艦攻混为一谈', () => {
  near(kindMultiplier(47), 0.8) // 陸攻
  near(kindMultiplier(53), 1) // 大型陸上機
  near(kindMultiplier(8), 1) // 艦攻
  near(kindMultiplier(7), 1) // 艦爆
  near(kindMultiplier(11), 1) // 水爆
  near(kindMultiplier(57), 0.7071) // 噴式
  near(kindMultiplier(6), 0) // 艦戦不参与对面攻击
  near(kindMultiplier(48), 0) // 局戦同理
})

test('打水上舰用雷装、打陆上型用爆装——陆攻打陆上型时雷装完全不参与', () => {
  const p = plane({ torpedo: 12, bomb: 9 })
  const sea = planeBasePower(p, false)
  const land = planeBasePower(p, true)
  assert.notEqual(sea, land)
  // 搭載数補正 1.8 乘在根号内（wikiwiki 原文：大型陸上機以外(陸攻含む)＝1.8）
  near(sea, 0.8 * (12 * Math.sqrt(1.8 * 18) + 25))
  near(land, 0.8 * (9 * Math.sqrt(1.8 * 18) + 25))
  // 只有雷装没有爆装的陆攻，打陆上型应当出不了力
  near(planeBasePower(plane({ torpedo: 12, bomb: 0 }), true), 0)
})

test('搭載数補正：大型陸上機 1.0、其余（含陸攻/借调舰载机）1.8，位置在根号内', () => {
  // 大型陸上機（深山系）不吃 1.8
  near(planeBasePower(plane({ type2: 53, count: 9 }), false), 1 * (12 * Math.sqrt(9) + 25))
  // 借调上基地的艦攻同样吃 1.8（与陸攻補正无关，那是另一个乘数）
  near(planeBasePower(plane({ type2: 8 }), false), 1 * (12 * Math.sqrt(1.8 * 18) + 25))
})

test('混合编成按陆上目标占比加权，不把整队一刀切成陆上型', () => {
  const attacker = plane({ torpedo: 12, bomb: 6 })
  const sea = landBaseWavePower({
    planes: [attacker],
    againstLand: false,
    enemyCombined: false,
  })
  const land = landBaseWavePower({
    planes: [attacker],
    againstLand: true,
    enemyCombined: false,
  })
  const mixed = landBaseWavePower({
    planes: [attacker],
    againstLand: false,
    landTargetShare: 1 / 3,
    enemyCombined: false,
  })
  near(mixed, sea * (2 / 3) + land * (1 / 3))
  assert.ok(mixed < sea)
  assert.ok(mixed > land)
})

test('改修强化值只给陸攻与大型陸上機', () => {
  const lv = { level: 10 }
  near(planeBasePower(plane({ ...lv }), false), 0.8 * ((12 + 0.7 * Math.sqrt(10)) * Math.sqrt(1.8 * 18) + 25))
  // 艦攻不吃基地改修强化值
  near(planeBasePower(plane({ type2: 8, ...lv }), false), 1 * (12 * Math.sqrt(1.8 * 18) + 25))
})

test('陸偵補正乘在基本攻撃力上：熟練 1.15、普通 1.125、没带不加成', () => {
  const attacker = plane()
  const base = landBaseWavePower({ planes: [attacker], againstLand: false, enemyCombined: false })
  const withRecon = landBaseWavePower({
    planes: [attacker, plane({ type2: 49, torpedo: 0, bomb: 0, count: 4, mstId: 311 })],
    againstLand: false,
    enemyCombined: false,
  })
  const withSkilled = landBaseWavePower({
    planes: [attacker, plane({ type2: 49, torpedo: 0, bomb: 0, count: 4, mstId: 312 })],
    againstLand: false,
    enemyCombined: false,
  })
  near(withRecon, base * 1.125)
  near(withSkilled, base * 1.15)
})

test('搭载归零则该中队不出力', () => {
  near(planeBasePower(plane({ count: 0 }), false), 0)
})

test('陸攻補正 ×1.8 只加给陸攻，敌联合 ×1.1 加在整波上', () => {
  const attacker = plane()
  const carrier = plane({ type2: 8 })
  const single = landBaseWavePower({ planes: [attacker], againstLand: false, enemyCombined: false })
  near(single, planeBasePower(attacker, false) * 1.8)
  // 艦攻不吃陸攻補正
  const byCarrier = landBaseWavePower({ planes: [carrier], againstLand: false, enemyCombined: false })
  near(byCarrier, planeBasePower(carrier, false))
  // 敌联合 ×1.1
  const combined = landBaseWavePower({ planes: [attacker], againstLand: false, enemyCombined: true })
  near(combined, single * 1.1)
})

test('概率项一律不假定发动——宁可低估也不给偏乐观的数', () => {
  // 暴击/熟练度暴击/触接都不计入；同一套输入两次结果必须相同（无随机）
  const input = { planes: [plane()], againstLand: true, enemyCombined: true }
  assert.equal(landBaseWavePower(input), landBaseWavePower(input))
})

test('只有派向该点的波数才算——道中点不能白送输出', () => {
  // 本机实测的真实派遣：第2、3队各两波打 40 点
  const strikes = { 2: [40, 40], 3: [40, 40] }
  assert.equal(wavesForCell(strikes, 2, 40), 2)
  assert.equal(wavesForCell(strikes, 3, 40), 2)
  assert.equal(wavesForCell(strikes, 1, 40), 0) // 第1队留防空，没派
  assert.equal(wavesForCell(strikes, 2, 38), 0) // 道中点没派陆航
  assert.equal(wavesForCell(null, 2, 40), 0)
  // 两波打不同点时各算各的
  assert.equal(wavesForCell({ 1: [23, 40] }, 1, 23), 1)
  assert.equal(wavesForCell({ 1: [23, 40] }, 1, 40), 1)
})
