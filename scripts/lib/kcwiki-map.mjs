// zh.kcwiki 常规海域页 →「节点 → 敌编成 / 掉落」的**纯解析器**（无 IO，可测）。
//
// 为什么要这一层：现行 map-intel 的敌编成走的是「日文 wiki 的人读标注 →
// 两条定号流水线（lodes:map-intel-pin / -observe）猜 mstId」，1255 条里到今天
// 还有 99 条定不下来。kcwiki 的「深海配置」表**自带 mstId**——`(1501)` 就是号，
// 日文标注名在旁边一起给。号是一手，名字是附赠，正好把那两条流水线的存在理由消掉。
//
// ⚠️ **不许改用 `模块:海图配置数据/*`**（2-3、5-1..5-5 六个模块）。
// 那六个模块最后编辑停在 2015 年，里面是 `{523, 543, 527, …}` 这样的**一期 mstId**，
// 与二期号段（≥1501）完全不是一套号。渲染后的海域页才是活的：37 图逐图核过，
// 最小 mstId 全部 ≥1501，一条一期号都没有（2026-08-22 实测）。
//
// ---- 页面结构（高度规整，机器生成）----
//
//   <td style="… background-color: #3baef5; …"><p><b>A</b></p></td>   ← 节点标记，颜色编码点型
//   <td><p><span lang="ja">敵偵察艦</span></p></td>                     ← 点名
//   <tr><td colspan="2">
//     <table>                                                          ← 一条编成一张子表
//       <tr><td class="formation_mobile">単縦陣</td>
//           <td class="enemy_mobile">
//             <div class="nomobile">…<p>经验值</p><p>10</p></div>       ← 基础经验
//             <style>…</style>                                          ← ⚠ 混在格里的 CSS
//             <div class="hfBox">…<span class="hfText">(1501)<span lang="ja">駆逐イ級</span></span></div>
//           </td></tr>
//       <tr><td></td><td colspan="2">
//             <span class="greenCell">制空值：238</span>…                ← 制空/空优/空确在**下一行**
//       </td></tr>
//     </table>
//
// 三个已经咬过人的坑，护栏钉在 test/kcwiki-map-parser.test.mjs：
//   ① Boss 点是 `#ff0000`，不是蓝色。第一版只匹配 `#3baef5` 时 1-1 的 C 点整个消失，
//      它的三条编成被并进 B 点——**少一个点却一条报错都没有**。
//   ② `enemy_mobile` 格里混着 `<style>`（`.mw-parser-output div.hfBox{…}`），
//      裸 strip 会把 CSS 文本带进舰名。剥 `<style>` 必须是第一步。
//   ③ 一格常写多个阵形，而且**连写不带分隔**（`単縦陣梯形陣`）。整串当一个阵形
//      名字就等于把两个阵形都丢了。

/** 常规海域全表（7 个海域，1/5 区各 6 张）。 */
export const KCWIKI_MAP_CODES = (() => {
  const last = { 1: 6, 2: 5, 3: 5, 4: 5, 5: 6, 6: 5, 7: 5 }
  const codes = []
  for (const [area, no] of Object.entries(last)) {
    for (let index = 1; index <= no; index++) codes.push(`${area}-${index}`)
  }
  return Object.freeze(codes)
})()

/**
 * 节点标记的颜色编码。
 *
 * 只用于**解析期的完备性核对**（撞见没见过的颜色要挂牌，别静默少一个点）。
 * 运行时的点型仍旧从游戏 `api_cell_data` 的 eventId 拿——那是第一方一手，
 * 不需要外源，这里也不往包里写点型。
 */
export const KCWIKI_NODE_COLORS = Object.freeze({
  '3baef5': '通常战',
  ff0000: 'Boss',
  '3cb371': '航空战/空袭',
  '525d53': '夜战',
  '7b68ee': '涡流',
  '00cc00': '资源/奖励',
})

