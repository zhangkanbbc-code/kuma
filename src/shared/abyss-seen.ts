// 深海遭遇的「你在哪些图、哪些点位见过它」——归并口径的单一出处。
//
// 账本那边（`main/mg/ledger.ts` 的 abyssSeenMaps）与增量维护的 foldAbyssCaches
// 共用这一份。归并规则各写一份必然漂移，而漂移的表现是「全量重扫与增量并入
// 数出来的次数不一样」——两条路平时不会同时跑，对不上也没人看得出来。
//
// ---- 2026-08-25 从图级细化到 (图, 点位) ----
// `cell` 从建表第一天起就在 encounters 里，只是 abyssSeenMaps 的 SQL 从没 SELECT 过，
// 于是深海舰页的「我的遭遇」只能说「7-4 ×5 场」，说不出是在哪个点碰上的。
//
// ---- 点位哨兵 0 ----
// 建表时 `cell` 是 NOT NULL，理论上不会缺。但**读不出来也不许把整条遭遇丢掉**：
// 「不知道在哪个点」不等于「没遇到过」。所以这类行归到哨兵 0，仍旧计进图级合计 `n`，
// 只是不进逐点清单（那一格没有能显示的东西）。这也是 `n` 与 cells 各次数之和
// **可以不相等**的唯一原因，消费端别拿它们互相校验。

export interface AbyssSeenCell {
  /** 罗盘 `api_no`（边号）。永远 > 0——哨兵不会出现在这里 */
  cell: number
  n: number
}

export interface AbyssSeenMap {
  map: number
  /** 图级合计，**含**点位读不出来的那些行 */
  n: number
  /** 逐点位，次数多的在前；同次数按边号升序，免得每次刷新顺序都在跳 */
  cells: AbyssSeenCell[]
}

export interface AbyssSeenEntry {
  mstId: number
  maps: AbyssSeenMap[]
}

/** 舰 → 图 → 点位 → 次数 */
export type AbyssSeenCache = Map<number, Map<number, Map<number, number>>>

/** 点位键。整数且 > 0 才认，其余一律归哨兵 0（理由见文件头）。 */
export const abyssSeenSpotKey = (cell: unknown): number => {
  const value = Number(cell)
  return Number.isInteger(value) && value > 0 ? value : 0
}

/**
 * 把一条遭遇并进索引。全量重扫与结算后的增量并入走的都是这一个函数。
 *
 * @param comp 敌编成 mstId 数组。同一条里重复出现的同型舰只算一次
 *             （一场遭遇就是一场，不按出场数放大）。
 */
export const foldAbyssSeen = (
  cache: AbyssSeenCache,
  comp: readonly number[],
  map: number,
  cell: unknown,
): void => {
  const spot = abyssSeenSpotKey(cell)
  for (const id of new Set(comp.filter((x) => x > 0))) {
    const perMap = cache.get(id) ?? new Map<number, Map<number, number>>()
    const perCell = perMap.get(map) ?? new Map<number, number>()
    perCell.set(spot, (perCell.get(spot) ?? 0) + 1)
    perMap.set(map, perCell)
    cache.set(id, perMap)
  }
}

/** 索引 → IPC 的返回形状。图按遭遇次数降序。 */
export const abyssSeenEntriesOf = (cache: AbyssSeenCache): AbyssSeenEntry[] =>
  [...cache].map(([mstId, perMap]) => ({
    mstId,
    maps: [...perMap]
      .map(([map, perCell]) => {
        let n = 0
        for (const count of perCell.values()) n += count
        return {
          map,
          n,
          cells: [...perCell]
            .filter(([cell]) => cell > 0)
            .map(([cell, count]) => ({ cell, n: count }))
            .sort((a, b) => b.n - a.n || a.cell - b.cell),
        }
      })
      .sort((a, b) => b.n - a.n),
  }))
