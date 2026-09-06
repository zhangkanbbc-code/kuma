// 维护者侧离线生成器：样本只读随包 CC 格，主数据只供分类，本机包只供比较。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadStart2MasterArray } from './lib/start2.mjs'
import { fitFormulas, categoryOf, renderFormulaCell, conventionText, formulaFor } from './lib/improve-formulas.mjs'
import { FORMAL_OUTPUT, writePack } from './build-akashi-improve.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = path.join(ROOT, 'scripts/lib/improve-formula-evidence.json')
const REPORT = path.join(ROOT, 'docs/improve-formulas-report.md')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hasValue = value => typeof value === 'string' && value !== ''
const valuesOf = item => Object.values(item?.item_remodel ?? {}).flatMap(Object.values).filter(hasValue)
export const formulaKey = entry => `${entry.category}/${entry.stat}`

export function receivedItems(items) {
  return Object.fromEntries(Object.entries(items).map(([id, item]) => {
    const clean = { ...item }
    if (item.item_remodel) clean.item_remodel = Object.fromEntries(Object.entries(item.item_remodel).map(([stat, row]) =>
      [stat, Object.fromEntries(Object.entries(row).filter(([i]) => item.remodel_basis?.[stat]?.[i]?.basis !== 'formula'))]))
    for (const stat of item.formula_added_stats ?? []) delete clean.item_remodel[stat]
    if (clean.item_remodel && !Object.keys(clean.item_remodel).length) delete clean.item_remodel
    delete clean.remodel_basis
    delete clean.formula_added_stats
    return [id, clean]
  }).filter(([, item]) => Object.keys(item).length))
}

export function targetGaps(items, localItems) {
  return Object.entries(localItems).flatMap(([id, item]) => {
    const missing = Object.entries(item.item_remodel ?? {}).flatMap(([stat, row]) => Object.entries(row)
      .filter(([i, value]) => hasValue(value) && !hasValue(items[id]?.item_remodel?.[stat]?.[i])).map(([i]) => ({ stat, index: +i })))
    return missing.length ? [{ id: +id, kind: Object.keys(items[id]?.item_remodel ?? {}).length ? 'partial' : 'missing', missing }] : []
  })
}

