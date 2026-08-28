// 钦 (Qn) · 任务：顶部分类与周期筛选 + 全宽任务列表 + 侧滑详情。
// 数据单基准：任务文本/前置链/报酬 = 简中任务库 quests-scn（zh.kcwiki 任务页直取）；
// 进行状态/粗档进度 = 游戏 questlist 被动观测；
// 精确计数与编成条件 = 铭的计数引擎（艦素自研为主，kcwiki/poi 两个 MIT 源补位）——
// 本地事件流计数，与服务器进度可能有出入，游戏自报粗档并列展示作对照。
import type { Quest } from '../../shared/mg-types'
import { QP_BLOCK_TEXT, QP_RANK_NAME, qpTaskGroups } from '../../shared/qp-types'

import {
  esc,
  exitWithMotion,
  fmtDurationLong,
  fmtTime,
  commitPaneHtml,
  lodeCreditMark,
  mg,
  onMgChange,
  deferWhilePressed,
  forgetCommittedHtml,
  onQpChange,
  onTick,
  openQuestTreeWindow,
  queryLode,
  queryFleetCheck,
  queryMasterRaw,
  queryQp,
  trackMountCleanup,
  updateCountdowns,
} from '../kernel'
import { elink, elinkHtml, navigate, registerEntityRoute } from '../link'
import { entityNameHtml, entityNamePlain, entityTermHtml, registerLocalizedName } from '../localization'
import { furnitureIconHtml, materialIconHtml, shipThumbHtml, useItemIconHtml } from '../entity-art'
import { equipTypeIconHtml } from '../equip-icon'
import { activateModule, registerModule } from '../mu'
import {
  buildQuestChainTree,
  countQuestChainDescendants,
  inferCompletedQuestCodes,
} from '../quest-chain-tree'
import { isShipFamilyOwned } from '../ship-ownership'
import { buildQuestAvailability } from '../../shared/quest-availability'
import type { QuestVerdict } from '../../shared/quest-availability'
import { mergeQuestPre } from '../../shared/quest-pre-merge'
import type { MergedQuestPre, WwQuestPre } from '../../shared/quest-pre-merge'
import { QUEST_PRE_ARBITRATION } from '../../shared/quest-pre-arbitration'
import { questPreSourceNoteHtml } from '../quest-pre-note'
import { KCWIKI_EQUIP_ALIAS, KCWIKI_ITEM_ALIAS } from '../../shared/kcwiki-upgrade'
import { buildShipClassNameIndex } from '../../shared/ship-class-name'
import type { ShipClassNameRow } from '../../shared/ship-class-name'
import {
  isResourceMirrorUseitem,
  resolveUseitemStock,
  type UseitemStock,
} from '../../shared/useitem-stock'
import {
  parseQuestRewardItems,
  questFixedRewardText,
  questRewardChoiceGroups,
  type RewardParseContext,
  type RewardStockCandidate,
} from '../../shared/quest-reward'
import { buildShipRemodelChains } from '../../shared/ship-remodel-chain'
import type { RemodelChainShip } from '../../shared/ship-remodel-chain'
import {
  cleanQuestText,
  emphasisMarks,
  mergeQuestMarks,
  renderQuestMarks,
  spreadMarksToQuotes,
} from '../../shared/quest-emphasis'
import type { QuestMark } from '../../shared/quest-emphasis'
import {
  allowTaskEquipTypeAlias,
  allowTaskShipAlias,
  allowTaskShipTypeAlias,
  excludeTaskHitsCoveredByAliases,
  hasUncoveredTaskPhrase,
  markTaskEntityHits,
  matchTaskEntityHits,
  matchTaskNationalityHits,
  matchedTaskEntities as matchedEntities,
  normalizeTaskEntityText as normalizeEntityText,
  rangesOverlap,
  simplifyTaskEntityText as simplifyJp,
  TASK_SHIP_TEXT_ALIASES,
  taskEntityAliasRanges,
  taskEntityMemoText,
  taskEntityTextDomainAllowed,
} from '../task-entity-match'

import type { EntityTarget } from '../link'
import type {
  QuestChainBranch,
  QuestChainEntry,
  QuestChainForest,
} from '../quest-chain-tree'

import type { LodeMeta } from '../kernel'
import type { QpFleetCheck, QpState, QpStockGoal, QpTask } from '../../shared/qp-types'
import { isEventMapArea, mapCodeOf } from '../../shared/map-id'

interface LibQuest {
  id: number
  code: string
  name: string
  desc: string
  memo: string
  memo2: string
  /** 双源合并后的现行前置（判定与任务链都用它）；口径见 shared/quest-pre-merge */
  pre: string[]
  /** 合并明细：kcwiki/wikiwiki 各自口径、冲突与悬空码，供详情如实展示 */
  preInfo?: MergedQuestPre
}

let pane: HTMLElement
const { ipcRenderer: qnIpc } = require('electron')
let scnLode: { meta: LodeMeta; data: any } | null = null
let lib: Map<number, LibQuest> = new Map()
let libByCode: Map<string, LibQuest> = new Map()
let useitemNames: Map<number, string> = new Map() // 奖励道具关联用
interface EntityNameIndex {
  id: number
  name: string
  simple: string
  aliases: string[]
}
interface ShipNameEntry extends EntityNameIndex {
  ctype: number
  stype: number
  sortNo: number
  members: number[]
}
interface ShipClassEntry extends EntityNameIndex {
  members: ShipNameEntry[]
}
let shipNameIndex: ShipNameEntry[] = [] // 关联舰娘反查（根形态聚合全部改造名）
let shipClassIndex: ShipClassEntry[] = [] // 舰级 → 姊妹舰
let shipTypeIndex: EntityNameIndex[] = []
let equipNameIndex: EntityNameIndex[] = []
let equipTypeIndex: EntityNameIndex[] = []
let itemNameIndex: EntityNameIndex[] = []
let mapNameIndex: EntityNameIndex[] = []
let missionNameIndex: EntityNameIndex[] = []
// 家具（装饰品）名 → 奖励识别。只对奖励文本（memo）匹配，不进正文/条件反查
let furnitureNameIndex: EntityNameIndex[] = []
let mapIds: Set<number> = new Set() // 海域反查（api_id = 区×10+号）
let equiptypeNames: Map<number, string> = new Map() // 装备分类名（api_mst_slotitem_equiptype）
// 索引重建代号：吃索引的派生缓存（奖励装备图标、更多筛选计数）按它失效
let entityIndexVersion = 0
let qp: QpState | null = null // 精确计数（铭引擎镜像）
let fleetCheck: QpFleetCheck = {} // 编成条件实时判定：questId → 哪几支舰队满足
// 上一次读取编成判定失败了没有。留着是为了**不清空** fleetCheck：手上那份继续
// 显示，只在上面如实说它可能过时。清空等于把正看着的检查区打回加载态，
// 而下一次编队变动多半就又好了。
// 只留成败，不留异常原文——JS 的 error.message 一律不上屏（2026-08-20 文案裁定），
// 原文进 console。
let fleetCheckFailed = false
// 「更多筛选」8 个计数与 qp / 编成判定同步失效（它们不进 rowsCacheKey）
let quickCountEpoch = 0

const SHIP_TYPE_ALIASES: Record<number, string[]> = {
  1: ['海防'], 2: ['驱逐'], 3: ['轻巡'], 4: ['雷巡'], 5: ['重巡'], 6: ['航巡'],
  7: ['轻母', '轻型航母'], 8: ['高速战舰'], 9: ['低速战舰'], 10: ['航战', '航空战舰'],
  11: ['空母', '正航', '正规空母'], 12: ['超弩级战舰'], 13: ['潜艇', '潜水舰'], 14: ['潜母'],
  16: ['水母'], 17: ['扬陆舰'], 18: ['装母', '装甲空母'], 19: ['工作舰'],
  20: ['潜水母舰'], 21: ['练巡'], 22: ['补给舰'],
}

const SHIP_TYPE_LABELS: Record<number, string> = {
  8: '高速战舰',
  9: '低速战舰',
}

const SHIP_TYPE_GROUPS = {
  battleship: { label: '战舰', ids: [8, 9, 10, 12] },
  carrier: { label: '空母系', ids: [7, 11, 18] },
} as const

const SHIP_TYPE_GENERIC_ALIASES: Record<number, Set<string>> = {
  8: new Set(['战舰']),
  9: new Set(['战舰']),
  11: new Set(['空母']),
}

const EQUIP_TYPE_ALIASES: Record<number, string[]> = {
  1: ['小口径炮'], 2: ['中口径炮'], 3: ['大口径炮'], 4: ['副炮'], 5: ['鱼雷'],
  6: ['舰战'], 7: ['舰爆'], 8: ['舰攻'], 9: ['舰侦'], 10: ['水侦'], 11: ['水爆'],
  12: ['小型电探', '电探'], 13: ['大型电探', '电探'], 14: ['声呐', '水听'], 15: ['爆雷'],
  21: ['机枪', '对空机枪'], 24: ['大发', '登陆艇'], 25: ['旋翼机'], 26: ['反潜机'],
  41: ['大艇', '大型飞行艇'], 45: ['水战'], 47: ['陆攻'], 48: ['陆战'], 49: ['陆侦'],
}

const EQUIP_TYPE_GENERIC_ALIASES: Record<number, Set<string>> = {
  12: new Set(['电探']),
  13: new Set(['电探']),
}

const refreshFleetCheck = async () => {
  try {
    fleetCheck = await queryFleetCheck()
    fleetCheckFailed = false
  } catch (error) {
    // 失效不丢数据：旧结论留着显示，失败本身摆到检查区里说，不静默吞
    console.warn('[kanso] qn: 编成条件读取失败', error)
    fleetCheckFailed = true
  }
  quickCountEpoch += 1
}

// 出击中 ships 每次伤害回写都会 patch，直接跟着查会打出一串 IPC 且后发先至。
// 350ms 去抖，只认最后一次。
let checkTimer: ReturnType<typeof setTimeout> | null = null
const scheduleFleetCheck = () => {
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = setTimeout(() => {
    void refreshFleetCheck().then(() => {
      if (pane?.classList.contains('active')) render()
    })
  }, 350)
}

const entityAliases = (
  domain: 'ship' | 'equip' | 'map' | 'item' | 'shipType' | 'equipType' | 'expedition',
  id: number,
  original: string,
  extra: string[] = [],
) =>
  [...new Set([original, entityNamePlain(domain, id, original), ...extra].map(normalizeEntityText).filter(Boolean))]
    .sort((a, b) => b.length - a.length)

// ---- 任务可用性：做完了 / 接得了 / 还差什么 ----
//
// 判据在 shared/quest-availability（有行为测试），这里只负责喂数据并缓存。
// 全库唯一一份，鉴的「有关任务」直接取这里的结论——两处各判一次迟早说法打架。
//
// 缓存键带上 questsTs 与库大小：任务表一变就重算，别拿着上一次的结论。
let verdictCache: { key: string; map: Map<number, QuestVerdict> } | null = null

export const questVerdicts = (): Map<number, QuestVerdict> => {
  // 键带上游戏日（05:00 JST 界）：跨期那一刻快照没变但结论该变——
  // 周期任务的 done 要对齐「快照还在不在本期」，缓存不能活过一个游戏日
  const gameDay = Math.floor((Date.now() + 4 * 3600 * 1000) / 86_400_000)
  const key = `${mg.questsTs ?? 0}:${mg.questsFullTs ?? 0}:${mg.questActiveTs ?? 0}:${lib.size}:${gameDay}`
  if (verdictCache?.key === key) return verdictCache.map
  const map = buildQuestAvailability({
    entries: lib.values(),
    observed: new Map(Object.values(mg.quests).map((quest) => [quest.no, quest.state])),
    activeIds: mg.questActiveIds,
    // 只有 tab 0「全部」那一次是全量。分类页当全集会把没翻到的全判成「不能接」。
    authoritative: mg.questsFullTs != null,
    // 周期任务跨期对齐：全量快照属于上一期时，done 退 unknown（判不了本期）
    observedTs: mg.questsFullTs,
    now: Date.now(),
  })
  verdictCache = { key, map }
  return map
}

/** code → 库条目，供「缺哪条前置」翻成人话。 */
export const questByCode = (code: string): LibQuest | undefined => libByCode.get(code)

