// 离线带路规则执行器。
//
// 输入仍是 kcwiki-routing 的有序中文规则，但执行时坚持三值逻辑：
// true = 当前舰队明确命中；false = 明确不命中；null = 资料含随机、机关或尚未支持的条件。
// 只有“此前没有未知分支 + 当前规则确定命中”才输出 certain，绝不把文本猜测包装成必走路线。

export type RoutingDifficulty = '甲' | '乙' | '丙' | '丁'

export interface RoutingFleetContext {
  shipCount: number
  counts: Record<string, number>
  shipNames: string[]
  flagshipName: string
  flagshipTypes: string[]
  speed: number // api_soku：5 低速 / 10 高速 / 15 高速+ / 20 最速
  los: Record<number, number> // 33 式，key = 分歧点系数 1..4
  equipmentShipCounts: {
    radar: number
    drum: number
    landingCraft: number
  }
  passed: string[]
  phase: number | null
  // 活动图当前选的难度（api_selected_rank → 甲乙丙丁）。常规图、以及还没选难度时是 null。
  difficulty: RoutingDifficulty | null
}

export interface RoutingDecisionRoute {
  to: string
  probability: number | null
  reason: string
}

export interface RoutingDecision {
  status: 'certain' | 'possible' | 'unknown'
  routes: RoutingDecisionRoute[]
  matchedRule: string | null
  evaluatedRules: number
  unknownRules: string[]
}

interface ConditionResult {
  value: boolean | null
  reason?: string
}

const unique = <T>(values: T[]): T[] => [...new Set(values)]
const clean = (text: string) =>
  text
    .replace(/[＜<]/g, '<')
    .replace(/[＞>]/g, '>')
    .replace(/[＝]/g, '=')
    .replace(/[～〜]/g, '~')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeName = (name: string) =>
  name
    .replace(/\s+/g, '')
    .replace(/[・･]/g, '')
    .replace(/[「」『』<>\[\]【】]/g, '')
    .toLowerCase()

const hasShip = (context: RoutingFleetContext, token: string): boolean => {
  const wanted = normalizeName(token)
  if (!wanted) return false
  return context.shipNames.some((name) => {
    const current = normalizeName(name)
    return current === wanted || current.startsWith(wanted) || wanted.startsWith(current)
  })
}

const equipmentCount = (context: RoutingFleetContext, token: string): number | null => {
  if (/电探|電探/.test(token)) return context.equipmentShipCounts.radar
  if (/运输桶|輸送桶|ドラム缶/.test(token)) return context.equipmentShipCounts.drum
  if (/大发|大発|内火艇|装甲艇|武装大発/.test(token)) {
    return context.equipmentShipCounts.landingCraft
  }
  return null
}

const countTerm = (context: RoutingFleetContext, raw: string): number | null => {
  const token = clean(raw)
    .replace(/^舰队中/, '')
    .replace(/^艦隊中/, '')
    .replace(/[()（）]/g, '')
    .trim()
  if (!token) return 0
  if (/^舰队船数$/.test(token)) return context.shipCount
  if (/^低速BB$/.test(token)) return context.counts.lowSpeedBB ?? 0
  if (/^装备/.test(token) && /船数$/.test(token)) return equipmentCount(context, token)
  if (Object.prototype.hasOwnProperty.call(context.counts, token)) return context.counts[token]
  // 代码词条是大写；其余按特定舰名计数。
  if (/^[A-Z]+(?:系)?$/.test(token)) return context.counts[token] ?? 0
  return hasShip(context, token) ? 1 : 0
}

const sumExpression = (context: RoutingFleetContext, expression: string): number | null => {
  const terms = expression.split('+').map((term) => term.trim()).filter(Boolean)
  let sum = 0
  for (const term of terms) {
    const value = countTerm(context, term)
    if (value == null) return null
    sum += value
  }
  return sum
}

const compare = (left: number, op: string, right: number): boolean => {
  if (op === '=') return left === right
  if (op === '>=') return left >= right
  if (op === '<=') return left <= right
  if (op === '>') return left > right
  return left < right
}

