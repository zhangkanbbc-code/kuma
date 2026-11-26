// 动画复盘的剧本编译器：把一场战斗（BattleView）编成一串可以逐步播放、任意跳转的「步」。
//
// 纯函数、零 DOM / Electron 依赖：同一份 BattleView 永远编出同一份剧本，单测与全量真快照对拍
// （scripts/battle-anim-replay-audit.mjs）都直接跑它。
//
// 几条做法，改之前先看这里：
// - **不另立口径**。每一击扣多少血走 battle-hp-timeline 的 hpAfterHit（与解析层同一条规则，
//   演习停 1、应急修理按记录顶回）；特攻收组走 fleet-special-attack 的 specialAttackSpans
//   （与战斗面板流水同一份结构判据）；要不要报航向走 battle-flow 的 battleUsesEngagement。
// - **只出数据，不出文案**。步里只放种类、舰位、伤害、阶段引用；中文标题与说明由显示层
//   按 kuma 既有的词表拼（阶段名就是解析层写好的 stage.label）。
// - **每一步自带 before / after 全舰快照**。跳到任意一步不必从头重放，拖动时间轴零漂移。
//   before 是这一步开始时的局面、after 是这一步结算完的局面；after 里每艘舰的 hpBefore
//   恒等于同一步 before 里它的 hp（多段连击也不会把起点覆盖掉）。
// - **不重排**。严格按 stage 升序、同阶段按 action 升序编；阶段本身的顺序由解析层定。
// - 维护者 2026-11-26 定的动画总口径：以客观性（如实反映发生了什么）与观感（不宜过快）为主。
//   所以这里不造任何报文里没有的事件：狗斗只在双方都有飞机时出现、烟幕只在真有烟幕时展开。

import { battleUsesEngagement } from './battle-flow'
import { hpAfterHit } from './battle-hp-timeline'
import { isNightPhase } from './battle-phase-damage'
import { specialAttackSpans } from './fleet-special-attack'
import { CARRIER_STYPES, SUBMARINE_STYPES } from './kcs-domain'

import type { AirCombatView, BattleAttack, BattleShipView, BattleStageView, BattleView } from './mg-types'

export type AnimSide = 0 | 1 | 2
export type AnimPhase = BattleAttack['phase']

/** 一艘舰在某一刻的状态 */
export interface AnimShipState {
  index: number
  hp: number
  /** 这一步开始时的血：显示层据此画「刚掉的那截」 */
  hpBefore: number
  hpMax: number
  /** 到这一刻为止的累计输出 */
  dealt: number
  defeated: boolean
  sunk: boolean
  escaped: boolean
  unattackable: boolean
  /** 这一场里已经发动过的应急修理（42 要员 / 43 女神） */
  repairUsed: number | null
  /** 应急修理就在这一步发动 */
  repairedThisStep: boolean
}

export interface AnimEnv {
  night: boolean
  friendVisible: boolean
  /** 夜战实际参战舰队 [我方, 敌方]：1 主力 / 2 护卫；昼间为 null */
  activeDeck: [number, number] | null
  /** 正在生效的烟幕层数，0 = 没有 */
  smoke: number
  /** 烟幕正在这一步散去 */
  smokeLeaving: boolean
  balloon: boolean
  /** 航空类阶段里阻塞气球亮起 */
  balloonHighlight: boolean
  flare: boolean
  nightContact: boolean
  /** 最近一次常规航空战的制空状态（api_disp_seiku）；喷式强袭不覆盖它 */
  seiku: number | null
}

export interface AnimFrame {
  f: AnimShipState[]
  e: AnimShipState[]
  friend: AnimShipState[]
  env: AnimEnv
}

export interface AnimHit {
  targetSide: AnimSide
  target: number
  damage: number
  critical: boolean
  hitState: 'miss' | 'hit' | 'unknown'
  protect: boolean
  repairItem: number | null
  /** 航空 stage3：这一格挨的是跳弹轰炸（api_*_sp_list 种类 1） */
  skipBomb?: boolean
  /** 航空 stage3：鱼雷 / 炸弹 / 两样都有（解析层记下的 rai / bak 标记）；旧快照没有 */
  airKind?: 'torpedo' | 'bomb' | 'both'
}

