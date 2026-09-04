// 台词自补层的**审稿单**：逐形态、逐行的「场合 | 日文 | 译文 | 状态」四列对照。
//
// ---- 为什么它只落 assets/review/ ----
// 日文原文本身 2026-08-22 起已经随包（`kanso-voice` 有 `ja` 列），所以这份材料不再是
// 「日文的唯一去处」；它留在 review 里的理由换成了**它是给人读的整理稿**：
// 逐形态分节、带抽检建议、带待复核清单与颜表情发放面，这些都不该塞进运行时的数据包。
// `assets/review/` 既在 .gitignore 里，也在打包排除清单里，两道都挡着。
//
// ---- 它是「重跑得出来」的，不是一次性产物 ----
// 日中两列都取自 `assets/lodes/kanso-voice.json`（入仓、随包）。改完包重跑一次，
// 审稿单就跟着新了。所以逐句订正的流程是：改包 → 重跑这个脚本 → 拿新审稿单再过一遍。
//
//   node scripts/voice-translate-review.mjs
//
// ---- 与底本的对账不在这里 ----
// 「包里的 ja 是不是与本机底本 `wikiwiki-voice` 逐行对得上」由
// `test/voice-attribution.test.mjs` 独立跑一遍——**配错的样子和配对的一模一样**，
// 只有比对底本才看得出来，那属于护栏该管的事。这份材料只负责把包里的两列摆出来给人读。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { VOICE_EMOTICON_PERSONA, VOICE_TRANSLATE_NOTES } from './lib/voice-translate-notes.mjs'
import { normalizeVoiceLine } from '../src/shared/voice-lineage.ts'
import { isUntranslatedVoiceText } from '../src/shared/voice-text.ts'

/** 颜表情的译注一律以这个词开头（`voice-translate-notes` 里生成时钉死的口径）。 */
const EMOTICON_NOTE_PREFIX = '颜表情：'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lodeDir = path.join(root, 'assets', 'lodes')
const reviewDir = path.join(root, 'assets', 'review')

