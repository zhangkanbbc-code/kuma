import assert from 'node:assert/strict'
import test from 'node:test'

import shipStatLayers from '../dist/shared/ship-stat-layers.js'

const { instanceStatRows } = shipStatLayers

// 只写用到的字段——实现读不到的字段补零无意义
const mstOf = (over = {}) => ({
  baseHoug: 30, maxHoug: 79,
  baseRaig: 20, maxRaig: 60,
  baseTyku: 10, maxTyku: 50,
  baseSouk: 25, maxSouk: 70,
  baseTaik: 32, maxTaik: 49,
  baseLuck: 10, maxLuck: 79,
  ...over,
})

const shipOf = (over = {}) => ({
  lv: 50,
  maxhp: 32,
  karyoku: 35, raisou: 21, taiku: 12, soukou: 28,
  kaihi: 60, taisen: 40, sakuteki: 30,
  kaihiMax: 89, taisenMax: 70, sakutekiMax: 44,
  lucky: 40,
  kyouka: [5, 1, 2, 3, 0, 0, 0],
  slot: [-1, -1, -1, -1], slotEx: 0,
  ...over,
})

const rowOf = (rows, label) => rows.find((r) => r.label === label)

test('近代化四项：裸值=初始+改修（一手精确），装备差含套装，余量到主数据上限', () => {
  // 火力：裸 30+5=35，面板 48，装备原始 10 → 装备给予 +13（含套装 +3），改修余量 79−35=44
  const rows = instanceStatRows(
    shipOf({ karyoku: 48 }),
    mstOf(),
    [{ houg: 10, raig: 0, tyku: 0, souk: 0, houk: 0, tais: 0, saku: 0 }],
    { kaihi: null, taisen: null, sakuteki: null },
  )
  const fire = rowOf(rows, '火力')
  assert.equal(fire.bare, 35)
  assert.deepEqual(fire.segments, [
    { value: 48, kind: 'equip' },
    { value: 92, kind: 'mod' }, // 48 + 余量44：右端=改修拉满后的面板
  ])
  assert.match(fire.tip, /装备原始值 10/)
  assert.match(fire.tip, /套装\/改修★ \+3/)
  // 装甲走 kyouka[3]：裸 25+3=28，面板 28 → 无装备段，只剩改修余量段
  const armor = rowOf(rows, '装甲')
  assert.equal(armor.bare, 28)
  assert.deepEqual(armor.segments, [
    { value: null, kind: 'equip' },
    { value: 70, kind: 'mod' },
  ])
})

test('运：装备不改运，只有改修余量段', () => {
  const luck = rowOf(
    instanceStatRows(shipOf(), mstOf(), [], { kaihi: null, taisen: null, sakuteki: null }),
    '运',
  )
  assert.equal(luck.bare, 40)
  assert.deepEqual(luck.segments, [{ value: 79, kind: 'mod' }])
})

test('耐久：未婚画结婚档位段（32 → +5 档 → 37），再画改修段到 api_taik[1]', () => {
  const hp = rowOf(
    instanceStatRows(shipOf(), mstOf(), [], { kaihi: null, taisen: null, sakuteki: null }),
    '耐久',
  )
  assert.equal(hp.bare, 32)
  assert.deepEqual(hp.segments, [
    { value: 37, kind: 'marriage' },
    { value: 49, kind: 'mod' },
  ])
})

test('耐久：婚舰不再画结婚段（当前值已含加成）', () => {
  const hp = rowOf(
    instanceStatRows(shipOf({ lv: 120, maxhp: 41 }), mstOf(), [], {
      kaihi: null, taisen: null, sakuteki: null,
    }),
    '耐久',
  )
  assert.deepEqual(hp.segments, [
    { value: null, kind: 'marriage' },
    { value: 49, kind: 'mod' },
  ])
})

test('三维带装备：成长公式拆裸值（信赖@120 实测样本），婚后余量用 over99 色', () => {
  // 回避 init 47 / 一手上限 89 / Lv120 → 裸值公式 97（账本实测吻合）；
  // 面板 100（装备原始 houk 2 + 套装 1）→ 装备给予 +3；
  // 到 Lv188 成长 126 → 余量 29，段右端 = 100+29
  const rows = instanceStatRows(
    shipOf({ lv: 120, kaihi: 100, kaihiMax: 89 }),
    mstOf(),
    [{ houg: 0, raig: 0, tyku: 0, souk: 0, houk: 2, tais: 0, saku: 0 }],
    { kaihi: 47, taisen: null, sakuteki: null },
  )
  const evade = rowOf(rows, '回避')
  assert.equal(evade.bare, 97)
  assert.deepEqual(evade.segments, [
    { value: 100, kind: 'equip' },
    { value: 129, kind: 'over99' },
  ])
  assert.match(evade.tip, /装备原始值 2/)
})

test('三维全空槽：面板即一手裸值，不走公式；Lv≤99 余量=一手上限−面板', () => {
  const rows = instanceStatRows(shipOf(), mstOf(), [], {
    kaihi: null, taisen: null, sakuteki: null, // 初始值缺资料也能算：未婚终点就是一手上限
  })
  const evade = rowOf(rows, '回避')
  assert.equal(evade.bare, 60)
  assert.deepEqual(evade.segments, [{ value: 89, kind: 'grow' }])
})

test('三维带装备但初始值缺资料：裸值照实标缺，面板画 equip 兜底段', () => {
  const rows = instanceStatRows(
    shipOf(),
    mstOf(),
    [{ houg: 0, raig: 0, tyku: 0, souk: 0, houk: 0, tais: 0, saku: 3 }],
    { kaihi: null, taisen: null, sakuteki: null },
  )
  const los = rowOf(rows, '索敌')
  assert.equal(los.bare, null)
  assert.deepEqual(los.segments, [{ value: 30, kind: 'equip' }])
  assert.match(los.tip, /无法拆分裸值/)
})

test('对潜：改修点（kyouka[6]）计入裸值', () => {
  // init 10 / 上限 70 / Lv50 → 成长 10+floor(60×50÷99)=40，+改修 4 → 裸 44；
  // 面板 47（装备 tais 3）→ 装备给予 +3；到 99 成长 70+4=74 → 余量 30
  const rows = instanceStatRows(
    shipOf({ taisen: 47, kyouka: [0, 0, 0, 0, 0, 0, 4] }),
    mstOf(),
    [{ houg: 0, raig: 0, tyku: 0, souk: 0, houk: 0, tais: 3, saku: 0 }],
    { kaihi: null, taisen: 10, sakuteki: null },
  )
  const asw = rowOf(rows, '对潜')
  assert.equal(asw.bare, 44)
  assert.deepEqual(asw.segments, [
    { value: 47, kind: 'equip' },
    { value: 77, kind: 'grow' },
  ])
})

test('九行齐全且顺序与图鉴一致', () => {
  const rows = instanceStatRows(shipOf(), mstOf(), [], {
    kaihi: null, taisen: null, sakuteki: null,
  })
  assert.deepEqual(
    rows.map((r) => r.label),
    ['耐久', '火力', '装甲', '雷装', '对空', '回避', '对潜', '索敌', '运'],
  )
})
