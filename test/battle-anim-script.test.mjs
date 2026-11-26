// 动画复盘剧本编译器（shared/battle-anim-script）的行为测试。
//
// 直接跑 dist 产物，断言真代码的输出。全量真快照的对拍另在 scripts/battle-anim-replay-audit.mjs
// （读本机账本，不进 npm test）；这里用最小构造把每条机制钉死。
import assert from 'node:assert/strict'
import test from 'node:test'

import script from '../dist/shared/battle-anim-script.js'

const { compileBattleAnimScript, ANIM_STEP_MS, AIR_HANDOFF } = script

// ---- 最小构造 ----
const STYPE = { 1: 2, 2: 11, 3: 13, 4: 9, 5: 7 } // mstId → 舰种：1 驱逐 / 2 正规空母 / 3 潜艇 / 4 战舰 / 5 轻母
const stypeOf = (mstId) => STYPE[mstId] ?? null
const shipOf = (index, over = {}) => ({
  index, fleet: 'main', position: index, mstId: 1, rosterId: null, name: `舰${index}`, lv: 99,
  hpStart: 40, hpEnd: 40, hpMax: 40, damageDealt: 0, sunk: false, defeated: false, escaped: false,
  repairItemUsed: null, repairItemUsedAtStart: null, repairItemInstanceAtStart: null, ...over,
})
const hitOf = (target, damage, over = {}) => ({
  target, damage, critical: false, hitState: damage > 0 ? 'hit' : 'miss', miss: damage === 0, protect: false, sunk: false, repairItem: null, ...over,
})
let action = 0
const atk = (stage, phase, side, attacker, hits, over = {}) => ({
  phase, side, attacker, ciType: null, ciKind: null, stage, action: action++, stageLabel: phase, source: phase,
  simultaneous: phase === 'openingTorp' || phase === 'torp', hits, ...over,
})
const stageOf = (order, phase, over = {}) => ({ order, phase, label: phase, source: phase, simultaneous: phase === 'openingTorp' || phase === 'torp', air: null, ...over })
const airOf = (over = {}) => ({ seiku: 1, fCount: 30, fLost: 3, eCount: 20, eLost: 12, fLost2: 0, eLost2: 2, touchF: -1, touchE: -1, aaCutinIdx: null, aaCutinKind: null, ...over })
const battleOf = (over = {}) => ({
  kind: 'day', practice: false, hasNight: false, fFormation: 1, eFormation: 1, engagement: 1,
  fShips: [shipOf(0)], eShips: [shipOf(0)], friendShips: [], friendlyProductionType: null,
  stages: [], attacks: [], air: null, air2: null, airInjection: null, flarePos: null, detection: null,
  nightContact: null, smokeType: 0, activeDeck: null, hasSupport: false, flavorVoices: [],
  prediction: { rank: 'S', perfect: false, sure: true, fGauge: 0, fTaken: 0, eGauge: 0, fSunk: 0, fCount: 1, eSunk: 0, eCount: 1 },
  result: null, ts: 0, ...over,
})
const compile = (battle) => compileBattleAnimScript(battle, { stypeOf })
const kinds = (s) => s.steps.map((step) => step.kind)
const lastFrame = (s) => s.steps.at(-1).after

