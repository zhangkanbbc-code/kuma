// 装备加成（装備ボーナス）的运行时口径 —— 第一方 schema 的**唯一**解释器。
//
// 数据基座是随包的 `kcwiki-fit-bonus`（CC BY-NC-SA，可分发）。字段语义见
// `scripts/fit-bonus-schema.md`，这里只负责「怎么算」，不重复抄字段表。
// EO 的 `FitBonuses.json` 自 2026-08-22 起**运行时零读取**，只在维护者侧当对账印证票。
//
// ---- 两层，别混 ----
//
// ① **预期层**（本文件的 `expectedFitBonus`）：查表算出来的「按资料应该加多少」。
// ② **实测层**（本文件的 `observedFitBonus`）：从游戏面板反推出来的「你这一艘实际吃到多少」。
//    关系：最终面板 = 舰娘裸值 + 近代化改修 + Σ装备原始值 + 加成，四项里三项已知 → 加成可解。
//
// 可信度阶梯（用户 2026-08-22 定稿）：**实测 > 日文近验 > kcwiki > EO**。
// 所以两者不一致时以实测为准，UI 双轨并列并显眼标差，不把预期值当结论。
//
// ---- 预期层算不出来的三类，一律如实挂着，不编数 ----
//
//   · `need.with[].group`（对水面电探 / 对空电探这类**类目**条件）——「多少索敌算对水面
//     电探」上游没写，包里也故意没展开成 id 表。调用方给的 `groupOf` 只在能确定时回
//     'yes'/'no'，说不准就回 'unknown'，这类行落 `pending`，不计入合计。
//   · `byArea`（出击北方海域才生效）——母港态判不出来，落 `area`。
//   · 包里根本没有的装备（上游还没收录的新装备）——落 `uncovered`。
//
// 这三类的实际加成会自然落进「实测 − 预期」的差值里，展示上如实呈现差异即可。
// 不可见的「主炮适重 / 命中 fit」不进面板、也反推不出，本项目不实装（spec 明令）。

export const FIT_STAT_KEYS = [
  'fire',
  'torpedo',
  'bomb',
  'aa',
  'armor',
  'evasion',
  'asw',
  'los',
  'accuracy',
  'range',
] as const

export type FitStatKey = (typeof FIT_STAT_KEYS)[number]

/** 中文标签。UI 只从这里取，别在模块里各写一份。 */
export const FIT_STAT_LABEL: Readonly<Record<FitStatKey, string>> = {
  fire: '火力',
  torpedo: '雷装',
  bomb: '爆装',
  aa: '对空',
  armor: '装甲',
  evasion: '回避',
  asw: '对潜',
  los: '索敌',
  accuracy: '命中',
  range: '射程',
}

export type FitStats = Partial<Record<FitStatKey, number>>

export interface FitWhoSet {
  forms?: number[]
  classes?: number[]
  types?: number[]
  all?: boolean
  /**
   * 国籍（`shared/ship-nationality` 的 id）。**与其余几维是「且」，不是「或」**——
   * 上游的国籍类目从来是「国籍 × 舰种」的交（「日駆逐」「イギリス空母」），
   * 写成第五个并列维度会把「日駆逐」变成「日本舰或驱逐舰」。
   *
   *   「イギリス艦」   = { nations: [5] }（不写其余几维 = 该国籍全部舰船）
   *   「日駆逐」       = { nations: [1], types: [2] }
   *   「イギリス空母」 = { nations: [5], types: [7, 11, 18] }
   *
   * 判据走号段（`shipNationalityIdFromSortId`）。**上游明写例外时以明文为准**：
   * 这类蓝字类目是 wiki 按国籍写的静态类目，不是策划的特効名单，与活动倍卡那边
   * 逐期点名的例外表（`event-bonus-nationality.ts`）不是一回事，别互相套用。
   */
  nations?: number[]
}

export interface FitNeedSlot {
  any?: number[]
  group?: string
}

export interface FitNeed {
  star?: number
  with?: FitNeedSlot[]
}

export type FitGain =
  | { kind: 'flat'; flat: FitStats }
  | { kind: 'byStar'; steps: { from: number; to: number | null; stats: FitStats }[] }
  | { kind: 'byCount'; counts: { count: number; stats: FitStats }[] }
  | { kind: 'byArea'; areas: { area: string; stats: FitStats }[] }

