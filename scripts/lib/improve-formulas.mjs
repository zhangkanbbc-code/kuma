// 只拟合 CC 随包实收格；本机比较票及 wikiwiki 不参与系数或格式选择。
// 稀疏表索引 0 = ★1；40 格按索引 0–9 / 10–19 / 20–29 / 30–39 检验。
import evidence from './improve-formula-evidence.json' with { type: 'json' }
export const IMPROVE_FORMULAS = evidence
// 同值时优先保留四舍五入；截断指乘系数后截断，最后一种先截断基函数再乘。
export const ROUNDING_MODES = ['round', 'truncate', 'truncate-base']
export const conventionText = formula => !formula ? '—' : ({
  round: '先乘系数再四舍五入', truncate: '先乘系数再截断',
  'truncate-base': '先截断★/√★再乘系数，末尾四舍五入',
}[formula.rounding] + `（${formula.format.digits}位小数）`)
export const formulaFor = (entry, id) => entry.exceptions?.find(ex => ex.id === Number(id))?.formula ?? entry.formula

export function categoryOf(equip, stat) {
  const type = equip?.api_type?.[2]
  if (!type) return 'unknown'
  // 分组只依据游戏主数据，不按拟合结果排除装备。
  // type[4]=12 的零式爆战与普通舰爆分开；它们的爆装/对潜列不能互相证明。
  if (type === 7) return `7:${equip.api_type[4] === 12 ? '零式爆戦' : '艦爆'}`
  if (['加重対空', '艦隊防空'].includes(stat) && [1, 4].includes(type)) {
    return `${type}:${equip.api_type[3] === 16 ? (equip.api_tyku >= 8 ? '高角砲・対空8以上' : '高角砲・対空7以下') : '通常砲'}`
  }
  if (stat === '命中' && [12, 13, 93].includes(type)) return `${type}:命中${equip.api_houm >= 3 ? '3以上' : '2以下'}`
  return `${type}`
}

export const parseCell = value => {
  const match = typeof value === 'string' && value.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  return match ? { value: Number(value), digits: match[3]?.length ?? 0, plus: match[1] === '+' } : null
}

export function formatValue(value, { digits, plus }, rounding = 'round') {
  const scale = 10 ** digits
  const rounded = rounding === 'truncate' ? Math.trunc(value * scale + Math.sign(value) * 1e-9) / scale
    : Math.round((value + Number.EPSILON) * scale) / scale
  return `${plus && rounded >= 0 ? '+' : ''}${rounded.toFixed(digits)}`
}

export function formulaValue(formula, index) {
  const segment = formula.segments.find(part => index >= part.from && index <= part.to)
  if (!segment) return null
  const star = index + 1
  return segment.a * (segment.family === 'sqrt' ? Math.sqrt(star) : star) + segment.b
}

export function renderFormulaCell(formula, index, format = formula.format) {
  const segment = formula.segments.find(part => index >= part.from && index <= part.to)
  let value = formulaValue(formula, index)
  if (segment && formula.rounding === 'truncate-base') {
    const base = segment.family === 'sqrt' ? Math.sqrt(index + 1) : index + 1
    value = segment.a * Number(formatValue(base, formula.format, 'truncate')) + segment.b
  }
  return value === null ? null : formatValue(value, format, formula.rounding)
}

// 候选系数收敛到简单有理数，避免靠任意小数微调去追逐排版误差。
const simple = value => [...new Set([1, 2, 3, 4, 5, 10, 20, 100].map(d => Math.round(value * d) / d))]
const matches = (segment, cells, rounding) => cells.every(([index, cell]) =>
  renderFormulaCell({ segments: [segment], rounding, format: cell }, index) === cell.text)

function fitSegment(cells, from, to, rounding) {
  const selected = cells.filter(([i]) => i >= from && i <= to)
  if (selected.length < 3) return null
  for (const family of ['linear', 'sqrt', 'affine']) {
    const xs = selected.map(([i]) => family === 'sqrt' ? Math.sqrt(i + 1) : i + 1)
    const ys = selected.map(([, c]) => c.value)
    const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0)
    const sxx = xs.reduce((a, x) => a + x * x, 0), sxy = xs.reduce((a, x, i) => a + x * ys[i], 0)
    const slope = family === 'affine' ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : sxy / sxx
    // 单点商也加入候选；拟合后仍需逐格零误差。
    const coefficients = [...new Set([...simple(slope), ...selected.flatMap(([, c], i) => simple(c.value / xs[i]))])]
    for (const a of coefficients) {
      for (const b of family === 'affine' ? simple((sy - a * sx) / n) : [0]) {
        const part = { from, to, family: family === 'affine' ? 'linear' : family, a, b }
        if (matches(part, selected, rounding)) return part
      }
    }
  }
  return null
}

