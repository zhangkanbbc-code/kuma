// 逐舰特殊攻击 · 对空CI 与先制对潜的可发动判定。
//
// 与 fleet-special-attack 的分工：那边判「旗舰带起来的整队特殊攻击」（Nelson Touch 一类），
// 这边判「这一艘舰凭自己的装备能不能发动」。两边都只核对母港看得见的条件。
//
// 规则移植自 poi `views/utils/combat/{aaci,oasw}`（MIT）：对空CI 表 poi 自 KC3Kai 移植后
// 改以 wikiwiki「対空砲火」一览表为准，先制对潜以 wikiwiki「対潜攻撃」発動条件为准，
// 上游最近一次逐条核对是 2026-05-27（poi 仓库内 combat/aaci.md、combat/oasw.md 有记录）。
// **舰号、装备号、固定击坠与倍率一律照抄，不自行增删**——这种表两边各写一套之后，
// 结论对不上时就分不清是抄错了还是游戏改了，只能整表重核。
// 唯一的例外是上游明显没跟上游戏更新的条目：这时才补，且必须在那一条旁边写清
// 「本地补充 + 出处 + 查证日期」，让偏离处一眼可数。搜「本地补充」，当前三处：
// 2026-08-07 的 Visby 先制对潜、Fletcher 级对空CI 按舰级收，以及 2026-02-15 新增的 53 号。
//
// 诚实边界：这里回答的是「编成条件成立」，不是「一定会发动」——
// - 对空CI 有发动率，且一场战斗每方只结算一艘；
// - 先制对潜还要求这一战真的有潜水舰在场。
// 所以界面上的措辞是「可发动」，判据一并写进悬停说明供玩家自己核对。

export interface SpecialAbilityShip {
  mstId: number
  name: string // master 原名：金剛型改二一类要按名字里的「改二」判
  stype: number
  ctype: number // 舰级（api_ctype）：秋月型、Fletcher 级等按级判定
  slotNum: number // api_slot_num：常规装备格数，不含补强增设
  kai: boolean // 是否为改造后形态
  asw: number // 表示对潜（api_taisen[0]，已含装备）
}

export interface SpecialAbilityEquip {
  mstId: number
  type2: number // api_type[2]
  iconId: number // api_type[3]
  antiAir: number // api_tyku
  asw: number // api_tais
}

type EquipPredicate = (equip: SpecialAbilityEquip) => boolean
type EquipsPredicate = (equips: readonly SpecialAbilityEquip[]) => boolean
type ShipPredicate = (ship: SpecialAbilityShip) => boolean

// ---- 装备判据 ----
// 数字的含义写在等号右边；api_type[2] 是大分类，api_type[3] 是图标类别。

const type2Is = (value: number): EquipPredicate => (equip) => equip.type2 === value
const iconIs = (value: number): EquipPredicate => (equip) => equip.iconId === value
const equipIdIs =
  (...ids: number[]): EquipPredicate =>
  (equip) =>
    ids.includes(equip.mstId)

// 下面五个判据 aa-rocket-barrage 的加重对空也要用（喷进弹幕与对空CI 读的是同一批
// 装备分类）。导出而不是让那边照抄一份：这种「机铳算 21 还是图标 15」的口径两处
// 各写一遍，改了一边就出现两套加重对空，界面上还看不出是哪边错。
export const isHighAngleMount = iconIs(16) // 高角炮
const isRadar: EquipPredicate = (equip) => equip.type2 === 12 || equip.type2 === 13 // 小型/大型电探
// 对空电探：靠「本体带对空值」把对水上电探排除掉，不另列名单
export const isAARadar: EquipPredicate = (equip) => isRadar(equip) && equip.antiAir > 0
const isAdvancedAARadar: EquipPredicate = (equip) => isRadar(equip) && equip.antiAir >= 4
// 内置高射装置的高角炮：按 wikia 口径「单件高角炮对空 ≥ 8」认定
const isBuiltinHighAngleMount: EquipPredicate = (equip) =>
  isHighAngleMount(equip) && equip.antiAir >= 8
const isNinePlusHighAngleMount: EquipPredicate = (equip) =>
  isHighAngleMount(equip) && equip.antiAir >= 9
const isLargeCaliberMainGun = type2Is(3) // 大口径主炮
const isType3Shell = type2Is(18) // 三式弹
export const isAAFD = type2Is(36) // 高射装置
export const isAAGun = type2Is(21) // 对空机枪
const isCDMG: EquipPredicate = (equip) => isAAGun(equip) && equip.antiAir >= 9 // 集中配备机枪
const isAAMG: EquipPredicate = (equip) => isAAGun(equip) && equip.antiAir >= 6

/**
 * 12cm30連装噴進砲改二。名字↔id 三处一致（2026-08-30 核对）：随包 kcwiki 译名表
 * equip 274 =「12cm30連装噴進砲改二」、poi `views/utils/combat/equip-predicates.ts`
 * 的 `isRocketK2 = equipIdIs(274)`、wikiwiki 同名装备页「装備ID No.274」。
 */
