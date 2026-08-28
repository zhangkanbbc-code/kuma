// zh.kcwiki「带路条件」子页 → 分歧点规则表。
//
// 常规图（`北方海域/3-2/带路条件`）与活动图（`2026年夏季活动/E-1/带路条件`）
// 用的是同一套页面模板：一张 `分歧点 | 条件` 的 wikitable，条件格是 <ul><li>。
// 2026-08-26 逐页比对 E-1…E-5 与 3-2 的渲染 HTML 确认同构，故两者共用本解析器。
//
// 抠成独立模块是为了让测试能直接 import——fetch-lodes.mjs 是自执行脚本，
// import 它会把整轮抓取跑起来。搬运时除下面记明的占位符修复外，逻辑逐字未改。

const ENT = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" }
// 标签一律删而不是换空格：中文里「<span>高速+</span>、<span>最速</span>舰队」
// 换成空格会变成「高速+ 、 最速 舰队」。块级切分在调用前已按 li/tr 做完。
// 先删标签再解实体，顺序不能反——否则源文里转义过的 &lt;运输桶&gt; 会被当标签删掉。
const htmlText = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&(gt|lt|amp|nbsp|quot|#39);/g, (m) => ENT[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim()

// 子表占位符。原先用的是裸的 `T0` `T1`——直到活动图 E-4 才暴露出这会撞车：
// 该图的分歧点本身就叫 **T1 / T2**，规则文本里有「已经过T2点的舰队 去Y1」，
// 而 `raw.match(/T(\d+)/)` 把这个 T2 当成 2 号子表，取 tables[2] 得到 undefined 直接崩。
// 常规图 37 张里没有「T+数字」的点位名，所以这颗雷一直埋到活动图才炸。
// 改用 U+0001 夹住的记号：MediaWiki 渲染出的 HTML 不含控制字符，撞不上正文。
const SEP = String.fromCharCode(1)
const tblToken = (n) => `${SEP}TBL${n}${SEP}`
const TBL_RE = new RegExp(`${SEP}TBL(\\d+)${SEP}`)
const TBL_RE_G = new RegExp(`${SEP}TBL(\\d+)${SEP}`, 'g')

// 把 <table>…</table> 抠成占位符（深度感知）。1-1 的条件格里套了一张概率子表，
// 不先遮住它，按 <tr> 切外层表就会被子表的行切碎，分歧点名整个丢掉。
const maskTables = (html) => {
  const kept = []
  let out = ''
  let depth = 0
  let buf = ''
  let last = 0
  const re = /<table\b[^>]*>|<\/table\s*>/gi
  let m
  while ((m = re.exec(html))) {
    const seg = html.slice(last, m.index)
    if (depth === 0) out += seg
    else buf += seg
    if (m[0][1] !== '/') {
      if (depth === 0) buf = ''
      else buf += m[0]
      depth++
    } else {
      depth--
      if (depth === 0) {
        kept.push(buf)
        out += ` ${tblToken(kept.length - 1)} `
      } else buf += m[0]
    }
    last = re.lastIndex
  }
  return { out: out + html.slice(last), kept }
}

// 子表压平成「表头 值 · 表头 值」的文本行
const flattenTable = (html) => {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((c) => htmlText(c[1])),
  )
  if (rows.length < 2) return rows.flat().filter(Boolean)
  const [head, ...body] = rows
  return body.map((r) => r.map((v, i) => (head[i] ? `${head[i]} ${v}` : v)).join(' · '))
}

// 条件格 → 规则行；嵌套列表用「└ 」标层级
const cellRules = (html, tables) => {
  const lines = []
  const emit = (raw, prefix) => {
    const ref = raw.match(TBL_RE)
    if (ref) {
      for (const l of flattenTable(tables[+ref[1]])) lines.push(prefix + l)
      const rest = htmlText(raw.replace(TBL_RE_G, ''))
      if (rest) lines.push(prefix + rest)
      return
    }
    const t = htmlText(raw)
    if (t) lines.push(prefix + t)
  }
  const walk = (frag, prefix) => {
    for (const part of frag.split(/<li\b[^>]*>/i).slice(1)) {
      const nested = part.match(/<ul\b[^>]*>([\s\S]*)<\/ul\s*>/i)
      emit((nested ? part.slice(0, part.indexOf(nested[0])) : part).replace(/<\/li\s*>[\s\S]*$/i, ''), prefix)
      if (nested) walk(nested[1], `${prefix}└ `)
    }
  }
  const ulTop = html.match(/<ul\b[^>]*>([\s\S]*)<\/ul\s*>/i)
  if (ulTop) walk(ulTop[1], '')
  if (!lines.length) emit(html, '')
  return lines
}

export const parseRoutingHtml = (rendered) => {
  const first = maskTables(rendered)
  const idx = first.out.match(TBL_RE)
  if (!idx) return null
  const inner = maskTables(first.kept[+idx[1]]) // 再遮一层：格内子表
  const rows = [...inner.out.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((r) =>
    [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?:<\/t[dh]\s*>|(?=<t[dh]\b)|$)/gi)].map((c) => c[1]),
  )
  const nodes = []
  for (const [i, cells] of rows.entries()) {
    if (cells.length < 2) continue
    const from = htmlText(cells[0])
    if (i === 0 || from === '分歧点' || !from) continue
    const rules = cellRules(cells[1], inner.kept)
    if (rules.length) nodes.push({ from, rules })
  }
  const credit = htmlText((rendered.match(/<\/table>\s*<div>([\s\S]*?)<\/div>/) ?? [])[1] ?? '')
  return nodes.length ? { nodes, credit } : null
}