test('通常昼战转夜：序幕、航空三拍、同时雷击、转场、逐击、尾声按阶段顺序排开，终局血量与输出对上', () => {
  action = 0
  const battle = battleOf({
    hasNight: true,
    activeDeck: [1, 1],
    flarePos: [-1, -1],
    nightContact: [0, 0],
    fShips: [shipOf(0, { mstId: 2, damageDealt: 30 }), shipOf(1, { hpEnd: 25, damageDealt: 18 })],
    eShips: [shipOf(0, { hpEnd: 0, damageDealt: 15, sunk: true }), shipOf(1, { hpEnd: 22 })],
    stages: [
      stageOf(1, 'air', { air: airOf({ aaCutinIdx: 1, aaCutinKind: 8 }) }),
      stageOf(2, 'openingTorp'),
      stageOf(3, 'gun1'),
      stageOf(5, 'night'),
    ],
    attacks: [
      atk(1, 'air', 0, -1, [hitOf(1, 18)]),
      atk(2, 'openingTorp', 1, 0, [hitOf(1, 15)]),
      atk(3, 'gun1', 0, 0, [hitOf(0, 30)]),
      atk(3, 'gun1', 0, 1, [hitOf(0, 10)]),
      atk(5, 'night', 0, 1, [hitOf(1, 0)]),
    ],
  })
  // 航空那一击无逐舰归属（attacker -1），不进任何人的输出：我方 0 号只算炮击 30
  battle.fShips[1].damageDealt = 10
  const s = compile(battle)
  // 航空战一波连成一步：缠斗 → 对空 CI → 投弹（维护者 2026-11-26「缠斗完了直接打」）
  assert.deepEqual(kinds(s), ['intro', 'air', 'torpedo-salvo', 'attack', 'attack', 'transition', 'attack', 'outro'])
  assert.equal(s.steps[1].clash, true)
  assert.equal(s.steps[1].aaciShip, 1)
  // 缠斗与空袭连贯（维护者 2026-11-26「游戏里是连贯的」）：攻击机在缠斗盘旋到 AIR_HANDOFF 时扑出，对空 CI 叠在进场途中
  assert.equal(s.steps[1].strikeAtMs, Math.round(s.steps[1].clashMs * AIR_HANDOFF))
  assert.equal(s.steps[1].durationMs, s.steps[1].strikeAtMs + ANIM_STEP_MS.airStrike)
  assert.equal(s.mismatchCount, 0)
  const end = lastFrame(s)
  assert.deepEqual(end.f.map((ship) => ship.hp), [40, 25])
  assert.deepEqual(end.e.map((ship) => ship.hp), [0, 22])
  assert.deepEqual(end.f.map((ship) => ship.dealt), [30, 10])
  assert.equal(end.e[0].dealt, 15)
  assert.equal(end.e[0].sunk, true)
  assert.equal(s.steps[1].after.env.seiku, 1)
  const transition = s.steps.find((step) => step.kind === 'transition')
  assert.equal(transition.toNight, true)
  assert.equal(transition.after.env.night, true)
  assert.deepEqual(transition.after.env.activeDeck, [1, 1])
  assert.equal(s.steps.find((step) => step.kind === 'intro').showsEngagement, true)
  assert.equal(s.totalMs, s.steps.reduce((sum, step) => sum + step.durationMs, 0))
  assert.ok(s.markers.some((marker) => marker.kind === 'night'))
  assert.ok(s.markers.some((marker) => marker.kind === 'flagship-down'))
})

test('多段连击：同一步里起点不被覆盖，before.hp === after.hpBefore 恒成立', () => {
  action = 0
  const battle = battleOf({
    eShips: [shipOf(0, { hpEnd: 5 })],
    fShips: [shipOf(0, { damageDealt: 35 })],
    stages: [stageOf(1, 'gun1')],
    attacks: [atk(1, 'gun1', 0, 0, [hitOf(0, 20), hitOf(0, 15)], { ciType: 2, ciKind: 'day' })],
  })
  const s = compile(battle)
  const step = s.steps.find((entry) => entry.kind === 'attack')
  assert.equal(step.before.e[0].hp, 40)
  assert.equal(step.after.e[0].hpBefore, 40)
  assert.equal(step.after.e[0].hp, 5)
  assert.equal(step.durationMs, ANIM_STEP_MS.attackMulti)
  for (const entry of s.steps) {
    for (const ship of entry.after.e) assert.equal(ship.hpBefore, entry.before.e.find((x) => x.index === ship.index).hp)
  }
})

test('应急修理：只在发动那一步亮 repairedThisStep，血量按记录顶回（女神满血 / 要员两成）', () => {
  action = 0
  const battle = battleOf({
    fShips: [shipOf(0, { hpStart: 10, hpEnd: 40, hpMax: 40 }), shipOf(1, { hpStart: 6, hpEnd: 4, hpMax: 21 })],
    stages: [stageOf(1, 'gun1')],
    attacks: [
      atk(1, 'gun1', 1, 0, [hitOf(0, 30, { repairItem: 43 })]),
      atk(1, 'gun1', 1, 0, [hitOf(1, 50, { repairItem: 42 })]),
    ],
  })
  const s = compile(battle)
  assert.equal(s.mismatchCount, 0)
  const [goddess, crew] = s.steps.filter((step) => step.kind === 'attack')
  assert.equal(goddess.after.f[0].repairedThisStep, true)
  assert.equal(goddess.after.f[0].repairUsed, 43)
  assert.equal(goddess.after.f[0].hp, 40)
  assert.equal(goddess.durationMs, ANIM_STEP_MS.attackRepair)
  assert.equal(crew.after.f[0].repairedThisStep, false, '下一步复位')
  assert.equal(crew.after.f[1].hp, 4)
  assert.equal(s.markers.filter((marker) => marker.kind === 'repair').length, 2)
})

