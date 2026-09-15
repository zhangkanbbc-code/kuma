import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { ziLayoutClass } from '../src/shared/zi-layout.ts'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

for (const [width, expected] of [[699, 'narrow'], [700, ''], [1199, ''], [1200, 'wide']]) {
  test(`资源面板 ${width}px 判定为 ${expected || '常规态'}`, () => {
    assert.equal(ziLayoutClass(width), expected)
  })
}

const css = fs.readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')

test('资源宽态八格排一行', () => {
  assert.match(css, /\.mod-zi\.wide \.tiles\s*\{\s*grid-template-columns:\s*repeat\(8, 1fr\);\s*\}/)
})

test('资源宽态卡片用最小 320px 的网格自动折行', () => {
  const side = css.match(/\.mod-zi\.wide \.side\s*\{([^}]+)\}/)?.[1]
  assert.ok(side)
  assert.match(side, /display:\s*grid;/)
  assert.match(side, /grid-template-columns:\s*repeat\(auto-fit, minmax\(320px, 1fr\)\);/)
  assert.match(side, /align-content:\s*start;/)
  assert.match(side, /gap:\s*0;/)
})

// 依据 shared/source-pattern-guards-miss-logic-bugs：执行生产声明与渲染，验证名单实际生效。
const ziSource = 'src/renderer/modules/zi.ts'
const reserveState = {
  uiGet: (_key, fallback) => fallback,
  mg: { materials: [100000, 100000, 100000, 50000, 500, 3000, 0, 300] },
  rollingDayRate: () => null,
  fmtMonthDay: String,
  entityTermHtml: (_kind, _id, name) => name,
}

test('储备目标含建造材且默认 600，战略道具按主数据名纳入 useitem 2', () => {
  const { TARGET_ORDER, getTargets, strategicIds } = runtimeHost().extract(ziSource,
    ['TARGET_ORDER', 'getTargets', 'strategicIds'], {
      ...reserveState,
      useitemMst: [{ id: 2, name: '高速建造材' }],
      demandedUseitemIds: () => [],
      useitemStock: () => { throw new Error('固定名单不应依赖自动扩充') },
    }).api
  assert.deepEqual(TARGET_ORDER, [0, 1, 2, 3, 4, 5, 7])
  assert.deepEqual(getTargets(), { 0: 100000, 1: 100000, 2: 100000, 3: 50000, 4: 600, 5: 3000, 7: 300 })
  assert.deepEqual(strategicIds(), [2])
})

test('高速建造材未达标时，就绪度按七项中的六项达标聚合', () => {
  const { readinessHtml } = runtimeHost().extract(ziSource, ['readinessHtml'], reserveState).api
  const html = readinessHtml()
  assert.match(html, /高速建造材/)
  assert.match(html, /86%/)
})

const materialRow = (ts, count) => ({ ts, values: [0, 0, 0, 0, count, 0, 0, 0] })
const { fastbuildFlow } = runtimeHost().extract(ziSource, ['fastbuildFlow']).api

test('建造材近月收支分开累计，窗口前余额只作基线，最后变动不含零差额', () => {
  assert.deepEqual(fastbuildFlow([
    materialRow(9, 600), materialRow(10, 50), materialRow(11, 55),
    materialRow(12, 55), materialRow(21, 100),
  ], 10, 20), { gained: 5, spent: 550, changes: 2, lastTs: 11 })
})

test('建造材无基线不把首次余额当收入，无变化不产生收支占位', () => {
  assert.deepEqual(fastbuildFlow([materialRow(11, 50), materialRow(12, 55)], 10, 20),
    { gained: 5, spent: 0, changes: 1, lastTs: 12 })
  for (const rows of [[], [materialRow(11, 50)], [materialRow(9, 50), materialRow(12, 50)]]) {
    assert.deepEqual(fastbuildFlow(rows, 10, 20), { gained: 0, spent: 0, changes: 0, lastTs: 0 })
  }
})

test('战略建造材行取 materials 库存，显示 550 队列缺口或达标及同栏收支', () => {
  for (const count of [500, 600]) {
    const flow = count === 500 ? new Map([[2, { gained: 5, spent: 550, changes: 2, lastTs: 11 }]]) : new Map()
    const { strategicHtml } = runtimeHost().extract(ziSource, ['strategicHtml'], {
      mg: { materials: [0, 0, 0, 0, count, 0, 0, 0], useitems: { 2: 999 },
        useitemsTs: 1, slotitems: {}, master: { slotitems: {} } },
      useitemMst: [{ id: 2, name: '高速建造材' }],
      demandedUseitemIds: () => [],
      useitemDemand: id => { assert.equal(id, 2); return { queueNeed: 550, queueShips: 1 } },
      itemFlow: flow,
      useItemIconHtml: () => '',
      entityNamePlain: (_kind, _id, name) => name,
      entityNameHtml: (_kind, _id, name) => name,
      fmtTime: ts => `T${ts}`,
      daysAgo: () => '今天',
      entityTermTrustedHtml: () => '',
      bilingualNameHtml: () => '',
    }).api
    const html = strategicHtml()
    assert.match(html, /data-useitem="2"/)
    assert.match(html, new RegExp(`<b class="si-n${count === 500 ? ' short' : ''}">${count}</b>`))
    if (count === 500) {
      assert.match(html, /队列需 550 · 缺 50/)
      assert.match(html, /title="最近一次变动 T11"><i class="up">\+5<\/i> <i class="dn">−550<\/i>/)
    } else {
      assert.match(html, /队列需 550 ✓/)
      assert.doesNotMatch(html, /class="si-f"/)
    }
  }
})