export const ROCKET_LAUNCHER_K2_MST_ID = 274
export const isRocketK2 = equipIdIs(ROCKET_LAUNCHER_K2_MST_ID) // 12cm30連装噴進砲改二
const isHighAngleMountGun = equipIdIs(275) // 10cm連装高角砲改+増設機銃
const is10cmTwinHAGunMountBase = equipIdIs(71) // 10cm連装高角砲(砲架)
const is8cmHAMountKaiExtra = equipIdIs(220) // 8cm高角砲改+増設機銃
const isQF2Pounder = equipIdIs(191) // QF 2ポンド8連装ポンポン砲
const is16InchMkITriplePlusFCR = equipIdIs(300) // 16inch Mk.I三連装砲改+FCR type284
const is20Tube7InchUpRocketLaunchers = equipIdIs(301) // 20連装7inch UP Rocket Launchers
const is5InchMk30PlusGFCS = equipIdIs(308) // 5inch単装砲 Mk.30改+GFCS Mk.37
const is5InchMk30OrKai = equipIdIs(284, 313) // 5inch単装砲 Mk.30 / Mk.30改
const is5InchMk30Kai = equipIdIs(313) // 5inch単装砲 Mk.30改
const isGFCSMk37 = equipIdIs(307) // GFCS Mk.37
const isGFCSMk37With5InchTwin = equipIdIs(363) // GFCS Mk.37+5inch連装両用砲(集中配備)
const is5InchTwinDualPurposeLike = equipIdIs(362, 363) // 5inch連装両用砲(集中配備) 及带 GFCS 版
const is10cmTwinHAConcentrated = equipIdIs(464) // 10cm連装高角砲群 集中配備
const is15mDuplexRangefinderLike = equipIdIs(142, 460) // 15m二重測距儀+21号電探改二 系
const is356mmTwinKai3Dazzle = equipIdIs(502) // 35.6cm連装砲改三(ダズル迷彩仕様)
const is356mmTwinKai4 = equipIdIs(503) // 35.6cm連装砲改四
const is127mmTwinTypeCKai3H = equipIdIs(529) // 12.7cm連装砲C型改三H
const is25mmAAGunExtra = equipIdIs(505) // 25mm対空機銃増備
const is100mmTwinKaiAAFD = equipIdIs(533) // 10cm連装高角砲改+高射装置改
const is100mmTwinKai = equipIdIs(553) // 10cm連装高角砲改
const is100mmTwinKaiOrAAFD: EquipPredicate = (equip) =>
  is100mmTwinKaiAAFD(equip) || is100mmTwinKai(equip)
const isType94AAFD = equipIdIs(121) // 94式高射装置

const isDepthCharge = iconIs(17) // 爆雷投射机 / 爆雷
const isSonar = iconIs(18) // 声呐（大小型同图标）
const isDiveBomber = type2Is(7) // 舰爆
const isTorpedoBomber = type2Is(8) // 舰攻
const isSeaplaneBomber = type2Is(11) // 水上爆击机
const isAutogyro = type2Is(25) // 旋翼机
const isFixedWingAsw = type2Is(26) // 对潜哨戒机
const isAswAircraft: EquipPredicate = (equip) => isAutogyro(equip) || isFixedWingAsw(equip)

const hasSome =
  (pred: EquipPredicate): EquipsPredicate =>
  (equips) =>
    equips.some(pred)
const hasAtLeast =
  (pred: EquipPredicate, n: number): EquipsPredicate =>
  (equips) =>
    equips.filter(pred).length >= n
const allOf =
  (...preds: EquipsPredicate[]): EquipsPredicate =>
  (equips) =>
    preds.every((pred) => pred(equips))
const anyOf =
  (...preds: EquipsPredicate[]): EquipsPredicate =>
  (equips) =>
    preds.some((pred) => pred(equips))
const not =
  (pred: EquipsPredicate): EquipsPredicate =>
  (equips) =>
    !pred(equips)

// ---- 舰娘判据 ----

const shipIdIs =
  (...ids: number[]): ShipPredicate =>
  (ship) =>
    ids.includes(ship.mstId)
const ctypeIs =
  (value: number): ShipPredicate =>
  (ship) =>
    ship.ctype === value
const slotNumAtLeast =
  (n: number): ShipPredicate =>
  (ship) =>
    ship.slotNum >= n
const isAkizukiClass = ctypeIs(54)
const isBattleship: ShipPredicate = (ship) => [8, 9, 10].includes(ship.stype)
const isNotSubmarine: ShipPredicate = (ship) => ![13, 14].includes(ship.stype)
// 67 Queen Elizabeth 级 / 78 Ark Royal 级 / 82 J 级 / 88 Nelson 级 / 108 Town 级
const isRoyalNavyShip: ShipPredicate = (ship) => [67, 78, 82, 88, 108].includes(ship.ctype)
const isKongouClassK2: ShipPredicate = (ship) => ship.ctype === 6 && ship.name.includes('改二')

const isFubukiK2 = shipIdIs(426)
const isFubukiK3 = shipIdIs(1035)
const isFubukiK3Go = shipIdIs(1040) // 吹雪改三護(六式)
const isMayaK2 = shipIdIs(428)
const isIsuzuK2 = shipIdIs(141)
const isKasumiK2B = shipIdIs(470)
const isYuubariK2 = shipIdIs(622)
const isInagiK2 = shipIdIs(979)
const isSatsukiK2 = shipIdIs(418)
const isKinuK2 = shipIdIs(487)
const isYuraK2 = shipIdIs(488)
const isFumitsukiK2 = shipIdIs(548)
const isUIT25OrI504 = shipIdIs(539, 530)
const isTenryuuK2 = shipIdIs(477)
const isTatsutaK2 = shipIdIs(478)
const isIseKOrK2 = shipIdIs(82, 553)
const isHyuugaK = shipIdIs(88)
const isHyuugaK2 = shipIdIs(554)
const isMusashiKOrK2 = shipIdIs(148, 546)
const isMusashiK2 = shipIdIs(546)
const isYamatoK2 = shipIdIs(911, 916) // 大和改二 / 大和改二重
const isOoyodoK = shipIdIs(321)
const isHiryuuK3 = shipIdIs(1031)
const isHamakazeBKOrIsokazeBK = shipIdIs(558, 557)
const isGotlandKai = shipIdIs(579)
const isAtlantaOrKai = shipIdIs(597, 696)
const isHarunaK2B = shipIdIs(593)
const isShiratsuyuClassK2 = shipIdIs(497, 145, 961, 498, 975)
const isNamiClassK2 = shipIdIs(981, 982, 983, 1033) // 藤波/早波/浜波/玉波改二
const isShirayukiK2OrHatsuyukiK2 = shipIdIs(986, 987)

