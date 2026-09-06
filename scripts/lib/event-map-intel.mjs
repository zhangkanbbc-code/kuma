import { htmlText, tableGrid, shipMatcher } from '../map-intel.mjs'
import { parseKcwikiMapPage } from './kcwiki-map.mjs'
import { splitEventDifficultyTabs, formationIdsOf } from './map-intel-event-comps.mjs'
import { foldCjkVariants } from '../../src/shared/cjk-fold.ts'
import { correctLegacyDropForm } from '../../src/shared/map-drop-corrections.ts'

export const DIFFICULTIES = ['甲', '乙', '丙', '丁']
export const EVENT_DROP_NOTE = '舰娘百科掉落表未分难度，按甲 S 记录'
const clean = (html) => htmlText(html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')).replace(/[\u200e\u200f]/g, '')
const unique = (list) => [...new Set(list)]

// 维护者逐步裁定；不改上游解析原文，也不扩散到其它活动、海图、难度或阶段。
export const MAINTAINER_GIMMICK_CORRECTIONS = ['C2', 'C3'].map((point) => ({
  event: '反撃！第三十一戦隊の戦い', map: '62-1', difficulty: '丙', title: 'E1P1解谜', point,
  step: `${point}点：A胜利 ×1`, basis: 'maintainer',
  evidence: 'https://zekamashi.net/202607-event/dai31sentai-syutugeki-1/；wikiwiki 同值：E1 丙 P1 C2/C3 A胜×1；维护者核 2026-09-06。',
  date: '2026-09-06',
}))

// 在两站对照剔除冲突后应用；步骤来源按完整步骤文本记录，不能把同组 H 也标成订正。
export const correctEventMapGimmicks = (input) => {
  const data = structuredClone(input)
  const corrections = []
  const additions = new Map()
  for (const correction of MAINTAINER_GIMMICK_CORRECTIONS) {
    const map = data.maps[correction.map]
    if (map?.event?.name !== correction.event) continue
    const group = map.difficulties?.[correction.difficulty]?.operations?.gimmicks?.find((g) => g.title === correction.title)
    if (!group) continue
    const previous = group.steps.filter((step) => step.startsWith(`${correction.point}点：`))
    group.steps = group.steps.filter((step) => !previous.includes(step))
    for (const step of previous) if (group.stepSources) delete group.stepSources[step]
    ;(group.stepSources ??= {})[correction.step] = {
      basis: correction.basis, evidence: correction.evidence, date: correction.date,
    }
    additions.set(group, [...(additions.get(group) ?? []), correction.step])
    corrections.push({ ...correction, previous })
  }
  for (const [group, steps] of additions) group.steps.unshift(...steps)
  return { data, corrections }
}

// 奖励裁定独立于上游解析；只补指定难度行中的完整选择组。
export const MAINTAINER_REWARD_CORRECTIONS = [{
  event: '反撃！第三十一戦隊の戦い', map: '62-5', difficulty: '甲', domain: 'rewards',
  after: '【V-156F(SB2U输出型)★+4 / 格纳库增设×4】',
  reward: '【Bofors 12cm单装两用炮★+4 / 格纳库增设×3】', basis: 'maintainer',
  evidence: 'https://zekamashi.net/202607-event/hangeki31sentai-nannido/；乙/丙同型选择组与随包一致；舰娘百科原文的 Bofors 与格纳库增设组缺选择分隔符；统筹方 2026-09-06 核对第三票后裁定为二选一。',
  date: '2026-09-06',
}]

export const correctEventMapRewards = (input) => {
  const data = structuredClone(input)
  const corrections = []
  for (const correction of MAINTAINER_REWARD_CORRECTIONS) {
    const map = data.maps[correction.map]
    if (map?.event?.name !== correction.event) continue
    const row = map[correction.domain]?.find((reward) => reward.scope === correction.difficulty)
    if (!row) continue
    const parts = row.text.split('、').filter((part) => part !== correction.reward)
    const anchor = parts.indexOf(correction.after)
    if (anchor < 0) continue
    const previous = row.text
    parts.splice(anchor + 1, 0, correction.reward)
    row.text = parts.join('、')
    ;(row.rewardSources ??= {})[correction.reward] = {
      basis: correction.basis, evidence: correction.evidence, date: correction.date,
    }
    corrections.push({ ...correction, previous })
  }
  return { data, corrections }
}

// 只枚举叶表，避免页首布局表吞掉嵌套的奖励表；保留字节位置供相邻标题定位。
export const leafTables = (html) => [...html.matchAll(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/gi)]
  .map((m) => ({ html: m[0], at: m.index, grid: tableGrid(m[0]) }))
const headingsBefore = (html, at) => {
  const levels = []
  for (const m of html.slice(0, at).matchAll(/<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    levels[Number(m[1])] = { text: clean(m[2]), end: m.index + m[0].length }
    levels.length = Number(m[1]) + 1
  }
  return levels.filter(Boolean)
}
const section = (html, title) => {
  const heads = [...html.matchAll(/<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/g)]
  const index = heads.findIndex((m) => clean(m[2]) === title)
  if (index < 0) return ''
  const start = heads[index]
  const end = heads.slice(index + 1).find((m) => Number(m[1]) <= Number(start[1]))
  return html.slice(start.index + start[0].length, end?.index ?? html.length)
}

export const eventShipResolver = (shipsPack, masterNames = []) => {
  // 把包中已有中文全名作为同一 ID 的等名入口；不添加手写别名，不作子串解号。
  const aliases = Object.values(shipsPack.data ?? {}).flatMap((s) => [[s.中文名, Number(s.ID)]])
  const names = [...masterNames, ...aliases, ...Object.values(shipsPack.data ?? {}).map((s) => [s.日文名, Number(s.ID)])]
  const match = shipMatcher(shipsPack, names.flatMap(([name, id]) => name ? [[name, id], [foldCjkVariants(name), id]] : []))
  return (name) => {
    // 页面自带的英文消歧括号（光荣(Gloire)）是完整名字，不靠中文简称猜船。
    const explicit = name.match(/\(([A-Za-z][A-Za-z .]+)\)$/)?.[1]
    for (const key of [explicit, name, foldCjkVariants(name)].filter(Boolean)) {
      const hit = match(key).find((one) => one.at === 0 && one.name === key)
      if (hit) return hit.id
    }
    return undefined
  }
}
const linkedShips = (html, resolve, issues, at) => {
  const ships = []
  for (const a of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = clean(a[1])
    if (!label) continue
    const title = a[0].match(/\btitle="([^"]+)"/)?.[1]
    const id = resolve(label) ?? (title ? resolve(htmlText(title)) : undefined)
    if (!id) {
      issues.push({ ...at, kind: 'unresolved-ship', label })
      if (at.domain === 'specialShips') ships.push({ label })
    } else ships.push({ id, label })
  }
  return [...new Map(ships.map((s) => [s.id ?? s.label, s])).values()]
}

export const parseRewards = (html, issues = []) => {
  const start = html.indexOf('>特殊共通奖励<')
  if (start < 0) return []
  const table = leafTables(html.slice(start))[0]
  if (!table) return []
  const rewards = []
  const grid = table.grid
  if (grid[0]?.[0]?.text === '共通' && grid[0][1]?.text) rewards.push({ scope: '共通', text: clean(grid[0][1].html) })
  for (const row of grid) {
    const col = row.findIndex((c) => /^[甲乙丙丁]作战$/.test(c.text))
    if (col < 0 || !row[col + 1]) continue
    const scope = row[col].text[0]
    const text = clean(row[col + 1].html)
    // 缺分隔符的相邻物品不猜选择关系；只剔除含歧义的括号组，别丢其它奖励。
    const parts = text.split('、').filter((part) => {
      if (/Bofors.*格纳库/.test(part) && !/Bofors[^/]*\/[^/]*格纳库/.test(part)) {
        issues.push({ domain: 'rewards', scope, kind: 'ambiguous-choice', text: part })
        return false
      }
      return true
    })
    if (parts.join('、')) rewards.push({ scope, text: parts.join('、') })
  }
  return rewards
}

export const parseGimmicks = (html, no, issues = []) => {
  const out = Object.fromEntries(DIFFICULTIES.map((d) => [d, []]))
  const tables = leafTables(html).filter((t) => /战斗点.*难度/.test(t.grid[0]?.[0]?.text ?? ''))
  for (const table of tables) {
    const heads = headingsBefore(html, table.at)
    const title = heads.map((h) => h.text).filter((t) => /E\dP\d|解谜|削甲/.test(t)).join(' · ')
    const context = clean(html.slice(heads.at(-1)?.end ?? table.at, table.at))
    for (const [i, difficulty] of DIFFICULTIES.entries()) {
      const steps = []
      for (const row of table.grid.slice(1)) {
        const point = clean(row[0]?.html ?? '')
        const raw = row[i + 1]
        const condition = clean(raw?.html ?? '')
        const uncertain = /[?？]|未.*确认|未确定/.test(condition) ||
          (difficulty === '丁' && /不确定丁难度/.test(context) && /^(H|G2)点/.test(point)) ||
          (difficulty !== '甲' && /乙以下.*未确定/.test(context))
        if (no === 4 || !condition || condition === '/' || uncertain) {
          issues.push({ domain: 'gimmicks', title, difficulty, point, kind: no === 4 ? 'excluded-map' : !raw ? 'missing-cell' : uncertain ? 'unconfirmed' : 'blank' })
          continue
        }
        // 条件只保留矩阵事实：点位、胜利等级/空优/到达、次数。
        if (!/^(?:[SAB]胜利(?:及以上)?|(?:空中|航空)优势(?:及以上)?|到达)\s*×\d+$/.test(condition)) {
          issues.push({ domain: 'gimmicks', title, difficulty, point, kind: 'unparsed-condition', text: condition })
          continue
        }
        steps.push(`${point}：${condition}`)
      }
      if (steps.length) out[difficulty].push({ title, steps })
    }
  }
  return out
}

export const parseEventDrops = (html, no, resolve, issues = []) => {
  const nodes = {}
  for (const table of leafTables(section(html, '稀有掉落'))) {
    if (table.grid[0]?.[0]?.text !== '海图') continue
    for (const row of table.grid.slice(1)) {
      if (row[0]?.text !== `E-${no}`) continue
      const node = row[1]?.text.match(/^([A-Z]+\d*)\b/)?.[1]
      if (!node) continue
      const ships = row.slice(2).flatMap((c) => linkedShips(c.html, resolve, issues, { domain: 'drops', node }))
      if (ships.length) nodes[node] = [...new Map(ships.map((s) => [correctLegacyDropForm(s.id), { id: correctLegacyDropForm(s.id) }])).values()]
    }
  }
  return Object.keys(nodes).length ? { difficultyAgnostic: true, sourceNote: EVENT_DROP_NOTE, nodes } : undefined
}

export const parseSpecialShips = (html, resolve, issues = []) => {
  const table = leafTables(section(html, '倍卡情报')).find((t) => /E\d\s*倍卡表/.test(t.grid[0]?.[0]?.text ?? ''))
  if (!table) return []
  const rows = table.grid
  const firstData = rows.findIndex((r) => /^全图/.test(r[0]?.text ?? ''))
  if (firstData < 1) return []
  const headers = rows[firstData - 1]
  const categories = firstData > 2 ? rows[firstData - 2] : []
  const columns = headers.map((cell, i) => unique([categories[i]?.text, cell.text].filter(Boolean)).join(' · ').replace(/作 战/g, '作战'))
  const entries = []
  const rates = new Map()
  let groupSection = false
  let individualSection = false
  const footnotes = rows.filter((r) => /^\[\d\]/.test(r[0]?.text ?? '')).map((r) => r[0].text).join(' ')
  const notesFor = (text) => [...text.matchAll(/\[(\d)\]/g)].map((m) =>
    footnotes.match(new RegExp(`\\[${m[1]}\\] (.*?)(?=\\[\\d\\]|$)`))?.[1]?.trim()).filter(Boolean).join(' ')
  for (const row of rows.slice(firstData)) {
    const cells = [...new Set(row)]
    const lead = row[0]?.text ?? ''
    if (/^削甲/.test(lead)) break
    if (/^分组舰娘/.test(lead)) { groupSection = true; continue }
    if (/^个别舰/.test(lead) && cells.length === 1) { individualSection = true; continue }
    if (/^\[\d\]/.test(lead)) continue
    if (groupSection && cells.some((c) => /<a\b/.test(c.html)) && !/[:：]/.test(cells.at(-1).text)) {
      const group = cells.slice(0, -1).map((c) => clean(c.html)).join(' · ')
      const effect = [group, ...(rates.get(group) ?? [])].join('；')
      for (const s of linkedShips(cells.at(-1).html, resolve, issues, { domain: 'specialShips', group })) entries.push({ ...s, effect })
      continue
    }
    if (groupSection && /全部美国籍舰娘/.test(cells.at(-1)?.text ?? '')) {
      const group = cells.slice(0, -1).map((c) => clean(c.html)).join(' · ')
      entries.push({ label: '全部美国籍舰娘', effect: [group, ...(rates.get(group) ?? [])].join('；') })
      continue
    }
    if (groupSection || individualSection) {
      const body = cells.at(-1)
      const lines = body.html.split(/<br\s*\/?\s*>/i).map(clean)
      for (const line of lines) {
        const m = line.match(/^(.+?)\s*[:：]\s*(.+)$/) ??
          (cells.length === 2 && /全图\s*1\./.test(line) ? [line, clean(cells[0].html), line] : null)
        if (!m) continue
        const id = resolve(m[1].trim())
        if (!id) issues.push({ domain: 'specialShips', kind: 'unresolved-ship', label: m[1] })
        else entries.push({ id, label: m[1].trim(), effect: `${/^全图/.test(lead) ? '全图；' : ''}${m[2]}` })
      }
      continue
    }
    for (let col = 1; col < row.length; col++) {
      const value = clean(row[col].html)
      if (!/^1\.\d+(?:[~～]1\.\d+)?$/.test(value)) continue
      const key = columns[col]
      if (!key) continue
      const scope = clean(row[0].html)
      const note = notesFor(`${headers[col].text} ${row[col].text}`)
      const effect = `${scope} ×${value}${note ? `；${note}` : ''}`
      rates.set(key, [...(rates.get(key) ?? []), effect])
      if (!/组|战队|舰队|部队|乌利西/.test(key)) entries.push({ label: key.replace(/\[\d\]/g, ''), effect })
    }
  }
  return [...new Map(entries.map((e) => [JSON.stringify(e), e])).values()]
}

// 本期文字的点位锚在攻略阶段标题；正则只确认数字，不能从航程图或装备航程倒推。
const DISTANCE_ANCHORS = {
  2: [['E2P1解谜', 'H', /该点航程为(\d+)/], ['E2P1运输', 'P', /该点航程为(\d+)/],
    ['E2P2血条', 'V', /陆航是半径(\d+)/], ['E2P3血条', 'Y', /作战半径为(\d+)/]],
  4: [['E4P3BOSS', 'S', /基地航空队航程需求为?(\d+)/], ['E4P4BOSS', 'X', /基地航空队航程需求为?(\d+)/],
    ['E4P5BOSS', 'Z', /基地航空队航程需求为?(\d+)/]],
  5: [['E5P4道中', 'V', /航程均为(\d+)/], ['E5P4道中', 'ZZ', /航程均为(\d+)/]],
}
export const parseNodeDistances = (html, no, eventPage) => {
  if (eventPage !== '2026年夏季活动' || no === 3) return {}
  const out = {}
  for (const [heading, node, pattern] of DISTANCE_ANCHORS[no] ?? []) {
    const text = clean(section(html, heading))
    const match = text.match(pattern)
    if (match) out[node] = Number(match[1])
  }
  return out
}

export const parseEventMapPage = ({ html, no, config, shipsPack, masterNames = [], checkedAt, revision }) => {
  const issues = []
  const resolve = eventShipResolver(shipsPack, masterNames)
  const tabs = splitEventDifficultyTabs(html)
  const gimmicks = parseGimmicks(html, no, issues)
  const difficulties = {}
  let rawComps = 0
  for (const difficulty of DIFFICULTIES) {
    if (!tabs.has(difficulty)) throw new Error(`E${no} 缺 ${difficulty} tab`)
    const parsed = parseKcwikiMapPage(tabs.get(difficulty))
    const nodes = {}
    for (const [node, value] of Object.entries(parsed.nodes)) {
      rawComps += value.enemyComps.length
      const grouped = new Map()
      for (const comp of value.enemyComps) {
        const key = JSON.stringify(comp.ships)
        const previous = grouped.get(key)
        if (previous) {
          const names = { 1: '単縦', 2: '複縦', 3: '輪形', 4: '梯形', 5: '単横', 6: '警戒' }
          previous.formation = unique([previous.formation, comp.formation].flatMap((v) =>
            (names[v] ?? `${v}`).split(' '))).join(' ')
        } else grouped.set(key, { formation: comp.formation, ships: comp.ships, labels: comp.labels })
      }
      if (grouped.size) nodes[node] = { ships: [], emptyDrop: 'unknown', enemyComps: [...grouped.values()] }
    }
    difficulties[difficulty] = { nodes, ...(gimmicks[difficulty].length ? { operations: { gimmicks: gimmicks[difficulty] } } : {}) }
  }
  const phase = config.phases.find((p) => p.maps.includes(no))
  const sourceUrl = `https://zh.kcwiki.cn/wiki/${encodeURI(config.kcwikiPage)}/E-${no}`
  const map = {
    source: 'kuma 汇编 · 参考舰娘百科「活动海域」', sourceUrl, kcwikiUrl: sourceUrl, checkedAt, revision,
    event: { name: config.name, from: config.openedAt.slice(0, 10), until: config.until,
      status: config.status, phaseOpenedAt: phase.openedAt, lifecycleSourceUrl: config.lifecycleSourceUrl },
    difficulties, rewards: parseRewards(html, issues),
    operations: { specialShips: parseSpecialShips(html, resolve, issues), nodeDistances: parseNodeDistances(html, no, config.kcwikiPage) },
    drops: parseEventDrops(html, no, resolve, issues),
  }
  if (!Object.keys(map.operations.nodeDistances).length) delete map.operations.nodeDistances
  if (!map.operations.specialShips.length) delete map.operations.specialShips
  return { map, issues, rawComps }
}

const ids = (comp) => comp.shipIds ?? (comp.ships.every((id) => typeof id === 'number') ? comp.ships : null)
const signature = (comp) => ids(comp)?.join(',')
const diffSets = (a, b) => ({ onlyBundled: [...a].filter((v) => !b.has(v)), onlyReference: [...b].filter((v) => !a.has(v)) })
const gimmickFacts = (groups) => {
  const stages = new Map()
  return groups.flatMap((group) => {
    const stage = group.title.match(/E\d(?:P|-)(\d)/)?.[1]
    if (!stage) return []
    const order = Number(group.title.match(/(?:解谜|開放)([12])/)?.[1]) || (stages.get(stage) ?? 0) + 1
    stages.set(stage, order)
    return group.steps.flatMap((text) => {
      const point = text.match(/^([A-Z]+\d*|基地防空)/)?.[1]
      const count = text.match(/[x×]\s*(\d+)/i)?.[1]
      const condition = /到达/.test(text) ? 'reach' : /航空优势|空中优势|優勢/.test(text) ? 'air' : text.match(/([SAB])胜/)?.[1]
      return point && count && condition ? [{ key: `${stage}/${order}/${point}`, condition, count, text, group }] : []
    })
  })
}
const scopeKey = (scope) => `${scope}`.replace(/\[\d+\]/g, '').replace(/\s+/g, '')

// 对照不引入参考独有内容。集合覆盖差不等于互相否定；明确冲突整条剔除，原文只进报告。
export const compareEventMapIntel = (input, reference, bonus = null) => {
  const data = structuredClone(input)
  const report = { enemyComps: [], drops: [], gimmicks: [], specialShips: [], corroboratedSpecialShips: [], conflicts: [] }
  for (const [code, map] of Object.entries(data.maps)) {
    const ref = reference?.data?.maps?.[code] ?? reference?.maps?.[code]
    for (const [difficulty, layer] of Object.entries(map.difficulties)) {
      const other = ref?.difficulties?.[difficulty]
      for (const node of unique([...Object.keys(layer.nodes), ...Object.keys(other?.nodes ?? {})])) {
        const ours = layer.nodes[node]?.enemyComps ?? []
        const theirs = other?.nodes[node]?.enemyComps ?? []
        const delta = diffSets(new Set(ours.map(signature).filter(Boolean)), new Set(theirs.map(signature).filter(Boolean)))
        const unresolved = theirs.filter((c) => !ids(c)).map((c) => c.ships)
        if (delta.onlyBundled.length || delta.onlyReference.length || unresolved.length) report.enemyComps.push({ map: code, difficulty, node, ...delta, unresolved })
        if (layer.nodes[node]) layer.nodes[node].enemyComps = ours.filter((comp) => {
          const twins = theirs.filter((c) => signature(c) === signature(comp))
          const formations = new Set(twins.flatMap((c) => formationIdsOf(c.formation)))
          const conflict = twins.find((c) => c.conflict) ??
            (twins.length && formations.size && !formationIdsOf(comp.formation).some((f) => formations.has(f)) ? twins[0] : null)
          if (!conflict) return true
          report.conflicts.push({ map: code, difficulty, node, domain: 'enemyComps', bundled: comp, reference: conflict })
          return false
        })
      }
      const ownG = layer.operations?.gimmicks ?? []
      const refG = other?.operations?.gimmicks ?? []
      if (JSON.stringify(ownG) !== JSON.stringify(refG)) report.gimmicks.push({ map: code, difficulty, bundled: ownG, reference: refG })
      const theirs = new Map(gimmickFacts(refG).map((fact) => [fact.key, fact]))
      for (const fact of gimmickFacts(ownG)) {
        const twin = theirs.get(fact.key)
        if (!twin || (fact.condition === twin.condition && fact.count === twin.count)) continue
        report.conflicts.push({ map: code, difficulty, domain: 'gimmicks', key: fact.key, bundled: fact.text, reference: twin.text })
        fact.group.steps = fact.group.steps.filter((s) => s !== fact.text)
      }
      if (layer.operations?.gimmicks) layer.operations.gimmicks = ownG.filter((g) => g.steps.length)
    }
    for (const [node, ships] of Object.entries(map.drops?.nodes ?? {})) {
      // 默认甲 S 的图级表只能与甲层比；绝不与乙丙丁或四档合算混比。
      const other = ref?.difficulties?.甲?.nodes?.[node]?.ships ?? []
      const delta = diffSets(new Set(ships.map((s) => s.id)), new Set(other.map((s) => s.id)))
      if (delta.onlyBundled.length || delta.onlyReference.length) report.drops.push({ map: code, node, referenceDifficulty: '甲', ...delta })
    }
    const b = bonus?.data?.events?.[`E${code.split('-')[1]}`]
    if (b) {
      // 按舰名/舰种/国籍与全图或点位记录匹配；只报可对应的数字，缺口单列。
      const entries = b.entries ?? []
      map.operations.specialShips = (map.operations?.specialShips ?? []).filter((ship) => {
        const rate = ship.effect.match(/^(.*?)\s*×(1\.\d+)/) ?? ship.effect.match(/^(全图)[；\s]*(1\.\d+)/)
        const candidates = rate ? entries.filter((e) => ['ship', 'stype', 'nation', 'unknown'].includes(e.by) &&
          scopeKey(e.scope) === scopeKey(rate[1]) && (ship.label === e.key || ship.label.endsWith(` · ${e.key}`) || ship.label.startsWith(`${e.key} `))) : []
        if (!candidates.length) {
          // event-bonus 的 E2/E3 组列缺完整组名，不能拿同叫 A组的不同分组硬对。
          const group = ship.effect.split('；')[0]
          const members = b.equipGroups?.[group]?.join('、').split(/[、/]/).map((s) => s.trim()) ?? []
          const matched = members.includes(ship.label)
          report[matched ? 'corroboratedSpecialShips' : 'specialShips'].push({ map: code, bundled: ship, reference: candidates, kind: matched ? 'group-member' : 'not-comparable' })
          return true
        }
        const value = Number(rate[2])
        const matched = candidates.some((e) => value >= e.value && value <= e.max)
        if (matched) report.corroboratedSpecialShips.push({ map: code, label: ship.label, scope: rate[1], value })
        else {
          const conflict = { map: code, domain: 'specialShips', bundled: ship, reference: candidates }
          report.specialShips.push(conflict)
          report.conflicts.push(conflict)
        }
        return matched
      })
    }
  }
  return { data, report }
}
