// zh.kcwiki「模块:舰娘装备数据改」的 `额外收益*` 字段 → kuma 第一方装备加成包。
//
// 这一层做两件事，两件都在**维护者侧**跑，运行时零解析：
//   ① 忠实解析上游那张 Lua 表（1113 条条件行，字段语义见 scripts/fit-bonus-schema.md）；
//   ② 把中文名字空间翻成 id 空间（词表在 scripts/lib/fit-bonus-vocab.mjs）。
//
// 纪律：**认不出来的一律挂牌，不静默丢**。任何落不了地的名字、没见过的字段、
// 解析不出的分档键都会进 `unresolved`，并让抓取器把条数打在日志里。
// 宁可包里少一条并且看得见，也不要一份「看起来完整」的残包。

import { FIT_BONUS_AREA_KEYS, FIT_BONUS_EQUIP_GROUPS, FIT_BONUS_GAIN_KINDS, FIT_BONUS_STAT_KEYS, normalizeFitBonusName } from './fit-bonus-vocab.mjs'

/** 上游一条 `额外收益N` 里允许出现的键。多出别的就是上游加了新语义，必须报出来。 */
const KNOWN_ROW_FIELDS = new Set([
  '适用舰娘',
  '非适用舰娘',
  '收益类型',
  '收益属性',
  '装备组合',
  '最大数量',
  '改修等级',
  '累计套装加成',
])

const BONUS_FIELD = /^额外收益(\d*)$/

/** `["火力"] = 2` 这层：换成第一方字段名；射程在上游是字符串。 */
const readStats = (raw, onUnknown) => {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [name, value] of Object.entries(raw)) {
    const field = FIT_BONUS_STAT_KEYS[name]
    if (!field) {
      onUnknown?.(name)
      continue
    }
    const number = typeof value === 'number' ? value : Number.parseInt(`${value}`, 10)
    if (!Number.isFinite(number)) {
      onUnknown?.(`${name}=${JSON.stringify(value)}`)
      continue
    }
    if (number !== 0) out[field] = number
  }
  return out
}

/**
 * 改修分档的键：`"0"`…`"10"`、`"8~9"` 这种区间、以及 `"max"`。
 * `max` 一律读成 ★10——游戏里改修上限就是 10，且上游在同一张表里
 * 用 `8~9` 接 `max`，中间不留空档。
 */
const readStarTier = (key) => {
  const text = `${key}`.trim()
  if (text === 'max') return { from: 10, to: 10 }
  const range = /^(\d+)\s*~\s*(\d+)$/.exec(text)
  if (range) return { from: Number(range[1]), to: Number(range[2]) }
  if (/^\d+$/.test(text)) return { from: Number(text), to: null }
  return null
}

/** `装备组合` 的一格：先整串当装备名试，再按「/」拆成备选项，最后落类目词表。 */
const readSynergySlot = (token, equipIdByName) => {
  const whole = normalizeFitBonusName(token)
  const direct = equipIdByName.get(whole)
  if (direct?.length) return { any: [...direct] }

  const group = FIT_BONUS_EQUIP_GROUPS[whole] ?? FIT_BONUS_EQUIP_GROUPS[`${token}`.trim()]
  if (group) return { group: group.key }

  // 「/」在上游有两个意思：同义词（雷达/电探）与备选装备（试制51cm连装炮/51cm连装炮），
  // 而装备名自己也可能带斜杠（14inch/45 三連装砲）。所以按「最长可识别片段」贪心切。
  const parts = whole.split('/')
  const picked = []
  let i = 0
  while (i < parts.length) {
    let matched = null
    for (let span = parts.length - i; span >= 1; span--) {
      const candidate = parts.slice(i, i + span).join('/')
      const hit = equipIdByName.get(candidate)
      if (hit?.length) {
        matched = { ids: hit, span }
        break
      }
    }
    if (!matched) return null
    picked.push(...matched.ids)
    i += matched.span
  }
  return picked.length ? { any: [...new Set(picked)] } : null
}

const pushUnique = (list, value) => {
  if (!list.includes(value)) list.push(value)
}

/** 一组名字 → { forms, classes, types, all }；解析不了的进 misses。 */
const resolveNames = (names, resolver, misses, siblings) => {
  const out = {}
  const rest = []
  for (const raw of names ?? []) {
    const hit = resolver.resolve(raw)
    if (!hit) {
      misses.push(`${raw}`)
      continue
    }
    if (hit.sibling && !siblings.has(normalizeFitBonusName(hit.sibling))) {
      // 自失效护栏：该词只在与父类目同行时含义确定（见词表的 why）。
      misses.push(`${raw}（词表要求与「${hit.sibling}」同行，本行没有，需重新裁定）`)
      continue
    }
    switch (hit.kind) {
      case 'forms':
        out.forms ??= []
        for (const id of hit.forms) pushUnique(out.forms, id)
        break
      case 'classes':
        out.classes ??= []
        for (const id of hit.classes) pushUnique(out.classes, id)
        break
      case 'types':
        out.types ??= []
        for (const id of hit.types) pushUnique(out.types, id)
        break
      case 'all':
        out.all = true
        break
      case 'classRest':
        rest.push(...hit.classes)
        break
      default:
        misses.push(`${raw}`)
    }
  }
  return { set: out, rest }
}