// 对空CI 用的 Fletcher 级。wikiwiki「対空砲火」的 34~37 号写的是「Fletcher級」整级，
// 全页没有任何排除脚注（2026-08-07 查证），所以这里按舰级收。
//
// ⚠ 本地补充：上游 poi 是逐个列舰号（562/689/596/692/628/629/941/726），
// 漏了 Richard P.Leary（942）与 Richard P.Leary改（737）——它们同为 ctype 91，
// 多半是上游那份名单（aaci.md 最后校对于 2026-05-27）没跟上新舰。
// 先制对潜那边条件不同（点名排除未改造的两艘，见 openingAsw），两者不要合并。
const isFletcherClassOrKaiForAaci = ctypeIs(91)

// 吹雪改二系（改二/改三/改三護）与波级改二共用同一批条目
const isFubukiK2Family: ShipPredicate = (ship) =>
  isFubukiK2(ship) ||
  isFubukiK3(ship) ||
  isFubukiK3Go(ship) ||
  isShirayukiK2OrHatsuyukiK2(ship) ||
  isNamiClassK2(ship)

// ---- 对空CI 表 ----

export interface AaciEntry {
  id: number // 游戏内的对空CI 类型编号
  fixed: number // 固定击坠
  modifier: number // 比例加成
  scope: string // 适用范围；和下面的 shipValid 写在一起，别分开改
  // 装备条件的人话版。游戏和社区都只用编号称呼对空CI，光看「类型 9」说明不了任何事，
  // 所以每条都配一句；同样紧挨着 equipsValid 放，改判据时不会漏改说明。
  // 术语：高角炮=图标16；内置高射装置的高角炮=高角炮且对空≥8；机枪=大分类21；
  //       集中机枪=机枪且对空≥9；对空电探=电探且对空>0；高性能对空电探=电探且对空≥4。
  condition: string
  shipValid: ShipPredicate
  equipsValid: EquipsPredicate
}

