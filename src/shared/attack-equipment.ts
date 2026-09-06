// api_si_list（本次攻击使用的装备）能不能信。
import { isSubmarineStype } from './kcs-domain'

/**
 * 对潜攻击时 api_si_list 给的是**无关装备**，不能当「这次用的武器」展示。
 *
 * 游戏战斗报文核对（维护者核 2026-08-09）：对潜时可能返回 type2=12 电探或空列表，
 * 不能据此认定攻击装备；对水面炮击的列表可用于展示。
 *
 * 也就是说这个字段只在打水面目标时有意义。打潜艇时照着显示，等于把噪音
 * 当成事实告诉玩家——宁可什么都不说。
 *
 * @param targetStype 被攻击方的舰种；取不到时按「可信」处理，不误伤正常炮击
 */
export const attackEquipmentReliable = (targetStype: number | null | undefined): boolean =>
  !(typeof targetStype === 'number' && Number.isFinite(targetStype) && isSubmarineStype(targetStype))
