// 海域情报目录的内置兜底保留 1-1；完整常规海域由本地 map-intel 矿脉包覆盖。
// 只记录“已确认能掉”和离散敌编成，不记录概率；未列出不等于确认不会出现。
// 目录可由 %APPDATA%/kanso/lodes/map-intel.json 覆盖，UI 无需随资料更新而改代码。

import {
  isActiveLimitedWindow,
  isClosedLimitedWindow,
  isEndedLimitedWindow,
} from './limited-window'
import { correctLegacyDropForm } from './map-drop-corrections'

import type { LimitedEvidence, LimitedWindow } from './limited-window'

// 限定期窗口的类型与判据住在 shared/limited-window（运行时与 scripts/ 共用同一份）。
// 这里原样转出去，免得各处 import 路径分成两套。
export type {
  LimitedDropStatus,
  LimitedEvidence,
  LimitedWindow,
  LimitedWindowPhase,
  LocalDropEra,
  LocalDropEraVerdict,
} from './limited-window'
export {
  isActiveLimitedWindow,
  isClosedLimitedWindow,
  isEndedLimitedWindow,
  limitedWindowCovers,
  limitedWindowPhase,
  limitedWindowText,
  localDropEraOf,
} from './limited-window'

export interface ConfirmedDropShip {
  id: number
  limited?: LimitedWindow
  limitedHistory?: LimitedWindow[]
  limitedOnly?: boolean
  /**
   * 印证票（活动图 2026-08-24 起有）：这条掉落有哪几方独立说过。
   *
   * **运行时一行都不读**，与 `ConfirmedEnemyComp.votes` 同一条口径——
   * 印证状态只给维护者侧工具看，UI 不逐条挂标。
   */
  votes?: string[]
}

export interface ConfirmedEnemyComp {
  formation: number | string
  // wiki 原样的标注名。带着主数据没有的信息（「(艦載機白赤)」「(前哨戦)」），
  // 所以即使定了号也不替换掉——界面照旧显示它。
  ships: (number | string)[]
  /**
   * 与 `ships` 等长的 wiki 标注文本（第一方汇编包才有）。
   *
   * 汇编包的 `ships` 全是数字（上游直接给号），标注文本改长在这里。
   * 展示层优先用它——「軽母ヌ級改 flagship 艦載機鳥赤」里的形态注解是主数据
   * 没有的那一半信息，只按号取主数据名会把它整段丢掉。
   */
  labels?: string[]
  /**
   * 印证票（第一方汇编包才有）：这条编成有哪几方独立说过。
   *
   * **运行时一行都不读。** 印证状态只给维护者侧工具看，UI 不逐条挂标——
   * 逐条挂「单源待印证」是在给玩家派活，而不是给线索。
   */
  votes?: string[]
  /** 源间互斥、等人裁的那几条（同上，运行时不读）。 */
  conflict?: string
  // 与 ships 等长的 mstId。只有整套都定下来了才会有这个字段，缺一位就整条不写——
  // 半截的号比没有更危险。运行时的编成匹配只认它，绝不在运行时对名字做模糊匹配。
  //
  // 常规图 2026-08-22 起改吃第一方汇编包，`ships` 本身就是号，这一格用不上了；
  // 活动图 2026-08-24 起同样从舰娘百科「深海配置」原生取号，
  // `ships` 也是号了——两边都不再产出这个字段。**读的那一侧仍留着**：
  // 它是旧包的形状，玩家包目录里可能还躺着一份没更新的 map-intel.json。
  shipIds?: number[]
  // 只在资料表明确写出削血/最终/通关后时记录，不根据敌舰名称猜测。
  phase?: string
  /**
   * 这套编成的基础经验（wikiwiki 敌编成表的 EXP 列）。
   *
   * 二期起「同じマスでも敵編成が強力なほど経験値が多くなる」——经验是**按编成**
   * 给的，不是按节点。所以它长在这里而不是 MapIntelNode 上：粒度天生对齐。
   * 资料没给就没有这个字段，不填 0（0 会被读成「这一战没经验」）。
   */
  exp?: number
}

/**
 * 一套确认编成的 mstId 序列；拿不到就是 null，调用方据此整套跳过。
 *
 * 两种来源：维护期定号写下的 shipIds，或者资料本来就是数字（内置样例、
 * 以后直接收号的源）。**不做任何运行时的名字解析**——同名多形态一旦猜错，
 * 战斗界面就会对着玩家说错敌人是谁，那比少一条线索坏得多。
 */
export const enemyCompIds = (comp: ConfirmedEnemyComp): number[] | null => {
  if (comp.shipIds?.length === comp.ships.length && comp.shipIds.every((id) => id > 0)) {
    return comp.shipIds
  }
  return comp.ships.every((ship) => typeof ship === 'number')
    ? (comp.ships as number[])
    : null
}

/**
 * 一套编成的身份：**舰列 mst 序列**，阵形不算在内。
 *
 * 判据不是新造的，是镝战前匹配那一套（`previewEncounterCandidates`，2026-08-12 定）：
 * 同一套舰列只算一个候选，本地遭遇/确认目录、单纵/梯形都只是它的属性；
 * 且目录一格常写多个阵形（単縦 複縦 梯形），与本地的数字阵形永远对不上——
 * 把阵形并进签名，同一套编成会被拆成四五份，对照当场失效。
 */
export const compSignature = (ids: readonly number[]): string => ids.join(',')

export interface CatalogEncounterTally {
  /** 目录里定得到号的舰列签名——「你的实测」按它挂「目录 ✓」 */
  catalog: Set<string>
  /** 本地遭遇过的舰列签名——「确认目录」按它决定哪几套不必再列 */
  local: Set<string>
  /** 目录收录的编成总数，与卡头「已确认 N 种」同一个数 */
  total: number
  /** 其中你已经遇到过的套数 */
  seen: number
}

