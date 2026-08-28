// 台词中文译文的**标点体例归一**，就地改写两份入仓的包。
//
//   node scripts/voice-normalize-packs.mjs          # 改写
//   node scripts/voice-normalize-packs.mjs --check  # 只检查，不合体例就非零退出
//
// 体例两条（判据与理由在 src/shared/voice-text.ts 的文件头）：
//   ① 行尾句号一律不写；② `……。` 是病句，任何位置都修。
//
// ---- 为什么要有这个脚本，而不是一次 sed 了事 ----
// 一次 sed 只治当下这些行。自译包是**手工维护**的（逐句订正直接改包文件），
// 季节台词包会被 `lodes:fetch` 整份重抓——两边都会有新行进来，而新行是人写/机器抓的，
// 不会自己记得这条体例。所以规则做成一个函数：
//   · 落盘前跑（季节包的抓取器在 buildSeasonalVoicePack 里就调了它）；
//   · 手工改完包跑这个脚本；
//   · 护栏跑 `--check` 同一条路——三处共用一份判据，不会漂。
//
// kcwiki-voice 与 subtitle-zh **不在这里改**：它们是上游转写包，用户会整份重抓，
// 改文件等于把改动冲掉。那两层在**显示期**过同一个函数（renderer/modules/ji.ts）。

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeVoiceText } from '../src/shared/voice-text.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lodeDir = path.join(root, 'assets', 'lodes')
const check = process.argv.includes('--check')

/** 把 `pack.data` 里所有中文译文过一遍归一，返回改动条数。 */
const normalizePack = (id, walk) => {
  const file = path.join(lodeDir, `${id}.json`)
  let pack
  try {
    pack = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { id, missing: true, changed: 0 }
    throw error
  }
  let changed = 0
  const offenders = []
  walk(pack.data, (row, field) => {
    const before = `${row[field] ?? ''}`
    if (!before) return
    const after = normalizeVoiceText(before)
    if (after === before) return
    changed += 1
    if (offenders.length < 5) offenders.push(`${before.slice(-28)}  →  ${after.slice(-28)}`)
    row[field] = after
  })
  if (changed && !check) writeFileSync(file, `${JSON.stringify(pack, null, 1)}\n`)
  return { id, changed, offenders }
}

const results = [
  normalizePack('kanso-voice', (data, visit) => {
    for (const rows of Object.values(data?.ships ?? {})) for (const row of rows) visit(row, 'zh')
  }),
  normalizePack('kcwiki-seasonal-voice', (data, visit) => {
    for (const rows of Object.values(data?.ships ?? {})) for (const row of rows) visit(row, 'zh')
    for (const skit of Object.values(data?.skits ?? {})) visit(skit, 'zh')
  }),
]

let bad = 0
for (const result of results) {
  if (result.missing) {
    console.log(`[标点] ${result.id}：本机没有这个包，跳过`)
    continue
  }
  if (!result.changed) {
    console.log(`[标点] ${result.id}：已合体例`)
    continue
  }
  bad += result.changed
  console.log(`[标点] ${result.id}：${check ? '不合体例' : '已改写'} ${result.changed} 行`)
  for (const line of result.offenders) console.log(`         ${line}`)
}
if (check && bad) {
  console.error(
    `\n[标点] 共 ${bad} 行不合体例。跑 \`node scripts/voice-normalize-packs.mjs\` 就地改写。`,
  )
  process.exit(1)
}