export function fillFormulas(pack, localItems, masters, formulas) {
  const output = structuredClone(pack)
  // 续单只补缺口；实收及上一轮推算的值、来源标记均不改写。
  const base = pack.data.items
  output.data = { schemaVersion: 2, items: structuredClone(base) }
  const targets = targetGaps(receivedItems(base), localItems).map(target => ({ ...target,
    missing: target.missing.filter(({ stat, index }) => !hasValue(base[target.id]?.item_remodel?.[stat]?.[index])) }))
  const exceptions = [], noComparison = [], rows = []
  for (const [id, item] of Object.entries(output.data.items)) {
    if (!item.item_remodel) continue
    item.remodel_basis ??= {}
    for (const [stat, row] of Object.entries(item.item_remodel)) {
      item.remodel_basis[stat] ??= {}
      for (const i of Object.keys(row)) item.remodel_basis[stat][i] ??= { basis: 'kcwiki' }
    }
  }
  for (const target of targets) {
    const { id } = target, master = masters[id]
    const local = localItems[id]?.item_remodel ?? {}, existing = base[id]?.item_remodel ?? {}
    const candidates = formulas.filter(entry => entry.proven && entry.category === categoryOf(master, entry.stat))
    const stats = new Set([...Object.keys(local), ...Object.keys(existing), ...candidates.map(entry => entry.stat)])
    const proposals = [], pending = []
    for (const stat of stats) {
      const entry = candidates.find(candidate => candidate.stat === stat)
      const expected = target.missing.filter(cell => cell.stat === stat).length
      if (!entry) {
        if (expected) pending.push({ stat, reason: '类别×属性未证', count: expected })
        continue
      }
      const formula = formulaFor(entry, id)
      const indices = Object.keys(local[stat] ?? existing[stat] ?? {})
      const length = indices.length ? Math.max(...indices.map(Number)) + 1 : Math.max(...formula.segments.map(s => s.to)) + 1
      const generated = Array.from({ length }, (_, i) => renderFormulaCell(formula, i))
      if (generated.some(value => value === null)) {
        if (expected) pending.push({ stat, reason: '公式未覆盖整列星级', count: expected })
        continue
      }
      const differences = generated.flatMap((value, i) => hasValue(local[stat]?.[i]) && value !== local[stat][i]
        ? [{ index: i, star: i + 1, formulaValue: value, localValue: local[stat][i] }] : [])
      if (differences.length) {
        exceptions.push({ id, stat, formula: formulaKey(entry), differences })
        if (expected) pending.push({ stat, reason: '整列存在对照资料对照分歧', count: expected })
        continue
      }
      proposals.push({ stat, entry, generated })
    }
    const hasMismatch = exceptions.some(entry => entry.id === id)
    const added = []
    for (const { stat, entry, generated } of proposals) {
      for (const [i, value] of generated.entries()) {
        if (hasValue(existing[stat]?.[i])) continue
        const compared = hasValue(local[stat]?.[i])
        if (!compared && hasMismatch) continue
        const item = output.data.items[id] ??= {}
        item.item_remodel ??= {}
        if (!Object.hasOwn(item.item_remodel, stat)) (item.formula_added_stats ??= []).push(stat)
        item.item_remodel[stat] ??= {}
        item.remodel_basis ??= {}
        item.remodel_basis[stat] ??= {}
        item.item_remodel[stat][i] = value
        item.remodel_basis[stat][i] = { basis: 'formula', formula: formulaKey(entry), compared }
        added.push({ stat, index: i, compared })
        if (!compared) noComparison.push({ id, stat, index: i, star: i + 1, value })
      }
    }
    const remaining = target.missing.filter(({ stat, index }) => !hasValue(output.data.items[id]?.item_remodel?.[stat]?.[index]))
    rows.push({ ...target, name: master?.api_name ?? `#${id}`, added, pending, remaining })
  }
  const summary = {
    missingItems: targets.filter(t => t.kind === 'missing').length,
    partialItems: targets.filter(t => t.kind === 'partial').length,
    originalGaps: targets.reduce((n, t) => n + t.missing.length, 0),
    filledMissingItems: rows.filter(r => r.kind === 'missing' && r.added.length).length,
    filledPartialItems: rows.filter(r => r.kind === 'partial' && r.added.length).length,
    addedCells: rows.reduce((n, r) => n + r.added.length, 0),
    comparedCells: rows.reduce((n, r) => n + r.added.filter(c => c.compared).length, 0),
    noComparisonCells: noComparison.length,
    remainingGaps: rows.reduce((n, r) => n + r.remaining.length, 0),
    remainingItems: rows.filter(r => r.remaining.length).length,
    preservedFormulaCells: Object.values(base).reduce((n, item) => n + Object.values(item.remodel_basis ?? {})
      .flatMap(Object.values).filter(mark => mark.basis === 'formula').length, 0),
    exceptionColumns: exceptions.length,
  }
  output.meta.formulaEvidenceSha256 = createHash('sha256').update(JSON.stringify(formulas)).digest('hex')
  output.meta.formulaNote = '缺表装备按类别公式推算；对照资料包只作维护者侧比较，推算不等于游戏内实测。'
  return { pack: output, report: { summary, rows, exceptions, noComparison } }
}

export const formulaText = formula => formula ? formula.segments.map(s =>
  `★${s.from + 1}–${s.to + 1}: ${s.a}×${s.family === 'sqrt' ? '√★' : '★'}${s.b ? `${s.b >= 0 ? '+' : ''}${s.b}` : ''}`).join('；') : '候选族无零误差解'

