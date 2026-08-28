// 活动陆航特効接进推荐搭配（三期）的护栏。
//
// 这批测试盯四件在改动中最容易悄悄坏掉、坏了又不报错的事：
//
//  ① **整队倍率没算成单格倍率**。陆航 C 组的倍率作用于队里全部四架，
//     写成「只乘特効机自己那一格」会让数小一大截，而界面照样出得来。
//     E5 的两个数（対水上艦 661.0、対砲台 1924.6）当预言机。
//
//  ② **同组重复相乘 / 异组漏乘**。同组只算一次、异组才叠乘；两个方向各有反例钉着。
//
//  ③ **非活动语境被污染**。这是用户拍的硬性要求：目标点不是活动图就走纯二期逻辑，
//     输出与二期**逐字节一致**。金样本 test/lbas-plain-golden.json 是在特効一行都还没接
//     之前、用二期的 dist 采的 420 组，这里逐组比对。
//
//  ④ **scope 认点位**。上游同一列里混着「阶段名+点位」与「裸点位清单」两种写法，
//     本期 E5 还同时存在阶段 P2 与点位 P2、点位 Z 与点位 ZZ——读错一种就发错倍率。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import recommendMod from '../dist/shared/lbas-recommend.js'
import bonusMod from '../dist/shared/lbas-event-bonus.js'
import applyMod from '../dist/shared/event-bonus-apply.js'
import validation from '../dist/main/lode-validation.js'
import { PLAIN_CASES, PLANES, planSignature } from './lbas-plain-cases.mjs'

const { recommendLbas } = recommendMod
const { lbasBonusContext, squadBonusMultiplier, planeGroupsOf } = bonusMod
const { scopeApplies, scopeNodes } = applyMod

const read = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'))
const aaPack = read('../assets/lodes/equip-aa-evasion.json')
const bonusPack = read('../assets/lodes/event-bonus.json')
const groupPack = read('../assets/lodes/event-plane-groups.json')
const golden = read('./lbas-plain-golden.json')

const EVENT_PAGE = '2026年夏季活动'
const table = groupPack.data
const rowOf = (mstId) => aaPack.data.find((row) => row.eq_id === mstId) ?? null
const noEvasion = () => null
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `期望 ${b}，实得 ${a}`)

const ctxFor = (event, node) =>
  lbasBonusContext(bonusPack.data.events[event].entries, node, table, EVENT_PAGE)

// 主数据实测值，与推荐一期/二期那批用的是同一批数字
const DO217 = { mstId: 406, name: 'Do 217 K-2+Fritz-X', type2: 47, torpedo: 16, bomb: 24, distance: 4, cost: 17, level: 0 }
const SM79S = { mstId: 433, name: 'SM.79 bis(熟練)', type2: 47, torpedo: 13, bomb: 14, distance: 8, cost: 14, level: 0 }
const B25 = { mstId: 459, name: 'B-25', type2: 47, torpedo: 8, bomb: 16, distance: 7, cost: 13, level: 0 }
const SPIT1 = { mstId: 250, name: 'Spitfire Mk.I', type2: 48, torpedo: 0, bomb: 0, distance: 4, cost: 5, level: 0 }

// ---- ⑤ 分组事实表本身 ----

test('分组事实表过校验，形状与出处齐全，且 basis 写的是「同源转录」而不是两票', () => {
  assert.ok(validation.validateLodePack(groupPack).ok, '分组表没过 schema 校验')
  assert.deepEqual(Object.keys(table.groups).sort(), ['C1', 'C2', 'C3'])
  assert.equal(table.groups.C1.length, 2, 'C1 = 深山/深山改')
  assert.equal(table.groups.C2.length, 19)
  assert.equal(table.groups.C3.length, 16)
  assert.equal(table.event, EVENT_PAGE, '期号必须在，换期靠它退场')

  // 名单核过 wikiwiki 与 kcwiki 两家、37/37 一致，**但两家都自述转自同一份社区分类表**。
  // 一致只证明誊抄没串行，不证明上游那张表本身对——basis 不许被写成「多源印证」。
  assert.ok(table.basis.includes('同源转录'), `basis 应写同源转录，实得：${table.basis}`)
  assert.ok(!/多源|双票|两票|印证一致/.test(table.basis), `basis 不许自称多源：${table.basis}`)

  // 一件装备只能落一个 C 组：落进两个多半是解析错位（kcwiki 那张表的 `|}` 表尾）
  const all = Object.values(table.groups).flat()
  assert.equal(new Set(all).size, all.length, '有装备同时落在两个 C 组')

  // 三件曾被解析错位读成邻组的，逐件钉死正确归属
  assert.ok(table.groups.C3.includes(401), 'Do 17 Z-2 属 C3')
  assert.ok(table.groups.C2.includes(480), 'Mosquito PR Mk.IV 属 C2')
  assert.ok(table.groups.C2.includes(561), 'Ho229 属 C2')
  // 上游计算例点名的那两件
  assert.ok(table.groups.C2.includes(433), 'SM.79 bis(熟練) 属 C2')
  assert.ok(table.groups.C3.includes(459), 'B-25 属 C3')
})

