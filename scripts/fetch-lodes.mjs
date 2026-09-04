// 矿脉抓取器：按 lode-sources.json 清单下载社区数据，包装成带来源与
// 日期的标准包写入 assets/lodes/。显式运行（npm run lodes:fetch），绝不自动联网。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseDevRecipes } from './dev-recipes.mjs'
import { parseBuildRecipes } from './build-recipes.mjs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fetchMapIntel,
  jstDate,
  loadNormalMapLast,
  preserveEventMaps,
  preserveLimitedHistory,
} from './map-intel.mjs'
import {
  assertNoPendingMapIntelCandidate,
  stageMapIntelCandidate,
} from './map-intel-review.mjs'
import { fetchLocalization } from './localization.mjs'
import { abyssVoiceMstIdFromKey } from './lib/kcwiki-voice.mjs'
import {
  buildSeasonalVoicePack,
  buildShipFormCodeMap,
  parseSeasonPageTitle,
  parseSeasonalVoicePage,
} from './lib/kcwiki-seasonal-voice.mjs'
import { isKcwikiEntryKey, parseLuaTable } from './lib/kcwiki-lua.mjs'
import { parseKcwikiBgmList } from './lib/kcwiki-bgm.mjs'
import { QUEST_PAGE_TITLES, parseKcwikiQuestPages } from './lib/kcwiki-quests-scn.mjs'
import { loadStart2MasterArray as loadStart2Table } from './lib/start2.mjs'
import { parseKcwikiQuestRequirements } from './lib/kcwiki-quest-req.mjs'
import { parsePoiQuestGoalCson } from './lib/poi-quest-goal.mjs'
import { loadKcnavRoutingExport } from './lib/kcnav-routing.mjs'
import { parseRoutingHtml } from './lib/kcwiki-routing.mjs'
import { writeLodeReconciliation } from './lib/lode-reconcile.mjs'
import { buildEventBonusPack } from './lib/event-bonus.mjs'
import { buildFitBonusPack } from './lib/kcwiki-fit-bonus.mjs'
import { fetchKcwikiMapPages, fetchKcwikiPageContentDate } from './lib/kcwiki-map.mjs'
import {
  buildMapEnemyComps,
  loadLedgerCompVotes,
  mapEnemyCompConflictFingerprint,
} from './lib/map-enemy-comps.mjs'
import {
  buildMapDrops,
  correctLegacyDropForm,
  loadLedgerDropVotes,
  mapDropConflictFingerprint,
  staleMapDropVerdicts,
} from './lib/map-drops.mjs'
import { buildShipStats, loadMasterShips } from './lib/ship-stats.mjs'
import { createFitBonusNameResolver } from './lib/fit-bonus-vocab.mjs'
import { foldCjkVariants } from '../src/shared/cjk-fold.ts'
import { parseWikiwikiExpeditionPage } from './lib/wikiwiki-expedition.mjs'
import { fetchWikiwikiRouting } from './lib/wikiwiki-routing.mjs'
import {
  parseWikiwikiRemodelIndex,
  parseWikiwikiRemodelPage,
  parseWikiwikiReturnEdges,
} from './lib/wikiwiki-remodel.mjs'
import { parseWikiwikiShipMaxTable, parseWikiwikiShipPageStats } from './lib/wikiwiki-ship-max.mjs'
import { parseKaishuHtml } from './lib/wikiwiki-kaishu.mjs'
import { buildItemNameIndex, parseShipProfilePage } from './lib/wikiwiki-ship-profile.mjs'
import {
  normalizeWikiwikiShipName,
  parseWikiwikiAbyssVoicePage,
  parseWikiwikiVoicePage,
} from './lib/wikiwiki-voice.mjs'
import { parseWikiwikiQuestPage } from './lib/wikiwiki-quests.mjs'
import { parseItemExchangePage } from './lib/wikiwiki-item-exchange.mjs'
import { normalizeJpName, reconcileQuestPre } from './lib/quest-pre-reconcile.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const OUT_DIR = path.join(root, 'assets', 'lodes')
// 当前主数据里 2350 起是 2026 夏活动的新深海形态；公开只读镜像尚未同步这一段，
// 所以这些及后续 ID 必须回原站核对。未来新增 ID 会自然落在同一分支。
const CURRENT_ABYSS_ORIGINAL_FROM = 2_350

const sources = JSON.parse(readFileSync(path.join(root, 'scripts', process.env.LODE_SRC ?? 'lode-sources.json'), 'utf8'))

mkdirSync(OUT_DIR, { recursive: true })