// 实体 ↔ 任务联动：与任务详情共用同一套领域规则，不再用裸 includes 反查。
export const questsMentioning = (
  terms: string[],
  domain: 'ship' | 'equip' | 'item' = 'item',
): LibQuest[] => {
  const aliases = [...new Set(terms.map(normalizeEntityText).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
  if (!aliases.length) return []
  const entry: EntityNameIndex = { id: 0, name: terms[0] ?? '', simple: aliases[0], aliases }
  const minLength = domain === 'equip' ? 3 : 2
  return [...lib.values()].filter((quest) => {
    const text = `${quest.name} ${quest.desc} ${taskEntityMemoText(quest.memo2)}`
    return matchTaskEntityHits([entry], text, minLength, {
      allowQuotedSingle: domain === 'ship',
      acceptAlias: domain === 'ship' ? allowTaskShipAlias : undefined,
    }).length > 0
  })
}

// 「可从未完成任务获得」（05 稿）：只认奖励栏命中，不认任务文本随口一提。
// state 语义要说准——mg.quests 是你实际翻到过的任务列表快照的并集：
//   3 = 已达成待交付 / 1,2 = 在列表里未完成 / null = 不在快照里（已交付、未解锁，或没翻到那页）
// 最后一档不能当成「未完成」，那是猜的。
export interface QuestAward {
  id: number
  code: string
  name: string
  reward: string // memo 去掉「奖励:」前缀
  state: number | null
}

// overshadow：把本名当子串包住的更长实体名。两次实锤:「开发资材」吃掉
// 「新型喷进装备开发资材」的 7 条任务;「秋水」认领 B153 的「試製 秋水」
// (2026-08-11 用户抓的——装备不兴字节命中)。所以除调用方显式传入的名单外,
// 一律自动把**装备+道具全名册里包含查询名的更长名字**先挖掉再判。
// 挖掉时用哨兵符占位,不能用空串——拼接残片会凭空造出新的命中。
let awardMaskNames: string[] | null = null
const awardMaskInventory = (): string[] => {
  if (awardMaskNames) return awardMaskNames
  const out = new Set<string>()
  const put = (name: string) => {
    const clean = `${name ?? ''}`.trim()
    if (!clean) return
    out.add(clean)
    out.add(simplifyJp(clean))
    // 「試製 秋水」这类带空格的官方名,奖励文本里两种写法都见过
    const tight = clean.replace(/\s+/g, '')
    if (tight !== clean) {
      out.add(tight)
      out.add(simplifyJp(tight))
    }
  }
  for (const [idText, item] of Object.entries<any>(mg.master.slotitems)) {
    put(item?.name)
    put(entityNamePlain('equip', parseInt(idText, 10), `${item?.name ?? ''}`))
  }
  for (const [id, name] of useitemNames) {
    put(name)
    put(entityNamePlain('item', id, name))
  }
  awardMaskNames = [...out]
  return awardMaskNames
}
// 只在本模块的索引重建处调用（无跨模块消费者，所以不导出）
const invalidateAwardMask = () => {
  awardMaskNames = null
}
export const questsAwarding = (terms: string[], overshadow: string[] = []): QuestAward[] => {
  const normalized = terms.filter(Boolean).flatMap((t) => [t, simplifyJp(t)])
  if (!normalized.length) return []
  const longer = new Set<string>(overshadow)
  for (const name of awardMaskInventory()) {
    if (normalized.some((t) => name !== t && name.length > t.length && name.includes(t))) longer.add(name)
  }
  const maskList = [...longer].sort((a, b) => b.length - a.length)
  const mask = (memo: string) => maskList.reduce((s, n) => s.split(n).join('\u0000'), memo)
  return [...lib.values()]
    .filter((q) => {
      const m = maskList.length ? mask(q.memo) : q.memo
      return normalized.some((t) => m.includes(t))
    })
    .map((q) => ({
      id: q.id,
      code: q.code,
      name: q.name,
      reward: q.memo.replace(/^奖励[:：]?\s*/, ''),
      state: mg.quests[q.id]?.state ?? null,
    }))
}

// 基础四资源(燃弹钢铝)不在任务库的奖励文本里——每条任务的数值只存在于游戏
// questlist 的 api_get_material,因此只对你同步过的任务可知(2026-08-12 用户报出
// 钢材页只有 3 条文本命中,而几乎所有任务都发钢材)。按材料下标反查,金额降序。
export const questsAwardingMaterial = (materialIndex: number): QuestAward[] =>
  Object.values(mg.quests)
    .filter((quest) => (quest.getMaterial?.[materialIndex] ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.getMaterial?.[materialIndex] ?? 0) - (a.getMaterial?.[materialIndex] ?? 0),
    )
    .map((quest) => {
      const entry = lib.get(quest.no)
      return {
        id: quest.no,
        code: entry?.code ?? `#${quest.no}`,
        name: entry?.name ?? quest.title,
        reward: `×${quest.getMaterial?.[materialIndex] ?? 0}`,
        state: quest.state,
      }
    })

// 任务号 → 「代号 名称」（鉴的道具履历归因用；库里没有就返回 null，不编）
export const questName = (id: number): string | null => {
  const q = lib.get(id)
  return q ? `${q.code} ${q.name}` : null
}

// 在管理器里按关键词检索（实体右键「有关任务」目标）
export const searchInManager = (term: string) => {
  activateModule('qn')
  state.status = 'all'
  state.category = null
  state.period = null
  state.quick = null
  state.search = simplifyJp(term)
  render()
}

const state = {
  search: '',
  status: 'active' as 'active' | 'done' | 'unaccepted' | 'completed' | 'current' | 'all',
  category: null as string | null,
  period: null as string | null,
  quick: null as string | null,
  showQuick: false,
  selected: null as number | null,
}

// ---- code 解码：类别字母 + 周期 ----

const CAT_META: Record<string, [string, string]> = {
  A: ['编成', 'var(--ok)'],
  B: ['出击', '#e06c75'],
  C: ['演习', '#5ab8d8'],
  D: ['远征', '#8fb8e0'],
  E: ['补给·入渠', '#c9a86a'],
  F: ['工厂', '#a08a6a'],
  G: ['改装', '#b489ff'],
  S: ['限时', 'var(--gold)'],
}

const catOf = (code: string) =>
  code.match(/[A-Z]/g)?.find((letter) => CAT_META[letter]) ?? '其'
const catColor = (code: string) => CAT_META[catOf(code)]?.[1] ?? 'var(--accent-dim)'

const periodOf = (code: string): [string, string] => {
  const marker = code.charAt(1).toLowerCase()
  if (marker === 'd') return ['日', 'd']
  if (marker === 'w') return ['周', 'w']
  if (marker === 'm') return ['月', 'm']
  if (marker === 'q') return ['季', 'q']
  if (marker === 'y') return ['年', 'o']
  return ['单', 'o']
}

const annualMonthOf = (text: string): number | null => {
  const match =
    `${text ?? ''}`.match(/年常任务[（(]\s*(1[0-2]|[1-9])\s*月[）)]/) ??
    `${text ?? ''}`.match(/(?:^|\D)(1[0-2]|[1-9])\s*月年常/)
  const month = Number(match?.[1] ?? 0)
  return month >= 1 && month <= 12 ? month : null
}

// ---- 重置倒计时（JST 05:00 口径）----

const JST = 9 * 3600 * 1000

const nextReset = (
  kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual',
  annualMonth?: number | null,
): number => {
  const now = new Date(Date.now() + JST)
  const next = new Date(now)
  next.setUTCHours(5, 0, 0, 0)
  if (kind === 'daily') {
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  } else if (kind === 'weekly') {
    // 周一 05:00 JST
    while (next.getUTCDay() !== 1 || next <= now) next.setUTCDate(next.getUTCDate() + 1)
  } else if (kind === 'monthly') {
    next.setUTCDate(1)
    if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1)
  } else if (kind === 'quarterly') {
    // 季任：3/6/9/12 月 1 日
    next.setUTCDate(1)
    while (next <= now || ![2, 5, 8, 11].includes(next.getUTCMonth())) {
      next.setUTCMonth(next.getUTCMonth() + 1)
      next.setUTCDate(1)
    }
  } else {
    const resetMonth = annualMonth && annualMonth >= 1 && annualMonth <= 12 ? annualMonth - 1 : null
    if (resetMonth == null) return Number.POSITIVE_INFINITY
    next.setUTCMonth(resetMonth, 1)
    if (next <= now) next.setUTCFullYear(next.getUTCFullYear() + 1)
  }
  return next.getTime() - JST
}

// ---- 报酬关键词 → 图标 ----

// 全部图标化（2026-08-17 用户点的：列表奖励框里好多还是一个字）。
// kind：material = 随包 poi 资材图；useitem = 官方卡面（44 家具币/家具箱小走
// 内建兜底）；furniture = 屋形类别图标（具体家具没有独立美术）。
// 顺序即展示序，最多 4 枚——资源类在前维持旧观感。
const REWARD_ICONS: [RegExp, 'material' | 'useitem' | 'furniture', number, string][] = [
  [/燃料/, 'material', 1, '燃料'],
  [/弹药|弾薬/, 'material', 2, '弹药'],
  [/钢材|鋼材/, 'material', 3, '钢材'],
  [/铝土?|ボーキ/, 'material', 4, '铝土'],
  [/开发资材|開発資材/, 'material', 7, '开发资材'],
  [/改修资材|改修資材|螺/, 'material', 8, '改修资材'],
  [/高速修复材|高速修復材/, 'material', 6, '高速修复材'],
  [/高速建造材/, 'material', 5, '高速建造材'],
  [/设计图|設計図|图纸/, 'useitem', 58, '改装设计图'],
  [/战斗详报|戦闘詳報|详报/, 'useitem', 78, '战斗详报'],
  // 家具系：具体条目（箱/币/职人）优先各配各图，泛「家具」用屋形类别图标
  [/家具箱（?大/, 'useitem', 12, '家具箱（大）'],
  [/家具箱（?中/, 'useitem', 11, '家具箱（中）'],
  [/家具箱（?小/, 'useitem', 10, '家具箱（小）'],
  [/家具币|家具コイン/, 'useitem', 44, '家具币'],
  [/特制家具职人|特注家具職人/, 'useitem', 52, '特制家具职人'],
  [/家具(?!箱|职人|職人|币|コイン)/, 'furniture', 0, '家具'],
  [/甲种勋章|甲種勲章/, 'useitem', 61, '甲种勋章'],
  [/(?<![甲][种種])[勋勲]章/, 'useitem', 57, '勋章'],
  [/补强增设|補強増設/, 'useitem', 64, '补强增设'],
  [/伊良湖/, 'useitem', 59, '给粮舰「伊良湖」'],
  [/间宫|間宮/, 'useitem', 54, '给粮舰「间宫」'],
  [/应急修理要员|応急修理要員/, 'useitem', 50, '应急修理要员'],
  [/应急修理女神|応急修理女神/, 'useitem', 51, '应急修理女神'],
  [/战斗粮食|戦闘糧食/, 'useitem', 66, '战斗粮食'],
  [/洋上补给|洋上補給/, 'useitem', 67, '洋上补给'],
  [/新型航空兵装资材|新型航空兵装資材/, 'useitem', 77, '新型航空兵装资材'],
  [/新型火炮兵装资材|新型砲熕兵装資材/, 'useitem', 75, '新型火炮兵装资材'],
  [/新型兵装资材|新型兵装資材/, 'useitem', 94, '新型兵装资材'],
  [/熟练搭乘员|熟練搭乗員/, 'useitem', 70, '熟练搭乘员'],
  // 2026-08-17 穷举补遗（useitem 全表 × 任务库 memo 的「×数量」词块统计）：
  // 这批 memo 用意译名，靠原名转写扫不出来
  [/礼物箱|プレゼント箱/, 'useitem', 60, '礼物箱'],
  [/海外舰最新技术|海外艦最新技術/, 'useitem', 100, '海外舰最新技术'],
  [/紧急修理资材|緊急修理資材/, 'useitem', 91, '紧急修理资材'],
  [/设营队|設営隊/, 'useitem', 73, '设营队'],
  [/司令部要员|司令部要員/, 'useitem', 63, '司令部要员'],
]

// 装备类奖励兜底（穷举后的剩余大头：大发动艇/弹射器/机体/炮雷几百种，
// 不进正则表）：用装备名索引命中 memo，取类别小图标。列表几百行有性能纪律
//（见 questEntityMarks 上方注释），按 memo 缓存——任务库文本固定，
// 索引重建时清一次即可。
const rewardEquipCache = new Map<string, string[]>()
const rewardEquipIcons = (memo: string): string[] => {
  if (!equipNameIndex.length || !memo) return []
  const cached = rewardEquipCache.get(memo)
  if (cached) return cached
  const seen = new Set<number>()
  const out: string[] = []
  for (const hit of matchTaskEntityHits(equipNameIndex, memo, 3)) {
    if (seen.has(hit.entry.id)) continue
    seen.add(hit.entry.id)
    const iconId = mg.master.slotitems[hit.entry.id]?.iconId
    if (!iconId) continue
    out.push(
      `<span class="rw art">${equipTypeIconHtml(iconId, { className: 'xs', title: hit.entry.name })}</span>`,
    )
  }
  rewardEquipCache.set(memo, out)
  return out
}

const rewardIcons = (memo: string) => {
  const fixed = REWARD_ICONS.filter(([re]) => re.test(memo)).map(
    ([, kind, id, label]) =>
      `<span class="rw art">${
        kind === 'material'
          ? materialIconHtml(id, { className: 'sm', title: label })
          : kind === 'useitem'
            ? useItemIconHtml(id, label, { className: 'reward' })
            : furnitureIconHtml(label, 'reward')
      }</span>`,
  )
  return [...fixed, ...rewardEquipIcons(memo)].slice(0, 4).join('')
}

// ---- 行构建 ----

interface QRow {
  id: number
  code: string
  name: string
  desc: string
  memo: string
  memo2: string
  pre: string[]
  observed: Quest | null
  inferredCompleted: boolean
}

const periodOfRow = (row: QRow): [string, string] => {
  if (row.observed?.type === 1) return ['日', 'd']
  if (row.observed?.type === 2) return ['周', 'w']
  if (row.observed?.type === 3) return ['月', 'm']
  return periodOf(row.code)
}

// 游戏只下发当前任务页，不给已经领取过的单次任务履历。
// 只沿“当前任务 → pre 前置”回溯，因此同一上游分出的其他后续旁支不会被误算。
// 周期任务虽然也参与穿透回溯，但不会被标成当前已完成（它们会重置）。
const inferredCompletedCodes = (): Set<string> => {
  return inferCompletedQuestCodes(
    lib.values(),
    Object.values(mg.quests).map((quest) => quest.no),
  )
}

const isInferredCompleted = (row: QRow): boolean =>
  row.inferredCompleted && periodOfRow(row)[0] === '单'

const isQuestActive = (id: number, observed: Quest | null | undefined): boolean =>
  observed != null &&
  (mg.questActiveIds
    ? mg.questActiveIds.includes(id)
    : observed.state === 2)

const isObservedActive = (row: QRow): boolean => isQuestActive(row.id, row.observed)

// 行集与全量分类计数只随「任务数据/资料库」变，不随搜索键击变——
// 每次 render 全量重建曾让搜索框每敲一键都付一次 650 行 × 13 类的全文扫描
let rowsCache: { key: string; rows: QRow[]; categoryCounts: Map<string, number> } | null = null
const rowsCacheKey = () =>
  `${mg.questsTs ?? 0}|${mg.questsFullTs ?? 0}|${mg.questActiveTs ?? 0}|${lib.size}|${Object.keys(mg.quests).length}`

const buildRowsUncached = (): QRow[] => {
  const rows: QRow[] = []
  const seen = new Set<number>()
  const inferred = inferredCompletedCodes()
  for (const quest of Object.values(mg.quests)) {
    const entry = lib.get(quest.no)
    if (entry?.name && quest.title) {
      registerLocalizedName('quest', quest.no, quest.title, entry.name, 'api_mst_quest+quests-scn')
    }
    rows.push({
      id: quest.no,
      code: entry?.code ?? '?',
      name: entry?.name ?? quest.title,
      desc: entry?.desc ?? '',
      memo: entry?.memo ?? '',
      memo2: entry?.memo2 ?? '',
      pre: entry?.pre ?? [],
      observed: quest,
      inferredCompleted: !!entry && inferred.has(entry.code),
    })
    seen.add(quest.no)
  }
  for (const entry of lib.values()) {
    if (!seen.has(entry.id)) {
      rows.push({ ...entry, observed: null, inferredCompleted: inferred.has(entry.code) })
    }
  }
  return rows
}

const buildRows = (): QRow[] => {
  const key = rowsCacheKey()
  if (rowsCache?.key !== key) {
    const rows = buildRowsUncached()
    const categoryCounts = new Map<string, number>()
    for (const category of CATEGORY_FILTERS) {
      categoryCounts.set(category.key, rows.filter(category.test).length)
    }
    rowsCache = { key, rows, categoryCounts }
  }
  return rowsCache.rows
}

const categoryCountOf = (key: string): number => rowsCache?.categoryCounts.get(key) ?? 0

interface QuestCategory {
  key: string
  label: string
  color: string
  /** 只有真有任务落进来时才在分类条上摆这一格（常驻一个 0 就是噪音） */
  onlyWhenPresent?: true
  test: (row: QRow) => boolean
}

// simplifyJp 逐字符替换整段 name+desc+memo2，而分类/筛选一次 render 会对同一行
// 调它十来遍、搜索框每个键击都重来一轮——按任务 id 缓存（资料库重载时清）
const questTextCache = new Map<number, string>()
const invalidateQuestTextCache = () => questTextCache.clear()
const questText = (row: QRow) => {
  const cached = questTextCache.get(row.id)
  if (cached != null) return cached
  const text = simplifyJp(`${row.name} ${row.desc} ${row.memo2}`)
  questTextCache.set(row.id, text)
  return text
}

const TASK_CATEGORIES: QuestCategory[] = [
  {
    key: 'limited',
    label: '限时',
    color: 'var(--gold)',
    test: (row) => catOf(row.code) === 'S' || /限时|限定|节分|秋刀鱼|新春|初夏|周年/.test(questText(row)),
  },
  { key: 'formation', label: '编成', color: '#67c98a', test: (row) => catOf(row.code) === 'A' },
  { key: 'sortie', label: '出击', color: '#e06c75', test: (row) => catOf(row.code) === 'B' },
  { key: 'exercise', label: '演习', color: '#5ab8d8', test: (row) => catOf(row.code) === 'C' },
  { key: 'expedition', label: '远征', color: '#8fb8e0', test: (row) => catOf(row.code) === 'D' },
  {
    key: 'supply',
    label: '补给',
    color: '#c9a86a',
    test: (row) => catOf(row.code) === 'E' && !/入渠|修理/.test(questText(row)),
  },
  {
    key: 'repair',
    label: '入渠',
    color: '#d7a76f',
    test: (row) => catOf(row.code) === 'E' && /入渠|修理/.test(questText(row)),
  },
  {
    key: 'build',
    label: '建造',
    color: '#a08a6a',
    test: (row) => catOf(row.code) === 'F' && /建造|造舰/.test(questText(row)),
  },
  {
    key: 'develop',
    label: '开发',
    color: '#b69a75',
    test: (row) => catOf(row.code) === 'F' && /开发/.test(questText(row)),
  },
  {
    key: 'scrap',
    label: '废弃',
    color: '#9d806d',
    test: (row) => catOf(row.code) === 'F' && /废弃|拆解|销毁/.test(questText(row)),
  },
  {
    key: 'improve',
    label: '改修',
    color: '#b489ff',
    test: (row) => ['F', 'G'].includes(catOf(row.code)) && /改修|强化装备/.test(questText(row)),
  },
  {
    key: 'remodel',
    label: '改造',
    color: '#c59aff',
    test: (row) => catOf(row.code) === 'G' || /改造|改装/.test(questText(row)),
  },
]

const FACTORY_CATEGORY_KEYS = new Set(['supply', 'repair', 'build', 'develop', 'scrap', 'improve', 'remodel'])

const NAMED_CATEGORY_FILTERS: QuestCategory[] = [
  ...TASK_CATEGORIES.filter((category) => !FACTORY_CATEGORY_KEYS.has(category.key)),
  {
    key: 'factory',
    label: '工厂',
    color: '#b69a75',
    test: (row) => ['E', 'F', 'G'].includes(catOf(row.code)),
  },
]

const CATEGORY_FILTERS: QuestCategory[] = [
  ...NAMED_CATEGORY_FILTERS,
  // 分类靠任务库的编号（B1、F12……）判。游戏里冒出一条任务库还没收的新任务时
  // 编号是 `?`，于是它上面一条分类页都命不中——只有「全部」看得见它，玩家停在
  // 任何一个分类页上都会以为没有这条（自扩展公约的反模式：清单先行、对不上就隐身）。
  // 这一格接住它们；任务库补上编号之后它自己就空了，格子随之消失。
  {
    key: 'unclassified',
    label: '未归类',
    color: 'var(--accent-dim)',
    onlyWhenPresent: true,
    test: (row) => !NAMED_CATEGORY_FILTERS.some((category) => category.test(row)),
  },
]

const categoryOf = (row: QRow): QuestCategory =>
  TASK_CATEGORIES.find((category) => category.test(row)) ?? {
    key: catOf(row.code),
    label: CAT_META[catOf(row.code)]?.[0] ?? '其他',
    color: catColor(row.code),
    test: () => true,
  }

// 「即将重置」的时限：按周期给不同的提前量，否则日任永远全部命中
const RESET_SOON: Record<string, [kind: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual', within: number]> = {
  日: ['daily', 6 * 3600000],
  周: ['weekly', 24 * 3600000],
  月: ['monthly', 3 * 86400000],
  季: ['quarterly', 7 * 86400000],
  年: ['annual', 14 * 86400000],
}

const QUICK_FILTERS: Record<string, { label: string; test: (r: QRow) => boolean }> = {
  screw: { label: '给改修资材的', test: (r) => /改修资材|改修資材/.test(r.memo) },
  blueprint: { label: '给图纸 / 详报的', test: (r) => /设计图|設計図|详报|詳報/.test(r.memo) },
  choice: { label: '有自选奖励', test: (r) => /以下奖励[二三四五六七八九]选一/.test(r.memo) },
  shipReward: { label: '有舰娘奖励', test: (r) => rewardShips(r).length > 0 },
  tracked: { label: '支持精确计数', test: (r) => Boolean(qp?.trackers[r.id]) },
  paused: {
    label: '取消后保留了进度',
    test: (r) => r.observed?.state === 1 && Boolean(qp?.progress[r.id]?.some((count) => count > 0)),
  },
  resetSoon: {
    label: '即将重置且未完成',
    test: (r) => {
      if (!isObservedActive(r)) return false // 只看进行中（完成待领取的不算「未完成」）
      const entry = RESET_SOON[periodOfRow(r)[0]]
      if (!entry) return false
      return nextReset(entry[0], annualMonthOf(r.memo2)) - Date.now() <= entry[1]
    },
  },
  doable: {
    // 「当前编成可直接做」：主进程用计数时的同一道条件门（qp:check-fleet）实时判定，
    // 所以这里的「能做」与实际会不会计数是同一口径。
    label: '当前编成可直接做',
    test: (r) => {
      if (!isObservedActive(r)) return false
      const hit = fleetCheck[r.id]
      if (!hit) return false
      return !hit.hasCond || hit.decks.length > 0
    },
  },
}

// 「更多筛选」展开时那 8 个计数是全库扫描：shipReward 一项要对每行跑一遍
// 舰名索引（实测 ~100ms/次），而被动重渲染一来一轮。输入没变就别重算——
// 键要盖住它们真正读的东西：行集（rowsCacheKey）、实体索引（版本号）、
// qp 与编成判定（quickCountEpoch），以及「即将重置」踩的那条时间线（分钟）。
let quickCountCache: { key: string; counts: Map<string, number> } | null = null
const quickFilterCounts = (rows: QRow[]): Map<string, number> => {
  const key = `${rowsCacheKey()}|${entityIndexVersion}|${quickCountEpoch}|${Math.floor(Date.now() / 60000)}`
  if (quickCountCache?.key === key) return quickCountCache.counts
  const counts = new Map<string, number>()
  for (const [name, def] of Object.entries(QUICK_FILTERS)) {
    counts.set(name, rows.filter(def.test).length)
  }
  quickCountCache = { key, counts }
  return counts
}

const applyFilters = (rows: QRow[]): QRow[] => {
  let out = rows
  if (state.status === 'active') out = out.filter((r) => isObservedActive(r) && !isInferredCompleted(r))
  else if (state.status === 'done') out = out.filter((r) => r.observed?.state === 3 && !isInferredCompleted(r))
  else if (state.status === 'unaccepted') out = out.filter((r) => r.observed?.state === 1 && !isInferredCompleted(r))
  else if (state.status === 'completed') out = out.filter(isInferredCompleted)
  else if (state.status === 'current') out = out.filter((r) => r.observed != null)
  if (state.category) {
    const category = CATEGORY_FILTERS.find((entry) => entry.key === state.category)
    if (category) out = out.filter(category.test)
  }
  if (state.period) out = out.filter((r) => periodOfRow(r)[0] === state.period)
  if (state.quick && QUICK_FILTERS[state.quick]) out = out.filter(QUICK_FILTERS[state.quick].test)
  if (state.search) {
    const q = state.search.toLowerCase()
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.desc.toLowerCase().includes(q) ||
        r.memo.toLowerCase().includes(q) ||
        r.memo2.toLowerCase().includes(q) ||
        (r.observed?.title ?? '').toLowerCase().includes(q),
    )
  }
  // 排序：达成 → 进行中 → 库（按 code）。
  // 复制一份再排：没有任何筛选命中时 out 就是 rowsCache.rows 本身，
  // 原地排会把缓存数组的顺序改掉（现在的消费者不看顺序，但这是个陷阱）。
  return [...out].sort((a, b) => {
    const rank = (r: QRow) =>
      r.observed?.state === 3 && !isInferredCompleted(r) ? 0 : isInferredCompleted(r) ? 1 : r.observed ? 2 : 3
    return rank(a) - rank(b) || a.code.localeCompare(b.code)
  })
}

