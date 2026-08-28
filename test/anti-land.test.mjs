import assert from 'node:assert/strict'
import test from 'node:test'

import antiLand from '../dist/shared/anti-land.js'

const { HYAKUICHI_SHIP_IDS, SOURCE_NOTES, antiLandBonus, armyUnitBonus } = antiLand

const eq = (mstId, type2, level = 0) => ({ mstId, type2, level })
// 本次排查那一场，第百一号輸送艦改的真实配装
const CHIHA = eq(497, 52)
const INFANTRY = eq(496, 52)
const CHIHA_KAI = eq(498, 52)
const KATSU = eq(525, 46) // 特四式内火艇
const KAMI = eq(167, 46) // 特二式内火艇
const HYAKUICHI = 727
const OTHER_SHIP = 622

const near = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tol, `期望 ${expected}，实得 ${actual}`)

test('三式弹对不同陆上型差到天上——绝不能用一套值套所有敌人', () => {
  const sanshiki = [eq(35, 18)]
  const at = (kind) => antiLandBonus(OTHER_SHIP, sanshiki, kind)
  near(at('supply').postCap, 1) // 集積地那一列写的是 ×1
  near(at('harbor').preCap, 2.5)
  near(at('summerHarbor').preCap, 1.75)
  near(at('isolated').preCap, 1.75)
  near(at('pillbox').preCap, 1) // 对トーチカ完全无效
})

test('登陆艇的「类别补正」是整组一次的底数，不是每件各乘一次', () => {
  // 原文反例：大発動艇 + 陸戦隊 = 1.4×1.2 ✓，不是 1.4×1.4×1.2 ✗
  const one = antiLandBonus(OTHER_SHIP, [eq(68, 24)], 'harbor')
  near(one.preCap, 1.4 * 1) // 底数 1.4 × 大発動艇 1.0
  const two = antiLandBonus(OTHER_SHIP, [eq(68, 24), eq(166, 24)], 'harbor')
  near(two.preCap, 1.4 * 1 * 1.5) // 底数仍只乘一次，再乘陸戦隊组 1 件的 1.5
  assert.ok(two.preCap < 1.4 * 1.4 * 1.5, '登陆艇底数被重复乘了')
})

test('改修分母登陆艇 /50、内火艇 /30——两个分母不同，别抄混', () => {
  const landing = antiLandBonus(OTHER_SHIP, [eq(68, 24, 10)], 'harbor')
  near(landing.preCap, 1.4 * 1 * (1 + 10 / 50))
  const amphi = antiLandBonus(OTHER_SHIP, [{ ...KAMI, level: 10 }], 'supply')
  near(amphi.postCap, 1.7 * (1 + 10 / 30))
})

test('两源冲突用第三方计算例裁决过，台账要留着', () => {
  assert.equal(SOURCE_NOTES.length, 2)
  for (const note of SOURCE_NOTES) {
    assert.ok(note.basis.includes('2.267'), `${note.item} 的裁决依据丢了`)
    assert.ok(note.verdict)
  }
  // 那个计算例本身：特二式内火艇★max 对集積地 = 2.267
  const kamiMax = antiLandBonus(OTHER_SHIP, [{ ...KAMI, level: 10 }], 'supply')
  near(kamiMax.postCap, 2.2666666, 1e-4)
})

// ---- 第百一号輸送艦系列专用 ----

test('陸戦部隊補正只有第百一号系列能触发', () => {
  const kit = [CHIHA, INFANTRY]
  assert.ok(armyUnitBonus(HYAKUICHI, kit, 'supply') > 1)
  assert.equal(armyUnitBonus(945, kit, 'supply'), armyUnitBonus(727, kit, 'supply'))
  // 别的舰即使（假设）装上了也不给——这是单舰独占机制
  assert.equal(armyUnitBonus(OTHER_SHIP, kit, 'supply'), 1)
})

