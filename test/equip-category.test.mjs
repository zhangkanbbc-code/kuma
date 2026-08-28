// 装备类别口径的判据测试。
//
// 这个文件 2026-08-23 之前**零测试**：新类别落「其他」是碰巧对，不是被钉住的
//（自扩展体检待裁 5 的附注）。这一改换掉了熟练度列的判据，先把这一层补上。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanso-equip-category-'))
const output = path.join(tempDir, 'equip-category.cjs')
buildSync({
  entryPoints: [fileURLToPath(new URL('../src/renderer/equip-category.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
})
const require = createRequire(import.meta.url)
const category = require(output)

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }))

test('新类别 id 落「其他」，不会整件消失', () => {
  const { isOtherEquipCategory, equipChipMatches } = category
  // 反推式兜底：不在任何具名分组里的都算「其他」，包括主数据里还没出现过的号
  assert.equal(isOtherEquipCategory(999), true)
  assert.equal(isOtherEquipCategory(1), false, '小口径主炮属于「主炮」')
  assert.equal(equipChipMatches('其他', 999), true)
  assert.equal(equipChipMatches('全部', 999), true, '「全部」不设限')
  assert.equal(equipChipMatches('主炮', 999), false)
})

test('陆航例外按大分類逐件裁，不对类别一刀切', () => {
  const { equipChipMatches } = category
  // 2026-08-11 用户抓出的那一例：Ho229 与橘花改同类别（57 噴式戦闘爆撃機），
  // 大分類一个 21（陆上机系）一个 3（舰上机系）
  assert.equal(equipChipMatches('陆航', 57, 21), true, 'Ho229 是陆航')
  assert.equal(equipChipMatches('舰载机', 57, 21), false, 'Ho229 不该同时算舰载机')
  assert.equal(equipChipMatches('舰载机', 57, 3), true, '橘花改是舰载机')
  assert.equal(equipChipMatches('陆航', 57, 3), false)
  // 不传大分類时退回类别名单（深海侧就是这么调的）
  assert.equal(equipChipMatches('舰载机', 57), true)
})

test('熟练度判据从主数据长出来：新航空类别不再被打成「没有熟练度」', () => {
  const { airborneEquipTypesOf, isAirborneEquip, AIRBORNE_EQUIP_TYPE_SEED } = category

  // ---- 判据换成 api_distance（航続距離）的根据，逐条钉住 ----
  // 主数据里非航空装备**整个字段不存在**（→ 0），航空装备才有值。
  const master = {
    20: { type2: 6, distance: 7 }, // 零式艦戦21型
    30: { type2: 13, distance: 0 }, // 21号対空電探（api_type[0] 也是 5，所以大分類不够用）
    54: { type2: 9, distance: 8 }, // 彩雲
    138: { type2: 41, distance: 20 }, // 二式大艇
    999: { type2: 96, distance: 4 }, // 合成：游戏新加的航空系类别
    998: { type2: 97, distance: 0 }, // 合成：新加的**非**航空类别
  }
  const types = airborneEquipTypesOf(master)

  // ① 存在层：新航空类别一实装就自动进集合，不必等谁去改名单
  assert.equal(types.has(96), true, '新航空类别该自己长进来')
  assert.equal(isAirborneEquip(96, types), true)
  // ② 新的非航空类别不会被顺手带进来
  assert.equal(types.has(97), false)
  assert.equal(isAirborneEquip(97, types), false)
  // ③ 電探不算舰载机——它的大分類与水上机同为 5，正是「大分類不够用」的那一格
  assert.equal(isAirborneEquip(13, types), false)
  // ④ 既有的照旧
  for (const type2 of [6, 9, 41]) assert.equal(isAirborneEquip(type2, types), true)

  // ---- 种子只是兜底：主数据没到货时不许塌成空集 ----
  const empty = airborneEquipTypesOf(null)
  for (const type2 of AIRBORNE_EQUIP_TYPE_SEED) {
    assert.equal(empty.has(type2), true, `种子类别 ${type2} 在缺主数据时仍要算舰载机`)
  }
  assert.equal(empty.has(96), false, '缺主数据时不猜新类别')
  // 不传集合时退回种子（渲染热路径里不许逐次扫全表，所以判据得能脱开主数据调）
  assert.equal(isAirborneEquip(6), true)
  assert.equal(isAirborneEquip(13), false)

  // ---- 主数据只会**加**，不会把旧类别减掉：换判据不许引入回归 ----
  const seeded = airborneEquipTypesOf({ 1: { type2: 1, distance: 0 } })
  for (const type2 of AIRBORNE_EQUIP_TYPE_SEED) assert.equal(seeded.has(type2), true)
})
