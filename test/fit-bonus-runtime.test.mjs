// 装备加成的**运行时**两层：预期层（查表求值）与实测层（面板反推），外加第一方修正台账。
//
// 第一批（数据工程）的护栏在 test/fit-bonus.test.mjs：那边管「包解析得对不对」。
// 这边管「拿到包之后算得对不对」，以及退役的 akashi 运行时路径有没有死引用留在仓库里。
//
// 分三层：
//   ① 纯函数层——自造 fixture，不依赖任何包，永远能跑；
//   ② 真包层——有 assets/lodes/kcwiki-fit-bonus.json 时才跑（修正台账要对着真数核）；
//   ③ 退货层——源码级穷举，确认 akashi 运行时那一整层真的没了。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  expectedFitBonus,
  fitEquipsForShip,
  fitPackCoverageMax,
  fitPackUncovered,
  fitRuleLevel,
  fitStatsText,
  fitTrackRows,
  observedFitBonus,
  FIT_PANEL_GROWTH_KEYS,
  FIT_PANEL_KEYS,
} from '../src/shared/fit-bonus.ts'
import {
  applyFitBonusCorrections,
  fitRuleFingerprint,
  FIT_BONUS_CORRECTIONS,
} from '../src/shared/fit-bonus-corrections.ts'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')

/** 最小可用的包：只放这个用例要的那几条规则。 */
const pack = (equips) => ({ schemaVersion: 1, equipGroups: {}, equips, unresolved: [] })
const one = (id, rules) => ({ [`${id}`]: { id, nameJa: `#${id}`, nameZh: `#${id}`, rules } })
const ship = (formId, ctype = 10, stype = 2, nationality = 0) => ({
  formId,
  ctype,
  stype,
  nationality,
})

// ---- ① 面板反推（实测层）----

test('面板反推：把加成塞进面板再解回来，逐项还原', () => {
  // 造一艘：基础 火力10/雷装12/对空8/装甲9，近代化改修 +5/+4/+3/+2，
  // 两件装备原始值合计 火力16/雷装20/对空6/装甲0，再加上「加成」火力+3 对空+2。
  const base = { fire: 10, torpedo: 12, aa: 8, armor: 9 }
  const kyouka = [5, 4, 3, 2, 0]
  const equips = [
    { fire: 10, torpedo: 0, aa: 4, armor: 0, star: 0 },
    { fire: 6, torpedo: 20, aa: 2, armor: 0, star: 0 },
  ]
  const bonus = { fire: 3, torpedo: 0, aa: 2, armor: 0 }
  const panel = {
    fire: base.fire + kyouka[0] + 16 + bonus.fire,
    torpedo: base.torpedo + kyouka[1] + 20 + bonus.torpedo,
    aa: base.aa + kyouka[2] + 6 + bonus.aa,
    armor: base.armor + kyouka[3] + 0 + bonus.armor,
  }
  const observed = observedFitBonus({ panel, base, kyouka, equips })
  assert.deepEqual(
    observed.rows.map((row) => [row.key, row.observed]),
    [
      ['fire', 3],
      ['torpedo', 0],
      ['aa', 2],
      ['armor', 0],
    ],
  )
  assert.equal(observed.any, true)
  assert.equal(observed.pure, true, '装备全 ★0 时差值就是纯装备加成')
  assert.deepEqual(observed.stats, { fire: 3, aa: 2 })
})

test('面板反推：没有加成时四项全 0，any 为假；带改修的装备把 pure 摘掉', () => {
  const base = { fire: 10, torpedo: 0, aa: 5, armor: 5 }
  const flat = { panel: { fire: 20, torpedo: 0, aa: 5, armor: 5 }, base, kyouka: [0, 0, 0, 0] }
  const none = observedFitBonus({ ...flat, equips: [{ fire: 10, torpedo: 0, aa: 0, armor: 0 }] })
  assert.equal(none.any, false)
  assert.deepEqual(none.stats, {})
  const starred = observedFitBonus({
    ...flat,
    equips: [{ fire: 10, torpedo: 0, aa: 0, armor: 0, star: 6 }],
  })
  assert.equal(starred.pure, false, '带改修★时差值里混着改修加成，不许再叫「纯装备加成」')
})

test('面板反推出七项：回避/对潜/索敌 2026-08-22 起进可比项', () => {
  assert.deepEqual(
    [...FIT_PANEL_KEYS],
    ['fire', 'torpedo', 'aa', 'armor', 'evasion', 'asw', 'los'],
  )
  // 命中与射程仍在外：命中不进面板（529 判例），射程是档不是值
  assert.equal(FIT_PANEL_KEYS.includes('accuracy'), false)
  assert.equal(FIT_PANEL_KEYS.includes('range'), false)
  assert.deepEqual([...FIT_PANEL_GROWTH_KEYS], ['evasion', 'asw', 'los'])
})

test('七项反推：三项的裸值走插值，对潜还要减近代化改修 kyouka[6]', () => {
  // 一艘 Lv50 的舰：三项端点 回避[20,80] 对潜[10,60] 索敌[5,45]
  const lv = 50
  const grow = (init, max) => init + Math.floor(((max - init) * lv) / 99)
  const base = {
    fire: 10,
    torpedo: 12,
    aa: 8,
    armor: 9,
    evasion: grow(20, 80),
    asw: grow(10, 60),
    los: grow(5, 45),
  }
  // api_kyouka = [火,雷,空,甲,运,耐,潜]：只有下标 6 的对潜会加进面板
  const kyouka = [0, 0, 0, 0, 0, 0, 4]
  const equips = [{ evasion: 2, asw: 7, los: 3, star: 0 }]
  const bonus = { evasion: 3, asw: 0, los: 1 }
  const panel = {
    fire: base.fire,
    torpedo: base.torpedo,
    aa: base.aa,
    armor: base.armor,
    evasion: base.evasion + 2 + bonus.evasion,
    asw: base.asw + kyouka[6] + 7 + bonus.asw,
    los: base.los + 3 + bonus.los,
  }
  const observed = observedFitBonus({
    panel,
    base,
    kyouka,
    equips,
    gate: { evasion: 'pass', asw: 'pass', los: 'pass' },
  })
  assert.deepEqual(observed.stats, { evasion: 3, los: 1 }, '对潜的改修被扣掉后残差为 0')
  assert.deepEqual(observed.skipped, [])
  assert.deepEqual(observed.unverified, [])
})