test('演习：血量停在 1，标击破不标沉没', () => {
  action = 0
  const battle = battleOf({
    practice: true,
    eShips: [shipOf(0, { hpEnd: 1 })],
    stages: [stageOf(1, 'gun1')],
    attacks: [atk(1, 'gun1', 0, 0, [hitOf(0, 99)])],
  })
  const end = lastFrame(compile(battle))
  assert.equal(end.e[0].hp, 1)
  assert.equal(end.e[0].defeated, true)
  assert.equal(end.e[0].sunk, false)
})

test('喷式强袭：敌方没有喷式机就不演狗斗，也不改写常规航空战的制空状态', () => {
  action = 0
  const battle = battleOf({
    eShips: [shipOf(0, { hpEnd: 30 })],
    stages: [
      stageOf(1, 'injection', { air: airOf({ seiku: 4, fCount: 6, eCount: 0, eLost: 0 }) }),
      stageOf(2, 'air', { air: airOf({ seiku: 2 }) }),
    ],
    attacks: [atk(1, 'injection', 0, -1, [hitOf(0, 10)])],
  })
  const s = compile(battle)
  assert.deepEqual(kinds(s), ['intro', 'air', 'air', 'outro'])
  assert.equal(s.steps[1].jet, true)
  assert.equal(s.steps[1].clash, false, '敌方没有喷式机：不演缠斗，直接突防投弹')
  assert.equal(s.steps[2].clash, true)
  assert.equal(s.steps[1].after.env.seiku, null, '喷式强袭不写制空')
  assert.equal(s.steps[2].after.env.seiku, 2)
})

test('单方面空袭：我方没有飞机时不演双边狗斗；航空零伤照实记「不明」而不是落空', () => {
  action = 0
  const battle = battleOf({
    kind: 'airraid',
    stages: [stageOf(1, 'air', { air: airOf({ fCount: 0, fLost: 0, seiku: 4 }) })],
    attacks: [atk(1, 'air', 1, -1, [{ target: 0, damage: 0, critical: false, miss: false, protect: false, sunk: false, repairItem: null }])],
  })
  const s = compile(battle)
  assert.deepEqual(kinds(s), ['intro', 'air', 'outro'])
  assert.equal(s.steps[1].clash, false)
  assert.equal(s.steps[1].strikes[0].hitState, 'unknown')
  assert.equal(s.steps[1].dull, true)
  assert.equal(s.steps[0].showsEngagement, false, '空袭不报航向')
})

test('烟幕：航空打完、接敌开火之前展开，进夜时散去', () => {
  action = 0
  const battle = battleOf({
    smokeType: 2,
    hasNight: true,
    activeDeck: [1, 1],
    stages: [stageOf(1, 'air', { air: airOf() }), stageOf(2, 'gun1'), stageOf(4, 'night')],
    attacks: [atk(2, 'gun1', 0, 0, [hitOf(0, 0)]), atk(4, 'night', 0, 0, [hitOf(0, 0)])],
  })
  const s = compile(battle)
  assert.deepEqual(kinds(s), ['intro', 'air', 'smoke', 'attack', 'transition', 'attack', 'outro'])
  const smoke = s.steps[2]
  assert.equal(smoke.level, 2)
  assert.equal(smoke.after.env.smoke, 2)
  const transition = s.steps[4]
  assert.equal(transition.smokeLeaving, true)
  assert.equal(transition.after.env.smoke, 0)
  assert.equal(transition.durationMs, ANIM_STEP_MS.transitionWithSmoke)
  assert.equal(s.steps[5].after.env.smokeLeaving, false, '散去只占转场那一拍')
  assert.ok(s.markers.some((marker) => marker.kind === 'smoke' && marker.step === 2))
})