export type AnimWeapon =
  | 'shell' // 炮击
  | 'radar-shell' // 长距离雷达射击
  | 'asw' // 水面反潜
  | 'air-asw' // 航空反潜
  | 'carrier' // 空母昼间攻击
  | 'night-carrier' // 空母夜间攻击
  | 'torpedo' // 雷击（含夜战只用鱼雷的出手、潜艇）
  | 'gun-torpedo' // 夜战炮雷并用（主鱼 CI、驱逐舰的主鱼电 CI 一族）
  | 'seaplane' // 水上轰炸机（瑞云立体攻击 / 瑞云夜袭）
  | 'gun-seaplane' // 主炮齐射与水上轰炸机同一刻落到目标（瑞云夜袭这一击的装备里既有主炮又有夜间瑞云）
  | 'special' // 舰队特殊攻击的一段

/** 空母一族的出手里用了哪种飞机（按这一击实际使用的装备）；装备不明时为 null */
export interface AnimAircraft {
  bomb: boolean
  torpedo: boolean
}

interface StepBase {
  index: number
  /** 所属阶段（battle.stages[].order）；序幕 / 转场 / 尾声为 null */
  stage: number | null
  phase: AnimPhase | null
  /** 1.0x 下这一步播多久 */
  durationMs: number
  /** 「零伤 / 全落空」一类可以一键跳过的步 */
  dull: boolean
  before: AnimFrame
  after: AnimFrame
}

export type BattleAnimStep = StepBase &
  (
    | { kind: 'intro'; showsEngagement: boolean }
    | { kind: 'smoke'; level: number }
    | { kind: 'transition'; toNight: boolean; smokeLeaving: boolean }
    | {
        /**
         * 一波航空战连着演完：双方都有飞机时先缠斗，缠斗里活下来的攻击机直接扑向目标投弹，
         * 对空 CI 在它们进场途中打。
         * 维护者 2026-11-26：「航空战不用把缠斗和进攻拆开，缠斗完了直接打」——原先拆成三步各停一口气；
         * 同日又说「缠斗依然和紧接着的空袭是分开的，游戏里是连贯的」——原先缠斗的幸存机先飞回家，
         * 再从空中另冒出一批去投弹。
         */
        kind: 'air'
        air: AirCombatView | null
        jet: boolean
        /** 双方都有参战机：演缠斗（喷式强袭敌方没有喷式机时不演） */
        clash: boolean
        /** 对空 CI 发动舰；没有为 null */
        aaciShip: number | null
        strikes: (AnimHit & { attackerSide: AnimSide })[]
        rescue: number
        /** 陆航这一波实际出击的机种（解析层记下的 squadronPlanes）；非陆航为 null */
        planes: { mstId: number; count: number }[] | null
        /** 缠斗全长、对空弹幕时长（1.0x 毫秒）；显示层按它排特效 */
        clashMs: number
        aaciMs: number
        /** 攻击机开始扑向目标的时刻（1.0x 毫秒）：有缠斗时是盘旋到 AIR_HANDOFF 那一刻，没有缠斗从 0 起 */
        strikeAtMs: number
      }
    | { kind: 'support'; mode: 'gun' | 'air'; support: BattleStageView['support'] | null; hits: AnimHit[] }
    | { kind: 'torpedo-salvo'; torpedoes: (AnimHit & { side: AnimSide; attacker: number })[] }
    | { kind: 'special-cutin'; side: AnimSide; ciType: number; ciKind: 'day' | 'night' | null; participants: number[] }
    | {
        kind: 'attack'
        side: AnimSide
        attacker: number
        ciType: number | null
        ciKind: 'day' | 'night' | null
        weapon: AnimWeapon
        aircraft: AnimAircraft | null
        /** 舰队特殊攻击的第几段（0 基）/ 共几段；普通出手为 null */
        special: { ciType: number; segment: number; of: number } | null
        equipmentMstIds: number[]
        hits: AnimHit[]
      }
    | { kind: 'outro' }
  )

