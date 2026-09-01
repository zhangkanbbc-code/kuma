// 镝 (Di) · 战斗详情——10 稿。航迹条 / 决策条 / 航空战摘要 / 敌我对战区 /
// 战果 strip / 战斗流水 / 右栏（海域实况·战果预测·出击统计·敌编成预报·掉落）。
// 数据纪律：
// - 伤害/HP 全部来自铭的战斗回放（API 实测），非计算预测；
// - 胜败预测 wikiwiki 口径，C/D/E 标「推定」；定论以 battleresult 为准；
// - 敌编成/确认掉落 = 版本化海域情报目录，应用运行时不联网；
// - 海图字母/小地图 = poi fcd 矿脉包（MIT）；
// - 只读面板：阵型/夜战/进退在游戏内操作，这里绝不代打。
import { engagedShips, fleetAirPower } from '../fleet-calc'
import { DAMAGE_TIER_WORDS, damageTierOf } from '../../shared/battle-damage'
import { formationText, optionalFormationText } from '../../shared/enemy-formation'
import { requiredSunkForA } from '../../shared/battle-rank'
import { fcdTopologyUsable } from '../../shared/fcd-topology'
import { DAY_NIGHT_LABEL, battlePhaseOrder, dealtByPhaseOf } from '../../shared/battle-phase-damage'
import { hpAtStage, hpBarSegments, segmentStartOf, shipHpTimeline } from '../../shared/battle-hp-timeline'
import type { ShipHpTimeline } from '../../shared/battle-hp-timeline'
import {
  eventBonusContext,
  eventBonusFleetSummary,
  forecastConfirmedComp,
  forecastDeckScope,
  forecastFleetLabelForDeck,
  forecastPracticeOpponent,
  formationTokensOf,
  landBaseDispatchAt,
  landBaseWavesAt,
  cachedEventBonusLode,
  loadEventBonusLode,
} from '../combat-forecast'
import type { EventBonusContext } from '../combat-forecast'
import { alvIconHtml } from '../alv-icon'
import { setShipThumbTier, shipThumbHtml } from '../entity-art'
import { shipArtDamaged } from '../../shared/ship-art-path'
import { equipTypeIconHtml } from '../equip-icon'
import {
  ensureFirstEncounters,
  firstDropBadgeInSortieHtml,
  firstKillBadgeInSortieHtml,
  onFirstEncountersChange,
  refreshFirstEncounters,
} from '../first-encounter'
import {
  applyPaneHtml,
  esc,
  fleetLabel,
  fmtCountdownShort,
  fmtTime,
  masterShipName,
  mg,
  nextJstTime,
  onMgChange,
  onTick,
  queryBattleSnapshot,
  queryBattleSnapshots,
  queryLode,
  queryRouteStats,
  trackMountCleanup,
  uiGet,
  uiSet,
  updateCountdowns,
  withViewStateKept,
  fmtDate,
  fmtDateTime,
} from '../kernel'
import { elink, elinkHtml, registerEntityRoute } from '../link'
import { entityNameHtml, entityNamePlain, entityTermHtml } from '../localization'
import { initMapIntel } from '../map-intel'
import { activateModule, registerModule } from '../mu'
import {
  buildRemodelStageMap,
  isAdvancedRemodelTarget,
  isFinalRemodelTarget,
  levelingGroups,
  type LevelingOrder,
  type LevelingRow,
} from '../practice-leveling'
import { ensureFavoriteRoots, isFavoriteOwnedShip } from '../ship-personal'
import { progressiveRemodelOf } from '../remodel'
import { isShipFamilyOwned, unownedShipBadgeHtml } from '../ship-ownership'
import { createAbyssalNameIndex, stripAbyssalWikiMarkup } from '../../shared/abyssal-label'
import {
  catalogCompUnseen,
  catalogEncounterTally,
  catalogTallyText,
  compSignature,
  enemyCompIds,
  limitedWindowText,
  limitedWindowsOf,
  localDropEraOf,
  mapDropsInfo,
  mapEnemyCompsInfo,
  mapIntelMap,
  mapIntelNode,
  nodeDropCatalog,
} from '../../shared/map-intel'
import { isEventMapArea, mapCodeOf, mapIdOf } from '../../shared/map-id'
import { sortieHeadingDeg, travelledEdges } from '../../shared/sortie-route'
import {
  practiceBaseExp,
  practiceExpForRank,
  trainingCruiserSetup,
} from '../../shared/practice-exp'
import { cumulativeExpAt, ensureLevelExpLode, expNeededTo } from '../level-exp'
import { branchTallyByLetter } from '../../shared/route-stats'
import type { BranchTally } from '../../shared/route-stats'
import { isAbyssMstId } from '../../shared/kcs-domain'
import { attackEquipmentReliable } from '../../shared/attack-equipment'
import { boldTitle, firstTextTitle, installSectionFolding, leadingTitle } from '../section-fold'

import type { LodeMeta } from '../kernel'
import type {
  AirSpecialAttackView,
  BattleAttack,
  BattleShipView,
  BattleSide,
  BattleSnapshot,
  BattleSnapshotSummary,
  BattleView,
  LocalDropScope,
  PracticeOpponentPreview,
  SortieForecastReport,
  SortieNode,
  SortieView,
} from '../../shared/mg-types'
import { SPECIAL_ATTACK_SEGMENT_ORDER, specialAttackLabel } from '../../shared/fleet-special-attack'
import { fleetWipeStage } from '../../shared/fleet-wipe'
import { flagshipHasDameconIn, isTaihaShip, taihaVerdictOf } from '../../shared/taiha-verdict'
import { enemyNightTargetOf, isPtShipName } from '../../shared/enemy-night-target'
import { aaciEntryOf } from '../../shared/ship-special-attack'
import type { CatalogEncounterTally, EventDifficulty } from '../../shared/map-intel'
import { PERSONAL_RATE_MIN_SAMPLES } from '../../shared/statistics'
import {
  summarizeEncounterForecasts,
} from '../../shared/combat-forecast'
import type { EncounterForecastBand } from '../../shared/combat-forecast'

const { ipcRenderer } = require('electron')

// ---- 词典 ----

// 阵形表 2026-08-25 并入 shared/enemy-formation（汉化清点抓出镝没接中文表：
// 字符串阵形原样上屏，33 种日文写法约 1400 处）。同日晚补完最后一步：
// 镝里所有阵形显示**一律走 formationText 这个规范出口**，不再直接下标 ENEMY_FORMATION
// ——绕开出口的六处对新阵形号会渲成空胶囊（或整枚消失），护栏见
// test/enemy-formation-callers.test.mjs。
const ENGAGEMENT: Record<number, string> = {
  1: '同航战',
  2: '反航战',
  3: 'T字有利',
  4: 'T字不利',
}
const rankLabel = (rank: string, prediction: BattleView['prediction']): string =>
  rank === 'S' && prediction.perfect ? 'S（完全胜利）' : rank

// 结算横幅原本一律写「X 胜负确定」，2026-08-20 用户指出这在中文里既是废话又有歧义——
// 评级本身已经分了阵营，A 就是胜，「负」不该跟着出现。按游戏评级归类：S/A/B 胜、
// C/D/E 败。api_win_rank 缺失时 store 落成 '?'，这种认不出的评级退回中性的「判定确定」，
// 不硬往胜或败里塞（游戏不存在独立 SS 评级，见 mg-types 的 rank 注释）。
const rankOutcomeWord = (rank: string): string => {
  const head = (rank || '').trim().charAt(0).toUpperCase()
  if (head === 'S' || head === 'A' || head === 'B') return '胜确定'
  if (head === 'C' || head === 'D' || head === 'E') return '败确定'
  return '判定确定'
}

// 「只算我方损害率」的节点：我方全程不还手，敌全灭永远不成立，评级只看挨了多少。
// **对潜空袭（subAirRaid）不在这里**：它有我方的先制对潜与炮击，敌方潜艇是真能沉的，
// 胜负判定也照旧按击沉算——wikiwiki「戦闘について」写的是「勝敗判定は後方空母を除いた
// 潜水艦を全滅させればS勝利」，账本那场也是 3 沉 3 → 游戏给 S。
const isDamageOnlyBattle = (battle: BattleView): boolean =>
  battle.kind === 'airraid' || battle.kind === 'baseDefense' || battle.kind === 'radar'

// 「这场走的是不是通常昼战那套流程」。对潜空袭除了战型名之外全跟 day 走——
// wikiwiki「戦闘について」：「戦闘自体は通常戦と同様の順番で進行する」，
// 它只是敌方多一条不可攻击的空母，先制对潜、炮击、追击夜战都照旧。
// 按 kind 逐处写 `=== 'day'` 的话，下一次加档必定漏掉其中一处。
const isDayFlowBattle = (battle: BattleView): boolean =>
  battle.kind === 'day' || battle.kind === 'subAirRaid'

const battleTypeLabel = (battle: BattleView): string => {
  if (battle.practice) return battle.hasNight ? '演习·夜战' : '演习'
  if (battle.kind === 'airbattle') return '航空战'
  if (battle.kind === 'airraid') return '空袭战'
  if (battle.kind === 'baseDefense') return '基地防空'
  if (battle.kind === 'radar') return '长距离雷达射击'
  if (battle.kind === 'nightonly') return '开幕夜战'
  if (battle.kind === 'nightday') return '拂晓战'
  if (battle.kind === 'subAirRaid') return '对潜空袭战'
  return battle.hasNight ? '昼战转夜' : '通常战'
}

const battleForecastLead = (battle: BattleView): string => {
  if (battle.practice) return battle.hasNight ? '演习夜战后' : '演习'
  if (battle.kind === 'day') return battle.hasNight ? '夜战后' : '昼战'
  return battleTypeLabel(battle)
}

const battleUsesEngagement = (battle: BattleView): boolean =>
  !isDamageOnlyBattle(battle) &&
  (battle.stages ?? []).some((stage) =>
    ['openingTorp', 'gun1', 'gun2', 'gun3', 'torp'].includes(stage.phase),
  )

const actualEngagementText = (battle: BattleView): string =>
  battleUsesEngagement(battle) ? (ENGAGEMENT[battle.engagement] ?? '') : ''

const forecastEngagementText = (saiun: boolean): string =>
  saiun
    ? '同航 45% · 反航 40% · T有利 15% · T不利 0%（彩云）'
    : '同航 45% · 反航 30% · T有利 15% · T不利 10%'

const SEIKU: Record<number, string> = {
  0: '制空均衡',
  1: '制空权确保',
  2: '航空优势',
  3: '航空劣势',
  4: '制空权丧失',
}
const DETECTION: Record<number, string> = {
  1: '索敌成功',
  2: '索敌成功·未返航',
  3: '索敌失败·未返航',
  4: '索敌失败',
  5: '无侦察机索敌成功',
  6: '无侦察机索敌失败',
}
const NODE_EVENT: Record<number, string> = {
  2: '资源',
  3: '涡潮',
  4: '通常战',
  5: 'Boss',
  6: '无事',
  7: '航空战',
  8: '护卫成功',
  9: '扬陆',
  10: '空袭',
}
// 战斗点（eventId 4/5）的细分战型 = api_event_kind。账本实测对照：kind 1 = 通常昼战
// （6-5 B/F/I），5 = 敌联合舰队（接 ec_battle，仍是昼战流程），6 = 长距离空袭（接
// ld_airbattle）；2 = 夜战点（进点即接 sp_midnight，全程夜战），3/7 = 拂晓战，
// 4 = 双方航空战，8 = 长距离雷达射击（ld_shooting）。kind 1 不另起名。
const NODE_BATTLE_KIND: Record<number, string> = {
  2: '夜战',
  3: '拂晓战',
  4: '航空战',
  5: '敌联合舰队',
  6: '长距离空袭',
  7: '拂晓战·敌联合',
  8: '长距离雷达射击',
}
// 到点尚未开战时的战型名：光看 eventId 会把 6-5 J 这类夜战点写成「通常战」，
// 玩家会按昼战准备——kind 才是游戏预告的真实交战流程。
const nodeEventName = (n: SortieNode): string => {
  const base = NODE_EVENT[n.eventId] ?? `事件${n.eventId}`
  if (n.eventId !== 4 && n.eventId !== 5) return base
  const kind = NODE_BATTLE_KIND[n.eventKind]
  if (!kind) return base
  return n.eventId === 5 ? `Boss·${kind}` : kind
}
const PHASE_LABEL: Record<BattleAttack['phase'], [string, string]> = {
  lbas: ['基地航空', 'lbas'],
  injection: ['喷气强袭', 'air'],
  air: ['航空战', 'air'],
  air2: ['航空战2', 'air'],
  friendlyAir: ['友军航空', 'friend'],
  support: ['支援', 'sup'],
  openingAsw: ['开幕对潜', 'gun'],
  openingTorp: ['开幕雷', 'tor'],
  gun1: ['炮击战', 'gun'],
  gun2: ['炮击战', 'gun'],
  gun3: ['炮击战', 'gun'],
  torp: ['雷击战', 'tor'],
  night: ['夜战', 'night'],
  friendly: ['友军舰队', 'friend'],
  radar: ['雷达射击', 'radar'],
}
const DAY_CI: Record<number, string> = {
  1: '激光攻击',
  2: '弹着连击',
  3: '主副弹着',
  4: '主电弹着',
  5: '主彻弹着',
  6: '主主弹着',
  7: '战爆联合CI',
}
const NIGHT_CI: Record<number, string> = {
  1: '夜战连击',
  2: '主鱼CI',
  3: '鱼雷CI',
  4: '主主副CI',
  5: '主炮CI',
  6: '夜袭CI',
  7: '主鱼电CI（单击）',
  8: '鱼雷·见张·电探CI（单击）',
  9: '鱼雷·水雷见张CI（单击）',
  10: '鱼雷·桶·水雷见张CI（单击）',
  11: '主鱼电CI（二击）',
  12: '鱼雷·见张·电探CI（二击）',
  13: '鱼雷·水雷见张CI（二击）',
  14: '鱼雷·桶·水雷见张CI（二击）',
}
const ciLabel = (kind: BattleAttack['ciKind'], ci: number | null): string | null => {
  if (ci == null) return null
  const special = specialAttackLabel(ci, kind === 'night' ? 'night' : 'day')
  if (special) return special
  const label = kind === 'night' ? NIGHT_CI[ci] : DAY_CI[ci]
  return label ?? (ci > 0 ? `未收录特殊攻击 #${ci}` : null)
}

// 战斗行内的装备名一律走这一份：短名口径（默认 12 字截断 + 全名进 title）、
// 深海/常规的实体类型判定、链接壳子都在这里。曾经外面还包过一层
// compactEquipmentLink，除了原样转发默认长度什么都不做——两个名字一份实现，
// 迟早有人只改其中一处。
const equipmentLinkHtml = (mstId: number, maxChars: number | null = 12): string => {
  const original = mg.master.slotitems[mstId]?.name ?? `装备 #${mstId}`
  const entityType = isAbyssMstId(mstId) ? 'abyssEquip' : 'equip'
  const linkType = isAbyssMstId(mstId) ? 'abyssEquip' : 'mstEquip'
  const full = entityNamePlain(entityType, mstId, original)
  const chars = [...full]
  const shown =
    maxChars != null && chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : full
  return `<span class="used-equip-link" title="${esc(full)}">${elink(linkType, mstId, shown)}</span>`
}

let usedEquipmentPopover: HTMLElement | null = null
let usedEquipmentAnchor: HTMLElement | null = null
let usedEquipmentHideTimer: ReturnType<typeof setTimeout> | null = null
let usedEquipmentPopoverReady = false

