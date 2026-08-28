// 装备大分类的筛选口径。键是 api_type[2]（= MasterSlotitem.type2，
// 对应 api_mst_slotitem_equiptype.api_id）。
//
// 装备图鉴（收藏轴）与仓库（在籍轴）共用这一份：两处各写一份，迟早会出现
// 「图鉴把它归到电探、仓库把它归到其他」，同一件装备在两个面板里对不上。
//
// 主数据里实际存在 45 个有内容的类别（2026-08-08 从 api_start2 枚举）。
// 顶栏放不下，所以分两层：常用的做成 chip，**全部类别**在「更多分类」里逐个可选。
//
// 2026-08-08 修掉三处归错（都是照着旧表抄来的）：
// - `21 対空機銃` 原本在「舰载机」里——机枪不是舰载机；
// - `33 照明弾` 原本也在「舰载机」里；
// - `22 特殊潜航艇` 原本在「鱼雷」里——它是甲标的，不是鱼雷。
export const EQUIP_CHIPS = [
  '全部',
  '主炮',
  '副炮',
  '鱼雷',
  '舰载机',
  '水上机',
  '陆航',
  '电探',
  '对空',
  '对潜',
  '对地',
  '其他',
]

export const EQUIP_CHIP_TYPES: Record<string, number[]> = {
  主炮: [1, 2, 3, 38, 95], // 38/95 是主数据里预留的（II）类，目前 0 种
  副炮: [4],
  鱼雷: [5, 32], // 潜水舰鱼雷同属；特殊潜航艇(22) 不在此列
  // 舰载机 = 从航母/水母甲板起飞的那些，含喷式（56-59/91 整类对翔鹤改二甲等
  // 五舰开放，见 api_mst_equip_ship）。水上机与陆基另立门户。
  舰载机: [6, 7, 8, 9, 25, 26, 56, 57, 58, 59, 91, 94],
  水上机: [10, 11, 45, 41], // 水侦/水爆/水战/大型飞行艇
  // 陆航 = 类别名里明写「陸上」的那四种，基地航空队专用；
  // 另有**逐件**例外经大分類判定（见 equipChipMatches 的 LAND_ONLY_T0）
  陆航: [47, 48, 49, 53],
  电探: [12, 13, 93],
  对空: [18, 21, 36], // 对空强化弹 / 对空机枪 / 高射装置
  对潜: [14, 15, 40],
  对地: [24, 37, 46, 52], // 上陆用舟艇 / 对地装备 / 特型内火艇 / 陆战部队
}

// 高角炮与小口径主炮的分家判据住在 `shared/equip-high-angle`（纯逻辑，护栏要能真跑）。
// **这里刻意不再导出一次**：本文件被 core-regressions 用 Node 的类型剥离直接 import，
// 多一个无扩展名的相对**值**导入，那条测试就整份跑不动（同 fit-bonus-corrections 头注）。
// 要用那几个判据的模块直接从 shared 引。

const NAMED_EQUIP_TYPES = new Set(Object.values(EQUIP_CHIP_TYPES).flat())

/**
 * 不属于任何具名分组。落在这里的是装甲/机关部强化/人员/设施/探照灯/
 * 特殊潜航艇/应急修理要员/战斗粮食这些零散类别——它们各自数量都很少，
 * 单独给 chip 会把顶栏撑爆，要精确筛就用「更多分类」。
 */
export const isOtherEquipCategory = (type2: number): boolean => !NAMED_EQUIP_TYPES.has(type2)

// 大分類 api_type[0] 是游戏自己的「舰上 / 水上 / 陆上」一手口径：
// 3=舰上机系（含橘花改/喷式景云改/震电改三）、5=水上机系与舰侦、17=大型飞行艇、
// 21/22/25/26=陆上机系（陆攻/局战与袭击机/陆侦/大型陆上机）。
// Ho229 与橘花改同类别（57 噴式戦闘爆撃機）但大分類一个 21 一个 3——
// wikiwiki 条目同向（Ho229「基地航空隊にのみ装備可能」）。判「这件是不是
// 陆航」按大分類逐件裁，不再对类别一刀切（2026-08-11 用户抓出橘花被错杀）。
const LAND_ONLY_T0 = new Set([21, 22, 25, 26])
const AVIATION_TYPES = new Set([
  ...['舰载机', '水上机', '陆航'].flatMap((chip) => EQUIP_CHIP_TYPES[chip]),
])

