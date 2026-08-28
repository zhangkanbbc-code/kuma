// 装备加成实测栏的归键与合并（纯函数层）。
//
// 这一层管三件事，三件都是被真实误报逼出来的：
//   ① ★ 进观察键——原先按「舰」归、★ 取 max，混★ 的行会显示一个从没观察到的星级；
//   ② 混★ 取消直读资格——差值归不到单一星级档上；
//   ③ 同 ★ 同件数同读数同证据强度的几艘并成一行，★ 不同的绝不并。

import assert from 'node:assert/strict'
import test from 'node:test'

import { FIT_PANEL_KEYS } from '../src/shared/fit-bonus.ts'
import {
  fitObservationKey,
  fitObservationMixedStar,
  fitObservationStarLabel,
  fitObservationStars,
  fitObservationVerdict,
  groupFitObservations,
} from '../src/shared/fit-observation.ts'

const sample = (overrides = {}) => ({
  rosterId: 1,
  formId: 100,
  name: '某舰',
  lv: 99,
  stars: [0],
  stats: { fire: 2 },
  soleCandidate: false,
  ...overrides,
})

// ---- ① ★ 进键 ----

test('观察键带着★与件数：★ 升级后是新的一条，不覆盖旧星级那条读数', () => {
  const at0 = fitObservationKey(342, 599, [0])
  const at6 = fitObservationKey(342, 599, [6])
  assert.notEqual(at0, at6, '★ 不进键的话，升级一次旧读数就被顶掉了')
  assert.match(at0, /★0/)
  assert.match(at6, /★6/)
  // 件数在键面上看得见，不必数分隔符
  assert.match(fitObservationKey(342, 599, [6, 6]), /x2$/)
  // ★ 多重集排序无关：同一套装备，先看谁不影响归键
  assert.equal(fitObservationKey(342, 599, [2, 0]), fitObservationKey(342, 599, [0, 2]))
})

test('★ 多重集排序、混★ 判据与显示文本', () => {
  assert.deepEqual(fitObservationStars([2, 0, 6]), [0, 2, 6])
  assert.equal(fitObservationMixedStar([2, 2]), false)
  assert.equal(fitObservationMixedStar([0, 2]), true)
  assert.equal(fitObservationStarLabel([2, 2]), '★2', '同★ 只报一次')
  assert.equal(fitObservationStarLabel([0, 2]), '★0/★2', '混★ 要把观察到的都列出来')
  assert.equal(fitObservationStarLabel([]), '')
})

// ---- ② 用户实拍的那个活案例 ----

test('赤城改二戊 × 流星改(一航戦/熟練) ★0＋★2：标混★、取消直读、不许报成「2 件 ★2」', () => {
  // 用户 2026-08 实拍：同一艘赤城改二戊上装了 ★0 与 ★2 各一件，
  // 旧实现按 Math.max 拍出「2 件 ★2」——那个 ★2 是算出来的，不是观察到的。
  const [row] = groupFitObservations([
    sample({
      rosterId: 77,
      formId: 599,
      name: '赤城改二戊',
      lv: 175,
      stars: [0, 2],
      stats: { fire: 5, aa: 1 },
      soleCandidate: true,
    }),
  ])
  assert.equal(row.count, 2)
  assert.deepEqual(row.stars, [0, 2])
  assert.equal(row.mixedStar, true)
  assert.equal(row.starLabel, '★0/★2')
  assert.notEqual(row.starLabel, '★2', '显示的★必须是实际观察时的，不许是 max')
  assert.equal(row.sole, false, '混★ 时差值分不到单一星级档，不给直读')
})

test('同★ 时直读资格照给——取消资格的是混★，不是「装了两件」', () => {
  const [row] = groupFitObservations([
    sample({ stars: [2, 2], soleCandidate: true, stats: { fire: 4 } }),
  ])
  assert.equal(row.mixedStar, false)
  assert.equal(row.sole, true)
  assert.equal(row.count, 2)
})

// ---- ③ 合并与不合并 ----

