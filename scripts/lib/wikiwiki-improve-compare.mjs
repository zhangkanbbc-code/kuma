// wikiwiki 的第三票仅用于报告，绝不进入公式拟合或随包取值。
import { parseWikiwikiTable } from './wikiwiki-kaishu.mjs'
const plain = text => text.replace(/<[^>]+>/g, '').replace(/\s+/g, '')

export function parseWikiwikiImprove(html) {
  const rows = [], unmapped = []
  let numericTables = 0
  for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)) {
    const table = parseWikiwikiTable(match[0])
    const header = table.find(row => row.some(cell => cell === '★+1') && row.some(cell => cell === 'max'))
    if (!header) continue
    const start = header.indexOf('★+1')
    if (header.slice(start).join(',') !== '★+1,★+2,★+3,★+4,★+5,★+6,★+7,★+8,★+9,max') continue
    const numeric = table.filter(row => row.length === header.length && row.slice(start).every(c => /^\d+\.\d+$/.test(c)))
    if (!numeric.length) continue
    numericTables++
    const prefix = html.slice(0, match.index)
    const headings = [...prefix.matchAll(/<h[2-5]\b[^>]*>([\s\S]*?)<\/h[2-5]>/g)]
    const heading = plain(headings.at(-1)?.[1] ?? '')
    const weighted = numeric.some(row => row[0] === '機銃')
    for (const row of numeric) {
      const label = row[0].replace(/\s+/g, '')
      let stat = null, scope = null
      if (heading.startsWith('索敵値の上昇')) {
        stat = '索敵値'
        scope = { '大型電探': 'largeRadar', '小型電探': 'smallRadar', '水上偵察機艦上偵察機大型飛行艇': 'recon', '水上爆撃機': 'seaplaneBomber' }[label]
      } else if (heading.startsWith('命中率の上昇') && label === '電探(素命中+3以上)') {
        stat = '命中'; scope = 'accurateRadar'
      } else if (heading.startsWith('対空能力の上昇')) {
        stat = weighted ? '加重対空' : '艦隊防空'
        scope = { '機銃': 'machineGun', '高角砲（素対空8以上）': 'highAngle8', '高角砲（素対空7以下）高射装置': 'highAngle7', '対空電探': 'aaRadar' }[label]
      }
      const values = row.slice(start).map(value => `+${value}`)
      if (stat && scope) rows.push({ heading, label, stat, scope, values })
      else unmapped.push({ heading, label })
    }
  }
  return { numericTables, rows, unmapped }
}

function applies(scope, equip) {
  const type = equip?.api_type?.[2], icon = equip?.api_type?.[3]
  switch (scope) {
    case 'largeRadar': return [13, 93].includes(type)
    case 'smallRadar': return type === 12
    case 'recon': return [9, 10, 41, 94].includes(type)
    case 'seaplaneBomber': return type === 11
    case 'accurateRadar': return [12, 13, 93].includes(type) && equip.api_houm >= 3
    case 'machineGun': return type === 21
    case 'highAngle8': return [1, 4].includes(type) && icon === 16 && equip.api_tyku >= 8
    case 'highAngle7': return type === 36 || ([1, 4].includes(type) && icon === 16 && equip.api_tyku <= 7)
    case 'aaRadar': return [12, 13, 93].includes(type) && equip.api_tyku >= 2
    default: return false
  }
}

export function compareWikiwikiImprove(html, moduleItems, localItems, masters) {
  const parsed = parseWikiwikiImprove(html)
  const summary = { threeSame: 0, wikiLocalModuleMissing: 0, wikiLocalModuleDifferent: 0, different: 0, missingLocal: 0 }
  const cells = []
  for (const [id, equip] of Object.entries(masters)) {
    for (const row of parsed.rows.filter(row => applies(row.scope, equip))) {
      // 只有原两票至少有一方列出这个属性才比较，泛称类别不当作逐件实测票。
      if (!moduleItems[id]?.item_remodel?.[row.stat] && !localItems[id]?.item_remodel?.[row.stat]) continue
      for (const [index, wikiValue] of row.values.entries()) {
        const moduleValue = moduleItems[id]?.item_remodel?.[row.stat]?.[index] ?? null
        const localValue = localItems[id]?.item_remodel?.[row.stat]?.[index] ?? null
        const kind = localValue === null || localValue === '' ? 'missingLocal'
          : wikiValue !== localValue ? 'different'
          : wikiValue === moduleValue ? 'threeSame'
          : moduleValue === null || moduleValue === '' ? 'wikiLocalModuleMissing' : 'wikiLocalModuleDifferent'
        summary[kind]++
        cells.push({ id: +id, stat: row.stat, index, wikiValue, moduleValue, localValue, kind })
      }
    }
  }
  return { sourceUrl: 'https://wikiwiki.jp/kancolle/改修工廠', numericTables: parsed.numericTables,
    mappedRows: parsed.rows.length, unmappedRows: parsed.unmapped, summary, cells }
}
