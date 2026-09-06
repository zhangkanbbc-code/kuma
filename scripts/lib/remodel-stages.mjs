import { tableGrid, htmlText } from '../map-intel.mjs'
import { remodelCycles } from '../../src/shared/remodel-stage.ts'
import { nativeFields, reconcileRemodel, resolveMaterial } from './remodel-fact-audit.mjs'

// 维护者画面裁定仅覆盖指定边、档和素材；上游原值保留在冲突与来源错误记录中。
export const MAINTAINER_REMODEL_CORRECTIONS = [{
  edge: '502→507', stage: 'first', materials: { 'useitem:2': 40, 'useitem:3': 35 }, basis: 'maintainer',
  evidence: '公开游戏改装画面（2026-09 核）显示 新型兵装資材1／高速建造材40／開発資材35，与舰娘百科模块、zekamashi 同值',
  date: '2026-09-06',
}]

export const classifyRemodelStage = label => {
  const text = htmlText(label ?? '', ' ')
  const first = /初回|初次|首次|第一次/.test(text)
  const convert = /2回目以降|２回目以降|二次以后|再次|再度|往复|换装|コンバート|转换改装|戻す場合/.test(text)
  return first === convert ? 'unknown' : first ? 'first' : 'convert'
}

// 表头按列判档，不能把同一行两列取最大值，也不能用位置猜初回。
export const parseRemodelStageColumns = (html, raw) => {
  const out = []
  for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const grid = tableGrid(match[0])
    if (grid.length < 2) continue
    for (let row = 1; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const text = grid[row][col]?.text ?? ''
        if (!/(?:材|資源|設計図|详报|詳報|缶|勲章).*?[x×]\s*\d/.test(text)) continue
        const materials = {}
        if (raw) for (const match of text.matchAll(/([^\s+＋・x×]+)\s*[x×]\s*(\d+)/g)) {
          const material = resolveMaterial(match[1], raw)
          if (!material) throw new Error(`分档表素材未解号：${match[1]}`)
          materials[`${material.kind}:${material.id}`] = Number(match[2])
        }
        const header = grid.slice(0, row).map(cells => cells[col]?.text ?? '').reverse()
          .find(label => /初回|初次|首次|第一次|2回目|２回目|二次以后|再次|再度|往复|换装|コンバート|转换改装/.test(label))
        out.push({ stage: classifyRemodelStage(header), raw: text, materials })
      }
    }
  }
  return out
}

// 此处只转换表格语法；rowspan/colspan 交给既有 tableGrid，形态编号由 CC 包解成 mstId。
export function parseCcConversionTable(text, kc, raw) {
  const section = text.match(/==可以进行转换改装的舰船==([\s\S]*?)(?=\n==[^=]|$)/)?.[1]
  if (!section) throw new Error('CC 转换改装表标题漂移')
  const html = section.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b ?? a)
    .split(/\n\|-/).map(row => '<tr>' + row.split('\n').filter(line => /^[!|](?![{}-])/.test(line)).map(line => {
      const body = line.slice(1), attr = body.match(/^\s*((?:(?:rowspan|colspan)="\d+"\s*)+)\|([\s\S]*)$/)
      return `<td ${attr?.[1] ?? ''}>${attr?.[2] ?? body}</td>`
    }).join('') + '</tr>').join('')
  const grid = tableGrid(`<table>${html}</table>`), out = []
  const byNo = new Map(Object.entries(kc).map(([no, ship]) => [String(Number(no)), Number(ship.ID)]))
  for (const row of grid.slice(2)) {
    let from = byNo.get(row[0]?.text.trim()), to = byNo.get(row[5]?.text.trim())
    if (row[4]?.text.trim() === '←') [from, to] = [to, from]
    if (!(from > 0 && to > 0)) throw new Error(`CC 转换表形态未解号：${row.map(c => c?.text).join('/')}`)
    const cost = row[10]?.text ?? ''
    const materials = {}
    for (const token of cost.split(/[・+＋]/)) {
      if (!token.trim() || token.trim() === '-') continue
      const match = token.trim().match(/^(.+?)(?:[x×*]?\s*(\d+))?$/)
      const material = resolveMaterial(match[1], raw)
      if (!material) throw new Error(`CC 转换表素材未解号：${token}`)
      materials[`${material.kind}:${material.id}`] = Number(match[2] ?? 1)
    }
    out.push({ edge: `${from}→${to}`, stage: 'convert', site: 'kcwikiTable', materials, raw: cost,
      evidence: 'https://zh.kcwiki.cn/wiki/改造#可以进行转换改装的舰船' })
  }
  return out
}

