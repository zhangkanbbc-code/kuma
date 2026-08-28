// 空母夜间攻击（api_hougeki.api_n_mother_list）的护栏。
//
// 这一条最容易照抄错，三处逐个钉住：
//
// 1. **判 `== 1`，不是 `== -1`。** EO 判的是 -1，那是它自己的老 bug：2017-09-30 那次提交里
//    `.Skip(1)` 与 `== -1` 是配套的，2017-11-19 去掉了 `.Skip(1)` 却忘了改判定，
//    此后四个文件一路抄到今天——它甚至跟自己仓里的 kcmemo「== 1 なら true」自相矛盾。
// 2. **它按攻击次序排，不是按舰位。** 与 api_at_list / api_at_eflag 等长，同一个下标直接取。
// 3. **严格分边。** 本机账本 4 次亮灯**全是对方的航母**（三次深海、一次演习对手的龍鳳改二戊），
//    自己的航母一次都没触发过——写成「我方航母夜袭」会当场错。
//
// 解析侧用真报文：battle-field-coverage.json 的 `ec-midnight-carrier-night`
// 取自本机账本 2026-08-07 那场夜战（账本本身不入仓），第 4 击亮着、同下标 at_eflag=1。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import { battleOf, renderLog, shipOf, stageOf } from './fixtures/render-di-battle.mjs'

const { parseBattle, upgradeBattleView } = battleModule

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

const parseFixture = (mutate) => {
  const one = fixtureOf('ec-midnight-carrier-night')
  if (mutate) mutate(one.battle)
  return parseBattle(one.path, one.battle, ctx(), 0)
}
const flagged = (view) => view.attacks.filter((attack) => attack.carrierNightAttack)

// ---- 解析：真报文 ----

test('真报文：正好一击亮着，落在第 4 击上', () => {
  const one = fixtureOf('ec-midnight-carrier-night')
  assert.deepEqual(
    one.battle.api_hougeki.api_n_mother_list,
    [0, 0, 0, 1, 0, 0, 0, 0],
    '真报文变了，这条守卫的前提要重看',
  )
  const view = parseBattle(one.path, one.battle, ctx(), 0)
  assert.equal(flagged(view).length, 1)
})

test('真报文：亮的那一击是**对方**打的（at_eflag=1），不许记成我方', () => {
  const one = fixtureOf('ec-midnight-carrier-night')
  assert.equal(one.battle.api_hougeki.api_at_eflag[3], 1, '第 4 击本来就是敌方发动的')
  const view = parseBattle(one.path, one.battle, ctx(), 0)
  assert.equal(flagged(view)[0].side, 1)
})

test('真报文：与 api_at_list 等长、同下标对齐——按舰位读会落到别人头上', () => {
  const h = fixtureOf('ec-midnight-carrier-night').battle.api_hougeki
  assert.equal(h.api_n_mother_list.length, h.api_at_list.length)
  assert.equal(h.api_n_mother_list.length, h.api_at_eflag.length)
  const view = parseFixture()
  // 亮的是第 4 击，它的攻击者就是 at_list[3] 换算出来的那一位
  const nightAttacks = view.attacks.filter((attack) => attack.phase === 'night')
  assert.equal(nightAttacks.indexOf(flagged(view)[0]), 3)
})

// ---- 解析：判定本身 ----

test('照 EO 抄的 -1 不许算数（那是它 2017 年忘了改的老 bug）', () => {
  const view = parseFixture((battle) => {
    battle.api_hougeki.api_n_mother_list = battle.api_hougeki.api_n_mother_list.map((v) =>
      v === 1 ? -1 : v,
    )
  })
  assert.equal(flagged(view).length, 0, '判成 == -1 就会在这里冒出一击')
})

test('旧格式下标 0 的 -1 是补位，不是码值', () => {
  const view = parseFixture((battle) => {
    battle.api_hougeki.api_n_mother_list = [
      -1,
      ...battle.api_hougeki.api_n_mother_list.slice(1).map(() => 0),
    ]
  })
  assert.equal(flagged(view).length, 0)
})

