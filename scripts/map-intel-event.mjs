import { parseEnemyTableHtml, htmlText, nodeNames, shipMatcher, tableGrid } from './map-intel.mjs'

export const EVENT_DIFFICULTIES = ['甲', '乙', '丙', '丁']

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const anchorAt = (html, name, from = 0) => {
  const pattern = new RegExp(
    `<a\\b[^>]*\\bname\\s*=\\s*[\"']${escapeRegExp(name)}[\"'][^>]*>`,
    'i',
  )
  const at = html.slice(from).search(pattern)
  return at < 0 ? -1 : from + at
}

const sectionBetween = (html, startAnchor, endAnchor) => {
  const start = anchorAt(html, startAnchor)
  if (start < 0) return ''
  const end = endAnchor ? anchorAt(html, endAnchor, start + 1) : -1
  return html.slice(start, end > start ? end : undefined)
}

const tablesIn = (html) =>
  [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)].map((match) => ({
    at: match.index,
    html: match[0],
  }))

const enemyAnchors = [
  ['甲', 'fleetk', 'fleeto'],
  ['乙', 'fleeto', 'fleeth'],
  ['丙', 'fleeth', 'fleett'],
  ['丁', 'fleett', 'airraid'],
]

export const parseEventEnemyTables = (html) => {
  const difficulties = {}
  const distances = {}
  for (const [difficulty, start, end] of enemyAnchors) {
    const section = sectionBetween(html, start, end)
    const table = tablesIn(section).find((candidate) => {
      const text = htmlText(candidate.html)
      return text.includes('出現場所') && text.includes('出現艦船') && text.includes('陣形')
    })
    if (!table) throw new Error(`活动页缺少 ${difficulty} 难度敌编成表`)
    const nodes = parseEnemyTableHtml(table.html)
    difficulties[difficulty] = nodes
    distances[difficulty] = parseEventNodeDistances(table.html)
  }
  return { difficulties, distances }
}

const parseEventNodeDistances = (table) => {
  const grid = tableGrid(table)
  const headerAt = grid.findIndex((row) => row.some((cell) => cell?.text === '出現場所'))
  if (headerAt < 0) return {}
  const header = grid[headerAt].map((cell) => cell?.text ?? '')
  const nodeCol = header.indexOf('出現場所')
  const distanceCol = header.findIndex((cell) => /半径|行動半径/.test(cell))
  if (nodeCol < 0 || distanceCol < 0) return {}
  const result = {}
  for (const row of grid.slice(headerAt + 1)) {
    const distance = Number.parseInt((row[distanceCol]?.text ?? '').match(/\d+/)?.[0] ?? '', 10)
    if (!Number.isInteger(distance) || distance < 0 || distance > 99) continue
    for (const node of nodeNames(row[nodeCol]?.text ?? '')) {
      if (result[node] == null) result[node] = distance
    }
  }
  return result
}

const translateOperation = (value) =>
  htmlText(value)
    .replaceAll('装甲破砕', '装甲破碎')
    .replaceAll('ギミック', '机关')
    .replaceAll('マス', '点')
    .replaceAll('航空優勢', '航空优势')
    .replaceAll('制空権確保', '制空权确保')
    .replaceAll('S勝利', 'S胜')
    .replaceAll('A勝利', 'A胜')
    .replaceAll('到達', '到达')
    .replaceAll('基地防空', '基地防空')
    .replaceAll('強友軍', '强友军')
    .replaceAll('通常友軍', '普通友军')
    .replaceAll('友軍来援なし', '无友军来援')
    .replaceAll('戦力', '战力')
    .replaceAll('輸送', '运输')
    .replaceAll('第一ボス', '第一 Boss')
    .replaceAll('第二ボス', '第二 Boss')
    .replaceAll('第三ボス', '第三 Boss')
    .replaceAll('海域倍率', '海域倍率')
    .replaceAll('海防艦', '海防舰')
    .replaceAll('駆逐艦', '驱逐舰')
    .replaceAll('軽巡洋艦', '轻巡洋舰')
    .replaceAll('練習巡洋艦', '练习巡洋舰')
    .replaceAll('重巡級', '重巡级')
    .replaceAll('軽空母', '轻空母')
    .replaceAll('戦艦級', '战舰级')
    .replaceAll('水上機母艦', '水上机母舰')
    .replaceAll('潜水母艦', '潜水母舰')
    .replace(/\s+/g, ' ')
    .trim()

