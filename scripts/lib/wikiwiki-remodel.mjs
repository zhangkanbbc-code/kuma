import { htmlText, tableGrid } from '../map-intel.mjs'

const NEED_BY_JP_NAME = new Map([
  ['改装設計図', { kind: 'useitem', id: 58 }],
  ['試製甲板用カタパルト', { kind: 'useitem', id: 65 }],
  ['試製甲板カタパルト', { kind: 'useitem', id: 65 }],
  ['戦闘詳報', { kind: 'useitem', id: 78 }],
  ['新型航空兵装資材', { kind: 'useitem', id: 77 }],
  ['新型兵装資材', { kind: 'useitem', id: 94 }],
  ['海外艦最新技術', { kind: 'useitem', id: 100 }],
  ['新型砲熕兵装資材', { kind: 'useitem', id: 75 }],
  ['工廠資源', { kind: 'useitem', id: 104 }],
  ['勲章', { kind: 'useitem', id: 57 }],
  ['熟練搭乗員', { kind: 'useitem', id: 70 }],
  ['補強増設', { kind: 'useitem', id: 64 }],
  ['新型航空機設計図', { kind: 'useitem', id: 74 }],
  ['新型噴進装備開発資材', { kind: 'useitem', id: 92 }],
  ['高速建造材', { kind: 'useitem', id: 2 }],
  ['開発資材', { kind: 'useitem', id: 3 }],
  // 这是装备，不是 useitem 87（海苔）。
  ['新型高温高圧缶', { kind: 'slotitem', id: 87 }],
])

const NEED_BY_CHART_TOKEN = new Map([
  ['図', ['改装設計図', NEED_BY_JP_NAME.get('改装設計図')]],
  ['甲', ['試製甲板用カタパルト', NEED_BY_JP_NAME.get('試製甲板用カタパルト')]],
  ['報', ['戦闘詳報', NEED_BY_JP_NAME.get('戦闘詳報')]],
  ['航', ['新型航空兵装資材', NEED_BY_JP_NAME.get('新型航空兵装資材')]],
  ['砲', ['新型砲熕兵装資材', NEED_BY_JP_NAME.get('新型砲熕兵装資材')]],
  ['兵', ['新型兵装資材', NEED_BY_JP_NAME.get('新型兵装資材')]],
  ['海', ['海外艦最新技術', NEED_BY_JP_NAME.get('海外艦最新技術')]],
  ['工', ['工廠資源', NEED_BY_JP_NAME.get('工廠資源')]],
])

const decodeAttribute = (value) =>
  htmlText(`${value ?? ''}`)
    .replace(/\u00a0/g, ' ')
    .trim()

