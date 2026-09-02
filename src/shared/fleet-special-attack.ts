import { BATTLESHIP_STYPES, CARRIER_STYPES, SUBMARINE_STYPES } from './kcs-domain'

export type FleetSpecialAttackRole =
  | 'normal'
  | 'strike'
  | 'combined-main'
  | 'combined-escort'

export interface FleetSpecialAttackEquip {
  /** 装备类别（api_type[2]） */
  type2: number
  /** 装备命中（api_houm） */
  houm: number
  /** 装备索敌（api_saku） */
  saku: number
  /** 大型探照灯（type2=42） */
  largeSearchlight: boolean
  /** 水上电探（小型／大型电探且索敌≥5） */
  surfaceRadar: boolean
}

export interface FleetSpecialAttackShip {
  name: string
  stype: number
  lv: number
  luck: number
  hp: number
  hpMax: number
  equipment: readonly FleetSpecialAttackEquip[]
}

export interface FleetSpecialAttackInput {
  role: FleetSpecialAttackRole
  ships: readonly FleetSpecialAttackShip[]
}

export interface FleetSpecialAttack {
  ci: number
  label: string
  phase: 'day' | 'night'
  formation: string
  detail: string
}

// 战斗解析和母港编队提示共用同一份名称，避免同一个 api_cl_list 在两处口径不同。
const COMMON_SPECIAL_ATTACK_LABEL: Readonly<Record<number, string>> = {
  100: 'Nelson Touch',
  101: '长门齐射',
  102: '陆奥齐射',
  103: 'Colorado齐射',
  105: 'Richelieu协同齐射',
  106: '姊妹舰协同炮击',
  300: '潜水舰队攻击 2-3',
  301: '潜水舰队攻击 3-4',
  302: '潜水舰队攻击 2-4',
  400: '大和三舰齐射',
  401: '大和两舰齐射',
  1000: '四式特殊攻击',
}

const DAY_ONLY_SPECIAL_ATTACK_LABEL: Readonly<Record<number, string>> = {
  200: '瑞云立体攻击',
  201: '海空立体攻击',
}

const NIGHT_ONLY_SPECIAL_ATTACK_LABEL: Readonly<Record<number, string>> = {
  104: '僚舰夜战突击',
  200: '瑞云夜袭',
}

export const specialAttackLabel = (ci: number, phase: 'day' | 'night'): string | undefined =>
  COMMON_SPECIAL_ATTACK_LABEL[ci] ??
  (phase === 'night' ? NIGHT_ONLY_SPECIAL_ATTACK_LABEL[ci] : DAY_ONLY_SPECIAL_ATTACK_LABEL[ci])

/**
 * 特殊攻击的**分段表**：一次特攻在报文里是**一个攻击单元携带多段伤害**
 * （`api_damage[i]` 是个数组），每一段实际由谁打出来则由这张表给的舰位偏移决定
 * ——「大和两舰齐射」的 `[0, 0, 1]` 就是「发动舰打两段、下一位僚舰打一段」。
 *
 * 两处消费者，共用这一份免得口径分家：
 * - 解析层照它把一个单元摊成逐段记录（`main/mg/battle.ts` 的 `applyHougeki`）；
 * - 显示层反过来照它把摊开的连续几段收回一组（`renderer/modules/di.ts` 的战斗流水）。
 *
 * **表里没有的 ci 不等于不是特攻**：没登记的（如 201 海空立体攻击）解析层不摊，
 * 多段伤害留在同一条记录里。所以显示层拿它当「一组最多几段」的上限用，
 * 没登记就按 1 段算，而不是拿它判「这是不是特殊攻击」——那是 specialAttackLabel 的活。
 */
export const SPECIAL_ATTACK_SEGMENT_ORDER: Readonly<Record<number, readonly number[]>> = {
  100: [0, 2, 4], // Nelson Touch
  101: [0, 0, 1], // 长门
  102: [0, 0, 1], // 陆奥
  103: [0, 1, 2], // Colorado
  104: [0, 1], // 金刚级夜战突击
  105: [0, 0, 1], // Richelieu
  106: [0, 0, 1], // Queen Elizabeth
  200: [0, 0], // 瑞云夜袭
  300: [1, 1, 2, 2], // 潜水舰队：段数不固定，见 specialAttackSegmentOrder
  301: [2, 2, 3, 3],
  302: [1, 1, 3, 3],
  400: [0, 1, 2], // 大和型三舰
  401: [0, 0, 1], // 大和型两舰
  1000: [0, 0, 0, 0, 0, 0],
}