const equipmentIdsFrom = (anchor: HTMLElement): number[] =>
  (anchor.dataset.usedEquipment ?? '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)

const hideUsedEquipmentPopover = () => {
  if (usedEquipmentHideTimer) clearTimeout(usedEquipmentHideTimer)
  usedEquipmentHideTimer = null
  usedEquipmentPopover?.classList.remove('show')
  usedEquipmentAnchor?.setAttribute('aria-expanded', 'false')
  usedEquipmentAnchor = null
}

const scheduleUsedEquipmentPopoverHide = () => {
  if (usedEquipmentHideTimer) clearTimeout(usedEquipmentHideTimer)
  usedEquipmentHideTimer = setTimeout(hideUsedEquipmentPopover, 160)
}

const showUsedEquipmentPopover = (anchor: HTMLElement) => {
  if (!usedEquipmentPopover) return
  const ids = equipmentIdsFrom(anchor)
  if (!ids.length) return
  if (usedEquipmentHideTimer) clearTimeout(usedEquipmentHideTimer)
  usedEquipmentHideTimer = null
  usedEquipmentAnchor?.setAttribute('aria-expanded', 'false')
  usedEquipmentAnchor = anchor
  anchor.setAttribute('aria-expanded', 'true')
  usedEquipmentPopover.innerHTML = `<div class="used-equip-popover-card">
    <b>本次攻击使用</b>
    <div class="used-equip-popover-list">${ids
      .map((id, index) => `<span class="used-equip-popover-item"><i>${index + 1}</i>${equipmentLinkHtml(id, null)}</span>`)
      .join('')}</div>
  </div>`
  usedEquipmentPopover.classList.remove('above')
  usedEquipmentPopover.style.visibility = 'hidden'
  usedEquipmentPopover.classList.add('show')
  const rect = anchor.getBoundingClientRect()
  const width = usedEquipmentPopover.offsetWidth
  const height = usedEquipmentPopover.offsetHeight
  const above = rect.bottom + height > window.innerHeight - 6 && rect.top >= height
  usedEquipmentPopover.classList.toggle('above', above)
  const left = Math.min(
    Math.max(4, rect.right - width),
    Math.max(4, window.innerWidth - width - 4),
  )
  const top = above ? rect.top - height : rect.bottom
  usedEquipmentPopover.style.left = `${left}px`
  usedEquipmentPopover.style.top = `${Math.max(4, top)}px`
  usedEquipmentPopover.style.visibility = ''
}

const initUsedEquipmentPopover = () => {
  if (usedEquipmentPopoverReady) return
  usedEquipmentPopoverReady = true
  usedEquipmentPopover = document.createElement('div')
  usedEquipmentPopover.id = 'di-used-equipment-popover'
  usedEquipmentPopover.setAttribute('role', 'dialog')
  usedEquipmentPopover.setAttribute('aria-label', '本次攻击装备详情')
  document.body.appendChild(usedEquipmentPopover)

  document.addEventListener('mouseover', (event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLElement>('[data-used-equipment]')
    const previous = event.relatedTarget instanceof Node ? event.relatedTarget : null
    if (!anchor || anchor.contains(previous)) return
    showUsedEquipmentPopover(anchor)
  })
  document.addEventListener('mouseout', (event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLElement>('[data-used-equipment]')
    if (!anchor) return
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
    if (next && (anchor.contains(next) || usedEquipmentPopover?.contains(next))) return
    scheduleUsedEquipmentPopoverHide()
  })
  document.addEventListener('focusin', (event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLElement>('[data-used-equipment]')
    if (anchor) showUsedEquipmentPopover(anchor)
  })
  document.addEventListener('focusout', (event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLElement>('[data-used-equipment]')
    if (!anchor) return
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
    if (next && (anchor.contains(next) || usedEquipmentPopover?.contains(next))) return
    scheduleUsedEquipmentPopoverHide()
  })
  usedEquipmentPopover.addEventListener('mouseenter', () => {
    if (usedEquipmentHideTimer) clearTimeout(usedEquipmentHideTimer)
  })
  usedEquipmentPopover.addEventListener('mouseleave', scheduleUsedEquipmentPopoverHide)
  window.addEventListener('resize', hideUsedEquipmentPopover)
  document.addEventListener('scroll', hideUsedEquipmentPopover, true)
}

// ---- fcd 海图（字母/坐标）----

let fcdMap: { meta: LodeMeta; data: any } | null | undefined
// 战斗抬头的海图是否展开（覆盖式，不挤走战斗内容）。
// 只有镝自己的面板有这个开关：浮层要靠 render() 收尾那一步才摆得出来（见 placeSeaPop），
// 嵌入宿主走不到那儿，所以那边整个不给按钮，这份状态也就只有一个主人。
let sortieMapOpen = false
/**
 * 本次渲染的宿主是不是嵌入式（史的复盘抽屉）。
 * 与 adoptBattlePaneState 那组工作寄存器同一套路：渲染入口设一次，块渲染函数读它。
 */
let renderingEmbedded = false
/**
 * 这场有没有真的换过阶段。谁算「两个阶段」交给 battlePhaseOrder 一处说了算
 * （血条与输出列共用），判据在 shared/battle-phase-damage：昼→夜（day + hasNight）
 * 与夜→昼（nightday）都算，而 nightonly 从头到尾都是夜战、不算——
 * 早先这里另立一份「排除 nightday」的判据，把夜转昼这种真两段的挡在外面了。
 */
const phaseOrderOf = (b: BattleView | null) =>
  b ? battlePhaseOrder(b.kind, b.hasNight) : null
let abyssalStatsLode: { meta: LodeMeta; data: any } | null | undefined
const loadFcd = async () => {
  if (fcdMap === undefined) fcdMap = await queryLode('poi-fcd-map')
  return fcdMap
}
const loadAbyssalStats = async () => {
  if (abyssalStatsLode === undefined) abyssalStatsLode = await queryLode('abyssal-stats')
  void loadEventBonusLode() // 活动倍卡与它同期使用，一并预热
  return abyssalStatsLode
}
/** 敌舰面板包的加载代号：未取(undefined)/缺包(null)/某个版本，三态各不相同。 */
const abyssalStatsLodeTag = (): string =>
  abyssalStatsLode === undefined
    ? 'pending'
    : abyssalStatsLode === null
      ? 'absent'
      : `${abyssalStatsLode.meta.id}@${abyssalStatsLode.meta.version}`
// 能动分歧(玩家手选去向)与罗盘分歧在决策上完全两回事——一律写「分歧点」
// 会让玩家白担心被带偏(2026-08-12 用户报出)。判据两层:wikiwiki 航路表该点
// 条件写明「能動分岐」(离线,覆盖未站上去的点);站上去时游戏发 api_select_route
// 是权威实证(节点信息卡另判)。
let routingLode: { meta: LodeMeta; data: any } | null | undefined
const loadRouting = async () => {
  if (routingLode === undefined) routingLode = await queryLode('wikiwiki-routing')
  return routingLode
}
let activeBranchSpots: Set<string> | null = null
const isActiveBranchSpot = (mapKey: string, letter: string): boolean => {
  if (!activeBranchSpots) {
    if (routingLode == null) return false
    const spots = new Set<string>()
    for (const [key, m] of Object.entries<any>(routingLode.data?.maps ?? {})) {
      for (const node of m?.nodes ?? []) {
        if ((node?.routes ?? []).some((r: any) => /能動分岐/.test(`${r?.conditionJp ?? ''}`))) {
          spots.add(`${key}:${node.from}`)
        }
      }
    }
    activeBranchSpots = spots
  }
  return activeBranchSpots.has(`${mapKey}:${letter}`)
}
const branchLabelOf = (s: SortieView, letter: string): string =>
  isActiveBranchSpot(mapKeyOf(s), letter) ? '能动分歧(手选)' : '分歧点'
const mapKeyOf = (s: SortieView) => `${s.mapArea}-${s.mapNo}`
const EVENT_DIFFICULTY_BY_RANK: Record<number, EventDifficulty> = {
  1: '丁',
  2: '丙',
  3: '乙',
  4: '甲',
}
const sortieDifficulty = (s: SortieView): EventDifficulty | undefined =>
  EVENT_DIFFICULTY_BY_RANK[mg.mapGauges[mapIdOf(s.mapArea, s.mapNo)]?.selectedRank ?? 0]
// api_no 即 fcd route 边号；节点字母 = route[api_no][1]（poi 口径）
const cellLetter = (s: SortieView, cell: number): string => {
  const route = fcdMap?.data?.[mapKeyOf(s)]?.route
  return route?.[cell]?.[1] ?? `${cell}`
}

// ---- 分歧实测：这张图上，罗盘实际把你带去过哪几次 ----
//
// 攻略表说的是「满足什么条件会去哪」；固定分歧（50/50 那种）满足与否都一样，
// 只有自己走过的次数能回答「这条路我到底吃到过几回」。账本一直在记
// （chronicle 的 logRoute），这里第一次把它取出来用。
//
// 缓存键带上已走节点数：每进一格账本就多一条，键一变就重取，
// 于是刚走完的那一步立刻算进自己的统计里。
//
// 手上这份属于哪张图也得记着：字母是每张图各自的命名空间，A 点在 2-3 和在 5-4
// 完全无关，新图的统计回来之前照旧应答上一张图的次数，字母通用得根本看不出错——
// 「你走过 5 次」说的其实是别的海域。读取失败标记同理按图，一次失败不该让
// 之后每张图都写「分歧实测读取失败」。
//
// 归属按图键控，而不是「单例 + 换图就整个清掉」：这份状态有两个宿主
// （镝面板与史的抽屉），抽屉里翻旧场次时显示的是另一张图，单例会被对方按
// 「这不是我那张图」清空，两边轮流清、轮流重发 IPC，谁都拿不到自己的统计。
// 各图各存一份就互不干扰；容量 4，超了淘汰最久没被读过的那张图。
interface RouteTallyState {
  tally: Map<string, BranchTally>
  key: string | null
  pending: string | null
  failed: boolean
}
const ROUTE_TALLY_MAX = 4
const routeTallyByMap = new Map<string, RouteTallyState>()

const routeTallyStateOf = (mapKey: string): RouteTallyState => {
  const found = routeTallyByMap.get(mapKey)
  // Map 的插入序就是淘汰序：读一次就挪到末尾，淘汰永远从最久没读的那头走
  if (found) {
    routeTallyByMap.delete(mapKey)
    routeTallyByMap.set(mapKey, found)
    return found
  }
  const fresh: RouteTallyState = { tally: new Map(), key: null, pending: null, failed: false }
  routeTallyByMap.set(mapKey, fresh)
  for (const oldest of routeTallyByMap.keys()) {
    if (routeTallyByMap.size <= ROUTE_TALLY_MAX) break
    routeTallyByMap.delete(oldest)
  }
  return fresh
}

const routeTallyFor = (s: SortieView): RouteTallyState => {
  const mapKey = mapKeyOf(s)
  const state = routeTallyStateOf(mapKey)
  const key = `${mapKey}@${s.nodes.length}`
  if (state.key !== key && state.pending !== key && !s.practice && s.mapArea > 0) {
    state.pending = key
    void queryRouteStats(mapIdOf(s.mapArea, s.mapNo))
      .then((report) => {
        // 回来时这张图的条目可能已被淘汰又重建：落进现在那份就是张冠李戴
        if (routeTallyByMap.get(mapKey) !== state) return
        state.tally = branchTallyByLetter(report.branches, fcdMap?.data?.[mapKey]?.route)
        state.key = key
        state.failed = false
        state.pending = null
        if (diPane) render(diPane)
      })
      .catch((error) => {
        // 读不出来就说读不出来。返回空 Map 会被读成「你还没在这个点分歧过」，
        // 那是把故障说成事实。
        console.warn('[kanso] di: 分歧实测读取失败', error)
        if (routeTallyByMap.get(mapKey) !== state) return
        // 把失败也钉在这个 key 上：否则「失败 → 重渲染 → 同 key 再查 → 再失败」
        // 会滚成 IPC + 全量重绘的风暴。走到下一格（key 变化）自然重试。
        state.key = key
        state.pending = null
        state.failed = true
        if (diPane) render(diPane)
      })
  }
  // 取回之前先给上一次的：分歧提示晚一拍出现，比闪一下空白好
  return state
}

/** 「你走过 5 次 · G 4 / K 1」。没走过就不写这一句——空统计不值一行。 */
const branchTallyText = (state: RouteTallyState, letter: string): string => {
  if (state.failed) return '分歧实测读取失败'
  const entry = state.tally.get(letter)
  if (!entry?.total) return ''
  return `你走过 ${entry.total} 次 · ${entry.to
    .map((step) => `${step.letter} ${step.count}`)
    .join(' / ')}`
}

// 「无事」有两种，玩家关心的差别很大：真的什么都没发生，还是**站在分歧点上**
// （下一步走哪边未定，可能被罗盘带去 Boss 也可能绕开）。
// fcd 的 route 是 { 边id: [起点字母, 终点字母] }，同一起点有多条出边就是分歧点。
const branchTargetsOf = (mapKey: string, letter: string): string[] => {
  const route = fcdMap?.data?.[mapKey]?.route
  if (!route || !letter) return []
  const targets = new Set<string>()
  for (const edge of Object.values(route) as [string | null, string][]) {
    if (Array.isArray(edge) && edge[0] === letter && edge[1]) targets.add(edge[1])
  }
  return [...targets].sort()
}

/** 该点的分歧去向；少于两个去向就不是分歧点，返回空数组。 */
export const spotBranches = (mapKey: string, letter: string): string[] => {
  const targets = branchTargetsOf(mapKey, letter)
  return targets.length >= 2 ? targets : []
}

// ---- 小工具 ----

const hpClass = (ratio: number) => (ratio > 0.75 ? 'g' : ratio > 0.5 ? 'y' : ratio > 0.25 ? 'o' : 'r')
const battleDefeated = (battle: BattleView, ship: BattleShipView): boolean =>
  battle.practice ? ship.defeated === true : ship.sunk
// 演习无真轰沉：HP 底线 1；明确区分“真实剩 1 HP”和“已击破、显示为 1 HP”。
// at：血条跟着流水走时，传「选中那一刻」的血量与沉没状态；不传就是整场结果。
const TIER_COLOR = { heavy: 'var(--bad)', medium: 'var(--warn)', light: 'var(--gold)' } as const
const damageState = (
  ship: BattleShipView,
  practice: boolean,
  at?: { hp: number; sunk: boolean },
): [string, string] | null => {
  // 陆上型（速力 0，与反陆上特效判定同口径）不会「沉」，破损档换整套词
  // ——混乱/损害/损坏/毁。词表与来源注释见 shared/battle-damage。
  const words = DAMAGE_TIER_WORDS[(mg.master.ships[ship.mstId]?.soku ?? 1) === 0 ? 'landBase' : 'ship']
  if (practice && (at ? at.sunk : ship.defeated)) return ['击破', 'var(--enemy)']
  if ((at ? at.sunk : ship.sunk) && !practice) return [words.lost, 'var(--enemy)']
  const tier = damageTierOf(at ? at.hp : ship.hpEnd, ship.hpMax)
  return tier ? [words[tier], TIER_COLOR[tier]] : null
}
// 大破线与铃的通知、出击对账同一份（shared/taiha-verdict）：三处各写一遍就会各自漂移。
const isTaiha = (ship: BattleShipView) => isTaihaShip(ship)

type NightDeck = 1 | 2

interface NightEngagement {
  friendly: NightDeck
  enemy: NightDeck
}

// api_active_deck 是夜战实际接敌舰队的权威值。旧复盘若没有该字段，
// 从夜战攻击目标的稳定索引推断；完全无攻击时才退回联合舰队规则。
const nightEngagementOf = (battle: BattleView): NightEngagement | null => {
  const friendlyCombined = battle.fShips.some((ship) => ship.fleet === 'escort')
  const enemyCombined = battle.eShips.some((ship) => ship.fleet === 'escort')
  if (!battle.hasNight || (!friendlyCombined && !enemyCombined)) return null

  const nightAttacks = battle.attacks.filter(
    (attack) => attack.phase === 'night' || attack.phase === 'friendly',
  )
  const targetedDeck = (targetSide: 0 | 1): NightDeck | null => {
    const attack = nightAttacks.find((item) => {
      const actualTargetSide = item.side === 1 ? 0 : 1
      return actualTargetSide === targetSide && item.hits.length > 0
    })
    if (!attack) return null
    return attack.hits.some((hit) => hit.target >= 6) ? 2 : 1
  }
  const reportedFriendly = battle.activeDeck?.[0]
  const reportedEnemy = battle.activeDeck?.[1]
  const friendly =
    !friendlyCombined
      ? 1
      : reportedFriendly === 1 || reportedFriendly === 2
        ? reportedFriendly
        : targetedDeck(0) ?? 2
  const enemyEscortStillFighting = battle.eShips.some(
    (ship) =>
      ship.fleet === 'escort' &&
      ship.hpEnd > 0 &&
      !battleDefeated(battle, ship) &&
      !ship.escaped,
  )
  const enemy =
    !enemyCombined
      ? 1
      : reportedEnemy === 1 || reportedEnemy === 2
        ? reportedEnemy
        : targetedDeck(1) ?? (enemyEscortStillFighting ? 2 : 1)
  return { friendly, enemy }
}

// 舰名互链：我方 → 实例；深海 → 深海图鉴；演习对手是普通舰娘 → 舰娘图鉴
const shipLink = (ship: BattleShipView) =>
  ship.rosterId != null
    ? elinkHtml('ship', ship.rosterId, entityNameHtml('ship', ship.mstId, ship.name, { compact: true }))
    : ship.mstId >= 1500
      ? elink('abyssShip', ship.mstId, ship.name)
      : ship.mstId > 0
        ? elink('mstShip', ship.mstId, ship.name)
        : esc(ship.name)

const battleShipName = (ship: BattleShipView): string =>
  entityNamePlain(isAbyssMstId(ship.mstId) ? 'abyssShip' : 'ship', ship.mstId, ship.name)

// 结算行这类「单个点名」的舰名给互链（MVP 是谁 → 点开看）；
// 战斗流水逐行不链——那会把整条流水染成实体色，同屏上方的舰队列表已经全链。
const shipLinkAt = (battle: BattleView, side: BattleSide, index: number): string => {
  const ship = shipAt(battle, side, index)
  return ship ? shipLink(ship) : esc(nameAt(battle, side, index))
}

const shipAt = (
  battle: BattleView,
  side: BattleSide,
  index: number,
): BattleShipView | undefined => {
  const list = side === 0 ? battle.fShips : side === 1 ? battle.eShips : (battle.friendShips ?? [])
  return list.find((s) => s.index === index)
}

const nameAt = (battle: BattleView, side: BattleSide, index: number): string => {
  const ship = shipAt(battle, side, index)
  return ship
    ? battleShipName(ship)
    : side === 0
      ? `我${index + 1}`
      : side === 1
        ? `敌${index + 1}`
        : `友军${index + 1}`
}

const expandedConfirmedDrops = new Set<string>()

/**
 * 「你的实测」：本机确认掉落层（当前点）。
 *
 * 与下面的「确认目录」**并列而不合并**（2026-08-22 用户拍板）：目录说的是
 * 「社区确认这一点掉这条船」，这里说的是「我自己在这一点捞到过」。后者更硬，
 * 但只覆盖你真去过的点；合并会让第一方观测冒充社区确认，也会把
 * 「目录没收、我却捞到过」这条最值钱的线索抹平。
 */
const myDropsHtml = (
  s: SortieView,
  cataloged: ReadonlySet<number>,
  mapKey: string,
  letter: string,
): string => {
  const mine = chronFor(s).localDrops
  if (!mine.ships.length) {
    return `<div class="l" style="color:var(--dim);font-size:10.5px">${
      mine.battles
        ? `这一点打过 ${mine.battles} 战，还没捞到过舰娘${
            mine.sWinsWithoutDrop ? `（S 胜 ${mine.sWins} 次里 ${mine.sWinsWithoutDrop} 次空手）` : ''
          }`
        : '当前点暂无你的掉落记录'
    }</div>`
  }
  // ⑤-裁-2（2026-08-22 用户拍板）：限定期结束后**永不删除，只换语境**。
  // 「你在这里捞到过」是永真的历史事实，这一层的措辞本来就是过去式；
  // 要变的是呈现——最近一次捞到的日子落在**已收窗**的窗口里，就挂「窗口已结束」
  // 移到往期，不再混在面向当下的清单里。判据是纯函数 localDropEraOf（可脱 DOM 测）。
  const today = fmtDate(Date.now())
  const graded = mine.ships.map((ship) => ({
    ship,
    era: localDropEraOf(
      limitedWindowsOf(mapKey, ship.mstId, letter).map((one) => one.window),
      fmtDate(ship.lastTs),
      today,
    ),
  }))
  const current = graded.filter((one) => one.era.era === 'current')
  const past = graded.filter((one) => one.era.era === 'past')
  const rowHtml = ({ ship, era }: (typeof graded)[number]) => {
    const name = masterShipName(ship.mstId)
    // 目录没收、自己却捞到过——覆盖薄的图上这是玩家唯一拿得到的线索
    const beyond = !cataloged.has(ship.mstId)
    const closed = era.window
    return `<div class="dp-row${beyond && !closed ? ' new' : ''}">
      ${
        closed
          ? `<span class="dp-star dim" title="${esc(`限定期捞到 · ${limitedWindowText(closed)}`)}">◷</span>`
          : beyond
            ? '<span class="dp-star" title="只有你自己的记录">◆</span>'
            : '<span class="dp-star dim">·</span>'
      }
      <span class="dp-nm">${elink('mstShip', ship.mstId, name)}</span>
      <span class="dp-gate">×${ship.count}</span>
    </div>`
  }
  const shown = current.slice(0, 8)
  const more = current.length - shown.length
  const shownPast = past.slice(0, 4)
  return `<div class="dp-summary">
      <span>${mine.battles} 战 · 捞到 ${mine.ships.length} 种</span>
      ${mine.sWinsWithoutDrop ? `<span class="dp-flag empty">S 胜空手 ${mine.sWinsWithoutDrop}/${mine.sWins}</span>` : ''}
    </div>
    <div class="dp-list">${shown.map(rowHtml).join('')}</div>
    ${more > 0 ? `<div class="l" style="color:var(--dim);font-size:10.5px">还捞到过其余 ${more} 种</div>` : ''}
    ${
      past.length
        ? `<div class="l dp-past-h" style="color:var(--dim);font-size:10.5px">往期 · 限定期捞到 ${past.length} 种（窗口已结束）</div>
          <div class="dp-list dp-past">${shownPast.map(rowHtml).join('')}</div>
          ${past.length > shownPast.length ? `<div class="l" style="color:var(--dim);font-size:10.5px">还有 ${past.length - shownPast.length} 种</div>` : ''}`
        : ''
    }`
}

const confirmedDropPoolCardHtml = (
  mapKey: string,
  letter: string,
  difficulty?: EventDifficulty,
): string | null => {
  const node = nodeDropCatalog(mapKey, letter, undefined, difficulty)
  const map = mapIntelMap(mapKey, difficulty)
  if (!node || !map) return null
  // 「这一点没有掉落资料」与「确认这一点一条都不掉」是两件事，混起来说就是在撒谎。
  // 常规图的掉落全由汇编层供，它没覆盖这张图 = 没人供数据 → 交给调用方说「待更新」。
  // （活动图由底座供，`mapDropsInfo` 返回 null 但 node.ships 非空，走正常分支。）
  if (!node.ships.length && node.emptyDrop !== 'confirmed' && !mapDropsInfo(mapKey)) return null

  const ships = node.ships
    .map((ship) => ({
      ...ship,
      name: masterShipName(ship.id),
      isNew: !isShipFamilyOwned(ship.id),
    }))
    .sort(
      (a, b) =>
        Number(b.isNew) - Number(a.isNew) ||
        Number(!!b.limited) - Number(!!a.limited) ||
        a.id - b.id,
    )
  const key = `${mapKey}:${difficulty ?? '常规'}:${letter}`
  const expanded = expandedConfirmedDrops.has(key)
  const shown = expanded ? ships : ships.slice(0, 8)
  const newCount = ships.filter((ship) => ship.isNew).length
  const limitedCount = ships.filter((ship) => ship.limited).length
  const rows = shown
    .map(
      (ship) => `<div class="dp-row${ship.isNew ? ' new' : ''}">
        ${
          ship.isNew
            ? '<span class="dp-star" title="整条改造链都未持有">⭐</span>'
            : '<span class="dp-star dim">·</span>'
        }
        <span class="dp-nm">${elink('mstShip', ship.id, ship.name)}</span>
        ${
          ship.limited
            ? `<span class="dp-gate limited" title="${esc(
                `${limitedWindowText(ship.limited)} · 最后确认 ${ship.limited.lastConfirmedAt}`,
              )}">限时</span>`
            : ''
        }
      </div>`,
    )
    .join('')
  const more = ships.length - shown.length

  // 掉落这一域 2026-08-22 起由第一方汇编包 map-drops 供，「源」角标要说它自己的
  // 核对日——照读底座的日期，就是拿另一个包的日期给这一段背书。
  const credit = mapDropsInfo(mapKey) ?? map
  return `<div class="dp-summary">
      ${newCount ? `<b>⭐ ${newCount} 舰未持有</b>` : '<span>图鉴链均已持有</span>'}
      ${limitedCount ? `<span class="dp-flag limited">限时掉落 ${limitedCount}</span>` : ''}
      ${
        node.allDifficulty
          ? '<span class="dp-flag alldiff" title="这一点的确认目录不分难度，含全部难度的记录">不分难度</span>'
          : ''
      }
      ${
        node.emptyDrop === 'confirmed'
          ? '<span class="dp-flag empty">◇ 存在空掉落</span>'
          : ''
      }
    </div>
    <div class="dp-list">${rows}</div>
    <div class="l dp-foot">
      <span>${difficulty && !node.allDifficulty ? `${difficulty}难度 · ` : ''}<span class="credit-mark" title="${esc(credit.source)} · 核对 ${esc(credit.checkedAt)}">源</span></span>
      ${
        ships.length > 8
          ? `<span class="tg" data-act="drop-confirmed-expand" data-drop-key="${key}">${
              expanded ? '收起' : `展开其余 ${more} 舰`
            }</span>`
          : ''
      }
    </div>`
}

// 掉落卡与敌方编队卡同一个排法：「你的实测」在前、「确认目录」在后。
// 两段各说各的证据强度，谁都不冒充谁（2026-08-22 用户拍板的并列口径）。
const dropPoolCardHtml = (s: SortieView): string => {
  if (s.practice || s.mapArea <= 0 || s.currentCell <= 0) return ''
  const node = currentNode(s)
  if (node && !BATTLE_EVENTS.has(node.eventId)) return '' // 非战斗点没有掉落池
  const letter = cellLetter(s, s.currentCell)
  const mapKey = mapKeyOf(s)
  const difficulty = sortieDifficulty(s)
  const confirmed = confirmedDropPoolCardHtml(mapKey, letter, difficulty)
  // 与下面那一段共用同一份目录：它回退到合算层时，这里的「目录 ✓」也要跟着回退，
  // 各算一次早晚漂移成「目录里列着、实测那边却不打勾」。
  // （措辞避开那四个字：本段顺序有护栏按源码文本判先后，见 test/map-drops.test.mjs）
  const cataloged = new Set(
    (nodeDropCatalog(mapKey, letter, undefined, difficulty)?.ships ?? []).map((ship) => ship.id),
  )
  return `<div class="scard keep" style="--hc:var(--gold)">
    <div class="h"><b>当前点掉落</b><span class="r">${esc(letter)} 点 · ${
      confirmed ? `已确认 ${cataloged.size} 艘` : '本地资料待更新'
    }</span></div>
    <div class="nav-sec">你的实测</div>
    ${myDropsHtml(s, cataloged, mapKey, letter)}
    <div class="nav-sec">确认目录</div>
    ${
      confirmed ||
      `<div class="l" style="color:var(--dim)">尚未收录 ${esc(mapKey)}${difficulty ? ` ${difficulty}难度` : ''} ${esc(letter)} 点</div>`
    }
  </div>`
}

// 会发生战斗的罗盘事件（4 通常 5 Boss 7 航空战/机动 10 空袭）
const BATTLE_EVENTS = new Set([4, 5, 7, 10])
const currentNode = (s: SortieView) => s.nodes.find((n) => n.cell === s.currentCell)

// ---- 遭遇志（本地反哺，免拉取常显）----

interface ChronState {
  key: string | null
  loading: boolean
  encounters: {
    comp: number[]
    formation: number
    count: number
    lastTs: number
    ranks: Record<string, number>
    drops: number[]
  }[]
  /** 本机确认掉落层（当前点）：与离线目录并列显示，不合并 */
  localDrops: LocalDropScope
  forecast: SortieForecastReport
}
const emptyForecast = (): ChronState['forecast'] => ({
  sortie: { total: 0, wins: 0, saWins: 0, sWins: 0, reached: 0 },
  current: {
    total: 0,
    wins: 0,
    saWins: 0,
    sWins: 0,
    passTotal: 0,
    passed: 0,
    taiha: 0,
    bosses: 0,
  },
  nodes: {},
  preview: null,
})
const emptyLocalDrops = (): LocalDropScope => ({
  battles: 0,
  sWins: 0,
  sWinsWithoutDrop: 0,
  ships: [],
})
const emptyChron = (): ChronState => ({
  key: null,
  loading: false,
  encounters: [],
  localDrops: emptyLocalDrops(),
  forecast: emptyForecast(),
})

// 这份状态有两个宿主：镝面板与史的战斗抽屉。它们可以同时挂着、显示的却是
// 不同海域的不同节点（抽屉里翻旧场次，面板还在实时出击）。单例状态下这两边
// 会互相打翻：A 的样本刚落地就被 B 按「换点了」清掉、loading 又互相挡住对方
// 发请求，于是同一对节点来回重发 IPC，谁都稳不下来。
//
// 改成按 scope（哪张图的哪个点）键控的小缓存：**每个 scope 各自维护**，
// 跨 scope 互不清除。「换点才清」的语义由此变成「换点＝换一条自己的记录」——
// 旧点的样本不再被抹掉，而是随 LRU 自然淘汰（容量 4：两个宿主各自的前后两点）。
const CHRON_MAX = 4
const chronByScope = new Map<string, ChronState>()
// 没有有效 scope（演习/未出击）时给一份只读空态：读取面全部走 chronFor，
// 不该因为「上一个点还留着」而把别处的敌情显示在这里。
const DETACHED_CHRON = emptyChron()

const chronScopeOf = (s: SortieView): string | null =>
  s.practice || s.mapArea <= 0 || s.currentCell <= 0
    ? null
    : `${mapIdOf(s.mapArea, s.mapNo)}:${s.currentCell}`

/** 当前渲染的这个 scope 的那份。没有就现开一条，超容量淘汰最久没读过的。 */
const chronFor = (s: SortieView): ChronState => {
  const scope = chronScopeOf(s)
  if (!scope) return DETACHED_CHRON
  const found = chronByScope.get(scope)
  // Map 的插入序就是淘汰序：读一次就挪到末尾
  if (found) {
    chronByScope.delete(scope)
    chronByScope.set(scope, found)
    return found
  }
  const fresh = emptyChron()
  chronByScope.set(scope, fresh)
  for (const oldest of chronByScope.keys()) {
    if (chronByScope.size <= CHRON_MAX) break
    chronByScope.delete(oldest)
  }
  return fresh
}

// key 掺入战斗计数与结算标志：结算落账后自动重取
const ensureChron = (s: SortieView, rerender: () => void) => {
  const scope = chronScopeOf(s)
  if (!scope) return
  const mapId = mapIdOf(s.mapArea, s.mapNo)
  const difficulty = mg.mapGauges[mapId]?.selectedRank ?? 0
  const eventKey = mg.eventAreas[s.mapArea]?.firstSeenTs ?? 0
  const previewShipIds = currentNode(s)?.enemyPreview?.[0]?.shipIds ?? []
  const key = `${scope}:${difficulty}:${eventKey}:${mg.combinedFlag}:${previewShipIds.join(',')}:${s.battleCount}:${s.battle?.result ? 1 : 0}`
  const chron = chronFor(s)
  if (chron.key === key || chron.loading) return
  // 同一个点内（打完一场、结算落账）只是样本口径变了，旧数据仍然说的是这个点，
  // 留着直到新的到达，右栏就不会先塌成空态再填回来。换到别的点＝换一条记录，
  // 那个点自己的旧样本原地留着，不会被这一格的结果冒充。
  chron.loading = true
  void ipcRenderer.invoke('chron:node', mapId, s.currentCell, {
    difficulty,
    eventKey,
    combinedType: mg.combinedFlag,
    excludeSortieId: s.startTs,
    previewShipIds,
  }).then((res: any) => {
    // 回来时这个 scope 的条目可能已被淘汰又重建：落进现在那份就是张冠李戴
    if (chronByScope.get(scope) !== chron) return
    chron.key = key
    chron.loading = false
    chron.encounters = res?.encounters ?? []
    chron.localDrops = res?.localDrops ?? emptyLocalDrops()
    chron.forecast = res?.forecast ?? emptyForecast()
    rerender()
  }).catch((error: unknown) => {
    if (chronByScope.get(scope) !== chron) return
    chron.key = key
    chron.loading = false
    console.warn('[kanso] 战斗预测样本读取失败', error)
    rerender()
  })
}

// 两条腿说同一种话。此前深海那条走 elink（localizedLinkLabel 兜住了，出中文），
// 友军/演习对手那条走 elinkHtml + entityTermHtml——两个都不翻译，原样出日文舰名。
const enemyName = (mstId: number) => {
  const raw = mg.master.ships[mstId]?.name ?? `#${mstId}`
  return mstId >= 1500
    ? elink('abyssShip', mstId, raw)
    : elink('mstShip', mstId, entityNamePlain('ship', mstId, raw))
}

// ---- 各区块渲染 ----

/**
 * 阵形胶囊的文本。判据与「无值不出、有值必出」的理由在
 * `shared/enemy-formation.ts` 的 `optionalFormationText`（可脱 DOM 真跑，有护栏）。
 *
 * 这里只留一句本地注记：短形化（`.replace(/阵$/, '')`）对兜底文字是安全的
 * ——「阵形15」不以「阵」结尾，原样留住；只有「单纵阵」这类会被削成「单纵」。
 */
const formationPill = optionalFormationText

const trailHtml = (s: SortieView): string => {
  if (s.practice) {
    const formation = s.battle ? formationPill(s.battle.eFormation) : ''
    const shortFormation = formation.replace(/阵$/, '')
    return `<div class="trail"><span class="map">演习</span><span class="sp"></span><span class="gpill">${
      esc(shortFormation)
    }</span></div>`
  }
  const trailMapId = mapIdOf(s.mapArea, s.mapNo)
  const nodes = s.nodes
    .map((n, i) => {
      const letter = cellLetter(s, n.cell)
      const isCur = n.cell === s.currentCell && i === s.nodes.length - 1
      // Boss 判定同 reachedBoss 的口径:eventId 5 权威,字母匹配兜多入边
      const isBoss =
        n.eventId === 5 || (s.bossCell > 0 && letter === cellLetter(s, s.bossCell))
      // 走过的点按遭遇类型分色(2026-08-12 用户提议)。类型全部来自游戏罗盘
      // 事件(eventId/eventKind),不是推测:战斗=done 原绿,夜战紫,空袭/航空战橙,
      // 资源/护卫成功/扬陆金,涡潮青,无事灰,Boss 红。
      const typeCls =
        n.eventId === 10 || n.eventId === 7
          ? 'air'
          : n.eventId === 4 && (n.eventKind === 2 || n.eventKind === 3 || n.eventKind === 7)
            ? 'night'
            : n.eventId === 4 && (n.eventKind === 4 || n.eventKind === 6)
              ? 'air'
              : n.eventId === 2 || n.eventId === 8 || n.eventId === 9
                ? 'gain'
                : n.eventId === 3
                  ? 'whirl'
                  : n.eventId === 6
                    ? 'calm'
                    : ''
      const done = !isCur
      const cls = ['tn', done ? 'done' : 'cur', typeCls, isBoss ? 'boss' : ''].filter(Boolean).join(' ')
      const rank = n.rank ? `<span class="r">${esc(n.rank)}</span>` : ''
      const nodeBranches = spotBranches(mapKeyOf(s), letter)
      // 分歧点上再补一句自己的实测：拓扑说「能去哪」，账本说「实际去过哪几次」
      const tallyText = nodeBranches.length ? branchTallyText(routeTallyFor(s), letter) : ''
      // 走过的战斗点可点回放（2026-08-12 用户提议）：在本地战斗快照里找
      // 「本次出击时间窗内、同图同点」的那一场。上界卡 updatedTs + 5 分钟——
      // 只卡下界的话，回看旧出击时会把同图**后来那次**的快照错认进来。
      const snap = battleHistory.find(
        (entry) =>
          !entry.practice &&
          entry.map === trailMapId &&
          entry.cell === n.cell &&
          entry.ts >= s.startTs &&
          entry.ts <= s.updatedTs + 300000,
      )
      // 正在实时显示的当前点、以及回放中正看着的那一场，不用再点
      const replayable = snap && !(isCur && !replay) && replay?.id !== snap.id ? snap : null
      const title = `${nodeEventName(n)}${n.rank ? ` · ${n.rank}` : ''}${
        nodeBranches.length ? ` · ${branchLabelOf(s, letter)} → ${nodeBranches.join('/')}` : ''
      }${tallyText ? `\n${tallyText}` : ''}${replayable ? '\n单击回顾这一战' : ''}`
      return `<span class="${cls}"${replayable ? ` data-replay-id="${replayable.id}" role="button"` : ''} title="${esc(title)}">${esc(letter)}${rank}</span>`
    })
    .join('<span class="te done"></span>')
  const bossLetter = s.bossCell > 0 ? cellLetter(s, s.bossCell) : null
  // api_bosscell_no 只是通往 Boss 的**某一条**边号;多入边的 Boss 点(6-2 K:
  // bosscell=11,走 J 边到达时 api_no=18)数字直比永远不等,航迹条会在当前点
  // 旁再挂一个幽灵 Boss 尾巴(2026-08-12 用户报出)。按字母比才是「同一个点」。
  const reachedBoss =
    bossLetter != null &&
    s.nodes.some((n) => n.eventId === 5 || cellLetter(s, n.cell) === bossLetter)
  const bossTail =
    bossLetter && !reachedBoss
      ? `<span class="te"></span><span class="tn boss" title="Boss 点（来自 fcd 海图）">${esc(bossLetter)}</span>`
      : ''
  const gauge = mg.mapGauges[mapIdOf(s.mapArea, s.mapNo)]
  let gaugePill = ''
  if (gauge) {
    if (gauge.hpNow != null && gauge.hpMax != null) {
      const pct = Math.max(0, Math.min(100, Math.round((gauge.hpNow / (gauge.hpMax || 1)) * 100)))
      const label = gauge.gaugeType === 3 ? 'TP' : gauge.gaugeType === 2 ? '血条' : '进度'
      const title = gauge.gaugeType === 3 ? '运输 TP 剩余' : gauge.gaugeType === 2 ? 'Boss 血条' : '海域进度'
      gaugePill = `<span class="gpill" title="${title}">${label} <span class="gg"><i style="width:${pct}%"></i></span><b>${gauge.hpNow}/${gauge.hpMax}</b></span>`
    } else if (gauge.required != null && gauge.required > 0) {
      // 游戏口径:击破计数也画成扣血——剩余次数扣到 0/N 击破,不正着数
      // (2026-08-12 用户点名「不是 1/6 到 6/6,是 6/6 到 0/6」)
      const remain = Math.max(0, gauge.required - (gauge.defeated ?? 0))
      gaugePill = `<span class="gpill" title="Boss 击破进度:剩 ${remain} 次,扣到 0 攻略">Boss <span class="gg"><i style="width:${Math.round((remain / gauge.required) * 100)}%"></i></span><b>${remain}/${gauge.required}</b></span>`
    } else if (gauge.cleared) {
      gaugePill = `<span class="gpill" title="海域已攻略">攻略</span>`
    }
  }
  const formation =
    s.battle && s.battle.kind !== 'baseDefense' ? formationPill(s.battle.fFormation) : ''
  const shortFormation = formation.replace(/阵$/, '')
  // 海图浮层由镝自己的 render() 在渲染落定后挂到 body 上（placeSeaPop）；嵌入宿主
  // （史的复盘抽屉）走的是 renderBattleReplayDetail，根本不经过那一步，按钮点了
  // 只会翻一个谁也没读的开关 —— 顺带把镝面板的海图状态也翻掉。嵌入模式索性不给这个钮。
  // 判据与 seaCardHtml 用同一条：空壳也算「有海图」的话，钮挂上去、点开是空白
  const hasSea =
    !renderingEmbedded && !s.practice && fcdTopologyUsable(fcdMap?.data?.[mapKeyOf(s)])
  return `<div class="trail">
    <span class="map">${s.mapArea}-${s.mapNo}${
      hasSea
        ? `<button class="map-peek${sortieMapOpen ? ' on' : ''}" data-sortie-map title="${sortieMapOpen ? '收起海图' : '展开当前海图'}">${sortieMapOpen ? '▴' : '▾'}</button>`
        : ''
    }</span>
    <div class="tnodes">${nodes}${bossTail}</div>
    <span class="sp"></span>
    ${formation ? `<span class="gpill" title="${esc(formation)}">${esc(shortFormation)}</span>` : ''}
    ${gaugePill}
    ${s.active ? '' : '<span class="gpill" title="已归港 · 战斗复盘">复盘</span>'}
  </div>`
}

// 敌联合的夜战交战对象**不是**「二队全灭才放行」：判别式与出处见 shared/enemy-night-target。
// 原来按「二队还有活的 → 接触不到旗舰」写，于是「二队只剩两艘大破」这种其实打得到旗舰的
// 局面被报成了打不到——而那正是最该进夜战的时候。
// 判别式是暂定式、有例外观测，所以两条文案都只说「预计」。
const blockedBossNightHtml = (s: SortieView, b: BattleView): string | null => {
  const node = currentNode(s)
  const atBoss = (s.bossCell > 0 && s.currentCell === s.bossCell) || node?.eventId === 5
  if (
    !atBoss ||
    !s.active ||
    b.practice ||
    !isDayFlowBattle(b) ||
    b.hasNight ||
    b.result
  ) {
    return null
  }
  const flagship = b.eShips.find((ship) => ship.index === 0)
  const escort = b.eShips.filter((ship) => ship.fleet === 'escort')
  const escortAlive = escort.filter((ship) => ship.hpEnd > 0 && !ship.sunk && !ship.escaped)
  // 二队全灭（或敌方根本不是联合编成）时夜战必达旗舰，没有要提示的决策。
  if (!flagship || flagship.hpEnd <= 0 || flagship.sunk || escortAlive.length === 0) return null
  const flagshipName = esc(battleShipName(flagship))
  const target = enemyNightTargetOf(
    escort.map((ship) => ({
      sunk: ship.sunk || ship.escaped,
      hp: ship.hpEnd,
      hpMax: ship.hpMax,
      flagship: ship.position === 0,
      // BattleShipView.name 是解析时取的主数据原名，没有过本地化，正合头注对账的那一份。
      pt: isPtShipName(ship.name),
    })),
  )
  if (target === 'escort') {
    // 友军要請开着的时候，上面这条判断的**前提**就变了。wikiwiki 友軍艦隊页原文
    // （2026-08-26 查证）：「敵が連合艦隊の場合、第二艦隊が1体でも残っていればそちらも
    // 攻撃対象となり、一連の攻撃後に敵艦隊の状況が判定され、夜戦で敵第一艦隊と交戦する
    // 条件を満たした場合、夜戦は自軍第二艦隊vs敵第一艦隊になる」——友军夜战**先行**，
    // 打完之后**重新判定**交战对象。友军把残余护卫扫掉，本队夜战就直接对上敌一队。
    // 判别式读的是友军介入**前**的状态，此刻照原样劝「省弹药 / 撤退」，
    // 等于劝人放弃本来可能被友军翻回来的那一场。
    //
    // 两个条件缺一不可：
    // · 活动图 —— 友军要請是活动海域限定的机制，常规图开着也不会来
    //   （判据引 shared/map-id 的 isEventMapArea，与鉴、战斗预测同一份，不另写一条）
    // · `flag === 1` —— **状态未知时不提友军**（冷启动从没收到过 set_friendly_request
    //   就是这种，见 mg-types 的 friendlyRequest 头注）。少说不错说：
    //   说错一句「有友军」比什么都不说更容易骗人下错决心
    // （`s.active` 不在这里重复判：函数开头的守卫已经把非进行中的局面全挡掉了）
    const friendlyIncoming = isEventMapArea(s.mapArea) && mg.friendlyRequest?.flag === 1
    return `<div class="verdict v-warn"><span class="ic">夜</span><span class="tx">
      <b>敌护卫仍有战力 — 夜战预计接触不到 ${flagshipName}</b>
      <span>${friendlyIncoming ? '已开友军要請 · 友军先清残余' : '可不进夜战省弹药'}</span>
    </span><span class="act">${friendlyIncoming ? '友军先行' : '可选择撤退'}</span></div>`
  }
  // 打得到旗舰是斩杀决策的关键信息，不该只在「打不到」时才出声。
  return `<div class="verdict v-cyan"><span class="ic">夜</span><span class="tx">
    <b>敌护卫已残破 — 夜战预计可直击 ${flagshipName}</b>
    <span>进夜战有机会击破旗舰</span>
  </span><span class="act">夜战机会</span></div>`
}

/**
 * 基地防空的那几个数。决策条与战果 strip 各要一次，此前是两段同构代码，
 * 口径只要有一处改了就会当场对不上账。
 *
 * `stages` 在 0.1 早期快照里可能整个缺失（升级器补的是回灌路径），所以兜一层空数组
 * ——防空节点本来就只有一个航空阶段，读不到就当没有，不能让整块抛 TypeError。
 */
const baseDefenseMetrics = (b: BattleView) => {
  const air = b.air ?? (b.stages ?? []).find((stage) => stage.air)?.air ?? null
  return {
    air,
    baseDamage: b.fShips.reduce((sum, ship) => sum + Math.max(0, ship.hpStart - ship.hpEnd), 0),
    damagedBases: b.fShips.filter((ship) => ship.hpEnd < ship.hpStart).length,
    fLost: air ? air.fLost + air.fLost2 : 0,
    eLost: air ? air.eLost + air.eLost2 : 0,
  }
}

// 掉落从副标题里的一行小字提升为独占一行的实体卡。捞到什么是出击最重要的结果之一，
// 不该跟「基本经验 +xxx」挤在同一行小字里被一眼扫过去——尤其大破警告同屏时。
const battleDropChipHtml = (s: SortieView, b: BattleView): string => {
  const name = b.result?.dropShipName
  if (!name) return ''
  const mstId = b.result?.dropShipMstId ?? 0
  // 演习不入遭遇志，没有首见可言；出击才判定。
  const first = s.practice
    ? ''
    : firstDropBadgeInSortieHtml(mstId, mapIdOf(s.mapArea, s.mapNo), s.currentCell, s.startTs)
  // 名字链到舰娘图鉴（mstShip：掉落只有主数据 id，还没有在籍实例）。
  // 捞到新舰第一反应就是「这是谁」，不给链接等于让人自己去图鉴搜一遍。
  const nameHtml = entityNameHtml('ship', mstId, name, { compact: true })
  // 入手台词（api_get_ship.api_ship_getmes）：她被捞上来时说的那句。
  // **日文原文照录，不机翻**——台词是作品表达，走「台词原文列保原文」那一条。
  // 呈现刻意低调：只做悬停，不占版面，不抢掉落本身的戏。台词有换行（原文里的 <br>），
  // title 用真换行摆两行。
  const getMessage = b.result?.dropShipMessage
  return `<div class="battle-drop-chip">
    ${shipThumbHtml(mstId, name, { className: 'drop' })}
    <span class="k">捞到</span>
    <b${getMessage ? ` title="${esc(getMessage)}"` : ''}>${mstId > 0 ? elinkHtml('mstShip', mstId, nameHtml) : nameHtml}</b>
    ${first}${unownedShipBadgeHtml(mstId)}
  </div>`
}

// 「撤退还是进击」之外其实还有第三个选项：battleresult 报文自己提出的**退避**
// （`result.escapeOffer` = api_escape_flag/api_escape，见 mg-types 那条注）。
// 红条不把它说出来，玩家在最该想起它的那一刻想不起来。
//
// 判据只认**报文给没给 offer**，不自己算司令部设施资格——游戏已经算过了。
// offer 未就位（battleresult 还没到）就什么都不加，维持原副行。
//
// 退避种类不读 offer.type：那个字段的语义在本机账本里没对出来
// （唯一样本取值 1，mg-types 的 escapeOffer 注写明「原值保留但不解释」），
// 跟着它走等于替游戏编话。改按**舰队形态**判——这一条是编成规则，不是推断：
// 联合编成才有护卫舰队，护卫退避是「大破舰 + 一艘护卫」两艘一起走；
// 单舰队（7 舰遊撃部隊）没有第二队可派，只能単艦退避。
const escapeOfferNoteOf = (b: BattleView): string => {
  const offer = b.result?.escapeOffer
  if (!offer?.escape.length) return ''
  return b.fShips.some((ship) => ship.fleet === 'escort')
    ? ' · 可下达护卫退避'
    : ' · 可下达单舰退避'
}

