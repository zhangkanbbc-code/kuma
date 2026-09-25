// 今日改修按装备款式（mst id）收藏，独立于仓库的单件装备收藏。
// 读路径用缓存，切换后通过 uiSet 同步保存，跨重启保留名单。
import { uiGet, uiSet } from './kernel'

const KEY = 'improve-favorites.v1'
let cache: number[] | null = null

const favorites = (): number[] => {
  if (cache) return cache
  const raw = uiGet<number[]>(KEY, [])
  cache = Array.isArray(raw)
    ? [...new Set(raw.filter((id) => Number.isInteger(id) && id > 0))]
    : []
  return cache
}

export const improveFavoriteIds = (): number[] => [...favorites()]

export const isImproveFavorite = (mstId: number): boolean => favorites().includes(mstId)

export const toggleImproveFavorite = (mstId: number): boolean => {
  const ids = favorites()
  const on = !ids.includes(mstId)
  cache = on ? [...ids, mstId] : ids.filter((id) => id !== mstId)
  uiSet(KEY, cache)
  return on
}
