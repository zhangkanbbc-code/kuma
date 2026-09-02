import assert from 'node:assert/strict'
import test from 'node:test'

import forecastModule from '../dist/shared/combat-forecast.js'

const {
  forecastEncounter,
  forecastImprovementPower,
  softCap,
  summarizeEncounterForecasts,
} = forecastModule

const equipment = (overrides = {}) => ({
  mstId: 1,
  type2: 1,
  iconId: 1,
  los: 0,
  firepower: 2,
  torpedo: 0,
  bomb: 0,
  antiAir: 0,
  asw: 0,
  accuracy: 1,
  evasion: 0,
  armor: 0,
  level: 0,
  proficiency: 0,
  planeCount: 0,
  preventsTDisadvantage: false,
  ...overrides,
})

const ship = (overrides = {}) => ({
  role: 'main',
  mstId: 1,
  level: 80,
  stype: 2,
  hp: 35,
  hpMax: 35,
  firepower: 70,
  torpedo: 80,
  antiAir: 60,
  armor: 55,
  evasion: 75,
  asw: 70,
  luck: 20,
  condition: 49,
  fuelRate: 100,
  ammoRate: 100,
  equipment: [equipment()],
  ...overrides,
})

const fleet = (ships, combinedType = 0) => ({ ships, combinedType })

test('combat forecast keeps stable caps and reacts to enemy strength', () => {
  assert.equal(softCap(220, 220), 220)
  assert.equal(softCap(320, 220), 230)

  const friendly = fleet(Array.from({ length: 6 }, (_, index) => ship({ mstId: index + 1 })))
  const weakEnemy = fleet(Array.from({ length: 3 }, (_, index) =>
    ship({
      mstId: 1501 + index,
      level: 1,
      hp: 20,
      hpMax: 20,
      firepower: 8,
      torpedo: 12,
      armor: 8,
      evasion: 12,
      asw: 0,
      luck: 1,
      equipment: [],
    })))
  const strongEnemy = fleet(Array.from({ length: 6 }, (_, index) =>
    ship({
      mstId: 1750 + index,
      level: 1,
      hp: 180,
      hpMax: 180,
      firepower: 110,
      torpedo: 90,
      armor: 120,
      evasion: 70,
      asw: 0,
      luck: 50,
      equipment: [equipment({ firepower: 15, accuracy: 8 })],
    })))

  const easy = forecastEncounter({ friendly, enemy: weakEnemy, enemyFormation: 1 })
  const hard = forecastEncounter({ friendly, enemy: strongEnemy, enemyFormation: 1 })
  assert.ok(easy.bPlus > hard.bPlus)
  assert.ok(easy.sa > hard.sa)
  assert.ok(easy.taiha < hard.taiha)
})

test('equipment improvement and proficiency affect the mechanism forecast', () => {
  const enemy = fleet([ship({
    mstId: 1600,
    level: 1,
    hp: 90,
    hpMax: 90,
    firepower: 45,
    torpedo: 30,
    armor: 60,
    evasion: 35,
    asw: 0,
    luck: 5,
    equipment: [equipment({ type2: 6, antiAir: 8, planeCount: 18 })],
  })])
  const plain = fleet([ship({
    stype: 7,
    equipment: [equipment({ type2: 6, antiAir: 10, planeCount: 24 })],
  })])
  const trained = fleet([ship({
    stype: 7,
    equipment: [equipment({
      type2: 6,
      antiAir: 10,
      planeCount: 24,
      level: 10,
      proficiency: 7,
      accuracy: 3,
    })],
  })])
  const before = forecastEncounter({ friendly: plain, enemy, enemyFormation: 1 })
  const after = forecastEncounter({ friendly: trained, enemy, enemyFormation: 1 })
  assert.ok(after.air.friendlyMin > before.air.friendlyMin)
  assert.ok(after.bPlus >= before.bPlus)
})

test('multiple confirmed enemy formations remain a range instead of a fake average', () => {
  const friendly = fleet([ship()])
  const weak = forecastEncounter({
    friendly,
    enemy: fleet([ship({ mstId: 1501, hp: 20, hpMax: 20, armor: 5, firepower: 5, torpedo: 0, evasion: 5 })]),
    enemyFormation: 1,
  })
  const strong = forecastEncounter({
    friendly,
    enemy: fleet([ship({ mstId: 1761, hp: 220, hpMax: 220, armor: 112, firepower: 108, torpedo: 74, evasion: 68 })]),
    enemyFormation: 1,
  })
  const band = summarizeEncounterForecasts([weak, strong])
  assert.equal(band.candidates, 2)
  assert.equal(band.bPlus.min, Math.min(weak.bPlus, strong.bPlus))
  assert.equal(band.bPlus.max, Math.max(weak.bPlus, strong.bPlus))
  assert.equal(band.taiha.min, Math.min(weak.taiha, strong.taiha))
  assert.equal(band.taiha.max, Math.max(weak.taiha, strong.taiha))
})

