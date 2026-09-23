// 维护者订正保留来源与日期；账本校对只返回报告，不写入订正或事实层。
export const MAINTAINER_EXPEDITION_CORRECTIONS = [{
  id: 'D1', field: 'rewards.shipExp', value: 45, basis: 'maintainer',
  evidence: 'wikiwiki 45；en.kancollewiki.net/Expeditions 页（维护者核 2026-09-06）45；kcwiki 40 为来源错误；narublo 实测页 35 为提督经验',
  date: '2026-09-06',
}]

/** events 原始报文；普通成功只取非旗舰经验，不反推旗舰或大成功倍率。パターン2 随机使舰娘经验翻倍，与大成功无关，核对时接受资料值的两倍。 */
export const auditExpeditionExperience = (events, current, wiki) => {
  const names = new Map(Object.entries(current).map(([id, entry]) => [entry.nameJp, id]))
  const rows = new Map(), unknownNames = new Map()
  let total = 0
  for (const event of events) {
    if (event.path !== '/kcsapi/api_req_mission/result') continue
    total++
    const response = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
    const body = response?.api_data
    if (response?.api_result !== 1 || !body) throw new Error('远征结算报文缺少成功响应或 api_data')
    const id = names.get(body.api_quest_name)
    if (!id) {
      unknownNames.set(body.api_quest_name, (unknownNames.get(body.api_quest_name) ?? 0) + 1)
      continue
    }
    const row = rows.get(id) ?? {
      id, name: body.api_quest_name, total: 0, success: 0, great: 0, failed: 0,
      samples: 0, ships: 0, observed: null, observedAt: null,
      current: current[id].rewards?.shipExp ?? null, wikiwiki: wiki[id]?.rewards?.shipExp ?? null,
    }
    rows.set(id, row)
    row.total++
    if (body.api_clear_result === 2) { row.great++; continue }
    if (body.api_clear_result === 0) { row.failed++; continue }
    if (body.api_clear_result !== 1) throw new Error(`远征 ${id} 结算状态未知`)
    row.success++
    // api_ship_id 有 -1 哨兵，api_get_ship_exp 没有：下标 0 即旗舰（×1.5 向下取整）。
    const escorts = Array.isArray(body.api_get_ship_exp) ? body.api_get_ship_exp.slice(1) : []
    if (!escorts.length) continue
    if (escorts.some(value => !Number.isInteger(value) || value < 0)) throw new Error(`远征 ${id} 舰娘经验非法`)
    row.samples++
    row.ships += escorts.length
    const minimum = Math.min(...escorts)
    if (row.observed === null || minimum < row.observed) {
      row.observed = minimum
      row.observedAt = new Date(event.ts).toISOString()
    }
  }
  const expeditions = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  return {
    total, expeditions,
    differences: expeditions.filter(row => row.observed !== null && row.observed !== row.current && (row.current === null || row.observed !== row.current * 2)),
    wikiDifferences: expeditions.filter(row => row.observed !== null && row.observed !== row.wikiwiki && (row.wikiwiki === null || row.observed !== row.wikiwiki * 2)),
    unknownNames: [...unknownNames].map(([name, count]) => ({ name, count })),
  }
}
