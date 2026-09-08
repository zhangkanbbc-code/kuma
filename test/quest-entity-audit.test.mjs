import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'
import { auditQuestEntities, editDistance } from '../scripts/lib/quest-entity-audit.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-quest-audit-test-'))
const output = path.join(temp, 'runtime.cjs')
buildSync({ stdin: { contents: [
  'export * from "./src/renderer/task-entity-index"',
  'export * from "./src/renderer/task-entity-match"',
  'export * from "./src/renderer/task-entity-marks"',
  'export * from "./src/renderer/quest-mark-html"',
  'export * from "./src/shared/quest-emphasis"',
].join('\n'), resolveDir: root }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const runtime = createRequire(import.meta.url)(output)
test.after(() => fs.rmSync(temp, { recursive: true, force: true }))
const master = {
  api_mst_slotitem: [{ api_id: 7, api_name: '35.6cm連装砲' }, { api_id: 502, api_name: '35.6cm連装砲改三(ダズル迷彩仕様)' }, { api_id: 1500, api_name: '敌装备' }],
  api_mst_useitem: [{ api_id: 75, api_name: '新型砲熕兵装資材' }],
}
const indexes = runtime.buildTaskEntityIndexes(master, (_domain, _id, name) => name)
const quests = {
  1: { code: 'F1', desc: '准备「35.6cm连装炮×2」与「未知道具」。', memo2: '', memo: '奖励「未知道具」' },
  2: { code: 'F2', desc: '「35.6cm连装炮 未知改型」', memo2: '「未知道具」', memo: '' },
  3: { code: 'F3', desc: '准备「新型炮兵装资材」。', memo2: '', memo: '「35.6cm连装炮」' },
}

test('审计使用真实匹配器区分整词、无命中与部分命中，并跨字段和任务聚合', () => {
  const result = auditQuestEntities(quests, indexes, runtime)
  assert.deepEqual(result.summary, { total: 7, matched: 3, unmatched: 3, partial: 1 })
  assert.equal(result.unmatched[0].term, '未知道具')
  assert.equal(result.unmatched[0].count, 3)
  assert.deepEqual(result.unmatched[0].codes, ['F1', 'F2'])
  assert.deepEqual(result.unmatched[0].occurrences.map((row) => row.field), ['desc', 'memo', 'memo2'])
  assert.equal(result.partial[0].nearest.id, 7)
  assert.equal(result.partial[0].occurrences[0].hits[0].text, '35.6cm连装炮')
  assert.equal(result.matched.find((row) => row.term === '35.6cm连装炮').count, 2)
  assert.equal(editDistance('abc', 'adc'), 1)
  assert.equal(editDistance('', 'abc'), 3)
  assert.ok(!indexes.equipNameIndex.some((row) => row.id >= 1500))
})

test('审计保留上下文 acceptAlias；引号整词短名可命中，引号内带数量仍受 minLength 限制', () => {
  const data = { api_mst_ship: [{ api_id: 885, api_name: '胜利', api_sortno: 1, api_stype: 11 }], api_mst_slotitem: [{ api_id: 24, api_name: '彗星' }] }
  const idx = runtime.buildTaskEntityIndexes(data, (_domain, _id, name) => name)
  const result = auditQuestEntities({ 1: { code: 'C1', desc: '取得「胜利」，准备「彗星」与「彗星×2」' }, 2: { code: 'B1', desc: '旗舰「胜利」出击' } }, idx, runtime)
  assert.deepEqual(result.summary, { total: 4, matched: 2, unmatched: 2, partial: 0 })
  assert.equal(result.matched.find((row) => row.term === '彗星').occurrences[0].hits[0].ref, 24)
  assert.equal(result.unmatched.find((row) => row.term === '彗星').nearest.distance, 0)
})

test('CLI --json 只输出可解析明细；--master 不依赖个人快照；缺文件失败退出', () => {
  const file = path.join(temp, 'master.json')
  fs.writeFileSync(file, JSON.stringify({ body: { api_data: master } }))
  const cli = path.join(root, 'scripts', 'quest-entity-audit.mjs')
  const result = JSON.parse(execFileSync(process.execPath, [cli, '--master', file, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
  assert.deepEqual(Object.keys(result), ['summary', 'matched', 'unmatched', 'partial', 'occurrences'])
  assert.equal(result.summary.total, result.occurrences.length)
  for (const status of ['matched', 'unmatched', 'partial']) {
    assert.equal(result.summary[status], result[status].reduce((sum, row) => sum + row.count, 0))
  }
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ body: { api_data: master } }))
  const missing = spawnSync(process.execPath, [cli, '--master', path.join(temp, 'absent.json'), '--json'], { cwd: root, encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.equal(missing.stdout, '')
  assert.match(missing.stderr, /缺少主数据快照/)
})

test('正文每个实体 kind 链接到芯片同一域并保留高亮；纯文本标记不链接', () => {
  const domains = { ship: 'mstShip', equip: 'mstEquip', item: 'useitem', map: 'map', shipClass: 'shipClass', shipType: 'shipTypeCatalog', equipType: 'equipTypeCatalog', expedition: 'expedition', nationality: 'shipNationality' }
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')
  for (const [kind, domain] of Object.entries(domains)) {
    const calls = []
    const html = runtime.renderQuestMarkHtml({ kind, ref: 7, start: 0, length: 1 }, '&lt;原文&gt;', (...args) => { calls.push(args); return `<a>${args[2]}</a>` })
    assert.deepEqual(calls, [[domain, 7, '&lt;原文&gt;']])
    assert.equal(html, `<span class="qh qh-${kind}"><a>&lt;原文&gt;</a></span>`)
    assert.match(css, new RegExp(`\\.mod-qn \\.qh-${kind} \\{ --qh-color: var\\(--entity-`))
  }
  for (const kind of ['num', 'rank', 'limit', ...Object.keys(domains)]) {
    assert.equal(runtime.renderQuestMarkHtml({ kind, start: 0, length: 1 }, '原文', () => assert.fail('没有 ref 不应链接')), `<span class="qh qh-${kind}">原文</span>`)
  }
  const qn = fs.readFileSync(path.join(root, 'src', 'renderer', 'modules', 'qn.ts'), 'utf8')
  assert.match(qn, /renderQuestMarkHtml\(mark, inner, elinkHtml\)/)
  assert.match(qn, /spreadMarksToQuotes\(text, mergeQuestMarks\(taskEntityRawMarks\(/)
  assert.match(qn, /elink\('mstShip', entry.id, entry.name\)/)
  assert.match(qn, /elink\('shipTypeGroup', group.stypes.join\(','\), group.label\)/)
  assert.match(qn, /elink\('equipTypeGroup', '电探', '电探'\)/)
})

test('正文原始标记按索引来源保留细分 kind，舰娘链目标取根形态', () => {
  const named = (id, name) => ({ id, name, simple: name, aliases: [name] })
  const idx = { ...indexes, shipClassIndex: [named(1, '甲乙级')], shipTypeIndex: [named(2, '驱逐')], equipTypeIndex: [named(6, '舰战')], missionNameIndex: [named(1, '练习航海')] }
  const kinds = runtime.taskEntityRawMarks(idx, '甲乙级 驱逐 舰战 练习航海 新型炮兵装资材 35.6cm连装炮', 'D1', []).map((mark) => mark.kind)
  assert.deepEqual(kinds, ['shipClass', 'shipType', 'equipType', 'expedition', 'equip', 'item'])
  const chain = runtime.buildTaskEntityIndexes({ api_mst_ship: [{ api_id: 1, api_name: '甲舰', api_sortno: 1, api_aftershipid: '2' }, { api_id: 2, api_name: '甲舰改二', api_sortno: 2 }] }, (_domain, _id, name) => name)
  const marks = runtime.mergeQuestMarks(runtime.taskEntityRawMarks(chain, '旗舰「甲舰改二」', 'B1', []))
  assert.equal(marks[0].kind, 'ship')
  assert.equal(marks[0].ref, 1)
})
