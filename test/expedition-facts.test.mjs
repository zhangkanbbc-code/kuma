import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import test from 'node:test'
import { transformSync } from 'esbuild'
import factModule from '../dist/shared/expedition-facts.js'
import compositionModule from '../dist/shared/expedition-composition.js'
import statModule from '../dist/shared/expedition-stats.js'
import validationModule from '../dist/main/lode-validation.js'
import { diffCells, semanticExpedition } from '../scripts/lib/expedition-fact-audit.mjs'
import { auditExpeditionExperience } from '../scripts/lib/expedition-experience.mjs'

const { mergeExpeditionFacts, expeditionGreatNote } = factModule
const { parseCompositionBranches, compReqStatus } = compositionModule
const { evaluateExpeditionStats } = statModule
const { validateLodePack } = validationModule
const json = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'))
const kc = json('../assets/lodes/kcwiki-expedition.json').data
const pack = json('../assets/lodes/expedition-facts.json')
const fixture = json('./fixtures/expedition-facts.json')
const bi = readFileSync(new URL('../src/renderer/modules/bi.ts', import.meta.url), 'utf8')

test('远征事实对账夹具固定 63 项与真实 kcwiki 基线，不读取 wikiwiki 包', () => {
  assert.equal(fixture.ids.length, 63)
  assert.deepEqual(fixture.ids, Object.keys(kc))
  assert.equal(createHash('sha256').update(readFileSync(new URL('../assets/lodes/kcwiki-expedition.json', import.meta.url))).digest('hex'), fixture.sourceHashes.kcwiki)
  assert.deepEqual(Object.fromEntries(fixture.ids.map((id) => [id, semanticExpedition(kc[id])])), fixture.baseSemantics)
  assert.equal(fixture.conflicts.length, 121)
  assert.deepEqual(fixture.corrected.map(({ id, field }) => `${id}.${field}`), ['24.drumTotal', '40.drumTotal'])
})

// 运行真实 bi 函数体；只替换游戏状态/实体链接等宿主依赖，不复制被测判断。
const section = (start, end) => {
  const a = bi.indexOf(start), b = bi.indexOf(end, a)
  assert.ok(a >= 0 && b > a, `缺少可执行的 bi 段：${start}`)
  return bi.slice(a, b)
}
const harness = () => {
  const missions = Object.fromEntries(fixture.ids.map((id, i) => [i + 1, { dispNo: id, deckNum: kc[id].minShips }]))
  const context = vm.createContext({
    mg: { master: { missions } },
    expedLocalizationLode: { data: kc }, expedLode: pack,
    mergeExpeditionFacts, parseCompositionBranches, compReqStatus, evaluateExpeditionStats,
    esc: String, entityNameHtml: () => '舰娘', masterShipName: () => '舰娘', elink: () => '',
    compViewOf: (ships) => ships.map((s) => ({ stype: s.stype, cve: s.cve ?? false })),
    stypeOf: (s) => s.stype, isCveShip: (s) => s.cve ?? false,
    drumCount: (s) => s.drums ?? 0, drumStock: () => 0, DRUM_MST: 75,
    expeditionStatShipsOf: (ships) => ships.map((s) => ({ stats: s.stats, equipment: [] })),
    EXPEDITION_STAT_KEYS: { 火力: 'firepower', 对空: 'antiAir', 对潜: 'antiSubmarine', 索敌: 'lineOfSight' },
    EXPEDITION_STAT_BASIS: {},
  })
  const code = [
    section('const normalizedDispNo', 'const hourly'),
    section('const compositionBranchCache', '// 条件检查：返回行列表'),
    section('const checkShips =', '// ---- 可行编成方案'),
    section('const slotsOf =', '// 舰 ↔ 坑位'),
    'globalThis.result = { allExpeds, checkShips, slotsOf }',
  ].join('\n')
  vm.runInContext(transformSync(code, { loader: 'ts', format: 'cjs' }).code, context)
  return context.result
}
const runtime = harness()
const expeds = new Map(runtime.allExpeds().map((e) => [e.dispNo, e]))
test('D1 第三票维护者订正覆盖舰娘经验，保留提督经验与来源', () => {
  const correction = pack.meta.corrections.find(row => row.id === 'D1')
  assert.equal(correction.field, 'rewards.shipExp')
  assert.equal(correction.value, 45)
  assert.equal(correction.basis, 'maintainer')
  assert.equal(correction.date, '2026-09-06')
  assert.match(correction.evidence, /维护者核 2026-09-06/)
  assert.equal(kc.D1.rewards.shipExp, 40)
  assert.deepEqual(JSON.parse(JSON.stringify(expeds.get('D1').wiki.rewards)), { ...kc.D1.rewards, shipExp: 45 })
  assert.equal(expeds.get('D1').wiki.rewards.hqExp, 35)
})

