// 锐 (Ru) · 编队展示。判定/度量/个体三层 + 联合舰队合并度量。
// 数据边界：制空/索敌33/TP 走 fleet-calc（poi 口径 + 战斗计算模型 + wikiwiki 逐条核对）。
import type { AirBaseSquad, BattleLevelUp, BattleView, Deck, PlayerShip } from '../../shared/mg-types'
import { fleetStateTone } from '../../shared/fleet-state-tone'
import {
  createHpWatch,
  hitCrackTier,
  hitShakeParams,
  type HitShakeParams,
} from '../../shared/hit-shake'
import {
  hitAvatarCssVars,
  hitGlassSvg,
  hitWaterHtml,
  rowZonesOf,
  type GlassHole,
  type GlassPolygon,
  type GlassRect,
  type GlassShard,
  type HitGlassTier,
  type RowLayout,
  type RowZones,
} from '../../shared/hit-glass'
import {
  applyHitReport,
  dockKindOf,
  dockListDeg,
  dockRustStrength,
  dockScar,
  dockWater,
  damageChainOf,
  emptyDamageState,
  replayDamageChain,
  reconcileScar,
  returnToPort,
  syntheticDamageState,
  visibleListDeg,
  type DockKind,
  type HitMotion,
  type ShipDamageState,
} from '../../shared/hit-damage'
import { analyzeShipHitReport } from '../../shared/hit-report'
import { barToneStops, type BarToneStop } from '../../shared/bar-tone'
import { hitRustSvg, hitScarSvg, scarExtents, scarGeometry, scarMerge, scarParts, type ScarCorner } from '../../shared/hit-scar'
import { isSubmarineStype } from '../../shared/kcs-domain'
import {
  createRepairWatch,
  dockRepairProgress,
  type RepairFxEvent,
  type RepairItemSignal,
} from '../../shared/repair-fx'
import { HIT_REPORT_FX, REPAIR_FX, RETURN_FX, repairFxTotal, type DockOutStyle } from '../../shared/fleet-fx-timing'
import { airBaseCustomName } from '../../shared/air-base-name'
import { airBaseTabGlow } from '../../shared/air-base-tab'
import { AIR_BASE_MUTE_KEY, isAirBaseAreaMuted, toggleAirBaseAreaMute, unmutedAirBaseSquads } from '../../shared/air-base-mute'
import {
  ESCORT_FLAGSHIP_INDEX,
  FLAGSHIP_INDEX,
  noAdvanceAfterNode,
  taihaVerdictOf,
  type TaihaShipRef,
} from '../../shared/taiha-verdict'
import {
  detectFleetSpecialAttacks,
  type FleetSpecialAttack,
  type FleetSpecialAttackShip,
  type FleetSpecialAttackRole,
} from '../../shared/fleet-special-attack'
import {
  bestShipAacis,
  openingAswOf,
  shipAaciCeiling,
} from '../../shared/ship-special-attack'
import {
  BERTH_WARMUP_MS,
  REPAIR_FACILITY_MST_ID,
  REPAIR_SHIP_STYPE,
  berthCoverage,
  berthEstimateHp,
  berthPerHpMs,
  berthHalt,
  berthShipState,
  berthWarmupRatio,
} from '../../shared/berth-repair'
import {
  PROVISION_COND_CAP,
  PROVISION_WARMUP_MS,
  provisionEstimate,
  provisionHalt,
  provisionShipAt,
  provisionShipState,
} from '../../shared/provision-ship'

import {
  combinedEscortState,
  deckOnSortie,
  esc,
  fleetLabel,
  fmtCountdown,
  fmtCountdownShort,
  fmtReturnClock,
  repairClockText,
  fmtTime,
  hangarExpansionOf,
  hangarSlotCapacity,
  masterShipName,
  mg,
  escapedInSortie,
  isSunkInSortie,
  commitPaneHtml,
  deferPassive,
  forgetCommittedHtml,
  onFilterInput,
  onMgChange,
  onMourningChange,
  onQpChange,
  onSortieScreen,
  onTick,
  sunkEffectsEnabled,
  fleetStateToneEnabled,
  hitShakeEnabled,
  queryBattleSnapshot,
  queryBattleSnapshots,
  queryFleetCheck,
  queryLode,
  queryMasterRaw,
  repairDuration,
  repairDurationSeconds,
  trackMountCleanup,
  uiGet,
  onUiPreferenceChange,
  uiSet,
  updateCountdowns,
  queryExpSamples,
} from '../kernel'
import {
  abilityEquipsOf,
  abilityShipOf,
  engagedShips,
  ensureShipStatsLode,
  fleetAirPower,
  fleetLos33,
  fleetTp,
  panelBonusOf,
} from '../fleet-calc'
import { activeEventTpRuleOf, eventTpTableOf } from '../../shared/event-tp-rules'
import {
  estimatedCond,
  FATIGUE_FULL_COND,
  FATIGUE_READY_COND,
  fatigueBand,
  fatigueReadyTs,
  fleetFatigueEta,
  observedCond,
} from '../fatigue'
import { equipTypeIconHtml } from '../equip-icon'
import { isAviationEquipType } from '../equip-category'
import { countCapacitySlotitems } from '../equip-capacity'
import { shipThumbHtml } from '../entity-art'
import {
  SANDBOX_CAP,
  SANDBOX_DECK_ID,
  sandboxAdd,
  sandboxClear,
  sandboxDeck,
  sandboxRemove,
} from '../sandbox-fleet'
import { ensureLevelExpLode, expNeededTo, observeLevelExp } from '../level-exp'
import type { ExpSample } from '../../shared/mg-types'
import { trainingCruiserSetup } from '../../shared/practice-exp'
import { parseKcwikiNeeds, type KcwikiNeed } from '../../shared/kcwiki-upgrade'
import { resolveUseitemStock } from '../../shared/useitem-stock'
import { shipArtDamaged } from '../../shared/ship-art-path'
import { elink, elinkHtml, navigate, registerEntityRoute, registerTipBody } from '../link'
import { entityNameHtml, entityNamePlain, entityTermHtml } from '../localization'
import { expeditionLabel } from '../expedition-label'
import { simplifyKcwikiShipsData } from '../kcwiki-zh'
import { activateModule, registerModule } from '../mu'
import { initMapIntel } from '../map-intel'
import { eventGuideUrlOf } from '../../shared/event-guide'
import { mapIntelEntries } from '../../shared/map-intel'
import { isEventMapArea, mapAreaOf, mapCodeOf } from '../../shared/map-id'
import { activeEventAreaIds, sallyVerdict } from '../../shared/sally-lock'
import { sallyMarkHtml } from '../sally-tag'
import { invalidateRemodelOrder, progressiveRemodelOf, remodelChainRoot } from '../remodel'
import { remodelStageLabel } from '../../shared/remodel-label'
import { showSortieReadinessToast } from './lg'
import { questName } from './qn'
import {
  deckBuilderJson,
  deckBuilderUrl,
  parseDeckBuilder,
  type DeckBuilderDeck,
} from '../../shared/deck-builder'
import { saveTextFile, stampedFileName } from '../csv-export'
import { fleetLosCorrectionOf, fleetLosScoreOf } from '../../shared/day-spotting'
import {
  fleetHasSearchlight,
  procRateGroupsOf,
  procRatesOf,
  type ProcRateEntry,
  type ProcRateEquip,
  type ProcRateGroupView,
  type ProcRateShip,
} from '../../shared/special-proc-rate'

import type { QpFleetCheck } from '../../shared/qp-types'
import { classifyFleetDiff } from '../../shared/qp-types'

// 舰种代号（二期口径；缺省回退 master 名）
const STYPE_CODE: Record<number, string> = {
  1: 'DE', 2: 'DD', 3: 'CL', 4: 'CLT', 5: 'CA', 6: 'CAV', 7: 'CVL', 8: 'FBB',
  9: 'BB', 10: 'BBV', 11: 'CV', 12: 'BB', 13: 'SS', 14: 'SSV', 16: 'AV',
  17: 'LHA', 18: 'CVB', 19: 'AR', 20: 'AS', 21: 'CT', 22: 'AO',
}

interface ShipIssues {
  taiha: boolean
  chuuha: boolean
  unsupplied: boolean
  docked: boolean
  tired: boolean
}

const dockOf = (shipId: number) => mg.ndocks.find((d) => d.shipId === shipId)

// repairDuration 上提 kernel 单一出处（与鉴的入渠排程同一口径）

const repairQuoteHtml = (ship: PlayerShip): string => {
  if (ship.nowhp >= ship.maxhp || dockOf(ship.id) || ship.ndockTime <= 0) return ''
  return `<div class="sd-foot repair-quote">预计修理 <b>${repairDuration(ship.ndockTime)}</b>
    · 每 1 HP <b>${repairDurationSeconds(berthPerHpMs(ship)!)}</b>
    · ${entityTermHtml('material', 0, '燃料')} ${ship.ndockItem[0]}
    · ${entityTermHtml('material', 2, '钢材')} ${ship.ndockItem[1]}
    <span>尚未入渠</span></div>`
}

/**
 * 未补给：燃或弹任一不满。抬头裁决那句「补给满 / 未补给 N」说的就是它，
 * 顶栏远征芯片的「未补给」态直接引这一份——同一句话不许有第二个算法。
 * 主数据没到位时不判（宁可不说，也不拿 0 当满）。
 */
export const isUnsupplied = (ship: PlayerShip): boolean => {
  const master = mg.master.ships[ship.shipId]
  return !!master && (ship.fuel < master.fuelMax || ship.bull < master.bullMax)
}

/** 该舰队**当前成员**里有没有未补给的。顶栏远征芯片按队问这一句。 */
export const fleetHasUnsupplied = (deck: Deck): boolean => fleetShips(deck).some(isUnsupplied)

const shipIssues = (ship: PlayerShip): ShipIssues => {
  const ratio = ship.maxhp > 0 ? ship.nowhp / ship.maxhp : 1
  const docked = !!dockOf(ship.id)
  return {
    taiha: !docked && ratio <= 0.25,
    chuuha: !docked && ratio > 0.25 && ratio <= 0.5,
    unsupplied: isUnsupplied(ship),
    docked,
    tired:
      ship.cond < FATIGUE_READY_COND &&
      fatigueBand(estimatedCond(ship.id, FATIGUE_READY_COND) ?? ship.cond) !== 'ready',
  }
}

const fleetShips = (deck: Deck): PlayerShip[] =>
  deck.ships.filter((id) => id > 0).map((id) => mg.ships[id]).filter(Boolean) as PlayerShip[]

// ---- 模块状态 ----
let pane: HTMLElement
const AIR_BASE_TAB_ID = 0
// 沙盘状态住在 renderer/sandbox-fleet.ts —— 海域详情的路线预测也要读它，
// 那才是它真正的用处（把这套编成拿去推演某张图）。
const SANDBOX_TAB_ID = SANDBOX_DECK_ID
let sandboxPick = '' // 选人搜索框

let activeFleetId = 1
const expanded = new Set<number>()
let fleetQuestCheck: QpFleetCheck = {}
let fleetQuestTimer: ReturnType<typeof setTimeout> | null = null
// 反查的代号与失败态：见 scheduleFleetQuestCheck
let fleetQuestGeneration = 0
let fleetQuestFailed = false
// 舰娘包（kcwiki 单基准）：展开区的「下一改装」要图纸需求
let kcwikiByMst: Map<number, any> = new Map()
let mapAreaNames = new Map<number, string>()
// useitem id → 主数据日文名。resolveUseitemStock 要靠名字识别"装备镜像"型道具。
let useitemNames = new Map<number, string>()

/**
 * 装备库存到底同步过没有。
 *
 * 判据只能是**装备自己**：useitemsTs 是道具那一边的时钟，道具先同步而装备表
 * 还空着的时刻真实存在（进过道具页、没进过装备页/没返过港），拿它当装备已同步的
 * 证据，就会把「不知道有没有」说成「不足」——正是这条口径要治的误报。
 */
const slotitemsKnown = () => Object.keys(mg.slotitems).length > 0

/**
 * mstId → 持有件数。改造消耗逐项都要问「我有几件」，原来每项都全仓扫一遍。
 * 按 mg.slotitems 的**对象身份**缓存：补丁经 IPC 过来一律是新对象，
 * 换了就自动重建，不必额外挂失效。
 */
let slotitemCountCache: { src: unknown; byMst: Map<number, number> } | null = null
const ownedSlotitemCount = (mstId: number): number => {
  if (!slotitemCountCache || slotitemCountCache.src !== mg.slotitems) {
    const byMst = new Map<number, number>()
    for (const item of Object.values(mg.slotitems)) {
      byMst.set(item.mstId, (byMst.get(item.mstId) ?? 0) + 1)
    }
    slotitemCountCache = { src: mg.slotitems, byMst }
  }
  return slotitemCountCache.byMst.get(mstId) ?? 0
}

/**
 * 改造消耗里某一项的库存。返回 null 或 known=false 表示**不知道**，
 * 调用方必须如实说不知道——不能拿别的库存去顶，那正是「图纸不足」误报的成因。
 */
const remodelNeedStock = (need: KcwikiNeed): { count: number; known: boolean } | null => {
  if (need.id == null) return null
  if (need.kind === 'slotitem') {
    return { count: ownedSlotitemCount(need.id), known: slotitemsKnown() }
  }
  if (need.kind !== 'useitem') return null
  return resolveUseitemStock(need.id, useitemNames.get(need.id) ?? '', {
    materials: mg.materials,
    furnitureCoins: mg.basic?.furnitureCoins,
    useitems: mg.useitems,
    useitemsTs: mg.useitemsTs,
    slotitems: mg.slotitems,
    slotitemMasters: mg.master.slotitems,
    slotitemsKnown: slotitemsKnown(),
  })
}
// ---- 渲染片段 ----

const hpClassOf = (ship: PlayerShip, docked: boolean) => {
  if (docked) return 'hp-d'
  const r = ship.maxhp > 0 ? ship.nowhp / ship.maxhp : 1
  return r <= 0.25 ? 'hp-r' : r <= 0.5 ? 'hp-o' : r <= 0.75 ? 'hp-y' : 'hp-g'
}

const hpLabelOf = (ship: PlayerShip, docked: boolean) => {
  if (docked) return `<span class="st" style="color:var(--dock)">入渠</span>`
  const r = ship.maxhp > 0 ? ship.nowhp / ship.maxhp : 1
  if (r <= 0.25) return `<span class="st" style="color:var(--bad)">大破</span>`
  if (r <= 0.5) return `<span class="st" style="color:var(--warn)">中破</span>`
  if (r <= 0.75) return `<span class="st" style="color:var(--gold)">小破</span>`
  return ''
}

const condHtml = (ship: PlayerShip) => {
  const estimated =
    ship.cond < FATIGUE_READY_COND
      ? (estimatedCond(ship.id, FATIGUE_READY_COND) ?? ship.cond)
      : ship.cond
  const ready =
    ship.cond < FATIGUE_READY_COND
      ? fatigueReadyTs(ship.id, FATIGUE_READY_COND)
      : null
  const recovered = ship.cond < FATIGUE_READY_COND && estimated >= FATIGUE_READY_COND
  const band = fatigueBand(estimated)
  const cls = ship.cond >= 50
    ? ' sp'
    : recovered
      ? ' recovered'
      : band === 'red'
        ? ' bad'
        : band === 'orange'
          ? ' tired'
          : ''
  const star = ship.cond >= 50 ? '<span class="s">✦</span>' : ''
  const observed = observedCond(ship.id)
  const title = ship.cond < FATIGUE_READY_COND
    ? `游戏最近记录的士气 ${ship.cond}${observed ? ` · ${fmtTime(observed.ts)}` : ''} · 预估 ${estimated}${
        ready ? `；预计 ${fmtTime(ready)} 恢复至 ${FATIGUE_READY_COND}` : ''
      }`
    : `游戏记录的士气 ${ship.cond}`
  return `<div class="cond${cls}" title="${esc(title)}">${star}${ship.cond < FATIGUE_READY_COND ? `~${estimated}` : ship.cond}${
    ready && !recovered
      ? `<span class="cond-eta" data-cds="${ready}" data-cds-done="已恢复">${fmtCountdownShort(ready, '已恢复')}</span>`
      : recovered
        ? '<span class="cond-eta">已恢复</span>'
        : ''
  }</div>`
}

// 编队行空间有限，只放类别图标；图标本身仍是装备实体链接，悬停/点击/右键与文字链接一致。
// 不写原生 title，避免浏览器名字气泡覆盖 400ms 后出现的 Peek 小卡。
const equipPeekIconHtml = (
  mstId: number,
  iconId: number,
  name: string,
  options: { className?: string; overlay?: string } = {},
) =>
  elinkHtml('mstEquip', mstId, equipTypeIconHtml(iconId, options), undefined, {
    'aria-label': name,
  })

// 舰载机搭载角标的余量三档（2026-08-28 用户点的）：满/接近满绿、掉了一截黄、掉得多红。
//
// 断点**镜像同一行右边那根血条**（本文件的 hpClassOf，与 shared/battle-damage 的
// damageTierOf 同一套 0.75 / 0.5 / 0.25）——同一行里两处「还剩多少」共用一套刻度，
// 眼睛才不用在两套百分比之间换算。三色只用得下两个断点：血条的 hp-o 与 hp-r
// 在这里并成红（掉过半就是掉得多）。0.5 这条线同时也是同一行补给条转 low 的位置
// （fuelPct < 50），红从整行统一的那个位置开始。
const PLANE_LOAD_GREEN = 0.75 // 高于此=绿，对应血条 hp-g
const PLANE_LOAD_YELLOW = 0.5 // 高于此=黄，对应血条 hp-y；到此为止=红

/**
 * 这一格搭载数落在哪一档。返回 null = 不上色，保持原来那个灰数字。
 *
 * 分母取不到（capacity ≤ 0）就不上色：没有分母时报哪一档都是编的。
 * 搭载 0 的格根本不出这个角标，走不到这里。
 */
const planeLoadBand = (onslot: number, capacity: number): 'g' | 'y' | 'r' | null => {
  if (!(capacity > 0) || !(onslot > 0)) return null
  const ratio = onslot / capacity
  if (ratio > PLANE_LOAD_GREEN) return 'g'
  if (ratio > PLANE_LOAD_YELLOW) return 'y'
  return 'r'
}

const equipChips = (ship: PlayerShip) => {
  const chips: string[] = []
  const master = mg.master.ships[ship.shipId]
  const slotNum = master?.slotNum ?? 0
  ship.slot.forEach((instId, i) => {
    if (instId <= 0) {
      // 空格也占位（2026-08-19 用户点的）：一眼看出还有几格没装；悬停给该格搭载数。
      // 扩过的格写成「原量+增量」而不合成一个数：原量是主数据，增量是这艘舰被
      // 格納庫増設抬高的部分（读实例一手上限），两者不该看不出分别。
      // 没扩过的格照旧只写一个数——那种舰这里与从前完全一致。
      if (i < slotNum) {
        const cap = master?.maxEq?.[i] ?? 0
        const extra = hangarExpansionOf(ship.id, i)
        const capText = cap > 0
          ? extra > 0
            ? ` · 搭载上限 ${cap}+${extra}（格納庫増設）`
            : ` · 搭载 ${cap}`
          : ''
        chips.push(
          `<span class="equip-icon eq-empty" title="第 ${i + 1} 格 · 空${capText}"></span>`,
        )
      }
      return
    }
    const inst = mg.slotitems[instId]
    const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
    const star = inst && inst.level > 0 ? `<span class="st">★${inst.level >= 10 ? 'M' : inst.level}</span>` : ''
    const alv = inst && inst.alv > 0 ? `<span class="st alv">≫${inst.alv}</span>` : ''
    // 分母是**这一格实际的**搭载上限：格納庫増設抬高过的舰只有实例值是对的，
    // 主数据 maxEq 永远是原量（口径见 src/main/mg/index.ts 与内核 hangarSlotCapacity）。
    // 拿原量当分母，扩过的那一格补满了也会被判成「超了」或错档。
    const planes = mst && isAviationEquipType(mst.type2) ? (ship.onslot[i] ?? 0) : 0
    const band = planes > 0
      ? planeLoadBand(planes, hangarSlotCapacity(ship.id, i, master?.maxEq?.[i] ?? 0))
      : null
    const pc = planes > 0 ? `<span class="pc${band ? ` pc-${band}` : ''}">${planes}</span>` : ''
    if (mst && inst) {
      const name = entityNamePlain('equip', inst.mstId, mst.name)
      chips.push(equipPeekIconHtml(inst.mstId, mst.iconId, name, {
        className: inst.mstId === 42 ? 'damecon-crew' : inst.mstId === 43 ? 'damecon-goddess' : '',
        overlay: `${star}${alv}${pc}`,
      }))
    } else {
      chips.push(equipTypeIconHtml(-1, {
        title: '未知装备',
        overlay: `${star}${alv}${pc}`,
      }))
    }
  })
  // 补强增设（api_slot_ex：0 未开 / -1 开了没装 / >0 装备实例）：
  // 开了没装用小标记占位，装了照旧给装备图标
  //
  // 装了的那格描金边（exslot）：它和左边几个常规格图标混在一排、大小样式全一样，
  // 不描就只能靠「排在最后」认，看走眼就把增设当成了常规格。金色呼应游戏内
  // 补强格的金 ＋（未装备时的 eq-ex-mark 用的也是这个金）。
  if (ship.slotEx > 0) {
    const inst = mg.slotitems[ship.slotEx]
    const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
    if (mst) {
      const name = entityNamePlain('equip', inst!.mstId, mst.name)
      chips.push(equipPeekIconHtml(inst!.mstId, mst.iconId, `补强增设：${name}`, {
        className: `exslot${inst!.mstId === 42 ? ' damecon-crew' : inst!.mstId === 43 ? ' damecon-goddess' : ''}`,
      }))
    }
  } else if (ship.slotEx === -1) {
    chips.push(`<span class="eq-ex-mark" title="补强增设已开 · 未装备">＋</span>`)
  }
  return chips.slice(0, 8).join('')
}

// 展开区的度量行（06 稿）：面板值直接来自 api_ship，已含装备原始值、
// 可见蓝字装备加成与近代化改修。不要再把 fit-bonus 表加一遍，否则会重复计算。
// 索敌贡献 = 把这一舰从舰队里抽掉后 33 式的差值，比单列裸装索敌更有决策意义。
// deck 由调用方（shipRow）直接给：它手上就有这一行属于哪支队。
// 从前这里拿 rosterId 回头去 mg.decks 反查——沙盘编成的 deck.id 是 -1、根本不在
// mg.decks 里，反查必空，于是沙盘页的索敌贡献要么消失，要么算成这艘舰
// **真实所属**那支队的贡献（旗舰×1.5、练巡加成同理，见 expRunsHtml）。
const shipStatsHtml = (deck: Deck, ship: PlayerShip) => {
  const all = scopeShips(deck)
  const lv = mg.basic?.level ?? 0
  const slotCount = inCombined(deck) ? 12 : all.length === 7 ? 7 : 6
  const withAll = fleetLos33(all, lv, 1, slotCount).total
  const without = fleetLos33(all.filter((s) => s.id !== ship.id), lv, 1, slotCount).total
  const losShare = `<span class="sd-st">索敌贡献 <b>${(withAll - without).toFixed(1)}</b></span>`
  return `<div class="sd-stats" title="已含装备与近代化改修">
    <span class="sd-st">夜战火力 <b>${ship.karyoku + ship.raisou}</b></span>
    <span class="sd-st">回避 <b>${ship.kaihi}</b></span>
    <span class="sd-st">对潜 <b>${ship.taisen}</b></span>
    <span class="sd-st">对空 <b>${ship.taiku}</b></span>
    <span class="sd-st">运 <b>${ship.lucky}</b></span>
    ${losShare}
  </div>
  ${equipBonusHtml(ship)}`
}

// 装备加成（面板反推）：编成时就能看见这套配装实际吃到多少加成。
// 口径与图鉴的「装备加成」Tab 同一个 panelBonusOf（实现在 shared/fit-bonus.ts），
// 不会两处不一致。这里只出**实测**那一轨：编成页要的是「这套配装现在到底多了多少」，
// 「资料说应该多少」是图鉴该答的（双轨对照在鉴的装备加成页）。
// 措辞按 pure 分档：全 ★0 才是纯装备加成，带改修的是「加成 + 改修」的合计，不含糊。
const equipBonusHtml = (ship: PlayerShip) => {
  const bonus = panelBonusOf(ship)
  if (!bonus?.any) return ''
  const cells = bonus.rows
    .filter((r) => r.observed !== 0)
    .map(
      (r) =>
        `<span class="sd-bn ${r.observed > 0 ? 'up' : 'dn'}">${r.label} <b>${r.observed > 0 ? '+' : ''}${r.observed}</b></span>`,
    )
    .join('')
  const note = bonus.pure
    ? '蓝字装备加成（已计入总值）'
    : '蓝字装备加成 + 改修★（已计入总值）'
  return `<div class="sd-bonus">
    <span class="sd-bn-h">${note}</span>${cells}</div>`
}

// 各点位的实得经验样本（近 500 场快照聚合）。区间宽是因为旗舰 ×1.5、MVP ×2，
// 所以只用中位数估场次，并把区间和样本数一起说出来。
let expSamples: ExpSample[] = []
let expSamplesAsked = false

/**
 * 后台数据读不出来时的失败态。
 *
 * 这三条各自决定一块内容出不出现，静默失败的表现是「那一块凭空消失」——
 * 玩家分不清是「本来就没有」还是「坏了」。所以失败要说出来，并且给得出重试。
 */
type LoadKind = 'kcwiki' | 'master' | 'expSamples'
const loadFailed = new Set<LoadKind>()
const LOAD_FAIL_LABEL: Record<LoadKind, string> = {
  kcwiki: '改造消耗',
  master: '道具与海域名',
  expSamples: '练级场次',
}
const noteLoadFailure = (kind: LoadKind, error: unknown) => {
  console.warn(`[kuma] 编队 ${LOAD_FAIL_LABEL[kind]}读取失败`, error)
  loadFailed.add(kind)
  deferPassive(pane, 'ru', render)
}
const loadFailHtml = (): string =>
  loadFailed.size
    ? `<span data-ru-retry style="margin-left:10px;color:var(--bad);cursor:pointer"
        title="单击重试">${[...loadFailed]
        .map((kind) => LOAD_FAIL_LABEL[kind])
        .join('、')}读取失败 · 重试</span>`
    : ''

// 读失败后的冷却。ensureExpSamples 是每次渲染都会走一遍的，
// 光把 asked 放回 false 就等于「每帧重试一次」——账本真坏掉时那是风暴。
let expSamplesRetryAfter = 0

const ensureExpSamples = (onReady: () => void) => {
  if (expSamplesAsked || Date.now() < expSamplesRetryAfter) return
  expSamplesAsked = true
  void queryExpSamples()
    .then((rows) => {
      expSamples = rows ?? []
      loadFailed.delete('expSamples')
      if (expSamples.length) onReady()
    })
    .catch((error) => {
      // 顺序要紧：noteLoadFailure 会重渲染一次，那一刻 asked 还是 true，
      // 所以不会就地再发一遍；放开闸门之后，下一次事件驱动的渲染才重试。
      // 卡死在 true 的话，「≈演习 N 场」会整个会话缺席。
      noteLoadFailure('expSamples', error)
      expSamplesRetryAfter = Date.now() + 60_000
      expSamplesAsked = false
    })
}

/** 样本太少的不报——两三场算出来的「大约几场」只会误导。 */
const EXP_SAMPLE_MIN = 12

const TC_PLACEMENT_LABEL: Record<string, string> = {
  flagship: '旗舰',
  escort: '随伴',
  both: '旗舰+随伴',
}

/**
 * 把经验缺口换算成「大约几场」。
 *
 * **给区间，不给单个数字**。单场经验本来就不固定，而且两层原因性质不同：
 *   · 旗舰 ×1.5、MVP ×2 是结构性的，统计时已在 ledger 侧排除；练巡加成
 *     也已按当场配置从演习样本里除掉——桶里是干净的无加成基线；
 *   · 敌编成造成的差异消不掉（二期起同一格子编成越强经验越多，
 *     实测 624-25 拆掉加成后仍是 156~468 的三倍差），只能如实摊开。
 * 在基线之上按**当前编成**把可预判的加成乘回来（2026-08-19 用户提议）：
 * 这艘舰所在舰队有练巡 → 演习行 ×(1+系数)；本舰在旗舰位 → 全部 ×1.5。
 * MVP 无法预判，仍不计入。主显示用四分位 p75→p25 的场次区间，
 * 中位数放括号，完整极值留给提示。
 */
// 社区常用练级点（zh.kcwiki「攻略:练级指南」二期口径，2026-08-19 摘录）。
// 静态参考，不给数字——每场经验按敌编成浮动，没打过就没有诚实的数；
// 这些图攒满样本后会自动出现在上面的实测行里。
const COMMUNITY_LEVELING_SPOTS = [
  '5-2 B/C 空袭点 · 旗舰固定 MVP',
  '5-3 夜战点 · 中小型舰',
  '7-1 反潜',
  '4-4 全图四战',
  '3-5 B-F 两战',
  '1-5 / 4-5 / 5-5 反潜',
]

const expRunsHtml = (deck: Deck, need: number, ship: PlayerShip): string => {
  // 活动图的桶整个不参与（2026-08-19 用户定的）：活动结束点位就消失，
  // 拿它换算练级场次没有意义——主显示兜底与「其它常打的点」都不落活动图
  const usable = expSamples.filter(
    (row) =>
      row.samples >= EXP_SAMPLE_MIN &&
      row.median > 0 &&
      (row.practice || !isEventMapArea(mapAreaOf(row.map))),
  )
  if (!usable.length) return ''
  const pvp = usable.find((row) => row.practice)
  // 演习是最通用的练级手段，有样本就用它当主显示；否则用样本最多的那个点
  const primary = pvp ?? [...usable].sort((a, b) => b.samples - a.samples)[0]
  const label = (row: ExpSample) => (row.practice ? '演习' : `${mapCodeOf(row.map)} ${row.cell} 点`)
  // 当前编成的可预判加成：练巡只对演习生效，旗舰 ×1.5 出击/演习通用。
  // deck 由 shipRow 一路传下来——沙盘的 deck.id 是 -1，反查 mg.decks 拿不到它，
  // 从前那样反查会拿这艘舰真实所属那支队的练巡/旗舰位来算，说的不是这一页的事。
  const deckShips = deck.ships
    .filter((id) => id > 0)
    .map((id) => mg.ships[id])
    .filter(Boolean)
  const tc = trainingCruiserSetup(
    deckShips.map((s) => ({ stype: mg.master.ships[s!.shipId]?.stype ?? null, lv: s!.lv })),
  )
  const isFlagship = deck.ships[0] === ship.id
  const factorOf = (row: ExpSample) =>
    (row.practice && tc ? 1 + tc.bonusPct / 100 : 1) * (isFlagship ? 1.5 : 1)
  const runs = (need_: number, per: number, factor: number) =>
    Math.max(1, Math.ceil(need_ / (per * factor)))
  // 每场拿得多 → 场次少，所以高分位对应下界
  const factor = factorOf(primary)
  const few = runs(need, primary.p75, factor)
  const many = runs(need, primary.p25, factor)
  const mid = runs(need, primary.median, factor)
  const span = few === many ? `${mid}` : `${few}~${many}`
  const others = usable
    .filter((row) => row !== primary)
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 6)
    .map(
      (row) =>
        `${label(row)}：估算 ${runs(need, row.p75, factorOf(row))}~${runs(need, row.p25, factorOf(row))} 场（中位 ${runs(need, row.median, factorOf(row))}）`,
    )
    .join('\n')
  const adjustments = [
    primary.practice && tc && tc.bonusPct > 0
      ? `练巡 ${TC_PLACEMENT_LABEL[tc.placement] ?? tc.placement} Lv${tc.level} → +${tc.bonusPct}%`
      : '',
    isFlagship ? '该舰娘在旗舰位 ×1.5' : '',
  ].filter(Boolean)
  // 数据行在前，方法论压成末尾一行「口径」——玩家每次要看的是场次和点位，
  // 换算方法看一遍就够（2026-08-19 用户点的调整：方法论每次都占一屏是冗余）
  const title = [
    `${label(primary)}：四分位 ${span} 场 · 中位 ${mid} 场`,
    adjustments.join(' · '),
    others ? `\n其他常用通常图点位：\n${others}` : '',
    `\n社区常用练级点：\n${COMMUNITY_LEVELING_SPOTS.join('\n')}`,
    `\n四分位 ${primary.p25}~${primary.p75} · 中位 ${primary.median} · ${primary.samples} 舰次 · 单场随敌编成浮动`,
  ]
    .filter(Boolean)
    .join('\n')
  // 十来行数据用富提示卡（可选中复制、可钉住），不塞原生 title
  return `<span class="sd-runs" data-tip-title="${esc(`${label(primary)} · 场次换算`)}" data-tip="${esc(title)}">≈ ${esc(label(primary))} <b>${span}</b> 场</span>`
}

/**
 * 「还差 N 级」后半句：还差多少经验。
 *
 * 经验表不在主数据里，高段也没有可套的公式，所以这张表是**从在籍舰反推**的
 * （见 shared/level-exp）：每艘未满级的舰都自带一个精确点，跨会话累积。
 * 覆盖不到目标等级时如实说算不出——绝不拿相邻等级插值，那会给出一个
 * 看起来精确的错数。表会随玩家练级自己长全，界面只说「还没有这一级的经验数据」，
 * 不把表从哪来、还差几级才补得上这些施工内情摊给玩家（2026-08-20 文案清理）。
 */
const levelGapExpHtml = (deck: Deck, ship: PlayerShip, targetLevel: number): string => {
  const need = expNeededTo(
    { lv: ship.lv, expTotal: ship.expTotal, expNext: ship.expNext },
    targetLevel,
  )
  if (need == null) {
    return `<span class="sd-exp dim" title="${esc(`暂无 Lv${targetLevel} 的经验数据`)}">经验资料暂缺</span>`
  }
  if (need <= 0) return ''
  return `<span class="sd-exp">估算 <b>${need.toLocaleString()}</b> 经验</span>${expRunsHtml(deck, need, ship)}`
}

// 下一改装（06 稿）：等级差 + 图纸需求（kcwiki 单基准）+ 直达图鉴改装链
const nextRemodelHtml = (deck: Deck, ship: PlayerShip) => {
  const mst = mg.master.ships[ship.shipId]
  if (!mst) return ''
  const next = progressiveRemodelOf(ship)
  if (!next) {
    if (mst.afterShipId) {
      return `<div class="sd-foot">无更高阶改装 · ${elink('mstShip', ship.shipId, '图鉴改装链 →')}</div>`
    }
    return `<div class="sd-foot">最终改 · ${elink('mstShip', ship.shipId, '图鉴改装链 →')}</div>`
  }
  const gap = next.level - ship.lv
  const wiki = kcwikiByMst.get(ship.shipId)
  // 字段名叫「图纸」，装的却是整串改造消耗（「高速建造材x30 开发资材x180」）。
  // 曾经直接 parseInt 当图纸数量用：得到 NaN 后 `stock >= NaN` 恒 false，
  // 于是拿改装设计图的库存去判一个根本不要图纸的改装，白白报「不足」。
  // 舰娘包没读上来时，别把「消耗未知」装成「不需要消耗」——那一块直接消失，
  // 玩家会以为这次改装是白嫖的。
  const needsUnknown = !wiki && loadFailed.has('kcwiki')
  const needs = parseKcwikiNeeds(wiki?.改造?.图纸)
  const needChips = needs
    .map((need) => {
      const stock = remodelNeedStock(need)
      // 消耗品名互链进图鉴——「改装设计图去哪领」正是点进去要回答的问题
      const label =
        need.id != null && need.kind === 'useitem'
          ? elink('useitem', need.id, need.name)
          : need.id != null && need.kind === 'slotitem'
            ? elink('mstEquip', need.id, need.name)
            : esc(need.name)
      // 对不上别名表、或库存来源还没同步的，老实说不知道——绝不用别的库存替它下断言
      if (!stock || !stock.known) {
        return `<span class="sd-need">${label}×${need.count}<i>（库存未知）</i></span>`
      }
      const ok = stock.count >= need.count
      return `<span class="sd-need ${ok ? 'sd-ok' : 'sd-gap'}">${label}×${need.count}<i>（${stock.count}${ok ? ' ✓' : ' 不足'}）</i></span>`
    })
    .join('')
  return `<div class="sd-foot">
    下一改装：<b>${entityNameHtml('ship', next.shipId, next.name, { compact: true })}</b> · Lv${next.level}
    ${gap > 0 ? `<span class="sd-gap">距改造等级 ${gap} 级</span>${levelGapExpHtml(deck, ship, next.level)}` : '<span class="sd-ok">等级已满足 ✓</span>'}
    ${
      needChips
        ? ` · <span class="sd-needs">消耗${needChips}</span>`
        : needsUnknown
          ? ` · <span class="sd-needs"><span class="sd-need">改造消耗读取失败</span></span>`
          : ''
    }
    · ${elink('mstShip', ship.shipId, '图鉴改装链 →')}
  </div>`
}

