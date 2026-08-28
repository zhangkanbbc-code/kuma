// 基地航空队的「推荐搭配」：给定目标点需要的行动半径与手上能动用的机体，
// 排出四个格子该放什么。
//
// 排序口径是**用户定死的**，三级依次比较，前一级分不出胜负才看后一级：
//   ① 対空射撃回避档位高者优先（挨敌方对空射击时更不容易被打下来）
//   ② 期望攻击力高者优先
//   ③ 配置耗铝低者优先（这就是「性价比」的落点）
// 排序本身不掺第四个维度——它是定案，别在这里偷偷加权重。
//
// 攻击力不另造口径：基本攻撃力用 land-base-attack 的 planeBasePower（陸攻補正 ×1.8、
// 改修強化値、搭載数補正都在里面），対地特効与下取整/キャップ那一层走 lbas-target-power，
// 免得同一个数在镝和这里各算各的。
//
// **二期起，威力列是「有效威力」而不是裸雷装/爆装排序**：同一架飞机打水上舰、
// 打砲台小鬼、打離島棲姫、打集積地棲姫的倍率与补正位置都不一样，名次也就不一样
// ——机种×目标类型这两维都进了排序，口径见 lbas-target-power.ts 的文件头。
//
// 半径与中队定数走 lbas-radius，出处见该文件头注。
//
// **两个必须显式处理、否则会给出错建议的点**：
//   · 打不动的机体要整个排除，不能靠排序压下去。爆装一式戦 隼III型改(65戦隊)
//     的回避档是 ◯（比绝大多数陸攻都高），但它雷装 0——対艦向选它等于派一队
//     不会打船的飞机去。判据是「本次口径下的攻击力 > 0」，不是「是不是陸攻」。
//   · 深海（敌方）装备混在同一张主数据表里，`api_distance` / `api_cost` 是
//     undefined。它们带着和玩家机一样的种别号，不挡掉会混进推荐。

import { kindMultiplier, reconBonusOf } from './land-base-attack'
import type { LandBasePlane } from './land-base-attack'
import { RADIUS_EXTENDER_TYPES, slotCapacity, squadRadius } from './lbas-radius'
import type { RadiusPlane } from './lbas-radius'
import { squadBonusGroups, squadBonusMultiplier } from './lbas-event-bonus'
import type { LbasBonusContext } from './lbas-event-bonus'
import { squadronPower, squadronPowerDetail } from './lbas-target-power'
import type { LbasTargetKind, SquadronPowerBreakdown } from './lbas-target-power'

/** 一个航空队四个中队 */
export const LBAS_SQUAD_SLOTS = 4

/**
 * 档位高低：原文「❀ > ☆ > ◎ > ◯ > △ の順に高い」。
 *
 * **无档（资料表里没有这一条）记 0，它不是 △**——△ 是 0.6/1.0（能把敌方加重対空値
 * 削掉四成），无档是 1.0/1.0（一点也削不掉）。把没查到写成最低档是在伪造数据。
 */
export const AA_EVASION_RANK: Readonly<Record<string, number>> = {
  '❀': 5,
  '☆': 4,
  '◎': 3,
  '◯': 2,
  '△': 1,
}

/** 资料表里的一行 */
export interface AaEvasionRow {
  eq_id: number
  weighted_aa: number
  fleet_aa: number
  tier: string
  basis: string
}

/** 手上一款可动用的机体（同款多件已合并计数） */
export interface LbasStockPlane {
  mstId: number
  name: string
  type2: number
  /** api_raig 雷装——打水上舰用 */
  torpedo: number
  /** api_baku 爆装——打陆上型用 */
  bomb: number
  /** api_distance 行动半径 */
  distance: number
  /** api_cost 配置消耗（铝/机） */
  cost: number
  /** 现在能动用的件数（已装在舰上或别的基地的不算在内） */
  count: number
  /** 同款里最高的改修星级 */
  level: number
}

export interface LbasSlotPick {
  plane: LbasStockPlane
  /** 攻击格 还是 为了够半径而占掉的侦察格 */
  role: 'attacker' | 'extender'
  /** 这一格的搭载数（通常18 / 大型陸上機9 / 偵察機4） */
  capacity: number
  /** 这一格在本队里的期望攻击力贡献；侦察机这里是它带来的陆侦补正增量 */
  power: number
  /** 这一格单飞时的有效威力拆解（基础 → 基地航空特効 → 爆撃特効），给悬停用 */
  detail: SquadronPowerBreakdown
  /** 回避档符号；null = 资料表未收录（无档，不是弱档） */
  tier: string | null
  tierRank: number
  weightedAa: number | null
  fleetAa: number | null
  /** 配置这一格要花的铝 = 配置消耗 × 搭载数 */
  bauxite: number
}

