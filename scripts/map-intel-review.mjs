import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const fingerprint = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

const layersOf = (map) =>
  map?.nodes
    ? [['常规', map.nodes]]
    : Object.entries(map?.difficulties ?? {}).map(([difficulty, layer]) => [
        difficulty,
        layer.nodes,
      ])

const flattenDrops = (pack) => {
  const out = new Map()
  for (const [map, entry] of Object.entries(pack?.data?.maps ?? {})) {
    for (const [difficulty, nodes] of layersOf(entry)) {
      for (const [node, intel] of Object.entries(nodes ?? {})) {
        for (const ship of intel.ships ?? []) {
          out.set(`${map}|${difficulty}|${node}|${ship.id}`, {
            map,
            difficulty,
            node,
            shipId: ship.id,
            limitedOnly: Boolean(ship.limitedOnly),
            limited: ship.limited ?? null,
            limitedHistory: ship.limitedHistory ?? [],
          })
        }
      }
    }
    // 全难度合算层单独走一个伪难度标签「合算」：它必须进差异报告(否则这一层
    // 增删人工那道闸看不见),但又不能混进甲乙丙丁任何一层的键空间。
    for (const [node, ships] of Object.entries(entry?.allDiffDrops ?? {})) {
      for (const ship of ships ?? []) {
        out.set(`${map}|合算|${node}|${ship.id}`, {
          map,
          difficulty: '合算',
          node,
          shipId: ship.id,
          limitedOnly: false,
          limited: null,
          limitedHistory: [],
        })
      }
    }
  }
  return out
}

// 编成的身份 = 阵形 + 舰名序列。shipIds 是后加的派生字段，不进身份键——
// 否则一次定号入库会让全部两千多套编成同时算「删了又加」，把差异报告冲垮，
// 人工那道闸也就废了。它的变化单独走 changedEnemyCompIds。
const compIdentity = (comp) =>
  JSON.stringify({ formation: comp.formation, ships: comp.ships, phase: comp.phase })

const flattenComps = (pack) => {
  const out = new Map()
  for (const [map, entry] of Object.entries(pack?.data?.maps ?? {})) {
    for (const [difficulty, nodes] of layersOf(entry)) {
      for (const [node, intel] of Object.entries(nodes ?? {})) {
        for (const comp of intel.enemyComps ?? []) {
          const value = { map, difficulty, node, comp }
          out.set(`${map}|${difficulty}|${node}|${compIdentity(comp)}`, value)
        }
      }
    }
  }
  return out
}

// operations 层（机关 / 特效舰 / 友军 / 点位半径）挂在 difficulties[难度].operations 上，
// 与 nodes 平级，不带点位维度——所以它的键空间就是 map|difficulty。
// 这一整层都是铎里玩家直接读到的字，必须进差异报告：2026-08-27 实测，刷新 62 期活动包
// 时 16 个图×难度层的友军编成从零涨到满（当场重放：抹掉再对比，152 条友军的一进一出），
// 而差异摘要打印出来是整排 0——「核对后运行 lodes:map-intel-approve」的人工那道闸
// 对这一整层全程失明。与 changedEnemyCompLabels 那次（08-24 的 29 格深海标注）同族。
const OPERATION_FIELDS = ['gimmicks', 'specialShips', 'friendlyFleets', 'nodeDistances']

const OPERATION_SUMMARY_KEYS = {
  gimmicks: 'changedGimmicks',
  specialShips: 'changedSpecialShips',
  friendlyFleets: 'changedFriendlyFleets',
  nodeDistances: 'changedNodeDistances',
}

// 与 layersOf 同一套分层判据，只是留住整个 layer 而不是只取 nodes。常规图没有
// operations，这里照样给它一个「常规」层：两侧都空就产不出条目，将来真长出来也不会
// 再多一个同类盲区。
const operationLayersOf = (map) =>
  map?.nodes
    ? [['常规', map]]
    : Object.entries(map?.difficulties ?? {}).map(([difficulty, layer]) => [difficulty, layer])

const flattenOperations = (pack) => {
  const out = new Map()
  for (const [map, entry] of Object.entries(pack?.data?.maps ?? {})) {
    for (const [difficulty, layer] of operationLayersOf(entry)) {
      out.set(`${map}|${difficulty}`, { map, difficulty, operations: layer?.operations ?? {} })
    }
  }
  return out
}