const evaluateClause = (
  rawClause: string,
  context: RoutingFleetContext,
): ConditionResult => {
  let clause = clean(rawClause)
    .replace(/^[，,:：·]+|[，,:：·]+$/g, '')
    .replace(/^└\s*/, '')
    // 「甲难度 CV+CVB>=1」「乙难度：舰队船数=7」的难度前缀在这里摘掉：
    // 这条规则归不归当前难度管，已经由 difficultyGate 在规则层面判过了；
    // 留着只会让 sumExpression 把「乙丙丁难度 DD」整体当成一个舰名词条记 0 分，
    // 于是「乙丙丁难度 DD>=3」在乙难度下反而算成 false（实测过的一次翻车）。
    .replace(/^[甲乙丙丁]+难度\s*[:：]?\s*/, '')
    .trim()
  if (!clause) return { value: true }
  if (/^目前全部/.test(clause)) return { value: true }
  if (/^(其余|其他|其它|上述判定全部失败|去[A-Z0-9]+判定失败)/.test(clause)) {
    return { value: true }
  }
  if (/未开启|开启后|机关|路线|样本|记录|可能|不明/.test(clause)) {
    return { value: null, reason: clause }
  }
  if (/P(\d)阶段/i.test(clause)) {
    const phase = Number(clause.match(/P(\d)阶段/i)?.[1])
    return context.phase == null
      ? { value: null, reason: clause }
      : { value: context.phase === phase }
  }
  const passed = clause.match(/经过([A-Z]\d?)点?/)
  if (passed) return { value: context.passed.includes(passed[1]) }

  if (/高速\+、最速/.test(clause)) return { value: context.speed >= 15 }
  if (/最速.*舰队|最速舰队/.test(clause)) return { value: context.speed >= 20 }
  if (/高速\+.*舰队|高速\+以上/.test(clause)) return { value: context.speed >= 15 }
  if (/低速舰队/.test(clause)) return { value: context.speed < 10 }
  if (/高速(?:以上)?(?:的)?舰队|高速舰队/.test(clause)) return { value: context.speed >= 10 }

  const noContains = clause.match(/不包含\s*([^，,]+)/)
  if (noContains) {
    const names = noContains[1].split(/和|与|、/).map((name) => name.trim()).filter(Boolean)
    return { value: names.every((name) => !hasShip(context, name)) }
  }
  const contains = clause.match(/包含\s*([^，,]+)/)
  if (contains) {
    const names = contains[1].split(/和|与|、/).map((name) => name.trim()).filter(Boolean)
    return { value: names.every((name) => hasShip(context, name)) }
  }

  const flagship = clause.match(/^(.+?)旗舰$/)
  if (flagship) {
    const token = flagship[1].trim()
    return {
      value:
        context.flagshipTypes.includes(token) ||
        normalizeName(context.flagshipName).includes(normalizeName(token)),
    }
  }

  const range = clause.match(/^(.+?)\s*=\s*(\d+)\s*~\s*(\d+)$/)
  if (range) {
    const left = sumExpression(context, range[1])
    return left == null
      ? { value: null, reason: clause }
      : { value: left >= Number(range[2]) && left <= Number(range[3]) }
  }

  const comparison = clause.match(/^(.+?)\s*(>=|<=|=|>|<)\s*(舰队船数|\d+)$/)
  if (comparison) {
    const left = sumExpression(context, comparison[1])
    const right =
      comparison[3] === '舰队船数' ? context.shipCount : Number(comparison[3])
    return left == null
      ? { value: null, reason: clause }
      : { value: compare(left, comparison[2], right) }
  }

  const implicitShipCount = clause.match(/^舰队船数\s+(\d+)$/)
  if (implicitShipCount) return { value: context.shipCount === Number(implicitShipCount[1]) }

  return { value: null, reason: clause }
}

export const evaluateRoutingCondition = (
  raw: string,
  context: RoutingFleetContext,
): ConditionResult => {
  const protectedOr = clean(raw).replace(/或以上/g, '以上')
  const orParts = protectedOr.split(/\s+或\s+|或(?=[舰装A-Z])/).map((part) => part.trim()).filter(Boolean)
  if (orParts.length > 1) {
    const values = orParts.map((part) => evaluateRoutingCondition(part, context))
    if (values.some((result) => result.value === true)) return { value: true }
    if (values.every((result) => result.value === false)) return { value: false }
    return {
      value: null,
      reason: values.find((result) => result.reason)?.reason ?? raw,
    }
  }
  const parts = protectedOr.split(/\s*且\s*/).map((part) => part.trim()).filter(Boolean)
  const values = parts.map((part) => evaluateClause(part, context))
  if (values.some((result) => result.value === false)) return { value: false }
  const unknown = values.find((result) => result.value == null)
  return unknown ? { value: null, reason: unknown.reason ?? raw } : { value: true }
}

