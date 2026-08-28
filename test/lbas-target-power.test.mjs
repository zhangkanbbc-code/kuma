import assert from 'node:assert/strict'
import test from 'node:test'

import tp from '../dist/shared/lbas-target-power.js'

const {
  LBAS_LAND_POWER_CAP,
  LBAS_TARGET_LABEL,
  earnsBombBonus,
  squadronPower,
  squadronPowerDetail,
  usesBombStat,
} = tp

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `期望 ${b}，实得 ${a}`)

// 机种号：47 陸上攻撃機 / 7 艦上爆撃機 / 8 艦上攻撃機 / 53 大型陸上機 / 11 水爆 / 57 噴式戦闘爆撃機
const rikkou = (bomb, over = {}) => ({ type2: 47, torpedo: 0, bomb, level: 0, count: 18, ...over })
const kanbaku = (bomb, over = {}) => ({ type2: 7, torpedo: 0, bomb, level: 0, count: 18, ...over })

// ─────────────────────────────────────────────────────────────────────
// wikiwiki「基地航空隊」自带的三张「攻撃力比較表」（18機・クリティカル/触接無し）
// 逐格当预言机。42 格全部来自上游页面原文，一个数都没算过。
// 这批预言机同时钉死了三件事：特効值、下取整的位置、キャップ值。
// ─────────────────────────────────────────────────────────────────────

/** 対砲台小鬼：基地航空特効 ×1.6（cap 前）、爆撃特効 ×1.55（cap 後） */
const PILLBOX_RIKKOU = [
  [24, 437.4], [22, 433.8], [20, 432], [16, 412.2], [15, 392.4], [14, 372.6],
  [13, 351], [12, 331.2], [11, 311.4], [10, 289.8], [8, 250.2],
]
const PILLBOX_KANBAKU = [[13, 235], [11, 217], [10, 203]]

/** 対離島棲姫：基地航空特効 ×1.18（cap 前）、爆撃特効 ×1.7（cap 後） */
const ISOLATED_RIKKOU = [
  [24, 460.8], [22, 430.2], [20, 399.6], [16, 333], [15, 316.8], [14, 298.8],
  [13, 284.4], [12, 268.2], [11, 250.2], [10, 234], [8, 201.6],
]
const ISOLATED_KANBAKU = [[13, 197], [11, 175], [10, 163]]

/** 対集積地棲姫：基地航空特効 **+100（加算）**、爆撃特効 ×2.1，两者都在 cap 後 */
const SUPPLY_RIKKOU = [
  [24, 667.8], [22, 633.6], [20, 599.4], [16, 531], [15, 513], [14, 495],
  [13, 478.8], [12, 460.8], [11, 444.6], [10, 426.6], [8, 392.4],
]
const SUPPLY_KANBAKU = [[13, 307], [11, 283], [10, 272]]

const ORACLE = [
  ['pillbox', PILLBOX_RIKKOU, PILLBOX_KANBAKU],
  ['isolated', ISOLATED_RIKKOU, ISOLATED_KANBAKU],
  ['supply', SUPPLY_RIKKOU, SUPPLY_KANBAKU],
]

for (const [target, rikkouRows, kanbakuRows] of ORACLE) {
  test(`対${LBAS_TARGET_LABEL[target]}：上游攻撃力比較表逐格对上（陸攻 ${rikkouRows.length} 格）`, () => {
    for (const [bomb, want] of rikkouRows) {
      near(squadronPower({ plane: rikkou(bomb), target }), want)
    }
  })
  test(`対${LBAS_TARGET_LABEL[target]}：艦上爆撃機那一节也逐格对上（${kanbakuRows.length} 格）`, () => {
    for (const [bomb, want] of kanbakuRows) {
      near(squadronPower({ plane: kanbaku(bomb), target }), want)
    }
  })
}