test('default formations, engagement distribution, and per-ship taiha state stay explicit', () => {
  const surface = fleet([ship({ stype: 2 })])
  const submarine = fleet([ship({
    mstId: 1600,
    stype: 13,
    hp: 20,
    hpMax: 20,
    firepower: 0,
    torpedo: 25,
    armor: 10,
    asw: 0,
  })])
  const normal = forecastEncounter({
    friendly: surface,
    enemy: submarine,
    enemyFormation: 5,
  })
  assert.equal(normal.friendlyFormation, 5)
  assert.equal(normal.engagement, 'natural')
  assert.match(normal.assumptions.join(' '), /同航45%.*反航30%.*T有利15%.*T不利10%/)

  const combined = forecastEncounter({
    friendly: fleet(surface.ships, 1),
    enemy: submarine,
    enemyFormation: 5,
  })
  assert.equal(combined.friendlyFormation, 11)

  const saiun = forecastEncounter({
    friendly: fleet([ship({
      stype: 7,
      equipment: [equipment({
        mstId: 54,
        type2: 9,
        planeCount: 4,
        preventsTDisadvantage: true,
      })],
    })]),
    enemy: fleet([ship({ mstId: 1501, level: 1 })]),
    enemyFormation: 1,
  })
  assert.equal(saiun.engagement, 'saiun')
  assert.match(saiun.assumptions.join(' '), /反航40%.*彩云/)

  const alreadyTaiha = forecastEncounter({
    friendly: fleet([ship({ hp: 8, hpMax: 35 })]),
    enemy: fleet([ship({ mstId: 1700, firepower: 1, torpedo: 0 })]),
    enemyFormation: 1,
  })
  assert.equal(alreadyTaiha.taiha, 100)
})

test('seven-ship strike forces keep the seventh ship in output and risk pools', () => {
  const enemy = fleet(Array.from({ length: 6 }, (_, index) => ship({
    mstId: 1700 + index,
    level: 1,
    hp: 120,
    hpMax: 120,
    firepower: 65,
    torpedo: 45,
    armor: 85,
    evasion: 45,
    asw: 0,
    equipment: [],
  })))
  const six = fleet(Array.from({ length: 6 }, (_, index) => ship({
    mstId: index + 1,
    firepower: 25,
    torpedo: 20,
  })))
  const seven = fleet([
    ...six.ships,
    ship({ mstId: 7, firepower: 120, torpedo: 110 }),
  ])
  const sixResult = forecastEncounter({ friendly: six, enemy, enemyFormation: 1 })
  const sevenResult = forecastEncounter({ friendly: seven, enemy, enemyFormation: 1 })

  assert.ok(sevenResult.friendlyPressure > sixResult.friendlyPressure)
  assert.match(sevenResult.assumptions.join(' '), /七舰游击部队.*完整 7 舰/)
})

test('combined fleets preserve main and escort phase roles', () => {
  const enemy = fleet(Array.from({ length: 6 }, (_, index) => ship({
    mstId: 1750 + index,
    level: 1,
    hp: 150,
    hpMax: 150,
    firepower: 70,
    torpedo: 50,
    armor: 90,
    evasion: 50,
    asw: 0,
    equipment: [],
  })))
  const main = Array.from({ length: 6 }, (_, index) => ship({
    role: 'main',
    mstId: index + 1,
    firepower: 25,
    torpedo: 0,
  }))
  const escort = Array.from({ length: 6 }, (_, index) => ship({
    role: 'escort',
    mstId: index + 7,
    firepower: 25,
    torpedo: 0,
  }))
  const base = fleet([...main, ...escort], 1)
  const mainTorpedo = fleet([
    ...main.map((entry) => ({ ...entry, torpedo: 180 })),
    ...escort,
  ], 1)
  const escortTorpedo = fleet([
    ...main,
    ...escort.map((entry) => ({ ...entry, torpedo: 180 })),
  ], 1)
  const baseResult = forecastEncounter({ friendly: base, enemy, enemyFormation: 1 })
  const mainResult = forecastEncounter({ friendly: mainTorpedo, enemy, enemyFormation: 1 })
  const escortResult = forecastEncounter({ friendly: escortTorpedo, enemy, enemyFormation: 1 })

  assert.equal(baseResult.friendlyFormation, 14)
  assert.equal(mainResult.friendlyPressure, baseResult.friendlyPressure)
  assert.ok(escortResult.friendlyPressure > baseResult.friendlyPressure)
  const text = baseResult.assumptions.join(' ')
  assert.match(text, /主力6舰 \+ 护卫6舰.*雷击只计护卫队/)
  assert.match(text, /未计入：.*夜战/, '夜战没建模，说明栏必须照实说')
  // 说明栏必须由 factors 生成：倍卡与陆航早就接进来了，
  // 以前那句写死的「活动特效…与基地航空队未自动假定发动」是在对用户说谎。
  assert.doesNotMatch(text, /基地航空队未自动假定发动/)
  assert.doesNotMatch(text, /未计入：[^ ]*(活动特效|基地航空)/)
  assert.equal(baseResult.factors.combinedType, 1)
  assert.equal(baseResult.factors.mainCount, 6)
  assert.equal(baseResult.factors.escortCount, 6)
})