/**
 * 潜水舰队攻击（300/301/302）一次发动是 **2～4 段**：两条参战潜艇各先打一次，
 * 各自还可能再打第二次。只有两段时是「两条各打一次」，照上面那张四段表原样
 * 截前两位会把第二条的那一击也记到第一条头上——逐舰伤害、MVP、击沉归属跟着一起错。
 *
 * 两票：
 * - KC3Kai `BattlePrediction/phases/Hougeki.js` 对这三个号写的就是
 *   `damages.length <= 2 ? [1, 2] : [1, 1, 2, 2]`（301/302 同构）；
 * - 同项目的 kancolle-replay `js/kcsim.js` `getSpecialAttackShips` 把出手顺序摊成
 *   `[潜A, (潜A), 潜B, (潜B)]`，两个可选段各自按等级/潜水舰电探/概率决定发不发。
 *
 * **三段这一档两边都判不出来**：KC3 在同一处注明「no proper way to predict 3 hits
 * torpedo attacks have merged 2 hits from which submarine」，所以三段沿用四段表的前三位，
 * 不另立说法。
 */
const SUBMARINE_TWO_SEGMENT_ORDER: Readonly<Record<number, readonly number[]>> = {
  300: [1, 2],
  301: [2, 3],
  302: [1, 3],
}

/** 按这一次实际摊出的段数取分段表；只有潜水舰队攻击的两段档与上表不同。 */
export const specialAttackSegmentOrder = (
  ci: number,
  segments: number,
): readonly number[] | undefined =>
  (segments <= 2 ? SUBMARINE_TWO_SEGMENT_ORDER[ci] : undefined) ?? SPECIAL_ATTACK_SEGMENT_ORDER[ci]

const nameOf = (ship: FleetSpecialAttackShip | undefined): string =>
  ship?.name.replace(/\s+/g, ' ').trim() ?? ''

const isSubmarine = (ship: FleetSpecialAttackShip | undefined): boolean =>
  !!ship && SUBMARINE_STYPES.has(ship.stype)
const isCarrier = (ship: FleetSpecialAttackShip | undefined): boolean =>
  !!ship && CARRIER_STYPES.has(ship.stype)
const isBattleship = (ship: FleetSpecialAttackShip | undefined): boolean =>
  !!ship && BATTLESHIP_STYPES.has(ship.stype)

const surfaceCount = (ships: readonly FleetSpecialAttackShip[]): number =>
  ships.filter((ship) => !isSubmarine(ship)).length

const mainFleetReady = (input: FleetSpecialAttackInput): boolean => {
  if (input.role === 'combined-escort') return false
  if (input.role === 'strike') return input.ships.length >= 6 && surfaceCount(input.ships) >= 6
  return input.ships.length === 6 && surfaceCount(input.ships) === 6
}

const MAIN_FLEET_DETAIL =
  '仅核对母港可确认的编成条件；实际发动还取决于阵形、损伤、战斗类型、剩余次数与发动率'

const formationFor = (
  input: FleetSpecialAttackInput,
  normal: string,
  combined: string,
): string => input.role === 'combined-main' || input.role === 'combined-escort' ? combined : normal

const NELSON_FLAGS = new Set(['Nelson', 'Nelson改', 'Rodney', 'Rodney改'])
const NAGATO_FLAGS = new Set(['長門改二', '陸奥改二'])
const COLORADO_FLAGS = new Set(['Colorado', 'Colorado改', 'Maryland', 'Maryland改'])
const RICHELIEU_PAIR = new Set(['Richelieu改', 'Richelieu Deux', 'Jean Bart改'])
const QUEEN_ELIZABETH_PAIR = new Set(['Warspite改', 'Valiant改'])
const YAMATO_FLAGS = new Set(['大和改二', '大和改二重'])
const YAMATO_CLASS_PAIR = new Set(['大和改二', '大和改二重', '武蔵改二'])
const YAMATO_TWO_SHIP_PARTNERS = new Set([
  '武蔵改二',
  'Iowa改',
  'Bismarck drei',
  'Richelieu改',
  'Richelieu Deux',
  'Jean Bart改',
])

