import type { MasterMission } from '../shared/mg-types'
import { entityNamePlain } from './localization'
import { normalizeExpeditionDispNo } from './expedition-name-index'

/**
 * 显示编号保留主数据原文；包键的来历见 expedition-name-index.ts 中
 * normalizeExpeditionDispNo 的头注。第二把 api id 键来自任务实体索引登记，
 * 见 qn.ts 的 expeditionDisplayName 头注；两键均无译名时才保留原名。
 */
export const expeditionLabel = (
  missionMstId: number,
  missions: Readonly<Record<number, Pick<MasterMission, 'dispNo' | 'name'>>>,
): string => {
  const mission = missions[missionMstId]
  if (!mission) return `远征 ${missionMstId}`
  const name = entityNamePlain('expedition', normalizeExpeditionDispNo(mission.dispNo), '') ||
    entityNamePlain('expedition', missionMstId, '') || mission.name
  return `${mission.dispNo} ${name}`
}