// raw.githubusercontent URL → 上游该文件最后一次 commit 时间（真正的「多新」）
const upstreamUpdatedAt = async (url) => {
  const m = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/)
  if (!m) return null
  const [, owner, repo, ref, file] = m
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(file)}&sha=${ref}&per_page=1`,
      { headers: { 'User-Agent': 'kanso-lodes' } },
    )
    if (!res.ok) return null
    const commits = await res.json()
    return commits?.[0]?.commit?.committer?.date ?? null
  } catch (_e) {
    return null
  }
}

// ---- wikitext 清洗层（kcwiki 远征列表）----
// 渲染层永远只消费干净 JSON；清洗只在显式抓取时发生。

const stripWiki = (s) =>
  `${s ?? ''}`
    .replace(/<ref>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{red\|([\s\S]*?)\}\}/g, '$1')
    .replace(/\{\{([^|{}]+)\}\}/g, '$1') // {{开发资材}} → 开发资材
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()

// 提取 {{name|...}} 模板调用（嵌套花括号安全）
// 名字与首个 | 之间允许空白/换行：远征表写成 {{远征表|…}}，
// 而台词表写成 {{台词翻译表\n |档名=…}}——不放宽就一条都匹配不到。
const templateCalls = (text, name) => {
  const out = []
  const re = new RegExp(`\\{\\{\\s*${name}\\s*\\|`, 'g')
  let m
  while ((m = re.exec(text))) {
    let depth = 0
    let i = m.index
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++
        i++
      } else if (text[i] === '}' && text[i + 1] === '}') {
        depth--
        i++
        if (depth === 0) break
      }
    }
    out.push(text.slice(m.index + 2, i - 1))
  }
  return out
}

// 顶层 | 分割（不切开嵌套模板内部的 |）
const splitParams = (inner) => {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      cur += two
      i++
    } else if (two === '}}' || two === ']]') {
      depth--
      cur += two
      i++
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += inner[i]
    }
  }
  parts.push(cur)
  const params = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).trim()] = p.slice(eq + 1).trim()
  }
  return params
}

const parseResPair = (raw) => {
  const s = stripWiki(raw)
  const m = s.match(/(\d+)\s*\/\s*(\d+)/)
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)]
  const single = s.match(/^(\d+)$/)
  return single ? [parseInt(single[1], 10), null] : null
}

const parseItems = (raw) => {
  const s = stripWiki(raw)
  return [...s.matchAll(/([^\s、,，x]+)x(\d+)/g)].map((m) => ({ name: m[1], count: parseInt(m[2], 10) }))
}

const parseKcwikiExpedition = (text) => {
  const entries = {}
  for (const inner of templateCalls(text, '远征需求表')) {
    const p = splitParams(inner)
    const idLines = stripWiki(p['编号'] ?? '').split('\n')
    const id = idLines[0]?.trim()
    if (!id) continue
    // 必要舰娘/输送桶 两列都可能夹带「大成功要…」备注，抽出来单放
    const reqLines = stripWiki(p['必要舰娘'] ?? '').split('\n')
    const escortLines = stripWiki(p['输送桶'] ?? '').split('\n')
    const greatNote = [...reqLines, ...escortLines].filter((l) => l.includes('大成功')).join('；')
    const composition = reqLines.filter((l) => l && !l.includes('大成功')).join('\n')
    const escortText = escortLines.filter((l) => l && !l.includes('大成功')).join('\n')
    // 属性要求（总火力≥360 之类）与鼓桶要求
    const stats = {}
    for (const m of escortText.matchAll(/(?:总|舰队合计)?(火力|对空|对潜|索敌)\s*[≥>=]+\s*(\d+)/g)) {
      stats[m[1]] = parseInt(m[2], 10)
    }
    const drumTotal = escortText.match(/(\d+)\s*个?桶/)?.[1]
    const drumShips = escortText.match(/(?:至少)?\s*(\d+)\s*个?舰娘/)?.[1]
    entries[id] = {
      id,
      tags: idLines.slice(1).filter(Boolean),
      nameJp: stripWiki(p['日文名字'] ?? ''),
      nameZh: stripWiki(p['中文名字'] ?? ''),
      time: stripWiki(p['耗时'] ?? ''),
      fleetLv: parseInt(stripWiki(p['舰队总等级'] ?? ''), 10) || null,
      flagLv: parseInt(stripWiki(p['旗舰等级'] ?? ''), 10) || null,
      minShips: parseInt(stripWiki(p['最低舰娘数'] ?? ''), 10) || null,
      composition,
      escortText: escortText || null,
      stats: Object.keys(stats).length ? stats : null,
      drumTotal: drumTotal ? parseInt(drumTotal, 10) : null,
      drumShips: drumShips ? parseInt(drumShips, 10) : null,
      greatNote: greatNote || null,
    }
  }
  for (const inner of templateCalls(text, '远征报酬表')) {
    const p = splitParams(inner)
    const idLines = stripWiki(p['编号'] ?? '').split('\n')
    const id = idLines[0]?.trim()
    const entry = entries[id]
    if (!entry) continue
    entry.tags = [...new Set([...entry.tags, ...idLines.slice(1).filter(Boolean)])]
    entry.monthly = entry.tags.some((t) => t.includes('月常'))
    entry.combat = entry.tags.find((t) => t.includes('交战')) ?? null
    entry.rewards = {
      hqExp: parseInt(stripWiki(p['提督经验值'] ?? ''), 10) || 0,
      shipExp: parseInt(stripWiki(p['舰娘经验值'] ?? ''), 10) || 0,
      fuel: parseResPair(p['燃料'] ?? ''),
      ammo: parseResPair(p['弹药'] ?? ''),
      steel: parseResPair(p['钢铁'] ?? ''),
      baux: parseResPair(p['铝'] ?? ''),
      items: parseItems(p['奖励'] ?? ''),
      greatItems: parseItems(p['大成功奖励'] ?? ''),
    }
  }
  const n = Object.keys(entries).length
  if (n < 60) throw new Error(`kcwiki 远征清洗仅得 ${n} 条（预期 65）——页面结构可能变了`)
  return entries
}

// ---- kcwiki 台词（正文页的 {{台词翻译表}}）----
//
// 为什么用 kcwiki 而不是 poi-plugin-subtitle：后者只有 {mstId:{数字编号:文本}}，
// 编号不带语义；kcwiki 每条自带「场合」（入手/秘书舰1/出征/中破…），
// 日文原文与中文译文也在同一条里。按同域单基准律，台词域整体走 kcwiki。
//
// 对齐 mstId 的办法：**不解析档名编号**。档名前缀是 kcwiki 图鉴号体系
// （时雨改的档名是 080a，而 ships 包里它的图鉴号是 1343，对不上），
// 改用页面里的 ==== 形态名 ==== 分组去匹配 ships 包的中文名——两边同源，名字一致。

const KCWIKI_API = 'https://zh.kcwiki.cn/api.php'

// 旧版 MediaWiki：不认 rvslots，正文在 revisions[0]['*']
const fetchWikiPages = async (titles, withMeta = false) => {
  const props = withMeta ? 'content|timestamp' : 'content'
  const url = `${KCWIKI_API}?action=query&prop=revisions&rvprop=${encodeURIComponent(props)}&format=json&titles=${encodeURIComponent(titles.join('|'))}`
  const res = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const out = new Map()
  for (const page of Object.values(json?.query?.pages ?? {})) {
    const content = page?.revisions?.[0]?.['*']
    if (withMeta) {
      // 空页也要落进结果：上游建了页却没写内容是**事实**，
      // 静静跳过会让「有多少页真的有台词」这一格永远对不上账。
      if (page?.missing !== undefined) continue
      out.set(page.title, {
        text: content ?? '',
        timestamp: page?.revisions?.[0]?.timestamp ?? null,
      })
      continue
    }
    if (content) out.set(page.title, content)
  }
  return out
}

/**
 * 某个名字空间的**全部**页名（allpages 穷举，不按名字猜）。
 * 上一批的教训：按名字猜模块名会漏掉三个真存在的模块。
 */
const fetchAllPageTitles = async (namespace) => {
  const titles = []
  let continuation = ''
  do {
    const url =
      `${KCWIKI_API}?action=query&list=allpages&apnamespace=${namespace}` +
      `&aplimit=500&format=json` +
      (continuation ? `&apcontinue=${encodeURIComponent(continuation)}` : '')
    const res = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    titles.push(...(json?.query?.allpages ?? []).map((entry) => entry.title).filter(Boolean))
    continuation = json?.continue?.apcontinue ?? ''
  } while (continuation)
  return [...new Set(titles)]
}

const fetchEmbeddedPageTitles = async (templateTitle) => {
  const titles = []
  let continuation = ''
  do {
    const url =
      `${KCWIKI_API}?action=query&list=embeddedin&eititle=${encodeURIComponent(templateTitle)}` +
      `&eilimit=500&einamespace=0&format=json` +
      (continuation ? `&eicontinue=${encodeURIComponent(continuation)}` : '')
    const res = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    titles.push(...(json?.query?.embeddedin ?? []).map((entry) => entry.title).filter(Boolean))
    continuation = json?.continue?.eicontinue ?? ''
  } while (continuation)
  return [...new Set(titles)]
}

// 一页 wikitext → [{form: 形态名, lines: [{key, scene, ja, zh}]}]
//
// 归属靠**档名前缀**而不是段落标题：时报同样写成 {{台词翻译表}}，但它在
// 「====时报====」段落下，段落名不是形态名——按标题分组会把整段时报丢掉
// （实测时雨页 120 条里丢了 100 条）。页面顶部的 tabber 给出了
// 「形态名 = {{舰娘资料改|编号=080a}}」，用它把档名前缀映回形态。
//
// 模板名有 `舰娘资料` 和 `舰娘资料改` 两种，**同一页里还会混用**
// （实测春雨页：春雨/春雨改 = {{舰娘资料}}，春雨改二 = {{舰娘资料改}}）。
// 旧版只认带「改」的那个，于是潮、吹雪那批老舰整页认不出形态；混用页更糟——
// formOf 只剩一条，`size === 1` 的回退把整页台词都算到 改二 头上。两种都收。
const parseVoicePage = (text, pageTitle) => {
  // 编号 → 形态名（tabber 多形态；单形态页则回退页面标题）
  const formOf = new Map()
  const tab = /^\s*([^=\n<|{}]+?)\s*=\s*\{\{\s*舰娘资料改?\s*\|\s*编号\s*=\s*([^}|\s]+)\s*\}\}/gm
  let t
  while ((t = tab.exec(text))) formOf.set(t[2].trim(), t[1].trim())
  if (!formOf.size) {
    const solo = /\{\{\s*舰娘资料改?\s*\|\s*编号\s*=\s*([^}|\s]+)\s*\}\}/.exec(text)
    if (solo) formOf.set(solo[1].trim(), pageTitle)
  }

  const byForm = new Map()
  for (const inner of templateCalls(text, '台词翻译表')) {
    const p = splitParams(inner)
    const key = stripWiki(p['档名'] ?? '')
    const scene = stripWiki(p['场合'] ?? '')
    const ja = stripWiki(p['日文台词'] ?? '')
    const zh = stripWiki(p['中文译文'] ?? '')
    if (!ja && !zh) continue
    // 档名形如 080a-0000 / 145-Intro：取首段作编号
    const code = key.split('-')[0]?.trim()
    const form = formOf.get(code) ?? (formOf.size === 1 ? [...formOf.values()][0] : pageTitle)
    const list = byForm.get(form) ?? []
    list.push({ key, scene, ja, zh })
    byForm.set(form, list)
  }
  return [...byForm].map(([form, lines]) => ({ form, lines }))
}

const parseKcwikiVoice = async () => {
  const shipsPack = JSON.parse(readFileSync(path.join(OUT_DIR, 'kcwiki-ships.json'), 'utf8'))
  const ships = Object.values(shipsPack.data)
  const byName = new Map()
  for (const s of ships) {
    if (s.中文名) byName.set(s.中文名, s.ID)
    if (s.日文名) byName.set(s.日文名, s.ID)
  }

  // 深海页先取：它们也挂 {{台词翻译表}}，会混进下面的穷举清单里，
  // 但走的是另一套按档名定编号的解析，先拿到名单好把它们从舰娘那一趟里摘掉。
  const abyssTitles = (await fetchEmbeddedPageTitles('Template:深海栖舰导航')).filter(
    (title) => title !== '深海栖舰',
  )

  // 页面清单 = **穷举**「谁真的挂了 {{台词翻译表}}」，而不是从 ships 包推链首。
  //
  // 旧法「按链首中文名」在两处漏：一是 `图鉴号` 是数字而 `系列` 是补零字符串
  // （潮 图鉴号 70 vs 系列 "070"），字符串比较对**图鉴号小于 100 的全部 94 艘老舰**
  // 一律判假——睦月、吹雪、雪风、时雨、曙、潮全家因此从清单上掉下去，
  // 一行台词都没进过包；二是清单跟着 ships 包漂，页面在上游改个归属就整页丢
  // （08-23 实测丢了春雨改二、早霜改二、藤波改二、黎塞留 Deux 四个形态）。
  // 现在以上游的转写关系为准，再并上链首名单兜底（链首判据同时修成数值比较）。
  const heads = ships.filter(
    (s) => !s.改造?.改造前 || Number(s.图鉴号) === Number(s.改造?.系列),
  )
  const embedded = await fetchEmbeddedPageTitles('Template:台词翻译表')
  const abyssSet = new Set(abyssTitles)
  const titles = [
    ...new Set([...embedded, ...heads.map((s) => s.中文名).filter(Boolean)]),
  ].filter((title) => !abyssSet.has(title) && !title.startsWith('季节性/'))
  console.log(
    `[lodes]   台词页清单 ${titles.length} 页（转写穷举 ${embedded.length} ∪ 链首 ${new Set(heads.map((s) => s.中文名).filter(Boolean)).size}，已摘去深海 ${abyssTitles.length}）`,
  )

  const out = {}
  let pages = 0
  let matched = 0
  let unmatchedForms = new Set()
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20)
    let contents
    try {
      contents = await fetchWikiPages(batch)
    } catch (e) {
      console.warn(`[lodes]   批次 ${i} 取页失败：${e.message}`)
      continue
    }
    for (const [title, text] of contents) {
      pages++
      for (const g of parseVoicePage(text, title)) {
        const mstId = byName.get(g.form)
        if (!mstId) {
          if (g.form) unmatchedForms.add(g.form)
          continue
        }
        if (!out[mstId]) matched++
        out[mstId] = g.lines
      }
    }
    process.stdout.write(`\r[lodes]   已取 ${pages}/${titles.length} 页，命中形态 ${matched}`)
    await new Promise((r) => setTimeout(r, 200)) // 对 wiki 客气点：页数从 236 涨到 368
  }
  process.stdout.write('\n')
  if (unmatchedForms.size) {
    console.log(`[lodes]   未匹配到 mstId 的段落 ${unmatchedForms.size} 个（多为「季节限定」等非形态小节）`)
  }

  // 深海页不使用「舰娘资料改」，但台词档名自带准确资源编号：
  // ShinkaiSeikan582-* → api_mst_ship 1582。按这个编号落表，避免同名的
  // 普通/elite/壊形态互相串台词；没有编号的行宁可不收，也不靠页面标题猜。
  let abyssPages = 0
  let abyssLines = 0
  const abyssIds = new Set()
  for (let i = 0; i < abyssTitles.length; i += 20) {
    const batch = abyssTitles.slice(i, i + 20)
    let contents
    try {
      contents = await fetchWikiPages(batch)
    } catch (e) {
      console.warn(`[lodes]   深海批次 ${i} 取页失败：${e.message}`)
      continue
    }
    for (const [, text] of contents) {
      abyssPages++
      for (const inner of templateCalls(text, '台词翻译表')) {
        const p = splitParams(inner)
        const key = stripWiki(p['档名'] ?? '')
        const mstId = abyssVoiceMstIdFromKey(key)
        if (mstId == null) continue
        const line = {
          key,
          scene: stripWiki(p['场合'] ?? ''),
          ja: stripWiki(p['日文台词'] ?? ''),
          zh: stripWiki(p['中文译文'] ?? ''),
        }
        if (!line.ja && !line.zh) continue
        const rows = out[mstId] ?? []
        if (!rows.some((known) => known.key === line.key && known.ja === line.ja && known.zh === line.zh)) {
          rows.push(line)
          out[mstId] = rows
          abyssLines++
          abyssIds.add(mstId)
        }
      }
    }
    process.stdout.write(`\r[lodes]   深海台词页 ${abyssPages}/${abyssTitles.length}，命中 ${abyssIds.size} 个精确 ID`)
  }
  process.stdout.write('\n')

  const total = Object.values(out).reduce((a, v) => a + v.length, 0)
  // 基线随清单换穷举一起抬：08-23 实测 765 个形态。留 700 的余量给上游正常增删，
  // 再低就说明清单或形态映射又塌了一层——那正是老清单塌到 372 时**没有**报出来的那次。
  if (matched < 700) throw new Error(`台词仅匹配 ${matched} 个形态（预期 700+）——页面清单或形态映射可能塌了`)
  console.log(`[lodes]   台词：舰娘 ${matched} 形态 · 深海 ${abyssIds.size} 个精确 ID / 共 ${total} 条`)
  return out
}

// ---- kcwiki 季节限定台词（「季节性/*」独立页）----
//
// 舰娘页的「季节限定语音」小节里一行台词都没有：它整段是
// `{{#widget:SeasonalSubtitle|id=080}}` 挂件调用，文本住在 `季节性/2015年圣诞节`
// 这类独立页上。上面那个抓取器把这些页外段落当「未匹配到 mstId」丢掉，
// 于是 kuma 至今一条季节台词都没有——这一路就是来补它的。
//
// 随包**日中两列都落**（2026-08-22 撤销原来的「只收中文」，理由见
// lib/kcwiki-seasonal-voice.mjs 文件头）。`--seasonal-voice-audit` 那份材料照旧另存到
// assets/review/：它带着**每一次列出**的原始行（往年台词会在每张同季节的页上重复列出），
// 包里只留「本家那一次」，所以那份仍是回溯用的底本，不入仓、不随包。
const parseKcwikiSeasonalVoice = async () => {
  const titles = (await fetchAllPageTitles(0)).filter((title) => title.startsWith('季节性/'))
  if (titles.length < 100) {
    throw new Error(`季节性页清单只有 ${titles.length} 页（预期 100+）——站点结构可能变了`)
  }
  console.log(`[lodes]   季节性页清单 ${titles.length} 页`)

  const rows = []
  const seasons = {}
  let fetched = 0
  let emptyPages = 0
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20)
    let contents
    try {
      contents = await fetchWikiPages(batch, true)
    } catch (error) {
      console.warn(`[lodes]   季节批次 ${i} 取页失败：${error.message}`)
      continue
    }
    for (const [title, page] of contents) {
      fetched++
      if (!page.text) {
        emptyPages++
        continue
      }
      const parsed = parseSeasonalVoicePage(page.text, title)
      if (!parsed.length) continue
      const season = parseSeasonPageTitle(title)
      seasons[season.id] = {
        title: season.title,
        ...(season.year ? { year: season.year } : {}),
        name: season.name,
        page: title,
        ...(page.timestamp ? { updatedAt: page.timestamp } : {}),
      }
      rows.push(...parsed)
    }
    process.stdout.write(`\r[lodes]   已取 ${fetched}/${titles.length} 页，台词 ${rows.length} 行`)
  }
  process.stdout.write('\n')
  if (emptyPages) console.log(`[lodes]   空页 ${emptyPages} 张（上游建了页但没写内容）`)

  const shipList = Object.values(
    JSON.parse(readFileSync(path.join(OUT_DIR, 'kcwiki-ships.json'), 'utf8')).data ?? {},
  )
  const codeMap = buildShipFormCodeMap(shipList)
  const nameMap = new Map()
  for (const ship of shipList) {
    if (ship.中文名 && !nameMap.has(ship.中文名)) nameMap.set(ship.中文名, ship.ID)
    if (ship.日文名 && !nameMap.has(ship.日文名)) nameMap.set(ship.日文名, ship.ID)
  }

  const { data, stats } = buildSeasonalVoicePack(rows, codeMap, nameMap, seasons)
  const forms = Object.keys(data.ships).length
  // 基线按**去重后的台词条数**（往年台词会在每张同季节的页上重复列出，
  // 抓到的行数是它的四倍多，拿行数当基线只会把真的塌方盖过去）
  if (stats.kept < 4_000 || forms < 400) {
    throw new Error(
      `季节台词只收到 ${stats.kept} 条 / ${forms} 形态（基线 4000 条 / 400 形态）——页面结构可能变了`,
    )
  }
  console.log(
    `[lodes]   季节台词：${Object.keys(seasons).length} 个季节 · ${forms} 形态 · ${stats.kept} 条` +
      `（原始 ${stats.total} 行，往年重复列出 ${stats.duplicateListings} 行；` +
      `按形态码归属 ${stats.byCode} / 按名字 ${stats.byName} / 无归属丢弃 ${stats.dropped}` +
      ` / 带槽位 ${stats.withSlot} / 缺译文 ${stats.withoutZh} / 译文有分歧 ${stats.divergentText}）`,
  )
  if (process.argv.includes('--seasonal-voice-audit')) {
    const reviewDir = path.join(root, 'assets', 'review')
    mkdirSync(reviewDir, { recursive: true })
    const auditFile = path.join(reviewDir, 'kcwiki-seasonal-voice.audit.json')
    writeFileSync(auditFile, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1))
    console.log(`[lodes]   维护者侧对账材料（含日文原文，不入仓不随包）→ ${auditFile}`)
  }
  // 新鲜度取各季节页里最新的一次编辑
  const newest = Object.values(seasons)
    .map((entry) => entry.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
  return lodeBuild(data, newest ?? null)
}

// ---- kcwiki 季节限定立绘清单（同一批「季节性/*」页的 <gallery> 段）----
//
// 与上面那一路同源同页、不同段：那边取 `{{台词翻译表}}`，这边取图库里的**档名**。
// 上一批把 155 张页整页拉过一遍，图库那一半原封不动留着——就是这一路来收它。
//
// ---- wikiwiki.jp 日文台词（形态精确补录）----
//
// zh.kcwiki / poi-plugin-subtitle 对新改装形态常有数月空窗；wikiwiki 的舰娘页则在
// 「改装段階」列逐行标 ○/×。这里只抓现有两路都没有整份资料的形态，避免对站点
// 做数百次无意义请求。输出仍按 mstId 落表，运行时不靠相似名字猜形态。
// 主数据快照的读取口挪到了 scripts/lib/start2.mjs（译名装配那边也要用同一套候选路径，
// 两处各写一份必然漂移）。顺带多了一个候选：仓库上一级的 s2.json。
const loadStart2MasterArray = (key) => loadStart2Table(key, root)

const loadVoiceMasterShips = () => {
  const ships = loadStart2MasterArray('api_mst_ship')
  if (ships.length) return ships
  // 没有登录快照时仍可更新旧有舰娘；最新形态要等一次游戏主数据同步后再抓。
  const pack = JSON.parse(readFileSync(path.join(OUT_DIR, 'kcwiki-ships.json'), 'utf8'))
  return Object.values(pack.data ?? {}).map((ship) => ({
    api_id: ship.ID,
    api_name: ship.日文名,
    api_sortno: ship.图鉴号,
  }))
}

const packData = (id) => {
  const file = path.join(OUT_DIR, `${id}.json`)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')).data ?? {}
  } catch (_error) {
    return {}
  }
}

const wikiwikiLastModified = (html) => {
  const match = `${html ?? ''}`.match(/Last-modified:\s*(\d{4})-(\d{2})-(\d{2})/i)
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00` : null
}

const lodeBuild = (data, upstreamUpdatedAt = null) => ({
  __kansoLodeBuild: true,
  data,
  upstreamUpdatedAt,
})

const sharedWikiwikiShipCache = () =>
  path.join(os.tmpdir(), 'kanso-wikiwiki-ship-page-cache', jstDate())

// wikiwiki 原站限流很敏感（2026-08-12 实测：台词页按 1.2s 间隔抓，整程 429，
// 每页硬等 30/60s 重试等于持续骚扰原站）。节奏统一收在这里、按主机各排一条队，
// 调用方不再各自 sleep：
//   · 原站起步 10.5s（其余抓取点多年安全的间隔），镜像 250ms；
//   · 吃到 429 立即把该主机的间隔翻倍（封顶 3 分钟），等待遵循 Retry-After
//     且下限逐次抬高（60s/120s/…，共 5 次机会）；
//   · 成功后间隔缓慢回落（×0.9），不会一直卡在最慢档。
const wikiwikiPace = new Map() // host -> { pace, base, lastAt }
const wikiwikiPaceOf = (baseUrl) => {
  const host = new URL(baseUrl).host
  let state = wikiwikiPace.get(host)
  if (!state) {
    const base = host === 'wikiwiki.jp' ? 10_500 : 250
    state = { pace: base, base, lastAt: 0 }
    wikiwikiPace.set(host, state)
  }
  return state
}

const fetchWikiwikiPage = async (
  title,
  cacheDir,
  {
    baseUrl = 'https://wikiwiki.jp/kancolle/',
    sourceLabel = 'wikiwiki',
  } = {},
) => {
  const cache = path.join(cacheDir, `${Buffer.from(title).toString('base64url')}.html`)
  const missingCache = `${cache}.missing`
  if (existsSync(cache)) {
    return { html: readFileSync(cache, 'utf8'), pageName: title, cached: true, missing: false }
  }
  if (existsSync(missingCache)) return { html: '', pageName: title, cached: true, missing: true }
  // 原站是唯一能确认当天更新的来源；现有公开镜像曾落后数月，不能冒充最新资料。
  const pace = wikiwikiPaceOf(baseUrl)
  for (let attempt = 0; attempt < 5; attempt++) {
    const due = pace.lastAt + pace.pace - Date.now()
    if (due > 0) await new Promise((resolve) => setTimeout(resolve, due))
    pace.lastAt = Date.now()
    let response
    try {
      response = await fetch(`${baseUrl}${encodeURIComponent(title)}`, {
        headers: { 'User-Agent': 'kanso-lodes' },
      })
    } catch (error) {
      if (attempt >= 4) throw error
      const waitMs = 30_000 * (attempt + 1)
      console.warn(
        `[lodes]   ${sourceLabel} 请求失败，${Math.round(waitMs / 1_000)} 秒后重试「${title}」：${error.message}`,
      )
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      continue
    }
    if (response.status === 429) {
      pace.pace = Math.min(180_000, Math.max(pace.pace * 2, pace.base))
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
      const waitMs = Math.max(
        Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0,
        60_000 * (attempt + 1),
      )
      console.warn(
        `[lodes]   ${sourceLabel} 限流，节奏放缓至 ${Math.round(pace.pace / 1_000)}s/页，` +
          `${Math.round(waitMs / 1_000)} 秒后重试「${title}」`,
      )
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      continue
    }
    pace.pace = Math.max(pace.base, Math.round(pace.pace * 0.9))
    if (response.status === 404) {
      writeFileSync(missingCache, '', 'utf8')
      return { html: '', pageName: title, cached: false, missing: true }
    }
    if (!response.ok) throw new Error(`${sourceLabel} ${title}: HTTP ${response.status}`)
    const html = await response.text()
    writeFileSync(cache, html, 'utf8')
    const pathname = new URL(response.url).pathname.replace(/^\/(?:kancolle\/|\.\/*)?/, '')
    let pageName = title
    try {
      pageName = decodeURIComponent(pathname) || title
    } catch (_error) {
      pageName = pathname || title
    }
    return { html, pageName, cached: false, missing: false }
  }
  throw new Error(`${sourceLabel} 连续限流，停止抓取；已成功页面保留在 ${cacheDir}，稍后重跑会续传`)
}

const parseWikiwikiVoice = async () => {
  const ships = loadVoiceMasterShips().filter(
    (ship) => Number(ship?.api_id) > 0 && Number(ship?.api_sortno) > 0 && ship?.api_name,
  )
  const kcwiki = packData('kcwiki-voice')
  const subtitleZhData = packData('subtitle-zh')
  const subtitleJaData = packData('subtitle-ja')
  const hasExisting = (id) =>
    (Array.isArray(kcwiki[id]) && kcwiki[id].length > 0) ||
    Object.keys(subtitleZhData[id] ?? {}).length > 0 ||
    Object.keys(subtitleJaData[id] ?? {}).length > 0

  const targets = ships.filter((ship) => !hasExisting(ship.api_id))
  const shipById = new Map(ships.map((ship) => [Number(ship.api_id), ship]))
  const afterIds = new Set(
    ships
      .map((ship) => Number.parseInt(`${ship.api_aftershipid ?? ''}`, 10))
      .filter((id) => Number.isInteger(id) && shipById.has(id)),
  )
  const rootNameOf = new Map()
  for (const root of ships.filter((ship) => !afterIds.has(Number(ship.api_id)))) {
    const visited = new Set()
    let current = Number(root.api_id)
    while (shipById.has(current) && !visited.has(current)) {
      visited.add(current)
      rootNameOf.set(current, `${root.api_name}`.trim())
      const after = Number.parseInt(`${shipById.get(current)?.api_aftershipid ?? ''}`, 10)
      if (!Number.isInteger(after) || !shipById.has(after)) break
      current = after
    }
  }
  const titles = [
    ...new Set(
      targets
        .flatMap((ship) => [
          `${ship.api_name}`.trim(),
          rootNameOf.get(Number(ship.api_id)) ?? '',
        ])
        .filter(Boolean),
    ),
  ]
  const idsByName = new Map()
  for (const ship of ships) {
    const key = normalizeWikiwikiShipName(ship.api_name)
    idsByName.set(key, [...(idsByName.get(key) ?? []), Number(ship.api_id)])
  }

  const out = {}
  let pages = 0
  let missingPages = 0
  const cacheDir = sharedWikiwikiShipCache()
  mkdirSync(cacheDir, { recursive: true })
  const annotatedForm = new Map([
    [normalizeWikiwikiShipName('Glorious(正規空母)'), { name: 'Glorious', stype: 11 }],
    [normalizeWikiwikiShipName('Glorious改(正規空母)'), { name: 'Glorious改', stype: 11 }],
    [normalizeWikiwikiShipName('Glorious(巡洋戦艦)'), { name: 'Glorious', stype: 8 }],
    [normalizeWikiwikiShipName('Glorious改(巡洋戦艦)'), { name: 'Glorious改', stype: 8 }],
  ])
  const mergePage = (forms) => {
    for (const form of forms) {
      const normalized = normalizeWikiwikiShipName(form.name)
      let ids = idsByName.get(normalized) ?? []
      const annotated = annotatedForm.get(normalized)
      if (!ids.length && annotated) {
        ids = (idsByName.get(normalizeWikiwikiShipName(annotated.name)) ?? []).filter(
          (id) => Number(shipById.get(id)?.api_stype) === annotated.stype,
        )
      }
      for (const id of ids) {
        const known = out[id] ?? []
        for (const line of form.lines) {
          if (!known.some((entry) => entry.scene === line.scene && entry.ja === line.ja)) {
            known.push(line)
          }
        }
        out[id] = known
      }
    }
  }

  // 没有公开的匿名批量数据包；严格串行并靠当日缓存续传，避免重复请求原站。
  // 节奏由 fetchWikiwikiPage 内部统一控制（此前这里只隔 1.2s，被原站全程 429）。
  for (const title of titles) {
    const page = await fetchWikiwikiPage(title, cacheDir)
    if (page.missing) {
      missingPages++
    } else {
      const forms = parseWikiwikiVoicePage(page.html, page.pageName)
      if (forms.length) {
        pages++
        mergePage(forms)
      }
    }
  }

  for (const lines of Object.values(out)) {
    lines.sort(
      (left, right) =>
        (left.voiceId ?? 9_999) - (right.voiceId ?? 9_999) ||
        left.scene.localeCompare(right.scene, 'ja'),
    )
  }
  const lineCount = Object.values(out).reduce((sum, lines) => sum + lines.length, 0)
  if (titles.length && !Object.keys(out).length) {
    throw new Error(`wikiwiki 台词抓取 ${titles.length} 个待补形态却无一命中——页面结构可能变了`)
  }
  console.log(
    `[lodes]   wikiwiki 台词：待补 ${targets.length} 形态 / 请求 ${titles.length} 页 / ` +
      `命中 ${pages} 页、${Object.keys(out).length} 形态、${lineCount} 条` +
      `${missingPages ? ` / 无对应页面 ${missingPages} 个` : ''}`,
  )
  return out
}

const parseWikiwikiRemodel = async (raw) => {
  const ships = loadVoiceMasterShips().filter(
    (ship) => Number(ship?.api_id) > 0 && Number(ship?.api_sortno) > 0 && ship?.api_name,
  )
  const idsByName = new Map()
  for (const ship of ships) {
    const key = normalizeWikiwikiShipName(ship.api_name)
    idsByName.set(key, [...(idsByName.get(key) ?? []), Number(ship.api_id)])
  }
  const shipById = new Map(ships.map((ship) => [Number(ship.api_id), ship]))
  const annotatedForm = new Map([
    [normalizeWikiwikiShipName('Glorious(正規空母)'), { name: 'Glorious', stype: 11 }],
    [normalizeWikiwikiShipName('Glorious改(正規空母)'), { name: 'Glorious改', stype: 11 }],
    [normalizeWikiwikiShipName('Glorious(巡洋戦艦)'), { name: 'Glorious', stype: 8 }],
    [normalizeWikiwikiShipName('Glorious改(巡洋戦艦)'), { name: 'Glorious改', stype: 8 }],
  ])
  const out = {}
  const unresolved = []
  let latest = wikiwikiLastModified(raw)
  const entries = parseWikiwikiRemodelIndex(raw)
  const alignedIds = (entry) => {
    const normalized = normalizeWikiwikiShipName(entry.targetName)
    let ids = idsByName.get(normalized) ?? []
    const annotated = annotatedForm.get(normalized)
    if (!ids.length && annotated) {
      ids = (idsByName.get(normalizeWikiwikiShipName(annotated.name)) ?? []).filter(
        (id) => Number(shipById.get(id)?.api_stype) === annotated.stype,
      )
    }
    const sortNo = /^\d+$/.test(`${entry.targetNo ?? ''}`)
      ? Number(entry.targetNo)
      : 0
    if (sortNo > 0 && ids.length !== 1) {
      const bySortNo = ships
        .filter((ship) => Number(ship.api_sortno) === sortNo)
        .map((ship) => Number(ship.api_id))
      if (bySortNo.length === 1) ids = bySortNo
    }
    return ids
  }
  // 来路（改造前形态）解析：总表行给全名，チャート给链上前一个节点的全名。
  // 对不齐就诚实地不声明 fromShipId——消费端会退回「前进路径」启发。
  const resolveSourceId = (sourceName) => {
    if (!sourceName) return 0
    const ids = idsByName.get(normalizeWikiwikiShipName(sourceName)) ?? []
    return ids.length === 1 ? ids[0] : 0
  }
  // 同一目标的其他来路进 edges[]：主条目之外的每条边各带自己的 fromShipId 与素材。
  const attachEdge = (entry, detail) => {
    if (!entry || !(detail?.fromShipId > 0)) return
    if (Number(entry.fromShipId) === detail.fromShipId) return
    const edges = entry.edges ?? (entry.edges = [])
    if (edges.some((edge) => edge.fromShipId === detail.fromShipId)) return
    edges.push(detail)
  }
  // 总表回程行（条件「-」+脚注 tooltip）：等补页覆盖完主条目后再挂成边，
  // 免得被舰页整条替换时一起洗掉。舰页/脚注同边的明细优先（attachEdge 先到先得）。
  const indexReturnEdges = []
  const mergeEntry = (entry) => {
    const ids = alignedIds(entry)
    if (ids.length !== 1) {
      unresolved.push({
        page: entry.page,
        sourceName: entry.sourceName,
        targetName: entry.targetName,
        targetNo: entry.targetNo,
        candidateIds: ids,
      })
      return
    }
    const fromShipId = resolveSourceId(entry.sourceName)
    if (entry.conversionOnly) {
      if (fromShipId && entry.needs.length) {
        indexReturnEdges.push({
          targetId: ids[0],
          detail: { fromShipId, needs: entry.needs, raw: entry.raw, source: 'index' },
        })
      }
      return
    }
    const candidate = {
      targetShipId: ids[0],
      ...(fromShipId ? { fromShipId } : {}),
      level: entry.level,
      needs: entry.needs,
      page: entry.page,
      raw: entry.raw,
      ...(latest ? { pageUpdatedAt: latest } : {}),
    }
    const known = out[ids[0]]
    // 可逆改造会让同一目标出现两次；事实包按“明确等级且素材更完整”的正向条目降级，
    // 不让无素材的回转行覆盖首次改造需求。总表的转换行掺着配对解锁成本
    // （榛名乙→丙那行抄了改二→乙的 図2報兵2），不进 edges——循环成员随后
    // 一律被舰页チャート整条覆盖，按边明细只认舰页与脚注。
    if (
      !known ||
      candidate.needs.length > known.needs.length ||
      (candidate.needs.length === known.needs.length && candidate.level < known.level)
    ) {
      out[ids[0]] = candidate
    }
  }
  for (const entry of entries) mergeEntry(entry)

  const supplementTargets = []
  const upgradeRows = loadStart2MasterArray('api_mst_shipupgrade')
  // 可逆循环成员判定（改二⇄戊、加賀三形态这类）：总表把配对的首次解锁成本写在
  // 转换行上（榛名改二乙→丙 一行写着 図2+兵2+報+開発390，用户拿舰页チャート
  // 实锤那属于 改二→乙 那一步；丙自己的括号是 Lv90+高建35+開発55）。只有舰页
  // チャート按形态分括号，所以循环成员一律刷链首页，让一手明细覆盖总表行。
  const forwardEdges = new Map()
  const addForward = (from, to) => {
    if (!(from > 0 && to > 0) || from === to) return
    const list = forwardEdges.get(from) ?? []
    list.push(to)
    forwardEdges.set(from, list)
  }
  for (const ship of ships) {
    addForward(Number(ship.api_id), Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10) || 0)
  }
  for (const upgrade of upgradeRows) {
    addForward(Number(upgrade?.api_current_ship_id) || 0, Number(upgrade?.api_id) || 0)
  }
  const inConvertCycle = (start) => {
    const seen = new Set()
    const queue = [...(forwardEdges.get(start) ?? [])]
    while (queue.length) {
      const cur = queue.pop()
      if (cur === start) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const next of forwardEdges.get(cur) ?? []) queue.push(next)
    }
    return false
  }
  for (const upgrade of upgradeRows) {
    const targetId = Number(upgrade?.api_id)
    if (Number(upgrade?.api_current_ship_id) <= 0 || Number(upgrade?.api_upgrade_level) <= 0) {
      continue
    }
    const target = shipById.get(targetId)
    if (!target) continue
    const known = out[targetId]
    // 原生七字段由游戏 API 兜底，无需为了交叉验证逐舰刷页；补两类：总表尚未收录
    // 的新形态（顺带发现 API 表外素材），和可逆循环成员（总表行掺了配对成本）。
    // wikiwiki 通常把整条改造链放在原型舰页面，最新形态自身往往没有独立页
    // （Béarn amélioration 即如此），所以优先请求 api_original_ship_id 对应的链首页。
    const original = shipById.get(Number(upgrade?.api_original_ship_id))
    if (!known || inConvertCycle(targetId)) {
      supplementTargets.push(`${original?.api_name ?? target.api_name}`.trim())
    }
  }
  const supplementTitles = [...new Set(supplementTargets)].filter(Boolean)
  const cacheDir = sharedWikiwikiShipCache()
  mkdirSync(cacheDir, { recursive: true })
  let supplementPages = 0
  for (const title of supplementTitles) {
    const page = await fetchWikiwikiPage(title, cacheDir)
    if (!page.missing) {
      const modified = wikiwikiLastModified(page.html)
      if (modified && (!latest || Date.parse(modified) > Date.parse(latest))) latest = modified
      const pageEntries = parseWikiwikiRemodelPage(page.html, page.pageName)
      if (pageEntries.length) {
        supplementPages++
        // 舰页チャート整条覆盖总表：本页首次出现的形态成为主条目（链上首次
        // 解锁那条边——加賀改二的 図2+甲板+報+航空2+開発120 在这里，不能被
        // 循环回环边 護→改二 的 高建30+開発60 顶掉），再次出现进 edges[]。
        const pageReplaced = new Set()
        for (const entry of pageEntries) {
          const ids = alignedIds(entry)
          if (ids.length !== 1) continue
          const fromShipId = resolveSourceId(entry.sourceName)
          const detail = {
            ...(fromShipId ? { fromShipId } : {}),
            level: entry.level,
            needs: entry.needs,
            raw: entry.raw,
          }
          if (!pageReplaced.has(ids[0])) {
            pageReplaced.add(ids[0])
            out[ids[0]] = {
              targetShipId: ids[0],
              ...detail,
              page: entry.page,
              ...(modified ? { pageUpdatedAt: modified } : {}),
            }
          } else {
            attachEdge(out[ids[0]], { ...detail, source: 'chart' })
          }
        }
        // 脚注「XをYに戻す場合、…消費」→ 回程边。省略形（改二特/改Mod.2）
        // 对着本页チャート节点找唯一后缀匹配；对不上就诚实放弃，不猜。
        const nodeNames = new Set()
        for (const entry of pageEntries) {
          nodeNames.add(entry.targetName)
          if (entry.sourceName) nodeNames.add(entry.sourceName)
        }
        const despaced = (name) => normalizeWikiwikiShipName(name).replace(/\s+/g, '')
        const resolveNode = (shortName) => {
          const suffix = despaced(shortName)
          if (!suffix) return 0
          const hits = [...nodeNames].filter((name) => despaced(name).endsWith(suffix))
          if (hits.length !== 1) return 0
          const ids = alignedIds({ targetName: hits[0], targetNo: '' })
          return ids.length === 1 ? ids[0] : 0
        }
        for (const back of parseWikiwikiReturnEdges(page.html, page.pageName)) {
          const toId = resolveNode(back.toName)
          const fromId = resolveNode(back.fromName)
          if (!toId || !fromId || !out[toId]) continue
          attachEdge(out[toId], {
            fromShipId: fromId,
            needs: back.needs,
            raw: back.raw,
            source: 'footnote',
          })
        }
      }
    }
  }
  // 补页全部落定后再挂总表回程边：同边已有舰页チャート/脚注明细的不覆盖
  for (const { targetId, detail } of indexReturnEdges) {
    if (out[targetId]) attachEdge(out[targetId], detail)
  }
  const needCount = Object.values(out).reduce((sum, entry) => sum + entry.needs.length, 0)
  if (Object.keys(out).length < 300) {
    throw new Error(
      `wikiwiki 改造需求仅对齐 ${Object.keys(out).length} 个目标形态（预期至少 300）——页面或名称对齐可能变了`,
    )
  }
  console.log(
    `[lodes]   wikiwiki 改造：总表 ${entries.length} 条关系 / ` +
      `定向补页 ${supplementPages}/${supplementTitles.length} / ` +
      `${Object.keys(out).length} 个目标形态、${needCount} 条素材 / 未唯一对齐 ${unresolved.length}`,
  )
  if (unresolved.length) {
    const reviewDir = path.join(root, 'assets', 'review')
    mkdirSync(reviewDir, { recursive: true })
    writeFileSync(
      path.join(reviewDir, 'wikiwiki-remodel.unresolved.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), entries: unresolved }, null, 2),
    )
  }
  return lodeBuild(out, latest)
}

// 三维 Lv99 上限的社区基准（2026-08-11 拿账本一手对 340 持有形态仲裁后选定：
// 覆盖 缺6可解 vs kcwiki 缺41，错误率 0.69% vs 0.62% 相当，页面自带更新日期）。
// 对齐：No. 列数字＝図鑑号（api_sortno）→ 候选形态；多候选再按名字（去括号注记）唯一化。
const parseWikiwikiShipMax = async (raw) => {
  const ships = loadVoiceMasterShips().filter(
    (ship) => Number(ship?.api_id) > 0 && Number(ship?.api_sortno) > 0 && ship?.api_name,
  )
  // 名字为主对齐：主数据里名字几乎唯一（重名仅宗谷×3、Glorious 系）。表的
  // No. 列后缀行（001b 長門改）数字是族図鑑号，不是该形态自己的 sortno
  // （長門改 sortno=1375），只能在**重名**候选里用它消歧，不能当主键——
  // 当主键时后缀行会全部塌到素体上（834 行对齐只剩 590 个唯一 id 的实锤）。
  const byName = new Map()
  for (const ship of ships) {
    const key = normalizeWikiwikiShipName(ship.api_name)
    byName.set(key, [...(byName.get(key) ?? []), ship])
  }
  const rows = parseWikiwikiShipMaxTable(raw)
  // 括号注记有两种：主数据本名的一部分（吹雪改三護(六式)——先按全名试），
  // 或表为重名形态加的区分（Glorious改(巡洋戦艦)——剥掉后按舰种/図鑑号消歧）
  const ANNOTATION_STYPE = new Map([
    ['巡洋戦艦', [8]],
    ['正規空母', [11, 18]],
  ])
  const out = {}
  const unresolved = []
  for (const row of rows) {
    const annotation = row.name.match(/[（(]([^（()）]*)[）)]\s*$/)?.[1] ?? ''
    const bare = normalizeWikiwikiShipName(row.name.replace(/[（(][^（()）]*[）)]\s*$/, '').trim())
    let candidates = byName.get(normalizeWikiwikiShipName(row.name)) ?? []
    if (!candidates.length) candidates = byName.get(bare) ?? []
    if (candidates.length > 1) {
      const sortno = Number.parseInt(row.no.match(/^\d+/)?.[0] ?? '', 10)
      const bySort = candidates.filter((ship) => Number(ship.api_sortno) === sortno)
      const stypes = ANNOTATION_STYPE.get(annotation)
      candidates = bySort.length === 1
        ? bySort
        : stypes
          ? candidates.filter((ship) => stypes.includes(Number(ship.api_stype)))
          : candidates
    }
    const id = Number(candidates[0]?.api_id)
    if (candidates.length !== 1 || out[id]) {
      unresolved.push({ no: row.no, name: row.name, candidateIds: candidates.map((s) => s.api_id) })
      continue
    }
    out[id] = {
      shipId: id,
      nameJp: row.name,
      no: row.no,
      kaihi: row.kaihi,
      taisen: row.taisen,
      sakuteki: row.sakuteki,
    }
  }
  if (Object.keys(out).length < 800) {
    throw new Error(
      `wikiwiki 艦船最大値仅对齐 ${Object.keys(out).length} 个形态（预期至少 800）——页面或図鑑号对齐可能变了`,
    )
  }
  // 定向舰页补漏（用户 2026-08-11 拿日枝丸实锤：批量表对新实装/補形态/部分
  // 海外舰系整批不收，但逐舰页有全数据**含初期值**）。补两类：批量表没对上
  // 的形态，和 kcwiki 三维标缺(-1/无条目)的形态——后者只为拿初期值。
  const kcById = new Map(
    Object.values(packData('kcwiki-ships'))
      .filter((entry) => Number(entry?.ID) > 0)
      .map((entry) => [Number(entry.ID), entry]),
  )
  const kcMissesInit = (mstId) => {
    const stats = kcById.get(mstId)?.数据
    if (!stats) return true
    const bad = (pair) => !Array.isArray(pair) || Number(pair[0]) < 0 || Number(pair[1]) < 0
    return bad(stats.回避) || bad(stats.对潜) || bad(stats.索敌)
  }
  const supplementForms = ships.filter(
    (ship) => !out[ship.api_id] || kcMissesInit(Number(ship.api_id)),
  )
  const cacheDir = sharedWikiwikiShipCache()
  mkdirSync(cacheDir, { recursive: true })
  let pageNew = 0
  let pageInitOnly = 0
  let pageMissing = 0
  for (const form of supplementForms) {
    const page = await fetchWikiwikiPage(`${form.api_name}`.trim(), cacheDir)
    if (page.missing) {
      pageMissing++
    } else {
      const stats = parseWikiwikiShipPageStats(page.html)
      if (stats) {
        const id = Number(form.api_id)
        // 逐字段收取：wiki 用「--」标未实测的一侧（Béarn 回避 20/--），
        // 拿到哪半算哪半——字段全部可选，缺的照实不写
        const put = (target, key, value) => {
          if (Number.isInteger(value) && value >= 0) target[key] = value
        }
        if (out[id]) {
          pageInitOnly++
        } else {
          pageNew++
          out[id] = {
            shipId: id,
            nameJp: `${form.api_name}`,
            no: `${form.api_sortno}`,
            source: 'ship-page',
          }
          put(out[id], 'kaihi', stats.kaihi?.[1])
          put(out[id], 'taisen', stats.taisen?.[1])
          put(out[id], 'sakuteki', stats.sakuteki?.[1])
        }
        // 初期值只有舰页有；最大值批量表在场时以批量表为准（同 wiki 内批量表更新更勤）
        put(out[id], 'kaihiInit', stats.kaihi?.[0])
        put(out[id], 'taisenInit', stats.taisen?.[0])
        put(out[id], 'sakutekiInit', stats.sakuteki?.[0])
      }
    }
  }
  // 机器完备检查：主数据每个友方形态都必须在本包或 kcwiki 里有三维——
  // 剩缺口就写进 review，绝不让用户逐舰肉眼查漏
  const stillMissing = ships.filter((ship) => !out[ship.api_id] && kcMissesInit(Number(ship.api_id)))
  console.log(
    `[lodes]   wikiwiki 艦船最大値：表 ${rows.length} 行对齐 ${Object.keys(out).length - pageNew} / ` +
      `定向舰页 ${supplementForms.length} 形态（新增 ${pageNew}、补初期 ${pageInitOnly}、无页面 ${pageMissing}） / ` +
      `未唯一对齐 ${unresolved.length} / 全形态三维仍缺 ${stillMissing.length}`,
  )
  for (const form of stillMissing) {
    unresolved.push({ no: `${form.api_sortno}`, name: `${form.api_name}`, candidateIds: [form.api_id], gap: '三维全缺' })
  }
  if (unresolved.length) {
    const reviewDir = path.join(root, 'assets', 'review')
    mkdirSync(reviewDir, { recursive: true })
    writeFileSync(
      path.join(reviewDir, 'wikiwiki-ship-max.unresolved.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), entries: unresolved }, null, 2),
    )
  }
  return lodeBuild(out, wikiwikiLastModified(raw))
}

const parseWikiwikiExpedition = async (raw) =>
  lodeBuild(parseWikiwikiExpeditionPage(raw), wikiwikiLastModified(raw))

// ---- wikiwiki 任務（前提任務链，日文一手）----
//
// 页清单固定为常驻分类页 + 新着（期间限定不收：限时任务的判定口径本来就不同）。
// 分类页是权威；新着页只补分类页还没收进去的最新任务，同码不覆盖。
const WIKIWIKI_QUEST_PAGES = [
  '任務/編成任務',
  '任務/出撃任務',
  '任務/出撃定期',
  '任務/演習任務',
  '任務/遠征任務',
  '任務/補給入渠任務',
  '任務/工廠任務',
  '任務/改装任務',
  '任務/ケッコンカッコカリ任務',
]
const WIKIWIKI_QUEST_NEWEST_PAGE = '任務/新着任務'

const parseWikiwikiQuests = async () => {
  const cacheDir = path.join(os.tmpdir(), 'kanso-wikiwiki-quest-cache', jstDate())
  mkdirSync(cacheDir, { recursive: true })
  const out = {}
  const allWarnings = []
  let latest = null
  const mergePage = (title, { authoritative }) => async () => {
    const page = await fetchWikiwikiPage(title, cacheDir)
    if (page.missing) {
      allWarnings.push(`${title}: 页面不存在`)
      return 0
    }
    const modified = wikiwikiLastModified(page.html)
    if (modified && (!latest || Date.parse(modified) > Date.parse(latest))) latest = modified
    const { entries, warnings } = parseWikiwikiQuestPage(page.html, page.pageName)
    allWarnings.push(...warnings)
    let added = 0
    for (const entry of entries) {
      if (out[entry.code]) {
        // 同码重复：分类页之间不该撞码；新着页与分类页重复属正常，不覆盖
        if (authoritative && out[entry.code].nameJp !== entry.nameJp) {
          allWarnings.push(
            `${title}: ${entry.code} 与 ${out[entry.code].page} 撞码且名字不同（${entry.nameJp} vs ${out[entry.code].nameJp}）`,
          )
        }
        continue
      }
      const record = {
        code: entry.code,
        nameJp: entry.nameJp,
        pre: entry.pre,
        condRaw: entry.condRaw.slice(0, 400),
        page: entry.page,
      }
      if (entry.mentioned.length) record.mentioned = entry.mentioned
      if (entry.uncertain) record.uncertain = true
      out[entry.code] = record
      added++
    }
    return added
  }
  for (const title of WIKIWIKI_QUEST_PAGES) {
    const added = await mergePage(title, { authoritative: true })()
    console.log(`[lodes]   ${title}: 收 ${added} 条`)
  }
  const newest = await mergePage(WIKIWIKI_QUEST_NEWEST_PAGE, { authoritative: false })()
  if (newest) console.log(`[lodes]   ${WIKIWIKI_QUEST_NEWEST_PAGE}: 补最新 ${newest} 条`)
  for (const warning of allWarnings) console.warn(`[lodes]   ⚠ ${warning}`)
  const total = Object.keys(out).length
  const withPre = Object.values(out).filter((entry) => entry.pre.length).length
  if (total < 500) {
    throw new Error(`wikiwiki 任務仅收 ${total} 条（预期至少 500）——页面结构可能变了`)
  }
  // EO 公证：周期任务历史上重编过号（任務/定期任務のID変更一覧），code 不能裸信。
  // 同 code 下 wikiwiki 名与 EO 名对不上的标 aligned:false，运行时合并只用公证过的。
  const eoQuests = packData('eo-quests')
  const eoByCode = new Map(
    (Array.isArray(eoQuests) ? eoQuests : []).map((quest) => [`${quest.code}`.trim(), quest]),
  )
  let misaligned = 0
  let unverified = 0
  for (const entry of Object.values(out)) {
    const peer = eoByCode.get(entry.code)
    if (!peer) {
      entry.aligned = false
      unverified++
    } else if (normalizeJpName(entry.nameJp) !== normalizeJpName(peer.name_jp)) {
      entry.aligned = false
      misaligned++
      console.warn(`[lodes]   ⚠ ${entry.code} 名字与 EO 不符：${entry.nameJp} vs ${peer.name_jp}`)
    }
  }
  console.log(
    `[lodes]   wikiwiki 任務：共 ${total} 条，其中 ${withPre} 条带前提链 / ` +
      `EO 公证不符 ${misaligned} · 无从公证 ${unverified}`,
  )
  return lodeBuild(out, latest)
}

const parseKcnavRouting = async () => {
  const imported = loadKcnavRoutingExport(process.env.KANSO_KCNAV_EXPORT)
  return lodeBuild(imported.data, imported.upstreamUpdatedAt)
}

const parseWikiwikiRouting = async () => {
  const cacheDir = path.join(os.tmpdir(), 'kanso-map-intel-cache', jstDate())
  const imported = await fetchWikiwikiRouting({
    cacheDir,
    minIntervalMs: 10_500,
    mapLast: loadNormalMapLast(root),
  })
  return lodeBuild(imported.data, imported.upstreamUpdatedAt)
}

const parseWikiwikiAbyssVoice = async () => {
  const ships = loadVoiceMasterShips().filter(
    (ship) => Number(ship?.api_id) >= 1_500 && ship?.api_name,
  )
  const idsByName = new Map()
  for (const ship of ships) {
    const name = `${ship.api_name}`.trim()
    idsByName.set(name, [...(idsByName.get(name) ?? []), Number(ship.api_id)])
  }
  const knownMaxByName = new Map()
  for (const [voiceId, raw] of Object.entries(packData('subtitle-enemies'))) {
    const entries = Array.isArray(raw) ? raw : [raw]
    for (const entry of entries) {
      const name = `${entry?.name ?? ''}`.trim()
      const ids = idsByName.get(name) ?? []
      const embedded = ids.filter((id) => {
        const resourceId = id >= 1_500 && id < 2_000 ? `${id - 1_000}`.padStart(4, '0') : `${id}`
        return `${voiceId}`.includes(resourceId)
      })
      if (embedded.length) {
        knownMaxByName.set(name, Math.max(knownMaxByName.get(name) ?? 0, ...embedded))
      }
    }
  }
  for (const [id, lines] of Object.entries(packData('kcwiki-voice'))) {
    const mstId = Number(id)
    const ship = ships.find((entry) => Number(entry.api_id) === mstId)
    if (!ship || !Array.isArray(lines) || !lines.length) continue
    const name = `${ship.api_name}`.trim()
    knownMaxByName.set(name, Math.max(knownMaxByName.get(name) ?? 0, mstId))
  }
  // 普通量产深海舰没有语音；名称中出现这些词的特殊个体才进入页面核对。
  // 最终仍以页面确有「セリフ」表且列出精确 No. 为准，不靠名称直接判定有声。
  const likelyVoiceName = /(?:鬼|姫|水鬼|水姫|棲|妹|首鬼|単騎|ラ級|ム級|ヰ級|ウ級)/
  const titles = [...idsByName.entries()]
    .filter(
      ([name, ids]) =>
        likelyVoiceName.test(name) &&
        ids.some((id) => id > (knownMaxByName.get(name) ?? 0)),
    )
    .map(([name]) => name)
    .sort((left, right) => {
      const leftCurrent = (idsByName.get(left) ?? []).some(
        (id) => id >= CURRENT_ABYSS_ORIGINAL_FROM,
      )
      const rightCurrent = (idsByName.get(right) ?? []).some(
        (id) => id >= CURRENT_ABYSS_ORIGINAL_FROM,
      )
      return Number(leftCurrent) - Number(rightCurrent) || left.localeCompare(right, 'ja')
    })
  const out = {}
  let pages = 0
  let missingPages = 0
  let emptyPages = 0
  const cacheDir = path.join(os.tmpdir(), 'kanso-wikiwiki-abyss-voice-cache', jstDate())
  mkdirSync(cacheDir, { recursive: true })

  for (const title of titles) {
    const current = (idsByName.get(title) ?? []).some(
      (id) => id >= CURRENT_ABYSS_ORIGINAL_FROM,
    )
    const transport = current ? 'original' : 'mirror'
    const transportCache = path.join(cacheDir, transport)
    mkdirSync(transportCache, { recursive: true })
    const page = await fetchWikiwikiPage(
      title,
      transportCache,
      current
        ? undefined
        : {
            baseUrl: 'https://w.kcwiki.moe/',
            sourceLabel: 'wikiwiki 只读镜像',
          },
    )
    if (page.missing) {
      missingPages++
    } else {
      const parsed = parseWikiwikiAbyssVoicePage(page.html, page.pageName)
      const exactIds = new Set(idsByName.get(title) ?? [])
      const matchedIds = parsed.ids.filter((id) => exactIds.has(id))
      if (parsed.lines.length && matchedIds.length) {
        pages++
        for (const id of matchedIds) {
          out[id] = parsed.lines.map((line) => ({ ...line, transport }))
        }
      } else {
        emptyPages++
      }
    }
  }

  const lineCount = Object.values(out).reduce((sum, lines) => sum + lines.length, 0)
  if (titles.length && !Object.keys(out).length) {
    throw new Error(`wikiwiki 深海台词核对 ${titles.length} 页却无一命中——页面结构可能变了`)
  }
  console.log(
    `[lodes]   wikiwiki 深海台词：核对 ${titles.length} 页 / 命中 ${pages} 页、` +
      `${Object.keys(out).length} 个精确形态、${lineCount} 条 / ` +
      `无台词或无精确 No. ${emptyPages} 页${missingPages ? ` / 无对应页面 ${missingPages} 个` : ''}`,
  )
  return out
}

// ---- 带路条件（zh.kcwiki 每图的「带路条件」子页）----
//
// 舰C 的带路规则是固定的，所以做成快照包合适。
// 页面定位：先用「3-2」这类裸标题走重定向拿到规范页名（北方海域/3-2），
// 再取其 /带路条件 子页——不硬编「哪个区叫什么海域」，游戏加区时不用改代码。
//
// 源码有两种方言（裸 <table> HTML 与 wikitext 的 {{!}} 转义表），所以不解析 wikitext，
// 而是让 MediaWiki 的 action=parse 渲染成统一 HTML 再清洗。

// 解析器搬到 ./lib/kcwiki-routing.mjs（活动图与常规图同构，共用一份，且测试要能单独 import）。

/**
 * 活动图的「带路条件」子页清单。
 *
 * kcwiki 给活动图用的是**和常规图一模一样**的模板：`<活动页>/E-3/带路条件`，
 * 一张 `分歧点 | 条件` 的 wikitable（2026-08-26 逐页比对 E-1…E-5 与 3-2 的渲染 HTML 确认）。
 * 所以这里只负责「找到页名」，解析仍复用 parseRoutingHtml。
 *
 * 活动页名不硬编，取自 scripts/map-intel-events.json 的 active.kcwikiPage——
 * 下期活动改那一个字段就能重跑，不用动代码。子页也不猜编号：用 allpages 前缀列举，
 * 活动分期开图（62 期就是 E-1~3 先开、E-4~5 后开）时列到几张算几张。
 *
 * 包里的键跟全仓库一致用 `<mapAreaId>-<no>`（62-1…62-5）而不是 E-1：
 * lode 校验器 src/main/lode-validation.ts 的 SAFE_MAP 是 /^\d+-\d+$/，`E-1` 会被判非法；
 * poi-fcd-map 与 map-intel 的活动层也都是这个键。
 */
const kcwikiEventRoutingPages = async () => {
  let active = null
  try {
    active = JSON.parse(
      readFileSync(path.join(root, 'scripts', 'map-intel-events.json'), 'utf8'),
    )?.active ?? null
  } catch (e) {
    console.warn(`[lodes]   活动清单读不到，跳过活动图带路：${e.message}`)
    return new Map()
  }
  const page = active?.kcwikiPage
  const areaId = Number(active?.mapAreaId)
  if (!page || !Number.isFinite(areaId)) {
    console.log('[lodes]   map-intel-events.json 没有 kcwikiPage/mapAreaId，跳过活动图带路')
    return new Map()
  }
  const url =
    `${KCWIKI_API}?action=query&list=allpages&format=json&formatversion=2&aplimit=200` +
    `&apprefix=${encodeURIComponent(page)}`
  const json = await (await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })).json()
  const out = new Map()
  for (const p of json?.query?.allpages ?? []) {
    // 只认 `<活动页>/E-<数字>/带路条件`，把「奖励简析」「倍卡表」这些同前缀页排除掉
    const m = new RegExp(`^${page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/E-(\\d+)/带路条件$`).exec(
      p.title,
    )
    // 存父页（`<活动页>/E-1`），下面的取页循环统一再拼 `/带路条件`，和常规图同一条路径
    if (m) out.set(`${areaId}-${Number(m[1])}`, p.title.replace(/\/带路条件$/, ''))
  }
  console.log(
    out.size
      ? `[lodes]   活动「${page}」带路条件子页 ${out.size} 张：${[...out.keys()].join(', ')}`
      : `[lodes]   活动「${page}」还没有带路条件子页`,
  )
  return out
}

const parseKcwikiRouting = async () => {
  // 1) 裸标题 → 规范页名（走重定向，不硬编海域名）
  const codes = []
  for (let area = 1; area <= 9; area++) {
    for (let no = 1; no <= 8; no++) codes.push(`${area}-${no}`)
  }
  const canon = new Map()
  for (let i = 0; i < codes.length; i += 40) {
    const batch = codes.slice(i, i + 40)
    const url = `${KCWIKI_API}?action=query&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`
    const json = await (await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })).json()
    for (const r of json?.query?.redirects ?? []) canon.set(r.from, r.to)
    for (const p of json?.query?.pages ?? []) {
      if (!p.missing && !canon.has(p.title) && /^\d+-\d+$/.test(p.title)) canon.set(p.title, p.title)
    }
  }
  console.log(`[lodes]   海域页解析到 ${canon.size} 张常规图`)

  // 1.5) 活动图。常规图靠「裸标题重定向」定位，活动图没有 `62-1` 这种裸标题页，
  // 所以另走一条前缀列举（见 kcwikiEventRoutingPages）。抓不到就是 0 张，不影响常规图。
  const eventCanon = await kcwikiEventRoutingPages()
  const targets = [...canon, ...eventCanon]

  // 2) 逐图取渲染后的「带路条件」子页 + 内容真实年龄
  //
  // 时效纪律在这里格外要紧：这些页 2026-07 被机器人批量改过一次
  // （「文本替换 - 替换 {{Hide|标题=舰种缩写…」，只动了模板样板），
  // 页面 mtime 因此全是 2026-07-12，但表格内容其实多数停在 2021-10-06 那次批量导入。
  // 只看 mtime 会把 5 年前的带路当成上个月刚核对过的——所以额外走一遍修订史，
  // 取**最后一次非机器人编辑**作为「内容多新」，逐图写进包里给 UI 展示。
  const isBotEdit = (c) => /^文本替换/.test(c ?? '')
  const contentAgeOf = async (title) => {
    try {
      const url = `${KCWIKI_API}?action=query&prop=revisions&rvprop=timestamp|comment&rvlimit=30&format=json&formatversion=2&titles=${encodeURIComponent(title)}`
      const j = await (await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })).json()
      const revs = j?.query?.pages?.[0]?.revisions ?? []
      const human = revs.find((r) => !isBotEdit(r.comment))
      return (human ?? revs[0])?.timestamp?.slice(0, 10) ?? null
    } catch (_e) {
      return null
    }
  }

  const out = {}
  let ok = 0
  let okRegular = 0
  let nodes = 0
  let rules = 0
  const missing = []
  for (const [code, page] of targets) {
    const url = `${KCWIKI_API}?action=parse&prop=text&format=json&formatversion=2&disablelimitreport=1&page=${encodeURIComponent(`${page}/带路条件`)}`
    let parsed = null
    try {
      const json = await (await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })).json()
      if (json?.parse?.text) parsed = parseRoutingHtml(json.parse.text)
    } catch (e) {
      console.warn(`[lodes]   ${code} 取页失败：${e.message}`)
    }
    if (!parsed) {
      missing.push(code)
      continue
    }
    const subpage = `${page}/带路条件`
    out[code] = { ...parsed, page: subpage, contentDate: await contentAgeOf(subpage) }
    ok++
    if (!eventCanon.has(code)) okRegular++
    nodes += parsed.nodes.length
    rules += parsed.nodes.reduce((a, n) => a + n.rules.length, 0)
    process.stdout.write(`\r[lodes]   带路条件 ${ok}/${targets.length} 图`)
    await new Promise((r) => setTimeout(r, 200)) // 对 wiki 客气点
  }
  process.stdout.write('\n')
  if (missing.length) console.log(`[lodes]   无带路条件页/解析为空：${missing.join(', ')}`)
  // 门槛只看常规图：活动图开几张是随活动走的，拿它凑数会把「常规图解析崩了」盖过去。
  if (okRegular < 30) throw new Error(`带路条件仅 ${okRegular} 张常规图（预期 30+）——页面结构可能变了`)
  // 二期（2018-08-17 HTML5 大更新）之前的内容一律不收：那之前的带路规则已被改过。
  // 实测 2021-10-06 那批导入本就在二期之后，所以正常情况下这里应该一张都不剔。
  const PHASE2 = '2018-08-17'
  const stale = Object.entries(out).filter(([, v]) => v.contentDate && v.contentDate < PHASE2)
  for (const [code] of stale) delete out[code]
  if (stale.length) {
    console.log(`[lodes]   剔除二期前内容 ${stale.length} 图：${stale.map(([c]) => c).join(', ')}`)
  }
  const years = {}
  for (const v of Object.values(out)) years[v.contentDate?.slice(0, 4) ?? '?'] = (years[v.contentDate?.slice(0, 4) ?? '?'] ?? 0) + 1
  const eventOk = [...eventCanon.keys()].filter((code) => out[code]).length
  console.log(
    `[lodes]   带路条件：${Object.keys(out).length} 图（常规 ${okRegular} + 活动 ${eventOk}）` +
      ` / ${nodes} 分歧点 / ${rules} 条规则`,
  )
  console.log(`[lodes]   内容年份分布（最后一次非机器人编辑）：${JSON.stringify(years)}`)
  return out
}

const parseMapIntel = async () => {
  const shipsPack = JSON.parse(readFileSync(path.join(OUT_DIR, 'kcwiki-ships.json'), 'utf8'))
  const existing = path.join(OUT_DIR, 'map-intel.json')
  if (existsSync(existing)) {
    assertNoPendingMapIntelCandidate(existing, process.argv.includes('--force'))
  }
  const cacheDir = path.join(
    os.tmpdir(),
    'kanso-map-intel-cache',
    new Date().toISOString().slice(0, 10),
  )
  const data = await fetchMapIntel(shipsPack, {
    cacheDir,
    minIntervalMs: 10_500,
    mapLast: loadNormalMapLast(root),
  })
  if (existsSync(existing)) {
    const current = JSON.parse(readFileSync(existing, 'utf8'))
    const preserved = preserveEventMaps(data, current)
    const preservedLimited = preserveLimitedHistory(data, current)
    if (preserved) console.log(`[lodes]   保留活动维护包 ${preserved} 图（甲乙丙丁不改写）`)
    if (preservedLimited) console.log(`[lodes]   保留限定历史 ${preservedLimited} 条`)
  }
  return data
}

// ---- 常规海域敌编成（第一方汇编）----
//
// 三张票汇编成一份自家 schema：kcwiki「深海配置」直接填的 mstId、现行 map-intel
//（wikiwiki 标注名经定号流水线定号）、本机遭遇志。口径与独立性判据写在
// scripts/lib/map-enemy-comps.mjs 的文件头。
//
// 抓 37 图有当日缓存——一页 40~200 KB，重跑时不该再骚扰原站一遍。
// 编成汇编（map-enemy-comps）与掉落汇编（map-drops）读的是同一批页面，
// 走同一个当日缓存目录：`npm run lodes:fetch` 一次跑两个包时，第二个包直接吃缓存。
const kcwikiMapPagesCached = async () => {
  const cacheDir = path.join(os.tmpdir(), 'kanso-kcwiki-map-cache', jstDate())
  mkdirSync(cacheDir, { recursive: true })
  const force = process.argv.includes('--force')
  const pages = new Map()
  const contentDates = new Map()
  const cachedFetch = async (url, init) => {
    const file = path.join(cacheDir, `${encodeURIComponent(url).slice(-120)}.json`)
    if (!force && existsSync(file)) {
      const text = readFileSync(file, 'utf8')
      return { ok: true, __cached: true, json: async () => JSON.parse(text), text: async () => text }
    }
    const res = await fetch(url, init)
    if (!res.ok) return res
    const text = await res.text()
    writeFileSync(file, text, 'utf8')
    return { ok: true, json: async () => JSON.parse(text), text: async () => text }
  }
  const { pages: fetched, failed } = await fetchKcwikiMapPages({
    fetchImpl: cachedFetch,
    onProgress: (code, done, total) =>
      process.stdout.write(`\r[lodes]   海域页 ${done}/${total} ${code}      `),
  })
  process.stdout.write('\n')
  for (const [code, page] of fetched) pages.set(code, page)
  if (failed.length) {
    // 少一图就是少一图，不拿旧包冒充：整批失败要能看出来。
    console.warn(`[lodes]   取页失败 ${failed.length} 图：${failed.map((f) => f.code).join(', ')}`)
  }
  if (pages.size < 30) throw new Error(`只取到 ${pages.size} 张常规海域页（预期 37）——页面结构或站点可能变了`)
  for (const [code, page] of pages) {
    contentDates.set(code, await fetchKcwikiPageContentDate(page.title ?? code))
  }
  return { pages, contentDates }
}

/** 「上游多新」取 37 页里最近的一次非机器人编辑——单挑某一页的修订当整包时间戳
 *  会让健康度面板说谎（1-1 五年不动，5-6 每月都在改）。 */
const newestContentDate = (contentDates) =>
  [...contentDates.values()].filter(Boolean).sort().at(-1) ?? null

/** 冲突/待裁台账落 assets/review（gitignore 已排除 *.json），逐条等人裁。 */
const writeConflictLedger = (file, note, conflicts, fingerprintOf) => {
  const reviewDir = path.join(root, 'assets', 'review')
  mkdirSync(reviewDir, { recursive: true })
  writeFileSync(
    path.join(reviewDir, file),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note,
        conflicts: conflicts.map((conflict) => ({
          ...conflict,
          fingerprint: fingerprintOf(conflict),
        })),
      },
      null,
      1,
    ),
  )
  console.log(`[lodes]   待裁台账 ${conflicts.length} 条 → assets/review/${file}`)
}

// ---- 舰娘成长三维端点（第一方汇编）----
//
// 纯本地重组：基座是已经落盘的 `kcwiki-ships`，投票票是已经落盘的 `wikiwiki-ship-max`，
// 供值的分歧格来自源码里的补丁台账。**一个网络请求都不发**，所以 selfFetch 且不带 url 抓取。
// 完整口径写在 scripts/lib/ship-stats.mjs 的文件头。
const parseShipStats = async () => {
  const shipTable = packData('kcwiki-ships')
  if (!Object.keys(shipTable).length) {
    throw new Error('没有 kcwiki-ships.json，成长端点的基座票缺席——拒绝出包')
  }
  const wikiwikiTable = packData('wikiwiki-ship-max')
  const { data, stats, warnings, unresolved, suspects, gaps } = buildShipStats({
    shipTable,
    wikiwikiTable: Object.keys(wikiwikiTable).length ? wikiwikiTable : null,
    masterShips: loadMasterShips(),
  })
  for (const warning of warnings) console.warn(`[lodes]   ⚠ ${warning}`)
  console.log(
    `[lodes]   成长端点汇编：${stats.forms} 形态 / ${stats.cells} 格` +
      `（账本一手 ${stats.ledger} · 两 wiki 一致 ${stats.multi} · 分歧裁决 ${stats.patched} · ` +
      `单票 ${stats.single} · 缺 ${stats.gaps}；wikiwiki 投出 ${stats.voted} 票）`,
  )
  if (unresolved.length) {
    console.warn(
      `[lodes]   ⚠ ${unresolved.length} 格是**新出现**的两 wiki 分歧（不在补丁台账也不在挂牌清单里）——` +
        '出包值仍按基座，去 src/shared/ship-stats-patches.ts 补一条裁决',
    )
  }
  const reviewDir = path.join(root, 'assets', 'review')
  mkdirSync(reviewDir, { recursive: true })
  writeFileSync(
    path.join(reviewDir, 'ship-stats-conflicts.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note:
          '成长三维端点的待裁项。unresolved = 2026-08-22 逐格裁决之后**新**出现的两 wiki 分歧，' +
          '出包值仍按 kcwiki 基座，要么补补丁要么补挂牌，别静默；suspects = 已判定 wikiwiki 那一格' +
          '疑似解析/录入错、明知故犯地留在基座值上的格；gaps = 三张票都没有的格（出包就是缺，UI 如实说）。',
        unresolved,
        suspects,
        gaps,
      },
      null,
      2,
    ),
  )
  console.log(
    `[lodes]   待裁台账 ${unresolved.length} 条 / 挂牌 ${suspects.length} 条 / 缺口 ${gaps.length} 条` +
      ' → assets/review/ship-stats-conflicts.json',
  )
  return lodeBuild(data, null)
}

const parseMapEnemyComps = async () => {
  const { pages, contentDates } = await kcwikiMapPagesCached()

  const legacyFile = path.join(OUT_DIR, 'map-intel.json')
  const legacy = existsSync(legacyFile)
    ? JSON.parse(readFileSync(legacyFile, 'utf8'))?.data?.maps ?? {}
    : {}
  if (!Object.keys(legacy).length) {
    console.warn('[lodes]   没有 map-intel.json，第二张票缺席——本轮全部条目会记成单源')
  }
  const ledger = loadLedgerCompVotes()

  const { data, stats, conflicts, warnings } = buildMapEnemyComps({
    pages,
    legacy,
    ledger,
    checkedAt: jstDate(),
    contentDates,
  })
  for (const warning of warnings) console.warn(`[lodes]   ⚠ ${warning}`)
  console.log(
    `[lodes]   敌编成汇编：${stats.maps} 图 / ${stats.nodes} 点 / ${stats.comps} 编成` +
      `（多源一致 ${stats.multi} · 单源待印证 ${stats.single} · 冲突待裁 ${stats.conflict}）`,
  )
  console.log(
    `[lodes]   票源：kcwiki 独有 ${stats.kcwikiOnly} · 现包独有 ${stats.legacyOnly} · ` +
      `本机遭遇志印证 ${stats.ledgerBacked} · 带经验 ${stats.withExp} · 带 wiki 标注 ${stats.withLabels}`,
  )

  // **不在这里二选一**：脚本按基座源（kcwiki）取值并给该条打 conflict 标，
  // 裁决权留给用户。
  writeConflictLedger(
    'map-enemy-comps-conflicts.json',
    '源间互斥、等人裁。fingerprint 变了说明上游改过那一格，旧裁决作废要重核。',
    conflicts,
    mapEnemyCompConflictFingerprint,
  )
  const newest = newestContentDate(contentDates)
  return lodeBuild(data, newest ? `${newest}T00:00:00Z` : null)
}

// ---- 常规海域掉落（第一方汇编）----
//
// 与敌编成同族的三张票，但**票的独立性判据不一样**：kcwiki 的常规海域页页脚
// 37/37 都自述「主要数据来源为日wiki」，所以这一域里两 wiki 一致只算「同源转录」，
// 不升到多源印证。完整口径写在 scripts/lib/map-drops.mjs 的文件头。
const parseMapDrops = async () => {
  const { pages, contentDates } = await kcwikiMapPagesCached()

  const legacyFile = path.join(OUT_DIR, 'map-intel.json')
  const legacy = existsSync(legacyFile)
    ? JSON.parse(readFileSync(legacyFile, 'utf8'))?.data?.maps ?? {}
    : {}
  if (!Object.keys(legacy).length) {
    // 掉落域的现包票占 2041 条独有条目（5-6 整图、7-5 大半都只有它）。
    // 缺了它不是「少一层印证」，是当场把那几图打回空——宁可整批失败。
    throw new Error('没有 map-intel.json，掉落汇编的第二张票缺席——5-6/7-5 会整图归零，拒绝出包')
  }
  const shipTable = packData('kcwiki-ships')
  if (!Object.keys(shipTable).length) {
    throw new Error('没有 kcwiki-ships.json，中文舰名无从解号——拒绝出包')
  }
  const ledger = loadLedgerDropVotes()

  const { data, stats, conflicts, warnings, unresolved } = buildMapDrops({
    pages,
    legacy,
    ledger,
    shipTable,
    checkedAt: jstDate(),
    contentDates,
  })
  for (const warning of warnings) console.warn(`[lodes]   ⚠ ${warning}`)
  // 名字解不出来 = 静默少一条掉落线索，界面上一点异常都看不出来
  //（2026-08-11「杉@1-5 被静默丢掉」就是这么丢的）。一律硬错，别让它过去。
  if (unresolved.length) {
    const lines = unresolved
      .map((entry) => `${entry.name}（${entry.via}）@ ${entry.at.slice(0, 6).join(' ')}`)
      .join('\n    ')
    throw new Error(
      `掉落表里有 ${unresolved.length} 个中文舰名解不出 mstId，拒绝出包：\n    ${lines}\n` +
        '  → 解不出就在 scripts/lib/map-drops.mjs 的 KCWIKI_DROP_NAME_ALIASES 里补一条，' +
        '并写清锚定证据（现包同一 (图, 点) 也有这个号）。',
    )
  }
  console.log(
    `[lodes]   掉落汇编：${stats.maps} 图 / ${stats.nodes} 点 / ${stats.ships} 舰次` +
      `（多源一致 ${stats.multi} · 同源转录 ${stats.transcribed} · 单源待印证 ${stats.single}）`,
  )
  console.log(
    `[lodes]   票源：kcwiki 独有 ${stats.kcwikiOnly} · 现包独有 ${stats.legacyOnly} · ` +
      `本机遭遇志印证 ${stats.ledgerBacked} · 空掉落点 ${stats.emptyNodes} · 别名命中 ${stats.aliasHits}`,
  )

  // 迁移护栏：丢失的原有掉落条目必须为 0。汇编把现包票原样收进来了，这里只是
  // **逐条核一遍**——「照收不丢」是口径，口径要有人当场验，不能靠相信。
  //
  // 唯一的例外是 `LEGACY_DROP_FORM_CORRECTIONS` 那几条**逐条裁过的改钉**：现包那一票
  // 记错了形态，改钉之后旧号当然就不在了。所以比对时把旧号换成新号再看——
  // 「那一格还有没有这条船」照旧要成立，只是它现在指着对的那个形态。
  let lost = 0
  let gained = 0
  const migrated = (id) => correctLegacyDropForm(id)
  for (const [code, entry] of Object.entries(legacy)) {
    if (!entry.nodes) continue
    for (const [node, value] of Object.entries(entry.nodes)) {
      const now = new Set((data.maps[code]?.nodes?.[node]?.ships ?? []).map((ship) => ship.id))
      for (const ship of value.ships ?? []) if (!now.has(migrated(ship.id))) lost += 1
    }
  }
  for (const [code, entry] of Object.entries(data.maps)) {
    for (const [node, value] of Object.entries(entry.nodes)) {
      const was = new Set(
        (legacy[code]?.nodes?.[node]?.ships ?? []).map((ship) => migrated(ship.id)),
      )
      for (const ship of value.ships) if (!was.has(ship.id)) gained += 1
    }
  }
  console.log(`[lodes]   迁移对照：丢失原有条目 ${lost} · 新增 ${gained}`)
  if (lost) throw new Error(`掉落汇编丢了 ${lost} 条原有条目——单源照收不丢这条口径被破了，拒绝出包`)

  // 无主的旧裁决：表里写着、这一轮一条都认领不上。不报的话，上游改了那一格只表现成
  // 「又多了几条待裁」，谁也不知道是有一条裁决作废了。
  for (const stale of staleMapDropVerdicts(conflicts)) {
    console.warn(
      `[lodes]   ⚠ 裁决认领不上（指纹变了，旧裁决作废要重核）：${stale.fingerprint}`,
    )
  }
  writeConflictLedger(
    'map-drops-conflicts.json',
    '掉落域的待裁项：未列出 ≠ 确认不掉，所以「一方收录另一方沉默」是覆盖差不是冲突，' +
      '这里只收会互相否定的那几类。fingerprint 变了说明上游改过那一格，旧裁决作废要重核。' +
      '带 verdict 的是已结案的：裁语与裁定日期由 scripts/lib/map-drops.mjs 的 ' +
      'RESOLVED_MAP_DROP_CONFLICTS 按指纹认领贴上，条目本身不删——删掉只会下一轮又冒出来当新的待裁项。',
    conflicts,
    mapDropConflictFingerprint,
  )
  const newest = newestContentDate(contentDates)
  return lodeBuild(data, newest ? `${newest}T00:00:00Z` : null)
}

// ---- 任务库（简中，zh.kcwiki「任务」+「任务/最新任务」）----
//
// 2026-08-21 从 kcwikizh/kcQuests 的 quests-scn.json 换过来。那个仓没有 LICENSE、
// 连 README 都没有，而它 src/kcwiki/constants.py 里的 URL_LIST 明写着内容就是
// action=raw 抓的这两张 zh.kcwiki 页——数据本体一直在站点的 CC BY-NC-SA 3.0 底下，
// 卡住随包分发的只是中间那一层。去掉它，同一份内容就能随发行版走。
//
// 换源前拿旧包逐条对过：644 条 id 一条不多一条不少，546 条六个字段全等，
// 剩下 98 条只差在「奖励」里的装备名——kcQuests 用的是 kcdata（同样无许可，
// 且大量条目还留着日文原名：三式弾改 / 12.7cm連装砲D型改二 / SK レーダー），
// 我们改用 zh.kcwiki 的装备模块，名字与 kuma 其余各处显示的装备名从此对得上
//（鼓筒（运输用）/ 熟练瞭望员 / 九一式穿甲弹——旧包写的是 桶(运输用) /
// 熟练见张员 / 九一式撤甲弹）。
const parseQuestsScn = async () => {
  const equipModule = '模块:舰娘装备数据改'
  const titles = [...QUEST_PAGE_TITLES, equipModule]
  const url =
    `${KCWIKI_API}?action=query&prop=revisions&rvprop=content%7Ctimestamp&format=json` +
    `&titles=${encodeURIComponent(titles.join('|'))}`
  const res = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const pages = new Map()
  for (const page of Object.values(json?.query?.pages ?? {})) {
    const revision = page?.revisions?.[0]
    if (revision?.['*']) pages.set(page.title, { text: revision['*'], timestamp: revision.timestamp })
  }
  for (const title of titles) {
    if (!pages.has(title)) throw new Error(`zh.kcwiki 上取不到「${title}」`)
  }

  const equipNames = new Map()
  for (const row of Object.values(parseLuaTable(pages.get(equipModule).text, 'd.equipDataTb'))) {
    if (Number(row?.['ID']) > 0 && row?.['中文名']) equipNames.set(Number(row['ID']), row['中文名'])
  }
  if (equipNames.size < 500) throw new Error(`装备名表只有 ${equipNames.size} 条（基线 500）`)

  const { quests, stats } = parseKcwikiQuestPages(
    QUEST_PAGE_TITLES.map((title) => pages.get(title).text),
    equipNames,
  )
  // 旧包 644 条。低于 600 说明页面改版或只取到半截，宁可整包失败也不出残包。
  if (stats.quests < 600) {
    throw new Error(`任务库只解析出 ${stats.quests} 条（基线 600）——任务页多半改版了`)
  }
  console.log(
    `[lodes]   任务库:${stats.quests} 条 / 模板 ${stats.templates} 次（分类节重复 ${stats.duplicates}）` +
      ` / 未定号跳过 ${stats.withoutId} / 装备名表 ${equipNames.size}`,
  )
  // 「多新」取两张任务页里更晚的那次编辑（装备模块只提供名字，不算内容年龄）
  const latest = QUEST_PAGE_TITLES.map((title) => pages.get(title).timestamp)
    .filter(Boolean)
    .sort()
    .pop()
  return lodeBuild(quests, latest ?? null)
}

const parseKcwikiLocalization = async () => fetchLocalization(root)
const parseKcwikiQuestReq = async (raw) => parseKcwikiQuestRequirements(raw)
const parsePoiQuestGoal = async (raw) => parsePoiQuestGoalCson(raw)

// 活动倍卡：取 MediaWiki 的 wikitext 原文再结构化。
// 走 api.php 而不是渲染后 HTML，也不经任何转述层——实测 WebFetch 那类摘要会把
// 1.7063~1.7064 这种值压成「1.03-1.38」的范围。
const parseEventBonus = (raw) => {
  const wikitext = raw?.parse?.wikitext
  if (typeof wikitext !== 'string' || !wikitext.includes('倍卡表')) {
    throw new Error('页面里找不到「倍卡表」章节——活动页名多半变了，检查 lode-sources 的 page 参数')
  }
  const pack = buildEventBonusPack(wikitext)
  if (!Object.keys(pack.events).length) throw new Error('倍卡表章节解析为空')
  return pack
}

// 舰娘中文口径:直取 zh.kcwiki「模块:舰娘数据」。
//
// 2026-08-21 从 kcwikizh/kcwiki-luatable 的 gh-pages 镜像 ships.json 换过来——
// 那个中转仓没有 LICENSE(且 LuatableBot 还往里掺了 kcdata/get_kaisou_data/
// akashi/wikiwiki 爬取的成分),而站点原模块受 CC BY-NC-SA 3.0 覆盖,
// 换个取数口同一份数据就能随发行版分发。字段名与镜像一字不差,消费端零改动。
//
// 下限 800:旧镜像是 773 条、模块实测 857 条。低于 800 说明页面改版或只取到半截,
// 宁可整包失败也不出残包(fetch-lodes 的通例)。
const parseKcwikiShips = (raw) => {
  const table = parseLuaTable(raw, 'd.shipDataTb')
  const entries = Object.entries(table)
  const bad = entries.filter(
    ([key, row]) =>
      !isKcwikiEntryKey(key) ||
      !row ||
      typeof row !== 'object' ||
      !(Number(row['ID']) > 0) ||
      !row['日文名'] ||
      !row['中文名'],
  )
  if (bad.length) {
    throw new Error(`模块:舰娘数据 有 ${bad.length} 条缺 ID/名字或键名异常，首条 ${bad[0][0]}`)
  }
  if (entries.length < 800) {
    throw new Error(`模块:舰娘数据 只解析出 ${entries.length} 条（基线 800）——页面改版或只取到半截`)
  }
  const ids = new Set(entries.map(([, row]) => Number(row['ID'])))
  console.log(`[lodes]   舰娘数据:${entries.length} 个形态 / ${ids.size} 个 mstId`)
  return table
}

// 装备加成（额外收益*）：中文名字空间 → 我们自己的 id 空间。
//
// 名字词表与依据在 scripts/lib/fit-bonus-vocab.mjs，转换在 scripts/lib/kcwiki-fit-bonus.mjs。
// 这里只负责把两份原料凑齐：装备模块（主循环已抓，raw）与舰娘模块（本函数自己取，
// 用来拿中文名/舰级名/上游自己那套舰种编号）。缺主数据快照就失败——名字对不上
// 宁可不出包，也不出一份「看着完整、id 却是猜的」的残包。
const parseKcwikiFitBonus = async (raw) => {
  const masterShips = loadStart2MasterArray('api_mst_ship').filter(
    (ship) => Number(ship.api_id) > 0 && Number(ship.api_id) < 1_500 && Number(ship.api_sortno) > 0,
  )
  const masterStypes = loadStart2MasterArray('api_mst_stype')
  if (!masterShips.length || !masterStypes.length) {
    throw new Error('装备加成解析需要 api_start2 主数据快照（s2.json）——名字对不上宁可失败，不猜')
  }
  const shipModule = await (async () => {
    const url = 'https://zh.kcwiki.cn/index.php?title=%E6%A8%A1%E5%9D%97:%E8%88%B0%E5%A8%98%E6%95%B0%E6%8D%AE&action=raw'
    const response = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
    if (!response.ok) throw new Error(`模块:舰娘数据: HTTP ${response.status}`)
    return response.text()
  })()
  const kcwikiShips = Object.values(parseLuaTable(shipModule, 'd.shipDataTb'))
  const resolver = createFitBonusNameResolver({
    masterShips,
    masterStypes,
    kcwikiShips,
    fold: foldCjkVariants,
  })
  // 上游原文留一份给护栏测试的「504 个名字逐个有着落」那条用。
  // 落 assets/review（已 gitignore）：原文是上游内容，不入仓、不随包。
  const reviewDir = path.join(root, 'assets', 'review')
  mkdirSync(reviewDir, { recursive: true })
  writeFileSync(path.join(reviewDir, 'fit-bonus-source.raw.txt'), raw, 'utf8')
  const { data, report } = buildFitBonusPack(parseLuaTable(raw, 'd.equipDataTb'), resolver)
  if (report.equips < 250) {
    throw new Error(`装备加成只解析出 ${report.equips} 件装备（基线 250）——上游改版或只取到半截`)
  }
  console.log(
    `[lodes]   装备加成:${report.equips} 件装备 / ${report.rules} 条规则` +
      (report.unresolved ? ` / ⚠ 挂牌 ${report.unresolved} 条` : ' / 零挂牌'),
  )
  for (const note of report.notes) console.log(`[lodes]   · ${note}`)
  for (const row of data.unresolved) {
    console.warn(`[lodes]   ⚠ #${row.equipId} 额外收益${row.row}：${row.reason}`)
  }
  return data
}

// 改修表:装备/舰/道具名都必须对上主数据快照,解析不出就抛错(缺主数据快照时
// 直接失败,不能拿旧包或残缺结果冒充新的)。上游「多新」取页脚 Last-modified。
const parseWikiwikiKaishu = (raw) => {
  const items = loadStart2MasterArray('api_mst_slotitem').filter((i) => Number(i.api_id) < 1500)
  const ships = loadStart2MasterArray('api_mst_ship').filter((s) => Number(s.api_id) < 1500)
  const useitems = loadStart2MasterArray('api_mst_useitem')
  if (!items.length || !ships.length || !useitems.length) {
    throw new Error('改修表解析需要 api_start2 主数据快照（s2.json）——名字对不上宁可失败，不猜')
  }
  const { rows, upstreamUpdatedAt, stats } = parseKaishuHtml(raw, { items, ships, useitems })
  console.log(
    `[lodes]   改修表:${stats.equips} 件装备 / ${stats.dataRows} 行 / 二番舰不要 ${stats.noneHelperEquips} 件` +
      (stats.warnings.length ? ` / 警告 ${stats.warnings.length} 条` : ''),
  )
  for (const warning of stats.warnings) console.warn(`[lodes]   ⚠ ${warning}`)
  return { __kansoLodeBuild: true, data: rows, upstreamUpdatedAt }
}

// 舰娘档案补缺:只针对 kcwiki-ships 没收的形态抓逐舰页,
// 解析 CV/画师/舰级/初期装备。kcwiki 有条目的形态不抓——实体级回退,不做混拼。
//
// 目标集合是算出来的(主数据友方形态 ─ kcwiki 已收 ID),所以上游补齐一个就少抓一个。
// 2026-08-21 kcwiki-ships 换源到 zh.kcwiki 原模块后这里从 89 个直接掉到 5 个
// ——「上游赶上后自补退役」是设计终局,别看见数字变小就以为抓漏了。
const parseWikiwikiShipProfile = async () => {
  const ships = loadVoiceMasterShips().filter(
    (ship) => Number(ship?.api_id) > 0 && Number(ship?.api_id) < 1_500 && Number(ship?.api_sortno) > 0 && ship?.api_name,
  )
  const items = loadStart2MasterArray('api_mst_slotitem').filter((item) => Number(item.api_id) < 1_500)
  if (!ships.length || !items.length) {
    throw new Error('舰娘档案补缺需要 api_start2 主数据快照(s2.json)——没有就失败,不猜')
  }
  const kcIds = new Set(
    Object.values(packData('kcwiki-ships'))
      .map((entry) => Number(entry?.ID))
      .filter((id) => id > 0),
  )
  const targets = ships.filter((ship) => !kcIds.has(Number(ship.api_id)))
  const itemByNorm = buildItemNameIndex(items)
  const cacheDir = sharedWikiwikiShipCache()
  mkdirSync(cacheDir, { recursive: true })
  // 同名形态(Glorious改 ×2:巡洋戦艦/正規空母)的页面带舰种注记;
  // 裸名页属于另一形态,同名多形态时绝不落回裸名——错档案比缺档案糟
  const nameCount = new Map()
  for (const ship of ships) {
    const key = `${ship.api_name}`.trim()
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1)
  }
  const STYPE_ANNOTATION = new Map([[8, '巡洋戦艦'], [11, '正規空母'], [18, '正規空母']])
  const out = {}
  let missing = 0
  const warned = []
  const stypeNames = new Map(
    loadStart2MasterArray('api_mst_stype').map((entry) => [Number(entry.api_id), `${entry.api_name}`]),
  )
  for (const form of targets) {
    const bare = `${form.api_name}`.trim()
    const ambiguous = (nameCount.get(bare) ?? 0) > 1
    const annotation = STYPE_ANNOTATION.get(Number(form.api_stype))
    // 同名形态:先试注记页;注记页不存在时裸名页只属于**初始形态**——
    // 用页内「N番艦」后的舰种字样对主数据舰种核验,对不上就当缺
    const titles = ambiguous && annotation ? [`${bare}(${annotation})`, bare] : [bare]
    let hit = false
    for (const [titleIndex, title] of titles.entries()) {
      const page = await fetchWikiwikiPage(title, cacheDir)
      if (page.missing) continue
      const { profile, warnings } = parseShipProfilePage(page.html, { itemByNorm })
      warned.push(...warnings.map((w) => `${form.api_name}: ${w}`))
      const stypeName = stypeNames.get(Number(form.api_stype)) ?? ''
      if (titleIndex > 0 && ambiguous && (!profile.stypeText || !profile.stypeText.includes(stypeName))) {
        warned.push(`${bare}: 裸名页舰种「${profile.stypeText ?? '?'}」与该形态(${stypeName})不符,不收`)
        continue
      }
      delete profile.stypeText
      if (Object.keys(profile).length) {
        out[form.api_id] = { shipId: Number(form.api_id), nameJp: `${form.api_name}`, ...profile }
        hit = true
      }
      break
    }
    if (!hit && !out[form.api_id]) missing++
  }
  const got = Object.values(out)
  console.log(
    `[lodes]   舰娘档案补缺:目标 ${targets.length} 形态 / 命中 ${got.length}` +
      `(CV ${got.filter((e) => e.cv).length} · 画师 ${got.filter((e) => e.artist).length} · ` +
      `舰级 ${got.filter((e) => e.shipClass).length} · 初期装备 ${got.filter((e) => e.initialEquips).length})` +
      ` / 无页面 ${missing}${warned.length ? ` / 警告 ${warned.length}` : ''}`,
  )
  for (const warning of warned) console.warn(`[lodes]   ⚠ ${warning}`)
  return lodeBuild(out, null)
}