export interface FitRule {
  row: number
  who: FitWhoSet
  not?: FitWhoSet
  need?: FitNeed
  gain: FitGain
  stack: 'perEquip' | 'once' | 'table'
  cap?: number
  setTotal?: FitStats
  /**
   * 第一方修正台账注入的补正行（`src/shared/fit-bonus-corrections.ts`）。
   * 值是「凭什么这么改」的一句话，直接进 UI。补正行**不参与分层**（见下方 baseFloor）。
   */
  correction?: string
  /**
   * 分层组。**不同组之间各自分层、互不压制**。
   *
   * 上游偶尔把同一件装备的加成写成并列的两张表并明说相加
   * （577 号那页：「※単体ボーナス＝単体ボーナス1＋単体ボーナス2」）。
   * 没有这一维时，「単体ボーナス1 的舰种行」会被「単体ボーナス2 的形态行」
   * 按 baseFloor 压掉——那两张表本来就该相加，压掉是错的。
   *
   * 缺省（不写）= 同一组。上游随包的行从不写它，所以这一维不进
   * `fitRuleFingerprint`（进了会让修正台账已有的指纹全部作废）。
   */
  layer?: string
}

export interface FitEquipEntry {
  id: number
  nameJa: string
  nameZh: string
  rules: FitRule[]
}

export interface FitBonusData {
  schemaVersion: number
  equipGroups: Record<string, { zh: string; tokens: string[] }>
  equips: Record<string, FitEquipEntry>
  unresolved: unknown[]
  /**
   * 第一方自补层（`fit-bonus-supplement.ts`）挂上来的「**这几件有加成，但我们还没落地**」。
   *
   * 自补层一旦补进 588 号，`fitPackCoverageMax` 就跳到 588，于是那几件**取到了票却转写不进来**的
   * （国籍类目表达不了、表格没解析出来）会从「暂无预期数据」悄悄变成「它就是没加成」——
   * 那是把一个已知的缺口说成了结论。列在这里的 id 一律仍按 `uncovered` 显示。
   */
  supplementPending?: readonly number[]
}

/** 一艘舰在判定里用得上的几个维度。多余的字段一律不要——纯函数好测。 */
export interface FitShipView {
  formId: number
  ctype: number
  stype: number
  /**
   * 国籍 id（`shared/ship-nationality`）。缺省/0 = 判不出，
   * 带 `nations` 的条件一律**不命中**（宁可少算，不给一个说不出来路的数）。
   */
  nationality?: number
}

/** 舰上的一件装备。`type2` = `api_type[2]`，只给 `groupOf` 判类目用。 */
export interface FitLoadoutItem {
  mstId: number
  star: number
  type2?: number
}

export type FitGroupState = 'yes' | 'no' | 'unknown'

/**
 * 类目条件的判定器。**只有确定时才准回 'yes'/'no'**，说不准一律 'unknown'。
 * 现实里能确定的只有半边：舰上一件电探都没有 → 'no' 是铁的；装了电探但
 * 「索敌到几算对水面电探」上游没写 → 'unknown'，不许替它拍板。
 */
export type FitGroupResolver = (
  group: string,
  pool: readonly FitLoadoutItem[],
) => FitGroupState

export type FitLineState = 'counted' | 'pending' | 'area'

export interface FitExpectedLine {
  equipId: number
  /** 上游 `额外收益N` 的 N；修正行是 0 */
  row: number
  /** 命中理由：形态 / 舰级 / 舰种 / 全部舰船 / 第一方修正 */
  via: string
  /** 这一行实际计了几次（`perEquip` 按件数，`once`/`table` 恒为 1） */
  times: number
  /** 已乘完次数的数值 */
  stats: FitStats
  rule: FitRule
  state: FitLineState
  /** `pending` 时说明卡在哪个类目上 */
  pendingGroups?: string[]
}

export interface FitExpected {
  /** `counted` 行的合计。有 `pending`/`area`/`uncovered` 时这是**下限**，不是定论 */
  stats: FitStats
  lines: FitExpectedLine[]
  /** 舰上这些装备包里没有记录（上游还没收录）；不等于「它没有加成」 */
  uncovered: number[]
  /** 合计是不是完整的：三类未知任一非空就不是 */
  complete: boolean
}

// ---- 小工具 ----