// 精确计数（有追踪器且遂行中）：进度百分比 + 摘要文本。
// parts 只在多子项任务时构建：列表行要按子项分段画条、tooltip 逐项报数。
const qpOf = (
  row: QRow,
): {
  pct: number
  text: string
  approx: boolean
  floored: boolean
  parts: { ratio: number; now: number; cap: number; label: string }[]
} | null => {
  if (!qp) return null
  const tracker = qp.trackers[row.id]
  if (!tracker || !tracker.tasks.length) return null
  const counts = qp.progress[row.id]
  if (!counts && row.observed?.state !== 2) return null
  const saved = counts ?? []
  const groups = qpTaskGroups(tracker.tasks)
  const floor = qp.serverFloors[row.id]?.counts ?? []
  const effective = groups.map(({ slot }) => Math.max(saved[slot] ?? 0, floor[slot] ?? 0))
  const floored = groups.some(({ slot }) => (floor[slot] ?? 0) > (saved[slot] ?? 0))
  const ratios = groups.map(({ slot, entries }, index) =>
    Math.min(1, effective[index] / ((entries[0].task as any).count || 1)),
  )
  const pct = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100)
  const doneTasks = ratios.filter((r) => r >= 1).length
  const text =
    groups.length === 1
      ? `${floored ? '≥' : ''}${Math.min((groups[0].entries[0].task as any).count || 1, effective[0])}/${(groups[0].entries[0].task as any).count || 1}`
      : `${doneTasks}/${groups.length} 项${floored ? ` · ${FLAG_TEXT(qp.serverFloors[row.id].flag)}` : ''}`
  const parts =
    groups.length > 1
      ? groups.map(({ entries }, index) => {
          const cap = (entries[0].task as any).count || 1
          return {
            ratio: ratios[index],
            now: Math.min(cap, effective[index]),
            cap,
            // tooltip 是纯文本：qpTaskLabel 出的是带链接芯片的 HTML，剥掉标签用
            label: entries.map(({ task }) => qpTaskLabel(task).replace(/<[^>]*>/g, '')).join(' 或 '),
          }
        })
      : []
  return { pct, text, approx: tracker.approx, floored, parts }
}

const FLAG_TEXT = (flag: number) => (flag === 2 ? '≥80%' : flag === 1 ? '≥50%' : '—')

const progressHtml = (row: QRow) => {
  if (isInferredCompleted(row)) {
    return `<span class="q-prog" title="后续任务已经解锁，可确认这项单次前置任务曾经完成"><span class="pb"><i style="width:100%;background:linear-gradient(90deg,#3f806b,var(--ok))"></i></span>
      <span class="pt"><span>链上确认</span><span>100%</span></span></span>`
  }
  if (!row.observed) return '<span class="q-prog"><span class="pt"><span>资料</span><span>—</span></span></span>'
  if (row.observed.state === 3) {
    return `<span class="q-prog"><span class="pb"><i style="width:100%;background:linear-gradient(90deg,#b8973a,var(--gold))"></i></span>
      <span class="pt"><span>完成</span><span>100%</span></span></span>`
  }
  const flag = row.observed.progressFlag
  const precise = qpOf(row)
  if (precise) {
    const paused = row.observed.state === 1
    const baseTip = paused
      ? '任务已取消，进度仍保存在本机；重新领取后继续计数'
      : `游戏显示 ${FLAG_TEXT(flag)}`
    // 多子项任务的条按子项分段，各段填自己的完成率——「2/4 项」数的是填满的段，
    // 条和文字才是同一句话。整条画平均完成率时，90% 的条配「2/4 项」看着像自相矛盾
    //（あ号：出击 31/36 + 两项已满 + 一项 18/24，平均 90% 但只满 2 项）。
    const bar = precise.parts.length
      ? `<span class="pb seg">${precise.parts
          .map(
            (part) =>
              `<b${part.ratio >= 1 ? ' class="ok"' : ''}><i style="width:${part.ratio <= 0 ? 0 : Math.max(6, Math.round(part.ratio * 100))}%"></i></b>`,
          )
          .join('')}</span>`
      : `<span class="pb"><i style="width:${Math.max(3, precise.pct)}%"></i></span>`
    const tip = precise.parts.length
      ? `${baseTip}\n${precise.parts.map((part) => `${part.ratio >= 1 ? '✓' : '◌'} ${part.label} ${part.now}/${part.cap}`).join('\n')}`
      : baseTip
    return `<span class="q-prog" title="${esc(tip)}">${bar}
      <span class="pt"><span>${paused ? '已保留' : precise.floored ? '下限校正' : '本地计数'}${
        precise.approx ? '<span title="部分条件无法核对，计数可能偏多">≈</span>' : ''
      }</span><span>${esc(precise.text)}</span></span></span>`
  }
  if (row.observed.state === 1) {
    return '<span class="q-prog"><span class="pt"><span>尚未领取</span><span>—</span></span></span>'
  }
  const pct = flag === 2 ? 80 : flag === 1 ? 50 : 5
  // 只剩游戏粗档时，把「为什么没有精确数」写进 tooltip——
  // 否则用户只看到一条不动的进度条，分不清是坏了还是本来就没在计
  const tracker = qp?.trackers[row.id]
  const why = !qp
    ? '精确计数还在准备中'
    : !tracker
      ? '还没有这条任务的判定资料，无法精确计数'
      : tracker.blocked
        ? `${QP_BLOCK_TEXT[tracker.blocked].label} · ${QP_BLOCK_TEXT[tracker.blocked].how}`
        : ''
  return `<span class="q-prog"${why ? ` title="${esc(why)}"` : ''}><span class="pb"><i style="width:${pct}%"></i></span>
    <span class="pt"><span>游戏显示</span><span>${FLAG_TEXT(flag)}</span></span></span>`
}

const rowHtml = (row: QRow) => {
  const [periodLabel, periodCls] = periodOfRow(row)
  const observed = row.observed
  const inferredCompleted = isInferredCompleted(row)
  const ghost = !observed && !inferredCompleted
  // 「任务资料」这块灰行原本什么都不说。可拿到全量任务表之后是能说的：
  // 前置都满足却不在表里 = 已交付；有前置没做完 = 还接不了，还能说出卡在哪。
  // 与鉴共用同一份结论（questVerdicts），两处各判一次迟早说法打架。
  const verdict = ghost ? questVerdicts().get(row.id) : undefined
  let tag =
    verdict?.status === 'done'
      ? `<span class="st-tag done" title="前置都满足却不在任务表里，只能是已经交付了">✓ ${verdict.cyclic ? '本期已完成' : '已完成'}</span>`
      : verdict?.status === 'locked'
        ? `<span class="st-tag lock" title="${esc(`还差前置：${verdict.missingPre.join('、')}`)}">未解锁</span>`
        : '<span class="st-tag lock">任务资料</span>'
  if (inferredCompleted) {
    tag = '<span class="st-tag done" title="由已解锁的后续任务反推">✓ 已完成</span>'
  } else if (observed?.state === 3) tag = '<span class="st-tag done">✓ 领取奖励</span>'
  else if (isObservedActive(row)) {
    const precise = qpOf(row)
    tag =
      precise && precise.pct >= 100
        ? '<span class="st-tag" style="color:var(--gold);border-color:#4a3f22" title="本地计数已完成；打开任务界面后由游戏确认">预计完成</span>'
        : '<span class="st-tag" style="color:var(--accent);border-color:#2a4a5e">进行中</span>'
  } else if (observed?.state === 1) {
    tag = qpOf(row)
      ? '<span class="st-tag paused" title="取消任务不会清除本地计数">已暂停</span>'
      : '<span class="st-tag lock">尚未领取</span>'
  }
  const category = categoryOf(row)
  return `<div class="q${observed?.state === 3 || inferredCompleted ? ' done-row' : ''}${ghost ? ' ghost' : ''}${state.selected === row.id ? ' selected' : ''}" data-q="${row.id}">
    <div class="q-row">
      <span class="bar-l" style="background:${category.color}"></span>
      <span class="per ${periodCls}">${periodLabel}</span>
      <span class="q-nm">
        <span class="t"><span class="id">${esc(row.code)}</span><span class="q-cat-label">${category.label}</span><b title="${esc(entityNamePlain('quest', row.id, row.observed?.title ?? row.name))}">${entityNameHtml('quest', row.id, row.observed?.title ?? row.name, { compact: true })}</b></span>
        <span class="plain">${taskProseHtml(row.desc || (observed ? '（以游戏内文本为准）' : ''))}</span>
      </span>
      ${progressHtml(row)}
      <span class="q-rew">${rewardIcons(row.memo)}</span>
      ${tag}
    </div>
  </div>`
}

const SYSTEM_BY_CATEGORY: Record<string, [string, string]> = {
  formation: ['ru', '编队'],
  sortie: ['di', '战斗与出击'],
  exercise: ['di', '演习与战斗'],
  expedition: ['bi', '远征规划'],
  supply: ['ru', '编队补给'],
  repair: ['ru', '舰队状态'],
  build: ['ji', '建造相关资料'],
  develop: ['ji', '装备图鉴'],
  scrap: ['ji', '装备图鉴'],
  improve: ['ji', '装备改修'],
  remodel: ['ji', '舰娘图鉴'],
  limited: ['du', '活动进度'],
}

const availabilityWrap = (available: boolean, unavailableLabel: string, content: string) =>
  `<span class="q-entity-state${available ? '' : ' unavailable'}"${available ? '' : ` title="${esc(unavailableLabel)}"`}>${content}</span>`

// 正文里点出来的东西，视觉上刻意跟下面「相关内容」两样：那边是可点的实体清单，
// 带缩略图、未持有会灰掉；这里只是马克笔，不跳转也不表态，读到哪算哪。
// 唯一的例外是国籍——它本来就是链接，改掉反而是功能退化，于是链接外面再套记号。
const questMarkHtml = (mark: QuestMark, inner: string): string =>
  mark.kind === 'nationality' && mark.ref != null
    ? `<span class="qh qh-nationality">${elinkHtml('shipNationality', mark.ref, inner)}</span>`
    : `<span class="qh qh-${mark.kind}">${inner}</span>`

