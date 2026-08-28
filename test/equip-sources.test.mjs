import assert from 'node:assert/strict'
import test from 'node:test'

import sources from '../dist/shared/equip-sources.js'

const { upgradeSourcesOf, initialEquipShips, improvePackCoverageMax, improvePackUncovered } = sources

// equip-upgrades 的真实形状：一行是「这件装备可以改修成什么」，
// convert.id_after 才是更新后的产物。要问的是反方向。
const UPGRADES = [
  { eq_id: 1, improvement: [{ convert: { id_after: 293, lvl_after: 0 } }] },
  {
    eq_id: 3,
    improvement: [
      { convert: { id_after: 122, lvl_after: 0 } },
      { convert: { id_after: 122, lvl_after: 4 } }, // 同源第二条路径，星级更高
      { convert: null }, // 只能改修、不能更新的档
    ],
  },
  { eq_id: 121, improvement: [{ convert: { id_after: 122, lvl_after: 0 } }] },
  { eq_id: 9, improvement: null },
]

test('upgrade sources answer "where does this one come from", not "what does it become"', () => {
  assert.deepEqual(upgradeSourcesOf(UPGRADES, 122), [
    { fromId: 3, levelAfter: 4 }, // 同源多路径取星级最高的那条
    { fromId: 121, levelAfter: 0 },
  ])
  assert.deepEqual(upgradeSourcesOf(UPGRADES, 293), [{ fromId: 1, levelAfter: 0 }])
})

test('equipment nothing upgrades into simply has no upgrade source', () => {
  assert.deepEqual(upgradeSourcesOf(UPGRADES, 999), [])
  assert.deepEqual(upgradeSourcesOf(null, 122), [])
  assert.deepEqual(upgradeSourcesOf(UPGRADES, 0), [])
})

// kcwiki-ships：一条一个形态，同一件装备可能占两个格子
const SHIPS = [
  { ID: 107, 装备: { 初期装备: [25, 41, 41] } },
  { ID: 73, 装备: { 初期装备: [25] } },
  { ID: 5, 装备: { 初期装备: [] } },
  { ID: 0, 装备: { 初期装备: [25] } }, // 坏行：没有 mstId
  { 装备: null },
]

test('initial equipment is looked up by ship, deduped per ship rather than per slot', () => {
  // 107 带了两件 41，只算一艘
  assert.deepEqual(initialEquipShips(SHIPS, 41), [107])
  assert.deepEqual(initialEquipShips(SHIPS, 25), [73, 107])
  assert.deepEqual(initialEquipShips(SHIPS, 999), [])
  assert.deepEqual(initialEquipShips(null, 25), [])
})

test('「不可改修」与「改修表还没收录」是两件事，靠覆盖边界分开', () => {
  // 改修表只列**能改的那些**，不能改的根本不在表里。于是「查不到」有两种来路，
  // 混成一句「不可改修，或暂未收录」等于替官方下了个结论——刚实装的装备最吃亏。
  // 判据照抄装备加成那边用熟的那条（fit-bonus 的 fitPackUncovered）：号段边界。
  const rows = [
    { eq_id: 1, improvement: [{ convert: null }] },
    { eq_id: 575, improvement: [{ convert: null }] },
    { eq_id: 300, improvement: [{ convert: null }] },
  ]
  assert.equal(improvePackCoverageMax(rows), 575)
  // 边界之内查不到 = 上游看过了，它就是不能改
  assert.equal(improvePackUncovered(rows, 300), false)
  assert.equal(improvePackUncovered(rows, 299), false)
  assert.equal(improvePackUncovered(rows, 575), false)
  // 边界之外 = 上游还没收录，这时说「不可改修」就是编
  assert.equal(improvePackUncovered(rows, 576), true)
  assert.equal(improvePackUncovered(rows, 9999), true)
  // 包一条都没有（没装/没拉）时不下任何结论——那是资料没到，不是「号段之外」
  assert.equal(improvePackUncovered(null, 5), true)
  assert.equal(improvePackUncovered([], 5), true)
  assert.equal(improvePackCoverageMax(null), 0)
  assert.equal(improvePackCoverageMax([]), 0)
  // 非法 id 不当成「未收录」：那是调用方的问题，别把它显示成资料缺口
  assert.equal(improvePackUncovered(rows, 0), false)
  assert.equal(improvePackUncovered(rows, -1), false)
  // 边界可以由调用方在装配期算好传进来（渲染路径不许逐次扫全表），结果必须一致
  assert.equal(improvePackUncovered(rows, 576, 575), true)
  assert.equal(improvePackUncovered(rows, 400, 575), false)
  // 坏行不进边界统计
  assert.equal(improvePackCoverageMax([{ eq_id: 'x' }, { eq_id: 12 }, {}, null]), 12)
})