const specialAttackRole = (deck: Deck): FleetSpecialAttackRole => {
  if (inCombined(deck)) return deck.id === 1 ? 'combined-main' : 'combined-escort'
  return deck.id === 3 && fleetShips(deck).length === 7 ? 'strike' : 'normal'
}

const fleetSpecialAttackShipOf = (ship: PlayerShip): FleetSpecialAttackShip => {
  const master = mg.master.ships[ship.shipId]
  return {
    name: master?.name ?? '',
    stype: master?.stype ?? 0,
    lv: ship.lv,
    luck: ship.lucky,
    hp: ship.nowhp,
    hpMax: ship.maxhp,
    equipment: procRateEquipsOf(ship),
  }
}

const flagshipSpecialAttacks = (deck: Deck): FleetSpecialAttack[] =>
  detectFleetSpecialAttacks({
    role: specialAttackRole(deck),
    ships: fleetShips(deck).map(fleetSpecialAttackShipOf),
  })

const specialAttackChipsHtml = (deck: Deck): string =>
  flagshipSpecialAttacks(deck)
    .map((attack) => {
      const title = `当前阵容支持「${attack.label}」\n触发阵型：${attack.formation}\n${attack.detail}`
      return `<span class="special-attack-chip ${attack.phase}" title="${esc(title)}">${esc(attack.label)}</span>`
    })
    .join('')

// 措辞一律是「可发动」：条件成立不等于打得出来。对空CI 有发动率、一场只结算一艘；
// 先制对潜还要这一战真有潜水舰——标签上别写成「会」。
const shipAbilityChipsHtml = (ship: PlayerShip): string => {
  const subject = abilityShipOf(ship)
  if (!subject) return ''
  const equips = abilityEquipsOf(ship)
  const chips: string[] = []

  const aacis = bestShipAacis(subject, equips)
  if (aacis.length) {
    const best = Math.max(...aacis.map((aaci) => aaci.fixed))
    const ceiling = shipAaciCeiling(subject)
    const title = [
      '可发动对空CI',
      ...aacis.map(
        (aaci) =>
          `类型 ${aaci.id}：${aaci.condition}\n　适用 ${aaci.scope} · 固定击坠 ${aaci.fixed} · 加成 ×${aaci.modifier}`,
      ),
      ceiling > best ? `舰型固定击坠上限 ${ceiling} · 当前配装 ${best}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    // 「还没吃满上限」只写进悬停说明，不另给一种边框：多数舰都没吃满，
    // 标出来满屏都是提示，反而看不出哪一条值得动。
    chips.push(
      `<span class="ability-chip aaci" title="${esc(title)}">对空CI ${aacis
        .map((aaci) => aaci.id)
        .join('/')}</span>`,
    )
  }

  const oasw = openingAswOf(subject, equips)
  if (oasw) {
    const title = [
      '可先制对潜（开幕对潜）',
      `依据：${oasw.basis}`,
      `当前对潜 ${subject.asw}`,
      '仅在潜水舰存在时发动',
    ].join('\n')
    chips.push(`<span class="ability-chip oasw" title="${esc(title)}">先制对潜</span>`)
  }
  return chips.join('')
}

// ---- 特殊效果发动概率（展开区的金框 pill）----
//
// 条目与置信度来自 shared/special-proc-rate。
// 整排按实测宽度折叠；明细浮层挂在 body 上以避开面板裁切。

/** 收纳态那一枚上的字。 */
const PROC_RATE_FOLD_LABEL = '特殊效果发动概率'
/** 悬停/钉住卡的标题。「推测」在标题上一次到位，逐行不再重复。 */
const PROC_RATE_CARD_TITLE = '估算发动概率'
/** 滞回死区：只吃亚像素与滚动条那一档的来回（同 METRICS_FOLD_HYSTERESIS） */
const PROC_RATE_FOLD_HYSTERESIS = 6

const procRateEquipsOf = (ship: PlayerShip): ProcRateEquip[] => {
  const equips: ProcRateEquip[] = []
  const ids = [...ship.slot, ship.slotEx]
  ids.forEach((instId, index) => {
    if (instId <= 0) return
    const inst = mg.slotitems[instId]
    const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
    if (!inst || !mst) return
    equips.push({
      mstId: inst.mstId,
      type2: mst.type2,
      iconId: mst.iconId,
      name: mst.name,
      antiAir: mst.tyku,
      asw: mst.tais,
      los: mst.saku,
      houm: mst.houm,
      saku: mst.saku,
      largeSearchlight: mst.type2 === 42,
      surfaceRadar: (mst.type2 === 12 || mst.type2 === 13) && mst.saku >= 5,
      level: inst.level || 0,
      // 搭载数取**当前**实际值：弾着観測射撃的前提之一是这一格搭载数 ≥1，
      // 被打光的那一格就是发动不了。补强增设格（ids 的最后一位）落在 onslot 之外，
      // 恒 0——它本来也装不了水侦。
      planeCount: index < ship.onslot.length ? (ship.onslot[index] ?? 0) : 0,
    })
  })
  return equips
}

const procRateShipOf = (ship: PlayerShip, flagship: boolean): ProcRateShip | null => {
  const master = mg.master.ships[ship.shipId]
  if (!master) return null
  return {
    mstId: ship.shipId,
    name: master.name,
    stype: master.stype,
    ctype: master.ctype,
    slotNum: master.slotNum,
    kai: master.kai,
    asw: ship.taisen,
    level: ship.lv,
    luck: ship.lucky,
    hp: ship.nowhp,
    hpMax: ship.maxhp,
    flagship,
    // 素対空要的是「不含装备」那个值：主数据初始対空 + 近代化改修
    //（口径见 aa-rocket-barrage；拿面板対空减装备是反推，会把装备加成留在里面）
    baseAntiAir: (master.baseTyku ?? 0) + (ship.kyouka[2] ?? 0),
    equipment: procRateEquipsOf(ship),
  }
}

/**
 * 舰队级输入：艦隊索敵補正与「同队有没有探照灯」。
 *
 * 按**还在场的人**算，与抬头的制空/索敌33 同一口径（退避舰之后的节点不参战，
 * 把她算进去等于给玩家看一支已经不存在的舰队）。
 */
const procRateFleetOf = (deck: Deck) => {
  const ships = engagedShips(scopeShips(deck))
  const equips = ships.map(procRateEquipsOf)
  const losScore = fleetLosScoreOf(
    ships.map((ship, index) => ({
      // 素索敵 = 面板索敵逐件减回装備索敵（同 shared/fleet-los33 的「舰娘裸装索敌」）
      baseLos: Math.max(
        0,
        ship.sakuteki - equips[index].reduce((sum, item) => sum + item.los, 0),
      ),
      equipment: equips[index],
    })),
  )
  return {
    losCorrection: fleetLosCorrectionOf(losScore),
    searchlight: fleetHasSearchlight(equips),
    role: specialAttackRole(deck),
    ships: fleetShips(deck).map(fleetSpecialAttackShipOf),
  }
}

/** pill 脸上那个数。置信度不够时是「?」——不是 0，也不是留白。 */
const procRateFaceOf = (entry: ProcRateEntry): string =>
  entry.rate === null ? '?' : `${entry.rate.toFixed(0)}%`

const procRatePillHtml = (view: ProcRateGroupView): string => {
  const entry = view.primary
  return `<span class="pr-pill${entry.rate === null ? ' pr-unknown' : ''}" data-prkey="${esc(entry.id)}"
    data-tip-title="${esc(`${entry.label} · ${PROC_RATE_CARD_TITLE}`)}"
    data-tip="${esc(view.detail.join('\n'))}">${esc(entry.label)} <b>${procRateFaceOf(entry)}</b></span>`
}

const procRatesHtml = (deck: Deck, ship: PlayerShip): string => {
  // 旗舰补正只认**各自舰队**的第一位：联合编成里第二舰队也有自己的旗舰
  //（同 renderer/combat-forecast 的 friendlyShip）
  const flagship = scopeFleets(deck).some((fleet) => fleet[0]?.id === ship.id)
  const subject = procRateShipOf(ship, flagship)
  if (!subject) return ''
  const entries = procRatesOf(subject, procRateFleetOf(deck))
  const groups = procRateGroupsOf(entries)
  // 一条都发动不了的舰**什么都不多**：这一排本身就是「她能干什么」的答案
  if (!groups.length) return ''
  const foldTip = groups.flatMap((group) => group.foldLines).join('\n')
  return `<div class="proc-rates" data-proc-fold>${groups
    .map(procRatePillHtml)
    .join('')}<span class="pr-pill pr-all pr-folded"
      data-tip-title="${esc(PROC_RATE_CARD_TITLE)}"
      data-tip="${esc(foldTip)}">${PROC_RATE_FOLD_LABEL}</span></div>`
}

/** 上一拍这一排收没收（滞回用）。键是舰娘 roster id——每一行各自量各自的。 */
const procRateFolded = new Map<string, boolean>()

/**
 * 量一次、算一遍、整排收或整排放。
 *
 * 与 foldMetricsRow 同族：测量前先全部摊开，一次批量读宽度，不做「收一枚量一次」的
 * 反复回流。行宽为 0 = 这一块还没显示（模块没激活 / 坞没展开），那时量出来的结论
 * 是「全都放不下」，会把整排白收掉——不知道就先不动。
 */
const foldProcRateRow = (row: HTMLElement) => {
  const pills = [...row.querySelectorAll<HTMLElement>('.pr-pill[data-prkey]')]
  const all = row.querySelector<HTMLElement>('.pr-all')
  if (!pills.length || !all) return
  const avail = contentWidthOf(row)
  if (avail <= 0) return
  const key = row.closest<HTMLElement>('.ship')?.dataset.ship ?? ''
  const wasFolded = procRateFolded.get(key) ?? false
  for (const pill of pills) pill.classList.remove('pr-folded')
  all.classList.remove('pr-folded')
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0
  const width = pills.reduce((sum, pill) => sum + pill.getBoundingClientRect().width, 0)
  // 亚像素余量 0.5：宽度是小数，别为 0.2px 白收掉整排。
  // 滞回只在「上一拍收着、这一拍想摊开」的方向上加码——收起来则一到放不下就收，
  // 两个阈值差出一条死区，临界宽度上不会来回翻。
  const need = width + gap * Math.max(0, pills.length - 1) + (wasFolded ? PROC_RATE_FOLD_HYSTERESIS : 0)
  const folded = need > avail + 0.5
  for (const pill of pills) pill.classList.toggle('pr-folded', folded)
  all.classList.toggle('pr-folded', !folded)
  procRateFolded.set(key, folded)
}

const foldProcRates = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>('.proc-rates[data-proc-fold]').forEach(foldProcRateRow)
}

/**
 * 展开区的内容。**只在这一行确实展开时才算**。
 *
 * 每行都要两次 fleetLos33（索敌贡献是「抽掉这艘」的差值）、一遍改造消耗查库存、
 * 一遍经验样本过滤排序；折叠的行 max-height:0 看不见，算了也是白算——
 * 12 行就是 24 次 fleetLos33 全扔掉。
 *
 * 容器（.ship-detail）仍然每行都留在 DOM 里：展开动画是 max-height 过渡，
 * 靠的就是它一直在。点开那一下由 fillShipDetail 同步补内容，不会先闪一个空框。
 */
const shipDetailHtml = (deck: Deck, ship: PlayerShip): string => {
  const detailRows = ship.slot
    .filter((id) => id > 0)
    .map((id) => {
      const inst = mg.slotitems[id]
      const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
      if (!mst) return ''
      const imp = inst!.level > 0 ? `<span class="imp">★${inst!.level >= 10 ? 'MAX' : inst!.level}</span>` : ''
      const name = entityNamePlain('equip', inst!.mstId, mst.name)
      return `<div class="sd-row">${equipPeekIconHtml(inst!.mstId, mst.iconId, name, { className: 'sm' })}<span class="nm">${elink('mstEquip', inst!.mstId, mst.name)}</span>${imp}</div>`
    })
    .join('')
  return `<div class="sd-eq">${detailRows || '<div class="sd-row" style="color:var(--dim)">暂无装备数据（返港后同步）</div>'}</div>
      ${shipStatsHtml(deck, ship)}
      ${procRatesHtml(deck, ship)}
      ${repairQuoteHtml(ship)}
      ${nextRemodelHtml(deck, ship)}`
}

/**
 * 点开一行时把内容补进去（折叠时渲染出来的是空容器）。
 *
 * 换块的绑定收支：这一块里只有 EntityLink（.el）与富提示（data-tip），
 * 两者都是 document 级委托，不需要逐元素重绑；.ship-detail 之外的
 * data-sandbox-remove 之类也一个没动。
 */
const fillShipDetail = (row: HTMLElement, rosterId: number) => {
  const host = row.querySelector<HTMLElement>('.ship-detail')
  if (!host || host.childElementCount > 0) return
  const ship = mg.ships[rosterId]
  if (!ship) return
  // 沙盘的 deck 不在 mg.decks 里（id=-1），靠行上的标记认，别去反查
  const deck = row.classList.contains('in-sandbox')
    ? sandboxDeck()
    : mg.decks.find((d) => d.ships.includes(rosterId))
  if (!deck) return
  host.innerHTML = shipDetailHtml(deck, ship)
  // 发动概率那一排的收纳要赶在 .open 的展开过渡开始之前定下来，否则会先看见
  // 平铺溢出、下一帧才缩——那一下就是闪跳（同 render 里 foldMetrics 的位置）。
  // 此刻这一行还没加 .open，但 .ship-detail 收起态与展开态的**横向** padding 一样，
  // 量到的可用宽与展开后一致。
  foldProcRates(host)
}

// 已经见过谁退避了。**只为动画服务**：退场态本身完全从 sortie 状态推导，
// 这张表决定的仅仅是「这一帧要不要挂那段离场动画」。
// 锐的整段 HTML 每次 HP 变化都会重渲（输出闸门只挡「一个字节都没变」的那种），
// 不记一笔的话，她会在整趟出击里一遍遍地滑出去。
const seenEscaped = new Set<number>()
const LVUP_HINT_MS = 6000

const shipRow = (deck: Deck, ship: PlayerShip, isFlag: boolean) => {
  const master = mg.master.ships[ship.shipId]
  const issues = shipIssues(ship)
  const dock = dockOf(ship.id)
  // 碎裂卡：这次出击里她真的沉了。判据取内核那一份（从 sortie 状态推导），
  // 与界面失色、铃的击沉通知同源；返港时 sortie.active 落下，下一次重画自动恢复。
  const shattered = sunkEffectsEnabled() && isSunkInSortie(ship.id)
  // 退场卡：她退避了，被送回港，返港前不再参战——**不是沉了**，所以与碎裂卡
  // 刻意拉开距离（不裂、不黑白，只是退到幕后）。判据同样取内核那一份，
  // 与制空/索敌/输送量的排除同源；返港时随 active 落下，下一次重画自动恢复。
  // 编成位原样占着：她只是退到幕后了，不是从编成里消失。
  //
  // 「既沉又退避」是坏状态（退避舰之后不再参战，沉不了）。真撞上时以「沉了」为准，
  // 两套视觉不叠在同一张卡上——那会同时说两件互相否定的事。
  const escaped = shattered ? null : escapedInSortie(ship.id)
  const sortieLevelUps = mg.sortie?.active
    ? mg.sortie.levelUps
    : Date.now() - (mg.lastSortieLevelUps?.endedAt ?? 0) < LVUP_HINT_MS
      ? mg.lastSortieLevelUps?.entries ?? []
      : []
  let levelUp: BattleLevelUp | undefined
  if (!shattered && !escaped && deck.id !== SANDBOX_DECK_ID) {
    levelUp = sortieLevelUps.find((entry) => entry.rosterId === ship.id)
  }
  const levelUpElapsed = Date.now() - (mg.lastSortieLevelUps?.endedAt ?? 0)
  const levelUpHint = levelUp
    ? mg.sortie?.active
      ? `<em class="lvup hold" title="本次出击升级：${levelUp.from} → ${levelUp.to}">↑${levelUp.from}→${levelUp.to}</em>`
      : `<em class="lvup" style="--lvup-elapsed:${levelUpElapsed}ms" title="本次出击升级：${levelUp.from} → ${levelUp.to}">↑${levelUp.from}→${levelUp.to}</em>`
    : ''
  // 离场动画只在**状态翻转的那一次**播，之后只剩静态的 .left。
  const leavingNow = !!escaped && !seenEscaped.has(ship.id)
  if (escaped) seenEscaped.add(ship.id)
  else seenEscaped.delete(ship.id) // 返港后恢复正常，下一趟再退避会重新播
  const tone = fleetStateToneEnabled() && !escaped && !isSunkInSortie(ship.id) ? shipStateTone(ship) : null
  const damageAttr = tone?.damage ? ` data-damage="${tone.damage}"` : ''
  const stateAttr = tone?.state ? ` data-state="${tone.state}"` : ''
  const stateBar = tone?.labels.length ? `<span class="state-bar" title="${tone.labels.join(' · ')}"></span>` : ''
  const hit = !escaped && !isSunkInSortie(ship.id) ? shipHitShake(ship) : null
  const crack = !escaped && !isSunkInSortie(ship.id) ? shipHitCrack(ship) : null
  const fractureCss = crack || shattered ? shipHitFracture(ship) : ''
  // 缺角玻璃层与修理演出挂件（维护者裁决 2026-11-26）：判定在 shipGlassFx，这里只拼进去；要在 shipHitFracture 之后取（它分配种子）
  const glass = escaped ? null : shipGlassFx(ship, shattered)
  const hitSev = hit ? hit.severity : 0
  const hitDmg = hit ? hit.dmg : 0
  const styleParts: string[] = []
  if (fractureCss) styleParts.push(fractureCss)
  if (glass?.style) styleParts.push(...glass.style)
  if (hit) {
    styleParts.push(
      `--hit-shake:${hit.shake}`,
      `--hit-glitch:${hit.glitch}`,
      `--hit-shatter:${hit.shatter}`,
      `--hp-from:${hit.from}%`,
      `--hp-to:${hit.to}%`,
      // 各步错开留一口气（节拍表 shared/fleet-fx-timing）：冲击 → 残影下降 → 盖章 / 故障爆闪
      `--ghost-at:${hit.ghostAtMs}ms`,
      `--ghost-dur:${hit.ghostDurMs}ms`,
      `--hit-stamp-at:${hit.stampAtMs}ms`,
      `--hit-stamp:${hit.stampMs}ms`,
      `--hit-pop:${hit.popMs}ms`,
    )
    // 战报驱动的动作（交接包 v2）：反潜等深弹起爆、鱼雷等航迹切入，冲击整体后挪 lead；鱼雷右沉倾侧、反潜垂直浮沉
    if (hit.leadMs > 0) styleParts.push(`--hit-lead:${hit.leadMs}ms`)
    if (hit.kind === 'torp') styleParts.push(`--list-from:${hit.listFrom}deg`, `--list-peak:${hit.listPeak}deg`)
    if (hit.kind === 'asw') styleParts.push(`--heave-amp:${hit.heaveAmp}px`)
  }
  const hitAttr = `${
    hit
      ? ` data-hit data-hit-sev="${hitSev}"${hit.kind === 'torp' || hit.kind === 'asw' ? ` data-hit-kind="${hit.kind}"` : ''}${hit.leadMs > 0 ? ' data-hit-lead' : ''}${hit.crossedTier ? ' data-hit-cross="1"' : ''}${hit.glitchBurst ? ' data-glitch-burst="1"' : ''}`
      : ''
  }${crack ? ` data-crack="${crack}"` : ''}${shattered && fractureCss ? ' data-fracture' : ''}${glass?.attrs ?? ''}${styleParts.length ? ` style="${styleParts.join(';')}"` : ''}`
  const dmgFxHtml =
    crack || hit || glass
      ? `<span class="dmg-fx" aria-hidden="true">${
          crack
            ? `<span class="dmg-wash"></span>${crack === 'medium' || crack === 'heavy' ? '<span class="dmg-hazard"></span>' : ''}${crack === 'heavy' ? '<span class="dmg-ember"></span><span class="dmg-scan"></span>' : ''}`
            : glass?.wash
              ? '<span class="dmg-wash"></span>'
              : ''
        }${glass?.layers ?? ''}${crack === 'heavy' || hit?.glitchBurst ? '<span class="glitch-bars"></span>' : ''}${
          hit ? '<span class="hit-flash"></span><span class="hit-sweep"></span>' : ''
        }</span>`
      : ''
  const hpGhostHtml = hit
    ? `<span class="hp-ghost${hitSev >= 4 ? ' crit' : ''}" aria-hidden="true"></span>`
    : ''
  const dmgPopHtml = hit && hitDmg > 0
    ? `<span class="dmg-pop sev-${hitSev}" aria-hidden="true">${hitSev >= 4 ? `-${hitDmg}!` : `-${hitDmg}`}</span>`
    : ''
  const rowCls = shattered
    ? ' shattered'
    : escaped
      ? ` left${leavingNow ? ' leaving' : ''}`
      : tone ? '' : issues.taiha ? ' crit' : issues.chuuha || issues.tired || issues.unsupplied ? ' alert' : dock ? ' dock' : ''
  const name = masterShipName(ship.shipId)
  const fuelPct = master && master.fuelMax > 0 ? (ship.fuel / master.fuelMax) * 100 : 100
  const bullPct = master && master.bullMax > 0 ? (ship.bull / master.bullMax) * 100 : 100
  const hpPct = ship.maxhp > 0 ? (ship.nowhp / ship.maxhp) * 100 : 100
  const nextRemodel = progressiveRemodelOf(ship)
  // 档位要写实际的那一档：铃谷改的下一档是**改二**，一律写「改」等于没说。
  // 剥掉改造链原型的名字，剩下的正好是游戏里的写法（改 / 改二 / 航改二）；
  // 改名换姓的那些（響改 → Верный）剥不出来，就写全名。
  // 用**主数据原名**剥，不用本地化名：后缀本身（改 / 改二 / 航改 / Mk.II）
  // 中日写法一致，而本地化是逐条的——原型翻了、下一档没翻（或反过来）时
  // 前缀就对不上，白白退回完整名（实测 Fletcher改 → 弗莱彻 Mk.II 就是这样）。
  // 但剥不出后缀、退回完整名的那些（大鯨→龍鳳、響→Верный、春日丸→大鷹）此前是
  // 原样吐日文全名，而这一格是全仓最窄的之一（.who 最窄 96px）。既然已经退回全名，
  // 前缀对齐就无从谈起，这时换成中文名没有副作用——包里 185/526/884 都有译名。
  const nextStage = nextRemodel
    ? (() => {
        const stage = remodelStageLabel(masterShipName(remodelChainRoot(ship.shipId)), nextRemodel.name)
        return stage === `${nextRemodel.name}`.trim()
          ? entityNamePlain('ship', nextRemodel.shipId, nextRemodel.name)
          : stage
      })()
    : ''
  const remodelHint = nextRemodel
    ? `<em class="next-kai${ship.lv >= nextRemodel.level ? ' ready' : ''}" title="${esc(
        // 同一行的可见文字（ru.ts:604）走 entityNameHtml 是中文，悬停却直取 api_name
        `下一改装：${entityNamePlain('ship', nextRemodel.shipId, nextRemodel.name)}`,
      )}">· ${esc(nextStage)} Lv${nextRemodel.level}${ship.lv >= nextRemodel.level ? ' ✓' : ''}</em>`
    : ''
  // 沙盘：就地给一个移出按钮。移除入口原本只在上面的选人条上，
  // 而人是在这张表里看编成的——找不到入口就等于不能移除。
  // 行是固定 6 列的 grid，头像列只有 48px，塞不下按钮（会被挤成竖排两个字）。
  // 所以做成行角上的 ×，绝对定位、不占列。
  const sandboxOut =
    deck.id === SANDBOX_DECK_ID
      ? `<button class="sand-out" data-sandbox-remove="${ship.id}" title="移出沙盘编成" aria-label="移出沙盘编成">×</button>`
      : ''
  return `
  <div class="ship${rowCls}${expanded.has(ship.id) ? ' open' : ''}${deck.id === SANDBOX_DECK_ID ? ' in-sandbox' : ''}" data-ship="${ship.id}"${
    shattered
      ? ' data-sunk="1" title="这次出击中被击沉"'
      : escaped
        ? ` data-escaped="${escaped.role}" title="退避中，返港前不再参战"`
        : ''
  }${damageAttr}${stateAttr}${hitAttr}>${stateBar}${glass?.tether ?? ''}
    ${dmgFxHtml}
    ${shattered ? '<span class="shatter" aria-hidden="true"></span>' : ''}
    ${sandboxOut}
    <div class="fc">${isFlag ? '<span class="flag">旗</span>' : ''}${shipThumbHtml(ship.shipId, name, {
      className: 'avatar',
      // 中破线起换受损横幅，和右边那根血条说的是同一件事（阈值见 shipArtDamaged）。
      // 入渠中的舰血还没回来，照样是受损那张——poi 的入渠面板也是这么显示的。
      damaged: shipArtDamaged(ship.nowhp, ship.maxhp),
    })}</div>
    <div class="who"><b>${elinkHtml('ship', ship.id, entityNameHtml('ship', ship.shipId, name, { compact: true }))}</b>${
      escaped ? `<span class="esc-tag">${escaped.role === 'tow' ? '护卫' : '退避'}</span>` : ''
    }${isFlag ? specialAttackChipsHtml(deck) : ''}${shipAbilityChipsHtml(ship)}<span>Lv ${ship.lv}${
      ship.expNext > 0 ? ` <em>· next ${ship.expNext.toLocaleString()}</em>` : ''
    }${levelUpHint ? ` ${levelUpHint}` : ''} ${remodelHint}</span></div>
    <div class="hpc ${hpClassOf(ship, !!dock)}">
      ${eventRunningNow() ? sallyMarkHtml(ship.sallyArea, currentEventAreaId()) : ''}
      <div class="hpbody">
        ${dmgPopHtml}
        <div class="bar">${hpGhostHtml}<i style="width:${dock ? (hitShakeEnabled() ? dockBarPct(ship, dock) : 45) : hpPct}%"></i></div>
        <div class="num"${dock ? ` data-repair-title="${dock.completeTime}" title="${repairClockText(dock.completeTime, Date.now())}"` : ''}><span>${dock ? `${ship.nowhp}→${ship.maxhp}` : `${ship.nowhp}/${ship.maxhp}`}</span>${hpLabelOf(ship, !!dock)}</div>
      </div>
    </div>
    <div class="fa2">
      <span class="b fuel${fuelPct < 50 ? ' low' : ''}"><i style="width:${fuelPct}%"></i></span>
      <span class="b ammo${bullPct < 50 ? ' low' : ''}"><i style="width:${bullPct}%"></i></span>
    </div>
    ${condHtml(ship)}
    <div class="eq">${dock ? `<span class="etimer" data-repair-title="${dock.completeTime}" title="${repairClockText(dock.completeTime, Date.now())}">⏱ <span data-cd="${dock.completeTime}">${fmtCountdown(dock.completeTime)}</span></span>` : equipChips(ship)}</div>
    <div class="ship-detail">${expanded.has(ship.id) ? shipDetailHtml(deck, ship) : ''}</div>
  </div>`
}

/**
 * 出击前的基地航空队体检。
 *
 * 只看**已经派上用场的队**（出撃 / 防空）：待機、退避、休息中的队本来就不出门，
 * 算进来只会让这一行常年亮着，最后被当噪音无视。
 *
 * areaId 给定时只数**驻扎在那个海区**的队——你摊开的是中部海域,
 * 活动区中队缺补给与这一趟无关,混在一起数是错报(2026-08-11 用户抓的
 * 触发问题之一)。不给 areaId 保持全量口径(陆航页自身的总览用)。
 *
 * 与舰队问题分开报：陆航没补给照样能出击，只是那几波白送——
 * 所以它不该把「可以出击」染红，但也不该只躺在下面几百行处的陆航区里。
 * 没同步到陆航（旧存档、还没进过活动图）时返回 null：不知道就不说，不猜。
 */
const airBaseReadiness = (areaId?: number, squads = trackedAirBases()): { short: number; red: number; orange: number; squads: number } | null => {
  const active = squads.filter(
    (squad) => (squad.actionKind === 1 || squad.actionKind === 2)
      && (areaId == null || squad.areaId === areaId)
      && squad.planes.some((plane) => plane.slotId > 0),
  )
  if (!active.length) return null
  const has = (squad: AirBaseSquad, test: (plane: AirBaseSquad['planes'][number]) => boolean) =>
    squad.planes.some((plane) => plane.slotId > 0 && test(plane))
  return {
    short: active.filter((squad) => has(squad, (plane) => plane.count < plane.maxCount)).length,
    red: active.filter((squad) => has(squad, (plane) => plane.cond >= 3)).length,
    orange: active.filter((squad) => has(squad, (plane) => plane.cond === 2)).length,
    squads: active.length,
  }
}

/**
 * 最近一次能确知「玩家摊开了哪个海区」的记录（区号）。null = 这个会话还没见过。
 *
 * 原说明（2026-09-08 更正，保留原文）：
 * **它已经不是任何挂牌/判定的依据**——札看 onEventMapScreen（mapinfo/出击），
 * 陆航状态看基地航空队页签，两条都不读它。留着只有一个用处：开图信号到手时比一比区号变没变，
 * 变了才重画一次，让紧接着弹出的 toast 与界面前后一致（见 mount 里的监听）。
 * 之所以不能当判据：开图信号每个游戏会话每区只发得出一次（下面那段注释）。
 *
 * 2026-09-08 更正：用户裁定常规图不显示札状态。札的选图页判定从今天起读它，
 * 最近摊开／出击的海区属于当前活动区才显示；null 时不知道就不说。陆航仍不读它。
 * 已知缝隙：从活动区切回已缓存的常规区不会再发开图信号，札状态会留到下一次
 * 常规图出击，由 noteSortieArea 校准后才撤。这是被动只读的代价，不加轮询。
 *
 * 两个来源都写它：
 *   · 海图美术的静态资源请求（见 kcs-resource，切到某个海区时取那几张缩略图）；
 *   · 出击本身——api_req_map/start 那一刻的海区是确知的（noteSortieArea），
 *     用它校准可以兜住「美术已缓存、切区不再发请求」的情况。
 */
let lastOpenedMapArea: number | null = null
// 开图信号(海图美术嗅探)每个**游戏会话**每区只发得出一次:切回已开过的区、
// 甚至返港后再进选图,游戏都用自己的资源管理器缓存,连 HTTP 请求都不发
// (2026-08-11 用户三轮复现逐步钉死)。所以它只配驱动一次性 toast，
// 陆航页签则直接跟随账本里的 airBases 状态。
// 2026-09-08 更正：上句「只配驱动一次性 toast」保留作历史说明；札选图页现读最近区号，
// 缓存切区的已知缝隙与校准方式见头注，陆航页签的依据不变。

/** 出击一次就确知打的是哪个区，拿它校准（游戏下次也会回到这个区）。 */
const noteSortieArea = () => {
  const sortie = mg.sortie
  if (sortie && !sortie.practice && sortie.mapArea > 0) lastOpenedMapArea = sortie.mapArea
}

/**
 * 现在是不是**站在海域选择页**。
 *
 * 光记「最后摊开哪张图」不够：那个记忆一旦落在活动区就再没有东西把它撤下来，
 * 回了母港这两条照样亮着（实测：母港界面上「将被打札」「基地航空就绪」都还在）。
 * 而它们只在「要不要把这支队投进这张图」那一刻有用——母港、演习、远征页都不是。
 *
 * 进：mapinfo（打开海域选择页必发）。
 * 出：回母港 / 转去演习。回港那条要**比值**——patch 每次都捎带 lastPortTs，
 * 光看 key 在不在会每次都判成刚回港。
 */
let atMapSelect = false
let lastSeenPortTs: number | null = null

const noteScreenLeft = (keys: string[]) => {
  if (mg.lastPortTs !== lastSeenPortTs) {
    lastSeenPortTs = mg.lastPortTs
    atMapSelect = false
  }
  // 从海域选择页点「演习」不发 port，但也已经离开了选图那一步
  if (keys.includes('practice')) atMapSelect = false
}

/**
 * 札只在**活动海域**说得上话;陆航则跟着「摊开的海区里有没有驻扎中队」走——
 * 中部(6)/南西(7)的常规图一样用基地航空,6-4/6-5 缺补给同样白跑
 * (2026-08-11 用户抓的触发问题:此前两条都挂在活动图上,注释里「常规图
 * 带不了陆航」这句本身就是错的,常规陆航图漏报)。
 * 在 1-1 的海域选择页上摆这两条仍是纯噪音,按区各判各的。
 *
 * **不知道就不说**：没有任何开图线索时返回 false 而不是退回识别札。
 * 退回识别札等于「队里带过活动札就一直亮」，切到 1-1 也不灭——
 * 那正是这条判据要治的毛病。
 */
// 札:出击途中看本趟是不是活动图;选图页上只要活动开着就说话——
// 「要不要把这支队投进活动图」正是这一页要做的决定,判据不依赖开图探测
// 2026-09-08 更正（上两行保留原文）：选图页还要确认最近摊开／出击的是当前活动区，
// 未知区号不显示；出击途中仍只看本趟海区。
const onEventMapScreen = (): boolean => {
  const areas = activeAreasNow()
  if (!areas.size) return false
  const sortie = mg.sortie
  if (sortie?.active && !sortie.practice) return areas.has(sortie.mapArea)
  return atMapSelect && lastOpenedMapArea != null && areas.has(lastOpenedMapArea)
}

// 出击识别札。这是出击**前**唯一能确定的目标图侧条件——
// 敌制空阈值、陆航半径都要先知道打哪张图，选图之前根本不存在，
// 所以那两样不会出现在这条裁决里（它们在镝的出战前预测里）。
//
// 判定本身在 shared/sally-lock.ts，那边有红绿样本；这里只负责翻成人话。
const RANK_NAME: Record<number, string> = { 1: '丁', 2: '丙', 3: '乙', 4: '甲' }

// 判据本身在 shared/sally-lock.ts（那边有红绿样本），这里只负责取当前状态。
// activeEventAreaIds 每次调用都新建一个 Set，而这条判据在每一行、每一张图上都要问
// （eventRunningNow / currentSallyVerdict / sallyDetail）——按 mg.eventAreas 的
// 对象身份缓存：补丁经 IPC 过来一律是新对象，换了就自动重建。
let activeAreasCache: { src: unknown; areas: Set<number> } | null = null
const activeAreasNow = (): Set<number> => {
  if (!activeAreasCache || activeAreasCache.src !== mg.eventAreas) {
    activeAreasCache = { src: mg.eventAreas, areas: activeEventAreaIds(mg.eventAreas) }
  }
  return activeAreasCache.areas
}

const inActiveEvent = (areas: Set<number>) => (mapId: number) => {
  const areaId = mapAreaOf(mapId)
  return isEventMapArea(areaId) && areas.has(areaId)
}

// 给 Object.entries(mapGauges) 用的同一判据。Set 提到外面建一次，
// 原来写在 .filter() 里每条都重建一次
const inActiveEventBy = (areas: Set<number>) => ([id]: [string, unknown]) =>
  inActiveEvent(areas)(Number(id))

const eventRunningNow = () => activeAreasNow().size > 0

/**
 * 现在进行中的活动区 id（札名要按区查——每期活动的札号是各自重排的）。
 * 同时开着两个区不是现实情形；真出现就取号最大的那个（新的那期）。
 */
const currentEventAreaId = (): number | null => {
  const areas = [...activeAreasNow()]
  return areas.length ? Math.max(...areas) : null
}

/**
 * 本期活动的攻略页地址——**从矿脉包现取，代码里不写死**。
 *
 * 这里原来钉着 `https://zh.kcwiki.cn/wiki/2026年夏季活动`。下一期活动开幕，
 * 提示就会把玩家送去上期的页面，而且不报错、看不出来。
 *
 * 两个来源，按这个顺序：
 *
 * ① **第一方台账**（`shared/event-guide`，按活动区 id 记）。它排第一是因为
 *    `map-intel` ——唯一收活动图的那个包——**永不随包**（wikiwiki 内容条款，
 *    lode-sources 里 bundle:false）。只靠包的话，玩家那份产物里这句话会整段消失，
 *    而维护者机器上又有，两边看到的东西不一样。
 * ② 矿脉包现取（维护者机器、以及将来活动资料换到可随包的源之后）。
 *    包里每张活动图带两条地址，另有一条**不能用**的：
 *      · `event.lifecycleSourceUrl` —— 不是攻略表。实测那一格写的是官方 X 账号
 *        （起止日期的出处），指过去玩家什么也查不到；
 *      · `kcwikiUrl` —— 舰娘百科同一张图的中文页，中文界面里优先它；
 *      · `sourceUrl` —— wikiwiki 日文攻略页，接口里是必填，当兜底。
 *    同一期活动各图是同一套攻略，取图号最小的那张即可。
 *
 * 两条都取不到就返回 null，调用方整句不出——宁可少说一句，不留死链。
 */