// 警告槽：大破/夜战阻断这类「该做决定了」的提醒，最多一条。
// 它**不再顶掉**下面的战果槽——以前大破时直接 return，把战果连同掉落一起吃了，
// 结果 Boss 战大破捞到船时最该看的那条反而不见了。
const alertBannerHtml = (s: SortieView): string => {
  const b = s.battle
  if (!b) return ''
  // 大破警告压倒一切（演习无轰沉风险，不警）
  if (b.kind !== 'baseDefense' && !s.practice && s.active) {
    const taiha = b.fShips.filter(isTaiha)
    if (taiha.length) {
      const names = taiha.map((x) => esc(battleShipName(x))).join('、')
      const node = currentNode(s)
      const atBoss =
        (s.bossCell > 0 && s.currentCell === s.bossCell) || node?.eventId === 5
      if (atBoss) {
        return `<div class="verdict v-warn"><span class="ic">破</span><span class="tx">
          <b>Boss 战结束：${names} 大破</b>
          <span>本节点没有继续进击选择</span>
        </span><span class="act">战损提示</span></div>`
      }
      // 三档的判据与出处见 shared/taiha-verdict 头注：旗舰大破没有进击选项、
      // 联合二队旗舰不会轰沉，都不该沿用「请选择撤退 / 继续前进可能被击沉」。
      const verdict = taihaVerdictOf(
        taiha.map((x) => ({ index: x.index, name: battleShipName(x) })),
        b.fShips.some((ship) => ship.fleet === 'escort'),
        flagshipHasDameconIn(b.fShips, mg),
      )
      if (verdict?.tier === 'forced') {
        const who = verdict.others.length
          ? `旗舰${esc(verdict.flagship)}、${verdict.others.map(esc).join('、')} 大破`
          : `旗舰${esc(verdict.flagship)}大破`
        return `<div class="verdict v-warn"><span class="ic">破</span><span class="tx">
          <b>${who} — 本战结束后将强制返航</b>
          <span>没有进击选项</span>
        </span><span class="act">强制返航</span></div>`
      }
      if (verdict?.tier === 'protected') {
        return `<div class="verdict v-warn"><span class="ic">破</span><span class="tx">
          <b>二队旗舰${esc(verdict.escortFlagship)}大破</b>
          <span>她不会被击沉，可以继续进击</span>
        </span><span class="act">不会被击沉</span></div>`
      }
      if (verdict) {
        return `<div class="verdict v-red"><span class="ic">!</span><span class="tx">
          <b>${verdict.names.map(esc).join('、')} 大破 — 请选择撤退！</b>
          <span>继续前进可能被击沉${escapeOfferNoteOf(b)}</span>
        </span><span class="act">建议撤退</span></div>`
      }
    }
  }
  return blockedBossNightHtml(s, b) ?? ''
}

const verdictHtml = (s: SortieView): string => `${alertBannerHtml(s)}${outcomeBannerHtml(s)}`

// 方位箭头的形状。**不能用三角形字符**（原来是 ▶）：等边三角形转到哪个角度看着都一样，
// 玩家实机上根本读不出它指着哪边——这一枚存在的全部理由就是指方向。
// 换成有头有尾、长宽比 2:1 的内联 SVG：一根箭杆（细）+ 一个箭头（宽），
// 16×8 单位一比一渲染成 16×8 px，箭杆到箭尖 14.4px、箭头 7px 宽。
// 形状在 viewBox 里就是**居中且朝右**的，于是绕盒心转正好等于绕箭身转，
// 不必再像字形那样迁就墨迹偏心。取色走 currentColor（由圈那一层给），这里不写颜色。
const HEADING_ARROW_SVG =
  '<svg class="arrow-svg" viewBox="0 0 16 8" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M1 3.15 H9 V0.5 L15.4 4 L9 7.5 V4.85 H1 Z"/></svg>'

// 「前往 X 点」那枚箭头：指向这一步在海图上的真实方位，而不是一律朝右。
// 角度算式在 shared/sortie-route（0=右 90=下），算不出来就返回 null——
// 那时原样输出朝右的箭头，一个属性都不多加：不知道方向就别装懂。
const headingArrowHtml = (s: SortieView, cell: number | null | undefined): string => {
  const deg = sortieHeadingDeg(fcdMap?.data?.[mapKeyOf(s)], cell)
  return deg == null
    ? `<span class="ic">${HEADING_ARROW_SVG}</span>`
    : `<span class="ic"><span class="arrow" style="transform:rotate(${deg}deg)">${HEADING_ARROW_SVG}</span></span>`
}

/**
 * 「前往 X 点」那一条：出击途中的目的地预测。
 *
 * 单列出来是给基地防空用的。基地空袭是**路上发生的事**（`api_req_map/next` 顺带
 * 捎来的 api_destruction_battle），玩家仍然在前往下一点的途中；防空打完游戏直接
 * 进选阵型，再没有报文能把这条预测重新推回来，于是它一被顶掉就是永久丢失。
 * 用户 2026-08-26 拍板：防空**不替换**预测，摞在预测上方，两者同屏。
 */
const headingBannerHtml = (s: SortieView): string => {
  const node = s.nodes[s.nodes.length - 1]
  const eventName = node ? nodeEventName(node) : '—'
  const letter = node ? cellLetter(s, node.cell) : '?'
  const isBattleNode = node && BATTLE_EVENTS.has(node.eventId)
  const sub = node?.note
    ? esc(node.note)
    : isBattleNode
      ? '等待战斗数据 · 敌编成资料见右栏'
      : '非战斗点 · 线路预测见右栏'
  return `<div class="verdict v-cyan">${headingArrowHtml(s, node?.cell)}<span class="tx">
    <b>前往 ${esc(letter)} 点 · ${esc(eventName)}</b>
    <span>${sub}</span>
    </span><span class="act">航行中</span></div>`
}

/**
 * 防空**已结算完成**的判据。
 *
 * 对的是现有渲染怎么判：结算卡的头部那一格制空写的是
 * `air?.seiku != null ? SEIKU[...] : '制空无判定'`——航空阶段解不出来时它只能说
 * 「无判定」，那还不是能收纳成一行的完成态（摘要行正要拿这一格当中间那一段）。
 * 所以完成 = `baseDefenseMetrics` 取到了 air 且制空有判定，与头部同一份读法。
 *
 * `baseDefenseMetrics` 自己已经兜过「stages 整个缺失」那一档（见它的头注），
 * 这里不再重复兜。
 */
const baseDefenseSettled = (b: BattleView): boolean => {
  const { air } = baseDefenseMetrics(b)
  return !!air && air.seiku != null
}

/**
 * 「防空打完了、人还在前往下一点的路上」这个语境。
 *
 * 这一刻玩家要做的决定是**选阵型**，凭的是去向点的敌编成，而不是刚打完的防空。
 * 用户 2026-08-26 实报：只保住「前往 X 点」那一条横幅、面板主区仍是防空全套，
 * 等于横幅在说去向、底下整屏在说防空。
 *
 * 三个条件缺一不可：
 *   - 当前战斗是基地防空（B 点真战斗一到就把它换掉，语境自然切回去，不必特判）；
 *   - 已结算完成（还在打就照旧全量显示）；
 *   - 还在航行中——`active` 落下（回港）意味着防空就是这次出击的最后一件事，
 *     那时没有「下一站」可回去，全套留给复盘；`nodes` 空则连「前往 X 点」都画不出来。
 */
const baseDefenseEnRoute = (s: SortieView): boolean => {
  const b = s.battle
  return (
    !!b &&
    b.kind === 'baseDefense' &&
    s.active &&
    s.nodes.length > 0 &&
    baseDefenseSettled(b)
  )
}

// 收纳状态按**这一场防空**记（b.ts 是它被解析出来的那一刻，同一次出击里两场防空也不串）。
// 集合本身住在模块底部的按宿主视图状态里，换场清空——与阶段折叠 collapsedLogStages 同款。
const baseDefenseFoldKey = (b: BattleView): string => `bd:${b.ts}`

/** 此刻防空该不该收成一行。展开是玩家当场的动作，展开了就一直摊着，不自动收回。 */
const baseDefenseTucked = (s: SortieView): boolean =>
  baseDefenseEnRoute(s) && !expandedBaseDefense.has(baseDefenseFoldKey(s.battle!))

/**
 * 面板主体这一层看到的战斗。
 *
 * 收纳时**按「没有战斗」画**：主体那四段（战斗抬头 / 编队两栏 / 结果条 / 战斗流水）
 * 走的还是原来的 `battle ? … : …` 三元，于是收纳后的排布与无空袭的航行态
 * 逐字一致——不必在别处再照着航行态复写一遍，也就不会两边漂移。
 */
const bodyBattleOf = (s: SortieView): BattleView | null =>
  s.battle && !baseDefenseTucked(s) ? s.battle : null

// 战果槽：结算/预测/航行中，永远渲染一条。
const outcomeBannerHtml = (s: SortieView): string => {
  const b = s.battle
  if (!b) {
    if (s.practice && s.practiceOpponent) {
      const opponent = s.practiceOpponent
      const context = [
        opponent.rank,
        opponent.level > 0 ? `提督 Lv${opponent.level}` : '',
        opponent.deckName,
      ].filter(Boolean).join(' · ')
      return `<div class="verdict v-cyan"><span class="ic">演</span><span class="tx">
        <b>已读取 ${esc(opponent.name || '演习对手')} 的当前编成</b>
        <span>${esc(context || `${opponent.ships.length} 舰`)} · 开战前估算见下</span>
        </span><span class="act">选择对手</span></div>`
    }
    return headingBannerHtml(s)
  }
  const p = b.prediction
  const remain = b.eShips.filter((x) => x.hpStart > 0 && !battleDefeated(b, x))
  const remainTxt = remain.length
    ? `残 ${remain.map((x) => `${esc(battleShipName(x))} (${x.hpEnd})`).slice(0, 2).join('、')}${remain.length > 2 ? ` 等${remain.length}舰` : ''}`
    : b.practice
      ? '对手全员击破'
      : '敌全灭'
  if (b.result) {
    const resultRank = rankLabel(b.result.rank, p)
    const engagement = actualEngagementText(b)
    // MVP 与基本经验都搬去了下面的结果条（2026-08-20 用户口述）：这两截是度量，
    // 挂在横幅里既撑出第二行、又把舰名挤到「MVP」下一行。横幅只剩标题一行——
    // 「首次攻略！」是里程碑事件不是度量，留在这里；掉落卡照旧独占一行。
    return `<div class="verdict v-gold"><span class="ic">★</span><span class="tx">
      <b>${esc(battleTypeLabel(b))}${engagement ? ` · ${esc(engagement)}` : ''} · ${esc(resultRank)} ${rankOutcomeWord(b.result.rank)}</b>${b.result.firstClear ? '<span>首次攻略！</span>' : ''}
    </span><span class="act">✓ 结算</span>${battleDropChipHtml(s, b)}</div>`
  }
  const predictedRank = rankLabel(p.rank, p)
  if (b.kind === 'baseDefense') {
    const { air, baseDamage, damagedBases, fLost, eLost } = baseDefenseMetrics(b)
    const seiku = air?.seiku != null ? SEIKU[air.seiku] ?? `制空${air.seiku}` : '制空无判定'
    const baseNote = damagedBases ? `${damagedBases} 个基地受损` : '基地未受损'
    const enRoute = baseDefenseEnRoute(s)
    // 收纳态：只留一行摘要，主区让给去向语境（判据见 baseDefenseEnRoute）。
    // 摘要三段全是这张卡自己的既有要素——头部那句的前缀、同一格制空、副行那半句受损，
    // 一个新词都不加。行尾 ▸ 是展开指示，与流水的阶段折叠头同一枚记号。
    if (baseDefenseTucked(s)) {
      return `<div class="verdict v-green bd-tuck" data-act="bd-tuck" role="button" tabindex="0" aria-expanded="false"><span class="ic">防</span><span class="tx">
        <b>基地防空结算 · ${esc(seiku)} · ${baseNote}</b>
      </span><span class="act">防空完成 <span class="bd-mk">▸</span></span></div>${headingBannerHtml(s)}`
    }
    // 防空结算摞在路径预测**上方**，不替换它（见 headingBannerHtml 头注）。
    return `<div class="verdict v-green${enRoute ? ' bd-tuck' : ''}"${
      enRoute ? ' data-act="bd-tuck" role="button" tabindex="0" aria-expanded="true"' : ''
    }><span class="ic">防</span><span class="tx">
      <b>基地防空结算 · ${esc(seiku)} · 基地受损 ${baseDamage}</b>
      <span>我方飞机损失 ${fLost} · 敌机损失 ${eLost} · ${baseNote}</span>
    </span><span class="act">防空完成${enRoute ? ' <span class="bd-mk">▾</span>' : ''}</span></div>${headingBannerHtml(s)}`
  }
  if (isDamageOnlyBattle(b)) {
    return `<div class="verdict v-green"><span class="ic">☑</span><span class="tx">
      <b>${esc(battleForecastLead(b))}预测 ${esc(predictedRank)}${p.sure ? '' : '（估算）'} — 我方损失 ${p.fGauge}%</b>
    </span><span class="act">预测 ${esc(predictedRank)}</span></div>`
  }
  if (b.kind === 'airbattle') {
    return `<div class="verdict v-green"><span class="ic">☑</span><span class="tx">
      <b>航空战预测 ${esc(predictedRank)}${p.sure ? '' : '（估算）'} — 敌方损失 ${p.eGauge}% · 我方损失 ${p.fGauge}%</b>
    </span><span class="act">预测 ${esc(predictedRank)}</span></div>`
  }
  const sunkInfo = `${b.practice ? '击破判定' : '击沉'} ${p.eSunk}/${p.eCount}`
  const engagement = actualEngagementText(b)
  // 敌联合舰队夜战打哪一队：走 shared/enemy-night-target 的判别式，与上面的警告条
  // （blockedBossNightHtml）同一份口径。**别再按「护卫没杀完就打不到主力」写**——
  // 那是这条提示 2026-08-11 的旧写法，把全灭当成了唯一放行条件；用户 2026-08-26
  // 纠正该口径，当晚实战也逐字打脸：敌护卫只剩 1 舰小破（判别式 2.0 < 3，应直击主力），
  // 提示却还在说主力够不着。判别式是暂定式、有例外观测（见该文件头注 ③），
  // 所以除「护卫全灭」这条确定机制外一律只说「预计」。
  const nightHint = (() => {
    if (b.hasNight || !isDayFlowBattle(b) || !remain.length) return ''
    const enemyCombined = b.eShips.some((ship) => ship.fleet === 'escort')
    if (!enemyCombined) {
      return ` · 进入夜战可继续追击（剩余敌舰合计 HP ${remain.reduce((acc, x) => acc + x.hpEnd, 0)}）`
    }
    const escortRemain = remain.filter((ship) => ship.fleet === 'escort')
    if (!escortRemain.length) {
      return ` · 敌护卫已歼灭 → 夜战将与主力交战（剩余合计 HP ${remain.reduce((acc, x) => acc + x.hpEnd, 0)}）`
    }
    const target = enemyNightTargetOf(
      b.eShips
        .filter((ship) => ship.fleet === 'escort')
        .map((ship) => ({
          sunk: ship.sunk || ship.escaped,
          hp: ship.hpEnd,
          hpMax: ship.hpMax,
          flagship: ship.position === 0,
          pt: isPtShipName(ship.name),
        })),
    )
    if (target === 'escort') {
      return ` · 夜战预计与敌护卫交战（护卫剩余 ${escortRemain.length} 舰合计 HP ${escortRemain.reduce((acc, x) => acc + x.hpEnd, 0)}）`
    }
    const mainRemain = remain.filter((ship) => ship.fleet !== 'escort')
    return ` · 敌护卫已残破 → 夜战预计与主力交战（主力剩余合计 HP ${mainRemain.reduce((acc, x) => acc + x.hpEnd, 0)}）`
  })()
  return `<div class="verdict v-green"><span class="ic">☑</span><span class="tx">
    <b>${esc(battleForecastLead(b))}预测 ${esc(predictedRank)}${p.sure ? '' : '（估算）'}${engagement ? ` · ${esc(engagement)}` : ''} — ${sunkInfo} · ${remainTxt}</b>
    <span>敌方损失 ${p.eGauge}% · 我方损失 ${p.fGauge}%${nightHint}</span>
  </span><span class="act">预测 ${esc(predictedRank)}</span></div>`
}

// 对空CI 只有编号是游戏口径，「类型 5」本身说明不了任何事，所以一并把装备条件写出来。
// 表里没有的编号（游戏新加的）就照实只写编号——不认得就说不认得，不拿相近的一条冒充。
const aaciDescribe = (kind: number | null | undefined) => {
  const id = Number(kind) || 0
  const label = id > 0 ? `类型${id}` : '类型?'
  const entry = id > 0 ? aaciEntryOf(id) : null
  if (!entry) {
    return {
      label,
      condition: '',
      detail: '本地未收录这个编号',
      title: `对空CI ${label}：本地未收录这个编号`,
    }
  }
  // detail 与 title 同源：流水行要把发动装备摆在头一行、这几行明细跟在后面，
  // 抬头那枚芯片照旧整块用 title。
  const detail = `装备条件：${entry.condition}\n适用：${entry.scope}\n固定击坠 ${entry.fixed} · 加成 ×${entry.modifier}`
  return { label, condition: entry.condition, detail, title: `对空CI ${label}\n${detail}` }
}

/**
 * **舰队**航空阶段（api_kouku / api_kouku2，即 b.air / b.air2 那两波）。
 *
 * 每个带 air 的阶段都自带 stage1/stage2，但它们不是同一批飞机：基地航空（lbas）、
 * 舰队喷式强袭（injection）、友军航空（friendlyAir）、支援（support）各有各的机群，
 * 而且每波陆航报的 api_e_count 都是**同一批**敌机——两波陆航 + 两波航空战全加起来，
 * 敌机数会写成四倍。抬头 airlineHtml 的机损只加 air + air2，凡是要与它对账的合计
 * （装备行的「参战/损失」）都必须走这一份，不能自己再 filter 一遍 stages。
 */
const FLEET_AIR_PHASES: ReadonlySet<string> = new Set(['air', 'air2'])
const fleetAirStages = (b: BattleView) =>
  (b.stages ?? []).flatMap((stage) =>
    FLEET_AIR_PHASES.has(stage.phase) && stage.air ? [stage.air] : [],
  )

const airlineHtml = (b: BattleView, s: SortieView): string => {
  const air = b.air
  const airStages = (b.stages ?? []).filter((stage) => stage.air)
  const engagement = actualEngagementText(b)
  const hasContext =
    !!air ||
    airStages.length > 0 ||
    !!b.detection ||
    b.hasSupport ||
    b.smokeType > 0 ||
    b.balloonCell === true ||
    !!b.nightContact ||
    !!engagement
  if (!hasContext) return ''
  // 我方制空值只在现役出击时给：复盘旧战斗时母港编成早已改过，算出来的是今天的队，会误导
  const my = s.active && !b.practice ? myAirPower(s) : null
  const seiku = air?.seiku != null ? (SEIKU[air.seiku] ?? '') : ''
  const seikuCls = air?.seiku === 1 || air?.seiku === 2 ? 'ok' : ''
  const touches = air
    ? [
        air.touchF > 0
          ? `我 ${elink('mstEquip', air.touchF, mg.master.slotitems[air.touchF]?.name ?? `#${air.touchF}`)}`
          : '',
        air.touchE > 0
          ? `敌 ${elink('mstEquip', air.touchE, mg.master.slotitems[air.touchE]?.name ?? `#${air.touchE}`)}`
          : '',
      ].filter(Boolean).join(' / ')
    : ''
  const aaci =
    air && air.aaCutinIdx != null && air.aaCutinIdx >= 0
      ? { who: nameAt(b, 0, air.aaCutinIdx), ...aaciDescribe(air.aaCutinKind) }
      : null
  // 机损要把两波都算上（2026-08-12 用户抓的实锤：双波航空战里第二波的
  // 我 -1 / 敌 -58 没进总数，头部写着「机损 3 / 164」与流水对不上账）。
  // 每波各自是 stage1(航空互击) + stage2(对空炮火)，air2 是 api_kouku2 的第二波。
  const air2 = b.air2
  const fLoss = (air ? air.fLost + air.fLost2 : 0) + (air2 ? air2.fLost + air2.fLost2 : 0)
  const eLoss = (air ? air.eLost + air.eLost2 : 0) + (air2 ? air2.eLost + air2.eLost2 : 0)
  const eWiped = !!air && air.eCount > 0 && eLoss >= air.eCount
  const detection = b.detection
    ? [DETECTION[b.detection[0]], DETECTION[b.detection[1]]].filter(Boolean).join(' / ')
    : null
  const nightContacts = b.nightContact
    ? b.nightContact
        .map((id, side) =>
          // 与下方流水行（走 elink 出中文）对齐，此前这里直取主数据出日文
          id > 0
            ? `${side === 0 ? '我' : '敌'} ${entityNamePlain(
                isAbyssMstId(id) ? 'abyssEquip' : 'equip',
                id,
                mg.master.slotitems[id]?.name ?? `#${id}`,
              )}`
            : '',
        )
        .filter(Boolean)
        .join(' / ')
    : ''
  const phaseTitle =
    b.kind === 'baseDefense'
      ? '基地防空'
      : b.kind === 'airraid'
      ? '敌空袭'
      : b.kind === 'airbattle'
        ? '双波航空战'
        : airStages.length > 1
          ? `航空阶段 ${airStages.length}`
          : air
            ? '航空战'
            : '战斗状态'
  return `<div class="airline">
    <span class="ph2">${phaseTitle}</span>
    ${seiku ? `<span class="as ${seikuCls}">${esc(seiku)}</span>` : ''}
    ${engagement ? `<span class="kv battle-engagement">航向 <b>${esc(engagement)}</b></span>` : ''}
    ${
      my
        ? `<span class="kv" title="出击时的舰载机记录 · 熟练度未知，取区间">制空值 <b>${my.min === my.max ? my.min : `${my.min}–${my.max}`}</b></span>`
        : ''
    }
    ${air ? `<span class="kv">我机 <b>${air.fCount}</b> vs 敌机 <b>${air.eCount}</b></span>` : ''}
    ${touches ? `<span class="kv">触接 <b>${touches}</b></span>` : ''}
    ${
      aaci
        ? `<span class="kv" title="${esc(aaci.title)}">对空CI <b>${esc(aaci.who)} ${esc(aaci.label)} 发动</b>${
            aaci.condition ? `<i class="aaci-cond">${esc(aaci.condition)}</i>` : ''
          }</span>`
        : ''
    }
    ${air ? `<span class="kv">我方机损 <b class="${fLoss ? 'loss' : ''}">${fLoss}</b> · 敌机损 <b>${eWiped ? '全灭' : eLoss}</b></span>` : ''}
    ${detection ? `<span class="kv">${esc(detection)}</span>` : ''}
    ${b.smokeType > 0 ? `<span class="kv">烟幕 <b>Lv.${b.smokeType}</b></span>` : ''}
    ${b.balloonCell === true ? `<span class="kv" title="此点位为阻塞气球生效格：双方装备的阻塞气球在本战斗生效（判据为战斗报文的格级旗标，推断级）">阻塞气球 <b>已触发</b></span>` : ''}
    ${b.hasSupport ? `<span class="kv">支援舰队 <b>已到达</b></span>` : ''}
    ${nightContacts ? `<span class="kv">夜间触接 <b>${esc(nightContacts)}</b></span>` : ''}
  </div>`
}

const battleShipExpandKey = (side: 0 | 1, ship: BattleShipView): string =>
  `${side}:${ship.index}`

// api_type[2] 里的飞机类。21 是対空機銃、43 是戦闘糧食，曾被混进来（疑似抄成了
// type3 图标号），会让装机枪的舰在装备行冒出「搭载 0」徽章。
const AIRCRAFT_EQUIP_TYPES = new Set([
  6, 7, 8, 9, 10, 11, 25, 26, 41, 45, 47, 48, 49, 56, 57, 58, 59,
])

const battleHitState = (
  hit: BattleAttack['hits'][number],
): NonNullable<BattleAttack['hits'][number]['hitState']> =>
  hit.hitState ?? (hit.miss ? 'miss' : hit.damage > 0 ? 'hit' : 'unknown')

const shipCombatMetricsHtml = (b: BattleView, side: 0 | 1, ship: BattleShipView): string => {
  const attacks = b.attacks.filter((attack) => attack.side === side && attack.attacker === ship.index)
  const hits = attacks.flatMap((attack) => attack.hits)
  const criticals = hits.filter((hit) => hit.critical && battleHitState(hit) !== 'miss').length
  const misses = hits.filter((hit) => battleHitState(hit) === 'miss').length
  const zeroHits = hits.filter((hit) => battleHitState(hit) === 'hit' && hit.damage === 0).length
  const unknownZeros = hits.filter((hit) => battleHitState(hit) === 'unknown' && hit.damage === 0).length
  const hpLost = Math.max(0, ship.hpStart - ship.hpEnd)
  const params = ship.params
    ? `<span>火 <b>${ship.params[0]}</b></span><span>雷 <b>${ship.params[1]}</b></span><span>空 <b>${ship.params[2]}</b></span><span>甲 <b>${ship.params[3]}</b></span>`
    : ''
  const exp =
    side === 0 && ship.expGained != null
      ? `<span>经验 <b>+${ship.expGained.toLocaleString()}</b>${
          ship.expTotalAfter != null && ship.expNextTotal != null
            ? ` · 距升级 ${Math.max(0, ship.expNextTotal - ship.expTotalAfter).toLocaleString()}`
            : ''
        }</span>`
      : ''
  return `<div class="bship-metrics">
    <span>输出 <b>${ship.damageDealt}</b></span>
    <span>行动 <b>${attacks.length}</b></span>
    ${criticals ? `<span>暴击 <b>${criticals}</b></span>` : ''}
    ${misses ? `<span>未命中 <b>${misses}</b></span>` : ''}
    ${zeroHits ? `<span>零伤命中 <b>${zeroHits}</b></span>` : ''}
    ${unknownZeros ? `<span title="无法区分命中与未命中">零伤·判定不明 <b>${unknownZeros}</b></span>` : ''}
    <span>HP 损失 <b>${hpLost}</b></span>
    ${params}
    ${exp}
  </div>`
}

const battleEquipmentHtml = (b: BattleView, side: 0 | 1, ship: BattleShipView): string => {
  if (ship.equipment == null) {
    return `<div class="bship-empty">没有当时的装备记录</div>`
  }
  const rows = ship.equipment
    .map((item) => {
      const master = mg.master.slotitems[item.mstId]
      const rawName = master?.name ?? `装备 #${item.mstId}`
      const entityType = isAbyssMstId(item.mstId) ? 'abyssEquip' : 'equip'
      const linkType = isAbyssMstId(item.mstId) ? 'abyssEquip' : 'mstEquip'
      const name = entityNamePlain(entityType, item.mstId, rawName)
      const slot = item.slot === 'ex' ? '增设' : `${item.slot + 1}槽`
      const level = item.level > 0 ? `<span class="beq-star">★${item.level >= 10 ? 'M' : item.level}</span>` : ''
      const alv = item.alv > 0 ? `<span class="beq-alv">${alvIconHtml(item.alv)}</span>` : ''
      const isAircraft = AIRCRAFT_EQUIP_TYPES.has(master?.type2 ?? -1)
      const planes =
        isAircraft && item.planeCount != null
          ? `<span class="beq-plane">搭载 <b>${item.planeCount}</b>${item.planeCapacity != null && item.planeCapacity !== item.planeCount ? `/${item.planeCapacity}` : ''}</span>`
          : ''
      return `<div class="beq">
        <span class="beq-slot">${slot}</span>
        ${equipTypeIconHtml(master?.iconId ?? 0, { className: 'xs', title: name })}
        <span class="beq-name">${elink(linkType, item.mstId, name)}</span>
        ${level}${alv}${planes}
      </div>`
    })
    .join('')
  // 只统计舰队航空阶段：与抬头 airlineHtml 的「我方机损 / 敌机损」同源，
  // 两处必须对得上账（早先把基地/支援/友军/喷式各波都加了进来）。
  const airStages = fleetAirStages(b)
  const aircraft = ship.equipment.filter(
    (item) =>
      item.planeCount != null &&
      AIRCRAFT_EQUIP_TYPES.has(mg.master.slotitems[item.mstId]?.type2 ?? -1),
  )
  const hasPlanes = aircraft.length > 0
  const total = airStages.reduce(
    (sum, air) => sum + (side === 0 ? air.fCount : air.eCount),
    0,
  )
  const lost = airStages.reduce(
    (sum, air) =>
      sum + (side === 0 ? air.fLost + air.fLost2 : air.eLost + air.eLost2),
    0,
  )
  const airNote =
    hasPlanes && airStages.length
      ? `<div class="bship-note">舰队航空阶段合计 参战 ${total} · 损失 ${lost}</div>`
      : ''
  return `${rows || '<div class="bship-empty">该舰没有装备。</div>'}${airNote}`
}

/**
 * 输出列：**第一层只给合计**，昼夜分段挪到悬停。
 *
 * 早先第一层直接写「34 + 102」，一屏十几行全是两个数并排，敌我两栏一起挤——
 * 那一列本来就窄，读起来比一个数还费劲。分段是有用的，但不是每行都要看的东西。
 *
 * 某一段没打出可观测伤害在提示里写 `--` 而不是 0：0 会被读成「打了但没伤害」，
 * 实际多半是那一段这条舰压根没出手（撤退、已沉、或不参与夜战）。
 */
const dealtHtml = (b: BattleView, ship: BattleShipView, enemy: boolean): string => {
  const total = ship.damageDealt || 0
  const order = phaseOrderOf(b)
  if (!order) return `${total || '—'}`
  const phase = dealtByPhaseOf(b, ship.index, enemy)
  const part = (value: number) => (value > 0 ? `${value}` : '--')
  // 逐舰之和可能小于合计：航空与支援没有逐舰归属，那部分算不到谁头上。
  const gap = total - phase.day - phase.night
  // 按**实际先后**写，不写死「昼在前」——夜转昼的场次顺序是反的
  const tip = `${DAY_NIGHT_LABEL[order.first]} ${part(phase[order.first])}　${DAY_NIGHT_LABEL[order.second]} ${part(phase[order.second])}${
    gap > 0 ? `\n另有 ${gap} 无逐舰归属（航空/支援）` : ''
  }`
  return `<span class="dmg-split" title="${esc(tip)}">${total || '—'}</span>`
}

/**
 * 血条跟着战斗流水走：选中哪一行，上面的编队就显示那一刻的血量。
 *
 * null = 跟随最新（默认，也就是整场结果）。玩家手动点过某一行就 pin 在那儿，
 * 换一场、或本场结算完成时回到跟随（见 renderBattlePane 里的 logStageIdentity）。
 */
let selectedLogStage: number | null = null
let logStageIdentity = ''
/** 上一次重渲染画的是哪一场：同一场重渲染时血条要从旧状态动画到新状态 */
let lastBarFlipIdentity = ''
/** 各面板当前画的是哪一场：切阶段要就地改 DOM，得知道照着谁重算 */
const renderedBattles = new WeakMap<HTMLElement, BattleView>()

interface ShipStageView {
  ship: BattleShipView
  practice: boolean
  hp: number
  before: number
  hpMax: number
  sunkVisual: boolean
  state: [string, string] | null
  /** 整场的来龙去脉，40→30→21 那串 */
  chain: string
  /** 玩家点住了流水某一阶段：虚条画的是那一阶段掉的，不是本段累计（配色也跟着换） */
  pinned: boolean
  /** 回放终点与结算 hpEnd 对不上：中间值不可全信，UI 要标 ≈ */
  mismatch: boolean
}

