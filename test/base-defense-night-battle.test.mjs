// 基地防空占位还挂在 sortie.battle 上时，紧接着到达的战斗包不许被「并」进去。
//
// 防空结算不是独立端点，是 map/start、map/next 的 api_destruction_battle：
// 进点时先解析成一份 kind='baseDefense' 的视图占着位，等本格真的战斗包来了再替换。
// `onDayBattle` 无条件新建，天然没事；`onNightBattle` 要把夜战包并进昼战，
// 从前的排除表只有 hasNight / nightonly——防空点紧接開幕夜戦（sp_midnight）时
// 夜战就并到防空视图上了，mergeNight 的 anchor 会拿夜战的 api_f_nowhps
// 直接改写那三列「基地耐久」。这份护栏钉的就是这条，外加一条对照防止排除写宽。
//
// 归约器是从 store.ts 里原样切出来真编译的（见 fixtures/store-battle-reducers.mjs），
// 不是正则匹配源码文本——判断写反了这里会当场红。
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  feedDayBattle,
  feedNightBattle,
  reset,
  seedBaseDefense,
  sortie,
} from './fixtures/store-battle-reducers.mjs'

// 六人队的在籍 id 与夹具里的 fleetContext 同一套（deckId*100 + 位次）
const ROSTER = { 100: 50, 101: 50, 102: 50, 103: 50, 104: 50, 105: 50 }

const shelling = (damage, side = 0) => ({
  api_at_list: [0],
  api_at_eflag: [side],
  api_at_type: [0],
  api_sp_list: [0],
  api_df_list: [[0]],
  api_damage: [[damage]],
  api_cl_list: [[damage > 0 ? 1 : 0]],
})

const battleBase = () => ({
  api_deck_id: 1,
  api_f_nowhps: [44, 50, 50, 50, 50, 50],
  api_f_maxhps: Array(6).fill(50),
  api_ship_ke: Array.from({ length: 6 }, (_unused, i) => 1501 + i),
  api_ship_lv: Array(6).fill(1),
  api_e_nowhps: Array(6).fill(100),
  api_e_maxhps: Array(6).fill(100),
  api_formation: [1, 1, 1],
})

// 真形状的进点内嵌防空结算：三列基地耐久 200/200/200，第 3 列吃 8 点 → 192。
// 与 core-regressions 里 parseBaseDefenseBattle 那条用的是同一份报文。
const destructionBattle = () => ({
  api_formation: [1, 3, 3],
  api_ship_ke: [1650, 2094, 2091],
  api_ship_lv: [1, 1, 1],
  api_e_nowhps: [500, 300, 300],
  api_e_maxhps: [500, 300, 300],
  api_eSlot: [[1561], [1625], [1574]],
  api_f_nowhps: [200, 200, 200],
  api_f_maxhps: [200, 200, 200],
  api_air_base_attack: {
    api_map_squadron_plane: {
      1: [
        { api_mst_id: 351, api_count: 18 },
        { api_mst_id: 221, api_count: 18 },
      ],
    },
    api_stage1: {
      api_f_count: 36,
      api_f_lostcount: 3,
      api_e_count: 48,
      api_e_lostcount: 31,
      api_disp_seiku: 2,
      api_touch_plane: [-1, -1],
    },
    api_stage2: null,
    api_stage3: {
      api_frai_flag: [0, 1, 0],
      api_erai_flag: [0, 0, 0],
      api_fbak_flag: [0, 1, 1],
      api_ebak_flag: [0, 0, 0],
      api_fcl_flag: [0, 0, 0],
      api_ecl_flag: [0, 0, 0],
      api_fdam: [0, 0, 8],
      api_edam: [0, 0, 0],
    },
  },
  api_lost_kind: 1,
})

const BASE_NAMES = ['第1基地航空队', '第2基地航空队', '第3基地航空队']

