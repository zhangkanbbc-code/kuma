import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import dockLayout from '../dist/shared/dock-layout.js'
import labels from '../dist/shared/remodel-label.js'
import chains from '../dist/shared/ship-remodel-chain.js'
import distractMode from '../dist/shared/distract-mode.js'
import popModule from '../dist/shared/pop-module.js'

const read = name => fs.readFileSync(new URL(`../src/renderer/${name}.ts`, import.meta.url), 'utf8')
const run = (source, context) => vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context)

test('批量改造原型保持单链、可逆对、分歧入口和孤立点的结果', () => {
  const after = new Map([[1, 2], [2, 3], [3, 4], [4, 3], [8, 2]])
  const result = labels.buildRemodelRootIndex(after, [1, 2, 3, 4, 8, 99])
  assert.deepEqual([...result], [[1, 1], [2, 1], [3, 1], [4, 1], [8, 8], [99, 99]])
  assert.deepEqual([...after], [[1, 2], [2, 3], [3, 4], [4, 3], [8, 2]])
})

test('改造链各组件独立处理，单链、可逆对、孤立点与原生边都保留', () => {
  const ships = [[1, 2], [2, 3], [3, 0], [10, 11], [11, 10], [20, 0], [30, 0], [31, 0]]
    .map(([id, afterId]) => ({ id, sortNo: id, afterId }))
  const result = chains.buildShipRemodelChains(ships, [{ targetId: 31, currentShipId: 30, originalShipId: 30, stage: 1 }])
  assert.deepEqual([...result.chainOf], [[1, [1, 2, 3]], [10, [10, 11]], [20, [20]], [30, [30, 31]]])
})

test('主数据数量不变也会刷新改造原型，升级表单独替换也刷新档位', () => {
  const mg = { master: {
    ships: { 1: { afterShipId: 2, afterLv: 20 }, 2: { afterShipId: 3, afterLv: 40 }, 3: { afterShipId: 0, afterLv: 0 } },
    upgrades: { 2: [{ stage: 1, originalShipId: 1 }] },
  } }
  const module = { exports: {} }
  run(read('remodel'), { module, exports: module.exports, require: id => {
    if (id === './kernel') return { mg, masterShipName: id => `ship${id}` }
    if (id === '../shared/remodel-label') return labels
    throw new Error(id)
  } })
  const api = module.exports
  assert.equal(api.remodelChainRoot(3), 1)
  mg.master.ships = { ...mg.master.ships, 1: { afterShipId: 0, afterLv: 0 } }
  assert.equal(api.remodelChainRoot(3), 2)
  mg.master.ships = { ...mg.master.ships, 1: { afterShipId: 2, afterLv: 20 } }
  assert.equal(api.progressiveRemodelOf({ shipId: 1 }).shipId, 2)
  mg.master.upgrades = { 2: [{ stage: 0, originalShipId: 1 }] }
  assert.equal(api.progressiveRemodelOf({ shipId: 1 }), null)
})

for (const name of ['lg', 'yu']) {
  test(`${name} 面板未打开时不生成界面，后台挂载与订阅入口不受此守卫影响`, () => {
    const source = read(`modules/${name}`)
    const start = source.indexOf('const render = () => {')
    const end = source.indexOf(name === 'lg' ? 'const renderIfActive' : 'registerModule({', start)
    assert.ok(start >= 0 && end > start)
    const pane = { classList: { contains: () => false }, set innerHTML(_value) { assert.fail('hidden pane rendered') } }
    const context = { pane, withViewStateKept: () => assert.fail('hidden pane captured scroll'), commitPaneHtml: () => assert.fail('hidden pane committed') }
    run(`${source.slice(start, end)}\nrender()`, context)
  })
}

const layoutFixture = (saved, failWrite = false) => {
  const source = read('mu')
  const start = source.indexOf("const LAYOUT_KEY =")
  const end = source.indexOf('const modules:', start)
  assert.ok(start >= 0 && end > start)
  const writes = []
  const context = {
    POP_MODULE: null, normalizePopped: popModule.normalizePopped,
    // 分心侧位读同一 config 叶子；这里只桩外壳，常规布局存档判据仍跑原函数。
    ...distractMode,
    remote: { require: () => ({ get: (_key, fallback) => fallback }) },
    DOCKS: ['left', 'right', 'bottom'],
    DEFAULT_SIZE: { left: 330, right: 420, bottom: 280 },
    DEFAULT_COLLAPSED: { left: false, right: false, bottom: false },
    uiGet: () => structuredClone(saved),
    uiSet: (key, value) => { if (failWrite) throw new Error('write failed'); writes.push([key, JSON.parse(JSON.stringify(value))]) },
    layoutForPersist: dockLayout.layoutForPersist, missionTabRestore: null,
  }
  run(`${source.slice(start, end)}\nglobalThis.api = { layout, saveLayout, saveInitialLayout }`, context)
  return { ...context.api, context, writes }
}

const savedLayout = () => ({
  docks: { left: [], right: [], bottom: [{ mods: ['qn', 'bi'], active: 'qn' }] },
  dockSize: { left: 330, right: 420, bottom: 280 },
  collapsed: { left: false, right: false, bottom: false }, focus: false, shelved: [], popped: [], poppedFrom: {},
})

test('初始化布局无变化不写盘，用户保存仍即时执行，缺字段时照常补齐', () => {
  const f = layoutFixture(savedLayout())
  f.saveInitialLayout()
  assert.equal(f.writes.length, 0)
  f.saveLayout()
  assert.equal(f.writes.length, 1)
  const missing = layoutFixture({})
  missing.saveInitialLayout()
  assert.equal(missing.writes.length, 1)
  assert.deepEqual(missing.writes[0][1].dockSize, { left: 330, right: 420, bottom: 280 })
})

test('初始化对账改变布局才保存，临时跟随页不产生新默认页', () => {
  const f = layoutFixture(savedLayout())
  f.layout.docks.bottom[0].active = 'bi'
  f.context.missionTabRestore = { dock: 'bottom', gi: 0, id: 'qn' }
  f.saveInitialLayout()
  assert.equal(f.writes.length, 0)
  f.context.missionTabRestore = null
  f.saveInitialLayout()
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0][1].docks.bottom[0].active, 'bi')
})
