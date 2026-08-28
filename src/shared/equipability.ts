export interface EquipabilityMaster {
  api_mst_ship?: any[]
  api_mst_stype?: any[]
  api_mst_slotitem?: any[]
  api_mst_equip_ship?: Record<string, any>
}

export interface EquipableTypeRule {
  id: number
  only: number[] | null
}

const positiveIds = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : []

// ---- 按主数据身份建的查表索引 ----
//
// 判定本身是纯查表，但三份原始数据都是数组：每问一次「这舰能不能装这件」，
// 原来都要 .find 线性扫一遍全表（舰 ~1500 行、装备 ~1500 行），还要现建一次
// 该舰的类别规则表。组合实验室一次重绘要问上千次，装备图鉴的「谁能装」
// 更是全舰枚举——同一份不变的主数据被反复扫。
//
// 索引挂在主数据对象本身上（WeakMap）：主数据换了新对象，旧索引自然连同旧数据
// 一起被回收，新对象第一次用时重建。不需要任何手动失效调用，也就不存在
// 「换了 start2 却忘了清缓存」这种失效漏洞。
interface ShipRules {
  list: EquipableTypeRule[]
  byType: Map<number, EquipableTypeRule>
}
interface MasterIndex {
  ships: Map<number, any>
  stypes: Map<number, any>
  equips: Map<number, any>
  rules: Map<number, ShipRules>
}
const masterIndexes = new WeakMap<object, MasterIndex>()

// 与原来的 .find 同口径：命中第一条，重复 api_id 不覆盖；id 取不出数的行不进表
const indexById = (rows: any[] | undefined): Map<number, any> => {
  const map = new Map<number, any>()
  for (const entry of rows ?? []) {
    const id = Number(entry?.api_id)
    if (Number.isFinite(id) && !map.has(id)) map.set(id, entry)
  }
  return map
}

const masterIndexOf = (master: EquipabilityMaster): MasterIndex => {
  const existing = masterIndexes.get(master)
  if (existing) return existing
  const built: MasterIndex = {
    ships: indexById(master.api_mst_ship),
    stypes: indexById(master.api_mst_stype),
    equips: indexById(master.api_mst_slotitem),
    rules: new Map(),
  }
  masterIndexes.set(master, built)
  return built
}

const buildTypeRules = (
  master: EquipabilityMaster,
  shipMstId: number,
): EquipableTypeRule[] => {
  const override = master.api_mst_equip_ship?.[`${shipMstId}`]?.api_equip_type
  if (override && typeof override === 'object') {
    return Object.entries(override)
      .map(([id, value]) => ({
        id: Number(id),
        only: Array.isArray(value) ? positiveIds(value) : null,
      }))
      .filter((entry) => Number.isInteger(entry.id) && entry.id > 0)
      .sort((a, b) => a.id - b.id)
  }

  const index = masterIndexOf(master)
  const ship = index.ships.get(shipMstId)
  if (!ship) return []
  const stype = index.stypes.get(Number(ship.api_stype))
  const table = stype?.api_equip_type
  if (!table || typeof table !== 'object') return []
  return Object.entries(table)
    .filter(([, value]) => Number(value) === 1)
    .map(([id]) => ({ id: Number(id), only: null }))
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0)
    .sort((a, b) => a.id - b.id)
}

const shipRulesOf = (master: EquipabilityMaster, shipMstId: number): ShipRules => {
  const index = masterIndexOf(master)
  const cached = index.rules.get(shipMstId)
  if (cached) return cached
  const list = buildTypeRules(master, shipMstId)
  const built: ShipRules = { list, byType: new Map(list.map((rule) => [rule.id, rule])) }
  index.rules.set(shipMstId, built)
  return built
}

/**
 * 常规装备槽的权威口径：
 * - api_mst_equip_ship 有该舰条目时，以单舰矩阵为完整覆盖；
 * - 否则回退 api_mst_stype 的舰种默认矩阵。
 *
 * only === null 表示该类别全部可装；number[] 表示仅可装列出的具体装备。
 *
 * 返回的是**按主数据身份缓存的同一个数组**，调用方不要就地改它（现有三处
 * 调用方都只读：.find / .map / 逐条判定）。
 */
export const equipableTypeRulesForShip = (
  master: EquipabilityMaster | null | undefined,
  shipMstId: number,
): EquipableTypeRule[] => {
  if (!master || !Number.isInteger(shipMstId) || shipMstId <= 0) return []
  return shipRulesOf(master, shipMstId).list
}

export const shipCanEquipItem = (
  master: EquipabilityMaster | null | undefined,
  shipMstId: number,
  equipMstId: number,
): boolean => {
  if (!master || !Number.isInteger(shipMstId) || shipMstId <= 0) return false
  const equip = masterIndexOf(master).equips.get(equipMstId)
  const typeId = Array.isArray(equip?.api_type) ? Number(equip.api_type[2]) : 0
  if (!typeId) return false
  const rule = shipRulesOf(master, shipMstId).byType.get(typeId)
  if (!rule) return false
  return rule.only == null || rule.only.includes(equipMstId)
}

export const equipableFriendlyShipIds = (
  master: EquipabilityMaster | null | undefined,
  equipMstId: number,
): number[] =>
  (master?.api_mst_ship ?? [])
    .filter(
      (ship: any) =>
        Number(ship?.api_id) > 0 &&
        Number(ship?.api_sortno) > 0 &&
        shipCanEquipItem(master, Number(ship.api_id), equipMstId),
    )
    .map((ship: any) => Number(ship.api_id))
    .sort((a, b) => a - b)