test('闸门禁用的项不出行，如实落进 skipped——不摆一个算不准的数', () => {
  const input = {
    panel: { fire: 10, torpedo: 0, aa: 0, armor: 0, evasion: 99, asw: 0, los: 0 },
    base: { fire: 10, torpedo: 0, aa: 0, armor: 0, evasion: null, asw: null, los: 30 },
    kyouka: [0, 0, 0, 0, 0, 0, 0],
    equips: [],
    gate: { evasion: 'fail', asw: 'noEndpoint', los: 'unverified' },
  }
  const observed = observedFitBonus(input)
  assert.deepEqual(
    observed.rows.map((row) => row.key),
    ['fire', 'torpedo', 'aa', 'armor', 'los'],
    '端点缺/闸门失败的两项整行不出',
  )
  assert.deepEqual(
    observed.skipped.map((one) => [one.key, one.gate]),
    [
      ['evasion', 'fail'],
      ['asw', 'noEndpoint'],
    ],
    '不出的项要说得出为什么，不能凭空消失',
  )
  assert.deepEqual(observed.unverified, ['los'], '出了行但没标定过的项要单独标出来')
  // 双轨也只对真出了行的项出行——摆一列空的等于假装比过了
  assert.deepEqual(
    fitTrackRows({ fire: 0 }, observed).map((row) => row.key),
    ['fire', 'torpedo', 'aa', 'armor', 'los'],
  )
})

// ---- ② 预期层：适用集合 ----

test('适用集合：形态 > 舰级 > 舰种 > 全部，排除集合一票否决', () => {
  const rule = {
    row: 1,
    who: { forms: [100], classes: [30], types: [2], all: true },
    gain: { kind: 'flat', flat: { fire: 1 } },
    stack: 'perEquip',
  }
  assert.equal(fitRuleLevel(rule, ship(100, 30, 2)), 3, '命中形态时按形态算层级')
  assert.equal(fitRuleLevel(rule, ship(999, 30, 2)), 2)
  assert.equal(fitRuleLevel(rule, ship(999, 99, 2)), 1)
  assert.equal(fitRuleLevel(rule, ship(999, 99, 9)), 0)
  const excluded = { ...rule, not: { forms: [100] } }
  assert.equal(fitRuleLevel(excluded, ship(100, 30, 2)), -1, 'not 命中就整条不适用')
})

test('预期层：最具体的一层胜出，舰级行不再叠在形态行上', () => {
  // 依据不是语感——scripts/fit-bonus-reconcile.mjs 在 9490 格上量过两种读法
  const data = pack(
    one(1, [
      { row: 1, who: { classes: [30] }, gain: { kind: 'flat', flat: { fire: 2 } }, stack: 'perEquip' },
      { row: 2, who: { forms: [100] }, gain: { kind: 'flat', flat: { fire: 5 } }, stack: 'perEquip' },
    ]),
  )
  assert.deepEqual(
    expectedFitBonus(data, ship(100, 30), [{ mstId: 1, star: 0 }]).stats,
    { fire: 5 },
    '有形态行就不再加舰级行',
  )
  assert.deepEqual(
    expectedFitBonus(data, ship(101, 30), [{ mstId: 1, star: 0 }]).stats,
    { fire: 2 },
    '没有形态行才退到舰级行',
  )
})

test('适用集合：国籍是「且」的过滤器，不是第五个并列维度', () => {
  // 上游的国籍类目从来是「国籍 × 舰种」的交（「日駆逐」「イギリス空母」）。
  // 写成并列维度会把「日駆逐」读成「日本舰**或**驱逐舰」——那是另一批舰。
  const jpDd = {
    row: 1,
    who: { nations: [1], types: [2] },
    gain: { kind: 'flat', flat: { fire: 1 } },
    stack: 'perEquip',
  }
  assert.equal(fitRuleLevel(jpDd, ship(999, 99, 2, 1)), 1, '日本籍驱逐：命中，层级按舰种算')
  assert.equal(fitRuleLevel(jpDd, ship(999, 99, 2, 4)), -1, '美国籍驱逐：国籍对不上就整条不适用')
  assert.equal(fitRuleLevel(jpDd, ship(999, 99, 3, 1)), -1, '日本籍轻巡：舰种对不上')
  assert.equal(fitRuleLevel(jpDd, ship(999, 99, 2)), -1, '国籍判不出（0）时一律不命中，不给说不出来路的数')

  // 只写国籍不写其余几维 = 该国籍全部舰船，落在「全部」这一层
  const british = {
    row: 1,
    who: { nations: [5] },
    gain: { kind: 'flat', flat: { fire: 1 } },
    stack: 'perEquip',
  }
  assert.equal(fitRuleLevel(british, ship(999, 99, 11, 5)), 0)
  assert.equal(fitRuleLevel(british, ship(999, 99, 11, 1)), -1)

  // not 里的国籍同样是「且」：用它表达「除掉美英两家」
  const others = {
    row: 1,
    who: { types: [11] },
    gain: { kind: 'flat', flat: { fire: 1 } },
    stack: 'perEquip',
    not: { nations: [4, 5] },
  }
  assert.equal(fitRuleLevel(others, ship(999, 99, 11, 1)), 1)
  assert.equal(fitRuleLevel(others, ship(999, 99, 11, 4)), -1)
  assert.equal(fitRuleLevel(others, ship(999, 99, 11, 5)), -1)
})

