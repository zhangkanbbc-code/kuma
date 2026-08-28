// 「限定期窗口」的类型与判据——**运行时与维护者脚本共用的唯一一份**。
//
// 为什么单独一个文件：这几个判断三处都要用（运行时装配、渲染层折叠、
// scripts/ 的对照报告），而它们**判断写反了不会报错**，只会安静地说错话：
// 把「一直开着」说成「快关门」是凭空造紧迫感，把「已经收窗」说成「还开着」
// 是让玩家白跑一趟。所以判据抽成纯函数、脱 DOM 可测，各处一律引它。
// 这个文件**不 import 任何东西**（照 map-drop-corrections 的先例），
// 好让 .mjs 脚本也能直接读。
//
// ---- 三态口径（用户 2026-08-09 当面纠正过的那条，一字不改）----
//
// 舰C 的掉落按「会不会消失」分类，**跟有没有写截止日无关**：
//   · 常规图的限定掉落多是某次追加后一直开着的（玩家口径的「永久开放的限定掉落」），
//     资料上本来就不给截止日。所以 `until: null` 是**如实记录**，不是资料缺失，
//     调用方不许据此制造「快关门」的紧迫感；
//   · 活动图才是真会消失的那类，且官方通常到结束前 1–2 周才公布日期，
//     所以活动的 `until` 是 null 时含义相反——「有时限但日期未知」。
//     活动那一层由 `MapIntelMap.event` 表达，不走这里。

/**
 * 限定期条目的生命周期。旧包没有这一格，读作 active_confirmed。
 *
 * 四态里有两个「结束」，差别是**凭什么说它结束**，不是程度差：
 *   · `ended_confirmed` 有人给出了结束日（`until` 必填）。
 *   · `ended_undated`   上游**指名道姓说它终了**，但从没公布过是哪天
 *     （`until` 必须为 null）。常规图的期间限定邂逅就是这一类：
 *     wikiwiki 用删除线逐条标终了，无预告、也不写日期。
 * 它与 `end_pending` 的分别是**断言 vs 缺席**：end_pending 只是「上游不再列出它」，
 * 没有任何一方说过它结束——那是疑似，不许对玩家说「已终了」。
 */
export type LimitedDropStatus =
  | 'active_confirmed'
  | 'end_pending'
  | 'ended_confirmed'
  | 'ended_undated'

/**
 * 这一条台账**凭什么**这么写。第一方台账里每条都必须有，不许留空
 *（方案 §3.3 三条纪律之一：只补事实、每条带出处与录入日期、数量必须收敛）。
 *
 * `kind` 的优先次序就是可靠性次序：
 *   · `official`  游戏内公告 / 官方推文——运营自己说的，最硬；
 *   · `ledger`    本机遭遇志 `encounters.drop_mst` 的实测日期——第一方一手，但只有下界；
 *   · `community` 社区资料整理——**写明是参考**，不冒充一手。
 */
export type LimitedEvidenceKind = 'official' | 'ledger' | 'community'

export interface LimitedEvidence {
  kind: LimitedEvidenceKind
  /** 具体凭据。写清是哪一份、什么口径，别写「见资料」。 */
  note: string
  /** 录入/最后复核这条凭据的日子（YYYY-MM-DD） */
  recordedAt: string
}

export interface LimitedWindow {
  from: string
  until: string | null
  lastConfirmedAt: string
  // 旧矿脉包没有 status；运行时按 active_confirmed 兼容。
  status?: LimitedDropStatus
  statusChangedAt?: string
  /** 哪次活动/纪念带进来的（限定期小节标题，如「13周年記念」「節分」）。
   *  玩家看得到来路，退场时也能按批清点。旧包没有这个字段。 */
  label?: string
}

/**
 * 窗口此刻处在哪一态。
 *
 * 四档，其中「开窗」按有没有日期分成两档——它们对玩家的意思完全不同：
 *   · `open_undated` 没有截止日（常规图限定的**常态**）：还开着，也没人说过会关。
 *     **不许**据此说「即将结束」。
 *   · `open_dated`   有截止日且还没到：真的有个日子要赶。
 *   · `closed`       截止日已过 = **已收窗**。观测落在这一段里的要挂「窗口已结束」。
 *   · `end_pending`  上游不再列出它，但没有任何一方给出结束日——
 *                    「大概是关了，但说不出哪天关的」。这一档**不算已收窗**：
 *                    说不出日子就没法断言某次观测落在窗口内（⑤-裁-2 的口径按日期算）。
 *   · `ended`        上游**指名道姓说它终了**了，只是没说是哪天（`ended_undated`）。
 *                    与 end_pending 的分别是断言 vs 缺席：这一档敢对玩家说「已终了」，
 *                    end_pending 不敢。它同样**不算已收窗**——没有日子就照样没法
 *                    断言某次观测落在窗口内，⑤-裁-2 的按日期口径一字不动。
 *
 * 判据只看日期，不看 status 的字面：`ended_confirmed` 却写着一个还没到的截止日，
 * 意思是「已确认它会在那天关」——那天之前它还在掉，此时报「已结束」是说错话。
 */
