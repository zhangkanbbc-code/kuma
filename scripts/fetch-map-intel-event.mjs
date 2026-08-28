// 一个命令批量刷新当前活动的全部 E 图；每张图两张页面各一次请求，页面内拆分甲乙丙丁。
// 默认只生成候选包和差异报告，正式包必须另行显式批准。
//
// 两个源各干各的活（口径见 scripts/lib/map-intel-event-comps.mjs 的文件头）：
//   · 艦これ攻略 Wiki（日站）：难度别掉落表、机关、特效倍率、行动半径、突破奖励，
//     以及敌编成的**日文标注文本**——这些只有它给。
//   · 舰娘百科「深海配置」：敌编成的 **mstId**。日站从不公布号，
//     2026-08-22 起「靠名字猜号」的两条流水线已退役，号只能从这里原生取。
// 两家在「哪套阵容出现在哪个点」上是同源转录（舰娘百科页脚自述），不算两票；
// 真正的第二票是本机遭遇志（带难度列，能钉到难度层）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseKcwikiMapPage, parseKcwikiSourceNote } from './lib/kcwiki-map.mjs'
import {
  EVENT_SOURCE_QUALITY,
  KNOWN_ABYSSAL_LABEL_FIXES,
  applyAbyssalLabelFixes,
  buildNodeAlignment,
  eventCompCorroborationOf,
  eventDropCorroborationOf,
  kcwikiEventPageQuery,
  loadLedgerEventVotes,
  mergeEventDifficultyComps,
  splitEventDifficultyTabs,
  staleEventCompNotes,
  staleEventCompVerdicts,
  staleKcnavWitnesses,
} from './lib/map-intel-event-comps.mjs'
import { fetchText, jstDate, loadMasterShipNames } from './map-intel.mjs'
import { EVENT_DIFFICULTIES, parseEventMapPage } from './map-intel-event.mjs'
import {
  assertNoPendingMapIntelCandidate,
  stageMapIntelCandidate,
} from './map-intel-review.mjs'

const root = path.join(fileURLToPath(import.meta.url), '..', '..')
const outDir = path.join(root, 'assets', 'lodes')
const output = path.join(outDir, 'map-intel.json')
const config = JSON.parse(
  readFileSync(path.join(root, 'scripts', 'map-intel-events.json'), 'utf8'),
).active
if (!config) throw new Error('map-intel-events.json 没有 active 活动')
if (!existsSync(output)) throw new Error('请先运行 npm run lodes:map-intel 生成基础海域包')
if (config.status !== 'active') throw new Error('当前活动已冻结；如有新活动请先更新配置')
if (!config.kcwikiPage) {
  throw new Error(
    'map-intel-events.json 缺 kcwikiPage——敌编成的 mstId 只能从舰娘百科活动页原生取，' +
      '没有它就只能交出一整包没号的编成（镝的精确档会当场变哑，而且不报错）',
  )
}