// 词典层：舰娘、舰级、舰种、装备、道具、远征。索引都在渲染层，所以这一段留在这里。
// 只有详情抽屉会走——列表几百行每行跑一遍全量索引不划算，那边只要数量和海域。
const questEntityMarks = (
  text: string,
  code: string,
  // 紧凑串坐标下的国籍段（markTaskEntityHits 的 acceptAlias 就是在紧凑串上跑的）；
  // 传原文坐标的那份进来会整体错位，见 nationalityRangesInPackedText
  nationalityRanges: { start: number; length: number }[],
): QuestMark[] => {
  const marks: QuestMark[] = []
  const push = (
    hits: { start: number; length: number; entry: { id: number } }[],
    kind: QuestMark['kind'],
  ) => {
    for (const hit of hits) {
      marks.push({ start: hit.start, length: hit.length, kind, ref: hit.entry.id })
    }
  }
  // 「驱逐队」「航空队」是部队编制名，不是舰种。chips 那边只列一次无所谓，
  // 正文里却会把编制名的头两个字涂成舰种色——一句话里点三下「驱逐」，像标错了。
  const notUnitName = (candidate: { text: string; start: number; alias: string }) =>
    !/^[队隊]/.test(candidate.text.slice(candidate.start + candidate.alias.length))
  // 海域名走词典时沿用 chips 的领域限制：远征说明、前置备注里的同名作战不该被
  // 当成本任务的目标海域。海域码和 wiki 链接是形态铁证，不受这条限制（见 emphasisMarks）。
  if (taskEntityTextDomainAllowed('map', code)) push(markTaskEntityHits(mapNameIndex, text, 3), 'map')
  push(markTaskEntityHits(shipClassIndex, text, 3), 'type')
  push(
    markTaskEntityHits(shipTypeIndex, text, 2, {
      acceptAlias: (candidate) => allowTaskShipTypeAlias(candidate) && notUnitName(candidate),
    }),
    'type',
  )
  push(
    markTaskEntityHits(equipTypeIndex, text, 2, {
      acceptAlias: (candidate) => allowTaskEquipTypeAlias(candidate) && notUnitName(candidate),
    }),
    'type',
  )
  push(markTaskEntityHits(missionNameIndex, text, 4), 'type')
  push(markTaskEntityHits(equipNameIndex, text, 3), 'equip')
  push(markTaskEntityHits(itemNameIndex, text, 3), 'equip')
  push(
    markTaskEntityHits(shipNameIndex, text, 2, {
      skipClassSuffix: true,
      allowQuotedSingle: true,
      acceptAlias: (candidate) =>
        allowTaskShipAlias(candidate) &&
        !nationalityRanges.some((hit) => rangesOverlap(candidate, hit)),
    }),
    'ship',
  )
  return spreadMarksToQuotes(text, marks)
}

/**
 * 任务正文 → HTML：先把 wiki 竖线折干净，再把该提醒的地方点出来。
 *
 * code 给了就连实体一起标（详情抽屉），不给就只标数量、判定、限制和海域（列表行）。
 */
const taskProseHtml = (rawText: string, code?: string): string => {
  const { text, links } = cleanQuestText(rawText)
  const nationalityHits = matchTaskNationalityHits(text)
  const nationality: QuestMark[] = nationalityHits.map((hit) => ({
    start: hit.start,
    length: hit.length,
    kind: 'nationality',
    ref: hit.entry.id,
  }))
  const marks = mergeQuestMarks(
    // 标注用原文坐标，排重用紧凑坐标——两者算的是同一份文本，只是坐标系不同
    code ? questEntityMarks(text, code, nationalityRangesInPackedText(text)) : [],
    emphasisMarks(text, links, { isMapId: (id) => mapIds.has(id) }),
    nationality,
  )
  return renderQuestMarks(text, marks, esc, questMarkHtml)
}

// 「有没有这艘舰」与图鉴共用同一套改造谱系判定（ship-ownership）。
// 早先这里自己比 members，一旦名字索引的分组不全（改造表盖不全的舰就会这样），
// 就会出现「图鉴说持有 ×1，任务的涉及舰娘却灰着」这种自相矛盾。
const shipOwned = (entry: ShipNameEntry) =>
  entry.members.some((id) => isShipFamilyOwned(id))
const equipOwned = (id: number) => Object.values(mg.slotitems).some((item) => item.mstId === id)
const mapUnlocked = (id: number) => !Object.keys(mg.mapGauges).length || id in mg.mapGauges

// 正文里的海域码「2-5」→ mapId（区×10+号）。详情的「涉及海域」与右键的
// 「涉及海域 →」两处都要，破折号的六种写法只写一遍。
const mapIdsInText = (rawText: string): number[] =>
  [
    ...simplifyJp(`${rawText ?? ''}`)
      .normalize('NFKC')
      .matchAll(/(\d+)\s*[-‐‑‒–—]\s*(\d+)/g),
  ]
    .map((match) => parseInt(match[1], 10) * 10 + parseInt(match[2], 10))
    .filter((id) => mapIds.has(id))

// 国籍命中与实体命中必须落在**同一坐标系**里才谈得上「这两段重不重叠」：
// matchTaskEntityHits / markTaskEntityHits 的 acceptAlias 拿到的是去掉空白的
// 紧凑串坐标，而 matchTaskNationalityHits 是在保留空白的对齐串上找的。
// 句子里每有一个空格，两边的 start 就差一位——B147/B148/Cy14 这些真任务
// 实测整整错开 1–4 位，rangesOverlap 判的根本不是同一段文字。
// 对紧凑串再取一次国籍命中，坐标就对上了（归一化是幂等的，认出来的还是那些）。
const nationalityRangesInPackedText = (rawText: string) =>
  matchTaskNationalityHits(normalizeEntityText(rawText))

const shipEntityHtml = (entry: ShipNameEntry) =>
  availabilityWrap(
    shipOwned(entry),
    '尚未持有',
    `<span class="entity-visual">${shipThumbHtml(entry.id, entry.name, { className: 'battle' })}${elink('mstShip', entry.id, entry.name)}</span>`,
  )
const equipEntityHtml = (entry: EntityNameIndex) =>
  availabilityWrap(
    equipOwned(entry.id),
    '尚未持有',
    `<span class="entity-visual">${equipTypeIconHtml(mg.master.slotitems[entry.id]?.iconId ?? 0, { className: 'xs', title: entityNamePlain('equip', entry.id, entry.name) })}${elink('mstEquip', entry.id, entry.name)}</span>`,
  )

// 正文、精确编成条件与计数任务共同反查；奖励文本不参与，避免把奖励舰娘误列成任务要求。
// 编成条件那一份取 fleetGoal 各组的 label（「海風改二」「山風 / 江風 / 涼風」这种），
// 它就是从任务正文与主数据解出来的具名串。EO 条件树 2026-08-21 整层退场后，
// 编成条件只有 fleetGoal 这一种结构化表达，不再另发一份纯文本摘要。
const entityChipsHtml = (row: QRow) => {
  const tracker = qp?.trackers[row.id]
  const goalLabels = (tracker?.fleetGoal?.groups ?? []).map((group) => group.label).join(' ')
  const text = `${row.name} ${row.desc} ${taskEntityMemoText(row.memo2)} ${goalLabels}`
  const normalizedText = simplifyJp(text).normalize('NFKC')
  const lines: string[] = []
  const nationalityHits = matchTaskNationalityHits(text)
  // 与下面几处 matchTaskEntityHits 的 acceptAlias 同坐标系（见 nationalityRangesInPackedText）
  const nationalityRanges = nationalityRangesInPackedText(text)

  // 海域只从出击/复合演习任务的正文反查。远征和工厂说明里的同名作战、
  // 前置任务海域不能反向污染本任务；追踪器结构化地图始终优先。
  const allowTextMaps = taskEntityTextDomainAllowed('map', row.code)
  const mapHits = allowTextMaps ? matchTaskEntityHits(mapNameIndex, text, 2) : []
  const mapRefs = new Set<number>(allowTextMaps ? mapIdsInText(text) : [])
  mapHits.forEach((hit) => mapRefs.add(hit.entry.id))
  for (const task of tracker?.tasks ?? []) {
    if ('map' in task) mapRefs.add(task.map[0] * 10 + task.map[1])
  }
  const maps = [...mapRefs]
    .filter((id) => mapIds.has(id))
    .sort((a, b) => a - b)
    .map((id) => {
      const entry = mapNameIndex.find((map) => map.id === id)
      const label = entry?.simple.includes('-') ? entry.name : mapCodeOf(id)
      return availabilityWrap(mapUnlocked(id), '海域尚未解锁', elink('map', id, label))
    })
  if (maps.length) lines.push(`<div class="d-ent"><span class="k">涉及海域</span>${maps.join(' · ')}</div>`)

  const nationalities = [
    ...new Map(
      nationalityHits.map((hit) => [hit.entry.id, hit.entry]),
    ).values(),
  ]
  if (nationalities.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及国籍</span>${nationalities
        .map((entry) => elink('shipNationality', entry.id, entry.name))
        .join(' · ')}</div>`,
    )
  }

  // 舰级条件单列并直达整级图鉴；已经用舰级概括后，不再重复展开其姊妹舰。
  const classIds = new Set(
    [...normalizedText.matchAll(/舰级\s*(\d+)/g)].map((match) => parseInt(match[1], 10)),
  )
  matchedEntities(shipClassIndex, text, 3).forEach((entry) => classIds.add(entry.id))
  const classes = [...classIds]
    .map((id) => shipClassIndex.find((entry) => entry.id === id))
    .filter((entry): entry is ShipClassEntry => !!entry)
  if (classes.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及舰级</span>${classes.map((entry) => {
        const anyOwned = entry.members.some(shipOwned)
        return availabilityWrap(anyOwned, '该舰级尚未持有', elink('shipClass', entry.id, entry.name))
      }).join(' · ')}</div>`,
    )
  }

  // 装备名先占坑，舰娘匹配不得再进装备名的地盘——舰娘名（含改造链别名）
  // 常是装备名的子串：「紫电改二」含「电改」，F46 的涉及舰娘就这么冒出过
  // 「电」（2026-08-13 用户抓的实锤；奖励解析侧同病灶已在前一日修过）。
  const equipHits = matchTaskEntityHits(equipNameIndex, text, 3)

  // 具体舰娘：索引聚合整条改造链的日中名称；已展示舰级的成员不在这里重复列出。
  const displayedClassIds = new Set(classes.map((entry) => entry.id))
  const ships = matchTaskEntityHits(shipNameIndex, text, 2, {
    skipClassSuffix: true,
    allowQuotedSingle: true,
    acceptAlias: (candidate) =>
      allowTaskShipAlias(candidate) &&
      !mapHits.some((mapHit) => rangesOverlap(candidate, mapHit)) &&
      !nationalityRanges.some((nationalityHit) => rangesOverlap(candidate, nationalityHit)) &&
      !equipHits.some((equipHit) => rangesOverlap(candidate, equipHit)),
  })
    .map((hit) => hit.entry)
    .filter((entry) => !displayedClassIds.has(entry.ctype))
  if (ships.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及舰娘</span>${ships.map(shipEntityHtml).join('')}</div>`,
    )
  }

  const shipTypeHits = matchTaskEntityHits(shipTypeIndex, text, 2, {
    acceptAlias: allowTaskShipTypeAlias,
  })
  const shipTypeLinks = shipTypeHits.map((hit) =>
    elink('shipTypeCatalog', hit.entry.id, hit.entry.name),
  )
  if (hasUncoveredTaskPhrase(text, '战舰', shipTypeHits, ['航空', '高速', '超弩级', '低速'])) {
    const group = SHIP_TYPE_GROUPS.battleship
    shipTypeLinks.push(elink('shipTypeGroup', group.ids.join(','), group.label))
  }
  const genericCarrier =
    hasUncoveredTaskPhrase(text, '航空母舰', shipTypeHits, ['轻型', '装甲']) ||
    hasUncoveredTaskPhrase(text, '航母', shipTypeHits, ['轻型', '轻', '装甲', '正规']) ||
    hasUncoveredTaskPhrase(text, '空母', shipTypeHits, ['轻', '正规', '装甲', '潜水'])
  if (genericCarrier) {
    const group = SHIP_TYPE_GROUPS.carrier
    shipTypeLinks.push(elink('shipTypeGroup', group.ids.join(','), group.label))
  }
  if (shipTypeLinks.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及舰种</span>${[...new Set(shipTypeLinks)].join(' · ')}</div>`,
    )
  }

  // 装备：日中名称都参与（equipHits 在舰娘匹配前算好，见上）；
  // 追踪器指定的废弃装备即使正文没写全也必须列出。
  const equipIds = new Set(equipHits.map((hit) => hit.entry.id))
  for (const task of tracker?.tasks ?? []) {
    if (task.kind === 'scrapEquip') equipIds.add(task.equipId)
  }
  const equips = [...equipIds]
    .map((id) => equipNameIndex.find((entry) => entry.id === id))
    .filter((entry): entry is EntityNameIndex => !!entry)
  if (equips.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及装备</span>${equips.map(equipEntityHtml).join('')}</div>`,
    )
  }

  const equipTypeHits = matchTaskEntityHits(equipTypeIndex, text, 2, {
    acceptAlias: allowTaskEquipTypeAlias,
  })
  const equipTypeIds = new Set(equipTypeHits.map((hit) => hit.entry.id))
  for (const task of tracker?.tasks ?? []) {
    if (task.kind === 'scrapCategory') equipTypeIds.add(task.category)
  }
  const equipTypes = [...equipTypeIds]
    .map((id) => equipTypeIndex.find((entry) => entry.id === id))
    .filter((entry): entry is EntityNameIndex => !!entry)
  const equipTypeLinks = equipTypes.map((entry) =>
    elink('equipTypeCatalog', entry.id, entry.name),
  )
  const equipMentionRanges = taskEntityAliasRanges(equipNameIndex, text, 3)
  if (hasUncoveredTaskPhrase(text, '电探', [...equipMentionRanges, ...equipTypeHits])) {
    equipTypeLinks.push(elink('equipTypeGroup', '电探', '电探'))
  }
  if (equipTypeLinks.length) {
    lines.push(
      `<div class="d-ent"><span class="k">装备类别</span>${[...new Set(equipTypeLinks)].join(' · ')}</div>`,
    )
  }

  // 任务编码 D 才会以远征名作为直接条件；其他类别提到远征通常是前置说明或同名作战。
  const missionIds = new Set(
    taskEntityTextDomainAllowed('expedition', row.code)
      ? matchedEntities(missionNameIndex, text, 3).map((entry) => entry.id)
      : [],
  )
  for (const task of tracker?.tasks ?? []) {
    if (task.kind === 'expedition') missionIds.add(task.missionId)
  }
  const missions = [...missionIds]
    .map((id) => missionNameIndex.find((entry) => entry.id === id))
    .filter((entry): entry is EntityNameIndex => !!entry)
  if (missions.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及远征</span>${missions.map((entry) =>
        elink('expedition', entry.id, entry.name),
      ).join(' · ')}</div>`,
    )
  }

  // 同名实体在 api_mst_slotitem 与 api_mst_useitem 中各占一条（战斗粮食、洋上补给等）；
  // 文本落在同一位置时以可装备实体为准，不重复显示成“装备 + 道具”。
  const items = excludeTaskHitsCoveredByAliases(
    matchTaskEntityHits(itemNameIndex, text, 2),
    equipHits,
  )
    .map((hit) => hit.entry)
  if (items.length) {
    lines.push(
      `<div class="d-ent"><span class="k">涉及道具</span>${items.map(({ id, name }) => {
        return `<span class="entity-visual">${useItemIconHtml(id, name, { className: 'sm' })}${elink('useitem', id, name)}</span>`
      }).join('')}</div>`,
    )
  }
  // 奖励家具（装饰品）：只从奖励文本识别，明说是奖励、不混进任务要求。
  // 持有三态：mg.furnitures 未同步（null）时不下「没有」的结论、不标灰——
  // 识别不到就标灰会把玩家真有的说成没有（2026-08-17 用户点名的坑）。
  const furnitureHits = matchedEntities(furnitureNameIndex, taskEntityMemoText(row.memo), 4)
  if (furnitureHits.length) {
    lines.push(
      `<div class="d-ent"><span class="k">奖励家具</span>${furnitureHits
        .map((entry) => {
          const link = elink('furniture', entry.id, entry.name)
          return mg.furnitures
            ? availabilityWrap(mg.furnitures.includes(entry.id), '尚未持有', link)
            : link
        })
        .join(' · ')}</div>`,
    )
  }
  // 相关系统按**功能**归类，不按「限时」——限时只是时效标签：限定编成任务
  // 该指向编队、限定工厂任务该指向装备图鉴。以前限时一律映射「活动进度」，
  // 把这批任务错指到铎。「活动进度」只在任务真的涉及活动海域时出现，
  // 与功能入口并存（活动图出击任务两个都要）。
  const functionalCategory = TASK_CATEGORIES.find(
    (category) => category.key !== 'limited' && category.test(row),
  )
  const systems: [string, string][] = []
  const functionalSystem = functionalCategory
    ? SYSTEM_BY_CATEGORY[functionalCategory.key]
    : null
  if (functionalSystem) systems.push(functionalSystem)
  if ([...mapRefs].some((id) => isEventMapArea(Math.floor(id / 10)))) {
    systems.push(SYSTEM_BY_CATEGORY.limited)
  }
  if (systems.length) {
    lines.push(
      `<div class="d-ent"><span class="k">相关系统</span>${systems
        .map((sys) => `<button class="q-system" data-q-system="${sys[0]}">${sys[1]} →</button>`)
        .join('')}</div>`,
    )
  }
  return lines.length
    ? `<section class="q-section q-related"><h4>相关内容</h4>${lines.join('')}</section>`
    : ''
}

