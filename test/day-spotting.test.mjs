import assert from 'node:assert/strict'
import test from 'node:test'

import spotting from '../dist/shared/day-spotting.js'

const {
  FLAGSHIP_BONUS,
  SPOTTING_TYPES,
  spottingMultiplier,
  spottingScore,
  spottingTypesOf,
} = spotting

const eq = (type2, over = {}) => ({ type2, planeCount: 0, los: 0, ...over })
const mainGun = () => eq(2)
const seaplane = () => eq(10, { planeCount: 1, los: 5 })
const ship = (over = {}) => ({ hp: 60, hpMax: 60, luck: 25, flagship: false, equipment: [], ...over })

test('四个前提缺一不可', () => {
  const full = ship({ equipment: [mainGun(), mainGun(), seaplane()] })
  assert.equal(spottingTypesOf(full, 1).length > 0, true, '确保 + 主砲2 + 水侦应当能发动')
  assert.equal(spottingTypesOf(full, 2).length > 0, true, '优势同样能发动')

  // 制空：均衡(0)/劣势(3)/丧失(4) 一律不发动
  for (const state of [0, 3, 4]) {
    assert.deepEqual(spottingTypesOf(full, state), [], `制空状态 ${state} 不该发动`)
  }
  // 大破不能发动（中破以下＝不是大破）；大破线取等号也算大破
  assert.deepEqual(spottingTypesOf({ ...full, hp: 15, hpMax: 60 }, 1), [])
  assert.ok(spottingTypesOf({ ...full, hp: 16, hpMax: 60 }, 1).length > 0)
  // 没主砲不发动
  assert.deepEqual(spottingTypesOf(ship({ equipment: [seaplane()] }), 1), [])
  // 有水侦但那一格搭载数为 0 —— 空格的水侦不算
  assert.deepEqual(
    spottingTypesOf(ship({ equipment: [mainGun(), mainGun(), eq(10, { planeCount: 0 })] }), 1),
    [],
  )
})

test('种别与倍率照抄原表，顺序按倍率从高到低', () => {
  const table = Object.fromEntries(SPOTTING_TYPES.map((t) => [t.kind, t]))
  assert.deepEqual(
    [table.mainMain.multiplier, table.mainMain.attacks, table.mainMain.divisor],
    [1.5, 1, 150],
  )
  assert.deepEqual([table.mainAp.multiplier, table.mainAp.divisor], [1.3, 140])
  assert.deepEqual([table.mainRadar.multiplier, table.mainRadar.divisor], [1.2, 130])
  assert.deepEqual([table.mainSecondary.multiplier, table.mainSecondary.divisor], [1.1, 120])
  // 連撃是 1.2 倍打**两次**——写成 2.4 倍一次就丢了「两次各自判命中」这件事
  assert.deepEqual([table.double.multiplier, table.double.attacks, table.double.divisor], [1.2, 2, 130])

  // 主砲2 → 主主 CI 与連撃都是候选；主砲1+徹甲弾 → 只有主徹
  const kinds = (equipment) => spottingTypesOf(ship({ equipment }), 1).map((t) => t.kind)
  assert.deepEqual(kinds([mainGun(), mainGun(), seaplane()]), ['mainMain', 'double'])
  assert.deepEqual(kinds([mainGun(), eq(19), seaplane()]), ['mainAp'])
  assert.deepEqual(kinds([mainGun(), eq(13), seaplane()]), ['mainRadar'])
  assert.deepEqual(kinds([mainGun(), eq(4), seaplane()]), ['mainSecondary'])
  // 主砲2 + 徹甲弾 + 電探：多种候选按倍率降序排
  assert.deepEqual(
    kinds([mainGun(), mainGun(), eq(19), eq(12), seaplane()]),
    ['mainMain', 'mainAp', 'mainRadar', 'double'],
  )
})

test('観測項按确保/优势两条式子分算，旗舰 +15', () => {
  const s = ship({ luck: 25, equipment: [mainGun(), eq(10, { planeCount: 1, los: 12 })] })
  const luckTerm = Math.floor(Math.sqrt(25) + 10) // 15
  // 确保：⌊luckTerm + 0.7×(1.6×装备索敌 + 10)⌋
  assert.equal(spottingScore(s, 1), Math.floor(luckTerm + 0.7 * (1.6 * 12 + 10)))
  // 优势：⌊luckTerm + 0.6×(1.2×装备索敌)⌋，且没有那个 +10
  assert.equal(spottingScore(s, 2), Math.floor(luckTerm + 0.6 * (1.2 * 12)))
  // 确保比优势高——两式的差别正是这 10% 左右
  assert.ok(spottingScore(s, 1) > spottingScore(s, 2))
  // 旗舰补正
  assert.equal(FLAGSHIP_BONUS, 15)
  assert.equal(spottingScore({ ...s, flagship: true }, 1), spottingScore(s, 1) + 15)
})

test('期望倍率按依次条件掷骰，都没中就是 1', () => {
  const s = ship({ luck: 25, equipment: [mainGun(), mainGun(), seaplane()] })
  const out = spottingMultiplier(s, 1)
  const score = Math.ceil(spottingScore(s, 1))
  const p1 = score / 150 // 主主 CI
  const p2 = score / 130 // 連撃（主主没中才轮到）
  assert.equal(out.rolls.length, 2)
  assert.ok(Math.abs(out.expected - (p1 * 1.5 + (1 - p1) * p2 * 1.2 * 2 + (1 - p1) * (1 - p2))) < 1e-9)
  assert.ok(out.expected > 1, '能发动就该比普通攻击高')
  assert.ok(out.expected < 2.4, '不能当成必定連撃')

  // 前提不满足时是干净的 1，不是 0 也不是别的
  assert.deepEqual(spottingMultiplier(ship({ equipment: [] }), 1), { expected: 1, rolls: [] })
  assert.equal(spottingMultiplier(s, 4).expected, 1)
})

test('运和装备索敌都会抬发动率，方向不能反', () => {
  const base = ship({ luck: 10, equipment: [mainGun(), mainGun(), seaplane()] })
  const lucky = { ...base, luck: 90 }
  const scouty = ship({
    luck: 10,
    equipment: [mainGun(), mainGun(), eq(10, { planeCount: 1, los: 20 })],
  })
  assert.ok(spottingMultiplier(lucky, 1).expected > spottingMultiplier(base, 1).expected)
  assert.ok(spottingMultiplier(scouty, 1).expected > spottingMultiplier(base, 1).expected)
  assert.ok(
    spottingMultiplier({ ...base, flagship: true }, 1).expected >
      spottingMultiplier(base, 1).expected,
  )
})