const eventGuideUrl = (): string | null => {
  const areaId = currentEventAreaId()
  if (areaId == null) return null
  const firstParty = eventGuideUrlOf(areaId)
  if (firstParty) return firstParty
  const mine = mapIntelEntries()
    .filter(([code]) => Number(code.split('-')[0]) === areaId)
    .sort(([a], [b]) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
  for (const [, entry] of mine) {
    const url = entry.kcwikiUrl ?? entry.sourceUrl
    if (url) return url
  }
  return null
}

const currentSallyVerdict = (ships: PlayerShip[]) => {
  const areas = activeAreasNow()
  return sallyVerdict(
    ships.map((ship) => ship.sallyArea),
    mg.mapGauges ?? {},
    inActiveEvent(areas),
    areas.size > 0,
  )
}

// 逐图摆事实：难度、通关没有、查不查札。
// 原因（低难度不锁，还是已通关解锁）不替游戏下判断，只把它给的摆出来。
const sallyDetail = (): string =>
  Object.entries(mg.mapGauges ?? {})
    .filter(inActiveEventBy(activeAreasNow()))
    .map(([id, gauge]) => {
      const rank = gauge.selectedRank
        ? (RANK_NAME[gauge.selectedRank] ?? `难度${gauge.selectedRank}`)
        : '未选难度'
      const cleared = gauge.cleared ? '已通关' : '未通关'
      const limit = gauge.limitFlag == null ? '限制未知' : gauge.limitFlag === 1 ? '查札' : '不查札'
      return `${mapCodeOf(Number(id))} ${rank} · ${cleared} · ${limit}`
    })
    .join('\n')

const sallyFlagHtml = (ships: PlayerShip[]): string => {
  // 札也只在活动图画面说。它跟陆航是同一件事的两半：站在 1-1 的海域选择页上，
  // 「N 艘将被打札」既不会发生、也帮不上任何忙。
  if (!onEventMapScreen()) return ''
  const verdict = currentSallyVerdict(ships)
  if (verdict.kind === 'none') return ''
  const detail = sallyDetail()
  // 「能不能进」kuma判不了，所以不判：札绑在**阶段**上（同一张图解谜与绿条要的札
  // 就不同），还要按编成类型分，有些图还明确允许几种札混用（E-1/E-2/E-3 备注）；
  // 而且没有血条的阶段根本不下发 API，「现在打到哪一步」被动观测拿不全。
  //
  // 按札分组的完整名单**铎里已经有了**，这里不重复列，只说这支队特有的那件事：
  // 有几艘无札的会被打札（不可逆），以及现在有几张图在查。
  const guide = eventGuideUrl()
  const roster = '\n按札分组的完整名单见「活动」'
  // 取不到地址就整句不出——宁可少说一句，也不留一条送人去上期页面的死链
  const judge = guide
    ? `\n攻略表：${guide}`
    : ''
  const willTag = verdict.untagged
    ? `\n${verdict.untagged} 位无札 · 出击后永久打札`
    : ''
  const tail = verdict.untagged ? ` · ${verdict.untagged} 位将被打札` : ''

  if (verdict.kind === 'checking') {
    return `<span class="ab-flag warn" data-sally-jump="1" title="${esc(
      `札限制检查中：${verdict.enforcing.map(mapCodeOf).join('、')}${willTag}\n${detail}${roster}${judge}`,
    )}">${verdict.enforcing.length} 张图札限制检查中${tail}</span>`
  }
  if (verdict.kind === 'unknown') {
    return `<span class="ab-flag warn" data-sally-jump="1" title="${esc(
      `札限制尚未同步 · 打开游戏活动海域选择页${willTag}${roster}${judge}`,
    )}">札限制未知${tail}</span>`
  }
  if (verdict.kind === 'free') {
    return `<span class="ab-flag ok" data-sally-jump="1" title="${esc(
      `当前活动海域均无札限制 · 本队不受限\n${detail}${roster}`,
    )}">当前不查札</span>`
  }
  // 措辞用户 2026-08-11 点名要显化成整句;「期间限定」在直译黑名单里,
  // 按面板一贯口径写「限时活动海域」
  return `<span class="ab-flag warn" data-sally-jump="1" title="${esc(
    `${verdict.all ? '全队无札' : `${verdict.untagged} 位无札`}` +
      ` · 出击活动图后永久打札${roster}`,
  )}">${
    verdict.all
      ? '全队未打札 · 出击限时活动海域后永久打札'
      : `${verdict.untagged} 位未打札 · 出击限时活动海域后永久打札`
  }</span>`
}

/**
 * 出击中的大破名单落在哪一档（shared/taiha-verdict 的四档，判据与出处见那份头注）。
 *
 * 只给下面那句「大破进击有被击沉风险」把门：
 * - `protected`（只有联合二队旗舰大破）：她受系统保护不会轰沉，这句在她身上是错的决策信息；
 * - `forced`（旗舰大破且没带 damecon）：游戏根本不给进击选项，「进击有风险」无从谈起。
 * - `insured`：大破舰带损管，只说明进击会消耗。
 * 大破**计数**不受这里影响——她确实大破，维修视角的计数是对的。
 *
 * 坐标适配：shared 那套 index 是跨两队连号的舰位，判定只认 0（旗舰）与
 * 6（联合二队旗舰）两位有语义。这里**不去数一队有几个人**来推连号——一队不满 6 人时
 * 那样会错位——而是按「哪一队的第几位」直接给：一队首位 0、联合时二队首位 6，
 * 其余一律落到相邻的无语义位（1 / 7）。
 */
const sortieTaihaTier = (deck: Deck): 'forced' | 'danger' | 'insured' | 'protected' | null => {
  const combined = inCombined(deck)
  const fleetById = (id: number): PlayerShip[] => {
    const found = mg.decks.find((entry) => entry.id === id)
    return found ? fleetShips(found) : []
  }
  const segments: readonly (readonly [readonly PlayerShip[], number])[] = combined
    ? [[fleetById(1), FLAGSHIP_INDEX], [fleetById(2), ESCORT_FLAGSHIP_INDEX]]
    : [[fleetShips(deck), FLAGSHIP_INDEX]]
  const taiha: TaihaShipRef[] = []
  for (const [ships, lead] of segments) {
    // 已退避的舰不进名单：与上面几个计数同一条口径（她被送回港了，说的不是她）
    const engaged = new Set(engagedShips(ships).map((ship) => ship.id))
    ships.forEach((ship, at) => {
      if (!engaged.has(ship.id) || !shipIssues(ship).taiha) return
      // 名字只是判定函数的载荷，这里只读 tier，一个字都不进文案
      const damecon = [...ship.slot, ship.slotEx].map((instId) => mg.slotitems[instId]?.mstId)
        .find((id): id is 42 | 43 => id === 42 || id === 43) ?? null
      taiha.push({ index: at === 0 ? lead : lead + 1, name: masterShipName(ship.shipId), damecon })
    })
  }
  // 「装着」而非已消费：规则 ② 给的是战后的选择权。查 slot + 补强增设位，
  // 母港账本已经移除消耗的装备，没有战斗快照的「本场已消耗」需要再扣。
  return taihaVerdictOf(taiha, combined)?.tier ?? null
}

const verdictHtml = (deck: Deck) => {
  const ships = scopeShips(deck) // 联合编成时判定覆盖两队（06 稿）
  const problems: string[] = []
  let taiha = 0, chuuha = 0, unsup = 0, docked = 0, tired = 0
  const readyTs: number[] = []
  let repairReadyAt = 0
  // 已退避的舰不再进这几个计数：她被送回港了，「大破进击有被击沉风险」
  // 说的不是她；催修理也不是这一刻的事。
  for (const ship of engagedShips(ships)) {
    const issue = shipIssues(ship)
    if (issue.taiha) taiha++
    if (issue.chuuha) chuuha++
    if (issue.unsupplied) unsup++
    if (issue.docked) {
      docked++
      const dock = dockOf(ship.id)
      if (dock) {
        readyTs.push(dock.completeTime)
        // 全员就绪还包含疲劳恢复；修好时刻只取入渠舰。
        repairReadyAt = Math.max(repairReadyAt, dock.completeTime)
      }
    }
    if (issue.tired) {
      tired++
      const ready = fatigueReadyTs(ship.id, FATIGUE_READY_COND)
      if (ready != null) readyTs.push(ready)
    }
  }
  if (taiha) problems.push(`大破 ${taiha} ⚠`)
  if (chuuha) problems.push(`中破 ${chuuha}`)
  if (unsup) problems.push(`未补给 ${unsup}`)
  if (docked) problems.push(`入渠中 ${docked} · <span data-repair-latest="${repairReadyAt}">${repairReadyAt <= Date.now() ? repairClockText(repairReadyAt, Date.now()) : `最晚 ${fmtReturnClock(repairReadyAt, Date.now())} 修好`}</span>`)
  if (tired) problems.push(`疲劳 ${tired}`)

  const sally = sallyFlagHtml(ships)
  const flags = sally ? `<span class="vflags">${sally}</span>` : ''

  // 出击中的舰队不该被「暂缓出击」指手画脚（用户 2026-08-11 指出）——中破/
  // 未补给是海上的常态，就绪裁决只对「还没出门」的舰队有意义。改报「出击中」，
  // 状态照列；大破仍然红字点名——出击中的大破是「进击可能轰沉」级别的信息。
  const sortie = mg.sortie
  const onSortie =
    !!sortie?.active &&
    !sortie.practice &&
    (sortie.deckId === deck.id || (inCombined(deck) && sortie.deckId === 1))
  if (onSortie && sortie) {
    const supply = [...(sortie.nodes ?? [])].reverse().find((node) => node.offshoreSupply)?.offshoreSupply
    const supplyNote = supply ? ` · 已洋上补给 ×${supply.useNum}${sortie.supplyEstimated ? '（油弹估算）' : ''}` : ''
    const repairNote = sortie.anchorageRepairs?.length ? ` · 已泊地修理 ×${sortie.anchorageRepairs.length}` : ''
    // 风险句只在真有「进击可能轰沉」这回事时出（见 sortieTaihaTier）：
    // 联合二队旗舰受保护、旗舰大破没有进击选项，这两档说这句都是错的决策信息。
    // 停在 Boss 点或死路点时打完就回港，根本没有进击这一步，两句都不说。
    const tier = noAdvanceAfterNode(sortie) ? null : sortieTaihaTier(deck)
    return `<div class="verdict sortie${taiha ? '' : ' ok'}"><span class="ic">⚓</span>
      <span class="tx"><b>出击中 · ${sortie.mapArea}-${sortie.mapNo}</b><span>${
        problems.length ? problems.join(' · ') : '全员状态良好'
      }${supplyNote}${repairNote}${tier === 'danger' ? ' · 大破进击有被击沉风险' : tier === 'insured' ? ' · 大破舰带损管，进击会消耗' : ''}</span></span>${flags}</div>`
  }
  if (!problems.length) {
    // 全员 cond ≥ 49(闪闪):命中/回避的士气加成生效中,给一句金字
    //(2026-08-12 用户提议)。49 是游戏的キラ阈值,不是随手挑的数。
    const sparkled = ships.length > 0 && ships.every((ship) => ship.cond >= 49)
    return `<div class="verdict ok"><span class="ic">✓</span>
      <span class="tx"><b>可以出击</b><span>全员就绪 · 补给满 · ${
        sparkled ? '<b style="color:var(--gold)">补给与士气已满</b>' : '无疲劳'
      }</span></span>${flags}</div>`
  }
  const readyAt = readyTs.length ? Math.max(...readyTs) : 0
  const eta = readyAt
    ? readyAt <= Date.now()
      ? '<span class="eta">全员已就绪</span>'
      : `<span class="eta" data-ready-ts="${readyAt}">全员就绪预计<b><span data-cds="${readyAt}">${fmtCountdownShort(readyAt)}</span> 后</b></span>`
    : ''
  const title = taiha ? '禁止出击' : '暂缓出击'
  return `<div class="verdict"><span class="ic">!</span>
    <span class="tx"><b>${title}</b><span>${problems.join(' · ')}</span></span>${eta}${flags}</div>`
}

// ---- 联合舰队 ----

const COMBINED_FORMATION: Record<number, string> = {
  1: '空母机动',
  2: '水上打击',
  3: '运输护卫',
}

/** 该舰队是否处于联合编成中（联合只由第1+第2舰队组成） */
const inCombined = (deck: Deck) => mg.combinedFlag > 0 && (deck.id === 1 || deck.id === 2)
const combinedFleetLabel = () => `${COMBINED_FORMATION[mg.combinedFlag] ?? '已编成'}联合舰队`

/**
 * 度量与判定的作用范围，**保留分队边界**：联合时是 [第一舰队, 第二舰队]，否则只此队一支。
 *
 * 边界不能丢——输送量按图专用表算时是分队各自取整的（见 shared/transport-point）。
 * 其余度量不关心边界，走下面 flat 过的 scopeShips。
 */
const scopeFleets = (deck: Deck): PlayerShip[][] => {
  if (!inCombined(deck)) return [fleetShips(deck)]
  const first = mg.decks.find((d) => d.id === 1)
  const second = mg.decks.find((d) => d.id === 2)
  return [first ? fleetShips(first) : [], second ? fleetShips(second) : []]
}

/** 度量与判定的作用范围：联合时覆盖两队，否则只此队 */
const scopeShips = (deck: Deck): PlayerShip[] => scopeFleets(deck).flat()

let lastSortieScreenCue = 0
const warnSortieReadiness = (ts: number) => {
  if (ts - lastSortieScreenCue < 3000) return
  lastSortieScreenCue = ts
  const warnings: { deckId: number; label: string; detail: string; critical: boolean }[] = []
  for (const deck of mg.decks) {
    if (deck.mission?.[0] > 0 || !fleetShips(deck).length) continue
    // 自己出击的队在这里跳过；联合随伴二队由下一行跳过，海上的都不提醒。
    if (deckOnSortie(deck.id)) continue
    if (inCombined(deck) && deck.id === 2) continue
    let taiha = 0, chuuha = 0, unsupplied = 0, docked = 0, tired = 0
    // 同 verdictHtml：已退避的舰不再进计数
    for (const ship of engagedShips(scopeShips(deck))) {
      const issue = shipIssues(ship)
      if (issue.taiha) taiha++
      if (issue.chuuha) chuuha++
      if (issue.unsupplied) unsupplied++
      if (issue.docked) docked++
      if (issue.tired) tired++
    }
    const parts = [
      taiha ? `大破 ${taiha}` : '',
      chuuha ? `中破 ${chuuha}` : '',
      unsupplied ? `未补给 ${unsupplied}` : '',
      docked ? `入渠中 ${docked}` : '',
      tired ? `疲劳 ${tired}` : '',
    ].filter(Boolean)
    if (!parts.length) continue
    warnings.push({
      deckId: deck.id,
      label: inCombined(deck) ? '联合舰队' : fleetLabel(deck).canonical,
      detail: parts.join('、'),
      critical: taiha > 0,
    })
  }
  const shipRemain = mg.basic?.maxShips
    ? Math.max(0, mg.basic.maxShips - Object.keys(mg.ships).length)
    : null
  const equipRemain = mg.basic?.maxSlotitems
    ? Math.max(0, mg.basic.maxSlotitems - countCapacitySlotitems(mg.slotitems))
    : null
  const capacityParts = [
    shipRemain != null && shipRemain <= 5 ? `舰娘仓库仅余 ${shipRemain} 格` : '',
    equipRemain != null && equipRemain <= 20 ? `装备仓库仅余 ${equipRemain} 格` : '',
  ].filter(Boolean)
  // 陆航与札都**不在这里**报：这一页（出击海域选择页）不区分你要去哪儿，
  // 在这里报就等于去 1-1 也弹一次。两条改挂在「打开了具体海区」上——
  // 札看活动区，陆航看该区驻没驻中队（常规 6/7 区也算）,见 warnOnEventMapOpen。
  if (!warnings.length && !capacityParts.length) return
  warnings.sort((a, b) => Number(b.critical) - Number(a.critical) || a.deckId - b.deckId)
  const first = warnings[0]
  const fleetDetail = warnings
      .slice(0, 3)
      .map((warning) => `${warning.label}：${warning.detail}`)
      .join('；') + (warnings.length > 3 ? `；另有 ${warnings.length - 3} 支舰队` : '')
  const detail = [fleetDetail, capacityParts.join('、')].filter(Boolean).join('；')
  const hasCriticalFleet = warnings.some((warning) => warning.critical)
  const capacityRef =
    shipRemain != null && shipRemain <= 5
      ? { type: 'shipCapacity', id: 'current' }
      : { type: 'equipCapacity', id: 'current' }
  showSortieReadinessToast(
    hasCriticalFleet
      ? '出击前检查：编成中存在大破舰'
      : warnings.length
        ? '出击前检查：可用舰队状态不佳'
        : '出击前检查：仓库接近上限',
    detail,
    first?.deckId ?? 1,
    hasCriticalFleet,
    first ? { type: 'fleet', id: first.deckId } : capacityRef,
  )
}
onSortieScreen(warnSortieReadiness)
// mapinfo = 打开了海域选择页。札与陆航那两条从这一刻起才说得上话，
// 回母港（或转去演习）再撤下——见 noteScreenLeft。
onSortieScreen(() => {
  if (atMapSelect) return
  atMapSelect = true
  deferPassive(pane, 'ru', render)
})

/**
 * 札在**打开活动图**时提醒;陆航在**打开驻有中队的海区**时提醒
 * (中部 6 / 南西 7 的常规图一样用基地航空——把它也锁在活动图上曾造成
 * 6-4/6-5 缺补给漏报,2026-08-11 用户抓的)。
 *
 * 以前挂在出击海域选择页（api_get_member/mapinfo），可那一页不区分你要去哪儿——
 * 去 1-1 也会弹「出击即打札」「基地航空未补给」，两条都是假警报。
 * 而 kcsapi 从头到尾不说你打开了哪张图：选区、切区都不发请求，
 * 真正带图号的 api_req_map/start 到手时札已经打上了。
 *
 * 信号在静态资源上：打开一张海域必然要取它的美术，路径里就带着区号与图号
 * （实测缓存里有 /kcs2/resources/map/062/01_info.json 这类，062 正是活动区）。
 * 主进程在 onBeforeRequest 里认出来并广播，这里只管翻成人话。
 *
 * 两件事写进同一条：它们落在同一刻、同一个「点进去之前最后能改」的窗口里，
 * 分两条弹只会互相盖住。
 */
let lastSallyCue = 0
const warnOnEventMapOpen = (areaId: number, ts: number): void => {
  // 开图是主进程的即时事件，可能先于偏好 IPC 到达；提醒判据现取已落盘的集合。
  mutedAreas = uiGet<number[]>(AIR_BASE_MUTE_KEY, [])
  // **出击途中一律闭嘴**(2026-08-27 用户在活动图打到一半被反复弹出抓的)。
  // 这条信号是「取了某张海域的美术」,而进点、过场同样在取——它认不出
  // 你是在选图还是已经踩在 F 点上,下面那道 8 秒防抖跨点位再加载也挡不住。
  // 而这一刻补给与札都已经不可改,提醒无从执行,只剩打断。
  // 判触发时刻的状态而不是记一个标志:回港后 sortie.active 自己落下,
  // 再打开海区照常弹,没有「忘记复位」这条路。演习一并挡掉(同样改不了了)。
  if (mg.sortie?.active) return
  // 札只在活动区落;陆航跟着「这个区驻没驻中队」走——中部(6)/南西(7)的
  // 常规图一样用基地航空,此前整条挂在活动区上,6-4/6-5 缺补给漏报
  // (2026-08-11 用户抓的)。两个判据各自成立与否决定各自的段落。
  const eventArea = activeAreasNow().has(areaId)
  const hasSquadsHere = mg.airBases.some((squad) => squad.areaId === areaId)
  if (!eventArea && !hasSquadsHere) return
  if (ts - lastSallyCue < 8000) return // 一张图会取好几份资源，别连着弹
  const parts: string[] = []
  if (eventArea) {
    for (const deck of mg.decks) {
      if (deck.mission?.[0] > 0 || !fleetShips(deck).length) continue
      // 自己出击的队在这里跳过；联合随伴二队由下一行跳过，海上的都不提醒。
      if (deckOnSortie(deck.id)) continue
      if (inCombined(deck) && deck.id === 2) continue
      const verdict = currentSallyVerdict(scopeShips(deck))
      const untagged = verdict.kind === 'none' ? 0 : verdict.untagged
      if (untagged) {
        parts.push(`${inCombined(deck) ? '联合舰队' : `第${deck.id}舰队`} ${untagged} 位未锁定`)
      }
    }
  }
  // 陆航：只数摊开这个区的中队——别的区缺补给与这一趟无关。
  // 未补给的格子出击时不产生输出，红疲劳大幅削命中。
  const airBase = hasSquadsHere && !isAirBaseAreaMuted(mutedAreas, areaId) ? airBaseReadiness(areaId) : null
  const airBaseParts = airBase
    ? [
        airBase.short ? `基地航空 ${airBase.short} 队未补给` : '',
        airBase.red ? `基地航空 ${airBase.red} 队红疲劳` : '',
      ].filter(Boolean)
    : []
  if (!parts.length && !airBaseParts.length) return
  lastSallyCue = ts
  const detail = [
    parts.length ? `${parts.join('、')} · 出击后永久打札` : '',
    airBaseParts.length ? airBaseParts.join('、') : '',
  ]
    .filter(Boolean)
    .join('；')
  showSortieReadinessToast(
    parts.length
      ? '活动海域 · 出击后永久打札'
      : eventArea
        ? '活动海域 · 基地航空队未就绪'
        : '当前海区 · 基地航空队未就绪',
    detail,
    1,
    false,
    parts.length ? { type: 'fleet', id: 1 } : { type: 'fleet', id: AIR_BASE_TAB_ID },
  )
}

const AIR_BASE_ACTION: Record<number, [string, string]> = {
  0: ['待机', 'idle'],
  1: ['出击', 'sortie'],
  2: ['防空', 'defense'],
  3: ['退避', 'rest'],
  4: ['休息', 'rest'],
}

const trackedAirBases = (): AirBaseSquad[] => {
  const eventAreas = new Set(Object.keys(mg.eventAreas).map(Number))
  const tracked = mg.airBases.filter(
    (squad) => squad.areaId === 6 || squad.areaId === 7 || eventAreas.has(squad.areaId) || squad.areaId > 10,
  )
  // 旧快照可能没有 eventAreas；不能因此把已经同步到的陆航静默藏掉。
  return tracked.length || !mg.airBases.length ? tracked : mg.airBases
}

const airBaseAreaLabel = (areaId: number): string => {
  const fallback =
    areaId === 6
      ? '中部海域'
      : areaId === 7
        ? '南西海域'
        : areaId > 10
          ? `活动海域 ${areaId}`
          : `海域 ${areaId}`
  const localized = entityNamePlain('mapArea', areaId, mapAreaNames.get(areaId) ?? fallback)
  return areaId === 6 || areaId === 7
    ? `第${areaId}海域 · ${localized}`
    : `活动海域 · ${localized}`
}

const airBaseSlots = (squad: AirBaseSquad) => [{
  slot: squad.planes.map((plane) => plane.slotId),
  onslot: squad.planes.map((plane) => plane.count),
}]

const airPowerText = (power: { min: number; max: number }) =>
  power.min === power.max ? `${power.min}` : `${power.min}–${power.max}`

const airBasePlaneHtml = (plane: AirBaseSquad['planes'][number]): string => {
  if (plane.slotId <= 0) return '<span class="ab-plane empty">空位</span>'
  const inst = mg.slotitems[plane.slotId]
  const mst = inst ? mg.master.slotitems[inst.mstId] : undefined
  const name = mst ? entityNamePlain('equip', inst!.mstId, mst.name) : '未知机体'
  const low = plane.count < plane.maxCount
  // 红疲劳比橙疲劳更伤：以前两者共用一个 tired 类，颜色一样，只有文字能分辨。
  const fatigue = plane.cond >= 3 ? '红疲劳' : plane.cond === 2 ? '橙疲劳' : ''
  const fatigueCls = plane.cond >= 3 ? ' tired red' : plane.cond === 2 ? ' tired' : ''
  const changing = plane.state === 2 ? '换装中' : ''
  const status = [
    inst?.level ? `★${inst.level >= 10 ? 'MAX' : inst.level}` : '',
    inst?.alv ? `熟练 ${inst.alv}` : '',
    changing,
    fatigue,
  ].filter(Boolean)
  const icon = mst && inst
    ? equipPeekIconHtml(inst.mstId, mst.iconId, name, { className: 'sm' })
    : equipTypeIconHtml(-1, { className: 'sm', title: name })
  const linkedName = mst && inst ? elink('mstEquip', inst.mstId, mst.name) : entityTermHtml('mstEquip', inst?.mstId, name)
  return `<span class="ab-plane${low ? ' low' : ''}${fatigueCls}" title="${esc(
    [name, ...status].join(' · '),
  )}">${icon}<span class="ab-plane-name">${linkedName}</span><b>${plane.count}/${plane.maxCount}</b>${
    status.length ? `<i>${esc(status.join(' · '))}</i>` : ''
  }</span>`
}

const airBaseAreaHtml = (areaId: number, squads: AirBaseSquad[]): string => {
  const muted = isAirBaseAreaMuted(mutedAreas, areaId)
  const ordered = [...squads].sort((a, b) => a.rid - b.rid)
  const sortiePowers = ordered.map((squad) => fleetAirPower(airBaseSlots(squad), 1))
  const defensePowers = ordered.map((squad) => fleetAirPower(airBaseSlots(squad), 2))
  const sum = (rows: { min: number; max: number }[]) => ({
    min: rows.reduce((total, row) => total + row.min, 0),
    max: rows.reduce((total, row) => total + row.max, 0),
  })
  const currentPlanes = squads.reduce(
    (total, squad) => total + squad.planes.reduce((n, plane) => n + (plane.slotId > 0 ? plane.count : 0), 0),
    0,
  )
  const maxPlanes = squads.reduce(
    (total, squad) => total + squad.planes.reduce((n, plane) => n + (plane.slotId > 0 ? plane.maxCount : 0), 0),
    0,
  )
  const syncedTs = Math.max(0, ...squads.map((squad) => squad.ts ?? 0))

  const rows = ordered
    .map((squad, index) => {
      const [action, actionClass] = AIR_BASE_ACTION[squad.actionKind] ?? [`行动 ${squad.actionKind}`, 'idle']
      const sortie = sortiePowers[index]
      const defense = defensePowers[index]
      const squadShort = squad.planes.some((plane) => plane.slotId > 0 && plane.count < plane.maxCount)
      const squadTired = squad.planes.some((plane) => plane.slotId > 0 && plane.cond >= 2)
      const squadRed = squad.planes.some((plane) => plane.slotId > 0 && plane.cond >= 3)
      const customName = airBaseCustomName(squad)
      return `<div class="ab-squad${!muted && (squadShort || squadTired) ? ' warn' : ''}">
        <div class="ab-squad-head">
          <b>第${squad.rid}航空队</b>${customName ? `<span class="ab-name">${entityTermHtml('fleet', `air:${squad.areaId}:${squad.rid}`, customName)}</span>` : ''}
          <span class="ab-action ${actionClass}">${esc(action)}</span>
          <span class="ab-distance">半径 <b>${squad.distance}</b></span>
        </div>
        <div class="ab-squad-metrics">
          <span>出击制空 <b>${airPowerText(sortie)}</b></span>
          <span>防空制空 <b>${airPowerText(defense)}</b></span>
          ${!muted && squadShort ? '<span class="bad">需要补给</span>' : ''}
          ${!muted && squadTired ? `<span class="${squadRed ? 'bad' : 'warn'}">存在${squadRed ? '红' : '橙'}疲劳</span>` : ''}
        </div>
        <div class="ab-planes">${squad.planes.map(airBasePlaneHtml).join('')}</div>
      </div>`
    })
    .join('')

  return `<section class="ab-area">
    <div class="ab-area-head">
      <b>${esc(airBaseAreaLabel(areaId))}</b><span>${squads.length} 队 · 搭载 ${currentPlanes}/${maxPlanes}</span>
      <button type="button" class="ab-mute" data-act="air-base-mute" data-area-id="${areaId}" aria-pressed="${muted}" title="${muted ? '恢复该海域陆航的未补给、疲劳与被打空提示' : '不再提示该海域陆航的未补给、疲劳与被打空'}">${muted ? '已静默 · 恢复提示' : '静默提示'}</button>
      ${muted ? '<span class="ab-muted-note">提示已静默</span>' : ''}
      ${syncedTs ? `<span>同步于 ${fmtTime(syncedTs)}</span>` : '<span>旧记录 · 同步时间未知</span>'}
      <span class="ab-area-ap">出击Σ <b>${airPowerText(sum(sortiePowers))}</b> · 防空Σ <b>${airPowerText(sum(defensePowers))}</b></span>
    </div>
    ${rows}
  </section>`
}

const airBaseViewHtml = (): string => {
  const bases = trackedAirBases()
  if (!bases.length) {
    return `<div class="ab-empty-state">
      <b>尚未同步基地航空队</b>
      <span>打开游戏出击海域选择页</span>
    </div>`
  }
  const byArea = new Map<number, AirBaseSquad[]>()
  for (const squad of bases) {
    const rows = byArea.get(squad.areaId) ?? []
    rows.push(squad)
    byArea.set(squad.areaId, rows)
  }
  const areaOrder = (id: number) => id === 6 ? 0 : id === 7 ? 1 : 2 + id
  return `<div class="airbase-view">${[...byArea.entries()]
    .sort((a, b) => areaOrder(a[0]) - areaOrder(b[0]))
    .map(([areaId, squads]) => airBaseAreaHtml(areaId, squads))
    .join('')}</div>`
}

// ---- 头部度量收纳 ----

/**
 * 度量行封顶一行（2026-08-20 用户拍板的方案）。
 *
 * 抬头每多占一行，编队区就少那么多高度——度量条 flex-wrap 一换行就吃掉 24px
 * （实测：一行度量 21px + 3px 间距），信息一多第六舰被顶出视野要翻页。
 * 所以身份行（第N舰队 + 自定义名 + 同步时刻 + 出击裁决）永远完整，
 * 度量行**只占一行**：放不下的按固定优先级收进行尾一枚「⋯N」小芯片，
 * 悬停展开完整卡看全部被收项（「可查不常驻」的既定哲学——收起不等于查不到）。
 *
 * 收纳优先级（先收 → 后收，用户逐项定的）：
 *   TP → 构成 → 平均Lv → 航速 → 联合合并 → 索敌33 → 制空
 * 用户原话：运输量除活动和月一次的 5-6 之外基本用不到，平时藏了丝毫不影响。
 * 制空与索敌33 是临战数字，**最后才收**。
 * 联合合并夹在中间：它只说这几个数覆盖了两支队，而页签与身份行本来就写着
 * 「XX联合舰队」，收进卡里也不会让人看错口径。
 */
// 损管随度量行收纳，保留原有各项的相对优先级；不新增显示开关。
const FLEET_METRIC_FOLD_ORDER = ['tp', 'comp', 'lv', 'soku', 'cmb', 'damecon', 'los', 'air'] as const
/** 陆航抬头同构，一样封顶一行：先收静态计数，缺补给与疲劳这两条能动手的留到最后。 */
const AIR_BASE_METRIC_FOLD_ORDER = ['areas', 'squads', 'short', 'tired'] as const

const METRIC_ROW_ITEMS = {
  fleet: [
    ['air', '制空'],
    ['los', '索敌33'],
    ['comp', '构成'],
    ['soku', '航速'],
    ['lv', '平均Lv'],
    ['tp', 'TP'],
    ['cmb', '联合合并'],
  ],
  airbase: [
    ['areas', '海域'],
    ['squads', '航空队'],
    ['short', '待补给'],
    ['tired', '疲劳'],
  ],
} as const
type MetricRowId = keyof typeof METRIC_ROW_ITEMS

const metricsHidden: Record<MetricRowId, string[]> = {
  fleet: uiGet<string[]>('ru.metricsHidden.fleet', []),
  airbase: uiGet<string[]>('ru.metricsHidden.airbase', []),
}
for (const rowId of ['fleet', 'airbase'] as const) {
  onUiPreferenceChange(`ru.metricsHidden.${rowId}`, () => {
    metricsHidden[rowId] = uiGet<string[]>(`ru.metricsHidden.${rowId}`, [])
    scheduleRender()
  })
}

/** 纯函数出口给产物回归测试：隐藏发生在拼串前，收纳只会量到剩余芯片。 */
export const metricsRowMarkup = (
  rowId: string,
  order: readonly string[],
  hidden: readonly string[],
  chips: string[],
): string => {
  const hiddenKeys = new Set(hidden)
  const visibleChips = chips.filter(Boolean).filter((chip) => {
    const key = /\bdata-mkey="([^"]+)"/.exec(chip)?.[1]
    return !!key && !hiddenKeys.has(key)
  })
  return `<div class="metrics" data-mrow="${rowId}" data-mfold="${order.join(',')}">${visibleChips.join('')}<span class="mchip mfold m-folded" data-metrics-fold tabindex="0" aria-label="展开收起的度量">⋯<b>0</b></span></div>`
}

/** 点单项就反转；点「全部显示」传 null，清空隐藏项。 */
export const nextMetricHidden = (
  order: readonly string[],
  hidden: readonly string[],
  key: string | null,
): string[] => {
  if (key === null) return []
  const next = new Set(hidden)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return order.filter((item) => next.has(item))
}

/** 度量行：芯片各带 key，行尾常备一枚「⋯N」（没收东西时它自己是收起的）。 */
const metricsRowHtml = (rowId: MetricRowId, order: readonly string[], chips: string[]): string =>
  metricsRowMarkup(rowId, order, metricsHidden[rowId], chips)

// 右键选择显示项：复用全局 .cmenu 皮肤；面板既裁 overflow 又有 transform 包含块，
// 所以浮层挂 body，且只按需建一次，不随编队被动重渲染一起生灭。
let metricsMenu: HTMLElement | null = null
let metricsMenuRow: MetricRowId | null = null

const metricRowIdOf = (value: string | undefined): MetricRowId | null =>
  value === 'fleet' || value === 'airbase' ? value : null

const hideMetricsMenu = () => metricsMenu?.classList.remove('show')

const fillMetricsMenu = (rowId: MetricRowId) => {
  if (!metricsMenu) return
  const hidden = new Set(metricsHidden[rowId])
  const items = METRIC_ROW_ITEMS[rowId].map(
    ([key, label]) =>
      `<div class="mi${hidden.has(key) ? '' : ' on'}" data-metric-key="${key}">${label}</div>`,
  )
  metricsMenu.innerHTML = `<div class="m-t">显示哪些</div>${items.join('')}<div class="mi pri" data-metric-all>全部显示</div>`
}

const ensureMetricsMenu = () => {
  if (metricsMenu) return metricsMenu
  metricsMenu = document.createElement('div')
  metricsMenu.id = 'ru-metrics-menu'
  metricsMenu.className = 'cmenu'
  document.body.appendChild(metricsMenu)
  metricsMenu.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-metric-key], [data-metric-all]')
    if (!item || !metricsMenuRow) return
    const rowId = metricsMenuRow
    const order = METRIC_ROW_ITEMS[rowId].map(([key]) => key)
    metricsHidden[rowId] = nextMetricHidden(
      order,
      metricsHidden[rowId],
      item.hasAttribute('data-metric-all') ? null : (item.dataset.metricKey ?? null),
    )
    uiSet(`ru.metricsHidden.${rowId}`, metricsHidden[rowId])
    fillMetricsMenu(rowId)
    render()
  })
  document.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('#ru-metrics-menu')) hideMetricsMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideMetricsMenu()
  })
  return metricsMenu
}