/**
 * 远征名。`expedition` **不在 `domainOfLink` 里**，所以 elink 永远不会替它本地化，
 * 名字必须在交出去之前查好。译名表里这个域有两套键：`initLocalization` 按 dispNo
 * 落，本模块建实体索引时又按 api id 登了一遍——两把钥匙都试，查不到保原文。
 */
const expeditionDisplayName = (missionId: number): string => {
  const mission = mg.master.missions[missionId]
  const raw = mission?.name ?? `#${missionId}`
  const dispNo = `${mission?.dispNo ?? ''}`.replace(/^0+(?=\d)/, '')
  return (dispNo ? entityNamePlain('expedition', dispNo, '') : '') ||
    entityNamePlain('expedition', missionId, raw)
}

// 追踪任务的可读标签（海域/装备走 elink 反查）
const qpTaskLabel = (task: QpTask): string => {
  const mapChip = (m: [number, number]) => {
    const id = m[0] * 10 + m[1]
    return availabilityWrap(mapUnlocked(id), '海域尚未解锁', elink('map', id, `${m[0]}-${m[1]}`))
  }
  switch (task.kind) {
    case 'bossKill':
      return `${mapChip(task.map)} Boss ${QP_RANK_NAME[task.rank] ?? '?'} 胜`
    case 'battleNode':
      return task.nodes.length
        ? `${mapChip(task.map)}${task.name ? ` ${esc(task.name)}` : ''} 指定点(${task.nodes.join('/')})战斗 ${QP_RANK_NAME[task.rank] ?? '?'} 胜`
        : `${mapChip(task.map)} 战斗${task.rank > 0 ? ` ${QP_RANK_NAME[task.rank] ?? '?'} 胜以上` : '（胜负不限）'}`
    case 'battleWin':
      return task.rank <= 0
        ? '出击战斗（胜负不限）'
        : `出击战斗 ${QP_RANK_NAME[task.rank] ?? '?'} 胜以上`
    case 'bossReach':
      return '到达 Boss 点'
    case 'bossWin':
      return `Boss 战 ${QP_RANK_NAME[task.rank] ?? '?'} 胜以上`
    case 'sinkEnemy':
      return `击沉敌方${task.stypes
        .map((id) =>
          mg.master.stypes[id] ? entityNamePlain('shipType', id, mg.master.stypes[id]) : `舰种#${id}`,
        )
        .join(' / ')}`
    case 'expedition':
      return task.missionId === 0
        ? '任意远征成功'
        // 远征域的键是 dispNo 不是 api id，且 expedition 不在 domainOfLink 里，
        // elink 永远不会替它本地化——名字要在这里查好再交出去
        : `${elink('expedition', task.missionId, `远征「${expeditionDisplayName(task.missionId)}」`)}成功`
    case 'scrapEquip': {
      const name = mg.master.slotitems[task.equipId]?.name ?? `装备#${task.equipId}`
      return `废弃 ${availabilityWrap(equipOwned(task.equipId), '尚未持有', elink('mstEquip', task.equipId, name))}`
    }
    case 'scrapCategory':
      return `废弃「${elink('equipTypeCatalog', task.category, entityNamePlain('equipType', task.category, equiptypeNames.get(task.category) ?? `分类${task.category}`))}」类装备`
    case 'scrapCardType':
      return `废弃 卡面类型 ${task.cardType} 装备`
    case 'scrapIconType':
      return `废弃 图标类型 ${task.iconType} 装备`
    case 'nodeReach':
      return `${mapChip(task.map)} 到达${task.name ? ` ${esc(task.name)} 点` : `指定点(${task.nodes.join('/')})`}`
    case 'mapFirstClear':
      return `${mapChip(task.map)} 海域首通`
    case 'mapGoal':
      // 护航图（1-6）到达终点即算，每次都计——别写成「首通」误导已通关的提督
      return `${mapChip(task.map)} 到达护航终点`
    case 'exercise':
      return task.rank <= 0
        ? '完成演习（胜负不限）'
        : `演习 ${QP_RANK_NAME[task.rank] ?? '?'} 胜`
    case 'action':
      return `${esc(task.label)}（本地动作计数）`
  }
}

const qpStockCurrent = (goal: QpStockGoal): number | null => {
  if (goal.kind === 'material') return mg.materials?.[goal.id] ?? null
  if (goal.kind === 'useitem') {
    // 没同步过就是不知道，不是 0——「尚未同步」这一档对道具必须真能出现
    const stock = useitemStock(goal.id)
    return stock.known ? stock.count : null
  }
  const instances = Object.values(mg.slotitems)
  if (goal.kind === 'equip') {
    return instances.filter((item) => item.mstId === goal.id).length
  }
  return instances.filter((item) =>
    goal.ids.includes(mg.master.slotitems[item.mstId]?.type2 ?? -1),
  ).length
}

const qpStockLabel = (goal: QpStockGoal): string => {
  if (goal.kind === 'material') {
    return `${materialIconHtml(goal.id + 1, { className: 'sm', title: goal.label })}${elink('material', goal.id, goal.label)}`
  }
  if (goal.kind === 'useitem') {
    return `<span class="entity-visual">${useItemIconHtml(goal.id, goal.label, { className: 'sm' })}${elink('useitem', goal.id, goal.label)}</span>`
  }
  if (goal.kind === 'equip') {
    return elink('mstEquip', goal.id, mg.master.slotitems[goal.id]?.name ?? goal.label)
  }
  return goal.ids.length === 1
    ? elink('equipTypeCatalog', goal.ids[0], goal.label)
    : elink('equipTypeGroup', goal.label, goal.label)
}

// 审计 C4「为什么没在计数」。被动只读的边界本来就该摆给用户看——
// 静默地不动，用户只能猜是坏了还是没到时候。
//
// 结论一律取自铭的 tracker.blocked，那是派发时用的同一道门；
// 这里只负责把它翻成人话，不在渲染端重算（重算迟早和实际计数对不上）。
const blockedHtml = (tracker: QpState['trackers'][number]): string => {
  // 「没有可计数动作」是结构事实（tasks 为空），不必绕主进程；
  // 受领门那两种才必须取引擎的结论。
  if (!tracker.tasks.length) {
    return '<div class="counter-why plain"><b>这条没有可计数的动作</b></div>'
  }
  if (!tracker.blocked) return ''
  const { label, how } = QP_BLOCK_TEXT[tracker.blocked]
  return `<div class="counter-why why"><b>现在不会计数：${esc(label)}</b><span>${esc(how)}</span></div>`
}

// 完全没有计数器时说清是哪一种「没有」。判定资料还没到位就说「没有这条的资料」，
// 是把「我还没查」写成了「没有」。
const noCounterHtml = (row: QRow): string => {
  const body = !qp
    ? '<div class="d-note">精确计数还在准备中</div>'
    : '<div class="counter-why why"><b>无法精确计数：还没有这条任务的判定资料</b></div>'
  return `<section class="q-section q-counter"><h4>计数器</h4>${body}</section>`
}

// 编成检查／秘书舰检查取的是引擎对**领取中**任务的判定（qp:check-fleet 只判
// 领取中的那些）：任务没领取时它本来就不会有结果，写「正在读取……」等于把
// 「不会来」说成「马上就来」。四种情形各说各的，不拿加载态糊过去。
const fleetCheckPendingHtml = (row: QRow, what: string): string => {
  if (isObservedActive(row)) {
    return fleetCheckFailed
      ? `<div class="d-note">上一次读取${what}没有成功</div>`
      : `<div class="d-note">正在读取${what}……</div>`
  }
  // 「没领取」也得先有根据：任务页一次都没同步过时，那是不知道，不是没领
  if (!row.observed && mg.questActiveTs == null) {
    return '<div class="d-note">还没从游戏任务页同步过这条任务的领取情况</div>'
  }
  return '<div class="d-note">这条任务当前没有领取</div>'
}

// 有旧结论时也要说一句它可能过时——读取失败不清空数据，但也不能装作是新的
const fleetCheckStaleHtml = (): string =>
  fleetCheckFailed
    ? '<div class="d-note">最近一次读取当前编成没有成功，下面仍是上一次成功的结果。</div>'
    : ''

