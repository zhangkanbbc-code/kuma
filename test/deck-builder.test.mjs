import assert from 'node:assert/strict'
import test from 'node:test'

import deckBuilder from '../dist/shared/deck-builder.js'

const {
  deckBuilderJson,
  deckBuilderUrl,
  deckItemIds,
  deckShipIds,
  encodeDeckBuilder,
  parseDeckBuilder,
} = deckBuilder

// 上游 gist 的官方示例，逐字照抄。注意它里面 rf 是字符串、mas 是数字——
// 而本地普查文档把 mas 记成了字符串。读必须两种都吃。
const OFFICIAL =
  '{"version":4,"hqlv":113,"f1":{"s1":{"id":"277","lv":142,"luck":59,"items":{"ix":{"id":72,"rf":"6"},"i3":{"id":157,"rf":"10","mas":7}}}}}'

test('吃得下上游官方示例，含字符串型 rf 与数字型 mas', () => {
  const { deck, error, warnings } = parseDeckBuilder(OFFICIAL)
  assert.equal(error, null)
  assert.deepEqual(warnings, [])
  assert.equal(deck.hqLv, 113)
  const ship = deck.fleets[0].ships[0]
  assert.equal(ship.mstId, 277)
  assert.equal(ship.lv, 142)
  assert.equal(ship.luck, 59)
  // i3 在第三格，前两格是空的
  assert.equal(ship.slots[0], null)
  assert.equal(ship.slots[1], null)
  assert.deepEqual(ship.slots[2], { mstId: 157, rf: 10, mas: 7 })
  assert.deepEqual(ship.exSlot, { mstId: 72, rf: 6 })
})

test('数字型 rf 与字符串型 mas 同样吃得下', () => {
  const { deck, error } = parseDeckBuilder(
    '{"version":4,"hqlv":1,"f1":{"s1":{"id":"1","lv":1,"luck":-1,"items":{"i1":{"id":5,"rf":3,"mas":"7"}}}}}',
  )
  assert.equal(error, null)
  assert.deepEqual(deck.fleets[0].ships[0].slots[0], { mstId: 5, rf: 3, mas: 7 })
})

test('luck 的 -1 原样保留，不能默默变成 0', () => {
  // -1 是「未指定」，0 是「运真的是零」。混掉会把未知报成事实。
  const { deck } = parseDeckBuilder('{"version":4,"hqlv":1,"f1":{"s1":{"id":"1","lv":1,"luck":-1,"items":{}}}}')
  assert.equal(deck.fleets[0].ships[0].luck, -1)
  const noLuck = parseDeckBuilder('{"version":4,"hqlv":1,"f1":{"s1":{"id":"1","lv":1,"items":{}}}}')
  assert.equal(noLuck.deck.fleets[0].ships[0].luck, -1)
})

test('载入链接里的 predeck 参数也能直接粘贴', () => {
  const url = `http://kancolle-calc.net/deckbuilder.html?predeck=${encodeURIComponent(OFFICIAL)}`
  const { deck, error } = parseDeckBuilder(url)
  assert.equal(error, null)
  assert.equal(deck.fleets[0].ships[0].mstId, 277)
})

test('读不出来时明说读不出来，不返回空编成冒充成功', () => {
  assert.match(parseDeckBuilder('').error, /没有内容/)
  assert.match(parseDeckBuilder('随便一段文字').error, /不是合法的 JSON/)
  assert.match(parseDeckBuilder('[1,2,3]').error, /不是一个 JSON 对象|没读到任何舰队/)
  assert.match(parseDeckBuilder('{"version":4,"hqlv":1}').error, /没读到任何舰队/)
  // 读得出来但可疑的，照实挂出来，不静默
  const other = parseDeckBuilder('{"version":3,"hqlv":1,"f1":{"s1":{"id":"1","lv":1,"items":{}}}}')
  assert.equal(other.error, null)
  assert.ok(other.warnings.some((w) => /version 3/.test(w)))
  const noHq = parseDeckBuilder('{"version":4,"f1":{"s1":{"id":"1","lv":1,"items":{}}}}')
  assert.ok(noHq.warnings.some((w) => /司令部等级/.test(w)))
})

test('导出：舰娘 id 是字符串，装备 id 是数字', () => {
  // 这两个类型是反的，抄错一个就跟社区工具对不上
  const out = encodeDeckBuilder({
    hqLv: 120,
    fleets: [
      { ships: [{ mstId: 277, lv: 142, luck: 59, slots: [{ mstId: 157, rf: 10, mas: 7 }], exSlot: null }] },
      null,
      null,
      null,
    ],
  })
  assert.equal(out.version, 4)
  assert.equal(out.hqlv, 120)
  assert.equal(typeof out.f1.s1.id, 'string')
  assert.equal(out.f1.s1.id, '277')
  assert.equal(typeof out.f1.s1.items.i1.id, 'number')
  assert.equal(out.f1.s1.items.i1.rf, 10)
  assert.equal(out.f1.s1.items.i1.mas, 7)
})

test('导出：空队与空位省略，熟练度 0 不写 mas', () => {
  const out = encodeDeckBuilder({
    hqLv: 1,
    fleets: [
      { ships: [null, { mstId: 5, lv: 1, luck: -1, slots: [null, { mstId: 9, rf: 0 }], exSlot: null }] },
      null,
      null,
      null,
    ],
  })
  assert.equal('f2' in out, false)
  assert.equal('s1' in out.f1, false)
  assert.ok('s2' in out.f1)
  assert.equal('i1' in out.f1.s2.items, false)
  assert.equal('mas' in out.f1.s2.items.i2, false)
  assert.equal(out.f1.s2.items.i2.rf, 0)
})

