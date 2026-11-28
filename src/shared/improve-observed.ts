// 改修日程的游戏实测（维护者 2026-11-28 定：「让 kuma 从游戏里面学并直接折叠掉实测出来无法改修的」）。
//
// 资料站（舰百、akashi-list、wikiwiki）跟官方调整总慢一步：11-28 他自己实测周六村雨改二、夕云改二、日向改二当二号舰
// 都改不了 22 号对水上电探，资料却都说能。而游戏自己会下发答案——打开明石改修画面时的 remodel_slotlist
// 就是「旗舰明石 + 这艘二号舰，今天能改的全部」（他截图里村雨改二周六给的三件，恰好是资料那三件换掉一件）。
// 这里把这份清单倒过来用：资料说能、清单里没有 → 实测不可；清单里有、资料没写 → 实测可。
// 纯逻辑、无 DOM。记录在 main/mg/ledger（improve_observations），显示在鉴的「今日改修」与装备详情。

import { jstDayOfWeek } from './jst-day'

/** 游戏清单里每件给的消耗（燃弹钢铝、开发资材、改修资材）：资料没收录的装备就照它出一行 */
export interface ImproveListCost {
  id: number
  fuel: number
  bull: number
  steel: number
  baux: number
  devmats: number
  screws: number
}

/** 一次游戏下发的改修清单：当时第一舰队的旗舰与二号舰（舰船 mst id）、日本时间星期、清单里的装备 */
export interface ImproveObservation {
  ts: number
  /** 日本时间星期（0＝周日），改修日程按日本时间零点换日 */
  day: number
  flagship: number | null
  helper: number | null
  items: readonly number[]
  /** 清单里每件的消耗（2026-11-28 起记；更早的记录没有） */
  detail?: readonly ImproveListCost[]
}

/** 一条结论：这件装备、这艘二号舰、这个星期，游戏里能不能改 */
export interface ImproveFact {
  eq: number
  helper: number
  day: number
  ok: boolean
  ts: number
  source: 'game' | 'maintainer'
  /** 维护者实测写定的日期（YYYY-MM-DD）；游戏实测按记录时间显示 */
  date?: string
  /** 游戏清单里这件的消耗（实测可、且那次记了消耗时才有） */
  cost?: ImproveListCost
  note?: string
}

/** 改修事实表（随包 equip-improve）的形状：只用到装备号与各方案的二号舰日程 */
export interface ImproveTableEntry {
  eq_id: number
  improvement?: readonly { helpers?: readonly { ship_ids?: readonly number[]; days?: readonly number[] }[] }[]
}

/** 明石 / 明石改：旗舰是她，清单才是「这艘二号舰能改的全部」 */
export const AKASHI_SHIP_IDS: readonly number[] = [182, 187]

export const improveFactKey = (eq: number, helper: number, day: number): string => `${eq}|${helper}|${day}`

export const improveObservationDay = (ts: number): number => jstDayOfWeek(ts)

/**
 * 维护者实测（随包，没在自己游戏里打开过改修画面的玩家也看得到）。游戏里记到的、更新的实测优先于这里。
 * 写法：哪件装备、哪几艘二号舰、星期几、能不能、哪天测的。
 */
export const MAINTAINER_IMPROVE_FACTS: readonly {
  eq: number
  helpers: readonly number[]
  day: number
  ok: boolean
  date: string
  note: string
}[] = [
  {
    eq: 28,
    helpers: [498, 542, 554],
    day: 6,
    ok: false,
    date: '2026-11-28',
    note: '维护者实测：周六村雨改二、夕云改二、日向改二当二号舰，游戏的改修清单里没有 22 号对水上电探（舰百、akashi-list 仍写能）',
  },
  {
    eq: 13,
    helpers: [498],
    day: 6,
    ok: true,
    date: '2026-11-28',
    note: '维护者实测：村雨改二周六的清单是 12.7cm连装砲C型改二、25mm三連装機銃、61cm四連装魚雷',
  },
]

const tableSays = (entry: ImproveTableEntry, helper: number, day: number): boolean =>
  (entry.improvement ?? []).some((imp) =>
    (imp.helpers ?? []).some((h) => (h.ship_ids ?? []).map(Number).includes(helper) && (h.days ?? []).map(Number).includes(day)),
  )

/**
 * 把实测整理成结论：维护者实测垫底；每个「二号舰 × 星期」取最近一次明石当旗舰的游戏清单，
 * 比维护者那条新的才盖过去。清单里有的记「能」，资料说能而清单里没有的记「不能」。
 */
export const improveFactsOf = (
  observations: readonly ImproveObservation[],
  table: readonly ImproveTableEntry[],
  maintainer = MAINTAINER_IMPROVE_FACTS,
): Map<string, ImproveFact> => {
  const facts = new Map<string, ImproveFact>()
  for (const m of maintainer) {
    const ts = Date.parse(`${m.date}T00:00:00+09:00`)
    for (const helper of m.helpers) {
      facts.set(improveFactKey(m.eq, helper, m.day), { eq: m.eq, helper, day: m.day, ok: m.ok, ts, source: 'maintainer', date: m.date, note: m.note })
    }
  }
  const latest = new Map<string, ImproveObservation>()
  for (const o of observations) {
    if (!o.helper || o.flagship == null || !AKASHI_SHIP_IDS.includes(o.flagship)) continue
    const key = `${o.helper}|${o.day}`
    const prev = latest.get(key)
    if (!prev || prev.ts < o.ts) latest.set(key, o)
  }
  const put = (fact: ImproveFact) => {
    const key = improveFactKey(fact.eq, fact.helper, fact.day)
    const prev = facts.get(key)
    if (!prev || prev.ts <= fact.ts) facts.set(key, fact)
  }
  for (const o of latest.values()) {
    const helper = o.helper as number
    const listed = new Set(o.items.map(Number))
    const costs = new Map((o.detail ?? []).map((cost) => [Number(cost.id), cost]))
    for (const eq of listed) put({ eq, helper, day: o.day, ok: true, ts: o.ts, source: 'game', cost: costs.get(eq) })
    for (const entry of table) {
      if (!listed.has(entry.eq_id) && tableSays(entry, helper, o.day)) put({ eq: entry.eq_id, helper, day: o.day, ok: false, ts: o.ts, source: 'game' })
    }
  }
  return facts
}

/**
 * 一件装备某天的二号舰名单按实测修正：资料里写了、实测不可的去掉；实测可、资料没写的补上。
 * tableHelpers 是资料那天的名单（已去掉「不限二号舰」的 -1）。
 */
export const applyImproveFacts = (
  eq: number,
  day: number,
  tableHelpers: readonly number[],
  facts: ReadonlyMap<string, ImproveFact>,
): { helpers: number[]; removed: ImproveFact[]; added: ImproveFact[] } => {
  const removed: ImproveFact[] = []
  const helpers: number[] = []
  for (const helper of tableHelpers) {
    const fact = facts.get(improveFactKey(eq, helper, day))
    if (fact && !fact.ok) removed.push(fact)
    else helpers.push(helper)
  }
  const added: ImproveFact[] = []
  for (const fact of facts.values()) {
    if (fact.eq === eq && fact.day === day && fact.ok && !tableHelpers.includes(fact.helper)) {
      added.push(fact)
      helpers.push(fact.helper)
    }
  }
  return { helpers, removed, added }
}
