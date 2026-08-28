// 舰级真名。
//
// 原来的级名是「该 ctype 里图鉴编号最小的那艘 + 级」，被 api_sortno 的历史怪癖坑了：
// 雪風 sortno=5 而 陽炎=91，阳炎型就显示成「雪风级」。本文件钉两件事：
//   ① 挑名字的四条判据（成级名优先 / 非改造前缀优先 / 票多优先 / 短的优先）；
//   ② 真包层——拿随包 kcwiki-ships × 本机主数据跑全量，逐个断言点名的那几个舰级。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadStart2MasterArray } from '../scripts/lib/start2.mjs'
import {
  buildShipClassNameIndex,
  normalizeShipClassName,
  supplementShipClassNames,
} from '../src/shared/ship-class-name.ts'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')

// ---- ① 判据 ----

test('后缀归一：kcwiki 写「型」，chip 的口径是「级」；不带这两个后缀的原样留着', () => {
  assert.equal(normalizeShipClassName('陽炎型'), '陽炎级')
  assert.equal(normalizeShipClassName('莫加多尔級'), '莫加多尔级')
  assert.equal(normalizeShipClassName('弗莱彻级'), '弗莱彻级')
  assert.equal(normalizeShipClassName('600吨冷藏船'), '600吨冷藏船')
  assert.equal(normalizeShipClassName('  松型  '), '松级')
  assert.equal(normalizeShipClassName(''), '')
})

test('挑名字：成级名的优先，压过带舷号的细分写法', () => {
  const index = buildShipClassNameIndex(
    [
      { ID: 1, 级别: ['猫鲨级 SS-238'] },
      { ID: 2, 级别: ['猫鲨级 SS-247'] },
      { ID: 3, 级别: ['猫鲨级 SS-247'] },
      { ID: 4, 级别: ['猫鲨型'] },
    ],
    () => 114,
  )
  // 票数是 3:2:1，但只有「猫鲨级」是个成形的级名
  assert.equal(index.get(114), '猫鲨级')
})

test('挑名字：「改／改装／重近代化改装」前缀的是改造形态的级名，不是本级', () => {
  const index = buildShipClassNameIndex(
    [
      { ID: 1, 级别: ['改最上型'] },
      { ID: 2, 级别: ['改最上型'] },
      { ID: 3, 级别: ['改最上型'] },
      { ID: 4, 级别: ['最上型'] },
    ],
    () => 9,
  )
  assert.equal(index.get(9), '最上级', '票多的是改造级名也不许它胜出')
})

test('挑名字：同档时票多的优先，再同就取短的', () => {
  const byCount = buildShipClassNameIndex(
    [
      { ID: 1, 级别: ['甲级'] },
      { ID: 2, 级别: ['乙级'] },
      { ID: 3, 级别: ['乙级'] },
    ],
    () => 1,
  )
  assert.equal(byCount.get(1), '乙级')
  const byLength = buildShipClassNameIndex(
    [
      { ID: 1, 级别: ['伊丽莎白女王级'] },
      { ID: 2, 级别: ['女王级'] },
    ],
    () => 1,
  )
  assert.equal(byLength.get(1), '女王级')
})

test('「?型」是上游还没填的占位，不投票；一票都没有的 ctype 如实缺席（调用方回退）', () => {
  const index = buildShipClassNameIndex(
    [
      { ID: 1, 级别: ['?型'] },
      { ID: 2, 级别: ['？型'] },
      { ID: 3, 级别: ['春日丸型'] },
      { ID: 4, 级别: [''] },
      { ID: 5 },
    ],
    () => 75,
  )
  assert.equal(index.get(75), '春日丸级')
  assert.equal(index.get(999), undefined, '查不到就是查不到，不硬造名字')
})

test('主数据里查不到 ctype 的行整条跳过，不落进 0 号桶', () => {
  const index = buildShipClassNameIndex([{ ID: 9999, 级别: ['幽灵型'] }], () => 0)
  assert.equal(index.size, 0)
})

// ---- ② 真包层 ----

