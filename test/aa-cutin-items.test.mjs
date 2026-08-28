// 对空炮火那一行的两处补全：**用了哪几件装备**（api_air_fire.api_use_items）
// 与**分母**（api_stage2 的 api_f_count / api_e_count）。
//
// 解析侧用真报文：test/fixtures/battle-field-coverage.json 的 `ld-airbattle-aa-cutin`
// 取自本机账本 2026-08-05 那次敌空袭，账本本身不入仓。它同时钉住一件最容易写错的事——
// **分母是 stage2 的，不是 stage1 的**：同一波里 stage1 报 120 机接敌，
// 活到对空炮火那一段只剩 77，拿 stage1 当分母会把「击坠 66/77」写成「66/120」。
//
// 渲染侧把 di.ts 的 logHtml 原样切出来跑（test/fixtures/render-di-battle.mjs），
// 断言产物 HTML，不断言源码文本。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import { airOf, battleOf, renderLog, stageOf } from './fixtures/render-di-battle.mjs'

const { parseBattle, upgradeBattleView } = battleModule

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/battle-field-coverage.json', import.meta.url), 'utf8'),
)
const fixtureOf = (name) => {
  const found = fixtures.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

const ctx = (combinedType = 0) => ({
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

// ---- 解析：真报文 ----

test('真报文：对空 CI 用掉的装备照实收进 aaCutinItems', () => {
  const view = parseFixture('ld-airbattle-aa-cutin')
  assert.deepEqual(view.air.aaCutinItems, [122, 122, 315])
  // 发动舰与种别号本来就在读，别被这一列带歪
  assert.equal(view.air.aaCutinIdx, 0)
  assert.equal(view.air.aaCutinKind, 1)
})

test('真报文：分母取的是 stage2 的参战机数，不是 stage1 的接敌机数', () => {
  const one = fixtureOf('ld-airbattle-aa-cutin')
  const s1 = one.battle.api_kouku.api_stage1
  const s2 = one.battle.api_kouku.api_stage2
  assert.equal(s1.api_e_count, 120, '真报文的 stage1 接敌机数变了，这条守卫的前提要重看')
  assert.equal(s2.api_e_count, 77)
  const view = parseBattle(one.path, one.battle, ctx(), 0)
  assert.equal(view.air.eCount2, 77)
  assert.equal(view.air.eLost2, 66)
  // stage1 那一对照旧各归各位
  assert.equal(view.air.eCount, 120)
  assert.notEqual(view.air.eCount2, view.air.eCount)
})

test('真报文：那一波航空段自己也带着这两样，不只是顶层 air', () => {
  const view = parseFixture('ld-airbattle-aa-cutin')
  const stage = view.stages.find((one) => one.air?.aaCutinItems?.length)
  assert.ok(stage, '航空段里应当有一段带着装备列')
  assert.deepEqual(stage.air.aaCutinItems, [122, 122, 315])
  assert.equal(stage.air.eCount2, 77)
})

test('装备列缺席（旧报文形态）：整个不写这个键，同波其它解析不受连累', () => {
  const view = parseFixture('ld-airbattle-aa-cutin', (battle) => {
    delete battle.api_kouku.api_stage2.api_air_fire.api_use_items
  })
  assert.equal(view.air.aaCutinItems, undefined)
  assert.equal(view.air.aaCutinKind, 1)
  assert.ok(!JSON.stringify(view).includes('aaCutinItems'))
})

test('装备列里的补位与噪音剔掉，剩下空的就不写键', () => {
  const empty = parseFixture('ld-airbattle-aa-cutin', (battle) => {
    battle.api_kouku.api_stage2.api_air_fire.api_use_items = [-1, 0]
  })
  assert.equal(empty.air.aaCutinItems, undefined)
  const mixed = parseFixture('ld-airbattle-aa-cutin', (battle) => {
    battle.api_kouku.api_stage2.api_air_fire.api_use_items = [-1, 122, 0, 315]
  })
  assert.deepEqual(mixed.air.aaCutinItems, [122, 315])
})

test('没见过的装备号照原值收：不设上界、不查表校验', () => {
  // 种别号已经排到 53 还在涨，装备表同理会长——写死上界会静默丢数据
  const view = parseFixture('ld-airbattle-aa-cutin', (battle) => {
    battle.api_kouku.api_stage2.api_air_fire.api_use_items = [9999]
    battle.api_kouku.api_stage2.api_air_fire.api_kind = 53
  })
  assert.deepEqual(view.air.aaCutinItems, [9999])
  assert.equal(view.air.aaCutinKind, 53)
})

test('stage2 两个计数为 0 时不写键：不给每一波航空战多存两个零', () => {
  const view = parseFixture('ld-airbattle-aa-cutin', (battle) => {
    battle.api_kouku.api_stage2.api_e_count = 0
    battle.api_kouku.api_stage2.api_f_count = 0
  })
  assert.equal(view.air.eCount2, undefined)
  assert.equal(view.air.fCount2, undefined)
  // 击坠数本身照旧读
  assert.equal(view.air.eLost2, 66)
})

test('旧快照没有这三个键：升级回放不报错也不凭空造', () => {
  const snapshot = structuredClone(parseFixture('ld-airbattle-aa-cutin'))
  for (const air of [snapshot.air, ...snapshot.stages.map((one) => one.air)]) {
    if (!air) continue
    delete air.aaCutinItems
    delete air.eCount2
    delete air.fCount2
  }
  const upgraded = upgradeBattleView(snapshot)
  assert.ok(upgraded)
  assert.equal(upgraded.air.aaCutinItems, undefined)
  assert.equal(upgraded.air.eCount2, undefined)
  assert.ok(!JSON.stringify(upgraded).includes('aaCutinItems'))
})

// ---- 渲染产物 ----

const logOf = (air) => renderLog(battleOf({ air, stages: [stageOf(0, '第一航空战', air)] }), true)

test('渲染：对空炮火行写成「击坠 66 / 77」，装备列进悬停', () => {
  const html = logOf(
    airOf({ eLost2: 66, eCount2: 77, aaCutinIdx: 0, aaCutinKind: 1, aaCutinItems: [122, 122, 315] }),
  )
  assert.match(html, /击坠 66 \/ 77/)
  assert.match(html, /对空CI 类型1/)
  // 这一列（种别 1 还带着装备条件）撑不进行内，收成短头、全文照原样进 title。
  // 旧断言要的是三件装备的行内链接，现在改要「一件都不在行内、三件都在悬停里」
  assert.ok(!html.includes('data-equip='), '过长的装备列不该还留在行内')
  assert.match(
    html,
    /title="对空CI 类型1 · 装备 #122 · 装备 #122 · 装备 #315\n装备条件：高角炮×2 \+ 电探"/,
  )
})

test('渲染：没有分母就只报击坠数，不拿 stage1 的机数顶替', () => {
  const air = airOf({ eLost2: 66, eCount: 120, aaCutinIdx: 0, aaCutinKind: 1 })
  const html = logOf(air)
  assert.match(html, /击坠 66</)
  assert.ok(!html.includes('击坠 66 / 120'), 'stage1 的接敌机数不是对空炮火的分母')
  assert.ok(!html.includes('击坠 66 /'), '没有分母时不许留一个空的斜杠')
})

test('渲染：没有装备列时那一枚芯片照旧，只是不点名', () => {
  const html = logOf(airOf({ eLost2: 6, eCount2: 20, aaCutinIdx: 0, aaCutinKind: 5 }))
  assert.match(html, /对空CI 类型5/)
  assert.ok(!html.includes('data-equip='), '没有装备列却渲染出了装备')
})

test('渲染：没发动对空 CI 时不冒出装备（那一列本来就不该有）', () => {
  const html = logOf(airOf({ eLost2: 3, eCount2: 10 }))
  assert.match(html, /舰队防空/)
  assert.match(html, /击坠 3 \/ 10/)
  assert.ok(!html.includes('对空CI'))
})

test('渲染：阶段行的悬停给出分阶段明细，一眼位置的合计不变', () => {
  const air = airOf({ fCount: 18, fLost: 2, eCount: 120, eLost: 3, fLost2: 4, fCount2: 12, eLost2: 66, eCount2: 77 })
  const html = renderLog(battleOf({ air, stages: [stageOf(0, '第一航空战', air)] }), true)
  assert.match(html, /击坠 我 6 \/ 敌 69/, '合计仍是 stage1 + stage2')
  assert.match(html, /航空互击 · 我 -2 \/ 敌 -3/)
  assert.match(html, /对空炮火 · 我 12 机参战、损失 4/)
  assert.match(html, /对空炮火 · 敌 77 机参战、损失 66/)
})

test('渲染：旧快照没有分母键时，悬停退回不带分母的写法', () => {
  const air = airOf({ fLost: 2, eLost: 3, fLost2: 4, eLost2: 66 })
  const html = renderLog(battleOf({ air, stages: [stageOf(0, '第一航空战', air)] }), true)
  assert.match(html, /对空炮火 · 我 -4/)
  assert.match(html, /对空炮火 · 敌 -66/)
  assert.ok(!html.includes('机参战'))
})
