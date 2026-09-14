import assert from 'node:assert/strict'
import test from 'node:test'
import moduleCommand from '../dist/shared/module-command.js'

const { createModuleCommandBus } = moduleCommand
const setup = (host, delivered = true) => {
  const local = [], relays = []
  const bus = createModuleCommandBus({
    self: 'main', hostOf: () => host,
    relay: async (...args) => { relays.push(args); return delivered },
  })
  bus.register('qn', 'search', (term) => local.push(term))
  return { bus, local, relays }
}

test('命令宿主是自己：本地执行，relay 不调用', async () => {
  const { bus, local, relays } = setup('main')
  await bus.run('qn', 'search', '海域')
  assert.deepEqual(local, ['海域'])
  assert.deepEqual(relays, [])
})

test('命令宿主是别窗：保留模块、名称、参数，本地不执行', async () => {
  const { bus, local, relays } = setup('qn')
  await bus.run('qn', 'search', '海域')
  assert.deepEqual(relays, [['qn', 'qn', 'search', '海域']])
  assert.deepEqual(local, [])
})

test('命令 relay 返回 false：本地兜底恰好一次', async () => {
  const { bus, local, relays } = setup('qn', false)
  await bus.run('qn', 'search', '海域')
  assert.equal(relays.length, 1)
  assert.deepEqual(local, ['海域'])
})

test('未登记的模块或命令空转，不调用 relay', async () => {
  const { bus, local, relays } = setup('qn')
  await bus.run('qn', 'missing', null)
  await bus.run('missing', 'search', null)
  assert.deepEqual(local, [])
  assert.deepEqual(relays, [])
})

test('runLocal 未登记返回 false；已登记直接执行，不再查询宿主或 relay', () => {
  const { bus, local, relays } = setup('qn')
  assert.equal(bus.runLocal('qn', 'missing', null), false)
  assert.equal(bus.runLocal('missing', 'search', null), false)
  assert.equal(bus.runLocal('qn', 'search', '海域'), true)
  assert.deepEqual(local, ['海域'])
  assert.deepEqual(relays, [])
})
