import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyFitBonusCorrections,
  FIT_BONUS_CORRECTIONS,
  fitRuleFingerprint,
} from '../src/shared/fit-bonus-corrections.ts'
import { expectedFitBonus } from '../src/shared/fit-bonus.ts'

const correction = FIT_BONUS_CORRECTIONS.find((entry) => entry.equipId === 322)
const rule = (row, forms, flat) => ({
  row, who: { forms }, gain: { kind: 'flat', flat }, stack: 'perEquip',
})
const fixture = () => ({
  schemaVersion: 1, equipGroups: {}, unresolved: [],
  equips: {
    322: {
      id: 322, nameJa: '测试装备', nameZh: '测试装备',
      rules: [
        rule(1, [553, 554], { fire: 5, aa: 2, asw: 1, evasion: 2 }),
        rule(2, [501, 502, 506, 507], { fire: 3, aa: 1, evasion: 2 }),
        rule(3, [663, 668], { fire: 3, aa: 1, evasion: 2 }),
        rule(4, [662], { fire: 3, evasion: 1 }),
      ],
    },
  },
})
const revise = (t, changes) => {
  const before = { ...correction }
  t.after(() => Object.assign(correction, before))
  Object.assign(correction, changes)
}
const apply = (data) => {
  const skipped = []
  const result = applyFitBonusCorrections(data, (entry, reason, detail) => {
    if (entry === correction) skipped.push({ reason, detail })
  })
  return { ...result, skipped }
}

for (const stack of ['perEquip', 'once']) {
  test(`补正逐行 stack/note 覆盖与条目级 ${stack} 缺省都生效`, (t) => {
    revise(t, {
      stack, note: '条目说明', rows: [],
      patches: [
        { forms: [1], delta: { fire: 2 }, stack: 'once', note: '只算一次' },
        { forms: [2], delta: { fire: 3 }, stack: 'perEquip', note: '按件数' },
        { forms: [3], delta: { fire: 4 } },
      ],
    })
    const { data, applied, skipped } = apply(fixture())
    assert.equal(applied, 1)
    assert.deepEqual(skipped, [])
    const extra = data.equips[322].rules.filter((row) => row.row === 0)
    assert.deepEqual(extra.map((row) => [row.stack, row.correction]), [
      ['once', '只算一次'], ['perEquip', '按件数'], [stack, '条目说明'],
    ])
    for (const [formId, fire] of [[1, 2], [2, 6], [3, stack === 'once' ? 4 : 8]]) {
      assert.deepEqual(
        expectedFitBonus(data, { formId, ctype: -1, stype: -1 }, [{ mstId: 322 }, { mstId: 322 }]).stats,
        { fire },
      )
    }
  })
}

test('stackUnverified 写到生成行，缺省不写，且不进入指纹', () => {
  const { data } = apply(fixture())
  const extra = data.equips[322].rules.filter((row) => row.row === 0)
  assert.equal(extra[0].stackUnverified, true)
  assert.ok(extra.slice(1).every((row) => !Object.hasOwn(row, 'stackUnverified')))
  const { stackUnverified, ...withoutMarker } = extra[0]
  assert.equal(fitRuleFingerprint(extra[0]), fitRuleFingerprint(withoutMarker))
  assert.equal(fitRuleFingerprint({ ...withoutMarker, layer: '测试分层' }), fitRuleFingerprint(extra[0]))
})

test('rows 在所有原指纹命中后分别替换 stack 与整个 who，输入包保持原样', (t) => {
  const original = fixture()
  original.equips[322].rules[1].who.classes = [99]
  revise(t, {
    watch: original.equips[322].rules.map((row) => ({ row: row.row, fingerprint: fitRuleFingerprint(row) })),
  })
  const before = structuredClone(original)
  const { data, applied, skipped } = apply(original)
  assert.equal(applied, 1)
  assert.deepEqual(skipped, [])
  assert.deepEqual(original, before)
  assert.deepEqual(data.equips[322].rules[3], { ...before.equips[322].rules[3], stack: 'once' })
  assert.deepEqual(data.equips[322].rules[1], { ...before.equips[322].rules[1], who: { forms: [501, 506] } })
  for (const index of [1, 3]) {
    const watched = correction.watch.find((watch) => watch.row === index + 1)
    assert.equal(fitRuleFingerprint(original.equips[322].rules[index]), watched.fingerprint)
    assert.notEqual(fitRuleFingerprint(data.equips[322].rules[index]), watched.fingerprint)
  }
  for (const index of [0, 2]) assert.deepEqual(data.equips[322].rules[index], before.equips[322].rules[index])
})

test('rows 的目标行缺失时整条跳过并告警 no-row，不留下部分改写或补正', () => {
  const original = fixture()
  original.equips[322].rules = original.equips[322].rules.filter((row) => row.row !== 4)
  const before = structuredClone(original)
  const { data, applied, skipped } = apply(original)
  assert.equal(applied, 0)
  assert.deepEqual(skipped, [{ reason: 'no-row', detail: '第 4 行不见了' }])
  assert.deepEqual(data, before)
  assert.deepEqual(original, before)
})

test('后面的 watch 指纹不符时整条跳过，前面的 rows 也不改写', () => {
  const original = fixture()
  original.equips[322].rules[3].gain.flat.fire = 99
  const before = structuredClone(original)
  const { data, applied, skipped } = apply(original)
  assert.equal(applied, 0)
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].reason, 'fingerprint')
  assert.deepEqual(data, before)
  assert.deepEqual(original, before)
})

test('rows 改写行未列入 watch 时抛出台账自检错误', (t) => {
  revise(t, { rows: [{ row: 5, stack: 'once' }] })
  assert.throws(() => apply(fixture()), /修正台账自检错误：装备 322 改写的第 5 行不在 watch 中/)
})
