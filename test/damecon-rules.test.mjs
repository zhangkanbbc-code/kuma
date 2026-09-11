// 应急修理（要員 42 / 女神 43）的结算规则。
//
// 规则出处（三处互相印证，改这里之前先对一遍）：
// - wikiwiki「応急修理要員」：「1艦娘が1戦闘中に複数消費することは無い」
//   「ダメコンによって復活した戦闘は、戦闘開始時は大破でなかったものと同じ扱いに
//   なるため、その戦闘中に再度轟沈することは無い」
// - KC3Kai BattlePrediction.js：`Ship.takeDamage` 第一句
//   `if (ship.dameConConsumed && ship.hp - damage <= 0) { return ship; }`，
//   `Ship.tryDamecon` 里 TEAM → `Math.floor(ship.maxHp * 0.2)`、GODDESS → `ship.maxHp`
// - KC3Kai/kancolle-replay kcsim.js `takeDamage`：`repairs.shift()` 之后
//   `if (ship.side==0) ship.protection = true`；42 → `Math.floor(.2*ship.maxHP)`、
//   43 → `ship.HP = ship.maxHP`
//
// 「一场」= 一个 BattleView：昼战 parseBattle + 夜战 mergeNight 共用同一批舰对象。
// kcsim 里 protection 也是到本节点战斗结算才复位，昼夜同属一场，口径一致。
import assert from 'node:assert/strict'
import test from 'node:test'

import battle from '../dist/main/mg/battle.js'
import verdict from '../dist/shared/taiha-verdict.js'

const { mergeNight, parseBattle } = battle

const HP_MAX = 47 // 两成 = 9，五成 = 23：故意选一个能把「20%」和「50%」分开的数

const fleetWith = (equipmentByPosition) => (deckId) =>
  Array.from({ length: 6 }, (_, i) => ({
    rosterId: deckId * 100 + i,
    mstId: deckId * 100 + i,
    name: `D${deckId}-${i + 1}`,
    lv: 1,
    nowHp: HP_MAX,
    maxHp: HP_MAX,
    equipments: deckId === 1 ? (equipmentByPosition[i] ?? []) : [],
  }))

const ctxWith = (equipmentByPosition) => ({
  fleetShips: fleetWith(equipmentByPosition),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => 0,
})

/** 敌方第 0 舰打我方第 `target` 舰一发。 */
const enemyShelling = (target, damage) => ({
  api_at_list: [0],
  api_at_eflag: [1],
  api_at_type: [0],
  api_sp_list: [0],
  api_df_list: [[target]],
  api_damage: [[damage]],
  api_cl_list: [[damage > 0 ? 1 : 0]],
})

const dayBody = (nowhps, extra = {}) => ({
  api_deck_id: 1,
  api_f_nowhps: nowhps,
  api_f_maxhps: Array(6).fill(HP_MAX),
  api_ship_ke: Array.from({ length: 6 }, (_, i) => 1501 + i),
  api_ship_lv: Array(6).fill(1),
  api_e_nowhps: Array(6).fill(100),
  api_e_maxhps: Array(6).fill(100),
  api_formation: [1, 1, 1],
  ...extra,
})

const day = (nowhps, extra, ctx) =>
  parseBattle('/kcsapi/api_req_sortie/battle', dayBody(nowhps, extra), ctx, 0)

const startRepairBattle = ({ equipments = [{ instanceId: 9001, mstId: 43 }], position = 0,
  nowHp = 4, maxHp = 39, hpStart = 39, api = '/kcsapi/api_req_sortie/battle', extra = {} } = {}) => {
  const ctx = ctxWith({ [position]: equipments })
  const fleetShips = ctx.fleetShips
  ctx.fleetShips = deckId => fleetShips(deckId).map((ship, i) => i === position ? { ...ship, nowHp, maxHp } : ship)
  const hps = Array(6).fill(HP_MAX)
  const maxhps = Array(6).fill(HP_MAX)
  hps[position] = hpStart
  maxhps[position] = 39
  return parseBattle(api, dayBody(hps, { api_f_maxhps: maxhps, ...extra }), ctx, 0)
}