const showMetricsMenu = (rowId: MetricRowId, x: number, y: number) => {
  const menu = ensureMetricsMenu()
  metricsMenuRow = rowId
  fillMetricsMenu(rowId)
  const itemCount = METRIC_ROW_ITEMS[rowId].length + 1
  menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`
  menu.style.top = `${Math.min(y, window.innerHeight - 40 - itemCount * 24)}px`
  menu.classList.add('show')
}

/**
 * 收纳的**判定本身**：纯算术，不碰 DOM。
 *
 * 给定各芯片的实际宽度、「⋯N」自身宽度、芯片间距与可用行宽，按 order 从前往后
 * 逐个收，直到一行放得下；再把放得回去的放回来（见下）。返回被收项的 key。
 * order 里列了、这一行却没有的 key（例如非联合时的 cmb）直接跳过，不占名额。
 */
const planMetricsFold = (input: {
  widths: Map<string, number>
  order: readonly string[]
  moreWidth: number
  gap: number
  avail: number
  /** 上一拍的方案：只用来做滞回，不影响「谁先收」 */
  previous?: readonly string[]
  /** 滞回死区（px）：上一拍收着的项要多出这么多才放出来 */
  hysteresis?: number
}): string[] => {
  const previous = new Set(input.previous ?? [])
  const hysteresis = input.hysteresis ?? 0
  const folded = new Set<string>()
  /**
   * 这套方案摆得下吗。
   *
   * 亚像素余量 0.5：宽度是小数，别为 0.2px 白收掉一项。
   * 滞回：**上一拍收着、这一拍想放出来**的项要多出 hysteresis 才算放得下，
   * 收起来则一到放不下就收——两个阈值差出一条死区，临界宽度上不会来回翻。
   */
  const fits = () => {
    let total = 0
    let count = 0
    let reopening = false
    for (const [key, width] of input.widths) {
      if (folded.has(key)) continue
      total += width
      count += 1
      if (previous.has(key)) reopening = true
    }
    if (folded.size) {
      total += input.moreWidth
      count += 1
    }
    if (count > 1) total += input.gap * (count - 1)
    return total + (reopening ? hysteresis : 0) <= input.avail + 0.5
  }
  for (const key of input.order) {
    if (fits()) break
    if (input.widths.has(key)) folded.add(key)
  }
  // 「真放不下才收」（2026-08-21 用户报的就是这个）：上面按优先级逐个收，
  // **最后收的那一枚往往把前面几枚的位置也一起让了出来**——实测那一档：
  // 只收 TP（78px）还差 13px，于是构成（172px）也让了路，行尾当场空出 158px，
  // 而 TP 只要 78px，本来放得回去。用户看到的就是「后面明明有位置也收起来了」。
  // 于是倒着（价值从高到低、也就是最后收的先试）挨个放回：放得下就放回，
  // 放不下才留在「⋯N」里。收纳次序没有被破坏——谁先进「⋯」仍由 order 决定，
  // 能被放回来的一定比最后收的那枚更窄，不会出现「宽的挤掉窄的」。
  for (const key of [...folded].reverse()) {
    folded.delete(key)
    if (!fits()) folded.add(key)
  }
  // 按 order 归位再返回：Set 的插入序被上面的放回打乱过，而调用方（与守卫）
  // 读到的应当始终是「收纳次序」
  return input.order.filter((key) => folded.has(key))
}

/** 滞回死区：只吃亚像素抖动与滚动条那一档的来回，肉眼看不出「本来能放下」 */
const METRICS_FOLD_HYSTERESIS = 6

const metricsFoldCache = new Map<string, { sig: string; probe: number; folded: string[] }>()

const applyMetricsFold = (chips: HTMLElement[], more: HTMLElement, folded: string[]) => {
  const hidden = new Set(folded)
  for (const chip of chips) chip.classList.toggle('m-folded', hidden.has(chip.dataset.mkey ?? ''))
  more.classList.toggle('m-folded', folded.length === 0)
  const count = more.querySelector('b')
  if (count && folded.length) count.textContent = `${folded.length}`
}

/**
 * 元素的真实可用内容宽（小数）。
 *
 * clientWidth 是**取整**的：真宽 461.97 会读成 462，那多出来的 0.03px 加上
 * 0.5 的亚像素余量，足以把「刚好放得下」变成真换行。判定用小数，取整值只配当
 * 缓存钥匙（见 foldMetricsRow 的 probe）。
 */
const contentWidthOf = (el: HTMLElement): number => {
  const style = getComputedStyle(el)
  const px = (value: string) => parseFloat(value) || 0
  return (
    el.getBoundingClientRect().width -
    px(style.paddingLeft) -
    px(style.paddingRight) -
    px(style.borderLeftWidth) -
    px(style.borderRightWidth)
  )
}

/**
 * 量一次、算一遍、收到位，再用实测复核一拍。
 *
 * 不做「收一枚量一次」的反复回流：一次批量读出各芯片实际宽度与行宽，剩下的
 * 全交给 planMetricsFold。测量前先把所有芯片摊开——量的必须是自然宽度，
 * 芯片因此在 CSS 里 flex:none + nowrap，既不参与伸缩也不内部折行。
 * 可用宽也在摊开之后才读：与各芯片宽度出自同一份布局，中间不隔改类。
 *
 * 同宽同内容直接套上次的结果：decks/ships 是全场最高频的补丁（战斗中每个阶段
 * 都到），每次都重量一遍既是白费回流，也会在临界宽度上来回翻——那就是闪跳。
 */
const foldMetricsRow = (row: HTMLElement) => {
  const chips = [...row.querySelectorAll<HTMLElement>('.mchip[data-mkey]')]
  const more = row.querySelector<HTMLElement>('[data-metrics-fold]')
  if (!chips.length || !more) return
  const sig = chips.map((chip) => `${chip.dataset.mkey}=${chip.textContent}`).join('|')
  // 行宽为 0 = 面板还没显示（模块没激活 / 坞没展开）。这时量出来的结论是
  // 「全都放不下」，会把整条度量收干净，等真显示出来又得翻回去。不知道就先不动。
  const probe = row.clientWidth
  if (probe <= 0) return
  const rowId = row.dataset.mrow ?? ''
  const cached = metricsFoldCache.get(rowId)
  if (cached && cached.sig === sig && cached.probe === probe) {
    applyMetricsFold(chips, more, cached.folded)
    return
  }
  for (const chip of chips) chip.classList.remove('m-folded')
  more.classList.remove('m-folded')
  const widths = new Map<string, number>()
  const moreRect = more.getBoundingClientRect()
  // 一行有多高 = 摊开时最高的那一枚（.metrics 是 align-items:center 的 flex 行，
  // 单行时行高就等于最高一枚）。下面的复核靠它区分「一行」和「换了行」。
  let lineHeight = moreRect.height
  for (const chip of chips) {
    const rect = chip.getBoundingClientRect()
    widths.set(chip.dataset.mkey ?? '', rect.width)
    lineHeight = Math.max(lineHeight, rect.height)
  }
  const order = (row.dataset.mfold ?? '').split(',').filter(Boolean)
  const folded = planMetricsFold({
    widths,
    order,
    moreWidth: moreRect.width,
    gap: parseFloat(getComputedStyle(row).columnGap) || 0,
    avail: contentWidthOf(row),
    // 同一份内容才谈得上滞回；内容一变（sig 变了）本来就该重新按实际宽度算
    previous: cached?.sig === sig ? cached.folded : undefined,
    hysteresis: METRICS_FOLD_HYSTERESIS,
  })
  // 摆上去之后**再用实测复核**：算术说放得下、真画出来仍换了行（字体度量、
  // 页面缩放、亚像素都可能差那么一点），就按次序再收一枚，直到真的只剩一行。
  // 封顶一行是这套收纳的全部意义——宁可多收一枚，也不能让抬头偷走一艘舰的高度。
  const applied = [...folded]
  for (let guard = 0; guard <= chips.length; guard += 1) {
    applyMetricsFold(chips, more, applied)
    if (row.getBoundingClientRect().height <= lineHeight + 1) break
    const next = order.find((key) => widths.has(key) && !applied.includes(key))
    if (!next) break
    applied.push(next)
  }
  // 只改类不动 innerHTML：commitPaneHtml 记的那份字符串仍与 DOM 对得上
  // （下一次渲染生成同样的字符串就该整段跳过，收纳结果本来就是同一份），
  // 所以这里不需要 forgetCommittedHtml。
  // 存回缓存时按 order 归位：复核补收的那几枚是往后追加的，顺序会乱
  metricsFoldCache.set(rowId, { sig, probe, folded: order.filter((key) => applied.includes(key)) })
}

const foldMetrics = (root: HTMLElement) => {
  root.querySelectorAll<HTMLElement>('.metrics[data-mfold]').forEach(foldMetricsRow)
}

/**
 * 「⋯N」的展开卡。
 *
 * 挂 `document.body`，不在面板里就地 absolute：面板既裁 overflow、又带 transform
 * （.ws-pane 上是个空变换）——absolute 会被裁掉，fixed 则把「相对视口」变成
 * 「相对面板」飞出屏幕（2026-08-09 连栽三次才定位）。位置在填完内容之后用
 * getBoundingClientRect 现算，先 visibility:hidden 再定位现形（同镝的装备浮层）。
 */
let metricsFoldCard: HTMLElement | null = null
let metricsFoldCardReady = false
let metricsFoldHideTimer: ReturnType<typeof setTimeout> | null = null

const hideMetricsFoldCard = () => metricsFoldCard?.classList.remove('show')

const scheduleMetricsFoldHide = () => {
  if (metricsFoldHideTimer) clearTimeout(metricsFoldHideTimer)
  metricsFoldHideTimer = setTimeout(hideMetricsFoldCard, 180)
}

const showMetricsFoldCard = (anchor: HTMLElement) => {
  const card = metricsFoldCard
  if (!card) return
  if (metricsFoldHideTimer) clearTimeout(metricsFoldHideTimer)
  // 被收项按**完整形态**排列：直接克隆行里那几枚芯片，字样与摊开时一模一样，
  // 不另写一份措辞（另写就会有一天和行内对不上）。
  const row = anchor.closest<HTMLElement>('.metrics')
  const folded = [...(row?.querySelectorAll<HTMLElement>('.mchip.m-folded[data-mkey]') ?? [])]
  if (!folded.length) {
    hideMetricsFoldCard()
    return
  }
  // 卡片只放度量本体——机制解释是给施工者的，不进 UI（2026-08-20 用户抓过一次）。
  card.innerHTML = `<div class="mfc-card">
    <div class="mfc-chips"></div>
  </div>`
  const host = card.querySelector('.mfc-chips')
  for (const chip of folded) {
    const clone = chip.cloneNode(true) as HTMLElement
    clone.classList.remove('m-folded')
    host?.appendChild(clone)
  }
  card.style.visibility = 'hidden'
  card.classList.add('show')
  const rect = anchor.getBoundingClientRect()
  const width = card.offsetWidth
  const height = card.offsetHeight
  const above = rect.bottom + height > window.innerHeight - 6 && rect.top >= height
  card.classList.toggle('above', above)
  card.style.left = `${Math.min(
    Math.max(4, rect.left - 8),
    Math.max(4, window.innerWidth - width - 4),
  )}px`
  card.style.top = `${Math.max(4, above ? rect.top - height : rect.bottom)}px`
  card.style.visibility = ''
}

/**
 * 被动重渲染会把整条度量行连同锚点换掉。卡还开着就重新贴到新锚点上——
 * 否则它会钉在原地显示一份已经过期的快照（元素住在 body，不随 pane 生灭）。
 */
const refreshMetricsFoldCard = () => {
  if (!metricsFoldCard?.classList.contains('show')) return
  const anchor = pane?.querySelector<HTMLElement>('.metrics [data-metrics-fold]:not(.m-folded)')
  if (anchor) showMetricsFoldCard(anchor)
  else hideMetricsFoldCard()
}

/**
 * 卡与它的监听都只装一次（自带闸门）：卡住在 body、不随 pane 生灭，
 * 判据靠 [data-metrics-fold] 选择器收窄，所以重复 mount 不会叠监听。
 */
const initMetricsFoldCard = () => {
  if (metricsFoldCardReady) return
  metricsFoldCardReady = true
  metricsFoldCard = document.createElement('div')
  metricsFoldCard.id = 'ru-metrics-fold'
  // 卡在 body 上，靠这个类才吃得到 .fleet-skin 下的芯片样式（克隆进来的就是那几枚）
  metricsFoldCard.className = 'fleet-skin'
  metricsFoldCard.setAttribute('role', 'tooltip')
  document.body.appendChild(metricsFoldCard)
  const anchorOf = (node: EventTarget | null) =>
    node instanceof HTMLElement ? node.closest<HTMLElement>('[data-metrics-fold]') : null
  const leaving = (anchor: HTMLElement, related: EventTarget | null) => {
    const next = related instanceof Node ? related : null
    return !(next && (anchor.contains(next) || metricsFoldCard?.contains(next)))
  }
  document.addEventListener('mouseover', (event) => {
    const anchor = anchorOf(event.target)
    if (!anchor) return
    // 芯片里还有个 <b>，指针在内部挪一下就再发一次 mouseover——已经在卡上/芯片上
    // 就别重画重定位
    const previous = event.relatedTarget instanceof Node ? event.relatedTarget : null
    if (previous && (anchor.contains(previous) || metricsFoldCard?.contains(previous))) return
    showMetricsFoldCard(anchor)
  })
  document.addEventListener('mouseout', (event) => {
    const anchor = anchorOf(event.target)
    if (anchor && leaving(anchor, event.relatedTarget)) scheduleMetricsFoldHide()
  })
  document.addEventListener('focusin', (event) => {
    const anchor = anchorOf(event.target)
    if (anchor) showMetricsFoldCard(anchor)
  })
  document.addEventListener('focusout', (event) => {
    const anchor = anchorOf(event.target)
    if (anchor && leaving(anchor, event.relatedTarget)) scheduleMetricsFoldHide()
  })
  metricsFoldCard.addEventListener('mouseenter', () => {
    if (metricsFoldHideTimer) clearTimeout(metricsFoldHideTimer)
  })
  metricsFoldCard.addEventListener('mouseleave', scheduleMetricsFoldHide)
  window.addEventListener('resize', hideMetricsFoldCard)
  // 滚轮翻页不动指针，mouseout 不会来——容器一滚就收卡（同 link.ts 的 Peek）
  document.addEventListener('scroll', hideMetricsFoldCard, true)
}

/**
 * 2026-09-08：同一海域的未补给/疲劳同时出现在页签、抬头芯片、中队标签与临行
 * 提醒四处，必须一起静默，漏一处就是「关了还在提」。只过滤提示，不改原始数值
 * 和就绪判据；09-08 用户裁定被打空算严重缺少补给，未补给、疲劳、被打空三类一起静默。
 */
let mutedAreas = uiGet<number[]>(AIR_BASE_MUTE_KEY, [])
onUiPreferenceChange(AIR_BASE_MUTE_KEY, () => {
  mutedAreas = uiGet<number[]>(AIR_BASE_MUTE_KEY, [])
  scheduleRender()
})

const airBaseHeaderHtml = (): string => {
  const bases = trackedAirBases()
  const areas = new Set(bases.map((squad) => squad.areaId)).size
  const unmuted = unmutedAirBaseSquads(bases, mutedAreas)
  const mutedNote = mutedAreas.length ? `已静默 ${mutedAreas.length} 个海域` : ''
  const short = unmuted.filter((squad) => squad.planes.some(
    (plane) => plane.slotId > 0 && plane.count < plane.maxCount,
  )).length
  const tired = unmuted.filter((squad) => squad.planes.some((plane) => plane.slotId > 0 && plane.cond >= 2)).length
  const red = unmuted.filter((squad) => squad.planes.some((plane) => plane.slotId > 0 && plane.cond >= 3)).length
  return `<div class="fleet-head airbase-head">
    <div class="fleet-ident"><b>基地航空队</b><small>${
      mg.airBasesTs ? `同步于 ${fmtTime(mg.airBasesTs)}` : '基地航空队尚未同步'
    }</small></div>
    ${metricsRowHtml('airbase', AIR_BASE_METRIC_FOLD_ORDER, [
      `<span class="mchip" data-mkey="areas">海域 <b>${areas}</b></span>`,
      `<span class="mchip" data-mkey="squads">航空队 <b>${bases.length}</b></span>`,
      `<span class="mchip${short ? ' warn' : ''}" data-mkey="short"${mutedNote ? ` title="${esc(mutedNote)}"` : ''}>待补给 <b>${short}</b></span>`,
      `<span class="mchip${red ? ' bad' : tired ? ' warn' : ''}" data-mkey="tired" title="${esc(
        [tired ? `${tired} 队有疲劳机体${red ? `，其中 ${red} 队已到红疲劳` : '（均为橙疲劳）'}` : '各队均无疲劳机体', mutedNote].filter(Boolean).join(' · '),
      )}">疲劳 <b>${tired}</b>${red ? `<em> 红${red}</em>` : ''}</span>`,
    ])}
  </div>`
}

const los33TipBodyHtml = (target: HTMLElement): string => {
  const rawValues = (target.dataset.los33 ?? '').split(',').map((value) => value.trim())
  const values = rawValues.map(Number)
  if (values.length !== 4 || rawValues.some((value) => !value) || values.some((value) => !Number.isFinite(value))) {
    return (target.dataset.tip ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => esc(line))
      .join('<br>')
  }
  return `<div class="los33">${rawValues
    .map((value, index) => `<span class="los-item"><i>×${index + 1}</i><b>${esc(value)}</b></span>`)
    .join('')}</div>
    <div class="los-note">系数随海域变化</div>`
}

let los33TipRegistered = false

const metricsHtml = (deck: Deck) => {
  const ships = scopeShips(deck)
  if (!ships.length) return ''
  const counts: Record<string, number> = {}
  let sokuMin = Infinity
  let lvSum = 0
  let dameconCrew = 0, dameconGoddess = 0
  const dameconTitles: string[] = []
  for (const ship of ships) {
    // 整支编成按舰计数；常规格优先、增设最后，一舰多枚只计下一枚。
    const slots = [...ship.slot, ship.slotEx]
    const at = slots.findIndex((id) => mg.slotitems[id]?.mstId === 42 || mg.slotitems[id]?.mstId === 43)
    if (at >= 0) {
      const crew = mg.slotitems[slots[at]]?.mstId === 42
      if (crew) dameconCrew++
      else dameconGoddess++
      dameconTitles.push(`${masterShipName(ship.shipId)} · ${at === ship.slot.length ? '增设' : `第 ${at + 1} 格`} · ${crew ? '応急修理要員' : '応急修理女神'}`)
    }
    const master = mg.master.ships[ship.shipId]
    const code = master
      ? (STYPE_CODE[master.stype] ??
        (mg.master.stypes[master.stype]
          ? entityNamePlain('shipType', master.stype, mg.master.stypes[master.stype])
          : '?'))
      : '?'
    counts[code] = (counts[code] ?? 0) + 1
    // api_soku 是游戏按当前装备结算后的实例航速；master.soku 只是该形态的裸航速。
    // 旧状态缺实例值时才回退主数据，避免锅炉/涡轮提速后仍显示「含低速」。
    const effectiveSpeed = ship.soku || master?.soku || 0
    if (effectiveSpeed > 0) sokuMin = Math.min(sokuMin, effectiveSpeed)
    lvSum += ship.lv
  }
  const comp = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n}${code}`)
    .join(' ')
  // 全队一个航速都读不到时 sokuMin 停在 Infinity——那是「不知道」，
  // 直接往下比会 ≥20 落进「最速统一」，把没有的事说成确定的事。
  // 「—」这一档本来就是给这种情况准备的（原来它排在链尾，永远够不着）。
  const soku =
    !Number.isFinite(sokuMin) ? '<b>—</b>' :
    sokuMin >= 20 ? '<b class="g">最速统一</b>' :
    sokuMin >= 15 ? '<b class="g">高速+统一</b>' :
    sokuMin >= 10 ? '<b class="g">高速统一</b>' :
    '<b>含低速</b>'
  const combined = inCombined(deck)
  // 制空 / 索敌 / 输送量按**还在场的人**算：退避舰之后的节点一律不参战，
  // 把她算进去等于给玩家看一支已经不存在的舰队的数（判据见 fleet-calc.engagedShips）。
  // 上面的构成 / 航速 / 平均 Lv 仍按整支编成算——那几项说的是「这支队是什么样」，
  // 不是「这一战能拿出多少」。
  const engaged = engagedShips(ships)
  const air = fleetAirPower(engaged)
  const admiralLv = mg.basic?.level ?? 0
  const slotCount = combined ? 12 : ships.length === 7 ? 7 : 6
  const losByFactor = [1, 2, 3, 4].map((m) => fleetLos33(engaged, admiralLv, m, slotCount).total)

  // 熟练度只有区间可知（界面★对应一段内部值）——相等才收敛成单值，否则给两端
  const airText = air.min === air.max ? `${air.min}` : `${air.min}–${air.max}`
  const airTitle = `裸制空 ${air.basic} · 不含熟练度加成`
  const losTitle =
    `分支点系数：×1 ${losByFactor[0]} · ×2 ${losByFactor[1]} · ×3 ${losByFactor[2]} · ×4 ${losByFactor[3]}\n` +
    `系数随海域变化`

  // TP 芯片不再行内写「⚠大破N」（2026-08-18 用户指出与裁决框重复）：
  // 大破本身由裁决框独家点名，这里只留橙色警示底提示「TP 值受影响」，
  // 「大破舰及其装备不计入运输量」的口径解释保留在悬停里
  //
  // 有图正开着输送段、且那张图有专用表时，**一眼位置直接给专用口径的数**并标图号
  //（拿通用口径去打那种图，数会大得离谱：62-5 那次通用给 205，游戏实际结算 171）。
  // 通用值退进悬停留底。输送段一结束 / 活动图不再在册，activeEventTpRuleOf 自然返回 null，
  // 芯片原样回落通用，零残留。
  const tpFleets = scopeFleets(deck).map((fleet) => engagedShips(fleet))
  const tpRule = activeEventTpRuleOf(mg.mapGauges)
  const tp = fleetTp(tpFleets, tpRule ? eventTpTableOf(tpRule) : undefined)
  // 有专用表时通用值退进悬停留底；没有时这一份就是 tp 本身（该分支用不到它）
  const tpGeneral = tpRule ? fleetTp(tpFleets) : tp
  const tpTitle =
    (tpRule
      ? `运输量（TP）· ${tpRule.label} 专用口径：S 胜 ${tp.s} / A 胜 ${tp.a}\n` +
        `${tpRule.scopeNote}\n` +
        `通用口径同队为 S ${tpGeneral.s} / A ${tpGeneral.a}（本图不适用）\n` +
        `B 胜及以下不结算`
      : `运输量（TP）：S 胜 ${tp.s} / A 胜 ${tp.a} · A 胜 = S 胜 ×0.7 向下取整 · B 胜及以下不结算`) +
    (tp.excludedShips ? `\n⚠ ${tp.excludedShips} 位舰娘大破 · 到达扬陆点时大破的舰娘及其装备一律不计` : '')

  // 芯片顺序 = 摆出来的顺序；**收纳顺序**另有一份（FLEET_METRIC_FOLD_ORDER），
  // 两者不是一回事：临战最常看的制空/索敌33 摆在最前，也最后才收。
  return metricsRowHtml('fleet', FLEET_METRIC_FOLD_ORDER, [
    `<span class="mchip" data-mkey="air" title="${esc(airTitle)}">制空 <b class="hi">${airText}</b></span>`,
    `<span class="mchip" data-mkey="los" data-tip-title="索敌33 · 分支点系数" data-tip-kind="los33" data-los33="${losByFactor.map((value) => value.toFixed(1)).join(',')}" data-tip="${esc(losTitle)}">索敌33 <b class="hi">${losByFactor[0].toFixed(1)}</b></span>`,
    `<span class="mchip" data-mkey="comp">构成 <b>${esc(comp)}</b></span>`,
    `<span class="mchip" data-mkey="soku" title="游戏实时航速（含装备提速）">航速 ${soku}</span>`,
    dameconTitles.length ? `<span class="mchip metric damecon" data-mkey="damecon" title="${esc(dameconTitles.join('\n'))}">损管 <b>${dameconCrew + dameconGoddess}</b> · 要员 <b style="color:var(--damecon-crew)">${dameconCrew}</b> · 女神 <b style="color:var(--damecon-goddess)">${dameconGoddess}</b></span>` : '',
    `<span class="mchip" data-mkey="lv">平均 <b>Lv${Math.round(lvSum / ships.length)}</b></span>`,
    `<span class="mchip${tp.excludedShips ? ' warn' : ''}" data-mkey="tp" title="${esc(tpTitle)}">TP${
      tpRule ? `<i class="mtag">[${esc(tpRule.label)}]</i>` : ''
    } <b class="hi">S${tp.s}</b> / A${tp.a}</span>`,
    combined ? '<span class="mchip cmb" data-mkey="cmb">联合合并</span>' : '',
  ])
}

// ---- 舰队面板构件 ----

const fleetTabsHtml = (activeId: number) =>
  `${mg.decks
    .filter((deck) => !(mg.combinedFlag > 0 && deck.id === 2))
    .map((deck) => {
      const combined = mg.combinedFlag > 0 && deck.id === 1
      const canonical = combined ? combinedFleetLabel() : fleetLabel(deck).canonical
      const ships = combined ? scopeShips(deck) : fleetShips(deck)
      const onExpedition = deck.mission?.[0] > 0
      const onSortie =
        !!mg.sortie?.active &&
        !mg.sortie.practice &&
        (mg.sortie.deckId === deck.id || (combined && mg.sortie.deckId === 1))
      let dot = onSortie ? 'sortie' : onExpedition ? 'exp' : 'ok'
      if (!onExpedition && !onSortie) {
        const issues = ships.reduce((n, s) => {
          const i = shipIssues(s)
          return n + (i.taiha || i.chuuha || i.unsupplied || i.docked || i.tired ? 1 : 0)
        }, 0)
        if (issues) dot = 'warn'
      }
      return `<div class="ftab${deck.id === activeId ? ' on' : ''}${onSortie ? ' is-sortie' : ''}" data-deck="${deck.id}">
        <span class="d ${dot}"></span>${entityTermHtml('fleet', deck.id, canonical)}${
          onSortie ? '<span class="t sortie-state">正在出击</span>' : combined ? `<span class="t">${ships.length}/12</span>` : ''
        }</div>`
    })
    .join('')}${(() => {
      const bases = trackedAirBases()
      const glow = airBaseTabGlow(bases, { mutedAreas })
      const readiness = airBaseReadiness(undefined, unmutedAirBaseSquads(bases, mutedAreas))
      const issues = readiness
        ? [
            readiness.short ? `未补给 ${readiness.short} 队` : '',
            readiness.red ? `红疲劳 ${readiness.red} 队` : '',
            readiness.orange ? `橙疲劳 ${readiness.orange} 队` : '',
          ].filter(Boolean)
        : []
      let title =
        glow === 'bad'
          ? ['有航空队被打空', ...issues].join(' · ')
          : glow === 'warn'
            ? `基地航空队未就绪：${issues.join(' · ')}`
            : ''
      if (mutedAreas.length) title = `${title || '基地航空队'} · ${mutedAreas.length} 个海域已静默提示`
      return `<div class="ftab air${activeId === AIR_BASE_TAB_ID ? ' on' : ''}${glow ? ` glow-${glow}` : ''}" data-deck="${AIR_BASE_TAB_ID}"${
        title ? ` title="${esc(title)}"` : ''
      }>
        <span class="d air"></span>${entityTermHtml('fleet', AIR_BASE_TAB_ID, '基地航空队')}<span class="t">${bases.length}队</span></div>`
    })()}${(() => {
      const picked = sandboxDeck().ships.length
      return `<div class="ftab sandbox${activeId === SANDBOX_TAB_ID ? ' on' : ''}" data-deck="${SANDBOX_TAB_ID}" title="临时编成指标">
        <span class="d sand"></span>沙盘${picked ? `<span class="t">${picked}/${SANDBOX_CAP}</span>` : ''}</div>`
    })()}${(() => {
      // 泊地修理排在沙盘之后（2026-08-26 用户定的位置）
      const fleets = mg.decks.filter(
        (deck) =>
          deck.id >= 1 &&
          deck.id <= 4 &&
          (berthFlagshipOf(deck) || provisionShipOf(deck)),
      ).length
      return `<div class="ftab berth${activeId === BERTH_TAB_ID ? ' on' : ''}" data-deck="${BERTH_TAB_ID}">
        <span class="d ${fleets ? 'berth-on' : 'sand'}"></span>泊地修理与恢复${
          fleets ? `<span class="t">${fleets}队</span>` : ''
        }</div>`
    })()}`

/** 沙盘抬头：说清它是什么，并给一键清空。 */
const sandboxHeaderHtml = (deck: Deck): string => {
  const n = deck.ships.length
  return `<div class="fhead sandbox-head">
    <div class="fh-name"><b>沙盘编成</b></div>
    <div class="fh-right">
      <span class="sand-count">${n}/${SANDBOX_CAP}</span>
      ${n ? '<button class="pf-btn" data-sandbox-clear>清空</button>' : ''}
    </div>
  </div>`
}

/**
 * 选人条：搜在册舰、点一下进出编成。
 *
 * 只按 rosterId 存人，装备与改修一律沿用那艘舰**当前的实际状态**——
 * 沙盘回答的是「把手上这几艘凑一队会怎样」，不是「假如装备换成别的」。
 * 后者要能编辑装备，那是另一件事，不在这里假装能做。
 */
const sandboxPickerHtml = (): string => {
  const picked = new Set(sandboxDeck().ships)
  const query = sandboxPick.trim().toLowerCase()
  const candidates = query
    ? Object.values(mg.ships)
        .filter((ship) => {
          if (picked.has(ship.id)) return false
          const master = mg.master.ships[ship.shipId]
          const name = master?.name ?? ''
          return (
            name.toLowerCase().includes(query) ||
            entityNamePlain('ship', ship.shipId, name).toLowerCase().includes(query)
          )
        })
        .sort((a, b) => b.lv - a.lv)
        .slice(0, 12)
    : []
  const chips = candidates
    .map((ship) => {
      const name = masterShipName(ship.shipId)
      const full = picked.size >= SANDBOX_CAP
      return `<button class="sand-cand${full ? ' full' : ''}" data-sandbox-add="${ship.id}"${full ? ' disabled title="编成已满 · 移除一位后可添加"' : ''}>
        ${shipThumbHtml(ship.shipId, name, {
          className: 'table',
          damaged: shipArtDamaged(ship.nowhp, ship.maxhp), // 与编成表同一档：同一艘舰两处不能一破一好
        })}
        <span><b>${esc(entityNamePlain('ship', ship.shipId, name))}</b><i>Lv${ship.lv}</i></span>
      </button>`
    })
    .join('')
  const chosen = sandboxDeck()
    .ships.map((rosterId) => {
      const ship = mg.ships[rosterId]
      const name = masterShipName(ship.shipId)
      return `<button class="sand-chosen" data-sandbox-remove="${rosterId}" title="移出编成">
        ${esc(entityNamePlain('ship', ship.shipId, name))} <i>Lv${ship.lv}</i> <span class="x">×</span>
      </button>`
    })
    .join('')
  return `<div class="sand-picker">
    <div class="sand-row">
      <div class="search">⌕<input id="ru-sandbox-search" placeholder="搜在册舰加入沙盘" value="${esc(sandboxPick)}"></div>
      <div class="sand-chosen-row">${chosen || '<span class="sand-empty">尚未选择</span>'}</div>
    </div>
    ${query ? `<div class="sand-cands">${chips || '<span class="sand-empty">暂无匹配舰</span>'}</div>` : ''}
  </div>`
}

// ---- 泊地修理页（母港泊地修理 / 明石タイマー）----
//
// 机制查证、回复公式、以及「哪些事把计时拨回 0」全部收在 shared/berth-repair.ts 的
// 头注里（逐条带出处与源数），这里只做取数与摆放。三件事在这一段里必须站住：
//
//   · 游戏对这套机制**零报文**——回血只在下一次 api_port 的舰况里体现。
//     所以页上每一个回复量都是推算，数字旁一律挂「估算」，且一律向下取整。
//   · 计时锚点来自 `mg.berthSince`（主进程按观测到的归零点记，见 store.ts 的
//     `touchBerth`）。**没有锚点就什么都不报**：拿本次开机时刻顶替的话，
//     一支停了三小时的队会被说成刚停下，那是凭空造出来的错值。
//   · 这一页只读，不写回游戏——与锐的其余部分同一条底线。

const BERTH_TAB_ID = -2

/** 旗舰是不是工作舰。明石 / 明石改 / 朝日改 就是 stype 19 的全部（查证见 shared/berth-repair）。 */
const berthFlagshipOf = (deck: Deck): PlayerShip | null => {
  const flagId = deck.ships[0]
  const flag = flagId > 0 ? mg.ships[flagId] : undefined
  if (!flag) return null
  return mg.master.ships[flag.shipId]?.stype === REPAIR_SHIP_STYPE ? flag : null
}

/**
 * 旗舰身上带了几个艦艇修理施設。
 *
 * 只数常规格：可参照的实现（KancolleSniffer `fs.Slot.Count(...)`）数的就是常规格，
 * 补强增设算不算没有任何来源说过——不知道就不算，多算会把覆盖范围说大。
 */
const berthFacilityCount = (flag: PlayerShip): number =>
  flag.slot.filter((slotId) => slotId > 0 && mg.slotitems[slotId]?.mstId === REPAIR_FACILITY_MST_ID)
    .length

/** 页上那一格 HP 条，与编成表同一套类名（`.hpc` 挂在 .fleet-skin 上，不是 .ship 上）。 */
const berthHpHtml = (ship: PlayerShip, docked: boolean): string => {
  const pct = ship.maxhp > 0 ? Math.max(0, Math.min(100, (ship.nowhp / ship.maxhp) * 100)) : 0
  return `<div class="hpc ${hpClassOf(ship, docked)}">
    <div class="hpbody">
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="num"><span>${ship.nowhp}/${ship.maxhp}</span></div>
    </div>
  </div>`
}

const BERTH_HALT_LABEL = {
  mission: '远征中',
  flagDocked: '旗舰在渠',
  flagHurt: '旗舰中破',
} as const

const BERTH_STATE_LABEL = {
  repairing: '修理中',
  full: '耐久已满',
  hurt: '中破',
  docked: '入渠',
} as const

/** 明石卡与给粮舰卡共用同一份出海判据（联合舰队一队出击时两队都算在海上）。 */
const berthDeckAtSea = (deck: Deck): boolean =>
  deckOnSortie(deck.id) || (inCombined(deck) && deckOnSortie(1))

// 维护者裁决 2026-11-25：泊地卡和编队行共用覆盖位次与停修条件。
const berthRepairContext = (deck: Deck, flag: PlayerShip) => {
  const cover = berthCoverage(berthFacilityCount(flag))
  const halt = berthHalt(flag, {
    onMission: deck.mission?.[0] > 0,
    flagDocked: !!dockOf(flag.id),
  })

  // 明石队自己出海了（2026-08-26 用户指出的缺口）：出击**不重置**计时（查证 ⑦
  // 两源「计时继续」），所以这里只停「显示」、不停表——海上 HP 还在战场上变，
  // 账面是出发前的旧值，摆出来必是算不准的数；回港 HP 落账后自动回到「停泊 N 分」。
  // 判据与出击裁决行同一份（含联合舰队一队带二队）。
  const atSea = berthDeckAtSea(deck)
  const shipStatus = (ship: PlayerShip, index: number) => {
    const docked = !!dockOf(ship.id)
    const state = berthShipState(ship, docked)
    const inRange = index >= 0 && index < cover
    return { docked, state, inRange, repairing: inRange && !halt && !atSea && state === 'repairing' }
  }
  return { cover, halt, atSea, shipStatus }
}

const shipStateTone = (ship: PlayerShip) => {
  const deck = mg.decks.find(d => d.id >= 1 && d.id <= 4 && d.ships.includes(ship.id))
  const flag = deck && berthFlagshipOf(deck)
  const anchorage = !!(deck && flag && berthRepairContext(deck, flag)
    .shipStatus(ship, fleetShips(deck).findIndex(s => s.id === ship.id)).repairing)
  return fleetStateTone({
    nowhp: ship.nowhp, maxhp: ship.maxhp, docked: !!dockOf(ship.id), anchorage,
    fatigue: fatigueBand(estimatedCond(ship.id, FATIGUE_READY_COND) ?? ship.cond),
    sparkle: ship.cond >= 50, unsupplied: isUnsupplied(ship),
  })
}