// 按 id 升序排列——下面挑「会发动的那条」时靠这个顺序在同固定击坠时取小 id，
// 与上游 lodash maxBy 取首条的行为一致。
export const AACI_TABLE: readonly AaciEntry[] = [
  {
    id: 1,
    fixed: 7,
    modifier: 1.7,
    scope: '秋月型',
    condition: '高角炮×2 + 电探',
    shipValid: isAkizukiClass,
    equipsValid: allOf(hasAtLeast(isHighAngleMount, 2), hasSome(isRadar)),
  },
  {
    id: 2,
    fixed: 6,
    modifier: 1.7,
    scope: '秋月型 / 吹雪改三護',
    condition: '高角炮 + 电探',
    shipValid: (ship) => isAkizukiClass(ship) || isFubukiK3Go(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isRadar)),
  },
  {
    id: 3,
    fixed: 4,
    modifier: 1.6,
    scope: '秋月型',
    condition: '高角炮×2',
    shipValid: isAkizukiClass,
    equipsValid: hasAtLeast(isHighAngleMount, 2),
  },
  {
    id: 4,
    fixed: 6,
    modifier: 1.5,
    scope: '战舰（4 格以上）',
    condition: '大口径主炮 + 三式弹 + 高射装置 + 对空电探',
    shipValid: (ship) => isBattleship(ship) && slotNumAtLeast(4)(ship),
    equipsValid: allOf(
      hasSome(isLargeCaliberMainGun),
      hasSome(isType3Shell),
      hasSome(isAAFD),
      hasSome(isAARadar),
    ),
  },
  {
    id: 5,
    fixed: 4,
    modifier: 1.5,
    scope: '全水上舰（3 格以上）',
    condition: '内置高射装置的高角炮×2 + 对空电探',
    shipValid: (ship) => isNotSubmarine(ship) && slotNumAtLeast(3)(ship),
    equipsValid: allOf(hasAtLeast(isBuiltinHighAngleMount, 2), hasSome(isAARadar)),
  },
  {
    id: 6,
    fixed: 4,
    modifier: 1.45,
    scope: '战舰（3 格以上）',
    condition: '大口径主炮 + 三式弹 + 高射装置',
    shipValid: (ship) => isBattleship(ship) && slotNumAtLeast(3)(ship),
    equipsValid: allOf(hasSome(isLargeCaliberMainGun), hasSome(isType3Shell), hasSome(isAAFD)),
  },
  {
    id: 7,
    fixed: 3,
    modifier: 1.35,
    scope: '全水上舰（3 格以上）',
    condition: '高角炮 + 高射装置 + 对空电探',
    shipValid: (ship) => isNotSubmarine(ship) && slotNumAtLeast(3)(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAFD), hasSome(isAARadar)),
  },
  {
    id: 8,
    fixed: 4,
    modifier: 1.4,
    scope: '全水上舰（2 格以上）',
    condition: '内置高射装置的高角炮 + 对空电探',
    shipValid: (ship) => isNotSubmarine(ship) && slotNumAtLeast(2)(ship),
    equipsValid: allOf(hasSome(isBuiltinHighAngleMount), hasSome(isAARadar)),
  },
  {
    id: 9,
    fixed: 2,
    modifier: 1.3,
    scope: '全水上舰（2 格以上）',
    condition: '高角炮 + 高射装置',
    shipValid: (ship) => isNotSubmarine(ship) && slotNumAtLeast(2)(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAFD)),
  },
  {
    id: 10,
    fixed: 8,
    modifier: 1.65,
    scope: '摩耶改二',
    condition: '高角炮 + 集中机枪 + 对空电探',
    shipValid: isMayaK2,
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isCDMG), hasSome(isAARadar)),
  },
  {
    id: 11,
    fixed: 6,
    modifier: 1.5,
    scope: '摩耶改二',
    condition: '高角炮 + 集中机枪',
    shipValid: isMayaK2,
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isCDMG)),
  },
  {
    id: 12,
    fixed: 3,
    modifier: 1.25,
    scope: '全水上舰（3 格以上）',
    condition: '集中机枪 + 机枪合计 2 件 + 对空电探',
    shipValid: (ship) => isNotSubmarine(ship) && slotNumAtLeast(3)(ship),
    equipsValid: allOf(hasSome(isCDMG), hasAtLeast(isAAGun, 2), hasSome(isAARadar)),
  },
  {
    id: 13,
    fixed: 4,
    modifier: 1.35,
    scope: '全水上舰（3 格以上）',
    condition: '内置高射装置的高角炮 + 集中机枪 + 对空电探',
    shipValid: (ship) => isNotSubmarine(ship) && slotNumAtLeast(3)(ship),
    equipsValid: allOf(hasSome(isBuiltinHighAngleMount), hasSome(isCDMG), hasSome(isAARadar)),
  },
  {
    id: 14,
    fixed: 4,
    modifier: 1.45,
    scope: '五十铃改二',
    condition: '高角炮 + 机枪 + 对空电探',
    shipValid: isIsuzuK2,
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAGun), hasSome(isAARadar)),
  },
  {
    id: 15,
    fixed: 3,
    modifier: 1.3,
    scope: '五十铃改二 / 吹雪改三',
    condition: '高角炮 + 机枪',
    shipValid: (ship) => isIsuzuK2(ship) || isFubukiK3(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAGun)),
  },
  {
    id: 16,
    fixed: 4,
    modifier: 1.4,
    scope: '霞改二乙 / 夕张改二 / 吹雪改三',
    condition: '高角炮 + 机枪 + 对空电探',
    shipValid: (ship) => isKasumiK2B(ship) || isYuubariK2(ship) || isFubukiK3(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAGun), hasSome(isAARadar)),
  },
  {
    id: 17,
    fixed: 2,
    modifier: 1.25,
    scope: '霞改二乙 / 稻木改二',
    condition: '高角炮 + 机枪',
    shipValid: (ship) => isKasumiK2B(ship) || isInagiK2(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAGun)),
  },
  {
    id: 18,
    fixed: 2,
    modifier: 1.2,
    scope: '皋月改二',
    condition: '集中机枪',
    shipValid: isSatsukiK2,
    equipsValid: hasSome(isCDMG),
  },
  {
    id: 19,
    fixed: 5,
    modifier: 1.45,
    scope: '鬼怒改二（不可带内置高射装置的高角炮）',
    condition: '非内置高射装置的高角炮 + 集中机枪（带内置高射装置的高角炮会让它失效）',
    shipValid: isKinuK2,
    equipsValid: allOf(
      not(hasSome(isBuiltinHighAngleMount)),
      hasSome(isHighAngleMount),
      hasSome(isCDMG),
    ),
  },
  {
    id: 20,
    fixed: 3,
    modifier: 1.25,
    scope: '鬼怒改二',
    condition: '集中机枪',
    shipValid: isKinuK2,
    equipsValid: hasSome(isCDMG),
  },
  {
    id: 21,
    fixed: 5,
    modifier: 1.45,
    scope: '由良改二 / 吹雪改三 / 吹雪改三護',
    condition: '高角炮 + 对空电探',
    shipValid: (ship) => isYuraK2(ship) || isFubukiK3(ship) || isFubukiK3Go(ship),
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAARadar)),
  },
  {
    id: 22,
    fixed: 2,
    modifier: 1.2,
    scope: '文月改二',
    condition: '集中机枪',
    shipValid: isFumitsukiK2,
    equipsValid: hasSome(isCDMG),
  },
  {
    id: 23,
    fixed: 1,
    modifier: 1.05,
    scope: 'UIT-25 / 伊504',
    condition: '非集中配备的机枪',
    shipValid: isUIT25OrI504,
    equipsValid: hasSome((equip) => isAAGun(equip) && !isCDMG(equip)),
  },
  {
    id: 24,
    fixed: 3,
    modifier: 1.25,
    scope: '天龙改二 / 龙田改二 / 吹雪改三',
    condition: '非集中配备的机枪 + 高角炮',
    shipValid: (ship) => isTenryuuK2(ship) || isTatsutaK2(ship) || isFubukiK3(ship),
    equipsValid: allOf(
      hasSome((equip) => isAAGun(equip) && !isCDMG(equip)),
      hasSome(isHighAngleMount),
    ),
  },
  {
    id: 25,
    fixed: 7,
    modifier: 1.55,
    scope: '伊势改 / 伊势改二 / 日向改 / 日向改二',
    condition: '12cm30連装噴進砲改二 + 对空电探 + 三式弹',
    shipValid: (ship) => isIseKOrK2(ship) || isHyuugaK(ship) || isHyuugaK2(ship),
    equipsValid: allOf(hasSome(isRocketK2), hasSome(isAARadar), hasSome(isType3Shell)),
  },
  {
    id: 26,
    fixed: 6,
    modifier: 1.4,
    scope: '武藏改二 / 大和改二 / 大和改二重',
    condition: '10cm連装高角砲改+増設機銃 + 对空电探',
    shipValid: (ship) => isMusashiK2(ship) || isYamatoK2(ship),
    equipsValid: allOf(hasSome(isHighAngleMountGun), hasSome(isAARadar)),
  },
  {
    id: 27,
    fixed: 5,
    modifier: 1.55,
    scope: '大淀改 / 飞龙改三',
    condition: '10cm連装高角砲改+増設機銃／10cm連装高角砲(砲架)／8cm高角砲改+増設機銃 + 12cm30連装噴進砲改二 + 对空电探',
    shipValid: (ship) => isOoyodoK(ship) || isHiryuuK3(ship),
    equipsValid: allOf(
      hasSome(
        (equip) =>
          isHighAngleMountGun(equip) ||
          is10cmTwinHAGunMountBase(equip) ||
          is8cmHAMountKaiExtra(equip),
      ),
      hasSome(isRocketK2),
      hasSome(isAARadar),
    ),
  },
  {
    id: 28,
    fixed: 4,
    modifier: 1.4,
    scope: '伊势改 / 伊势改二 / 日向改 / 日向改二 / 武藏改 / 武藏改二',
    condition: '12cm30連装噴進砲改二 + 对空电探',
    shipValid: (ship) =>
      isIseKOrK2(ship) || isHyuugaK(ship) || isHyuugaK2(ship) || isMusashiKOrK2(ship),
    equipsValid: allOf(hasSome(isRocketK2), hasSome(isAARadar)),
  },
  {
    id: 29,
    fixed: 5,
    modifier: 1.55,
    scope: '浜风乙改 / 矶风乙改',
    condition: '高角炮 + 对空电探',
    shipValid: isHamakazeBKOrIsokazeBK,
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAARadar)),
  },
  {
    id: 30,
    fixed: 3,
    modifier: 1.3,
    scope: '天龙改二 / Gotland改',
    condition: '高角炮×3',
    shipValid: (ship) => isTenryuuK2(ship) || isGotlandKai(ship),
    equipsValid: hasAtLeast(isHighAngleMount, 3),
  },
  {
    id: 31,
    fixed: 2,
    modifier: 1.25,
    scope: '天龙改二 / 稻木改二',
    condition: '高角炮×2',
    shipValid: (ship) => isTenryuuK2(ship) || isInagiK2(ship),
    equipsValid: hasAtLeast(isHighAngleMount, 2),
  },
  {
    id: 32,
    fixed: 3,
    modifier: 1.2,
    scope: '英系舰 / 金刚型改二',
    condition: '16inch Mk.I三連装砲改+FCR type284 或 20連装7inch UP Rocket + QF 2ポンド8連装ポンポン砲；或 20連装7inch UP Rocket×2',
    shipValid: (ship) => isRoyalNavyShip(ship) || isKongouClassK2(ship),
    equipsValid: anyOf(
      allOf(hasSome(is16InchMkITriplePlusFCR), hasSome(isQF2Pounder)),
      allOf(hasSome(is20Tube7InchUpRocketLaunchers), hasSome(isQF2Pounder)),
      hasAtLeast(is20Tube7InchUpRocketLaunchers, 2),
    ),
  },
  {
    id: 33,
    fixed: 3,
    modifier: 1.35,
    scope: 'Gotland改',
    condition: '高角炮 + 机枪',
    shipValid: isGotlandKai,
    equipsValid: allOf(hasSome(isHighAngleMount), hasSome(isAAGun)),
  },
  {
    id: 34,
    fixed: 7,
    modifier: 1.6,
    scope: 'Fletcher 级 / 吹雪改三護',
    condition: '5inch単装砲 Mk.30改+GFCS Mk.37 ×2',
    shipValid: (ship) => isFletcherClassOrKaiForAaci(ship) || isFubukiK3Go(ship),
    equipsValid: hasAtLeast(is5InchMk30PlusGFCS, 2),
  },
  {
    id: 35,
    fixed: 6,
    modifier: 1.55,
    scope: 'Fletcher 级 / 吹雪改三護',
    condition: '5inch単装砲 Mk.30改+GFCS Mk.37 + 5inch単装砲 Mk.30／Mk.30改',
    shipValid: (ship) => isFletcherClassOrKaiForAaci(ship) || isFubukiK3Go(ship),
    equipsValid: allOf(hasSome(is5InchMk30PlusGFCS), hasSome(is5InchMk30OrKai)),
  },
  {
    id: 36,
    fixed: 6,
    modifier: 1.55,
    scope: 'Fletcher 级 / 吹雪改三護',
    condition: '5inch単装砲 Mk.30／Mk.30改×2 + GFCS Mk.37',
    shipValid: (ship) => isFletcherClassOrKaiForAaci(ship) || isFubukiK3Go(ship),
    equipsValid: allOf(hasAtLeast(is5InchMk30OrKai, 2), hasSome(isGFCSMk37)),
  },
  {
    id: 37,
    fixed: 4,
    modifier: 1.45,
    scope: 'Fletcher 级',
    condition: '5inch単装砲 Mk.30改×2',
    shipValid: isFletcherClassOrKaiForAaci,
    equipsValid: hasAtLeast(is5InchMk30Kai, 2),
  },
  {
    id: 38,
    fixed: 10,
    modifier: 1.85,
    scope: 'Atlanta / Atlanta改',
    condition: 'GFCS Mk.37+5inch連装両用砲(集中配備)×2',
    shipValid: isAtlantaOrKai,
    equipsValid: hasAtLeast(isGFCSMk37With5InchTwin, 2),
  },
  {
    id: 39,
    fixed: 10,
    modifier: 1.7,
    scope: 'Atlanta / Atlanta改',
    condition: 'GFCS Mk.37+5inch連装両用砲(集中配備) + 5inch連装両用砲(集中配備)系共 2 件',
    shipValid: isAtlantaOrKai,
    equipsValid: allOf(
      hasSome(isGFCSMk37With5InchTwin),
      hasAtLeast(is5InchTwinDualPurposeLike, 2),
    ),
  },
  {
    id: 40,
    fixed: 10,
    modifier: 1.7,
    scope: 'Atlanta / Atlanta改',
    condition: 'GFCS Mk.37 + 5inch連装両用砲(集中配備)系×2',
    shipValid: isAtlantaOrKai,
    equipsValid: allOf(hasSome(isGFCSMk37), hasAtLeast(is5InchTwinDualPurposeLike, 2)),
  },
  {
    id: 41,
    fixed: 9,
    modifier: 1.65,
    scope: 'Atlanta / Atlanta改',
    condition: '5inch連装両用砲(集中配備)系×2',
    shipValid: isAtlantaOrKai,
    equipsValid: hasAtLeast(is5InchTwinDualPurposeLike, 2),
  },
  {
    id: 42,
    fixed: 10,
    modifier: 1.65,
    scope: '武藏改二 / 大和改二 / 大和改二重',
    condition: '10cm連装高角砲群 集中配備×2 + 15m二重測距儀系 + 对空≥6 的机枪',
    shipValid: (ship) => isMusashiK2(ship) || isYamatoK2(ship),
    equipsValid: allOf(
      hasAtLeast(is10cmTwinHAConcentrated, 2),
      hasSome(is15mDuplexRangefinderLike),
      hasSome(isAAMG),
    ),
  },
  {
    id: 43,
    fixed: 8,
    modifier: 1.6,
    scope: '武藏改二 / 大和改二 / 大和改二重',
    condition: '10cm連装高角砲群 集中配備×2 + 15m二重測距儀系',
    shipValid: (ship) => isMusashiK2(ship) || isYamatoK2(ship),
    equipsValid: allOf(hasAtLeast(is10cmTwinHAConcentrated, 2), hasSome(is15mDuplexRangefinderLike)),
  },
  {
    id: 44,
    fixed: 6,
    modifier: 1.6,
    scope: '武藏改二 / 大和改二 / 大和改二重',
    condition: '10cm連装高角砲群 集中配備 + 15m二重測距儀系 + 对空≥6 的机枪',
    shipValid: (ship) => isMusashiK2(ship) || isYamatoK2(ship),
    equipsValid: allOf(
      hasSome(is10cmTwinHAConcentrated),
      hasSome(is15mDuplexRangefinderLike),
      hasSome(isAAMG),
    ),
  },
  {
    id: 45,
    fixed: 5,
    modifier: 1.55,
    scope: '武藏改二 / 大和改二 / 大和改二重',
    condition: '10cm連装高角砲群 集中配備 + 15m二重測距儀系',
    shipValid: (ship) => isMusashiK2(ship) || isYamatoK2(ship),
    equipsValid: allOf(hasSome(is10cmTwinHAConcentrated), hasSome(is15mDuplexRangefinderLike)),
  },
  {
    id: 46,
    fixed: 8,
    modifier: 1.55,
    scope: '榛名改二乙',
    condition: '集中机枪 + 对空电探 + 35.6cm連装砲改三(ダズル迷彩仕様)／改四',
    shipValid: isHarunaK2B,
    equipsValid: allOf(
      hasSome(isCDMG),
      hasSome(isAARadar),
      hasSome((equip) => is356mmTwinKai3Dazzle(equip) || is356mmTwinKai4(equip)),
    ),
  },
  {
    id: 47,
    fixed: 2,
    modifier: 1.3,
    scope: '白露型改二（白露/时雨/村雨/春雨）',
    condition: '12.7cm連装砲C型改三H + 25mm対空機銃増備或高性能对空电探；或 12.7cm連装砲C型改三H×2',
    shipValid: isShiratsuyuClassK2,
    equipsValid: anyOf(
      allOf(
        hasSome(is127mmTwinTypeCKai3H),
        hasSome((equip) => is25mmAAGunExtra(equip) || isAdvancedAARadar(equip)),
      ),
      hasAtLeast(is127mmTwinTypeCKai3H, 2),
    ),
  },
  {
    id: 48,
    fixed: 8,
    modifier: 1.75,
    scope: '秋月型改／改二 / 吹雪改三護',
    condition: '10cm連装高角砲改+高射装置改×2 + 高性能对空电探',
    shipValid: (ship) => (isAkizukiClass(ship) && ship.kai) || isFubukiK3Go(ship),
    equipsValid: allOf(hasAtLeast(is100mmTwinKaiAAFD, 2), hasSome(isAdvancedAARadar)),
  },
  {
    id: 49,
    fixed: 5,
    modifier: 1.5,
    scope: '吹雪改二系 / 白雪·初雪改二 / 波级改二',
    condition: '内置高射装置的高角炮×2 + 高性能对空电探',
    shipValid: isFubukiK2Family,
    equipsValid: allOf(hasAtLeast(isBuiltinHighAngleMount, 2), hasSome(isAdvancedAARadar)),
  },
  {
    id: 50,
    fixed: 7,
    modifier: 1.5,
    scope: '吹雪改二系 / 白雪·初雪改二 / 波级改二 / 秋月型',
    condition: '10cm連装高角砲改+高射装置改／10cm連装高角砲改 共 2 件 + 高性能对空电探 + 94式高射装置',
    shipValid: (ship) => isFubukiK2Family(ship) || isAkizukiClass(ship),
    equipsValid: allOf(
      hasAtLeast(is100mmTwinKaiOrAAFD, 2),
      hasSome(isAdvancedAARadar),
      hasSome(isType94AAFD),
    ),
  },
  {
    id: 51,
    fixed: 5,
    modifier: 1.35,
    scope: '吹雪改二系 / 白雪·初雪改二 / 波级改二',
    condition: '10cm連装高角砲改+高射装置改／10cm連装高角砲改 + 高性能对空电探 + 机枪',
    shipValid: isFubukiK2Family,
    equipsValid: allOf(
      hasSome(is100mmTwinKaiOrAAFD),
      hasSome(isAdvancedAARadar),
      hasSome(isAAGun),
    ),
  },
  {
    id: 52,
    fixed: 4,
    modifier: 1.4,
    scope: '吹雪改二系 / 白雪·初雪改二 / 波级改二',
    condition: '10cm連装高角砲改×2 + 94式高射装置',
    shipValid: isFubukiK2Family,
    equipsValid: allOf(hasAtLeast(is100mmTwinKai, 2), hasSome(isType94AAFD)),
  },
  {
    // ⚠ 本地补充：S3 当前总表新增 53 号；固定ボーナス 5? 按本表口径记为 +4，
    // 倍率原表同样带问号为 1.6?。2026-02-15 查证：
    // https://x.com/CC_jabberwock/status/2023061342756937820
    id: 53,
    fixed: 4,
    modifier: 1.6,
    scope: '飞龙改三',
    condition: '对空≥9 的高角炮 + 高性能对空电探',
    shipValid: isHiryuuK3,
    equipsValid: allOf(hasSome(isNinePlusHighAngleMount), hasSome(isAdvancedAARadar)),
  },
]