// ---- 道具历年兑换（wikiwiki アイテム 单页；2026-08-18 用户提议的「可兑换列表」）----
// 小节标题与 api_mst_useitem 日文名精确对齐才收；解析细节见 lib/wikiwiki-item-exchange.mjs。
// 阈值护栏：季节收集物至少 4 项、总行数至少 40 行——低于视为页面改版，宁可失败不出残包。
// 战斗曲曲名（zh.kcwiki「拆包BGM列表」，2026-08-24）。判据与「为什么只认游戏原文件名」
// 都写在 scripts/lib/kcwiki-bgm.mjs 顶部；这里只做「疑似改版就整包失败」的基线守门。
const parseKcwikiBgm = (text) => {
  const { battle, reused, unnamed, warnings } = parseKcwikiBgmList(text)
  const named = Object.keys(battle).length
  // 2026-08-24 全页基线：97 个带名资源号（109–278，按活动时序单调递增）、
  // 52 个官方尚未公布曲名、2 个号被后续活动复用。低于基线视为页面改版或
  // 文件名惯例又变了——宁可失败，不出残包（残包会让顶栏安静地少几首曲名）。
  if (named < 80) {
    throw new Error(`拆包BGM列表疑似解析失败：只认出 ${named} 个带名资源号（基线 80）`)
  }
  console.log(
    `[lodes]   战斗曲曲名:${named} 个资源号 / 官方未公布 ${unnamed.length} / 号被复用 ${Object.keys(reused).length}`,
  )
  for (const warning of warnings) console.warn(`[lodes]   ⚠ ${warning}`)
  return { schemaVersion: 1, battle }
}

