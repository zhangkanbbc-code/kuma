import assert from 'node:assert/strict'
import test from 'node:test'

import factoryLookupModule from '../dist/shared/factory-lookup.js'
import { runProductionSection } from '../scripts/lib/player-view-runtime.mjs'

test('战斗装备空态按敌我区分舰娘与舰', () => {
  const { render } = runProductionSection(
    'src/renderer/modules/di.ts',
    'const battleEquipmentHtml =',
    'const dealtHtml =',
    { fleetAirStages: () => [] },
    'globalThis.render = battleEquipmentHtml',
  )
  const ship = { equipment: [] }
  assert.equal(render({}, 0, ship), '<div class="bship-empty">该舰娘暂无装备</div>')
  assert.equal(render({}, 1, ship), '<div class="bship-empty">该舰暂无装备</div>')
})

test('工厂无命中空态按建造与开发区分舰娘与装备', () => {
  const row = attempts => ({ attempts, outcomes: [{ mstId: 1, count: 1 }] })
  const { render } = runProductionSection(
    'src/renderer/modules/ji.ts',
    'const factoryOwnHtml =',
    'const devRecipeHtml =',
    {
      ensureFactoryStats: () => {},
      factoryStatsFailed: false,
      factoryStats: { ship: [row(3)], item: [row(7)] },
      factoryLookup: factoryLookupModule.factoryLookup,
    },
    'globalThis.render = factoryOwnHtml',
  )
  assert.match(render(999, 'ship'), /近 90 日本地建造 3 次 · 暂无该舰娘记录<\/div>/)
  assert.match(render(999, 'item'), /近 90 日本地开发 7 次 · 暂无该装备记录<\/div>/)
})