export interface LbasPlan {
  slots: LbasSlotPick[]
  /** 这一队的出击可能范围 */
  radius: number
  /** 一波的期望攻击力（**含**活动陆航特効；非活动语境下就是纯威力） */
  power: number
  /** 配置整队要花的铝 */
  bauxite: number
  /** 够不够得着目标点 */
  reaches: boolean
  /** 是否为了够半径而占掉了一格放侦察机/大艇 */
  usedExtender: boolean
  /** 整队吃到的活动陆航特効倍率；1 = 没吃到（非活动语境永远是 1） */
  bonusMultiplier: number
  /** 整队吃到的组与各组倍率，按代号排序 */
  bonusGroups: { group: string; rate: number }[]
  /**
   * 「不把特効算进选法」时这套推荐的威力——给显示层做对照用。
   * 非活动语境下与 `power` 相等（同一套方案、同一个数）。
   */
  plainPower: number
  /** 组合择优是否因为候选过多而做过裁剪（裁剪判据见 `prunePool`，只砍被支配的） */
  approx: boolean
}

export interface LbasRecommendInput {
  stock: readonly LbasStockPlane[]
  /** 目标点需要的半径；null = 不限（不做半径约束，纯按强弱排） */
  targetRadius: number | null
  /**
   * 目标类型。`surface` 用雷装，其余四类用爆装且各带各的対地特効
   * ——同一批机体在不同类型下排出来的名次会不一样，这正是二期要的。
   */
  target: LbasTargetKind
  enemyCombined?: boolean
  /** 查这一款有没有回避档 */
  evasionOf: (mstId: number) => AaEvasionRow | null
  slots?: number
  /**
   * 本点生效的活动陆航特効。**不传或传 null = 纯二期逻辑**：
   * 零特効因子、零组合择优，输出与接特効之前逐字节一致
   *（护栏 test/lbas-recommend.test.mjs 的金样本比对）。
   */
  bonus?: LbasBonusContext | null
}

const toLandBasePlane = (plane: LbasStockPlane): LandBasePlane => ({
  type2: plane.type2,
  torpedo: plane.torpedo,
  bomb: plane.bomb,
  level: plane.level,
  count: slotCapacity(plane.type2),
  mstId: plane.mstId,
})

/**
 * 本次口径下这一款单格的**有效威力**（不含队内的陆侦补正——那要看整队怎么配）。
 *
 * 一期这里是裸的 `planeBasePower`，只分「用雷装还是用爆装」；
 * 二期换成按目标类型算完特効与下取整的 `squadronPower`，
 * 所以排序比的是「打这一类敌人真能打出多少」，不再是裸面板值。
 */
export const soloPower = (plane: LbasStockPlane, target: LbasTargetKind): number =>
  squadronPower({ plane: toLandBasePlane(plane), target })

const rankOf = (row: AaEvasionRow | null): number =>
  row ? (AA_EVASION_RANK[row.tier] ?? 0) : 0

/**
 * 用户定死的三级排序：回避档 → 攻击力 → 耗铝。**这三级的次序二期没动**，
 * 换掉的只是第二级里「攻击力」那个数的算法（裸面板值 → 有效威力）。
 * 末尾按 mstId 兜底，保证同分时次序稳定（否则同一份仓库两次渲染可能不一样）。
 */
export const compareCandidates = (
  a: LbasStockPlane,
  b: LbasStockPlane,
  target: LbasTargetKind,
  evasionOf: (mstId: number) => AaEvasionRow | null,
): number => {
  const rankDiff = rankOf(evasionOf(b.mstId)) - rankOf(evasionOf(a.mstId))
  if (rankDiff !== 0) return rankDiff
  const powerDiff = soloPower(b, target) - soloPower(a, target)
  if (Math.abs(powerDiff) > 1e-9) return powerDiff
  if (a.cost !== b.cost) return a.cost - b.cost
  return a.mstId - b.mstId
}

/** 能不能当攻击格：本次口径下真的打得动，且是会参与对面攻击的机种 */
const isAttacker = (plane: LbasStockPlane, target: LbasTargetKind): boolean =>
  kindMultiplier(plane.type2) > 0 && soloPower(plane, target) > 0