const parseWikiwikiItemExchange = async () => {
  const useitems = loadStart2MasterArray('api_mst_useitem')
  if (!useitems.length) {
    throw new Error('道具兑换解析需要 api_start2 主数据快照（s2.json）——名字对不上宁可失败，不猜')
  }
  const cacheDir = path.join(os.tmpdir(), 'kanso-wikiwiki-item-cache', jstDate())
  mkdirSync(cacheDir, { recursive: true })
  const page = await fetchWikiwikiPage('アイテム', cacheDir)
  if (page.missing || !page.html) throw new Error('wikiwiki アイテム 页取不到')
  const { entries, warnings } = parseItemExchangePage(page.html, useitems)
  const count = Object.keys(entries).length
  const yearlyRows = Object.values(entries).reduce((sum, entry) => sum + (entry.yearly?.length ?? 0), 0)
  const fixedRows = Object.values(entries).reduce((sum, entry) => sum + (entry.fixed?.length ?? 0), 0)
  const historyRows = Object.values(entries).reduce((sum, entry) => sum + (entry.history?.length ?? 0), 0)
  const overviewCount = Object.values(entries).filter((entry) => entry.overview).length
  const usageCount = Object.values(entries).filter((entry) => entry.usage?.length).length
  // 2026-08-18 全页实测基线：秋刀魚年次表 37 行 + 菱餅固定表 3 行 +
  // 活动史（節分の豆/南瓜/てるてる坊主/Xmas 盒）合计 20+ 年份行 +
  // 总表詳細（具体作用）40+ 件 + 用途块 10+ 件。低于基线视为页面改版，
  // 宁可失败不出残包。
  if (count < 40 || yearlyRows < 30 || fixedRows < 3 || historyRows < 15 || overviewCount < 35 || usageCount < 8) {
    throw new Error(
      `道具兑换表疑似解析失败：${count} 项 / 年次 ${yearlyRows} / 固定 ${fixedRows} / 活动史 ${historyRows} / 作用 ${overviewCount} / 用途 ${usageCount}` +
        '（基线 40 项 / 30 / 3 / 15 / 35 / 8）',
    )
  }
  console.log(
    `[lodes]   道具兑换:${count} 项 / 年次 ${yearlyRows} / 固定 ${fixedRows} / 活动史 ${historyRows} / 作用 ${overviewCount} / 用途 ${usageCount}` +
      (warnings.length ? ` / 警告 ${warnings.length}` : ''),
  )
  for (const warning of warnings) console.warn(`[lodes]   ⚠ ${warning}`)
  return lodeBuild(entries, wikiwikiLastModified(page.html))
}

