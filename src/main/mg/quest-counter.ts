// 铭 · 任务精确计数引擎。
//
// 规则源四层，优先级从上到下，**只填空位、绝不覆盖**：
//   kcwiki-quest-req（MIT）→ poi-quest-goal（MIT）→ 艦素自研 → 中文正文兜底
// 「艦素自研」这一层是本引擎的主力（2026-08-21 全量自研完工后接管了原 EO 那 164 条）：
// 废弃装备 / 演习 / 远征 / 出击（纯海域与带点位）四类由中文任务正文 + 游戏一手主数据
// (`api_start2`) + poi-fcd 拓扑推导，编成门另由 quest-fleet-rules 推导；
// 逐条人工解码的少量条目在 kanso-quest-rules。各自的口径与闸门写在各自文件头。
// 上游编码与游戏日文原文对不上的，逐条走 quest-source-conflicts 的修正台账，不改通则。
//
// 纪律：
// - 只对「遂行中」(state=2) 的任务计数；交付(clearitemget)时清进度；
// - 战斗/远征/演习/到达类计数前先过编成条件门；装备废弃类不查条件（游戏同口径）；
// - 判定拿不准的一律标 approx（UI 显示 ≈，含义「计数可能偏多」），绝不假装精确；
// - 计数是本地口径（kanso 在线期间的事件），与游戏服务器进度可能有出入——
//   钦同时展示游戏自己的 progressFlag 作对照。
//
// **本模块不认识 Electron**：矿脉/账本/状态/广播四样都由宿主 (QuestEngineHost) 注入，
// 装配与 ipcMain 接线在 quest-counter-host.ts。这样离线工具（scripts/quest-replay.mjs
// 的账本回放、scripts/quest-selfderive-diff.mjs 的逐条对账）能直接把同一份引擎跑起来，
// 而不是各写一份「像是那么回事」的复刻——复刻出来的对账结论证明不了线上引擎。
// 模块顶层只有声明，没有自执行：谁装配谁负责调 init()。
import {
  augmentShipGroupsFromQuestText,
  buildKcwikiRuleContext,
  decodeKcwikiRequirement,
  evaluateFleetGoal,
} from './kcwiki-quest-rules'
import { buildPoiQuestContext, decodePoiQuestGoal } from './poi-quest-rules'
import { buildKansoQuestRules } from './kanso-quest-rules'
import { buildFleetRuleContext, deriveFleetRule } from './quest-fleet-rules'
import { buildMissionRuleContext, deriveMissionRule } from './quest-mission-rules'
import { derivePracticeRule } from './quest-practice-rules'
import { buildScrapRuleContext, deriveScrapRule } from './quest-scrap-rules'
import { buildSortieRuleContext, deriveSortieRule } from './quest-sortie-rules'
import { applyQuestSourceConflicts } from './quest-source-conflicts'
import { actionIncrement, buildEquipTypeNameIndex, deriveFallbackTracker } from './quest-counter-rules'
import { questAnnualMonth, questPeriodFromCode, questPeriodKey } from '../../shared/quest-period'
import { USEITEM_MATERIAL_INDEX } from '../../shared/useitem-stock'

import type { QuestPeriodKind } from '../../shared/quest-period'
import { qpTaskGroups, qpTaskSlot } from '../../shared/qp-types'

import type {
  QpAction,
  QpBlockReason,
  QpFleetCheck,
  QpFleetGoal,
  QpStateGoal,
  QpStateGoalDiff,
  QpStockGoal,
  QpState,
  QpTask,
  QpTrackerInfo,
  QpTrackerSource,
} from '../../shared/qp-types'
import type { SlotitemInstance } from '../../shared/mg-types'

export interface QuestApiContext {
  destroyedSlotitems?: Record<number, SlotitemInstance>
  // 动作前该舰队正在跑的远征 id。归约器处理 mission/result 时会把
  // deck.mission 清零，事后从 state 里读永远是 0，指定远征任务就全都不涨。
  expeditionMissionId?: number
}

// ---- 宿主接口 ----
//
// 账本与状态用 `typeof import(...)` 取真模块的形状：类型位置在转译时整个被抹掉，
// 不会把 electron 拖进来，但装配方少写一个方法、写错一个签名，tsc 当场红。
// 名字与真模块保持一致（ledger / store / getLode），引擎正文因此一个字都不用改。

export interface QuestEngineHost {
  getLode: (id: string) => { meta?: unknown; data?: unknown } | null
  ledger: Pick<
    (typeof import('./ledger'))['default'],
    'loadSnapshot' | 'loadQuestProgress' | 'saveQuestProgress' | 'deleteQuestProgress'
  >
  store: Pick<typeof import('./store'), 'getState'>
  /** 把一帧推给所有活着的渲染窗口；离线工具传空实现即可。 */
  send: (channel: 'qp:state' | 'qp:patch', payload: unknown) => void
}

export interface QuestEngine {
  /** 装载五个规则源；masterOverride 给 start2 直推的场景。 */
  init: (masterOverride?: any, notifyRenderers?: boolean) => void
  /** 事件入口（qp:get 的同一份状态由 state() 取）。 */
  onApi: (
    apiPath: string,
    body: any,
    post: Record<string, string>,
    context?: QuestApiContext,
  ) => void
  state: () => QpState
  checkFleet: () => QpFleetCheck
  reconcile: () => void
  /** 只跑周期重置那一段（宿主的分钟级定时器用）。 */
  resetExpired: (now?: number) => void
  /** 主数据索引重建；start2 之外的场景（回放器灌快照）用。 */
  rebuildMasterIndex: (raw: any) => void
}

interface Tracker {
  questId: number
  tasks: QpTask[]
  source: QpTrackerSource
  fleetGoal?: QpFleetGoal
  stateGoal?: QpStateGoal
  stockGoals?: QpStockGoal[]
  approx: boolean
  partial: boolean
  period: QuestPeriodKind | null
  annualMonth: number | null
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d)

