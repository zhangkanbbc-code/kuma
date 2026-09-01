// 对潜空袭（対潜空襲マス）：敌潜艇 + 一条退在后方、**不可攻击**的空母系。
//
// 它走的是通常战端点、进点报文的 api_event_kind 也是 1，所以在这条护栏立起来之前
// kuma 把它落进「通常战」。判据只能从战斗包自己身上取：后方那条空母没有 HP，
// api_e_nowhps / api_e_maxhps 对应位上是字符串 "N/A" 而不是数字。
// 两家开源实现各自独立用的都是这一条（KC3改 BattlePrediction.js 的 `isNaN(ship.hp)`、
// poi lib-battle simulator.ts 的 `typeof rawMaxHP !== "number"`），出处与原文抄在
// src/main/mg/battle.ts 的 isSubAirRaid 头注里。
//
// 真报文取自 test/fixtures/battle-field-coverage.json 的 sortie-battle-sub-air-raid
// （账本本身不入仓；夹具里只有 api_data，api_token 在 post_body、没跟进来）。
// **不断言源码文本**：判据写反了、加档时漏了某一处分支，正则一条也拦不住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import { battleTypeLabel, battleForecastLead, isDamageOnlyBattle, isDayFlowBattle } from './fixtures/di-battle-type.mjs'
import { renderBrow } from './fixtures/render-di-battle.mjs'

const { parseBattle, upgradeBattleView } = battleModule

