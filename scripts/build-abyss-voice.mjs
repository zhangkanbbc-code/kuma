#!/usr/bin/env node
// 从本机深海台词底本与第一方译文清单生成随包自补层，全程只读本地文件。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { normalizeVoiceLine } from '../src/shared/voice-lineage.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lodeDir = path.join(root, 'assets', 'lodes')
const sourceFile = path.join(root, 'scripts', 'abyss-voice-zh.json')
const outFile = path.join(lodeDir, 'kuma-abyss-voice.json')
const sharedBundle = await build({
  stdin: {
    contents: `
      export { createAbyssalNameResolver } from './src/renderer/abyssal-name.ts'
      export { applyVoiceOverlay } from './src/shared/voice-overlay.ts'
      export { buildShipFormCodeMap, planVoiceCorrections } from './src/shared/voice-scene-slots.ts'
      export { isUntranslatedVoiceText } from './src/shared/voice-text.ts'
    `,
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'abyss-voice-build-entry.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
})
const shared = await import(
  `data:text/javascript;base64,${Buffer.from(sharedBundle.outputFiles[0].text).toString('base64')}`
)
const {
  applyVoiceOverlay,
  buildShipFormCodeMap,
  createAbyssalNameResolver,
  isUntranslatedVoiceText,
  planVoiceCorrections,
} = shared

const readJson = (file, label) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} 不存在：${file}`)
    throw error
  }
}
const readPack = (id) => readJson(path.join(lodeDir, `${id}.json`), id)

const source = readJson(sourceFile, '深海台词译文源')
const wikiwiki = readPack('wikiwiki-abyss-voice')
const subtitleEnemies = readPack('subtitle-enemies')
const kcwikiVoice = readPack('kcwiki-voice')
const voiceOverlay = readPack('kuma-voice-zh')
const subtitleJa = readPack('subtitle-ja')
const subtitleZh = readPack('subtitle-zh')
const seasonalVoice = readPack('kcwiki-seasonal-voice')
const kcwikiShips = readPack('kcwiki-ships')
const localization = readPack('kcwiki-localization')

const clean = (value) => `${value ?? ''}`.trim()
const comparable = (value) =>
  clean(value)
    .normalize('NFKC')
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .toLowerCase()

const abyssEntities = localization.data?.entities?.abyssShip ?? {}
const localizationAbyssalShips = new Map(
  Object.entries(abyssEntities)
    .map(([id, entry]) => [Number(id), { api_id: Number(id), api_name: clean(entry?.ja) }])
    .filter(([id, ship]) => Number.isInteger(id) && id >= 1_500 && ship.api_name),
)
const masterSnapshotFile = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'kuma', 'snapshots', 'kcsapi_api_start2_getData.json')
  : null
const masterSnapshot =
  masterSnapshotFile && existsSync(masterSnapshotFile)
    ? readJson(masterSnapshotFile, '本机 api_start2 主数据快照')
    : null
const masterShips = Array.isArray(masterSnapshot?.body?.api_data?.api_mst_ship)
  ? masterSnapshot.body.api_data.api_mst_ship
  : []
const masterAbyssalShips = new Map(
  masterShips
    .map((ship) => [Number(ship?.api_id), ship])
    .filter(([id, ship]) => Number.isInteger(id) && id >= 1_500 && !ship?.api_sortno && clean(ship?.api_name)),
)
const abyssalShips = masterAbyssalShips.size ? masterAbyssalShips : localizationAbyssalShips
if (!masterAbyssalShips.size) {
  console.warn(
    `[abyss-voice] 警告：找不到可用的本机主数据快照 ${
      masterSnapshotFile ?? '%APPDATA%\\kuma\\snapshots\\kcsapi_api_start2_getData.json'
    }，深海舰名册退回 kcwiki-localization`,
  )
}
const localizedEntityId = (label) => {
  const target = comparable(label)
  if (!target) return null
  for (const [id, entry] of Object.entries(abyssEntities)) {
    if (comparable(entry?.ja) === target || comparable(entry?.zh) === target) return id
  }
  return null
}

// 与图鉴装配的 subtitle-enemies 归属链同口径：先认名，再按档名嵌号锚定并扩到连号形态。
const buildAbyssSubtitleByMst = (ships) => {
  const resolveAbyssalName = createAbyssalNameResolver(
    [...ships].map(([id, ship]) => ({ id, name: clean(ship?.api_name) })),
  )
  const subtitleByMst = new Map()
  for (const [key, raw] of Object.entries(subtitleEnemies.data ?? {})) {
    for (const line of Array.isArray(raw) ? raw : [raw]) {
      const fallbackId = resolveAbyssalName(clean(line?.name))
      const localizedId = Number(localizedEntityId(line?.name))
      const resolvedId =
        Number.isInteger(localizedId) && localizedId >= 1_500 ? localizedId : fallbackId
      const canonical = resolvedId ? ships.get(resolvedId)?.api_name : ''
      if (!canonical) continue
      const candidates = [...ships]
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
      for (const candidateId of exactIds) {
        const known = subtitleByMst.get(candidateId) ?? []
        const entry = { key, ja: clean(line?.jp), zh: clean(line?.zh) }
        if (!known.some((item) => item.key === key && item.ja === entry.ja)) known.push(entry)
        subtitleByMst.set(candidateId, known)
      }
    }
  }
  return subtitleByMst
}
const abyssSubtitleByMst = buildAbyssSubtitleByMst(abyssalShips)

const regularOverlay = applyVoiceOverlay(
  kcwikiVoice.data ?? {},
  voiceOverlay.data ?? null,
  'kcwiki-voice',
)
const seasonalOverlay = applyVoiceOverlay(
  seasonalVoice.data?.ships ?? {},
  voiceOverlay.data ?? null,
  'kcwiki-seasonal-voice',
)
const rowsByForm = planVoiceCorrections({
  voice: regularOverlay.data,
  subtitleJa: subtitleJa.data ?? null,
  subtitleZh: subtitleZh.data ?? null,
  seasonalShips: seasonalOverlay.data,
  codeMap: kcwikiShips.data ? buildShipFormCodeMap(kcwikiShips.data) : null,
}).rowsByForm
const claimedFormsOf = (subtitleByMst) =>
  new Set([
    ...subtitleByMst.keys(),
    ...[...rowsByForm]
      .filter(([, rows]) => rows.some((row) => row.fix !== 'reattributed'))
      .map(([mstId]) => mstId),
  ])
if (masterAbyssalShips.size) {
  const masterClaimed = claimedFormsOf(abyssSubtitleByMst)
  const localizationClaimed = claimedFormsOf(buildAbyssSubtitleByMst(localizationAbyssalShips))
  const masterOnly = [...masterClaimed].filter((id) => !localizationClaimed.has(id)).sort((a, b) => a - b)
  const localizationOnly = [...localizationClaimed]
    .filter((id) => !masterClaimed.has(id))
    .sort((a, b) => a - b)
  if (masterOnly.length || localizationOnly.length) {
    console.warn(
      `[abyss-voice] 主数据与 kcwiki-localization 算出的已认领形态不一致` +
        `\n  主数据独有：${masterOnly.join(', ') || '（空）'}` +
        `\n  localization 独有：${localizationOnly.join(', ') || '（空）'}`,
    )
  }
}

const allowedSourceKeys = new Set(['ja', 'zh', 'draft', 'note', 'skip'])
const translationByJa = new Map()
for (const [index, entry] of (source.byJa ?? []).entries()) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`byJa[${index}] 必须是对象`)
  }
  for (const key of Object.keys(entry)) {
    if (!allowedSourceKeys.has(key)) throw new Error(`byJa[${index}] 出现了不该有的字段 ${key}`)
  }
  const normalized = normalizeVoiceLine(entry.ja)
  if (!normalized) throw new Error(`byJa[${index}].ja 为空`)
  if (translationByJa.has(normalized)) {
    throw new Error(`byJa[${index}] 与前一条归一后同键：${entry.ja}`)
  }
  translationByJa.set(normalized, entry)
}

const excludedWikiRow = (line) =>
  line?.scene === 'CV' ||
  `${line?.ja ?? ''}`.startsWith('CV：') ||
  `${line?.ja ?? ''}`.includes('イラストレーター')
const hasWikiEditorNote = (line) => /\(表示される台詞は/.test(`${line?.ja ?? ''}`)
const selected = []
let excludedRows = 0
for (const [rawId, rawLines] of Object.entries(wikiwiki.data ?? {})) {
  const mstId = Number(rawId)
  if (abyssSubtitleByMst.get(mstId)?.length) continue
  if ((rowsByForm.get(mstId) ?? []).some((row) => row.fix !== 'reattributed')) continue
  const lines = []
  for (const line of rawLines ?? []) {
    if (excludedWikiRow(line)) {
      excludedRows += 1
      continue
    }
    lines.push(line)
  }
  if (lines.length) selected.push([mstId, lines])
}
selected.sort(([left], [right]) => left - right)

const selectedKeys = new Set()
for (const [, lines] of selected) {
  for (const line of lines) selectedKeys.add(normalizeVoiceLine(line.ja))
}
for (const [key, entry] of translationByJa) {
  if (!selectedKeys.has(key)) throw new Error(`译文源里的日文在选中包行里零命中：${entry.ja}`)
}
const upstreamZhKeys = new Set()
const rememberUpstreamZh = (ja, zh) => {
  const key = normalizeVoiceLine(ja)
  const value = clean(zh)
  if (key && value && !isUntranslatedVoiceText(value)) upstreamZhKeys.add(key)
}
for (const [mstId, lines] of Object.entries(regularOverlay.data)) {
  if (Number(mstId) < 1_500) continue
  for (const line of lines ?? []) rememberUpstreamZh(line.ja, line.zh)
}
for (const raw of Object.values(subtitleEnemies.data ?? {})) {
  for (const line of Array.isArray(raw) ? raw : [raw]) rememberUpstreamZh(line.jp, line.zh)
}
const translationWorkKeys = new Set(
  [...selectedKeys].filter((key) => !upstreamZhKeys.has(key)),
)

const ships = {}
let ambiguousRows = 0
let suffixlessRows = 0
let uniqueAudioKeys = 0
const translatedPages = new Set()
const translatedKeys = new Set()
for (const [mstId, lines] of selected) {
  const suffixCounts = new Map()
  for (const line of lines) {
    if (line.suffix === undefined) continue
    suffixCounts.set(line.suffix, (suffixCounts.get(line.suffix) ?? 0) + 1)
  }
  const suffixOrdinals = new Map()
  let suffixlessOrdinal = 0
  ships[`${mstId}`] = lines.map((line) => {
    const sourceEntry = translationByJa.get(normalizeVoiceLine(line.ja))
    const zh =
      sourceEntry?.skip === true || !clean(sourceEntry?.zh) ? '' : `${sourceEntry.zh}`
    const ambiguous =
      line.suffix !== undefined && (suffixCounts.get(line.suffix) ?? 0) > 1
    let key
    if (line.suffix === undefined) {
      suffixlessOrdinal += 1
      suffixlessRows += 1
      key = `${mstId}-s${suffixlessOrdinal}`
    } else {
      const ordinal = (suffixOrdinals.get(line.suffix) ?? 0) + 1
      suffixOrdinals.set(line.suffix, ordinal)
      key = `${mstId}-${line.suffix}${ambiguous ? `.${ordinal}` : ''}`
      if (ambiguous) ambiguousRows += 1
      else uniqueAudioKeys += 1
    }
    if (zh) {
      translatedKeys.add(normalizeVoiceLine(line.ja))
      if (line.page) translatedPages.add(line.page)
    }
    return {
      key,
      scene: `${line.scene ?? ''}`,
      ...(line.suffix === undefined ? {} : { suffix: line.suffix }),
      ja: `${line.ja ?? ''}`,
      zh,
      ...(ambiguous ? { ambiguous: true } : {}),
      ...(sourceEntry?.draft === true || hasWikiEditorNote(line) ? { draft: true } : {}),
    }
  })
}

const compiledAt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const translatedWorkCount = [...translatedKeys].filter((key) => translationWorkKeys.has(key)).length
const pack = {
  meta: {
    id: 'kuma-abyss-voice',
    name: '深海台词自补层（kuma 自行翻译）',
    version: compiledAt.replaceAll('-', '.'),
    source: 'kuma 自行翻译；日文底本参考 wikiwiki.jp/kancolle 深海舰页的セリフ表',
    fetchedAt: `${compiledAt}T00:00:00.000Z`,
    upstreamUpdatedAt: null,
    license: 'kuma 自行整理（第一方译文）',
    note: '补充上游两家未收录的深海舰台词 · kuma 自译 · 附日文原文',
    maintainerNote: [
      '2026-09-06 新建。发行版上 674 个深海形态没有台词来源；本层只收 subtitle-enemies 与 kcwiki-voice 都未认领、且日文底本有台词的形态',
      '日文列逐字取自底本。逐字转写的权利归游戏方，这一列与随包早就有的 kcwiki-voice.ja、整份 subtitle-ja 同源同性质、同样的灰度',
      '只补空：subtitle-enemies 依图鉴既有的认名、档名嵌号锚定与连号扩展判归属；kcwiki-voice 只把 planVoiceCorrections 后仍留在本形态、fix 不为 reattributed 的行算作已认领',
      '同一形态同一 suffix 有多行时全部标 ambiguous，不用于实时字幕；CV、以 CV：开头及含イラストレーター的资料行整行排除',
      `译文进度：已译 ${translatedWorkCount} 句，未译 ${translationWorkKeys.size - translatedWorkCount} 句，已覆盖 ${translatedPages.size} 个 wikiwiki 角色页`,
    ],
  },
  data: {
    schemaVersion: 1,
    compiledAt,
    ships,
  },
}

writeFileSync(outFile, `${JSON.stringify(pack, null, 1)}\n`, 'utf8')
const rowCount = Object.values(ships).reduce((total, lines) => total + lines.length, 0)
console.log(
  `已写出 ${path.relative(root, outFile)}：形态 ${Object.keys(ships).length} · 入包行 ${rowCount}` +
    ` · 排除 CV/绘师行 ${excludedRows} · ambiguous ${ambiguousRows}` +
    ` · 无 suffix ${suffixlessRows} · 唯一音轨键 ${uniqueAudioKeys}`,
)
