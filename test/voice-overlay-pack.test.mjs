import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import voiceLineage from '../dist/shared/voice-lineage.js'
import voiceText from '../dist/shared/voice-text.js'

const { normalizeVoiceLine } = voiceLineage
const { isUntranslatedVoiceText, isVoiceTextNormalized } = voiceText
const root = new URL('../assets/lodes/', import.meta.url)
const read = (id) => JSON.parse(fs.readFileSync(new URL(`${id}.json`, root), 'utf8'))

const overlay = read('kanso-voice-zh').data
const regular = read('kcwiki-voice').data
const seasonal = read('kcwiki-seasonal-voice').data.ships
const subtitleJa = read('subtitle-ja').data

const upstreamByPack = {
  'kcwiki-voice': regular,
  'kcwiki-seasonal-voice': seasonal,
}

const rowsByPack = Object.fromEntries(
  Object.entries(upstreamByPack).map(([pack, groups]) => {
    const rows = new Map()
    for (const groupRows of Object.values(groups)) {
      for (const row of groupRows ?? []) {
        if (overlay.entries[row.key]?.pack === pack) {
          assert.equal(rows.has(row.key), false, `${pack}/${row.key} 在上游出现多次`)
          rows.set(row.key, row)
        }
      }
    }
    return [pack, rows]
  }),
)

test('译文 overlay 包保持 188 个 keyed 条目与 1 个 byJa 条目', () => {
  assert.equal(Object.keys(overlay.entries).length, 188)
  assert.equal(overlay.byJa.length, 1)
  assert.equal(
    Object.values(overlay.entries).filter((entry) => entry.pack === 'kcwiki-voice').length,
    121,
  )
  assert.equal(
    Object.values(overlay.entries).filter((entry) => entry.pack === 'kcwiki-seasonal-voice').length,
    67,
  )
})

test('每个 keyed 条目仍在对应上游、仍判缺译，且日文原文没有变化', () => {
  const retired = []
  const missing = []
  const changed = []
  for (const [key, entry] of Object.entries(overlay.entries)) {
    const row = rowsByPack[entry.pack]?.get(key)
    if (!row) {
      missing.push(`${entry.pack}/${key}`)
      continue
    }
    if (!isUntranslatedVoiceText(row.zh)) retired.push(`${entry.pack}/${key}`)
    if (normalizeVoiceLine(row.ja) !== normalizeVoiceLine(entry.ja)) {
      changed.push(`${entry.pack}/${key}`)
    }
  }
  assert.deepEqual(missing, [], `上游已删 key：${missing.slice(0, 8).join('、')}`)
  assert.deepEqual(retired, [], `上游已补、请删 overlay：${retired.slice(0, 8).join('、')}`)
  assert.deepEqual(changed, [], `上游日文原文已变：${changed.slice(0, 8).join('、')}`)
})

test('overlay 译文都有 CJK 字符且已过台词标点归一', () => {
  const bad = []
  for (const [key, entry] of Object.entries(overlay.entries)) {
    if (
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(entry.zh) ||
      !isVoiceTextNormalized(entry.zh) ||
      entry.zh.endsWith('。')
    ) {
      bad.push(key)
    }
  }
  for (const [index, entry] of overlay.byJa.entries()) {
    if (
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(entry.zh) ||
      !isVoiceTextNormalized(entry.zh) ||
      entry.zh.endsWith('。')
    ) {
      bad.push(`byJa[${index}]`)
    }
  }
  assert.deepEqual(bad, [])
})

test('byJa 的日文原文在 subtitle-ja 里存在', () => {
  const subtitleLines = new Set()
  for (const table of Object.values(subtitleJa)) {
    for (const line of Object.values(table ?? {})) {
      const key = normalizeVoiceLine(line)
      if (key) subtitleLines.add(key)
    }
  }
  const missing = overlay.byJa
    .map((entry) => entry.ja)
    .filter((ja) => !subtitleLines.has(normalizeVoiceLine(ja)))
  assert.deepEqual(missing, [])
})

test('运行时包不带维护者 note，draft 只保留布尔标记', () => {
  for (const entry of Object.values(overlay.entries)) {
    assert.equal(Object.hasOwn(entry, 'note'), false)
    assert.ok(entry.draft === undefined || entry.draft === true)
  }
  for (const entry of overlay.byJa) assert.deepEqual(Object.keys(entry).sort(), ['ja', 'zh'])
})
