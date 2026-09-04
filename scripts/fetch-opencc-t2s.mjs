#!/usr/bin/env node
// 从 OpenCC 的繁→简字表与词表生成随包资料；每个上游文件只请求一次。

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ZH_SIMPLIFY_OVERRIDES } from './lib/zh-simplify-overrides.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets', 'lodes', 'opencc-t2s.json')
const SOURCES = [
  {
    field: 'chars',
    url: 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt',
  },
  {
    field: 'phrases',
    url: 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSPhrases.txt',
  },
]

const parseDictionary = (text) => {
  const entries = new Map()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const tab = line.indexOf('\t')
    if (tab < 1) continue
    const source = line.slice(0, tab).trim()
    const target = line.slice(tab + 1).trim().split(/\s+/)[0]
    if (source && target) entries.set(source, target)
  }
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  )
}

const mergeDictionary = (dictionary, overrides) => Object.fromEntries(
  Object.entries({ ...dictionary, ...overrides })
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
)

const fetched = await Promise.all(
  SOURCES.map(async (source) => {
    const response = await fetch(source.url, { headers: { 'User-Agent': 'kanso-lodes' } })
    if (!response.ok) throw new Error(`${source.url} → HTTP ${response.status}`)
    return { ...source, text: await response.text() }
  }),
)

const data = { schemaVersion: 1, chars: {}, phrases: {} }
for (const source of fetched) data[source.field] = parseDictionary(source.text)
if (!Object.keys(data.chars).length || !Object.keys(data.phrases).length) {
  throw new Error('OpenCC 字表或词表解析为空')
}
data.chars = mergeDictionary(data.chars, ZH_SIMPLIFY_OVERRIDES.chars)
data.phrases = mergeDictionary(data.phrases, ZH_SIMPLIFY_OVERRIDES.phrases)

const sourceDigest = createHash('sha256')
  .update(fetched.map(({ field, text }) => `${field}\0${text}`).join('\0'))
  .digest('hex')
let fetchedAt = new Date().toISOString()
if (fs.existsSync(OUT)) {
  const previous = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  if (previous?.meta?.sourceDigest === sourceDigest) fetchedAt = previous.meta.fetchedAt
}

const pack = {
  meta: {
    id: 'opencc-t2s',
    name: '繁简字表（OpenCC 派生）',
    version: `1.${sourceDigest.slice(0, 12)}`,
    source: 'OpenCC 项目 data/dictionary/TSCharacters.txt + TSPhrases.txt',
    sourceUrl: 'https://github.com/BYVoid/OpenCC/tree/master/data/dictionary',
    fetchedAt,
    license: 'Apache-2.0（OpenCC）',
    note: '玩家可见中文资料显示时使用的繁体转简体字词表',
    maintainerNote: ['第一方覆盖层见 scripts/lib/zh-simplify-overrides.mjs'],
    sourceDigest,
  },
  data,
}

fs.writeFileSync(OUT, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
console.log(
  `已写出 ${path.relative(ROOT, OUT)}：chars ${Object.keys(data.chars).length} / phrases ${Object.keys(data.phrases).length}`,
)