/** 一支能修的舰队。旗舰不是工作舰的队根本不进这里。 */
const berthFleetHtml = (deck: Deck, flag: PlayerShip, now: number): string => {
  const ships = fleetShips(deck)
  const { cover, halt, atSea, shipStatus } = berthRepairContext(deck, flag)
  const since = mg.berthSince[deck.id]
  const elapsed = since ? Math.max(0, now - since) : null
  const warm = elapsed !== null && elapsed >= BERTH_WARMUP_MS

  // 计时那一格：停摆时只说停摆（停摆的原因就是玩家要看的那句），
  // 没有锚点时说不知道——都不摆一个算不准的数出来。
  const timing = atSea
    ? '<span class="bt-halt">出击中</span>'
    : halt
    ? `<span class="bt-halt">${BERTH_HALT_LABEL[halt]}</span>`
    : elapsed === null
      ? '<span class="bt-idle">计时未知</span>'
      : warm
        ? `<span class="bt-on">停泊 ${Math.floor(elapsed / 60_000)} 分</span>`
        : `<span class="bt-warm">缺 ${Math.ceil((BERTH_WARMUP_MS - elapsed) / 60_000)} 分</span>
           <span class="bt-bar"><i style="width:${(berthWarmupRatio(elapsed) * 100).toFixed(1)}%"></i></span>`

  const rows = ships
    .map((ship, index) => {
      const { inRange, docked, state, repairing } = shipStatus(ship, index)
      // 估算只在「真在修 + 没停摆 + 没出海 + 过了 20 分」四条都成立时才出现
      const gain =
        repairing && warm
          ? berthEstimateHp(ship, elapsed!)
          : 0
      const name = masterShipName(ship.shipId)
      const perHpMs = inRange && state === 'repairing' ? berthPerHpMs(ship) : null
      return `<div class="bt-ship${inRange ? '' : ' out'}" data-berth-pos="${index + 1}">
        <span class="bt-no">${index + 1}</span>
        <span class="bt-name">${entityTermHtml('ship', ship.shipId, entityNamePlain('ship', ship.shipId, name))}</span>
        ${berthHpHtml(ship, docked)}
        ${inRange ? `<span class="bt-tag s-${state}">${BERTH_STATE_LABEL[state]}</span>` : '<span class="bt-tag out">范围外</span>'}
        <span class="bt-gain">${gain > 0 ? `<b>+${gain}</b><em>预估</em>` : ''}</span>
        ${perHpMs !== null ? `<span class="bt-per-hp">每 1 HP ${repairDurationSeconds(perHpMs)}</span>` : ''}
      </div>`
    })
    .join('')

  return `<div class="bt-fleet">
    <div class="bt-head">
      <b>${entityTermHtml('fleet', deck.id, fleetLabel(deck).canonical)}</b>
      <span class="bt-flag">${entityTermHtml('ship', flag.shipId, entityNamePlain('ship', flag.shipId, masterShipName(flag.shipId)))}</span>
      <span class="bt-cover">覆盖 ${Math.min(cover, ships.length)} 位</span>
      <span class="bt-time">${timing}</span>
    </div>
    <div class="bt-ships">${rows}</div>
  </div>`
}

const PROVISION_HALT_LABEL = {
  mission: '远征中',
  flagDocked: '给粮舰在渠',
  flagUnsupplied: '给粮舰未补给',
  flagHurt: '给粮舰小破',
  flagTired: '给粮舰士气不足',
} as const

const PROVISION_STATE_LABEL = {
  docked: '入渠',
  full: '已满',
  ready: '可补',
} as const

/** 0/1 位的给粮舰与她这一轮的增量；两位都有时由共享判据取旗舰。 */
const provisionShipOf = (
  deck: Deck,
): { ship: PlayerShip; index: 0 | 1; gain: number } | null => {
  const found = provisionShipAt(deck.ships, (rosterId) => mg.ships[rosterId]?.shipId)
  if (!found) return null
  const ship = mg.ships[found.rosterId]
  return ship ? { ship, index: found.index, gain: found.gain } : null
}

/**
 * 给粮舰的计时锚点只认全局 provisionSince，没有退回该队编成时刻的退路。
 * 维护者 2026-09-18 实测：南海在旗舰位改造成野埼后，补给满、无伤、cond 49、不远征、
 * 随伴不在渠，且离改造与最后一次编成都超过 15 分钟，四次回港游戏都没有结算。
 * 游戏的表只在野埼位于 0/1 位并完成编成的那一下起；改造上位不会起表，因此退回
 * berthSince[deck.id] 会把尚未起表报成「可结算」。锚点缺失时只能报「计时未知」。
 */
const provisionSinceOf = (_deck: Deck): number | null => mg.provisionSince

/** 回港先结自然回复到 49，再叠给粮舰；账上已经高于 49 的值也不能被拉低。 */
const provisionBaseCond = (ship: PlayerShip): number =>
  Math.max(ship.cond, estimatedCond(ship.id, FATIGUE_FULL_COND) ?? ship.cond)

const provisionHaltOf = (deck: Deck, flag: PlayerShip) => {
  const master = mg.master.ships[flag.shipId]
  return provisionHalt(flag, {
    onMission: deck.mission?.[0] > 0,
    flagDocked: !!dockOf(flag.id),
    fuelMax: master?.fuelMax ?? Number.POSITIVE_INFINITY,
    bullMax: master?.bullMax ?? Number.POSITIVE_INFINITY,
  })
}

/** 一支 0/1 位有给粮舰的队；传入的 flag 是 provisionShipOf 已核过的那艘。 */
const provisionFleetHtml = (
  deck: Deck,
  flag: { ship: PlayerShip; index: 0 | 1; gain: number },
  now: number,
): string => {
  const ships = fleetShips(deck)
  const halt = provisionHaltOf(deck, flag.ship)
  const atSea = berthDeckAtSea(deck)
  const since = provisionSinceOf(deck)
  const elapsed = since === null ? null : Math.max(0, now - since)
  const warm = elapsed !== null && elapsed >= PROVISION_WARMUP_MS
  const timing = atSea
    ? '<span class="bt-halt">出击中</span>'
    : halt
      ? `<span class="bt-halt">${PROVISION_HALT_LABEL[halt]}</span>`
      : elapsed === null
        ? '<span class="bt-idle">计时未知</span>'
        : warm
          ? `<span class="bt-on">可结算 · 已等 ${Math.floor(elapsed / 60_000)} 分</span>`
          : `<span class="bt-warm">缺 ${Math.ceil((PROVISION_WARMUP_MS - elapsed) / 60_000)} 分</span>
             <span class="bt-bar"><i style="width:${Math.max(0, Math.min(100, (elapsed / PROVISION_WARMUP_MS) * 100)).toFixed(1)}%"></i></span>`

  let fuelCost = 0
  const rows = ships
    .map((ship, index) => {
      const own = ship.id === flag.ship.id
      const docked = !!dockOf(ship.id)
      const base = provisionBaseCond(ship)
      const state = provisionShipState(base, docked)
      const estimate = !own && !halt && !atSea && warm && state === 'ready'
        ? provisionEstimate(base, flag.gain)
        : null
      if (estimate !== null) fuelCost += 1
      const name = masterShipName(ship.shipId)
      const tag = own ? '给粮舰' : PROVISION_STATE_LABEL[state]
      const tagClass = own ? 's-provision' : `s-${state}`
      return `<div class="bt-ship provision" data-provision-pos="${index + 1}">
        <span class="bt-no">${index + 1}</span>
        <span class="bt-name">${entityTermHtml('ship', ship.shipId, entityNamePlain('ship', ship.shipId, name))}</span>
        <span class="bt-cond">士气 ${base}</span>
        <span class="bt-tag ${tagClass}">${tag}</span>
        <span class="bt-gain">${estimate !== null ? `<b>→ ${estimate}</b><em>估算</em>` : ''}</span>
      </div>`
    })
    .join('')

  const name = entityNamePlain('ship', flag.ship.shipId, masterShipName(flag.ship.shipId))
  return `<div class="bt-fleet provision">
    <div class="bt-head">
      <b>${entityTermHtml('fleet', deck.id, fleetLabel(deck).canonical)}</b>
      <span class="bt-flag">${entityTermHtml('ship', flag.ship.shipId, name)}</span>
      <span class="bt-cover">${flag.index === 0 ? '旗舰' : '2 号位'}</span>
      ${fuelCost ? `<span class="bt-cover">燃料 −${fuelCost}</span>` : ''}
      <span class="bt-time">${timing}</span>
    </div>
    <div class="bt-ships">${rows}</div>
  </div>`
}

/**
 * 泊地修理抬头。
 *
 * 机制解说一个字不进 UI，悬停也不进（2026-08-26 用户抓的第二次回潮：
 * 初版在这里挂过一枚「口径」角标写推算与落账，被判同病）。
 * 数值旁的「估算」两字是唯一限定词；怎么算的写在 shared/berth-repair.ts 头注。
 */
const berthHeaderHtml = (): string => `<div class="fhead berth-head">
  <div class="fh-name"><b>泊地修理与恢复</b></div>
</div>`

/**
 * 泊地修理整页。
 *
 * 只看第 1–4 舰队：这套机制本来就只对常规舰队生效，沙盘那种本地推演的编成
 * 更不该出现在这里（它连 deck.id 都是 -1）。
 */
const berthViewHtml = (): string => {
  const now = Date.now()
  const blocks = mg.decks
    .filter((deck) => deck.id >= 1 && deck.id <= 4)
    .map((deck) => {
      const flag = berthFlagshipOf(deck)
      const provision = provisionShipOf(deck)
      return `${flag ? berthFleetHtml(deck, flag, now) : ''}${
        provision ? provisionFleetHtml(deck, provision, now) : ''
      }`
    })
    .filter(Boolean)
  if (!blocks.length) {
    return '<div class="bt-empty">暂无工作舰或给粮舰编队</div>'
  }
  return `<div class="bt-list">${blocks.join('')}</div>`
}

/**
 * 抬头身份行末尾那格：全队的疲劳恢复时刻。
 *
 * 取所有舰至 49 的预计时刻最大值；存在缺锚点且未满 49 的舰时不显示。
 * 到点状态由 tickTimers 的 [data-ready-ts] 更新。
 */
const fleetFatigueHtml = (deck: Deck): string => {
  const ships = scopeShips(deck)
  let fatigue = '<small></small>'
  if (ships.length) {
    const { ts, unknown } = fleetFatigueEta(ships, FATIGUE_FULL_COND)
    if (ts == null) {
      fatigue = unknown ? '<small></small>' : '<small>士气已回满</small>'
    } else {
      const last = ships
        .filter((ship) => ship.cond < FATIGUE_FULL_COND && fatigueReadyTs(ship.id, FATIGUE_FULL_COND) === ts)
        .map((ship) => entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId)))[0]
      const title = `全队预计回满至 ${FATIGUE_FULL_COND}${last ? ` · 最晚 ${last}` : ''}`
      fatigue = `<small data-ready-ts="${ts}" data-ready-done="士气已回满" title="${esc(
        title,
      )}">预计回满 ${fmtTime(ts)}</small>`
    }
  }

  const provision = provisionShipOf(deck)
  if (!provision || provisionHaltOf(deck, provision.ship) || berthDeckAtSea(deck)) return fatigue
  const target = fleetShips(deck).some(
    (ship) =>
      ship.id !== provision.ship.id &&
      !dockOf(ship.id) &&
      provisionBaseCond(ship) < PROVISION_COND_CAP,
  )
  const since = provisionSinceOf(deck)
  if (!target || since === null) return fatigue
  const name = entityNamePlain('ship', provision.ship.shipId, masterShipName(provision.ship.shipId))
  const readyTs = since + PROVISION_WARMUP_MS
  const done = `${name} · 回母港可 +${provision.gain}`
  const provisionReady = readyTs > Date.now()
    ? `<small data-ready-ts="${readyTs}" data-ready-done="${esc(done)}">${esc(name)} · ${fmtTime(readyTs)} 起回母港可 +${provision.gain}</small>`
    : `<small>${esc(done)}</small>`
  return `${fatigue}${provisionReady}`
}

const fleetHeaderHtml = (deck: Deck) => {
  const { canonical, custom } = fleetLabel(deck)
  const combined = inCombined(deck)
  const displayName = combined ? combinedFleetLabel() : canonical
  const first = mg.decks.find((entry) => entry.id === 1)
  const second = mg.decks.find((entry) => entry.id === 2)
  const combinedCustom = combined
    ? [first, second]
        .map((entry) => entry ? fleetLabel(entry).custom : '')
        .filter(Boolean)
        .map((name) => `「${entityTermHtml('fleet', undefined, name)}」`)
        .join(' · ')
    : ''
  // 出击状态只留两处：页签徽记（跨页签可见）+ 右侧裁决框（出击中 · 图号 · 状态）。
  // 抬头行原来还有一个「正在出击 · 图号」小徽记，与同排的裁决框整句重复，
  // 2026-08-18 用户指出后撤掉。
  const identity = `<div class="fleet-ident"><b>${entityTermHtml('fleet', deck.id, displayName)}</b>${
    combinedCustom || custom ? `<span>${combinedCustom || `「${entityTermHtml('fleet', deck.id, custom)}」`}</span>` : ''
  }${fleetFatigueHtml(deck)}</div>`
  return `<div class="fleet-head">${identity}${
    deck.mission?.[0] > 0 ? '' : verdictHtml(deck)
  }${metricsHtml(deck)}${fleetQuestHtml(deck)}</div>`
}

const fleetQuestHtml = (deck: Deck): string => {
  const deckIds = inCombined(deck) ? [1, 2] : [deck.id]
  const matches = Object.entries(fleetQuestCheck)
    .filter(([, check]) => check.hasCond && check.decks.some((id) => deckIds.includes(id)))
    .map(([id]) => Number(id))
    .filter((id) => mg.quests[id]?.state === 2)
  const nearMisses = Object.entries(fleetQuestCheck)
    .filter(([id, check]) => check.hasCond && mg.quests[Number(id)]?.state === 2)
    .flatMap(([id, check]) => {
      const diffs = (check.diffs ?? []).filter((diff) => deckIds.includes(diff.deckId) && classifyFleetDiff(diff) === 'nearMiss')
      return diffs.length && !matches.includes(Number(id))
        ? [{ id: Number(id), issues: diffs.flatMap((diff) => diff.lines.filter((line) => !line.ok).map((line) => line.issue)).join('\n') }]
        : []
    })
  const hasResults = matches.length > 0 || nearMisses.length > 0
  // 读取失败不清旧数据（见 scheduleFleetQuestCheck），所以这里要说清
  // 「显示的是旧的」还是「本来就没读到过」——两种情况的可信度完全不同
  const failedMark = fleetQuestFailed
    ? `<span class="more" title="${esc(
        hasResults
          ? '编成任务读取失败 · 显示上次读取结果 · 返港后重试'
          : '编成任务读取失败 · 返港后重试',
      )}">编成任务读取失败${hasResults ? ' · 上次读取结果' : ''} · 返港后重试</span>`
    : ''
  if (!hasResults) {
    return failedMark ? `<div class="fleet-quests">${failedMark}</div>` : ''
  }
  const shown = matches.slice(0, 4)
  const matchedHtml = matches.length ? `<span class="fq-group"><span class="k">满足编成条件</span>${shown
    .map((id) => elink('quest', id, questName(id) ?? mg.quests[id]?.title ?? `任务 ${id}`) +
      (fleetQuestCheck[id].approx ? '<span class="approx" title="编成判定含拿不准的项，可能比游戏松">≈</span>' : ''))
    .join('')}${matches.length > shown.length ? `<span class="more">另 ${matches.length - shown.length} 项</span>` : ''}</span>` : ''
  const nearShown = nearMisses.slice(0, 4)
  const nearHtml = nearMisses.length ? `<span class="fq-group"><span class="k">编成待调整</span>${nearShown
    .map(({ id, issues }) => elink('quest', id, questName(id) ?? mg.quests[id]?.title ?? `任务 ${id}`, undefined, { title: issues }) +
      (fleetQuestCheck[id].approx ? '<span class="approx" title="编成判定含拿不准的项，可能比游戏松">≈</span>' : ''))
    .join('')}${nearMisses.length > nearShown.length ? `<span class="more">另 ${nearMisses.length - nearShown.length} 项</span>` : ''}</span>` : ''
  // 三组并排放进同一条横向滚动行，让待调整与读取失败标不再把抬头撑高。
  return `<div class="fleet-quests">${matchedHtml}${nearHtml}${failedMark ? `<span class="fq-group">${failedMark}</span>` : ''}</div>`
}

/**
 * 编成任务反查。
 *
 * debounce 只压得住**还没发出去**的那些——已经起飞的 IPC 该回来照样回来，
 * 而且不保证按发出顺序回。所以每次发之前领一个号，回来时对不上号的直接丢，
 * 否则一次连点会让旧编成的结果盖在新编成上（越慢的那次赢）。
 *
 * 失败不清 fleetQuestCheck：旧名单留着显示、只挂一个失败标（缓存失效用代号，
 * 不删数据）——清掉的话那一行会无声消失，看上去像「这支队一个都不满足」。
 */
const scheduleFleetQuestCheck = () => {
  if (pane?.dataset.popped === 'true') return
  if (fleetQuestTimer) clearTimeout(fleetQuestTimer)
  fleetQuestTimer = setTimeout(() => {
    if (pane?.dataset.popped === 'true') return
    const generation = ++fleetQuestGeneration
    void queryFleetCheck()
      .then((result) => {
        if (generation !== fleetQuestGeneration) return // 已经有更新的一次在路上
        fleetQuestCheck = result
        fleetQuestFailed = false
        if (pane?.classList.contains('active')) deferPassive(pane, 'ru', render)
      })
      .catch((error) => {
        if (generation !== fleetQuestGeneration) return
        console.warn('[kuma] 编队任务反查失败', error)
        fleetQuestFailed = true
        if (pane?.classList.contains('active')) deferPassive(pane, 'ru', render)
      })
  }, 250)
}

// 被弹动画与修理演出（实验性，维护者裁决 2026-11-25 / 11-26；战报驱动的弹孔、鱼雷倾侧进水、反潜深弹与特色入渠出渠，
// 交接包「编队被弹与特色入渠动画」v2，维护者 2026-11-27 定稿）：
// 对比上次绘制与当前耐久，出击掉血按战报归因追加持续战损（弹孔 / 积水 / 倾角）并存一次性被弹参数，修理/保命走独立观察器。
const hpWatch = createHpWatch()
const repairWatch = createRepairWatch()
// 被弹参数在整段演出期间续挂（until 前每次重画都带同一份属性，输出不变就不换 DOM）。
// 原先只活一次渲染，掉血后 250ms 的「编队任务反查」重画就把演出拦腰截断了（2026-11-26 查出）。
const activeHits = new Map<number, { params: HitShakeParams; until: number }>()
// 修理演出的底色层同理续挂到演出播完
const repairWashUntil = new Map<number, number>()

let cachedRowWidth = 540
let cachedRowHeight = 48

const measureFleetRowSize = () => {
  if (!pane) return
  const collapsed = pane.querySelector<HTMLElement>('.ships .ship:not(.open)')
  const sample = collapsed ?? pane.querySelector<HTMLElement>('.ships .ship')
  if (!sample) return
  const w = Math.round(sample.clientWidth)
  if (w >= 280) cachedRowWidth = w
  if (collapsed) {
    const h = Math.round(collapsed.offsetHeight)
    if (h >= 36 && h <= 72) cachedRowHeight = h
  }
}

// 行内各列的真实像素位置（每次换 DOM 后量一次，见 measureRowLayouts）：弹孔只落在留白、内容区下的裂纹压浅都靠它
const rowLayouts = new Map<number, RowLayout>()
// 每艘舰玻璃层定下来的那份安全区：落弹孔时取当时量到的，之后（含入渠中）照用，行宽变了才换。
// 列位置会随文字微动（Lv、下一改装提示），每次重画都换会让输出一直在变、把正在播的演出拦腰截断。
const glassZones = new Map<number, RowZones>()
const liveZonesOf = (shipId: number): RowZones =>
  rowZonesOf(rowLayouts.get(shipId) ?? { width: cachedRowWidth, height: cachedRowHeight })
const glassZonesOf = (shipId: number): RowZones => {
  const held = glassZones.get(shipId)
  if (held && Math.abs(held.width - cachedRowWidth) < 2 && held.height === cachedRowHeight) return held
  const zones = liveZonesOf(shipId)
  glassZones.set(shipId, zones)
  return zones
}

interface PendingHitFx {
  motion: HitMotion
  newHoles: GlassHole[]
  tier: HitGlassTier | null
  torpRatio: number
  /** 扣血前后的血量百分比：血条换档的颜色从旧档渐变到新档 */
  hpFrom: number
  hpTo: number
}

interface PendingRepairAnimation {
  event: RepairFxEvent
  /** 修理前那一刻的持续战损（女神发动要把碎片嵌回去） */
  prevState: ShipDamageState | null
  /** 修理前那一刻的玻璃层（四角碎裂＋弹孔）、积水与锈渍（在渠的按当时进度） */
  prevSvg: string
  prevWater: number
  prevRust: string
  /** 修理前那一刻血条的宽度（在渠的按维修进度） */
  prevBarPct: number
  prevFuelPct: number
  prevAmmoPct: number
  /** 出渠演出的四套特色之一 */
  dockStyle: DockOutStyle | null
  healedCrack: boolean
}

const lastFuelAmmo = new Map<number, { fuelPct: number; ammoPct: number }>()
const weldedShips = new Set<number>()
const transientAura = new Map<number, { kind: 'goddess' | 'dock'; until: number }>()
const auraTimers = new Map<number, ReturnType<typeof setTimeout>>()
const pendingHitFx = new Map<number, PendingHitFx>()
const pendingRepairFx = new Map<number, PendingRepairAnimation>()
// 返港转化：这一趟的弹孔与积水转成四角碎裂与锈渍（维护者 2026-11-28 定）。上一次观察时还在出击、这一次回港了就是返港
const pendingReturnFx = new Map<number, { prev: ShipDamageState; next: ShipDamageState }>()
let lastSortieBattle = false
/** 返港后多久之内第一次看到编队还补播转化动画（切到别的页签、过了很久才回来就直接是转化后的样子） */
const RETURN_FX_WINDOW = 20_000
// 在渠舰的预计修好时刻与总工时：出渠那一刻舰已不在渠，泼桶时还剩多少要靠上一次记下的
const dockSeen = new Map<number, { completeTime: number; total: number }>()
// 本次渲染里泊修常驻态要亮的工作舰与受修舰（observeFleetHits 按 berthRepairContext 算好，shipGlassFx 只读）
const berthFxFlagIds = new Set<number>()
const berthFxRepairIds = new Set<number>()

// 余韵与泊修常驻态的退场：到点后先淡出这么久再撤属性（交接包：女神余韵「自然淡去」、
// 入渠水青「约 2–3 秒后归于平静」；2026-11-26 他报「一帧消失」）。样式表里 ru-fx-fade-* 的时长与它同值。
const FX_FADE_MS = 600
// 刚撤下泊修常驻态、正在淡出的工作舰与受修舰：舰 id → 淡出结束时刻
const berthFadeFlag = new Map<number, number>()
const berthFadeRepair = new Map<number, number>()
const berthFadeTimers = new Map<number, ReturnType<typeof setTimeout>>()

/** 余韵还在（含淡出那一段）就返回种类；fading 表示已过余韵时长、正在淡出 */
const activeTransientAura = (shipId: number): { kind: 'goddess' | 'dock'; fading: boolean } | null => {
  const entry = transientAura.get(shipId)
  if (!entry) return null
  const now = Date.now()
  if (now >= entry.until + FX_FADE_MS) {
    transientAura.delete(shipId)
    return null
  }
  return { kind: entry.kind, fading: now >= entry.until }
}

const fleetRowOf = (shipId: number) => pane?.querySelector<HTMLElement>(`.ship[data-ship="${shipId}"]`) ?? null

/**
 * 本次渲染算出的泊修常驻态与上一次比：撤下的舰进淡出（续挂原属性 + data-berth-fade），
 * 重新亮起的取消淡出。淡出结束时就地撤掉属性与连接线，不为它重画整块。
 */
const noteBerthFade = (prevFlag: ReadonlySet<number>, prevRepair: ReadonlySet<number>) => {
  const now = Date.now()
  const track = (prev: ReadonlySet<number>, current: ReadonlySet<number>, fading: Map<number, number>) => {
    for (const id of current) fading.delete(id)
    for (const id of prev) if (!current.has(id) && !fading.has(id)) fading.set(id, now + FX_FADE_MS)
  }
  track(prevFlag, berthFxFlagIds, berthFadeFlag)
  track(prevRepair, berthFxRepairIds, berthFadeRepair)
  for (const id of new Set([...berthFadeFlag.keys(), ...berthFadeRepair.keys()])) {
    if (berthFadeTimers.has(id)) continue
    const until = Math.max(berthFadeFlag.get(id) ?? 0, berthFadeRepair.get(id) ?? 0)
    berthFadeTimers.set(id, setTimeout(() => {
      berthFadeTimers.delete(id)
      const row = fleetRowOf(id)
      if (berthFadeFlag.delete(id)) row?.removeAttribute('data-berth-role')
      if (berthFadeRepair.delete(id)) {
        row?.removeAttribute('data-berth-repair')
        row?.querySelector(':scope > .berth-tether')?.remove()
        row?.querySelector('.fx-akashi-wave')?.remove()
      }
      row?.removeAttribute('data-berth-fade')
    }, Math.max(0, until - now)))
  }
}

const clearBerthFade = () => {
  for (const timer of berthFadeTimers.values()) clearTimeout(timer)
  berthFadeTimers.clear()
  berthFadeFlag.clear()
  berthFadeRepair.clear()
}

const isSubShip = (ship: PlayerShip): boolean => {
  const stype = mg.master.ships[ship.shipId]?.stype
  return stype != null && isSubmarineStype(stype)
}

/**
 * 画进面板 HTML 的维修进度只按 10% 取整：进度随时间走，按 1% 画的话，任何一次无关的重画（编队任务反查、
 * 每分钟的疲劳刷新）只要碰上跨过一个百分点，输出就变、整块换 DOM，正在播的出渠演出会被拦腰截断。
 * 换完 DOM 当场（render 里提交之后、上屏之前）与每秒的 tickTimers 都由 refreshDockProgress 就地补到 1%。
 */
const DOCK_RENDER_STEP = 0.1
const DOCK_LIVE_STEP = 0.01

/**
 * 入渠维修进度 0..1，按 step 向下取整。总工时取 api_ndock_time 与这一次入渠里记下的那份中较大的
 * （报文若在渠期间把它清零或改小，进度不倒退；换了一次入渠——预计修好时刻变了——就不再沿用旧的）。
 * 拿不到就返回 null，血条退回原来的静态示意宽度，不猜假进度。
 * 实测（2026-11-27 本机 port 快照）：在渠舰的 api_ndock_time 仍是这次修满的总工时，剩余时间比它短。
 */
const dockProgressOf = (ship: PlayerShip, dock: { completeTime: number }, now = Date.now(), step = DOCK_RENDER_STEP): number | null => {
  const seen = dockSeen.get(ship.id)
  const total = Math.max(ship.ndockTime, seen && seen.completeTime === dock.completeTime ? seen.total : 0)
  const progress = dockRepairProgress(dock.completeTime, total, now)
  return progress == null ? null : Math.round(Math.floor(progress / step) * step * 100) / 100
}

/** 入渠中的血条：从伤血按真实维修进度推进到满（取代原先写死的 45% 示意） */
const dockBarPct = (ship: PlayerShip, dock: { completeTime: number }, step = DOCK_RENDER_STEP): number => {
  const progress = dockProgressOf(ship, dock, Date.now(), step)
  if (progress == null) return 45
  const hpPct = ship.maxhp > 0 ? (ship.nowhp / ship.maxhp) * 100 : 100
  return Math.round((hpPct + (100 - hpPct) * progress) * 10) / 10
}

const glassMarkupOf = (shipId: number, state: ShipDamageState, tier: HitGlassTier | null, progress: number | null, welded: boolean): string =>
  hitGlassSvg({ id: shipId, holes: state.holes, tier, zones: glassZonesOf(shipId), progress, welded })

/** 历史战损的四角碎裂（入渠时按维修进度缩回） */
const scarMarkupOf = (shipId: number, state: ShipDamageState, progress: number | null): string =>
  hitScarSvg({ id: shipId, shipId, seedKey: state.seedKey, zones: glassZonesOf(shipId), loss: dockScar(state.scar ?? 0, progress) })

/** 玻璃层整层：底下是历史的四角碎裂，上面是这一趟的弹孔 */
const glassLayersOf = (shipId: number, state: ShipDamageState, tier: HitGlassTier | null, progress: number | null, welded: boolean): string =>
  `${scarMarkupOf(shipId, state, progress)}${state.holes.length ? glassMarkupOf(shipId, state, tier, progress, welded) : ''}`

/** 锈渍（入渠时随进度除净） */
const rustMarkupOf = (shipId: number, state: ShipDamageState, progress: number | null): string => {
  const zones = glassZonesOf(shipId)
  return hitRustSvg({ shipId, seedKey: state.seedKey, width: zones.width, height: zones.height, level: state.rust ?? 0, strength: dockRustStrength(progress) })
}

/** 这艘在不在正在进行的这次出击里（联合舰队算两队）；不在的舰就算全局在出击，也按在港算 */
const shipInSortie = (shipId: number): boolean => {
  const sortie = mg.sortie
  if (!sortie?.active || sortie.practice) return false
  const ids = sortie.deckId === 1 && mg.combinedFlag > 0 ? [1, 2] : [sortie.deckId]
  return mg.decks.some((deck) => ids.includes(deck.id) && deck.ships.includes(shipId))
}

const waterMarkupOf = (shipId: number, level: number, listNow: number, listBase: number, docked: boolean): string => {
  if (level <= 0.4) return ''
  const zones = glassZonesOf(shipId)
  return hitWaterHtml({ level, listNow, listBase, docked, width: zones.width, height: zones.height, seed: shipId })
}

// 入渠中的常驻特色层：炮击伤焊修扫描光（焊补四角碎裂）、鱼雷伤沿锈线来回的除锈光、潜水舰压载排气慢泡
const DOCK_SUB_BUBBLES = [18, 32, 44, 58, 72, 86]
  .map((left, i) => {
    const size = 3 + (i % 3) * 1.4
    return `<span class="dock-sub-bubble" style="left:${left}%;width:${size}px;height:${size}px;--dur:${(2.6 + (i % 3) * 0.65).toFixed(2)}s;--del:${(-i * 0.55).toFixed(2)}s;--drift:${i % 2 ? 5 : -4}px"></span>`
  })
  .join('')
const dockLayerHtml = (kind: DockKind, rustLevel: number): string => {
  // 返港时积水已经抽干，在渠的鱼雷伤修的是锈：除锈光贴着锈线走（没有锈线时落在行高七成处）
  const lineTop = Math.round(cachedRowHeight * (1 - (rustLevel > 0.4 ? rustLevel : 30) / 100)) - 3
  return `<span class="dock-fx-layer">${
    kind === 'sub'
      ? DOCK_SUB_BUBBLES
      : kind === 'torp'
        ? `<span class="dock-derust" style="top:${lineTop}px"></span>`
        : '<span class="dock-weld-scan"></span>'
  }</span>`
}

const deckBerthActive = (deck: Deck): { flagId: number; repairingIds: Set<number> } | null => {
  if (deck.id < 1 || deck.id > 4) return null
  const flag = berthFlagshipOf(deck)
  if (!flag) return null
  const ctx = berthRepairContext(deck, flag)
  if (ctx.halt !== null || ctx.atSea) return null
  const repairingIds = new Set<number>()
  fleetShips(deck).forEach((ship, index) => {
    if (ctx.shipStatus(ship, index).repairing) repairingIds.add(ship.id)
  })
  return repairingIds.size > 0 ? { flagId: flag.id, repairingIds } : null
}

const activeRepairItems = (): Map<number, RepairItemSignal> => {
  const items = new Map<number, RepairItemSignal>()
  const sortie = mg.sortie
  if (!sortie?.active || sortie.practice || !sortie.battle) return items
  for (const entry of sortie.battle.fShips) {
    if (entry.rosterId == null) continue
    if (entry.repairItemUsedAtStart === 42 || entry.repairItemUsedAtStart === 43) {
      items.set(entry.rosterId, {
        item: entry.repairItemUsedAtStart,
        key: `${sortie.battleCount}:start:${entry.rosterId}:${entry.repairItemUsedAtStart}`,
      })
    }
    if (entry.repairItemUsed === 42 || entry.repairItemUsed === 43) {
      items.set(entry.rosterId, {
        item: entry.repairItemUsed,
        key: `${sortie.battleCount}:${entry.rosterId}:${entry.repairItemUsed}`,
      })
    }
  }
  return items
}

const tierAt = (hp: number, max: number, sunk: boolean): HitGlassTier | null =>
  sunk ? 'sunk' : hitCrackTier({ nowhp: hp, maxhp: max, docked: false })

