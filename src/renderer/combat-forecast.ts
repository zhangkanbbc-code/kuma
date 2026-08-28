// 渲染层数据适配：把铭的母港状态与 abyssal-stats 的深海最终值，
// 变成 shared/combat-forecast 的纯输入。鉴与镝共用这一处，避免两套预测口径。
import { mg } from './kernel'
import { entityNamePlain } from './localization'
import { SANDBOX_DECK_ID, sandboxDeck } from './sandbox-fleet'
import {
  forecastEncounter,
  summarizeEncounterForecasts,
} from '../shared/combat-forecast'

import type {
  EncounterForecastBand,
  EncounterMechanicForecast,
  ForecastEquipment,
  ForecastFleet,
  ForecastShip,
} from '../shared/combat-forecast'
import type {
  NodeForecastSample,
  PlayerShip,
  PracticeOpponentPreview,
} from '../shared/mg-types'
import { enemyCompIds } from '../shared/map-intel'
import { genericLoadoutByStype } from '../shared/practice-loadout'
import { eventBonusFor } from '../shared/event-bonus-apply'
import { eventBonusPackPageOf } from '../shared/event-bonus-nationality'
import { wavesForCell } from '../shared/land-base-attack'
import type { LandBaseWaveInput } from '../shared/land-base-attack'
import type { EventBonusEntry } from '../shared/event-bonus-apply'
import { isEventMapArea, mapAreaOf, mapNoOf } from '../shared/map-id'
import { shipNationalityOf } from '../shared/ship-nationality'
import { lodeCredit, queryLode } from './kernel'
import type { LodeMeta } from './kernel'
import type { ConfirmedEnemyComp } from '../shared/map-intel'

const pct = (value: number, max: number) =>
  max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 100

const friendlyEquipment = (ship: PlayerShip): ForecastEquipment[] => {
  const ids = ship.slotEx > 0 ? [...ship.slot, ship.slotEx] : ship.slot
  return ids.flatMap((instanceId, index) => {
    if (instanceId <= 0) return []
    const instance = mg.slotitems[instanceId]
    const master = instance ? mg.master.slotitems[instance.mstId] : undefined
    if (!instance || !master) return []
    return [{
      mstId: instance.mstId,
      type2: master.type2,
      iconId: master.iconId,
      los: master.saku,
      firepower: master.houg,
      torpedo: master.raig,
      bomb: master.baku,
      antiAir: master.tyku,
      asw: master.tais,
      accuracy: master.houm,
      evasion: master.houk,
      armor: master.souk,
      level: instance.level,
      proficiency: instance.alv,
      planeCount: index < ship.onslot.length ? ship.onslot[index] ?? 0 : 0,
      preventsTDisadvantage:
        master.type2 === 9 && master.name.includes('彩雲'),
    }]
  })
}

const friendlyShip = (
  ship: PlayerShip,
  futureBattleDepth: number,
  role: ForecastShip['role'],
  flagship = false,
): ForecastShip => {
  const master = mg.master.ships[ship.shipId]
  // ship.fuel / ship.bull 是游戏最近一次同步的“当前剩余量”。这里只允许再扣
  // 从此刻往后的预计战斗；已经发生的战斗绝不能按 battleCount 重扣一次。
  // 全图规划从母港满补给出发时传路线深度；临战预测必须传 0。
  const futureSortieCost = Math.max(0, futureBattleDepth) * 20
  return {
    role,
    mstId: ship.shipId,
    name: master?.name,
    level: ship.lv,
    stype: master?.stype ?? 0,
    ctype: master?.ctype,
    slotNum: master?.slotNum,
    kai: master?.kai,
    flagship,
    hp: Math.max(1, ship.nowhp),
    hpMax: Math.max(1, ship.maxhp),
    firepower: ship.karyoku,
    torpedo: ship.raisou,
    antiAir: ship.taiku,
    armor: ship.soukou,
    evasion: ship.kaihi,
    asw: ship.taisen,
    luck: ship.lucky,
    condition: ship.cond,
    fuelRate: Math.max(0, pct(ship.fuel, master?.fuelMax ?? 0) - futureSortieCost),
    ammoRate: Math.max(0, pct(ship.bull, master?.bullMax ?? 0) - futureSortieCost),
    equipment: friendlyEquipment(ship),
  }
}