// ─────────────────────────────────────────────────────────────────────
// 対水上艦：同页「最終攻撃力比較表」16 格。
// 这一张钉的是 **floor(基本攻撃力) 之后才乘陸攻補正** ——一期漏了这个下取整，
// 所以一期显示的 Mosquito 是 77（未取整 76.98），上游表写的是 75.6。
// ─────────────────────────────────────────────────────────────────────

test('対水上艦：上游最終攻撃力比較表 16 格逐格对上（含下取整位置）', () => {
  // 陸攻（種別倍率0.8・搭載数18・陸攻補正1.8）
  const LA = [[15, 158.4], [14, 149.4], [13, 142.2], [12, 133.2], [11, 126], [10, 117], [9, 108], [8, 100.8]]
  for (const [torpedo, want] of LA) {
    near(squadronPower({ plane: rikkou(0, { torpedo }), target: 'surface' }), want)
  }
  // 大型陸上機（搭載数補正 1.0・搭載数 9・不吃陸攻補正）
  near(squadronPower({ plane: { type2: 53, torpedo: 17, bomb: 0, level: 0, count: 9 }, target: 'surface' }), 76)
  near(squadronPower({ plane: { type2: 53, torpedo: 16, bomb: 0, level: 0, count: 9 }, target: 'surface' }), 73)
  // 艦攻・艦爆（種別倍率1.0・搭載数18・不吃陸攻補正）
  const CV = [[15, 110], [14, 104], [13, 98], [11, 87], [10, 81]]
  for (const [torpedo, want] of CV) {
    near(squadronPower({ plane: { type2: 8, torpedo, bomb: 0, level: 0, count: 18 }, target: 'surface' }), want)
  }
})

// ─────────────────────────────────────────────────────────────────────
// 机制性护栏
// ─────────────────────────────────────────────────────────────────────

test('打水上舰用雷装、打陆上型用爆装——只有雷装的陆攻对陆上型出不了力', () => {
  assert.equal(usesBombStat('surface'), false)
  for (const t of ['land', 'pillbox', 'isolated', 'supply']) assert.equal(usesBombStat(t), true)
  // 雷装12/爆装0 的陆攻：对舰打得动，对陆四类一律 0
  const torpedoOnly = rikkou(0, { torpedo: 12 })
  assert.ok(squadronPower({ plane: torpedoOnly, target: 'surface' }) > 0)
  for (const t of ['land', 'pillbox', 'isolated', 'supply']) {
    assert.equal(squadronPower({ plane: torpedoOnly, target: t }), 0, `対${t} 应当为 0`)
  }
})

test('爆撃特効只给艦爆与陸攻——水爆/噴式是上游自标的「未検証」，不给', () => {
  assert.equal(earnsBombBonus(7), true) // 艦上爆撃機
  assert.equal(earnsBombBonus(47), true) // 陸上攻撃機
  assert.equal(earnsBombBonus(11), false) // 水上爆撃機：原文「未検証」
  assert.equal(earnsBombBonus(57), false) // 噴式戦闘爆撃機：同上
  assert.equal(earnsBombBonus(8), false) // 艦上攻撃機本来就不是爆撃機
  // 同样爆装的水爆拿不到 ×1.55，威力必定低于艦爆
  const suibaku = { type2: 11, torpedo: 0, bomb: 10, level: 0, count: 18 }
  const bomber = kanbaku(10)
  assert.ok(
    squadronPower({ plane: suibaku, target: 'pillbox' }) <
      squadronPower({ plane: bomber, target: 'pillbox' }),
  )
})

test('集積地棲姫的基地航空特効是加算 +100，不是乘算', () => {
  // 爆装0 会被 planeBasePower 的「打不动」闸挡掉，所以用一个低爆装机体反推：
  // 基本 = 1×(1×√32.4+25) = 30.692 → ⌊30.692×2.1+100⌋ = ⌊164.45⌋ = 164
  const d = squadronPowerDetail({ plane: kanbaku(1), target: 'supply' })
  near(d.power, 164)
  // 若把 +100 误写成乘算，这个数会掉到 64 上下；若整项漏掉则是 64
  assert.ok(d.power > 100, '加算项没有生效')
})