const PARSERS = {
  'kcwiki-ships': parseKcwikiShips,
  'quests-scn': parseQuestsScn,
  'wikiwiki-kaishu': parseWikiwikiKaishu,
  'wikiwiki-ship-profile': parseWikiwikiShipProfile,
  'kcwiki-expedition': parseKcwikiExpedition,
  'kcwiki-bgm': parseKcwikiBgm,
  'wikiwiki-expedition': parseWikiwikiExpedition,
  'kcwiki-voice': parseKcwikiVoice,
  'kcwiki-seasonal-voice': parseKcwikiSeasonalVoice,
  'wikiwiki-voice': parseWikiwikiVoice,
  'wikiwiki-remodel': parseWikiwikiRemodel,
  'wikiwiki-ship-max': parseWikiwikiShipMax,
  'wikiwiki-abyss-voice': parseWikiwikiAbyssVoice,
  'kcwiki-routing': parseKcwikiRouting,
  'wikiwiki-routing': parseWikiwikiRouting,
  'kcnav-routing': parseKcnavRouting,
  'kcwiki-localization': parseKcwikiLocalization,
  'kcwiki-fit-bonus': parseKcwikiFitBonus,
  'kcwiki-quest-req': parseKcwikiQuestReq,
  'poi-quest-goal': parsePoiQuestGoal,
  'wikiwiki-quests': parseWikiwikiQuests,
  'wikiwiki-item-exchange': parseWikiwikiItemExchange,
  'map-intel': parseMapIntel,
  'map-enemy-comps': parseMapEnemyComps,
  'map-drops': parseMapDrops,
  'ship-stats': parseShipStats,
  'event-bonus': parseEventBonus,
  'dev-recipes': parseDevRecipes,
  'build-recipes': parseBuildRecipes,
}

