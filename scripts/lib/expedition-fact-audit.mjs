// 维护者侧语义投影。原文留在输入包；夹具仅保存结构化消费值。
import { isDeepStrictEqual } from 'node:util'
import { parseCompositionBranches } from '../../src/shared/expedition-composition.ts'

export const equal = isDeepStrictEqual
export const itemName = (name) => name.replaceAll('（', '(').replaceAll('）', ')')
  .replaceAll('修復', '修复').replaceAll('開発', '开发').replaceAll('資材', '资材')
export const branchMeaning = (branches) => branches.map(({ reqs }) => reqs.map(
  ({ label, types, ...req }) => ({ ...req, types: types ? [...types].sort((a, b) => a - b) : null }),
)) // 顺序决定规划器首选分支和槽位，不得排序后假装等价。

export const greatMeaning = (text) => {
  if (!text) return null
  // 24 的原文包含互相冲突的两个桶数，保留为歧义事实，不能猜一个。
  if (text.includes('合計4個以上合計2個以上')) return { ambiguousDrumTotals: [4, 2], kira: 4 }
  const tentative = /待验证|[？?]/.test(text)
  const drum = text.match(/(?:合計|大成功要)(\d+)(?:個|桶)以上/)
  const alternatives = drum ? [{ drumTotal: Number(drum[1]), kira: 4 }]
    : /(?:旗舰|旗艦Lv)33/.test(text)
      ? [{ flagLv: 33, kira: 5 }, { flagLv: 128, kira: 4 }]
      : /128/.test(text) ? [{ kira: 5 }, { flagLv: 128, kira: 4 }] : null
  if (!alternatives) throw new Error(`未识别的大成功说明：${text}`)
  return { alternatives, ...(tentative ? { tentative: true } : {}) }
}

export const semanticExpedition = (entry) => ({
  flagLv: entry.flagLv, fleetLv: entry.fleetLv, minShips: entry.minShips,
  monthly: entry.monthly,
  // 列表显示交战档位，不能把 II 型差异只按「非空」吞掉。
  combat: entry.combat?.replace(/月常\s*/g, '') ?? null,
  stats: entry.stats ?? {}, drumTotal: entry.drumTotal ?? null, drumShips: entry.drumShips ?? null,
  compositionBranches: branchMeaning(entry.compositionBranches ?? parseCompositionBranches(entry.composition ?? '', entry.escortText)),
  greatSuccess: entry.greatSuccess ?? greatMeaning(entry.greatNote),
  rewards: Object.fromEntries(Object.entries(entry.rewards).map(([key, value]) => [key,
    key === 'items' || key === 'greatItems'
      ? value.map(({ name, count }) => ({ name: itemName(name), count }))
      : ['fuel', 'ammo', 'steel', 'baux'].includes(key) && !value?.[0] ? null : value,
  ])),
})

export const oldDevelopmentEntry = (kcwiki, wikiwiki) => ({
  ...kcwiki, ...wikiwiki, nameZh: kcwiki.nameZh,
  composition: wikiwiki.composition ?? kcwiki.composition ?? null,
  escortText: wikiwiki.rawComposition ?? kcwiki.escortText ?? null,
})

// 数组是一格（顺序与分组会被消费），对象按叶字段逐格。
export const diffCells = (a, b, prefix = '') => {
  const result = []
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const av = a?.[key] ?? null, bv = b?.[key] ?? null
    const field = prefix ? `${prefix}.${key}` : key
    if (equal(av, bv)) continue
    if (field !== 'greatSuccess' && (av || bv) && (!av || typeof av === 'object') && (!bv || typeof bv === 'object') && !Array.isArray(av) && !Array.isArray(bv)) {
      result.push(...diffCells(av, bv, field))
    } else result.push({ field, kcwiki: av, wikiwiki: bv })
  }
  return result
}
