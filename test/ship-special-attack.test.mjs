import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import abilityModule from '../dist/shared/ship-special-attack.js'

const {
  AACI_PRIORITY,
  AACI_TABLE,
  aaciEntryOf,
  bestShipAacis,
  openingAswOf,
  shipAaciCeiling,
  shipAacis,
} = abilityModule

const ship = (over = {}) => ({
  mstId: 0,
  name: '',
  stype: 2,
  ctype: 0,
  slotNum: 3,
  kai: false,
  asw: 0,
  ...over,
})

const equip = (over = {}) => ({ mstId: 0, type2: 0, iconId: 0, antiAir: 0, asw: 0, ...over })

// 常用件：数值取到刚好落在判据的哪一边，测试才说明得了问题
const highAngle = (antiAir = 5) => equip({ iconId: 16, antiAir }) // 高角炮（对空 ≥8 才算内置高射装置）
const builtinHighAngle = () => highAngle(8)
const aaFireDirector = () => equip({ type2: 36 }) // 高射装置
const radar = () => equip({ type2: 12 }) // 无对空值的电探
const aaRadar = (antiAir = 2) => equip({ type2: 13, antiAir })
const machineGun = (antiAir = 3) => equip({ type2: 21, antiAir })
const cdmg = () => machineGun(9) // 集中配备机枪
const sonar = () => equip({ iconId: 18, asw: 8 })
const torpedoBomber = (asw = 0) => equip({ type2: 8, asw })
const autogyro = (asw = 3) => equip({ type2: 25, asw })

const idsOf = (subject, equips) => shipAacis(subject, equips).map((entry) => entry.id)
const bestIdsOf = (subject, equips) => bestShipAacis(subject, equips).map((entry) => entry.id)

// ---- 对空CI ----

test('对空CI 表与优先度表完整覆盖 1..53，且各自不重号', () => {
  const ids = AACI_TABLE.map((entry) => entry.id)
  assert.deepEqual(ids, Array.from({ length: 53 }, (_, index) => index + 1))
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(AACI_PRIORITY).size, AACI_PRIORITY.length)
  assert.deepEqual([...AACI_PRIORITY].sort((a, b) => a - b), ids)
  assert.deepEqual(AACI_PRIORITY.slice(0, 5), [38, 39, 40, 42, 41])
  assert.deepEqual(AACI_PRIORITY.slice(-5), [17, 18, 22, 9, 23])
})

test('每条对空CI 都要说得出适用范围和装备条件——界面上只有编号等于没说', () => {
  for (const entry of AACI_TABLE) {
    assert.ok(entry.scope, `类型 ${entry.id} 缺适用范围`)
    assert.ok(entry.condition, `类型 ${entry.id} 缺装备条件`)
  }
  assert.equal(aaciEntryOf(9).condition, '高角炮 + 高射装置')
  assert.deepEqual(
    {
      fixed: aaciEntryOf(53).fixed,
      modifier: aaciEntryOf(53).modifier,
      scope: aaciEntryOf(53).scope,
      condition: aaciEntryOf(53).condition,
    },
    {
      fixed: 4,
      modifier: 1.6,
      scope: '飞龙改三',
      condition: '对空≥9 的高角炮 + 高性能对空电探',
    },
  )
  // 游戏新加的编号本地表里没有，照实返回空而不是拿相近的一条冒充
  assert.equal(aaciEntryOf(999), null)
  assert.equal(aaciEntryOf(0), null)
})

test('秋月型两门内置高射高角炮加电探会逐项尝试 1/2/3，排除通用 5/7/8', () => {
  const akizuki = ship({ ctype: 54, stype: 2 })
  const ids = idsOf(akizuki, [builtinHighAngle(), builtinHighAngle(), aaRadar(4)])
  assert.deepEqual(ids, [1, 2, 3])
  assert.equal(ids.some((id) => [5, 7, 8].includes(id)), false)
})

test('通用条目认舰种与格数：高角炮加高射装置是 9 号，只有一格的舰不发动', () => {
  assert.deepEqual(idsOf(ship(), [highAngle(), aaFireDirector()]), [9])
  assert.deepEqual(idsOf(ship({ slotNum: 1 }), [highAngle(), aaFireDirector()]), [])
  // 潜水舰排除在通用条目之外
  assert.deepEqual(idsOf(ship({ stype: 13 }), [highAngle(), aaFireDirector()]), [])
})

test('摩耶改二排除 13 号，仍保留其余会逐项尝试的专属与通用候选', () => {
  const maya = ship({ mstId: 428, stype: 5, ctype: 8, slotNum: 4 })
  assert.deepEqual(
    idsOf(maya, [builtinHighAngle(), cdmg(), machineGun(), aaRadar(4)]),
    [10, 11, 8, 12],
  )
})

