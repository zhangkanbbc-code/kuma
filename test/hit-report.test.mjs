// 编队被弹演出的战报归因（交接包「编队被弹与特色入渠动画」v2，维护者 2026-11-27 定稿）：
// analyzeShipHitReport(battle, rosterId, { stypeOf, slotTypeOf, targetStype, drop }) → 这艘舰刚挨的每一击，
// 分进 shellHits / torpHits / aswHits，按伤害占比给编队行挑演出（弹孔 / 鱼雷倾侧进水 / 反潜深弹）。
// 判据：只看敌方（side 1）出手且排除友军夜战段；默认只取最新的昼 / 夜段，对不满这次掉血就往前多取一段；
// 一击是什么打的走动画复盘同一份 attackWeaponOf；航空阶段看 hits[].airKind；对不上就按掉血兜底成一发。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const load = () => {
  const file = path.join(ROOT, 'dist', 'shared', 'hit-report.js')
  assert.ok(fs.existsSync(file), '缺少 src/shared/hit-report.ts（构建后在 dist/shared/hit-report.js）')
  return require(file)
}

// 敌方 mstId → 舰种：1501 驱逐（2）、1530 潜水（13）、1510 空母（11）；装备 mstId → 分类：1 主炮（1）、2 鱼雷（5）
const STYPE = { 1501: 2, 1530: 13, 1510: 11, 900: 2, 901: 13 }
const SLOT = { 1: 1, 2: 5 }
const opts = (drop, targetStype = 2) => ({
  stypeOf: (mstId) => STYPE[mstId] ?? null,
  slotTypeOf: (mstId) => SLOT[mstId] ?? null,
  targetStype,
  drop,
})
let stageSeq = 0
const atk = (phase, hits, extra = {}) => ({ phase, side: 1, attacker: 0, stage: ++stageSeq, action: 0, ciKind: null, ciType: null, hits, ...extra })
const hit = (target, damage, extra = {}) => ({ target, damage, ...extra })
const battle = (attacks) => ({
  fShips: [{ index: 0, rosterId: 501 }, { index: 1, rosterId: 502 }],
  eShips: [{ index: 0, mstId: 1501 }, { index: 1, mstId: 1530 }, { index: 2, mstId: 1510 }],
  attacks,
})

test('逐击分类：炮击、闭幕雷击、潜艇夜战出手、夜战炮雷并用、航空雷击 / 爆击 / 雷爆同中', () => {
  const { analyzeShipHitReport } = load()
  const b = battle([
    atk('gun1', [hit(0, 8)]),
    atk('torp', [hit(0, 12)]),
    atk('air', [hit(0, 6, { airKind: 'torpedo' }), hit(0, 4, { airKind: 'bomb' })], { attacker: -1 }),
    atk('air2', [hit(0, 10, { airKind: 'both' })], { attacker: -1 }),
    atk('night', [hit(0, 9)], { attacker: 1 }),
    atk('night', [hit(0, 14)], { equipmentMstIds: [1, 2] }),
  ])
  const r = analyzeShipHitReport(b, 501, opts({ before: 80, after: 17 }))
  assert.deepEqual(r.shellHits, [8, 4, 5, 7])
  assert.deepEqual(r.torpHits, [12, 6, 5, 9, 7])
  assert.deepEqual(r.aswHits, [])
  assert.equal(r.totalDmg, 63)
  assert.equal(r.fallback, false)
})

test('受击方是潜水舰：每一击都按反潜算（深弹、航空反潜），不分炮雷', () => {
  const { analyzeShipHitReport } = load()
  const b = battle([atk('openingAsw', [hit(1, 5)]), atk('gun1', [hit(1, 7)]), atk('air', [hit(1, 3, { airKind: 'bomb' })], { attacker: -1 })])
  const r = analyzeShipHitReport(b, 502, opts({ before: 24, after: 9 }, 13))
  assert.deepEqual(r.aswHits, [5, 7, 3])
  assert.deepEqual([r.shellHits, r.torpHits], [[], []])
  assert.equal(r.dominant, 'asw')
})