const isExtender = (plane: LbasStockPlane): boolean => RADIUS_EXTENDER_TYPES.has(plane.type2)

/** 主数据里混着的深海装备没有半径与配置消耗，挡在门口 */
const isUsable = (plane: LbasStockPlane): boolean =>
  Number.isFinite(plane.distance) &&
  plane.distance > 0 &&
  Number.isFinite(plane.cost) &&
  plane.count > 0

/** 按次序取前 n 件，同款不超过持有数 */
const takeTop = (
  sorted: readonly LbasStockPlane[],
  n: number,
  floor: number,
): LbasStockPlane[] => {
  const picked: LbasStockPlane[] = []
  for (const plane of sorted) {
    if (plane.distance < floor) continue
    for (let i = 0; i < plane.count && picked.length < n; i++) picked.push(plane)
    if (picked.length >= n) break
  }
  return picked
}

/**
 * 一队的有效威力 = 各中队各自算完特効与下取整后相加，**再乘整队的活动陆航特効**。
 *
 * 陸偵補正按整队算一次，但乘的位置随目标类型不同（対水上艦在下取整之内、対地在之外），
 * 所以交给 squadronPower 而不是在这里乘完了事。
 * 活动特効与它不同：那是**整队一个系数**（同组不重复、异组叠乘），乘在最外面。
 */
const wavePowerOf = (
  planes: readonly LandBasePlane[],
  input: LbasRecommendInput,
  bonus: LbasBonusContext | null,
): number => {
  const recon = reconBonusOf(planes)
  const sum = planes.reduce(
    (acc, plane) =>
      acc +
      squadronPower({
        plane,
        target: input.target,
        reconBonus: recon,
        enemyCombined: input.enemyCombined ?? false,
      }),
    0,
  )
  const mstIds = planes.map((plane) => plane.mstId ?? -1)
  return sum * squadBonusMultiplier(bonus, mstIds)
}

const buildPlanFrom = (
  all: readonly LbasStockPlane[],
  roleAt: (plane: LbasStockPlane, index: number) => 'attacker' | 'extender',
  input: LbasRecommendInput,
  bonus: LbasBonusContext | null,
): LbasPlan => {
  const radiusPlanes: RadiusPlane[] = all.map((plane) => ({
    type2: plane.type2,
    distance: plane.distance,
    mstId: plane.mstId,
    count: slotCapacity(plane.type2),
  }))
  const radius = squadRadius(radiusPlanes)
  const lb = all.map(toLandBasePlane)
  const wave = (planes: readonly LandBasePlane[]) => wavePowerOf(planes, input, bonus)
  const total = wave(lb)
  const mstIds = all.map((plane) => plane.mstId)
  const slots: LbasSlotPick[] = all.map((plane, index) => {
    const row = input.evasionOf(plane.mstId)
    const capacity = slotCapacity(plane.type2)
    // 这一格的贡献 = 整队减去这一格。侦察机由此显示的是它带来的陆侦补正增量，
    // 而不是 0——那正是它占掉一格换来的东西。
    // 接了活动特効之后这条口径顺带把「特効机值不值」也答了：抽掉队里唯一那架 C2 机，
    // 整队倍率一起没了，于是它的贡献里含着**它带给另外三架的那部分**。
    const without = wave(lb.filter((_, at) => at !== index))
    return {
      plane,
      role: roleAt(plane, index),
      capacity,
      power: Math.max(0, total - without),
      detail: squadronPowerDetail({ plane: lb[index], target: input.target }),
      tier: row?.tier ?? null,
      tierRank: rankOf(row),
      weightedAa: row?.weighted_aa ?? null,
      fleetAa: row?.fleet_aa ?? null,
      bauxite: plane.cost * capacity,
    }
  })
  return {
    slots,
    radius,
    power: total,
    bauxite: slots.reduce((sum, slot) => sum + slot.bauxite, 0),
    reaches: input.targetRadius == null ? true : radius >= input.targetRadius,
    usedExtender: slots.some((slot) => slot.role === 'extender'),
    bonusMultiplier: squadBonusMultiplier(bonus, mstIds),
    bonusGroups: squadBonusGroups(bonus, mstIds),
    plainPower: total,
    approx: false,
  }
}

