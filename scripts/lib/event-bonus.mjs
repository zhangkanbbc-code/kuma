// 活动倍卡表（kcwiki 活动页「倍卡表」章节）的解析判据。
//
// 为什么单独一层：倍卡是活动图伤害的大头，而它**只以自然语言表格存在**。
// 直接把整段文字塞进 UI 是现状；要让预测吃到它，就必须先解析成结构化的数值，
// 而这一步一旦解析错，算出来的是另一支舰队的伤害——所以判据要单独可测。
//
// 页面自己写明的规则（原文）：
//   「以上倍率中，全图倍卡、点位倍卡、舰种倍卡与分组倍卡分别计算；
//     同一舰娘同时满足多个条件时，各项补正叠乘。」
// 因此本模块只负责**如实提取每一项**，叠乘交给使用方。
//
// 两处容易栽的地方：
//   · wikitable 大量使用 rowspan/colspan，逐行读会串列——必须先展开成矩阵；
//   · 数值常写成区间（1.7063~1.7064）或带问号（1.77?），那是社区实测残留的
//     不确定性，**不能悄悄取中值当确定值**，要原样带着标记往上传。

/** 去掉 wiki 链接、粗体、注释标记，留下纯文本。 */
export const stripWiki = (raw) =>
  `${raw ?? ''}`
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\|([^}]*)\}\}/g, '$1')
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()

/**
 * 解析一个数值单元格。
 * 返回 null 表示这一格没有倍率（"-" 或空），不是 0——0 会被当成"打不出伤害"。
 */
export const parseRate = (raw) => {
  const text = stripWiki(raw)
  if (!text || text === '-' || text === '－') return null
  // 区间：1.7063~1.7064。取下界并标记，不悄悄取中值。
  const range = /^([\d.]+)\s*[~～]\s*([\d.]+)$/.exec(text)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    return { value: min, max, certain: false, note: '社区实测区间' }
  }
  // 带问号 = wiki 自标的推定值
  const guess = /^([\d.]+)\s*[?？]$/.exec(text)
  if (guess) {
    const value = Number(guess[1])
    return Number.isFinite(value) ? { value, max: value, certain: false, note: '推定值' } : null
  }
  const plain = /^([\d.]+)$/.exec(text)
  if (!plain) return null
  const value = Number(plain[1])
  return Number.isFinite(value) ? { value, max: value, certain: true, note: null } : null
}

/**
 * 把一张 wikitable 展开成二维单元格矩阵，正确处理 rowspan / colspan。
 * 每格是 { text, header }，跨行跨列的格会在覆盖到的每个位置重复出现。
 */
export const parseWikiTable = (source) => {
  const lines = source.split('\n')
  const rows = []
  let current = null
  // carry[列号] = { text, header, rowsLeft } —— 上面某行 rowspan 覆盖下来的格
  const carry = []
  // 本行仍在生效的占位。**必须按列号在读到那一列时才填**：
  // 一开始就整批插到行首，会把本行自己的第一格（"P3 Boss（S点）"这种行标题）
  // 挤到后面去，整行错位。
  let pending = new Map()

  const startRow = () => {
    pending = new Map()
    for (let col = 0; col < carry.length; col += 1) {
      const held = carry[col]
      if (held && held.rowsLeft > 0) {
        pending.set(col, held)
        held.rowsLeft -= 1
      }
    }
  }

  const fillPending = (row) => {
    while (pending.has(row.length)) {
      const held = pending.get(row.length)
      row.push({ text: held.text, header: held.header })
    }
  }

  const finishRow = () => {
    if (current) {
      fillPending(current) // 行尾也可能还挂着占位
      rows.push(current)
    }
    current = null
  }

  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('{|')) continue
    if (t.startsWith('|}')) break
    if (t.startsWith('|-')) {
      finishRow()
      current = []
      startRow()
      continue
    }
    if (!t.startsWith('!') && !t.startsWith('|')) continue
    if (!current) {
      current = []
      startRow()
    }
    const header = t.startsWith('!')
    // 一行里可以用 !! / || 并排多个单元格
    const chunks = t
      .slice(1)
      .split(header ? '!!' : '||')
      .map((x) => x.trim())
    for (const chunk of chunks) {
      fillPending(current)
      // 属性与内容以单个 | 分隔（属性里不会再出现 |）
      const sep = chunk.indexOf('|')
      const attrs = sep >= 0 ? chunk.slice(0, sep) : ''
      const body = sep >= 0 ? chunk.slice(sep + 1) : chunk
      const looksLikeAttrs = /(colspan|rowspan|style|class|align)\s*=/.test(attrs)
      const text = looksLikeAttrs ? body.trim() : chunk.trim()
      const colspan = looksLikeAttrs ? parseInt(/colspan\s*=\s*"?(\d+)/.exec(attrs)?.[1] ?? '1', 10) : 1
      const rowspan = looksLikeAttrs ? parseInt(/rowspan\s*=\s*"?(\d+)/.exec(attrs)?.[1] ?? '1', 10) : 1
      const col = current.length
      for (let i = 0; i < colspan; i += 1) current.push({ text, header })
      if (rowspan > 1) {
        for (let i = 0; i < colspan; i += 1) {
          carry[col + i] = { text, header, rowsLeft: rowspan - 1 }
        }
      }
    }
  }
  finishRow()
  return rows
}