// ---- 引擎装配 ----
//
// 一次 createQuestEngine 就是一台完整引擎：主数据索引、追踪器表、本地计数全在闭包里，
// 互不串味。线上跑一台（quest-counter-host），回放器可以按需再开一台喂历史事件。
export const createQuestEngine = (host: QuestEngineHost): QuestEngine => {
  const { getLode, ledger, store, send } = host

  // ---- 主数据索引 ----
  //
  // 只留判定真正要用的四张表。改造链/舰级代表名/舰种名那几张原是 EO 条件树
  // （remodelCmp 的 Any/AtLeast、condText 摘要）专用，EO 退场后一并退场——
  // 编成门现在由 quest-fleet-rules 在装载期把形态展开成具体 mstId 列表，
  // 运行期不再需要在这里回溯改造链。

  interface MasterInfo {
    stype: Map<number, number>
    ctype: Map<number, number>
    soku: Map<number, number>
    names: Map<number, string>
    equipType: Map<number, number[]> // 装备 mstId → api_type
  }

  const master: MasterInfo = {
    stype: new Map(),
    ctype: new Map(),
    soku: new Map(),
    names: new Map(),
    equipType: new Map(),
  }

  const rebuildMasterIndex = (raw: any) => {
    master.stype.clear()
    master.ctype.clear()
    master.soku.clear()
    master.names.clear()
    master.equipType.clear()
    for (const s of raw?.api_mst_ship ?? []) {
      master.stype.set(s.api_id, s.api_stype ?? 0)
      master.ctype.set(s.api_id, s.api_ctype ?? 0)
      master.soku.set(s.api_id, s.api_soku ?? 0)
      master.names.set(s.api_id, s.api_name ?? `#${s.api_id}`)
    }
    for (const i of raw?.api_mst_slotitem ?? []) {
      master.equipType.set(i.api_id, Array.isArray(i.api_type) ? i.api_type : [])
    }
  }

  interface FleetShip {
    mstId: number
    lv: number
    soku?: number // 舰娘实例的当前航速；含锅炉/涡轮提速
  }

  const shipName = (mstId: number) => master.names.get(mstId) ?? `#${mstId}`

  // ---- 引擎 ----

  const trackers = new Map<number, Tracker>()
  let packCredit: string | null = null
  let progress: Record<number, number[]> = {}
  let progressUpdated: Record<number, number> = {}
  let progressLoaded = false

  const initQuestCounter = (masterOverride: any = null, notifyRenderers = false) => {
    trackers.clear()
    const scn = getLode('quests-scn')
    const kcwikiPack = getLode('kcwiki-quest-req')
    const poiPack = getLode('poi-quest-goal')
    const expeditionPack = getLode('kcwiki-expedition')
    const localization = getLode('kcwiki-localization')
    // 点位边号的唯一来源（MIT）。缺包时带点位的那些任务算不出入边，
    // 各自整条待裁——不补一个 0 号边冒充，见 quest-map-nodes。
    const fcdPack = getLode('poi-fcd-map')
    const snapshot = ledger.loadSnapshot('/kcsapi/api_start2/getData')
    const masterRaw = masterOverride ?? (snapshot ? (snapshot.body as any)?.api_data ?? snapshot.body : null)
    if (masterRaw) rebuildMasterIndex(masterRaw)
    const kcwikiContext = buildKcwikiRuleContext(masterRaw)
    const poiContext = buildPoiQuestContext(masterRaw, expeditionPack?.data)
    // 别名口径的唯一出处在 quest-counter-rules（测试同源），这里只是调用
    const equipTypeIds = buildEquipTypeNameIndex((localization?.data as any)?.entities?.equipType)
    const questTotal = scn?.data && typeof scn.data === 'object'
      ? Object.keys(scn.data).length
      : 0
    const periodByQuest = new Map<number, { period: QuestPeriodKind | null; annualMonth: number | null }>()
    if (scn?.data && typeof scn.data === 'object') {
      for (const [idStr, raw] of Object.entries<any>(scn.data)) {
        const resetNote = `${raw?.memo2 ?? ''}`
        periodByQuest.set(parseInt(idStr, 10), {
          period: questPeriodFromCode(`${raw?.code ?? ''}`, resetNote),
          annualMonth: questAnnualMonth(resetNote),
        })
      }
    }
    // 第一规则源：KCWiki requirements。解码失败则继续降级。
    // 具名舰组解码后按任务文本补入 wiki 显式列举的追加形态（「白露改二」/
    // 「摩耶改二可」这类备注——数据字段常只带最低形态，口径见 kcwiki-quest-rules）
    const zhShipNames = new Map<number, string>(
      Object.entries(((localization?.data as any)?.entities?.ship ?? {}) as Record<string, any>)
        .map(([id, entry]) => [Number(id), `${entry?.zh ?? ''}`] as [number, string])
        .filter(([id, zh]) => id > 0 && !!zh),
    )
    const questTextOf = (questId: number): string => {
      const quest = (scn?.data as any)?.[questId]
      return quest ? `${quest.desc ?? ''}｜${quest.memo2 ?? ''}` : ''
    }
    if (kcwikiPack?.data && typeof kcwikiPack.data === 'object' && !Array.isArray(kcwikiPack.data)) {
      for (const [idText, requirement] of Object.entries(kcwikiPack.data as Record<string, unknown>)) {
        const questId = parseInt(idText, 10)
        if (!questId || trackers.has(questId)) continue
        const decoded = decodeKcwikiRequirement(requirement, kcwikiContext)
        if (decoded) {
          augmentShipGroupsFromQuestText(decoded, kcwikiContext, questTextOf(questId), zhShipNames)
        }
        if (
          !decoded ||
          (
            !decoded.tasks.length &&
            !decoded.fleetGoal &&
            !decoded.stateGoal &&
            !decoded.stockGoals?.length
          )
        ) continue
        trackers.set(questId, {
          questId,
          tasks: decoded.tasks,
          source: 'kcwiki',
          fleetGoal: decoded.fleetGoal,
          stateGoal: decoded.stateGoal,
          stockGoals: decoded.stockGoals,
          approx: decoded.approx === true,
          partial: decoded.partial,
          period: periodByQuest.get(questId)?.period ?? null,
          annualMonth: periodByQuest.get(questId)?.annualMonth ?? null,
        })
      }
    }

    // 第二规则源：poi goal。只补 KCWiki 没覆盖的新任务；抓取阶段已转成惰性 JSON。
    if (poiPack?.data && typeof poiPack.data === 'object' && !Array.isArray(poiPack.data)) {
      for (const [idText, rawGoal] of Object.entries(poiPack.data as Record<string, unknown>)) {
        const questId = parseInt(idText, 10)
        if (!questId || trackers.has(questId)) continue
        const decoded = decodePoiQuestGoal(rawGoal, poiContext)
        if (!decoded?.tasks.length) continue
        trackers.set(questId, {
          questId,
          tasks: decoded.tasks,
          source: 'poi',
          approx: false,
          partial: decoded.partial,
          period: periodByQuest.get(questId)?.period ?? null,
          annualMonth: periodByQuest.get(questId)?.annualMonth ?? null,
        })
      }
    }

    // 第三规则源：艦素自研补充。上游两源都没有的任务在 kanso-quest-rules 里
    // 逐条人工解码（依据任务正文 + wiki 核对），只填空位、绝不覆盖上游。
    if (masterRaw) {
      for (const rule of buildKansoQuestRules(kcwikiContext, masterRaw, fcdPack?.data as any)) {
        if (trackers.has(rule.questId)) continue
        if (
          !rule.tasks.length &&
          !rule.fleetGoal &&
          !rule.stateGoal &&
          !rule.stockGoals?.length
        ) continue
        trackers.set(rule.questId, {
          questId: rule.questId,
          tasks: rule.tasks,
          source: 'kanso',
          fleetGoal: rule.fleetGoal,
          stateGoal: rule.stateGoal,
          stockGoals: rule.stockGoals,
          approx: rule.approx,
          partial: rule.partial,
          period: periodByQuest.get(rule.questId)?.period ?? null,
          annualMonth: periodByQuest.get(rule.questId)?.annualMonth ?? null,
        })
      }

      // 同为艦素自研，但走的是**推导**而不是逐条人工解码：废弃装备类的清单
      // （装备名/类别 + 数量）整个在中文正文里，配上游戏一手主数据就能解出来，
      // 不必一条条手写。口径与边界见 quest-scrap-rules。仍然只填空位。
      const scrapContext = buildScrapRuleContext(masterRaw, localization?.data)
      const scrapFleetContext = buildFleetRuleContext(masterRaw, localization?.data)
      if (scrapContext && scn?.data && typeof scn.data === 'object') {
        for (const [idText, raw] of Object.entries<any>(scn.data)) {
          const questId = parseInt(idText, 10)
          if (!questId || trackers.has(questId)) continue
          const desc = `${raw?.desc ?? ''}`
          const memo2 = `${raw?.memo2 ?? ''}`
          const derived = deriveScrapRule(desc, memo2, scrapContext, questId)
          if (!derived?.tasks.length) continue
          // 废弃类**也带编成门**，但它在这一类里是「完成条件」不是「计数条件」：
          // 游戏的廃棄计数与编成无关（destroyitem2 那条分支不查 fleetGoal，EO 同口径），
          // 而 F136「以早波作第一舰队旗舰，为他配备3艘以上第三十二驱逐队」这类
          // 秘书舰/编队要求是游戏正文自己写的、不满足就交不了差。装上它只影响
          // UI 把这道条件显示出来，**一个计数都不会变**（回放全档实测 0 差异）。
          // `approx` 也不跟着编成门走：廃棄那一轴的计数本来就是精确的。
          const fleet = scrapFleetContext
            ? deriveFleetRule(questId, `${raw?.code ?? ''}`, desc, memo2, scrapFleetContext)
            : null
          trackers.set(questId, {
            questId,
            tasks: derived.tasks,
            source: 'kanso',
            fleetGoal: fleet?.fleetGoal,
            approx: derived.approx,
            partial: false,
            period: periodByQuest.get(questId)?.period ?? null,
            annualMonth: periodByQuest.get(questId)?.annualMonth ?? null,
          })
        }
      }

      // 同一条流水线上的另外三类：演习（评价 + 次数）、远征（远征号 + 次数）、
      // 出击（海域 + 点位 + 评价 + 次数）。三类的判定字段都少、正文都规整，
      // 口径与闸门见 quest-practice-rules / quest-mission-rules / quest-sortie-rules。
      // 同样只填空位，不抢上游。
      const missionContext = buildMissionRuleContext(masterRaw, expeditionPack?.data)
      const sortieContext = buildSortieRuleContext(masterRaw, fcdPack?.data as any)
      // 编成条件是这三类共用的**另一半**：计数轴解「打哪张图、几次、什么评价」，
      // 这一轴解「这一队得长什么样」。只装在过条件门的那几类任务上——装备废弃类
      // 在消费端本就不查条件（EO 同口径），给它装门只会让 UI 显示一道不存在的限制。
      const fleetContext = buildFleetRuleContext(masterRaw, localization?.data)
      if (scn?.data && typeof scn.data === 'object') {
        for (const [idText, raw] of Object.entries<any>(scn.data)) {
          const questId = parseInt(idText, 10)
          if (!questId || trackers.has(questId)) continue
          const code = `${raw?.code ?? ''}`
          const desc = `${raw?.desc ?? ''}`
          const memo2 = `${raw?.memo2 ?? ''}`
          const derived =
            derivePracticeRule(questId, code, `${raw?.name ?? ''}`, desc, memo2) ??
            deriveMissionRule(code, desc, memo2, missionContext) ??
            (sortieContext ? deriveSortieRule(questId, code, desc, memo2, sortieContext) : null)
          if (!derived?.tasks.length) continue
          const fleet = fleetContext
            ? deriveFleetRule(questId, code, desc, memo2, fleetContext)
            : null
          trackers.set(questId, {
            questId,
            tasks: derived.tasks,
            source: 'kanso',
            fleetGoal: fleet?.fleetGoal,
            approx: derived.approx || Boolean(fleet?.approx),
            partial: derived.partial,
            period: periodByQuest.get(questId)?.period ?? null,
            annualMonth: periodByQuest.get(questId)?.annualMonth ?? null,
          })
        }
      }
    }

    // 最后回退：仅在 KCWiki、poi 与艦素自研都没有安全规则时，才从中文任务文本推导（标 ≈）。
    if (scn?.data && typeof scn.data === 'object') {
      for (const [idStr, raw] of Object.entries<any>(scn.data)) {
        const questId = parseInt(idStr, 10)
        if (!questId || trackers.has(questId)) continue // 上游已覆盖的不碰，避免双重计数
        const derived = deriveFallbackTracker(
          `${raw?.code ?? ''}`,
          `${raw?.desc ?? ''}`,
          `${raw?.memo2 ?? ''}`,
          equipTypeIds,
        )
        if (!derived.tasks.length) continue
        trackers.set(questId, {
          questId,
          tasks: derived.tasks,
          source: 'text',
          approx: true,
          partial: derived.partial,
          period: periodByQuest.get(questId)?.period ?? null,
          annualMonth: periodByQuest.get(questId)?.annualMonth ?? null,
        })
      }
    }

    // 已知源错误的修正台账：逐条列明的那几个 questId，用游戏日文原文把上游的错值改回来。
    // 放在全部规则源之后，是因为要先看清「这条最后落到哪个源」再决定改不改；
    // 指纹对不上就不改（上游修了/改了都算），只告警。依据逐条写在 quest-source-conflicts。
    const patched = applyQuestSourceConflicts(trackers, (conflict, reason) => {
      console.warn(`[kanso] qp: 源修正台账 ${conflict.questId}/${conflict.code} 未生效——${reason}`)
    })

    const sourceCounts: Record<QpTrackerSource, number> = {
      kcwiki: 0,
      poi: 0,
      text: 0,
      kanso: 0,
    }
    // 覆盖统计只数目录里的任务：上游包里可能带着不在中文任务目录里的条目，
    // 直接数 trackers.size 会把分子数得比分母还大（EO 在位时曾显示 646/644）。
    const inCatalog = (qid: number) => !periodByQuest.size || periodByQuest.has(qid)
    let trackedInCatalog = 0
    for (const tracker of trackers.values()) {
      if (!inCatalog(tracker.questId)) continue
      sourceCounts[tracker.source] += 1
      trackedInCatalog += 1
    }
    const kcwikiMeta = kcwikiPack?.meta as any
    const kcwikiDate = kcwikiMeta?.upstreamUpdatedAt
      ? `${kcwikiMeta.upstreamUpdatedAt}`.slice(0, 10)
      : null
    const poiMeta = poiPack?.meta as any
    const poiDate = poiMeta?.upstreamUpdatedAt
      ? `${poiMeta.upstreamUpdatedAt}`.slice(0, 10)
      : null
    // 逐源条数与源站名号不进 UI（2026-08-20 定：出处署名统一收在钥的矿脉面板）；
    // 这里只留玩家真正要判断的两件事——覆盖了多少条、规则多新。
    const ruleDate = [kcwikiDate, poiDate].filter(Boolean).sort().pop() ?? null
    packCredit = `精确计数覆盖 ${trackedInCatalog} / ${questTotal} 条${ruleDate ? ` · 规则更新 ${ruleDate}` : ''}`
    if (!progressLoaded) {
      const saved = ledger.loadQuestProgress()
      progress = Object.fromEntries(
        Object.entries(saved).map(([questId, value]) => [questId, value.counts]),
      )
      progressUpdated = Object.fromEntries(
        Object.entries(saved).map(([questId, value]) => [questId, value.updated]),
      )
      progressLoaded = true
    }
    repairContradictedCompleteProgress()
    console.log(
      `[kanso] qp: ${trackers.size} 个任务追踪器就绪（KCWiki ${sourceCounts.kcwiki} / poi ${sourceCounts.poi} / 艦素 ${sourceCounts.kanso} / 文本 ${sourceCounts.text}` +
      `${patched ? ` · 源修正 ${patched}` : ''}） · 主数据${master.names.size ? `已就绪（${master.names.size} 舰）` : '未就绪'}`,
    )
    if (notifyRenderers) broadcastState()
  }

  const toState = (): QpState => {
    resetExpiredProgress()
    const infos: Record<number, QpTrackerInfo> = {}
    const serverFloors: QpState['serverFloors'] = {}
    const quests = store.getState().player.quests
    const now = Date.now()
    for (const [qid, t] of trackers) {
      infos[qid] = {
        questId: qid,
        tasks: t.tasks,
        source: t.source,
        fleetGoal: t.fleetGoal,
        stateGoal: t.stateGoal,
        stateGoalReady: t.stateGoal ? stateGoalReady(t) : undefined,
        stockGoals: t.stockGoals,
        approx: t.approx,
        partial: t.partial,
        blocked: blockReasonOf(t, now),
      }
      const flag = quests[qid]?.progressFlag
      // 自报粗档说的是**整条任务**（各子项的合计口径），不是每个子项各自过半。
      // 多子项任务里 ≥50% 证明不了任何一个子项 ≥50%——三项满一项零，平均照样
      // 过半；把它硬摊到每个槽会凭空抬高没做的那项，玩家反而不知道还差多少
      // （用户实弹撞到：四个废弃子项 20/20✓、0/20、10/10✓、10/10✓ 被显示成
      // 「大口径 ≥10/20」）。可证明的逐槽下限只在单计数槽的任务上存在。
      //
      // 粗档还必须与**当前任务周期同龄**（2026-08-12 用户抓的实锤：Bd6 日任被
      // 「下限校正 ≥4/5」盖住正常计数）：questlist 快照若停在上个周期——日任
      // 隔天最常见——里面的 ≥50%/≥80% 说的是上一轮的进度，游戏重置后它证明
      // 不了本轮任何事；拿它垫今天清零重开的本地计数器，等于用昨天的旧账
      // 覆盖正在正常运作的账本。
      const questsTs = store.getState().player.questsTs
      const flagFresh = questsTs != null && sameQuestPeriod(t, questsTs, now)
      if (flagFresh && (flag === 1 || flag === 2) && t.tasks.length) {
        const groups = qpTaskGroups(t.tasks)
        if (groups.length === 1) {
          const ratio = flag === 2 ? 0.8 : 0.5
          const slot = groups[0].slot
          const cap = (groups[0].entries[0].task as any).count || 1
          const counts = Array.from({ length: slot + 1 }, () => 0)
          counts[slot] = Math.ceil(cap * ratio)
          serverFloors[qid] = { flag, counts }
        }
      }
    }
    return { trackers: infos, progress, serverFloors, packCredit }
  }

  const broadcastProgress = (questId: number, counts: number[] | null = progress[questId] ?? null) => {
    send('qp:patch', { [questId]: counts })
  }

  const periodOf = (tracker: Tracker): QuestPeriodKind | null => {
    const type = store.getState().player.quests[tracker.questId]?.type
    if (type === 1) return 'daily'
    if (type === 2) return 'weekly'
    if (type === 3) return 'monthly'
    return tracker.period
  }

  const sameQuestPeriod = (
    tracker: Tracker,
    left: number,
    right: number,
  ): boolean => {
    const period = periodOf(tracker)
    return (
      !period ||
      questPeriodKey(period, left, tracker.annualMonth) ===
        questPeriodKey(period, right, tracker.annualMonth)
    )
  }

  const resetExpiredProgress = (now = Date.now()) => {
    for (const [questIdText, counts] of Object.entries(progress)) {
      if (!counts) continue
      const questId = parseInt(questIdText, 10)
      const tracker = trackers.get(questId)
      const updated = progressUpdated[questId]
      const period = tracker ? periodOf(tracker) : null
      if (!tracker || !period || !updated) continue
      if (
        questPeriodKey(period, updated, tracker.annualMonth) ===
        questPeriodKey(period, now, tracker.annualMonth)
      ) continue
      delete progress[questId]
      delete progressUpdated[questId]
      ledger.deleteQuestProgress(questId)
      broadcastProgress(questId, null)
      console.log(`[kanso] qp: 任务 ${questId} 已跨 ${period} 重置线，本地计数清零`)
    }
  }

  // 本地已经宣称“全部计满”，但之后的权威受领集合仍把任务标成进行中，
  // 说明本地曾在未受领窗口误计。清掉错误的“精确数”，UI 会自动降级到游戏 progressFlag
  // 的可证明下限。
  //
  // 排除的是「计满≠可交付」那一族——partial / stateGoal / stockGoals：它们满了之后
  // 游戏本来就还会停在遂行中（实弹样本：1150/2605F3 四项废弃全满、还差准备 10 个
  // 12.7cm 连装高角炮），拿矛盾去撤销等于把正确的计数删掉。
  //
  // `approx` **不豁免**：它的语义正是「计数可能偏多」，游戏说还没完成恰恰是这份
  // 怀疑被坐实，撤销才是对的——あ号在活动期就是这么一路走到假「完成」的。
  const repairContradictedCompleteProgress = () => {
    const player = store.getState().player
    const observedAt = player.questActiveTs
    if (!observedAt) return
    for (const [questId, tracker] of trackers) {
      const counts = progress[questId]
      const updated = progressUpdated[questId]
      const observed = player.quests[questId]
      if (
        !counts ||
        !updated ||
        observedAt < updated ||
        observed?.state !== 2 ||
        tracker.partial ||
        tracker.stateGoal ||
        tracker.stockGoals?.length
      ) continue
      const complete = qpTaskGroups(tracker.tasks).every(
        ({ slot, entries }) =>
          (counts[slot] ?? 0) >= ((entries[0]?.task as any)?.count || 1),
      )
      if (!complete) continue
      delete progress[questId]
      delete progressUpdated[questId]
      ledger.deleteQuestProgress(questId)
      broadcastProgress(questId, null)
      console.warn(
        `[kanso] qp: 任务 ${questId} 的本地完成数与之后的游戏状态矛盾，已撤销精确数并回退到游戏进度档`,
      )
    }
  }

  // 状态快照在计数引擎模块初始化之后才回灌；对外提供一次显式复核，
  // 让离线启动也能修掉“旧精确数与较新的游戏状态矛盾”的记录。
  const reconcileQuestProgress = () => {
    resetExpiredProgress()
    repairContradictedCompleteProgress()
  }

  // 当前遂行中且有追踪器的任务
  /**
   * 这条追踪器现在拿不到计数的原因；null = 畅通。
   *
   * activeTracked() 与 UI 的「为什么没在计数」共用它——**必须只有这一处**，
   * 否则会出现「诊断说在计数、实际一条没落」这种最难查的错。
   */
  const blockReasonOf = (tracker: Tracker, now: number): QpBlockReason | null => {
    const player = store.getState().player
    const observedAt = player.questActiveTs
    // 日/周/月/季/年任务越过自己的重置线后，上一周期的受领集合立即失效。
    // 新周期必须由任务页或受领动作重新确认，不能拿“昨天仍在遂行中”继续计数。
    if (periodOf(tracker) && (!observedAt || !sameQuestPeriod(tracker, observedAt, now))) {
      return 'periodStale'
    }
    const active = player.questActiveIds
      ? player.questActiveIds.includes(tracker.questId)
      : player.quests[tracker.questId]?.state === 2
    return active ? null : 'notReceived'
  }

  const activeTracked = (): Tracker[] => {
    resetExpiredProgress()
    const now = Date.now()
    const out: Tracker[] = []
    for (const t of trackers.values()) {
      if (blockReasonOf(t, now)) continue
      out.push(t)
    }
    return out
  }

  const bump = (tracker: Tracker, taskIdx: number, inc = 1) => {
    resetExpiredProgress()
    const task = tracker.tasks[taskIdx]
    const slot = qpTaskSlot(task, taskIdx)
    const slotCount = Math.max(0, ...qpTaskGroups(tracker.tasks).map((group) => group.slot)) + 1
    const counts = (progress[tracker.questId] ??= Array.from({ length: slotCount }, () => 0))
    while (counts.length < slotCount) counts.push(0)
    const cap = (task as any).count || 1
    const next = Math.min(cap, (counts[slot] ?? 0) + inc)
    if (next === counts[slot]) return
    counts[slot] = next
    progressUpdated[tracker.questId] = Date.now()
    ledger.saveQuestProgress(tracker.questId, counts)
    if (tracker.stateGoal) broadcastState()
    else broadcastProgress(tracker.questId)
    console.log(`[kanso] qp: 任务 ${tracker.questId} 槽 ${slot + 1} 计数 +${inc} → ${next}/${cap}`)
  }

  const broadcastState = () => {
    send('qp:state', toState())
  }

  const bumpOnce = (
    tracker: Tracker,
    taskIdx: number,
    bumpedSlots: Set<number>,
    inc = 1,
  ) => {
    const slot = qpTaskSlot(tracker.tasks[taskIdx], taskIdx)
    if (bumpedSlots.has(slot)) return
    bumpedSlots.add(slot)
    bump(tracker, taskIdx, inc)
  }

  const sortieFleet = (deckId: number): FleetShip[] => {
    const s = store.getState().player
    const deck = s.decks.find((d) => d.id === deckId)
    if (!deck) return []
    return deck.ships
      .filter((id) => id > 0)
      .map((id) => ({
        mstId: s.ships[id]?.shipId ?? 0,
        lv: s.ships[id]?.lv ?? 0,
        soku: s.ships[id]?.soku ?? 0,
      }))
  }

  const condOk = (
    t: Tracker,
    fleet: FleetShip[],
    deckId: number,
    task?: QpTask,
  ): boolean => {
    const fleetView = fleet.map((ship) => ({
        ...ship,
        stype: master.stype.get(ship.mstId) ?? 0,
        ctype: master.ctype.get(ship.mstId) ?? 0,
        soku: ship.soku || master.soku.get(ship.mstId) || 0,
      }))
    if (t.fleetGoal && !evaluateFleetGoal(t.fleetGoal, fleetView, deckId).ok) return false
    if (task?.fleetGoal && !evaluateFleetGoal(task.fleetGoal, fleetView, deckId).ok) return false
    return true
  }

  const stockGoalCurrent = (
    goal: QpStockGoal,
    materialRefund: number[] = [],
  ): number | null => {
    const player = store.getState().player
    if (goal.kind === 'material') {
      const current = player.materials?.[goal.id]
      return current == null ? null : Math.max(0, current - (materialRefund[goal.id] ?? 0))
    }
    if (goal.kind === 'useitem') {
      // 单一出处：见 shared/useitem-stock（铃的推定通道同一份，改这边别忘那边）
      const index = USEITEM_MATERIAL_INDEX[goal.id]
      return index !== undefined
        ? player.materials?.[index] ?? null
        : player.useitems[goal.id] ?? 0
    }
    const instances = Object.values(player.slotitems)
    if (goal.kind === 'equip') {
      return instances.filter((item) => item.mstId === goal.id).length
    }
    return instances.filter((item) =>
      goal.ids.includes(master.equipType.get(item.mstId)?.[2] ?? -1),
    ).length
  }

  const equipmentGoalsUseDistinctSlots = (
    goals: QpStateGoal['equipment'],
    equipped: { slot: number; mstId: number; level: number; alv: number }[],
  ): boolean => {
    const needs = (goals ?? []).map((goal, index) => ({
      index,
      candidates: equipped
        .map((item, itemIndex) => ({ item, itemIndex }))
        .filter(({ item }) =>
          goal.mstIds.includes(item.mstId) &&
          (goal.slot === undefined || goal.slot === item.slot) &&
          (!goal.fullySkilled || item.alv >= 7) &&
          (!goal.maxModified || item.level >= 10),
        )
        .map(({ itemIndex }) => itemIndex),
    })).sort((left, right) => left.candidates.length - right.candidates.length)
    const used = new Set<number>()
    const assign = (index: number): boolean => {
      if (index >= needs.length) return true
      for (const candidate of needs[index].candidates) {
        if (used.has(candidate)) continue
        used.add(candidate)
        if (assign(index + 1)) return true
        used.delete(candidate)
      }
      return false
    }
    return assign(0)
  }

  const evaluateStateGoal = (goal: QpStateGoal): QpStateGoalDiff => {
    const player = store.getState().player
    const firstDeck = player.decks.find((deck) => deck.id === 1) ?? player.decks[0]
    const flagshipId = firstDeck?.ships[0] ?? 0
    const flagship = flagshipId > 0 ? player.ships[flagshipId] : undefined
    const lines: QpStateGoalDiff['lines'] = []
    if (goal.secretary) {
      const mstId = flagship?.shipId ?? 0
      const stype = master.stype.get(mstId) ?? 0
      const ok = Boolean(
        flagship &&
        (
          goal.secretary.ships === 'any' ||
          goal.secretary.ships.includes(mstId) ||
          goal.secretary.stypes.includes(stype)
        ),
      )
      lines.push({
        label: `秘书舰 ${goal.secretary.label}`,
        current: ok ? 1 : 0,
        required: 1,
        ok,
        issue: ok
          ? null
          : flagship
            ? `当前秘书舰是 ${shipName(mstId)}`
            : '第一舰队当前没有秘书舰',
      })
    }
    const equipped = (flagship?.slot ?? [])
      .map((instanceId, index) => {
        const instance = player.slotitems[instanceId]
        return instance
          ? {
              slot: index + 1,
              mstId: instance.mstId,
              level: instance.level,
              alv: instance.alv,
            }
          : null
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    for (const requirement of goal.equipment ?? []) {
      const inSlot = equipped.filter((item) =>
        requirement.mstIds.includes(item.mstId) &&
        (requirement.slot === undefined || requirement.slot === item.slot),
      )
      const qualified = inSlot.filter((item) =>
        (!requirement.fullySkilled || item.alv >= 7) &&
        (!requirement.maxModified || item.level >= 10) &&
        (requirement.minLevel === undefined || item.level >= requirement.minLevel),
      )
      const best = inSlot
        .slice()
        .sort((left, right) => right.alv - left.alv || right.level - left.level)[0]
      const ok = qualified.length > 0
      let issue: string | null = null
      if (!ok && !best) {
        issue = requirement.slot === undefined
          ? `秘书舰未装备「${requirement.label}」`
          : `秘书舰第${requirement.slot}格未装备「${requirement.label}」`
      } else if (!ok && requirement.fullySkilled && (best?.alv ?? 0) < 7) {
        issue = `「${requirement.label}」练度不满（当前 ${best?.alv ?? 0}，需要 max）`
      } else if (!ok && requirement.maxModified && (best?.level ?? 0) < 10) {
        issue = `「${requirement.label}」改修不满（当前 +${best?.level ?? 0}，需要 +10）`
      } else if (
        !ok &&
        requirement.minLevel !== undefined &&
        (best?.level ?? 0) < requirement.minLevel
      ) {
        issue = `「${requirement.label}」改修不足（当前 +${best?.level ?? 0}，需要 +${requirement.minLevel}）`
      }
      lines.push({
        label: requirement.label,
        current: ok ? 1 : 0,
        required: 1,
        ok,
        issue,
      })
    }
    if (
      goal.equipment?.length &&
      lines.filter((line) => !line.label.startsWith('秘书舰 ')).every((line) => line.ok) &&
      !equipmentGoalsUseDistinctSlots(goal.equipment, equipped)
    ) {
      lines.push({
        label: '目标装备',
        current: equipped.length,
        required: goal.equipment.length,
        ok: false,
        issue: '同一件装备不能同时满足多个装备位要求',
      })
    }
    return { ok: lines.every((line) => line.ok), lines }
  }

  const stateGoalReady = (tracker: Tracker, materialRefund: number[] = []): boolean => {
    if (tracker.stateGoal && !evaluateStateGoal(tracker.stateGoal).ok) return false
    return !(tracker.stockGoals ?? []).some((goal) => {
      const current = stockGoalCurrent(goal, materialRefund)
      return current == null || current < goal.count
    })
  }

  const RANK_VALUE: Record<string, number> = { E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 }
  const resultRankValue = (rank: unknown, perfect: boolean): number => {
    const value = RANK_VALUE[`${rank ?? ''}`] ?? 0
    return value === 6 && perfect ? 7 : value
  }

  // 事件入口：在 store.handle 之后调用（依赖已更新的 sortie/decks 状态）。
  // 废弃装备例外：调用方额外带动作前的被删实例，供类别任务识别。
  // 远征结算例外：同理带动作前的 missionId（归约器已把 deck.mission 清零）。
  const onQuestApi = (
    apiPath: string,
    body: any,
    post: Record<string, string>,
    context: QuestApiContext = {},
  ) => {
    try {
      dispatch(apiPath, body, post, context)
    } catch (e) {
      console.warn('[kanso] qp: dispatch failed', apiPath, e)
    }
  }

  const dispatch = (
    apiPath: string,
    body: any,
    post: Record<string, string>,
    context: QuestApiContext,
  ) => {
    if (apiPath === '/kcsapi/api_start2/getData') {
      initQuestCounter(body, true)
      return
    }

    if (apiPath === '/kcsapi/api_get_member/questlist') {
      resetExpiredProgress()
      const tabId = parseInt(`${post.api_tab_id ?? -1}`, 10)
      if (tabId === 0 || tabId === 9) repairContradictedCompleteProgress()
      broadcastState()
    }

    // ---- 原生计数：工厂类动作（EO 不覆盖）----
    const ACTION_BY_PATH: Record<string, QpAction> = {
      '/kcsapi/api_req_kousyou/createitem': 'createitem',
      '/kcsapi/api_req_kousyou/createship': 'createship',
      '/kcsapi/api_req_kousyou/destroyship': 'destroyship',
      '/kcsapi/api_req_kousyou/destroyitem2': 'destroyitem',
      '/kcsapi/api_req_hokyu/charge': 'charge',
      '/kcsapi/api_req_nyukyo/start': 'nyukyo',
      '/kcsapi/api_req_kousyou/remodel_slot': 'remodel_slot',
      '/kcsapi/api_req_kaisou/powerup': 'powerup',
      '/kcsapi/api_req_map/start': 'sortie',
      '/kcsapi/api_req_mission/start': 'expedition_start',
    }
    let action = ACTION_BY_PATH[apiPath]
    // 近代化改修：任务口径是「成功实施 N 次」，失败不算（api_powerup_flag 才是成功标志）
    if (action === 'powerup' && body?.api_powerup_flag !== 1) action = undefined as any
    if (action) {
      // 批量 API 按实际动作数计：解体取请求 id 数（按艘），连续开发取响应结果槽数；
      // 废弃装备分两族——缺省**每次操作 +1**（一括廃棄只算 1 回），标了 perItem 的按件 +n。
      // 两个增量都先算好，再逐条任务按自己的 perItem 取用，见 actionIncrement 的出处。
      const inc = actionIncrement(action, body, post)
      const incPerItem = actionIncrement(action, body, post, { perItem: true })
      const tracked = activeTracked()
      let hit = 0
      for (const t of tracked) {
        t.tasks.forEach((task, i) => {
          if (task.kind === 'action' && task.action === action) {
            bump(t, i, task.perItem ? incPerItem : inc)
            hit += 1
          }
        })
      }
      if (!hit) {
        // 计数没落到任何任务时说清原因，免得只能靠猜
        const known = Object.keys(store.getState().player.quests).length
        console.log(
          `[kanso] qp: ${action} 事件未计入任何任务（遂行中且有追踪器 ${tracked.length} 条 · 已知任务 ${known} 条${known === 0 ? '——游戏里打开一次任务页即可同步' : ''}）`,
        )
      }
    }


    // 交付/放弃：清本地进度（放弃保留进度与 EO 口径一致，仅交付清）
    if (apiPath === '/kcsapi/api_req_quest/clearitemget') {
      const qid = parseInt(post.api_quest_id, 10)
      if (qid > 0 && progress[qid]) {
        delete progress[qid]
        delete progressUpdated[qid]
        ledger.deleteQuestProgress(qid)
        broadcastProgress(qid, null)
      }
      return
    }

    // 到达节点（出击进图/进击）
    if (apiPath === '/kcsapi/api_req_map/start' || apiPath === '/kcsapi/api_req_map/next') {
      const sortie = store.getState().sortie
      if (!sortie || sortie.practice) return
      const fleet = sortieFleet(sortie.deckId)
      const cell = num(body.api_no, -1)
      // `bossReach`（あ号第二轴）**不在这里计**——它要的是「打完那一战」，见 battleresult 分支。
      // 罗盘事件 8 = 船団護衛成功（1-6 终点 N）：护航图的「クリア」就在这一刻，
      // 没有战斗结算，battleresult 那条路永远等不到它（2026-08-12 用户实锤）
      const escortGoal = num(body.api_event_id, -1) === 8
      for (const t of activeTracked()) {
        t.tasks.forEach((task, i) => {
          if (!condOk(t, fleet, sortie.deckId, task)) return
          if (task.kind === 'nodeReach' && task.map[0] === sortie.mapArea && task.map[1] === sortie.mapNo && task.nodes.includes(cell)) {
            bump(t, i)
          } else if (
            task.kind === 'mapGoal' &&
            escortGoal &&
            task.map[0] === sortie.mapArea &&
            task.map[1] === sortie.mapNo
          ) {
            bump(t, i)
          }
        })
      }
      return
    }

    // 战斗结算（出击）
    if (
      apiPath === '/kcsapi/api_req_sortie/battleresult' ||
      apiPath === '/kcsapi/api_req_combined_battle/battleresult'
    ) {
      const sortie = store.getState().sortie
      if (!sortie || sortie.practice) return
      const node = sortie.nodes.find((n) => n.cell === sortie.currentCell)
      const rank = resultRankValue(body.api_win_rank, sortie.battle?.prediction.perfect === true)
      const isBoss = node?.eventId === 5
      const firstClear = body.api_first_clear === 1
      const fleet = sortieFleet(sortie.deckId)
      for (const t of activeTracked()) {
        t.tasks.forEach((task, i) => {
          if (!condOk(t, fleet, sortie.deckId, task)) return
          if (task.kind === 'bossKill') {
            if (isBoss && task.map[0] === sortie.mapArea && task.map[1] === sortie.mapNo && rank >= task.rank) bump(t, i)
          } else if (task.kind === 'battleNode') {
            if (
              task.map[0] === sortie.mapArea &&
              task.map[1] === sortie.mapNo &&
              rank >= task.rank &&
              (!task.nodes.length || task.nodes.includes(sortie.currentCell))
            ) bump(t, i)
          } else if (task.kind === 'battleWin') {
            if (rank >= task.rank) bump(t, i)
          } else if (task.kind === 'bossWin') {
            if (isBoss && rank >= task.rank) bump(t, i)
          } else if (task.kind === 'bossReach') {
            // 「ボス到達」的真实口径是**在 boss 格打完一战**，不是走到就算，且与胜负无关
            //（打输 C/D/E 一样 +1）。两条独立出处：
            // ① wikiwiki 全任務一覧 Bw1 行脚注：「1-6のゴールは資源マスであるため、当該マスに
            //    於いてS勝利とボス到達、ボス戦勝利は判定されない」——终点不是战斗格就不算到達，
            //    「到達」二字在这条任务里指的其实是 boss 战本身；
            // ② KancolleSniffer 的 CountAgo 把这一轴放在 battleresult 里递增（boss 标志则来自
            //    map/start·map/next 的 api_event_id==5）。
            // 原实现挂在 map/start·map/next 上，玩家到 boss 格后撤退不打也会 +1——
            // 本机账本里实测多计 7 次（08-03 1-4 / 08-07·08-08 62-4 ×4 / 08-09 62-2 / 08-12 6-5）。
            if (isBoss) bump(t, i)
          } else if (task.kind === 'sinkEnemy') {
            const sunk = (sortie.battle?.eShips ?? []).filter(
              (ship) => ship.hpEnd <= 0 && task.stypes.includes(master.stype.get(ship.mstId) ?? -1),
            ).length
            if (sunk > 0) bump(t, i, sunk)
          } else if (task.kind === 'mapFirstClear') {
            if (isBoss && firstClear && task.map[0] === sortie.mapArea && task.map[1] === sortie.mapNo) bump(t, i)
          }
        })
      }
      return
    }

    // 演习结算
    if (apiPath === '/kcsapi/api_req_practice/battle_result') {
      const sortie = store.getState().sortie
      const rank = resultRankValue(body.api_win_rank, sortie?.battle?.prediction.perfect === true)
      const fleet = sortieFleet(sortie?.deckId ?? 1)
      for (const t of activeTracked()) {
        t.tasks.forEach((task, i) => {
          if (!condOk(t, fleet, sortie?.deckId ?? 1, task)) return
          if (task.kind === 'exercise' && rank >= task.rank) bump(t, i)
        })
      }
      return
    }

    // 远征结算（大成功同样 +1，EO 口径）
    if (apiPath === '/kcsapi/api_req_mission/result') {
      if (num(body.api_clear_result, 0) < 1) return
      const deckId = parseInt(post.api_deck_id, 10)
      const missionId = context.expeditionMissionId ?? -1
      const fleet = sortieFleet(deckId)
      for (const t of activeTracked()) {
        const bumpedSlots = new Set<number>()
        t.tasks.forEach((task, i) => {
          if (!condOk(t, fleet, deckId, task)) return
          if (task.kind === 'expedition' && (task.missionId === 0 || task.missionId === missionId)) {
            bumpOnce(t, i, bumpedSlots)
          }
        })
      }
      return
    }

    // 装备废弃（不查编成条件，一次 n 件 = +n；EO 口径）
    if (apiPath === '/kcsapi/api_req_kousyou/destroyitem2') {
      const ids = `${post.api_slotitem_ids ?? ''}`.split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0)
      if (!ids.length) return
      const slotitems = context.destroyedSlotitems ?? store.getState().player.slotitems
      const materialRefund = Array.isArray(body?.api_get_material)
        ? body.api_get_material.map((value: unknown) => Math.max(0, Number(value) || 0))
        : []
      for (const t of activeTracked()) {
        // store 已先合入废弃返还；资源门应按动作前库存判断，因此扣回本次返还再核对。
        if (t.stateGoal && !stateGoalReady(t, materialRefund)) continue
        t.tasks.forEach((task, i) => {
          for (const instId of ids) {
            const mstId = slotitems[instId]?.mstId
            if (!mstId) continue
            const type = master.equipType.get(mstId) ?? []
            if (
              (task.kind === 'scrapEquip' && task.equipId === mstId) ||
              (task.kind === 'scrapCategory' && task.category === type[2]) ||
              (task.kind === 'scrapCardType' && task.cardType === type[1]) ||
              (task.kind === 'scrapIconType' && task.iconType === type[3])
            ) {
              bump(t, i)
            }
          }
        })
      }
    }
  }

  // 按现有各舰队实时判定「这条任务的编成条件谁满足」。
  // 计数时本来就要过这道门（condOk），这里只是把同一道门开放成可查询——
  // 判定逻辑只此一份，钦的「当前编成可直接做」不会和实际计数口径打架。
  // 返回 questId → { hasCond, decks }：
  //   hasCond=false 无编成限制（任何编成都算）；decks = 满足条件的舰队 id
  const checkFleet = (): QpFleetCheck => {
    const player = store.getState().player
    const out: QpFleetCheck = {}
    // 每队的 FleetShip 只算一次，别在任务循环里反复重建
    const fleets = player.decks.map((d) => ({ id: d.id, ships: sortieFleet(d.id) }))
    for (const [qid, tracker] of trackers) {
      if (player.quests[qid]?.state !== 2) continue // 只看遂行中
      const stateGoal = tracker.stateGoal ? evaluateStateGoal(tracker.stateGoal) : undefined
      const stateAllows = stateGoal?.ok !== false
      if (tracker.fleetGoal) {
        const diffs = player.decks.map((deck) =>
          evaluateFleetGoal(
            tracker.fleetGoal!,
            deck.ships
              .filter((id) => id > 0)
              .map((id) => {
                const ship = player.ships[id]
                const mstId = ship?.shipId ?? 0
                return {
                  mstId,
                  stype: master.stype.get(mstId) ?? 0,
                  ctype: master.ctype.get(mstId) ?? 0,
                  soku: ship?.soku || master.soku.get(mstId) || 0,
                  lv: ship?.lv ?? 0,
                }
              }),
            deck.id,
          ),
        )
        out[qid] = {
          hasCond: true,
          decks: stateAllows ? diffs.filter((diff) => diff.ok).map((diff) => diff.deckId) : [],
          diffs,
          ...(stateGoal ? { stateGoal } : {}),
        }
        continue
      }
      if (tracker.tasks.some((task) => task.fleetGoal)) {
        out[qid] = {
          hasCond: true,
          decks: stateAllows ? fleets
            .filter((fleet) =>
              fleet.ships.length > 0 &&
              tracker.tasks.some((task) => condOk(tracker, fleet.ships, fleet.id, task)),
            )
            .map((fleet) => fleet.id) : [],
          ...(stateGoal ? { stateGoal } : {}),
        }
        continue
      }
      // 没有编成门：任何编成都算。hasCond 只在还有秘书舰/装备那道门时为真。
      out[qid] = {
        hasCond: Boolean(stateGoal),
        decks: stateAllows ? fleets.map((f) => f.id) : [],
        ...(stateGoal ? { stateGoal } : {}),
      }
    }
    return out
  }

  return {
    init: initQuestCounter,
    onApi: onQuestApi,
    state: toState,
    checkFleet,
    reconcile: reconcileQuestProgress,
    resetExpired: resetExpiredProgress,
    rebuildMasterIndex,
  }

}
