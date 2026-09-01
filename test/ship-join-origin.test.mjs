// 「加入镇守府」的出处归因。玩家反馈：战斗界面掉 new 船时写了时间和地点，
// 履历里却只有一行「Lv 1」——地点是有一手记录的，只是当初没人去问。
//
// 这里钉住的是**认领纪律**：一条掉落只能供一艘认亲，同图鉴号连掉两艘时按获得
// 顺序配对（在籍 id 递增），建造凭在籍 id 精确匹配，认不到就返回 null
// （确认不了就不标，绝不拿窗口外的掉落硬凑）。
import assert from 'node:assert/strict'
import test from 'node:test'

import joinOrigin from '../dist/shared/ship-join-origin.js'

const { matchShipJoinOrigins, SHIP_JOIN_ORIGIN_WINDOW_MS } = joinOrigin

const T = 1788000000000
const min = (n) => n * 60_000
const hour = (n) => n * 3600_000

test('掉落：同图鉴号一条掉落配一条 join，地点原样带过来', () => {
  const [origin] = matchShipJoinOrigins(
    [{ ts: T + min(2), rosterId: 900, mstId: 634 }],
    { drops: [{ ts: T, mstId: 634, map: 621, cell: 46, isBoss: true }] },
  )
  assert.deepEqual(origin, {
    origin: 'drop',
    sourceIndex: 0,
    sourceTs: T,
    map: 621,
    cell: 46,
    isBoss: true,
  })
})

test('建造：在籍 id 对上就写建造，不去看掉落', () => {
  const [origin] = matchShipJoinOrigins(
    [{ ts: T + 20, rosterId: 10244, mstId: 14 }],
    {
      // 同一刻还挂着一条同图鉴号的掉落——建造有在籍 id，它优先，且不该把掉落认领掉
      drops: [{ ts: T, mstId: 14, map: 22, cell: 2, isBoss: false }],
      builds: [{ ts: T + 10, rosterId: 10244, mstId: 14 }],
    },
  )
  assert.deepEqual(origin, { origin: 'build', sourceIndex: 0, sourceTs: T + 10 })
})

test('一条掉落只能被认领一次：第二艘同名舰认不到就留空', () => {
  const origins = matchShipJoinOrigins(
    [
      { ts: T + min(2), rosterId: 900, mstId: 634 },
      { ts: T + min(3), rosterId: 901, mstId: 634 },
    ],
    { drops: [{ ts: T, mstId: 634, map: 621, cell: 46, isBoss: true }] },
  )
  assert.equal(origins[0]?.origin, 'drop')
  assert.equal(origins[1], null, '第二艘没有第二条掉落可认，只能留空')
})

test('同一次出击连掉两艘同名舰、回港同刻落账：按在籍 id 递增顺序配对，不张冠李戴', () => {
  const drops = [
    { ts: T + min(1), mstId: 634, map: 621, cell: 46, isBoss: true },
    { ts: T + min(9), mstId: 634, map: 61, cell: 8, isBoss: false },
  ]
  // 两条 join 同一时刻（回港那一刻一起检出），入参顺序故意反着给
  const origins = matchShipJoinOrigins(
    [
      { ts: T + min(10), rosterId: 901, mstId: 634 },
      { ts: T + min(10), rosterId: 900, mstId: 634 },
    ],
    { drops },
  )
  assert.equal(origins[1]?.map, 621, '先获得的（在籍 id 小）配先掉的那条')
  assert.equal(origins[0]?.map, 61, '后获得的配后掉的那条')
})

test('跨窗口的掉落不认亲：上个月同名舰那条不许跨过来', () => {
  const origins = matchShipJoinOrigins(
    [{ ts: T + SHIP_JOIN_ORIGIN_WINDOW_MS + 1, rosterId: 900, mstId: 634 }],
    { drops: [{ ts: T, mstId: 634, map: 621, cell: 46, isBoss: true }] },
  )
  assert.equal(origins[0], null)
})

test('晚于 join 的掉落不算来源：入籍之后才捞到的不是她', () => {
  const origins = matchShipJoinOrigins(
    [{ ts: T, rosterId: 900, mstId: 634 }],
    { drops: [{ ts: T + min(1), mstId: 634, map: 621, cell: 46, isBoss: true }] },
  )
  assert.equal(origins[0], null)
})

