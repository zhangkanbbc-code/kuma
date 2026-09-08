// 维护者审计判据：真实匹配器由调用方注入；此处不读文件、不写快照、不联网。
// 次数按 desc / memo2 / memo 内每次「…」出现计，同任务重复出现也算；聚合按原文词条。
// 整词命中必须有单个实体覆盖去掉尾部 ×N 后的整词，多个短名拼满仍算部分命中。
export const editDistance = (left, right) => {
  let row = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 0; i < left.length; i += 1) {
    const next = [i + 1]
    for (let j = 0; j < right.length; j += 1) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (left[i] !== right[j] ? 1 : 0)))
    }
    row = next
  }
  return row[right.length]
}

export const auditQuestEntities = (quests, indexes, runtime) => {
  const { cleanQuestText, normalizeTaskEntityText: normalize, taskEntityRawMarks, matchTaskNationalityHits, emphasisMarks, mergeQuestMarks } = runtime
  const domains = { shipNameIndex: 'ship', shipClassIndex: 'shipClass', shipTypeIndex: 'shipType', equipNameIndex: 'equip', itemNameIndex: 'item', mapNameIndex: 'map', equipTypeIndex: 'equipType', missionNameIndex: 'expedition' }
  const aliases = Object.entries(domains).flatMap(([key, kind]) => indexes[key].flatMap((entry) => entry.aliases.map((alias) => ({ kind, id: entry.id, name: entry.name, alias }))))
  const nearestCache = new Map()
  const nearest = (term) => {
    const normalized = normalize(term)
    if (nearestCache.has(normalized)) return nearestCache.get(normalized)
    let best = null
    for (const candidate of aliases) {
      if (best && Math.abs(candidate.alias.length - normalized.length) > best.distance) continue
      const distance = editDistance(normalized, candidate.alias)
      if (!best || distance < best.distance) best = { ...candidate, distance }
    }
    nearestCache.set(normalized, best)
    return best
  }
  const occurrences = []
  for (const [id, quest] of Object.entries(quests)) {
    for (const field of ['desc', 'memo2', 'memo']) {
      const { text, links } = cleanQuestText(quest[field] ?? '')
      const marks = mergeQuestMarks(
        taskEntityRawMarks(indexes, text, quest.code, matchTaskNationalityHits(normalize(text))),
        matchTaskNationalityHits(text).map((hit) => ({ kind: 'nationality', ref: hit.entry.id, start: hit.start, length: hit.length })),
        emphasisMarks(text, links, { isMapId: (mapId) => indexes.mapNameIndex.some((entry) => entry.id === mapId) }).filter((mark) => mark.ref != null),
      )
      for (const match of text.matchAll(/「([^「」\n]+)」/g)) {
        const term = match[1].replace(/\s*[×xｘ＊*]\s*[\d０-９,，]+\s*$/i, '').trim()
        if (!term) continue
        const start = match.index + 1 + match[1].indexOf(term)
        const end = start + term.length
        const hits = marks.filter((mark) => mark.start < end && start < mark.start + mark.length)
          .map((mark) => ({ ...mark, text: text.slice(mark.start, mark.start + mark.length) }))
        const status = hits.some((hit) => hit.start <= start && hit.start + hit.length >= end) ? 'matched' : hits.length ? 'partial' : 'unmatched'
        occurrences.push({ questId: Number(id), code: quest.code, field, term, start, status, hits })
      }
    }
  }
  const aggregate = (status) => {
    const byTerm = new Map()
    for (const occurrence of occurrences.filter((row) => row.status === status)) {
      let row = byTerm.get(occurrence.term)
      if (!row) {
        row = { term: occurrence.term, count: 0, codes: [], nearest: status === 'matched' ? null : nearest(occurrence.term), occurrences: [] }
        byTerm.set(row.term, row)
      }
      row.count += 1
      if (!row.codes.includes(occurrence.code)) row.codes.push(occurrence.code)
      row.occurrences.push(occurrence)
    }
    return [...byTerm.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'zh-CN'))
  }
  return {
    summary: { total: occurrences.length, matched: occurrences.filter((row) => row.status === 'matched').length, unmatched: occurrences.filter((row) => row.status === 'unmatched').length, partial: occurrences.filter((row) => row.status === 'partial').length },
    matched: aggregate('matched'), unmatched: aggregate('unmatched'), partial: aggregate('partial'), occurrences,
  }
}