// 详情里的精确进度分解（每个子任务一行 + 编成条件摘要）
const qpDetailHtml = (row: QRow): string => {
  if (!qp) return ''
  const tracker = qp.trackers[row.id]
  if (!tracker) return ''
  const counts = qp.progress[row.id] ?? []
  const serverFloor = qp.serverFloors[row.id]
  const floors = serverFloor?.counts ?? []
  const lines = qpTaskGroups(tracker.tasks).map(({ slot, entries }) => {
    const cap = (entries[0].task as any).count || 1
    const local = counts[slot] ?? 0
    const floored = (floors[slot] ?? 0) > local
    const n = Math.min(cap, Math.max(local, floors[slot] ?? 0))
    const done = local >= cap
    const alternatives = entries.map(({ task }) => qpTaskLabel(task)).join(' 或 ')
    return `<div class="d-ent"><span class="k" style="color:${done ? 'var(--ok)' : 'var(--dim)'}">${done ? '✓' : '◌'}</span>${alternatives} <b style="font-family:var(--mono);color:${done ? 'var(--gold)' : 'var(--text)'}">${floored ? '≥' : ''}${n}/${cap}</b>${floored && serverFloor ? ` <small>游戏自报 ${FLAG_TEXT(serverFloor.flag)}</small>` : ''}</div>`
  })
  // 「本地计数」四字已在列表行的条上，这里不再重复口径，只留「源」与游戏自报档
  const counterMeta = [
    qp.packCredit ? `<span class="credit-mark" title="${esc(qp.packCredit)}">源</span>` : '',
    row.observed ? `游戏显示 ${FLAG_TEXT(row.observed.progressFlag)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const paused =
    row.observed?.state === 1
      ? '<div class="counter-paused">任务当前未领取，重新领取后在原进度上继续</div>'
      : ''
  // 「该怎么办」交给 blockedHtml 说（它拿的是真正的门），这里只陈述事实
  const syncNote = mg.questActiveTs != null
    ? `<div class="d-note">受领状态确认于 ${fmtTime(mg.questActiveTs)}</div>`
    : '<div class="d-note">尚未从游戏任务页同步过受领状态。</div>'
  const partial = tracker.partial
    ? '<div class="counter-paused">这条任务另有非计数条件（准备资源等），计数满不代表可交付。</div>'
    : ''
  const counter = tracker.tasks.length
    ? `<section class="q-section q-counter"><h4>计数器</h4>
        ${counterMeta ? `<div class="d-note">${counterMeta}</div>` : ''}
        ${blockedHtml(tracker)}${syncNote}${paused}${partial}${lines.join('')}
      </section>`
    : ''
  const goal = tracker.fleetGoal
    ? `<section class="q-section q-fleet-goal"><h4>编成检查</h4>
        <div class="d-note"><span class="credit-mark" title="${esc(
          '同一艘舰一般不重复计入两个条目，「含旗舰」类条目除外——旗舰同时计入它所属的那一类。\n' +
            '具名舰未写形态的（如「时雨」）任意形态都算；写明形态的（如「白露改」）按资料注明的形态认定，备注「改二也可」之类的列举会一并认。',
        )}">口径</span></div>
        ${
          fleetCheck[row.id]?.diffs?.length
            ? fleetCheckStaleHtml() + fleetCheck[row.id].diffs!.map((diff) => {
                const details = diff.lines.map((line) =>
                  `${esc(line.label)} ${line.current}/${line.required}${line.ok ? ' ✓' : ` · ${esc(line.issue ?? '未满足')}`}`,
                ).join('；')
                return `<div class="fleet-goal-row ${diff.ok ? 'ok' : 'no'}"><b>第${diff.deckId}舰队</b><span>${details}</span></div>`
              }).join('')
            : fleetCheckPendingHtml(row, '当前编成')
        }
      </section>`
    : ''
  const stock = tracker.stockGoals?.length
    ? `<section class="q-section q-stock-goal"><h4>持有条件
        <span class="credit-mark" title="满足只表示备齐，交付以游戏为准">口径</span></h4>
        ${tracker.stockGoals.map((item) => {
          const current = qpStockCurrent(item)
          const ok = current != null && current >= item.count
          const status = current == null
            ? '尚未同步'
            : ok
              ? `${current.toLocaleString()} / ${item.count.toLocaleString()} ✓`
              : `${current.toLocaleString()} / ${item.count.toLocaleString()} · 还差 ${(item.count - current).toLocaleString()}`
          return `<div class="d-ent"><span class="k" style="color:${ok ? 'var(--ok)' : 'var(--dim)'}">${ok ? '✓' : '◌'}</span>${qpStockLabel(item)} <b style="font-family:var(--mono);color:${ok ? 'var(--gold)' : 'var(--text)'}">${status}</b></div>`
        }).join('')}
      </section>`
    : ''
  const stateGoal = tracker.stateGoal
    ? `<section class="q-section q-state-goal"><h4>秘书舰与目标装备</h4>
        <div class="d-note">秘书舰条件不满足时，相关废弃不会计入</div>
        ${
          fleetCheck[row.id]?.stateGoal?.lines.length
            ? fleetCheckStaleHtml() + fleetCheck[row.id].stateGoal!.lines.map((line) =>
                `<div class="d-ent"><span class="k" style="color:${line.ok ? 'var(--ok)' : 'var(--dim)'}">${line.ok ? '✓' : '◌'}</span>${esc(line.label)} <b style="font-family:var(--mono);color:${line.ok ? 'var(--gold)' : 'var(--text)'}">${line.ok ? '已满足' : esc(line.issue ?? '未满足')}</b></div>`,
              ).join('')
            : fleetCheckPendingHtml(row, '秘书舰与装备状态')
        }
      </section>`
    : ''
  const sections = counter + stateGoal + stock + goal
  // 有追踪器、但既没有可计数动作也没有任何条件区：别留空白，说清它靠什么判定
  return sections || `<section class="q-section q-counter"><h4>计数器</h4>${blockedHtml(tracker)}</section>`
}

// kcwiki 任务文本的道具名是简中意译（新型火炮兵装资材 ↔ 新型砲熕兵装資材、
// 试制甲板用弹射器 ↔ 試製甲板カタパルト），与 useitem 日文名不是字符转换关系。
// 复用改造需求那张已对齐的表当别名，两处口径一致。
const kcwikiItemAliasById = new Map<number, string[]>()
for (const [cn, id] of Object.entries(KCWIKI_ITEM_ALIAS)) {
  const list = kcwikiItemAliasById.get(id)
  if (list) list.push(cn)
  else kcwikiItemAliasById.set(id, [cn])
}
const kcwikiEquipAliasById = new Map<number, string[]>()
for (const [cn, id] of Object.entries(KCWIKI_EQUIP_ALIAS)) {
  const list = kcwikiEquipAliasById.get(id)
  if (list) list.push(cn)
  else kcwikiEquipAliasById.set(id, [cn])
}

// 道具持有数的单一出处：api_mst_useitem 同时收录真实道具、四资源入口（31–34）、
// 家具币（44，实际住在 mg.basic.furnitureCoins）与部分装备的商店入口，
// 持有数必须按实际存储域解析。自己另写一份残缺映射，就会和计数引擎的口径打架
// （家具币任务的持有条件曾永远显示 0），而且 known 一律为真、
// 「尚未同步」那一档对道具永远出不来。
const useitemStock = (id: number): UseitemStock =>
  resolveUseitemStock(id, useitemNames.get(id) ?? '', {
    materials: mg.materials,
    furnitureCoins: mg.basic?.furnitureCoins,
    useitems: mg.useitems,
    useitemsTs: mg.useitemsTs,
    slotitems: mg.slotitems,
    slotitemMasters: mg.master.slotitems,
    // require_info 同时给出完整装备表与非零道具表；旧快照已有装备实例时基线也算存在
    slotitemsKnown: mg.useitemsTs != null || Object.keys(mg.slotitems).length > 0,
  })

// 装备持有数：一趟数完，别每件装备重扫一遍全部持有实例。
// 自选奖励要对整张装备名索引（上千条）逐条问「我有几件」，原先是
// Object.values(mg.slotitems).filter(...) 套在循环里 = 千 × 千次比较，
// 抽屉开着时每来一个 patch 都重付一次（实测单次详情渲染 6–32ms）。
const ownedEquipCounts = (): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const item of Object.values(mg.slotitems)) {
    counts.set(item.mstId, (counts.get(item.mstId) ?? 0) + 1)
  }
  return counts
}

// 奖励解析的实体索引与持有数：解析本身住在 shared/quest-reward（纯文本，可测），
// 这里只负责把「现在有多少」和归一化函数递进去。
const rewardParseContext = (): RewardParseContext => {
  const ownedByMstId = ownedEquipCounts()
  const useitems: RewardParseContext['useitems'] = []
  for (const [id, name] of useitemNames) {
    if (isResourceMirrorUseitem(id)) continue
    useitems.push({
      id,
      name,
      aliases: entityAliases('item', id, name, kcwikiItemAliasById.get(id) ?? []),
      stock: useitemStock(id).count,
    })
  }
  return {
    equips: equipNameIndex.map((equip) => {
      const extras = kcwikiEquipAliasById.get(equip.id)
      return {
        id: equip.id,
        name: equip.name,
        aliases: extras ? [...equip.aliases, ...extras.map(normalizeEntityText)] : equip.aliases,
        stock: ownedByMstId.get(equip.id) ?? 0,
      }
    }),
    useitems,
    materialStock: (index) => mg.materials?.[index] ?? 0,
    normalize: normalizeEntityText,
  }
}


const rewardCandidateLabel = (candidate: RewardStockCandidate): string =>
  candidate.kind === 'equip'
    ? `${equipTypeIconHtml(mg.master.slotitems[candidate.id]?.iconId ?? 0, { className: 'xs', title: entityNamePlain('equip', candidate.id, candidate.name) })}${elink('mstEquip', candidate.id, candidate.name)}`
    : candidate.kind === 'useitem'
      ? `${useItemIconHtml(candidate.id, entityNamePlain('item', candidate.id, candidate.name), { className: 'sm' })}${elink('useitem', candidate.id, candidate.name)}`
      : `${materialIconHtml(candidate.id + 1, { className: 'sm', title: candidate.name })}${elink('material', candidate.id, candidate.name)}`

const rewardCandidateHtml = (
  candidate: RewardStockCandidate,
  options: { recommended?: boolean; showStock?: boolean } = {},
): string => {
  // raw：名称没对上实体的原文项。照原样列出（含它自带的×数量），
  // 不给库存、不参与推荐——给不出的数据不硬造。
  if (candidate.kind === 'raw') {
    return `<span class="reward-stock raw" title="按任务原文显示，不参与库存比较">${esc(candidate.name)}</span>`
  }
  return `<span class="reward-stock${options.recommended ? ' recommend' : ''}${candidate.kind === 'equip' && candidate.stock <= 0 ? ' unavailable' : ''}">
    ${rewardCandidateLabel(candidate)}${candidate.star ? `<span class="rw-star" title="奖励自带改修 ★+${candidate.star}">★+${candidate.star}</span>` : ''}<i>×${candidate.amount}</i>${
      options.showStock === false ? '' : `<b>持有 ${candidate.stock}</b>`
    }${options.recommended ? '<em>库存较少</em>' : ''}
  </span>`
}

const rewardAdviceHtml = (row: QRow, ctx: RewardParseContext): string => {
  const groups = questRewardChoiceGroups(row.memo, ctx)
  if (!groups.length) return ''
  const html = groups.map((group, index) => {
    const comparable = group.filter(
      (candidate) => candidate.kind !== 'material' && candidate.kind !== 'raw',
    )
    const pool = comparable.length ? comparable : group.filter((c) => c.kind !== 'raw')
    const minStock = Math.min(...pool.map((candidate) => candidate.stock))
    return `<div class="reward-group"><span class="k">第${index + 1}组选一</span>
      <div>${group.map((candidate) => rewardCandidateHtml(candidate, {
        recommended: pool.includes(candidate) && candidate.stock === minStock,
      })).join('')}</div>
    </div>`
  }).join('')
  return `<section class="q-section reward-advice"><h4>可选物品奖励
      <span class="credit-mark" title="只比较当前实际持有量">口径</span></h4>
    ${html}
  </section>`
}

const fixedRewardText = (memo: string): string => questFixedRewardText(memo)

const resourceRewards = (row: QRow): number[] => {
  if (row.observed?.getMaterial?.length) {
    return [0, 1, 2, 3].map((index) => Math.max(0, Number(row.observed!.getMaterial![index] ?? 0)))
  }
  const text = simplifyJp(fixedRewardText(row.memo))
  const patterns = [
    /燃料\s*(?:×|x|\*)?\s*([\d,]+)/i,
    /弹药\s*(?:×|x|\*)?\s*([\d,]+)/i,
    /钢材\s*(?:×|x|\*)?\s*([\d,]+)/i,
    /铝土?\s*(?:×|x|\*)?\s*([\d,]+)/i,
  ]
  return patterns.map((pattern) => Number(text.match(pattern)?.[1]?.replace(/,/g, '') ?? 0))
}

const rewardShips = (row: QRow): { id: number; name: string; amount: number }[] => {
  const text = normalizeEntityText(fixedRewardText(row.memo))
  // 装备名先占坑：奖励「震电改二(舰战型改二)」是装备，里面的「电改」两字
  // 不能被舰娘索引（電 聚合整条改造链的别名）咬走——F138 曾因此凭空多出
  // 「電 ×1」的角色奖励（2026-08-12 用户抓的实锤）。与涉及道具的挖除同款机制。
  const equipRanges = taskEntityAliasRanges(equipNameIndex, text, 3)
  return excludeTaskHitsCoveredByAliases(
    matchTaskEntityHits(shipNameIndex, text, 2, { allowQuotedSingle: true, limit: 8 }),
    equipRanges,
  )
    .map((hit) => hit.entry)
    .map((ship) => {
      const alias = ship.aliases.find((candidate) =>
        (candidate.length >= 2 && text.includes(candidate)) ||
        (candidate.length === 1 && [`「${candidate}」`, `『${candidate}』`, `"${candidate}"`, `“${candidate}”`].some((quoted) => text.includes(quoted))),
      ) ?? ship.simple
      const tail = text.slice(text.indexOf(alias) + alias.length)
      const amount = Number(tail.match(/^\s*[」』"”]?\s*(?:×|x|\*)\s*(\d+)/i)?.[1] ?? 1)
      return { id: ship.id, name: ship.name, amount: Math.max(1, amount) }
    })
}

const rewardSectionsHtml = (row: QRow): string => {
  const resources = resourceRewards(row)
  const resourceNames = ['燃料', '弹药', '钢材', '铝土']
  const resourceGrid = resources
    .map(
      (amount, index) => `<span class="reward-resource${amount ? '' : ' zero'}">
        ${materialIconHtml(index + 1, { className: 'sm', title: resourceNames[index] })}
        <small>${elink('material', index, resourceNames[index])}</small><b>${amount.toLocaleString()}</b>
      </span>`,
    )
    .join('')
  const fixedText = fixedRewardText(row.memo)
  // 索引一建就是上千条别名 × 全部持有实例（实测单次详情渲染 6–32ms），
  // 固定段与选一组共用一份
  const parseCtx = rewardParseContext()
  // 固定奖励段同样走补漏（declared 0 = 文本没自报项数）：认不出的名字照原文列出，
  // 别让一项奖励从面板上消失
  const fixedItems = parseQuestRewardItems(fixedText, 0, parseCtx)
    .filter((candidate) => candidate.kind !== 'material')
  const ships = rewardShips(row)
  const hasResources = resources.some((amount) => amount > 0)
  const fixedFallback =
    fixedText && !fixedItems.length && !ships.length && !hasResources
      ? `<div class="reward-copy">${esc(fixedText)}</div>`
      : ''
  const fixedHtml = `<section class="q-section q-reward-fixed"><h4>固定奖励</h4>
    <div class="reward-items">${
      fixedItems.map((candidate) => rewardCandidateHtml(candidate, { showStock: false })).join('') ||
      fixedFallback ||
      '<span class="reward-none">无额外固定奖励</span>'
    }</div>
  </section>`
  const shipHtml = ships.length
    ? `<section class="q-section q-reward-ships"><h4>角色奖励</h4><div class="reward-items">
        ${ships
          .map(
            (ship) => {
              const entry = shipNameIndex.find((candidate) => candidate.id === ship.id)
              return `<span class="reward-ship${entry && !shipOwned(entry) ? ' unavailable' : ''}">${shipThumbHtml(ship.id, ship.name, { className: 'battle' })}
              ${elink('mstShip', ship.id, ship.name)}<b>×${ship.amount}</b></span>`
            },
          )
          .join('')}
      </div></section>`
    : ''
  return `<section class="q-section q-reward-resources"><h4>基础资源</h4>
      <div class="reward-resource-grid">${resourceGrid}</div>
    </section>
    ${fixedHtml}${shipHtml}${rewardAdviceHtml(row, parseCtx)}`
}

const annualResetHtml = (row: QRow): string => {
  if (periodOfRow(row)[0] !== '年') return ''
  const month = annualMonthOf(row.memo2)
  if (!month) {
    return '<div class="annual-reset unknown">年任 · 重置月份未知</div>'
  }
  const reset = nextReset('annual', month)
  return `<div class="annual-reset">年任 · 每年 <b>${month}月1日 05:00 JST</b> 重置 ·
    距下次重置 <b data-cdl="${reset}">${fmtDurationLong(reset)}</b></div>`
}

const questChainNode = (
  entry: QuestChainEntry,
  inferred: ReadonlySet<string>,
  className = '',
): string => {
  const observed = entry.id > 0 ? mg.quests[entry.id] : null
  const done =
    observed?.state === 3 ||
    (inferred.has(entry.code) && periodOf(entry.code)[0] === '单')
  const active = !done && entry.id > 0 && isQuestActive(entry.id, observed)
  const available = !done && !active && observed?.state === 1
  const statusClass = done ? 'done' : active ? 'active' : available ? 'available' : 'unknown'
  const statusLabel = done ? '已完成' : active ? '进行中' : available ? '尚未领取' : '状态未同步'
  const body =
    entry.id > 0
      ? elinkHtml(
          'quest',
          entry.id,
          `${esc(entry.code)} ${entityNameHtml('quest', entry.id, entry.name, { compact: true })}`,
        )
      : `<span class="chain-missing">${esc(entry.code)} ${esc(entry.name)}</span>`
  return `<span class="chain-node ${statusClass}${className ? ` ${className}` : ''}">
    <i class="chain-state" title="${statusLabel}"></i>${body}
  </span>`
}

const questChainBranchHtml = (
  branch: QuestChainBranch,
  direction: 'before' | 'after',
  inferred: ReadonlySet<string>,
): string => {
  const descendants = branch.children
    .map((child) => questChainBranchHtml(child, direction, inferred))
    .join('')
  const cutLabel = direction === 'before' ? '个更早前置' : '个更后续任务'
  const nested =
    descendants || branch.cutCount
      ? `<ul class="chain-tree-list">${descendants}${
          branch.cutCount
            ? `<li class="chain-tree-meta"><span>… 另有 ${branch.cutCount} ${cutLabel}</span></li>`
            : ''
        }</ul>`
      : ''
  return `<li>${questChainNode(branch.entry, inferred)}${
    branch.cycle ? '<span class="chain-tree-warning">↻ 资料形成循环</span>' : ''
  }${nested}</li>`
}

const questChainDeeperHtml = (
  branch: QuestChainBranch,
  direction: 'before' | 'after',
  inferred: ReadonlySet<string>,
): string => {
  const deeper = countQuestChainDescendants(branch)
  if (!deeper) return ''
  const nested = branch.children
    .map((child) => questChainBranchHtml(child, direction, inferred))
    .join('')
  const cutLabel = direction === 'before' ? '个更早前置' : '个更后续任务'
  return `<details class="chain-deeper">
    <summary>${direction === 'before' ? '更早' : '更远'} ${deeper} 项</summary>
    <ul class="chain-tree-list">${nested}${
      branch.cutCount
        ? `<li class="chain-tree-meta"><span>… 另有 ${branch.cutCount} ${cutLabel}</span></li>`
        : ''
    }</ul>
  </details>`
}

const questChainForestHtml = (
  forest: QuestChainForest,
  direction: 'before' | 'after',
  inferred: ReadonlySet<string>,
): string => {
  const branches = forest.branches
    .map(
      (branch) =>
        `<li>${questChainNode(branch.entry, inferred)}${
          branch.cycle ? '<span class="chain-tree-warning">↻ 资料形成循环</span>' : ''
        }${questChainDeeperHtml(branch, direction, inferred)}</li>`,
    )
    .join('')
  const cutLabel = direction === 'before' ? '个直接前置' : '个直接后续'
  return `<ul class="chain-tree-list chain-tree-direct">${branches}${
    forest.cutCount
      ? `<li class="chain-tree-meta"><span>… 另有 ${forest.cutCount} ${cutLabel}</span></li>`
      : ''
  }</ul>`
}

const questChainHtml = (row: QRow): string => {
  const current: QuestChainEntry = {
    id: row.id,
    code: row.code,
    name: row.observed?.title ?? row.name,
    pre: row.pre,
  }
  const tree = buildQuestChainTree(current, lib.values(), {
    maxDepth: 6,
    maxNodesPerDirection: 48,
  })
  const hasBefore = tree.before.branches.length > 0 || tree.before.cutCount > 0
  const hasAfter = tree.after.branches.length > 0 || tree.after.cutCount > 0
  if (!hasBefore && !hasAfter) return ''
  const inferred = inferredCompletedCodes()
  const lane = (
    label: string,
    direction: 'before' | 'after',
    forest: QuestChainForest,
  ) =>
    `<div class="chain-tree-lane ${direction}">
      <div class="chain-tree-lane-head"><i>${direction === 'before' ? '↑' : '↓'}</i><b>${label}</b><span>${
        forest.branches.length + forest.cutCount
      } 条</span></div>
      ${questChainForestHtml(forest, direction, inferred)}
    </div>`
  return `<section class="q-section q-chain">
    <h4>任务链${questPreSourceNoteHtml(lib.get(row.id)?.preInfo)}</h4>
    <div class="quest-chain-tree">
      ${hasBefore ? lane('要先完成', 'before', tree.before) : ''}
      <div class="chain-tree-current"><span>当前</span>${questChainNode(current, inferred, 'me')}</div>
      ${hasAfter ? lane('完成后可接', 'after', tree.after) : ''}
    </div>
    <div class="chain-tree-foot">
      <div class="chain-tree-legend"><span class="done">已完成</span><span class="active">进行中</span><span class="available">尚未领取</span><span>状态未同步</span></div>
      <button type="button" class="chain-tree-locate" data-quest-tree-here="${row.id}">在完整任务树中定位</button>
    </div>
  </section>`
}

const detailHtml = (row: QRow) => {
  const originalTitle = row.observed?.title?.trim() ?? ''
  const originalDetail = row.observed?.detail?.trim() ?? ''
  const hasOriginal =
    originalTitle &&
    (simplifyJp(originalTitle) !== simplifyJp(row.name) || originalDetail)
  const status =
    isInferredCompleted(row)
      ? '已完成 · 由后续任务确认'
      : row.observed?.state === 3
      ? '已完成 · 待领取'
      : isObservedActive(row)
        ? '进行中'
        : row.observed?.state === 1
          ? qpOf(row)
            ? '已暂停 · 进度保留'
            : '尚未领取'
          : '任务资料'
  const inferredNote = isInferredCompleted(row)
    ? '<section class="q-section"><h4>完成依据</h4><div class="d-note">这项单次任务已由下游任务的解锁状态反向确认完成。</div></section>'
    : ''
  const counter = qpDetailHtml(row) || noCounterHtml(row)
  const chain = questChainHtml(row)
  const resetInfo = annualResetHtml(row)
  return `<div class="q-drawer-head">
      <span><small>${esc(row.code)} · ${periodOfRow(row)[0]}任 · ${categoryOf(row).label}</small><b>${esc(status)}</b></span>
      <button data-q-close title="关闭任务详情">×</button>
    </div>
    <div class="q-drawer-body">
      <section class="q-section q-bilingual">
        <h4>任务说明</h4>
        <div class="q-zh"><b>${entityNameHtml('quest', row.id, row.name || row.observed?.title || `任务 ${row.id}`)}</b>
          ${row.desc ? `<p>${taskProseHtml(row.desc, row.code)}</p>` : '<p class="dim">中文资料暂未收录任务说明。</p>'}
        </div>
        ${
          hasOriginal
            ? `<details class="q-original"><summary>日文原文</summary><b>${esc(originalTitle)}</b>${
                originalDetail ? `<p>${esc(originalDetail)}</p>` : ''
              }</details>`
            : ''
        }
      </section>
      ${
        row.memo2 || resetInfo
          ? `<section class="q-section q-memo"><h4>补充说明</h4>${
              row.memo2 ? `<p>${taskProseHtml(row.memo2, row.code)}</p>` : ''
            }${resetInfo}</section>`
          : ''
      }
      ${counter}
      ${inferredNote}
      ${entityChipsHtml(row)}
      ${rewardSectionsHtml(row)}
      ${chain}
      ${scnLode ? `<div class="q-detail-source">${lodeCreditMark(scnLode.meta)}</div>` : ''}
    </div>`
}

// ---- 总渲染 ----

const render = () => {
  if (!pane) return
  const rows = buildRows()
  if (!rows.length) {
    forgetCommittedHtml(pane, 'qn') // 这一支绕开 commitPaneHtml，记忆不能留着
    pane.innerHTML = `<div class="pane-waiting">
      正在等待任务数据……在游戏中打开一次任务页面即可同步进行中的任务。</div>`
    return
  }
  const filtered = applyFilters(rows)
  const active =
    mg.questExecCount ??
    rows.filter((r) => isObservedActive(r) && !isInferredCompleted(r)).length
  const done = rows.filter((r) => r.observed?.state === 3 && !isInferredCompleted(r)).length
  const unaccepted = rows.filter((r) => r.observed?.state === 1 && !isInferredCompleted(r)).length
  const completed = rows.filter(isInferredCompleted).length
  const current = rows.filter((r) => r.observed != null).length
  const nearestAnnual = rows
    .flatMap((row) => {
      if (!row.observed || periodOfRow(row)[0] !== '年') return []
      const month = annualMonthOf(row.memo2)
      return month ? [{ month, ts: nextReset('annual', month) }] : []
    })
    .sort((a, b) => a.ts - b.ts)[0]
  const selected = state.selected == null ? null : rows.find((row) => row.id === state.selected) ?? null
  // 数据刷新会整块重建任务 DOM。侧栏本来就开着时，不能让新节点再次命中
  // @starting-style 的“从 0 展开”动画，否则计数变化、提交与领奖都会抽动一次。
  const drawerAlreadyOpen = !!selected && !!pane.querySelector('.q-drawer.open')
  const resetFilters: {
    period: string
    label: string
    reset: number | null
    count: number
  }[] = [
    { period: '日', label: '日任务', reset: nextReset('daily'), count: rows.filter((row) => periodOfRow(row)[0] === '日').length },
    { period: '周', label: '周任务', reset: nextReset('weekly'), count: rows.filter((row) => periodOfRow(row)[0] === '周').length },
    { period: '月', label: '月任务', reset: nextReset('monthly'), count: rows.filter((row) => periodOfRow(row)[0] === '月').length },
    { period: '季', label: '季任务', reset: nextReset('quarterly'), count: rows.filter((row) => periodOfRow(row)[0] === '季').length },
    { period: '年', label: '年任务', reset: nearestAnnual?.ts ?? null, count: rows.filter((row) => periodOfRow(row)[0] === '年').length },
    { period: '单', label: '单次', reset: null, count: rows.filter((row) => periodOfRow(row)[0] === '单').length },
  ]

  // 输出没变就整段不动 DOM（口径见 kernel commitPaneHtml）
  const html = `<div class="qn-app">
      <div class="qn-top">
        <div class="q-top-primary">
          <div class="q-category-strip">
            <button class="qcat${state.category == null ? ' on' : ''}" data-cat-clear>
              <i style="background:var(--accent)"></i>全部 <b>${rows.length}</b>
            </button>
            ${CATEGORY_FILTERS.filter(
              (category) => !category.onlyWhenPresent || categoryCountOf(category.key) > 0,
            )
              .map(
                (category) => `<button class="qcat${state.category === category.key ? ' on' : ''}" data-cat="${category.key}">
                <i style="background:${category.color}"></i>${category.label}<b>${categoryCountOf(category.key)}</b>
              </button>`,
              )
              .join('')}
          </div>
          <label class="qsearch">⌕<input id="qn-search" placeholder="搜索任务名、编号、奖励或说明" value="${esc(state.search)}"></label>
          <button class="quest-tree-open" data-quest-tree title="查看完整任务关系">完整任务树</button>
        </div>
        <div class="q-control-strip">
          <div class="q-period-strip">
            ${resetFilters
              .map(
                // 刷新倒计时收进悬停（2026-08-19 用户点的：常驻文字挤成一团）
                (item) => `<button class="period-timer${state.period === item.period ? ' on' : ''}" data-period="${item.period}" title="${
                  item.reset ? `距刷新 ${fmtDurationLong(item.reset)}` : '不刷新'
                }">
                  <span>${item.label.replace('任务', '')}</span><i>${item.count}</i>
                </button>`,
              )
              .join('')}
          </div>
          <div class="stat-chips">
            <button class="schip${state.status === 'active' ? ' on' : ''}" data-status="active" title="${
              mg.basic?.parallelQuestCount
                ? `游戏同时最多进行 ${mg.basic.parallelQuestCount} 个任务`
                : '同时进行数上限待返港同步'
            }">进行 <b>${active}</b>${mg.basic?.parallelQuestCount ? `<i class="qcap">/${mg.basic.parallelQuestCount}</i>` : ''}</button>
            <button class="schip gold${state.status === 'done' ? ' on' : ''}" data-status="done">待领 <b>${done}</b></button>
            <button class="schip${state.status === 'unaccepted' ? ' on' : ''}" data-status="unaccepted">未领 <b>${unaccepted}</b></button>
            <button class="schip${state.status === 'completed' ? ' on' : ''}" data-status="completed"
              title="由已解锁后续任务反推的单次任务">已完成 <b>${completed}</b></button>
            <button class="schip${state.status === 'current' ? ' on' : ''}" data-status="current"
              title="曾经从游戏任务页同步到本机的任务">已同步 <b>${current}</b></button>
            <button class="schip${state.status === 'all' ? ' on' : ''}" data-status="all">全库 <b>${rows.length}</b></button>
          </div>
          <button class="quick-toggle${state.showQuick || state.quick ? ' on' : ''}" data-quick-toggle>
            更多筛选${state.quick ? ' · 1' : ''}
          </button>
        </div>
        <div class="q-quick-panel${state.showQuick ? ' open' : ''}">
          ${
            // 收起时不渲染也不计数：其中 shipReward 一项要对每行全量扫舰名索引，
            // 面板根本没露面还照算是纯浪费（资源变动一来就是一轮）
            state.showQuick
              ? (() => {
                  const counts = quickFilterCounts(rows)
                  return Object.entries(QUICK_FILTERS)
                    .map(
                      ([key, def]) =>
                        `<button class="quick${state.quick === key ? ' on2' : ''}" data-quick="${key}">${def.label} <i>${counts.get(key) ?? 0}</i></button>`,
                    )
                    .join('')
                })()
              : ''
          }
        </div>
      </div>
      <div class="q-work${selected ? ' drawer-open' : ''}">
        <div class="main">
          <div class="list">${filtered.map(rowHtml).join('') || '<div class="q-empty">没有符合当前筛选条件的任务</div>'}</div>
          <div class="foot">
            <span>${qp?.packCredit ? `<span class="credit-mark" title="${esc(qp.packCredit)}">源</span>` : '任务计数规则尚未就绪'}</span>
            <span style="margin-left:auto">显示 ${filtered.length} / ${rows.length}</span>
          </div>
        </div>
        <aside class="q-drawer${selected ? ' open' : ''}${drawerAlreadyOpen ? ' stable' : ''}" aria-hidden="${selected ? 'false' : 'true'}">
          ${selected ? detailHtml(selected) : ''}
        </aside>
      </div>
    </div>`
  // 没换 DOM 就不能重绑：逐元素监听还在老元素上，再绑一遍就是监听叠加
  if (!commitPaneHtml(pane, 'qn', html)) return

  wire()
}

const wire = () => {
  const searchInput = pane.querySelector<HTMLInputElement>('#qn-search')
  searchInput?.addEventListener('input', () => {
    state.search = searchInput.value
    render()
    pane.querySelector<HTMLInputElement>('#qn-search')?.focus()
  })
  pane.querySelectorAll<HTMLElement>('[data-status]').forEach((chip) =>
    chip.addEventListener('click', () => {
      state.status = chip.dataset.status as typeof state.status
      render()
    }),
  )
  pane.querySelectorAll<HTMLElement>('[data-cat]').forEach((item) =>
    item.addEventListener('click', () => {
      state.category = state.category === item.dataset.cat ? null : item.dataset.cat!
      render()
    }),
  )
  pane.querySelector<HTMLElement>('[data-cat-clear]')?.addEventListener('click', () => {
    state.category = null
    render()
  })
  pane.querySelectorAll<HTMLElement>('[data-period]').forEach((chip) =>
    chip.addEventListener('click', () => {
      state.period = state.period === chip.dataset.period ? null : chip.dataset.period!
      render()
    }),
  )
  pane.querySelectorAll<HTMLElement>('[data-quick]').forEach((item) =>
    item.addEventListener('click', () => {
      state.quick = state.quick === item.dataset.quick ? null : item.dataset.quick!
      render()
    }),
  )
  pane.querySelector<HTMLElement>('[data-quick-toggle]')?.addEventListener('click', () => {
    state.showQuick = !state.showQuick
    render()
  })
  pane.querySelector<HTMLElement>('[data-quest-tree]')?.addEventListener('click', () => {
    void openQuestTreeWindow(state.selected ?? undefined)
  })
  pane.querySelector<HTMLElement>('[data-quest-tree-here]')?.addEventListener('click', () => {
    const id = Number(pane.querySelector<HTMLElement>('[data-quest-tree-here]')?.dataset.questTreeHere)
    void openQuestTreeWindow(Number.isInteger(id) && id > 0 ? id : undefined)
  })
  pane.querySelector<HTMLElement>('[data-q-close]')?.addEventListener('click', () => {
    state.selected = null
    pane.querySelector<HTMLElement>('.q-work.drawer-open')?.classList.remove('drawer-open')
    exitWithMotion(pane.querySelector<HTMLElement>('.q-drawer.open'), 'open', render)
  })
  pane.querySelectorAll<HTMLElement>('[data-q-system]').forEach((button) =>
    button.addEventListener('click', () => {
      activateModule(button.dataset.qSystem!)
    }),
  )
}

// 任务实体路由：单击 → 钦定位并打开侧栏
export const openQuestInManager = (id: number) => {
  activateModule('qn')
  state.selected = id
  state.status = 'all'
  state.category = null
  state.period = null
  state.quick = null
  state.search = ''
  render()
  pane?.querySelector(`.q[data-q="${id}"]`)?.scrollIntoView({ block: 'center' })
}

registerEntityRoute('quest', {
  colorClass: 'e-quest',
  open(ref) {
    openQuestInManager(ref.num)
  },
  peek(ref) {
    const id = ref.num
    const observed = mg.quests[id]
    const entry = lib.get(id)
    if (!observed && !entry) return null
    const inferredCompleted =
      !!entry && periodOf(entry.code)[0] === '单' && inferredCompletedCodes().has(entry.code)
    const [periodLabel] = entry ? periodOf(entry.code) : ['?']
    const media = entry?.memo ? rewardIcons(entry.memo) : ''
    return {
      title: entityNamePlain('quest', id, observed?.title ?? entry?.name ?? `任务 ${id}`),
      typeLabel: `任务 · ${entry?.code ?? ''} ${periodLabel}`,
      media: media ? `<span class="q-rew">${media}</span>` : undefined,
      lines: [
        entry?.desc ? esc(entry.desc) : '（中文资料库尚未收录）',
        inferredCompleted
          ? '✓ 已完成 · 由后续任务解锁状态确认'
          : observed
          ? observed.state === 3
            ? '✓ 已完成，待领取'
            : isQuestActive(id, observed)
              ? `进行中 · ${observed.progressFlag === 2 ? '80%+' : observed.progressFlag === 1 ? '50%+' : '进度 —'}`
              : qp?.progress[id]?.some((count) => count > 0)
                ? '已暂停 · 本地进度已保留'
                : '尚未领取'
          : '未领取（任务资料库）',
        entry?.memo ? esc(entry.memo) : '',
      ].filter(Boolean),
      primary: '任务管理器',
    }
  },
  // 报酬/海域反查已在详情面板内实装（entityChipsHtml），这里给直达目标
  targets: (ref) => {
    const id = ref.num
    const entry = lib.get(id)
    const out: EntityTarget[] = [
      { label: '详情 · 前置任务与奖励', run: () => openQuestInManager(id) },
    ]
    const taskText = entry ? `${entry.name} ${entry.desc} ${taskEntityMemoText(entry.memo2)}` : ''
    const rewardText = entry?.memo ?? ''
    // 报酬道具只读奖励栏；正文里的任务消耗品不能冒充奖励。
    const item = [...useitemNames.entries()].find(
      ([id, name]) =>
        entityAliases('item', id, name).some(
          (alias) => alias.length >= 2 && normalizeEntityText(rewardText).includes(alias),
        ),
    )
    out.push(
      item
        // useitemNames 存的是主数据日文原名（那是给上面别名匹配用的键）；
        // 菜单上屏的那半要查译名，否则右键菜单里就是「奖励道具 · 高速修復材」
        ? {
            label: `奖励道具 · ${entityNamePlain('item', item[0], item[1])}`,
            run: () => navigate({ type: 'useitem', id: item[0] }),
          }
        : { label: '奖励道具', disabled: true, hint: '此任务文本未明确列出道具' },
    )
    // 涉及海域：直达海域图鉴（提取口径与详情面板共用 mapIdsInText）
    const map = entry && taskEntityTextDomainAllowed('map', entry.code)
      ? mapIdsInText(taskText)[0]
      : undefined
    if (map) {
      out.push({
        label: `涉及海域 · ${mapCodeOf(map)}`,
        run: () => navigate({ type: 'map', id: map }),
      })
    }
    return out
  },
})

registerEntityRoute('questBatch', {
  colorClass: 'e-quest',
  open(ref) {
    const ids = `${ref.id}`.split(',').map(Number).filter((id) => id > 0)
    activateModule('qn')
    state.status = 'all'
    state.selected = ids[0] ?? null
    state.category = null
    state.period = null
    state.quick = null
    state.search = ''
    render()
    if (ids[0]) pane?.querySelector(`.q[data-q="${ids[0]}"]`)?.scrollIntoView({ block: 'center' })
  },
  peek(ref) {
    const ids = `${ref.id}`.split(',').map(Number).filter((id) => id > 0)
    if (!ids.length) return null
    return {
      title: `任务完成 ×${ids.length}`,
      typeLabel: '任务批次',
      lines: ids.slice(0, 5).map((id) => entityNamePlain('quest', id, mg.quests[id]?.title ?? lib.get(id)?.name ?? `任务 ${id}`)),
      primary: '展开本批任务',
    }
  },
})

// ---- 实体反查索引（舰娘 / 舰级 / 舰种 / 装备 / 装备类别 / 道具 / 海域 / 远征 / 家具）----
//
// 九张索引全部由主数据（api_start2）现建，而主数据在会话里**会变**：
// 首次运行时 master-raw 可能还没落地（只在 mount 里建一次的话，那一整个会话
// 索引全空、静默失效），活动开幕又会来一份新的 start2（新海域正是最需要
// 认得出来的时候）。所以建索引是一整块可重复调用的函数，由 onMgChange 的
// master 键触发重建——与鉴（ji.ts）同一套做法。
const buildEntityIndexes = (
  data: any,
  expeditionLode: { data?: any } | null,
  kcwikiShipLode: { data?: any } | null = null,
) => {
  const friendly: any[] = []
  const shipById = new Map<number, any>()
  for (const s of data.api_mst_ship ?? []) {
    if (s.api_sortno) {
      friendly.push(s)
      shipById.set(s.api_id, s)
    }
  }
  // 改造链归属只认 shared/ship-remodel-chain：自己搭并查集就是第二套口径，
  // 可逆改装（改二⇄乙/丙）的回环边会让手搓的链根断在半路，与图鉴说法分叉。
  // 改造表**盖不全**：不需要设计图/图纸的那些改造根本不在 api_mst_shipupgrade 里
  //（实测 Tuscaloosa 923→928 就没有条目），所以每艘舰自己的 aftershipid 必须
  // 一并喂进去，由那边逐目标回退——不能因为升级表非空就整体弃用 aftershipid。
  const remodelShips: RemodelChainShip[] = []
  for (const ship of friendly) {
    const after = Number(ship.api_aftershipid)
    remodelShips.push({
      id: Number(ship.api_id),
      sortNo: Number(ship.api_sortno) || Number(ship.api_id),
      afterId: after > 0 ? after : 0,
    })
  }
  const chains = buildShipRemodelChains(
    remodelShips,
    (data.api_mst_shipupgrade ?? []).map((upgrade: any) => ({
      targetId: Number(upgrade?.api_id) || 0,
      currentShipId: Number(upgrade?.api_current_ship_id) || 0,
      originalShipId: Number(upgrade?.api_original_ship_id) || 0,
      stage: Number(upgrade?.api_upgrade_level) || 0,
    })),
  )
  // chainOf 的键就是根形态，值已经按「离根多远」排好——与图鉴同一份归属
  shipNameIndex = [...chains.chainOf.entries()].flatMap(([rootId, memberIds]) => {
    const root = shipById.get(rootId)
    if (!root) return []
    const aliases = memberIds.flatMap((id) => {
      const form = shipById.get(id)
      return form
        ? entityAliases('ship', id, `${form.api_name ?? ''}`, TASK_SHIP_TEXT_ALIASES[id] ?? [])
        : []
    })
    const uniqueAliases = [...new Set(aliases)].sort((a, b) => b.length - a.length)
    return [
      {
        id: Number(root.api_id),
        name: `${root.api_name ?? ''}`,
        simple: uniqueAliases[0] ?? normalizeEntityText(`${root.api_name ?? ''}`),
        aliases: uniqueAliases,
        ctype: Number(root.api_ctype) || 0,
        stype: Number(root.api_stype) || 0,
        sortNo: Number(root.api_sortno) || Number(root.api_id),
        members: [...memberIds],
      },
    ]
  })
  const rootsByClass = new Map<number, ShipNameEntry[]>()
  for (const ship of shipNameIndex) {
    if (!ship.ctype) continue
    const members = rootsByClass.get(ship.ctype) ?? []
    members.push(ship)
    rootsByClass.set(ship.ctype, members)
  }
  // 舰级名走与图鉴同一份真名索引（shared/ship-class-name）——「该级图鉴编号最小的那艘 + 级」
  // 那个启发式被 api_sortno 的历史怪癖坑了（雪風 sortno=5 而 陽炎=91，阳炎型显示成雪风级），
  // 140 个舰级里 53 个是错的。分类是基础设施，两个模块必须同一个出口，不许各参照各的。
  const trueClassName = buildShipClassNameIndex(
    Object.values((kcwikiShipLode?.data ?? {}) as Record<string, ShipClassNameRow>),
    (mstId) => Number(shipById.get(mstId)?.api_ctype) || 0,
  )
  shipClassIndex = [...rootsByClass.entries()].map(([ctype, members]) => {
    members.sort((a, b) => a.sortNo - b.sortNo)
    const lead = members[0]
    const leadAliases = entityAliases('ship', lead.id, lead.name)
    const heuristic = `${entityNamePlain('ship', lead.id, lead.name)}级`
    const label = trueClassName.get(ctype) || heuristic
    // 旧写法（首舰名 + 型/级）**留在别名里**：任务文本与用户输入里两种叫法都有，
    // 正名是把显示名改对，不是把「雪风级」这个说法从反查里删掉。
    const aliases = [
      ...leadAliases.flatMap((name) => [`${name}型`, `${name}级`]),
      normalizeEntityText(heuristic),
      normalizeEntityText(label),
      ...(label.endsWith('级') ? [normalizeEntityText(`${label.slice(0, -1)}型`)] : []),
      `舰级${ctype}`,
    ]
    return {
      id: ctype,
      name: label,
      simple: normalizeEntityText(label),
      aliases: [...new Set(aliases.filter(Boolean))].sort((a, b) => b.length - a.length),
      members,
    }
  })
  const friendlyShipTypeIds = new Set(friendly.map((ship) => Number(ship.api_stype)))
  shipTypeIndex = (data.api_mst_stype ?? [])
    .filter((type: any) => friendlyShipTypeIds.has(Number(type.api_id)))
    .map((type: any) => {
      const blocked = SHIP_TYPE_GENERIC_ALIASES[type.api_id] ?? new Set<string>()
      const aliases = entityAliases(
        'shipType',
        type.api_id,
        type.api_name,
        SHIP_TYPE_ALIASES[type.api_id] ?? [],
      ).filter((alias) => !blocked.has(alias))
      return {
        id: type.api_id,
        name: SHIP_TYPE_LABELS[type.api_id] ?? entityNamePlain('shipType', type.api_id, type.api_name),
        simple: aliases[0] ?? normalizeEntityText(type.api_name),
        aliases,
      }
    })
  equipNameIndex = (data.api_mst_slotitem ?? [])
    .filter((e: any) => e.api_id < 1500)
    .map((equip: any) => {
      const aliases = entityAliases('equip', equip.api_id, equip.api_name)
      return {
        id: equip.api_id,
        name: equip.api_name,
        simple: aliases[0] ?? normalizeEntityText(equip.api_name),
        aliases,
      }
    })
  useitemNames = new Map(
    (data.api_mst_useitem ?? []).map((u: any) => [u.api_id, u.api_name]),
  )
  invalidateAwardMask() // 名册来源变了,字节命中防线的缓存跟着重建
  rewardEquipCache.clear() // 装备索引重建：奖励图标里的装备兜底跟着重算
  itemNameIndex = (data.api_mst_useitem ?? []).map((item: any) => {
    const aliases = entityAliases('item', item.api_id, item.api_name)
    return {
      id: item.api_id,
      name: entityNamePlain('item', item.api_id, item.api_name),
      simple: aliases[0] ?? normalizeEntityText(item.api_name),
      aliases,
    }
  })
  mapNameIndex = (data.api_mst_mapinfo ?? []).map((map: any) => {
    const code = `${map.api_maparea_id}-${map.api_no}`
    const localized = entityNamePlain('map', map.api_id, map.api_name)
    const nameSegments = [map.api_name, localized]
      .flatMap((name) => `${name}`.split(/[／/]/))
      .map((name) => name.trim())
      .filter((name) => name.length >= 2)
    const aliases = entityAliases('map', map.api_id, map.api_name, [code, ...nameSegments])
    return { id: map.api_id, name: code, simple: normalizeEntityText(code), aliases }
  })
  mapIds = new Set(mapNameIndex.map((map) => map.id))
  equiptypeNames = new Map(
    (data.api_mst_slotitem_equiptype ?? []).map((t: any) => [t.api_id, t.api_name]),
  )
  equipTypeIndex = (data.api_mst_slotitem_equiptype ?? []).map((type: any) => {
    const blocked = EQUIP_TYPE_GENERIC_ALIASES[type.api_id] ?? new Set<string>()
    const aliases = entityAliases(
      'equipType',
      type.api_id,
      type.api_name,
      EQUIP_TYPE_ALIASES[type.api_id] ?? [],
    ).filter((alias) => !blocked.has(alias))
    return {
      id: type.api_id,
      name: entityNamePlain('equipType', type.api_id, type.api_name),
      simple: aliases[0] ?? normalizeEntityText(type.api_name),
      aliases,
    }
  })
  missionNameIndex = (data.api_mst_mission ?? []).map((mission: any) => {
    const localized = expeditionLode?.data?.[`${mission.api_disp_no ?? ''}`]
    if (localized?.nameZh) {
      registerLocalizedName(
        'expedition',
        mission.api_id,
        mission.api_name,
        localized.nameZh,
        'kcwiki-expedition',
      )
    }
    const aliases = entityAliases('expedition', mission.api_id, mission.api_name, [
      `${mission.api_disp_no ?? ''}`,
      `${localized?.nameJp ?? ''}`,
      `${localized?.nameZh ?? ''}`,
    ])
    return {
      id: mission.api_id,
      name: localized?.nameZh ?? entityNamePlain('expedition', mission.api_id, mission.api_name),
      simple: aliases[0] ?? normalizeEntityText(mission.api_name),
      aliases,
    }
  })
  // 家具名：无中文矿脉，原名照排。任务库写法是简化转写（「掛け軸」→「挂け轴」），
  // 靠 JP2CN 两侧归并对齐；≥4 字才收——「椅子」这种短名在奖励文本里会乱撞。
  furnitureNameIndex = (data.api_mst_furniture ?? [])
    .filter((f: any) => `${f.api_title ?? ''}`.length >= 4)
    .map((f: any) => ({
      id: f.api_id,
      name: `${f.api_title}`,
      simple: normalizeEntityText(f.api_title),
      aliases: [normalizeEntityText(f.api_title)].filter(Boolean),
    }))
  entityIndexVersion += 1
  quickCountCache = null // 「有舰娘奖励」那一项是拿索引数出来的
}

/** 取主数据重建索引；master-raw 还没落地就如实返回 false，等下一次 master 补建。 */
const refreshEntityIndexes = async (): Promise<boolean> => {
  const [raw, expeditionLode, kcwikiShipLode] = await Promise.all([
    queryMasterRaw(),
    queryLode('kcwiki-expedition'),
    // 舰级真名（`级别` 字段）。缺包只是退回启发式级名，不该让整套索引建不起来
    queryLode('kcwiki-ships'),
  ])
  if (!raw?.data) return false
  buildEntityIndexes(raw.data, expeditionLode, kcwikiShipLode)
  return true
}

registerModule({
  id: 'qn',
  title: '任务',
  order: 6,
  mount(el) {
    pane = el
    // 下面这些订阅都要进装配作用域：mount 中途抛错后点「重试装配」会再走一遍，
    // 不退订就是双注册（任务树里点一个任务，主窗口会开两次）。
    // trackMountCleanup 只在**同步阶段**登记得上——作用域到 mount 返回就关了。
    const focusQuestFromTree = (_event: unknown, rawId: unknown) => {
      const id = Number(rawId)
      if (Number.isInteger(id) && id > 0) openQuestInManager(id)
    }
    qnIpc.on('window:quest-tree-focus', focusQuestFromTree)
    trackMountCleanup(() => qnIpc.removeListener('window:quest-tree-focus', focusQuestFromTree))
    const paneResize = new ResizeObserver(() => {
      // 切走时 clientWidth 会归 0，不守 active 就会对着看不见的面板全量重渲染
      if (!pane.classList.contains('active')) return
      const narrow = pane.clientWidth < 700
      if (pane.classList.contains('narrow') !== narrow) {
        pane.classList.toggle('narrow', narrow)
        render()
      }
    })
    paneResize.observe(pane)
    trackMountCleanup(() => paneResize.disconnect())
    // 精确计数的增量订阅。原先写在 await 之后：那时装配作用域已经关了，
    // trackForMountScope 直接 return，退订根本没登记。回调只是重绘，
    // 与 qp 取回没有先后关系，挪到同步阶段注册即可。
    onQpChange(() => {
      quickCountEpoch += 1
      if (pane.classList.contains('active')) render()
    })
    // 任务行只负责打开侧栏；详情内按钮与实体链接各自处理。
    pane.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.el, input, button, summary')) return
      const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')
      if (!rowEl) return
      const id = parseInt(rowEl.dataset.q!, 10)
      // 再次点击同一行 = 返回列表。走的是与右上角关闭同一套退场动画，
      // 否则两条路径关出来的观感不一样。
      if (state.selected === id) {
        state.selected = null
        pane.querySelector<HTMLElement>('.q-work.drawer-open')?.classList.remove('drawer-open')
        exitWithMotion(pane.querySelector<HTMLElement>('.q-drawer.open'), 'open', render)
        return
      }
      state.selected = id
      render()
    })
    void (async () => {
      // 反查索引：舰娘（根形态）/舰级/舰种/装备/道具/海域/远征/家具。
      // 主数据这会儿可能还没到；到了会经 onMgChange 的 master 键补建。
      await refreshEntityIndexes()
      // 精确计数：铭引擎镜像（增量订阅在上面的同步阶段就挂好了）
      qp = await queryQp()
      quickCountEpoch += 1
      scnLode = await queryLode('quests-scn')
      // wikiwiki 前提链（抓取时已 EO 公证对齐）：补 scn 缺口、修悬空码、标冲突
      const wwLode = await queryLode('wikiwiki-quests')
      const wwByCode = new Map<string, WwQuestPre>(
        wwLode?.data && typeof wwLode.data === 'object'
          ? Object.entries<any>(wwLode.data).map(([code, raw]) => [code, raw as WwQuestPre])
          : [],
      )
      lib = new Map()
      libByCode = new Map()
      invalidateQuestTextCache()
      if (scnLode?.data) {
        for (const [idStr, raw] of Object.entries<any>(scnLode.data)) {
          const entry: LibQuest = {
            id: parseInt(idStr, 10),
            code: raw.code ?? '?',
            name: raw.name ?? '',
            desc: raw.desc ?? '',
            memo: raw.memo ?? '',
            memo2: raw.memo2 ?? '',
            pre: Array.isArray(raw.pre) ? raw.pre : [],
          }
          lib.set(entry.id, entry)
          libByCode.set(entry.code, entry)
        }
        // 第二遍：知道全部库内码之后才能做合并（悬空判定需要全集）
        const knownCodes = new Set(libByCode.keys())
        for (const entry of lib.values()) {
          const merged = mergeQuestPre(
            entry.pre,
            wwByCode.get(entry.code),
            knownCodes,
            QUEST_PRE_ARBITRATION.get(entry.code),
          )
          entry.pre = merged.pre
          entry.preInfo = merged
        }
      }
      await refreshFleetCheck()
      render()
    })()
    onMgChange((keys) => {
      // 主数据换了（首次落地、或活动开幕的新 start2）→ 九张反查索引整体重建。
      // 只在 mount 建一次的话，首次运行拿不到 master-raw 就整会话空着，
      // 活动新海域也永远认不出来。
      if (keys.includes('master')) {
        void refreshEntityIndexes().then((rebuilt) => {
          if (rebuilt && pane.classList.contains('active')) render()
        })
      }
      // 编成变了 / 任务变了 → 重判「当前编成可直接做」
      if (
        keys.some((k) =>
          ['quests', 'decks', 'ships', 'slotitems', 'useitems', 'materials'].includes(k),
        )
      ) scheduleFleetCheck()
      if (
        keys.some((key) => ['quests', 'slotitems', 'mapGauges', 'useitems', 'materials'].includes(key)) &&
        pane.classList.contains('active')
      ) {
        // 用户正按在这块面板上就让到抬起之后：按下与抬起之间换掉 DOM，click 不会发生
        if (!deferWhilePressed(pane, 'qn', render)) render()
      }
    })
    let lastQuickFilterMinute = -1
    onTick(() => {
      if (!pane.classList.contains('active')) return
      updateCountdowns(pane)
      // “即将重置”是随时间跨阈值的派生筛选；只改倒计时文字会让结果集停在旧状态。
      const minute = Math.floor(Date.now() / 60000)
      if (state.quick === 'resetSoon' && minute !== lastQuickFilterMinute) {
        lastQuickFilterMinute = minute
        render()
      }
    })
  },
  onShow: () => render(),
})
