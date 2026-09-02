import assert from 'node:assert/strict'
import test from 'node:test'

import attackModule from '../dist/shared/fleet-special-attack.js'
import procModule from '../dist/shared/special-proc-rate.js'

const { detectFleetSpecialAttacks } = attackModule
const {
  PROC_RATE_GROUP_ORDER,
  procRateGroupsOf,
  procRatesOf,
  specialEntriesOf,
} = procModule

const fleetEquip = (over = {}) => ({
  type2: 0,
  houm: 0,
  saku: 0,
  largeSearchlight: false,
  surfaceRadar: false,
  ...over,
})

const fleetShip = (name, stype = 9, over = {}) => ({
  name,
  stype,
  lv: 99,
  luck: 20,
  hp: 80,
  hpMax: 80,
  equipment: [],
  ...over,
})

const fillers = (count) =>
  Array.from({ length: count }, (_, index) => fleetShip(`水上舰${index}`, 2))

const fleet = (role, ships, over = {}) => ({
  role,
  ships,
  losCorrection: 0,
  searchlight: false,
  ...over,
})

const procEquip = (over = {}) => ({
  mstId: 0,
  type2: 0,
  iconId: 0,
  name: '',
  antiAir: 0,
  asw: 0,
  los: 0,
  houm: 0,
  saku: 0,
  largeSearchlight: false,
  surfaceRadar: false,
  level: 0,
  planeCount: 0,
  ...over,
})

const subject = (over = {}) => ({
  mstId: 1,
  name: '测试舰',
  stype: 9,
  ctype: 1,
  slotNum: 4,
  kai: true,
  asw: 0,
  level: 99,
  luck: 20,
  hp: 80,
  hpMax: 80,
  flagship: true,
  baseAntiAir: 0,
  equipment: [],
  ...over,
})

const attacksOf = (role, ships) => detectFleetSpecialAttacks({ role, ships })
const specialOf = (role, ships) => specialEntriesOf(attacksOf(role, ships), ships)
const byCi = (entries, ci) => entries.find((entry) => entry.id === `special-${ci}`)

test('Nelson、长门、金刚、大和四条推定式按当前编成代入，金刚向下取整', () => {
  const nelsonShips = [
    fleetShip('Nelson改', 9, { luck: 50 }),
    fleetShip('2号舰'),
    fleetShip('3号舰'),
    fleetShip('4号舰'),
    fleetShip('5号舰'),
    fleetShip('6号舰'),
  ]
  const nelson = byCi(specialOf('normal', nelsonShips), 100)
  const nelsonExpected =
    1.1 * Math.sqrt(99) + Math.sqrt(99) + Math.sqrt(99) + 1.4 * Math.sqrt(50) + 25
  assert.equal(nelson.rate, nelsonExpected)
  assert.equal(
    nelson.detail[2],
    '代入：旗舰 Lv99 运50 · 3号 Lv99 · 5号 Lv99',
  )
  assert.equal(nelson.detail[3], '出处：ENWiki · 推定')

  const nagatoShips = [
    fleetShip('長門改二', 9, { luck: 40 }),
    fleetShip('陸奥改二', 9, { luck: 20 }),
    ...fillers(4),
  ]
  const nagato = byCi(specialOf('normal', nagatoShips), 101)
  const nagatoExpected =
    Math.sqrt(99) + Math.sqrt(99) + 1.2 * (Math.sqrt(40) + Math.sqrt(20)) + 30
  assert.equal(nagato.rate, nagatoExpected)
  assert.equal(
    nagato.detail[2],
    '代入：1号 Lv99 运40 · 2号 Lv99 运20',
  )

  const kongoShips = [
    fleetShip('金剛改二丙', 8, { luck: 18 }),
    fleetShip('榛名改二乙', 8, { luck: 48 }),
    ...fillers(4),
  ]
  const kongo = byCi(specialOf('normal', kongoShips), 104)
  assert.equal(kongo.rate, 48)
  assert.equal(
    kongo.detail[2],
    '代入：旗舰 Lv99 运18 · 僚舰 Lv99 运48 · A 0 · B 0',
  )
  assert.equal(kongo.detail.at(-1), '一次出击最多 3 次')

  const yamatoShips = [
    fleetShip('大和改二重', 9),
    fleetShip('武蔵改二', 9),
    ...fillers(4),
  ]
  const yamato = byCi(specialOf('normal', yamatoShips), 401)
  const yamatoExpected =
    Math.sqrt(99) + Math.sqrt(99) + Math.sqrt(20) + Math.sqrt(20) + 40 + 2
  assert.equal(yamato.rate, yamatoExpected)
  assert.equal(
    yamato.detail[2],
    '代入：1号 Lv99 运20 · 2号 Lv99 运20 · 电探装备舰 0 · 大和旗舰 2',
  )
  assert.equal(nelson.detail.at(-1), '一次出击一次')
})