export interface ForecastDeckScope {
  canonicalDeckId: number
  deckIds: number[]
  combinedType: number
}

// 第1+第2舰队编成联合后，它们是一个不可拆分的出击单位。即使调用方仍保留
// 旧的“第2舰队”选择，也统一归一到第1舰队代表的联合舰队。
export const forecastDeckScope = (requestedDeckId: number): ForecastDeckScope => {
  // 沙盘是一支不存在于游戏里的编成，永远单队——联合编组是游戏状态，它没有
  if (requestedDeckId === SANDBOX_DECK_ID) {
    return { canonicalDeckId: SANDBOX_DECK_ID, deckIds: [SANDBOX_DECK_ID], combinedType: 0 }
  }
  const combined =
    mg.combinedFlag > 0 && (requestedDeckId === 1 || requestedDeckId === 2)
  return combined
    ? { canonicalDeckId: 1, deckIds: [1, 2], combinedType: mg.combinedFlag }
    : { canonicalDeckId: requestedDeckId, deckIds: [requestedDeckId], combinedType: 0 }
}

export const forecastFleetForDeck = (
  deckId: number,
  futureBattleDepth = 0,
  includeCombined = true,
  /** 当前点位的活动特效倍卡上下文；常规海域传 null */
  eventBonus: EventBonusContext | null = null,
): ForecastFleet => {
  const scope = includeCombined
    ? forecastDeckScope(deckId)
    : { canonicalDeckId: deckId, deckIds: [deckId], combinedType: 0 }
  const ships = scope.deckIds.flatMap((id) => {
    // 沙盘不在 mg.decks 里，成员另取；其余一律照真实编队走
    const deck = id === SANDBOX_DECK_ID ? sandboxDeck() : mg.decks.find((entry) => entry.id === id)
    const role: ForecastShip['role'] =
      scope.combinedType > 0 && id === 2 ? 'escort' : 'main'
    const roster = (deck?.ships ?? []).filter((rosterId) => rosterId > 0)
    return roster
      .map((rosterId) => mg.ships[rosterId])
      .filter(Boolean)
      .map((ship) => {
        // 旗舰补正只认各自舰队的第一位：联合编成里第二舰队也有自己的旗舰
        const built = friendlyShip(ship, futureBattleDepth, role, roster[0] === ship.id)
        const bonus = eventBonusOfShip(ship, eventBonus)
        return bonus.multiplier > 1 ? { ...built, damageBonus: bonus.multiplier } : built
      })
  })
  return {
    ships,
    combinedType: scope.combinedType,
  }
}

const COMBINED_FLEET_LABEL: Record<number, string> = {
  1: '空母机动联合舰队',
  2: '水上打击联合舰队',
  3: '运输护卫联合舰队',
}

export const forecastFleetLabelForDeck = (deckId: number, includeCombined = true): string => {
  const scope = includeCombined
    ? forecastDeckScope(deckId)
    : { canonicalDeckId: deckId, deckIds: [deckId], combinedType: 0 }
  // 只要数舰数，不必构建整支 ForecastFleet（那要做全部装备转换，还每渲染一次）
  const count = scope.deckIds.reduce((sum, id) => {
    const deck = id === SANDBOX_DECK_ID ? sandboxDeck() : mg.decks.find((entry) => entry.id === id)
    return (
      sum +
      (deck?.ships ?? []).filter((rosterId) => rosterId > 0 && mg.ships[rosterId]).length
    )
  }, 0)
  if (scope.combinedType > 0) {
    return `${COMBINED_FLEET_LABEL[scope.combinedType] ?? '联合舰队'} · ${count}舰`
  }
  if (scope.canonicalDeckId === SANDBOX_DECK_ID) return `沙盘 · ${count}舰`
  return scope.canonicalDeckId === 3 && count === 7
    ? `游击舰队 · ${count}舰`
    : `第${scope.canonicalDeckId}舰队 · ${count}舰`
}

