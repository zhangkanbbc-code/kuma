import assert from 'node:assert/strict'
import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { collectDevelopment } from '../scripts/build-development-facts.mjs'
import { runtimeHost } from '../scripts/lib/player-view-runtime.mjs'
const snapshot = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/kcwiki-development-20260906.json.gz', import.meta.url))))
const pack = JSON.parse(fs.readFileSync(new URL('../assets/lodes/development-facts.json', import.meta.url)))

test('开发七列表真实快照：只收同秘书舰同投料，概率与附加条件不混进结果', () => {
  const names = { 19: { ja: '九六式艦戦', zh: '九六式舰战' } }
  const equips = [{ api_id: 19, api_name: '九六式艦戦', api_broken: [0, 0, 0, 1] }]
  const local = { equipment: { '九六式艦戦': [{ secretary: '空母系', table: '铝', rate: 99 }] } }
  const result = collectDevelopment(snapshot.html, names, equips, local)
  assert.deepEqual(result.data.equipment, { 19: [{ secretary: '空母系', recipe: [10, 10, 10, 11] }] })
  assert.doesNotMatch(JSON.stringify(result.data), /rate|99|%|note/)
  assert.ok(result.omitted.some(r => r.reason.includes('额外说明')))
  local.equipment['九六式艦戦'][0].secretary = '水雷系'
  assert.deepEqual(collectDevelopment(snapshot.html, names, equips, local).data.equipment, {})
  assert.throws(() => collectDevelopment('', names, equips, local), /结构变化/)
})

test('开发生产消费：数字参考单列，无资料仍回个人实测', () => {
  const { api } = runtimeHost().extract('src/renderer/modules/ji.ts', ['devRecipeHtml'], {
    devRecipeLode: pack, factoryOwnHtml: (id, kind) => { assert.equal(id, 99999); assert.equal(kind, 'item'); return '个人实测' }, esc: String, lodeCreditMark: () => '源',
  })
  const id = +Object.keys(pack.data.equipment)[0]
  assert.match(api.devRecipeHtml('', id), /开发参考/)
  assert.doesNotMatch(api.devRecipeHtml('', id), /%|估算|出货率|所属表/)
  assert.equal(api.devRecipeHtml('', 99999), '个人实测')
})
