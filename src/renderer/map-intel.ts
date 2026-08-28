import {
  applyMapDropWindows,
  applyMapDrops,
  applyMapEnemyComps,
  applyMapIntelCatalog,
} from '../shared/map-intel'
import { queryLode } from './kernel'

let initPromise: Promise<boolean> | null = null

// 内置目录始终可用；用户目录里的同名矿脉包只负责覆盖资料，不改变 UI 代码。
//
// 四层：`map-intel` 是底座（活动图各难度层 / 活动图的掉落与编成），
// `map-enemy-comps` 是常规图敌编成的第一方汇编层（只覆盖 enemyComps 那一格），
// `map-drops` 是常规图掉落的第一方汇编层（只覆盖 ships 与 emptyDrop 两格），
// `map-drop-windows` 是常规图限定期窗口的第一方台账（2026-08-22 批次 4 起，
// 这一域从底座切过来，是它的唯一出处）。
// 四个包各读各的，谁失败都不拖垮另一个——底座缺了还有内置 1-1，
// 汇编层缺了就退回底座里 wikiwiki 那份，台账缺了「限时」标不显示（不是显示成常驻）。
export const initMapIntel = (): Promise<boolean> => {
  if (initPromise) return initPromise
  // 四个 queryLode 都写成字面量 id：`lode-ids` 的清单护栏是从源码里把实参扫出来
  // 逐条核对的，写成变量它就看不见——那张表一旦漏了包，健康度面板会静默少报一格。
  const settle = (
    id: string,
    apply: (value: unknown) => boolean,
    pending: Promise<{ data?: unknown } | null>,
  ) =>
    pending
      .then((pack) => (pack?.data ? apply(pack.data) : false))
      .catch((error) => {
        console.warn(`[kanso] 海域情报目录加载失败（${id}），继续使用已有目录`, error)
        return false
      })
  initPromise = Promise.all([
    settle('map-intel', applyMapIntelCatalog, queryLode('map-intel')),
    settle('map-enemy-comps', applyMapEnemyComps, queryLode('map-enemy-comps')),
    settle('map-drops', applyMapDrops, queryLode('map-drops')),
    settle('map-drop-windows', applyMapDropWindows, queryLode('map-drop-windows')),
  ]).then(([base, comps, drops, windows]) => base || comps || drops || windows)
  return initPromise
}