const enemyEquipment = (
  stats: any,
): ForecastEquipment[] => {
  const slots: number[] = Array.isArray(stats?.kc3_slots) ? stats.kc3_slots : []
  const counts: number[] = Array.isArray(stats?.api_maxeq) ? stats.api_maxeq : []
  return slots.flatMap((mstId, index) => {
    const master = mg.master.slotitems[mstId]
    if (!master) return []
    return [{
      mstId,
      type2: master.type2,
      iconId: master.iconId,
      los: master.saku,
      firepower: master.houg,
      torpedo: master.raig,
      bomb: master.baku,
      antiAir: master.tyku,
      asw: master.tais,
      accuracy: master.houm,
      evasion: master.houk,
      armor: master.souk,
      level: 0,
      proficiency: 0,
      planeCount: counts[index] ?? 0,
      preventsTDisadvantage: false,
    }]
  })
}

const enemyShip = (mstId: number, abyssalStats: Record<string, any>): ForecastShip => {
  const stats = abyssalStats?.[`${mstId}`] ?? {}
  const master = mg.master.ships[mstId]
  const number = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const hp = number(stats.api_taik, master?.baseTaik ?? 1)
  return {
    role: 'main',
    mstId,
    // 对地补正靠族名分类 + api_soku 判陆上型，两者都得给到计算层
    name: master?.name ?? '',
    speed: master?.soku ?? 1,
    level: 1,
    stype: master?.stype ?? 0,
    hp: Math.max(1, hp),
    hpMax: Math.max(1, hp),
    firepower: number(stats.api_houg, master?.baseHoug ?? 0),
    torpedo: number(stats.api_raig, master?.baseRaig ?? 0),
    antiAir: number(stats.api_tyku, master?.baseTyku ?? 0),
    armor: number(stats.api_souk, master?.baseSouk ?? 0),
    evasion: number(stats.kc3_evas, master?.baseKaihi ?? 0),
    asw: number(stats.kc3_asw, master?.baseTais ?? 0),
    luck: number(stats.api_luck, master?.baseLuck ?? 0),
    condition: 49,
    fuelRate: 100,
    ammoRate: 100,
    equipment: enemyEquipment(stats),
  }
}

export const forecastEnemyFleet = (
  mstIds: number[],
  abyssalStats: Record<string, any>,
): ForecastFleet => {
  const ids = mstIds.filter((id) => id > 0)
  // 敌联合舰队:资料包的联合编成是主力 6 + 随伴 6(顺序与战斗 API 的 eShips
  // 一致),第 7 舰起标 escort、combinedType 标 4——让模型走联合分段:敌主力
  // 炮击两轮、夜战只有敌随伴出手。4 不落在 1/2/3 上是有意的:位置命中补正表
  // (fleetPositionBonus)写的是我方三种联合的口径,敌联合不吃那张表。
  // ec_battle 更细的巡目目标分配未逐条校准,估算说明栏的「未计入」照旧兜底。
  const combined = ids.length > 6
  return {
    ships: ids.map((id, index) =>
      combined && index >= 6
        ? { ...enemyShip(id, abyssalStats), role: 'escort' as const }
        : enemyShip(id, abyssalStats),
    ),
    combinedType: combined ? 4 : 0,
  }
}

// 演习对手的通用配装 = 该形态的**初期装备**（kcwiki-ships，ID 即 api_id）。
// 口径（2026-08-10 拍板）：玩家舰队默认不可能裸装——裸装建模曾把 D 败预测成
// B+ 64–91%（对手双空母 84 机在模型里是 0 机，制空判定整个颠倒）。初期装备是
// 每个玩家至少拥有的下界，实战配置通常更强，所以它撑的是区间的乐观边，
// 文案里要说清。送经验的空装编成是唯一的裸装例外，不进区间、单独提示。
let stockEquipByMst = new Map<number, { equip: number[]; onslot: number[] }>()
let stockEquipRequested = false
const ensureStockEquip = () => {
  if (stockEquipRequested) return
  stockEquipRequested = true
  void queryLode('kcwiki-ships')
    .catch((error) => {
      // 失败要放行下次重试：置位不复原的话，本会话的通用配装就永远缺席了
      stockEquipRequested = false
      console.warn('[kanso] 演习配装矿脉读取失败', error)
      return null
    })
    .then((lode) => {
      if (!lode?.data) return
      const map = new Map<number, { equip: number[]; onslot: number[] }>()
      for (const entry of Object.values<any>(lode.data)) {
        const id = Number(entry?.ID)
        const gear = entry?.装备
        if (!Number.isFinite(id) || id <= 0 || !gear) continue
        const equip = Array.isArray(gear.初期装备)
          ? gear.初期装备.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
          : []
        const onslot = Array.isArray(gear.搭载)
          ? gear.搭载.map((n: unknown) => Math.max(0, Number(n) || 0))
          : []
        if (equip.length) map.set(id, { equip, onslot })
      }
      stockEquipByMst = map
    })
}

