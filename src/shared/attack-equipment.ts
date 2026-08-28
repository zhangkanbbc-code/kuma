// api_si_list（本次攻击使用的装备）能不能信。
import { isSubmarineStype } from './kcs-domain'

/**
 * 对潜攻击时 api_si_list 给的是**无关装备**，不能当「这次用的武器」展示。
 *
 * 实测 2026-08-09（玩家账本 battle_snapshots #231 / #216，敌方三只潜水カ級）：
 * 五次对潜攻击里，si_list 给的全是电探——506 電探装備マスト、315 SG レーダー、
 * 88 22号対水上電探改四，三张都是 type2=12 小型電探，对反潜零作用；
 * 另有两次直接是空的。而**同一批数据**里对水面舰（駆逐ラ級ζ-壊）的炮击，
 * si_list 给的是 122/266/280/398/2，全是主炮，完全合理。
 *
 * 也就是说这个字段只在打水面目标时有意义。打潜艇时照着显示，等于把噪音
 * 当成事实告诉玩家——宁可什么都不说。
 *
 * @param targetStype 被攻击方的舰种；取不到时按「可信」处理，不误伤正常炮击
 */
export const attackEquipmentReliable = (targetStype: number | null | undefined): boolean =>
  !(typeof targetStype === 'number' && Number.isFinite(targetStype) && isSubmarineStype(targetStype))
