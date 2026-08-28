import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const catalog = fs.readFileSync(new URL('../src/renderer/modules/ji.ts', import.meta.url), 'utf8')

// 舰娘卷目录要为每个根、每个舰种分组、每个舰级各数一遍「有几艘在籍」，
// 而改造链上每个形态都算一次。这些查询一旦是全表扫，量级立刻到百万——
// 实测 331 根 × 136 舰级 × 500 在籍时，光这三轮统计就要 26ms，
// 而装备/深海/海域卷没有「改造链」这层嵌套，所以只有舰娘卷卡。

test('roster lookups are indexed instead of scanning the whole fleet each time', () => {
  const body = catalog.slice(catalog.indexOf('// 在籍统计'), catalog.indexOf('// ---- 模块状态 ----'))
  // 曾经的写法：每次调用都 Object.values(mg.ships).filter，既 O(在籍数) 又每次新建整表数组
  assert.doesNotMatch(body, /const instancesOfMst = \(mstId: number\) => Object\.values\(mg\.ships\)\.filter/)
  assert.doesNotMatch(body, /const equipInstancesOf = \(mstId: number\) =>\s*\n\s*Object\.entries\(mg\.slotitems\)\.filter/)
  assert.match(body, /instanceIndex\(\)\.get\(mstId\) \?\? \[\]/)
  assert.match(body, /equipInstanceIndex\(\)\.get\(mstId\) \?\? \[\]/)
  // 索引按数据源引用失效——store 每次下发都换新对象
  assert.match(body, /if \(instanceIndexSource !== mg\.ships\)/)
  assert.match(body, /if \(equipIndexSource !== mg\.slotitems\)/)
})

test('sister-ship lookups are grouped once per master update, not per class', () => {
  const body = catalog.slice(catalog.indexOf('const rootsOfClass'), catalog.indexOf('const rootsOfNationality'))
  // 曾经：每个舰级都把全部根形态 map + filter + sort 一遍，136 个舰级就是 136 趟全表
  assert.doesNotMatch(body, /\[\.\.\.chainOf\.keys\(\)\]\s*\n\s*\.map/)
  assert.match(body, /if \(classIndexSource !== chainOf\)/)
  assert.match(body, /rootsByCtype\.get\(ctype\) \?\? \[\]/)
})

test('indexed lookups are documented as read-only', () => {
  // 索引内部的数组直接返回，调用方排序/增删会污染下一次查询
  assert.match(catalog, /返回的数组是索引内部持有的，调用方只读/)
  assert.match(catalog, /返回值只读/)
})