test('只看敌方出手：我方打出去的不算；友军夜战段里敌方打的是 NPC 友军，同舰位也不算到我方头上', () => {
  const { analyzeShipHitReport } = load()
  const b = battle([
    atk('gun1', [hit(0, 30)], { side: 0 }),
    atk('friendly', [hit(0, 40)]),
    atk('night', [hit(0, 6)]),
  ])
  const r = analyzeShipHitReport(b, 501, opts({ before: 40, after: 34 }))
  assert.deepEqual(r.shellHits, [6])
  assert.equal(r.totalDmg, 6)
})

test('分段：默认只取最新的昼 / 夜段；这一段对不满这次掉血（昼夜一起到）就往前多取一段', () => {
  const { analyzeShipHitReport } = load()
  const b = battle([atk('gun1', [hit(0, 10)]), atk('torp', [hit(0, 12)]), atk('night', [hit(0, 7)])])
  assert.deepEqual(analyzeShipHitReport(b, 501, opts({ before: 30, after: 23 })).shellHits, [7], '夜战那一下：只算夜战段')
  const both = analyzeShipHitReport(b, 501, opts({ before: 52, after: 23 }))
  assert.deepEqual([both.shellHits, both.torpHits], [[10, 7], [12]], '面板没跟上、昼夜一起到：两段都算')
})

test('占比与主导：炮雷各按伤害算占比，任一边 ≥ 70% 算主导，否则混合', () => {
  const { analyzeShipHitReport } = load()
  const r1 = analyzeShipHitReport(battle([atk('gun1', [hit(0, 30)]), atk('torp', [hit(0, 10)])]), 501, opts({ before: 50, after: 10 }))
  assert.equal(r1.shellRatio, 0.75)
  assert.equal(r1.dominant, 'shell')
  const r2 = analyzeShipHitReport(battle([atk('gun1', [hit(0, 18)]), atk('torp', [hit(0, 22)])]), 501, opts({ before: 50, after: 10 }))
  assert.equal(r2.dominant, 'mixed')
  const r3 = analyzeShipHitReport(battle([atk('openingTorp', [hit(0, 35)]), atk('gun2', [hit(0, 5)])]), 501, opts({ before: 50, after: 10 }))
  assert.equal(r3.dominant, 'torp')
})

test('兜底：没有战斗、找不到这艘、没有对上有伤害的命中 → 按这次掉血算一发（潜水舰一发反潜），不抛错', () => {
  const { analyzeShipHitReport } = load()
  const drop = { before: 40, after: 28 }
  for (const b of [null, undefined, battle([]), battle([atk('gun1', [hit(1, 9)])]), battle([atk('gun1', [hit(0, 0)])])]) {
    const r = analyzeShipHitReport(b, 501, opts(drop))
    assert.deepEqual([r.shellHits, r.torpHits, r.aswHits, r.fallback], [[12], [], [], true])
  }
  assert.deepEqual(analyzeShipHitReport(battle([atk('gun1', [hit(0, 9)])]), 999, opts(drop)).shellHits, [12], '编成里没有这艘')
  assert.deepEqual(analyzeShipHitReport(null, 502, opts(drop, 13)).aswHits, [12])
  assert.deepEqual(analyzeShipHitReport(null, 501, opts({ before: 10, after: 10 })).totalDmg, 0)
})

test('判一击用什么打的与动画复盘同一份：attackWeaponOf 从剧本编译器导出，归因不另写一套', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/hit-report.ts'), 'utf8')
  assert.match(src, /import \{ attackWeaponOf \} from '\.\/battle-anim-script'/)
  assert.doesNotMatch(src, /TORPEDO_TYPES|GUN_TYPES|carrierNightAttack/, '不许在归因里再抄一遍分类常量')
  const anim = fs.readFileSync(path.join(ROOT, 'src/shared/battle-anim-script.ts'), 'utf8')
  assert.match(anim, /const weaponOf = [^]*?return attackWeaponOf\(attack, \{/)
})
