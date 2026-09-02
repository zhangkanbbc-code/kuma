// 鉴 (Ji) · 图鉴与在籍列表：舰娘 / 列表 / 装备 / 深海 / 海域 / 道具。
// 时效纪律：主数据来自 api_start2 快照，页脚标注快照时间；
// 掉落/台词/加成等第三方口径未接入前只挂牌注明来源，绝不硬造。
import {
  airThresholds,
  engagedShips,
  ensureShipStatsLode,
  fleetLos33,
  panelBonusOf,
  rawAirPower,
  shipEquipInstances,
  shipGrowthEndpointsOf,
} from '../fleet-calc'
import {
  expectedFitBonus,
  fitEquipsForShip,
  fitPackCoverageMax,
  fitPackUncovered,
  fitStatsText,
  fitTrackRows,
  FIT_PANEL_KEYS,
  FIT_STAT_LABEL,
  FIT_VIA_LABEL,
} from '../../shared/fit-bonus'
import type {
  FitBonusData,
  FitGain,
  FitGroupResolver,
  FitLoadoutItem,
  FitRule,
  FitShipView,
  FitWhoSet,
} from '../../shared/fit-bonus'
import { applyFitBonusCorrections } from '../../shared/fit-bonus-corrections'
import { applyFitBonusSupplement } from '../../shared/fit-bonus-supplement'
import {
  buildShipClassNameIndex,
  normalizeShipClassName,
  supplementShipClassNames,
} from '../../shared/ship-class-name'
import { localMapTopology, officialMapMaterialAbsent } from '../../shared/local-map-topology'
import {
  ENEMY_COMP_ANCHOR_ATTR,
  MAP_NODE_JUMP_ATTR,
  enemyCompNodes,
  enemyCompRowSelector,
} from '../../shared/map-node-jump'
import { fcdTopologyUsable } from '../../shared/fcd-topology'
import { mapGaugeSegmentLabels, mapGaugeSummaryText } from '../../shared/map-gauge-metric'
import {
  abyssVoiceSceneFamily,
  abyssVoiceSightingFor,
  type AbyssVoiceSighting,
} from '../../shared/abyss-voice-sighting'
import type { AbyssSeenMap } from '../../shared/abyss-seen'
import { mapSpecialBonusHtml } from '../map-bonus'
import {
  fitObservationRecordsOf,
  fitObservationStarLabel,
  fitObservationVerdict,
  groupFitObservations,
} from '../../shared/fit-observation'
import type {
  FitObservationRecord,
  FitObservationRow,
  FitObservationSample,
} from '../../shared/fit-observation'
import {
  forecastDeckScope,
  forecastConfirmedComps,
  forecastFleetForDeck,
  forecastFleetLabelForDeck,
  historicalRate,
} from '../combat-forecast'
import { createAbyssalNameResolver } from '../abyssal-name'
import { recordCrash, safeEach } from '../crash-guard'
import { shipThumbHtml, useItemIconHtml } from '../entity-art'
import { alvIconHtml } from '../alv-icon'
import { EQUIP_CHIPS, equipChipMatches } from '../equip-category'
import {
  HIGH_ANGLE_CATEGORY,
  HIGH_ANGLE_CATEGORY_NAME,
  effectiveEquipCategory,
} from '../../shared/equip-high-angle'
import { equippedSlotIds } from '../../shared/equipped-slots'
import { ALL_SHIP_TYPE_IDS, shipChipMatches, SHIP_CHIPS, STYPE_CN } from '../ship-category'
import { equipTypeIconHtml } from '../equip-icon'
import { countCapacitySlotitems } from '../equip-capacity'
import {
  ensureFirstEncounters,
  firstEncounterLineHtml,
  metSinceOf,
  onFirstEncountersChange,
} from '../first-encounter'
import { availableCostumeImages, availableShipImages, availableSlotItemImages, cgTypeLabel, costumeOwnerOf, isBigShipImg, mapArtManifest, markShipImageMissing, missingShipImages, noteShipArtDisplayed, remoteArtState, setShipImageGraph, shipCostumeGraphIds, shipGraphLayout, shipImageUrl, shipImageVersionOf, slotItemImageUrl } from '../kcs-image'
import { extraVoiceUrl, isPlayableVoiceId, noteVoicePlayed, previewVoiceVolume, setShipGraph, voiceFilenameOf, voicePathname, voiceState, voiceUrl } from '../kcs-voice'
import { claimPreviewPlayback, notePreviewStopped, registerPreviewPlayer } from '../preview-audio'
import { previewClickAction } from '../../shared/preview-audio'
import {
  archivedBareVoiceSlots,
  archivedExtraVoiceFiles,
  archivedVoiceTakes,
  archivedVoiceUrl,
  archivedVoiceUrlOf,
  voiceArchiveGeneration,
  voiceLitState,
} from '../voice-archive'
import {
  isVoiceAbsent,
  probeVoiceSlot,
  probeVoiceSlotDetailed,
  voiceAbsentDay,
  voiceAbsentReady,
} from '../voice-probe'
import {
  bareArchiveVoiceRows,
  countHourlyVoiceSlots,
  HOURLY_VOICE_SLOT_FIRST,
  hourlyVoicePointerTarget,
  isHourlyVoiceSlot,
  voiceSkeletonSlots,
} from '../../shared/voice-probe-plan'
import type { BareArchiveVoiceRow } from '../../shared/voice-probe-plan'
import {
  abyssArchiveKeysFor,
  abyssVoiceRowLabel,
  abyssWikiVoiceScene,
  groupAbyssVoiceFiles,
  parseAbyssVoiceFile,
} from '../../shared/abyss-voice-file'
import {
  abyssVoiceFileCandidates,
  abyssVoiceGuessCandidates,
  buildAbyssPrefixIndex,
} from '../../shared/abyss-voice-guess'
import { EXTRA_VOICE_DIRS } from '../../shared/voice-sound-path'
import {
  buildNpcVoiceBook,
  npcVoiceGroupOf,
  type NpcVoiceGroup,
} from '../../shared/npc-voice-book'
import {
  archivedArtEntriesOfShip,
  archivedArtUrl,
  artArchiveReady,
} from '../art-archive'
import { ensureMapCellLetters, mapCellLetter, mapPlaceText } from '../map-cell-letter'
import { localDropCellsText } from '../../shared/local-drop-cells'
import { legacyArchivedArt } from '../../shared/art-archive-plan'
import type { ArtArchiveEntry } from '../../shared/art-archive-plan'
import {
  collectOutcomeOf,
  seasonalTakeOffered,
  unclaimedArchiveVariants,
  variantLabelOf,
  VARIANT_TEXT_DASH,
} from '../../shared/seasonal-collect'
import type { CollectOutcome } from '../../shared/seasonal-collect'
import {
  buildShipFormCodeMap,
  planVoiceCorrections,
  planVoiceFallbackChain,
  resolveVoiceSlot,
  voiceSceneOfSlot,
  voiceSlotOfKey,
} from '../../shared/voice-scene-slots'
import type { CorrectedVoiceRow, VoiceFallbackSource } from '../../shared/voice-scene-slots'
import { normalizeVoiceText } from '../../shared/voice-text'
import { voicePlaybackObservationAt } from '../../shared/voice-playback-observations'
import { ENEMY_FORMATION, formationText } from '../../shared/enemy-formation'
import { bgmPreviewHtml } from '../bgm-preview'
import { archivedMapBgmOf } from '../../shared/event-map-bgm'
import { applyScrollProfile, captureScrollProfile, combinedEscortState, commitPaneHtml, deferWhileComposing, deferWhilePressed, esc, exitWithMotion, fmtDate, fmtDateTime, fmtTime, forgetCommittedHtml, jstDayOfWeek, lodeCredit, lodeCreditMark, lodeCreditShort, masterShipName, mg, nextJstTime, onFilterInput, onMgChange, ownedHangarExpansionOf, queryLode, queryMasterRaw, queryShipMemorial, trackMountCleanup, uiGet, uiSet, withViewStateKept } from '../kernel'
import type { ScrollProfile } from '../kernel'
import { createNavHistory } from '../nav-history'
import { searchFold } from '../search-fold'
import { registerEntityRoute, elink, elinkHtml, navigate, pinEntityPeek } from '../link'
import { firstTextTitle, installSectionFolding, revealSection } from '../section-fold'
import { statRowLayered, statScale, statWidth } from '../stat-bars'
import {
  entityNameHtml as localizedEntityNameHtml,
  entityNamePlain,
  entityTermHtml,
  localizedEntityId,
  type LocalizedDomain,
} from '../localization'
import { initMapIntel } from '../map-intel'
import { activateModule, registerModule } from '../mu'
import { mountLab } from './ji-lab'
import {
  isFavoriteShipRoot,
  setShipRootNote,
  setShipRosterNote,
  shipRootNote,
  shipRosterNote,
  toggleFavoriteShipRoot,
} from '../ship-personal'
import { shipLifeDamageText } from '../../shared/ship-life-damage'
import { levelGrowth, MARRIED_LEVEL_CAP, marriageHpBonus, marriedMaxHp } from '../../shared/ship-growth'
import type { ShipGrowthKey } from '../../shared/ship-growth'
import {
  locateEquipHolders,
  locateRosterInList,
  locateShipInList,
  mountRosterView,
  refreshRosterView,
  setRosterViewOpener,
} from './qa'
import {
  invalidateStockRows,
  openEquipCleanup,
  mountStockView,
  refreshStockView,
  setStockViewOpener,
} from './equip-stock'
import { questByCode, questVerdicts, questsAwarding, questsAwardingMaterial, questsMentioning, searchInManager } from './qn'
import { QUEST_AVAILABILITY_LABEL } from '../../shared/quest-availability'
import type { QuestAvailability, QuestVerdict } from '../../shared/quest-availability'
import {
  EVENT_DIFFICULTIES,
  confirmedDropSitesOf,
  endedDropSitesOf,
  limitedLedgerInfo,
  limitedWindowText,
  limitedWindowsOf,
  localDropEraOf,
  mapDropsInfo,
  mapEnemyCompsInfo,
  mapIntelEntries,
  mapIntelGeneration,
  mapIntelMap,
  mapIntelNode,
} from '../../shared/map-intel'
import {
  buildVoiceFallbackIds,
  buildVoiceTranslationIndex,
  normalizeVoiceLine,
} from '../../shared/voice-lineage'
import {
  SHIP_NATIONALITIES,
  SHIP_NATIONALITY_UNCLASSIFIED,
  shipNationalityBucketOf,
  shipNationalityById,
  shipNationalityIdFromSortId,
} from '../../shared/ship-nationality'
import { mapFleetAllowanceLabels } from '../../shared/map-sally'
import { evaluateRoutingRules } from '../../shared/routing-engine'
import {
  estimateKcnavBranch,
  kcnavFleetComposition,
  KCNAV_STYPE_CODE,
} from '../../shared/kcnav-routing'
import { buildShipRemodelChains } from '../../shared/ship-remodel-chain'
import {
  buildHistFleetIndex,
  HIST_FLEET_KIND_LABEL,
  HIST_FLEET_KIND_ORDER,
  HIST_FLEETS,
  histFleetById,
} from '../../shared/hist-fleets'
import type { HistFleetEntry, HistFleetIndex, HistFleetMember } from '../../shared/hist-fleets'
import { PERSONAL_RATE_MIN_SAMPLES } from '../../shared/statistics'
import { summarizeEncounterForecasts } from '../../shared/combat-forecast'
import {
  resolveUseitemStock,
  USEITEM_MATERIAL_INDEX,
  type UseitemStock,
} from '../../shared/useitem-stock'
import { FIXED_ITEM_EXCHANGES } from '../../shared/item-exchange'
import {
  equipableFriendlyShipIds,
  equipableTypeRulesForShip,
} from '../../shared/equipability'

// 鉴是资料与介绍视图：这里保留可折叠日文原名；其他操作模块默认只显示中文。
const entityNameHtml = (
  domain: LocalizedDomain,
  id: number | string,
  fallbackJa = '',
  options: { compact?: boolean } = {},
): string =>
  localizedEntityNameHtml(domain, id, fallbackJa, {
    ...options,
    showOriginal: true,
  })

// 实体 → 有关任务 区块（任务库简中口径反查）
// exclude：已经在「可从任务获得」里列过的，这里不再重复（道具卷用）
// 摆在前面的是**现在能动手的**：可领奖 → 进行中 → 可以接 → 还不能接 → 已完成。
// 已完成沉底：它是「不用再管了」，占着前几行只会把能做的挤下去。
const QUEST_ORDER: Record<QuestAvailability, number> = {
  claimable: 0,
  active: 1,
  open: 2,
  locked: 3,
  unknown: 4,
  done: 5,
}

const questStatusChipHtml = (verdict: QuestVerdict | undefined): string => {
  const status = verdict?.status ?? 'unknown'
  // 周期任务的「已完成」只是本期：下期还会回来，写成「已完成」会被当成一劳永逸
  const label =
    status === 'done' && verdict?.cyclic ? '本期已完成' : QUEST_AVAILABILITY_LABEL[status]
  // done/locked 是从「不在任务表里」与前置状态推出来的，游戏没说过；
  // 其余几档（可领奖/进行中/可以接）是任务表直接给的，不能一并标成推断。
  const inferred = status === 'done' || status === 'locked'
  return `<span class="q-st ${status}">${esc(label)}${inferred ? '<i>推定</i>' : ''}</span>`
}

/** 卡在哪几条要说出来，否则「未解锁」等于没说。前置写成可点的，直接跳过去。 */
const questMissingPreHtml = (verdict: QuestVerdict | undefined): string => {
  if (verdict?.status !== 'locked' || !verdict.missingPre.length) return ''
  const pre = verdict.missingPre
    .slice(0, 3)
    .map((code) => {
      const entry = questByCode(code)
      return entry
        ? elinkHtml('quest', entry.id, esc(code))
        : `<i title="不在任务库里">${esc(code)}</i>`
    })
    .join('、')
  const more = verdict.missingPre.length > 3 ? ` 等 ${verdict.missingPre.length} 条` : ''
  return `<div class="q-rel-pre">缺 ${pre}${esc(more)}</div>`
}

/**
 * 「这件装备能从哪儿弄到」——把散在各处的获取渠道汇到一处。
 *
 * 四条各有各的现成资料，只是原先都写成正方向、也没摆在一起：
 *   开发（wiki 配方 + 你自己的实测）/ 任务奖励 / 改修更新 / 舰娘初期携带。
 *
 * **活动奖励这条给不出**：本地几份资料都没有入手方法字段——
 * kcwiki 的装备表只标能不能开发/改修，wikiwiki 的装备总页也没有，
 * 逐页抓 500 多件装备的日文 wiki 又太重。所以如实说不收录并给 wiki 链接，
 * 不拿「没列出」冒充「没有这条途径」。
 */
const equipObtainHtml = (mstId: number, jpName: string): string => {
  const cn = entityNamePlain('equip', mstId, jpName)
  const awards = questsAwarding([jpName, cn === jpName ? '' : cn])
  const verdicts = questVerdicts()
  const upgradeFrom = upgradeSourcesOf(
    Object.values((eoLode?.data ?? {}) as Record<string, EquipUpgradeRow>),
    mstId,
  )
  // kcwiki 行 + 舰页档案补缺行(kcwiki 停收的形态)——两边 ID 不重叠,直接并列
  const initialShips = initialEquipShips(
    [
      ...Object.values((kcwikiLode?.data ?? {}) as Record<string, KcwikiShipRow>),
      ...[...shipProfileByMst.values()].map((entry: any) => ({
        ID: Number(entry.shipId),
        装备: { 初期装备: Array.isArray(entry.initialEquips) ? entry.initialEquips : null },
      })),
    ],
    mstId,
  )
  const blocks: string[] = []

  if (awards.length) {
    // 任务状态与「有关任务」同一份结论，不再各判一次
    const rows = [...awards]
      .sort((left, right) => {
        const a = QUEST_ORDER[verdicts.get(left.id)?.status ?? 'unknown']
        const b = QUEST_ORDER[verdicts.get(right.id)?.status ?? 'unknown']
        return a - b || left.code.localeCompare(right.code)
      })
      .slice(0, 6)
      .map((award) => {
        const verdict = verdicts.get(award.id)
        return `<div class="ob-row">${questStatusChipHtml(verdict)}
          <span class="ob-nm">${elinkHtml('quest', award.id, `${esc(award.code)} ${entityNameHtml('quest', award.id, award.name, { compact: true })}`)}</span></div>`
      })
      .join('')
    blocks.push(`<div class="ob-grp"><div class="ob-h">任务奖励<span>${awards.length} 条</span></div>${rows}${
      awards.length > 6 ? `<div class="q-foot">另有 ${awards.length - 6} 条未展开</div>` : ''
    }</div>`)
  }

  if (upgradeFrom.length) {
    const rows = upgradeFrom
      .slice(0, 6)
      .map((source) => {
        const master = mg.master.slotitems[source.fromId]
        const name = master?.name ?? `装备 #${source.fromId}`
        return `<div class="ob-row"><span class="ob-t">改修更新</span>
          <span class="ob-nm">${elink('mstEquip', source.fromId, name)}</span>
          <span class="ob-x">更新后 ★${source.levelAfter}</span></div>`
      })
      .join('')
    blocks.push(`<div class="ob-grp"><div class="ob-h">由改修更新而来<span>${upgradeFrom.length} 种</span></div>${rows}</div>`)
  }

  if (initialShips.length) {
    const rows = initialShips
      .slice(0, 8)
      .map((shipId) => {
        const owned = isShipFamilyOwned(shipId)
        return `<span class="ob-ship${owned ? ' owned' : ''}">${elink('mstShip', shipId, masterShipName(shipId))}</span>`
      })
      .join('')
    blocks.push(`<div class="ob-grp"><div class="ob-h">舰娘初期携带<span>${initialShips.length} 艘</span></div>
      <div class="ob-ships">${rows}${initialShips.length > 8 ? `<span class="ob-more">另有 ${initialShips.length - 8} 艘</span>` : ''}</div></div>`)
  }

  if (!blocks.length) {
    return `<div class="sec"><div class="sec-h">可获取途径<span class="aux">开发 / 任务 / 改修更新 / 初期携带</span></div>
      <div class="q-foot">暂无本地获取渠道资料</div></div>`
  }
  return `<div class="sec"><div class="sec-h">可获取途径<span class="aux">开发 / 任务 / 改修更新 / 初期携带</span></div>
    ${blocks.join('')}
  </div>`
}

const relatedQuestsHtml = (
  terms: string[],
  domain: 'ship' | 'equip' | 'item',
  exclude?: Set<number>,
) => {
  const quests = questsMentioning(terms, domain).filter((q) => !exclude?.has(q.id))
  if (!quests.length) return ''
  const verdicts = questVerdicts()
  const ordered = [...quests].sort((left, right) => {
    const a = QUEST_ORDER[verdicts.get(left.id)?.status ?? 'unknown']
    const b = QUEST_ORDER[verdicts.get(right.id)?.status ?? 'unknown']
    return a - b || left.code.localeCompare(right.code)
  })
  const shown = ordered.slice(0, 8)
  const rows = shown
    .map((q) => {
      const verdict = verdicts.get(q.id)
      // 徽章与任务名同一行（挤不下就整体换行），奖励与「缺什么」各自成行。
      // 早先把三段塞进三列 grid，抽屉窄的时候名字列被挤到接近 0 宽，
      // 一个字一行，「缺 X」还跟名字抢同一格叠在一起。
      const memo = q.memo.replace(/^奖励[:：]?/, '').trim()
      return `<div class="q-rel ${verdict?.status ?? 'unknown'}">
        <div class="q-rel-head">${questStatusChipHtml(verdict)}<span class="q-rel-name">${elinkHtml('quest', q.id, `${esc(q.code)} ${entityNameHtml('quest', q.id, q.name, { compact: true })}`)}</span></div>
        ${memo ? `<div class="q-rel-memo" title="${esc(memo)}">${esc(memo)}</div>` : ''}
        ${questMissingPreHtml(verdict)}
      </div>`
    })
    .join('')
  const tally = ordered.reduce<Record<string, number>>((acc, q) => {
    const status = verdicts.get(q.id)?.status ?? 'unknown'
    acc[status] = (acc[status] ?? 0) + 1
    return acc
  }, {})
  const summary = (['claimable', 'active', 'open', 'locked', 'done'] as QuestAvailability[])
    .filter((status) => tally[status])
    .map((status) => `${QUEST_AVAILABILITY_LABEL[status]} ${tally[status]}`)
    .join(' · ')
  // 「已完成」不是游戏告诉我们的——它没有任务履历。判据见 shared/quest-availability。
  const note =
    mg.questsFullTs == null
      ? '<div class="q-foot">任务状态无法判定 · 打开游戏任务「全部」页后同步</div>'
      : ''
  return `<div class="sec"><div class="sec-h">有关任务<span class="aux">共 ${quests.length} 条${quests.length > 8 ? '（显示前 8）' : ''}</span></div>
    ${summary ? `<div class="q-rel-sum">${esc(summary)}</div>` : ''}
    ${rows}${note}</div>`
}

import type { LodeMeta } from '../kernel'
import type {
  PlayerShip,
  ShipLifeEquipment,
  ShipLifeEvent,
  ShipMemorialEntry,
  ShipMemorialReport,
  MapChronicleReport,
  MapClearFleetRow,
  FactoryStatsReport,
  NodeForecastSample,
  RouteStatsReport,
  SortieForecastReport,
} from '../../shared/mg-types'
import type { EventDifficulty } from '../../shared/map-intel'
import type { RoutingDifficulty, RoutingFleetContext } from '../../shared/routing-engine'
import { isEventMapArea, mapAreaOf, mapCodeOf, mapIdOf } from '../../shared/map-id'
import { detectEventAreas, eventContextStillOpen } from '../../shared/event-area'
import { branchTallyByLetter, pathWalkedBound } from '../../shared/route-stats'
import { improveEntryTier, improvePackCoverageMax, improvePackUncovered, initialEquipShips, upgradeSourcesOf } from '../../shared/equip-sources'
import { isShipFamilyOwned } from '../ship-ownership'
import type { EquipUpgradeRow, KcwikiShipRow } from '../../shared/equip-sources'
import { devReferenceRecipe, factoryLookup, recipeText } from '../../shared/factory-lookup'
import { routeOutlook } from '../../shared/route-outlook'
import { resolveRouteTarget } from '../../shared/route-target'
import type { RouteTargetView } from '../../shared/route-target'
import type { BranchTally } from '../../shared/route-stats'
import { abyssFamilyKey } from '../../shared/abyss-family'
import { SANDBOX_DECK_ID, sandboxDeck, sandboxRosterIds } from '../sandbox-fleet'
import {
  IMPROVE_MAX,
  improveBudgetTo,
  improveCostText,
  improveRouteTotal,
  type CostPair,
  type ImproveCosts,
  type ImproveStageCost,
} from '../../shared/improve-budget'
import { KCWIKI_ITEM_ALIAS, kcwikiUpgradeNeedAlias } from '../../shared/kcwiki-upgrade'

let pane: HTMLElement

// 后台数据回来时的重渲染统一走这里合并到同一帧。
// 一次「进到下一个点」会同时惊动整图遭遇志和整图预测两条 IPC，各自回调都直接
// render 的话，加上 onMgChange 那次，一次进点就是三遍整体 innerHTML 重建——
// 即便内容没变，重建本身（图片重新解码、整树重排）也看得见。
// 只合并被动刷新；用户点出来的那种交互仍然同步 render，手感不受影响。
let renderScheduled = false
const scheduleRender = () => {
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(() => {
    renderScheduled = false
    if (!pane?.classList.contains('active')) return
    // 用户正按在图鉴上：把这次被动重渲让到手指抬起来之后。按下与抬起之间换掉 DOM，
    // 浏览器就不会派发 click——「点了没反应」的机制就是这个（封顶见 kernel）。
    if (deferWhilePressed(pane, 'ji', () => render())) return
    // 正在用输入法打字同理，让到组合结束：换掉 DOM 会把组合会话一起换没
    if (deferWhileComposing(pane, 'ji', () => render())) return
    render()
  })
}

const rosterHost = document.createElement('div')
rosterHost.className = 'roster-embed mod-qa'
rosterHost.id = 'ji-roster-host'
let rosterMounted = false
// 仓库卷同样是持久节点：它自带筛选与选中态，每次切卷都重建等于把用户的
// 筛选条件抹掉，还会丢掉表格的滚动位置。
const stockHost = document.createElement('div')
stockHost.className = 'stock-embed mod-es'
stockHost.id = 'ji-stock-host'
let stockMounted = false
let masterTs: number | null = null
let mst: any = null
let improvementDayTimer: ReturnType<typeof setTimeout> | null = null
const JST_WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
// 改修包的 days 沿用 JavaScript 口径（0=周日,wikiwiki 表列序 日〜土 同源）；界面按中文公历习惯从周一排到周日。
const CALENDAR_WEEKDAY_CHIPS = [
  { day: 1, label: '一', title: '星期一' },
  { day: 2, label: '二', title: '星期二' },
  { day: 3, label: '三', title: '星期三' },
  { day: 4, label: '四', title: '星期四' },
  { day: 5, label: '五', title: '星期五' },
  { day: 6, label: '六', title: '星期六' },
  { day: 0, label: '日', title: '星期日' },
] as const

// ---- 主数据索引（load 后构建）----
let friendlyShips: Map<number, any> = new Map() // mstId → raw（有図鑑号的味方舰）
let shipUpgradeByTarget: Map<number, any[]> = new Map() // 改装目标 mstId → api_mst_shipupgrade 全部行（同目标多来路）
let rootOf: Map<number, number> = new Map() // mstId → 链根
let chainOf: Map<number, number[]> = new Map() // 根 → 全链 mstId
// 史实编队库的反向索引（shared/hist-fleets 的单一出处，鉴只拉取不自造）。
// 主数据到位前先给一份空索引，别让筛选路径读到 null。
let histFleets: HistFleetIndex = buildHistFleetIndex(new Map())
let voiceFallbackOf: Map<number, number[]> = new Map() // 当前形态 → 最近前置形态 → 原型
let equipTypes: Map<number, string> = new Map() // equiptype id → 名
let friendlyEquips: Map<number, any> = new Map() // mst slotitem（非深海）
let abyssalShips: Map<number, any> = new Map() // 深海舰（无図鑑号）
let resolveAbyssalName: (label: string) => number | null = () => null
let abyssalEquips: Map<number, any> = new Map() // 深海装备（id ≥ 1500）
let useitemMst: Map<number, any> = new Map() // mst useitem
// 台词：首选 kcwiki（带场合），兜底 poi-plugin-subtitle（覆盖更全但只有编号）
// 装备加成的预期层底表。`data` 是**叠过第一方修正台账**的视图，不是包的原样——
// 台账见 shared/fit-bonus-corrections.ts（不改 CC 包文件，加载时叠一层）。
let fitLode: { meta: LodeMeta; data: FitBonusData } | null = null
const equipVisualLink = (mstId: number, label?: string): string => {
  const equip = friendlyEquips.get(mstId)
  const name = label ?? equip?.api_name ?? `#${mstId}`
  const iconId = Array.isArray(equip?.api_type) ? equip.api_type[3] : 0
  return `<span class="entity-visual">${equipTypeIconHtml(iconId, { className: 'xs', title: name })}${elink('mstEquip', mstId, name)}</span>`
}
let voiceLode: { meta: LodeMeta; data: any } | null = null
// 台词自补层（艦素自行翻译，第一方）。与 kcwiki 是**同一个域的两层**，不是两个域：
// kcwiki 没收的形态，中文层整片是空的（吞武里、Gloire、Wasp、大泊……玩家点开只看到空白），
// 这一层把那些形态的台词自己译成中文补上。合流按**槽位**填空、kcwiki 胜——
// 它是社区共识层；同一格两层都有时不并排显示，也不做行内混拼。
let kansoVoiceLode: { meta: LodeMeta; data: any } | null = null
// kcwiki 台词行按档名的形态码重排后的视图（归属/槽位/文本三类校正，判据见
// shared/voice-scene-slots 的「归属与文本校正」段）。**加载时算一次**，
// 渲染路径只查表——onMgChange 那条路上不许现算 11250 行。
let correctedVoiceRows = new Map<number, CorrectedVoiceRow[]>()
// 季节限定台词（中文译文）。与常规台词是**两个域**，不进上面那条择一回退链：
// 常规台词是「这艘舰平时会说什么」，季节台词是「哪一年的哪个节日她说过什么」，
// 两边同时有内容才是常态，择一会把其中一边整段吃掉。
let seasonalVoiceLode: { meta: LodeMeta; data: any } | null = null
let wikiwikiVoiceLode: { meta: LodeMeta; data: any } | null = null
let wikiwikiAbyssVoiceLode: { meta: LodeMeta; data: any } | null = null
let wikiwikiRemodelLode: { meta: LodeMeta; data: any } | null = null
// 三维 Lv99 上限的社区基准（艦船最大値总表）：2026-08-11 账本一手仲裁后
// 压过 kcwiki（覆盖 834 形态 vs kcwiki 缺 41 项；错误率 0.69% vs 0.62% 相当）。
// 层级：①游戏一手（持有形态） ②本包 ③kcwiki；初始值仍以 kcwiki 为批量基准。
// 成长三维（回避/对潜/索敌）的端点表：第一方汇编包，随发行版。
// 值本身在 fleet-calc 那边（`shipGrowthEndpointsOf`，与面板反推共用一份），
// 这里只留 meta——来源脚注要说得出「更新于哪一天」。
let shipStatsLode: { meta: LodeMeta; data: any } | null = null
let subtitleZh: { meta: LodeMeta; data: any } | null = null
let subtitleJa: { meta: LodeMeta; data: any } | null = null
let subtitleEnemiesLode: { meta: LodeMeta; data: any } | null = null
let abyssSubtitleByMst = new Map<number, { key: string; ja: string; zh: string }[]>()
let voiceZhByJa = new Map<string, string>()
let mapAreas: Map<number, string> = new Map() // 海域区 id → 名
let eventAreaIds = new Set<number>()
let mapInfos: any[] = [] // mst mapinfo
interface EventArchive {
  areaId: number
  areaName: string | null
  opened: number
  closed: number
  closedTs: number
  maps: any[]
  stats: any
}
let eventArchives: EventArchive[] | null = null
// 矿脉包（同域单基准：改修周历/二番舰/消耗/更新链 = wikiwiki 改修表，2026-08-11
// 对账后从 EO 换源，包结构仍是 EO 同构；逐星加成 = akashi-list；
// 舰娘详情 = kcwiki 中文口径，实体级回退主数据——绝不字段级混拼）
let abyssalLode: { meta: LodeMeta; data: any } | null = null
let fcdMapLode: { meta: LodeMeta; data: any } | null = null // poi fcd：海域字母/坐标
let routingLode: { meta: LodeMeta; data: any } | null = null // kcwiki：各图带路条件
let wikiwikiRoutingLode: { meta: LodeMeta; data: any } | null = null // wikiwiki：日文一手分歧说明
let kcnavRoutingLode: { meta: LodeMeta; data: any } | null = null
const { ipcRenderer: jiIpc } = require('electron')
const EMPTY_MAP_CHRONICLE: MapChronicleReport = {
  cells: [],
  drops: [],
  sortieCount: 0,
  edges: [],
  bossCells: [],
  bossSeen: [],
  localDrops: { battles: 0, sWins: 0, sWinsWithoutDrop: 0, ships: [] },
}
// 路线预测的目标点，按图记（海域码 → 点位字母）。键用海域码而不是 mapId：
// 下面那段裁剪靠的是插入序，而**数字型键在对象里恒按数值升序排**，先删后插
// 挪不动它——那样裁掉的会是 1-1、1-2 这些编号最小的常规图，不是最久没碰的那批。
const ROUTE_TARGET_KEY = 'ji.routeTarget'
let routeTargets = uiGet<Record<string, string>>(ROUTE_TARGET_KEY, {})
const setRouteTarget = (code: string, letter: string) => {
  // 先删后插：碰过的键回到插入序末尾，容量裁剪才裁得掉真正最久没动的那批（同 du 的目标点）
  delete routeTargets[code]
  if (letter) routeTargets[code] = letter
  const keys = Object.keys(routeTargets)
  if (keys.length > 200) {
    routeTargets = Object.fromEntries(keys.slice(-160).map((item) => [item, routeTargets[item]]))
  }
  uiSet(ROUTE_TARGET_KEY, routeTargets)
}
const mapChronicle = new Map<number, MapChronicleReport>()
const mapChronicleLoaded = new Map<number, number>() // mapId → 手上这份对应的代
const mapChronicleLoading = new Set<number>()
const mapChronicleErrors = new Set<number>()
const mapChronicleGeneration = new Map<number, number>()

// 通关阵容（2026-08-17 用户提议）：打赢过 Boss 的编成聚合，随海域记录同节奏取/失效
const mapClearFleets = new Map<number, MapClearFleetRow[]>()
const mapClearFleetsLoaded = new Map<number, number>()
const mapClearFleetsLoading = new Set<number>()
// 拉失败记在这里（mapId → 失败的那一代）。代号推进（出击反哺）时自然作废 = 下代重试
const mapClearFleetsErrors = new Map<number, number>()
// 「更多」的展开态必须存状态：抽屉随游戏报文频繁重渲染，<details> 的 open
// 会被 innerHTML 重建抹掉——用户点开就立刻缩回去，看起来像「完全隐藏」
let mapClearFleetsOpen = false

const cfEquipName = (mstId: number) =>
  entityNamePlain('equip', mstId, mg.master.slotitems[mstId]?.name ?? `装备 #${mstId}`)

// ---- 「通关那时」快照卡（2026-08-17 用户纠正：通关阵容的舰名代表历史快照，
// 超链接不该指向「现在的角色」）----
// 点舰名弹当时的 Lv/装备（账本一手），卡里再留一条去现在图鉴页的链接。
// 挂 body：面板既裁 overflow 又有 transform 包含块（浮层纪律）。
let cfSnapEl: HTMLElement | null = null
const cfSnapEsc = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !cfSnapEl) return
  event.stopPropagation() // 别顺手把后面的抽屉也关了
  closeCfSnapshot()
}
const cfSnapOutside = (event: MouseEvent) => {
  if (cfSnapEl && !cfSnapEl.contains(event.target as Node)) closeCfSnapshot()
}
const closeCfSnapshot = () => {
  cfSnapEl?.remove()
  cfSnapEl = null
  document.removeEventListener('keydown', cfSnapEsc, true)
  document.removeEventListener('mousedown', cfSnapOutside, true)
}
const openCfSnapshot = (
  mapId: number,
  rowIndex: number,
  deckIndex: number,
  shipIndex: number,
  anchor: HTMLElement,
) => {
  closeCfSnapshot()
  const row = mapClearFleets.get(mapId)?.[rowIndex]
  const ship = row?.decks[deckIndex]?.[shipIndex]
  if (!row || !ship) return
  const stype = mg.master.ships[ship.mstId]?.stype ?? 0
  const typeCn = STYPE_CN[stype] ?? mg.master.stypes[stype] ?? ''
  const loadout = row.equips?.[deckIndex]?.[shipIndex] ?? null
  const equipRows = loadout?.length
    ? loadout
        .map(
          (item) =>
            `<div class="cs-eq">${elink('equip', item.mstId, cfEquipName(item.mstId))}${
              item.level ? `<i>★${item.level}</i>` : ''
            }</div>`,
        )
        .join('')
    : '<div class="cs-note">暂无通关时配装记录</div>'
  // 现在的持有状态给个对照，免得快照被误当现状
  const root = rootOf.get(ship.mstId) ?? ship.mstId
  const instances = chainInstances(root)
  const nowLine = instances.length
    ? `当前持有 ×${instances.length} · 最高 Lv${Math.max(...instances.map((i) => i.lv))}`
    : '当前未持有'
  cfSnapEl = document.createElement('div')
  cfSnapEl.className = 'cf-snap-host'
  cfSnapEl.innerHTML = `<div class="cf-snap">
    <div class="cs-head"><b>通关时</b><span>${fmtDate(row.lastWinTs)}</span><span class="cs-x" title="关闭（Esc）">✕</span></div>
    <div class="cs-ship">${typeCn ? `<em>${esc(typeCn)}</em>` : ''}${entityNameHtml('ship', ship.mstId, masterShipName(ship.mstId), { compact: true })}<b>Lv${ship.lv}</b></div>
    <div class="cs-equips">${equipRows}</div>
    <div class="cs-now">${esc(nowLine)}</div>
    <button class="cs-open" data-act="cf-snap-open">打开图鉴</button>
  </div>`
  document.body.appendChild(cfSnapEl)
  const card = cfSnapEl.querySelector<HTMLElement>('.cf-snap')!
  const rect = anchor.getBoundingClientRect()
  const width = 268
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  card.style.left = `${left}px`
  const below = rect.bottom + 6
  card.style.top =
    below + 240 < window.innerHeight ? `${below}px` : `${Math.max(8, rect.top - 246)}px`
  cfSnapEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('.cs-x')) {
      closeCfSnapshot()
      return
    }
    if (target.closest('[data-act="cf-snap-open"]')) {
      const mstId = ship.mstId
      closeCfSnapshot()
      navigate({ type: 'mstShip', id: mstId })
      return
    }
    // 装备链接由全局实体路由接管，跳走后卡自行退场
    if (target.closest('.el')) setTimeout(closeCfSnapshot, 0)
  })
  document.addEventListener('keydown', cfSnapEsc, true)
  setTimeout(() => document.addEventListener('mousedown', cfSnapOutside, true), 0)
}

// 出击反哺后要重新拉，但**不丢掉手上这份**。
// 整图统计进一个点只是多一条记录，旧的继续显示不算撒谎；而立刻 delete 会让整块
// 「我的海域记录」先塌成「正在读取…」再填回来——出击中每进一个点就闪一次，
// 玩家看着就像面板在刷新。新数据几十毫秒后到，届时静默换上即可。
const invalidateMapChronicle = (mapId: number) => {
  if (mapId <= 0) return
  mapChronicleErrors.delete(mapId)
  mapChronicleGeneration.set(mapId, (mapChronicleGeneration.get(mapId) ?? 0) + 1)
}
const ensureMapChronicle = (mapId: number) => {
  if (mapId <= 0) return
  const generation = mapChronicleGeneration.get(mapId) ?? 0
  // 手上这份已经是最新代 / 正在拉 / 这一代拉失败过 → 都不重复发请求
  if (
    mapChronicleLoaded.get(mapId) === generation ||
    mapChronicleLoading.has(mapId) ||
    mapChronicleErrors.has(mapId)
  ) return
  mapChronicleLoading.add(mapId)
  void jiIpc.invoke('chron:map', mapId).then((report: MapChronicleReport | null) => {
    if ((mapChronicleGeneration.get(mapId) ?? 0) !== generation) return
    mapChronicle.set(mapId, { ...EMPTY_MAP_CHRONICLE, ...(report ?? {}) })
    mapChronicleLoaded.set(mapId, generation)
  }).catch((error: unknown) => {
    if ((mapChronicleGeneration.get(mapId) ?? 0) === generation) {
      mapChronicleErrors.add(mapId)
    }
    console.warn('[kanso] 海域本地记录读取失败', error)
  }).finally(() => {
    mapChronicleLoading.delete(mapId)
    if (activeBook === 'map' && mapState.open && mapState.selected === mapId) scheduleRender()
  })
}
// 通关阵容与遭遇志共用同一套代数（invalidateMapChronicle 一起失效）。
// 拉失败要立**按代的**墓碑（与 ensureMapChronicle 同款）：空数组是合法答案，
// 但「查不出来」不是——不记的话 finally 里的 scheduleRender 会把当代变成
// 无限重试，UI 一直停在「正在读取出击样本…」。墓碑记的是代号，
// 下一代（出击反哺推进代数）自然作废，届时重试。
const ensureMapClearFleets = (mapId: number) => {
  if (mapId <= 0) return
  const generation = mapChronicleGeneration.get(mapId) ?? 0
  if (mapClearFleetsLoaded.get(mapId) === generation || mapClearFleetsLoading.has(mapId)) return
  if (mapClearFleetsErrors.get(mapId) === generation) return // 这一代拉失败过，不再重复发
  mapClearFleetsLoading.add(mapId)
  void jiIpc
    .invoke('chron:map-clear-fleets', mapId)
    .then((rows: MapClearFleetRow[] | null) => {
      if ((mapChronicleGeneration.get(mapId) ?? 0) !== generation) return
      mapClearFleets.set(mapId, Array.isArray(rows) ? rows : [])
      mapClearFleetsLoaded.set(mapId, generation)
    })
    .catch((error: unknown) => {
      console.warn('[kanso] 通关阵容读取失败', error)
      if ((mapChronicleGeneration.get(mapId) ?? 0) === generation) {
        mapClearFleetsErrors.set(mapId, generation)
      }
    })
    .finally(() => {
      mapClearFleetsLoading.delete(mapId)
      if (activeBook === 'map' && mapState.open && mapState.selected === mapId) scheduleRender()
    })
}
let eoLode: { meta: LodeMeta; data: any } | null = null // equip-improve（第一方改修事实表）
// 道具兑换（2026-08-18 用户提议的「可兑换列表」）：wikiwiki アイテム页的
// 年次/固定兑换表；勲章的常设三项在 shared/item-exchange.ts 手录表
let itemExchangeLode: { meta: LodeMeta; data: any } | null = null
// 舰娘档案补缺(wikiwiki 舰页):只覆盖 kcwiki-ships 停收的形态,实体级回退
let shipProfileLode: { meta: LodeMeta; data: any } | null = null
let shipProfileByMst: Map<number, any> = new Map()
let akashiListLode: { meta: LodeMeta; data: any } | null = null
let devRecipeLode: { meta: LodeMeta; data: any } | null = null
let buildRecipeLode: { meta: LodeMeta; data: any } | null = null
let kcwikiLode: { meta: LodeMeta; data: any } | null = null
let kcwikiByMst: Map<number, any> = new Map() // mst id → kcwiki 中文数据条目
let eoByEquip: Map<number, any> = new Map() // equip mst id → 改修条目(EO 同构,现源自 wikiwiki 改修表)
// 改修表的覆盖边界（收到第几号）。装配期算一次：判「这件是不能改，还是还没收录」
// 每次渲染都要问，逐次扫全表就是白扫（同注册表「别在渲染里逐条扫全表」那条）。
let improveCoverageMax = 0

const RARITY_COLOR =['', '#8095a8', '#7db4d8', '#79c0ea', '#9ad0e0', '#c9a86a', '#b489ff', '#6ee7ff', '#e8c66a']
const RARITY_LABEL = ['', '普通', '普通', '稀有', 'S稀有', 'SS稀有', 'S虹', '虹', 'SS虹']
// 第 5 档游戏写作「超長+」:玩家侧只有 Ho229,深海侧 8 件(深海空超要塞等)。
// 旧表只到 4,Ho229 的射程曾因此显示成「—」。
const LENG_LABEL = ['无', '短', '中', '长', '超长', '超长+']

const buildIndex = () => {
  friendlyShips = new Map()
  rootOf = new Map()
  chainOf = new Map()
  voiceFallbackOf = new Map()
  equipTypes = new Map()
  friendlyEquips = new Map()
  abyssalShips = new Map()
  useitemMst = new Map()
  mapAreas = new Map()
  eventAreaIds = new Set()
  mapInfos = []
  remodelForwardEdges = null // 改造边随主数据走，重建索引时一并作废
  if (!mst) return
  // 留成模块级：改装链抽屉每次渲染都要按目标查升级表，从前它每次重建一张 Map。
  // 同目标多行（可逆改装的每条来路一行）必须全留——Map 构造器的后行覆盖前行
  // 曾把赤城改二的弹射器需求挂到戊→改二的回转路径上。
  shipUpgradeByTarget = new Map<number, any[]>()
  for (const entry of mst.api_mst_shipupgrade ?? []) {
    const targetId = Number(entry?.api_id) || 0
    if (targetId <= 0) continue
    const list = shipUpgradeByTarget.get(targetId) ?? []
    list.push(entry)
    shipUpgradeByTarget.set(targetId, list)
  }
  const upgradeByTarget = shipUpgradeByTarget
  for (const s of mst.api_mst_ship ?? []) {
    if (s.api_sortno) {
      friendlyShips.set(s.api_id, s)
    } else {
      abyssalShips.set(s.api_id, s)
    }
  }
  resolveAbyssalName = createAbyssalNameResolver(
    [...abyssalShips].map(([id, ship]) => ({
      id,
      name: `${ship.api_name ?? ''}`,
      yomi: `${ship.api_yomi ?? ''}`,
    })),
  )
  for (const u of mst.api_mst_useitem ?? []) {
    useitemMst.set(u.api_id, u)
  }
  const areas: any[] = mst.api_mst_maparea ?? []
  for (const a of areas) mapAreas.set(a.api_id, a.api_name)
  // 活动海域判定的唯一出处（铭、铎、锱同引）
  eventAreaIds = detectEventAreas(areas).eventAreaIds
  mapInfos = [...(mst.api_mst_mapinfo ?? [])].sort(
    (a, b) => a.api_maparea_id - b.api_maparea_id || a.api_no - b.api_no,
  )
  // 原生升级表能覆盖分支/可逆改装，但它不是全舰历史表；缺项必须逐目标回退
  // api_aftershipid，不能用“表是否非空”做全局二选一。
  const remodelChains = buildShipRemodelChains(
    [...friendlyShips.values()].map((ship) => ({
      id: Number(ship.api_id),
      sortNo: Number(ship.api_sortno) || Number(ship.api_id),
      afterId: Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10) || 0,
    })),
    [...upgradeByTarget.values()].flat().map((upgrade) => ({
      targetId: Number(upgrade.api_id) || 0,
      currentShipId: Number(upgrade.api_current_ship_id) || 0,
      originalShipId: Number(upgrade.api_original_ship_id) || 0,
      stage: Number(upgrade.api_upgrade_level) || 0,
    })),
  )
  chainOf = remodelChains.chainOf
  rootOf = remodelChains.rootOf
  // 史实编队的反向索引在装配期建一次（注册表 §5.4：别在渲染里逐舰扫全表）
  histFleets = buildHistFleetIndex(rootOf)
  voiceFallbackOf = buildVoiceFallbackIds(
    mst.api_mst_ship ?? [],
    mst.api_mst_shipupgrade ?? [],
  )
  for (const t of mst.api_mst_slotitem_equiptype ?? []) {
    equipTypes.set(t.api_id, t.api_name)
  }
  for (const e of mst.api_mst_slotitem ?? []) {
    if (e.api_id < 1500) friendlyEquips.set(e.api_id, e)
    else abyssalEquips.set(e.api_id, e)
  }
}

// 在籍统计。
//
// 「这个形态有几艘在籍」在舰娘卷目录里要被问上百万次：每个根问一次、每个舰种分组
// 再问一遍、每个舰级又问一遍，而改造链上每个形态都算一次。原本每次都
// Object.values(mg.ships).filter 全表扫——那既是 O(在籍数)，还每次新建一个整表数组。
// 400 根 × 3 形态 × 三轮 × 500 艘，量级到百万，点开一艘舰会卡住整整一秒。
// 装备/深海/海域卷没有「改造链」这层嵌套，所以只有舰娘卷卡。
// 索引按数据源的引用失效（store 每次下发都换新对象），命中时是 O(1)。
//
// 返回的数组是索引内部持有的，调用方只读——需要排序/增删请自行复制。
let instanceIndexSource: typeof mg.ships | null = null
let instancesByMst = new Map<number, PlayerShip[]>()
const instanceIndex = () => {
  if (instanceIndexSource !== mg.ships) {
    instanceIndexSource = mg.ships
    instancesByMst = new Map()
    for (const ship of Object.values(mg.ships)) {
      const list = instancesByMst.get(ship.shipId)
      if (list) list.push(ship)
      else instancesByMst.set(ship.shipId, [ship])
    }
  }
  return instancesByMst
}
const instancesOfMst = (mstId: number): PlayerShip[] => instanceIndex().get(mstId) ?? []

// 「哪几艘舰身上装着这件装备」——装备卷的实测轨要按装备反查在籍舰。
// 与 instanceIndex 同一套纪律：按数据源的引用失效（装备表也要看，改修会换掉它），
// 命中时 O(1)，别在渲染路径上重复全表扫。
let equipCarrierSource: [typeof mg.ships, typeof mg.slotitems] | null = null
let carriersByEquipMst = new Map<number, PlayerShip[]>()
const equipCarrierIndex = () => {
  if (equipCarrierSource?.[0] !== mg.ships || equipCarrierSource?.[1] !== mg.slotitems) {
    equipCarrierSource = [mg.ships, mg.slotitems]
    carriersByEquipMst = new Map()
    for (const ship of Object.values(mg.ships)) {
      const seen = new Set<number>()
      for (const id of [...ship.slot, ship.slotEx]) {
        const equip = id > 0 ? mg.slotitems[id] : null
        if (!equip || seen.has(equip.mstId)) continue
        seen.add(equip.mstId)
        const list = carriersByEquipMst.get(equip.mstId)
        if (list) list.push(ship)
        else carriersByEquipMst.set(equip.mstId, [ship])
      }
    }
  }
  return carriersByEquipMst
}
/**
 * 在籍的该形态里等级最高的那一艘（没有就 undefined）。
 *
 * 改造需求那两处原先是逐条 `Object.values(mg.ships).filter(...).sort(...)[0]`：
 * 一件道具几十条需求，每条都把整个在籍表扫一遍再排序。索引现成的，用它。
 * 并列最高时取先出现的那艘，与原先的稳定排序同结果。
 */
const topLevelInstanceOf = (mstId: number): PlayerShip | undefined =>
  instancesOfMst(mstId).reduce<PlayerShip | undefined>(
    (best, ship) => (!best || ship.lv > best.lv ? ship : best),
    undefined,
  )
const chainInstances = (rootId: number) =>
  (chainOf.get(rootId) ?? []).flatMap((mstId) => instancesOfMst(mstId))

let equipIndexSource: typeof mg.slotitems | null = null
let equipInstancesByMst = new Map<number, [string, typeof mg.slotitems[number]][]>()
const equipInstanceIndex = () => {
  if (equipIndexSource !== mg.slotitems) {
    equipIndexSource = mg.slotitems
    equipInstancesByMst = new Map()
    for (const entry of Object.entries(mg.slotitems)) {
      const list = equipInstancesByMst.get(entry[1].mstId)
      if (list) list.push(entry)
      else equipInstancesByMst.set(entry[1].mstId, [entry])
    }
  }
  return equipInstancesByMst
}
const equipInstancesOf = (mstId: number) => equipInstanceIndex().get(mstId) ?? []

// ---- 模块状态 ----
type Book = 'ship' | 'roster' | 'equip' | 'stock' | 'abyss' | 'map' | 'item'
let activeBook: Book = 'ship'
/**
 * 点进来的实体在本地查无此条时的回执。
 *
 * 正式包没有 DevTools，静默 `return` 在玩家眼里就是「点了没反应」——di 的
 * replayOpenError 已经立过这条口径（打不开要在面板上说）。这里管的是同一族：
 * 活动结束后主数据缩水，从战斗回顾点旧活动图或活动限定深海舰，id 就落空了。
 * 按卷记，换一卷自然收起；玩家也可以按 ✕ 收掉。
 */
let missNotice: { book: Book; text: string } | null = null
/** 归档还没到位时点过的那张海域图：IPC 一回来并进 mapInfos 就替玩家补开。 */
let pendingMapOpen: number | null = null
// 「更多分类」：顶栏放不下全部类别，展开后按主数据逐个列，带各自的数量。
// 名字一律取自 mg.master，不在代码里硬编码任何中文分类名。
let moreCategoriesOpen = false
/**
 * 舰娘卷四段分类的手风琴：**同时只开一段**，默认全收起。
 *
 * 四段全量铺开是 243 个格、2502px（实测），而列表容器只有 726px——
 * 列表被压成 0 高、进度条被推到可视区外 1900px 处，看着就是「滚不动、翻不了页」。
 * 渐进披露既是观感（用户原话「大量的内容全量铺开有点混乱」）也是这条布局的前提。
 */
type ShipCatSection = '' | 'stype' | 'nation' | 'class' | 'fleet'
let moreCategorySection: ShipCatSection = ''
/** 段内就地过滤：型 137 级、编队 75 队，靠肉眼找太慢。空串 = 不过滤 */
const catFind: Record<'class' | 'fleet', string> = { class: '', fleet: '' }

const shipState = {
  search: '',
  chip: '全部',
  classFilter: 0,
  typeFilter: 0,
  nationalityFilter: 0,
  // 史实编队筛选（shared/hist-fleets 的条目 id，'' = 不筛）
  fleetFilter: '',
  // 目录排布：'group' = 舰种→舰级分组（游戏口径，默认）；'no' = 按图鉴编号平铺
  sort: uiGet<string>('ji.shipSort', 'group') === 'no' ? 'no' : 'group',
  selectedRoot: 0,
  selectedForm: 0,
  open: false,
  // NPC 位上摊开的是哪一位（组名，'' = 还在列表页）。与 selectedRoot 分开记：
  // NPC 没有 mstId，共用一格会让「上次看的那艘舰」被一个字符串顶掉
  npcName: '',
  dtab: 'p-voice',
  memorialOpen: 0,
  // 捞船清单的联动筛选：'' 不筛 / 'catchable' 目录能查到掉点的 / 'event' 当前活动图能捞的
  huntFilter: '' as '' | 'catchable' | 'event',
}
/**
 * 四个分类维度互斥：点新的一个就把其余三个清掉。
 *
 * 「互斥」是既有行为（舰种/舰级/国籍本来就互相清），编队接进来时沿用同一条——
 * 收口成一个函数，省得下次加维度又要满文件找赋值点。
 */
const clearShipDimensions = () => {
  shipState.classFilter = 0
  shipState.typeFilter = 0
  shipState.nationalityFilter = 0
  shipState.fleetFilter = ''
}
const collapsedShipClasses = new Set<number>(
  uiGet<number[]>('ji.collapsedShipClasses', []).filter((id) => Number.isInteger(id) && id > 0),
)
const equipState = {
  search: '',
  chip: '全部',
  typeFilter: 0,
  selected: 0,
  open: false,
  mode: 'catalog' as 'catalog' | 'today' | 'lab',
}
// failed：这一份是「读失败」而不是「没有记录」——两者绝不能显示成同一句
let shipMemorial: {
  key: string
  report: ShipMemorialReport
  generation: number
  failed?: boolean
} | null = null
let shipMemorialLoading = ''
let shipMemorialGeneration = 0

// 舰种口径抽进 ship-category，与列表共用一份

/**
 * 分类分组的组头 + 组内容，裹成一层交给 section-fold 接折叠（**默认全展开**）。
 *
 * 各卷原先都是「`.grp` 组头与 `.row` 平铺成兄弟、靠 DOM 顺序成组」，没有组根元素——
 * 而 section-fold 要求「标题是段根的直接子元素」，`[data-foldable]:not([data-open])`
 * 那条也只藏得住直接子元素。所以这里补一层 `.grp-box`。
 *
 * **补这一层不许动版面**：宽屏下 `.ship-list` 是栅格，行是栅格项、`.grp` 占满整行
 * （index.html 的 `@container jilist`）。多包一层 div 会把整组塞进一个栅格格子，
 * 于是 `.grp-box` 是 `display: contents` ——盒子不生成，`.grp` 与各行照旧直接参与
 * 外层栅格，展开态与改之前逐像素相同。
 *
 * `key` 只用来记开合，**要跨卷唯一**：舰娘卷与深海卷都有「駆逐艦」组、装备目录/今日改修/
 * 深海装备三处都有「小口径主炮」组，不带卷名前缀的话在甲卷折一下、切到乙卷同名组也是折的。
 */
const groupBoxHtml = (key: string, headInner: string, rowsHtml: string): string =>
  `<div class="grp-box"><div class="grp" data-grp-key="${esc(key)}">${headInner}</div>${rowsHtml}</div>`

/** 组头的记忆名：认 `data-grp-key`，取不到就不折（section-fold 见空名字会跳过这一段）。 */
const groupKeyTitle = (head: HTMLElement): string => head.dataset.grpKey ?? ''

// ---- 舰娘卷 ----

/**
 * 每条改造链出现过的全部舰种。
 *
 * 图鉴按**根形态**列，可「找航空战舰」的人要的是扶桑改二——她的根是戦艦。
 * 原来精确筛直接比 root.api_stype，于是重雷装巡洋舰(4)、航空巡洋舰(6)、
 * 航空战舰(10) 这三种从来不是根形态的舰种，在「更多分类」里标着数字、
 * 点进去 0 条。搜索本来就是搜整条链，这里同口径。
 */
let chainStypeSource: typeof chainOf | null = null
let stypesByRoot = new Map<number, Set<number>>()
const chainStypeIndex = () => {
  if (chainStypeSource !== chainOf) {
    chainStypeSource = chainOf
    stypesByRoot = new Map()
    for (const [rootId, chain] of chainOf) {
      const set = new Set<number>()
      for (const id of chain) {
        const stype = friendlyShips.get(id)?.api_stype
        if (stype != null) set.add(stype)
      }
      stypesByRoot.set(rootId, set)
    }
  }
  return stypesByRoot
}

const stypeLabelOf = (id: number): string =>
  entityNamePlain('shipType', id, mg.master.stypes[id] ?? `舰种${id}`)

/**
 * 主数据把 8 和 9 都写作「戦艦」，「更多分类」里就是两个一模一样的格子，
 * 用户没法分辨该点哪个。按显示名归并：点一个 = 同名的全部一起筛。
 */
const stypeSiblings = (id: number): number[] => {
  const label = stypeLabelOf(id)
  return ALL_SHIP_TYPE_IDS.filter((x) => mg.master.stypes[x] && stypeLabelOf(x) === label)
}

const shipMatches = (root: any) => {
  // 捞船清单点进来的联动：只留「还缺 + 目录能查到掉点」的那批
  if (shipState.huntFilter) {
    if (chainInstances(root.api_id).length > 0) return false
    const sites = confirmedDropSitesOf(root.api_id)
    if (!sites.length) return false
    if (shipState.huntFilter === 'event' && !sites.some((site) => site.event?.status === 'active')) {
      return false
    }
  }
  if (shipState.classFilter && root.api_ctype !== shipState.classFilter) return false
  if (shipState.typeFilter) {
    const want = stypeSiblings(shipState.typeFilter)
    const have = chainStypeIndex().get(root.api_id)
    if (!have || !want.some((stype) => have.has(stype))) return false
  }
  if (
    shipState.nationalityFilter &&
    nationBucketOf(root.api_sort_id) !== shipState.nationalityFilter
  ) return false
  if (
    shipState.fleetFilter &&
    !histFleets.ofRoot(root.api_id).some((entry) => entry.id === shipState.fleetFilter)
  ) return false
  if (shipState.chip === '收藏') {
    if (!isFavoriteShipRoot(root.api_id)) return false
  } else if (!shipChipMatches(shipState.chip, root.api_stype)) {
    return false
  }
  if (shipState.search) {
    const q = searchFold(shipState.search)
    // 门类补全（用户 2026-08-11 指出「白露级」一无所获）：除名字/假名/中文名/
    // 图鉴No. 外，舰级、舰种、国籍、声优、画师也都是玩家真实的检索词。
    // 单字查询只走名字类字段——「雷」不该把整个雷巡舰种都拖出来。
    if (q.length >= 2) {
      // 舰级两种叫法都认：kcwiki 译名带「型」（白露型），本地化级名带「级」（白露级）
      const classVariants = [q]
      if (q.endsWith('级')) classVariants.push(`${q.slice(0, -1)}型`)
      else if (q.endsWith('型')) classVariants.push(`${q.slice(0, -1)}级`)
      const classNames = [
        `${kcwikiByMst.get(root.api_id)?.级别?.[0] ?? ''}`,
        shipClassLabel(root.api_ctype),
      ].map((name) => name.toLowerCase())
      if (classNames.some((name) => name && classVariants.some((v) => name.includes(v)))) {
        return true
      }
      const stypes = chainStypeIndex().get(root.api_id) ?? new Set<number>()
      const typeNames = [...stypes].flatMap((st) => [mg.master.stypes[st] ?? '', stypeLabelOf(st)])
      if (typeNames.some((name) => name && searchFold(name).startsWith(q))) return true
      // 队名也进检索域：搜「六驱」「西村舰队」「三一驱」应命中该队的成员
      // （别称表里收了「六驱」这类口语写法，见 shared/hist-fleets）
      if (
        histFleets.ofRoot(root.api_id).some((entry) =>
          [entry.name.zh, entry.name.ja, ...entry.aliases].some((name) =>
            searchFold(name).includes(q),
          ),
        )
      ) return true
      // 别名也进检索域：搜「苏联/苏俄/俄国」应命中标签为「俄罗斯」的那批舰
      //（2026-08-11 用户实搜「苏联」无匹配抓出来的）
      const nationality = shipNationalityById(shipNationalityIdFromSortId(root.api_sort_id))
      if (
        nationality &&
        [nationality.label, ...nationality.aliases].some((name) =>
          searchFold(name).includes(q),
        )
      ) {
        return true
      }
    }
    const chain = chainOf.get(root.api_id) ?? []
    return chain.some((id) => {
      const s = friendlyShips.get(id)
      const wiki = kcwikiByMst.get(id)
      // kcwiki 停收的形态(杉/稲木改二等 89 个)声优/画师走舰页档案补缺
      const profile = wiki ? null : shipProfileByMst.get(id)
      const cn = wiki?.中文名 ?? ''
      const localized = entityNamePlain('ship', id, s.api_name)
      return (
        searchFold(s.api_name).includes(q) ||
        searchFold(s.api_yomi ?? '').includes(q) ||
        searchFold(cn).includes(q) ||
        searchFold(localized).includes(q) ||
        `${s.api_sortno}` === q ||
        (q.length >= 2 &&
          (searchFold(`${wiki?.声优 ?? profile?.cv ?? ''}`).includes(q) ||
            searchFold(`${wiki?.画师 ?? profile?.artist ?? ''}`).includes(q)))
      )
    })
  }
  return true
}

/**
 * 目录的两种排布（2026-08-22 用户拍板加的第二档）：
 *   'group' 舰种 → 舰级 → 图鉴号（游戏口径，默认；名称排序的拼音规则不适用于图鉴卷）
 *   'no'    纯按图鉴编号平铺——想「按 No. 一路翻下去」时用
 * 两者用的是同一批 roots，切换只换比较器与分组渲染，筛选条件不受影响。
 */
const filteredRoots = (): any[] => {
  const roots = [...chainOf.keys()].map((id) => friendlyShips.get(id)).filter(shipMatches)
  return shipState.sort === 'no'
    ? roots.sort((a, b) => a.api_sortno - b.api_sortno || a.api_id - b.api_id)
    : roots.sort(
        (a, b) => a.api_stype - b.api_stype || a.api_ctype - b.api_ctype || a.api_sortno - b.api_sortno,
      )
}

// 同样按舰级预分组：目录里每个舰级都要问一次同级姐妹舰，原本每问一次就把
// 全部根形态 map + filter + sort 一遍，130 个舰级就是 130 趟全表。返回值只读。
let classIndexSource: typeof chainOf | null = null
let rootsByCtype = new Map<number, any[]>()
const rootsOfClass = (ctype: number): any[] => {
  if (classIndexSource !== chainOf) {
    classIndexSource = chainOf
    rootsByCtype = new Map()
    for (const id of chainOf.keys()) {
      const ship = friendlyShips.get(id)
      if (!ship) continue
      const list = rootsByCtype.get(ship.api_ctype)
      if (list) list.push(ship)
      else rootsByCtype.set(ship.api_ctype, [ship])
    }
    for (const list of rootsByCtype.values()) list.sort((a, b) => a.api_sortno - b.api_sortno)
  }
  return rootsByCtype.get(ctype) ?? []
}

const rootsOfNationality = (nationalityId: number): any[] =>
  [...chainOf.keys()]
    .map((id) => friendlyShips.get(id))
    .filter((ship) => shipNationalityIdFromSortId(ship?.api_sort_id) === nationalityId)
    .sort((a, b) => a.api_stype - b.api_stype || a.api_sortno - b.api_sortno)

const rootsOfHistFleet = (entryId: string): any[] =>
  [...chainOf.keys()]
    .filter((id) => histFleets.ofRoot(id).some((entry) => entry.id === entryId))
    .map((id) => friendlyShips.get(id))
    .filter(Boolean)
    .sort((a, b) => a.api_stype - b.api_stype || a.api_sortno - b.api_sortno)

/**
 * 队名 + 期别的完整显示名（同队多期分开立条，光有队名分不出是哪一期）。
 *
 * 期别只在**真能补充信息**时才挂出来：队名本身已经带括号注（「第二十七驱逐队
 * （有明·夕暮 期）」）或已经把期别写进名字（「第八驱逐队 第一小队」+ 期别「小队」）
 * 的，再挂一遍就成了「（再编）（再编成）」这种叠字。
 */
const histFleetLabel = (entry: HistFleetEntry): string => {
  const label = entry.period?.label
  if (!label || entry.name.zh.includes('（') || entry.name.zh.includes(label)) return entry.name.zh
  return `${entry.name.zh}（${label}）`
}

/**
 * 详情页的「编队」小节：这艘舰所属的史实编队 + 同队僚舰。
 *
 * 一队一行（同队多期本来就是多条，于是期别天然分行）。僚舰走 EntityLink 可跳；
 * 未实装的成员显示成灰字、不给链接——照实标缺，不找近似替身。
 * note 只在 noteStatus==='verified' 时才摆出来：未核的史实注记不进产品面。
 */
const shipHistFleetSectionHtml = (rootId: number): string => {
  const entries = histFleets.ofRoot(rootId)
  if (!entries.length) return '' // 没队的舰整节不渲染，不留空壳
  const ordered = [...entries].sort(
    (a, b) =>
      HIST_FLEET_KIND_ORDER.indexOf(a.kind) - HIST_FLEET_KIND_ORDER.indexOf(b.kind) ||
      (a.period?.order ?? 0) - (b.period?.order ?? 0) ||
      a.id.localeCompare(b.id),
  )
  const rows = ordered
    .map((entry) => {
      const mates = entry.members
        .map((member) => {
          if (member.ref.form === 'absent') {
            return `<span class="miss" title="${esc('游戏尚未实装该舰')}">${esc(member.ref.name)}</span>`
          }
          const id = member.ref.id
          const flag = member.role === 'flagship' ? '<i class="hf-flag">⚑</i>' : ''
          const pick = member.optional ? '<i class="hf-period">选</i>' : ''
          const name = entityNamePlain('ship', id, friendlyShips.get(id)?.api_name ?? `#${id}`)
          const self = (rootOf.get(id) ?? id) === rootId
          const body = self
            ? `<b>${esc(name)}</b>`
            : elink('mstShip', id, name)
          return `<span>${flag}${body}${pick}</span>`
        })
        .join('')
      const body = mates || '<span class="miss">游戏原文只给舰种</span>'
      // 队名的颜色由 .el.e-histfleet 给（实体链色的单一出处），外层只管排版——
      // 往 elink 的 attrs 里塞 class 会渲成重复属性，被 HTML 解析静默丢掉
      return `<div class="hf-row">
        <span class="hf-name">${elink('histFleet', entry.id, histFleetLabel(entry))}</span>
        <span class="hf-mates">${body}</span>
        ${
          entry.noteStatus === 'verified' && entry.note
            ? `<div class="hf-note">${esc(entry.note)}</div>`
            : ''
        }
      </div>`
    })
    .join('')
  // 图例只在真出现了那个记号时才给——没有旗舰的队摆着「⚑ 旗舰」是噪声
  const legend = [
    `${ordered.length} 队`,
    ordered.some((entry) => entry.members.some((m) => m.role === 'flagship')) ? '⚑ 旗舰' : '',
    ordered.some((entry) => entry.members.some((m) => m.optional)) ? '选 = 任选其一' : '',
  ].filter(Boolean).join(' · ')
  return `<div class="sec">
    <div class="sec-h">编队<span class="aux">${legend}</span></div>
    ${rows}
  </div>`
}

/** 身份卡上的编队灰字（提案 1B：型号行挂一行队名，不做大徽章） */
const shipHistFleetInlineHtml = (rootId: number): string => {
  const entries = histFleets.ofRoot(rootId)
  if (!entries.length) return ''
  const names = entries.map((entry) => esc(histFleetLabel(entry)))
  return `<div class="cls" style="font-size:12px;color:var(--sub);margin-top:2px">
    <span class="hf-tag">${names.join(' · ')}</span></div>`
}

// 舰级真名索引。判据与那条「图鉴编号 ≠ 首舰」的实证写在 shared/ship-class-name.ts；
// 这里只负责跟着两个源重建缓存（与 rootsOfClass 同一套「源换了才重建」的写法）。
//
// 两层：kcwiki-ships 是主层，wikiwiki-ship-profile 是**补缺不覆盖**的自补层
//（2026-08-23 用户拍板「舰级启发式只填空」——自补层把启发式挤到只剩两个源都没有的空白格）。
let classNameSource: typeof kcwikiByMst | null = null
let classNameProfileSource: typeof shipProfileByMst | null = null
let classNameByCtype = new Map<number, string>()
const shipClassNameIndex = (): Map<number, string> => {
  if (classNameSource === kcwikiByMst && classNameProfileSource === shipProfileByMst) {
    return classNameByCtype
  }
  classNameSource = kcwikiByMst
  classNameProfileSource = shipProfileByMst
  const ctypeOf = (mstId: number) => Number(friendlyShips.get(mstId)?.api_ctype) || 0
  classNameByCtype = buildShipClassNameIndex(kcwikiByMst.values(), ctypeOf)
  supplementShipClassNames(classNameByCtype, shipProfileByMst.values(), ctypeOf)
  return classNameByCtype
}

/**
 * 舰级显示名的**唯一出口**：筛选 chip、详情页舰级标题、计数全走这里。
 *
 * 三层，逐层只填上一层留下的空白：
 *   ① kcwiki 的舰级真名；② wikiwiki-ship-profile 自补层（补缺不覆盖）；
 *   ③ 两个源都没有才退回启发式「该级图鉴编号最小的那艘 + 级」。
 *
 * 启发式常错（140 个舰级里 53 个），而且**不稳**——同一个 ctype 进来一艘 sortno 更小的
 * 新舰就当场改名。所以它只许填空白，不许顶掉任何一层给出的真名。
 */
const shipClassLabel = (ctype: number): string => {
  const known = shipClassNameIndex().get(ctype)
  if (known) return known
  const lead = rootsOfClass(ctype)[0]
  if (!lead) return `未识别舰级 #${ctype}`
  return `${entityNamePlain('ship', lead.api_id, lead.api_name)}级`
}

/**
 * 「更多分类 · 舰种」。顶栏的 chip 是常用分组，这里把主数据里**每一个**舰种
 * 逐个列出来，各带图鉴内的形态数——扬陆舰、水上机母舰、潜水母舰这些原来
 * 全塞在「其他」里，翻起来只能靠肉眼。
 *
 * 名字取自 mg.master.stypes，不在代码里硬编码；主数据没给的舰种不显示。
 */
/**
 * 一段分类的外壳：抬头行 + （展开时）就地过滤框 + 格子。
 *
 * 抬头行**常驻显示这一段当前选中的东西**（彩色 chip，点它就取消）——
 * 收起来之后状态不能跟着藏起来，不然人不知道自己正被什么筛着（纪律「窄了改排布，不藏内容」）。
 */
const catSectionHtml = (opts: {
  key: Exclude<ShipCatSection, ''>
  color: string
  label: string
  meta: string
  picked: string
  find?: { value: string; placeholder: string }
  body: string
}): string => {
  const open = moreCategorySection === opts.key
  return `<div class="cat-sec${open ? ' open' : ''}" style="--dim-c:var(${opts.color})">
    <div class="cat-more-h" data-cat-sec="${opts.key}" role="button" tabindex="0" aria-expanded="${open}">
      <i class="cat-arrow">⌄</i><b>${opts.label}</b><span>${opts.meta}</span>
      ${opts.picked}
    </div>
    ${
      open
        ? `${
          opts.find
            ? `<div class="cat-find"><input data-cat-find="${opts.key}" value="${esc(opts.find.value)}"
                placeholder="${esc(opts.find.placeholder)}" spellcheck="false">${
              opts.find.value ? `<span class="x" data-cat-find-clear="${opts.key}">×</span>` : ''
            }</div>`
            : ''
        }${opts.body}`
        : ''
    }
  </div>`
}

/** 抬头行上那枚「正在按这个筛」的 chip；没选中就什么都不出 */
const catPickedHtml = (key: Exclude<ShipCatSection, ''>, label: string): string =>
  `<span class="cat-picked" data-clear-dim="${key}">${label} ×</span>`

/** 段内就地过滤：把归一后的关键词与候选名字对一下。空串一律放行 */
const catFindHit = (needle: string, ...names: (string | undefined)[]): boolean => {
  const key = needle.trim().toLowerCase()
  if (!key) return true
  return names.some((name) => `${name ?? ''}`.toLowerCase().includes(key))
}

const shipMoreCategoriesHtml = (): string => {
  const index = chainStypeIndex()
  const byLabel = new Map<string, { ids: number[]; count: number }>()
  for (const id of ALL_SHIP_TYPE_IDS) {
    if (!mg.master.stypes[id]) continue
    const slot = byLabel.get(stypeLabelOf(id)) ?? { ids: [], count: 0 }
    slot.ids.push(id)
    byLabel.set(stypeLabelOf(id), slot)
  }
  // 数字 = 点下去真能看到的条数。原来数的是「全部形态」，与列表（按根形态列）
  // 不是同一个population：扬陆舰标 8 实际 4 条，航空战舰标 9 实际 0 条。
  for (const set of index.values()) {
    for (const slot of byLabel.values()) {
      if (slot.ids.some((id) => set.has(id))) slot.count++
    }
  }
  const cells = [...byLabel.values()]
    .filter((slot) => slot.count > 0) // 图鉴里一条都筛不出来的舰种，列出来只是噪声
    .sort((a, b) => a.ids[0] - b.ids[0])
    .map((slot) => {
      const on = slot.ids.includes(shipState.typeFilter)
      return `<span class="cat-cell${on ? ' on' : ''}" data-ship-type="${slot.ids[0]}">
        ${entityNameHtml('shipType', slot.ids[0], mg.master.stypes[slot.ids[0]], { compact: true })}<i>${slot.count}</i></span>`
    })
  return catSectionHtml({
    key: 'stype',
    color: '--entity-ship',
    label: '舰种',
    meta: `共 ${cells.length} 种 · 含改造后形态`,
    picked: shipState.typeFilter
      ? catPickedHtml('stype', entityNameHtml(
        'shipType',
        shipState.typeFilter,
        mg.master.stypes[shipState.typeFilter] ?? `舰种${shipState.typeFilter}`,
        { compact: true },
      ))
      : '',
    body: `<div class="cat-grid">${cells.join('')}</div>`,
  })
}

/**
 * 国籍 / 型（舰级）/ 编队 三段的计数一次扫完。
 *
 * 每段都要问「这一档点下去有几条」，各自扫一遍就是三趟全表 ×（12 / 130 / 75）档。
 * 索引按 chainOf 的引用失效——主数据换一份自动重建，与在籍统计同一手法。
 */
// 「未归类」这一档的筛选值与桶判定都住在共享注册表里（分类即基础设施：
// 一个维度只有一份口径，各模块只拉取不自造）。它不是一个国籍实体——
// `shipNationalityById` 查不到它，界面上也不该给它实体链。
const NATION_UNCLASSIFIED = SHIP_NATIONALITY_UNCLASSIFIED
const NATION_UNCLASSIFIED_LABEL = '未归类'
const nationBucketOf = shipNationalityBucketOf

let dimCountSource: typeof chainOf | null = null
let dimCounts = {
  nation: new Map<number, number>(),
  ctype: new Map<number, number>(),
  fleet: new Map<string, number>(),
}
const dimCountIndex = () => {
  if (dimCountSource !== chainOf) {
    dimCountSource = chainOf
    const nation = new Map<number, number>()
    const ctype = new Map<number, number>()
    const fleet = new Map<string, number>()
    const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1)
    for (const rootId of chainOf.keys()) {
      const ship = friendlyShips.get(rootId)
      if (!ship) continue
      bump(nation, nationBucketOf(ship.api_sort_id))
      bump(ctype, Number(ship.api_ctype) || 0)
      for (const entry of histFleets.ofRoot(rootId)) bump(fleet, entry.id)
    }
    dimCounts = { nation, ctype, fleet }
  }
  return dimCounts
}

/** 「更多分类 · 国籍」。国籍口径来自 shared/ship-nationality，与任务门、装备加成共用一份。 */
const shipNationCategoriesHtml = (): string => {
  const counts = dimCountIndex().nation
  const cells = SHIP_NATIONALITIES.filter((nationality) => (counts.get(nationality.id) ?? 0) > 0)
    .map((nationality) => {
      const on = shipState.nationalityFilter === nationality.id
      return `<span class="cat-cell${on ? ' on' : ''}" data-ship-nation="${nationality.id}">
        ${esc(nationality.label)}<i>${counts.get(nationality.id) ?? 0}</i></span>`
    })
  // 编号段判不出国籍的那些**必须有一格站着**。判据是官方编号段，而段是有边界的：
  // 十三个国家之外的新号段一落地，那些舰在这一维上就一格都不属于——原先它们既不
  // 出现在任何国籍下，也没有「未归类」可点，等于在这一维上凭空消失（自扩展公约的
  // 反模式：清单先行、对不上就隐身）。名分（新号段归哪一国）到位后这一格自动空掉。
  const unclassified = counts.get(NATION_UNCLASSIFIED) ?? 0
  if (unclassified > 0) {
    const on = shipState.nationalityFilter === NATION_UNCLASSIFIED
    cells.push(`<span class="cat-cell${on ? ' on' : ''}" data-ship-nation="${NATION_UNCLASSIFIED}"
      title="官方编号段国籍尚未确定">${esc(NATION_UNCLASSIFIED_LABEL)}<i>${unclassified}</i></span>`)
  }
  if (!cells.length) return ''
  const nationCount = cells.length - (unclassified > 0 ? 1 : 0)
  return catSectionHtml({
    key: 'nation',
    color: '--entity-nationality',
    label: '国籍',
    meta: `共 ${nationCount} 国`,
    // 未归类不是一个实体，别给它一个点了什么都不会发生的实体链
    picked: shipState.nationalityFilter
      ? catPickedHtml('nation', shipState.nationalityFilter === NATION_UNCLASSIFIED
        ? esc(NATION_UNCLASSIFIED_LABEL)
        : entityTermHtml(
          'shipNationality',
          shipState.nationalityFilter,
          shipNationalityById(shipState.nationalityFilter)?.label ?? `国籍${shipState.nationalityFilter}`,
        ))
      : '',
    body: `<div class="cat-grid">${cells.join('')}</div>`,
  })
}

/** 「更多分类 · 型」。舰级按舰种归组，不然 130 个级名平铺一片找不着；段内还带就地过滤。 */
const shipClassCategoriesHtml = (): string => {
  const counts = dimCountIndex().ctype
  const byStype = new Map<number, number[]>()
  for (const [ctype] of counts) {
    if (!ctype) continue
    const lead = rootsOfClass(ctype)[0]
    if (!lead) continue
    const list = byStype.get(lead.api_stype) ?? []
    list.push(ctype)
    byStype.set(lead.api_stype, list)
  }
  if (!byStype.size) return ''
  let shown = 0
  const groups = [...byStype.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stype, ctypes]) => {
      const cells = ctypes
        .sort((a, b) => (rootsOfClass(a)[0]?.api_sortno ?? 0) - (rootsOfClass(b)[0]?.api_sortno ?? 0))
        // 过滤只缩小格子，不改分组与排序——清空就恢复全量。
        // 三个干草堆：真名（显示的那个）、头舰日文名、头舰中文名——正名把「雪风级」
        // 换成了「阳炎级」，但打「雪风」还该找得到它，正名不该顺手砍掉一条找路。
        .filter((ctype) =>
          catFindHit(
            catFind.class,
            shipClassLabel(ctype),
            rootsOfClass(ctype)[0]?.api_name,
            entityNamePlain('ship', rootsOfClass(ctype)[0]?.api_id, rootsOfClass(ctype)[0]?.api_name),
          ),
        )
        .map((ctype) => {
          shown += 1
          const on = shipState.classFilter === ctype
          return `<span class="cat-cell${on ? ' on' : ''}" data-ship-class="${ctype}">
            ${esc(shipClassLabel(ctype))}<i>${counts.get(ctype) ?? 0}</i></span>`
        })
        .join('')
      // 一格都没剩的舰种连小标题一起收掉，不留空段
      return cells ? `<div class="cat-sub">${esc(stypeLabelOf(stype))}</div><div class="cat-grid">${cells}</div>` : ''
    })
    .join('')
  const total = [...counts.keys()].filter(Boolean).length
  return catSectionHtml({
    key: 'class',
    color: '--entity-shipclass',
    label: '型',
    meta: catFind.class.trim()
      ? `${shown} / ${total} 级 · 按舰种归组`
      : `共 ${total} 级 · 按舰种归组`,
    picked: shipState.classFilter
      ? catPickedHtml('class', entityTermHtml('shipClass', shipState.classFilter, shipClassLabel(shipState.classFilter)))
      : '',
    find: { value: catFind.class, placeholder: '级名，如「吹雪」「Fletcher」' },
    body: groups || '<div class="cat-none">暂无匹配的舰级</div>',
  })
}

/**
 * 「更多分类 · 编队」。数据是 shared/hist-fleets 的第一方史实编队库——
 * 队名的成员表以游戏任务正文的操作性定义为准，图鉴是这份分类的展示面与公证处。
 */
const shipFleetCategoriesHtml = (): string => {
  const counts = dimCountIndex().fleet
  const byKind = new Map<string, HistFleetEntry[]>()
  for (const entry of HIST_FLEETS) {
    const list = byKind.get(entry.kind) ?? []
    list.push(entry)
    byKind.set(entry.kind, list)
  }
  let listed = 0
  const groups = HIST_FLEET_KIND_ORDER.filter((kind) => byKind.has(kind))
    .map((kind) => {
      const cells = (byKind.get(kind) ?? [])
        // 过滤认队名的三种写法（中文名 / 日文名 / 别称），与搜索域同一口径
        .filter((entry) => catFindHit(catFind.fleet, entry.name.zh, entry.name.ja, ...entry.aliases))
        .map((entry) => {
          listed += 1
          const on = shipState.fleetFilter === entry.id
          const shown = counts.get(entry.id) ?? 0
          return `<span class="cat-cell${on ? ' on' : ''}" data-ship-fleet="${esc(entry.id)}"
            title="${esc(histFleetTip(entry))}">${esc(histFleetLabel(entry))}<i>${shown}</i></span>`
        })
        .join('')
      return cells ? `<div class="cat-sub">${esc(HIST_FLEET_KIND_LABEL[kind])}</div><div class="cat-grid">${cells}</div>` : ''
    })
    .join('')
  const picked = shipState.fleetFilter ? histFleetById(shipState.fleetFilter) : null
  return catSectionHtml({
    key: 'fleet',
    color: '--entity-histfleet',
    label: '编队',
    meta: catFind.fleet.trim()
      ? `${listed} / ${HIST_FLEETS.length} 队 · 同队多期分开列`
      : `共 ${HIST_FLEETS.length} 队 · 同队多期分开列`,
    picked: picked ? catPickedHtml('fleet', esc(histFleetLabel(picked))) : '',
    find: { value: catFind.fleet, placeholder: '队名，如「六驱」「西村」' },
    body: groups || '<div class="cat-none">暂无匹配的编队</div>',
  })
}

/** 悬停提要：成员名单（未实装的标出来），队名之外唯一要说的事 */
const histFleetTip = (entry: HistFleetEntry): string => {
  const names = entry.members.map((member) => histFleetMemberName(member))
  if (!names.length) return '游戏原文只给舰种'
  return names.join('、')
}

/** 成员的显示名：素名取链根、写明形态取代表形态、未实装照实给名字 */
const histFleetMemberName = (member: HistFleetMember): string => {
  if (member.ref.form === 'absent') return `${member.ref.name}（游戏尚未实装）`
  const id = member.ref.form === 'exact' ? member.ref.id : member.ref.id
  return entityNamePlain('ship', id, friendlyShips.get(id)?.api_name ?? `#${id}`)
}

const shipCategoryPanelHtml = (): string =>
  `<div class="cat-more">
    ${shipMoreCategoriesHtml()}
    ${shipNationCategoriesHtml()}
    ${shipClassCategoriesHtml()}
    ${shipFleetCategoriesHtml()}
  </div>`

/**
 * 捞船规划：把「还缺哪些」「去哪捞」「哪些快关门」三件事并成一张单子。
 *
 * 这三份数据本来都在——图鉴知道缺口、离线目录知道掉点、限定期带截止日，
 * 只是分散在三处，玩家得自己逐张海域翻着凑。限定掉落有截止日，
 * 所以「快关门的」单独提前列，那是唯一有时限的决策。
 */
const HUNT_SOON_DAYS = 30
const HUNT_STANDING_CAP = 15

/**
 * 「本期活动」这个语境还成不成立——判据在 `shared/event-area.ts`
 * 的 `eventContextStillOpen`（含三态口径与「主数据 null 不算无活动」的理由）。
 *
 * 这里只加一层缓存：捞船单子每行都要问一次，而判据要把 maparea/mapinfo
 * 两张表扫一遍。按 mst 的**对象身份**记——主数据换了一份自然重算。
 */
let eventContextCache: { of: unknown; value: boolean } | null = null
const eventStillRunning = (): boolean => {
  const cached = eventContextCache
  if (cached && cached.of === mst) return cached.value
  const value = eventContextStillOpen(mst)
  eventContextCache = { of: mst, value }
  return value
}

const huntPlanHtml = (): string => {
  const missing = [...chainOf.keys()].filter((id) => chainInstances(id).length === 0)
  if (!missing.length) return ''
  const today = fmtDate(Date.now())
  const daysBetween = (until: string): number =>
    Math.ceil((Date.parse(`${until}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000)

  const catchable = missing.flatMap((id) => {
    const sites = confirmedDropSitesOf(id)
    if (!sites.length) return []
    const untils = sites.map((s) => s.limitedUntil).filter((v): v is string => !!v).sort()
    const until = untils[0] ?? null
    return [{ id, sites, until, days: until ? daysBetween(until) : null }]
  })
  // 只剩已终了掉点的那批：她们**实际无路可捞**，所以一条都不进上面的可捞计数。
  // 但也一条都不删——照活动结束那批的老规矩，沉到底换个如实的语境，
  // 好让玩家看得出「不是目录没收录，是那批限定终了了」。
  const endedOnly = missing.flatMap((id) => {
    if (confirmedDropSitesOf(id).length) return []
    const ended = endedDropSitesOf(id)
    return ended.length ? [{ id, ended }] : []
  })
  if (!catchable.length && !endedOnly.length) {
    return `<div class="hunt-none">缺少 ${missing.length} 艘 · 暂无掉落点资料</div>`
  }

  const rowOf = (entry: (typeof catchable)[number]) => {
    // 同一张图的各难度并成一条：活动图一艘舰能占「62-3 甲 / 62-3 乙 / 62-3 丙」
    // 三行位置，说的却是同一件事。合成「62-3 甲/乙/丙/丁 O/Q/X」信息量更大。
    const byMap = new Map<string, { diffs: string[]; nodes: string[]; limited: boolean }>()
    for (const site of entry.sites) {
      const group = byMap.get(site.map) ?? { diffs: [], nodes: [], limited: false }
      if (site.difficulty && !group.diffs.includes(site.difficulty)) group.diffs.push(site.difficulty)
      for (const node of site.nodes) if (!group.nodes.includes(node)) group.nodes.push(node)
      if (site.limited) group.limited = true
      byMap.set(site.map, group)
    }
    const places = [...byMap.entries()].map(
      ([map, g]) =>
        `${map}${g.diffs.length ? ` ${g.diffs.join('/')}` : ''} ${g.nodes.slice(0, 3).join('/')}${
          g.limited ? '（限定中）' : ''
        }`,
    )
    // 常驻舰能有二十多张图，单子上只给前三张，点名字进详情看全部
    const where = places.slice(0, 3).join(' · ')
    const more = places.length > 3 ? ` <i>+${places.length - 3} 图</i>` : ''
    const clock =
      entry.days == null
        ? ''
        : `<span class="hunt-clock${entry.days <= 7 ? ' urgent' : ''}">剩 ${Math.max(0, entry.days)} 天</span>`
    return `<div class="hunt-row">
      <span class="hunt-n">${shipThumbHtml(entry.id, masterShipName(entry.id), { className: 'drop' })}${elink('mstShip', entry.id, masterShipName(entry.id))}${isFavoriteShipRoot(entry.id) ? '<i class="fav-mini" title="已收藏 · 组内靠前显示">★</i>' : ''}</span>
      <span class="hunt-w">${esc(where)}${more}</span>
      ${clock}
    </div>`
  }

  // 已终了的那批：行长得跟上面一样，只是掉点灰显 + 标「已终了」，也没有倒计时——
  // 没有什么日子好赶了。悬停给批次名与起始日，说清是哪一批限定把她带进来的。
  const endedRowOf = (entry: (typeof endedOnly)[number]) => {
    const places = entry.ended.map(
      (site) =>
        `${site.map}${site.difficulty ? ` ${site.difficulty}` : ''} ${site.nodes.slice(0, 3).join('/')}（限定·已结束）`,
    )
    const title = entry.ended.map((site) => limitedWindowText(site.window)).join(' · ')
    return `<div class="hunt-row">
      <span class="hunt-n">${shipThumbHtml(entry.id, masterShipName(entry.id), { className: 'drop' })}${elink('mstShip', entry.id, masterShipName(entry.id))}${isFavoriteShipRoot(entry.id) ? '<i class="fav-mini" title="已收藏 · 组内靠前显示">★</i>' : ''}</span>
      <span class="hunt-w ended" title="${esc(title)}">${esc(places.slice(0, 3).join(' · '))}${
        places.length > 3 ? ` <i>+${places.length - 3} 图</i>` : ''
      }</span>
    </div>`
  }

  // 按「会不会消失」分组，而不是按「有没有日期」。这两件事在舰C 里不是一回事：
  //   · 活动图      活动一结束掉落就没了 —— **真的有时限**，但官方一般要到结束前
  //                 1–2 周才公布具体日期，所以活动进行中 event.until 是 null 属正常，
  //                 等资料补上日期，倒计时会自动出现（解析与排序都已就位）
  //   · 常规图限定  多是某次追加后一直开着的（玩家口径的「永久开放的限定掉落」），
  //                 kcwiki 本来就不给截止日 —— null 是如实记录，不是资料缺失
  // 实测随包目录：常规图 112 条限定掉落无一写截止日，活动图 62-x 的 event.until 也是 null。
  // 所以绝不能拿「没有日期」当「快关门」去催玩家，那是凭空造出来的紧迫感。
  // 收藏组内靠前（2026-08-16 用户提议的收藏置顶口径）：missing 的 id 本来就是
  // 链根，直接判。「快关门」组仍以剩余天数为先——紧迫性不让位给偏好。
  const favRank = (e: (typeof catchable)[number]) => (isFavoriteShipRoot(e.id) ? 0 : 1)
  // 包说「本期活动」还得跟主数据对一次口供（eventStillRunning 的注释写了为什么）。
  // 口径是「永不删除，只换语境」：活动已经结束的那批船一条都不从单子上撤，
  // 只是不再挂在「当前活动图可捞」底下催人去打，改挂如实的语境。
  const packSaysEvent = catchable.filter((e) => e.sites.some((s) => s.event?.status === 'active'))
  const eventOpen = eventStillRunning()
  const inEvent = (eventOpen ? packSaysEvent : []).sort((a, b) => favRank(a) - favRank(b))
  const eventClosed = (eventOpen ? [] : packSaysEvent).sort((a, b) => favRank(a) - favRank(b))
  const rest = catchable.filter((e) => !packSaysEvent.includes(e))
  const soon = rest
    .filter((e) => e.days != null && e.days <= HUNT_SOON_DAYS)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0) || favRank(a) - favRank(b))
  const limitedStanding = rest
    .filter((e) => !soon.includes(e) && e.sites.some((s) => s.limited))
    .sort((a, b) => favRank(a) - favRank(b))
  const standing = rest
    .filter((e) => !soon.includes(e) && !limitedStanding.includes(e))
    .sort((a, b) => favRank(a) - favRank(b))
  const shownStanding = standing.slice(0, HUNT_STANDING_CAP)
  const eventName =
    (inEvent[0] ?? eventClosed[0])?.sites.find((s) => s.event?.status === 'active')?.event?.name ?? ''

  return `<details class="hunt-plan" data-keep="hunt-plan">
    <summary>还缺 <b>${missing.length}</b> 艘 · 目录里能查到掉点的 <button class="hunt-pick${
      shipState.huntFilter === 'catchable' ? ' on' : ''
    }" data-hunt-filter="catchable" title="只看这批">${catchable.length}</button> 艘${
      inEvent.length
        ? ` · <button class="hunt-pick urgent${shipState.huntFilter === 'event' ? ' on' : ''}" data-hunt-filter="event" title="只看当前活动图能捞的">${inEvent.length} 艘在当前活动图</button>`
        : ''
    }${soon.length ? ` · <b class="urgent">${soon.length} 艘 · 距限定结束不足 ${HUNT_SOON_DAYS} 天</b>` : ''}</summary>
    <div class="hunt-body">
      ${
        inEvent.length
          ? `<div class="hunt-h urgent">当前活动图可捞${eventName ? ` · ${esc(eventName)}` : ''}</div>${inEvent.map(rowOf).join('')}`
          : ''
      }
      ${soon.length ? `<div class="hunt-h urgent">限定结束临近</div>${soon.map(rowOf).join('')}` : ''}
      ${
        limitedStanding.length
          ? `<div class="hunt-h">限定掉落 · 常规图</div>${limitedStanding.map(rowOf).join('')}`
          : ''
      }
      ${
        shownStanding.length
          ? `<div class="hunt-h">常驻确认可捞</div>${shownStanding.map(rowOf).join('')}${
              standing.length > shownStanding.length
                ? `<div class="hunt-more">另有 ${standing.length - shownStanding.length} 艘未列出</div>`
                : ''
            }`
          : ''
      }
      ${
        // 包还写着 active、主数据里活动图却已经撤了的那批。一条都不删，沉到底
        // 换个如实的语境（同 di 把已收窗的掉落移进「往期」那一手）
        eventClosed.length
          ? `<div class="hunt-h">活动已结束 · 对应掉落当前不可获取${eventName ? ` · ${esc(eventName)}` : ''}</div>${eventClosed.map(rowOf).join('')}`
          : ''
      }
      ${
        // 同一手：限定期终了的那批也沉到底，只换语境不删行
        endedOnly.length
          ? `<div class="hunt-h">限定期已结束 · 对应掉落当前不可获取</div>${endedOnly.map(endedRowOf).join('')}`
          : ''
      }
    </div>
  </details>`
}

/** 目录里的一行舰。分组排布与编号平铺共用这一份，避免两套渲染各写一遍行 */
const shipCatalogRowHtml = (root: any): string => {
  const has = chainInstances(root.api_id).length > 0
  const favorite = isFavoriteShipRoot(root.api_id)
  const color = has ? (RARITY_COLOR[root.api_backs] ?? '#7db4d8') : '#3a4a58'
  const on = root.api_id === shipState.selectedRoot && shipState.open
  const yomi = `${root.api_yomi ?? ''}`.trim()
  const subline = [
    `No.${`${root.api_sortno}`.padStart(3, '0')}`,
    yomi ? esc(yomi) : '',
    has ? '' : '未持有',
  ].filter(Boolean).join(' · ')
  return `<div class="row${has ? '' : ' ghost'}${on ? ' on' : ''}" data-root="${root.api_id}" style="--rc:${color}">
    <div class="face shipface">${shipThumbHtml(root.api_id, entityNamePlain('ship', root.api_id, root.api_name), { className: 'catalog', placeholder: has ? entityNamePlain('ship', root.api_id, root.api_name).charAt(0) : '?' })}</div>
    <div class="nm"><b>${entityNameHtml('ship', root.api_id, root.api_name, { compact: true })}</b>${favorite ? '<i class="fav-mini" title="已收藏">★</i>' : ''}<span>${subline}</span></div>
  </div>`
}

// ---- NPC 位：kc9999 那一族的台词（明石、大淀、间宫、伊良湖，以及活动演出）----
//
// 归在舰娘目录的一格分类里，不另开一卷：它们是「界面上会开口的角色」，
// 与舰娘同属人物侧，只是没有 mstId。分组与排序的判据在 shared/npc-voice-book。
//
// **不进 shared 的 SHIP_CHIPS**：那张表是「舰种筛选口径」，深海卷的舰种行与 qa 模块
// 都在消费它（两处已经各为「收藏」写过一次例外）。再塞一个不按舰种筛的格子进去，
// 那两个界面就会凭空多出一枚点了没反应的 NPC 钮。它只是舰娘目录自己的视图开关。
const NPC_CHIP = 'NPC'

/** 整理好的分组视图。台词包到位时算一次，逐行渲染只查表。 */
let npcVoiceGroups: NpcVoiceGroup[] = []

/** 顶栏那排 chip。NPC 那一格挂在常用分组之后，与「收藏」一样不按舰种筛。 */
const shipChipsHtml = (): string => {
  const plain =
    !shipState.classFilter &&
    !shipState.typeFilter &&
    !shipState.nationalityFilter &&
    !shipState.fleetFilter
  return [...SHIP_CHIPS.map(([label]) => label), NPC_CHIP]
    .map(
      (label) =>
        `<span class="chip${label === shipState.chip && plain ? ' on' : ''}" data-chip="${label}">${label}</span>`,
    )
    .join('')
}

/**
 * NPC 位的目录页：一位角色一行。
 *
 * 摆得出的数字只有音轨数与句数——等级、舰种、图鉴编号那些是舰娘位的字段，
 * NPC 没有，就一个都不摆（补一个「—」等于说这一格本该有值）。
 * 名字对得上舰娘的那几位（明石、大淀）这里也**不做跳转**：这一页的身份就是 NPC 位，
 * 跳去舰娘页正好制造这一行小注要防的混淆。
 */
const npcCatalogHtml = (): string => {
  const rows = npcVoiceGroups
    .map((group) => {
      const on = group.name === shipState.npcName && shipState.open
      return `<div class="row npc-row${on ? ' on' : ''}" data-npc="${esc(group.name)}">
      <div class="face">${esc(group.name.charAt(0))}</div>
      <div class="nm"><b>${esc(group.name)}</b><span>${group.tracks.length} 条音轨 · ${group.lineCount} 句</span></div>
    </div>`
    })
    .join('')
  return `
    <div class="type-chips">${shipChipsHtml()}</div>
    <div class="vo-note npc-note">明石、大淀等舰娘本体台词 · 各自图鉴页</div>
    <div class="ship-list npc-list" id="ji-npc-list">${
      rows || '<div style="padding:20px;color:var(--dim)">台词包尚未加载</div>'
    }</div>`
}

/**
 * 一位 NPC 的台词页。一个音轨编号 = 一个 mp3 = 一张卡，卡里逐行「谁：这一句」。
 *
 * 播放钮只挂在卡的**第一行**：逐行各挂一枚等于同一段音频摆了好几个入口，
 * 点哪个都是从头播整条。后面几行留一枚空钮占位，两列文字才对得齐。
 * 地址走既有出口 `extraVoiceUrl('npc', …)`，一个 https 都不在这儿拼。
 */
const npcDrawerHtml = (): string => {
  const group = npcVoiceGroupOf(npcVoiceGroups, shipState.npcName)
  if (!group) return ''
  const blocks = group.tracks
    .map((track) => {
      const url = extraVoiceUrl('npc', track.key)
      // 档案里那一份本来就在档案里，不必再入一次：只有现取的（https）才带路径去入档
      const playPath = url && url.startsWith('https:') ? track.path : ''
      const lines = track.lines
        .map((line, index) => {
          const zh = normalizeVoiceText(line.zh)
          const play =
            index > 0
              ? '<span class="vo-play off"></span>'
              : url
                ? `<span class="vo-play" data-npc-voice="${esc(url)}"${
                    playPath ? ` data-voice-path="${esc(playPath)}"` : ''
                  } title="播放">▶</span>`
                : '<span class="vo-play off" title="游戏资源获取不可用 · 登录游戏或开启「未缓存的立绘/语音从游戏资源服务器取」"></span>'
          return `<div class="vo-row">
        <span class="vo-k">${esc(line.name)}</span>
        <div class="vo-tx">
          ${line.ja ? `<div class="vo-ja">${esc(line.ja)}</div>` : ''}
          ${zh ? `<div class="vo-zh">${esc(zh)}</div>` : ''}
        </div>
        ${play}
      </div>`
        })
        .join('')
      return `<div class="npc-track">${lines}</div>`
    })
    .join('')
  return `
  <div class="d-head">
    <span class="x" id="ji-npc-close" title="关闭（Esc）">✕</span>
    <span class="crumb">${NPC_CHIP} › <b>${esc(group.name)}</b></span>
    <span class="sp"></span>
  </div>
  <div class="detail">
    <div class="vo-list" id="ji-npc-voices">${blocks}</div>
  </div>`
}

const shipCatalogHtml = () => {
  // NPC 那一格换的是整页目录，不是把舰娘筛一遍：搜索框与排序只对舰娘成立，
  // 摆在它底下就是点了没反应的死控件，所以在这儿分岔而不是往下走一遍筛选。
  if (shipState.chip === NPC_CHIP) return npcCatalogHtml()
  const roots = filteredRoots()
  const groups: Record<string, any[]> = {}
  for (const root of roots) {
    const rawTypeName = mg.master.stypes[root.api_stype] ?? `舰种${root.api_stype}`
    const typeName = entityNamePlain('shipType', root.api_stype, rawTypeName)
    ;(groups[typeName] ??= []).push(root)
  }
  const totalRoots = chainOf.size
  const ownedRoots = [...chainOf.keys()].filter((id) => chainInstances(id).length > 0).length

  const flatRows = () => {
    const owned = roots.filter((root) => chainInstances(root.api_id).length > 0).length
    return `<div class="grp"><b>按图鉴编号</b><span class="cnt">${owned} / ${roots.length}</span></div>${
      roots.map(shipCatalogRowHtml).join('')
    }`
  }

  const groupedRows = () => Object.entries(groups)
    .map(([typeName, list]) => {
      const owned = list.filter((r) => chainInstances(r.api_id).length > 0).length
      const classes = new Map<number, any[]>()
      for (const root of list) {
        const ctype = Number(root.api_ctype) || -root.api_id
        const members = classes.get(ctype) ?? []
        members.push(root)
        classes.set(ctype, members)
      }
      const rowsHtml = [...classes.entries()]
        .map(([ctypeKey, members]) => {
          const ctype = ctypeKey > 0 ? ctypeKey : 0
          const allSisters = ctype ? rootsOfClass(ctype) : members
          const classOwned = allSisters.filter((root) => chainInstances(root.api_id).length > 0).length
          const collapsible = ctype > 0 && allSisters.length > 1
          // 搜索与“直达舰级/国籍/编队”期间临时展开，避免明明命中却只剩一个目录头。
          const collapsed =
            collapsible &&
            !shipState.search &&
            !shipState.classFilter &&
            !shipState.nationalityFilter &&
            !shipState.fleetFilter &&
            collapsedShipClasses.has(ctype)
          // 每个官方 ctype 都必须有自己的舰级标题。过去只给“至少两条根舰”的舰级画标题，
          // 会让后续单舰级（如衣阿华级、甘古特级）视觉上黏进前一个利托里奥级。
          const sisterHead = `<div class="sister-head${collapsible ? ' toggle' : ''}${collapsed ? ' collapsed' : ''}" data-ctype="${ctype}"${
            collapsible ? ` data-sister-toggle="${ctype}" role="button" tabindex="0" aria-expanded="${!collapsed}"` : ''
          }>
            ${collapsible ? '<i class="sister-arrow">⌄</i>' : '<i class="sister-arrow single">•</i>'}
            <b>${entityTermHtml('shipClass', ctype, ctype ? shipClassLabel(ctype) : '未分类舰级')}</b>
            <span>${allSisters.length > 1 ? '姊妹舰' : '同级舰'} ${classOwned} / ${allSisters.length}${members.length !== allSisters.length ? ` · 显示 ${members.length}` : ''}${collapsible ? ` · ${collapsed ? '展开' : '收起'}` : ''}</span>
          </div>`
          const memberRows = collapsed ? '' : members.map(shipCatalogRowHtml).join('')
          return `${sisterHead}${memberRows}`
        })
        .join('')
      return groupBoxHtml(
        `ship:${typeName}`,
        `<b>${elinkHtml('shipTypeCatalog', list[0].api_stype, entityTermHtml('shipTypeCatalog', typeName, typeName))}</b><span class="cnt">${owned} / ${list.length}</span>`,
        rowsHtml,
      )
    })
    .join('')

  const rows = shipState.sort === 'no' ? flatRows() : groupedRows()

  return `
    <div class="search-row">
      <div class="search">⌕<input id="ji-ship-search" placeholder="名字 / 假名 / 舰级 / 舰种 / 编队 / 声优 / 图鉴No." value="${esc(shipState.search)}"></div>
    </div>
    ${
      shipState.huntFilter
        ? `<div class="hunt-active">当前筛选：<b>${
            shipState.huntFilter === 'event' ? '当前活动图能捞的缺口舰' : '目录能查到掉点的缺口舰'
          }</b><button class="hunt-pick" data-hunt-filter="${shipState.huntFilter}">退出筛选 ×</button></div>`
        : ''
    }
    <div class="type-chips">${shipChipsHtml()}
      <span class="chip more${moreCategoriesOpen ? ' on' : ''}" data-more-cat title="按舰种 / 国籍 / 型 / 编队逐个筛选">更多分类 ${moreCategoriesOpen ? '▴' : '▾'}</span>
      ${shipState.typeFilter ? `<span class="chip dim-on linked-filter" style="--dim-c:var(--entity-ship)" data-clear-ship-scope>${entityNameHtml('shipType', shipState.typeFilter, mg.master.stypes[shipState.typeFilter] ?? `舰种${shipState.typeFilter}`, { compact: true })} ×</span>` : ''}
      ${shipState.nationalityFilter ? `<span class="chip dim-on linked-filter" style="--dim-c:var(--entity-nationality)" data-clear-ship-scope>${shipState.nationalityFilter === NATION_UNCLASSIFIED ? esc(NATION_UNCLASSIFIED_LABEL) : entityTermHtml('shipNationality', shipState.nationalityFilter, shipNationalityById(shipState.nationalityFilter)?.label ?? `国籍${shipState.nationalityFilter}`)} ×</span>` : ''}
      ${shipState.classFilter ? `<span class="chip dim-on linked-filter" style="--dim-c:var(--entity-shipclass)" data-clear-ship-scope>${entityTermHtml('shipClass', shipState.classFilter, shipClassLabel(shipState.classFilter))} ×</span>` : ''}
      ${
        shipState.fleetFilter && histFleetById(shipState.fleetFilter)
          ? `<span class="chip dim-on linked-filter" style="--dim-c:var(--entity-histfleet)" data-clear-ship-scope>${esc(histFleetLabel(histFleetById(shipState.fleetFilter)!))} ×</span>`
          : ''
      }
      <span class="sp" style="flex:1 1 0;min-width:4px"></span>
      <span class="sort-seg" id="ji-ship-sort">
        <span class="${shipState.sort === 'group' ? 'on' : ''}" data-ship-sort="group" title="舰种 → 舰级 → 图鉴号">分组</span>
        <span class="${shipState.sort === 'no' ? 'on' : ''}" data-ship-sort="no" title="按图鉴编号排列">编号</span>
      </span>
    </div>
    <div class="ship-list" id="ji-ship-list">${
      // 分类面板长在**滚动容器里面**，不是它上面。挂在外面时它会把 .ship-list
      // 压成 0 高（实测展开 2502px vs 容器 726px），进度条被推到可视区外——
      // 看着就是「列表滚不动、翻不了页」。放进来之后一个面板仍然只有一个滚动条，
      // 面板与列表一起滚，谁也不会被挤没（纪律「一个面板只留一个滚动条」）。
      moreCategoriesOpen ? shipCategoryPanelHtml() : ''
    }${rows || '<div style="padding:20px;color:var(--dim)">暂无匹配项</div>'}</div>
    ${huntPlanHtml()}
    <div class="index-foot">已持有 <b style="color:var(--text)">${ownedRoots}</b> / ${totalRoots}
      <span style="float:right;font-family:var(--mono)">${totalRoots ? ((ownedRoots / totalRoots) * 100).toFixed(1) : 0}%</span>
      <div class="bar"><i style="width:${totalRoots ? (ownedRoots / totalRoots) * 100 : 0}%"></i></div>
    </div>`
}

const STAT_LEGEND_HTML = `<div class="stat-legend">
  <span><i style="background:var(--accent-dim)"></i>初始</span>
  <span><i style="background:var(--stat-grow)"></i>等级成长 →99</span>
  <span><i style="background:var(--stat-over99)"></i>婚后 99→${MARRIED_LEVEL_CAP}</span>
  <span><i style="background:var(--stat-marriage)"></i>结婚耐久</span>
  <span><i style="background:var(--stat-mod)"></i>近代化改修余量</span>
</div>`

const abyssStatRow = (label: string, value: number): string => {
  const cap = statScale(label)
  return `<div class="stat abyss-stat" title="${label}刻度 0—${cap}${value > cap ? ` · ${value} 已超出刻度` : ''}">
    <span class="k">${label}</span><span class="v"><b>${value}</b></span>
    <div class="track"><i class="f1" style="width:${statWidth(value, cap)}%"></i></div>
  </div>`
}

const memorialDate = (ts: number) =>
  fmtDateTime(ts)

const memorialMap = (map: number | null) =>
  map && map > 0 ? mapCodeOf(map) : ''

// 收容库的履历也写玩家认的点位字母（`A 点`），拿不到退 `#号`——与鉴·列表的
// 人生记录同一句口径。原先写的是罗盘内部编号（`点位 12`），海图上找不到。
const memorialCell = (map: number | null, cell: number | null) =>
  map && map > 0 && cell != null ? ` · ${mapCellLetter(map, cell)} 点` : ''

const memorialEquipmentNames = (items: unknown) => {
  if (!Array.isArray(items) || !items.length) return '无装备'
  return (items as ShipLifeEquipment[])
    .map((item) =>
      entityNamePlain(
        'equip',
        item.mstId,
        friendlyEquips.get(item.mstId)?.api_name ?? `装备#${item.mstId || '?'}`,
      ),
    )
    .join('、')
}

const memorialEventCopy = (event: ShipLifeEvent): [string, string] => {
  const detail = event.detail ?? {}
  if (event.kind === 'join') {
    // 出处口径同鉴·列表的人生记录：掉落写图与点位，建造写建造，
    // 认不到就什么都不加（确认不了就不标）。
    const origin =
      detail.origin === 'drop' && event.map != null && event.cell != null
        ? ` · 掉落于 ${mapPlaceText(event.map, event.cell, event.isBoss)}`
        : detail.origin === 'build'
          ? ' · 建造入港'
          : ''
    return ['加入镇守府', `首次记录时 Lv ${detail.level ?? '?'}${origin}`]
  }
  if (event.kind === 'exp') {
    return [
      `获得经验 +${event.expDelta.toLocaleString()}`,
      `Lv ${detail.levelBefore ?? '?'} → ${detail.levelAfter ?? '?'}`,
    ]
  }
  if (event.kind === 'equipment') {
    return [
      '装备变更',
      `${memorialEquipmentNames(detail.before)} → ${memorialEquipmentNames(detail.after)}`,
    ]
  }
  if (event.kind === 'remodel') {
    const before = entityNamePlain(
      'ship',
      detail.beforeMstId ?? 0,
      friendlyShips.get(detail.beforeMstId)?.api_name ?? `#${detail.beforeMstId ?? '?'}`,
    )
    const after = entityNamePlain(
      'ship',
      detail.afterMstId ?? 0,
      friendlyShips.get(detail.afterMstId)?.api_name ?? `#${detail.afterMstId ?? '?'}`,
    )
    const removed = Array.isArray(detail.equipmentBefore) ? detail.equipmentBefore.length : 0
    const equipped = Array.isArray(detail.equipmentAfter) ? detail.equipmentAfter.length : 0
    const equipmentNote =
      removed || equipped
        ? ` · 装备随改造更新 ${removed}→${equipped} 件`
        : ''
    return ['完成改造', `${before} → ${after} · Lv ${detail.level ?? '?'}${equipmentNote}`]
  }
  // 与改造同族的一次性永久变化。等级是婚礼**当刻**那份（通常 Lv99），
  // 取不到就写「?」——不拿婚后的 100 冒充。
  if (event.kind === 'marriage') {
    return ['结为誓约', `ケッコンカッコカリ · 当时 Lv ${detail.level ?? '?'}`]
  }
  // 同族的另一种一次性永久变化：格納庫増設把某一格的搭载上限抬高。
  // 旧上限取不到（第一次扩之前账上没有这一项、又没赶上主数据）就只写新上限，
  // 不写箭头——不拿主数据的原量冒充「原来是几」。
  if (event.kind === 'hangar_expand') {
    const slot = detail.slot ?? '?'
    return [
      '使用格纳库增设',
      detail.before != null
        ? `第 ${slot} 格 · 搭载上限 ${detail.before} → ${detail.after ?? '?'}`
        : `第 ${slot} 格 · 搭载上限现为 ${detail.after ?? '?'}`,
    ]
  }
  if (event.kind === 'sortie') {
    return [
      `出击 ${memorialMap(event.map)}`,
      `${detail.deckId ? `第 ${detail.deckId} 舰队` : '出击舰队'}${detail.combined ? ' · 联合舰队' : ''}`,
    ]
  }
  if (event.kind === 'battle') {
    const rank = event.rank === 'S' && detail.perfect ? 'S（完全胜利）' : (event.rank ?? '?')
    return [
      event.practice
        ? `演习 ${rank}`
        : `${memorialMap(event.map)}${memorialCell(event.map, event.cell)} ${rank}`,
      `${event.isBoss ? 'Boss 战 · ' : ''}${event.mvp ? 'MVP · ' : ''}${detail.fleet === 'escort' ? '护卫舰队' : '主力舰队'}`,
    ]
  }
  if (event.kind === 'scrap') return ['拆解', `Lv ${detail.level ?? '?'} · 转入收容库`]
  if (event.kind === 'material') return ['作为改修素材', `Lv ${detail.level ?? '?'} · 转入收容库`]
  return [
    '击沉',
    `${memorialMap(event.map)}${memorialCell(event.map, event.cell)}${event.isBoss ? ' · Boss 战' : ''}`,
  ]
}

const memorialLifeHtml = (entry: ShipMemorialEntry) => {
  const life = entry.life
  const events = life.events
    .map((event) => {
      const [title, note] = memorialEventCopy(event)
      // 点色按类名走样式表。格納庫増設与改造同族，直接借 remodel 那一档金色，
      // 不为它新造一条 CSS。
      const tone = event.kind === 'hangar_expand' ? 'remodel' : event.kind
      return `<div class="mem-life-event ${tone}">
        <span class="dot"></span><span class="copy"><b>${esc(title)}</b><span>${esc(note)}</span></span>
        <time>${esc(memorialDate(event.ts))}</time>
      </div>`
    })
    .join('')
  const rate = life.winRate == null ? '—' : `${Math.round(life.winRate * 100)}%`
  const practiceRate =
    life.practiceWinRate == null ? '—' : `${Math.round(life.practiceWinRate * 100)}%`
  const hurt = shipLifeDamageText(life)
  return `<div class="mem-life">
    <div class="mem-life-stats">
      <span>经验 <b>+${life.expGained.toLocaleString()}</b></span>
      <span>出击 <b>${life.sorties}</b></span>
      <span>出击胜利 B+ <b>${life.wins}/${life.battles} · ${rate}</b></span>
      <span>演习胜利 B+ <b>${life.practiceWins}/${life.practiceBattles} · ${practiceRate}</b></span>
      <span>MVP <b>${life.mvps}</b></span>
      <span class="hurt${hurt.partial ? ' partial' : ''}" title="${esc(hurt.dealtTitle)}">造成伤害 <b>${hurt.dealt}</b>${
        hurt.partial ? '<i>部分</i>' : ''
      }</span>
      <span class="hurt${hurt.partial ? ' partial' : ''}" title="${esc(hurt.title)}">承受伤害 <b>${hurt.damage}</b>${
        hurt.partial ? '<i>部分</i>' : ''
      }</span>
      <span class="hurt${hurt.partial ? ' partial' : ''}" title="${esc(hurt.title)}">大破 <b>${hurt.taiha}</b></span>
    </div>
    <div class="mem-life-list">${events || '<div class="mem-empty">仅有拆解、素材消耗或击沉记录</div>'}</div>
  </div>`
}

const loadShipMemorial = (chain: number[]) => {
  const key = chain.join(',')
  if (!key || shipMemorialLoading === key) return
  // 手上这份既是这条改造链的、又是最新代 → 不必重取。
  // 注意判据是「代号」而不是「有没有数据」：数据失效时不再被清空，
  // 否则正看着的「收容库」会塌成「正在读取…」再填回来。
  if (shipMemorial?.key === key && shipMemorial.generation === shipMemorialGeneration) return
  const generation = shipMemorialGeneration
  shipMemorialLoading = key
  void queryShipMemorial(chain)
    .then((report) => {
      shipMemorial = { key, report, generation }
    })
    .catch((error: unknown) => {
      // 读失败要说读失败：空报告会被渲染成「暂无拆解、素材消耗或击沉记录」，
      // 那是把故障说成事实（全文件唯一丢掉 error 的 catch，一并补上）
      console.warn('[kanso] 收容库读取失败', key, error)
      shipMemorial = {
        key,
        report: { scrapped: 0, materials: 0, sunk: 0, entries: [] },
        generation,
        failed: true,
      }
    })
    .finally(() => {
      if (shipMemorialLoading === key) shipMemorialLoading = ''
      if (!shipState.open || (chainOf.get(shipState.selectedRoot) ?? []).join(',') !== key) return
      // 只有「收容库」这一块要换。原先为它跑一次全量 render——火焰图里点开一艘舰
      // 有两个长任务，第二个就是它，而抽屉与目录的内容一个字都没变。
      // ⚠ 换块之后必须重绑「查看人生记录」：它是逐元素绑定，不走全局委托。
      // 曾以为块内只有实体链接而跳过重绑——于是每次首开详情，异步换进来的
      // 收容库行点了都没反应（wire 绑的是被换掉的那批占位元素）。
      const host = pane?.querySelector('#ji-ship-memorial')
      if (host) {
        forgetCommittedHtml(pane, 'ji') // 局部换块后记忆作废（见 kernel commitPaneHtml）
        host.outerHTML = shipMemorialHtml(chain)
        const fresh = pane?.querySelector('#ji-ship-memorial')
        if (fresh) bindMemorialToggles(fresh)
      } else {
        render()
      }
    })
}

/** 收容库行的「查看人生记录 / 收起」。wire 与换块两处都要绑，少一处就是死按钮。 */
const bindMemorialToggles = (scope: ParentNode) => {
  scope.querySelectorAll<HTMLElement>('[data-memorial]').forEach((head) => {
    head.addEventListener('click', () => {
      const rosterId = parseInt(head.dataset.memorial!, 10)
      shipState.memorialOpen = shipState.memorialOpen === rosterId ? 0 : rosterId
      render()
    })
  })
}

/**
 * 舰娘详情面板里所有**逐元素**绑定的控件。面板会被局部换块
 * （updateShipDetailPanel：切子页、掉落/加成/立绘路径异步到达），
 * 换块后这些绑定随旧元素一起消失——wire 与每次换块都必须重新走一遍。
 * 面板级委托（wireShipDetailPanel 的 click）挂在存活的 panel 上，不在此列。
 */
const bindShipPanelControls = (scope: ParentNode) => {
  const rootNote = scope.querySelector<HTMLTextAreaElement>('#ji-ship-root-note')
  rootNote?.addEventListener('change', () => {
    setShipRootNote(shipState.selectedRoot, rootNote.value)
  })
  rootNote?.addEventListener('keydown', (e) => {
    // 组合中的按键是给输入法的（敲定候选那一下照样带 isComposing），别当成「填完了」
    if (e.isComposing) return
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) rootNote.blur()
  })
  scope.querySelectorAll<HTMLInputElement>('[data-roster-note]').forEach((input) => {
    input.addEventListener('change', () => {
      setShipRosterNote(parseInt(input.dataset.rosterNote!, 10), input.value)
    })
    input.addEventListener('keydown', (e) => {
      // 同上：敲定候选的回车不是「写完了」，失焦会把词打断在半路
      if (e.isComposing) return
      if (e.key === 'Enter') input.blur()
    })
  })
  // 在籍行的「前往列表 →」（铨已装配，按实例定位）
  scope.querySelectorAll<HTMLElement>('[data-roster-go]').forEach((go) => {
    go.addEventListener('click', (e) => {
      e.stopPropagation()
      locateRosterInList(parseInt(go.dataset.rosterGo!, 10))
    })
  })
  // 掉落读取失败的「重试」长在获取页里，而失败恰恰走 updateShipDetailPanel
  // 的局部换块路径——绑定不收进这里，按钮出生即失绑
  scope.querySelector<HTMLElement>('[data-ship-drops-retry]')?.addEventListener('click', (event) => {
    const mstId = Number((event.currentTarget as HTMLElement).dataset.shipDropsRetry)
    shipDrops = null // 清掉失败标记，下一次渲染会重新发起查询
    loadShipDrops(mstId)
    render()
  })
  bindMemorialToggles(scope)
}

const shipMemorialHtml = (chain: number[]): string => {
  const key = chain.join(',')
  loadShipMemorial(chain)
  if (shipMemorial?.key !== key) {
    return `<div class="sec memorial" id="ji-ship-memorial"><div class="sec-h">收容库<span class="aux">当前未持有舰娘记录读取中</span></div></div>`
  }
  if (shipMemorial.failed) {
    return `<div class="sec memorial" id="ji-ship-memorial">
      <div class="sec-h">收容库<span class="aux">当前未持有舰娘</span></div>
      <div class="mem-empty">归档读取失败</div>
    </div>`
  }
  const report = shipMemorial.report
  const reasonLabel = { scrap: '拆解', material: '作为改修素材', sunk: '击沉' } as const
  const rows = report.entries
    .map((entry) => {
      const form = friendlyShips.get(entry.mstId)
      const name = entityNamePlain('ship', entry.mstId, form?.api_name ?? `#${entry.mstId}`)
      const open = shipState.memorialOpen === entry.rosterId
      const personalNote = shipRosterNote(entry.rosterId)
      return `<div class="mem-entry ${entry.reason}${open ? ' open' : ''}">
        <div class="mem-head" data-memorial="${entry.rosterId}">
          ${shipThumbHtml(entry.mstId, name, { className: 'battle' })}
          <span class="name">${entityNameHtml('ship', entry.mstId, form?.api_name ?? `#${entry.mstId}`, { compact: true })}</span><span class="lv">Lv ${entry.level}</span>
          <span class="reason">${reasonLabel[entry.reason]}</span>
          ${personalNote ? `<span class="mem-note" title="${esc(personalNote)}">备注：${esc(personalNote)}</span>` : ''}
          <time>${esc(memorialDate(entry.departedTs))}</time>
          <span class="toggle">${open ? '收起' : '查看人生记录'}</span>
        </div>
        ${open ? memorialLifeHtml(entry) : ''}
      </div>`
    })
    .join('')
  return `<div class="sec memorial" id="ji-ship-memorial">
    <div class="sec-h">收容库<span class="aux">当前未持有舰娘</span></div>
    <div class="mem-counts">
      <span>拆解 <b>${report.scrapped}</b></span>
      <span>作为改修素材 <b>${report.materials}</b></span>
      <span class="${report.sunk ? 'loss' : ''}">击沉 <b>${report.sunk}</b></span>
    </div>
    ${rows || '<div class="mem-empty">暂无拆解、素材消耗或击沉记录</div>'}
  </div>`
}

/**
 * 图鉴说明文（api_getmes）——舰娘在图鉴里的那段自我介绍。
 *
 * 主数据里 862 个我方形态全都带这个字段，其中 335 个基础形态有正文；
 * 改造形态游戏本来就下发空的 `<br>`（store.ts 正是靠这一点判断改造形态），
 * 所以改造形态回落到本链初始形态的说明文，并标明是哪一形态的。
 *
 * 中文两条路，都取不到就只给日文原文——不自己翻译：
 * ① kcwiki-voice 的「入手/登入时」条目，按 mst id 直取（覆盖 335 中的 190）；
 * ② 日中字幕包按原文反查（buildVoiceTranslationIndex，同一句有多个译文即留空）。
 * 实测两条路合计覆盖 264 / 335（78.8%）。
 *
 * ①的日文转写与主数据常有细微出入（「一番艦」/「１番艦」、「錬度」/「練度」），
 * 那是 kcwiki 的转写习惯，指的是同一句，所以按 mst id 认，不按文本严格相等认。
 */
const getmesOf = (mstId: number): { ja: string; fromForm: number } | null => {
  const own = `${friendlyShips.get(mstId)?.api_getmes ?? ''}`.trim()
  if (own && own !== '<br>') return { ja: own, fromForm: mstId }
  const rootId = rootOf.get(mstId)
  if (!rootId || rootId === mstId) return null
  const root = `${friendlyShips.get(rootId)?.api_getmes ?? ''}`.trim()
  return root && root !== '<br>' ? { ja: root, fromForm: rootId } : null
}

const getmesZh = (formId: number, ja: string): { zh: string } | null => {
  const list = voiceLode?.data?.[`${formId}`]
  if (Array.isArray(list)) {
    // 认 key 后缀而不是 scene 文案：两者在现有数据上等价（各 190 条），
    // 但 scene 是中文串，写进源码会被「玩家文案不用日式生硬词」的护栏扫到
    const intro = list.find(
      (e: any) => typeof e?.key === 'string' && e.key.endsWith('-Intro') && `${e?.zh ?? ''}`.trim(),
    )
    if (intro) return { zh: `${intro.zh}`.trim() }
  }
  const viaSubtitle = [ja, ja.split('<br>').join(''), ja.split('<br>').join(' ')]
    .map((form) => voiceZhByJa.get(normalizeVoiceLine(form)))
    .find(Boolean)
  return viaSubtitle ? { zh: viaSubtitle } : null
}

const getmesHtml = (mstId: number): string => {
  const entry = getmesOf(mstId)
  if (!entry) return ''
  const zh = getmesZh(entry.fromForm, entry.ja)
  const jaText = entry.ja.split('<br>').join('\n')
  const borrowed = entry.fromForm !== mstId
  const fromName = borrowed
    ? entityNamePlain('ship', entry.fromForm, friendlyShips.get(entry.fromForm)?.api_name ?? '')
    : ''
  // 整块默认收成一行：这块在抽屉最上面，而点开一艘舰第一眼该看到的是数据，
  // 不是一段两种语言的自我介绍。收起时用 peek 露出一行正文，
  // 想看全文再展开——展开状态由 withViewStateKept 跨重渲染保住。
  const peek = zh ? zh.zh : jaText.split('\n').join(' ')
  return `<details class="sec getmes">
    <summary>
      <span class="gm-label">图鉴说明</span>
      <span class="gm-peek">${esc(peek)}</span>
    </summary>
    <div class="gm-body">
      ${zh ? `<p class="gm-zh">${esc(zh.zh)}</p>` : ''}
      <p class="gm-ja${zh ? '' : ' bare'}">${esc(jaText)}</p>
      <div class="gm-credit">${
        borrowed ? `${esc(fromName)} 的图鉴说明` : ''
      }${zh ? '' : `${borrowed ? ' · ' : ''}无中文对照`}</div>
    </div>
  </details>`
}

/**
 * 「史实」页。这一页原本只有一句「随互链外部通道接入」的占位——
 * 而 kcwiki 包里的「日文WIKI」「英文WIKI」两个字段一直躺着没人用。
 *
 * 这里不抄外站正文（授权不明），只把链接摆出来，由系统浏览器打开。
 * 舰史本身不入库：kanso 的资料包都没有史实条目，编一段出来就是在造假。
 */
const shipWikiLinksHtml = (mstId: number): string => {
  const entry = kcwikiByMst.get(mstId)
  const rootEntry = entry ?? kcwikiByMst.get(rootOf.get(mstId) ?? 0)
  const links: string[] = []
  const add = (label: string, url: unknown) => {
    let href = `${url ?? ''}`.trim()
    if (!/^https?:\/\//.test(href)) return
    // kcwiki 包里的英文链全是 kancolle.wikia.com——那是退役域名，如今只靠一层
    // 重定向活着（实测 2026-08-08 确实会跳到 kancolle.fandom.com）。
    // 直接写落地域名，少赌一层重定向。日文那条 wikiwiki.jp 的老式 URL 实测仍返回
    // 200 并自行跳到现代地址，保持原样。
    href = href.replace(/^https?:\/\/kancolle\.wikia\.com/, 'https://kancolle.fandom.com')
    links.push(`<a class="wiki-link" href="${esc(href)}" target="_blank" rel="noreferrer">${label} ↗</a>`)
  }
  add('日文 wikiwiki', rootEntry?.日文WIKI)
  add('英文 wiki', rootEntry?.英文WIKI)
  const name = friendlyShips.get(mstId)?.api_name
  const cn = rootEntry?.中文名
  if (cn) add('kcwiki 中文', `https://zh.kcwiki.cn/wiki/${encodeURIComponent(cn)}`)
  else if (name) add('kcwiki 中文', `https://zh.kcwiki.cn/wiki/${encodeURIComponent(name)}`)

  const borrowed = !entry && rootEntry
  return `<div style="line-height:1.9">
    ${links.length
      ? `<div class="wiki-links">${links.join('')}</div>${
          borrowed ? '<div style="font-size:10.5px;color:var(--dim);margin-top:7px">链接指向本改造链的初始形态</div>' : ''
        }`
      : '<div style="font-size:11.5px;color:var(--dim)">当前形态暂无外站条目</div>'}
  </div>`
}

// 舰娘详情的底部分页只替换正文。若为切页重建整个抽屉，会重新触发抽屉的
// 首次进入动画，并在宽度过渡完成后覆盖已恢复的滚动位置。
function shipDetailPanelHtml(enter = false): string {
  const body =
    shipState.dtab === 'p-cg'
      ? cgPanelHtml(shipState.selectedForm)
      : shipState.dtab === 'p-voice'
        ? voicePanelHtml(shipState.selectedForm)
        : shipState.dtab === 'p-bonus'
          ? `${shipFitHtml(shipState.selectedForm)}
             <div class="sec" style="margin-top:14px"><div class="sec-h">这一艘的实测加成<span class="aux">实测 vs 预期</span></div>
             ${bonusPanelHtml(shipState.selectedForm)}</div>`
          : shipState.dtab === 'p-drop'
            ? // 先答「去哪捞」（离线目录），再答「你捞到过哪」（本地遭遇志），
              // 然后是另一条来路：怎么建（社区报告配方）、你自己建出来过几次
              confirmedDropHtml(shipState.selectedForm) +
              (shipDropHtml(shipState.selectedForm) ||
                '<div style="font-size:11.5px;color:var(--dim)">读取遭遇志…</div>') +
              buildRefHtml(shipState.selectedForm) +
              factoryOwnHtml(shipState.selectedForm, 'ship')
            : shipState.dtab === 'p-hist'
              ? shipWikiLinksHtml(shipState.selectedForm)
              : ''
  return `<div class="ship-subview${enter ? ' enter' : ''}">${body}</div>`
}

const shipDrawerHtml = () => {
  // 舰娘位与 NPC 位共用这一格抽屉壳，但里面是两族东西
  if (shipState.chip === NPC_CHIP) return npcDrawerHtml()
  const form = friendlyShips.get(shipState.selectedForm)
  if (!form) return ''
  const root = friendlyShips.get(shipState.selectedRoot)
  const chain = chainOf.get(shipState.selectedRoot) ?? []
  const rawTypeName = mg.master.stypes[form.api_stype] ?? ''
  const typeName = entityNamePlain('shipType', form.api_stype, rawTypeName)
  const instances = chainInstances(shipState.selectedRoot)
  const maxLv = instances.length ? Math.max(...instances.map((s) => s.lv)) : 0

  // 改装链：等级/弹药/钢材沿用舰船资料；特殊材料按
  // 游戏 API → wikiwiki 改造チャート → kcwiki 图纸串三级降级。
  // 升级表索引由 buildIndex 建好复用（每次渲染重建一张全表 Map 是纯重复）
  const upgradeByTarget = shipUpgradeByTarget
  const chainHtml = chain
    .map((mstId, i) => {
      const s = friendlyShips.get(mstId)
      // 同目标多行时选**链上显示的这条来路**：抽屉画的是 chain[i-1] → chain[i]，
      // 素材就得取这一对的行，拿别的来路（回转）会张冠李戴
      const upgradeRows = upgradeByTarget.get(mstId) ?? []
      const upgrade =
        (i > 0 ? upgradeRows.find((row) => Number(row.api_current_ship_id) === chain[i - 1]) : null) ??
        upgradeRows[0]
      const predecessorId = Number(upgrade?.api_current_ship_id) || (i > 0 ? chain[i - 1] : 0)
      const predecessor = friendlyShips.get(predecessorId)
      const level = predecessor?.api_afterlv ?? 1
      const node = `<div class="rm-node${mstId === shipState.selectedForm ? ' on' : ''}" data-form="${mstId}">
        <div class="n">${entityNameHtml('ship', mstId, s.api_name, { compact: true })}</div><div class="l">Lv ${i === 0 ? 1 : level}</div></div>`
      if (i === 0) return node
      const wiki = kcwikiByMst.get(predecessorId)?.改造
      const specialNeeds = needChipsHtml(wiki?.图纸, mstId, predecessorId)
      // 素材原本整排铺在箭头下面，一条链就被撑得没法看（而且「×10」紧挨着库存
      // 「672」会被读成 10672）。这里只留一枚摘要，明细收进悬停的小卡。
      const needList = specialNeeds.needs
      const needPillOf = (list: UpgradeNeedChip[], tipTitle: string, label: string): string => {
        if (!list.length) return ''
        const shortage = list.filter((need) => !needStockOf(need).enough).length
        const tip = list
          .map((need) => {
            const { have, enough } = needStockOf(need)
            return `${need.name} ×${need.count}　（现有 ${have}${enough ? '' : '，还差 ' + (need.count - have)}）`
          })
          .join('\n')
        return `<span class="rm-needs${shortage ? ' short' : ' ok'}" data-tip-title="${esc(
          tipTitle,
        )}" data-tip="${esc(tip)}">${label} ${list.length} 项${shortage ? ` · 缺 ${shortage}` : ' ✓'}</span>`
      }
      // kcsapi 字段名陷阱：api_afterbull=弹药、api_afterfuel=钢材（两张改装画面
      // 实拍交叉核定，见 MasterShip 注释）。此前写反，kcwiki 缺值时弹钢会互换。
      const fwdStats = `弹${
        wiki?.弹药 ?? predecessor?.api_afterbull ?? '?'
      } 钢${wiki?.钢材 ?? predecessor?.api_afterfuel ?? '?'}`
      // 可逆的一对（乙⇔丙、改二⇔戊）**素材检测按方向各自独立**（用户
      // 2026-08-11 指出此前只检向右）：向右＝链前进，向左＝回程，各自一枚
      // 库存药丸标 →/←。回程弹钢/等级取出发形态（本节点）的原生字段；
      // 回程素材只认 wikiwiki 的回程边（总表回程行 tooltip / 舰页脚注）——
      // kcwiki 没写回程，它挂在循环形态上的图纸串不能当回程明细。
      const paired = isFormSwitch(predecessorId, mstId)
      const from = predecessor
        ? entityNamePlain('ship', predecessorId, predecessor.api_name)
        : '前置形态'
      const arrowTitle = `${from} ${paired ? '⇄' : '→'} ${entityNamePlain('ship', mstId, s.api_name)}`
      if (!paired) {
        const needPill = needPillOf(
          needList,
          `改造素材 · ${entityNamePlain('ship', mstId, s.api_name)}`,
          '素材',
        )
        // 与 ⇄ 同一套网格：符号一律压在节点中线上（用户 2026-08-11 定的排布），
        // Lv/弹钢在符号上方、素材药丸在下方
        return `<div class="rm-arrow" title="${esc(arrowTitle)}">
          <div class="req rq-t">Lv ${wiki?.等级 ?? level}<br>${fwdStats}</div>
          <div class="bi-glyph">→</div>
          <div class="req rq-b">${needPill}</div>
        </div>${node}`
      }
      // 空间即方向（用户 2026-08-11 定的排布）：⇄ 居中，上组=前进、下组=回程，
      // 不再画 →/← 小箭头——位置本身说明方向，悬停标题写目的形态名。
      const fwdPill = needPillOf(
        needList,
        `改造素材 · 改往${entityNamePlain('ship', mstId, s.api_name)}`,
        '素材',
      )
      const backNeeds = needChipsHtml(null, predecessorId, mstId).needs
      const backPill = needPillOf(backNeeds, `改造素材 · 改回${from}`, '素材')
      const fwdLine = `Lv ${wiki?.等级 ?? level} ${fwdStats}`
      const backLine = `<span class="back">Lv ${s.api_afterlv ?? '?'} 弹${
        s.api_afterbull ?? '?'
      } 钢${s.api_afterfuel ?? '?'}</span>`
      return `<div class="rm-arrow bi" title="${esc(arrowTitle)}">
        <div class="req rq-t">${[fwdLine, fwdPill].filter(Boolean).join('<br>')}</div>
        <div class="bi-glyph">⇄</div>
        <div class="req rq-b">${[backLine, backPill].filter(Boolean).join('<br>')}</div>
      </div>${node}`
    })
    .join('')

  const wikiEntry = kcwikiByMst.get(shipState.selectedForm)

  // 每个玩家实例单列：相同形态/等级的副舰也可能处于不同舰队、锁定或疲劳状态，
  // 合并后会把第一艘的状态误当成全部实例，并让人生记录跳错对象。
  const roster = [...instances]
    .sort((a, b) => b.lv - a.lv || a.id - b.id)
    .map((entry) => {
      const stageName = friendlyShips.get(entry.shipId)?.api_name ?? `#${entry.shipId}`
      const current = mg.ships[entry.id]
      const chips: string[] = []
      for (const deck of mg.decks) {
        const at = deck.ships.indexOf(entry.id)
        if (at >= 0) chips.push(`<span class="ro-chip fleet">第${deck.id}舰队 · ${at + 1}号位</span>`)
      }
      if (current) {
        if (current.cond >= 50) chips.push(`<span class="ro-chip sp">✦ 士气 ${current.cond}</span>`)
        chips.push(`<span class="ro-chip">${current.locked ? '已锁定 ●' : '<span style="color:var(--warn)">未锁定 ⚠</span>'}</span>`)
      }
      const personalNote = shipRosterNote(entry.id)
      return `<div class="ro-row">
        <span class="ro-stage">${entityNameHtml('ship', entry.shipId, stageName, { compact: true })}</span>
        <span class="ro-lv">Lv ${entry.lv}</span>
        ${chips.join('')}
        <span class="ro-go" data-roster-go="${entry.id}" title="在舰娘列表中定位这一艘">前往列表 →</span>
        <label class="ro-note"><span>这一艘的备注 · ID ${entry.id}</span>
          <input data-roster-note="${entry.id}" maxlength="120" value="${esc(personalNote)}"
            placeholder="例如：对陆、二号机、保留特殊改装……"></label>
      </div>`
    })
    .join('')

  return `
  <div class="d-head">
    <span class="x" id="ji-ship-close" title="关闭（Esc）">✕</span>
    <span class="crumb">${entityNameHtml('shipType', form.api_stype, rawTypeName, { compact: true })} › <b>${root ? entityNameHtml('ship', root.api_id, root.api_name, { compact: true }) : ''}</b></span>
    <span class="sp"></span>
  </div>
  <div class="detail">
    <div class="hero">
      <div class="hero-l">
        <div class="meta-line">
          <span class="badge type">${entityNameHtml('shipType', form.api_stype, rawTypeName, { compact: true })}</span>
          <span class="badge" style="color:${RARITY_COLOR[form.api_backs] ?? 'var(--sub)'}">${RARITY_LABEL[form.api_backs] ?? `☆${form.api_backs}`}</span>
          <span class="no">图鉴 No.${form.api_sortno}</span>
        </div>
        <div class="name-block">
          <div class="yomi">${esc(form.api_yomi ?? '')}</div>
          <h1>${entityNameHtml('ship', form.api_id, form.api_name)}</h1>
          ${(() => {
            // kcwiki 收录则整行 kcwiki;没收(2023 起停收的 89 形态)按实体级回退
            // 用 wikiwiki 舰页档案补——同一行位,悬停能看出来源
            if (wikiEntry) {
              const parts = [
                wikiEntry.声优 ? `CV：${esc(wikiEntry.声优)}` : '',
                wikiEntry.画师 ? `画师：${esc(wikiEntry.画师)}` : '',
                Array.isArray(wikiEntry.级别) ? `${esc(wikiEntry.级别[0])} ${wikiEntry.级别[1]}号舰` : '',
              ].filter(Boolean)
              return parts.length
                ? `<div class="cls" style="font-size:12px;color:var(--sub);margin-top:2px">${parts.join(' · ')}</div>`
                : ''
            }
            const profile = shipProfileByMst.get(shipState.selectedForm)
            if (!profile) return ''
            // 上游在「还没公布」时把 cv/画师填成 `未発表`。那不是人名——原样上屏
            // 等于告诉玩家这艘舰的声优叫「未発表」。翻成中文，事实本身仍旧摆出来。
            const announced = (value: unknown) => `${value ?? ''}`.trim() === '未発表' ? '未公布' : esc(value)
            const parts = [
              profile.cv ? `CV：${announced(profile.cv)}` : '',
              profile.artist ? `画师：${announced(profile.artist)}` : '',
              // 舰级 chip 那条路走了归一，这个补缺分支一直没走——`級` 该作「级」
              Array.isArray(profile.shipClass)
                ? `${esc(normalizeShipClassName(`${profile.shipClass[0]}`))} ${profile.shipClass[1]}号舰`
                : '',
            ].filter(Boolean)
            return parts.length
              ? `<div class="cls" style="font-size:12px;color:var(--sub);margin-top:2px">${parts.join(' · ')}</div>`
              : ''
          })()}
          ${shipHistFleetInlineHtml(shipState.selectedRoot)}
        </div>
        <div class="own-line">
          ${instances.length ? `<span class="own-pill"><span class="dot"></span>持有 <b>×${instances.length}</b></span><span class="own-pill">最高 <b>Lv ${maxLv}</b></span>` : '<span class="own-pill" style="opacity:.6">未持有</span>'}
          <button class="ship-fav${isFavoriteShipRoot(shipState.selectedRoot) ? ' on' : ''}" data-ship-favorite="${shipState.selectedRoot}">
            ${isFavoriteShipRoot(shipState.selectedRoot) ? '★ 已收藏' : '☆ 收藏'}
          </button>
        </div>
      </div>
      ${(() => {
        // 顶部身份卡固定使用横幅；竖向卡面和全身立绘留在“立绘”页展示。
        const hero = shipImageUrl(shipState.selectedForm, 'banner')
        return hero
          ? `<div class="cg-card has"><img src="${esc(hero)}" alt="${esc(entityNamePlain('ship', form.api_id, form.api_name))} 横幅"></div>`
          // 「缓存」一词 2026-08-31 退场：本机已有的字节现在有缓存与立绘档案两处
          // （取图回退链见 kcs-image 的 shipImageUrl），两处都没有才是这一格
          : '<div class="cg-card"><span class="st">本机暂无</span></div>'
      })()}
    </div>
    ${getmesHtml(shipState.selectedForm)}
    <div class="remodel">${chainHtml}</div>
    ${(() => {
      // 属性区：实体级单基准——kcwiki 收录则整块 kcwiki 口径（含隐藏三维），否则整块主数据。
      // 在此之上按强化来源分层：等级成长(→99)/婚后(99→上限)/结婚耐久/改修余量。
      // 三维(回避/对潜/索敌)的 Lv99 上限持有形态时用游戏一手值(api_kaihi 等的 [1])，
      // 成长公式与结婚档位的实测依据见 shared/ship-growth.ts。
      const d = wikiEntry?.数据
      const pairOf = (raw: unknown): [number, number] | null =>
        Array.isArray(raw) && raw.length >= 2 && Number(raw[0]) >= 0 && Number(raw[1]) >= 0
          ? [Number(raw[0]), Number(raw[1])]
          : null // kcwiki 用 -1 标缺数据，照实当缺
      const liveInstance = Object.values(mg.ships).find(
        (ship) => ship.shipId === shipState.selectedForm,
      )
      const liveMaxOf: Record<string, number | null> = liveInstance
        ? { 回避: liveInstance.kaihiMax, 对潜: liveInstance.taisenMax, 索敌: liveInstance.sakutekiMax }
        : { 回避: null, 对潜: null, 索敌: null }
      // 改造强化 = 初始值随形态的变化，在悬停里给「较前形态 ±N」
      const MASTER_PAIR_FIELD: Record<string, string> = {
        耐久: 'api_taik', 火力: 'api_houg', 装甲: 'api_souk',
        雷装: 'api_raig', 对空: 'api_tyku', 运: 'api_luck',
      }
      const prevId = chain[chain.indexOf(shipState.selectedForm) - 1]
      const prevForm = prevId ? friendlyShips.get(prevId) : null
      const initOfForm = (mstId: number, label: string): number | null => {
        const wikiPair = pairOf(kcwikiByMst.get(mstId)?.数据?.[label])
        if (wikiPair) return wikiPair[0]
        const field = MASTER_PAIR_FIELD[label]
        const masterPair = field ? friendlyShips.get(mstId)?.[field] : null
        return Array.isArray(masterPair) ? Number(masterPair[0]) : null
      }
      const remodelDeltaTip = (label: string, init: number | null): string => {
        if (init == null || !prevForm) return ''
        const prevInit = initOfForm(prevId, label)
        if (prevInit == null) return ''
        const diff = init - prevInit
        return `\n改造强化：较${entityNamePlain('ship', prevId, prevForm.api_name)}初始 ${diff >= 0 ? '+' : ''}${diff}`
      }
      const modRow = (label: string, pair: [number, number] | null): string => {
        if (!pair) return ''
        return statRowLayered(
          label,
          pair[0],
          [{ value: pair[1] > pair[0] ? pair[1] : null, kind: 'mod' }],
          `近代化改修上限 ${pair[1]}${remodelDeltaTip(label, pair[0])}`,
        )
      }
      const hpRow = (pair: [number, number] | null): string => {
        if (!pair) return ''
        const bonus = marriageHpBonus(pair[0])
        const married = marriedMaxHp(pair[0], pair[1])
        return statRowLayered(
          '耐久',
          pair[0],
          [
            { value: married != null && married > pair[0] ? married : null, kind: 'marriage' },
            { value: pair[1] > (married ?? pair[0]) ? pair[1] : null, kind: 'mod' },
          ],
          `结婚 +${bonus ?? '?'} → ${married ?? '?'}\n改修上限 ${pair[1]}${remodelDeltaTip('耐久', pair[0])}`,
        )
      }
      // 上限与初始值 2026-08-22 起统一走第一方 `ship-stats` 汇编包（随包，发布版也有；
      // 原先直读 wikiwiki-ship-max，那个包无许可不随包，发布版这一格只能显示占位）。
      // 包内已按「账本一手 > 两 wiki 一致 > 分歧裁决 > 单票」四档定过值，
      // 持有形态再传一次游戏一手的 Lv99 上限，`growthEndpoints` 里一手照旧压过包。
      const GROWTH_KEY_OF: Record<string, ShipGrowthKey> = {
        回避: 'evasion',
        对潜: 'asw',
        索敌: 'los',
      }
      const growthRow = (label: string): string => {
        const growthKey = GROWTH_KEY_OF[label]
        const endpoints = shipGrowthEndpointsOf(
          shipState.selectedForm,
          growthKey,
          liveMaxOf[label],
        )
        const base = endpoints.init
        const max99 = endpoints.max
        if (base == null && max99 == null) return ''
        const vCap =
          base != null && max99 != null ? levelGrowth(base, max99, MARRIED_LEVEL_CAP) : null
        return statRowLayered(
          label,
          base,
          [
            { value: max99 != null && (base == null || max99 > base) ? max99 : null, kind: 'grow' },
            { value: vCap != null && vCap > (max99 ?? 0) ? vCap : null, kind: 'over99' },
          ],
          `估算 · 初始与上限之间按等级插值${
            base == null ? '\n初始值暂缺社区资料' : ''
          }${remodelDeltaTip(label, base)}`,
        )
      }
      const growthRows = ['回避', '对潜', '索敌'].map(growthRow)
      const growthGapNote = growthRows.every((row) => !row)
        ? '<div class="gap-note">回避 / 对潜 / 索敌暂无数据</div>'
        : ''
      if (d) {
        const rows = [
          hpRow(pairOf(d.耐久)), modRow('火力', pairOf(d.火力)), modRow('装甲', pairOf(d.装甲)),
          modRow('雷装', pairOf(d.雷装)), modRow('对空', pairOf(d.对空)),
          growthRows[0], growthRows[1], growthRows[2], modRow('运', pairOf(d.运)),
        ].join('')
        const consume = wikiEntry.消耗 ?? {}
        const broken = wikiEntry.解体
        return `<div class="sec">
          <div class="sec-h">属性</div>
          ${STAT_LEGEND_HTML}
          <div class="stat-grid">${rows}</div>
          ${growthGapNote}
          <div class="misc-line" style="margin-top:9px">
            <span>航速 <b>${d.速力 >= 10 ? '高速' : d.速力 >= 5 ? '低速' : '—'}</b></span>
            <span>射程 <b>${LENG_LABEL[d.射程] ?? '—'}</b></span>
            <span>槽数 <b>${wikiEntry.装备?.格数 ?? form.api_slot_num}</b></span>
            <span>${entityTermHtml('material', 0, '燃料')} <b>${consume.燃料 ?? form.api_fuel_max}</b></span>
            <span>${entityTermHtml('material', 1, '弹药')} <b>${consume.弹药 ?? form.api_bull_max}</b></span>
            ${form.api_buildtime > 0 ? `<span>建造时间 <b>${form.api_buildtime}分</b></span>` : ''}
            ${Array.isArray(form.api_powup) ? `<span>素材强化 <b>火${form.api_powup[0] ?? 0} 雷${form.api_powup[1] ?? 0} 空${form.api_powup[2] ?? 0} 甲${form.api_powup[3] ?? 0}</b></span>` : ''}
             ${broken ? `<span>拆解可得 <b>${[broken.燃料, broken.弹药, broken.钢材, broken.铝].join('/')}</b></span>` : ''}
          </div>
        </div>
        ${(() => {
          const slots = wikiEntry.装备?.初期装备
          const load = wikiEntry.装备?.搭载 ?? []
          if (!Array.isArray(slots)) return ''
          // 这一页按**形态**展示，而格納庫増設的上限是**实例**级的（记在舰娘自己的
          // onslotMax 上）。所以只在「你自己有一艘这个形态、且那一格扩过」时才补小字，
          // 并把是哪一艘写进悬停——不把它说成这个形态的属性，也不外推到同形态的
          // 其他实例。这与本页三维上限「持有形态取游戏一手」同一路子。
          //
          // 悬停写「搭载上限 2+1（格納庫増設）」，加法的两截都取 owned（主数据 maxEq
          // 减出来的那一对）：页面上那个原量来自 wiki 的初期搭载表，两张表逐格未必
          // 相等，混着加会凑出一个谁都没有的上限。
          const hangarMarks: string[] = slots.map((_: unknown, i: number) => {
            if (load[i] == null) return '' // 没有原量就没有「原量 + 增量」，不给孤零零的 +N
            const owned = ownedHangarExpansionOf(shipState.selectedForm, i)
            if (!owned) return ''
            return `<i class="hx" title="${esc(
              `舰娘 ID ${owned.rosterId}：搭载上限 ${owned.base}+${owned.extra}（格纳库增设）`,
            )}">+${owned.extra}</i>`
          })
          const rows = slots
            .map((id: number, i: number) => {
              if (id === -1)
                return `<div class="slot"><span class="ico empty">－</span><span class="nm" style="color:var(--dim)">空槽${load[i] != null ? `<i>搭载 ${load[i]}</i>${hangarMarks[i]}` : ''}</span></div>`
              const eq = friendlyEquips.get(id)
              if (!eq) return ''
              return `<div class="slot">${equipTypeIconHtml(Array.isArray(eq.api_type) ? eq.api_type[3] : 0, { className: 'sm', title: entityNamePlain('equip', eq.api_id, eq.api_name) })}
                <span class="nm">${elink('mstEquip', id, eq.api_name)}<i>初始装备${load[i] != null ? ` · 搭载 ${load[i]}` : ''}</i>${hangarMarks[i]}</span></div>`
            })
            .join('')
          return `<div class="sec"><div class="sec-h">装备槽<span class="aux">${slots.length} 槽 · 初始装备${
            hangarMarks.some(Boolean) ? ' · 含格納庫増設' : ''
          }</span></div>
            <div class="slots">${rows}</div></div>`
        })()}`
      }
      return `<div class="sec">
        <div class="sec-h">属性</div>
        ${STAT_LEGEND_HTML}
        <div class="stat-grid">
          ${hpRow(pairOf(form.api_taik))}
          ${modRow('火力', pairOf(form.api_houg))}
          ${modRow('装甲', pairOf(form.api_souk))}
          ${modRow('雷装', pairOf(form.api_raig))}
          ${modRow('对空', pairOf(form.api_tyku))}
          ${growthRows.join('')}
          ${modRow('运', pairOf(form.api_luck))}
        </div>
        <div class="misc-line" style="margin-top:9px">
          <span>航速 <b>${form.api_soku >= 10 ? '高速' : form.api_soku >= 5 ? '低速' : '—'}</b></span>
          <span>射程 <b>${LENG_LABEL[form.api_leng] ?? '—'}</b></span>
          <span>槽数 <b>${form.api_slot_num}</b></span>
          <span>${entityTermHtml('material', 0, '燃料')} <b>${form.api_fuel_max}</b></span>
          <span>${entityTermHtml('material', 1, '弹药')} <b>${form.api_bull_max}</b></span>
          ${form.api_buildtime > 0 ? `<span>建造时间 <b>${form.api_buildtime}分</b></span>` : ''}
          ${Array.isArray(form.api_powup) ? `<span>素材强化 <b>火${form.api_powup[0] ?? 0} 雷${form.api_powup[1] ?? 0} 空${form.api_powup[2] ?? 0} 甲${form.api_powup[3] ?? 0}</b></span>` : ''}
          ${Array.isArray(form.api_broken) ? `<span>拆解可得 <b>${form.api_broken.join('/')}</b></span>` : ''}
        </div>
        ${(() => {
          // kcwiki 没收这一形态时,初期装备按实体级回退取 wikiwiki 舰页档案
          const profileSlots = shipProfileByMst.get(shipState.selectedForm)?.initialEquips
          if (!Array.isArray(profileSlots)) {
            return growthGapNote || '<div class="gap-note" title="属性来源：游戏基础数据及本地同步值">社区资料未收录这一形态</div>'
          }
          const slotRows = profileSlots
            .map((id: number) => {
              if (id === -1)
                return `<div class="slot"><span class="ico empty">－</span><span class="nm" style="color:var(--dim)">空槽</span></div>`
              const eq = friendlyEquips.get(id)
              if (!eq) return ''
              return `<div class="slot">${equipTypeIconHtml(Array.isArray(eq.api_type) ? eq.api_type[3] : 0, { className: 'sm', title: entityNamePlain('equip', eq.api_id, eq.api_name) })}
                <span class="nm">${elink('mstEquip', id, eq.api_name)}<i>初始装备</i></span></div>`
            })
            .join('')
          return `${growthGapNote}</div><div class="sec"><div class="sec-h">装备槽<span class="aux">${profileSlots.length} 槽 · 初始装备</span></div>
            <div class="slots">${slotRows}</div>`
        })()}
      </div>`
    })()}
    ${equipMatrixHtml(shipState.selectedForm)}
    ${shipHistFleetSectionHtml(shipState.selectedRoot)}
    <div class="sec personal-note">
      <div class="sec-h">个人备注<span class="aux">同一改装链共用</span></div>
      <textarea id="ji-ship-root-note" maxlength="400" placeholder="输入个人备注……">${esc(shipRootNote(shipState.selectedRoot))}</textarea>
    </div>
    <div class="sec">
      <div class="sec-h">当前持有<span class="aux">按改装链汇总</span></div>
      ${roster || '<div style="font-size:11px;color:var(--dim)">尚未持有这艘舰娘及其其他改装形态</div>'}
    </div>
    ${shipMemorialHtml(chain)}
    ${relatedQuestsHtml(
      chain.flatMap((id) => {
        const s = friendlyShips.get(id)
        const wiki = kcwikiByMst.get(id)
        return [s?.api_name, wiki?.中文名].filter(Boolean)
      }),
      'ship',
    )}
    <div class="tabs" id="ji-ship-tabs">
      ${['p-voice:台词', 'p-cg:立绘', 'p-drop:获取', 'p-bonus:装备加成', 'p-hist:史实']
        .map((t) => {
          const [id, label] = t.split(':')
          return `<div class="tab${shipState.dtab === id ? ' on' : ''}" data-p="${id}">${label}</div>`
        })
        .join('')}
    </div>
    <div class="panel on" id="ji-ship-panel">${shipDetailPanelHtml()}</div>
    ${shipSourceFootHtml(!!wikiEntry)}
  </div>`
}

/**
 * 来源与新鲜度并到一处，默认收起。
 *
 * 原本每一段各带一行署名——光「改造需求优先级：游戏 API → … → …」就有 65px，
 * 正卡在改造链和属性之间，比整个图鉴说明块还占地方，而且每艘舰写的都一样：
 * 那是**口径声明**，不是这艘舰的数据。
 *
 * 2026-08-20 第二批文案清扫后，各小节抬头的 aux 署名也撤了（统一声明在钥的矿脉面板）——
 * 这里成了本页唯一的出处落点，仍然默认收起：想核对点开就有，不点就不占地方。
 */
const shipSourceFootHtml = (usesKcwiki: boolean): string => {
  const rows: string[] = [
    `<div>数值 · 立绘 · 装备矩阵 · 游戏基础数据 · 更新于 ${
      masterTs ? fmtDateTime(masterTs) : '—'
    }</div>`,
    `<div>改造需求 · 游戏基础数据优先${
      wikiwikiRemodelLode ? ` → ${esc(lodeCreditShort(wikiwikiRemodelLode.meta))}` : ' → 改造资料包待补'
    }${kcwikiLode ? ` → 补充来源 ${esc(lodeCreditShort(kcwikiLode.meta))}` : ''}</div>`,
    usesKcwiki && kcwikiLode
      ? `<div>属性（含回避/对潜/索敌）· 初始装备 · ${esc(lodeCreditShort(kcwikiLode.meta))}</div>`
      : '<div>属性 · 游戏基础数据</div>',
    `<div>三维初始值与 Lv99 上限 · 持有形态取游戏一手${
      shipStatsLode ? ` → ${esc(lodeCreditShort(shipStatsLode.meta))}` : ' → 成长端点包待补'
    }</div>`,
  ]
  return `<details class="foot src-foot">
    <summary>资料来源与新鲜度</summary>
    <div class="src-rows">${rows.join('')}</div>
  </details>`
}

// 台词页（01 稿）：日文原文 + 中文翻译对照。
// 数据是 {舰mstId: {语音编号: 文本}}，**语音编号→场景名没有权威映射表**——
// poi-plugin-subtitle 自己也只做「语音文件→文本」，编号是不带语义的标识。
// 所以这里如实标编号，不猜「母港/出击」之类的场景名。
// 台词页（01 稿）。两个源、实体级回退（不做字段级混拼）：
//   首选 kcwiki——每条自带「场合」场景名，但实测只覆盖 309 形态/11036 条；
//   兜底 poi-plugin-subtitle——762 舰/29185 条更全，但编号不带语义。
// 因为首选源并不比兜底源全面，所以不整体替换，而是**整条**按形态择一，
// 并在页脚标明这一条来自哪个源。
// kcwiki 的台词 key 是档名（`106-Sec1` 这种），不是语音编号，算不出文件名。
//
// ---- 两条路，档名优先（2026-08-22 改；此前只有文本这一条）----
// ① **档名里的场景 token 就是槽位**：`Sec1`→2、`Intro`→1、`0100`→31……
//    那张对照表是逐条实证出来的（见 shared/voice-scene-slots 文件头），
//    有现成的可靠信息却去猜文本，等于把它扔了。
// ② 文本匹配降为兜底：靠**日文原文**回连 poi-subtitle 的编号——同源同一句话，
//    这个 join 本身很稳（实测 11036 行命中 8503 / 77.0%），但短句、通用句、
//    标点变体必然连不上。用户实机报出的国後「秘书舰1」行没有播放钮就是这一类
//    （原文「なに? 呼んだ? ふ〜」），而它的档名里明明白白写着 Sec1。
// 两条都落空才不给播放钮——**不瞎猜编号**。
const voiceIdByJa = (mstId: number, ja: string): number | null => {
  if (!ja) return null
  const table: Record<string, string> | undefined = subtitleJa?.data?.[`${mstId}`]
  if (!table) return null
  const norm = (t: string) => t.replace(/\s/g, '')
  const want = norm(ja)
  for (const [vid, text] of Object.entries(table)) {
    if (norm(String(text)) === want) return parseInt(vid, 10)
  }
  return null
}

/**
 * 校正档带来的三件事：给不给键、键指哪个槽位、这一格为什么没钮。
 *
 * `reanchored` 与 `audio-text` 的槽位是**从该舰音轨里量出来的**（前者按文本回连，
 * 后者文本本身就取自那一格），所以直接当 confirmed 用，不必再走一次表推。
 * `season-slot` 与 `no-subtitle` 一律不给键，但**理由不同**，悬停要分开说：
 * 前者是「这一格当季被季节语音占着」，后者是「这一格的音轨文本无从考证」。
 */
const voiceFixNote = (fix: CorrectedVoiceRow['fix']): string => {
  if (fix === 'season-slot') {
    return '当前槽位为季节版 · 常驻台词暂不可用'
  }
  if (fix === 'no-subtitle') {
    return '当前槽位音轨文本未确认'
  }
  return ''
}

/**
 * 台账确证「此刻挂在这个槽位上的是哪一条季节台词」时，把那一条找出来。
 * 找不到就返回 null——**只认证据，不按日期猜当季**。
 */
const mountedSeasonalLine = (
  mstId: number,
  slot: number | null,
): { line: SeasonalVoiceLine; title: string } | null => {
  const observed = voicePlaybackObservationAt(mstId, slot)
  if (!observed?.mountedSeasonalKey) return null
  const lines: SeasonalVoiceLine[] | undefined = seasonalVoiceLode?.data?.ships?.[`${mstId}`]
  const line = lines?.find((entry) => entry.key === observed.mountedSeasonalKey)
  if (!line) return null
  const seasons: Record<string, SeasonalSeason> | undefined = seasonalVoiceLode?.data?.seasons
  return { line, title: seasons?.[line.season]?.title ?? line.season }
}

/**
 * 有耳测**负例**的那一格，为什么没有播放钮。
 *
 * 只在台账里真有条目时才调用——**没有判例的格不再挂「大概不准」那类通用话**。
 * 2026-08-22 到 08-23 之间那一版把「整份字幕缺席」整族都挂上了这句话，
 * 那是砍偏了的那一刀留下的（理由见 shared/voice-playback-observations 文件头）。
 */
const voiceObservedOffNote = (playbackMstId: number, slot: number | null): string => {
  const observed = voicePlaybackObservationAt(playbackMstId, slot)
  if (!observed) return ''
  // 已经查出那一格此刻装的是哪一条季节台词——那就**指路**，别只说「播的是另一句」。
  // 那句台词的文本与译文本来就在下面的季节栏里躺着，说清楚玩家自己就找得到。
  //
  // 措辞按玩家自己的语感来（2026-08-23 他的说法）：不是「这一格坏了」，
  // 是「**这句平时的语音当季被季节版顶替了，过季会回来**」——同样准确，读着也不慌。
  const mounted = mountedSeasonalLine(playbackMstId, slot)
  if (mounted) {
    return `当前槽位为季节版（${mounted.title}）· 对应台词见下方「季节限定台词」`
  }
  // 其余有判例的格说得具体些：这不是「大概不准」，是**已经确认过会错**
  return `${observed.observedAt} 本地实测：当前槽位播放另一台词（${observed.heard.slice(0, 24)}…）`
}

/**
 * 一格的播放地址，**全域一条判据**（2026-08-23 立；不分 key-confirmed / wikiwiki-mapped）。
 *
 *   ① 这一格有耳测**负例** → 一个键都不给；
 *   ② 档案里有这一格的实物 → **播实物**；
 *   ③ 否则按地址现取。
 *
 * ---- ② 为什么排在 ③ 前面 ----
 * 档案里那一份是**玩家自己在游戏里听到过的**（`renderer/voice-archive` 收的）。
 * 播它天然不会错句：既不受官方当季换文件影响，也不受「场合→槽位」映射错位影响，
 * 因为它就是那个地址上真实响过的字节。地址现取则是「此刻那里放的是什么就播什么」——
 * 大多数时候对，季节期与个别错位形态上会不对。
 *
 * ---- 为什么不再按「族」区别对待 ----
 * 上一版把「整份字幕缺席」的形态整族撤键，用的理由是季节占槽。但**季节占槽是时间性的、
 * 对全站所有地址键一视同仁**——key-confirmed 的键当季照样会播出季节音。
 * 按族歧视既没治住那个风险，又把一整层做对了的东西关掉了。所以治理挪到这里，对谁都一样。
 */
const voicePlaybackFor = (
  playbackMstId: number,
  slot: number | null,
): { url: string; fromArchive: boolean; pathname: string | null } | null => {
  if (slot == null || !isPlayableVoiceId(slot)) return null
  if (voicePlaybackObservationAt(playbackMstId, slot)) return null
  const kept = archivedVoiceUrl(playbackMstId, slot)
  // 档案里那一份已经是档案了，不必再入一次档，所以不带 pathname
  if (kept) return { url: kept, fromArchive: true, pathname: null }
  const live = voiceUrl(playbackMstId, slot)
  return live ? { url: live, fromArchive: false, pathname: voicePathname(playbackMstId, slot) } : null
}

/**
 * 这一格没有钮，是因为**钥里把「未缓存的立绘/语音从游戏资源服务器取」关掉了**。
 *
 * 那个开关立绘与语音同管（`kanso.remoteArt`）。关掉之后，没进过缓存也没进过档案的
 * 那些格子就取不到地址——这与「我们主动拒绝播」不是一回事，得分开说，
 * 否则玩家会以为是资料的问题。档案里有实物的格照旧能播（档案零网络）。
 */
const voiceRemoteOffNote = (playbackMstId: number, slot: number | null): string => {
  if (slot == null || voiceState().enabled) return ''
  if (!voicePathname(playbackMstId, slot)) return ''
  return '试听：在设置中开启「未缓存的立绘/语音从游戏资源服务器取」'
}

const voiceRow = (
  textMstId: number,
  playbackMstId: number,
  k: string,
  scene: string,
  ja: string,
  zh: string,
  correction?: { fix: CorrectedVoiceRow['fix']; slot?: number; textSource?: 'kcwiki' | 'subtitle' },
) => {
  // 编号来源按可靠度排：
  //   ① poi-subtitle 那条路，key 本身就是编号；
  //   ② kcwiki 那条路，**档名里的场景 token**（实证对照表，见 shared/voice-scene-slots）
  //      ——但补键前先逐行交叉校验，与该舰字幕表对不上就判分歧、不给键；
  //   ③ 都落空时才靠日文原文回连——短句/通用句/标点变体连不上是常态。
  //
  // ⚠️ 校验与回连都用 **playbackMstId**（真要播的那艘），不是文本来源那艘。
  // 文本可以沿改装链从前置形态借，音轨却永远按当前形态拼；拿来源舰去校验会
  // 把「其实播得对」的行误判成分歧，也会放过真正会播错的行。
  // （原实现的 `voiceIdByJa(textMstId, …)` 就是这个同族毛病。）
  const playbackTable: Record<string, string> | undefined =
    subtitleJa?.data?.[`${playbackMstId}`]
  const fix = correction?.fix ?? 'ok'
  const resolved =
    correction?.slot != null
      ? { slot: correction.slot, basis: 'key-confirmed' as const }
      : fix === 'season-slot' || fix === 'no-subtitle'
        ? { slot: null, basis: 'divergent' as const }
        : /^\d+$/.test(k)
          ? { slot: parseInt(k, 10), basis: 'key-confirmed' as const }
          : resolveVoiceSlot(k, ja, playbackTable ?? null)
  // **`key-only` 照旧给键**。2026-08-22 那一版把「整份字幕缺席」的形态整族撤键，
  // 2026-08-23 复核证据轴后确认那一刀砍偏了（两条耳测判例都不指向这一族，
  // 详见 shared/voice-playback-observations 文件头），已恢复。
  // 「无从校验」不等于「已经错」——真错过的那几格由耳测台账逐格挡住，见 voicePlaybackFor。
  const vid = resolved.slot ?? (resolved.basis === 'divergent' ? null : voiceIdByJa(playbackMstId, ja))
  const play = voicePlaybackFor(playbackMstId, vid)
  // 查台账用的槽位与授键用的**不是同一个**：判分歧的行 `vid` 已经是 null 了，
  // 可「这一行本来要播哪一格」仍旧知道（档名里就写着）。台账要按那一格查，
  // 否则恰恰是最该说清楚的那几格（判过分歧、又有耳测判例）一个字都说不出来。
  const noteSlot = vid ?? (/^\d+$/.test(k) ? parseInt(k, 10) : voiceSlotOfKey(k))
  // 分歧那一档要**说清为什么没钮**，否则玩家只会觉得「又是个坏掉的按钮」。
  // 缺格不写抱怨文案，但这一格不是缺——是我们主动拒绝播一句对不上的音。
  //
  // ⚠️ **耳测判例排在推断之前**（2026-08-23 调序）：`voiceFixNote` 说的是从包与包之间
  // 推出来的病因（双源取证也仍旧是推断），而台账那一条是**玩家真的点下去听到了什么**。
  // 两者对同一格给出不同说法时，实测的那句更该出现在玩家眼前——这与仲裁优先级
  //（日文原文 > 实测 > 三方两票 > 推断）同向。国後 518/2 正是这样一格：
  // 包的分拣判它 season-slot，而台账记着那天听到的是一段长台词。
  const offNote =
    voiceObservedOffNote(playbackMstId, noteSlot) ||
    voiceFixNote(fix) ||
    (resolved.basis === 'divergent'
      ? '与游戏当前音轨对不上'
      : voiceRemoteOffNote(playbackMstId, noteSlot))
  return voiceRowWithUrl(
    k,
    scene,
    ja,
    zh,
    play?.url ?? null,
    offNote,
    correction?.textSource,
    play?.pathname,
  )
}

const voiceRowWithUrl = (
  k: string,
  scene: string,
  ja: string,
  zh: string,
  url: string | null,
  offNote = '',
  /** 这一行的文本来自哪一层。只在**不是**默认那一层时标角标，免得整页都是角标 */
  textSource?: 'kcwiki' | 'subtitle' | 'kanso',
  /**
   * 这一格的音轨路径（档案里的身份）。地址现取时才有——播成功之后拿它入档，
   * 「播过的」从此点亮并升档（见 kcs-voice 的 noteVoicePlayed）。
   */
  playPath?: string | null,
) => {
  const badge =
    textSource === 'subtitle'
      ? '<span class="vo-src" title="台词资料与游戏音轨不一致 · 按音轨内容显示">音轨</span>'
      : textSource === 'kanso'
        ? '<span class="vo-src kanso" title="中文译文来源：kuma 自译">自译</span>'
        : ''
  // 中文这一列**逐行过一道标点体例归一**（行尾不写句号、`……。` 是病句）。
  // 放在这里是因为台词卷是多层混排的：同一页上可能一半行来自舰娘百科、一半是艦素自译，
  // 还有几行来自 poi-plugin-subtitle——自译行没有行尾句号、隔壁行拖着一个，
  // 读起来就是两拨人写的。判据与理由见 shared/voice-text.ts。
  // 日文那一列**不动**：它是原文转写，不是我们的翻译，日语的句读也不归这条规矩管。
  const zhText = normalizeVoiceText(zh)
  return `<div class="vo-row">
    <span class="vo-k">${esc(scene || `#${k}`)}</span>
    <div class="vo-tx">
      ${ja ? `<div class="vo-ja">${esc(ja)}</div>` : ''}
      ${zhText ? `<div class="vo-zh">${esc(zhText)}</div>` : ''}
    </div>
    ${badge}
    ${
      url
        ? `<span class="vo-play" data-voice="${esc(url)}"${
            playPath ? ` data-voice-path="${esc(playPath)}"` : ''
          } title="播放">▶</span>`
        : `<span class="vo-play off"${offNote ? ` title="${esc(offNote)}"` : ''}></span>`
    }
  </div>`
}

const abyssVoiceRow = (k: string, scene: string, ja: string, zh: string) =>
  voiceRowWithUrl(k, scene, ja, zh, extraVoiceUrl('enemy', k))

// ---- 亲历台账：玩家自己遇到过的深海开幕语音 ----
//
// 深海只有 `subtitle-enemies` 那一支的 key 是完整官方档名，能直接拼地址；
// 别的源给的是 wiki 资源键，家法是**不显示无法验证的播放按钮**（那一段的注释）。
// 于是米駆逐棲姫（2204）这类只被 wikiwiki 收录的形态，开幕台词摆得出来、钮没有。
//
// 缺的那块官方其实给过：Boss 开幕时战斗报文的 `api_flavor_info` 同时带着
// `api_boss_ship_id` 与 `api_voice_id`，而 `api_voice_id` **就是** kc9998 的档名
//（实测 605229710 ↔ boss 2297）。主进程把玩家亲历过的这些记进台账
//（`shared/abyss-voice-sighting`），这里读回来——**记过的才给钮，没记过的不猜**，
// 与「你的实测」「档案点亮」同一家族。家法一个字没改：钮仍然只给得出可验证地址的行。
let abyssVoiceSightings: AbyssVoiceSighting[] = []
let abyssVoiceSightingsLoading = false
const ensureAbyssVoiceSightings = () => {
  if (abyssVoiceSightingsLoading) return
  abyssVoiceSightingsLoading = true
  void jiIpc
    .invoke('mg:abyss-voice-sightings')
    .then((rows: AbyssVoiceSighting[] | null) => {
      abyssVoiceSightings = Array.isArray(rows) ? rows : []
      scheduleRender()
    })
    .catch((error: unknown) => {
      console.warn('[kanso] 深海语音亲历台账读取失败', error)
    })
}

/** 刚往台账里收了一条：把那道「只拉一次」的闩打开，重新读一份回来。 */
const reloadAbyssVoiceSightings = () => {
  abyssVoiceSightingsLoading = false
  ensureAbyssVoiceSightings()
}

/**
 * 这一行（wiki 资料给的场合）玩家亲历过吗？亲历过就返回官方档名。
 *
 * 按**場合族**对：wiki 行带的 `suffix`（10 = 開幕前）与台账里档名末尾的行号
 * 首位是同一套编号（判据同源，见 shared/abyss-voice-file 的「行号 → 场合名」）。
 */
const abyssHeardSighting = (mstId: number, suffix: unknown): AbyssVoiceSighting | null =>
  abyssVoiceSightingFor(abyssVoiceSightings, mstId, abyssVoiceSceneFamily(suffix as string))

const abyssHeardVoiceId = (mstId: number, suffix: unknown): string | null =>
  abyssHeardSighting(mstId, suffix)?.voiceId ?? null

// ---- 按推测档名试听：往期 boss 的语音考古（KANSO_DEBUG_UI=1 才存在）----
//
// ---- 补的是哪个洞 ----
// 上面那条亲历台账只覆盖得到「玩家自己打过」的 boss。**往期活动的 boss 没有亲历机会**，
// 而随包 subtitle-enemies（2023 弃更）又漏掉一大片：实测 wiki 收了台词的 646 个深海形态里，
// 580 个在随包里一条官方档名都没有（米駆逐棲姫 2204 就是用户实机报的那一格）。
// 那些形态「台词摆得出来、钮没有」，而音轨其实还挂在游戏自己的资源服务器上。
//
// ---- 为什么是候选列表，不是一个推测值 ----
// 档名 = 前缀 + 形态号 + 行号。形态号与行号是实证过的结构，**前缀钉不死**：
// 它是随版本递增的序号，最近邻只猜得中 57%（考证与留一验证见 shared/abyss-voice-guess
// 头注，别再重猜一遍）。所以这里不假装算得出来——给一串**按可能性排序**的候选，
// 提督逐个点、拿耳朵判，全都不响时旁边留手输前缀的口子。
//
// ---- 三条纪律 ----
// ① **一次一条人肉点**：绝不自动扫号。整段没有任何循环调用播放，
//    与语音探测那一族同一条家法（护栏在 egress-inventory 盯着批量形状）。
// ② **不新开出口**：地址仍走 `extraVoiceUrl('enemy', …)`——档案实物优先，
//    其次受钥里那个开关管的现取。这里一个 https 都不拼。
// ③ **归属由档名结构自证**：候选一律先反解回本形态才摆出来（`parseAbyssVoiceFile`）。
//    提督的耳朵只判「响没响、像不像那句台词」，不负责认领归属——
//    这一族的错法是把 A 的声音记到 B 名下，而界面上它和对的长得一模一样。
const DEBUG_UI = process.env.KANSO_DEBUG_UI === '1'

/** 展开中的那一行（`mstId/行号`）。**一次只展开一条**——一次一条人肉点。 */
let abyssGuessOpen = ''
/** 候选档名 → 这一次点下去的结果。重渲后还在（不然点一下就忘了刚才试到哪）。 */
const abyssGuessOutcomes = new Map<string, 'played' | 'missing'>()
/** 手输的前缀，按行记。 */
const abyssGuessPrefixes = new Map<string, string>()

/**
 * 形态 → 前缀 的样本索引。**三批已知档名都喂进去**：随包那 309 条、玩家亲历台账、
 * 以及档案里躺着的实物（耳测收录过的那些从这两条路回流，于是越用越准）。
 * 索引在样本变过之后才重算，不在逐行渲染路径上扫全表。
 */
let abyssPrefixIndex = new Map<number, number>()
let abyssPrefixStamp = ''
const abyssPrefixIndexOf = (): ReadonlyMap<number, number> => {
  const stamp = `${subtitleEnemiesLode ? 1 : 0}|${abyssVoiceSightings.length}|${abyssalShips.size}|${voiceArchiveGeneration()}`
  if (stamp === abyssPrefixStamp) return abyssPrefixIndex
  abyssPrefixIndex = abyssalShips.size
    ? buildAbyssPrefixIndex(
        [
          ...Object.keys(subtitleEnemiesLode?.data ?? {}),
          ...abyssVoiceSightings.map((entry) => entry.voiceId),
          ...archivedExtraVoiceFiles(EXTRA_VOICE_DIRS.enemy),
        ],
        isAbyssMst,
      )
    : new Map()
  abyssPrefixStamp = stamp
  return abyssPrefixIndex
}

/**
 * 这个形态**已经确认过的**档名。用来定形态号那一段的写法——
 * 同一形态从不混用写法（实测 56 个形态零例外），所以确认过一条之后，
 * 这个形态其余各行基本一点就中（实测 301/317）。
 */
const abyssKnownFilesOf = (mstId: number): string[] => [
  ...abyssVoiceSightings.filter((entry) => entry.mstId === mstId).map((entry) => entry.voiceId),
  ...(abyssSubtitleByMst.get(mstId) ?? []).map((line) => line.key),
  ...(abyssArchiveIndex().get(mstId) ?? []),
]

/** 候选一律先反解回本形态才认——归属自证，见上面第三条纪律。 */
const abyssSelfAttests = (file: string, mstId: number): boolean =>
  parseAbyssVoiceFile(file, isAbyssMst)?.mstId === mstId

/**
 * 这一行该试哪几个档名。手输过前缀就把那一批排在前面（推测那批仍留着，
 * 手输一次不该把已经试到一半的列表清空）。
 */
const abyssGuessListFor = (mstId: number, lineNo: string): string[] => {
  const typed = `${abyssGuessPrefixes.get(`${mstId}/${lineNo}`) ?? ''}`.trim()
  const manual = /^\d{2,3}$/.test(typed) ? abyssVoiceFileCandidates(typed, mstId, lineNo) : []
  const guessed = abyssVoiceGuessCandidates(
    mstId,
    lineNo,
    abyssPrefixIndexOf(),
    abyssKnownFilesOf(mstId),
  )
  return [...new Set([...manual, ...guessed])].filter((file) => abyssSelfAttests(file, mstId))
}

/**
 * 一行候选试听 UI。收起时只有一枚开关，展开时候选**紧挨着这一行的台词**
 * ——提督照着上面那句日文对音节，这是这块 UI 唯一的判据来源。
 *
 * @param lineNo 这一行的行号（包里的 `suffix`，10/20/30/40）。推不出来就不摆：
 *   没有行号就拼不出档名，摆个空壳只会让人以为是坏了。
 */
const abyssGuessBlock = (mstId: number, lineNo: unknown): string => {
  if (!DEBUG_UI) return ''
  const line = `${lineNo ?? ''}`.trim()
  if (!/^[1-5]$|^[1-5][01]$/.test(line)) return ''
  const key = `${mstId}/${line}`
  if (abyssGuessOpen !== key) {
    return `<div class="ji-ag"><span class="ji-ag-toggle" data-abyss-guess="${esc(key)}">按推测档名试听</span></div>`
  }
  const heard = new Set(
    abyssVoiceSightings.filter((entry) => entry.mstId === mstId).map((entry) => entry.voiceId),
  )
  const typed = `${abyssGuessPrefixes.get(key) ?? ''}`
  const chips = abyssGuessListFor(mstId, line)
    .map((file) => {
      const outcome = abyssGuessOutcomes.get(file)
      const state = heard.has(file) ? 'kept' : (outcome ?? '')
      const note =
        state === 'kept'
          ? '已收录'
          : state === 'played'
            ? '响了'
            : state === 'missing'
              ? '没取到'
              : ''
      return `<span class="ji-ag-item">
        <span class="ji-ag-try${state ? ` ${state}` : ''}" data-abyss-try="${esc(key)}/${esc(file)}" title="点一下取这一条听听：响了就是猜对了档名">♪ ${esc(file)}</span>
        ${note ? `<span class="ji-ag-note ${state}">${note}</span>` : ''}
        ${state === 'played' ? `<span class="ji-ag-keep" data-abyss-keep="${esc(key)}/${esc(file)}" title="认下这一条：归属由档名结构自证，记进台账后正式界面这一行就有播放钮了">收录</span>` : ''}
      </span>`
    })
    .join('')
  return `<div class="ji-ag ji-ag-open">
    <div class="ji-ag-head">按推测档名试听（KANSO_DEBUG_UI）·前缀猜不准，候选按可能性排好了，一个一个点，听到响的那条再收录</div>
    <div class="ji-ag-list">${chips || '<span class="ji-ag-note">这个形态附近一条已知档名都没有，推不出候选——直接填前缀试</span>'}</div>
    <div class="ji-ag-manual">
      <span>都不响？直接填前缀（2–3 位），回车生效</span>
      <input class="ji-ag-prefix" data-abyss-prefix="${esc(key)}" value="${esc(typed)}" maxlength="3" inputmode="numeric" placeholder="605">
    </div>
  </div>`
}

// 播放能力的边界照实说：三种拿不到的原因各不相同，别混成一句「没有」
/**
 * @param offCount 这一页有几行没有播放钮。给了就**照这一页的实数说**，
 *   不给才退回全局那句概数——一页 24 行全都有钮却写着「约两成连不到音轨」，
 *   那是一句当页就能被戳穿的假话。
 */
const voiceFootNote = (offCount?: number, total?: number): string => {
  const st = voiceState()
  if (!st.graphReady) return ' · 暂不可播放 · 登录游戏后同步'
  if (!st.enabled) return ' · 播放已在设置里关闭'
  if (!st.host) return ' · 暂不可播放 · 登录游戏后同步'
  if (offCount === 0) return ' · 全部可播放'
  // 整页一个钮都没有时**不许再挂「▶ 可播放」**——那是一句当页就能被戳穿的话。
  // 2026-08-23 起这一支很少走到了（自译族的键已恢复）：剩下的是整页都判分歧、
  // 或整页的槽位都算不出来那种形态。所以措辞改成不预设病因的通用话。
  if (offCount != null && total != null && total > 0 && offCount >= total) {
    return ' · 均无对应音轨'
  }
  if (offCount != null) return ` · ${offCount} 条连不到音轨`
  return ' · 部分台词连不到音轨'
}

const abyssVoiceFootNote = (): string => {
  const st = voiceState()
  if (!st.enabled) return ' · 播放已在设置里关闭；已缓存的音轨仍可试听'
  if (!st.host) return ' · 已缓存的音轨可试听'
  return ' · ▶ 为已确认的官方音轨'
}

interface SeasonalVoiceLine {
  season: string
  key: string
  scene?: string
  slot?: number
  /** 日文原文。2026-08-22 补回来的那一列；上游没转日文的行照实是空串，不是缺字段 */
  ja: string
  zh: string
}

interface SeasonalSeason {
  title: string
  year?: number
  name: string
  page: string
  updatedAt?: string
}

// ============================================================================
// 「取现值」：收的动作只有这一个家
// ============================================================================
//
// ---- 为什么它长在这里（2026-08-23 用户拍板）----
// 图鉴里原本还有一整卷独立的「点收」清单，把同一件事又摆了一遍。用户的原话是
// 「点收那单独那么一大堆栏就不要了吧，要不然图鉴确实『这里也有，那里也有』的」，
// 以及此前那句「玩家还要自己去找 xx 角色的语音」——信息不该孤岛。
// 于是那一卷整层退役，收的动作回归**舰娘自己的页面**：想收谁的季节语音，
// 就在她的季节台词区里点她那一行。
//
// ---- 三条红线原样搬过来，一条都不许破（发布门）----
// ① **渲染/滚动期零请求**：这里只摆一个带地址参数的钮，点下去那一刻才走那一次现取。
// ② **一次点击一次请求**：沿用既有闸门（`mg:voice-probe` 的钥开关、「已知没有」的短路、
//    404 台账、voice-request-gate），不新增任何绕过闸门的取数通道。
// ③ **没有任何批量入口**（probeAll / collectAll 之类一个都不许有），护栏断言着这件事。
// 档案实物的播放走 `file://`，零网络，不受上面三条限制。

/**
 * 这次会话里取过的槽位与结论。**只在内存里**——它是当场反馈，不是台账。
 * 落进渲染的字符串里（而不是取完直接改 DOM），重渲染才不会把刚才那句话吃掉；
 * 内容是确定的，不带时间戳，`commitPaneHtml` 的字节闸门照样管得住。
 */
const collectOutcomes = new Map<string, CollectOutcome>()

const COLLECT_OUTCOME_TEXT: Record<CollectOutcome, string> = {
  new: '已获取并归档新音频',
  // 「相同」不是失败，是数据：这一格本季没有换成季节版
  same: '与现有档案一致',
  absent: '官方资源无当前槽位',
  blocked: '当前无法获取',
  error: '获取失败 · 可重试',
}

/**
 * 短句里放不下的成因，挂到悬停上。
 *
 * 「取不到」有三种真实成因（没识别出游戏服务器 / 钥里关了 / 地址暂时拼不出），
 * 主进程只回一个 blocked 分不清是哪种——所以三种都如实列上，不挑一种说死。
 * 开关名照抄钥里的原文：玩家要按这个名字去找它。
 */
const COLLECT_OUTCOME_TITLE: Partial<Record<CollectOutcome, string>> = {
  blocked: '游戏资源获取不可用 · 登录游戏或开启「未缓存的立绘/语音从游戏资源服务器取」',
}

const collectOutcomeHtml = (key: string): string => {
  const outcome = collectOutcomes.get(key)
  if (!outcome) return ''
  const note = COLLECT_OUTCOME_TITLE[outcome]
  return `<em class="vo-take-out vo-take-${outcome}"${
    note ? ` title="${esc(note)}"` : ''
  }>${esc(COLLECT_OUTCOME_TEXT[outcome])}</em>`
}

/**
 * 季节台词行上的「取现值」钮。**渲染期不发请求**，点下去才走那一次现取。
 *
 * ---- 它取的是什么：措辞为什么这么克制 ----
 * 官方在季节期间把这个槽位地址上的文件换成季节版，过季再换回去。所以这一钮取回的是
 * **此刻挂在这个槽位上的那一段**——它是不是这一行这一句，由取回的字节与档案对账说话
 *（`collectOutcomeOf` 那几档结论），界面上**不做承诺**。
 *
 * ---- 与同一区「播放钮只认档案不认网络」的分工 ----
 * 那条说的是**回放**：过季之后按地址拼出来的音轨播的是平时那句，把它当成这一行的
 * 播放钮就是错句骗人，所以回放永不回退 CDN。这一钮是**采集**：它不主张取回来的是
 * 哪一句，只把此刻的实况收进档案，再由字节对账如实报一句结论。两件事，别混。
 *
 * ---- 推不出地址就不硬造：两种「没有地址」措辞不同 ----
 * ① `line.slot` 为空、或槽位号根本不在能算出地址的范围内 → **一枚钮都不摆**。
 *    这是数据本身的事实，点什么都不会变。
 * ② 槽位算得出，但主数据还没同步到这个形态的音轨目录名 → 摆一句点不动的说明。
 *    那**不是**「官方没有」，是这台机器还不知道——进一次游戏就有了，别写成死结论。
 */
const seasonalTakeHtml = (mstId: number, slot: number): string => {
  if (!isPlayableVoiceId(slot)) return ''
  if (!voicePathname(mstId, slot)) {
    return '<span class="vo-take wait" title="当前形态音轨尚未同步 · 登录游戏后自动获取">取现值</span>'
  }
  return `<span class="vo-take" data-voice-take="${mstId}/${slot}" title="${esc(
    // 这一钮不主张自己取回来的是哪一句（判据与全部理由见上面的头注），
    // 所以措辞只说「取一次」和「不保证是这一句」，别写成「取这一句」。
    '获取当前槽位音频',
  )}">取现值</span>${collectOutcomeHtml(`voice:${mstId}/${slot}`)}`
}

/**
 * 季节限定台词。**清单层全量列出**：某一年的某个节日她说过哪几句，
 * 是可以逐句数出来的客观事实，玩家先看得见「有什么」，才谈得上收集。
 *
 * 这一段与上面的常规台词是**两个域**，不进那条择一回退链：
 * 常规台词答的是「她平时会说什么」，季节台词答的是「哪一年的哪个节日她说过什么」。
 * 也不做形态回退——季节台词的档名本来就分形态（080 / 080a / 145），
 * 把前置形态的季节台词摆到改二名下就是张冠李戴。
 *
 * ---- 播放钮为什么只认档案、不认网络 ----
 * 季节语音在游戏里**占用与常规台词同一个音轨槽位**（实测 poi-plugin-subtitle 的
 * 编号空间只有 0..53 + 141/241，季节语音没有独立编号），官方在当季把那个地址上的
 * 文件换成季节版，过季再换回去。所以照常规做法拼出来的地址，过季点下去播的是
 * **平时那句**，不是眼前这句——那不是「能播」，是骗人。
 * 能点亮的只有玩家自己客户端当季收到过、并且已经进了持久档案的那一份实物。
 *
 * 于是每一格是三态（判据见 renderer/voice-archive）：
 *   没听过（灰）/ 听过但没留下音频（半亮）/ 有实物（可播放）。
 * 「懒加载只能收到听过的」这条限制在这里被反转成了玩法本身：
 * 要点开她、要让她说话才能点亮——而这恰好也是版权上最干净的姿态，
 * 点亮的每一格都来自玩家自己客户端合法收到的东西。缺的格子不写抱怨文案。
 *
 * ---- 「取现值」是另一件事，别与上面那条混了 ----
 * 上面那条管的是**回放**：不回退 CDN，因为过季点下去播的是平时那句（错句）。
 * 还没有实物的行另给一枚**采集**钮（`seasonalTakeHtml`）：它不主张自己取回来的是
 * 哪一句，只把此刻挂在那个槽位上的实况收进档案，再由字节对账如实报结论。
 * 收的动作从此只有这一个家（2026-08-23 用户拍板，图鉴那一整卷点收清单同日退役）。
 */
const seasonalVoiceHtml = (mstId: number): string => {
  const seasons: Record<string, SeasonalSeason> | undefined = seasonalVoiceLode?.data?.seasons
  const lines: SeasonalVoiceLine[] | undefined = seasonalVoiceLode?.data?.ships?.[`${mstId}`]
  if (!seasons || !lines?.length) return ''

  const grouped = new Map<string, SeasonalVoiceLine[]>()
  for (const line of lines) {
    const list = grouped.get(line.season) ?? []
    list.push(line)
    grouped.set(line.season, list)
  }
  const ordered = [...grouped].sort(
    ([leftId], [rightId]) =>
      (seasons[rightId]?.year ?? 0) - (seasons[leftId]?.year ?? 0) ||
      rightId.localeCompare(leftId),
  )
  // 最近的一季默认展开，其余折起来：一艘老舰能攒下十几季，全铺开就没法读了
  let litTotal = 0
  const blocks = ordered.map(([seasonId, seasonLines], index) => {
    const season = seasons[seasonId]
    let lit = 0
    const rows = seasonLines
      .map((line) => {
        // 三态：没听过 / 听过但没留下实物 / 有实物可播。槽位算不出来的当没听过。
        const state = line.slot == null ? 'none' : voiceLitState(mstId, line.slot)
        const url = state === 'kept' ? archivedVoiceUrl(mstId, line.slot!) : null
        if (state === 'kept') lit++
        // ---- 证据点亮：台账确证「那个槽位此刻挂的就是这一条」的格子，给键 ----
        //
        // 季节台词平时**不给按地址拼出来的键**（f5abd07 定的：过季点下去播的是平时那句，
        // 那不是能播，是骗人）。但「此刻挂的是哪一条」如果**查得出来**，情况就反过来了：
        // 点下去播的正是它。島根丸 2 号槽就是这么一格——玩家实测听到的那一句，
        // 档名对上了季节包里的 `603-Sec1Seika2025`。
        //
        // ⚠️ **一格一证，不按日期猜当季**：官方换文件的时点、换哪几艘、换的是哪一句，
        // 都不是日历能算出来的。没有台账条目的季节行照旧只认档案实物。
        // 档案实物**优先于**这条——那是玩家自己听到过的那一份，比推断更硬。
        const mountedHere =
          !url && line.slot != null && mountedSeasonalLine(mstId, line.slot)?.line.key === line.key
        const liveUrl = mountedHere ? voiceUrl(mstId, line.slot!) : null
        const cell = url
          ? `<span class="vo-play" data-voice="${esc(url)}" title="播放">▶</span>`
          : liveUrl
            ? // 这一条**尤其**该入档：季节语音过季就换回去了，此刻不收下来就再也收不到。
              // 播成功那一下就留一份，下次这一格自动升到「有实物」那一档。
              `<span class="vo-play" data-voice="${esc(liveUrl)}" data-voice-path="${esc(
                voicePathname(mstId, line.slot!) ?? '',
              )}" title="${esc(
                `${voicePlaybackObservationAt(mstId, line.slot)?.observedAt ?? ''} 本地实测：当前槽位播放该台词`,
              )}">▶</span>`
            : state === 'heard'
              // 空状态一律**中性陈述**：不写「还没听过」「去听一次就会收进档案」那种
              // 催促腔（2026-08-23 用户拍板，与立绘侧同一条口径）。
              ? '<span class="vo-play half" title="已播放该台词 · 暂无音频"></span>'
              : '<span class="vo-play off" title="档案暂无该台词"></span>'
        // 与常规台词那一路同一道标点体例归一：季节段就摆在常规段下面，两段不许各写各的。
        // 日文那一列**不过归一**（原文转写不是我们的翻译），也与常规段同款：灰字在上、中文在下。
        // 采集钮：给不给由 `seasonalTakeOffered` 一处说了算（判据与理由在那儿，
        // 护栏能脱开 Electron 真跑一遍）。这里只管把「给」翻成 HTML。
        const take = seasonalTakeOffered(line, state) ? seasonalTakeHtml(mstId, line.slot!) : ''
        const seasonZh = normalizeVoiceText(line.zh)
        const seasonJa = `${line.ja ?? ''}`
        return `<div class="vo-row vo-${state}">
        <span class="vo-k">${esc(line.scene || line.key)}</span>
        <div class="vo-tx">${seasonJa ? `<div class="vo-ja">${esc(seasonJa)}</div>` : ''}${seasonZh ? `<div class="vo-zh">${esc(seasonZh)}</div>` : '<div class="vo-zh vo-untranslated">（暂无译文）</div>'}</div>
        ${take}${cell}
      </div>`
      })
      .join('')
    litTotal += lit
    return `<details class="vo-season"${index === 0 ? ' open' : ''}>
      <summary><span class="vo-season-n">${esc(season?.title ?? seasonId)}</span><span class="vo-season-c">${seasonLines.length} 句${lit ? ` · 留存 ${lit}` : ''}</span></summary>
      <div class="vo-list">${rows}</div>
    </details>`
  })
  return `<div class="vo-seasons">
    <div class="vo-seasons-h">季节限定台词 · 官方 ${lines.length} 句 / ${ordered.length} 季 · 档案留存 ${litTotal} ${
      seasonalVoiceLode
        ? lodeCreditMark(
            seasonalVoiceLode.meta,
            '形态依据：舰娘百科各年「季节性」页档名；日中两列均收录，缺失项留空',
          )
        : ''
    }</div>
    ${blocks.join('')}
  </div>`
}

// ---- 自补层（艦素自行翻译）----
//
// 这一层只做一件事：**填 kcwiki 空着的格**。同形态同槽两层都有时 kcwiki 胜——
// 它是社区共识层，也是玩家在别处见惯的那一份；自补层是补缺，不是改写。
// 两层各自成行，不做行内混拼（不会出现「日文取一边、译文取另一边」的行）。
//
// 包里**没有日文**（随包只收中文，与季节台词包同一条口径），所以这一层的行
// 走 `voiceRowWithUrl` 直接给 html，不进 `voiceRow` 那条要日文做交叉校验的路——
// 校验已经在**编译期**做完并写进了 `basis`（见包的 meta.note）。

// 注意这里**没有 `draft`**：包里那个字段是维护者侧的「这一句我拿不准」标记，
// 界面上一个字都不该出现。类型里不声明 + 取数时逐字段重建（见下面的 fill），
// 两道加起来才是结构性的保证——只靠「记得别渲染它」迟早会漏。
interface KansoVoiceRow {
  key: string
  scene: string
  slot?: number
  /**
   * 编译期判好的播放键判据。`wikiwiki-mapped` = 槽位由 wikiwiki 舰娘页的「场合」列推出
   *（这一层覆盖的形态本地都没有 subtitle-ja，没有第二份东西可以对）——**给键，但与
   * `key-confirmed` 在数据上分得开**：两者的实测错位率差一百倍，那张实测表在
   * `shared/voice-playback-observations` 文件头。
   */
  basis?: 'key-confirmed' | 'wikiwiki-mapped' | 'divergent' | 'ambiguous'
  /** 日文原文。2026-08-22 补回来的那一列——台词卷是**对照**功能，只给中文是半张表 */
  ja: string
  zh: string
}

const KANSO_VOICE_CREDIT_NOTE =
  '资料未收录形态 · 中文译文来源：kuma 自译'

/** 这个形态由自补层补上的那几行（kcwiki 已经占了的槽位一律让给 kcwiki）。 */
const kansoVoiceFillFor = (mstId: number, taken: CorrectedVoiceRow[]): KansoVoiceRow[] => {
  const lines: KansoVoiceRow[] | undefined = kansoVoiceLode?.data?.ships?.[`${mstId}`]
  if (!lines?.length) return []
  const used = new Set<number>()
  for (const row of taken) {
    const slot = row.slot ?? voiceSlotOfKey(row.key)
    if (slot != null) used.add(slot)
  }
  // 逐字段重建而不是把包里的对象原样传下去：包里还有个维护者侧的 `draft`，
  // 原样传等于把它交到渲染路径手上，只差有人写一句 `${l.draft}` 就漏出去了。
  return lines
    .filter((line) => line.slot == null || !used.has(line.slot))
    .map((line) => ({
      key: `${line.key ?? ''}`,
      scene: `${line.scene ?? ''}`,
      ...(line.slot == null ? {} : { slot: line.slot }),
      ...(line.basis == null ? {} : { basis: line.basis }),
      ja: `${line.ja ?? ''}`,
      zh: `${line.zh ?? ''}`,
    }))
}

/**
 * 自补层的播放地址。判据在编译期已经定好写进 `basis`，这里只认结论：
 * `divergent`（与音轨对不上）与 `ambiguous`（同一槽位有两种以上候选文本）都不给键——
 * 后者至多只有一句是真的，给了就是二选一地赌，家法是宁可无键不播错句。
 *
 * `key-confirmed` 与 `wikiwiki-mapped` 都给键。后者是这一层的常态（2642 行）：
 * 这 76 个形态本地一份字幕都没有，槽位只能由 wikiwiki 舰娘页的「场合」列推出。
 * 2026-08-22 曾按「无从校验＝不给键」把这 2642 个键整层撤下，2026-08-23 复核证据轴后恢复——
 * 两条耳测判例一条属 kcwiki 表缺陷族、一条是季节占槽（映射没错），都指不到这一层；
 * 而唯一一次真正落在这一层形态上的耳测（島根丸）是**正例**。残余风险如实量过并留底，
 * 见 `shared/voice-playback-observations` 文件头那张实测表。
 *
 * 具体给哪个地址（档案实物还是现取）由 `voicePlaybackFor` 统一裁，与其它层一条判据。
 */
const kansoVoiceUrl = (
  playbackMstId: number,
  line: KansoVoiceRow,
): ReturnType<typeof voicePlaybackFor> => {
  if (line.basis !== 'key-confirmed' && line.basis !== 'wikiwiki-mapped') return null
  return voicePlaybackFor(playbackMstId, line.slot ?? null)
}

const kansoVoiceOffNote = (playbackMstId: number, line: KansoVoiceRow): string => {
  if (line.basis === 'ambiguous') {
    return '当前场合有多个候选 · 对应台词未确定'
  }
  if (line.basis === 'divergent') {
    return '与游戏当前音轨对不上'
  }
  return voiceObservedOffNote(playbackMstId, line.slot ?? null)
}

/**
 * 骨架行：只有场合名与一个播放钮，文字位是**中性短横**。
 *
 * 三态（判据见 shared/voice-probe-plan）：
 *  · 档案里已有实物 → 直接给档案那一份（与正常行同一条优先级，零网络）；
 *  · 已知官方没有 → 灰暗的无配音态，**仍旧点得动**：点一下绕过「已知没有」那道短路
 *    再问一次（2026-08-23 用户拍板）。悬停写**问的是哪一天**——这条结论从同一天起
 *    不再自动过期，不写日期玩家就无从判断它有多旧；
 *  · 其余 → 探测钮，**点了才发那一次请求**。
 *
 * 摆行范围＝没被文本行占住的全部槽位（混淆段 1..53，**再接上已知裸编号槽位**：
 * 129 放置②、900 特殊攻击、990~993 夜战僚舰分支、141/241 西村舰队；
 * 表里带 `onlyMst` 的（917/918 = Graf Zeppelin 系专用夜战）**只在她家的形态页摆**——
 * 所以这里必须把 mstId 传下去，漏传就退化成「限定槽位一格都不摆」）。第一版曾按「有词形态
 * 只摆有旁证的格」收窄，2026-08-23 用户裁定推翻（「不展示代表没有，既然不是没有
 * 为何不展示」，判例是国後的报时——音频在游戏里存在、三个文本源都没收、页面留白
 * 等于谎称她没有）；理由与演进全文见 shared/voice-probe-plan 文件头。
 *
 * 文字位不写「暂无台词」这类抱怨文案：这一格本来就不主张任何文本，
 * 一个短横就够了（缺格不写抱怨文案是这个域一贯的纪律）。
 */
/**
 * 无配音格的悬停：**问的是哪一天**，写出来。
 *
 * 2026-08-23 台账不再自动过期之后，这条结论会一直挂在那里；「之前问过」是一句
 * 没有出处的断言，玩家看不出它是昨天还是去年的结论。日期读不出来（老台账里
 * 时间戳坏掉的那种）才退回原来那句——不编一个日期出来。
 */
const absentTitle = (mstId: number, slot: number): string => {
  const day = voiceAbsentDay(mstId, slot)
  return day
    ? `${day} 核实：官方资源无对应音频 · 单击重新核实`
    : '最新核实：官方资源无对应音频 · 单击重新核实'
}

const skeletonRows = (mstId: number, covered: Set<number>): { slot: number; html: string }[] => {
  // 名单还没到位时**一格都不摆**：那会把「还不知道」显示成「官方没有」
  if (!voiceAbsentReady()) return []
  const slots = voiceSkeletonSlots({ covered, mstId })
  const out: { slot: number; html: string }[] = []
  for (const slot of slots) {
    // 54 起的裸编号槽位（900 特殊攻击…）也有场合名，同一张表，见 voiceSceneOfSlot
    const scene = voiceSceneOfSlot(slot) || `槽位 ${slot}`
    const kept = archivedVoiceUrl(mstId, slot)
    const known = isVoiceAbsent(mstId, slot)
    const cell = kept
      ? `<span class="vo-play" data-voice="${esc(kept)}" title="播放">▶</span>`
      : known
        ? // 无配音态**仍旧点得动**（2026-08-23 用户拍板）：官方哪天补了这一句，
          // 手点一下就再问一次。观感照旧灰暗（虚线圈 + 一个点），只在悬停时给一点
          // 可点的暗示——它是「问过了，没有」这个事实的如实呈现，不该跟正常播放钮抢眼。
          // 悬停带**具体日期**：这条结论不再自动过期，日期就是它的出处
          //（日期在装配期由索引直接给出，不在这里现算，见 renderer/voice-probe）。
          `<span class="vo-play none" data-voice-probe="${slot}" title="${esc(absentTitle(mstId, slot))}"></span>`
        : `<span class="vo-play probe" data-voice-probe="${slot}" title="单击获取当前槽位音频">▶</span>`
    out.push({
      slot,
      html: `<div class="vo-row vo-skeleton">
        <span class="vo-k">${esc(scene)}</span>
        <div class="vo-tx"><div class="vo-zh vo-untranslated">—</div></div>
        ${cell}
      </div>`,
    })
  }
  return out
}

/**
 * 这个形态在**随包资料**里有几格时报文本（30..53，按槽位去重）。
 *
 * 三个源与底层续填同一份（`planVoiceFallbackChain`），且**只认留在自己桶里的
 * kcwiki 行**：归属校正挪进来的那几行是别的形态的，算进来就等于替它宣称有时报。
 */
const hourlyTextSlotsOf = (id: number): number => {
  const slots = new Set<number>()
  for (const row of correctedVoiceRows.get(id) ?? []) {
    if (row.fix === 'reattributed') continue
    const slot = row.slot ?? voiceSlotOfKey(row.key)
    if (slot != null && isHourlyVoiceSlot(slot)) slots.add(slot)
  }
  for (const line of wikiwikiVoiceLode?.data?.[`${id}`] ?? []) {
    if (line.voiceId != null && isHourlyVoiceSlot(line.voiceId)) slots.add(line.voiceId)
  }
  for (const key of [
    ...Object.keys(subtitleJa?.data?.[`${id}`] ?? {}),
    ...Object.keys(subtitleZh?.data?.[`${id}`] ?? {}),
  ]) {
    const slot = parseInt(key, 10)
    if (isHourlyVoiceSlot(slot)) slots.add(slot)
  }
  return slots.size
}

/**
 * 时报段头上那一行指路：「时报台词收录在「大泊改」」。
 *
 * 舰名走既有的实体链（`entityNameHtml`，与借用注同一套），点了就跳那个形态页。
 * 一眼位置只留这一句短话；「探测钮照旧点得动」那层交代进悬停——
 * 判据、判例与「为什么只指路不下结论」全在 shared/voice-probe-plan 那一段头注。
 */
const hourlyPointerHtml = (targetId: number): string =>
  `<div class="vo-hourly-ref">时报台词收录在「${entityNameHtml(
    'ship',
    targetId,
    masterShipName(targetId),
    { compact: true },
  )}」</div>`

/**
 * 这个号在**当前主数据**里是不是一个深海形态。档名反解要靠它消歧，
 * 补场合名那一步也要（同一份判据，不另起一个）。
 */
const isAbyssMst = (id: number): boolean => abyssalShips.has(id)

/**
 * 深海侧的「档案里听过的音轨」：**玩家在战斗里真的听到过、可一个文本源都没收**的那些。
 *
 * ---- 为什么要有这一段（2026-08-23）----
 * 深海台词卷只显示文本源认领过的行；889 个深海形态里 234 个一个字都没有，
 * 于是整段隐藏——按用户定的口径，那等于谎称这个形态不说话。而深海音轨
 *（kc9998）本来就在语音档案的收录范围里（VOICE_ARCHIVE_PATH 收 kc9998），
 * 玩家战斗中听过的实物**已经躺在档案里**。既然不是没有，就该摆出来。
 *
 * ---- 三条纪律 ----
 * ① **不主张文本**：文字位只有一个中性短横，与骨架行同族——档案里躺着的是音轨，
 *    不是台词，替它写一句话就是编。
 *    ⚠️ 「场合」那一列 2026-08-23 起**改成实测补名**（`abyssVoiceRowLabel`）。
 *    原话是「深海档名里没有场合信息」——那句判错了：档名末尾的行号首位就是場合号，
 *    实证是 subtitle-enemies 的官方档名与 wikiwiki 页面场合列按日文原文对撞
 *    （139 条对上 136 条同族，3 条例外全部是 subtitle-enemies 自己那行坏了）。
 *    判据与复算见 shared/abyss-voice-file 的「行号 → 场合名」一段。
 *    实测不到的第 5 族照旧「音轨 #编号」——补名与不猜是同一条纪律的两面。
 * ② **只播档案实物**（file://，零网络）：这里摆出来的前提就是「档案里有」，
 *    不回退 CDN——理由与 renderer/voice-archive 的 `archivedVoiceUrlOf` 头注同一条。
 * ③ **不做探测钮**：深海的地址空间没法枚举（档名是前缀+形态号+行号的裸串，
 *    不是 1..53 那样的固定槽位空间），探测无从谈起。能证实的显示，不能证实的不硬造。
 *
 * ---- 归属怎么来 ----
 * 档名反解，判据与验证在 shared/abyss-voice-file 的文件头（309 条逐条对过、
 * 与 234 条独立锚点 0 冲突）。**解不出或多解的档名不摆行**——宁缺毋滥，
 * 这一族的错法是把 A 的声音摆到 B 名下，而界面上它和对的长得一模一样。
 *
 * 索引在**档案或主数据变过之后才重算**（失效戳 = 档案代数 + 深海形态数），
 * 不在逐行渲染路径上扫全表。
 */
let abyssArchiveByMst = new Map<number, string[]>()
let abyssArchiveStamp = ''
const abyssArchiveIndex = (): ReadonlyMap<number, string[]> => {
  const stamp = `${voiceArchiveGeneration()}|${abyssalShips.size}`
  if (stamp === abyssArchiveStamp) return abyssArchiveByMst
  abyssArchiveByMst = abyssalShips.size
    ? groupAbyssVoiceFiles(archivedExtraVoiceFiles(EXTRA_VOICE_DIRS.enemy), isAbyssMst)
    : new Map()
  abyssArchiveStamp = stamp
  return abyssArchiveByMst
}

/**
 * 这个深海形态在档案里的音轨行。
 *
 * @param shown 文本源已经摆过的档名——**同一条不摆两行**（判据在 shared 那边，
 *              护栏能真跑一遍）。
 */
const abyssArchiveRows = (mstId: number, shown: ReadonlySet<string>): string[] =>
  abyssArchiveKeysFor(abyssArchiveIndex(), mstId, shown)
    .map((key) => ({
      key,
      url: archivedVoiceUrlOf(`/kcs/sound/kc${EXTRA_VOICE_DIRS.enemy}/${key}.mp3`),
    }))
    // 索引装配到渲染之间档案理论上可能变过；取不到实物就不摆行（这一段的前提就是有实物）
    .filter((track): track is { key: string; url: string } => Boolean(track.url))
    .map(
      (track) => `<div class="vo-row vo-skeleton">
        <span class="vo-k">${esc(abyssVoiceRowLabel(track.key, isAbyssMst))}</span>
        <div class="vo-tx"><div class="vo-zh vo-untranslated">—</div></div>
        <span class="vo-play" data-voice="${esc(track.url)}" title="播放">▶</span>
      </div>`,
    )

/**
 * 亲历显形：这个形态的音轨目录下、档案里躺着的**表外裸编号**音轨，每条长一行。
 *
 * ---- 它补的是哪个洞（2026-08-23 用户拍板）----
 * 展示侧那张裸编号表是「主动摆行」的判据，只认写死的名单——对，但必然滞后：
 * 官方新发明一个编号（下一期活动的友军舰队、某舰的新特殊攻击），从玩家在游戏里
 * 听到、到艦素的表收进来，那一句在图鉴里不存在。而这段时间里**实物早就躺在档案里**
 *（拦截侧 08-22 起按值域认裸编号来路并入档）。这一段把判据倒过来：
 * **存在性由实物本身背书**，玩家听过一次即自动显形，不必等表更新。
 *
 * 归属、场合名推导与三条纪律（不主张文本 / 只播档案实物 / 不做探测钮）
 * 全在 shared/voice-probe-plan 的 `bareArchiveVoiceRows` 头注——护栏能真跑一遍。
 * 这里只负责画，外加一件事：**目录名由 shipgraph 正查**，
 * 于是共用目录的多个形态天然各自长行（共用目录 = 语音真共用）。
 *
 * ⚠️ 地址不走 `archivedVoiceUrl(mstId, slot)`：那条路要过 `isPlayableVoiceId`，
 * 而表外裸编号按设计过不了那一关（展示侧不许凭空算地址）。这里改用 pathname 直取，
 * 因为**这一行的前提就是那个 pathname 上有实物**——与深海档案段同一条路子。
 */
const bareArchiveRows = (
  mstId: number,
  covered: ReadonlySet<number>,
): { slot: number; html: string }[] =>
  bareArchiveVoiceRows({
    filename: voiceFilenameOf(mstId),
    slotsOfDir: archivedBareVoiceSlots,
    covered,
  })
    .map((row) => ({ row, url: archivedVoiceUrlOf(row.pathname) }))
    // 索引装配到渲染之间档案理论上可能变过；取不到实物就不摆行（这一段的前提就是有实物）
    .filter((track): track is { row: BareArchiveVoiceRow; url: string } => Boolean(track.url))
    .map(({ row, url }) => ({
      slot: row.slot,
      html: `<div class="vo-row vo-skeleton">
        <span class="vo-k">${esc(row.scene)}</span>
        <div class="vo-tx"><div class="vo-zh vo-untranslated">—</div></div>
        <span class="vo-play" data-voice="${esc(url)}" title="播放">▶</span>
      </div>`,
    }))

/**
 * 插入式扩展格（语音侧）：同一槽位的档案里存了**多份 sha1** 时，正式行没认领的那几份
 * 各自长出一行。
 *
 * ---- 为什么这一行必须存在（自扩展两层公约的「存在层」那一半）----
 * 官方换季在同一个地址上换文件，档案按内容指纹分份保存——于是同一槽位下会躺着
 * 当季那份与平时那份。正式行只播其中一份（`voicePlaybackFor` 取最近听到的那一份），
 * 剩下的实物**在界面上不存在**。玩家自己收到的东西不该看不见：
 * 存在层由机器自己长格子，名分层允许滞后，但滞后要**显形**。
 *
 * ---- 三条纪律 ----
 * ① **不主张文本**：文字位只有一个中性短横。这一份字节对应哪一句没有依据可断，
 *    替它写一句话就是编（与骨架行、深海档案行同族）。
 * ② **只播档案实物**（file://，零网络）：这一行的前提就是「档案里有这一份」。
 * ③ **有证据才挂名**：耳测台账确证那个槽位此刻挂着哪一季的哪一条时，
 *    最近那一份按证据写成「盛夏（耳测）」；没有证据一律「另一份实物」。
 *    判据与「两套不并存」的对账在 shared/seasonal-collect（护栏能真跑一遍）。
 *
 * ---- 只长在常规台词卷里 ----
 * 同一槽位在季节台词区也会出现（那边按季节列句子）。两处都长就是同一份实物
 * 在一页上出现两行。常规卷是「这一格上有什么」的那一栏，扩展行归它。
 */
const archiveVariantRows = (
  mstId: number,
  covered: ReadonlySet<number>,
): { slot: number; html: string }[] => {
  const out: { slot: number; html: string }[] = []
  for (const slot of [...covered].sort((left, right) => left - right)) {
    const takes = archivedVoiceTakes(mstId, slot)
    if (!takes.length) continue
    // 正式行认领掉哪一份：它播的就是 `voicePlaybackFor` 给的那个地址。
    // 按**地址**认领而不是按「第一条」——有耳测负例的格一个键都不给，
    // 那时档案里的每一份都还没人认领，正是最该显形的那一种。
    const play = voicePlaybackFor(mstId, slot)
    const claimedSha1 = play?.fromArchive
      ? takes.filter((take) => take.url === play.url).map((take) => take.entry.sha1)
      : []
    const extras = unclaimedArchiveVariants(
      takes.map((take) => take.entry),
      claimedSha1,
    )
    if (!extras.length) continue
    const mounted = mountedSeasonalLine(mstId, slot)
    const observedAt = voicePlaybackObservationAt(mstId, slot)?.observedAt ?? ''
    extras.forEach((entry, index) => {
      const url = takes.find((take) => take.entry.sha1 === entry.sha1)?.url
      if (!url) return
      // 证据只能落在**最近那一份**上：台账说的是「此刻挂在这个槽位上的是哪一条」，
      // 而最近听到的那一份就是此刻那一份。更早的那些一律中性。
      const label = variantLabelOf(
        index === 0 && mounted ? { seasonTitle: mounted.title, observedAt } : null,
      )
      out.push({
        slot,
        html: `<div class="vo-row vo-variant">
          <span class="vo-k">${esc(label.name)}</span>
          <div class="vo-tx"><div class="vo-zh vo-untranslated" title="${esc(
            `${label.note}。${fmtDate(entry.firstHeard)} 留存${entry.version ? ` · 版本 ${entry.version}` : ''}`,
          )}">${esc(VARIANT_TEXT_DASH)}</div></div>
          <span class="vo-play" data-voice="${esc(url)}" title="${esc(
            `档案里留存的这一份 · ${fmtDate(entry.firstHeard)} 留存`,
          )}">▶</span>
        </div>`,
      })
    })
  }
  return out
}

/**
 * 常规台词（她平时会说什么）。**三层按槽位叠**，同一格只出一行，不做字段级混拼：
 *
 *   ① 本形态自己的 kcwiki 行（校正后的视图）——带场合，且已按本形态音轨逐行交叉校验；
 *   ② 本形态自己的自补层译文——上游没收的那些格，由艦素自译（角标「自译」）；
 *   ③ 底层：**沿改装链按槽位续填**（每一级里 kcwiki 桶 → wikiwiki → poi-subtitle），
 *      只填上面两层没占到的格。判据与实测在 shared/voice-scene-slots 的
 *      `planVoiceFallbackChain` 头注；深海不进这条路，见下面那一支。
 *
 * ---- ③ 为什么从「命中即停」改成「续填」（2026-08-23）----
 * 老口径是沿链择一：第一个有东西的源命中就 break。命中的那份大不大不作数，
 * 于是 kcwiki 桶里只有 1 行的形态（夕張改二特 623）整页就只剩 1 行，
 * 而它自己的 subtitle 里 52 格（含 24 条时报）一个字都出不来。
 * 随包资料实测：862 个我方形态里 173 个受影响，合计 3735 行取不到。
 * 现在改成把还空着的槽位逐级填上——**同一槽位仍旧只出一行**，先到先得，
 * 链序即优先序（越近的前置形态越优先），这本来就是本函数头那句话的意思。
 *
 * ---- 为什么底层不能也吃「校正后的视图」----
 * 归属校正会把改形态的行从基础形态的桶里挪走、挪进它自己的形态。挪进来的那三五行
 * 是**这个形态自己的**（第①层），可**当回退源用**的时候必须只算「留在自己桶里的」那些——
 * 否则两件事都会错：
 *  · 拿别的形态挪进来的行当自己的回退源 = 把别人的话又搬回来；
 *  · 一个形态凭空多出三五行，就足以让老口径的「本形态整份没有资料」不成立，
 *    于是整份回退被挡掉——翔鹤改二甲实测从 52 行掉到 2 行（用户看到的是「台词少了一大截」）。
 * 所以底层的**触发与取数都用 `fix !== 'reattributed'` 的那一份**，与老口径逐格等价。
 */
const regularVoiceHtml = (mstId: number): string => {
  const abyss = mstId >= 1500
  // 当前形态没有整份资料时，沿改装链逐级回退，优先最近的前置形态而不是直接跳到原型。
  const tryIds = abyss ? [mstId] : (voiceFallbackOf.get(mstId) ?? [mstId])

  // ---- ①② 本形态自己的两层 ----
  const own: CorrectedVoiceRow[] = abyss ? [] : (correctedVoiceRows.get(mstId) ?? [])
  const filled = abyss ? [] : kansoVoiceFillFor(mstId, own)
  const slotOfRow = (row: CorrectedVoiceRow) => row.slot ?? voiceSlotOfKey(row.key)
  const covered = new Set<number>()
  for (const row of own) {
    const slot = slotOfRow(row)
    if (slot != null) covered.add(slot)
  }
  for (const row of filled) if (row.slot != null) covered.add(row.slot)

  const merged: { slot: number; order: number; html: string }[] = []
  let order = 0
  const push = (slot: number | null, html: string) => {
    merged.push({ slot: slot ?? 9_999, order: order++, html })
  }
  for (const row of own) {
    push(slotOfRow(row), voiceRow(mstId, mstId, row.key, row.scene, row.ja, row.zh, row))
  }
  for (const row of filled) {
    const play = kansoVoiceUrl(mstId, row)
    push(
      row.slot ?? null,
      voiceRowWithUrl(
        row.key,
        row.scene,
        row.ja,
        row.zh,
        play?.url ?? null,
        kansoVoiceOffNote(mstId, row),
        'kanso',
        play?.pathname,
      ),
    )
  }

  // ---- ③ 底层：沿链按槽位续填，只填上面两层没占到的格 ----
  let baseFoot = ''
  let baseNote = ''
  // 借来的文本挂在谁名下：只点**最近的那一级**，多于一级就说「等 N 个」。
  // 把链上每一级都列出来会变成一串舰名清单，玩家读的是「这几条不是她自己的」，
  // 不是族谱。
  const borrowNote = (borrowed: readonly number[], hasOwnRows: boolean): string => {
    if (!borrowed.length) return ''
    const nearest = entityNameHtml('ship', borrowed[0], masterShipName(borrowed[0]), {
      compact: true,
    })
    const who =
      borrowed.length === 1
        ? `最近的前置形态「${nearest}」`
        : `「${nearest}」等 ${borrowed.length} 个前置形态`
    return `<div class="vo-note">${
      hasOwnRows ? `部分场合台词来源：${who}` : `本形态暂无台词资料 · 当前采用${who}资料`
    }</div>`
  }

  // 文本源已经摆过的深海档名。**只有 subtitle-enemies 的 key 是完整官方档名**
  //（另外两支给的是 wiki 资源键），所以档案追加段的去重只可能与这一组重叠。
  const shownAbyssKeys = new Set<string>()

  if (abyss) {
    // 深海侧**整条不动**：只有单 id，而且这三个源各有各的播放契约——只有
    // subtitle-enemies 的 key 是完整官方档名，别的都不能拼地址，叠起来既没有意义
    // 也不安全。所以深海照旧走老口径的「命中即停」。
    //
    // 老口径这条链后面还挂着 wikiwiki 舰娘页与 poi-subtitle 两支，深海走不到：
    // 那两个包都按舰娘 mstId 编键，深海形态数为 0（实测）。这一条不是推断出来的，
    // test/voice-fallback-chain 里有一条护栏逐包盯着它；哪天上游真收了深海，
    // 那条会当场红，而不是在这里悄悄少两行。
    const uncovered = (slot: number | null) => slot == null || !covered.has(slot)
    for (const id of tryIds) {
      // 深海字幕包的 key 就是 kc9998 的完整官方文件名，优先展示这一组才能可靠试听。
      // 其它深海资料只给场景/后缀或 wiki 资源键，不能套舰娘算法伪造播放地址。
      // （`abyss ?` 在这个分支里恒真，留着是因为 core-regressions 那条「深海字幕必须
      //   排在 kcwiki 之前」的顺序断言按这一行的文本定位深海支。）
      const enemySubtitle = abyss ? abyssSubtitleByMst.get(id) : undefined
      if (enemySubtitle?.length) {
        for (const line of enemySubtitle) {
          // 这一档名已经带着译文摆出来了；下面的档案追加段据此不再重复摆一行
          shownAbyssKeys.add(line.key)
          // 场合名与下面档案段共用同一个函数——同一条音轨不许在两段里叫两个名字
          push(null, abyssVoiceRow(line.key, abyssVoiceRowLabel(line.key, isAbyssMst), line.ja, line.zh))
        }
        baseFoot = `${lodeCreditMark(subtitleEnemiesLode!.meta, '音轨号保留；场合依据档名行号实测对照；未实测项暂无名称')} ${abyssVoiceFootNote()}`
        break
      }
      // 首选：kcwiki（带场合）。**只认留在自己桶里的行**，理由见函数头。
      // ⚠️ 这一支必须排在上面深海字幕那一支之后：深海的 key 是完整官方档名，
      // 只有那一组能可靠试听（core-regressions 里有一条顺序断言盯着这件事）。
      const kept = (correctedVoiceRows.get(id) ?? []).filter((row) => row.fix !== 'reattributed')
      if (kept.length) {
        for (const row of kept.filter((row) => uncovered(slotOfRow(row)))) {
          push(slotOfRow(row), voiceRow(id, mstId, row.key, row.scene, row.ja, row.zh, row))
        }
        baseFoot = voiceLode
          ? lodeCreditMark(voiceLode.meta, '深海台词只给日中对照')
          : ''
        break
      }
      // 深海精确形态补录：只接受页面列出的 No. 与当前 mstId 对上的行。
      const wikiwikiAbyss:
        | {
            key: string
            scene: string
            ja: string
            page: string
            slot?: 'opening' | 'attack' | 'damage' | 'sunk'
            suffix?: number
          }[]
        | undefined = wikiwikiAbyssVoiceLode?.data?.[`${id}`]
      if (wikiwikiAbyss?.length) {
        ensureAbyssVoiceSightings()
        for (const line of wikiwikiAbyss) {
          const scene = abyssWikiVoiceScene(line.suffix, line.scene)
          const zh = voiceZhByJa.get(normalizeVoiceLine(line.ja)) ?? ''
          // 玩家亲历过这一族场合的话，官方在战斗报文里已经把档名告诉过我们——
          // 那就不再是「无法验证的地址」，这一行可以给钮（家法不变，是证据补上了）。
          const heard = abyssHeardVoiceId(id, line.suffix)
          push(
            null,
            heard
              ? voiceRowWithUrl(
                  line.key,
                  scene,
                  line.ja,
                  zh,
                  extraVoiceUrl('enemy', heard),
                  '',
                  undefined,
                  // 播成功那一下拿它入档：这一条从此有实物，下次零网络
                  `/kcs/sound/kc9998/${heard}.mp3`,
                )
              : // 场合名与上面 subtitle-enemies 那一支说同一种话：包里的 suffix 首位
                // 就是行号族号，查同一张表即可（查不到保原文，不硬翻）。
                voiceRow(id, mstId, line.key, scene, line.ja, zh) +
                // 调试门：这一行有台词没档名，给它一串按可能性排好的候选去试听。
                // 发布形态里这一段整块不生成（`abyssGuessBlock` 头一行就返回空串）。
                abyssGuessBlock(id, line.suffix),
          )
        }
        baseFoot = lodeCreditMark(
          wikiwikiAbyssVoiceLode!.meta,
          '形态按页面列出的深海 No. 落位；中文只在与既有译文唯一对齐时复用',
        )
        break
      }
    }
  } else {
    // `covered` 会被就地补上这一层填进去的槽位——骨架层拿的是同一个集合，
    // 不补进去就会在已经有文本的格上再摆一行骨架。
    const plan = planVoiceFallbackChain({
      mstId,
      tryIds,
      covered,
      slotlessJa: [...own, ...filled]
        .filter((row) => (row.slot ?? voiceSlotOfKey(row.key)) == null)
        .map((row) => row.ja),
      correctedRowsOf: (id) => correctedVoiceRows.get(id),
      wikiwikiRowsOf: (id) => wikiwikiVoiceLode?.data?.[`${id}`],
      subtitleJaOf: (id) => subtitleJa?.data?.[`${id}`],
      subtitleZhOf: (id) => subtitleZh?.data?.[`${id}`],
      zhOfJa: (ja) => voiceZhByJa.get(normalizeVoiceLine(ja)) ?? '',
    })
    for (const pick of plan.picks) {
      push(
        pick.slot,
        voiceRow(pick.id, mstId, pick.key, pick.scene, pick.ja, pick.zh, pick.row),
      )
    }
    baseNote = borrowNote(plan.borrowedFrom, own.length > 0 || filled.length > 0 || plan.usedOwnForm)
    // 页脚照**这一页真的用到的源**并列标注。续填之后一页上可以同时摆着三个源的行，
    // 只标第一个就是把另外两家的东西算在它头上。
    // ①层那些行也是 kcwiki 的（底层不出行时它就是唯一的源），所以它单独算一票；
    // ②层（自译）由上面 `head` 里那一句自己署名，不重复挂。
    const usedSources: VoiceFallbackSource[] = own.length
      ? ['kcwiki', ...plan.sources.filter((source) => source !== 'kcwiki')]
      : [...plan.sources]
    const credits: string[] = []
    for (const source of usedSources) {
      if (source === 'kcwiki' && voiceLode) credits.push(lodeCreditMark(voiceLode.meta, ''))
      if (source === 'wikiwiki' && wikiwikiVoiceLode) {
        credits.push(
          lodeCreditMark(
            wikiwikiVoiceLode.meta,
            '形态适用范围按资料的改装阶段列区分；无可靠中文对照的保留日文',
          ),
        )
      }
      if (source === 'subtitle' && subtitleZh) {
        credits.push(
          lodeCreditMark(
            subtitleZh.meta,
            usedSources.length === 1
              ? '带场景名的台词资料暂无这个形态'
              : '场景台词资料未覆盖项 · 使用音轨编号转写',
          ),
        )
      }
    }
    baseFoot = credits.join(' ')
    // 「编号不代表场景」只在**真有没场合名的行**时才挂：1–53 全段已按实证对照表
    // 补上场合名（08-23 用户点名要触发条件），裸编号那几个也在 SPECIAL_VOICE_SLOTS 里，
    // 只剩两张表都没收的槽位才适用这句谨慎脚注。
    if (plan.unnamedSubtitleRows) baseFoot = `${baseFoot} · 编号不代表场景`
  }

  // ---- ④ 音频先行骨架：没有文字的那些格也摆出来，点了才去取 ----
  //
  // 2026-08-23 用户两次拍板叠成现在的口径：早上「即便没有台词的新船，也应该把播放
  // 放出来」；晚上把范围钉死为**全形态全槽位**——「不展示代表没有，既然不是没有
  // 为何不展示」（判例：国後的报时音频在游戏里存在、三个文本源都没收，留白=谎称没有）。
  //
  // ⚠️ 与「键必须有文本背书」那条家法不冲突：那条防的是**错配**（显示 A 播 B），
  // 前提是这一行主张了一句台词。骨架行**不主张任何文本**（文字位是中性短横），
  // 结构上不可能错配。文本一到，那一格就由正常行接管，骨架让位——判据与全部理由
  // 在 shared/voice-probe-plan 的文件头。
  // 时报段现在有几格是**文本行**——④ 之后 `covered` 会混进骨架槽位，只能在这里数。
  const ownHourlyTextRows = abyss ? 0 : countHourlyVoiceSlots(covered)
  const skeleton = abyss ? [] : skeletonRows(mstId, covered)
  for (const entry of skeleton) {
    push(entry.slot, entry.html)
    // 骨架也算「这一页已经摆过的槽位」——下面那一段据此不再给同一格摆第二行
    covered.add(entry.slot)
  }

  // ---- ④.5 时报的跨形态指路（2026-08-23，判例：大泊 995 → 大泊改 1000）----
  //
  // 本形态时报段一条文本行都没有、而链上另一形态在随包资料里有成规模时报文本时，
  // 在时报段头上摆一行淡色路标。判据（含三条「不出现」）在 shared/voice-probe-plan
  // 的 `hourlyVoicePointerTarget`，护栏能真跑一遍。
  //
  // ⚠️ **一个探测钮都不拆**：那边头注写明了理由——「别的形态才有」推不出
  // 「本形态没有」（判例：国後）。这一行只加信息，不减功能，也不下结论。
  //
  // 这一页压根没长出时报段时（`voiceAbsentReady()` 还没到位，骨架一格都不摆）
  // 也不摆：路标得贴在路口上，独自悬在页面里没人看得懂它在说哪一段。
  const hourlyPointer =
    abyss || !skeleton.some((entry) => isHourlyVoiceSlot(entry.slot))
      ? null
      : hourlyVoicePointerTarget({
          mstId,
          ownHourlyTextRows,
          chain: (chainOf.get(rootOf.get(mstId) ?? mstId) ?? [mstId]).map((id) => ({
            mstId: id,
            hourlyRows: hourlyTextSlotsOf(id),
          })),
        })
  // 排序键取「时报段头上半格」：与 30 号槽的那一行争先后要靠 order，
  // 而 order 是按 push 次序发的——骨架已经推过了，只能用半格插到它前面。
  if (hourlyPointer != null) push(HOURLY_VOICE_SLOT_FIRST - 0.5, hourlyPointerHtml(hourlyPointer))

  // ---- ⑤ 我方：档案里躺着的表外裸编号，作为**追加段**并进来 ----
  //
  // 同一条裁定的第四处落点，也是它的闭环：表内槽位由上面④管，这里只捡**表还没收**
  // 的那些（下一期活动的友军舰队…）。判据是实物本身，不发一次请求，也不摆探测钮——
  // 表外空间无法枚举，探测无从谈起。全部理由见 `bareArchiveRows` 与 shared 那边的头注。
  const bareArchive = abyss ? [] : bareArchiveRows(mstId, covered)
  for (const entry of bareArchive) push(entry.slot, entry.html)

  // ---- ⑦ 插入式扩展格：同一槽位档案里多留的那几份实物，各自长一行 ----
  //
  // 存在层（档案里真有的）自己长格子，名分层（这一份属于哪一季）允许滞后但必须显形。
  // 正式行认领掉的那一份不会在这里重复出现——「两套不并存」是 `unclaimedArchiveVariants`
  // 的直接后果，护栏钉着它。深海侧不进：那边的音轨没有槽位空间可对账。
  const variants = abyss ? [] : archiveVariantRows(mstId, covered)
  for (const entry of variants) push(entry.slot, entry.html)

  // ---- ⑥ 深海：档案里听过的音轨，作为**追加段**并进来 ----
  //
  // 同一条裁定的第三处落点。上面那条择一链一个字都没动（顺序断言盯着它）：
  // 这一段只在末尾追加「玩家真的听到过、可文本源一个字都没收」的音轨，
  // 不改动任何既有行。判据、去重与三条纪律见 `abyssArchiveRows` 的头注。
  const abyssArchive = abyss ? abyssArchiveRows(mstId, shownAbyssKeys) : []
  for (const html of abyssArchive) push(null, html)

  if (!merged.length) return ''
  merged.sort((left, right) => left.slot - right.slot || left.order - right.order)
  const rows = merged.map((entry) => entry.html)
  // 页脚要照**这一页**的实数说，不能挂全局那句概数。数的是自己刚生成的 html 里
  // 有几个灭钮——三条渲染路径（voiceRow / voiceRowWithUrl / abyssVoiceRow）的判据各不相同，
  // 在这里各复现一遍必然漂移，而漂移的表现是页脚上的数与页面上的钮对不上。
  const offCount = rows.join('').split('vo-play off').length - 1
  // 页脚数**文本行**，骨架行与档案行单独说——两者混成一个「共 N 条」会写出
  // 「共 53 条（另 53 条…）」这种自相矛盾的话（2026-08-23 复验当场照出来的）。
  // 指路行也不是文本行（它一句台词都没主张），一并从「共 N 条」里扣掉。
  const pointerRows = hourlyPointer == null ? 0 : 1
  const textRows = rows.length - skeleton.length - abyssArchive.length - bareArchive.length - variants.length - pointerRows
  // 「只有音轨」那一句我方与深海共用：两边都是**档案里有实物、文本源一个字都没收**的行，
  // 措辞只差听到它的场合（深海只可能在战斗里听到）。两段互斥（abyss 三元各出一边）。
  const archiveOnly = abyssArchive.length + bareArchive.length
  // 书头是一眼扫过的位置：只留数目与状态。「点 ▶ 现取」那层操作说明并进探测钮
  // 自己的 title（同一件事的解释只出现在一处，别在书头再讲一遍）。
  const notes: string[] = []
  if (skeleton.length) notes.push(`${skeleton.length} 条仅有场合 · 暂无文字`)
  if (archiveOnly) notes.push(`${archiveOnly} 条仅有音轨 · 暂无文字`)
  if (variants.length) notes.push(`${variants.length} 条档案额外留存版本`)
  const skeletonNote = notes.join('；另 ')
  const head = textRows
    ? `共 ${textRows} 条${
        filled.length
          ? `（其中 ${filled.length} 条为自译 ${
              kansoVoiceLode ? lodeCreditMark(kansoVoiceLode.meta, KANSO_VOICE_CREDIT_NOTE) : ''
            }）`
          : ''
      }${skeletonNote ? ` · 另 ${skeletonNote}` : ''}`
    : // 一条文本行都没有：别写「共 N 条」也别挂「每一条都连得到音轨」，
      // 如实说这一页现在是什么样子（`skeletonNote` 自带「还没有文字」，别再前缀一遍）
      `这一页 ${skeletonNote}`
  return `${baseNote}<div class="vo-list">${rows.join('')}</div>
    <div class="q-foot">${head} ${baseFoot}${
      abyss || !textRows ? '' : voiceFootNote(offCount, textRows)
    }</div>`
}

const voicePanelHtml = (mstId: number): string => {
  const abyss = mstId >= 1500
  if (
    !voiceLode &&
    !kansoVoiceLode &&
    !seasonalVoiceLode &&
    !wikiwikiVoiceLode &&
    !wikiwikiAbyssVoiceLode &&
    !subtitleZh &&
    !subtitleJa &&
    !subtitleEnemiesLode
  ) {
    return `<div style="font-size:11.5px;color:var(--dim);line-height:1.8">
      台词资料尚未加载</div>`
  }
  const regular = regularVoiceHtml(mstId)
  // 深海舰没有季节限定台词：144 张季节页里 ShinkaiSeikan 档名一条都没有
  //（那 27 处 ShinkaiSeikan 全是立绘图片名）。所以这一格深海侧不出。
  const seasonal = abyss ? '' : seasonalVoiceHtml(mstId)
  if (regular || seasonal) return `${regular}${seasonal}`
  return `<div style="font-size:11.5px;color:var(--dim);line-height:1.8">
    ${
      abyss
        ? '暂无该深海舰台词记录'
        : '台词资料暂无该深海舰记录'
    }</div>`
}

const hasVoiceLines = (mstId: number): boolean =>
  Boolean(
    // 校正后的视图而不是包的原样：重归属会让一个原本 kcwiki 全空的形态第一次有行，
    // 拿原样判会让那 113 个形态的「语音」tab 无故是灭的。
    correctedVoiceRows.get(mstId)?.length ||
      kansoVoiceLode?.data?.ships?.[`${mstId}`]?.length ||
      seasonalVoiceLode?.data?.ships?.[`${mstId}`]?.length ||
      abyssSubtitleByMst.get(mstId)?.length ||
      wikiwikiAbyssVoiceLode?.data?.[`${mstId}`]?.length ||
      wikiwikiVoiceLode?.data?.[`${mstId}`]?.length ||
      Object.keys(subtitleZh?.data?.[`${mstId}`] ?? {}).length ||
      Object.keys(subtitleJa?.data?.[`${mstId}`] ?? {}).length ||
      // 深海侧：一个文本源都没收，但档案里躺着玩家战斗中听到过的音轨——那也是「有」。
      // 少了这一句，「语音」tab 根本不出现，档案追加段就永远见不到光（深海抽屉的
      // tab 条按这个函数拼，见 abyssDetailTabs）。
      abyssArchiveIndex().get(mstId)?.length,
  )

// ---- 装备加成：随包的 kcwiki 底表给「预期值」，面板反推给「你的实测」----
//
// 2026-08-22 换了地基：运行时读的是第一方 schema 的 `kcwiki-fit-bonus`（CC，随包）。
// EO 的 FitBonuses.json **运行时零读取**、也不随包，只留在维护者侧当对账印证票。
// 判定与求值全在 shared/fit-bonus.ts（纯函数、可脱 DOM 测），这里只管画。
// 字段语义见 scripts/fit-bonus-schema.md，两套机制的分界见 scripts/fit-bonus-spec.md。

/** 电探的 api_type[2]（与装备图鉴的「电探」chip 同一份口径）。 */
const FIT_RADAR_TYPE2 = new Set([12, 13, 93])
/** 対空機銃 */
const FIT_AA_GUN_TYPE2 = 21

const FIT_AREA_LABEL: Record<string, string> = { north: '出击北方海域时' }

/**
 * 类目条件（对水面电探 / 对空电探这类）的判定器。
 *
 * **只有确定时才回 yes/no。**「索敌到几算对水面电探」上游那张表没写，包里也故意
 * 没展开成 id 列表——所以能判死的只有否定那一半：舰上一件电探都没有时铁定不满足。
 * 装了电探就是 unknown，那一行落进「条件待定」不计入预期合计，差额交给面板实测说话。
 * 对空机铳是干净的装备类别，两边都判得出来。
 */
const fitGroupState: FitGroupResolver = (group, pool) => {
  if (group === 'aa-gun') {
    return pool.some((item) => item.type2 === FIT_AA_GUN_TYPE2) ? 'yes' : 'no'
  }
  if (!pool.some((item) => item.type2 != null && FIT_RADAR_TYPE2.has(item.type2))) return 'no'
  return 'unknown'
}

const fitShipView = (mstId: number): FitShipView | null => {
  const ship = friendlyShips.get(mstId)
  return ship
    ? {
        formId: mstId,
        ctype: ship.api_ctype,
        stype: ship.api_stype,
        // 国籍走号段（与图鉴筛选、任务条件同一份判据）；判不出就是 0，
        // 带国籍的条件一律不命中
        nationality: shipNationalityIdFromSortId(ship.api_sort_id),
      }
    : null
}

const fitLoadoutOf = (ship: PlayerShip): FitLoadoutItem[] =>
  shipEquipInstances(ship).map((equip) => ({
    mstId: equip.mstId,
    star: equip.level ?? 0,
    type2: mg.master.slotitems[equip.mstId]?.type2,
  }))

const fitGroupLabel = (key: string): string =>
  (fitLode?.data as FitBonusData | undefined)?.equipGroups?.[key]?.zh ?? key

// 条件里的舰名/舰级/需带装备都给实体链接（2026-08-19 用户点名「某某级某某船
// 都没有超链接」）；舰种没有对应实体路由，保持文字。输出是 HTML，调用方别再 esc。
const fitWhoHtml = (set: FitWhoSet | undefined): string => {
  if (!set) return ''
  const parts: string[] = []
  // 国籍是「且」，摆在最前面读起来才是「英国籍 · 正规空母」而不是两个并列条件
  if (set.nations?.length) {
    parts.push(
      set.nations
        .map((id) => esc(`${shipNationalityById(id)?.label ?? id}籍`))
        .join('/'),
    )
  }
  if (set.all && !set.nations?.length) parts.push('全部舰船')
  if (set.forms?.length) {
    parts.push(
      set.forms.slice(0, 4).map((id) => elink('mstShip', id, masterShipName(id))).join('、') +
        (set.forms.length > 4 ? ` 等 ${set.forms.length} 个形态` : ''),
    )
  }
  if (set.classes?.length) {
    parts.push(
      set.classes.slice(0, 4).map((ctype) => elink('shipClass', ctype, shipClassLabel(ctype))).join('/') +
        (set.classes.length > 4 ? ` 等 ${set.classes.length} 级` : ''),
    )
  }
  if (set.types?.length) {
    parts.push(
      set.types
        .map((t) => esc(entityNamePlain('shipType', t, mg.master.stypes[t] ?? `${t}`)))
        .join('/'),
    )
  }
  return parts.join(' · ')
}

const fitCondHtml = (rule: FitRule): string => {
  const parts: string[] = []
  const who = fitWhoHtml(rule.who)
  if (who) parts.push(who)
  const not = fitWhoHtml(rule.not)
  if (not) parts.push(`<i>除外 ${not}</i>`)
  if (rule.need?.star) parts.push(`★≥${rule.need.star}`)
  for (const slot of rule.need?.with ?? []) {
    if (slot.group) parts.push(`需带${esc(fitGroupLabel(slot.group))}`)
    else if (slot.any?.length) {
      parts.push(
        `需带 ${slot.any
          .slice(0, 2)
          .map((id) =>
            elinkHtml(
              'mstEquip',
              id,
              entityNameHtml('equip', id, friendlyEquips.get(id)?.api_name ?? `#${id}`, {
                compact: true,
              }),
            ),
          )
          .join(' / ')}`,
      )
    }
  }
  return parts.join(' · ') || '无附加条件'
}

/** 数值：flat 一格，byStar/byCount 逐档摊开（分档写的是**该档的总值**，不是增量）。 */
const fitGainHtml = (gain: FitGain): string => {
  if (gain.kind === 'flat') {
    return `<span class="fb-val">${esc(fitStatsText(gain.flat) || '—')}</span>`
  }
  if (gain.kind === 'byStar') {
    return gain.steps
      .map(
        (step) =>
          `<span class="fb-val">★${step.from}${
            step.to == null ? '+' : step.to === step.from ? '' : `~${step.to}`
          } ${esc(fitStatsText(step.stats))}</span>`,
      )
      .join('')
  }
  if (gain.kind === 'byCount') {
    return gain.counts
      .map((step) => `<span class="fb-val">${step.count} 件 ${esc(fitStatsText(step.stats))}</span>`)
      .join('')
  }
  return gain.areas
    .map(
      (step) =>
        `<span class="fb-val">${esc(FIT_AREA_LABEL[step.area] ?? step.area)} ${esc(fitStatsText(step.stats))}</span>`,
    )
    .join('')
}

const fitStackText = (rule: FitRule): string =>
  rule.stack === 'perEquip'
    ? rule.cap != null
      ? `按件数 · 最多 ${rule.cap} 件`
      : '按件数'
    : rule.stack === 'once'
      ? '单次'
      : '按件数分档'

// ---- 装备卷的「装备加成」段：预期值 + 你的实测（双轨）----
//
// akashi-list 的运行时拉取路径 2026-08-22 **整层退役**（该站未声明数据许可）。
// 上游还没收录的新装备不再靠联网补——靠下面这条「你的实测」：玩家装上了，面板就给出真值。
// 解析器 `scripts/akashi-fit-parser.mjs` 留在维护者侧当取票工具，运行时一行不读。

/**
 * 装着这件装备的自家舰里，能给出实测观察值的那几艘。
 *
 * 聚合口径（重要）：面板反推出来的是**整条配装**的合计，不是「这一件」单独的贡献。
 * 只有当这艘舰上再没有第二件在包里有命中规则的装备时，这个合计才可以归到这一件头上
 *（`sole`）。其余情况如实标成「整条配装合计」，绝不按件数摊平——摊出来的数
 * 既不属于这件装备，也不属于那艘舰。同一件装备在多艘舰上的观察值不一致时**逐艘并列**，
 * 不取平均：不一致本身就是要看见的信息（多半是某一边的条件没算对）。
 */
const equipObservedRows = (equipMstId: number): FitObservationRow[] => {
  const data = fitLode?.data as FitBonusData | undefined
  const raw: { ship: PlayerShip; observed: ReturnType<typeof panelBonusOf>; stars: number[] }[] = []
  for (const ship of equipCarrierIndex().get(equipMstId) ?? []) {
    const mine = shipEquipInstances(ship).filter((equip) => equip.mstId === equipMstId)
    if (!mine.length) continue
    const observed = panelBonusOf(ship)
    if (!observed) continue
    // ★ 逐件带着走，**不取 max**：同一艘舰上 ★0＋★2 各一件是「混★」，不是「★2 两件」
    raw.push({ ship, observed, stars: mine.map((equip) => Number(equip.level) || 0) })
  }
  // 「只有这一件有戏」的判定与「和预期对不对得上」的比对，各要给每艘舰跑一遍求值器，
  // 一件热门装备可能挂在上百艘身上——所以先按「装了几件 → 等级」粗排取前 24 艘，
  // 只给这几艘做那两遍（24 × 2 次求值，常数）。
  // 这是渲染路径，不许在这里开一个随在籍数增长的循环（同 instanceIndex 那条纪律）。
  const shortlist = raw
    .sort((a, b) => b.stars.length - a.stars.length || b.ship.lv - a.ship.lv)
    .slice(0, 24)
  const samples: FitObservationSample[] = []
  for (const row of shortlist) {
    const view = fitShipView(row.ship.shipId)
    if (!view) continue
    const loadout = fitLoadoutOf(row.ship)
    // 别的装备在这艘舰上一条命中规则都没有（也没有待定行、没有包外装备）
    const others = expectedFitBonus(
      data,
      view,
      loadout.filter((item) => item.mstId !== equipMstId),
      fitGroupState,
    )
    const soleCandidate = !others.lines.length && !others.uncovered.length
    if (!row.observed!.any && !soleCandidate) continue
    // 与预期比对：跑**整条配装**的预期（不是上面那份去掉本件的），因为面板差值本来
    // 就是整条配装的合计。口径与舰娘卷那一格同一份（`bonusPanelHtml`）：预期层按
    // 每一件自己的★落 `byStar` 的档，所以两轨比的是同一个★下的两个数。
    const whole = expectedFitBonus(data, view, loadout, fitGroupState)
    samples.push({
      rosterId: row.ship.id,
      formId: row.ship.shipId,
      name: masterShipName(row.ship.shipId),
      lv: row.ship.lv,
      stars: row.stars,
      stats: row.observed!.stats,
      soleCandidate,
      verdict: fitObservationVerdict(whole, row.observed!, FIT_PANEL_KEYS),
    })
  }
  return groupFitObservations(samples)
}

// ---- 实测观察的落盘与回看 ----
//
// 面板反推只在「这艘舰此刻正装着它」时算得出来。卸下、升星、改造之后那个读数
// 就再也拿不回来了——所以看到一次就落一次盘（账本表 fit_observations，永久保留）。
// 键里带★，**升星是新增一条**：「★2 时曾测得 火力+3」与「★6 时 火力+4」
// 是两条各自为真的观察，覆盖掉前者等于把已经做过的实验删了。
//
// 写入不新开 tick，就搭在装备卷这次已经算完的结果上；同一件装备的读数没变就
// 一个 IPC 都不发（同 commitPaneHtml 那条「输出没变就整段不动」的纪律）。
// 走单向 send，渲染路径不等往返。

const FIT_OBS_TTL_MS = 60_000
/** 缓存上限：装备卷是一件一开，超过就整体丢弃重来（不做 LRU，这里不值一套） */
const FIT_OBS_CACHE_MAX = 64

interface FitObsCache {
  rows: FitObservationRecord[] | null
  ts: number
  failed: boolean
  loading: boolean
}
const fitObsCache = new Map<number, FitObsCache>()
/** 上一次发出去的载荷签名（不含时刻）——一样就不再发 */
const fitObsSent = new Map<number, string>()

/** 一条观察的身份：(舰形态, ★多重集, 件数)。装备已经在外层键上了。 */
const fitObsIdentity = (formId: number, stars: readonly number[], count: number): string =>
  `${formId}|${stars.join('.')}|x${count}`

const ensureFitObservations = (equipMstId: number) => {
  if (!(equipMstId > 0)) return
  if (fitObsCache.size > FIT_OBS_CACHE_MAX) fitObsCache.clear()
  const state = fitObsCache.get(equipMstId) ?? { rows: null, ts: 0, failed: false, loading: false }
  fitObsCache.set(equipMstId, state)
  if (state.loading) return
  // 闸门只认时间戳，不认「手上有没有数据」——失败时 rows 仍是 null，
  // 拿它当条件等于闸门不存在，rAF + finally-render 会把它变成无限 IPC 循环
  // （同 factoryStats 上方那条注释）。失败也推时间戳，TTL 到了再重试。
  if (state.ts && Date.now() - state.ts < FIT_OBS_TTL_MS) return
  state.loading = true
  void jiIpc
    .invoke('mg:fit-observations', equipMstId)
    .then((rows: FitObservationRecord[]) => {
      state.rows = Array.isArray(rows) ? rows : []
      state.ts = Date.now()
      state.failed = false
      state.loading = false
      scheduleRender()
    })
    .catch((error: unknown) => {
      // 读失败要说读失败：空列表会被渲染成「你从没测过」，那是把故障说成事实
      console.warn('[kanso] 实测历史读取失败', error)
      state.failed = true
      state.ts = Date.now() // 墓碑
      state.loading = false
      scheduleRender()
    })
}

/** 把这次算出来的观察落盘。读数没变就一个 IPC 都不发。 */
const persistFitObservations = (equipMstId: number, rows: readonly FitObservationRow[]) => {
  if (!(equipMstId > 0) || !rows.length) return
  const records = fitObservationRecordsOf(equipMstId, rows, Date.now())
  if (!records.length) return
  // 签名不含时刻，否则每一拍都不一样，闸门等于不存在
  const signature = records
    .map(
      (one) =>
        `${fitObsIdentity(one.formId, one.stars, one.count)}|${one.sole ? 1 : 0}|` +
        Object.entries(one.stats)
          .filter(([, value]) => value)
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([key, value]) => `${key}${value}`)
          .join(','),
    )
    .sort()
    .join(';')
  if (fitObsSent.get(equipMstId) === signature) return
  fitObsSent.set(equipMstId, signature)
  // 一次最多 200 条（主进程侧同限）；这里的 rows 本来就已被截到 24 艘
  jiIpc.send('mg:fit-observation-record', records.slice(0, 200))
  // 刚写进去的那些下一次读要看得见
  fitObsCache.delete(equipMstId)
}

/** 「★2 时」这种前缀；全 0 的说「无改修时」，混★ 的把几个都列出来。 */
const fitObsWhenText = (stars: readonly number[]): string => {
  if (!stars.length) return ''
  if (stars.every((star) => !star)) return '无改修时'
  return `${fitObservationStarLabel(stars)} 时`
}

/**
 * 历史观察：现在**不是**这个★/件数配置的那些。
 *
 * 「优先当前在装」= 上面那段列的是此刻算得出来的；这里折起来的是账本里
 * 别的星级档、别的件数、以及已经卸下来的舰上留下的读数。
 */
const fitObsHistoryHtml = (equipMstId: number, live: Set<string>): string => {
  ensureFitObservations(equipMstId)
  const state = fitObsCache.get(equipMstId)
  if (state?.failed) {
    return `<div class="fb-note">实测记录读取失败</div>`
  }
  const rows = (state?.rows ?? []).filter(
    (one) => !live.has(fitObsIdentity(one.formId, one.stars, one.count)),
  )
  if (!rows.length) return ''
  const items = rows
    .slice(0, 12)
    .map((one) => {
      const cells = FIT_PANEL_KEYS.filter((key) => one.stats[key])
        .map(
          (key) =>
            `<span class="bn-cell ${one.stats[key]! > 0 ? 'up' : 'dn'}">${FIT_STAT_LABEL[key]} <b>${
              one.stats[key]! > 0 ? '+' : ''
            }${one.stats[key]}</b></span>`,
        )
        .join('')
      const aux = [one.count > 1 ? `${one.count} 件` : '', one.sole ? '只有这一件' : '整条配装合计']
        .filter(Boolean)
        .join(' · ')
      return `<div class="fb-obs">
        <span class="fb-obs-n">${elink('mstShip', one.formId, masterShipName(one.formId))}
          <span class="aux">${esc(fitObsWhenText(one.stars))}曾测得${aux ? ` · ${aux}` : ''}</span></span>
        <span class="fb-obs-v">${cells || '<i>各项皆 0</i>'}</span>
        <span class="fb-obs-k">${esc(fmtDate(one.seenAt))}</span>
      </div>`
    })
    .join('')
  const more = rows.length > 12 ? `<div class="fb-note">另有 ${rows.length - 12} 条更早记录</div>` : ''
  return `<details class="fb-obs-zero" data-keep="fb-obs-hist:${equipMstId}">
    <summary>历史实测 ${rows.length} 条（当时改修或件数与当前不同）</summary>
    ${items}${more}</details>`
}

/** 一行的舰名（并了几艘就列几艘，多到一定数量只列前几个 + 「等 N 艘」）。 */
const fitObsShipsHtml = (row: FitObservationRow): string => {
  const head = row.ships.slice(0, 3)
  const names = head
    .map((one) => elink('mstShip', one.formId, one.name))
    .join('、')
  const rest = row.ships.length - head.length
  return `${names}${rest > 0 ? ` <span class="aux">等 ${row.ships.length} 艘</span>` : ''}`
}

const fitObsCellsHtml = (row: FitObservationRow): string =>
  FIT_PANEL_KEYS.filter((key) => row.stats[key])
    .map(
      (key) =>
        `<span class="bn-cell ${row.stats[key]! > 0 ? 'up' : 'dn'}">${FIT_STAT_LABEL[key]} <b>${
          row.stats[key]! > 0 ? '+' : ''
        }${row.stats[key]}</b></span>`,
    )
    .join('')

const fitObsRowHtml = (row: FitObservationRow): string => {
  const lv = row.ships[0]?.lv ?? 0
  const aux = [
    row.ships.length === 1 ? `Lv${lv}` : '',
    row.count > 1 ? `${row.count} 件` : '',
    // 显示的★永远是**实际观察时**的那几个，混★ 就把它们都列出来
    row.starLabel && row.stars.some((star) => star > 0) ? row.starLabel : '',
    row.mixedStar ? '混★' : '',
  ].filter(Boolean)
  return `<div class="fb-obs${row.mixedStar ? ' mixed' : ''}">
    <span class="fb-obs-n">${fitObsShipsHtml(row)}${
      aux.length ? ` <span class="aux">${aux.join(' · ')}</span>` : ''
    }</span>
    <span class="fb-obs-v">${fitObsCellsHtml(row) || '<i>各项皆 0</i>'}</span>
    <span class="fb-obs-k${row.sole ? ' sole' : ''}"${
      row.sole
        ? ' title="差值就是这一件（含改修★）的加成"'
        : row.mixedStar
          ? ' title="多件改修等级不同 · 无法归入单一星级档 · 暂不直读"'
          : ''
    }>${row.sole ? '只有这一件' : row.mixedStar ? '混★ · 不可直读' : '整条配装合计'}</span>
  </div>`
}

const equipObservedHtml = (equipMstId: number): string => {
  const rows = equipObservedRows(equipMstId)
  // 落盘搭在这次已经算完的结果上（不新开 tick），读数没变就一个 IPC 都不发
  persistFitObservations(equipMstId, rows)
  const live = new Set(
    rows.flatMap((row) => row.ships.map((one) => fitObsIdentity(one.formId, row.stars, row.count))),
  )
  const history = fitObsHistoryHtml(equipMstId, live)
  if (!rows.length) {
    return `<div class="fb-track"><div class="fb-track-h">本地实测</div>
      ${
        history || '<div class="fb-empty">暂无舰娘装备当前装备</div>'
      }</div>`
  }
  // 两种「不值得一艘一行」的折起来，折叠用仓库现成的 <details data-keep>
  //（展开态跨重渲存活），**不加内嵌滚动条**：
  //
  //   · **读出来了、且与预期逐项相符**（2026-08-28 用户点名）——上面预期值那几行
  //     已经把数说了，实测再逐艘复述一遍只是把有出入的那几行挤下去。折起来仍点得开。
  //   · **各项皆 0** —— 占的是「没读出东西」这一条信息（原样保留的那一折）。
  //
  // 全 0 的行**不并进「相符」那一折**：两边都是 0 固然也算相符，但那是「什么都没发生」，
  // 与「读出了加成、和资料对上了」不是同一件事，混在一个数字里会把后者说胖。
  //
  // 反向的洞要堵住：**预期非 0 而面板全 0 也是不符**，那种行绝不能进「各项皆 0」
  // 那一折——它恰恰是这一段最该被看见的东西。所以两折都先把 `mismatch` 摘出去。
  const agreed = rows.filter((row) => row.verdict === 'match' && !row.allZero)
  const zero = rows.filter((row) => row.verdict !== 'mismatch' && row.allZero)
  const shown = rows
    .filter((row) => row.verdict === 'mismatch' || (row.verdict === 'unknown' && !row.allZero))
    .slice(0, 6)
  const shipsIn = (list: FitObservationRow[]) =>
    list.reduce((sum, row) => sum + row.ships.length, 0)
  const list = shown.map(fitObsRowHtml).join('')
  const agreedFold = agreed.length
    ? `<details class="fb-obs-zero" data-keep="fb-obs-fit:${equipMstId}">
        <summary>${shipsIn(agreed)} 艘与预期相符</summary>${agreed.map(fitObsRowHtml).join('')}</details>`
    : ''
  const folded = zero.length
    ? `<details class="fb-obs-zero" data-keep="fb-obs-zero:${equipMstId}">
        <summary>另 ${shipsIn(zero)} 艘各项皆 0</summary>${zero.map(fitObsRowHtml).join('')}</details>`
    : ''
  return `<div class="fb-track"><div class="fb-track-h">本地实测</div>${list}${agreedFold}${folded}${history}
  </div>`
}

const equipFitHtml = (equipMstId: number): string => {
  const data = fitLode?.data as FitBonusData | undefined
  if (!data) return ''
  const entry = data.equips[`${equipMstId}`]
  if (!entry) {
    // 「包里没有」要分两种说法：覆盖范围之内 = 上游看过了、它就是没加成；
    // 覆盖范围之外 = 上游还没收录，这时实测那一轨才是唯一的信息来源。
    const uncovered = fitPackUncovered(data, equipMstId)
    return `<div class="sec"><div class="sec-h">装备加成<span class="aux">${
      uncovered ? '暂无预期数据' : '无加成记录'
    }</span></div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.7">
        ${
          uncovered
            ? `加成表尚未收录当前装备 · 上游最新编号 ${fitPackCoverageMax(data)}`
            : '加成表暂无当前装备加成记录'
        }
      </div>
      ${equipObservedHtml(equipMstId)}
    </div>`
  }
  const rows = entry.rules
    .slice(0, 24)
    .map(
      (rule) => `<div class="fb-row${rule.correction ? ' fixed' : ''}">
        <span class="fb-cond">${fitCondHtml(rule)}${
          rule.correction ? ` <em title="${esc(rule.correction)}">第一方修正</em>` : ''
        }</span>
        <span class="fb-vals">${fitGainHtml(rule.gain)}</span>
        <span class="fb-mul">${esc(fitStackText(rule))}</span>
        ${
          rule.setTotal
            ? `<div class="fb-set">整套满足时合计 ${esc(fitStatsText(rule.setTotal))}</div>`
            : ''
        }
      </div>`,
    )
    .join('')
  return `<div class="sec"><div class="sec-h">装备加成<span class="aux">预期值</span></div>
    ${rows}
    <div class="q-foot">${fitLode ? `${lodeCreditMark(fitLode.meta)} ` : ''}以本地装备后面板为准</div>
    ${foldedNote(
      '读数口径',
      '按件数：每件分别加成 · 单次：组合成立时加成一次 · 分档值为累计值',
    )}
    ${equipObservedHtml(equipMstId)}
  </div>`
}

// ---- 装备加成：哪些装备对这艘舰有加成（01 稿「装备加成」Tab 的上半）----
//
// 图鉴的「装备加成」问的是**这艘舰本身**：哪些装备装在她身上有加成。
//（「你这一艘现在装了什么」是铨的舰娘列表该答的，放这儿重复且没用。）
// 反查维度是新 schema 的三个槽：精确形态 / 舰级 / 舰种（外加「全部舰船」）。
// **没有「整条改造链」这一档**——上游那张表逐形态列举，链首≠全形态（实证见第一批词表顶部）；
// 也没有国籍档——本源把海外舰逐条列成形态与舰级，不用国籍维度。
const shipFitHtml = (mstId: number): string => {
  const data = fitLode?.data as FitBonusData | undefined
  const ship = fitShipView(mstId)
  if (!data || !ship) {
    return `<div style="font-size:11.5px;color:var(--dim)">装备加成包尚未加载</div>`
  }
  const hits = fitEquipsForShip(data, ship)
  if (!hits.length) {
    // 空态常驻只说空态本身；读数前提收进悬停。
    return `<div style="font-size:11.5px;color:var(--dim);line-height:1.8"
      title="以本地装备后面板为准">
      加成表暂无本舰条目</div>`
  }
  const rows = hits
    .slice(0, 40)
    .map(({ entry, rules, topLevel }) => {
      const detail = rules
        .slice(0, 4)
        .map(
          ({ rule }) =>
            `<span class="sf-v">${fitGainHtml(rule.gain)}</span>` +
            `<span class="sf-c">${fitCondHtml(rule)}${
              rule.correction ? ` · <em title="${esc(rule.correction)}">第一方修正</em>` : ''
            }</span>`,
        )
        .join('')
      return `<div class="sf-row">
        <span class="sf-n">${equipVisualLink(entry.id)}</span>
        <span class="sf-via">${esc(FIT_VIA_LABEL[topLevel] ?? '—')}</span>
        <span class="sf-d">${detail}</span>
      </div>`
    })
    .join('')
  return `<div class="sf-list">${rows}</div>
    <div class="q-foot">
      共 <b>${hits.length}</b> 件装备对本舰有加成${hits.length > 40 ? '（显示前 40）' : ''}
      ${fitLode ? lodeCreditMark(fitLode.meta, '匹配范围：当前形态 / 舰级 / 舰种 / 全部舰船') : ''}
    </div>`
}

const bonusPanelHtml = (mstId: number): string => {
  // 索引现成的（instanceIndex 按 mg.ships 的引用失效，命中 O(1)）——
  // 这里原是最后一处 Object.values(mg.ships).filter 全表扫。
  // 拿到的数组归索引所有，下面排序前已经复制了一份。
  const insts = instancesOfMst(mstId)
  if (!insts.length) {
    return `<div style="font-size:11.5px;color:var(--dim);line-height:1.8">未持有该形态</div>`
  }
  // 没装备的实例反推不出任何东西（差值必然全 0，摆四个 0 等于没说）。
  // 按「装备数 → 等级」排序，把有料的排前面；一艘都没装备时直接说明白。
  const equipCountOf = (s: (typeof insts)[number]) =>
    [...s.slot, s.slotEx].filter((id) => id > 0).length
  const sorted = [...insts].sort((a, b) => equipCountOf(b) - equipCountOf(a) || b.lv - a.lv)
  if (!equipCountOf(sorted[0])) {
    return `<div style="font-size:11.5px;color:var(--dim);line-height:1.8">当前持有 ${insts.length} 艘 · 均无装备</div>`
  }
  const data = fitLode?.data as FitBonusData | undefined
  const view = fitShipView(mstId)
  const rows = sorted
    .filter((s) => equipCountOf(s) > 0)
    .slice(0, 6)
    .map((ship) => {
      const observed = panelBonusOf(ship)
      if (!observed) return ''
      const equips = shipEquipInstances(ship)
      // 预期层把 byStar 的档一并算进去——不然改修★带来的那部分会被误报成偏差。
      // 档位是**按每一件自己的实际★**取的：`fitLoadoutOf` 逐件带着 `star`，
      // 求值器 `stepForStar` 按它落档，而分档写的是**该档的总值**（不是在前一档上再加）。
      // 所以两轨比的是同一个★下的两个数，不会出现「拿 ★0 的预期去比 ★max 的实测」。
      const expected = view
        ? expectedFitBonus(data, view, fitLoadoutOf(ship), fitGroupState)
        : null
      const track = fitTrackRows(expected?.stats ?? {}, observed)
      const shown = track.filter((row) => row.expected !== 0 || row.observed !== 0)
      const gapCount = shown.filter((row) => row.diff !== 0).length
      const cell = (label: string, value: number, cls: string, gap: boolean) =>
        `<span class="bn-cell ${cls}${gap ? ' gap' : ''}">${label} <b>${
          value > 0 ? '+' : ''
        }${value}</b></span>`
      const observedCells = shown
        .map((row) =>
          cell(
            row.label,
            row.observed,
            row.observed > 0 ? 'up' : row.observed < 0 ? 'dn' : '',
            row.diff !== 0,
          ),
        )
        .join('')
      const expectedCells = shown.map((row) => cell(row.label, row.expected, '', row.diff !== 0)).join('')
      const notes: string[] = []
      // 被闸门挡下的成长项：一项凭空消失，读的人会以为「它没有加成」——如实说
      if (observed.skipped.length) {
        const bad = observed.skipped.filter((one) => one.gate === 'fail')
        const none = observed.skipped.filter((one) => one.gate !== 'fail')
        if (bad.length) {
          notes.push(
            `${bad.map((one) => one.label).join('、')} 的成长值与本地面板不一致 · 对应项暂不显示`,
          )
        }
        if (none.length) {
          notes.push(
            `${none.map((one) => one.label).join('、')} 缺少成长端点数据 · 对应项无法推定`,
          )
        }
      }
      if (observed.unverified.length) {
        notes.push(
          `${observed.unverified
            .map((key) => FIT_STAT_LABEL[key])
            .join('、')} 的成长端点尚未标定 · 读数为推定`,
        )
      }
      if (expected?.uncovered.length) {
        notes.push(
          `${expected.uncovered.map((id) => equipVisualLink(id)).join('、')} 尚未收录于加成表 · 仅显示本地实测加成`,
        )
      }
      const pending = (expected?.lines ?? []).filter((line) => line.state === 'pending')
      if (pending.length) {
        const groups = [...new Set(pending.flatMap((line) => line.pendingGroups ?? []))]
        notes.push(
          `${pending.length} 条协同加成前提无法判定 · 需${groups
            .map((key) => esc(fitGroupLabel(key)))
            .join('、')}），预期值是下限`,
        )
      }
      const area = (expected?.lines ?? []).filter((line) => line.state === 'area')
      if (area.length) notes.push('按出击海域生效的加成未计入预期')
      // 装备名做成实体链接——这里本来就是「哪件装备带来的加成」，点进去看它的加成表最自然
      const eqNames = equips.length
        ? equips
            .map(
              (e) =>
                `${equipVisualLink(e.mstId)}${
                  e.level ? `<span style="color:var(--gold)">★${e.level}</span>` : ''
                }`,
            )
            .join('、')
        : '无装备'
      return `<div class="bn-row">
        <div class="bn-h">Lv ${ship.lv}${
          observed.pure ? '<span class="bn-pure">全★0</span>' : '<span class="bn-warn">含改修★</span>'
        }${gapCount ? `<span class="bn-gap-mark">${gapCount} 项不一致 · 采用实测值</span>` : ''}</div>
        <div class="bn-line"><span class="bn-k">本地实测</span><span class="bn-cells">${
          observedCells || '<i>各项皆 0</i>'
        }</span></div>
        <div class="bn-line"><span class="bn-k dim">预期值</span><span class="bn-cells">${
          expected ? expectedCells || '<i>各项皆 0</i>' : '<i>加成表未加载</i>'
        }</span></div>
        ${notes.length ? `<div class="bn-aside">${notes.join('<br>')}</div>` : ''}
        <div class="bn-eq">${eqNames}</div>
      </div>`
    })
    .join('')
  return `<div class="bn-list">${rows}</div>
    <div class="q-foot">
      两轨不一致 · 采用实测值
      <span class="credit-mark" title="回避/对潜/索敌按成长端点与等级插值；主炮适重与命中不进面板，无法推定">口径</span>
    </div>`
}

// 大图浮层：单例挂 body，点任意处/Esc 关闭
let lightbox: HTMLElement | null = null
const showLightbox = (url: string) => {
  if (!lightbox) {
    lightbox = document.createElement('div')
    lightbox.id = 'cg-lightbox'
    lightbox.innerHTML = '<img alt="">'
    lightbox.addEventListener('click', () => lightbox!.classList.remove('show'))
    document.body.appendChild(lightbox)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') lightbox?.classList.remove('show')
    })
  }
  lightbox.querySelector('img')!.setAttribute('src', url)
  lightbox.classList.add('show')
}

// 立绘面板（01 稿）：列出该形态在本地缓存里实际存在的所有图。
// 缓存是游戏自己下载的——看过才有，没看过不去补拉（被动只读）。
const shipGraphLayoutHtml = (mstId: number): string => {
  const layout = shipGraphLayout(mstId)
  if (!layout) return ''
  const labels: Record<string, string> = {
    api_battle_n: '战斗', api_battle_d: '战斗·中破',
    api_boko_n: '母港', api_boko_d: '母港·中破',
    api_kaisyu_n: '强化', api_kaisyu_d: '强化·中破',
    api_kaizo_n: '改装', api_kaizo_d: '改装·中破',
    api_map_n: '海图', api_map_d: '海图·中破',
    api_ensyuf_n: '演习·我方', api_ensyuf_d: '演习·我方中破',
    api_ensyue_n: '演习·敌方',
    api_weda: '婚礼A', api_wedb: '婚礼B', api_wedc: '婚礼C', api_wedd: '婚礼D',
    api_pa: '母港演出A', api_pab: '母港演出B',
  }
  const rows = Object.entries(layout)
    .map(
      ([key, [x, y]]) =>
        `<span><small>${esc(labels[key] ?? key.replace(/^api_/, ''))}</small><b>${x}, ${y}</b></span>`,
    )
    .join('')
  return `<details class="shipgraph-layout">
    <summary>官方构图锚点 · ${Object.keys(layout).length} 组</summary>
    <div>${rows}</div>
  </details>`
}

// ---- 立绘档案：静默留存，展示面只有画廊尾巴 ----
//
// 2026-08-23 用户拍板把**收藏格 UI 整层拔掉**（原话「这个部分，包括深海那边也完全
// 拔掉，要不然总会出一些奇奇怪怪的bug，就只做立绘侧的保留自扩展缓存的权利就好」）。
// 立绘于是从「收藏玩法」退回「静默权利」：
//  · **存储机制一格没动**——捕获、独立目录、急救保住名单、版本透传照旧；
//  · 界面上不再有三态格、图种分区、留存计数、插入式扩展格这些东西；
//  · 唯一的展示面是**画廊尾巴**：官方现行那几张之后续排档案里的非现行版本
//    （原话「都显示在图鉴里面，接着放到这个角色『原版所有皮肤图』的下面接着展示」）。
//
// ---- 一条不能含糊的边界照旧成立：季节立绘与常服**共用同一个地址** ----
// 官方当季把那个地址上的图换成季节版、过季换回（`?version=` 跟着变）。
// 所以「哪一份实物属于哪一季」**无从确证**。档案卡因此只说查得实的三件事：
// 哪个图种、哪一月留存、版本几——**不声称某一份是 2015 年的圣诞版**。

// 图种的显示名单一出处在 renderer/kcs-image 的 `cgTypeLabel`：
// 这里、衣装格、档案旧版卡查的是同一张表，各写一份必然出现同一张图两个叫法。

/**
 * 图鉴衣装的格子：本体现行图组之后、档案旧版卡之前的那一段。
 *
 * ---- 为什么它是独立一段（2026-08-31 用户实机报）----
 * 游戏图鉴里的衣装切替取的是**独立构图编号**（5xxx/6xxx），主数据 api_mst_ship 里
 * 没有这些号。档案按路径里的四位号记归属，于是村雨改二的四套衣装被记在
 * 5310/5403/5479/6024 这几个幽灵编号下，按舰去查一张都查不到。
 * 归属由 picture_book 报文学到（判据见 shared/ship-costume），这里按学到的归属摆。
 *
 * 摆哪些图种由 `availableCostumeImages` 定：**不照搬本体那张表**——衣装只有
 * card / character_full / character_up 三族，按本体表摆会稳定摆出一排 404。
 * 取图走与本体同一条回退链（本地缓存 → 档案实物 → 远端，受钥里那个开关管）。
 * 玩家没翻过图鉴的舰在这里就是空的：归属学不到，如实一格不摆。
 */
const costumeCellsHtml = (mstId: number): { html: string; sets: number; paths: string[] } => {
  const paths: string[] = []
  let sets = 0
  let html = ''
  for (const graphId of shipCostumeGraphIds(mstId)) {
    const images = availableCostumeImages(graphId)
    if (!images.length) continue
    sets += 1
    // 版本号取**这套衣装自己的**（api_mst_shipgraph 里 5xxx 也有条目，实测村雨改二
    // 那四套是 61/61/62/61）。透传本体的版号会让入档条目的归因串到另一张图上。
    const version = shipImageVersionOf(graphId)
    for (const im of images) {
      paths.push(im.pathname)
      const caption = `${im.label} · 衣装 #${graphId}${version ? ` · 版本 ${version}` : ''}`
      html += `<figure class="cg-item${im.big ? ' big' : ''}"
          data-cg="${esc(im.url)}" data-cg-path="${esc(im.pathname)}"
          data-cg-version="${esc(version)}" data-cg-cell hidden>
        <img src="${esc(im.url)}" alt="${esc(im.label)}" data-cg-image>
        <figcaption>${esc(caption)}</figcaption>
      </figure>`
    }
  }
  return { html, sets, paths }
}

/**
 * 画廊尾接的「档案旧版卡」——**这是立绘档案唯一的展示面**。
 *
 * 摆什么由 shared/art-archive-plan 的 `legacyArchivedArt` 判（纯函数，护栏能真跑）：
 * 官方现在放着的那几份不重复摆，同一份字节也不摆两次。档案是空的就一格都不多，
 * 这一页与拔掉收藏格之前逐字节一致。
 *
 * 图一律取**档案里那一份**（`archivedArtUrl` 给的是 `file://`，零网络）；
 * 取不出地址、或者读不出来的那几份由 `wireCgImages` 的 error 分支摘掉，不摆破图。
 * 卡上不挂 `data-cg-path`：那条身份是给「显示即入档」用的，档案里这一份已经在档案里了。
 */
const archivedArtCellsHtml = (mstId: number, displayed: readonly string[]): string => {
  if (!artArchiveReady()) return ''
  const legacy = legacyArchivedArt(archivedArtEntriesOfShip(mstId), displayed)
  if (!legacy.length) return ''
  return legacy
    .map((entry) => ({ entry, url: archivedArtUrl(entry) }))
    .filter((cell): cell is { entry: ArtArchiveEntry; url: string } => Boolean(cell.url))
    .map(({ entry, url }) => {
      const name = cgTypeLabel(entry.type)
      // 日期取**首次留存**那一天，精度只到月：档案记的是「这一份什么时候进来的」，
      // 精确到日会读成「官方那天换的图」，而那件事我们并不知道。
      const kept = fmtDate(entry.firstSeen).slice(0, 7)
      const caption = `${name} · 档案 ${kept} 留存${entry.version ? ` · 版本 ${entry.version}` : ''}`
      // 横幅是界面零件尺寸，其余图种都是立绘级——大图独占整行（同官方那几张的排法）
      const big = !entry.type.startsWith('banner')
      return `<figure class="cg-item${big ? ' big' : ''}" data-cg="${esc(url)}" data-cg-cell hidden>
        <img src="${esc(url)}" alt="${esc(name)}" data-cg-image>
        <figcaption>${esc(caption)}</figcaption>
      </figure>`
    })
    .join('')
}

const cgPanelHtml = (mstId: number): string => {
  const imgs = availableShipImages(mstId)
  const costumes = costumeCellsHtml(mstId)
  // 画廊尾巴：档案里的非现行版本。现行摆出来的那些路径（含衣装）交给它去重，
  // 档案空就是空字符串
  const archived = archivedArtCellsHtml(mstId, [
    ...imgs.map((im) => im.pathname),
    ...costumes.paths,
  ])
  if (!imgs.length) {
    // 本地没有就**只出一句说明**。2026-08-22 之前这里还挂着一个「点了才请求」的
    // 社区图标源（tsunkit）作降级补位——整条退役了：发行产物的对外请求只许指向
    // 游戏自己的服务器，第三方服务零请求，理由见 renderer/kcs-image 那一段注释。
    // 缺格不写抱怨文案，也不摆一个点不出东西的按钮。
    // 档案里若留着旧版，那就是这一页现在唯一看得到的图——照样摆出来（零网络）。
    return `<div style="font-size:11.5px;color:var(--dim);line-height:1.8">
      在游戏中打开本舰图鉴页
    </div>
    ${
      costumes.html || archived
        ? `<div class="cg-grid" data-cg-grid>${costumes.html}${archived}</div>`
        : ''
    }
    ${shipGraphLayoutHtml(mstId)}`
  }
  const cells = imgs
    .map(
      // 同深海侧：hidden 起手，加载完才现形，不先摆空框
      // `data-cg-path` 是这张图在档案里的身份：显示成功那一下拿它入档
      // （「看见了」与「点亮了」从此是同一件事，见 kcs-image 的 noteShipArtDisplayed）
      // `data-cg-version` 是主数据里这个形态的**现行版号**。本机缓存命中时地址是
      // `file://`，`?version=` 从地址里提不出来，而版本是档案条目的归因线索之一，
      // 所以由渲染这一侧透传（见 captureCell → kcs-image 的 noteShipArtDisplayed）。
      (im) => `<figure class="cg-item${isBigShipImg(im.type, im.damaged) ? ' big' : ''}"
          data-cg="${esc(im.url)}" data-cg-path="${esc(im.pathname)}"
          data-cg-version="${esc(shipImageVersionOf(mstId))}" data-cg-cell hidden>
        <img src="${esc(im.url)}" alt="${esc(im.label)}" data-cg-image>
        <figcaption>${esc(im.label)}</figcaption>
      </figure>`,
    )
    .join('')
  // 缺哪些如实列出来：只看到小图通常不是坏了，而是全身立绘还没被游戏缓存过
  const missing = missingShipImages(mstId)
  const missingBig = missing.filter((m) => m.big)
  // 与深海/装备两处同款：格子全 404 被摘掉后，靠这两个标记把「一张都取不到」
  // 说出来（wireCgImages 的 settle 按属性找），否则只剩一片空网格
  return `<div class="cg-grid" data-cg-grid>${cells}${costumes.html}${archived}</div>
    <div class="af-empty ship-cg-empty" data-cg-empty hidden>图片读取失败 · 在游戏中打开本舰图鉴页</div>
    ${
      missingBig.length
        ? (() => {
            const rs = remoteArtState()
            const how =
              rs.enabled && rs.host
                ? ''
                : rs.enabled
                  ? '游戏服务器尚未识别 · 登录游戏后同步'
                  : '远程取图已关闭 · 仅显示本机已有图片'
            // 「缓存」一词 2026-08-31 退场：本机已有的字节现在有缓存与立绘档案两处，
            // 档案里那份显示得好好的时候还说它「没落到缓存」，屏幕上就摆着一句错话。
            return `<div class="q-foot" style="color:var(--dim)">
              <b>${missingBig.map((m) => esc(m.label)).join('、')}</b> 本机缺${
                how ? `·${how}` : ''
              }</div>`
          })()
        : ''
    }
    ${shipGraphLayoutHtml(mstId)}
    <div class="q-foot">已有 ${imgs.length + costumes.paths.length} 张${missing.length ? ` · 本机缺 ${missing.length} 张` : ''} · 单击查看大图${
        costumes.sets ? ` · 标「衣装 #」的是图鉴里的 ${costumes.sets} 套衣装切替` : ''
      }${
        archived
          ? ' ·「档案 … 留存」来自立绘档案 · 非当前官方版本'
          : ''
      }</div>`
}

// ---- 装备卷 ----

/**
 * 一件装备在**筛选/分组面**上的类别号。
 *
 * 正常就是 `api_type[2]`；小口径主炮里图标是高角的那一族单独成类——游戏的装备
 * 筛选把小口径主炮与高角炮分开列，只按种别分会把两族混成一栏（2026-08-25 用户实机报）。
 * 判据在 renderer/equip-category，与 shared/ship-special-attack 判对空カットイン的
 * `isHighAngleMount = iconIs(16)` 同源。
 */
const equipCategoryOf = (e: any): number =>
  Array.isArray(e?.api_type)
    ? effectiveEquipCategory(Number(e.api_type[2]) || 0, Number(e.api_type[3]) || 0)
    : 0

const equipMatches = (e: any) => {
  const cat = Array.isArray(e.api_type) ? e.api_type[2] : 0
  const t0 = Array.isArray(e.api_type) ? e.api_type[0] : -1
  // 精确类别按**有效类别**判（小口径主炮里的高角炮单独成类）；
  // chip 那一层仍按种别——高角炮在分组意义上照旧是主炮，别顺手改坏
  if (equipState.typeFilter && equipCategoryOf(e) !== equipState.typeFilter) return false
  if (!equipChipMatches(equipState.chip, cat, t0)) return false
  if (equipState.search) {
    // searchFold:全半角/重音同折(2026-08-12 实锤 Modèle 1927/全角斜线搜不到)
    const q = searchFold(equipState.search)
    return (
      searchFold(e.api_name).includes(q) ||
      searchFold(entityNamePlain('equip', e.api_id, e.api_name)).includes(q)
    )
  }
  return true
}

interface TodayImprovementRow {
  equipId: number
  variant: number
  type2: number // 装备类别，用于分组
  ready: boolean
  helperReady: boolean
  missing: string[]
  html: string
}

// 改修素材的口径与仓库卷一致：**闲置且未锁**才吞得进改修工厂。
// 只排锁不排「已装备」会把挂在舰上/陆航里的同款算进素材，「现在可做」名不副实。
// 判据本体在 shared/equipped-slots（仓库卷的 holder 表用的是同一份）；这里只加一层缓存。
let equippedInstIdsCache: Set<number> | null = null
const equippedInstIds = (): Set<number> => {
  if (equippedInstIdsCache) return equippedInstIdsCache
  const ids = equippedSlotIds(Object.values(mg.ships), mg.airBases)
  equippedInstIdsCache = ids
  return ids
}
const invalidateEquippedInstIds = () => {
  equippedInstIdsCache = null
}

/**
 * 在籍舰现在够不够得着：远征在途 / 出击在外 / 进了修理渠。
 *
 * 「今日改修」的展开层拿它数「我这几件同款有几件跟着舰出门了」——手上有五件、
 * 三件挂在出击的队伍上，那「空闲 2」才是今天真能动的数。
 *
 * **入渠这一格的口径还没实测**：修理中的舰不能换装是确定的，她身上的装备能不能
 * 被别的舰抽走当空闲装备，没在游戏里试过。先按「够不着」记，界面上标明这一格
 * 没实测——不替游戏下结论。
 */
type ShipAwayKind = 'mission' | 'sortie' | 'ndock'
const shipAwayIndex = (): Map<number, ShipAwayKind> => {
  const away = new Map<number, ShipAwayKind>()
  const sortieDeck = mg.sortie?.active && !mg.sortie.practice ? mg.sortie.deckId : 0
  for (const deck of mg.decks) {
    // 联合出击时第 2 舰队随第 1 舰队一起在海上，但 sortie.deckId 恒为 1——只对
    // deckId 的话她身上那几件装备会被算成「在手边」，「空闲 N」把出海的也数了进去。
    const onSortie = deck.id === sortieDeck || combinedEscortState(deck.id) === 'sortie'
    const kind: ShipAwayKind | null =
      deck.mission?.[0] > 0 ? 'mission' : onSortie ? 'sortie' : null
    if (!kind) continue
    for (const rosterId of deck.ships) if (rosterId > 0) away.set(rosterId, kind)
  }
  for (const dock of mg.ndocks) if (dock.shipId > 0) away.set(dock.shipId, 'ndock')
  return away
}

/** 装备实例 → 挂着它的在籍舰 id（含补强增设格）。 */
const equipHolderShipIndex = (): Map<number, number> => {
  const holder = new Map<number, number>()
  for (const ship of Object.values(mg.ships)) {
    for (const slotId of [...ship.slot, ship.slotEx]) if (slotId > 0) holder.set(slotId, ship.id)
  }
  return holder
}

const unlockedEquipCount = (mstId: number): number => {
  const equipped = equippedInstIds()
  // 走现成的按 mst 索引，别在这里扫全表：「今日改修」一屏要问上百次
  return equipInstancesOf(mstId).filter(
    ([id, item]) => !item.locked && !equipped.has(parseInt(id, 10)),
  ).length
}

const improvementMaterialLink = (index: number, label: string): string =>
  elinkHtml('material', index, entityTermHtml('material', index, label))

/**
 * 改修卡上那一枚置信角标。
 *
 * 只有偏离「照资料整理」那一档的才挂——多数装备是那一档，逐件挂等于没挂。
 * 说的是**这个数有多硬**，不是它抄自谁：来源署名集中在钥的资料页与 NOTICE，
 * 不在每张卡下面散布（纪律七之三）。
 */
const improveTierMark = (improvement: EquipUpgradeRow['improvement']): string => {
  switch (improveEntryTier(improvement)) {
    case 'rule':
      return ' <span class="credit-mark" title="推定依据：可改修即支持 ★0→★max 全程；消耗取同装备同档方案">补档</span>'
    case 'measured':
      return ' <span class="credit-mark" title="当前装备含本地实测改修方案">实测</span>'
    case 'official':
      return ' <span class="credit-mark" title="这一件有格子有官方公告佐证">官方</span>'
    default:
      return ''
  }
}

const improvementHelperListHtml = (
  shipIds: number[],
  previewCount = 5,
  prefix = '二号舰需',
): string => {
  const ids = [...new Set(shipIds.map(Number).filter((id) => id > 0))]
  if (!ids.length) return '无需指定二号舰'
  const linkOf = (id: number) => {
    const ship = friendlyShips.get(id)
    return ship ? elink('mstShip', id, ship.api_name) : `<span class="dim">舰娘 #${id}</span>`
  }
  const all = ids.map(linkOf).join('、')
  // 改修卡的 who 段自己带标签，前缀传空——这里不能留出那个空格，
  // 否则舰名会顶着一格缩进
  const lead = prefix ? `${prefix} ` : ''
  if (ids.length <= previewCount) return `${lead}${all}`
  const preview = ids.slice(0, previewCount).map(linkOf).join('、')
  return `<details class="improve-helper-more">
    <summary>${lead}${preview} 等 ${ids.length} 艘</summary>
    <div><span>全部候选</span>${all}</div>
  </details>`
}

const todayImprovementRows = (): TodayImprovementRow[] => {
  const day = jstDayOfWeek()
  const firstDeck = mg.decks.find((deck) => deck.id === 1) ?? mg.decks[0]
  const flagshipRosterId = firstDeck?.ships?.[0] ?? -1
  const flagship = flagshipRosterId > 0 ? mg.ships[flagshipRosterId] : null
  const flagshipName = flagship ? `${friendlyShips.get(flagship.shipId)?.api_name ?? ''}` : ''
  const akashiReady = /^明石(?:改)?$/.test(flagshipName)
  const secondRosterId = firstDeck?.ships?.[1] ?? -1
  const second = secondRosterId > 0 ? mg.ships[secondRosterId] : null
  // 展开层要数「有几件跟着舰出门了」——两张索引各建一次，别在几百条方案里逐条重扫在籍表
  const away = shipAwayIndex()
  const holderShip = equipHolderShipIndex()
  const equippedIds = equippedInstIds()
  const rows: TodayImprovementRow[] = []

  for (const eo of eoByEquip.values()) {
    const equip = friendlyEquips.get(eo.eq_id)
    if (!equip || !equipMatches(equip)) continue
    // 372 条方案 × 一次全表 entries(mg.slotitems) 是这一页最贵的一笔白工；
    // equipInstanceIndex 已按 mstId 建好索引（随 mg.slotitems 身份失效）
    const targets = equipInstancesOf(eo.eq_id).map(([id, item]) => ({ id: parseInt(id, 10), ...item }))
    if (!targets.length) continue

    for (const [variant, imp] of (eo.improvement ?? []).entries()) {
      const helpers = Array.isArray(imp.helpers) ? imp.helpers : []
      // 只在 helper 舰 ID 与星期同时命中时才判可改修(沿 EO 的老口径)。
      // helpers 为空的少数条目代表日程资料缺失，不能擅自解释成“全周/任意二号舰”。
      // wikiwiki 改修表把「二番舰不要」写成 ship_ids:[-1]:命中当天后经 >0 过滤,
      // allowedHelpers 变空集 → helperReady 直接成立,正好是「不限二号舰」的语义。
      const todayHelpers = helpers.filter(
        (helper: any) => Array.isArray(helper.days) && helper.days.includes(day),
      )
      if (!todayHelpers.length) continue
      const allowedHelpers = new Set<number>(
        todayHelpers.flatMap((helper: any) =>
          Array.isArray(helper.ship_ids) ? helper.ship_ids.map(Number).filter((id: number) => id > 0) : [],
        ),
      )
      const helperReady = allowedHelpers.size === 0 || (!!second && allowedHelpers.has(second.shipId))

      const candidates = targets.flatMap((target) => {
        let stageKey: 'p1' | 'p2' | 'conv'
        let stageLabel: string
        if (target.level < 6) {
          stageKey = 'p1'
          stageLabel = `★${target.level} → ★${target.level + 1}`
        } else if (target.level < 10) {
          stageKey = 'p2'
          stageLabel = `★${target.level} → ★${target.level + 1}`
        } else if (imp.convert) {
          stageKey = 'conv'
          stageLabel = '★10 → 更新'
        } else {
          return []
        }
        const stage = imp.costs?.[stageKey]
        if (!stage) return []
        const missing: string[] = []
        const resources = mg.materials
        if (!resources) {
          missing.push('资源未同步')
        } else {
          const base = [
            [0, Number(imp.costs?.fuel ?? 0), '燃料'],
            [1, Number(imp.costs?.ammo ?? 0), '弹药'],
            [2, Number(imp.costs?.steel ?? 0), '钢材'],
            [3, Number(imp.costs?.baux ?? 0), '铝土'],
            [6, Number(stage.devmats ?? 0), '开发资材'],
            [7, Number(stage.screws ?? 0), '改修资材'],
          ] as const
          for (const [idx, need, label] of base) {
            if ((resources[idx] ?? 0) < need) missing.push(`${label}缺 ${need - (resources[idx] ?? 0)}`)
          }
        }
        for (const need of stage.equips ?? []) {
          const count = unlockedEquipCount(Number(need.id))
          // 目标装备若未锁且与素材同型，必须留出当前这一件，不能把它同时算进素材。
          const usable = count - (Number(need.id) === eo.eq_id && !target.locked ? 1 : 0)
          if (usable < Number(need.eq_count)) {
            missing.push(`${entityNamePlain('equip', Number(need.id), friendlyEquips.get(Number(need.id))?.api_name ?? `装备 #${need.id}`)}缺 ${Number(need.eq_count) - Math.max(0, usable)}`)
          }
        }
        for (const need of stage.consumable ?? []) {
          const count = mg.useitems[Number(need.id)] ?? 0
          if (count < Number(need.eq_count)) {
            missing.push(`${entityNamePlain('item', Number(need.id), useitemMst.get(Number(need.id))?.api_name ?? `道具 #${need.id}`)}缺 ${Number(need.eq_count) - count}`)
          }
        }
        return [{ target, stage, stageLabel, missing }]
      })
      if (!candidates.length) continue
      candidates.sort((a, b) => a.missing.length - b.missing.length || a.target.level - b.target.level)
      const best = candidates[0]
      const ready = akashiReady && helperReady && best.missing.length === 0
      // 折叠态只答「谁当助手」：命中就点名打钩，没命中就报头一个候选 + 还有几艘。
      // 全部候选留给展开层，那里放得下
      const candidateIds = [...allowedHelpers]
      const helperShort = allowedHelpers.size === 0
        ? '无需指定二号舰'
        : helperReady && second
          ? `${elink('ship', second.id, masterShipName(second.shipId))} ✓`
          : `${elink('mstShip', candidateIds[0], masterShipName(candidateIds[0]))}${candidateIds.length > 1 ? ` 等 ${candidateIds.length} 艘` : ''}`
      const stage = best.stage
      // 括号里是确保化那一侧，不是范围（wikiwiki 改修表原表头：必要資材(通常/確実)）
      const costs = `${improvementMaterialLink(6, '开发')} ${improveCostCell(stage.devmats, stage.devmats_sli)} · ${improvementMaterialLink(7, '改修')} ${improveCostCell(stage.screws, stage.screws_sli)}`
      const fodder = improveFodderHtml(stage)
      const status = ready
        ? '<span class="today-status ok">今日可改修</span>'
        : `<span class="today-status wait"${best.missing.length > 2 ? ` title="${esc(best.missing.join(' · '))}"` : ''}>${
            !akashiReady
              ? '需明石任第一舰队旗舰'
              : !helperReady
                ? '需换二号舰'
                : best.missing.slice(0, 2).map(esc).join(' · ')
          }</span>`
      const iconId = Array.isArray(equip.api_type) ? equip.api_type[3] : 0
      // 展开层：这几件同款现在都在哪
      const dist = new Map<number, number>()
      for (const target of targets) dist.set(target.level, (dist.get(target.level) ?? 0) + 1)
      const distText = [...dist.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, n]) => `★${level >= IMPROVE_MAX ? 'max' : level} ×${n}`)
        .join(' · ')
      const equippedCount = targets.filter((target) => equippedIds.has(target.id)).length
      const awayCount = { mission: 0, sortie: 0, ndock: 0 }
      for (const target of targets) {
        const kind = away.get(holderShip.get(target.id) ?? -1)
        if (kind) awayCount[kind] += 1
      }
      rows.push({
        equipId: eo.eq_id,
        variant,
        type2: Array.isArray(equip.api_type) ? equip.api_type[2] : 0,
        ready,
        helperReady,
        missing: best.missing,
        html: `<details class="improve-item" data-equip="${eo.eq_id}">
          <summary>
            <div class="row improve-row${ready ? ' ready' : ''}">
              <div class="face eqface">${equipTypeIconHtml(iconId, { className: 'lg', title: entityNamePlain('equip', eo.eq_id, equip.api_name) })}</div>
              <div class="nm">
                <b>${elinkHtml('mstEquip', eo.eq_id, entityNameHtml('equip', eo.eq_id, equip.api_name, { compact: true }))}</b>
                <span class="ti-line">
                  <span class="ti-stage">${esc(best.stageLabel)}</span>
                  <span class="ti-helper">${helperShort}</span>
                  <span class="ti-cost">${costs}</span>
                </span>
              </div>
              ${status}
            </div>
          </summary>
          <div class="ti-more">
            <div class="ti-row">持有 ${targets.length}${distText ? ` · ${distText}` : ''}</div>
            <div class="ti-row">装备中 ${equippedCount} · 空闲 ${targets.length - equippedCount}</div>
            <div class="ti-row" title="按装备所在舰队状态统计">当前不可用 远征中 ${awayCount.mission} · 出击中 ${awayCount.sortie} · <span class="ti-untested" title="入渠舰计入当前不可用">入渠中 ${awayCount.ndock}</span></div>
            ${candidateIds.length > 1 && !(helperReady && second) ? `<div class="ti-row">${improvementHelperListHtml(candidateIds, 6, '二号舰')}</div>` : ''}
            <div class="ti-row ti-cost-fold">每次消耗 ${costs}</div>
            ${fodder === '—' ? '' : `<div class="ti-row">素材 ${fodder}</div>`}
            ${best.missing.length ? `<div class="ti-row bad">缺 ${best.missing.map(esc).join(' · ')}</div>` : ''}
            <a class="ti-open" data-improve-open="${eo.eq_id}">装备详情 ›</a>
          </div>
        </details>`,
      })
    }
  }
  return rows.sort(
    (a, b) =>
      Number(b.ready) - Number(a.ready) ||
      Number(b.helperReady) - Number(a.helperReady) ||
      a.missing.length - b.missing.length ||
      a.equipId - b.equipId ||
      a.variant - b.variant,
  )
}

/**
 * 今日改修按装备类别分组，每组接可折叠组头（默认全展开，见 `groupBoxHtml`）。
 *
 * **组之间按「可做条数」排**——今天能动手的类别浮到最上面，组内保持原来的
 * 「现在可做 → 二号舰已匹配 → 缺口较少」。纯按类别 id 排会把能做的那几条
 * 埋进中间，这一页存在的意义就没了。
 *
 * 分出来是为了能单独测（chip/搜索筛过之后组还剩几个、组头的计数对不对）：
 * 它的宿主 `equipCatalogHtml` 牵着搜索框、chip 栏与实验室宿主，整只切不出来。
 *
 * 传进来的 `rows` **已经筛过**（`todayImprovementRows` 里调了 `equipMatches`），
 * 所以筛空的类别根本进不到这里——不会剩下一个空组头。
 */
const todayImprovementGroupsHtml = (rows: TodayImprovementRow[]): string => {
  const groups = new Map<number, TodayImprovementRow[]>()
  for (const row of rows) groups.set(row.type2, [...(groups.get(row.type2) ?? []), row])
  return [...groups.entries()]
    .map(([type2, list]) => ({ type2, list, ready: list.filter((r) => r.ready).length }))
    .sort((a, b) => b.ready - a.ready || a.type2 - b.type2)
    .map(({ type2, list, ready: n }) => {
      const name = entityNamePlain('equipType', type2, equipTypes.get(type2) ?? `分类${type2}`)
      return groupBoxHtml(
        `equipToday:${name}`,
        `<b>${elinkHtml('equipTypeCatalog', type2, entityTermHtml('equipTypeCatalog', name, name))}</b>
          <span class="cnt">${n ? `<i class="grp-ready">可做 ${n}</i> / ` : ''}${list.length}</span>`,
        list.map((row) => row.html).join(''),
      )
    })
    .join('')
}

/**
 * 「更多分类 · 装备类别」。顶栏只放得下常用的十来个，这里把
 * api_mst_slotitem_equiptype 里**每一类**都列出来，各带主数据里的种数。
 */
const equipMoreCategoriesHtml = (): string => {
  // 数的是这一卷实际列出的那批（friendlyEquips），不是 api_mst_slotitem 全表——
  // 全表连深海装备一起算，面板上的数字会比点下去看到的多
  const counts = new Map<number, number>()
  for (const item of friendlyEquips.values()) {
    const cat = equipCategoryOf(item)
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  // 合成类别（高角炮）主数据里没有条目，单独并进来；有件数才列
  const cellSource: [number, string][] = [
    ...equipTypes.entries(),
    ...(counts.get(HIGH_ANGLE_CATEGORY)
      ? ([[HIGH_ANGLE_CATEGORY, HIGH_ANGLE_CATEGORY_NAME]] as [number, string][])
      : []),
  ]
  const cells = cellSource
    .sort((a, b) => a[0] - b[0])
    .flatMap(([id, name]) => {
      const n = counts.get(id) ?? 0
      if (!n) return [] // 主数据里挂着但一件都没有的类别，不占位
      return [
        `<span class="cat-cell${equipState.typeFilter === id ? ' on' : ''}" data-equip-type="${id}">
          ${entityNameHtml('equipType', id, name, { compact: true })}<i>${n}</i></span>`,
      ]
    })
  return `<div class="cat-more">
    <div class="cat-more-h">按装备类别精确筛选<span>共 ${cells.length} 类</span></div>
    <div class="cat-grid">${cells.join('')}</div>
  </div>`
}

const equipCatalogHtml = () => {
  const searchAndMode = `
    <div class="search-row">
      <div class="search">⌕<input id="ji-equip-search" placeholder="装备名" value="${esc(equipState.search)}"></div>
      <div class="equip-mode">
        <button class="${equipState.mode === 'catalog' ? 'on' : ''}" data-equip-mode="catalog">装备目录</button>
        <button class="${equipState.mode === 'today' ? 'on' : ''}" data-equip-mode="today">今日改修</button>
        <button class="${equipState.mode === 'lab' ? 'on' : ''}" data-equip-mode="lab">组合实验室</button>
      </div>
    </div>`
  // chip 栏两个模式共用。今日改修本来就受 chip 过滤（todayImprovementRows 里
  // 调了 equipMatches），只是这一栏没渲染出来，看着像不能筛
  const chipsRow = `
    <div class="type-chips">${EQUIP_CHIPS.map((label) => `<span class="chip${label === equipState.chip && !equipState.typeFilter ? ' on' : ''}" data-chip="${label}">${label}</span>`).join('')}
      <span class="chip more${moreCategoriesOpen ? ' on' : ''}" data-more-cat title="按装备类别逐个筛选（共 ${equipTypes.size} 类）">更多分类 ${
        moreCategoriesOpen ? '▴' : '▾'
      }</span>
      ${equipState.typeFilter ? `<span class="chip on linked-filter" data-clear-equip-scope>${entityNameHtml('equipType', equipState.typeFilter, equipTypes.get(equipState.typeFilter) ?? `分类${equipState.typeFilter}`, { compact: true })} ×</span>` : ''}
    </div>
    ${moreCategoriesOpen ? equipMoreCategoriesHtml() : ''}`

  // 组合实验室（2026-08-12 用户提议）：CI/配装的只读模拟与查询，
  // 本体在 ji-lab.ts（宿主元素自带接线，render 后由 mountLab 挂进来）
  if (equipState.mode === 'lab') {
    return `${searchAndMode}<div class="lab-book-slot"></div>`
  }
  if (equipState.mode === 'today') {
    const today = JST_WEEKDAY_LABELS[jstDayOfWeek()]
    const rows = todayImprovementRows()
    const ready = rows.filter((row) => row.ready).length
    // chip 与搜索本来就在筛这一页（todayImprovementRows 里调了 equipMatches），
    // 只是抬头没说，看着像「今天就这么几条」
    const filtered = !!(equipState.chip !== '全部' || equipState.typeFilter || equipState.search)
    const grouped = todayImprovementGroupsHtml(rows)
    return `${searchAndMode}
      ${chipsRow}
      <div class="today-summary">
        <span><b>${esc(today)}</b> · ${filtered ? '筛选后 ' : ''}${rows.length} 条方案 · 满足当前编成条件 <b class="${ready ? 'ok' : ''}">${ready}</b> 条</span>
        <span class="credit-mark" title="普通消耗用于可行性判断，确保成功时以上限为准">口径</span>
      </div>
      <div class="ship-list today-list" id="ji-equip-list">${
        grouped ||
        `<div class="today-empty">${
          filtered
            ? '当前筛选暂无今日可改修方案 · 切换分类或清除搜索'
            : '暂无当前持有装备的改修方案'
        }</div>`
      }</div>`
  }
  const list = [...friendlyEquips.values()].filter(equipMatches)
  const groups: Record<string, any[]> = {}
  for (const e of list) {
    const cat = equipCategoryOf(e)
    const name =
      cat === HIGH_ANGLE_CATEGORY
        ? HIGH_ANGLE_CATEGORY_NAME
        : entityNamePlain('equipType', cat, equipTypes.get(cat) ?? `分类${cat}`)
    ;(groups[name] ??= []).push(e)
  }
  const rows = Object.entries(groups)
    .map(([typeName, items]) => {
      const rowsHtml = items
        .sort((a, b) => a.api_id - b.api_id)
        .map((e) => {
          const count = equipInstancesOf(e.api_id).length
          const on = e.api_id === equipState.selected && equipState.open
          return `<div class="row${count ? '' : ' ghost'}${on ? ' on' : ''}" data-equip="${e.api_id}" style="--rc:${count ? '#7db4d8' : '#3a4a58'}">
            <div class="face eqface">${equipTypeIconHtml(Array.isArray(e.api_type) ? e.api_type[3] : 0, { className: 'lg', title: entityNamePlain('equip', e.api_id, e.api_name) })}</div>
            <div class="nm"><b>${entityNameHtml('equip', e.api_id, e.api_name, { compact: true })}</b><span>${'★'.repeat(Math.min(e.api_rare ?? 0, 5))}${count ? ` · 持有 ×${count}` : ' · 未持有'}</span></div>
          </div>`
        })
        .join('')
      // 分组按名字归并，取组内第一件的类别 id——路由要的是数字，给名字它会 NaN 直接返回
      const groupCat = Array.isArray(items[0]?.api_type) ? items[0].api_type[2] : 0
      return groupBoxHtml(
        `equip:${typeName}`,
        `<b>${elinkHtml('equipTypeCatalog', groupCat, entityTermHtml('equipTypeCatalog', typeName, typeName))}</b><span class="cnt">${items.length}</span>`,
        rowsHtml,
      )
    })
    .join('')
  return `
    ${searchAndMode}
    ${chipsRow}
    <div class="ship-list" id="ji-equip-list">${rows || '<div style="padding:20px;color:var(--dim)">暂无匹配项</div>'}</div>
    ${equipCollectionFootHtml()}`
}

/**
 * 装备卷的收集度。舰娘卷一直有这一条，装备卷没有——数字现成（持有过就算），
 * 只是没画出来。
 *
 * 口径与舰娘卷一致：分母是图鉴里的**款数**（主数据里的敌我可见装备），
 * 分子是当前手上还有至少一件的款数。装备会被拆、被改修消耗，
 * 所以这是「现在有」而不是「见过」——图鉴没有装备的图鉴号，
 * 游戏本身也不记「曾经持有」，这一点在脚注里说清楚，不装成收集进度。
 */
const equipCollectionFootHtml = (): string => {
  const total = friendlyEquips.size
  if (!total) return ''
  let held = 0
  for (const id of friendlyEquips.keys()) if (equipInstancesOf(id).length) held++
  const pct = (held / total) * 100
  return `<div class="index-foot">当前持有 <b style="color:var(--text)">${held}</b> / ${total} 款
    <span style="float:right;font-family:var(--mono)">${pct.toFixed(1)}%</span>
    <div class="bar"><i style="width:${pct}%"></i></div>
  </div>`
}

const EQUIP_STATS: [string, string][] = [
  ['api_houg', '火力'], ['api_raig', '雷装'], ['api_baku', '爆装'], ['api_tyku', '对空'],
  ['api_tais', '对潜'], ['api_houm', '命中'], ['api_houk', '回避'], ['api_saku', '索敌'],
  ['api_souk', '装甲'],
]

/**
 * 非零属性的「叫什么 · 是多少」——数值口径的单一出处。
 *
 * 局地戦闘機/陸軍戦闘機(type2=48)的 api_houm/api_houk 在一手语义里是
 * **対爆/迎撃**,不是命中/回避——游戏図鑑与 wikiwiki 都按対爆/迎撃标注
 * (2026-08-11 对 wikiwiki 装備页校准后立的口径)。
 *
 * 这条换标此前在抽屉的 chip 与列表速览两处各写了一遍,靠护栏数出现次数
 * 盯着两份别走散——那是把重复本身当纪律。收成一份之后,两条渲染路径都从
 * 这里取值;各自的 markup 与文案照旧,这里只管数值判定。
 */
const equipStatValues = (e: any): { label: string; value: number }[] => {
  const interceptor = Array.isArray(e.api_type) && e.api_type[2] === 48
  return EQUIP_STATS.filter(([key]) => e[key]).map(([key, label]) => ({
    label:
      interceptor && key === 'api_houm' ? '对爆' : interceptor && key === 'api_houk' ? '迎击' : label,
    value: e[key],
  }))
}

/**
 * 属性 chip 列表。除了 equipStatValues 管的换标,还有两条口径:
 *   · 飞机的 行动半径(api_distance)与 配置消耗(api_cost,进驻基地航空队时
 *     每机消耗的铝)是陆航规划的核心数字,一手字段一直有,此前漏展示;
 *   · api_raim 在 11 件舰攻/水偵上有非零值(16/24/56 这种),社区对它的语义
 *     没有一致结论,数字拿不准名字就不上屏。
 */
const equipStatChips = (e: any): string[] => {
  const chips = equipStatValues(e).map(({ label: shown, value }) => {
    return `<span class="misc-stat">${shown} <b style="color:${value > 0 ? 'var(--ok)' : 'var(--bad)'}">${value > 0 ? '+' : ''}${value}</b></span>`
  })
  if (e.api_leng) chips.push(`<span class="misc-stat">射程 <b>${LENG_LABEL[e.api_leng] ?? '—'}</b></span>`)
  if (e.api_distance > 0) chips.push(`<span class="misc-stat">行动半径 <b>${e.api_distance}</b></span>`)
  if (e.api_cost > 0)
    chips.push(`<span class="misc-stat" title="配置进基地航空队时，每架消耗的铝土">配置消耗 <b>铝${e.api_cost}/机</b></span>`)
  return chips
}

// 「谁能装」对每件装备都值得答，但答法要随范围变——
// 一件普通主炮几百艘舰都能装，逐个列出来既卡又没有信息量；
// 而大发系、陸戦部隊这类限定装备，恰恰是「具体哪几艘」才有用。
//
// 所以按舰种拆开看：某舰种**全员**可装就只报舰种名（那是常识，不必展开），
// 只有**部分**可装时才列出具体形态——那才是真正的信息。
// 极端情形如 type2=52 陸戦部隊，全游戏只有第百一号輸送艦系列两个形态能装。
const EQUIPABLE_LIST_LIMIT = 60 // 单个舰种里超过这么多形态就不铺开，只报数

const equipableShipsHtml = (equip: any): string => {
  if (!mst) return ''
  const ships = equipableFriendlyShipIds(mst, Number(equip.api_id))
    .map((id) => friendlyShips.get(id))
    .filter(Boolean)
  if (!ships.length) {
    return `<div class="sec"><div class="sec-h">可装备舰娘</div>
      <div class="equipable-empty">游戏基础数据暂无可装备形态</div></div>`
  }

  // 每个舰种的在册形态总数——用来判断「全员可装」还是「只有部分」
  const totalByStype = new Map<number, number>()
  for (const ship of friendlyShips.values()) {
    if (!(Number(ship?.api_sortno) > 0)) continue
    const st = Number(ship.api_stype)
    totalByStype.set(st, (totalByStype.get(st) ?? 0) + 1)
  }

  const groups = new Map<number, any[]>()
  for (const ship of ships) {
    const rows = groups.get(Number(ship.api_stype)) ?? []
    rows.push(ship)
    groups.set(Number(ship.api_stype), rows)
  }
  const heldForms = ships.filter((ship) => instancesOfMst(Number(ship.api_id)).length > 0).length
  const groupHtml = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stype, entries]) => {
      entries.sort(
        (a, b) =>
          Number(a.api_ctype) - Number(b.api_ctype) ||
          Number(a.api_sortno) - Number(b.api_sortno) ||
          Number(a.api_id) - Number(b.api_id),
      )
      const held = entries.filter((ship) => instancesOfMst(Number(ship.api_id)).length > 0).length
      const typeName = entityNamePlain(
        'shipType',
        stype,
        mg.master.stypes[stype] ?? `舰种${stype}`,
      )
      // 该舰种全员可装 = 常识，不铺开；只有部分可装时才逐个列出
      const total = totalByStype.get(stype) ?? entries.length
      const partial = entries.length < total
      if (!partial || entries.length > EQUIPABLE_LIST_LIMIT) {
        return `<div class="equipable-group whole">
          <b>${elinkHtml('shipTypeCatalog', stype, entityTermHtml('shipTypeCatalog', typeName, typeName))}</b>
          <span>${partial ? `${entries.length}/${total} 个形态` : '全部形态'}${held ? ` · 持有 ${held}` : ''}</span>
        </div>`
      }
      const chips = entries
        .map((ship) => {
          const count = instancesOfMst(Number(ship.api_id)).length
          return `<span class="equipable-ship${count ? ' owned' : ''}">
            ${elink('mstShip', ship.api_id, ship.api_name)}
            ${count ? `<i>持有×${count}</i>` : ''}
          </span>`
        })
        .join('')
      return `<details class="equipable-group" data-keep="equipable:${esc(typeName)}"${held ? ' open' : ''}>
        <summary>
          <b>${entityTermHtml('shipTypeCatalog', typeName, typeName)}</b>
          <span>${entries.length} 个形态${held ? ` · 持有 ${held}` : ''}</span>
        </summary>
        <div class="equipable-ships">${chips}</div>
      </details>`
    })
    .join('')

  return `<div class="sec equipable-sec">
    <div class="sec-h">可装备舰娘<span class="aux">${ships.length} 个精确改造形态 · 当前持有 ${heldForms}</span></div>
    <div class="equipable-groups">${groupHtml}</div>
  </div>`
}

/**
 * 口径说明的通用外壳：一行抬头，正文默认收起。
 *
 * 这类文字说的是「这块数字是怎么来的、什么不算数」，读一次就够，
 * 却一直摊在正文里——海域抽屉实测 590px 里有 488px 是这种多行说明，
 * 五条口径说明就占了 271px。收起后每条只留一行。
 * 展开状态由 withViewStateKept 跨重渲染保住。
 */
const foldedNote = (summary: string, body: string, className = ''): string =>
  `<details class="q-foot rule-note ${className}">
    <summary>${summary}</summary>
    <div class="rule-body">${body}</div>
  </details>`

const equipDrawerHtml = () => {
  const e = friendlyEquips.get(equipState.selected)
  if (!e) return ''
  const cat = Array.isArray(e.api_type) ? e.api_type[2] : 0
  const iconId = Array.isArray(e.api_type) ? e.api_type[3] : 0
  // 主数据里没这个类别号（新装备的新类别，或包滞后）时报号，不落成空串：
  // 空串会让面包屑变成「› 装备名」凭空少一截、让 .badge 渲成一个空框
  const typeName = entityNamePlain('equipType', cat, equipTypes.get(cat) ?? `分类${cat}`)
  const instances = equipInstancesOf(e.api_id)
  const art = slotItemImageUrl(e.api_id, 'card')
  // ★分布
  const starDist = new Map<number, number>()
  for (const [, inst] of instances) {
    starDist.set(inst.level, (starDist.get(inst.level) ?? 0) + 1)
  }
  const distHtml = [...starDist.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lv, n]) => `<span class="ro-chip">★${lv >= 10 ? 'M' : lv}×${n}</span>`)
    .join('')
  // 装备中——舰上与陆航都要查（equip-stock 同一口径）：只查舰上会把
  // 基地航空队的机体报成「在库」，用户照着去废弃拆的就是正在出击的攻击机。
  // equippedInstIds 就是这两处的并集（有缓存），不必再手抄一遍双重循环
  const equippedIds = equippedInstIds()
  const equipped = instances.filter(([id]) => equippedIds.has(parseInt(id, 10))).length
  const stats = equipStatChips(e)
  // 废弃返还:一手 api_broken;也是「開発理論値」的换算基数(devRecipeHtml 用它)
  const broken = Array.isArray(e.api_broken) && e.api_broken.some((v: number) => v > 0)
    ? `<span class="misc-stat" title="废弃这件装备返还的资材">废弃返还 <b>燃${e.api_broken[0]}/弹${e.api_broken[1]}/钢${e.api_broken[2]}/铝${e.api_broken[3]}</b></span>`
    : ''
  // 図鑑説明:主数据快照不含 api_info,akashi-list 的 item_intro 是同文照录(日文)
  const intro = `${akashiListLode?.data?.items?.[`${e.api_id}`]?.item_intro ?? ''}`.trim()
  const introHtml = intro
    ? foldedNote(
        '图鉴说明<span style="color:var(--dim);font-weight:400">（日文原文）</span>',
        `<p style="line-height:1.9">${esc(intro)}</p>${akashiListLode ? `<p style="color:var(--dim)">${esc(lodeCreditShort(akashiListLode.meta))}</p>` : ''}`,
      )
    : ''

  return `
  <div class="d-head">
    <span class="x" id="ji-equip-close" title="关闭（Esc）">✕</span>
    <span class="crumb">${entityNameHtml('equipType', cat, equipTypes.get(cat) ?? `分类${cat}`, { compact: true })} › <b>${entityNameHtml('equip', e.api_id, e.api_name, { compact: true })}</b></span>
    <span class="sp"></span>
  </div>
  <div class="detail">
    <div class="hero">
      <div class="hero-l">
        <div class="meta-line">
          <span class="badge type">${entityNameHtml('equipType', cat, equipTypes.get(cat) ?? `分类${cat}`, { compact: true })}</span>
          <span class="badge" style="color:var(--gold)">${'★'.repeat(Math.min(e.api_rare ?? 0, 5)) || '—'}</span>
          <span class="no">ID ${e.api_id}</span>
        </div>
        <div class="name-block"><h1 style="font-size:24px">${entityNameHtml('equip', e.api_id, e.api_name)}</h1></div>
        <div class="own-line">
          ${instances.length ? `<span class="own-pill"><span class="dot"></span>持有 <b>×${instances.length}</b></span><span class="own-pill">装备中 <b>${equipped}</b></span>` : '<span class="own-pill" style="opacity:.6">未持有</span>'}
          ${distHtml}
        </div>
      </div>
      ${
        art
          ? `<div class="equip-art has" data-cg="${esc(art)}">
              <img src="${esc(art)}" alt="${esc(entityNamePlain('equip', e.api_id, e.api_name))} 卡面" data-equip-art="${e.api_id}">
            </div>`
          : `<div class="equip-art">${equipTypeIconHtml(iconId, { className: 'hero-icon', title: entityNamePlain('equip', e.api_id, e.api_name) })}
              <div class="cap">暂无可读取的官方卡面</div></div>`
      }
    </div>
    <div class="sec">
      <div class="sec-h">属性</div>
      <div class="misc-line">${stats.join('') || '<span style="color:var(--dim)">无属性加成</span>'}${broken}</div>
      ${introHtml}
    </div>
    ${equipObtainHtml(e.api_id, e.api_name)}
    ${devRecipeHtml(e.api_name, e.api_id)}
    ${equipArtPanelHtml(e.api_id, false)}
    ${equipableShipsHtml(e)}
    ${(() => {
      // 所持明细：按 ★/熟练度归并，列出各实例装备在谁身上（在籍舰扫描）
      if (!instances.length) return ''
      // 装备实例 → 持有舰（含补强增设格）
      const holderByInst = new Map<number, (typeof mg.ships)[number]>()
      for (const ship of Object.values(mg.ships)) {
        for (const slotId of [...ship.slot, ship.slotEx]) {
          if (slotId > 0) holderByInst.set(slotId, ship)
        }
      }
      // 装备实例 → 基地航空队中队（不查这层，陆航机体全被记成「在库」）
      const airHolderByInst = new Map<number, string>()
      for (const squad of mg.airBases) {
        squad.planes.forEach((plane, index) => {
          if (plane.slotId > 0) {
            airHolderByInst.set(
              plane.slotId,
              `${esc(squad.name || `第${squad.rid}航空队`)}<span style="color:var(--dim);font-size:10px">（第${squad.areaId}海域 · ${index + 1}号位）</span>`,
            )
          }
        })
      }
      // 舰 → 舰队位置徽章
      const fleetPos = (shipInstId: number) => {
        for (const deck of mg.decks) {
          const at = deck.ships.indexOf(shipInstId)
          if (at >= 0) return `第${deck.id}舰队${at + 1}号位`
        }
        return null
      }
      interface Row { level: number; alv: number; holders: string[]; stock: number }
      const rowMap = new Map<string, Row>()
      for (const [idStr, inst] of instances) {
        const key = `${inst.level}:${inst.alv}`
        const row = rowMap.get(key) ?? { level: inst.level, alv: inst.alv, holders: [], stock: 0 }
        const instId = parseInt(idStr, 10)
        const holder = holderByInst.get(instId)
        const airHolder = airHolderByInst.get(instId)
        if (holder) {
          const pos = fleetPos(holder.id)
          row.holders.push(
            `${elinkHtml('ship', holder.id, entityNameHtml('ship', holder.shipId, masterShipName(holder.shipId), { compact: true }))}<span style="color:var(--dim);font-size:10px">(Lv${holder.lv}${pos ? ` · ${pos}` : ''})</span>`,
          )
        } else if (airHolder) {
          row.holders.push(airHolder)
        } else {
          row.stock++
        }
        rowMap.set(key, row)
      }
      const rows = [...rowMap.values()]
        .sort((a, b) => b.level - a.level || b.alv - a.alv)
        .map((row) => {
          const starLabel = row.level > 0 ? `★${row.level >= 10 ? 'M' : row.level}` : '未改修'
          const alvLabel = row.alv > 0 ? `<span class="ro-chip alv-chip">${alvIconHtml(row.alv)}</span>` : ''
          const shown = row.holders.slice(0, 12).join('、')
          const holders = row.holders.length > 12
            ? `<details class="equip-holder-more">
                <summary>${shown} 等 ${row.holders.length} 艘</summary>
                <div><span>全部装备舰</span>${row.holders.join('、')}</div>
              </details>`
            : `<span class="equip-holder-list">${shown}</span>`
          return `<div class="ro-row">
            <span class="ro-stage">${starLabel}</span>${alvLabel}
            <span class="ro-cnt">×${row.holders.length + row.stock}</span>
            ${row.holders.length ? holders : ''}
            ${row.stock ? `<span class="ro-chip">在库 ×${row.stock}</span>` : ''}
          </div>`
        })
        .join('')
      return `<div class="sec">
        <div class="sec-h">持有明细<span class="aux">按 ★ 与熟练度合并统计</span></div>
        ${rows}
      </div>`
    })()}
    ${equipFitHtml(e.api_id)}
    ${equipRemodelUsageHtml(e.api_id)}
    ${improveSectionHtml(e, instances)}
    ${relatedQuestsHtml([e.api_name], 'equip')}
    <div class="foot">
      <span class="credit-mark" title="数值 · 游戏基础数据 · 更新于 ${masterTs ? fmtDateTime(masterTs) : '—'}">源</span>
    </div>
  </div>`
}

// ---- 改修工厂（装备抽屉的那张卡）----

/** 「10 (12)」：括号里是全程确保化那一侧，与消耗表抬头的「(确保)」对上。 */
const improveCostCell = (normal: number | undefined, certain: number | undefined): string => {
  const a = Number(normal ?? 0)
  const b = Number(certain ?? a)
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return lo === hi ? `${lo}` : `${lo} <i>(${hi})</i>`
}

const improveCostPairCell = (pair: CostPair): string =>
  pair.normal === pair.certain ? `${pair.normal}` : `${pair.normal} <i>(${pair.certain})</i>`

/** 一档要吞掉的素材：装备与道具排成一行。 */
const improveFodderHtml = (stage: ImproveStageCost | undefined): string => {
  const parts = [
    ...(stage?.equips ?? []).map(
      (need) => `${equipVisualLink(Number(need.id))}×${Number(need.eq_count)}`,
    ),
    ...(stage?.consumable ?? []).map(
      (need) =>
        `${elink('useitem', Number(need.id), useitemMst.get(Number(need.id))?.api_name ?? `道具 #${need.id}`)}×${Number(need.eq_count)}`,
    ),
  ]
  return parts.join(' · ') || '—'
}

/** 七枚圆点的周历，能开修的那几天实心。 */
const improveWeekHtml = (days: readonly number[]): string => {
  const on = new Set((days ?? []).map(Number))
  return `<div class="week">${CALENDAR_WEEKDAY_CHIPS.map(
    ({ day, label, title }) =>
      `<span class="day${on.has(day) ? ' on' : ''}" title="${title}">${label}</span>`,
  ).join('')}</div>`
}

/** 素材现在手上有几件。装备只数闲置且没上锁的——那才是能吞进改修工厂的。 */
const improveFodderStockHtml = (stages: (ImproveStageCost | undefined)[]): string => {
  const equipIds: number[] = []
  const itemIds: number[] = []
  for (const stage of stages) {
    for (const need of stage?.equips ?? []) {
      if (!equipIds.includes(Number(need.id))) equipIds.push(Number(need.id))
    }
    for (const need of stage?.consumable ?? []) {
      if (!itemIds.includes(Number(need.id))) itemIds.push(Number(need.id))
    }
  }
  if (!equipIds.length && !itemIds.length) return ''
  const parts = [
    ...equipIds.map((id) => {
      const n = unlockedEquipCount(id)
      return `${equipVisualLink(id)} <b${n ? '' : ' class="bad"'}>可用 ${n}</b>`
    }),
    ...itemIds.map((id) => {
      const n = mg.useitems[id] ?? 0
      return `${elink('useitem', id, useitemMst.get(id)?.api_name ?? `道具 #${id}`)} <b${n ? '' : ' class="bad"'}>可用 ${n}</b>`
    }),
  ]
  return `<div class="ak-note" title="素材仅计闲置且未锁定的装备">素材 ${parts.join(' · ')}</div>`
}

/**
 * 推满账，两行以内。
 *
 * **只算一件**：早先按「全部持有实例都推满」合计，12.7cm連装砲 持有 97 件
 * 就报出「还要 968 次」——没人会把 97 门炮全推满。起点取手上**最高但未满**
 * 的那件，那才是会拿去推的那一件。
 *
 * 资材是「通常/确保」双单价，不是范围（2026-08-12 用户抓的实锤，wikiwiki
 * 改修表原表头「必要資材(通常/確実)」）：通常侧假定每次成功、不含失败重打
 * （成功率无权威资料，不造期望）；确保侧必成，是确定的封顶预算。
 *
 * 有更新目标时另给一行整条路线的合计——要不要更新是另一个决定，但真要走
 * 这条路线的人得能一眼看到总数（2026-08-25 用户手算夜間瑞雲时算的就是它）。
 */
const improveBudgetLines = (
  costs: ImproveCosts | undefined,
  instances: [string, { level?: number }][],
  convs: { label: string; stage: ImproveStageCost }[],
): string => {
  if (!costs?.p1 && !costs?.p2) return ''
  const levels = instances.map(([, item]) => item.level ?? 0).sort((a, b) => b - a)
  const startFrom = levels.find((level) => level < IMPROVE_MAX)
  if (levels.length && startFrom === undefined) {
    return `<div class="ak-sum"><b class="ok">持有的 ${levels.length} 件都已 ★max</b></div>`
  }
  const total = improveBudgetTo(costs, startFrom ?? 0)
  const runs = total.p1Times + total.p2Times
  if (runs <= 0) return ''
  // 星级分布归并成「★0 ×96」，不是把 96 个 ★0 逐个列出来
  const dist = new Map<number, number>()
  for (const level of levels) dist.set(level, (dist.get(level) ?? 0) + 1)
  const distText = [...dist.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([level, n]) => `★${level}${n > 1 ? ` ×${n}` : ''}`)
    .join(' · ')
  const why = `${
    levels.length
      ? `持有 ${levels.length} 件：${distText}${levels.length > 1 ? ` · 按最高未满改修等级 ★${total.from} 的装备计算` : ''}`
      : '暂无当前装备 · 按一件从 ★0 起计算'
  }；★0-5 档 ${total.p1Times} 次、★6-9 档 ${total.p2Times} 次`
  // 开发资材 materials[6] / 改修资材 materials[7]（见 shared/useitem-stock）。
  // 通常与确保是两种打法，储备判定分开说，别混成一句「可能不够」
  const cmp = (stock: number | undefined, need: CostPair) =>
    typeof stock !== 'number'
      ? '<i>库存未同步</i>'
      : stock >= need.certain
        ? `<i class="ok" title="储备 ${stock} · 确保消耗充足">✓</i>`
        : stock >= need.normal
          ? `<i class="warn">储备 ${stock} · 确保消耗缺 ${need.certain - stock}</i>`
          : `<i class="bad">储备 ${stock} · 普通消耗缺 ${need.normal - stock}</i>`
  const fodderOf = (budget: { equips: Map<number, number>; consumables: Map<number, number> }) =>
    [
      ...[...budget.equips.entries()].map(([id, n]) => `${equipVisualLink(id)}×${n}`),
      ...[...budget.consumables.entries()].map(
        ([id, n]) => `${elink('useitem', id, useitemMst.get(id)?.api_name ?? `道具 #${id}`)}×${n}`,
      ),
    ].join(' · ')
  const pushFodder = fodderOf(total)
  const head = `<div class="ak-sum" title="${esc(why)}">升至 <b>★${total.from}→★max</b> · 还需 <b>${runs}</b> 次 · ${improvementMaterialLink(6, '开发资材')} <b>${improveCostPairCell(total.devmats)}</b>${cmp(mg.materials?.[6], total.devmats)} · ${improvementMaterialLink(7, '改修资材')} <b>${improveCostPairCell(total.screws)}</b>${cmp(mg.materials?.[7], total.screws)}${pushFodder ? ` · ${pushFodder}` : ''}</div>`
  const routes = convs
    .map(({ label, stage }) => {
      const route = improveRouteTotal({ ...costs, conv: stage }, startFrom ?? 0)
      const fodder = fodderOf(route)
      return `<div class="ak-sum">含更新消耗${convs.length > 1 ? `（→ ${esc(label)}）` : ''} · ${improvementMaterialLink(6, '开发资材')} <b>${improveCostPairCell(route.devmats)}</b> · ${improvementMaterialLink(7, '改修资材')} <b>${improveCostPairCell(route.screws)}</b>${fodder ? ` · ${fodder}` : ''}</div>`
    })
    .join('')
  return `${head}${routes}`
}

/**
 * 改修工厂卡。骨架照《图鉴设计稿》02-装备图鉴 的「改修工厂」段：
 * 二号舰 × 周历圆点 × 更新目标同一行，三档消耗一张表，推满账收成两行。
 *
 * 「一张表」的前提是改修域通则（消耗由装备与星级决定、与二号舰无关）。
 * 随包事实表里仍有两件对不上（16 的 ★0-5 改修资材、121 的 ★6-9 素材装备），
 * 挑一个数当全体的会说谎，所以这里按消耗分组：一组一张表。372 件里 370 件
 * 只有一组，那 370 件长的就是稿上的样子。
 */
const improveSectionHtml = (e: any, instances: [string, { level?: number }][]): string => {
  const eo = eoByEquip.get(e.api_id)
  if (!eo?.improvement?.length) {
    // 「不可改修」与「还没收录」原先写成同一句，玩家分不出是哪一种——而这两句
    // 一句是事实、一句是资料状态。判据同装备加成那边（覆盖边界，见 shared/equip-sources）。
    const uncovered = improvePackUncovered(
      Array.isArray(eoLode?.data) ? (eoLode!.data as EquipUpgradeRow[]) : null,
      e.api_id,
      improveCoverageMax,
    )
    return `<div class="sec">
      <div class="sec-h">改修工厂<span class="aux">${uncovered ? '暂无收录' : '不可改修'}</span><span class="sp"></span>${eoLode ? lodeCreditMark(eoLode.meta) : ''}</div>
      <div class="ak-empty">${
        uncovered
          ? `改修表暂未收录这件${improveCoverageMax ? `（只到第 ${improveCoverageMax} 号）` : ''}`
          : '改修表暂无当前装备 · 不可改修'
      }</div>
    </div>`
  }
  const imps = eo.improvement as any[]
  const today = jstDayOfWeek()
  const openToday = imps.some((imp) =>
    ((imp.helpers ?? []) as any[]).some((helper) => (helper.days ?? []).includes(today)),
  )
  // 同一件装备里**别的**方案能更新、这一条不能 → 那是「这个二号舰不给更新」，
  // 与「这件装备压根没有更新路线」是两回事，别用同一句话打发
  //（2026-08-25 裁决：二号舰全档可用，差别只在更新可否）。
  const anyConvert = imps.some((imp) => imp?.convert?.id_after)
  const stageSig = (stage: ImproveStageCost | undefined): string =>
    stage
      ? JSON.stringify([
          stage.devmats ?? 0,
          stage.devmats_sli ?? null,
          stage.screws ?? 0,
          stage.screws_sli ?? null,
          (stage.equips ?? []).map((need) => [Number(need.id), Number(need.eq_count)]),
          (stage.consumable ?? []).map((need) => [Number(need.id), Number(need.eq_count)]),
        ])
      : ''
  interface ImprovePlan {
    sig: string
    costs: ImproveCosts
    imps: any[]
  }
  const plans: ImprovePlan[] = []
  const convOnly: any[] = []
  for (const imp of imps) {
    const costs = (imp.costs ?? {}) as ImproveCosts
    // 只带更新一步的方案（★0-5/★6-9 两档都缺）照用别的方案那张表：
    // 通则说消耗与二号舰无关，缺的是资料的行绑定，不是另一套价钱
    if (!costs.p1 && !costs.p2) {
      convOnly.push(imp)
      continue
    }
    const sig = `${stageSig(costs.p1)}|${stageSig(costs.p2)}`
    const found = plans.find((plan) => plan.sig === sig)
    if (found) found.imps.push(imp)
    else plans.push({ sig, costs, imps: [imp] })
  }
  if (plans.length) plans[0].imps.push(...convOnly)
  else if (convOnly.length) {
    plans.push({ sig: '', costs: (convOnly[0].costs ?? {}) as ImproveCosts, imps: convOnly })
  }
  for (const plan of plans) plan.imps.sort((a, b) => imps.indexOf(a) - imps.indexOf(b))

  const planHtml = plans
    .map((plan, planIndex) => {
      const rows = plan.imps
        .map((imp) => {
          const target = Number(imp.convert?.id_after ?? 0)
          const to = target
            ? `<span class="to">★max 后更新 → ${equipVisualLink(target)}${Number(imp.convert.lvl_after ?? 0) ? ` ★${Number(imp.convert.lvl_after)}` : ''}</span>`
            : anyConvert
              ? // 同一张消耗表里摆着「★max 更新」那一行，这一组却走不到——
                // 只写「更新不可」会让人以为表读错了，后半句是给这个的
                '<span class="to none">更新不可 · 只能强化到 ★max</span>'
              : ''
          const helpers = (imp.helpers ?? []) as any[]
          if (!helpers.length) {
            return `<div class="ak-row"><span class="ak-warn">资料未收录改修日程与二号舰</span>${to}</div>`
          }
          return helpers
            .map((helper, helperIndex) => {
              const ships = (helper.ship_ids ?? []).map(Number).filter((id: number) => id > 0)
              const who = ships.length
                ? `<span class="who">${improvementHelperListHtml(ships, 6, '')}<i>二号舰</i></span>`
                : '<span class="who">无需指定二号舰</span>'
              // 同一套方案里几组二号舰走的是同一条更新路线：目标只在头一行说，
              // 逐行重复一遍正是这张卡此前被点名的那种「同一个东西出现好几次」
              return `<div class="ak-row">${who}${improveWeekHtml(helper.days ?? [])}${helperIndex ? '' : to}</div>`
            })
            .join('')
        })
        .join('')
      // 更新那一档按**目标**分行：同一组里几个目标的价钱本来就不一样，
      // 合成一行就得挑一个数说，那是说谎
      const convs = plan.imps
        .filter((imp) => imp.convert?.id_after && imp.costs?.conv)
        .map((imp) => ({
          label: entityNamePlain(
            'equip',
            Number(imp.convert.id_after),
            friendlyEquips.get(Number(imp.convert.id_after))?.api_name ?? `装备 #${imp.convert.id_after}`,
          ),
          stage: imp.costs.conv as ImproveStageCost,
        }))
      const uniqueConvs = convs.filter(
        (conv, index) =>
          convs.findIndex(
            (one) => one.label === conv.label && stageSig(one.stage) === stageSig(conv.stage),
          ) === index,
      )
      const matsRow = (label: string, stage: ImproveStageCost) => `<tr>
        <td class="rng">${label}</td>
        <td class="n">${improveCostCell(stage.devmats, stage.devmats_sli)}</td>
        <td class="n">${improveCostCell(stage.screws, stage.screws_sli)}</td>
        <td>${improveFodderHtml(stage)}</td>
      </tr>`
      const matsRows = [
        plan.costs.p1 ? matsRow('★0-5', plan.costs.p1) : '',
        plan.costs.p2 ? matsRow('★6-9', plan.costs.p2) : '',
        ...uniqueConvs.map((conv) =>
          matsRow(
            `★max 更新${uniqueConvs.length > 1 ? ` → ${esc(conv.label)}` : ''}`,
            conv.stage,
          ),
        ),
      ].join('')
      const base = (
        [
          ['燃', plan.costs.fuel],
          ['弹', plan.costs.ammo],
          ['钢', plan.costs.steel],
          ['铝', plan.costs.baux],
        ] as const
      )
        .filter(([, value]) => Number(value ?? 0) > 0)
        .map(([label, value]) => `${label} ${value}`)
        .join(' · ')
      const mats = matsRows
        ? `<table class="mats">
            <caption>每次消耗<span class="sp"></span>${planIndex === 0 ? improveTierMark(imps as EquipUpgradeRow['improvement']) : ''}</caption>
            <thead><tr><th>档位</th><th>开发资材 <i>（确保）</i></th><th>改修资材 <i>（确保）</i></th><th>消耗素材</th></tr></thead>
            <tbody>${matsRows}</tbody>
            ${base ? `<tfoot><tr><td class="rng">每次另付</td><td class="n" colspan="3">${base}</td></tr></tfoot>` : ''}
          </table>`
        : ''
      return `<div class="ak-plan">
        ${plans.length > 1 ? `<div class="ak-plan-h">方案 ${planIndex + 1}</div>` : ''}
        ${rows}${mats}
        ${improveBudgetLines(plan.costs, instances, uniqueConvs)}
        ${improveFodderStockHtml([plan.costs.p1, plan.costs.p2, ...uniqueConvs.map((conv) => conv.stage)])}
      </div>`
    })
    .join('')

  // 逐星加成（独立子域，基准 = akashi-list 的 item_remodel：逐列展示 ★1—★10 累计值）
  const remodelStats = akashiListLode?.data?.items?.[`${e.api_id}`]?.item_remodel
  const statLabels: Record<string, string> = {
    対空: '对空',
    対潜: '对潜',
    索敵値: '索敌',
    夜戦命中: '夜战命中',
    夜戦火力: '夜战火力',
    艦隊防空: '舰队防空',
    雷撃: '雷击',
    雷撃命中: '雷击命中',
    加重対空: '加权对空',
    改修ボーナス: '改修加成',
    装備ボーナス: '装备加成',
    シナジーボーナス: '协同加成',
    日本軽巡ボーナス: '日本轻巡加成',
    日本駆逐ボーナス: '日本驱逐加成',
  }
  const starRows = remodelStats
    ? Object.entries<any>(remodelStats)
        .filter(([, arr]) => Array.isArray(arr) && arr.length >= 10 && arr.slice(0, 10).some((v: unknown) => `${v ?? ''}`.trim()))
        .map(
          ([stat, arr]) => `<tr><th>${esc(statLabels[stat] ?? stat)}</th>${arr
            .slice(0, 10)
            .map((value: unknown) => `<td>${`${value ?? ''}`.trim() ? esc(`${value}`) : '—'}</td>`)
            .join('')}</tr>`,
        )
        .join('')
    : ''
  const starTable = starRows
    ? `<details class="ak-grow">
        <summary>逐星加成${akashiListLode ? ` ${lodeCreditMark(akashiListLode.meta, '逐星加成来源')}` : ''}</summary>
        <div class="grow-cap">各列为达到该星级后的累计提升</div>
        <div class="improve-star-wrap"><table class="improve-star-table">
          <thead><tr><th>属性</th>${Array.from({ length: 10 }, (_, index) => `<th>★${index + 1}</th>`).join('')}</tr></thead>
          <tbody>${starRows}</tbody>
        </table></div>
      </details>`
    : ''
  return `<div class="sec">
    <div class="sec-h">改修工厂<span class="aux${openToday ? ' ok' : ''}" title="改修日程">${JST_WEEKDAY_LABELS[today]} · ${openToday ? '今日可改修 ✓' : '今日不可改修 ✗'}</span><span class="sp"></span>${eoLode ? lodeCreditMark(eoLode.meta) : ''}</div>
    <div class="akashi">
      ${starTable}${planHtml}
      ${anyConvert ? '' : '<div class="ak-note">当前装备无更新路线 · ★max 为终点</div>'}
    </div>
  </div>`
}

// ---- 深海卷 ----

// 深海卷分两栏：舰 / 装备。装备走 api_mst_slotitem 里 id ≥ 1500 那段
// （EO 的 Equipments.json 实测同一分界：1–588 玩家装备、1500+ 敌方装备，中间无交集）。
type AbyssDetailTab = 'a-cg' | 'a-voice' | 'a-map'
const abyssState = {
  search: '',
  selected: 0,
  open: false,
  tab: 'ship' as 'ship' | 'equip',
  dtab: 'a-cg' as AbyssDetailTab,
  // 两栏各留一份：舰的 chip 名（战舰、空母）在装备栏里没有对应类别，
  // 共用一个字段会导致切过去一条不剩
  shipChip: '全部',
  shipTypeFilter: 0,
  equipChip: '全部',
  equipTypeFilter: 0,
}

/**
 * 深海卷的 chip 只放**这一卷里真有内容**的分组。
 * 深海没有海防舰、没有潜水母舰，把空 chip 摆出来点了一条不剩，是噪声不是功能。
 */
const nonEmptyChips = <T>(labels: T[], has: (label: T) => boolean): T[] => labels.filter(has)

const abyssShipStypeCounts = (): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const s of abyssalShips.values()) counts.set(s.api_stype, (counts.get(s.api_stype) ?? 0) + 1)
  return counts
}

const abyssEquipTypeCounts = (): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const e of abyssalEquips.values()) {
    const cat = Array.isArray(e.api_type) ? e.api_type[2] : 0
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  return counts
}

const abyssShipMoreCategoriesHtml = (): string => {
  const counts = abyssShipStypeCounts()
  // 同样按显示名归并：主数据的 8/9 都叫「戦艦」
  const byLabel = new Map<string, { ids: number[]; count: number }>()
  for (const id of ALL_SHIP_TYPE_IDS) {
    const n = counts.get(id) ?? 0
    if (!n || !mg.master.stypes[id]) continue
    const label = stypeLabelOf(id)
    const slot = byLabel.get(label) ?? { ids: [], count: 0 }
    slot.ids.push(id)
    slot.count += n
    byLabel.set(label, slot)
  }
  const cells = [...byLabel.values()]
    .sort((a, b) => a.ids[0] - b.ids[0])
    .map((slot) => {
      const on = slot.ids.includes(abyssState.shipTypeFilter)
      return `<span class="cat-cell${on ? ' on' : ''}" data-abyss-ship-type="${slot.ids[0]}">
        ${entityNameHtml('shipType', slot.ids[0], mg.master.stypes[slot.ids[0]], { compact: true })}<i>${slot.count}</i></span>`
    })
  return `<div class="cat-more">
    <div class="cat-more-h">按舰种精确筛选<span>共 ${cells.length} 种</span></div>
    <div class="cat-grid">${cells.join('')}</div>
  </div>`
}

const abyssEquipMoreCategoriesHtml = (): string => {
  const counts = abyssEquipTypeCounts()
  const cells = [...equipTypes.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([id, name]) => {
      const n = counts.get(id) ?? 0
      if (!n) return []
      return [
        `<span class="cat-cell${abyssState.equipTypeFilter === id ? ' on' : ''}" data-abyss-equip-type="${id}">
          ${entityNameHtml('equipType', id, name, { compact: true })}<i>${n}</i></span>`,
      ]
    })
  return `<div class="cat-more">
    <div class="cat-more-h">按装备类别精确筛选<span>共 ${cells.length} 类</span></div>
    <div class="cat-grid">${cells.join('')}</div>
  </div>`
}

const abyssTabsHtml = () =>
  `<div class="ab-tabs">
    <span class="ab-tab${abyssState.tab === 'ship' ? ' on' : ''}" data-abtab="ship">深海舰 ${abyssalShips.size}</span>
    <span class="ab-tab${abyssState.tab === 'equip' ? ' on' : ''}" data-abtab="equip">深海装备 ${abyssalEquips.size}</span>
  </div>`

// 哪些深海舰装备了它（abyssal-stats 包的 kc3_slots 反查）
const abyssEquipHolders = (equipId: number): { id: number; name: string; count: number }[] => {
  const out: { id: number; name: string; count: number }[] = []
  for (const [idStr, stats] of Object.entries<any>(abyssalLode?.data ?? {})) {
    const slots: number[] = Array.isArray(stats?.kc3_slots) ? stats.kc3_slots : []
    const n = slots.filter((s) => s === equipId).length
    if (!n) continue
    const ship = abyssalShips.get(+idStr)
    if (ship) out.push({ id: +idStr, name: ship.api_name, count: n })
  }
  return out.sort((a, b) => b.count - a.count || a.id - b.id)
}

const abyssEquipCatalogHtml = () => {
  const q = searchFold(abyssState.search)
  const list = [...abyssalEquips.values()].filter((e) => {
    const cat = Array.isArray(e.api_type) ? e.api_type[2] : 0
    if (abyssState.equipTypeFilter && cat !== abyssState.equipTypeFilter) return false
    if (!equipChipMatches(abyssState.equipChip, cat)) return false
    return (
      !q ||
      searchFold(e.api_name).includes(q) ||
      searchFold(entityNamePlain('abyssEquip', e.api_id, e.api_name)).includes(q)
    )
  })
  // 按类别 id 分组、按 id 排序：与装备卷同序，两卷之间能对照着翻
  const groups = new Map<number, any[]>()
  for (const e of list) {
    const cat = Array.isArray(e.api_type) ? e.api_type[2] : 0
    groups.set(cat, [...(groups.get(cat) ?? []), e])
  }
  const rows = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cat, items]) => {
      // 类别名要走本地化：不走的话装备卷显示「舰载轰炸机」、深海卷显示「艦上爆撃機」，
      // 同一份主数据在两卷里是两种语言
      const typeName = entityNamePlain('equipType', cat, equipTypes.get(cat) ?? `分类${cat}`)
      const rowsHtml = items
        .sort((a, b) => a.api_id - b.api_id)
        .map((e) => {
          const on = e.api_id === abyssState.selected && abyssState.open
          return `<div class="row${on ? ' on' : ''}" data-abequip="${e.api_id}" style="--rc:#5c2c38">
            <div class="face eqface">${equipTypeIconHtml(Array.isArray(e.api_type) ? e.api_type[3] : 0, { className: 'lg abyss', title: entityNamePlain('abyssEquip', e.api_id, e.api_name) })}</div>
            <div class="nm"><b style="color:#e8b8c0">${entityNameHtml('abyssEquip', e.api_id, e.api_name, { compact: true })}</b><span>ID ${e.api_id}</span></div>
          </div>`
        })
        .join('')
      return groupBoxHtml(
        `abyssEquip:${typeName}`,
        `<b>${entityTermHtml('abyssEquip', undefined, typeName)}</b><span class="cnt">${items.length}</span>`,
        rowsHtml,
      )
    })
    .join('')
  const counts = abyssEquipTypeCounts()
  const chips = nonEmptyChips(EQUIP_CHIPS, (label) =>
    label === '全部' || [...counts.keys()].some((cat) => equipChipMatches(label, cat)),
  )
  return `${abyssTabsHtml()}
    <div class="search-row"><div class="search">⌕<input id="ji-abyss-search" placeholder="深海装备名" value="${esc(abyssState.search)}"></div></div>
    <div class="type-chips">${chips
      .map(
        (label) =>
          `<span class="chip${label === abyssState.equipChip && !abyssState.equipTypeFilter ? ' on' : ''}" data-abyss-equip-chip="${label}">${label}</span>`,
      )
      .join('')}
      <span class="chip more${moreCategoriesOpen ? ' on' : ''}" data-more-cat>更多分类 ${moreCategoriesOpen ? '▴' : '▾'}</span>
      ${abyssState.equipTypeFilter ? `<span class="chip on linked-filter" data-clear-abyss-scope>${entityNameHtml('equipType', abyssState.equipTypeFilter, equipTypes.get(abyssState.equipTypeFilter) ?? `分类${abyssState.equipTypeFilter}`, { compact: true })} ×</span>` : ''}
    </div>
    <div class="ship-list" id="ji-abyss-list">${
      // 分类面板长在**滚动容器里面**，与 `shipCatalogHtml` 同一处置。此前它挂在
      // .ship-list 外面、当竖列的兄弟：25 枚 cat-cell 在 280px 窄坞里要排 10 行、
      // 整块 294px，而坞拖到下限时 .index 只有 261px（#wb-mid 的 min-height:300px
      // 是真下限），列表当场被压成 0 高、面板底部 204px 被 .mod-ji 的
      // overflow:hidden 裁掉。裁掉那截玩家够不着：整条祖先链上没有一个
      // overflow-y:auto，只有 .mod-ji 自己能被脚本滚（overflow:hidden 的盒子
      // 有 scrollTop 没滚动条，滚轮推不动）。放进来之后面板与列表共用
      // .ship-list 这一个滚动条，列表最窄也还剩 81px。
      moreCategoriesOpen ? abyssEquipMoreCategoriesHtml() : ''
    }${rows || '<div style="padding:20px;color:var(--dim)">暂无匹配项</div>'}</div>`
}

const ABYSS_EQUIP_FIELDS: [string, string][] = [
  ['api_houg', '火力'], ['api_raig', '雷装'], ['api_tyku', '对空'], ['api_souk', '装甲'],
  ['api_baku', '爆装'], ['api_tais', '对潜'], ['api_houm', '命中'], ['api_houk', '回避'],
  ['api_saku', '索敌'], ['api_leng', '射程'],
]

const abyssEquipDrawerHtml = () => {
  const e = abyssalEquips.get(abyssState.selected)
  if (!e) return ''
  const iconId = Array.isArray(e.api_type) ? e.api_type[3] : 0
  // 类别名走本地化：只修目录不修抽屉，会变成列表里写「大口径主炮」、
  // 点进去标题写「大口径主砲」
  const abyssCat = Array.isArray(e.api_type) ? e.api_type[2] : 0
  const typeName = entityNamePlain('equipType', abyssCat, equipTypes.get(abyssCat) ?? `分类${abyssCat}`)
  // 深海装备没有 card 卡面，但飞机类在 item_up 下有真实装备立绘（slotItemImageUrl
  // 会自动换过去）；火炮类只有艺术字标题、取不到装备图，靠 img 的 404 回退露出类别图标。
  // 无论如何都不要减 1000 去撞同号玩家装备。
  const art = slotItemImageUrl(e.api_id, 'card')
  // 射程是档位不是数值——按玩家装备同一张 LENG_LABEL 翻译,深海独有第 5 档(超超长)
  const chips = ABYSS_EQUIP_FIELDS.filter(([k]) => (e[k] ?? 0) !== 0)
    .map(([k, label]) => `<span class="misc-stat">${label} <b>${k === 'api_leng' ? LENG_LABEL[e[k]] ?? `档${e[k]}` : e[k]}</b></span>`)
    .join('')
  const holders = abyssEquipHolders(e.api_id)
  const holderRows = holders
    .slice(0, 30)
    .map(
      (h) => `<div class="dq-row"><span class="dq-map">${elink('abyssShip', h.id, h.name)}</span>
        <span class="dq-cell"></span><span class="dq-n">${h.count > 1 ? `×${h.count}` : ''}</span></div>`,
    )
    .join('')
  // 制空値：单件装备按满搭载算没有意义，这里只给「参与制空的机种」标记
  const t2 = Array.isArray(e.api_type) ? e.api_type[2] : 0
  const fights = [6, 7, 8, 11, 45, 47, 57].includes(t2) || (t2 === 26 && (e.api_tyku ?? 0) > 0)
  return `
  <div class="d-head">
    <span class="x" id="ji-abyss-close" title="关闭（Esc）">✕</span>
    <span class="crumb">深海装备 › <b>${entityNameHtml('abyssEquip', e.api_id, e.api_name, { compact: true })}</b></span><span class="sp"></span>
  </div>
  <div class="detail">
    <div class="hero" style="background:radial-gradient(420px 200px at 85% 0%,rgba(255,107,129,.08),transparent 65%),var(--bg1)">
      <div class="hero-l">
        <div class="meta-line"><span class="badge" style="color:#e8b8c0;border-color:#5c2c38">${entityTermHtml('abyssEquip', e.api_id, typeName)}</span>
          <span class="no">ID ${e.api_id}</span></div>
        <div class="name-block"><h1 style="font-size:22px">${entityNameHtml('abyssEquip', e.api_id, e.api_name)}</h1></div>
        <div class="own-line">
          ${fights ? '<span class="own-pill">参与制空争夺</span>' : ''}
          ${holders.length ? `<span class="own-pill">${holders.length} 种深海舰搭载</span>` : ''}
        </div>
      </div>
      ${
        art
          ? `<div class="equip-art abyss has" data-cg="${esc(art)}">
              <img src="${esc(art)}" alt="${esc(entityNamePlain('abyssEquip', e.api_id, e.api_name))} 卡面" data-equip-art="${e.api_id}">
            </div>`
          : `<div class="equip-art abyss">${equipTypeIconHtml(iconId, { className: 'hero-icon abyss', title: entityNamePlain('abyssEquip', e.api_id, e.api_name) })}
              <div class="cap">深海装备无独立官方卡面</div></div>`
      }
    </div>
    <div class="sec"><div class="sec-h">数值<span class="aux">游戏基础数据原值</span></div>
      <div class="misc-line">${chips || '<span style="font-size:11.5px;color:var(--dim)">全为 0</span>'}</div>
    </div>
    ${equipArtPanelHtml(e.api_id, true)}
    ${
      holderRows
        ? `<div class="sec"><div class="sec-h">搭载舰<span class="aux">${holders.length} 种 ${abyssalLode ? lodeCreditMark(abyssalLode.meta, '搭载表来自 abyssal-stats 的社区估算') : ''}</span></div>
      ${holderRows}</div>`
        : `<div class="sec"><div class="sec-h">搭载舰</div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
        暂无深海舰搭载当前装备的记录</div></div>`
    }
    <div class="foot"><span class="credit-mark" title="名称与数值 · 游戏基础数据 · 更新于 ${masterTs ? fmtDate(masterTs) : '—'}">源</span></div>
  </div>`
}

// ---- 工厂实测反查：这件东西你自己开/造出来过几次 ----
//
// 账本里的工厂统计是「配方 → 结果」（史的工厂实测就是那么摆的），
// 而站在图鉴的某件装备、某艘舰面前，想问的是反过来那一句。
// 同一份数据，差的只是一次反查——这两块以前互相不知道对方存在。
//
// 与 wiki 的推定出货率**并列摆，不合并**：那张表是社区大样本的推定，
// 这里是你自己的确认结果，样本量差几个数量级，放一起会让人以为百分比可比。
const FACTORY_WINDOW_MS = 90 * 24 * 3600 * 1000
const FACTORY_TTL_MS = 30_000
let factoryStats: FactoryStatsReport | null = null
let factoryStatsTs = 0
let factoryStatsFailed = false
let factoryStatsLoading = false

const ensureFactoryStats = () => {
  if (factoryStatsLoading) return
  // 闸门只认时间戳，不认「手上有没有数据」：失败时 factoryStats 仍是 null，
  // 拿它当条件等于闸门不存在——每次重渲染都会再打一遍同一个必败的查询，
  // 而 catch 里又 scheduleRender，于是 rAF 把它变成 60Hz 的 IPC 循环
  // （装备抽屉一打开就常驻触发）。失败也推时间戳，TTL 到了再重试。
  if (factoryStatsTs && Date.now() - factoryStatsTs < FACTORY_TTL_MS) return
  factoryStatsLoading = true
  void jiIpc
    .invoke('mg:factory-stats', Date.now() - FACTORY_WINDOW_MS)
    .then((report: FactoryStatsReport) => {
      factoryStats = report
      factoryStatsTs = Date.now()
      factoryStatsFailed = false
      factoryStatsLoading = false
      scheduleRender()
    })
    .catch((error: unknown) => {
      // 读失败要说读失败：空报告会被渲染成「你没造出过她」，那是把故障说成事实
      console.warn('[kanso] 工厂实测读取失败', error)
      factoryStatsFailed = true
      factoryStatsTs = Date.now() // 墓碑：这一轮别再重试，等 TTL
      factoryStatsLoading = false
      scheduleRender()
    })
}

/**
 * 「你自己造/开出过她几次，用的什么配方」。
 *
 * 出货率只在样本够时才报百分比；分母用**出过它的那些配方**的尝试数——
 * 把从没出过它的配方也算进去，只会得到一个更小的、谁也解释不了的数。
 */
const factoryOwnHtml = (mstId: number, kind: 'ship' | 'item'): string => {
  if (!(mstId > 0)) return ''
  ensureFactoryStats()
  const verb = kind === 'ship' ? '建造' : '开发'
  const unit = kind === 'ship' ? '艘' : '件'
  if (factoryStatsFailed) {
    return `<div class="sec"><div class="sec-h">${verb}实测<span class="aux">本地账本</span></div>
      <div class="q-foot">工厂记录读取失败</div></div>`
  }
  if (!factoryStats) return ''
  const found = factoryLookup(factoryStats[kind], mstId)
  // 账本里压根没有这一类的记录时不摆空壳：那是「还没开始记」，不是「你没出过」
  if (!found.totalAttempts) return ''
  if (!found.hits) {
    return `<div class="sec"><div class="sec-h">${verb}实测<span class="aux">本地账本</span></div>
      <div class="q-foot">近 90 日本地${verb} ${found.totalAttempts} 次 · 暂无该舰记录</div>
    </div>`
  }
  const rows = found.recipes
    .slice(0, 6)
    .map((row) => {
      const rate =
        row.attempts >= PERSONAL_RATE_MIN_SAMPLES
          ? `<span class="fo-rate">${((row.hits / row.attempts) * 100).toFixed(1)}%</span>`
          : `<span class="fo-rate low">样本 ${row.attempts}</span>`
      return `<div class="fo-row">
        <span class="fo-recipe">${esc(recipeText(row.recipe))}${
          row.secretary ? ` · ${esc(row.secretary)}秘书` : ''
        }</span>
        <span class="fo-hit"><b>${row.hits}</b> ${unit} / ${row.attempts} 次</span>
        ${rate}
        <span class="fo-when">${fmtDate(row.firstTs)}—${fmtDate(row.lastTs)}</span>
      </div>`
    })
    .join('')
  return `<div class="sec">
    <div class="sec-h">${verb}实测<span class="aux">本地账本 · 近 90 日</span></div>
    <div class="fo-head">本地${verb}成功 <b>${found.hits}</b> ${unit} · ${found.recipes.length} 个配方（对应配方合计 ${found.attempts} 次；同期全部${verb} ${found.totalAttempts} 次）</div>
    ${rows}
    ${found.recipes.length > 6 ? `<div class="q-foot">另有 ${found.recipes.length - 6} 个成功配方未展开</div>` : ''}
    <div class="q-foot">本地结果 · 样本少于 ${PERSONAL_RATE_MIN_SAMPLES} 次的配方仅显示次数</div>
  </div>`
}

/**
 * 「这件装备怎么开发出来」——秘书舰类型 × 最大资材表 → 出货率。
 *
 * 出货率是社区大样本统计的**推定值**，不是游戏给的规则：游戏内部的开发表不公开，
 * 页面上的百分比是玩家攒出来的。所以按推定标注；表本身不完整这件事由包的 note
 * 与「源」记号交代。
 * 按日文名匹配——表里用的就是日文名，不做任何模糊匹配。
 */
const devRecipeHtml = (jpName: string, mstId: number): string => {
  const list = devRecipeLode?.data?.equipment?.[jpName] as
    | { secretary: string; table: string; rate: number }[]
    | undefined
  const mine = factoryOwnHtml(mstId, 'item')
  if (!list?.length) return mine
  // 投料参考是本地推导：理論値（廃棄資材×10、每项下限 10）+ 目标表资材抬到
  // 严格最高，两条都是 wiki 明文规则。46cm 弹药表由此得 10/251/250/10。
  // 行序「秘书舰 → 投多少 → 几率」先回答玩家要做的事；「表」是机制归类，
  // 降级成暗色小标注，因果讲解放进悬停——第一次见的人不该先撞上行话。
  const broken = friendlyEquips.get(mstId)?.api_broken
  const rows = list
    .map((entry) => {
      const reference = devReferenceRecipe(broken, entry.table)
      const maxed = entry.table === '弹药' ? '弹药' : entry.table === '铝' ? '铝' : '钢（或燃料）'
      const explain = reference
        ? `秘书舰：${entry.secretary} · 投料 燃${reference[0]}/弹${reference[1]}/钢${reference[2]}/铝${reference[3]} · 估算出货率 ${entry.rate}% · 最高投入项：${maxed} · 达到开发理论值后结果池不变`
        : `秘书舰：${entry.secretary} · 最高投入项：${maxed} · 估算出货率 ${entry.rate}%`
      return `<div class="dv-row" title="${esc(explain)}">
      <span class="dv-sec">${esc(entry.secretary)}</span>
      <span class="dv-recipe">${reference ? reference.join('/') : '—'}</span>
      <span class="dv-tab">${esc(entry.table)}表</span>
      <span class="dv-rate">${entry.rate}%</span>
    </div>`
    })
    .join('')
  return `<div class="sec"><div class="sec-h">开发<span class="aux">社区统计估算 ${
    devRecipeLode?.meta
      ? lodeCreditMark(
          devRecipeLode.meta,
          '开发结果条件：秘书舰类型 + 最高投入项（「所属表」；钢与燃共用一表）。投料参考为达到开发理论值的最低值（该装备废弃返还 ×10、每项下限 10）；同表额外投入不改变结果池',
        )
      : ''
  }</span></div>
    <div class="dv-head">秘书舰 · 投料参考（燃/弹/钢/铝） · 所属表 → 出货率</div>
    ${rows}
  </div>`
}

/**
 * 「这艘怎么建出来」——wikiwiki「建造レシピ」的报告配方与建造时间一览。
 *
 * 備考是「报告较多的配方」的社区口径，**不是概率表**（页面自己就没有概率），
 * 照此标注。配方池按目标舰种分节共用，具体到单舰只有備考里的报告；
 * 建造时间在领取前唯一提示身份，所以一并给出。舰名按改造链根匹配——
 * 建造产出的是初始形态。
 */
const BUILD_TARGET_BY_STYPE: Record<number, string> = {
  2: '駆逐艦',
  3: '軽巡洋艦',
  4: '軽巡洋艦', // 雷巡（北上・大井）走軽巡配方池，时间表里也在軽巡段
  5: '重巡洋艦',
  8: '戦艦',
  9: '戦艦',
  7: '空母',
  11: '空母',
  18: '空母',
  13: '潜水艦',
  14: '潜水艦',
}

const buildRefHtml = (mstId: number): string => {
  const data = buildRecipeLode?.data
  if (!data) return ''
  const root = friendlyShips.get(rootOf.get(mstId) ?? mstId)
  if (!root) return ''
  const name = `${root.api_name}`
  const hits = (data.times as { time: string; stype: string; ships: string[]; largeOnly: string[] }[])
    .map((row) => ({ row, normal: row.ships.includes(name), large: row.largeOnly.includes(name) }))
    .filter((hit) => hit.normal || hit.large)
  if (!hits.length) return '' // 通常与大型名单都没有她；获取途径由掉落区回答
  const normalBuildable = hits.some((hit) => hit.normal)
  const recipes = normalBuildable
    ? ((data.recipes as { target: string; recipe: number[]; note: string }[]).filter(
        (entry) => entry.target === BUILD_TARGET_BY_STYPE[root.api_stype],
      ))
    : [] // 大型限定舰：这页只有通常建造的配方池
  const timeLine = hits
    .map(({ row, normal, large }) =>
      `<b>${esc(row.time)}</b>（${normal && large ? '通常・大型' : large ? '大型艦建造限定' : '通常建造'}）`)
    .join(' · ')
  const recipeRows = recipes
    .slice(0, 8)
    .map((entry) => {
      const note = entry.note.length > 90 ? `${entry.note.slice(0, 90)}…` : entry.note
      // 備考里点到的舰名/装备名走同一套名字索引联实体（「まるゆ狙い」这类）
      return `<div class="br-row"><span class="br-recipe">${entry.recipe.join('/')}</span><span class="br-note">${exchangeGetsHtml(note)}</span></div>`
    })
    .join('')
  return `<div class="sec"><div class="sec-h">建造参考<span class="aux">社区报告口径 ${
    buildRecipeLode?.meta
      ? lodeCreditMark(
          buildRecipeLode.meta,
          '配方（燃/弹/钢/铝）按舰种汇总社区报告 · 非概率表；单舰出货依据备注报告；特殊条件见来源页',
        )
      : ''
  }</span></div>
    <div class="dv-head">建造時間 ${timeLine}</div>
    ${recipeRows}
    ${recipes.length > 8 ? `<div class="q-foot">另有 ${recipes.length - 8} 条同舰种配方未展开</div>` : ''}
  </div>`
}

/**
 * 深海舰目录按舰种分组，每组接可折叠组头（默认全展开，见 `groupBoxHtml`）。
 *
 * 按舰种名分组、按最小舰种 id 排序：与舰娘卷同序（驱逐→轻巡→重巡→战舰→空母……）。
 * 原来是 Map 的插入顺序，最大的一组（航空戦艦 233 条）能排到第 10 位。
 * 按**名字**而不是 id 归并，是因为主数据把 8 和 9 都叫「戦艦」，
 * 按 id 分会得到相邻两个标题一模一样的组——舰娘卷一直是按名字分的。
 *
 * 分出来是为了能单独测（分组结构、组头计数、筛空的舰种不留空组头）：
 * 宿主 `abyssCatalogHtml` 牵着 tab 条、chip 栏与搜索框，整只切不出来。
 *
 * 传进来的 `list` **已经筛过**（chip / 舰种 / 搜索都在调用方），所以筛空的舰种
 * 根本进不到这里，不会剩下一个空组头。
 */
const abyssShipGroupsHtml = (list: any[]): string => {
  const groups = new Map<string, { stype: number; items: any[] }>()
  for (const s of list) {
    const label = stypeLabelOf(s.api_stype)
    const slot = groups.get(label) ?? { stype: s.api_stype, items: [] as any[] }
    slot.stype = Math.min(slot.stype, s.api_stype)
    slot.items.push(s)
    groups.set(label, slot)
  }
  return [...groups.entries()]
    .sort((a, b) => a[1].stype - b[1].stype)
    .map(([typeName, slot]) => {
      const items = slot.items
      // 名字与 api_yomi 都相同的几个编号是同一形态的不同难度档（实测 889 条 → 354 个
      // 形态，182 组恰好 3 个编号）。平铺等于把同一行重复十几遍，这里一个形态一行。
      const forms = new Map<string, any[]>()
      for (const s of items.sort((a, b) => a.api_id - b.api_id)) {
        const key = `${s.api_name ?? ''}|${s.api_yomi ?? ''}`
        const group = forms.get(key)
        if (group) group.push(s)
        else forms.set(key, [s])
      }
      const rowsHtml = [...forms.values()]
        .map((group) => {
          // 从别处跳进某个具体编号时高亮这一行，再点也停在那个编号上，不要弹回首档
          const current = group.find((s) => s.api_id === abyssState.selected)
          const s = current ?? group[0]
          const on = !!current && abyssState.open
          const tiers =
            group.length > 1
              ? ` · <span class="tier" title="${esc(`${group.length} 个编号：${group.map((f) => f.api_id).join(' / ')} · 同形态的不同难度档`)}">${group.length} 档</span>`
              : ''
          return `<div class="row${on ? ' on' : ''}" data-abyss="${s.api_id}" style="--rc:#5c2c38">
            <div class="face shipface">${shipThumbHtml(s.api_id, entityNamePlain('abyssShip', s.api_id, s.api_name), { className: 'catalog', abyss: true })}</div>
            <div class="nm"><b style="color:#e8b8c0">${entityNameHtml('abyssShip', s.api_id, s.api_name, { compact: true })}${s.api_yomi && s.api_yomi !== '-' && s.api_yomi !== s.api_name ? ` ${esc(s.api_yomi)}` : ''}</b><span>ID ${s.api_id}${tiers}</span></div>
          </div>`
        })
        .join('')
      // 计数报形态数：跟列表行数对得上，否则「23」下面只有 8 行会让人以为漏了
      return groupBoxHtml(
        `abyssShip:${typeName}`,
        `<b>${entityTermHtml('abyssShip', undefined, typeName)}</b><span class="cnt" title="${esc(`${forms.size} 个形态 · 共 ${items.length} 个编号`)}">${forms.size}</span>`,
        rowsHtml,
      )
    })
    .join('')
}

const abyssCatalogHtml = () => {
  if (abyssState.tab === 'equip') return abyssEquipCatalogHtml()
  const list = [...abyssalShips.values()].filter((s) => {
    // 同名舰种一起筛，与面板上归并后的格子对得上
    if (abyssState.shipTypeFilter && !stypeSiblings(abyssState.shipTypeFilter).includes(s.api_stype)) return false
    if (!shipChipMatches(abyssState.shipChip, s.api_stype)) return false
    if (!abyssState.search) return true
    const q = searchFold(abyssState.search)
    return (
      searchFold(s.api_name).includes(q) ||
      searchFold(entityNamePlain('abyssShip', s.api_id, s.api_name)).includes(q)
    )
  })
  const rows = abyssShipGroupsHtml(list)
  const counts = abyssShipStypeCounts()
  // 收藏是玩家侧的轴，深海没有；海防舰等深海压根没有的舰种也不摆空 chip
  const chips = nonEmptyChips(
    SHIP_CHIPS.map(([label]) => label).filter((label) => label !== '收藏'),
    (label) => label === '全部' || [...counts.keys()].some((stype) => shipChipMatches(label, stype)),
  )
  return `${abyssTabsHtml()}
    <div class="search-row"><div class="search">⌕<input id="ji-abyss-search" placeholder="深海舰名" value="${esc(abyssState.search)}"></div></div>
    <div class="type-chips">${chips
      .map(
        (label) =>
          `<span class="chip${label === abyssState.shipChip && !abyssState.shipTypeFilter ? ' on' : ''}" data-abyss-ship-chip="${label}">${label}</span>`,
      )
      .join('')}
      <span class="chip more${moreCategoriesOpen ? ' on' : ''}" data-more-cat>更多分类 ${moreCategoriesOpen ? '▴' : '▾'}</span>
      ${abyssState.shipTypeFilter ? `<span class="chip on linked-filter" data-clear-abyss-scope>${entityNameHtml('shipType', abyssState.shipTypeFilter, mg.master.stypes[abyssState.shipTypeFilter] ?? `舰种${abyssState.shipTypeFilter}`, { compact: true })} ×</span>` : ''}
    </div>
    <div class="ship-list" id="ji-abyss-list">${
      // 同 `abyssEquipCatalogHtml`：面板住在滚动容器里面。13 枚 cat-cell 比装备页少一半，
      // 但窄坞里仍排 5 行 165px，坞拖到下限时列表照样归零、最后一行舰种够不着。
      moreCategoriesOpen ? abyssShipMoreCategoriesHtml() : ''
    }${rows || '<div style="padding:20px;color:var(--dim)">暂无匹配项</div>'}</div>`
}

// KC3 abyssal_stats 字段 → 标签（api_* 为解包观测值，kc3_* 为社区推定）
// kc3_tacc 的语义已对 KC3 模拟器文档核实(torpedo accuracy);kc3_cvnb 文档里
// 查无定义,拿不准名字就不上屏(数据诚实)。
const ABYSS_STAT_FIELDS: [string, string][] = [
  ['api_taik', '耐久'], ['api_houg', '火力'], ['api_raig', '雷装'], ['api_tyku', '对空'],
  ['api_souk', '装甲'], ['api_luck', '运'], ['kc3_evas', '回避*'], ['kc3_asw', '对潜*'],
  ['kc3_los', '索敌*'], ['kc3_tacc', '雷击命中*'],
]

// 单舰制空与我方需求档（03 稿「制空三阈值」）。
// 深海装备无改修无熟练度，故只有裸值一档，不存在区间。
// 阈值口径 = 战斗计算模型 §13.2，与镝的战斗计算同一套。
const abyssAirHtml = (packStats: any): string => {
  const slots: number[] = Array.isArray(packStats?.kc3_slots) ? packStats.kc3_slots : []
  const maxeq: number[] = Array.isArray(packStats?.api_maxeq) ? packStats.api_maxeq : []
  if (!slots.length) return ''
  const air = rawAirPower(slots.map((mstId, i) => ({ mstId, count: maxeq[i] ?? 0 })))
  if (air <= 0) {
    return `<div class="ab-air none">制空值 <b>0</b>：没有搭载参与制空的机种</div>`
  }
  const th = airThresholds(air)
  return `<div class="ab-air">
    <div class="ab-air-h">制空值 <b>${air}</b><span>搭载数按社区估算</span></div>
    <div class="ab-air-th">
      <span class="ab-t low">劣势 ${th.劣势}</span>
      <span class="ab-t">均衡 ${th.均衡}</span>
      <span class="ab-t ok">优势 ${th.优势}</span>
      <span class="ab-t ok2">确保 ${th.确保}</span>
    </div>
    <div class="ab-air-n">数字是我方需要达到的制空值</div>
  </div>`
}

// ---- 分歧实测：这张图上罗盘实际把你带去过哪几次（本地航路志）----
//
// 与带路规则并列，不混在一起：规则说「满足什么条件会去哪」，
// 固定分歧（50/50 那种）满足与否都一样——只有自己走过的次数
// 能回答「这条路我到底吃到过几回」。
let mapRouteTally: {
  code: string
  tally: Map<string, BranchTally>
  // 原始的边号去向表。字母版（`tally`）要靠 fcd 的 route 翻译，新图上翻不出来；
  // 而本机实测点位图正是**新图专用**的那一层，只能吃原始边号（见 shared/local-map-topology）。
  // 同一次 IPC 的两种用法，不为它再拉一趟。
  branches: Record<number, Record<number, number>> | null
  total: number
  failed: boolean
} | null = null

let mapRouteTallyPending = ''
const loadMapRouteTally = (code: string, mapId: number) => {
  // 结果没到之前每次重渲染都会再走到这里：不记在途 key 就是重复 IPC 风暴
  if (mapRouteTally?.code === code || mapRouteTallyPending === code) return
  mapRouteTallyPending = code
  mapRouteTally = null
  void jiIpc
    .invoke('chron:route-stats', mapId)
    .then((report: RouteStatsReport) => {
      // 在途守卫也要挡**写**：换了图之后旧请求才回来，照写就是旧盖新，
      // 而下一次渲染又发现 code 对不上再发一遍——页面闪一下，IPC 白跑一趟
      if (mapRouteTallyPending !== code) return
      mapRouteTallyPending = ''
      mapRouteTally = {
        code,
        tally: branchTallyByLetter(report?.branches, fcdMapLode?.data?.[code]?.route),
        branches: report?.branches ?? null,
        total: report?.total ?? 0,
        failed: false,
      }
      if (activeBook === 'map' && mapState.open) scheduleRender()
    })
    .catch((error: unknown) => {
      // 读失败要说读失败：留空会被渲染成「你还没在这张图分歧过」，那是把故障说成事实
      console.warn('[kanso] 分歧实测读取失败', code, error)
      if (mapRouteTallyPending !== code) return
      mapRouteTallyPending = ''
      mapRouteTally = { code, tally: new Map(), branches: null, total: 0, failed: true }
      if (activeBook === 'map' && mapState.open) scheduleRender()
    })
}

// ---- 掉落海域：你在哪张图哪个点捞到过这舰（本地遭遇志）----
//
// 只答实测，不答掉率表：捞到过才有，没捞过就明说「你还没在任何海域捞到过」，
// 不去推「理论上哪里出」——那要掉率口径，本地账本里没有。
// 点位字母走 fcd 的 route[api_no][1]，与节点图同一套。
let shipDrops: { mstId: number; sites: { map: number; cell: number; n: number; last: number; bosses: number }[]; failed: boolean } | null = null

let shipDropsPending = 0
const loadShipDrops = (mstId: number) => {
  // 在途守卫：结果没到之前 scheduleRender 每跑一次都会再进来一次
  if (shipDrops?.mstId === mstId || shipDropsPending === mstId) return
  shipDropsPending = mstId
  shipDrops = null
  void jiIpc.invoke('chron:ship-drops', mstId).then((sites: any) => {
    // 守卫也要挡写：切到别的舰之后这一份才回来，写进去就是旧盖新
    // （下次渲染发现 mstId 对不上还会再发一遍，「获取」页于是闪一下）
    if (shipDropsPending !== mstId) return
    shipDropsPending = 0
    shipDrops = { mstId, sites: sites ?? [], failed: false }
    if (
      activeBook === 'ship' &&
      shipState.selectedForm === mstId &&
      shipState.open &&
      shipState.dtab === 'p-drop'
    ) {
      updateShipDetailPanel()
    }
  }).catch((error: unknown) => {
    // 读失败要说读失败。留空会被渲染成「你还没在任何海域捞到过这一舰」——
    // 那是把故障报告成事实，正是这轮要清掉的东西。
    console.warn('[kanso] 掉落海域读取失败', mstId, error)
    if (shipDropsPending !== mstId) return
    shipDropsPending = 0
    shipDrops = { mstId, sites: [], failed: true }
    if (activeBook === 'ship' && shipState.selectedForm === mstId && shipState.open) {
      updateShipDetailPanel()
    }
  })
}

/**
 * 「这船去哪捞」——把按海域组织的确认掉落目录反查成按舰的答案。
 *
 * 以前这页只有本地遭遇志（你实际捞到过哪），还写着「理论掉落地点本地记录无法提供」；
 * 可离线目录里本来就有确认掉落，只是要逐张海域翻才凑得出来。
 */
const confirmedDropHtml = (mstId: number): string => {
  const direct = confirmedDropSitesOf(mstId)
  // 改造后的形态不会掉，掉的是链根。玩家看「弗莱彻改」时该告诉他去捞「弗莱彻」，
  // 而不是干脆说没有——但必须写明这是未改造形态的掉点，别让人以为改造形态直接能捞。
  const root = rootOf.get(mstId) ?? mstId
  const viaRoot = direct.length || root === mstId ? [] : confirmedDropSitesOf(root)
  const sites = direct.length ? direct : viaRoot
  // 已终了的限定掉点单独取：它们不在上面那份里（目录已经隐去），可玩家问
  // 「这船去哪捞」时，「掉过、但那批限定终了了」比一句「没有」有用得多。
  const endedSubject = direct.length ? mstId : viaRoot.length ? root : mstId
  const ended = endedDropSitesOf(endedSubject)
  if (!sites.length && !ended.length) return ''

  const codeToId = (code: string): number | null => {
    const m = /^(\d+)-(\d+)$/.exec(code)
    return m ? mapIdOf(parseInt(m[1], 10), parseInt(m[2], 10)) : null
  }
  const ordered = [...sites].sort((a, b) => {
    const ida = codeToId(a.map) ?? 0
    const idb = codeToId(b.map) ?? 0
    return ida - idb || (a.difficulty ?? '').localeCompare(b.difficulty ?? '')
  })
  const rowsOf = (list: typeof ordered) =>
    list
      .map((site) => {
        const id = codeToId(site.map)
        const label = `${site.map}${site.difficulty ? ` ${site.difficulty}` : ''}`
        return `<div class="cd-row">
        <span class="cd-map">${id != null ? elink('map', id, label) : esc(label)}</span>
        <span class="cd-node">${esc(site.nodes.join(' / '))} 点</span>
        ${site.limitedOnly ? '<span class="cd-tag gold">仅限定期</span>' : site.limited ? '<span class="cd-tag">有限定期</span>' : ''}
      </div>`
      })
      .join('')
  // 常驻舰掉点能有二十多处（睦月 25 处），全摊开会把这一页淹掉；
  // 真正要查掉点的稀有舰反而只有几处，所以前 10 直出、其余折起来。
  const HEAD = 10
  const rest = ordered.slice(HEAD)
  // 已终了的排在最后、灰显：它们不是「去这儿捞」的线索，是「这儿为什么捞不到了」的交代
  const endedRows = ended
    .map((site) => {
      const id = codeToId(site.map)
      const label = `${site.map}${site.difficulty ? ` ${site.difficulty}` : ''}`
      return `<div class="cd-row ended" title="${esc(limitedWindowText(site.window))}">
        <span class="cd-map">${id != null ? elink('map', id, label) : esc(label)}</span>
        <span class="cd-node">${esc(site.nodes.join(' / '))} 点（限定·已结束）</span>
      </div>`
    })
    .join('')
  return `<div class="sec"><div class="sec-h">确认掉落海域<span class="aux">离线海域资料 · ${ordered.length} 处${
    viaRoot.length ? ' · 未改造形态' : ''
  }</span></div>
    ${
      viaRoot.length
        ? `<div class="cd-note">掉落点：<b>${esc(masterShipName(root))}</b></div>`
        : ''
    }
    ${rowsOf(ordered.slice(0, HEAD))}
    ${rest.length ? `<details class="cd-more" data-keep="cd-more-${mstId}"><summary>另有 ${rest.length} 处</summary>${rowsOf(rest)}</details>` : ''}
    ${endedRows}
  </div>`
}

const shipDropHtml = (mstId: number): string => {
  loadShipDrops(mstId) // 按需取，取到了再重画
  if (shipDrops?.mstId !== mstId) return ''
  const sites = shipDrops.sites
  if (shipDrops.failed) {
    return `<div class="sec"><div class="sec-h">掉落海域<span class="aux">本地遭遇志</span></div>
      <div class="af-empty">遭遇志读取失败
        <button class="pf-btn" data-ship-drops-retry="${mstId}">重试</button></div></div>`
  }
  if (!sites.length) {
    return `<div class="sec"><div class="sec-h">掉落海域<span class="aux">本地遭遇志</span></div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
        暂无本舰掉落记录</div></div>`
  }
  const letterOf = (map: number, cell: number): string => {
    const code = mapCodeOf(map)
    return fcdMapLode?.data?.[code]?.route?.[`${cell}`]?.[1] ?? `#${cell}`
  }
  const rows = sites
    .slice(0, 12)
    .map((s) => {
      const code = mapCodeOf(s.map)
      return `<div class="dq-row">
        <span class="dq-map">${elink('map', s.map, code)}</span>
        <span class="dq-cell">${esc(letterOf(s.map, s.cell))} 点${s.bosses ? ' <i>Boss</i>' : ''}</span>
        <span class="dq-n">×${s.n}</span>
        <span class="dq-t">${fmtTime(s.last)}</span>
      </div>`
    })
    .join('')
  const total = sites.reduce((a, s) => a + s.n, 0)
  return `<div class="sec"><div class="sec-h">掉落海域<span class="aux">本地遭遇志 · 共捞到 ${total} 次</span></div>
    <div class="first-row">${firstEncounterLineHtml('drop', mstId)}</div>
    ${rows}
  </div>`
}

// ---- 战绩：你遇到过这舰几次、击沉几艘（本地遭遇志）----
//
// 遭遇数覆盖全部历史；击沉数只能从带 sunk_mask 的记录里数——那一列是后加的，
// 之前的遭遇记录没有。两个口径分母不同，故分别显示并写明，
// 绝不拿评级去倒推「大概沉了几艘」把两者混成一个数。
let abyssKills: Record<number, { met: number; killed: number; withMask: number }> | null = null
// 出击一晚战绩仍是启动时快照就成了假数据：sortie 变化标脏，下次要用时再拉
let abyssKillsStale = false
let abyssKillsLoading = false
const ensureAbyssKills = () => {
  if (abyssKillsLoading || (abyssKills !== null && !abyssKillsStale)) return
  abyssKillsLoading = true
  void jiIpc
    .invoke('chron:abyss-kills')
    .then((k: any) => {
      abyssKills = k ?? {}
      abyssKillsStale = false
      abyssKillsLoading = false
      render()
    })
    .catch((error: unknown) => {
      // 失败不清手上这份；也不立刻重试（脏标记清掉，等下一次 sortie 变化）
      abyssKillsStale = false
      abyssKillsLoading = false
      console.warn('[kanso] 深海战绩读取失败', error)
    })
}

// 这艘深海舰在哪些图出现过（本地遭遇志的敌编成反查）。
// 只答你自己遇到过的，不答「理论上哪里刷」——那要全服编成表。
let abyssMapsCache: { at: number; data: Map<number, AbyssSeenMap[]> } | null = null
let abyssMapsLoading = false
const abyssSeenMaps = (mstId: number): AbyssSeenMap[] => {
  // 过期只是「该去拿新的了」，不是「手上这份作废」——原先到点先换成空 Map 再拉，
  // 于是看深海卷超过 60 秒后随便一次重渲染，「出现海域」就会空一下再填回来。
  if (!abyssMapsLoading && (!abyssMapsCache || Date.now() - abyssMapsCache.at > 60000)) {
    abyssMapsLoading = true
    void jiIpc.invoke('chron:abyss-maps').then((rows: any) => {
      const m = new Map<number, AbyssSeenMap[]>()
      for (const r of rows ?? []) m.set(r.mstId, r.maps)
      abyssMapsCache = { at: Date.now(), data: m }
      scheduleRender()
    }).catch((error: unknown) => {
      console.warn('[kanso] 深海出现海域读取失败', error)
      // 失败也把时间戳推后：否则每次重渲染都会再打一遍同一个必败的查询
      abyssMapsCache = { at: Date.now(), data: abyssMapsCache?.data ?? new Map() }
    }).finally(() => {
      abyssMapsLoading = false
    })
  }
  return abyssMapsCache?.data.get(mstId) ?? []
}

const abyssFamily = (ship: any): any[] => {
  const key = abyssFamilyKey(ship.api_name ?? '')
  return [...abyssalShips.values()]
    .filter((candidate) => abyssFamilyKey(candidate.api_name ?? '') === key)
    .sort((a, b) => a.api_id - b.api_id)
}

/**
 * 把一族再拆成「形态」：名字与 api_yomi 都相同的算同一形态，组内那几个编号是难度档。
 *
 * 实测 2026-08-09（889 条深海条目 → 354 个形态）：182 组恰好 3 个编号，
 * 多编号形态里 213/251 是完全连号的——「连着的几个 = 同形态的不同难度」是主流。
 * 但飛行場姫 一组就有 18 个编号（多半跨了好几次活动），另有 38 组不连号，
 * 所以只说「几个编号 · 同形态的不同难度档」，**绝不去猜哪个是甲哪个是乙**：
 * 主数据里没有难度字段，标出来的会是编的。
 */
const abyssFormGroups = (forms: any[]): { label: string; broken: boolean; members: any[] }[] => {
  // 族里最短的那个名字当基名，其余名字减掉它就是形态后缀（-壊 / 改 / バカンスmode…）
  const base = forms.reduce(
    (shortest: string, f: any) =>
      (f.api_name ?? '').length < shortest.length ? (f.api_name ?? '') : shortest,
    (forms[0]?.api_name ?? '') as string,
  )
  const groups = new Map<string, { label: string; broken: boolean; members: any[] }>()
  for (const form of forms) {
    const name: string = form.api_name ?? ''
    const yomi: string = form.api_yomi && form.api_yomi !== '-' ? form.api_yomi : ''
    const suffix = name.startsWith(base) ? name.slice(base.length).trim() : name
    const key = `${name}|${yomi}`
    if (!groups.has(key)) {
      groups.set(key, {
        label: [suffix || '通常', yomi].filter(Boolean).join(' · '),
        broken: /[壊坏]$/u.test(suffix),
        members: [],
      })
    }
    groups.get(key)!.members.push(form)
  }
  return [...groups.values()]
}

interface AbyssConfirmedMap {
  code: string
  mapId: number
  nodes: string[]
  difficulties: EventDifficulty[]
}

/** 离线海域情报包中的精确敌舰 ID 反查；活动图按四难度分别保留。 */
// 单次就是 目录 × 难度层 × 节点 × 编成 的全扫，「遭遇地点」页对族内每个形态
// 各来一遍（飛行場姫一族 18 个编号 = 20+ 次全扫），且每次 scheduleRender 重来。
// 按 (目录代号, mstId) 缓存。
const abyssConfirmedCache = new Map<number, AbyssConfirmedMap[]>()
let abyssConfirmedGeneration = -1
const abyssConfirmedMaps = (mstId: number): AbyssConfirmedMap[] => {
  if (abyssConfirmedGeneration !== mapIntelGeneration()) {
    abyssConfirmedCache.clear()
    abyssConfirmedGeneration = mapIntelGeneration()
  }
  const cached = abyssConfirmedCache.get(mstId)
  if (cached) return cached
  const out = abyssConfirmedMapsUncached(mstId)
  abyssConfirmedCache.set(mstId, out)
  return out
}

const abyssConfirmedMapsUncached = (mstId: number): AbyssConfirmedMap[] => {
  const out: AbyssConfirmedMap[] = []
  for (const [code, entry] of mapIntelEntries()) {
    const match = code.match(/^(\d+)-(\d+)$/)
    if (!match) continue
    const mapId = mapIdOf(Number(match[1]), Number(match[2]))
    const nodes = new Set<string>()
    const difficulties = new Set<EventDifficulty>()
    const layers = entry.nodes
      ? [{ nodes: entry.nodes, difficulty: undefined as EventDifficulty | undefined }]
      : EVENT_DIFFICULTIES.flatMap((difficulty) => {
          const layer = entry.difficulties?.[difficulty]
          return layer ? [{ nodes: layer.nodes, difficulty }] : []
        })
    for (const layer of layers) {
      for (const [node, intel] of Object.entries(layer.nodes)) {
        // 反查用定好的号；没定下来的编成不算命中——宁可少列一个点位，
        // 也不能靠运行时猜名字把玩家指到错误的海域去。
        const found = intel.enemyComps.some((comp) =>
          comp.ships.some((token, index) =>
            typeof token === 'number' ? token === mstId : comp.shipIds?.[index] === mstId,
          ),
        )
        if (!found) continue
        nodes.add(node)
        if (layer.difficulty) difficulties.add(layer.difficulty)
      }
    }
    if (nodes.size) {
      out.push({
        code,
        mapId,
        nodes: [...nodes].sort(),
        difficulties: EVENT_DIFFICULTIES.filter((difficulty) => difficulties.has(difficulty)),
      })
    }
  }
  return out.sort((a, b) => a.mapId - b.mapId)
}

// codeOnly：只要编号那一半。活动图的遭遇格里活动名已经写在前面了，
// 再带上「パラオ沖/ウルシ―泊地沖/中部太平洋」这种图名会把一行撑爆。
const mapEntityLabel = (mapId: number, code: string, options: { codeOnly?: boolean } = {}): string => {
  const info = mapInfos.find((candidate) => candidate.api_id === mapId)
  // 「编号 + 名」是复合串：整串拿去比对永远对不上词条，即使 map 域有译名也失效。
  // 名字那半先单独查好译名，再跟编号拼起来。
  const name =
    !options.codeOnly && info?.api_name ? entityNamePlain('map', mapId, info.api_name) : ''
  const label = name ? `${code} ${name}` : code
  return info ? elink('map', mapId, label) : entityTermHtml('map', mapId, label)
}

/**
 * 这张图属于哪一期活动（年份 + 活动名）。不是活动图、或判不出来，返回 null。
 *
 * 年份走 `eventPeriodOf` 那条现成链路（离线活动资料的 from 优先，退回归档的开服日
 * 或本机首见），退役活动图的墓碑并回 `mapInfos` 之后照样算得出。
 * 活动名取区名——游戏自己的 `api_mst_maparea.api_name` 写的就是活动名
 *（实测 62 区＝「反撃！第三十一戦隊の戦い」），归档那边由 mergeArchivedEventMaps 补上。
 */
const seenEventTagOf = (mapId: number): { year: string; name: string } | null => {
  const areaId = mapAreaOf(mapId)
  if (!eventAreaIds.has(areaId)) return null
  const info = mapInfos.find((candidate) => candidate.api_id === mapId)
  const year = info ? (eventPeriodOf(info)?.text.match(/^(\d{4})/)?.[1] ?? '') : ''
  const name = entityNamePlain('mapArea', areaId, mapAreas.get(areaId) ?? '')
  if (!year && !name) return null
  return { year, name }
}

/** 一格里最多摆几个点位；再多的收进 `+N 点`，全量在悬停里 */
const SEEN_CELL_CAP = 4

/**
 * 「我的遭遇」一格。**常规图细到点位，活动图只到图**。
 *
 * 分两类不是偷懒：活动图的 fcd 拓扑多半查无，点位只能显示成「#12」这种边号，
 * 对玩家没有信息量；而记活动 boss 的坐标本来就是「哪年哪期活动」，不是「哪个点」。
 * 常规图反过来——点位字母是现成的，「7-4 的 L」正是玩家会去对的那一格。
 *
 * 点位字母走 fcd 的 route 表翻，查无就如实显示 `#边号`（既有口径，不猜字母）。
 */
const abyssSeenChipHtml = (entry: AbyssSeenMap): string => {
  const code = mapCodeOf(entry.map)
  const total = `×${entry.n} 场`
  const event = seenEventTagOf(entry.map)
  if (event) {
    const head = [event.year, event.name].filter(Boolean).join(' ')
    return `<span class="af-seen" title="${esc(`${head} · ${code} · 共 ${entry.n} 场`)}">${
      event.year ? `<i>${esc(event.year)}</i>` : ''
    }${event.name ? `<em>${esc(event.name)}</em>` : ''}${mapEntityLabel(entry.map, code, {
      codeOnly: true,
    })}<b>${total}</b></span>`
  }
  // cells 可能是空的：点位读不出来的老行归在哨兵上、不进清单（见 shared/abyss-seen），
  // 那时如实退回图级的「×N 场」，别摆一个空的点位位置
  const cells = entry.cells ?? []
  if (!cells.length) {
    return `<span class="af-seen">${mapEntityLabel(entry.map, code)}<b>${total}</b></span>`
  }
  const letterOf = (cell: number): string =>
    fcdMapLode?.data?.[code]?.route?.[`${cell}`]?.[1] ?? `#${cell}`
  const text = (list: AbyssSeenMap['cells']) =>
    list.map((one) => `${letterOf(one.cell)}×${one.n}`).join(' · ')
  const shown = cells.slice(0, SEEN_CELL_CAP)
  const rest = cells.length - shown.length
  return `<span class="af-seen" title="${esc(`${code} · ${text(cells)} · 共 ${entry.n} 场`)}">${mapEntityLabel(
    entry.map,
    code,
  )}<b>${esc(text(shown))}${rest > 0 ? esc(` +${rest} 点`) : ''}</b></span>`
}

const mergeAbyssConfirmedMaps = (ids: number[]): AbyssConfirmedMap[] => {
  const merged = new Map<string, { mapId: number; nodes: Set<string>; difficulties: Set<EventDifficulty> }>()
  for (const id of ids) {
    for (const entry of abyssConfirmedMaps(id)) {
      const current = merged.get(entry.code) ?? {
        mapId: entry.mapId,
        nodes: new Set<string>(),
        difficulties: new Set<EventDifficulty>(),
      }
      entry.nodes.forEach((node) => current.nodes.add(node))
      entry.difficulties.forEach((difficulty) => current.difficulties.add(difficulty))
      merged.set(entry.code, current)
    }
  }
  return [...merged]
    .map(([code, entry]) => ({
      code,
      mapId: entry.mapId,
      nodes: [...entry.nodes].sort(),
      difficulties: EVENT_DIFFICULTIES.filter((difficulty) => entry.difficulties.has(difficulty)),
    }))
    .sort((a, b) => a.mapId - b.mapId)
}

const abyssFormsAndMapsHtml = (ship: any): string => {
  const forms = abyssFamily(ship)
  const formCards = abyssFormGroups(forms)
    .map((group) => {
      const cards = group.members
        .map((form) => {
          const on = form.api_id === ship.api_id
          const seen = abyssSeenMaps(form.api_id)
          const confirmed = abyssConfirmedMaps(form.api_id)
          return `<button class="af-form${on ? ' on' : ''}" data-abyss-form="${form.api_id}"${on ? ' disabled' : ''}>
            ${shipThumbHtml(form.api_id, form.api_name, { className: 'table', abyss: true })}
            <span><b>${entityNameHtml('abyssShip', form.api_id, form.api_name, { compact: true })}</b><i>ID ${form.api_id}${
              confirmed.length ? ` · 目录 ${confirmed.length} 图` : ''
            }${seen.length ? ` · 遭遇 ${seen.length} 图` : ''}</i></span>
          </button>`
        })
        .join('')
      const here = group.members.some((form) => form.api_id === ship.api_id)
      return `<div class="af-fgroup${here ? ' on' : ''}">
        <div class="af-fgroup-h"><b>${esc(group.label)}</b>${
          group.broken ? '<span class="af-fgroup-tag">同难度下的另一形态</span>' : ''
        }${
          group.members.length > 1 ? `<span class="af-fgroup-n">${group.members.length} 个编号 · 同形态的不同难度档</span>` : ''
        }</div>
        <div class="af-forms">${cards}</div>
      </div>`
    })
    .join('')

  const exactConfirmed = abyssConfirmedMaps(ship.api_id)
  const usingFamilyReference = exactConfirmed.length === 0
  const confirmed = usingFamilyReference
    ? mergeAbyssConfirmedMaps(forms.filter((form) => form.api_id !== ship.api_id).map((form) => form.api_id))
    : exactConfirmed
  const confirmedRows = confirmed
    .slice(0, 12)
    .map((entry) => {
      const mini = miniMapSvg(entry.code, entry.mapId, {
        compact: true,
        focusNodes: entry.nodes,
      })
      const detail = [
        entry.difficulties.length ? `${entry.difficulties.join('/')}难度` : '',
        entry.nodes.length ? `${entry.nodes.join('/')} 点` : '',
      ]
        .filter(Boolean)
        .join(' · ')
      return `<div class="af-map">
        ${mini ?? ''}
        <span><b>${mapEntityLabel(entry.mapId, entry.code)}</b><i>${esc(detail)}</i></span>
      </div>`
    })
    .join('')

  const seen = abyssSeenMaps(ship.api_id)
  const seenRows = seen.slice(0, 12).map(abyssSeenChipHtml).join('')

  return `<div class="sec"><div class="sec-h">形态与出现海域</div>
    <div class="af-k">同系形态 <span>${abyssFormGroups(forms).length} 个形态 / ${forms.length} 个编号 · 点击切换</span></div>
    <div class="af-fgroups">${formCards}</div>
      <div class="af-k">${usingFamilyReference ? '同系形态参考' : '离线确认编成'} <span>海域资料${
      confirmed.length > 12 ? ` · 显示前 12/${confirmed.length}` : ''
    }</span></div>
    ${
      usingFamilyReference && confirmed.length
        ? '<div class="af-note">当前 ID 暂无记录 · 以下为同系形态海域</div>'
        : ''
    }
    ${
      confirmedRows
        ? `<div class="af-maps">${confirmedRows}</div>`
        : '<div class="af-empty">离线海域资料暂无当前形态</div>'
    }
    <div class="af-k">遭遇记录 <span>本地遭遇志</span></div>
    ${
      seenRows
        ? `<div class="af-seen-list">${seenRows}</div>`
        : '<div class="af-empty">暂无这一精确形态的遭遇记录</div>'
    }
  </div>`
}

const abyssRecordHtml = (mstId: number): string => {
  ensureAbyssKills() // 脏了就趁渲染补拉，出击后战绩不再停在启动快照
  if (!abyssKills) return ''
  const k = abyssKills[mstId]
  if (!k?.met) {
    return `<div class="sec"><div class="sec-h">战绩<span class="aux">本地遭遇志 · 永久累计</span></div>
      <div style="font-size:11.5px;color:var(--dim)">暂无本舰遭遇记录</div></div>`
  }
  const rate = k.withMask ? (k.killed / k.withMask) * 100 : null
  const older = k.met - k.withMask
  return `<div class="sec"><div class="sec-h">战绩<span class="aux">本地遭遇志 · 永久累计</span></div>
    <div class="ab-rec">
      <span class="ab-rc"><i>遭遇</i><b>${k.met}</b><em>艘次</em></span>
      <span class="ab-rc kill"><i>击沉</i><b>${k.killed}</b><em>艘次</em></span>
      ${rate != null ? `<span class="ab-rc"><i>击沉率</i><b>${rate.toFixed(0)}%</b><em>计入 ${k.withMask} 艘次</em></span>` : ''}
    </div>
    <div class="first-row">${firstEncounterLineHtml('kill', mstId)}</div>
    <div class="q-foot">
      按艘次计：同一场里 2 艘同款舰算 2 次
      ${older > 0 ? `<br>另有 <b>${older}</b> 艘次不计入击沉率` : ''}
    </div>
  </div>`
}

/**
 * 装备的全部贴图。游戏把同一件装备拆成好几张：`item_up` 是纯装备、
 * `item_character` 是纯妖精、`item_on` 是两者的合成图，`card` 才是带边框的完整卡面。
 * 摆全了才看得出「拆分」长什么样。取不到的格子由 wireCgImages 在 404 时删掉。
 */
const equipArtPanelHtml = (mstId: number, abyss: boolean): string => {
  const images = availableSlotItemImages(mstId)
  if (!images.length) return ''
  const cells = images
    .map(
      (img) => `<figure class="cg-item${img.big ? ' big' : ''}" data-cg="${esc(img.url)}" data-cg-cell hidden>
        <img src="${esc(img.url)}" alt="${esc(img.label)}" data-cg-image>
        <figcaption>${esc(img.label)}</figcaption>
      </figure>`,
    )
    .join('')
  return `<div class="sec">
    <div class="sec-h">立绘<span class="aux">游戏官方资源 · 单击查看大图</span></div>
    <div class="cg-grid equip-cg-grid" data-cg-grid>${cells}</div>
    <div class="af-empty equip-cg-empty" data-cg-empty hidden>${
      abyss
        ? '官方资源目录仅有名牌 · 无装备本体图'
        : '官方资源目录暂无当前装备贴图'
    }</div>
  </div>`
}

/**
 * 深海侧的「活动限定 / 现在还遇不遇得到」。
 *
 * 判据两条，都是一手，**不猜**：
 *  ① 常规海域出不出现——走 `abyssConfirmedMaps`（第一方汇编的各图敌编成），
 *    连同型家族一起看：同一外观的难度变体只有最早那个 id 会被编成表点名。
 *    常规图里有它 → 随时可遇，不标任何限定。
 *  ② 只在活动海域出现的，再看那个区**此刻开没开**（`mg.eventAreas` 是游戏一手）。
 *
 * ⚠️ 文案只说「活动结束后不再出现」，**不说「永久绝版」**——
 * 后续活动复用旧深海形态是常有的事，把「现在遇不到」写成「永远没有了」就是撒谎。
 * 而「现在遇不到、错过这次就得等」这件事本身足够让玩家知道该抓紧收。
 */
const abyssLimitedNote = (ship: any): string => {
  const family = abyssFamily(ship)
  const confirmed = mergeAbyssConfirmedMaps([ship.api_id, ...family.map((form) => form.api_id)])
  if (!confirmed.length) return '' // 没人供数据的图不等于「不出现」，一个字都不写
  const areas = confirmed.map((entry) => mapAreaOf(entry.mapId))
  if (areas.some((area) => !isEventMapArea(area))) return ''
  // `mg.eventAreas` 是账本对活动区的观测窗口（游戏一手）：`closed` = 曾出现、
  // 现已从主数据里消失 = 活动已结束。没有观测记录的区一律按「已结束」说——
  // 那多半是账本建立之前的老活动，说「还遇得到」才是撒谎。
  const eventAreas = [...new Set(areas)].sort((left, right) => left - right)
  const stillOpen = eventAreas.some((area) => mg.eventAreas?.[area]?.closed === false)
  return stillOpen
    ? `<span class="abyss-limited open" title="${esc(
        `目前开放的活动海域里还有它（${eventAreas.map((area) => `${area} 区`).join('、')}）`,
      )}">活动限定 · 当前可遭遇</span>`
    : `<span class="abyss-limited" title="${esc(
        `只在活动海域出现过（${eventAreas
          .map((area) => `${area} 区`)
          .join('、')}）· 相关活动海域已关闭`,
      )}">活动限定 · 活动已结束</span>`
}

/** 灰格挂的百科外链。**链接不是分发**——点了才走，且带走的是玩家自己的浏览器。 */
const abyssWikiLink = (ship: any): string => {
  const name = `${ship?.api_name ?? ''}`.trim()
  if (!name) return ''
  // 用站内搜索而不是猜页名：深海页名在 zh.kcwiki 上有中日两套写法，
  // 猜错就是一个 404。搜索命中唯一时 MediaWiki 会直接跳到那一页。
  const url = `https://zh.kcwiki.cn/index.php?search=${encodeURIComponent(name)}`
  return `<a class="wiki-link" href="${esc(url)}" target="_blank" rel="noreferrer"
    title="打开当前深海舰资料页（外部链接）">舰娘百科 ↗</a>`
}

/**
 * 深海侧的收集段。三态的**中间那一档判据与舰娘侧不同**：
 * 用 encounters 账本（你在哪张图遇到过它）而不是「游戏取过这张图」——
 * 账本是一手事实且比缓存准（缓存会被驱逐，账本不会）。
 *
 * 灰格（没遇到过）挂百科外链：**链接不是分发**，点了才走，
 * 也不替玩家去取任何图。
 */
/**
 * 深海侧的**遭遇事实行**：本机遭遇志里与它交过多少次手。
 *
 * 2026-08-23 用户拍板：空状态不许写成「本机遭遇志里还没见过它」——
 * 那是把一格空白说成玩家欠着的事。这一行改成**陈述事实**，有就说有、没有就说没有，
 * 不催促、不暗示「该去打一场」。
 *
 * ⚠️ 两处口径写在这里，别在措辞上滑走：
 *  · `met` 按**舰位**计不按场次（同一编成里两艘同款算两次，与击沉率同分母，
 *    见 ledger.abyssKillStats）；
 *  · 日期是**账本里最早的一条**，不是「你的第一次」——记账之前的不可知，
 *    所以写「最早一条」而不是「首次」（首见志那个模块当初就是被这件事纠正的）。
 */
const abyssEncounterFactHtml = (mstId: number): string => {
  ensureAbyssKills()
  const met = abyssKills?.[mstId]?.met ?? 0
  if (!met) return '<div class="cg-fact">遭遇志：暂无交手记录</div>'
  const since = metSinceOf(mstId)
  return `<div class="cg-fact">遭遇志：交手 ${met} 次${
    since ? ` · 最早一条 ${esc(fmtDate(since))}` : ''
  }</div>`
}

/**
 * 深海立绘页抬头的**事实行**：遭遇志 + 活动限定标 + 百科外链。
 *
 * 这三样都是事实陈述而不是收藏格：遭遇志是战绩、限定标是「这个形态现在还遇不遇得到」、
 * 外链是资料页。
 */
const abyssArtFactsHtml = (ship: any): string => `<div class="abyss-cg-facts">
    ${abyssEncounterFactHtml(ship.api_id)}${abyssLimitedNote(ship)}
    <span class="cg-fact">资料页：${abyssWikiLink(ship)}</span>
  </div>`

const abyssCgPanelHtml = (mstId: number): string => {
  const unique = new Map<string, ReturnType<typeof availableShipImages>[number]>()
  for (const image of availableShipImages(mstId)) {
    if (!unique.has(image.url)) unique.set(image.url, image)
  }
  // 同一外观的难度变体（飛行場姫 一族就有 18 个条目）只有**最早那个 id**
  // 发布了立绘，其余全是 404——实测 #1556 有、#1889/#2095 没有。
  // 所以给非首个成员补一格「同型」，标明借自谁；借来的图取不到时照样会被删掉。
  const self = abyssalShips.get(mstId)
  const family = self ? abyssFamily(self) : []
  const base = family[0]
  if (base && base.api_id !== mstId) {
    for (const image of availableShipImages(base.api_id)) {
      if (!isBigShipImg(image.type, image.damaged)) continue
      if (unique.has(image.url)) continue
      unique.set(image.url, {
        ...image,
        family: true,
        // 借来的那几张属于**同型的那个 id**，版本号也得跟着它取，
        // 否则透传给档案的是本形态的版号，归因就串了
        owner: base.api_id,
        label: `${image.label}（同型 ${entityNamePlain('abyssShip', base.api_id, base.api_name)}）`,
      } as never)
    }
  }
  const images = [...unique.values()]
  const facts = self ? abyssArtFactsHtml(self) : ''
  // 画廊尾巴：档案里的非现行版本。远古活动怪留过档就永远看得到（零网络，file://）
  const archived = archivedArtCellsHtml(mstId, images.map((image) => image.pathname))
  if (!images.length) {
    return `${facts}
    ${
      archived
        ? `<div class="cg-grid abyss-cg-grid" data-cg-grid>${archived}</div>`
        : '<div class="af-empty">暂无可读取的官方美术资源</div>'
    }`
  }
  const cells = images
    .map(
      // hidden 起手：加载完才现形。官方目录里多数深海舰只有横幅，
      // 先摆空框再等 404 删掉，等于每次重渲染都闪一排空格子
      (image) => `<figure class="cg-item${isBigShipImg(image.type, image.damaged) ? ' big' : ''}"
          data-cg="${esc(image.url)}" data-cg-path="${esc(image.pathname)}"
          data-cg-version="${esc(shipImageVersionOf((image as { owner?: number }).owner ?? mstId))}"
          data-cg-cell${(image as { family?: boolean }).family ? ' data-cg-family' : ''} hidden>
        <img src="${esc(image.url)}" alt="${esc(image.label)}" data-cg-image>
        <figcaption>${esc(image.label)}</figcaption>
      </figure>`,
    )
    .join('')
  return `${facts}
    <div class="cg-grid abyss-cg-grid" data-cg-grid>${cells}${archived}</div>
    <div class="af-empty abyss-cg-empty" data-cg-empty hidden>官方资源目录暂无当前深海舰立绘或横幅</div>
    <div class="q-foot">单击查看大图${
      archived
        ? ' ·「档案 … 留存」来自立绘档案 · 非当前官方版本'
        : ''
    }</div>`
}

const abyssDetailTabs = (ship: any): { id: AbyssDetailTab; label: string }[] => [
  { id: 'a-cg', label: '立绘' },
  ...(hasVoiceLines(ship.api_id) ? [{ id: 'a-voice' as const, label: '语音' }] : []),
  { id: 'a-map', label: '遭遇地点' },
]

/**
 * 当前 dtab 在这艘舰身上不存在时回落到「立绘」，并返回落定后的那个。
 *
 * 必须在**拼 tab 条之前**调用：抽屉模板从上往下求值，tab 条先拼、面板后拼，
 * 回落若等到面板里才发生，本次渲染的 tab 条就一个都不高亮
 * （停在「语音」页点一艘没有台词的深海舰，就能看到整条 tab 都是灭的）。
 */
const settleAbyssTab = (ship: any): AbyssDetailTab => {
  const tabs = abyssDetailTabs(ship)
  if (!tabs.some((tab) => tab.id === abyssState.dtab)) abyssState.dtab = 'a-cg'
  return abyssState.dtab
}

const abyssDetailPanelHtml = (ship: any, enter = false): string => {
  settleAbyssTab(ship)
  const body =
    abyssState.dtab === 'a-map'
      ? abyssFormsAndMapsHtml(ship)
      : abyssState.dtab === 'a-voice'
        ? voicePanelHtml(ship.api_id)
        : abyssCgPanelHtml(ship.api_id)
  return `<div class="ship-subview${enter ? ' enter' : ''}">${body}</div>`
}

const abyssDrawerHtml = () => {
  const s = abyssalShips.get(abyssState.selected)
  if (!s) return ''
  const dtab = settleAbyssTab(s) // 先落定，下面的 tab 条才能高亮对（见 settleAbyssTab）
  const typeName = stypeLabelOf(s.api_stype) // 同上：抽屉标题也要跟目录一个语言
  const heroArt = shipImageUrl(s.api_id, 'banner')
  let statsHtml = ''
  const packStats = abyssalLode?.data?.[`${s.api_id}`]
  if (packStats && typeof packStats === 'object') {
    const statRows = ABYSS_STAT_FIELDS.filter(([key]) => typeof packStats[key] === 'number').map(
      ([key, label]) => abyssStatRow(label, Number(packStats[key])),
    )
    const slots = Array.isArray(packStats.kc3_slots)
      ? packStats.kc3_slots
          .filter((id: number) => id > 0)
          .map((id: number) => {
            const equip = abyssalEquips.get(id) ?? friendlyEquips.get(id)
            if (!equip) return `<span class="ro-chip" style="color:#e8b8c0;border-color:#5c2c38">${esc(`#${id}`)}</span>`
            const abyss = abyssalEquips.has(id)
            return `<span class="ro-chip abyss-equip-link">${elink(
              abyss ? 'abyssEquip' : 'mstEquip',
              id,
              entityNamePlain(abyss ? 'abyssEquip' : 'equip', id, equip.api_name),
            )}</span>`
          })
          .join('')
      : ''
    statsHtml = `<div class="stat-grid abyss-stats">${statRows.join('')}</div>
      ${slots ? `<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${slots}</div>` : ''}
      ${abyssAirHtml(packStats)}
      <div style="margin-top:8px;font-size:10px;color:var(--dim)">带 * 的数值为社区估算 ${lodeCreditMark(abyssalLode!.meta)}</div>`
  } else {
    statsHtml = `<div style="font-size:11.5px;color:var(--dim);line-height:1.8">
      社区资料暂无这艘深海舰的估算数据</div>`
  }
  return `
  <div class="d-head">
    <span class="x" id="ji-abyss-close" title="关闭（Esc）">✕</span>
    <span class="crumb">${entityTermHtml('abyssShip', s.api_id, typeName)} › <b>${entityNameHtml('abyssShip', s.api_id, s.api_name, { compact: true })}</b></span><span class="sp"></span>
  </div>
  <div class="detail">
    <div class="hero" style="background:radial-gradient(420px 200px at 85% 0%,rgba(255,107,129,.08),transparent 65%),var(--bg1)">
      <div class="hero-l">
        <div class="meta-line">
          <span class="badge" style="color:#ff9fae;border-color:#5c2c38">${entityTermHtml('abyssShip', s.api_id, typeName)}</span>
          <span class="no">ID ${s.api_id}</span>
        </div>
        <div class="name-block">
          ${s.api_yomi && s.api_yomi !== '-' ? `<div class="yomi">${esc(s.api_yomi)}</div>` : ''}
          <h1 style="font-size:26px;color:#e8b8c0">${entityNameHtml('abyssShip', s.api_id, s.api_name)}</h1>
        </div>
        <div class="own-line">
          <span class="own-pill">航速 <b>${s.api_soku >= 10 ? '高速' : s.api_soku >= 5 ? '低速' : '陆上'}</b></span>
          <span class="own-pill">槽数 <b>${s.api_slot_num ?? '—'}</b></span>
          ${(() => {
            // 射程与对空CI来自 abyssal-stats(社区估算):射程决定炮击战次序,
            // 对空CI种别是防空棲姫/砲台小鬼这类的敌方对空特殊射击
            const st = abyssalLode?.data?.[`${s.api_id}`]
            const leng = Number(st?.api_leng ?? 0)
            const aaci = Number(st?.kc3_aaci ?? 0)
            // 射程 pill 分三档（自扩展体检待裁 6，2026-08-23 用户点头补齐）：
            //   有数 → 照显；**包里有这条但这一格空着** → 短横显形（名分层：缺格要看得见，
            //   不能静默不出）；包里根本没有这艘 → 不摆常驻占位，同段下方的数值区挂牌
            //   已经把「资料没到」说清了，抬头再摆一枚就是常驻噪音。
            const lengPill =
              leng > 0
                ? `<span class="own-pill">射程 <b>${LENG_LABEL[leng] ?? `档${leng}`}</b><em style="opacity:.6">*</em></span>`
                : st
                  ? `<span class="own-pill" title="社区估算资料收录当前深海舰 · 射程数据为空">射程 <b>—</b><em style="opacity:.6">*</em></span>`
                  : ''
            return `${lengPill}${
              aaci > 0 ? `<span class="own-pill" title="社区推定：当前深海舰可发动敌方对空特殊射击 · 编号沿用我方对空 CI 口径">对空CI <b>第${aaci}种</b><em style="opacity:.6">*</em></span>` : ''
            }`
          })()}
        </div>
      </div>
      ${
        heroArt
          ? `<div class="abyss-art has banner" data-cg="${esc(heroArt)}">
              <img src="${esc(heroArt)}" alt="${esc(entityNamePlain('abyssShip', s.api_id, s.api_name))} 横幅" loading="lazy">
            </div>`
          : '<div class="abyss-art"><span class="st">本机暂无</span></div>'
      }
    </div>
    <div class="sec"><div class="sec-h">估算数值</div>${statsHtml}</div>
    ${abyssRecordHtml(s.api_id)}
    <div class="tabs" id="ji-abyss-tabs">
      ${abyssDetailTabs(s)
        .map(
          (tab) =>
            `<div class="tab${dtab === tab.id ? ' on' : ''}" data-ap="${tab.id}">${tab.label}</div>`,
        )
        .join('')}
    </div>
    <div class="panel on" id="ji-abyss-panel">${abyssDetailPanelHtml(s)}</div>
    <div class="foot"><span>名称 · 游戏基础数据 · 更新于 ${masterTs ? fmtDate(masterTs) : '—'}</span></div>
  </div>`
}

// ---- 海域卷 ----

const mapState = {
  selected: 0,
  open: false,
  difficulty: null as EventDifficulty | null,
  fleetId: 1,
  personalNode: '',
  dropNode: '',
}
const emptyMapForecast = (): SortieForecastReport => ({
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
const mapForecastState = {
  key: '',
  loading: false,
  report: emptyMapForecast(),
}
const expandedMapDrops = new Set<string>()
const EVENT_DIFFICULTY_BY_RANK: Record<number, EventDifficulty> = {
  1: '丁',
  2: '丙',
  3: '乙',
  4: '甲',
}

const mergeArchivedEventMaps = () => {
  if (!eventArchives?.length) return
  const merged = new Map<number, any>(mapInfos.map((info) => [Number(info.api_id), info]))
  for (const archive of eventArchives) {
    const fallbackMaps = archive.maps?.length
      ? []
      : mapIntelEntries()
          .flatMap(([code]) => {
            const match = code.match(/^(\d+)-(\d+)$/)
            if (!match || Number(match[1]) !== archive.areaId) return []
            const no = Number(match[2])
            return [{
              api_id: mapIdOf(archive.areaId, no),
              api_maparea_id: archive.areaId,
              api_no: no,
              api_name: `${code}（旧活动归档）`,
              api_level: 0,
              api_required_defeat_count: 0,
              api_max_maphp: 0,
              __kansoArchiveFallback: true,
            }]
          })
    const archivedMaps = archive.maps?.length ? archive.maps : fallbackMaps
    if (!archivedMaps.length) continue
    eventAreaIds.add(archive.areaId)
    const lifecycleName = EVENT_DIFFICULTIES
      .map((difficulty) => mapIntelMap(`${archive.areaId}-${archivedMaps[0].api_no}`, difficulty)?.event?.name)
      .find(Boolean)
    mapAreas.set(
      archive.areaId,
      archive.areaName ?? lifecycleName ?? `活动海域 ${archive.areaId}`,
    )
    for (const info of archivedMaps) {
      const id = Number(info?.api_id)
      if (id > 0 && !merged.has(id)) merged.set(id, info)
    }
  }
  mapInfos = [...merged.values()].sort(
    (a, b) => a.api_maparea_id - b.api_maparea_id || a.api_no - b.api_no,
  )
}

const eventPeriodOf = (info: any): {
  active: boolean
  ended: boolean
  text: string
  basis: string
} | null => {
  if (!eventAreaIds.has(info.api_maparea_id)) return null
  const code = `${info.api_maparea_id}-${info.api_no}`
  const intel = EVENT_DIFFICULTIES
    .map((difficulty) => mapIntelMap(code, difficulty)?.event)
    .find(Boolean)
  const observed = mg.eventAreas[info.api_maparea_id]
  const archive = eventArchives?.find((entry) => entry.areaId === info.api_maparea_id)
  const active = Boolean(observed && !observed.closed)
  const ended = active ? false : Boolean(intel?.status === 'ended' || archive || observed?.closed)
  const slash = (value: string) => value.replaceAll('-', '/')
  // 日期格式单一出处：fmtDate 给 YYYY-MM-DD，这里只换分隔符，不再手抄一份 padStart
  const observedDay = (ts: number) => slash(fmtDate(ts))
  const from = intel?.from
    ? slash(intel.from)
    : observedDay(archive?.opened ?? observed?.firstSeenTs ?? Date.now())
  const until = intel?.until
    ? slash(intel.until)
    : ended && (archive?.closed ?? observed?.lastSeenTs)
      ? observedDay(archive?.closed ?? observed!.lastSeenTs)
      : null
  return {
    active,
    ended,
    text: until ? `${from}—${until}` : `${from}—`,
    basis: intel?.until
      ? '离线活动资料'
      : intel?.from
        ? '开始时间来自离线活动资料；结束时间由本机游戏数据确认'
        : '由本机游戏数据记录',
  }
}

const selectedMapDifficulty = (info: any): EventDifficulty | undefined => {
  if (!eventAreaIds.has(info.api_maparea_id)) return undefined
  const synced = EVENT_DIFFICULTY_BY_RANK[mg.mapGauges[info.api_id]?.selectedRank ?? 0]
  return mapState.difficulty ?? synced ?? '甲'
}

// 阵形规范表 2026-08-25 上移 shared/enemy-formation：数字与字符串两条腿
// 此前各说各话（数字→中文、字符串→照抄日文简写），他拍板统一中文后并成一个出口。

const ROUTING_STYPE_CODE = KCNAV_STYPE_CODE
const AIR_STATE_LABEL = ['均衡', '确保', '优势', '劣势', '丧失']

const mapForecastDecks = () => {
  const real = mg.decks.filter((deck) => !(mg.combinedFlag > 0 && deck.id === 2))
  // 沙盘挑了人就作为一支可选舰队摆进来：带路条件与胜率原本只认真实编队，
  // 想试一套编成得先去游戏里真拖完再回来看——这条路径就是为了省掉那一步。
  return sandboxRosterIds().length ? [...real, sandboxDeck()] : real
}

const normalizedForecastDeckId = (): number => {
  const decks = mapForecastDecks()
  mapState.fleetId = forecastDeckScope(mapState.fleetId).canonicalDeckId
  if (!decks.some((deck) => deck.id === mapState.fleetId)) {
    mapState.fleetId = decks[0]?.id ?? 1
  }
  return mapState.fleetId
}

const routingRosterForDeck = (deckId: number) => {
  const scope = forecastDeckScope(deckId)
  return scope.deckIds.flatMap((id) => {
    const deck = id === SANDBOX_DECK_ID ? sandboxDeck() : mg.decks.find((entry) => entry.id === id)
    return (deck?.ships ?? [])
      .filter((rosterId) => rosterId > 0)
      .map((rosterId) => mg.ships[rosterId])
      .filter(Boolean)
  })
}

// 分歧判定用的是**按下进击钮那一刻**的舰队（wikiwiki「ルート分岐」：判定は進撃時点）。
// https://wikiwiki.jp/kancolle/ルート分岐
// 护卫退避 / 单舰退避掉的舰不在其中：索敌值不算她，舰种数与舰数条件也不算她。
// 名单走内核那一份（shared/sortie-escape → fleet-calc.engagedShips），
// 与锐的退场卡、制空/索敌/输送量同源；返港时 sortie.active 落下，下一次调用自动全放行。
// 沙盘是母港里的 what-if 编成，游戏里没有这支队，也就没有退避可扣。
const routingShipsForDeck = (
  deckId: number,
  roster = routingRosterForDeck(deckId),
) => (deckId === SANDBOX_DECK_ID ? roster : engagedShips(roster))

const kcnavFleetForDeck = (deckId: number) => {
  const scope = forecastDeckScope(deckId)
  const stypes = (id: number) => {
    const deck = id === SANDBOX_DECK_ID ? sandboxDeck() : mg.decks.find((entry) => entry.id === id)
    return (deck?.ships ?? [])
      .filter((rosterId) => rosterId > 0)
      .map((rosterId) => mg.ships[rosterId])
      .filter(Boolean)
      .map((ship) => mg.master.ships[ship.shipId]?.stype ?? 0)
  }
  const main = stypes(scope.deckIds[0] ?? scope.canonicalDeckId)
  const escort = scope.combinedType > 0 ? stypes(scope.deckIds[1] ?? 2) : []
  return kcnavFleetComposition(main, escort, scope.combinedType)
}

// 带路上下文里，除了 passed / phase 之外**全部只取决于这支队本身**，
// 与走到哪一格无关。而带路推演会在每条路线的每一格上再问一次，
// 里面还要跑 4 次索敌33——各队走向速览又要对每支队各推一遍，
// 不记一份就是几百次同样的计算。
//
// 缓存的生存期是**一次渲染**：每次进 mapForecastHtml 先清空，
// 免得改了编成还拿着旧的算（那种错不会报错，只会给出上一套编成的路线）。
type RoutingFleetBase = Omit<RoutingFleetContext, 'passed' | 'phase' | 'difficulty'>
const routingBaseCache = new Map<number, RoutingFleetBase | null>()
const resetRoutingBaseCache = () => routingBaseCache.clear()

// 活动图带路规则按难度分叉（「甲难度 CV+CVB>=1 去A1」「乙丙丁难度 DD>=3 去G」），
// 所以上下文要带上当前难度；常规图恒为 null，引擎那边也就永远走不到难度判断。
// 口径跟这一页其余部分（敌编成、点位预测）统一走 selectedMapDifficulty：
// 它已经是「玩家选的资料难度 → 回落到 api_selected_rank」，不另起一套。
// 难度不进 routingBaseCache：它是**按图**的，不是按队的。
const routingDifficultyOf = (info: any): RoutingDifficulty | null =>
  selectedMapDifficulty(info) ?? null

const routingContextForDeck = (
  deckId: number,
  passed: string[],
  phase: number | null,
  difficulty: RoutingDifficulty | null,
): RoutingFleetContext | null => {
  if (routingBaseCache.has(deckId)) {
    const base = routingBaseCache.get(deckId)
    return base ? { ...base, passed, phase, difficulty } : null
  }
  const base = routingFleetBase(deckId)
  routingBaseCache.set(deckId, base)
  return base ? { ...base, passed, phase, difficulty } : null
}

const routingFleetBase = (deckId: number): RoutingFleetBase | null => {
  const roster = routingRosterForDeck(deckId)
  const ships = routingShipsForDeck(deckId, roster)
  if (!ships.length) return null
  const counts: Record<string, number> = {}
  const names: string[] = []
  const add = (key: string, value = 1) => {
    counts[key] = (counts[key] ?? 0) + value
  }
  for (const ship of ships) {
    const master = mg.master.ships[ship.shipId]
    const code = ROUTING_STYPE_CODE[master?.stype ?? 0]
    if (code) add(code)
    const original = master?.name ?? `#${ship.shipId}`
    names.push(original, entityNamePlain('ship', ship.shipId, original))
  }
  counts['BB系'] = (counts.BB ?? 0) + (counts.FBB ?? 0) + (counts.BBV ?? 0)
  counts['CV系'] = (counts.CV ?? 0) + (counts.CVB ?? 0) + (counts.CVL ?? 0)
  counts['CA系'] = (counts.CA ?? 0) + (counts.CAV ?? 0)
  counts['SS系'] = (counts.SS ?? 0) + (counts.SSV ?? 0)
  counts['CL系'] = (counts.CL ?? 0) + (counts.CLT ?? 0) + (counts.CT ?? 0)
  counts.lowSpeedBB = ships.filter((ship) => {
    const master = mg.master.ships[ship.shipId]
    return ['BB', 'FBB', 'BBV'].includes(ROUTING_STYPE_CODE[master?.stype ?? 0]) &&
      (ship.soku || master?.soku || 0) < 10
  }).length
  counts['大鹰级'] = names.filter((name, index) =>
    index % 2 === 0 && /大鷹|神鷹|雲鷹/.test(name),
  ).length

  const equipmentShipCounts = { radar: 0, drum: 0, landingCraft: 0 }
  for (const ship of ships) {
    const equipment = [...ship.slot, ship.slotEx]
      .filter((id) => id > 0)
      .map((id) => mg.slotitems[id])
      .map((item) => item && mg.master.slotitems[item.mstId])
      .filter(Boolean)
    if (equipment.some((item) => [12, 13].includes(item.type2))) equipmentShipCounts.radar++
    if (equipment.some((item) => /ドラム缶|运输桶|輸送桶/.test(item.name))) equipmentShipCounts.drum++
    if (equipment.some((item) => /大発|大发|内火艇|装甲艇|武装大発|M4A1|陸軍特種船/.test(item.name))) {
      equipmentShipCounts.landingCraft++
    }
  }
  const scope = forecastDeckScope(deckId)
  const combined = scope.combinedType > 0
  // 这里要的是**格子容量**（通常 6 / 遊撃 7 / 連合 12），不是还剩几个人。遊撃部隊只能
  // 靠「编成里有 7 舰」认出来，若按扣掉退避之后的人数认，退避一人就把它读成普通 6 格队。
  // 于是空格数 = 容量 − 实到舰：「退避舰从索敌排除」是 wikiwiki 明记的，而**空位补正
  // 是否随退避 +2/舰没有查到独立检证**，这里按「她已经不在舰队里」的字面口径让 33 式
  // 自然演算出来，不当定论；哪天查到反证，改这一处即可。
  const losSlotCount = combined ? 12 : roster.length === 7 ? 7 : 6
  const los: Record<number, number> = {}
  for (const factor of [1, 2, 3, 4]) {
    los[factor] = fleetLos33(
      ships,
      mg.basic?.level ?? 0,
      factor,
      losSlotCount,
    ).total
  }
  const flagship = ships[0]
  const flagshipMaster = flagship ? mg.master.ships[flagship.shipId] : undefined
  const flagshipCode = ROUTING_STYPE_CODE[flagshipMaster?.stype ?? 0] ?? ''
  const flagshipTypes = [flagshipCode]
  const groups: Record<string, string[]> = {
    'BB系': ['BB', 'FBB', 'BBV'],
    'CV系': ['CV', 'CVB', 'CVL'],
    'CA系': ['CA', 'CAV'],
    'SS系': ['SS', 'SSV'],
    'CL系': ['CL', 'CLT', 'CT'],
  }
  for (const [group, codes] of Object.entries(groups)) {
    if (codes.includes(flagshipCode)) flagshipTypes.push(group)
  }
  return {
    shipCount: ships.length,
    counts,
    shipNames: names,
    flagshipName: flagshipMaster?.name ?? '',
    flagshipTypes,
    speed: Math.min(...ships.map((ship) => ship.soku || mg.master.ships[ship.shipId]?.soku || 0)),
    los,
    equipmentShipCounts,
  }
}

const mapDifficultyRank = (difficulty: EventDifficulty | undefined) =>
  difficulty === '甲' ? 4 : difficulty === '乙' ? 3 : difficulty === '丙' ? 2 : difficulty === '丁' ? 1 : 0

const ensureMapForecast = (info: any, difficulty: EventDifficulty | undefined) => {
  const deckId = normalizedForecastDeckId()
  const mapId = Number(info.api_id) || 0
  const combinedType = forecastDeckScope(deckId).combinedType
  const eventKey = mg.eventAreas[info.api_maparea_id]?.firstSeenTs ?? 0
  const activeSortie =
    mg.sortie?.active && !mg.sortie.practice && mapIdOf(mg.sortie.mapArea, mg.sortie.mapNo) === mapId
      ? mg.sortie.startTs
      : -1
  const key = `${mapId}:${mapDifficultyRank(difficulty)}:${eventKey}:${combinedType}:${activeSortie}`
  if (mapForecastState.key === key) return
  mapForecastState.key = key
  mapForecastState.loading = true
  // 手上这份留着继续显示，等新的到了再换。整图样本进一个点只是多一条，
  // 先清成空报告会让整块预测塌一下再填回来——出击中每进一个点闪一次就是这么来的。
  void jiIpc.invoke('chron:forecast-map', mapId, {
    difficulty: mapDifficultyRank(difficulty),
    eventKey,
    combinedType,
    excludeSortieId: activeSortie,
  }).then((report: SortieForecastReport) => {
    if (mapForecastState.key !== key) return
    mapForecastState.report = report ?? emptyMapForecast()
    mapForecastState.loading = false
    if (activeBook === 'map' && mapState.open) scheduleRender()
  }).catch((error: unknown) => {
    if (mapForecastState.key !== key) return
    mapForecastState.loading = false
    console.warn('[kanso] 海域整图预测样本读取失败', error)
    if (activeBook === 'map' && mapState.open) scheduleRender()
  })
}

const addNodeSample = (
  target: NodeForecastSample,
  source: NodeForecastSample | undefined,
) => {
  if (!source) return
  target.total += source.total
  target.wins += source.wins
  target.saWins += source.saWins
  target.sWins += source.sWins
  target.passTotal += source.passTotal
  target.passed += source.passed
  target.taiha += source.taiha
  target.bosses += source.bosses
}

const emptyNodeSample = (): NodeForecastSample => ({
  total: 0,
  wins: 0,
  saWins: 0,
  sWins: 0,
  passTotal: 0,
  passed: 0,
  taiha: 0,
  bosses: 0,
})

const sampleForLetter = (
  route: Record<string, [string | null, string]>,
  letter: string,
): NodeForecastSample => {
  const result = emptyNodeSample()
  for (const [edgeId, pair] of Object.entries(route)) {
    if (pair?.[1] === letter) addNodeSample(result, mapForecastState.report.nodes[Number(edgeId)])
  }
  return result
}

interface MapNodeForecast {
  letter: string
  band: ReturnType<typeof forecastConfirmedComps>['band']
  sample: NodeForecastSample
  candidateCount: number
  battleDepths: number[]
}

const rangeText = (range: { min: number; max: number } | undefined) =>
  !range ? '—' : range.min === range.max ? `${range.min}%` : `${range.min}–${range.max}%`

/**
 * 百分比区间的微条：位置 = 区间起点，宽度 = 不确定性宽度。
 *
 * 「全图单点」是一片密集的数字区间（B+ 52–98%），扫一眼分不出哪个点好走。
 * 一条 2px 的轨道让人先扫形状再读数：条靠右 = 高，条越长 = 越不确定。
 * 大破用另一种色，因为它越低越好——同一种颜色会让人把「红条很短」看成「危险」。
 */
const rangeBarHtml = (
  range: { min: number; max: number } | undefined,
  kind: 'good' | 'risk',
): string => {
  if (!range) return ''
  const lo = Math.max(0, Math.min(100, range.min))
  const hi = Math.max(lo, Math.min(100, range.max))
  // 区间为零宽时也要看得见，给个最小可视宽度
  return `<i class="mbar ${kind}" style="--lo:${lo.toFixed(1)}%;--w:${Math.max(1.5, hi - lo).toFixed(1)}%"></i>`
}

const localMetricText = (
  sample: NodeForecastSample,
  kind: 'bPlus' | 'sa' | 'taiha',
) => {
  const value = historicalRate(sample, kind)
  if (!value) return '暂无本地样本'
  if (value.total < PERSONAL_RATE_MIN_SAMPLES) {
    return `本地 ${kind === 'bPlus' ? sample.wins : kind === 'sa' ? sample.saWins : sample.taiha}/${value.total}`
  }
  return `本地 ${value.value}% · n=${value.total}`
}

const mapNodeForecasts = (
  code: string,
  difficulty: EventDifficulty | undefined,
  route: Record<string, [string | null, string]>,
  deckId: number,
  battleDepths: Map<string, number[]>,
): Map<string, MapNodeForecast> => {
  const intel = mapIntelMap(code, difficulty)
  const result = new Map<string, MapNodeForecast>()
  if (!intel) return result
  for (const [letter, node] of Object.entries(intel.nodes)) {
    if (!node.enemyComps.length) continue
    const depths = battleDepths.get(letter) ?? [0]
    const forecasts = depths.map((depth) =>
      forecastConfirmedComps(deckId, node.enemyComps, abyssalLode?.data ?? {}, depth),
    )
    const rows = forecasts.flatMap((forecast) => forecast.rows)
    result.set(letter, {
      letter,
      // 单一深度时 forecastConfirmedComps 已经按同一口径算过一遍，直接取用；
      // 多深度才需要跨深度重新合并（那时几份 band 各说各的，不能拿第一份充数）
      band:
        forecasts.length === 1
          ? forecasts[0].band
          : rows.length
            ? summarizeEncounterForecasts(rows.map((row) => row.forecast))
            : null,
      sample: sampleForLetter(route, letter),
      candidateCount: forecasts[0]?.rows.length ?? 0,
      battleDepths: depths,
    })
  }
  return result
}

interface PlannedRoute {
  nodes: string[]
  probability: number | null
  uncertain: boolean
  evidence: string[]
}

const plannedRoutes = (
  code: string,
  route: Record<string, [string | null, string]>,
  deckId: number,
  phase: number | null,
  difficulty: RoutingDifficulty | null,
): PlannedRoute[] => {
  const byFrom = new Map<string, string[]>()
  for (const [, [from, to]] of Object.entries(route)) {
    const key = from ?? '出发点'
    const list = byFrom.get(key) ?? []
    if (!list.includes(to)) list.push(to)
    byFrom.set(key, list)
  }
  const ruleNodes: any[] = routingLode?.data?.[code]?.nodes ?? []
  const kcnavMap = kcnavRoutingLode?.data?.maps?.[code]
  const kcnavFleet = kcnavFleetForDeck(deckId)
  const startCandidates = byFrom.get('出发点') ?? []
  const out: PlannedRoute[] = []
  const walk = (
    current: string,
    path: string[],
    probability: number | null,
    uncertain: boolean,
    evidence: string[],
    depth: number,
  ) => {
    if (out.length >= 32) return
    const candidates = byFrom.get(current) ?? []
    if (!candidates.length || depth >= 20) {
      if (path.length) {
        out.push({
          nodes: path,
          probability,
          uncertain: uncertain || depth >= 20,
          evidence,
        })
      }
      return
    }
    // FCD 先走 null→“1/2”出发点；只有一个出发点时，带路表里的“出发点”
    // 实际描述的是该点之后的第一次分歧。多个出发点时则先用它选 1/2。
    const ruleFrom =
      startCandidates.length === 1 && current === startCandidates[0]
        ? '出发点'
        : current
    const ruleNode = ruleNodes.find((node) => `${node?.from ?? ''}`.trim() === ruleFrom)
    const rules = Array.isArray(ruleNode?.rules)
      ? ruleNode.rules.filter((rule: unknown): rule is string => typeof rule === 'string' && rule.trim().length > 0)
      : []
    const context = routingContextForDeck(deckId, path, phase, difficulty)
    const decision = rules.length && context
      ? evaluateRoutingRules(rules, context, candidates)
      : null
    const decided = decision?.routes
      .map((entry) => ({ to: entry.to, probability: entry.probability }))
      .filter((entry) => candidates.includes(entry.to)) ?? []
    const empirical =
      decision?.status === 'certain'
        ? null
        : estimateKcnavBranch(kcnavMap?.branches?.[current], kcnavFleet, candidates)
    const next = empirical
      ? empirical.routes.map((entry) => ({
          to: entry.to,
          probability: entry.probability * 100,
          evidence: `KCNav ${Math.round(entry.probability * 100)}% · n=${empirical.sample}`,
        }))
      : decided.length
        ? decided.map((entry) => ({ ...entry, evidence: '' }))
        : candidates.map((to) => ({ to, probability: null, evidence: '' }))
    const exactSingle = decision?.status === 'certain' && next.length === 1
    const explicit = next.filter((entry) => entry.probability != null)
    const explicitSum = explicit.reduce((sum, entry) => sum + Number(entry.probability), 0)
    for (const entry of next) {
      if (path.includes(entry.to)) {
        out.push({
          nodes: [...path, entry.to],
          probability,
          uncertain: true,
          evidence: [...evidence, ...(entry.evidence ? [entry.evidence] : [])],
        })
        continue
      }
      let branch: number | null = null
      if (exactSingle) branch = 1
      else if (entry.probability != null) branch = Number(entry.probability) / Math.max(100, explicitSum)
      else if (!explicit.length && next.length === 1) branch = 1
      const nextProbability =
        probability == null || branch == null ? null : probability * branch
      walk(
        entry.to,
        [...path, entry.to],
        nextProbability,
        uncertain ||
          Boolean(empirical) ||
          (!empirical && decision?.status !== 'certain') ||
          branch == null,
        [...evidence, ...(entry.evidence ? [`${current}→${entry.to} ${entry.evidence}`] : [])],
        depth + 1,
      )
    }
  }
  if (startCandidates.length === 1) {
    walk(startCandidates[0], [startCandidates[0]], 1, false, [], 0)
  } else {
    walk('出发点', [], 1, false, [], 0)
  }
  return out
}

const battleDepthsForRoutes = (
  routes: PlannedRoute[],
  code: string,
  difficulty: EventDifficulty | undefined,
): Map<string, number[]> => {
  const battleNodes = new Set(
    Object.entries(mapIntelMap(code, difficulty)?.nodes ?? {})
      .filter(([, node]) => node.enemyComps.length > 0)
      .map(([letter]) => letter),
  )
  const depths = new Map<string, Set<number>>()
  for (const route of routes) {
    let battlesBefore = 0
    for (const node of route.nodes) {
      const current = depths.get(node) ?? new Set<number>()
      current.add(battlesBefore)
      depths.set(node, current)
      if (battleNodes.has(node)) battlesBefore++
    }
  }
  return new Map(
    [...depths].map(([node, values]) => [node, [...values].sort((left, right) => left - right)]),
  )
}

const routePassRange = (
  route: PlannedRoute,
  forecasts: Map<string, MapNodeForecast>,
) => {
  const battleNodes = route.nodes.filter((node) => forecasts.get(node)?.band)
  const observedBoss = battleNodes.find((node) => (forecasts.get(node)?.sample.bosses ?? 0) > 0)
  const terminal = route.nodes[route.nodes.length - 1]
  const bossNode = observedBoss ?? (battleNodes.includes(terminal) ? terminal : null)
  const roadside = battleNodes.filter((node) => node !== bossNode)
  let min = 1
  let max = 1
  for (const node of roadside) {
    const taiha = forecasts.get(node)!.band!.taiha
    min *= 1 - taiha.max / 100
    max *= 1 - taiha.min / 100
  }
  return {
    min: Math.round(min * 100),
    max: Math.round(max * 100),
    boss: bossNode ? forecasts.get(bossNode) : undefined,
  }
}

// 这张图的目标点。候选是整张海图的点位，默认取最近打过的那个 Boss——
// 判据在 shared/route-target（纯函数，有测试）。
const routeTargetOf = (info: any, code: string): RouteTargetView => {
  const fcd = fcdMapLode?.data?.[code]
  const route: Record<string, [string | null, string]> = fcd?.route ?? {}
  const chronicle = mapChronicle.get(Number(info.api_id) || 0) ?? EMPTY_MAP_CHRONICLE
  return resolveRouteTarget(
    fcd?.spots ?? {},
    chronicle.bossSeen,
    (cell) => route[`${cell}`]?.[1] ?? null,
    routeTargets[code] ?? null,
  )
}

/**
 * 各队走向速览：把「这支队会走到哪儿」摊成一队一行，能并排比。
 *
 * 下面那张「可达路线」一次只答**一支**队（要切 tab），可玩家真正要做的
 * 判断是队与队之间的：哪支进得了目标点、哪支会被带去绕路。原本这一步
 * 得自己切着 tab 逐支看、心里记住再比——这里替他做完。
 *
 * 判别不是新写的：带路规则引擎（shared/routing-engine）与逐队上下文
 * （routingContextForDeck）本来就在，这里只是对每支队各跑一次再聚合。
 * 聚合口径在 shared/route-outlook，有行为测试。
 *
 * 走向按**玩家选定的目标点**算，不按「打过的 Boss」：多血条图上旧段 Boss
 * 会一直占着目标位，而捞船的人本来就故意停在旧段 Boss。默认值仍取自你的
 * 记录（最近打过的那个 Boss），一个都没有就说没选，不拿「路线终点」冒充。
 */
const fleetOutlookHtml = (
  info: any,
  code: string,
  route: Record<string, [string | null, string]>,
  target: string | null,
): string => {
  const targetLetters = target ? new Set([target]) : new Set<string>()
  const targetLabel = target ? esc(target) : ''
  const phase = mg.mapGauges[info.api_id]?.gaugeNum ?? null
  const difficulty = routingDifficultyOf(info)
  const current = normalizedForecastDeckId()
  const rows = mapForecastDecks()
    .map((deck) => {
      const scope = forecastDeckScope(deck.id)
      const label = forecastFleetLabelForDeck(deck.id)
      const on = scope.canonicalDeckId === current ? ' on' : ''
      const ships = routingShipsForDeck(deck.id)
      if (!ships.length) {
        return `<div class="fo-lane${on}" data-map-forecast-deck="${scope.canonicalDeckId}">
          <b>${esc(label)}</b><span class="lane-none">暂无舰娘</span></div>`
      }
      const view = routeOutlook(plannedRoutes(code, route, deck.id, phase, difficulty), targetLetters)
      const bossCell = !view.boss
        ? '<span class="lane-boss unknown">未选目标点</span>'
        : view.boss.routes === 0
          ? `<span class="lane-boss miss">绕开 ${targetLabel}</span>`
          : view.boss.probability == null
            ? `<span class="lane-boss maybe">可能进 ${targetLabel}<i>${view.boss.routes}/${view.boss.total} 条</i></span>`
            : view.boss.probability >= 0.999
              ? `<span class="lane-boss hit">必进 ${targetLabel}</span>`
              : `<span class="lane-boss hit">进 ${targetLabel} ${Math.round(view.boss.probability * 100)}%</span>`
      const pathCell = view.best
        ? `<span class="lane-path">${view.best.nodes
            .map((node) => `<b${node === target ? ' class="boss"' : ''}>${esc(node)}</b>`)
            .join('<i>→</i>')}</span>`
        : `<span class="lane-path none">分歧未决 · ${view.routes} 条可达路线</span>`
      const odds =
        view.best?.probability == null
          ? ''
          : `<span class="lane-odds">${Math.round(view.best.probability * 100)}%</span>`
      return `<div class="fo-lane${on}" data-map-forecast-deck="${scope.canonicalDeckId}">
        <b>${esc(label)}</b>
        ${bossCell}
        ${pathCell}
        ${odds}
      </div>`
    })
    .join('')
  const note = target
    ? ''
    : '<div class="q-foot">暂无 Boss 记录；在「目标点」中选定，走向按其计算</div>'
  return `<div class="map-model-title">各队走向<span class="aux">单击一行切换至对应舰队详细预测</span></div>
    <div class="fo-lanes">${rows}</div>${note}`
}

const mapForecastHtml = (
  info: any,
  code: string,
  difficulty: EventDifficulty | undefined,
): string => {
  resetRoutingBaseCache() // 每次渲染重算一次队伍侧，别拿着上一套编成的结果
  ensureMapForecast(info, difficulty)
  const fcd = fcdMapLode?.data?.[code]
  const route: Record<string, [string | null, string]> | undefined = fcd?.route
  const deckId = normalizedForecastDeckId()
  const decks = mapForecastDecks()
  const friendly = forecastFleetForDeck(deckId)
  const tabs = decks.map((deck) => {
    const scope = forecastDeckScope(deck.id)
    const sortie = mg.sortie?.active && !mg.sortie.practice &&
      scope.deckIds.includes(mg.sortie.deckId)
    const label = forecastFleetLabelForDeck(deck.id)
    return `<button class="own-pill map-forecast-deck${deck.id === deckId ? ' on' : ''}${sortie ? ' sortie' : ''}"
      data-map-forecast-deck="${scope.canonicalDeckId}">${label}${sortie ? ' · 出击中' : ''}</button>`
  }).join('')
  if (!route) {
    return `<div class="sec map-forecast"><div class="sec-h">全图与路线预测<span class="aux">战斗机制估算</span></div>
      <div class="map-forecast-tabs">${tabs}</div>
      <div class="q-foot">缺少离线海域资料 · 完整路线暂不可用</div></div>`
  }
  // Boss 点位只认自己的记录：主数据不下发哪个点是 Boss，攻略包里也没有。
  // 它现在只用来给选项挂个「Boss」尾注，走向按玩家选的目标点算。
  const bossLetters = new Set(
    (mapChronicle.get(Number(info.api_id) || 0)?.bossCells ?? [])
      .map((cell) => route[`${cell}`]?.[1])
      .filter(Boolean) as string[],
  )
  const routeTarget = routeTargetOf(info, code)
  const targetOptions = routeTarget.candidates
    .map(
      (letter) =>
        `<option value="${esc(letter)}"${letter === routeTarget.target ? ' selected' : ''}>${esc(letter)}${
          bossLetters.has(letter) ? ' · Boss' : ''
        }</option>`,
    )
    .join('')
  const targetPicker = `<label class="mf-target">目标点
    <select data-map-route-target="${esc(code)}">${
      routeTarget.target ? '' : '<option value="" selected>未选</option>'
    }${targetOptions}</select>
  </label>`
  // 空舰队那一档也要能改目标点：切到一支没船的队时选择器不该跟着消失
  if (!friendly.ships.length) {
    return `<div class="sec map-forecast"><div class="sec-h">全图与路线预测<span class="aux">战斗机制估算</span></div>
      <div class="map-forecast-tabs">${tabs}${targetPicker}</div>
      <div class="q-foot">当前舰队暂无舰娘 · 暂无计算结果</div></div>`
  }
  const paths = plannedRoutes(
    code,
    route,
    deckId,
    mg.mapGauges[info.api_id]?.gaugeNum ?? null,
    difficulty ?? null,
  )
  const battleDepths = battleDepthsForRoutes(paths, code, difficulty)
  const forecasts = mapNodeForecasts(code, difficulty, route, deckId, battleDepths)
  const nodeRows = [...forecasts.values()]
    .sort((left, right) => left.letter.localeCompare(right.letter, undefined, { numeric: true }))
    .map((entry) => {
      const band = entry.band
      const air = band?.airStates.map((state) => AIR_STATE_LABEL[state] ?? `状态${state}`).join('～') ?? '—'
      const firstBattle = (entry.battleDepths[0] ?? 0) + 1
      const lastBattle = (entry.battleDepths[entry.battleDepths.length - 1] ?? 0) + 1
      const depthText = firstBattle === lastBattle ? `第${firstBattle}战` : `第${firstBattle}～${lastBattle}战`
      const formation = band?.friendlyFormations
        .map((value) => ENEMY_FORMATION[value] ?? `阵形${value}`)
        .join('～') ?? '阵形待定'
      const engagement =
        band?.engagements.length === 1 && band.engagements[0] === 'saiun'
          ? '彩云航向'
          : '自然航向'
      return `<div class="map-model-node">
        <b>${esc(entry.letter)}</b>
        <span class="model-air">制空 ${esc(air)}</span>
        <span><small>B+</small><strong>${rangeText(band?.bPlus)}</strong>${rangeBarHtml(band?.bPlus, 'good')}<em>${esc(localMetricText(entry.sample, 'bPlus'))}</em></span>
        <span><small>S/A</small><strong>${rangeText(band?.sa)}</strong>${rangeBarHtml(band?.sa, 'good')}<em>${esc(localMetricText(entry.sample, 'sa'))}</em></span>
        <span class="risk"><small>大破</small><strong>${rangeText(band?.taiha)}</strong>${rangeBarHtml(band?.taiha, 'risk')}<em>${esc(localMetricText(entry.sample, 'taiha'))}</em></span>
        <i>${entry.candidateCount} 套敌编成 · 我方${esc(formation)} · ${engagement} · ${depthText}补给 · 机制${band?.confidence ?? 'C'}级</i>
      </div>`
    })
    .join('')
  loadMapRouteTally(code, Number(info.api_id) || 0)
  const tally = mapRouteTally?.code === code ? mapRouteTally : null
  const routeRows = paths.slice(0, 16).map((path) => {
    const pass = routePassRange(path, forecasts)
    const probability =
      path.probability == null
        ? '分歧概率不明'
        : path.evidence.length
          ? `实测路径估算 ${Math.round(path.probability * 100)}% · ${path.evidence.join('；')}`
          : `带路 ${Math.round(path.probability * 100)}%${path.uncertain ? '（含未决）' : ''}`
    // 「你自己走成过几次」——账本按步记，不保留哪几步属于同一趟，
    // 所以只报上界（沿途最窄的那一步），并把「至多」写在脸上。
    const walked = tally && !tally.failed ? pathWalkedBound(tally.tally, path.nodes) : null
    const mine =
      walked == null
        ? ''
        : walked > 0
          ? ` · 本地成功记录至多 ${walked} 次`
          : tally!.total
            ? ' · 本地无成功记录'
            : ''
    return `<div class="map-model-route">
      <span class="path">${path.nodes.map((node) => `<b>${esc(node)}</b>`).join('<i>→</i>')}</span>
      <span><small>道中通过</small><strong>${rangeText(pass)}</strong></span>
      <span><small>终点 S/A</small><strong>${rangeText(pass.boss?.band?.sa)}</strong></span>
      <span><small>终点 B+</small><strong>${rangeText(pass.boss?.band?.bPlus)}</strong></span>
      <em>${esc(`${probability}${mine}`)}</em>
    </div>`
  }).join('')
  // 逐分歧点的实测去向。只列真分过歧的点：去向只有一个的写出来是噪音。
  const branchRows = tally && !tally.failed
    ? [...tally.tally.entries()]
        .filter(([, entry]) => entry.to.length >= 2)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([at, entry]) => {
          const parts = entry.to
            .map(
              (step) =>
                `<span class="branch-to"><b>${esc(step.letter)}</b> ${step.count} 次 <i>${Math.round((step.count / entry.total) * 100)}%</i></span>`,
            )
            .join('')
          return `<div class="map-branch-row"><b>${esc(at)}</b><span class="branch-n">${entry.total} 次</span>${parts}</div>`
        })
        .join('')
    : ''
  // 「没分歧」与「没走过」是两回事：前者是这张图（或你走过的那几条）本来就不分岔，
  // 后者是账本里还没有。合成一句会让人以为图上没有分歧点。
  const branchNote = tally?.failed
    ? '<div class="q-foot">航路志读取失败</div>'
    : branchRows
      ? ''
      : tally?.total
        ? `<div class="q-foot">已记录 ${tally.total} 步 · 暂无分歧记录</div>`
        : '<div class="q-foot">暂无航路记录</div>'
  const total = mapForecastState.report.sortie
  const history =
    total.total >= PERSONAL_RATE_MIN_SAMPLES
      ? `本地完整出击：道中通过 ${Math.round(total.reached / total.total * 100)}% · Boss S/A ${total.reached ? Math.round(total.saWins / total.reached * 100) : 0}% · n=${total.total}`
      : `本地完整出击样本 ${total.total}/${PERSONAL_RATE_MIN_SAMPLES} · 样本不足，无百分比`
  const context = routingContextForDeck(
    deckId,
    [],
    mg.mapGauges[info.api_id]?.gaugeNum ?? null,
    routingDifficultyOf(info),
  )
  const fleetLine = context
    ? `${context.shipCount} 舰 · ${context.speed >= 20 ? '最速' : context.speed >= 15 ? '高速+' : context.speed >= 10 ? '高速' : '低速'} · 索敌33 ${Object.entries(context.los).map(([factor, value]) => `×${factor} ${value}`).join(' / ')}`
    : '舰队数据待同步'
  return `<div class="sec map-forecast">
    <div class="sec-h">全图与路线预测<span class="aux" title="最终面板 · 等级/士气/补给 · 装备属性/★改修/熟练度/搭载 · 深海数值与装备">战斗机制估算 + 本地实测对照</span></div>
    <div class="map-forecast-tabs">${tabs}${targetPicker}<span>${esc(fleetLine)}</span></div>
    <div class="map-model-summary">
      <em>${esc(history)}${mapForecastState.loading ? ' <i class="stale">· 正在更新</i>' : ''}</em>
    </div>
    ${fleetOutlookHtml(info, code, route, routeTarget.target)}
    <div class="map-model-title">全图单点</div>
    <div class="map-model-nodes">${nodeRows || '<div class="q-foot">当前难度暂无已确认敌编成 · 暂无估算数值</div>'}</div>
    <div class="map-model-title">可达路线</div>
    <div class="map-model-routes">${routeRows || '<div class="q-foot">带路资料不完整 · 暂无完整路线</div>'}</div>
    <div class="map-model-title">分歧实测<span class="aux">本地航路志</span></div>
    <div class="map-branches">${branchRows}${branchNote}</div>
  </div>`
}

const mapThumbOverlayHtml = (info: any): string => {
  const code = `${info.api_maparea_id}-${info.api_no}`
  const gauge = mg.mapGauges[info.api_id]
  if (!gauge) return `<span class="map-thumb-code">${esc(code)}</span>`

  let pct = 0
  let label = '攻略进度'
  let cls = ''
  if (gauge.hpNow != null && gauge.hpMax != null && gauge.hpMax > 0) {
    pct = gauge.cleared
      ? 100
      : Math.max(0, Math.min(100, Math.round((gauge.hpNow / gauge.hpMax) * 100)))
    label = gauge.cleared
      ? `已攻略${gauge.gaugeNum ? ` · 第${gauge.gaugeNum}条` : ''}`
      : `血条 ${gauge.hpNow}/${gauge.hpMax}${gauge.gaugeNum ? ` · 第${gauge.gaugeNum}条` : ''}`
    cls = gauge.cleared ? ' done' : ' hp'
  } else if (gauge.required != null && gauge.required > 0) {
    // 扣血口径:条画剩余、数到 0/N 击破,与血条制/游戏内一致
    const remain = Math.max(0, gauge.required - (gauge.defeated ?? 0))
    label = gauge.cleared ? '已攻略' : `Boss 剩 ${remain}/${gauge.required} 次`
    // 「扣式」(2026-08-17 用户点名):EO 击破数都是个位数,连续条在缩略图上
    // 读不出「还剩几下」——改成一颗一扣的离散格,打掉一次熄一颗,
    // 从右往左熄,与游戏血条同向。次数多到数不清的(>9)退回连续条。
    if (!gauge.cleared && gauge.required <= 9) {
      const pips = Array.from(
        { length: gauge.required },
        (_, i) => `<i${i < remain ? ' class="on"' : ''}></i>`,
      ).join('')
      return `<span class="map-thumb-code">${esc(code)}</span>
        <span class="map-thumb-gauge count pips" title="${esc(label)}">${pips}${
          gauge.gaugeNum ? `<b>${gauge.gaugeNum}</b>` : ''
        }</span>`
    }
    pct = gauge.cleared ? 100 : Math.max(0, Math.min(100, Math.round((remain / gauge.required) * 100)))
    cls = gauge.cleared ? ' done' : ' count'
  } else {
    return `<span class="map-thumb-code">${esc(code)}</span>`
  }

  return `<span class="map-thumb-code">${esc(code)}</span>
    <span class="map-thumb-gauge${cls}" title="${esc(label)}"><i style="width:${pct}%"></i>${
      gauge.gaugeNum && !gauge.cleared ? `<b>${gauge.gaugeNum}</b>` : ''
    }</span>`
}

const mapCatalogHtml = () => {
  const unlockStateKnown = Object.keys(mg.mapGauges).length > 0
  const groups: Record<string, any[]> = {}
  for (const info of mapInfos) {
    const areaName = entityNamePlain(
      'mapArea',
      info.api_maparea_id,
      mapAreas.get(info.api_maparea_id) ?? `海域${info.api_maparea_id}`,
    )
    ;(groups[`${info.api_maparea_id}|${areaName}`] ??= []).push(info)
  }
  const rows = Object.entries(groups)
    .map(([key, items]) => {
      const [, areaName] = key.split('|')
      const groupPeriod = eventPeriodOf(items[0])
      const rowsHtml = items
        .map((info) => {
          const code = `${info.api_maparea_id}-${info.api_no}`
          const on = info.api_id === mapState.selected && mapState.open
          const mini = miniMapSvg(code, info.api_id, { compact: true })
          const period = eventPeriodOf(info)
          const unlocked = !unlockStateKnown || info.api_id in mg.mapGauges || !!period?.ended
          const periodLine = !unlocked
            ? '尚未解锁'
            : period
              ? `${period.ended ? '已结束' : '进行中'} · ${period.text}`
              : `Lv ${info.api_level ?? '—'}`
          return `<div class="row${unlocked ? '' : ' ghost'}${on ? ' on' : ''}" data-map="${info.api_id}" style="--rc:#2c5c50">
            <div class="face mapface" title="${code}">${mini ?? ''}${mapThumbOverlayHtml(info)}</div>
            <div class="nm"><b>${entityNameHtml('map', info.api_id, info.api_name, { compact: true })}</b>
              <span class="${period ? `map-event-date ${period.ended ? 'ended' : 'live'}` : ''}"${period ? ` title="${esc(period.basis)}"` : ''}>${esc(periodLine)}</span></div>
          </div>`
        })
        .join('')
      return groupBoxHtml(
        `map:${key}`,
        `<b>${entityNameHtml('mapArea', items[0].api_maparea_id, areaName, { compact: true })}</b>
        ${groupPeriod ? `<span class="map-event-period ${groupPeriod.ended ? 'ended' : 'live'}">${groupPeriod.ended ? '已结束' : '进行中'} · ${esc(groupPeriod.text)}</span>` : ''}
        <span class="cnt">${items.length}</span>`,
        rowsHtml,
      )
    })
    .join('')
  return `<div class="ship-list" id="ji-map-list" style="padding-top:6px">${rows}</div>`
}

const mapChronicleHtml = (info: any): string => {
  const mapId = Number(info.api_id) || 0
  ensureMapChronicle(mapId)
  const report = mapChronicle.get(mapId)
  if (!report) {
    if (mapChronicleErrors.has(mapId)) {
      return `<div class="sec map-personal"><div class="sec-h">海域记录<span class="aux">本地遭遇志</span></div>
        <div class="af-empty">本地记录读取失败 · <button class="pf-btn" data-map-chronicle-retry="${mapId}">重试</button></div></div>`
    }
    return `<div class="sec map-personal"><div class="sec-h">海域记录<span class="aux">本地遭遇志</span></div>
      <div class="af-empty">正在读取永久累计记录…</div></div>`
  }
  const code = `${info.api_maparea_id}-${info.api_no}`
  const route: Record<string, [string | null, string]> | undefined =
    fcdMapLode?.data?.[code]?.route
  const letterOf = (cell: number): string => route?.[`${cell}`]?.[1] ?? `#${cell}`
  if (!report.sortieCount && !report.cells.length && !report.edges.length) {
    return `<div class="sec map-personal"><div class="sec-h">海域记录<span class="aux">本地遭遇志 · 永久累计</span></div>
      <div class="af-empty">暂无这张图的出击记录</div></div>`
  }

  const bossCells = new Set(report.bossCells)
  const battles = report.cells.reduce((sum, cell) => sum + cell.count, 0)
  const bossBattles = report.cells
    .filter((cell) => bossCells.has(cell.cell))
    .reduce((sum, cell) => sum + cell.count, 0)
  const latestTs = Math.max(0, ...report.cells.map((cell) => cell.lastTs))
  const nodesByLetter = new Map<string, { count: number; lastTs: number; boss: boolean }>()
  for (const cell of report.cells) {
    const letter = letterOf(cell.cell)
    const current = nodesByLetter.get(letter) ?? { count: 0, lastTs: 0, boss: false }
    current.count += cell.count
    current.lastTs = Math.max(current.lastTs, cell.lastTs)
    current.boss ||= bossCells.has(cell.cell)
    nodesByLetter.set(letter, current)
  }
  const nodeEntries = [...nodesByLetter]
    .sort(
      (left, right) =>
        left[0].localeCompare(right[0], undefined, { numeric: true }),
    )
  const personalNode = nodeEntries.some(([letter]) => letter === mapState.personalNode)
    ? mapState.personalNode
    : ''
  const cells = nodeEntries.length
    ? [
        `<button class="own-pill map-node-filter${personalNode ? '' : ' on'}" data-map-personal-node="" aria-pressed="${personalNode ? 'false' : 'true'}">全部</button>`,
        ...nodeEntries.map(
          ([letter, node]) =>
            `<button class="own-pill map-node-filter${node.boss ? ' map-personal-boss' : ''}${personalNode === letter ? ' on' : ''}"
              data-map-personal-node="${esc(letter)}" aria-pressed="${personalNode === letter ? 'true' : 'false'}"
              title="点击筛选此点 · 最近 ${esc(fmtTime(node.lastTs))}">
              ${esc(letter)}${node.boss ? ' · Boss' : ''} <b>${node.count}</b> 战
            </button>`,
        ),
      ].join('')
    : ''
  const dropsByNodeShip = new Map<string, MapChronicleReport['drops'][number]>()
  for (const drop of report.drops) {
    const letter = letterOf(drop.cell)
    const key = `${letter}:${drop.mstId}`
    const current = dropsByNodeShip.get(key)
    if (current) current.count += drop.count
    else dropsByNodeShip.set(key, { ...drop, cell: drop.cell })
  }
  const drops = [...dropsByNodeShip.values()]
    .filter((drop) => !personalNode || letterOf(drop.cell) === personalNode)
    .sort(
      (left, right) =>
        right.count - left.count ||
        letterOf(left.cell).localeCompare(letterOf(right.cell), undefined, { numeric: true }) ||
        left.mstId - right.mstId,
    )
  const walkedRoutes = new Set(
    report.edges.flatMap((edge) => {
      const path = route?.[`${edge.cell}`]
      return path?.[0] ? [`${path[0]}→${path[1]}`] : []
    }),
  )
  const walkedRouteCount = route ? walkedRoutes.size : report.edges.length
  const dropRow = (drop: MapChronicleReport['drops'][number]) => {
    const name = masterShipName(drop.mstId)
    return `<div class="map-personal-drop">
      <span>${esc(letterOf(drop.cell))} 点</span>
      ${shipThumbHtml(drop.mstId, name, { className: 'drop' })}
      ${elink('mstShip', drop.mstId, name)}
      <b>×${drop.count}</b>
    </div>`
  }
  const visibleDrops = drops.slice(0, 12).map(dropRow).join('')
  const hiddenDrops = drops.slice(12).map(dropRow).join('')
  return `<div class="sec map-personal">
    <div class="sec-h">海域记录<span class="aux">本地遭遇志 · 永久累计</span></div>
    <div class="map-personal-metrics">
      <span><small>出击</small><b>${report.sortieCount}</b></span>
      <span><small>战斗</small><b>${battles}</b></span>
      <span><small>Boss 战</small><b>${bossBattles}</b></span>
      <span><small>走过路线</small><b>${walkedRouteCount}</b></span>
    </div>
    <div class="map-personal-nodes map-node-filters">${cells || '<span class="af-empty">暂无战斗节点</span>'}</div>
    <div class="map-model-title">实际掉落${personalNode ? ` · ${esc(personalNode)} 点` : ''}</div>
    <div class="map-personal-drops">${visibleDrops || `<div class="af-empty">${personalNode ? `${esc(personalNode)} 点暂无舰娘掉落记录` : '暂无舰娘掉落记录'}</div>`}</div>
    ${hiddenDrops ? `<details class="map-personal-more"><summary>展开其余 ${drops.length - 12} 条掉落记录</summary>${hiddenDrops}</details>` : ''}
    <div class="q-foot">${latestTs ? `最近战斗 ${esc(fmtTime(latestTs))} · ` : ''}逐场过程仍可在顶栏「回顾」查看</div>
  </div>`
}

// ---- 缺包时的本机实测点位段（自扩展体检待裁 1，2026-08-23 用户拍板选项 C）----
//
// 「拓扑只来自 fcd 包」那条边界这一次**只放宽到一档**：四个包（fcd 拓扑 / kcwiki 带路 /
// map-drops / map-enemy-comps）**都没有**这张图时，才从本机遭遇志长出一段临时点位。
// 任何一个包收了这张图就整块让位——不与官方拓扑并存，免得被读成完整拓扑。
//
// 画什么由 shared/local-map-topology 那个纯函数判（脱开 DOM 能真跑）：
// 只画你走过的边，点位用边号不猜字母，一条边都推不出来就只列点位、不画连线。
const localMapGraphHtml = (info: any, code: string, credit: string): string => {
  const mapId = Number(info.api_id) || 0
  const missing = `<div class="sec"><div class="sec-h">节点图<span class="aux">${credit}</span></div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
        海图资料暂无 <b>${esc(code)}</b> 路线图</div>`
  const officialAbsent = officialMapMaterialAbsent({
    // 「收了这张图」得是**画得出来**才算。上游给新图落的空壳按 Boolean() 是真，
    // 于是这一层会以为官方已经有拓扑而整块让位——新图上连本机遭遇志长出来的
    // 临时点位图也不出，一片空白（判据见 shared/fcd-topology.ts）
    fcdTopology: fcdTopologyUsable(fcdMapLode?.data?.[code]),
    routing: Boolean(routingLode?.data?.[code]?.nodes?.length),
    drops: Boolean(mapDropsInfo(code)),
    enemyComps: Boolean(mapEnemyCompsInfo(code)),
  })
  if (!officialAbsent || mapId <= 0) return `${missing}</div>`
  // 遭遇志与航迹都走既有的取数口径（各自带在途守卫与墓碑），不为这一段另开一条路
  ensureMapChronicle(mapId)
  loadMapRouteTally(code, mapId)
  const chronicle = mapChronicle.get(mapId) ?? EMPTY_MAP_CHRONICLE
  const branches = mapRouteTally?.code === code ? mapRouteTally.branches : null
  const topo = localMapTopology(chronicle, branches)
  if (!topo.nodes.length) return `${missing}</div>`

  // 挂牌用事实措辞：说清这是什么、为什么点位是编号、以及它会让位
  const note = '<div class="mg-local-note" title="点位为罗盘边号 · 同一点位可能有多个边号">仅显示本地航迹边</div>'
  const pill = (node: (typeof topo.nodes)[number]) =>
    `<span class="own-pill${node.boss ? ' map-personal-boss' : ''}"
        title="${node.start ? '出击起点的第一步 · ' : ''}${
          node.battles ? `本地点位战斗 ${node.battles} 次` : '本地经过 · 暂无战斗记录'
        }">#${node.cell}${node.boss ? ' · Boss' : ''}${node.battles ? ` <b>${node.battles}</b> 战` : ''}</span>`

  if (topo.linksUnavailable) {
    // 推不出边就**只列点位**，不硬造连线
    return `${missing}
      ${note}
      <div class="mg-local-nodes">${topo.nodes.map(pill).join('')}</div></div>`
  }

  // 逐层排布：一层一列，层内按边号。坐标是**排出来的**，不是官方坐标——
  // 所以这张图不画背景、不摆比例尺，看起来就该像一张示意图。
  const COL = 150
  const ROW = 62
  const PAD = 40
  const rows = Math.max(...topo.layers.map((layer) => layer.length))
  const width = topo.layers.length * COL + PAD
  const height = rows * ROW + PAD
  const pos = new Map<number, [number, number]>()
  topo.layers.forEach((layer, column) => {
    layer.forEach((cell, index) => {
      const y = (index - (layer.length - 1) / 2) * ROW + height / 2
      pos.set(cell, [column * COL + PAD, y])
    })
  })
  const maxCount = Math.max(1, ...topo.links.map((link) => link.count))
  const edges = topo.links
    .map((link) => {
      const from = pos.get(link.from)
      const to = pos.get(link.to)
      if (!from || !to) return ''
      const width2 = 1.4 + (link.count / maxCount) * 3
      return `<line class="mg-e on" x1="${from[0]}" y1="${from[1].toFixed(1)}" x2="${to[0]}" y2="${to[1].toFixed(1)}" stroke-width="${width2.toFixed(1)}">
        <title>#${link.from} → #${link.to} · 本地通过 ${link.count} 次</title></line>`
    })
    .join('')
  // 这张图的格子**一个都不可点**（不发 data-mg-jump），是有意的不是漏做：
  // 敌编成小节按 fcd 的点位字母排，而这条路正是「fcd 没有这张图」才走到的——
  // 字母在这里根本不存在，格子上的号是罗盘边号（见本文件上方那段说明）。
  // 硬按边号去找小节只会找错行，而找错行比不能点更糟。
  // 何况走到这条路的前提是四个包都没有这张图，那时下面本来也没有敌编成可跳。
  const circles = topo.nodes
    .map((node) => {
      const at = pos.get(node.cell)
      if (!at) return ''
      const cls = ['mg-n', node.start ? 'start' : '', node.boss ? 'boss' : '', node.battles ? 'fought' : '']
        .filter(Boolean)
        .join(' ')
      const tip = [
        node.start ? '出击起点的第一步' : '',
        node.battles ? `本地点位战斗 ${node.battles} 次` : '本地经过 · 暂无战斗记录',
        node.boss ? 'Boss 点（本地记录）' : '',
      ]
        .filter(Boolean)
        .join(' · ')
      return `<g class="${cls}"><circle cx="${at[0]}" cy="${at[1].toFixed(1)}" r="${node.boss ? 17 : 14}" stroke-width="${node.boss ? 2.2 : 1.5}"/>
        <text x="${at[0]}" y="${(at[1] + 4).toFixed(1)}" text-anchor="middle" font-size="12">#${node.cell}</text>
        <title>#${node.cell} · ${esc(tip)}</title></g>`
    })
    .join('')
  return `${missing}
    ${note}
    <svg class="mapgraph" viewBox="0 0 ${width} ${height}">${edges}${circles}</svg>
    <div class="mg-legend">
      <span><s class="on"></s>走过的边（粗细 = 次数）</span>
      <span><i class="start"></i>出击起点的第一步</span>
      <span><i class="fought"></i>打过仗</span>
      <span><i class="boss"></i>Boss（本地记录）</span>
    </div>
    <div class="q-foot">本机航迹 <b>${topo.links.length}</b> 条边 · <b>${topo.nodes.length}</b> 个点位${
      chronicle.sortieCount ? ` · 出击 ${chronicle.sortieCount} 次` : ''
    }</div></div>`
}

// ---- 节点图（04 稿）----
//
// 拓扑来自 poi fcd；本地遭遇志只负责叠加“走过/打过/Boss”，不反推未知拓扑。
const mapGraphHtml = (info: any): string => {
  const code = `${info.api_maparea_id}-${info.api_no}`
  const fcd = fcdMapLode?.data?.[code]
  const credit = fcdMapLode
    ? lodeCreditMark(fcdMapLode.meta, '本地遭遇志只叠加「走过/打过/Boss」')
    : '<span class="credit-mark" title="海图包">源</span>'
  // 空壳（上游给新图落的 `{spots:{},route:{}}`）与「包里没这张图」同等对待：
  // 都走下面这条专为新图准备的兜底路径。从前空壳能骗过 `!fcd?.spots`，
  // 于是新图既画不出图、挂牌也一条不出（判据见 shared/fcd-topology.ts）
  if (!fcdTopologyUsable(fcd)) {
    // 带路三段（中文条件 / 日文一手分歧 / 实测频率）必须跟着一起出——它们是**另一份
    // 资料**，海图包没有这张图不代表带路资料也没有。原先这条早退不带 routingHtml，
    // 于是一张刚实装的图连「资料中没有它的带路条件」那句挂牌都看不到，整段凭空消失，
    // 玩家分不出是「这图没有分歧」还是「我们没数据」（自扩展体检 2026-08-23 实测）。
    return `${localMapGraphHtml(info, code, credit)}${routingHtml(code)}`
  }
  // 图上哪些点位可点 = 下面真长得出敌编成小节的那些点位。判据只有 enemyCompNodes
  // 一个出口，敌编成那一段读的也是它——两边各写一份，迟早会有一边说「可点」
  // 另一边没有那一节，而那时点下去只是滚到空处，不报错。
  // 难度口径跟这一页其余部分（敌编成、点位预测）一样走 selectedMapDifficulty。
  const jumpNodes = new Set(enemyCompNodes(mapIntelMap(code, selectedMapDifficulty(info))?.nodes))
  const spots: Record<string, [number, number, string]> = fcd.spots
  const route: Record<string, [string | null, string]> = fcd.route
  const chronicle = mapChronicle.get(info.api_id) ?? EMPTY_MAP_CHRONICLE
  const letterOf = (cell: number): string | null => route[`${cell}`]?.[1] ?? null
  const battlesAt = new Map<string, number>()
  for (const cell of chronicle.cells) {
    const letter = letterOf(cell.cell)
    if (letter) battlesAt.set(letter, (battlesAt.get(letter) ?? 0) + cell.count)
  }
  const bossLetters = new Set(
    chronicle.bossCells.map(letterOf).filter(Boolean) as string[],
  )
  // 海图上的 Boss 圈说的是「你在这儿打过 Boss」这个历史事实，与预测的目标点
  // 是两码事——目标点只多描一道亮圈，不改 Boss 圈的语义。
  const targetLetter = routeTargetOf(info, code).target
  const edgeCount = new Map<string, number>()
  for (const edge of chronicle.edges) {
    const path = route[`${edge.cell}`]
    if (!path?.[0]) continue
    const key = `${path[0]}→${path[1]}`
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + edge.count)
  }

  // 视口按本图实际点位取，不同海域尺寸差很大
  const xs = Object.values(spots).map((s) => s[0])
  const ys = Object.values(spots).map((s) => s[1])
  const PAD = 34
  const [x0, y0] = [Math.min(...xs) - PAD, Math.min(...ys) - PAD]
  const [w, h] = [Math.max(...xs) - Math.min(...xs) + PAD * 2, Math.max(...ys) - Math.min(...ys) + PAD * 2]

  // 各图的 viewBox 尺寸差好几倍（宽 400~1100），若圆和字号写死单位数，
  // 缩放后实际像素会从「看得清」变成「看不清」。按 CSS 里的显示框（约 620×340）
  // 反算每单位对应多少像素，再把半径/字号/线宽按同一比例放大，观感就一致了。
  const S = Math.max(w / 620, h / 340, 1)
  const R = 12 * S
  const FS = 11 * S
  const maxEdge = Math.max(1, ...edgeCount.values())
  const seen = new Set<string>()
  const edges = Object.values(route)
    .filter((r) => r[0] && spots[r[0]] && spots[r[1]])
    .map((r) => {
      const key = `${r[0]}→${r[1]}`
      if (seen.has(key)) return '' // 多个 api_no 指向同一对端点时只画一条
      seen.add(key)
      const [ax, ay] = spots[r[0]!]
      const [bx, by] = spots[r[1]]
      const count = edgeCount.get(key) ?? 0
      const width = (count ? 1.4 + count / maxEdge * 3 : 1.2) * S
      return `<line class="mg-e${count ? ' on' : ''}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke-width="${width.toFixed(1)}">
        <title>${esc(r[0]!)} → ${esc(r[1])}${count ? ` · 本地通过 ${count} 次` : ' · 尚无本地记录'}</title></line>`
    })
    .join('')

  const nodes = Object.entries(spots)
    .map(([letter, [x, y, type]]) => {
      const battles = battlesAt.get(letter) ?? 0
      const isStart = type === 'start'
      const isBoss = bossLetters.has(letter)
      // 有落点才可点：资源点、气旋、只记了掉落的途中点下面没有敌编成小节，
      // 那就连手势都不给——做出可点的样子却点下去什么都不发生，比不可点更糟
      const jump = jumpNodes.has(letter)
      const cls = [
        'mg-n',
        isStart ? 'start' : '',
        isBoss ? 'boss' : '',
        battles ? 'fought' : '',
        letter === targetLetter ? 'mg-target' : '',
        jump ? 'mg-jump' : '',
      ].filter(Boolean).join(' ')
      // 标签一律用真实点名：73/136 张图有 2~4 个起点（活动图的多出撃地点），
      // 全写「出」会变成一堆一模一样的圈，认不出是哪个
      const tip = [
        isStart ? '出击起点' : battles ? `本地点位战斗 ${battles} 次` : '尚无本地战斗记录',
        isBoss ? 'Boss 点（本地记录）' : '',
      ].filter(Boolean).join(' · ')
      const radius = isBoss ? R * 1.25 : R
      return `<g class="${cls}"${jump ? ` ${MAP_NODE_JUMP_ATTR}="${esc(letter)}"` : ''}><circle cx="${x}" cy="${y}" r="${radius.toFixed(1)}" stroke-width="${(isBoss ? 2.2 : 1.5) * S}"/>
        <text x="${x}" y="${(y + FS * 0.35).toFixed(1)}" text-anchor="middle" font-size="${FS.toFixed(1)}">${esc(letter)}</text>
        <title>${esc(letter)} · ${tip}</title></g>`
    })
    .join('')

  return `<div class="sec"><div class="sec-h">节点图<span class="mg-code">${esc(code)}</span><span class="aux">叠加本地遭遇志 ${credit}</span></div>
    <svg class="mapgraph" viewBox="${x0} ${y0} ${w} ${h}">${edges}${nodes}</svg>
    <div class="mg-legend">
      <span><s class="on"></s>走过的边（粗细 = 次数）</span>
      <span><s></s>尚无记录</span>
      <span><i class="start"></i>出击起点</span>
      <span><i class="fought"></i>打过仗</span>
      <span><i class="boss"></i>Boss（本地记录）</span>
      <span><i class="mg-target"></i>目标点（走向预测依据）</span>
    </div>
    <div class="q-foot">已走过 <b>${edgeCount.size}</b> / ${seen.size} 条边${chronicle.sortieCount ? ` · 出击 ${chronicle.sortieCount} 次` : ''}</div>
  </div>
  ${routingHtml(code)}`
}

// ---- 通关阵容（2026-08-17 用户提议）----
// 「打赢过 Boss 的编成」按签名聚合，作个人带路参考：同一套编成到没到得了
// Boss，账本比 wiki 的自然语言条件诚实。只统计本机出击样本，难度与活动期
// 跟当前状态一致（与出击样本落表时同一口径）。
const mapClearFleetsHtml = (info: any): string => {
  const mapId = Number(info.api_id) || 0
  ensureMapClearFleets(mapId)
  const rows = mapClearFleets.get(mapId)
  // 标题带总数：只有两套的图一眼可知「没有更多」，不用怀疑入口丢了
  const headOf = (count: number | null) =>
    `<div class="sec map-clear-fleets"><div class="sec-h">通关阵容<span class="aux">击败 Boss 的本地编成${
      count ? ` 共 ${count} 套` : ''
    } · 本地带路参考</span></div>`
  const head = headOf(rows?.length ?? null)
  if (!rows) return `${head}<div class="af-empty">正在读取出击样本…</div></div>`
  if (!rows.length) {
    return `${head}<div class="af-empty">暂无这张图的 Boss 通关记录</div></div>`
  }
  const code = `${info.api_maparea_id}-${info.api_no}`
  const fcdRoute: Record<string, [string | null, string]> | undefined = fcdMapLode?.data?.[code]?.route
  const letterOf = (cell: number): string => fcdRoute?.[`${cell}`]?.[1] ?? `#${cell}`
  const equipName = (mstId: number) =>
    entityNamePlain('equip', mstId, mg.master.slotitems[mstId]?.name ?? `装备 #${mstId}`)
  const rowHtml = (row: MapClearFleetRow, rowIndex: number): string => {
    const decks = row.decks
      .map((deck, deckIndex) => {
        if (!deck.length) return ''
        const ships = deck
          .map((ship, shipIndex) => {
            const stype = mg.master.ships[ship.mstId]?.stype ?? 0
            const typeCn = STYPE_CN[stype] ?? mg.master.stypes[stype] ?? ''
            // 悬停给这一舰当时的装备（有记录才有）
            const loadout = row.equips?.[deckIndex]?.[shipIndex]
            const title = loadout?.length
              ? ` title="${esc(loadout.map((item) => `${equipName(item.mstId)}${item.level ? `★${item.level}` : ''}`).join('、'))}"`
              : ''
            // 点击开「通关那时」快照卡而不是活的图鉴页（2026-08-17 用户纠正：
            // 这行代表历史快照，超链接不该指向「现在的角色」）
            return `<span class="cf-ship" data-cf-snap="${rowIndex},${deckIndex},${shipIndex}" role="button"${title}>${
              typeCn ? `<em>${esc(typeCn)}</em>` : ''
            }${entityNameHtml('ship', ship.mstId, masterShipName(ship.mstId), { compact: true })}<i>Lv${ship.lv}</i></span>`
          })
          .join('')
        return `<div class="cf-deck">${deckIndex > 0 ? '<b class="cf-deck2">随伴</b>' : ''}${ships}</div>`
      })
      .join('')
    const reachRate = row.sorties ? Math.round((row.reached / row.sorties) * 100) : 0
    // 途径点位（用户点名：判断是不是绕原路通关）：最近一次赢的那场走的路
    const pathLine = row.path.length
      ? `<div class="cf-path">航迹 起→${row.path.map((cell) => esc(letterOf(cell))).join('→')}${
          row.pathVaried
            ? '<em title="当前编成多次通关路径不同 · 显示最近一次">路线有变</em>'
            : ''
        }</div>`
      : ''
    // 装备搭配（用户点名：桶之类的特殊装备会引导路径）：全队聚合计数。
    // 首版拿文字名平铺，一队 20 多件糊成一段（2026-08-18 用户实锤「密密麻麻」），
    // 改成与编队行同语汇的类别图标 ×N——图标即装备实体链接（悬停出名字卡），
    // 逐舰明细点舰名开快照卡。老样本没记录就不摆行，不冒充。
    let equipLine = ''
    if (row.equips) {
      const counts = new Map<number, number>()
      for (const deck of row.equips) {
        for (const ship of deck) {
          for (const item of ship) counts.set(item.mstId, (counts.get(item.mstId) ?? 0) + 1)
        }
      }
      if (counts.size) {
        const chips = [...counts]
          .sort((left, right) => right[1] - left[1])
          .map(([mstId, count]) => {
            const equip = friendlyEquips.get(mstId)
            const iconId = Array.isArray(equip?.api_type) ? equip.api_type[3] : 0
            return `<span class="cf-eq">${elinkHtml(
              'mstEquip',
              mstId,
              equipTypeIconHtml(iconId, { className: 'xs' }),
              undefined,
              { 'aria-label': equipName(mstId) },
            )}${count > 1 ? `<i>×${count}</i>` : ''}</span>`
          })
          .join('')
        equipLine = `<div class="cf-equips"><span class="k" title="最近一次胜利战斗的全队装备">装备</span>${chips}</div>`
      }
    }
    return `<div class="cf-row">
      ${decks}
      ${pathLine}
      ${equipLine}
      <div class="cf-stats">出击 <b>${row.sorties}</b> · 到 Boss <b>${row.reached}/${row.sorties}</b>（${reachRate}%）· Boss 胜 <b>${row.wins}</b>${row.sWins ? `（S ${row.sWins}）` : ''}${
        row.los33 != null ? ` · 33式 <b>${row.los33.toFixed(1)}</b>` : ''
      } · 最近 ${fmtDate(row.lastWinTs)}</div>
    </div>`
  }
  // 不一次全铺开（用户点名）：主推头两套，其余点「展开」逐套亮出、可收起
  const lead = rows
    .slice(0, 2)
    .map((row, index) => rowHtml(row, index))
    .join('')
  const rest = rows.slice(2)
  const more = rest.length
    ? mapClearFleetsOpen
      ? `${rest.map((row, index) => rowHtml(row, index + 2)).join('')}<button class="cf-more-btn" data-cf-more>收起 ▴</button>`
      : `<button class="cf-more-btn" data-cf-more>展开其余 ${rest.length} 套 ▾</button>`
    : ''
  return `${head}${lead}${more}
    <div class="q-foot" title="最近一次胜利战斗">到 Boss 率：当前编成本图全部出击 · 含未胜场次</div>
  </div>`
}

// ---- 带路条件（04 稿）----
// 舰C 的带路规则固定，故做成快照包（kcwiki 各图「带路条件」子页）。
// 时效上有个坑必须点破：这些页 2026-07 被机器人批量改过样板，mtime 全被刷新，
// 但表格内容多数停在 2021-10-06 那次批量导入。包里逐图记的是
// **最后一次非机器人编辑**，这里就照它显示，不拿 mtime 冒充「刚核对过」。
const kcnavRoutingHtml = (code: string): string => {
  if (!kcnavRoutingLode) return ''
  const map = kcnavRoutingLode.data?.maps?.[code]
  if (!map?.branches) return ''
  const deckId = forecastDeckScope(mapState.fleetId).canonicalDeckId
  const fleet = kcnavFleetForDeck(deckId)
  const rows = Object.entries<any>(map.branches).flatMap(([from, branch]) => {
    const candidates = (branch?.edges ?? []).map((edge: any) => `${edge?.to ?? ''}`).filter(Boolean)
    const estimate = estimateKcnavBranch(branch, fleet, candidates)
    if (!estimate) return []
    return [
      `<div class="rt-row kcnav">
        <span class="rt-from">${esc(from)}</span>
        <div class="rt-rules">${estimate.routes
          .map(
            (route) =>
              `<div class="rt-r">${esc(route.to)} <b>${Math.round(route.probability * 100)}%</b> · ${route.count}/${estimate.sample}</div>`,
          )
          .join('')}</div>
      </div>`,
    ]
  })
  const label = forecastFleetLabelForDeck(deckId)
  return `<div class="sec"><div class="sec-h">编成实测分歧
      <span class="aux">${esc(label)} · ${rows.length} 个精确命中分歧 ${lodeCreditMark(
        kcnavRoutingLode.meta,
        '匿名实测频率 · 非游戏硬规则；确定带路条件见下方规则及实际罗盘',
      )}</span></div>
    ${
      rows.join('') ||
      '<div style="font-size:11.5px;color:var(--dim);line-height:1.8">当前舰种编成暂无 ≥20 次的同编成分歧样本</div>'
    }
  </div>`
}

const wikiwikiRoutingHtml = (code: string): string => {
  if (!wikiwikiRoutingLode) return ''
  const map = wikiwikiRoutingLode.data?.maps?.[code]
  if (!Array.isArray(map?.nodes) || !map.nodes.length) return ''
  const rows = map.nodes
    .map((node: any) => {
      const routes = Array.isArray(node?.routes) ? node.routes : []
      return `<div class="rt-row">
        <span class="rt-from">${esc(node?.from ?? '')}</span>
        <div class="rt-rules">${routes
          .map(
            (route: any) =>
              `<div class="rt-r">→ ${esc(route?.to ?? '?')}　${esc(route?.conditionJp ?? '')}</div>`,
          )
          .join('')}</div>
      </div>`
    })
    .join('')
  return `<div class="sec"><div class="sec-h">日文一手分歧说明
      <span class="aux">${map.nodes.length} 个分歧点 ${lodeCreditMark(wikiwikiRoutingLode.meta)}</span></div>
    ${rows}
  </div>`
}

const routingHtml = (code: string): string => {
  const entry = routingLode?.data?.[code]
  const credit = routingLode
    ? lodeCreditMark(routingLode.meta)
    : '<span class="credit-mark" title="带路条件资料尚未就绪">源</span>'
  const primary = `${kcnavRoutingHtml(code)}${wikiwikiRoutingHtml(code)}`
  if (!entry?.nodes?.length) {
    return `${primary}<div class="sec"><div class="sec-h">中文带路条件<span class="aux">${credit}</span></div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
        资料暂无 <b>${code}</b> 带路条件</div></div>`
  }
  const rows = entry.nodes
    .map(
      (n: { from: string; rules: string[] }) => `<div class="rt-row">
        <span class="rt-from">${esc(n.from)}</span>
        <div class="rt-rules">${n.rules.map((r) => `<div class="rt-r${r.startsWith('└') ? ' sub' : ''}">${esc(r)}</div>`).join('')}</div>
      </div>`,
    )
    .join('')
  return `${primary}<div class="sec"><div class="sec-h">中文带路条件
      <span class="aux">${entry.nodes.length} 个分歧点 ${credit}</span></div>
    ${rows}
  </div>`
}

/**
 * 「本机确认」：这张图你自己捞到过什么。
 *
 * 与上面的离线目录**并列而不合并**（2026-08-22 用户拍板）——排法与舰娘「获取」页
 * 同族：离线目录在前、本地遭遇志在后（那一排有护栏钉着）。
 * 与上方「我的海域记录 · 实际掉落」也不重复：那一段按点位分，这一段答的是
 * 「目录说的和我实际捞到的对不对得上、有没有目录没收我却捞到过的」。
 */
const localDropPoolHtml = (
  code: string,
  mapId: number,
  cataloged: ReadonlySet<number>,
): string => {
  const mine = (mapChronicle.get(mapId) ?? EMPTY_MAP_CHRONICLE).localDrops
  if (!mine.battles) return ''
  const beyond = mine.ships.filter((drop) => !cataloged.has(drop.mstId))
  // ⑤-裁-2（2026-08-22 用户拍板）：限定期结束后**永不删除，只换语境**。
  // 「你在这里捞到过」是永真的历史事实；窗口收了之后要变的是呈现——
  // 那几条折进「往期」并写明窗口已结束，不再混在面向当下的清单里。
  // 判据是纯函数 localDropEraOf（可脱 DOM 测），窗口从第一方台账取。
  const today = fmtDate(Date.now())
  // 点位字母只在这一层反查（`cell` 是罗盘 api_no，字母归展示侧）。表在这张图上
  // 缺就照实写 `#编号`——不猜一个字母出来。逐点计数由装配期给好，这里零扫描。
  const route: Record<string, [string | null, string]> | undefined =
    fcdMapLode?.data?.[code]?.route
  const letterOf = (cell: number): string => route?.[`${cell}`]?.[1] ?? `#${cell}`
  const graded = mine.ships.map((drop) => ({
    drop,
    era: localDropEraOf(
      limitedWindowsOf(code, drop.mstId).map((one) => one.window),
      fmtDate(drop.lastTs),
      today,
    ),
  }))
  const current = graded.filter((one) => one.era.era === 'current')
  const past = graded.filter((one) => one.era.era === 'past')
  const rowHtml = ({ drop, era }: (typeof graded)[number]) => {
    const name = masterShipName(drop.mstId)
    const extra = !cataloged.has(drop.mstId)
    const closed = era.window
    const cells = localDropCellsText(drop.cells, letterOf)
    return `<div class="dp-row${extra && !closed ? '' : ' got'}">
      <span class="dp-n">${shipThumbHtml(drop.mstId, name, { className: 'drop' })}${
        closed
          ? `<b class="mi-limited" title="${esc(limitedWindowText(closed))}">限定期捞到 · 窗口已结束</b> `
          : extra
            ? '<b class="mi-limited">目录未收</b> '
            : ''
      }${elink('mstShip', drop.mstId, name)}</span>
      <span class="dp-w"${
        // 点位分布进悬停：一眼位置只留次数，「在哪几个点」是追问的答案。
        // 老记录没落点位时是空串——那时不挂 title，而不是挂一个空悬停框。
        cells ? ` title="${esc(cells)}"` : ''
      }>捞到 ${drop.count} 次</span>
      <span class="dp-got">${esc(fmtDate(drop.lastTs))}</span>
    </div>`
  }
  const shown = current.slice(0, 12)
  const rows = shown.map(rowHtml).join('')
  return `<div class="map-model-title">本机确认 · 本地掉落记录</div>
    <div class="mi-summary">
      <span class="own-pill">${mine.battles} 战 · <b>${mine.ships.length}</b> 种</span>
      ${beyond.length ? `<span class="own-pill mi-gold">目录未收 <b>${beyond.length}</b></span>` : ''}
      ${past.length ? `<span class="own-pill">往期 <b>${past.length}</b></span>` : ''}
      ${mine.sWinsWithoutDrop ? `<span class="own-pill mi-warn">S 胜空手 ${mine.sWinsWithoutDrop}/${mine.sWins}</span>` : ''}
    </div>
    <div class="mi-drop-list">${
      rows || '<div style="font-size:11.5px;color:var(--dim)">当前海图暂无掉落记录</div>'
    }</div>
    ${
      past.length
        ? foldedNote(
            `往期 · 限定期捞到 ${past.length} 种（窗口已结束）`,
            `<div class="mi-drop-list">${past.slice(0, 12).map(rowHtml).join('')}</div>`,
            'mi-past',
          )
        : ''
    }`
}

const confirmedDropPoolHtml = (
  code: string,
  mapId: number,
  difficulty?: EventDifficulty,
): string | null => {
  const intel = mapIntelMap(code, difficulty)
  if (!intel) return null
  const byShip = new Map<
    number,
    {
      id: number
      nodes: string[]
      limited: { node: string; from: string; until: string | null; lastConfirmedAt: string }[]
    }
  >()
  const emptyNodes: string[] = []
  for (const node of Object.keys(intel.nodes).sort()) {
    const current = mapIntelNode(code, node, undefined, difficulty)
    if (!current) continue
    if (current.emptyDrop === 'confirmed') emptyNodes.push(node)
    for (const ship of current.ships) {
      const row = byShip.get(ship.id) ?? { id: ship.id, nodes: [], limited: [] }
      row.nodes.push(node)
      if (ship.limited) row.limited.push({ node, ...ship.limited })
      byShip.set(ship.id, row)
    }
  }
  const owned = (id: number) => chainInstances(rootOf.get(id) ?? id).length > 0
  const allShips = [...byShip.values()].sort(
    (a, b) =>
      Number(b.limited.length > 0) - Number(a.limited.length > 0) ||
      Number(owned(a.id)) - Number(owned(b.id)) ||
      a.id - b.id,
  )
  // 「这张图没有掉落资料」与「确认这张图一条都不掉」是两件事，混起来说就是在撒谎。
  // 常规图的掉落全由汇编层供，它没覆盖这张图 = 没人供数据 → 返回 null，
  // 交给 dropPoolHtml 挂「本地目录待更新」并照列本机遭遇志。
  if (!allShips.length && !emptyNodes.length && !mapDropsInfo(code)) return null
  const dropNodes = [...new Set([
    ...allShips.flatMap((ship) => ship.nodes),
    ...emptyNodes,
  ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const dropNode = dropNodes.includes(mapState.dropNode) ? mapState.dropNode : ''
  const ships = allShips
    .filter((ship) => !dropNode || ship.nodes.includes(dropNode))
    .map((ship) => dropNode
      ? { ...ship, nodes: [dropNode], limited: ship.limited.filter((entry) => entry.node === dropNode) }
      : ship)
  const limitedShips = ships.filter((ship) => ship.limited.length > 0)
  const expansionKey = `${code}:${difficulty ?? '常规'}:${dropNode || '全部'}`
  const expanded = expandedMapDrops.has(expansionKey)
  const shown = expanded ? ships : ships.slice(0, 12)
  const rows = shown
    .map((ship) => {
      const has = owned(ship.id)
      const name = masterShipName(ship.id)
      return `<div class="dp-row${has ? ' got' : ''}">
        <span class="dp-n">${shipThumbHtml(ship.id, name, { className: 'drop' })}${ship.limited.length ? '<b class="mi-limited">限时</b> ' : ''}${elink('mstShip', ship.id, name)}</span>
        <span class="dp-w">${esc(ship.nodes.join(' · '))} 点</span>
        ${has ? '<span class="dp-got">已持有</span>' : ''}
      </div>`
    })
    .join('')
  const windows = limitedShips
    .flatMap((ship) =>
      ship.limited.map(
        (window) => `<div class="rt-r">
          ${elink('mstShip', ship.id, masterShipName(ship.id))}
          <span class="mi-window">${esc(window.node)} · ${esc(limitedWindowText(window))}</span>
          <span class="mi-checked">最后确认 ${esc(window.lastConfirmedAt.replaceAll('-', '/'))}</span>
        </div>`,
      ),
    )
    .join('')
  // 限定期这一格 2026-08-22 起由第一方台账供，不再是底座的域——「源」角标要说它自己的
  // 核对日。照读掉落层或底座的日期，就是拿另一个包的日期给这一段背书。
  const windowCredit = limitedLedgerInfo()
  // 掉落这一域 2026-08-22 起由第一方汇编包 map-drops 供，「源」角标与「资料核对」
  // 要说它自己的日期——照读底座的，就是拿另一个包的日期给这一段背书。
  const credit = mapDropsInfo(code) ?? intel
  return `<div class="sec"><div class="sec-h">确认掉落
      <span class="aux">${difficulty ? `${difficulty}难度 · ` : ''}${dropNode ? `${dropNode}点 ${ships.length}/${allShips.length}` : ships.length} 舰 <span class="credit-mark" title="离线海域资料 · 修订 ${esc(credit.revision)}">源</span></span></div>
    <div class="mi-summary">
      <span class="own-pill">已确认 <b>${ships.length}</b> 舰</span>
      ${limitedShips.length ? `<span class="own-pill mi-gold">限时掉落 <b>${limitedShips.length}</b></span>` : ''}
      ${emptyNodes.length ? `<span class="own-pill mi-warn">${esc(emptyNodes.join('、'))} 点存在空掉落</span>` : ''}
    </div>
    ${dropNodes.length > 1 ? `<div class="mi-node-filters map-node-filters">
      <button class="own-pill map-node-filter${dropNode ? '' : ' on'}" data-map-drop-node="" aria-pressed="${dropNode ? 'false' : 'true'}">全部</button>
      ${dropNodes.map((node) => `<button class="own-pill map-node-filter${dropNode === node ? ' on' : ''}"
        data-map-drop-node="${esc(node)}" aria-pressed="${dropNode === node ? 'true' : 'false'}">${esc(node)} 点</button>`).join('')}
    </div>` : ''}
    ${
      windows
        ? `<div class="rt-row mi-windows"><span class="rt-from">限定期${
            windowCredit
              ? ` <span class="credit-mark" title="${esc(windowCredit.source)} · 核对 ${esc(windowCredit.checkedAt)}">源</span>`
              : ''
          }</span><div class="rt-rules">${windows}</div></div>`
        : ''
    }
    <div class="mi-drop-list">${rows || '<div style="font-size:11.5px;color:var(--dim)">暂无确认条目</div>'}</div>
    <div class="q-foot mi-foot">
      ${ships.length > 12 ? `<button class="pf-btn mi-toggle" data-map-drop-expand="${esc(expansionKey)}">${expanded ? '收起' : `展开全部 ${ships.length} 舰`}</button>` : ''}
    </div>
    ${localDropPoolHtml(code, mapId, new Set(allShips.map((ship) => ship.id)))}
    <div class="q-foot">资料核对 ${esc(credit.checkedAt)} · <a class="wiki-link" href="https://kanlog.info/map/${esc(code.replace('-', ''))}/" target="_blank" rel="noreferrer">艦ログ ↗</a></div>
  </div>`
}

const dropPoolHtml = (code: string, mapId: number, difficulty?: EventDifficulty): string => {
  const confirmed = confirmedDropPoolHtml(code, mapId, difficulty)
  if (confirmed) return confirmed
  // 目录没收这张图时**不显示空列表**：本机遭遇志仍旧照列，那是玩家此刻唯一拿得到的线索。
  return `<div class="sec"><div class="sec-h">确认掉落<span class="aux">本地目录待更新</span></div>
    <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
      当前海域资料尚未收录 <b>${esc(code)}</b></div>
    ${localDropPoolHtml(code, mapId, new Set())}</div>`
}

let voiceAudio: HTMLAudioElement | null = null
/** 当前这一条的名字，摆在迷你播放条上。续播时照样报给总机（被按停期间名字可能换过）。 */
let voiceLabel = ''

// 被 BGM 试听按停时走这里：只暂停、不归零，玩家回头点同一句还能接着放。
// 语音钮上没有「在响」的视觉态（一直如此），所以这里只管声音。
// 迷你播放条上的暂停钮走的也是这一个（它只认总机，不认识这个模块）。
const pauseVoice = () => {
  if (!voiceAudio || voiceAudio.paused) return
  voiceAudio.pause()
  notePreviewStopped('voice', 'pause')
}

registerPreviewPlayer('voice', {
  pause: pauseVoice,
  // 迷你条上的续播：等价于回头再点一次那一格。src 没变、也没播完，
  // playVoiceUrl 那边判出来就是 resume，一个字节都不会碰 src。
  resume: () => {
    if (!voiceAudio || !voiceAudio.paused || voiceAudio.ended || !voiceAudio.src) return
    playVoiceUrl(voiceAudio.src, undefined, voiceLabel)
  },
  audio: () => voiceAudio,
})

/**
 * 摆给迷你播放条看的名字：**舰名 · 场合**，两样都没有就写「语音」。
 * 只要短——条子是一行小胶囊，拼成长句就只剩省略号。
 */
const voiceLabelOf = (mstId: number, scene: string): string => {
  // 1500 起是深海——名字要走深海那条译名腿，走舰娘腿会查不到、把日文原文摆上屏
  // （与字幕层同一个阈值，见 renderer/voice-subtitle）。
  const domain = mstId >= 1_500 ? 'abyssShip' : 'ship'
  const ship = mstId > 0 ? entityNamePlain(domain, mstId, masterShipName(mstId)) : ''
  const parts = [ship, scene].map((part) => `${part ?? ''}`.trim()).filter(Boolean)
  return parts.join(' · ') || '语音'
}

/**
 * 播一条语音。**两个入口共用**（正常行的播放钮、骨架行探测成功之后），
 * 各写一份必然漂移——而漂移的表现是「有一条路播出来不入档」，不报错。
 *
 * 点同一条的循环是「播放 → 暂停 → 从暂停处接着放」，判据与 BGM 试听共用
 * （shared/preview-audio）。续播那一路**不许重设 src**，重设就归零了。
 *
 * @param pathname 有值就在**播成功之后**入档（地址现取的那些才带；
 *   档案里那一份本来就在档案里，不必再入一次）。
 * @param label 摆在迷你播放条上的名字（舰名 · 场合）。不给就沿用上一条的。
 * @returns 这一下的结果。**调用方要不要看随意**（正常的播放钮一概不看），
 *   深海考古那条路要：它靠「响没响」区分「档名猜对了」与「服务器上没有这一条」，
 *   而那正是 `play()` 兑现与否的差别。返回值一律是兑现的 promise（内部已 catch），
 *   不看它也不会留下未处理的拒绝。
 */
const playVoiceUrl = (
  url: string,
  pathname?: string,
  label?: string,
): Promise<'played' | 'paused' | 'failed'> => {
  const action = previewClickAction(voiceAudio, url)
  if (action === 'pause') {
    pauseVoice()
    return Promise.resolve('paused')
  }
  if (!voiceAudio) {
    voiceAudio = new Audio()
    voiceAudio.addEventListener('ended', () => notePreviewStopped('voice', 'ended'))
    // 半路断流 / 档案文件坏掉：play() 那个 promise 早就兑现过了，不走 catch 那一支。
    // 不在这里报一声，游戏音量就一直压着不放，迷你条也一直挂着一条放不动的语音。
    voiceAudio.addEventListener('error', () => notePreviewStopped('voice', 'error'))
  }
  if (action === 'restart') voiceAudio.src = url
  // 每次播放前取一次：钥里改音量后已存在的 Audio 实例也要跟上
  voiceAudio.volume = previewVoiceVolume()
  if (label) voiceLabel = label
  // 先占位再出声：BGM 那边当场按停，游戏声音也随即压下去
  claimPreviewPlayback('voice', voiceLabel)
  return voiceAudio
    .play()
    .then(() => {
      // **播放即入档**：这一句在这台机器上响过了，就该留一份进档案。
      // 放在 play() 兑现之后：没播成的不该入档。
      // 续播（resume）不再入一次——冷启动那一次已经记过，同一条重复入档是白做功。
      if (pathname && action === 'restart') noteVoicePlayed(pathname, url)
      return 'played' as const
    })
    .catch((e) => {
      notePreviewStopped('voice', 'error')
      console.warn('[kanso] 语音播放失败', url, e)
      return 'failed' as const
    })
}

const confirmedEnemyPoolHtml = (
  code: string,
  difficulty?: EventDifficulty,
): string | null => {
  const intel = mapIntelMap(code, difficulty)
  if (!intel) return null
  // 点位取自 enemyCompNodes——节点图判「哪些点位可点」读的是同一个出口，
  // 于是「图上可点」与「下面有这一节」天然是同一句话（限定期过滤只动 ships，
  // 不碰 enemyComps，所以 mapIntelNode 那一层看到的编成与这里一致）
  const nodes = enemyCompNodes(intel.nodes)
    .map((node) => [node, mapIntelNode(code, node, undefined, difficulty)] as const)
    .filter((entry) => entry[1]?.enemyComps.length)
  if (!nodes.length) return null
  // 编成这一域 2026-08-22 起由第一方汇编包供，「源」角标与「资料核对」要说它自己的
  // 日期；汇编层没覆盖的图（活动图）退回底座（与掉落那一段同一纪律）。
  const compCredit = mapEnemyCompsInfo(code) ?? intel
  const rows = nodes
    .map(([node, value]) => {
      const comps = value!.enemyComps
        .map((comp, index) => {
          // 显示仍用 wiki 标注名（带着主数据没有的形态信息），链接改用定好的号。
          // 汇编包的 ships 全是数字，标注文本长在 labels 上，优先读它。
          const fleet = comp.ships
            .map((ship, index) => {
              const label =
                comp.labels?.[index] ??
                (typeof ship === 'number'
                  ? (abyssalShips.get(ship)?.api_name ?? `深海舰 ${ship}`)
                  : ship)
              const id = typeof ship === 'number' ? ship : (comp.shipIds?.[index] ?? 0)
              return id
                ? `<span class="enemy-token">${shipThumbHtml(id, label, { className: 'battle', abyss: true })}${elink('abyssShip', id, label)}</span>`
                : entityTermHtml('abyssShip', undefined, label)
            })
            .join('')
          const formation = formationText(comp.formation)
          return `<div class="rt-r"><b>${esc(formation)}</b>
            ${comp.phase ? `<span class="mi-comp-no">${esc(comp.phase)}</span>` : ''}
            <span class="mi-comp-no">编成 ${index + 1}/${value!.enemyComps.length}</span> · ${fleet}</div>`
        })
        .join('')
      // 锚：节点图上点了这个点位就落到这一行（属性名与图上那个标记同一个出口）
      return `<div class="rt-row" ${ENEMY_COMP_ANCHOR_ATTR}="${esc(node)}"><span class="rt-from">${esc(node)}</span><div class="rt-rules">${comps}</div></div>`
    })
    .join('')
  return `<div class="sec"><div class="sec-h">敌编成
      <span class="aux">${difficulty ? `${difficulty}难度 ` : ''}<span class="credit-mark" title="离线海域资料 · 修订 ${esc(compCredit.revision)}">源</span></span></div>
    ${rows}
    <div class="q-foot">资料核对 ${esc(compCredit.checkedAt)}</div>
  </div>`
}

const prefetchHtml = (code: string, difficulty?: EventDifficulty): string => {
  const confirmed = confirmedEnemyPoolHtml(code, difficulty)
  if (confirmed) return confirmed
  return `<div class="sec"><div class="sec-h">敌编成<span class="aux">本地目录待更新</span></div>
    <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
      当前海域资料尚未收录 <b>${esc(code)}</b></div></div>`
}

interface MiniMapOptions {
  compact?: boolean
  focusNodes?: readonly string[]
}

// Peek 里的迷你海图：离线拓扑上叠加已经按需读到的本地遭遇志。
// 列表使用 compact 放大线点；深海出现海域再用 focusNodes 标出确认节点与字母。
const miniMapSvg = (code: string, mapId: number, options: MiniMapOptions = {}): string | null => {
  const fcd = fcdMapLode?.data?.[code]
  // 海域列表每行都调它；空壳放行的话，整列小地图的 viewBox 都是非有限数
  if (!fcdTopologyUsable(fcd)) return null
  const spots: Record<string, [number, number, string]> = fcd.spots
  const route: Record<string, [string | null, string]> = fcd.route
  const compact = Boolean(options.compact)
  const focused = new Set(options.focusNodes ?? [])
  const focusMode = focused.size > 0
  const denseCompact = compact && Object.keys(spots).length > 18
  const showFocusLabels = !denseCompact || focused.size <= 2
  const chronicle = mapChronicle.get(mapId) ?? EMPTY_MAP_CHRONICLE
  const letterOf = (cell: number) => route[`${cell}`]?.[1] ?? null
  const walked = new Set<string>()
  for (const edge of chronicle.edges) {
    const path = route[`${edge.cell}`]
    if (path?.[0]) walked.add(`${path[0]}→${path[1]}`)
  }
  const fought = new Set(
    chronicle.cells.map((cell) => letterOf(cell.cell)).filter(Boolean) as string[],
  )
  const bosses = new Set(
    chronicle.bossCells.map(letterOf).filter(Boolean) as string[],
  )

  const xs = Object.values(spots).map((s) => s[0])
  const ys = Object.values(spots).map((s) => s[1])
  const PAD = 26
  const x0 = Math.min(...xs) - PAD
  const y0 = Math.min(...ys) - PAD
  const w = Math.max(...xs) - Math.min(...xs) + PAD * 2
  const h = Math.max(...ys) - Math.min(...ys) + PAD * 2
  // 小列表只有约 60×34px，若仍按 Peek 的 240×120 比例绘制，节点会缩成 1px。
  const S = compact ? Math.max(w / 96, h / 52, 1) : Math.max(w / 240, h / 120, 1)

  const seen = new Set<string>()
  const edges = Object.values(route)
    .filter((r) => r[0] && spots[r[0]!] && spots[r[1]])
    .map((r) => {
      const key = `${r[0]}→${r[1]}`
      if (seen.has(key)) return ''
      seen.add(key)
      const [ax, ay] = spots[r[0]!]
      const [bx, by] = spots[r[1]]
      const on = !focusMode && walked.has(key)
      const opacity = on ? 0.95 : focusMode ? (denseCompact ? 0.26 : 0.42) : compact ? 0.8 : 0.58
      const width = on ? 2.2 : focusMode ? 1.05 : compact ? 1.45 : 1.2
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${on ? 'var(--accent)' : 'var(--sub)'}" stroke-opacity="${opacity}" stroke-width="${width * S}"/>`
    })
    .join('')
  const nodes = Object.entries(spots)
    .map(([l, [x, y, t]]) => {
      const isFocused = focusMode && focused.has(l)
      // “出现海域”只需路线作方位参照；无关节点全画出来会让活动图变成一团圆圈。
      if (focusMode && !isFocused) {
        return t === 'start'
          ? `<circle cx="${x}" cy="${y}" r="${3.2 * S}" fill="var(--bg1)" stroke="var(--ok)" stroke-width="${1.5 * S}"/>`
          : ''
      }
      const isBoss = !focusMode && bosses.has(l)
      const foughtHere = !focusMode && fought.has(l)
      const stroke = isFocused
        ? '#ff91a3'
        : isBoss
          ? 'var(--bad)'
          : t === 'start'
            ? 'var(--ok)'
            : foughtHere
              ? 'var(--accent)'
              : 'var(--sub)'
      const fill = isFocused
        ? '#4a1e29'
        : foughtHere
          ? 'color-mix(in srgb, var(--accent) 25%, var(--bg0))'
          : 'var(--bg1)'
      const radius = (
        isFocused
          ? denseCompact && focused.size > 2 ? 5.8 : 8
          : isBoss ? 7
          : compact ? 4.2 : 5.5
      ) * S
      const circle = `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${(isFocused ? 2 : 1.6) * S}"/>`
      const label = isFocused && showFocusLabels
        ? `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="#ffe8ec" font-family="var(--mono)" font-size="${9.5 * S}" font-weight="700">${esc(l)}</text>`
        : ''
      return circle + label
    })
    .join('')
  return `<svg class="mini-map${compact ? ' compact' : ''}${focusMode ? ' focused' : ''}${denseCompact ? ' dense' : ''}" viewBox="${x0} ${y0} ${w} ${h}">${edges}${nodes}</svg>`
}

// 海域 BGM（api_mst_mapbgm，2026-08-17 用户拍板启用）：海图移动 + 昼/夜战 + Boss。
// 昼夜同曲就合并写，别把同一首歌列两遍。♪ 词条可点试听（bgm-preview）。
const mapBgmLineHtml = (mapId: number): string => {
  // 主数据优先：活动在场期间以官方当刻下发的为准（期中改配曲的先例是有的）。
  // 撤场后那一行会从 start2 里消失，才回落到活动期间抄下的留存（shared/event-map-bgm）。
  const row =
    (mst?.api_mst_mapbgm ?? []).find((b: any) => b.api_id === mapId) ?? archivedMapBgmOf(mapId)
  if (!row) return ''
  const entries: [string, number][] = []
  if (row.api_moving_bgm > 0) entries.push(['海图', row.api_moving_bgm])
  const day = row.api_map_bgm?.[0] ?? 0
  const night = row.api_map_bgm?.[1] ?? 0
  if (day > 0 && day === night) entries.push(['战斗', day])
  else {
    if (day > 0) entries.push(['昼战', day])
    if (night > 0) entries.push(['夜战', night])
  }
  const bossDay = row.api_boss_bgm?.[0] ?? 0
  const bossNight = row.api_boss_bgm?.[1] ?? 0
  if (bossDay > 0 && bossDay === bossNight) entries.push(['Boss', bossDay])
  else {
    if (bossDay > 0) entries.push(['Boss 昼', bossDay])
    if (bossNight > 0) entries.push(['Boss 夜', bossNight])
  }
  if (!entries.length) return ''
  return `<div class="own-line map-bgm-line"><span class="k9">BGM</span>${entries
    .map(([label, id]) => `<span class="own-pill bgm">${label} ${bgmPreviewHtml(id, 'battle')}</span>`)
    .join('')}</div>`
}

/**
 * 计量条那几枚词条（2026-09-01 重接）。
 *
 * 主数据的 `api_required_defeat_count` 是个没单位的数、语义按图而异，
 * 曾经被当成「需击破 N 次」标出来，在 5-6（那 280 是输送 TP）与 7-5（那 2 只是
 * 第一段）上直接说了谎，于是整个撤下（dff30b3）。现在按 shared/map-gauge-metric
 * 那张按图核过的手工表渲染：**表里没有的图一枚都不出**——沿撤下之后的现状，
 * 宁可不说，也不要一句在某张图上是假的标签。文案只有表里那一份，这里不另拼词。
 */
const mapGaugePillsHtml = (mapId: number): string =>
  mapGaugeSegmentLabels(mapId)
    .map(
      (label) =>
        `<span class="own-pill">${label.lead ? `${esc(label.lead)} · ` : ''}${esc(label.head)} <b>${label.amount}</b>${label.tail ? ` ${esc(label.tail)}` : ''}</span>`,
    )
    .join('')

const mapDrawerHtml = () => {
  const info = mapInfos.find((m) => m.api_id === mapState.selected)
  if (!info) return ''
  const areaName = entityNamePlain(
    'mapArea',
    info.api_maparea_id,
    mapAreas.get(info.api_maparea_id) ?? '',
  )
  const code = `${info.api_maparea_id}-${info.api_no}`
  const difficulty = selectedMapDifficulty(info)
  const syncedDifficulty =
    EVENT_DIFFICULTY_BY_RANK[mg.mapGauges[info.api_id]?.selectedRank ?? 0]
  const eventPeriod = eventPeriodOf(info)
  const allowedFleets = mapFleetAllowanceLabels(info.api_sally_flag)
  const difficultyTabs = difficulty
    ? `<div class="own-line mi-diff-line"><span>资料难度</span>
        ${EVENT_DIFFICULTIES.map((item) => {
          const ready = Boolean(mapIntelMap(code, item))
          const synced = item === syncedDifficulty
          return `<button class="own-pill mi-diff${item === difficulty ? ' on' : ''}${ready ? '' : ' pending'}"
      data-map-difficulty="${item}" title="${synced ? '游戏当前难度 · ' : ''}${ready ? '已有本地资料' : '本地资料尚未补齐'}">
            ${item}${synced ? ' · 当前' : ''}${ready ? '' : ' · 待补'}
          </button>`
        }).join('')}
      </div>`
    : ''
  return `
  <div class="d-head">
    <span class="x" id="ji-map-close" title="关闭（Esc）">✕</span>
    <span class="crumb">${entityNameHtml('mapArea', info.api_maparea_id, areaName, { compact: true })} › <b>${entityTermHtml('map', info.api_id, code)}</b></span><span class="sp"></span>
  </div>
  <div class="detail">
    <div class="hero" style="background:radial-gradient(420px 200px at 85% 0%,rgba(63,208,176,.08),transparent 65%),var(--bg1)">
      <div class="hero-l">
        <div class="meta-line">
          <span class="badge" style="color:#8fe0cc;border-color:#2c5c50">${entityNameHtml('mapArea', info.api_maparea_id, areaName, { compact: true })}</span>
          <span class="no">${entityTermHtml('map', info.api_id, code)}</span>
          ${eventPeriod ? `<span class="map-event-hero ${eventPeriod.ended ? 'ended' : 'live'}" title="${esc(eventPeriod.basis)}">${eventPeriod.ended ? '活动已结束' : '活动进行中'} · ${esc(eventPeriod.text)}</span>` : ''}
        </div>
        <div class="name-block"><h1 style="font-size:24px">${entityNameHtml('map', info.api_id, info.api_name)}</h1></div>
        <div class="own-line">
          ${info.api_level ? `<span class="own-pill">海域 Lv <b>${info.api_level}</b></span>` : ''}
          ${mapGaugePillsHtml(info.api_id)}
          ${info.api_max_maphp ? `<span class="own-pill">血条 <b>${info.api_max_maphp}</b></span>` : ''}
          ${allowedFleets.map((label) => `<span class="own-pill">${esc(label)}</span>`).join('')}
        </div>
        ${mapBgmLineHtml(info.api_id)}
        ${difficultyTabs}
      </div>
    </div>
    ${mapOfficialInfoHtml(info)}
    ${mapArtHtml(info)}
    ${mapGraphHtml(info)}
    ${mapSpecialBonusHtml(code)}
    ${mapChronicleHtml(info)}
    ${mapClearFleetsHtml(info)}
    ${mapForecastHtml(info, code, difficulty)}
    ${prefetchHtml(code, difficulty)}
    ${dropPoolHtml(code, Number(info.api_id) || 0, difficulty)}
    <div class="foot"><span class="credit-mark" title="海域名称 ${info.__kansoArchiveFallback ? '旧归档仅保存编号' : eventPeriod?.ended ? '来自活动期间保存的游戏数据' : `来自游戏基础数据 · 更新于 ${masterTs ? fmtDate(masterTs) : '—'}`}${fcdMapLode ? ` ｜ 海图 ${esc(lodeCreditShort(fcdMapLode.meta))}` : ''}">源</span></div>
  </div>`
}

const mapOfficialInfoHtml = (info: any): string => {
  const operation = typeof info.api_opetext === 'string' ? info.api_opetext.trim() : ''
  const description =
    typeof info.api_infotext === 'string'
      ? info.api_infotext
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim()
      : ''
  const rewards = Array.isArray(info.api_item)
    ? info.api_item.map(Number).filter((id: number) => id > 0)
    : []
  const rewardHtml = rewards.length
    ? `<div class="map-official-rewards"><span>官方奖励栏</span>${rewards
        .map((id: number) =>
          elink('useitem', id, entityNamePlain('item', id, useitemMst.get(id)?.api_name ?? `道具 #${id}`)),
        )
        .join('')}</div>`
    : ''
  if (!operation && !description && !rewardHtml) return ''
  return `<div class="sec map-official">
    <div class="sec-h">作战概要<span class="aux">游戏原文</span></div>
    ${operation ? `<h3>${esc(operation)}</h3>` : ''}
    ${description ? `<p>${esc(description).replace(/\n/g, '<br>')}</p>` : ''}
    ${rewardHtml}
  </div>`
}

const mapArtHtml = (info: any): string => `
  <div class="sec">
    <div class="sec-h">官方海图</div>
    <div class="map-art-frame" data-map-art="${info.api_maparea_id}:${info.api_no}">
      <div class="map-art-state">读取游戏官方地图美术…</div>
    </div>
  </div>`

// ---- 完整装备矩阵（01 稿）----
//
// 口径同 poi views/utils/equipability.ts（MIT）：
//   1) api_mst_equip_ship 里有该舰条目 → 以它为准（key 存在即可装；
//      值为 null = 该类全可装，值为 number[] = 仅限这几件具体装备）
//   2) 没有条目 → 回退舰种默认 api_mst_stype[stype].api_equip_type[typeId] === 1
// 补强增设槽另有 api_mst_equip_exslot(_ship)，与常规槽不是一回事，单列。
interface EquipableType {
  id: number
  name: string
  only: number[] | null // 非 null = 仅限这几件
}

const equipableTypes = (shipMstId: number): EquipableType[] => {
  const named = (id: number) => equipTypes.get(id) ?? `分类${id}`
  return equipableTypeRulesForShip(mst, shipMstId).map((rule) => ({
    ...rule,
    name: named(rule.id),
  }))
}

// 补强增设。两张表的语义不同，不能混为一谈：
// - api_mst_equip_exslot：全舰通用的可装**类别**（equiptype id 数组）
// - api_mst_equip_exslot_ship：键是**装备 mstId**（不是舰 id），值给出该装备能装增设的条件
//   （api_ship_ids / api_stypes / api_ctypes 都是 Record<id,1> 而非数组；stype 99 = 全舰种）
// - api_mst_equip_limit_exslot：键是**舰 mstId**，值是该舰从通用类别中排除的 equiptype id
const exslotInfo = (shipMstId: number): {
  types: number[]
  excludedTypes: number[]
  extras: { id: number; name: string; reqLv: number }[]
} => {
  const universal: number[] = Array.isArray(mst?.api_mst_equip_exslot) ? mst.api_mst_equip_exslot : []
  const excludedTypes: number[] = Array.isArray(mst?.api_mst_equip_limit_exslot?.[`${shipMstId}`])
    ? mst.api_mst_equip_limit_exslot[`${shipMstId}`]
        .map(Number)
        .filter((id: number) => id > 0)
    : []
  const excluded = new Set(excludedTypes)
  const types = universal.filter((id) => !excluded.has(id))
  const table = mst?.api_mst_equip_exslot_ship
  const ship = friendlyShips.get(shipMstId)
  const extras: { id: number; name: string; reqLv: number }[] = []
  if (table && typeof table === 'object' && ship) {
    const hit = (rec: any, id: number | undefined) =>
      !!rec && typeof rec === 'object' && id != null && rec[`${id}`] != null
    for (const [equipIdStr, cond] of Object.entries<any>(table)) {
      const ok =
        hit(cond?.api_ship_ids, shipMstId) ||
        hit(cond?.api_stypes, ship.api_stype) ||
        hit(cond?.api_stypes, 99) || // 99 = 不限舰种
        hit(cond?.api_ctypes, ship.api_ctype)
      if (ok) {
        extras.push({
          id: +equipIdStr,
          name: friendlyEquips.get(+equipIdStr)?.api_name ?? `#${equipIdStr}`,
          reqLv: cond?.api_req_level ?? 0,
        })
      }
    }
  }
  return { types, excludedTypes, extras }
}

const equipMatrixHtml = (shipMstId: number): string => {
  const types = equipableTypes(shipMstId)
  // 一条规则都取不到时原先整段静默消失，读的人分不出是「这艘什么都装不了」
  // 还是「我们还没有它的规则」。判定表来自主数据（单舰矩阵 → 舰种默认矩阵），
  // 取不到只可能是主数据里那一层还没到——刚实装的新舰种正是这一种。
  if (!types.length) {
    return `<div class="sec"><div class="sec-h">可装备范围<span class="aux">待游戏同步</span></div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.8">
        这一形态的可装备规则待同步 · 进一次游戏后自动获取</div>
    </div>`
  }
  const chips = types
    .map((t) => {
      const limited = t.only && t.only.length
      if (!limited) return `<span class="em-chip">${entityNameHtml('equipType', t.id, t.name, { compact: true })}</span>`
      // 限定装备原先只塞在 title 提示里，看不见也点不了 —— 改成逐件实体链接
      const links = t
        .only!.slice(0, 8)
        .map((id) => equipVisualLink(id))
        .join('、')
      return `<span class="em-chip ltd">${entityNameHtml('equipType', t.id, t.name, { compact: true })}<i>限 ${t.only!.length}</i></span>
        <span class="em-only">${links}${t.only!.length > 8 ? ` 等 ${t.only!.length} 件` : ''}</span>`
    })
    .join('')
  const ex = exslotInfo(shipMstId)
  const exChips = ex.types.length
    ? `<div class="em-ex"><span class="em-k">补强增设 · 通用类别</span>${ex.types
        .map((id) => `<span class="em-chip ex">${entityNameHtml('equipType', id, equipTypes.get(id) ?? `分类${id}`, { compact: true })}</span>`)
        .join('')}</div>`
    : ''
  // 该舰额外可塞进增设的具体装备（按舰/舰种/舰级放行的那些）
  const exExtra = ex.extras.length
    ? `<div class="em-ex"><span class="em-k">可入增设的装备 ${ex.extras.length} 件</span>${ex.extras
        .slice(0, 12)
        .map(
          (e) =>
            `<span class="em-chip ex"${e.reqLv ? ` title="需 Lv${e.reqLv}"` : ''}>${equipVisualLink(e.id, e.name)}${
              e.reqLv ? `<i>Lv${e.reqLv}</i>` : ''
            }</span>`,
        )
        .join('')}${ex.extras.length > 12 ? `<span class="em-k">…等 ${ex.extras.length} 件</span>` : ''}</div>`
    : ''
  const exExcluded = ex.excludedTypes.length
    ? `<div class="em-ex excluded"><span class="em-k">该舰不适用的通用类别</span>${ex.excludedTypes
        .map((id) => `<span class="em-chip">${entityNameHtml('equipType', id, equipTypes.get(id) ?? `分类${id}`, { compact: true })}</span>`)
        .join('')}</div>`
    : ''
  const hasOverride = !!mst?.api_mst_equip_ship?.[`${shipMstId}`]
  return `<div class="sec"><div class="sec-h">可装备范围<span class="aux">${types.length} 类可装${
    hasOverride ? ' · 这艘舰娘有专属限制' : ' · 按舰种默认'
  }</span></div>
    <div class="em-grid">${chips}</div>
    ${exChips}
    ${exExcluded}
    ${exExtra}
  </div>`
}

// ---- 道具卷 ----

const itemState = { search: '', selected: 0, open: false, cat: 'all' as ItemCat }

// api_mst_useitem 是“道具入口目录”，库存并不全住在 api_useitem：
// 八项资源在 materials、家具币在 basic、要员/女神/粮食等在装备库存。
const MATERIAL_USEITEM = USEITEM_MATERIAL_INDEX
// 解析一次要扫一遍 master.slotitems（约 700 项，找同名的商店入口）再扫一遍装备实例，
// 而道具卷一次渲染要问上千次（筛选 + 分类计数 + 排序 + 逐行）。
// 按数据源的**对象身份**缓存：mg 的补丁是整块替换（Object.assign(mg, patch)，
// 报文经 IPC 反序列化必得新对象），身份没变就说明这份数据一个字都没动。
let useitemStockDeps: unknown[] = []
let useitemStockCache = new Map<number, UseitemStock>()
const useitemStock = (id: number): UseitemStock => {
  const deps = [
    mg.materials,
    mg.basic?.furnitureCoins,
    mg.useitems,
    mg.useitemsTs,
    mg.slotitems,
    mg.master.slotitems,
    mst, // 道具名来自 useitemMst（buildIndex 从这份原始主数据重建）
  ]
  if (deps.length !== useitemStockDeps.length || deps.some((dep, at) => dep !== useitemStockDeps[at])) {
    useitemStockDeps = deps
    useitemStockCache = new Map()
  }
  const cached = useitemStockCache.get(id)
  if (cached) return cached
  const stock = resolveUseitemStock(id, useitemMst.get(id)?.api_name ?? '', {
    materials: mg.materials,
    furnitureCoins: mg.basic?.furnitureCoins,
    useitems: mg.useitems,
    useitemsTs: mg.useitemsTs,
    slotitems: mg.slotitems,
    slotitemMasters: mg.master.slotitems,
    // require_info 同时给出完整装备表与非零道具表；旧快照已有装备实例时也可证明基线存在。
    slotitemsKnown: mg.useitemsTs != null || Object.keys(mg.slotitems).length > 0,
  })
  useitemStockCache.set(id, stock)
  return stock
}
const useitemCount = (id: number): number => useitemStock(id).count
const USEITEM_STOCK_SOURCE: Record<UseitemStock['source'], string> = {
  materials: '资源库存',
  furnitureCoins: '提督状态',
  slotitems: '装备库存',
  useitems: '道具库存',
}

// 分类（05 稿）。主数据的 api_usetype 只够分出「消耗资材/资源」两组，
// usetype=0 是 37 项大杂烩，撑不起设计稿的五分类。
// 所以「战略」这一档不硬编名单，而是**由改造需求反查得出**——
// 凡出现在 remodelNeeds 里的就是战略资材，游戏更新加了新道具会自动归位。
type ItemCat = 'all' | 'strategic' | 'consume' | 'resource' | 'other' | 'owned'
const ITEM_CATS: [ItemCat, string][] = [
  ['all', '全部'],
  ['owned', '持有中'],
  ['strategic', '战略资材'],
  ['consume', '消耗资材'],
  ['resource', '资源'],
  ['other', '其他'],
]

const itemCatOf = (u: any): Exclude<ItemCat, 'all' | 'owned'> => {
  if (remodelNeeds.has(u.api_id)) return 'strategic' // 改造要用 = 战略（数据推导）
  if ([1, 2, 3].includes(u.api_usetype)) return 'consume'
  if (u.api_usetype === 6) return 'resource'
  return 'other'
}

const itemCatalogHtml = () => {
  // 库存解析一次就够：筛选、分类计数、排序、逐行渲染原先各问各的，
  // 而比较器里问一次就是一遍全表扫描——先带着库存装饰，排完再取用。
  const all = [...useitemMst.values()]
    .filter((u) => u.api_name)
    .map((u) => ({ u, stock: useitemStock(u.api_id) }))
  const list = all.filter(({ u, stock }) => {
    if (itemState.search) {
      // searchFold：与舰娘/装备/深海三卷同一口径（全半角与重音同折）
      const q = searchFold(itemState.search)
      if (
        !searchFold(u.api_name).includes(q) &&
        !searchFold(entityNamePlain('item', u.api_id, u.api_name)).includes(q)
      ) return false
    }
    if (itemState.cat === 'owned') return stock.count > 0
    if (itemState.cat !== 'all' && itemCatOf(u) !== itemState.cat) return false
    return true
  })
  const catCount = (cat: ItemCat) =>
    cat === 'all'
      ? all.length
      : cat === 'owned'
        ? all.filter(({ stock }) => stock.count > 0).length
        : all.filter(({ u }) => itemCatOf(u) === cat).length
  const chips = ITEM_CATS.map(
    ([cat, label]) => {
      // “持有中”只是便于查看当前库存的筛选，不把当前非零道具数包装成收藏进度。
      // 活动兑换物等会在结束后被运营回收，这个数字并不具有长期比较意义。
      const count = cat === 'owned' ? '' : `<i>${catCount(cat)}</i>`
      return `<span class="icat${itemState.cat === cat ? ' on' : ''}" data-icat="${cat}">${label}${count}</span>`
    },
  ).join('')

  const rows = list
    .sort((a, b) => b.stock.count - a.stock.count || a.u.api_id - b.u.api_id)
    .map(({ u, stock }) => {
      const count = stock.count
      const on = u.api_id === itemState.selected && itemState.open
      const uses = remodelNeeds.get(u.api_id)?.length ?? 0
      return `<div class="row${count ? '' : ' ghost'}${on ? ' on' : ''}" data-item="${u.api_id}" style="--rc:${count ? '#8a6d2f' : '#3a4a58'}">
        <div class="face" style="color:#e8ce9a">${useItemIconHtml(u.api_id, entityNamePlain('item', u.api_id, u.api_name), { className: 'catalog' })}</div>
        <div class="nm"><b>${entityNameHtml('item', u.api_id, u.api_name, { compact: true })}</b><span>${stock.known ? `持有 ×${count}` : '尚未同步持有数量'}${
          uses ? ` · ${uses} 项改造要用` : ''
        }</span></div>
      </div>`
    })
    .join('')

  return `
    <div class="search-row"><div class="search">⌕<input id="ji-item-search" placeholder="道具名" value="${esc(itemState.search)}"></div></div>
    <div class="icats">${chips}</div>
    <div class="item-scope-note"><span>当前显示 <b>${list.length}</b> 项</span>
      <span>资料库共 ${all.length} 项</span></div>
    <div class="ship-list" id="ji-item-list">${rows || '<div style="padding:20px;color:var(--dim)">暂无匹配项</div>'}</div>`
}

// ---- 改造需求反查（05 稿「用途一览」与「需求队列」的数据源）----
//
// kcwiki-ships 的 改造.图纸 是一串「名称xN」（简中意译名），
// 而 useitem 主数据是日文名——两者不是字符转换关系
// （試製甲板カタパルト ↔ 试制甲板用弹射器 是意译），故用显式别名表对齐。
// 表很小且只是两个数据源之间的胶水；名称变动时这里会 miss 而不是错配，
// 未对上的道具名会照原样显示。
// 别名表与「名称xN」串解析已提到 shared/kcwiki-upgrade.ts —— 编队卷的「下一改装」
// 也要用同一套（它曾经把整串消耗当图纸数量 parseInt，误报「图纸不足」）。

// useitem id → kcwiki 简中名（上表的反向）。任务库是简中口径，而部分道具名是意译
// （試製甲板カタパルト ↔ 试制甲板用弹射器、砲熕 ↔ 火炮），字符转换到不了，
// 只能靠这张已对齐的表补上——实测能把奖励栏反查从 273 条命中补到 339 条。
const itemAliasCn = new Map<number, string>()
for (const [cn, id] of Object.entries(KCWIKI_ITEM_ALIAS)) {
  if (!itemAliasCn.has(id)) itemAliasCn.set(id, cn)
}

// 「可从未完成任务获得」（05 稿）：只认奖励栏命中。
// 三档分得清楚——「不在任务列表快照里」不等于「未完成」，那是猜的，单列一档说明白。
// 本名被哪些更长的道具名包住（「开发资材」⊂「新型喷进装备开发资材」）→ 交给 qn 先挖掉
const overshadowOf = (itemId: number): string[] => {
  const self = itemAliasCn.get(itemId)
  if (!self) return []
  return [...itemAliasCn.values()].filter((n) => n !== self && n.includes(self))
}

const itemAwardHtml = (itemId: number, jpName: string): string => {
  const textAwards = questsAwarding([jpName, itemAliasCn.get(itemId) ?? ''], overshadowOf(itemId))
  // 基础四资源:任务库的奖励文本只写道具,燃弹钢铝的数值在游戏 api_get_material 里
  //(2026-08-12 用户报出钢材页只剩 3 条文本命中)。文本命中(专项大额,含未同步的)
  // 在前,材料反查按金额降序补足;同一条任务不重复列。
  const materialIdx = USEITEM_MATERIAL_INDEX[itemId]
  const listedIds = new Set(textAwards.map((award) => award.id))
  const materialAwards =
    materialIdx !== undefined && materialIdx <= 3
      ? questsAwardingMaterial(materialIdx).filter((award) => !listedIds.has(award.id))
      : []
  const awards = [...textAwards, ...materialAwards]
  if (!awards.length) return ''
  const ready = awards.filter((a) => a.state === 3)
  const open = awards.filter((a) => a.state === 1 || a.state === 2)
  const unseen = awards.filter((a) => a.state == null)
  const row = (a: (typeof awards)[number], tag: string) =>
    `<div class="aw-row">${tag}
      <span class="aw-nm">${elinkHtml('quest', a.id, `${esc(a.code)} ${entityNameHtml('quest', a.id, a.name, { compact: true })}`)}</span>
      <span class="aw-rw">${esc(a.reward).slice(0, 40)}</span></div>`
  const blocks: string[] = []
  if (ready.length) {
    blocks.push(ready.map((a) => row(a, '<span class="aw-t ok">✓ 领取奖励</span>')).join(''))
  }
  if (open.length) {
    blocks.push(
      open
        .slice(0, 10)
        .map((a) => row(a, `<span class="aw-t go">${a.state === 2 ? '进行中' : '尚未领取'}</span>`))
        .join(''),
    )
  }
  const foot = unseen.length
    ? `<div class="q-foot">另有 <b>${unseen.length}</b> 条不在最近同步的任务列表中</div>`
    : ''
  return `<div class="sec"><div class="sec-h">可从任务获得<span class="aux">按奖励内容整理 · 共 ${awards.length} 条</span></div>
    ${blocks.join('') || '<div style="font-size:11.5px;color:var(--dim)">当前任务列表暂无该道具奖励任务</div>'}
    ${open.length > 10 ? `<div class="q-foot">另有 ${open.length - 10} 条进行中或尚未领取任务</div>` : ''}
    ${foot}
  </div>`
}

const NATIVE_UPGRADE_NEEDS = [
  { kind: 'useitem', id: 58, name: '改装设计图', field: 'drawingCount' },
  { kind: 'useitem', id: 65, name: '试制甲板用弹射器', field: 'catapultCount' },
  { kind: 'useitem', id: 78, name: '战斗详报', field: 'reportCount' },
  { kind: 'useitem', id: 77, name: '新型航空兵装资材', field: 'aviationMatCount' },
  // 实测榛名改二乙、丹陽、時雨改三、三隈改二特等均与 94 逐条吻合。
  { kind: 'useitem', id: 94, name: '新型兵装资材', field: 'armsMatCount' },
  // 吹雪改三护（六式）api_tech_count=5 与 wikiwiki 的海外舰最新技术×5 对齐。
  { kind: 'useitem', id: 100, name: '海外舰最新技术', field: 'techCount' },
  // api_boiler_count 对应装备 87；不能按 useitem 87 渲染，否则会链接到“海苔”。
  { kind: 'slotitem', id: 87, name: '新型高温高压锅炉', field: 'boilerCount' },
  // 75 新型砲熕兵装資材不在本表：大和改二等需要它，但原生字段均为 0；
  // 必须保留 wikiwiki/kcwiki 项，不能放进 nativeCoveredIds 后误吞。
  // 104 工厂资源同样只在 wikiwiki 改造表中出现，不进入 nativeCoveredIds。
] as const

interface UpgradeNeedChip {
  kind: 'useitem' | 'slotitem' | 'unknown'
  id?: number
  name: string
  count: number
}

const upgradeNeedChipHtml = ({ kind, id, name, count }: UpgradeNeedChip): string => {
  if (kind === 'unknown' || id == null) {
    return `<span class="nd">${entityTermHtml('useitem', undefined, name)}×${count}</span>`
  }
  if (kind === 'slotitem') {
    const have = Object.values(mg.slotitems).filter((item) => item.mstId === id).length
    const rawName = mg.master.slotitems[id]?.name ?? name
    const display = entityNamePlain('equip', id, rawName)
    return `<span class="nd ${have >= count ? 'ok' : 'no'}" title="持有 ${have} / 需要 ${count} · 装备">
      ${elink('mstEquip', id, `${display}×${count}`)}<i>${have}</i></span>`
  }
  const have = useitemCount(id)
  // 对齐上的做成道具实体链接：点进去就是它的需求队列/用途一览/可从哪些任务获得。
  return `<span class="nd ${have >= count ? 'ok' : 'no'}" title="持有 ${have} / 需要 ${count}">${elink(
    'useitem',
    id,
    `${name}×${count}`,
  )}<i>${have}</i></span>`
}

const needIdentity = (need: Pick<UpgradeNeedChip, 'kind' | 'id' | 'name'>) =>
  `${need.kind}:${need.id ?? need.name}`

// 游戏原生字段优先；wikiwiki 补 API 表外素材；kcwiki 字符串只给旧包/缺页作最终兜底。
// 原生字段即使为 0 也有权威性，对应 Wiki 项不能再重复或反向覆盖。
// 同目标多行时按来路选行：不指明来路则取前进路径（非回转）那一行。
const needChipsHtml = (
  raw: string | null | undefined,
  targetShipId: number,
  currentShipId?: number,
): { html: string; needs: UpgradeNeedChip[] } => {
  const upgradeRows = mg.master.upgrades[targetShipId] ?? []
  // 指明了来路却没有对应行 → 原生层对这条路径没有话语权，交给 wiki/kcwiki 兜底，
  // 绝不错拿别的来路（回转行全零，会把真需求吞掉；前进行有料，会凭空造需求）
  const upgrade =
    currentShipId != null
      ? upgradeRows.find((row) => row.currentShipId === currentShipId) ?? null
      : upgradeRows.find((row) => !isFormSwitch(row.currentShipId, targetShipId)) ??
        upgradeRows[0] ??
        null
  const covered = new Set<string>()
  const needs = new Map<string, UpgradeNeedChip>()
  if (upgrade) {
    for (const spec of NATIVE_UPGRADE_NEEDS) {
      if (!Object.prototype.hasOwnProperty.call(upgrade, spec.field)) continue
      const identity = `${spec.kind}:${spec.id}`
      covered.add(identity)
      const count = Number(upgrade[spec.field]) || 0
      if (count > 0) {
        needs.set(identity, {
          kind: spec.kind,
          id: spec.id,
          name: spec.name,
          count,
        })
      }
    }
  }
  // wikiwiki 明细按边取：主条目/edges 各自声明来路（fromShipId）。指明了来路
  // 却对不上任何明细时宁可空着交给 kcwiki 逐边兜底，也不错拿别的边——
  // 榛名丙→乙曾因拿了首次解锁（改二→乙）的明细被挂上 開発資材×390。
  const wikiwikiEntry = wikiwikiRemodelLode?.data?.[`${targetShipId}`]
  const wikiwiki = (() => {
    if (!wikiwikiEntry) return null
    if (currentShipId == null) return wikiwikiEntry
    if (Number(wikiwikiEntry.fromShipId) === currentShipId) return wikiwikiEntry
    const edges = Array.isArray(wikiwikiEntry.edges) ? wikiwikiEntry.edges : []
    const edge = edges.find((entry: any) => Number(entry?.fromShipId) === currentShipId)
    if (edge) return edge
    return Number(wikiwikiEntry.fromShipId) > 0 ? null : wikiwikiEntry
  })()
  for (const rawNeed of Array.isArray(wikiwiki?.needs) ? wikiwiki.needs : []) {
    const kind =
      rawNeed?.kind === 'slotitem'
        ? 'slotitem'
        : rawNeed?.kind === 'useitem'
          ? 'useitem'
          : 'unknown'
    const id = Number.isInteger(rawNeed?.id) ? Number(rawNeed.id) : undefined
    const rawName = `${rawNeed?.nameJp ?? ''}`.trim()
    const name =
      kind === 'slotitem' && id
        ? entityNamePlain('equip', id, mg.master.slotitems[id]?.name ?? rawName)
        : kind === 'useitem' && id
          ? entityNamePlain('item', id, useitemMst.get(id)?.api_name ?? rawName)
          : rawName
    const count = Number(rawNeed?.count) || 0
    if (!name || count <= 0) continue
    const need: UpgradeNeedChip = { kind, ...(id ? { id } : {}), name, count }
    const key = needIdentity(need)
    if (covered.has(key)) continue
    covered.add(key)
    needs.set(key, need)
  }
  for (const match of String(raw ?? '').matchAll(/([^\sx×]+)\s*[x×]\s*(\d+)/g)) {
    const name = match[1]
    const count = parseInt(match[2], 10) || 1
    const alias = kcwikiUpgradeNeedAlias(name)
    const need: UpgradeNeedChip = {
      kind: alias?.kind ?? 'unknown',
      ...(alias ? { id: alias.id } : {}),
      name,
      count,
    }
    const key = needIdentity(need)
    if (covered.has(key)) continue
    covered.add(key)
    const previous = needs.get(key)
    if (!previous || count > previous.count) needs.set(key, need)
  }
  const list = [...needs.values()]
  return { html: list.map(upgradeNeedChipHtml).join(''), needs: list }
}

/** 一条素材需求「够不够」。拿不到库存口径时按不够处理，不假装满足。 */
const needStockOf = (need: UpgradeNeedChip): { have: number; enough: boolean } => {
  if (need.id == null || need.kind === 'unknown') return { have: 0, enough: false }
  const have =
    need.kind === 'slotitem'
      ? Object.values(mg.slotitems).filter((item) => item.mstId === need.id).length
      : useitemCount(need.id)
  return { have, enough: have >= need.count }
}

interface RemodelNeed {
  mstId: number // 要改造的那一艘（改造前形态）
  targetId: number // 改造后形态 id——判「前进」还是「可逆切换」要用
  afterName: string // 改造后名字
  lv: number // 所需等级
  count: number // 该道具需要几个
  rawName: string // 来源原始写法（未对齐时照实显示）
}

// 可逆改装判定：从改造后的形态沿改造边（aftershipid + 原生升级表）还能走回
// 当前形态，说明两者在同一个转换循环里——那这条「下一步改造」是**形态切换**
// （赤城改二⇄戊、宗谷三形态这类），不是前进方向的待办。用户实弹撞到：
// 五艘停在改二戊/甲的舰把回转素材顶成「道具缺 1」，缺口全是虚的。
let remodelForwardEdges: Map<number, number[]> | null = null
const forwardEdgesOf = (): Map<number, number[]> => {
  if (remodelForwardEdges) return remodelForwardEdges
  remodelForwardEdges = new Map()
  const addEdge = (from: number, to: number) => {
    if (!(from > 0 && to > 0) || from === to) return
    const list = remodelForwardEdges!.get(from) ?? []
    if (!list.includes(to)) list.push(to)
    remodelForwardEdges!.set(from, list)
  }
  for (const ship of friendlyShips.values()) {
    addEdge(ship.api_id, Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10) || 0)
  }
  for (const [targetText, upgradeRows] of Object.entries(mg.master.upgrades)) {
    for (const upgrade of upgradeRows) {
      addEdge(Number(upgrade.currentShipId) || 0, Number(targetText))
    }
  }
  return remodelForwardEdges
}
const isFormSwitch = (currentId: number, targetId: number): boolean => {
  const edges = forwardEdgesOf()
  const seen = new Set<number>()
  const queue = [targetId]
  while (queue.length) {
    const cur = queue.pop()!
    if (cur === currentId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of edges.get(cur) ?? []) queue.push(next)
  }
  return false
}

// useitem id → 哪些改造要用它；rawName 未对齐时归到 -1 桶
let remodelNeeds = new Map<number, RemodelNeed[]>()
// slotitem id → 哪些改造会消耗它（例如大和改二需要装备 87 新型高温高压锅炉）
let remodelEquipNeeds = new Map<number, RemodelNeed[]>()

const buildRemodelNeeds = () => {
  remodelNeeds = new Map()
  remodelEquipNeeds = new Map()
  remodelForwardEdges = null // 需求表重建时主数据/升级表可能刚到齐，边缓存一并重来
  const covered = new Set<string>()
  const add = (
    kind: 'useitem' | 'slotitem',
    itemId: number,
    targetId: number,
    predecessorId: number,
    count: number,
    rawName: string,
    level?: number,
  ) => {
    if (itemId <= 0 || targetId <= 0 || predecessorId <= 0 || count <= 0) return
    // 去重键必须含前置：同一目标的不同来路是不同的改装路径，素材各归各
    const key = `${kind}:${targetId}:${predecessorId}:${itemId}`
    if (covered.has(key)) return
    covered.add(key)
    const targetMap = kind === 'slotitem' ? remodelEquipNeeds : remodelNeeds
    const afterRawName = friendlyShips.get(targetId)?.api_name ?? ''
    const list = targetMap.get(itemId) ?? []
    list.push({
      mstId: predecessorId,
      targetId,
      afterName: entityNamePlain('ship', targetId, afterRawName),
      lv: level ?? friendlyShips.get(predecessorId)?.api_afterlv ?? 0,
      count,
      rawName,
    })
    targetMap.set(itemId, list)
  }
  // 1) 游戏原生数量字段——逐行读：每条来路的素材各归各（赤城改二←改要弹射器，
  //    ←戊全零；从前按目标收单行，弹射器被挂到了戊的回转上）。
  for (const [targetText, upgradeRows] of Object.entries(mg.master.upgrades)) {
    const targetId = Number(targetText)
    for (const upgrade of upgradeRows) {
      for (const spec of NATIVE_UPGRADE_NEEDS) {
        const count = Number(upgrade[spec.field]) || 0
        if (count > 0) {
          add(spec.kind, spec.id, targetId, upgrade.currentShipId, count, spec.name)
        }
        // 原生行在场，这些字段 0 也是权威（用户拿游戏改装画面实锤：榛名乙→丙
        // 原生全零，wiki 图表却把「抵达丙的累计素材」写在丙页上，照抄就凭空造
        // 需求）。真在回环边上逐次消耗的原生自己会给正数——鈴谷/熊野航改二、
        // 三隈改二特是全表仅有的三例，不会被这道闸误伤。
        if (upgrade.currentShipId > 0) {
          covered.add(`${spec.kind}:${targetId}:${upgrade.currentShipId}:${spec.id}`)
        }
      }
    }
  }
  // 2) wikiwiki 改造チャート补 API 表外素材。主条目/edges 各自声明来路
  //    （fromShipId），素材挂声明的那条边；没声明来路的旧格式条目才退回
  //    「前进路径」启发（チャート写的是常规改装，不是可逆回转）。
  for (const [targetText, entry] of Object.entries<any>(wikiwikiRemodelLode?.data ?? {})) {
    const targetId = Number(targetText)
    const targetRows = mg.master.upgrades[targetId] ?? []
    const heuristicPredecessorId =
      (targetRows.find((row) => !isFormSwitch(row.currentShipId, targetId)) ?? targetRows[0])
        ?.currentShipId ??
      [...friendlyShips.values()].find(
        (ship) => Number.parseInt(`${ship.api_aftershipid ?? ''}`, 10) === targetId,
      )?.api_id ??
      0
    const details = [entry, ...(Array.isArray(entry?.edges) ? entry.edges : [])]
    for (const detail of details) {
      const predecessorId =
        Number(detail?.fromShipId) || (detail === entry ? heuristicPredecessorId : 0)
      for (const need of Array.isArray(detail?.needs) ? detail.needs : []) {
        if (
          !['useitem', 'slotitem'].includes(`${need?.kind}`) ||
          !Number.isInteger(need?.id)
        ) {
          continue
        }
        add(
          need.kind,
          Number(need.id),
          targetId,
          predecessorId,
          Number(need.count) || 0,
          `${need.nameJp ?? ''}`,
          Number(detail?.level ?? entry?.level) || undefined,
        )
      }
    }
  }
  // 3) kcwiki 图纸串只补仍未覆盖的旧条目。形态切换边整个跳过：kcwiki 没写
  //    回程（用户 2026-08-11 校准），循环形态上挂的图纸串来路不明，回程
  //    明细只认 wikiwiki 的总表回程行与舰页脚注。
  for (const entry of kcwikiByMst.values()) {
    const bp = entry?.改造?.图纸
    if (!bp || !entry.ID) continue
    const after = friendlyShips.get(entry.ID)?.api_aftershipid
    const afterId = after ? parseInt(after, 10) : 0
    if (afterId > 0 && isFormSwitch(entry.ID, afterId)) continue
    for (const m of String(bp).matchAll(/([^\sx×]+)\s*[x×]\s*(\d+)/g)) {
      const rawName = m[1]
      const count = parseInt(m[2], 10) || 1
      const alias = kcwikiUpgradeNeedAlias(rawName)
      if (!alias) continue
      add(
        alias.kind,
        alias.id,
        afterId,
        entry.ID,
        count,
        rawName,
        entry.改造?.等级 ?? friendlyShips.get(entry.ID)?.api_afterlv ?? 0,
      )
    }
  }
  // 隔离派发：订阅者是别的模块的整块 render（锱），它抛异常不该把 buildRemodelNeeds
  // 后半截连同调用方一起带走——那条链正好在 mount 的 async IIFE 里，断了连痕迹都没有
  safeEach('ji:useitem-demand-ready', demandReadyCbs, (cb) => cb())
}

const remodelNeedCredit = () => {
  const chain = [
    '游戏 API',
    wikiwikiRemodelLode ? lodeCredit(wikiwikiRemodelLode.meta) : '改造资料待补',
    kcwikiLode ? `补充来源 ${lodeCredit(kcwikiLode.meta)}` : '',
  ]
    .filter(Boolean)
    .join(' → ')
  return `<span class="credit-mark" title="${esc(chain)}">源</span>`
}

const remodelUsageRowsHtml = (needs: RemodelNeed[]) =>
  [...needs]
    .sort((left, right) => left.lv - right.lv || left.mstId - right.mstId)
    .slice(0, 30)
    .map(
      (need) => `<div class="u-row">
        <span class="u-nm">${elink('mstShip', need.mstId, masterShipName(need.mstId))}</span>
        <span class="u-to">→ ${esc(need.afterName || '改装')}</span>
        <span class="u-lv">Lv${need.lv}</span>
        <span class="u-n">×${need.count}</span>
      </div>`,
    )
    .join('')

const equipRemodelUsageHtml = (equipId: number) => {
  const needs = remodelEquipNeeds.get(equipId)
  if (!needs?.length) return ''
  return `<div class="sec"><div class="sec-h">作为改造素材
      <span class="aux">共 ${needs.length} 项改造会消耗这件装备</span></div>
    ${remodelUsageRowsHtml(needs)}
    <div class="q-foot">仅计改造消耗 · 不含搭载或改修素材
      ${remodelNeedCredit()}</div>
  </div>`
}

// 对外口径（锱的战略道具卡复用）：不复制一份 kcwiki 解析，只暴露聚合结果。
// 判定与 itemQueueHtml 同源——两处显示的「缺口」必然一致。
export interface UseitemDemand {
  stock: number
  queueNeed: number // 当前舰娘**前进方向**下一步改造合计要用几个（可逆切换不算）
  queueShips: number // 涉及几艘当前舰娘
  ready: number // 等级已够且道具够
  lvBlocked: number // 等级还没到
  switchShips: number // 可逆改装（改二⇄戊这类）会用到它的当前舰娘数
  switchNeed: number // 上述切换的合计用量——按需消费，不计入缺口
  usages: number // 全部需要它的改造项数（不限当前持有）
}

export const useitemDemand = (itemId: number): UseitemDemand | null => {
  const needs = remodelNeeds.get(itemId)
  if (!needs?.length) return null
  const stock = useitemCount(itemId)
  const out: UseitemDemand = {
    stock,
    queueNeed: 0,
    queueShips: 0,
    ready: 0,
    lvBlocked: 0,
    switchShips: 0,
    switchNeed: 0,
    usages: needs.length,
  }
  for (const need of needs) {
    const owned = topLevelInstanceOf(need.mstId)
    if (!owned) continue
    if (isFormSwitch(need.mstId, need.targetId)) {
      out.switchShips++
      out.switchNeed += need.count
      continue
    }
    out.queueShips++
    out.queueNeed += need.count
    if (owned.lv < need.lv) out.lvBlocked++
    else if (stock >= need.count) out.ready++
  }
  return out
}

// 有改造需求的道具 id（排除住在 materials 里的那几个——锱已有独立磁贴）。
// 给锱用来自动补全「战略道具」清单：靠 id 而不是手打日文名，游戏加新道具时不用改代码。
export const demandedUseitemIds = (): number[] =>
  [...remodelNeeds.keys()].filter((id) => MATERIAL_USEITEM[id] === undefined)

// 需求表建好后通知（矿脉是异步加载的，别处得等它）
const demandReadyCbs: (() => void)[] = []
export const onUseitemDemandReady = (cb: () => void) => {
  demandReadyCbs.push(cb)
  // 补发这一次同样要隔离：这里是在订阅方的装配链上跑的，裸调等于把它的
  // 异常直接掀到 mountModule 上
  if (remodelNeeds.size) safeEach('ji:useitem-demand-ready', [cb], (fn) => fn())
}

// 需求队列：在籍舰里，下一步改造要用这件道具的。
// 可逆改装的形态切换（改二⇄戊这类回转）单独一组、不计入缺口——那是「想换
// 形态时会用到」，不是待办；把它标红成「道具缺」会让缺口全是虚数。
const itemQueueHtml = (itemId: number) => {
  const needs = remodelNeeds.get(itemId)
  if (!needs?.length) return ''
  const stock = useitemCount(itemId)
  const rows: { html: string; rank: number; short: number }[] = []
  let progressShips = 0
  let progressNeed = 0
  let switchShips = 0
  let switchNeed = 0
  for (const need of needs) {
    // 在籍的该形态实例（取等级最高的一艘代表）
    const owned = topLevelInstanceOf(need.mstId)
    if (!owned) continue
    const lvGap = need.lv - owned.lv
    const enough = stock >= need.count
    const formSwitch = isFormSwitch(need.mstId, need.targetId)
    let mark: string
    let rank: number
    if (formSwitch) {
      mark = `<span class="q-dim" title="${esc(masterShipName(need.mstId))} ⇄ ${esc(
        need.afterName,
      )} 的切换用量，不计入缺口">⇄ 形态切换</span>`
      rank = 3
      switchShips++
      switchNeed += need.count
    } else if (lvGap > 0) {
      mark = `<span class="q-warn">还差 ${lvGap} 级</span>`
      rank = 2
      progressShips++
      progressNeed += need.count
    } else if (!enough) {
      mark = `<span class="q-bad">道具缺 ${need.count - stock}</span>`
      rank = 1
      progressShips++
      progressNeed += need.count
    } else {
      mark = '<span class="q-ok">✓ 就绪</span>'
      rank = 0
      progressShips++
      progressNeed += need.count
    }
    rows.push({
      rank,
      short: lvGap,
      html: `<div class="q-row${formSwitch ? ' switch' : ''}">
        <span class="q-nm">${elink('mstShip', need.mstId, masterShipName(need.mstId))}</span>
        <span class="q-lv">Lv ${owned.lv}</span>
        <span class="q-to">→ ${esc(need.afterName || '下一改装')} · Lv${need.lv}</span>
        <span class="q-n">需 ×${need.count}</span>
        ${mark}
      </div>`,
    })
  }
  if (!rows.length) {
    return `<div class="sec"><div class="sec-h">需求队列<span class="aux">当前舰娘的改造需求</span></div>
      <div style="font-size:11.5px;color:var(--dim)">当前舰娘暂无下一步改造需用该道具</div></div>`
  }
  rows.sort((a, b) => a.rank - b.rank || a.short - b.short)
  const aux = progressShips
    ? `${progressShips} 艘当前舰娘的下一步改造需要它`
    : '当前舰娘的改造需求'
  const switchFoot = switchShips
    ? ` · 另有 ${switchShips} 艘的可逆形态切换会用到（共 ${switchNeed}，不计入缺口）`
    : ''
  return `<div class="sec"><div class="sec-h">需求队列<span class="aux">${aux}</span></div>
    ${rows.map((r) => r.html).join('')}
    <div class="q-foot">持有 <b>${stock}</b> · 前进改造共需 <b>${progressNeed}</b>${switchFoot}
      ${remodelNeedCredit()}</div>
  </div>`
}

// 用途一览：所有需要它的改造（不限在籍）
const itemUsageHtml = (itemId: number) => {
  const needs = remodelNeeds.get(itemId)
  if (!needs?.length) return ''
  const ownedIds = new Set(Object.values(mg.ships).map((s) => s.shipId))
  const sorted = [...needs].sort(
    (a, b) => (ownedIds.has(b.mstId) ? 1 : 0) - (ownedIds.has(a.mstId) ? 1 : 0) || a.lv - b.lv,
  )
  const shown = sorted.slice(0, 30)
  const rows = shown
    .map(
      (n) => `<div class="u-row${ownedIds.has(n.mstId) ? ' own' : ''}">
        <span class="u-nm">${elink('mstShip', n.mstId, masterShipName(n.mstId))}</span>
        <span class="u-to">→ ${esc(n.afterName || '改装')}${
          isFormSwitch(n.mstId, n.targetId)
            ? ' <i class="u-switch" title="可逆改装：两个形态可互相转换">⇄</i>'
            : ''
        }</span>
        <span class="u-lv">Lv${n.lv}</span>
        <span class="u-n">×${n.count}</span>
      </div>`,
    )
    .join('')
  return `<div class="sec"><div class="sec-h">用途一览<span class="aux">共 ${needs.length} 项改造需要它${
    needs.length > shown.length ? `（显示前 ${shown.length}）` : ''
  }</span></div>
    ${rows}
    <div class="q-foot">高亮表示当前持有 · ⇄ 为可逆改装的形态切换 ${remodelNeedCredit()}</div>
  </div>`
}

// ---- 可兑换列表（2026-08-18 用户提议）----
// 固定兑换（勲章三项，shared/item-exchange.ts 手录）+ wiki 表格化目录
// （矿脉包：秋刀魚年次表 / 菱餅固定表）。兑换所得的文字里凡精确命中主数据
// 装备/道具名的片段做成实体链接——最长匹配扫描，名字互为子串不误联。
let exchangeNameIndex: Map<string, { kind: 'mstEquip' | 'useitem' | 'mstShip'; id: number }> | null = null
let exchangeNameMaxLen = 0
// ＆：wiki 写全角、主数据是半角（寒冷地装備&甲板要員，2026-08-18 用户看日语时带出的漏联）
// 全部替换必须 1:1 等长——匹配用归一文本定位、展示切原文，长度一变索引就错位
const exchangeNormalize = (text: string) =>
  text.replace(/／/g, '/').replace(/＋/g, '+').replace(/＆/g, '&').replace(/（/g, '(').replace(/）/g, ')')

// wiki 原文里的格式短语机械可译，本地化后原文留悬停（2026-08-18 用户问「那些
// 日语是什么」）。只译逐字确定的：档位菜名、「最大N回」調理可能、または…との選択；
// 译不动的原样留日文，不猜。
const EXCHANGE_OFFER_ZH: [RegExp, string][] = [
  [/秋刀魚/g, '秋刀鱼'],
  [/カレー/g, '咖喱'],
  [/塩焼/g, '盐烤'],
  [/蒲焼/g, '蒲烧'],
  [/つみれ/g, '鱼丸'],
  [/資源/g, '资源'],
  [/資材/g, '资材'],
]
const exchangeOfferZh = (offer: string): string => {
  let out = offer
  for (const [pattern, replacement] of EXCHANGE_OFFER_ZH) out = out.replace(pattern, replacement)
  return out
}
const exchangeNoteZh = (note: string): string =>
  note
    .replace(/「最大(\d+)回」調理可能/g, '每届最多兑 $1 次')
    .replace(/「最大[xｘ]回」調理可能[？?]?/g, '每届限兑次数 wiki 未确证')
const exchangeGetsZh = (gets: string): string =>
  gets.replace(/または\s*(.+?)\s*との選択/g, '或改选 $1')
// 活动史詳細（節分の豆/南瓜等）的机械短语——同样只译逐字确定的，其余原文
const EXCHANGE_DETAIL_ZH: [RegExp, string][] = [
  [/最大獲得数(\d+)個/g, '当届最多可得 $1 个'],
  [/1回のみ/g, '限1次'],
  [/どれか1つ、?/g, '任选1项 '],
  [/から一つ選択/g, '中任选其一'],
  [/受領時：/g, '领取时：'],
]
const exchangeDetailZh = (detail: string): string => {
  let out = detail
  for (const [pattern, replacement] of EXCHANGE_DETAIL_ZH) out = out.replace(pattern, replacement)
  return out
}
// 索引随主数据规模重建：首开道具页时装备表可能还没就绪，一次性缓存会让
// 装备名永远联不上——道具联上了装备全白字（2026-08-18 用户实锤的症状）
let exchangeNameIndexSizes = ''
const ensureExchangeNameIndex = () => {
  const sizes = `${friendlyEquips.size}:${useitemMst.size}:${friendlyShips.size}`
  if (exchangeNameIndex && exchangeNameIndexSizes === sizes) return exchangeNameIndex
  exchangeNameIndexSizes = sizes
  exchangeNameIndex = new Map()
  for (const equip of friendlyEquips.values()) {
    const name = exchangeNormalize(`${equip.api_name ?? ''}`.trim())
    if (name.length >= 2) exchangeNameIndex.set(name, { kind: 'mstEquip', id: Number(equip.api_id) })
  }
  for (const item of useitemMst.values()) {
    const rawName = `${item.api_name ?? ''}`.trim()
    // 「給糧艦「伊良湖」」这类带前缀的道具名，wiki 只写内名——内名一并入索引
    const inner = rawName.match(/「(.+)」$/)?.[1] ?? ''
    for (const candidate of [rawName, inner]) {
      const name = exchangeNormalize(candidate)
      if (name.length >= 2 && !exchangeNameIndex.has(name)) {
        exchangeNameIndex.set(name, { kind: 'useitem', id: Number(item.api_id) })
      }
    }
  }
  // 舰娘名垫底补缺：用途明细的「改造」行全是舰名（吹雪改三 → 吹雪改三護(六式) 这类）。
  // 間宮/伊良湖这种舰名与道具名同字的，维持道具优先——兑换语境里说的是补给品
  for (const ship of friendlyShips.values()) {
    const name = exchangeNormalize(`${ship.api_name ?? ''}`.trim())
    if (name.length >= 2 && !exchangeNameIndex.has(name)) {
      exchangeNameIndex.set(name, { kind: 'mstShip', id: Number(ship.api_id) })
    }
  }
  exchangeNameMaxLen = Math.max(0, ...[...exchangeNameIndex.keys()].map((name) => name.length))
  return exchangeNameIndex
}
const exchangeGetsHtml = (raw: string): string => {
  const index = ensureExchangeNameIndex()
  const text = `${raw ?? ''}`
  const normalized = exchangeNormalize(text)
  let out = ''
  let plainFrom = 0
  for (let i = 0; i < text.length; ) {
    let matched = 0
    for (let len = Math.min(exchangeNameMaxLen, text.length - i); len >= 2; len--) {
      const hit = index.get(normalized.slice(i, i + len))
      if (!hit) continue
      out += esc(text.slice(plainFrom, i))
      out += elink(hit.kind, hit.id, text.slice(i, i + len))
      matched = len
      plainFrom = i + len
      break
    }
    i += matched || 1
  }
  return out + esc(text.slice(plainFrom))
}

// 具体作用（2026-08-18 用户点名「很多只有说明的道具」）：游戏自带说明偏
// 风味文案，wiki 总表詳細一句话讲清机制（高速修復材=缩短入渠、間宮=回疲劳），
// 各道具小节的「用途」块再给改修/任务消耗明细。原文收录 + 名字联实体，不译散文。
const itemFunctionHtml = (itemId: number): string => {
  const entry = itemExchangeLode?.data?.[`${itemId}`]
  if (!entry?.overview && !entry?.usage?.length) return ''
  const overview = entry.overview
    ? `<div class="ifx-overview">${exchangeGetsHtml(entry.overview)}</div>`
    : ''
  const usage = entry.usage?.length
    ? `<div class="ifx-usage">${entry.usage
        .map((line: string) => `<div class="ifx-line">${exchangeGetsHtml(line)}</div>`)
        .join('')}</div>`
    : ''
  const credit = itemExchangeLode
    ? lodeCreditMark(itemExchangeLode.meta, '总表摘要 ·「用途」小节明细 · 装备/道具/舰娘名称可打开详情')
    : ''
  return `<div class="sec"><div class="sec-h">具体作用<span class="aux">${
    entry.usage?.length ? `含用途明细 ${entry.usage.length} 行 ` : ''
  }${credit}</span></div>${overview}${usage}</div>`
}

const itemExchangeHtml = (itemId: number): string => {
  const hand = FIXED_ITEM_EXCHANGES.get(itemId)
  const lodeEntry = itemExchangeLode?.data?.[`${itemId}`]
  if (!hand && !lodeEntry) return ''
  const selfName = entityNamePlain('item', itemId, useitemMst.get(itemId)?.api_name ?? '')
  const blocks: string[] = []
  if (hand) {
    const rows = hand
      .map(
        (entry) => `<div class="iex-row"><span class="iex-cost">${esc(selfName)}×${entry.cost}</span>
          <span class="iex-to">→</span><span class="iex-gets">${exchangeGetsHtml(entry.gets)}</span></div>`,
      )
      .join('')
    blocks.push(`<div class="iex-block"><div class="iex-bh">固定兑换<span class="aux">游戏内道具使用界面的常设选项</span></div>${rows}</div>`)
  }
  if (lodeEntry?.fixed?.length) {
    const rows = lodeEntry.fixed
      .map((entry: any) => {
        const offerZh = exchangeOfferZh(entry.offer)
        return `<div class="iex-row"><span class="iex-offer"${
          offerZh !== entry.offer ? ` title="${esc(entry.offer)}"` : ''
        }>${esc(offerZh)}</span>
          <span class="iex-to">→</span><span class="iex-gets">${exchangeGetsHtml(exchangeGetsZh(entry.gets))}</span></div>`
      })
      .join('')
    blocks.push(`<div class="iex-block"><div class="iex-bh">兑换选项<span class="aux">当届需求数量及截止日期：游戏内公告</span></div>${rows}</div>`)
  }
  if (lodeEntry?.yearly?.length) {
    // 年份倒序分组；同年内保持 wiki 行序
    const byYear = new Map<string, any[]>()
    for (const row of lodeEntry.yearly) {
      const list = byYear.get(row.year) ?? []
      list.push(row)
      byYear.set(row.year, list)
    }
    const years = [...byYear.keys()].sort((left, right) => right.localeCompare(left, 'ja'))
    const groups = years
      .map((year) => {
        const rows = byYear
          .get(year)!
          .map((row: any) => {
            const offerZh = exchangeOfferZh(row.offer)
            const noteZh = row.note ? exchangeNoteZh(row.note) : ''
            return `<div class="iex-row"><span class="iex-offer"${
              offerZh !== row.offer ? ` title="${esc(row.offer)}"` : ''
            }>${esc(offerZh)}</span>
              <span class="iex-cost">${esc(row.cost)}</span>
              <span class="iex-to">→</span><span class="iex-gets">${exchangeGetsHtml(exchangeGetsZh(row.gets))}</span>${
                noteZh
                  ? `<span class="iex-note"${noteZh !== row.note ? ` title="${esc(row.note)}"` : ''}>${esc(noteZh)}</span>`
                  : ''
              }</div>`
          })
          .join('')
        return `<div class="iex-year"><b>${esc(year)}</b>${rows}</div>`
      })
      .join('')
    blocks.push(`<div class="iex-block"><div class="iex-bh">历年兑换<span class="aux">按年倒序</span></div>${groups}</div>`)
  }
  if (lodeEntry?.history?.length) {
    // 活动史（節分の豆/南瓜/てるてる坊主/Xmas 盒）：詳細格式五花八门（有→的、
    // 名字即奖品没→的、↓接任选清单、散文选择），硬拆结构行必然出错——
    // 按年份+原文速览收录，装备/道具名照样联实体，机械短语照样轻译
    const rows = [...lodeEntry.history]
      .sort((left: any, right: any) => `${right.year}`.localeCompare(`${left.year}`, 'ja'))
      .map((row: any) => {
        const zh = exchangeDetailZh(row.detail)
        return `<div class="iex-year"><b>${esc(row.year)}</b><div class="iex-detail"${
          zh !== row.detail ? ` title="${esc(row.detail)}"` : ''
        }>${exchangeGetsHtml(zh)}</div></div>`
      })
      .join('')
    blocks.push(`<div class="iex-block"><div class="iex-bh">历年活动兑换<span class="aux">按 wiki 原记逐年收录</span></div>${rows}</div>`)
  }
  const credit = itemExchangeLode && lodeEntry
    ? lodeCreditMark(itemExchangeLode.meta, '活动历史类（节分豆/南瓜等）速览')
    : ''
  return `<div class="sec"><div class="sec-h">可兑换列表<span class="aux">共 ${
    (hand?.length ?? 0) +
    (lodeEntry?.fixed?.length ?? 0) +
    (lodeEntry?.yearly?.length ?? 0) +
    (lodeEntry?.history?.length ?? 0)
  } 条 ${credit}</span></div>${blocks.join('')}</div>`
}

const itemDrawerHtml = () => {
  const u = useitemMst.get(itemState.selected)
  if (!u) return ''
  const stock = useitemStock(u.api_id)
  const count = stock.count
  const awardTerms = [u.api_name, itemAliasCn.get(u.api_id) ?? '']
  const awarded = new Set(questsAwarding(awardTerms, overshadowOf(u.api_id)).map((a) => a.id))
  const desc = Array.isArray(u.api_description)
    ? u.api_description.filter(Boolean).join('\n').replace(/<br\s*\/?>/gi, '\n')
    : ''
  return `
  <div class="d-head">
    <span class="x" id="ji-item-close" title="关闭（Esc）">✕</span>
    <span class="crumb">道具 › <b>${entityNameHtml('item', u.api_id, u.api_name, { compact: true })}</b></span><span class="sp"></span>
  </div>
  <div class="detail">
    <div class="hero" style="background:radial-gradient(420px 200px at 85% 0%,rgba(224,169,74,.08),transparent 65%),var(--bg1)">
      <div class="hero-l">
        <div class="meta-line"><span class="badge" style="color:#e8ce9a;border-color:#8a6d2f">道具</span><span class="no">ID ${u.api_id}</span></div>
        <div class="name-block"><h1 style="font-size:24px">${entityNameHtml('item', u.api_id, u.api_name)}</h1></div>
        <div class="own-line">
          ${
            stock.known
              ? `<span class="own-pill"${count ? '' : ' style="opacity:.6"'}><span class="dot"></span>持有 <b>×${count}</b><small> · ${USEITEM_STOCK_SOURCE[stock.source]}</small></span>`
              : '<span class="own-pill" style="opacity:.6">尚未同步持有数量</span>'
          }
        </div>
      </div>
      <div class="item-art">${useItemIconHtml(u.api_id, entityNamePlain('item', u.api_id, u.api_name), { className: 'hero' })}</div>
    </div>
    ${desc ? `<div class="sec"><div class="sec-h">说明</div><div style="font-size:12px;color:#c3d1dc;white-space:pre-wrap;line-height:1.7">${esc(desc)}</div></div>` : ''}
    ${itemFunctionHtml(u.api_id)}
    ${itemExchangeHtml(u.api_id)}
    ${itemQueueHtml(u.api_id)}
    ${itemAwardHtml(u.api_id, u.api_name)}
    ${itemUsageHtml(u.api_id)}
    ${relatedQuestsHtml(awardTerms, 'item', awarded)}
    <div class="foot"><span>${mg.useitemsTs ? `道具同步 ${fmtTime(mg.useitemsTs)}` : mg.lastPortTs ? `港口同步 ${fmtTime(mg.lastPortTs)}` : '尚未同步'}
      <span class="credit-mark" title="名称 · 游戏基础数据 · 库存按资源 / 提督状态 / 装备 / 道具四域合并">源</span></span></div>
  </div>`
}

// 归档仍在后台加载，用于把已经结束的活动海图和日期并入海域卷；
// 个人活动统计只在顶栏「回顾」展示。
const loadEventArchives = () => {
  void jiIpc.invoke('chron:event-archives').then((rows: any) => {
    eventArchives = rows ?? []
    mergeArchivedEventMaps()
    // 窗口期里点过的那张退役活动图：墓碑现在并回来了，替玩家把它开出来，
    // 免得他看完「还在读取」还得自己再点一次。只有回执还挂着才补开——
    // 换卷/按 ✕ 都会清掉它，那就是「这事我不要了」，别把人硬拽回来。
    const pending = pendingMapOpen
    pendingMapOpen = null
    if (pending != null && missNotice?.book === 'map') {
      if (mapInfos.some((m) => m.api_id === pending)) {
        openMap(pending)
        return
      }
      missNotice = { book: 'map', text: '当前海域资料读取失败' }
    }
    render()
  }).catch((error: unknown) => {
    // 活动归档只影响海域卷里几张已结束的图，读不到就维持现状，不清空已有的
    console.warn('[kanso] 活动归档读取失败', error)
    if (pendingMapOpen == null) return
    // 但等着补开的那张图不能一直挂着「还在读取」——读没读成得如实说
    pendingMapOpen = null
    if (missNotice?.book === 'map') {
      missNotice = { book: 'map', text: '当前海域资料读取失败' }
      render()
    }
  })
}
// ---- 图鉴导航历史：返回上一层 / 回到下一层（各最多 5 层）----
// 痛点（2026-08-16 用户）：从列表/别的模块点链接跳进图鉴，原来看的那页就丢了，
// 只能一步步重新点回来。这里把整个图鉴（七卷互联）当一本书记历史：
// 「层」= 在哪一卷 + 抽屉里开的是哪个实体。卷内筛选/搜索/详情子页只算同层微调
// ——5 层的栈经不起每个筛选片各占一层——但快照会把它们连同滚动位置一起存档，
// 返回时原样还原。
interface JiNavLocation {
  book: Book
  ship: typeof shipState
  equip: typeof equipState
  abyss: typeof abyssState
  map: typeof mapState
  item: typeof itemState
  scroll: ScrollProfile
}

const JI_NAV_DEPTH = 5
const jiNav = createNavHistory<JiNavLocation>(JI_NAV_DEPTH)
let jiNavLast: JiNavLocation | null = null
let jiNavLastKey = ''
let jiNavRestoring = false

// 滚动剖面在真要入栈时才抓（那一刻 DOM 还停在旧页），平时快照里留空的
const jiNavSnapshot = (): JiNavLocation => ({
  book: activeBook,
  ship: { ...shipState },
  equip: { ...equipState },
  abyss: { ...abyssState },
  map: { ...mapState },
  item: { ...itemState },
  scroll: new Map(),
})

// 层键：什么变化算「翻到了新的一层」。抽屉开着 = 那个实体的页（链内换形态、
// 换详情子页同层），关着 = 该卷的目录页（装备卷的目录/今日改修/实验室各算一页）。
const jiNavKeyNow = (): string => {
  if (activeBook === 'ship') {
    // NPC 位自成一层：它与舰娘位在同一卷里，层键不分开的话「从明石返回」会退到
    // 上一艘舰娘的详情去（两边共用 open/抽屉壳，只有这个字符串分得出身份）
    if (shipState.chip === NPC_CHIP) {
      return shipState.open && shipState.npcName ? `ship:npc:${shipState.npcName}` : 'ship:npc'
    }
    return shipState.open ? `ship:${shipState.selectedRoot}` : 'ship'
  }
  if (activeBook === 'equip')
    return equipState.open ? `equip:d${equipState.selected}` : `equip:${equipState.mode}`
  if (activeBook === 'abyss')
    return abyssState.open ? `abyss:${abyssState.tab}:${abyssState.selected}` : `abyss:${abyssState.tab}`
  if (activeBook === 'map') return mapState.open ? `map:${mapState.selected}` : 'map'
  if (activeBook === 'item') return itemState.open ? `item:${itemState.selected}` : 'item'
  return activeBook // 列表/仓库的内部状态在各自模块里，这里只记「在哪一卷」
}

// 每次 render 开头对账：层键变了且不是历史还原造成的，就把「离开前那层」入栈。
// 数据驱动的重渲染层键不变，只顺手刷新快照（筛选/搜索/子页保持最新）。
const jiNavTrack = () => {
  const key = jiNavKeyNow()
  if (jiNavLast && key !== jiNavLastKey && !jiNavRestoring) {
    jiNavLast.scroll = captureScrollProfile(pane)
    jiNav.record(jiNavLast)
  }
  jiNavRestoring = false
  jiNavLast = jiNavSnapshot()
  jiNavLastKey = key
}

const jiNavApply = (loc: JiNavLocation) => {
  activeBook = loc.book
  Object.assign(shipState, loc.ship)
  Object.assign(equipState, loc.equip)
  Object.assign(abyssState, loc.abyss)
  Object.assign(mapState, loc.map)
  Object.assign(itemState, loc.item)
  jiNavRestoring = true
  render()
  applyScrollProfile(pane, loc.scroll)
}

const jiNavGoBack = () => {
  const current = jiNavSnapshot()
  current.scroll = captureScrollProfile(pane)
  const target = jiNav.goBack(current)
  if (target) jiNavApply(target)
}

const jiNavGoForward = () => {
  const current = jiNavSnapshot()
  current.scroll = captureScrollProfile(pane)
  const target = jiNav.goForward(current)
  if (target) jiNavApply(target)
}

// 悬停提示里报目标层的名字，让人知道这一步会回到哪
const jiNavLabelOf = (loc: JiNavLocation): string => {
  if (loc.book === 'ship') {
    if (loc.ship.chip === NPC_CHIP) {
      return loc.ship.open && loc.ship.npcName ? `${NPC_CHIP} · ${loc.ship.npcName}` : `${NPC_CHIP} 台词`
    }
    const s = loc.ship.open ? friendlyShips.get(loc.ship.selectedForm) : null
    return s ? `舰娘 · ${entityNamePlain('ship', loc.ship.selectedForm, s.api_name)}` : '舰娘图鉴'
  }
  if (loc.book === 'equip') {
    if (loc.equip.open) {
      const e = friendlyEquips.get(loc.equip.selected)
      if (e) return `装备 · ${entityNamePlain('equip', loc.equip.selected, e.api_name)}`
    }
    if (loc.equip.mode === 'today') return '装备图鉴 · 今日改修'
    if (loc.equip.mode === 'lab') return '装备图鉴 · 组合实验室'
    return '装备图鉴'
  }
  if (loc.book === 'abyss') {
    if (loc.abyss.open) {
      if (loc.abyss.tab === 'equip') {
        const e = abyssalEquips.get(loc.abyss.selected)
        if (e) return `深海装备 · ${entityNamePlain('abyssEquip', loc.abyss.selected, e.api_name)}`
      } else {
        const s = abyssalShips.get(loc.abyss.selected)
        if (s) return `深海舰 · ${entityNamePlain('abyssShip', loc.abyss.selected, s.api_name)}`
      }
    }
    return loc.abyss.tab === 'equip' ? '深海图鉴 · 装备' : '深海图鉴'
  }
  if (loc.book === 'map') {
    if (loc.map.open && mapInfos.some((m) => m.api_id === loc.map.selected)) {
      return `海域 · ${mapCodeOf(loc.map.selected)}`
    }
    return '海域图鉴'
  }
  if (loc.book === 'item') {
    const u = loc.item.open ? useitemMst.get(loc.item.selected) : null
    return u ? `道具 · ${entityNamePlain('item', loc.item.selected, u.api_name)}` : '道具图鉴'
  }
  return loc.book === 'roster' ? '舰娘列表' : '装备仓库'
}

const jiNavButtonsHtml = (): string => {
  const backTarget = jiNav.peekBack()
  const forwardTarget = jiNav.peekForward()
  const backTitle = backTarget
    ? `返回上一层 · ${jiNavLabelOf(backTarget)}`
    : '已在最上层'
  const forwardTitle = forwardTarget
    ? `回到下一层 · ${jiNavLabelOf(forwardTarget)}`
    : '已在最下层'
  return `<span class="ji-nav">
    <button class="ji-nav-btn" data-jinav="back"${backTarget ? '' : ' disabled'} title="${esc(backTitle)}">◂</button>
    <button class="ji-nav-btn" data-jinav="fwd"${forwardTarget ? '' : ' disabled'} title="${esc(forwardTitle)}">▸</button>
  </span>`
}

const BOOKS: [Book, string][] = [
  ['ship', '舰娘'],
  ['equip', '装备'],
  ['abyss', '深海'],
  ['map', '海域'],
  ['item', '道具'],
  ['roster', '列表'],
  ['stock', '仓库'],
]

/** 实验室宿主：接回落点 + 重绘。宿主自带接线与内部状态，重复调用是幂等的。 */
const refreshLabHost = () => {
  const labSlot = pane.querySelector<HTMLElement>('.lab-book-slot')
  if (labSlot) mountLab(labSlot, mst)
}

const render = () => {
  if (!pane) return
  const rosterWasConnected = rosterHost.isConnected
  const stockWasConnected = stockHost.isConnected
  if (!mst) {
    forgetCommittedHtml(pane, 'ji') // 这一支绕开了 commitPaneHtml，记忆不能留着
    pane.innerHTML = `<div class="pane-waiting">
      尚未同步基础数据<br />登录游戏后自动获取</div>`
    return
  }
  // 历史对账要在拼 HTML 之前：本次 render 若产生新层，按钮的可用态得马上跟上；
  // 也必须赶在 innerHTML 重建之前——入栈时抓的滚动剖面读的还是旧页的 DOM。
  jiNavTrack()
  const bookTabs = BOOKS.map(
    ([id, label]) => `<button class="book-tab${activeBook === id ? ' on' : ''}" data-book="${id}">${label}</button>`,
  ).join('')

  const drawerWasOpen = !!pane.querySelector('.book-wrap.open')
  const bookWrap = (id: string, open: boolean, catalog: string, drawer: string) =>
    `<div class="book-wrap${open ? ' open' : ''}" id="${id}">
      <div class="index">${catalog}</div>
      <aside class="drawer${open && drawerWasOpen ? ' stable' : ''}">${open ? drawer : ''}</aside>
    </div>`

  let body = ''
  if (activeBook === 'ship') {
    body = bookWrap('ji-ship-wrap', shipState.open, shipCatalogHtml(), shipState.open ? shipDrawerHtml() : '')
  } else if (activeBook === 'roster') {
    body = '<div class="book-wrap roster-book"></div>'
  } else if (activeBook === 'stock') {
    body = '<div class="book-wrap stock-book"></div>'
  } else if (activeBook === 'equip') {
    body = bookWrap('ji-equip-wrap', equipState.open, equipCatalogHtml(), equipState.open ? equipDrawerHtml() : '')
  } else if (activeBook === 'abyss') {
    body = bookWrap(
      'ji-abyss-wrap',
      abyssState.open,
      abyssCatalogHtml(),
      abyssState.open ? (abyssState.tab === 'equip' ? abyssEquipDrawerHtml() : abyssDrawerHtml()) : '',
    )
  } else if (activeBook === 'map') {
    body = bookWrap('ji-map-wrap', mapState.open, mapCatalogHtml(), mapState.open ? mapDrawerHtml() : '')
  } else {
    body = bookWrap('ji-item-wrap', itemState.open, itemCatalogHtml(), itemState.open ? itemDrawerHtml() : '')
  }

  // 输出没变就整段不动 DOM（闸门口径见 kernel commitPaneHtml）。图鉴是被动重渲的
  // 重灾区：收远征那一串 result/port/useitem 里，图鉴要显示的东西一个字都没变，
  // 但从前每条都整块重建一次——滚动在那几十毫秒里不走、按下与抬起之间赶上就丢一次点击。
  const committed = commitPaneHtml(
    pane,
    'ji',
    `<div class="ji-app">
      <div class="book-tabs">${jiNavButtonsHtml()}${bookTabs}</div>
      ${
        missNotice && missNotice.book === activeBook
          ? `<div class="ji-miss-note">${esc(missNotice.text)}<span class="x" data-act="miss-close" title="关闭">✕</span></div>`
          : ''
      }
      ${body}
    </div>`,
    () => {
      // 列表是嵌在鉴里的持久节点，每次重渲染都要摘下再接回，而元素一旦离开文档流
      // scrollTop 就归零。必须在这个回调**内部**接回：还原紧跟在回调之后，
      // 那时 rosterHost 若还没回到树上就找不到落点，表现就是
      // 「正看着某艘舰的详情，游戏一加载就被拽回列表顶部」。
      if (activeBook === 'roster') {
        pane.querySelector<HTMLElement>('.roster-book')?.appendChild(rosterHost)
      } else if (activeBook === 'stock') {
        pane.querySelector<HTMLElement>('.stock-book')?.appendChild(stockHost)
      }
      // 组合实验室宿主同理（.lab-book-slot 自己就是 overflow:auto 的滚动容器）：
      // 挂在回调外面的话，还原跑的时候 labHost 还没回到树上，被动重渲染就会把
      // 实验室滚回顶部。宿主自带接线与内部状态，重复调用只是接回 + 重绘。
      refreshLabHost()
    },
  )
  if (!committed) {
    // DOM 没换，所以不能重绑（面板级委托挂在存活的子节点上，再挂一遍就是监听叠加）。
    // 但实验室的内容住在持久宿主里、不在鉴生成的 HTML 中——「输出没变」看不见它，
    // 跳过就等于把实验室冻在旧数据上。列表/仓库两个宿主各有自己的 onMgChange，不用管。
    refreshLabHost()
    return
  }

  wire()
  if (activeBook === 'roster') {
    if (!rosterMounted) {
      rosterMounted = true
      mountRosterView(rosterHost)
    } else if (!rosterWasConnected) {
      refreshRosterView()
    }
  } else if (activeBook === 'stock') {
    if (!stockMounted) {
      stockMounted = true
      mountStockView(stockHost)
    } else if (!stockWasConnected) {
      refreshStockView()
    }
  }
}

function updateShipDetailPanel() {
  // 换详情子页不走全量 render，这里补一次历史对账（层键不变，只刷新快照里的子页）
  jiNavTrack()
  const panel = pane.querySelector<HTMLElement>('#ji-ship-panel')
  if (!panel) {
    render()
    return
  }
  // 局部换块：DOM 已经不是上次全量提交的那份，记忆必须作废，
  // 否则下一次全量渲染若生成同样的字符串会被误判成「没变」而跳过（见 kernel commitPaneHtml）
  forgetCommittedHtml(pane, 'ji')
  withViewStateKept(pane, () => {
    pane.querySelectorAll<HTMLElement>('#ji-ship-tabs .tab').forEach((tab) => {
      tab.classList.toggle('on', tab.dataset.p === shipState.dtab)
    })
    panel.innerHTML = shipDetailPanelHtml(true)
  })
  // 重设 innerHTML 之后 <img> 全是新的，之前挂的 load 监听随旧节点一起没了。
  // 而立绘格子是 hidden 起手、靠 load 才现形——不补挂就一格都不显形。
  // （切到「立绘」页正好走这条路：实测过一次整页空白。）
  wireCgImages(panel)
  // 同理：面板里逐元素绑定的控件（备注/前往列表/收容库展开）也全是新元素
  bindShipPanelControls(panel)
}

function wireShipDetailPanel(panel: HTMLElement) {
  wireCgImages(panel) // 立绘格子：加载完才现形，404 的记下来下次不再摆
  panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    // ---- 骨架行的探测钮：**点了才发那一次请求**（一次点击一格，永不批量）----
    //
    // 无配音格（`.none`）也挂着同一个 data-voice-probe，走的也是这一条：
    // 它点下去多带一个 `recheck`，让主进程那道「已知没有」的短路为这一次让路。
    // 点击就是意图，不属于批量骚扰——判据在 shared/voice-probe-plan。
    const probeButton = target.closest<HTMLElement>('.vo-play[data-voice-probe]')
    if (probeButton && !probeButton.classList.contains('busy')) {
      const slot = parseInt(probeButton.dataset.voiceProbe!, 10)
      const recheck = probeButton.classList.contains('none')
      const mstId = shipState.selectedForm
      const url = voiceUrl(mstId, slot)
      if (!url) {
        // 取不到地址的三种原因各不相同（没识别出服务器 / 钥里关了回退 / 主数据没同步），
        // 都不是「官方没有」——如实换一句说明，不写死结论
        probeButton.title = '游戏资源获取不可用 · 登录游戏或开启「未缓存的立绘/语音从游戏资源服务器取」'
        return
      }
      // 重探前先记下这一格悬停上写着的日期：回来之后才判得出「日期变了没有」
      const shownDay = recheck ? voiceAbsentDay(mstId, slot) : ''
      probeButton.classList.add('busy')
      void probeVoiceSlot(mstId, slot, url, recheck)
        .then((verdict) => {
          probeButton.classList.remove('busy')
          if (verdict === 'kept') {
            // 进了档案：广播会把索引更新掉，`kanso:archive-lit` 顺带触发重画，
            // 那一格随即变成正常的档案实物钮。这里只管把它当场播出来。
            // 重探撞上这一支就是「官方后来实装了」——台账那条已经当场作废。
            const archived = archivedVoiceUrl(mstId, slot)
            if (archived) playVoiceUrl(archived, undefined, voiceLabelOf(mstId, voiceSceneOfSlot(slot)))
            return
          }
          if (verdict === 'absent') {
            // **探测失败也是数据**：官方根本没有这一格，台账已经记下（重探则是把
            // 那条的日期换成今天）。重画后转无配音态。
            if (!recheck) {
              scheduleRender()
              return
            }
            // ⚠️ 重探这一支要看**日期变了没有**：悬停里那个日期现在是内容的一部分。
            // 换了一天（上一次是昨天或更早问的）就该重画，不然界面上还挂着旧日期；
            // 同一天里再点，重画会生成一模一样的字符串，反而把下面这句反馈吃掉。
            if (voiceAbsentDay(mstId, slot) !== shownDay) scheduleRender()
            else probeButton.title = '最新核实：官方资源仍无对应项'
            return
          }
          probeButton.title =
            verdict === 'blocked'
              ? // blocked 在这一步仍有多种成因（钥里关了 / 地址暂时现取不了），不说死哪一种
                '游戏资源获取不可用 · 开启「未缓存的立绘/语音从游戏资源服务器取」后重试'
              : '获取失败 · 稍后重试'
        })
        .catch(() => probeButton.classList.remove('busy'))
      return
    }

    // ---- 季节台词行的「取现值」钮：**这里是这条路唯一的请求发起点** ----
    //
    // 每一条都挂在「玩家刚刚点了这一行」上——渲染与滚动不经过这里，所以铺开零请求。
    // ⚠️ **不许在这里加任何「把这一季全取一遍」的入口**（护栏断言着全仓没有
    // probeAll / collectAll 这类东西）。一艘老舰能攒下十几季上百句，批量就是几百连发。
    const takeButton = target.closest<HTMLElement>('[data-voice-take]')
    if (takeButton && !takeButton.classList.contains('busy')) {
      const [rawId, rawSlot] = `${takeButton.dataset.voiceTake ?? ''}`.split('/')
      const mstId = Number(rawId)
      const slot = Number(rawSlot)
      const key = `voice:${mstId}/${slot}`
      const url = voiceUrl(mstId, slot)
      if (!url) {
        collectOutcomes.set(key, 'blocked')
        scheduleRender()
        return
      }
      // 取之前先记下这一格档案里已有的指纹：回来之后才判得出「是不是同一份字节」
      const known = archivedVoiceTakes(mstId, slot).map((take) => take.entry.sha1)
      takeButton.classList.add('busy')
      void probeVoiceSlotDetailed(mstId, slot, url)
        .then((result) => {
          takeButton.classList.remove('busy')
          const outcome = collectOutcomeOf(known, result)
          collectOutcomes.set(key, outcome)
          // 取到了就当场播一次：采集本来就是「听一句，顺手收下」。
          // 播的是档案里那一份（刚入档的就是它），零网络。
          if (outcome === 'new' || outcome === 'same') {
            const takes = archivedVoiceTakes(mstId, slot)
            if (takes.length) {
              playVoiceUrl(takes[0].url, undefined, voiceLabelOf(mstId, voiceSceneOfSlot(slot)))
            }
          }
          scheduleRender()
        })
        .catch(() => {
          takeButton.classList.remove('busy')
          collectOutcomes.set(key, 'error')
          scheduleRender()
        })
      return
    }

    // ---- 深海往期语音的按号试听（KANSO_DEBUG_UI=1 才有这几个钮）----
    //
    // **一次点击一条**，与上面探测钮同一条家法：这里没有任何循环、没有「全试一遍」。
    // 地址走既有出口 `extraVoiceUrl`，一个 https 都不在这儿拼。
    const guessToggle = target.closest<HTMLElement>('[data-abyss-guess]')
    if (guessToggle) {
      const key = `${guessToggle.dataset.abyssGuess ?? ''}`
      // 一次只展开一条：候选要紧挨着那一行的台词，摊开好几行就对不上音节了
      abyssGuessOpen = abyssGuessOpen === key ? '' : key
      scheduleRender()
      return
    }

    const tryButton = target.closest<HTMLElement>('[data-abyss-try]')
    if (tryButton && !tryButton.classList.contains('busy')) {
      const [rawId, , file] = `${tryButton.dataset.abyssTry ?? ''}`.split('/')
      const mstId = Number(rawId)
      const url = file ? extraVoiceUrl('enemy', file) : null
      if (!url) {
        // 取不到地址不是「官方没有这一条」——如实换一句说明，不写死结论
        tryButton.title =
          '游戏资源获取不可用 · 登录游戏或开启「未缓存的立绘/语音从游戏资源服务器取」'
        return
      }
      tryButton.classList.add('busy')
      void playVoiceUrl(
        url,
        // 播成功那一下顺手入档：猜对的这一条从此有实物，收录即有实物
        `/kcs/sound/kc${EXTRA_VOICE_DIRS.enemy}/${file}.mp3`,
        voiceLabelOf(mstId, `试听 #${file}`),
      ).then((verdict) => {
        tryButton.classList.remove('busy')
        // 同一条再点一下是暂停，那不是一次新的判定，别把「响过」改写成别的
        if (verdict === 'paused') return
        // 没响就只记一句「没取到」，**不重试**：猜错档名是常态，轰炸服务器不是
        abyssGuessOutcomes.set(file!, verdict === 'played' ? 'played' : 'missing')
        scheduleRender()
      })
      return
    }

    const keepButton = target.closest<HTMLElement>('[data-abyss-keep]')
    if (keepButton && !keepButton.classList.contains('busy')) {
      const [rawId, , file] = `${keepButton.dataset.abyssKeep ?? ''}`.split('/')
      const mstId = Number(rawId)
      keepButton.classList.add('busy')
      void jiIpc
        .invoke('mg:abyss-voice-record', { mstId, voiceId: file })
        .then((entry: AbyssVoiceSighting | null) => {
          keepButton.classList.remove('busy')
          if (!entry) {
            // 主进程按档名结构复核归属，对不上就拒收。这里照实说，不假装收下了。
            keepButton.title = '归档失败 · 档名无法归入当前形态或主数据尚未同步'
            return
          }
          if (!entry.lineNo) {
            // 归属记下了、场合判不出来：正式界面那一行还点不亮，说清楚是哪一半没成
            keepButton.title = '档名场合无法判定 · 正式界面对应行暂不可用'
          }
          reloadAbyssVoiceSightings()
          scheduleRender()
        })
        .catch((error: unknown) => {
          keepButton.classList.remove('busy')
          console.warn('[kanso] 深海语音收录失败', error)
        })
      return
    }

    const voiceButton = target.closest<HTMLElement>('.vo-play[data-voice]')
    if (voiceButton) {
      const url = voiceButton.dataset.voice!
      // 场合名就摆在同一行的第一格（常规行、骨架行、档案行、扩展格一律如此），
      // 直接取现成的那一份——每个渲染点各写一遍 data-label 必然漏掉几处。
      const scene = voiceButton.closest('.vo-row')?.querySelector('.vo-k')?.textContent ?? ''
      playVoiceUrl(
        url,
        voiceButton.dataset.voicePath,
        voiceLabelOf(shipState.selectedForm, scene),
      )
      return
    }

    const figure = target.closest<HTMLElement>('[data-cg]')
    if (figure) {
      const url = figure.dataset.cg
      if (url) showLightbox(url)
      return
    }
  })
  // 手输前缀（KANSO_DEBUG_UI）：**边打字边记、回车才重画**。
  // 每敲一个键就重画会把光标冲掉（整块面板是 innerHTML 重建的），
  // 而记下来这一步不能省——别处触发一次重渲就会把输入框清空。
  panel.addEventListener('input', (event) => {
    const input = (event.target as HTMLElement)?.closest<HTMLInputElement>('[data-abyss-prefix]')
    if (input) abyssGuessPrefixes.set(`${input.dataset.abyssPrefix ?? ''}`, input.value)
  })
  panel.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement)?.closest<HTMLInputElement>('[data-abyss-prefix]')
    if (!input) return
    abyssGuessPrefixes.set(`${input.dataset.abyssPrefix ?? ''}`, input.value)
    scheduleRender()
  })
}

// 一页能堆到两三屏（实测海域详情约 2750px、舰娘约 1718px），想找中间那段得翻半天。
// 「属性」「装备槽」这类打开就要看的不折也不给折叠钮，其余默认折起来，先给出一份目录。
const ALWAYS_OPEN = new Set(['属性', '数值', '装备槽', '装备加成', '估算数值', '作战概要'])
// 折叠钮照给，但打开抽屉时是展开的：改修工厂紧挨着常开的「装备加成」，
// 玩家点进一件装备十有八九就是来看它今天能不能改
const OPEN_BY_DEFAULT = new Set(['改修工厂'])

const wireSectionFolding = (root: HTMLElement) => {
  installSectionFolding(root, [
    {
      section: '.sec',
      head: '.sec-h',
      title: firstTextTitle,
      alwaysOpen: ALWAYS_OPEN,
      openByDefault: OPEN_BY_DEFAULT,
    },
    // 各卷目录的分类分组（舰种 / 装备类别 / 深海舰种 / 深海装备类别 / 海域）。
    // 与上面那支的默认态**相反**：抽屉里的段默认折起来是为了先给一份目录，
    // 而目录页本身折起来就什么都不剩了——所以默认全展开，折叠只是当场的收纳动作。
    {
      section: '.grp-box',
      head: '.grp',
      title: groupKeyTitle,
      openAllByDefault: true,
    },
  ])
}

/**
 * 这一格显示出来了 → 让主进程把它留进立绘档案。
 *
 * 用户 2026-08-23 报的那处脱节：整张立绘在眼前，收集格却写「0/6 图种」。
 * 根因是显示与点亮两本账——显示走缓存+回退，点亮认档案，而档案此前只收
 * 游戏页面那条钩子。这一句把两本账合上：看得见的就一定入得了档。
 */
const captureCell = (cell: HTMLElement | null | undefined) => {
  const pathname = cell?.dataset.cgPath
  const url = cell?.dataset.cg
  // `data-cg-version` 只有图鉴画廊摆出来的那些格带（主数据里的现行版号）。
  // 本机缓存命中时地址是 file://，版本从地址里提不出来，而它是版本对账的判据。
  if (pathname && url) noteShipArtDisplayed(pathname, url, cell?.dataset.cgVersion)
}

const wireCgImages = (root: ParentNode) => {
  const settle = () => {
    // 自己的全身立绘出来了，就把「同型」那格撤掉——不然同一张图会并排出现两次。
    // 只能在运行时判：官方有没有这张图，要等请求回来才知道。
    if (root.querySelector('[data-cg-cell].big:not([data-cg-family]):not([hidden])')) {
      root.querySelectorAll('[data-cg-family]').forEach((el) => el.remove())
    }
    // 一格都没剩下就把「没有可读取的图」那句露出来。按属性找而不是按类名，
    // 深海立绘与装备贴图共用这套（谁有几张图只有请求回来才知道）。
    root.querySelectorAll<HTMLElement>('[data-cg-grid]').forEach((grid) => {
      if (grid.querySelector('[data-cg-cell]')) return
      const empty = grid.parentElement?.querySelector<HTMLElement>('[data-cg-empty]')
      empty?.removeAttribute('hidden')
      grid.setAttribute('hidden', '')
    })
  }
  root.querySelectorAll<HTMLImageElement>('[data-cg-image]').forEach((image) => {
    const cell = image.closest<HTMLElement>('[data-cg-cell]')
    // 已经就绪（缓存命中）就直接现形，不等 load 事件——否则会白闪一帧
    if (image.complete && image.naturalWidth > 0) {
      cell?.removeAttribute('hidden')
      captureCell(cell)
    }
    image.addEventListener(
      'load',
      () => {
        cell?.removeAttribute('hidden')
        // 显示成功那一下顺手入档。**放在 load 之后、且是单向 IPC**：
        // 显示不等转存，这一格该现形照样现形。
        captureCell(cell)
        settle()
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => {
        // 记下来，下次重渲染就不再摆这个格子
        markShipImageMissing(image.getAttribute('src') ?? '')
        cell?.remove()
        settle()
      },
      { once: true },
    )
  })
  settle()
}

/**
 * 深海面板里**逐元素**绑定的控件。与舰娘面板同理：局部换块后全是新元素，
 * wire 与每次换块都要重绑。立绘的 error 兜底也在这里——曾放在 wire 里，
 * 换块之后 404 回退直接失效。
 */
const bindAbyssPanelControls = (scope: ParentNode) => {
  scope.querySelectorAll<HTMLElement>('[data-abyss-form]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = parseInt(button.dataset.abyssForm!, 10)
      if (!abyssalShips.has(id) || id === abyssState.selected) return
      abyssState.selected = id
      abyssState.open = true
      render()
    })
  })
}

// 深海抽屉 hero 横幅的 404 兜底。它长在 hero 区、在 #ji-abyss-panel **外**，
// 只随全量渲染重建——之前塞在 bindAbyssPanelControls（panel 作用域）里永远
// 匹配不到，横幅 404 时留一个裂图标。
const bindAbyssHeroArt = (scope: ParentNode) => {
  scope.querySelectorAll<HTMLImageElement>('.abyss-art img').forEach((img) => {
    img.addEventListener('error', () => {
      const frame = img.closest<HTMLElement>('.abyss-art')
      if (!frame) return
      frame.className = 'abyss-art'
      frame.removeAttribute('data-cg')
      frame.innerHTML =
        '<span class="st">图片不可用</span><div class="cap">当前形态暂无可读取的官方立绘或横幅</div>'
    })
  })
}

function wireAbyssDetailPanel(panel: HTMLElement) {
  // 面板级 click 委托挂在存活的 panel 上——只许在这里（全量渲染的新元素）挂，
  // 换块路径重挂会**叠加**监听：曾经每切一次子页语音就多响一遍
  wireShipDetailPanel(panel)
  bindAbyssPanelControls(panel)
}

function updateAbyssDetailPanel() {
  // 同舰娘面板：子页切换不走全量 render，历史快照在这里跟上
  jiNavTrack()
  const ship = abyssalShips.get(abyssState.selected)
  const panel = pane.querySelector<HTMLElement>('#ji-abyss-panel')
  if (!ship || !panel) {
    render()
    return
  }
  // 同抽屉：高亮之前先让 dtab 落定，否则这一轮的 tab 条会一个都不亮
  const dtab = settleAbyssTab(ship)
  forgetCommittedHtml(pane, 'ji') // 同上：局部换块后记忆作废
  withViewStateKept(pane, () => {
    pane.querySelectorAll<HTMLElement>('#ji-abyss-tabs .tab').forEach((tab) => {
      tab.classList.toggle('on', tab.dataset.ap === dtab)
    })
    panel.innerHTML = abyssDetailPanelHtml(ship, true)
  })
  // 换块只重绑逐元素控件与 img 监听；panel 级委托在旧 wire 里已挂、且元素存活
  wireCgImages(panel)
  bindAbyssPanelControls(panel)
}

const closeBookDrawer = (bookState: { open: boolean }) => {
  bookState.open = false
  exitWithMotion(pane.querySelector<HTMLElement>('.book-wrap.open'), 'open', render)
}

// 直接开到舰娘图鉴的「入手」页（右键「掉落海域」的落点）
const openShipDropTab = (mstId: number) => {
  activateModule('ji')
  activeBook = 'ship'
  selectShip(rootOf.get(mstId) ?? mstId, mstId)
  shipState.dtab = 'p-drop'
  render()
}

const selectShip = (rootId: number, formId?: number) => {
  shipState.selectedRoot = rootId
  const chain = chainOf.get(rootId) ?? [rootId]
  if (formId && chain.includes(formId)) {
    shipState.selectedForm = formId
  } else {
    // 默认显示最高在籍形态，未持有则显示根
    const owned = chain.filter((id) => instancesOfMst(id).length > 0)
    shipState.selectedForm = owned.length ? owned[owned.length - 1] : chain[0]
  }
  shipState.open = true
}

const wire = () => {
  // 装备与深海装备详情里的贴图格子。它们不走舰娘/深海舰那两条 wire 路径，
  // 不在这里接就一格都不显形——那些格子是 hidden 起手、靠 load 才现形的。
  pane.querySelectorAll<HTMLElement>('.equip-cg-grid').forEach((grid) => {
    if (grid.parentElement) wireCgImages(grid.parentElement)
  })

  pane.querySelector('.book-tabs')?.addEventListener('click', (e) => {
    const nav = (e.target as HTMLElement).closest<HTMLElement>('[data-jinav]')
    if (nav) {
      if (nav.dataset.jinav === 'back') jiNavGoBack()
      else jiNavGoForward()
      return
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.book-tab')
    if (!tab) return
    activeBook = tab.dataset.book as Book
    moreCategoriesOpen = false // 换一卷就收起来，两卷的分类面板不是同一个东西
    missNotice = null // 换卷＝那条回执看完了
    pendingMapOpen = null
    render()
  })

  pane.querySelector<HTMLElement>('[data-act="miss-close"]')?.addEventListener('click', () => {
    missNotice = null
    pendingMapOpen = null
    render()
  })

  // 捞船清单 → 列表筛选联动。再点一次同一个撤销，别让人被困在筛选里出不来。
  pane.querySelector('#ji-ship-wrap')?.addEventListener('click', (e) => {
    const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-hunt-filter]')
    if (!pick) return
    e.preventDefault() // 它长在 <summary> 里，不拦会顺手把 details 折起来
    const want = pick.dataset.huntFilter as '' | 'catchable' | 'event'
    shipState.huntFilter = shipState.huntFilter === want ? '' : want
    // 筛选是「还缺的船」，跟舰种分类同时生效没意义，进来时清掉其余轴
    if (shipState.huntFilter) {
      shipState.chip = '全部'
      clearShipDimensions()
    }
    render()
  })

  // 舰娘卷
  const shipSearch = pane.querySelector<HTMLInputElement>('#ji-ship-search')
  // 四个卷的检索框一律走 onFilterInput 而不是裸 input：重渲会把输入框元素整个换掉，
  // 输入法的组合会话绑在那个元素上，换一次就断（见 kernel 第三道闸门）
  if (shipSearch) {
    onFilterInput(shipSearch, () => {
      shipState.search = shipSearch.value
      render()
      pane.querySelector<HTMLInputElement>('#ji-ship-search')?.focus()
    })
  }
  pane.querySelector('#ji-ship-wrap .type-chips')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-more-cat]')) {
      moreCategoriesOpen = !moreCategoriesOpen
      render()
      return
    }
    const chip = target.closest<HTMLElement>('.chip')
    if (!chip?.dataset.chip) return
    const next = chip.dataset.chip
    // 进出 NPC 位顺手关抽屉：两边抽屉装的是两族东西，留着上一族的开着——
    // NPC 列表旁边摊着一艘舰娘的详情页——正是这一页要防的那种混淆
    if ((next === NPC_CHIP) !== (shipState.chip === NPC_CHIP)) {
      shipState.open = false
      shipState.npcName = ''
    }
    shipState.chip = next
    clearShipDimensions()
    render()
  })
  // 更多分类：四个维度各自精确筛（舰种 / 国籍 / 型 / 编队）。
  // 再点一次同一格 = 取消，别把人困在筛选里；选中后收起面板，让位给列表。
  pane.querySelector('#ji-ship-wrap .cat-more')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    // 抬头行上那枚 chip：取消这一维的筛选（收起来也点得到，状态不藏）
    const clear = target.closest<HTMLElement>('[data-clear-dim]')
    if (clear) {
      clearShipDimensions()
      render()
      return
    }
    const findClear = target.closest<HTMLElement>('[data-cat-find-clear]')
    if (findClear) {
      const key = findClear.dataset.catFindClear as 'class' | 'fleet'
      catFind[key] = ''
      render()
      pane.querySelector<HTMLInputElement>(`[data-cat-find="${key}"]`)?.focus()
      return
    }
    // 手风琴：点段名开这一段，同时把别的段收起来；再点一次收起自己
    const head = target.closest<HTMLElement>('[data-cat-sec]')
    if (head) {
      const key = head.dataset.catSec as Exclude<ShipCatSection, ''>
      moreCategorySection = moreCategorySection === key ? '' : key
      render()
      return
    }
    const cell = target.closest<HTMLElement>(
      '[data-ship-type],[data-ship-nation],[data-ship-class],[data-ship-fleet]',
    )
    if (!cell) return
    const { shipType, shipNation, shipClass, shipFleet } = cell.dataset
    const want = {
      type: shipType != null ? Number(shipType) : 0,
      nation: shipNation != null ? Number(shipNation) : 0,
      ctype: shipClass != null ? Number(shipClass) : 0,
      fleet: shipFleet ?? '',
    }
    const already =
      (want.type && shipState.typeFilter === want.type) ||
      (want.nation && shipState.nationalityFilter === want.nation) ||
      (want.ctype && shipState.classFilter === want.ctype) ||
      (want.fleet && shipState.fleetFilter === want.fleet)
    clearShipDimensions()
    if (!already) {
      if (want.type) shipState.typeFilter = want.type
      else if (want.nation) shipState.nationalityFilter = want.nation
      else if (want.ctype) shipState.classFilter = want.ctype
      else if (want.fleet) shipState.fleetFilter = want.fleet
    }
    shipState.chip = '全部'
    moreCategoriesOpen = false
    render()
  })
  // 段内就地过滤：每敲一下重渲一次，渲完把光标放回去（与主搜索框同一手法）
  pane.querySelectorAll<HTMLInputElement>('#ji-ship-wrap [data-cat-find]').forEach((input) => {
    onFilterInput(input, () => {
      const key = input.dataset.catFind as 'class' | 'fleet'
      catFind[key] = input.value
      const caret = input.selectionStart
      render()
      const next = pane.querySelector<HTMLInputElement>(`[data-cat-find="${key}"]`)
      if (!next) return
      next.focus()
      if (caret != null) next.setSelectionRange(caret, caret)
    })
  })
  // 抬头行按回车/空格也能开合——它是 role="button"，键盘要走得通
  pane.querySelectorAll<HTMLElement>('#ji-ship-wrap [data-cat-sec]').forEach((head) => {
    head.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      const key = head.dataset.catSec as Exclude<ShipCatSection, ''>
      moreCategorySection = moreCategorySection === key ? '' : key
      render()
    })
  })
  // 排序切换（分组 / 编号）。存本机——翻图鉴的习惯不该每次重开都被重置
  pane.querySelectorAll<HTMLElement>('[data-ship-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.shipSort === 'no' ? 'no' : 'group'
      if (next === shipState.sort) return
      shipState.sort = next
      uiSet('ji.shipSort', next)
      render()
    })
  })
  // 模板里这个按钮可以同时出现四个（舰种/国籍/型/编队各带一个）；
  // 现状是四者互斥所以只会渲一个，但绑单数等于把「不会同时出现」写进接线里
  pane.querySelectorAll<HTMLElement>('[data-clear-ship-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      clearShipDimensions()
      shipState.chip = '全部'
      render()
    })
  })
  pane.querySelectorAll<HTMLElement>('[data-sister-toggle]').forEach((head) => {
    const toggle = () => {
      const ctype = Number(head.dataset.sisterToggle)
      if (!Number.isInteger(ctype) || ctype <= 0) return
      if (collapsedShipClasses.has(ctype)) collapsedShipClasses.delete(ctype)
      else collapsedShipClasses.add(ctype)
      uiSet('ji.collapsedShipClasses', [...collapsedShipClasses].sort((a, b) => a - b))
      render()
    }
    head.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.el')) return
      toggle()
    })
    head.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    })
  })
  pane.querySelector('#ji-ship-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row')
    if (!row) return
    // Alt/Ctrl+单击 = 钉对比小窗，不开抽屉
    const me = e as MouseEvent
    if (me.altKey || me.ctrlKey) {
      pinEntityPeek({ type: 'mstShip', id: row.dataset.root! }, row)
      return
    }
    selectShip(parseInt(row.dataset.root!, 10))
    render()
  })
  pane.querySelector('#ji-ship-close')?.addEventListener('click', () => {
    closeBookDrawer(shipState)
  })
  pane.querySelector('#ji-npc-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row')
    if (!row?.dataset.npc) return
    shipState.npcName = row.dataset.npc
    shipState.open = true
    render()
  })
  pane.querySelector('#ji-npc-close')?.addEventListener('click', () => {
    closeBookDrawer(shipState)
  })
  pane.querySelector('#ji-npc-voices')?.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.vo-play[data-npc-voice]')
    if (!button) return
    // 迷你条上写「角色名 · NPC」：这一页的身份是 NPC 位。这里不能落到那条通用
    // `.vo-play[data-voice]` 上——它按 shipState.selectedForm 取名字，会把上一次
    // 看过的那艘舰娘的名字挂到这一句上
    playVoiceUrl(button.dataset.npcVoice!, button.dataset.voicePath, `${shipState.npcName} · ${NPC_CHIP}`)
  })
  pane.querySelector<HTMLElement>('[data-ship-favorite]')?.addEventListener('click', (e) => {
    const button = e.currentTarget as HTMLElement
    toggleFavoriteShipRoot(parseInt(button.dataset.shipFavorite!, 10))
    render()
  })
  bindShipPanelControls(pane)
  pane.querySelector('#ji-ship-wrap .remodel')?.addEventListener('click', (e) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.rm-node')
    if (!node) return
    shipState.selectedForm = parseInt(node.dataset.form!, 10)
    render()
  })
  pane.querySelector('#ji-ship-tabs')?.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab')
    const next = tab?.dataset.p
    if (!next || next === shipState.dtab) return
    shipState.dtab = next
    updateShipDetailPanel()
  })
  const shipDetailPanel = pane.querySelector<HTMLElement>('#ji-ship-panel')
  if (shipDetailPanel) wireShipDetailPanel(shipDetailPanel)
  const abyssDetailPanel = pane.querySelector<HTMLElement>('#ji-abyss-panel')
  if (abyssDetailPanel) wireAbyssDetailPanel(abyssDetailPanel)
  // 深海 hero 横幅 404 兜底：hero 在面板外、只随全量渲染重建，在这里挂
  bindAbyssHeroArt(pane)
  // 装备卡面 404 兜底：回退成类别图标
  pane.querySelectorAll<HTMLImageElement>('[data-equip-art]').forEach((img) => {
    img.addEventListener('error', () => {
      const frame = img.closest<HTMLElement>('.equip-art')
      const id = parseInt(img.dataset.equipArt ?? '', 10)
      const equip = friendlyEquips.get(id) ?? abyssalEquips.get(id)
      if (!frame || !equip) return
      const abyss = abyssalEquips.has(id)
      const iconId = Array.isArray(equip.api_type) ? equip.api_type[3] : 0
      frame.className = `equip-art${abyss ? ' abyss' : ''}`
      frame.removeAttribute('data-cg')
      frame.innerHTML = `${equipTypeIconHtml(iconId, { className: `hero-icon${abyss ? ' abyss' : ''}`, title: entityNamePlain(abyss ? 'abyssEquip' : 'equip', equip.api_id, equip.api_name) })}
        <div class="cap">当前装备暂无可读取的官方卡面</div>`
    })
  })
  pane.querySelectorAll<HTMLElement>('[data-map-art]').forEach((frame) => {
    void hydrateMapArt(frame)
  })
  pane.querySelectorAll<HTMLElement>('[data-cg]').forEach((fig) => {
    if (fig.closest('#ji-ship-panel, #ji-abyss-panel')) return
    fig.addEventListener('click', () => {
      const url = fig.dataset.cg
      if (url) showLightbox(url)
    })
  })
  // 装备卷
  const equipSearch = pane.querySelector<HTMLInputElement>('#ji-equip-search')
  if (equipSearch) {
    onFilterInput(equipSearch, () => {
      equipState.search = equipSearch.value
      render()
      pane.querySelector<HTMLInputElement>('#ji-equip-search')?.focus()
    })
  }
  pane.querySelectorAll<HTMLElement>('[data-equip-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.equipMode as typeof equipState.mode
      // 白名单要跟模式清单一起长——组合实验室上线时这里漏了 'lab'，
      // 按钮点了毫无反应（2026-08-12 用户实测）
      if (!['catalog', 'today', 'lab'].includes(mode) || mode === equipState.mode) return
      equipState.mode = mode
      equipState.open = false
      render()
    })
  })
  pane.querySelector('#ji-equip-wrap .type-chips')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-more-cat]')) {
      moreCategoriesOpen = !moreCategoriesOpen
      render()
      return
    }
    const chip = target.closest<HTMLElement>('.chip')
    if (!chip?.dataset.chip) return
    equipState.chip = chip.dataset.chip
    equipState.typeFilter = 0
    render()
  })
  pane.querySelector('#ji-equip-wrap .cat-more')?.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-equip-type]')
    if (!cell) return
    const type = Number(cell.dataset.equipType)
    equipState.typeFilter = equipState.typeFilter === type ? 0 : type
    equipState.chip = '全部'
    moreCategoriesOpen = false
    render()
  })
  pane.querySelector('[data-clear-equip-scope]')?.addEventListener('click', () => {
    equipState.typeFilter = 0
    equipState.chip = '全部'
    render()
  })
  pane.querySelector('#ji-equip-list')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    // 「今日改修」的行是行内折叠：点行就地展开，只有「装备详情 ›」这一枚进抽屉。
    // 用户裁的——那一页要能一眼扫完，不是每看一条就把整个抽屉推出来一次
    const opener = target.closest<HTMLElement>('[data-improve-open]')
    if (opener) {
      equipState.selected = parseInt(opener.dataset.improveOpen!, 10)
      equipState.open = true
      render()
      return
    }
    if (target.closest('.el, .improve-helper-more')) return
    const item = target.closest<HTMLElement>('.improve-item')
    if (item) {
      const me = e as MouseEvent
      // Alt/Ctrl 仍是「钉速览」；要拦下 <summary> 的原生开合，否则钉的同时行也翻了
      if (me.altKey || me.ctrlKey) {
        e.preventDefault()
        pinEntityPeek({ type: 'mstEquip', id: item.dataset.equip! }, item)
      }
      return
    }
    const row = target.closest<HTMLElement>('.row')
    if (!row) return
    const me = e as MouseEvent
    if (me.altKey || me.ctrlKey) {
      pinEntityPeek({ type: 'mstEquip', id: row.dataset.equip! }, row)
      return
    }
    equipState.selected = parseInt(row.dataset.equip!, 10)
    equipState.open = true
    render()
  })
  pane.querySelector('#ji-equip-close')?.addEventListener('click', () => {
    closeBookDrawer(equipState)
  })
  // 深海卷
  const abyssSearch = pane.querySelector<HTMLInputElement>('#ji-abyss-search')
  if (abyssSearch) {
    onFilterInput(abyssSearch, () => {
      abyssState.search = abyssSearch.value
      render()
      pane.querySelector<HTMLInputElement>('#ji-abyss-search')?.focus()
    })
  }
  pane.querySelectorAll<HTMLElement>('.ab-tab[data-abtab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.abtab as 'ship' | 'equip'
      if (abyssState.tab === next) return
      abyssState.tab = next
      // 两栏的 selected 不通用（舰 id 与装备 id 不同域），切栏时收起抽屉
      abyssState.selected = 0
      abyssState.search = ''
      moreCategoriesOpen = false // 两栏的分类面板不是同一个东西
      closeBookDrawer(abyssState)
    })
  })
  pane.querySelector('#ji-abyss-wrap .type-chips')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-more-cat]')) {
      moreCategoriesOpen = !moreCategoriesOpen
      render()
      return
    }
    if (target.closest('[data-clear-abyss-scope]')) {
      abyssState.shipTypeFilter = 0
      abyssState.equipTypeFilter = 0
      render()
      return
    }
    const chip = target.closest<HTMLElement>('[data-abyss-ship-chip], [data-abyss-equip-chip]')
    if (!chip) return
    if (chip.dataset.abyssShipChip) {
      abyssState.shipChip = chip.dataset.abyssShipChip
      abyssState.shipTypeFilter = 0
    } else {
      abyssState.equipChip = chip.dataset.abyssEquipChip!
      abyssState.equipTypeFilter = 0
    }
    render()
  })
  // 更多分类：精确到单个舰种 / 单个装备类别，选完收起面板让位给列表
  pane.querySelector('#ji-abyss-wrap .cat-more')?.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-abyss-ship-type], [data-abyss-equip-type]')
    if (!cell) return
    if (cell.dataset.abyssShipType) {
      const stype = Number(cell.dataset.abyssShipType)
      abyssState.shipTypeFilter = abyssState.shipTypeFilter === stype ? 0 : stype
      abyssState.shipChip = '全部'
    } else {
      const type2 = Number(cell.dataset.abyssEquipType)
      abyssState.equipTypeFilter = abyssState.equipTypeFilter === type2 ? 0 : type2
      abyssState.equipChip = '全部'
    }
    moreCategoriesOpen = false
    render()
  })
  pane.querySelector('#ji-abyss-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row')
    if (!row) return
    if (row.dataset.abequip) {
      if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
        pinEntityPeek({ type: 'abyssEquip', id: row.dataset.abequip }, row)
        return
      }
      abyssState.selected = parseInt(row.dataset.abequip, 10)
      abyssState.open = true
      render()
      return
    }
    const me = e as MouseEvent
    if (me.altKey || me.ctrlKey) {
      pinEntityPeek({ type: 'abyssShip', id: row.dataset.abyss! }, row)
      return
    }
    abyssState.selected = parseInt(row.dataset.abyss!, 10)
    abyssState.open = true
    render()
  })
  pane.querySelector('#ji-abyss-close')?.addEventListener('click', () => {
    closeBookDrawer(abyssState)
  })
  pane.querySelector('#ji-abyss-tabs')?.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('.tab')
    const next = tab?.dataset.ap as AbyssDetailTab | undefined
    if (!next || next === abyssState.dtab) return
    abyssState.dtab = next
    updateAbyssDetailPanel()
  })

  // 海域卷
  pane.querySelector('#ji-map-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row')
    if (!row) return
    const me = e as MouseEvent
    if (me.altKey || me.ctrlKey) {
      pinEntityPeek({ type: 'map', id: row.dataset.map! }, row)
      return
    }
    const selected = parseInt(row.dataset.map!, 10)
    if (selected !== mapState.selected) {
      mapState.personalNode = ''
      mapState.dropNode = ''
      mapClearFleetsOpen = false // 换图回到只主推两套
    }
    mapState.selected = selected
    mapState.open = true
    mapState.difficulty = null
    if (mg.sortie?.active && !mg.sortie.practice && mapIdOf(mg.sortie.mapArea, mg.sortie.mapNo) === mapState.selected) {
      mapState.fleetId = mg.sortie.deckId
    }
    render()
  })
  pane.querySelectorAll<HTMLElement>('[data-map-difficulty]').forEach((button) => {
    button.addEventListener('click', () => {
      const difficulty = button.dataset.mapDifficulty as EventDifficulty
      if (!EVENT_DIFFICULTIES.includes(difficulty)) return
      mapState.difficulty = difficulty
      mapState.dropNode = ''
      mapForecastState.key = ''
      render()
    })
  })
  pane.querySelectorAll<HTMLElement>('[data-map-forecast-deck]').forEach((button) => {
    button.addEventListener('click', () => {
      const deckId = Number(button.dataset.mapForecastDeck)
      if (!mapForecastDecks().some((deck) => deck.id === deckId)) return
      mapState.fleetId = deckId
      mapForecastState.key = ''
      render()
    })
  })
  pane.querySelectorAll<HTMLSelectElement>('[data-map-route-target]').forEach((select) => {
    select.addEventListener('change', () => {
      const code = select.dataset.mapRouteTarget
      if (!code) return
      setRouteTarget(code, select.value)
      render()
    })
  })
  pane.querySelector('#ji-map-close')?.addEventListener('click', () => {
    closeBookDrawer(mapState)
  })
  // 节点图 → 下面的敌编成小节：**一张图一个委托**，不逐节点挂。
  // 点位数随图走（活动图三十多个），而 wire 每次换 DOM 都重跑一遍，
  // 逐个 addEventListener 等于每次重渲都铺一地监听器换一次跳转。
  pane.querySelectorAll<SVGSVGElement>('.mapgraph').forEach((graph) => {
    graph.addEventListener('click', (event) => {
      const hit = (event.target as Element | null)?.closest(`[${MAP_NODE_JUMP_ATTR}]`)
      const node = hit?.getAttribute(MAP_NODE_JUMP_ATTR)
      if (!node) return
      const target = pane.querySelector<HTMLElement>(enemyCompRowSelector(node))
      // 没这一节就什么都不做。标记本来就只发给有落点的点位，走到这里多半是
      // 资料在两次渲染之间换了难度层——空跳一次不如不动
      if (!target) return
      // 先把这一节**真的展开**再滚。「敌编成」不在 ALWAYS_OPEN 里，打开抽屉时是
      // 折起来的，而折起来的段是 display:none——没有盒子，scrollIntoView 一寸不滚、
      // 脉冲一个像素不闪，整次点击静默空转，一行日志都不留
      // （2026-08-28 用户报的「点了没反应」就是这个，隔离实例上复现坐实：
      //  监听器挂着、选择器也找得到行，只是那一行 display:none、rect 全 0）。
      // revealSection 会把展开记进折叠账本，否则下一次被动重渲就折回去了。
      revealSection(target)
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // 落地之后闪一下，指认「就是这一节」。与战斗行的定位高亮同款
      // （di 那条路已经在实机上跑熟）：先摘再挂，连点同一个点位也能再闪一次
      target.classList.remove('focus')
      requestAnimationFrame(() => target.classList.add('focus'))
      setTimeout(() => target.classList.remove('focus'), 2200)
    })
  })
  pane.querySelector<HTMLElement>('[data-map-chronicle-retry]')?.addEventListener('click', (event) => {
    const mapId = Number((event.currentTarget as HTMLElement).dataset.mapChronicleRetry)
    invalidateMapChronicle(mapId)
    render()
  })
  pane.querySelector<HTMLElement>('[data-cf-more]')?.addEventListener('click', () => {
    mapClearFleetsOpen = !mapClearFleetsOpen
    render()
  })
  pane.querySelectorAll<HTMLElement>('[data-cf-snap]').forEach((chip) => {
    chip.addEventListener('click', (event) => {
      event.stopPropagation()
      const [rowIndex, deckIndex, shipIndex] = `${chip.dataset.cfSnap}`.split(',').map(Number)
      if (mapState.selected) openCfSnapshot(mapState.selected, rowIndex, deckIndex, shipIndex, chip)
    })
  })
  // （重试钮的绑定在 `bindShipPanelControls`：局部换块也要重绑）
  pane.querySelectorAll<HTMLElement>('[data-map-personal-node]').forEach((button) => {
    button.addEventListener('click', () => {
      const node = button.dataset.mapPersonalNode ?? ''
      mapState.personalNode = node === mapState.personalNode ? '' : node
      render()
    })
  })
  pane.querySelectorAll<HTMLElement>('[data-map-drop-node]').forEach((button) => {
    button.addEventListener('click', () => {
      const node = button.dataset.mapDropNode ?? ''
      mapState.dropNode = node === mapState.dropNode ? '' : node
      render()
    })
  })
  pane.querySelector<HTMLElement>('[data-map-drop-expand]')?.addEventListener('click', (ev) => {
    const code = (ev.currentTarget as HTMLElement).dataset.mapDropExpand
    if (!code) return
    if (expandedMapDrops.has(code)) expandedMapDrops.delete(code)
    else expandedMapDrops.add(code)
    render()
  })

  // 道具卷
  const itemSearch = pane.querySelector<HTMLInputElement>('#ji-item-search')
  if (itemSearch) {
    onFilterInput(itemSearch, () => {
      itemState.search = itemSearch.value
      render()
      pane.querySelector<HTMLInputElement>('#ji-item-search')?.focus()
    })
  }
  pane.querySelector('.icats')?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-icat]')
    if (!chip) return
    itemState.cat = chip.dataset.icat as ItemCat
    render()
  })
  pane.querySelector('#ji-item-list')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row')
    if (!row) return
    const me = e as MouseEvent
    if (me.altKey || me.ctrlKey) {
      pinEntityPeek({ type: 'useitem', id: row.dataset.item! }, row)
      return
    }
    itemState.selected = parseInt(row.dataset.item!, 10)
    itemState.open = true
    render()
  })
  pane.querySelector('#ji-item-close')?.addEventListener('click', () => {
    closeBookDrawer(itemState)
  })
}

export const openEquipmentCatalog = () => {
  activateModule('ji')
  activeBook = 'equip'
  equipState.mode = 'catalog'
  equipState.open = false
  render()
}

const hydrateMapArt = async (frame: HTMLElement): Promise<void> => {
  const [areaText, noText] = (frame.dataset.mapArt ?? '').split(':')
  const areaId = parseInt(areaText, 10)
  const mapNo = parseInt(noText, 10)
  if (!Number.isFinite(areaId) || !Number.isFinite(mapNo)) return
  const manifest = await mapArtManifest(areaId, mapNo)
  if (!frame.isConnected || frame.dataset.mapArt !== `${areaId}:${mapNo}`) return
  if (!manifest) {
    frame.innerHTML =
      '<div class="map-art-state">官方地图美术当前不可用</div>'
    return
  }
  const canvas = document.createElement('div')
  canvas.className = 'map-art-canvas'
  for (const layer of manifest.layers) {
    const div = document.createElement('div')
    div.className = 'map-art-layer'
    div.style.backgroundImage = `url(${JSON.stringify(layer.imageUrl)})`
    div.style.backgroundPosition = `${layer.x}px ${layer.y}px`
    canvas.appendChild(div)
  }
  frame.replaceChildren(canvas)
  const fit = () => {
    if (!frame.isConnected) {
      observer.disconnect()
      return
    }
    canvas.style.transform = `scale(${frame.clientWidth / manifest.width})`
  }
  const observer = new ResizeObserver(fit)
  observer.observe(frame)
  fit()
}

// Esc 关闭抽屉（模块级）
const BOOK_STATES: Record<Book, { open: boolean }> = {
  ship: shipState,
  // 列表与仓库的详情是嵌在自己视图里的，没有鉴这一层的抽屉可关
  roster: { open: false },
  stock: { open: false },
  equip: equipState,
  abyss: abyssState,
  map: mapState,
  item: itemState,
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !pane?.classList.contains('active')) return
  const state = BOOK_STATES[activeBook]
  if (state.open) {
    closeBookDrawer(state)
  }
})

// ---- 链路由注册（鉴是舰娘/装备实体的宿主）----

registerEntityRoute('shipClass', {
  colorClass: 'e-ship',
  open(ref) {
    const ctype = Number(ref.id)
    if (!Number.isFinite(ctype) || !rootsOfClass(ctype).length) return
    activateModule('ji')
    activeBook = 'ship'
    shipState.search = ''
    shipState.chip = '全部'
    clearShipDimensions()
    shipState.classFilter = ctype
    shipState.open = false
    render()
  },
  peek(ref) {
    const ctype = Number(ref.id)
    const roots = rootsOfClass(ctype)
    if (!roots.length) return null
    const owned = roots.filter((root) => chainInstances(root.api_id).length > 0).length
    return {
      title: shipClassLabel(ctype),
      typeLabel: '舰级',
      lines: [
        `姊妹舰 ${roots.length} 艘 · 已持有 ${owned}`,
        roots.slice(0, 8).map((root) => entityNamePlain('ship', root.api_id, root.api_name)).join('、') +
          (roots.length > 8 ? ` 等 ${roots.length} 艘` : ''),
      ],
      primary: '舰娘图鉴',
    }
  },
})

registerEntityRoute('shipTypeCatalog', {
  colorClass: 'e-ship',
  open(ref) {
    const stype = Number(ref.id)
    if (!Number.isFinite(stype)) return
    activateModule('ji')
    activeBook = 'ship'
    shipState.search = ''
    shipState.chip = '全部'
    clearShipDimensions()
    shipState.typeFilter = stype
    shipState.open = false
    render()
  },
  peek(ref) {
    const stype = Number(ref.id)
    const roots = [...chainOf.keys()]
      .map((id) => friendlyShips.get(id))
      .filter((ship) => ship?.api_stype === stype)
    if (!roots.length) return null
    const name = entityNamePlain('shipType', stype, mg.master.stypes[stype] ?? `舰种${stype}`)
    return {
      title: name,
      typeLabel: '舰种',
      lines: [`图鉴收录 ${roots.length} 艘 · 已持有 ${roots.filter((root) => chainInstances(root.api_id).length > 0).length}`],
      primary: '舰娘图鉴',
    }
  },
})

registerEntityRoute('shipTypeGroup', {
  colorClass: 'e-ship',
  open(ref) {
    const types = `${ref.id}`.split(',').map(Number).filter(Number.isFinite)
    const chip = SHIP_CHIPS.find(([, ids]) =>
      types.length === ids.length && types.every((type) => ids.includes(type)),
    )?.[0]
    if (!chip) return
    activateModule('ji')
    activeBook = 'ship'
    shipState.search = ''
    shipState.chip = chip
    clearShipDimensions()
    shipState.open = false
    render()
  },
  peek(ref) {
    const types = `${ref.id}`.split(',').map(Number).filter(Number.isFinite)
    const chip = SHIP_CHIPS.find(([, ids]) =>
      types.length === ids.length && types.every((type) => ids.includes(type)),
    )?.[0]
    if (!chip) return null
    const roots = [...chainOf.keys()]
      .map((id) => friendlyShips.get(id))
      .filter((ship) => ship && types.includes(ship.api_stype))
    return {
      title: chip,
      typeLabel: '舰种组',
      lines: [`图鉴收录 ${roots.length} 艘 · 已持有 ${roots.filter((root) => chainInstances(root.api_id).length > 0).length}`],
      primary: '舰娘图鉴',
    }
  },
})

registerEntityRoute('shipNationality', {
  colorClass: 'e-nationality',
  open(ref) {
    const nationalityId = Number(ref.id)
    if (
      !Number.isInteger(nationalityId) ||
      !shipNationalityById(nationalityId) ||
      !rootsOfNationality(nationalityId).length
    ) return
    activateModule('ji')
    activeBook = 'ship'
    shipState.search = ''
    shipState.chip = '全部'
    clearShipDimensions()
    shipState.nationalityFilter = nationalityId
    shipState.open = false
    render()
  },
  peek(ref) {
    const nationalityId = Number(ref.id)
    const nationality = shipNationalityById(nationalityId)
    const roots = rootsOfNationality(nationalityId)
    if (!nationality || !roots.length) return null
    const owned = roots.filter((root) => chainInstances(root.api_id).length > 0).length
    return {
      title: `${nationality.label}舰娘`,
      typeLabel: '国籍',
      lines: [
        `图鉴收录 ${roots.length} 艘 · 已持有 ${owned}`,
        roots
          .slice(0, 8)
          .map((root) => entityNamePlain('ship', root.api_id, root.api_name))
          .join('、') + (roots.length > 8 ? ` 等 ${roots.length} 艘` : ''),
      ],
      primary: '舰娘图鉴',
    }
  },
})

/**
 * 史实编队。数据在 shared/hist-fleets（第一方馆藏，单一出处），鉴是它的展示面与公证处
 * ——详情页的编队小节、更多分类的编队段、别处将来引用队名，走的都是这一条路由。
 */
registerEntityRoute('histFleet', {
  colorClass: 'e-histfleet',
  open(ref) {
    const entry = histFleetById(`${ref.id}`)
    if (!entry) return
    activateModule('ji')
    activeBook = 'ship'
    shipState.search = ''
    shipState.chip = '全部'
    clearShipDimensions()
    shipState.fleetFilter = entry.id
    shipState.open = false
    render()
  },
  peek(ref) {
    const entry = histFleetById(`${ref.id}`)
    if (!entry) return null
    const roots = rootsOfHistFleet(entry.id)
    const owned = roots.filter((root) => chainInstances(root.api_id).length > 0).length
    const lines = [
      `${HIST_FLEET_KIND_LABEL[entry.kind]}${entry.period ? ` · ${entry.period.label}` : ''} · 成员 ${entry.members.length} 名`,
      histFleetTip(entry),
      roots.length ? `图鉴收录 ${roots.length} 艘 · 已持有 ${owned}` : '',
    ]
    // note 只在核过文献时才摆出来——未核的史实注记不进产品面
    if (entry.noteStatus === 'verified' && entry.note) lines.push(entry.note)
    return {
      title: histFleetLabel(entry),
      typeLabel: '史实编队',
      lines: lines.filter(Boolean),
      primary: '舰娘图鉴',
    }
  },
})

registerEntityRoute('equipTypeCatalog', {
  colorClass: 'e-equip',
  open(ref) {
    const typeId = Number(ref.id)
    if (!Number.isFinite(typeId)) return
    activateModule('ji')
    activeBook = 'equip'
    equipState.mode = 'catalog'
    equipState.search = ''
    equipState.chip = '全部'
    equipState.typeFilter = typeId
    equipState.open = false
    render()
  },
  peek(ref) {
    const typeId = Number(ref.id)
    // 与筛选面同一口径：点进去看到的是有效类别那一批，速览卡的数就得是同一批
    const equips = [...friendlyEquips.values()].filter(
      (equip) => equipCategoryOf(equip) === typeId,
    )
    if (!equips.length) return null
    const name =
      typeId === HIGH_ANGLE_CATEGORY
        ? HIGH_ANGLE_CATEGORY_NAME
        : entityNamePlain('equipType', typeId, equipTypes.get(typeId) ?? `分类${typeId}`)
    return {
      title: name,
      typeLabel: '装备类别',
      lines: [`图鉴收录 ${equips.length} 件 · 已持有 ${equips.filter((equip) => equipInstancesOf(equip.api_id).length > 0).length}`],
      primary: '装备仓库 · 清理视图',
    }
  },
})

registerEntityRoute('equipTypeGroup', {
  colorClass: 'e-equip',
  open(ref) {
    const chip = `${ref.id}`
    if (!EQUIP_CHIPS.includes(chip)) return
    activateModule('ji')
    activeBook = 'equip'
    equipState.mode = 'catalog'
    equipState.search = ''
    equipState.chip = chip
    equipState.typeFilter = 0
    equipState.open = false
    render()
  },
  peek(ref) {
    const chip = `${ref.id}`
    // 「全部」没有对照价值；「其他」原来因为在表里查不到名单而没有预览，现在也有了
    if (!EQUIP_CHIPS.includes(chip) || chip === '全部') return null
    const equips = [...friendlyEquips.values()].filter((equip) =>
      equipChipMatches(
        chip,
        Array.isArray(equip.api_type) ? equip.api_type[2] : 0,
        Array.isArray(equip.api_type) ? equip.api_type[0] : -1,
      ),
    )
    return {
      title: chip,
      typeLabel: '装备类别',
      lines: [`图鉴收录 ${equips.length} 件 · 已持有 ${equips.filter((equip) => equipInstancesOf(equip.api_id).length > 0).length}`],
      primary: '装备图鉴',
    }
  },
})

registerEntityRoute('mstShip', {
  colorClass: 'e-ship',
  open(ref) {
    const mstId = ref.num
    const root = rootOf.get(mstId)
    if (!root) return
    activateModule('ji')
    activeBook = 'ship'
    selectShip(root, mstId)
    render()
  },
  targets: (ref) => {
    const mstId = ref.num
    const name = friendlyShips.get(mstId)?.api_name ?? ''
    return [
      { label: '舰娘列表定位', run: () => locateShipInList(mstId) },
      { label: '有关任务', run: () => searchInManager(name) },
      { label: '掉落海域', run: () => openShipDropTab(mstId) },
    ]
  },
  peek(ref) {
    const mstId = ref.num
    const s = friendlyShips.get(mstId)
    if (!s) return null
    const instances = chainInstances(rootOf.get(mstId) ?? mstId)
    const maxLv = instances.length ? Math.max(...instances.map((i) => i.lv)) : 0
    const wiki = kcwikiByMst.get(mstId)
    // 属性行：kcwiki 口径（含隐藏三维）优先，整块回退主数据最大值
    const b = (v: unknown) => `<b style="color:var(--text)">${v}</b>`
    let statsLine: string
    let miscLine: string
    if (wiki?.数据) {
      const d = wiki.数据
      const mx = (pair: number[] | undefined) => (Array.isArray(pair) ? pair[1] : '?')
      statsLine = `耐${b(mx(d.耐久))} 火${b(mx(d.火力))} 雷${b(mx(d.雷装))} 空${b(mx(d.对空))} 甲${b(mx(d.装甲))}`
      miscLine = `避${b(mx(d.回避))} 潜${b(mx(d.对潜))} 索${b(mx(d.索敌))} 运${b(mx(d.运))} · ${d.速力 >= 10 ? '高速' : '低速'}/${LENG_LABEL[d.射程] ?? '—'}`
    } else {
      const mx = (pair: number[] | undefined) => (Array.isArray(pair) ? pair[1] : '?')
      statsLine = `耐${b(mx(s.api_taik))} 火${b(mx(s.api_houg))} 雷${b(mx(s.api_raig))} 空${b(mx(s.api_tyku))} 甲${b(mx(s.api_souk))}`
      miscLine = `运${b(mx(s.api_luck))} · ${s.api_soku >= 10 ? '高速' : '低速'}/${LENG_LABEL[s.api_leng] ?? '—'} · 游戏基础数据`
    }
    return {
      title: entityNamePlain('ship', mstId, s.api_name),
      typeLabel: entityNamePlain('shipType', s.api_stype, mg.master.stypes[s.api_stype] ?? '舰娘'),
      media: shipThumbHtml(mstId, entityNamePlain('ship', mstId, s.api_name), { className: 'preview' }),
      lines: [
        `<span style="font-family:var(--mono);font-size:10px">${statsLine}</span>`,
        `<span style="font-family:var(--mono);font-size:10px">${miscLine}</span>`,
        instances.length ? `持有 ×${instances.length} · 最高 Lv ${maxLv}` : '未持有',
        `图鉴 No.${s.api_sortno}`,
      ],
      primary: '舰娘图鉴',
    }
  },
})

registerEntityRoute('mstEquip', {
  colorClass: 'e-equip',
  open(ref) {
    const mstId = ref.num
    if (!friendlyEquips.has(mstId)) return
    activateModule('ji')
    activeBook = 'equip'
    equipState.mode = 'catalog'
    equipState.selected = mstId
    equipState.open = true
    render()
  },
  targets: (ref) => {
    const mstId = ref.num
    const name = friendlyEquips.get(mstId)?.api_name ?? ''
    return [
      { label: '有关任务', run: () => searchInManager(name) },
      // 铨已装配：筛出身上装着这件装备的在籍舰
      { label: '装备中清单 · 舰娘列表', run: () => locateEquipHolders(mstId, name) },
    ]
  },
  peek(ref) {
    const mstId = ref.num
    const e = friendlyEquips.get(mstId)
    if (!e) return null
    const instances = equipInstancesOf(mstId)
    const dist = new Map<number, number>()
    for (const [, inst] of instances) dist.set(inst.level, (dist.get(inst.level) ?? 0) + 1)
    const distText = [...dist.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lv, n]) => `★${lv >= 10 ? 'M' : lv}×${n}`)
      .join(' ')
    // 属性行：非零属性全列（速览即可对比）。数值口径与 chip 共用
    // equipStatValues（局戦/陸戦 type2=48 的 houm/houk 是対爆/迎撃）；
    // 这里的 markup 与 chip 各是各的：速览不带 class、标签与数字之间不留空格。
    const stats = equipStatValues(e).map(({ label: shown, value }) => {
      return `${shown}<b style="color:${value > 0 ? 'var(--ok)' : 'var(--bad)'}">${value > 0 ? '+' : ''}${value}</b>`
    })
    if (e.api_leng) stats.push(`射程<b style="color:var(--text)">${LENG_LABEL[e.api_leng] ?? '—'}</b>`)
    if (e.api_distance > 0) stats.push(`半径<b style="color:var(--text)">${e.api_distance}</b>`)
    if (e.api_cost > 0) stats.push(`配置<b style="color:var(--text)">铝${e.api_cost}/机</b>`)
    // 装备中计数（含基地航空队——只查舰上会把陆航机体算成没在用），
    // 与抽屉同走 equippedInstIds：那份缓存本来就是舰上 + 陆航的并集
    const equippedIds = equippedInstIds()
    const equipped = instances.filter(([id]) => equippedIds.has(parseInt(id, 10))).length
    // 改修行：wikiwiki 改修表单基准 + akashi-list ★10 命中/火力亮点
    const eo = eoByEquip.get(mstId)
    // 多套方案的装备（二号舰组不同、开修日也不同）按全部方案的开修日并集数——只看第一套会少算
    const dayCount = new Set(
      ((eo?.improvement ?? []) as any[]).flatMap((imp) =>
        ((imp?.helpers ?? []) as any[]).flatMap((h) => h.days ?? []),
      ),
    ).size
    const remodel = akashiListLode?.data?.items?.[`${mstId}`]?.item_remodel
    const starHighlights = remodel
      ? Object.entries<any>(remodel)
          .filter(([, arr]) => Array.isArray(arr) && arr.length >= 10)
          .slice(0, 3)
          .map(([stat, arr]) => `${esc(stat)}${esc(arr[9])}`)
          .join(' ')
      : ''
    return {
      title: entityNamePlain('equip', mstId, e.api_name),
      typeLabel: `${entityNamePlain('equipType', Array.isArray(e.api_type) ? e.api_type[2] : 0, equipTypes.get(Array.isArray(e.api_type) ? e.api_type[2] : 0) ?? '装备')} · ${'★'.repeat(Math.min(e.api_rare ?? 0, 5)) || '—'}`,
      media: equipTypeIconHtml(Array.isArray(e.api_type) ? e.api_type[3] : 0, {
        className: 'hero-icon',
        title: entityNamePlain('equip', mstId, e.api_name),
      }),
      lines: [
        `<span style="font-family:var(--mono);font-size:10px">${stats.join(' ') || '无属性加成'}</span>`,
        instances.length
          ? `持有 ×${instances.length}${distText ? `（${distText}）` : ''} · 装备中 ${equipped}`
          : '未持有',
        eo?.improvement?.length
          ? `可改修 · 每周 ${dayCount} 天${starHighlights ? ` · ★10 ${starHighlights}` : ''}`
          : // 「表里没有」不等于「不可改修」：落在改修表覆盖范围之外的（刚实装的那些）
            // 只能说资料还没收录，替官方下「不可改修」这个结论是编（同抽屉里那一段）
            improvePackUncovered(
                Array.isArray(eoLode?.data) ? (eoLode!.data as EquipUpgradeRow[]) : null,
                mstId,
                improveCoverageMax,
              )
            ? '改修资料暂无收录'
            : '不可改修',
      ],
      primary: '装备图鉴',
    }
  },
})

registerEntityRoute('equipCapacity', {
  colorClass: 'e-equip',
  // 舰娘那格点进去是清理视图，装备这格原来进的是图鉴——图鉴回答不了
  // 「哪几件能拆」。两侧对称：都落在各自的在籍轴清理态。
  open: openEquipCleanup,
  peek() {
    const current = countCapacitySlotitems(mg.slotitems)
    const maximum = mg.basic?.maxSlotitems ?? 0
    return {
      title: '装备仓库',
      typeLabel: '容量',
      lines: [
        `当前 <b>${current}</b> / ${maximum || '—'}`,
        maximum ? `剩余 <b>${Math.max(0, maximum - current)}</b> 格` : '尚未同步容量上限 · 返港后同步',
      ],
      primary: '装备图鉴',
    }
  },
})

/** 查无此条的回执：进到对应那一卷，把话说在面板上（见 missNotice 的注释）。 */
const showMissNotice = (book: Book, text: string) => {
  missNotice = { book, text }
  activateModule('ji')
  activeBook = book
  render()
}

// 深海舰 / 海域 / 道具 也挂进链（其他模块的字段将来可直接互链过来）
registerEntityRoute('abyssShip', {
  colorClass: 'e-abys',
  open(ref) {
    const id = ref.num
    if (!abyssalShips.has(id)) {
      // 别写成「已随活动退役」——**深海舰不退役**。2026-08-25 拿真 start2 实测：
      // 历年活动限定的深海 boss（戦艦仏棲姫/欧州棲姫/深海鶴棲姫/防空埋護姫/
      // 深海雨雲姫/深海日棲姫，以及 56 条バカンスmode）在活动结束多年后原样都在，
      // 官方对 api_mst_ship 的深海段只增不删。会缩水的只有活动海域表。
      // 所以落到这里只可能是主数据还没到（abyssalShips 由 buildIndex 从 mst 现建）
      // 或者 id 本身不对，措辞照实取中性的那一档，与海域侧同一语义族。
      showMissNotice('abyss', '深海舰资料尚未就绪 · 稍后重试')
      return
    }
    missNotice = null
    activateModule('ji')
    activeBook = 'abyss'
    abyssState.selected = id
    abyssState.open = true
    render()
  },
  targets: (ref) => {
    const id = ref.num
    const seen = abyssSeenMaps(id)
    return [
      {
        label: '战绩 · 遭遇/击沉',
        run: () => {
          activateModule('ji')
          activeBook = 'abyss'
          abyssState.tab = 'ship'
          abyssState.selected = id
          abyssState.open = true
          render()
        },
      },
      seen.length
        ? { label: `出现海域 · ${seen.length} 张`, run: () => openMap(seen[0].map) }
        : { label: '出现海域', disabled: true, hint: '本地暂无当前深海舰遭遇记录' },
    ]
  },
  peek(ref) {
    const id = ref.num
    const s = abyssalShips.get(id)
    if (!s) return null
    const lines = [`ID ${id}${s.api_yomi && s.api_yomi !== '-' ? ` · ${esc(s.api_yomi)}` : ''}`]
    // 战绩与出现海域：Ctrl 钉住多张对比时，这两行才是能横向比的
    ensureAbyssKills()
    const k = abyssKills?.[id]
    if (k?.met) {
      lines.push(
        `遭遇 <b style="color:var(--text)">${k.met}</b> 艘次 · 击沉 <b style="color:#ff8b9a">${k.killed}</b>${
          k.withMask ? `（计入 ${k.withMask}）` : ''
        }`,
      )
    } else {
      lines.push('<span style="opacity:.6">暂无遭遇记录</span>')
    }
    const seen = abyssSeenMaps(id)
    if (seen.length) {
      lines.push(
        `出现于 ${seen
          .slice(0, 4)
          .map((m) => `${mapCodeOf(m.map)}×${m.n}`)
          .join(' ')}${seen.length > 4 ? ` 等 ${seen.length} 张` : ''}`,
      )
    }
    const stats = abyssalLode?.data?.[`${id}`]
    if (stats) {
      const b = (v: unknown) => `<b style="color:var(--text)">${v ?? '?'}</b>`
      lines.unshift(
        `<span style="font-family:var(--mono);font-size:10px">耐${b(stats.api_taik)} 火${b(stats.api_houg)} 雷${b(stats.api_raig)} 空${b(stats.api_tyku)} 甲${b(stats.api_souk)} 避${b(stats.kc3_evas)}*</span>`,
      )
    }
    return {
      title: entityNamePlain('abyssShip', id, s.api_name),
      typeLabel: entityNamePlain('shipType', s.api_stype, mg.master.stypes[s.api_stype] ?? '深海舰'),
      media: shipThumbHtml(id, entityNamePlain('abyssShip', id, s.api_name), { className: 'preview', abyss: true }),
      lines,
      primary: '深海图鉴',
    }
  },
})

// 打开海域抽屉（离线节点图 / 带路条件 / 确认掉落）
const openMap = (id: number) => {
  if (!mapInfos.some((m) => m.api_id === id)) {
    // 退役活动图**不是**「查不到」：账本的 event_map_catalog 在关服时把它固化下来，
    // 归档 IPC 一回来 mergeArchivedEventMaps 就把它并回 mapInfos，照常能开。
    // 落在这条分支上的绝大多数是启动后那段窗口期——归档排在几个资料包后面，
    // 还没轮到它。所以这里说的是「还在读」，不是「没有了」。
    pendingMapOpen = id
    showMissNotice('map', '海域资料读取中 · 稍后重试')
    return
  }
  pendingMapOpen = null
  missNotice = null
  activateModule('ji')
  activeBook = 'map'
  if (id !== mapState.selected) {
    mapState.personalNode = ''
    mapState.dropNode = ''
  }
  mapState.selected = id
  mapState.open = true
  mapState.difficulty = null
  if (mg.sortie?.active && !mg.sortie.practice && mapIdOf(mg.sortie.mapArea, mg.sortie.mapNo) === id) {
    mapState.fleetId = mg.sortie.deckId
  }
  render()
}

registerEntityRoute('map', {
  colorClass: 'e-map',
  open(ref) {
    openMap(ref.num)
  },
  peek(ref) {
    const id = ref.num
    const info = mapInfos.find((m) => m.api_id === id)
    if (!info) return null
    const lines = [
      entityNamePlain(
        'mapArea',
        info.api_maparea_id,
        mapAreas.get(info.api_maparea_id) ?? '',
      ),
    ]
    const bits = [
      info.api_level ? `海域 Lv ${info.api_level}` : '',
      // 计量条按 shared/map-gauge-metric 的手工表报，表里没有的图为空串（见海域卡处头注）
      mapGaugeSummaryText(id),
      info.api_max_maphp ? `血条 ${info.api_max_maphp}` : '',
    ].filter(Boolean)
    if (bits.length) lines.push(bits.join(' · '))
    const mini = miniMapSvg(`${info.api_maparea_id}-${info.api_no}`, id)
    return {
      title: `${info.api_maparea_id}-${info.api_no} ${entityNamePlain('map', id, info.api_name)}`,
      typeLabel: '海域',
      media: mini ?? undefined,
      lines,
      primary: '海域图鉴',
    }
  },
  targets: (ref) => {
    const id = ref.num
    return [
      { label: '确认掉落', run: () => openMap(id) },
      { label: '带路与节点图', run: () => openMap(id) },
    ]
  },
})

// 深海装备实体：原先只有列表行，没有路由 → Ctrl 左键无从挂载、也无法钉住对比
registerEntityRoute('abyssEquip', {
  colorClass: 'e-abys',
  open(ref) {
    const id = ref.num
    if (!abyssalEquips.has(id)) return
    activateModule('ji')
    activeBook = 'abyss'
    abyssState.tab = 'equip'
    abyssState.selected = id
    abyssState.open = true
    render()
  },
  peek(ref) {
    const id = ref.num
    const e = abyssalEquips.get(id)
    if (!e) return null
    const b = (v: unknown) => `<b style="color:var(--text)">${v}</b>`
    const stats = ABYSS_EQUIP_FIELDS.filter(([k]) => (e[k] ?? 0) !== 0)
      .map(([k, label]) => `${label}${b(e[k])}`)
      .join(' ')
    const holders = abyssEquipHolders(id)
    const lines = [
      `ID ${id} · ${esc(
        entityNamePlain(
          'equipType',
          Array.isArray(e.api_type) ? e.api_type[2] : 0,
          equipTypes.get(Array.isArray(e.api_type) ? e.api_type[2] : 0) ?? `分类${Array.isArray(e.api_type) ? e.api_type[2] : 0}`,
        ),
      )}`,
      stats
        ? `<span style="font-family:var(--mono);font-size:10px">${stats}</span>`
        : '<span style="opacity:.6">数值全为 0</span>',
      holders.length
        // abyssEquipHolders 的两个消费点都不翻译，原样出日文舰名。
        ? `${holders.length} 种深海舰搭载 · 最多的 ${elink('abyssShip', holders[0].id, holders[0].name)}`
        : '<span style="opacity:.6">资料中暂无搭载记录</span>',
    ]
    return {
      title: entityNamePlain('abyssEquip', id, e.api_name),
      typeLabel: '深海装备',
      media: equipTypeIconHtml(Array.isArray(e.api_type) ? e.api_type[3] : 0, {
        className: 'hero-icon abyss',
        title: entityNamePlain('abyssEquip', id, e.api_name),
      }),
      lines,
      primary: '深海装备图鉴',
    }
  },
  targets(ref) {
    const id = ref.num
    const holders = abyssEquipHolders(id)
    return [
      {
        label: '深海装备图鉴',
        run: () => {
          activateModule('ji')
          activeBook = 'abyss'
          abyssState.tab = 'equip'
          abyssState.selected = id
          abyssState.open = true
          render()
        },
      },
      holders.length
        ? { label: `搭载舰 · ${holders.length} 种`, run: () => navigate({ type: 'abyssShip', id: holders[0].id }) }
        : { label: '搭载舰', disabled: true, hint: '社区资料暂无记录' },
    ]
  },
})

const openItem = (id: number) => {
  if (!useitemMst.has(id)) return
  activateModule('ji')
  activeBook = 'item'
  itemState.selected = id
  itemState.open = true
  render()
}

registerEntityRoute('useitem', {
  colorClass: 'e-item',
  open(ref) {
    openItem(ref.num)
  },
  targets: (ref) => {
    const id = ref.num
    const name = useitemMst.get(id)?.api_name ?? ''
    return [
      { label: '相关任务', run: () => searchInManager(name) },
      // 资源系道具（桶/建造/开发/螺丝）有真目标：资源统计
      ...(MATERIAL_USEITEM[id] !== undefined
        ? [{ label: '资源统计', run: () => activateModule('zi') }]
        : []),
      // 改造需求反查：有需求队列就给直达目标，没有就给灰目标
      ...(remodelNeeds.get(id)?.length
        ? [{ label: `需求队列 · ${remodelNeeds.get(id)!.length} 项改造要用`, run: () => openItem(id) }]
        : [{ label: '需求队列', disabled: true, hint: '无改造用到它' }]),
    ]
  },
  peek(ref) {
    const id = ref.num
    const u = useitemMst.get(id)
    if (!u) return null
    const stock = useitemStock(id)
    return {
      title: entityNamePlain('item', id, u.api_name),
      typeLabel: '道具',
      media: useItemIconHtml(id, entityNamePlain('item', id, u.api_name), { className: 'hero' }),
      lines: [
        stock.known
          ? `持有 ×${stock.count} · ${USEITEM_STOCK_SOURCE[stock.source]}`
          : '尚未同步持有数量',
      ],
      primary: '道具图鉴',
    }
  },
})

registerModule({
  id: 'ji',
  title: '图鉴',
  order: 4,
  mount(el) {
    pane = el
    wireSectionFolding(el)
    // 鼠标侧键 = 返回/前进（跟浏览器同一副手感）；只在图鉴面板内生效。
    // 挂在 pane 上一次即可——pane 常驻，render 只重建它的子树。
    el.addEventListener('mouseup', (e) => {
      if (e.button === 3) {
        e.preventDefault()
        jiNavGoBack()
      } else if (e.button === 4) {
        e.preventDefault()
        jiNavGoForward()
      }
    })
    setRosterViewOpener(() => {
      activateModule('ji')
      activeBook = 'roster'
      render()
    })
    setStockViewOpener(() => {
      activateModule('ji')
      activeBook = 'stock'
      render()
    })
    const scheduleImprovementDayRollover = () => {
      if (improvementDayTimer) clearTimeout(improvementDayTimer)
      improvementDayTimer = setTimeout(() => {
        if (pane.classList.contains('active') && activeBook === 'equip' && equipState.mode === 'today') {
          render()
        }
        scheduleImprovementDayRollover()
      }, Math.max(1000, nextJstTime([0]) - Date.now() + 100))
    }
    scheduleImprovementDayRollover()
    // ---- 档案刚多了一份：如果玩家正看着那一页，当场重画 ----
    //
    // 用户 2026-08-23 报的那处账实不符：屋代的「立绘 · 中破」整张图渲染在页面上，
    // 它上面的格子却灰着。根因不在入档管道（六格同一秒全部落盘、图种闸门也没误拒），
    // 而在**入档之后没人让界面跟上**——`noteArtArchived` 那条「不主动重渲」的注释
    // 成文时入档只发生在游戏页那一侧，玩家不在图鉴上；「显示/播放即入档」把前提改了，
    // 入档恰恰发生在他盯着这一页的时候，于是界面停在入档前那一帧（实测卡在四格）。
    //
    // 两道性能闸门一个没松：`scheduleRender` 自己就管着「面板不 active 不画」
    // 与「手指按着时推迟」（memory/kanso-perf-architecture）。这里只多一层过滤：
    // 只有**正在看的那个形态**才值得重画，别让后台入档把整个图鉴刷起来。
    const onArchiveLit = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; mstId?: number }>).detail
      const mstId = Number(detail?.mstId) || 0
      const showing =
        abyssState.open ? abyssState.selected : shipState.open ? shipState.selectedForm : 0
      if (!showing) return
      // mstId 为 0 = 存的时候还不知道归属（语音档案的「先收后认」），保险起见重画一次。
      // 衣装那一份记在**构图编号**下（5xxx/6xxx），要先换算回它属于哪个形态，
      // 否则玩家正看着的那一页刚入档一套衣装，这里会当成「别人的事」不重画。
      if (mstId && mstId !== showing && costumeOwnerOf(mstId) !== showing) return
      scheduleRender()
    }
    document.addEventListener('kanso:archive-lit', onArchiveLit)
    trackMountCleanup(() => document.removeEventListener('kanso:archive-lit', onArchiveLit))
    // ---- 玩家在钥里清了「官方没有」台账：那些格子该回到可探测态 ----
    //
    // 清理只可能由他自己按出来（钥里那个钮），所以这里没有轮询也不需要节流；
    // `scheduleRender` 自带的两道闸门（面板不 active 不画、手指按着时推迟）照旧管着。
    // 与上面那条不同的是**不按形态过滤**：清掉的是整整一个月的记录，跨多少艘舰不知道。
    // ---- 衣装归属刚学到新的：立绘页的衣装段该跟着变 ----
    // 与上面那条同理，只是不按形态过滤：一份图鉴报文一次带来几十条归属，
    // 跨多少艘舰不知道。`scheduleRender` 自带的两道闸门照旧管着。
    const onCostumesChange = () => scheduleRender()
    document.addEventListener('kanso:ship-costumes-change', onCostumesChange)
    trackMountCleanup(() =>
      document.removeEventListener('kanso:ship-costumes-change', onCostumesChange),
    )
    const onVoiceAbsentChange = () => scheduleRender()
    document.addEventListener('kanso:voice-absent-change', onVoiceAbsentChange)
    trackMountCleanup(() =>
      document.removeEventListener('kanso:voice-absent-change', onVoiceAbsentChange),
    )
    void ensureFirstEncounters()
    onFirstEncountersChange(() => {
      if (pane.classList.contains('active')) render()
    })
    void (async () => {
      const raw = await queryMasterRaw()
      if (raw) {
        masterTs = raw.ts
        mst = raw.data
        buildIndex()
        mergeArchivedEventMaps()
        setShipGraph(raw.data?.api_mst_shipgraph ?? [])
        setShipImageGraph(raw.data?.api_mst_shipgraph ?? [])
      }
      ;[
        abyssalLode,
        eoLode,
        akashiListLode,
        kcwikiLode,
        fcdMapLode,
        wikiwikiRemodelLode,
        devRecipeLode,
        buildRecipeLode,
        shipStatsLode,
        shipProfileLode,
      ] = await Promise.all([
        queryLode('abyssal-stats'),
        queryLode('equip-improve'),
        queryLode('akashi-list'),
        queryLode('kcwiki-ships'),
        queryLode('poi-fcd-map'),
        queryLode('wikiwiki-remodel'),
        queryLode('dev-recipes'),
        queryLode('build-recipes'),
        queryLode('ship-stats'),
        queryLode('wikiwiki-ship-profile'),
      ])
      // 端点的**值**统一由 fleet-calc 持有（面板反推与图鉴三维上限共用一份，
      // 免得两处各拉一份各自失效）；这里那一份只用来给来源脚注取 meta。
      ensureShipStatsLode(() => {
        if (pane?.isConnected) render()
      })
      // 收容库履历里的点位字母。上面已经把 poi-fcd-map 拉进 fcdMapLode 了，
      // 但那份是海图卡自己的；文案层走公用的那本（queryLode 按 id 缓存，不多下一次）
      ensureMapCellLetters(() => {
        if (pane?.isConnected) render()
      })
      shipProfileByMst = new Map()
      for (const entry of Object.values<any>(shipProfileLode?.data ?? {})) {
        if (Number(entry?.shipId) > 0) shipProfileByMst.set(Number(entry.shipId), entry)
      }
      await initMapIntel()
      ;[routingLode, wikiwikiRoutingLode, kcnavRoutingLode] = await Promise.all([
        queryLode('kcwiki-routing'),
        queryLode('wikiwiki-routing'),
        queryLode('kcnav-routing'),
      ])
      loadEventArchives()
      // 深海战绩不在这里预拉：ensureAbyssKills 才是它的状态机（在途/脏标记/失败
      // 都记在那儿），这里再来一份就是绕过它——并发覆盖，且初始 render 不看
      // 当前是不是深海卷。第一次要用到时（abyssRecordHtml / peek）自会去拉。
      eoByEquip = new Map()
      improveCoverageMax = 0
      if (Array.isArray(eoLode?.data)) {
        // 改修事实表就是底座，装配时**不再叠任何校正层**：逐件裁过的那几案与按机制
        // 通则补齐的那批，在合成事实表时就已经吃进去了（见 scripts/build-equip-improve）。
        // 每一行自带 `basis` 说明这一格现在有多硬，角标照它挂。
        for (const entry of eoLode!.data) eoByEquip.set(entry.eq_id, entry)
        improveCoverageMax = improvePackCoverageMax(eoLode!.data as EquipUpgradeRow[])
      }
      // 台词包（日中对照）：只在图鉴模块用，按需加载
      void queryLode('wikiwiki-item-exchange').then((pack) => {
        itemExchangeLode = pack
        if (itemState.open) render()
      })
      void Promise.all([
        queryLode('kcwiki-voice'),
        queryLode('kcwiki-seasonal-voice'),
        queryLode('wikiwiki-voice'),
        queryLode('wikiwiki-abyss-voice'),
        queryLode('subtitle-zh'),
        queryLode('subtitle-ja'),
        queryLode('subtitle-enemies'),
        queryLode('kcwiki-fit-bonus'),
        queryLode('kanso-voice'),
        queryLode('subtitle-npc'),
      ]).then(([v, sv, w, a, z, j, e, f, kv, npc]) => {
        voiceLode = v
        seasonalVoiceLode = sv
        wikiwikiVoiceLode = w
        wikiwikiAbyssVoiceLode = a
        subtitleZh = z
        subtitleJa = j
        subtitleEnemiesLode = e
        kansoVoiceLode = kv
        // 分组与排序在这里算一次，逐行渲染只查表（与下面那三类校正同一条纪律）
        npcVoiceGroups = buildNpcVoiceBook(npc?.data ?? null)
        // 归属/槽位/文本三类校正**在这里算一次**，渲染只查表。
        // 少一个包就少一个判据（形态码表缺了就退化成「谁都不挪」），不报错也不硬撑。
        correctedVoiceRows = planVoiceCorrections({
          voice: voiceLode?.data ?? null,
          subtitleJa: subtitleJa?.data ?? null,
          subtitleZh: subtitleZh?.data ?? null,
          seasonalShips: seasonalVoiceLode?.data?.ships ?? null,
          codeMap: kcwikiLode?.data ? buildShipFormCodeMap(kcwikiLode.data) : null,
        }).rowsByForm
        abyssSubtitleByMst = new Map()
        for (const [key, raw] of Object.entries<any>(subtitleEnemiesLode?.data ?? {})) {
          const entries = Array.isArray(raw) ? raw : [raw]
          for (const line of entries) {
            const fallbackId = resolveAbyssalName(`${line?.name ?? ''}`)
            const localizedId = Number(localizedEntityId('abyssShip', line?.name))
            const resolvedId = Number.isInteger(localizedId) && localizedId >= 1_500
              ? localizedId
              : fallbackId
            const canonical = resolvedId ? abyssalShips.get(resolvedId)?.api_name : ''
            if (!canonical) continue
            const candidates = [...abyssalShips]
              .filter(([, candidate]) => candidate.api_name === canonical)
              .map(([candidateId]) => candidateId)
              .sort((left, right) => left - right)
            const embeddedAnchor = candidates.find((candidateId) => {
              if (candidateId >= 2_000) return key.includes(`${candidateId}`)
              const resourceId = `${candidateId - 1_000}`
              return key.includes(resourceId.padStart(4, '0')) || key.includes(resourceId)
            })
            const anchor = embeddedAnchor ?? resolvedId
            if (anchor == null || !candidates.includes(anchor)) continue
            const exactIds = [anchor]
            for (let next = anchor + 1; candidates.includes(next); next++) exactIds.push(next)
            for (const candidateId of exactIds) {
              const known = abyssSubtitleByMst.get(candidateId) ?? []
              const entry = {
                key,
                ja: `${line?.jp ?? ''}`.trim(),
                zh: `${line?.zh ?? ''}`.trim(),
              }
              if (!known.some((item) => item.key === key && item.ja === entry.ja)) known.push(entry)
              abyssSubtitleByMst.set(candidateId, known)
            }
          }
        }
        voiceZhByJa = buildVoiceTranslationIndex(
          (subtitleJa?.data ?? {}) as Record<string, Record<string, string>>,
          (subtitleZh?.data ?? {}) as Record<string, Record<string, string>>,
        )
        // 两层第一方台账在**加载时**依次叠上去：不改 CC 包文件，也不让消费端各自记得去叠。
        //   ① 修正台账：上游那几行的数错了 —— 自失效判据是「被盯的行变了没」；
        //   ② 自补层：上游整件没收 —— 自失效判据反过来，是「上游开始收这件了没」。
        // 两层都宁可跳过并告警，也不拿一份过期的东西去改一个已经变了样的东西。
        fitLode = f?.data
          ? {
              meta: f.meta,
              data: applyFitBonusSupplement(
                applyFitBonusCorrections(f.data as FitBonusData, (correction, reason, detail) => {
                  console.warn(
                    `[kanso] 装备加成修正作废：${correction.equipId} ${correction.equipName}（${reason}）${detail}`,
                  )
                }).data,
                (entry, reason, detail) => {
                  // `empty` 是本来就没规则的条目（确认无 / 整件挂牌），不是异常，不吵
                  if (reason !== 'recall') return
                  console.warn(
                    `[kanso] 装备加成自补条目召回复审：${entry.equipId} ${entry.equipName}（${reason}）${detail}`,
                  )
                },
              ).data,
            }
          : null
        render()
      })
      kcwikiByMst = new Map()
      if (kcwikiLode?.data) {
        for (const entry of Object.values<any>(kcwikiLode.data)) {
          if (entry?.ID) kcwikiByMst.set(entry.ID, entry)
        }
      }
      buildRemodelNeeds()
      render()
    })().catch((error: unknown) => {
      // 这条链上十来个 queryLode / initMapIntel，任一 reject 就在那一行断掉：
      // 后面的索引再也不建，模块只显示半截，而 mountModule 早已把 mount 算成功。
      // 记一笔才有痕迹——否则正是「隔离做完之后冒烟一片绿」的那个盲区。
      recordCrash('ji:mount-atlas-data', error)
      console.warn('[kanso] 图鉴资料装配中断，部分内容将缺失', error)
    })
    onMgChange((keys) => {
      // 只推进代号，不清空：正开着的「收容库」继续显示手上这份，新的到了静默换上
      if (keys.some((k) => ['ships', 'sortie'].includes(k))) shipMemorialGeneration += 1
      // 仓库卷的行缓存要跟着这三样走：装备本身、装备的去处（舰上）、陆航的格子。
      // 少一样就会出现「刚卸下来的装备还显示装在舰上」。
      if (keys.some((k) => ['slotitems', 'ships', 'airBases'].includes(k))) {
        invalidateStockRows()
        invalidateEquippedInstIds()
        refreshStockView()
      } else if (keys.some((k) => ['furnitures', 'basic'].includes(k))) {
        // 仓库卷的装饰品视图读的是 mg.furnitures 与 basic 的家具币/布局——
        // 这两样变了行缓存并没受影响（那是装备的），但清单得重画，
        // 否则刚买的家具、刚花掉的家具币要等下一次装备变动才跟上。
        refreshStockView()
      }
      if (keys.includes('sortie')) {
        mapForecastState.key = ''
        // 退避名单挂在 sortie 上，而队伍侧（舰数/舰种/索敌/速力）现在按扣掉退避的人算。
        // 重算一次是毫秒级，漏失效则是「按一支已经不存在的舰队报路线」，宁可多清。
        resetRoutingBaseCache()
        abyssKillsStale = true // 战绩随遭遇变化，下次用到时重拉
        if (mg.sortie && !mg.sortie.practice) {
          invalidateMapChronicle(mapIdOf(mg.sortie.mapArea, mg.sortie.mapNo))
        }
      }
      if (keys.includes('master')) {
        void (async () => {
          const raw = await queryMasterRaw()
          if (raw) {
            masterTs = raw.ts
            mst = raw.data
            buildIndex()
            mergeArchivedEventMaps()
            setShipGraph(raw.data?.api_mst_shipgraph ?? [])
            setShipImageGraph(raw.data?.api_mst_shipgraph ?? [])
          }
          render()
          loadEventArchives()
        })().catch((error: unknown) => {
          // 主数据重取失败不该静默：索引会停在旧的一份，界面看着正常却不再跟游戏走
          recordCrash('ji:master-refresh', error)
          console.warn('[kanso] 主数据重取失败，索引仍停在上一份', error)
        })
      } else if (keys.some((k) => ['ships', 'slotitems', 'decks', 'useitems', 'materials', 'basic', 'eventAreas', 'sortie', 'mapGauges'].includes(k))) {
        // 在籍归并/持有数/道具所持联动。必须合并到同一帧：materials 每场战斗都推，
        // 而同步 render 会在游戏线程上把整张海域预测（带路 DFS + 逐点战斗模拟）
        // 重跑一遍——那些计算跟 materials 一个字的关系都没有。
        scheduleRender()
      }
    })
  },
  onShow: () => render(),
})