test('同★同件数同读数同证据强度的几艘并成一行列舰名', () => {
  const rows = groupFitObservations([
    sample({ rosterId: 1, formId: 100, name: '甲', lv: 90, stars: [0], stats: { fire: 2 } }),
    sample({ rosterId: 2, formId: 200, name: '乙', lv: 120, stars: [0], stats: { fire: 2 } }),
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(
    rows[0].ships.map((one) => one.name),
    ['乙', '甲'],
    '并行内按等级降序，面板更稳的排前面',
  )
})

test('★ 不同的两行绝不并——那正是要防的那个错', () => {
  const rows = groupFitObservations([
    sample({ rosterId: 1, name: '甲', stars: [0], stats: { fire: 2 } }),
    sample({ rosterId: 2, name: '乙', stars: [6], stats: { fire: 2 } }),
  ])
  assert.equal(rows.length, 2)
})

test('证据强度不同也不并：直读行与整条配装合计行是两条信息', () => {
  const rows = groupFitObservations([
    sample({ rosterId: 1, name: '甲', soleCandidate: true }),
    sample({ rosterId: 2, name: '乙', soleCandidate: false }),
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].sole, true, '直读行排前面')
})

// ---- 排序与折叠 ----

test('排序：非零行在前、直读行最前，四项皆 0 的一律垫底等着被折起来', () => {
  const rows = groupFitObservations([
    sample({ rosterId: 1, name: '零直读', stats: {}, soleCandidate: true, stars: [0] }),
    sample({ rosterId: 2, name: '非零合计', stats: { fire: 1 }, soleCandidate: false, stars: [1] }),
    sample({ rosterId: 3, name: '非零直读', stats: { fire: 3 }, soleCandidate: true, stars: [2] }),
  ])
  assert.deepEqual(
    rows.map((row) => row.ships[0].name),
    ['非零直读', '非零合计', '零直读'],
  )
  assert.deepEqual(
    rows.map((row) => row.allZero),
    [false, false, true],
  )
})

test('四项皆 0 认的是「一项都没读出来」，不是「有负数」', () => {
  const [row] = groupFitObservations([sample({ stats: { armor: -1 } })])
  assert.equal(row.allZero, false)
})

// ---- ④ 与预期比对（2026-08-28）----
//
// 用户：「本机印证如果符合不要列出来，要不然多了下面就挤不下了」。
// 于是每一次观察都要先和**当下那张**预期表比一次，相符的才折得起来。
// 折错的代价是替资料把一处错藏起来——所以拿不准一律不折。

/** 预期层输出的最小形状（`expectedFitBonus` 的产物）。 */
const expected = (stats, overrides = {}) => ({
  stats,
  lines: [],
  uncovered: [],
  complete: true,
  ...overrides,
})

/** 实测层输出的最小形状（`observedFitBonus` 的产物）。 */
const observed = (stats, skipped = []) => ({
  rows: Object.entries(stats).map(([key, value]) => ({ key, label: key, observed: value })),
  pure: true,
  any: Object.values(stats).some((value) => value !== 0),
  stats,
  skipped,
  unverified: [],
})

const verdictOf = (exp, obs) => fitObservationVerdict(exp, obs, FIT_PANEL_KEYS)

test('逐项相等 = 相符（拿真配装验过：12.7cm連装砲A型 × 叢雲改二 两轨都是 回避+4）', () => {
  assert.equal(verdictOf(expected({ evasion: 4 }), observed({ evasion: 4 })), 'match')
})

test('对不上就是不符——哪怕只差一项、哪怕差的是那一项的 0', () => {
  // 时雨改三实拍：面板 火力+8，资料只给到 +5
  assert.equal(verdictOf(expected({ fire: 5 }), observed({ fire: 8 })), 'mismatch')
  // 资料一条都没给、面板却读出东西（Киров 实拍）——这也是不符，不是「没数据」
  assert.equal(verdictOf(expected({}), observed({ fire: 5, torpedo: 6 })), 'mismatch')
})

test('反向的洞：预期非 0 而面板全 0，也是不符（不许被「各项皆 0」折走）', () => {
  const row = groupFitObservations([
    sample({ stats: {}, soleCandidate: true, verdict: verdictOf(expected({ fire: 3 }), observed({ fire: 0 })) }),
  ])[0]
  assert.equal(row.verdict, 'mismatch')
  assert.equal(row.allZero, true, '读数确实是全 0')
  // 渲染侧按 verdict 分，不按 allZero 分——这一行要留在默认展开的那一堆里
})

test('命中/射程/爆装不进面板，也就不进比对：预期里有它们不影响结论', () => {
  // 初月改二实拍：预期多一条 命中+2，面板七项逐项对上
  assert.equal(
    verdictOf(expected({ fire: 5, aa: 4, accuracy: 2 }), observed({ fire: 5, aa: 4 })),
    'match',
  )
})

test('预期不完整就不许说「相符」：未收录 / 待定行 / 按海域的行，以及包没加载', () => {
  const good = observed({ fire: 2 })
  assert.equal(verdictOf(expected({ fire: 2 }, { complete: false }), good), 'unknown')
  assert.equal(verdictOf(null, good), 'unknown', '包没加载时求值器给的就是 complete:false')
  assert.equal(verdictOf(undefined, good), 'unknown')
})

test('被闸门挡下的项上预期有数 = 没读到，比不了；预期是 0 才不算数', () => {
  const blocked = [{ key: 'evasion', label: '回避', gate: 'fail' }]
  assert.equal(
    verdictOf(expected({ fire: 2, evasion: 3 }), observed({ fire: 2 }, blocked)),
    'unknown',
    '回避那一格根本没读到，不能算「对上了」',
  )
  assert.equal(
    verdictOf(expected({ fire: 2 }), observed({ fire: 2 }, blocked)),
    'match',
    '那一格两侧都不出数，折起来没藏住任何本来看得见的东西',
  )
})

test('一项都没出行 = 什么都没比过，不是相符', () => {
  assert.equal(verdictOf(expected({}), observed({})), 'unknown')
})

test('读数一样但结论不同的两艘绝不并成一行——并了就是把「不符」藏进别人的行里', () => {
  const rows = groupFitObservations([
    sample({ rosterId: 1, name: '对上的', stats: { fire: 2 }, verdict: 'match' }),
    sample({ rosterId: 2, name: '对不上的', stats: { fire: 2 }, verdict: 'mismatch' }),
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].ships[0].name, '对不上的', '不符的排最前，绝不能被挤下去')
  assert.equal(rows[1].verdict, 'match')
})

test('没比过的观察按 unknown 算，不按相符算（默认值不许偏向折叠）', () => {
  const [row] = groupFitObservations([sample({})])
  assert.equal(row.verdict, 'unknown')
})
