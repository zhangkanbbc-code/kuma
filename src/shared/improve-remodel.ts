// 改修素材的游戏实测（维护者 2026-11-28 问：「可不可以让 kuma 识别『改修这个行为之后的装备变化』来判断素材？」
// 「能否区分开是普通改修还是保正改修？」）。
//
// 每改修一次，游戏的 remodel_slot 响应就把答案交出来：api_use_slot_id 是这次吞掉的装备实例，
// api_after_material 是扣完之后的资源，请求里的 api_certain_flag 说这次是不是确保改修（'1'）。
// 改修前把实例对成装备号、资源对出差额，就知道「这件装备这一档、这次打法，游戏实际要了什么」。
// 素材装备普通与确保一样；开发资材、改修资材两种打法各学各的。
// 纯逻辑、无 DOM。记录在 main/mg/ledger（improve_remodels），显示在鉴的「今日改修」与装备详情。

export type ImproveStage = 'p1' | 'p2' | 'conv'

/** 一次改修扣掉的资源（燃弹钢铝、开发资材、改修资材） */
export interface ImproveRemodelCost {
  fuel: number
  bull: number
  steel: number
  baux: number
  devmats: number
  screws: number
}

/** 一次改修：改的是哪件、几星，什么打法，成没成，吞了哪些装备，扣了多少资源 */
export interface ImproveRemodel {
  ts: number
  /** 改修前的装备号 */
  eq: number
  /** 改修前的星级；说不出时 null（这一条就不拿来学） */
  level: number | null
  /** 改修后的装备号与星级（成功才有；更新时装备号会变） */
  afterEq: number | null
  afterLevel: number | null
  /** 确保改修（api_certain_flag＝1）：必成，开发资材与改修资材另是一个价 */
  certain: boolean
  ok: boolean
  /** 当时的二号舰（舰船 mst id）；说不出时 null */
  helper: number | null
  /** 吞掉的装备（装备号 × 件数，按装备号升序）；有实例对不上装备号时 null，不拿它学素材 */
  fodder: { id: number; count: number }[] | null
  /** 扣掉的资源；对不出差额时 null */
  cost: ImproveRemodelCost | null
  /** live＝当场记的；backfill＝从账本里的旧报文补的 */
  source: 'live' | 'backfill'
}

/** ★0-5 / ★6-9 / ★max 更新，与改修表分档同口径 */
export const improveStageOfLevel = (level: number): ImproveStage => (level >= 10 ? 'conv' : level >= 6 ? 'p2' : 'p1')

/** 吞掉的装备实例对成「装备号 × 件数」；有一件对不上就整条说不出（null） */
export const fodderOfInstances = (
  instanceIds: readonly number[],
  mstOf: (instanceId: number) => number | null | undefined,
): { id: number; count: number }[] | null => {
  const counts = new Map<number, number>()
  for (const instance of instanceIds) {
    const mst = Number(mstOf(Number(instance)))
    if (!(mst > 0)) return null
    counts.set(mst, (counts.get(mst) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0] - b[0]).map(([id, count]) => ({ id, count }))
}

/** 改修前后的资源数组（[燃,弹,钢,铝,高速建造,高速修复,开发,改修]）对出这次扣了多少 */
export const remodelCostOf = (before: readonly number[] | null | undefined, after: readonly unknown[] | null | undefined): ImproveRemodelCost | null => {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length < 8 || after.length < 8) return null
  const spent = (index: number) => Number(before[index]) - Number(after[index])
  const cost = { fuel: spent(0), bull: spent(1), steel: spent(2), baux: spent(3), devmats: spent(6), screws: spent(7) }
  return Object.values(cost).every((value) => Number.isFinite(value)) ? cost : null
}

/**
 * 改修前的星级：同一件装备改完 ★N，改之前就是 ★N-1；装备号变了是更新，更新只在 ★max 做。
 * 响应自己说得出就信响应；失败（星级不动）或说不出才用调用方另给的（knownLevel）。
 */
