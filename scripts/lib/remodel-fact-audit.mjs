import { kcwikiUpgradeNeedAlias } from '../../src/shared/kcwiki-upgrade.ts'

export const nativeFields = { 'useitem:58': 'api_drawing_count', 'useitem:65': 'api_catapult_count', 'useitem:78': 'api_report_count', 'useitem:77': 'api_aviation_mat_count', 'useitem:94': 'api_arms_mat_count', 'useitem:100': 'api_tech_count', 'slotitem:87': 'api_boiler_count' }

// 2026-09-06 裁定：名称必须能落到主数据；唯一额外日文异体是已核实的「剤」。
export function resolveMaterial(name, raw) {
  const exactName = name === '高速建造剤' ? '高速建造材' : name
  for (const [kind, table] of [['useitem', 'api_mst_useitem'], ['slotitem', 'api_mst_slotitem']]) {
    const found = raw[table].find(row => row.api_name === exactName)
    if (found) return { kind, id: found.api_id, basis: `${table}[api_id=${found.api_id}].api_name=${found.api_name}` }
  }
  const alias = kcwikiUpgradeNeedAlias(name)
  if (alias) {
    const table = alias.kind === 'useitem' ? 'api_mst_useitem' : 'api_mst_slotitem'
    const found = raw[table].find(row => row.api_id === alias.id)
    if (found) return { ...alias, basis: `${table}[api_id=${found.api_id}].api_name=${found.api_name}；kcwiki 别名 ${name}` }
  }
  return null
}

export function reconcileRemodel(kc, wiki, raw, supplements = []) {
  const ships = new Map(raw.api_mst_ship.map(s => [s.api_id, s]))
  const sources = { kcwiki: {}, wikiwiki: {} }, corrections = [], unresolved = [], edgeChecks = []
  function add(site, from, to, need, originalIdentity) {
    const edge = `${from}→${to}`, name = need.nameJp ?? need.name
    const existing = need.id && ['useitem', 'slotitem'].includes(need.kind)
      ? raw[need.kind === 'useitem' ? 'api_mst_useitem' : 'api_mst_slotitem'].find(row => row.api_id === need.id) : null
    const resolved = existing ? { kind: need.kind, id: need.id } : resolveMaterial(name, raw)
    const identity = resolved ? `${resolved.kind}:${resolved.id}` : `unknown:${name}`
    if (!resolved) unresolved.push({ site, edge, identity, count: need.count })
    if (resolved && originalIdentity?.startsWith('unknown:')) corrections.push({ type: 'material', site, edge, oldEdge: edge, newEdge: edge, oldIdentity: originalIdentity, newIdentity: identity, count: need.count, basis: resolved.basis })
    const row = sources[site][edge] ??= {}
    if (row[identity] !== undefined && row[identity] !== need.count) throw new Error(`${site} ${edge} ${identity} 重复数值不一致`)
    row[identity] = need.count
  }
  for (const entry of Object.values(kc)) {
    const from = Number(entry.ID), to = Number(ships.get(from)?.api_aftershipid)
    if (!(to > 0)) continue
    for (const match of String(entry.改造?.图纸 ?? '').matchAll(/([^\sx×]+)\s*[x×]\s*(\d+)/g)) {
      const name = match[1], known = kcwikiUpgradeNeedAlias(name)
      // 旧 kcwiki 别名未识别「改修资材」；记录历史身份而非冒充边修正。
      const original = name === '改修资材' ? `unknown:${name}` : known ? `${known.kind}:${known.id}` : `unknown:${name}`
      add('kcwiki', from, to, { name, count: Number(match[2]) }, original)
    }
  }
  for (const [target, entry] of Object.entries(wiki)) {
    for (const detail of [entry, ...(entry.edges ?? [])]) {
      if (!detail.needs?.length) continue
      const to = Number(target)
      let from = Number(detail.fromShipId)
      if (!from) {
        const candidates = raw.api_mst_ship.filter(s => Number(s.api_aftershipid) === to)
        if (candidates.length !== 1) throw new Error(`wikiwiki ${target} 无法唯一确定来路`)
        from = candidates[0].api_id
      }
      if (Number(ships.get(from)?.api_aftershipid) !== to) throw new Error(`${from}→${to} 与 api_aftershipid 不符，需核实旧边修正`)
      edgeChecks.push({ edge: `${from}→${to}`, basis: `api_mst_ship[api_id=${from}].api_aftershipid=${to}` })
      for (const need of detail.needs) add('wikiwiki', from, to, need, `${need.kind}:${need.id ?? need.nameJp}`)
    }
  }
  for (const row of supplements) add('kcwiki', row.from, row.to, row, null)
  const conflicts = [], missing = [], data = {}
  for (const edge of [...new Set([...Object.keys(sources.kcwiki), ...Object.keys(sources.wikiwiki)])].sort()) {
    const a = sources.kcwiki[edge] ?? {}, b = sources.wikiwiki[edge] ?? {}
    const [from, to] = edge.split('→').map(Number)
    const native = raw.api_mst_shipupgrade.find(row => row.api_current_ship_id === from && row.api_id === to)
    for (const identity of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[identity] !== undefined && b[identity] !== undefined && a[identity] !== b[identity]) {
        conflicts.push({ edge, identity, kcwiki: a[identity], wikiwiki: b[identity] }); continue
      }
      if (a[identity] === undefined || b[identity] === undefined) missing.push({ edge, identity, site: a[identity] === undefined ? 'wikiwiki' : 'kcwiki', count: a[identity] ?? b[identity] })
      // API 已有的字段不进入事实包，包括 API 明确给出的零。
      if (native && Object.hasOwn(native, nativeFields[identity])) continue
      ;(data[edge] ??= {})[identity] = a[identity] ?? b[identity]
    }
  }
  return { data, conflicts, missing, corrections, unresolved, edgeChecks, sources }
}

export function remodelDifferences(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(edge =>
    [...new Set([...Object.keys(before[edge] ?? {}), ...Object.keys(after[edge] ?? {})])].sort().flatMap(identity => {
      const oldValue = before[edge]?.[identity] ?? null, newValue = after[edge]?.[identity] ?? null
      return oldValue === newValue ? [] : [{ edge, identity, oldValue, newValue }]
    }))
}

export function remodelViewDifferences(before, after) {
  const flatten = view => Object.fromEntries(Object.entries(view).map(([edge, needs]) => [edge,
    Object.fromEntries(Object.entries(needs).flatMap(([identity, value]) => Object.entries(value).map(([field, v]) => [`${identity}/${field}`, v])))]))
  return remodelDifferences(flatten(before), flatten(after)).map(row => {
    const slash = row.identity.lastIndexOf('/')
    return { ...row, identity: row.identity.slice(0, slash), field: row.identity.slice(slash + 1) }
  })
}