/** 这艘舰在选中的那一刻是什么样：还剩多少、这一阶段掉了多少、算不算已经沉了。 */
const shipStageView = (
  b: BattleView,
  ship: BattleShipView,
  timeline: ShipHpTimeline,
  stage: number | null,
): ShipStageView => {
  // 虚条的基准分两档：
  // - 跟随最新：**昼/夜段**的段首血量，昼战里掉的全是虚条，进夜战才归于空
  // - 点住了某一阶段：基准是**那一阶段的开局血**，虚条只画这一阶段掉的那截，更早的归空。
  //   累计条要玩家自己心算「这阶段之前已经扣到哪」才能倒推本阶段输出，越靠后越难。
  const { hp, before } = hpAtStage(timeline, stage, stage ?? segmentStartOf(b.attacks))
  // 「昼战即死的舰在其后所有阶段显示 0 并标沉」——反过来，选中它还活着的那一刻
  // 就不该提前给它划线。所以沉没也按当时的血量判，不拿整场结果一刀切。
  // 演习的「击破」是终局判定，锚点还得在最后一击之后：某舰中途恰好被打到 1 HP、
  // 几个阶段后才真被判击破时，pin 在中间阶段不能提前标「击破」。
  const lastHitStage = timeline.points.length
    ? timeline.points[timeline.points.length - 1].stage
    : null
  const atOrPastFinalHit = stage == null || lastHitStage == null || stage >= lastHitStage
  const sunkNow = b.practice
    ? ship.defeated === true && hp <= 1 && atOrPastFinalHit
    : ship.sunk && hp <= 0
  const state: [string, string] | null = ship.escaped
    ? ['退避', 'var(--dim)']
    : ship.repairItemUsed && stage == null
      ? [ship.repairItemUsed === 43 ? '女神' : '要员', 'var(--ok)']
      : damageState(ship, b.practice, { hp, sunk: sunkNow })
  const steps = timeline.points.map((point) => `${point.hp}`)
  return {
    ship,
    practice: b.practice,
    hp,
    before,
    hpMax: ship.hpMax,
    sunkVisual: sunkNow && !b.practice, // 演习击破不划线不涂沉
    state,
    chain: steps.length ? [ship.hpStart, ...steps].join('→') : '',
    mismatch: timeline.mismatch,
    pinned: stage != null,
  }
}

// 实/虚/空三截宽度 + 实血色。沉没不再整条暗红——沉的那一刻实血为 0、
// 致命一击照样是斜杠虚条，「沉」由划线与标签说，条子只按同一套模型画。
const hpBarValues = (view: ShipStageView) => ({
  ...hpBarSegments(view.hpMax, view.hp, view.before),
  // 颜色按**绝对**血量：这一阶段没挨打的舰虚条是空的，但它可能本来就是中破，
  // 那时涂成健康色会骗人。
  ratio: view.hp / (view.hpMax || 1),
})

const hpNumsHtml = (view: ShipStageView): string => {
  // 回放终点与结算对不上时（护栏 mismatch），中间阶段的数值是推定——标 ≈ 挂牌，
  // 这个护栏此前只算不用，血条会拿着错误的中间值装作确定。
  const tip = view.chain
    ? ` class="hp-split" title="${esc(view.chain)}"`
    : ''
  const approx = view.mismatch
    ? '<span class="hp-approx" title="中间阶段的数值为估算">≈</span>'
    : ''
  return `${approx}<span${tip}>${view.hp}/${view.hpMax}</span>${
    view.state ? `<span class="st9" style="color:${view.state[1]}">${view.state[0]}</span>` : ''
  }`
}

/**
 * 血条那一格：实/虚/空三截 + 「当前/满格」。满格恒为 hpMax，见 hpBarSegments。
 *
 * 三截**永远都在**，宽度可以是 0——切阶段时就地改 width 才有过渡可言，
 * 元素增删会让浏览器当成新节点，动画直接不跑。
 *
 * 点住某一阶段时条子多一个 `pinned`：虚条从红斜杠换成蓝斜杠，因为那一截的含义
 * 也换了（本阶段掉的，不是本段累计）。就地拨条时这个类跟着第二拍一起翻，
 * 见 applySelectedLogStage。
 *
 * 例外是打不到的那一位（unattackable）：它的 0/1 是解析层兜出来的假数，
 * 照三截画会读成残血。游戏里这条舰本来就不显示血条，这里只留空轨。
 */
const hpBarHtml = (view: ShipStageView): string => {
  if (view.ship.unattackable) {
    return '<span class="bar"><span class="dd" style="width:100%"></span></span><span class="nums"><span class="st9">敌后方</span></span>'
  }
  const { solidPct, ghostPct, emptyPct, ratio } = hpBarValues(view)
  return `<span class="bar${view.pinned ? ' pinned' : ''}"><span class="rm ${hpClass(ratio)}" style="width:${solidPct}%"></span><span class="dl" style="width:${ghostPct}%"></span><span class="dd" style="width:${emptyPct}%"></span></span><span class="nums">${hpNumsHtml(view)}</span>`
}

/**
 * 这一行的舰图该不该换受损那张。
 *
 * 跟着**当前显示的那个阶段**走（pin 在哪一阶段就是那一刻的血），与血条同源。
 *
 * 敌我一视同仁，**不在这里判阵营**：演习对手是玩家舰娘（mstId < 1500），
 * 受损变体确实存在，游戏本体在演习里也给对方显示受损图；出击时的深海敌方
 * 由 kcs-image 的 resolveDamagedSuffix 统一抹回常态路径（本机学到的 262 条真实
 * `banner_dmg` 里一条深海都没有，poi 同样是在取图那一层抹）。
 * 别在这儿再手搓一遍「id > 1500 就不换」——那是把同一条规则写第二份。
 *
 * 打不到的那一位除外：它的 hp/hpMax 是假数，按 0/1 算永远落在受损档。
 */
const browArtDamaged = (view: ShipStageView): boolean =>
  !view.ship.unattackable && shipArtDamaged(view.hp, view.hpMax)

const browHtml = (
  b: BattleView,
  side: 0 | 1,
  ship: BattleShipView,
  mark = '', // 舰名后的附加徽章（目前是首见志的「初」）
): string => {
  const enemySide = side === 1
  // 血条跟着流水走：按解析层同一套规则重放这艘舰挨的每一击，
  // 得到「每个阶段结算完还剩多少」。选中哪一行，上面就显示那一刻。
  const view = shipStageView(b, ship, shipHpTimeline(b.attacks, ship, enemySide, b.practice), selectedLogStage)
  // 「旗」「★MVP」两个文字徽记按用户要求撤了（2026-08-12）：旗舰永远是第一行，
  // MVP 在结果条的「MVP 主力 ○○」芯片里本来就有——行内再标一遍是重复信息还占宽度
  const expandKey = battleShipExpandKey(side, ship)
  const expanded = expandedBattleShips.has(expandKey)
  return `<div class="bship${expanded ? ' open' : ''}">
  <div class="brow${view.sunkVisual ? ' sunk' : ''}${ship.escaped ? ' escaped' : ''}${ship.unattackable ? ' unattackable' : ''}" data-battle-side="${side}" data-battle-index="${ship.index}" role="button" aria-expanded="${expanded}"${ship.rosterId != null ? ` data-bship="${ship.rosterId}"` : ''}>
    <span class="nm">${shipThumbHtml(ship.mstId, ship.name, { className: 'battle', abyss: ship.mstId >= 1500, sunk: view.sunkVisual, damaged: browArtDamaged(view) })}${shipLink(ship)}${mark}<span class="bexp">${expanded ? '▴' : '▾'}</span></span>
    <span class="dmg${ship.damageDealt ? '' : ' zero'}">${dealtHtml(b, ship, enemySide)}</span>
    <span class="hpx">${hpBarHtml(view)}</span>
  </div>
  ${expanded ? `<div class="bship-detail">${shipCombatMetricsHtml(b, side, ship)}<div class="bship-equips">${battleEquipmentHtml(b, side, ship)}</div></div>` : ''}
  </div>`
}

// 一侧的舰列表：联合舰队依据真实 fleet 字段拆「第二舰队/护卫舰队」分组；
// 游击部队第七舰虽然 index = 6，仍属于 main。
/**
 * 伤害列该留几位：按**这一侧实际打出的最大位数**，不给极端值常驻留空位。
 *
 * 原来那一列写死 `minmax(24px, 34px)`，无论这一格里是「—」还是「52」都常驻 34px；
 * 而 grid 的定尺轨道在「分配余量」这一步排在 1fr 之前，于是行一窄，余量全被它和血条
 * 吃掉、名字先饿死——392px 的 battle-col 上箭头到数字之间白空 27.7px，名字只剩 5.6px。
 * 上限取 5：舰C 单场单舰伤害到不了六位（能上千已经是倍卡叠特效）。
 * 0 显示成「—」，占一位。
 */
const dmgDigits = (ships: BattleShipView[]): number =>
  Math.min(5, Math.max(1, ...ships.map((ship) => String(ship.damageDealt || 0).length)))

const sideRowsHtml = (
  b: BattleView,
  ships: BattleShipView[],
  side: 0 | 1,
  escortLabel: string,
  nightDeck: NightDeck | null,
  inactiveEscortLabel: string,
  markOf: (ship: BattleShipView) => string = () => '',
): string => {
  const main = ships.filter((x) => x.fleet !== 'escort')
  const escort = ships.filter((x) => x.fleet === 'escort')
  const escortNightState =
    nightDeck == null
      ? ''
      : nightDeck === 2
        ? '<span class="night-state active">夜战交战</span>'
        : `<span class="night-state inactive">${esc(inactiveEscortLabel)}</span>`
  // 护卫队被打光 → 给「敌护卫舰队」这个名字划一笔。主力队的横线画在 .fs-h 上，
  // 由 arenaHtml 负责——那里才拿得到队名。
  const escortWipe = escort.length
    ? fleetWipeStage({
        ships: escort,
        attacks: b.attacks,
        attackerSide: side === 1 ? 0 : 1, // 打向这一队的是对面
        practice: b.practice,
      })
    : null
  return (
    main.map((x) => browHtml(b, side, x, markOf(x))).join('') +
    (escort.length
      ? `<div class="fs-sub"><span${escortWipe ? ' class="wiped"' : ''}>${wipedNameHtml(escortLabel, escortWipe)}</span>${
          escortWipe ? wipeNoteHtml(b, escortWipe) : ''
        }${escortNightState}</div>` +
        escort.map((x) => browHtml(b, side, x, markOf(x))).join('')
      : '')
  )
}

const nightRouteHtml = (
  engagement: NightEngagement | null,
  friendlyCombined: boolean,
  enemyCombined: boolean,
): string => {
  if (!engagement) return ''
  const friendlyLabel = engagement.friendly === 2 ? '我方护卫舰队' : '我方主力舰队'
  const enemyLabel = engagement.enemy === 2 ? '敌方护卫舰队' : '敌方主力舰队'
  const rule = enemyCombined
    ? engagement.enemy === 2
      ? '敌护卫仍有战力 → 护卫交战'
      : '敌护卫已无战力 → 主力交战'
    : '敌方为单舰队'
  return `<div class="night-route">
    <span class="nr-phase">夜战接敌</span>
    <span class="nr-side">${esc(friendlyLabel)}</span>
    <span class="nr-arrow">↔</span>
    <span class="nr-side foe">${esc(enemyLabel)}</span>
    <span class="nr-rule">${friendlyCombined ? '我方主力撤出 · ' : ''}${esc(rule)}</span>
  </div>`
}

// 全歼的横线画在队名**内层**这枚 inline 上，不画在外面的 `b`/`span` 上：后者是 flex 项目、
// 已被块化，队名折行只是块内换行，整块背景只得一条线，还正落进两行之间的缝里
// （活动的「深海アシカ作戦部隊 ドーバー海峡前縁警戒群」实机撞上了）。
// inline 盒子折行才断成多段，每段各自画一条（`.wl`，见样式表）。
const wipedNameHtml = (name: string, wipe: { stageLabel: string | null } | null): string =>
  wipe ? `<span class="wl">${esc(name)}</span>` : esc(name)

// 「全歼 · 开幕雷击」这类小标。阶段名直接取自流水里最后那一击；
// 旧快照缺 hits 时说不出阶段，就只写全歼，不编一个。
const wipeNoteHtml = (b: BattleView, wipe: { stageLabel: string | null }): string =>
  `<span class="wipe-note">${b.practice ? '全灭' : '全歼'}${
    wipe.stageLabel ? ` · ${esc(wipe.stageLabel)}` : ''
  }</span>`

// 某一侧的主力队是否被打光。非联合时主力队就是全队，横线画在队名上。
const mainFleetWipe = (b: BattleView, side: 0 | 1) =>
  fleetWipeStage({
    ships: (side === 1 ? b.eShips : b.fShips).filter((x) => x.fleet !== 'escort'),
    attacks: b.attacks,
    attackerSide: side === 1 ? 0 : 1,
    practice: b.practice,
  })

// 敌舰行的「初」：这一场是不是本地记录里第一次击沉这艘深海舰。
// 判据与遭遇志写入端对齐——用 ship.sunk（掩码写的就是它），演习不入志所以整体跳过；
// 同一场里两艘同型舰只有靠前的那一艘算首杀，因为掩码那边也只落一次。
const firstKillMarkOf = (
  b: BattleView,
  s: SortieView,
): ((ship: BattleShipView) => string) => {
  if (b.practice || s.practice || b.kind === 'baseDefense') return () => ''
  const map = mapIdOf(s.mapArea, s.mapNo)
  const marked = new Set<number>()
  return (ship) => {
    if (!ship.sunk || marked.has(ship.mstId)) return ''
    const badge = firstKillBadgeInSortieHtml(ship.mstId, map, s.currentCell, s.startTs, true)
    if (badge) marked.add(ship.mstId)
    return badge
  }
}

const arenaHtml = (b: BattleView, s: SortieView): string => {
  const fTotal = b.fShips.reduce((acc, x) => acc + x.damageDealt, 0)
  const fCombined = b.fShips.some((x) => x.fleet === 'escort')
  const eCombined = b.eShips.some((x) => x.fleet === 'escort')
  const night = nightEngagementOf(b)
  const damageOnly = isDamageOnlyBattle(b)
  const baseDefense = b.kind === 'baseDefense'
  const aviationOnly = b.kind === 'airbattle'
  const baseDamage = baseDefense
    ? b.fShips.reduce((sum, ship) => sum + Math.max(0, ship.hpStart - ship.hpEnd), 0)
    : 0
  const friendlyMetric = damageOnly
    ? baseDefense
      ? `基地受损 ${baseDamage}`
      : `战损 ${b.prediction.fGauge}%`
    : aviationOnly
      ? `航空输出 ${fTotal}`
      : `输出合计 ${fTotal}`
  const enemyMetric = baseDefense ? '来袭编队' : damageOnly ? '非击沉目标' : '承伤后'
  const deck = mg.decks.find((entry) => entry.id === s.deckId)
  const fleetName = deck ? fleetLabel(deck).canonical : `第${s.deckId}舰队`
  const fName = baseDefense
    ? '基地航空队'
    : s.practice
      ? '我方舰队'
      : `${fleetName}${fCombined ? '（联合）' : ''}`
  const eName = b.practice
    ? b.enemyDeckName || '演习对手'
    : baseDefense
      ? '空袭敌编队'
      : `${b.enemyDeckName || '敌舰队'}${eCombined ? '（联合）' : ''}`
  const mainNightState = (side: 0 | 1, combined: boolean) => {
    if (!night || !combined) return ''
    const active = (side === 0 ? night.friendly : night.enemy) === 1
    const inactiveLabel = side === 0 ? '主力夜战撤出' : '主力夜战待机'
    return active
      ? '<span class="night-state active">主力夜战交战</span>'
      : `<span class="night-state inactive">${inactiveLabel}</span>`
  }
  const mainWipe0 = mainFleetWipe(b, 0)
  const mainWipe1 = mainFleetWipe(b, 1)
  return `${nightRouteHtml(night, fCombined, eCombined)}<div class="arena">
    <div class="fside" style="--dmg-ch:${dmgDigits(b.fShips)}">
      <div class="fs-h"><b${mainWipe0 ? ' class="wiped"' : ''}>${wipedNameHtml(fName, mainWipe0)}</b>${mainWipe0 ? wipeNoteHtml(b, mainWipe0) : ''}${baseDefense ? '' : esc(formationPill(b.fFormation))}${mainNightState(0, fCombined)}<span class="fm">${friendlyMetric}</span></div>
      ${sideRowsHtml(b, b.fShips, 0, '护卫舰队', night && fCombined ? night.friendly : null, '护卫夜战撤出')}
    </div>
    <div class="fside foe" style="--dmg-ch:${dmgDigits(b.eShips)}">
      <div class="fs-h"><b${mainWipe1 ? ' class="wiped"' : ''}>${wipedNameHtml(eName, mainWipe1)}</b>${mainWipe1 ? wipeNoteHtml(b, mainWipe1) : ''}${esc(formationPill(b.eFormation))}${mainNightState(1, eCombined)}<span class="fm">${enemyMetric}</span></div>
      ${sideRowsHtml(b, b.eShips, 1, '敌护卫舰队', night && eCombined ? night.enemy : null, '夜战前已无战力', firstKillMarkOf(b, s))}
    </div>
  </div>`
}

const resultStripHtml = (b: BattleView): string => {
  const p = b.prediction
  if (b.kind === 'baseDefense') {
    const { baseDamage, fLost, eLost } = baseDefenseMetrics(b)
    return `<div class="result">
      <span class="rchip">基地受损 <b>${baseDamage}</b></span>
      <span class="rchip">我方机损 <b>${fLost}</b></span>
      <span class="rchip">敌机损 <b>${eLost}</b></span>
    </div>`
  }
  const damageOnly = isDamageOnlyBattle(b)
  const aviationOnly = b.kind === 'airbattle'
  const sunkLabel = b.practice ? '击破判定' : '击沉'
  const rankTxt = b.result
    ? p.rank !== b.result.rank
      ? `${esc(rankLabel(p.rank, p))}→${esc(rankLabel(b.result.rank, p))}`
      : esc(rankLabel(b.result.rank, p))
    : `${esc(rankLabel(p.rank, p))}${p.sure ? '' : '?'}`
  const remain = b.eShips.filter((x) => x.hpStart > 0 && !battleDefeated(b, x))
  const enemyFlagship = b.eShips.find((x) => x.hpStart > 0 && !x.escaped)
  // 单舰编成没有 A 胜（打沉了就是 S），阈值本身的口径收在 shared/battle-rank
  const aTh = p.eCount > 1 ? requiredSunkForA(p.eCount) : null
  const bMet =
    (b.enemyFlagshipSunk ??
      Boolean(enemyFlagship && battleDefeated(b, enemyFlagship))) ||
    p.eGauge > p.fGauge * 2.5
  const condition = (
    met: boolean,
    label: string,
    reading = '',
  ) => `<div class="cond-row"><span class="mk ${met ? 'ok' : 'wait'}">${met ? '✓' : '◌'}</span>
    <span>${label}</span>${reading ? `<span class="r">${reading}</span>` : ''}</div>`
  const basis = damageOnly
    ? [
        // 空袭/雷达点的 S 就是完全勝利，没有「普通 S」那一档（判据与账本对照的
        // 61 场实测都收在 mg/battle 的 predictRankWith 里）。所以这一行读的是未取整的
        // 承伤点数：照 fGauge 写，联合舰队挨个位数伤时会 floor 成 0%，
        // 画出来就是「✓ 我方零承伤 · 0%」却拿不到完全胜利，自己打自己的脸。
        condition(p.perfect, 'S（完全胜利）：我方零承伤', `我方承伤 ${p.fTaken}`),
        condition(p.fTaken > 0 && p.fGauge < 10, 'A：我方损失低于 10%', `${p.fGauge}%`),
        condition(p.fGauge >= 10 && p.fGauge < 20, 'B：我方损失低于 20%', `${p.fGauge}%`),
        condition(p.fGauge >= 20 && p.fGauge < 50, 'C：我方损失低于 50%', `${p.fGauge}%`),
        condition(p.fGauge >= 50 && p.fGauge < 80, 'D：我方损失低于 80%', `${p.fGauge}%`),
        condition(p.fGauge >= 80, 'E：我方损失达到 80%', `${p.fGauge}%`),
      ].join('')
    : [
        condition(
          p.perfect,
          b.practice
            ? 'S（完全胜利）：对手全员击破且我方零承伤'
            : 'S（完全胜利）：敌全灭且我方零承伤',
          // 这一条的判据是未取整的承伤点数，不是 fGauge：联合舰队挨个位数伤时
          // fGauge 会被 floor 成 0%，读数就与打叉的勾选状态自相矛盾。
          `我方承伤 ${p.fTaken}`,
        ),
        condition(
          p.eSunk >= p.eCount && p.fSunk === 0,
          b.practice
            ? 'S 胜：对手全员击破且我方无击破判定'
            : 'S 胜：敌方全灭且我方无舰娘被击沉',
          `${p.eSunk}/${p.eCount}`,
        ),
        aTh != null
          ? condition(
              p.fSunk === 0 && p.eSunk >= aTh,
              `${b.practice ? '击破' : '击沉'}至少 ${aTh}/${p.eCount} → A 胜`,
            )
          : '<div class="cond-row"><span class="mk wait">—</span><span>敌方单舰时无 A 胜</span></div>',
        condition(
          bMet,
          `B 胜：${b.practice ? '对手旗舰击破' : '敌旗舰沉'}，或战果比超过 2.5×`,
          `${p.eGauge}% / ${p.fGauge}%`,
        ),
        condition(
          p.fSunk === 0,
          b.practice
            ? '我方无击破判定'
            : `我方无舰娘被击沉${p.fSunk ? `（击沉 ${p.fSunk}）` : ''}`,
        ),
        !b.result && remain.length
          ? `<div class="cond-row"><span class="mk wait">◌</span><span>剩余敌舰合计 HP ${remain.reduce((acc, x) => acc + x.hpEnd, 0)}</span><span class="r">${remain.length} 艘</span></div>`
          : '',
      ].join('')
  const status = b.result
    ? `${battleTypeLabel(b)} · 游戏结算`
    : p.sure
      ? `${battleTypeLabel(b)} · 可以确定`
      : `${battleForecastLead(b)}估算`
  const primaryMetric = damageOnly
    ? `<span class="rchip">我方损失 <b>${p.fGauge}%</b></span>`
    : aviationOnly
      ? `<span class="rchip">损害比 <b>敌 ${p.eGauge}% / 我 ${p.fGauge}%</b></span>`
      : `<span class="rchip">${sunkLabel} <b>${p.eSunk}/${p.eCount}</b></span>`
  const rankSource = '最终以游戏结算为准'
  // 「主力/护卫」前缀只在联合舰队才有意义——单舰队全队就是全队，
  // 挂个「主力」是无中生有的分类（2026-08-12 用户抓的实锤）
  const combined = b.fShips.some((ship) => ship.fleet === 'escort')
  const mvpNames = b.result
    ? [
        b.result.mvp >= 0
          ? `${combined ? '主力 ' : ''}${shipLinkAt(b, 0, b.result.mvp)}`
          : '',
        (b.result.mvpCombined ?? -1) >= 0
          ? `护卫 ${shipLinkAt(b, 0, 6 + (b.result.mvpCombined ?? -1))}`
          : '',
      ].filter(Boolean)
    : []
  // 战斗结束时游戏**提供**的护卫退避选项（api_escape_flag / api_escape）。
  // 与战斗包里那个同名的 api_escape_idx 不是一回事：那个是「已经退避掉的」，
  // 这个是「现在问你要不要让这几条退」。两组各归各位、都点名：
  // api_escape_idx 是要退的那条，api_tow_idx 是陪她一起走的护卫舰。
  // 哪一组都不替游戏解释因果——本机账本里唯一那次样本 escape_idx=[2,3]、
  // 且根本没有 tow_idx，够不着那层因果。
  const escapeOffer = b.result?.escapeOffer
  const namesAt = (positions: number[] | undefined) =>
    (positions ?? [])
      .map((position) => shipAt(b, 0, position))
      .filter((ship): ship is NonNullable<typeof ship> => !!ship)
      .map((ship) => esc(battleShipName(ship)))
  const escapeNames = namesAt(escapeOffer?.escape)
  const towNames = namesAt(escapeOffer?.tow)
  // 首次攻略解锁的新海域（api_next_map_ids）。混型已在解析层转数，这里只查中文名。
  const unlocked = (b.result?.nextMapIds ?? []).map((mapId) =>
    elink('map', mapId, entityNamePlain('map', mapId, mapCodeOf(mapId))),
  )
  // 结算后的 MVP / 基本经验只留结果条一处（2026-08-18 用户指出上下重复）：
  // 2026-08-20 他把这唯一一处从金色横幅挪到了这里——横幅里舰名会被挤到第二行，
  // 而结果条「我方损失」右边本来就空着。芯片是 inline-flex，舰名天然紧跟「MVP」同行。
  return `<div class="result">
    <details class="rchip rank-card">
      <summary>${b.result ? '判定' : '预测'} <b class="rank">${rankTxt}</b><span class="rank-more">条件</span></summary>
      <div class="rank-detail">
        <div class="rank-detail-h"><b>战果${b.result ? '判定' : '预测'}条件</b><span>${status}</span></div>
        ${basis}
        <div class="rank-source">${rankSource}</div>
      </div>
    </details>
    ${primaryMetric}
    ${p.fSunk ? `<span class="rchip">我方${b.practice ? '击破' : '沉'} <b style="color:var(--bad)">${p.fSunk}</b></span>` : ''}
    ${mvpNames.length ? `<span class="rchip mvp">MVP <b>${mvpNames.map((name) => `<span>${name}</span>`).join(' / ')}</b></span>` : ''}
    ${b.result ? `<span class="rchip">基本经验 <b>+${b.result.baseExp}</b></span>` : ''}
    ${escapeNames.length || towNames.length ? `<span class="rchip">${
      escapeNames.length ? `可退避 <b>${escapeNames.join(' · ')}</b>` : '可退避'
    }${towNames.length ? ` <em>护卫</em> <b>${towNames.join(' · ')}</b>` : ''}</span>` : ''}
    ${unlocked.length ? `<span class="rchip">解锁 <b>${unlocked.join(' · ')}</b></span>` : ''}
  </div>`
}