test('说明栏由实际参与的层生成——接进来的要认，没建的要照实说', () => {
  const enemy = fleet([ship({ mstId: 1500, level: 1, stype: 5, hp: 60, hpMax: 60 })])
  const plain = forecastEncounter({
    friendly: fleet([ship({ mstId: 1, level: 90, stype: 2 })]),
    enemy,
    enemyFormation: 1,
  })
  assert.equal(plain.factors.bonusShips, 0)
  assert.equal(plain.factors.landTargets, 0)
  assert.equal(plain.factors.landBaseWaves, 0)
  // 没吃到的层不该出现在「已计入」里——那一行干脆不生成
  assert.ok(!plain.assumptions.some((line) => line.startsWith('已计入：')))

  const loaded = forecastEncounter({
    friendly: fleet([
      ship({ mstId: 1, level: 90, stype: 2, damageBonus: 1.5 }),
      ship({ mstId: 2, level: 90, stype: 2 }),
    ]),
    // 集積地棲姫 = 陆上型（api_soku 0）
    enemy: fleet([ship({ mstId: 1690, name: '集積地棲姫', speed: 0, level: 1, stype: 5 })]),
    enemyFormation: 1,
    landBaseWaves: [
      { planes: [{ type2: 47, torpedo: 0, bomb: 12, level: 0, count: 18 }], againstLand: true, enemyCombined: false },
    ],
  })
  assert.equal(loaded.factors.bonusShips, 1)
  assert.equal(loaded.factors.landTargets, 1)
  assert.equal(loaded.factors.landBaseWaves, 1)
  const counted = loaded.assumptions.find((line) => line.startsWith('已计入：')) ?? ''
  assert.match(counted, /对地特攻/)
  assert.match(counted, /活动特效倍卡/)
  assert.match(counted, /基地航空/)
})

test('combined air combat against a normal enemy excludes escort aircraft', () => {
  const enemy = fleet([ship({
    mstId: 1800,
    level: 1,
    stype: 7,
    equipment: [equipment({ type2: 6, antiAir: 8, planeCount: 18 })],
  })])
  const mainCarrier = ship({
    role: 'main',
    stype: 7,
    equipment: [equipment({ type2: 6, antiAir: 10, planeCount: 24 })],
  })
  const escortCarrier = ship({
    role: 'escort',
    stype: 7,
    equipment: [equipment({ type2: 6, antiAir: 14, planeCount: 99 })],
  })
  const withoutEscortPlanes = forecastEncounter({
    friendly: fleet([mainCarrier, { ...escortCarrier, equipment: [] }], 1),
    enemy,
    enemyFormation: 1,
  })
  const withEscortPlanes = forecastEncounter({
    friendly: fleet([mainCarrier, escortCarrier], 1),
    enemy,
    enemyFormation: 1,
  })

  assert.equal(withEscortPlanes.air.friendlyMin, withoutEscortPlanes.air.friendlyMin)
  assert.equal(withEscortPlanes.air.friendlyMax, withoutEscortPlanes.air.friendlyMax)
})

