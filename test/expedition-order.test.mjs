import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'
import orderModule from '../dist/shared/expedition-order.js'

const { compareGameOrder, restoreSortKey, EXPEDITION_SORT_DEFAULT } = orderModule
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

// 2026-09-25：游戏主数据 api_mst_mission 的列表顺序——按海域分页，页内按 api_id；
// A/B/D/E 系列 api_id 在 100 以上，跟在各自海域的两位数编号后面，不能单按 api_id 排。
const GAME = [
  [1, [...range(1, 8), ...range(100, 105)]],
  [2, [...range(9, 16), ...range(110, 115)]],
  [3, range(17, 24)],
  [4, [...range(25, 32), 131, 132, 133]],
  [5, [...range(33, 40), 141, 142]],
  [7, range(41, 46)],
]
const expected = GAME.flatMap(([mapArea, ids]) => ids.map((apiId) => ({ mapArea, apiId })))
const key = (list) => list.map((e) => `${e.mapArea}/${e.apiId}`)

test('游戏顺序：按海域分页、页内按 api_id，与游戏主数据列表一致', () => {
  const shuffled = [...expected].reverse()
  assert.deepEqual(key([...shuffled].sort(compareGameOrder)), key(expected))
  // 单按 api_id 会把 A1–A6 排到 46 后面：证明用例能区分两种排法
  assert.notDeepEqual(key([...expected].sort((a, b) => a.apiId - b.apiId)), key(expected))
})

test('排序选择记住上次：认得的键原样恢复，其余一律回到游戏顺序', () => {
  const keys = ['game', 'total', 'fuel', 'ammo', 'steel', 'baux', 'time', 'items', 'greatItems']
  assert.equal(EXPEDITION_SORT_DEFAULT, 'game')
  for (const k of keys) assert.equal(restoreSortKey(k, keys), k)
  for (const bad of [undefined, null, '', 'bogus', 3, {}, ['fuel']]) assert.equal(restoreSortKey(bad, keys), 'game')
})

test('远征页排序行：「游戏顺序」排第一，其余各格与顺序不变', () => {
  const bi = readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
  const a = bi.indexOf('const SORT_FILTERS'), b = bi.indexOf('const sortLabelOf', a)
  assert.ok(a >= 0 && b > a, '缺少 SORT_FILTERS 段')
  const context = vm.createContext({ state: {} })
  vm.runInContext(transformSync(`${bi.slice(a, b)}\nglobalThis.result = SORT_FILTERS`, { loader: 'ts', format: 'cjs' }).code, context)
  assert.deepEqual(JSON.parse(JSON.stringify(context.result)), [
    { key: 'game', label: '游戏顺序' },
    { key: 'total', label: '综合/时' },
    { key: 'fuel', label: '燃/时' },
    { key: 'ammo', label: '弹/时' },
    { key: 'steel', label: '钢/时' },
    { key: 'baux', label: '铝/时' },
    { key: 'time', label: '时间短' },
    { key: 'items', label: '默认道具' },
    { key: 'greatItems', label: '大成功道具' },
  ])
})
