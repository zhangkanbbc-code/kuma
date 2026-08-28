// 「本机确认掉落」——把永久表 `encounters` 聚合成第一方的一手掉落证据。
//
// 为什么单独一层、而且**不与离线目录合并**（2026-08-22 用户拍板的口径）：
// 离线目录说的是「社区确认这里掉这条船」，账本说的是「我自己在这儿捞到过」。
// 后者比前者硬，但覆盖面只有玩家自己去过的图；合并会让第一方观测冒充社区确认，
// 也会让「目录没收但我捞到过」这条最有价值的线索被抹平。所以两段并列显示。
//
// 这一层是**纯函数**（没有 SQL、没有 IPC）：取数在 ledger，展示在 di/ji，
// 中间这段口径逻辑要能单独测——「S 胜却没掉」这种判断写反了不会报错，只会静静地说错话。
//
// ⚠ 点位口径：`cell` 是罗盘 `api_no`（边号），不是 wiki 的点位字母。
// 要变字母得再过一层 poi-fcd 的推导，那一层归展示侧（di/ji 都已经在做）。
// 这里只按 cell 归组，不猜字母。

import type { LocalDropScope, LocalDropShip } from '../../shared/mg-types'

/** 一场战斗的原始样本（`encounters` 的四列）。 */
export interface LocalDropSample {
  ts: number
  cell: number
  rank: string | null
  dropMst: number | null
}

export const EMPTY_LOCAL_DROPS: LocalDropScope = Object.freeze({
  battles: 0,
  sWins: 0,
  sWinsWithoutDrop: 0,
  ships: [],
}) as LocalDropScope

/**
 * 聚合一批样本。
 *
 * @param samples 原始样本
 * @param cell    只看某一个点（罗盘边号）；省略 = 整图
 */
export const aggregateLocalDrops = (
  samples: readonly LocalDropSample[],
  cell?: number,
): LocalDropScope => {
  const byShip = new Map<number, LocalDropShip>()
  // 逐舰的「哪个点捞到几次」。展示侧那一行的点位悬停用它——**在这里算一次**，
  // 不让渲染路径回头去扫样本（本仓性能口径：装配期算，渲染期只读）。
  const cellsByShip = new Map<number, Map<number, number>>()
  let battles = 0
  let sWins = 0
  let sWinsWithoutDrop = 0
  for (const sample of samples) {
    if (cell !== undefined && sample.cell !== cell) continue
    battles += 1
    const mstId = Number(sample.dropMst)
    const dropped = Number.isInteger(mstId) && mstId > 0
    if (sample.rank === 'S') {
      sWins += 1
      if (!dropped) sWinsWithoutDrop += 1
    }
    if (!dropped) continue
    const current = byShip.get(mstId)
    if (current) {
      current.count += 1
      current.firstTs = Math.min(current.firstTs, sample.ts)
      current.lastTs = Math.max(current.lastTs, sample.ts)
    } else {
      byShip.set(mstId, { mstId, count: 1, firstTs: sample.ts, lastTs: sample.ts, cells: [] })
    }
    // 点位认不出（老记录没落这一列）也照数：逐条之和必须等于那一行的「捞到 N 次」，
    // 少记一条会让悬停与行里的数对不上，而对不上比不显示更糟。
    const tally = cellsByShip.get(mstId) ?? new Map<number, number>()
    const at = Number(sample.cell) | 0
    tally.set(at, (tally.get(at) ?? 0) + 1)
    cellsByShip.set(mstId, tally)
  }
  for (const ship of byShip.values()) {
    ship.cells = [...(cellsByShip.get(ship.mstId) ?? new Map())]
      .map(([at, count]) => ({ cell: at, count }))
      // 与舰行同一条排法：捞得多的在前，同次数按点号——悬停第一眼看到的
      // 就是「最该再去的那个点」
      .sort((left, right) => right.count - left.count || left.cell - right.cell)
  }
  return {
    battles,
    sWins,
    sWinsWithoutDrop,
    ships: [...byShip.values()].sort(
      (left, right) => right.count - left.count || left.mstId - right.mstId,
    ),
  }
}