const sortSet = (set) => {
  for (const key of ['forms', 'classes', 'types']) {
    if (set[key]) set[key] = [...set[key]].sort((a, b) => a - b)
  }
  return set
}

const isEmptySet = (set) => !set.forms?.length && !set.classes?.length && !set.types?.length && !set.all

/**
 * 解析整张表。
 *
 * @param {Record<string, any>} equipTable  `d.equipDataTb`（已由 kcwiki-lua 解析成对象）
 * @param {ReturnType<import('./fit-bonus-vocab.mjs').createFitBonusNameResolver>} resolver
 */
export const buildFitBonusPack = (equipTable, resolver) => {
  const equipIdByName = new Map()
  for (const row of Object.values(equipTable)) {
    const id = Number(row?.ID)
    if (!(id > 0)) continue
    for (const name of [row?.['中文名'], row?.['日文名']]) {
      const key = normalizeFitBonusName(name)
      if (!key) continue
      const list = equipIdByName.get(key) ?? []
      pushUnique(list, id)
      equipIdByName.set(key, list)
    }
  }

  const equips = {}
  const unresolved = []
  const notes = []
  const usedGroups = new Set()
  let ruleCount = 0

  for (const row of Object.values(equipTable)) {
    const equipId = Number(row?.ID)
    if (!(equipId > 0)) continue
    const rules = []
    const restPending = []

    const bonusFields = Object.entries(row)
      .filter(([field]) => BONUS_FIELD.test(field))
      .sort((a, b) => Number(BONUS_FIELD.exec(a[0])[1] || 1) - Number(BONUS_FIELD.exec(b[0])[1] || 1))

    for (const [field, raw] of bonusFields) {
      const index = Number(BONUS_FIELD.exec(field)[1] || 1)
      const flag = (reason) => unresolved.push({ equipId, row: index, reason })

      for (const key of Object.keys(raw)) {
        if (!KNOWN_ROW_FIELDS.has(key)) flag(`未识别字段「${key}」`)
      }

      const kind = FIT_BONUS_GAIN_KINDS[raw['收益类型']]
      if (!kind) {
        flag(`未识别的收益类型「${raw['收益类型']}」，整行跳过`)
        continue
      }

      const siblings = new Set((raw['适用舰娘'] ?? []).map((name) => normalizeFitBonusName(name)))
      const applyMisses = []
      const excludeMisses = []
      const apply = resolveNames(raw['适用舰娘'], resolver, applyMisses, siblings)
      const exclude = resolveNames(raw['非适用舰娘'], resolver, excludeMisses, siblings)
      for (const miss of applyMisses) flag(`适用舰娘「${miss}」映射不了`)
      for (const miss of excludeMisses) flag(`非适用舰娘「${miss}」映射不了`)
      if (exclude.rest.length) flag('非适用舰娘 里出现了「其他◯◯型」，本源没有这种用法')

      // ---- 收益值 ----
      const badStats = []
      let gain = null
      if (kind === 'flat') {
        gain = { kind, flat: readStats(raw['收益属性'], (name) => badStats.push(name)) }
        if (!Object.keys(gain.flat).length) {
          flag('通用行的收益属性是空的')
          gain = null
        }
      } else if (kind === 'byStar') {
        const steps = []
        for (const [tierKey, stats] of Object.entries(raw['收益属性'] ?? {})) {
          const tier = readStarTier(tierKey)
          if (!tier) {
            flag(`改修分档键「${tierKey}」读不出来`)
            continue
          }
          const value = readStats(stats, (name) => badStats.push(name))
          if (!Object.keys(value).length) continue // 上游用空表占位（447/486 各一处）
          steps.push({ from: tier.from, to: tier.to, stats: value })
        }
        steps.sort((a, b) => a.from - b.from)
        gain = steps.length ? { kind, steps } : null
        if (!gain) flag('改修行没有任何有效分档')
      } else if (kind === 'byCount') {
        const counts = []
        for (const [countKey, stats] of Object.entries(raw['收益属性'] ?? {})) {
          const count = Number.parseInt(`${countKey}`, 10)
          if (!Number.isInteger(count) || count < 1) {
            flag(`数量分档键「${countKey}」读不出来`)
            continue
          }
          const value = readStats(stats, (name) => badStats.push(name))
          if (!Object.keys(value).length) continue
          counts.push({ count, stats: value })
        }
        counts.sort((a, b) => a.count - b.count)
        gain = counts.length ? { kind, counts } : null
        if (!gain) flag('数量行没有任何有效分档')
      } else if (kind === 'byArea') {
        const areas = []
        for (const [areaKey, stats] of Object.entries(raw['收益属性'] ?? {})) {
          const area = FIT_BONUS_AREA_KEYS[areaKey]
          if (!area) {
            flag(`未识别的出击区域「${areaKey}」`)
            continue
          }
          const value = readStats(stats, (name) => badStats.push(name))
          if (Object.keys(value).length) areas.push({ area, stats: value })
        }
        gain = areas.length ? { kind, areas } : null
        if (!gain) flag('区域行没有任何有效分档')
      }
      for (const name of new Set(badStats)) flag(`未识别的收益属性「${name}」`)
      if (!gain) continue

      // ---- 条件 ----
      const need = {}
      const star = Number(raw['改修等级'])
      if (Number.isInteger(star) && star > 0) need.star = star
      const combos = raw['装备组合']
      if (Array.isArray(combos) && combos.length) {
        const slots = []
        for (const token of combos) {
          const slot = readSynergySlot(token, equipIdByName)
          if (!slot) {
            flag(`装备组合「${token}」既不是装备名也不是已知类目`)
            continue
          }
          if (slot.group) usedGroups.add(slot.group)
          slots.push(slot)
        }
        if (slots.length) need.with = slots
      } else if (Array.isArray(combos)) {
        notes.push(`#${equipId} ${field}：装备组合是空数组（上游留的空壳），按无协同条件处理`)
      }

      const maxCount = Number(raw['最大数量'])
      const cap = Number.isInteger(maxCount) && maxCount > 0 ? maxCount : null
      // 叠加规则：本源没有显式字段。带协同装备的、或上游把上限写成 1 的，只加一次；
      // 其余按件数倍乘并受 cap 约束（`数量` 行的分档表本身就是规则，标 table）。
      const stack = kind === 'byCount' ? 'table' : need.with || cap === 1 ? 'once' : 'perEquip'

      const setTotal = raw['累计套装加成']
        ? readStats(raw['累计套装加成'], (name) => flag(`累计套装加成里的「${name}」未识别`))
        : null

      const rule = {
        row: index,
        who: sortSet(apply.set),
        gain,
        stack,
      }
      if (!isEmptySet(exclude.set)) rule.not = sortSet(exclude.set)
      if (Object.keys(need).length) rule.need = need
      if (cap !== null && stack === 'perEquip') rule.cap = cap
      if (setTotal && Object.keys(setTotal).length) rule.setTotal = setTotal

      if (apply.rest.length) {
        restPending.push({ rule, classes: [...new Set(apply.rest)] })
      } else if (isEmptySet(rule.who)) {
        // 上游有 10 行**根本没写** `适用舰娘`——那是「装在谁身上都算」（多半配着 非适用舰娘）。
        // 但「写了却一个都没映射上」是完全不同的一件事：那时候摊成全舰船等于
        // 把一条解析失败**放大成全服生效**，比丢掉这行危险得多。所以只认前者。
        if ((raw['适用舰娘'] ?? []).length) {
          flag('适用舰娘一个都没映射上，整行跳过（不摊成全舰船）')
          continue
        }
        rule.who.all = true
      }
      rules.push(rule)
      ruleCount++
    }

    // 「其他◯◯型」要等同装备其他行都解析完才能展开：本级全体 − 本装备其他行点名的形态。
    for (const pending of restPending) {
      const named = new Set()
      for (const other of rules) {
        if (other === pending.rule) continue
        for (const id of other.who.forms ?? []) named.add(id)
        for (const id of other.not?.forms ?? []) named.add(id)
      }
      const forms = pending.classes
        .flatMap((ctype) => resolver.membersOfCtype(ctype))
        .filter((id) => !named.has(id))
      const own = new Set(pending.rule.who.forms ?? [])
      pending.rule.who.forms = [...new Set([...own, ...forms])].sort((a, b) => a - b)
      if (!pending.rule.who.forms.length) {
        // 空集的行留在包里就是一条谁也命不中的死规则（`who` 还会是空对象，
        // 校验器直接拒收整包）。挂牌并整行摘掉。
        unresolved.push({
          equipId,
          row: pending.rule.row,
          reason: '「其他◯◯型」展开后是空集——本装备其他行已把该级全部点名，整行摘掉',
        })
        const at = rules.indexOf(pending.rule)
        if (at >= 0) {
          rules.splice(at, 1)
          ruleCount--
        }
      }
    }

    if (rules.length) {
      equips[`${equipId}`] = {
        id: equipId,
        nameJa: `${row['日文名'] ?? ''}`,
        nameZh: `${row['中文名'] ?? ''}`,
        rules,
      }
    }
  }

  const equipGroups = {}
  for (const [zhToken, group] of Object.entries(FIT_BONUS_EQUIP_GROUPS)) {
    if (!usedGroups.has(group.key)) continue
    equipGroups[group.key] = equipGroups[group.key] ?? { zh: group.zh, tokens: [] }
    pushUnique(equipGroups[group.key].tokens, zhToken)
  }

  return {
    data: {
      schemaVersion: 1,
      equipGroups,
      equips,
      unresolved,
    },
    report: {
      equips: Object.keys(equips).length,
      rules: ruleCount,
      unresolved: unresolved.length,
      notes,
    },
  }
}