test('预期层：分层按 layer 各算各的下限，并列两张表不许互相压制', () => {
  // 现例 577 号：页面明写「※単体ボーナス＝単体ボーナス1＋単体ボーナス2」。
  // 共用一个下限时，単体ボーナス1 的舰种行会被単体ボーナス2 的形态行顶掉。
  const rules = [
    {
      row: 1,
      who: { nations: [1], types: [2] },
      gain: { kind: 'flat', flat: { torpedo: 1 } },
      stack: 'once',
    },
    {
      row: 2,
      layer: '単体ボーナス2',
      who: { forms: [100] },
      gain: { kind: 'flat', flat: { fire: 3 } },
      stack: 'once',
    },
  ]
  const jpDd = ship(100, 30, 2, 1)
  assert.deepEqual(
    expectedFitBonus(pack(one(1, rules)), jpDd, [{ mstId: 1, star: 0 }]).stats,
    { fire: 3, torpedo: 1 },
    '两张表是相加的，舰种行不该被形态行压掉',
  )
  // 反向：同一张表里，形态行照旧把舰种行顶掉
  const sameLayer = rules.map((rule) => ({ ...rule, layer: undefined }))
  assert.deepEqual(
    expectedFitBonus(pack(one(1, sameLayer)), jpDd, [{ mstId: 1, star: 0 }]).stats,
    { fire: 3 },
    '同一张表里最具体的一层仍旧胜出',
  )
})

test('预期层：带改修门槛的行是逐档追加，不进分层', () => {
  // 现例 136 号プリエーゼ式水中防御隔壁：同一个 who 上 ★3/★6/★10 各 +1 装甲
  const data = pack(
    one(1, [
      { row: 1, who: { classes: [58] }, gain: { kind: 'flat', flat: { armor: 1 } }, stack: 'perEquip' },
      { row: 2, who: { classes: [58] }, gain: { kind: 'flat', flat: { armor: 1 } }, stack: 'perEquip', need: { star: 3 } },
      { row: 3, who: { classes: [58] }, gain: { kind: 'flat', flat: { armor: 1 } }, stack: 'perEquip', need: { star: 6 } },
      { row: 4, who: { classes: [58] }, gain: { kind: 'flat', flat: { armor: 1 } }, stack: 'perEquip', need: { star: 10 } },
    ]),
  )
  const at = (star) => expectedFitBonus(data, ship(1, 58), [{ mstId: 1, star }]).stats.armor ?? 0
  assert.equal(at(0), 1)
  assert.equal(at(3), 2)
  assert.equal(at(6), 3)
  assert.equal(at(9), 3)
  assert.equal(at(10), 4)
})

// ---- ③ 预期层：分档与叠加 ----

test('分档写的是该档的总值，不是在前一档上再加', () => {
  const data = pack(
    one(1, [
      {
        row: 1,
        who: { all: true },
        gain: {
          kind: 'byStar',
          steps: [
            { from: 4, to: null, stats: { aa: 1, evasion: 1 } },
            { from: 7, to: null, stats: { fire: 1, aa: 2, evasion: 1 } },
            { from: 10, to: null, stats: { fire: 1, aa: 3, evasion: 2 } },
          ],
        },
        stack: 'perEquip',
      },
    ]),
  )
  const at = (star) => expectedFitBonus(data, ship(1), [{ mstId: 1, star }]).stats
  assert.deepEqual(at(3), {}, '够不到最低档就一点都没有')
  assert.deepEqual(at(4), { aa: 1, evasion: 1 })
  assert.deepEqual(at(9), { fire: 1, aa: 2, evasion: 1 })
  assert.deepEqual(at(10), { fire: 1, aa: 3, evasion: 2 })
})

test('perEquip 按件数倍乘；cap 只算最好的那几件；once 只加一次取最高档', () => {
  const byStar = {
    kind: 'byStar',
    steps: [
      { from: 0, to: null, stats: { torpedo: 2 } },
      { from: 10, to: null, stats: { torpedo: 4 } },
    ],
  }
  const perEquip = pack(one(1, [{ row: 1, who: { all: true }, gain: byStar, stack: 'perEquip' }]))
  assert.deepEqual(
    expectedFitBonus(perEquip, ship(1), [
      { mstId: 1, star: 10 },
      { mstId: 1, star: 0 },
    ]).stats,
    { torpedo: 6 },
    '两件各按自己的档算：4 + 2',
  )
  const capped = pack(one(1, [{ row: 1, who: { all: true }, gain: byStar, stack: 'perEquip', cap: 2 }]))
  assert.deepEqual(
    expectedFitBonus(capped, ship(1), [
      { mstId: 1, star: 0 },
      { mstId: 1, star: 10 },
      { mstId: 1, star: 10 },
    ]).stats,
    { torpedo: 8 },
    'cap 2 时留改修最高的两件（4+4），不是先来的两件',
  )
  const once = pack(one(1, [{ row: 1, who: { all: true }, gain: byStar, stack: 'once' }]))
  assert.deepEqual(
    expectedFitBonus(once, ship(1), [
      { mstId: 1, star: 0 },
      { mstId: 1, star: 10 },
    ]).stats,
    { torpedo: 4 },
    'once 取最高档的那一件，只加一次',
  )
})