// wikiwiki 主记录和附加边分别解析，不能先按边合并后再找 raw 判档。
export function wikiwikiStageObservations(wiki, raw) {
  const observations = [], corrections = [], unresolved = []
  for (const [target, entry] of Object.entries(wiki)) {
    for (const [index, detail] of [entry, ...(entry.edges ?? [])].entries()) {
      if (!detail.needs?.length) continue
      let from = Number(detail.fromShipId)
      if (!from) {
        const candidates = raw.api_mst_ship.filter(s => Number(s.api_aftershipid) === Number(target))
        if (candidates.length !== 1) throw new Error('wikiwiki 无法唯一确定来路：' + target)
        from = candidates[0].api_id
      }
      const edge = from + '→' + target
      if (Number(raw.api_mst_ship.find(s => s.api_id === from)?.api_aftershipid) !== Number(target)) throw new Error('wikiwiki 来路与主数据不符：' + edge)
      const stage = index === 0 ? 'first' : detail.source === 'footnote' ? 'convert' : 'unknown'
      const materials = {}
      for (const need of detail.needs ?? []) {
        const resolved = need.id && ['useitem', 'slotitem'].includes(need.kind)
          ? { kind: need.kind, id: need.id } : resolveMaterial(need.nameJp ?? need.name, raw)
        const oldIdentity = need.kind + ':' + (need.id ?? need.nameJp)
        const identity = resolved ? resolved.kind + ':' + resolved.id : oldIdentity
        materials[identity] = need.count
        if (!resolved) unresolved.push({ site: 'wikiwiki', edge, identity, count: need.count })
        if (resolved && oldIdentity.startsWith('unknown:')) corrections.push({ type: 'material', site: 'wikiwiki', edge, oldEdge: edge, newEdge: edge, stage, oldIdentity, newIdentity: identity, count: need.count, basis: resolved.basis })
      }
      observations.push({ site: 'wikiwiki', edge, stage, materials, raw: detail.raw ?? '',
        evidence: 'https://wikiwiki.jp/kancolle/' + encodeURIComponent(entry.page ?? '改造'),
        basis: index === 0 ? 'targetShipId 主条目 → first' : 'edges[source=' + detail.source + ']' + (stage === 'convert' ? ' → convert' : '：需与已分档来源对齐'),
        structure: index === 0 ? 'main' : detail.source })
    }
  }
  return { observations, corrections, unresolved }
}