const escape = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ')
const statCounts = cells => Object.entries(cells.reduce((out, c) => { out[c.stat] = (out[c.stat] ?? 0) + 1; return out }, {})).map(([stat, n]) => `${stat} ${n}格`).join('、') || '—'
export function reportMarkdown(formulas, report, masters, types, sampleCount) {
  const lines = ['# 逐星类别公式验证与补全', '',
    '本轮起点：313e66a（2026-09-06）；样本仅取随包 CC 实收格，游戏主数据只供 type2 分类。本机 akashi-list 仅作只读比较，全程离线。',
    `样本装备：${sampleCount}；类别×属性：${formulas.length}；已证：9 → ${formulas.filter(f => f.proven).length}。`,
    '索引 0 对应 ★1；原包没有 ★0 格，不插入零星值。40 格列按 ★1–10 / 11–20 / 21–30 / 31–40 尝试分段。',
    '候选族：a×★、a×√★、a×★+b；系数由样本拟合并归约到简单有理数。完整属性列至少 10 个数字格，全部按该格小数位比较；空表头不算样本，非数字或不足 10 格的列不能证明公式。',
    '按类别×属性列统一检测小数位与惯例：先乘系数再四舍五入、先乘系数再截断、先截断★/√★再乘系数（末尾四舍五入到列精度）。系数为1时，先乘再截断即直接截断。多种惯例同值时按上述顺序选取；不声称同值样本能区分运算顺序。逐格字符串零误差，不引入容差，也不依据本机比较票选择格式。',
    '样本5–9张必须全部吻合；样本≥10张最多允许1张特例，且特例必须在相同惯例和精度下另拟合公式、逐格全部吻合。特例装备补缺使用自身公式。非数字、不足10格或无法另拟合的反例仍阻断类别已证。',
    '分类按 type2；舰爆另按主数据 type[4]=12 分出零式爆战；高角炮防空列按图标类别及基础对空分组，电探命中按基础命中分组。不会因某件不吻合而将它从样本里排除。', '',
    '## 公式表', '', '| 类别（type2） | 属性 | 候选公式 | 惯例 | 吻合/样本 | 结论 | 不吻合装备（已证行均为有据特例） |', '|---|---|---|---|---:|---|---|']
  for (const f of formulas) lines.push(`| ${escape(types[Number(f.category.split(':')[0])] ?? f.category)} (${f.category}) | ${escape(f.stat)} | ${formulaText(f.formula)} | ${conventionText(f.formula)} | ${f.matchedCount}/${f.sampleIds.length} | ${f.proven ? '已证' : '未证'} | ${f.mismatches.map(id => `#${id} ${escape(masters[id]?.api_name ?? '')}`).join('、') || '—'} |`)
  lines.push('', '每条的完整样本 id、吻合 id 与参数见 `scripts/lib/improve-formula-evidence.json`（由 `improve-formulas.mjs` 导出）。')
  lines.push('', '## 有据特例清单（全文）', '')
  const fittedExceptions = formulas.flatMap(f => f.exceptions.map(ex => ({ ...ex, category: f.category, stat: f.stat })))
  if (!fittedExceptions.length) lines.push('无。')
  for (const ex of fittedExceptions) {
    lines.push(`### #${ex.id} ${masters[ex.id]?.api_name ?? ''} · ${ex.category}/${ex.stat}`, '',
      `自身公式：${formulaText(ex.formula)}；惯例：${conventionText(ex.formula)}。证据为随包 CC 实收列，逐格如下；补全不套类别公式。`, '',
      '| 星级 | 实收值 | 特例公式值 |', '|---|---|---|')
    for (const [i, value] of Object.entries(ex.cells)) lines.push(`| ★${+i + 1} | ${value} | ${renderFormulaCell(ex.formula, +i)} |`)
    lines.push('')
  }
  if (!report) return lines.join('\n') + '\n'
  lines.push('', '## 补全统计', '', '```json', JSON.stringify(report.summary, null, 2), '```', '',
    '目标分类沿用原始实收表头口径：60 件没有表头，66 件已有表头但缺格；本轮两类均检查。原始有值样本表334张（#210、#531仅有空表头）。统计新增仅计本轮，上一轮10件170格原值及标记保留，不计入新增；originalGaps为本轮输入仍缺的本机有值格。', '',
    '| 装备 | 原状 | 新增属性 | 仍待补 | 原因 |', '|---|---|---|---|---|')
  for (const r of report.rows) lines.push(`| #${r.id} ${escape(r.name)} | ${r.kind === 'missing' ? '整表缺' : '部分缺'} | ${escape(statCounts(r.added))} | ${escape(statCounts(r.remaining))} | ${escape(r.pending.map(p => `${p.stat}：${p.reason}`).join('；') || '—')} |`)
  lines.push('', '## 本机对照特例（整属性列拒收，已有实收格保留）', '')
  if (!report.exceptions.length) lines.push('无。')
  for (const ex of report.exceptions) {
    lines.push(`### #${ex.id} ${masters[ex.id]?.api_name ?? ''} · ${ex.stat}`, '', '| 星级 | 公式值 | 本机值 |', '|---|---|---|')
    for (const c of ex.differences) lines.push(`| ★${c.star} | ${escape(c.formulaValue)} | ${escape(c.localValue)} |`)
    lines.push('')
  }
  lines.push('', '## 无对照收录', '', '只在该类别×属性已证、且该装备没有任何对照分歧列时收录。')
  if (!report.noComparison.length) lines.push('本次无。')
  for (const id of [...new Set(report.noComparison.map(c => c.id))]) {
    lines.push(`- #${id} ${masters[id]?.api_name ?? ''}：${statCounts(report.noComparison.filter(c => c.id === id))}`)
  }
  lines.push('', '## 界面文案（沿用上一轮）', '', '- 格后及悬浮摘要：`推算`', '- 悬停：`按装备类别公式推算，未经游戏内实测`', '- 设置页资料栏：`缺表装备按类别公式推算`', '')
  lines.push('新版随包格已过比较闸门，运行时不再以本机逐星格绕过拒收；图鉴说明的本机补缺照旧。装备改修的玩家/开发机差异归零，对应旧白名单已退役。',
    '本单没有裁改「无改修方案时逐星表位于早退分支之后」的既有护栏（`test/improve-star-gap.test.mjs`）；这些装备的抽屉仍保留待补占位，★10 悬浮摘要可显示已收推算值。', '')
  return lines.join('\n')
}

export function main(argv = process.argv.slice(2)) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (['--fit', '--fill'].includes(argv[i])) options[argv[i]] = true
    else if (['--in', '--akashi', '--out', '--report', '--evidence'].includes(argv[i]) && argv[i + 1]) options[argv[i]] = argv[++i]
    else throw new Error(`未知或缺值参数 ${argv[i]}`)
  }
  const pack = json(path.resolve(options['--in'] ?? FORMAL_OUTPUT))
  if (pack.meta?.id !== 'kcwiki-akashi-improve' || pack.meta.comparisonVerified !== true) throw new Error('公式样本必须是已逐格核对的 CC 随包包')
  const masters = Object.fromEntries(loadStart2MasterArray('api_mst_slotitem', ROOT).map(e => [e.api_id, e]))
  const types = Object.fromEntries(loadStart2MasterArray('api_mst_slotitem_equiptype', ROOT).map(e => [e.api_id, e.api_name]))
  if (!Object.keys(masters).length) throw new Error('缺游戏装备主数据，不能分类')
  const received = receivedItems(pack.data.items)
  const formulas = fitFormulas(received, masters)
  fs.writeFileSync(path.resolve(options['--evidence'] ?? EVIDENCE), JSON.stringify(formulas, null, 2) + '\n')
  let report = null
  if (options['--fill']) {
    if (!options['--akashi']) throw new Error('--fill 必须显式指定只读 --akashi 本机比较包')
    const result = fillFormulas(pack, json(path.resolve(options['--akashi'])).data.items, masters, formulas)
    writePack(path.resolve(options['--out'] ?? FORMAL_OUTPUT), result.pack)
    report = result.report
  }
  fs.writeFileSync(path.resolve(options['--report'] ?? REPORT), reportMarkdown(formulas, report, masters, types, Object.values(received).filter(item => valuesOf(item).length).length))
  console.log(JSON.stringify({ groups: formulas.length, proven: formulas.filter(f => f.proven).length, summary: report?.summary }))
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