for (const [mstId, hpStart] of [[43, 39], [42, 19]]) {
  test(`旗舰大破进击：${mstId} 开战恢复 ${hpStart}/39，独立记录种类与实例`, () => {
    const ship = startRepairBattle({ equipments: [{ instanceId: 9001, mstId }], hpStart }).fShips[0]
    assert.equal(ship.repairItemUsedAtStart, mstId)
    assert.equal(ship.repairItemInstanceAtStart, 9001)
    assert.equal(ship.repairItemUsed, null)
    assert.equal(ship.hpStart, hpStart)
    assert.equal(ship.hpEnd, hpStart)
    assert.deepEqual(ship.equipment, [])
    assert.equal(verdict.dameconOfShip(ship), null, '开战已消耗的实例不能再算作可用损管')
  })
}

for (const [label, options, position] of [
  ['非旗舰', { position: 1 }, 1],
  ['未带损管', { equipments: [] }, 0],
  ['上一份不是大破', { nowHp: 20 }, 0],
  ['没有恢复', { hpStart: 4 }, 0],
  ['零耐久上下文', { nowHp: 0 }, 0],
  ['非正最大耐久', { maxHp: 0 }, 0],
  ['演习', { api: '/kcsapi/api_req_practice/battle' }, 0],
  ['退避索引', { extra: { api_escape_idx: [1] } }, 0],
  ['退避耐久', { hpStart: -1 }, 0],
  ['只有女神却未回满', { hpStart: 19 }, 0],
]) test(`开战消耗排除：${label}`, () => {
  const ship = startRepairBattle(options).fShips[position]
  assert.equal(ship.repairItemUsedAtStart, null)
  assert.equal(ship.repairItemInstanceAtStart, null)
  assert.equal(ship.repairItemUsed, null)
})

for (const [hpStart, mstId, instanceId, equipments] of [
  [39, 43, 9002, [{ instanceId: 9001, mstId: 42 }, { instanceId: 9002, mstId: 43 }]],
  [19, 42, 9002, [{ instanceId: 9001, mstId: 43 }, { instanceId: 9002, mstId: 42 }]],
]) test(`两种损管混装：开战 ${hpStart}/39 按恢复量选 ${mstId}，不选第一格`, () => {
  const ship = startRepairBattle({ hpStart, equipments }).fShips[0]
  assert.equal(ship.repairItemUsedAtStart, mstId)
  assert.equal(ship.repairItemInstanceAtStart, instanceId)
  assert.equal(ship.repairItemUsed, null)
  assert.equal(verdict.dameconOfShip(ship), equipments[0].mstId, '应保留未消耗的第一格')
  assert.deepEqual(ship.equipment.map(item => item.instanceId), [equipments[0].instanceId])
})

test('开战消耗后同场归零：第二枚照旧发动，已消耗的女神不能再用', () => {
  const result = startRepairBattle({
    equipments: [{ instanceId: 9001, mstId: 43 }, { instanceId: 9002, mstId: 42 }],
    extra: { api_hougeki1: enemyShelling(0, 50), api_hougeki2: enemyShelling(0, 50) },
  })
  const ship = result.fShips[0]
  assert.equal(ship.repairItemUsedAtStart, 43)
  assert.equal(ship.repairItemInstanceAtStart, 9001)
  assert.equal(ship.hpStart, 39)
  assert.equal(ship.repairItemUsed, 42)
  assert.equal(verdict.dameconOfShip(ship), null, '开战与战斗中各消耗一枚后不再有可用损管')
  assert.equal(result.attacks[0].hits[0].repairItem, 42)
  assert.equal(result.attacks[1].hits[0].repairItem, null)
  assert.equal(ship.hpEnd, 1)
  assert.equal(ship.sunk, false)
})

test('仅开战消耗不赋予轰沈保护，也不能重复消耗同一实例', () => {
  const result = startRepairBattle({ extra: { api_hougeki1: enemyShelling(0, 50) } })
  assert.equal(result.fShips[0].repairItemUsedAtStart, 43)
  assert.equal(result.fShips[0].repairItemUsed, null)
  assert.equal(result.fShips[0].hpEnd, 0)
  assert.equal(result.fShips[0].sunk, true)
})

