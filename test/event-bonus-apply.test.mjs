import assert from 'node:assert/strict'
import test from 'node:test'

import apply from '../dist/shared/event-bonus-apply.js'

const { eventBonusFor, scopeApplies } = apply

// 照抄本次 E4 的真实条目（kcwiki，2026.08.07）
const E4 = [
  { scope: '全图', by: 'stype', key: '驱逐', value: 1.04, certain: true },
  { scope: '全图', by: 'stype', key: '轻巡', value: 1.06, certain: true },
  { scope: '全图', by: 'nation', key: '英', value: 1.15, certain: true },
  { scope: '全图', by: 'nation', key: '苏', value: 1.06, certain: true },
  { scope: '全图', by: 'ship', key: 'Mogador', value: 1.659, certain: true },
  { scope: '全图', by: 'ship', key: 'Jean Bart', value: 1.7695, certain: false },
  { scope: 'P4 Boss（X点）', by: 'stype', key: '驱逐', value: 1.06, certain: true },
  { scope: 'P4 Boss（X点）', by: 'stype', key: '重巡', value: 1.13, certain: true },
  { scope: 'P4 Boss（X点）', by: 'equipGroup', key: 'B组', value: 1.08, certain: true },
  { scope: 'P4 Boss（X点）', by: 'equipGroup', key: 'C组', value: 1.04, certain: true },
  { scope: 'P1 Boss（D点）', by: 'stype', key: '驱逐', value: 1.06, certain: true },
]
const GROUPS = {
  B组: [497, 526, 355], // 九七式中戦車(チハ)、特四式内火艇改、M4A1 DD
  C组: [496, 525, 167], // 陸軍歩兵部隊、特四式内火艇、特二式内火艇
}
const ship = (over = {}) => ({ mstId: 1, name: '某舰', stype: 2, nationality: null, ...over })
const at = (s, equips, letter, groups = GROUPS) => eventBonusFor(s, equips, E4, letter, groups)
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `期望 ${b}，实得 ${a}`)

test('全图与点位是两条独立条目，都命中就都乘', () => {
  const dd = at(ship({ stype: 2 }), [], 'X')
  near(dd.multiplier, 1.04 * 1.06) // 全图驱逐 × X点驱逐
  assert.equal(dd.applied.length, 2)
  // 不在该点时只吃全图那条
  near(at(ship({ stype: 2 }), [], null).multiplier, 1.04)
})

test('点位条目只在对应点生效，不能被别的点蹭到', () => {
  assert.equal(scopeApplies('全图', null), true)
  assert.equal(scopeApplies('P4 Boss（X点）', 'X'), true)
  assert.equal(scopeApplies('P4 Boss（X点）', 'D'), false)
  // 'S点' 不能因为 scope 里有 'Boss' 就命中
  assert.equal(scopeApplies('P4 Boss（X点）', 'S'), false)
  assert.equal(scopeApplies('P4 Boss（X点）', null), false)
})

test('倍卡表的「苏」对应本仓库国籍表的「俄」——必须显式对齐', () => {
  // 用戦艦(stype 9) 隔离：它不在 E4 的舰种列里，乘出来的只会是国籍那一项
  const bb = (nationality) => at(ship({ stype: 9, nationality }), [], null).multiplier
  near(bb('俄'), 1.06) // 本仓库记「俄」，倍卡表列名是「苏」
  near(bb('英'), 1.15)
  near(bb('日'), 1) // 没有倍卡的国籍不给加成
  near(bb(null), 1)
})

test('舰种、国籍、个别舰三类叠乘', () => {
  // Mogador：法国驱逐。全图驱逐 1.04 × X点驱逐 1.06 × 个别舰 1.659
  const mogador = at(ship({ name: 'Mogador', stype: 2, nationality: '法' }), [], 'X')
  near(mogador.multiplier, 1.04 * 1.06 * 1.659)
  assert.equal(mogador.applied.length, 3)
})

test('区间/推定值要让整个结果失去确定性', () => {
  const jb = at(ship({ name: 'Jean Bart', stype: 9 }), [], null)
  near(jb.multiplier, 1.7695)
  assert.equal(jb.certain, false, '推定值没有把结果标成不确定')
  const dd = at(ship({ stype: 2 }), [], 'X')
  assert.equal(dd.certain, true)
})

test('装备组按资料包给的成员表匹配，不认名字', () => {
  // 第百一号那套：チハ(497,B组) + 歩兵部隊(496,C组) + 特四式内火艇(525,C组)
  const kit = at(ship({ stype: 17 }), [497, 496, 525], 'X')
  near(kit.multiplier, 1.08 * 1.04) // B组 × C组，C组两件只算一次
  assert.equal(kit.applied.length, 2)
})

test('同组不重复：一组里带两件也只乘一次', () => {
  const one = at(ship({ stype: 17 }), [496], 'X')
  const two = at(ship({ stype: 17 }), [496, 525], 'X')
  near(one.multiplier, 1.04)
  near(two.multiplier, 1.04)
})

test('表里没有的舰种不给倍卡——是不匹配，不是给 1 再乘', () => {
  const lha = at(ship({ stype: 17 }), [], 'X') // 揚陸艦不在 E4 舰种列里
  near(lha.multiplier, 1)
  assert.equal(lha.applied.length, 0)
})

test('applied 要能说清「凭什么是这个数」', () => {
  const r = at(ship({ name: 'Mogador', stype: 2, nationality: '法' }), [497], 'X')
  const keys = r.applied.map((e) => `${e.by}:${e.key}`)
  assert.ok(keys.includes('ship:Mogador'))
  assert.ok(keys.includes('stype:驱逐'))
  assert.ok(keys.includes('equipGroup:B组'))
  // 每条都带得出自己的 scope，UI 才能分开列「全图」与「本点」
  assert.ok(r.applied.every((e) => e.scope))
})