const logHtml = (b: BattleView, expanded: boolean): string => {
  interface Row {
    html: string
    dull: boolean // miss/零伤 → 默认折叠
    stage: number
    action: number
    // 同一次特殊攻击摊出来的几行共一个组号；组头的 html 每一行都带一份，
    // 好让拼装那层拿第一行看到的那份开组（别指望「第一行一定还在」）。
    group?: number
    groupHead?: string
  }
  const rows: Row[] = []
  const stageHasVisibleEvent = new Set<number>()
  const stages = b.stages ?? []
  const activeIndex = (side: 0 | 1, position: number) =>
    b.activeDeck?.[side] === 2 && position >= 0 && position < 6 ? position + 6 : position

  // 装备名的纯文字版：注记的宽度按它量，悬停里给的也是它（行内那层链接壳子不进悬停）。
  const equipNamePlain = (mstId: number): string =>
    entityNamePlain(
      isAbyssMstId(mstId) ? 'abyssEquip' : 'equip',
      mstId,
      mg.master.slotitems[mstId]?.name ?? `装备 #${mstId}`,
    )

  /**
   * 行尾注记让路。
   *
   * 一行流水的一眼位置是**双方舰名与伤害数字**，它们在 CSS 里不收缩；
   * 挂在行尾的注记（对空CI 的装备列、特殊攻击名、触接机型这一族）过长时行内只留头一段，
   * 全文原样进悬停——2026-08-26 用户按截图定的口径：对空CI 的装备列把整行挤到截断，
   * 被挤掉的却是舰名和击坠数。
   *
   * 阈值按行宽定：半角算半格，14 个全角字宽就是一行分给注记的余量。
   * 头一段本身是纯文字（没有链接壳子）时按字截，免得单段就撑满。
   *
   * **收过头的短文本本身不再被样式截第二刀**（2026-08-27 用户按截图定的口径——
   * 「弹着连击」那一枚蓝标被挤成一个字宽，语义标记就此不可读）：伤害数字与所有标记
   * 装在同一枚 `.ltail` 里，行宽不够时整块折行、续行右对齐，标记一枚都不切。
   */
  const NOTE_INLINE_LIMIT = 14
  const noteWidth = (text: string): number =>
    [...text].reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 0.5 : 1), 0)
  interface NoteSeg {
    text: string
    html?: string
  }
  const foldNote = (segments: readonly (NoteSeg | null)[]) => {
    const kept = segments.filter((seg): seg is NoteSeg => !!seg && !!seg.text)
    const full = kept.map((seg) => seg.text).join(' · ')
    if (!kept.length) return { html: '', full, folded: false }
    if (noteWidth(full) <= NOTE_INLINE_LIMIT)
      return { html: kept.map((seg) => seg.html ?? esc(seg.text)).join(' · '), full, folded: false }
    const head = kept[0]
    if (head.html) return { html: `${head.html}…`, full, folded: true }
    const chars = [...head.text]
    let width = 0
    let cut = 0
    while (cut < chars.length && width + noteWidth(chars[cut]) <= NOTE_INLINE_LIMIT) {
      width += noteWidth(chars[cut])
      cut += 1
    }
    return { html: `${esc(chars.slice(0, cut).join(''))}…`, full, folded: true }
  }

  // 航空阶段摘要始终保留；即使零伤，也不能让整波基地航空或第二航空战消失。
  for (const stage of stages) {
    const air = stage.air
    if (!air) continue
    const fLoss = air.fLost + air.fLost2
    const eLoss = air.eLost + air.eLost2
    const seiku = air.seiku != null ? SEIKU[air.seiku] ?? `制空${air.seiku}` : '制空无判定'
    // 触接机型与机队编成也是注记族：这一层会换行、不截断，所以行内照旧全给，
    // 只把纯文字全名一并挂进悬停——窄面板下 CSS 真截到了也还有得看。
    const touchParts = [
      air.touchF > 0
        ? { text: `我触接 ${equipNamePlain(air.touchF)}`, html: `我触接 ${equipmentLinkHtml(air.touchF)}` }
        : null,
      air.touchE > 0
        ? { text: `敌触接 ${equipNamePlain(air.touchE)}`, html: `敌触接 ${equipmentLinkHtml(air.touchE)}` }
        : null,
    ].filter((seg): seg is { text: string; html: string } => !!seg)
    const touches = touchParts.map((seg) => seg.html).join(' · ')
    const touchTitle = touchParts.map((seg) => seg.text).join(' · ')
    const squadronParts = (stage.squadronPlanes ?? []).map((plane) => ({
      text: `${equipNamePlain(plane.mstId)}×${plane.count}`,
      html: `${equipmentLinkHtml(plane.mstId)}×${plane.count}`,
    }))
    const squadron = squadronParts.map((seg) => seg.html).join('、')
    const squadronTitle = squadronParts.map((seg) => seg.text).join(' · ')
    // 「击坠 我 X / 敌 Y」是两个阶段之和；分阶段的明细进悬停，一眼位置不动。
    // 对空炮火那一段现在有分母了（stage2 的参战机数），写成「12 架里损失 4」——
    // 陆航的我方损失全在这一段，光看合计说不出是几架里损的。旧快照没有分母就不写那一句。
    const lossDetail = [
      `航空互击 · 我 -${air.fLost} / 敌 -${air.eLost}`,
      air.fCount2 && air.fCount2 > 0
        ? `对空炮火 · 我 ${air.fCount2} 机参战、损失 ${air.fLost2}`
        : air.fLost2 > 0
          ? `对空炮火 · 我 -${air.fLost2}`
          : '',
      air.eCount2 && air.eCount2 > 0
        ? `对空炮火 · 敌 ${air.eCount2} 机参战、损失 ${air.eLost2}`
        : air.eLost2 > 0
          ? `对空炮火 · 敌 -${air.eLost2}`
          : '',
    ].filter(Boolean).join('\n')
    rows.push({
      dull: false,
      stage: stage.order,
      action: -2,
      html: `<div class="lrow stage-row">
        <div class="stage-main"><span class="ph ${PHASE_LABEL[stage.phase][1]}">${esc(stage.label)}</span>
          <span class="who">我方 ${air.fCount} 机</span><span class="arr">⇄</span>
          <span class="who foe">敌方 ${air.eCount} 机</span>
          <span class="dv" title="${esc(lossDetail)}">击坠 我 ${fLoss} / 敌 ${eLoss}</span></div>
        <div class="stage-detail"><span class="tag9">${esc(seiku)}</span>${
          touches ? `<span class="tag9" title="${esc(touchTitle)}">${touches}</span>` : ''
        }${squadron ? `<span class="tag9 squadron" title="${esc(squadronTitle)}">${squadron}</span>` : ''}</div>
      </div>`,
    })
    stageHasVisibleEvent.add(stage.order)
  }

  // 对空炮火行（stage2）：跟随所属航空阶段，不再另外猜顺序。
  //
  // 两处补全（2026-08-25）：
  // - **分母**。以前只报「击坠 6」，说不出是从多少架里打下来的；stage2 自带参战机数，
  //   写成「击坠 6 / 32」。**分母是 stage2 的，不是 stage1 的**——stage1 是航空互击的
  //   接敌机数，活到对空炮火那一刻的通常少得多（实测 108 → 34）。旧快照没有这个数，
  //   那时照旧只报击坠数，不拿 stage1 顶替。
  // - **装备点名**。种别号只说是「第几种」，`api_use_items` 才说是哪几件打出来的。
  //   摆在种别号后面同一枚芯片里，与该行现有密度协调；名字长了截断在悬停里给全名
  //   （equipmentLinkHtml 自带这层）。认不出的编号照原样透出，不替游戏起名。
  const aaRow = (air: BattleView['air'], stage: number): Row | null => {
    if (!air || (air.eLost2 <= 0 && air.aaCutinIdx == null)) return null
    const who =
      air.aaCutinIdx != null && air.aaCutinIdx >= 0 ? nameAt(b, 0, air.aaCutinIdx) : '舰队防空'
    const ciText = aaciDescribe(air.aaCutinKind)
    const items = air.aaCutinItems ?? []
    // 种别号永远在行内；装备条件与那几件装备是明细，撑不下就整段进悬停。
    const ciHead = `对空CI ${ciText.label}`
    const note = foldNote([
      { text: ciHead, html: `对空CI ${esc(ciText.label)}` },
      ciText.condition ? { text: ciText.condition } : null,
      ...items.map((mstId) => ({
        text: equipNamePlain(mstId),
        html: equipmentLinkHtml(mstId, 8),
      })),
    ])
    const ciTitle = [
      [ciHead, ...items.map((mstId) => equipNamePlain(mstId))].join(' · '),
      ciText.detail,
    ]
      .filter(Boolean)
      .join('\n')
    const ci =
      air.aaCutinIdx != null && air.aaCutinIdx >= 0
        ? `<span class="tag9 ci" title="${esc(ciTitle)}">${note.html}</span>`
        : ''
    const shot = air.eCount2 && air.eCount2 > 0
      ? `击坠 ${air.eLost2} / ${air.eCount2}`
      : `击坠 ${air.eLost2}`
    return {
      dull: false,
      stage,
      action: -1,
      html: `<div class="lrow"><span class="ph air">对空炮火</span>
        <span class="who">${esc(who)}</span><span class="arr">→</span>
        <span class="who foe">敌舰载机</span>
        <span class="ltail"><span class="dv">${shot}</span>${ci}</span></div>`,
    }
  }
  for (const stage of stages) {
    const aa = aaRow(stage.air, stage.order)
    if (aa) {
      rows.push(aa)
      stageHasVisibleEvent.add(stage.order)
    }
  }

  // 特殊投弹（stage3 的 api_f_sp_list / api_e_sp_list）：**亮的那一格是挨打的舰**，
  // 所以这一行按「机队 → 她」的方向写，别写成她发动了什么。
  //
  // 摆位跟对空炮火同族，排在它之后、承伤流水之前——投弹方式是那一击的属性，
  // 夹在 stage2 与 stage3 中间正好。每个航空段各读各的 stage3，两波都亮就是两行。
  //
  // 种类号只认账本见过的 1，别的照号显示不替游戏起名（这一格是数组，游戏预留了多种）。
  // 定名「跳弹轰炸」是用户 2026-08-25 拍的板：中文军语通称 + WoWS 中文社区对该中队
  // 类型的现成叫法（Max Immelmann 的招牌），比日语直译「反跳爆击」更是人话；
  // 日文原词照汉化总则收进悬停对照。
  const SP_ATTACK_NAMES: Record<number, string> = { 1: '跳弹轰炸' }
  const SP_ATTACK_NOTES: Record<number, string> = { 1: '日文原词：反跳爆撃（skip bombing）' }
  const spAttackRows = (air: BattleView['air'], stage: number): Row[] => {
    if (!air) return []
    // 按「种类 + 挨打的是哪一侧」分桶：两侧同时挨同一种，也得各写各的方向。
    const byLabel = new Map<string, { label: string; note: string; side: 0 | 1; names: string[] }>()
    const collect = (list: AirSpecialAttackView[] | undefined, side: 0 | 1) => {
      for (const one of list ?? []) {
        for (const kind of one.kinds) {
          const label = SP_ATTACK_NAMES[kind] ?? `特殊投弹 ${kind}`
          const key = `${side}:${label}`
          const bucket = byLabel.get(key) ?? { label, note: SP_ATTACK_NOTES[kind] ?? '', side, names: [] }
          // 位置在解析层已经归一到 0-11 视图舰位，这里不能再过 activeIndex：
          // 那一步是给夜战活动舰队用的，昼间航空段套上去会把护卫段整体挪错。
          bucket.names.push(nameAt(b, side, one.pos))
          byLabel.set(key, bucket)
        }
      }
    }
    collect(air.spAttackF, 0)
    collect(air.spAttackE, 1)
    return [...byLabel.values()].map((bucket) => ({
      dull: false,
      stage,
      action: -0.5,
      html: `<div class="lrow"><span class="ph air"${bucket.note ? ` title="${esc(bucket.note)}"` : ''}>${esc(bucket.label)}</span>
        <span class="who${bucket.side === 0 ? ' foe' : ''}">${bucket.side === 0 ? '敌方机队' : '我方机队'}</span><span class="arr">→</span>
        <span class="who${bucket.side === 1 ? ' foe' : ''}">${esc(bucket.names.join(' · '))}</span></div>`,
    }))
  }
  for (const stage of stages) {
    for (const row of spAttackRows(stage.air, stage.order)) {
      rows.push(row)
      stageHasVisibleEvent.add(stage.order)
    }
  }

  // 支援舰队点名（api_support_info.api_support_hourai 的 deck_id / ship_id）：
  // 这一段以前只有伤害数字，说不出是谁在支援。
  //
  // **只能按 mstId 显示**：支援舰队不参战、不在这场的我方舰表里，
  // 拿舰位去查会取到本队同位置的另一条舰。前三名摆行内、全员进悬停，一行不撑爆。
  for (const stage of stages) {
    const support = stage.support
    if (!support || (!support.deckId && !support.shipMstIds.length)) continue
    const names = support.shipMstIds.map((mstId) =>
      entityNamePlain('ship', mstId, mg.master.ships[mstId]?.name ?? `#${mstId}`),
    )
    const shown = names.slice(0, 3).join('、')
    const more = names.length > 3 ? ` 等${names.length}舰` : ''
    const who = [
      support.deckId > 0 ? `第${support.deckId}舰队` : '',
      shown ? `${shown}${more}` : '',
    ].filter(Boolean).join(' · ')
    if (!who) continue
    rows.push({
      dull: false,
      stage: stage.order,
      action: -1.5,
      html: `<div class="lrow"><span class="ph sup">支援编成</span>
        <span class="who list"${names.length ? ` title="${esc(names.join('、'))}"` : ''}>${esc(who)}</span></div>`,
    })
    stageHasVisibleEvent.add(stage.order)
  }

  // 卡特琳娜救援（api_air_base_rescue_type）：陆航段的一个小事件，
  // 值就是画面上弹出几个救助气泡。**没发生时游戏根本不发这个字段**，
  // 所以缺省即没有、零痕迹——不写「未发生」也不占位。
  //
  // 挂在最后一波陆航之后、且排在那一波的伤害流水之后：它是陆航打完才演的那一下。
  // （用 MAX_SAFE_INTEGER-1 而不是 MAX：MAX 是「该阶段无有效攻击」那行的位置。）
  // 日文原词照汉化总则进悬停，
  // 与「跳弹轰炸」同一处理。**别在文案里写触发条件**——PBY-5A Catalina 只是必要
  // 不充分（账本 32/32 场都带着它、每场只装 1 格就触发过；带了却没触发的对照也有 8 次）。
  if (b.airBaseRescue != null && b.airBaseRescue > 0) {
    const lbasStages = stages.filter((stage) => stage.phase === 'lbas')
    const at = lbasStages.length ? lbasStages[lbasStages.length - 1].order : (stages[0]?.order ?? 0)
    rows.push({
      dull: false,
      stage: at,
      action: Number.MAX_SAFE_INTEGER - 1,
      html: `<div class="lrow"><span class="ph lbas" title="日文原词：カタリナ救助活動">卡特琳娜救援</span>
        <span class="who">基地航空队</span>
        <span class="dv" title="画面上弹出的救助气泡数">×${b.airBaseRescue}</span></div>`,
    })
    stageHasVisibleEvent.add(at)
  }

  // 夜间触接：与照明弹同一道理挂流水行——状态条那枚芯片太小,而且进击换点
  // 后整条就被下一场顶掉(实测 2026-08-12 用户在 J 点夜战真发动了触接却没看见)。
  // 只报「谁触接了」,加成数值(+5/+7/+9 按夜侦命中分档)不在这里量化,与照明弹行同口径。
  if (b.nightContact && (b.nightContact[0] > 0 || b.nightContact[1] > 0)) {
    const parts: string[] = []
    const plain: string[] = []
    if (b.nightContact[0] > 0) {
      const name = mg.master.slotitems[b.nightContact[0]]?.name ?? `#${b.nightContact[0]}`
      parts.push(`我方 ${elink('mstEquip', b.nightContact[0], name)}`)
      plain.push(`我方 ${name}`)
    }
    if (b.nightContact[1] > 0) {
      const name = mg.master.slotitems[b.nightContact[1]]?.name ?? `#${b.nightContact[1]}`
      parts.push(`敌方 ${elink('mstEquip', b.nightContact[1], name)}`)
      plain.push(`敌方 ${name}`)
    }
    const nightStage =
      stages.find((stage) => stage.phase === 'night' || stage.phase === 'friendly')?.order ??
      stages.length
    rows.push({
      dull: false,
      stage: nightStage,
      action: -4,
      html: `<div class="lrow"><span class="ph night">夜间触接</span>
        <span class="who list" title="${esc(plain.join(' · '))}">${parts.join(' · ')}</span></div>`,
    })
  }

  // 照明弹（夜战）：发动舰亮出来，否则玩家只看到夜战命中率莫名变好
  if (b.flarePos && (b.flarePos[0] >= 0 || b.flarePos[1] >= 0)) {
    const parts: string[] = []
    if (b.flarePos[0] >= 0) parts.push(`我方 ${esc(nameAt(b, 0, activeIndex(0, b.flarePos[0])))}`)
    if (b.flarePos[1] >= 0) parts.push(`敌方 ${esc(nameAt(b, 1, activeIndex(1, b.flarePos[1])))}`)
    const nightStage =
      stages.find((stage) => stage.phase === 'night' || stage.phase === 'friendly')?.order ??
      stages.length
    rows.push({
      dull: false,
      stage: nightStage,
      action: -3,
      html: `<div class="lrow"><span class="ph night">照明弹</span>
        <span class="who">${parts.join(' · ')}</span></div>`,
    })
  }
  /**
   * 特殊攻击的「打包」。
   *
   * 一次特攻（大和/长门/Nelson 齐射、僚舰夜战突击这一族）在报文里本来就是
   * **一个攻击单元携带多段伤害**；解析层照 SPECIAL_ATTACK_SEGMENT_ORDER 把它摊成
   * 逐段记录，好让每一段各自记到真正开火的那条舰头上（main/mg/battle.ts 的
   * applyHougeki）。摊开之后这几条记录在流水里各占一行、每行各挂一枚同名的标——
   * 2026-08-27 用户按截图说的「分开显示、不太明显」就是这个。
   *
   * 收回一组用的是**结构判据**，不是「相邻两行的标一样」：摊出来的段除了
   * 「谁打谁、打掉多少」之外完全同源——同阶段同侧、同 ciType/ciKind、action 连号、
   * 各带一击、si_list 是同一份（见下面的 sameTouchSegment）。看文字的话，
   * 同一轮里两条舰各自弹着连击会被当场错认成一组。
   *
   * 两处边界：
   * - **一组最多收到分段表给的段数**。同一 ciType 在一段里真发动两次（本账本没见过，
   *   特攻一场一次），也不会把两次并成一组。
   * - **分段表里没有的特攻**（如 201 海空立体攻击）解析层根本不摊，多段留在同一条
   *   记录里；它的上限按 1 条记录算，多目标时照样由下面的 byTarget 拆出多行，
   *   同样够格成组。所以这里判「是不是特攻」认的是 specialAttackLabel，不是分段表。
   *
   * 只有**够两行**才成组：单段特攻维持现状，一行带标，不平白多一枚组头。
   */
  const attacks = b.attacks ?? []
  // 同阶段（stage 是真实阶段序，它自己就把 phase、段名、报文字段全钉死了，不必再各比一遍）、
  // 同侧、同 ciType/ciKind、同一份 si_list、各带一击——这就是「摊开之前是同一个攻击单元」的形状。
  const sameTouchSegment = (head: BattleAttack, seg: BattleAttack): boolean =>
    head.hits.length === 1 &&
    seg.hits.length === 1 &&
    seg.stage === head.stage &&
    seg.side === head.side &&
    seg.ciType === head.ciType &&
    seg.ciKind === head.ciKind &&
    !!seg.carrierNightAttack === !!head.carrierNightAttack &&
    (seg.equipmentMstIds ?? []).join(',') === (head.equipmentMstIds ?? []).join(',')
  // 一条记录出几行：同目标的几击合成一行（78+64），不同目标各起一行
  const rowsOfAttack = (attack: BattleAttack): number =>
    new Set(attack.hits.map((hit) => hit.target)).size
  const touchIdAt: (number | null)[] = new Array(attacks.length).fill(null)
  const touchRowCount = new Map<number, number>()
  for (let i = 0, nextTouch = 0; i < attacks.length; ) {
    const head = attacks[i]
    const label =
      head.ciType != null
        ? specialAttackLabel(head.ciType, head.ciKind === 'night' ? 'night' : 'day')
        : undefined
    if (!label) {
      i += 1
      continue
    }
    const cap = SPECIAL_ATTACK_SEGMENT_ORDER[head.ciType as number]?.length ?? 1
    let end = i + 1
    while (
      end < attacks.length &&
      end - i < cap &&
      attacks[end].action === attacks[end - 1].action + 1 &&
      sameTouchSegment(head, attacks[end])
    )
      end += 1
    const id = nextTouch++
    let count = 0
    for (let k = i; k < end; k += 1) {
      touchIdAt[k] = id
      count += rowsOfAttack(attacks[k])
    }
    touchRowCount.set(id, count)
    i = end
  }

  for (const [attackIndex, attack] of attacks.entries()) {
    const [phaseName, phaseCls] = PHASE_LABEL[attack.phase]
    // 同一攻击多击且同目标 → 合并为 78+64；不同目标各起一行
    const byTarget = new Map<number, typeof attack.hits>()
    for (const hit of attack.hits) {
      const list = byTarget.get(hit.target) ?? []
      list.push(hit)
      byTarget.set(hit.target, list)
    }
    for (const [target, hits] of byTarget) {
      // 友军夜战段我方全程旁观：友军(2)打敌(1)、敌(1)反击友军(2)。照通则「敌攻必打我方」
      // 写会把敌方反击友军那几行的挨打方错认成我方同舰位的舰娘——与 battle.ts 的
      // targetSide 保持同一口径（友军航空段只有 2→1 一个方向，不在此列）。
      const targetSide: BattleSide =
        attack.phase === 'friendly'
          ? attack.side === 2
            ? 1
            : 2
          : attack.side === 1
            ? 0
            : 1
      const attackerName =
        attack.attacker >= 0
          ? nameAt(b, attack.side, attack.attacker)
          : attack.phase === 'lbas'
            ? '基地航空队'
            : attack.phase === 'support'
              ? '支援舰队'
              : attack.phase === 'friendlyAir'
                ? '友军机队'
              : attack.side === 0
                ? '我方机队'
                : attack.side === 1
                  ? '敌方机队'
                  : '友军舰队'
      const targetName = nameAt(b, targetSide, target)
      const sideName = (name: string, side: BattleSide) =>
        b.practice ? `${side === 0 ? '我' : side === 1 ? '对' : '友'}·${name}` : name
      const total = hits.reduce((acc, h) => acc + h.damage, 0)
      const hitStates = hits.map(battleHitState)
      const allMiss = hitStates.every((state) => state === 'miss')
      const hasUnknownZero = hits.some((hit, index) => hitStates[index] === 'unknown' && hit.damage === 0)
      const dmgTxt = hits
        .map((hit, index) =>
          hitStates[index] === 'miss'
            ? 'miss'
            : hit.damage === 0
              ? hitStates[index] === 'unknown'
                ? '0?'
                : '0伤'
              : `${hit.damage}`,
        )
        .join('+')
      const crit = hits.some((h) => h.critical) && !allMiss
      const sunk = hits.some((h) => h.sunk)
      const protect = hits.some((h) => h.protect)
      const ci = ciLabel(attack.ciKind, attack.ciType)
      // 弹着观测与夜战 CI 的名字本身就是一段整话，走同一道闸门：撑不下才按字收，全名进悬停。
      const ciNote = ci ? foldNote([{ text: ci }]) : null
      const ciTag = ciNote
        ? `<span class="tag9 ci"${ciNote.folded ? ` title="${esc(ciNote.full)}"` : ''}>${ciNote.html}</span>`
        : ''
      // 这一行是不是某次特攻的一段。成组的行不再各挂一枚同名的标——那一枚移到组头上。
      const touchId = touchIdAt[attackIndex]
      const grouped = touchId != null && (touchRowCount.get(touchId) ?? 0) >= 2
      // 组头：段名照搬这一行的阶段标，名字用同一道折行闸门出来的那一枚标，零新增措辞。
      // 成员行的段名不再逐行重复（同一组本来就同一阶段），让位给缩进与那条竖线。
      const groupHead = grouped
        ? `<div class="lrow lgrp-h"><span class="ph ${phaseCls}" title="${esc(phaseName)}">${esc(
            attack.stageLabel,
          )}</span>${ciTag}</div>`
        : undefined
      const repair = hits.map((h) => h.repairItem).find((id) => id != null) ?? null
      // 对潜攻击的 api_si_list 给的是电探这类无关装备（见 attackEquipmentReliable），
      // 显示出来会让人以为「拿电探打的潜艇」，宁可不显示这枚标签。
      const targetMstId = shipAt(b, targetSide, target)?.mstId
      const equipmentTrusted = attackEquipmentReliable(
        targetMstId != null ? mg.master.ships[targetMstId]?.stype : undefined,
      )
      const usedEquipment = attack.equipmentMstIds?.length && equipmentTrusted
        ? `<span class="tag9 used-equip" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false"
            aria-label="${esc(`装备详情：${attack.equipmentMstIds
              .map((id) =>
                entityNamePlain(
                  isAbyssMstId(id) ? 'abyssEquip' : 'equip',
                  id,
                  mg.master.slotitems[id]?.name ?? `装备 #${id}`,
                ),
              )
              .join('、')}`)}"
            data-used-equipment="${attack.equipmentMstIds.join(',')}">装备详情</span>`
        : ''
      const tags = [
        grouped ? '' : ciTag,
        // 空母夜间攻击：这一击是舰载机打出去的，不是主炮。
        // **不替它定边**——发动方是敌是我，同一行的「谁 → 谁」已经写着了；
        // 本机账本 4 次亮灯全是对方的航母，写成「我方航母夜袭」会当场错。
        attack.carrierNightAttack
          ? `<span class="tag9 ci" title="日文原词：空母夜間攻撃（这一击由舰载机打出）">空母夜袭</span>`
          : '',
        crit ? `<span class="tag9 crit">✦暴击</span>` : '',
        protect ? `<span class="tag9" style="color:var(--sub)">护卫</span>` : '',
        hasUnknownZero
          ? `<span class="tag9" style="color:var(--sub)" title="无法区分命中与未命中">命中判定不明</span>`
          : '',
        attack.simultaneous ? `<span class="tag9" style="color:var(--sub)">同时结算</span>` : '',
        repair
          ? `<span class="tag9 repair">${repair === 43 ? '女神发动·满血复归' : '要员发动·20%复归'}</span>`
          : '',
        sunk ? `<span class="tag9 sink">${b.practice ? '击破判定' : '沉'}</span>` : '',
        usedEquipment,
      ].join('')
      rows.push({
        // CI/特殊攻击即便 miss 或零伤也必须露出，不能被默认折叠吞掉。
        // 空母夜间攻击同理：它是「这一击怎么打出去的」，miss 了也照样是那一击的事实。
        dull: total === 0 && !ci && !repair && !attack.carrierNightAttack,
        stage: attack.stage,
        action: attack.action,
        ...(grouped ? { group: touchId as number, groupHead } : {}),
        html: `<div class="lrow">${
          grouped
            ? ''
            : `<span class="ph ${phaseCls}" title="${esc(phaseName)}">${esc(attack.stageLabel)}</span>`
        }
          <span class="who${attack.side === 1 ? ' foe' : attack.side === 2 ? ' friend' : ''}">${esc(sideName(attackerName, attack.side))}</span><span class="arr">→</span>
          <span class="who${targetSide === 1 ? ' foe' : targetSide === 2 ? ' friend' : ''}">${esc(sideName(targetName, targetSide))}</span>
          <span class="ltail"><span class="dv"${allMiss ? ' style="color:var(--dim)"' : ''}>${dmgTxt}</span>${tags}</span></div>`,
      })
      stageHasVisibleEvent.add(attack.stage)
    }
  }

  // 有报文但没有逐击/航空摘要的阶段，只在“展开全部”里说明，既不漏步骤也不挤默认视图。
  for (const stage of stages) {
    if (stageHasVisibleEvent.has(stage.order)) continue
    const phaseCls = PHASE_LABEL[stage.phase][1]
    rows.push({
      dull: true,
      stage: stage.order,
      action: Number.MAX_SAFE_INTEGER,
      html: `<div class="lrow stage-empty"><span class="ph ${phaseCls}">${esc(stage.label)}</span>
        <span class="who">（该阶段无有效攻击）</span></div>`,
    })
  }
  rows.sort((a, b2) => a.stage - b2.stage || a.action - b2.action)
  const dullCount = rows.filter((r) => r.dull).length
  const visible = rows.filter((r) => expanded || !r.dull)
  const toggle =
    dullCount > 0
      ? `<span class="tg" data-act="log-toggle">${expanded ? '收起 miss/零伤' : `展开全部（含 miss/零伤 ${dullCount} 条）`}</span>`
      : ''
  // 每一行都是时间轴上的一个锚点：点它，上面的编队血条退回那一阶段结算完的样子。
  // 行的 html 由十几处 push 拼出来，统一在这里补属性——用 ^ 锚定，改了模板就不会
  // 悄悄失效（测试会盯住「每行都带 data-log-stage」）。
  const anchored = (row: Row) =>
    row.html.replace(
      /^<div class="lrow/,
      `<div data-act="log-stage" data-log-stage="${row.stage}" class="lrow${
        selectedLogStage === row.stage ? ' on' : ''
      }`,
    )
  // 特攻的组：组头 + 一圈成员行。组头本身也是同一阶段的锚点（走同一道 anchored），
  // 所以点组头与点组里任何一行是同一件事，行级可点一点没变。
  const withTouchGroups = (list: Row[]): string => {
    let html = ''
    let open: number | null = null
    for (const row of list) {
      if (open != null && row.group !== open) {
        html += '</div></div>'
        open = null
      }
      if (row.group != null && open == null) {
        html += `<div class="lgrp">${anchored({ ...row, html: row.groupHead ?? '' })}<div class="lgrp-b">`
        open = row.group
      }
      html += anchored(row)
    }
    return html + (open != null ? '</div></div>' : '')
  }
  const pinned =
    selectedLogStage != null
      ? `<span class="tg" data-act="log-stage" data-log-stage="">回到最终结果</span>`
      : ''
  // 分段收纳：同一 stage 的行归到它自己的折叠头下。**默认全展开**——折叠是玩家当场的
  // 收纳动作而不是偏好，所以状态只活在内存里（collapsedLogStages），换一场就清空。
  // 敌我联合 + 友军 + 多波陆航的流水能有几十行，这枚头就是那时候的收口。
  const stageByOrder = new Map(stages.map((stage) => [stage.order, stage] as const))
  const groups: { stage: number; rows: Row[] }[] = []
  for (const row of visible) {
    const last = groups[groups.length - 1]
    if (last && last.stage === row.stage) last.rows.push(row)
    else groups.push({ stage: row.stage, rows: [row] })
  }
  const body = groups
    .map((group) => {
      const inner = withTouchGroups(group.rows)
      const stage = stageByOrder.get(group.stage)
      // 认不出所属阶段的行（夜间触接/照明弹在没有夜战段时的兜底位）不套折叠头：
      // 没有现成的段名可写，而这里一个字的新文案都不许加。
      if (!stage) return inner
      const collapsed = collapsedLogStages.has(group.stage)
      return `<div class="lstage-h${collapsed ? ' folded' : ''}" data-act="log-fold" data-log-fold="${group.stage}" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}"><span class="lstage-mk">${
        collapsed ? '▸' : '▾'
      }</span><span class="lstage-nm ${PHASE_LABEL[stage.phase][1]}">${esc(stage.label)}</span></div>${
        collapsed ? '' : inner
      }`
    })
    .join('')
  return `<div class="log${selectedLogStage != null ? ' pinned' : ''}">
    <div class="log-h">战斗流水 · ${rows.length} 事件${pinned}${toggle}</div>
    ${body || '<div class="lrow" style="color:var(--dim)">（无伤害事件）</div>'}
  </div>`
}

// ---- 右栏 ----

const seaCardHtml = (s: SortieView): string => {
  if (s.practice) return ''
  const fcd = fcdMap?.data?.[mapKeyOf(s)]
  let svg = ''
  // 空壳（上游给新图落的 `{spots:{},route:{}}`）不许进：Math.min(...[]) 是
  // Infinity、Math.max 是 -Infinity，viewBox 会拼成一串非有限数。判据见 shared/fcd-topology.ts
  if (fcdTopologyUsable(fcd)) {
    const spots: Record<string, [number, number, string]> = fcd.spots
    const route: Record<string, [string | null, string]> = fcd.route ?? {}
    const xs = Object.values(spots).map((p) => p[0])
    const ys = Object.values(spots).map((p) => p[1])
    const minX = Math.min(...xs) - 40
    const minY = Math.min(...ys) - 40
    const w = Math.max(...xs) - minX + 80
    const h = Math.max(...ys) - minY + 80
    const visited = s.nodes.map((n) => cellLetter(s, n.cell))
    const visitedSet = new Set(visited)
    const passedByGame = new Set(
      (s.cellData ?? [])
        .filter((cell) => cell.passed)
        .map((cell) => cellLetter(s, cell.no)),
    )
    const selectable = new Set((s.selectRoute ?? []).map((cell) => cellLetter(s, cell)))
    const cur = visited[visited.length - 1]
    const bossLetter = s.bossCell > 0 ? cellLetter(s, s.bossCell) : null
    // 背景：全部航路边（暗线），让整张图形状可读
    const bgLines = Object.values(route)
      .map((pair) => {
        const a = pair?.[0] ? spots[pair[0]] : null
        const c = pair?.[1] ? spots[pair[1]] : null
        return a && c
          ? `<line x1="${a[0]}" y1="${a[1]}" x2="${c[0]}" y2="${c[1]}" stroke="#3a4c5c" stroke-width="2.5"/>`
          : ''
      })
      .join('')
    // 已走航线（亮绿）。逐条按 route 的**边**画（判据在 shared/sortie-route）：
    // 原来是把访问过的字母首尾相连、还从 i=1 起步——出发点不在节点列表里，
    // 那一段就整个没画（实测 3-5：F–G–K 三点亮着，起点到 F 是空的）。
    const lines: string[] = []
    for (const edge of travelledEdges(route, s.nodes.map((n) => n.cell))) {
      const a = spots[edge.from]
      const c = spots[edge.to]
      if (!a || !c) continue
      visitedSet.add(edge.from) // 出发点也是走过的，别留成灰点
      lines.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${c[0]}" y2="${c[1]}" stroke="#4fc47c" stroke-width="5"/>`)
    }
    const dots = Object.entries(spots)
      .map(([name, [x, y]]) => {
        const isCur = name === cur
        const isBoss = name === bossLetter
        const passed = (visitedSet.has(name) || passedByGame.has(name)) && !isCur
        const canSelect = selectable.has(name)
        const stroke = isCur ? '#4db8ff' : canSelect ? '#e8b86a' : isBoss ? '#ff5a6e' : passed ? '#4fc47c' : '#5c7284'
        const fill = isCur ? '#1d3d54' : canSelect ? '#40351f' : isBoss ? '#421823' : passed ? '#17351f' : '#1a2733'
        const color = isCur ? '#d6efff' : canSelect ? '#ffe0a3' : isBoss ? '#ffc4cd' : passed ? '#bdebc9' : '#a8bac8'
        const ring = isCur ? `<circle cx="${x}" cy="${y}" r="30" fill="none" stroke="#4db8ff" stroke-width="2.5" opacity=".45"/>` : ''
        return `${ring}<circle cx="${x}" cy="${y}" r="19" fill="${fill}" stroke="${stroke}" stroke-width="3">${canSelect ? `<title>当前可选择 ${esc(name)} 点</title>` : ''}</circle><text x="${x}" y="${y + 7}" fill="${color}" font-size="19" font-weight="600" text-anchor="middle" font-family="Consolas,monospace">${esc(name)}</text>`
      })
      .join('')
    svg = `<svg class="mini-map" viewBox="${minX} ${minY} ${w} ${h}">${bgLines}${lines.join('')}${dots}</svg>`
  }
  const nodeSummary = s.nodes
    .map((n) => `${cellLetter(s, n.cell)} ${n.eventId === 4 || n.eventId === 5 ? nodeEventName(n) : (NODE_EVENT[n.eventId] ?? '')}${n.rank ? `(${n.rank})` : ''}`)
    .join(' · ')
  // 整张图的分歧实测：只列真正分过歧的点（去向只有一个的不算分歧，写出来是噪音）
  const tally = routeTallyFor(s).tally
  const branchLine = [...tally.entries()]
    .filter(([, entry]) => entry.to.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([at, entry]) => `${at} ${entry.to.map((step) => `${step.letter} ${step.count}`).join('/')}`)
    .join(' · ')
  const credit = fcdMap?.meta
    ? `<span class="credit-mark" title="海图资料 · 更新 ${esc(fcdMap.meta.upstreamUpdatedAt?.slice(0, 10) ?? '?')}">源</span>`
    : '<span style="color:var(--dim)">海图资料尚未就绪</span>'
  // 游戏自报「这张图的 Boss 本期还没击破」（api_bosscomp = 0）。
  //
  // **只在它说「还没」时出声。** 说「已击破」的那一面一律沉默：常规图它恒为 1，
  // 逐图写一句「已击破」全是噪音，而且那句会跟自己的 EO 记账抢话。
  // 这条判读本身还是**假说**（各家源都查不到这个字段，判据只有账本方向自洽），
  // 月初 EO 重置是它的验收点——重置后若不跟着翻回 0，这句连同接线一起撤。
  const bossPending =
    s.bossCleared === false
      ? `<div class="l" style="margin-top:2px;font-size:10px"><span style="color:var(--dim)">本图 Boss</span> 本期尚未击破</div>`
      : ''
  return `<div class="scard" style="--hc:var(--sea)">
    <div class="h"><b>当前海域</b><span class="r">${elink('map', mapIdOf(s.mapArea, s.mapNo), `${s.mapArea}-${s.mapNo} 图鉴`)}</span></div>
    ${svg}
    <div class="l" style="margin-top:3px;color:var(--dim);font-size:10px">${esc(nodeSummary)}</div>
    ${bossPending}
    ${
      branchLine
        ? `<div class="l" style="margin-top:2px;font-size:10px"><span style="color:var(--dim)">分歧实测</span> ${esc(branchLine)}</div>`
        : ''
    }
    <div class="l" style="margin-top:2px">${credit}</div>
  </div>`
}

