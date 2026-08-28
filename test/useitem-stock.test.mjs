import assert from 'node:assert/strict'
import test from 'node:test'

import useitemStockModule from '../dist/shared/useitem-stock.js'

const { isResourceMirrorUseitem, matchMaterialRewardName, resolveUseitemStock } =
  useitemStockModule

const context = (overrides = {}) => ({
  materials: [45045, 47252, 122361, 21009, 662, 298, 212, 105],
  furnitureCoins: 13356,
  useitems: { 58: 7 },
  useitemsTs: 1_754_492_800_000,
  slotitems: {
    101: { mstId: 43 },
    102: { mstId: 43 },
    103: { mstId: 145 },
  },
  slotitemMasters: {
    43: { name: '応急修理女神' },
    145: { name: '戦闘糧食' },
  },
  slotitemsKnown: true,
  ...overrides,
})

test('useitem stock reuses all eight resource values instead of showing them unsynced', () => {
  assert.deepEqual(resolveUseitemStock(1, '高速修復材', context()), {
    count: 298,
    known: true,
    source: 'materials',
  })
  assert.deepEqual(resolveUseitemStock(31, '燃料', context()), {
    count: 45045,
    known: true,
    source: 'materials',
  })
  assert.deepEqual(resolveUseitemStock(34, 'ボーキサイト', context()), {
    count: 21009,
    known: true,
    source: 'materials',
  })
})

test('furniture coins and equipment-backed shop entries use their authoritative inventories', () => {
  assert.deepEqual(resolveUseitemStock(44, '家具コイン', context()), {
    count: 13356,
    known: true,
    source: 'furnitureCoins',
  })
  assert.deepEqual(resolveUseitemStock(51, '応急修理女神', context()), {
    count: 2,
    known: true,
    source: 'slotitems',
  })
  assert.deepEqual(resolveUseitemStock(66, '戦闘糧食', context()), {
    count: 1,
    known: true,
    source: 'slotitems',
  })
})

test('quest choice rewards treat doubled wiki resource names as one option', () => {
  // kcQuests 把四资源写成「燃料燃料×700」；再让 useitem 31 去认第二个「燃料」，
  // 三选一就会拆成燃料×1 + 燃料×700（持有 0）。By13 / By14 / B195 / B200 同写法。
  assert.deepEqual(matchMaterialRewardName('燃料燃料×700 高速修复材×4 改修资材×2', '燃料'), {
    index: 0,
    full: '燃料燃料×700',
    rawDigits: '700',
  })
  assert.deepEqual(matchMaterialRewardName('燃料×700', '燃料'), {
    index: 0,
    full: '燃料×700',
    rawDigits: '700',
  })
  const ammoText = '高速修复材×8 弹药弹药×8000 补强增设'
  assert.deepEqual(matchMaterialRewardName(ammoText, '弹药'), {
    index: ammoText.indexOf('弹药'),
    full: '弹药弹药×8000',
    rawDigits: '8000',
  })
  const mixed = '燃料燃料×800 「21inch舰首鱼雷发射管4门(后期型)」 弹药弹药×800'
  assert.deepEqual(matchMaterialRewardName(mixed, '燃料'), {
    index: 0,
    full: '燃料燃料×800',
    rawDigits: '800',
  })
  assert.deepEqual(matchMaterialRewardName(mixed, '弹药'), {
    index: mixed.indexOf('弹药'),
    full: '弹药弹药×800',
    rawDigits: '800',
  })
  assert.equal(matchMaterialRewardName('高速修复材×4 改修资材×2', '燃料'), null)
  assert.equal(isResourceMirrorUseitem(31), true)
  assert.equal(isResourceMirrorUseitem(34), true)
  assert.equal(isResourceMirrorUseitem(1), false)
  assert.equal(isResourceMirrorUseitem(4), false)
})

test('a complete positive-only api_useitem baseline makes missing entries known zero', () => {
  assert.deepEqual(resolveUseitemStock(58, '改装設計図', context()), {
    count: 7,
    known: true,
    source: 'useitems',
  })
  assert.deepEqual(resolveUseitemStock(65, '試製甲板カタパルト', context()), {
    count: 0,
    known: true,
    source: 'useitems',
  })
  assert.deepEqual(
    resolveUseitemStock(65, '試製甲板カタパルト', context({ useitems: {}, useitemsTs: null })),
    {
      count: 0,
      known: false,
      source: 'useitems',
    },
  )
})