/** 从整个「倍卡表」章节里切出各 E 图的原始表格。 */
export const splitEventSections = (wikitext) => {
  const sections = {}
  const re = /===\s*(E\d)\s*倍卡表\s*===/g
  const marks = []
  let m
  while ((m = re.exec(wikitext))) marks.push({ key: m[1], at: m.index + m[0].length })
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? wikitext.lastIndexOf('===', marks[i + 1].at) : wikitext.length
    sections[marks[i].key] = wikitext.slice(marks[i].at, end)
  }
  return sections
}

/** 章节里的每一张 wikitable。 */
export const tablesIn = (section) => {
  const out = []
  let from = 0
  for (;;) {
    const start = section.indexOf('{|', from)
    if (start < 0) break
    const end = section.indexOf('\n|}', start)
    if (end < 0) break
    out.push(section.slice(start, end + 3))
    from = end + 3
  }
  return out
}

// ---- 从矩阵提取条目 ----

const CATEGORY_BY_HEADER = {
  舰种: 'stype',
  国籍: 'nation',
  个别舰: 'ship',
  舰载机加成: 'plane',
  陆航: 'lbas',
  装备组加成: 'equipGroup',
}

/**
 * 抽出一张倍卡表里的全部条目。
 * 每条 { scope, by, key, value, max, certain, note }：
 *   scope = 适用范围原文（"全图" / "P4 Boss（X点）"）
 *   by    = 判据类别（stype/nation/ship/equipGroup/…）
 *   key   = 该类别下的具体对象（"驱逐" / "英" / "Mogador" / "A组"）
 * 只做如实提取，叠乘与匹配交给使用方。
 */