test('联合舰队昼战按主力两轮、护卫一轮算——只算一轮曾让预测系统性低估约 3 倍', () => {
  // 本机 154 场战斗快照实测：水上打击是主力 gun1+gun2、护卫 gun3；
  // 机动部队是护卫 gun1、主力 gun2+gun3——顺序不同，轮数一致。
  const enemy = fleet(Array.from({ length: 6 }, (_, i) => ship({ mstId: 1501 + i, level: 1 })))
  const mainOnly = fleet([ship({ role: 'main', mstId: 1 })], 2)
  const escortOnly = fleet([ship({ role: 'escort', mstId: 1 })], 2)
  const single = fleet([ship({ role: 'main', mstId: 1 })], 0)

  const p = (friendly) =>
    forecastEncounter({ friendly, enemy, enemyFormation: 1, friendlyFormation: 1 }).friendlyPressure

  // 同一艘舰，只因编制不同：联合主力应当明显高于联合护卫与单队
  assert.ok(p(mainOnly) > p(escortOnly), '联合主力没有按两轮算')
  assert.ok(p(mainOnly) > p(single), '联合主力没有比单队高')
  // 护卫与单队都是一轮炮击；护卫另有雷击口径差异，这里只要求不高于主力
  assert.ok(p(escortOnly) <= p(mainOnly))
  // 两轮不等于两倍（雷击、对潜等不随炮击轮数翻倍），但应当落在合理区间
  const ratio = p(mainOnly) / p(escortOnly)
  assert.ok(ratio > 1.2 && ratio < 2.5, `主力/护卫 压制比 ${ratio.toFixed(2)} 落在预期外`)
})

test('对潜攻击也按炮击轮数算——纯潜艇点三轮都有对潜伤害', () => {
  const subs = fleet(Array.from({ length: 4 }, (_, i) => ship({
    mstId: 1571, level: 1, stype: 13, hp: 30, hpMax: 30, armor: 10, equipment: [],
  })))
  const asMain = fleet([ship({ role: 'main', asw: 90 })], 2)
  const asEscort = fleet([ship({ role: 'escort', asw: 90 })], 2)
  const p = (f) => forecastEncounter({ friendly: f, enemy: subs, enemyFormation: 1, friendlyFormation: 1 }).friendlyPressure
  assert.ok(p(asMain) > p(asEscort), '对潜没有跟着炮击轮数走')
})

test('夜战单算一套，不混进昼战那个数', () => {
  const enemy = fleet([
    ship({ mstId: 1600, level: 1, stype: 5, hp: 70, hpMax: 70, armor: 60, evasion: 40 }),
    ship({ mstId: 1601, level: 1, stype: 2, hp: 40, hpMax: 40, armor: 40, evasion: 50 }),
  ])
  const r = forecastEncounter({
    friendly: fleet([ship(), ship({ mstId: 2 }), ship({ mstId: 3 })]),
    enemy,
    enemyFormation: 1,
  })
  // 昼战那三项还在原位，没有被夜战污染
  assert.ok(r.bPlus >= 0 && r.bPlus <= 100)
  // 追进夜战多打一轮：胜率不降，大破风险不降
  assert.ok(r.night.sa >= r.sa, '夜战多一轮输出，S/A 不该反而更低')
  assert.ok(r.night.bPlus >= r.bPlus)
  assert.ok(r.night.taiha >= r.taiha, '夜战多挨一轮，大破风险不该反而更低')
  assert.equal(r.factors.nightAttackers, 3)
  assert.deepEqual(r.factors.nightBlocked, {})
})

test('联合舰队的夜战只有第二舰队出手，空母与大破舰一律不出手', () => {
  const main = Array.from({ length: 4 }, (_, i) => ship({ mstId: 10 + i, role: 'main' }))
  const escort = Array.from({ length: 4 }, (_, i) => ship({ mstId: 20 + i, role: 'escort' }))
  const r = forecastEncounter({
    friendly: fleet([...main, ...escort], 1),
    enemy: fleet([ship({ mstId: 1600, level: 1, stype: 5, hp: 70, hpMax: 70 })]),
    enemyFormation: 1,
  })
  assert.equal(r.factors.nightAttackers, 4, '联合舰队夜战只有第二舰队参加')
  assert.equal(r.factors.nightBlocked.mainOfCombined, 4)

  // 空母（stype 11）与大破舰各自被挡下，且原因分得开
  const mixed = forecastEncounter({
    friendly: fleet([
      ship({ mstId: 1, stype: 11 }),
      ship({ mstId: 2, hp: 8, hpMax: 35 }),
      ship({ mstId: 3 }),
    ]),
    enemy: fleet([ship({ mstId: 1600, level: 1, stype: 5, hp: 70, hpMax: 70 })]),
    enemyFormation: 1,
  })
  assert.equal(mixed.factors.nightAttackers, 1)
  assert.equal(mixed.factors.nightBlocked.carrier, 1)
  assert.equal(mixed.factors.nightBlocked.taiha, 1)
  // 说明栏要把「为什么只有 1 舰参加」讲清楚
  const line = mixed.assumptions.find((l) => l.startsWith('夜战单独计算：'))
  assert.match(line, /1 舰可攻击/)
  assert.match(line, /空母 1/)
  assert.match(line, /大破 1/)
})

