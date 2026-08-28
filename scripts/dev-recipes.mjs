// wikiwiki「開発」页的装备开发表解析。
//
// 页面把「哪种秘书舰 + 哪张资材表能开出什么、出货率多少」整理成 21 张表，
// 每张的结构一致：
//
//   分類(理論値) | 装備 | 秘書艦タイプ | 鋼（燃）| 弾薬 | ボーキ | 備考
//   小口径主砲   | 12cm単装砲   | 砲戦系 |  4%  |  －  |  －  |
//   小口径主砲   | 12cm単装砲   | 水雷系 |  6%  |  2%  |  2%  |
//
// 三个资材列是「最大资材表」的三种走向（钢/燃、弹药、铝），不是具体配比数字；
// `－` 表示这个组合开不出来。出货率是社区大样本统计的**推定值**，不是游戏给的规则，
// 消费端必须照此标注。
import { tableGrid } from './map-intel.mjs'

/** 「4%」→ 4；「－」「-」「?」→ null（开不出 / 资料未定） */
const parseRate = (text) => {
  const cleaned = `${text ?? ''}`.replace(/\s/g, '')
  if (!cleaned || /^[－—\-–ー?？]+$/.test(cleaned)) return null
  const value = Number.parseFloat(cleaned.replace('%', ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

const clean = (text) => `${text ?? ''}`.replace(/\s+/g, '').trim()

/** 秘书舰类型：页面只用这四种分类，别的一律丢掉而不是猜 */
const SECRETARY_TYPES = ['砲戦系', '水雷系', '空母系', '潜水系']

/**
 * 解析整页，产出「装备名 → 可行的开发组合」。
 *
 * 同一件装备会在多张表里重复出现（分类表 + 汇总表），按
 * （装备 + 秘书舰 + 资材表）去重；同组合出现两个不同数字时取先出现的，
 * 并不做平均——那会造出一个两处都没写过的数。
 */
export const parseDevRecipes = (html) => {
  const tables = [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0])
  /** @type {Record<string, {secretary: string, table: string, rate: number}[]>} */
  const byEquip = {}
  const seen = new Set()
  let scanned = 0
  for (const table of tables) {
    const grid = tableGrid(table)
    if (grid.length < 3) continue
    const header = grid[0].map((cell) => clean(cell?.text))
    if (!header.some((text) => text.includes('秘書艦'))) continue
    scanned += 1
    // 第二行才是资材列的子表头（鋼（燃）/ 弾薬 / ボーキ）
    const sub = grid[1].map((cell) => clean(cell?.text))
    const equipCol = sub.findIndex((text) => text === '装備')
    const secretaryCol = sub.findIndex((text) => text.includes('秘書艦'))
    const resourceCols = []
    for (let i = 0; i < sub.length; i += 1) {
      if (/^鋼（燃）$|^鋼\(燃\)$/.test(sub[i])) resourceCols.push([i, '钢/燃'])
      else if (sub[i] === '弾薬') resourceCols.push([i, '弹药'])
      else if (sub[i] === 'ボーキ') resourceCols.push([i, '铝'])
    }
    if (equipCol < 0 || secretaryCol < 0 || !resourceCols.length) continue

    for (const row of grid.slice(2)) {
      const equip = clean(row[equipCol]?.text)
      const secretary = clean(row[secretaryCol]?.text)
      if (!equip || !SECRETARY_TYPES.includes(secretary)) continue
      for (const [index, label] of resourceCols) {
        const rate = parseRate(row[index]?.text)
        if (rate == null) continue
        const key = `${equip}|${secretary}|${label}`
        if (seen.has(key)) continue
        seen.add(key)
        ;(byEquip[equip] ??= []).push({ secretary, table: label, rate })
      }
    }
  }
  for (const list of Object.values(byEquip)) {
    list.sort((a, b) => b.rate - a.rate || a.secretary.localeCompare(b.secretary))
  }
  return { equipment: byEquip, tablesScanned: scanned }
}