const forecastEquipFromMaster = (
  equipMstId: number,
  planeCount: number,
): ForecastEquipment | null => {
  const master = mg.master.slotitems[equipMstId]
  if (!master) return null
  return {
    mstId: equipMstId,
    type2: master.type2,
    iconId: master.iconId,
    los: master.saku,
    firepower: master.houg,
    torpedo: master.raig,
    bomb: master.baku,
    antiAir: master.tyku,
    asw: master.tais,
    accuracy: master.houm,
    evasion: master.houk,
    armor: master.souk,
    level: 0, // 改修与熟练度未知，按 0——装备本体已经是主要的失真来源
    proficiency: 0,
    planeCount,
    preventsTDisadvantage: master.type2 === 9 && master.name.includes('彩雲'),
  }
}

/**
 * 通用配装展开成预测输入。首选 kcwiki 的初期装备；那个包停更已久、
 * 现代形态整批缺档（正是这些对手曾把 D 败预测成 B+），缺档时按舰种
 * 通用模板兜底（shared/practice-loadout，模型常数）。两头都查不到才裸装。
 */
const stockEquipmentFor = (mstId: number): ForecastEquipment[] => {
  const stock = stockEquipByMst.get(mstId)
  if (stock) {
    const fromStock = stock.equip.flatMap((equipMstId, index) => {
      const built = forecastEquipFromMaster(equipMstId, stock.onslot[index] ?? 0)
      return built ? [built] : []
    })
    if (fromStock.length) return fromStock
  }
  const master = mg.master.ships[mstId]
  if (!master) return []
  const slots = master.slotNum ?? master.maxEq?.length ?? 0
  return genericLoadoutByStype(master.stype, slots).flatMap((pick, index) => {
    const planeCount = pick.plane ? Math.max(1, master.maxEq?.[index] ?? 0) : 0
    const built = forecastEquipFromMaster(pick.mstId, planeCount)
    return built ? [built] : []
  })
}

const practiceOpponentShip = (
  entry: PracticeOpponentPreview['ships'][number],
  bound: 'min' | 'max',
): ForecastShip | null => {
  const master = mg.master.ships[entry.mstId]
  if (!master) return null
  const upper = bound === 'max'
  const value = (min: number, max: number) =>
    Math.max(0, upper ? (Number.isFinite(max) && max > 0 ? max : min) : min)
  const hp = Math.max(1, value(master.baseTaik, master.maxTaik))
  return {
    role: 'main',
    mstId: entry.mstId,
    level: Math.max(1, entry.level),
    stype: master.stype,
    hp,
    hpMax: hp,
    firepower: value(master.baseHoug, master.maxHoug),
    torpedo: value(master.baseRaig, master.maxRaig),
    antiAir: value(master.baseTyku, master.maxTyku),
    armor: value(master.baseSouk, master.maxSouk),
    evasion: value(master.baseKaihi, master.maxKaihi),
    asw: value(master.baseTais, master.maxTais),
    luck: value(master.baseLuck, master.maxLuck),
    condition: 49,
    fuelRate: 100,
    ammoRate: 100,
    // get_practice_enemyinfo 不公开装备。按通用配装（该形态初期装备）建模——
    // 玩家舰队默认不裸装；包里查不到的形态回退空数组，不硬造。
    equipment: stockEquipmentFor(entry.mstId),
  }
}

const practiceOpponentFleet = (
  preview: PracticeOpponentPreview,
  bound: 'min' | 'max',
): ForecastFleet => ({
  ships: preview.ships.flatMap((entry) => {
    const ship = practiceOpponentShip(entry, bound)
    return ship ? [ship] : []
  }),
  combinedType: 0,
})

export interface PracticeOpponentForecast {
  band: EncounterForecastBand
  fleetLabel: string
  resolvedShips: number
}