export type AnimMarkerKind = 'smoke' | 'night' | 'day' | 'special' | 'repair' | 'taiha' | 'flagship-down'

export interface AnimMarker {
  step: number
  kind: AnimMarkerKind
}

export interface BattleAnimScript {
  steps: BattleAnimStep[]
  markers: AnimMarker[]
  /** 全部步在 1.0x 下的总时长 */
  totalMs: number
  /** 最后一步与记录的终局血量对不上的舰数（旧快照偏差如实透传，不粉饰） */
  mismatchCount: number
}

export interface CompileOptions {
  /** 舰种（api_stype），取不到给 null。决定反潜 / 空母攻击这类表现 */
  stypeOf: (mstId: number) => number | null
  /** 装备的图鉴分类（api_type[2]），取不到给 null。决定夜战鱼雷、空母用的哪种飞机这类表现 */
  slotTypeOf?: (mstId: number) => number | null
}

/**
 * 整体节奏系数。原型的节拍（单发炮击 1.28s、雷击 2.05s、空战 2.55s）维护者 2026-11-26 看过说
 * 「节奏略快了点」，整体放慢两成；还要调就改这一个数。
 */
export const ANIM_PACE = 1.2

const BASE_STEP_MS = {
  intro: 2200,
  smoke: 1750,
  transition: 1650,
  transitionWithSmoke: 1950,
  airClash: 2550,
  airClashJet: 2100,
  aaci: 1650,
  airStrike: 2300,
  airStrikeWithRescue: 2650,
  support: 1950,
  torpedoSalvo: 2050,
  specialCutin: 1450,
  specialSegment: 1350,
  attack: 1280,
  attackMulti: 1550,
  attackMiss: 980,
  attackRepair: 2150,
  outro: 2000,
} as const

/** 缠斗进行到全长的这一比例时，活下来的攻击机直接从缠斗里扑向目标（其余幸存机返航） */
export const AIR_HANDOFF = 0.7

/** 每一类步在 1.0x 下的时长（ms）：原型的节拍乘以 ANIM_PACE。显示层再按播放倍速整体缩放。 */
export const ANIM_STEP_MS = Object.fromEntries(
  Object.entries(BASE_STEP_MS).map(([key, ms]) => [key, Math.round(ms * ANIM_PACE)]),
) as { readonly [K in keyof typeof BASE_STEP_MS]: number }

// 装备图鉴分类（api_type[2]）：只用来挑表现，不参与任何数值
const TORPEDO_TYPES = new Set([5, 32]) // 鱼雷 / 潜水艇鱼雷
const GUN_TYPES = new Set([1, 2, 3, 4, 38]) // 小中大口径主炮 / 副炮 / 大口径主炮(II)
const BOMBER_TYPES = new Set([7, 11, 57]) // 舰爆 / 水爆 / 喷式战斗轰炸机
const TORPEDO_BOMBER_TYPES = new Set([8, 58]) // 舰攻 / 喷式攻击机

const AIR_PHASES = new Set<AnimPhase>(['lbas', 'injection', 'air', 'air2', 'friendlyAir'])
// 烟幕只压水面交战：航空、陆航、支援打完，接敌开火之前展开
const SURFACE_PHASES = new Set<AnimPhase>(['openingAsw', 'openingTorp', 'gun1', 'gun2', 'gun3', 'torp', 'radar'])
const TORPEDO_PHASES = new Set<AnimPhase>(['openingTorp', 'torp'])

/** 友军夜战里 NPC 友军（2）打敌方、敌方打友军；其余时候我方与敌方互打 */
const targetSideOf = (attack: Pick<BattleAttack, 'phase' | 'side'>): AnimSide =>
  attack.phase === 'friendly' ? (attack.side === 2 ? 1 : 2) : attack.side === 1 ? 0 : 1

