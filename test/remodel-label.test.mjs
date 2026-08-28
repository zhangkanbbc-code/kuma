import assert from 'node:assert/strict'
import test from 'node:test'

import label from '../dist/shared/remodel-label.js'

const { remodelStageLabel, remodelRootOf } = label

test('the stage label is what is left after stripping the chain root name', () => {
  // 铃谷改的下一档是改二——一律写「改」等于没说
  assert.equal(remodelStageLabel('铃谷', '铃谷改二'), '改二')
  assert.equal(remodelStageLabel('里诺', '里诺改'), '改')
  assert.equal(remodelStageLabel('千岁', '千岁航改二'), '航改二')
  assert.equal(remodelStageLabel('Fletcher', 'Fletcher Mk.II'), 'Mk.II')
})

test('a remodel that renames the ship falls back to the whole name', () => {
  // 響改 → Верный：前缀对不上，后缀无从谈起，写全名反而清楚
  assert.equal(remodelStageLabel('響', 'Верный'), 'Верный')
  // 原型名缺失（本地化只翻了一边）也退回完整名，而不是剥出一截错的
  assert.equal(remodelStageLabel('', '铃谷改二'), '铃谷改二')
  assert.equal(remodelStageLabel(null, '铃谷改二'), '铃谷改二')
  assert.equal(remodelStageLabel('铃谷改二', '铃谷改二'), '铃谷改二')
  assert.equal(remodelStageLabel('铃谷', ''), '')
})

test('the chain root is found by walking afterShipId backwards', () => {
  // 铃谷(1) → 铃谷改(2) → 铃谷改二(3)
  const afterOf = new Map([[1, 2], [2, 3], [3, 0]])
  assert.equal(remodelRootOf(afterOf, 3), 1)
  assert.equal(remodelRootOf(afterOf, 2), 1)
  assert.equal(remodelRootOf(afterOf, 1), 1)
})

test('two forms pointing at each other are a reversible swap, not the direction of the chain', () => {
  // 实测 Fletcher：596 → 692 Fletcher改 → 628 改 Mod.2 ⇄ 629 Mk.II。
  // 629 会先被登记成 628 的前驱，于是 628 一路回溯到 629，
  // 自己成了自己的原型，后缀怎么也剥不出来（界面上就显示成完整舰名）。
  const afterOf = new Map([[596, 692], [692, 628], [628, 629], [629, 628]])
  assert.equal(remodelRootOf(afterOf, 628), 596)
  assert.equal(remodelRootOf(afterOf, 692), 596)
  // 可逆对的两半共享同一个原型，但上游只挂在其中一半上——
  // 自己走不动要跳到对面接着回溯，否则它会把自己当原型，后缀剥不出来。
  // 实测矢矧就是这样：139 矢矧 → 307 改 → 663 改二 ⇄ 668 改二乙，
  // 站在改二乙上时下一改装写成了完整的「矢矧改二」。
  assert.equal(remodelRootOf(afterOf, 629), 596)
  const yahagi = new Map([[139, 307], [307, 663], [663, 668], [668, 663]])
  assert.equal(remodelRootOf(yahagi, 668), 139)
  assert.equal(remodelRootOf(yahagi, 663), 139)
})

test('a longer reversible loop terminates instead of spinning', () => {
  const afterOf = new Map([[10, 11], [11, 12], [12, 10]])
  const root = remodelRootOf(afterOf, 12)
  assert.ok([10, 11, 12].includes(root), '成环时也要停下来并给出链上的某个点')
  assert.equal(remodelRootOf(new Map(), 7), 7) // 没有链就是它自己
})
