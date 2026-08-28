// 舰队派生度量：制空值 / 索敌33式 / 制空状态判定。
//
// 制空与索敌的实现移植自 poi views/utils/game-utils.ts 的 getTyku / getSaku33
// (https://github.com/poooi/poi, MIT License, Copyright (c) poi contributors)，
// 并与《舰队收藏-战斗计算模型.md》§13.1（每格制空值）、§13.2（制空状态）逐条核对：
//   slotAirPower = floor((対空 + 改修対空) * sqrt(搭载数) + 熟练度补正)
//   熟练度补正 = sqrt(内部熟练/10) + 机种固定表
// 熟练度只有区间可知（界面★对应一段内部值），故给出 min/max 两端而非单值——
// 这是诚实边界：被动只读拿不到内部熟练度精确值，不编造中间数。
//
// TP（輸送物資量）口径已抽到 shared/transport-point（通用表）与 shared/event-tp-rules（图专用表）。
import { isEscapedInSortie, mg, queryLode } from './kernel'

import type { PlayerShip } from '../shared/mg-types'
import { los33Of } from '../shared/fleet-los33'
import { TP_GENERAL, transportPointOf } from '../shared/transport-point'

import type { TransportPoint, TransportTable } from '../shared/transport-point'
import { FIT_PANEL_GROWTH_KEYS, observedFitBonus } from '../shared/fit-bonus'
import {
  calibrateGrowth,
  growthEndpoints,
  growthGateKey,
  growthReverseEnabled,
  growthValueAt,
} from '../shared/ship-growth'

import type { FitObserved, FitPanelKey } from '../shared/fit-bonus'
import type { GrowthGate, GrowthVerdict, ShipGrowthKey, ShipStatsPack } from '../shared/ship-growth'

// 内部熟练度经验分档（alv 0-7 各档起点，[8] 为满档上界）
const AIRCRAFT_EXP = [0, 10, 25, 40, 55, 70, 85, 100, 121]

// 机种 × 熟练度的固定制空加成（api_type[2] → alv 索引）
const LEVEL_BONUS: Record<number, number[]> = {
  6: [0, 0, 2, 5, 9, 14, 14, 22, 22], // 艦上戦闘機
  7: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 艦上爆撃機
  8: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 艦上攻撃機
  11: [0, 1, 1, 1, 1, 3, 3, 6, 6], // 水上爆撃機
  26: [0, 0, 2, 5, 9, 14, 14, 22, 22], // 対潜哨戒機
  45: [0, 0, 2, 5, 9, 14, 14, 22, 22], // 水上戦闘機
  47: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 陸上攻撃機
  48: [0, 0, 2, 5, 9, 14, 14, 22, 22], // 局地戦闘機
  56: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 噴式戦闘機
  57: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 噴式戦闘爆撃機
  58: [0, 0, 0, 0, 0, 0, 0, 0, 0], // 噴式攻撃機
}

export interface AirPower {
  basic: number // 不含熟练度的裸制空
  min: number // 熟练度区间下界
  max: number // 熟练度区间上界
}

/**
 * 把已经退避的舰从「这支舰队现在还剩谁」里拿掉。
 *
 * 退避舰之后的节点一律不参战——制空、索敌、输送量、大破名单都得按剩下的人算，
 * 否则玩家看到的是一支**已经不存在**的舰队的数。判据走内核那一份
 *（shared/sortie-escape → kernel.isEscapedInSortie），与锐的退场卡同源；
 * 返港时 sortie.active 落下，这里下一次调用就自动全放行。
 *
 * 只在「按当前舰队算数」的地方用它。**编成列表本身不许过滤**：
 * 退避舰的位置还占着，她只是退到幕后了，不是从编成里消失。
 */
export const engagedShips = <T extends { id: number }>(ships: readonly T[]): T[] =>
  ships.filter((ship) => !isEscapedInSortie(ship.id))