/**
 * 「你的实测」与「确认目录」的对照表。
 *
 * 数据分层照旧**并列不合并**（2026-08-22 用户拍板）：目录是资料，实测是亲历，
 * 证据强度不同。这里算的只喂展示——同一套编成不必在一张卡上原样出现两遍。
 *
 * 定不到号的目录编成（`enemyCompIds` 给不出 ids）一律算「没遇过」照常列出：
 * 拿标注在运行时反解会指错形态，那比多列一行坏得多。
 */
export const catalogEncounterTally = (
  localComps: readonly (readonly number[])[],
  catalogComps: readonly ConfirmedEnemyComp[],
): CatalogEncounterTally => {
  const local = new Set(localComps.map((ids) => compSignature(ids.filter((id) => id > 0))))
  const catalog = new Set<string>()
  let seen = 0
  for (const comp of catalogComps) {
    const ids = enemyCompIds(comp)
    if (!ids) continue
    const signature = compSignature(ids)
    catalog.add(signature)
    if (local.has(signature)) seen += 1
  }
  return { catalog, local, total: catalogComps.length, seen }
}

/** 这套目录编成还要不要列出来：已经在「你的实测」里原样列过的就不列第二遍。 */
export const catalogCompUnseen = (
  comp: ConfirmedEnemyComp,
  tally: CatalogEncounterTally,
): boolean => {
  const ids = enemyCompIds(comp)
  return !ids || !tally.local.has(compSignature(ids))
}

/**
 * 「确认目录」那一段的计数行；一套都没遇过时返回 null（这一行不出场）。
 *
 * 一套都没遇过 → 不出行：目录整段照旧全列，卡头的「已确认 N 种」已经说了总量。
 * 部分遇过     → 「确认编成 3 种 · 已遇 2」，正文只剩没遇过的那几套。
 * 全都遇过     → 「确认编成 3 种 · 都遇到过」，一行编成都不再列，这一行就是整段。
 */
export const catalogTallyText = (tally: CatalogEncounterTally): string | null => {
  if (!tally.seen) return null
  const rest = tally.seen >= tally.total ? '全部已遇' : `已遇 ${tally.seen}`
  return `确认编成 ${tally.total} 种 · ${rest}`
}

export interface MapIntelNode {
  ships: ConfirmedDropShip[]
  emptyDrop: 'confirmed' | 'unknown'
  enemyComps: ConfirmedEnemyComp[]
}

export const EVENT_DIFFICULTIES = ['甲', '乙', '丙', '丁'] as const
export type EventDifficulty = (typeof EVENT_DIFFICULTIES)[number]

export interface MapIntelDifficulty {
  nodes: Record<string, MapIntelNode>
  operations?: EventOperations
}

export interface EventGimmick {
  title: string
  steps: string[]
}

export interface EventSpecialShip {
  id?: number
  label: string
  effect: string
}

export interface EventFriendlyFleet {
  ships: { id?: number; name: string }[]
  note?: string
}

export interface EventOperations {
  gimmicks: EventGimmick[]
  specialShips: EventSpecialShip[]
  friendlyFleets: EventFriendlyFleet[]
  // 目标点 → 基地航空所需最小行动半径；只收资料表明确给出的数字。
  nodeDistances: Record<string, number>
}

export interface EventIntelLifecycle {
  name: string
  from: string
  until: string | null
  status: 'active' | 'ended'
  phaseOpenedAt: string
  lifecycleSourceUrl?: string
}

// 海域撃破ボーナス的一行：共通 + 各难度追加。text 是 wiki 原文照录
// （日文装备名/选择肢/★+N/xN），展示层不拆不译，「なし」也原样保留。
export interface MapBreakthroughReward {
  scope: string // 共通 / 甲 / 乙 / 丙 / 丁
  text: string
}

export interface MapIntelMap {
  source: string
  sourceUrl: string
  /**
   * 同一张图的中文页（舰娘百科）。活动图的抓取器一直在写这一格
   * （`fetch-map-intel-event.mjs` 的 `kcwikiUrl`），只是从前没在这里声明。
   * 面向玩家的外链优先取它——`sourceUrl` 是 wikiwiki 日文页，中文界面里是降级。
   */
  kcwikiUrl?: string
  checkedAt: string
  revision: string
  event?: EventIntelLifecycle
  // 常规海域直接使用 nodes；活动海域只能使用 difficulties，避免跨难度混表。
  nodes?: Record<string, MapIntelNode>
  difficulties?: Partial<Record<EventDifficulty, MapIntelDifficulty>>
  // 活动图的海域撃破ボーナス（图级：各难度行同出一张表）
  rewards?: MapBreakthroughReward[]
  /**
   * 全难度合算掉落（图级，点名 → 舰）。来自上游「ドロップ艦一覧」那张**不分难度**的
   * 总表——它按点位铺开，把途中点也收了，而分难度那张「難易度別レア艦ドロップ」
   * 只逐点收 boss 与个别点（2026-08-26 实测 62-4 该区只有 8 张表，P1 出现 0 次）。
   *
   * ⚠ 这一层是甲乙丙丁的**合算**，不是任何一层的事实：
   * 绝不允许并进 `difficulties[x].nodes[y].ships`。读它只能走 `nodeDropCatalog()`，
   * 那里会把「这一格是合算来的」一并交出来，展示层必须据此标「不分难度」。
   */
  allDiffDrops?: Record<string, ConfirmedDropShip[]>
}

export interface MapIntelCatalog {
  schemaVersion: 1
  maps: Record<string, MapIntelMap>
}

