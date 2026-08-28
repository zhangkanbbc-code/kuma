// 航空 stage3 的 api_f_sp_list / api_e_sp_list 接线的护栏。
//
// **这一格是「她挨了哪种特殊投弹」，不是「她发动了对空喷进弹幕」。** 这条曾被当成弹幕，
// 四票推翻：客户端本体 main.js 的 `SP_ATTACK_TYPE = { BOUNCE_BOM: 1 }` 与唯一消费点
// `getBounce(i)`（i 是被打的舰）、apilist 的「味方喰らった特殊攻撃種類」、KC3Kai 的读取点，
// 再加本机账本三次亮灯逐条实测。完整证据链写在 src/main/mg/battle.ts 取值处，别按旧说法改回去。
//
// 解析侧用**真报文**：test/fixtures/air-special-attack.json 取自本机账本 2026-08-07 那次联合出击，
// 是全账本 1586 条战斗报文里仅有的 3 次亮灯中的两次（主力段一次、护卫段一次）。
// 构造样例只补真报文没覆盖的形态——敌侧、喷气强袭段、第二航空战、带前导占位的编成。
//
// 渲染侧把 di.ts 的 logHtml **原样切出来跑**，断言的是产物 HTML。
// 不断言源码文本：判断写反、护卫段错位、缺省当发动，正则一条也拦不住。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import { airOf, battleOf, renderLog, stageOf } from './fixtures/render-di-battle.mjs'

const { parseBattle, upgradeBattleView } = battleModule

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./fixtures/air-special-attack.json', import.meta.url), 'utf8'),
)
const fixtureOf = (name) => {
  const found = fixtures.find((one) => one.name === name)
  assert.ok(found, `fixture 里没有 ${name}`)
  return structuredClone(found)
}

const fleet = (deckId, count = 6) =>
  Array.from({ length: count }, (_, i) => ({
    rosterId: deckId * 100 + i,
    mstId: deckId * 100 + i,
    name: `D${deckId}-${i + 1}`,
    lv: 1,
    nowHp: 50,
    maxHp: 50,
    equipments: [],
  }))

const ctx = (combinedType = 1) => ({
  fleetShips: (deckId) => fleet(deckId),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => combinedType,
})

const parseFixture = (name, mutate) => {
  const one = fixtureOf(name)
  if (mutate) mutate(one.battle)
  return parseBattle(one.path, one.battle, ctx(), 0)
}

// ---- 解析：真报文 ----

test('真报文·主力段：亮在 api_stage3 下标 4，落到视图舰位 4', () => {
  const view = parseFixture('each-battle-main')
  assert.deepEqual(view.air.spAttackF, [{ pos: 4, kinds: [1] }])
  // 敌侧那一整列是 null，不能凭空长出一个空数组
  assert.equal(view.air.spAttackE, undefined)
})

test('真报文·护卫段：亮在 api_stage3_combined 下标 4，落到 6+4 而不是 4', () => {
  const view = parseFixture('each-battle-escort')
  assert.deepEqual(view.air.spAttackF, [{ pos: 10, kinds: [1] }])
  // 错位成主力段是这条接线最容易犯的错，单独钉住
  assert.notDeepEqual(view.air.spAttackF, [{ pos: 4, kinds: [1] }])
})

test('真报文：亮的那格正是 bak_flag 立着的那格（承受方，不是发动方）', () => {
  const one = fixtureOf('each-battle-main')
  const s3 = one.battle.api_kouku.api_stage3
  const lit = s3.api_f_sp_list.flatMap((cell, i) => (Array.isArray(cell) ? [i] : []))
  const bombed = s3.api_fbak_flag.flatMap((flag, i) => (flag > 0 ? [i] : []))
  assert.deepEqual(lit, bombed, '这一格与 bak_flag 本来就是同时立的')
})

test('真报文：同一波里对空 CI 与特殊投弹各归各舰，互不冒名', () => {
  const view = parseFixture('each-battle-main')
  assert.equal(view.air.aaCutinIdx, 9)
  assert.equal(view.air.aaCutinKind, 1)
  assert.deepEqual(
    view.air.spAttackF.map((one) => one.pos),
    [4],
  )
})

