import assert from 'node:assert/strict'
import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { collectConstruction } from '../scripts/build-construction-facts.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'

const pack = JSON.parse(fs.readFileSync(new URL('../assets/lodes/construction-facts.json', import.meta.url)))
const snapshot = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/kcwiki-construction-20260906.json.gz', import.meta.url))))
const ships = JSON.parse(fs.readFileSync(new URL('../assets/lodes/kcwiki-ships.json', import.meta.url))).data

test('建造真实页面：按名单时间与逐名配方收录，缺票不补，概率评价不进入结果', () => {
  const local = { times: [{ time: '01:00:00', ships: ['北上'], largeOnly: [] }, { time: '08:00:00', ships: [], largeOnly: ['大和'] }],
    recipes: [{ target: '軽巡洋艦', recipe: [30, 30, 30, 30], note: '不许复制' }] }
  const { data, omitted } = collectConstruction(snapshot.html, snapshot.wiki, ships, local)
  assert.deepEqual(data.ships[25], { time: '01:00:00', modes: ['normal'], recipes: [[30, 30, 30, 30]] })
  assert.deepEqual(data.ships[131], { time: '08:00:00', modes: ['large'], recipes: [] })
  assert.equal(Object.keys(data.ships).length, 2)
  assert.ok(omitted.length > 0)
  assert.doesNotMatch(JSON.stringify(data), /%|rate|note|不许复制/)
  assert.deepEqual(collectConstruction(snapshot.html, snapshot.wiki, ships, { times: [], recipes: [] }).data.ships, {})
  assert.throws(() => collectConstruction('', snapshot.wiki, ships, local), /结构变化/)
})

test('建造生产消费：根形态读随包表，大型不借普通配方；无资料保持空白', () => {
  const { api } = runtimeHost().extract('src/renderer/modules/ji.ts', ['buildRefHtml'], {
    buildRecipeLode: pack, rootOf: new Map([[275, 80]]), esc: String, lodeCreditMark: () => '源',
  })
  assert.match(api.buildRefHtml(275), /建造参考|05:00:00/)
  assert.match(api.buildRefHtml(131), /大型建造/)
  assert.doesNotMatch(api.buildRefHtml(131), /配方投入|社区|概率/)
  assert.equal(api.buildRefHtml(99999), '')
})