// 把一格 operations 数据摊成「身份 → 值」。
// 数组三兄弟（机关 / 特效舰 / 友军）的条目没有天然主键，就拿整条的 JSON 当身份
// ——于是它们只会报新增和删除，改一个字＝删一条加一条，人眼照样看得见；同一层里
// 出现两条一模一样的条目时补个序号，免得后一条被前一条吞掉，计数少算。
// nodeDistances 是 点位→半径 的对象，点位本身就是身份，所以它还能报出「变更」
//（半径从 4 改成 5 是同一个点位的事实变了，不该读成删了 4 又加了 5）。
const operationEntries = (field, value) => {
  const out = new Map()
  if (field === 'nodeDistances') {
    for (const [node, distance] of Object.entries(value ?? {})) out.set(node, distance)
    return out
  }
  const seen = new Map()
  for (const item of value ?? []) {
    const identity = JSON.stringify(item)
    const ordinal = (seen.get(identity) ?? 0) + 1
    seen.set(identity, ordinal)
    out.set(ordinal === 1 ? identity : `${identity}#${ordinal}`, item)
  }
  return out
}

// 报出去的条目要自带点名：半径那一族的值只是个数字，光报「新增 3」等于没报，
// 人核对时还得回头猜是哪个点位。
const operationItem = (field, identity, value) =>
  field === 'nodeDistances' ? { node: identity, distance: value } : value

const diffOperationLayers = (before, after) => {
  const changes = Object.fromEntries(
    OPERATION_FIELDS.map((field) => [OPERATION_SUMMARY_KEYS[field], []]),
  )
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const layer = after.get(key) ?? before.get(key)
    for (const field of OPERATION_FIELDS) {
      const was = operationEntries(field, before.get(key)?.operations?.[field])
      const now = operationEntries(field, after.get(key)?.operations?.[field])
      const added = []
      const removed = []
      const changed = []
      for (const [identity, value] of now) {
        if (!was.has(identity)) {
          added.push(operationItem(field, identity, value))
          continue
        }
        const previous = was.get(identity)
        if (JSON.stringify(previous) !== JSON.stringify(value)) {
          changed.push({ node: identity, before: previous, after: value })
        }
      }
      for (const [identity, value] of was) {
        if (!now.has(identity)) removed.push(operationItem(field, identity, value))
      }
      if (!added.length && !removed.length && !changed.length) continue
      // 摘要按 map+difficulty 计数（一层算一条），细目留在条目里给人核对
      changes[OPERATION_SUMMARY_KEYS[field]].push({
        map: layer.map,
        difficulty: layer.difficulty,
        added,
        removed,
        changed,
      })
    }
  }
  for (const list of Object.values(changes)) {
    list.sort((a, b) =>
      `${a.map}|${a.difficulty}`.localeCompare(`${b.map}|${b.difficulty}`, 'zh-CN'),
    )
  }
  return changes
}

const sortedValues = (values) =>
  [...values].sort((a, b) =>
    `${a.map}|${a.difficulty}|${a.node}|${a.shipId ?? JSON.stringify(a.comp)}`.localeCompare(
      `${b.map}|${b.difficulty}|${b.node}|${b.shipId ?? JSON.stringify(b.comp)}`,
      'zh-CN',
    ),
  )