const unorderedPair = (left: string, right: string, a: string, b: string): boolean =>
  (left === a && right === b) || (left === b && right === a)

const yamatoThreeShipPair = (second: string, third: string): boolean => {
  if (
    second === '武蔵改二' &&
    (third === '長門改二' || third === '陸奥改二')
  ) {
    return true
  }
  return [
    ['長門改二', '陸奥改二'],
    ['伊勢改二', '日向改二'],
    ['扶桑改二', '山城改二'],
    ['Italia', 'Roma改'],
    ['Warspite改', 'Nelson改'],
    ['Warspite改', 'Valiant改'],
    ['Nelson改', 'Rodney改'],
    ['Washington改', 'South Dakota改'],
    ['Colorado改', 'Maryland改'],
  ].some(([a, b]) => unorderedPair(second, third, a, b)) ||
    (
      unorderedPair(second, third, 'Richelieu改', 'Jean Bart改') ||
      unorderedPair(second, third, 'Richelieu Deux', 'Jean Bart改')
    ) ||
    unorderedPair(second, third, '金剛改二丙', '比叡改二丙') ||
    unorderedPair(second, third, '金剛改二丙', '榛名改二乙') ||
    unorderedPair(second, third, '金剛改二丙', '榛名改二丙') ||
    unorderedPair(second, third, '金剛改二丙', '霧島改二丙') ||
    unorderedPair(second, third, '比叡改二丙', '霧島改二丙')
}

const KONGO_PARTNERS: Readonly<Record<string, ReadonlySet<string>>> = {
  金剛改二丙: new Set([
    '比叡改二丙',
    '霧島改二丙',
    '榛名改二',
    '榛名改二乙',
    '榛名改二丙',
    'Warspite',
    'Warspite改',
    'Valiant',
    'Valiant改',
  ]),
  比叡改二丙: new Set([
    '金剛改二丙',
    '榛名改二乙',
    '榛名改二丙',
    '霧島改二',
    '霧島改二丙',
  ]),
  榛名改二乙: new Set(['金剛改二丙', '比叡改二丙', '霧島改二丙']),
  榛名改二丙: new Set(['金剛改二丙', '比叡改二丙', '霧島改二丙']),
  霧島改二丙: new Set([
    '金剛改二丙',
    '比叡改二丙',
    '榛名改二乙',
    '榛名改二丙',
    'South Dakota改',
  ]),
}
const SUBMARINE_TENDER_FLAGS = new Set([
  '大鯨',
  '迅鯨',
  '迅鯨改',
  '長鯨',
  '長鯨改',
  '平安丸',
  '平安丸改',
])

