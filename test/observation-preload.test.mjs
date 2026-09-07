import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import levelLogic from '../dist/shared/level-exp.js'
import remodel from '../dist/shared/ship-remodel-chain.js'

const load = (name, kernel) => {
  const code = transformSync(fs.readFileSync(new URL(`../src/renderer/${name}.ts`, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require: id => {
      if (id === './kernel') return kernel
      if (id === '../shared/level-exp') return levelLogic
      if (id === '../shared/ship-remodel-chain') return remodel
      throw new Error(`unexpected require ${id}`)
    },
  })
  return module.exports
}

const fixture = (initial = { levelExp: { 2: 100 }, 'ships.firstOwned': { 1: 10 } }) => {
  const values = structuredClone(initial)
  const reads = [], writes = []
  const kernel = {
    mg: { ships: {}, master: { ships: {}, upgrades: {} } },
    uiGet: (key, fallback) => { reads.push(key); return values[key] ?? fallback },
    uiSet: (key, value) => { values[key] = JSON.parse(JSON.stringify(value)); writes.push([key, values[key]]) },
    queryLode: async () => null,
  }
  return { kernel, reads, writes, values, exp: load('level-exp', kernel), owned: load('ship-first-owned', kernel) }
}

test('预读只装入保存值且幂等，不在主数据到齐之前观察或写入', () => {
  const f = fixture()
  f.exp.prepareLevelExp()
  f.owned.prepareFirstOwned()
  f.exp.prepareLevelExp()
  f.owned.prepareFirstOwned()
  assert.deepEqual(f.reads, ['levelExp', 'ships.firstOwned'])
  assert.deepEqual(f.writes, [])
  assert.equal(f.exp.cumulativeExpAt(2), 100)
  assert.equal(f.owned.firstOwnedAt(1), 10)
  assert.equal(f.owned.firstOwnedAt(2), null)
})

test('预读与按需读取得到相同新舰判断、经验点及持久化内容', () => {
  const run = preload => {
    const f = fixture()
    if (preload) { f.exp.prepareLevelExp(); f.owned.prepareFirstOwned() }
    f.kernel.mg.ships = {
      101: { shipId: 1, lv: 1, expTotal: 20, expNext: 80 },
      102: { shipId: 2, lv: 2, expTotal: 120, expNext: 180 },
    }
    f.kernel.mg.master.ships = {
      1: { sortId: 1, afterShipId: 0 },
      2: { sortId: 2, afterShipId: 3 },
      3: { sortId: 3, afterShipId: 0 },
    }
    const fresh = [...f.owned.observeOwnedShips(500)]
    f.exp.observeLevelExp()
    return { fresh, writes: f.writes, secondForm: f.owned.firstOwnedAt(3), exp3: f.exp.cumulativeExpAt(3) }
  }
  assert.deepEqual(run(true), run(false))
  assert.deepEqual(run(true).fresh, [2])
  assert.equal(run(true).secondForm, 500)
  assert.equal(run(true).exp3, 300)
})

test('空基线与旧版集合的预读保持原来的首次运行、迁移口径', () => {
  const empty = fixture({})
  empty.owned.prepareFirstOwned()
  empty.kernel.mg.ships = { 1: { shipId: 7 } }
  assert.deepEqual([...empty.owned.observeOwnedShips(999)], [])
  assert.equal(empty.owned.firstOwnedAt(7), 0)
  const legacy = fixture({ 'lg.owned': [7, 8] })
  legacy.owned.prepareFirstOwned()
  assert.equal(legacy.owned.firstOwnedAt(7), 0)
  assert.equal(legacy.owned.firstOwnedAt(8), 0)
  assert.deepEqual(legacy.writes, [])
})

test('预读失败不锁死加载状态，原来的按需入口可以重试', () => {
  for (const [name, prime, read] of [
    ['level-exp', 'prepareLevelExp', api => api.cumulativeExpAt(2)],
    ['ship-first-owned', 'prepareFirstOwned', api => api.firstOwnedAt(2)],
  ]) {
    let calls = 0
    const api = load(name, {
      mg: { ships: {}, master: { ships: {}, upgrades: {} } },
      uiGet: () => { if (++calls === 1) throw new Error('temporary failure'); return { 2: 100 } },
      uiSet: () => assert.fail('must not write'),
    })
    assert.throws(() => api[prime](), /temporary failure/)
    assert.equal(read(api), 100)
    assert.equal(calls, 2)
  }
})
