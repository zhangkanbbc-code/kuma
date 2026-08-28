// 仓库装备的实例收藏（2026-08-16 用户定的在籍轴收藏）。
// 收藏的是「我这一件」——同款 ×97 里那件 ★+9 与白板不是一回事，
// 所以按 slotitem 实例 id 存，不按款。展示与置顶：实例行 ★ 可点，
// 款行聚合显示并整款置顶（收藏藏在折叠层里就没有置顶意义了）。
// 缓存口径与 ship-personal 相同：读路径零 IPC，写路径同步落盘并更新缓存。
import { uiGet, uiSet } from './kernel'

const KEY = 'equip.personal.v1'

interface EquipPersonalState {
  favoriteInstanceIds: number[]
}

let cache: EquipPersonalState | null = null

const equipPersonal = (): EquipPersonalState => {
  if (cache) return cache
  const raw = JSON.parse(
    JSON.stringify(uiGet<Partial<EquipPersonalState>>(KEY, { favoriteInstanceIds: [] })),
  ) as Partial<EquipPersonalState>
  cache = {
    favoriteInstanceIds: Array.isArray(raw.favoriteInstanceIds)
      ? raw.favoriteInstanceIds.filter((id) => Number.isInteger(id) && id > 0)
      : [],
  }
  return cache
}

const save = (next: EquipPersonalState) => {
  cache = next
  uiSet(KEY, next)
}

export const isFavoriteEquipInstance = (instanceId: number) =>
  equipPersonal().favoriteInstanceIds.includes(instanceId)

export const toggleFavoriteEquipInstance = (instanceId: number): boolean => {
  const state = equipPersonal()
  const on = !state.favoriteInstanceIds.includes(instanceId)
  state.favoriteInstanceIds = on
    ? [...state.favoriteInstanceIds, instanceId]
    : state.favoriteInstanceIds.filter((id) => id !== instanceId)
  save(state)
  return on
}
