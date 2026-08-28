// 道具兑换表解析（wikiwiki「アイテム」页，2026-08-18 用户提议的「可兑换列表」）。
//
// 页面结构：h2「アイテム説明」下每个道具一个 h3 小节，三种形态（2026-08-18
// 全页实测；用户追问「南瓜/节分豆呢」后补齐第三种——别再按表头形状断言没有）：
// - 年次表（秋刀魚）：「年次｜交換品｜×必要数｜内容｜備考」，年次列 rowspan
//   跨该年多行——tableGrid 已把 rowspan 摊平；
// - 固定表（菱餅）：「交換品｜中身」两列，无必要数（当届必要数只在游戏内公告）；
// - 活动史表（節分の豆/南瓜/てるてる坊主/Xmas 盒）：「年次｜開始日…｜詳細」，
//   兑换内容写在詳細里但格式五花八门（有→的、名字即奖品没→的、↓接任选清单、
//   散文「から一つ選択」）——硬拆成结构行必然出错，按年份+原文速览收录，
//   联名与轻量翻译交给展示层。
// アイテム屋是课金商店（ポイント计价）不收。小节标题必须与 api_mst_useitem
// 的日文名精确相等才认，不做模糊匹配。
import { htmlText, tableGrid } from '../map-intel.mjs'

// 名字比对前的窄归一：wiki 惯用全角＆＋，主数据是半角（書類一式&指輪）
const normalizeName = (name) => `${name}`.trim().replace(/＆/g, '&').replace(/＋/g, '+')

// 用途块 → 文本行：表格整块剔除（改修更新明细表塞进一行没法读），
// 行界哨兵用 \u241F（写成转义序列——真控制字符会让 git 把源码当二进制，diff 不可读）。
// 闭标签、开标签（嵌套列表的外层前缀）与 <br> 都算行界；原始 html 只切一次，不会重复。
const blockLines = (blockHtml) =>
  `${blockHtml}`
    .replace(/<table\b[\s\S]*?<\/table\s*>/gi, ' ')
    // 广告 <script> 的 JS 原文不是页面文字，htmlText 剥不掉（实测噴式鋼材的
    // 用途块混进一行 googletag.cmd.push(...) 直接上了屏）
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<\/(p|li|h4|h5|div)\s*>/gi, '\u241F')
    .replace(/<(p|li|ul|ol)\b[^>]*>/gi, '\u241F')
    .replace(/<br\b[^>]*>/gi, '\u241F')
    .split('\u241F')
    .map((segment) => htmlText(segment, ' ').replace(/^\[編集\]\s*/, '').trim())
    .filter((line) => line && line !== '用途' && line !== '[編集]')
    .map((line) => (line.length > 400 ? `${line.slice(0, 400)}…` : line))
    .slice(0, 40)

/**
 * @param {string} html アイテム页完整 HTML
 * @param {{api_id:number, api_name:string}[]} useitems 主数据道具表
 * @returns {{ entries: Record<number, {name:string, yearly?:{year:string, offer:string, cost:string, gets:string, note:string}[], fixed?:{offer:string, gets:string}[], history?:{year:string, detail:string}[], overview?:string, usage?:string[]}>, warnings: string[] }}
 */
