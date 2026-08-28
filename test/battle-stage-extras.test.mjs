// 战斗流水里补的两件小事：**支援舰队点名**（api_support_info.api_support_hourai 的
// api_deck_id / api_ship_id）与 **阻塞气球格**（api_balloon_cell）。
//
// 支援舰队**不在这场的我方舰表里**（它不参战、没有 HP 行），所以只能按 mstId 记，
// 拿舰位去查会取到本队同位置的另一条舰——这条是这一段最容易写错的地方。
// 阻塞气球是**推断级**：判据只有字段名 + 账本实证（887 行 12 次为 1，全部集中在
// 同一次活动出击、昼夜包成对出现），没找到文档佐证。
//
// 真报文取自 test/fixtures/battle-field-coverage.json（账本本身不入仓）；
// 渲染侧把 di.ts 的对应段原样切出来跑，断言产物 HTML。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import {
  airOf,
  battleOf,
  renderAirline,
  renderLog,
  stageOf,
} from './fixtures/render-di-battle.mjs'

const { parseBattle, upgradeBattleView } = battleModule

const load = (file) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
const battleFixtures = load('battle-field-coverage.json')
const pick = (list, name) => {
  const found = list.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

const ctx = (combinedType = 1) => ({
  fleetShips: (deckId) =>
    Array.from({ length: 6 }, (_, i) => ({
      rosterId: deckId * 100 + i,
      mstId: deckId * 100 + i,
      name: `D${deckId}-${i + 1}`,
      lv: 1,
      nowHp: 50,
      maxHp: 50,
      equipments: [],
    })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => combinedType,
})
const parseBattleFixture = (name, mutate) => {
  const one = pick(battleFixtures, name)
  if (mutate) mutate(one.battle)
  return parseBattle(one.path, one.battle, ctx(), 0)
}

// ---- 支援舰队点名 ----

test('真报文：支援炮击那一段记下第几舰队与六条舰的 mstId', () => {
  const view = parseBattleFixture('each-battle-support')
  const stage = view.stages.find((one) => one.phase === 'support')
  assert.ok(stage, '支援阶段应当在')
  assert.deepEqual(stage.support, {
    deckId: 3,
    shipMstIds: [711, 3224, 4460, 2460, 983, 202],
  })
})

test('支援编成缺席（旧报文 / 支援航空）：不写这个键', () => {
  const view = parseBattleFixture('each-battle-support', (battle) => {
    delete battle.api_support_info.api_support_hourai.api_deck_id
    delete battle.api_support_info.api_support_hourai.api_ship_id
  })
  const stage = view.stages.find((one) => one.phase === 'support')
  assert.equal(stage.support, undefined)
  // 支援伤害本身照旧结算
  assert.ok(view.attacks.some((attack) => attack.phase === 'support'))
})

test('渲染：支援编成前三名摆行内、全员进悬停，一行不撑爆', () => {
  const html = renderLog(
    battleOf({
      stages: [
        stageOf(0, '支援舰队', null, {
          phase: 'support',
          source: 'api_support_info',
          support: { deckId: 3, shipMstIds: [711, 3224, 4460, 2460, 983, 202] },
        }),
      ],
    }),
    true,
  )
  assert.match(html, /第3舰队/)
  assert.match(html, /等6舰/)
  assert.equal((html.match(/711/g) ?? []).length >= 1, true)
})

test('渲染：没有支援编成就不出这一行', () => {
  const html = renderLog(
    battleOf({ stages: [stageOf(0, '支援舰队', null, { phase: 'support' })] }),
    true,
  )
  assert.ok(!html.includes('支援编成'))
})

// ---- 阻塞气球 ----

test('真报文：亮着就记，缺省/0 一律当没有', () => {
  assert.equal(parseBattleFixture('sortie-battle-balloon').balloonCell, true)
  assert.equal(parseBattleFixture('sortie-battle-rescue').balloonCell, undefined)
  const off = parseBattleFixture('sortie-battle-balloon', (battle) => {
    battle.api_balloon_cell = 0
  })
  assert.equal(off.balloonCell, undefined)
  assert.ok(!JSON.stringify(off).includes('balloonCell'))
})

test('渲染：抬头标一句，没亮就零痕迹', () => {
  assert.match(renderAirline(battleOf({ balloonCell: true })), /阻塞气球 <b>已触发<\/b>/)
  assert.ok(!renderAirline(battleOf({ smokeType: 1 })).includes('阻塞气球'))
})

// ---- 旧快照 ----

test('旧快照一个新键都没有：升级回放不报错也不凭空造', () => {
  const snapshot = structuredClone(parseBattleFixture('sortie-battle-rescue'))
  delete snapshot.balloonCell
  delete snapshot.airBaseRescue
  for (const voice of snapshot.flavorVoices) delete voice.className
  for (const stage of snapshot.stages) delete stage.support
  const upgraded = upgradeBattleView(snapshot)
  assert.ok(upgraded)
  assert.equal(upgraded.balloonCell, undefined)
  assert.equal(upgraded.flavorVoices[0].className, undefined)
  const html = renderAirline(upgraded)
  assert.ok(!html.includes('阻塞气球'))
})

test('渲染：航空段的分母键缺失时，抬头那几个数照旧对得上', () => {
  const air = airOf({ fCount: 18, fLost: 2, eCount: 30, eLost: 5, fLost2: 1, eLost2: 4 })
  const html = renderAirline(battleOf({ air, stages: [stageOf(0, '第一航空战', air)] }))
  assert.match(html, /我机 <b>18<\/b> vs 敌机 <b>30<\/b>/)
  assert.match(html, /我方机损 <b class="loss">3<\/b>/)
})