export type LimitedWindowPhase =
  | 'open_undated'
  | 'open_dated'
  | 'end_pending'
  | 'ended'
  | 'closed'

export const limitedWindowPhase = (
  window: LimitedWindow,
  today: string,
): LimitedWindowPhase => {
  const status = window.status ?? 'active_confirmed'
  if (window.until == null) {
    if (status === 'active_confirmed') return 'open_undated'
    return status === 'ended_undated' ? 'ended' : 'end_pending'
  }
  return window.until >= today ? 'open_dated' : 'closed'
}

/** 此刻还在掉。到期隐藏、「限时」标都以它为准。 */
export const isActiveLimitedWindow = (window: LimitedWindow, today: string): boolean => {
  const phase = limitedWindowPhase(window, today)
  return phase === 'open_undated' || phase === 'open_dated'
}

/** 已收窗：有截止日、且那一天已经过去。⑤-裁-2 的折叠判据只认这一档。 */
export const isClosedLimitedWindow = (window: LimitedWindow, today: string): boolean =>
  limitedWindowPhase(window, today) === 'closed'

/**
 * 上游已经指名说它终了（但没给日子）。**只有这一档能对玩家说「已终了」**——
 * end_pending 是「不再列出」的疑似，closed 是有日子的已收窗，都不走这里。
 */
export const isEndedLimitedWindow = (window: LimitedWindow, today: string): boolean =>
  limitedWindowPhase(window, today) === 'ended'

/** 某个日子（YYYY-MM-DD）落不落在这个窗口里。开区间一律取闭区间——边界那天算在内。 */
export const limitedWindowCovers = (window: LimitedWindow, date: string): boolean =>
  date >= window.from && (window.until == null || date <= window.until)

/**
 * 一段窗口写给人看的样子。
 *
 * 已终了那一档单独措辞：它的 `until` 也是 null，可原因跟「一直开着」正相反——
 * 照旧写「暂无截止日期」会把一条死路说成还开着。
 */
export const limitedWindowText = (window: LimitedWindow) => {
  const head = `${window.label ? `【${window.label}】` : ''}${window.from.replaceAll('-', '/')}`
  if ((window.status ?? 'active_confirmed') === 'ended_undated' && window.until == null) {
    return `${head} 起 · 已终了`
  }
  return `${head}–${window.until ? window.until.replaceAll('-', '/') : '暂无截止日期'}`
}

/**
 * 本机确认层的一条观测该摆在哪个语境里（用户 2026-08-22 拍板的 ⑤-裁-2）。
 *
 * **永不删除，只换语境。**「你在这里捞到过」是永真的历史事实，本机确认层的
 * 措辞本来就是过去式；窗口结束后要变的是呈现，不是数据：
 *   · 最近一次捞到的日子落在**已收窗**的窗口内 → `past`，挂「限定期捞到 · 窗口已结束」
 *     折进往期，不再混在面向当下的清单里；
 *   · 落在开窗/无截止的窗口内（常规图常态）→ `current`，原样显示，什么都不用做；
 *   · 窗口关了之后**又**捞到过 → 也是 `current`。这不是漏判：那正说明它其实还在掉，
 *     台账那一条该被重核。数据要诚实，不能因为台账说关了就把实测按到往期去。
 *
 * 取「最近一次」而不是「第一次」：判的是这条记录还算不算当下的线索。
 */
export type LocalDropEra = 'current' | 'past'

export interface LocalDropEraVerdict {
  era: LocalDropEra
  /** 判成 past 时是哪一段窗口；current 时为 null */
  window: LimitedWindow | null
}

export const localDropEraOf = (
  windows: readonly LimitedWindow[],
  lastSeen: string,
  today: string,
): LocalDropEraVerdict => {
  for (const window of windows) {
    if (isClosedLimitedWindow(window, today) && limitedWindowCovers(window, lastSeen)) {
      return { era: 'past', window }
    }
  }
  return { era: 'current', window: null }
}