const current = JSON.parse(readFileSync(output, 'utf8'))
const force = process.argv.includes('--force')
assertNoPendingMapIntelCandidate(output, force)
const candidate = structuredClone(current)
const shipsPack = JSON.parse(readFileSync(path.join(outDir, 'kcwiki-ships.json'), 'utf8'))
for (const [name, id] of Object.entries(config.masterShips ?? {})) {
  shipsPack.data[`game-master-${id}`] = { ID: id, 日文名: name }
}
// 主数据名表全量并入(常规图抓取早就这么做):kcwiki 对新实装成批滞后,
// 活动新掉落舰(2026-08-12 实锤 E4 的 Mogador/Vautour/L.d.S.D.d.Abruzzi)
// 逐个往 masterShips 手工表里加是打地鼠。同名时 shipMatcher 取小 id,不受影响。
const masterNames = loadMasterShipNames(root)
if (masterNames) {
  for (const [name, id] of masterNames) {
    const key = `game-master-${id}`
    if (!shipsPack.data[key]) shipsPack.data[key] = { ID: id, 日文名: name }
  }
} else {
  console.warn('[lodes] ⚠ 没找到仓库上一级的 s2.json——活动掉落舰名解析退回 kcwiki + 手工表')
}
const now = new Date()
const checkedAt = jstDate(now)
const cacheSlot = now.toISOString().slice(0, 13).replaceAll(':', '-')
const cacheDir = path.join(os.tmpdir(), 'kanso-map-intel-event-cache', cacheSlot)
const unresolved = []
// 第一方那张票只读一次（整场活动的遭遇志），逐图逐难度按键取用
const ledger = loadLedgerEventVotes({ mapAreaId: config.mapAreaId })
const review = {
  generatedAt: now.toISOString(),
  event: config.name,
  voters: {
    kcwiki: '舰娘百科活动海域页「深海配置」——按甲乙丙丁四个 tab 分难度，编辑者直接填 mstId',
    wikiwiki: '艦これ攻略 Wiki 活动页的敵編成表 / 難易度別ドロップ表——只给日文标注名，从不给号',
    ledger: '本机遭遇志 encounters——第一方一手，且带 difficulty 列，能钉到难度层',
    kcnav:
      'KCNav 人肉见证台账——用户人工浏览该站记下的实测样本（kuma 对该站零请求）；' +
      '只在逐格数值指纹钉得住那一条的身份时才发票',
  },
  transcription: {},
  maps: {},
  conflicts: [],
  sourceQuality: EVENT_SOURCE_QUALITY,
  ledger: ledger.stats,
  warnings: [],
}
// KCNav 见证票逐图累计，末尾统一核对认领情况
const claimedWitnessKeys = []
// 标注转写台账的落地情况（逐图累计，末尾统一报——每格报一次会刷屏）
const labelFixStats = { applied: new Map(), retire: new Set(), mismatched: new Map() }
// 两站逐层原始行，给冲突点位的跨难度对齐表用：sourceRows[图][点][难度] = { kcwiki, wikiwiki }
const sourceRows = {}
const previousRefresh = current.meta.eventRefresh?.maps ?? {}
const refreshState = { ...previousRefresh }

const dueMap = (phase, mapNo) => {
  if (force) return true
  const phaseAgeHours = (now.getTime() - new Date(phase.openedAt).getTime()) / 3_600_000
  const intervalHours = phaseAgeHours <= 72 ? 6 : phaseAgeHours <= 168 ? 24 : 48
  const last = previousRefresh[`${config.mapAreaId}-${mapNo}`]?.fetchedAt
  return !last || now.getTime() - new Date(last).getTime() >= intervalHours * 3_600_000
}

const due = config.phases.flatMap((phase) =>
  phase.maps.filter((mapNo) => dueMap(phase, mapNo)).map((mapNo) => ({ phase, mapNo })),
)
if (!due.length) {
  console.log('[lodes] 当前活动图尚未到刷新时间；前 72 小时每 6 小时、第 4–7 天每日、稳定后每 48 小时')
  process.exit(0)
}

