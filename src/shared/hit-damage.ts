// 一艘舰这一轮带伤的持续战损（实验性，交接包「编队被弹与特色入渠动画」v2，维护者 2026-11-27 定稿）：
// 弹孔、积水、常驻倾角与主导伤势，按每次战报追加；修满才清。
// 当次与历史分开（维护者 2026-11-28 定）：出击中的弹孔与积水是当次伤害；一返港，弹孔转成四角碎裂、
// 积水抽干转成锈渍（returnToPort），四角碎裂的大小跟着缺失血量走（shared/hit-scar）。
// 只在内存里——重启后本就带伤的舰照账本里的战斗把这一轮挨的每一下重放出来（damageChainOf / replayDamageChain，
// 按出击分段，之前的出击在段尾转成历史战损），接不上（中途泊修回过血等）就只按缺失血量给四角碎裂。
// 纯逻辑层，无 DOM/Electron 依赖。

import { damageTierOf } from './battle-damage'
import { aswDetonateAt, HIT_REPORT_FX } from './fleet-fx-timing'
import { buildBulletHole, type GlassHole, type RowZones } from './hit-glass'
import { analyzeShipHitReport, type HitDominant, type ShipHitReport } from './hit-report'
import type { BattleView } from './mg-types'

export const HIT_CAPS = {
  /** 一个阶段最多新添几个弹孔（命中再多也按最重的几发画） */
  holesPerStage: 5,
  /** 一轮带伤累计最多几个弹孔 */
  holesTotal: 7,
  /** 积水上限（行高的百分比）：不淹没舰名与血条数字 */
  water: 52,
  /** 潜水舰只轻微进水 */
  waterSub: 52 * 0.65,
  /** 鱼雷冲击峰值倾角 / 常驻倾角上限（deg） */
  listPeak: 3.2,
  listRest: 1.15,
} as const

export interface ShipDamageState {
  readonly seedKey: number
  readonly holes: readonly GlassHole[]
  /** 积水液面（行高的百分比） */
  readonly water: number
  /** 常驻倾角（deg，正＝破口侧（右侧）下沉，顺时针） */
  readonly listDeg: number
  readonly dominant: 'none' | HitDominant
  /**
   * 历史伤害（缺失血量 0..1）：四角碎裂按它长。在港时随血量走（泊修回血就缩），
   * 出击中冻结在出击时的值——这一趟新挨的打画成弹孔，返港时再并进来。没有就是 0
   */
  readonly scar?: number
  /** 锈渍水线（行高的百分比）：历次返港抽干积水时取最高的那条液面。没有就是 0 */
  readonly rust?: number
  /** 这一趟出击里记下的掉血（缺失血量 0..1，逐次战报累加）；返港并进四角碎裂后归零。没有就是 0 */
  readonly current?: number
  /** 没有逐发战报、只按缺失血量补的历史战损 */
  readonly synthetic?: true
}

export const emptyDamageState = (seedKey: number): ShipDamageState => ({ seedKey, holes: [], water: 0, listDeg: 0, dominant: 'none' })

const round2 = (n: number) => Math.round(n * 100) / 100
const missingOf = (hp: number, max: number): number => round2(Math.max(0, Math.min(1, 1 - hp / (max || 1))))

/**
 * 返港：这一趟的弹孔收口、积水抽干，转成历史战损——四角碎裂长到现在的缺失血量，
 * 锈渍水线取历次最高的积水液面，倾侧随抽水扶正。主导伤势留着（入渠特色按它挑）。
 */
export const returnToPort = (state: ShipDamageState, hp: number, max: number): ShipDamageState => ({
  ...state,
  holes: [],
  water: 0,
  listDeg: 0,
  scar: missingOf(hp, max),
  rust: round2(Math.max(state.rust ?? 0, state.water)),
  current: 0,
})

/**
 * 保底（维护者 2026-11-28 定：「做一个未统计时候的保底破裂，检查一遍实际是否满血然后再来根据状态补上未满血的碎裂状态」）：
 * 按实际血量核一遍——出击前的旧伤（四角碎裂）＋这一趟记下的掉血，要等于现在缺失的血量。
 * 没记到的掉血（出击时看着别的舰队页签、开关那会儿关着、重启后账本还没重放完或接不上）补进四角碎裂；
 * 出击中泊地修理回了血，也先从旧伤里扣。满血不归这里管（调用方直接清掉战损）。
 */
export const reconcileScar = (state: ShipDamageState, hp: number, max: number): ShipDamageState => {
  const target = Math.max(0, Math.min(1, 1 - hp / (max || 1)) - (state.current ?? 0))
  // 差不到一格血的取整误差不动（四角碎裂按两位小数存），免得每次观察都换一份对象
  if (Math.abs(target - (state.scar ?? 0)) <= RECONCILE_SLACK) return state
  return { ...state, scar: round2(target) }
}