/**
 * 常规海域敌编成的第一方汇编包（`map-enemy-comps`）。
 *
 * 它只管**敌编成这一域**：掉落、限定窗口、空掉落标记、活动图各难度层仍旧由
 * `map-intel` 供给。装配时按 (图, 点) 覆盖 `enemyComps`，其余字段一律不动——
 * 换一个域就把整包换掉，会把还没换源的那几域一起弄丢。
 */
export interface MapEnemyCompsMap {
  source: string
  sourceUrl: string
  checkedAt: string
  revision: string
  /** 上游页面最后一次非机器人编辑（内容的真实年龄，可缺） */
  contentDate?: string
  nodes: Record<string, ConfirmedEnemyComp[]>
}

export interface MapEnemyCompsCatalog {
  schemaVersion: 1
  compiledAt: string
  voters?: Record<string, string>
  maps: Record<string, MapEnemyCompsMap>
}

/**
 * 常规海域**确认掉落**的第一方汇编包（`map-drops`，2026-08-22 起）。
 *
 * 它只管掉落与节点级的空掉落标记这一域：**限定期窗口仍旧由 `map-intel` 供**，装配时
 * 按 (图, 点, 舰) 把 `limited` / `limitedOnly` / `limitedHistory` 原样带过去——
 * 换一个域就把整包换掉，会把限定期一起弄丢，
 * 界面上表现成「限时标全没了」，而且一条报错都不会有。
 */
export interface MapDropShip {
  id: number
  /**
   * 印证票（多源汇编的内部状态）。**运行时一行都不读**，UI 不逐条挂标。
   *
   * ⚠ 这一域的票不独立：kcwiki 常规海域页页脚 37/37 自述「主要数据来源为日wiki」，
   * 所以 `['kcwiki','wikiwiki']` 只是同源转录，不是两条独立路径。判据写在
   * scripts/lib/map-drops.mjs 的文件头。
   */
  votes?: string[]
}

export interface MapDropsNode {
  emptyDrop: 'confirmed' | 'unknown'
  emptyDropVotes?: string[]
  ships: MapDropShip[]
}

export interface MapDropsMap {
  source: string
  sourceUrl: string
  checkedAt: string
  revision: string
  /** 上游页面最后一次非机器人编辑（内容的真实年龄，可缺） */
  contentDate?: string
  nodes: Record<string, MapDropsNode>
}

export interface MapDropsCatalog {
  schemaVersion: 1
  compiledAt: string
  voters?: Record<string, string>
  /** 上游自己写的来源自述，原文照录（算票独立性的判据） */
  sourceNotes?: string[]
  maps: Record<string, MapDropsMap>
}

/**
 * 常规海域**限定期窗口**的第一方台账（`map-drop-windows`，2026-08-22 起）。
 *
 * 为什么这一域要单独一个包、而且是**手工维护**的：限定期的开始日、批次标签、
 * 「现在还开着吗」这几格，穷举过的社区机读源里只有一家给（§2.4a 八条穷举），
 * 而那一家的许可不允许随包分发。所以发布侧的做法是——**事实自己记一份台账**
 *（哪张图哪个点从哪天起掉哪条船，是运营行为事实，不受著作权保护），
 * 抓取脚本降为维护者侧的对照工具（`eo-quests` 地位），不再是随包数据的产地。
 *
 * 键是 `(图, 点, 舰)`，舰号一律是**改钉后**的形态号（见 map-drop-corrections）——
 * 掉落汇编层 `map-drops` 出包时也按改钉后的号存，两边不同键就会静默对不上。
 *
 * 装配时它是这一域的**唯一出处**：底座 `map-intel` 里那份同名数据在覆盖到的图上
 * 一律先清空再按台账写，不做「哪边有取哪边」的兜底——两个出处并存的结果是
 * 谁也说不清界面上那个「限时」标到底是谁给的。
 */
export interface MapDropWindowEntry {
  /** 舰的 mstId（改钉后的形态号） */
  id: number
  /** 只在限定期掉（平时来这一点捞不到） */
  limitedOnly?: boolean
  /** 当前这一段窗口 */
  window: LimitedWindow
  /** 之前那几段（同一条船在同一点开过多次限定期） */
  history?: LimitedWindow[]
  /** 这一条凭什么这么写。台账里每条必须有。 */
  evidence: LimitedEvidence
  /**
   * 印证票（多源汇编的内部状态）。**运行时一行都不读**，UI 不逐条挂标。
   * `ledger` = 本机遭遇志在这张图确实捞到过它，是这一域唯一独立于社区资料的一票。
   */
  votes?: string[]
  /** 源间互斥、等人裁的那几条（同上，运行时不读）。值是待裁台账里的 kind。 */
  conflict?: string
}

export interface MapDropWindowsCatalog {
  schemaVersion: 1
  compiledAt: string
  /** 台账最后一次逐条核对的日子。展示层的「资料核对」说这一格自己的日期。 */
  checkedAt: string
  source: string
  revision: string
  voters?: Record<string, string>
  /** 图代号 → 点位 → 条目 */
  maps: Record<string, Record<string, MapDropWindowEntry[]>>
}

export interface ResolvedMapIntel extends MapIntelMap {
  nodes: Record<string, MapIntelNode>
  difficulty?: EventDifficulty
  operations?: EventOperations
}

const limited = (from: string): LimitedWindow => ({
  from,
  until: null,
  lastConfirmedAt: '2026-06-26',
  status: 'active_confirmed',
  statusChangedAt: '2026-06-26',
})

const A_DESTROYERS = [
  1, 2, 28, 29, 6, 30, 7, 31,
  9, 10, 32, 11, 12,
  13, 14, 93, 15, 16,
  34, 35, 36, 37,
  38, 39, 40, 41,
  43, 44, 45, 46,
  96, 97, 98, 48, 49,
]

