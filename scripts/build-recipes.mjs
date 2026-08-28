// wikiwiki「建造レシピ」页解析。
//
// 页面按目标舰种分节（駆逐艦/軽巡洋艦/重巡洋艦/戦艦/空母/潜水艦），每节一到多张
// 配方表，列固定：燃料 | 弾薬 | 鋼材 | ボーキ | 備考。備考是「报告较多的配方」
// 的口径文本，**不是概率表**——原样保留，消费端必须照此标注。
// 另有「建造時間一覧表」：時間 | 艦種 | 出現艦娘 | 出現艦娘（大型艦建造のみ）。
// 建造时间在游戏里唯一提示领取前的身份，这张表同时给出「谁能被建出来、
// 是否大型限定」的逐舰名单。
//
// rowspan（時間跨舰种、舰种跨多行）由 tableGrid 展开；<br> 由 htmlText 转空格，
// 舰名按 ・/空格 切分，括号注记（秘書艦条件等）从名字上剥掉——匹配要的是纯名。
import { htmlText, tableGrid } from './map-intel.mjs'

/** 页面分节标题即目标舰种；不在这张表里的节（掲示板等）下的表一律不读 */
const TARGET_HEADINGS = ['駆逐艦', '軽巡洋艦', '重巡洋艦', '戦艦', '空母', '潜水艦']

const intOf = (text) => {
  const cleaned = `${text ?? ''}`.replace(/[,\s]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  return Number.parseInt(cleaned, 10)
}

const shipNamesOf = (text) =>
  `${text ?? ''}`
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[・、\s]+/)
    .map((name) => name.trim())
    .filter(Boolean)

export const parseBuildRecipes = (html) => {
  const recipes = []
  const times = []
  let target = null
  let scanned = 0
  const walker = /<(h[2-4])[^>]*>([\s\S]*?)<\/\1>|<table[\s\S]*?<\/table>/gi
  let match
  while ((match = walker.exec(String(html)))) {
    if (match[1]) {
      const title = htmlText(match[2])
      // 任何标题都会切换语境：非目标舰种的节（建造時間/掲示板…）下的
      // 配方形状表格不再被误认成配方
      target = TARGET_HEADINGS.includes(title) ? title : null
      continue
    }
    const grid = tableGrid(match[0])
    if (grid.length < 2) continue
    const header = grid[0].map((cell) => htmlText(cell?.text ?? ''))
    const isRecipeTable =
      header[0] === '燃料' && header[1] === '弾薬' && header[2] === '鋼材' && header[3] === 'ボーキ'
    const isTimeTable = header[0] === '時間' && header.some((text) => text.includes('出現艦娘'))
    if (isRecipeTable && target) {
      scanned += 1
      for (const row of grid.slice(1)) {
        const recipe = [0, 1, 2, 3].map((i) => intOf(row[i]?.text))
        if (recipe.some((v) => v == null)) continue
        recipes.push({
          target,
          recipe,
          note: htmlText(row[4]?.text ?? ''),
        })
      }
    } else if (isTimeTable) {
      scanned += 1
      const largeCol = header.findIndex((text) => text.includes('大型'))
      for (const row of grid.slice(1)) {
        const time = htmlText(row[0]?.text ?? '')
        if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) continue
        times.push({
          time,
          stype: htmlText(row[1]?.text ?? ''),
          ships: shipNamesOf(row[2]?.text),
          largeOnly: largeCol >= 0 ? shipNamesOf(row[largeCol]?.text) : [],
        })
      }
    }
  }
  return { recipes, times, tablesScanned: scanned }
}