test('舰队特攻：结构上同源的几段收成一组，先切入再逐段；两条舰各自弹着连击不成组', () => {
  action = 0
  const nagato = { ciType: 101, ciKind: 'day', equipmentMstIds: [7, 7] }
  const battle = battleOf({
    fShips: [shipOf(0, { mstId: 4 }), shipOf(1, { mstId: 4 })],
    eShips: [shipOf(0), shipOf(1), shipOf(2)],
    stages: [stageOf(1, 'gun1'), stageOf(2, 'gun2')],
    attacks: [
      atk(1, 'gun1', 0, 0, [hitOf(0, 1)], nagato),
      atk(1, 'gun1', 0, 0, [hitOf(1, 1)], nagato),
      atk(1, 'gun1', 0, 1, [hitOf(2, 1)], nagato),
      atk(2, 'gun2', 0, 0, [hitOf(0, 1), hitOf(0, 1)], { ciType: 2, ciKind: 'day' }),
      atk(2, 'gun2', 0, 1, [hitOf(1, 1), hitOf(1, 1)], { ciType: 2, ciKind: 'day' }),
    ],
  })
  for (const ship of battle.eShips) ship.hpEnd = ship.index === 2 ? 39 : 37
  battle.fShips[0].damageDealt = 4
  battle.fShips[1].damageDealt = 3
  const s = compile(battle)
  assert.deepEqual(kinds(s), ['intro', 'special-cutin', 'attack', 'attack', 'attack', 'attack', 'attack', 'outro'])
  const cutin = s.steps[1]
  assert.equal(cutin.ciType, 101)
  assert.deepEqual(cutin.participants, [0, 1])
  assert.deepEqual(s.steps.slice(2, 5).map((step) => step.special), [
    { ciType: 101, segment: 0, of: 3 },
    { ciType: 101, segment: 1, of: 3 },
    { ciType: 101, segment: 2, of: 3 },
  ])
  assert.ok(s.steps.slice(2, 5).every((step) => step.weapon === 'special'))
  assert.deepEqual(s.steps.slice(5, 7).map((step) => step.special), [null, null])
  assert.equal(s.mismatchCount, 0)
})

test('友军夜战：敌方打的是友军舰队，不扣我方同舰位的血；友军进退场', () => {
  action = 0
  const battle = battleOf({
    kind: 'day',
    hasNight: true,
    activeDeck: [1, 1],
    fShips: [shipOf(0, { hpEnd: 40 })],
    eShips: [shipOf(0, { hpEnd: 10 })],
    friendShips: [{ ...shipOf(0, { hpEnd: 15, damageDealt: 30 }), fleet: 'friend' }],
    stages: [stageOf(5, 'friendly'), stageOf(6, 'night')],
    attacks: [
      atk(5, 'friendly', 2, 0, [hitOf(0, 30)]),
      atk(5, 'friendly', 1, 0, [hitOf(0, 25)]),
    ],
  })
  battle.eShips[0].damageDealt = 25
  const s = compile(battle)
  assert.equal(s.mismatchCount, 0)
  const end = lastFrame(s)
  assert.equal(end.f[0].hp, 40)
  assert.equal(end.friend[0].hp, 15)
  assert.equal(end.friend[0].dealt, 30)
  const friendStep = s.steps.find((step) => step.phase === 'friendly')
  assert.equal(friendStep.after.env.friendVisible, true)
  assert.equal(s.steps.at(-1).after.env.friendVisible, false)
})

test('退避与不可攻击的舰不扣血，也不计入终局对拍', () => {
  action = 0
  const battle = battleOf({
    kind: 'subAirRaid',
    fShips: [shipOf(0), shipOf(1, { escaped: true })],
    eShips: [shipOf(0, { mstId: 3, hpEnd: 20 }), shipOf(1, { mstId: 2, hpStart: 0, hpMax: 1, hpEnd: 0, unattackable: true })],
    stages: [stageOf(1, 'gun1')],
    attacks: [atk(1, 'gun1', 1, 0, [hitOf(1, 9)]), atk(1, 'gun1', 0, 0, [hitOf(0, 20)])],
  })
  battle.fShips[0].damageDealt = 20
  battle.eShips[0].damageDealt = 9
  const s = compile(battle)
  assert.equal(lastFrame(s).f[1].hp, 40)
  assert.equal(s.mismatchCount, 0)
})