export const remodelLevelBefore = (
  ok: boolean,
  eq: number,
  afterEq: number | null,
  afterLevel: number | null,
  knownLevel: number | null,
): number | null => {
  if (ok && afterEq != null) {
    if (afterEq !== eq) return 10
    if (afterLevel != null && afterLevel > 0) return afterLevel - 1
  }
  return knownLevel != null && Number.isFinite(knownLevel) ? knownLevel : null
}

/**
 * 一份 remodel_slot 响应（api_data）连同请求整理成一条改修记录。只读报文，不发请求。
 * target 是改修前那件装备（实例对得上时）；mstOf 把吞掉的实例对成装备号；helper、cost 由调用方另给。
 */
export const remodelOfResponse = (input: {
  ts: number
  body: any
  post: Record<string, string | undefined>
  target: { mstId: number; level: number } | null
  mstOf: (instanceId: number) => number | null | undefined
  helper: number | null
  cost: ImproveRemodelCost | null
  source: 'live' | 'backfill'
}): ImproveRemodel | null => {
  const body = input.body ?? {}
  const ids = Array.isArray(body.api_remodel_id) ? body.api_remodel_id.map(Number) : []
  const eq = Number(input.target?.mstId) > 0 ? Number(input.target!.mstId) : Number(ids[0])
  if (!(eq > 0)) return null
  const ok = Number(body.api_remodel_flag) === 1
  const after = body.api_after_slot
  const afterEq = ok ? Number(after?.api_slotitem_id) || Number(ids[1]) || null : null
  const afterLevel = ok && after && Number.isFinite(Number(after.api_level)) ? Number(after.api_level) : null
  const level = remodelLevelBefore(ok, eq, afterEq, afterLevel, input.target ? Number(input.target.level) : null)
  const used = Array.isArray(body.api_use_slot_id) ? body.api_use_slot_id.map(Number).filter((id: number) => id > 0) : []
  return {
    ts: input.ts,
    eq,
    level,
    afterEq,
    afterLevel,
    certain: String(input.post?.api_certain_flag ?? '') === '1',
    ok,
    helper: Number(input.helper) > 0 ? Number(input.helper) : null,
    fodder: fodderOfInstances(used, input.mstOf),
    cost: input.cost,
    source: input.source,
  }
}

/**
 * 这件装备、这一档（或这一星），游戏实际要了什么：素材装备取最近一次；
 * 开发 / 改修资材普通改修、确保改修各取各的最近一次（素材装备两种打法一样）。
 */
export interface LearnedImproveStage {
  eq: number
  stage: ImproveStage
  afterEq: number | null
  fodder?: { items: { id: number; count: number }[]; ts: number; helper: number | null }
  normal?: { devmats: number; screws: number; ts: number }
  certain?: { devmats: number; screws: number; ts: number }
}

type LearnedSide = 'fodder' | 'normal' | 'certain'
const SIDES: readonly LearnedSide[] = ['fodder', 'normal', 'certain']

const fodderSig = (items: readonly { id: number; count: number }[]): string =>
  JSON.stringify([...items].map((one) => [Number(one.id), Number(one.count)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]))

const sideSig = (learned: LearnedImproveStage, side: LearnedSide): string | null => {
  if (side === 'fodder') return learned.fodder ? fodderSig(learned.fodder.items) : null
  const one = learned[side]
  return one ? `${one.devmats}|${one.screws}` : null
}

/**
 * 一档里每一星各自最近一次的实测（星级 → 实测）。
 * 同一档里不同星级要的素材可以不一样：熟练见张员 ★6→7 只吞 1 个熟练见张员，★7 起每次再加 1 个战斗粮食
 *（维护者账本 11-24 的 8 次改修），资料按档只写了前者，所以先按星记，再看档内对不对得上。
 * - 更新档（conv）按更新目标分：同一件装备不同目标的素材本来就不一样；失败的更新不知道冲的是哪个目标，不拿来学。
 * - helpers 给了就只认这些二号舰当时做的（二号舰说不出的记录照认）：改修表里有少数装备素材跟二号舰走。
 */
