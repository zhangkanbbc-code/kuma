// 装备加成的**多源取票**：只给对账里真吵起来的那几件装备，逐件去另外两处拿票。
//
//   node scripts/fit-bonus-votes.mjs            # 读上一轮对账报告里的待裁清单
//   node scripts/fit-bonus-votes.mjs 317 505    # 只给指定装备取票
//
// 为什么不是「换一个更好的源」而是「取票」：用户 2026-08-22 定的口径——
// fit-bonus 走**多源汇编**，kcwiki 只是基座票，不是真理源。同一件装备的加成口径在
// kcwiki / wikiwiki / 明石的改修工坊之间确实会打架，所以歧义处要摆出各家的原话再裁。
//
// 可靠性阶梯（spec 的社区共识，从高到低）：
//   装备后舰娘的最终面板（账本一手实测）
//     > 日文侧近期验证（wikiwiki / akashi，两者取更新日期近的）
//     > kcwiki
//     > EO（FitBonuses.json 自 2025-03-01 起停更）
// 新鲜度是论据的一部分，所以每票都记页面的最后更新日期（取得到的话）。
//
// 许可：wikiwiki 与 akashi-list.me 都**没有**允许再分发的声明。本脚本只在维护者
// 显式运行时抓，页面缓存落系统临时目录，产出物只有一份人读的票据报告
//（assets/review/，已 gitignore）。**这两处的数据一行都不进随包产物。**

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAkashiFit } from './akashi-fit-parser.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const cacheDir = path.join(os.tmpdir(), 'kanso-fit-bonus-votes')
mkdirSync(cacheDir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// wikiwiki 原站限流很敏感（本项目实测：1.2s 间隔会全程 429）。沿用 fetch-lodes 里
// 那套节奏：起步 10.5s/页，吃到 429 就翻倍并遵循 Retry-After。
let wikiPace = 10_500
let wikiLastAt = 0
const fetchWikiwiki = async (title) => {
  const cache = path.join(cacheDir, `ww-${Buffer.from(title).toString('base64url')}.html`)
  if (existsSync(cache)) return readFileSync(cache, 'utf8')
  for (let attempt = 0; attempt < 4; attempt++) {
    const due = wikiLastAt + wikiPace - Date.now()
    if (due > 0) await sleep(due)
    wikiLastAt = Date.now()
    const response = await fetch(`https://wikiwiki.jp/kancolle/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': 'kanso-lodes' },
    })
    if (response.status === 429) {
      wikiPace = Math.min(180_000, wikiPace * 2)
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
      await sleep(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0, 60_000 * (attempt + 1)))
      continue
    }
    if (response.status === 404) {
      writeFileSync(cache, '')
      return ''
    }
    if (!response.ok) throw new Error(`wikiwiki ${title}: HTTP ${response.status}`)
    const html = await response.text()
    writeFileSync(cache, html)
    return html
  }
  throw new Error(`wikiwiki 连续限流，停在「${title}」——已抓到的页面留在 ${cacheDir}，重跑会续传`)
}

let akashiLastAt = 0
const fetchAkashi = async (equipId) => {
  const cache = path.join(cacheDir, `akashi-w${equipId}.html`)
  if (existsSync(cache)) return readFileSync(cache, 'utf8')
  const due = akashiLastAt + 400 - Date.now()
  if (due > 0) await sleep(due)
  akashiLastAt = Date.now()
  const response = await fetch(`https://akashi-list.me/detail/w${equipId}.html`, {
    headers: { 'User-Agent': 'kanso-lodes' },
  })
  if (!response.ok) {
    writeFileSync(cache, '')
    return ''
  }
  const html = await response.text()
  writeFileSync(cache, html)
  return html
}

const plainText = (html) =>
  `${html}`
    .replace(/<[^>]+>/g, '|')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\|+/g, '|')
    .replace(/[ \t]+/g, ' ')
    .trim()