// 「从2出发的舰队 去O」里的「从2出发」是**条件**（这支队打哪个出发点来的），不是目的地。
// 活动图的多出发点合流点才这么写；常规图只有 5-6 是双出发点，且写成赋值式的「其余从2出发」，
// 两者靠「的舰队」区分（2026-08-26 实测：常规图 1316 条规则里「从N出发的舰队」出现 0 次）。
// 遮成等长的「·」而不是删掉，是为了让 conditionPartOf 切出来的下标仍然对得上原文。
const maskStartCondition = (text: string) =>
  text.replace(/从[0-9]出发的舰队/g, (matched) => '·'.repeat(matched.length))

const destinationsOf = (rule: string): string[] => {
  const text = clean(rule)
  if (/去[A-Z0-9]+判定失败\s*$/.test(text)) return []
  const scan = maskStartCondition(text)
  const observedOnly = scan.match(/目前全部[A-Z]\d?\s*-\s*([A-Z]\d?)/)
  const grouped = [...scan.matchAll(/(?:去|从)([A-Z]\d?(?:\/[A-Z]\d?)+)/g)]
    .flatMap((match) => match[1].split('/'))
  const singles = [...scan.matchAll(/(?:去|从)([A-Z]\d?|[1-9])(?![\d/])/g)]
    .map((match) => match[1])
  return unique([...(observedOnly ? [observedOnly[1]] : []), ...grouped, ...singles])
}

// 活动图把难度写成规则里的条件短语：「甲难度 CV+CVB>=1 去A1」「乙丙丁难度 DD>=3 去G」
// 「甲难度：舰队船数=7 且 SS系>=4 从3出发」。常规图一条都没有（同上实测），所以只在活动图生效。
//
// 不认这个短语的后果不是「不确定」而是**装懂**：sumExpression 会把「甲难度 CV」整体当成
// 一个舰名词条记 0 分，于是「甲难度 CV+CVB>=1」在乙难度下照样可能算出 true，
// 把甲专属的分歧规则套到乙玩家头上，还以 certain 的口吻报出去。
//
// 括号内的难度字样不算条件：那些是「(全难度可与…混编)」「(甲难度未斩杀不允许…混搭)」这类附注，
// 以及「索敌不足 去P2(分歧点系数=2，甲难度…固定不去P2)」这种把甲的阈值写进注里的写法。
const withoutParenthesised = (text: string) => text.replace(/[（(][^（）()]*[）)]/g, ' ')

const difficultyGate = (rule: string, context: RoutingFleetContext): boolean | null => {
  const named = withoutParenthesised(clean(rule)).match(/([甲乙丙丁]+)难度/)
  if (!named) return true
  if (!context.difficulty) return null
  return named[1].includes(context.difficulty)
}

const probabilityOf = (rule: string, to: string): number | null => {
  const before = clean(rule).match(new RegExp(`(\\d+(?:\\.\\d+)?)%\\s*去${to}`))
  if (before) return Number(before[1])
  const after = clean(rule).match(new RegExp(`去${to}\\s*概率\\s*(\\d+(?:\\.\\d+)?)%`))
  return after ? Number(after[1]) : null
}