test('真报文：那一波航空段自己也带着，不只是顶层 air', () => {
  const view = parseFixture('each-battle-main')
  const airStages = view.stages.filter((stage) => stage.air)
  assert.ok(airStages.length > 0)
  const lit = airStages.filter((stage) => stage.air.spAttackF?.length)
  assert.equal(lit.length, 1, '亮灯的航空段应当正好一段')
  assert.deepEqual(lit[0].air.spAttackF, [{ pos: 4, kinds: [1] }])
})

test('整列 null：全链路零痕迹，连键都不留', () => {
  const view = parseFixture('each-battle-main', (battle) => {
    battle.api_kouku.api_stage3.api_f_sp_list = [null, null, null, null, null, null]
  })
  assert.equal(view.air.spAttackF, undefined)
  assert.equal(view.air.spAttackE, undefined)
  assert.ok(
    !JSON.stringify(view).includes('spAttack'),
    '没亮的战斗序列化后不该出现 spAttack 字样',
  )
})

test('字段整个缺席（旧报文形态）也不报错', () => {
  const view = parseFixture('each-battle-main', (battle) => {
    delete battle.api_kouku.api_stage3.api_f_sp_list
    delete battle.api_kouku.api_stage3.api_e_sp_list
    delete battle.api_kouku.api_stage3_combined.api_f_sp_list
    delete battle.api_kouku.api_stage3_combined.api_e_sp_list
  })
  assert.equal(view.air.spAttackF, undefined)
  // 同一波的其它解析不能被连累
  assert.equal(view.air.aaCutinIdx, 9)
})

test('旧快照没有这个字段：升级回放不报错也不凭空造', () => {
  const snapshot = structuredClone(parseFixture('each-battle-main'))
  delete snapshot.air.spAttackF
  for (const stage of snapshot.stages) if (stage.air) delete stage.air.spAttackF
  const upgraded = upgradeBattleView(snapshot)
  assert.ok(upgraded)
  assert.equal(upgraded.air.spAttackF, undefined)
  assert.ok(!JSON.stringify(upgraded).includes('spAttack'))
})

// ---- 解析：真报文没覆盖的形态 ----

const airBody = (kouku, extra = {}) => ({
  api_deck_id: 1,
  api_formation: [1, 1, 1],
  api_f_nowhps: [50, 50, 50, 50, 50, 50],
  api_f_maxhps: [50, 50, 50, 50, 50, 50],
  api_ship_ke: [1501, 1501, 1501, 1501, 1501, 1501],
  api_ship_lv: [1, 1, 1, 1, 1, 1],
  api_e_nowhps: [50, 50, 50, 50, 50, 50],
  api_e_maxhps: [50, 50, 50, 50, 50, 50],
  api_smoke_type: 0,
  api_midnight_flag: 0,
  api_search: [1, 1],
  api_stage_flag: [1, 1, 1],
  ...kouku,
  ...extra,
})

const stage1 = { api_f_count: 10, api_f_lostcount: 0, api_e_count: 10, api_e_lostcount: 0 }
const zeros = () => [0, 0, 0, 0, 0, 0]
const nulls = () => [null, null, null, null, null, null]
const flagAt = (index) => {
  const list = zeros()
  list[index] = 1
  return list
}
const spAt = (index, kinds = [1]) => {
  const list = nulls()
  list[index] = kinds
  return list
}
// 这一格只在 bak_flag 也立着时才算数（两者本来就是同时立的），所以样例一律成对给。
const stage3 = (patch) => ({
  api_fdam: zeros(),
  api_edam: zeros(),
  api_fcl_flag: zeros(),
  api_ecl_flag: zeros(),
  api_fbak_flag: zeros(),
  api_ebak_flag: zeros(),
  api_frai_flag: zeros(),
  api_erai_flag: zeros(),
  api_f_sp_list: nulls(),
  api_e_sp_list: nulls(),
  ...patch,
})
const friendlyBombed = (index, kinds = [1]) =>
  stage3({ api_f_sp_list: spAt(index, kinds), api_fbak_flag: flagAt(index) })