test('账本经验取普通成功非旗舰最小值，排除旗舰取整、大成功双倍和失败，只报不写', () => {
  // 合成报文刻意用较低的大成功值与只有旗舰的记录，防止未排除时仍碰巧取对最小值。
  const events = json('./fixtures/expedition-experience.json')
  const current = { D1: kc.D1, '2': kc['2'] }
  const wiki = { D1: { rewards: { shipExp: 45 } }, '2': kc['2'] }
  const before = structuredClone({ events, current, wiki })
  const result = auditExpeditionExperience(events.map(event => ({ ...event, body: JSON.stringify(event.body) })), current, wiki)
  assert.equal(result.total, 6)
  assert.deepEqual(result.unknownNames, [])
  const d1 = result.expeditions.find(row => row.id === 'D1')
  assert.deepEqual(d1, { id: 'D1', name: kc.D1.nameJp, total: 5, success: 3, great: 1, failed: 1,
    samples: 2, ships: 4, observed: 45, observedAt: '2026-09-06T00:00:01.000Z', current: 40, wikiwiki: 45 })
  assert.deepEqual(result.differences, [d1])
  assert.deepEqual(result.wikiDifferences, [])
  assert.equal(result.expeditions.find(row => row.id === '2').observed, null)
  assert.deepEqual({ events, current, wiki }, before)
})

for (const id of fixture.ids) {
  test(`远征 ${id}：旧开发机与随包事实层逐字段消费语义对账`, () => {
    const next = semanticExpedition(expeds.get(id).wiki)
    const actual = diffCells(next, fixture.oldSemantics[id])
    const expected = [...fixture.conflicts, ...fixture.corrected].filter((row) => row.id === id)
      .map(({ field, kcwiki, wikiwiki }) => ({ field, kcwiki, wikiwiki }))
    const byField = (a, b) => a.field.localeCompare(b.field)
    assert.deepEqual(actual.sort(byField), expected.sort(byField))
    assert.equal(expeds.get(id).wiki.nameZh, kc[id].nameZh)
  })
}

test('无 wikiwiki 包时 A5 四行仍按真实 checkShips 产生并参与失败判定', () => {
  const e = expeds.get('A5')
  const stats = runtime.checkShips(e, []).rows.filter((row) => /^舰队(火力|对空|对潜|索敌)/.test(row.text))
  assert.deepEqual(Array.from(stats, ({ text }) => text), [
    '舰队火力 ≥ <em>280</em>', '舰队对空 ≥ <em>220</em>',
    '舰队对潜 ≥ <em>240</em>', '舰队索敌 ≥ <em>150</em>',
  ])
  assert.ok(stats.every((row) => row.mark === 'no'))
  const ship = { stype: 3, lv: 200, cond: 49, stats: { firepower: 280, antiAir: 220, antiSubmarine: 240, lineOfSight: 150 } }
  assert.ok(runtime.checkShips(e, [ship]).rows.filter((row) => /^舰队(火力|对空|对潜|索敌)/.test(row.text)).every((row) => row.mark === 'ok'))
})

test('补齐 A4/A6/B4 火力、D2 索敌、21/44 桶数且保留底层其余属性', () => {
  for (const [id, stat, value] of [['A4', '火力', 300], ['A6', '火力', 330], ['B4', '火力', 500], ['D2', '索敌', 70]]) {
    const e = expeds.get(id)
    assert.ok(runtime.checkShips(e, []).rows.some((row) => row.text === `舰队${stat} ≥ <em>${value}</em>` && row.mark === 'no'))
    for (const [key, val] of Object.entries(kc[id].stats)) assert.equal(e.wiki.stats[key], val)
  }
  for (const [id, total] of [['21', 3], ['44', 6]]) {
    assert.ok(runtime.checkShips(expeds.get(id), []).rows.some((row) => row.text.includes(`合计 ≥ <em>${total}</em>`)))
  }
})

