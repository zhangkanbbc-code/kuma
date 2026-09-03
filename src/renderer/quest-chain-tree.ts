export interface QuestChainEntry {
  id: number
  code: string
  name: string
  pre: string[]
}

export type QuestChainDirection = 'before' | 'after'

export interface QuestChainBranch {
  entry: QuestChainEntry
  children: QuestChainBranch[]
  cycle: boolean
  cutCount: number
}

export interface QuestChainForest {
  branches: QuestChainBranch[]
  cutCount: number
}

export interface QuestChainTree {
  before: QuestChainForest
  after: QuestChainForest
}

export interface QuestChainTreeOptions {
  maxDepth?: number
  maxNodesPerDirection?: number
}

export interface CompleteQuestTreeNode {
  entry: QuestChainEntry
  children: CompleteQuestTreeNode[]
  extraParents: QuestChainEntry[]
  unresolvedParents: string[]
}

const byStableOrder = (left: QuestChainEntry, right: QuestChainEntry) =>
  left.id - right.id || left.code.localeCompare(right.code)

// 游戏任务表里存在的任务由游戏状态决定，不计入推断完成。
export const inferCompletedQuestCodes = (
  entries: Iterable<QuestChainEntry>,
  observedQuestIds: Iterable<number>,
): Set<string> => {
  const byId = new Map<number, QuestChainEntry>()
  const byCode = new Map<string, QuestChainEntry>()
  for (const entry of entries) {
    byId.set(entry.id, entry)
    byCode.set(entry.code, entry)
  }
  const inferred = new Set<string>()
  const walk = (code: string) => {
    const entry = byCode.get(code)
    if (!entry) return
    for (const prerequisite of entry.pre) {
      if (inferred.has(prerequisite)) continue
      inferred.add(prerequisite)
      walk(prerequisite)
    }
  }
  const observedIds = [...observedQuestIds]
  for (const id of observedIds) {
    const entry = byId.get(id)
    if (entry) walk(entry.code)
  }
  for (const id of observedIds) {
    const entry = byId.get(id)
    if (entry) inferred.delete(entry.code)
  }
  return inferred
}

// 完整任务树必须让每条任务只出现一次，否则多前置任务会在各分支重复并指数膨胀。
// 第一条已知前置作为树上的主父节点；其余前置保存在 extraParents，UI 以交叉引用显示。
// 若上游资料意外形成环，则稳定地把环中 id 最小的任务提升为根，保证全库仍可浏览。
export const buildCompleteQuestForest = (
  entries: Iterable<QuestChainEntry>,
): CompleteQuestTreeNode[] => {
  const all = [...entries].sort(byStableOrder)
  const byCode = new Map(all.map((entry) => [entry.code, entry]))
  const parentByCode = new Map<string, string>()
  for (const entry of all) {
    const primary = entry.pre.find((code) => byCode.has(code))
    if (primary) parentByCode.set(entry.code, primary)
  }

  // 每个节点只有一个主父节点，因此沿 parent 指针即可检测全部环。
  for (const start of all) {
    const path: string[] = []
    const position = new Map<string, number>()
    let code: string | undefined = start.code
    while (code && parentByCode.has(code)) {
      const at = position.get(code)
      if (at != null) {
        const cycleCodes = path.slice(at)
        const promoted = cycleCodes
          .map((item) => byCode.get(item)!)
          .sort(byStableOrder)[0]
        parentByCode.delete(promoted.code)
        break
      }
      position.set(code, path.length)
      path.push(code)
      code = parentByCode.get(code)
    }
  }

  const childrenByCode = new Map<string, QuestChainEntry[]>()
  for (const entry of all) {
    const parent = parentByCode.get(entry.code)
    if (!parent) continue
    const children = childrenByCode.get(parent) ?? []
    children.push(entry)
    childrenByCode.set(parent, children)
  }
  for (const children of childrenByCode.values()) children.sort(byStableOrder)

  const makeNode = (entry: QuestChainEntry): CompleteQuestTreeNode => {
    const primary = parentByCode.get(entry.code)
    return {
      entry,
      children: (childrenByCode.get(entry.code) ?? []).map(makeNode),
      extraParents: entry.pre
        .filter((code) => code !== primary)
        .map((code) => byCode.get(code))
        .filter((parent): parent is QuestChainEntry => !!parent)
        .sort(byStableOrder),
      unresolvedParents: entry.pre.filter((code) => !byCode.has(code)),
    }
  }

  return all
    .filter((entry) => !parentByCode.has(entry.code))
    .map(makeNode)
}