const BUILTIN_MAP_INTEL: MapIntelCatalog = {
  schemaVersion: 1,
  maps: {
    '1-1': {
      source: '艦これ攻略 Wiki',
      sourceUrl: 'https://wikiwiki.jp/kancolle/鎮守府海域/1-1',
      checkedAt: '2026-08-04',
      revision: '2026.08.04.1',
      nodes: {
        A: {
          ships: [...A_DESTROYERS.map((id) => ({ id })), { id: 56 }],
          emptyDrop: 'unknown',
          enemyComps: [
            { formation: 1, ships: [1501] },
            { formation: 1, ships: [1502] },
            { formation: 1, ships: [1503] },
          ],
        },
        B: {
          ships: [
            ...A_DESTROYERS.map((id) => ({ id })),
            { id: 47 },
            { id: 55 },
            { id: 56 },
          ],
          emptyDrop: 'unknown',
          enemyComps: [
            { formation: 1, ships: [1501, 1501] },
            { formation: 1, ships: [1502, 1502] },
            { formation: 1, ships: [1503, 1503] },
          ],
        },
        C: {
          ships: [
            { id: 1 }, { id: 2 }, { id: 28 }, { id: 29 }, { id: 6 }, { id: 30 }, { id: 7 }, { id: 31 },
            { id: 9 }, { id: 10 }, { id: 32 }, { id: 11 }, { id: 33 }, { id: 12 },
            { id: 13 }, { id: 14 }, { id: 93 }, { id: 15 }, { id: 94 }, { id: 16 },
            { id: 34 }, { id: 35 }, { id: 36 }, { id: 37 },
            { id: 38 }, { id: 39 }, { id: 40 }, { id: 41 },
            { id: 42 }, { id: 43 }, { id: 44 }, { id: 45 }, { id: 46 },
            { id: 457, limited: limited('2025-10-29') }, { id: 47 },
            { id: 95 }, { id: 96 }, { id: 97 }, { id: 98 }, { id: 48 }, { id: 49 },
            { id: 17 }, { id: 18 }, { id: 19 },
            { id: 51 }, { id: 52 }, { id: 100 }, { id: 54 }, { id: 55 }, { id: 56 },
            { id: 89, limited: limited('2025-01-28') },
            { id: 465, limited: limited('2026-04-24') },
            { id: 451, limited: limited('2025-01-28') },
          ],
          emptyDrop: 'confirmed',
          enemyComps: [
            { formation: 1, ships: [1505, 1501, 1501] },
            { formation: 1, ships: [1505, 1502, 1502] },
            { formation: 1, ships: [1505, 1503, 1502, 1502] },
          ],
        },
      },
    },
  },
}

// 四层装配：底座（map-intel，活动图难度层与活动图的掉落编成）
// + 常规图敌编成汇编层 + 常规图掉落汇编层 + 常规图限定期台账。
// 四个包各自到达的顺序不定，所以谁到了都重装一次，别指望装载顺序。
//
// **顺序在 rebuildCatalog 里是固定的**：限定期台账必须最后叠——掉落层会整格重写
// `ships`，先叠台账等于把刚写上去的窗口再抹掉一次，而且形状没变、一条报错都不会有。
let baseCatalog = BUILTIN_MAP_INTEL
let enemyCompsCatalog: MapEnemyCompsCatalog | null = null
let dropsCatalog: MapDropsCatalog | null = null
let dropWindowsCatalog: MapDropWindowsCatalog | null = null
let activeCatalog = BUILTIN_MAP_INTEL
// 目录代号：换目录 +1。下游的反向索引缓存（深海「遭遇地点」等）拿它当失效键，
// 不必每次渲染都全目录重扫。
let catalogGeneration = 0
export const mapIntelGeneration = () => catalogGeneration

/**
 * 汇编层覆盖到某张图时，底座没有它就现建一张空壳。
 *
 * **这里是整层丢弃的必经之处**（2026-08-22 发布前验收）：原先三个叠加函数都写着
 * 「底座没有的图不新建」，理由是「只有编成没有掉落 = 半张图」。但底座 `map-intel`
 * 是禁品、**永不随包**，玩家那份产物里的底座只有内置兜底的 1-1 一张——
 * 于是 37 图掉落 + 37 图敌编成 + 25 图限定期在 1-1 以外**整层被丢弃**，
 * 界面上一律显示「本地目录待更新」。开发机上看不出来（仓库里有底座），
 * 只有打包产物 + 空的用户包目录才照得出。
 *
 * 「半张图」那条顾虑现在由**展示层**接住而不是靠不建图：掉落与编成两层覆盖同样
 * 37 张图、同时随包，只有一层到货是瞬态；而「这一域这张图有没有人供数据」有
 * `mapDropsInfo` / `mapEnemyCompsInfo` 可查，展示层据此说「待更新」而不是「0 条」。
 */
const ensureMapShell = (
  maps: Record<string, MapIntelMap>,
  code: string,
  layer: { source: string; sourceUrl: string; checkedAt: string; revision: string },
): MapIntelMap | null => {
  const entry = maps[code]
  // 活动图走 difficulties 分层，两个常规图汇编层都不覆盖它：有这张图但没有 nodes
  // 就是活动图，一格都不许碰。
  if (entry) return entry.nodes ? entry : null
  return {
    source: layer.source,
    sourceUrl: layer.sourceUrl,
    checkedAt: layer.checkedAt,
    revision: layer.revision,
    nodes: {},
  }
}

/**
 * 把敌编成汇编层叠到底座上，**只换 enemyComps 这一格**。
 *
 * 一次性算完存成新目录，而不是在 `mapIntelMap` 里每次调用现合并——
 * 那条路每渲染一帧都在建新对象，正是渲染纪律要挡的那类开销。
 */
