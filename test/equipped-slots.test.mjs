// 「装备实例现在有没有人占着」的判据钉子。
//
// 这条判据原来在三处各写一份，现已收成 shared/equipped-slots 一份：
// 仓库卷（equip-stock 的 buildHolders）与改修素材口径（ji 的 equippedInstIds）都从它派生。
// 两个消费端住在 renderer 里、import 不进来，所以这里钉的是**派生式本身**
// （`map.get(id) ?? idle` 与 `new Set(map.keys())`）——判据一旦改坏，这几条会红。

import test from 'node:test'
import assert from 'node:assert/strict'

import equippedMod from '../dist/shared/equipped-slots.js'

const { equippedSlotIds, equipHolderMap } = equippedMod

// 一份够用的母港：两艘舰（含补强增设、含空槽），一支基地航空队（含空格）
const ships = [
  { id: 101, shipId: 543, slot: [11, 12, -1, 0], slotEx: 13 },
  { id: 102, shipId: 561, slot: [14, 0], slotEx: 0 },
]
const airBases = [{ areaId: 6, rid: 2, planes: [{ slotId: 21 }, { slotId: 0 }, { slotId: 22 }] }]

test('holder 表说得出「被谁占着」：舰上常规槽 / 补强增设 / 陆航机位各一种形状', () => {
  const holders = equipHolderMap(ships, airBases)

  assert.deepEqual(holders.get(12), {
    kind: 'ship',
    rosterId: 101,
    shipId: 543,
    slot: 2, // 槽位对玩家是从 1 数的，不是数组下标
    ex: false,
  })
  assert.deepEqual(holders.get(13), {
    kind: 'ship',
    rosterId: 101,
    shipId: 543,
    slot: 0, // 补强增设不占常规格号
    ex: true,
  })
  assert.deepEqual(holders.get(22), { kind: 'airBase', areaId: 6, rid: 2, slot: 3 })

  // 只收被占的：空槽（0 / -1）与不存在的实例都不该进表
  assert.deepEqual(
    [...holders.keys()].sort((a, b) => a - b),
    [11, 12, 13, 14, 21, 22],
  )
  assert.equal(holders.get(0), undefined)
  assert.equal(holders.get(99), undefined)
})

test('仓库卷的派生：查不到就是闲置，查得到就原样报「在哪」', () => {
  const holders = equipHolderMap(ships, airBases)
  // equip-stock 的 buildRows 就是这个式子——兜底那一档留在消费端
  const holderOf = (id) => holders.get(id) ?? { kind: 'idle' }

  assert.equal(holderOf(99).kind, 'idle', '没人占的实例才是闲置')
  assert.equal(holderOf(11).kind, 'ship')
  // 漏掉陆航那一半是最危险的错法：出击中的攻击机会被报成「闲置」，玩家照着废弃就拆错东西
  assert.equal(holderOf(21).kind, 'airBase')
})

test('改修素材口径的派生：holder 表的键集就是「已占用」集，与 equippedSlotIds 逐个一致', () => {
  const holders = equipHolderMap(ships, airBases)
  // ji 的 equippedInstIds 就是这个式子（外面再包一层缓存）
  const equipped = new Set(holders.keys())

  assert.deepEqual([...equipped], [...equippedSlotIds(ships, airBases)], '连插入顺序都该一样')
  assert.ok(equipped.has(21) && equipped.has(22), '基地里飞着的机体不能算进改修素材')
  assert.ok(equipped.has(13), '补强增设里的也占着')
  assert.ok(!equipped.has(99), '没被占的才吞得进改修工厂')
})
