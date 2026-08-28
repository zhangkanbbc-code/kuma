// 矿脉健康度。
//
// 存在的理由：面板里显示「待补」时，分不清是**包没装**还是**这一层没人维护**。
// 前者补一次抓取就好，后者只能等上游。把这两件事分开说，才不会白折腾。
//
// 消费方是钥的「矿脉健康度」卡，而那张卡 2026-08-24 起只在 `KANSO_DEBUG_UI=1`
// 下装配——缺包/停更/新鲜度归维护者管，玩家侧的信号在各栏目就地的占位上。
//
// 这里只做统计，不下「该不该更新」的判断——新鲜度阈值是提示，不是命令。
import { EVENT_DIFFICULTIES, enemyCompIds } from './map-intel'

import type { ConfirmedEnemyComp, EventDifficulty, MapIntelCatalog } from './map-intel'

export interface LodeMetaLike {
  id: string
  name?: string
  source?: string
  fetchedAt?: string
  upstreamUpdatedAt?: string | null
}

export interface LodePackHealth {
  id: string
  present: boolean
  name: string | null
  source: string | null
  fetchedAt: string | null
  /** 距今天数；日期读不出来时为 null（不当成 0，那是把未知报成「刚更新」） */
  ageDays: number | null
  /** 上游自己最后一次动的日子；很多源不给，那就是 null */
  upstreamUpdatedAt: string | null
  /** 上游年龄；同上，读不出来是 null 而不是 0 */
  upstreamAgeDays: number | null
  /** 查证过的停更日（见 DISCONTINUED_UPSTREAM）；没查证过是 null */
  discontinuedAt: string | null
}

/** 超过这个天数在界面上挂个提示。只是提示——很多包本来就几个月才动一次。 */
export const STALE_DAYS = 90

/**
 * 上游超过这个天数没动就当「停滞」点名。
 * 比 STALE_DAYS（我们自己下载的年龄）宽得多：很多源半年才动一次是常态，
 * 一年不动才值得说一句。
 */
export const UPSTREAM_STALE_DAYS = 365

/**
 * 上游已经不再更新的包——维护者台账。
 *
 * 能从 `meta.upstreamUpdatedAt` 算出年龄的包不必记在这里；这张表只收
 * **上游根本不给更新时间**、但已经查证停更的那几个，值是上游最后一次动的日子。
 *
 * 为什么台账在这一层：新鲜度与停更归维护者管，模块常驻 UI 不向玩家复述
 * （2026-08-21 拍板）。这类话只在钥的矿脉健康度里说一次。
 */
export const DISCONTINUED_UPSTREAM: Readonly<Record<string, string>> = {
  // 现在**是空的**，这不是忘了填。
  //
  // 唯一一条曾经在这里的是 EO 的 `fit-bonus`（停在 2025-03-01）。2026-08-22 起
  // 装备加成的运行时底表换成了第一方的 `kcwiki-fit-bonus`（上游 2026-08 仍在更新，
  // 且它自己给 `meta.upstreamUpdatedAt`，年龄算得出来，用不着台账），
  // EO 那份降为维护者侧对账票、不在 `CONSUMED_LODES` 里——健康度不该再替它说话。
  //
  // 机制留着：下一个「上游不给更新时间、但已查证停更」的包照样往这里加一行。
}

export const lodePackHealth = (
  expectedIds: readonly string[],
  metas: readonly LodeMetaLike[],
  now: number,
): LodePackHealth[] => {
  const byId = new Map(metas.map((meta) => [meta.id, meta]))
  const daysSince = (text: string | null | undefined): number | null => {
    const stamp = text ? Date.parse(text) : NaN
    return Number.isFinite(stamp) ? Math.max(0, Math.floor((now - stamp) / 86400000)) : null
  }
  return [...expectedIds].sort().map((id) => {
    const meta = byId.get(id)
    if (!meta) {
      return {
        id,
        present: false,
        name: null,
        source: null,
        fetchedAt: null,
        ageDays: null,
        upstreamUpdatedAt: null,
        upstreamAgeDays: null,
        discontinuedAt: null,
      }
    }
    return {
      id,
      present: true,
      name: meta.name ?? null,
      source: meta.source ?? null,
      fetchedAt: meta.fetchedAt ?? null,
      ageDays: daysSince(meta.fetchedAt),
      upstreamUpdatedAt: meta.upstreamUpdatedAt ?? null,
      upstreamAgeDays: daysSince(meta.upstreamUpdatedAt),
      discontinuedAt: DISCONTINUED_UPSTREAM[id] ?? null,
    }
  })
}

export interface MapIntelLayerHealth {
  map: string
  /** 有这一层、且层里有节点 */
  covered: EventDifficulty[]
  /** 有这一层、但一个节点都没有 —— 上游那一页就是空的，不是包坏了 */
  empty: EventDifficulty[]
  /** 连这一层都没有 */
  absent: EventDifficulty[]
}

export interface MapIntelHealth {
  maps: number
  /** 有节点的常规海域数 */
  normalCovered: number
  normalTotal: number
  layers: MapIntelLayerHealth[]
  comps: { total: number; pinned: number }
}

/**
 * 海域情报的覆盖情况。
 *
 * 「有这一层但零节点」要单独算一档：那是上游页面本身没有该难度的编成表，
 * 和「包里没这一层」是两回事，用户能做的事也不同。
 *
 * ⚠ 传进来的必须是 **`mapIntelCatalog()` 的装配结果**，不是某一个包的原文。
 * 底座 `map-intel` 永不随包，拿它当判据会在玩家那份产物上报出「常规海域 0/0」——
 * 而三层汇编其实都在。2026-08-22 发布前验收抓到过这一条。
 */
export const mapIntelHealth = (catalog: MapIntelCatalog | null | undefined): MapIntelHealth => {
  const maps = catalog?.maps ?? {}
  const layers: MapIntelLayerHealth[] = []
  let normalCovered = 0
  let normalTotal = 0
  let total = 0
  let pinned = 0

  const countComps = (nodes: Record<string, { enemyComps?: ConfirmedEnemyComp[] }> | undefined) => {
    for (const node of Object.values(nodes ?? {})) {
      for (const comp of node.enemyComps ?? []) {
        total += 1
        // 「定没定下来号」的判据只有一份：`enemyCompIds`。这里从前单看 `shipIds`，
        // 那是旧定号流水线的产物；换源之后汇编包的 `ships` 本身就是号，
        // 只看 shipIds 会把 1312 套全有号的编成报成「全部未定号」。
        if (enemyCompIds(comp)) pinned += 1
      }
    }
  }

  for (const [map, entry] of Object.entries(maps)) {
    const difficulties = entry.difficulties
    if (difficulties) {
      const covered: EventDifficulty[] = []
      const empty: EventDifficulty[] = []
      const absent: EventDifficulty[] = []
      for (const difficulty of EVENT_DIFFICULTIES) {
        const layer = difficulties[difficulty]
        if (!layer) absent.push(difficulty)
        else if (Object.keys(layer.nodes ?? {}).length) covered.push(difficulty)
        else empty.push(difficulty)
        if (layer) countComps(layer.nodes as never)
      }
      layers.push({ map, covered, empty, absent })
    } else {
      normalTotal += 1
      if (Object.keys(entry.nodes ?? {}).length) normalCovered += 1
    }
    countComps(entry.nodes as never)
  }

  return {
    maps: Object.keys(maps).length,
    normalCovered,
    normalTotal,
    layers: layers.sort((a, b) => a.map.localeCompare(b.map, 'en', { numeric: true })),
    comps: { total, pinned },
  }
}