/** 保底只补得上的差距：比这小的当取整误差 */
const RECONCILE_SLACK = 0.015

/** 被弹那一下的动作参数（编队行挂成 CSS 变量） */
export interface HitMotion {
  /** shell：水平后坐；torp：破口侧下沉倾侧；asw：垂直水压浮沉 */
  readonly kind: 'shell' | 'torp' | 'asw'
  readonly dominant: HitDominant
  /** 扣血这一拍整体往后挪多久：反潜等深弹起爆、鱼雷等航迹切入 */
  readonly leadMs: number
  /** 这一下之前 / 之后的常驻倾角，与冲击峰值（deg） */
  readonly listFrom: number
  readonly listRest: number
  readonly listPeak: number
  /** 反潜浮沉幅度（px） */
  readonly heaveAmp: number
  /** 投下几颗深弹（1–3）、几条鱼雷航迹（0–2） */
  readonly dropCount: number
  readonly torpRuns: number
  /** 积水由多少涨到多少 */
  readonly waterFrom: number
  readonly waterTo: number
}

export interface ApplyHitInput {
  shipId: number
  state: ShipDamageState
  report: ShipHitReport
  before: number
  after: number
  max: number
  zones: RowZones
}

export interface ApplyHitResult {
  state: ShipDamageState
  newHoles: GlassHole[]
  motion: HitMotion
}

const TIER_RANK = { none: 0, light: 1, medium: 2, heavy: 3, sunk: 4 } as const
const tierOf = (hp: number, max: number): keyof typeof TIER_RANK => (hp <= 0 ? 'sunk' : damageTierOf(hp, max) ?? 'none')
const nextIdxOf = (holes: readonly GlassHole[]): number => holes.reduce((top, hole) => Math.max(top, hole.idx), 0) + 1

/**
 * 按这一段的战报把战损追加到状态上（审片台 playReportHit / playAswAttack 的结算部分）：
 * - 炮击：按伤害升序取最重的 holesPerStage 发，各留一个弹孔；累计到 holesTotal 封顶。
 *   单发掉血 ≥ 45%，或最重那一发让满血直接进大破 / 击沉，或最重那一发 ≥ 36% 且进了大破 → 崩出大破口。
 * - 鱼雷：不留弹孔，进水（有上限）、常驻倾角取更大的那个；冲击峰值随雷伤变大。
 * - 反潜（潜水舰）：耐压壳裂纹按同一套弹孔画，只轻微进水；深弹最多投 3 颗，最后一颗起爆才扣血。
 */
export const applyHitReport = ({ shipId, state, report, before, after, max, zones }: ApplyHitInput): ApplyHitResult => {
  const prevTier = tierOf(before, max)
  const nextTier = tierOf(after, max)
  const holes: GlassHole[] = [...state.holes]
  const newHoles: GlassHole[] = []
  let idx = nextIdxOf(holes)
  const add = (damage: number, massive: boolean, kind: GlassHole['kind']) => {
    if (holes.length >= HIT_CAPS.holesTotal) return
    const hole = buildBulletHole({ shipId, seedKey: state.seedKey, idx: idx++, singleLoss: damage / max, massive, kind, zones, existing: holes })
    if (!hole) return
    holes.push(hole)
    newHoles.push(hole)
  }

  if (report.aswHits.length && !report.shellHits.length && !report.torpHits.length) {
    const usable = [...report.aswHits].sort((a, b) => a - b).slice(-HIT_CAPS.holesPerStage)
    for (const damage of usable) {
      const loss = damage / max
      add(damage, loss >= 0.45 || (prevTier === 'none' && nextTier === 'heavy'), 'asw')
    }
    const dropCount = Math.min(3, report.aswHits.length)
    const water = Math.min(HIT_CAPS.waterSub, state.water + (report.aswDmg / max) * 34)
    return {
      state: { ...state, holes, water, dominant: 'asw', current: (state.current ?? 0) + (before - after) / max, synthetic: undefined },
      newHoles,
      motion: {
        kind: 'asw',
        dominant: 'asw',
        leadMs: aswDetonateAt(dropCount),
        listFrom: state.listDeg,
        listRest: state.listDeg,
        listPeak: state.listDeg,
        heaveAmp: Math.min(6, 2.5 + (report.aswDmg / max) * 5),
        dropCount,
        torpRuns: 0,
        waterFrom: state.water,
        waterTo: water,
      },
    }
  }

  const hasTorp = report.torpDmg > 0
  if (report.shellHits.length) {
    // 最重那一发压轴
    const usable = [...report.shellHits].sort((a, b) => a - b).slice(-HIT_CAPS.holesPerStage)
    usable.forEach((damage, i) => {
      const loss = damage / max
      const biggest = i === usable.length - 1
      const massive =
        loss >= 0.45 ||
        (biggest && prevTier === 'none' && (nextTier === 'heavy' || nextTier === 'sunk')) ||
        (biggest && loss >= 0.36 && nextTier === 'heavy')
      add(damage, massive, 'shell')
    })
  }
  let water = state.water
  let listDeg = state.listDeg
  let listPeak = state.listDeg
  if (hasTorp) {
    const torpLoss = report.torpDmg / max
    water = Math.min(HIT_CAPS.water, water + torpLoss * 76 + (report.torpRatio > 0.5 ? 10 : 5))
    const steady = Math.min(HIT_CAPS.listRest, 0.42 + (water / HIT_CAPS.water) * 0.73) * Math.max(0.45, report.torpRatio)
    listDeg = Math.max(listDeg, steady)
    listPeak = Math.min(HIT_CAPS.listPeak, 1.4 + torpLoss * 2.6) * Math.max(0.5, report.torpRatio)
  }
  return {
    state: {
      ...state,
      holes,
      water: round2(water),
      listDeg: round2(listDeg),
      dominant: report.dominant,
      current: (state.current ?? 0) + (before - after) / max,
      synthetic: undefined,
    },
    newHoles,
    motion: {
      kind: report.torpRatio >= 0.5 ? 'torp' : 'shell',
      dominant: report.dominant,
      leadMs: hasTorp ? HIT_REPORT_FX.torpLead : 0,
      listFrom: state.listDeg,
      listRest: round2(listDeg),
      listPeak: round2(Math.max(listPeak, listDeg)),
      heaveAmp: 0,
      dropCount: 0,
      torpRuns: hasTorp ? Math.min(2, report.torpHits.length) : 0,
      waterFrom: state.water,
      waterTo: round2(water),
    },
  }
}

