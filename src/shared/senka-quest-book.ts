// 任务战果**入账的判据**（2026-09-01 用户拍板，二次翻车后立的）。
//
// 事故：9 月账里凭空多出五笔任务战果（quest 284/845/854/872/893，共 +1460，
// 官方真值 35）。其中 854/872 用户**从没做过**——账本 quest_progress 一行都没有，
// events 里一条 clearitemget 都没有。按「重算任务战果」删掉，同一判据立刻把它们
// 又补回来，表面看着毫无变化。
//
// 根因不是判据算错，是判据的**类型**错了：它拿的是「已完成」这个**推断**
// （前置满足 + 不在任务表里 = 已交付）。任务表在月初重置那一刻本来就会失真，
// 于是「从没做过」也被推断成「已交付」。资格闸（周期起点 ≥ 战果月起点）
// 在 9/1 05:00 之后如实放行——闸是好的，被它放行的那个结论是编的。
//
// 所以口径整个换掉，三条：
//
// 1. **入账只认硬证据。** 一笔任务战果要进账，必须在账本 events 里找到
//    该任务的 `clearitemget` 报文——那是游戏亲口说「这个任务的奖励发给你了」。
//    kuma 在跑时的实时路径（mg/index 收到 clearitemget 就记）本来就是这一形态，
//    这里只是把补记也收进同一个形态：**推断出来的「已完成」永远不入账。**
//
// 2. **归属月看证据的时间戳。** 哪一笔算哪个月，由报文观测到的那一刻决定，
//    不由「现在是几月」决定。月界（前月末 22:00 JST）与任务重置（次月 1 日
//    05:00 JST）差着 7 小时，这 7 小时里两种口径必然打架——认时间戳就没这回事。
//
// 3. **循环任务一个周期只计一次**（用户亲笔）：计在完成动作发生的那个月，
//    同周期的后续月份即便看到「已完成」也不再计。落地就是去重窗口从
//    「同任务同战果月」放大到「同任务同**周期**」。
//
// 去重窗口取**周期 ∪ 战果月**：两头都要盖住。只取周期会漏掉老账里那些
// ts 被钉在月初整值上的合成行（月初 22:00 早于当月任务重置的 05:00，
// 根本不落在周期区间里）；只取战果月就是出事的旧口径。取并集则两种都框得住，
// 且方向永远是「宁可不记，不可重记」。
//
// 判定是纯算术，不碰数据库也不碰 electron——单测直接 import 跑（senka-quest-evidence）。

import { senkaMonthEnd, senkaMonthStart } from './senka'
import { questPeriodEnd, questPeriodStart } from './quest-period'

import type { QuestPeriodKind } from './quest-period'

/**
 * 从账本 events 的 `post_body` 里读出任务号。
 *
 * **存下来的 post_body 是 JSON 串**（抓包桥 `querystring.parse` 之后
 * `JSON.stringify`，凭据再被 post-body-redact 洗过一遍），不是表单串——
 * 拿 `URLSearchParams` 直接解会得到 null 而不报错，那正是「查无证据」最毒的
 * 一种假象。表单串分支留作兜底，与 redactPostBody 同一态度：
 * 格式意外不该让判定悄悄退化成「没有」。
 */
export const questIdFromClearItemGet = (postBody: string | null | undefined): number | null => {
  const text = `${postBody ?? ''}`
  if (!text) return null
  let raw: unknown
  try {
    const parsed = JSON.parse(text)
    raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).api_quest_id : null
  } catch (_e) {
    raw = new URLSearchParams(text).get('api_quest_id')
  }
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 去重窗口 = 该证据所属**周期** ∪ 所属**战果月**（左闭右开）。
 * 周期定位不到（年任重置月未知、或不是常设编码）就只剩战果月那一段——
 * 定位不到就不放大窗口，但也绝不缩小。
 */