test('陸戦部隊補正只对集積地棲姫系生效', () => {
  const kit = [CHIHA, INFANTRY]
  assert.ok(armyUnitBonus(HYAKUICHI, kit, 'supply') > 1)
  for (const kind of ['pillbox', 'isolated', 'harbor', 'summerHarbor']) {
    assert.equal(armyUnitBonus(HYAKUICHI, kit, kind), 1, `${kind} 不该吃陸戦部隊補正`)
  }
})

test('本机实测那一场：チハ + 陸軍歩兵部隊 = ×11.47', () => {
  // 陸戦部隊 2 件 → 3.15 × 2.35；陸軍歩兵部隊 → ×1.55；チハ改補正不适用
  near(armyUnitBonus(HYAKUICHI, [CHIHA, INFANTRY], 'supply'), 3.15 * 2.35 * 1.55, 1e-9)
  near(armyUnitBonus(HYAKUICHI, [CHIHA, INFANTRY], 'supply'), 11.473875, 1e-6)
})

test('照抄页面的两个计算例', () => {
  // 陸軍歩兵部隊＋チハ改 + チハ改 + 特二式内火艇★max = ×31.209
  const a = antiLandBonus(HYAKUICHI, [eq(499, 52), CHIHA_KAI, { ...KAMI, level: 10 }], 'supply')
  near(a.postCap, 31.209, 0.002)
  // 陸軍歩兵部隊＋チハ改 + チハ改 + チハ = ×16.522（陸戦部隊 3 件，无内火艇）
  const b = antiLandBonus(HYAKUICHI, [eq(499, 52), CHIHA_KAI, CHIHA], 'supply')
  near(b.postCap, 16.522, 0.002)
})

test('陸戦部隊按件数累积，チハ改与歩兵部隊各自只算一次', () => {
  const one = armyUnitBonus(HYAKUICHI, [CHIHA], 'supply')
  const two = armyUnitBonus(HYAKUICHI, [CHIHA, eq(497, 52)], 'supply')
  near(one, 3.15)
  near(two, 3.15 * 2.35)
  // 两件都带歩兵部隊补正的装备，1.55 也只乘一次
  const doubleInfantry = armyUnitBonus(HYAKUICHI, [INFANTRY, eq(499, 52)], 'supply')
  near(doubleInfantry, 3.15 * 2.35 * 1.2 * 1.55) // 499 同时吃チハ改与歩兵部隊，各一次
})

test('集積地是 cap 后、其余是 cap 前——两段不能混', () => {
  const kit = [CHIHA, INFANTRY, KATSU]
  const supply = antiLandBonus(HYAKUICHI, kit, 'supply')
  assert.equal(supply.preCap, 1, '集積地的补正跑到 cap 前去了')
  assert.ok(supply.postCap > 10)

  const harbor = antiLandBonus(HYAKUICHI, [eq(68, 24)], 'harbor')
  assert.ok(harbor.preCap > 1)
  assert.equal(harbor.postCap, 1, '非集積地的补正跑到 cap 后去了')
})

test('昼のみ的部分单独出，夜战要能扣掉', () => {
  const armed = antiLandBonus(OTHER_SHIP, [eq(409, 24)], 'harbor')
  near(armed.dayOnlyPreCap, 1.5)
  // 昼のみ 不能混进 preCap，否则夜战剔不掉
  near(armed.preCap, 1.4 * 1) // 只有登陆艇底数
})

test('按 mstId 判而不是名字——チハ 有两个完全不同的东西', () => {
  // 特大発動艇+チハ(494, type2=24 登陆艇) 与 九七式中戦車(チハ)(497, type2=52) 名字都含「チハ」
  const asLanding = antiLandBonus(HYAKUICHI, [eq(494, 24)], 'supply')
  const asArmy = antiLandBonus(HYAKUICHI, [eq(497, 52)], 'supply')
  assert.notEqual(asLanding.postCap, asArmy.postCap)
  near(asArmy.postCap, 3.15) // 陸戦部隊 1 件
  // 494 是登陆艇，走登陆艇那套，不该拿到陸戦部隊補正
  assert.ok(asLanding.postCap < 3.15)
})

test('第百一号系列的 id 别写错，那是整套模型的开关', () => {
  assert.deepEqual([...HYAKUICHI_SHIP_IDS], [727, 945])
})
