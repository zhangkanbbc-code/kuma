// 海域 id 的编解码。
//
// 游戏没有单一的「海域主键」，各处按 `海域区 × 10 + 图号` 拼一个出来
// （2-5 → 25，活动图 46-1 → 461）。这个约定原先是隐式的：全仓手写编码 22 处、
// 解码 14 处，散落 6 个文件——连新加的模块也会照着再实现一遍，因为没有地方可引。
// 集中在这里，顺便把「区号可以超过 9」这件事写进注释，省得有人按个位数去想。
//
// 注意区号无上限（活动区一路往上加），所以解码只能除以 10 取整，
// 不能假设 mapId 是两位数。

/** 海域区 + 图号 → 海域 id。例：(2, 5) → 25、(46, 1) → 461 */
export const mapIdOf = (area: number, no: number): number => area * 10 + no

/** 海域 id → 海域区。例：461 → 46 */
export const mapAreaOf = (mapId: number): number => Math.floor(mapId / 10)

/** 海域 id → 图号。例：461 → 1 */
export const mapNoOf = (mapId: number): number => mapId % 10

/** 海域 id → 显示用编号。例：461 → "46-1" */
export const mapCodeOf = (mapId: number): string => `${mapAreaOf(mapId)}-${mapNoOf(mapId)}`

/** 是否活动海域（常规海域只到第 7 区） */
export const isEventMapArea = (area: number): boolean => area > 7
