import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import pop from '../dist/shared/pop-module.js'

// 执行完整 link 模块，只替换 Electron、宿主身份和显示工具；不建浏览器窗口。
const compiled = transformSync(
  fs.readFileSync(new URL('../src/renderer/link.ts', import.meta.url), 'utf8') + '\nexport { runTarget };',
  { loader: 'ts', format: 'cjs', target: 'node20' },
).code
const setup = async ({ self = null, popped = ['ji'], delivered = true } = {}) => {
  const calls = [], listeners = new Map()
  const stubs = {
    electron: { ipcRenderer: {
      on: (channel, fn) => { assert.equal(listeners.has(channel), false); listeners.set(channel, fn) },
      invoke: async (channel, message) => {
        calls.push([channel, message])
        return channel === pop.POP_LIST_CHANNEL ? popped : delivered
      },
    } },
    './kernel': { esc: String },
    './localization': {},
    './mu': { getPopModule: () => self },
    '../shared/pop-module': pop,
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((id) => {
    assert.ok(id in stubs, id)
    return stubs[id]
  }, module, module.exports)
  await Promise.resolve()
  const relays = () => calls.filter(([channel]) => channel === pop.POP_RELAY_CHANNEL)
  return { ...module.exports, calls, relays, update: (raw) => listeners.get(pop.POP_LIST_CHANNEL)({}, raw) }
}

test('互链启动取名单一次，推送更新宿主；header 始终在主窗', async () => {
  const link = await setup()
  assert.equal(link.calls.length, 1)
  assert.equal(link.hostFor('ji'), 'ji')
  link.update(['qn', 'qn', 'header', 'unknown'])
  assert.deepEqual(link.getPoppedNow(), ['qn'])
  assert.equal(link.hostFor('ji'), 'main')
  assert.equal(link.hostFor('qn'), 'qn')
  assert.equal(link.hostFor('header'), 'main')
})

test('主窗导航图鉴转发 type/id/ctx；远端不可达才本地兜底', async () => {
  for (const delivered of [true, false]) {
    const link = await setup({ delivered }), local = []
    link.registerEntityRoute('ship', { mod: 'ji', open: (ref) => local.push(ref) })
    await link.navigate({ type: 'ship', id: '7', ctx: 'detail', extra: '不转发' })
    assert.deepEqual(link.relays(), [[pop.POP_RELAY_CHANNEL, {
      to: 'ji', kind: 'navigate', payload: { type: 'ship', id: '7', ctx: 'detail' },
    }]])
    assert.equal(local.length, delivered ? 0 : 1)
    if (!delivered) assert.equal(local[0].num, 7)
  }
})

test('宿主导航本地执行；未知路由送主窗且 false 时空转', async () => {
  const link = await setup({ self: 'ji', delivered: false }), local = []
  link.registerEntityRoute('ship', { mod: 'ji', open: (ref) => local.push(ref.num) })
  await link.navigate({ type: 'ship', id: 7 })
  assert.deepEqual(local, [7])
  assert.deepEqual(link.relays(), [])
  await link.navigate({ type: 'missing', id: 'current' })
  assert.equal(link.relays()[0][1].to, 'main')
})

test('目标继承路由宿主，显式任务宿主回主窗，false 才执行一次', async () => {
  for (const delivered of [true, false]) {
    const link = await setup({ self: 'ji', delivered }), local = []
    const route = { mod: 'ji', open() {} }, ref = { type: 'ship', id: 7 }
    await link.runTarget(ref, route, { label: '同模块', run: () => local.push('ji') })
    assert.deepEqual(link.relays(), [])
    await link.runTarget(ref, route, { label: '有关任务', mod: 'qn', run: () => local.push('qn') })
    assert.deepEqual(link.relays(), [[pop.POP_RELAY_CHANNEL, {
      to: 'main', kind: 'target', payload: { ref: { type: 'ship', id: 7, ctx: undefined }, label: '有关任务' },
    }]])
    assert.deepEqual(local, delivered ? ['ji'] : ['ji', 'qn'])
  }
})

test('接收端按本地 ref 重算 num 与目标，标签相同取首项，名单不一致也不转发', async () => {
  const link = await setup(), local = []
  link.registerEntityRoute('ship', {
    mod: 'ji', open: (ref) => local.push(['open', ref.num, ref.ctx]),
    targets: (ref) => [
      { label: '任务', mod: 'qn', run: () => local.push(['target', ref.num]) },
      { label: '任务', run: () => local.push(['duplicate']) },
    ],
  })
  link.receiveEntityRelay('navigate', { type: 'ship', id: '7', ctx: 'detail', num: 999 })
  link.receiveEntityRelay('target', { ref: { type: 'ship', id: '8' }, label: '任务' })
  assert.deepEqual(local, [['open', 7, 'detail'], ['target', 8]])
  assert.deepEqual(link.relays(), [])
})

test('接收端逐字段拒绝畸形 ref、ctx、label；未知路由或标签空转', async () => {
  const link = await setup(), local = []
  link.registerEntityRoute('ship', {
    mod: 'ji', open: () => local.push('open'),
    targets: () => [{ label: '任务', run: () => local.push('target') }],
  })
  for (const ref of [null, 7, {}, { type: 7, id: 1 }, { type: 'ship', id: {} }, { type: 'ship', id: 1, ctx: [] }]) {
    link.receiveEntityRelay('navigate', ref)
    link.receiveEntityRelay('target', { ref, label: '任务' })
  }
  for (const payload of [null, {}, { ref: { type: 'ship', id: 1 }, label: 7 }, { ref: { type: 'ship', id: 1 }, label: 'missing' }]) {
    link.receiveEntityRelay('target', payload)
  }
  link.receiveEntityRelay('navigate', { type: 'missing', id: 1 })
  assert.deepEqual(local, [])
  assert.deepEqual(link.relays(), [])
})