test('出手的表现按真实情形分：反潜、航空反潜、雷达射击、空母夜袭、空母昼间攻击、潜艇雷击', () => {
  action = 0
  const battle = battleOf({
    fShips: [shipOf(0, { mstId: 1 }), shipOf(1, { mstId: 5 }), shipOf(2, { mstId: 2 })],
    eShips: [shipOf(0, { mstId: 3 }), shipOf(1, { mstId: 1 })],
    stages: [stageOf(1, 'openingAsw'), stageOf(2, 'gun1'), stageOf(3, 'radar'), stageOf(6, 'night')],
    attacks: [
      atk(1, 'openingAsw', 0, 0, [hitOf(0, 0)]),
      atk(2, 'gun1', 0, 1, [hitOf(0, 0)]),
      atk(2, 'gun1', 0, 2, [hitOf(1, 0)]),
      atk(2, 'gun1', 1, 0, [hitOf(0, 0)]),
      atk(3, 'radar', 1, 1, [hitOf(0, 0)]),
      atk(6, 'night', 0, 2, [hitOf(1, 0)], { carrierNightAttack: true, ciKind: 'night' }),
    ],
  })
  const weapons = compile(battle).steps.filter((step) => step.kind === 'attack').map((step) => step.weapon)
  assert.deepEqual(weapons, ['asw', 'air-asw', 'carrier', 'torpedo', 'radar-shell', 'night-carrier'])
})

test('拂晓战：开场即夜，转场是夜转昼', () => {
  action = 0
  const battle = battleOf({
    kind: 'nightday',
    activeDeck: [1, 1],
    stages: [stageOf(1, 'night'), stageOf(3, 'gun1')],
    attacks: [atk(1, 'night', 0, 0, [hitOf(0, 0)]), atk(3, 'gun1', 0, 0, [hitOf(0, 0)])],
  })
  const s = compile(battle)
  assert.equal(s.steps[0].before.env.night, true)
  const transition = s.steps.find((step) => step.kind === 'transition')
  assert.equal(transition.toNight, false)
  assert.equal(transition.after.env.activeDeck, null)
  assert.ok(s.markers.some((marker) => marker.kind === 'day'))
})

test('夜战点开场就是夜：照明弹、夜间触接从序幕起就在（没有转场那一步也不丢）', () => {
  action = 0
  const battle = battleOf({
    kind: 'nightonly',
    activeDeck: [1, 1],
    flarePos: [0, -1],
    nightContact: [1, 0],
    stages: [stageOf(1, 'night')],
    attacks: [atk(1, 'night', 0, 0, [hitOf(0, 0)])],
  })
  const s = compile(battle)
  assert.ok(!s.steps.some((step) => step.kind === 'transition'))
  assert.equal(s.steps[0].kind, 'intro')
  assert.equal(s.steps[0].after.env.flare, true)
  assert.equal(s.steps[0].after.env.nightContact, true)
  assert.equal(lastFrame(s).env.flare, true)
  // 昼战点没有夜战：照明弹字段在也不亮
  const day = compile(battleOf({ flarePos: [0, -1], stages: [stageOf(1, 'gun1')], attacks: [atk(1, 'gun1', 0, 0, [hitOf(0, 0)])] }))
  assert.ok(day.steps.every((step) => !step.after.env.flare))
})