for (const { phase, mapNo } of due) {
  const code = `${config.mapAreaId}-${mapNo}`
  const page = `${config.wikiPage}/E${mapNo}`
  const url = `https://wikiwiki.jp/kancolle/${encodeURI(page)}`
  const html = await fetchText(url, {
    cacheFile: path.join(cacheDir, `E${mapNo}.html`),
    minIntervalMs: 10_500,
  })
  const parsed = parseEventMapPage(html, shipsPack)
  unresolved.push(...parsed.unresolved.map((ship) => `E${mapNo}:${ship}`))
  const revision = html.match(/Last-modified:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? checkedAt

  // ---- 定号换源：舰娘百科同一张图的四个难度 tab ----
  const kcwikiPage = `${config.kcwikiPage}/E-${mapNo}`
  const kcwikiUrl = `https://zh.kcwiki.cn/wiki/${encodeURI(kcwikiPage)}`
  const kcwikiRaw = await fetchText(kcwikiEventPageQuery(kcwikiPage), {
    cacheFile: path.join(cacheDir, `kcwiki-E${mapNo}.json`),
    minIntervalMs: 900,
  })
  const kcwikiHtml = JSON.parse(kcwikiRaw)?.parse?.text
  if (typeof kcwikiHtml !== 'string' || !kcwikiHtml) {
    throw new Error(`${kcwikiPage} 没有渲染文本——页名多半变了，检查 map-intel-events.json 的 kcwikiPage`)
  }
  const tabs = splitEventDifficultyTabs(kcwikiHtml)
  const missingTabs = EVENT_DIFFICULTIES.filter((difficulty) => !tabs.has(difficulty))
  if (missingTabs.length) {
    throw new Error(
      `${kcwikiPage} 缺 ${missingTabs.join('/')} 难度 tab——页面改版了。` +
        '宁可整图抓不出来，也不要静默交出一半没号的编成',
    )
  }
  review.transcription[code] = parseKcwikiSourceNote(kcwikiHtml)
  const mapReview = { difficulties: {}, kcwikiUrl, wikiwikiUrl: url }

  for (const difficulty of EVENT_DIFFICULTIES) {
    const layer = parsed.difficulties[difficulty]
    const kcwiki = parseKcwikiMapPage(tabs.get(difficulty))
    // 转写修正台账要在最前面落：标注一路进包、进对账报告、进冲突记录，
    // 晚一步就有一份带着错标注的副本已经发出去了。号一个都不动。
    const fixes = applyAbyssalLabelFixes(kcwiki.nodes)
    for (const [mstId, count] of fixes.applied) {
      labelFixStats.applied.set(mstId, (labelFixStats.applied.get(mstId) ?? 0) + count)
    }
    for (const mstId of fixes.retire) labelFixStats.retire.add(mstId)
    for (const one of fixes.mismatched) {
      labelFixStats.mismatched.set(one.mstId, one.found)
    }
    for (const warning of kcwiki.warnings) {
      // 「没有掉落列表表」是必然的：活动页的掉落表不在难度 tab 里（也不分难度），
      // 这一域本来就只吃日站，不必每图每难度喊一遍。
      if (/掉落列表/.test(warning)) continue
      review.warnings.push(`${code} ${difficulty}: ${warning}`)
    }
    // 定号那一步不许静默缺席。2026-08-24 之前它就是这样坏掉的：
    // 定号流水线退役后抓取器照旧整层重写 enemyComps，1494 条号一次刷新全掉光，
    // 而脚本一声不吭——镝的战前「精确档」当场变哑，用户只会看到「资料没收录」。
    const kcwikiComps = Object.values(kcwiki.nodes).reduce(
      (sum, node) => sum + node.enemyComps.length,
      0,
    )
    if (!kcwikiComps) {
      throw new Error(
        `${kcwikiPage} 的 ${difficulty} 难度一条敌编成都没解析出来——` +
          '「深海配置」表改版了。宁可整图抓不出来，也不要交出一整层没号的编成',
      )
    }
    // 冲突点位的跨难度对齐表要用到两站**这一层**的原始行，逐层留一份引用
    for (const [node, value] of Object.entries(kcwiki.nodes)) {
      ;((sourceRows[code] ??= {})[node] ??= {})[difficulty] = {
        kcwiki: value.enemyComps,
        wikiwiki: layer.nodes[node]?.enemyComps ?? [],
      }
    }
    for (const [node, value] of Object.entries(layer.nodes)) {
      const slot = ((sourceRows[code] ??= {})[node] ??= {})
      slot[difficulty] ??= { kcwiki: [], wikiwiki: value.enemyComps }
    }
    const merged = mergeEventDifficultyComps({
      code,
      difficulty,
      kcwikiNodes: kcwiki.nodes,
      wikiwikiNodes: layer.nodes,
      ledger: ledger.comps,
    })
    review.conflicts.push(...merged.conflicts)
    claimedWitnessKeys.push(...merged.witnessKeys)
    for (const [node, comps] of Object.entries(merged.nodes)) {
      // 舰娘百科偶尔比日站多一个点（实测 62-1 的 AB）。多出来的点照收：
      // 掉落一栏留空是如实的「这一层没有该点的确认掉落」，不是漏抓。
      layer.nodes[node] ??= { ships: [], emptyDrop: 'unknown', enemyComps: [] }
      layer.nodes[node].enemyComps = comps
    }
    for (const [node, intel] of Object.entries(layer.nodes)) {
      if (!merged.nodes[node]) intel.enemyComps = []
      // 掉落票：账本能钉到 (图, 难度, 舰)，钉不到点（cell 是边号，推点位那一层会错挂）
      for (const ship of intel.ships) {
        const votes = ['wikiwiki']
        if (ledger.drops.get(`${code}|${difficulty}|${ship.id}`)) votes.push('ledger')
        ship.votes = votes
      }
    }
    const drops = Object.values(layer.nodes).flatMap((intel) => intel.ships)
    mapReview.difficulties[difficulty] = {
      ...merged.stats,
      nodes: Object.keys(layer.nodes).length,
      drops: drops.length,
      dropsLedgerBacked: drops.filter((ship) => eventDropCorroborationOf(ship) === '多源一致').length,
    }
  }
  review.maps[code] = mapReview

  candidate.data.maps[code] = {
    source: 'kuma 汇编（艦これ攻略 Wiki 难度别掉落/标注 × 舰娘百科「深海配置」定号 × 本机遭遇志）',
    sourceUrl: url,
    kcwikiUrl,
    checkedAt,
    revision,
    event: {
      name: config.name,
      from: config.openedAt.slice(0, 10),
      until: config.until,
      status: config.status,
      phaseOpenedAt: phase.openedAt,
      lifecycleSourceUrl: config.lifecycleSourceUrl,
    },
    difficulties: parsed.difficulties,
    // 全难度合算掉落是图级信息(上游那张「ドロップ艦一覧」本来就不分难度),
    // 与 difficulties 平级存放——结构上就混不进任何一个难度层。
    // 途中点(P1 这类)的掉落只有这一层有;展示层用它时必须标「不分难度」。
    ...(Object.keys(parsed.allDiffDrops).length ? { allDiffDrops: parsed.allDiffDrops } : {}),
    // 海域撃破ボーナス是图级信息(各难度行都在同一张表),不进难度层
    ...(parsed.rewards.length ? { rewards: parsed.rewards } : {}),
  }
  refreshState[code] = { fetchedAt: now.toISOString(), revision }
  const compCount = Object.values(parsed.difficulties).reduce(
    (sum, layer) =>
      sum +
      Object.values(layer.nodes).reduce(
        (nodeSum, node) => nodeSum + node.enemyComps.length,
        0,
      ),
    0,
  )
  const dropCount = Object.values(parsed.difficulties).reduce(
    (sum, layer) =>
      sum +
      Object.values(layer.nodes).reduce((nodeSum, node) => nodeSum + node.ships.length, 0),
    0,
  )
  const idCount = Object.values(parsed.difficulties).reduce(
    (sum, layer) =>
      sum +
      Object.values(layer.nodes).reduce(
        (nodeSum, node) =>
          nodeSum +
          node.enemyComps.filter((comp) => comp.ships.every((ship) => typeof ship === 'number'))
            .length,
        0,
      ),
    0,
  )
  const allDiffNodes = Object.keys(parsed.allDiffDrops).length
  const diffCoveredNodes = new Set(
    Object.values(parsed.difficulties).flatMap((layer) =>
      Object.entries(layer.nodes)
        .filter(([, node]) => node.ships.length)
        .map(([node]) => node),
    ),
  )
  const fallbackOnly = Object.keys(parsed.allDiffDrops).filter(
    (node) => !diffCoveredNodes.has(node),
  )
  console.log(
    `[lodes] ${code}：四难度 ${compCount} 个敌编成（${idCount} 条带 mstId）/ ${dropCount} 条确认掉落；` +
      `合算层 ${allDiffNodes} 个点位（其中 ${fallbackOnly.length} 个只有合算层：${fallbackOnly.join('/') || '无'}）`,
  )
  mapReview.allDiffDrops = { nodes: allDiffNodes, fallbackOnly }
}
if (unresolved.length) {
  throw new Error(`活动掉落舰名未解析：${unresolved.join('、')}`)
}

// ---- 印证汇总（只进维护者侧报告，运行时与 UI 都不读）----
const corroboration = { 多源一致: 0, 同源转录: 0, 单源待印证: 0, 冲突待裁: 0 }
const dropCorroboration = { 多源一致: 0, 单源待印证: 0 }
for (const [code, map] of Object.entries(candidate.data.maps)) {
  if (!map.difficulties || !review.maps[code]) continue
  for (const layer of Object.values(map.difficulties)) {
    for (const intel of Object.values(layer.nodes)) {
      for (const comp of intel.enemyComps) corroboration[eventCompCorroborationOf(comp)] += 1
      for (const ship of intel.ships) dropCorroboration[eventDropCorroborationOf(ship)] += 1
    }
  }
}
review.corroboration = corroboration
review.dropCorroboration = dropCorroboration
// ---- 冲突点位的跨难度全模式对齐表 ----
// 单看一个难度层，两站各说一句就成了各执一词；四层摊开，填写异常的那一层会自己跳出来。
// 只给有冲突的点位生成——全图都摊会把报告撑成几兆，人反而读不动。
const alignmentKeys = new Set(review.conflicts.map((one) => `${one.map}|${one.node}`))
review.nodeAlignment = [...alignmentKeys]
  .map((key) => {
    const [code, node] = key.split('|')
    return buildNodeAlignment({ code, node, byDifficulty: sourceRows[code]?.[node] ?? {} })
  })
  .filter((one) => one.rows.length)
// 他打到那一格时帮忙留意什么——一句话，账本永远是终审
review.watch = review.conflicts
  .filter((one) => one.watch)
  .map((one) => `${one.map} ${one.difficulty} ${one.node}：${one.watch}`)
if (review.watch.length) {
  console.log(`[lodes] 观察指引（打到这几格时留意）：`)
  for (const line of review.watch) console.log(`[lodes]   · ${line}`)
}

// ---- 标注转写台账：逐条报落地情况，认领不上的要喊 ----
review.labelFixes = KNOWN_ABYSSAL_LABEL_FIXES.map((fix) => ({
  mstId: fix.mstId,
  upstream: fix.upstream,
  correct: fix.correct,
  why: fix.why,
  checkedAt: fix.checkedAt,
  applied: labelFixStats.applied.get(fix.mstId) ?? 0,
  ...(labelFixStats.retire.has(fix.mstId) ? { upstreamAlreadyFixed: true } : {}),
  ...(labelFixStats.mismatched.has(fix.mstId)
    ? { upstreamNow: labelFixStats.mismatched.get(fix.mstId) }
    : {}),
}))
for (const one of review.labelFixes) {
  if (one.upstreamNow != null) {
    console.log(
      `[lodes] ⚠ ${one.mstId} 的标注转写台账指纹对不上（上游现在写「${one.upstreamNow}」，` +
        `台账记的是「${one.upstream}」）——不打补丁，请重新核对`,
    )
  } else if (one.upstreamAlreadyFixed && !one.applied) {
    console.log(`[lodes] ⚠ ${one.mstId} 的标注转写台账可以退役了：上游已自行改成「${one.correct}」`)
  } else if (!one.applied) {
    console.log(`[lodes] ⚠ ${one.mstId} 的标注转写台账一格都没认领到——这个号在本次活动里没出现？`)
  } else {
    console.log(`[lodes] 标注转写台账 ${one.mstId}：改写 ${one.applied} 格 →「${one.correct}」`)
  }
}

review.kcnavWitnesses = { claimed: claimedWitnessKeys.length, keys: claimedWitnessKeys }
// 认领不上的见证票要喊：上游改了舰列，票会安安静静地不再生效，
// 只表现成「印证计数少了一格」，看不出是票作废了
review.staleWitnesses = staleKcnavWitnesses(claimedWitnessKeys)
review.staleVerdicts = staleEventCompVerdicts(review.conflicts)
// 旁证注记与裁决表分开报：注记不改取值、不撤冲突标，只说「核这一条时手头有什么」。
// 认领不上的注记同样要喊——上游改了那一格，注记就是过期的了。
review.staleNotes = staleEventCompNotes(review.conflicts)

const reviewFile = path.join(root, 'assets', 'review', 'map-intel-event-sources.json')
mkdirSync(path.dirname(reviewFile), { recursive: true })
writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`, 'utf8')

candidate.meta.version = checkedAt.replaceAll('-', '.')
candidate.meta.fetchedAt = now.toISOString()
// 玩家可见（lodeCredit 的「源」悬停）：只说这一份是什么。
// 「候选已核对」是流水线状态、不是玩家要读的东西，维护者备忘见
// scripts/lode-sources.json 的 map-intel 条目 maintainerNote。
candidate.meta.note = `${config.name} 甲乙丙丁四档的掉落与敌方编成`
candidate.meta.eventRefresh = {
  name: config.name,
  checkedAt,
  fetchedAt: now.toISOString(),
  maps: refreshState,
  corroboration,
  dropCorroboration,
}
console.log(`[lodes] 编成印证：${JSON.stringify(corroboration)}`)
console.log(`[lodes] 掉落印证：${JSON.stringify(dropCorroboration)}`)
console.log(`[lodes] 源对账报告：${reviewFile}`)
// 已结案的条目照旧留在报告里（痕迹要留着），但**不许再算进「待人裁」那个数**——
// 混在一起报，「还剩几条要人拍板」就永远看不出来了。
const pendingConflicts = review.conflicts.filter((one) => !one.verdict)
const decidedConflicts = review.conflicts.filter((one) => one.verdict)
if (pendingConflicts.length) {
  const noted = pendingConflicts.filter((one) => one.note).length
  console.log(
    `[lodes] ⚠ ${pendingConflicts.length} 条源间互斥待人裁（阵形），逐条在报告里` +
      (noted ? `；其中 ${noted} 条带旁证注记` : ''),
  )
}
if (decidedConflicts.length) {
  console.log(
    `[lodes] ${decidedConflicts.length} 条源间互斥已结案（条目留在报告里带裁语与证据链，不删；` +
      '包里那一条已撤 conflict 标、取值未动）',
  )
}
if (review.kcnavWitnesses.claimed) {
  console.log(`[lodes] KCNav 人肉见证票：${review.kcnavWitnesses.claimed} 条编成认领到（升「多源一致」）`)
}
if (review.staleWitnesses.length) {
  console.log(
    `[lodes] ⚠ ${review.staleWitnesses.length} 张 KCNav 见证票认领不上任何编成（上游改了舰列？），要重核`,
  )
  for (const one of review.staleWitnesses) console.log(`[lodes]   · ${one.key}`)
}
if (review.staleVerdicts.length) {
  console.log(`[lodes] ⚠ ${review.staleVerdicts.length} 条旧裁决认领不上现存冲突，要重核`)
}
if (review.staleNotes.length) {
  console.log(`[lodes] ⚠ ${review.staleNotes.length} 条旁证注记认领不上现存冲突，要重核`)
}
stageMapIntelCandidate(output, current, candidate)