test('缺分组表 / 换期 / 常规海域，三种情况都得不到特効上下文', () => {
  assert.equal(lbasBonusContext(bonusPack.data.events.E5.entries, 'J2', null, EVENT_PAGE), null, '缺表')
  assert.equal(
    lbasBonusContext(bonusPack.data.events.E5.entries, 'J2', table, '2027年冬季活动'),
    null,
    '换期后整表不生效，不拿上一期的名单套这一期',
  )
  assert.equal(lbasBonusContext([], 'A', table, EVENT_PAGE), null, '常规海域没有条目')
  assert.equal(ctxFor('E5', null), null, '没选点位就没有点位倍率')
})

// ---- ④ E1–E3：确认没有，不是没解析出来 ----

test('E1–E3 一个点都没有陆航特効，活动图也照走纯二期', () => {
  for (const event of ['E1', 'E2', 'E3']) {
    const nodes = new Set()
    for (const entry of bonusPack.data.events[event].entries) {
      for (const node of scopeNodes(entry.scope).nodes) nodes.add(node)
    }
    assert.ok(nodes.size > 0, `${event} 应当有点位条目（否则这条测试没在测东西）`)
    for (const node of nodes) {
      assert.equal(ctxFor(event, node), null, `${event} 的 ${node} 点不该有陆航特効`)
    }
    assert.equal(
      bonusPack.data.events[event].entries.filter((e) => e.by === 'lbas').length,
      0,
      `${event} 上游明写「基地航空隊特効：なし」`,
    )
  }
})

// ---- ① E5：整队倍率 ----

test('E5：3×銀河(江草隊)+Mosquito 反超 4×銀河——特効乘的是整队，不是那一格', () => {
  const ctx = ctxFor('E5', 'J2')
  assert.deepEqual([...ctx.rates], [['C2', 1.2]], 'E5 的 J2 点是 C2 ×1.2 单组')

  const stock = [
    { ...PLANES.egusa, count: 4 },
    { ...PLANES.mosquito, count: 1 },
  ]
  // 无档表时纯二期会取四架江草隊（威力高）；组合择优要看出换一架反而更强。
  // 这一档才真正在考组合逻辑——有档表时 Mosquito 本来就因回避档排在前面。
  const plain = recommendLbas({ stock, targetRadius: 7, target: 'surface', evasionOf: noEvasion })
  near(plain.power, 633.6)
  assert.deepEqual(plain.slots.map((s) => s.plane.mstId), [388, 388, 388, 388])

  const best = recommendLbas({ stock, targetRadius: 7, target: 'surface', evasionOf: noEvasion, bonus: ctx })
  near(best.power, 661.0)
  near(best.plainPower, 633.6)
  assert.equal(best.bonusMultiplier, 1.2)
  assert.equal(best.slots.filter((s) => s.plane.mstId === 479).length, 1, '应当塞进一架 Mosquito')
  assert.equal(best.slots.filter((s) => s.plane.mstId === 388).length, 3)
  assert.ok(best.power > plain.power, '组合择优必须真的反超')

  // 対砲台小鬼同一组的另一个数
  const pill = recommendLbas({ stock, targetRadius: 7, target: 'pillbox', evasionOf: noEvasion, bonus: ctx })
  near(pill.power, 1924.6, 0.1)
  const pillPlain = recommendLbas({ stock, targetRadius: 7, target: 'pillbox', evasionOf: noEvasion })
  near(pillPlain.power, 1603.8, 0.1)
})

test('E5：特効机那一格的贡献里含着它带给另外三架的部分', () => {
  const ctx = ctxFor('E5', 'J2')
  const best = recommendLbas({
    stock: [{ ...PLANES.egusa, count: 4 }, { ...PLANES.mosquito, count: 1 }],
    targetRadius: 7,
    target: 'surface',
    evasionOf: noEvasion,
    bonus: ctx,
  })
  const mosquito = best.slots.find((s) => s.plane.mstId === 479)
  // 它单飞只有 75.6；抽掉它整队倍率一起没了，所以这一格值 661.0 − 475.2
  near(mosquito.detail.power, 75.6)
  near(mosquito.power, 661.0 - 475.2)
  assert.ok(mosquito.power > mosquito.detail.power * 2, '整队 buff 必须计进这一格的贡献')
})