test('夜战支援打在夜里：夜战点开场的支援不先转昼再转回夜；昼转夜的场次先进入夜战再演支援', () => {
  action = 0
  const nightOnly = compile(battleOf({
    kind: 'nightonly',
    activeDeck: [1, 1],
    flarePos: [0, -1],
    eShips: [shipOf(0, { hpEnd: 30 })],
    stages: [stageOf(1, 'support', { source: 'api_n_support_info', support: { deckId: 3, shipMstIds: [4] } }), stageOf(2, 'night')],
    attacks: [atk(1, 'support', 0, -1, [hitOf(0, 10)]), atk(2, 'night', 0, 0, [hitOf(0, 0)])],
  }))
  assert.deepEqual(kinds(nightOnly), ['intro', 'support', 'attack', 'outro'])
  assert.ok(nightOnly.steps.every((step) => step.after.env.night && step.after.env.flare))
  action = 0
  const dayToNight = compile(battleOf({
    hasNight: true,
    activeDeck: [1, 1],
    eShips: [shipOf(0, { hpEnd: 30 })],
    stages: [stageOf(1, 'gun1'), stageOf(5, 'support', { source: 'api_n_support_info', support: { deckId: 3, shipMstIds: [4] } }), stageOf(6, 'night')],
    attacks: [atk(1, 'gun1', 0, 0, [hitOf(0, 0)]), atk(5, 'support', 0, -1, [hitOf(0, 10)]), atk(6, 'night', 0, 0, [hitOf(0, 0)])],
  }))
  assert.deepEqual(kinds(dayToNight), ['intro', 'attack', 'transition', 'support', 'attack', 'outro'])
  assert.equal(dayToNight.markers.filter((marker) => marker.kind === 'night' || marker.kind === 'day').length, 1)
})

test('卡特琳娜救援整场只演一次：挂在最后一波陆航上', () => {
  action = 0
  const s = compile(battleOf({
    airBaseRescue: 1,
    eShips: [shipOf(0, { hpEnd: 10 })],
    stages: [
      stageOf(1, 'lbas', { air: airOf({ fCount: 18, eCount: 0 }) }),
      stageOf(2, 'lbas', { air: airOf({ fCount: 18, eCount: 0 }) }),
      stageOf(3, 'lbas', { air: airOf({ fCount: 18, eCount: 0 }) }),
    ],
    attacks: [
      atk(1, 'lbas', 0, -1, [hitOf(0, 10)]),
      atk(2, 'lbas', 0, -1, [hitOf(0, 10)]),
      atk(3, 'lbas', 0, -1, [hitOf(0, 10)]),
    ],
  }))
  assert.deepEqual(s.steps.filter((step) => step.kind === 'air').map((step) => step.rescue), [0, 0, 1])
})

test('夜袭 CI 没立空母夜战标记也画成舰载机，不画成炮弹', () => {
  action = 0
  const battle = battleOf({
    kind: 'nightonly',
    activeDeck: [1, 1],
    fShips: [shipOf(0, { mstId: 2 })],
    stages: [stageOf(1, 'night')],
    attacks: [atk(1, 'night', 0, 0, [hitOf(0, 30)], { ciType: 6, ciKind: 'night' })],
    eShips: [shipOf(0, { hpEnd: 10 })],
  })
  battle.fShips[0].damageDealt = 30
  const step = compile(battle).steps.find((entry) => entry.kind === 'attack')
  assert.equal(step.weapon, 'night-carrier')
})

test('同一份战斗编两次得到同一份剧本（确定性），且不改动输入', () => {
  action = 0
  const battle = battleOf({
    stages: [stageOf(1, 'gun1')],
    attacks: [atk(1, 'gun1', 0, 0, [hitOf(0, 5)])],
    eShips: [shipOf(0, { hpEnd: 35 })],
  })
  const frozen = JSON.stringify(battle)
  assert.deepEqual(compile(battle), compile(battle))
  assert.equal(JSON.stringify(battle), frozen)
})

// ---- 按真实使用的装备挑表现（维护者 2026-11-26：原型按序号 / 单双猜舰爆舰攻、夜战鱼雷画成炮弹）----
const SLOT = { 101: 2, 102: 5, 103: 7, 104: 8, 105: 11 } // 主炮 / 鱼雷 / 舰爆 / 舰攻 / 水爆
const compileWithSlots = (battle) => compileBattleAnimScript(battle, { stypeOf, slotTypeOf: (id) => SLOT[id] ?? null })

