// 活动「陆航特効」（C 组）的施加口径。
//
// 倍率本身住在 `event-bonus` 包（`by: 'lbas'`，key 是组代号如 C2，scope 是点位）；
// 「哪架飞机属于哪个 C 组」住在第一方事实表 `event-plane-groups`。
// 这一层把两者对上，答一个问题：**这一队四架飞机，整队吃多少倍？**
//
// ── 三条口径，都是两家原文一致的 ────────────────────────────────
//
// ① **整队倍率，不是单格倍率。** kcwiki 原话「陆航倍卡对所在队伍中的 4 架飞机全部生效」；
//    wikiwiki 的計算例同样把它算成一个作用于整队的系数
//    （「基地にSM.79 bis(熟練)+B-25 の場合(C2+C3)：1.06 × 1.03 ≒ 1.09」）。
//    所以队里塞一架 C2 机，**另外三架的伤害也一起涨**——这正是它值得占一格的原因，
//    也是推荐搭配从「取前四强」变成「组合择优」的全部理由。
//
// ② **同组不重复，异组叠乘。** 队里两架都是 C2 也只乘一次；C2 与 C3 各一架才是 1.06×1.03。
//    实现上按**组代号去重**后再连乘——这一条写反（按机体连乘）会让双 C2 队凭空多一倍。
//
// ③ **只认 C 组。** 同一件装备可能同属 A/B/C 多组，但 A/B 是它装在舰娘身上时的事，
//    放进基地就只看 C 组。本层只从事实表读 C 组，不碰 A/B。
//
// ── 一条**不在**这里建模的 ──────────────────────────────────────
// 「搭载数归零则该件特効失效」。推荐搭配规划的是满编出击前的配置，四格都是满的；
// 打到一半掉光了是战斗中的事，不属于「该配什么」这个问题。

import { scopeApplies } from './event-bonus-apply'
import type { EventBonusEntry } from './event-bonus-apply'

/** 事实表里一件装备的 C 组归属 */
export interface PlaneGroupTable {
  /** 组代号 → 成员 mstId */
  groups: Readonly<Record<string, readonly number[]>>
  /** 这张表属于哪一期（与 event-bonus 的 page= 对不上就不该生效） */
  event: string
  basis: string
}

/** 当前点位生效的陆航特効 */
export interface LbasBonusContext {
  /** 组代号 → 该点的整队倍率 */
  rates: ReadonlyMap<string, number>
  /** mstId → 它属于的组代号（本期只可能属于一个 C 组，但按集合存，别把结构写死） */
  groupsOf: ReadonlyMap<number, readonly string[]>
  /** 参与的条目原文，供 UI 说明「凭什么是这个数」 */
  entries: readonly EventBonusEntry[]
  /** 出处标注（lodeCredit 的产物），挂悬停 */
  credit: string | null
}

/**
 * 组装当前点位的陆航特効上下文。
 *
 * **返回 null = 这一点没有陆航特効**，消费端据此走纯二期逻辑。三种情况都返回 null：
 * 常规海域（`entries` 为空）、活动图但该点没有 lbas 条目（本期 E1–E3 全图如此）、
 * 事实表期号对不上（换期了，不拿上一期的名单套这一期）。
 */
export const lbasBonusContext = (
  entries: readonly EventBonusEntry[] | null | undefined,
  nodeLetter: string | null,
  table: PlaneGroupTable | null | undefined,
  packPage: string | null,
  credit: string | null = null,
): LbasBonusContext | null => {
  if (!entries?.length || !table) return null
  // 换期后整表不生效——与国籍例外台账同一条纪律
  if (!table.event || !packPage || table.event !== packPage) return null

  const rates = new Map<string, number>()
  const applied: EventBonusEntry[] = []
  for (const entry of entries) {
    if (entry.by !== 'lbas') continue
    if (!scopeApplies(entry.scope, nodeLetter)) continue
    // 同一组在同一点若出现多条（全图 + 点位），按原文「各项补正叠乘」连乘。
    // 同一 scope 下的同组重复才是「同组不重复」要挡的，那一层在 dedupe 里。
    const dedupe = `${entry.scope}|${entry.key}`
    if (applied.some((seen) => `${seen.scope}|${seen.key}` === dedupe)) continue
    rates.set(entry.key, (rates.get(entry.key) ?? 1) * entry.value)
    applied.push(entry)
  }
  if (!rates.size) return null

  const groupsOf = new Map<number, string[]>()
  for (const [group, members] of Object.entries(table.groups)) {
    // 这一点没给这个组倍率就不必登记（C1 本期全程如此）
    if (!rates.has(group)) continue
    for (const mstId of members) {
      const list = groupsOf.get(mstId)
      if (list) list.push(group)
      else groupsOf.set(mstId, [group])
    }
  }
  if (!groupsOf.size) return null

  return { rates, groupsOf, entries: applied, credit }
}

/** 这一件装备在本点吃到的组（可能不止一个组，也可能一个都没有） */
export const planeGroupsOf = (
  context: LbasBonusContext | null,
  mstId: number,
): readonly string[] => context?.groupsOf.get(mstId) ?? []

/**
 * 一队四架飞机的**整队**特効倍率。
 *
 * 先把队里所有飞机吃到的组并成一个集合（**同组自动去重**），再把各组倍率连乘。
 * 队里一架特効机都没有就是 1。
 */
export const squadBonusMultiplier = (
  context: LbasBonusContext | null,
  mstIds: readonly number[],
): number => {
  if (!context) return 1
  const groups = new Set<string>()
  for (const mstId of mstIds) {
    for (const group of context.groupsOf.get(mstId) ?? []) groups.add(group)
  }
  let multiplier = 1
  for (const group of groups) multiplier *= context.rates.get(group) ?? 1
  return multiplier
}

/** 队里真正贡献了特効的组，按代号排序——给显示层写「凭什么是这个数」 */
export const squadBonusGroups = (
  context: LbasBonusContext | null,
  mstIds: readonly number[],
): { group: string; rate: number }[] => {
  if (!context) return []
  const groups = new Set<string>()
  for (const mstId of mstIds) {
    for (const group of context.groupsOf.get(mstId) ?? []) groups.add(group)
  }
  return [...groups]
    .sort()
    .map((group) => ({ group, rate: context.rates.get(group) ?? 1 }))
}
