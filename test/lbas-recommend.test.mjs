// 基地航空「推荐搭配」的护栏。
//
// 2026-08-27 建。这批测试盯的是三件容易在改动中悄悄坏掉的事：
//
//  ① **半径公式**——上游只给了「推定式」，但同一页附了一张实例表（六种侦察机 ×
//     最低半径 1..10 的结果）。那张表在这里逐格当预言机用：公式改错了，实例表会先红。
//     （教训在案：这个公式我一度用转述层取过一次，取回来的句子在原页面里根本不存在。
//      docs/combat-bonus-sources.md 开头写着「不经任何模型转述」，这批数字是原始字节。）
//
//  ② **无档 ≠ 弱档**。上游表里没有的机体是「不减免」(1.0/1.0)，
//     而最低档 △ 是 0.6/1.0——能把敌方加重対空値削掉四成。把没查到当成最低档，
//     会让排序把一件真有减免的机体排到没减免的后面。这条有专门的反例护栏。
//
//  ③ **打不动的机体不许靠排序压下去，要整个排除**。爆装一式戦 隼III型改(65戦隊)
//     的回避档 ◯ 高于绝大多数陸攻，但它雷装 0——対艦向如果只靠「排在后面」，
//     一旦手上强机不够四件它就会浮上来，等于建议玩家派一队不会打船的飞机。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import radiusMod from '../dist/shared/lbas-radius.js'
import recommendMod from '../dist/shared/lbas-recommend.js'
import validation from '../dist/main/lode-validation.js'
import equippedMod from '../dist/shared/equipped-slots.js'

const { squadRadius, slotCapacity, blocksRadiusExtension, RADIUS_BONUS_CAP } = radiusMod
const { recommendLbas, compareCandidates, soloPower, AA_EVASION_RANK } = recommendMod
const { equippedSlotIds } = equippedMod

const PACK = new URL('../assets/lodes/equip-aa-evasion.json', import.meta.url)
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'))
const rowOf = (mstId) => pack.data.find((row) => row.eq_id === mstId) ?? null
const evasionOf = (mstId) => rowOf(mstId)
const noEvasion = () => null

// 主数据实测值（api_mst_slotitem）。t2 = api_type[2]
const P = {
  ichishiki: { mstId: 169, name: '一式陸攻', type2: 47, torpedo: 10, bomb: 12, distance: 9, cost: 12, level: 0, count: 4 },
  nonaka: { mstId: 170, name: '一式陸攻(野中隊)', type2: 47, torpedo: 12, bomb: 13, distance: 9, cost: 12, level: 0, count: 4 },
  ginga: { mstId: 187, name: '銀河', type2: 47, torpedo: 14, bomb: 14, distance: 9, cost: 13, level: 0, count: 4 },
  egusa: { mstId: 388, name: '銀河(江草隊)', type2: 47, torpedo: 15, bomb: 15, distance: 8, cost: 13, level: 0, count: 4 },
  mosquito: { mstId: 479, name: 'Mosquito FB Mk.VI', type2: 47, torpedo: 5, bomb: 18, distance: 7, cost: 14, level: 0, count: 4 },
  ki102: { mstId: 453, name: 'キ102乙', type2: 47, torpedo: 11, bomb: 19, distance: 4, cost: 9, level: 0, count: 4 },
  hayabusa65: { mstId: 224, name: '爆装一式戦 隼III型改(65戦隊)', type2: 47, torpedo: 0, bomb: 9, distance: 5, cost: 4, level: 0, count: 4 },
  daitei: { mstId: 138, name: '二式大艇', type2: 41, torpedo: 0, bomb: 0, distance: 20, cost: 25, level: 0, count: 1 },
  catalina: { mstId: 178, name: 'PBY-5A Catalina', type2: 41, torpedo: 0, bomb: 0, distance: 10, cost: 13, level: 0, count: 1 },
  rikutei: { mstId: 311, name: '二式陸上偵察機', type2: 49, torpedo: 0, bomb: 0, distance: 8, cost: 7, level: 0, count: 1 },
  miyama: { mstId: 396, name: '深山改', type2: 53, torpedo: 17, bomb: 19, distance: 11, cost: 21, level: 0, count: 1 },
}
const stockOf = (...entries) => entries.map(([plane, count]) => ({ ...plane, count }))
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `期望 ${b}，实得 ${a}`)