const addStats = (into: FitStats, from: FitStats | undefined, times = 1): FitStats => {
  for (const key of FIT_STAT_KEYS) {
    const value = from?.[key]
    if (!value) continue
    into[key] = (into[key] ?? 0) + value * times
  }
  return into
}

export const fitStatsEmpty = (stats: FitStats | null | undefined): boolean => {
  if (!stats) return true
  for (const key of FIT_STAT_KEYS) if (stats[key]) return false
  return true
}

/** 稳定文本形式，指纹与显示共用（零值不写，键按固定顺序）。 */
export const fitStatsText = (stats: FitStats | null | undefined): string =>
  FIT_STAT_KEYS.filter((key) => stats?.[key])
    .map((key) => `${FIT_STAT_LABEL[key]}${stats![key]! > 0 ? '+' : ''}${stats![key]}`)
    .join(' ')

// 规则指纹（修正台账的自失效判据）住在 `fit-bonus-corrections.ts`——那是它唯一的用户，
// 且那个文件必须做到**零值导入**（只 `import type`），才能被 node --test 直接跑。

// ---- 适用集合 ----

/**
 * 命中层级：形态 3 > 舰级 2 > 舰种 1 > 全部 0；没命中 -1。
 *
 * `nations` 是**过滤器**不是并列维度：写了就必须先对上国籍，再由其余几维定层级
 * （「日駆逐」= 日本籍 且 驱逐舰 → 舰种层）。只写国籍不写其余几维 = 该国籍全部舰船，
 * 落在「全部」这一层——它比裸的「全部舰船」窄，但比舰种宽，而这一档上游从不
 * 与裸「全部舰船」行并存，所以不为它另开一层（另开会把 FIT_VIA_LABEL 的下标全挪位）。
 */
export const fitSetLevel = (set: FitWhoSet | undefined, ship: FitShipView): number => {
  if (!set) return -1
  if (set.nations?.length && !set.nations.includes(ship.nationality ?? 0)) return -1
  if (set.forms?.includes(ship.formId)) return 3
  if (set.classes?.includes(ship.ctype)) return 2
  if (set.types?.includes(ship.stype)) return 1
  if (set.all) return 0
  // 只写了国籍、其余几维一个都没写 = 「这个国籍的全部舰船」。
  // 写了其余维度却没对上（「日駆逐」碰上日本籍轻巡）必须是 -1——
  // 掉回 0 就等于把「国籍 × 舰种」偷偷放宽成「这个国籍全都算」。
  if (!set.nations?.length) return -1
  return set.forms?.length || set.classes?.length || set.types?.length ? -1 : 0
}

export const FIT_VIA_LABEL: readonly string[] = ['全部舰船', '舰种', '舰级', '当前形态']

/** 这条规则适用于这艘舰吗；返回命中层级（-1 = 不适用，`not` 命中也算不适用）。 */
export const fitRuleLevel = (rule: FitRule, ship: FitShipView): number => {
  const level = fitSetLevel(rule.who, ship)
  if (level < 0) return -1
  return fitSetLevel(rule.not, ship) >= 0 ? -1 : level
}

// ---- 预期层 ----

/**
 * 分档写的是**该档的总值**，不是增量（依据见 schema「gain」一节）。
 * `to` 为 null = 该档起直到下一档之前。
 */
const stepForStar = (gain: Extract<FitGain, { kind: 'byStar' }>, star: number): FitStats | null => {
  let picked: FitStats | null = null
  for (const step of gain.steps) {
    if (step.from > star) continue
    if (step.to != null && star > step.to) continue
    picked = step.stats
  }
  return picked
}

const countStep = (gain: Extract<FitGain, { kind: 'byCount' }>, count: number): FitStats | null => {
  let picked: FitStats | null = null
  for (const step of gain.counts) {
    if (step.count <= count) picked = step.stats
  }
  return picked
}

/**
 * 协同条件（`need.with`）的判定。
 *
 * 一个元素 = 一个槽位，同一个装备写两遍就是要两件，所以具名槽位要**逐个占用**
 * 不同的实例。类目槽位判不出占用的是哪一件（连「哪些 id 算这个类目」都没定），
 * 只判有没有——判不准就回 unknown，整条落 pending。
 */
