import { tableGrid } from '../map-intel.mjs'

/**
 * wikiwiki「艦船最大値」总表：全形态的 Lv99 上限（表头自带 Lv99 备注列）。
 * 只取游戏主数据不下发的三维（回避/対潜/索敵）；耐久/火力等六项主数据一手，
 * 不从社区表重复采集。No. 列是「図鑑号+形态字母」（001a 長門 / 393 榛名改二乙），
 * 装配层拿数字部分对 api_sortno 找候选，再按名字（去括号注记）唯一化。
 */
/**
 * 逐舰页的「艦船ステータス(初期値/最大値)」表：批量总表不收的形态
 * （新实装、補给改修形态、部分海外舰系）唯一的三维来源，而且带初期值
 * （批量表只有最大值）。单元格是「回避|14 / 26」的标签-取值对；
 * 「0」这种单值＝不成长（初期=最大）。wiki 用「--」标未实测的一侧
 * （Béarn 回避「20 / --」、Flight II 索敵「-- / 84」）——拿到哪半算哪半，
 * 缺的照实留空，不整页放弃。
 */
export const parseWikiwikiShipPageStats = (html) => {
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
  const parsePair = (text) => {
    const clean = `${text ?? ''}`.replace(/ /g, ' ').trim()
    const side = (part) => (/^\d+$/.test(part) ? Number(part) : null)
    const pair = clean.match(/^([-—－\d]+)\s*\/\s*([-—－\d]+)$/)
    if (pair) {
      const parsed = [side(pair[1]), side(pair[2])]
      return parsed[0] != null || parsed[1] != null ? parsed : null
    }
    const single = clean.match(/^(\d+)$/)
    return single ? [Number(single[1]), Number(single[1])] : null
  }
  for (const match of tables) {
    const grid = tableGrid(match[0])
    const found = {}
    for (const row of grid) {
      for (let index = 0; index < row.length - 1; index++) {
        const label = row[index]?.text?.trim()
        const key = label === '回避' ? 'kaihi' : label === '対潜' ? 'taisen' : label === '索敵' ? 'sakuteki' : null
        if (!key || found[key]) continue
        const pair = parsePair(row[index + 1]?.text)
        if (pair) found[key] = pair
      }
    }
    if (found.kaihi || found.taisen || found.sakuteki) return found
  }
  return null
}

export const parseWikiwikiShipMaxTable = (html) => {
  const tables = [...`${html ?? ''}`.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)]
  for (const match of tables) {
    const grid = tableGrid(match[0])
    if (grid.length < 300) continue
    const head = grid[0]?.map((cell) => cell?.text?.trim() ?? '') ?? []
    const nameCol = head.indexOf('艦名')
    const cols = {
      kaihi: head.indexOf('回避'),
      taisen: head.indexOf('対潜'),
      sakuteki: head.indexOf('索敵'),
    }
    if (nameCol < 0 || cols.kaihi < 0 || cols.taisen < 0 || cols.sakuteki < 0) continue
    const out = []
    for (const row of grid.slice(1)) {
      const name = row[nameCol]?.text?.trim() ?? ''
      const no = row[0]?.text?.trim() ?? ''
      const num = (index) => {
        const value = Number.parseInt(row[index]?.text?.trim() ?? '', 10)
        return Number.isFinite(value) && value >= 0 ? value : null
      }
      const kaihi = num(cols.kaihi)
      const taisen = num(cols.taisen)
      const sakuteki = num(cols.sakuteki)
      if (!name || kaihi == null || taisen == null || sakuteki == null) continue
      out.push({ name, no, kaihi, taisen, sakuteki })
    }
    if (out.length) return out
  }
  return []
}