/**
 * wikiwiki 装备页里「装備ボーナス」那一段的原文（只截到下一节标题为止）。
 *
 * 认的是**小节标题**「装備ボーナスについて」，不是页面里第一次出现「装備ボーナス」
 * ——正文往往先在「入手方法」那段提一句（505 号实测就撞上了），按首次出现截会取到
 * 一段跟数值毫无关系的入手说明。
 */
const wikiwikiBonusSection = (html) => {
  const at = html.indexOf('装備ボーナスについて')
  if (at < 0) return null
  const window = html.slice(at, at + 14_000)
  const text = plainText(window)
  const stop = ['対地特効補正について', '運用について', 'ゲームにおいて', '小ネタ', 'この装備についてのコメント']
  let cut = text.length
  for (const marker of stop) {
    const index = text.indexOf(marker)
    if (index > 200 && index < cut) cut = index
  }
  return text.slice(0, cut).trim()
}

const wikiwikiLastModified = (html) => {
  const match = `${html ?? ''}`.match(/Last-modified:\s*(\d{4})-(\d{2})-(\d{2})/i)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

const main = async () => {
  const packFile = path.join(root, 'assets', 'lodes', 'kcwiki-fit-bonus.json')
  const reportFile = path.join(root, 'assets', 'review', 'fit-bonus-reconcile.json')
  if (!existsSync(reportFile)) {
    throw new Error('先跑 node scripts/fit-bonus-reconcile.mjs 生成待裁清单，再来取票')
  }
  const ours = JSON.parse(readFileSync(packFile, 'utf8')).data
  const report = JSON.parse(readFileSync(reportFile, 'utf8'))
  const picked = process.argv.slice(2).map(Number).filter((id) => id > 0)
  const targets = picked.length
    ? picked.map((equipId) => ({ equipId, cells: 0 }))
    : report.pending
  console.log(`[votes] 待取票装备 ${targets.length} 件（wikiwiki 按 10.5s/页，慢是故意的）`)

  const votes = []
  for (const [index, target] of targets.entries()) {
    const equipId = target.equipId
    const entry = ours.equips[`${equipId}`]
    const nameJa = entry?.nameJa ?? `${equipId}`
    let wiki = null
    let wikiDate = null
    try {
      const html = await fetchWikiwiki(nameJa)
      wiki = html ? wikiwikiBonusSection(html) : null
      wikiDate = html ? wikiwikiLastModified(html) : null
    } catch (error) {
      wiki = `（取页失败：${error.message}）`
    }
    let akashi = null
    try {
      const html = await fetchAkashi(equipId)
      akashi = html ? parseAkashiFit(html) : null
    } catch (error) {
      akashi = [{ targets: ['(取页失败)'], gains: [error.message] }]
    }
    votes.push({
      equipId,
      nameJa,
      nameZh: entry?.nameZh ?? '',
      conflictCells: target.cells ?? 0,
      kcwikiRules: entry?.rules ?? [],
      eoSample: report.conflicts.filter((row) => row.equipId === equipId).slice(0, 6),
      wikiwiki: { updatedAt: wikiDate, bonusText: wiki },
      akashi,
    })
    process.stdout.write(
      `\r[votes] ${index + 1}/${targets.length} #${equipId} ${nameJa}` +
        `（wikiwiki ${wiki ? '有' : '无'} / akashi ${akashi ? '有' : '无'}）          `,
    )
  }
  process.stdout.write('\n')

  const output = path.join(root, 'assets', 'review', 'fit-bonus-votes.json')
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), votes }, null, 1))
  const withWiki = votes.filter((vote) => vote.wikiwiki.bonusText).length
  const withAkashi = votes.filter((vote) => Array.isArray(vote.akashi) && vote.akashi.length).length
  console.log(
    `[votes] 取到 wikiwiki 票 ${withWiki}/${votes.length} · akashi 票 ${withAkashi}/${votes.length} → ${output}`,
  )
}

await main()
