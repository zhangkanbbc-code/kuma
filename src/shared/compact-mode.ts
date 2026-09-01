/**
 * 紧凑模式的偏好账（模块级，落在 `ui.compact.v1`）。
 *
 * 记的是**开着的那几个模块 id**，不是每个模块一个布尔——默认关，名单里没有
 * 就是常规排布，于是「玩家什么都不动＝界面一如既往」由数据结构本身保证，
 * 不靠某个默认值写对。各模块各记各的：同一格里两个模块可以一开一关。
 *
 * 落盘前排序：uiSet 走 config.set 的引用/值比较判「变没变」，次序抖动会让
 * 同一份名单被反复判成新值、每翻一次开关多一次原子写盘。
 */
export const parseCompactModes = (raw: unknown): Set<string> =>
  new Set(
    (Array.isArray(raw) ? raw : []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  )

export const toggledCompactModes = (on: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(on)
  if (!next.delete(id)) next.add(id)
  return next
}

export const serializeCompactModes = (on: ReadonlySet<string>): string[] => [...on].sort()