test('砲台小鬼与離島棲姫的补正位置不同：同一架机体两边名次可以反过来', () => {
  // 低爆装时 砲台(×1.6×1.55=2.48) 明显强于 離島(×1.18×1.7=2.006)
  const low = rikkou(10)
  assert.ok(
    squadronPower({ plane: low, target: 'pillbox' }) >
      squadronPower({ plane: low, target: 'isolated' }),
  )
  // 高爆装时砲台先触顶被压平，離島反而反超——上游表里 Do 217 K-2 正是这样
  const high = rikkou(24)
  assert.ok(
    squadronPower({ plane: high, target: 'pillbox' }) <
      squadronPower({ plane: high, target: 'isolated' }),
    '高爆装下 対離島 应当反超 対砲台（cap 位置不同导致）',
  )
})

test('キャップ 150：低爆装不触顶、高爆装触顶且按开方压缩', () => {
  assert.equal(LBAS_LAND_POWER_CAP, 150)
  // 爆装15 的陸攻 対砲台：基本88.30 ×1.6 = 141.29 < 150，不触顶
  assert.equal(squadronPowerDetail({ plane: rikkou(15), target: 'pillbox' }).capped, false)
  // 爆装16：92.86×1.6 = 148.57 仍不触顶
  assert.equal(squadronPowerDetail({ plane: rikkou(16), target: 'pillbox' }).capped, false)
  // 爆装20：111.07×1.6 = 177.7 触顶 → 150+√27.7 = 155.26
  const d = squadronPowerDetail({ plane: rikkou(20), target: 'pillbox' })
  assert.equal(d.capped, true)
  assert.equal(d.afterAirBonus, 155)
})

test('陸偵補正的位置：対水上艦在下取整之内、対地在下取整之外', () => {
  const p = rikkou(12, { torpedo: 12 })
  // 対水上艦：⌊基本×1.15⌋×1.8。基本 = 0.8×(12×√32.4+25) = 74.6437 → ⌊85.84⌋ = 85 → 153
  near(squadronPower({ plane: p, target: 'surface', reconBonus: 1.15 }), 85 * 1.8)
  // 対地：⌊…⌋ 之后才乘 1.15，所以是 331.2×1.15
  near(squadronPower({ plane: p, target: 'pillbox', reconBonus: 1.15 }), 331.2 * 1.15)
})

test('陸攻補正 ×1.8 只给陸攻；敌联合 ×1.1 加在末尾', () => {
  const la = rikkou(12)
  const cb = kanbaku(12)
  // 同爆装下陸攻比艦爆高，正是 0.8×1.8 = 1.44 与 1.0 的差
  const plain = squadronPower({ plane: la, target: 'pillbox' })
  const combined = squadronPower({ plane: la, target: 'pillbox', enemyCombined: true })
  near(combined, plain * 1.1)
  near(squadronPower({ plane: cb, target: 'pillbox', enemyCombined: true }),
    squadronPower({ plane: cb, target: 'pillbox' }) * 1.1)
})

test('无具名特効的陆上型走 land：不加特効，但仍用爆装且仍吃陸攻補正', () => {
  const la = rikkou(12)
  const d = squadronPowerDetail({ plane: la, target: 'land' })
  // ⌊74.6437⌋ = 74 → ×1.8 = 133.2
  near(d.power, 74 * 1.8)
  assert.equal(d.gotBombBonus, 1)
  // 一定低于任何一类具名特效
  for (const t of ['pillbox', 'isolated', 'supply']) {
    assert.ok(d.power < squadronPower({ plane: la, target: t }), `land 应低于 ${t}`)
  }
})

test('同一份输入两次结果相同——概率项一律不假定发动', () => {
  const input = { plane: rikkou(12), target: 'pillbox', enemyCombined: true }
  assert.equal(squadronPower(input), squadronPower(input))
})