/**
 * chip 收不收这个类别。与 shipChipMatches 同一套口径：「其他」靠反推，
 * 「全部」不设限，其余按名单。图鉴 / 仓库 / 深海三处都走这里，不各写一份。
 * `type0`（api_type[0] 大分類）可选：传了才启用航空装备的逐件陆航例外。
 */
export const equipChipMatches = (chip: string, type2: number, type0 = -1): boolean => {
  if (chip === '其他') return isOtherEquipCategory(type2)
  const types = EQUIP_CHIP_TYPES[chip]
  if (!types) return true // 全部
  if (AVIATION_TYPES.has(type2) && LAND_ONLY_T0.has(type0)) {
    return chip === '陆航'
  }
  return types.includes(type2)
}

// ---- 「这件是不是舰载机」----
//
// 熟练度列靠它判。原先它是一份**静态类别白名单**（舰载机 ∪ 水上机 ∪ 陆航 三组 chip），
// 于是游戏新加一个航空系类别 id，这一列就直接打 `—`——把「有熟练度」显示成
//「没有熟练度」，是静默错值，比隐身更糟（自扩展体检 2026-08-23 待裁 5）。
//
// 改判据前拿全量装备表逐件核过（纪律五：不对整族一刀切）：
//   · `api_type[4]` **不能用**——它是机体图号，10 件艦上戦闘機在这一格是 0；
//   · `api_type[0]` 大分類**也不够**——t0=5 同时装着水上機系与**電探**（21号対空電探 t0=5）；
//   · `api_mst_slotitem.api_distance`（航続距離）与 `api_cost`（配置コスト）
//     **只有航空装备才有这两格**，非航空装备整个字段不存在。两者覆盖逐件相同，
//     落在 {6,7,8,9,10,11,25,26,41,45,47,48,49,53,56,57} 这些类别上。
//
// 所以判据换成「主数据里这一类有没有装备带着航空专属字段」——类别表自己长出来的，
// 新航空类别一实装就自动进集合，不必等谁去改名单。
const SEED_AIRBORNE_TYPES = [
  ...EQUIP_CHIP_TYPES.舰载机,
  ...EQUIP_CHIP_TYPES.水上机,
  ...EQUIP_CHIP_TYPES.陆航,
]

/**
 * 主数据还没到货时的兜底种子（= 换判据之前那份静态白名单）。
 *
 * 留着它只为一件事：登录前 `mg.master` 是空的，那时按空集判会把**所有**装备说成
 * 非舰载机。种子里那四个 58/59/91/94 是主数据预留、目前 0 件，逐件对拍时不产生差异。
 */
export const AIRBORNE_EQUIP_TYPE_SEED: readonly number[] = Object.freeze([...SEED_AIRBORNE_TYPES])

const SEED_AIRBORNE_SET: ReadonlySet<number> = new Set(SEED_AIRBORNE_TYPES)

/** 主数据里带航空专属字段（航続距離）的装备所属类别。取种子的并集，缺主数据时不塌成空集。 */
export const airborneEquipTypesOf = (
  slotitems: Record<number, { type2?: number; distance?: number }> | null | undefined,
): Set<number> => {
  const out = new Set(SEED_AIRBORNE_TYPES)
  for (const mst of Object.values(slotitems ?? {})) {
    const type2 = Number(mst?.type2)
    if (type2 > 0 && Number(mst?.distance) > 0) out.add(type2)
  }
  return out
}

/**
 * 舰载机（有熟练度的那一类）。非舰载机的 alv 恒为 0，不该显示成「熟练度是零」。
 *
 * `types` 传装配期算好的那一份（`airborneEquipTypesOf`）；不传就退回种子——
 * 渲染热路径里不许逐次扫全表。
 */
export const isAirborneEquip = (
  type2: number,
  types?: ReadonlySet<number> | null,
): boolean => (types ?? SEED_AIRBORNE_SET).has(type2)