const overlayEnemyComps = (
  base: MapIntelCatalog,
  overlay: MapEnemyCompsCatalog,
): MapIntelCatalog => {
  const maps: Record<string, MapIntelMap> = { ...base.maps }
  for (const [code, layer] of Object.entries(overlay.maps)) {
    const entry = ensureMapShell(maps, code, layer)
    if (!entry?.nodes) continue
    const nodes: Record<string, MapIntelNode> = { ...entry.nodes }
    for (const [node, comps] of Object.entries(layer.nodes)) {
      const current = nodes[node]
      nodes[node] = current
        ? { ...current, enemyComps: comps }
        : { ships: [], emptyDrop: 'unknown', enemyComps: comps }
    }
    maps[code] = { ...entry, nodes }
  }
  return { schemaVersion: 1, maps }
}

/**
 * 把掉落汇编层叠到底座上，**只换 ships 与 emptyDrop 这两格**。
 *
 * 限定期窗口这一格在这里**整格丢掉**，随后由 `overlayLimited` 从第一方台账写回去
 *（2026-08-22 起）。此前这里做的是「按 (图, 点, 舰) 从底座过继」——
 * 那是台账还没落地时的过渡做法，现在留着就是两个出处并存，
 * 界面上那个「限时」标到底是谁给的谁也说不清。
 */
const overlayDrops = (base: MapIntelCatalog, overlay: MapDropsCatalog): MapIntelCatalog => {
  const maps: Record<string, MapIntelMap> = { ...base.maps }
  for (const [code, layer] of Object.entries(overlay.maps)) {
    const entry = ensureMapShell(maps, code, layer)
    if (!entry?.nodes) continue
    const nodes: Record<string, MapIntelNode> = { ...entry.nodes }
    for (const [node, value] of Object.entries(layer.nodes)) {
      const current = nodes[node]
      nodes[node] = {
        enemyComps: current?.enemyComps ?? [],
        emptyDrop: value.emptyDrop,
        ships: value.ships.map((ship) => ({ id: ship.id })),
      }
    }
    maps[code] = { ...entry, nodes }
  }
  return { schemaVersion: 1, maps }
}

/**
 * 把限定期台账叠上去，**只写 ships[].limited / limitedOnly / limitedHistory 这三格**。
 *
 * 三条纪律：
 *  ① **台账覆盖到的图先清空再写**。底座里那份同名数据是上一代的出处，
 *    留着就成了「哪边有取哪边」，而两个出处的差异恰恰是最不该静默的东西。
 *    台账没覆盖到的图（活动图、台账里没有的常规图）一格不碰。
 *  ② 台账里有、掉落层却没列出的舰**要补一条**——但**只在这张图的掉落域真有人供
 *    数据时**（`hasDropSource`）。`limitedOnly` 的那批本来就「平时不掉」，社区掉落表
 *    不列它是正常的，不补就等于这条线索整条消失；可掉落域整张图都没人供的时候，
 *    补出来的这几条会让界面显示成「已确认 N 舰」——而它们恰恰是最不该被当成
 *    完整掉落表的一批（玩家会以为这张图就只掉这几条）。
 *  ③ 键按**改钉后**的形态号对（台账出包时已是改钉后的号）。两边不同键的表现是
 *    「宗谷只在限定期掉」这句话悄悄不见，不报错、形状也没变。
 *
 * 与另外两层不同，**这一层不新建图**：一张只有限定期窗口、没有掉落表的图是真的
 * 半张图（「这一点只在限定期掉 X」却答不出这一点平时掉什么）。台账覆盖的 25 图
 * 是掉落层 37 图的子集，正常情况下轮不到它建图；轮到了说明掉落层没到货，
 * 那就该等它——少一张图好过给一张答不全的。②里那条 `hasDropSource` 是同一条纪律
 * 在**点位**这一级的落实：不建图挡的是整图，它挡的是「图在、但这一域没人供数据」。
 */
const overlayLimited = (
  base: MapIntelCatalog,
  overlay: MapDropWindowsCatalog,
  hasDropSource: (code: string) => boolean,
): MapIntelCatalog => {
  const maps: Record<string, MapIntelMap> = { ...base.maps }
  for (const [code, layer] of Object.entries(overlay.maps)) {
    const entry = maps[code]
    if (!entry?.nodes) continue
    const canAppend = hasDropSource(code)
    const nodes: Record<string, MapIntelNode> = { ...entry.nodes }
    for (const [node, current] of Object.entries(nodes)) {
      const entries = layer[node] ?? []
      const byId = new Map(entries.map((one) => [one.id, one]))
      const written = (one: MapDropWindowEntry): ConfirmedDropShip => ({
        id: one.id,
        limited: one.window,
        ...(one.history?.length ? { limitedHistory: one.history } : {}),
        ...(one.limitedOnly ? { limitedOnly: true } : {}),
      })
      const seen = new Set<number>()
      const ships: ConfirmedDropShip[] = []
      for (const ship of current.ships) {
        const id = correctLegacyDropForm(ship.id)
        // 改钉会把两个旧号并到同一个新号上；并完只留一条，别在同一点上列两次
        if (seen.has(id)) continue
        seen.add(id)
        const found = byId.get(id)
        // 清空再写：底座残留的窗口一律不继承
        ships.push(found ? written(found) : { id })
      }
      if (canAppend) {
        for (const one of entries) {
          if (seen.has(one.id)) continue
          seen.add(one.id)
          ships.push(written(one))
        }
      }
      nodes[node] = { ...current, ships }
    }
    maps[code] = { ...entry, nodes }
  }
  return { schemaVersion: 1, maps }
}