const headingBefore = (html, at, fallback) => {
  const context = html.slice(Math.max(0, at - 3000), at)
  const headings = [
    ...context.matchAll(/<(?:h3|h4)\b[^>]*>([\s\S]*?)<\/(?:h3|h4)>/gi),
    ...context.matchAll(/<div\b[^>]*class="[^"]*fold-summary[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
  ]
  return translateOperation(headings.at(-1)?.[1] ?? fallback)
}

export const parseEventGimmicks = (html) => {
  const byDifficulty = Object.fromEntries(EVENT_DIFFICULTIES.map((difficulty) => [difficulty, []]))
  let serial = 0
  for (const table of tablesIn(html)) {
    const grid = tableGrid(table.html)
    const headerAt = grid.findIndex((row) => {
      const cells = row.map((cell) => cell?.text ?? '')
      return cells.some((cell) => /マス.*難易度|難易度.*マス/.test(cell)) &&
        EVENT_DIFFICULTIES.every((difficulty) => cells.includes(difficulty))
    })
    if (headerAt < 0) continue
    const header = grid[headerAt].map((cell) => cell?.text ?? '')
    const nodeCol = 0
    const title = headingBefore(html, table.at, `机关条件 ${++serial}`)
    const steps = Object.fromEntries(EVENT_DIFFICULTIES.map((difficulty) => [difficulty, []]))
    for (const row of grid.slice(headerAt + 1)) {
      const node = translateOperation(row[nodeCol]?.html ?? row[nodeCol]?.text ?? '')
      if (!node || /備考|备注/.test(node)) continue
      for (const difficulty of EVENT_DIFFICULTIES) {
        const col = header.indexOf(difficulty)
        const condition = translateOperation(row[col]?.html ?? row[col]?.text ?? '')
        if (!condition || /^[-ｰ―—－]+$/.test(condition)) continue
        steps[difficulty].push(`${node}：${condition}`)
      }
    }
    for (const difficulty of EVENT_DIFFICULTIES) {
      if (steps[difficulty].length) byDifficulty[difficulty].push({ title, steps: steps[difficulty] })
    }
  }
  return byDifficulty
}

const sectionFromAnchorToNextHeading = (html, anchor) => {
  const start = anchorAt(html, anchor)
  if (start < 0) return ''
  const next = html.slice(start + 1).search(/<h3\b/i)
  return html.slice(start, next < 0 ? undefined : start + 1 + next)
}

export const parseEventSpecialShips = (html, shipsPack) => {
  const section = sectionFromAnchorToNextHeading(html, 'Seffects')
  const table = tablesIn(section).find((candidate) => /艦種\/国籍\/艦名/.test(htmlText(candidate.html)))
  if (!table) return []
  const grid = tableGrid(table.html)
  const headerAt = grid.findIndex((row) => row.some((cell) => /艦種\/国籍\/艦名/.test(cell?.text ?? '')))
  if (headerAt < 0) return []
  const header = grid[headerAt].map((cell) => translateOperation(cell?.html ?? cell?.text ?? ''))
  const matchShips = shipMatcher(shipsPack)
  const result = []
  for (const row of grid.slice(headerAt + 1)) {
    const label = translateOperation(row[0]?.html ?? row[0]?.text ?? '')
    // Wiki 的倍率表尾部常接「注意」的 colspan/rowspan 表。tableGrid 会为跨列
    // 展开同一段说明，其中出现的舰名不是新的特效行；从该分隔行起整段停止解析。
    if (/注意/.test(label)) break
    if (!label || /倍率計算式|装備特効|基地航空隊特効/.test(label)) continue
    const effect = row
      .slice(1)
      .map((cell, index) => {
        const value = translateOperation(cell?.html ?? cell?.text ?? '')
        return value ? `${header[index + 1] || `区分${index + 1}`} ${value}` : ''
      })
      .filter(Boolean)
      .join(' · ')
    if (!effect) continue
    const matches = matchShips(row[0]?.text ?? '')
    if (matches.length) {
      for (const ship of matches) result.push({ id: ship.id, label: ship.name, effect })
    } else {
      result.push({ label, effect })
    }
  }
  return result
}

// 友军舰队。
//
// ⚠ 这一节的默认答案是**空表**，而且空表是正确终态，不是「没抓到」。
// 官方按期投入友军，投入之前 wiki 的这张表是一副**空模板**：行里写的是字面量
// 「艦娘名」，末尾还挂着一行「友軍来援なし／最低保証枠」——那是表例（图例），
// 不是对本期活动的断言。2026-08-24 实测（本期友军官方公告 2026/08/26 夜以降投入，
// E1–E5 五页的来援日時列全是「-」）：旧判据把那行图例读成事实，
// 于是铎的「友军舰队」格显示「无友军支援」，看上去像**已经确认过没有友军**。
// 事实是「还没实装」。两件事在玩家眼里天差地别。
//
// 所以判据改成：整张表里**一条舰名都解析不出来**时，认定它还是空模板，返回空表；
// 铎那一格照旧显示「尚无已确认的友军编成」。等 08-26 官方投入、wiki 填上真名字之后，
// 这里会自然解析出 `ships` 非空的行，那时「友軍来援なし」才重新有断言意义
//（它那时表示的是「这个点确认没有来援」，与图例行不再混淆）。
// 舰名格后面跟的那段括号注记必须先抹掉再匹配舰名。
// 上游一格写的是 `梅改 (魚魚主&主魚電&魚水電)`——括号里是連撃/CI 型与装备缩写，
// 其中的「電」是**電探**的简写。而 shipMatcher 是纯子串匹配（最长名优先、不重叠），
// 整格文本一起喂进去，注记里的每一个「電」都会变成一位并不存在的随伴舰電（mstId 37）。
// 2026-08-27 实测 E4：10 条编成里 6 条被塞进 1–4 位假電，而用户当天在 62-4 丙 Boss 点
// 实遇的三支里一位電都没有——两层一对照，假舰当场现形。
// 舰名一律写在括号外，所以整段抹掉是安全的；半角全角都要抹。
const withoutAnnotations = (text) => text.replace(/[(（][^)）]*[)）]/g, ' ')