export interface Los33 {
  ship: number // 舰娘裸装索敌贡献
  item: number // 装备索敌贡献
  teitoku: number // 提督 Lv 扣减
  total: number
}

// 制空只关心「装备槽 + 各槽搭载数」。PlayerShip 结构上满足它，
// 基地航空队的中队也能直接拼出来 —— 两边共用同一实现，不必造假 PlayerShip。
export interface AirSlots {
  slot: number[] // 装备实例 id，≤0 为空
  onslot: number[] // 各槽当前搭载数
}

/** 制空值。landbase: 0 舰队 / 1 基地出击 / 2 基地防空 */
export const fleetAirPower = (ships: AirSlots[], landbase = 0): AirPower => {
  let basic = 0
  let min = 0
  let max = 0
  let reconBonus = 1

  for (const ship of ships) {
    ship.slot.forEach((instId, slotIdx) => {
      if (instId <= 0) return
      const onslot = ship.onslot[slotIdx] ?? 0
      if (onslot < 1) return // 没搭载就不参加制空争夺
      const inst = mg.slotitems[instId]
      const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
      if (!inst || !mst) return

      const alv = Math.max(0, Math.min(7, inst.alv ?? 0))
      const bonus = LEVEL_BONUS[mst.type2]?.[alv] ?? 0
      // 改修对制空的加成系数：仅対空 > 3 的机种吃，带爆装的 0.25 / 否则 0.2
      const lvFactor = mst.tyku > 3 ? (mst.baku > 0 ? 0.25 : 0.2) : 0
      const root = Math.sqrt(onslot)
      const profLo = Math.sqrt(AIRCRAFT_EXP[alv] / 10)
      const profHi = Math.sqrt((AIRCRAFT_EXP[alv + 1] - 1) / 10)

      const accumulate = (tempTyku: number, countBasic = true) => {
        if (countBasic) basic += Math.floor(root * mst.tyku)
        min += Math.floor(tempTyku + profLo)
        max += Math.floor(tempTyku + profHi)
      }

      const t2 = mst.type2
      if ([6, 7, 45, 47, 57].includes(t2) || (t2 === 26 && mst.tyku > 0)) {
        accumulate(root * (mst.tyku + (inst.level || 0) * lvFactor) + bonus)
      } else if ([8, 11].includes(t2)) {
        accumulate(root * mst.tyku + bonus)
      } else if (t2 === 48) {
        // 局地戦闘機：基地防空/出击时吃对空补正
        let lb = 0
        if (landbase === 1) lb = 1.5 * mst.houk
        else if (landbase === 2) lb = mst.houk + 2 * mst.houm
        accumulate(root * (mst.tyku + lb + (inst.level || 0) * lvFactor) + bonus)
      } else if ([10, 41].includes(t2)) {
        // 水偵/大型飛行艇：只在基地生效
        if (landbase === 2) {
          reconBonus = Math.max(reconBonus, mst.saku >= 9 ? 1.16 : mst.saku === 8 ? 1.13 : 1.1)
        } else if (landbase === 1) {
          accumulate(root * mst.tyku, false)
        }
      } else if (t2 === 9 && landbase === 2) {
        reconBonus = Math.max(reconBonus, mst.saku >= 9 ? 1.3 : 1.2)
      } else if (t2 === 49) {
        // 陸上偵察機
        if (landbase === 1) {
          accumulate(root * (mst.tyku + (inst.level || 0) * lvFactor))
          reconBonus = Math.max(reconBonus, mst.saku >= 9 ? 1.18 : 1.15)
        } else if (landbase === 2) {
          reconBonus = Math.max(reconBonus, mst.saku >= 9 ? 1.23 : 1.18)
        }
      }
    })
  }

  return {
    basic: Math.floor(basic * reconBonus),
    min: Math.floor(min * reconBonus),
    max: Math.floor(max * reconBonus),
  }
}

/**
 * 索敌 33 式（分岐点係数可变）。
 * total = Σ√(舰娘裸装索敌) + Σ(装备索敌×系数)×係数 - ceil(提督Lv×0.4) + 2×(空格数)
 * slotCount：通常舰队 6 / 游击部队 7 / 联合舰队 12。
 */