test('金刚型 A/B 按五种旗舰形态取表值，雾岛为 20/20', () => {
  const cases = [
    ['金剛改二丙', '比叡改二丙', 30, 10],
    ['比叡改二丙', '金剛改二丙', 10, 30],
    ['榛名改二乙', '金剛改二丙', 15, 0],
    ['榛名改二丙', '金剛改二丙', 20, 0],
    ['霧島改二丙', '金剛改二丙', 20, 20],
  ]
  for (const [flagName, partnerName, a, b] of cases) {
    const ships = [
      fleetShip(flagName, 8, {
        equipment: [
          fleetEquip({ saku: 8, surfaceRadar: true }),
          fleetEquip({ largeSearchlight: true }),
        ],
      }),
      fleetShip(partnerName, 8),
      ...fillers(4),
    ]
    const entry = byCi(specialOf('normal', ships), 104)
    assert.ok(entry, `${flagName} 应命中僚舰夜战突击`)
    const expected = Math.floor(
      3.5 * (Math.sqrt(99) + Math.sqrt(99)) +
      1.1 * (Math.sqrt(20) + Math.sqrt(20)) +
      a +
      b -
      33,
    )
    assert.equal(entry.rate, expected)
    assert.match(entry.detail[2], new RegExp(`A ${a} · B ${b}$`))
  }
})

test('大和与 Iowa改／Richelieu改按常数 35，其他改装形态不外推', () => {
  for (const partner of ['Iowa改', 'Richelieu改']) {
    const ships = [
      fleetShip('大和改二重'),
      fleetShip(partner),
      ...fillers(4),
    ]
    const entry = byCi(specialOf('normal', ships), 401)
    const expected =
      Math.sqrt(99) + Math.sqrt(99) + Math.sqrt(20) + Math.sqrt(20) + 35 + 2
    assert.equal(entry.rate, expected)
    assert.match(entry.detail[1], /\+35\+电探装备舰数/)
  }

  const deux = byCi(
    specialOf('normal', [
      fleetShip('大和改二重'),
      fleetShip('Richelieu Deux'),
      ...fillers(4),
    ]),
    401,
  )
  assert.equal(deux.rate, null)
})

test('special 展示封顶 100，但悬停保留公式原值', () => {
  const ships = [
    fleetShip('Nelson改', 9, { lv: 175, luck: 1600 }),
    fleetShip('2号舰'),
    fleetShip('3号舰', 9, { lv: 175 }),
    fleetShip('4号舰'),
    fleetShip('5号舰', 9, { lv: 175 }),
    fleetShip('6号舰'),
  ]
  const entry = byCi(specialOf('normal', ships), 100)
  assert.equal(entry.rate, 100)
  assert.ok(entry.detail.some((line) => /^公式值 \d+\.\d{2}%$/.test(line)))
})

test('大和电探舰数按 type2=12/13 且 houm≥8 判，不附加 saku 门', () => {
  const base = [
    fleetShip('大和改二重', 9),
    fleetShip('武蔵改二', 9),
    fleetShip('水上舰A', 2, {
      equipment: [fleetEquip({ type2: 12, houm: 7, saku: 99, surfaceRadar: true })],
    }),
    ...fillers(3),
  ]
  const lowHit = byCi(specialOf('normal', base), 401)
  assert.match(lowHit.detail[2], /电探装备舰 0/)

  const enoughHit = base.map((ship, index) =>
    index === 2
      ? fleetShip('水上舰A', 2, {
          equipment: [fleetEquip({ type2: 12, houm: 8, saku: 0, surfaceRadar: false })],
        })
      : ship,
  )
  const highHit = byCi(specialOf('normal', enoughHit), 401)
  assert.match(highHit.detail[2], /电探装备舰 1/)
  assert.equal(highHit.rate - lowHit.rate, 10)

  const nonRadar = enoughHit.map((ship, index) =>
    index === 2
      ? fleetShip('水上舰A', 2, {
          equipment: [fleetEquip({ type2: 3, houm: 8, saku: 8 })],
        })
      : ship,
  )
  assert.match(byCi(specialOf('normal', nonRadar), 401).detail[2], /电探装备舰 0/)
})

