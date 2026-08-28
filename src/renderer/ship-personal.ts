// 舰娘图鉴/在籍列表共用的本地个人层。
// 图鉴收藏与同改装链备注按链根保存；副舰用途备注按唯一在籍 ID 保存，
// 因此同名同等级的两艘也不会互相覆盖。离籍后 ID 备注保留，供收容库回看。
import { queryMasterRaw, uiGet, uiSet } from './kernel'
import { buildShipRemodelChains } from '../shared/ship-remodel-chain'

const KEY = 'ship.personal.v1'

export interface ShipPersonalState {
  favoriteRoots: number[]
  /** 在籍实例收藏（2026-08-16 用户定的）：收藏的是「我这一艘」，按唯一在籍 ID 存 */
  favoriteRosterIds: number[]
  rootNotes: Record<string, string>
  rosterNotes: Record<string, string>
}

const EMPTY: ShipPersonalState = {
  favoriteRoots: [],
  favoriteRosterIds: [],
  rootNotes: {},
  rosterNotes: {},
}

// 渲染层持一份内存态：uiGet 是同步跨进程调用，返回的还是 remote 代理——
// 之前图鉴目录逐行调 shipRosterNote，一次全量渲染就是数百到上千次阻塞 IPC。
// 写路径全在本文件内（save 同步落盘并更新缓存），读路径零 IPC。
// JSON 往返把 remote 代理拍成本地纯对象，属性访问才真正免 IPC。
let cache: ShipPersonalState | null = null

export const shipPersonal = (): ShipPersonalState => {
  if (cache) return cache
  const raw = JSON.parse(
    JSON.stringify(uiGet<Partial<ShipPersonalState>>(KEY, EMPTY)),
  ) as Partial<ShipPersonalState>
  cache = {
    favoriteRoots: Array.isArray(raw.favoriteRoots)
      ? raw.favoriteRoots.filter((id) => Number.isInteger(id) && id > 0)
      : [],
    favoriteRosterIds: Array.isArray(raw.favoriteRosterIds)
      ? raw.favoriteRosterIds.filter((id) => Number.isInteger(id) && id > 0)
      : [],
    rootNotes: raw.rootNotes && typeof raw.rootNotes === 'object' ? raw.rootNotes : {},
    rosterNotes: raw.rosterNotes && typeof raw.rosterNotes === 'object' ? raw.rosterNotes : {},
  }
  return cache
}

const save = (next: ShipPersonalState) => {
  cache = next
  uiSet(KEY, next)
}

export const isFavoriteShipRoot = (rootId: number) =>
  shipPersonal().favoriteRoots.includes(rootId)

// ---- 任意形态 → 链根的收藏判定 ----
// 收藏按链根存，但列表/练级卡手里是任意形态的 mstId。链根解析按需构建一次
// （权威并查集在 shared/ship-remodel-chain，禁止拿 aftershipid 手搓反向链——
// 可逆改装的回环会让链根回溯断在半路）。表就绪前先按「本形态即根」兜底判：
// 基础形态直接命中，改后形态等表到手由 onReady 触发的重渲纠正。
let favoriteRootOf: Map<number, number> | null = null
let favoriteRootLoading = false
const favoriteRootReadyCbs: (() => void)[] = []

export const ensureFavoriteRoots = (onReady?: () => void) => {
  if (favoriteRootOf) return
  if (onReady) favoriteRootReadyCbs.push(onReady)
  if (favoriteRootLoading) return
  favoriteRootLoading = true
  void queryMasterRaw().then((raw) => {
    const data = raw?.data
    if (!data) return
    const chains = buildShipRemodelChains(
      ((data.api_mst_ship ?? []) as any[])
        .filter((ship) => Number(ship.api_id) > 0 && Number(ship.api_id) < 1500)
        .map((ship) => ({
          id: Number(ship.api_id),
          sortNo: Number(ship.api_sortno) || Number(ship.api_id),
          afterId: Number.parseInt(`${ship.api_aftershipid ?? 0}`, 10) || 0,
        })),
      ((data.api_mst_shipupgrade ?? []) as any[]).map((upgrade) => ({
        targetId: Number(upgrade.api_id) || 0,
        currentShipId: Number(upgrade.api_current_ship_id) || 0,
        originalShipId: Number(upgrade.api_original_ship_id) || 0,
        stage: Number(upgrade.api_upgrade_level) || 0,
      })),
    )
    favoriteRootOf = chains.rootOf
    favoriteRootReadyCbs.splice(0).forEach((cb) => cb())
  })
}

/** 任意形态 mstId 的收藏判定（链根口径） */
export const isFavoriteShipMst = (mstId: number): boolean => {
  ensureFavoriteRoots()
  return isFavoriteShipRoot(favoriteRootOf?.get(mstId) ?? mstId)
}

export const toggleFavoriteShipRoot = (rootId: number): boolean => {
  const state = shipPersonal()
  const on = !state.favoriteRoots.includes(rootId)
  state.favoriteRoots = on
    ? [...state.favoriteRoots, rootId]
    : state.favoriteRoots.filter((id) => id !== rootId)
  save(state)
  return on
}

export const isFavoriteRoster = (rosterId: number) =>
  shipPersonal().favoriteRosterIds.includes(rosterId)

export const toggleFavoriteRoster = (rosterId: number): boolean => {
  const state = shipPersonal()
  const on = !state.favoriteRosterIds.includes(rosterId)
  state.favoriteRosterIds = on
    ? [...state.favoriteRosterIds, rosterId]
    : state.favoriteRosterIds.filter((id) => id !== rosterId)
  save(state)
  return on
}

/** 在籍舰娘的收藏判定：实例收藏（我这一艘）∪ 图鉴链根收藏（这个舰娘） */
export const isFavoriteOwnedShip = (ship: { id: number; shipId: number }): boolean =>
  isFavoriteRoster(ship.id) || isFavoriteShipMst(ship.shipId)

export const shipRootNote = (rootId: number) =>
  shipPersonal().rootNotes[`${rootId}`] ?? ''

export const setShipRootNote = (rootId: number, note: string) => {
  const state = shipPersonal()
  const value = note.trim().slice(0, 400)
  if (value) state.rootNotes[`${rootId}`] = value
  else delete state.rootNotes[`${rootId}`]
  save(state)
}

export const shipRosterNote = (rosterId: number) =>
  shipPersonal().rosterNotes[`${rosterId}`] ?? ''

export const setShipRosterNote = (rosterId: number, note: string) => {
  const state = shipPersonal()
  const value = note.trim().slice(0, 120)
  if (value) state.rosterNotes[`${rosterId}`] = value
  else delete state.rosterNotes[`${rosterId}`]
  save(state)
}