// 同输入不重算：一次演习预测 = 2 边界 × 5 阵型 = 10 次完整交战模型，
// 而母港里 ships/decks 任一 patch 都会带着它重渲染
let practiceForecastCache: { key: string; result: PracticeOpponentForecast | null } | null = null

const practiceDeckSignature = (deckId: number): string => {
  const deck = mg.decks.find((entry) => entry.id === deckId)
  let sig = ''
  for (const rosterId of deck?.ships ?? []) {
    if (rosterId <= 0) continue
    const ship = mg.ships[rosterId]
    if (!ship) continue
    sig += `|${rosterId}:${ship.shipId}:${ship.lv}:${ship.nowhp}:${ship.fuel}:${ship.bull}:${ship.cond}`
    for (const slotId of [...ship.slot, ship.slotEx]) {
      if (slotId <= 0) continue
      const inst = mg.slotitems[slotId]
      sig += `,${inst?.mstId ?? 0}:${inst?.level ?? 0}:${inst?.alv ?? 0}`
    }
  }
  return sig
}

// 对手详情只公开舰娘形态与等级，不公开装备、改修、最终面板和开战阵型。
// 属性跨“原生初始～原生上限”、装备按通用配装（初期装备）、阵型跨五种通常阵，
// 求边界输出倾向而不是伪造单点概率。敌方是玩家舰队，观测射击层对他同样成立。
export const forecastPracticeOpponent = (
  deckId: number,
  preview: PracticeOpponentPreview,
): PracticeOpponentForecast | null => {
  ensureStockEquip()
  const cacheKey = JSON.stringify([
    deckId,
    practiceDeckSignature(deckId),
    preview.ships.map((entry) => [entry.mstId, entry.level]),
    stockEquipByMst.size, // 通用配装矿脉到位前后结果不同
  ])
  if (practiceForecastCache?.key === cacheKey) return practiceForecastCache.result
  // 演习实际只下发 api_deck_id 指定的单舰队，不继承母港的联合舰队编组。
  const friendly = forecastFleetForDeck(deckId, 0, false)
  const enemyMin = practiceOpponentFleet(preview, 'min')
  const enemyMax = practiceOpponentFleet(preview, 'max')
  if (!friendly.ships.length || !enemyMin.ships.length || !enemyMax.ships.length) {
    practiceForecastCache = { key: cacheKey, result: null }
    return null
  }
  const enemyFormations = [1, 2, 3, 4, 5]
  const forecasts = [enemyMin, enemyMax].flatMap((enemy) =>
    enemyFormations.map((enemyFormation) =>
      forecastEncounter({ friendly, enemy, enemyFormation, enemySpotting: true }),
    ),
  )
  const band = summarizeEncounterForecasts(forecasts)
  const result: PracticeOpponentForecast = {
    band: { ...band, confidence: 'C' },
    fleetLabel: forecastFleetLabelForDeck(deckId, false),
    resolvedShips: enemyMin.ships.length,
  }
  practiceForecastCache = { key: cacheKey, result }
  return result
}

// 确认目录里的阵形常见两种写法：数字编号或 wiki 字符串（「複縦」「輪形」…）。
// 字符串一律当单纵会把轮形阵（炮击 0.7×）的点悄悄按 1.0 算，区间失真且无挂牌。
const FORMATION_BY_NAME: [string, number][] = [
  ['第一警戒', 11],
  ['第二警戒', 12],
  ['第三警戒', 13],
  ['第四警戒', 14],
  // 活动页的敌联合阵形只写「第四」这样的简写(2026-08-12 E4 实锤)
  ['第一', 11],
  ['第二', 12],
  ['第三', 13],
  ['第四', 14],
  ['複縦', 2],
  ['复纵', 2],
  ['輪形', 3],
  ['轮形', 3],
  ['梯形', 4],
  ['単横', 5],
  ['单横', 5],
  ['警戒', 6],
  ['単縦', 1],
  ['单纵', 1],
]
const formationNumberOf = (value: number | string): number => {
  if (typeof value === 'number') return value
  const name = `${value}`
  for (const [key, id] of FORMATION_BY_NAME) if (name.includes(key)) return id
  return 1
}