export const buildMapIntelDiff = (current, candidate) => {
  const beforeDrops = flattenDrops(current)
  const afterDrops = flattenDrops(candidate)
  const beforeComps = flattenComps(current)
  const afterComps = flattenComps(candidate)
  const addedDrops = []
  const removedDrops = []
  const changedDrops = []
  const pendingDrops = []

  for (const [key, value] of afterDrops) {
    const before = beforeDrops.get(key)
    if (!before) {
      addedDrops.push(value)
      continue
    }
    if (JSON.stringify(before) === JSON.stringify(value)) continue
    changedDrops.push({ before, after: value })
    if (
      (before.limited?.status ?? 'active_confirmed') === 'active_confirmed' &&
      value.limited?.status === 'end_pending'
    ) {
      pendingDrops.push(value)
    }
  }
  for (const [key, value] of beforeDrops) {
    if (!afterDrops.has(key)) removedDrops.push(value)
  }

  const addedEnemyComps = []
  const removedEnemyComps = []
  const changedEnemyCompIds = []
  const changedEnemyCompLabels = []
  for (const [key, value] of afterComps) {
    const before = beforeComps.get(key)
    if (!before) {
      addedEnemyComps.push(value)
      continue
    }
    // 同一套编成，只是定号结果变了：单独列出来，且要能看出每一位是从什么变成什么
    const wasIds = JSON.stringify(before.comp.shipIds ?? null)
    const nowIds = JSON.stringify(value.comp.shipIds ?? null)
    if (wasIds !== nowIds) {
      changedEnemyCompIds.push({
        map: value.map,
        difficulty: value.difficulty,
        node: value.node,
        ships: value.comp.ships,
        before: before.comp.shipIds ?? null,
        after: value.comp.shipIds ?? null,
      })
    }
    // 标注文本变了也要单独列。labels 同样不进身份键（否则改一个字就成了「删了又加」），
    // 但它**是玩家直接读到的那行字**——2026-08-24 实测：转写台账改掉 29 格深海标注，
    // 差异摘要却整排是 0，人工那道闸对一次玩家可见的文案改动全程失明。
    const wasLabels = JSON.stringify(before.comp.labels ?? null)
    const nowLabels = JSON.stringify(value.comp.labels ?? null)
    if (wasLabels !== nowLabels) {
      changedEnemyCompLabels.push({
        map: value.map,
        difficulty: value.difficulty,
        node: value.node,
        ships: value.comp.ships,
        before: before.comp.labels ?? null,
        after: value.comp.labels ?? null,
      })
    }
  }
  for (const [key, value] of beforeComps) {
    if (!afterComps.has(key)) removedEnemyComps.push(value)
  }

  const beforeMaps = new Set(Object.keys(current?.data?.maps ?? {}))
  const afterMaps = new Set(Object.keys(candidate?.data?.maps ?? {}))
  const addedMaps = [...afterMaps].filter((map) => !beforeMaps.has(map)).sort()
  const removedMaps = [...beforeMaps].filter((map) => !afterMaps.has(map)).sort()
  const changes = {
    addedMaps,
    removedMaps,
    addedDrops: sortedValues(addedDrops),
    removedDrops: sortedValues(removedDrops),
    changedDrops: changedDrops.sort((a, b) =>
      `${a.after.map}|${a.after.difficulty}|${a.after.node}|${a.after.shipId}`.localeCompare(
        `${b.after.map}|${b.after.difficulty}|${b.after.node}|${b.after.shipId}`,
        'zh-CN',
      ),
    ),
    pendingDrops: sortedValues(pendingDrops),
    addedEnemyComps: sortedValues(addedEnemyComps),
    removedEnemyComps: sortedValues(removedEnemyComps),
    changedEnemyCompIds: sortedValues(changedEnemyCompIds),
    changedEnemyCompLabels: sortedValues(changedEnemyCompLabels),
    ...diffOperationLayers(flattenOperations(current), flattenOperations(candidate)),
  }
  return {
    generatedAt: new Date().toISOString(),
    baseFingerprint: fingerprint(current),
    candidateFingerprint: fingerprint(candidate),
    summary: Object.fromEntries(
      Object.entries(changes).map(([key, value]) => [key, value.length]),
    ),
    changes,
  }
}

export const candidatePaths = (output) => {
  const directory = path.dirname(output)
  const reviewDirectory =
    path.basename(directory) === 'lodes'
      ? path.join(path.dirname(directory), 'review')
      : path.join(directory, 'review')
  return {
    candidate: path.join(reviewDirectory, 'map-intel.candidate.json'),
    report: path.join(reviewDirectory, 'map-intel.diff.json'),
  }
}

export const assertNoPendingMapIntelCandidate = (output, force = false) => {
  if (force) return
  const { report } = candidatePaths(output)
  if (!existsSync(report)) return
  const previous = JSON.parse(readFileSync(report, 'utf8'))
  if (!previous.approvedAt) {
    throw new Error('已有未批准的 map-intel 候选；请先审核批准，或用 --force 明确覆盖')
  }
}

export const stageMapIntelCandidate = (output, current, candidate) => {
  const files = candidatePaths(output)
  const report = buildMapIntelDiff(current, candidate)
  mkdirSync(path.dirname(files.candidate), { recursive: true })
  writeFileSync(files.candidate, JSON.stringify(candidate, null, 2))
  writeFileSync(files.report, JSON.stringify(report, null, 2))
  console.log(`[lodes] 候选包：${files.candidate}`)
  console.log(`[lodes] 差异报告：${files.report}`)
  console.log(`[lodes] 差异摘要：${JSON.stringify(report.summary)}`)
  console.log('[lodes] 核对后运行 npm run lodes:map-intel-approve')
  return report
}

export const approveMapIntelCandidate = (output) => {
  const files = candidatePaths(output)
  const current = JSON.parse(readFileSync(output, 'utf8'))
  const candidate = JSON.parse(readFileSync(files.candidate, 'utf8'))
  const report = JSON.parse(readFileSync(files.report, 'utf8'))
  if (fingerprint(current) !== report.baseFingerprint) {
    throw new Error('正式包已在候选生成后发生变化；拒绝批准过期候选，请重新刷新')
  }
  if (fingerprint(candidate) !== report.candidateFingerprint) {
    throw new Error('候选包与差异报告不一致；拒绝批准')
  }
  writeFileSync(output, JSON.stringify(candidate))
  report.approvedAt = new Date().toISOString()
  writeFileSync(files.report, JSON.stringify(report, null, 2))
  console.log(`[lodes] 已批准候选：${output}`)
  console.log(`[lodes] 已留存差异报告：${files.report}`)
  return report
}