export const extractBonusTable = (table) => {
  const rows = parseWikiTable(table)
  if (!rows.length) return { title: '', entries: [] }
  const title = stripWiki(rows[0]?.[0]?.text ?? '')

  // 找列头：**第一个**「整行都是表头、且下一行有数据」的行。
  // 必须取第一个——表格中段的「个别舰倍卡」「削甲」这类小节标题同样满足这个形状，
  // 取最后一个会让列头变成那些小节标题，整张表一条也提取不出来。
  let headerRow = -1
  for (let i = 1; i < rows.length; i += 1) {
    const allHeader = rows[i].length > 1 && rows[i].every((c) => c.header)
    const nextIsData = rows[i + 1]?.some((c) => !c.header)
    if (allHeader && nextIsData) {
      headerRow = i
      break
    }
  }
  if (headerRow < 0) return { title, entries: [] }

  // 上一行若也是全表头，它是分类行（舰种/国籍…）
  const categoryRow = headerRow > 1 && rows[headerRow - 1].every((c) => c.header)
    ? rows[headerRow - 1]
    : null
  const columns = rows[headerRow].map((cell, col) => ({
    key: stripWiki(cell.text).split('\n')[0].trim(),
    by: CATEGORY_BY_HEADER[stripWiki(categoryRow?.[col]?.text ?? '')] ?? null,
  }))

  const entries = []
  let section = null // "个别舰倍卡" / "削甲" 之类的小节标题
  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row.length) continue
    // 整行合并的表头 = 小节标题
    const merged = row.every((c) => c.text === row[0].text)
    if (merged && row[0].header) {
      section = stripWiki(row[0].text)
      continue
    }
    const scope = stripWiki(row[0].text)
    if (!scope) continue
    // 个别舰 / 装备组这类：一整格里是 "名字: 数值<br/>名字: 数值"
    const restMerged = row.length > 2 && row.slice(1).every((c) => c.text === row[1].text)
    if (restMerged) {
      const body = stripWiki(row[1].text)
      if (section === '削甲' || section === '削甲效果') {
        entries.push({ scope, by: 'armorDebuff', key: null, raw: body })
        continue
      }
      // 装备组成员表："A组 | 装备1<br/>装备2"
      if (/^[A-Z]组$/.test(scope)) {
        entries.push({ scope: null, by: 'equipGroupMembers', key: scope, raw: body })
        continue
      }
      if (/^[A-Z]组$/.test(scope) === false && section === '分组舰娘') {
        entries.push({ scope: null, by: 'shipGroupMembers', key: scope, raw: body })
        continue
      }
      for (const line of body.split('\n')) {
        const m = /^(.+?)\s*[:：]\s*(.+)$/.exec(line.trim())
        if (!m) continue
        const rate = parseRate(m[2])
        if (rate) entries.push({ scope, by: 'ship', key: m[1].trim(), ...rate })
      }
      continue
    }
    for (let col = 1; col < row.length; col += 1) {
      const column = columns[col]
      if (!column?.key || column.key === '-') continue
      // 舰载机 / 陆航两类的格子装的是**分组代号: 数值**（"C2: 1.06\nC3: 1.03"），
      // 不是裸数字。走下面的裸数字路会 parseRate 失败然后 continue，
      // 整列被静默丢掉——2026-08-28 实测：本期 E4/E5 的「陆航」列就是这样整列消失的，
      // 而同表「装备组加成」那三列因为写的是裸数字 1.12 所以活了下来，掩盖了这个洞。
      // 这里按行拆开，key 取**分组代号**（C2）而不是列名（"Group C"）：
      // 代号本身带着组别字母，列名再存一遍是冗余，且上游两张表的列名措辞并不一致。
      if (column.by === 'plane' || column.by === 'lbas') {
        for (const line of stripWiki(row[col].text).split('\n')) {
          const m = /^([A-Z]\d)\s*[:：]\s*(.+)$/.exec(line.trim())
          if (!m) continue
          const rate = parseRate(m[2])
          if (rate) entries.push({ scope, by: column.by, key: m[1], ...rate })
        }
        continue
      }
      const rate = parseRate(row[col].text)
      if (!rate) continue
      entries.push({ scope, by: column.by ?? 'unknown', key: column.key, ...rate })
    }
  }
  return { title, entries }
}