// 确认目录的阵形格常写多个阵形（「単縦 複縦 梯形」）——formationNumberOf 只取
// 表序第一个命中（上例会静默按复纵算）。这里拆成逐个编号：「航行序列」是警戒阵
// 名的后缀先剥掉；认不出的 token 原样保留，不静默丢——丢了它，界面上那个阵形
// 就凭空消失还不留痕。
export const formationTokensOf = (value: number | string): (number | string)[] => {
  if (typeof value === 'number') return [value]
  const tokens = `${value}`
    .replace(/航行序列/g, ' ')
    .split(/[\s、,，/／·・]+/)
    .filter(Boolean)
  const out: (number | string)[] = []
  for (const token of tokens) {
    const id = FORMATION_BY_NAME.find(([key]) => token.includes(key))?.[1] ?? token
    if (!out.includes(id)) out.push(id)
  }
  return out.length ? out : [value]
}

export const forecastConfirmedComp = (
  deckId: number,
  comp: { formation: number | string; ships: number[] },
  abyssalStats: Record<string, any>,
  futureBattleDepth = 0,
  eventBonus: EventBonusContext | null = null,
  landBaseWaves: readonly LandBaseWaveInput[] = [],
): EncounterMechanicForecast =>
  forecastEncounter({
    friendly: forecastFleetForDeck(deckId, futureBattleDepth, true, eventBonus),
    enemy: forecastEnemyFleet(comp.ships, abyssalStats),
    enemyFormation: formationNumberOf(comp.formation),
    landBaseWaves,
  })

/**
 * 本次出击派向该点的陆航波次。
 * 只算**派向这个点**的：目标点由出击时的 start_air_base 下发，存在 sortie.airBaseStrikes。
 * 没派就是没派——道中点不能白送输出。
 */
export const landBaseWavesAt = (
  cell: number,
  enemyCombined: boolean,
  // 敌方编成里陆上型目标的占比。它同时决定了 againstLand——
  // 给了 share 之后 landBaseWavePower 根本不读 againstLand，
  // 再让调用方传一个 `share === 1` 只是死信息，读的人会以为两个都起作用。
  landTargetShare: number,
): LandBaseWaveInput[] => {
  const againstLand = landTargetShare >= 1
  const sortie = mg.sortie
  if (!sortie?.active) return []
  const area = sortie.mapArea
  const waves: LandBaseWaveInput[] = []
  for (const squad of mg.airBases) {
    if (squad.areaId !== area) continue
    const count = wavesForCell(sortie.airBaseStrikes, squad.rid, cell)
    if (!count) continue
    const planes = squad.planes.flatMap((slot) => {
      const instance = slot.slotId > 0 ? mg.slotitems[slot.slotId] : undefined
      const master = instance ? mg.master.slotitems[instance.mstId] : undefined
      if (!master || slot.count <= 0) return []
      return [{
        type2: master.type2,
        torpedo: master.raig,
        bomb: master.baku,
        level: instance?.level ?? 0,
        count: slot.count,
        mstId: instance?.mstId,
      }]
    })
    if (!planes.length) continue
    for (let i = 0; i < count; i += 1) {
      waves.push({ planes, againstLand, enemyCombined, landTargetShare })
    }
  }
  return waves
}

export interface LandBaseDispatch {
  rid: number
  name: string
  waves: number
  /** 有机可派的格数；0 = 该队全空，波次不会产生输出 */
  slots: number
}

/**
 * 派向该点的各航空队与波次，供 UI 说明陆航那部分输出是谁打出来的。
 * 与 landBaseWavesAt 同一判据（areaId + start_air_base 的目标点），两处不会各说各话。
 */
export const landBaseDispatchAt = (cell: number): LandBaseDispatch[] => {
  const sortie = mg.sortie
  if (!sortie?.active) return []
  const out: LandBaseDispatch[] = []
  for (const squad of mg.airBases) {
    if (squad.areaId !== sortie.mapArea) continue
    const waves = wavesForCell(sortie.airBaseStrikes, squad.rid, cell)
    if (!waves) continue
    out.push({
      rid: squad.rid,
      name: squad.name || `第${squad.rid}航空队`,
      waves,
      slots: squad.planes.filter((slot) => slot.slotId > 0 && slot.count > 0).length,
    })
  }
  return out.sort((a, b) => a.rid - b.rid)
}