const AACI_BY_ID = new Map(AACI_TABLE.map((entry) => [entry.id, entry]))

// 精确顺序转录自 S3「対空カットイン優先度」表（2026-02-15）：
// https://docs.google.com/spreadsheets/d/1agGoLv57g5eOXLXtNIKHRoBYy61OQYxibWP6Vi_DMuY/edit?gid=13450409#gid=13450409
// 当前 1..53 全部是表内转录：53 条；规则推定：0 条。以后出现 S3 尚未收录的编号时，
// 才排在这些有据者之后，按页面概括规则「固定击坠高者优先、相近时比较倍率」推定。
export const AACI_PRIORITY: readonly number[] = [
  38, 39, 40, 42, 41, 10, 43, 46, 11, 25, 48, 1, 34, 44, 26, 4, 2, 35, 36, 27, 45, 50, 49,
  51, 52, 19, 21, 29, 53, 16, 14, 3, 5, 6, 28, 37, 33, 30, 8, 13, 15, 7, 20, 24, 32, 12, 31,
  47, 17, 18, 22, 9, 23,
]

const AACI_PRIORITY_RANK = new Map(AACI_PRIORITY.map((id, rank) => [id, rank]))

/** 按类型编号取条目。战斗侧只拿得到 api_air_fire 的 kind，靠它把数字翻成人话。 */
export const aaciEntryOf = (id: number): AaciEntry | null => AACI_BY_ID.get(id) ?? null