export const parseEventFriendlyFleets = (html, shipsPack) => {
  const section = sectionFromAnchorToNextHeading(html, 'friend')
  const table = tablesIn(section).find((candidate) => /旗艦/.test(htmlText(candidate.html)) && /随伴艦/.test(htmlText(candidate.html)))
  if (!table) return []
  const matchShips = shipMatcher(shipsPack)
  const grid = tableGrid(table.html)
  const headerAt = grid.findIndex((row) => row.some((cell) => /旗艦/.test(cell?.text ?? '')))
  if (headerAt < 0) return []
  const body = grid.slice(headerAt + 1)
  const shipsTextOf = (row) => withoutAnnotations(row.map((cell) => cell?.text ?? '').join(' '))
  // 先看整张表有没有任何一条真舰名。一条都没有 = 还是空模板，整张表不作数。
  // 这一步同样要走抹注记后的文本：否则空模板里 `()` 注记撞上一个短舰名，
  // 整张模板就会被判成「已实装」，铎那一格转而端出一副由装备缩写拼成的假编成。
  if (!body.some((row) => matchShips(shipsTextOf(row)).length)) {
    return []
  }
  const fleets = []
  for (const row of body) {
    const whole = row.map((cell) => cell?.text ?? '').join(' ')
    if (/艦娘名/.test(whole) && !/来援なし/.test(whole)) continue
    const matches = matchShips(shipsTextOf(row))
    const note = translateOperation(row.at(-1)?.html ?? row.at(-1)?.text ?? '')
    if (matches.length) {
      fleets.push({ ships: matches.map((ship) => ({ id: ship.id, name: ship.name })), ...(note ? { note } : {}) })
    } else if (/友軍来援なし/.test(whole)) {
      fleets.push({ ships: [], note: '无友军来援' })
    }
  }
  return fleets
}

