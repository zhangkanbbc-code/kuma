// 执行 ji 的真实消费函数；只替换宿主状态、库存与实体显示。
import { runtimeHost, runProductionSection } from './player-view-runtime.mjs'

export function remodelRuntime(raw, kc, packs, extra = {}, source = 'src/renderer/modules/ji.ts') {
  const host = runtimeHost()
  const upgrades = runProductionSection('src/main/mg/store.ts', "const upgrades: MgState['master']['upgrades'] = {}", 'const bgms:', { body: raw }, 'globalThis.result = upgrades').result
  const ships = raw.api_mst_ship ?? [], items = raw.api_mst_useitem ?? [], equips = raw.api_mst_slotitem ?? []
  const mg = { master: { upgrades, ships: {}, slotitems: Object.fromEntries(equips.map(s => [s.api_id, { name: s.api_name }])) }, ships: {}, slotitems: {} }
  const state = { mg, friendlyShips: new Map(ships.map(s => [s.api_id, s])), useitemMst: new Map(items.map(s => [s.api_id, s])),
    kcwikiByMst: new Map(Object.values(kc).map(s => [s.ID, s])),
    wikiwikiRemodelLode: packs.wikiwiki ?? null, remodelFactsLode: packs.facts ?? null, kcwikiLode: packs.kcwiki ?? null,
    entityNamePlain: (_kind, _id, name) => name, entityTermHtml: (_kind, _id, name) => name,
    elink: (_kind, _id, name) => name, esc: String, useitemCount: () => 0,
    lodeCredit: p => p.name, lodeCreditShort: p => p.name,
    topLevelInstanceOf: () => null, safeEach: () => {}, demandReadyCbs: [], ...extra }
  return host.extract(source, ['needChipsHtml', 'buildRemodelNeeds', 'useitemDemand', 'shipSourceFootHtml'], { masterTs: null, fmtDateTime: String, shipStatsLode: null, ...state }).api
}

export function remodelOutput(runtime, raw, kc, withNames = false) {
  const entries = new Map(Object.values(kc).map(s => [s.ID, s]))
  const pairs = new Set((raw.api_mst_ship ?? []).filter(s => Number(s.api_aftershipid) > 0).map(s => `${s.api_id}→${Number(s.api_aftershipid)}`))
  for (const row of raw.api_mst_shipupgrade ?? []) if (row.api_current_ship_id > 0) pairs.add(`${row.api_current_ship_id}→${row.api_id}`)
  return Object.fromEntries([...pairs].sort().map(edge => {
    const [from, to] = edge.split('→').map(Number)
    return [edge, Object.fromEntries(runtime.needChipsHtml(entries.get(from)?.改造?.图纸, to, from).needs.map(n => [`${n.kind}:${n.id ?? n.name}`, withNames ? { name: n.name, count: n.count } : n.count]))]
  }))
}
