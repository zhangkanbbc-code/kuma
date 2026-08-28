// 全库音文对账：档案里的语音实物 → ASR 转写 → 与「所称日文」比对 → 出报告。
//
// **维护者侧脚本。产出是草稿层（asr-draft），权威低于人肉转写。**
// 机器判出来的「可疑」只是**耳测候选**，人裁过才算数——所以这里绝不自动写
// voice-playback-observations，只出报告，候选另立一节。
//
// 用法（先看 scripts/README.md 的「ASR 转写管线」一节，铁律写在那）：
//   node scripts/asr-audit.mjs --dry-run          只算条数/秒数/预算，一分钱不花
//   node scripts/asr-audit.mjs --one=445:1        只跑一条（形态:槽位），样张用
//   node scripts/asr-audit.mjs --limit=5          只跑前 5 条
//   node scripts/asr-audit.mjs                    全跑（已转写的读缓存，不重复花钱）
//   node scripts/asr-audit.mjs --model=fun-asr-flash-2026-06-15   换变体
//
// 断点可续：结果按 `sha1 + 模型 + 偏置词` 缓存在 APPDATA 侧（**不入仓库**），
// 重跑只补没跑过的。想强制重转写加 `--refresh`。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { biasTermsOf, loadArchiveRows, voiceArchiveDir } from './lib/asr-archive.mjs'
import {
  DEFAULT_MODEL,
  PRICE_PER_SECOND,
  runPool,
  transcribeWithRetry,
} from './lib/asr-client.mjs'
import { correctProperNouns, gradeOf, similarityOf } from './lib/asr-normalize.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const argOf = (name, fallback = null) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const eq = hit.indexOf('=')
  return eq === -1 ? true : hit.slice(eq + 1)
}

const CACHE_FILE = path.join(voiceArchiveDir(), '..', 'asr-cache.json')

/** 第一次跑时缓存文件本来就不存在——空缓存是正常状态，不是错误。 */
const loadCache = () => {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

const saveCache = (cache) => {
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8')
  } catch (error) {
    // 缓存写不进去只是下次要重花一次钱，不该让整轮对账失败
    console.warn('[asr] 缓存落盘失败，本轮结果不会被复用:', error?.message ?? error)
  }
}

/** 时长（秒）。ffprobe 有就用它，没有就按 mp3 平均码率粗估——**预算宁可估高**。 */
const durationOf = (file, bytes) => {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8', timeout: 15_000 },
    )
    const seconds = Number(`${out}`.trim())
    if (seconds > 0) return seconds
  } catch {
    // 没装 ffprobe 或探测失败：退回码率粗估
  }
  // 档案里的 mp3 实测 ~56kbps 单声道；估高一点不会让人少花钱，只会让预算保守
  return bytes > 0 ? bytes / 7000 : 0
}