// ---- ① 半径：上游实例表逐格当预言机 ----

test('半径延伸复现上游那张实例表（六种侦察机 × 最低半径）', () => {
  // 行 = [侦察机半径, 各最低半径 1.. 对应的出击可能范围]
  // 原表：二式大艇20 / PBY-5A Catalina10 / 二式陸偵(熟練)·Mosquito PR9 / 二式陸偵8 / 彩雲系8 / 零式水偵7
  const table = [
    [20, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]],
    [10, [4, 5, 6, 6, 7, 8, 9, 9, 10]],
    [9, [4, 5, 5, 6, 7, 8, 8, 9]],
    [8, [4, 4, 5, 6, 7, 7, 8]],
    [7, [3, 4, 5, 6, 6, 7]],
  ]
  for (const [reconDistance, expected] of table) {
    expected.forEach((want, index) => {
      const min = index + 1
      const got = squadRadius([
        { type2: 41, distance: reconDistance, mstId: 138 },
        { type2: 47, distance: min, mstId: 169 },
      ])
      assert.equal(
        got,
        want,
        `侦察机半径 ${reconDistance} + 最低半径 ${min} 应得 ${want}，实得 ${got}`,
      )
    })
  }
})

test('没有侦察机就是各格最小值，加成上限是 3', () => {
  assert.equal(squadRadius([{ type2: 47, distance: 9 }, { type2: 47, distance: 4 }]), 4)
  // 二式大艇(20) 配半径 1 的机体：√19≈4.36 会超上限，压回 +3
  assert.equal(squadRadius([{ type2: 41, distance: 20 }, { type2: 47, distance: 1 }]), 1 + RADIUS_BONUS_CAP)
  // 0 机的格子不参与（原文：0機になっている中隊は除外される）
  assert.equal(
    squadRadius([{ type2: 47, distance: 9, count: 18 }, { type2: 47, distance: 3, count: 0 }]),
    9,
  )
})

test('回転翼機/対潜哨戒機 让整队延伸失效，但原文点名的两件例外不算', () => {
  // 上游脚注 *3 的原话实例：半径1の秋水と半径2のS-51がある場合、
  // 偵察機を配備しても半径2止まりにすらならず半径1のままとなる
  const shusui = { type2: 48, distance: 1, mstId: 352 }
  const s51j = { type2: 25, distance: 2, mstId: 326 }
  assert.equal(squadRadius([shusui, s51j, { type2: 41, distance: 20, mstId: 138 }]), 1)
  // 例外：一式戦 隼II型改(20戦隊) 489 / 隼III型改(熟練/20戦隊) 491 不使延伸失效
  assert.equal(blocksRadiusExtension({ type2: 26, distance: 4, mstId: 489 }), false)
  assert.equal(blocksRadiusExtension({ type2: 26, distance: 4, mstId: 491 }), false)
  assert.equal(blocksRadiusExtension({ type2: 26, distance: 2, mstId: 70 }), true)
  assert.equal(blocksRadiusExtension({ type2: 25, distance: 1, mstId: 69 }), true)
  // 東海是 api_type[2]=47 陸上攻撃機，**不是**対潜哨戒機——它不让延伸失效
  assert.equal(blocksRadiusExtension({ type2: 47, distance: 8, mstId: 270 }), false)
})

