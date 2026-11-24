import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

const host = runtimeHost()
const { SEASONAL_ITEMS } = host.load('src/shared/seasonal-campaign.ts')
// 维护者裁决 2026-11-25：按日文名解主数据 id，夹具另配 id 以检出硬编码。
const seasonal = SEASONAL_ITEMS.map(({ jpName }, i) => ({ api_id: 200 + i, api_name: jpName, api_usetype: 4 }))
const seasonalIds = seasonal.map(u => u.api_id)
const ordinary = [
  { api_id: 57, api_name: '勲章', api_usetype: 4 },
  { api_id: 96, api_name: '秋刀魚の缶詰', api_usetype: 4 },
]
const strategic = { api_id: 58, api_name: '改装設計図', api_usetype: 4 }
const stockId = seasonalIds.at(-1)

function catalog(cat, needs = [strategic.api_id]) {
  const items = [...seasonal, ...ordinary, strategic]
  const { api } = host.extract('src/renderer/modules/ji.ts', ['itemCatalogHtml'], {
    useitemMst: new Map(items.map(u => [u.api_id, u])),
    remodelNeeds: new Map(needs.map(id => [id, [{}]])),
    itemState: { cat, search: '', selected: 0, open: false },
    useitemStock: id => ({ known: true, count: id === stockId ? 3 : 0 }),
    useItemIconHtml: () => '', entityNamePlain: (_kind, _id, name) => name,
    entityNameHtml: (_kind, _id, name) => name, esc: String,
  })
  return api.itemCatalogHtml()
}

const rowIds = html => [...html.matchAll(/data-item="(\d+)"/g)].map(match => Number(match[1]))

test('道具分类条按顺序显示标签及计数', () => {
  const chips = [...catalog('all').matchAll(/data-icat="[^"]+">([^<]+)(?:<i>(\d+)<\/i>)?<\/span>/g)]
  assert.deepEqual(chips.map(([, label, count]) => [label, count && Number(count)]), [
    ['全部', seasonal.length + 3], ['持有中', undefined], ['战略资材', 1], ['消耗资材', 0],
    ['资源', 0], ['节气道具', seasonal.length], ['其他', 2],
  ])
})

test('其他仅含普通道具，同 usetype 的节气道具移出', () => {
  assert.deepEqual(rowIds(catalog('other')), ordinary.map(u => u.api_id))
})

test('节气道具列全清单，持有项在前，零库存灰显', () => {
  const html = catalog('seasonal')
  assert.deepEqual(rowIds(html), [stockId, ...seasonalIds.slice(0, -1)])
  assert.deepEqual(rowIds(html.match(/class="row ghost" data-item="\d+"/g).join(' ')), seasonalIds.slice(0, -1))
  assert.deepEqual(rowIds(catalog('owned')), [stockId])
})

test('改造需求中的节气道具只归战略资材', () => {
  const needs = [strategic.api_id, stockId]
  assert.deepEqual(rowIds(catalog('strategic', needs)), [stockId, strategic.api_id])
  assert.deepEqual(rowIds(catalog('seasonal', needs)), seasonalIds.slice(0, -1))
})
