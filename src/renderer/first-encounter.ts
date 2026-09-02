// 首见志 · 全域「初」标记。
//
// 记录每艘舰在本地遭遇志里最早的一条掉落（我方获得，锚）与击沉（敌方，剑），
// 供战斗现场、本轮掉落、节点履历与图鉴共用同一份判定，不在各处各算一套。
//
// 诚实边界（这是这个功能最容易骗人的地方）：
// - **确认不了就不标。** 账本里最早的一条 ≠ 你的第一次：记账之前捞到的完全不可知。
//   起初只把这条边界写进 tooltip，但徽章本身仍在断言「首次」，玩家不会先去悬停——
//   于是一艘早就在手的舰被标了「首次获得」。现在改为拿旁证排除：
//   掉落侧看在籍痕迹（该舰改造谱系里任何形态在此之前被见过 → 不作数），
//   击沉侧看遭遇痕迹（逐舰击沉能记录之前就遇到过它 → 那时沉没与否不可知，不作数）。
// - 击沉侧另有一条更晚的起点：sunk_mask 是后加的列，更老的记录只知道打过、
//   不知道谁沉了。那些场次整场跳过，不当作「一艘都没沉」。
// - 排除不掉的那些仍然有记录可看，图鉴里照实写成「本地最早的一条」并说明为什么
//   不敢称首次——不冒充里程碑，也不装作什么都没有。
import { esc, fmtTime, queryFirstEncounters, queryLode, trackMountCleanup } from './kernel'
import { safeEach } from './crash-guard'
import {
  emptyFirstEncounterIndex,
  isFirstEncounterHere,
  isTrustedFirstKill,
} from '../shared/first-encounter'
import { firstOwnedAt, OWNED_BEFORE_LEDGER } from './ship-first-owned'
import { mapCodeOf } from '../shared/map-id'

import type { FirstEncounterIndex, FirstEncounterRecord } from '../shared/mg-types'

let index: FirstEncounterIndex = emptyFirstEncounterIndex()
let loading: Promise<void> | null = null
let fcdRoute: any = null
const listeners: (() => void)[] = []

const placeText = (record: FirstEncounterRecord): string => {
  const letter = fcdRoute?.[mapCodeOf(record.map)]?.route?.[record.cell]?.[1] ?? `${record.cell}`
  return `${mapCodeOf(record.map)} ${letter} 点${record.isBoss ? '（Boss）' : ''}`
}

