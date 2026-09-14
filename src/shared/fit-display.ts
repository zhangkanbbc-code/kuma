import type { FitRule, FitStats, FitWhoSet } from './fit-bonus'

export interface FitDisplayLine {
  who: FitWhoSet
  rules: FitRule[]
  corrections: FitRule[]
  mode: 'perEquip' | 'once' | 'mixed' | 'passthrough'
  first: FitStats
  more: FitStats | null
  stackUnverified: boolean
}

const mergeable = (rule: FitRule): boolean =>
  rule.gain.kind === 'flat' &&
  rule.who.forms !== undefined &&
  rule.who.classes === undefined &&
  rule.who.types === undefined &&
  rule.who.all === undefined &&
  rule.who.nations === undefined &&
  rule.not === undefined &&
  rule.need === undefined &&
  rule.cap === undefined &&
  rule.setTotal === undefined &&
  rule.layer === undefined &&
  (rule.stack === 'perEquip' || rule.stack === 'once')

const sum = (rules: readonly FitRule[]): FitStats => {
  const stats: FitStats = {}
  for (const rule of rules) {
    if (rule.gain.kind !== 'flat') continue
    for (const key of Object.keys(rule.gain.flat) as (keyof FitStats)[]) {
      const value = rule.gain.flat[key]
      if (value) stats[key] = (stats[key] ?? 0) + value
    }
  }
  // 与预期合计一致：正负修正抵消的项不保留零值键。
  for (const key of Object.keys(stats) as (keyof FitStats)[]) if (stats[key] === 0) delete stats[key]
  return stats
}

export const fitDisplayLines = (
  rules: readonly FitRule[],
  opts?: { formId?: number },
): FitDisplayLine[] => {
  const coverage = new Map<number, number[]>()
  const ordered: { line: FitDisplayLine; anchor: number; position: number }[] = []
  rules.forEach((rule, index) => {
    if (mergeable(rule)) {
      for (const form of new Set(rule.who.forms)) {
        const indices = coverage.get(form) ?? []
        indices.push(index)
        coverage.set(form, indices)
      }
    } else {
      ordered.push({
        line: {
          who: rule.who,
          rules: [rule],
          corrections: rule.correction ? [rule] : [],
          mode: 'passthrough',
          first: rule.gain.kind === 'flat' ? { ...rule.gain.flat } : {},
          more: null,
          stackUnverified: !!rule.stackUnverified,
        },
        anchor: index,
        position: index,
      })
    }
  })

  // 相同覆盖行集合才共用一条显示线；Map 保留形态在原行中首次出现的顺序。
  const partitions = new Map<string, { forms: number[]; indices: number[]; position: number }>()
  let position = 0
  for (const [form, indices] of coverage) {
    const key = indices.join(',')
    const partition = partitions.get(key) ?? { forms: [], indices, position }
    partition.forms.push(form)
    partitions.set(key, partition)
    position++
  }
  for (const { forms, indices, position } of partitions.values()) {
    if (opts?.formId !== undefined && !forms.includes(opts.formId)) continue
    const sources = indices.map((index) => rules[index])
    const perEquip = sources.filter((rule) => rule.stack === 'perEquip')
    // 修正的 row 0 不抢上游位置；用最小上游 row 所在原下标与直通线一起排序。
    const upstream = indices.filter((index) => rules[index].row !== 0)
    upstream.sort((a, b) => rules[a].row - rules[b].row || a - b)
    ordered.push({
      line: {
        who: { forms },
        rules: sources,
        corrections: sources.filter((rule) => !!rule.correction),
        mode: perEquip.length === sources.length ? 'perEquip' : perEquip.length ? 'mixed' : 'once',
        first: sum(sources),
        more: perEquip.length ? sum(perEquip) : null,
        stackUnverified: sources.some((rule) => !!rule.stackUnverified),
      },
      anchor: upstream.length ? upstream[0] : Infinity,
      position,
    })
  }
  return ordered.sort((a, b) => a.anchor - b.anchor || a.position - b.position).map(({ line }) => line)
}