export const fleetLos33 = (
  ships: PlayerShip[],
  admiralLv: number,
  mapModifier = 1,
  slotCount = 6,
): Los33 => {
  // 数学核在 shared/fleet-los33（los33Of）：出击样本要在主进程算同一份，
  // 这里只负责把 mg 里的实例/主数据解析成核的输入。未解析出的装备照旧跳过。
  const inputs = ships.map((ship) => {
    const allSlots = ship.slotEx > 0 ? [...ship.slot, ship.slotEx] : ship.slot
    const items = allSlots.flatMap((instId) => {
      if (instId <= 0) return []
      const inst = mg.slotitems[instId]
      const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
      if (!inst || !mst) return []
      return [{ saku: mst.saku, type2: mst.type2, level: inst.level || 0 }]
    })
    return { panelLos: ship.sakuteki, items }
  })
  return los33Of(inputs, admiralLv, mapModifier, slotCount)
}

// ---- TP（輸送物資量）----
//
// 口径与两套表（通用 / 图专用）都在 shared/transport-point 与 shared/event-tp-rules，
// 这里只剩「把 mg 里的舰摊成计算核吃的形状」这一层。
// 到达扬陆点时**大破的舰**，连同其装备一律不计入（本函数按当前 HP 判定并单列出来）。
// 未覆盖：鬼怒改二等单舰特殊补正（消费端标注说明）。

const transportUnitOf = (ship: PlayerShip) => ({
  stype: mg.master.ships[ship.shipId]?.stype ?? 0,
  // 大破（HP ≤ 25%）到达扬陆点则整舰不计，装备也不计
  wrecked: ship.maxhp > 0 && ship.nowhp / ship.maxhp <= 0.25,
  equips: [...ship.slot, ship.slotEx].flatMap((instId) => {
    if (instId <= 0) return []
    const inst = mg.slotitems[instId]
    if (!inst) return []
    const em = mg.master.slotitems[inst.mstId]
    return em ? [{ mstId: inst.mstId, name: em.name }] : []
  }),
})

/**
 * 舰队输送物资量。大破舰按规则整舰（含装备）排除。
 *
 * 入参是**分好队的**编成：单编成传 `[ships]`，联合传 `[第一舰队, 第二舰队]`
 * ——图专用表要按队各自取整（见 shared/transport-point 头注）。
 *
 * `table` 不给就按通用口径算。要按活动图的专用表算，
 * 由消费端用 shared/event-tp-rules 的 `activeEventTpRuleOf` + `eventTpTableOf` 取一张传进来
 * ——「现在算不算特殊语境」是游戏状态问题，不该由这个纯换算层来判。
 */
export const fleetTp = (
  fleets: readonly PlayerShip[][],
  table: TransportTable = TP_GENERAL,
): TransportPoint => transportPointOf(fleets.map((ships) => ships.map(transportUnitOf)), table)

/**
 * 按「装备 mstId + 搭载数」直接算裸制空——用于深海舰（无改修、无熟练度，
 * 故只有 basic 那一档，不存在区间）。玩家舰请用 fleetAirPower。
 */
export const rawAirPower = (slots: { mstId: number; count: number }[]): number => {
  let total = 0
  for (const { mstId, count } of slots) {
    if (count < 1) continue
    const mst = mg.master.slotitems[mstId]
    if (!mst) continue
    const t2 = mst.type2
    // 参加制空争夺的机种，与 fleetAirPower 同口径
    const fights = [6, 7, 8, 11, 45, 47, 57].includes(t2) || (t2 === 26 && mst.tyku > 0)
    if (!fights) continue
    total += Math.floor(Math.sqrt(count) * mst.tyku)
  }
  return total
}

// ---- 制空状态（战斗计算模型 §13.2；整数乘法比较，不碰浮点边界）----

