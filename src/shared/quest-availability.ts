import { questAnnualMonth, questPeriodFromCode, questPeriodKey } from './quest-period'

// 「这条任务我做完了吗 / 现在接得了吗 / 还差什么」。
//
// 游戏**不给任务履历**：交付过的单次任务就此从列表里消失，没有任何字段说
// 「你做过它」。但 tab 0「全部」是一次给全的（实测 118 条，不分页），
// 于是「在不在这张表里」本身成了可用的判据：
//
//   前置都满足的任务，游戏一定会把它摆在表里。
//   既然它不在表里，而前置又都满足 —— 那只能是**已经交付了**。
//
// 反过来，不在表里且有前置没做完，就是**还不能接**，而且能说出卡在哪几条。
// 这两句是对称的，靠同一个递归定义支撑。
//
// 前提是**手上这张表确实是全量**。分类页只给那一类，拿它当全集会把
// 没翻到的任务统统判成「不能接」——所以没有 questsFullTs 时一律 'unknown'，
// 不猜。

export interface QuestChainLike {
  id: number
  code: string
  pre: string[]
  /** 重置说明原文（年任的重置月从这里解析）。缺了只影响年任的跨期对齐 */
  memo2?: string
}

export type QuestAvailability =
  | 'claimable' // 已达成，等着领奖
  | 'active' // 已接受，进行中
  | 'open' // 在表里没接，现在就能接
  | 'done' // 已交付（周期任务 = 本期已交付）
  | 'locked' // 前置没做完，还接不了
  | 'unknown' // 判不了：没拿到过全量任务表

export interface QuestAvailabilityInput {
  /** 任务库（quests-scn）全表，提供 code 与前置 */
  entries: Iterable<QuestChainLike>
  /** 游戏当前给出的任务表：id → state（1 未受领 / 2 遂行中 / 3 达成） */
  observed: Map<number, number>
  /** tab 0/9 确认的受领集合；没有时退回 state === 2 */
  activeIds: number[] | null
  /** 是否拿到过 tab 0 全量。false → 一律 unknown */
  authoritative: boolean
  /**
   * 全量表拿到的时刻与当前时刻。两者都给时，周期任务的 done 会做跨期对齐：
   * 快照属于上一期的话，「不在表里」只说明上期交付过，本期已经重置、
   * 任务已回到表里——判不了本期，如实给 unknown（2026-08-17 用户在战果
   * 自检里抓的实锤：季任/年任被拿历史快照说成本期已完成）。不给则不对齐。
   */
  observedTs?: number | null
  now?: number | null
}

export interface QuestVerdict {
  status: QuestAvailability
  /** locked 时：卡住的前置 code（按库中顺序） */
  missingPre: string[]
  /** 日/周/月/季/年常任务。它的 done 只是「本期已交付」，下期还会回来 */
  cyclic: boolean
}

// 任务库 code 的第二位标周期：Bd1 日 / Bw3 周 / Bm6 月 / Bq2 季 / By1 年。
const CYCLIC_MARKERS = new Set(['d', 'w', 'm', 'q', 'y'])
export const isCyclicQuestCode = (code: string): boolean =>
  CYCLIC_MARKERS.has(`${code ?? ''}`.charAt(1).toLowerCase())

// 周期档位（日<周<月<季<年）。期内严格推理只对「档位 ≥ 本任务」的周期前置下硬结论：
// 它们的当前周期覆盖本任务的整个周期，快照里的在表/不在表说的就是本期的事。
// 更短周期的前置（季任务的月常前置）在本期早些时候可能满足过又重置，快照答不了，
// 维持与旧路径一致的乐观放行。
const PERIOD_RANK: Record<string, number> = { d: 1, w: 2, m: 3, q: 4, y: 5 }
const periodRankOf = (code: string): number | null =>
  PERIOD_RANK[`${code ?? ''}`.charAt(1).toLowerCase()] ?? null