export function fitRow(row, roundingModes = ROUNDING_MODES) {
  const cells = Object.entries(row).map(([i, text]) => [+i, { ...parseCell(text), text }])
  if (cells.length < 10 || cells.some(([, c]) => !Number.isFinite(c.value))) return null
  const max = Math.max(...cells.map(([i]) => i))
  const formats = [...new Set(cells.map(([, c]) => JSON.stringify({ digits: c.digits, plus: c.plus })))]
  if (formats.length !== 1) return null
  for (const rounding of roundingModes) {
    const whole = fitSegment(cells, 0, max, rounding)
    if (whole) return { segments: [whole], rounding, format: JSON.parse(formats[0]) }
    if (max >= 10) {
      const segments = []
      for (let from = 0; from <= max; from += 10) segments.push(fitSegment(cells, from, Math.min(from + 9, max), rounding))
      if (segments.every(Boolean)) return { segments, rounding, format: JSON.parse(formats[0]) }
    }
  }
  return null
}

export function rowMatches(formula, row) {
  const cells = Object.entries(row)
  return cells.length >= 10 && cells.every(([i, value]) => {
    const format = parseCell(value)
    return format && format.digits === formula.format.digits && format.plus === formula.format.plus
      && renderFormulaCell(formula, +i) === value
  })
}

export function fitFormulas(items, masters, { roundingModes = ROUNDING_MODES } = {}) {
  const groups = new Map()
  for (const [id, item] of Object.entries(items)) {
    for (const [stat, row] of Object.entries(item.item_remodel ?? {})) {
      // 重跑时推算格永不成为证据；完全空的表头不算一张样本。
      const received = Object.fromEntries(Object.entries(row).filter(([i]) => item.remodel_basis?.[stat]?.[i]?.basis !== 'formula'))
      if (!Object.keys(received).length) continue
      const category = categoryOf(masters[id], stat), key = `${category}/${stat}`
      if (!groups.has(key)) groups.set(key, { category, stat, samples: [] })
      groups.get(key).samples.push({ id: +id, row: received })
    }
  }
  return [...groups.values()].map(({ category, stat, samples }) => {
    const candidates = roundingModes.flatMap(mode => samples.map(s => fitRow(s.row, [mode])).filter(Boolean))
    const scored = candidates.map(formula => {
      const matched = samples.filter(s => rowMatches(formula, s.row)).map(s => s.id)
      const exceptions = []
      // 特例也必须逐格拟合成功，并与整列共用惯例及小数位；不删样本、不放宽误差。
      if (samples.length >= 10 && matched.length === samples.length - 1) {
        const sample = samples.find(s => !matched.includes(s.id))
        const own = fitRow(sample.row, [formula.rounding])
        if (own && JSON.stringify(own.format) === JSON.stringify(formula.format)) {
          exceptions.push({ id: sample.id, formula: own, cells: sample.row })
        }
      }
      return { formula, matched, exceptions }
    }).sort((a, b) => b.matched.length - a.matched.length || b.exceptions.length - a.exceptions.length)
    const best = scored[0] ?? { formula: null, matched: [], exceptions: [] }
    const { exceptions } = best
    const mismatches = samples.filter(s => !best.matched.includes(s.id)).map(s => s.id)
    const proven = category !== 'unknown' && best.matched.length >= 5 && (!mismatches.length
      || (samples.length >= 10 && mismatches.length === 1 && exceptions.length === 1))
    return { category, stat, proven, convention: conventionText(best.formula),
      formula: best.formula, matchedCount: best.matched.length, sampleIds: samples.map(s => s.id), matchedIds: best.matched, mismatches,
      exceptions: proven ? exceptions : [] }
  }).sort((a, b) => a.category.localeCompare(b.category, 'en', { numeric: true }) || a.stat.localeCompare(b.stat, 'ja'))
}