/** 二期口径的组装：延伸机（若有）占第一格，其余都是攻击格。 */
const buildPlan = (
  attackers: readonly LbasStockPlane[],
  extender: LbasStockPlane | null,
  input: LbasRecommendInput,
  bonus: LbasBonusContext | null = null,
): LbasPlan =>
  buildPlanFrom(
    extender ? [extender, ...attackers] : [...attackers],
    (_plane, index) => (extender && index === 0 ? 'extender' : 'attacker'),
    input,
    bonus,
  )

/** 两套方案谁更好：逐格按同一把尺子比，第一处分出胜负就定；全平则耗铝低、半径大者优先 */
const betterPlan = (a: LbasPlan, b: LbasPlan, input: LbasRecommendInput): LbasPlan => {
  const aAtk = a.slots.filter((slot) => slot.role === 'attacker')
  const bAtk = b.slots.filter((slot) => slot.role === 'attacker')
  if (aAtk.length !== bAtk.length) return aAtk.length > bAtk.length ? a : b
  for (let i = 0; i < aAtk.length; i++) {
    const cmp = compareCandidates(
      aAtk[i].plane,
      bAtk[i].plane,
      input.target,
      input.evasionOf,
    )
    if (cmp !== 0) return cmp < 0 ? a : b
  }
  if (a.bauxite !== b.bauxite) return a.bauxite < b.bauxite ? a : b
  return a.radius >= b.radius ? a : b
}

/**
 * 排一套推荐搭配（**纯二期逻辑**：取前四强，不含任何活动特効因子）。
 *
 * 先试「四格全放攻击机」；够不着目标点时才拿一格换侦察机/大艇去延半径
 * ——占掉的那一格是实打实的伤害损失，所以不到够不着不占。
 * 一件都排不出来时返回 null（手上没有能打的机体），不返回空壳。
 *
 * **这个函数是「非活动语境」的全部**，三期一个字没动它。目标点不是活动图、
 * 或者是活动图但该点没有陆航特効记载（本期 E1–E3 全图如此）时走的就是这里，
 * 输出与二期逐字节一致——金样本 `test/lbas-plain-golden.json` 是在接特効之前
 * 用二期的 dist 采的，420 组逐字段比对。
 */
const recommendPlain = (input: LbasRecommendInput): LbasPlan | null => {
  const slotCount = input.slots ?? LBAS_SQUAD_SLOTS
  const usable = input.stock.filter(isUsable)
  const attackers = usable
    .filter((plane) => isAttacker(plane, input.target))
    .sort((a, b) => compareCandidates(a, b, input.target, input.evasionOf))
  if (!attackers.length) return null
  const need = input.targetRadius

  // ① 四格全攻击机
  const topFour = takeTop(attackers, slotCount, need ?? 0)
  if (topFour.length) {
    const plan = buildPlan(topFour, null, input)
    if (need == null || plan.reaches) return plan
  }

  // ② 够不着 → 一格换延伸机。逐个「最低半径下限」试：下限抬高能延得更远，
  //    但会把半径短的强机挡在门外，两头都要试过才知道哪套更好。
  let best: LbasPlan | null = null
  const extenders = usable
    .filter(isExtender)
    .sort((a, b) => b.distance - a.distance || a.cost - b.cost || a.mstId - b.mstId)
  if (!extenders.length || slotCount < 2) return null
  const floors = [...new Set(usable.map((plane) => plane.distance))].sort((a, b) => a - b)
  for (const floor of floors) {
    for (const extender of extenders) {
      if (extender.distance < floor) continue
      const picked = takeTop(attackers, slotCount - 1, floor)
      if (picked.length < slotCount - 1) continue
      const plan = buildPlan(picked, extender, input)
      if (need != null && !plan.reaches) continue
      best = best ? betterPlan(best, plan, input) : plan
    }
  }
  return best
}

// ── 三期：活动语境下的组合择优 ────────────────────────────────────
//
// 活动陆航特効是**整队倍率**：队里塞一架 C2 机，另外三架的伤害也一起涨。
// 于是「取前四强」不再等于最优——一架单看很弱的机体，可能因为把整队抬了 20%
// 而该进队。这一段就是把「哪四架一起上」当成一个整体来挑。
//
// 只在 `input.bonus` 非空时走这里；非活动语境一步都不进来（见 `recommendLbas`）。