/** 装备条件也成立的全部条目，还没有套舰娘专属排除规则。 */
const availableAacis = (
  ship: SpecialAbilityShip,
  equips: readonly SpecialAbilityEquip[],
): AaciEntry[] => AACI_TABLE.filter((entry) => entry.shipValid(ship) && entry.equipsValid(equips))

const aaciIsExcluded = (ship: SpecialAbilityShip, id: number): boolean =>
  (isMayaK2(ship) && id === 13) || (isAkizukiClass(ship) && [5, 7, 8].includes(id))

/**
 * 排除舰娘专属禁用规则后，这一艘舰实际会按优先度逐项尝试的全部对空CI。
 */
export const shipAacis = (
  ship: SpecialAbilityShip,
  equips: readonly SpecialAbilityEquip[],
): AaciEntry[] =>
  availableAacis(ship, equips)
    .filter((entry) => !aaciIsExcluded(ship, entry.id))
    .sort(
      (left, right) =>
        AACI_PRIORITY_RANK.get(left.id)! - AACI_PRIORITY_RANK.get(right.id)!,
    )

/**
 * 旧式“只挑固定击坠最高一条”的展示结果。
 *
 * 上游口径：先取固定击坠最高的一条（同分取 id 小的），再套几条特例
 * （鬼怒改二 / 皋月改二 / 文月改二会额外叠一条；霞改二乙、五十铃改二在同分时优先自己的专属条）。
 */