// MediaWiki 页面的最后编辑时间（kcwiki 系源的「多新」）
const mediawikiUpdatedAt = async (apiUrl) => {
  try {
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'kanso-lodes' } })
    if (!res.ok) return null
    const json = await res.json()
    const pages = json?.query?.pages ?? {}
    for (const page of Object.values(pages)) {
      const ts = page?.revisions?.[0]?.timestamp
      if (ts) return ts
    }
  } catch (_e) {
    /* 拿不到就退回抓取时间 */
  }
  return null
}

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)
const force = process.argv.includes('--force')
const requestedSources = only
  ? sources.filter((source) => source.id === only)
  : sources.filter(
      (source) =>
        !source.manualImport ||
        (source.id === 'kcnav-routing' && Boolean(process.env.KANSO_KCNAV_EXPORT)),
    )
if (only && !requestedSources.length) throw new Error(`未知矿脉包：${only}`)
const selectedSources = requestedSources.filter(
  (source) => source.selfFetch !== false && (Boolean(source.url) || source.selfFetch === true),
)
if (only && !selectedSources.length) {
  throw new Error(`${only} 由独立生成器维护，不走 lodes:fetch`)
}
if (!only) {
  for (const source of sources.filter((entry) => entry.manualImport && !selectedSources.includes(entry))) {
    console.log(`[lodes] skip: ${source.id}（需要显式离线导入）`)
  }
}