const sortieStatCardHtml = (s: SortieView): string => {
  if (s.practice) return ''
  const deck = mg.decks.find((d) => d.id === s.deckId)
  const ships = (deck?.ships ?? []).filter((id) => id > 0).map((id) => mg.ships[id]).filter(Boolean)
  let fuelPct = -1
  let bullPct = -1
  if (ships.length && mg.master.ready) {
    let fNow = 0
    let fMax = 0
    let bNow = 0
    let bMax = 0
    for (const ship of ships) {
      const master = mg.master.ships[ship.shipId]
      fNow += ship.fuel
      bNow += ship.bull
      fMax += master?.fuelMax ?? 0
      bMax += master?.bullMax ?? 0
    }
    if (fMax > 0) fuelPct = Math.round((fNow / fMax) * 100)
    if (bMax > 0) bullPct = Math.round((bNow / bMax) * 100)
  }
  const bar = (label: string, pct: number, grad: string) =>
    pct < 0
      ? ''
      : `<div class="ammo-bar">${label} <span class="b"><span class="rm2" style="width:${pct}%;background:${grad}"></span><span class="dd2" style="width:${100 - pct}%"></span></span><b>${pct}%</b></div>`
  return `<div class="scard" style="--hc:var(--accent-dim)">
    <div class="h"><b>出击统计</b><span class="r">本次第 ${s.battleCount} 战</span></div>
    ${bar('弹药', bullPct, 'linear-gradient(90deg,#8a7a3a,#c9a86a)')}
    ${bar('燃料', fuelPct, 'linear-gradient(90deg,#5a8a4a,#8fb87a)')}
  </div>`
}

const forecastMetricHtml = (
  label: string,
  hits: number,
  total: number,
  lowerIsBetter = false,
): string => {
  if (total < PERSONAL_RATE_MIN_SAMPLES) {
    return `<div class="forecast-metric pending">
      <span>${esc(label)}</span><b>积累中</b><em>${total}/${PERSONAL_RATE_MIN_SAMPLES} 样本</em>
    </div>`
  }
  const pct = Math.round((hits / Math.max(1, total)) * 100)
  const favorable = lowerIsBetter ? pct <= 15 : pct >= 70
  const unfavorable = lowerIsBetter ? pct >= 35 : pct < 40
  const cls = favorable ? 'good' : unfavorable ? 'bad' : 'mid'
  return `<div class="forecast-metric ${cls}">
    <span>${esc(label)}</span><b>${pct}%</b><em>n=${total}${total < 20 ? ' · 低样本' : ''}</em>
  </div>`
}

interface CandidateFormation {
  formation: number | string
  localCount: number
  confirmed: boolean
}
interface PreviewEncounterCandidate {
  ships: number[]
  formations: CandidateFormation[]
  sources: Set<'local' | 'confirmed'>
}
/** 定不了号的目录编成：逐位是 wiki 标注 + 同名同级候选池，绝不指认具体形态。 */
interface FuzzyEncounterCandidate {
  labels: string[]
  pools: number[][]
  formations: CandidateFormation[]
}
interface PreviewEncounterMatches {
  exact: PreviewEncounterCandidate[]
  fuzzy: FuzzyEncounterCandidate[]
}

// 同名同级候选池解析器，随主数据换代重建。口径与维护期定号脚本共用
// （shared/abyssal-label），两边对同一标注算出的池必须一致。
let abyssalPoolCache: { source: unknown; poolOf: (label: string | number) => number[] } | null =
  null
const abyssalPoolOf = (label: string | number): number[] => {
  if (abyssalPoolCache?.source !== mg.master.ships) {
    const entries = Object.entries(mg.master.ships)
      .map(([id, ship]) => ({ id: Number(id), name: ship.name, yomi: ship.yomi }))
      .filter((entry) => isAbyssMstId(entry.id))
    abyssalPoolCache = {
      source: mg.master.ships,
      poolOf: createAbyssalNameIndex(entries).poolOf,
    }
  }
  return abyssalPoolCache.poolOf(label)
}

const previewEncounterCandidates = (
  s: SortieView,
  previewIds: number[],
): PreviewEncounterMatches => {
  if (!previewIds.length) return { exact: [], fuzzy: [] }
  const matches = (ships: number[]) =>
    previewIds.every((mstId, index) => ships[index] === mstId)
  // 同一套舰列只算一个候选:本地遭遇/确认目录、单纵/梯形都只是它的属性。
  // 以前签名掺了阵形,同编成被拆成四五张重复卡(2026-08-12 用户报出);
  // 且确认目录一格常写多个阵形(単縦 複縦 梯形),与本地的数字阵形永远对不上。
  // 阵形逐个保留在 formations 里——机制估算按阵形建模,不能合掉。
  const bySignature = new Map<string, PreviewEncounterCandidate>()
  const add = (
    ships: number[],
    formation: number | string,
    source: 'local' | 'confirmed',
    localCount = 0,
  ) => {
    if (!matches(ships)) return
    const signature = ships.join(',')
    let known = bySignature.get(signature)
    if (!known) {
      known = { ships, formations: [], sources: new Set() }
      bySignature.set(signature, known)
    }
    known.sources.add(source)
    for (const token of formationTokensOf(formation)) {
      const entry = known.formations.find((item) => item.formation === token)
      if (entry) {
        // 同(编成,阵形)的本地计数取 max——遭遇志同键重复喂进来不该翻倍
        if (source === 'local') entry.localCount = Math.max(entry.localCount, localCount)
        else entry.confirmed = true
      } else {
        known.formations.push({
          formation: token,
          localCount: source === 'local' ? localCount : 0,
          confirmed: source === 'confirmed',
        })
      }
    }
  }
  for (const encounter of chronFor(s).encounters) {
    add(encounter.comp.filter((id) => id > 0), encounter.formation, 'local', encounter.count)
  }
  const letter = cellLetter(s, s.currentCell)
  const confirmed = mapIntelNode(mapKeyOf(s), letter, undefined, sortieDifficulty(s))
  // 精确档只认维护期定好并经人工批准的 shipIds——「重巡夏姫(A)(HP400)」这种
  // 同名多形态一旦在运行时猜成单一 id，就是在战斗界面上对着玩家说错敌人是谁。
  // 但定不下来的编成也不再一律沉默：常规图翻来覆去就那几套阵容，玩家看到
  // 「0 命中」的黑盒比看到如实标注的候选更糟（2026-08-12 用户点名）。这里降一档
  // 做「模糊命中」：逐位解析成**同名同级候选池**（口径与定号脚本共用），揭示的
  // 前三舰逐位落在池内才算命中；展示时保留 wiki 标注原文并明说形态未定。
  const fuzzyBySignature = new Map<string, FuzzyEncounterCandidate>()
  for (const comp of confirmed?.enemyComps ?? []) {
    const ids = enemyCompIds(comp)
    if (ids) {
      add(ids, comp.formation, 'confirmed')
      continue
    }
    const pools = comp.ships.map((ship) => abyssalPoolOf(ship))
    // 有一位连候选池都给不出（基名不在主数据）就整条不认，半截的池没法核对
    if (!pools.length || pools.some((pool) => !pool.length)) continue
    if (!previewIds.every((mstId, index) => pools[index]?.includes(mstId))) continue
    const labels = comp.ships.map((ship, index) =>
      typeof ship === 'number'
        ? (mg.master.ships[ship]?.name ?? `深海舰 ${ship}`)
        : stripAbyssalWikiMarkup(ship) || `深海舰 ${pools[index][0]}`,
    )
    const signature = labels.join(',')
    let known = fuzzyBySignature.get(signature)
    if (!known) {
      known = { labels, pools, formations: [] }
      fuzzyBySignature.set(signature, known)
    }
    for (const token of formationTokensOf(comp.formation)) {
      if (!known.formations.some((item) => item.formation === token)) {
        known.formations.push({ formation: token, localCount: 0, confirmed: true })
      }
    }
  }
  const localTotal = (candidate: PreviewEncounterCandidate) =>
    candidate.formations.reduce((sum, entry) => sum + entry.localCount, 0)
  const ambiguity = (candidate: FuzzyEncounterCandidate) =>
    candidate.pools.filter((pool) => pool.length > 1).length
  return {
    exact: [...bySignature.values()].sort(
      (left, right) =>
        localTotal(right) - localTotal(left) ||
        right.sources.size - left.sources.size ||
        left.ships.join(',').localeCompare(right.ships.join(',')),
    ),
    fuzzy: [...fuzzyBySignature.values()].sort(
      (left, right) =>
        ambiguity(left) - ambiguity(right) ||
        left.labels.join(',').localeCompare(right.labels.join(',')),
    ),
  }
}

