import assert from 'node:assert/strict'
import test from 'node:test'
import { crossWindowRuntime } from './fixtures/cross-window-runtime.mjs'

// 验收 2：不是测纯合并函数——两份真 kernel 读启动快照，再经真 config 写入、派发 IPC。
const recordKeys = ['qn.lineup', 'du.air-targets.v1', 'du.gimmick-progress.v1', 'ji.routeTarget', 'zi.targets', 'equipStock.view', 'levelExp', 'ships.firstOwned']
for (const key of recordKeys) test(`${key}：另一窗修改后，旧快照写入只提交本窗变化`, () => {
  const runtime = crossWindowRuntime(), main = runtime.renderer().kernel, pop = runtime.renderer().kernel
  const left = main.uiGet(key, {}), right = pop.uiGet(key, {})
  right.pop = key === 'qn.lineup' ? { '6-4': { note: '弹窗阵容', ships: [1, 2, 3] } } : 'pop'
  pop.uiSet(key, right)
  assert.equal(runtime.queued(), 2)
  left.main = 'main'
  main.uiSet(key, left) // 故意还没送达 IPC；不能靠缓存同步的时序侥幸过关。
  assert.deepEqual(runtime.config.get('ui.' + key), { pop: right.pop, main: 'main' })
  delete right.pop
  pop.uiSet(key, right)
  assert.deepEqual(runtime.config.get('ui.' + key), { main: 'main' })
})

for (const key of ['ru.airBase.muted', 'ru.metricsHidden.fleet', 'ru.metricsHidden.airbase', 'ru.sandbox', 'ji.collapsedShipClasses', 'zi.trendDisabled']) {
  test(`${key}：跨窗集合增删不互盖`, () => {
    const runtime = crossWindowRuntime(), main = runtime.renderer().kernel, pop = runtime.renderer().kernel
    const left = main.uiGet(key, []), right = pop.uiGet(key, [])
    pop.uiSet(key, [...right, 6])
    main.uiSet(key, [...left, 7])
    assert.deepEqual(runtime.config.get('ui.' + key), [6, 7])
    pop.uiSet(key, right)
    assert.deepEqual(runtime.config.get('ui.' + key), [7])
  })
}

test('阵容备注更新保留另一窗的海域记录，有序舰队快照整段替换', () => {
  const runtime = crossWindowRuntime()
  runtime.config.setUiJson('qn.lineup', JSON.stringify({ 1: { '6-4': { ships: [1, 2], note: '旧备注' } } }))
  const main = runtime.renderer().kernel, pop = runtime.renderer().kernel
  const left = main.uiGet('qn.lineup', {}), right = pop.uiGet('qn.lineup', {})
  right[1]['6-5'] = { ships: [3, 4], note: '新海域' }
  pop.uiSet('qn.lineup', right)
  left[1]['6-4'].note = '主窗备注'
  left[1]['6-4'].ships = [2, 1]
  main.uiSet('qn.lineup', left)
  assert.deepEqual(runtime.config.get('ui.qn.lineup'), { 1: {
    '6-4': { ships: [2, 1], note: '主窗备注' }, '6-5': { ships: [3, 4], note: '新海域' },
  } })
})

test('远征规划的延迟提交合并不同字段和同一集合，连续本窗提交不抹掉对窗改动', () => {
  const runtime = crossWindowRuntime(), main = runtime.renderer().kernel, pop = runtime.renderer().kernel
  const key = 'bi.planner-prefs.v1', empty = { protectedDeckIds: [1], excludedRosterIds: [] }
  const left = main.uiGet(key, structuredClone(empty)), right = pop.uiGet(key, structuredClone(empty))
  right.protectedDeckIds.push(2)
  pop.uiSet(key, right)
  left.excludedRosterIds.push(8)
  main.uiSet(key, left) // 模拟 150ms 去抖到期，此时对窗 IPC 还没送达。
  left.excludedRosterIds.push(9)
  main.uiSet(key, left)
  right.protectedDeckIds.push(3)
  pop.uiSet(key, right)
  assert.deepEqual(runtime.config.get('ui.' + key), { protectedDeckIds: [1, 2, 3], excludedRosterIds: [8, 9] })
})