const checkWith = (
  need: FitNeed | undefined,
  pool: readonly FitLoadoutItem[],
  groupOf: FitGroupResolver | undefined,
): { ok: boolean; pendingGroups: string[] } => {
  const slots = need?.with
  if (!slots?.length) return { ok: true, pendingGroups: [] }
  const used = new Set<number>()
  const pendingGroups: string[] = []
  for (const slot of slots) {
    if (slot.group) {
      const state = groupOf ? groupOf(slot.group, pool) : 'unknown'
      if (state === 'no') return { ok: false, pendingGroups: [] }
      if (state === 'unknown') pendingGroups.push(slot.group)
      continue
    }
    const ids = slot.any ?? []
    const at = pool.findIndex((item, index) => !used.has(index) && ids.includes(item.mstId))
    if (at < 0) return { ok: false, pendingGroups: [] }
    used.add(at)
  }
  return { ok: pendingGroups.length === 0, pendingGroups }
}

/**
 * 这艘舰、这套配装的**预期加成**。
 *
 * 分层规则（`baseFloor`）：命中同一艘舰的**无条件基础行**里，只留最具体的那一层——
 * 有形态行就不再叠舰级行，没有形态行才退到舰级、再退到舰种。
 * 这不是语感，是拿 EO 当第二把尺子在 9490 格上量出来的（`scripts/fit-bonus-reconcile.mjs`
 * 的 `model`：specific 9490 vs additive 9479）。带 `need.star` 的是**逐档追加**（同一个
 * `who` 上写好几行、门槛递增，如 136 号 ★3/★6/★10 各 +1 装甲），所以不进分层、命中就加；
 * 带 `need.with` 的协同行同理；`byArea` 与修正行也都在分层之外。
 */
export const expectedFitBonus = (
  data: FitBonusData | null | undefined,
  ship: FitShipView,
  loadout: readonly FitLoadoutItem[],
  groupOf?: FitGroupResolver,
): FitExpected => {
  const stats: FitStats = {}
  const lines: FitExpectedLine[] = []
  const uncovered: number[] = []
  if (!data?.equips) return { stats, lines, uncovered, complete: false }

  const seen = new Set<number>()
  for (const item of loadout) {
    if (item.mstId <= 0 || seen.has(item.mstId)) continue
    seen.add(item.mstId)
    const entry = data.equips[`${item.mstId}`]
    if (!entry) {
      if (fitPackUncovered(data, item.mstId)) uncovered.push(item.mstId)
      continue
    }
    const instances = loadout.filter((other) => other.mstId === item.mstId)
    const matched = entry.rules
      .map((rule) => ({ rule, level: fitRuleLevel(rule, ship) }))
      .filter((row) => row.level >= 0)
    const layered = matched.filter(
      (row) =>
        !row.rule.correction &&
        !row.rule.need?.with &&
        !row.rule.need?.star &&
        row.rule.gain.kind !== 'byArea',
    )
    // 分层按 `rule.layer` 分组各算各的下限：上游偶尔把同一件的加成写成并列两张表
    // 并明说相加（577 号「※単体ボーナス＝単体ボーナス1＋単体ボーナス2」），
    // 共用一个下限会让一张表的舰种行被另一张表的形态行压掉。缺省组是 ''，
    // 上游随包的行都不写 layer，所以那边行为一格不变。
    const baseFloorOf = new Map<string, number>()
    for (const row of layered) {
      const key = row.rule.layer ?? ''
      baseFloorOf.set(key, Math.max(baseFloorOf.get(key) ?? -1, row.level))
    }

    for (const { rule, level } of matched) {
      const layeredHere =
        !rule.correction && !rule.need?.with && !rule.need?.star && rule.gain.kind !== 'byArea'
      if (layeredHere && level < (baseFloorOf.get(rule.layer ?? '') ?? -1)) continue

      // 本装备自己的改修门槛：不到门槛的那几件不算数
      const minStar = rule.need?.star ?? 0
      let eligible = instances.filter((one) => (one.star ?? 0) >= minStar)
      if (!eligible.length) continue
      // `cap` 只准算几件时，留改修最高的那几件（游戏也是按更好的那几件算）
      if (rule.cap != null && eligible.length > rule.cap) {
        eligible = [...eligible].sort((a, b) => (b.star ?? 0) - (a.star ?? 0)).slice(0, rule.cap)
      }

      // 协同条件在**除本行已占用的那几件之外**的池子里找
      const pool = loadout.filter((one) => !eligible.includes(one))
      const withCheck = checkWith(rule.need, pool, groupOf)
      if (!withCheck.ok && !withCheck.pendingGroups.length) continue

      const line = fitRuleContribution(entry.id, rule, level, eligible)
      if (!line) continue
      if (withCheck.pendingGroups.length) {
        line.state = 'pending'
        line.pendingGroups = withCheck.pendingGroups
      }
      lines.push(line)
      if (line.state === 'counted') addStats(stats, line.stats)
    }
  }

  // 补正把某一栏正好抹平时（如 464「10cm連装高角砲群 集中配備」对榛名改二乙/丙的免罚），
  // 合计里会留下一个 `evasion: 0`。零值不是结论也不是数据，摘掉——留着会让
  // 「这一格有没有加成」变成一个要读值才知道的问题，逐条 deepEqual 的护栏也会被它绊住。
  for (const key of FIT_STAT_KEYS) if (stats[key] === 0) delete stats[key]

  return {
    stats,
    lines,
    uncovered,
    complete: !uncovered.length && lines.every((line) => line.state === 'counted'),
  }
}

