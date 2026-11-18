import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import validation from '../dist/main/lode-validation.js'
import { parseKcwikiQuestPages, assertQuestScnCodes, questScnPendingLogLines } from '../scripts/lib/kcwiki-quests-scn.mjs'

const raw = readFileSync(new URL('./fixtures/kcwiki-quests-missing-code-20261112.txt', import.meta.url), 'utf8')
const titles = ['【期間限定任務】秋月型演習任務2026', '【期間限定任務】秋刀魚祭り準備演習！']
const parse = pages => parseKcwikiQuestPages(pages, new Map())
const packFor = ({ quests, unnumbered }) => ({
  meta: { id: 'quests-scn', name: '任务', source: 'zh.kcwiki', fetchedAt: '2026-11-12' },
  data: quests, unnumbered,
})

test('真实空编码行逐条记录；维护者裁决 2026-11-15 后 F144 定号，B218 保留未定号', () => {
  const parsed = parse([raw])
  assert.deepEqual(Object.keys(parsed.quests), ['1172'])
  assert.equal(parsed.quests[1172].code, 'F144')
  assert.deepEqual(Object.keys(parsed.unnumbered), ['B218'])
  assert.equal(parsed.unnumbered.B218.code, 'B218')
  assert.deepEqual(parsed.stats.maintainerHits, [{ code: 'F144', id: 1172 }])
  assert.equal(parsed.stats.withoutCode, 2)
  assert.deepEqual(parsed.stats.withoutCodeRows, titles.map((titleJa, i) => ({ titleJa, name: '', pageIndex: 0, template: i + 1 })))
  assert.equal(parsed.stats.withoutId, 1)
  const pack = packFor(parsed)
  assert.doesNotThrow(() => assertQuestScnCodes(pack))
  assert.equal(validation.validateLodePack(pack).ok, true)
  assert.deepEqual(questScnPendingLogLines(parsed.stats), [
    '[lodes]   缺编码 2', ...titles.map(title => `[lodes]     ${title}`),
    '[lodes]   未定号 1', '[lodes]     B218｜再编二十驱「天霧」「狭霧」南方部署！',
  ])
})

test('去掉注释与空白后缺编码，即使有游戏编号也跳过；无日文名可定位', () => {
  const parsed = parse(['{{任务表|编号= \t<!--999-->|中文任务名字=编辑中}}'])
  assert.deepEqual(parsed.quests, {})
  assert.deepEqual(parsed.unnumbered, {})
  assert.equal(parsed.stats.withoutId, 0)
  assert.deepEqual(parsed.stats.withoutCodeRows, [{ titleJa: '', name: '编辑中', pageIndex: 0, template: 1 }])
  assert.deepEqual(questScnPendingLogLines(parsed.stats), [
    '[lodes]   缺编码 1', '[lodes]     第 1 页 / 模板 1', '[lodes]   未定号 0',
  ])
})

test('写包前编码门槛拒绝空编码及未定号键不一致，不静默修补', () => {
  for (const section of ['data', 'unnumbered']) {
    for (const code of ['', ' \t', 'A'.repeat(101)]) {
      const pack = packFor(parse([raw]))
      pack[section][section === 'data' ? '999' : code] = { ...pack.unnumbered.B218, code }
      const before = structuredClone(pack)
      assert.throws(() => assertQuestScnCodes(pack), /编码非法/)
      assert.deepEqual(pack, before)
      if (code !== ' \t') assert.equal(validation.validateLodePack(pack).ok, false)
    }
  }
  const pack = packFor(parse([raw]))
  pack.unnumbered.B218.code = 'B219'
  assert.throws(() => assertQuestScnCodes(pack), /编码非法/)
  assert.equal(validation.validateLodePack(pack).ok, false)
})