export function reconcileStagedRemodel(kc, wiki, raw, tableText, supplements = [], stageTables = [], pageRows = []) {
  const legacy = reconcileRemodel(kc, {}, raw, supplements)
  const parsedWiki = wikiwikiStageObservations(wiki, raw)
  const edges = raw.api_mst_shipupgrade.filter(r => r.api_current_ship_id > 0).map(r => [r.api_current_ship_id, r.api_id])
  const groups = remodelCycles(edges), observations = [], unknown = [], sourceErrors = []
  const cyclicEdge = edge => { const [from, to] = edge.split('→').map(Number); return groups.some(g => g.includes(from) && g.includes(to)) }
  const pending = []
  for (const row of parsedWiki.observations) (row.stage === 'unknown' ? pending : observations).push(row)
  for (const row of parseCcConversionTable(tableText, kc, raw)) {
    // 施工单明确裁定三隈回程40/15；缓存自身正向40/15、回程30/45，保留原始行而不伪称解析器倒箭头。
    if ((row.edge === '502→507' && row.materials['useitem:2'] === 40 && row.materials['useitem:3'] === 15) ||
      (row.edge === '507→502' && row.materials['useitem:2'] === 30 && row.materials['useitem:3'] === 45)) {
      sourceErrors.push({ ...row, reason: '总表来源行错误：正向格放入脚注回程40/15，回程格30/45不符合本单回程裁定；不参加数值合并' })
    } else observations.push({ ...row, basis: '可以进行转换改装的舰船段落／方向列 → convert' })
  }
  for (const { html, ...source } of stageTables) for (const row of parseRemodelStageColumns(html, raw)) {
    (row.stage === 'unknown' ? pending : observations).push({ ...source, ...row })
  }
  // index/chart 附加边不是主条目；仅用同边百科明确往复列核对，绝不凭回程方向补初次。
  const auxiliaryWiki = pending.filter(row => row.site === 'wikiwiki')
  const unlabelledTables = pending.filter(row => row.site !== 'wikiwiki')
  pending.length = 0
  pending.push(...unlabelledTables)
  for (const row of auxiliaryWiki) {
    const peer = observations.find(o => o.site === 'kcwikiTable' && o.edge === row.edge && o.stage === 'convert')
    if (peer && Object.keys(row.materials).length && Object.entries(row.materials).every(([id, n]) => peer.materials[id] === n)) observations.push({ ...row, stage: 'convert', basis: row.basis + '；同边百科往复列逐项相等' })
    else unknown.push(row)
  }
  for (const [edge, materials] of Object.entries(legacy.sources.kcwiki)) {
    const from = Number(edge.split('→')[0])
    const text = Object.values(kc).find(s => Number(s.ID) === from)?.改造?.图纸 ?? ''
    pending.push({ site: 'kcwiki', edge, stage: classifyRemodelStage(text), materials, raw: text,
      evidence: 'https://zh.kcwiki.cn/wiki/模块:舰娘数据' })
  }
  pending.push(...pageRows)
  // 单列整列对齐同边 wikiwiki：共有素材全部相等才匹配；来源未提供的素材记缺项。
  // 两档同值可分别佐证两档；不能把同一列的素材拆到不同档去消掉冲突。
  for (const row of pending) {
    if (row.stage !== 'unknown') { observations.push(row); continue }
    const peers = observations.filter(o => o.site === 'wikiwiki' && o.edge === row.edge && Object.keys(row.materials).some(id => o.materials[id] !== undefined))
    const candidates = [...new Set(peers.map(o => o.stage))]
    const matches = candidates.filter(stage => peers.filter(o => o.stage === stage).every(o =>
      Object.entries(row.materials).every(([id, n]) => o.materials[id] === undefined || o.materials[id] === n)))
    const stages = matches.length ? matches : candidates.length === 1 ? candidates : !cyclicEdge(row.edge) ? ['first'] : ['unknown']
    for (const stage of stages) (stage === 'unknown' ? unknown : observations).push({ ...row, stage,
      basis: matches.length ? '与同边 wikiwiki ' + stage + ' 共有素材全相等，整列归档；未提供素材记来源缺项' : candidates.length === 1 ? '同边 wikiwiki 唯一候选档；数值不等，整列进入冲突核对' : '无同边可定档值；非循环边仅初次，循环边不猜档' })
  }
  // 初次画面裁定不改变 f6a39b7 往复35/40；不把此保留值当成来源已证明分档。
  observations.push({ site: 'preserved', edge: '502→507', stage: 'convert', materials: { 'useitem:3': 35, 'useitem:2': 40 },
    evidence: ['https://zh.kcwiki.cn/wiki/模块:舰娘数据', 'https://zekamashi.net/kancolle-kouryaku/singatakoukuu/'], basis: '本单授权保留 f6a39b7 裁决前往复35/40；zekamashi仅出处，未出网核文' })
  const data = {}, conflicts = [], missing = [], evidence = []
  for (const edge of [...new Set(observations.map(r => r.edge))].sort()) {
    const [from, to] = edge.split('→').map(Number)
    const native = raw.api_mst_shipupgrade.find(r => r.api_current_ship_id === from && r.api_id === to)
    for (const stage of ['first', 'convert']) {
      // 来源即使写了往复档，单向边也不能生成该档；两端须同属主数据循环。
      if (stage === 'convert' && !cyclicEdge(edge)) continue
      const rows = observations.filter(r => r.edge === edge && r.stage === stage)
      for (const identity of [...new Set(rows.flatMap(r => Object.keys(r.materials)))].sort()) {
        const values = {}
        for (const row of rows.filter(r => r.materials[identity] !== undefined)) {
          let key = row.site
          for (let n = 2; Object.hasOwn(values, key) && values[key] !== row.materials[identity]; n++) key = row.site + '#' + n
          values[key] = row.materials[identity]
        }
        const sites = Object.keys(values)
        if (!sites.includes('wikiwiki') || !sites.some(s => s.startsWith('kcwiki'))) missing.push({ edge, stage, identity, values: { ...values } })
        const field = nativeFields[identity]
        if (stage === 'first' && native && Object.hasOwn(native, field)) values.api = native[field]
        const sources = rows.filter(r => r.materials[identity] !== undefined).map(({ site, evidence, basis, raw }) => ({ site, evidence, basis, raw }))
        const correction = MAINTAINER_REMODEL_CORRECTIONS.find(r => r.edge === edge && r.stage === stage && Object.hasOwn(r.materials, identity))
        const resolution = correction && { status: '已裁（画面证据）', count: correction.materials[identity],
          basis: correction.basis, evidence: correction.evidence, date: correction.date }
        if (new Set(Object.values(values)).size > 1) {
          conflicts.push({ edge, stage, identity, values, sources: [...sources], ...(resolution ? { resolution } : {}) })
          if (!resolution) continue
        }
        if (correction) sources.push({ site: 'maintainer', basis: correction.basis, evidence: correction.evidence, date: correction.date })
        evidence.push({ edge, stage, identity, sources, ...(stage === 'first' && native && Object.hasOwn(native, field) ? { apiCheck: { field, count: native[field] } } : {}) })
        if (native && Object.hasOwn(native, field)) continue
        ;((data[edge] ??= { stages: {} }).stages[stage] ??= {})[identity] = resolution?.count ?? Object.values(values)[0]
      }
    }
  }
  for (const correction of MAINTAINER_REMODEL_CORRECTIONS) {
    for (const row of observations.filter(r => r.edge === correction.edge && r.stage === correction.stage)) {
      const materials = Object.fromEntries(Object.entries(row.materials).filter(([id, count]) =>
        Object.hasOwn(correction.materials, id) && count !== correction.materials[id]))
      if (Object.keys(materials).length) sourceErrors.push({ ...row, materials,
        reason: '来源错误：与公开游戏改装画面（2026-09 核）裁定不符；仅订正502→507初次高建40／开发35',
        resolution: { basis: correction.basis, evidence: correction.evidence, date: correction.date } })
    }
  }
  const corrections = [...legacy.corrections.map(r => ({ ...r, stage: [...observations, ...unknown].find(o => o.edge === r.edge && o.site === r.site && o.materials[r.newIdentity] !== undefined)?.stage ?? 'unknown' })), ...parsedWiki.corrections]
  const direct = edges.filter(([a, b]) => a < b && edges.some(([c, d]) => c === b && d === a))
  return { data, conflicts, missing, corrections, unknown, observations, evidence, groups, direct, sourceErrors, unresolved: [...legacy.unresolved, ...parsedWiki.unresolved] }
}