test('byCount 的表本身就是规则，不再另行倍乘', () => {
  const data = pack(
    one(1, [
      {
        row: 1,
        who: { all: true },
        gain: {
          kind: 'byCount',
          counts: [
            { count: 1, stats: { fire: 7, evasion: 5 } },
            { count: 2, stats: { fire: 17, evasion: 10 } },
            { count: 3, stats: { fire: 25, evasion: 15 } },
          ],
        },
        stack: 'table',
      },
    ]),
  )
  const at = (n) =>
    expectedFitBonus(data, ship(1), Array.from({ length: n }, () => ({ mstId: 1, star: 0 }))).stats
  assert.deepEqual(at(1), { fire: 7, evasion: 5 })
  assert.deepEqual(at(2), { fire: 17, evasion: 10 })
  assert.deepEqual(at(4), { fire: 25, evasion: 15 }, '超过最高档就停在最高档')
})

// ---- ④ 预期层：协同条件与三类「算不出来」----

test('协同条件：具名装备逐个占槽，同一件写两遍就是要两件', () => {
  const data = pack(
    one(1, [
      {
        row: 1,
        who: { all: true },
        gain: { kind: 'flat', flat: { fire: 1, torpedo: 3 } },
        stack: 'once',
        need: { with: [{ any: [174] }, { any: [174] }] },
        setTotal: { fire: 3, torpedo: 7 },
      },
    ]),
  )
  const withOne = expectedFitBonus(data, ship(1), [
    { mstId: 1, star: 0 },
    { mstId: 174, star: 0 },
  ])
  assert.deepEqual(withOne.stats, {}, '只带一件不算数')
  const withTwo = expectedFitBonus(data, ship(1), [
    { mstId: 1, star: 0 },
    { mstId: 174, star: 0 },
    { mstId: 174, star: 0 },
  ])
  assert.deepEqual(withTwo.stats, { fire: 1, torpedo: 3 })
  assert.deepEqual(
    withTwo.lines[0].rule.setTotal,
    { fire: 3, torpedo: 7 },
    'setTotal 是整套凑齐的合计，与本行并列而不是相加',
  )
})

test('类目条件判不出来时落 pending，合计只是下限——不许拿一个猜的阈值凑数', () => {
  const data = pack(
    one(500, [
      {
        row: 1,
        who: { all: true },
        gain: { kind: 'flat', flat: { fire: 4, evasion: 3 } },
        stack: 'once',
        need: { star: 4, with: [{ group: 'radar-surface' }] },
      },
    ]),
  )
  // 电探（300）在包的覆盖范围之内、只是没有加成记录 —— 不该被算成「上游还没收录」
  const loadout = [
    { mstId: 500, star: 4 },
    { mstId: 300, star: 0, type2: 12 },
  ]
  const unknown = expectedFitBonus(data, ship(1), loadout, () => 'unknown')
  assert.deepEqual(unknown.stats, {}, 'pending 的行不计入合计')
  assert.equal(unknown.lines.length, 1)
  assert.equal(unknown.lines[0].state, 'pending')
  assert.deepEqual(unknown.lines[0].pendingGroups, ['radar-surface'])
  assert.equal(unknown.complete, false, '有判不出来的行时合计不是完整的')

  const no = expectedFitBonus(data, ship(1), loadout, () => 'no')
  assert.equal(no.lines.length, 0, '判死不满足的行直接不出现')
  const yes = expectedFitBonus(data, ship(1), loadout, () => 'yes')
  assert.deepEqual(yes.stats, { fire: 4, evasion: 3 })
  assert.equal(yes.complete, true)
})

test('按出击海域生效的行母港态判不出来，只列不算', () => {
  const data = pack(
    one(268, [
      {
        row: 1,
        who: { all: true },
        gain: { kind: 'byArea', areas: [{ area: 'north', stats: { armor: 3 } }] },
        stack: 'perEquip',
      },
    ]),
  )
  const result = expectedFitBonus(data, ship(1), [{ mstId: 268, star: 0 }])
  assert.deepEqual(result.stats, {})
  assert.equal(result.lines[0].state, 'area')
  assert.equal(result.complete, false)
})

test('包外的装备落 uncovered：「暂无预期数据」≠「它没有加成」', () => {
  const data = pack(one(300, [{ row: 1, who: { all: true }, gain: { kind: 'flat', flat: { fire: 1 } }, stack: 'perEquip' }]))
  assert.equal(fitPackCoverageMax(data), 300)
  assert.equal(fitPackUncovered(data, 588), true, '超出覆盖边界 = 上游还没收录')
  assert.equal(fitPackUncovered(data, 200), false, '边界之内没记录 = 上游看过了，它就是没加成')
  const result = expectedFitBonus(data, ship(1), [
    { mstId: 300, star: 0 },
    { mstId: 588, star: 0 },
  ])
  assert.deepEqual(result.stats, { fire: 1 })
  assert.deepEqual(result.uncovered, [588])
  assert.equal(result.complete, false)
})

test('反查：哪些装备对这艘舰有加成，按命中层级从具体到笼统', () => {
  const data = pack({
    ...one(1, [{ row: 1, who: { all: true }, gain: { kind: 'flat', flat: { fire: 1 } }, stack: 'perEquip' }]),
    ...one(2, [{ row: 1, who: { forms: [100] }, gain: { kind: 'flat', flat: { fire: 9 } }, stack: 'perEquip' }]),
    ...one(3, [{ row: 1, who: { forms: [999] }, gain: { kind: 'flat', flat: { fire: 9 } }, stack: 'perEquip' }]),
  })
  const hits = fitEquipsForShip(data, ship(100, 30, 2))
  assert.deepEqual(
    hits.map((hit) => [hit.entry.id, hit.topLevel]),
    [
      [2, 3],
      [1, 0],
    ],
  )
})

// ---- ⑤ 双轨对照 ----

