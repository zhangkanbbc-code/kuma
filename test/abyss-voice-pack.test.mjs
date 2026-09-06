// 深海台词自补层的真包护栏。归属配错的样子和配对的一模一样，只有比对底本才看得出来。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { createAbyssalNameResolver } from '../src/renderer/abyssal-name.ts'
import { normalizeVoiceLine } from '../src/shared/voice-lineage.ts'
import {
  buildShipFormCodeMap,
  planVoiceCorrections,
} from '../src/shared/voice-scene-slots.ts'
import { normalizeVoiceText } from '../src/shared/voice-text.ts'

const lodeFile = (id) => new URL(`../assets/lodes/${id}.json`, import.meta.url)
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const readLode = (id) => readJson(lodeFile(id))
const bottomFile = lodeFile('wikiwiki-abyss-voice')
const hasBottom = fs.existsSync(bottomFile)

test('kuma-abyss-voice 与深海底本、上游认领和译文源逐行对账', { skip: !hasBottom }, async (t) => {
  const pack = readLode('kuma-abyss-voice')
  const bottom = readJson(bottomFile)
  const subtitleEnemies = readLode('subtitle-enemies')
  const kcwikiVoice = readLode('kcwiki-voice')
  const subtitleJa = readLode('subtitle-ja')
  const subtitleZh = readLode('subtitle-zh')
  const seasonal = readLode('kcwiki-seasonal-voice')
  const kcwikiShips = readLode('kcwiki-ships')
  const localization = readLode('kcwiki-localization')
  const source = readJson(new URL('../scripts/abyss-voice-zh.json', import.meta.url))
  const ships = pack.data.ships
  const clean = (value) => `${value ?? ''}`.trim()
  const excluded = (line) =>
    line?.scene === 'CV' ||
    `${line?.ja ?? ''}`.startsWith('CV：') ||
    `${line?.ja ?? ''}`.includes('イラストレーター')

  await t.test('ja 与底本按形态、suffix 和同槽序号逐字相等', () => {
    for (const [mstId, rows] of Object.entries(ships)) {
      const expected = (bottom.data[mstId] ?? []).filter((line) => !excluded(line))
      assert.equal(rows.length, expected.length, `${mstId} 行数`)
      const expectedBySuffix = new Map()
      const actualBySuffix = new Map()
      const expectedSlotless = []
      const actualSlotless = []
      for (const line of expected) {
        if (line.suffix === undefined) expectedSlotless.push(line)
        else expectedBySuffix.set(line.suffix, [...(expectedBySuffix.get(line.suffix) ?? []), line])
      }
      for (const line of rows) {
        if (line.suffix === undefined) actualSlotless.push(line)
        else actualBySuffix.set(line.suffix, [...(actualBySuffix.get(line.suffix) ?? []), line])
      }
      assert.deepEqual(
        [...actualBySuffix.keys()].sort((a, b) => a - b),
        [...expectedBySuffix.keys()].sort((a, b) => a - b),
        `${mstId} suffix 集合`,
      )
      for (const [suffix, lines] of expectedBySuffix) {
        assert.deepEqual(
          (actualBySuffix.get(suffix) ?? []).map((line) => line.ja),
          lines.map((line) => line.ja),
          `${mstId}-${suffix} 同槽逐字`,
        )
      }
      assert.deepEqual(
        actualSlotless.map((line) => line.ja),
        expectedSlotless.map((line) => line.ja),
        `${mstId} 无 suffix 行逐字`,
      )
    }
  })

  await t.test('只收 subtitle-enemies 与 kcwiki 都未认领的底本形态', () => {
    const abyssEntities = localization.data.entities.abyssShip
    const abyssalShips = new Map(
      Object.entries(abyssEntities).map(([id, entry]) => [
        Number(id),
        { api_name: clean(entry.ja) },
      ]),
    )
    const comparable = (value) =>
      clean(value)
        .normalize('NFKC')
        .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
        .replace(/\s+/g, '')
        .toLowerCase()
    const localizedEntityId = (label) => {
      const target = comparable(label)
      if (!target) return null
      for (const [id, entry] of Object.entries(abyssEntities)) {
        if (comparable(entry.ja) === target || comparable(entry.zh) === target) return id
      }
      return null
    }
    const resolveAbyssalName = createAbyssalNameResolver(
      [...abyssalShips].map(([id, ship]) => ({ id, name: ship.api_name })),
    )
    const abyssSubtitleByMst = new Map()
    for (const [key, raw] of Object.entries(subtitleEnemies.data)) {
      for (const line of Array.isArray(raw) ? raw : [raw]) {
        const fallbackId = resolveAbyssalName(clean(line.name))
        const localizedId = Number(localizedEntityId(line.name))
        const resolvedId =
          Number.isInteger(localizedId) && localizedId >= 1_500 ? localizedId : fallbackId
        const canonical = resolvedId ? abyssalShips.get(resolvedId)?.api_name : ''
        if (!canonical) continue
        const candidates = [...abyssalShips]
          .filter(([, candidate]) => candidate.api_name === canonical)
          .map(([candidateId]) => candidateId)
          .sort((left, right) => left - right)
        const embeddedAnchor = candidates.find((candidateId) => {
          if (candidateId >= 2_000) return key.includes(`${candidateId}`)
          const resourceId = `${candidateId - 1_000}`
          return key.includes(resourceId.padStart(4, '0')) || key.includes(resourceId)
        })
        const anchor = embeddedAnchor ?? resolvedId
        if (anchor == null || !candidates.includes(anchor)) continue
        const exactIds = [anchor]
        for (let next = anchor + 1; candidates.includes(next); next++) exactIds.push(next)
        for (const candidateId of exactIds) abyssSubtitleByMst.set(candidateId, true)
      }
    }
    const rowsByForm = planVoiceCorrections({
      voice: kcwikiVoice.data,
      subtitleJa: subtitleJa.data,
      subtitleZh: subtitleZh.data,
      seasonalShips: seasonal.data.ships,
      codeMap: buildShipFormCodeMap(kcwikiShips.data),
    }).rowsByForm
    const expectedForms = Object.keys(bottom.data)
      .map(Number)
      .filter(
        (mstId) =>
          !abyssSubtitleByMst.has(mstId) &&
          !(rowsByForm.get(mstId) ?? []).some((row) => row.fix !== 'reattributed') &&
          (bottom.data[`${mstId}`] ?? []).some((line) => !excluded(line)),
      )
      .sort((left, right) => left - right)
    assert.deepEqual(Object.keys(ships).map(Number), expectedForms)
  })

  await t.test('CV 与绘师行零漏网', () => {
    for (const rows of Object.values(ships)) {
      for (const line of rows) {
        assert.notEqual(line.scene, 'CV')
        assert.ok(!line.ja.startsWith('CV：'))
        assert.ok(!line.ja.includes('イラストレーター'))
      }
    }
  })

  await t.test('ambiguous 与同形态同 suffix 多行完全一致', () => {
    for (const [mstId, rows] of Object.entries(ships)) {
      const counts = new Map()
      for (const row of rows) {
        if (row.suffix !== undefined) counts.set(row.suffix, (counts.get(row.suffix) ?? 0) + 1)
      }
      for (const row of rows) {
        const expected = row.suffix !== undefined && (counts.get(row.suffix) ?? 0) > 1
        assert.equal(row.ambiguous === true, expected, `${mstId}/${row.key}`)
      }
    }
  })

  await t.test('所有非空译文都合体例，且不照抄同句上游译文', () => {
    const forbidden =
      /所持|在籍|入手|泛用|周历|未观测|回港|轰沉|现编成|报酬|遂行中|任务所|在途|在泊|低练|图鉴新登录|制空値|勝利条件|係数|輸送物資量|二番舰|期间限定|未受领|非公式|个人实绩|够得到|摸不到/
    const upstreamByJa = new Map()
    const remember = (ja, zh) => {
      const key = normalizeVoiceLine(ja)
      const value = clean(zh)
      if (!key || !value) return
      const values = upstreamByJa.get(key) ?? new Set()
      values.add(value)
      upstreamByJa.set(key, values)
    }
    for (const [mstId, rows] of Object.entries(kcwikiVoice.data)) {
      if (Number(mstId) >= 1_500) for (const row of rows) remember(row.ja, row.zh)
    }
    for (const raw of Object.values(subtitleEnemies.data)) {
      for (const row of Array.isArray(raw) ? raw : [raw]) remember(row.jp, row.zh)
    }
    for (const rows of Object.values(ships)) {
      for (const row of rows) {
        if (!row.zh) continue
        assert.match(row.zh, /[\u3400-\u9fff]/, row.key)
        assert.equal(normalizeVoiceText(row.zh), row.zh, row.key)
        assert.ok(!row.zh.includes('……。'), row.key)
        assert.doesNotMatch(row.zh, forbidden, row.key)
        assert.ok(!upstreamByJa.get(normalizeVoiceLine(row.ja))?.has(row.zh), row.key)
      }
    }
  })

  await t.test('译文源与包双向对得上，维基编辑注口径钉住', () => {
    const allowed = new Set(['ja', 'zh', 'draft', 'note', 'skip'])
    const rowsByJa = new Map()
    for (const rows of Object.values(ships)) {
      for (const row of rows) {
        const key = normalizeVoiceLine(row.ja)
        rowsByJa.set(key, [...(rowsByJa.get(key) ?? []), row])
        if (/\(表示される台詞は/.test(row.ja)) assert.equal(row.draft, true, row.key)
      }
    }
    const sourceByJa = new Map()
    for (const [index, entry] of (source.byJa ?? []).entries()) {
      for (const field of Object.keys(entry)) assert.ok(allowed.has(field), `byJa[${index}].${field}`)
      const key = normalizeVoiceLine(entry.ja)
      assert.ok(rowsByJa.has(key), `byJa[${index}] 零命中`)
      assert.ok(!sourceByJa.has(key), `byJa[${index}] 归一后重复`)
      sourceByJa.set(key, entry)
      if (/\(表示される台詞は/.test(entry.ja)) {
        assert.equal(entry.draft, true)
        assert.equal(entry.note, '底本这一行带 wiki 编辑注，译文只取括号外的台词')
      }
    }
    for (const rows of Object.values(ships)) {
      for (const row of rows) {
        if (!row.zh) continue
        const entry = sourceByJa.get(normalizeVoiceLine(row.ja))
        assert.ok(entry, `${row.key} 非空译文没有源条目`)
        assert.equal(entry.zh, row.zh, `${row.key} 译文与源不一致`)
      }
    }
  })
})