const fitRuleContribution = (
  equipId: number,
  rule: FitRule,
  level: number,
  eligible: readonly FitLoadoutItem[],
): FitExpectedLine | null => {
  const via = rule.correction ? '第一方修正' : (FIT_VIA_LABEL[level] ?? '—')
  const base = { equipId, row: rule.row, via, rule, state: 'counted' as FitLineState }
  const gain = rule.gain

  if (gain.kind === 'byArea') {
    // 出击海域母港态判不出来，只列不算（当前只有 268 号「北方迷彩」一条）
    return { ...base, times: 1, stats: {}, state: 'area' }
  }
  if (gain.kind === 'byCount') {
    // `table`：那张表本身就是规则，不再另行倍乘
    const picked = countStep(gain, eligible.length)
    if (!picked) return null
    return { ...base, times: 1, stats: addStats({}, picked) }
  }
  const statsOf = (item: FitLoadoutItem): FitStats | null =>
    gain.kind === 'flat' ? gain.flat : stepForStar(gain, item.star ?? 0)

  if (rule.stack === 'once') {
    // 只加一次：分档取改修最高的那一件（更低的那几件不会让它变差）
    const best = [...eligible].sort((a, b) => (b.star ?? 0) - (a.star ?? 0))[0]
    const picked = statsOf(best)
    if (!picked) return null
    return { ...base, times: 1, stats: addStats({}, picked) }
  }
  const total: FitStats = {}
  let times = 0
  for (const one of eligible) {
    const picked = statsOf(one)
    if (!picked) continue
    addStats(total, picked)
    times += 1
  }
  if (!times) return null
  return { ...base, times, stats: total }
}

/** 包里覆盖到的最大装备 id。超过它的装备「没有记录」= 上游还没收录，不等于「没有加成」。 */
export const fitPackCoverageMax = (data: FitBonusData | null | undefined): number => {
  let max = 0
  for (const key of Object.keys(data?.equips ?? {})) {
    const id = Number(key)
    if (Number.isFinite(id) && id > max) max = id
  }
  return max
}

/** 这件装备落在包的覆盖范围之外吗（= 该显示「暂无预期数据」而不是「没有加成」）。 */
export const fitPackUncovered = (
  data: FitBonusData | null | undefined,
  equipId: number,
): boolean => {
  if (data?.equips?.[`${equipId}`]) return false
  // 自补层明说「这件有加成、只是我们还没落地」的，即使 id 落在覆盖范围之内也仍算未覆盖
  if (data?.supplementPending?.includes(equipId)) return true
  return equipId > fitPackCoverageMax(data)
}

/** 反查：哪些装备对这艘舰有加成（图鉴舰娘卷的「装备加成」页问的就是这个）。 */
export const fitEquipsForShip = (
  data: FitBonusData | null | undefined,
  ship: FitShipView,
): { entry: FitEquipEntry; rules: { rule: FitRule; level: number }[]; topLevel: number }[] => {
  const out: { entry: FitEquipEntry; rules: { rule: FitRule; level: number }[]; topLevel: number }[] = []
  for (const entry of Object.values(data?.equips ?? {})) {
    const rules: { rule: FitRule; level: number }[] = []
    for (const rule of entry.rules) {
      const level = fitRuleLevel(rule, ship)
      if (level >= 0) rules.push({ rule, level })
    }
    if (rules.length) {
      out.push({ entry, rules, topLevel: Math.max(...rules.map((row) => row.level)) })
    }
  }
  return out.sort((a, b) => b.topLevel - a.topLevel || a.entry.id - b.entry.id)
}