const previewEncounterCandidatesHtml = (
  s: SortieView,
  previewIds: number[],
  previewEncounterCandidatesOnce: () => PreviewEncounterMatches,
): { html: string; label: string } => {
  if (!previewIds.length) return { html: '', label: '该点整体记录' }
  // 只有手上真的没有这个点的样本时才显示加载态。同点内重取（打完一场、结算落账）
  // 旧候选仍然成立，继续显示，免得每次都塌一下再填回来。
  const chron = chronFor(s)
  if (chron.loading && !chron.encounters.length) {
    return {
      html: '<div class="prebattle-match-note">正在匹配敌编成……</div>',
      label: '前三舰匹配中',
    }
  }
  const { exact: candidates, fuzzy } = previewEncounterCandidatesOnce()
  if (!candidates.length && !fuzzy.length) {
    return {
      html: '<div class="prebattle-match-note">前三舰未命中已知编成</div>',
      label: '前三舰估算',
    }
  }
  const exactStatus = !candidates.length
    ? ''
    : candidates.length === 1 ? '已锁定 1 套编成' : `命中 ${candidates.length} 套候选`
  const status = [exactStatus, fuzzy.length ? `模糊命中 ${fuzzy.length} 套` : '']
    .filter(Boolean)
    .join(' · ')
  const formationName = formationText
  const rows = candidates
    .map((candidate, index) => {
      // 同编成的多个阵形并排列出;逐阵形的本地次数与目录归属收进悬停
      const formations = candidate.formations
        .map((entry) => formationName(entry.formation).replace(/阵$/, ''))
        .join('/')
      const localCount = candidate.formations.reduce((sum, entry) => sum + entry.localCount, 0)
      const source = [
        candidate.sources.has('confirmed') ? '确认目录' : '',
        candidate.sources.has('local') ? `本地 ${localCount} 次` : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const formationTip = candidate.formations
        .map(
          (entry) =>
            `${formationName(entry.formation)}${entry.localCount ? ` 实测 ${entry.localCount} 次` : ''}${entry.confirmed ? '（目录收录）' : ''}`,
        )
        .join(' · ')
      const ships = candidate.ships
        .map((id) => {
          const name = mg.master.ships[id]?.name ?? `深海舰 ${id}`
          return `<span class="enemy-token">${shipThumbHtml(id, name, { className: 'battle', abyss: true })}${elink('abyssShip', id, name)}</span>`
        })
        .join('')
      return `<div class="prebattle-candidate">
        <header><b>${candidates.length === 1 ? '已锁定编成' : `候选 ${index + 1}`}</b><span title="${esc(formationTip)}">${esc(formations)} · ${esc(source)}</span></header>
        <div>${ships}</div>
      </div>`
    })
    .join('')
  // 模糊档：wiki 标注原文照显，池唯一的位置按精确渲染，多形态的位置戴 ? 记号。
  // 缩略图/链接取池首形态——同名同级各档立绘一致，图鉴页也把同池各档并排列出，
  // 但耐久/装备可能有出入，悬停里必须说清。
  const fuzzyRows = fuzzy
    .map((candidate, index) => {
      const formations = candidate.formations
        .map((entry) => formationName(entry.formation).replace(/阵$/, ''))
        .join('/')
      const ships = candidate.labels
        .map((label, position) => {
          const pool = candidate.pools[position]
          if (pool.length === 1) {
            const id = pool[0]
            const name = mg.master.ships[id]?.name ?? `深海舰 ${id}`
            return `<span class="enemy-token">${shipThumbHtml(id, name, { className: 'battle', abyss: true })}${elink('abyssShip', id, name)}</span>`
          }
          const tip = `同名同级共 ${pool.length} 个形态，wiki 标注「${label}」定不到具体形态，耐久/装备可能与实际有出入`
          return `<span class="enemy-token fuzzy" title="${esc(tip)}">${shipThumbHtml(pool[0], label, { className: 'battle', abyss: true })}${elink('abyssShip', pool[0], label)}<i class="fz">?</i></span>`
        })
        .join('')
      return `<div class="prebattle-candidate fuzzy">
        <header><b>模糊 ${index + 1}</b><span>${esc(formations)} · 确认目录</span></header>
        <div>${ships}</div>
      </div>`
    })
    .join('')
  const fuzzyNote = fuzzy.length
    ? '<div class="prebattle-match-note">带 ? 的位置形态未定</div>'
    : ''
  return {
    html: `<div class="prebattle-match"><div class="prebattle-match-head">${status}</div>${rows}${fuzzyRows}${fuzzyNote}</div>`,
    label: candidates.length
      ? candidates.length === 1 ? '前三舰唯一命中' : `前三舰命中 ${candidates.length} 套`
      : `前三舰模糊命中 ${fuzzy.length} 套`,
  }
}

const modelRangeText = (range: { min: number; max: number } | undefined) =>
  !range ? '—' : range.min === range.max ? `${range.min}%` : `${range.min}–${range.max}%`

const practiceOpponentPreviewHtml = (s: SortieView): string => {
  const opponent = s.practiceOpponent
  if (!opponent) return ''
  const forecast = forecastPracticeOpponent(s.deckId || 1, opponent)
  const enemyRows = opponent.ships
    .map((entry, index) => {
      const name = masterShipName(entry.mstId)
      return `<div class="practice-preview-ship enemy">
        <span class="practice-preview-pos">${index + 1}</span>
        ${shipThumbHtml(entry.mstId, name, { className: 'battle' })}
        <span class="practice-preview-name">${elinkHtml(
          'mstShip',
          entry.mstId,
          entityNameHtml('ship', entry.mstId, name, { compact: true }),
        )}</span>
        <b>Lv${entry.level}</b>
      </div>`
    })
    .join('')
  const deck = mg.decks.find((entry) => entry.id === (s.deckId || 1))
  const friendlyRows = (deck?.ships ?? [])
    .filter((rosterId) => rosterId > 0)
    .map((rosterId, index) => {
      const ship = mg.ships[rosterId]
      if (!ship) return ''
      const name = masterShipName(ship.shipId)
      return `<div class="practice-preview-ship friendly">
        <span class="practice-preview-pos">${index + 1}</span>
        ${shipThumbHtml(ship.shipId, name, {
          className: 'battle',
          damaged: shipArtDamaged(ship.nowhp, ship.maxhp), // 出击前这一栏是我方现况，与编队同档
        })}
        <span class="practice-preview-name">${elinkHtml(
          'ship',
          ship.id,
          entityNameHtml('ship', ship.shipId, name, { compact: true }),
        )}</span>
        <b>Lv${ship.lv}</b>
      </div>`
    })
    .join('')
  const metrics = forecast
    ? `<div class="forecast-grid practice-preview-metrics">
        ${/* 「评级倾向」只是把下面两个概率再翻译一遍（S/A 率高就写「S/A 倾向」），
             占掉的那一格正好让「获取经验」被挤到第二行去。所以这里只摆三格。 */ ''}
        <div class="forecast-metric"><span>B+ 胜率</span><b>${modelRangeText(forecast.band.bPlus)}</b><em>胜利线</em></div>
        <div class="forecast-metric"><span>S/A 率</span><b>${modelRangeText(forecast.band.sa)}</b><em>高评价线</em></div>
        ${practiceExpMetricHtml(s, opponent)}
      </div>
      <div class="practice-preview-model-meta">
        <b>${forecast.band.confidence}级区间估算</b>
        <span>${esc(forecast.fleetLabel)} · 对手 ${forecast.resolvedShips}/${opponent.ships.length} 舰已解析</span>
      </div>
      <div class="prebattle-model-rule">对手装备未公开 · 按通用配装估算</div>
      <div class="prebattle-model-rule">航向加权：${esc(forecastEngagementText(
        forecast.band.engagements.length === 1 && forecast.band.engagements[0] === 'saiun',
      ))}</div>
      ${/* 演习也有夜战，也吃弾着観測与先制对潜 */ ''}
      ${nightForecastHtml(forecast.band, false)}
      ${forecastLayersHtml(s, forecast.band, null, [])}`
    : `<div class="prebattle-model pending"><b>正在等待游戏基础数据与我方编成</b></div>`
  return `<div class="practice-preview-body">
    <section class="practice-preview-summary">
      <header>
        <div><span>演习对手</span><b>${esc(opponent.name || '未命名提督')}</b></div>
        <small>${esc([
          opponent.rank,
          opponent.level > 0 ? `提督 Lv${opponent.level}` : '',
          opponent.deckName,
        ].filter(Boolean).join(' · '))}</small>
      </header>
      ${metrics}
    </section>
    <div class="practice-preview-fleets">
      <section>
        <header><b>我方第一舰队</b></header>
        <div class="practice-preview-roster">${friendlyRows || '<div class="practice-preview-empty">当前没有可用于演习的舰队数据</div>'}</div>
      </section>
      <section>
        <header><b>对手当前编成</b></header>
        <div class="practice-preview-roster">${enemyRows}</div>
      </section>
    </div>
    ${practiceLevelingHtml()}
  </div>`
}

// 机制估算的输入签名：编成/装备/状态一体。十来艘舰的字符串拼接，
// 比一次「候选 × 4 交战形态 × 逐舰」的全量模型计算便宜两个量级
const deckForecastSignature = (deckId: number): string => {
  const scope = forecastDeckScope(deckId)
  let sig = `${scope.combinedType}`
  for (const id of scope.deckIds) {
    const deck = mg.decks.find((entry) => entry.id === id)
    for (const rosterId of deck?.ships ?? []) {
      if (rosterId <= 0) continue
      const ship = mg.ships[rosterId]
      if (!ship) continue
      // onslot（各槽实际搭载数）决定制空值，combat-forecast 直接读它建装备表。
      // 多数时候补给一动燃弹也跟着变、顺带兜住了它，但舰载机在出击途中被打光、
      // 燃弹却已补满的那种局面签名不变 = 拿旧制空回放。
      sig += `|${rosterId}:${ship.shipId}:${ship.lv}:${ship.nowhp}:${ship.fuel}:${ship.bull}:${ship.cond}:${ship.onslot?.join('.') ?? ''}`
      for (const slotId of [...ship.slot, ship.slotEx]) {
        if (slotId <= 0) continue
        const inst = mg.slotitems[slotId]
        sig += `,${inst?.mstId ?? 0}:${inst?.level ?? 0}:${inst?.alv ?? 0}`
      }
    }
  }
  return sig
}

// 同输入不重算：母港里 ships/decks/master 任一 patch 都会触发整面板重渲染，
// 估算输入（敌候选/我方编成/点位/陆航/倍卡）没变时直接回放上一次的 HTML
let mechanicHtmlCache: { key: string; html: string } | null = null

const preBattleMechanicHtml = (
  s: SortieView,
  previewIds: number[],
  previewEncounterCandidatesOnce: () => PreviewEncounterMatches,
): string => {
  // 机制估算模型按「航空战 → 炮雷击战、可选追进夜战」的通常昼战流程建立
  //（敌联合 kind 5 也走这套，模型里有主力/护卫分段）。夜战点、航空战点、
  // 长距离空袭点的交战流程整个不同——硬套昼战机制得出的胜率/大破率是
  // 误导性数字，宁可明说不出数。战型名与 nodeEventName 同一张表。
  const arrivedNode = s.nodes[s.nodes.length - 1]
  const foreignKind =
    arrivedNode &&
    (arrivedNode.eventId === 4 || arrivedNode.eventId === 5) &&
    arrivedNode.eventKind !== 5 // 敌联合是昼战流程,模型本来就分主力/护卫段,不拦
      ? NODE_BATTLE_KIND[arrivedNode.eventKind] ?? null
      : null
  if (foreignKind) {
    return `<div class="prebattle-model pending">
      <b>机制估算不出数：此点为${esc(foreignKind)}</b><span>敌编成与阵型候选见下方</span>
    </div>`
  }
  // 机制估算只吃精确档：模糊命中的各形态耐久/装备不同，拿猜的形态算出的
  // 胜率与大破率是精确到小数点的错误答案，宁可明说算不了。
  const { exact: matched, fuzzy: fuzzyMatched } = previewEncounterCandidatesOnce()
  const confirmed = mapIntelNode(
    mapKeyOf(s),
    cellLetter(s, s.currentCell),
    undefined,
    sortieDifficulty(s),
  )
  const comps = matched.length
    ? // 一个候选按阵形展开成多条:阵形吃炮击补正,估算区间必须逐阵形建模
      matched.flatMap((candidate) =>
        candidate.formations.map((entry) => ({
          formation: entry.formation,
          ships: candidate.ships,
        })),
      )
    : previewIds.length
      ? []
      : (confirmed?.enemyComps ?? []).flatMap((comp) => {
          const ids = enemyCompIds(comp)
          return ids ? [{ formation: comp.formation, ships: ids }] : []
        })
  if (!comps.length) {
    const reason = !previewIds.length
      ? '没有这一点的完整敌编成'
      : fuzzyMatched.length
        ? '前三舰只有模糊命中，各形态耐久与装备不同'
        : '前三舰未命中完整候选'
    return `<div class="prebattle-model pending">
      <b>机制估算不出数：敌编成未定</b><span>${reason}</span>
    </div>`
  }
  // 活动特效倍卡与陆航都只在当前这一点生效，所以在这里组装上下文：
  // 倍卡按海域号→E 图编号 + 点位字母匹配，陆航只算派向本点的波次。
  const mapId = mapIdOf(s.mapArea, s.mapNo)
  const bonusContext = eventBonusContext(cachedEventBonusLode(), mapId, cellLetter(s, s.currentCell))
  const cacheKey = JSON.stringify([
    comps,
    s.deckId,
    deckForecastSignature(s.deckId),
    mapId,
    s.currentCell,
    mg.airBasesTs ?? 0,
    s.airBaseStrikes ?? null,
    bonusContext?.credit ?? '',
    bonusContext?.entries.length ?? 0,
    // 敌舰面板矿脉包也是这次估算的输入（下面 forecastConfirmedComp 直接读它）。
    // 它是异步到的：包没到时按「敌方零装备」算出的乐观胜率若进了缓存又不带这个代号，
    // 包到了也换不下来（combat-forecast 里记过这个失效模式：D 败被预测成 B+）。
    abyssalStatsLodeTag(),
  ])
  if (mechanicHtmlCache?.key === cacheKey) return mechanicHtmlCache.html
  const forecasts = comps.map((comp) => {
    const landTargets = comp.ships.filter(
      (id) => (mg.master.ships[id]?.soku ?? 1) === 0,
    ).length
    const landTargetShare = landTargets / Math.max(1, comp.ships.length)
    // 敌联合（12 舰候选）吃 ×1.1 敵連合特効；此前写死 false，接入联合数据即漏
    const lbasWaves = landBaseWavesAt(s.currentCell, comp.ships.length > 6, landTargetShare)
    // mg.ships 已由 ship_deck 同步为此刻剩余的燃弹；临战预测从当前状态算，
    // 不能再按本轮已发生战数重复扣除补给。
    return forecastConfirmedComp(
      s.deckId,
      comp,
      abyssalStatsLode?.data ?? {},
      0,
      bonusContext,
      lbasWaves,
    )
  })
  const band = summarizeEncounterForecasts(forecasts)
  const air = band.airStates
    .map((state) => ['均衡', '确保', '优势', '劣势', '丧失'][state] ?? `状态${state}`)
    .join('～')
  const friendlyFormation = band.friendlyFormations
    .map((formation) => formationText(formation))
    .join('～')
  const saiun =
    band.engagements.length === 1 && band.engagements[0] === 'saiun'
  const engagement = saiun ? '航向：彩云修正' : '航向：自然分布'
  const fleetLabel = forecastFleetLabelForDeck(s.deckId)
  const html = `<div class="prebattle-model">
    <div class="prebattle-model-head"><b>机制估算</b><span>${band.candidates} 套完整候选 · ${band.confidence}级估算 · ${esc(fleetLabel)} · 我方 ${esc(friendlyFormation)} · ${engagement} · 制空 ${esc(air)}</span></div>
    <div class="forecast-grid prebattle-grid mechanic">
      <div class="forecast-metric"><span>B+胜率</span><b>${modelRangeText(band.bPlus)}</b></div>
      <div class="forecast-metric"><span>S/A率</span><b>${modelRangeText(band.sa)}</b></div>
      <div class="forecast-metric"><span>大破率</span><b>${modelRangeText(band.taiha)}</b></div>
    </div>
    ${nightForecastHtml(band)}
    ${forecastLayersHtml(s, band, bonusContext, comps)}
    ${forecastAssumptionsHtml(band.assumptions)}
  </div>`
  mechanicHtmlCache = { key: cacheKey, html }
  return html
}

const NIGHT_BLOCK_LABEL: [string, string][] = [
  ['mainOfCombined', '第一舰队'],
  ['carrier', '空母'],
  ['taiha', '大破'],
  ['noPower', '无火力雷装'],
]

/**
 * 演习能拿多少经验。**开战前就能算准**，因为公式是公开的闭式，
 * 输入只有对手旗舰与 2 号舰的等级——这两样开战前就摆在对手详情里。
 * （出击那边的基础经验是逐点固定值，游戏不下发，只能靠资料包收，两者性质不同。）
 *
 * 判据在 shared/practice-exp，用 wikiwiki 自带的基本经验值表逐格验过。
 */
const practiceExpMetricHtml = (s: SortieView, opponent: PracticeOpponentPreview): string => {
  ensureLevelExpLode(() => {
    if (diPane) render(diPane)
  })
  const flagship = opponent.ships[0]
  if (!flagship?.level) return ''
  const base = practiceBaseExp(flagship.level, opponent.ships[1]?.level ?? null, cumulativeExpAt)
  if (base == null) {
    return `<div class="forecast-metric pending"><span>获取经验</span><b>等级经验表未就绪</b></div>`
  }
  const sExp = practiceExpForRank(base, 'S')!
  const aExp = practiceExpForRank(base, 'A')!
  // 练巡（香取/鹿島/朝日，舰种 CT）在队时全队再乘一次。朝日改换了舰种，自动不算。
  const ownShips = (mg.decks.find((deck) => deck.id === s.deckId)?.ships ?? [])
    .filter((id) => id > 0)
    .map((id) => mg.ships[id])
    .filter(Boolean)
  const { placement, level: tcLevel, bonusPct } = trainingCruiserSetup(
    ownShips.map((ship) => ({ stype: mg.master.ships[ship!.shipId]?.stype ?? null, lv: ship!.lv })),
  )
  const withBonus = (value: number) => Math.floor(value * (1 + bonusPct / 100))
  const tip = [
    bonusPct ? `练习巡洋舰 ${placement === 'both' ? '旗舰+随伴' : placement === 'flagship' ? '旗舰' : '随伴'} Lv${tcLevel} → +${bonusPct}%` : '队里没有练习巡洋舰',
    '旗舰 ×1.5 · MVP ×2',
  ].join('\n')
  return `<div class="forecast-metric" title="${esc(tip)}">
    <span>获取经验</span>
    <b>S ${withBonus(sExp)}<i class="exp-sep">/</i>A ${withBonus(aExp)}</b>
    <em>${bonusPct ? `含练巡 +${bonusPct}%` : '逐舰基础值'}</em>
  </div>`
}

// 追进夜战会怎样。
//
// 夜战是昼战结束时才做的选择，所以它必须与昼战那三项**并列**摆着而不是合并——
// 合并等于让不打夜战的人看到打了夜战的胜率。这一格回答的是决策条上那个问题：
// 「这一轮值不值得追下去」，所以既给夜战后的胜率，也给多挨一轮的大破风险。
const nightForecastHtml = (band: EncounterForecastBand, showTaiha = true): string => {
  const { nightAttackers, nightBlocked } = band.factors
  const blocked = NIGHT_BLOCK_LABEL.flatMap(([key, label]) => {
    const count = (nightBlocked as Record<string, number | undefined>)[key] ?? 0
    return count > 0 ? [`${label} ${count}`] : []
  })
  if (!nightAttackers) {
    return `<div class="night-forecast none" title="${esc(
      `当前编成无人能夜战${blocked.length ? `：${blocked.join(' / ')}` : ''}`,
    )}"><b>追进夜战</b><span>无人能出手${blocked.length ? ` · ${blocked.join(' / ')}` : ''}</span></div>`
  }
  const gain = band.night.sa.max - band.sa.max
  const risk = band.night.taiha.max - band.taiha.max
  return `<div class="night-forecast">
    <div class="night-head">
      <b>追进夜战</b>
      <span title="${esc(
        `${nightAttackers} 舰能出手${blocked.length ? `；不参加：${blocked.join(' / ')}` : ''}\n` +
          '未计入夜战 CI 与夜间触接',
      )}">${nightAttackers} 舰出手${blocked.length ? ` · 不参加 ${esc(blocked.join(' / '))}` : ''}</span>
    </div>
    <div class="forecast-grid prebattle-grid mechanic night">
      <div class="forecast-metric"><span>B+胜率</span><b>${modelRangeText(band.night.bPlus)}</b><em>夜战后</em></div>
      <div class="forecast-metric"><span>S/A率</span><b>${modelRangeText(band.night.sa)}</b><em>${
        gain > 0 ? `较昼战 +${gain}` : '与昼战持平'
      }</em></div>
      ${showTaiha
        ? `<div class="forecast-metric${risk > 0 ? ' risk' : ''}"><span>大破率</span><b>${modelRangeText(band.night.taiha)}</b><em>${
            risk > 0 ? `多挨一轮 +${risk}` : '不额外增加'
          }</em></div>`
        // 演习 HP 最低保留 1、不存在真实击沉，所以这一格照该面板既有的口径一并不显示
        : '<div class="forecast-metric"><span>大破率</span><b>—</b><em>演习不结算战损</em></div>'}
    </div>
  </div>`
}

// 「这个数里含了什么」。
//
// 对地特攻 / 活动特效倍卡 / 基地航空这三层方差最大——倍卡有推定值、对地表有上游空洞、
// 陆航要看派没派到这一点——却最容易只体现为一个变了的数字。逐层挂出来，
// 悬停能看到凭据与来源，用户才判断得了这个估算该信几分。
const forecastLayersHtml = (
  s: SortieView,
  band: EncounterForecastBand,
  bonusContext: EventBonusContext | null,
  comps: { ships: number[] }[],
): string => {
  const chips: string[] = []

  if (band.factors.landTargets > 0) {
    // 陆上型是按候选编成变的，取候选里出现过的全部名字作悬停凭据
    const names = [...new Set(
      comps.flatMap((comp) =>
        comp.ships.filter((id) => (mg.master.ships[id]?.soku ?? 1) === 0)
          .map((id) => entityNamePlain('abyssShip', id, mg.master.ships[id]?.name ?? `#${id}`)),
      ),
    )]
    chips.push(`<span class="fc-layer land" title="${esc(
      `按对陆补正逐敌分类\n${names.join('、')}`,
    )}">对地特攻 <b>${band.factors.landTargets}</b> 目标</span>`)
  }

  const bonus = eventBonusFleetSummary(s.deckId, bonusContext)
  if (bonus) {
    const detail = bonus.rows
      .map((row) => `${row.name} ×${row.multiplier.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}${
        row.certain ? '' : ' ?'
      }\n  ${row.reasons.join('\n  ')}`)
      .join('\n')
    chips.push(`<span class="fc-layer bonus${bonus.certain ? '' : ' unsure'}" title="${esc(
      `${detail}\n\n${bonus.credit ?? '倍卡资料来源未标注'}${bonus.certain ? '' : '\n含暂估值'}`,
    )}">活动特效倍卡 <b>${bonus.rows.length}</b> 舰${bonus.certain ? '' : ' · 含暂估'}</span>`)
  }

  if (band.factors.spottingShips > 0) {
    chips.push(`<span class="fc-layer spot unsure" title="${esc(
      '按熟练度最低档与索敌补正 0 计 · 已知偏低',
    )}">弾着観測 <b>${band.factors.spottingShips}</b> 舰 · 偏低</span>`)
  }

  if (band.factors.openingAswShips > 0) {
    chips.push(`<span class="fc-layer asw" title="${esc(
      '该点有潜水舰时才产生输出',
    )}">先制对潜 <b>${band.factors.openingAswShips}</b> 舰</span>`)
  }

  const dispatch = landBaseDispatchAt(s.currentCell)
  if (dispatch.length) {
    const total = dispatch.reduce((sum, row) => sum + row.waves, 0)
    const empty = dispatch.filter((row) => !row.slots)
    chips.push(`<span class="fc-layer lbas${empty.length ? ' unsure' : ''}" title="${esc(
      `${dispatch.map((row) => `${row.name} ${row.waves} 波 · ${row.slots} 格有机`).join('\n')}${
        empty.length ? '\n有航空队全空，那几波不产生输出' : ''
      }`,
    )}">基地航空 <b>${total}</b> 波</span>`)
  }

  return chips.length ? `<div class="fc-layers">${chips.join('')}</div>` : ''
}

// 模型边界声明收进一行「预测口径」，默认折起来。
//
// 声明本身一字不改——那是审定过的诚实边界。改的只是层级：七条长句平铺在卡片
// 一眼位置，扫过去看到的全是解释，胜率与大破率反而被挤下去。
// 阵形那句抬头已经写了；其余（航向加权、联合舰队按主力/护卫分段、已/未计入、
// 大破风险口径）全部照模型给的原话渲染——说明文字只有一个出处，不会两处各说各话。
//
// 折叠交给 section-fold：这里只摆出它认的形状（段根 + 直接子标题），
// data-foldable / data-open 由它在 mount 时施加，段名就是标题那四个字。
const forecastAssumptionsHtml = (assumptions: readonly string[]): string => {
  const lines = assumptions.filter((line) => !line.startsWith('我方按'))
  if (!lines.length) return ''
  return `<div class="prebattle-model-note">
    <div class="prebattle-model-rule prebattle-model-note-h">预测口径</div>
    ${lines.map((line) => `<div class="prebattle-model-rule">${esc(line)}</div>`).join('')}
  </div>`
}

const preBattleIntelHtml = (s: SortieView): string => {
  // 有战斗就让位给战斗本身——**基地防空除外**：它是路上发生的事，本点的交战还没开始，
  // 这张卡（去向点的敌编成）正是玩家此刻要拿来选阵型的那一份。判据见 baseDefenseEnRoute。
  // 跟着**语境**走而不是跟着折叠状态：玩家展开防空细节去核对，也不该把这张卡抽走。
  if (s.practice || (s.battle && !baseDefenseEnRoute(s))) return ''
  const node = currentNode(s)
  const previews = node?.enemyPreview ?? []
  if (!previews.length && !node?.flavor && !s.selectRoute.length) return ''
  const first = previews[0]
  const previewIds = first?.shipIds ?? []
  // 前三舰匹配与机制估算要的是同一份候选（逐候选 × 逐位比对，几百次），
  // 此前两处各算一遍：机制估算的 memo 短路在算完之后才生效，短路不掉这一遍。
  // 算一次两处共用；两边各自的提前返回也不必为此付代价（真要用时才算）。
  let previewMatches: PreviewEncounterMatches | null = null
  const previewEncounterCandidatesOnce = () =>
    (previewMatches ??= previewEncounterCandidates(s, previewIds))
  const matched = previewEncounterCandidatesHtml(s, previewIds, previewEncounterCandidatesOnce)
  const chron = chronFor(s)
  const exact = chron.forecast.preview
  const sample = exact && exact.total > 0 ? exact : chron.forecast.current
  const sampleScope =
    exact && exact.total > 0
      ? `${matched.label} · 同前缀样本`
      : first?.shipIds?.length
        ? `${matched.label} · 前缀暂无样本，采用该点整体`
        : '该点整体记录'
  const fleets = previews
    .map((deck) => `<div class="prebattle-fleet">
      <span class="prebattle-kind">敌情${deck.kind ? ` ${deck.kind}` : ''}</span>
      ${deck.shipIds.map((id) => `<span class="enemy-token">${shipThumbHtml(id, mg.master.ships[id]?.name ?? `#${id}`, { className: 'battle', abyss: true })}${elink('abyssShip', id, mg.master.ships[id]?.name ?? `深海舰 ${id}`)}</span>`).join('')}
    </div>`)
    .join('')
  const routes = s.selectRoute.length
    ? `<div class="prebattle-routes"><span>游戏当前允许选择</span>${s.selectRoute
        .map((cell) => `<b>${esc(cellLetter(s, cell))} 点</b>`)
        .join('')}</div>`
    : ''
  return `<div class="scard keep prebattle-card" style="--hc:var(--warn)">
    <div class="h"><b>交战前敌情</b><span class="r">${esc(cellLetter(s, s.currentCell))} 点 · ${esc(sampleScope)}</span></div>
    ${node?.flavor ? `<div class="prebattle-flavor">${esc(node.flavor.message).replace(/\n/g, '<br>')}</div>` : ''}
    ${fleets || '<div class="l" style="color:var(--dim)">游戏尚未揭示敌舰</div>'}
    ${matched.html}
    ${routes}
    ${preBattleMechanicHtml(s, previewIds, previewEncounterCandidatesOnce)}
    <div class="nav-sec">个人实测对照</div>
    <div class="forecast-grid prebattle-grid">
      ${forecastMetricHtml('B+胜率', sample.wins, sample.total)}
      ${forecastMetricHtml('S/A率', sample.saWins, sample.total)}
      ${forecastMetricHtml('大破率', sample.taiha, sample.total, true)}
    </div>
    <div class="l prebattle-note">默认阵形 <span class="credit-mark" title="水面战默认单纵阵（联合第四）、纯潜水编成默认单横阵（联合第一）">口径</span></div>
  </div>`
}

/**
 * 「你的实测」与「确认目录」的对照。判据与结构都在 `shared/map-intel`
 * （`catalogEncounterTally`，可脱 DOM 真跑、有护栏），这里只负责把两边的数据喂进去。
 */
const catalogTallyFor = (
  s: SortieView,
  mapKey: string,
  letter: string,
  difficulty?: EventDifficulty,
): CatalogEncounterTally =>
  catalogEncounterTally(
    chronFor(s).encounters.map((e) => e.comp),
    mapIntelNode(mapKey, letter, undefined, difficulty)?.enemyComps ?? [],
  )

// 「你的实测」：本地遭遇聚合（免拉取常显）
const myCompsHtml = (s: SortieView, tally: CatalogEncounterTally): string => {
  const chron = chronFor(s)
  if (!chron.encounters.length) {
    return `<div class="l" style="color:var(--dim);font-size:10.5px">当前点暂无你的遭遇记录</div>`
  }
  return chron.encounters
    .slice(0, 3)
    .map((e) => {
      const ships = e.comp.filter((id) => id > 0)
      const names = ships
        .map(enemyName)
        .join('<span style="color:var(--dim)">、</span>')
      const ranks = Object.entries(e.ranks)
        .sort((a, b2) => b2[1] - a[1])
        .map(([r, n]) => `${r}×${n}`)
        .join(' ')
      const inCatalog = tally.catalog.has(compSignature(ships))
      return `<div class="nav-comp">
        <div class="nav-comp-h"><b>${esc(formationText(e.formation))}</b>${
          inCatalog ? '<i class="nav-comp-tag">目录 ✓</i>' : ''
        }<span class="r">${e.count} 次 · 最近 ${fmtDate(e.lastTs)}</span></div>
        <div class="nav-comp-fleet">${names}</div>
        ${ranks ? `<div class="nav-comp-air">你的评级 ${esc(ranks)}</div>` : ''}
      </div>`
    })
    .join('')
}

const confirmedEnemyCompsHtml = (
  mapKey: string,
  letter: string,
  difficulty: EventDifficulty | undefined,
  tally: CatalogEncounterTally,
): string | null => {
  const node = mapIntelNode(mapKey, letter, undefined, difficulty)
  const map = mapIntelMap(mapKey, difficulty)
  if (!node?.enemyComps.length || !map) return null
  // 编成这一域 2026-08-22 起由第一方汇编包供，「源」角标要说它自己的核对日；
  // 汇编层没覆盖的图（活动图）退回底座（与掉落那一格同一纪律）。
  const compCredit = mapEnemyCompsInfo(mapKey) ?? map
  // 上面「你的实测」已经原样列过的编成不再列第二遍（2026-08-26 用户拍板 A 案）。
  // 序号仍按目录里的原位置走：过滤掉的是行，不是它在目录里的身份。
  const rows = node.enemyComps
    .map((comp, index) => {
      if (!catalogCompUnseen(comp, tally)) return ''
      // 目录里显示的仍是 wiki 标注名（带「(艦載機白赤)」这类主数据没有的信息），
      // 只是链接改用定好的号；没定下来的照实只给文字，不做运行时猜测。
      // 汇编包的 ships 全是数字，标注文本改长在 labels 上——不优先读它的话，
      // 「軽母ヌ級改 flagship 艦載機鳥赤」会被压成主数据里的「軽母ヌ級改」。
      const names = comp.ships
        .map((ship, index) => {
          const label =
            comp.labels?.[index] ?? (typeof ship === 'number' ? enemyName(ship) : ship)
          const id = typeof ship === 'number' ? ship : (comp.shipIds?.[index] ?? 0)
          return id
            ? `<span class="enemy-token">${shipThumbHtml(id, label, { className: 'battle', abyss: true })}${elink('abyssShip', id, label)}</span>`
            : entityTermHtml('abyssShip', undefined, label)
        })
        .join('')
      const formation = formationText(comp.formation)
      return `<div class="nav-comp">
        <div class="nav-comp-h"><b>${esc(formation)}</b><span class="r">确认编成 ${index + 1}/${node.enemyComps.length}</span></div>
        <div class="nav-comp-fleet">${names}</div>
      </div>`
    })
    .join('')
  // 三种状态的措辞与「什么时候不出这一行」都在 shared/map-intel 的 catalogTallyText
  // （可脱 DOM 真跑，有护栏）；这里只负责把它挂上去。
  const catalogTally = catalogTallyText(tally)
  const tallyLine = catalogTally
    ? `<div class="l nav-catalog-tally">${esc(catalogTally)}</div>`
    : ''
  return `${tallyLine}${rows}
    <div class="l" style="margin-top:4px;font-size:10px;color:var(--dim)">
      ${difficulty ? `${difficulty}难度 · ` : ''}<span class="credit-mark" title="${esc(compCredit.source)} · 核对 ${esc(compCredit.checkedAt)} · ${esc(compCredit.revision)}">源</span>
    </div>`
}

// 我方制空值：出击编成的舰载机快照。出击途中的机体损耗不会回传母港状态，
// 所以这是「出击时」的值——正好是罗盘决策要对照的那个数，不是战斗中的实时值。
const myAirPower = (s: SortieView) => {
  const ids: number[] = []
  const push = (deckId: number) => {
    const deck = mg.decks.find((d) => d.id === deckId)
    if (deck) ids.push(...deck.ships.filter((id) => id > 0))
  }
  push(s.deckId)
  // 联合舰队：第二舰队的舰载机同样参加制空争夺
  if (mg.combinedFlag > 0 && s.deckId === 1) push(2)
  // 退避掉的舰之后的节点不参战，她那几架舰载机也不再参加制空争夺
  const ships = engagedShips(ids.map((id) => mg.ships[id]).filter(Boolean))
  if (!ships.length) return null
  const air = fleetAirPower(ships)
  return air.max > 0 ? air : null
}

/**
 * 站在这一格上做过的緊急泊地修理，一次一行。
 *
 * 数字是**算出来的**：报文只给修完之后的舰队，回复量由主进程按覆盖前后作差得到
 * （见 store 的 anchorage_repair）。账上还没有那艘舰时差值算不出，那就只说修过、不报数——
 * 编一个「+0」比不报更糟。逐舰的前后耐久留在悬停里。
 */
const anchorageRepairLinesHtml = (s: SortieView): string =>
  (s.anchorageRepairs ?? [])
    .filter((entry) => entry.cell === s.currentCell)
    .map((entry) => {
      const healed = entry.ships.reduce((sum, one) => sum + Math.max(0, one.after - one.before), 0)
      const detail = entry.ships
        .map((one) => `${entityNamePlain('ship', one.mstId, one.name)} ${one.before}→${one.after}`)
        .join('\n')
      const text = entry.ships.length ? `泊地修理 · ${entry.ships.length} 艘 +${healed}` : '泊地修理'
      return `<div class="l" style="margin-top:3px;color:var(--ok)"${
        detail ? ` title="${esc(detail)}"` : ''
      }>${esc(text)}</div>`
    })
    .join('')

const navCardHtml = (s: SortieView): string => {
  if (s.practice) return ''
  const mapKey = mapKeyOf(s)
  const edge = s.currentCell
  if (s.mapArea <= 0 || edge <= 0) return ''
  const letter = cellLetter(s, edge)
  const node = currentNode(s)
  // 非战斗点：不挂敌编成，直接标注点型与获得/损失
  if (node && !BATTLE_EVENTS.has(node.eventId)) {
    // 「无事」要分清是真无事还是站在分歧点上——后者下一步走哪边未定
    const branches = spotBranches(mapKeyOf(s), cellLetter(s, s.currentCell))
    // 站在分歧点上时，「我以前从这儿被带去过哪几次」是最想知道的一句，
    // 而且只有自己的账本能回答（带路表说的是条件，固定分歧满足与否都一样）
    const tallyText = branches.length ? branchTallyText(routeTallyFor(s), letter) : ''
    // 站在点上时 api_select_route 是能动分歧的权威实证,离线航路表兜未到过的图
    const activeHere = s.selectRoute.length > 0 || isActiveBranchSpot(mapKeyOf(s), letter)
    return `<div class="scard keep" style="--hc:var(--sea)">
    <div class="h"><b>节点信息</b><span class="r">${esc(letter)} 点</span></div>
      <div class="l"><b>${esc(NODE_EVENT[node.eventId] ?? `事件${node.eventId}`)}</b> · 非战斗点${
        branches.length
          ? ` · <b style="color:var(--warn)">${activeHere ? '能动分歧(手选去向)' : '分歧点'}</b> → ${esc(branches.join(' / '))}`
          : ''
      }</div>
      ${tallyText ? `<div class="l" style="margin-top:3px">${esc(tallyText)}</div>` : ''}
      ${node.note ? `<div class="l" style="margin-top:3px;color:${node.eventId === 3 ? 'var(--warn)' : 'var(--ok)'}">${esc(node.note)}</div>` : ''}
      ${anchorageRepairLinesHtml(s)}
    </div>`
  }
  const difficulty = sortieDifficulty(s)
  // 两段共用同一份对照：挂「目录 ✓」的判据与「哪几套不必再列」的判据必须是同一个，
  // 各算一次早晚漂移成「实测挂了勾、目录里那套却还列着」。
  const tally = catalogTallyFor(s, mapKey, letter, difficulty)
  const confirmedEnemy = confirmedEnemyCompsHtml(mapKey, letter, difficulty, tally)
  if (confirmedEnemy) {
    const confirmedNode = mapIntelNode(mapKey, letter, undefined, difficulty)!
    return `<div class="scard keep" style="--hc:#e08a97">
      <div class="h"><b>敌方编队</b><span class="r">${difficulty ? `${difficulty}难度 · ` : ''}${esc(letter)} 点 · 已确认 ${confirmedNode.enemyComps.length} 种</span></div>
      <div class="nav-sec">你的实测</div>
      ${myCompsHtml(s, tally)}
      <div class="nav-sec">确认目录</div>
      ${confirmedEnemy}
    </div>`
  }
  return `<div class="scard keep" style="--hc:#e08a97">
    <div class="h"><b>敌方编队</b><span class="r">${esc(letter)} 点 · 本地资料待更新</span></div>
    <div class="nav-sec">你的实测</div>
    ${myCompsHtml(s, tally)}
    <div class="nav-sec">确认目录</div>
    <div class="l" style="color:var(--dim)">尚未收录 ${esc(mapKey)}${difficulty ? ` ${difficulty}难度` : ''} ${esc(letter)} 点</div>
  </div>`
}

// 掉落：整轮累计，保持显示直到下次出击。
// 点位筛选是「这个面板此刻在看什么」，与选中阶段/展开行同类，按宿主各存一份
// （见下方 BattlePaneViewState）——只有一份的话，史的抽屉与镝面板显示不同 sortie 时
// 会互相把对方的筛选按「这个 startTs 不是我的」打回「全部」。
let dropCellFilter: number | null = null
let dropFilterSortieStart = 0
const dropCardHtml = (s: SortieView): string => {
  const b = s.battle
  if (!s.drops.length && !b?.result) return ''
  if (dropFilterSortieStart !== s.startTs) {
    dropFilterSortieStart = s.startTs
    dropCellFilter = null
  }
  const cells = [...new Set(s.drops.map((drop) => drop.cell))].sort((a, b) => a - b)
  if (dropCellFilter != null && !cells.includes(dropCellFilter)) dropCellFilter = null
  const shownDrops = dropCellFilter == null
    ? s.drops
    : s.drops.filter((drop) => drop.cell === dropCellFilter)
  const latestDrop = s.drops.at(-1)
  // 同一轮同一点位重复捞到同一艘时，「初」只属于最早的那一条。
  const firstMarked = new Set<number>()
  const rows = shownDrops.length
    ? shownDrops
        .map((d) => {
          const first =
            !s.practice && !firstMarked.has(d.mstId)
              ? firstDropBadgeInSortieHtml(d.mstId, mapIdOf(s.mapArea, s.mapNo), d.cell, s.startTs, true)
              : ''
          if (first) firstMarked.add(d.mstId)
          return `<div class="drop-r">${shipThumbHtml(d.mstId, d.name, { className: 'drop' })}${esc(cellLetter(s, d.cell))} 点：<b>${elink('mstShip', d.mstId, d.name)}</b>${first}${unownedShipBadgeHtml(d.mstId)}${d === latestDrop && b?.result?.dropShipMstId === d.mstId ? '<span class="rt">最新</span>' : ''}</div>`
        })
        .join('')
    : `<div class="drop-r" style="color:var(--dim)">${dropCellFilter == null ? '本轮暂无舰娘掉落' : `${esc(cellLetter(s, dropCellFilter))} 点暂无舰娘掉落`}</div>`
  const filters = cells.length > 1
    ? `<div class="drop-filters">
        <button class="drop-filter${dropCellFilter == null ? ' on' : ''}" data-act="drop-cell-filter" data-drop-cell="">全部</button>
        ${cells.map((cell) => `<button class="drop-filter${dropCellFilter === cell ? ' on' : ''}"
          data-act="drop-cell-filter" data-drop-cell="${cell}">${esc(cellLetter(s, cell))} 点</button>`).join('')}
      </div>`
    : ''
  return `<div class="scard keep" style="--hc:#e08a97">
    <div class="h"><b>本轮掉落${dropCellFilter == null ? '' : ` · ${esc(cellLetter(s, dropCellFilter))} 点`}</b><span class="r">${shownDrops.length}/${s.drops.length} 舰${s.active ? '' : ' · 已归港'}</span></div>
    ${filters}
    <div class="drops">${rows}</div>
  </div>`
}

// ---- 模块 ----

let logExpanded = false
let battleHistory: BattleSnapshotSummary[] = []
let replay: BattleSnapshot | null = null
let diPane: HTMLElement | null = null
let historyLoading = false
let expandedBattleShips = new Set<string>()
/**
 * 战斗流水里被玩家折起来的阶段（stage.order）。
 *
 * **默认全展开**：这个集合空着就是现状阅读，折叠是当场的收纳动作。
 * 不落盘、不进钥——它不是偏好，换一场战斗就清空（与 expandedBattleShips 共用
 * battleExpansionIdentity）。同一场内的被动重渲染只读这个集合、不写，
 * 所以玩家刚折起来的段不会被下一个报文弹回去。
 */
let collapsedLogStages = new Set<number>()
/**
 * 被玩家主动展开的基地防空（键见 baseDefenseFoldKey）。
 *
 * **默认收纳**（与阶段折叠正好相反：那边默认全展开）——防空已结算而人还在航行中时，
 * 主区该说的是去向点，防空只留一行摘要。展开是当场的动作，同样不落盘、不进钥，
 * 换一场战斗就清空。同一场内的被动重渲只读不写，玩家刚展开的那一套不会被下一个报文收回去。
 */
let expandedBaseDefense = new Set<string>()
let battleExpansionIdentity = ''
let lastPracticePreviewTs = 0

// ---- 战斗详情的按宿主视图状态 ----
//
// 史的复盘抽屉复用这套渲染（renderBattleReplayDetail），两个面板可以同时存在。
// 上面那组「选中阶段 / 展开行 / 血条 FLIP 标识」若只有一份，实时战斗一个新包
// 到达时主面板会按自己的 identity 把史那边 pin 住的阶段与展开行清掉（反向同理）。
// 所以按宿主各存一份：渲染/交互入口先 adopt 到工作寄存器，改完 commit 回去。
interface BattlePaneViewState {
  selectedLogStage: number | null
  logStageIdentity: string
  lastBarFlipIdentity: string
  logExpanded: boolean
  expandedBattleShips: Set<string>
  collapsedLogStages: Set<number>
  expandedBaseDefense: Set<string>
  battleExpansionIdentity: string
  dropCellFilter: number | null
  dropFilterSortieStart: number
}
const battlePaneStates = new WeakMap<HTMLElement, BattlePaneViewState>()
const adoptBattlePaneState = (pane: HTMLElement) => {
  let state = battlePaneStates.get(pane)
  if (!state) {
    state = {
      selectedLogStage: null,
      logStageIdentity: '',
      lastBarFlipIdentity: '',
      logExpanded: false,
      expandedBattleShips: new Set(),
      collapsedLogStages: new Set(),
      expandedBaseDefense: new Set(),
      battleExpansionIdentity: '',
      dropCellFilter: null,
      dropFilterSortieStart: 0,
    }
    battlePaneStates.set(pane, state)
  }
  selectedLogStage = state.selectedLogStage
  logStageIdentity = state.logStageIdentity
  lastBarFlipIdentity = state.lastBarFlipIdentity
  logExpanded = state.logExpanded
  expandedBattleShips = state.expandedBattleShips // 同一 Set 引用，增删直接落回
  collapsedLogStages = state.collapsedLogStages // 同上：同一引用，不必 commit
  expandedBaseDefense = state.expandedBaseDefense // 同上
  battleExpansionIdentity = state.battleExpansionIdentity
  dropCellFilter = state.dropCellFilter
  dropFilterSortieStart = state.dropFilterSortieStart
}
const commitBattlePaneState = (pane: HTMLElement) => {
  const state = battlePaneStates.get(pane)
  if (!state) return
  state.selectedLogStage = selectedLogStage
  state.logStageIdentity = logStageIdentity
  state.lastBarFlipIdentity = lastBarFlipIdentity
  state.logExpanded = logExpanded
  state.battleExpansionIdentity = battleExpansionIdentity
  state.dropCellFilter = dropCellFilter
  state.dropFilterSortieStart = dropFilterSortieStart
}

const historyTitle = (entry: BattleSnapshotSummary): string => {
  if (entry.practice) return `演习${entry.rank ? ` · ${entry.rank}` : ''}`
  const map = mapCodeOf(entry.map)
  return `${map} · ${entry.isBoss ? 'Boss' : `点位 ${entry.cell}`}${entry.rank ? ` · ${entry.rank}` : ''}`
}

const loadBattleHistory = async (rerender = true) => {
  if (historyLoading) return
  historyLoading = true
  try {
    battleHistory = await queryBattleSnapshots(40)
  } catch (error) {
    console.warn('[kanso] 战斗快照索引读取失败', error)
  } finally {
    historyLoading = false
    if (rerender && diPane) render(diPane)
  }
}

// 打开历史战斗失败要在面板上说，不能只写 console——正式包没有 DevTools，
// 用户看到的只是「点了没反应」。史那边同类场景已有 UI 错误态，这里对齐口径。
let replayOpenError: string | null = null

// 回放时航迹用的「这次出击已知最全的路径」。战斗快照存的是打那一战那一刻的
// sortie——节点只到当时走到的位置，直接拿它画航迹，回放就成了单行道：
// 后面的点不在条上，只能先返回实时再点（2026-08-12 用户实锤）。
// 同一次出击若还在实时状态用 mg.sortie（最全）；否则异步取同 run 编号最大的
// 那份快照的 sortie。
//
// 这份状态跟 chron 一样有两个宿主：镝面板（openBattleSnapshot 打开那一刻拉）
// 与史的复盘抽屉（就地换片，压根不经过 openBattleSnapshot）。原先是一个单例
// 变量、只在镝那条路上赋值，于是抽屉里永远只有快照自带的那截路径——
// 用户 2026-08-12 判过的那条「单行道」在抽屉里原样复发：选了早节点，
// 晚于这一战的点从条上消失，只能往回走。
//
// 改成按**快照 id** 键控的小缓存（LRU 8：抽屉里沿着航迹连点几场也够用），
// 两个宿主共用同一份，谁先拉到谁落地。三态都是落地态：
//   loading —— 已经发出去了，别再发第二遍；
//   ready   —— 拿到了。仍旧带着 sortieId：拿错 run 的路径比路径短更糟，
//              键已经保证了归属，这一层是把那条口径写在结构里；
//   failed  —— 墓碑。渲染触发的加载最怕「失败→重画→再拉」的自激循环，
//              失败必须落地留痕，不能指望「下次再说」。
type RunTrailEntry =
  | { state: 'loading' }
  | { state: 'ready'; sortieId: number; sortie: SortieView }
  | { state: 'failed' }

const RUN_TRAIL_MAX = 8
const runTrailBySnapshot = new Map<number, RunTrailEntry>()

/** 读一条。Map 的插入序就是淘汰序：读一次就挪到末尾（同 chronFor 的手法） */
const runTrailFor = (snapshotId: number): RunTrailEntry | undefined => {
  const found = runTrailBySnapshot.get(snapshotId)
  if (!found) return undefined
  runTrailBySnapshot.delete(snapshotId)
  runTrailBySnapshot.set(snapshotId, found)
  return found
}

const rememberRunTrail = (snapshotId: number, entry: RunTrailEntry) => {
  runTrailBySnapshot.delete(snapshotId)
  runTrailBySnapshot.set(snapshotId, entry)
  for (const oldest of runTrailBySnapshot.keys()) {
    if (runTrailBySnapshot.size <= RUN_TRAIL_MAX) break
    runTrailBySnapshot.delete(oldest)
  }
}

const replayTrailSortie = (snapshot: BattleSnapshot): SortieView => {
  const live = mg.sortie
  if (
    live &&
    !live.practice &&
    live.mapArea === snapshot.sortie.mapArea &&
    live.mapNo === snapshot.sortie.mapNo &&
    snapshot.ts >= live.startTs &&
    snapshot.ts <= live.updatedTs + 300000
  ) {
    return live
  }
  const cached = runTrailFor(snapshot.id)
  if (cached?.state === 'ready' && cached.sortieId === snapshot.sortieId) return cached.sortie
  return snapshot.sortie
}

/**
 * 把这张快照所属出击的完整航迹拉齐，就绪后调 rerender。
 * 两个宿主都走这里，rerender 各传各的（镝重画自己的面板，嵌入宿主重画自己那格）。
 */
const ensureReplayRunTrail = (snapshot: BattleSnapshot, rerender: () => void) => {
  if (runTrailFor(snapshot.id)) return // loading / ready / failed 都是落地态，不再重发
  const siblings = battleHistory.filter(
    (entry) => !entry.practice && entry.sortieId === snapshot.sortieId,
  )
  const last = siblings.reduce<BattleSnapshotSummary | null>(
    (best, entry) => (!best || entry.battleNo > best.battleNo ? entry : best),
    null,
  )
  // 自己就是索引里这次出击的最后一战（或索引还没覆盖到同 run 的别场）：
  // 快照自带的 sortie 已经是手上最全的，不落记录——索引长出新的一战时下一次
  // 渲染自然会再看一眼。这一步只过一遍内存里那几十条，不发 IPC，也就没有
  // 「失败→重画→再拉」可言，用不着墓碑。
  if (!last || last.id === snapshot.id) return
  const pending: RunTrailEntry = { state: 'loading' }
  rememberRunTrail(snapshot.id, pending)
  void queryBattleSnapshot(last.id)
    .then((full) => {
      // 回包落地前先认格子：这一格可能已被 LRU 淘汰又重建，乱序回包一律丢弃
      if (runTrailBySnapshot.get(snapshot.id) !== pending) return
      if (!full) {
        // 同 run 的末场刚被滚动清理掉了——这也是「问不出来」，一样立墓碑
        rememberRunTrail(snapshot.id, { state: 'failed' })
        return
      }
      rememberRunTrail(snapshot.id, {
        state: 'ready',
        sortieId: snapshot.sortieId,
        sortie: full.sortie,
      })
      rerender()
    })
    .catch((error) => {
      if (runTrailBySnapshot.get(snapshot.id) !== pending) return
      // 取不到就用快照自己的路径，航迹短一点但不出错——不过还是要留声，
      // 静默吞掉的话「回放航迹莫名其妙变短」就查不出是账本读失败
      rememberRunTrail(snapshot.id, { state: 'failed' })
      console.warn('[kanso] di: 同次出击最末快照读取失败', error)
    })
}

const openBattleSnapshot = async (id: number) => {
  try {
    const snapshot = await queryBattleSnapshot(id)
    if (!snapshot) {
      replayOpenError = '这场战斗的本地记录已清理'
      activateModule('di')
      if (diPane) render(diPane)
      return
    }
    replayOpenError = null
    replay = snapshot
    // 镝这一路的触发时机一字未动：打开那一刻拉一次。
    // 航迹到手时用户可能已经换看别的战斗了——只在还是这一场时重画。
    ensureReplayRunTrail(snapshot, () => {
      if (replay?.id === snapshot.id && diPane) render(diPane)
    })
    activateModule('di')
    if (diPane) render(diPane)
  } catch (error) {
    console.warn('[kanso] 战斗快照读取失败', error)
    replayOpenError = '战斗记录读取失败。'
    activateModule('di')
    if (diPane) render(diPane)
  }
}

// 演习名簿。原先这五个对手只活在顶栏那个 title 悬停文本里——点不动、看不到战绩、
// 也看不出快照是不是这一轮的。M2 的「演习卡」本来就是列在遗留里的一项，
// 銮（提督室）退役后它没跟着搬家，就这么留在了悬停文本里。
//
// 放在镝的空闲态：演习就是战斗，而这一格本来只有一段说明文字。
// 只读纪律照旧——挑谁打要在游戏里点，这里不代打，所以对手行不做成按钮。
const practiceRosterHtml = (): string => {
  const snapshot = mg.practice
  if (!snapshot?.list?.length) {
    return `<div class="prac-card empty"><b>演习名簿</b>
      <span>尚未同步：在游戏里打开一次演习页</span></div>`
  }
  const reset = nextJstTime([3, 15])
  // 快照属于本轮刷新周期才算数：演习一天刷两次（03:00 / 15:00 JST）
  const fresh = snapshot.ts > reset - 12 * 3600000
  const done = snapshot.list.filter((entry) => entry.state !== 0).length
  const total = snapshot.list.length
  const rows = snapshot.list
    .map((entry) => {
      const beaten = entry.state !== 0
      const flag = typeof entry.flagShipId === 'number'
        ? elink('mstShip', entry.flagShipId, masterShipName(entry.flagShipId))
        : '<span class="dim">旗舰未记录</span>'
      const meta = [entry.rank ? esc(entry.rank) : '', typeof entry.level === 'number' ? `Lv${entry.level}` : '']
        .filter(Boolean)
        .join(' · ')
      return `<div class="prac-row${beaten ? ' done' : ''}">
        <span class="mark">${beaten ? '✓' : '○'}</span>
        <span class="nm">${esc(entry.name)}</span>
        <span class="meta">${meta}</span>
        <span class="flag">${flag}</span>
      </div>`
    })
    .join('')
  const record = mg.record
  const tally = record && (record.practiceWin || record.practiceLose)
    ? `<span title="游戏官方生涯累计，打开战绩页时自然同步">生涯 ${record.practiceWin}胜${record.practiceLose}负${
        record.practiceRate != null ? ` · ${record.practiceRate}%` : ''
      }</span>`
    : '<span class="dim" title="打开一次游戏的战绩页即可同步">生涯战绩未同步</span>'
  return `<div class="prac-card${fresh ? '' : ' stale'}">
    <div class="prac-head">
      <b>演习名簿</b>
      <span class="cnt${fresh && done < total ? ' pending' : ''}">${fresh ? `未打 ${total - done}/${total}` : '记录已过期'}</span>
      <span class="dim">${fmtTime(snapshot.ts)} 同步</span>
      <span class="eta">刷新 <b data-cds="${reset}">${fmtCountdownShort(reset)}</b></span>
    </div>
    <div class="prac-rows">${rows}</div>
    <div class="prac-foot">${tally}</div>
  </div>`
}

// 推荐练级（2026-08-12 用户提议）：演习就是练级场，切到演习页时顺手给出
// 「还差几级就能改造」的在籍舰娘。单向改造与双向（可逆）形态切换分列，
// 排序越临近越靠前——逻辑在 practice-leveling.ts（纯函数，直接进测试）。
// 「按等级/按经验」子分类（2026-08-13 用户提议）：级差不等价于经验差，
// 两个口径分别给，选择跨会话记住。
const LEVELING_ROWS_CAP = 8
let levelingOrder: LevelingOrder = uiGet<LevelingOrder>('di.levelingOrder', 'level')
// 「最终改造筛选」（2026-08-17 用户提议）：只看下一段改造就是链尾的，
// 把「按经验」里刷屏的早期改一低级船筛掉。判据见 practice-leveling.ts
let levelingFinalOnly = uiGet<boolean>('di.levelingFinal', false)
const levelingRowHtml = (row: LevelingRow): string => `<div class="lvl-row">
    <span class="nm">${elinkHtml('ship', row.rosterId, entityNameHtml('ship', row.mstId, masterShipName(row.mstId), { compact: true }))}${row.favorite ? '<i class="fav-mini" title="已收藏 · 置顶显示">★</i>' : ''}</span>
    <span class="lv">Lv${row.level}</span>
    <span class="to">→</span>
    <span class="tgt">${elink('mstShip', row.targetMstId, masterShipName(row.targetMstId))}</span>
    <span class="need">Lv${row.targetLevel}</span>
    <span class="gap">差 <b>${row.gap}</b> 级</span>
    <span class="exp" title="到改造等级还差的总经验">${row.expGap != null ? `总${row.expGap.toLocaleString()}` : ''}</span>
  </div>`
const levelingGroupHtml = (title: string, rows: LevelingRow[]): string => {
  if (!rows.length) return ''
  const more =
    rows.length > LEVELING_ROWS_CAP
      ? `<div class="lvl-more">还有 ${rows.length - LEVELING_ROWS_CAP} 艘</div>`
      : ''
  // 进阶分组置顶（2026-08-18 用户拍板）：排序已保证 收藏→进阶→初段，这里只在
  // 可见区间内标出「初段」分界——低级链尾船整组沉到线下，不筛掉、不藏内容
  const visible = rows.slice(0, LEVELING_ROWS_CAP)
  const boundary = visible.findIndex((row) => !row.favorite && !row.advanced)
  const rowsHtml = visible
    .map(
      (row, i) =>
        `${
          i === boundary && boundary > 0
            ? '<div class="lvl-tier" title="目标是链上第一段改，改造等级不到 45">—— 初段改造 ——</div>'
            : ''
        }${levelingRowHtml(row)}`,
    )
    .join('')
  return `<div class="lvl-group">
    <div class="lvl-gh"><b>${esc(title)}</b></div>
    ${rowsHtml}${more}
  </div>`
}
const practiceLevelingHtml = (): string => {
  if (!Object.keys(mg.master.ships).length || !Object.keys(mg.ships).length) return ''
  // 「总xxxx」经验差要等级经验表；矿脉包到手后重渲补上（表未就绪时留空，不猜）
  ensureLevelExpLode(() => {
    if (diPane) render(diPane)
  })
  // 收藏置顶要链根表；同款「就绪后重渲」节奏
  ensureFavoriteRoots(() => {
    if (diPane) render(diPane)
  })
  const afterOf = (id: number) => mg.master.ships[id]?.afterShipId ?? 0
  // 进阶分组要段位图（形态→链上第几段），全库一遍正向走链，每次渲染重建也够便宜
  const stageOf = buildRemodelStageMap(
    Object.entries(mg.master.ships).map(([id, master]) => ({
      id: Number(id),
      afterId: master.afterShipId ?? 0,
    })),
  )
  const inputs = Object.values(mg.ships).map((ship) => {
    const master = mg.master.ships[ship.shipId]
    const afterLv = master?.afterLv ?? 0
    return {
      rosterId: ship.id,
      mstId: ship.shipId,
      level: ship.lv,
      afterShipId: master?.afterShipId ?? 0,
      afterLv,
      // 实例收藏（我这一艘）∪ 图鉴链根收藏，与列表同一判据
      favorite: isFavoriteOwnedShip(ship),
      // 可逆转换的回边不算「下一改装」——与图鉴/列表的口径一致
      progressive: progressiveRemodelOf(ship) != null,
      // 「最终改造」筛选判据：下一目标之后是否再无更进一步的单向改造
      targetFinal:
        master && master.afterShipId > 0
          ? isFinalRemodelTarget(master.afterShipId, afterOf)
          : false,
      // 进阶分组判据：改二及以上，或 Lv45+ 的高级改一（口径见 practice-leveling.ts）
      advanced:
        master && master.afterShipId > 0
          ? isAdvancedRemodelTarget(master.afterShipId, afterLv, stageOf, afterOf)
          : false,
      expGap:
        afterLv > ship.lv
          ? expNeededTo({ lv: ship.lv, expTotal: ship.expTotal, expNext: ship.expNext }, afterLv)
          : null,
    }
  })
  const { oneWay, reversible } = levelingGroups(inputs, levelingOrder, {
    finalOnly: levelingFinalOnly,
  })
  const body = oneWay.length || reversible.length
    ? `${levelingGroupHtml('单向改造', oneWay)}
       ${levelingGroupHtml('双向转换', reversible)}`
    : levelingFinalOnly
      ? '<div class="lvl-none">这个筛选下没有匹配</div>'
      : '<div class="lvl-none">仓库里的舰娘都到了下一段改造等级，没有练级缺口</div>'
  const orderChip = (order: LevelingOrder, label: string, tip: string) =>
    `<i class="${levelingOrder === order ? 'on' : ''}" data-act="lvl-order" data-order="${order}" role="button" title="${tip}">${label}</i>`
  return `<div class="lvl-card">
    <div class="lvl-head"><b>推荐练级</b>
      <span class="lvl-order"><i class="fin${levelingFinalOnly ? ' on' : ''}" data-act="lvl-final" role="button" title="只看下一段改造就是链尾的">最终改造</i>${orderChip('level', '按等级', '按还差的等级数排，同差距等级高的在前')}${orderChip('exp', '按经验', '按还差的总经验排 · 不足一级也计入 · 无值排末')}</span>
    </div>
    ${body}
  </div>`
}

const emptyHtml = () => `
  <div class="di-empty">
    <div class="t">战斗详情</div>
    ${practiceRosterHtml()}
    ${practiceLevelingHtml()}
  </div>`

const renderBattlePane = (
  pane: HTMLElement,
  snapshot: BattleSnapshot | null,
  force = false,
  embedded = false,
) => {
  if (!force && !pane.classList.contains('active')) return
  adoptBattlePaneState(pane)
  renderingEmbedded = embedded
  const s = snapshot?.sortie ?? mg.sortie
  const practicePreview = !!(s?.practice && s.practiceOpponent && !s.battle)
  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）。这里用裸版 applyPaneHtml：
  // 血条的两拍动画要在换块前读旧宽度、换块后拨回去，两段必须紧贴着这一次 innerHTML。
  withViewStateKept(pane, () => {
    if (!s) {
      applyPaneHtml(pane, 'di', `<div class="di-app empty-view"><div class="battle-col">${emptyHtml()}</div></div>`)
      return
    }
    const b = s.battle
    if (practicePreview) {
      applyPaneHtml(pane, 'di', `<div class="di-app practice-preview-mode${pane.clientWidth < 700 ? ' narrow' : ''}">
        <div class="battle-col">
          ${trailHtml(s)}
          ${verdictHtml(s)}
          ${practiceOpponentPreviewHtml(s)}
        </div>
      </div>`)
      return
    }
    ensureChron(s, () => renderBattlePane(pane, snapshot, force, embedded))
    // 嵌入宿主（史的复盘抽屉）就地换片走的是它自己的通道，不经过
    // openBattleSnapshot，完整航迹没人替它拉——于是抽屉里选了早节点，
    // 晚于这一战的点就从航迹上消失，只能往回走（跟 2026-08-12 判过的
    // 那条「单行道」同款）。镝自己仍由 openBattleSnapshot 触发，这里只补嵌入这一路。
    if (embedded && snapshot) {
      ensureReplayRunTrail(snapshot, () => renderBattleReplayDetail(pane, snapshot))
    }
    const identity = `${snapshot?.id ?? 'live'}:${s.startTs}:${s.battleCount}`
    if (identity !== battleExpansionIdentity) {
      battleExpansionIdentity = identity
      expandedBattleShips.clear()
      collapsedLogStages.clear()
      expandedBaseDefense.clear()
    }
    // 玩家点过流水某一行，血条就 pin 在那儿；换一场、或本场结算落定时回到跟随最新。
    // 实时观战期间不重置——那正是「跟着打到哪就看到哪」有用的时候。
    const stageIdentity = `${identity}:${b?.result ? 'done' : 'live'}`
    if (stageIdentity !== logStageIdentity) {
      logStageIdentity = stageIdentity
      selectedLogStage = null
    }
    if (b) renderedBattles.set(pane, b)
    else renderedBattles.delete(pane)
    // 同一场战斗的重渲染（新阶段的报文到了）也要把两拍动画跑出来：
    // innerHTML 重建后元素全新、过渡不会自己跑，所以先记下旧条的样子，
    // 重建后把条子拨回旧状态，再动画到新状态。只在跟随最新时做——
    // 玩家 pin 在某一阶段时画面本来就不动。
    const priorBars = new Map<string, { solid: number; ghost: number; solidClass: string }>()
    if (b && identity === lastBarFlipIdentity && selectedLogStage == null) {
      for (const brow of pane.querySelectorAll<HTMLElement>('.brow[data-battle-index]')) {
        const solid = brow.querySelector<HTMLElement>('.hpx .bar .rm')
        if (!solid) continue
        const ghost = brow.querySelector<HTMLElement>('.hpx .bar .dl')
        priorBars.set(`${brow.dataset.battleSide}:${brow.dataset.battleIndex}`, {
          solid: parseFloat(solid.style.width) || 0,
          ghost: ghost ? parseFloat(ghost.style.width) || 0 : 0,
          solidClass: solid.className,
        })
      }
    }
    lastBarFlipIdentity = identity
    // 主体这一层的战斗：防空收纳时是 null，下面四段照原来的三元自然退回航行态。
    const bodyBattle = bodyBattleOf(s)
    const committed = applyPaneHtml(pane, 'di', `<div class="di-app${pane.clientWidth < 700 ? ' narrow' : ''}">
      <div class="battle-col">
        ${
          replayOpenError
            ? `<div class="battle-replay-note replay-error">${esc(replayOpenError)}</div>`
            : ''
        }
        ${
          snapshot
            ? `<div class="battle-replay-note">本地复盘 · ${esc(fmtDateTime(snapshot.ts))}
                ${embedded ? '' : '<button data-battle-live>返回实时</button>'}</div>`
            : ''
        }
        ${trailHtml(snapshot ? replayTrailSortie(snapshot) : s)}
        ${verdictHtml(s)}
        ${bodyBattle ? airlineHtml(bodyBattle, s) : ''}
        ${bodyBattle ? arenaHtml(bodyBattle, s) : ''}
        ${bodyBattle ? resultStripHtml(bodyBattle) : ''}
        ${bodyBattle ? logHtml(bodyBattle, logExpanded) : '<div class="log"><div class="log-h" style="color:var(--dim)">等待战斗</div></div>'}
      </div>
      <aside class="sidebar">
         ${preBattleIntelHtml(s)}
         ${sortieStatCardHtml(s)}
        ${navCardHtml(s)}
        ${dropPoolCardHtml(s)}
        ${dropCardHtml(s)}
        <div class="note9"><span class="credit-mark" title="个人战绩保存在本地遭遇志 ｜ 已确认信息来自离线海域资料 ｜ 海图来自离线海图资料">源</span></div>
      </aside>
    </div>`)
    // 没换 DOM 就没有「新元素」要拨：条子还是上一帧那批，动画不必重来
    if (!committed) return
    // 拨回旧状态（关过渡免得这一步自己也动），下一帧再两拍动画到刚渲染出的新状态
    if (priorBars.size) {
      for (const brow of pane.querySelectorAll<HTMLElement>('.brow[data-battle-index]')) {
        const prior = priorBars.get(`${brow.dataset.battleSide}:${brow.dataset.battleIndex}`)
        const bar = brow.querySelector<HTMLElement>('.hpx .bar')
        const solid = bar?.querySelector<HTMLElement>('.rm')
        const ghost = bar?.querySelector<HTMLElement>('.dl')
        if (!prior || !bar || !solid || !ghost) continue
        const target: HpBarTarget = {
          solidPct: parseFloat(solid.style.width) || 0,
          ghostPct: parseFloat(ghost.style.width) || 0,
          emptyPct:
            parseFloat(bar.querySelector<HTMLElement>('.dd')?.style.width ?? '') || 0,
          solidClass: solid.className.replace(/^rm\s*/, ''),
        }
        if (
          Math.abs(prior.solid - target.solidPct) < 0.5 &&
          Math.abs(prior.ghost - target.ghostPct) < 0.5
        ) {
          continue
        }
        for (const seg of bar.querySelectorAll<HTMLElement>('span')) seg.style.transition = 'none'
        solid.className = prior.solidClass
        solid.style.width = `${prior.solid}%`
        ghost.style.width = `${prior.ghost}%`
        bar
          .querySelector<HTMLElement>('.dd')
          ?.style.setProperty('width', `${Math.max(0, 100 - prior.solid - prior.ghost)}%`)
        void bar.offsetWidth
        for (const seg of bar.querySelectorAll<HTMLElement>('span')) seg.style.transition = ''
        animateHpBar(bar, target)
      }
    }
  })
  commitBattlePaneState(pane)
}

const render = (pane: HTMLElement, force = false) => {
  renderBattlePane(pane, replay, force)
  // 浮层挂在 body 下，位置只能在 DOM 落定之后按箭头现算。
  // 面板看不见（切走标签/收起坞）时锚点 rect 全 0，浮层会被钉到屏幕左上角
  // 且盖住别的模块——不可见就收起，回来（active 后必有一次 render）再摆。
  const paneVisible = pane.isConnected && pane.offsetParent !== null
  const sortie = replay?.sortie ?? mg.sortie
  if (paneVisible && sortieMapOpen && sortie && !sortie.practice) placeSeaPop(pane, sortie)
  else closeSeaPop()
}

// 回顾窗口复用镝的唯一一套战斗详情渲染，不切换坞位，也不把详情画到遮罩下。
export const renderBattleReplayDetail = (pane: HTMLElement, snapshot: BattleSnapshot) => {
  initUsedEquipmentPopover()
  renderBattlePane(pane, snapshot, true, true)
}

/**
 * 海图浮层：挂在 <body> 下，不放进面板里。
 *
 * 两条都试过、都不行：
 *   · absolute —— .trail 与 .battle-col 都有 overflow:hidden（节点链横向滚、
 *     战斗列纵向滚），浮层直接被裁掉；
 *   · fixed 放在面板内 —— .ws-pane 自带 transform（哪怕是 matrix(1,0,0,1,0,0)），
 *     那就足以成为 fixed 的包含块，于是「相对视口」变成「相对面板」，
 *     再叠上 1.15 的界面缩放，实测算出 left:1770px 却渲染到 x=3514，飞出屏幕。
 * 所以跟 Peek 卡一样挂到 body：既不被裁，也没有包含块可言。
 */
let seaPopEl: HTMLElement | null = null

const closeSeaPop = () => {
  seaPopEl?.remove()
  seaPopEl = null
}

const placeSeaPop = (pane: HTMLElement, sortie: SortieView) => {
  const anchor = pane.querySelector<HTMLElement>('[data-sortie-map]')
  if (!anchor || !sortieMapOpen) {
    closeSeaPop()
    return
  }
  if (!seaPopEl) {
    seaPopEl = document.createElement('div')
    seaPopEl.className = 'sea-pop'
    document.body.appendChild(seaPopEl)
  }
  seaPopEl.innerHTML = seaCardHtml(sortie)
  const rect = anchor.getBoundingClientRect()
  const width = seaPopEl.offsetWidth
  const height = seaPopEl.offsetHeight
  let left = rect.left - 6
  let top = rect.bottom + 6
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6)
  seaPopEl.style.left = `${Math.max(8, left)}px`
  seaPopEl.style.top = `${Math.max(8, top)}px`
  seaPopEl.style.visibility = 'visible'
}