test('删除本窗已知的最后一条阵容，保留对窗给同任务新增的海域记录', () => {
  const runtime = crossWindowRuntime()
  runtime.config.setUiJson('qn.lineup', JSON.stringify({ 1: { '6-4': { ships: [1], note: '' } } }))
  const main = runtime.renderer().kernel, pop = runtime.renderer().kernel
  main.uiGet('qn.lineup', {})
  const right = pop.uiGet('qn.lineup', {})
  right[1]['6-5'] = { ships: [2], note: '' }
  pop.uiSet('qn.lineup', right)
  main.uiSet('qn.lineup', {})
  assert.deepEqual(runtime.config.get('ui.qn.lineup'), { 1: { '6-5': { ships: [2], note: '' } } })
})

test('真实收藏与备注服务收到跨窗事件后失效，收回后读取新值且后续修改保留其他条目', () => {
  const runtime = crossWindowRuntime(), main = runtime.renderer(), pop = runtime.renderer()
  const left = main.load('improve-favorites'), right = pop.load('improve-favorites')
  assert.deepEqual(left.improveFavoriteIds(), [])
  assert.deepEqual(right.improveFavoriteIds(), [])
  right.toggleImproveFavorite(1)
  left.toggleImproveFavorite(2)
  runtime.flush()
  assert.deepEqual(left.improveFavoriteIds(), [1, 2])
  assert.deepEqual(right.improveFavoriteIds(), [1, 2])
  left.toggleImproveFavorite(1)
  runtime.flush()
  assert.deepEqual(right.improveFavoriteIds(), [2])
  const mainShips = main.load('ship-personal'), popShips = pop.load('ship-personal')
  const mainEquip = main.load('equip-personal'), popEquip = pop.load('equip-personal')
  mainShips.shipPersonal()
  popShips.shipPersonal()
  mainEquip.isFavoriteEquipInstance(4)
  popEquip.isFavoriteEquipInstance(4)
  const rev = mainShips.shipPersonalRevision()
  popShips.setShipRootNote(1, '弹窗备注')
  mainShips.setShipRosterNote(2, '主窗备注')
  popEquip.toggleFavoriteEquipInstance(4)
  mainEquip.toggleFavoriteEquipInstance(5)
  runtime.flush()
  assert.ok(mainShips.shipPersonalRevision() > rev)
  assert.equal(mainShips.shipRootNote(1), '弹窗备注')
  assert.equal(popShips.shipRosterNote(2), '主窗备注')
  assert.equal(mainEquip.isFavoriteEquipInstance(4), true)
  assert.equal(popEquip.isFavoriteEquipInstance(5), true)
})

test('广播只带偏好键；排队旧通知回读当前值，非共享布局仍按原协议写入', () => {
  const runtime = crossWindowRuntime(), main = runtime.renderer().kernel, pop = runtime.renderer().kernel
  let current = pop.uiGet('zi.targets', {}), calls = 0
  pop.onUiPreferenceChange('zi.targets', () => { calls++; current = pop.uiGet('zi.targets', {}) })
  main.uiGet('zi.targets', {})
  main.uiSet('zi.targets', { 1: 10 })
  main.uiSet('zi.targets', { 1: 20 })
  runtime.flush()
  assert.equal(calls, 2)
  assert.deepEqual(current, { 1: 20 })
  main.uiSet('layout.v3', { popped: ['qn'] })
  assert.deepEqual(runtime.config.get('ui.layout.v3'), { popped: ['qn'] })
  assert.equal(runtime.queued(), 0)
})

test('偏好订阅随真实装配作用域退订，重复装配后一次事件只送一次', () => {
  const runtime = crossWindowRuntime(), renderer = runtime.renderer().kernel
  renderer.uiGet('zi.targets', {})
  let calls = 0
  for (let i = 0; i < 3; i++) {
    renderer.runMountCleanup('zi')
    renderer.beginMountScope('zi')
    renderer.onUiPreferenceChange('zi.targets', () => calls++)
    renderer.endMountScope()
  }
  renderer.uiSet('zi.targets', { 1: 20 })
  runtime.flush()
  assert.equal(calls, 1)
})

for (const key of ['ji.routeTarget', 'du.air-targets.v1']) test(`${key} 合并保留目标点最近触碰的插入序`, () => {
  const runtime = crossWindowRuntime()
  runtime.config.setUiJson(key, JSON.stringify({ a: 'A', b: 'B', c: 'C' }))
  const main = runtime.renderer().kernel, pop = runtime.renderer().kernel
  const left = main.uiGet(key, {}), right = pop.uiGet(key, {})
  right.d = 'D'
  pop.uiSet(key, right)
  delete left.b
  left.b = 'B'
  main.uiSet(key, left)
  assert.deepEqual(Object.keys(runtime.config.get('ui.' + key)), ['a', 'c', 'd', 'b'])
})