const seedShips = (ships: readonly BattleShipView[] | null | undefined): AnimShipState[] =>
  (ships ?? []).map((ship) => ({
    index: ship.index,
    hp: ship.hpStart,
    hpBefore: ship.hpStart,
    hpMax: ship.hpMax,
    dealt: 0,
    defeated: false,
    sunk: false,
    escaped: !!ship.escaped,
    unattackable: !!ship.unattackable,
    repairUsed: null,
    repairedThisStep: false,
  }))

const cloneFrame = (frame: AnimFrame): AnimFrame => ({
  f: frame.f.map((ship) => ({ ...ship })),
  e: frame.e.map((ship) => ({ ...ship })),
  friend: frame.friend.map((ship) => ({ ...ship })),
  env: { ...frame.env, activeDeck: frame.env.activeDeck ? [...frame.env.activeDeck] as [number, number] : null },
})

const shipsOf = (frame: AnimFrame, side: AnimSide): AnimShipState[] =>
  side === 0 ? frame.f : side === 1 ? frame.e : frame.friend

const metaOf = (battle: BattleView, side: AnimSide): readonly BattleShipView[] =>
  (side === 0 ? battle.fShips : side === 1 ? battle.eShips : battle.friendShips) ?? []

// 对联合类型逐个成员去掉键（TS 自带的 Omit 会把联合压成公共键）
type StepDraft = BattleAnimStep extends infer T ? (T extends unknown ? Omit<T, 'index' | 'before' | 'after'> : never) : never

const toAnimHit = (hit: BattleAttack['hits'][number], targetSide: AnimSide): AnimHit => ({
  targetSide,
  target: hit.target,
  damage: Math.max(0, Math.floor(Number(hit.damage) || 0)),
  critical: !!hit.critical,
  // 旧快照没有 hitState：确认落空的算 miss，有伤害的算命中，零伤又没有落空标记的照实写「不明」
  hitState: hit.hitState ?? (hit.miss ? 'miss' : Number(hit.damage) > 0 ? 'hit' : 'unknown'),
  protect: !!hit.protect,
  repairItem: hit.repairItem ?? null,
  ...(hit.airKind ? { airKind: hit.airKind } : {}),
})