export interface ResolvedCompForecast {
  comp: ConfirmedEnemyComp
  ids: number[]
  forecast: EncounterMechanicForecast
}

export const forecastConfirmedComps = (
  deckId: number,
  comps: ConfirmedEnemyComp[],
  abyssalStats: Record<string, any>,
  futureBattleDepth = 0,
): { rows: ResolvedCompForecast[]; band: EncounterForecastBand | null } => {
  const rows = comps.flatMap((comp) => {
    // 只吃维护期定好并经人工批准的号。以前这里在运行时按名字反解，
    // 「重巡夏姫(A)(HP400)」这种同名多形态一猜错，算出来的胜率就是另一支敌队的。
    const numeric = enemyCompIds(comp)
    if (!numeric) return []
    return [{
      comp,
      ids: numeric,
      forecast: forecastConfirmedComp(
        deckId,
        { formation: comp.formation, ships: numeric },
        abyssalStats,
        futureBattleDepth,
      ),
    }]
  })
  return {
    rows,
    band: rows.length
      ? summarizeEncounterForecasts(rows.map((row) => row.forecast))
      : null,
  }
}

export const historicalRate = (
  sample: NodeForecastSample | null | undefined,
  kind: 'bPlus' | 'sa' | 'taiha',
): { value: number; total: number } | null => {
  if (!sample || sample.total <= 0) return null
  const hits =
    kind === 'bPlus' ? sample.wins : kind === 'sa' ? sample.saWins : sample.taiha
  return {
    value: Math.round((hits / Math.max(1, sample.total)) * 100),
    total: sample.total,
  }
}

// ---- 活动特效倍卡的接线 ----
//
// 资料包给的是「舰种/国籍/个别舰/装备组 → 倍率」，这里负责把它对上当前局面：
// 海域号 → E 图编号、cell → 点位字母、装备组成员名 → mstId。
// 算完塞进 ForecastShip.damageBonus，战斗模型只认那一个数。

let eventBonusLode: { meta: LodeMeta; data: any } | null | undefined

export const loadEventBonusLode = async (): Promise<{ meta: LodeMeta; data: any } | null> => {
  if (eventBonusLode === undefined) eventBonusLode = await queryLode('event-bonus')
  return eventBonusLode ?? null
}

/** 已加载的倍卡包；未加载时为 null（同步取用，渲染路径上不等 IO）。 */
export const cachedEventBonusLode = (): { meta: LodeMeta; data: any } | null =>
  eventBonusLode ?? null

/** 海域 id → 倍卡表的活动图编号。常规海域没有倍卡，返回 null。 */
export const eventKeyOf = (mapId: number): string | null => {
  const area = mapAreaOf(mapId)
  return isEventMapArea(area) ? `E${mapNoOf(mapId)}` : null
}

/**
 * 装备组成员名 → mstId。资料包里存的是名字（抓取期不便固化 id，主数据在手更不易过期），
 * 匹配放在运行时做，用 master 的正式名精确比对——**不做模糊匹配**：
 * 「特大発動艇+チハ」与「九七式中戦車(チハ)」是两件完全不同的装备。
 */
// 「装备名 → mstId」索引按 master 表引用缓存：master 只在 start2 到来时整体换新，
// 之前每次渲染（mg 任一 patch 都会触发）都全表重建一张 Map
const equipNameIndexCache = new WeakMap<object, Map<string, number>>()
const equipNameIndex = (): Map<string, number> => {
  const slotitems = mg.master.slotitems as unknown as object
  let byName = equipNameIndexCache.get(slotitems)
  if (!byName) {
    byName = new Map<string, number>()
    for (const [id, item] of Object.entries(mg.master.slotitems)) {
      if (item?.name) byName.set(item.name.replace(/\s+/g, ''), Number(id))
    }
    equipNameIndexCache.set(slotitems, byName)
  }
  return byName
}

const equipGroupIds = (groups: Record<string, string[]>): Record<string, number[]> => {
  const byName = equipNameIndex()
  const out: Record<string, number[]> = {}
  for (const [group, names] of Object.entries(groups)) {
    out[group] = names.flatMap((name) => {
      const id = byName.get(String(name).replace(/\s+/g, ''))
      return id ? [id] : []
    })
  }
  return out
}