const dropCellConfirmed = (text) => /[SA]/i.test(text) && !/^[-―—－]+$/.test(text.trim())

export const parseEventDifficultyDrops = (html, shipsPack) => {
  const matchShips = shipMatcher(shipsPack)
  const section = sectionBetween(html, 'Dropsbydifficultylevel', 'commentdrop')
  if (!section) throw new Error('活动页缺少难度别稀有舰掉落区')
  const drops = Object.fromEntries(EVENT_DIFFICULTIES.map((difficulty) => [difficulty, {}]))
  const emptyDropNodes = new Set()
  const unresolved = new Set()
  let previousTableEnd = 0
  let parsedTables = 0

  for (const table of tablesIn(section)) {
    const grid = tableGrid(table.html)
    const headerAt = grid.findIndex((row) => {
      const cells = row.map((cell) => cell?.text ?? '')
      return EVENT_DIFFICULTIES.every((difficulty) => cells.includes(difficulty))
    })
    if (headerAt < 0) continue
    const header = grid[headerAt].map((cell) => cell?.text ?? '')
    const difficultyCols = Object.fromEntries(
      EVENT_DIFFICULTIES.map((difficulty) => [difficulty, header.indexOf(difficulty)]),
    )
    parsedTables++
    const context = section.slice(previousTableEnd, table.at)
    const summaries = [
      ...context.matchAll(
        /<div\b[^>]*class="[^"]*fold-summary hidden-on-open[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/gi,
      ),
    ]
    const summary = htmlText(summaries.at(-1)?.[1] ?? context)
    const nodes = nodeNames(summary)
    if (!nodes.length) {
      previousTableEnd = table.at + table.html.length
      continue
    }
    if (/確定ドロップではありません|ドロップなし|ガシャン/.test(context)) {
      for (const node of nodes) emptyDropNodes.add(node)
    }

    for (const row of grid.slice(headerAt + 1)) {
      const shipText = row[0]?.text ?? ''
      const ship = matchShips(shipText)[0]
      if (!ship) {
        if (
          shipText &&
          !/艦名|難易度|可能性|表します|^\[\[|''''/.test(shipText)
        ) {
          unresolved.add(shipText)
        }
        continue
      }
      for (const difficulty of EVENT_DIFFICULTIES) {
        const col = difficultyCols[difficulty]
        if (col < 0 || !dropCellConfirmed(row[col]?.text ?? '')) continue
        for (const node of nodes) {
          const list = (drops[difficulty][node] ??= [])
          if (!list.some((entry) => entry.id === ship.id)) list.push({ id: ship.id })
        }
      }
    }
    previousTableEnd = table.at + table.html.length
  }
  if (!parsedTables) throw new Error('活动页的难度别掉落表解析为空')
  return { drops, emptyDropNodes, unresolved: [...unresolved] }
}

// 海域撃破ボーナス:图信息表里一列 th rowspan=N,首行「共通」,后续「+ 甲作戦」…
// 每行一档。奖励正文原样保留(装备/道具名日文,选择肢/★+N/xN 都是 wiki 原文),
// 不拆条目不硬译——展示层照录,认不出标签的行归「共通」而不是丢掉。
export const parseEventBreakthroughBonus = (html) => {
  for (const table of tablesIn(html)) {
    if (!table.html.includes('海域撃破ボーナス')) continue
    const grid = tableGrid(table.html)
    const rows = []
    const seenCells = new Set()
    for (const row of grid) {
      const at = row.findIndex((cell) => (cell?.text ?? '').trim() === '海域撃破ボーナス')
      if (at < 0) continue
      const cell = row.slice(at + 1).find((c) => c && `${c.text ?? ''}`.trim())
      // rowspan 展开让标签格出现在每一行;正文格按对象去重,一格只收一次
      if (!cell || seenCells.has(cell)) continue
      seenCells.add(cell)
      rows.push(htmlText(cell.html ?? '', ' ').replace(/\s+/g, ' ').trim())
    }
    if (!rows.length) continue
    return rows.map((text) => {
      const m = text.match(/^(?:共通|\+?\s*([甲乙丙丁])作戦)\s*[::]\s*(.*)$/)
      return m ? { scope: m[1] ?? '共通', text: m[2].trim() } : { scope: '共通', text }
    })
  }
  return []
}

// 「ドロップ艦一覧」区（锚点 drop，在 Dropsbydifficultylevel 之前）——全难度合算的那张表。
//
// 为什么要单独收这一张：上游的「難易度別レア艦ドロップ」只逐点收 boss 与个别点
//（2026-08-26 实测 62-4 该区只有 8 张表，P1 出现 0 次），而途中点的掉落只有这张
// 不分难度的总表有。它自己在表头写着「ドロップ報告がないマスはグレーで示されています」，
// 是一张按点位铺开的报告汇总，不带难度维度。
//
// ⚠ 这一层**绝不能混进分难度层**：它是甲乙丙丁的合算，把它写进丙层就是拿合算值
// 冒充丙的事实。所以它挂在图级 allDiffDrops，与 difficulties 平级——
// 结构上就没有混进去的路，展示层再决定什么时候回退到它（并标「不分难度」）。
export const parseEventAllDifficultyDrops = (html, shipsPack) => {
  const section = sectionBetween(html, 'drop', 'Dropsbydifficultylevel')
  if (!section) return {}
  const matchShips = shipMatcher(shipsPack)
  const table = tablesIn(section).find((candidate) =>
    tableGrid(candidate.html).some((row) => row.some((cell) => cell?.text === '戦艦級')),
  )
  if (!table) return {}
  const grid = tableGrid(table.html)
  const headerAt = grid.findIndex((row) => row.some((cell) => cell?.text === '戦艦級'))
  const nodes = {}
  for (const row of grid.slice(headerAt + 1)) {
    // 行首是点名，可能带「D 第一 ボス」这样的后缀；数字后缀点（P1/T1）照收
    const names = nodeNames(row[0]?.text ?? '')
    if (!names.length) continue
    const ships = new Map()
    for (const cell of row.slice(1)) {
      if (!cell?.html) continue
      for (const ship of matchShips(htmlText(cell.html, ' '))) ships.set(ship.id, { id: ship.id })
    }
    // 报告为空的点（上游涂灰）不写空数组：那是「没有报告」，不是「确认不掉」
    if (!ships.size) continue
    for (const node of names) nodes[node] = [...ships.values()]
  }
  return nodes
}

export const parseEventMapPage = (html, shipsPack) => {
  const enemyResult = parseEventEnemyTables(html)
  const dropResult = parseEventDifficultyDrops(html, shipsPack)
  const gimmicks = parseEventGimmicks(html)
  const specialShips = parseEventSpecialShips(html, shipsPack)
  const friendlyFleets = parseEventFriendlyFleets(html, shipsPack)
  const difficulties = {}
  for (const difficulty of EVENT_DIFFICULTIES) {
    const enemyNodes = enemyResult.difficulties[difficulty]
    const dropNodes = dropResult.drops[difficulty]
    const names = new Set([
      ...Object.keys(enemyNodes),
      ...Object.keys(dropNodes),
      ...dropResult.emptyDropNodes,
    ])
    const nodes = {}
    for (const node of [...names].sort()) {
      nodes[node] = {
        ships: dropNodes[node] ?? [],
        emptyDrop: dropResult.emptyDropNodes.has(node) ? 'confirmed' : 'unknown',
        enemyComps: enemyNodes[node] ?? [],
      }
    }
    difficulties[difficulty] = {
      nodes,
      operations: {
        gimmicks: gimmicks[difficulty],
        specialShips,
        friendlyFleets,
        nodeDistances: enemyResult.distances[difficulty],
      },
    }
  }
  return {
    difficulties,
    allDiffDrops: parseEventAllDifficultyDrops(html, shipsPack),
    unresolved: dropResult.unresolved,
    rewards: parseEventBreakthroughBonus(html),
  }
}
