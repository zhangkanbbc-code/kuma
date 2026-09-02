import type { BattleShipView } from './mg-types'

/**
 * 敌舰是否真的被击沉。
 *
 * 对潜空袭的后方空母没有 HP：报文给的是字符串 `"N/A"`，battle.ts 的数值兜底会让
 * 它落成 hpEnd=0；与此同时，解析层会按 mg-types.ts:295 的 BattleShipView 语义挂上
 * unattackable=true，且 sunk 保持 false。凡是消费“击沉”语义的地方都必须走这两个
 * 已归一化字段，不能再从 hpEnd<=0 反推。
 */
export const isEnemyReallySunk = (
  ship: Pick<BattleShipView, 'sunk' | 'unattackable'>,
): boolean => ship.sunk === true && ship.unattackable !== true