const observeFleetHits = (deck: Deck) => {
  const decks = inCombined(deck)
    ? [1, 2].map((id) => mg.decks.find((d) => d.id === id)).filter(Boolean) as Deck[]
    : [deck]
  const prevBerthFlag = new Set(berthFxFlagIds)
  const prevBerthRepair = new Set(berthFxRepairIds)
  berthFxFlagIds.clear()
  berthFxRepairIds.clear()
  for (const d of decks) {
    const info = deckBerthActive(d)
    if (!info) continue
    berthFxFlagIds.add(info.flagId)
    for (const id of info.repairingIds) berthFxRepairIds.add(id)
  }
  noteBerthFade(prevBerthFlag, prevBerthRepair)
  const ships = decks.flatMap((d) => fleetShips(d))
  const battle = Boolean(mg.sortie?.active && !mg.sortie.practice)
  if (!mg.sortie?.active) weldedShips.clear()
  const returned = lastSortieBattle && !mg.sortie?.active
  lastSortieBattle = battle

  const now = Date.now()
  const repairEvents = repairWatch.observe(
    ships.map((ship) => {
      const dock = dockOf(ship.id)
      return {
        id: ship.id,
        nowhp: ship.nowhp,
        maxhp: ship.maxhp,
        docked: !!dock,
        berthRepairing: berthFxRepairIds.has(ship.id),
        dockCompleteAt: dock?.completeTime ?? null,
      }
    }),
    { sortie: battle, repairItems: battle ? activeRepairItems() : undefined, now },
  )
  const drops = hpWatch.observe(ships, { battle })

  for (const [id, entry] of activeHits) if (entry.until <= now) activeHits.delete(id)
  for (const [id, until] of repairWashUntil) if (until <= now) repairWashUntil.delete(id)
  pendingHitFx.clear()
  pendingRepairFx.clear()
  pendingReturnFx.clear()

  const enabled = hitShakeEnabled()
  const visible = document.visibilityState === 'visible'
  // 返港：每艘带伤舰（不止眼前这一队）这一趟的弹孔收口、积水抽干，转成四角碎裂与锈渍
  if (returned) {
    const recent = mg.lastPortTs != null && now - mg.lastPortTs < RETURN_FX_WINDOW
    for (const [id, state] of damageStates) {
      const ship = mg.ships[id]
      if (!ship) continue
      if (ship.nowhp >= ship.maxhp) {
        damageStates.delete(id)
        continue
      }
      const next = returnToPort(state, ship.nowhp, ship.maxhp)
      damageStates.set(id, next)
      if (enabled && visible && recent && (state.holes.length || state.water > 0.4)) pendingReturnFx.set(id, { prev: state, next })
    }
  }
  const present = new Set<number>()
  // 列表最底下那一行：鱼雷冲击峰值也按常驻倾角封顶——编队表在六舰满编时只余几像素，右端一沉就闪出滚动条
  const lastShipId = ships.at(-1)?.id

  for (const ship of ships) {
    present.add(ship.id)
    const sunk = isSunkInSortie(ship.id)
    const ev = repairEvents.get(ship.id)
    const wasWelded = weldedShips.has(ship.id)
    const prior = damageStates.get(ship.id) ?? null

    if (ev?.kind === 'damecon') weldedShips.add(ship.id)
    if (sunk || ship.nowhp >= ship.maxhp) weldedShips.delete(ship.id)

    if (enabled && visible && ev) {
      // 修理前那一刻的样子：在渠的玻璃层、积水与血条都按当时的维修进度（自然出渠多半已修到头，泼桶还剩一截）
      const prevDock = dockSeen.get(ship.id) ?? null
      const prevProgress = prevDock ? dockRepairProgress(prevDock.completeTime, prevDock.total, now) : null
      const beforePct = ev.max > 0 ? Math.max(0, Math.min(100, (ev.before / ev.max) * 100)) : 0
      const prevFA = lastFuelAmmo.get(ship.id) ?? { fuelPct: 100, ammoPct: 100 }
      const dockStyle: DockOutStyle | null = ev.kind === 'dock' ? (ev.bucket ? 'bucket' : dockKindOf(prior, isSubShip(ship))) : null
      pendingRepairFx.set(ship.id, {
        event: ev,
        prevState: prior,
        prevSvg: prior ? glassLayersOf(ship.id, prior, tierAt(ev.before, ev.max, false), prevProgress, wasWelded) : '',
        prevWater: prior ? dockWater(prior.water, prevProgress) : 0,
        prevRust: prior ? rustMarkupOf(ship.id, prior, prevProgress) : '',
        prevBarPct: prevDock ? (prevProgress == null ? 45 : beforePct + (100 - beforePct) * prevProgress) : beforePct,
        prevFuelPct: prevFA.fuelPct,
        prevAmmoPct: prevFA.ammoPct,
        dockStyle,
        healedCrack:
          (ev.kind === 'berth' || ev.kind === 'anchorage') && !!prior && (prior.holes.length > 0 || (prior.scar ?? 0) > 0) && ship.nowhp >= ship.maxhp,
      })
      repairWashUntil.set(ship.id, now + repairFxTotal(ev.kind, dockStyle ?? undefined))
      if (ev.kind === 'goddess') transientAura.set(ship.id, { kind: 'goddess', until: Date.now() + 4500 })
      else if (ev.kind === 'dock') transientAura.set(ship.id, { kind: 'dock', until: Date.now() + 2600 })
    }

    // 掉血：按战报归因追加持续战损。面板看不见时也记（之后看到的弹孔与积水照实），只是不播演出；
    // 要员 / 女神那一下另有修理演出，不叠被弹动作
    const drop = drops.get(ship.id)
    const suppressHit = ev?.kind === 'damecon' || ev?.kind === 'goddess'
    if (enabled && drop) {
      const sub = isSubShip(ship)
      const report = analyzeShipHitReport(mg.sortie?.battle, ship.id, {
        stypeOf: (mstId) => mg.master.ships[mstId]?.stype ?? null,
        slotTypeOf: (mstId) => mg.master.slotitems[mstId]?.type2 ?? null,
        targetStype: mg.master.ships[ship.shipId]?.stype ?? null,
        drop,
      })
      const zones = liveZonesOf(ship.id)
      // 这一下之前就带伤、却还没有战损记录（换编队才第一次见到）：先按掉血前的血量补一套默认碎裂
      let base = prior
      if ((!base || (syntheticPending.has(ship.id) && !base.holes.length)) && drop.before < drop.max) {
        base = syntheticDamageState(base?.seedKey ?? nextDamageSeed(), drop.before, drop.max, sub)
      }
      const result = applyHitReport({
        shipId: ship.id,
        state: base ?? emptyDamageState(nextDamageSeed()),
        report,
        before: drop.before,
        after: drop.after,
        max: drop.max,
        zones,
      })
      damageStates.set(ship.id, result.state)
      glassZones.set(ship.id, zones)
      syntheticPending.delete(ship.id)
      if (visible && !suppressHit) {
        transientAura.delete(ship.id)
        const motion = {
          ...result.motion,
          listFrom: visibleListDeg(result.motion.listFrom, zones.width, true),
          listPeak: visibleListDeg(result.motion.listPeak, zones.width, ship.id === lastShipId),
        }
        const params = hitShakeParams(drop, motion, result.newHoles.length)
        if (params) {
          activeHits.set(ship.id, { params, until: Date.now() + params.totalMs })
          pendingHitFx.set(ship.id, {
            motion,
            newHoles: result.newHoles,
            tier: tierAt(drop.after, drop.max, sunk),
            torpRatio: report.torpRatio,
            hpFrom: (drop.before / drop.max) * 100,
            hpTo: (drop.after / drop.max) * 100,
          })
        }
      }
    }

    if (!sunk && ship.nowhp >= ship.maxhp) {
      damageStates.delete(ship.id)
      glassZones.delete(ship.id)
      syntheticPending.delete(ship.id)
    }
    // 在港（不在这次出击的队里）：四角碎裂跟着血量走——泊修回血就缩；出击中冻结，新挨的打画成弹孔。
    // 漏看了返港那一拍（比如开关是在港里才打开的）还挂着弹孔或积水的，也在这里转掉
    const held = damageStates.get(ship.id)
    if (held && !sunk && ship.nowhp < ship.maxhp && !shipInSortie(ship.id)) {
      const next = returnToPort(held, ship.nowhp, ship.maxhp)
      if (next.scar !== (held.scar ?? 0) || next.rust !== (held.rust ?? 0) || held.holes.length || held.water > 0 || held.listDeg > 0) {
        damageStates.set(ship.id, next)
      }
    } else if (held && !sunk && ship.nowhp < ship.maxhp) {
      // 出击中：保底——旧伤＋这一趟记下的掉血要等于实际缺失，没记到的补成四角碎裂（reconcileScar）
      const next = reconcileScar(held, ship.nowhp, ship.maxhp)
      if (next !== held) damageStates.set(ship.id, next)
    }
    const dock = dockOf(ship.id)
    if (dock) {
      const seen = dockSeen.get(ship.id)
      const kept = seen && seen.completeTime === dock.completeTime ? seen.total : 0
      dockSeen.set(ship.id, { completeTime: dock.completeTime, total: Math.max(ship.ndockTime, kept) })
    } else {
      dockSeen.delete(ship.id)
    }
    const mst = mg.master.ships[ship.shipId]
    lastFuelAmmo.set(ship.id, {
      fuelPct: mst && mst.fuelMax > 0 ? (ship.fuel / mst.fuelMax) * 100 : 100,
      ammoPct: mst && mst.bullMax > 0 ? (ship.bull / mst.bullMax) * 100 : 100,
    })
  }

  for (const id of lastFuelAmmo.keys()) {
    if (!present.has(id)) lastFuelAmmo.delete(id)
  }
  // 不在渠了的（在别的页签上出的渠）撤掉入渠记录；退役、击沉后不在籍的舰，战损与量过的列位置一并清掉
  for (const id of dockSeen.keys()) if (!dockOf(id)) dockSeen.delete(id)
  for (const map of [damageStates, glassZones, rowLayouts] as Map<number, unknown>[]) {
    for (const id of map.keys()) if (!mg.ships[id]) map.delete(id)
  }
  // 保底：不在眼前这一队的舰也按实际血量核一遍，回满了血就清掉战损（不止看得见的那一队）
  for (const id of damageStates.keys()) {
    const ship = mg.ships[id]
    if (ship && ship.nowhp >= ship.maxhp && !isSunkInSortie(id)) {
      damageStates.delete(id)
      glassZones.delete(id)
      syntheticPending.delete(id)
    }
  }
  for (const id of syntheticPending) if (!mg.ships[id]) syntheticPending.delete(id)
}

const shipHitShake = (ship: PlayerShip): HitShakeParams | null => {
  const entry = activeHits.get(ship.id)
  const params = entry && entry.until > Date.now() ? entry.params : null
  return params
}

const shipHitCrack = (ship: PlayerShip) =>
  hitShakeEnabled() ? hitCrackTier({ nowhp: ship.nowhp, maxhp: ship.maxhp, docked: !!dockOf(ship.id) }) : null

// 玻璃层、进水层与修理演出在行内的挂件（实验性，维护者裁决 2026-11-26；交接包 v2 2026-11-27）。
// shipRow 只负责拼进去：attrs 挂在行上，style 并进行上唯一的 style（鱼雷常驻倾角），layers 进 .dmg-fx，
// tether 是泊修连接线；wash 表示没有伤势底色时也要一层底色给余韵用。
// 要在 shipHitFracture 之后调用——战损记录（种子）由它补。
interface ShipGlassFx {
  attrs: string
  style: string[]
  layers: string
  tether: string
  wash: boolean
}

const shipGlassFx = (ship: PlayerShip, sunk: boolean): ShipGlassFx | null => {
  if (!hitShakeEnabled()) return null
  const tier: HitGlassTier | null = sunk ? 'sunk' : shipHitCrack(ship)
  const welded = !sunk && weldedShips.has(ship.id)
  const berthFlagLive = !sunk && berthFxFlagIds.has(ship.id)
  const berthRepairLive = !sunk && berthFxRepairIds.has(ship.id)
  // 刚撤下的泊修常驻态续挂原属性淡出（见 noteBerthFade）
  const berthFading = !sunk && !berthFlagLive && !berthRepairLive && (berthFadeFlag.has(ship.id) || berthFadeRepair.has(ship.id))
  const berthFlag = berthFlagLive || (berthFading && berthFadeFlag.has(ship.id))
  const berthRepair = berthRepairLive || (berthFading && berthFadeRepair.has(ship.id))
  const aura = sunk ? null : activeTransientAura(ship.id)
  // 修理演出的底色层：演出播完之前每次重画都带着，免得中途换 DOM 把演出截断
  const pending = pendingRepairFx.has(ship.id) || (repairWashUntil.get(ship.id) ?? 0) > Date.now()
  const state = damageStates.get(ship.id)
  const dock = sunk ? undefined : dockOf(ship.id)
  const progress = dock ? dockProgressOf(ship, dock) : null
  const glassSvg = state ? glassLayersOf(ship.id, state, tier, progress, welded) : ''
  // 鱼雷倾侧与进水：入渠前段（0%→45%）扶正，积水随进度抽干；击沉的行交给击沉演出，不倾侧。
  // 行上画的倾角按行宽换算、按邻行余量封顶（visibleListDeg），液面斜率仍按原倾角算扶正到了哪一步
  const listRaw = state && !sunk ? dockListDeg(state.listDeg, progress) : 0
  const listNow = listRaw > 0 ? visibleListDeg(listRaw, glassZonesOf(ship.id).width, true) : 0
  const listed = listNow > 0.04
  const waterSvg = state
    ? `${rustMarkupOf(ship.id, state, progress)}${waterMarkupOf(ship.id, dockWater(state.water, progress), listRaw, state.listDeg, !!dock)}`
    : ''
  const dockKind: DockKind | null = dock && ship.nowhp < ship.maxhp ? dockKindOf(state, isSubShip(ship)) : null
  if (!glassSvg && !waterSvg && !listed && !dockKind && !berthFlag && !berthRepair && !aura && !pending) return null
  const H = cachedRowHeight
  return {
    // data-glass：行上挂了玻璃 / 进水 / 入渠层。擦伤（没到小破线、没有 data-crack）也会留弹孔、进水，
    // 行要靠它拿到定位与数据列压在上面，否则这些层相对更外层定位、被画到列表顶上去（2026-11-27 他报白露弹孔「没了」）
    attrs: ` data-glass${welded ? ' data-weld="1"' : ''}${berthFlag ? ' data-berth-role="flag"' : ''}${
      berthRepair ? ' data-berth-repair="1"' : ''
    }${berthFading ? ' data-berth-fade="1"' : ''}${
      // 带伤入渠：裂纹照留（维护者裁决 2026-11-26 ②），红黄告警与故障换成缓慢脉冲的恢复光（同日裁决）；
      // 交接包 v2：弹孔随维修进度逐孔逆向收口，特色层按伤势种类（焊修 / 抽水扶正 / 压载浮升）
      tier && tier !== 'sunk' && dock ? ' data-docked="1"' : ''
    }${dockKind ? ` data-dock-kind="${dockKind}" data-dock-prog="${progress == null ? '' : Math.round(progress * 100)}"` : ''}${
      listed ? ' data-listed="1"' : ''
    }${aura ? ` data-repair-aura="${aura.kind}"` : ''}${aura?.fading ? ' data-aura-fade="1"' : ''}`,
    style: listed ? [`--list-deg:${listNow.toFixed(2)}deg`, `--list-y:${(listNow * 0.45).toFixed(2)}px`] : [],
    layers: `<span class="water-host" style="height:${H}px">${waterSvg}</span><span class="glass-host" style="height:${H}px">${glassSvg}</span>${
      dockKind ? dockLayerHtml(dockKind, state?.rust ?? 0) : ''
    }${berthRepair ? '<span class="fx-akashi-wave"></span>' : ''}<span class="fx-motes"></span><span class="fx-flash"></span><span class="fx-sweep"></span>`,
    tether: berthRepair ? '<span class="berth-tether" aria-hidden="true"></span>' : '',
    wash: berthFlag || !!aura || pending,
  }
}

// 每艘舰这一轮带伤的持续战损（弹孔 / 积水 / 倾角，连同头像裁角与故障错相的种子）：带伤期间（含入渠中）冻结，
// 重画不跳位；修满（且非击沉）后清空，下次再受创换一个新种子整套重来。
// 只在内存里：重启后本就带伤、没有逐发战报的舰先占一个种子，等量到这一行的列位置再按缺失血量补一套默认碎裂
// （syntheticPending，见 settleSyntheticDamage）。
const damageStates = new Map<number, ShipDamageState>()
const syntheticPending = new Set<number>()
let damageSeedSeq = 1
const nextDamageSeed = (): number => damageSeedSeq++

const shipHitFracture = (ship: PlayerShip): string => {
  if (!hitShakeEnabled()) return ''
  const sunk = isSunkInSortie(ship.id)
  if (!sunk && ship.nowhp >= ship.maxhp) {
    damageStates.delete(ship.id)
    syntheticPending.delete(ship.id)
    return ''
  }
  let state = damageStates.get(ship.id)
  if (!state) {
    // 先按缺失血量给上保底的四角碎裂（不必等账本，出击中的也一样）；锈渍与出击中的弹孔等账本重放补上
    state = sunk ? emptyDamageState(nextDamageSeed()) : syntheticDamageState(nextDamageSeed(), ship.nowhp, ship.maxhp, isSubShip(ship))
    damageStates.set(ship.id, state)
    syntheticPending.add(ship.id)
  }
  return hitAvatarCssVars(ship.id, state.seedKey)
}

const fleetDivisionHtml = (deck: Deck, role: string): string => {
  const { canonical, custom } = fleetLabel(deck)
  const ships = fleetShips(deck)
  return `<div class="fleet-division">
    <div class="fleet-division-head"><b>${esc(role)}</b><span>${entityTermHtml('fleet', deck.id, canonical)}${
      custom ? `「${entityTermHtml('fleet', deck.id, custom)}」` : ''
    } · ${ships.length} 位</span></div>
    ${ships.map((ship, index) => shipRow(deck, ship, index === 0)).join('')}
  </div>`
}

const fleetViewHtml = (deck: Deck) => {
  const hitFxAttr = hitShakeEnabled() ? ' data-hit-fx' : ''
  if (!inCombined(deck)) {
    return `<div class="ships"${hitFxAttr}>${fleetShips(deck).map((ship, index) => shipRow(deck, ship, index === 0)).join('')}</div>`
  }
  const first = mg.decks.find((entry) => entry.id === 1)
  const second = mg.decks.find((entry) => entry.id === 2)
  return `<div class="ships combined-ships"${hitFxAttr}>
    ${first ? fleetDivisionHtml(first, '主力舰队') : ''}
    ${second ? fleetDivisionHtml(second, '护卫舰队') : ''}
  </div>`
}

// ---- 一次性 Web Animations 演出（崩飞碎角 / 要员 / 女神 / 入渠完成 / 泊地修理） ----

// 三个小工具都收起点延迟：延迟期间停在第一帧（fill both / backwards），
// 血条不会先跳到新值、光点不会先露出来再开演。时长与起点都取节拍表 REPAIR_FX。
const spawnRowPop = (row: HTMLElement, text: string, colorVar: string, delayMs = 0) => {
  const host = row.querySelector<HTMLElement>('.hpc .hpbody')
  if (!host) return
  const pop = document.createElement('span')
  pop.className = 'repair-pop'
  pop.textContent = text
  pop.style.color = colorVar
  host.appendChild(pop)
  pop
    .animate(
      [
        { opacity: 0, transform: 'translateY(6px) scale(1.2)' },
        { opacity: 1, transform: 'translateY(-3px) scale(1)', offset: 0.2 },
        { opacity: 0, transform: 'translateY(-13px) scale(.96)' },
      ],
      { duration: REPAIR_FX.pop, delay: delayMs, easing: 'ease-out', fill: 'both' },
    )
    .onfinish = () => pop.remove()
}