/**
 * 这张图的**掉落域**到底有没有人供数据。
 *
 * 两个供方：常规图的掉落汇编层，或底座自己带的 ships（活动图、以及还没换源时的常规图）。
 * 两个都没有 = 这一域这张图是空的，任何「看起来像掉落表」的东西都不该被造出来。
 */
const dropDomainSourced = (code: string): boolean =>
  Boolean(dropsCatalog?.maps[code]) ||
  Object.values(baseCatalog.maps[code]?.nodes ?? {}).some((node) => node.ships.length > 0)

const rebuildCatalog = () => {
  let next = baseCatalog
  if (enemyCompsCatalog) next = overlayEnemyComps(next, enemyCompsCatalog)
  if (dropsCatalog) next = overlayDrops(next, dropsCatalog)
  if (dropWindowsCatalog) next = overlayLimited(next, dropWindowsCatalog, dropDomainSourced)
  activeCatalog = next
  dropIndex = null // 换了目录，反向索引跟着作废
  windowIndex = null
  catalogGeneration += 1
}

export const applyMapIntelCatalog = (value: unknown): boolean => {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as any).schemaVersion !== 1 ||
    !(value as any).maps ||
    typeof (value as any).maps !== 'object'
  ) {
    return false
  }
  baseCatalog = value as MapIntelCatalog
  rebuildCatalog()
  return true
}

/** 敌编成汇编层。底座还没到也照收——底座一到就会重装。 */
export const applyMapEnemyComps = (value: unknown): boolean => {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as any).schemaVersion !== 1 ||
    !(value as any).maps ||
    typeof (value as any).maps !== 'object'
  ) {
    return false
  }
  enemyCompsCatalog = value as MapEnemyCompsCatalog
  rebuildCatalog()
  return true
}

/** 限定期台账层。底座还没到也照收——底座一到就会重装。 */
export const applyMapDropWindows = (value: unknown): boolean => {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as any).schemaVersion !== 1 ||
    !(value as any).maps ||
    typeof (value as any).maps !== 'object'
  ) {
    return false
  }
  dropWindowsCatalog = value as MapDropWindowsCatalog
  rebuildCatalog()
  return true
}

/**
 * 限定期这一格是谁给的、核对到哪天。
 *
 * 与 `mapDropsInfo` 同一纪律：这一段的「源」角标要说**这一格数据自己**的日期。
 * 台账是一次逐条核对完的，所以是整份一个日子，不按图分（按图分是假精度）。
 * 台账没装就返回 null，调用方退回底座。
 */
export const limitedLedgerInfo = (): {
  source: string
  checkedAt: string
  revision: string
} | null =>
  dropWindowsCatalog
    ? {
        source: dropWindowsCatalog.source,
        checkedAt: dropWindowsCatalog.checkedAt,
        revision: dropWindowsCatalog.revision,
      }
    : null

/**
 * 某条船在某张图上登记过的限定期窗口（含已收窗的与往期的）。
 *
 * 与 `mapIntelNode` 读到的不是一回事：那一路会把**已经失效的窗口隐去**
 *（限定专属条目整条不给、常驻舰去掉过期标签），因为它答的是「现在去哪捞」。
 * 而本机确认层要答的是「我当年捞到那次算不算数」——**必须读得到已收窗的那一段**，
 * 否则永远判不出「限定期捞到 · 窗口已结束」。所以这一路直接读台账。
 *
 * 结果按 (图, 舰) 建一次索引缓存，失效键是目录代号——渲染路径上不许全表重扫。
 */
let windowIndex: { generation: number; byKey: Map<string, { node: string; window: LimitedWindow }[]> } | null =
  null

const windowKey = (map: string, mstId: number) => `${map}|${mstId}`

const buildWindowIndex = () => {
  const byKey = new Map<string, { node: string; window: LimitedWindow }[]>()
  for (const [code, layer] of Object.entries(dropWindowsCatalog?.maps ?? {})) {
    for (const [node, entries] of Object.entries(layer)) {
      for (const entry of entries) {
        const key = windowKey(code, entry.id)
        const list = byKey.get(key) ?? []
        // 当前窗口在前、往期在后：判「最近一次捞到」时先撞上还开着的那一段
        list.push({ node, window: entry.window })
        for (const past of entry.history ?? []) list.push({ node, window: past })
        byKey.set(key, list)
      }
    }
  }
  windowIndex = { generation: catalogGeneration, byKey }
}

export const limitedWindowsOf = (
  map: string,
  mstId: number,
  node?: string,
): { node: string; window: LimitedWindow }[] => {
  if (windowIndex?.generation !== catalogGeneration) buildWindowIndex()
  const list = windowIndex!.byKey.get(windowKey(map, mstId)) ?? []
  return node ? list.filter((one) => one.node === node) : list
}

/** 掉落汇编层。底座还没到也照收——底座一到就会重装。 */
export const applyMapDrops = (value: unknown): boolean => {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as any).schemaVersion !== 1 ||
    !(value as any).maps ||
    typeof (value as any).maps !== 'object'
  ) {
    return false
  }
  dropsCatalog = value as MapDropsCatalog
  rebuildCatalog()
  return true
}

/**
 * 这张图的掉落是谁给的、核对到哪天。
 *
 * 展示层的「源」角标与「资料核对 X」得说这一格数据自己的日期——掉落域换源之后
 * 还照读底座的 `checkedAt`，就是拿另一个包的日期给这一段背书。
 * 汇编层没覆盖到的图（活动图）返回 null，调用方退回底座。
 */
export const mapDropsInfo = (
  map: string,
): { source: string; checkedAt: string; revision: string } | null => {
  const entry = dropsCatalog?.maps[map]
  return entry
    ? { source: entry.source, checkedAt: entry.checkedAt, revision: entry.revision }
    : null
}

