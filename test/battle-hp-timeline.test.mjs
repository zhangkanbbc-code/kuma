import assert from 'node:assert/strict'
import test from 'node:test'

import timeline from '../dist/shared/battle-hp-timeline.js'

const { shipHpTimeline, hpAtStage, hpBarSegments, segmentStartOf } = timeline

// 攻击流的最小构造：stage 是真实阶段序，action 是同阶段行动序
const hit = (target, damage, repairItem = null) => ({ target, damage, repairItem })
const foeAttack = (stage, action, hits) => ({ side: 1, stage, action, hits })
const ourAttack = (stage, action, hits) => ({ side: 0, stage, action, hits })
const ship = (over = {}) => ({ index: 0, hpStart: 40, hpMax: 40, hpEnd: 40, ...over })

test('replaying the hits lands exactly on the recorded hpEnd', () => {
  // 解析层就是这么算的（applyHit：hp = max(floor, hp - damage)），照同一套规则重放，
  // 末值必然对上——不是估算
  const attacks = [
    foeAttack(3, 0, [hit(0, 10)]),
    foeAttack(5, 0, [hit(0, 23)]),
  ]
  const result = shipHpTimeline(attacks, ship({ hpEnd: 7 }), false, false)
  assert.equal(result.mismatch, false)
  assert.deepEqual(result.points, [
    { stage: 3, hp: 30, before: 40 },
    { stage: 5, hp: 7, before: 30 },
  ])
})

test('a single-phase battle has one point and no "this phase" slice at the end', () => {
  const attacks = [foeAttack(2, 0, [hit(0, 12)])]
  const result = shipHpTimeline(attacks, ship({ hpEnd: 28 }), false, false)
  assert.deepEqual(result.points, [{ stage: 2, hp: 28, before: 40 }])
  const now = hpAtStage(result, null)
  assert.deepEqual(now, { hp: 28, before: 40 })
})

test('night-then-day is ordered by the real stage numbers, not by a hardcoded day-first', () => {
  // 开幕夜战（kind=nightday）：夜战 stage 在前，天亮后的昼战在后
  const attacks = [
    foeAttack(1, 0, [hit(0, 15)]), // 夜战
    foeAttack(4, 0, [hit(0, 9)]), // 转昼后
  ]
  const result = shipHpTimeline(attacks, ship({ hpEnd: 16 }), false, false)
  assert.deepEqual(result.points.map((point) => point.hp), [25, 16])
  // 选中夜战那一段：显示 25/40，虚条是夜战段掉的 15
  assert.deepEqual(hpAtStage(result, 1, 1), { hp: 25, before: 40 })
  // 选中转昼之后（昼战段从 stage 4 起）：夜战掉的归于空，虚条是昼战段的 9
  assert.deepEqual(hpAtStage(result, 4, 4), { hp: 16, before: 25 })
})

test('a ship sunk in the day phase reads 0 for every later stage', () => {
  const attacks = [
    foeAttack(2, 0, [hit(0, 60)]), // 溢出击沉：hits 记的是攻击伤害，不是扣血
    foeAttack(6, 0, [hit(1, 30)]), // 之后打的是别人
  ]
  const result = shipHpTimeline(attacks, ship({ hpEnd: 0 }), false, false)
  assert.equal(result.mismatch, false)
  assert.deepEqual(result.points, [{ stage: 2, hp: 0, before: 40 }])
  // 沉了之后同一段里的每个阶段都还是 0；段内累计——致命一击仍是斜杠虚条
  assert.deepEqual(hpAtStage(result, 6), { hp: 0, before: 40 })
  assert.deepEqual(hpAtStage(result, 99), { hp: 0, before: 40 })
  // 若之后进了夜战段（段首 6）：昼战沉的归于空，虚条归零
  assert.deepEqual(hpAtStage(result, 6, 6), { hp: 0, before: 0 })
})

test('practice keeps the floor at 1 HP', () => {
  const attacks = [foeAttack(2, 0, [hit(0, 999)])]
  const result = shipHpTimeline(attacks, ship({ hpEnd: 1 }), false, true)
  assert.equal(result.mismatch, false)
  assert.deepEqual(result.points, [{ stage: 2, hp: 1, before: 40 }])
})

test('an emergency repair puts the HP back up mid-battle', () => {
  // 43 女神满血 / 42 要员两成——解析层在归零那一刻取出道具，结果记在那一击上
  const goddess = shipHpTimeline(
    [foeAttack(2, 0, [hit(0, 50, 43)]), foeAttack(5, 0, [hit(0, 8)])],
    ship({ hpEnd: 32 }),
    false,
    false,
  )
  assert.equal(goddess.mismatch, false)
  // 女神把血顶回满格，那一阶段的净变化是 0，所以不留点——血条只看结算后的值
  assert.deepEqual(goddess.points, [{ stage: 5, hp: 32, before: 40 }])
  assert.deepEqual(hpAtStage(goddess, 2), { hp: 40, before: 40 })
  const crew = shipHpTimeline([foeAttack(2, 0, [hit(0, 50, 42)])], ship({ hpEnd: 8 }), false, false)
  assert.equal(crew.mismatch, false)
  assert.deepEqual(crew.points, [{ stage: 2, hp: 8, before: 40 }])
})

