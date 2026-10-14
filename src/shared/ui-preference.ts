// 共享偏好按本窗实际改动合并；主进程完成读/改/写，两个窗口不会整份互盖。
// 集合型数组只合并增删；阵容快照里的有序数组仍整段替换。
export const UI_PREFERENCE_CHANNEL = 'ui:preference-changed'
const SET_PATHS: Record<string, string[]> = {
  'improve-favorites.v1': [''],
  'equip.personal.v1': ['favoriteInstanceIds'],
  'ship.personal.v1': ['favoriteRoots', 'favoriteRosterIds'],
  'ru.airBase.muted': [''],
  'ru.metricsHidden.fleet': [''],
  'ru.metricsHidden.airbase': [''],
  'ru.sandbox': [''],
  'bi.planner-prefs.v1': ['protectedDeckIds', 'excludedRosterIds'],
  'ji.collapsedShipClasses': [''],
  'zi.trendDisabled': [''],
}
export const SHARED_UI_PREFERENCES = new Set([
  ...Object.keys(SET_PATHS), 'qn.lineup', 'du.air-targets.v1', 'du.gimmick-progress.v1',
  'ji.routeTarget', 'zi.targets', 'equipStock.view', 'levelExp', 'ships.firstOwned',
])

export const mergeUiPreference = (key: string, before: any, next: any, current: any): any => {
  const merge = (base: any, value: any, latest: any, path: string): any => {
    if (JSON.stringify(base) === JSON.stringify(value)) return latest
    if (SET_PATHS[key]?.includes(path)) {
      const previous = base ?? []
      const removed = new Set(previous.filter((id: unknown) => !value.includes(id)))
      const added = value.filter((id: unknown) => !previous.includes(id))
      return [...new Set([...(latest ?? []).filter((id: unknown) => !removed.has(id)), ...added])]
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const out = { ...latest }
      const orderedMap = path === '' && ['ji.routeTarget', 'du.air-targets.v1'].includes(key)
      const positions = new Map(orderedMap ? Object.keys(base ?? {}).map((name, index) => [name, index]) : [])
      let lastPosition = -1
      for (const name of Object.keys(base ?? {})) {
        if (!Object.hasOwn(value, name)) {
          // 删除一项任务的最后一条本窗阵容时，对窗可能刚给同任务加了另一张图。
          if (key === 'qn.lineup' && path === '') {
            const records = { ...latest?.[name] }
            for (const map of Object.keys(base[name])) delete records[map]
            if (Object.keys(records).length) out[name] = records
            else delete out[name]
          } else delete out[name]
        }
      }
      for (const [name, item] of Object.entries(value)) {
        // 目标点按插入序裁剪；本窗先删后插的键在合并后也要回到末尾。
        const position = positions.get(name)
        if (orderedMap && (
          (position !== undefined && position < lastPosition) ||
          JSON.stringify(base?.[name]) !== JSON.stringify(item)
        )) delete out[name]
        if (position !== undefined) lastPosition = Math.max(lastPosition, position)
        out[name] = merge(base?.[name], item, latest?.[name], path ? `${path}.${name}` : name)
      }
      return out
    }
    return value
  }
  return merge(before, next, current, '')
}