test('敌侧：api_e_sp_list 亮的格记在敌舰位上，不串到我方', () => {
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    airBody({
      api_kouku: {
        api_stage1: stage1,
        api_stage3: stage3({ api_e_sp_list: spAt(2), api_ebak_flag: flagAt(2) }),
      },
    }),
    ctx(0),
    0,
  )
  assert.deepEqual(view.air.spAttackE, [{ pos: 2, kinds: [1] }])
  assert.equal(view.air.spAttackF, undefined)
})

test('喷气强袭段（api_injection_kouku）自己那一波也读', () => {
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    airBody({
      api_injection_kouku: { api_stage1: stage1, api_stage3: friendlyBombed(1) },
    }),
    ctx(0),
    0,
  )
  assert.deepEqual(view.airInjection.spAttackF, [{ pos: 1, kinds: [1] }])
  const stage = view.stages.find((one) => one.phase === 'injection')
  assert.deepEqual(stage.air.spAttackF, [{ pos: 1, kinds: [1] }])
})

test('第二航空战（api_kouku2）与第一波各记各的', () => {
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    airBody({
      api_kouku: { api_stage1: stage1, api_stage3: friendlyBombed(0) },
      api_kouku2: { api_stage1: stage1, api_stage3: friendlyBombed(3) },
    }),
    ctx(0),
    0,
  )
  assert.deepEqual(view.air.spAttackF, [{ pos: 0, kinds: [1] }])
  assert.deepEqual(view.air2.spAttackF, [{ pos: 3, kinds: [1] }])
})

test('一波里多舰同时挨：一格一条，按下标顺序', () => {
  const list = nulls()
  list[1] = [1]
  list[4] = [1]
  const bak = zeros()
  bak[1] = 1
  bak[4] = 1
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    airBody({
      api_kouku: {
        api_stage1: stage1,
        api_stage3: stage3({ api_f_sp_list: list, api_fbak_flag: bak }),
      },
    }),
    ctx(0),
    0,
  )
  assert.deepEqual(view.air.spAttackF, [
    { pos: 1, kinds: [1] },
    { pos: 4, kinds: [1] },
  ])
})

test('种类号照实收：不是 1 的也不丢，null 补位与非正数当噪音剔掉', () => {
  const list = nulls()
  list[2] = [1, 7]
  list[3] = [] // 空数组＝没亮
  list[4] = [0] // 0 不是种类号
  const bak = zeros()
  bak[2] = 1
  bak[3] = 1
  bak[4] = 1
  const view = parseBattle(
    '/kcsapi/api_req_sortie/battle',
    airBody({
      api_kouku: {
        api_stage1: stage1,
        api_stage3: stage3({ api_f_sp_list: list, api_fbak_flag: bak }),
      },
    }),
    ctx(0),
    0,
  )
  assert.deepEqual(view.air.spAttackF, [{ pos: 2, kinds: [1, 7] }])
})

test('友军航空那一波的 f 侧不映到我方舰位上', () => {
  // NPC 友军航空只打敌方，这一段的 f 侧根本不是我方舰队——
  // 与 stage3 承伤同一条纪律（不把不存在的「友军承伤」算到我方头上）。
  const view = parseBattle(
    '/kcsapi/api_req_combined_battle/each_battle',
    airBody({
      api_friendly_kouku: { api_stage1: stage1, api_stage3: friendlyBombed(2) },
      api_friendly_battle: {},
    }),
    ctx(0),
    0,
  )
  const stage = view.stages.find((one) => one.phase === 'friendlyAir')
  assert.ok(stage, '友军航空阶段应当在')
  assert.equal(stage.air.spAttackF, undefined)
})

test('本不该出现的那一侧冒出数组：静默忽略，不报错也不上账', () => {
  // apilist 记着这个毛病（空袭一类只有一侧会挨打的场合，另一侧也会冒出这对数组）。
  // 判据是「同格 bak_flag 没立」——它与这一格本来就是同时立的。
  const view = parseBattle(
    '/kcsapi/api_req_sortie/ld_airbattle',
    airBody({
      api_kouku: {
        api_stage1: stage1,
        // sp 亮着，但同格 bak_flag 是 0：幽灵格
        api_stage3: stage3({ api_f_sp_list: spAt(2) }),
      },
    }),
    ctx(0),
    0,
  )
  assert.equal(view.air.spAttackF, undefined)
})