const handleBattlePaneInteraction = (
  pane: HTMLElement,
  target: HTMLElement,
  rawRerender: () => void,
  allowLive: boolean,
  // 航迹节点点开另一场快照时走谁。镝自己走 openBattleSnapshot（切到镝、换 replay）；
  // 嵌入宿主传自己的，就地在宿主里换快照，不把工作区拽走。
  openSnapshot: (id: number) => void = openBattleSnapshot,
): boolean => {
  adoptBattlePaneState(pane)
  // 重渲染前必须先 commit：renderBattlePane 开头会重新 adopt，
  // 不落回去的话这次交互改的状态会被旧值盖掉
  const rerender = () => {
    commitBattlePaneState(pane)
    rawRerender()
  }
  if (target.closest('[data-sortie-map]')) {
    sortieMapOpen = !sortieMapOpen
    rerender()
    return true
  }
  // 航迹节点点击回顾（2026-08-12 用户提议）：默认走 openBattleSnapshot 的既有回放通道；
  // 嵌入宿主换成自己的换片逻辑（见上面 openSnapshot 的注释）
  const trailNode = target.closest<HTMLElement>('.tn[data-replay-id]')
  if (trailNode) {
    void openSnapshot(Number(trailNode.dataset.replayId))
    return true
  }
  if (allowLive && target.closest('[data-battle-live]')) {
    replay = null
    replayOpenError = null
    rerender()
    return true
  }
  const shipRow = target.closest<HTMLElement>('.brow[data-battle-side][data-battle-index]')
  if (shipRow && !target.closest('.el')) {
    const side = Number(shipRow.dataset.battleSide)
    const index = Number(shipRow.dataset.battleIndex)
    if ((side === 0 || side === 1) && Number.isInteger(index)) {
      const key = `${side}:${index}`
      if (expandedBattleShips.has(key)) expandedBattleShips.delete(key)
      else expandedBattleShips.add(key)
      rerender()
    }
    return true
  }
  const el = target.closest<HTMLElement>('[data-act]')
  if (!el) return false
  const act = el.dataset.act
  if (act === 'lvl-order') {
    const order: LevelingOrder = el.dataset.order === 'exp' ? 'exp' : 'level'
    if (order !== levelingOrder) {
      levelingOrder = order
      uiSet('di.levelingOrder', order)
      rerender()
    }
    return true
  }
  if (act === 'lvl-final') {
    levelingFinalOnly = !levelingFinalOnly
    uiSet('di.levelingFinal', levelingFinalOnly)
    rerender()
    return true
  }
  if (act === 'drop-confirmed-expand') {
    const key = el.dataset.dropKey
    if (!key) return true
    if (expandedConfirmedDrops.has(key)) expandedConfirmedDrops.delete(key)
    else expandedConfirmedDrops.add(key)
    rerender()
    return true
  }
  if (act === 'drop-cell-filter') {
    const raw = el.dataset.dropCell
    const next = raw ? Number(raw) : null
    dropCellFilter = dropCellFilter === next ? null : next
    rerender()
    return true
  }
  if (act === 'log-toggle') {
    logExpanded = !logExpanded
    rerender()
    return true
  }
  if (act === 'log-fold') {
    const stage = Number(el.dataset.logFold)
    if (!Number.isInteger(stage)) return true
    if (collapsedLogStages.has(stage)) collapsedLogStages.delete(stage)
    else collapsedLogStages.add(stage)
    rerender()
    return true
  }
  if (act === 'bd-tuck') {
    const b = (replay?.sortie ?? mg.sortie)?.battle
    if (!b || b.kind !== 'baseDefense') return true
    const key = baseDefenseFoldKey(b)
    if (expandedBaseDefense.has(key)) expandedBaseDefense.delete(key)
    else expandedBaseDefense.add(key)
    rerender()
    return true
  }
  if (act === 'log-stage') {
    const raw = el.dataset.logStage
    const next = raw ? Number(raw) : null
    // 再点一次已选中的行 = 回到跟随最新
    selectedLogStage = next != null && next === selectedLogStage ? null : next
    commitBattlePaneState(pane) // 就地更新不走重渲染，状态也要落回宿主
    applySelectedLogStage(pane)
    return true
  }
  return false
}

interface HpBarTarget {
  solidPct: number
  ghostPct: number
  emptyPct: number
  solidClass: string
}

const setBarWidths = (bar: HTMLElement, target: HpBarTarget) => {
  const remain = bar.querySelector<HTMLElement>('.rm')
  if (remain) {
    remain.className = `rm ${target.solidClass}`
    remain.style.width = `${target.solidPct}%`
  }
  bar.querySelector<HTMLElement>('.dl')?.style.setProperty('width', `${target.ghostPct}%`)
  bar.querySelector<HTMLElement>('.dd')?.style.setProperty('width', `${target.emptyPct}%`)
}

/** 两拍之间的接力定时器。同一根条子重入时先取消上一拍，快速连点不会叠帧。 */
const barBeatTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
// --motion-view 200ms + 一点余量。用定时器接力而不是 transitionend：
// 旧虚条宽度本来就是 0 时那个事件永远不来。
const BAR_BEAT_MS = 230

/**
 * 血条两拍动画：第一拍把旧虚条扣干（实血原地不动——「虚部分落到上一段结算位」），
 * 第二拍实血落到新位置、接出新虚条，数字与破损标签随第二拍一起结算。
 */
const animateHpBar = (bar: HTMLElement, target: HpBarTarget, settle?: () => void) => {
  const prior = barBeatTimers.get(bar)
  if (prior != null) clearTimeout(prior)
  const finish = () => {
    barBeatTimers.delete(bar)
    setBarWidths(bar, target)
    settle?.()
  }
  const ghost = bar.querySelector<HTMLElement>('.dl')
  const ghostNow = ghost ? parseFloat(ghost.style.width) || 0 : 0
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !ghost || ghostNow <= 0.5) {
    finish()
    return
  }
  ghost.style.width = '0%'
  const timer = setTimeout(() => {
    if (bar.isConnected) finish()
    else barBeatTimers.delete(bar)
  }, BAR_BEAT_MS)
  barBeatTimers.set(bar, timer)
}

/**
 * 就地把编队血条挪到选中的那一阶段。
 *
 * 不重渲染整面板——`innerHTML` 一换，浏览器眼里全是新元素，width 的过渡根本不会跑。
 * 血条那几截的宽度、数字与破损标签都是能原地改的，改完 CSS 自己补动画。
 */
const applySelectedLogStage = (pane: HTMLElement) => {
  const battle = renderedBattles.get(pane) ?? null
  for (const row of pane.querySelectorAll<HTMLElement>('.lrow[data-log-stage]')) {
    const stage = Number(row.dataset.logStage)
    row.classList.toggle('on', selectedLogStage != null && stage === selectedLogStage)
  }
  const log = pane.querySelector('.log')
  log?.classList.toggle('pinned', selectedLogStage != null)
  if (!battle) return
  for (const brow of pane.querySelectorAll<HTMLElement>('.brow[data-battle-index]')) {
    const side = Number(brow.dataset.battleSide) as 0 | 1
    const index = Number(brow.dataset.battleIndex)
    // 编队区只有我方（sideRowsHtml(b.fShips, 0)）与敌方两栏，NPC 友军从不进来，
    // 所以这里也不该去合 friendShips——那份合并既够不到任何一行，又是旧快照
    // （friendShips 缺字段）唯一的展开抛点。
    const ships = side === 1 ? battle.eShips : battle.fShips
    const ship = ships.find((candidate) => candidate.index === index)
    const timeline = ship ? shipHpTimeline(battle.attacks, ship, side === 1, battle.practice) : null
    const bar = brow.querySelector<HTMLElement>('.hpx .bar')
    const nums = brow.querySelector<HTMLElement>('.hpx .nums')
    if (!ship || !timeline || !bar || !nums) continue
    // 打不到的那一位没有条可拨：那一格是空轨 + 「打不到」，拨了反而会写回假的 0/1
    if (ship.unattackable) continue
    const view = shipStageView(battle, ship, timeline, selectedLogStage)
    const { solidPct, ghostPct, emptyPct, ratio } = hpBarValues(view)
    animateHpBar(bar, { solidPct, ghostPct, emptyPct, solidClass: hpClass(ratio) }, () => {
      nums.innerHTML = hpNumsHtml(view)
      // 虚条换色跟第二拍走：第一拍是把**上一个**基准的虚条扣干，那一截还属于旧含义，
      // 提前变蓝会让「扣干」这一下看着像已经在讲新阶段了
      bar.classList.toggle('pinned', view.pinned)
      brow.classList.toggle('sunk', view.sunkVisual)
      // 图跟着同一拍换：划线与破损标签都结算在这里，舰图停在上一阶段就自相矛盾了
      // （档位没变时 setShipThumbTier 自己空转，不会每拨一次都重取图）
      setShipThumbTier(brow.querySelector<HTMLElement>('.nm .ship-thumb'), {
        sunk: view.sunkVisual,
        damaged: browArtDamaged(view),
      })
    })
  }
}

/**
 * 嵌入宿主的点击入口。
 *
 * `options.openSnapshot`：航迹上点另一场时由宿主接管。不传就沿用镝的老路
 * （openBattleSnapshot → activateModule('di')），那对**镝自己**是对的，
 * 对嵌入宿主则是「点一下节点，整个工作区被拽去镝」——史的复盘抽屉因此
 * 改为传自己的换片逻辑，就地在抽屉里换成那一场。
 */
export const handleBattleReplayDetailClick = (
  pane: HTMLElement,
  snapshot: BattleSnapshot,
  target: HTMLElement,
  options?: { openSnapshot?: (id: number) => void },
): boolean =>
  handleBattlePaneInteraction(
    pane,
    target,
    () => renderBattleReplayDetail(pane, snapshot),
    false,
    options?.openSnapshot ?? openBattleSnapshot,
  )

registerModule({
  id: 'di',
  title: '战斗',
  order: 7,
  mount(pane) {
    diPane = pane
    // 人生记录窗里点了某一场（击杀簿或履历时间轴）→ 主进程把主窗拿到前面，
    // 再把快照 id 送到这里打开复盘。**必须在同步段注册**并挂退订：
    // mount 中途抛错后点「重试装配」会再走一遍，不退订就是双注册（点一场开两次）。
    const openBattleFromShipLife = (_event: unknown, rawId: unknown) => {
      const id = Number(rawId)
      if (Number.isInteger(id) && id > 0) void openBattleSnapshot(id)
    }
    ipcRenderer.on('window:ship-life-battle', openBattleFromShipLife)
    trackMountCleanup(() =>
      ipcRenderer.removeListener('window:ship-life-battle', openBattleFromShipLife),
    )
    // 玩家定的口径：这三段可折，战斗流水默认展开，另外两段默认折起来。
    // 其余卡片一概不动——右栏那些本来就短，折了反而多一次点击。
    installSectionFolding(pane, [
      {
        section: '.log',
        head: '.log-h',
        title: leadingTitle, // 「战斗流水 · 12 事件」取 · 前面那截
        only: new Set(['战斗流水']),
        openByDefault: new Set(['战斗流水']),
      },
      {
        section: '.scard',
        head: '.h',
        title: boldTitle, // 标题包在 <b> 里，后面的 .r 是计数
        only: new Set(['敌方编队', '当前点掉落']),
      },
      {
        // 机制估算的模型边界声明：默认折起来，一眼位置只留胜率与大破率。
        // 「交战前敌情」整张卡不可折（打开就要看的内容），所以折的是卡里这一段。
        section: '.prebattle-model-note',
        head: '.prebattle-model-note-h',
        title: firstTextTitle, // 段头只有「预测口径」四个字
      },
    ])
    initUsedEquipmentPopover()
    void loadBattleHistory()
    void Promise.all([loadFcd(), loadAbyssalStats(), loadRouting()])
      .then(() => render(pane))
      .catch((error) => console.warn('[kanso] di: 矿脉包读取失败', error))
    void initMapIntel().then(() => render(pane))
    void ensureFirstEncounters()
    onFirstEncountersChange(() => render(pane))
    render(pane, true)
    // 空闲态的演习名簿有刷新倒计时，得每秒走字
    onTick(() => {
      if (pane.classList.contains('active')) updateCountdowns(pane)
    })
    onMgChange((keys) => {
      if (keys.some((k) => ['sortie', 'mapGauges', 'decks', 'ships', 'master'].includes(k))) {
        const practiceTs =
          mg.sortie?.practice && !mg.sortie.battle
            ? mg.sortie.practiceOpponent?.ts ?? 0
            : 0
        if (keys.includes('sortie') && practiceTs > 0 && practiceTs !== lastPracticePreviewTs) {
          lastPracticePreviewTs = practiceTs
          replay = null
          activateModule('di')
        }
        if (keys.includes('sortie') && mg.sortie?.battle?.result) {
          void loadBattleHistory()
          // 结算这一刻遭遇志刚写完，重拉一次首见索引，「初」才可能落在当场。
          void refreshFirstEncounters()
        }
        render(pane)
      }
      // 空闲态摆着演习名簿：演习快照与战绩变了要跟着换
      if (!mg.sortie && keys.some((k) => ['practice', 'record'].includes(k))) render(pane)
    })
    new ResizeObserver(() => {
      const app = pane.querySelector('.di-app')
      if (app) app.classList.toggle('narrow', pane.clientWidth < 700)
    }).observe(pane)
    pane.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      handleBattlePaneInteraction(pane, target, () => render(pane), true)
    })
  },
  onShow() {
    if (diPane) render(diPane)
  },
})

registerEntityRoute('battle', {
  colorClass: 'e-map',
  open(ref) {
    void openBattleSnapshot(Number(ref.id))
  },
  peek(ref) {
    const entry = battleHistory.find((item) => item.id === Number(ref.id))
    if (!entry) return null
    return {
      title: historyTitle(entry),
      typeLabel: '本地战斗记录',
      lines: [
        fmtDateTime(entry.ts),
        entry.practice ? '演习' : `${entry.isBoss ? 'Boss 战' : '通常战'} · 第 ${entry.battleNo} 战`,
      ],
      primary: '打开战斗复盘',
    }
  },
})

registerEntityRoute('battleCurrent', {
  colorClass: 'e-map',
  open(ref) {
    replay = null
    activateModule('di')
    if (!diPane) return
    render(diPane)
    const rosterId = ref.num
    if (!Number.isFinite(rosterId)) return
    requestAnimationFrame(() => {
      const target = diPane?.querySelector<HTMLElement>(`[data-bship="${CSS.escape(`${rosterId}`)}"]`)
      if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.remove('focus')
      requestAnimationFrame(() => target.classList.add('focus'))
      setTimeout(() => target.classList.remove('focus'), 2200)
    })
  },
  peek() {
    const battle = mg.sortie?.battle
    if (!battle) return null
    return {
      title: mg.sortie?.practice
        ? '当前演习'
        : `当前战斗 · ${mg.sortie?.mapArea ?? '?'}-${mg.sortie?.mapNo ?? '?'}`,
      typeLabel: '实时战斗',
      lines: [
        `第 ${mg.sortie?.battleCount ?? 1} 战`,
        battle.result?.rank ? `战果 ${battle.result.rank}` : '战斗进行中',
      ],
      primary: '打开实时战斗',
    }
  },
})