// 任务库（quests-scn）的任务关系是 DAG，但资料包更新时仍要防环、防失控展开。
// 多条分支汇入同一任务时保留各自路径（树中允许重复显示该节点），只有当前
// 递归路径内再次出现同一码才标成环；这样不会把合法的汇合误判成重复垃圾。
export const buildQuestChainTree = (
  current: QuestChainEntry,
  entries: Iterable<QuestChainEntry>,
  options: QuestChainTreeOptions = {},
): QuestChainTree => {
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 6))
  const maxNodes = Math.max(1, Math.floor(options.maxNodesPerDirection ?? 48))
  const byCode = new Map<string, QuestChainEntry>()
  for (const entry of entries) {
    if (entry.code && entry.code !== '?') byCode.set(entry.code, entry)
  }
  if (current.code && current.code !== '?') byCode.set(current.code, current)

  const afterByCode = new Map<string, QuestChainEntry[]>()
  for (const entry of byCode.values()) {
    for (const prerequisite of entry.pre) {
      const children = afterByCode.get(prerequisite) ?? []
      children.push(entry)
      afterByCode.set(prerequisite, children)
    }
  }
  for (const children of afterByCode.values()) children.sort(byStableOrder)

  const unresolved = (code: string): QuestChainEntry => ({
    id: 0,
    code,
    name: '资料未收录',
    pre: [],
  })

  const targetsOf = (
    entry: QuestChainEntry,
    direction: QuestChainDirection,
  ): QuestChainEntry[] =>
    direction === 'before'
      ? entry.pre.map((code) => byCode.get(code) ?? unresolved(code))
      : [...(afterByCode.get(entry.code) ?? [])]

  const buildForest = (direction: QuestChainDirection): QuestChainForest => {
    const budget = { remaining: maxNodes }

    const walk = (
      entry: QuestChainEntry,
      depth: number,
      path: ReadonlySet<string>,
    ): QuestChainBranch | null => {
      if (budget.remaining <= 0) return null
      budget.remaining -= 1
      const cycle = path.has(entry.code)
      if (cycle) return { entry, children: [], cycle: true, cutCount: 0 }

      const targets = targetsOf(entry, direction)
      if (depth >= maxDepth) {
        return {
          entry,
          children: [],
          cycle: false,
          cutCount: targets.length,
        }
      }

      const nextPath = new Set(path)
      nextPath.add(entry.code)
      const children: QuestChainBranch[] = []
      let cutCount = 0
      for (let index = 0; index < targets.length; index += 1) {
        const child = walk(targets[index], depth + 1, nextPath)
        if (!child) {
          cutCount += targets.length - index
          break
        }
        children.push(child)
      }
      return { entry, children, cycle: false, cutCount }
    }

    const roots = targetsOf(current, direction)
    const branches: QuestChainBranch[] = []
    let cutCount = 0
    const path = new Set([current.code])
    for (let index = 0; index < roots.length; index += 1) {
      const branch = walk(roots[index], 1, path)
      if (!branch) {
        cutCount += roots.length - index
        break
      }
      branches.push(branch)
    }
    return { branches, cutCount }
  }

  return {
    before: buildForest('before'),
    after: buildForest('after'),
  }
}

/** 某条分支往下还藏了多少节点（含子树与被截断的名额），不含它自己。 */
export const countQuestChainDescendants = (branch: QuestChainBranch): number => {
  let count = branch.cutCount
  for (const child of branch.children) count += 1 + countQuestChainDescendants(child)
  return count
}

/** 从森林根走到指定任务的主前置路径（含自身）。找不到则空数组。 */
export const pathCodesToQuest = (
  forest: readonly CompleteQuestTreeNode[],
  questId: number,
): string[] => {
  const walk = (node: CompleteQuestTreeNode, path: string[]): string[] | null => {
    const next = [...path, node.entry.code]
    if (node.entry.id === questId) return next
    for (const child of node.children) {
      const found = walk(child, next)
      if (found) return found
    }
    return null
  }
  for (const root of forest) {
    const found = walk(root, [])
    if (found) return found
  }
  return []
}