test('中队定数：通常18 / 大型陸上機9 / 偵察機系4', () => {
  assert.equal(slotCapacity(47), 18, '陸上攻撃機')
  assert.equal(slotCapacity(48), 18, '局地戦闘機')
  assert.equal(slotCapacity(53), 9, '大型陸上機（深山）')
  assert.equal(slotCapacity(41), 4, '大型飛行艇（二式大艇）')
  assert.equal(slotCapacity(49), 4, '陸上偵察機')
  assert.equal(slotCapacity(9), 4, '艦上偵察機')
  assert.equal(slotCapacity(10), 4, '水上偵察機')
})

// ---- ④ 档表本身 ----

test('对空射击回避档表能过校验，且出处结构齐全', () => {
  const verdict = validation.validateLodePack(pack)
  assert.ok(verdict.ok, `档表没过 schema 校验：${verdict.error}`)
  assert.ok(pack.data.length >= 40, `只剩 ${pack.data.length} 条，像是被截断了`)
  for (const key of ['id', 'name', 'version', 'source', 'fetchedAt', 'license', 'note']) {
    assert.ok(pack.meta[key], `meta 缺 ${key}`)
  }
  assert.ok(Array.isArray(pack.meta.maintainerNote), 'maintainerNote 应是数组')
  // 玩家可见的 note 只放一两句人话，考古归 maintainerNote
  assert.ok(pack.meta.note.length <= 40, `note 太长（${pack.meta.note.length} 字），考古该进 maintainerNote`)
  // 每条都要说得出置信度，且整表是单源——别哪天被悄悄改成「交叉核对」
  for (const row of pack.data) {
    assert.ok(row.basis && row.basis.includes('单源'), `${row.eq_id} 的 basis 没标单源：${row.basis}`)
  }
  assert.ok(
    pack.meta.upstreamUpdatedAt,
    'upstreamUpdatedAt 是判断这张表新不新的唯一依据，不许空着',
  )
})

test('档位符号的高低次序是 ❀ > ☆ > ◎ > ◯ > △，无档记 0', () => {
  assert.ok(
    AA_EVASION_RANK['❀'] > AA_EVASION_RANK['☆'] &&
      AA_EVASION_RANK['☆'] > AA_EVASION_RANK['◎'] &&
      AA_EVASION_RANK['◎'] > AA_EVASION_RANK['◯'] &&
      AA_EVASION_RANK['◯'] > AA_EVASION_RANK['△'],
    '档位次序与上游原文不符',
  )
  assert.equal(AA_EVASION_RANK['无档'], undefined, '无档不该在档位表里占一档')
  assert.ok(AA_EVASION_RANK['△'] > 0, '△ 必须严格高于无档（无档 = 0）')
})

// ---- ② 排序：回避档 → 威力 → 耗铝 ----

test('排序第一顺位是回避档：有档的排在无档的前面，哪怕无档那件更能打', () => {
  // 銀河(187) 雷装14、无档；一式陸攻(野中隊)(170) 雷装12、△ 档
  // 野中隊必须排前面——△ 是 0.6/1.0，真能把敌方加重対空値削掉四成，不是「没有」
  const cmp = compareCandidates(P.nonaka, P.ginga, 'surface', evasionOf)
  assert.ok(cmp < 0, '有档的野中隊应排在无档的銀河之前')
  assert.ok(soloPower(P.ginga, 'surface') > soloPower(P.nonaka, 'surface'), '前提：銀河确实更能打')
})

test('同档位比威力，同档同威力比耗铝（低者优先）', () => {
  const strong = { ...P.nonaka, mstId: 9001, torpedo: 20 }
  const weak = { ...P.nonaka, mstId: 9002, torpedo: 10 }
  const evasionBoth = (id) => (id === 9001 || id === 9002 ? rowOf(170) : null)
  assert.ok(compareCandidates(strong, weak, 'surface', evasionBoth) < 0, '同档应是威力高者优先')

  const cheap = { ...P.nonaka, mstId: 9003, cost: 5 }
  const dear = { ...P.nonaka, mstId: 9004, cost: 20 }
  const evasionSame = (id) => (id === 9003 || id === 9004 ? rowOf(170) : null)
  assert.ok(
    compareCandidates(cheap, dear, 'surface', evasionSame) < 0,
    '同档同威力时耗铝低者优先',
  )
})