test('区间合成也带上夜战三项', () => {
  const enemy = fleet([ship({ mstId: 1600, level: 1, stype: 5, hp: 70, hpMax: 70 })])
  const weak = forecastEncounter({ friendly: fleet([ship()]), enemy, enemyFormation: 1 })
  const strong = forecastEncounter({
    friendly: fleet([ship(), ship({ mstId: 2 }), ship({ mstId: 3 })]),
    enemy,
    enemyFormation: 1,
  })
  const band = summarizeEncounterForecasts([weak, strong])
  assert.equal(band.night.sa.min, Math.min(weak.night.sa, strong.night.sa))
  assert.equal(band.night.sa.max, Math.max(weak.night.sa, strong.night.sa))
  assert.ok(band.night.bPlus.max >= band.bPlus.max)
})

test('昼战就能全歼时，夜战不额外增加大破风险', () => {
  // 夜战风险的机会数按「昼战后还剩几艘敌舰」算：打完就是 0 艘，
  // 那一轮里没人能开火，风险自然不涨。这一条防的是拿一个凭空系数硬加风险。
  const r = forecastEncounter({
    friendly: fleet(Array.from({ length: 6 }, (_, i) => ship({ mstId: i + 1 }))),
    enemy: fleet([
      ship({
        mstId: 1600, level: 1, stype: 3,
        hp: 20, hpMax: 20, firepower: 8, torpedo: 4,
        armor: 10, evasion: 10, asw: 0, equipment: [],
      }),
    ]),
    enemyFormation: 1,
  })
  assert.equal(r.taiha, 0)
  assert.equal(r.night.taiha, 0, '敌人昼战就没了，夜战那轮不该凭空多出大破风险')
})

test('弾着観測射撃：制空够 + 主砲+α + 水侦才吃，方向不能反', () => {
  const enemy = fleet(Array.from({ length: 4 }, (_, i) =>
    ship({ mstId: 1700 + i, level: 1, stype: 5, hp: 90, hpMax: 90, armor: 90, evasion: 50, asw: 0, equipment: [] })))
  const gun = () => equipment({ type2: 3, firepower: 35, accuracy: 4 })
  const seaplane = () => equipment({ type2: 10, los: 9, planeCount: 3 })
  // 舰战只为了把制空拉到确保
  const fighter = () => equipment({ type2: 6, antiAir: 12, planeCount: 40, proficiency: 7 })
  const bb = (over = {}) => ship({
    stype: 9, firepower: 150, torpedo: 0, hp: 90, hpMax: 90, armor: 110, asw: 0, luck: 20, ...over,
  })
  const carrier = ship({ mstId: 9, stype: 11, firepower: 40, torpedo: 0, asw: 0, equipment: [fighter()] })

  const withSpot = forecastEncounter({
    friendly: fleet([bb({ mstId: 1, equipment: [gun(), gun(), seaplane()] }), carrier]),
    enemy, enemyFormation: 1,
  })
  const noSeaplane = forecastEncounter({
    friendly: fleet([bb({ mstId: 1, equipment: [gun(), gun()] }), carrier]),
    enemy, enemyFormation: 1,
  })
  assert.equal(withSpot.factors.spottingShips, 1)
  assert.equal(noSeaplane.factors.spottingShips, 0, '没水侦不该发动')
  assert.ok(withSpot.friendlyPressure > noSeaplane.friendlyPressure, '观测射击应当抬高输出')

  // 制空不够（去掉舰战）→ 一律不发动，哪怕装备齐全
  const noAir = forecastEncounter({
    friendly: fleet([bb({ mstId: 1, equipment: [gun(), gun(), seaplane()] })]),
    enemy: fleet([...enemy.ships, ship({
      mstId: 1750, level: 1, stype: 11, hp: 90, hpMax: 90, asw: 0,
      equipment: [equipment({ type2: 6, antiAir: 20, planeCount: 60 })],
    })]),
    enemyFormation: 1,
  })
  assert.equal(noAir.factors.spottingShips, 0, '制空没到优势/确保就不该发动')
  // 说明栏认这一项。2026-09-01 起 `艦隊索敵補正` 已按源文档实装（⌊√A+0.1A⌋），
  // 原来那句「偏低」的挂账随之撤掉——留着就是在说一件已经不成立的事
  const counted = withSpot.assumptions.find((l) => l.startsWith('已计入：')) ?? ''
  assert.match(counted, /弹着观测射击 \/ 连击/)
  assert.doesNotMatch(counted, /偏低/)

  // 艦隊索敵補正是**舰队级**的：同一艘舰、同一套配装，队里多一艘素索敵高的舰，
  // 発動率就该往上走。这一条是判断「补正真的接进来了」的行为判据，
  // 光看说明栏那句话有没有变是判不出来的（源码文本护栏的老毛病）。
  const scoutFriend = ship({
    mstId: 42, stype: 3, firepower: 40, torpedo: 0, asw: 0, baseLos: 60, equipment: [],
  })
  const withScout = forecastEncounter({
    friendly: fleet([bb({ mstId: 1, equipment: [gun(), gun(), seaplane()] }), carrier, scoutFriend]),
    enemy, enemyFormation: 1,
  })
  const withBlind = forecastEncounter({
    friendly: fleet([
      bb({ mstId: 1, equipment: [gun(), gun(), seaplane()] }),
      carrier,
      { ...scoutFriend, baseLos: 0 },
    ]),
    enemy, enemyFormation: 1,
  })
  assert.ok(
    withScout.friendlyPressure > withBlind.friendlyPressure,
    '队里多一艘素索敵高的舰，弾着観測射撃発動率该跟着上去',
  )
})