/**
 * 阵形词表。**长名在前**——`第三警戒航行序列` 必须先于 `警戒陣` 命中，
 * 否则 6-5 Boss 的敌联合阵形会被读成单纯的警戒阵。
 *
 * 输出口径与现行包一致：单阵形出数字，多阵形出**空格分隔的短假名**
 *（`"梯形 単横"`）——运行时的 `formationTokensOf`（renderer/combat-forecast.ts）
 * 就是按这个形状拆的，换源不该顺带改消费端的约定。
 */
const FORMATION_VOCAB = Object.freeze([
  ['第一警戒航行序列', 11, '第一警戒'],
  ['第二警戒航行序列', 12, '第二警戒'],
  ['第三警戒航行序列', 13, '第三警戒'],
  ['第四警戒航行序列', 14, '第四警戒'],
  ['単縦陣', 1, '単縦'],
  ['複縦陣', 2, '複縦'],
  ['輪形陣', 3, '輪形'],
  ['梯形陣', 4, '梯形'],
  ['単横陣', 5, '単横'],
  ['警戒陣', 6, '警戒'],
  // kcwiki 少数格用简体中文写（实测 37 图里 31 格）
  ['单纵阵', 1, '単縦'],
  ['复纵阵', 2, '複縦'],
  ['轮形阵', 3, '輪形'],
  ['轮型阵', 3, '輪形'],
  ['梯形阵', 4, '梯形'],
  ['单横阵', 5, '単横'],
  ['警戒阵', 6, '警戒'],
  ['单纵', 1, '単縦'],
  ['复纵', 2, '複縦'],
  ['轮形', 3, '輪形'],
  ['轮型', 3, '輪形'],
  ['梯形', 4, '梯形'],
  ['单横', 5, '単横'],
])

/** 资料格里没写阵形（`{{{阵型}}}` 这类没展开的模板）时如实标注，不猜一个。 */
export const FORMATION_UNKNOWN = '不明'

const stripStyle = (html) => `${html}`.replace(/<style[\s\S]*?<\/style\s*>/gi, '')

