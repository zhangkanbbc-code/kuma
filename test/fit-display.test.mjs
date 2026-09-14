import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fitDisplayLines } from '../src/shared/fit-display.ts'
import { expectedFitBonus } from '../src/shared/fit-bonus.ts'
import { applyFitBonusCorrections } from '../src/shared/fit-bonus-corrections.ts'
import { applyFitBonusSupplement } from '../src/shared/fit-bonus-supplement.ts'

const flat = (row, forms, stats, extra = {}) => ({
  row, who: { forms }, gain: { kind: 'flat', flat: stats }, stack: 'perEquip', ...extra,
})

test('显示分区：按件上游与单次修正子集分别合计，来源保持原顺序且输入不变', () => {
  const rules = [
    flat(1, [3, 1, 2], { fire: 5, aa: 1 }),
    flat(0, [1, 2], { fire: 3, evasion: 2 }, { stack: 'once', correction: '依据' }),
  ]
  const before = structuredClone(rules)
  const lines = fitDisplayLines(rules)
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0], {
    who: { forms: [3] }, rules: [rules[0]], corrections: [], mode: 'perEquip',
    first: { fire: 5, aa: 1 }, more: { fire: 5, aa: 1 }, stackUnverified: false,
  })
  assert.deepEqual(lines[1], {
    who: { forms: [1, 2] }, rules, corrections: [rules[1]], mode: 'mixed',
    first: { fire: 8, aa: 1, evasion: 2 }, more: { fire: 5, aa: 1 }, stackUnverified: false,
  })
  assert.deepEqual(rules, before)
})

test('显示全单次：第一件为唯一合计，之后每件为空', () => {
  const lines = fitDisplayLines([
    flat(1, [1], { fire: 3 }, { stack: 'once' }),
    flat(0, [1], { fire: -1, aa: 2 }, { stack: 'once', correction: '依据' }),
  ])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].mode, 'once')
  assert.deepEqual(lines[0].first, { fire: 2, aa: 2 })
  assert.equal(lines[0].more, null)
})

test('显示合计：正负修正抵消后不保留零值键', () => {
  const [line] = fitDisplayLines([
    flat(1, [1], { fire: 2, aa: -1 }),
    flat(0, [1], { aa: 1 }, { correction: '依据' }),
  ])
  assert.deepEqual(line.first, { fire: 2 })
  assert.deepEqual(line.more, { fire: 2 })
})

test('显示直通：分档、条件、非形态维度、封顶、整套、分层与 table 均逐行保留', () => {
  const variants = [
    { gain: { kind: 'byStar', steps: [{ from: 0, to: null, stats: { fire: 2 } }] } },
    { need: { star: 1 } }, { who: { classes: [1] } }, { cap: 2 },
    { not: { forms: [2] } }, { setTotal: { fire: 3 } }, { layer: '另表' },
    { who: { forms: [1], types: [2] } }, { who: { forms: [1], all: false } },
    { who: { forms: [1], nations: [1] } }, { stack: 'table' },
  ]
  const rules = variants.map((extra, i) => flat(i + 1, [1], { fire: 1 }, extra))
  const lines = fitDisplayLines(rules)
  assert.equal(lines.length, rules.length)
  lines.forEach((line, i) => {
    assert.equal(line.mode, 'passthrough')
    assert.equal(line.who, rules[i].who)
    assert.deepEqual(line.rules, [rules[i]])
    assert.deepEqual(line.first, i === 0 ? {} : { fire: 1 })
    assert.equal(line.more, null)
  })
})

test('显示顺序：最小上游 row 定位，直通原位，纯修正最后，同锚按形态首次出现', () => {
  const rules = [
    flat(0, [8], { fire: 1 }, { correction: '独有' }),
    flat(9, [3, 1, 2], { fire: 1 }),
    flat(3, [7], { fire: 1 }, { need: { star: 1 } }),
    flat(4, [3, 1, 2], { aa: 1 }),
    flat(5, [4], { fire: 2 }),
    flat(0, [1, 2], { fire: 1 }, { correction: '子集' }),
    flat(6, [9], { fire: 1 }, { cap: 1 }),
  ]
  const lines = fitDisplayLines(rules)
  assert.deepEqual(lines.map((line) => line.who.forms), [[7], [3], [1, 2], [4], [9], [8]])
  assert.deepEqual(lines[2].rules, [rules[1], rules[3], rules[5]])
})