test('夜战按实际用的装备分：只用鱼雷是雷击、炮雷并用另成一类、只有炮是炮击；瑞云（200）是水上轰炸机，带炮的炮弹炸弹一起落', () => {
  action = 0
  const battle = battleOf({
    hasNight: true,
    activeDeck: [1, 1],
    fShips: [shipOf(0), shipOf(1), shipOf(2), shipOf(3)],
    eShips: [shipOf(0)],
    stages: [stageOf(6, 'night')],
    attacks: [
      atk(6, 'night', 0, 0, [hitOf(0, 0)], { ciKind: 'night', ciType: 3, equipmentMstIds: [102, 102] }),
      atk(6, 'night', 0, 1, [hitOf(0, 0)], { ciKind: 'night', ciType: 7, equipmentMstIds: [101, 102] }),
      atk(6, 'night', 0, 2, [hitOf(0, 0)], { ciKind: 'night', ciType: 1, equipmentMstIds: [101, 101] }),
      atk(6, 'night', 0, 3, [hitOf(0, 0)], { ciKind: 'night', ciType: 200, equipmentMstIds: [105, 105] }),
      atk(6, 'night', 0, 3, [hitOf(0, 0)], { ciKind: 'night', ciType: 200, equipmentMstIds: [105, 101, 101] }),
    ],
  })
  const weapons = compileWithSlots(battle).steps.filter((step) => step.kind === 'attack').map((step) => step.weapon)
  assert.deepEqual(weapons, ['torpedo', 'gun-torpedo', 'shell', 'seaplane', 'gun-seaplane'])
  // 没有装备分类可查时不猜：夜战普通出手照旧算炮击
  const plain = compile(battle).steps.filter((step) => step.kind === 'attack').map((step) => step.weapon)
  assert.deepEqual(plain.slice(0, 3), ['shell', 'shell', 'shell'])
})

test('空母出手记下实际用了舰爆还是舰攻；装备不明时不猜', () => {
  action = 0
  const battle = battleOf({
    fShips: [shipOf(0, { mstId: 2 }), shipOf(1, { mstId: 2 }), shipOf(2, { mstId: 2 })],
    eShips: [shipOf(0)],
    stages: [stageOf(2, 'gun1')],
    attacks: [
      atk(2, 'gun1', 0, 0, [hitOf(0, 0)], { equipmentMstIds: [103] }),
      atk(2, 'gun1', 0, 1, [hitOf(0, 0)], { ciType: 7, ciKind: 'day', equipmentMstIds: [103, 104] }),
      atk(2, 'gun1', 0, 2, [hitOf(0, 0)]),
    ],
  })
  const aircraft = compileWithSlots(battle).steps.filter((step) => step.kind === 'attack').map((step) => step.aircraft)
  assert.deepEqual(aircraft, [{ bomb: true, torpedo: false }, { bomb: true, torpedo: true }, null])
})

test('航空投弹带上解析层记的鱼雷 / 炸弹标记，陆航带上这一波的机种；支援分炮击与航空', () => {
  action = 0
  const planes = [{ mstId: 169, count: 18 }]
  const battle = battleOf({
    eShips: [shipOf(0, { hpEnd: 10 }), shipOf(1, { hpEnd: 30 })],
    stages: [
      stageOf(1, 'lbas', { squadronPlanes: planes, air: airOf({ fCount: 18, eCount: 0 }) }),
      stageOf(2, 'support', { support: { deckId: 3, shipMstIds: [4, 4] } }),
      stageOf(3, 'support'),
    ],
    attacks: [
      atk(1, 'lbas', 0, -1, [hitOf(0, 20, { airKind: 'torpedo' }), hitOf(1, 10, { airKind: 'bomb' })]),
      atk(2, 'support', 0, -1, [hitOf(0, 10)]),
      atk(3, 'support', 0, -1, [hitOf(1, 0)]),
    ],
  })
  const s = compile(battle)
  const strike = s.steps.find((step) => step.kind === 'air')
  assert.deepEqual(strike.strikes.map((hit) => hit.airKind), ['torpedo', 'bomb'])
  assert.deepEqual(strike.planes, planes)
  assert.deepEqual(s.steps.filter((step) => step.kind === 'support').map((step) => step.mode), ['gun', 'air'])
})

test('节奏整体放慢两成：时长表是原型节拍乘 ANIM_PACE', () => {
  assert.equal(script.ANIM_PACE, 1.2)
  assert.equal(ANIM_STEP_MS.attack, Math.round(1280 * 1.2))
  assert.equal(ANIM_STEP_MS.airClash, Math.round(2550 * 1.2))
})