/**
 * 候选池上限——**枚举是精确的，这只是不让病态输入把渲染卡住的保险丝**。
 *
 * 先做一遍精确的「被支配就删」（`prunePool`，删掉的不可能出现在最优解里），
 * 剩下的才受这条上限管。实测把整个游戏的机体全塞进来（每款 4 件，本机主数据
 * 741 件里合格的 124/143 件）裁完是 50（対水上艦）/ 57（対砲台），
 * 都在 64 以内——也就是说 `approx` 在正常仓库里根本不会亮。
 * 真超了才按「先留带特効的、再按威力」截断，那一刀是近似，方案上标 `approx`。
 *
 * 64 件取四的组合数约 76 万，最坏一次 ~150ms；铎那边按目标点与库存缓存，
 * 不会每次重渲都重算（见 du.ts 的 advicePlan 缓存）。
 */
const MAX_POOL = 64
/**
 * 组合之间「总威力算打平」的相对带宽。
 *
 * 用户定的原序是「①回避档 → ②威力 → ③耗铝」，那是给**单机**排序的；
 * 到了组合层面，三期的定案是「比全队总有效威力，取真最优」。两者的衔接：
 * **总威力为主序**，落在这条带宽之内视为打平，再交给原来那把尺子（`betterPlan`
 * 逐格比回避档→威力→耗铝）决胜——即「同总威力附近优先保机组合」。
 * 带宽取 0.5%：够窄，不会让明显更强的组合输给保机组合（E5 那组差 4.3%）；
 * 又够宽，不至于因为浮点尾数而永远判不成平手。
 */
const COMBO_TIE_BAND = 0.005

interface Candidate {
  plane: LbasStockPlane
  lb: LandBasePlane
  /** 本点吃到的组代号，排序后拼成串——裁剪时同串的才互相比较 */
  groupKey: string
  attacker: boolean
  solo: number
  /** 回避档位次。**裁剪时必须比它**：档位是用户定的第一顺位，
   *  少比这一维就会把「同威力但更抗击坠」的那件当成被支配的裁掉。 */
  tierRank: number
}

/**
 * 裁掉**被支配**的候选：同机种、同组归属的两件里，若 A 的威力、半径、回避档都不低于 B，
 * 耗铝不高于 B，且 A 的持有数足够铺满整队，那么任何用到 B 的组合都能整件换成 A 而不变差。
 * 这一步是**精确**的，不是近似——它不会把最优解裁掉。
 *
 * 只有裁完仍然超过 `MAX_POOL` 时才动真格（按「先留有组的、再按威力」截断），
 * 那一刀才是近似，方案上会标 `approx`。
 */
const prunePool = (pool: readonly Candidate[], slotCount: number): { pool: Candidate[]; approx: boolean } => {
  const kept = pool.filter((b) =>
    !pool.some(
      (a) =>
        a !== b &&
        a.plane.type2 === b.plane.type2 &&
        a.groupKey === b.groupKey &&
        a.plane.count >= slotCount &&
        a.solo >= b.solo &&
        a.plane.distance >= b.plane.distance &&
        a.plane.cost <= b.plane.cost &&
        a.tierRank >= b.tierRank &&
        // 全相等时只留一件，用 mstId 定谁留下，免得互相支配把两件都裁掉
        (a.solo > b.solo ||
          a.plane.distance > b.plane.distance ||
          a.plane.cost < b.plane.cost ||
          a.tierRank > b.tierRank ||
          a.plane.mstId < b.plane.mstId),
    ),
  )
  if (kept.length <= MAX_POOL) return { pool: kept, approx: false }
  const ranked = [...kept].sort(
    (a, b) =>
      Number(b.groupKey !== '') - Number(a.groupKey !== '') ||
      b.solo - a.solo ||
      b.plane.distance - a.plane.distance ||
      a.plane.mstId - b.plane.mstId,
  )
  return { pool: ranked.slice(0, MAX_POOL), approx: true }
}

/** 枚举「从候选池里取 size 件」的所有组合（同款可重复，不超过持有数） */
const forEachCombination = (
  pool: readonly Candidate[],
  size: number,
  visit: (picks: readonly Candidate[]) => void,
): void => {
  const picks: Candidate[] = []
  const used = new Array<number>(pool.length).fill(0)
  const walk = (start: number, left: number): void => {
    if (left === 0) {
      visit(picks)
      return
    }
    for (let i = start; i < pool.length; i++) {
      if (used[i] >= pool[i].plane.count) continue
      used[i] += 1
      picks.push(pool[i])
      walk(i, left - 1)
      picks.pop()
      used[i] -= 1
    }
  }
  walk(0, size)
}

