// 夜战攻击力的纯计算层。
//
// 口径来自 wikiwiki「夜戦」与「戦闘について」（2026-08-08 核对，逐条抄录）：
//
//   · 基本攻撃力 = 装備込み火力 + 装備込み雷装 + 改修強化値(夜戦) + 夜間触接定数(+5/+7/+9)
//     ——注意昼战炮击有个 +5 常数，夜战**没有**，别顺手抄过来。
//   · キャップ 360（2021-03-01 由 300 上调）。昼战 砲撃 220 / 雷撃 180 / 対潜 170，
//     这三个数与本仓库昼战模型现用值一致，同页核对过。
//   · 「陣形補正、交戦形態補正は原則受けません」——唯一例外：
//     「※警戒陣のみ主力艦の威力が半減(0.5倍)する。警戒陣の警戒艦やそれ以外の陣形は影響無し」。
//   · 「連合艦隊の第1艦隊は夜戦に参加しない」。
//   · 「大破状態の場合」攻撃できない。
//   · 「火力と雷装の初期値がともに0の艦娘は夜戦攻撃が行えない」——即空母。
//     夜戦空母（Saratoga Mk.II、赤城改二戊 等）要靠单舰白名单 + 夜間作戦航空要員 + 夜間飛行機
//     三者共同判定，本层没有这些字段，因此**一律不让空母夜战**。宁可少算。
//
// 本层刻意**不**假定夜战 CI 发动：主主／魚魚／魚見魚 等的发动率取决于运、探照灯、照明弹、
// 旗舰位置与损伤，方差极大。跟昼战特殊攻击同一条纪律——不套一个 1.2~1.75 上去冒充确定值。
// 夜間触接（+5/+7/+9）同理，要判敌方制空与夜偵搭载，也不假定。两者都写进说明栏，不偷偷少算。

import { CARRIER_STYPES } from './kcs-domain'

/** 夜战火力上限。2021-03-01 由 300 上调至 360。 */
export const NIGHT_CAP = 360

/** 警戒阵（api_formation 6）里主力舰夜战威力减半——夜战唯一的阵形补正。 */
export const GUARD_FORMATION = 6
export const GUARD_MAIN_PENALTY = 0.5

export interface NightEquip {
  type2: number
  level: number
}

export interface NightShip {
  role: 'main' | 'escort'
  stype: number
  hp: number
  hpMax: number
  /** 装备込み火力（最终面板） */
  firepower: number
  /** 装备込み雷装（最终面板） */
  torpedo: number
  equipment: readonly NightEquip[]
}

/**
 * 夜战改修强化值。
 *
 * 与昼战的差别只有一处但很关键：**声呐/爆雷不参与夜战炮击**（它们是对潜装备），
 * 而探照灯参与。照抄昼战那张表会把带满声呐的驱逐虚报一截。
 */
export const nightImprovement = (item: NightEquip): number => {
  if (!(item.level > 0)) return 0
  const root = Math.sqrt(item.level)
  // 小口径/中口径/大口径主砲、副砲、三式弾、徹甲弾、高射装置、探照灯
  if ([1, 2, 3, 4, 18, 19, 21, 29].includes(item.type2)) return root
  // 魚雷、潜水艦魚雷
  if ([5, 22, 32].includes(item.type2)) return 1.2 * root
  return 0
}

export type NightBlockReason =
  /** 大破：游戏规则禁止夜战攻击 */
  | 'taiha'
  /** 空母：火力与雷装初期值均为 0；夜战空母本模型不建 */
  | 'carrier'
  /** 联合舰队第一舰队不参加夜战 */
  | 'mainOfCombined'
  /** 火力与雷装都是 0，打不出任何攻击 */
  | 'noPower'

/**
 * 该舰这一夜能不能出手。返回 null = 能出手；否则返回**具体拦下它的规则**，
 * 好让界面说得出「12 舰里有 6 舰不参加夜战，因为它们是联合舰队第一舰队」。
 */
export const nightAttackBlock = (
  ship: NightShip,
  combinedType: number,
): NightBlockReason | null => {
  if (ship.hp <= Math.floor(ship.hpMax * 0.25)) return 'taiha'
  if (combinedType > 0 && ship.role !== 'escort') return 'mainOfCombined'
  // 用 stype 判空母，不能用最终面板判：挂了舰攻的空母面板雷装是正数，
  // 按面板判会把它放进夜战。舰种集合走 kcs-domain 那一份，就地再抄一遍
  // 正是那个文件开头说的「改漏一处就出现两套结论」。
  if (CARRIER_STYPES.has(ship.stype)) return 'carrier'
  if (ship.firepower + ship.torpedo <= 0) return 'noPower'
  return null
}

/** 基本攻击力：装备込み火力 + 装备込み雷装 + 改修强化值。**没有 +5 常数。** */
export const nightBasePower = (ship: NightShip): number =>
  ship.firepower +
  ship.torpedo +
  ship.equipment.reduce((sum, item) => sum + nightImprovement(item), 0)

/**
 * 过 cap 后的夜战攻击力。
 *
 * `preCap` 给对地补正用——它按定义就是「阈值前补正」，必须乘在 cap 之前，
 * 乘在外面等于当成 cap 后补正，会把超上限的部分漏掉那次开方压缩。
 */
export const nightPower = (
  ship: NightShip,
  formation: number,
  preCap = 1,
): number => {
  const guard =
    formation === GUARD_FORMATION && ship.role !== 'escort' ? GUARD_MAIN_PENALTY : 1
  const raw = nightBasePower(ship) * guard * preCap
  return raw <= NIGHT_CAP ? raw : NIGHT_CAP + Math.sqrt(raw - NIGHT_CAP)
}
