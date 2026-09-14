export const POP_QUERY_KEY = 'pop'
/** 允许弹出的模块：坞内七个。浮层三个（回顾/通知/设置）与诊断类不弹。 */
export const POP_MODULE_IDS = ['ji', 'ru', 'zi', 'qn', 'di', 'du', 'bi'] as const
export type PopModuleId = (typeof POP_MODULE_IDS)[number]

export const isPopModuleId = (raw: unknown): raw is PopModuleId =>
  typeof raw === 'string' && POP_MODULE_IDS.some((id) => id === raw)

/** 从 location.search 读弹出的模块 id；不在名单里回 null。 */
export const popModuleOf = (search: string): PopModuleId | null => {
  const id = new URLSearchParams(search).get(POP_QUERY_KEY)
  return isPopModuleId(id) ? id : null
}

/** 落盘/推送来的名单去重、只认名单内、保持原序。 */
export const normalizePopped = (raw: unknown): PopModuleId[] =>
  Array.isArray(raw) ? [...new Set(raw.filter(isPopModuleId))] : []

/** 一个模块此刻住在哪扇窗：弹出中 → 它自己的 id，否则 'main'。 */
export const hostOfModule = (id: string, popped: readonly string[]): string =>
  popped.includes(id) ? id : 'main'

export const popWindowTitle = (moduleTitle: string): string => `kuma · ${moduleTitle}`
export const POP_WINDOW_BOUNDS_KEY = (id: string): string => `kuma.popWindow.${id}`
export const POP_WINDOW_DEFAULT_SIZE = { width: 960, height: 720 }
export const POP_WINDOW_MIN_SIZE = { width: 420, height: 320 }

// IPC 频道（渲染层 ↔ 主进程）
export const POP_OPEN_CHANNEL = 'window:pop-open' // invoke(id)：开或聚焦
export const POP_CLOSE_CHANNEL = 'window:pop-close' // invoke(id)：关；没开着也返回 true（幂等）
export const POP_FOCUS_CHANNEL = 'window:pop-focus' // invoke(id)：只聚焦，没开着返回 false
export const POP_LIST_CHANNEL = 'window:pop-list' // invoke() 取名单；主进程也主动推名单给每扇窗
export const POP_CLOSED_CHANNEL = 'window:pop-closed' // 主进程 → 主窗：玩家关窗（整体退出/收进托盘时不发）
export const POP_RELAY_CHANNEL = 'window:pop-relay' // invoke({ to: 'main' | id, kind: string, payload: unknown })
export const POP_RELAY_EVENT = 'kuma:pop-relay' // 主进程 → 目标窗：{ kind, payload }
