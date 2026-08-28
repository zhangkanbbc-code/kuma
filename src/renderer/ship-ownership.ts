// 舰娘“持有”按整条改造谱系判断。掉落通常给初始形态；仓库里已经是改二、
// 分支改造或可逆改造时，也不能误标为未持有。
//
// 归属只认 shared/ship-remodel-chain 那一份（纪律：拿 aftershipid 手搓单值反向链
// 一律违规）。这里原先自己搓过一个并查集，只吃 afterShipId、不看 api_mst_shipupgrade：
// 那张原生升级表覆盖的边（Tuscaloosa 923↔928 这类只在升级表里、双方 aftershipid
// 都为 0 的改造）整条丢掉，于是「持有 928」被判成没有 923，掉落池里照样标「未持有」。
// 共用那份是两边都喂、逐目标回退，两类边一条不漏。
import { mg } from './kernel'
import { buildShipRemodelChains, type RemodelChains } from '../shared/ship-remodel-chain'

let masterSource: typeof mg.master.ships | null = null
let upgradeSource: typeof mg.master.upgrades | null = null
let shipSource: typeof mg.ships | null = null
let chains: RemodelChains = { chainOf: new Map(), rootOf: new Map() }
let ownedFamilies = new Set<number>()

// 改造链随主数据走：ships 与 upgrades 任一换了新对象就重建（只看 ships 的话，
// 升级表迟到的那一拨边永远进不来）。
const rebuildFamilies = () => {
  if (masterSource === mg.master.ships && upgradeSource === mg.master.upgrades) return
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
  shipSource = null
}

/** 该形态所在改造谱系的根。链里没有它（主数据还没到）就自成一族。 */
const familyRootOf = (mstId: number): number => chains.rootOf.get(mstId) ?? mstId

const rebuildOwned = () => {
  rebuildFamilies()
  if (shipSource === mg.ships) return
  shipSource = mg.ships
  ownedFamilies = new Set(Object.values(mg.ships).map((ship) => familyRootOf(ship.shipId)))
}

export const isShipFamilyOwned = (mstId: number): boolean => {
  if (mstId <= 0) return false
  rebuildOwned()
  return ownedFamilies.has(familyRootOf(mstId))
}

// 曾经这里还导出过 shipFamilyMembers（同谱系全部形态）给「这次掉落是不是
// 第一次得到它」用。那个职能已经整个搬去 ship-first-owned 的 expandFamilies
// ——那边才是首见基线的所在地——这里零消费者，删掉不留空壳。

export const unownedShipBadgeHtml = (mstId: number): string =>
  mstId > 0 && !isShipFamilyOwned(mstId)
    ? '<span class="drop-unowned" title="整条改造谱系均未持有">未持有</span>'
    : ''