test('0 与 null 都不算数，非 1 的数也不算', () => {
  for (const value of [0, null, 2, '1']) {
    const view = parseFixture((battle) => {
      battle.api_hougeki.api_n_mother_list = [0, 0, 0, value, 0, 0, 0, 0]
    })
    assert.equal(flagged(view).length, 0, `${JSON.stringify(value)} 不该被当成发动`)
  }
})

test('字段整个缺席（旧报文形态）：零痕迹，同段其它解析照旧', () => {
  const view = parseFixture((battle) => {
    delete battle.api_hougeki.api_n_mother_list
  })
  assert.equal(flagged(view).length, 0)
  assert.ok(!JSON.stringify(view).includes('carrierNightAttack'))
  assert.ok(view.attacks.some((attack) => attack.phase === 'night'), '夜战流水本身还在')
})

test('多击亮着就多击记：一击一记，不并成一条', () => {
  const view = parseFixture((battle) => {
    battle.api_hougeki.api_n_mother_list = [1, 0, 1, 1, 0, 0, 0, 0]
  })
  assert.equal(flagged(view).length, 3)
})

test('旧快照没有这个键：升级回放不报错也不凭空造', () => {
  const snapshot = structuredClone(parseFixture())
  for (const attack of snapshot.attacks) delete attack.carrierNightAttack
  const upgraded = upgradeBattleView(snapshot)
  assert.ok(upgraded)
  assert.equal(upgraded.attacks.filter((attack) => attack.carrierNightAttack).length, 0)
  assert.ok(!JSON.stringify(upgraded).includes('carrierNightAttack'))
})

// ---- 渲染产物 ----

const attackOf = (patch = {}) => ({
  phase: 'night',
  side: 1,
  attacker: 0,
  ciType: null,
  ciKind: 'night',
  stage: 0,
  action: 0,
  stageLabel: '夜战',
  source: 'api_hougeki',
  simultaneous: false,
  hits: [{ target: 0, damage: 42, critical: false, hitState: 'hit', miss: false, protect: false, sunk: false, repairItem: null }],
  ...patch,
})
const nightBattle = (attack) =>
  battleOf({
    fShips: Array.from({ length: 6 }, (_, i) => shipOf(i, `我舰${i + 1}`)),
    eShips: Array.from({ length: 6 }, (_, i) => shipOf(i, `敌舰${i + 1}`)),
    stages: [stageOf(0, '夜战', null, { phase: 'night', source: 'api_hougeki' })],
    attacks: [attack],
  })

test('渲染：亮着就挂一枚标签，日文原词进悬停', () => {
  const html = renderLog(nightBattle(attackOf({ carrierNightAttack: true })), true)
  assert.match(html, /空母夜袭/)
  assert.match(html, /title="日文原词：空母夜間攻撃（这一击由舰载机打出）"/)
})

test('渲染：不替它定边——文案里不出现「我方航母」', () => {
  const html = renderLog(nightBattle(attackOf({ carrierNightAttack: true })), true)
  assert.ok(!html.includes('我方航母'), '账本 4 次全是对方的航母，写成我方会当场错')
  assert.ok(!html.includes('我方空母'))
  // 方向由那一行本身的「谁 → 谁」交代
  assert.match(html, /敌舰1<\/span><span class="arr">→<\/span>[\s\S]{0,80}我舰1/)
})

test('渲染：我方那一侧亮着时，同一枚标签照挂、方向自然反过来', () => {
  const html = renderLog(
    nightBattle(attackOf({ carrierNightAttack: true, side: 0 })),
    true,
  )
  assert.match(html, /空母夜袭/)
  assert.match(html, /我舰1<\/span><span class="arr">→<\/span>[\s\S]{0,80}敌舰1/)
})

test('渲染：没亮就零痕迹', () => {
  const html = renderLog(nightBattle(attackOf()), true)
  assert.ok(!html.includes('空母夜袭'))
})

test('渲染：miss 的那一击也不被默认折叠吞掉', () => {
  const attack = attackOf({
    carrierNightAttack: true,
    hits: [{ target: 0, damage: 0, critical: false, hitState: 'miss', miss: true, protect: false, sunk: false, repairItem: null }],
  })
  const folded = renderLog(nightBattle(attack), false)
  assert.match(folded, /空母夜袭/, '这是「这一击怎么打出去的」，miss 了也是事实')
})
