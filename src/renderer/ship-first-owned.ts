// 每条改造谱系「第一次进到你手里」的时刻。
//
// 这份基线原本长在铃里，只为发「新舰入库」通知。首见志需要的是同一个判定，
// 却另写了一套（查 ship_life_state.first_seen）——而且更弱：捞到就拆的舰
// 在那边没有痕迹，会被误判成首次。这里把它提出来共用。
//
// 三条性质是这份基线比别的来源强的原因：
// - **只增不减**：拆解、当素材、被击沉都不会让它退出，因为「你曾经拥有过」是既成事实
// - **按谱系**：持有初霜改二之后再捞到初霜，不算新舰
// - **首次运行不误报**：第一次建立基线时把当前持有的全部记进去，且时刻记 0
//   （＝记账之前就有，真正的第一次无从得知）
//
// 时刻也要记：铃只需要「是不是新的」，首见志还要回答「什么时候」。
//
// 谱系归属只认 shared/ship-remodel-chain 那一份（纪律：拿 aftershipid 手搓单值
// 反向链一律违规）。这里原先自己搓过一个并查集，只吃 afterShipId、不看
// api_mst_shipupgrade：那张原生升级表独有的边（Tuscaloosa 923↔928 这类双方
// aftershipid 都为 0 的可逆改装）整条丢掉，一条谱系被劈成两家——
// 而这份基线管的是「首见」的全局首次判定，劈开就意味着同一条谱系的两个形态
// 各标一次 ⚓，里程碑感被稀释（口径：全局只标一次）。
import { mg, uiGet, uiSet } from './kernel'
import { buildShipRemodelChains, type RemodelChains } from '../shared/ship-remodel-chain'

// 旧版铃存的是 number[]（只有 id 没有时刻）。读到就迁移成「时刻不可知」，
// 语义正好对上：那批舰确实是记账之前就在手里的。
const STORE_KEY = 'ships.firstOwned'
const LEGACY_KEY = 'lg.owned'

/** 时刻不可知（记账之前就有）。用 0 而不是 null，好让存储保持纯数字表。 */
export const OWNED_BEFORE_LEDGER = 0

let firstOwned: Record<number, number> | null = null

let masterSource: typeof mg.master.ships | null = null
let upgradeSource: typeof mg.master.upgrades | null = null
let chains: RemodelChains = { chainOf: new Map(), rootOf: new Map() }

// 改造链随主数据走：ships 与 upgrades 任一换了新对象就重建（只看 ships 的话，
// 升级表迟到的那一拨边永远进不来）。
const ensureFamilies = (): RemodelChains => {
  if (masterSource === mg.master.ships && upgradeSource === mg.master.upgrades) return chains
  masterSource = mg.master.ships
  upgradeSource = mg.master.upgrades
  chains = buildShipRemodelChains(
    Object.entries(mg.master.ships).map(([idText, ship]) => ({
      id: Number(idText),
      // 铭的主数据摘要不留 api_sortno；sortNo 只用于稳定地挑链根与排链内顺序，
      // 不影响「谁和谁同族」的划分，用 api_sort_id 兜底即可。
      sortNo: ship.sortId || Number(idText),
      afterId: ship.afterShipId > 0 ? ship.afterShipId : 0,
    })),
    Object.values(mg.master.upgrades)
      .flat()
      .map((upgrade) => ({
        targetId: upgrade.targetShipId,
        currentShipId: upgrade.currentShipId,
        originalShipId: upgrade.originalShipId,
        stage: upgrade.stage,
      })),
  )
  return chains
}

/** 该形态所在改造谱系的根。链里没有它（主数据还没到）就自成一族。 */
const familyRootOf = (mstId: number): number => ensureFamilies().rootOf.get(mstId) ?? mstId

/** 把若干形态扩成它们所在谱系的全部形态。 */
export const expandFamilies = (ids: Iterable<number>): Set<number> => {
  const { chainOf, rootOf } = ensureFamilies()
  const expanded = new Set<number>()
  for (const id of ids) {
    expanded.add(id)
    const root = rootOf.get(id)
    if (root == null) continue
    for (const member of chainOf.get(root) ?? []) expanded.add(member)
  }
  return expanded
}

const load = (): Record<number, number> => {
  if (firstOwned) return firstOwned
  const saved = uiGet<Record<string, number> | null>(STORE_KEY, null)
  if (saved && typeof saved === 'object') {
    firstOwned = Object.fromEntries(
      Object.entries(saved).map(([id, ts]) => [Number(id), Number(ts) || OWNED_BEFORE_LEDGER]),
    )
    return firstOwned
  }
  // 迁移旧版铃的集合：那批舰是记账之前就在手的，时刻不可知
  const legacy = uiGet<number[] | null>(LEGACY_KEY, null)
  firstOwned = Array.isArray(legacy)
    ? Object.fromEntries(legacy.map((id) => [id, OWNED_BEFORE_LEDGER]))
    : {}
  return firstOwned
}

const save = () => uiSet(STORE_KEY, load())

/**
 * 拿当前在籍情况对一次基线。返回本次**新进来的谱系形态 id**（铃据此发通知）。
 *
 * 首次建立基线时返回空数组：那些舰是记账之前就有的，不是刚入手的。
 */
export const observeOwnedShips = (ts = Date.now()): number[] => {
  const current = new Set<number>()
  for (const ship of Object.values(mg.ships)) current.add(ship.shipId)
  if (!current.size) return []

  const known = load()
  const first = Object.keys(known).length === 0
  const fresh = first ? [] : [...current].filter((id) => known[id] == null)

  // 新到手的舰要把整条谱系都记上：之后捞到它的其他形态不该再算新舰。
  const stamp = first ? OWNED_BEFORE_LEDGER : ts
  const touched = expandFamilies(first ? current : fresh)
  let changed = false
  for (const id of touched) {
    if (known[id] != null) continue
    known[id] = stamp
    changed = true
  }
  if (changed) save()
  return fresh
}

/**
 * 这条谱系第一次到你手里的时刻。
 * - `null`：本地从没见过它
 * - `OWNED_BEFORE_LEDGER`：记账之前就有，真正的第一次无从得知
 */
export const firstOwnedAt = (mstId: number): number | null => {
  if (!(mstId > 0)) return null
  const known = load()
  const direct = known[mstId]
  if (direct != null) return direct
  // 痕迹可能记在同谱系的其他形态上（狄风 → 狄风改）
  const root = familyRootOf(mstId)
  let earliest: number | null = null
  for (const member of ensureFamilies().chainOf.get(root) ?? [mstId]) {
    const ts = known[member]
    if (ts == null) continue
    const value = Number(ts)
    if (earliest == null || value < earliest) earliest = value
  }
  return earliest
}
