import assert from 'node:assert/strict'
import test from 'node:test'

import sallyLock from '../dist/shared/sally-lock.js'

const { sallyRestriction, sallyVerdict } = sallyLock

const isEventMap = (mapId) => Math.floor(mapId / 10) > 7
const gauge = (limitFlag, extra = {}) => ({ limitFlag, selectedRank: 2, cleared: false, ...extra })

// 用户实测的那一局：62 区四张图，丙/丁，limit_flag 全 0
const REAL = {
  621: gauge(0),
  622: gauge(0),
  623: gauge(0, { selectedRank: 1 }),
  624: gauge(0),
  // 常规海域也在 mapGauges 里，不该被算进活动图
  11: gauge(null, { selectedRank: null }),
}

test('不查札时，混札不是问题', () => {
  // 原本的误报：账本证明混着札 1/2/4/7/8 的队出击 62-4 十余次全部成功
  const v = sallyVerdict([8, 8, 8, 4, 1, 1], REAL, isEventMap, true)
  assert.equal(v.kind, 'free')
  assert.deepEqual(v.tags, [1, 4, 8])
  assert.equal(v.untagged, 0)
})

test('有图在查札时只报「哪几张在查」，不下「进不进得去」的判断', () => {
  // 札绑在阶段上，还分编成类型，有些图明确允许几种札混用（E-1/E-2/E-3）。
  // 游戏只给一个布尔，判据拿不到——所以这里没有 conflict 这一档。
  const v = sallyVerdict([8, 4], { ...REAL, 624: gauge(1) }, isEventMap, true)
  assert.equal(v.kind, 'checking')
  assert.deepEqual(v.enforcing, [624])
  assert.deepEqual(v.tags, [4, 8])
  // 全队同一个札也一样只报事实，不因为「不混」就说能进
  const same = sallyVerdict([8, 8], { ...REAL, 624: gauge(1) }, isEventMap, true)
  assert.equal(same.kind, 'checking')
  assert.deepEqual(same.tags, [8])
})

test('通关解锁与低难度不锁，走的是同一个字段，不必分别建模', () => {
  // 甲难度但已通关 → 游戏自己把 limit_flag 置 0
  const cleared = { 624: gauge(0, { selectedRank: 4, cleared: true }) }
  assert.equal(sallyVerdict([8, 4], cleared, isEventMap, true).kind, 'free')
  // 甲难度未通关 → 查
  const locked = { 624: gauge(1, { selectedRank: 4, cleared: false }) }
  assert.equal(sallyVerdict([8, 4], locked, isEventMap, true).kind, 'checking')
})

test('没读到 mapinfo 时说「不知道」，不当成不拦', () => {
  // null 与 undefined（旧存档没有这个字段）都算未知
  assert.equal(sallyVerdict([8, 4], { 624: gauge(null) }, isEventMap, true).kind, 'unknown')
  assert.equal(sallyVerdict([8, 4], { 624: gauge(undefined) }, isEventMap, true).kind, 'unknown')
  // 一张活动图都没有 → 同样是未知，不能当「都不查」
  assert.equal(sallyVerdict([8, 4], { 11: gauge(0) }, isEventMap, true).kind, 'unknown')
  // 只要有一张还没读到，就不算已知
  assert.equal(
    sallyVerdict([8, 4], { 621: gauge(0), 622: gauge(null) }, isEventMap, true).kind,
    'unknown',
  )
})

test('打札与查不查札无关：不查札时仍要报无札的舰', () => {
  // 同一份账本里，丙难度、limit_flag=0，一艘无札的舰照样被打上了札 8
  const mixed = sallyVerdict([8, 4, 0, 0], REAL, isEventMap, true)
  assert.equal(mixed.kind, 'willTag')
  assert.equal(mixed.untagged, 2)
  assert.equal(mixed.all, false)
  assert.deepEqual(mixed.tags, [4, 8])

  const none = sallyVerdict([0, 0, 0], REAL, isEventMap, true)
  assert.equal(none.kind, 'willTag')
  assert.equal(none.all, true)

  // 有图在查札时，无札的艘数也要带出去（挂牌要同时说两件事）
  const checking = sallyVerdict([8, 0], { ...REAL, 624: gauge(1) }, isEventMap, true)
  assert.equal(checking.kind, 'checking')
  assert.equal(checking.untagged, 1)
})

test('全员有札、无空缺、且都不查 → 只说「不查札」', () => {
  const v = sallyVerdict([8, 8, 8], REAL, isEventMap, true)
  assert.equal(v.kind, 'free')
  assert.deepEqual(v.tags, [8])
})

test('没有活动在开时一律不判——平时这些都是噪声', () => {
  assert.equal(sallyVerdict([8, 4, 0], REAL, isEventMap, false).kind, 'none')
  assert.equal(sallyVerdict([], REAL, isEventMap, true).kind, 'none')
})

test('常规海域不参与判定', () => {
  const { enforcing, known } = sallyRestriction({ 11: gauge(1), 621: gauge(0) }, isEventMap)
  assert.deepEqual(enforcing, [], '1-1 就算 flag=1 也不该算进来')
  assert.equal(known, true)
})

test('判定里没有「进不去」这种结论', () => {
  // 这一条是纪律：拿不到判据就不判。改回去会让它红。
  const kinds = new Set()
  for (const tags of [[8, 4], [8], [0], [8, 0], []]) {
    for (const gauges of [REAL, { ...REAL, 624: gauge(1) }, { 624: gauge(null) }]) {
      kinds.add(sallyVerdict(tags, gauges, isEventMap, true).kind)
    }
  }
  assert.ok(!kinds.has('conflict'), '不该再有 conflict 这一档')
  assert.deepEqual([...kinds].sort(), ['checking', 'free', 'none', 'unknown', 'willTag'])
})

test('只有仍在进行的活动区算数——已结束的不能串进这一次', () => {
  const { activeEventAreaIds } = sallyLock
  const area = (closed) => ({ firstSeenTs: 1, lastSeenTs: 2, closed })

  assert.deepEqual([...activeEventAreaIds({ 62: area(false) })], [62])
  assert.deepEqual([...activeEventAreaIds({ 62: area(true) })], [])
  // 上一次活动已结束、这一次在进行：只留在进行的那个
  assert.deepEqual([...activeEventAreaIds({ 61: area(true), 62: area(false) })], [62])
  // 没有这份数据时给空集，而不是「全都算活动区」
  assert.deepEqual([...activeEventAreaIds(undefined)], [])
  assert.deepEqual([...activeEventAreaIds(null)], [])
  assert.deepEqual([...activeEventAreaIds({})], [])

  // 真正要防的：旧活动某张图查札，不该在新活动期间被算进 enforcing。
  // mapGauges 会把历次活动的图一直留着，只按区号判就会串味。
  const active = activeEventAreaIds({ 61: area(true), 62: area(false) })
  const inActive = (mapId) => active.has(Math.floor(mapId / 10))
  const gauges = { 614: gauge(1), 624: gauge(0) } // 61 是上次活动、62 是这次
  const r = sallyRestriction(gauges, inActive)
  assert.deepEqual(r.enforcing, [], '上一次活动的 614 不该报成「在查札」')
  assert.equal(r.known, true)

  // 反过来：把已结束的也算进来，就会错报——这一行证明上面那条不是空过
  const naive = (mapId) => mapId >= 100
  assert.deepEqual(sallyRestriction(gauges, naive).enforcing, [614])
})
