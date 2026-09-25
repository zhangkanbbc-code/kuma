// 战斗抬头的「基地航空」汇总（2026-09-25 维护者裁决）：有陆航参战的战斗，抬头加一枚汇总——
// 几队几波、我机损、敌机损，只算这一场；悬停逐波列明细。流水里的逐波行不动；
// 原有的「我方机损 / 敌机损」照旧只算舰队自己的航空战（air + air2）。
//
// 真报文取自 test/fixtures/battle-field-coverage.json。机损的对账数直接从原始报文的
// api_stage1/api_stage2 lostcount 加出来，不借 kuma 自己的解析结果。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import battleModule from '../dist/main/mg/battle.js'
import { airOf, battleOf, renderAirline, stageOf } from './fixtures/render-di-battle.mjs'

const { parseBattle } = battleModule
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/battle-field-coverage.json', import.meta.url), 'utf8'))
const ctx = () => ({
  fleetShips: (deckId) => Array.from({ length: 6 }, (_, i) => ({
    rosterId: deckId * 100 + i, mstId: deckId * 100 + i, name: `D${deckId}-${i + 1}`, lv: 1, nowHp: 50, maxHp: 50, equipments: [],
  })),
  masterName: (mstId) => `E${mstId}`,
  combinedType: () => 1,
})
const waves = (v) => (Array.isArray(v) ? v : v ? [v] : [])
/** 原始报文里陆航（含基地喷气强袭）的波数、队数与机损 */
const rawLbas = (battle) => {
  const list = [...waves(battle.api_air_base_injection), ...waves(battle.api_air_base_attack)]
  const n = (v) => (typeof v === 'number' ? v : 0)
  return {
    waves: list.length,
    bases: new Set(waves(battle.api_air_base_attack).map((w) => w.api_base_id).filter((id) => id > 0)).size,
    fLost: list.reduce((s, w) => s + n(w.api_stage1?.api_f_lostcount) + n(w.api_stage2?.api_f_lostcount), 0),
    eLost: list.reduce((s, w) => s + n(w.api_stage1?.api_e_lostcount) + n(w.api_stage2?.api_e_lostcount), 0),
  }
}
const chipOf = (html) => /<span class="kv lbas-sum"[^>]*>[\s\S]*?<\/span>/.exec(html)?.[0] ?? ''

for (const name of ['sortie-battle-rescue', 'each-battle-support']) {
  test(`真报文 ${name}：抬头「基地航空」汇总的队数、波数与机损对得上原始报文`, () => {
    const one = fixtures.find((f) => f.name === name)
    const view = parseBattle(one.path, structuredClone(one.battle), ctx(), 0)
    const raw = rawLbas(one.battle)
    assert.ok(raw.waves > 0)
    const chip = chipOf(renderAirline(view))
    assert.ok(chip, '有陆航的战斗抬头缺了汇总')
    const count = raw.bases > 0 ? `${raw.bases}队${raw.waves}波` : `${raw.waves}波`
    assert.match(chip, new RegExp(`基地航空 <b>${count}</b>`))
    assert.match(chip, new RegExp(`我机损 <b[^>]*>${raw.fLost}</b>`))
    assert.match(chip, new RegExp(`敌机损 <b>${raw.eLost}</b>`))
    // 悬停逐波：每一波的标签都在
    const title = /title="([^"]*)"/.exec(chip)?.[1] ?? ''
    for (const stage of view.stages.filter((s) => s.phase === 'lbas')) assert.ok(title.includes(stage.label), stage.label)
  })
}

test('汇总不改舰队航空战那一格：「我方机损」仍只算 air + air2', () => {
  const fleet = airOf({ fCount: 18, fLost: 2, eCount: 30, eLost: 5, fLost2: 1, eLost2: 4 })
  const lbas1 = airOf({ fCount: 36, fLost: 3, eCount: 30, eLost: 9, fLost2: 2, eLost2: 0 })
  const lbas2 = airOf({ fCount: 36, fLost: 1, eCount: 21, eLost: 6, fLost2: 4, eLost2: 0 })
  const html = renderAirline(battleOf({
    air: fleet,
    stages: [
      stageOf(0, '第2基地第1波', lbas1, { phase: 'lbas', source: 'api_air_base_attack[0]', airBaseId: 2 }),
      stageOf(1, '第2基地第2波', lbas2, { phase: 'lbas', source: 'api_air_base_attack[1]', airBaseId: 2 }),
      stageOf(2, '第一航空战', fleet),
    ],
  }))
  assert.match(html, /我方机损 <b class="loss">3<\/b> · 敌机损 <b>9<\/b>/)
  const chip = chipOf(html)
  assert.match(chip, /基地航空 <b>1队2波<\/b>/)
  assert.match(chip, /我机损 <b class="loss">10<\/b>/)
  assert.match(chip, /敌机损 <b>15<\/b>/)
  // 悬停逐波：我方参战机数与该波损失、敌方机数与该波击坠
  const title = /title="([^"]*)"/.exec(chip)?.[1] ?? ''
  assert.match(title, /第2基地第1波[^\n]*36[^\n]*5[^\n]*30[^\n]*9/)
  assert.match(title, /第2基地第2波[^\n]*36[^\n]*5[^\n]*21[^\n]*6/)
})

test('我方零损失不标红；没有队号的波（喷气强袭 / 旧报文）只报波数', () => {
  const clean = airOf({ fCount: 12, fLost: 0, eCount: 8, eLost: 3, fLost2: 0, eLost2: 0 })
  const chip = chipOf(renderAirline(battleOf({
    stages: [stageOf(0, '基地喷气强袭1', clean, { phase: 'lbas', source: 'api_air_base_injection[0]' })],
  })))
  assert.match(chip, /基地航空 <b>1波<\/b>/)
  assert.match(chip, /我机损 <b>0<\/b>/)
})

test('没有陆航的战斗不出汇总', () => {
  const air = airOf({ fCount: 18, fLost: 2, eCount: 30, eLost: 5 })
  assert.equal(chipOf(renderAirline(battleOf({ air, stages: [stageOf(0, '第一航空战', air)] }))), '')
  assert.equal(chipOf(renderAirline(battleOf({ smokeType: 1 }))), '')
})