test('24/40 不产生普通桶门槛；40 与 D1–D3 大成功只提示，D3 保留待验证', () => {
  for (const id of ['24', '40']) {
    assert.equal(expeds.get(id).wiki.drumTotal, null)
    assert.ok(!runtime.checkShips(expeds.get(id), []).rows.some((row) => row.text.startsWith('运输桶')))
  }
  assert.equal(pack.data['24'], undefined)
  for (const id of ['40', 'D1', 'D2', 'D3']) {
    const e = expeds.get(id), checked = runtime.checkShips(e, [])
    const row = checked.rows.find((r) => r.text.startsWith('大成功：'))
    assert.equal(row.mark, 'wait')
    assert.equal(checked.fails, runtime.checkShips({ ...e, wiki: { ...e.wiki, greatNote: null } }, []).fails)
  }
  assert.equal(expeds.get('40').wiki.greatNote, '大成功要4桶以上+4闪')
  assert.equal(expeds.get('D1').wiki.greatNote, '大成功要5闪或旗舰128级以上+4闪')
  assert.equal(expeds.get('D3').wiki.greatNote, '大成功要5闪或旗舰128级以上+4闪（待验证）')
})

test('结构化分支驱动真实检查：4 号护卫空母变体无需 wiki 原文', () => {
  const ships = [7, 2, 2].map((stype) => ({ stype, cve: stype === 7, lv: 99, cond: 49 }))
  const e = expeds.get('4')
  assert.equal(runtime.checkShips(e, ships).fails, 0)
  assert.ok(runtime.checkShips({ ...e, wiki: kc['4'] }, ships).fails > 0)
})

test('规划器首选分支与槽位顺序逐项对账，允许的编成冲突除外', () => {
  const views = Array.from({ length: 22 }, (_, i) => [false, true].map((cve) => ({ stype: i + 1, cve, lv: 1000 }))).flat()
  const slots = (e) => Array.from(runtime.slotsOf(e), (slot) => ({ flagship: slot.flagship, accepts: views.map(slot.accepts) }))
  for (const id of fixture.ids) {
    if (fixture.conflicts.some((row) => row.id === id && row.field === 'compositionBranches')) continue
    const e = expeds.get(id), old = fixture.oldSemantics[id]
    const oldWiki = { ...old, composition: kc[id].composition, compositionBranches: old.compositionBranches.map((reqs) => ({ label: '', reqs: reqs.map((req) => ({ ...req, label: '' })) })) }
    assert.deepEqual(slots(e), slots({ ...e, wiki: oldWiki }), id)
  }
})

test('事实包严格形状、数值范围与散文禁入', () => {
  assert.equal(validateLodePack(pack).ok, true)
  const invalid = [
    { A5: { stats: { 火力: -1 } } }, { A5: { stats: { 火力: 1.5 } } },
    { A5: { stats: { 火力: 10001 } } }, { A5: { stats: { 装甲: 1 } } },
    { A5: { stats: {} } }, { A5: { drumTotal: 0 } }, { A5: { drumTotal: 101 } },
    { '0': { drumTotal: 1 } }, { A5: { greatNote: '原文' } }, { A5: { rawComposition: '原文' } },
    { A5: { compositionBranches: [] } }, { A5: { greatSuccess: { alternatives: [] } } },
    { A5: { greatSuccess: { alternatives: [{ kira: 7 }] } } },
    { A5: { greatSuccess: { alternatives: [{ kira: 4, flagLv: -1 }] } } },
    { A5: { greatSuccess: { alternatives: [{ kira: 4, drumTotal: 101 }] } } },
    { A5: { greatSuccess: { alternatives: [{ kira: 4 }], tentative: 'yes' } } },
    { A5: { rewards: { fuel: [1, -1] } } }, { A5: { rewards: { fuel: [1] } } },
    { D1: { rewards: { shipExp: -1 } } }, { D1: { rewards: { shipExp: 1.5 } } },
    { D1: { rewards: { shipExp: [45, 45] } } }, { D1: { rewards: { shipExp: 100001 } } },
  ]
  const badReq = structuredClone(pack.data['4'])
  badReq.compositionBranches[0].reqs[0].count = 7
  invalid.push({ '4': badReq })
  const unknown = structuredClone(pack.data['4'])
  unknown.compositionBranches[0].reqs[0].types = null
  invalid.push({ '4': unknown })
  for (const data of invalid) assert.equal(validateLodePack({ ...pack, data }).ok, false, JSON.stringify(data))
})

test('事实合并不改写 kcwiki，不用日文覆盖中文名；无底层不冒充完整远征', () => {
  const before = structuredClone(kc.A5)
  const result = mergeExpeditionFacts(kc.A5, pack.data.A5)
  assert.deepEqual(kc.A5, before)
  assert.equal(result.nameZh, before.nameZh)
  assert.equal(mergeExpeditionFacts(null, pack.data.A5), null)
  assert.equal(mergeExpeditionFacts(kc.A5), kc.A5)
  assert.equal(expeditionGreatNote({ alternatives: [{ drumTotal: 4, kira: 4 }] }), kc['40'].greatNote)
})
