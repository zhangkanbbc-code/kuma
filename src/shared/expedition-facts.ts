import type { CompBranch } from './expedition-composition'

/** 大成功只供说明；不得作为普通成功门槛。 */
export interface ExpeditionGreatSuccess {
  alternatives: { kira: number; flagLv?: number; drumTotal?: number }[]
  tentative?: boolean
}

export interface ExpeditionFacts {
  stats?: Record<string, number>
  drumTotal?: number
  compositionBranches?: CompBranch[]
  greatSuccess?: ExpeditionGreatSuccess
  rewards?: Partial<Record<'fuel' | 'ammo' | 'steel' | 'baux', [number, number]>> & { shipExp?: number }
}

// 沿用 kcwiki 已有的中文说明句式，日文 greatNote 不进入运行时。
export const expeditionGreatNote = (condition: ExpeditionGreatSuccess): string =>
  `大成功要${condition.alternatives.map((part) => [
    part.flagLv ? `旗舰${part.flagLv}级以上` : '',
    part.drumTotal ? `${part.drumTotal}桶以上` : '',
    `${part.kira}闪`,
  ].filter(Boolean).join('+')).join('或')}${condition.tentative ? '（待验证）' : ''}`

/** kcwiki 底层 → 第一方事实层；嵌套属性只覆盖登记过的格。 */
export const mergeExpeditionFacts = (base: any, facts?: ExpeditionFacts | null): any => {
  if (!base) return null
  if (!facts) return base
  return {
    ...base,
    ...facts,
    nameZh: base.nameZh,
    ...(facts.stats ? { stats: { ...base.stats, ...facts.stats } } : {}),
    ...(facts.rewards ? { rewards: { ...base.rewards, ...facts.rewards } } : {}),
    ...(facts.greatSuccess ? { greatNote: expeditionGreatNote(facts.greatSuccess) } : {}),
  }
}
