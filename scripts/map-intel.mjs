import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { stripWikiMarkup } from './lib/abyssal-id-pin.mjs'

const WIKI_ROOT = 'https://wikiwiki.jp/kancolle/'
export const jstDate = (date = new Date()) =>
  new Date(date.getTime() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10)

const NORMAL_MAP_PAGES = {
  1: '鎮守府海域',
  2: '南西諸島海域',
  3: '北方海域',
  4: '西方海域',
  5: '南方海域',
  6: '中部海域',
  7: '南西海域',
}

// 兜底常量——真正的清单以主数据 api_mst_mapinfo 推导(loadNormalMapLast)。
// 2026-08-11 实锤:5-6 实装后这张写死的表让 map-intel 与 wikiwiki-routing
// 双双漏抓整张图,而消费端只是如实显示「未收录」,没有任何报警。
const NORMAL_MAP_LAST = { 1: 6, 2: 5, 3: 5, 4: 5, 5: 6, 6: 5, 7: 5 }

// 常规图清单的唯一权威是主数据快照;读不到快照才退回上面的常量。
// 快照比常量多图时以快照为准(新图自动进抓取范围),少图时抛错——
// 那说明快照是旧的,拿它裁常量会把已收录的图静默丢掉。
export const loadNormalMapLast = (rootDir) => {
  const file = join(rootDir, '..', 's2.json')
  if (!existsSync(file)) return { ...NORMAL_MAP_LAST }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const infos = (raw.api_data ?? raw)?.api_mst_mapinfo ?? []
  const out = {}
  for (const info of infos) {
    const area = Number(info?.api_maparea_id)
    const no = Number(info?.api_no)
    if (area >= 1 && area <= 7 && no >= 1) out[area] = Math.max(out[area] ?? 0, no)
  }
  for (const [area, last] of Object.entries(NORMAL_MAP_LAST)) {
    if ((out[area] ?? 0) < last) {
      throw new Error(
        `主数据快照的 ${area} 区只有 ${out[area] ?? 0} 张图,少于已知的 ${last} 张——快照过旧,先同步一次游戏主数据再抓`,
      )
    }
  }
  return out
}

const HTML_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

const decodeHtml = (value) =>
  `${value ?? ''}`.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (key[0] === '#') {
      const radix = key[1]?.toLowerCase() === 'x' ? 16 : 10
      const body = radix === 16 ? key.slice(2) : key.slice(1)
      const point = Number.parseInt(body, radix)
      return Number.isFinite(point) ? String.fromCodePoint(point) : all
    }
    return HTML_ENTITIES[key.toLowerCase()] ?? all
  })

