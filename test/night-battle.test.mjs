import assert from 'node:assert/strict'
import test from 'node:test'

import night from '../dist/shared/night-battle.js'

const {
  NIGHT_CAP,
  GUARD_FORMATION,
  nightAttackBlock,
  nightBasePower,
  nightImprovement,
  nightPower,
} = night

const ship = (over = {}) => ({
  role: 'main',
  stype: 2,
  hp: 30,
  hpMax: 30,
  firepower: 60,
  torpedo: 80,
  equipment: [],
  ...over,
})

test('上限是 360，不是昼战那几个', () => {
  // 2021-03-01 由 300 上调至 360（wikiwiki「夜戦」）
  assert.equal(NIGHT_CAP, 360)
  // 未过上限时原样通过
  assert.equal(nightPower(ship({ firepower: 100, torpedo: 100 }), 1), 200)
  // 过上限后开方压缩：400 → 360 + √40
  assert.equal(
    nightPower(ship({ firepower: 200, torpedo: 200 }), 1),
    360 + Math.sqrt(40),
  )
})

test('基本攻击力是火力+雷装，没有昼战炮击那个 +5 常数', () => {
  assert.equal(nightBasePower(ship({ firepower: 60, torpedo: 80 })), 140)
  // 顺手抄昼战会写成 145——那是错的
  assert.notEqual(nightBasePower(ship({ firepower: 60, torpedo: 80 })), 145)
})

test('不吃阵形与交战形态补正，只有警戒阵对主力舰减半', () => {
  const s = ship({ firepower: 60, torpedo: 80 })
  const base = nightBasePower(s)
  // 单纵/复纵/轮形/梯形/单横/第一~第四警戒航行序列：一律不变
  for (const formation of [1, 2, 3, 4, 5, 11, 12, 13, 14]) {
    assert.equal(nightPower(s, formation), base, `阵形 ${formation} 不该改变夜战攻击力`)
  }
  // 警戒阵（6）：主力舰减半，警戒舰不受影响
  assert.equal(nightPower({ ...s, role: 'main' }, GUARD_FORMATION), base * 0.5)
  assert.equal(nightPower({ ...s, role: 'escort' }, GUARD_FORMATION), base)
})

test('改修强化值：声呐爆雷不参与夜战，探照灯参与', () => {
  const root = Math.sqrt(9)
  // 主砲/副砲/三式弾/徹甲弾/高射装置/探照灯 → √★
  for (const type2 of [1, 2, 3, 4, 18, 19, 21, 29]) {
    assert.equal(nightImprovement({ type2, level: 9 }), root, `type2 ${type2}`)
  }
  // 魚雷 → 1.2√★
  for (const type2 of [5, 22, 32]) {
    assert.equal(nightImprovement({ type2, level: 9 }), 1.2 * root, `type2 ${type2}`)
  }
  // 声呐(14)/爆雷(15)/大型声呐(40)：昼战对潜吃 0.75√★，夜战炮击一分不给。
  // 照抄昼战那张表会把带满声呐的驱逐虚报一截。
  for (const type2 of [14, 15, 40]) {
    assert.equal(nightImprovement({ type2, level: 9 }), 0, `type2 ${type2} 不该参与夜战炮击`)
  }
  assert.equal(nightImprovement({ type2: 1, level: 0 }), 0)
})

test('谁不能夜战：大破、空母、联合第一舰队、火力雷装皆无', () => {
  // 大破线是 floor(maxhp × 0.25)，取等号也算大破
  assert.equal(nightAttackBlock(ship({ hp: 7, hpMax: 30 }), 0), 'taiha')
  assert.equal(nightAttackBlock(ship({ hp: 8, hpMax: 30 }), 0), null)

  // 空母按 stype 判，不能按最终面板判——挂了舰攻的空母面板雷装是正数
  for (const stype of [7, 11, 18]) {
    assert.equal(nightAttackBlock(ship({ stype, torpedo: 60 }), 0), 'carrier')
  }
  // 水上机母舰(16)、潜水艦(13)不在此列
  assert.equal(nightAttackBlock(ship({ stype: 16 }), 0), null)
  assert.equal(nightAttackBlock(ship({ stype: 13, firepower: 0, torpedo: 90 }), 0), null)

  // 联合舰队的第一舰队整队不参加夜战
  assert.equal(nightAttackBlock(ship({ role: 'main' }), 1), 'mainOfCombined')
  assert.equal(nightAttackBlock(ship({ role: 'escort' }), 1), null)
  // 非联合时第一舰队照常出手
  assert.equal(nightAttackBlock(ship({ role: 'main' }), 0), null)

  assert.equal(nightAttackBlock(ship({ firepower: 0, torpedo: 0 }), 0), 'noPower')
})

test('对地补正走 cap 前，位置不能挪到外面', () => {
  const s = ship({ firepower: 200, torpedo: 200 }) // 基本 400，已过 360
  const outside = nightPower(s, 1) * 2
  const inside = nightPower(s, 1, 2)
  // 乘在外面会把「超上限的部分本该被开方压掉」这件事漏掉，结果显著偏大
  assert.ok(inside < outside, '对地补正乘在 cap 之后会高估')
  assert.equal(inside, 360 + Math.sqrt(800 - 360))
})
