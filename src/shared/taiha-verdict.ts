// 大破了要不要撤：把「玩家此刻有没有决定要做」算清楚，别一律喊撤退。
//
// 原来两处（镝的警告条、铃的通知）各写一句
// `!sunk && !escaped && hpEnd/hpMax <= 0.25` 就当红色警告发出去，
// 于是两种局面被报错了：旗舰大破时游戏**根本不给进击选项**，喊「请选择撤退」
// 是让人去点一个不存在的按钮；联合第二舰队旗舰大破时她**不会轰沉**，
// 把她列进「继续前进可能被击沉」是在给错误的决策信息。
//
// ════ 查证（2026-08-26。口径要改先回来对这一段，每条都记了出处与源数）════
//
// ① 旗舰（单舰队含 7 舰遊撃部隊 / 联合第一舰队旗舰）**战斗大破 → 不能进击、强制返航**。
//    一手源：官方 X（旧 Twitter）2013-08 推文 status/371849680956555264
//    「旗艦が戦闘で大破した場合は『進撃』はできなくなります」；各攻略站转述一致。
//    ——所以这一档没有「选择」，界面该说的是「将强制返航」，不是「请选择撤退」。
//
// ② 例外：该旗舰**装着**応急修理要員（mstId 42）或応急修理女神（43）时，
//    战斗结束后游戏给「消费道具进击 / 撤退」的选择（进击自动消费：要员回血到中破线、
//    女神满血但不补油弹）。源：zekamashi.net 的 damecon 专文 + wiki 共识。
//    ——此时决定权回到玩家手里，照常按危险档警告。
//    2026-09-09 更新：选择权不变，提示改按下述 ④ 的说明档。
//
// ③ **联合舰队第二舰队（护卫队）旗舰**：大破可进击，且**不会轰沉**（系统保护；
//    她也不能被护卫退避，damecon 在她身上不发动）。≥3 独立源：
//    zekamashi 同文「第二艦隊の旗艦に関してのみ…轟沈することはありません。
//    また、ダメコン、女神が使用不能です」；Yahoo 知恵袋多例实测；
//    同行工具 logbook-kai issue #227（专为此加过警告豁免选项）；wikiwiki「連合艦隊」页。
//    ——她不该进「可能被击沉」的名单。
//
// ④ 2026-09-09 用户裁决：带 damecon 的大破舰不劝退、不红警，只说明
//    「进击会消耗、不会击沉」；按下一枚仍可消耗的要员/女神分档。
//    沿革：旧口径是非旗舰带 damecon 不豁免、也不标注，认为消耗女神是大损失而红警。
//
// ---- 舰位坐标 ----
// index 是**跨两队连号**的 0 基舰位：0–5 主力、6–11 护卫队
// （见 mg-types 的 BattleShipView.index、battle.ts 建队处 `add(ctx.fleetShips(2), 6, 6)`，
// 与 shared/sortie-escape 的 rosterAtEscapePosition 同一套坐标）。
// 于是二队旗舰 = index 6，**但只在联合编成时成立**：单队 7 舰的遊撃部隊没有第二队，
// 位 6 是她自己那一队的第七个人，照常算危险——所以剔除必须由联合标志把门。

import type { BattleShipView } from './mg-types'

/** 応急修理要員 / 応急修理女神。两个 id 已对 api_start2 主数据核实（见 test/damecon-rules）。 */
export const DAMECON_MST_IDS: readonly number[] = [42, 43]

/**
 * 大破线：耐久 ≤ 25%。
 *
 * 镝的警告条、铃的通知、出击中的权威 HP 对账（shared/sortie-hp-audit）三处共用这一份。
 * 前两处原先各写一遍同样的字面量，对账再抄第三遍就是第三个会各自漂移的口径。
 * 整数耐久下 `hp / hpMax <= 0.25` 与游戏的 `hp <= floor(hpMax * 0.25)` 同解；
 * 留除法形式是为了与被收编的那两处逐字符一致。
 */
export const isTaihaHp = (hp: number, hpMax: number): boolean => hp / (hpMax || 1) <= 0.25

/** 战斗视图里这一艘算不算大破。沉了、退避了都不算：她不在「继续前进会怎样」的名单里。 */
export const isTaihaShip = (
  ship: Pick<BattleShipView, 'sunk' | 'escaped' | 'hpEnd' | 'hpMax'>,
): boolean => !ship.sunk && !ship.escaped && isTaihaHp(ship.hpEnd, ship.hpMax)

/** 旗舰（单舰队 / 联合第一舰队）的连号舰位。 */
export const FLAGSHIP_INDEX = 0

/** 联合第二舰队旗舰的连号舰位；非联合时这一位不是二队旗舰。 */
export const ESCORT_FLAGSHIP_INDEX = 6

/** 一艘大破舰：舰位、已本地化的名字与下一枚可消耗的损管，判定不碰血量口径。 */
export interface TaihaShipRef {
  index: number
  name: string
  damecon: 42 | 43 | null
}