export const compileBattleAnimScript = (battle: BattleView, options: CompileOptions): BattleAnimScript => {
  const floor = battle.practice ? 1 : 0
  const stages = [...(battle.stages ?? [])].sort((a, b) => a.order - b.order)
  const attacks = [...(battle.attacks ?? [])].sort((a, b) => a.stage - b.stage || a.action - b.action)
  // 特攻收组按全场排好序的攻击算一次：组的起点 → 组
  const spanAt = new Map<number, { start: number; end: number }>()
  for (const span of specialAttackSpans(attacks)) spanAt.set(span.start, span)
  const attackIndexOf = new Map(attacks.map((attack, at) => [attack, at]))

  const startsNight = battle.kind === 'nightonly' || battle.kind === 'nightday'
  const lastLbasOrder = stages.filter((stage) => stage.phase === 'lbas').at(-1)?.order ?? null
  // 照明弹、夜间触接整场夜战都在：昼转夜在转场那一步亮起；夜战点、拂晓战开场就是夜，序幕里就亮
  const hasFlare = !!battle.flarePos && (battle.flarePos[0] >= 0 || battle.flarePos[1] >= 0)
  const hasNightContact = !!battle.nightContact && (battle.nightContact[0] > 0 || battle.nightContact[1] > 0)
  const state: AnimFrame = {
    f: seedShips(battle.fShips),
    e: seedShips(battle.eShips),
    friend: seedShips(battle.friendShips),
    env: {
      night: startsNight,
      friendVisible: false,
      activeDeck: startsNight ? battle.activeDeck : null,
      smoke: 0,
      smokeLeaving: false,
      balloon: !!battle.balloonCell,
      balloonHighlight: false,
      flare: startsNight && hasFlare,
      nightContact: startsNight && hasNightContact,
      seiku: null,
    },
  }

  const steps: BattleAnimStep[] = []
  const markers: AnimMarker[] = []

  // 每一步开始前统一锚定：hpBefore 回到当前血、复活标记复位、烟幕散去的一拍结束
  const settle = () => {
    for (const ship of [...state.f, ...state.e, ...state.friend]) {
      ship.hpBefore = ship.hp
      ship.repairedThisStep = false
    }
    state.env.smokeLeaving = false
  }

  // 这一步里出的状态变化，收进标记
  let stepFlags = { taiha: false, flagshipDown: false, repair: false }
  const resetFlags = () => {
    stepFlags = { taiha: false, flagshipDown: false, repair: false }
  }

  const applyHit = (targetSide: AnimSide, hit: AnimHit, attackerSide: AnimSide, attacker: number) => {
    const ship = shipsOf(state, targetSide).find((entry) => entry.index === hit.target)
    if (ship && !ship.escaped && !ship.unattackable) {
      const before = ship.hp
      const wasTaiha = before / (ship.hpMax || 1) <= 0.25
      ship.hp = hpAfterHit(before, hit, ship.hpMax, floor)
      if (hit.repairItem === 42 || hit.repairItem === 43) {
        ship.repairUsed = hit.repairItem
        ship.repairedThisStep = true
        stepFlags.repair = true
      } else if (hit.damage > 0 && before > 0 && before - hit.damage <= 0) {
        ship.defeated = true
        ship.sunk = floor === 0
        if (targetSide === 1 && ship.index === 0) stepFlags.flagshipDown = true
      }
      if (targetSide === 0 && !wasTaiha && ship.hp / (ship.hpMax || 1) <= 0.25 && !ship.sunk) stepFlags.taiha = true
    }
    if (attacker >= 0) {
      const source = shipsOf(state, attackerSide).find((entry) => entry.index === attacker)
      if (source) source.dealt += hit.damage
    }
  }

  const push = (step: StepDraft, before: AnimFrame, extra: AnimMarkerKind[] = []) => {
    const index = steps.length
    steps.push({ ...step, index, before, after: cloneFrame(state) } as BattleAnimStep)
    for (const kind of extra) markers.push({ step: index, kind })
    if (stepFlags.repair) markers.push({ step: index, kind: 'repair' })
    if (stepFlags.flagshipDown) markers.push({ step: index, kind: 'flagship-down' })
    if (stepFlags.taiha) markers.push({ step: index, kind: 'taiha' })
    resetFlags()
  }

  const begin = (): AnimFrame => {
    settle()
    resetFlags()
    return cloneFrame(state)
  }

  // ---- 序幕 ----
  push({ kind: 'intro', stage: null, phase: null, durationMs: ANIM_STEP_MS.intro, dull: false, showsEngagement: battleUsesEngagement(battle) }, begin())

  const smokeLevel = Math.max(0, Math.floor(Number(battle.smokeType) || 0))
  let smokeDeployed = false
  const deploySmoke = () => {
    if (smokeLevel <= 0 || smokeDeployed) return
    smokeDeployed = true
    const before = begin()
    state.env.smoke = smokeLevel
    push({ kind: 'smoke', stage: null, phase: null, durationMs: ANIM_STEP_MS.smoke, dull: false, level: smokeLevel }, before, ['smoke'])
  }

  const stypeOf = (side: AnimSide, index: number): number | null => {
    const meta = metaOf(battle, side).find((ship) => ship.index === index)
    return meta ? options.stypeOf(meta.mstId) : null
  }

  // 这一击实际用了哪几类装备（api_si_list → 图鉴分类）
  const usedTypes = (attack: BattleAttack): number[] =>
    (attack.equipmentMstIds ?? [])
      .map((mstId) => options.slotTypeOf?.(mstId) ?? null)
      .filter((type): type is number => type != null)

  const weaponOf = (attack: BattleAttack, targetSide: AnimSide, special: boolean): AnimWeapon => {
    if (attack.phase === 'radar') return 'radar-shell'
    const attackerStype = stypeOf(attack.side, attack.attacker)
    const attackerCarrier = attackerStype != null && CARRIER_STYPES.has(attackerStype)
    const firstTarget = attack.hits[0]?.target
    const targetStype = firstTarget == null ? null : stypeOf(targetSide, firstTarget)
    if (attack.phase === 'openingAsw' || (targetStype != null && SUBMARINE_STYPES.has(targetStype))) {
      return attackerCarrier ? 'air-asw' : 'asw'
    }
    // 夜袭 CI（夜 6）只有空母打得出；有的报文（较早的、演习的）这一击没立 api_n_mother_list，
    // 账本里 10 次夜袭 CI 有 2 次这样，按 CI 种类兜底，别画成炮弹
    if (attack.carrierNightAttack || (attack.ciKind === 'night' && attack.ciType === 6)) return 'night-carrier'
    if (TORPEDO_PHASES.has(attack.phase)) return 'torpedo'
    // 瑞云立体攻击（昼 200）/ 瑞云夜袭（夜 200）是水上轰炸机打的；这一击的装备里还有炮（瑞云夜袭实测是
    // 试制夜间瑞云 + 两门主炮）就是炮弹与炸弹一起落下（维护者 2026-11-26 问「夜瑞云的特殊攻击」）
    if (attack.ciType === 200) return usedTypes(attack).some((type) => GUN_TYPES.has(type)) ? 'gun-seaplane' : 'seaplane'
    if (special) return 'special'
    if (attackerCarrier && !isNightPhase(attack.phase)) return 'carrier'
    // 潜艇的出手只可能是鱼雷（夜战的潜艇攻击也是）
    if (attackerStype != null && SUBMARINE_STYPES.has(attackerStype)) return 'torpedo'
    if (isNightPhase(attack.phase)) {
      const types = usedTypes(attack)
      if (types.some((type) => TORPEDO_TYPES.has(type))) {
        return types.some((type) => GUN_TYPES.has(type)) ? 'gun-torpedo' : 'torpedo'
      }
    }
    return 'shell'
  }

  const aircraftOf = (attack: BattleAttack, weapon: AnimWeapon): AnimAircraft | null => {
    if (weapon !== 'carrier' && weapon !== 'night-carrier' && weapon !== 'air-asw') return null
    const types = usedTypes(attack)
    if (!types.length) return null
    return {
      bomb: types.some((type) => BOMBER_TYPES.has(type)),
      torpedo: types.some((type) => TORPEDO_BOMBER_TYPES.has(type)),
    }
  }

  let night = startsNight
  for (const stage of stages) {
    const stageAttacks = attacks.filter((attack) => attack.stage === stage.order)
    // 夜战支援（api_n_support_info）解析层也记成 'support'，它打在夜里：不能因为它先转昼再转回夜
    const stageNight = isNightPhase(stage.phase) || stage.source === 'api_n_support_info'

    if (!stageNight && SURFACE_PHASES.has(stage.phase)) deploySmoke()

    // 昼夜切换（昼转夜追击；拂晓战夜转昼）
    if (stageNight !== night) {
      const before = begin()
      const smokeLeaving = stageNight && state.env.smoke > 0
      if (smokeLeaving) {
        state.env.smoke = 0
        state.env.smokeLeaving = true
      }
      state.env.night = stageNight
      state.env.activeDeck = stageNight ? battle.activeDeck : null
      state.env.flare = stageNight && hasFlare
      state.env.nightContact = stageNight && hasNightContact
      night = stageNight
      push(
        {
          kind: 'transition',
          stage: null,
          phase: null,
          durationMs: smokeLeaving ? ANIM_STEP_MS.transitionWithSmoke : ANIM_STEP_MS.transition,
          dull: false,
          toNight: stageNight,
          smokeLeaving,
        },
        before,
        [stageNight ? 'night' : 'day'],
      )
    }

    if (stageNight && battle.kind === 'nightonly') deploySmoke()

    const friendStage = stage.phase === 'friendly' || stage.phase === 'friendlyAir'
    if (friendStage !== state.env.friendVisible) state.env.friendVisible = friendStage

    // ---- 航空类阶段：缠斗 → 对空 CI → 投弹连成一步，各段只在报文里真有这件事时出现 ----
    if (AIR_PHASES.has(stage.phase)) {
      const air = stage.air
      const jet = stage.phase === 'injection'
      const clash = !!air && air.fCount > 0 && air.eCount > 0
      const aaciShip = air && air.aaCutinIdx != null && air.aaCutinIdx >= 0 ? air.aaCutinIdx : null
      if (!clash && aaciShip == null && !stageAttacks.length) {
        // 什么都没发生（双方都没飞机也没投弹）：只记下制空状态，不占一步
        if (air && !jet && air.seiku != null) state.env.seiku = air.seiku
        continue
      }
      const before = begin()
      state.env.balloonHighlight = state.env.balloon
      // 喷式强袭不改写常规航空战的制空状态
      if (air && !jet && air.seiku != null) state.env.seiku = air.seiku
      const strikes: (AnimHit & { attackerSide: AnimSide })[] = []
      for (const attack of stageAttacks) {
        const targetSide = targetSideOf(attack)
        const sp = (targetSide === 0 ? air?.spAttackF : air?.spAttackE) ?? []
        for (const raw of attack.hits) {
          const hit = toAnimHit(raw, targetSide)
          if (sp.some((entry) => entry.pos === hit.target && entry.kinds.includes(1))) hit.skipBomb = true
          applyHit(targetSide, hit, attack.side, -1)
          strikes.push({ ...hit, attackerSide: attack.side })
        }
      }
      // 卡特琳娜救援整场只记一次（api_air_base_rescue_type），是陆航全部打完才演的那一下：只挂在最后一波（与镝的流水同一处）
      const rescue = stage.phase === 'lbas' && stage.order === lastLbasOrder ? Math.max(0, Math.floor(Number(battle.airBaseRescue) || 0)) : 0
      // 缠斗压到单演时的七成；有投弹时攻击机在缠斗盘旋到 AIR_HANDOFF 时直接扑向目标，对空弹幕叠在进场途中，
      // 这一步＝扑出前的缠斗 + 投弹；没有投弹就是缠斗 / 对空弹幕演完再收一下
      const clashMs = clash ? Math.round((jet ? ANIM_STEP_MS.airClashJet : ANIM_STEP_MS.airClash) * 0.7) : 0
      const aaciMs = aaciShip != null ? Math.round(ANIM_STEP_MS.aaci * 0.5) : 0
      const strikeAtMs = clash ? Math.round(clashMs * AIR_HANDOFF) : 0
      const durationMs = strikes.length
        ? strikeAtMs + (rescue ? ANIM_STEP_MS.airStrikeWithRescue : ANIM_STEP_MS.airStrike)
        : clashMs + aaciMs + Math.round(ANIM_STEP_MS.aaci * 0.4)
      push(
        {
          kind: 'air',
          stage: stage.order,
          phase: stage.phase,
          durationMs,
          dull: !clash && aaciShip == null && strikes.every((hit) => hit.damage === 0),
          air,
          jet,
          clash,
          aaciShip,
          strikes,
          rescue,
          planes: stage.phase === 'lbas' || stage.phase === 'injection' ? (stage.squadronPlanes ?? null) : null,
          clashMs,
          aaciMs,
          strikeAtMs,
        },
        before,
      )
      state.env.balloonHighlight = false
      continue
    }

    // ---- 支援舰队 ----
    if (stage.phase === 'support') {
      if (!stageAttacks.length) continue
      const before = begin()
      const hits: AnimHit[] = []
      for (const attack of stageAttacks) {
        const targetSide = targetSideOf(attack)
        for (const raw of attack.hits) {
          const hit = toAnimHit(raw, targetSide)
          applyHit(targetSide, hit, attack.side, -1)
          hits.push(hit)
        }
      }
      push(
        {
          kind: 'support',
          stage: stage.order,
          phase: stage.phase,
          durationMs: ANIM_STEP_MS.support,
          dull: hits.every((hit) => hit.damage === 0),
          // 解析层只给支援炮击记队号与舰（api_support_hourai）；航空支援 / 反潜支援没有这一对
          mode: stage.support ? 'gun' : 'air',
          support: stage.support ?? null,
          hits,
        },
        before,
      )
      continue
    }

    // ---- 同时雷击：全部鱼雷同时发射、同时结算 ----
    if (stage.simultaneous && TORPEDO_PHASES.has(stage.phase)) {
      if (!stageAttacks.length) continue
      const before = begin()
      const torpedoes: (AnimHit & { side: AnimSide; attacker: number })[] = []
      for (const attack of stageAttacks) {
        const targetSide = targetSideOf(attack)
        for (const raw of attack.hits) {
          const hit = toAnimHit(raw, targetSide)
          applyHit(targetSide, hit, attack.side, attack.attacker)
          torpedoes.push({ ...hit, side: attack.side, attacker: attack.attacker })
        }
      }
      push(
        { kind: 'torpedo-salvo', stage: stage.order, phase: stage.phase, durationMs: ANIM_STEP_MS.torpedoSalvo, dull: torpedoes.every((hit) => hit.damage === 0), torpedoes },
        before,
      )
      continue
    }

    // ---- 逐击：炮击 / 开幕对潜 / 雷达射击 / 夜战 / 友军夜战 ----
    for (let i = 0; i < stageAttacks.length; ) {
      const attack = stageAttacks[i]
      const span = spanAt.get(attackIndexOf.get(attack) ?? -1)
      const group = span ? attacks.slice(span.start, span.end) : [attack]
      if (span && attack.ciType != null) {
        const before = begin()
        push(
          {
            kind: 'special-cutin',
            stage: stage.order,
            phase: stage.phase,
            durationMs: ANIM_STEP_MS.specialCutin,
            dull: false,
            side: attack.side,
            ciType: attack.ciType,
            ciKind: attack.ciKind,
            participants: [...new Set(group.map((entry) => entry.attacker))],
          },
          before,
          ['special'],
        )
      }
      for (const [segment, entry] of group.entries()) {
        const before = begin()
        const targetSide = targetSideOf(entry)
        const hits = entry.hits.map((raw) => toAnimHit(raw, targetSide))
        for (const hit of hits) applyHit(targetSide, hit, entry.side, entry.attacker)
        const repair = hits.some((hit) => hit.repairItem === 42 || hit.repairItem === 43)
        const allMiss = hits.every((hit) => hit.damage === 0)
        const durationMs = span
          ? ANIM_STEP_MS.specialSegment
          : repair
            ? ANIM_STEP_MS.attackRepair
            : hits.length >= 2
              ? ANIM_STEP_MS.attackMulti
              : allMiss
                ? ANIM_STEP_MS.attackMiss
                : ANIM_STEP_MS.attack
        const weapon = weaponOf(entry, targetSide, !!span)
        push(
          {
            kind: 'attack',
            stage: stage.order,
            phase: stage.phase,
            durationMs,
            dull: allMiss && !repair,
            side: entry.side,
            attacker: entry.attacker,
            ciType: entry.ciType,
            ciKind: entry.ciKind,
            weapon,
            aircraft: aircraftOf(entry, weapon),
            special: span && entry.ciType != null ? { ciType: entry.ciType, segment, of: group.length } : null,
            equipmentMstIds: entry.equipmentMstIds ?? [],
            hits,
          },
          before,
        )
      }
      i += group.length
    }
  }

  // ---- 尾声：战果定格（纯昼战的烟幕在这里散去）----
  const before = begin()
  state.env.friendVisible = false
  state.env.balloonHighlight = false
  if (state.env.smoke > 0) {
    state.env.smoke = 0
    state.env.smokeLeaving = true
  }
  push({ kind: 'outro', stage: null, phase: null, durationMs: ANIM_STEP_MS.outro, dull: false }, before)

  // 自检：终局血量与记录对拍（退避与不可攻击的舰不挨打，不计）
  const last = steps[steps.length - 1].after
  let mismatchCount = 0
  for (const side of [0, 1, 2] as const) {
    for (const meta of metaOf(battle, side)) {
      if (meta.escaped || meta.unattackable) continue
      const ship = shipsOf(last, side).find((entry) => entry.index === meta.index)
      if (ship && ship.hp !== meta.hpEnd) mismatchCount += 1
    }
  }

  return {
    steps,
    markers,
    totalMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    mismatchCount,
  }
}
