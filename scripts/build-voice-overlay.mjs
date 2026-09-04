#!/usr/bin/env node
// 从第一方译文清单与两份随包上游台词生成译文自补层，全程只读本地文件。

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeVoiceText } from '../src/shared/voice-text.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceFile = path.join(root, 'scripts', 'voice-overlay-zh.json')
const outFile = path.join(root, 'assets', 'lodes', 'kanso-voice-zh.json')
const source = JSON.parse(readFileSync(sourceFile, 'utf8'))

const readPack = (id) =>
  JSON.parse(readFileSync(path.join(root, 'assets', 'lodes', `${id}.json`), 'utf8'))

const upstream = {
  'kcwiki-voice': readPack('kcwiki-voice').data,
  'kcwiki-seasonal-voice': readPack('kcwiki-seasonal-voice').data?.ships,
}

const rowIndex = (id) => {
  const wanted = new Set((source[id] ?? []).map((entry) => entry.key))
  const index = new Map()
  for (const rows of Object.values(upstream[id] ?? {})) {
    for (const row of rows ?? []) {
      if (!wanted.has(row.key)) continue
      if (index.has(row.key)) throw new Error(`${id} 的 key 重复：${row.key}`)
      index.set(row.key, row)
    }
  }
  return index
}

const indexes = {
  'kcwiki-voice': rowIndex('kcwiki-voice'),
  'kcwiki-seasonal-voice': rowIndex('kcwiki-seasonal-voice'),
}

const entries = {}
for (const pack of ['kcwiki-voice', 'kcwiki-seasonal-voice']) {
  for (const item of source[pack] ?? []) {
    const row = indexes[pack].get(item.key)
    if (!row) throw new Error(`${pack} 找不到清单 key：${item.key}`)
    if (entries[item.key]) throw new Error(`译文清单的 key 重复：${item.key}`)
    entries[item.key] = {
      pack,
      ja: `${row.ja ?? ''}`,
      zh: normalizeVoiceText(item.zh),
      ...(item.draft === true ? { draft: true } : {}),
    }
  }
}

const byJa = (source.byJa ?? []).map((entry) => ({
  ja: `${entry.ja ?? ''}`,
  zh: normalizeVoiceText(entry.zh),
}))

const pack = {
  meta: {
    id: 'kanso-voice-zh',
    name: '台词译文自补层（kuma 自行翻译）',
    version: '2026.09.04',
    source: 'kuma 自行翻译；日文底本为随包 kcwiki-voice / kcwiki-seasonal-voice 的原文列',
    fetchedAt: '2026-09-03T16:00:00.000Z',
    upstreamUpdatedAt: null,
    license: 'kuma 自行整理（第一方译文）',
    note: '补充上游缺失或照抄英文原文的中文译文',
    maintainerNote: [
      '2026-09-04 用户裁定：有许可基座的过时缺口走第一方自补层；上游译文为空或照抄英文原文时，由 kuma 自行翻译补上，只叠缺译，不覆盖上游已有中文',
      '2026-09-04 用户续裁：只翻原文本身是英文、译文栏照抄英文的行；原文是日文口癖或外来语、kcwiki 有意保留罗马字的行不动。包由 scripts/voice-overlay-zh.json 与两份随包上游台词生成，ja 在装配时按 key 取；上游补上中文即退役，ja 漂移则跳过并告警',
    ],
  },
  data: {
    schemaVersion: 1,
    compiledAt: '2026-09-04',
    entries,
    byJa,
  },
}

writeFileSync(outFile, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
console.log(
  `已写出 ${path.relative(root, outFile)}：${Object.keys(entries).length} 条 keyed 译文 + ${byJa.length} 条 byJa`,
)
