import { MAIN_GUN_TYPES } from './equip-main-gun'
import type { MasterSlotitem } from './mg-types'

export const FAIRY_SALVO_CONFIG_KEY = 'kuma.fx.fairySalvo'
export const FAIRY_MIRROR_UI_KEY = 'fx.fairyMirror'
export const FAIRY_SALVO_DEFAULT = false
// 逐张看图才能填，玩家用镜像钮自己纠；不凭装备名猜方向。
export const FAIRY_FACES_LEFT: ReadonlySet<number> = new Set<number>()

/** 边界先把装备实例 id 解成 mst id；这里按格序选炮，不依赖渲染层状态。 */
export const salvoGunsOf = (
  flagship: { slot: readonly number[] } | null | undefined,
  master: { slotitems: Record<number, Pick<MasterSlotitem, 'type2'>> },
): number[] => [...new Set((flagship?.slot ?? []).filter(
  (id) => MAIN_GUN_TYPES.includes(master.slotitems[id]?.type2),
))].slice(0, 4)

export const fairyMirrored = (equipMstId: number, overrides: readonly number[]): boolean =>
  FAIRY_FACES_LEFT.has(equipMstId) || overrides.includes(equipMstId)

export const salvoAllowed = ({ enabled, distract, visible, reducedMotion, practice }: {
  enabled: boolean; distract: boolean; visible: boolean; reducedMotion: boolean; practice: boolean
}): boolean => enabled && !distract && visible && !reducedMotion && !practice

export interface SpecialAttackFired {
  mstId: number
  voiceId: number
  pathname: string
  ts: number
}
