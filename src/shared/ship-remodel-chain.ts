export interface RemodelChainShip {
  id: number
  sortNo: number
  afterId: number
}

export interface RemodelChainUpgrade {
  targetId: number
  currentShipId: number
  originalShipId: number
  stage: number
}

export interface RemodelChains {
  chainOf: Map<number, number[]>
  rootOf: Map<number, number>
}

/**
 * 把 api_mst_shipupgrade 与旧 api_aftershipid 合成同一张改造链图。
 *
 * api_mst_shipupgrade 只覆盖部分形态，不能因为表非空就全局关闭 aftershipid；
 * 同一目标两边都有记录时原生升级表优先，缺项才使用该舰自身的改造指向。
 */
export const buildShipRemodelChains = (
  ships: RemodelChainShip[],
  upgrades: RemodelChainUpgrade[],
): RemodelChains => {
  const byId = new Map(
    ships
      .filter((ship) => Number.isInteger(ship.id) && ship.id > 0)
      .map((ship) => [ship.id, ship]),
  )
  const unionParent = new Map<number, number>([...byId.keys()].map((id) => [id, id]))
  const find = (id: number): number => {
    const parent = unionParent.get(id)
    if (parent == null || parent === id) return id
    const root = find(parent)
    unionParent.set(id, root)
    return root
  }
  const union = (left: number, right: number) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) unionParent.set(b, a)
  }
  const outgoing = new Map<number, Set<number>>()
  const addEdge = (from: number, to: number) => {
    if (!byId.has(from) || !byId.has(to) || from === to) return
    union(from, to)
    const targets = outgoing.get(from) ?? new Set<number>()
    targets.add(to)
    outgoing.set(from, targets)
  }

  const nativeParent = new Map<number, number>()
  const preferredRoots = new Set<number>()
  const stageById = new Map<number, number>()
  for (const upgrade of upgrades) {
    const target = Number(upgrade.targetId)
    if (!byId.has(target)) continue
    const current = Number(upgrade.currentShipId)
    const original = Number(upgrade.originalShipId)
    stageById.set(target, Math.max(0, Number(upgrade.stage) || 0))
    if (byId.has(original)) {
      preferredRoots.add(original)
      union(original, target)
    }
    if (byId.has(current) && current !== target) {
      nativeParent.set(target, current)
      addEdge(current, target)
    } else if (byId.has(original) && original !== target) {
      nativeParent.set(target, original)
      addEdge(original, target)
    }
  }

  // 逐目标回退：原生表已经给出前置的目标绝不被 aftershipid 覆盖。
  for (const ship of byId.values()) {
    const target = Number(ship.afterId)
    if (!byId.has(target) || target === ship.id) continue
    union(ship.id, target)
    if (!nativeParent.has(target)) addEdge(ship.id, target)
  }

  const components = new Map<number, number[]>()
  for (const id of byId.keys()) {
    const component = find(id)
    const members = components.get(component) ?? []
    members.push(id)
    components.set(component, members)
  }

  const sortNo = (id: number) => byId.get(id)?.sortNo || id
  const chainOf = new Map<number, number[]>()
  const rootOf = new Map<number, number>()
  for (const members of components.values()) {
    const memberSet = new Set(members)
    const preferred = members.filter((id) => preferredRoots.has(id))
    const incoming = new Set<number>()
    for (const [from, targets] of outgoing) {
      if (!memberSet.has(from)) continue
      for (const target of targets) if (memberSet.has(target)) incoming.add(target)
    }
    const roots = preferred.length ? preferred : members.filter((id) => !incoming.has(id))
    // 可逆改造可能没有入度为 0 的节点；此时以最早图鉴号稳定选根，仍保留整组。
    const root = [...(roots.length ? roots : members)].sort(
      (left, right) => sortNo(left) - sortNo(right) || left - right,
    )[0]
    const distance = new Map<number, number>([[root, 0]])
    const queue = [root]
    while (queue.length) {
      const current = queue.shift()!
      for (const target of outgoing.get(current) ?? []) {
        if (!memberSet.has(target) || distance.has(target)) continue
        distance.set(target, (distance.get(current) ?? 0) + 1)
        queue.push(target)
      }
    }
    const chain = [...members].sort(
      (left, right) =>
        (distance.get(left) ?? 1_000) - (distance.get(right) ?? 1_000) ||
        (stageById.get(left) ?? 0) - (stageById.get(right) ?? 0) ||
        sortNo(left) - sortNo(right) ||
        left - right,
    )
    chainOf.set(root, chain)
    for (const member of chain) rootOf.set(member, root)
  }
  return { chainOf, rootOf }
}