test('双轨：diff = 实测 − 预期，正数说明资料里还缺一层', () => {
  const observed = observedFitBonus({
    panel: { fire: 20, torpedo: 0, aa: 12, armor: 5 },
    base: { fire: 10, torpedo: 0, aa: 5, armor: 5 },
    kyouka: [0, 0, 0, 0],
    equips: [{ fire: 6, torpedo: 0, aa: 3, armor: 0, star: 0 }],
  })
  const rows = fitTrackRows({ fire: 4, aa: 2 }, observed)
  assert.deepEqual(
    rows.map((row) => [row.key, row.expected, row.observed, row.diff]),
    [
      ['fire', 4, 4, 0],
      ['torpedo', 0, 0, 0],
      ['aa', 2, 4, 2],
      ['armor', 0, 0, 0],
    ],
  )
})

test('数值文本按固定顺序出，零值不写', () => {
  assert.equal(fitStatsText({ aa: 2, fire: 1, evasion: 0 }), '火力+1 对空+2')
  assert.equal(fitStatsText({ torpedo: -5 }), '雷装-5')
  assert.equal(fitStatsText({}), '')
})

// ---- ⑥ 第一方修正台账 ----

test('修正台账：条目自洽（有依据、有指纹、形态不重复）', () => {
  assert.ok(FIT_BONUS_CORRECTIONS.length > 0, '台账空了？那 applyFitBonusCorrections 就是死代码')
  for (const correction of FIT_BONUS_CORRECTIONS) {
    const at = `修正 ${correction.equipId} ${correction.equipName}`
    assert.ok(correction.jp.length > 10, `${at} 没有日文一手依据`)
    assert.ok(correction.source.includes('wikiwiki'), `${at} 没写日文出处是哪一页`)
    assert.ok(correction.why.length > 20, `${at} 没说分歧在哪`)
    assert.ok(correction.note.length > 0, `${at} 没有给玩家看的一句话`)
    assert.match(correction.decidedAt, /^\d{4}-\d{2}-\d{2}$/, `${at} 裁定日期写法非法`)
    assert.ok(correction.watch.length > 0, `${at} 没盯任何上游行 —— 那它就不会自失效`)
    const seen = new Set()
    for (const patch of correction.patches) {
      for (const form of patch.forms) {
        assert.ok(!seen.has(form), `${at} 形态 ${form} 出现在两组补正里，会被加两遍`)
        seen.add(form)
      }
      assert.ok(
        Object.values(patch.delta).some((value) => value !== 0),
        `${at} 有一组补正量全是 0`,
      )
    }
  }
})

test('修正台账：合成行不参与分层，只在上游行之上加减', () => {
  const base = one(1, [
    { row: 1, who: { classes: [30] }, gain: { kind: 'flat', flat: { fire: 2 } }, stack: 'perEquip' },
  ])
  const data = pack(base)
  // 手工做一条与台账同形的合成行：who 是形态，但带 correction
  data.equips['1'].rules.push({
    row: 0,
    who: { forms: [100] },
    gain: { kind: 'flat', flat: { fire: 1 } },
    stack: 'perEquip',
    correction: '测试用',
  })
  assert.deepEqual(
    expectedFitBonus(data, ship(100, 30), [{ mstId: 1, star: 0 }]).stats,
    { fire: 3 },
    '补正行若参与分层，就会把舰级行顶掉，只剩 +1',
  )
})

test('修正台账：上游那一行改了就作废并告警，不拿过期的修正去改已经变样的东西', () => {
  const correction = FIT_BONUS_CORRECTIONS[0]
  const watched = correction.watch[0]
  const data = pack(
    one(correction.equipId, [
      { row: watched.row, who: { forms: [1] }, gain: { kind: 'flat', flat: { fire: 99 } }, stack: 'perEquip' },
    ]),
  )
  const skipped = []
  const result = applyFitBonusCorrections(data, (entry, reason, detail) =>
    skipped.push([entry.equipId, reason, detail]),
  )
  assert.equal(result.applied, 0)
  assert.equal(skipped.length, FIT_BONUS_CORRECTIONS.length)
  assert.equal(skipped[0][1], 'fingerprint')
  assert.deepEqual(
    result.data.equips[`${correction.equipId}`].rules.filter((rule) => rule.correction),
    [],
    '作废时一条补正行都不该挂上去',
  )
})

test('修正台账：包里没有那件装备时跳过并告警', () => {
  const skipped = []
  const result = applyFitBonusCorrections(pack({}), (entry, reason) => skipped.push([entry.equipId, reason]))
  assert.equal(result.applied, 0)
  assert.ok(skipped.every(([, reason]) => reason === 'no-equip'))
})

// ---- ⑦ 真包层：修正之后要与日文原表逐格对得上 ----

const packFile = path.join(root, 'assets', 'lodes', 'kcwiki-fit-bonus.json')
const realPack = fs.existsSync(packFile)
  ? JSON.parse(fs.readFileSync(packFile, 'utf8')).data
  : null
const realSkip = realPack ? false : '缺 assets/lodes/kcwiki-fit-bonus.json'

test('真包：四条修正全部落地，一条都没作废', { skip: realSkip }, () => {
  const skipped = []
  const { applied } = applyFitBonusCorrections(realPack, (entry, reason, detail) =>
    skipped.push(`${entry.equipId} ${reason} ${detail}`),
  )
  assert.deepEqual(skipped, [], '有修正作废了 —— 上游改了那几行，要重新核日文原文')
  assert.equal(applied, FIT_BONUS_CORRECTIONS.length)
})