/**
 * 这张图的敌编成是谁给的、核对到哪天。与 `mapDropsInfo` 同一纪律。
 *
 * 它还有第二个用途：**判「这一域这张图到底有没有人供数据」**。
 * 汇编层没覆盖到 → null，展示层据此说「待更新」，而不是把空列表说成「0 套编成」。
 * 「没有资料」和「确认没有」是两件事，混起来说就是在撒谎。
 */
export const mapEnemyCompsInfo = (
  map: string,
): { source: string; checkedAt: string; revision: string } | null => {
  const entry = enemyCompsCatalog?.maps[map]
  return entry
    ? { source: entry.source, checkedAt: entry.checkedAt, revision: entry.revision }
    : null
}

export const mapIntelEntry = (map: string): MapIntelMap | null =>
  activeCatalog.maps[map] ?? null

/** 只读遍历当前离线目录，供深海舰等反向索引使用。 */
export const mapIntelEntries = (): [string, MapIntelMap][] =>
  Object.entries(activeCatalog.maps)

/**
 * **装配之后**的整份目录，给健康度统计用。
 *
 * 钥的那张卡从前直接读 `queryLode('map-intel')` 的原始包——那是**底座**，而底座
 * 永不随包：玩家那份产物里它根本不存在，卡上就会写「常规海域 0/0 张有节点资料」，
 * 而实际上三层汇编都在。健康度要说的是「玩家此刻手上生效的那份有多少」，
 * 所以判据必须是装配结果，不是某一个包的原文。
 */
export const mapIntelCatalog = (): MapIntelCatalog => activeCatalog

export const mapIntelMap = (
  map: string,
  difficulty?: EventDifficulty,
): ResolvedMapIntel | null => {
  const entry = mapIntelEntry(map)
  if (!entry) return null
  if (entry.nodes) return { ...entry, nodes: entry.nodes }
  if (!difficulty) return null
  const layer = entry.difficulties?.[difficulty]
  return layer ? { ...entry, nodes: layer.nodes, difficulty, operations: layer.operations } : null
}

export interface ConfirmedDropSite {
  map: string
  difficulty?: EventDifficulty
  nodes: string[]
  /** 该舰在这张图里带限定期 */
  limited: boolean
  /** 只在限定期掉（平时来这张图捞不到） */
  limitedOnly: boolean
  /**
   * 限定期截止日（YYYY-MM-DD）。
   *
   * 实测随包目录 112 条常规图限定掉落**没有一条写了截止日**——这不是资料缺失：
   * 舰C 常规图的「限定掉落」多是某次追加后一直开着的（玩家口径的「永久开放的
   * 限定掉落」），kcwiki 上本来就不给截止日。所以 null 是如实记录，
   * 调用方不能据此制造「快关门」的紧迫感。
   */
  limitedUntil: string | null
  /**
   * 活动图才有：这张图属于哪次活动。
   *
   * 这才是真正有时限的那类——活动一结束掉落就没了。只是舰C 的活动结束日
   * 官方通常不预告，所以 until 往往也是 null：**有时限但日期未知**，
   * 与常规图限定掉落的「本来就没有截止」是两回事，措辞上必须分开。
   */
  event: { name: string; until: string | null; status: 'active' | 'ended' } | null
}

/**
 * 一处**已终了**的限定掉点：上游指名说它终了了，所以它不在 `confirmedDropSitesOf`
 * 里——`mapIntelNode` 已经把它隐去，免得当成「去这儿捞」的线索。
 *
 * 单独留这一条路是为了**解释缺席**：玩家问「这船去哪捞」，答「目录里没有」
 * 与答「这一点确实掉过她，但那批限定已经终了」不是一回事。后者才说得清
 * 为什么她从可捞计数里退出去了。展示层一律灰显 + 标「已终了」，
 * 绝不许把它混进可捞的那一批。
 */
export interface EndedDropSite {
  map: string
  difficulty?: EventDifficulty
  nodes: string[]
  /** 终了的那段窗口——批次名与起始日的出处 */
  window: LimitedWindow
}

// 「这船去哪捞」是玩家最高频的问题，而目录本身是按海域组织的，
// 逐张翻才能凑出答案。这里建一次反向索引缓存起来。
let dropIndex: {
  today: string
  byShip: Map<number, ConfirmedDropSite[]>
  endedByShip: Map<number, EndedDropSite[]>
} | null = null