test('先制对潜是额外一轮，判据与编队页同一套', () => {
  const subs = fleet(Array.from({ length: 3 }, (_, i) =>
    ship({ mstId: 1800 + i, level: 1, stype: 13, hp: 30, hpMax: 30, firepower: 0, torpedo: 40, armor: 20, evasion: 40, asw: 0, equipment: [] })))
  const sonar = () => equipment({ type2: 14, iconId: 18, asw: 10 })
  const run = (over) => forecastEncounter({
    friendly: fleet([ship({ stype: 2, equipment: [], ...over })]),
    enemy: subs, enemyFormation: 5,
  })

  // 驱逐：对潜 ≥ 100 且带声呐才有
  assert.equal(run({ asw: 80 }).factors.openingAswShips, 0)
  assert.equal(run({ asw: 105 }).factors.openingAswShips, 0, '光有对潜没声呐不算')
  const armed = run({ asw: 105, equipment: [sonar(), sonar()] })
  assert.equal(armed.factors.openingAswShips, 1)
  assert.ok(armed.friendlyPressure > run({ asw: 105 }).friendlyPressure)

  // 五十铃改二（mstId 141）自带，不看装备
  assert.equal(run({ mstId: 141, stype: 3, asw: 95 }).factors.openingAswShips, 1)
  // 海防舰门槛更低：对潜 ≥ 60 + 声呐
  assert.equal(run({ stype: 1, asw: 65, equipment: [sonar()] }).factors.openingAswShips, 1)

  const counted = armed.assumptions.find((l) => l.startsWith('已计入：')) ?? ''
  assert.match(counted, /先制对潜 1 舰（额外一轮）/)
})

test('单队炮击轮数看有没有战舰，空母不算数', () => {
  const bb = (over = {}) => ship({ stype: 9, firepower: 120, torpedo: 0, ...over })
  const cv = (over = {}) => ship({ stype: 11, firepower: 40, torpedo: 0, asw: 0, ...over })
  const dd = (over = {}) => ship({ stype: 2, ...over })
  const enemyOf = (ships) => fleet(ships.map((s, i) => ({
    ...s, mstId: 1700 + i, level: 1, hp: 90, hpMax: 90, armor: 80, evasion: 40, asw: 0, equipment: [],
  })))

  const p = (friendly, enemy) =>
    forecastEncounter({ friendly, enemy, enemyFormation: 1 }).friendlyPressure

  const plainEnemy = enemyOf([dd(), dd()])
  const bbEnemy = enemyOf([bb(), dd()])
  const cvEnemy = enemyOf([cv(), dd()])

  const myDd = fleet([dd({ mstId: 1 }), dd({ mstId: 2 })])
  // 敌方有战舰 → 两轮；同样的我方编成打没战舰的敌队只有一轮
  assert.ok(p(myDd, bbEnemy) > 0)
  const oneRound = p(myDd, plainEnemy)
  const twoRounds = p(myDd, bbEnemy)
  // 敌队更硬（战舰装甲高）却压制度更高，只可能来自多打了一轮
  assert.ok(twoRounds > oneRound, '敌方有战舰时该打两轮')
  // 空母不是判据——wikiwiki 只写战舰(含航空戦艦)，本机实测空母当判据有 12 次误报
  assert.ok(
    Math.abs(p(myDd, cvEnemy) - p(myDd, enemyOf([dd({ stype: 11, firepower: 40, torpedo: 0, asw: 0 }), dd()]))) < 1e-9,
  )

  // 我方有战舰同样触发（规则对双方对称）
  const myBb = fleet([bb({ mstId: 1 }), dd({ mstId: 2 })])
  assert.ok(p(myBb, plainEnemy) > p(fleet([dd({ mstId: 1, firepower: 120, torpedo: 0 }), dd({ mstId: 2 })]), plainEnemy))

  // 联合舰队不吃这条：主力两轮 + 护卫一轮是另一套，已由 154 场快照实测钉住
  const combined = fleet([
    ...Array.from({ length: 6 }, (_, i) => dd({ mstId: i + 1, role: 'main' })),
    ...Array.from({ length: 6 }, (_, i) => dd({ mstId: i + 7, role: 'escort' })),
  ], 1)
  const combinedPlain = forecastEncounter({ friendly: combined, enemy: plainEnemy, enemyFormation: 1 })
  const combinedBb = forecastEncounter({ friendly: combined, enemy: bbEnemy, enemyFormation: 1 })
  assert.equal(combinedPlain.factors.combinedType, 1)
  assert.ok(combinedBb.friendlyPressure > 0 && combinedPlain.friendlyPressure > 0)
})

