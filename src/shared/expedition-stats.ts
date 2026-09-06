import { HIGH_ANGLE_ICON } from './equip-high-angle'

export type ExpeditionStatKey =
  | 'firepower'
  | 'antiAir'
  | 'antiSubmarine'
  | 'lineOfSight'

export type ExpeditionStatValues = Record<ExpeditionStatKey, number>

export interface ExpeditionStatEquipment {
  type2: number
  iconId: number
  airborne: boolean
  stats: ExpeditionStatValues
  star: number
}

export interface ExpeditionStatShip {
  stats: ExpeditionStatValues
  equipment: ExpeditionStatEquipment[]
}

export type ExpeditionStatVerdict = 'ok' | 'wait' | 'no'

export interface ExpeditionStatResult {
  sure: number
  face: number
  verdict: ExpeditionStatVerdict
  basis?: true
}

export type ExpeditionStatRequirements = Partial<Record<ExpeditionStatKey, number>>
export type ExpeditionStatsResult = Partial<Record<ExpeditionStatKey, ExpeditionStatResult>>

const oneDecimal = (value: number): number => Math.round(value * 10) / 10
const ANTI_SUBMARINE_IMPROVEMENT_TYPES = new Set([14, 15, 40])

const improvementBonus = (
  key: ExpeditionStatKey,
  equipment: ExpeditionStatEquipment,
): number => {
  if (!(equipment.star > 0)) return 0
  const root = Math.sqrt(equipment.star)
  if (key === 'firepower') {
    if ([1, 4, 12, 13].includes(equipment.type2)) return 0.5 * root
    if ([2, 3].includes(equipment.type2)) return root
  }
  if (
    key === 'antiAir' &&
    (equipment.iconId === HIGH_ANGLE_ICON || equipment.type2 === 21)
  ) {
    return root
  }
  if (
    key === 'antiSubmarine' &&
    ANTI_SUBMARINE_IMPROVEMENT_TYPES.has(equipment.type2)
  ) {
    return root
  }
  return 0
}

/**
 * 远征属性按游戏判定口径给出保守下限：
 * - `face` 是四项游戏显示值的舰队合计；
 * - 火力保留舰载机面值；对空/索敌扣掉舰载机面值；
 * - 对潜舰载机按单槽 `⌊素值 × 0.65⌋`，搭载数与熟练度的正向补正暂不预支；
 * - 改修★按 wiki 的 `系数 × √★` 计入：火力小口径/副炮/电探 0.5，
 *   中/大口径 1.0；对空高角炮/机枪、对潜声呐/大型声呐/爆雷均为 1.0；
 * - 每舰合算后保留一位小数再求和，比较时不取整。
 * 只有下限达到要求才判定为满足；仅面值达到要求时返回 `wait`。
 */
export const evaluateExpeditionStats = (
  ships: ExpeditionStatShip[],
  requirements: ExpeditionStatRequirements,
): ExpeditionStatsResult => {
  const result: ExpeditionStatsResult = {}
  for (const [key, requirement] of Object.entries(requirements) as [
    ExpeditionStatKey,
    number,
  ][]) {
    const face = ships.reduce((sum, ship) => sum + ship.stats[key], 0)
    let usesImprovement = false
    const sure = ships.reduce((sum, ship) => {
      let value = ship.stats[key]
      for (const equipment of ship.equipment) {
        const bonus = improvementBonus(key, equipment)
        value += bonus
        if (bonus !== 0) usesImprovement = true
      }
      if (key === 'antiSubmarine') {
        for (const equipment of ship.equipment) {
          if (equipment.airborne) {
            const raw = equipment.stats.antiSubmarine
            value += Math.floor(raw * 0.65) - raw
          }
        }
      } else if (key === 'antiAir' || key === 'lineOfSight') {
        for (const equipment of ship.equipment) {
          if (equipment.airborne) value -= equipment.stats[key]
        }
      }
      return sum + oneDecimal(value)
    }, 0)
    const sureValue = oneDecimal(sure)
    result[key] = {
      sure: sureValue,
      face,
      verdict: sure >= requirement ? 'ok' : face >= requirement ? 'wait' : 'no',
      ...(sureValue !== face || usesImprovement ? { basis: true } : {}),
    }
  }
  return result
}