export const bestShipAacis = (
  ship: SpecialAbilityShip,
  equips: readonly SpecialAbilityEquip[],
): AaciEntry[] => {
  // 旧实现从 id 升序表里取同固定击坠的首条；这里排回 id 顺序，避免优先度表改变旧展示。
  const available = shipAacis(ship, equips).sort((left, right) => left.id - right.id)
  if (!available.length) return []
  const ids = new Set(available.map((entry) => entry.id))
  // 上游把这条变量叫 maxFixed，实际取到的是「固定击坠最高那条的 id」。
  const best = available.reduce((top, entry) => (entry.fixed > top.fixed ? entry : top)).id
  const pick = (...wanted: number[]): AaciEntry[] =>
    [...new Set(wanted)].map((id) => AACI_BY_ID.get(id)!)

  if (ids.has(19)) return pick(19, 20) // 鬼怒改二
  if (best === 8 && ids.has(20)) return pick(8, 20)
  if (best === 8 && ids.has(7)) return pick(7, 8)
  if (ids.has(17) && best === 9) return pick(17) // 霞改二乙：与 9 号同击坠，取专属条
  if (ids.has(14) && best === 8) return pick(14) // 五十铃改二：同上
  if (ids.has(18)) return pick(best, 18) // 皋月改二
  if (ids.has(22)) return pick(best, 22) // 文月改二
  return pick(best)
}

/** 该舰不看装备时能达到的最高固定击坠——用来提示「当前配装还没吃满」。 */
export const shipAaciCeiling = (ship: SpecialAbilityShip): number =>
  AACI_TABLE.reduce((top, entry) => (entry.shipValid(ship) ? Math.max(top, entry.fixed) : top), 0)

// ---- 先制对潜 ----

interface OpeningAswRule {
  basis: string
  match: (ship: SpecialAbilityShip, equips: readonly SpecialAbilityEquip[]) => boolean
}

const equipAswSum = (equips: readonly SpecialAbilityEquip[]): number =>
  equips.reduce((total, equip) => total + equip.asw, 0)

// 先制对潜用的 Fletcher 级：上游在这里故意按舰级 + 改造判，
// 好让以后新出的 Fletcher 级改造形态自动生效（对空CI 那边则是逐个列号）。
const isFletcherClassOrKaiForOasw: ShipPredicate = (ship) =>
  ship.mstId === 562 || ship.mstId === 596 || (ship.ctype === 91 && ship.kai)

const isTaiyouClassKaiOrK2 = shipIdIs(380, 381, 529, 536) // 大鷹改/神鷹改/大鷹改二/神鷹改二
const isMogamiClassCvl = shipIdIs(508, 509) // 铃谷航改二 / 熊野航改二

// 轻空母里走通用条款的那一批：大鹰型改／改二另有自己的条款；最上型航改二被整个排除，
// 因为 wikiwiki 只写「特殊」而没有给出条件——没有条件就不判，别猜一个出来。
const isPlainCvl: ShipPredicate = (ship) =>
  ship.stype === 7 && !isTaiyouClassKaiOrK2(ship) && !isMogamiClassCvl(ship)