export const questSenkaBookingWindow = (
  kind: QuestPeriodKind | null,
  evidenceTs: number,
  annualMonth?: number | null,
): { from: number; to: number } => {
  const from = senkaMonthStart(evidenceTs)
  const to = senkaMonthEnd(evidenceTs)
  if (!kind) return { from, to }
  const periodFrom = questPeriodStart(kind, evidenceTs, annualMonth)
  const periodTo = questPeriodEnd(kind, evidenceTs, annualMonth)
  if (periodFrom == null || periodTo == null) return { from, to }
  return { from: Math.min(from, periodFrom), to: Math.max(to, periodTo) }
}

/** 不入账时说清是哪一种「不」——展示层要照实说，不许一律显示成「补记中」。 */
export type QuestSenkaBookingReason = 'booked' | 'no-senka' | 'no-evidence' | 'already-booked'

export interface QuestSenkaBookingPlan {
  book: boolean
  /** 入账时刻 = 证据时刻。不入账时给 null（没有可编的时刻） */
  ts: number | null
  reason: QuestSenkaBookingReason
  /** 用到的去重窗口；没走到去重那一步时是 null */
  window: { from: number; to: number } | null
}

export interface QuestSenkaBookingInput {
  /** 该任务的固定战果分值（questFixedSenka 解出来的） */
  senka: number
  kind: QuestPeriodKind | null
  annualMonth?: number | null
  /** 观测到 clearitemget 的时刻；null = 没有证据 */
  evidenceTs: number | null
  /** 账本里这个任务已有的行的时间戳（全给即可，窗口在这里框） */
  bookedTs: readonly number[]
}

/**
 * 一笔任务战果到底记不记、记在哪一刻。账本只负责把 SQL 查出来的时间戳递进来，
 * 判断全在这里——判据要能脱开 sqlite 与 electron 单独跑一遍。
 */
export const planQuestSenkaBooking = (input: QuestSenkaBookingInput): QuestSenkaBookingPlan => {
  if (!(input.senka > 0)) return { book: false, ts: null, reason: 'no-senka', window: null }
  if (input.evidenceTs == null) return { book: false, ts: null, reason: 'no-evidence', window: null }
  const window = questSenkaBookingWindow(input.kind, input.evidenceTs, input.annualMonth)
  const taken = input.bookedTs.some((ts) => ts >= window.from && ts < window.to)
  return taken
    ? { book: false, ts: null, reason: 'already-booked', window }
    : { book: true, ts: input.evidenceTs, reason: 'booked', window }
}

export interface ManualQuestSenkaInput {
  /** 该任务的固定战果分值（questFixedSenka 解出来的） */
  senka: number
  kind: QuestPeriodKind | null
  annualMonth?: number | null
  /** 玩家按下补记的时刻。去重窗口按**它**所在的周期框，落账时刻另算（见下） */
  at: number
  /** 账本里这个任务已有的行的时间戳（手动行与观测行都要给） */
  bookedTs: readonly number[]
}

/**
 * 玩家自己补一笔任务战果（2026-09-01 用户要的权利：季中才装上 kuma 的玩家，
 * 之前交过的任务账本里不可能有证据）。形态照氪金那族的手动补记——
 * `pay_log` 的 `kind='manual'`：手动行与观测行同表分标记，只有手动行可删。
 *
 * 与报文入账的两处差别，各有各的理由：
 *
 * - **窗口按「按下补记的那一刻」框，不按落账时刻框。** 拿落账时刻去算周期，
 *   月任/季任会算到**上一期**头上：月界（前月末 22:00）早于任务重置（次月 1 日 05:00），
 *   月初那一刻的「当前周期」还是上个月那一期，窗口就会连上月已记的那笔一起盖住，
 *   本月这一笔永远补不进来。
 * - **落账时刻取本战果月起点与本周期起点里较晚的那个**（manualQuestSenkaTs）。
 *
 * 落账时刻为什么是这两者的较晚者，而不是干脆取月初：月初那一刻**不在本周期里**
 * （季任 9 月那一期从 9/1 05:00 起，而 9 月战果月从 8/31 22:00 起，差 7 小时）。
 * 钉在月初的行落在上一期的区间里，10 月真报文来时按周期框根本框不到它，
 * 同一个季度就会被记第二笔——用户明确要的是「季任九月补了，坑占到该周期结束」。
 * 取较晚者，这一笔就同时落在周期窗与战果月窗里，两个方向的去重都框得住。
 *
 * 它仍是「本月最早的可能时刻」：玩家说不出准确时刻，而这一刻之前本期根本还没开始。
 * 也仍在任何一次实际校准之前——校准只在本战果月内有效，而这是本月账目的起跑线。
 */