for (const api of ['api_req_sortie/airbattle', 'api_req_sortie/ld_airbattle', 'api_req_battle_midnight/sp_midnight',
  'api_req_combined_battle/battle', 'api_req_combined_battle/battle_water', 'api_req_combined_battle/each_battle',
  'api_req_combined_battle/ec_battle', 'api_req_combined_battle/sp_midnight']) {
  test(`${api} 共用主队旗舰开战判定`, () => {
    const result = startRepairBattle({ api: `/kcsapi/${api}` })
    assert.equal(result.fShips[0].repairItemUsedAtStart, 43)
    assert.equal(result.fShips[0].repairItemInstanceAtStart, 9001)
    assert.equal(result.fShips[0].repairItemUsed, null)
  })
}

test('联合二队旗舰开战恢复不判消耗，主队旗舰仍判', () => {
  const ctx = ctxWith({ 0: [{ instanceId: 9001, mstId: 43 }] })
  const fleetShips = ctx.fleetShips
  ctx.fleetShips = deckId => fleetShips(deckId).map((ship, i) => i === 0
    ? { ...ship, nowHp: 4, maxHp: 39, equipments: [{ instanceId: 9000 + deckId, mstId: 43 }] } : ship)
  const result = parseBattle('/kcsapi/api_req_combined_battle/battle', dayBody([39], {
    api_f_maxhps: [39], api_f_nowhps_combined: [39], api_f_maxhps_combined: [39],
  }), ctx, 0)
  assert.equal(result.fShips[0].repairItemUsedAtStart, 43)
  assert.equal(result.fShips[1].fleet, 'escort')
  assert.equal(result.fShips[1].position, 0)
  assert.equal(result.fShips[1].repairItemUsedAtStart, null)
  assert.equal(result.fShips[1].repairItemInstanceAtStart, null)
})

test('要員回两成、女神回满，旗艦位也没有例外', () => {
  // 旗舰（0 号位）带要員、2 号位带女神，同一场各挨一发致死伤害。
  const result = day(
    [10, HP_MAX, 5, HP_MAX, HP_MAX, HP_MAX],
    {
      api_hougeki1: enemyShelling(0, 30),
      api_hougeki2: enemyShelling(2, 30),
    },
    ctxWith({ 0: [{ instanceId: 9001, mstId: 42 }], 2: [{ instanceId: 9002, mstId: 43 }] }),
  )

  assert.equal(result.fShips[0].repairItemUsed, 42)
  assert.equal(result.fShips[0].hpEnd, Math.floor(HP_MAX / 5), '要員应回最大耐久的两成')
  // wikiwiki 那句「50％程度まで耐久値を回復し、中破状態に戻る」是
  // 「旗艦装備時の効果」——旗舰大破进击时开战前消耗的那一枚，落在 hpStart 上，
  // 不是战斗中归零发动这一路。这一层不许给旗舰开半血特例。
  assert.notEqual(result.fShips[0].hpEnd, Math.floor(HP_MAX / 2))
  assert.equal(result.fShips[0].sunk, false)

  assert.equal(result.fShips[2].repairItemUsed, 43)
  assert.equal(result.fShips[2].hpEnd, HP_MAX, '女神应回满血')
  assert.equal(result.fShips[2].sunk, false)
})