export const learnedImproveByLevel = (
  remodels: readonly ImproveRemodel[],
  eq: number,
  stage: ImproveStage,
  opts: { afterEq?: number | null; helpers?: readonly number[] } = {},
): Map<number, LearnedImproveStage> => {
  const out = new Map<number, LearnedImproveStage>()
  if (stage === 'conv' && !(Number(opts.afterEq) > 0)) return out
  const afterEq = stage === 'conv' ? Number(opts.afterEq) : null
  const helpers = (opts.helpers ?? []).map(Number).filter((id) => id > 0)
  for (const r of remodels) {
    if (r.eq !== eq || r.level == null || improveStageOfLevel(r.level) !== stage) continue
    if (stage === 'conv' && (!r.ok || r.afterEq !== afterEq)) continue
    if (helpers.length && r.helper != null && !helpers.includes(r.helper)) continue
    const learned = out.get(r.level) ?? { eq, stage, afterEq }
    let touched = false
    if (r.fodder && (!learned.fodder || learned.fodder.ts < r.ts)) {
      learned.fodder = { items: r.fodder.map((one) => ({ ...one })), ts: r.ts, helper: r.helper }
      touched = true
    }
    if (r.cost && r.cost.devmats >= 0 && r.cost.screws >= 0) {
      const side = r.certain ? 'certain' : 'normal'
      const prev = learned[side]
      if (!prev || prev.ts < r.ts) {
        learned[side] = { devmats: r.cost.devmats, screws: r.cost.screws, ts: r.ts }
        touched = true
      }
    }
    if (touched) out.set(r.level, learned)
  }
  return out
}

/**
 * 整档的实测：档内实测过的各星对得上的那一项才算这一档的（取最近一次）；对不上的记进 mixed，
 * 那一项只能按星看（learnedImproveLevel / learnedFodderGroups），不拿某一星的去冒充整档。没有一条可学就 null。
 */
export const learnedImproveStage = (
  remodels: readonly ImproveRemodel[],
  eq: number,
  stage: ImproveStage,
  opts: { afterEq?: number | null; helpers?: readonly number[] } = {},
): (LearnedImproveStage & { mixed: LearnedSide[] }) | null => {
  const byLevel = learnedImproveByLevel(remodels, eq, stage, opts)
  if (!byLevel.size) return null
  const first = byLevel.values().next().value as LearnedImproveStage
  const learned: LearnedImproveStage & { mixed: LearnedSide[] } = { eq, stage, afterEq: first.afterEq, mixed: [] }
  for (const side of SIDES) {
    const seen = [...byLevel.values()].filter((one) => sideSig(one, side) != null)
    if (!seen.length) continue
    if (new Set(seen.map((one) => sideSig(one, side))).size > 1) {
      learned.mixed.push(side)
      continue
    }
    const latest = seen.reduce((a, b) => ((a[side]?.ts ?? 0) >= (b[side]?.ts ?? 0) ? a : b))
    ;(learned as any)[side] = latest[side]
  }
  return learned
}

/** 某一星（改修前星级）的实测：这一星实测过的那一项取这一星的，没测过的取整档的（档内对得上时） */
export const learnedImproveLevel = (
  remodels: readonly ImproveRemodel[],
  eq: number,
  level: number,
  opts: { afterEq?: number | null; helpers?: readonly number[] } = {},
): LearnedImproveStage | null => {
  const stage = improveStageOfLevel(level)
  const exact = learnedImproveByLevel(remodels, eq, stage, opts).get(stage === 'conv' ? 10 : level)
  const whole = learnedImproveStage(remodels, eq, stage, opts)
  if (!exact && !whole) return null
  const learned: LearnedImproveStage = { eq, stage, afterEq: (exact ?? whole)!.afterEq }
  for (const side of SIDES) {
    const value = exact?.[side] ?? whole?.[side]
    if (value) (learned as any)[side] = value
  }
  return learned.fodder || learned.normal || learned.certain ? learned : null
}

