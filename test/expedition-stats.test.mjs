import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import expeditionStats from '../dist/shared/expedition-stats.js'

const { evaluateExpeditionStats } = expeditionStats.default ?? expeditionStats

const blankStats = {
  firepower: 0,
  antiAir: 0,
  antiSubmarine: 0,
  lineOfSight: 0,
}

test('远征 46：零观面值刚够时按舰载机对潜下限标待核', () => {
  const cruiserWithSeaplane = {
    stats: { ...blankStats, antiSubmarine: 110 },
    equipment: [
      {
        type2: 10,
        iconId: 10,
        airborne: true,
        stats: { ...blankStats, antiSubmarine: 4 },
        star: 0,
      },
    ],
  }

  const result = evaluateExpeditionStats(
    [cruiserWithSeaplane, cruiserWithSeaplane],
    { antiSubmarine: 220 },
  )

  assert.deepEqual(result.antiSubmarine, {
    sure: 216,
    face: 220,
    verdict: 'wait',
    basis: true,
  })
})

test('只有非舰载机装备时下限等于显示面值', () => {
  const result = evaluateExpeditionStats(
    [
      {
        stats: {
          firepower: 75,
          antiAir: 82,
          antiSubmarine: 68,
          lineOfSight: 49,
        },
        equipment: [
          {
            type2: 1,
            iconId: 1,
            airborne: false,
            stats: {
              firepower: 3,
              antiAir: 1,
              antiSubmarine: 0,
              lineOfSight: 0,
            },
            star: 0,
          },
        ],
      },
    ],
    {
      firepower: 70,
      antiAir: 80,
      antiSubmarine: 60,
      lineOfSight: 45,
    },
  )

  assert.deepEqual(result, {
    firepower: { sure: 75, face: 75, verdict: 'ok' },
    antiAir: { sure: 82, face: 82, verdict: 'ok' },
    antiSubmarine: { sure: 68, face: 68, verdict: 'ok' },
    lineOfSight: { sure: 49, face: 49, verdict: 'ok' },
  })
})

test('声呐改修对潜按每舰合计后保留一位小数', () => {
  const result = evaluateExpeditionStats(
    [
      {
        stats: { ...blankStats, antiSubmarine: 70 },
        equipment: [
          {
            type2: 14,
            iconId: 14,
            airborne: false,
            stats: { ...blankStats, antiSubmarine: 10 },
            star: 6,
          },
        ],
      },
    ],
    { antiSubmarine: 72.4 },
  )

  assert.deepEqual(result.antiSubmarine, {
    sure: 72.4,
    face: 70,
    verdict: 'ok',
    basis: true,
  })
})

test('对空与索敌的舰载机面值不进入下限', () => {
  const result = evaluateExpeditionStats(
    [
      {
        stats: { ...blankStats, antiAir: 80, lineOfSight: 55 },
        equipment: [
          {
            type2: 10,
            iconId: 10,
            airborne: true,
            stats: { ...blankStats, antiAir: 2, lineOfSight: 5 },
            star: 0,
          },
        ],
      },
    ],
    { antiAir: 80, lineOfSight: 55 },
  )

  assert.deepEqual(result, {
    antiAir: { sure: 78, face: 80, verdict: 'wait', basis: true },
    lineOfSight: { sure: 50, face: 55, verdict: 'wait', basis: true },
  })
})

test('火力照常计入舰载机面值', () => {
  const result = evaluateExpeditionStats(
    [
      {
        stats: { ...blankStats, firepower: 61 },
        equipment: [
          {
            type2: 7,
            iconId: 7,
            airborne: true,
            stats: { ...blankStats, firepower: 1 },
            star: 0,
          },
        ],
      },
    ],
    { firepower: 61 },
  )

  assert.deepEqual(result.firepower, {
    sure: 61,
    face: 61,
    verdict: 'ok',
  })
})

