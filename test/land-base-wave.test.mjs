// 陆航那一段的两件事：**波次按基地编号**（api_air_base_attack[].api_base_id）
// 与**卡特琳娜救援**（api_air_base_rescue_type）。
//
// 解析侧用真报文（test/fixtures/battle-field-coverage.json，账本本身不入仓）：
// - `each-battle-support` 那次出击四波陆航的 base_id 是 [2,2,3,3]——按全局波次会写成
//   「第 3 波」「第 4 波」，其实那是第 3 基地自己的第 1、2 波。这条正是这次接线要修的。
// - `sortie-battle-rescue` 的 api_air_base_rescue_type=2（两个救助气泡）。
//
// **别在任何地方写触发条件**：PBY-5A Catalina 只是必要不充分——账本 32/32 场都带着它、
// 每场只装 1 格就触发过（「要带 ≥3 架」那个说法已被账本证伪），带了却没触发的对照有 8 次。
//
// 渲染侧把 logHtml 原样切出来跑，断言产物 HTML。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import { airOf, battleOf, renderLog, stageOf } from './fixtures/render-di-battle.mjs'

const { parseBattle, mergeNight, upgradeBattleView } = battleModule

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-field-coverage.json', import.meta.url), 'utf8'),
)
const fixtureOf = (name) => {
  const found = fixtures.find((one) => one.name === name)
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

const parseFixture = (name, mutate) => {
  const one = fixtureOf(name)
  if (mutate) mutate(one.battle)
  return parseBattle(one.path, one.battle, ctx(), 0)
}
const lbasLabels = (view) =>
  view.stages.filter((stage) => stage.phase === 'lbas').map((stage) => stage.label)

// ---- 解析：波次按基地编号 ----

test('真报文：[2,2,3,3] 四波数成「第2基地第1/2波、第3基地第1/2波」', () => {
  const one = fixtureOf('each-battle-support')
  assert.deepEqual(
    one.battle.api_air_base_attack.map((wave) => wave.api_base_id),
    [2, 2, 3, 3],
    '真报文的基地编号变了，这条守卫的前提要重看',
  )
  const view = parseBattle(one.path, one.battle, ctx(), 0)
  assert.deepEqual(lbasLabels(view), [
    '第2基地第1波',
    '第2基地第2波',
    '第3基地第1波',
    '第3基地第2波',
  ])
  // 按全局波次数出来的那两句，正是这次要消灭的错
  assert.ok(!lbasLabels(view).includes('基地航空第3波'))
  assert.ok(!lbasLabels(view).includes('基地航空第4波'))
})

test('真报文：每一波自己也记着是第几基地', () => {
  const view = parseFixture('each-battle-support')
  assert.deepEqual(
    view.stages.filter((stage) => stage.phase === 'lbas').map((stage) => stage.airBaseId),
    [2, 2, 3, 3],
  )
})

test('真报文：同一基地连出两波，编号是 1、2 而不是 1、1', () => {
  const view = parseFixture('sortie-battle-rescue')
  assert.deepEqual(lbasLabels(view), ['第2基地第1波', '第2基地第2波'])
})

test('报文没给基地号（旧格式）：退回全局波次，不编一个基地号出来', () => {
  const view = parseFixture('each-battle-support', (battle) => {
    for (const wave of battle.api_air_base_attack) delete wave.api_base_id
  })
  assert.deepEqual(lbasLabels(view), [
    '基地航空第1波',
    '基地航空第2波',
    '基地航空第3波',
    '基地航空第4波',
  ])
  assert.ok(view.stages.every((stage) => stage.airBaseId === undefined))
})

test('基地号是非正数时当没给：不写 0 号基地', () => {
  const view = parseFixture('sortie-battle-rescue', (battle) => {
    for (const wave of battle.api_air_base_attack) wave.api_base_id = 0
  })
  assert.deepEqual(lbasLabels(view), ['基地航空第1波', '基地航空第2波'])
})

test('基地号不设上界：将来加到第 4 基地也照实显示', () => {
  const view = parseFixture('sortie-battle-rescue', (battle) => {
    battle.api_air_base_attack[0].api_base_id = 4
    battle.api_air_base_attack[1].api_base_id = 4
  })
  assert.deepEqual(lbasLabels(view), ['第4基地第1波', '第4基地第2波'])
})

// ---- 解析：卡特琳娜救援 ----

test('真报文：救助气泡数照实收', () => {
  const view = parseFixture('sortie-battle-rescue')
  assert.equal(view.airBaseRescue, 2)
})

test('字段整个不存在＝没发生：零痕迹，连键都不留', () => {
  const view = parseFixture('sortie-battle-rescue', (battle) => {
    delete battle.api_air_base_rescue_type
  })
  assert.equal(view.airBaseRescue, undefined)
  assert.ok(!JSON.stringify(view).includes('airBaseRescue'))
  // 同包其它解析不受连累
  assert.deepEqual(lbasLabels(view), ['第2基地第1波', '第2基地第2波'])
})

test('取值不设上界：apilist 写的是 1～3，账本只见过 1 和 2', () => {
  for (const value of [1, 2, 3]) {
    const view = parseFixture('sortie-battle-rescue', (battle) => {
      battle.api_air_base_rescue_type = value
    })
    assert.equal(view.airBaseRescue, value)
  }
})

test('夜战包不带这个字段时，昼战包立过的那面旗不许被抹掉', () => {
  // 救助本来就只在昼间的陆航段发生，夜战包不带它是常态，不是「没发生」
  const day = parseFixture('sortie-battle-rescue')
  assert.equal(day.airBaseRescue, 2)
  const night = mergeNight(
    day,
    {
      api_deck_id: 1,
      api_f_nowhps: [50, 50, 50, 50, 50, 50],
      api_e_nowhps: [50, 50, 50, 50, 50, 50],
      api_hougeki: { api_at_list: [] },
    },
    ctx(),
    1,
  )
  assert.equal(night.airBaseRescue, 2)
})

test('旧快照没有这个键：升级回放不报错也不凭空造', () => {
  const snapshot = structuredClone(parseFixture('sortie-battle-rescue'))
  delete snapshot.airBaseRescue
  const upgraded = upgradeBattleView(snapshot)
  assert.ok(upgraded)
  assert.equal(upgraded.airBaseRescue, undefined)
})

// ---- 渲染产物 ----

const withLbas = (patch = {}) =>
  battleOf({
    stages: [
      stageOf(0, '第2基地第1波', airOf(), { phase: 'lbas', airBaseId: 2 }),
      stageOf(1, '第3基地第1波', airOf(), { phase: 'lbas', airBaseId: 3 }),
      stageOf(2, '第一航空战', airOf()),
    ],
    ...patch,
  })

test('渲染：救援行挂在最后一波陆航之后，气泡数照实写', () => {
  const html = renderLog(withLbas({ airBaseRescue: 2 }), true)
  assert.match(html, /卡特琳娜救援/)
  assert.match(html, /×2/)
  // 挂在第 1 段（最后一波陆航）而不是第 0 段
  assert.match(html, /data-log-stage="1"[^>]*>[\s\S]{0,200}卡特琳娜救援/)
})

test('渲染：日文原词进悬停，不上一眼位置', () => {
  const html = renderLog(withLbas({ airBaseRescue: 1 }), true)
  assert.match(html, /title="日文原词：カタリナ救助活動"/)
  assert.ok(!html.includes('>カタリナ救助活動<'), '原词只进悬停，不占正文')
})

test('渲染：没发生就零痕迹，不写「未发生」也不占位', () => {
  const html = renderLog(withLbas(), true)
  assert.ok(!html.includes('卡特琳娜'))
  assert.ok(!html.includes('救援'))
})

test('渲染：文案里不许出现触发条件（Catalina 是必要不充分）', () => {
  const html = renderLog(withLbas({ airBaseRescue: 3 }), true)
  assert.ok(!html.includes('Catalina'))
  assert.ok(!html.includes('カタリナ飛行艇'))
  assert.ok(!/需?要?带\s*≥?\s*3/.test(html), '「要带 ≥3 架」那个说法已被账本证伪，不许写进文案')
})

test('渲染：陆航波次抬头照实写「第几基地第几波」', () => {
  const html = renderLog(withLbas(), true)
  assert.match(html, /第2基地第1波/)
  assert.match(html, /第3基地第1波/)
})
