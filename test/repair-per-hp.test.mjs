import assert from 'node:assert/strict'
import test from 'node:test'
import berth from '../dist/shared/berth-repair.js'
import { repairDurationSeconds, renderFleetQuote, renderPreview } from './fixtures/render-repair-quote.mjs'
import { AKASHI, reset, renderBerth } from './fixtures/render-ru-berth.mjs'

const { berthPerHpMs, berthEstimateHp } = berth
const MIN = 60_000
const ship = (overrides = {}) => ({
  id: 1, shipId: 656, nowhp: 38, maxhp: 40, ndockTime: 1_507_001,
  ndockItem: [10, 20], lv: 80, expTotal: 1000, cond: 49, ...overrides,
})

test('每点工时保留毫秒精度：整除、非整除；满血或无工时返回无', () => {
  assert.equal(berthPerHpMs(ship({ ndockTime: 22 * MIN })), 11 * MIN)
  assert.equal(berthPerHpMs(ship()), 753_500.5)
  for (const overrides of [{ nowhp: 40 }, { ndockTime: 0 }, { ndockTime: -1 }]) {
    assert.equal(berthPerHpMs(ship(overrides)), null)
  }
  assert.equal(repairDurationSeconds(berthPerHpMs(ship())), '12分34秒')
})

test('每点工时与回复估算同源：k 倍阈值截到整分钟后遵守预热和夹取', () => {
  for (const [ndockTime, expected] of [
    [110 * MIN, [0, 2, 3, 8, 10, 10]],
    [1_507_001, [0, 0, 0, 7, 9, 10]],
    [400 * MIN, [1, 2, 3, 8, 10, 10]],
  ]) {
    const target = ship({ nowhp: 30, ndockTime })
    const perHp = berthPerHpMs(target)
    for (const [index, k] of [1, 2, 3, 8, 10, 15].entries()) {
      const elapsed = Math.floor(k * perHp / MIN) * MIN
      assert.equal(berthEstimateHp(target, elapsed), expected[index])
    }
  }
})

test('秒级工时格式：59秒、12分34秒、1小时02分03秒及向上进位', () => {
  for (const [ms, text] of [
    [59_000, '59秒'], [754_000, '12分34秒'], [3_723_000, '1小时02分03秒'],
    [59_001, '1分0秒'], [3_599_001, '1小时00分00秒'],
  ]) assert.equal(repairDurationSeconds(ms), text)
})

for (const [label, render] of [['编队舰卡', renderFleetQuote], ['舰娘详情', renderPreview]]) {
  test(`${label}真产物：受损未入渠出现正确工时，紧随预计修理`, () => {
    const html = render(ship())
    assert.match(html, /预计修理 <b>26分<\/b>(?:<\/span>\s*<span class="pv-pill">|\s*· )每 1 HP <b>12分34秒<\/b>/)
    assert.equal((html.match(/每 1 HP/g) ?? []).length, 1)
  })
  test(`${label}真产物：满血、在渠、工时非正均不显示`, () => {
    for (const [overrides, docked] of [[{ nowhp: 40 }, false], [{}, true], [{ ndockTime: 0 }, false], [{ ndockTime: -1 }, false]]) {
      const html = render(ship(overrides), docked)
      assert.doesNotMatch(html, /每 1 HP|预计修理/)
    }
  })
}

test('泊地页真产物：仅范围内修理中的行显示，保留 HP 和预估回复', () => {
  reset({
    fleets: [{ id: 1, since: Date.now() - 30 * MIN, ships: [
      { id: 1, spec: AKASHI, nowhp: 40, maxhp: 40, facilities: 4, ndockTime: 1000 },
      ship({ id: 2 }), ship({ id: 3, nowhp: 20 }), ship({ id: 4 }),
      ship({ id: 5, ndockTime: 0 }), ship({ id: 6, ndockTime: -1 }), ship({ id: 7 }),
    ] }], docked: [4],
  })
  const html = renderBerth()
  const rows = [...html.matchAll(/<div class="bt-ship(?: out)?" data-berth-pos="\d+"[^]*?(?=<div class="bt-ship(?: out)?"|$)/g)].map((match) => match[0])
  assert.equal(rows.length, 7)
  assert.match(rows[1], /s-repairing/)
  assert.match(rows[1], /每 1 HP 12分34秒/)
  assert.match(rows[1], /38\/40/)
  assert.match(rows[1], /<b>\+2<\/b><em>预估<\/em>/)
  for (const index of [0, 2, 3, 4, 5, 6]) assert.doesNotMatch(rows[index], /每 1 HP/)
  assert.match(rows[6], /范围外/)
  assert.equal((html.match(/每 1 HP/g) ?? []).length, 1)
})