export type TaihaVerdict =
  /** 旗舰大破且无 damecon：没有进击选项，整队本战结束后返航。 */
  | { tier: 'forced'; flagship: string; others: readonly string[] }
  /** 真有决定要做：名单里的每一艘继续前进都可能被击沉。 */
  | { tier: 'danger'; names: readonly string[]; insured: readonly { name: string; item: 42 | 43 }[] }
  /** 大破舰都有剩余损管：说明消耗与不会击沉，不劝退、不红警。 */
  | { tier: 'insured'; ships: readonly { name: string; item: 42 | 43 }[]; escortFlagship?: string }
  /** 只有二队旗舰大破：系统保护，说明而非警告。 */
  | { tier: 'protected'; escortFlagship: string }

/**
 * 这一格装备里有没有応急修理要員/女神。
 *
 * 传整艘舰的装备（补强增设位也要一起传——女神能装在增设位上，
 * 账本侧 store.ts 已经把 slotEx 并进同一份 equipments）。
 */
export const hasDameconEquipped = (
  items: readonly ({ mstId: number } | null | undefined)[] | null | undefined,
): boolean => (items ?? []).some((item) => item != null && DAMECON_MST_IDS.includes(item.mstId))

/** 账本里查一件装备实例的主数据 id 所需要的两张表；传 `mg` 即可。 */
export interface DameconLedger {
  ships: Record<number, { slot: number[]; slotEx: number } | undefined>
  slotitems: Record<number, { mstId: number } | undefined>
}

/**
 * 这一艘下一枚可消耗的 damecon（规则 ②、④）。
 *
 * 优先用战斗视图自带的装备快照——那是出击当时的编成，游戏报文侧已经把补强增设位
 * 并进同一份（store.ts 的 `equipments` 末尾 push slotEx）。
 *
 * 只有该字段缺席（本功能之前存下的旧战斗快照）才退回游戏报文现查。
 * 这**不违反** BattleShipView.equipment 那条「不能拿当前母港编成回填旧战斗」的纪律：
 * 两个调用方都只在 `sortie.active` 时问，而出击途中游戏不允许改编成，
 * 此刻的母港编成就是这一趟的出击编成，不是拿新编成去解释一场旧战斗。
 */
export const dameconOfShip = (
  ship: BattleShipView,
  ledger?: DameconLedger,
): 42 | 43 | null => {
  const roster = ledger && ship.rosterId != null ? ledger.ships[ship.rosterId] : undefined
  // 与 battle.ts repairItemsFor 的装填顺序一致：store.ts 先常规格、再 push 增设位。
  const equipment = ship.equipment
    ? [...ship.equipment].sort((a, b) =>
        (a.slot === 'ex' ? Infinity : a.slot) - (b.slot === 'ex' ? Infinity : b.slot))
    : roster ? [...roster.slot, roster.slotEx].map((slotId) => ledger?.slotitems[slotId]) : []
  const items = equipment.map((item) => item?.mstId)
    .filter((id): id is 42 | 43 => id === 42 || id === 43)
  if (ship.repairItemUsed != null) items.shift()
  return items[0] ?? null
}

/** 旗舰装着仍可消耗的 damecon 没有（规则 ②）。 */
export const flagshipHasDameconIn = (
  fShips: readonly BattleShipView[],
  ledger?: DameconLedger,
): boolean => {
  const flagship = fShips.find((ship) => ship.index === FLAGSHIP_INDEX)
  return flagship != null && dameconOfShip(flagship, ledger) != null
}

/**
 * 大破名单 → 该给玩家看哪一档。四档互斥，优先级 forced > danger > insured > protected；
 * 没有大破舰、或名单只剩被保护的那一位都算不上的情况返回 null。
 *
 * `combined` 只影响 index 6 的解读（见头注舰位坐标一节）。
 * `damecon` 是**仍可消耗**的下一枚：本场已消费的那枚不再给下一次进击兜底。
 */
export const taihaVerdictOf = (
  taiha: readonly TaihaShipRef[],
  combined: boolean,
): TaihaVerdict | null => {
  if (!taiha.length) return null

  const flagship = taiha.find((ship) => ship.index === FLAGSHIP_INDEX)
  if (flagship && flagship.damecon == null) {
    return {
      tier: 'forced',
      flagship: flagship.name,
      // 整队都要回家，所以其余大破舰照样列名——但她们没有轰沉风险可言了。
      others: taiha.filter((ship) => ship !== flagship).map((ship) => ship.name),
    }
  }

  const escortFlagship = combined
    ? taiha.find((ship) => ship.index === ESCORT_FLAGSHIP_INDEX)
    : undefined

  const others = taiha.filter((ship) => ship !== escortFlagship)
  const danger = others.filter((ship) => ship.damecon == null)
  const insured = others.flatMap((ship) =>
    ship.damecon == null ? [] : [{ name: ship.name, item: ship.damecon }])
  if (danger.length) return { tier: 'danger', names: danger.map((ship) => ship.name), insured }
  if (insured.length) return {
    tier: 'insured',
    ships: insured,
    ...(escortFlagship ? { escortFlagship: escortFlagship.name } : {}),
  }

  return escortFlagship ? { tier: 'protected', escortFlagship: escortFlagship.name } : null
}