test('真包：317 三式弾改那 16 格，叠加后与日文原表一致', { skip: realSkip }, () => {
  // 日文近验表（wikiwiki「三式弾改」装備ボーナス）：
  //   金剛型(未改造/改) 火力+2 対空+1 ／ 金剛改二・改二丙 +4 +3 ／ 比叡改二 +3 +2
  //   榛名改二 +3 +2 回避+1 ／ 榛名改二乙 +3 +4 回避+2 ／ 榛名改二丙 +4 +3 回避+1
  //   霧島改二 +4 +2 ／ 比叡改二丙 +4 +3
  // 这 16 格上游的火力栏整体少 1（对空/回避两栏本来就对）。
  const want = {
    78: { fire: 2, aa: 1 }, // 金剛
    79: { fire: 2, aa: 1 }, // 榛名
    85: { fire: 2, aa: 1 }, // 霧島
    86: { fire: 2, aa: 1 }, // 比叡
    209: { fire: 2, aa: 1 }, // 金剛改
    210: { fire: 2, aa: 1 }, // 比叡改
    211: { fire: 2, aa: 1 }, // 榛名改
    212: { fire: 2, aa: 1 }, // 霧島改
    149: { fire: 4, aa: 3 }, // 金剛改二
    591: { fire: 4, aa: 3 }, // 金剛改二丙
    592: { fire: 4, aa: 3 }, // 比叡改二丙
    150: { fire: 3, aa: 2 }, // 比叡改二
    151: { fire: 3, aa: 2, evasion: 1 }, // 榛名改二
    593: { fire: 3, aa: 4, evasion: 2 }, // 榛名改二乙
    954: { fire: 4, aa: 3, evasion: 1 }, // 榛名改二丙
    152: { fire: 4, aa: 2 }, // 霧島改二
  }
  const { data } = applyFitBonusCorrections(realPack)
  for (const [formId, stats] of Object.entries(want)) {
    // 317 的规则全按精确形态写，舰级/舰种取什么都不影响判定
    const got = expectedFitBonus(data, ship(Number(formId), -1, -1), [{ mstId: 317, star: 0 }])
    assert.deepEqual(got.stats, stats, `317 × 形态 ${formId} 与日文原表对不上`)
    assert.equal(got.complete, true)
  }
  // 修正前必须确实是低 1 的——否则这条护栏在「上游已经修好了」的世界里会假绿
  const before = expectedFitBonus(realPack, ship(149, -1, -1), [{ mstId: 317, star: 0 }])
  assert.deepEqual(before.stats, { fire: 3, aa: 3 }, '上游已经修好了？那这条修正该退休')
})

test('真包：被盯的那几行指纹与台账逐字对得上', { skip: realSkip }, () => {
  for (const correction of FIT_BONUS_CORRECTIONS) {
    const entry = realPack.equips[`${correction.equipId}`]
    assert.ok(entry, `包里没有 ${correction.equipId}`)
    for (const watched of correction.watch) {
      const rule = entry.rules.find((one) => one.row === watched.row)
      assert.ok(rule, `${correction.equipId} 第 ${watched.row} 行不见了`)
      assert.equal(
        fitRuleFingerprint(rule),
        watched.fingerprint,
        `${correction.equipId} 第 ${watched.row} 行的指纹变了`,
      )
    }
  }
})

test('真包：没被台账点名的形态一格都不许被误伤', { skip: realSkip }, () => {
  const { data } = applyFitBonusCorrections(realPack)
  // 317 台账只管金剛型那 16 个形态；長門改二(541) / 陸奥改二(573) 不在名单里
  for (const formId of [541, 573]) {
    assert.deepEqual(
      expectedFitBonus(data, ship(formId, -1, -1), [{ mstId: 317, star: 0 }]).stats,
      expectedFitBonus(realPack, ship(formId, -1, -1), [{ mstId: 317, star: 0 }]).stats,
      `317 × 形态 ${formId} 被修正误伤了`,
    )
  }
})

// ---- ⑧ 退货层：akashi 运行时那一整层必须是真的没了 ----

test('akashi 运行时路径已整层退役：应用侧一个引用都不许剩', () => {
  assert.equal(
    fs.existsSync(path.join(root, 'src', 'main', 'akashi-fit.ts')),
    false,
    'src/main/akashi-fit.ts 又回来了',
  )
  // 穷举 src/ 下所有源码文件，逐个查，不靠「我记得没有」
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [full]
    })
  const sources = walk(path.join(root, 'src'))
  assert.ok(sources.length > 40, '穷举没扫到东西？路径写错了')
  const offenders = []
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8')
    // 注释里说明「它退役了」是允许的；能真的发起请求或挂 IPC 的写法一律不许
    for (const pattern of [/akashi-fit:/, /akashi-list\.me/, /data-akashi/, /parseAkashiFit/]) {
      if (pattern.test(text)) offenders.push(`${path.relative(root, file)} → ${pattern}`)
    }
  }
  assert.deepEqual(offenders, [], 'akashi 的运行时路径还有活引用')
  // 维护者侧那份清洗层留着（fit-bonus-votes 取票要用），别顺手删了
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'akashi-fit-parser.mjs')))
})

test('EO 的 fit-bonus 包运行时零读取：消费清单与源码两头都不许有它', async () => {
  const lodeIds = fs.readFileSync(path.join(root, 'src', 'shared', 'lode-ids.ts'), 'utf8')
  // 钉编译出来的清单，不钉源码那一行的形状（同 core-regressions 里那条的理由）
  const { CONSUMED_LODE_IDS: consumedIds } = await import('../dist/shared/lode-ids.js')
  assert.equal(consumedIds.includes('fit-bonus'), false)
  assert.equal(consumedIds.includes('kcwiki-fit-bonus'), true)
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [full]
    })
  const offenders = walk(path.join(root, 'src'))
    .filter((file) => /queryLode\(\s*'fit-bonus'\s*\)|getLode\(\s*'fit-bonus'\s*\)/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
  assert.deepEqual(offenders, [], '还有地方在运行时读 EO 的 fit-bonus 包')
})