test('同一场里带两枚也只消耗一枚，发动过的舰不再被打沉', () => {
  const result = day(
    [10, HP_MAX, HP_MAX, HP_MAX, HP_MAX, HP_MAX],
    {
      api_hougeki1: enemyShelling(0, 30),
      api_hougeki2: enemyShelling(0, 30),
    },
    ctxWith({
      0: [
        { instanceId: 9001, mstId: 42 },
        { instanceId: 9002, mstId: 42 },
      ],
    }),
  )

  const revived = Math.floor(HP_MAX / 5)
  // 第一发：正常发动，回两成
  assert.equal(result.attacks[0].hits[0].repairItem, 42)
  assert.equal(result.attacks[0].hits[0].damage, 30)
  assert.equal(result.attacks[0].hits[0].sunk, false)

  // 第二发：第二枚不消耗，也不沉——伤害被削到「刚好留 1」
  assert.equal(result.attacks[1].hits[0].repairItem, null, '第二枚被消耗了')
  assert.equal(result.attacks[1].hits[0].sunk, false)
  assert.equal(result.attacks[1].hits[0].damage, revived - 1)
  assert.equal(result.fShips[0].hpEnd, 1)
  assert.equal(result.fShips[0].sunk, false)
  assert.equal(result.fShips[0].defeated, false)

  // hits[].damage 必须和 hpEnd、攻击方 damageDealt 三者自洽：
  // 血条时间轴是照 hits[].damage 重放的，削了伤害就得削到底。
  assert.equal(result.eShips[0].damageDealt, 30 + (revived - 1))
  assert.equal(
    result.fShips[0].hpStart -
      result.attacks.flatMap((a) => a.hits).filter((h) => h.target === 0).reduce((s, h) => s + h.damage, 0),
    10 - 30 - (revived - 1),
  )
})

test('昼战发动过的舰，夜战既不吃第二枚也不沉', () => {
  const ctx = ctxWith({
    0: [
      { instanceId: 9001, mstId: 42 },
      { instanceId: 9002, mstId: 42 },
    ],
  })
  const prev = day(
    [10, HP_MAX, HP_MAX, HP_MAX, HP_MAX, HP_MAX],
    { api_hougeki1: enemyShelling(0, 30) },
    ctx,
  )
  const revived = Math.floor(HP_MAX / 5)
  assert.equal(prev.fShips[0].repairItemUsed, 42)
  assert.equal(prev.fShips[0].hpEnd, revived)

  const merged = mergeNight(
    prev,
    {
      api_deck_id: 1,
      api_f_nowhps: [revived, HP_MAX, HP_MAX, HP_MAX, HP_MAX, HP_MAX],
      api_e_nowhps: Array(6).fill(100),
      api_hougeki: enemyShelling(0, 30),
    },
    ctx,
    1,
  )

  const nightHit = merged.attacks.at(-1).hits[0]
  assert.equal(nightHit.repairItem, null, '夜战又消耗了第二枚')
  assert.equal(nightHit.sunk, false)
  assert.equal(nightHit.damage, revived - 1)
  assert.equal(merged.fShips[0].hpEnd, 1)
  assert.equal(merged.fShips[0].sunk, false)
})

// 反面：上面三条如果只是「夜战一律不发动」「有道具就不沉」也能绿，
// 所以把没发动过的两种情形也钉住。
test('没发动过的舰在夜战照常发动；没有道具的舰照常沉', () => {
  const ctx = ctxWith({ 0: [{ instanceId: 9001, mstId: 42 }] })
  const prev = day([10, HP_MAX, HP_MAX, HP_MAX, HP_MAX, HP_MAX], {}, ctx)
  assert.equal(prev.fShips[0].repairItemUsed, null, '昼战不该动过道具')

  const merged = mergeNight(
    prev,
    {
      api_deck_id: 1,
      api_f_nowhps: [10, HP_MAX, HP_MAX, HP_MAX, HP_MAX, HP_MAX],
      api_e_nowhps: Array(6).fill(100),
      api_hougeki: enemyShelling(0, 30),
    },
    ctx,
    1,
  )
  assert.equal(merged.fShips[0].repairItemUsed, 42)
  assert.equal(merged.fShips[0].hpEnd, Math.floor(HP_MAX / 5))
  assert.equal(merged.fShips[0].sunk, false)

  // 同样的两发，身上没有道具：第一发就该沉，伤害不许被削
  const bare = day(
    [10, HP_MAX, HP_MAX, HP_MAX, HP_MAX, HP_MAX],
    { api_hougeki1: enemyShelling(0, 30), api_hougeki2: enemyShelling(0, 30) },
    ctxWith({}),
  )
  assert.equal(bare.fShips[0].sunk, true)
  assert.equal(bare.fShips[0].hpEnd, 0)
  assert.equal(bare.attacks[0].hits[0].damage, 30)
  assert.equal(bare.attacks[0].hits[0].sunk, true)
})
