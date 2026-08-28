import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import nameOrder from '../dist/shared/name-order.js'

const { compareDisplayNames } = nameOrder

const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')

// 2026-08-21 用户拍板：「按舰名」「按名称」一律按屏幕上显示的中文名走拼音序。
// 用例是行为级的——断言的是几个已知名字的相对次序，而不是源码里写没写某个 locale。
test('按名称排序 = 显示中文名的拼音序', () => {
  const names = ['秋津洲', '鹿岛', '朝潮', '纳尔逊', '黎塞留', '科罗拉多']
  assert.deepEqual(
    [...names].sort(compareDisplayNames),
    // C 朝潮 → K 科罗拉多 → L 黎塞留 → L 鹿岛 → N 纳尔逊 → Q 秋津洲
    ['朝潮', '科罗拉多', '黎塞留', '鹿岛', '纳尔逊', '秋津洲'],
  )
})

test('拼音序既不是码位序也不是日文假名序', () => {
  // 鹿(U+9E7F) 的码位远高于 纳(U+7EB3)：按码位排 纳尔逊 会跑到 鹿岛 前面，
  // 而拼音 lu < na。这一条能一眼认出比较器有没有退回裸 sort()。
  assert.ok('鹿岛' > '纳尔逊', '前提：码位序里 鹿岛 在后')
  assert.ok(compareDisplayNames('鹿岛', '纳尔逊') < 0)

  // 从前排的是日文原名的假名序（localeCompare(…, 'ja')）——同一批名字给出的是另一套次序。
  const names = ['秋津洲', '鹿岛', '朝潮', '纳尔逊', '黎塞留', '科罗拉多']
  assert.notDeepEqual(
    [...names].sort(compareDisplayNames),
    [...names].sort((a, b) => a.localeCompare(b, 'ja')),
  )
})

test('没有中文译名、界面回退日文原名的舰混进来也不抛错，且次序稳定', () => {
  // 回退串（秋雲/朝雲 是日文原名）就按它显示的那串参与排序，不去偷看别的字段。
  const mixed = ['鹿岛', '秋雲', '', '朝潮', '朝雲', null, undefined, 'Верный']
  const once = [...mixed].sort(compareDisplayNames)
  const twice = [...once].sort(compareDisplayNames)
  assert.deepEqual(twice, once, '同一批输入排两遍必须得到同一个次序')
  assert.equal(once.length, mixed.length, '空名/缺名不许被吞掉')
})

test('「按名称」排序不再钉日文原名的假名序', () => {
  // 行为级用例挡不住「改回 'ja' 但换个地方写」，这里再补一道源码网：
  // 两个用户可见的名称排序都必须走 shared/name-order 的单一收口。
  for (const file of ['../src/renderer/modules/qa.ts', '../src/renderer/modules/equip-stock.ts']) {
    const text = read(file)
    assert.ok(text.includes('compareDisplayNames'), `${file} 没走名称排序的单一收口`)
    assert.ok(
      !/localeCompare\([^)]*'ja'/.test(text),
      `${file} 还在按日文原名的假名序排——中文界面里那是乱序`,
    )
  }
})