/** 组合之间谁更好：总威力为主，打平了才回到用户那把「回避档→威力→耗铝」的尺子。 */
const betterCombo = (a: LbasPlan, b: LbasPlan, input: LbasRecommendInput): LbasPlan => {
  const high = Math.max(a.power, b.power)
  const tied = high <= 0 || Math.abs(a.power - b.power) <= high * COMBO_TIE_BAND
  if (!tied) return a.power > b.power ? a : b
  return betterPlan(a, b, input)
}

const recommendWithBonus = (
  input: LbasRecommendInput,
  bonus: LbasBonusContext,
): LbasPlan | null => {
  const slotCount = input.slots ?? LBAS_SQUAD_SLOTS
  const usable = input.stock.filter(isUsable)
  const candidates: Candidate[] = usable
    .map((plane) => {
      const groups = [...(bonus.groupsOf.get(plane.mstId) ?? [])].sort()
      return {
        plane,
        lb: toLandBasePlane(plane),
        groupKey: groups.join('+'),
        attacker: isAttacker(plane, input.target),
        solo: soloPower(plane, input.target),
        tierRank: rankOf(input.evasionOf(plane.mstId)),
      }
    })
    // 能打的、能延半径的、能带特効的都要进池——**带特効的哪怕自己一点伤害都打不出**，
    // 它占一格换来的是整队的倍率，值不值让枚举去算，不在门口替玩家决定。
    .filter((c) => c.attacker || isExtender(c.plane) || c.groupKey !== '')
  if (!candidates.length) return null

  const { pool, approx } = prunePool(candidates, slotCount)
  const available = pool.reduce((sum, c) => sum + c.plane.count, 0)
  const need = input.targetRadius

  // 用一个盒子装，不用裸变量：赋值发生在回调里，裸变量会被 TS 窄化成 never
  const found: { plan: LbasPlan | null } = { plan: null }
  // 优先摆满四格；这个格数一套都够不着才退一格（与二期「不够就如实少给几格」同向）
  for (let size = Math.min(slotCount, available); size >= 1 && !found.plan; size--) {
    forEachCombination(pool, size, (picks) => {
      const radius = squadRadius(
        picks.map((c) => ({
          type2: c.plane.type2,
          distance: c.plane.distance,
          mstId: c.plane.mstId,
          count: slotCapacity(c.plane.type2),
        })),
      )
      if (need != null && radius < need) return
      const power = wavePowerOf(
        picks.map((c) => c.lb),
        input,
        bonus,
      )
      if (power <= 0) return
      // 先按总威力粗筛，真正要比的时候才组装完整方案（组装一次要算五遍波次）
      if (found.plan && power < found.plan.power * (1 - COMBO_TIE_BAND)) return
      const ordered = [...picks].sort(
        (a, b) =>
          Number(b.attacker) - Number(a.attacker) ||
          compareCandidates(a.plane, b.plane, input.target, input.evasionOf),
      )
      // 打不动的那几格标成「延程/占位」：它们占一格换来的是半径或整队倍率
      const plan = buildPlanFrom(
        ordered.map((c) => c.plane),
        (plane) => (isAttacker(plane, input.target) ? 'attacker' : 'extender'),
        input,
        bonus,
      )
      found.plan = found.plan ? betterCombo(found.plan, plan, input) : plan
    })
  }
  if (!found.plan) return null
  found.plan.approx = approx
  return found.plan
}

/**
 * 排一套推荐搭配。
 *
 * **两条路，由 `input.bonus` 分岔**：
 *  · 没有活动陆航特効（常规海域，或活动图但该点没有特効记载）→ 纯二期逻辑
 *    `recommendPlain`，零特効因子、零组合择优；
 *  · 有 → `recommendWithBonus` 的组合择优：整队倍率会让「取前四强」不再等于最优。
 */
export const recommendLbas = (input: LbasRecommendInput): LbasPlan | null => {
  const plain = recommendPlain(input)
  if (!input.bonus) return plain
  const best = recommendWithBonus(input, input.bonus)
  if (!best) return plain
  // 对照用的那个数：**不把特効算进选法**时会得到的那套方案，按同一套规则算出来的威力
  // ——玩家由此看得出「为了特効换掉一架，到底赚了多少」。
  best.plainPower = plain
    ? wavePowerOf(
        plain.slots.map((slot) => toLandBasePlane(slot.plane)),
        input,
        input.bonus,
      )
    : best.power
  return best
}
