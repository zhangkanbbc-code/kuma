import assert from 'node:assert/strict'
import test from 'node:test'

import damageModule from '../dist/shared/battle-damage.js'
import textModule from '../dist/shared/ship-life-damage.js'

const { damageTakenIn, taihaIn } = damageModule
const { shipLifeDamageText } = textModule

const ship = (over = {}) => ({ hpStart: 40, hpEnd: 40, hpMax: 40, repairItemUsed: null, ...over })

test('承受伤害按结算前后的 HP 差算', () => {
  assert.equal(damageTakenIn(ship({ hpStart: 40, hpEnd: 12 })), 28)
  assert.equal(damageTakenIn(ship({ hpStart: 40, hpEnd: 40 })), 0)
  // 入渠回血一类导致 hpEnd 反而更高时不给负数
  assert.equal(damageTakenIn(ship({ hpStart: 20, hpEnd: 40 })), 0)
})

test('女神／要员发动过的那一场，掉的是开战时的全部 HP', () => {
  // 女神把 HP 拉回满：只看结算值会算成「没掉血」，实际是被打到 0 才发动的
  assert.equal(damageTakenIn(ship({ hpStart: 37, hpEnd: 40, repairItemUsed: 43 })), 37)
  // 要员回到两成：同理
  assert.equal(damageTakenIn(ship({ hpStart: 37, hpEnd: 8, repairItemUsed: 42 })), 37)
})

test('大破按收尾时 HP ≤ 25% 算，女神／要员发动过的也算', () => {
  assert.equal(taihaIn(ship({ hpEnd: 10, hpMax: 40 })), true) // 正好 25%
  assert.equal(taihaIn(ship({ hpEnd: 11, hpMax: 40 })), false)
  // 发动过修理道具的场次：结算 HP 已被拉回安全线，只看结算值会漏掉这一次
  assert.equal(taihaIn(ship({ hpEnd: 40, hpMax: 40, repairItemUsed: 43 })), true)
  // 演习的「击破」停在 HP1，不是沉没，但确实是大破
  assert.equal(taihaIn(ship({ hpEnd: 1, hpMax: 40 })), true)
})

// 这两项是后加的列，老战斗记录里是 NULL。下面几条盯的是同一件事：
// 缺数据绝不能被当成「0 伤害」混进总数——那等于替旧记录断言「那些仗一滴血没掉」。
const report = (over = {}) => ({
  damageTaken: 0,
  taihaCount: 0,
  damageDealt: 0,
  damageTrackedFrom: null,
  damageUnknownBattles: 0,
  ...over,
})

test('有说不出的场次时，数字要标成只覆盖一部分，并说清是从哪天起、漏了几场', () => {
  const partial = shipLifeDamageText(
    report({
      damageTaken: 4720,
      taihaCount: 6,
      damageDealt: 31840,
      damageTrackedFrom: 1754500000000,
      damageUnknownBattles: 37,
    }),
  )
  assert.equal(partial.partial, true)
  assert.equal(partial.damage, (4720).toLocaleString())
  assert.equal(partial.dealt, (31840).toLocaleString())
  assert.match(partial.title, /更早的 37 场不可知/)
  assert.match(partial.title, /起记录/)
  // 两栏口径不同，说明必须各写各的：造成伤害那栏得讲清航空/基地/支援不摊给个人
  assert.match(partial.dealtTitle, /更早的 37 场不可知/)
  assert.match(partial.dealtTitle, /航空战、基地航空与支援射击/)
  assert.doesNotMatch(partial.title, /航空战、基地航空与支援射击/)
})

test('全程都记着的时候不加「部分」', () => {
  const full = shipLifeDamageText(
    report({ damageTaken: 120, taihaCount: 1, damageTrackedFrom: 1754500000000 }),
  )
  assert.equal(full.partial, false)
  assert.match(full.title, /覆盖本地留下的全部战斗/)
})

test('「一场都没记过」与「真的没打过仗」不能显示成同一个 0', () => {
  // 打过 12 场但都在记录开始之前：显示 —，不是 0
  const unknown = shipLifeDamageText(report({ damageUnknownBattles: 12 }))
  assert.equal(unknown.damage, '—')
  assert.equal(unknown.taiha, '—')
  assert.equal(unknown.dealt, '—')
  assert.equal(unknown.partial, true)
  // 确实一仗没打过：0 才是实话
  const rookie = shipLifeDamageText(report())
  assert.equal(rookie.damage, '0')
  assert.equal(rookie.taiha, '0')
  assert.equal(rookie.dealt, '0')
  assert.equal(rookie.partial, false)
})

test('破损档阈值与大破口径一致：25/50/75 三道线', () => {
  const { damageTierOf } = damageModule
  assert.equal(damageTierOf(10, 40), 'heavy') // 正好 25%
  assert.equal(damageTierOf(11, 40), 'medium')
  assert.equal(damageTierOf(20, 40), 'medium') // 正好 50%
  assert.equal(damageTierOf(21, 40), 'light')
  assert.equal(damageTierOf(30, 40), 'light') // 正好 75%
  assert.equal(damageTierOf(31, 40), null)
  assert.equal(damageTierOf(40, 40), null)
})

test('陆上型敌人的破损档用词是另一套，不与舰船混用', () => {
  // 口径来源：EO andanteyk/ElectronicObserver Data/Constants.cs GetDamageState
  // （实证 2026-08-10）：舰船 小破/中破/大破/撃沈 ⇔ 陆上型 混乱/損害/損壊/破壊。
  const { DAMAGE_TIER_WORDS } = damageModule
  assert.deepEqual(DAMAGE_TIER_WORDS.ship, { light: '小破', medium: '中破', heavy: '大破', lost: '沉' })
  assert.deepEqual(DAMAGE_TIER_WORDS.landBase, { light: '混乱', medium: '损害', heavy: '损坏', lost: '毁' })
})

test('战斗详情的状态签按速力 0 切换陆上型词表', async () => {
  // di 的 damageState 是唯一的逐舰状态签出口；陆上型判定必须与反陆上
  // 特效预测同口径（主数据速力 0），不许按名字猜
  const fs = await import('node:fs')
  const combat = fs.readFileSync(new URL('../src/renderer/modules/di.ts', import.meta.url), 'utf8')
  assert.match(combat, /DAMAGE_TIER_WORDS\[\(mg\.master\.ships\[ship\.mstId\]\?\.soku \?\? 1\) === 0 \? 'landBase' : 'ship'\]/)
  assert.match(combat, /return \[words\.lost, 'var\(--enemy\)'\]/)
})