const evaluateLosRule = (
  rule: string,
  context: RoutingFleetContext,
): { matched: boolean; routes: RoutingDecisionRoute[]; terminal: boolean } | null => {
  const factor = Number(rule.match(/分歧点系数\s*=\s*([1-4])/)?.[1] ?? 0)
  if (!factor) return null
  const value = context.los[factor]
  if (!Number.isFinite(value)) return { matched: false, routes: [], terminal: false }
  // 括号内多为“司令部系数 0.35”的另一套换算阈值；本引擎使用项目统一的 33 式口径。
  const text = clean(rule).replace(/[（(][^（）()]*司令部系数[^（）()]*[）)]/g, '')
  const high =
    text.match(/索敌\s*(?:约)?\s*>=\s*(\d+(?:\.\d+)?)[^索敌]*?去([A-Z]\d?)/)
    ?? text.match(/(\d+(?:\.\d+)?)\s*索敌以上[^索敌]*?去([A-Z]\d?)/)
  const low =
    text.match(/索敌\s*<\s*(\d+(?:\.\d+)?)[^索敌]*?去([A-Z]\d?)/)
    ?? text.match(/(\d+(?:\.\d+)?)\s*索敌以下[^索敌]*?去([A-Z]\d?)/)
    ?? text.match(/索敌不足\s*(\d+(?:\.\d+)?)?\s*去([A-Z]\d?)/)
  const band =
    text.match(/索敌\s*(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)[^索敌]*?去([A-Z]\d?(?:\/[A-Z]\d?)*)/)
    ?? text.match(/(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*(?:之间)?[^索敌]*?索敌[^索敌]*?去([A-Z]\d?(?:\/[A-Z]\d?)*)/)
  const route = (to: string, probability: number | null = null): RoutingDecisionRoute => ({
    to,
    probability,
    reason: `33式×${factor} = ${value}`,
  })
  if (high && value >= Number(high[1])) {
    const uncertain = /约|？|\?/.test(text.slice(0, high.index! + high[0].length))
    return { matched: true, routes: [route(high[2])], terminal: !uncertain }
  }
  if (low && value < Number(low[1])) {
    return { matched: true, routes: [route(low[2])], terminal: !/[？?]/.test(low[0]) }
  }
  if (band) {
    const from = Number(band[1])
    const to = Number(band[2])
    if (value >= from && value < to) {
      const bandRoutes = band[3].split('/').map((destination) => route(destination))
      const fallback = low?.[2]
      if (fallback && !bandRoutes.some((item) => item.to === fallback)) {
        bandRoutes.push(route(fallback))
      }
      return {
        matched: true,
        routes: bandRoutes,
        terminal: true,
      }
    }
  }
  if (high && /索敌不足\s*(?:\d+(?:\.\d+)?)?\s*去([A-Z]\d?)/.test(text) && value < Number(high[1])) {
    const destination = text.match(/索敌不足\s*(?:\d+(?:\.\d+)?)?\s*去([A-Z]\d?)/)![1]
    return { matched: true, routes: [route(destination)], terminal: true }
  }
  return { matched: false, routes: [], terminal: false }
}

const conditionPartOf = (rule: string): string => {
  // 用遮过「从N出发的舰队」的文本找切点，再回原文切：不然「从2出发的舰队 去O」会在下标 0
  // 切出**空条件**，而空条件在 evaluateRoutingCondition 里是恒真——等于无条件走 O。
  const index = maskStartCondition(clean(rule)).search(/(?:去|从)[A-Z0-9]/)
  if (index < 0) return clean(rule)
  return clean(rule)
    .slice(0, index)
    .replace(/[，,:：·]?\s*(?:约)?\d+(?:\.\d+)?%\s*$/, '')
    .replace(/[，,:：·]\s*$/, '')
    .trim()
}

const uncertainOutcome = (rule: string, destinations: string[]) =>
  destinations.length > 1 || /随机|概率|大概率|小概率|中概率|约|目前|\d+(?:\.\d+)?%|[？?]/.test(rule)

const conditionFamily = (condition: string): string => {
  const text = clean(condition)
  if (/包含/.test(text)) return 'contains'
  if (/舰队/.test(text) && /速/.test(text)) return 'speed'
  if (/P\d阶段/.test(text)) return 'phase'
  const comparison = text.match(/^(.+?)(?:>=|<=|=|>|<)/)
  return comparison ? comparison[1].replace(/\s+/g, '') : text
}

export const evaluateRoutingRules = (
  rules: string[],
  context: RoutingFleetContext,
  candidates: string[] = [],
): RoutingDecision => {
  const candidateSet = new Set(candidates)
  const possible = new Map<string, RoutingDecisionRoute>()
  const unknownRules: string[] = []
  let section: { text: string; result: ConditionResult } | null = null
  let evaluatedRules = 0

  // 段落判定用 `section ? section.result.value : true` 而**不是** `section?.result.value ?? true`：
  // `??` 只在 null/undefined 时回落，而段落判定为 null（「资料没说」）恰恰就是 null，
  // 于是「未开启P1boss(I)点」这种**机关闸门段**会被吞成 true 当作已满足，
  // 段内规则照样报 certain，`if (sectionValue == null)` 那条分支则永远走不到。
  //
  // 机关闸门段判定为 null 时必须原样传下去，吞成 true 就违背本文件头注立的约法
  //「只有此前没有未知分支 + 当前规则确定命中才输出 certain」
  //（2026-08-26 用户裁定：报成「必走」不是语义，是把不确定说成了确定）。

  const acceptRoutes = (routes: RoutingDecisionRoute[]) => {
    for (const route of routes) {
      if (candidateSet.size && !candidateSet.has(route.to)) continue
      possible.set(route.to, route)
    }
  }

  for (const rawRule of rules) {
    const rule = clean(rawRule)
    const gate = difficultyGate(rule, context)
    const destinations = destinationsOf(rule)
    if (!destinations.length) {
      const own = evaluateRoutingCondition(rule, context)
      const result: ConditionResult =
        gate === true
          ? own
          : gate === null
            ? { value: null, reason: rule }
            : { value: false }
      if (result.value !== null || result.reason) section = { text: rule, result }
      continue
    }
    evaluatedRules++
    if (gate === false) {
      // 这一条明写着属于别的难度，对当前难度不适用，跳过。
      // 但索敌类规则上游常常**只写甲的阈值**，别的难度根本没记载；直接跳过会让后面的
      // 「索敌不足 去X」以确定口吻兜底。所以记一笔不确定，把这个点位降级成「可能」。
      if (/分歧点系数/.test(rule)) unknownRules.push(rule)
      continue
    }
    const los = evaluateLosRule(rule, context)
    const sectionValue = gate === null ? null : section ? section.result.value : true

    if (los) {
      if (sectionValue === false) continue
      if (sectionValue == null) {
        acceptRoutes(los.routes)
        unknownRules.push(gate === null ? rule : section!.text)
        continue
      }
      if (!los.matched) continue
      acceptRoutes(los.routes)
      if (los.terminal) {
        const routes = [...possible.values()]
        return {
          status: unknownRules.length || routes.length !== 1 ? 'possible' : 'certain',
          routes,
          matchedRule: rule,
          evaluatedRules,
          unknownRules: unique(unknownRules).slice(0, 4),
        }
      }
      continue
    }

    const conditionText = conditionPartOf(rule)
    const ownCondition = evaluateRoutingCondition(conditionText, context)
    if (
      section &&
      !/^(其余|其他|其它)/.test(conditionText) &&
      conditionFamily(section.text) === conditionFamily(conditionText)
    ) {
      section = null
    }
    const activeSectionValue = gate === null ? null : section ? section.result.value : true
    const value =
      activeSectionValue === null || ownCondition.value === null
        ? null
        : activeSectionValue && ownCondition.value
    if (value === false) {
      if (/^(其余|其他|其它)/.test(conditionText)) section = null
      continue
    }
    const routes = destinations.map((to) => ({
      to,
      probability: probabilityOf(rule, to),
      reason: rule,
    }))
    if (value == null) {
      acceptRoutes(routes)
      unknownRules.push(gate === null ? rule : (ownCondition.reason ?? section?.text ?? rule))
      continue
    }
    acceptRoutes(routes)
    const uncertain = uncertainOutcome(rule, destinations)
    if (uncertain && routes.length === 1) {
      // “15% 去 I”之类还有后续失败判定，先保留 I，再继续往下算。
      unknownRules.push(rule)
      continue
    }
    const resultRoutes = [...possible.values()]
    return {
      status:
        unknownRules.length || uncertain || resultRoutes.length !== 1
          ? 'possible'
          : 'certain',
      routes: resultRoutes,
      matchedRule: rule,
      evaluatedRules,
      unknownRules: unique(unknownRules).slice(0, 4),
    }
  }

  const routes = [...possible.values()]
  return {
    status: routes.length ? 'possible' : 'unknown',
    routes,
    matchedRule: null,
    evaluatedRules,
    unknownRules: unique(unknownRules).slice(0, 4),
  }
}
