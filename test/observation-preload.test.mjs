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
    onUiPreferenceChange: () => {},
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
      onUiPreferenceChange: () => {},
      mg: { ships: {}, master: { ships: {}, upgrades: {} } },
      uiGet: () => { if (++calls === 1) throw new Error('temporary failure'); return { 2: 100 } },
      uiSet: () => assert.fail('must not write'),
    })
    assert.throws(() => api[prime](), /temporary failure/)
    assert.equal(read(api), 100)
    assert.equal(calls, 2)
  }
})

// 维护者实测 2026-11-24：在籍 85 号川内改二（158）改成新增的偵形态（751）。
const T0 = 100
const T1 = 200
const sendaiHistory = { 54: T0, 222: T0, 158: T0 }
const sendaiFixture = (known = sendaiHistory) => {
  const f = fixture({ 'ships.firstOwned': known })
  f.kernel.mg.master.ships = {
    54: { afterShipId: 222 },
    222: { afterShipId: 158 },
    158: { afterShipId: 751 },
    751: { afterShipId: 0 },
    445: { afterShipId: 450 },
    450: { afterShipId: 0 },
  }
  f.kernel.mg.master.upgrades = {
    751: [{ currentShipId: 158, targetShipId: 751, originalShipId: 54, stage: 3 }],
  }
  f.kernel.mg.ships = { 85: { shipId: 158 } }
  return f
}

test('已有川内谱系改出新增的偵形态，沿用首次持有时刻', () => {
  const f = sendaiFixture()
  assert.deepEqual([...f.owned.observeOwnedShips(T0)], [])
  f.kernel.mg.ships[85].shipId = 751
  assert.deepEqual([...f.owned.observeOwnedShips(T1)], [])
  assert.equal(f.owned.firstOwnedAt(751), T0)
  assert.deepEqual(f.writes, [])
})

test('已误记的偵形态按川内整条谱系取最早时刻', () => {
  const f = sendaiFixture({ ...sendaiHistory, 751: T1 })
  assert.equal(f.owned.firstOwnedAt(751), T0)
})

test('首次入手秋津洲只返回在籍形态，并记录整条谱系', () => {
  const f = sendaiFixture()
  f.kernel.mg.ships[86] = { shipId: 445 }
  assert.deepEqual([...f.owned.observeOwnedShips(T1)], [445])
  assert.deepEqual(f.values['ships.firstOwned'], { ...sendaiHistory, 445: T1, 450: T1 })
})

test('首次建基线将川内整条谱系记为记账前持有', () => {
  const f = sendaiFixture({})
  assert.deepEqual([...f.owned.observeOwnedShips(T1)], [])
  const before = f.owned.OWNED_BEFORE_LEDGER
  assert.deepEqual(f.values['ships.firstOwned'], { 54: before, 222: before, 158: before, 751: before })
})

// 2026-11-26 他选秃鹫当任务奖励，新舰入库要等回港才响：报文一到就按谱系记账并当场报，回港不再报第二次
test('任务奖励 / 掉落报文先到：当场返回新谱系并记整条谱系，回港时在籍列表到了不再报', () => {
  const T2 = 300
  const f = sendaiFixture()
  assert.deepEqual([...f.owned.noteAcquiredShips([445], T1)], [445], '秋津洲第一次到手')
  assert.deepEqual(f.values['ships.firstOwned'], { ...sendaiHistory, 445: T1, 450: T1 })
  assert.deepEqual([...f.owned.noteAcquiredShips([450, 54], T2)], [], '同谱系与已有谱系都不再报')
  f.kernel.mg.ships[86] = { shipId: 445 }
  assert.deepEqual([...f.owned.observeOwnedShips(T2)], [], '回港时不报第二次')
  assert.equal(f.owned.firstOwnedAt(445), T1, '首次时刻是报文到手那一刻')
})

test('基线还没建时报文到手不记不报（那时不知道以前有没有过）', () => {
  const f = sendaiFixture({})
  assert.deepEqual([...f.owned.noteAcquiredShips([445], T1)], [])
  assert.deepEqual(f.writes, [])
})