export interface EventBonusContext {
  entries: EventBonusEntry[]
  groups: Record<string, number[]>
  nodeLetter: string | null
  credit: string | null
  /**
   * 资料包当前指着的 kcwiki 活动页名 —— 国籍例外台账的期号。
   * 换期后台账对不上就整段不生效，退回纯号段（见 shared/event-bonus-nationality）。
   */
  packPage: string | null
}

/** 组装当前海域/点位的倍卡上下文。没有倍卡（常规海域、资料包缺该图）时返回 null。 */
export const eventBonusContext = (
  lode: { meta: LodeMeta; data: any } | null,
  mapId: number,
  nodeLetter: string | null,
): EventBonusContext | null => {
  const key = eventKeyOf(mapId)
  if (!key || !lode?.data?.events) return null
  const event = lode.data.events[key]
  if (!event?.entries?.length) return null
  return {
    entries: event.entries as EventBonusEntry[],
    groups: equipGroupIds(event.equipGroups ?? {}),
    nodeLetter,
    credit: lodeCredit(lode.meta),
    packPage: eventBonusPackPageOf(lode.meta?.sourceUrl),
  }
}

/** 给一艘舰算出它在当前点吃到的倍卡总倍率。 */
export const eventBonusOfShip = (
  ship: PlayerShip,
  context: EventBonusContext | null,
): { multiplier: number; certain: boolean; applied: EventBonusEntry[] } => {
  if (!context) return { multiplier: 1, certain: true, applied: [] }
  const master = mg.master.ships[ship.shipId]
  const equipIds = (ship.slotEx > 0 ? [...ship.slot, ship.slotEx] : ship.slot)
    .filter((id) => id > 0)
    .map((id) => mg.slotitems[id]?.mstId)
    .filter((id): id is number => typeof id === 'number')
  const result = eventBonusFor(
    {
      mstId: ship.shipId,
      name: master?.name ?? '',
      stype: master?.stype ?? 0,
      nationality: shipNationalityOf({ api_sort_id: master?.sortId })?.short ?? null,
    },
    equipIds,
    context.entries,
    context.nodeLetter,
    context.groups,
    context.packPage,
  )
  return { multiplier: result.multiplier, certain: result.certain, applied: result.applied }
}

export interface EventBonusFleetRow {
  mstId: number
  name: string
  multiplier: number
  certain: boolean
  /** 逐条写清叠乘了哪几项，UI 悬停即可看到「凭什么是这个数」 */
  reasons: string[]
}

export interface EventBonusFleetSummary {
  rows: EventBonusFleetRow[]
  /** 任一舰吃到区间值或暂估值即为 false，整栏都要挂牌 */
  certain: boolean
  credit: string | null
}

/**
 * 当前出击编成在该点吃到的倍卡逐舰明细。
 * 只列**真吃到**的（倍率 > 1）——没吃到的舰列出来只会稀释信息。
 */
export const eventBonusFleetSummary = (
  deckId: number,
  context: EventBonusContext | null,
): EventBonusFleetSummary | null => {
  if (!context) return null
  const scope = forecastDeckScope(deckId)
  const rows: EventBonusFleetRow[] = []
  for (const id of scope.deckIds) {
    const deck = mg.decks.find((entry) => entry.id === id)
    for (const rosterId of deck?.ships ?? []) {
      if (rosterId <= 0) continue
      const ship = mg.ships[rosterId]
      if (!ship) continue
      const bonus = eventBonusOfShip(ship, context)
      if (bonus.multiplier <= 1) continue
      rows.push({
        mstId: ship.shipId,
        // 这一行只进 di.ts 的悬停明细；同一枚 chip 的面文早就是中文了，
        // 只有悬停里逐舰那份还在直取主数据的日文原名（2026-08-25 汉化清点）
        name: entityNamePlain('ship', ship.shipId, mg.master.ships[ship.shipId]?.name ?? `舰 #${ship.shipId}`),
        multiplier: bonus.multiplier,
        certain: bonus.certain,
        reasons: bonus.applied.map(
          (entry) => `${entry.scope}·${entry.key} ×${entry.value}${entry.certain ? '' : '（暂估）'}`,
        ),
      })
    }
  }
  if (!rows.length) return null
  return {
    rows,
    certain: rows.every((row) => row.certain),
    credit: context.credit,
  }
}