test('hits are filtered by which side threw them, not by target alone', () => {
  // 受击位置在敌我两侧各自独立编号：只看 target 会把敌方 0 号的伤记到我方 0 号头上
  const attacks = [
    foeAttack(2, 0, [hit(0, 10)]), // 敌打我方 0 号
    ourAttack(2, 1, [hit(0, 30)]), // 我打敌方 0 号
  ]
  assert.deepEqual(
    shipHpTimeline(attacks, ship({ hpEnd: 30 }), false, false).points,
    [{ stage: 2, hp: 30, before: 40 }],
  )
  assert.deepEqual(
    shipHpTimeline(attacks, ship({ hpEnd: 10 }), true, false).points,
    [{ stage: 2, hp: 10, before: 40 }],
  )
})

test('a ship that withdrew takes nothing, whatever the log says', () => {
  const result = shipHpTimeline(
    [foeAttack(2, 0, [hit(0, 30)])],
    ship({ hpEnd: 40, escaped: true }),
    false,
    false,
  )
  assert.deepEqual(result.points, [])
  assert.equal(result.mismatch, false)
})

test('picking a stage nothing happened in shows the same HP with no fresh slice', () => {
  const result = shipHpTimeline(
    [foeAttack(2, 0, [hit(0, 10)]), foeAttack(7, 0, [hit(0, 5)])],
    ship({ hpEnd: 25 }),
    false,
    false,
  )
  // 阶段 4 这艘舰没挨打：血量停在 30；同段累计——之前掉的 10 仍是虚条
  assert.deepEqual(hpAtStage(result, 4), { hp: 30, before: 40 })
  // 阶段 1 在第一次挨打之前：还是满的
  assert.deepEqual(hpAtStage(result, 1), { hp: 40, before: 40 })
})

test('the ghost baseline is the day/night segment, not each internal stage', () => {
  // 满血参战、昼战里航空+炮击分两口掉到 10——虚条必须是整个昼战段累计的 30，
  // 不是「最后挨的那一小口」。曾把段锚在内部阶段上，玩家看不见这场掉了多少。
  const dayAir = { side: 1, stage: 1, action: 0, phase: 'air', hits: [hit(0, 10)] }
  const dayGun = { side: 1, stage: 3, action: 0, phase: 'gun1', hits: [hit(0, 20)] }
  const nightHit = { side: 1, stage: 6, action: 0, phase: 'night', hits: [hit(0, 5)] }

  // 段的划分：昼战段从 stage 1 起，夜战段从 stage 6 起；跟随最新 = 最后一个段
  assert.equal(segmentStartOf([dayAir, dayGun, nightHit], null), 6)
  assert.equal(segmentStartOf([dayAir, dayGun, nightHit], 3), 1)
  assert.equal(segmentStartOf([dayAir, dayGun, nightHit], 6), 6)
  assert.equal(segmentStartOf([], null), 0)
  // 与 shipHpTimeline 同口径：attacks 乱序也要划出同样的段，
  // 否则回放/合并夜战后夜战伤害会被并进昼战段的虚条
  assert.equal(segmentStartOf([nightHit, dayGun, dayAir], null), 6)
  assert.equal(segmentStartOf([nightHit, dayGun, dayAir], 3), 1)

  // 还没进夜战：跟随最新时虚条 = 昼战段累计（40→10 全画斜杠）
  const dayOnly = [dayAir, dayGun]
  const day = shipHpTimeline(dayOnly, ship({ hpEnd: 10 }), false, false)
  assert.deepEqual(hpAtStage(day, null, segmentStartOf(dayOnly, null)), { hp: 10, before: 40 })

  // 进了夜战：昼战掉的 30 归于空，虚条只剩夜战的 5
  const all = [dayAir, dayGun, nightHit]
  const full = shipHpTimeline(all, ship({ hpEnd: 5 }), false, false)
  assert.deepEqual(hpAtStage(full, null, segmentStartOf(all, null)), { hp: 5, before: 10 })
  // 锚回昼战炮击：虚条又是昼战段累计的 30
  assert.deepEqual(hpAtStage(full, 3, segmentStartOf(all, 3)), { hp: 10, before: 40 })
})

test('the bar always divides by hpMax, whichever stage is selected', () => {
  const near = (actual, expected, note) =>
    assert.ok(Math.abs(actual - expected) < 0.01, `${note}：${actual} ≉ ${expected}`)
  // 40 血、这一阶段从 30 掉到 7：实血 7、虚条（本段掉的）23、更早掉的归于空 10
  const split = hpBarSegments(40, 7, 30)
  near(split.solidPct, 17.5, '实血')
  near(split.ghostPct, 57.5, '虚条=这一阶段掉的')
  near(split.emptyPct, 25, '更早掉的归于空')
  near(split.solidPct + split.ghostPct + split.emptyPct, 100, '三截加起来')

  // 这一阶段没挨打：虚条为 0，分母仍是 40——这里曾经写出过「7/7 大破」
  const untouched = hpBarSegments(40, 7, 7)
  assert.equal(untouched.ghostPct, 0)
  near(untouched.solidPct, 17.5, '满格被换成了阶段基准')

  // 选中第一次挨打之前：满条
  assert.deepEqual(hpBarSegments(40, 40, 40), { solidPct: 100, ghostPct: 0, emptyPct: 0 })
  // 一击打空：整条都是虚条，没有旧伤
  assert.deepEqual(hpBarSegments(40, 0, 40), { solidPct: 0, ghostPct: 100, emptyPct: 0 })
  // hpMax 缺失时不除以 0
  assert.equal(Number.isFinite(hpBarSegments(0, 0, 0).solidPct), true)
})

test('the timeline flags itself when the replay does not reach the recorded hpEnd', () => {
  // 攻击流残缺时宁可自曝，也不要画一条对不上结果的血条
  const result = shipHpTimeline([foeAttack(2, 0, [hit(0, 5)])], ship({ hpEnd: 7 }), false, false)
  assert.equal(result.mismatch, true)
})