test('导出的 JSON 自己读得回来（往返一致）', () => {
  const deck = {
    hqLv: 113,
    fleets: [
      {
        ships: [
          {
            mstId: 277,
            lv: 142,
            luck: 59,
            slots: [{ mstId: 157, rf: 10, mas: 7 }, null, null, null],
            exSlot: { mstId: 72, rf: 6 },
          },
          null,
          null,
          null,
          null,
          null,
        ],
      },
      null,
      null,
      null,
    ],
  }
  const round = parseDeckBuilder(deckBuilderJson(deck))
  assert.equal(round.error, null)
  assert.equal(round.deck.hqLv, 113)
  const ship = round.deck.fleets[0].ships[0]
  assert.equal(ship.mstId, 277)
  assert.deepEqual(ship.slots[0], { mstId: 157, rf: 10, mas: 7 })
  assert.deepEqual(ship.exSlot, { mstId: 72, rf: 6 })
})

test('载入链接把 JSON 编进 URL，且不含裸的大括号', () => {
  const url = deckBuilderUrl({
    hqLv: 1,
    fleets: [{ ships: [{ mstId: 1, lv: 1, luck: -1, slots: [], exSlot: null }] }, null, null, null],
  })
  assert.ok(url.startsWith('http://kancolle-calc.net/deckbuilder.html?predeck='))
  const encoded = url.split('predeck=')[1]
  assert.ok(!encoded.includes('{'), 'predeck 必须是 URL 编码过的')
  assert.equal(parseDeckBuilder(url).error, null)
})

test('改修与熟练度越界被夹回合法区间', () => {
  const { deck } = parseDeckBuilder(
    '{"version":4,"hqlv":1,"f1":{"s1":{"id":"1","lv":1,"items":{"i1":{"id":5,"rf":99,"mas":99}}}}}',
  )
  assert.deepEqual(deck.fleets[0].ships[0].slots[0], { mstId: 5, rf: 10, mas: 7 })
})

test('五格舰（大和改二）的第 5 格不许被截掉', () => {
  // 曾经 MAX_SLOTS 写死 4，导出时 slice(0, 4) 把第 5 格丢了——
  // 编成发出去少一件装备，对面算出来的制空/火力都是错的，而且不报错。
  // 下游三份独立实装（kc-web / gkcoi / jervis）都收 i5，见 deck-builder.ts 的注。
  const yamato = {
    mstId: 546, // 大和改二
    lv: 175,
    luck: 60,
    slots: [
      { mstId: 460, rf: 10 },
      { mstId: 460, rf: 10 },
      { mstId: 142, rf: 0 },
      { mstId: 122, rf: 0 },
      { mstId: 12, rf: 4 }, // ← 第 5 格
    ],
    exSlot: { mstId: 72, rf: 6 },
  }
  const out = encodeDeckBuilder({ hqLv: 120, fleets: [{ ships: [yamato] }, null, null, null] })
  const items = out.f1.s1.items
  assert.deepEqual(Object.keys(items).sort(), ['i1', 'i2', 'i3', 'i4', 'i5', 'ix'])
  assert.equal(items.i5.id, 12)
  assert.equal(items.i5.rf, 4)
  // 增设仍然走 ix，不因为多了一格就挪位
  assert.equal(items.ix.id, 72)

  // 读回来：第 5 格在 slots[4]，增设仍在 exSlot
  const round = parseDeckBuilder(deckBuilderJson({ hqLv: 120, fleets: [{ ships: [yamato] }, null, null, null] }))
  assert.equal(round.error, null)
  const ship = round.deck.fleets[0].ships[0]
  assert.deepEqual(ship.slots[4], { mstId: 12, rf: 4 })
  assert.deepEqual(ship.exSlot, { mstId: 72, rf: 6 })
  // 装备反查也要把第 5 格算进去
  assert.ok(deckItemIds(round.deck).includes(12))
})

test('四格舰不会凭空多出一个第 5 格', () => {
  // 放开到 5 之后仍要保证：没有第 5 格的舰导出时不写 i5（空格一律省略）
  const out = encodeDeckBuilder({
    hqLv: 1,
    fleets: [
      { ships: [{ mstId: 277, lv: 142, luck: 59, slots: [{ mstId: 157, rf: 0 }, null, null, null], exSlot: null }] },
      null,
      null,
      null,
    ],
  })
  assert.deepEqual(Object.keys(out.f1.s1.items), ['i1'])
  // 读入端固定给出 5 个位置（第 5 格为 null），渲染方按 slots.length 定「增」的位置
  const { deck } = parseDeckBuilder(OFFICIAL)
  assert.equal(deck.fleets[0].ships[0].slots.length, 5)
  assert.equal(deck.fleets[0].ships[0].slots[4], null)
})

test('反查编成里的舰娘与装备 id', () => {
  const { deck } = parseDeckBuilder(OFFICIAL)
  assert.deepEqual(deckShipIds(deck), [277])
  assert.deepEqual(deckItemIds(deck).sort((a, b) => a - b), [72, 157])
})
