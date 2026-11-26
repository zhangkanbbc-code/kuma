// 动画复盘的阵型布局（shared/battle-anim-formation）：任何阵型、任何舰数，兵牌都不重叠、不出框，
// 我方朝右（旗舰在前、靠中线）、敌方左右翻转。
import assert from 'node:assert/strict'
import test from 'node:test'

import formation from '../dist/shared/battle-anim-formation.js'

const { formationPoints, fitFormation } = formation

const overlaps = (a, b, w, h) => Math.abs(a.cx - b.cx) < w - 0.5 && Math.abs(a.cy - b.cy) < h - 0.5
const range = (n, from = 0) => Array.from({ length: n }, (_, i) => from + i)

const check = (form, indices, box) => {
  for (const side of [0, 1]) {
    const fitted = fitFormation(formationPoints(form, indices), side, box)
    assert.equal(fitted.tokens.length, indices.length)
    for (let i = 0; i < fitted.tokens.length; i += 1) {
      const t = fitted.tokens[i]
      assert.ok(t.cx - fitted.width / 2 >= box.left - 0.5 && t.cx + fitted.width / 2 <= box.left + box.width + 0.5, `阵型 ${form} 舰位 ${t.index} 横向出框`)
      assert.ok(t.cy - fitted.height / 2 >= box.top - 0.5 && t.cy + fitted.height / 2 <= box.top + box.height + 0.5, `阵型 ${form} 舰位 ${t.index} 纵向出框`)
      for (let j = i + 1; j < fitted.tokens.length; j += 1) {
        assert.ok(!overlaps(t, fitted.tokens[j], fitted.width, fitted.height), `阵型 ${form}（${indices.length} 舰）舰位 ${t.index} 与 ${fitted.tokens[j].index} 重叠`)
      }
    }
  }
}

const BOX = { left: 0, top: 0, width: 520, height: 520 }

test('六种单队阵型，1～7 舰都不重叠、不出框', () => {
  for (const form of [1, 2, 3, 4, 5, 6]) {
    for (let n = 1; n <= 7; n += 1) check(form, range(n), BOX)
  }
})

test('联合舰队四种航行序列，12 舰都不重叠、不出框；窄舞台也守得住', () => {
  for (const form of [11, 12, 13, 14]) {
    check(form, [...range(6), ...range(6, 6)], BOX)
    check(form, [...range(6), ...range(6, 6)], { left: 10, top: 40, width: 360, height: 420 })
  }
})

test('前进方向朝上：单纵旗舰在最上、竖成一列；梯形敌我斜向相反', () => {
  const ours = fitFormation(formationPoints(1, range(6)), 0, BOX)
  const flag = ours.tokens.find((t) => t.index === 0)
  assert.equal(flag.cy, Math.min(...ours.tokens.map((t) => t.cy)))
  assert.equal(new Set(ours.tokens.map((t) => t.cx)).size, 1, '单纵是竖着一列')
  const slope = (fitted) => {
    const a = fitted.tokens.find((t) => t.index === 0)
    const b = fitted.tokens.find((t) => t.index === 5)
    return Math.sign(b.cx - a.cx)
  }
  assert.equal(slope(fitFormation(formationPoints(4, range(6)), 0, BOX)), -slope(fitFormation(formationPoints(4, range(6)), 1, BOX)))
  // 单纵用满竖向空间，兵牌不该缩到下限
  assert.ok(ours.width > 72)
})

test('形状认得出：单纵是一行、单横是一列、轮形旗舰居中', () => {
  const column = formationPoints(1, range(6))
  assert.ok(column.every((p) => p.y === 0))
  const abreast = formationPoints(5, range(6))
  assert.ok(abreast.every((p) => p.x === 0))
  const ring = formationPoints(3, range(6))
  assert.deepEqual([ring[0].x, ring[0].y], [0, 0])
  // 长队的兵牌比紧凑阵型小
  const longest = fitFormation(column, 0, BOX)
  const compact = fitFormation(ring, 0, BOX)
  assert.ok(longest.width <= compact.width)
})

test('未知阵型号退回单纵，不抛', () => {
  assert.deepEqual(formationPoints(99, range(3)).map((p) => p.y), [0, 0, 0])
})

test('给了尺寸上限就不超过它，照样不重叠（敌我统一尺寸时用）', () => {
  const big = fitFormation(formationPoints(1, range(6)), 0, BOX)
  const capped = fitFormation(formationPoints(1, range(6)), 0, BOX, 60)
  assert.ok(big.width > 60)
  assert.ok(capped.width <= 60)
  for (let i = 0; i < capped.tokens.length; i += 1) {
    for (let j = i + 1; j < capped.tokens.length; j += 1) assert.ok(!overlaps(capped.tokens[i], capped.tokens[j], capped.width, capped.height))
  }
})