/**
 * 没有逐发战报（重启前就带伤、账本接不上，或换编队才第一次见到）时补的战损：只按缺失血量给四角碎裂，
 * 不编弹孔、不编积水——那些是当次伤害，要有战报才画。
 */
export const syntheticDamageState = (seedKey: number, nowhp: number, maxhp: number, sub: boolean): ShipDamageState => {
  const scar = missingOf(nowhp, maxhp)
  if (scar <= 0) return emptyDamageState(seedKey)
  return { seedKey, holes: [], water: 0, listDeg: 0, dominant: sub ? 'asw' : 'shell', scar, rust: 0, synthetic: true }
}

export type DockKind = 'shell' | 'torp' | 'sub'

/** 入渠特色：潜水舰压载浮升；锈渍重（积过的水多）或鱼雷主导的除锈；其余焊修四角碎裂 */
export const dockKindOf = (state: ShipDamageState | null | undefined, sub: boolean): DockKind => {
  if (sub) return 'sub'
  if (state && (state.water >= 12 || (state.rust ?? 0) >= 12 || state.dominant === 'torp')) return 'torp'
  return 'shell'
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** 入渠前段（0%→45%）优先排涝稳船：倾角线性扶正回 0° */
export const dockListDeg = (listDeg: number, progress: number | null): number => {
  if (Math.abs(listDeg) <= 0.02) return 0
  if (progress == null) return listDeg
  return listDeg * (1 - clamp01(progress / 0.45))
}

/** 审片台里定倾角时的行宽（约 680px）：kuma 的行更宽时按同样的端点位移换算角度 */
export const LIST_TUNED_WIDTH = 680
/**
 * 常驻倾角最多让行的最远端压进邻行几像素。审片台每行之间隔着一条工具栏，kuma 的编队行彼此紧挨着，
 * 照搬 1.15° 时 1000px 宽的行右端会下沉 11px、整条压进下一行；交接包本身也要求「不压到邻行分隔线」。
 */
export const LIST_EDGE_ALLOWANCE = 4

/**
 * 编队行上实际画多大的倾角：先按行宽换算成与审片台同样的端点位移，常驻态（steady）再按邻行余量封顶。
 * 冲击峰值只换算不封顶（620ms 的一下晃动，与水平后坐一样可以短暂越界）。积水液面的斜率不走这里。
 * 行绕 44% 处旋转，右端离轴心 0.56 个行宽。
 */
export const visibleListDeg = (deg: number, width: number, steady: boolean): number => {
  if (!(deg > 0) || !(width > 0)) return 0
  const scaled = deg * Math.min(1, LIST_TUNED_WIDTH / width)
  if (!steady) return Math.round(scaled * 100) / 100
  const cap = (Math.asin(Math.min(1, LIST_EDGE_ALLOWANCE / (0.56 * width))) * 180) / Math.PI
  return Math.round(Math.min(scaled, cap) * 100) / 100
}

/** 入渠时四角碎裂按维修进度原路缩回：历史缺失血量 ×（1 − 进度），与血条同步 */
export const dockScar = (scar: number, progress: number | null): number => {
  if (!(scar > 0)) return 0
  if (progress == null) return scar
  return round2(scar * (1 - clamp01(progress)))
}

/** 锈渍浓淡：入渠前七成进度里除净 */
export const dockRustStrength = (progress: number | null): number =>
  progress == null ? 1 : round2(1 - clamp01(progress / 0.7))

/** 积水随维修进度 0%→100% 抽干 */
export const dockWater = (water: number, progress: number | null): number => {
  if (water <= 0) return 0
  if (progress == null) return water
  return Math.max(0, water * (1 - clamp01(progress)))
}

// ---- 重启后照账本把这一轮挨的每一下重放出来 ----

export interface ChainShip {
  id: number
  nowhp: number
  maxhp: number
}

export type DamageChain =
  | { status: 'done'; battles: BattleView[] }
  /** 接不上（中途泊修回过血、记录不全、最大耐久变过）：退回默认碎裂 */
  | { status: 'broken' }
  /** 还没找到满血开场的那一场（要更早的记录）；已经接上的那几场与其中最早一场的开场血量也给出来 */
  | { status: 'open'; battles: BattleView[]; startHp: number }

/**
 * 这艘舰这一轮带伤（自上次满血开场以来）出场过的战斗，从早到晚。battles 按时间倒序给（最近的在前），演习跳过。
 * 要求一路接得上：最近那场的终局血量＝现在的血量，每场的开场血量＝更早那场的终局血量，直到某场满血开场。
 */
export const damageChainOf = (battlesNewestFirst: readonly BattleView[], ship: ChainShip): DamageChain => {
  let expect = ship.nowhp
  const chain: BattleView[] = []
  for (const battle of battlesNewestFirst) {
    if (battle.practice) continue
    const entry = battle.fShips.find((s) => s.rosterId === ship.id)
    if (!entry) continue
    if (entry.hpMax !== ship.maxhp || entry.hpEnd !== expect) return { status: 'broken' }
    chain.push(battle)
    if (entry.hpStart >= entry.hpMax) return { status: 'done', battles: chain.reverse() }
    expect = entry.hpStart
  }
  return { status: 'open', battles: chain.reverse(), startHp: expect }
}

export interface ReplayDeps {
  seedKey: number
  zones: RowZones
  stypeOf: (mstId: number) => number | null
  slotTypeOf?: (mstId: number) => number | null
  /** 这艘舰的舰种（判潜水舰） */
  targetStype: number | null
}

/** 战斗链按出击分段：每场属于哪一次出击，以及眼下正在进行的是哪一次（在港为 null） */
export interface ReplaySorties {
  sortieOf: (battle: BattleView) => number | null
  current: number | null
}

/**
 * 按战斗链逐场重放战报，得到与实际挨打逐发对应的战损（弹孔、积水、倾角）。
 * base：链头之前就有的伤（找不到满血开场时，按链头开场血量补的历史战损）；不给就从完好开始。
 * sorties：给了就按出击分段——换了一次出击说明上一次已经返港，那一段的弹孔与积水在段尾转成历史战损；
 * 最后一段不是眼下这次出击（或眼下在港）也照样转。
 */
export const replayDamageChain = (
  battles: readonly BattleView[],
  shipId: number,
  deps: ReplayDeps,
  base: ShipDamageState = emptyDamageState(deps.seedKey),
  sorties?: ReplaySorties,
): ShipDamageState => {
  let state = base
  let prevSortie: number | null | undefined
  let last: { hp: number; max: number } | null = null
  for (const battle of battles) {
    const entry = battle.fShips.find((s) => s.rosterId === shipId)
    if (!entry) continue
    if (sorties) {
      const sortie = sorties.sortieOf(battle)
      if (last && prevSortie !== undefined && sortie !== prevSortie) state = returnToPort(state, last.hp, last.max)
      prevSortie = sortie
      last = { hp: entry.hpEnd, max: entry.hpMax }
    }
    if (!(entry.hpStart > entry.hpEnd)) continue
    const drop = { before: entry.hpStart, after: entry.hpEnd }
    const report = analyzeShipHitReport(battle, shipId, {
      stypeOf: deps.stypeOf,
      slotTypeOf: deps.slotTypeOf,
      targetStype: deps.targetStype,
      drop,
    })
    state = applyHitReport({ shipId, state, report, before: drop.before, after: drop.after, max: entry.hpMax, zones: deps.zones }).state
  }
  if (sorties && last && (prevSortie == null || prevSortie !== sorties.current)) state = returnToPort(state, last.hp, last.max)
  return state
}
