// 「本机确认 · 你自己捞到过」每一行的点位悬停：这几次分别落在哪几个点。
//
// ---- 为什么只进悬停（2026-08-23）----
// 一眼位置留给「捞到 N 次」那个数。点位分布是**追问**的答案——
// 「同一条船我到底是在哪儿捞到的、要不要再去那个点」——追问的人才会把鼠标停上去。
// 摊在行里会把一行数据挤成一段话（人话纪律：解释不进一眼位置）。
//
// ---- 字母从哪来 ----
// `cell` 是罗盘 `api_no`（边号），**不是** wiki 的点位字母。字母要过 poi-fcd 的
// route 表反查，而那张表归展示侧（di/ji 各自已经有 `letterOf`）。所以这里收一个
// 回调，反查不到就照实写 `#编号`——不猜一个字母出来。
//
// ---- 数从哪来 ----
// 逐点计数在**装配期**由 `main/mg/local-drops` 的 `aggregateLocalDrops` 一次算好，
// 随 chronicle 一起过来。渲染路径上只做一次字符串拼接，不扫任何表（本仓性能口径）。

export interface LocalDropCell {
  /** 罗盘 `api_no`（边号），不是点位字母 */
  cell: number
  count: number
}

/**
 * 「B 点 ×2 · F 点 ×1」。
 *
 * 顺序在聚合期就定了（次数降序、同次数按点号），这里照原序写：
 * 悬停里的先后与「哪个点捞得最多」是同一个意思，不该在渲染期再排一次。
 *
 * 一条都没有（老记录没落点位）返回空串——调用方据此**不挂 title**，
 * 而不是挂一个空悬停框。逐条之和恒等于那一行的「捞到 N 次」：
 * 这里不按点号过滤，认不出的点也照数，少一条就对不上账了。
 */
export const localDropCellsText = (
  cells: readonly LocalDropCell[] | null | undefined,
  letterOf: (cell: number) => string,
): string =>
  (cells ?? [])
    .filter((one) => Number.isInteger(one.cell) && one.count > 0)
    .map((one) => `${letterOf(one.cell)} 点 ×${one.count}`)
    .join(' · ')