test('演习对手是玩家舰队：制空在他手里时，敌方观测射击计入承伤（enemySpotting）', () => {
  // 我方无机、对手带舰战 → 我方制空丧失、镜像后敌方确保。
  // 敌方 BB 带 主炮×2+水侦（观测射击的发动条件与我方同一套）。
  const gun = () => equipment({ type2: 3, firepower: 35, accuracy: 4 })
  const seaplane = () => equipment({ type2: 10, los: 9, planeCount: 3 })
  const fighter = () => equipment({ type2: 6, antiAir: 12, planeCount: 40, proficiency: 7 })
  const enemyBb = ship({
    mstId: 301, stype: 9, firepower: 90, torpedo: 0, hp: 90, hpMax: 90,
    armor: 90, asw: 0, luck: 20, equipment: [gun(), gun(), seaplane()],
  })
  const enemyCv = ship({ mstId: 302, stype: 11, firepower: 40, torpedo: 0, asw: 0, equipment: [fighter()] })
  const friendly = fleet(Array.from({ length: 4 }, (_, i) =>
    ship({ mstId: 1 + i, hp: 40, hpMax: 40, armor: 40, equipment: [gun()] })))
  const input = { friendly, enemy: fleet([enemyBb, enemyCv]), enemyFormation: 1 }

  const asAbyssal = forecastEncounter(input)
  const asPlayer = forecastEncounter({ ...input, enemySpotting: true })
  // 深海路径不变：敌方从不发动观测
  assert.equal(asAbyssal.air.stateMin >= 3, true, '前置：我方制空应处于劣势/丧失')
  assert.ok(asPlayer.enemyPressure > asAbyssal.enemyPressure, '敌方观测应抬高其压制度')
  assert.ok(asPlayer.taiha >= asAbyssal.taiha, '敌方观测不该降低我方大破风险')
  assert.ok(asPlayer.bPlus <= asAbyssal.bPlus, '敌方观测不该抬高我方胜率')

  // 我方制空确保时镜像给敌方的是丧失——enemySpotting 不该凭空削我方
  const airFriendly = fleet([
    ...friendly.ships.slice(0, 3),
    ship({ mstId: 9, stype: 11, firepower: 40, torpedo: 0, asw: 0,
      equipment: [equipment({ type2: 6, antiAir: 30, planeCount: 60, proficiency: 7 })] }),
  ])
  const weAir = forecastEncounter({ ...input, friendly: airFriendly })
  const weAirPlayer = forecastEncounter({ ...input, friendly: airFriendly, enemySpotting: true })
  assert.ok(weAir.air.stateMin <= 2, '前置：我方应至少制空优势')
  assert.ok(Math.abs(weAirPlayer.enemyPressure - weAir.enemyPressure) < 1e-9,
    '我方优势/确保时敌方拿不到观测，两者应一致')
})