// 这条钉的是「别自造一份映射」：不管前导占位让下标偏多少，
// 特殊投弹落的舰位必须与**同一格承伤**落的舰位一致。
const offsetInvariant = (label, body, expectPos) => {
  test(label, () => {
    const view = parseBattle('/kcsapi/api_req_combined_battle/each_battle', body, ctx(1), 0)
    const lit = view.air.spAttackF
    assert.equal(lit.length, 1, '应当正好一格亮着')
    const airAttacks = view.attacks.filter((attack) => attack.phase === 'air')
    const targets = airAttacks.flatMap((attack) => attack.hits.map((hit) => hit.target))
    assert.ok(
      targets.includes(lit[0].pos),
      `落在 ${lit[0].pos}，同一格的承伤却落在 ${JSON.stringify(targets)}——两处映射漂了`,
    )
    assert.equal(lit[0].pos, expectPos)
  })
}

const combinedBody = (leading) => {
  const pad = (values, head) => (leading ? [head, ...values] : values)
  return {
    api_deck_id: 1,
    api_formation: [1, 1, 1],
    api_f_nowhps: pad([50, 50, 50, 50, 50, 50], -1),
    api_f_maxhps: pad([50, 50, 50, 50, 50, 50], -1),
    api_f_nowhps_combined: pad([50, 50, 50, 50, 50, 50], -1),
    api_f_maxhps_combined: pad([50, 50, 50, 50, 50, 50], -1),
    api_ship_ke: [1501, 1501, 1501, 1501, 1501, 1501],
    api_ship_lv: [1, 1, 1, 1, 1, 1],
    api_e_nowhps: [50, 50, 50, 50, 50, 50],
    api_e_maxhps: [50, 50, 50, 50, 50, 50],
    api_smoke_type: 0,
    api_midnight_flag: 0,
    api_search: [1, 1],
    api_stage_flag: [1, 1, 1],
    api_kouku: {
      api_stage1: stage1,
      // 主力段：第 4 格既挨了炸也亮了种类号
      api_stage3: {
        ...stage3({}),
        api_fdam: pad([0, 0, 0, 0, 12, 0], -1),
        api_fbak_flag: pad(flagAt(4), 0),
        api_f_sp_list: pad(spAt(4), null),
      },
    },
  }
}

offsetInvariant('联合舰队·无前导占位：与同格承伤落同一舰位', combinedBody(false), 4)
offsetInvariant('联合舰队·带前导占位：偏移一起吃，两处仍落同一舰位', combinedBody(true), 4)

// ---- 渲染产物 ----
//
// 战斗流水整段从 di.ts 原样切出来跑，源码一个字不改；桩与其余几段渲染共用一份，
// 收在 test/fixtures/render-di-battle.mjs（原先这里自带一份同构的桩，
// 两份桩改一处漏一处迟早会漂，2026-08-25 并成一份）。

const render = (stages) =>
  renderLog(
    battleOf({
      kind: 'sortie',
      stages,
      air: stages[0]?.air ?? null,
    }),
    true,
  )

test('渲染：挨打的那一舰上屏，方向写成「敌方机队 → 她」', () => {
  const html = render([
    stageOf(0, '第一航空战', airOf({ spAttackF: [{ pos: 4, kinds: [1] }] })),
  ])
  assert.match(html, /跳弹轰炸/)
  assert.match(
    html,
    /<span class="ph air"[^>]*>跳弹轰炸<\/span>\s*<span class="who foe">敌方机队<\/span><span class="arr">→<\/span>\s*<span class="who">我舰5<\/span>/,
  )
})

test('渲染：不写成她发动了什么', () => {
  const html = render([
    stageOf(0, '第一航空战', airOf({ spAttackF: [{ pos: 4, kinds: [1] }] })),
  ])
  assert.ok(!html.includes('发动'), '这一格是她挨的，不是她发动的')
  assert.ok(!html.includes('喷进弹幕'), '対空噴進弾幕在报文里没有字段，不许出现')
})