/** 达成各档所需的我方最低制空值（用于「还差多少」提示） */
export const airThresholds = (e: number) => ({
  劣势: Math.floor(e / 3) + 1,
  均衡: Math.floor((2 * e) / 3) + 1,
  优势: Math.ceil(1.5 * e),
  确保: 3 * e,
})

// ---- 装备加成：面板反推（可信度最高的一档）----
//
// 口径与算法都在 `shared/fit-bonus.ts` 的 `observedFitBonus`（纯函数、可脱 DOM 测）。
// 这里只负责**取数**：从 mg 的账本快照里凑出「面板值 / 基础值 / 近代化改修 / 装备原始值」
// 四项，被动只读，不发任何请求。三个消费端（鉴的装备加成页、锐的编队详情、钦的舰娘卡）
// 共用这一份，不会三处走样。

export type { FitObserved as PanelBonusResult } from '../shared/fit-bonus'

/** 这艘舰上的装备（含补强增设），过滤掉空槽与查不到实例的。 */
export const shipEquipInstances = (ship: PlayerShip) =>
  [...ship.slot, ship.slotEx].filter((id) => id > 0).map((id) => mg.slotitems[id]).filter(Boolean)

// ---- 成长三维（回避/对潜/索敌）的端点表与标定闸门 ----
//
// 这三项的裸值主数据没有，要 `插值(端点, 等级)` 算。端点来自第一方 `ship-stats` 汇编包，
// 而端点表会腐坏——所以每个 (形态, 项) 先过闸门：拿**你自己的空槽舰**验零残差才准出数。
// 判定与口径全在 `shared/ship-growth.ts`，这里只负责取数与缓存。

let shipStatsPack: ShipStatsPack | null = null
/**
 * 只拉一次，**失败也只失败一次**——同一个 promise 反复复用就是墓碑：
 * 不会出现「失败→重渲→再拉→再失败」那种无限 IPC 循环。
 */
let shipStatsReady: Promise<void> | null = null

/**
 * 按需拉端点包。拉不到就整片退回「三项不出行」，四项照旧。
 *
 * `onReady` 给渲染层补一拍（包是异步到的，第一拍画面上这三项还没有）；
 * 返回的 promise 给「非等不可」的调用方。**两种用法都要能用**：
 * 多个模块会各叫一次，第二个叫的人也必须拿得到回调，否则它会永远等下去。
 */
export const ensureShipStatsLode = (onReady?: () => void): Promise<void> => {
  if (!shipStatsReady) {
    shipStatsReady = queryLode('ship-stats')
      .then((lode) => {
        const data = lode?.data as ShipStatsPack | undefined
        if (!data?.forms) return
        shipStatsPack = data
        gateCache = null
      })
      .catch((error) => {
        console.warn('[kanso] 成长端点包读不到，回避/对潜/索敌的面板反推整片停用', error)
      })
  }
  if (onReady) void shipStatsReady.then(onReady)
  return shipStatsReady
}

// 缓存带失效键：`mg.ships` 换引用（每次同步都换）或包刚到，就整张重算。
// 全舰队一遍是 O(在籍数 × 3)，几百艘的量级一拍之内跑得完，不必增量。
let gateCache: { ships: unknown; pack: unknown; map: Map<string, GrowthVerdict> } | null = null

const growthGates = (): Map<string, GrowthVerdict> => {
  if (gateCache && gateCache.ships === mg.ships && gateCache.pack === shipStatsPack) {
    return gateCache.map
  }
  const samples = Object.values(mg.ships).map((ship) => ({
    rosterId: ship.id,
    formId: ship.shipId,
    name: mg.master.ships[ship.shipId]?.name ?? `#${ship.shipId}`,
    lv: ship.lv,
    panel: { evasion: ship.kaihi, asw: ship.taisen, los: ship.sakuteki },
    // 游戏对持有形态直接下发 Lv99 上限，一手压过任何资料
    liveMax: { evasion: ship.kaihiMax, asw: ship.taisenMax, los: ship.sakutekiMax },
    aswKyouka: ship.kyouka[6] ?? 0,
    // 干净样本 = 一件装备都没有：那时「加成为 0」是事实，不是我们那张表的说法
    clean: ![...ship.slot, ship.slotEx].some((id) => id > 0),
  }))
  const map = calibrateGrowth(shipStatsPack, samples)
  gateCache = { ships: mg.ships, pack: shipStatsPack, map }
  return map
}