// ---- ③ 半径够 / 不够 ----

test('半径够得着时四格全是攻击机，一格都不让给侦察机', () => {
  const plan = recommendLbas({
    stock: stockOf([P.nonaka, 4], [P.egusa, 4], [P.daitei, 1]),
    targetRadius: 8,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan, '应能排出方案')
  assert.equal(plan.slots.length, 4)
  assert.equal(plan.usedExtender, false, '够得着就不该占格放大艇')
  assert.ok(plan.reaches)
  assert.ok(plan.slots.every((slot) => slot.role === 'attacker'))
})

test('半径不够时自动插一格大艇，剩三格攻击机，且真的够得着', () => {
  // キ102乙 半径只有 4，目标点要 7；二式大艇(20) 进来后 4 + min(3,√16)= 7
  const plan = recommendLbas({
    stock: stockOf([P.ki102, 4], [P.daitei, 1]),
    targetRadius: 7,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan, '应能靠大艇够到')
  assert.equal(plan.usedExtender, true)
  assert.equal(plan.slots[0].role, 'extender')
  assert.equal(plan.slots[0].plane.mstId, 138, '延伸那格应是二式大艇')
  assert.equal(plan.slots.filter((slot) => slot.role === 'attacker').length, 3)
  assert.ok(plan.reaches && plan.radius >= 7, `半径应≥7，实得 ${plan.radius}`)
})

test('怎么配都够不着就返回 null，不给一个到不了的方案', () => {
  const plan = recommendLbas({
    stock: stockOf([P.ki102, 4]),
    targetRadius: 12,
    target: 'surface',
    evasionOf,
  })
  assert.equal(plan, null, '够不着时不该编一个方案出来')
})

// ---- ⑤ 持有数、无档标注、打不动的机体 ----

test('同款不会推荐超过持有数', () => {
  const plan = recommendLbas({
    stock: stockOf([P.egusa, 1], [P.nonaka, 5]),
    targetRadius: 8,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan)
  const ids = plan.slots.map((slot) => slot.plane.mstId)
  assert.equal(ids.filter((id) => id === 388).length, 1, '江草隊只有 1 件，不该推荐 2 件')
  assert.equal(ids.filter((id) => id === 170).length, 3)
})

test('手上不够四件时如实少给几格，不拿凑数的顶上', () => {
  const plan = recommendLbas({
    stock: stockOf([P.egusa, 2]),
    targetRadius: 8,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan)
  assert.equal(plan.slots.length, 2, '只有两件就只排两格')
})

test('无档机体标成无档（null），不冒充最低档', () => {
  const plan = recommendLbas({
    stock: stockOf([P.ginga, 4]),
    targetRadius: 9,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan)
  for (const slot of plan.slots) {
    assert.equal(slot.tier, null, '銀河(无印)不在上游表里，应标无档')
    assert.equal(slot.tierRank, 0)
    assert.equal(slot.weightedAa, null, '无档不该编一个补正值出来')
  }
})

test('本次口径下打不动的机体整个排除，不靠排序压下去', () => {
  // 爆装一式戦 隼III型改(65戦隊)：回避档 ◯（高于野中隊的 △），但雷装 0
  assert.equal(rowOf(224).tier, '◯', '前提：它的档位确实更高')
  const plan = recommendLbas({
    stock: stockOf([P.hayabusa65, 4], [P.nonaka, 1]),
    targetRadius: 5,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan)
  assert.ok(
    plan.slots.every((slot) => slot.plane.mstId !== 224),
    '対艦向不该推荐雷装 0 的机体，哪怕它回避档更高',
  )
  // 対地向它能打（爆装 9），就该出现
  const land = recommendLbas({
    stock: stockOf([P.hayabusa65, 4]),
    targetRadius: 5,
    target: 'land',
    evasionOf,
  })
  assert.ok(land && land.slots.some((slot) => slot.plane.mstId === 224), '対地向应该用得上它')
})

test('深海装备（无半径无配置消耗）不会混进推荐', () => {
  const abyssal = {
    mstId: 1630, name: '深海空超要塞', type2: 47,
    torpedo: 0, bomb: 33, distance: undefined, cost: undefined, level: 0, count: 9,
  }
  const plan = recommendLbas({
    stock: [abyssal, ...stockOf([P.nonaka, 4])],
    targetRadius: 9,
    target: 'land',
    evasionOf,
  })
  assert.ok(plan)
  assert.ok(plan.slots.every((slot) => slot.plane.mstId !== 1630), '深海装备不该进推荐')
})

test('缺档表时推荐仍然出得来，只是退成按威力与耗铝排', () => {
  const plan = recommendLbas({
    stock: stockOf([P.nonaka, 4], [P.egusa, 4]),
    targetRadius: 8,
    target: 'surface',
    evasionOf: noEvasion,
  })
  assert.ok(plan, '没有档表也要能给建议')
  assert.equal(plan.slots[0].plane.mstId, 388, '无档表时应按威力排，江草隊最强')
  assert.ok(plan.slots.every((slot) => slot.tier === null))
})

test('耗铝按「配置消耗 × 中队定数」逐格算', () => {
  const plan = recommendLbas({
    stock: stockOf([P.ki102, 4], [P.daitei, 1]),
    targetRadius: 7,
    target: 'surface',
    evasionOf,
  })
  assert.ok(plan)
  const daitei = plan.slots.find((slot) => slot.plane.mstId === 138)
  assert.equal(daitei.capacity, 4, '大艇是偵察機系，一格 4 机')
  assert.equal(daitei.bauxite, 25 * 4, '二式大艇配置耗铝 = 25 × 4')
  const ki = plan.slots.find((slot) => slot.plane.mstId === 453)
  assert.equal(ki.bauxite, 9 * 18, 'キ102乙 = 9 × 18')
  assert.equal(
    plan.bauxite,
    plan.slots.reduce((sum, slot) => sum + slot.bauxite, 0),
    '整队耗铝应等于逐格之和',
  )
})

// ---- 「现在有几件能动用」的判据 ----

test('装在舰上或别的基地的装备不算可动用', () => {
  const ships = [
    { slot: [11, 12, 0, 0], slotEx: 13 },
    { slot: [14, 0, 0, 0], slotEx: 0 },
  ]
  const airBases = [{ planes: [{ slotId: 21 }, { slotId: 0 }, { slotId: 22 }, { slotId: 0 }] }]
  const busy = equippedSlotIds(ships, airBases)
  assert.deepEqual([...busy].sort((a, b) => a - b), [11, 12, 13, 14, 21, 22])
  assert.ok(!busy.has(99), '没被占的实例不该在里面')
  // 陆航那一半漏掉是这条判据最危险的错法
  assert.ok(busy.has(21) && busy.has(22), '基地航空队里的机体必须算作已占用')
})

// ---- ⑦ 二期：威力按「机种 × 目标类型」算，排序次序本身没动 ----

test('同一批机体在不同目标类型下排出来的名次会真的换位', () => {
  // Mosquito(爆装18/雷装5) 与 銀河(江草隊)(爆装15/雷装15)：
  // 対水上艦看雷装，銀河远胜；対陆上型看爆装，Mosquito 反超。
  // 一期只分「雷装 or 爆装」时这一条就成立，二期要保证特効层没把它弄反。
  assert.ok(soloPower(P.egusa, 'surface') > soloPower(P.mosquito, 'surface'))
  for (const t of ['land', 'pillbox', 'isolated', 'supply']) {
    assert.ok(
      soloPower(P.mosquito, t) > soloPower(P.egusa, t),
      `対${t} 应当是 Mosquito 更能打`,
    )
  }
})

test('具名陆上型的有效威力远高于「陆上型（无具名特効）」——特効确实进了排序用的那个数', () => {
  const plain = soloPower(P.ichishiki, 'land')
  // 上游三张比較表的一式陸攻那一行：砲台331.2 / 離島268.2 / 集積地460.8
  near(soloPower(P.ichishiki, 'pillbox'), 331.2)
  near(soloPower(P.ichishiki, 'isolated'), 268.2)
  near(soloPower(P.ichishiki, 'supply'), 460.8)
  for (const t of ['pillbox', 'isolated', 'supply']) {
    assert.ok(soloPower(P.ichishiki, t) > plain, `${t} 应高于无具名特効档`)
  }
})

test('雷装机对陆上型一律出不了力，四类陆上目标都要挡住', () => {
  // 深山改 爆装19 打得动；假造一个只有雷装的陆攻则四类全 0
  const torpedoOnly = { ...P.nonaka, bomb: 0 }
  assert.ok(soloPower(torpedoOnly, 'surface') > 0)
  for (const t of ['land', 'pillbox', 'isolated', 'supply']) {
    assert.equal(soloPower(torpedoOnly, t), 0, `対${t} 应当为 0`)
  }
  // 而且它在対陆推荐里应当被整个排除，不是排在末尾
  const plan = recommendLbas({
    stock: stockOf([torpedoOnly, 4], [P.mosquito, 4]),
    targetRadius: null,
    target: 'pillbox',
    evasionOf: noEvasion,
  })
  assert.ok(plan)
  for (const slot of plan.slots) {
    assert.notEqual(slot.plane.mstId, torpedoOnly.mstId, '打不动的机体不该出现在対陆推荐里')
  }
})

test('推荐排序仍是「回避档 → 有效威力 → 耗铝」三级，威力换算法没动次序', () => {
  // Mosquito 是 ◯ 档、銀河(江草隊) 是 △ 档。対水上艦时 Mosquito 威力只有銀河的一半上下，
  // 但档位高一级——按用户定死的次序，Mosquito 仍应排在前面。
  assert.equal(rowOf(P.mosquito.mstId).tier, '◯')
  assert.equal(rowOf(P.egusa.mstId).tier, '△')
  assert.ok(soloPower(P.mosquito, 'surface') < soloPower(P.egusa, 'surface'), '前提：対艦时銀河更能打')
  assert.ok(
    compareCandidates(P.mosquito, P.egusa, 'surface', evasionOf) < 0,
    '档位是第一顺位，威力低也要排前面',
  )
  // 対砲台小鬼时两条规则同向，更该排前面
  assert.ok(soloPower(P.mosquito, 'pillbox') > soloPower(P.egusa, 'pillbox'))
  assert.ok(compareCandidates(P.mosquito, P.egusa, 'pillbox', evasionOf) < 0)
})

test('每一格都带得出威力拆解，且拆解与该格威力同源', () => {
  const plan = recommendLbas({
    stock: stockOf([P.ichishiki, 4]),
    targetRadius: null,
    target: 'pillbox',
    evasionOf,
  })
  assert.ok(plan)
  for (const slot of plan.slots) {
    assert.ok(slot.detail, '每格都要有拆解')
    assert.ok(slot.detail.base > 0)
    // 拆解里的最终值 = 该格单飞的有效威力（队里没有陆侦时与本格贡献一致）
    near(slot.detail.power, soloPower(slot.plane, 'pillbox'))
    assert.equal(slot.detail.gotBombBonus, 1.55, '陆攻対砲台小鬼应拿到爆撃特効')
  }
})