test('開幕夜戦不并进基地防空视图，基地耐久那三列一个字不动', () => {
  reset({ ships: { ...ROSTER } })
  const bd = seedBaseDefense(destructionBattle())

  // 前提：防空视图确实占着位，三列耐久是 200/200/192
  assert.equal(bd.kind, 'baseDefense')
  assert.equal(sortie().battle, bd)
  assert.equal(sortie().battleCount, 0)
  assert.deepEqual(bd.fShips.map((one) => one.hpEnd), [200, 200, 192])
  assert.deepEqual(bd.fShips.map((one) => one.name), BASE_NAMES)

  // 夜战包带的是舰队的 HP（44/50…），跟基地耐久完全不同一码事——
  // 一旦被并进去，那三列会被改写成这些数。
  const night = { ...battleBase(), api_hougeki: shelling(30, 1) }
  assert.notEqual(night.api_f_nowhps[0], 200)

  feedNightBattle('/kcsapi/api_req_battle_midnight/sp_midnight', night)

  // 夜战自立为新 battle：替换而非 merge，battleCount 照 onDayBattle 的口径 +1
  const now = sortie().battle
  assert.notEqual(now, bd)
  assert.equal(now.kind, 'nightonly')
  assert.equal(sortie().battleCount, 1)

  // 新视图里站的是舰队，不是三列基地
  assert.equal(now.fShips.length, 6)
  assert.ok(now.fShips.every((one) => !BASE_NAMES.includes(one.name)))
  assert.equal(now.fShips[0].name, 'D1-1')

  // 防空视图本身没被 mergeNight 就地改过（anchor 是直接写 prev.fShips 的）
  assert.deepEqual(bd.fShips.map((one) => one.hpEnd), [200, 200, 192])
  assert.deepEqual(bd.fShips.map((one) => one.name), BASE_NAMES)
  assert.equal(bd.hasNight, false)
  assert.equal(bd.kind, 'baseDefense')
})

test('联合舰队的 sp_midnight 端点同样不并进防空视图', () => {
  reset({ ships: { ...ROSTER } })
  const bd = seedBaseDefense(destructionBattle())

  feedNightBattle('/kcsapi/api_req_combined_battle/sp_midnight', {
    ...battleBase(),
    api_hougeki: shelling(30, 1),
  })

  assert.equal(sortie().battle.kind, 'nightonly')
  assert.equal(sortie().battleCount, 1)
  assert.deepEqual(bd.fShips.map((one) => one.hpEnd), [200, 200, 192])
})

test('防空视图在场时昼战包也是替换——两个入口对同一情形口径一致', () => {
  reset({ ships: { ...ROSTER } })
  const bd = seedBaseDefense(destructionBattle())

  feedDayBattle('/kcsapi/api_req_sortie/battle', {
    ...battleBase(),
    api_hougeki1: shelling(12),
  })

  assert.equal(sortie().battle.kind, 'day')
  assert.equal(sortie().battleCount, 1)
  assert.equal(sortie().battle.fShips.length, 6)
  assert.deepEqual(bd.fShips.map((one) => one.hpEnd), [200, 200, 192])
})

test('正常昼战之后的夜战照旧 merge（排除别写宽了）', () => {
  reset({ ships: { ...ROSTER } })

  feedDayBattle('/kcsapi/api_req_sortie/battle', {
    ...battleBase(),
    api_hougeki1: shelling(12),
  })
  const day = sortie().battle
  assert.equal(day.kind, 'day')
  assert.equal(day.hasNight, false)
  assert.equal(sortie().battleCount, 1)
  const dayAttacks = day.attacks.length
  const dayStages = day.stages.length

  feedNightBattle('/kcsapi/api_req_battle_midnight/battle', {
    ...battleBase(),
    api_hougeki: shelling(30, 1),
  })

  // 并进去了：还是同一场（battleCount 不涨、kind 仍是 day），只是接上了夜战段
  const merged = sortie().battle
  assert.equal(sortie().battleCount, 1)
  assert.equal(merged.kind, 'day')
  assert.equal(merged.hasNight, true)
  assert.ok(merged.attacks.length > dayAttacks)
  assert.ok(merged.stages.length > dayStages)
})

test('已经并过夜战 / 开幕夜战在场时，第二个夜战包仍然自立为新战斗', () => {
  reset({ ships: { ...ROSTER } })

  // 开幕夜战（nightonly）在场
  feedNightBattle('/kcsapi/api_req_battle_midnight/sp_midnight', {
    ...battleBase(),
    api_hougeki: shelling(30, 1),
  })
  assert.equal(sortie().battle.kind, 'nightonly')
  assert.equal(sortie().battleCount, 1)

  // 下一格又来一个夜战包：不并，新建
  feedNightBattle('/kcsapi/api_req_battle_midnight/battle', {
    ...battleBase(),
    api_hougeki: shelling(30, 1),
  })
  assert.equal(sortie().battleCount, 2)
})