test('C 级保持 null 而非 0，106 不采用长门型假定式', () => {
  const colorado = byCi(
    specialOf('normal', [
      fleetShip('Colorado改'),
      fleetShip('战舰A'),
      fleetShip('战舰B'),
      ...fillers(3),
    ]),
    103,
  )
  assert.equal(colorado.rate, null)
  assert.equal(colorado.summary, '?')
  assert.ok(colorado.detail.includes('暂无权威公式'))
  assert.ok(colorado.detail.includes('1～3 号位 SG雷达（后期型）+5%'))

  const richelieu = byCi(
    specialOf('normal', [
      fleetShip('Richelieu改'),
      fleetShip('Jean Bart改'),
      ...fillers(4),
    ]),
    105,
  )
  assert.equal(richelieu.rate, null)
  assert.ok(richelieu.detail.includes('38cm 四连装炮改 deux 不提升发动率'))

  const queenElizabeth = byCi(
    specialOf('normal', [
      fleetShip('Warspite改'),
      fleetShip('Valiant改'),
      ...fillers(4),
    ]),
    106,
  )
  assert.equal(queenElizabeth.rate, null)

  const submarine = byCi(
    specialOf('normal', [
      fleetShip('迅鯨改', 20, { lv: 30 }),
      fleetShip('伊13', 14),
      fleetShip('伊14', 14),
    ]),
    300,
  )
  assert.equal(submarine.rate, null)
  assert.equal(submarine.detail.at(-1), '每个攻击点消耗 1 个潜水舰补给物资')

  for (const ci of [301, 302, 1000]) {
    const [entry] = specialEntriesOf([
      {
        ci,
        label: `测试 ${ci}`,
        phase: 'day',
        formation: '测试阵型',
        detail: '测试编成',
      },
    ], [fleetShip('测试旗舰')])
    assert.equal(entry.rate, null, `${ci} 应为 C 级`)
  }
})

test('special 只进所属舰队旗舰行，联合第二舰队旗舰可列僚舰夜战突击', () => {
  const ships = [
    fleetShip('金剛改二丙', 8, { luck: 18 }),
    fleetShip('比叡改二丙', 8, { luck: 20 }),
    ...fillers(4),
  ]
  const escort = fleet('combined-escort', ships)
  const flagEntries = procRatesOf(subject({ name: '金剛改二丙' }), escort)
  assert.ok(byCi(flagEntries, 104))

  const escortMember = procRatesOf(
    subject({ name: '比叡改二丙', flagship: false }),
    escort,
  )
  assert.equal(escortMember.some((entry) => entry.group === 'special'), false)
})

test('大和 400/401 可并存，400 固定 C 级而 401 沿用二舰式', () => {
  const bothShips = [
    fleetShip('大和改二'),
    fleetShip('武蔵改二'),
    fleetShip('長門改二'),
    ...fillers(3),
  ]
  const both = specialOf('normal', bothShips)
  assert.deepEqual(
    both.map((entry) => entry.id),
    ['special-400', 'special-401'],
  )
  assert.equal(byCi(both, 400).rate, null)
  assert.equal(byCi(both, 400).detail.at(-1), '暂无权威公式')
  assert.ok(byCi(both, 400).detail.includes('一次出击一次'))
  assert.ok(byCi(both, 401).rate !== null)

  const unsupported = byCi(
    specialOf('normal', [
      fleetShip('大和改二'),
      fleetShip('Bismarck drei'),
      ...fillers(4),
    ]),
    401,
  )
  assert.equal(unsupported.rate, null)
})

test('special 不进入 day/night，汇总与折叠顺序固定在五族最前', () => {
  const ships = [
    fleetShip('Nelson改', 10, { luck: 50 }),
    fleetShip('2号舰'),
    fleetShip('3号舰'),
    fleetShip('4号舰'),
    fleetShip('5号舰'),
    fleetShip('6号舰'),
  ]
  const equips = [
    procEquip({ mstId: 9101, type2: 3, name: '41cm連装砲' }),
    procEquip({ mstId: 9102, type2: 3, name: '41cm連装砲' }),
    procEquip({ mstId: 9110, type2: 10, name: '零式水上偵察機', los: 9, saku: 9, planeCount: 3 }),
    procEquip({ mstId: 274, type2: 21, iconId: 15, name: '12cm30連装噴進砲改二', antiAir: 8 }),
    procEquip({ mstId: 9103, type2: 4, name: '15.5cm三連装副砲' }),
    procEquip({ mstId: 122, iconId: 16, name: '10cm連装高角砲+高射装置', antiAir: 5 }),
    procEquip({ mstId: 121, type2: 36, name: '94式高射装置' }),
  ]
  const entries = procRatesOf(
    subject({
      name: 'Nelson改',
      stype: 10,
      ctype: 2,
      luck: 50,
      baseAntiAir: 100,
      equipment: equips,
    }),
    fleet('normal', ships, { losCorrection: 20 }),
  )
  assert.equal(byCi(entries, 100).group, 'special')
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.group))],
    ['special', 'barrage', 'aaci', 'day', 'night'],
  )
  assert.deepEqual(PROC_RATE_GROUP_ORDER, ['special', 'barrage', 'aaci', 'day', 'night'])

  const groups = procRateGroupsOf(entries)
  assert.equal(groups[0].group, 'special')
  assert.equal(groups[0].foldLines[0], '特殊攻击 · Nelson Touch 66%')
})