export const parseItemExchangePage = (html, useitems) => {
  // 空名/单字名不入索引：主数据存在 api_name 为空的占位道具（实测 id 48），
  // 空串会把总表里的空名单元格整行吸进来
  const byName = new Map(
    useitems
      .filter((u) => normalizeName(u.api_name).length >= 2)
      .map((u) => [normalizeName(u.api_name), Number(u.api_id)]),
  )
  const entries = {}
  const warnings = []
  const source = `${html ?? ''}`
  const put = (itemId, field, value) => {
    const entry = entries[itemId] ?? (entries[itemId] = {})
    if (entry[field] === undefined) entry[field] = value
  }
  // 页顶三张总表（通常/拡張/その他のアイテム）：詳細列是每件道具的具体作用
  //（2026-08-18 用户点名「很多只有说明的道具」——游戏自带说明偏风味文案）。
  // 表头认「アイテム名 + 詳細」组合；期間限定アイテム 这类占位行名字对不上主数据，天然跳过
  for (const tableMatch of source.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
    const grid = tableGrid(tableMatch[0])
    const headerAt = grid.findIndex((row) => {
      const labels = row.map((cell) => cell?.text ?? '')
      return labels.includes('アイテム名') && labels.some((label) => label === '詳細')
    })
    if (headerAt < 0) continue
    const labels = grid[headerAt].map((cell) => cell?.text ?? '')
    const nameCol = labels.indexOf('アイテム名')
    const detailCol = labels.indexOf('詳細')
    for (const row of grid.slice(headerAt + 1)) {
      const itemId = byName.get(normalizeName(row[nameCol]?.text ?? ''))
      if (itemId == null) continue
      const detail = htmlText(row[detailCol]?.html ?? '', ' ').trim()
      if (detail.length >= 4) put(itemId, 'overview', detail.length > 600 ? `${detail.slice(0, 600)}…` : detail)
    }
  }
  const heads = [...source.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((match) => ({
    level: Number(match[1]),
    title: match[2].replace(/<[^>]+>/g, '').replace(/[†?]/g, '').trim(),
    start: match.index,
    end: match.index + match[0].length,
  }))
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i]
    if (head.level !== 3) continue
    const itemId = byName.get(normalizeName(head.title))
    if (itemId == null) continue
    const chunk = source.slice(head.end, heads[i + 1]?.start ?? source.length)
    const yearly = []
    const fixed = []
    const history = []
    for (const tableMatch of chunk.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)) {
      const grid = tableGrid(tableMatch[0])
      // 活动史表：年次 + 詳細（無必要数列）——詳細原文整段收录
      const historyHeaderAt = grid.findIndex((row) => {
        const labels = row.map((cell) => cell?.text ?? '')
        return (
          labels.includes('年次') &&
          labels.some((label) => label.includes('詳細')) &&
          !labels.some((label) => label.includes('必要数'))
        )
      })
      if (historyHeaderAt >= 0) {
        const labels = grid[historyHeaderAt].map((cell) => cell?.text ?? '')
        const yearCol = labels.indexOf('年次')
        const detailCol = labels.findIndex((label) => label.includes('詳細'))
        for (const row of grid.slice(historyHeaderAt + 1)) {
          const year = `${row[yearCol]?.text ?? ''}`.trim().replace(/年$/, '')
          const detail = htmlText(row[detailCol]?.html ?? '', ' ').trim()
          if (!year || !detail) continue
          history.push({ year, detail })
        }
        continue
      }
      const yearHeaderAt = grid.findIndex((row) => {
        const labels = row.map((cell) => cell?.text ?? '')
        return labels.includes('年次') && labels.some((label) => label.includes('必要数'))
      })
      if (yearHeaderAt >= 0) {
        const labels = grid[yearHeaderAt].map((cell) => cell?.text ?? '')
        const yearCol = labels.indexOf('年次')
        const offerCol = labels.findIndex((label) => label.includes('交換品'))
        const costCol = labels.findIndex((label) => label.includes('必要数'))
        const getsCol = labels.findIndex((label) => label.includes('内容'))
        const noteCol = labels.findIndex((label) => label.includes('備考'))
        if (offerCol < 0 || getsCol < 0) {
          warnings.push(`${head.title}: 年次兑换表缺「交換品/内容」列（表头 ${labels.join('|')}），跳过`)
          continue
        }
        for (const row of grid.slice(yearHeaderAt + 1)) {
          const year = `${row[yearCol]?.text ?? ''}`.trim()
          const gets = htmlText(row[getsCol]?.html ?? '', ' ').trim()
          if (!year || !gets) continue
          yearly.push({
            year,
            offer: `${row[offerCol]?.text ?? ''}`.trim(),
            cost: `${row[costCol]?.text ?? ''}`.trim(),
            gets,
            note: noteCol >= 0 ? `${row[noteCol]?.text ?? ''}`.trim() : '',
          })
        }
        continue
      }
      // 固定表（菱餅式）：恰好「交換品｜中身」两列才认——通常/拡張アイテム
      // 总表的说明列也含这些字，但列数与表头组合都不同，不会误中
      const fixedHeaderAt = grid.findIndex((row) => {
        const labels = row.map((cell) => cell?.text ?? '').filter(Boolean)
        return labels.length === 2 && labels[0] === '交換品' && labels[1] === '中身'
      })
      if (fixedHeaderAt >= 0) {
        for (const row of grid.slice(fixedHeaderAt + 1)) {
          const offer = `${row[0]?.text ?? ''}`.trim()
          const gets = htmlText(row[1]?.html ?? '', ' ').trim()
          if (!offer || !gets) continue
          fixed.push({ offer, gets })
        }
      }
    }
    // 小节里的「用途」h4 块：改修/任务消耗这类具体作用，逐行原文收录
    const usageBlock = chunk.match(/<h4\b[^>]*>[^<]*用途[\s\S]*?(?=<h4\b|$)/)
    const usage = usageBlock ? blockLines(usageBlock[0]) : []
    if (!yearly.length && !fixed.length && !history.length && !usage.length) continue
    if (entries[itemId]?.yearly || entries[itemId]?.fixed || entries[itemId]?.history) {
      warnings.push(`${head.title}: 同名小节出现多次，后者不覆盖前者`)
      continue
    }
    if (yearly.length) put(itemId, 'yearly', yearly)
    if (fixed.length) put(itemId, 'fixed', fixed)
    if (history.length) put(itemId, 'history', history)
    if (usage.length) put(itemId, 'usage', usage)
  }
  // 名字统一补齐（overview 路创建的条目也要有 name）；主数据名为准
  const nameOf = new Map(useitems.map((u) => [Number(u.api_id), `${u.api_name}`.trim()]))
  for (const [itemId, entry] of Object.entries(entries)) {
    entry.name = nameOf.get(Number(itemId)) ?? entry.name ?? ''
  }
  return { entries, warnings }
}