// 顺序即匹配顺序：命中第一条就作为依据展示，所以先放「无条件」再放需要凑条件的。
const OPENING_ASW_RULES: readonly OpeningAswRule[] = [
  // 「无条件」拆成逐条：光说「无条件」，玩家看不出是这艘舰自带的还是整级都有。
  { basis: '五十铃改二 · 自带先制对潜，不看装备', match: shipIdIs(141) },
  { basis: '龙田改二 · 自带先制对潜，不看装备', match: shipIdIs(478) },
  { basis: '夕张改二丁 · 自带先制对潜，不看装备', match: shipIdIs(624) },
  { basis: '吹雪改三護 · 自带先制对潜，不看装备', match: shipIdIs(1040) },
  { basis: 'J 级改（Jervis／Janus／Javelin）· 整级自带先制对潜', match: shipIdIs(394, 893, 906) },
  { basis: 'Samuel B.Roberts 改／Mk.II · 自带先制对潜', match: shipIdIs(681, 920) },
  {
    // 上游按「舰级 + 改造」判，好让以后新出的形态自动生效；未改造的 Richard P.Leary
    // 与 Heywood L.E. 是 wikiwiki 表里点名排除的两艘（脚注 *29），所以它们进不来。
    basis: 'Fletcher 级 · 整级自带先制对潜（未改造的 Richard P.Leary／Heywood L.E. 除外）',
    match: isFletcherClassOrKaiForOasw,
  },
  {
    // ⚠ 本地补充，上游 poi 的表里还没有这一条（其 oasw.md 最后校对于 2026-05-27）。
    // 依据：wikiwiki「対潜攻撃」発動条件表，Visby 与 Fletcher 级同格，対潜値「-」・装備「・無し」，
    // 2026-08-07 查证。表里其余条目都写明形态（五十鈴改二、Samuel B.Roberts改/Mk.II…），
    // 唯独 Visby 写的是不带形态的舰名，与「Fletcher級」同一种写法，故按舰级收。
    // 这是全表唯一一处偏离上游——出处与日期只写在这条注释里（2026-08-20 文案清扫：
    // 署名撤出 basis，basis 是给玩家看的判据），以后对不上时照这里分清是谁的问题。
    basis: 'Visby 级 · 整级自带先制对潜',
    match: ctypeIs(140),
  },
  {
    basis: '海防舰 · 对潜 ≥ 60 且装备声呐',
    match: (ship, equips) => ship.stype === 1 && ship.asw >= 60 && equips.some(isSonar),
  },
  {
    basis: '海防舰 · 对潜 ≥ 75 且装备对潜合计 ≥ 4',
    match: (ship, equips) => ship.stype === 1 && ship.asw >= 75 && equipAswSum(equips) >= 4,
  },
  {
    basis: '驱逐 / 轻巡 / 雷巡 / 练巡 / 补给 · 对潜 ≥ 100 且装备声呐',
    match: (ship, equips) =>
      [2, 3, 4, 21, 22].includes(ship.stype) && ship.asw >= 100 && equips.some(isSonar),
  },
  {
    basis: '大鹰型改／改二·加贺改二護 · 带对潜机（对潜舰攻／舰爆或对潜哨戒机／旋翼机）',
    match: (ship, equips) =>
      (isTaiyouClassKaiOrK2(ship) || ship.mstId === 646) &&
      equips.some(
        (equip) =>
          ((isTorpedoBomber(equip) || isDiveBomber(equip)) && equip.asw >= 1) ||
          isAswAircraft(equip),
      ),
  },
  {
    basis: '轻空母 · 对潜 ≥ 65 且带对潜 ≥ 7 的舰攻或对潜机',
    match: (ship, equips) =>
      isPlainCvl(ship) &&
      ship.asw >= 65 &&
      equips.some((equip) => (isTorpedoBomber(equip) && equip.asw >= 7) || isAswAircraft(equip)),
  },
  {
    basis: '轻空母 · 对潜 ≥ 50 且装备声呐 + 对潜 ≥ 7 的舰攻或对潜机',
    match: (ship, equips) =>
      isPlainCvl(ship) &&
      ship.asw >= 50 &&
      equips.some(isSonar) &&
      equips.some((equip) => (isTorpedoBomber(equip) && equip.asw >= 7) || isAswAircraft(equip)),
  },
  {
    basis: '轻空母 · 对潜 ≥ 100 且装备声呐 + 对潜 ≥ 1 的舰攻或舰爆',
    match: (ship, equips) =>
      isPlainCvl(ship) &&
      ship.asw >= 100 &&
      equips.some(isSonar) &&
      equips.some(
        (equip) => (isTorpedoBomber(equip) || isDiveBomber(equip)) && equip.asw >= 1,
      ),
  },
  {
    basis: '日向改二 · 带对潜 ≥ 12 的旋翼机，或旋翼机两架',
    match: (ship, equips) =>
      isHyuugaK2(ship) &&
      (equips.some((equip) => isAutogyro(equip) && equip.asw >= 12) ||
        equips.filter(isAutogyro).length >= 2),
  },
  {
    basis: '神州丸改／大和改二重 · 对潜 ≥ 100 且装备声呐 + 旋翼机或水上爆击机',
    match: (ship, equips) =>
      shipIdIs(626, 916)(ship) &&
      ship.asw >= 100 &&
      equips.some(isSonar) &&
      equips.some((equip) => isAutogyro(equip) || isSeaplaneBomber(equip)),
  },
  {
    basis: '熊野丸／改 · 对潜 ≥ 100 且装备声呐 + 对潜舰爆／旋翼机／对潜哨戒机',
    match: (ship, equips) =>
      shipIdIs(943, 948)(ship) &&
      ship.asw >= 100 &&
      equips.some(isSonar) &&
      equips.some(
        (equip) =>
          (isDiveBomber(equip) && equip.asw >= 1) || isAutogyro(equip) || isFixedWingAsw(equip),
      ),
  },
  {
    basis: '扶桑改二／山城改二 · 对潜 ≥ 100 且装备声呐 + 水上爆击机／旋翼机／爆雷',
    match: (ship, equips) =>
      shipIdIs(411, 412)(ship) &&
      ship.asw >= 100 &&
      equips.some(isSonar) &&
      equips.some(
        (equip) => isSeaplaneBomber(equip) || isAutogyro(equip) || isDepthCharge(equip),
      ),
  },
]

export interface OpeningAsw {
  basis: string
}

/** 该舰能否先制对潜；能则一并给出判据。 */
export const openingAswOf = (
  ship: SpecialAbilityShip,
  equips: readonly SpecialAbilityEquip[],
): OpeningAsw | null => {
  const hit = OPENING_ASW_RULES.find((rule) => rule.match(ship, equips))
  return hit ? { basis: hit.basis } : null
}
