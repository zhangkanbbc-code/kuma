import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { BUNDLED_LODE_IDS, REPO_ROOT } from '../scripts/lib/bundled-lodes.mjs'
import { codeEvidenceTexts, jsonEvidenceTexts, textErrors, FORBIDDEN_EVIDENCE_WORDS } from '../scripts/lib/evidence-text-audit.mjs'

const read = file => readFileSync(path.join(REPO_ROOT, file), 'utf8')
const filesIn = (dir, suffix) => readdirSync(path.join(REPO_ROOT, dir), { recursive: true })
  .filter(file => file.endsWith(suffix)).map(file => `${dir}/${file.replaceAll('\\', '/')}`)

test('随包 JSON 的出处字段不携带个人叙事', () => {
  const entries = BUNDLED_LODE_IDS.flatMap(id => {
    const file = `assets/lodes/${id}.json`
    return jsonEvidenceTexts(JSON.parse(read(file)), file)
  })
  assert.deepEqual(textErrors(entries), [])
})

test('shared 出处、订正表与生成器模板无禁词', () => {
  const files = [...filesIn('src/shared', '.ts'), ...filesIn('scripts', '.mjs'),
    'src/main/mg/quest-fleet-rules.ts', 'src/main/mg/quest-sortie-rules.ts']
    .filter(file => file !== 'scripts/lib/evidence-text-audit.mjs')
  const entries = files.flatMap(file => codeEvidenceTexts(read(file), file))
  entries.push(...jsonEvidenceTexts(JSON.parse(read('scripts/lode-sources.json')), 'scripts/lode-sources.json'))
  assert.deepEqual(textErrors(entries), [])
})

test('docs 公开文档全文无出处禁词', () => {
  const entries = filesIn('docs', '.md').map(file => ({ file, field: '全文', text: read(file) }))
  assert.deepEqual(textErrors(entries), [])
})

test('护栏识别嵌套字段、转义、拼接、常量和模板，同时保留功能文案', () => {
  for (const word of FORBIDDEN_EVIDENCE_WORDS) {
    const source = `const BAD = ${JSON.stringify(word)}; const rows = [{ stepSources: { A: { evidence: BAD } } }];`
    const errors = textErrors(codeEvidenceTexts(source, 'fixture.ts'))
    assert.ok(errors.some(error => error.includes('fixture.ts:rows.stepSources.A.evidence@') && error.includes(word)), word)
    assert.ok(textErrors(jsonEvidenceTexts({ meta: { maintainerNote: [word] } }, 'fixture.json'))[0].includes('$.meta.maintainerNote.0'))
  }
  for (const expression of ['"\\u672c\\u673a"', '"本" + "机"', '`本${"机"}`']) {
    assert.ok(textErrors(codeEvidenceTexts(`const x = { note: ${expression} };`, 'fixture.js')).length)
  }
  assert.ok(textErrors(codeEvidenceTexts('const X_CORRECTIONS = [{ detail: "账本" }]', 'fixture.ts')).length)
  assert.ok(textErrors(codeEvidenceTexts('const x = {}; x.evidence = "本机"', 'fixture.ts')).length)
  assert.deepEqual(textErrors(codeEvidenceTexts('const button = "删除账本里的全部通知历史"; function label() { return "本机暂无该曲" }', 'fixture.js')), [])
  assert.deepEqual(textErrors(jsonEvidenceTexts({ data: { dialogue: '他的名字' } }, 'fixture.json')), [])
})