test('旧式最好一条函数维持原有选择行为，供主行 chip 使用', () => {
  const akizuki = ship({ ctype: 54, stype: 2 })
  assert.deepEqual(bestIdsOf(akizuki, [highAngle(), highAngle(), radar()]), [1])
  assert.deepEqual(bestIdsOf(akizuki, [highAngle(), highAngle()]), [3])
  assert.deepEqual(bestIdsOf(akizuki, [highAngle(), radar()]), [2])

  const maya = ship({ mstId: 428, stype: 5, ctype: 8, slotNum: 4 })
  assert.deepEqual(bestIdsOf(maya, [highAngle(), cdmg(), aaRadar(4)]), [10])
  assert.deepEqual(bestIdsOf(maya, [highAngle(), cdmg()]), [11])
})

test('鬼怒改二同时结算 19 与 20；带内置高射装置的高角炮会让 19 失效', () => {
  const kinu = ship({ mstId: 487, stype: 3, slotNum: 3 })
  assert.deepEqual(bestIdsOf(kinu, [highAngle(), cdmg()]), [19, 20])
  assert.deepEqual(bestIdsOf(kinu, [builtinHighAngle(), cdmg()]), [20])
})

test('同击坠时专属条压过通用条：五十铃改二取 14，霞改二乙取 17', () => {
  const isuzu = ship({ mstId: 141, stype: 3, ctype: 20, slotNum: 3 })
  // 8 号（内置高角炮 + 对空电探）与 14 号同为固定击坠 4
  assert.deepEqual(bestIdsOf(isuzu, [builtinHighAngle(), machineGun(), aaRadar(4)]), [14])
  const kasumi = ship({ mstId: 470, stype: 2, slotNum: 3 })
  // 9 号与 17 号同为固定击坠 2
  assert.deepEqual(bestIdsOf(kasumi, [highAngle(), machineGun(), aaFireDirector()]), [17])
})

test('皋月改二在最优那条之外再叠一条 18', () => {
  const satsuki = ship({ mstId: 418, stype: 2, slotNum: 3 })
  assert.deepEqual(bestIdsOf(satsuki, [cdmg(), machineGun(), aaRadar(4)]), [12, 18])
  assert.deepEqual(bestIdsOf(satsuki, [cdmg()]), [18])
})

test('秋月型的 48 号要改造后形态才成立', () => {
  const kai = ship({ ctype: 54, kai: true, slotNum: 3 })
  const base = ship({ ctype: 54, kai: false, slotNum: 3 })
  const mount = () => equip({ mstId: 533, iconId: 16, antiAir: 11 }) // 10cm連装高角砲改+高射装置改
  assert.deepEqual(idsOf(kai, [mount(), mount(), aaRadar(4)]), [48, 1, 2, 3])
  assert.deepEqual(bestIdsOf(kai, [mount(), mount(), aaRadar(4)]), [48])
  assert.equal(idsOf(base, [mount(), mount(), aaRadar(4)]).includes(48), false)
})

test('上限按舰本身算，与当前装备无关', () => {
  assert.equal(shipAaciCeiling(ship({ mstId: 428, stype: 5, ctype: 8, slotNum: 4 })), 8)
  assert.equal(shipAaciCeiling(ship({ stype: 2, slotNum: 3 })), 4)
  assert.equal(shipAaciCeiling(ship({ stype: 13, slotNum: 3 })), 0)
})

// ---- 先制对潜 ----

test('自带先制对潜的舰不看装备，且判据要说得出是哪一条', () => {
  assert.match(openingAswOf(ship({ mstId: 141, stype: 3 }), []).basis, /五十铃改二/)
  assert.match(openingAswOf(ship({ mstId: 394, stype: 2 }), []).basis, /J 级改/)
  assert.match(openingAswOf(ship({ mstId: 920, stype: 2 }), []).basis, /Samuel B\.Roberts/)
  // Fletcher 级按「舰级 + 改造」判，好让以后新出的改造形态自动生效
  assert.match(openingAswOf(ship({ mstId: 9999, ctype: 91, kai: true }), []).basis, /Fletcher/)
  // 未改造的 Richard P.Leary 与 Heywood L.E. 是 wikiwiki 発動条件表脚注 *29 点名排除的两艘
  assert.equal(openingAswOf(ship({ mstId: 941, ctype: 91, kai: false }), []), null)
  assert.equal(openingAswOf(ship({ mstId: 942, ctype: 91, kai: false }), []), null)
})

