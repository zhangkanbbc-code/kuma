// 支援远征的判定（2026-09-29 玩家截图报出）：远征 15「囮機動部隊支援作戦」名字里带「支援」，
// 被当成出击支援远征——列表写「无资源 · 出击支援」、适配标记写「支援」，其实它有资源奖励。
// 判据改用主数据 api_mst_mission.api_return_flag（apilist：遠征中止可否）：支援远征派出后不能召回，
// 维护者主数据实测只有 33、34 为 0，其余 61 条为 1。活动海域（海域号 > 10）的支援远征照旧按海域号认。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'
import factModule from '../dist/shared/expedition-facts.js'

const bi = readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../src/main/mg/store.ts', import.meta.url), 'utf8')
const section = (start, end) => {
  const a = bi.indexOf(start), b = bi.indexOf(end, a)
  assert.ok(a >= 0 && b > a, `缺少可执行的 bi 段：${start}`)
  return bi.slice(a, b)
}
const line = (start) => {
  const a = bi.indexOf(start)
  assert.ok(a >= 0, `缺少 ${start}`)
  return bi.slice(a, bi.indexOf('\n', a))
}

const harness = (missions) => {
  const context = vm.createContext({
    mg: { master: { missions } },
    expedLocalizationLode: { data: {
      15: { nameZh: '诱饵机动部队支援作战' }, 33: { nameZh: '前卫支援任务' }, 34: { nameZh: '舰队决战支援任务' }, 1: { nameZh: '练习航海' },
    } },
    expedLode: { data: {} },
    mergeExpeditionFacts: factModule.mergeExpeditionFacts,
  })
  const code = [section('const normalizedDispNo', 'const hourly'), line('const isSupport ='), 'globalThis.result = { allExpeds, isSupport }'].join('\n')
  vm.runInContext(transformSync(code, { loader: 'ts', format: 'cjs' }).code, context)
  return context.result
}
const mission = (dispNo, name, mapArea, returnFlag) => ({ dispNo, name, mapArea, returnFlag, time: 60, deckNum: 2, details: '', winItem1: [0, 0], winItem2: [0, 0] })

test('名字带「支援」但能召回的远征（15）不算支援；不能召回的（33/34）才算', () => {
  const { allExpeds, isSupport } = harness({
    1: mission('01', '練習航海', 1, 1),
    15: mission('15', '囮機動部隊支援作戦', 2, 1),
    33: mission('33', '前衛支援任務', 5, 0),
    34: mission('34', '艦隊決戦支援任務', 5, 0),
  })
  const byNo = new Map(allExpeds().map((e) => [e.dispNo, e]))
  assert.equal(byNo.get('15').returnFlag, 1)
  assert.equal(isSupport(byNo.get('15')), false)
  assert.equal(isSupport(byNo.get('1')), false)
  assert.equal(isSupport(byNo.get('33')), true)
  assert.equal(isSupport(byNo.get('34')), true)
})

test('活动海域（海域号 > 10）的远征照旧算支援', () => {
  const { allExpeds, isSupport } = harness({ 301: mission('S1', '前衛支援任務(イベント)', 61, 0), 302: mission('S2', '某活动远征', 62, 1) })
  for (const e of allExpeds()) assert.equal(isSupport(e), true, e.dispNo)
})

test('主进程读主数据时保留 api_return_flag', () => {
  const block = store.slice(store.indexOf('for (const m of body.api_mst_mission ?? [])'), store.indexOf('const upgrades:'))
  assert.match(block, /returnFlag:\s*m\.api_return_flag/)
})
