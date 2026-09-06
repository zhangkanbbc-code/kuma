import assert from 'node:assert/strict'
import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { collectItems, REVIEWED_PURPOSES } from '../scripts/build-item-facts.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
const input = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/kcwiki-items-20260906.json.gz', import.meta.url))))
const raw = Object.values(input.query.pages)[0].revisions[0]['*']
const pack = JSON.parse(fs.readFileSync(new URL('../assets/lodes/item-facts.json', import.meta.url)))

test('道具模板：按游戏日文名解号，绝不把图标157当成道具编号', () => {
  const data = collectItems(raw, [{ api_id: 100, api_name: '海外艦最新技術' }], { 100: { name: '海外艦最新技術' } }).data
  assert.deepEqual(data, { 100: { overview: REVIEWED_PURPOSES['海外艦最新技術'] } })
  assert.equal(data[157], undefined)
  assert.deepEqual(collectItems(raw, [], {}).data, {})
})

test('固定兑换四项逐个核对；数量冲突不收，不补历年兑换', () => {
  const master = [{ api_id: 56, api_name: '艦娘からのチョコ' }]
  const local = { 56: { name: master[0].api_name, overview: '燃料×700,弾薬×700,鋼材×700,ボーキサイト×1500' } }
  assert.equal(collectItems(raw, master, local).data[56].fixed.length, 1)
  local[56].overview = local[56].overview.replace('1500', '1400')
  const result = collectItems(raw, master, local)
  assert.equal(result.data[56].fixed, undefined)
  assert.ok(result.omitted.some(r => r.reason.includes('冲突')))
  assert.ok(Object.values(pack.data).every(r => !r.yearly && !r.history && !r.usage))
})

test('道具生产消费：自写用途、巧克力固定兑换与勋章既有手录同时可用', () => {
  const { api } = runtimeHost().extract('src/renderer/modules/ji.ts', ['itemFunctionHtml', 'itemExchangeHtml'], {
    itemExchangeLode: pack, useitemMst: new Map(), entityNamePlain: (_k,_id,n) => n,
    lodeCreditMark: () => '源', lodeCredit: () => '源', esc: String,
    exchangeGetsHtml: String, exchangeOfferZh: String, exchangeGetsZh: String,
  })
  assert.match(api.itemFunctionHtml(100), /海外舰改装/)
  assert.match(api.itemExchangeHtml(56), /700[\s\S]*1500/)
  assert.match(api.itemExchangeHtml(57), /改装設計図x1/)
  assert.doesNotMatch(api.itemExchangeHtml(56), /历年兑换|历史兑换|当届/)
  assert.equal(api.itemFunctionHtml(99999), '')
})