// ---- ② E4：异组叠乘 ----

test('E4：C2 与 C3 各一架时叠乘 1.06×1.03，且组合择优真的选它', () => {
  const ctx = ctxFor('E4', 'Z')
  assert.deepEqual([...ctx.rates].sort(), [['C2', 1.06], ['C3', 1.03]])

  // 対砲台：Do 217 K-2(C3) 四架 = 1749.6×1.03；换一架 Mosquito(C2) = 1738.8×1.06×1.03 更高
  const stock = [
    { ...DO217, count: 4 },
    { ...PLANES.mosquito, count: 1 },
  ]
  const best = recommendLbas({ stock, targetRadius: 4, target: 'pillbox', evasionOf: noEvasion, bonus: ctx })
  near(best.bonusMultiplier, 1.06 * 1.03)
  assert.deepEqual(best.bonusGroups.map((b) => b.group), ['C2', 'C3'])
  assert.equal(best.slots.filter((s) => s.plane.mstId === 479).length, 1)
  assert.equal(best.slots.filter((s) => s.plane.mstId === 406).length, 3)
  near(best.power, 1738.8 * 1.06 * 1.03, 0.5)

  // 全 C3 那套确实更弱——异组叠乘不是白换的
  const allC3 = recommendLbas({
    stock: [{ ...DO217, count: 4 }],
    targetRadius: 4,
    target: 'pillbox',
    evasionOf: noEvasion,
    bonus: ctx,
  })
  near(allC3.bonusMultiplier, 1.03)
  assert.ok(best.power > allC3.power, '异组叠乘应当胜过单组')
})

test('同组不重复：队里两架 C2 也只乘一次', () => {
  const ctx = ctxFor('E4', 'Z')
  // SM.79 bis(熟練) 与 Mosquito FB Mk.VI 都是 C2
  assert.deepEqual(planeGroupsOf(ctx, 433), ['C2'])
  assert.deepEqual(planeGroupsOf(ctx, 479), ['C2'])
  assert.equal(squadBonusMultiplier(ctx, [433, 479]), 1.06, '两架 C2 不是 1.06²')
  assert.equal(squadBonusMultiplier(ctx, [433, 433, 433, 433]), 1.06, '四架同款也只乘一次')
  // 异组才叠乘
  near(squadBonusMultiplier(ctx, [433, 459]), 1.06 * 1.03)
  // 上游计算例：基地に SM.79 bis(熟練)+B-25 の場合(C2+C3) ≒ 1.09
  near(squadBonusMultiplier(ctx, [433, 459]), 1.0918, 0.0001)
  assert.equal(squadBonusMultiplier(ctx, [388, 187]), 1, '一架特効机都没有就是 1')
  assert.equal(squadBonusMultiplier(null, [433, 459]), 1, '没有上下文就是 1')
})

test('本期 C1 一个点都没有倍率，于是深山系不该被当成特効机', () => {
  for (const event of ['E4', 'E5']) {
    for (const node of ['D', 'S', 'X', 'Z', 'J2', 'P3', 'L1']) {
      const ctx = ctxFor(event, node)
      if (!ctx) continue
      assert.equal(ctx.rates.has('C1'), false, `${event} ${node} 不该有 C1 倍率`)
      assert.deepEqual(planeGroupsOf(ctx, 396), [], '深山改在本期拿不到倍率')
    }
  }
})

test('打不动但带特効的机体也进候选——值不值由枚举算，不在门口替玩家决定', () => {
  const ctx = ctxFor('E5', 'J2')
  // Spitfire Mk.I 是局地戦闘機：雷装爆装都是 0，一点伤害都打不出，但它属 C2
  assert.deepEqual(planeGroupsOf(ctx, 250), ['C2'])
  const stock = [{ ...SM79S, count: 1 }, { ...SPIT1, count: 1 }]
  const best = recommendLbas({ stock, targetRadius: 4, target: 'surface', evasionOf: noEvasion, bonus: ctx })
  assert.ok(best, '应当排得出方案')
  // 只有一架能打的陆攻时，拿第二格塞纯 buff 机是划算的（142.2 → 142.2×1.2）
  assert.equal(best.bonusMultiplier, 1.2)
  const spit = best.slots.find((s) => s.plane.mstId === 250)
  assert.ok(spit, '纯 buff 机应当能被选进来')
  assert.equal(spit.role, 'extender', '打不动的格子标成占位格，不冒充攻击格')
})

// ---- ③ 非活动语境：逐字节 ----