// ---- ⑨ 2026-08-22 那批 69 条修正：按「错法各不相同」挑的五组逐格断言 ----
//
// 断言值全部来自**日文原表**（wikiwiki 装備ボーナス表），不是从代码里读回来的。
// 挑的五组各代表上游一种结构性错法：类目层整层漏掉 / 同一档写两行被相加 /
// 协同行被写成无条件 / 排除条件漏了 / 部分裁决只动该动的那一格。

test('真包：水上爆撃機那一族 7 件 × 7 形态，类目层补齐后逐格与日文类目行一致', { skip: realSkip }, () => {
  // 日文一手的类目行「水上爆撃機(その他日本)」：
  //   能代改二 火力+3 対潜+1 回避+2／矢矧改二・乙 +3 対空+1 対潜+1 回避+2
  //   最上改二・特 +3 +1 回避+2／三隈改二・特 +2 +1 回避+2
  // 上游是逐装备写的，把这一整层漏了 —— 这一改里格数最多的一种错法（约 90 格）。
  const want = {
    662: { fire: 3, asw: 1, evasion: 2 }, // 能代改二
    663: { fire: 3, aa: 1, asw: 1, evasion: 2 }, // 矢矧改二
    668: { fire: 3, aa: 1, asw: 1, evasion: 2 }, // 矢矧改二乙
    501: { fire: 3, aa: 1, evasion: 2 }, // 最上改二
    506: { fire: 3, aa: 1, evasion: 2 }, // 最上改二特
    502: { fire: 2, aa: 1, evasion: 2 }, // 三隈改二
    507: { fire: 2, aa: 1, evasion: 2 }, // 三隈改二特
  }
  const { data } = applyFitBonusCorrections(realPack)
  for (const equipId of [26, 62, 79, 80, 81, 207, 208]) {
    for (const [formId, stats] of Object.entries(want)) {
      assert.deepEqual(
        expectedFitBonus(data, ship(Number(formId), -1, -1), [{ mstId: equipId, star: 0 }]).stats,
        stats,
        `${equipId} × 形态 ${formId} 与日文类目行对不上`,
      )
    }
  }
})

test('真包：同族另外 4 件（322/237/323/490）的伊勢型改二与最上系一并锁死', { skip: realSkip }, () => {
  const { data } = applyFitBonusCorrections(realPack)
  const at = (equipId, formId) =>
    expectedFitBonus(data, ship(formId, -1, -1), [{ mstId: equipId, star: 0 }]).stats
  // 伊勢改二(553)/日向改二(554)：322 与 490 同族同值那一条已裁，323 是熟練档
  assert.deepEqual(at(322, 553), { fire: 8, aa: 3, asw: 1, evasion: 4 })
  assert.deepEqual(at(322, 554), { fire: 8, aa: 3, asw: 1, evasion: 4 })
  assert.deepEqual(at(323, 553), { fire: 9, aa: 4, asw: 2, evasion: 5 })
  // 最上系那一层四件给的是同一档（这一族的类目行本来就共用）
  for (const equipId of [322, 237, 323, 490]) {
    assert.deepEqual(at(equipId, 501), { fire: 4, aa: 1, evasion: 3 }, `${equipId} × 最上改二`)
    assert.deepEqual(at(equipId, 502), { fire: 3, aa: 1, evasion: 3 }, `${equipId} × 三隈改二`)
    assert.deepEqual(at(equipId, 662), { fire: 4, asw: 1, evasion: 2 }, `${equipId} × 能代改二`)
  }
})

test('真包：310 / 359 同一档写了两行被相加，修正后正好等于上游两行之一', { skip: realSkip }, () => {
  // 上游把「夕張」与「夕張改二系」两档都写成 classes:[34]，于是两行都命中、被加了起来。
  // 这一类最好验：修正后的值应当**正好是上游两行中的一行**，而不是它们的和。
  const { data } = applyFitBonusCorrections(realPack)
  const at = (source, equipId, formId) =>
    expectedFitBonus(source, ship(formId, 34, 3), [{ mstId: equipId, star: 0 }]).stats
  // 310「14cm連装砲改」：夕張 2/1/1、夕張改二系 4/1/対潜1/2
  assert.deepEqual(at(realPack, 310, 115), { fire: 6, aa: 2, asw: 1, evasion: 3 }, '修正前确实是两行之和')
  assert.deepEqual(at(data, 310, 115), { fire: 2, aa: 1, evasion: 1 }, '夕張（未改）吃低档')
  assert.deepEqual(at(data, 310, 293), { fire: 2, aa: 1, evasion: 1 }, '夕張改 同低档')
  for (const formId of [622, 623, 624]) {
    assert.deepEqual(at(data, 310, formId), { fire: 4, aa: 1, asw: 1, evasion: 2 }, '夕張改二系吃高档')
  }
  // 359「6inch 連装速射砲 Mk.XXI」：同一种错法，值不同
  assert.deepEqual(at(realPack, 359, 115), { fire: 3, aa: 3, evasion: 2 })
  assert.deepEqual(at(data, 359, 115), { fire: 1, aa: 1, evasion: 1 })
  assert.deepEqual(at(data, 359, 622), { fire: 2, aa: 2, evasion: 1 })
})