const spawnRowMotes = (row: HTMLElement, count: number, colorVar: string, star: boolean, delayMs = 0) => {
  const host = row.querySelector<HTMLElement>('.fx-motes')
  if (!host) return
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = star ? 'mote-star' : 'mote-dot'
    el.style.left = `${12 + Math.random() * 80}%`
    el.style.top = `${18 + Math.random() * 62}%`
    if (star) {
      const sz = 8 + Math.random() * 6
      el.style.width = `${sz}px`
      el.style.height = `${sz}px`
      el.innerHTML = `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" style="display:block"><path d="M12 0 Q13 11 24 12 Q13 13 12 24 Q11 13 0 12 Q11 11 12 0 Z" style="fill:${colorVar}"/></svg>`
    } else {
      const sz = 2.5 + Math.random() * 3
      el.style.width = `${sz}px`
      el.style.height = `${sz}px`
      el.style.background = colorVar
    }
    host.appendChild(el)
    const dx = (Math.random() - 0.5) * 18
    const dy = -12 - Math.random() * 18
    el
      .animate(
        [
          { opacity: 0, transform: 'translate(0, 4px) scale(0.3) rotate(0deg)' },
          { opacity: 0.95, transform: `translate(${(dx * 0.4).toFixed(1)}px, ${(dy * 0.4).toFixed(1)}px) scale(1.05) rotate(25deg)`, offset: 0.35 },
          { opacity: 0, transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.4) rotate(50deg)` },
        ],
        { duration: REPAIR_FX.mote + Math.random() * REPAIR_FX.moteJitter, delay: delayMs + i * 48, easing: 'ease-out', fill: 'both' },
      )
      .onfinish = () => el.remove()
  }
}

/** 血条 / 油弹条从旧比例涨到新比例；有起点延迟时延迟期间停在旧比例 */
const animateRowBars = (
  row: HTMLElement,
  bars: { hp?: [number, number]; fuel?: [number, number]; ammo?: [number, number] },
  { delay = 0, duration = 460, hpDocked = [false, false] }: { delay?: number; duration?: number; hpDocked?: [boolean, boolean] } = {},
) => {
  const timing: KeyframeAnimationOptions = { duration, delay, easing: 'cubic-bezier(.2,.82,.28,1)', fill: delay ? 'backwards' : 'none' }
  const run = (selector: string, [from, to]: [number, number]) => {
    row.querySelector<HTMLElement>(selector)?.animate([{ width: `${from}%` }, { width: `${to}%` }], timing)
  }
  if (bars.hp) {
    const [from, to] = bars.hp
    const bar = row.querySelector<HTMLElement>('.hpc .bar > i')
    bar?.animate(hpBarFrames(bar, from, to, hpDocked[0], hpDocked[1]), timing)
  }
  if (bars.fuel) run('.fa2 .fuel > i', bars.fuel)
  if (bars.ammo) run('.fa2 .ammo > i', bars.ammo)
}

// ---- 血条、油弹条跟着数值平滑走（维护者裁决 2026-11-26：动画要客观、要有过渡）----
// 编队行每次重画都整块换 DOM，于是扣血、回血、补给都是一下跳到新值。现在提交新 DOM 之后
// 拿新旧宽度比，变了的那几根从旧值走到新值。只做「如实走过去」这一件事，不加任何别的效果。
// 不走的情形：
// - 换了舰队页签、或不在编队页（沙盘、泊地修理、陆航）——那是换了一屏，不是数值变了；
// - 修理演出正在播的舰（入渠完成、泊修、要员、女神各自有血条演出）；
// - 被弹动画开着时的扣血：那边的设计是实血当场落位、残影随后下降，两套叠在一起就乱了；
// - 入渠 / 出渠那一下：入渠中的血条是固定的示意宽度，宽度变了但血量没变。
// 过渡途中又重画了（比如编队任务反查那一次），新元素从已走过的进度接着走，不重头来。
/**
 * 血条的颜色关键帧：按 shared/bar-tone 排出的档位，读样式表里各档的两端颜色（--hpbar-*，深浅主题与色觉配色都在那边）。
 * 只给 --bar-c0 / --bar-c1（样式表 @property 注册过的颜色属性），宽度另给。
 */
const barToneFrames = (el: Element, stops: readonly BarToneStop[]): Keyframe[] => {
  if (!stops.length) return []
  const style = getComputedStyle(el)
  const color = (name: string) => style.getPropertyValue(name).trim()
  return stops.map(({ offset, tone }) => ({ offset, '--bar-c0': color(`--hpbar-${tone}-0`), '--bar-c1': color(`--hpbar-${tone}-1`) }))
}

/**
 * 血条从 from 走到 to（百分比）的整套关键帧：宽度与颜色在同一条缓动上，跨档线那一刻正好换到新档的颜色，
 * 不再是类名一换整条颜色先跳过去、宽度后到（2026-11-28 他报血条「颜色抽动」）。withWidth=false 时只换颜色。
 */
const hpBarFrames = (el: Element, from: number, to: number, fromDocked: boolean, toDocked: boolean, withWidth = true): Keyframe[] => {
  const tone = barToneFrames(el, barToneStops(from, to, fromDocked, toDocked))
  if (!withWidth) return tone
  if (!tone.length) return [{ width: `${from}%` }, { width: `${to}%` }]
  tone[0] = { ...tone[0], width: `${from}%` }
  tone[tone.length - 1] = { ...tone[tone.length - 1], width: `${to}%` }
  return tone
}

const BAR_EASE_MS = 420
const BAR_EASE = 'cubic-bezier(.2, .82, .28, 1)'
interface RowBarWidths {
  hp: number
  fuel: number
  ammo: number
  docked: boolean
}
type BarSpan = [number, number]
interface BarEase {
  hp?: BarSpan
  /** 血条两端的在渠状态（颜色在水青与档色之间渐变）；toneOnly：入渠那一下宽度不走、只换颜色 */
  hpDocked?: [boolean, boolean]
  toneOnly?: boolean
  fuel?: BarSpan
  ammo?: BarSpan
  start: number
}
const BAR_SELECTORS = { hp: '.hpc .bar > i', fuel: '.fa2 .fuel > i', ammo: '.fa2 .ammo > i' } as const
let barWidthsView = ''
let barWidths = new Map<number, RowBarWidths>()
const barEases = new Map<number, BarEase>()

const inlineWidthOf = (row: HTMLElement, selector: string): number | null => {
  const value = parseFloat(row.querySelector<HTMLElement>(selector)?.style.width ?? '')
  return Number.isFinite(value) ? value : null
}

const runBarEase = (row: HTMLElement, ease: BarEase, elapsed: number) => {
  for (const key of ['hp', 'fuel', 'ammo'] as const) {
    const span = ease[key]
    if (!span) continue
    const el = row.querySelector<HTMLElement>(BAR_SELECTORS[key])
    if (!el) continue
    const frames =
      key === 'hp'
        ? hpBarFrames(el, span[0], span[1], ease.hpDocked?.[0] ?? false, ease.hpDocked?.[1] ?? false, !ease.toneOnly)
        : [{ width: `${span[0]}%` }, { width: `${span[1]}%` }]
    if (!frames.length) continue
    const run = el.animate(frames, { duration: BAR_EASE_MS, easing: BAR_EASE })
    if (elapsed > 0) run.currentTime = elapsed
  }
}

/** 提交新 DOM 之后调；`view` 为空串表示当前不是编队页（不记也不走） */
const easeFleetBars = (root: HTMLElement, view: string, busy: ReadonlySet<number>) => {
  const next = new Map<number, RowBarWidths>()
  if (view) {
    for (const row of root.querySelectorAll<HTMLElement>('.fleet-body .ship[data-ship]')) {
      const id = Number(row.dataset.ship)
      const hp = inlineWidthOf(row, BAR_SELECTORS.hp)
      const fuel = inlineWidthOf(row, BAR_SELECTORS.fuel)
      const ammo = inlineWidthOf(row, BAR_SELECTORS.ammo)
      if (!id || hp == null || fuel == null || ammo == null) continue
      next.set(id, { hp, fuel, ammo, docked: !!dockOf(id) })
    }
  }
  const before = view === barWidthsView ? barWidths : null
  barWidths = next
  barWidthsView = view
  if (
    !before ||
    document.visibilityState !== 'visible' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    barEases.clear()
    return
  }
  const now = Date.now()
  const dropsHandled = hitShakeEnabled()
  for (const [id, after] of next) {
    const prior = before.get(id)
    const row = root.querySelector<HTMLElement>(`.fleet-body .ship[data-ship="${id}"]`)
    if (!prior || !row || busy.has(id)) {
      barEases.delete(id)
      continue
    }
    const moved = (from: number, to: number) => Math.abs(from - to) >= 0.5
    const ease: BarEase = { start: now }
    if (prior.docked === after.docked && moved(prior.hp, after.hp) && !(dropsHandled && after.hp < prior.hp)) {
      ease.hp = [prior.hp, after.hp]
      ease.hpDocked = [prior.docked, after.docked]
    } else if (prior.docked !== after.docked) {
      // 入渠 / 出渠那一下：宽度照旧不走（入渠中的血条是另一套刻度），颜色在档色与水青之间渐变过去
      ease.hp = [prior.hp, after.hp]
      ease.hpDocked = [prior.docked, after.docked]
      ease.toneOnly = true
    }
    if (moved(prior.fuel, after.fuel)) ease.fuel = [prior.fuel, after.fuel]
    if (moved(prior.ammo, after.ammo)) ease.ammo = [prior.ammo, after.ammo]
    if (ease.hp || ease.fuel || ease.ammo) {
      barEases.set(id, ease)
      runBarEase(row, ease, 0)
      continue
    }
    // 数值停在上一段的终点、而那一段还没走完：这次重画把元素换掉了，从已走过的进度接着走。
    // 数值已经又变了（只是这一下不归这里走，比如被弹扣血）就不再重播旧的那段。
    const running = barEases.get(id)
    const atTarget =
      running &&
      (['hp', 'fuel', 'ammo'] as const).every((key) => !running[key] || !moved(running[key]![1], after[key]))
    if (running && atTarget && now - running.start < BAR_EASE_MS) runBarEase(row, running, now - running.start)
    else barEases.delete(id)
  }
}

const makeSvgEl = (markup: string): SVGSVGElement | null => {
  const box = document.createElement('div')
  box.innerHTML = markup
  return box.firstElementChild as SVGSVGElement | null
}

// ---- 战报驱动的被弹演出与特色出渠（交接包 v2，维护者 2026-11-27 定稿；节拍取 HIT_REPORT_FX / REPAIR_FX.dockOut）----
// 全部是一次性 Web Animations，播完 onfinish 自己拆掉。飞出来的元素（碎片、气泡、声呐环、深弹、航迹）样式表里
// 默认不可见、动画不留首帧（fill none）：反潜、鱼雷要等 lead 才炸，起点延迟期间不能先在原位露出来；
// 玻璃层里的弹孔则停在首帧（fill backwards，首帧就是还没裂开）；
// 中途换了 DOM 就随旧行一起没掉，不在新行上补播半段。减少动态效果时一概不播（runPostRenderHitFx 统一判）。

/** 行上方不裁切的特效层（深弹从行上方落下、碎片飞出行外）；每次换 DOM 后按需补一个 */
const airFxOf = (row: HTMLElement): HTMLElement => {
  let air = row.querySelector<HTMLElement>(':scope > .air-fx')
  if (!air) {
    air = document.createElement('span')
    air.className = 'air-fx'
    air.setAttribute('aria-hidden', 'true')
    row.appendChild(air)
  }
  return air
}

const spawnBubbles = (row: HTMLElement, count: number, [x0, x1]: [number, number], colorVar: string, delayMs = 0, risePx = 38) => {
  const air = airFxOf(row)
  for (let i = 0; i < count; i++) {
    const bubble = document.createElement('span')
    const size = 2.5 + Math.random() * 4.2
    bubble.className = 'fx-bubble'
    bubble.style.cssText = `left:${(x0 + Math.random() * (x1 - x0)).toFixed(1)}%;top:${(58 + Math.random() * 34).toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;--bubble:${colorVar}`
    air.appendChild(bubble)
    const dx = (Math.random() - 0.5) * 18
    bubble
      .animate(
        [
          { opacity: 0, transform: 'translate(0, 4px) scale(.4)' },
          { opacity: 0.9, transform: `translate(${(dx * 0.4).toFixed(1)}px, ${(-risePx * 0.45).toFixed(1)}px) scale(1.05)`, offset: 0.35 },
          { opacity: 0, transform: `translate(${dx.toFixed(1)}px, ${-risePx}px) scale(.7)` },
        ],
        { duration: HIT_REPORT_FX.bubble + Math.random() * HIT_REPORT_FX.bubbleJitter, delay: delayMs + i * 38, easing: 'ease-out', fill: 'none' },
      )
      .onfinish = () => bubble.remove()
  }
}

const spawnSonarRing = (row: HTMLElement, xPct: number, yPct: number, colorVar: string, delayMs = 0, maxScale = 2.5) => {
  const ring = document.createElement('span')
  ring.className = 'fx-sonar'
  ring.style.cssText = `left:${xPct}%;top:${yPct}%;--sonar:${colorVar}`
  airFxOf(row).appendChild(ring)
  ring
    .animate(
      [
        { opacity: 0.95, transform: 'scale(.25)' },
        { opacity: 0.55, transform: `scale(${(maxScale * 0.62).toFixed(2)})`, offset: 0.48 },
        { opacity: 0, transform: `scale(${maxScale.toFixed(2)})` },
      ],
      { duration: HIT_REPORT_FX.sonar, delay: delayMs, easing: 'cubic-bezier(.16,.84,.3,1)', fill: 'none' },
    )
    .onfinish = () => ring.remove()
}

/**
 * 一块碎片自己那么大的 SVG（坐标仍是行内像素）。整行宽的 SVG 绕碎片一转，包围盒能有上千像素——
 * 编队表只留了几像素余量，会闪出滚动条、整列跟着挤一下。
 */
const shardSvg = (poly: GlassPolygon, fill: string, stroke: string, strokeWidth: number): SVGSVGElement | null => {
  const xs = poly.map(([x]) => x)
  const ys = poly.map(([, y]) => y)
  const x0 = Math.floor(Math.min(...xs)) - 2
  const y0 = Math.floor(Math.min(...ys)) - 2
  const w = Math.ceil(Math.max(...xs)) + 2 - x0
  const h = Math.ceil(Math.max(...ys)) + 2 - y0
  return makeSvgEl(
    `<svg class="fx-shard" viewBox="${x0} ${y0} ${w} ${h}" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px"><polygon points="${poly.map(([x, y]) => `${x},${y}`).join(' ')}" style="fill:${fill};stroke:${stroke};stroke-width:${strokeWidth}" opacity=".94"/></svg>`,
  )
}

/** 崩飞的玻璃碎片：先抛起、再旋转着坠落淡出（单发重击 6–8 块） */
const launchGlassShards = (row: HTMLElement, shards: readonly GlassShard[], tier: HitGlassTier | null, delayMs = 0) => {
  if (!shards.length) return
  const col = tier === 'heavy' || tier === 'sunk' ? 'var(--hit-glass-heavy-rim)' : tier === 'medium' ? 'var(--hit-glass-mid)' : 'var(--hit-glass-light)'
  const S = HIT_REPORT_FX.shard
  shards.forEach((shard, i) => {
    const svg = shardSvg(shard.poly, 'color-mix(in srgb, var(--bg2) 82%, var(--glow-shatter))', col, shard.large ? 1.15 : 0.85)
    if (!svg) return
    airFxOf(row).appendChild(svg)
    const dist = (shard.large ? 26 : 36) * shard.speed
    const dx = Math.cos(shard.ang) * dist + (shard.large ? 8 : 0)
    const dyPeak = Math.sin(shard.ang) * (dist * 0.45) - (shard.large ? 6 : 10)
    const dyEnd = dyPeak + (shard.large ? 34 : 26)
    const rot = (dx >= 0 ? 1 : -1) * (35 + Math.round(shard.speed * 58))
    svg
      .animate(
        [
          { opacity: 1, transform: 'translate(0,0) rotate(0deg) scale(1)' },
          { opacity: 0.96, transform: `translate(${(dx * 0.45).toFixed(1)}px, ${dyPeak.toFixed(1)}px) rotate(${Math.round(rot * 0.42)}deg) scale(1.04)`, offset: 0.28 },
          { opacity: 0, transform: `translate(${dx.toFixed(1)}px, ${dyEnd.toFixed(1)}px) rotate(${rot}deg) scale(.76)` },
        ],
        { duration: shard.large ? S.large : S.small, delay: delayMs + i * S.step, easing: 'cubic-bezier(.2,.68,.35,1)', fill: 'none' },
      )
      .onfinish = () => svg.remove()
  })
}

/** 破裂正向延展：核心 / 崩口先击穿张开 → 放射裂纹从中心向外飙开（dashoffset 100→0）→ 环裂与折光接续 */
const animateHolesSpread = (row: HTMLElement, holeIdxs: readonly number[], delayMs: number) => {
  const svg = row.querySelector<SVGSVGElement>('.glass-host .glass-svg')
  if (!svg || !holeIdxs.length) return
  const S = HIT_REPORT_FX.spread
  holeIdxs.forEach((hid, order) => {
    const base = delayMs + order * S.holeStep
    svg.querySelectorAll<SVGElement>(`.hole-void-group[data-hid="${hid}"], .hole-core-group[data-hid="${hid}"], .hole-void-cut[data-hid="${hid}"]`).forEach((el) => {
      el.style.transformOrigin = `${el.dataset.cx}px ${el.dataset.cy}px`
      el.animate([{ transform: 'scale(.12)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
        duration: S.core,
        delay: base,
        easing: 'cubic-bezier(.16,.88,.3,1)',
        fill: 'backwards',
      })
    })
    svg.querySelectorAll<SVGElement>(`.hole-ray[data-hid="${hid}"]`).forEach((el, i) => {
      el.animate([{ strokeDashoffset: '100' }, { strokeDashoffset: '0' }], {
        duration: S.ray + (i % 3) * S.rayStep,
        delay: base + S.rayAt,
        easing: 'cubic-bezier(.14,.84,.26,1)',
        fill: 'backwards',
      })
    })
    svg.querySelectorAll<SVGElement>(`.hole-ring[data-hid="${hid}"]`).forEach((el, i) => {
      el.animate([{ strokeDashoffset: '100', opacity: 0 }, { strokeDashoffset: '0', opacity: 1 }], {
        duration: S.ring,
        delay: base + S.ringAt + (i % 4) * S.ringStep,
        easing: 'ease-out',
        fill: 'backwards',
      })
    })
    svg.querySelectorAll<SVGElement>(`.hole-facet[data-hid="${hid}"]`).forEach((el) => {
      el.animate([{ opacity: 0 }, { opacity: Number(el.getAttribute('opacity') || 0.7) }], {
        duration: S.facet,
        delay: base + S.facetAt,
        easing: 'ease-out',
        fill: 'backwards',
      })
    })
  })
}

/**
 * 出渠 / 泼桶时把还剩的裂纹精确逆向收口：外环与折光先收 → 放射裂纹从外尖端缩回核心（转水青焊修色）
 * → 中心破口与针孔核向心闭合。泼桶整体快一截。
 */
const animateGlassReverseClose = (gh: HTMLElement, bucket: boolean, removeHost = false) => {
  const R = REPAIR_FX.dockOut.reverse
  const k = bucket ? REPAIR_FX.dockOut.bucketScale : 1
  const finish = () => {
    if (!gh.isConnected) return
    if (removeHost) gh.remove()
    else gh.innerHTML = ''
  }
  // 四角碎裂：裂纹从里往碎角缩回、碎角向角点收拢、碎板的折光淡掉（与弹孔收口同一段时长）
  const scar = gh.querySelector<SVGSVGElement>('.scar-svg')
  if (scar) {
    scar.querySelectorAll<SVGElement>('.scar-crack').forEach((el) => {
      el.animate([{ strokeDashoffset: el.getAttribute('stroke-dashoffset') || '0' }, { strokeDashoffset: '100' }], {
        duration: Math.round(R.ray * k),
        delay: Math.round(R.rayAt * k),
        easing: 'cubic-bezier(.42, 0, .82, .56)',
        fill: 'forwards',
      })
    })
    scar.querySelectorAll<SVGElement>('.scar-chip').forEach((el) => {
      const from = Number(el.getAttribute('transform')?.match(/scale\(([\d.]+)\)/)?.[1] ?? 1)
      el.style.transformOrigin = `${el.dataset.ox}px ${el.dataset.oy}px`
      el.animate([{ transform: `scale(${from})`, opacity: 1 }, { transform: 'scale(.05)', opacity: 0 }], {
        duration: Math.round(R.void * k),
        delay: Math.round(R.voidAt * k),
        easing: 'cubic-bezier(.4, 0, .85, .45)',
        fill: 'forwards',
      })
    })
    scar.querySelectorAll<SVGElement>('.scar-facet').forEach((el) => {
      el.animate([{ opacity: el.getAttribute('opacity') || '0.8' }, { opacity: 0 }], {
        duration: Math.round(R.ring * k),
        delay: R.ringAt,
        easing: 'ease-out',
        fill: 'forwards',
      })
    })
  }
  const svg = gh.querySelector<SVGSVGElement>('.glass-svg')
  if (!svg) {
    if (scar) setTimeout(finish, Math.round(R.total * k))
    return
  }
  svg.querySelectorAll<SVGElement>('.hole-ring').forEach((el) => {
    el.animate([{ strokeDashoffset: el.getAttribute('stroke-dashoffset') || '0' }, { strokeDashoffset: '100', opacity: 0 }], {
      duration: Math.round(R.ring * k),
      delay: R.ringAt,
      easing: 'ease-in',
      fill: 'forwards',
    })
  })
  svg.querySelectorAll<SVGElement>('.hole-facet').forEach((el) => {
    el.animate([{ opacity: el.getAttribute('opacity') || '0.6' }, { opacity: 0 }], {
      duration: Math.round(R.ring * k),
      delay: R.ringAt,
      easing: 'ease-out',
      fill: 'forwards',
    })
  })
  svg.querySelectorAll<SVGElement>('.hole-ray').forEach((el) => {
    if (el.classList.contains('hole-ray-main')) el.style.stroke = 'var(--hit-aqua)'
    el.animate([{ strokeDashoffset: el.getAttribute('stroke-dashoffset') || '0' }, { strokeDashoffset: '100' }], {
      duration: Math.round(R.ray * k),
      delay: Math.round(R.rayAt * k),
      easing: 'cubic-bezier(.42, 0, .82, .56)',
      fill: 'forwards',
    })
  })
  svg.querySelectorAll<SVGElement>('.hole-void-group, .hole-core-group, .hole-void-cut').forEach((el) => {
    // 在渠修到一半的破口带着 transform 属性（缩到 s 倍）；样式里的 transform 会盖过它，所以从 s 接着缩
    const from = Number(el.getAttribute('transform')?.match(/scale\(([\d.]+)\)/)?.[1] ?? 1)
    el.style.transformOrigin = `${el.dataset.cx}px ${el.dataset.cy}px`
    el.animate([{ transform: `scale(${from})`, opacity: 1 }, { transform: 'scale(.05)', opacity: 0 }], {
      duration: Math.round(R.void * k),
      delay: Math.round(R.voidAt * k),
      easing: 'cubic-bezier(.4, 0, .85, .45)',
      fill: 'forwards',
    })
  })
  setTimeout(finish, Math.round(R.total * k))
}

/**
 * 四角碎裂从旧伤长到新伤（返港转化）：每条裂纹从旧长度接着延伸，新亮起的角从无到有，碎角从旧大小长到新大小，
 * 两头接上时碎板的折光淡入。长度照 shared/hit-scar 同一套算法按旧伤再算一遍，不在标记里另存。
 */
const animateScarGrowth = (svg: Element, shipId: number, prev: ShipDamageState, next: ShipDamageState) => {
  const zones = glassZonesOf(shipId)
  const geo = scarGeometry(shipId, next.seedKey, zones.width, zones.height)
  const from = scarExtents(geo, prev.scar ?? 0)
  const timing = { duration: RETURN_FX.scar, delay: RETURN_FX.scarAt, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'backwards' as const }
  svg.querySelectorAll<SVGElement>('.scar-crack').forEach((el) => {
    const [where, key] = (el.dataset.scar ?? '').split(':')
    let drawn = 0
    if (where === 'l' || where === 'r') drawn = scarMerge(from[`${where}t` as ScarCorner], from[`${where}b` as ScarCorner])
    else if (where in from) {
      const parts = scarParts(from[where as ScarCorner])
      drawn = key === 'main' ? parts.main : key === 'b1' ? parts.branch1 : parts.branch2
    }
    el.animate([{ strokeDashoffset: (100 * (1 - drawn)).toFixed(1) }, { strokeDashoffset: el.getAttribute('stroke-dashoffset') || '0' }], timing)
  })
  svg.querySelectorAll<SVGElement>('.scar-chip').forEach((el) => {
    const corner = (el.dataset.scar ?? '').split(':')[0] as ScarCorner
    const start = corner in from ? scarParts(from[corner]).chip : 0
    const end = Number(el.getAttribute('transform')?.match(/scale\(([\d.]+)\)/)?.[1] ?? 1)
    el.style.transformOrigin = `${el.dataset.ox}px ${el.dataset.oy}px`
    el.animate([{ transform: `scale(${Math.max(0.02, start)})` }, { transform: `scale(${end})` }], timing)
  })
  svg.querySelectorAll<SVGElement>('.scar-facet').forEach((el) => {
    const side = (el.dataset.scar ?? '').split(':')[0]
    const start = scarMerge(from[`${side}t` as ScarCorner], from[`${side}b` as ScarCorner]) * 0.9
    el.animate([{ opacity: start.toFixed(2) }, { opacity: el.getAttribute('opacity') || '0.9' }], timing)
  })
}

/**
 * 返港转化：这一趟的弹孔另挂一层、照出渠的逆向收口缩掉；四角碎裂同时从旧伤长到新伤。
 * 积水另挂一层液面降下去、倾侧扶正，锈渍晚半拍从原水线显出来。都在新画好的行上播（行本身已是转化后的样子）。
 */
const playReturnToPort = (row: HTMLElement, shipId: number, prev: ShipDamageState, next: ShipDamageState) => {
  const zones = glassZonesOf(shipId)
  const ship = mg.ships[shipId]
  const gh = row.querySelector<HTMLElement>('.glass-host')
  if (gh && prev.holes.length) {
    const layer = document.createElement('span')
    layer.innerHTML = hitGlassSvg({ id: `${shipId}-return`, holes: prev.holes, tier: ship ? shipHitCrack(ship) : null, zones, progress: null })
    gh.appendChild(layer)
    animateGlassReverseClose(layer, false, true)
  }
  const scar = gh?.querySelector('.scar-svg')
  if (scar) animateScarGrowth(scar, shipId, prev, next)
  const wh = row.querySelector<HTMLElement>('.water-host')
  if (wh && prev.water > 0.4) {
    const layer = document.createElement('span')
    layer.innerHTML = waterMarkupOf(shipId, prev.water, prev.listDeg, prev.listDeg, false)
    wh.appendChild(layer)
    const body = layer.querySelector<HTMLElement>('.water-body')
    const drain = body?.animate(
      [
        { transform: `${getComputedStyle(body).transform === 'none' ? '' : getComputedStyle(body).transform} translateY(0)`.trim(), opacity: 1 },
        { transform: `translateY(${Math.round(zones.height * 0.5)}px)`, opacity: 0 },
      ],
      { duration: RETURN_FX.drain, delay: RETURN_FX.drainAt, easing: 'cubic-bezier(.3, .1, .4, 1)', fill: 'both' },
    )
    if (drain) drain.onfinish = () => layer.remove()
    else layer.remove()
  }
  const rust = wh?.querySelector<SVGElement>('.rust-svg')
  if (rust && (next.rust ?? 0) > (prev.rust ?? 0)) {
    rust.animate([{ opacity: 0 }, { opacity: rust.getAttribute('opacity') || '1' }], {
      duration: RETURN_FX.rust,
      delay: RETURN_FX.rustAt,
      easing: 'ease-out',
      fill: 'backwards',
    })
  }
  if (prev.listDeg > 0) {
    const deg = visibleListDeg(prev.listDeg, zones.width, true)
    if (deg > 0.04) {
      row.animate(
        [
          { transform: `translate3d(0, ${(deg * 0.45).toFixed(2)}px, 0) rotate(${deg.toFixed(2)}deg)`, transformOrigin: '44% 62%' },
          { transform: 'translate3d(0, 0, 0) rotate(0deg)', transformOrigin: '44% 62%' },
        ],
        { duration: RETURN_FX.right, delay: RETURN_FX.rightAt, easing: 'cubic-bezier(.22, .85, .32, 1)', fill: 'backwards' },
      )
    }
  }
}

/** 反潜：声呐扫掠 → 从行上方投下深弹（顶缘入水涟漪 + 下潜尾泡）→ 定深起爆（扣血从这一刻起，由 --hit-lead 排在样式里） */
const playAswDrop = (row: HTMLElement, motion: HitMotion) => {
  const A = HIT_REPORT_FX.aswDrop
  const xs = motion.dropCount <= 1 ? [42] : motion.dropCount === 2 ? [39, 70] : [37, 45, 71]
  const air = airFxOf(row)
  spawnSonarRing(row, xs[0], 42, 'var(--asw-sonar)', 0, 2.2)
  xs.forEach((xPct, i) => {
    const start = A.start + i * A.step
    const ripple = document.createElement('span')
    ripple.className = 'fx-asw-ripple'
    ripple.style.left = `${xPct}%`
    air.appendChild(ripple)
    ripple
      .animate(
        [
          { opacity: 0, transform: 'scale(.2)' },
          { opacity: 0.85, transform: 'scale(.9)', offset: 0.35 },
          { opacity: 0, transform: 'scale(1.65)' },
        ],
        { duration: A.ripple, delay: start + A.rippleAt, easing: 'ease-out', fill: 'none' },
      )
      .onfinish = () => ripple.remove()
    const charge = document.createElement('span')
    charge.className = 'fx-depth-charge'
    charge.style.left = `${xPct}%`
    charge.innerHTML =
      '<svg viewBox="0 0 14 18" width="14" height="18"><rect x="3" y="2" width="8" height="13" rx="3" style="fill:var(--asw-charge);stroke:var(--asw-charge-rim)" stroke-width="1"/><rect x="3.4" y="6.2" width="7.2" height="2.6" style="fill:var(--asw-charge-band)"/><line x1="4.5" y1="15" x2="9.5" y2="15" style="stroke:var(--asw-charge-rim)" stroke-width="1.2"/></svg>'
    air.appendChild(charge)
    charge
      .animate(
        [
          { opacity: 0, transform: 'translateY(-28px) rotate(-10deg) scale(.86)' },
          { opacity: 1, transform: 'translateY(-4px) rotate(-4deg) scale(1)', offset: 0.25 },
          { opacity: 1, transform: 'translateY(17px) rotate(3deg) scale(1.02)', offset: 0.82 },
          { opacity: 1, transform: 'translateY(19px) rotate(0deg) scale(1.25)', filter: 'brightness(2.2)' },
        ],
        { duration: A.fall, delay: start, easing: 'cubic-bezier(.32,.1,.45,1)', fill: 'none' },
      )
      .onfinish = () => charge.remove()
    spawnBubbles(row, 3, [xPct - 2, xPct + 2], 'var(--asw-sonar)', start + A.bubblesAt, 18)
  })
  // 起爆：同心冲击波与气泡群（水下声压爆闪与垂直浮沉走样式表）
  xs.forEach((xPct, i) => spawnSonarRing(row, xPct, 52, 'var(--asw-sonar)', motion.leadMs + i * 55, 3.2))
  spawnBubbles(row, 11, [30, 76], 'var(--asw-sonar)', motion.leadMs + 40, 44)
}

/** 鱼雷：一两条航迹从右侧敌方切入水线；命中后右侧水柱浪花与进水气泡，积水液面涨上来 */
const playTorpRuns = (row: HTMLElement, motion: HitMotion, torpRatio: number, zones: RowZones) => {
  const air = airFxOf(row)
  for (let t = 0; t < motion.torpRuns; t++) {
    const streak = document.createElement('span')
    streak.className = 'fx-torp-run'
    streak.style.top = `${66 + t * 14}%`
    air.appendChild(streak)
    streak
      .animate(
        [
          { opacity: 0.2, transform: 'translateX(36px) scaleX(.6)' },
          { opacity: 1, transform: `translateX(-${Math.round(zones.width * 0.24)}px) scaleX(1.15)`, offset: 0.72 },
          { opacity: 0, transform: `translateX(-${Math.round(zones.width * 0.3)}px) scaleX(.4)` },
        ],
        { duration: HIT_REPORT_FX.torpRun, delay: t * HIT_REPORT_FX.torpRunStep, easing: 'cubic-bezier(.25,.7,.35,1)', fill: 'none' },
      )
      .onfinish = () => streak.remove()
  }
  spawnBubbles(row, Math.round(6 + torpRatio * 8), [54, 94], 'var(--accent)', motion.leadMs + 20, 40)
  spawnSonarRing(row, 82, 72, 'var(--accent)', motion.leadMs + 10, 2.4)
  const rise = motion.waterTo - motion.waterFrom
  const wh = row.querySelector<HTMLElement>('.water-host')
  if (wh && rise > 0.4) {
    wh.animate([{ transform: `translateY(${((rise / 100) * zones.height).toFixed(1)}px)` }, { transform: 'translateY(0)' }], {
      duration: HIT_REPORT_FX.list,
      delay: motion.leadMs,
      easing: 'cubic-bezier(.22,.78,.32,1)',
      fill: 'backwards',
    })
  }
}

/** 量每一行内各列的真实像素位置（相对行左上角，取整）。行可能正倾着 1° 上下，误差在一两像素内 */
const measureRowLayouts = (root: HTMLElement) => {
  for (const row of root.querySelectorAll<HTMLElement>('.ship[data-ship]')) {
    const id = Number(row.dataset.ship)
    const width = Math.round(row.clientWidth)
    if (!id || width < 120) continue
    const rr = row.getBoundingClientRect()
    const rel = (el: Element | null): GlassRect | null => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      if (!b.width) return null
      return { x0: Math.round(b.left - rr.left), x1: Math.round(b.right - rr.left), y0: Math.round(b.top - rr.top), y1: Math.round(b.bottom - rr.top) }
    }
    const rightOf = (els: NodeListOf<Element>): number | null =>
      els.length ? Math.round(Math.max(...Array.from(els, (el) => el.getBoundingClientRect().right - rr.left))) : null
    rowLayouts.set(id, {
      width,
      height: cachedRowHeight,
      whoRight: rightOf(row.querySelectorAll(':scope > .who > *')),
      hpc: rel(row.querySelector(':scope > .hpc')),
      fa2: rel(row.querySelector(':scope > .fa2')),
      cond: rel(row.querySelector(':scope > .cond')),
      eq: rel(row.querySelector(':scope > .eq')),
      eqContentRight: rightOf(row.querySelectorAll(':scope > .eq > *')),
    })
  }
}

/** 等到量到列位置，给没有逐发战报的带伤舰补默认碎裂；补了就要再画一次 */
/**
 * 重启后（或刚打开开关）才见到的带伤舰：照账本里的战斗把这一轮挨的每一下重放出来，弹孔与实际挨打逐发对应
 * （2026-11-27 他报「受到伤害的次数跟弹孔不对应」：原先一律按伤势档补 1～3 个默认弹孔）。
 * 只读、走现有的战斗快照查询（chron:battles / chron:battle），不碰游戏请求。从最近一场往回取，都找到起点就停，
 * 最多取这么多场（一场约 12KB，96 场读加解析约 10ms）。找不到满血开场的，已接上的那几场照样逐发重放、更早的伤补默认碎裂；
 * 接不上（中途泊修回过血、记录不全）或取不到就整个退回默认碎裂。同一时间只跑一批。
 * 账本 60 个重启点实测（2026-11-27）：接上的弹孔数与命中数逐个相等（鱼雷伤改为进水、7 个封顶的除外），没有接错的。
 */
const LEDGER_REBUILD_MAX = 96
let ledgerRebuildRunning = false

const rebuildDamageFromLedger = async (ids: readonly number[]): Promise<Map<number, ShipDamageState | null>> => {
  const out = new Map<number, ShipDamageState | null>()
  const open = new Set(ids)
  const battles: BattleView[] = []
  // 按出击分段（维护者 2026-11-28 定）：之前出击的弹孔与积水在段尾转成四角碎裂与锈渍，只有眼下这次出击的还是弹孔
  const sortieOfBattle = new Map<BattleView, number>()
  let current: number | null | undefined
  const sorties = { sortieOf: (battle: BattleView) => sortieOfBattle.get(battle) ?? null, current: null as number | null }
  try {
    const summaries = await queryBattleSnapshots(LEDGER_REBUILD_MAX)
    for (const summary of summaries) {
      if (!open.size) break
      if (summary.practice) continue
      // 最近一场就是眼下这次出击的（在出击中、这次已经打过、图也对得上）才认它为当前出击
      if (current === undefined) {
        const sortie = mg.sortie
        const live = !!sortie?.active && !sortie.practice && sortie.battleCount > 0 && summary.map === sortie.mapArea * 10 + sortie.mapNo
        current = live ? summary.sortieId : null
        sorties.current = current
      }
      const battle = (await queryBattleSnapshot(summary.id))?.sortie?.battle
      if (!battle) continue
      battles.push(battle)
      sortieOfBattle.set(battle, summary.sortieId)
      for (const id of [...open]) {
        const ship = mg.ships[id]
        const state = damageStates.get(id)
        if (!ship || !state) {
          open.delete(id)
          continue
        }
        const chain = damageChainOf(battles, ship)
        if (chain.status === 'open') continue
        open.delete(id)
        out.set(id, chain.status === 'done' ? replayDamageChain(chain.battles, id, replayDepsOf(id), undefined, sorties) : null)
      }
    }
    // 取到头也没找到满血开场：已接上的那几场照样逐发重放，链头之前的伤算历史战损
    for (const id of open) {
      const ship = mg.ships[id]
      if (!ship || !damageStates.get(id)) continue
      const chain = damageChainOf(battles, ship)
      if (chain.status !== 'open' || !chain.battles.length) continue
      const deps = replayDepsOf(id)
      const base = syntheticDamageState(deps.seedKey, chain.startHp, ship.maxhp, isSubShip(ship))
      out.set(id, replayDamageChain(chain.battles, id, deps, base, sorties))
      open.delete(id)
    }
  } catch {
    // 账本查不到：下面统一退回默认碎裂
  }
  for (const id of open) out.set(id, null)
  return out
}

const replayDepsOf = (id: number) => {
  const ship = mg.ships[id]
  return {
    seedKey: damageStates.get(id)?.seedKey ?? 0,
    zones: liveZonesOf(id),
    stypeOf: (mstId: number) => mg.master.ships[mstId]?.stype ?? null,
    slotTypeOf: (mstId: number) => mg.master.slotitems[mstId]?.type2 ?? null,
    targetStype: (ship && mg.master.ships[ship.shipId]?.stype) ?? null,
  }
}

/** 等量到列位置，给没有逐发战报的带伤舰补战损（先照账本重放，接不上才补默认碎裂）；补完再画一次 */
const settleSyntheticDamage = (root: HTMLElement) => {
  if (ledgerRebuildRunning) return
  const ready = [...syntheticPending].filter((id) => {
    const ship = mg.ships[id]
    const state = damageStates.get(id)
    if (!ship || !state || state.holes.length) {
      syntheticPending.delete(id)
      return false
    }
    return rowLayouts.has(id)
  })
  if (!ready.length) return
  ledgerRebuildRunning = true
  void rebuildDamageFromLedger(ready)
    .then((rebuilt) => {
      let changed = false
      for (const id of ready) {
        const ship = mg.ships[id]
        const state = damageStates.get(id)
        // 等账本的这段时间里这艘又挨了打（掉血那一路已经补过）或修满了：不再覆盖
        if (!syntheticPending.has(id) || !ship || !state || state.holes.length) continue
        syntheticPending.delete(id)
        const zones = liveZonesOf(id)
        const sunk = isSunkInSortie(id)
        const replayed = rebuilt.get(id) ?? syntheticDamageState(state.seedKey, sunk ? 0 : ship.nowhp, ship.maxhp, isSubShip(ship))
        // 重放出来的也再按实际血量核一遍（账本缺了几场时，缺的那截补成四角碎裂）
        const next = sunk ? replayed : reconcileScar(replayed, ship.nowhp, ship.maxhp)
        damageStates.set(id, next)
        glassZones.set(id, zones)
        changed = true
      }
      if (changed && root.isConnected) deferPassive(root, 'ru', render)
    })
    .finally(() => {
      ledgerRebuildRunning = false
    })
}

/** 在渠舰的维修进度跨过整百分点：就地改血条、弹孔收口、积水与倾角，不为它重画整块（交接包：低频就地刷新） */
const refreshDockProgress = (root: HTMLElement) => {
  const now = Date.now()
  for (const row of root.querySelectorAll<HTMLElement>('.ship[data-dock-kind]')) {
    const id = Number(row.dataset.ship)
    const ship = mg.ships[id]
    const dock = dockOf(id)
    if (!ship || !dock) continue
    const progress = dockProgressOf(ship, dock, now, DOCK_LIVE_STEP)
    const pct = progress == null ? '' : String(Math.round(progress * 100))
    if (row.dataset.dockProg === pct) continue
    row.dataset.dockProg = pct
    const bar = row.querySelector<HTMLElement>('.hpc .bar > i')
    const barPct = dockBarPct(ship, dock, DOCK_LIVE_STEP)
    if (bar) bar.style.width = `${barPct}%`
    // 平滑过渡记的宽度跟着就地补的走：否则下一次整块重画会从上一回的旧宽度重走一遍，血条先缩回去一截
    const recorded = barWidths.get(id)
    if (recorded) recorded.hp = barPct
    const state = damageStates.get(id)
    const listRaw = state ? dockListDeg(state.listDeg, progress) : 0
    const listNow = listRaw > 0 ? visibleListDeg(listRaw, glassZonesOf(id).width, true) : 0
    const gh = row.querySelector<HTMLElement>('.glass-host')
    if (gh) gh.innerHTML = state ? glassLayersOf(id, state, shipHitCrack(ship), progress, false) : ''
    const wh = row.querySelector<HTMLElement>('.water-host')
    if (wh) wh.innerHTML = state ? `${rustMarkupOf(id, state, progress)}${waterMarkupOf(id, dockWater(state.water, progress), listRaw, state.listDeg, true)}` : ''
    if (listNow > 0.04) {
      row.setAttribute('data-listed', '1')
      row.style.setProperty('--list-deg', `${listNow.toFixed(2)}deg`)
      row.style.setProperty('--list-y', `${(listNow * 0.45).toFixed(2)}px`)
    } else {
      row.removeAttribute('data-listed')
      row.style.removeProperty('--list-deg')
      row.style.removeProperty('--list-y')
    }
  }
}

// 余韵两段收尾，都就地改属性、不重画整块：到点先挂 data-aura-fade 淡出，FX_FADE_MS 后再撤。
const scheduleAuraCleanup = (shipId: number, delayMs: number) => {
  const prev = auraTimers.get(shipId)
  if (prev) clearTimeout(prev)
  auraTimers.set(
    shipId,
    setTimeout(() => {
      const entry = transientAura.get(shipId)
      if (!entry || Date.now() < entry.until) {
        auraTimers.delete(shipId)
        return
      }
      fleetRowOf(shipId)?.setAttribute('data-aura-fade', '1')
      auraTimers.set(
        shipId,
        setTimeout(() => {
          auraTimers.delete(shipId)
          const current = transientAura.get(shipId)
          if (!current || Date.now() < current.until + FX_FADE_MS) return
          transientAura.delete(shipId)
          const row = fleetRowOf(shipId)
          row?.removeAttribute('data-repair-aura')
          row?.removeAttribute('data-aura-fade')
        }, FX_FADE_MS),
      )
    }, delayMs),
  )
}

/** 被弹换档时血条颜色渐变的时长（实血当场落位，颜色跟着冲击那一拍过去） */
const HIT_BAR_TONE_MS = 360

const runPostRenderHitFx = (root: HTMLElement) => {
  // 先量列位置：下一次落弹孔、补默认碎裂都读它
  measureRowLayouts(root)
  settleSyntheticDamage(root)
  const hits = [...pendingHitFx.entries()]
  pendingHitFx.clear()
  const repairs = [...pendingRepairFx.entries()]
  pendingRepairFx.clear()
  const returns = [...pendingReturnFx.entries()]
  pendingReturnFx.clear()
  if (!hits.length && !repairs.length && !returns.length) return
  if (document.visibilityState !== 'visible') return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  for (const [shipId, item] of repairs) {
    if (item.event.kind === 'goddess') scheduleAuraCleanup(shipId, 4500)
    else if (item.event.kind === 'dock') scheduleAuraCleanup(shipId, 2600)
  }
  // 减少动态效果：深弹下坠、航迹、碎片蹦飞、震颤与逆向扫动一概不播，只留静态战损与静态维修进度
  if (reduced) return

  // 战报驱动的被弹：反潜先投深弹再起爆、鱼雷先切入水线再炸；弹孔在冲击那一拍（lead）正向延展、碎片崩飞。
  // 冲击、残影、盖章与倾侧 / 浮沉走样式表（--hit-lead 排在同一时间线）。
  for (const [shipId, item] of hits) {
    const row = root.querySelector<HTMLElement>(`.ship[data-ship="${shipId}"]`)
    if (!row) continue
    const { motion, newHoles, tier, torpRatio } = item
    const zones = glassZonesOf(shipId)
    if (motion.kind === 'asw') playAswDrop(row, motion)
    else if (motion.torpRuns > 0) playTorpRuns(row, motion, torpRatio, zones)
    animateHolesSpread(row, newHoles.map((hole) => hole.idx), motion.leadMs)
    // 实血当场落位（残影随后下降）；跨了档的话颜色在冲击那一拍从旧档渐变到新档，不一下跳过去
    const bar = row.querySelector<HTMLElement>('.hpc .bar > i')
    const tone = bar ? hpBarFrames(bar, item.hpFrom, item.hpTo, false, false, false) : []
    if (bar && tone.length) bar.animate(tone, { duration: HIT_BAR_TONE_MS, delay: motion.leadMs, easing: 'ease-out', fill: 'backwards' })
    newHoles.forEach((hole, i) => launchGlassShards(row, hole.shards, tier, motion.leadMs + 30 + i * HIT_REPORT_FX.shard.holeStep))
  }

  // 返港转化：弹孔收口、四角碎裂长出来；积水抽干、倾侧扶正、锈渍显出来
  for (const [shipId, item] of returns) {
    const row = root.querySelector<HTMLElement>(`.ship[data-ship="${shipId}"]`)
    if (row) playReturnToPort(row, shipId, item.prev, item.next)
  }

  // 各段起点与时长都取节拍表 REPAIR_FX：冲击 / 起势 → 喘口气 → 修复光效与血条 → 再喘口气报飘字。
  // 后段用 Web Animations 的 delay 排进同一时间线（不再 setTimeout 等前段），
  // 中途换了 DOM 就随旧行一起没掉，不会在新行上补播半段。
  let akashiPulsed = false
  for (const [shipId, item] of repairs) {
    const row = root.querySelector<HTMLElement>(`.ship[data-ship="${shipId}"]`)
    if (!row) continue
    const { event, prevState, prevSvg, prevWater, prevRust, prevBarPct, prevFuelPct, prevAmmoPct, dockStyle, healedCrack } = item
    const prevPct = event.max > 0 ? Math.max(0, Math.min(100, (event.before / event.max) * 100)) : 0
    const nextPct = event.max > 0 ? Math.max(0, Math.min(100, (event.after / event.max) * 100)) : 100
    const flash = row.querySelector<HTMLElement>('.fx-flash')
    const sweep = row.querySelector<HTMLElement>('.fx-sweep')
    // 同一层 .fx-flash / .fx-sweep 前后两段换底色：第二段到点再换，免得第一段的红闪先染成修复色
    const recolorAt = (el: HTMLElement | null, ms: number, background: string) => {
      if (!el) return
      setTimeout(() => {
        if (el.isConnected) el.style.background = background
      }, ms)
    }

    if (event.kind === 'damecon') {
      const T = REPAIR_FX.damecon
      const total = T.weldAt + T.rise
      row.querySelector<HTMLElement>('.hpc .bar > i')?.animate(
        [
          { width: `${prevPct}%` },
          { width: '0%', offset: T.dipEnd / total },
          { width: '0%', offset: T.weldAt / total },
          { width: `${nextPct}%` },
        ],
        { duration: total, easing: 'cubic-bezier(.2,.82,.28,1)' },
      )
      row.animate(
        [
          { transform: 'translate3d(0,0,0)' },
          { transform: 'translate3d(10px,1px,0) rotate(-.7deg)', offset: 0.22 },
          { transform: 'translate3d(-7px,-.6px,0) rotate(.45deg)', offset: 0.55 },
          { transform: 'translate3d(0,0,0)' },
        ],
        { duration: T.impact, easing: 'ease-out' },
      )
      if (flash) {
        flash.style.background = 'linear-gradient(90deg, color-mix(in srgb, var(--bad) 55%, transparent), transparent 72%)'
        flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: T.dipEnd, easing: 'ease-out' })
        recolorAt(flash, T.weldAt,
          'linear-gradient(90deg, color-mix(in srgb, var(--hit-damecon) 62%, transparent), color-mix(in srgb, var(--hit-damecon) 34%, transparent) 52%, transparent)')
        flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 0 }], { duration: T.weldFlash, delay: T.weldAt, easing: 'ease-out' })
      }
      if (sweep) {
        sweep.style.background =
          'linear-gradient(90deg, transparent, color-mix(in srgb, var(--hit-damecon) 70%, transparent) 50%, transparent)'
        sweep.animate(
          [
            { opacity: 1, transform: 'translateX(-85%) skewX(-20deg)' },
            { opacity: 0, transform: 'translateX(118%) skewX(-20deg)' },
          ],
          { duration: T.weldSweep, delay: T.weldAt, easing: 'cubic-bezier(.16,.84,.3,1)' },
        )
      }
      spawnRowMotes(row, 8, 'var(--hit-damecon)', false, T.weldAt)
      spawnRowPop(row, '要员发动', 'var(--hit-damecon)', T.popAt)
    } else if (event.kind === 'goddess') {
      const T = REPAIR_FX.goddess
      const total = T.reviveAt + T.rise
      // 血条一条时间线走完：探底 → 停在 0 → 圣金拉满。分两条动画接力会在交接那一帧闪回 100%
      row.querySelector<HTMLElement>('.hpc .bar > i')?.animate(
        [
          { width: `${prevPct}%` },
          { width: '0%', offset: T.dipEnd / total },
          { width: '0%', offset: T.reviveAt / total },
          { width: '100%' },
        ],
        { duration: total, easing: 'cubic-bezier(.2,.82,.28,1)' },
      )
      animateRowBars(row, { fuel: [prevFuelPct, 100], ammo: [prevAmmoPct, 100] }, { delay: T.reviveAt, duration: T.rise })
      row.animate(
        [
          { transform: 'translate3d(0,0,0)' },
          { transform: 'translate3d(9px,1px,0) rotate(-.6deg)', offset: 0.24 },
          { transform: 'translate3d(0,0,0)' },
        ],
        { duration: T.impact, easing: 'ease-out' },
      )
      if (flash) {
        flash.style.background = 'linear-gradient(90deg, color-mix(in srgb, var(--bad) 50%, transparent), transparent 70%)'
        flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: T.dipEnd, easing: 'ease-out' })
        recolorAt(flash, T.reviveAt,
          'radial-gradient(ellipse 80% 120% at 50% 50%, color-mix(in srgb, var(--hit-goddess) 72%, transparent), color-mix(in srgb, var(--hit-goddess) 28%, transparent) 55%, transparent 88%)')
        flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], { duration: T.flash, delay: T.reviveAt, easing: 'ease-out' })
      }
      if (sweep) {
        sweep.style.background =
          'linear-gradient(90deg, transparent, color-mix(in srgb, var(--hit-goddess) 82%, transparent) 50%, transparent)'
        sweep.animate(
          [
            { opacity: 1, transform: 'translateX(-95%) skewX(-18deg)' },
            { opacity: 0, transform: 'translateX(120%) skewX(-18deg)' },
          ],
          { duration: T.sweep, delay: T.reviveAt, easing: 'cubic-bezier(.16,.82,.26,1)' },
        )
      }
      // 崩掉的那块最大的破口飞回来嵌上（女神截断击沉）
      const biggest = prevState?.holes.filter((hole) => hole.spallPolys.length).sort((a, b) => b.power - a.power || b.idx - a.idx)[0]
      if (biggest) {
        const dirY = biggest.y < glassZonesOf(shipId).height / 2 ? -22 : 22
        const rot = dirY < 0 ? 42 : -42
        const rev = shardSvg(biggest.spallPolys[0], 'var(--hit-goddess)', 'var(--glow-shatter)', 1.4)
        if (rev) {
          airFxOf(row).appendChild(rev)
          rev
            .animate(
              [
                { opacity: 0, transform: `translate(28px, ${dirY}px) rotate(${rot}deg) scale(0.82)` },
                { opacity: 1, transform: `translate(6px, ${(dirY * 0.22).toFixed(1)}px) rotate(${(rot * 0.22).toFixed(1)}deg) scale(1.04)`, offset: 0.62 },
                { opacity: 0, transform: 'translate(0, 0) rotate(0deg) scale(1)' },
              ],
              { duration: T.shardReturn, delay: T.reviveAt, easing: 'cubic-bezier(.16,.84,.28,1)', fill: 'both' },
            )
            .onfinish = () => rev.remove()
        }
      }
      const gh = row.querySelector<HTMLElement>('.glass-host')
      if (prevSvg && gh) {
        // 冲击期间旧裂纹照原色留着，圣金光晕到了再转金、淡掉
        gh.innerHTML = prevSvg
        setTimeout(() => {
          if (gh.isConnected) gh.dataset.glassGold = '1'
        }, T.reviveAt)
        gh
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.goldFade, delay: T.reviveAt + T.goldFadeDelay, easing: 'ease-out', fill: 'forwards' })
          .onfinish = () => {
            gh.innerHTML = ''
            delete gh.dataset.glassGold
          }
      }
      spawnRowMotes(row, 10, 'var(--hit-goddess)', true, T.reviveAt)
      spawnRowPop(row, '女神发动', 'var(--hit-goddess)', T.popAt)
    } else if (event.kind === 'dock') {
      // 四套特色出渠（交接包 v2）：残余裂纹精确逆向收口 → 积水排空 → 按伤势种类各自的光效 → 血条滞后涨满 → 「入渠完成」
      const O = REPAIR_FX.dockOut
      const style = dockStyle ?? 'shell'
      const bucket = style === 'bucket'
      const zones = glassZonesOf(shipId)
      const gh = row.querySelector<HTMLElement>('.glass-host')
      if (prevSvg && gh) {
        gh.innerHTML = prevSvg
        animateGlassReverseClose(gh, bucket)
      }
      const wh = row.querySelector<HTMLElement>('.water-host')
      if ((prevWater > 0.4 || prevRust) && wh) {
        // 残余的锈与积水：锈随除锈光淡掉，积水往下排空（返港后一般已经抽干，只剩锈）
        wh.innerHTML = `${prevRust}${prevWater > 0.4 ? waterMarkupOf(shipId, prevWater, 0, 0, true) : ''}`
        const dur = bucket ? O.bucketDrain : O.drain
        const ends: Animation[] = []
        const body = wh.querySelector<HTMLElement>('.water-body')
        if (body) {
          ends.push(
            body.animate(
              [
                { opacity: 0.95, transform: 'translateY(0)' },
                { opacity: 0.65, transform: `translateY(${Math.round(zones.height * 0.45)}px)`, offset: 0.62 },
                { opacity: 0, transform: `translateY(${zones.height}px)` },
              ],
              { duration: dur, delay: O.drainAt, easing: 'cubic-bezier(.22,.72,.28,1)', fill: 'both' },
            ),
          )
        }
        const rust = wh.querySelector<SVGElement>('.rust-svg')
        if (rust) {
          ends.push(rust.animate([{ opacity: rust.getAttribute('opacity') || '1' }, { opacity: 0 }], { duration: dur, delay: O.drainAt, easing: 'ease-in', fill: 'both' }))
        }
        void Promise.all(ends.map((a) => a.finished)).then(
          () => {
            if (wh.isConnected) wh.innerHTML = ''
          },
          () => {},
        )
      }
      if (style === 'bucket') {
        // 高速修复桶：清亮水花泼溅弧波 + 水珠四溅
        if (sweep) {
          sweep.style.background =
            'radial-gradient(ellipse 32% 160% at 50% 50%, color-mix(in srgb, var(--glow-shatter) 75%, var(--hit-aqua)), color-mix(in srgb, var(--hit-aqua) 45%, transparent) 55%, transparent 82%)'
          sweep.animate(
            [
              { opacity: 1, transform: 'translateX(-75%) scaleY(1.2)' },
              { opacity: 0, transform: 'translateX(115%) scaleY(1)' },
            ],
            { duration: O.bucket.sweep, easing: 'cubic-bezier(.16,.84,.28,1)' },
          )
        }
        spawnBubbles(row, 14, [16, 88], 'var(--hit-aqua)', O.bucket.bubblesAt, 36)
      } else if (style === 'sub') {
        // 潜水舰：压载舱吹除气泡群 + 同心声呐复压环
        if (flash) {
          flash.style.background = 'radial-gradient(ellipse 75% 130% at 45% 65%, color-mix(in srgb, var(--hit-aqua) 42%, transparent), transparent 82%)'
          flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: O.sub.flash, easing: 'ease-out' })
        }
        spawnSonarRing(row, 44, 52, 'var(--hit-aqua)', O.sub.ringAt, 3.0)
        spawnSonarRing(row, 44, 52, 'var(--asw-sonar)', O.sub.ring2At, 2.6)
        spawnBubbles(row, 15, [20, 82], 'var(--hit-aqua)', O.sub.bubblesAt, 48)
      } else if (style === 'torp') {
        // 鱼雷伤：排涝水流冲刷，船体轻盈回正
        if (sweep) {
          sweep.style.background =
            'linear-gradient(90deg, transparent, color-mix(in srgb, var(--hit-aqua) 54%, transparent) 46%, color-mix(in srgb, var(--accent) 32%, transparent) 66%, transparent)'
          sweep.animate(
            [
              { opacity: 0.95, transform: 'translateX(-88%) skewX(-14deg)' },
              { opacity: 0, transform: 'translateX(118%) skewX(-14deg)' },
            ],
            { duration: O.torp.sweep, easing: 'cubic-bezier(.18,.78,.28,1)' },
          )
        }
        spawnBubbles(row, 10, [35, 90], 'var(--hit-aqua)', O.torp.bubblesAt, 32)
      } else {
        // 炮击伤：银青复合光幕扫平弹孔与蛛网
        if (sweep) {
          sweep.style.background =
            'linear-gradient(90deg, transparent, color-mix(in srgb, var(--hit-aqua) 52%, transparent) 42%, color-mix(in srgb, var(--glow-shatter) 56%, transparent) 52%, color-mix(in srgb, var(--hit-aqua) 28%, transparent) 65%, transparent)'
          sweep.animate(
            [
              { opacity: 0.96, transform: 'translateX(-90%) skewX(-18deg)' },
              { opacity: 0, transform: 'translateX(118%) skewX(-18deg)' },
            ],
            { duration: O.shell.sweep, easing: 'cubic-bezier(.18,.78,.28,1)' },
          )
        }
        if (flash) {
          flash.style.background = 'linear-gradient(90deg, color-mix(in srgb, var(--hit-aqua) 32%, transparent), transparent 60%)'
          flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: O.shell.flash, easing: 'ease-out' })
        }
        spawnBubbles(row, 8, [24, 86], 'var(--hit-akashi)', O.shell.bubblesAt, 26)
      }
      animateRowBars(
        row,
        { hp: [prevBarPct, 100] },
        bucket ? { delay: O.bucketBarAt, duration: O.bucketRise, hpDocked: [true, false] } : { delay: O.barAt, duration: O.rise, hpDocked: [true, false] },
      )
      spawnRowPop(row, '入渠完成', 'var(--hit-aqua)', O[style].popAt)
    } else if (event.kind === 'berth' || event.kind === 'anchorage') {
      const T = REPAIR_FX.berth
      if (!akashiPulsed) {
        akashiPulsed = true
        const repairShipRow =
          root.querySelector<HTMLElement>('.ship[data-berth-role="flag"]') ??
          Array.from(root.querySelectorAll<HTMLElement>('.ship')).find((el) => {
            const s = mg.ships[Number(el.dataset.ship)]
            return Boolean(s?.slot.some((sid) => sid > 0 && mg.slotitems[sid]?.mstId === REPAIR_FACILITY_MST_ID))
          })
        if (repairShipRow) {
          const rf = repairShipRow.querySelector<HTMLElement>('.fx-flash')
          if (rf) {
            rf.style.background =
              'linear-gradient(90deg, color-mix(in srgb, var(--hit-akashi) 30%, transparent), transparent 65%)'
            rf.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: T.flagFlash, easing: 'ease-out' })
          }
          const repairShip = mg.ships[Number(repairShipRow.dataset.ship)]
          const eqIcons = repairShipRow.querySelectorAll<HTMLElement>('.eq > *')
          let pulseIndex = 0
          repairShip?.slot.forEach((slotId, slotIdx) => {
            if (slotId <= 0 || mg.slotitems[slotId]?.mstId !== REPAIR_FACILITY_MST_ID) return
            const icon = eqIcons[slotIdx]
            if (!icon) return
            icon.animate(
              [
                { filter: 'brightness(1)', transform: 'scale(1)' },
                { filter: 'brightness(1.45)', transform: 'scale(1.12)', offset: 0.4 },
                { filter: 'brightness(1)', transform: 'scale(1)' },
              ],
              { duration: T.iconPulse, delay: pulseIndex++ * T.iconStep, easing: 'ease-out' },
            )
          })
        }
      }
      const bead = document.createElement('span')
      bead.className = 'berth-bead'
      row.appendChild(bead)
      bead
        .animate(
          [
            { opacity: 0, transform: 'translateY(-4px) scale(0.5)' },
            { opacity: 1, transform: 'translateY(4px) scale(1.1)', offset: 0.35 },
            { opacity: 0, transform: 'translateY(18px) scale(0.4)' },
          ],
          { duration: T.bead, delay: T.beadAt, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' },
        )
        .onfinish = () => bead.remove()

      animateRowBars(row, { hp: [prevPct, nextPct] }, { delay: T.barAt, duration: T.rise })
      if (healedCrack && prevSvg) {
        const gh = row.querySelector<HTMLElement>('.glass-host')
        if (gh) {
          gh.innerHTML = prevSvg
          gh
            .animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: T.crackHeal, delay: T.barAt, easing: 'ease-out', fill: 'both' })
            .onfinish = () => {
              gh.innerHTML = ''
            }
        }
      }
      if (sweep) {
        sweep.style.background =
          'linear-gradient(90deg, transparent, color-mix(in srgb, var(--hit-akashi) 42%, transparent) 50%, transparent)'
        sweep.animate(
          [
            { opacity: 0.9, transform: 'translateX(-85%) skewX(-18deg)' },
            { opacity: 0, transform: 'translateX(115%) skewX(-18deg)' },
          ],
          { duration: T.sweep, delay: T.barAt, easing: 'cubic-bezier(.2,.7,.3,1)' },
        )
      }
      const gain = Math.max(1, Math.round(event.after - event.before))
      spawnRowMotes(row, event.after >= event.max ? 8 : 5, 'var(--hit-akashi)', false, T.popAt)
      spawnRowPop(row, `+${gain} 泊修`, 'var(--hit-akashi)', T.popAt)
    }
  }
}