/** 这艘舰这一项的闸门判定。包没到时一律 `noEndpoint`（不出行，也不假装验过）。 */
export const growthGateOf = (mstId: number, key: ShipGrowthKey): GrowthGate =>
  shipStatsPack ? (growthGates().get(growthGateKey(mstId, key))?.state ?? 'noEndpoint') : 'noEndpoint'

/**
 * 全舰队标定结果（维护者侧「成长值疑似过时」台账的数据面）。
 * `fail` 的每一条都带着期望/实测/等级/是哪一艘——那正是台账要写的几栏。
 */
export const growthGateReport = () => {
  // 包没到就别扫：那一趟每一格都只会得到 `noEndpoint`，白跑一遍全舰队
  if (!shipStatsPack) {
    return { tally: { pass: 0, fail: 0, unverified: 0, noEndpoint: 0 }, failures: [], packed: false }
  }
  const verdicts = [...growthGates().values()]
  const tally = { pass: 0, fail: 0, unverified: 0, noEndpoint: 0 }
  for (const one of verdicts) tally[one.state] += 1
  return { tally, failures: verdicts.filter((one) => one.state === 'fail'), packed: !!shipStatsPack }
}

/** 这个形态这一项的端点（持有形态优先用游戏一手的 Lv99 上限）。图鉴的三维上限也吃它。 */
export const shipGrowthEndpointsOf = (mstId: number, key: ShipGrowthKey, liveMax?: number | null) =>
  growthEndpoints(shipStatsPack, mstId, key, liveMax)

export const panelBonusOf = (ship: PlayerShip): FitObserved | null => {
  const mst = mg.master.ships[ship.shipId]
  if (!mst) return null
  const equips = shipEquipInstances(ship).map((equip) => {
    const master = mg.master.slotitems[equip.mstId]
    return {
      fire: master?.houg ?? 0,
      torpedo: master?.raig ?? 0,
      aa: master?.tyku ?? 0,
      armor: master?.souk ?? 0,
      // 三项的装备原始值：api_houk / api_tais / api_saku
      evasion: master?.houk ?? 0,
      asw: master?.tais ?? 0,
      los: master?.saku ?? 0,
      star: equip.level ?? 0,
    }
  })
  const liveMaxOf: Record<ShipGrowthKey, number> = {
    evasion: ship.kaihiMax,
    asw: ship.taisenMax,
    los: ship.sakutekiMax,
  }
  const base: Partial<Record<FitPanelKey, number | null>> = {
    fire: mst.baseHoug,
    torpedo: mst.baseRaig,
    aa: mst.baseTyku,
    armor: mst.baseSouk,
  }
  const gate: Partial<Record<FitPanelKey, GrowthGate>> = {}
  for (const key of FIT_PANEL_GROWTH_KEYS) {
    const growthKey = key as ShipGrowthKey
    const state = growthGateOf(ship.shipId, growthKey)
    gate[key] = state
    base[key] = growthReverseEnabled(state)
      ? growthValueAt(
          growthEndpoints(shipStatsPack, ship.shipId, growthKey, liveMaxOf[growthKey]),
          ship.lv,
        )
      : null
  }
  return observedFitBonus({
    panel: {
      fire: ship.karyoku,
      torpedo: ship.raisou,
      aa: ship.taiku,
      armor: ship.soukou,
      evasion: ship.kaihi,
      asw: ship.taisen,
      los: ship.sakuteki,
    },
    base,
    kyouka: ship.kyouka,
    equips,
    gate,
  })
}