const mainSpecialAttack = (input: FleetSpecialAttackInput): FleetSpecialAttack[] => {
  if (!mainFleetReady(input)) return []
  const [flag, second, third, , fifth] = input.ships
  const flagName = nameOf(flag)
  const secondName = nameOf(second)
  const thirdName = nameOf(third)

  if (
    NELSON_FLAGS.has(flagName) &&
    second &&
    third &&
    fifth &&
    !isCarrier(third) &&
    !isSubmarine(third) &&
    !isCarrier(fifth) &&
    !isSubmarine(fifth)
  ) {
    return [{
      ci: 100,
      label: specialAttackLabel(100, 'day')!,
      phase: 'day',
      formation: formationFor(input, '复纵阵', '第二警戒航行序列'),
      detail: `3、5号位为非空母水上舰 · ${MAIN_FLEET_DETAIL}`,
    }]
  }

  if (NAGATO_FLAGS.has(flagName) && isBattleship(second)) {
    const ci = flagName === '長門改二' ? 101 : 102
    return [{
      ci,
      label: specialAttackLabel(ci, 'day')!,
      phase: 'day',
      formation: formationFor(input, '梯形阵', '第二警戒航行序列'),
      detail: `2号位为战舰 · ${MAIN_FLEET_DETAIL}`,
    }]
  }

  if (
    COLORADO_FLAGS.has(flagName) &&
    isBattleship(second) &&
    isBattleship(third)
  ) {
    return [{
      ci: 103,
      label: specialAttackLabel(103, 'day')!,
      phase: 'day',
      formation: formationFor(input, '梯形阵', '第二警戒航行序列'),
      detail: `2、3号位为战舰 · ${MAIN_FLEET_DETAIL}`,
    }]
  }

  if (RICHELIEU_PAIR.has(flagName) && RICHELIEU_PAIR.has(secondName)) {
    return [{
      ci: 105,
      label: specialAttackLabel(105, 'day')!,
      phase: 'day',
      formation: formationFor(input, '复纵阵', '第二警戒航行序列'),
      detail: `前两舰为 Richelieu改／Deux 或 Jean Bart改 · ${MAIN_FLEET_DETAIL}`,
    }]
  }

  if (QUEEN_ELIZABETH_PAIR.has(flagName) && QUEEN_ELIZABETH_PAIR.has(secondName)) {
    return [{
      ci: 106,
      label: specialAttackLabel(106, 'day')!,
      phase: 'day',
      formation: formationFor(input, '梯形阵', '第二警戒航行序列'),
      detail: `前两舰为 Warspite改／Valiant改 · ${MAIN_FLEET_DETAIL}`,
    }]
  }

  const attacks: FleetSpecialAttack[] = []
  if (YAMATO_FLAGS.has(flagName)) {
    if (yamatoThreeShipPair(secondName, thirdName)) {
      attacks.push({
        ci: 400,
        label: specialAttackLabel(400, 'day')!,
        phase: 'day',
        formation: formationFor(input, '梯形阵', '第四警戒航行序列'),
        detail: `2、3号位组成指定战舰组合 · ${MAIN_FLEET_DETAIL}`,
      })
    }
    if (YAMATO_TWO_SHIP_PARTNERS.has(secondName)) {
      attacks.push({
        ci: 401,
        label: specialAttackLabel(401, 'day')!,
        phase: 'day',
        formation: formationFor(input, '梯形阵', '第四警戒航行序列'),
        detail: `2号位为指定战舰 · ${MAIN_FLEET_DETAIL}`,
      })
    }
  } else if (
    flagName === '武蔵改二' &&
    YAMATO_CLASS_PAIR.has(secondName) &&
    secondName !== '武蔵改二'
  ) {
    attacks.push({
      ci: 401,
      label: specialAttackLabel(401, 'day')!,
      phase: 'day',
      formation: formationFor(input, '梯形阵', '第四警戒航行序列'),
      detail: `前两舰为大和型改二组合 · ${MAIN_FLEET_DETAIL}`,
    })
  }
  return attacks
}

const kongoNightAttack = (input: FleetSpecialAttackInput): FleetSpecialAttack[] => {
  if (input.role === 'combined-main' || surfaceCount(input.ships) < 5) return []
  const flagName = nameOf(input.ships[0])
  const secondName = nameOf(input.ships[1])
  if (!KONGO_PARTNERS[flagName]?.has(secondName)) return []
  return [{
    ci: 104,
    label: specialAttackLabel(104, 'night')!,
    phase: 'night',
    formation: formationFor(input, '单纵阵或梯形阵', '第二或第四警戒航行序列'),
    detail:
      '前两舰满足指定僚舰组合且有至少5艘水上舰；仅夜战可用，实际发动还取决于阵形、损伤、剩余次数与发动率',
  }]
}

const submarineAttack = (input: FleetSpecialAttackInput): FleetSpecialAttack[] => {
  if (input.role === 'combined-main' || input.role === 'combined-escort') return []
  const flagName = nameOf(input.ships[0])
  if (
    !SUBMARINE_TENDER_FLAGS.has(flagName) ||
    (input.ships[0]?.lv ?? 0) < 30 ||
    !isSubmarine(input.ships[1]) ||
    !isSubmarine(input.ships[2])
  ) {
    return []
  }
  return [{
    ci: 300,
    label: '潜水舰队攻击',
    phase: 'day',
    formation: '梯形阵或单横阵',
    detail:
      '旗舰为 Lv30 以上的指定潜水母舰且2、3号位为潜水舰；实际发动还需要对应阵形并消耗潜水舰补给物资',
  }]
}

export const detectFleetSpecialAttacks = (
  input: FleetSpecialAttackInput,
): FleetSpecialAttack[] => [
  ...mainSpecialAttack(input),
  ...kongoNightAttack(input),
  ...submarineAttack(input),
]