const buildDropIndex = (today: string) => {
  const byShip = new Map<number, ConfirmedDropSite[]>()
  const endedByShip = new Map<number, EndedDropSite[]>()
  for (const [code, entry] of Object.entries(activeCatalog.maps)) {
    const layers: { difficulty?: EventDifficulty; nodes: Record<string, MapIntelNode> }[] =
      entry.nodes
        ? [{ nodes: entry.nodes }]
        : EVENT_DIFFICULTIES.flatMap((difficulty) => {
            const layer = entry.difficulties?.[difficulty]
            return layer ? [{ difficulty, nodes: layer.nodes }] : []
          })
    for (const layer of layers) {
      for (const node of Object.keys(layer.nodes)) {
        // 已终了的限定专属条目会被 mapIntelNode 隐去，所以这一份**在它之前**、
        // 从原始层里捡：捡的不是「去这儿捞」，是「为什么这儿捞不到了」。
        for (const ship of layer.nodes[node].ships) {
          if (!ship.limitedOnly || !ship.limited) continue
          // 「上游说它终了了」与「有截止日、那天已过」都算终了，都该给玩家一个交代。
          // **不含** end_pending：那一档只是「上游不再列出」的疑似，没人说过它结束，
          // 说「已终了」就是替上游下断言——照旧隐去，不解释。
          if (
            !isEndedLimitedWindow(ship.limited, today) &&
            !isClosedLimitedWindow(ship.limited, today)
          ) {
            continue
          }
          const list = endedByShip.get(ship.id) ?? []
          const hit = list.find((site) => site.map === code && site.difficulty === layer.difficulty)
          if (hit) {
            if (!hit.nodes.includes(node)) hit.nodes.push(node)
          } else {
            list.push({ map: code, difficulty: layer.difficulty, nodes: [node], window: ship.limited })
            endedByShip.set(ship.id, list)
          }
        }
        // 走 mapIntelNode 而不是直接读 layer.nodes[node]：限定期已过的条目
        // 由它负责隐去，过期线索不该再摆给玩家当"去这儿捞"。
        const resolved = mapIntelNode(code, node, today, layer.difficulty)
        if (!resolved) continue
        for (const ship of resolved.ships) {
          const list = byShip.get(ship.id) ?? []
          const hit = list.find((site) => site.map === code && site.difficulty === layer.difficulty)
          const until = ship.limited?.until ?? null
          if (hit) {
            if (!hit.nodes.includes(node)) hit.nodes.push(node)
            if (ship.limited) hit.limited = true
            if (!ship.limitedOnly) hit.limitedOnly = false
            // 同图多点时取最早关门的那个——玩家要按最紧的那条安排
            if (until && (!hit.limitedUntil || until < hit.limitedUntil)) hit.limitedUntil = until
          } else {
            list.push({
              map: code,
              difficulty: layer.difficulty,
              nodes: [node],
              limited: !!ship.limited,
              limitedOnly: !!ship.limitedOnly,
              limitedUntil: until,
              event: entry.event
                ? { name: entry.event.name, until: entry.event.until, status: entry.event.status }
                : null,
            })
            byShip.set(ship.id, list)
          }
        }
      }
    }
  }
  dropIndex = { today, byShip, endedByShip }
}

/**
 * 哪些海域·哪个难度确认掉这条船。空数组表示目录里没有它——
 * **不等于确认不掉**，只是这份离线目录没收录，调用方必须原样说清楚。
 */
export const confirmedDropSitesOf = (mstId: number, today = localDate()): ConfirmedDropSite[] => {
  if (dropIndex?.today !== today) buildDropIndex(today)
  return dropIndex!.byShip.get(mstId) ?? []
}

/**
 * 这条船有哪些**已终了**的限定掉点。与 `confirmedDropSitesOf` 互斥：
 * 那边是现在还能去的，这边是曾经能去、上游已经说终了的。
 *
 * 只给「解释为什么捞不到」用——**不许**并进可捞计数，也不许拿去催人出击。
 */
export const endedDropSitesOf = (mstId: number, today = localDate()): EndedDropSite[] => {
  if (dropIndex?.today !== today) buildDropIndex(today)
  return dropIndex!.endedByShip.get(mstId) ?? []
}

export const mapIntelDifficulties = (map: string): EventDifficulty[] => {
  const layers = mapIntelEntry(map)?.difficulties
  return layers ? EVENT_DIFFICULTIES.filter((difficulty) => layers[difficulty]) : []
}

const localDate = () => {
  const now = new Date()
  const yyyy = `${now.getFullYear()}`.padStart(4, '0')
  const mm = `${now.getMonth() + 1}`.padStart(2, '0')
  const dd = `${now.getDate()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export const mapIntelNode = (
  map: string,
  node: string,
  today = localDate(),
  difficulty?: EventDifficulty,
): MapIntelNode | null => {
  const value = mapIntelMap(map, difficulty)?.nodes[node]
  if (!value) return null
  const ships = value.ships.flatMap((ship) => {
    if (!ship.limited || isActiveLimitedWindow(ship.limited, today)) return [ship]
    // 限定专属条目进入待确认/结束后从当前目录隐藏；本来就是常驻掉落的舰
    // 仍然保留，但去掉已经失效的限定标签。历史状态只保存在原始矿脉包里。
    if (ship.limitedOnly) return []
    const { limited: _limited, ...permanent } = ship
    return [permanent]
  })
  return { ...value, ships }
}

/**
 * 一个点位的确认掉落目录，含「这份目录是哪一层给的」。
 *
 * 取舍规则（2026-08-26 用户拍板）：
 *   · 分难度层有数据（boss 点）→ **只**用分难度层，`allDifficulty` 为 false；
 *   · 分难度层没有、合算层有（P1 这类途中点）→ 用合算层，`allDifficulty` 为 true，
 *     展示层必须据此挂「不分难度」标注；
 *   · 两层都没有 → ships 空，调用方去说「尚未收录」。
 *
 * 这是合算层唯一的读取口。`mapIntelNode()` 照旧只认分难度层，不受影响——
 * 两层的隔离靠「合算层根本不在 difficulties 里」的存放结构 + 这一个收口保证。
 */
export interface NodeDropCatalog {
  ships: ConfirmedDropShip[]
  /** true = 这一格来自全难度合算层（上游那张不分难度的总表） */
  allDifficulty: boolean
  emptyDrop: 'confirmed' | 'unknown'
}

export const nodeDropCatalog = (
  map: string,
  node: string,
  today = localDate(),
  difficulty?: EventDifficulty,
): NodeDropCatalog | null => {
  const layer = mapIntelNode(map, node, today, difficulty)
  if (layer?.ships.length) {
    return { ships: layer.ships, allDifficulty: false, emptyDrop: layer.emptyDrop }
  }
  const pooled = mapIntelEntry(map)?.allDiffDrops?.[node] ?? []
  if (pooled.length) {
    return { ships: pooled, allDifficulty: true, emptyDrop: layer?.emptyDrop ?? 'unknown' }
  }
  if (!layer) return null
  return { ships: [], allDifficulty: false, emptyDrop: layer.emptyDrop }
}