test('显示形态筛选：只出覆盖目标的一条合并线，并保留全部直通', () => {
  const pass = flat(3, [9], { fire: 1 }, { need: { star: 1 } })
  const rules = [flat(1, [1, 2, 3], { fire: 1 }), flat(2, [2, 3], { aa: 1 }), pass]
  const lines = fitDisplayLines(rules, { formId: 2 })
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0].who.forms, [2, 3])
  assert.deepEqual(lines[0].first, { fire: 1, aa: 1 })
  assert.equal(lines[1].mode, 'passthrough')
  assert.deepEqual(fitDisplayLines(rules, { formId: 99 }).map((line) => line.rules), [[pass]])
})

test('显示累积待实测：任一来源携带即传递，直通也保留', () => {
  const lines = fitDisplayLines([
    flat(1, [1, 2], { fire: 1 }),
    flat(0, [2], { aa: 1 }, { correction: '依据', stackUnverified: true }),
    flat(2, [1], { fire: 1 }, { cap: 1, stackUnverified: true }),
  ])
  assert.deepEqual(lines.map((line) => line.stackUnverified), [false, true, true])
})

const packFile = new URL('../assets/lodes/kcwiki-fit-bonus.json', import.meta.url)
const realPack = fs.existsSync(packFile)
  ? applyFitBonusSupplement(applyFitBonusCorrections(JSON.parse(fs.readFileSync(packFile, 'utf8')).data).data).data
  : null
const realSkip = realPack ? false : '缺 assets/lodes/kcwiki-fit-bonus.json'

test('真包显示：322 的伊勢型、能代、矢矧、最上与三隈分开锁定首件和后续', { skip: realSkip }, () => {
  const cases = [
    [[553, 554], 'perEquip', { fire: 8, aa: 3, asw: 1, evasion: 4 }, { fire: 8, aa: 3, asw: 1, evasion: 4 }, true],
    [[662], 'once', { fire: 4, asw: 1, evasion: 2 }, null, false],
    [[663, 668], 'mixed', { fire: 4, aa: 1, asw: 1, evasion: 3 }, { fire: 3, aa: 1, evasion: 2 }, false],
    [[501, 506], 'mixed', { fire: 4, aa: 1, evasion: 3 }, { fire: 3, aa: 1, evasion: 2 }, false],
    [[502, 507], 'mixed', { fire: 3, aa: 1, evasion: 3 }, { fire: 2, aa: 1, evasion: 2 }, false],
  ]
  const lines = fitDisplayLines(realPack.equips['322'].rules)
  for (const [forms, mode, first, more, stackUnverified] of cases) {
    const line = lines.find((line) => line.who.forms?.includes(forms[0]))
    assert.ok(line)
    assert.deepEqual(line.who.forms, forms)
    assert.equal(line.mode, mode)
    assert.deepEqual(line.first, first)
    assert.deepEqual(line.more, more)
    assert.equal(line.stackUnverified, stackUnverified)
    assert.ok(line.corrections.length > 0)
  }
})

test('真包显示：26 最上与三隈差额不同，分别合并为两条 mixed 线', { skip: realSkip }, () => {
  const lines = fitDisplayLines(realPack.equips['26'].rules)
  const mogami = lines.filter((line) => line.who.forms?.some((form) => [501, 506, 502, 507].includes(form)))
  assert.equal(mogami.length, 2)
  assert.deepEqual(mogami.map((line) => line.who.forms), [[501, 506], [502, 507]])
  assert.deepEqual(mogami.map((line) => line.first), [
    { fire: 3, aa: 1, evasion: 2 },
    { fire: 2, aa: 1, evasion: 2 },
  ])
  for (const line of mogami) {
    assert.equal(line.mode, 'mixed')
    assert.deepEqual(line.more, { fire: 2, aa: 1, evasion: 1 })
    assert.equal(line.rules.length, 3)
    assert.equal(line.corrections.length, 1)
  }
})

test('真包全量显示：每条合并线的每个形态，一件与两件均与求值器互证', { skip: realSkip }, () => {
  let checked = 0
  for (const entry of Object.values(realPack.equips)) {
    for (const line of fitDisplayLines(entry.rules)) {
      if (line.mode === 'passthrough') continue
      const linePack = {
        ...realPack,
        equips: { ...realPack.equips, [entry.id]: { ...entry, rules: line.rules } },
      }
      for (const formId of line.who.forms) {
        const ship = { formId, ctype: -1, stype: -1 }
        const equip = { mstId: entry.id, star: 0 }
        const second = { ...line.first }
        for (const [key, value] of Object.entries(line.more ?? {})) second[key] = (second[key] ?? 0) + value
        assert.deepEqual(line.first, expectedFitBonus(linePack, ship, [equip]).stats, `${entry.id} × ${formId} 一件`)
        assert.deepEqual(second, expectedFitBonus(linePack, ship, [equip, equip]).stats, `${entry.id} × ${formId} 两件`)
        checked++
      }
    }
  }
  assert.ok(checked > 0)
})
