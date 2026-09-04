import type { FitBonusData } from '../shared/fit-bonus'
import { simplifyZh } from './zh-simplify'

type DataTable = Record<string, any>

const simplifyText = (value: unknown): unknown =>
  typeof value === 'string' ? simplifyZh(value) : value

// 繁→简只在玩家可见资料的装配期做一次，上游包保持原样；日文列一律不过转换。
export const simplifyLocalizationEntities = (entities: unknown): DataTable => {
  if (!entities || typeof entities !== 'object' || Array.isArray(entities)) return {}
  const normalized: DataTable = {}
  for (const [domain, rawTable] of Object.entries(entities)) {
    if (!rawTable || typeof rawTable !== 'object' || Array.isArray(rawTable)) continue
    normalized[domain] = Object.fromEntries(
      Object.entries(rawTable).map(([id, raw]) => [
        id,
        raw && typeof raw === 'object'
          ? { ...raw, zh: simplifyText((raw as any).zh) }
          : raw,
      ]),
    )
  }
  return normalized
}

export const simplifyQuestScnData = (data: unknown): DataTable => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(
    Object.entries(data).map(([id, raw]) => {
      if (!raw || typeof raw !== 'object') return [id, raw]
      return [
        id,
        {
          ...raw,
          name: simplifyText((raw as any).name),
          desc: simplifyText((raw as any).desc),
          memo: simplifyText((raw as any).memo),
          memo2: simplifyText((raw as any).memo2),
        },
      ]
    }),
  )
}

export const simplifyKcwikiExpeditionData = (data: unknown): DataTable => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(
    Object.entries(data).map(([id, raw]) => {
      if (!raw || typeof raw !== 'object') return [id, raw]
      const row = raw as any
      const rewards = row.rewards && typeof row.rewards === 'object'
        ? {
            ...row.rewards,
            items: Array.isArray(row.rewards.items)
              ? row.rewards.items.map((item: any) => ({
                  ...item,
                  name: simplifyText(item?.name),
                }))
              : row.rewards.items,
            greatItems: Array.isArray(row.rewards.greatItems)
              ? row.rewards.greatItems.map((item: any) => ({
                  ...item,
                  name: simplifyText(item?.name),
                }))
              : row.rewards.greatItems,
          }
        : row.rewards
      return [
        id,
        {
          ...row,
          nameZh: simplifyText(row.nameZh),
          composition: simplifyText(row.composition),
          escortText: simplifyText(row.escortText),
          greatNote: simplifyText(row.greatNote),
          combat: simplifyText(row.combat),
          tags: Array.isArray(row.tags) ? row.tags.map(simplifyText) : row.tags,
          rewards,
        },
      ]
    }),
  )
}

export const simplifyKcwikiShipsData = (data: unknown): DataTable => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  return Object.fromEntries(
    Object.entries(data).map(([id, raw]) => {
      if (!raw || typeof raw !== 'object') return [id, raw]
      const row = raw as any
      const shipClass = Array.isArray(row.级别)
        ? [simplifyText(row.级别[0]), ...row.级别.slice(1)]
        : row.级别
      const remodel = row.改造 && typeof row.改造 === 'object'
        ? { ...row.改造, 图纸: simplifyText(row.改造.图纸) }
        : row.改造
      return [
        id,
        {
          ...row,
          中文名: simplifyText(row.中文名),
          级别: shipClass,
          改造: remodel,
        },
      ]
    }),
  )
}

export const simplifyFitBonusData = (data: FitBonusData): FitBonusData => ({
  ...data,
  equipGroups: Object.fromEntries(
    Object.entries(data.equipGroups).map(([id, group]) => [
      id,
      { ...group, zh: simplifyZh(group.zh) },
    ]),
  ),
  equips: Object.fromEntries(
    Object.entries(data.equips).map(([id, equip]) => [
      id,
      { ...equip, nameZh: simplifyZh(equip.nameZh) },
    ]),
  ),
})