// ---- デッキビルダー v4 互通（审计 C5）----
//
// 支持这个社区事实标准，编成就能和制空権シミュレータ、作戦室(Jervis) 之类互通。
// 编解码在 shared/deck-builder.ts，那边有对着上游示例逐字核过的红绿样本。
//
// **导入只能看，不能用**。kuma不替你操作游戏，所以粘进来的编成是拿去对照的：
// 这套里的舰你有没有、装备齐不齐——编成本身仍然得你自己在游戏里摆。

const deckIo = {
  open: false,
  scope: 'current' as 'current' | 'all',
  text: '',
  parsed: null as ReturnType<typeof parseDeckBuilder> | null,
  flash: '',
}

const currentDeckBuilderDeck = (deck: Deck | null): DeckBuilderDeck => {
  const itemOf = (slotId: number) => {
    const inst = slotId > 0 ? mg.slotitems[slotId] : undefined
    if (!inst) return null
    return { mstId: inst.mstId, rf: inst.level, ...(inst.alv > 0 ? { mas: inst.alv } : {}) }
  }
  const shipOf = (rosterId: number) => {
    const ship = rosterId > 0 ? mg.ships[rosterId] : undefined
    if (!ship) return null
    return {
      mstId: ship.shipId,
      lv: ship.lv,
      luck: ship.lucky,
      slots: ship.slot.map(itemOf),
      exSlot: itemOf(ship.slotEx),
    }
  }
  const wanted =
    deckIo.scope === 'all' || !deck ? mg.decks.filter((d) => d.id >= 1 && d.id <= 4) : [deck]
  const fleets: DeckBuilderDeck['fleets'] = [null, null, null, null]
  for (const entry of wanted) {
    const ships = entry.ships.map(shipOf)
    if (ships.some(Boolean)) fleets[entry.id - 1] = { ships }
  }
  return { hqLv: mg.basic?.level ?? 0, fleets }
}

// 导入结果里一行舰：名字 + 我有没有这一形态 + 装备清单
const importedShipHtml = (ship: NonNullable<DeckBuilderDeck['fleets'][number]>['ships'][number]) => {
  if (!ship) return ''
  const name = masterShipName(ship.mstId)
  const owned = Object.values(mg.ships).some((s) => s.shipId === ship.mstId)
  // 增设排在常规格之后，位置随常规格数走——写死 4 的话，五格舰（大和改二）
  // 的第 5 格会被标成「增」，真正的增设反而没了编号
  const equips = [...ship.slots, ship.exSlot]
    .flatMap((item, index) => {
      if (!item) return []
      const mst = mg.master.slotitems[item.mstId]
      const label = entityNamePlain('equip', item.mstId, mst?.name ?? `装备 ${item.mstId}`)
      const have = Object.values(mg.slotitems).some((inst) => inst.mstId === item.mstId)
      return [
        `<span class="dbio-eq${have ? '' : ' miss'}" title="${have ? '当前持有' : '当前未持有'}">${
          index === ship.slots.length ? '增' : index + 1
        } ${esc(label)}${item.rf > 0 ? ` ★+${item.rf}` : ''}${item.mas ? ` 熟${item.mas}` : ''}</span>`,
      ]
    })
    .join('')
  return `<div class="dbio-ship${owned ? '' : ' miss'}">
    <span class="dbio-name">${entityNameHtml('ship', ship.mstId, name, { compact: true })}
      <i>Lv${ship.lv}${ship.luck >= 0 ? ` · 运${ship.luck}` : ''}</i></span>
    <span class="dbio-own">${owned ? '已持有 ✓' : '未持有该形态'}</span>
    <span class="dbio-eqs">${equips || '<span class="dbio-eq empty">无装备</span>'}</span>
  </div>`
}

const importedDeckHtml = (result: ReturnType<typeof parseDeckBuilder>) => {
  if (result.error) return `<div class="dbio-err">读取失败 · 请检查内容：${esc(result.error)}</div>`
  const deck = result.deck!
  const warn = result.warnings.length
    ? `<div class="dbio-warn">${result.warnings.map((w) => esc(w)).join('<br>')}</div>`
    : ''
  const fleets = deck.fleets
    .map((fleet, index) =>
      fleet
        ? `<div class="dbio-fleet"><div class="dbio-fleet-h">第${index + 1}舰队</div>
            ${fleet.ships.map(importedShipHtml).join('')}</div>`
        : '',
    )
    .join('')
  return `${warn}<div class="dbio-imported">
    <div class="dbio-meta">司令部 Lv${deck.hqLv || '—'}</div>${fleets}</div>
    <div class="dbio-note">「已持有 ✓」按形态比对 · 改造前后分别计算</div>`
}

// 对话框写盘走 csv-export 的共用收口（与鉴的列表、仓库同一份）；
// 反馈仍是这条 deckIo.flash，文案不变。
const saveDeckBuilderFile = async (deck: DeckBuilderDeck) => {
  const outcome = await saveTextFile(
    {
      title: '导出编成（デッキビルダー v4）',
      defaultPath: stampedFileName('kuma-deck', 'json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      logLabel: '编成存为文件',
    },
    deckBuilderJson(deck),
  )
  // 用户自己取消不算失败：不改 flash，也不重渲染（保持原行为）
  if (outcome.status === 'canceled') return
  // 只读权限、盘满、路径被占……写文件真会失败。默默什么都不发生的话，
  // 玩家只会以为自己没点中（对照上面「复制 JSON」失败时的 flash）。
  deckIo.flash =
    outcome.status === 'failed' ? '存文件失败 · 可使用「复制 JSON」' : '已存为文件 ✓'
  deferPassive(pane, 'ru', render)
}

const deckIoHtml = (deck: Deck | null): string => {
  if (!deckIo.open) {
    return ''
  }
  const scopeChip = (key: 'current' | 'all', label: string) =>
    `<span class="dbio-chip${deckIo.scope === key ? ' on' : ''}" data-dbio-scope="${key}">${label}</span>`
  return `<div class="dbio-panel">
    <div class="dbio-h"><b>编成互通</b><span class="aux">デッキビルダー v4 · 与制空権シミュレータ、作戦室等通用</span>
      <span class="dbio-toggle" data-dbio="close">收起</span></div>
    <div class="dbio-row">
      <span class="dbio-k">导出</span>
      ${scopeChip('current', deck ? `第${deck.id}舰队` : '本队')}${scopeChip('all', '全部四队')}
      <span class="dbio-lk" data-dbio="copy-json">复制 JSON</span>
      <span class="dbio-lk" data-dbio="copy-url">复制载入链接</span>
      <span class="dbio-lk" data-dbio="save">存为文件</span>
      ${deckIo.flash ? `<span class="dbio-flash">${esc(deckIo.flash)}</span>` : ''}
    </div>
    <div class="dbio-row">
      <span class="dbio-k">导入</span>
      <span class="dbio-lk" data-dbio="parse">读取</span>
      <span class="dbio-lk" data-dbio="clear">清空</span>
    </div>
    <textarea class="dbio-input" data-dbio-input placeholder="粘贴 v4 编成 JSON，或整条 deckbuilder 载入链接">${esc(deckIo.text)}</textarea>
    ${deckIo.parsed ? importedDeckHtml(deckIo.parsed) : ''}
  </div>`
}

// 舰队面板通用交互，分两半：
//   wireFleetPanel —— 绑在**每次渲染新建的子节点**上（.ftabs/搜索框/.ships），
//     随 innerHTML 一起生灭，每次渲染后都要重跑；
//   bindFleetPanelDelegates —— 绑在**常驻 pane** 上的委托，只许 mount 时挂一次。
//     从前它们也塞在 wireFleetPanel 里、每次渲染都叠一份：挂机几小时后点一次
//     「存为文件」会连弹 N 个对话框，点沙盘「×」触发 N 次全量重绘（还越叠越多）。
const wireFleetPanel = (
  root: HTMLElement,
  setActive: (id: number) => void,
  rerender: () => void,
) => {
  root.querySelector('.ftabs')?.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.ftab')
    if (!tab) return
    setActive(parseInt(tab.dataset.deck!, 10))
    rerender()
  })

  const sandboxSearch = root.querySelector<HTMLInputElement>('#ru-sandbox-search')
  // 走 onFilterInput 而不是裸 input：重渲会把输入框元素整个换掉，
  // 输入法的组合会话绑在那个元素上，换一次就断（见 kernel 第三道闸门）
  if (sandboxSearch) {
    onFilterInput(sandboxSearch, () => {
      sandboxPick = sandboxSearch.value
      rerender()
      // withViewStateKept 已恢复焦点与**精确选区**；这里只兜底焦点，
      // 不再强拉光标到末尾——那会把中途改字的光标位置踩掉（钦同款写法）
      root.querySelector<HTMLInputElement>('#ru-sandbox-search')?.focus()
    })
  }

  root.querySelector('.ships')?.addEventListener('click', (e) => {
    // 点在 EntityLink 上 → 交给链路由（跳图鉴），不触发行展开
    if ((e.target as HTMLElement).closest('.el')) return
    // 沙盘的「移出」按钮长在行里，点它不该顺手把这一行展开
    if ((e.target as HTMLElement).closest('[data-sandbox-remove]')) return
    const row = (e.target as HTMLElement).closest<HTMLElement>('.ship')
    if (!row) return
    const id = parseInt(row.dataset.ship!, 10)
    if (expanded.has(id)) {
      expanded.delete(id)
    } else {
      expanded.add(id)
      // 折叠时渲染的是空容器（见 shipDetailHtml）；展开这一下同步补内容，
      // 赶在 .open 的 max-height 过渡开始之前，所以看不到空框
      fillShipDetail(row, id)
    }
    row.classList.toggle('open')
  })
}

const bindFleetPanelDelegates = (
  root: HTMLElement,
  setActive: (id: number) => void,
  rerender: () => void,
) => {
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act="air-base-mute"]')
    if (!button) return
    mutedAreas = uiGet<number[]>(AIR_BASE_MUTE_KEY, [])
    mutedAreas = toggleAirBaseAreaMute(mutedAreas, Number(button.dataset.areaId))
    uiSet(AIR_BASE_MUTE_KEY, mutedAreas)
    rerender()
  })
  root.addEventListener('contextmenu', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.metrics[data-mrow]')
    const rowId = metricRowIdOf(row?.dataset.mrow)
    if (!row || !rowId) return
    event.preventDefault()
    hideMetricsFoldCard()
    showMetricsMenu(rowId, event.clientX, event.clientY)
  })

  // 沙盘：加人 / 移人 / 清空。都只动本地状态，绝不写回游戏。
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const add = target.closest<HTMLElement>('[data-sandbox-add]')
    if (add) {
      if (sandboxAdd(parseInt(add.dataset.sandboxAdd!, 10))) rerender()
      return
    }
    const remove = target.closest<HTMLElement>('[data-sandbox-remove]')
    if (remove) {
      sandboxRemove(parseInt(remove.dataset.sandboxRemove!, 10))
      rerender()
      return
    }
    if (target.closest('[data-sandbox-clear]')) {
      sandboxClear()
      rerender()
    }
  })

  // 札的挂牌 → 切到铎：按札分组的完整名单在那儿，这里不重复列
  root.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-sally-jump]')) return
    activateModule('du')
  })
  // 后台数据没读上来时的重试（失败标在页脚，见 loadFailHtml）
  root.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-ru-retry]')) return
    retryFailedLoads()
  })
  // 编成互通：导出走剪贴板/文件，导入只解析不落地
  root.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-dbio-input]')
    if (input) deckIo.text = input.value
  })
  root.addEventListener('click', (e) => {
    const scope = (e.target as HTMLElement).closest<HTMLElement>('[data-dbio-scope]')
    if (scope) {
      deckIo.scope = scope.dataset.dbioScope as 'current' | 'all'
      deckIo.flash = ''
      rerender()
      return
    }
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-dbio]')?.dataset.dbio
    if (!act) return
    const deck = mg.decks.find((d) => d.id === activeFleetId) ?? null
    if (act === 'open' || act === 'close') {
      deckIo.open = act === 'open'
      deckIo.flash = ''
    } else if (act === 'copy-json' || act === 'copy-url') {
      const payload =
        act === 'copy-json'
          ? deckBuilderJson(currentDeckBuilderDeck(deck))
          : deckBuilderUrl(currentDeckBuilderDeck(deck))
      void navigator.clipboard
        .writeText(payload)
        .then(() => {
          deckIo.flash = act === 'copy-json' ? '已复制 JSON ✓' : '已复制链接 ✓'
          deferPassive(root, 'ru:deckio', rerender)
        })
        .catch(() => {
          deckIo.flash = '复制失败 · 可使用「存为文件」'
          deferPassive(root, 'ru:deckio', rerender)
        })
      return
    } else if (act === 'save') {
      void saveDeckBuilderFile(currentDeckBuilderDeck(deck))
      return
    } else if (act === 'parse') {
      deckIo.parsed = parseDeckBuilder(deckIo.text)
    } else if (act === 'clear') {
      deckIo.text = ''
      deckIo.parsed = null
    }
    rerender()
  })
}

const focusFleet = (id: number) => {
  activeFleetId = mg.combinedFlag > 0 && id === 2 ? 1 : id
  activateModule('ru')
  render()
}

const focusFleetShip = (rosterId: number) => {
  const deck = mg.decks.find((entry) => entry.ships.includes(rosterId))
  if (!deck) return
  activeFleetId = inCombined(deck) ? 1 : deck.id
  expanded.add(rosterId)
  activateModule('ru')
  render()
  requestAnimationFrame(() => {
    pane?.querySelector<HTMLElement>(`.ship[data-ship="${rosterId}"]`)?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  })
}

registerEntityRoute('fleet', {
  mod: 'ru',
  colorClass: 'e-fleet',
  open(ref) {
    const id = ref.num
    // 0 = 基地航空队页，与 fleetTabsHtml 的 data-deck 同一套编号。
    // 出击前检查的陆航提醒要能落到这里，否则那条通知点了没反应。
    if (id === AIR_BASE_TAB_ID || mg.decks.some((deck) => deck.id === id)) focusFleet(id)
  },
  peek(ref) {
    const id = ref.num
    const deck = mg.decks.find((entry) => entry.id === id)
    if (!deck) return null
    const { canonical, custom } = fleetLabel(deck)
    const ships = fleetShips(deck)
    const onExpedition = deck.mission?.[0] > 0
    // 联合第 2 舰队与自己出击的队先判，再看远征位与待命态；
    // 顶栏那枚芯片刚说她在出击，两处不能对不上。
    const escort = combinedEscortState(id)
    const onSortie = deckOnSortie(id)
    return {
      title: custom ? `${canonical}「${custom}」` : canonical,
      typeLabel: '舰队',
      lines: [
        escort
          ? escort === 'sortie'
            ? `${ships.length} 位随联合舰队出击中`
            : `${ships.length} 位已编入联合舰队`
          : onSortie
            ? `${ships.length} 位出击中`
          : onExpedition
            ? deck.mission[2] <= Date.now()
              ? `${expeditionLabel(deck.mission[1], mg.master.missions)} 即将返港`
              : `${expeditionLabel(deck.mission[1], mg.master.missions)} 执行中 · ${fmtCountdownShort(deck.mission[2])} 后返港`
            : `${ships.length} 位待命`,
        `闪光 ${ships.filter((ship) => ship.cond >= 50).length}/${ships.length}`,
      ],
      primary: '编队展示',
    }
  },
  targets(ref) {
    const id = ref.num
    const deck = mg.decks.find((entry) => entry.id === id)
    const missionId = deck?.mission?.[1] ?? 0
    return [
      { label: '编队展示 · 状态与检查', run: () => focusFleet(id) },
      missionId > 0
        ? {
            label: `远征规划 · ${expeditionLabel(missionId, mg.master.missions)} 执行中`,
            mod: 'bi',
            run: () => navigate({ type: 'expedition', id: missionId }),
          }
        : { label: '远征规划', disabled: true, hint: '此队未在远征' },
    ]
  },
})

registerEntityRoute('fleetShip', {
  mod: 'ru',
  colorClass: 'e-ship',
  open(ref) {
    focusFleetShip(ref.num)
  },
  peek(ref) {
    const rosterId = ref.num
    const deck = mg.decks.find((entry) => entry.ships.includes(rosterId))
    const ship = mg.ships[rosterId]
    if (!deck || !ship) return null
    return {
      title: entityNamePlain('ship', ship.shipId, masterShipName(ship.shipId)),
      typeLabel: `${fleetLabel(deck).canonical} · 现有舰娘`,
      lines: [`Lv ${ship.lv} · 士气 ${ship.cond}`, `位置 ${deck.ships.indexOf(rosterId) + 1}`],
      primary: '在编队中定位',
    }
  },
})

// ---- 后台数据装载 ----

/** 展开区的「下一改装」：图纸需求走 kcwiki 包，图纸库存按名字定位 useitem */
const loadKcwikiShips = () => {
  void queryLode('kcwiki-ships')
    .then((lode) => {
      loadFailed.delete('kcwiki')
      if (!lode?.data) return
      kcwikiByMst = new Map()
      for (const entry of Object.values<any>(simplifyKcwikiShipsData(lode.data))) {
        if (entry?.ID) kcwikiByMst.set(entry.ID, entry)
      }
      deferPassive(pane, 'ru', render)
    })
    .catch((error) => noteLoadFailure('kcwiki', error))
}

/** 海区名与 useitem 日文名（后者是图纸库存按名字定位的依据） */
const loadMasterNames = () => {
  void queryMasterRaw()
    .then((raw) => {
      loadFailed.delete('master')
      mapAreaNames = new Map(
        (raw?.data?.api_mst_maparea ?? [])
          .filter((area: any) => Number.isFinite(Number(area?.api_id)))
          .map((area: any) => [Number(area.api_id), `${area.api_name ?? ''}`]),
      )
      useitemNames = new Map(
        (raw?.data?.api_mst_useitem ?? [])
          .filter((u: any) => Number.isFinite(Number(u?.api_id)))
          .map((u: any) => [Number(u.api_id), `${u.api_name ?? ''}`]),
      )
      deferPassive(pane, 'ru', render)
    })
    .catch((error) => noteLoadFailure('master', error))
}

const retryFailedLoads = () => {
  const targets = [...loadFailed]
  loadFailed.clear()
  render()
  for (const kind of targets) {
    if (kind === 'kcwiki') loadKcwikiShips()
    else if (kind === 'master') loadMasterNames()
    else {
      // 手动重试不受冷却限制——是玩家自己点的
      expSamplesRetryAfter = 0
      ensureExpSamples(() => deferPassive(pane, 'ru', () => render(true)))
    }
  }
}

// ---- 总渲染 ----

/**
 * 被动刷新合帧。
 *
 * decks/ships 是全场最高频的补丁（战斗中每个阶段都到），而这一卷整树 innerHTML
 * 重建——一次进点连着重建好几遍，重建本身（图片重解码、整树重排）就看得见。
 * 只合并被动刷新；用户点出来的那些仍旧同步 render，手感不受影响。
 */
let renderScheduled = false
const scheduleRender = () => {
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(() => {
    renderScheduled = false
    if (!pane?.classList.contains('active')) return
    // 用户正按在这块面板上就让到抬起之后（按下与抬起之间换掉 DOM，click 不会发生）；
    // 正在用输入法打字同理，让到组合结束——换掉 DOM 会把组合会话一起换没。
    // 持续滚动时也让到安静窗之后，免得滚动中的 DOM 被替换。
    deferPassive(pane, 'ru', render)
  })
}

const render = (force = false) => {
  if (pane?.dataset.popped === 'true') return
  if (!pane || (!force && !pane.classList.contains('active'))) return
  // 疲劳观测点不在这里记：写入方是铃（lg.ts），它无条件装配、
  // 按 ships 补丁记账，并且用 lastPortTs 而不是 Date.now() 锚定，比这里准。
  // 等级经验表：矿脉包为主，自己手上的舰实测为校（只增不减，跨会话累积）
  ensureLevelExpLode(() => deferPassive(pane, 'ru', () => render(true)))
  ensureExpSamples(() => deferPassive(pane, 'ru', () => render(true)))
  observeLevelExp()
  if (!mg.decks.length) {
    forgetCommittedHtml(pane, 'ru') // 这一支绕开 commitPaneHtml，记忆不能留着
    pane.innerHTML = `<div class="pane-waiting">
      尚未同步编队数据 · 登录并返港一次</div>`
    return
  }
  if (mg.combinedFlag > 0 && activeFleetId === 2) activeFleetId = 1
  if (
    activeFleetId !== AIR_BASE_TAB_ID &&
    activeFleetId !== SANDBOX_TAB_ID &&
    activeFleetId !== BERTH_TAB_ID &&
    !mg.decks.some((d) => d.id === activeFleetId)
  ) {
    activeFleetId = mg.decks[0].id
  }
  const airBaseActive = activeFleetId === AIR_BASE_TAB_ID
  const sandboxActive = activeFleetId === SANDBOX_TAB_ID
  const berthActive = activeFleetId === BERTH_TAB_ID
  const deck = sandboxActive
    ? sandboxDeck()
    : airBaseActive || berthActive
      ? null
      : mg.decks.find((d) => d.id === activeFleetId)!

  measureFleetRowSize()
  if (deck && !sandboxActive) observeFleetHits(deck)
  else {
    activeHits.clear()
    repairWashUntil.clear()
    pendingHitFx.clear()
    pendingRepairFx.clear()
    berthFxFlagIds.clear()
    berthFxRepairIds.clear()
    clearBerthFade()
  }

  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const html = `<div class="ru-app">
      <div class="main">
        <div class="ftabs">${fleetTabsHtml(activeFleetId)}</div>
        ${airBaseActive ? airBaseHeaderHtml() : berthActive ? berthHeaderHtml() : sandboxActive ? sandboxHeaderHtml(deck!) : fleetHeaderHtml(deck!)}
        <div class="fleet-body">${
          airBaseActive
            ? airBaseViewHtml()
            : berthActive
              ? berthViewHtml()
              : (sandboxActive ? sandboxPickerHtml() : '') + fleetViewHtml(deck!)
        }</div>
        ${airBaseActive || sandboxActive || berthActive ? '' : deckIoHtml(deck)}
        <div class="foot"><span>${
          // 泊地修理排在前面判：它与沙盘互斥，这样写让沙盘那一句保持原样
          berthActive ? '本地预估' : sandboxActive ? '本地推演' : '与游戏状态实时同步'
        }${loadFailHtml()}</span><span>${
          airBaseActive
            ? '陆航数据在游戏打开出击海域选择页后更新'
            : sandboxActive
              ? '装备与改修取当前状态'
              : ''
        }</span>${
          airBaseActive || sandboxActive || berthActive || deckIo.open
            ? ''
            : '<span class="dbio-toggle" data-dbio="open" style="margin-left:auto">⇄ 编成互通（デッキビルダー v4）</span>'
        }</div>
      </div>
    </div>`
  // 修理演出自己会拨血条：这一拍要播演出的舰与演出还没播完的舰，平滑过渡让开
  const barsBusy = new Set<number>(pendingRepairFx.keys())
  const barsNow = Date.now()
  for (const [id, until] of repairWashUntil) if (until > barsNow) barsBusy.add(id)
  // 没换 DOM 就不能重绑，也不必重新测量收纳：DOM 还是上一帧那份
  if (!commitPaneHtml(pane, 'ru', html)) return
  // 在渠行的维修进度在 HTML 里只画到 10%，换完 DOM 当场就地补到 1%（见 DOCK_RENDER_STEP）
  if (hitShakeEnabled()) refreshDockProgress(pane)
  easeFleetBars(pane, airBaseActive || berthActive || sandboxActive ? '' : `fleet:${activeFleetId}`, barsBusy)

  // 只绑每次渲染新建的子节点；pane 级委托在 mount 里挂过一次，别再叠
  wireFleetPanel(pane, (id) => (activeFleetId = id), render)
  // 度量收纳必须赶在这一帧画出去之前定下来（同步测量 + 同步套用），
  // 丢进 rAF 的话会先看见换行、下一帧才收起——那一下就是闪跳。
  foldMetrics(pane)
  foldProcRates(pane)
  refreshMetricsFoldCard()
  if (hitShakeEnabled()) runPostRenderHitFx(pane)
}

const tickTimers = () => {
  if (!pane || !pane.classList.contains('active')) return
  updateCountdowns(pane)
  const now = Date.now()
  pane.querySelectorAll<HTMLElement>('[data-repair-title]').forEach((el) => {
    el.title = repairClockText(Number(el.dataset.repairTitle), now)
  })
  pane.querySelectorAll<HTMLElement>('[data-repair-latest]').forEach((el) => {
    const completeTime = Number(el.dataset.repairLatest)
    el.textContent = completeTime <= now ? repairClockText(completeTime, now) : `最晚 ${fmtReturnClock(completeTime, now)} 修好`
  })
  // 到点翻面的那一趟。默认词是裁决框的「全员已就绪」；抬头那格问的是另一件事
  // （士气回没回满），所以按 data-cds-done 的同族做法，让挂牌自己带走终态词。
  pane.querySelectorAll<HTMLElement>('[data-ready-ts]').forEach((label) => {
    if (Number(label.dataset.readyTs) <= Date.now()) {
      label.textContent = label.dataset.readyDone ?? '全员已就绪'
    }
  })
  // 在渠舰的维修进度（编队被弹与特色入渠，实验性）：跨过整百分点才就地改那一行
  if (hitShakeEnabled()) refreshDockProgress(pane)
  const minute = Math.floor(Date.now() / 60000)
  if (
    minute !== lastFatigueRenderMinute &&
    Object.values(mg.ships).some((ship) => ship.cond < FATIGUE_READY_COND)
  ) {
    lastFatigueRenderMinute = minute
    scheduleRender()
  }
  // 泊地修理页的「停泊 N 分」与估算回复量都是**分钟级**文本，跟上面的疲劳同一套做法：
  // 每分钟推一次重渲，**不做秒级刷新**。分钟级文本让输出逐字节闸门命中率变低，
  // 那是已知且可接受的一面（与锱的「同步于」同族）。
  // 只在这一页真摆着、且真有队在计时的时候推——别的页签上这些字根本不存在。
  if (
    activeFleetId === BERTH_TAB_ID &&
    minute !== lastBerthRenderMinute &&
    mg.decks.some(
      (deck) =>
        deck.id >= 1 &&
        deck.id <= 4 &&
        ((berthFlagshipOf(deck) && mg.berthSince[deck.id]) ||
          (provisionShipOf(deck) && provisionSinceOf(deck) !== null)),
    )
  ) {
    lastBerthRenderMinute = minute
    scheduleRender()
  }
}
let lastFatigueRenderMinute = -1
let lastBerthRenderMinute = -1

registerModule({
  id: 'ru',
  title: '编队',
  order: 2,
  mount(el) {
    pane = el
    for (const key of ['ru.sandbox', 'ship.personal.v1', 'kuma.fleetStateTone', 'kuma.hitShake']) onUiPreferenceChange(key, scheduleRender)
    pane.classList.add('fleet-skin')
    if (!los33TipRegistered) {
      registerTipBody('los33', los33TipBodyHtml)
      los33TipRegistered = true
    }
    // pane 级事件委托只在这里挂一次（渲染循环里挂会随渲染次数无限叠加）
    bindFleetPanelDelegates(pane, (id) => (activeFleetId = id), render)
    // 「打开了哪张海域」由主进程从静态资源请求里认出来（见 kcs-resource）。
    // 札看活动区、陆航看该区驻没驻中队,都以「摊开的具体海区」为准,
    // 所以挂在这里而不是出击海域选择页。
    const broadcaster = require('@electron/remote').require('./game-api-broadcaster')
    const onMapOpen = (event: { areaId: number; ts: number }) => {
      const changed = lastOpenedMapArea !== event.areaId
      lastOpenedMapArea = event.areaId
      // 陆航页签不吃这个信号（它直接跟随 airBases）；这里只驱动一次性 toast，
      // 换区时重画一次保 toast 前后界面一致
      // 2026-09-08 更正：札的选图页判定也读更新后的区号，换区重画会同步札标签。
      warnOnEventMapOpen(event.areaId, event.ts)
      if (changed) deferPassive(pane, 'ru', render)
    }
    broadcaster.addListener('kancolle.map.open', onMapOpen)
    // 这条监听住在**主进程**，装配失败重试时不退掉就永远留在那边：
    // 一次开图会响两遍（toast 也弹两遍），且旧闭包指着已经废弃的 pane。
    trackMountCleanup(() => broadcaster.removeListener('kancolle.map.open', onMapOpen))
    loadKcwikiShips()
    loadMasterNames()
    // 札提示里的攻略页地址现取自海域情报目录（eventGuideUrl）。别指望别的模块
    // 先把它装上——鉴/镝/铎没进坞的布局下那份目录就是空的，链接会静默消失。
    // initMapIntel 自带 initPromise 去重，重复调用是幂等的。
    void initMapIntel().then(() => {
      if (pane?.isConnected) deferPassive(pane, 'ru', render)
    })
    // 成长三维的端点包：编队详情的蓝字加成里那三项靠它出行（拉不到就只出四项）
    ensureShipStatsLode(() => {
      if (pane?.isConnected) deferPassive(pane, 'ru', render)
    })
    initMetricsFoldCard()
    const paneResize = new ResizeObserver(() => {
      pane.classList.toggle('narrow', pane.clientWidth < 700)
      // 坞一宽窄，度量行能放几枚就变了——重量一次（同宽走缓存，不白算）。
      // 面板从隐藏到显示也走这里：那一刻 render 时行宽还是 0，收纳压根没算过。
      foldMetrics(pane)
      // 展开着的行里那排发动概率同理：坞一变窄，平铺态就该缩成一枚
      foldProcRates(pane)
      if (hitShakeEnabled()) {
        const sample = pane.querySelector<HTMLElement>('.ships .ship')
        const w = sample ? Math.round(sample.clientWidth) : 0
        if (w >= 280 && Math.abs(w - cachedRowWidth) >= 2) {
          cachedRowWidth = w
          measureRowLayouts(pane)
          deferPassive(pane, 'ru', render)
        }
      }
    })
    paneResize.observe(pane)
    // 装配作用域退订：重试装配时不断开，旧 observer 会一直对着废弃的 pane 开工
    trackMountCleanup(() => paneResize.disconnect())
    onMgChange((keys) => {
      if (keys.includes('master')) invalidateRemodelOrder()
      // 出击那一刻的海区是确知的，拿它校准「现在摊开哪张图」——
      // 只靠美术请求的话，第二次切回同一个区可能因为已缓存而没有新请求。
      if (keys.includes('sortie')) noteSortieArea()
      // 新账本 mount 时样本为 0：打过仗后放行重查一次，否则「≈ 几场」整个会话缺席。
      // 有样本的沿用启动快照（全量重算解析几百份快照，不值得每场都跑）。
      if (keys.includes('sortie') && expSamplesAsked && !expSamples.length) {
        expSamplesAsked = false
      }
      noteScreenLeft(keys)
      if (keys.some((k) => [
        'decks',
        'ships',
        'ndocks',
        'basic',
        'master',
        'slotitems',
        'useitems',
        'airBases',
        'eventAreas',
        'sortie',
      ].includes(k))) {
        scheduleRender()
      }
      if (keys.some((k) => ['decks', 'ships', 'quests'].includes(k))) scheduleFleetQuestCheck()
    })
    // 哀悼态本身随 sortie 补丁重画；这条只管**开关被翻**的那一下——
    // 那时没有任何补丁到来，不重画就要等到下一次 deck 变化才见效。
    onMourningChange(scheduleRender)
    onQpChange(scheduleFleetQuestCheck)
    onTick(tickTimers)
    scheduleFleetQuestCheck()
    render(true)
  },
  onShow: () => {
    scheduleFleetQuestCheck()
    render()
  },
})
