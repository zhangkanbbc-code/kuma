import { htmlText, shipMatcher } from '../map-intel.mjs'

export const FRIENDLY_FLEET_NOTES = [
  '本队 · 强友军', '本队 · 普通友军', '先遣队 · 强友军', '先遣队 · 普通友军',
]

const normalizeFriendlyNote = (note) => {
  if (FRIENDLY_FLEET_NOTES.includes(note)) return note
  const match = typeof note === 'string' && note.match(/^(本队|先遣队) · 「(强友军|普通友军)」枠$/)
  return match ? `${match[1]} · ${match[2]}` : null
}

// 排序保留重复 id：这是多重集合，不能用 Set，也不能按旗舰或舰名近似匹配。
const fleetFingerprint = (fleet) => JSON.stringify(fleet.ships.map((ship) => ship.id).sort((a, b) => a - b))

// 仅订正参考侧指纹；保留两站原始编成，不能作为全局舰名或形态别名。
const REFERENCE_SHIP_CORRECTIONS = [{
  event: '反撃！第三十一戦隊の戦い', map: '62-3', from: 692, to: 628,
  evidence: '战斗报文实测（维护者核 2026-09-06）：South Dakota改/Washington改/Fletcher改 Mod.2；mstId 628',
  date: '2026-09-06',
}]

// 只把维护者对照得出的四种标签写入副本；上游编成、原始 note 与难度留在报告里。
export const tagEventFriendlyFleets = (input, mapIntel) => {
  const data = structuredClone(input)
  const report = {}
  for (const [map, entry] of Object.entries(data.maps)) {
    const reference = mapIntel.data.maps[map]
    const corrections = new Map(REFERENCE_SHIP_CORRECTIONS
      .filter((one) => one.event === reference?.event?.name && one.map === map)
      .map((one) => [one.from, one.to]))
    const index = new Map()
    for (const [difficulty, layer] of Object.entries(reference?.difficulties ?? {})) {
      for (const fleet of layer.operations?.friendlyFleets ?? []) {
        if (!fleet.ships.length || (typeof fleet.note === 'string' && fleet.note.includes('无友军来援'))) continue
        const fingerprint = fleetFingerprint({
          ships: fleet.ships.map((ship) => ({ id: corrections.get(ship.id) ?? ship.id })),
        })
        if (!index.has(fingerprint)) index.set(fingerprint, [])
        index.get(fingerprint).push({ difficulty, fleet, note: normalizeFriendlyNote(fleet.note) })
      }
    }
    const summary = {
      total: entry.friendlyFleets.length, matched: 0, tagged: 0,
      unmatched: [], conflicts: [], invalidNotes: [], extra: [], flagshipDifferences: [], strengthDifferences: [],
    }
    const fingerprints = new Set(entry.friendlyFleets.map(fleetFingerprint))
    for (const [fingerprint, rows] of index) {
      const details = {
        ships: rows[0].fleet.ships,
        notes: [...new Set(rows.map((row) => row.fleet.note ?? null))],
        difficulties: [...new Set(rows.map((row) => row.difficulty))],
      }
      if (!fingerprints.has(fingerprint)) summary.extra.push(details)
      if (rows.some((row) => row.note === null)) summary.invalidNotes.push(details)
    }
    for (const fleet of entry.friendlyFleets) {
      delete fleet.note
      const rows = index.get(fleetFingerprint(fleet))
      if (!rows) {
        summary.unmatched.push({ ships: fleet.ships })
        continue
      }
      summary.matched++
      const differentFlagships = [...new Set(rows.map((row) => row.fleet.ships[0].id))]
        .filter((id) => id !== fleet.ships[0].id)
      if (differentFlagships.length) summary.flagshipDifferences.push({ ships: fleet.ships, differentFlagships })
      // 先在每个难度内取现行（本队）表，再比较难度间标签；不能跨难度覆盖。
      const byDifficulty = new Map()
      for (const row of rows) {
        if (!byDifficulty.has(row.difficulty)) byDifficulty.set(row.difficulty, [])
        byDifficulty.get(row.difficulty).push(row)
      }
      const selected = []
      const strengthDifferences = []
      for (const [difficulty, candidates] of byDifficulty) {
        const main = candidates.filter((row) => typeof row.fleet.note === 'string' && row.fleet.note.startsWith('本队'))
        const advance = candidates.filter((row) => row.note?.startsWith('先遣队'))
        if (main.some((current) => current.note && advance.some((previous) =>
          current.note.split(' · ')[1] !== previous.note.split(' · ')[1]))) {
          strengthDifferences.push(difficulty)
        }
        selected.push(...(main.length ? main : candidates))
      }
      if (strengthDifferences.length) summary.strengthDifferences.push({
        ships: fleet.ships, difficulties: strengthDifferences,
        notes: [...new Set(rows.filter((row) => strengthDifferences.includes(row.difficulty))
          .map((row) => row.fleet.note ?? null))],
      })
      const notes = new Set(selected.map((row) => row.note ?? row.fleet.note ?? null))
      if (notes.size > 1) {
        summary.conflicts.push({ ships: fleet.ships, notes: [...notes] })
        continue
      }
      if (selected.some((row) => row.note === null)) continue
      fleet.note = selected[0].note
      summary.tagged++
    }
    report[map] = summary
  }
  return { data, report }
}

