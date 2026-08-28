// 资源账本曲线的取数口径。锱（资源统计面板）与独立资源趋势窗各自画同一批曲线，
// 原先这三段是逐行复制的两份——改一处忘另一处，两个界面对同一段时间给不同答案。
//
// 全是纯函数：mg 的哪几个字段进来由调用方写明（renderer 打成一个 iife，
// 只有 shared 是逐文件产物、守卫才能真跑起来测）。
import { localDayStart } from './local-calendar'
import type { EventArea, MaterialRow } from './mg-types'

/** 一行资源快照有几项（燃弹钢铝 + 建桶开螺），与 mg.materials 同序同长。 */
export const MATERIAL_KINDS = 8

export interface PreparedMaterialHistory {
  rows: MaterialRow[]
  /** 窗口起点之前就有记录 = 起始余额是实测的，净变化可信 */
  hasBaseline: boolean
  /** 实际观测到的起点；没有基线时是第一条记录的时刻 */
  observedStart: number | null
}

/**
 * 把账本原始行裁到 [startTs, endTs] 并补齐两端。
 *
 * - 越过 endTs 的行直接丢；
 * - 窗口前的那条把时刻挪到 startTs（曲线是阶梯状的，它就是起始余额）；
 * - 同一时刻只留最后一条（挪时刻可能撞上原有的 startTs 行）；
 * - material_log 只在余额**变化**时写入。若回港快照比最后一次变化更新，
 *   把最后已知余额水平延伸到该快照时刻；离线期间不冒充「已观测到现在」。
 *
 * @param lastPortTs 最近一次回港快照的时刻（mg.lastPortTs），没有就传 0
 */
export const prepareMaterialHistory = (
  rows: MaterialRow[],
  startTs: number,
  endTs: number,
  lastPortTs: number,
): PreparedMaterialHistory => {
  const withinEnd = rows.filter((row) => row.ts <= endTs)
  if (!withinEnd.length) return { rows: [], hasBaseline: false, observedStart: null }
  const hasBaseline = withinEnd[0].ts <= startTs
  const observedStart = hasBaseline ? startTs : withinEnd[0].ts
  const prepared: MaterialRow[] = []
  for (const [index, row] of withinEnd.entries()) {
    const next = index === 0 && row.ts < startTs ? { ...row, ts: startTs } : row
    if (prepared.at(-1)?.ts === next.ts) prepared[prepared.length - 1] = next
    else prepared.push(next)
  }
  const last = prepared.at(-1)!
  const knownThrough = Math.min(endTs, Math.max(last.ts, lastPortTs))
  if (knownThrough > last.ts) prepared.push({ ts: knownThrough, values: [...last.values] })
  return { rows: prepared, hasBaseline, observedStart }
}

/** 一个本地自然日的净变化（史的「每日资源」逐日格与曲线）。 */
export interface DailyMaterial {
  start: number
  end: number
  values: number[]
  /** 当日**日初**有实测基线；没有基线的那天只能标「—」，不能画成 0 */
  complete: boolean
}

/**
 * 把资源快照折成逐日净变化：每天 = 当日最后一条快照 − 日初那条。
 *
 * 原先长在史（renderer/modules/shi.ts）里。挪到 shared 是因为主进程后来把
 * 「每日取当日最后一条」下沉到了 SQL（ledger.queryDailyMaterials），
 * 而那条下沉唯一的正确性依据就是「聚合行喂进这里 === 全量行喂进这里」——
 * 这个断言要能真跑起来，这个函数就必须是逐文件产物（渲染层打成一个 iife，测不到）。
 * 护栏在 test/material-daily.test.mjs。
 *
 * @param rows  资源快照行，可以是全量行，也可以是逐日聚合行（两者结果必须一致）
 * @param start 区间第一天的本地 00:00
 * @param now   「现在」；最后一格截到这一刻
 * @param current 此刻的实际持有（mg.materials），比最后一条快照新时补一格；没有就传 null
 */
export const buildDailyMaterials = (
  rows: MaterialRow[],
  start: number,
  now: number,
  current: number[] | null,
): DailyMaterial[] => {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts)
  if (current) {
    const latest = sorted.at(-1)
    if (!latest || latest.values.some((value, index) => value !== (current[index] ?? 0))) {
      sorted.push({ ts: now, values: [...current] })
    }
  }
  let cursor = 0
  let latest: MaterialRow | null = null
  while (cursor < sorted.length && sorted[cursor].ts <= start) {
    latest = sorted[cursor]
    cursor += 1
  }
  const result: DailyMaterial[] = []
  const lastDay = localDayStart(now)
  // 逐日推进按日历日走（setDate +1），不按固定 24h：夏令时切换的那一天
  // 只有 23 或 25 小时，固定步进会让之后每一天的分界都错位，
  // 最后一格还对不上 localDayStart(now)，今日那一列就会整个丢掉。
  const dayCursor = new Date(start)
  while (dayCursor.getTime() <= lastDay) {
    const day = dayCursor.getTime()
    dayCursor.setDate(dayCursor.getDate() + 1)
    const end = Math.min(dayCursor.getTime() - 1, now)
    const base = latest
    while (cursor < sorted.length && sorted[cursor].ts <= end) {
      latest = sorted[cursor]
      cursor += 1
    }
    result.push({
      start: day,
      end,
      values:
        base && latest
          ? Array.from({ length: MATERIAL_KINDS }, (_unused, index) =>
              (latest!.values[index] ?? 0) - (base.values[index] ?? 0),
            )
          : Array.from({ length: MATERIAL_KINDS }, () => 0),
      complete: Boolean(base && latest),
    })
  }
  return result
}

/**
 * 当前进行中的活动区（最近开的那个）。已关闭的不算；一个都没有就是 null。
 * 锱的「活动就绪度」与趋势窗的活动统计带用的是同一个判据。
 */
export const activeEventAreaOf = (
  eventAreas: Record<number, EventArea>,
): [number, EventArea] | null =>
  Object.entries(eventAreas)
    .map(([id, period]) => [+id, period] as [number, EventArea])
    .filter(([, period]) => !period.closed)
    .sort((left, right) => right[1].firstSeenTs - left[1].firstSeenTs)[0] ?? null

/**
 * 自然回复上限：提督 Lv × 250 + 750（只对燃/弹/钢/铝四项）。
 * 低于它的资源会自动回复，高于则不会——磁贴的「回复中」与曲线的回复线同一条数。
 * 等级未知（还没同步到 basic）时返回 null：不知道就不说。
 */
export const naturalRegenCap = (admiralLevel: number | null | undefined): number | null =>
  typeof admiralLevel === 'number' ? admiralLevel * 250 + 750 : null