const masterShips = loadStart2MasterArray('api_mst_ship', root)
const kcwikiFile = path.join(root, 'assets', 'lodes', 'kcwiki-ships.json')
const realSkip = !masterShips.length
  ? '缺 api_start2 主数据快照'
  : !fs.existsSync(kcwikiFile)
    ? '缺 assets/lodes/kcwiki-ships.json'
    : false

test('真包：图鉴编号顶掉真首舰的那几个舰级，逐个正过来', { skip: realSkip }, () => {
  const rows = Object.values(JSON.parse(fs.readFileSync(kcwikiFile, 'utf8')).data)
  const ctypeOf = new Map(
    masterShips
      .filter((ship) => ship.api_name && Number(ship.api_id) < 1500)
      .map((ship) => [Number(ship.api_id), Number(ship.api_ctype) || 0]),
  )
  const index = buildShipClassNameIndex(rows, (mstId) => ctypeOf.get(mstId) ?? 0)

  // 左边是这一改点名核对的四个 + 用户另外要求核的两个，右边是 kcwiki 的真名
  const want = {
    30: '阳炎级', // 旧：雪风级（雪風 sortno=5、陽炎=91）
    91: '弗莱彻级', // 旧：约翰斯顿级（Johnston sortno 362 < Fletcher 的）
    87: '约翰·C·巴特勒级', // 旧：塞缪尔·B·罗伯茨级
    61: '西北风级', // 旧：西南风级（Libeccio 顶了 Maestrale）
    82: 'J级', // 旧：杰维斯级
    48: 'Z1级', // 本来就对，钉住别被改坏
  }
  for (const [ctype, name] of Object.entries(want)) {
    assert.equal(index.get(Number(ctype)), name, `ctype ${ctype} 的舰级名不对`)
  }
  // 反向：这几个绝不能再叫旧名
  for (const [ctype, wrong] of Object.entries({
    30: '雪风级',
    91: '约翰斯顿级',
    87: '塞缪尔·B·罗伯茨级',
    61: '西南风级',
  })) {
    assert.notEqual(index.get(Number(ctype)), wrong, `ctype ${ctype} 又退回旧启发式的名字了`)
  }
})

test('真包：索引覆盖绝大多数舰级，剩下的由调用方退回启发式', { skip: realSkip }, () => {
  const rows = Object.values(JSON.parse(fs.readFileSync(kcwikiFile, 'utf8')).data)
  const friendly = masterShips.filter((ship) => ship.api_name && Number(ship.api_id) < 1500)
  const ctypeOf = new Map(friendly.map((ship) => [Number(ship.api_id), Number(ship.api_ctype) || 0]))
  const index = buildShipClassNameIndex(rows, (mstId) => ctypeOf.get(mstId) ?? 0)
  const allCtypes = new Set(
    friendly.filter((ship) => Number(ship.api_sortno) > 0).map((ship) => Number(ship.api_ctype)),
  )
  allCtypes.delete(0)
  const missing = [...allCtypes].filter((ctype) => !index.get(ctype))
  // 覆盖率会随上游更新浮动，钉一个宽松下限即可——这条护栏防的是「索引整个空掉」
  assert.ok(
    index.size >= 100,
    `索引只建出 ${index.size} 条，太少了——多半是字段名或数据形状变了`,
  )
  assert.ok(
    missing.length <= 5,
    `有 ${missing.length} 个舰级取不到真名（${missing.join(', ')}），超出预期`,
  )
  // 每个名字都得是成形的级名。
  // **不能**顺手断言「没有「改」开头的」：改風早型（ctype 60，速吸那一级）、改氷川丸型、
  // 改敷島型 本来就叫这个名字，「改」是舰级名的一部分而不是改造形态的标记。
  // 「改」只是**同分时的降权项**——同一个 ctype 上「最上型」与「改最上型」并存时后者不该胜出，
  // 那一条由上面的纯函数用例钉着。
  for (const [ctype, name] of index) {
    assert.ok(name.endsWith('级'), `ctype ${ctype} 的「${name}」不是个级名`)
  }
  // 降权项的真包证据：这几个 ctype 上「改◯◯型」与「◯◯型」都有票，赢的必须是后者
  for (const [ctype, name] of Object.entries({ 9: '最上级', 30: '阳炎级', 23: '白露级', 6: '金刚级' })) {
    assert.equal(index.get(Number(ctype)), name)
  }
})