export const buildQuestAvailability = (
  input: QuestAvailabilityInput,
): Map<number, QuestVerdict> => {
  const byCode = new Map<string, QuestChainLike>()
  const all: QuestChainLike[] = []
  for (const entry of input.entries) {
    byCode.set(entry.code, entry)
    all.push(entry)
  }
  const out = new Map<number, QuestVerdict>()
  const verdict = (
    status: QuestAvailability,
    code: string,
    missingPre: string[] = [],
  ): QuestVerdict => ({ status, missingPre, cyclic: isCyclicQuestCode(code) })

  if (!input.authoritative) {
    for (const entry of all) out.set(entry.id, verdict('unknown', entry.code))
    return out
  }
  const active = input.activeIds ? new Set(input.activeIds) : null

  /**
   * 「这条前置满足了没有」。递归：不在表里 且 前置都满足 ⇒ 已交付。
   * 记忆化 + 在途标记：上游资料若意外成环，按未满足处理而不是栈溢出。
   */
  const settled = new Map<string, boolean>()
  const visiting = new Set<string>()
  const preSatisfied = (code: string): boolean => {
    const known = settled.get(code)
    if (known !== undefined) return known
    if (visiting.has(code)) return false
    const entry = byCode.get(code)
    // 库里没有这条前置：无从判断，按「没满足」处理——
    // 宁可说「还不能接」，也别把不知道的说成做完了
    if (!entry) return false
    // 周期任务当前置**不构成阻塞**。它每期都会重来，当期在不在表里只反映本期，
    // 而下游解锁看的是「历史上做过没有」——任何一张当期快照都答不了。
    // 把它算成阻塞的代价实测很重：31 条早就做完的任务被误报成「还不能接」
    // （A56 卡在月常 Bm6、A59 卡在 Bm6、A60 顺着 B53 也卡在同一处）。
    if (isCyclicQuestCode(code)) {
      settled.set(code, true)
      return true
    }
    if (input.observed.has(entry.id)) {
      settled.set(code, false) // 还摆在表里 = 没交付
      return false
    }
    visiting.add(code)
    const done = entry.pre.every((pre) => preSatisfied(pre))
    visiting.delete(code)
    settled.set(code, done)
    return done
  }

  /**
   * 期内严格推理（2026-08-17 体检补上的洞）：问「这条周期任务在它自己的
   * 当前周期里交付过没有」。旧路径把周期前置一律放行，于是「今天一条日常
   * 都没做」时 Bd2~Bd8 全都不在表里、被整串误判成「本期已完成」。
   *
   * 三态：'delivered' 本期已交付 / 'blocked' 本期未交付（还摆在表里，或
   * 被档位 ≥ frame 的前置卡着从未解锁）/ 'maybe' 判不了。
   * 两种 blocked 殊途同归：都意味着下游本期从未解锁过。
   */
  type Strict = 'delivered' | 'blocked' | 'maybe'
  const worse = (left: Strict, right: Strict): Strict =>
    left === 'blocked' || right === 'blocked' ? 'blocked' : left === 'maybe' || right === 'maybe' ? 'maybe' : 'delivered'
  const strictMemo = new Map<string, Strict>()
  const strictVisiting = new Set<string>()
  const strictDelivered = (code: string, frameRank: number): Strict => {
    const key = `${code}:${frameRank}`
    const known = strictMemo.get(key)
    if (known !== undefined) return known
    const entry = byCode.get(code)
    if (!entry) return 'maybe'
    if (input.observed.has(entry.id)) {
      strictMemo.set(key, 'blocked')
      return 'blocked'
    }
    if (strictVisiting.has(code)) return 'maybe'
    strictVisiting.add(code)
    let result: Strict = 'delivered'
    for (const preCode of entry.pre) {
      if (isCyclicQuestCode(preCode)) {
        const rank = periodRankOf(preCode)
        if (rank == null || rank < frameRank) continue
        result = worse(result, strictDelivered(preCode, frameRank))
      } else if (!byCode.has(preCode)) {
        // 库外码判不了，与主循环的 unresolved 口径一致——不能当「卡住」说
        result = worse(result, 'maybe')
      } else if (!preSatisfied(preCode)) {
        // 单次前置未满足（含还摆在表里）⇒ 本任务本期从未解锁
        result = 'blocked'
      }
      if (result === 'blocked') break
    }
    strictVisiting.delete(code)
    strictMemo.set(key, result)
    return result
  }

  for (const entry of all) {
    const state = input.observed.get(entry.id)
    if (state === 3) {
      out.set(entry.id, verdict('claimable', entry.code))
      continue
    }
    if (state != null && (active ? active.has(entry.id) : state === 2)) {
      out.set(entry.id, verdict('active', entry.code))
      continue
    }
    if (state != null) {
      out.set(entry.id, verdict('open', entry.code))
      continue
    }
    const missingPre = entry.pre.filter((pre) => !preSatisfied(pre))
    // 库里不存在的前置码（旧码/下线的限时码）不是「未解锁」，是「判不了」——
    // F48 曾因 pre 写着已改号的 C2 被判成永远未解锁（2026-08-17 对账实锤）
    const blockedPre = missingPre.filter((code) => byCode.has(code))
    const unresolvedPre = missingPre.filter((code) => !byCode.has(code))
    if (blockedPre.length) {
      out.set(entry.id, verdict('locked', entry.code, blockedPre))
      continue
    }
    // 周期任务：先跨期对齐（快照过期判不了本期），期内再做链上严格推理
    if (input.observedTs != null && input.now != null && isCyclicQuestCode(entry.code)) {
      const kind = questPeriodFromCode(entry.code, entry.memo2 ?? '')
      let inPeriod = false
      if (kind) {
        const annualMonth = kind === 'annual' ? questAnnualMonth(entry.memo2 ?? '') : null
        const snapshotPeriod = questPeriodKey(kind, input.observedTs, annualMonth)
        const currentPeriod = questPeriodKey(kind, input.now, annualMonth)
        if (snapshotPeriod !== currentPeriod) {
          out.set(entry.id, verdict('unknown', entry.code))
          continue
        }
        inPeriod = true
      } else {
        // 重置月不明的年任判不了跨期（维持既有的不猜），但所有周期都在
        // 05:00 JST 界重置——快照与现在同一游戏日，就必然还在本期，严格推理照做
        inPeriod =
          questPeriodKey('daily', input.observedTs) === questPeriodKey('daily', input.now)
      }
      const frameRank = periodRankOf(entry.code)
      if (inPeriod && frameRank != null) {
        const blocking: string[] = []
        let uncertain = false
        for (const preCode of entry.pre) {
          if (!isCyclicQuestCode(preCode)) continue
          const rank = periodRankOf(preCode)
          if (rank == null || rank < frameRank) continue
          const strict = strictDelivered(preCode, frameRank)
          if (strict === 'blocked') blocking.push(preCode)
          else if (strict === 'maybe') uncertain = true
        }
        if (blocking.length) {
          out.set(entry.id, verdict('locked', entry.code, blocking))
          continue
        }
        if (uncertain) {
          out.set(entry.id, verdict('unknown', entry.code))
          continue
        }
      }
    }
    if (unresolvedPre.length) {
      out.set(entry.id, verdict('unknown', entry.code))
      continue
    }
    out.set(entry.id, verdict('done', entry.code))
  }
  return out
}

export const QUEST_AVAILABILITY_LABEL: Record<QuestAvailability, string> = {
  claimable: '可领奖',
  active: '进行中',
  open: '可以接',
  done: '已完成',
  locked: '未解锁',
  unknown: '未同步',
}