test('图鉴号对不上就不认：不同舰的掉落不许借去当地点', () => {
  const origins = matchShipJoinOrigins(
    [{ ts: T + min(1), rosterId: 900, mstId: 634 }],
    { drops: [{ ts: T, mstId: 72, map: 621, cell: 46, isBoss: true }] },
  )
  assert.equal(origins[0], null)
})

test('建造与掉落混在一批里各认各的，互不抢占', () => {
  const origins = matchShipJoinOrigins(
    [
      { ts: T + min(5), rosterId: 10244, mstId: 14 }, // 建造
      { ts: T + min(5), rosterId: 10245, mstId: 634 }, // 掉落
      { ts: T + min(5), rosterId: 10246, mstId: 99 }, // 认不到
    ],
    {
      drops: [{ ts: T + min(1), mstId: 634, map: 621, cell: 46, isBoss: true }],
      builds: [{ ts: T + min(4), rosterId: 10244, mstId: 14 }],
    },
  )
  assert.equal(origins[0]?.origin, 'build')
  assert.equal(origins[1]?.origin, 'drop')
  assert.equal(origins[2], null)
})

test('在籍 id 相同但图鉴号不同的建造记录不认：那是回收过的号，不是这一艘', () => {
  const origins = matchShipJoinOrigins(
    [{ ts: T + min(1), rosterId: 10244, mstId: 634 }],
    { builds: [{ ts: T, rosterId: 10244, mstId: 14 }] },
  )
  assert.equal(origins[0], null)
})

test('建造记录读不出图鉴号（mstId 0）时只按在籍 id 认，不因此漏判', () => {
  const origins = matchShipJoinOrigins(
    [{ ts: T + min(1), rosterId: 10244, mstId: 634 }],
    { builds: [{ ts: T, rosterId: 10244, mstId: 0 }] },
  )
  assert.equal(origins[0]?.origin, 'build')
})

test('一条建造只能被认领一次：在籍 id 万一撞车，第二条留空', () => {
  const origins = matchShipJoinOrigins(
    [
      { ts: T + min(1), rosterId: 10244, mstId: 14 },
      { ts: T + min(2), rosterId: 10244, mstId: 14 },
    ],
    { builds: [{ ts: T, rosterId: 10244, mstId: 14 }] },
  )
  assert.equal(origins[0]?.origin, 'build')
  assert.equal(origins[1], null)
})

test('结果与入参一一对齐，且没有出处的位置是 null 而不是被挤掉', () => {
  const joins = [
    { ts: T + min(1), rosterId: 900, mstId: 111 },
    { ts: T + min(2), rosterId: 901, mstId: 634 },
    { ts: T + min(3), rosterId: 902, mstId: 222 },
  ]
  const origins = matchShipJoinOrigins(joins, {
    drops: [{ ts: T, mstId: 634, map: 15, cell: 5, isBoss: false }],
  })
  assert.equal(origins.length, joins.length)
  assert.deepEqual(
    origins.map((one) => one?.origin ?? null),
    [null, 'drop', null],
  )
})

test('空入参不炸，也不凭空造出出处', () => {
  assert.deepEqual(matchShipJoinOrigins([], {}), [])
  assert.deepEqual(matchShipJoinOrigins([{ ts: T, rosterId: 1, mstId: 2 }], {}), [null])
})

test('窗口可调：把它收紧到一分钟，超出的那条就认不到了', () => {
  const joins = [{ ts: T + min(5), rosterId: 900, mstId: 634 }]
  const drops = [{ ts: T, mstId: 634, map: 621, cell: 46, isBoss: true }]
  assert.equal(matchShipJoinOrigins(joins, { drops })[0]?.origin, 'drop')
  assert.equal(matchShipJoinOrigins(joins, { drops }, { windowMs: min(1) })[0], null)
})

test('认领窗口是 12 小时：打完一场搁半天再回港仍认得出', () => {
  assert.equal(SHIP_JOIN_ORIGIN_WINDOW_MS, hour(12))
  const origins = matchShipJoinOrigins(
    [{ ts: T + hour(11), rosterId: 900, mstId: 634 }],
    { drops: [{ ts: T, mstId: 634, map: 621, cell: 46, isBoss: true }] },
  )
  assert.equal(origins[0]?.origin, 'drop')
})