// ---- ③ 自补层（2026-08-23 用户拍板「舰级启发式只填空」）----

test('自补层补缺不覆盖：kcwiki 已经给出的一个字都不动', () => {
  const ctypeOf = new Map([
    [100, 7], // kcwiki 覆盖到的 ctype
    [734, 110], // kcwiki 没覆盖到的 ctype（Phoenix改 / Brooklyn 级）
  ])
  const index = buildShipClassNameIndex([{ ID: 100, 级别: ['最上型'] }], (mstId) =>
    ctypeOf.get(mstId) ?? 0,
  )
  assert.equal(index.get(7), '最上级')
  assert.equal(index.get(110), undefined, '这一格本来是空的，正是启发式会去填的那一格')

  supplementShipClassNames(
    index,
    [
      { shipId: 734, shipClass: ['Brooklyn級', 5] },
      // 同一个 ctype 上自补层与主层各说各的：**主层赢**，自补层一个字都不许改
      { shipId: 100, shipClass: ['別の型', 1] },
    ],
    (mstId) => ctypeOf.get(mstId) ?? 0,
  )
  assert.equal(index.get(110), 'Brooklyn级', '空白格该由自补层填上，而不是留给启发式')
  assert.equal(index.get(7), '最上级', '主层已给出的名字被自补层顶掉了')
})

test('自补层照主层同一套四条判据挑名，占位写法不投票', () => {
  const ctypeOf = () => 42
  const index = supplementShipClassNames(
    new Map(),
    [
      { shipId: 1, shipClass: ['猫鲨级 SS-238'] },
      { shipId: 2, shipClass: ['ガトー級'] }, // 成级名的优先
      { shipId: 3, shipClass: ['?型'] }, // 上游还没填的占位，不投票
      { shipId: 4, shipClass: null },
      null,
    ],
    ctypeOf,
  )
  assert.equal(index.get(42), 'ガトー级')

  // 全是占位/空值时**不落一格**：留白让调用方退回启发式，不硬造名字
  assert.equal(
    supplementShipClassNames(new Map(), [{ shipId: 1, shipClass: ['？型'] }], ctypeOf).size,
    0,
  )
  // 认不出 ctype 的行整条跳过
  assert.equal(
    supplementShipClassNames(new Map(), [{ shipId: 1, shipClass: ['甲型'] }], () => 0).size,
    0,
  )
})

test('真包：自补层只往空白格里填，索引里既有的真名一个不动', { skip: realSkip }, () => {
  const profileFile = path.join(root, 'assets', 'lodes', 'wikiwiki-ship-profile.json')
  if (!fs.existsSync(profileFile)) return // 这个包不随仓库分发（许可未声明），缺了就跳过
  const rows = Object.values(JSON.parse(fs.readFileSync(kcwikiFile, 'utf8')).data)
  const friendly = masterShips.filter((ship) => ship.api_name && Number(ship.api_id) < 1500)
  const ctypeMap = new Map(friendly.map((ship) => [Number(ship.api_id), Number(ship.api_ctype) || 0]))
  const ctypeOf = (mstId) => ctypeMap.get(mstId) ?? 0
  const base = buildShipClassNameIndex(rows, ctypeOf)
  const before = new Map(base)
  const profiles = Object.values(JSON.parse(fs.readFileSync(profileFile, 'utf8')).data)
  supplementShipClassNames(base, profiles, ctypeOf)
  for (const [ctype, name] of before) {
    assert.equal(base.get(ctype), name, `ctype ${ctype} 的真名被自补层改动了`)
  }
  assert.ok(base.size >= before.size, '自补层只会加格，不会减格')
  for (const [ctype, name] of base) {
    assert.ok(name, `ctype ${ctype} 落了个空名字`)
  }
})
