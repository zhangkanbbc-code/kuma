import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { htmlText, splitAreaMaps, tableGrid } from '../map-intel.mjs'

const WIKI_ROOT = 'https://wikiwiki.jp/kancolle/'
const NORMAL_MAP_PAGES = {
  1: '鎮守府海域',
  2: '南西諸島海域',
  3: '北方海域',
  4: '西方海域',
  5: '南方海域',
  6: '中部海域',
  7: '南西海域',
}
// 兜底常量——调用方应传入主数据推导的 mapLast(见 map-intel.mjs loadNormalMapLast)。
// 5-6 实装曾被这张写死表整图漏抓(2026-08-11)。
const NORMAL_MAP_LAST = { 1: 6, 2: 5, 3: 5, 4: 5, 5: 6, 6: 5, 7: 5 }

const routeText = (value) =>
  htmlText(`${value ?? ''}`.replace(/<br\b[^>]*>/gi, '\u241e'))
    .split('\u241e')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('；')

export const parseWikiwikiRoutingSection = (html) => {
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
  for (const match of tables) {
    const grid = tableGrid(match[0])
    const headerAt = grid.findIndex((row) => {
      const labels = row.map((cell) => `${cell?.text ?? ''}`.trim())
      return (
        labels.includes('分岐点') &&
        labels.includes('ルート') &&
        labels.some((label) => /移動条件|分岐条件/.test(label))
      )
    })
    if (headerAt < 0) continue
    const labels = grid[headerAt].map((cell) => `${cell?.text ?? ''}`.trim())
    const fromCol = labels.indexOf('分岐点')
    const toCol = labels.indexOf('ルート')
    const conditionCol = labels.findIndex((label) => /移動条件|分岐条件/.test(label))
    if (fromCol < 0 || toCol < 0 || conditionCol < 0) continue
    const byFrom = new Map()
    for (const row of grid.slice(headerAt + 1)) {
      const from = `${row[fromCol]?.text ?? ''}`.trim()
      const to = `${row[toCol]?.text ?? ''}`.trim()
      const condition = routeText(row[conditionCol]?.html ?? row[conditionCol]?.text ?? '')
      if (!/^[A-Z]{1,2}\d*$/.test(from) || !/^[A-Z]{1,2}\d*$/.test(to) || !condition) {
        continue
      }
      const routes = byFrom.get(from) ?? []
      if (!routes.some((entry) => entry.to === to && entry.conditionJp === condition)) {
        routes.push({ to, conditionJp: condition })
      }
      byFrom.set(from, routes)
    }
    const nodes = [...byFrom].map(([from, routes]) => ({ from, routes }))
    if (nodes.length) return nodes
  }
  return []
}

const fetchText = async (url, cacheFile, minIntervalMs, clock) => {
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8')
  const remaining = minIntervalMs - (Date.now() - clock.last)
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  clock.last = Date.now()
  const response = await fetch(url, { headers: { 'User-Agent': 'kanso-lodes' } })
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
  const text = await response.text()
  mkdirSync(path.dirname(cacheFile), { recursive: true })
  writeFileSync(cacheFile, text, 'utf8')
  return text
}

export const fetchWikiwikiRouting = async ({
  cacheDir,
  minIntervalMs = 10_500,
  mapLast = NORMAL_MAP_LAST,
} = {}) => {
  if (!cacheDir) throw new Error('wikiwiki-routing 需要显式缓存目录')
  const maps = {}
  const clock = { last: 0 }
  let latest = null
  for (const [areaText, last] of Object.entries(mapLast)) {
    const area = Number(areaText)
    const page = NORMAL_MAP_PAGES[area]
    const url = `${WIKI_ROOT}${encodeURI(page)}`
    const html = await fetchText(
      url,
      path.join(cacheDir, `area-${area}.html`),
      minIntervalMs,
      clock,
    )
    const modified = html.match(/Last-modified:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
    if (modified && (!latest || modified > latest)) latest = modified
    const sections = splitAreaMaps(html, area, last)
    if (sections.size !== last) {
      throw new Error(`${page} 聚合页只解析到 ${sections.size}/${last} 张图`)
    }
    for (let no = 1; no <= last; no++) {
      const code = `${area}-${no}`
      const nodes = parseWikiwikiRoutingSection(sections.get(code))
      maps[code] = {
        page: `${page}/${code}`,
        sourceUrl: `${WIKI_ROOT}${encodeURI(`${page}/${code}`)}`,
        checkedAt: modified,
        nodes,
      }
    }
    console.log(
      `[lodes]   wikiwiki 带路说明 ${Object.keys(maps).length}/${Object.values(mapLast).reduce((sum, last) => sum + last, 0)} 图`,
    )
  }
  return {
    data: { schemaVersion: 1, maps },
    upstreamUpdatedAt: latest ? `${latest}T00:00:00+09:00` : null,
  }
}
