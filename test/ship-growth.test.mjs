import assert from 'node:assert/strict'
import test from 'node:test'

import shipGrowth from '../dist/shared/ship-growth.js'

const { levelGrowth, MARRIED_LEVEL_CAP, marriageHpBonus, marriedMaxHp } = shipGrowth

test('三维成长公式钉着账本实测的样本', () => {
  // 2026-08-11 用户账本：183 艘全空槽在港舰逐项 546 项检查 544 项吻合。
  // 下面的三元组全部来自当日实测（kcwiki 初始/上限 + 游戏当前值）。
  // 婚舰(>99)继续按同斜率长——信赖@120 回避实测 97（Lv99 上限 89 被超过）
  assert.equal(levelGrowth(47, 89, 120), 97)
  assert.equal(levelGrowth(30, 77, 120), 86) // 信赖 对潜
  assert.equal(levelGrowth(10, 44, 120), 51) // 信赖 索敌
  assert.equal(levelGrowth(16, 53, 132), 65) // 榛名改二乙@132 索敌
  assert.equal(levelGrowth(10, 44, 129), 54) // 天津风改二@129 索敌
  assert.equal(levelGrowth(39, 81, 130), 94) // 最上改二特@130 回避
  assert.equal(levelGrowth(63, 98, 139), 112) // 时雨改三@139 回避
  // 上限≤初始时不成长（榛名对潜 0/0）
  assert.equal(levelGrowth(0, 0, 132), 0)
  // 缺资料（kcwiki 用 -1 标缺）返回 null，不硬造
  assert.equal(levelGrowth(-1, -1, 50), null)
  assert.equal(levelGrowth(10, 44, 0), null)
  // 上限依据 KC3Kai 经验表（Lv188 到下一级=0，175 之后还有整段）
  assert.equal(MARRIED_LEVEL_CAP, 188)
})

test('结婚耐久档位钉着账本 12 艘婚舰的实测', () => {
  // maxhp − api_taik[0] 实测：+5(34/35/37) +6(40) +7(53/59/61) +8(81/85) +9(98)
  assert.equal(marriageHpBonus(34), 5)
  assert.equal(marriageHpBonus(37), 5)
  assert.equal(marriageHpBonus(40), 6)
  assert.equal(marriageHpBonus(53), 7)
  assert.equal(marriageHpBonus(61), 7)
  assert.equal(marriageHpBonus(81), 8)
  assert.equal(marriageHpBonus(85), 8)
  assert.equal(marriageHpBonus(98), 9)
  // ≤29 档账本无样本，社区通说 +4（wikiwiki ケッコンカッコカリ）
  assert.equal(marriageHpBonus(9), 4)
  // 婚后值受 api_taik[1] 封顶
  assert.equal(marriedMaxHp(98, 110), 107) // 大和改二重实测 107
  assert.equal(marriedMaxHp(35, 55), 40) // 天津风改二实测 40
  assert.equal(marriedMaxHp(98, 100), 100) // 上限不足时封顶
  assert.equal(marriedMaxHp(0, 10), null)
})
