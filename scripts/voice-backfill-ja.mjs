// 给两份入仓的台词包补上/校准 **`ja` 日文原文列**，就地改写。
//
//   node scripts/voice-backfill-ja.mjs          # 改写
//   node scripts/voice-backfill-ja.mjs --check  # 只检查，缺列/错配就非零退出
//
// ---- 为什么现在有这一列了 ----
// 2026-08-22 之前这两个包**只收中文**，那是把任务域的「日文原文不进分发物」口径
// 类推过来的。用户当天重算了法理：台词的逐字转写权利归 C2，而随包早就有
// `kcwiki-voice` 的 ja 列与整份 `subtitle-ja`——这一列与它们同级同灰度，不加深。
// 于是撤销那条类推，把日文补回来：台词卷本来就该是**日中对照**，只给中文是半张表。
//
// ---- 底本从哪来：零重抓 ----
//  · 自译包 `kanso-voice`：本机的 `wikiwiki-voice.json`（不随包，但一直在本机）。
//    配对判据与审稿单完全同一套——按 **(形态, 槽位, 同槽第几条)**，
//    因为包里的行本来就是照这个顺序从底本生成的。
//  · 季节包 `kcwiki-seasonal-voice`：`assets/review/kcwiki-seasonal-voice.audit.json`
//    （`lodes:fetch --seasonal-voice-audit` 留下的维护者侧材料）。按 **(档名, 季节)** 配；
//    本家那一季没有日文时，退到别的季列过的同一档名——同一个档名指的是同一句台词。
//
// ---- 错一行比缺一行糟 ----
// 这是**对照**功能：日中并排摆着，配错了就是把 A 的日文安在 B 的中文旁边，
// 而它看起来和配对的一模一样。所以：配不上的行**照实留空并计数**，绝不「就近取一条」。
// 上游本来就没有日文的行同样留空（2024 十一周年那几季的页只填了中文）。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lodeDir = path.join(root, 'assets', 'lodes')
const reviewDir = path.join(root, 'assets', 'review')
const check = process.argv.includes('--check')

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)
const SEP = ' ␟ '

/** 底本里这个形态的行：与编包时同一套去重（同槽同文只留一条），按槽位归拢。 */
const wikiwikiLinesOf = (wikiwiki, mstId) => {
  const seen = new Set()
  const bySlot = new Map()
  for (const line of wikiwiki[`${mstId}`] ?? []) {
    if (line?.voiceId == null) continue
    const dedup = `${line.voiceId}${SEP}${line.ja}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    bySlot.set(line.voiceId, [...(bySlot.get(line.voiceId) ?? []), line])
  }
  return bySlot
}

const backfillKanso = () => {
  const file = path.join(lodeDir, 'kanso-voice.json')
  const pack = readJson(file)
  const wikiwiki = readJson(path.join(lodeDir, 'wikiwiki-voice.json'))?.data
  if (!pack) return { id: 'kanso-voice', missing: '本机没有这个包' }
  if (!wikiwiki) {
    return {
      id: 'kanso-voice',
      missing:
        '本机没有 wikiwiki-voice.json（自译包的日文底本）。' +
        '跑一次 `npm run lodes:fetch -- --only=wikiwiki-voice` 再来',
    }
  }
  let changed = 0
  let filled = 0
  let blank = 0
  const blanks = []
  for (const [mstId, rows] of Object.entries(pack.data.ships)) {
    const bySlot = wikiwikiLinesOf(wikiwiki, Number(mstId))
    const used = new Map()
    for (const row of rows) {
      const index = used.get(row.slot) ?? 0
      used.set(row.slot, index + 1)
      const ja = `${(bySlot.get(row.slot) ?? [])[index]?.ja ?? ''}`
      if (ja) filled += 1
      else {
        blank += 1
        if (blanks.length < 5) blanks.push(`${mstId} ${row.key}`)
      }
      if (row.ja !== ja) {
        changed += 1
        row.ja = ja
      }
    }
  }
  if (changed && !check) writeFileSync(file, `${JSON.stringify(pack, null, 1)}\n`)
  return { id: 'kanso-voice', changed, filled, blank, blanks, file }
}

const backfillSeasonal = () => {
  const file = path.join(lodeDir, 'kcwiki-seasonal-voice.json')
  const pack = readJson(file)
  const audit = readJson(path.join(reviewDir, 'kcwiki-seasonal-voice.audit.json'))?.rows
  if (!pack) return { id: 'kcwiki-seasonal-voice', missing: '本机没有这个包' }
  if (!Array.isArray(audit)) {
    return {
      id: 'kcwiki-seasonal-voice',
      missing:
        '本机没有 assets/review/kcwiki-seasonal-voice.audit.json（季节包的日文底本）。' +
        '跑一次 `npm run lodes:fetch -- --only=kcwiki-seasonal-voice --seasonal-voice-audit` 再来',
    }
  }
  // 本家那一季优先；本家没有日文时退到别的季列过的同一档名（同档名 = 同一句台词）
  const byKeySeason = new Map()
  const jaByKey = new Map()
  for (const row of audit) {
    const composite = `${row.key}${SEP}${row.season}`
    if (!byKeySeason.has(composite)) byKeySeason.set(composite, row)
    if (row.ja && !jaByKey.has(row.key)) jaByKey.set(row.key, row.ja)
  }
  const jaOf = (key, season) =>
    `${byKeySeason.get(`${key}${SEP}${season}`)?.ja || jaByKey.get(key) || ''}`

  let changed = 0
  let filled = 0
  let blank = 0
  const blanks = []
  const note = (label) => {
    blank += 1
    if (blanks.length < 5) blanks.push(label)
  }
  for (const [mstId, rows] of Object.entries(pack.data.ships ?? {})) {
    for (const row of rows) {
      const ja = jaOf(row.key, row.season)
      if (ja) filled += 1
      else note(`${mstId} ${row.key} ${row.season}`)
      if (row.ja !== ja) {
        changed += 1
        row.ja = ja
      }
    }
  }
  for (const [key, skit] of Object.entries(pack.data.skits ?? {})) {
    const ja = jaOf(key, skit.season)
    if (ja) filled += 1
    else note(`skit ${key}`)
    if (skit.ja !== ja) {
      changed += 1
      skit.ja = ja
    }
  }
  if (changed && !check) writeFileSync(file, `${JSON.stringify(pack, null, 1)}\n`)
  return { id: 'kcwiki-seasonal-voice', changed, filled, blank, blanks, file }
}

let bad = 0
for (const result of [backfillKanso(), backfillSeasonal()]) {
  if (result.missing) {
    console.error(`[日文列] ${result.id}：${result.missing}`)
    bad += 1
    continue
  }
  const tail =
    `日文 ${result.filled} 行` +
    (result.blank ? ` · 上游确实没有日文的 ${result.blank} 行（照实留空）` : '')
  if (!result.changed) {
    console.log(`[日文列] ${result.id}：已就位 · ${tail}`)
  } else {
    console.log(`[日文列] ${result.id}：${check ? '与底本对不上' : '已写入'} ${result.changed} 行 · ${tail}`)
    if (check) bad += 1
  }
  for (const line of result.blanks) console.log(`           留空：${line}`)
}
if (bad) {
  if (check) console.error('\n[日文列] 跑 `node scripts/voice-backfill-ja.mjs` 就地补齐。')
  process.exit(1)
}