const main = async () => {
  const dryRun = Boolean(argOf('dry-run'))
  const refresh = Boolean(argOf('refresh'))
  const model = `${argOf('model', DEFAULT_MODEL)}`
  const one = argOf('one')
  const limit = Number(argOf('limit', 0)) || 0
  const concurrency = Number(argOf('concurrency', 3)) || 3

  const rows = loadArchiveRows({ root: ROOT })
  if (!rows.length) {
    console.error(`语音档案是空的（找不到 ${voiceArchiveDir()}\\index.json 或里面没有条目）。`)
    process.exitCode = 1
    return
  }

  // ① 的料：有实物 + 该格有所称文本。两个条件缺一条都不进对账
  let auditable = rows.filter((r) => r.file && r.claimedJa)
  const noText = rows.filter((r) => r.file && !r.claimedJa)
  const noFile = rows.filter((r) => !r.file)

  if (one) {
    const [mst, slot] = `${one}`.split(':')
    auditable = auditable.filter(
      (r) => String(r.mstId) === mst && (!slot || String(r.slot) === slot),
    )
    if (!auditable.length) {
      console.error(`--one=${one} 没匹配到任何「有实物且有所称文本」的条目。`)
      process.exitCode = 1
      return
    }
  }
  if (limit > 0) auditable = auditable.slice(0, limit)

  for (const row of auditable) row.seconds = durationOf(row.file, row.bytes)
  const totalSeconds = auditable.reduce((sum, r) => sum + r.seconds, 0)
  // 计费按秒进位（服务端口径），预算按进位后的秒数算
  const billedSeconds = auditable.reduce((sum, r) => sum + Math.ceil(r.seconds), 0)
  const budget = billedSeconds * PRICE_PER_SECOND

  console.log(`档案条目 ${rows.length} 条：可对账 ${auditable.length}，` +
    `有实物但无所称文本 ${noText.length}（那是草稿转写的料），索引有记录但盘上无实物 ${noFile.length}`)
  console.log(`音频总时长 ${totalSeconds.toFixed(2)} 秒（计费进位 ${billedSeconds} 秒）`)
  console.log(`预算 ¥${budget.toFixed(5)}  单价 ¥${PRICE_PER_SECOND}/秒  模型 ${model}`)

  if (dryRun) {
    console.log('\n--dry-run：没有发出任何请求，没有花钱。')
    return
  }

  const cache = loadCache()
  let spentSeconds = 0
  let netFails = 0
  let rejected = 0

  const results = await runPool(
    auditable,
    async (row) => {
      const terms = biasTermsOf(row.mstId, { root: ROOT })
      const cacheKey = `${path.basename(row.file)}|${model}|${terms.join(',')}`
      if (!refresh && cache[cacheKey]) return { ...row, ...cache[cacheKey], cached: true }
      const started = Date.now()
      try {
        const out = await transcribeWithRetry(row.file, { model, biasTerms: terms })
        const elapsedMs = Date.now() - started
        const billed = out.seconds || Math.ceil(row.seconds)
        spentSeconds += billed
        const record = {
          asrRaw: out.text,
          billedSeconds: billed,
          elapsedMs,
          error: null,
        }
        cache[cacheKey] = record
        return { ...row, ...record, cached: false }
      } catch (error) {
        // 网络失败 ≠ 转写失败，分开记；两者都**不进缓存**（下次还要再试）
        if (error?.retryable) netFails++
        else rejected++
        return {
          ...row,
          asrRaw: null,
          billedSeconds: 0,
          elapsedMs: Date.now() - started,
          error: { kind: error?.retryable ? 'network' : 'rejected', message: `${error?.message ?? error}` },
          cached: false,
        }
      }
    },
    { concurrency },
  )
  saveCache(cache)

  // 评分 + 纠偏
  for (const row of results) {
    if (!row.asrRaw) {
      row.score = null
      row.grade = 'error'
      continue
    }
    const terms = biasTermsOf(row.mstId, { root: ROOT })
    const fixed = correctProperNouns(row.asrRaw, terms)
    row.asrFixed = fixed.text
    row.fixes = fixed.fixes
    row.unfixed = fixed.unfixed
    row.score = Number(similarityOf(row.asrFixed, row.claimedJa).toFixed(3))
    row.scoreRaw = Number(similarityOf(row.asrRaw, row.claimedJa).toFixed(3))
    row.grade = gradeOf(row.score)
  }

  const ordered = [...results].sort((a, b) => (a.score ?? -1) - (b.score ?? -1))
  const spent = spentSeconds * PRICE_PER_SECOND
  const byGrade = {}
  for (const r of ordered) byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1

  const reviewDir = path.join(ROOT, 'assets', 'review')
  mkdirSync(reviewDir, { recursive: true })
  writeFileSync(
    path.join(reviewDir, 'asr-audit.json'),
    JSON.stringify(
      {
        meta: {
          note: 'ASR 音文对账。**草稿层（asr-draft）**，权威低于人肉转写；高可疑条目是耳测候选，人裁过才算数。',
          model,
          generatedAt: new Date().toISOString(),
          pricePerSecond: PRICE_PER_SECOND,
          billedSeconds: spentSeconds,
          spentCny: Number(spent.toFixed(5)),
          source: 'asr-draft',
          counts: { audited: ordered.length, ...byGrade, netFails, rejected },
        },
        rows: ordered.map((r) => ({
          mstId: r.mstId, ship: r.shipName, slot: r.slot, scene: r.scene,
          claimedJa: r.claimedJa, asrRaw: r.asrRaw, asrFixed: r.asrFixed ?? null,
          score: r.score, scoreRaw: r.scoreRaw ?? null, grade: r.grade,
          fixes: r.fixes ?? [], unfixed: r.unfixed ?? [],
          seconds: Number((r.seconds ?? 0).toFixed(2)), error: r.error ?? null,
        })),
      },
      null,
      2,
    ),
    'utf8',
  )

  const lines = [
    '# ASR 音文对账（草稿层 asr-draft）',
    '',
    `模型 \`${model}\`｜条数 ${ordered.length}｜计费 ${spentSeconds} 秒｜花费 ¥${spent.toFixed(5)}`,
    `判级分布：${Object.entries(byGrade).map(([k, v]) => `${k} ${v}`).join('，') || '（无）'}`,
    '',
    '> 机器印证是**候选**，不是结论。高可疑条目请人耳复核后再决定是否进台账。',
    '',
    '| 形态 | 槽位 | 场合 | 所称日文 | ASR（纠偏后） | 相似度 | 判级 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...ordered.map((r) => {
      const cell = (s) => `${s ?? ''}`.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      return `| ${r.mstId} ${cell(r.shipName)} | ${r.slot ?? ''} | ${cell(r.scene)} | ${cell(r.claimedJa)} | ${cell(r.asrFixed ?? r.error?.message ?? '')} | ${r.score ?? '—'} | ${r.grade} |`
    }),
  ]
  writeFileSync(path.join(reviewDir, 'asr-audit.md'), `${lines.join('\n')}\n`, 'utf8')

  console.log(`\n完成：计费 ${spentSeconds} 秒，花费 ¥${spent.toFixed(5)}` +
    `（网络失败 ${netFails}，转写被拒 ${rejected}）`)
  console.log(`报告：assets/review/asr-audit.json / .md`)
  for (const r of ordered.slice(0, 5)) {
    if (!r.asrRaw) continue
    console.log(`\n[${r.grade} ${r.score}] ${r.mstId} ${r.shipName} 槽${r.slot} ${r.scene}`)
    console.log(`  所称: ${r.claimedJa}`)
    console.log(`  转写: ${r.asrFixed}`)
  }
}

main().catch((error) => {
  console.error('[asr] 对账失败:', error?.message ?? error)
  process.exitCode = 1
})