const load = (file) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
const pick = (name) => {
  const found = load('battle-field-coverage.json').find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

const ctx = () => ({
  fleetShips: (deckId) =>
    Array.from({ length: 7 }, (_unused, i) => ({
      rosterId: deckId * 100 + i,
      mstId: deckId * 100 + i,
      name: `D${deckId}-${i + 1}`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => 0,
})

const parseFixture = (mutate) => {
  const one = pick('sortie-battle-sub-air-raid')
  if (mutate) mutate(one.battle)
  return parseBattle(one.path, one.battle, ctx(), 0)
}

/** 把那两位 "N/A" 换成数字：同一份报文当场退回普通昼战。 */
const asPlainNumbers = (battle) => {
  battle.api_e_nowhps = battle.api_e_nowhps.map((hp) => (typeof hp === 'number' ? hp : 40))
  battle.api_e_maxhps = battle.api_e_maxhps.map((hp) => (typeof hp === 'number' ? hp : 40))
}

const stageLabelOf = (view, phase) => view.stages.find((stage) => stage.phase === phase)?.label

test('对潜空袭按「敌方 HP 有一位不是数字」认，落 subAirRaid 而不是通常战', () => {
  const view = parseFixture()
  assert.equal(view.kind, 'subAirRaid')
  // 端点就是通常战那一个——认它靠的不是路径
  assert.equal(pick('sortie-battle-sub-air-raid').path, '/kcsapi/api_req_sortie/battle')

  // 修这条之前落的是 'day'（战型名写成「通常战」）。把那两位 "N/A" 换成数字，
  // 同一份报文立刻退回旧结果——判据真的只压在这一处上，而不是别的什么巧合。
  const asNumbers = parseFixture(asPlainNumbers)
  assert.equal(asNumbers.kind, 'day')

  // 藏 HP 的可以不止一条（poi 自带的 62-3 样本是两条），多一条照样认得出
  const twoHidden = parseFixture((battle) => {
    battle.api_ship_ke = [...battle.api_ship_ke, 1776]
    battle.api_ship_lv = [...battle.api_ship_lv, 1]
    battle.api_e_nowhps = [...battle.api_e_nowhps, 'N/A']
    battle.api_e_maxhps = [...battle.api_e_maxhps, 'N/A']
    battle.api_eSlot = [...battle.api_eSlot, [-1, -1, -1, -1, -1]]
    battle.api_eParam = [...battle.api_eParam, [15, 0, 15, 35]]
  })
  assert.equal(twoHidden.kind, 'subAirRaid')

  // 敌方 HP 全是数字的普通昼战不能被顺手认成对潜空袭
  assert.equal(parseBattle(
    '/kcsapi/api_req_sortie/battle',
    pick('sortie-battle-balloon').battle,
    ctx(),
    0,
  ).kind, 'day')
})

test('对潜空袭不是纯挨打型：有我方先制对潜与炮击，胜负照旧按击沉算', () => {
  const view = parseFixture()

  // 流水：敌方单方面空袭 → 我方先制对潜 → 开幕雷击 → 炮击
  assert.deepEqual(
    view.stages.map((stage) => stage.phase),
    ['air', 'openingAsw', 'openingTorp', 'gun1'],
  )
  assert.equal(view.air.fCount, 0, '我方一架没放')
  assert.ok(view.air.eCount > 0, '敌方来袭')

  // 后方那条空母进了舰表（要画在敌方一侧），但 hpStart 为 0，
  // 不进评级的敌舰表——与 KC3改把 isNaN 的舰记成 hp 0 / sunk、
  // poi 把 hpUnknown 的舰跳过，是同一个结果。
  assert.equal(view.eShips.length, 4)
  const hidden = view.eShips[3]
  assert.equal(hidden.hpStart, 0)
  assert.equal(hidden.hpMax, 1, 'KC3改注释里的「internal hp is 1」')
  assert.equal(hidden.sunk, false, '它没被打沉，只是没有 HP')

  // 同场 battleresult 的游戏字节：api_win_rank=S、api_dests=3（只数潜艇）
  assert.equal(view.prediction.eCount, 3)
  assert.equal(view.prediction.eSunk, 3)
  assert.equal(view.prediction.rank, 'S')
  assert.equal(view.prediction.sure, true)

  // 评级不能走「只看我方损害率」那一路：那条路会把它算成空袭战
  assert.equal(isDamageOnlyBattle(view), false)
  assert.equal(isDayFlowBattle(view), true, '流程与通常昼战同一套')
})

test('打不到的那一位在解析处就带标，判据压在报文的 "N/A" 上', () => {
  const flagged = parseFixture().eShips.filter((ship) => ship.unattackable === true)
  assert.equal(flagged.length, 1)
  assert.equal(flagged[0].index, 3, '后方那条空母')
  // 0/1 是这一位兜出来的假数，标就是为了让显示层分得清「被打成 0」和「打不到」
  assert.equal(flagged[0].hpStart, 0)
  assert.equal(flagged[0].hpMax, 1)

  // 换成数字，同一份报文一个标也不剩——不是从 hpMax===1 之类的形状反推出来的
  assert.equal(parseFixture(asPlainNumbers).eShips.some((ship) => ship.unattackable), false)
  // 敌方 HP 全是数字的普通昼战照旧一个都不标
  assert.equal(
    parseBattle('/kcsapi/api_req_sortie/battle', pick('sortie-battle-balloon').battle, ctx(), 0)
      .eShips.some((ship) => ship.unattackable),
    false,
  )
})

test('打不到的那一位画成灰态、血条位不画血条', () => {
  const view = parseFixture()
  const hidden = view.eShips[3]
  const html = renderBrow(view, 1, hidden)
  assert.match(html, /class="brow[^"]*\bunattackable\b/, '整行灰化的类')
  assert.match(html, /敌后方/)
  // 假数一个都不许露脸；空轨也不能被当成残血涂色
  assert.equal(/0\/1/.test(html), false, '「0/1」不是这条舰的血量')
  assert.equal(/class="rm /.test(html), false, '实血那一截不画')
  assert.match(html, /data-damaged="0"/, '受损立绘也不按假数换')

  // 同场打得到的那几条照旧是完整血条
  const sub = renderBrow(view, 1, view.eShips[0])
  assert.equal(/unattackable/.test(sub), false)
  assert.match(sub, /class="rm /)
})

test('流水段标签：对潜空袭那一段叫「敌空袭」，普通昼战仍叫「第一航空战」', () => {
  assert.equal(stageLabelOf(parseFixture(), 'air'), '敌空袭')
  // 只对 subAirRaid 改：同一份报文退回 'day'，标签也退回去
  assert.equal(stageLabelOf(parseFixture(asPlainNumbers), 'air'), '第一航空战')
  // 真的普通昼战（双方对轰的第一航空战）不受影响
  const day = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    pick('sortie-battle-balloon').battle,
    ctx(),
    0,
  )
  assert.equal(day.kind, 'day')
  assert.equal(stageLabelOf(day, 'air'), '第一航空战')
})

test('战型名：拂晓战、对潜空袭战；认不出的旧档退回通常战', async () => {
  assert.equal(battleTypeLabel({ kind: 'subAirRaid', hasNight: false }), '对潜空袭战')
  assert.equal(battleForecastLead({ kind: 'subAirRaid', hasNight: false }), '对潜空袭战')
  // 官方「払暁戦」——原先写的是「夜战转昼」
  assert.equal(battleTypeLabel({ kind: 'nightday', hasNight: true }), '拂晓战')

  // 旧快照兜底：历史场次记的还是旧值，认不出的一律退回通常战／昼战转夜，不能炸
  assert.equal(battleTypeLabel({ kind: 'ldair', hasNight: false }), '通常战')
  assert.equal(battleTypeLabel({ kind: 'ldair', hasNight: true }), '昼战转夜')
  assert.equal(isDamageOnlyBattle({ kind: 'ldair' }), false)
  assert.equal(isDayFlowBattle({ kind: 'ldair' }), false)

  // 单阶段节点，没有昼夜换基准；真合并了夜战包才跟 day 一样分段
  const m = await import('../dist/shared/battle-phase-damage.js')
  const { battlePhaseOrder } = m.default ?? m
  assert.equal(battlePhaseOrder('subAirRaid', false), null)
  assert.deepEqual(battlePhaseOrder('subAirRaid', true), { first: 'day', second: 'night' })
})

test('旧快照不重算：升级后 kind 保持原样，不会被新判据改写', () => {
  // 2026-08-31 之前打的这类场次存的是 'day'。与既有口径一致（旧快照只补字段不重判战型），
  // upgradeBattleView 只认 'ldair' 那一条历史迁移。
  const legacy = structuredClone(parseFixture())
  legacy.kind = 'day'
  const upgraded = upgradeBattleView(legacy)
  assert.equal(upgraded.kind, 'day')
  // 评级不受战型改写影响：藏 HP 的舰本来就不在敌舰表里
  assert.equal(upgraded.prediction.rank, 'S')
  assert.equal(upgraded.prediction.eCount, 3)
})