const textOf = (html) =>
  stripStyle(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * 一格阵形文本 → `{ formation, unknownText }`。
 *
 * 逐字扫描而不是 split：kcwiki 的多阵形格常常**连写不带分隔符**
 *（`単縦陣梯形陣`、`梯形陣複縦陣単縦陣`），按分隔符拆只会拆出一个长串。
 * 认不出的残余文本原样带出去让调用方挂牌——不静默吞（`6-4` 有一格在阵形后面
 * 跟了「提督等级107级以前（包含107级）」这样的正文注解，那不是阵形）。
 */
export const parseFormationCell = (raw) => {
  const text = textOf(raw)
  const tokens = []
  const leftover = []
  let rest = text
  while (rest) {
    let hit = null
    for (const [name, , short] of FORMATION_VOCAB) {
      const at = rest.indexOf(name)
      if (at < 0) continue
      if (!hit || at < hit.at || (at === hit.at && name.length > hit.name.length)) {
        hit = { at, name, short }
      }
    }
    if (!hit) {
      if (rest.trim()) leftover.push(rest.trim())
      break
    }
    if (hit.at > 0) {
      const skipped = rest.slice(0, hit.at).trim()
      if (skipped) leftover.push(skipped)
    }
    if (!tokens.includes(hit.short)) tokens.push(hit.short)
    rest = rest.slice(hit.at + hit.name.length)
  }
  const unknownText = leftover.join(' ').trim()
  if (!tokens.length) {
    return { formation: FORMATION_UNKNOWN, unknownText: unknownText || text }
  }
  if (tokens.length === 1) {
    const id = FORMATION_VOCAB.find(([, , short]) => short === tokens[0])?.[1]
    return { formation: id, unknownText }
  }
  return { formation: tokens.join(' '), unknownText }
}

/** `(1501)<span lang="ja">駆逐イ級</span>` → `{ id: 1501, label: '駆逐イ級' }` */
const parseHfText = (inner) => {
  const match = /^\s*\((\d{3,6})\)([\s\S]*)$/.exec(inner)
  if (!match) return null
  return { id: Number(match[1]), label: textOf(match[2]) }
}

/**
 * 常规海域页的「深海配置」→ `{ [节点]: { color, enemyComps } }`。
 *
 * 分段方式：以节点标记（带 background-color 的字母格）为界，两个标记之间
 * 的全部编成子表都归前一个节点。**所有颜色一视同仁**——只认蓝色就会漏掉
 * Boss（红）、夜战（灰绿）、空袭（中绿）三类点。
 */
export const parseKcwikiMapEnemies = (rawHtml) => {
  const html = stripStyle(rawHtml)
  const warnings = []
  const nodes = {}
  const marks = [
    ...html.matchAll(
      /background-color:\s*#([0-9a-fA-F]{6})[^>]*>\s*(?:<p>)?\s*<b>\s*([A-Za-z]{1,3}\d?)\s*<\/b>/g,
    ),
  ]
  for (const [index, mark] of marks.entries()) {
    const letter = mark[2].toUpperCase()
    const color = mark[1].toLowerCase()
    if (!KCWIKI_NODE_COLORS[color]) {
      warnings.push(`节点 ${letter} 的点色 #${color} 不在已知点色表里，点型可能是新增的`)
    }
    const segment = html.slice(mark.index, marks[index + 1]?.index ?? html.length)
    const comps = []
    // 一条编成 = 一个 formation_mobile 格开头，到下一个 formation_mobile 为止。
    // 制空/空优/空确长在编成子表的**下一行**里，所以不能只取 enemy_mobile 那一格。
    const starts = [...segment.matchAll(/<td\b[^>]*class="formation_mobile"[^>]*>/gi)]
    for (const [order, start] of starts.entries()) {
      const chunk = segment.slice(start.index, starts[order + 1]?.index ?? segment.length)
      const formationRaw = /<td\b[^>]*class="formation_mobile"[^>]*>([\s\S]*?)<\/td\s*>/i.exec(
        chunk,
      )?.[1]
      if (formationRaw === undefined) {
        warnings.push(`节点 ${letter} 的第 ${order + 1} 条编成阵形格没有闭合，整条跳过`)
        continue
      }
      const ships = []
      const labels = []
      for (const hit of chunk.matchAll(/<span class="hfText">([\s\S]*?)<\/span\s*>\s*<\/div>/g)) {
        const parsed = parseHfText(hit[1])
        if (!parsed) {
          warnings.push(`节点 ${letter} 的第 ${order + 1} 条编成有一格 hfText 不带 mstId：${textOf(hit[1])}`)
          continue
        }
        ships.push(parsed.id)
        labels.push(parsed.label)
      }
      if (!ships.length) {
        // 空编成格不静默跳过：7-3 的 H 点、7-4 的 O 点是编辑者加了点却没填内容
        //（`{{{阵型}}}` / `{{{敌方}}}` 模板参数原样漏出来）。挂牌说清楚是「资料没填」，
        // 别让它看起来像「这一点没有敌人」。
        warnings.push(
          `节点 ${letter} 的第 ${order + 1} 条编成一个 mstId 都没有` +
            (/\{\{\{/.test(chunk) ? '（模板占位没展开，资料未填）' : ''),
        )
        continue
      }
      const { formation, unknownText } = parseFormationCell(formationRaw)
      if (formation === FORMATION_UNKNOWN) {
        warnings.push(
          `节点 ${letter} 的第 ${order + 1} 条编成没给出阵形（原文「${unknownText}」），按「${FORMATION_UNKNOWN}」收录`,
        )
      } else if (unknownText) {
        warnings.push(
          `节点 ${letter} 的第 ${order + 1} 条编成阵形格有认不出的残余「${unknownText}」，只收阵形部分`,
        )
      }
      const exp = Number(/经验值<\/p>\s*<p[^>]*>\s*(\d+)/.exec(chunk)?.[1] ?? NaN)
      const air = Number(/制空值：\s*(\d+)/.exec(chunk)?.[1] ?? NaN)
      const airSuperiority = Number(/空优值：\s*(\d+)/.exec(chunk)?.[1] ?? NaN)
      const airSupremacy = Number(/空确值：\s*(\d+)/.exec(chunk)?.[1] ?? NaN)
      comps.push({
        formation,
        ships,
        labels,
        ...(Number.isInteger(exp) && exp > 0 ? { exp } : {}),
        ...(Number.isInteger(air) ? { air } : {}),
        ...(Number.isInteger(airSuperiority) ? { airSuperiority } : {}),
        ...(Number.isInteger(airSupremacy) ? { airSupremacy } : {}),
      })
    }
    if (!comps.length) continue
    if (nodes[letter]) {
      // 同一个字母出现两次带编成的段（页面重排过？）——合并而不是覆盖，
      // 覆盖会让先出现的那几条编成凭空消失。
      warnings.push(`节点 ${letter} 出现了不止一段敌编成，已合并`)
      nodes[letter].enemyComps.push(...comps)
      continue
    }
    nodes[letter] = { color, enemyComps: comps }
  }
  return { nodes, warnings }
}

/**
 * 常规海域页的掉落表 → `{ [节点]: [{ name, rare }] }`（中文舰名，不解号）。
 *
 * 中文名 → mstId 要走 `assets/lodes/kcwiki-ships.json` 的「中文名」列，那是有 IO 的
 * 事，留给调用方。红色粗体是**稀有掉落**标记，不是限定期标记——两者别混。
 */
export const parseKcwikiMapDrops = (rawHtml) => {
  const html = stripStyle(rawHtml)
  const warnings = []
  const nodes = {}
  const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes('掉落列表'))
  if (!table) return { nodes, warnings: ['页面里没有「掉落列表」表'], hasTable: false }
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)]
    if (cells.length < 2) continue
    const rawLetter = textOf(cells[0][1])
    // 点位格偶尔带括注（7-5 的「K(P1BOSS)」按阶段标了 Boss 点，7-3 有一行写成小写
    // 的「p」）。只认裸字母会把这四行整段丢掉，而那四个点恰好是 Boss 点。
    const letter = /^([A-Za-z]{1,3}\d?)\s*(?:[（(][^）)]*[）)])?$/
      .exec(rawLetter)?.[1]
      ?.toUpperCase()
    if (!letter) {
      if (rawLetter) warnings.push(`掉落表里有认不出的点位「${rawLetter}」，该行跳过`)
      continue
    }
    const ships = []
    for (const link of cells[1][1].matchAll(/<a\b[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      const name = textOf(link[2]) || link[1]
      if (!name) continue
      // 稀有掉落写成 `<a …><b><span style="color: red">薄云</span></b></a>`。
      // 它是**稀有度**标记，不是限定期标记——两者别混（限定期 kcwiki 根本没有）。
      ships.push({ name, rare: /color:\s*red/i.test(link[0]) })
    }
    if (!ships.length) continue
    ;(nodes[letter] ??= []).push(...ships)
  }
  return { nodes, warnings, hasTable: true }
}

/**
 * 页脚的**来源自述**（`<ol class="references">` 里那条「主要数据来源为日wiki…」）。
 *
 * 为什么要抓它：掉落域算票时必须知道**这两张票同不同源**。37 张常规海域页
 * 逐张核过，全部挂着这一行——也就是说 kcwiki 的掉落表主要是日站的转录，
 * 「kcwiki 与 wikiwiki 都这么说」并不是两张独立的票（2026-08-22 实测 37/37）。
 * 原文照录进包 meta，别让下一个人只看见我们自己的结论。
 *
 * 只取到「…为准」为止：后半段讲的是颜色标注约定与带路信息出处，与掉落无关。
 */
export const parseKcwikiSourceNote = (rawHtml) => {
  for (const hit of `${rawHtml}`.matchAll(
    /<span class="reference-text">([\s\S]*?)<\/span>\s*<\/li>/gi,
  )) {
    const text = textOf(hit[1].replace(/<br\s*\/?>/gi, ' '))
    if (!text.includes('主要数据来源为')) continue
    const at = text.indexOf('为准')
    return at > 0 ? text.slice(0, at + 2) : text.slice(0, 200)
  }
  return null
}

/** 一页 = 敌编成 + 掉落，警告合并成一份。 */
export const parseKcwikiMapPage = (html) => {
  const enemies = parseKcwikiMapEnemies(html)
  const drops = parseKcwikiMapDrops(html)
  const nodes = {}
  for (const [letter, value] of Object.entries(enemies.nodes)) {
    nodes[letter] = { nodeColor: value.color, enemyComps: value.enemyComps, drops: [] }
  }
  for (const [letter, ships] of Object.entries(drops.nodes)) {
    nodes[letter] ??= { nodeColor: null, enemyComps: [], drops: [] }
    nodes[letter].drops = ships
  }
  return {
    nodes,
    hasDropTable: drops.hasTable,
    sourceNote: parseKcwikiSourceNote(html),
    warnings: [...enemies.warnings, ...drops.warnings],
  }
}

// ---- 抓取（有 IO 的部分，与解析分开，测试只测上面那半）----

const KCWIKI_API = 'https://zh.kcwiki.cn/api.php'

export const kcwikiMapPageQuery = (code) =>
  `${KCWIKI_API}?action=parse&prop=text&format=json&formatversion=2&disablelimitreport=1` +
  `&redirects=1&page=${encodeURIComponent(code)}`

/**
 * 逐图取渲染后的 HTML。
 *
 * 900 ms 间隔实测零 429（2026-08-22，37 图连抓）。`redirects=1` 让裸「5-4」
 * 一步跳到「南方海域/5-4」，不必硬编海域名。
 */
export const fetchKcwikiMapPages = async ({
  codes = KCWIKI_MAP_CODES,
  delayMs = 900,
  fetchImpl = fetch,
  onProgress = null,
} = {}) => {
  const pages = new Map()
  const failed = []
  for (const code of codes) {
    let hitNetwork = true
    try {
      const res = await fetchImpl(kcwikiMapPageQuery(code), {
        headers: { 'User-Agent': 'kanso-lodes' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const html = json?.parse?.text
      if (typeof html !== 'string' || !html) throw new Error('页面没有渲染文本')
      pages.set(code, { html, title: json.parse.title ?? code })
      onProgress?.(code, pages.size, codes.length)
      // 走缓存的那次不必再对原站客气——限流是给真请求用的
      hitNetwork = res.__cached !== true
    } catch (error) {
      failed.push({ code, message: error.message })
    }
    if (delayMs && hitNetwork) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return { pages, failed }
}

/** 页面内容的真实年龄：最后一次**非机器人**编辑（口径同 kcwiki-routing）。 */
export const fetchKcwikiPageContentDate = async (title, fetchImpl = fetch) => {
  try {
    const url =
      `${KCWIKI_API}?action=query&prop=revisions&rvprop=timestamp|comment&rvlimit=30` +
      `&format=json&formatversion=2&titles=${encodeURIComponent(title)}`
    const json = await (await fetchImpl(url, { headers: { 'User-Agent': 'kanso-lodes' } })).json()
    const revisions = json?.query?.pages?.[0]?.revisions ?? []
    const human = revisions.find((revision) => !/^文本替换/.test(revision.comment ?? ''))
    return (human ?? revisions[0])?.timestamp?.slice(0, 10) ?? null
  } catch (_error) {
    return null
  }
}