const dayText = (ts: number) => {
  const date = new Date(ts)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

/** 拉取（或重新拉取）首见索引。战斗结算后调用即可刷新。 */
export const refreshFirstEncounters = (): Promise<void> => {
  loading = (async () => {
    const [next, fcd] = await Promise.all([
      queryFirstEncounters().catch((error) => {
        console.warn('[kanso] 首见志读取失败', error)
        return null
      }),
      fcdRoute ? Promise.resolve(null) : queryLode('poi-fcd-map').catch(() => null),
    ])
    if (fcd?.data) fcdRoute = fcd.data
    if (next) index = next
    safeEach('first-encounter', listeners, (cb) => cb())
  })()
  return loading
}

export const onFirstEncountersChange = (cb: () => void) => {
  listeners.push(cb)
  // 装配作用域内注册的订阅，重试装配时由内核统一退掉（防双注册）
  trackMountCleanup(() => {
    const at = listeners.indexOf(cb)
    if (at >= 0) listeners.splice(at, 1)
  })
}

export const ensureFirstEncounters = (): Promise<void> => loading ?? refreshFirstEncounters()

// 「账本内最早的一条」只有在能排除「记账之前就有过」时，才配叫首次。
// 排不掉就当不知道——宁可不标，也不能对着一艘早就在籍的舰说「首次获得」。
export const firstDropOf = (mstId: number): FirstEncounterRecord | null => {
  const record = (mstId > 0 ? index.drops[mstId] : null) ?? null
  if (!record) return null
  // 判据用铃一直在维护的那份基线：按谱系、只增不减（拆解也不丢）、
  // 首次运行时把当时持有的全部记成「记账之前就有」。
  // 之前我另查 ship_life_state.first_seen，捞到就拆的舰在那边没有痕迹，会误判成首次。
  const owned = firstOwnedAt(mstId)
  if (owned == null) return record // 从没见过它在手——没有反证
  if (owned === OWNED_BEFORE_LEDGER) return null // 记账之前就有，真正的第一次无从得知
  return owned >= record.ts ? record : null
}

export const firstKillOf = (mstId: number): FirstEncounterRecord | null => {
  const record = (mstId > 0 ? index.kills[mstId] : null) ?? null
  if (!record) return null
  return isTrustedFirstKill(index, record) ? record : null
}

/**
 * 本机遭遇志里**最早遇到这艘深海舰**的时刻；没遇到过是 null。
 *
 * ⚠️ 这是「账本里最早的一条」，**不是**「你的第一次」——记账之前的完全不可知
 *（同这个文件开头那条边界）。所以消费端的措辞一律写「最早一条」，
 * 别写成「首次」：徽章式的断言正是这个模块当初被纠正过的那种错。
 */
export const metSinceOf = (mstId: number): number | null =>
  mstId > 0 ? (index.metSince[mstId] ?? null) : null

/** 账本里最早的那一条，不论可信与否。图鉴据此说明「更早的不可知」。 */
const earliestDropRecord = (mstId: number): FirstEncounterRecord | null =>
  (mstId > 0 ? index.drops[mstId] : null) ?? null
const earliestKillRecord = (mstId: number): FirstEncounterRecord | null =>
  (mstId > 0 ? index.kills[mstId] : null) ?? null

// 出击现场没有逐条时间戳，改用「地点 + 本轮起始时刻」界定，判据在 shared 层。
export const isFirstDropInSortie = (
  mstId: number,
  map: number,
  cell: number,
  sortieStartTs: number,
): boolean => isFirstEncounterHere(firstDropOf(mstId), map, cell, sortieStartTs)

export const isFirstKillInSortie = (
  mstId: number,
  map: number,
  cell: number,
  sortieStartTs: number,
): boolean => isFirstEncounterHere(firstKillOf(mstId), map, cell, sortieStartTs)

const badgeHtml = (
  kind: 'drop' | 'kill',
  record: FirstEncounterRecord,
  compact: boolean,
): string => {
  // 只有排除了「记账之前就有过」才会走到这里，所以这里说的是确认过的第一次。
  const title = `${kind === 'drop' ? '首次获得' : '首次击沉'} · ${placeText(record)} · ${dayText(record.ts)} ${fmtTime(record.ts)}`
  return `<span class="first-mark ${kind}${compact ? ' compact' : ''}" title="${esc(title)}" aria-label="${esc(title)}">${
    kind === 'drop' ? '⚓' : '⚔'
  }${compact ? '' : '<i>初</i>'}</span>`
}

/** 我方首次获得（锚）。ts 已知时逐条精确判定。 */
export const firstDropBadgeHtml = (mstId: number, ts: number, compact = false): string => {
  const record = firstDropOf(mstId)
  return record && record.ts === ts ? badgeHtml('drop', record, compact) : ''
}

/** 敌方首次击沉（剑）。 */
export const firstKillBadgeHtml = (mstId: number, ts: number, compact = false): string => {
  const record = firstKillOf(mstId)
  return record && record.ts === ts ? badgeHtml('kill', record, compact) : ''
}

/** 出击现场用：地点 + 本轮起始时刻界定，不需要逐条时间戳。 */
export const firstDropBadgeInSortieHtml = (
  mstId: number,
  map: number,
  cell: number,
  sortieStartTs: number,
  compact = false,
): string => {
  const record = firstDropOf(mstId)
  return isFirstDropInSortie(mstId, map, cell, sortieStartTs)
    ? badgeHtml('drop', record!, compact)
    : ''
}

export const firstKillBadgeInSortieHtml = (
  mstId: number,
  map: number,
  cell: number,
  sortieStartTs: number,
  compact = false,
): string => {
  const record = firstKillOf(mstId)
  return isFirstKillInSortie(mstId, map, cell, sortieStartTs)
    ? badgeHtml('kill', record!, compact)
    : ''
}

/** 图鉴详情用的一行说明：不是徽章，而是「你在哪、什么时候第一次遇上它」。 */
export const firstEncounterLineHtml = (kind: 'drop' | 'kill', mstId: number): string => {
  const trusted = kind === 'drop' ? firstDropOf(mstId) : firstKillOf(mstId)
  if (trusted) {
    return `<span class="first-line ${kind}">${kind === 'drop' ? '⚓' : '⚔'} ${
      kind === 'drop' ? '首次获得' : '首次击沉'
    } <b>${esc(placeText(trusted))}</b> · ${esc(dayText(trusted.ts))} ${esc(fmtTime(trusted.ts))}</span>`
  }
  // 有记录但不敢称首次：记账之前就有它/遇到过它。照实说清楚这条是「最早的一条」
  // 而不是「第一次」，别让它冒充里程碑，也别装作什么都没有。
  const earliest = kind === 'drop' ? earliestDropRecord(mstId) : earliestKillRecord(mstId)
  if (earliest) {
    return `<span class="first-line none">最早记录：<b>${esc(placeText(earliest))}</b> · ${esc(dayText(earliest.ts))} · 更早记录缺失</span>`
  }
  return `<span class="first-line none">${kind === 'drop' ? '遭遇志暂无该舰掉落记录' : '暂无击沉记录'}</span>`
}