const matchingParen = (text, start) => {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    if (text[index] === '(' || text[index] === '（') depth++
    else if (text[index] === ')' || text[index] === '）') {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

const parseNeeds = (raw) => {
  const text = htmlText(raw, ' ')
    .replace(/^Lv\s*\d+\s*/i, '')
    .replace(/^[+＋]\s*/, '')
    .trim()
  const needs = []
  for (const part of text.split(/[+＋]/).map((value) => value.trim()).filter(Boolean)) {
    if (/^Lv\s*\d+$/i.test(part)) continue
    const match = part.match(/^(.+?)(?:\s*[x×]\s*(\d+))?$/i)
    if (!match) continue
    const nameJp = match[1].replace(/\s+/g, '').trim()
    if (!nameJp || /^(?:資材|要確認|不要)$/.test(nameJp)) continue
    const count = Number.parseInt(match[2] ?? '1', 10) || 1
    const known = NEED_BY_JP_NAME.get(nameJp)
    needs.push({
      kind: known?.kind ?? 'unknown',
      ...(known ? { id: known.id } : {}),
      nameJp,
      count,
    })
  }
  return needs
}

const tooltipText = (html) => {
  const encoded = `${html ?? ''}`.match(/\bdata-tooltip-content=["']([\s\S]*?)["']/i)?.[1]
  // 属性值先解实体才会恢复成 HTML，所以需要清洗两遍。
  if (!encoded) return ''
  const decoded = htmlText(encoded)
  const paragraph = decoded.match(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/i)?.[1] ?? decoded
  return htmlText(paragraph, ' ').replace(/\s*脚注\s*\*\d+\s*へ\s*$/u, '')
}

const parseIndexNeeds = (cell) => {
  const needs = []
  const condition = `${cell?.text ?? ''}`.replace(/[xX]/g, '×')
  for (const match of condition.matchAll(/([図甲報航砲兵海工])(?:×?(\d+))?/g)) {
    const mapped = NEED_BY_CHART_TOKEN.get(match[1])
    if (!mapped?.[1]) continue
    needs.push({
      kind: mapped[1].kind,
      id: mapped[1].id,
      nameJp: mapped[0],
      count: Number.parseInt(match[2] ?? '1', 10) || 1,
    })
  }
  for (const need of parseNeeds(tooltipText(cell?.html))) {
    const key = `${need.kind}:${need.id ?? need.nameJp}`
    const existing = needs.find(
      (entry) => `${entry.kind}:${entry.id ?? entry.nameJp}` === key,
    )
    if (existing) existing.count = Math.max(existing.count, need.count)
    else needs.push(need)
  }
  return needs
}

export const parseWikiwikiRemodelIndex = (html, pageName = '改造') => {
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
    .map((match) => tableGrid(match[0]))
  const grid = tables.find(
    (candidate) =>
      candidate.length > 300 &&
      candidate[0]?.[0]?.text === 'No' &&
      candidate[0]?.[1]?.text === '艦名' &&
      candidate[0]?.[3]?.text === 'Lv' &&
      candidate[0]?.[6]?.text === '艦名',
  )
  if (!grid) return []
  const out = []
  for (const row of grid.slice(2)) {
    const sourceName = `${row[1]?.text ?? ''}`.trim()
    const targetName = `${row[6]?.text ?? ''}`.trim()
    const condition = `${row[3]?.text ?? ''}`.trim()
    const level = Number.parseInt(condition.match(/^\d+/)?.[0] ?? '', 10)
    if (!sourceName || !targetName || sourceName === '-' || targetName === '-') continue
    // 条件列「-+*129」＝可逆转换的回程行：没有等级门槛，回程消耗全在脚注
    // tooltip 里（榛名丙→乙 高建35+開発15）。舰页脚注只说「資材だけ」的对，
    // 总表这里才是数字全集（用户 2026-08-11 校准）——不能再当废行丢掉。
    const conversionOnly = /^[-－]/.test(condition)
    if (!conversionOnly && (!Number.isInteger(level) || level <= 0)) continue
    const needs = parseIndexNeeds(row[3])
    if (conversionOnly && !needs.length) continue
    out.push({
      sourceName,
      targetName,
      targetNo: `${row[5]?.text ?? ''}`.trim(),
      ...(conversionOnly ? { conversionOnly: true } : { level }),
      needs,
      page: pageName,
      raw: htmlText(row[3]?.html ?? row[3]?.text ?? ''),
    })
  }
  return out
}

const chartCellHtml = (html) => {
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
    .map((match) => match[0])
  for (const table of tables) {
    const grid = tableGrid(table)
    const header = grid.findIndex((row) => row.some((cell) => cell?.text === '改造チャート'))
    if (header < 0) continue
    const next = grid.slice(header + 1).find((row) => row.some((cell) => cell?.html))
    const cell = next?.find((entry) => entry?.html)
    if (cell?.html) return cell.html
  }
  return ''
}

export const parseWikiwikiRemodelPage = (html, pageName) => {
  const cell = chartCellHtml(html)
  if (!cell) return []
  const links = [...cell.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
  const out = []
  // チャート是一条有序链：每个括号是「上一形态 → 本形态」这条边的消耗。
  // 同一形态出现两次（加賀改二先由改解锁、再由護转回）就是两条不同的边，
  // 装配层靠 sourceName 区分，不能再让后一次出现覆盖前一次。
  let lastParenEnd = -1
  let previousNode = ''
  for (const link of links) {
    const linkStart = link.index ?? 0
    // 括号内的素材链接（改装設計図等）不是链上节点
    if (linkStart < lastParenEnd) continue
    const attrs = link[1]
    // 脚注角标（*1）夹在 ⇔ 两侧形态之间，误当节点会把来路算错
    if (/note_super/i.test(attrs)) continue
    const title = attrs.match(/\btitle=["']([^"']+)["']/i)?.[1]
    const name = decodeAttribute(title || link[2])
    if (!name || /^[*＊]?\d+$/.test(name)) continue
    let cursor = linkStart + link[0].length
    while (/\s/.test(cell[cursor] ?? '')) cursor++
    const sourceName = previousNode
    previousNode = name
    if (cell[cursor] !== '(' && cell[cursor] !== '（') continue
    const end = matchingParen(cell, cursor)
    if (end < 0) continue
    lastParenEnd = end
    const raw = cell.slice(cursor + 1, end)
    const level = Number.parseInt(htmlText(raw).match(/\bLv\s*(\d+)/i)?.[1] ?? '', 10)
    if (!Number.isInteger(level) || level <= 0) continue
    const needs = parseNeeds(raw)
    out.push({
      targetName: name,
      ...(sourceName ? { sourceName } : {}),
      level,
      needs,
      page: pageName,
      raw: htmlText(raw),
    })
  }
  return out
}

// 回程成本的三种脚注写法（对今日 31 个缓存舰页穷举后确定）：
// 「高速建造材x40と開発資材x15」「高速建造材と開発資材を20個ずつ」「高速建造材を20個」。
// 「資材の消費だけで変更可能」类脚注不给数字，诚实地不产出任何边。
const parseReturnCosts = (clause) => {
  const text = `${clause ?? ''}`.replace(/[xX×]/g, 'x')
  const needs = []
  const push = (nameJp, count) => {
    const known = NEED_BY_JP_NAME.get(nameJp)
    if (!known || !(count > 0)) return
    if (needs.some((need) => need.kind === known.kind && need.id === known.id)) return
    needs.push({ kind: known.kind, id: known.id, nameJp, count })
  }
  const each = text.match(/((?:高速建造材|開発資材)(?:と(?:高速建造材|開発資材))*)を(\d+)個ずつ/)
  if (each) {
    for (const name of each[1].split('と')) push(name, Number.parseInt(each[2], 10))
  }
  for (const match of text.matchAll(/(高速建造材|開発資材)x(\d+)/g)) {
    push(match[1], Number.parseInt(match[2], 10))
  }
  for (const match of text.matchAll(/(高速建造材|開発資材)を(\d+)個(?!ずつ)/g)) {
    push(match[1], Number.parseInt(match[2], 10))
  }
  return needs
}

// 「XをYに戻す場合、…を消費」类脚注 → 回程边（X→Y）。名字是省略形
// （改二特/改Mod.2），由装配层对着本页チャート节点解析成舰船 id。
export const parseWikiwikiReturnEdges = (html, pageName) => {
  const source = `${html ?? ''}`
  const anchor = source.search(/id="notefoot_1"/)
  if (anchor < 0) return []
  const text = htmlText(source.slice(anchor, anchor + 20_000), ' ')
  const out = []
  for (const note of text.split(/\*\d+\s+/).filter(Boolean)) {
    const match = note.match(/^(.+?)を(.+?)に戻す場合[、,]?(.*)$/)
    if (!match) continue
    const clause = match[3].split('。')[0]
    const needs = parseReturnCosts(clause)
    if (!needs.length) continue
    out.push({
      fromName: match[1].trim(),
      toName: match[2].trim(),
      needs,
      raw: `${match[1].trim()}を${match[2].trim()}に戻す場合、${clause.trim()}`,
      page: pageName,
    })
  }
  return out
}

export const wikiwikiRemodelNeedIdentity = (need) =>
  `${need?.kind ?? 'unknown'}:${need?.id ?? need?.nameJp ?? ''}`