test('渲染：护卫段的舰位取到的是护卫舰的名字', () => {
  const html = render([
    stageOf(0, '第一航空战', airOf({ spAttackF: [{ pos: 10, kinds: [1] }] })),
  ])
  assert.match(html, /我舰11/)
  assert.ok(!html.includes('我舰5'), '护卫段被当成主力段读了')
})

test('渲染：没亮就零痕迹', () => {
  const html = render([stageOf(0, '第一航空战', airOf())])
  assert.ok(!html.includes('跳弹轰炸'), '没亮却出现了事件行')
  assert.ok(!html.includes('特殊投弹'))
})

test('渲染：旧快照（air 里根本没有这两个键）不报错也不出行', () => {
  const air = airOf()
  delete air.spAttackF
  delete air.spAttackE
  const html = render([stageOf(0, '第一航空战', air)])
  assert.ok(!html.includes('跳弹轰炸'))
})

test('渲染：两波各亮各的，就是两行', () => {
  const html = render([
    stageOf(0, '第一航空战', airOf({ spAttackF: [{ pos: 0, kinds: [1] }] })),
    stageOf(1, '第二航空战', airOf({ spAttackF: [{ pos: 3, kinds: [1] }] })),
  ])
  assert.equal(html.match(/跳弹轰炸/g).length, 2)
  assert.match(html, /我舰1</)
  assert.match(html, /我舰4</)
})

test('渲染：同一波多舰挨打并成一行，不刷屏', () => {
  const html = render([
    stageOf(
      0,
      '第一航空战',
      airOf({
        spAttackF: [
          { pos: 0, kinds: [1] },
          { pos: 2, kinds: [1] },
        ],
      }),
    ),
  ])
  assert.equal(html.match(/跳弹轰炸/g).length, 1)
  assert.match(html, /我舰1 · 我舰3/)
})

test('渲染：敌侧亮的标在敌舰名下，方向反过来', () => {
  const html = render([
    stageOf(0, '第一航空战', airOf({ spAttackE: [{ pos: 1, kinds: [1] }] })),
  ])
  assert.match(html, /<span class="who">我方机队<\/span>/)
  assert.match(html, /<span class="who foe">敌舰2<\/span>/)
})

test('渲染：两侧同时挨同一种，各写各的方向不并成一行', () => {
  const html = render([
    stageOf(
      0,
      '第一航空战',
      airOf({ spAttackF: [{ pos: 0, kinds: [1] }], spAttackE: [{ pos: 1, kinds: [1] }] }),
    ),
  ])
  assert.equal(html.match(/跳弹轰炸/g).length, 2)
  assert.match(html, /敌方机队<\/span><span class="arr">→<\/span>\s*<span class="who">我舰1<\/span>/)
  assert.match(html, /我方机队<\/span><span class="arr">→<\/span>\s*<span class="who foe">敌舰2<\/span>/)
})

test('渲染：没见过的种类号照号显示，不替游戏起名', () => {
  const html = render([
    stageOf(0, '第一航空战', airOf({ spAttackF: [{ pos: 0, kinds: [7] }] })),
  ])
  assert.match(html, /特殊投弹 7/)
  assert.ok(!html.includes('跳弹轰炸'), '没见过的号不许冒名成跳弹轰炸')
})

test('渲染：事件行与对空炮火行同属一个阶段，且排在它后面', () => {
  const html = render([
    stageOf(
      0,
      '第一航空战',
      airOf({ eLost2: 3, aaCutinIdx: 9, aaCutinKind: 1, spAttackF: [{ pos: 4, kinds: [1] }] }),
    ),
  ])
  assert.ok(html.indexOf('对空炮火') >= 0)
  assert.ok(
    html.indexOf('对空炮火') < html.indexOf('跳弹轰炸'),
    '事件行应当排在对空炮火行之后',
  )
  // 对空 CI 报的是 9 号位，这一格报的是 4 号位——两者不许互相冒名
  assert.match(html, /<span class="who">我舰5<\/span>/)
  assert.match(html, /<span class="who">我舰10<\/span>/)
})