// 下面两条是全表仅有的、偏离上游 poi 的地方（2026-08-07 逐字比对 wikiwiki 原表后补）。
// 钉在测试里：哪天有人照着上游「修回去」，会先在这里失败。
test('本地补充 · Visby 级自带先制对潜，出处留在源码注释里', () => {
  for (const mstId of [1062, 1067]) {
    const hit = openingAswOf(ship({ mstId, stype: 2, ctype: 140 }), [])
    assert.ok(hit, `Visby ${mstId} 应可先制对潜`)
    assert.match(hit.basis, /Visby 级 · 整级自带先制对潜/)
    // 2026-08-20 第二批文案清扫：basis 是给玩家看的判据，源站名号撤出去了。
    assert.doesNotMatch(hit.basis, /wikiwiki|上游/, '发布侧署名不该回潮')
  }
  // 出处与日期改钉在源码注释上——哪天有人照着上游「修回去」，仍要先在这里失败。
  const rules = fs.readFileSync(
    new URL('../src/shared/ship-special-attack.ts', import.meta.url),
    'utf8',
  )
  assert.match(rules, /依据：wikiwiki「対潜攻撃」発動条件表，Visby 与 Fletcher 级同格/)
  assert.match(rules, /2026-08-07 查证/)
  // 别的驱逐舰不受影响，仍要凑够对潜 100 + 声呐
  assert.equal(openingAswOf(ship({ stype: 2, ctype: 23, asw: 150 }), []), null)
})

test('本地补充 · Fletcher 级的对空CI 按舰级收，Richard P.Leary 两个形态都算', () => {
  const mk30Kai = () => equip({ mstId: 313, iconId: 16, antiAir: 7 }) // 5inch単装砲 Mk.30改
  for (const mstId of [942, 737]) {
    const subject = ship({ mstId, ctype: 91, stype: 2, slotNum: 3 })
    assert.ok(idsOf(subject, [mk30Kai(), mk30Kai()]).includes(37), `Richard P.Leary ${mstId} 应吃到 37 号`)
  }
  // 非 Fletcher 级的驱逐舰拿同一套装备不会有 34~37
  const other = ship({ ctype: 23, stype: 2, slotNum: 3 })
  assert.equal(idsOf(other, [mk30Kai(), mk30Kai()]).some((id) => id >= 34 && id <= 37), false)
})

test('海防舰两条门槛各自成立', () => {
  const de = (asw) => ship({ stype: 1, asw })
  assert.ok(openingAswOf(de(60), [sonar()]))
  assert.equal(openingAswOf(de(59), [sonar()]), null)
  // 没有声呐时改看「对潜 75 + 装备对潜合计 4」
  assert.ok(openingAswOf(de(75), [equip({ asw: 2 }), equip({ asw: 2 })]))
  assert.equal(openingAswOf(de(75), [equip({ asw: 2 }), equip({ asw: 1 })]), null)
})

test('驱逐系要对潜 100 且带声呐，差一点都不成立', () => {
  assert.ok(openingAswOf(ship({ stype: 2, asw: 100 }), [sonar()]))
  assert.equal(openingAswOf(ship({ stype: 2, asw: 99 }), [sonar()]), null)
  assert.equal(openingAswOf(ship({ stype: 2, asw: 120 }), [equip({ asw: 8 })]), null)
  // 重巡不在这条名单里
  assert.equal(openingAswOf(ship({ stype: 5, asw: 120 }), [sonar()]), null)
})

test('轻空母走自己那三档；大鹰型改与最上型航改二另算', () => {
  const cvl = (asw) => ship({ stype: 7, asw, slotNum: 4 })
  assert.ok(openingAswOf(cvl(65), [torpedoBomber(7)]))
  assert.equal(openingAswOf(cvl(64), [torpedoBomber(7)]), null)
  assert.ok(openingAswOf(cvl(50), [sonar(), torpedoBomber(7)]))
  assert.ok(openingAswOf(cvl(100), [sonar(), torpedoBomber(1)]))
  // 大鹰改：只要一架对潜机，不看表示对潜
  assert.ok(openingAswOf(ship({ mstId: 380, stype: 7, asw: 0 }), [torpedoBomber(1)]))
  // 最上型航改二：上游资料只写「特殊」而没给条件，宁可不判
  assert.equal(
    openingAswOf(ship({ mstId: 508, stype: 7, asw: 200 }), [sonar(), torpedoBomber(7)]),
    null,
  )
})

test('日向改二认旋翼机：一架要对潜 12 以上，否则要两架', () => {
  const hyuuga = ship({ mstId: 554, stype: 10, asw: 80, slotNum: 5 })
  assert.ok(openingAswOf(hyuuga, [autogyro(12)]))
  assert.equal(openingAswOf(hyuuga, [autogyro(3)]), null)
  assert.ok(openingAswOf(hyuuga, [autogyro(3), autogyro(3)]))
})

test('判据会说明是哪一条成立的', () => {
  assert.match(openingAswOf(ship({ stype: 2, asw: 100 }), [sonar()]).basis, /对潜 ≥ 100/)
  assert.match(openingAswOf(ship({ stype: 1, asw: 60 }), [sonar()]).basis, /海防舰/)
})