export const htmlText = (value, breaks = ' ') =>
  decodeHtml(
    `${value ?? ''}`
      .replace(/<a\b[^>]*class="[^"]*note_super[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
      .replace(/<br\b[^>]*>/gi, breaks)
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()

const cellList = (rowHtml) =>
  [...rowHtml.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1\s*>/gi)].map((match) => ({
    html: match[3],
    text: htmlText(match[3]),
    rowspan: Math.max(1, Number.parseInt(match[2].match(/\browspan=["']?(\d+)/i)?.[1] ?? '1', 10)),
    colspan: Math.max(1, Number.parseInt(match[2].match(/\bcolspan=["']?(\d+)/i)?.[1] ?? '1', 10)),
  }))

export const tableGrid = (tableHtml) => {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
  const spans = []
  return rows.map((row) => {
    const out = []
    for (let col = 0; col < spans.length; col++) {
      const span = spans[col]
      if (!span) continue
      out[col] = span.cell
      span.left--
      if (span.left <= 0) spans[col] = null
    }
    let col = 0
    for (const cell of cellList(row[1])) {
      while (out[col]) col++
      for (let offset = 0; offset < cell.colspan; offset++) {
        out[col + offset] = cell
        if (cell.rowspan > 1) spans[col + offset] = { cell, left: cell.rowspan - 1 }
      }
      col += cell.colspan
    }
    return out
  })
}

const tableAfter = (html, pattern) => {
  const found = pattern instanceof RegExp ? html.search(pattern) : html.indexOf(pattern)
  if (found < 0) return null
  const start = html.indexOf('<table', found)
  const end = html.indexOf('</table>', start)
  return start >= 0 && end >= 0 ? html.slice(start, end + 8) : null
}

export const nodeNames = (text) => {
  const lead = text.split(/[：:]/, 1)[0]
  return [...lead.matchAll(/\b([A-Z]{1,2}\d*)\b/g)].map((match) => match[1])
}

const FORMATION_ID = {
  単縦: 1,
  単縦陣: 1,
  複縦: 2,
  複縦陣: 2,
  輪形: 3,
  輪形陣: 3,
  梯形: 4,
  梯形陣: 4,
  単横: 5,
  単横陣: 5,
  警戒: 6,
  警戒陣: 6,
}

const formationValue = (text) => FORMATION_ID[text] ?? text
const isBattleFormation = (text) =>
  /(単縦|複縦|輪形|梯形|単横|警戒|第一|第二|第三|第四)/.test(text)

// 舰名分隔符要连「。」一起收：wiki 偶尔拿句号断开两艘（实测撞见过
// 「軽母ヌ級elite(E)(艦載機白弱)。駆逐ロ級後期型」被当成一个名字入了库）。
// 方括号是 [[链接]] 断在单元格里漏出来的残留，也在这里抹掉，
// 否则「重巡リ級flagship]」这种名字后面永远落不到 mstId。
const fleetNames = (html) =>
  htmlText(html, '、')
    .replace(/\s*[、，,。]\s*/g, '\u0000')
    .split('\u0000')
    .map((name) => stripWikiMarkup(name.replace(/\s*\*\d+\s*$/, '')))
    .filter(Boolean)

export const parseEnemyTable = (html) => {
  const table = tableAfter(html, /class="fold-summary hidden-on-open">敵編成<\/div>/)
  return table ? parseEnemyTableHtml(table) : {}
}

const explicitPhase = (row) => {
  const text = row.map((cell) => cell?.text ?? '').join(' ')
  if (/(クリア後|突破後|撃破後)/.test(text)) return '通关后'
  if (/(最終形態|最終編成|ゲージ破壊可能|ラスダン)/.test(text)) return '最终形态'
  if (/(削り|前哨)/.test(text)) return '削血'
  return null
}

export const parseEnemyTableHtml = (table) => {
  if (!table) return {}
  const grid = tableGrid(table)
  const headerAt = grid.findIndex((row) => row.some((cell) => cell?.text === '出現場所'))
  if (headerAt < 0) return {}
  const header = grid[headerAt].map((cell) => cell?.text ?? '')
  const nodeCol = header.indexOf('出現場所')
  const patternCol = header.indexOf('パターン')
  const fleetCol = header.indexOf('出現艦船')
  const formationCol = header.indexOf('陣形')
  // EXP 列就在「パターン」和「出現艦船」之间（实测表头：
  // 出現場所 / パターン / EXP / 出現艦船 / 陣形 / 敵制空値 / 優勢 / 確保）。
  // 二期起基础经验按敌编成走，而这张表本来就是按 pattern 存的，粒度天然对齐。
  const expCol = header.findIndex((text) => /^(?:EXP|経験値)$/i.test(text))
  if (nodeCol < 0 || fleetCol < 0 || formationCol < 0) return {}

  // 敌联合舰队在 wiki 表里写成两行:パターン行(rowspan=2)装主力 6 舰,紧跟
  // 一个只有出現艦船一格的裸行装随伴 6 舰,其余列全靠 rowspan 继承。tableGrid
  // 用**同一格对象**填充继承行,所以判据是格子恒等:出現場所/パターン格与上一行
  // 是同一对象、出現艦船格是新对象 → 随伴行,并进上一行(主力→随伴的顺序与
  // 战斗 API 的 eShips 一致)。G 点那种「同名パターン两行」各有自己的格对象,
  // 不会误合并;再用陣形含「警戒」把关——敌联合只用第一~第四警戒航行序列。
  // (2026-08-12 实锤:6-5 M 与活动图的联合编成此前被拆成两条残缺的 6 舰半队,
  // 机制估算整个活动期间都在拿主力半队硬算胜率。)
  const mergedRows = []
  for (const row of grid.slice(headerAt + 1)) {
    const prev = mergedRows[mergedRows.length - 1]
    const isEscortRow =
      prev &&
      !prev.merged &&
      patternCol >= 0 &&
      row[patternCol] != null &&
      row[patternCol] === prev.raw[patternCol] &&
      row[nodeCol] === prev.raw[nodeCol] &&
      row[fleetCol] !== prev.raw[fleetCol] &&
      // 敌联合阵形写法两种都有:常规页「第三警戒 航行序列」,活动页只写「第四」
      /第[一二三四]/.test(row[formationCol]?.text ?? '') &&
      (row[fleetCol]?.html ?? '').trim()
    if (isEscortRow) {
      prev.fleetHtml = `${prev.fleetHtml}、${row[fleetCol].html}`
      prev.merged = true
      continue
    }
    mergedRows.push({ raw: row, fleetHtml: row[fleetCol]?.html ?? '', merged: false })
  }

  const nodes = {}
  const patternsByNode = new Map()
  for (const { raw: row, fleetHtml } of mergedRows) {
    const letters = nodeNames(row[nodeCol]?.text ?? '')
    const fleetText = row[fleetCol]?.text ?? ''
    const directShips = fleetNames(fleetHtml)
    const formationText = row[formationCol]?.text ?? ''
    const patternText = patternCol >= 0 ? (row[patternCol]?.text ?? '') : ''
    const patternNo = Number.parseInt(patternText.match(/\d+/)?.[0] ?? '', 10)
    const referencedPattern = Number.parseInt(
      fleetText.match(/パターン\s*(\d+)\s*と(?:同じ|同編成)/)?.[1] ?? '',
      10,
    )
    if (!letters.length) continue
    for (const node of letters) {
      const patterns = patternsByNode.get(node) ?? new Map()
      patternsByNode.set(node, patterns)
      const referenced = Number.isInteger(referencedPattern)
        ? patterns.get(referencedPattern)
        : undefined
      const ships = referenced ? referenced.ships : directShips
      // 「パターンN と同じ」的行连经验一起继承——它就是同一套编成
      const expText = expCol >= 0 ? (row[expCol]?.text ?? '') : ''
      const expHere = Number.parseInt(expText.replace(/[,，\s]/g, '').match(/\d+/)?.[0] ?? '', 10)
      const exp = Number.isInteger(expHere) ? expHere : referenced?.exp
      const formation = isBattleFormation(formationText)
        ? formationValue(formationText)
        : referenced?.formation
      if (
        !ships.length ||
        ships.length > 12 ||
        (typeof formation !== 'number' && typeof formation !== 'string')
      ) {
        continue
      }
      const list = (nodes[node] ??= [])
      const phase = explicitPhase(row)
      const comp = {
        formation,
        ships,
        ...(Number.isInteger(exp) && exp > 0 ? { exp } : {}),
        ...(phase ? { phase } : {}),
      }
      if (!list.some((current) => JSON.stringify(current) === JSON.stringify(comp))) list.push(comp)
      if (Number.isInteger(patternNo)) patterns.set(patternNo, comp)
    }
  }
  return nodes
}

/** 游戏主数据（用户的 api_start2 快照，仓库上一级 s2.json）→ [日文名, id] 名表。
 *  kcwiki 对新实装整批滞后（2026-08-11 实锤：杉在包里整个缺席，限定页的
 *  1-5-J 杉被静默丢掉）——舰名解析一律以主数据为权威、kcwiki 兜底。
 *  快照不存在时返回 null；调用方要打显眼警告，此时解析退回 kcwiki 单基准。 */
export const loadMasterShipNames = (rootDir) => {
  const file = join(rootDir, '..', 's2.json')
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const ships = (raw.api_data ?? raw)?.api_mst_ship ?? []
  return ships
    .filter((ship) => ship?.api_sortno && ship?.api_name)
    .map((ship) => [ship.api_name, ship.api_id])
}

export const shipMatcher = (shipsPack, masterNames = []) => {
  const byName = new Map()
  const put = (name, id) => {
    if (!Number.isInteger(id) || id <= 0 || !name) return
    const current = byName.get(name)
    if (current == null || id < current) byName.set(name, id)
  }
  // 主数据名表先入（权威）；kcwiki 名并入兜底——两边同名同 id，先后只影响缺席侧
  for (const [name, id] of masterNames ?? []) put(`${name}`.trim(), Number(id))
  for (const ship of Object.values(shipsPack?.data ?? {})) {
    put(`${ship?.日文名 ?? ''}`.trim(), Number(ship?.ID))
  }
  const names = [...byName].sort((a, b) => b[0].length - a[0].length)
  return (text) => {
    const occupied = Array(text.length).fill(false)
    const found = []
    for (const [name, id] of names) {
      let from = 0
      while (from < text.length) {
        const at = text.indexOf(name, from)
        if (at < 0) break
        const end = at + name.length
        if (!occupied.slice(at, end).some(Boolean)) {
          occupied.fill(true, at, end)
          found.push({ at, id, name })
        }
        from = at + Math.max(1, name.length)
      }
    }
    return found.sort((a, b) => a.at - b.at)
  }
}

export const parseDropTable = (html, shipsPack, limitedById = new Map(), masterNames = []) => {
  const table = tableAfter(html, /class="fold-summary hidden-on-open">ドロップ<\/div>/)
  if (!table) return { nodes: {}, unmatchedLimited: [] }
  const matchShips = shipMatcher(shipsPack, masterNames)
  const grid = tableGrid(table)
  const headerAt = grid.findIndex((row) => row.some((cell) => cell?.text === '戦艦級'))
  if (headerAt < 0) return { nodes: {}, unmatchedLimited: [] }
  const nodes = {}
  const seenLimited = new Set()
  for (const row of grid.slice(headerAt + 1)) {
    const letters = nodeNames(row[0]?.text ?? '')
    if (!letters.length) continue
    const ships = new Map()
    for (const cell of row.slice(1)) {
      if (!cell?.html) continue
      const matched = matchShips(htmlText(cell.html, ' '))
      for (const ship of matched) {
        const limited = limitedById.get(ship.id)
        const window = limited?.window ?? limited
        const hintedNodes = limited?.nodes instanceof Set ? limited.nodes : new Set()
        const isLimited =
          window && (!hintedNodes.size || hintedNodes.has('*') || letters.some((node) => hintedNodes.has(node)))
        if (isLimited) seenLimited.add(ship.id)
        ships.set(ship.id, isLimited ? { id: ship.id, limited: window } : { id: ship.id })
      }
    }
    for (const node of letters) nodes[node] = [...ships.values()]
  }
  // 常规海域页的掉落表经常没有及时抄入新限定舰；“当前持续中”清单会链接到
  // 对应活动小节，那里的精确点位才是限定条目的事实源。把缺项补进节点，
  // 但没有点位线索时宁可报缺，不做整图猜测。
  for (const [id, limited] of limitedById) {
    if (seenLimited.has(id)) continue
    const window = limited?.window ?? limited
    const hintedNodes = limited?.nodes instanceof Set ? limited.nodes : new Set()
    const targets = hintedNodes.has('*') ? Object.keys(nodes) : [...hintedNodes]
    for (const node of targets) {
      const list = (nodes[node] ??= [])
      const existing = list.find((ship) => ship.id === id)
      if (existing) existing.limited = window
      else list.push({ id, limited: window, limitedOnly: true })
      seenLimited.add(id)
    }
  }
  return {
    nodes,
    unmatchedLimited: [...limitedById.keys()].filter((id) => !seenLimited.has(id)),
  }
}

const sectionNodeHints = (html, anchor, code, shipName) => {
  const anchorAt = html.indexOf(`name ="${anchor}"`)
  if (anchorAt < 0) return new Set()
  const sectionStart = html.lastIndexOf('<h2', anchorAt)
  const sectionEnd = html.indexOf('<h2', anchorAt + 1)
  const section = html
    .slice(Math.max(0, sectionStart), sectionEnd > anchorAt ? sectionEnd : undefined)
    .replace(/<(?:del|s)\b[^>]*>[\s\S]*?<\/(?:del|s)\s*>/gi, '')
  const titleEnd = section.indexOf('</h2>')
  const titleHasShip = htmlText(titleEnd >= 0 ? section.slice(0, titleEnd) : '').includes(shipName)
  const nodes = new Set()
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const nodePattern = new RegExp(`${escapedCode}-([A-Z]{1,2}\\d*)`, 'g')
  for (const table of section.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
    for (const row of tableGrid(table[0])) {
      const text = row.map((cell) => cell?.text ?? '').join(' ')
      if (!text.includes(code) || (!text.includes(shipName) && !titleHasShip)) continue
      for (const match of text.matchAll(nodePattern)) nodes.add(match[1])
      if (!nodes.size && (text.includes(`${code}(全域)`) || text.includes(`${code}（全域）`))) nodes.add('*')
    }
  }
  return nodes
}

export const parseCurrentLimited = (html, shipsPack, masterNames = []) => {
  const matchShips = shipMatcher(shipsPack, masterNames)
  const checkedAt =
    htmlText(html).match(/現在継続中の期間限定ドロップ艦（(\d{4})-(\d{2})-(\d{2})メンテ時点）/)?.slice(1, 4).join('-') ??
    null
  if (!checkedAt) throw new Error('期间限定页没有“当前持续中”核对日期')

  // TOC 锚点 → { 开始日, 活动标签 }。标签取【…】内文（「13周年記念」「節分」），
  // 没有书名号的小节（「山風、磯風など」）取日期前的整段标题——玩家要知道
  // 这条限定是哪次活动带进来的，退场时也按这个批次清点。
  const anchorDate = new Map()
  const anchorLabel = new Map()
  for (const match of html.matchAll(/<li><a href="#([^"]+)">([\s\S]*?)<\/a>/g)) {
    const title = htmlText(match[2])
    // 日期括号全角半角都有（「山風、親潮、浜波（2021/10/15～」是全角）。
    // 旧的跨条正则只认半角，会往后偷到别的批次的日期——这些老批次的 from
    // 一直是错的；逐条解析 + 双括号才拿到各自真实的开始日。
    const date = title.match(/[（(](\d{4})\/(\d{1,2})\/(\d{1,2})～/)
    if (!date) continue
    anchorDate.set(match[1], `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`)
    const label = (
      title.match(/【(.+?)】/)?.[1] ??
      title
        .slice(0, date.index)
        .replace(/[（(]終了[）)]/g, '')
        .replace(/期間限定邂逅|特別邂逅/g, '')
        .replace(/[、,\s]+$/, '')
    ).trim()
    if (label) anchorLabel.set(match[1], label.slice(0, 60))
  }

  const start = html.indexOf('海域別リスト')
  const end = html.indexOf('<h2', start)
  const table = tableAfter(html.slice(start, end > start ? end : undefined), '<table')
  if (!table) throw new Error('期间限定页没有海域别列表')
  const maps = new Map()
  const unmatchedNames = new Set()
  for (const row of tableGrid(table).slice(1)) {
    const codeCell = row.find((cell) => /^\d+-\d+$/.test(cell?.text ?? ''))
    const shipsCell = row.at(-1)
    const code = codeCell?.text
    if (!code || !shipsCell?.html) continue
    const entries = new Map()
    for (const link of shipsCell.html.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const shipName = htmlText(link[2])
      const ship = matchShips(shipName)[0]
      const from = anchorDate.get(link[1])
      // 舰名解析不出 = 目录会静默缺一条限定掉落（2026-08-11 杉@1-5 实锤），
      // 必须显式报出去，不许 continue 了事
      if (!ship) {
        if (shipName.trim()) unmatchedNames.add(`${code}:${shipName.trim()}`)
        continue
      }
      if (!from) continue
      const label = anchorLabel.get(link[1])
      entries.set(ship.id, {
        window: {
          from,
          until: null,
          lastConfirmedAt: checkedAt,
          status: 'active_confirmed',
          statusChangedAt: checkedAt,
          ...(label ? { label } : {}),
        },
        nodes: sectionNodeHints(html, link[1], code, shipName),
      })
    }
    maps.set(code, entries)
  }
  return { checkedAt, maps, unmatchedNames: [...unmatchedNames] }
}

// ---- 期间限定邂逅：逐批次读「终了」标记 ----
//
// `parseCurrentLimited` 只读页面顶上那张「海域別リスト」——**那张表里只有还开着的**。
// 一条限定终了之后就从那张表里消失，于是上游对照只看得见「不再列出」（缺席），
// 永远看不见「它说自己终了了」（断言）。鲑鱼 1-2-E 就是这么漏的：她在常规掉落表里
// 挂着 kcwiki 单票，限定表里查无此人，两边都不报警，目录照旧把她当常驻指出去。
//
// 逐批次的小节里，终了是**用删除线逐条标出来的**。删除线只活在原始字节里
// （`<del>` 标签）——htmlText / 任何取文本的层都会把它抹平，把已终了读成还在掉。
// 所以这里一律在**去标签之前**判 `<del>`，这是本函数存在的全部理由。
const DEL_TOKEN = /<del\b[^>]*>|<\/del>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi

/** 一格里的舰名链接，逐个带上「它是不是被删除线套着」 */
const shipLinksWithStrike = (cellHtml) => {
  const out = []
  let depth = 0
  for (const match of `${cellHtml ?? ''}`.matchAll(DEL_TOKEN)) {
    const token = match[0]
    if (/^<del/i.test(token)) {
      depth++
      continue
    }
    if (/^<\/del/i.test(token)) {
      depth = Math.max(0, depth - 1)
      continue
    }
    const attrs = match[1] ?? ''
    const href = attrs.match(/href="([^"]*)"/)?.[1] ?? ''
    if (!href.startsWith('/kancolle/')) continue
    if (/anchor_super|system-icon/.test(attrs)) continue
    const name = htmlText(match[2])
    if (name) out.push({ name, struck: depth > 0 })
  }
  return out
}

/**
 * 小节标题里还有两种终了写法，删除线之外的：
 *   「Zara（終了）」        —— 这一批里点名这一条终了了
 *   「～卯月のみ継続中」     —— 只有卯月还在，这一批的其余全终了
 */
const headingEndSignals = (headingHtml) => {
  const done = new Set()
  // 链接文本不许跨标签匹配：`[\s\S]*?` 会把同一标题里更早的 <a> 一起吞进来，
  // 于是「Luigi Torelli、平戸（終了）」会被读成一个叫「Luigi Torelli、平戸」的舰
  for (const m of headingHtml.matchAll(
    /<a\b[^>]*href="\/kancolle\/[^"]*"[^>]*>([^<]*)<\/a>\s*[（(]\s*終了\s*[)）]/g,
  )) {
    const name = htmlText(m[1])
    if (name) done.add(name)
  }
  const plain = htmlText(headingHtml)
  // 舰名里可以有空格（Samuel B.Roberts），但不会有「、」——顿号才是分隔符
  for (const m of plain.matchAll(/([^、。（()）]+?)\s*[（(]\s*終了\s*[)）]/g)) {
    const name = m[1].trim()
    if (name) done.add(name)
  }
  const only = plain.match(/～\s*([^、～)）]+?)のみ(?:一部)?継続中/)?.[1]?.trim() ?? null
  return { done, only }
}

const LIMITED_POINT = /^([1-9])-([1-9])-([A-Z](?:\s*,\s*[A-Z])*)/

/**
 * 逐批次解析期间限定邂逅小节。
 *
 * 返回每一条 `{ map, node, ship, ended, reasons, batch, from, label }`——
 * `ended` 为真就是上游明说它终了了（删除线或标题标记），不是「不再列出」的疑似。
 * **不解析舰名到 id**：判据本身跟舰名表无关，分开才好逐字钉死删除线这一格。
 */
export const parseLimitedBatches = (html) => {
  const heads = [
    ...`${html}`.matchAll(/<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g),
  ].map((m) => ({ id: m[1], raw: m[2], start: m.index, headEnd: m.index + m[0].length }))
  const batches = []
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i]
    const raw = head.raw.replace(/<a class="anchor_super"[\s\S]*/, '')
    const title = htmlText(raw)
    const date = title.match(/[（(](\d{4})\/(\d{1,2})\/(\d{1,2})\s*[～~]/)
    if (!date) continue
    const from = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`
    const label = (
      title.match(/【(.+?)】/)?.[1] ??
      title
        .slice(0, date.index)
        .replace(/[（(]\s*終了\s*[)）]/g, '')
        .replace(/期間限定邂逅|特別邂逅/g, '')
        .replace(/[、,\s]+$/, '')
    ).trim()
    const body = html.slice(head.headEnd, heads[i + 1]?.start ?? html.length)
    batches.push({ id: head.id, title, from, label: label.slice(0, 60), body, raw })
  }

  const entries = []
  for (const batch of batches) {
    const signals = headingEndSignals(batch.raw)
    // 另一种排法：一舰一张表（「伊8のドロップが確認されたポイント」+ 只有海域/点位两列）。
    // 这种表里没有舰名格，舰名在表**前面**那个 <li> 里，得按位置认领。
    // 一个 <li> 可以带好几条舰、各自划各自的（「天津風、<del>浦風</del>、<del>巻雲</del>の…」），
    // 所以整串都要收下、逐条记自己的删除线——只取最后一条会把同一格里的其余舰整条丢掉。
    // 这里的 <li> 还常常写着**明确的终了日**（「（2024/4/10終了）」），逐条大表里没有；
    // 有日子的那些能落成 ended_confirmed，比只说「终了了」结实。
    const owners = []
    for (const one of batch.body.matchAll(
      /<li>([\s\S]{0,400}?)のドロップが確認されたポイント\s*(?:[（(]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*終了\s*[)）])?/g,
    )) {
      const ships = shipLinksWithStrike(one[1])
      if (!ships.length) continue
      const endedAt = one[2] ? `${one[2]}-${one[3].padStart(2, '0')}-${one[4].padStart(2, '0')}` : null
      owners.push({ at: one.index, ships, endedAt })
    }
    for (const table of batch.body.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)) {
      for (const row of tableGrid(table[0])) {
        let pointCell = null
        let shipCell = null
        for (const cell of row) {
          if (!cell) continue
          const text = htmlText(cell.html)
          if (!pointCell && LIMITED_POINT.test(text)) {
            pointCell = { cell, text }
            continue
          }
          if (!shipCell && shipLinksWithStrike(cell.html).length && !/海域$/.test(text)) {
            shipCell = cell
          }
        }
        if (!pointCell) continue
        let rowShips
        let endedAt = null
        if (shipCell) {
          rowShips = shipLinksWithStrike(shipCell.html)
        } else {
          // 一舰一表：认领最近一个在它前面的 <li>。这种表里划掉的是舰名那一格或点位那一格
          const owner = [...owners].reverse().find((one) => one.at < table.index)
          if (!owner) continue
          rowShips = owner.ships
          endedAt = owner.endedAt
        }
        const point = pointCell.text.match(LIMITED_POINT)
        const map = `${point[1]}-${point[2]}`
        const nodes = point[3].split(',').map((one) => one.trim()).filter(Boolean)
        // 整格被划掉时点位自己也带删除线——那一行的每条都终了
        const pointStruck = /<del\b/i.test(pointCell.cell.html)
        for (const ship of rowShips) {
          const reasons = []
          if (ship.struck) reasons.push('del')
          if (pointStruck) reasons.push('del-point')
          if (signals.done.has(ship.name)) reasons.push('heading-終了')
          if (signals.only != null && signals.only !== ship.name) reasons.push('heading-のみ継続中')
          for (const node of nodes) {
            entries.push({
              map,
              node,
              ship: ship.name,
              ended: reasons.length > 0,
              // 上游写明了终了日的才有；逐条大表的删除线一律没有日子
              endedAt: reasons.length > 0 ? endedAt : null,
              reasons,
              batch: batch.title,
              from: batch.from,
              label: batch.label,
            })
          }
        }
      }
    }
  }
  return { batches: batches.map(({ body: _body, raw: _raw, ...rest }) => rest), entries }
}

const windowKey = (window) =>
  `${window.from}|${window.until ?? ''}|${window.lastConfirmedAt}|${window.status ?? 'active_confirmed'}`

const appendLimitedHistory = (ship, ...windows) => {
  const history = [...(ship.limitedHistory ?? [])]
  const seen = new Set(history.map(windowKey))
  for (const window of windows.filter(Boolean)) {
    const key = windowKey(window)
    if (seen.has(key)) continue
    history.push(structuredClone(window))
    seen.add(key)
  }
  if (history.length) ship.limitedHistory = history
}

// applyCurrentLimited / applyActiveLimitedWindow / confirmLimitedDropEnd 已于 2026-08-22（批次 4）删除：
// 限定期窗口的唯一出处换成了第一方台账 assets/lodes/map-drop-windows.json，
// 「把上游名单写进包」与「人工确认结束日」两条路都改到 scripts/lib/map-drop-windows.mjs 上。
// 这里保留 parseCurrentLimited——它现在只喂维护者侧的对照报告，不再写任何随包数据。

export const preserveEventMaps = (data, existingPack) => {
  let preserved = 0
  for (const [code, map] of Object.entries(existingPack?.data?.maps ?? {})) {
    if (!map?.difficulties || map.nodes) continue
    data.maps[code] = map
    preserved++
  }
  return preserved
}

export const preserveLimitedHistory = (data, existingPack) => {
  let preserved = 0
  for (const [code, oldMap] of Object.entries(existingPack?.data?.maps ?? {})) {
    const nextMap = data.maps?.[code]
    if (!oldMap?.nodes || !nextMap?.nodes) continue
    for (const [nodeName, oldNode] of Object.entries(oldMap.nodes)) {
      const nextNode = nextMap.nodes[nodeName]
      if (!nextNode) continue
      for (const oldShip of oldNode.ships ?? []) {
        let nextShip = nextNode.ships.find((ship) => ship.id === oldShip.id)
        const nextIsActive =
          nextShip?.limited &&
          (nextShip.limited.status ?? 'active_confirmed') === 'active_confirmed'
        const oldStatus = oldShip.limited?.status ?? 'active_confirmed'
        const carriedWindow =
          oldShip.limited && oldStatus !== 'active_confirmed'
            ? oldShip.limited
            : oldShip.limited && !nextIsActive
              ? {
                  ...oldShip.limited,
                  until: null,
                  status: 'end_pending',
                  statusChangedAt: nextMap.checkedAt,
                }
              : null
        if (!carriedWindow && !oldShip.limitedHistory?.length) continue
        // 只有历史、当前无条目时不能凭空把舰重新显示成常驻掉落。
        if (!nextShip && !carriedWindow) continue
        if (!nextShip) {
          nextShip = {
            id: oldShip.id,
            ...(oldShip.limitedOnly ? { limitedOnly: true } : {}),
          }
          nextNode.ships.push(nextShip)
        }
        appendLimitedHistory(nextShip, ...(oldShip.limitedHistory ?? []))
        if (carriedWindow) {
          if (
            nextShip.limited &&
            (nextShip.limited.status ?? 'active_confirmed') === 'active_confirmed'
          ) {
            appendLimitedHistory(nextShip, carriedWindow)
          } else {
            nextShip.limited = structuredClone(carriedWindow)
            if (oldShip.limitedOnly) nextShip.limitedOnly = true
          }
        }
        preserved++
      }
    }
  }
  return preserved
}

let lastNetworkRequestAt = 0

export const fetchText = async (url, options = {}) => {
  const cacheFile = options.cacheFile
  if (cacheFile && existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8')

  for (let attempt = 0; attempt < 5; attempt++) {
    const minIntervalMs = options.minIntervalMs ?? 0
    const remaining = minIntervalMs - (Date.now() - lastNetworkRequestAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
    lastNetworkRequestAt = Date.now()
    const response = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
    if (response.ok) {
      const html = await response.text()
      if (cacheFile) {
        mkdirSync(dirname(cacheFile), { recursive: true })
        writeFileSync(cacheFile, html)
      }
      return html
    }
    if (response.status !== 429 || attempt === 4) {
      throw new Error(`${url} → HTTP ${response.status}`)
    }
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1_000 : 65_000
    console.warn(`\n[lodes]   WIKIWIKI 限流，${Math.ceil(waitMs / 1_000)} 秒后重试`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  throw new Error(`${url} → 重试耗尽`)
}

const sourceUrl = (area, no) => `${WIKI_ROOT}${encodeURI(`${NORMAL_MAP_PAGES[area]}/${area}-${no}`)}`
const areaSourceUrl = (area) => `${WIKI_ROOT}${encodeURI(NORMAL_MAP_PAGES[area])}`

export const splitAreaMaps = (html, area, last) => {
  const headings = []
  const headingRe = /<h2\b[^>]*>(?:(?!<\/h2>)[\s\S])*?<a\b[^>]*>(\d+-\d+)<\/a>\./gi
  for (const match of html.matchAll(headingRe)) {
    const code = match[1]
    if (!code.startsWith(`${area}-`)) continue
    const no = Number(code.split('-')[1])
    if (!Number.isInteger(no) || no < 1 || no > last) continue
    headings.push({ code, at: match.index })
  }
  const sections = new Map()
  for (let index = 0; index < headings.length; index++) {
    const current = headings[index]
    const end = headings[index + 1]?.at ?? html.length
    sections.set(current.code, html.slice(current.at, end))
  }
  return sections
}

export const fetchMapIntel = async (shipsPack, options = {}) => {
  const cacheFile = (name) => (options.cacheDir ? `${options.cacheDir}/${name}.html` : undefined)
  const fetchOptions = (name) => ({
    cacheFile: cacheFile(name),
    minIntervalMs: options.minIntervalMs ?? 0,
  })
  const limitedUrl = `${WIKI_ROOT}${encodeURI('期間限定ドロップイベント')}`
  const limitedHtml = await fetchText(limitedUrl, fetchOptions('limited'))
  const masterNames = options.masterNames ?? []
  const limited = parseCurrentLimited(limitedHtml, shipsPack, masterNames)
  if (limited.unmatchedNames.length) {
    throw new Error(
      `期间限定页有舰名解析不出（会静默缺掉落）：${limited.unmatchedNames.join('、')}` +
        `——多半是 kcwiki 包与 s2 快照都缺该舰，先刷新仓库上一级的 s2.json`,
    )
  }
  const checkedAt = jstDate()
  const maps = {}
  const missingLimited = []

  for (const [areaText, last] of Object.entries(options.mapLast ?? NORMAL_MAP_LAST)) {
    const area = Number(areaText)
    const areaUrl = areaSourceUrl(area)
    const areaHtml = await fetchText(areaUrl, fetchOptions(`area-${area}`))
    const sections = splitAreaMaps(areaHtml, area, last)
    if (sections.size !== last) {
      throw new Error(`${NORMAL_MAP_PAGES[area]} 聚合页只解析到 ${sections.size}/${last} 张图`)
    }
    const lastModified = areaHtml.match(/Last-modified:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? checkedAt
    for (let no = 1; no <= last; no++) {
      const code = `${area}-${no}`
      const url = sourceUrl(area, no)
      const html = sections.get(code)
      const drops = parseDropTable(html, shipsPack, limited.maps.get(code) ?? new Map(), masterNames)
      const enemies = parseEnemyTable(html)
      const nodeNames = new Set([...Object.keys(drops.nodes), ...Object.keys(enemies)])
      const nodes = {}
      for (const node of [...nodeNames].sort()) {
        nodes[node] = {
          ships: drops.nodes[node] ?? [],
          emptyDrop: code === '1-1' && node === 'C' ? 'confirmed' : 'unknown',
          enemyComps: enemies[node] ?? [],
        }
      }
      maps[code] = {
        source: '艦これ攻略 Wiki',
        sourceUrl: url,
        checkedAt,
        revision: lastModified,
        nodes,
      }
      if (drops.unmatchedLimited.length) {
        missingLimited.push(`${code}: ${drops.unmatchedLimited.join(',')}`)
      }
      process.stdout.write(`\r[lodes]   海域情报 ${Object.keys(maps).length}/36 图`)
    }
  }
  process.stdout.write('\n')

  const mapCount = Object.keys(maps).length
  const dropNodes = Object.values(maps).reduce(
    (sum, map) => sum + Object.values(map.nodes).filter((node) => node.ships.length).length,
    0,
  )
  const enemyNodes = Object.values(maps).reduce(
    (sum, map) => sum + Object.values(map.nodes).filter((node) => node.enemyComps.length).length,
    0,
  )
  const comps = Object.values(maps).reduce(
    (sum, map) =>
      sum + Object.values(map.nodes).reduce((nodeSum, node) => nodeSum + node.enemyComps.length, 0),
    0,
  )
  const limitedShips = Object.values(maps).reduce(
    (sum, map) =>
      sum +
      new Set(
        Object.values(map.nodes).flatMap((node) =>
          node.ships.filter((ship) => ship.limited).map((ship) => ship.id),
        ),
      ).size,
    0,
  )
  // 图数按本次抓取范围(mapLast)动态核对——写死 36 曾在 5-6 实装后把
  // 正确的 37 图结果当「覆盖不足」拒收
  const expectedMaps = Object.values(options.mapLast ?? NORMAL_MAP_LAST).reduce(
    (sum, last) => sum + last,
    0,
  )
  if (mapCount !== expectedMaps || dropNodes < 150 || enemyNodes < 150 || comps < 400) {
    throw new Error(
      `海域情报覆盖不足：${mapCount} 图(预期 ${expectedMaps}) / ${dropNodes} 掉落点 / ${enemyNodes} 敌编成点 / ${comps} 编成`,
    )
  }
  const oneOne = maps['1-1']
  if (
    oneOne.nodes.A.ships.length !== 36 ||
    oneOne.nodes.B.ships.length !== 38 ||
    oneOne.nodes.C.ships.length !== 53 ||
    oneOne.nodes.A.enemyComps.length !== 3 ||
    oneOne.nodes.B.enemyComps.length !== 3 ||
    oneOne.nodes.C.enemyComps.length !== 3
  ) {
    throw new Error('1-1 基准计数变化——停止生成，等待人工核对')
  }
  if (missingLimited.length) {
    console.warn(`[lodes]   当前限定未能从活动小节定位点位：${missingLimited.join('；')}`)
  }
  console.log(
    `[lodes]   海域情报：${mapCount} 图 / ${dropNodes} 掉落点 / ${enemyNodes} 敌编成点 / ${comps} 编成 / ${limitedShips} 个图内限定舰`,
  )
  console.log(`[lodes]   期间限定名单最后确认：${limited.checkedAt}`)
  return { schemaVersion: 1, maps }
}