const readPack = (id, required) => {
  const file = path.join(lodeDir, `${id}.json`)
  if (!existsSync(file)) {
    if (required) throw new Error(`找不到 assets/lodes/${id}.json——审稿单就是照着它生成的。`)
    return {}
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const kansoPack = readPack('kanso-voice', true)
const kanso = kansoPack.data?.ships ?? {}
const overlayPack = readPack('kanso-voice-zh', true)
const overlay = overlayPack.data ?? {}
const regularPack = readPack('kcwiki-voice', true)
const seasonalPack = readPack('kcwiki-seasonal-voice', true)
const localization = readPack('kcwiki-localization', false).data?.entities?.ship ?? {}
const shipName = (mstId) => localization?.[`${mstId}`]?.zh || `#${mstId}`

const escapeCell = (value) =>
  `${value ?? ''}`.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ').trim()

const forms = Object.keys(kanso)
  .map(Number)
  .sort((left, right) => left - right)

/**
 * 这个形态属于哪一个角色（底本的一页 = 一个角色的全部形态）。
 * 反查表直接从人设表自己的 `forms` 建——这样审稿单只靠「随包的自译包 + 那张表」就能生成，
 * 不依赖不随包的底本。
 */
const pageByForm = new Map()
for (const [page, entry] of Object.entries(VOICE_EMOTICON_PERSONA)) {
  for (const formId of entry.forms ?? []) pageByForm.set(formId, page)
}
const pageOf = (mstId) => pageByForm.get(Number(mstId)) ?? ''

let totalRows = 0
let draftRows = 0
let unmatched = 0
let emoticonRows = 0
const sections = []
const draftIndex = []
const personaRoster = []

for (const mstId of forms) {
  const rows = kanso[`${mstId}`] ?? []
  const lines = []
  let emoticonHere = 0
  for (const row of rows) {
    totalRows += 1
    // 日文直接取包里的那一列（2026-08-22 起它就住在包里）。
    // 它与底本对不对得上是护栏的事，不是这份材料的事——见文件头。
    const ja = `${row.ja ?? ''}`
    if (!ja) unmatched += 1
    const flags = []
    if (row.draft) {
      draftRows += 1
      flags.push('**待复核**')
      const note = VOICE_TRANSLATE_NOTES[row.key]
      if (note) flags.push(note)
      if (note?.startsWith(EMOTICON_NOTE_PREFIX)) {
        emoticonHere += 1
        emoticonRows += 1
      }
      draftIndex.push({ mstId, row, note: note ?? '' })
    }
    if (row.basis === 'ambiguous') flags.push('同槽多候选 · 不给播放钮')
    if (row.basis === 'divergent') flags.push('与音轨对不上 · 不给播放钮')
    if (!ja) flags.push('⚠ 上游没有日文原文')
    lines.push(
      `| ${escapeCell(row.scene)} | ${escapeCell(ja)} | ${escapeCell(row.zh)} | ${
        escapeCell(flags.join('；')) || '—'
      } |`,
    )
  }
  const persona = VOICE_EMOTICON_PERSONA[pageOf(mstId)]
  const personaLabel = persona?.persona ?? '未定性'
  const emoticonLabel = emoticonHere
    ? `启用 ${emoticonHere} 处`
    : persona?.enabled
      ? '本形态 0 处（人设可发放，但没有合适的句子）'
      : '未启用（人设）'
  personaRoster.push({ mstId, personaLabel, emoticonLabel, count: emoticonHere })
  sections.push(
    [
      `### ${shipName(mstId)} · \`${mstId}\`（${rows.length} 条）`,
      '',
      `人设：${personaLabel} · 颜表情：${emoticonLabel}`,
      '',
      '| 场合 | 日文原文 | 中文译文 | 状态 |',
      '|---|---|---|---|',
      ...lines,
      '',
    ].join('\n'),
  )
}

const head = [
  '# 台词自补层 · 审稿单',
  '',
  '> **这份文件只在维护者本机存在**：不入仓、不随分发物。',
  '> 它是给人读的整理稿——日中两列都取自随包的 `kanso-voice`，另加抽检建议、待复核清单、',
  '> 颜表情发放面。日文原文本身 2026-08-22 起已随包（包里有 `ja` 列）。',
  '> 由 `node scripts/voice-translate-review.mjs` 生成，改完包重跑一次即可刷新。',
  '',
  `- 包版本：\`${kansoPack.meta?.version ?? '?'}\`（编译于 ${kansoPack.data?.compiledAt ?? '?'}）`,
  `- 覆盖形态：**${forms.length}**；译文行：**${totalRows}**`,
  `- 待复核（\`draft\`）：**${draftRows}** 行，占 ${((draftRows / Math.max(1, totalRows)) * 100).toFixed(1)}%`,
  `- 没有日文原文的行：**${unmatched}**${unmatched ? '（上游那一页只填了中文；照实留空，不据中文回译）' : ''}`,
  `- 颜表情：**${emoticonRows}** 行，分布在 ${
    new Set(personaRoster.filter((entry) => entry.count).map((entry) => entry.mstId)).size
  } 个形态；发放面见下方「颜表情发放面」`,
  '',
  '## 怎么抽检',
  '',
  '1. **先看下面那张「待复核」清单**——那是译者自己拿不准的行，问题密度最高；',
  '   加了颜表情的行也在里面（表情是从文本推断的语气，我们听不到音频）。',
  '2. 再挑几个自己熟的角色，整节读一遍：看**语癖**在不在（口头禅、自称、腔调），',
  '   看**场合**对不对得上（时报的点数、入渠/补给/编成这些固定戏份）。',
  '3. 哪一句不顺口，把「形态 + 场合」丢回来即可——包里逐行独立，改一句不动别的。',
  '',
  '## 标点体例（两条，机器保证）',
  '',
  '> ① **行尾不写句号**（`？！～` 保留，行内分句的句号也保留，只删最末那一个）；',
  '> ② **`……。` 是病句**——中文语境里省略号与句号同级，任何位置见一个改一个。',
  '>',
  '> 这两条由 `src/shared/voice-text.ts` 逐行强制：包落盘前过一道、显示时再过一道，',
  '> 护栏 `test/voice-text.test.mjs` 盯着包里不许有不合体例的行。',
  '> 手工改完包跑 `npm run voice:punct` 就地归一，再跑 `npm run voice:review` 刷新本表。',
  '',
  '## 颜表情发放面（单位是角色，不是句子）',
  '',
  '> 严肃军人系 / 威严大姐系 / 冷淡系一律零发放，哪怕某句情绪再强；',
  '> 元气系 / 撒娇系 / 小动物系才逐句判断，且只点一两处。平叙句、严肃句、时报报时一律不加。',
  '',
  '| 形态 | 人设 | 颜表情 |',
  '|---|---|---|',
  ...personaRoster.map(
    (entry) =>
      `| ${escapeCell(shipName(entry.mstId))} | ${escapeCell(entry.personaLabel)} | ${escapeCell(
        entry.emoticonLabel,
      )} |`,
  ),
  '',
  '## 待复核清单（译者自己标的）',
  '',
  '| 形态 | 场合 | 译文 | 为什么标 |',
  '|---|---|---|---|',
  ...draftIndex.map(
    (entry) =>
      `| ${escapeCell(shipName(entry.mstId))} | ${escapeCell(entry.row.scene)} | ${escapeCell(
        entry.row.zh,
      )} | ${escapeCell(entry.note) || '—'} |`,
  ),
  '',
  '## 逐形态对照',
  '',
]

const sourceRows = new Map()
for (const [pack, groups] of [
  ['kcwiki-voice', regularPack.data ?? {}],
  ['kcwiki-seasonal-voice', seasonalPack.data?.ships ?? {}],
]) {
  for (const [mstId, rows] of Object.entries(groups)) {
    for (const row of rows ?? []) {
      if (overlay.entries?.[row.key]?.pack === pack) sourceRows.set(row.key, { mstId, pack, row })
    }
  }
}

const retiredKeys = new Set()
const mismatchedKeys = new Set()
for (const [key, entry] of Object.entries(overlay.entries ?? {})) {
  const source = sourceRows.get(key)
  if (!source) continue
  if (normalizeVoiceLine(source.row.ja) !== normalizeVoiceLine(entry.ja)) {
    mismatchedKeys.add(key)
  } else if (!isUntranslatedVoiceText(source.row.zh)) {
    retiredKeys.add(key)
  }
}

const overlayByShip = new Map()
for (const [key, entry] of Object.entries(overlay.entries ?? {})) {
  const sourceRow = sourceRows.get(key)
  if (!sourceRow) continue
  const list = overlayByShip.get(sourceRow.mstId) ?? []
  list.push({ key, entry, ...sourceRow })
  overlayByShip.set(sourceRow.mstId, list)
}

const overlayShipSections = [...overlayByShip]
  .sort(
    ([leftId, left], [rightId, right]) =>
      Number(right.some((item) => item.entry.draft)) -
        Number(left.some((item) => item.entry.draft)) ||
      Number(leftId) - Number(rightId),
  )
  .map(([mstId, rows]) => {
    rows.sort(
      (left, right) =>
        Number(Boolean(right.entry.draft)) - Number(Boolean(left.entry.draft)) ||
        left.key.localeCompare(right.key),
    )
    return [
      `### ${shipName(mstId)} · \`${mstId}\`（${rows.length} 条）`,
      '',
      '| 场合 | 日文原文 | 中文译文 | 状态 |',
      '|---|---|---|---|',
      ...rows.map(({ key, entry, row }) => {
        const flags = []
        if (entry.draft) {
          flags.push('**待复核**')
          const note = VOICE_TRANSLATE_NOTES[key]
          if (note) flags.push(note)
        }
        if (retiredKeys.has(key)) flags.push('**上游已补，可删**')
        if (mismatchedKeys.has(key)) flags.push('**上游日文已变，未叠加**')
        return `| ${escapeCell(row.scene || key)} | ${escapeCell(entry.ja)} | ${escapeCell(entry.zh)} | ${escapeCell(flags.join('；')) || '可用'} |`
      }),
      '',
    ].join('\n')
  })

const byJaRows = overlay.byJa ?? []
const retiredRows = [...retiredKeys]
  .map((key) => {
    const source = sourceRows.get(key)
    return source ? { key, ...source } : null
  })
  .filter(Boolean)
  .sort((left, right) => left.key.localeCompare(right.key))

const overlaySections = [
  '## 译文自补层',
  '',
  `- keyed 译文：**${Object.keys(overlay.entries ?? {}).length}**；按日文匹配的字幕译文：**${byJaRows.length}**`,
  `- 待复核（\`draft\`）：**${Object.values(overlay.entries ?? {}).filter((entry) => entry?.draft).length}**`,
  `- 上游已补、可删：**${retiredRows.length}**`,
  '',
  ...overlayShipSections,
  '### 按日文匹配的字幕译文',
  '',
  '| 日文原文 | 中文译文 | 状态 |',
  '|---|---|---|',
  ...byJaRows.map(
    (entry) => `| ${escapeCell(entry.ja)} | ${escapeCell(entry.zh)} | 可用 |`,
  ),
  '',
  '### 上游已补、可删',
  '',
  ...(retiredRows.length
    ? [
        '| 包 | key | 日文原文 | 上游译文 |',
        '|---|---|---|---|',
        ...retiredRows.map(
          ({ key, pack, row }) =>
            `| ${escapeCell(pack)} | \`${escapeCell(key)}\` | ${escapeCell(row.ja)} | ${escapeCell(row.zh)} |`,
        ),
      ]
    : ['（无）']),
  '',
]

mkdirSync(reviewDir, { recursive: true })
const outFile = path.join(reviewDir, 'voice-translate-review.md')
writeFileSync(outFile, [...head, ...sections, ...overlaySections].join('\n'))
console.log(
  `[review] 审稿单已写出：${path.relative(root, outFile)}` +
    `（${forms.length} 形态 / ${totalRows} 行 / 待复核 ${draftRows} 行` +
    `${unmatched ? ` / 无日文原文 ${unmatched} 行` : ''}` +
    ` / 译文 overlay ${Object.keys(overlay.entries ?? {}).length} + ${byJaRows.length} 行` +
    ` / 可删 ${retiredRows.length} 行）`,
)