// ---- 已知源冲突台账 ----
//
// 倍卡这一项上，README 的通用事实层优先级（wikiwiki 日文一手 > kcwiki 搬运）**是反的**。
// 2026-08-07 三源逐行核对（wikiwiki E4 现行页 / kcwiki 活动页 = 上游搬运贴 / zekamashi），
// 发现 wikiwiki 那张表有三处独立错误，其余十几项三源一致：
//
//   项          wikiwiki   kcwiki   zekamashi   → 采信
//   潜水艦       1.19      1.13     1.13        kcwiki（2:1）
//   イタリア艦    1.15      1.19     1.19        kcwiki（2:1）
//   Mogador     1.6959    1.659    1.66?       kcwiki（1.66 只能由 1.659 舍入而来；
//                                               1.6959 会舍成 1.70）
//
// 另外 wikiwiki 的个别舰那段大面积还挂着 1.7? / 1.67? / 1.77?，而 kcwiki 已给到四位确定值——
// 它整体滞后。**所以倍卡以 kcwiki（搬运贴）为准，wikiwiki 仅作交叉核对。**
//
// 这张台账的用处是：合并层照通则会把 wikiwiki 判赢，必须有地方写清楚为什么不能。
//
// ---- 2026-08-24 复核：三条全部在上游收敛了 ----
//
// 拿随活动图抓取一并到手的 wikiwiki 特效表（`map-intel` 的 `operations.specialShips`，
// 不额外发一次请求）逐条重比：三条分歧**全部消失**，wikiwiki 已改成与 kcwiki 同值
//（潜水艦 1.13 / イタリア艦 1.19 / Mogador 1.659）。E1–E5 全图倍率档两源逐条一致，
// 一条新分歧都没有。
//
// **条目不删**（口径与 map-drops / map-enemy-comps 两处台账一致）：删掉只会让
// 下一轮把同一件事当成新的待裁项重新冒出来，而「当初为什么定 kcwiki 优先」的痕迹没了。
// 只多带一个 `resolvedUpstreamAt`——采信不变，仍旧是 kcwiki，
// 但看台账的人要知道这三条现在不再是「两家在打架」。
export const KNOWN_SOURCE_CONFLICTS = Object.freeze([
  {
    event: 'E4',
    by: 'stype',
    key: '潜水艦',
    wikiwiki: 1.19,
    kcwiki: 1.13,
    zekamashi: 1.13,
    prefer: 'kcwiki',
    resolvedUpstreamAt: '2026-08-24',
  },
  {
    event: 'E4',
    by: 'nation',
    key: 'イタリア艦',
    wikiwiki: 1.15,
    kcwiki: 1.19,
    zekamashi: 1.19,
    prefer: 'kcwiki',
    resolvedUpstreamAt: '2026-08-24',
  },
  {
    event: 'E4',
    by: 'ship',
    key: 'Mogador',
    wikiwiki: 1.6959,
    kcwiki: 1.659,
    zekamashi: 1.66,
    prefer: 'kcwiki',
    resolvedUpstreamAt: '2026-08-24',
  },
])

// 只有 zekamashi 收录、另两源都没有的条目。眼下这条还不能进预测：
// 「ランダム補正?」——随机补正，不是固定倍率，乘上去等于凭空造一个确定值。
export const UNMODELED_BONUSES = Object.freeze([
  {
    event: 'E4',
    key: 'Visby',
    raw: '1.2/1.45（ランダム補正? · Visby改 は補正無し）',
    reason: '随机补正，且改造后无补正；没有确定倍率可乘',
    source: 'zekamashi',
  },
])

// ---- 数据包构建 ----

/**
 * 把整页 wikitext 变成资料包 data。
 * 结构：{ events: { E4: { title, entries[], equipGroups{} } }, conflicts[] }
 *
 * 冲突裁决在这里落地：KNOWN_SOURCE_CONFLICTS 里采信 kcwiki 的项**保持 kcwiki 原值**，
 * 但把另两源的值一并写进包里，让 UI 能显示「另有一说」。
 * 这不是多余——倍卡这一项上 README 的通用源分层是反的，不留痕下次就会被"纠正"回去。
 */
export const buildEventBonusPack = (wikitext) => {
  const events = {}
  for (const [key, section] of Object.entries(splitEventSections(wikitext))) {
    const entries = []
    const equipGroups = {}
    let title = ''
    for (const table of tablesIn(section)) {
      const extracted = extractBonusTable(table)
      if (!title) title = extracted.title
      for (const entry of extracted.entries) {
        if (entry.by === 'equipGroupMembers') {
          // 组成员是名字列表；运行时要按 mstId 匹配，名字→id 的映射交给使用方
          // （主数据在手，比在抓取期硬编一份更不容易过期）
          equipGroups[entry.key] = entry.raw.split('\n').map((x) => x.trim()).filter(Boolean)
          continue
        }
        if (entry.value == null) continue
        entries.push({
          scope: entry.scope,
          by: entry.by,
          key: entry.key,
          value: entry.value,
          max: entry.max,
          certain: entry.certain,
          note: entry.note,
        })
      }
    }
    events[key] = { title, entries, equipGroups }
  }
  return {
    events,
    conflicts: KNOWN_SOURCE_CONFLICTS.map((c) => ({ ...c })),
    unmodeled: UNMODELED_BONUSES.map((u) => ({ ...u })),
  }
}