test('火力与对空改修按装备类别和高角炮图标计入', () => {
  const equipment = [
    { type2: 1, iconId: 16, airborne: false },
    { type2: 2, iconId: 2, airborne: false },
    { type2: 3, iconId: 3, airborne: false },
    { type2: 4, iconId: 4, airborne: false },
    { type2: 12, iconId: 11, airborne: false },
    { type2: 13, iconId: 11, airborne: false },
    { type2: 21, iconId: 15, airborne: false },
  ].map((entry) => ({
    ...entry,
    stats: blankStats,
    star: 4,
  }))
  const result = evaluateExpeditionStats(
    [
      {
        stats: { ...blankStats, firepower: 100, antiAir: 100 },
        equipment,
      },
    ],
    { firepower: 108, antiAir: 104 },
  )

  assert.deepEqual(result, {
    firepower: { sure: 108, face: 100, verdict: 'ok', basis: true },
    antiAir: { sure: 104, face: 100, verdict: 'ok', basis: true },
  })
})

test('舰载机扣减与改修加成相抵时仍标记该栏用过口径', () => {
  const result = evaluateExpeditionStats(
    [
      {
        stats: { ...blankStats, antiAir: 100 },
        equipment: [
          {
            type2: 10,
            iconId: 10,
            airborne: true,
            stats: { ...blankStats, antiAir: 2 },
            star: 0,
          },
          {
            type2: 21,
            iconId: 15,
            airborne: false,
            stats: blankStats,
            star: 4,
          },
        ],
      },
    ],
    { antiAir: 100 },
  )

  assert.deepEqual(result.antiAir, {
    sure: 100,
    face: 100,
    verdict: 'ok',
    basis: true,
  })
})

test('镖的条件检查与推荐编队共用远征属性纯函数和下限判定', () => {
  const bi = readFileSync(
    new URL('../src/renderer/modules/bi.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    bi,
    /evaluateExpeditionStats\(expeditionStatShipsOf\(ships\), requirements\)/,
    '条件检查没有调用共享的远征属性纯函数',
  )
  assert.doesNotMatch(bi, /const SUM: Record<string, \(s: PlayerShip\) => number>/)
  assert.match(bi, /推荐高于下限/)
  const basisBlock = bi.match(
    /const EXPEDITION_STAT_BASIS: Record<ExpeditionStatKey, string> = \{([\s\S]*?)\n\}/,
  )
  assert.ok(basisBlock, '远征属性栏没有按属性提供悬停口径')
  const basis = Object.fromEntries(
    [...basisBlock[1].matchAll(/^\s{2}(\w+): '([^']*)',?$/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  )
  assert.deepEqual(basis, {
    firepower:
      '按游戏远征判定口径：舰载机火力按面值计 · 改修★计入（小口径炮 0.5√★、中/大口径炮 √★、副炮 0.5√★、电探 0.5√★）；折算后达到要求值才算稳',
    antiAir:
      '按游戏远征判定口径：不计舰载机对空 · 改修★计入（高角炮 √★、机枪 √★）；折算后达到要求值才算稳',
    antiSubmarine:
      '按游戏远征判定口径：舰载机对潜按 ⌊素值×0.65⌋ 计 · 改修★计入（声纳、爆雷投射机、爆雷 √★）；折算后达到要求值才算稳',
    lineOfSight:
      '按游戏远征判定口径：不计舰载机索敌 · 改修★不计；折算后达到要求值才算稳',
  })
  assert.match(basis.firepower, /面值/)
  assert.match(basis.antiAir, /不计舰载机对空/)
  assert.match(basis.antiSubmarine, /0\.65/)
  assert.match(basis.lineOfSight, /不计舰载机索敌/)
  assert.doesNotMatch(basis.firepower, /舰载机对潜|0\.65/)
  assert.match(
    bi,
    /title: result\.basis \? EXPEDITION_STAT_BASIS\[stat\] : undefined/,
    '无折算且未使用改修加成的属性栏仍会挂长口径',
  )
  assert.match(
    bi,
    /verdict\.fails === 0 && verdict\.unknowns === 0/,
    '推荐编队仍会把属性待核项说成全条件满足',
  )
})