const failedSources = new Set()
const sourceCacheDir = path.join(os.tmpdir(), 'kanso-lode-source-cache', jstDate())
for (const src of selectedSources) {
  try {
    console.log(`[lodes] fetching ${src.id} ← ${src.url}`)
    // selfFetch 的源自己去取（如台词要按页清单批量拉几百页），主循环不预抓
    let raw = null
    if (!src.selfFetch) {
      const sourceCache = path.join(sourceCacheDir, `${src.id}.${src.format === 'text' ? 'txt' : 'json'}`)
      if (src.dailyCache && !force && existsSync(sourceCache)) {
        const cached = readFileSync(sourceCache, 'utf8')
        raw = src.format === 'text' ? cached : JSON.parse(cached)
        console.log(`[lodes]   使用当日源缓存 ${sourceCache}`)
      } else {
        const res = await fetch(src.url, { headers: { 'User-Agent': 'kanso-lodes' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        raw = src.format === 'text' ? text : JSON.parse(text)
        if (src.dailyCache) {
          mkdirSync(sourceCacheDir, { recursive: true })
          writeFileSync(sourceCache, text, 'utf8')
        }
      }
    }
    const parsed = src.parser ? await PARSERS[src.parser](raw) : raw
    const buildResult = parsed?.__kansoLodeBuild === true ? parsed : null
    const data = buildResult ? buildResult.data : parsed
    const detectedUpstream = src.upstreamApi
      ? await mediawikiUpdatedAt(src.upstreamApi)
      : await upstreamUpdatedAt(src.url)
    // 清单日期只作 API 限流/非 GitHub 源的兜底；能探测时始终跟随上游新提交。
    const upstream =
      buildResult?.upstreamUpdatedAt ??
      detectedUpstream ??
      src.upstreamUpdatedAt ??
      null
    const now = new Date()
    const pack = {
      meta: {
        id: src.id,
        name: src.name,
        version:
          // 汇编包的版本跟**汇编那天**走，不跟某一页的上游修订走：
          // 它是 37 张页面 + 现包 + 本机账本三方合出来的，没有单一上游时间戳。
          src.id === 'map-intel' ||
          src.id === 'map-enemy-comps' ||
          src.id === 'map-drops' ||
          src.id === 'ship-stats'
            ? jstDate(now).replaceAll('-', '.')
            : (upstream ?? now.toISOString()).slice(0, 10).replace(/-/g, '.'),
        source: src.source,
        sourceUrl: src.url,
        fetchedAt: now.toISOString(),
        upstreamUpdatedAt: upstream,
        license: src.license,
        // meta.note 是**玩家可见文案**：lodeCredit() 把它渲染进「源」悬停，
        // 玩家一 hover 就整段读到。所以清单里的 `note` 只写一两句人话
        //（这是什么资料、覆盖什么），来源站名与更新日期由 lodeCredit 另外展示，
        // 不在这里重复。换源考古、逐条对账、pageid、脚本路径这些维护者备忘
        // 一律写进同一条目的 `maintainerNote` —— **抓取器一行都不读它**，
        // 所以它永远到不了玩家眼前。改这里之前先看 assets/lodes/README.md 的
        //「note 与 maintainerNote」一节。
        note: src.note,
      },
      data,
    }
    const output = path.join(OUT_DIR, `${src.id}.json`)
    if (src.id === 'map-intel' && existsSync(output)) {
      const current = JSON.parse(readFileSync(output, 'utf8'))
      if (current.meta.eventRefresh) pack.meta.eventRefresh = current.meta.eventRefresh
      stageMapIntelCandidate(output, current, pack)
      console.log('[lodes] map-intel 已生成候选，正式包等待审核批准')
    } else {
      writeFileSync(output, JSON.stringify(pack))
      console.log(`[lodes] ok: ${src.id}${upstream ? ` (上游更新于 ${upstream.slice(0, 10)})` : ''}`)
    }
  } catch (e) {
    failedSources.add(src.id)
    console.error(`[lodes] FAILED: ${src.id}`, e.message)
  }
}

// 任务前提链三方对账：wikiwiki-quests 更新后重出报告（scn×eo×ww），
// 冲突/可补/悬空前置全落 assets/review，别让下一次人工核对从零开始。
if (selectedSources.some((source) => source.id === 'wikiwiki-quests') && !failedSources.has('wikiwiki-quests')) {
  try {
    const loadData = (id) => JSON.parse(readFileSync(path.join(OUT_DIR, `${id}.json`), 'utf8')).data
    const report = reconcileQuestPre({
      scn: loadData('quests-scn'),
      eo: loadData('eo-quests'),
      ww: loadData('wikiwiki-quests'),
    })
    const reviewDir = path.join(root, 'assets', 'review')
    mkdirSync(reviewDir, { recursive: true })
    writeFileSync(
      path.join(reviewDir, 'quest-pre-reconcile.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 1),
    )
    console.log(
      `[lodes] 任务前提对账：一致 ${report.counts.agree} · 冲突 ${report.counts.conflicts} · ` +
        `scn缺可补 ${report.counts.wwOnly} · 悬空 ${report.counts.dangling} → assets/review/quest-pre-reconcile.json`,
    )
  } catch (e) {
    console.error('[lodes] 任务前提对账失败：', e.message)
  }
}

const reconciliationRequested =
  selectedSources.some((source) =>
    ['wikiwiki-remodel', 'wikiwiki-expedition'].includes(source.id),
  )
const reconciliationBlocked = [...failedSources].some((id) =>
  ['wikiwiki-remodel', 'wikiwiki-expedition'].includes(id),
)
if (reconciliationRequested && !reconciliationBlocked) {
  const { output, report } = writeLodeReconciliation(root)
  console.log(
    `[lodes] 交叉对账：${output} · ` +
      `改造 API 差异 ${report.remodel.nativeMismatches?.length ?? '待包'} · ` +
      `远征字段差异 ${report.expedition.mismatches?.length ?? '待包'}`,
  )
} else if (reconciliationBlocked) {
  console.error('[lodes] 交叉对账已跳过：本轮事实包抓取失败，不能拿旧包冒充新结果')
}

if (failedSources.size) {
  console.error(`[lodes] 本轮失败 ${failedSources.size} 包：${[...failedSources].join(', ')}`)
  process.exitCode = 1
}
