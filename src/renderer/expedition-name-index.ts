import type { TaskEntityIndex } from './task-entity-match'

export interface TaskExpeditionMission {
  api_id: number
  api_disp_no: string
  api_name: string
}

export interface TaskExpeditionLocalizedName {
  nameJp?: string
  nameZh?: string
}

export type TaskExpeditionNameIndexEntry = TaskEntityIndex

/**
 * 主数据 api_mst_mission.api_disp_no 是 `"01"`…`"09"`（带前导零）、`"A1"`、`"S1"` 这类字符串，
 * 而 kcwiki-expedition 包的键是 `"1"`…`"9"`、`"A1"`；直接查包会让远征 1–9 的中文别名整段缺失（09-04 勘出）。
 * 索引构建与 qn.ts 的 expeditionDisplayName 共用这一把钥匙，别再各写一份正则。
 */
export const normalizeExpeditionDispNo = (value: unknown): string =>
  `${value ?? ''}`.replace(/^0+(?=\d)/, '')

/**
 * 必须先登记译名再取 localizedName，因为 localizedName 会从译名表读取刚登记的条目。
 * 包里没有的 dispNo（现状只有 S1/S2）保留原名，不回退、不伪造。
 */
export const buildTaskExpeditionNameIndex = (
  missions: readonly TaskExpeditionMission[] | null | undefined,
  expeditionLodeData: Readonly<Record<string, TaskExpeditionLocalizedName>> | null | undefined,
  localizedName: (mission: TaskExpeditionMission) => string,
  registerTranslation: (mission: TaskExpeditionMission, nameZh: string) => void,
  normalize: (text: string) => string,
): TaskExpeditionNameIndexEntry[] =>
  (missions ?? []).map((mission) => {
    const dispNo = normalizeExpeditionDispNo(mission.api_disp_no)
    const localized = expeditionLodeData?.[dispNo]
    if (localized?.nameZh) registerTranslation(mission, localized.nameZh)
    const aliases = [...new Set([
      mission.api_name,
      localizedName(mission),
      dispNo,
      `${localized?.nameJp ?? ''}`,
      `${localized?.nameZh ?? ''}`,
    ].map(normalize).filter(Boolean))]
      .sort((left, right) => right.length - left.length)
    return {
      id: mission.api_id,
      name: localizedName(mission),
      simple: aliases[0] ?? normalize(mission.api_name),
      aliases,
    }
  })
