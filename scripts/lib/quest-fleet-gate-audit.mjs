// 维护者体检的纯函数：只比较门与正文数字，不替代日文原文复核，也不裁决编成规则。
// amount 包括具名、舰种/舰级、any/other 组；上限、自由位和 overlapOk 都可能产生误报。
const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const numberOf = (value) => {
  if (/^\d+$/.test(value)) return Number(value)
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0)
  }
  return digits[value]
}

export const fleetGateBody = (quest) => {
  let text = [quest.desc ?? '', quest.memo2 ?? ''].join(' ').normalize('NFKC')
  // 先消内层再消外层，兼容中文/日文全角括号与嵌套括号；引号不是括号。
  let previous
  do {
    previous = text
    text = text.replace(/\([^()]*\)/g, '')
  } while (text !== previous)
  return text.replace(/\s+/g, ' ').trim()
}

export const auditQuestFleetGates = (quests, trackers) => {
  const rows = []
  for (const [id, tracker] of Object.entries(trackers)) {
    if (!tracker.fleetGoal) continue
    const quest = quests[id] ?? {}
    const body = fleetGateBody(quest)
    const counts = [...body.matchAll(/(\d+|[零〇一二两兩三四五六七八九十]+)\s*[艘只隻名](?:以上)?/g)]
      .map((match) => ({ value: numberOf(match[1]), index: match.index, text: match[0] }))
      .filter((match) => Number.isFinite(match.value))
    const maximum = counts.reduce((best, count) => !best || count.value > best.value ? count : best, null)
    const groups = tracker.fleetGoal.groups.map(({ label, amount }) => ({ label, amount }))
    const requiredShips = groups.reduce((sum, group) => sum + group.amount, 0)
    const status = !maximum ? 'noCount' : requiredShips < maximum.value ? 'suspicious' : 'clear'
    const start = Math.max(0, (maximum?.index ?? 0) - 60)
    const end = Math.min(body.length, start + 220)
    rows.push({
      questId: Number(id), code: quest.code ?? String(id), source: tracker.source,
      approx: Boolean(tracker.approx), status, requiredShips, maxTextShips: maximum?.value ?? null,
      groups, excerpt: `${start ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`,
    })
  }
  return {
    summary: {
      total: rows.length,
      sources: Object.fromEntries([...new Set(rows.map((row) => row.source))].sort()
        .map((source) => [source, rows.filter((row) => row.source === source).length])),
      clear: rows.filter((row) => row.status === 'clear').length,
      noCount: rows.filter((row) => row.status === 'noCount').length,
      suspicious: rows.filter((row) => row.status === 'suspicious').length,
    },
    suspicious: rows.filter((row) => row.status === 'suspicious'),
    rows,
  }
}