test('非活动语境的推荐与二期逐字节一致（420 组金样本）', () => {
  assert.equal(Object.keys(golden).length, PLAIN_CASES.length)
  assert.equal(PLAIN_CASES.length, 420)
  let checked = 0
  for (const item of PLAIN_CASES) {
    const plan = recommendLbas({
      stock: item.stock,
      targetRadius: item.targetRadius,
      target: item.target,
      evasionOf: item.withEvasion ? rowOf : noEvasion,
    })
    assert.equal(planSignature(plan), golden[item.id], `非活动语境漂移：${item.id}`)
    checked += 1
  }
  assert.equal(checked, 420)
  // 金样本里得真有方案，别哪天矩阵被改成全 null 还一片绿
  assert.equal(Object.values(golden).filter((sig) => sig !== 'null').length, 320)
})

test('显式传 bonus: null 与根本不传，走的是同一条路', () => {
  for (const item of PLAIN_CASES) {
    const plan = recommendLbas({
      stock: item.stock,
      targetRadius: item.targetRadius,
      target: item.target,
      evasionOf: item.withEvasion ? rowOf : noEvasion,
      bonus: null,
    })
    assert.equal(planSignature(plan), golden[item.id], `bonus:null 漂移：${item.id}`)
  }
})

test('非活动语境的方案不带任何特効痕迹', () => {
  const plan = recommendLbas({
    stock: [{ ...PLANES.egusa, count: 4 }, { ...PLANES.mosquito, count: 4 }],
    targetRadius: 7,
    target: 'surface',
    evasionOf: rowOf,
  })
  assert.equal(plan.bonusMultiplier, 1)
  assert.deepEqual(plan.bonusGroups, [])
  assert.equal(plan.plainPower, plan.power, '没有特効时对照数就是它自己')
  assert.equal(plan.approx, false)
})

// ---- ④ scope 认点位 ----

test('scope 分得清「阶段名+点位」与「裸点位清单」', () => {
  // 阶段名不是点位：E5 同时存在阶段 P2 与点位 P2
  assert.equal(scopeApplies('P2 Boss（J2点）', 'J2'), true)
  assert.equal(scopeApplies('P2 Boss（J2点）', 'P2'), false, '阶段 P2 不等于点位 P2')
  // 裸点位清单
  assert.equal(scopeApplies('P3', 'P3'), true)
  assert.equal(scopeApplies('P3', 'P'), false)
  assert.deepEqual([...scopeNodes('K、K1、K2、L').nodes].sort(), ['K', 'K1', 'K2', 'L'])
  // 换行把两种写法混在一格里
  for (const node of ['L1', 'L2', 'S']) {
    assert.equal(scopeApplies('L1、L2\nP3 Boss（S点）', node), true, `${node} 应命中`)
  }
  assert.equal(scopeApplies('L1、L2\nP3 Boss（S点）', 'P3'), false)
  // 前缀不许当命中：ZZ 点的倍率不该发给 Z 点
  assert.equal(scopeApplies('P4 Boss（ZZ点）', 'ZZ'), true)
  assert.equal(scopeApplies('P4 Boss（ZZ点）', 'Z'), false, 'ZZ点 不该被读成 Z点')
  // 全图与空值
  assert.equal(scopeApplies('全图', 'A'), true)
  assert.equal(scopeApplies('全图', null), true)
  assert.equal(scopeApplies('P1 Boss（D点）', null), false)
  assert.equal(scopeApplies('', 'A'), false)
})

test('E5 的陆航特効落在 J2 / P3 / L1 / L2 / S 五个点，别处没有', () => {
  const hit = []
  const nodes = ['A', 'B', 'C', 'C1', 'C2', 'D', 'G', 'J', 'J2', 'K', 'L', 'L1', 'L2', 'P', 'P2', 'P3', 'S', 'T', 'Z', 'ZZ']
  for (const node of nodes) if (ctxFor('E5', node)) hit.push(node)
  assert.deepEqual(hit.sort(), ['J2', 'L1', 'L2', 'P3', 'S'])
  // 点位 C2 与组代号 C2 撞名，但它们不在一个命名空间里——别因为点位叫 C2 就发倍率
  assert.equal(ctxFor('E5', 'C2'), null, '点位 C2 不是组代号 C2')
})

test('E4 的陆航特効落在四个 boss 点，每个都是 C2+C3', () => {
  for (const node of ['D', 'S', 'X', 'Z']) {
    const ctx = ctxFor('E4', node)
    assert.ok(ctx, `E4 的 ${node} 点应有陆航特効`)
    assert.deepEqual([...ctx.rates].sort(), [['C2', 1.06], ['C3', 1.03]])
  }
  assert.equal(ctxFor('E4', 'A'), null, '道中点没有陆航特効')
})