// 2026-09-06：友军节只有整图点位与逐舰卡片，没有逐组波次、强弱或难度标签。
// 名字用既有匹配器，但单舰必须完整命中，不能把「某舰改」退成「某舰」。
export const parseEventFriendlyFleets = (html, shipsPack, mapAreaId, masterNames = []) => {
  const heading = /<h2\b[^>]*>[\s\S]*?<\/h2>/gi
  const start = [...html.matchAll(heading)].find((m) => htmlText(m[0]).startsWith('友军舰队'))
  if (!start) throw new Error('找不到友军舰队节')
  const end = html.indexOf('<h2', start.index + start[0].length)
  const section = html.slice(start.index, end < 0 ? undefined : end)
  const matchShips = shipMatcher(shipsPack, masterNames)
  const maps = {}
  const unresolved = []
  for (const table of section.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const title = htmlText(table[0].match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1])
    const point = title.match(/^E(\d+)-([A-Z]+\d*)点\(P(\d+) Boss\)友军配置$/)
    if (!point) throw new Error(`友军表头无法解析：${title}`)
    const map = `${mapAreaId}-${point[1]}`
    if (maps[map]) throw new Error(`重复的友军海图：${map}`)
    const friendlyFleets = table[0].split(/<div\s+class="yjBox">/).slice(1).map((box) => {
      const ships = box.split(/<div\s+class="yjItem">/).slice(1).map((item) => {
        const name = htmlText(item.match(/<div\s+class="left">([\s\S]*?)<\/div>/)?.[1])
        if (!name) throw new Error(`${map} 友军舰名为空`)
        const level = htmlText(item.match(/<span\s+class="level">([\s\S]*?)<\/span>/)?.[1])
        if (level && !/^LV\d+$/.test(level)) throw new Error(`${map} 等级无法解析：${level}`)
        const hit = matchShips(name).find((one) => one.at === 0 && one.name === name)
        if (!hit) unresolved.push({ map, name })
        return { ...(hit ? { id: hit.id } : {}), name, ...(level ? { lv: Number(level.slice(2)) } : {}) }
      })
      if (!ships.length || ships.length > 12) throw new Error(`${map} 友军舰数非法：${ships.length}`)
      return { ships }
    })
    if (!friendlyFleets.length || friendlyFleets.length > 100) {
      throw new Error(`${map} 友军组数非法：${friendlyFleets.length}`)
    }
    maps[map] = { point: `${point[2]} 点（P${point[3]} Boss）`, friendlyFleets }
  }
  if (!Object.keys(maps).length) throw new Error('友军舰队节没有编成表')
  return { data: { schemaVersion: 1, maps }, unresolved }
}