test('通用配装模板：按舰种给通用件，观测/制空的发动件齐全', async () => {
  const { genericLoadoutByStype } = (await import('../dist/shared/practice-loadout.js')).default ??
    (await import('../dist/shared/practice-loadout.js'))
  // 战舰：双主炮 + 水侦——正好凑齐敌方观测射击的发动条件
  const bb = genericLoadoutByStype(9, 4)
  assert.equal(bb.length, 3)
  assert.equal(bb.filter((p) => p.plane).length, 1)
  // 空母：全槽有机，第一槽舰战
  const cv = genericLoadoutByStype(11, 4)
  assert.equal(cv.length, 4)
  assert.ok(cv.every((p) => p.plane))
  // 槽数不足时裁到槽数
  assert.equal(genericLoadoutByStype(9, 2).length, 2)
  // 海防舰不能装备鱼雷；给它套驱逐模板会凭空产生闭幕雷击
  const de = genericLoadoutByStype(1, 2)
  assert.equal(de.length, 1)
  assert.equal(de[0].mstId, 2)
  // 补给舰等没有模板：维持未知，不硬造
  assert.deepEqual(genericLoadoutByStype(22, 4), [])
})

// ---- 改修强化值：昼炮击与雷击是两相，系数不是一回事 ----

test('大口径主炮的改修强化：昼炮击 1.5√★，与小/中口径不是同一档', () => {
  // 领域文档《舰队收藏-战斗计算模型》§16.2：
  //   小口径主炮 / 中口径主炮  昼炮击 √★   夜战 √★
  //   大口径主炮              昼炮击 1.5√★ 夜战 √★
  // 原先三者混在同一档 1.0√★，大口径的昼炮击整片低估。
  const root = Math.sqrt(9)
  assert.equal(forecastImprovementPower({ type2: 3, level: 9 }, 'shell'), 1.5 * root)
  for (const type2 of [1, 2, 4, 18, 19, 21]) {
    assert.equal(
      forecastImprovementPower({ type2, level: 9 }, 'shell'),
      root,
      `type2 ${type2} 不该跟着大口径一起抬`,
    )
  }
  // 鱼雷 1.2√★、声呐/爆雷 0.75√★ 那两档没动
  for (const type2 of [5, 22, 32]) {
    assert.equal(forecastImprovementPower({ type2, level: 9 }, 'shell'), 1.2 * root)
  }
  for (const type2 of [14, 15, 40]) {
    assert.equal(forecastImprovementPower({ type2, level: 9 }, 'shell'), 0.75 * root)
  }
  assert.equal(forecastImprovementPower({ type2: 3, level: 0 }, 'shell'), 0, '★0 一点都不加')
})

test('雷击相：只有雷装系装备参与，炮/弹/声呐一律 0', () => {
  // 依据 wikiwiki「改修工廠」的「装備別補正値(検証中)」表（按相位分列，查证日 2026-08-22）：
  //   「雷撃戦」一列非零的只有 魚雷 1.2√★ / 対空機銃 1.2√★ / 潜水艦魚雷 0.2★
  //   主炮（小·中·大）、副炮、徹甲弾、三式弾、特殊潜航艇、ソナー、爆雷 全部写 0
  const root = Math.sqrt(16)
  for (const type2 of [1, 2, 3, 4, 14, 15, 18, 19, 22, 40]) {
    assert.equal(
      forecastImprovementPower({ type2, level: 16 }, 'torpedo'),
      0,
      `type2 ${type2} 不该往雷击攻击力里加改修`,
    )
  }
  // 雷装系维持原系数：机铳(21)一手表写 1.2√★、潜水舰鱼雷(32)写 0.2★，
  // 这两格的系数订正是另一次裁定，这一改没动——护栏钉住现值，改的时候必须连这里一起改。
  assert.equal(forecastImprovementPower({ type2: 5, level: 16 }, 'torpedo'), 1.2 * root)
  assert.equal(forecastImprovementPower({ type2: 32, level: 16 }, 'torpedo'), 1.2 * root)
  assert.equal(forecastImprovementPower({ type2: 21, level: 16 }, 'torpedo'), root)
  assert.notEqual(
    forecastImprovementPower({ type2: 3, level: 16 }, 'shell'),
    forecastImprovementPower({ type2: 3, level: 16 }, 'torpedo'),
    '两相共用一个系数就是这次要修掉的那个毛病',
  )
})

test('夜战那一路在 night-battle 里另算，大口径仍是 √★（与文档一致，不该被昼战的修改带偏）', async () => {
  const night = (await import('../dist/shared/night-battle.js')).default ?? (await import('../dist/shared/night-battle.js'))
  const root = Math.sqrt(9)
  assert.equal(night.nightImprovement({ type2: 3, level: 9 }), root)
  assert.equal(
    forecastImprovementPower({ type2: 3, level: 9 }, 'shell'),
    1.5 * root,
    '昼夜两相若又相等，说明有人把夜战那张表也改了',
  )
})