// ---- 实测层：面板反推 ----
//
// 七项：火力/雷装/对空/装甲 + 回避/对潜/索敌。两组的**裸值来路不一样**，别混：
//
//   · 前四项裸值不随等级变，直接取 `api_mst_ship` 的 [初始,最大] 的初始。
//   · 后三项主数据里**根本没有**，裸值是 `插值(成长端点, 等级)` 算出来的
//     （公式与端点表见 `shared/ship-growth.ts`）。端点来自第一方 `ship-stats` 汇编包，
//     而端点表**会腐坏**（C2 单独抬高过成长上限，公告只说谁的哪一项 up），
//     所以每个 (形态, 项) 都要先过**标定闸门**——拿你自己的空槽舰验过零残差才准出数。
//     闸门判 `fail` / `noEndpoint` 的项**不出行**，如实落在 `skipped` 里，
//     不摆一个算不准的数。
//
// 2026-08-22 之前这三项不做，理由写的是「插值会带 ±1 舍入误差」。那条理由**是错的**：
// 插值是精确整数运算（`base + floor((max−base)×Lv/99)`），账本 186 艘空槽舰 × 三项
// 490 格零残差通过，带装备的 73 艘七项一个负残差都没有。真正的风险从来不是舍入，
// 是端点表过期——所以对策是闸门，不是不做。
//
// 差值语义要说清：它 = 装备加成 + 装备改修(★)带来的那部分。所以预期层要把 `byStar`
// 的档一并算进去再比，不然会把改修加成误报成偏差。

import type { GrowthGate } from './ship-growth'

export type FitPanelKey = 'fire' | 'torpedo' | 'aa' | 'armor' | 'evasion' | 'asw' | 'los'

/** 面板反推可比的七项。展示顺序按这里。 */
export const FIT_PANEL_KEYS: readonly FitPanelKey[] = [
  'fire',
  'torpedo',
  'aa',
  'armor',
  'evasion',
  'asw',
  'los',
]

/** 裸值不随等级变的四项（主数据直给）。 */
export const FIT_PANEL_FLAT_KEYS: readonly FitPanelKey[] = ['fire', 'torpedo', 'aa', 'armor']

/** 裸值随等级插值的三项（主数据没有，要端点表 + 闸门）。 */
export const FIT_PANEL_GROWTH_KEYS: readonly FitPanelKey[] = ['evasion', 'asw', 'los']

/**
 * `api_kyouka` 里对应的下标。数组是 [火,雷,空,甲,运,耐,潜] 七位——
 * **对潜有近代化改修**（下标 6，账本三例实证），回避与索敌没有。
 */
const FIT_KYOUKA_INDEX: Readonly<Partial<Record<FitPanelKey, number>>> = {
  fire: 0,
  torpedo: 1,
  aa: 2,
  armor: 3,
  asw: 6,
}

export type FitPanelStats = Partial<Record<FitPanelKey, number>>

export interface FitPanelInput {
  /** `api_ship` 的面板值（已含全部加成） */
  panel: FitPanelStats
  /**
   * 裸值。四项取 `api_mst_ship` 的初始；三项传**插值算好的成长值**。
   * 传 `null`/缺 = 这一项算不了（端点缺、或闸门禁用），该项不出行。
   */
  base: Partial<Record<FitPanelKey, number | null>>
  /** `api_kyouka`：[火力, 雷装, 对空, 装甲, 运, 耐久, 对潜] */
  kyouka: readonly number[]
  /** 所载装备的 `api_mst_slotitem` 原始值 + 改修等级 */
  equips: readonly (FitPanelStats & { star?: number })[]
  /** 三项各自的闸门判定。只为把「这一项为什么没出/出了但没验过」说清楚 */
  gate?: Partial<Record<FitPanelKey, GrowthGate>>
}