test('真包：503 协同行被写成无条件——★0 无协同归位，协同那一笔一格不动', { skip: realSkip }, () => {
  const { data } = applyFitBonusCorrections(realPack)
  const bare = (source, formId) =>
    expectedFitBonus(source, ship(formId, -1, -1), [{ mstId: 503, star: 0 }]).stats
  // 共同分母（★0・1 件・无协同）上，日文原表给的就是上游第 2/3/4 行那三档
  assert.deepEqual(bare(data, 591), { fire: 3, aa: 1, accuracy: 1 })
  assert.deepEqual(bare(data, 592), { fire: 3, aa: 1, accuracy: 1 })
  assert.deepEqual(bare(data, 593), { fire: 4, aa: 4, accuracy: 2 })
  assert.deepEqual(bare(data, 954), { fire: 4, aa: 3, accuracy: 2 })
  assert.deepEqual(bare(realPack, 591), { fire: 4, aa: 1, accuracy: 2, torpedo: 1 }, '修正前多着那三笔')

  // 带上 53cm連装魚雷（mstId 174）★max 时**不受本修正影响**：
  // 补正是一笔常量，带不带协同装备都该扣同样多。差值不一致 = 补正被挂到协同路径上了。
  const withTorpedo = (source, formId) =>
    expectedFitBonus(source, ship(formId, -1, -1), [
      { mstId: 503, star: 0 },
      { mstId: 174, star: 10 },
    ]).stats
  const delta = (before, after) => {
    const out = {}
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const value = (after[key] ?? 0) - (before[key] ?? 0)
      if (value) out[key] = value
    }
    return out
  }
  for (const formId of [591, 592, 593, 954]) {
    assert.deepEqual(
      delta(withTorpedo(realPack, formId), withTorpedo(data, formId)),
      delta(bare(realPack, formId), bare(data, formId)),
      `503 × 形态 ${formId}：带协同装备时补正量变了 —— 补正被误挂到协同路径上`,
    )
  }
  // 换个方向再钉一遍：协同装备**多带来的那一截**（带 − 不带）修正前后必须完全一样。
  // 上面那条查的是「补正是不是常量」，这条查的是「协同行本身有没有被吃掉」。
  for (const formId of [591, 592, 593, 954]) {
    assert.deepEqual(
      delta(bare(data, formId), withTorpedo(data, formId)),
      delta(bare(realPack, formId), withTorpedo(realPack, formId)),
      `503 × 形态 ${formId}：协同装备带来的那一截被修正动过了`,
    )
  }
})

test('真包：464 漏了「除く」——榛名改二乙/丙 抹成空，同一行其余形态不许被误伤', { skip: realSkip }, () => {
  // 日文那行写着「※榛名改二乙/丙を除く」，上游整个漏了。这是这一改里唯一一条
  // 「把值抹成零」的修正，最该有一条不误伤断言。
  const { data } = applyFitBonusCorrections(realPack)
  const at = (source, formId) =>
    expectedFitBonus(source, ship(formId, -1, -1), [{ mstId: 464, star: 0 }]).stats
  for (const formId of [593, 954]) {
    assert.deepEqual(at(realPack, formId), { aa: -2, evasion: -2 }, '修正前确实在挨罚')
    assert.deepEqual(at(data, formId), {}, `形态 ${formId} 该被免罚，且合计里不许留 0 值残渣`)
  }
  for (const formId of [149, 150, 151, 152, 591, 592]) {
    assert.deepEqual(at(data, formId), { aa: -2, evasion: -2 }, `形态 ${formId} 被误伤了`)
  }
})

test('真包：529 部分裁决——只动该动的那两组，其余一格不许动', { skip: realSkip }, () => {
  const { data } = applyFitBonusCorrections(realPack)
  const at = (source, formId) =>
    expectedFitBonus(source, ship(formId, 30, 2), [{ mstId: 529, star: 0 }]).stats
  // ① 雪風改(228)：日文「雪風・磯風乙改」档从雪風起算，含雪風改 —— 上游漏了回避
  assert.deepEqual(at(realPack, 228), { fire: 2 })
  assert.deepEqual(at(data, 228), { fire: 2, evasion: 2 })
  // ② 陽炎型改二那 6 格：用户 2026-08-22 游戏实测终审，回避+2 → 命中+2
  //    （日文页表格与脚注打架，绿箭头只出现在 火力+3 与 命中+2 两栏）
  for (const formId of [566, 567, 568, 670, 915, 951]) {
    assert.deepEqual(at(realPack, formId), { fire: 3, evasion: 2 }, '上游原值就是脚注那一侧')
    assert.deepEqual(
      at(data, formId),
      { fire: 3, accuracy: 2 },
      `形态 ${formId} 与用户实拍的预览箭头对不上`,
    )
  }
  // ③ 本方本来就对的那 4 格 + 雪風改二/丹陽/秋雲改二：一格不许动
  for (const formId of [43, 167, 243, 320, 651, 656, 648]) {
    assert.deepEqual(at(data, formId), at(realPack, formId), `形态 ${formId} 被部分裁决误伤了`)
  }
})

test('真包：69 条修正一条都没作废，且形态在条目之间不重复', { skip: realSkip }, () => {
  const skipped = []
  applyFitBonusCorrections(realPack, (correction, reason, detail) =>
    skipped.push(`${correction.equipId} ${reason} ${detail}`),
  )
  assert.deepEqual(skipped, [], '有修正作废了 —— 上游改了那几行，要重新核日文原文')
  // 同一件装备可以有两条修正（529 就是：一条日文表裁的、一条用户实测裁的），
  // 但同一件装备的同一个形态**不许**出现在两条的补正里 —— 那会被加两遍。
  const claimed = new Map()
  for (const correction of FIT_BONUS_CORRECTIONS) {
    for (const patch of correction.patches) {
      for (const form of patch.forms) {
        const key = `${correction.equipId}/${form}`
        assert.ok(!claimed.has(key), `装备 ${correction.equipId} 的形态 ${form} 被两条修正各补了一次`)
        claimed.set(key, true)
      }
    }
  }
})