export const manualQuestSenkaTs = (
  kind: QuestPeriodKind | null,
  at: number,
  annualMonth?: number | null,
): number => {
  const monthStart = senkaMonthStart(at)
  const periodStart = kind ? questPeriodStart(kind, at, annualMonth) : null
  return periodStart == null ? monthStart : Math.max(monthStart, periodStart)
}

export const planManualQuestSenkaBooking = (input: ManualQuestSenkaInput): QuestSenkaBookingPlan => {
  if (!(input.senka > 0)) return { book: false, ts: null, reason: 'no-senka', window: null }
  const window = questSenkaBookingWindow(input.kind, input.at, input.annualMonth)
  const taken = input.bookedTs.some((ts) => ts >= window.from && ts < window.to)
  return taken
    ? { book: false, ts: null, reason: 'already-booked', window }
    : {
        book: true,
        ts: manualQuestSenkaTs(input.kind, input.at, input.annualMonth),
        reason: 'booked',
        window,
      }
}

export interface QuestCountObservation {
  /**
   * 各计数槽的目标值（qpTaskGroups 给的 slot 与该槽的 count）。空 = 没有可计数动作。
   * **按槽号成对给，不给数组下标**：「远征 A 或 B」这类备选任务共用一个槽，
   * 槽号与 tasks 下标本来就会错位（镖曾因此串位，见 qp-types 的 progress 头注）。
   */
  targets: readonly { slot: number; target: number }[]
  /** kuma 观测到的逐槽计数。null / 空 = 一次都没观测到 */
  counts: readonly number[] | null | undefined
  /** 追踪器自报：计数可能偏多 */
  approx?: boolean
  /** 追踪器自报：只覆盖部分条件，计满不代表可交付 */
  partial?: boolean
  /** 计数之外还有状态门 / 库存门（stateGoal / stockGoals），满了游戏也未必让交 */
  extraGoals?: boolean
}

/**
 * 「kuma 本周期内亲眼看着这条任务的计数数满了」——战果面板那张提示单唯一的入场券
 *（2026-09-01 用户拍板，f3543a3 之后他抓的残留）。
 *
 * 在此之前那张单子填的是**推断**（前置满足 + 不在任务表 = 已交付）。推断在月初
 * 重置那一刻必然失真，于是他账本上五条从没做过的任务全被列了出来（284/845/854/872/893，
 * quest_progress 一行都没有）。入账那一层 f3543a3 已经换成硬证据，提示这一层没换，
 * 所以同一个推断换了个地方继续说话。这里把它整个换掉：只认自家的观测计数。
 *
 * **计数为什么天然就是「本周期内」的**：quest-counter 的 resetExpiredProgress 在
 * 跨过重置线时把该任务的计数删掉并落盘。所以能读到的计数，就是本期数出来的。
 *
 * 四条硬性排除，都是「计满 ≠ 交付过」的已知形态：
 * - 没有计数槽（targets 空）：这条任务本来就没有可计数动作，观测不出满不满；
 * - 一格计数都没有：正是他那五条的形态；
 * - `partial` / `extraGoals`：追踪器自己说了计满也不代表可交付
 *   （与 quest-counter 的 repairContradictedCompleteProgress 同一张排除单：
 *   实弹样本是四项废弃全满、还差准备 10 个 12.7cm 连装高角炮）；
 * - `approx`：计数本身就是「可能偏多」的推定，再往上推出「可能交付过」就是
 *   推定叠推定（用户 2026-08-16 拍过板的口径）。
 */
export const questCountsObservedFull = (input: QuestCountObservation): boolean => {
  if (input.approx || input.partial || input.extraGoals) return false
  if (!input.targets.length) return false
  const counts = input.counts
  if (!counts || !counts.length) return false
  return input.targets.every(({ slot, target }) => (counts[slot] ?? 0) >= Math.max(1, target))
}