export interface FitObservedRow {
  key: FitStatKey
  label: string
  /** 实测Bonus = 面板 − 裸值 − 近代化改修 − Σ装备原始值 */
  observed: number
  /** 成长三项才有：这一项的成长端点在你的舰上标定过没有 */
  gate?: GrowthGate
}

export interface FitObservedSkip {
  key: FitStatKey
  label: string
  gate: GrowthGate
}

export interface FitObserved {
  rows: FitObservedRow[]
  /** 所载装备全 ★0 → 差值即纯装备加成，不含改修那部分 */
  pure: boolean
  /** 有任一项非零 */
  any: boolean
  stats: FitStats
  /**
   * **没能出行**的成长项（端点缺 / 闸门判残差非零）。
   * 界面要如实说出来——一项凭空消失，读的人会以为「它没有加成」。
   */
  skipped: FitObservedSkip[]
  /** 出了行、但成长端点还没在你的舰上标定过的项（`unverified`） */
  unverified: FitStatKey[]
}

/**
 * 面板反推。**被动只读**：输入全是账本里现成的快照，不发任何请求。
 *
 * 聚合口径（重要）：这是**逐舰逐槽的观察值**，只对「当前装备着的这一艘 × 这一套配装」
 * 成立，不是一张全表。同一件装备在不同舰上的观察值不一致时要**如实并列**
 *（谁装的、什么配装、多少），绝不平均成一个假数——平均值既不属于任何一艘舰，
 * 也掩盖了「其中一边的条件没算对」这件真正要看见的事。
 */
export const observedFitBonus = (input: FitPanelInput): FitObserved => {
  const rows: FitObservedRow[] = []
  const skipped: FitObservedSkip[] = []
  const unverified: FitStatKey[] = []
  for (const key of FIT_PANEL_KEYS) {
    const statKey = key as FitStatKey
    const growth = FIT_PANEL_GROWTH_KEYS.includes(key)
    const base = input.base[key]
    if (base == null) {
      // 四项裸值主数据必有，缺了是上游异常，静默跳过即可（不是要给玩家看的事）；
      // 三项缺了是**结论性的信息**（端点缺 / 闸门禁用），必须说出来
      if (growth) {
        skipped.push({ key: statKey, label: FIT_STAT_LABEL[statKey], gate: input.gate?.[key] ?? 'noEndpoint' })
      }
      continue
    }
    const kyoukaAt = FIT_KYOUKA_INDEX[key]
    const fromEquip = input.equips.reduce((acc, equip) => acc + (equip[key] ?? 0), 0)
    const row: FitObservedRow = {
      key: statKey,
      label: FIT_STAT_LABEL[statKey],
      observed:
        (input.panel[key] ?? 0) -
        base -
        (kyoukaAt == null ? 0 : input.kyouka[kyoukaAt] ?? 0) -
        fromEquip,
    }
    if (growth) {
      row.gate = input.gate?.[key] ?? 'unverified'
      if (row.gate === 'unverified') unverified.push(statKey)
    }
    rows.push(row)
  }
  const stats: FitStats = {}
  for (const row of rows) if (row.observed) stats[row.key] = row.observed
  return {
    rows,
    pure: input.equips.every((equip) => (equip.star ?? 0) === 0),
    any: rows.some((row) => row.observed !== 0),
    stats,
    skipped,
    unverified,
  }
}

// ---- 双轨对照 ----

export interface FitTrackRow {
  key: FitStatKey
  label: string
  expected: number
  observed: number
  diff: number
  /** 成长三项才有：这一项的成长端点标定过没有 */
  gate?: GrowthGate
}

/**
 * 预期 vs 实测。**只对实测真出了行的项出行**——被闸门挡下的那几项摆一列空的
 * 等于假装比过了，那几项要走 `observed.skipped` 单独如实说。
 * `diff = 实测 − 预期`：正数 = 实测比资料多（多半是包里没有的那一层，如电探分档），
 * 负数 = 资料给多了（条件没满足，或那条规则本身有问题）。
 */
export const fitTrackRows = (expected: FitStats, observed: FitObserved): FitTrackRow[] =>
  observed.rows.map((row) => {
    const want = expected[row.key] ?? 0
    return {
      key: row.key,
      label: row.label,
      expected: want,
      observed: row.observed,
      diff: row.observed - want,
      gate: row.gate,
    }
  })