/** 档内素材按星分组（只列实测过的星，连着且一样的并成一段）：★6 一种、★7-9 另一种 */
export const learnedFodderGroups = (
  byLevel: ReadonlyMap<number, LearnedImproveStage>,
): { from: number; to: number; items: { id: number; count: number }[] }[] => {
  const groups: { from: number; to: number; items: { id: number; count: number }[] }[] = []
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const fodder = byLevel.get(level)?.fodder
    if (!fodder) continue
    const last = groups[groups.length - 1]
    if (last && last.to === level - 1 && fodderSig(last.items) === fodderSig(fodder.items)) last.to = level
    else groups.push({ from: level, to: level, items: fodder.items })
  }
  return groups
}

/** 改修表一档的形状（随包 equip-improve / shared/improve-budget 的 ImproveStageCost） */
export interface ImproveStageLike {
  devmats?: number
  devmats_sli?: number
  screws?: number
  screws_sli?: number
  equips?: { id: number; eq_count: number }[]
  consumable?: { id: number; eq_count: number }[]
}

export type LearnedField = 'fodder' | 'devmats' | 'devmats_sli' | 'screws' | 'screws_sli'

/**
 * 资料那一档按实测改：素材装备换成实测的，普通的开发 / 改修资材换成普通改修实测的，
 * 括号里的确保那一侧换成确保改修实测的。特殊道具（useitem）不在 api_use_slot_id 里，照资料。
 * changed 只列跟资料对不上的（资料没有这一档时，实测有的都算）。
 */
export const applyLearnedStage = <S extends ImproveStageLike>(
  stage: S | undefined,
  learned: LearnedImproveStage | null,
): { stage: S | ImproveStageLike | undefined; changed: LearnedField[] } => {
  if (!learned) return { stage, changed: [] }
  const merged: ImproveStageLike = { ...(stage ?? {}) }
  const changed: LearnedField[] = []
  if (learned.fodder) {
    const table = (stage?.equips ?? []).map((need) => ({ id: Number(need.id), count: Number(need.eq_count) }))
    if (!stage || fodderSig(table) !== fodderSig(learned.fodder.items)) changed.push('fodder')
    merged.equips = learned.fodder.items.map((one) => ({ id: one.id, eq_count: one.count }))
  }
  if (learned.normal) {
    if (!stage || Number(stage.devmats ?? 0) !== learned.normal.devmats) changed.push('devmats')
    if (!stage || Number(stage.screws ?? 0) !== learned.normal.screws) changed.push('screws')
    merged.devmats = learned.normal.devmats
    merged.screws = learned.normal.screws
  }
  if (learned.certain) {
    // 资料缺省确保那一侧＝与普通同值
    const tableDev = Number(stage?.devmats_sli ?? stage?.devmats ?? 0)
    const tableScrew = Number(stage?.screws_sli ?? stage?.screws ?? 0)
    if (!stage || tableDev !== learned.certain.devmats) changed.push('devmats_sli')
    if (!stage || tableScrew !== learned.certain.screws) changed.push('screws_sli')
    merged.devmats_sli = learned.certain.devmats
    merged.screws_sli = learned.certain.screws
  } else if (learned.normal && stage) {
    // 确保改修还没实测过：确保那一侧照资料（资料缺省＝同普通），别跟着普通侧悄悄换成实测的普通价
    merged.devmats_sli = Number(stage.devmats_sli ?? stage.devmats ?? 0)
    merged.screws_sli = Number(stage.screws_sli ?? stage.screws ?? 0)
  }
  return { stage: merged, changed }
}
