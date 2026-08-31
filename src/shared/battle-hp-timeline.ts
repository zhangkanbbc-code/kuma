// 逐舰的血量时间轴：这场战斗每个阶段结算完，各舰还剩多少血。
//
// 战斗行的血条据此跟着流水走——选中哪一行，上面就显示那一刻的血量，
// 而不是整场打完的总结图。
//
// **这不是推算。** 主进程解析报文时本来就是逐击模拟的
// （battle.ts 的 applyHit：`hp = max(hpFloor, hp - damage)`，
// 归零时按序取出应急修理），而模拟的每一步都落在 attacks[].hits 里。
// 照同一套规则重放，末值必然等于 hpEnd——不需要 phaseMidHp 那种
// 「按总量顺序分配再截断」的近似（那是只有昼/夜两个总数时的将就办法）。
// 唯一的前提是规则要跟解析层一致，所以下面每一条都注明了对应关系。

export interface HpTimelineHit {
  target: number
  damage: number
  /** 该击触发的应急修理 mstId：43 女神满血 / 42 要员两成 */
  repairItem?: number | null
}

export interface HpTimelineAttack {
  side: number // 0 我方 / 1 敌方 / 2 NPC 友军
  stage: number
  action: number
  /** 攻击所属阶段名（night/friendly = 夜战段）。segmentStartOf 用它划昼/夜段。 */
  phase?: string
  hits?: HpTimelineHit[]
}

export interface HpTimelineShip {
  index: number
  hpStart: number
  hpMax: number
  hpEnd: number
  escaped?: boolean
}

export interface HpStagePoint {
  stage: number
  /** 这个阶段结算完之后的血 */
  hp: number
  /** 进入这个阶段之前的血 */
  before: number
}

export interface ShipHpTimeline {
  hpMax: number
  hpStart: number
  hpEnd: number
  /** 只收「这一阶段血量真的动了」的点，按 stage 升序 */
  points: HpStagePoint[]
  /** 重放末值与记录的 hpEnd 对不上——理论上不该发生，发生了就别信这条时间轴 */
  mismatch: boolean
}

/**
 * 重放一艘舰的挨打过程。
 *
 * `enemy` 指这条舰属于敌方：受击位置在敌我两侧各自独立编号，
 * 必须先按攻击方 side 过滤，只看 target 会张冠李戴。
 */
export const shipHpTimeline = (
  attacks: readonly HpTimelineAttack[] | null | undefined,
  ship: HpTimelineShip,
  enemy: boolean,
  practice: boolean,
): ShipHpTimeline => {
  const base: ShipHpTimeline = {
    hpMax: ship.hpMax,
    hpStart: ship.hpStart,
    hpEnd: ship.hpEnd,
    points: [],
    mismatch: false,
  }
  // 退避的舰整场不挨打（applyHit 里 escaped 直接跳过）
  if (!attacks?.length || ship.escaped) {
    base.mismatch = ship.hpEnd !== ship.hpStart && !ship.escaped
    return base
  }
  // 演习画面固定保留 1 HP：解析层的 hpFloor
  const floor = practice ? 1 : 0
  const ordered = attacks
    .filter((attack) => (enemy ? attack.side !== 1 : attack.side === 1))
    .slice()
    .sort((left, right) => left.stage - right.stage || left.action - right.action)

  let hp = ship.hpStart
  let stage = -1
  let stageBefore = hp
  const points: HpStagePoint[] = []
  const closeStage = () => {
    if (stage < 0 || hp === stageBefore) return
    points.push({ stage, hp, before: stageBefore })
  }
  for (const attack of ordered) {
    if (attack.stage !== stage) {
      closeStage()
      stage = attack.stage
      stageBefore = hp
    }
    for (const hit of attack.hits ?? []) {
      if (hit.target !== ship.index) continue
      const damage = Math.max(0, Math.floor(Number(hit.damage) || 0))
      hp = Math.max(floor, hp - damage)
      // 应急修理：解析层在归零那一刻取出道具并把血量顶回去，
      // 触发结果已经记在这一击上，照抄即可，不必重演「有没有货」
      if (hit.repairItem === 43) hp = ship.hpMax
      else if (hit.repairItem === 42) hp = Math.max(1, Math.floor(ship.hpMax / 5))
    }
  }
  closeStage()
  base.points = points
  base.mismatch = hp !== ship.hpEnd
  return base
}

export interface HpBarSegments {
  /** 实血：这一刻还剩的，按当时战损档取色 */
  solidPct: number
  /** 虚条：基准到当前之间掉的那截——斜杠（跟随最新时红，点住某一阶段时蓝） */
  ghostPct: number
  /** 空：虚条之前掉的 + 开战前就缺的。不着色，露出血条底轨 */
  emptyPct: number
}

/**
 * 血条的实/虚/空三截宽度。**满格恒为 hpMax**。
 *
 * 一度把满格换成「前一段结束时的血」，于是打出过「7/7 大破」这种自相矛盾的
 * 格子——总血量不会因为换了阶段就变少。要表达「这一阶段又掉了多少」，靠的是
 * 把这一截单独画出来，而不是动分母。
 *
 * 任何时刻条上只有一截虚条，更早掉的一律归于空。虚条从哪儿起算由调用方给的
 * `hpBefore` 定：跟随最新时是**最近一段结算**掉的，点住某一阶段时是**那一阶段**
 * 掉的（见 hpAtStage 的 segStart）。
 * 「先扣掉更早的伤，再从那儿接着扣这一段」靠的是虚条位置，不是第二种伤色。
 */
export const hpBarSegments = (
  hpMax: number,
  hp: number,
  hpBefore: number,
): HpBarSegments => {
  const full = hpMax > 0 ? hpMax : 1
  const solidPct = Math.max(0, Math.min(100, (hp / full) * 100))
  const ghost = hpBefore > hp ? ((hpBefore - hp) / full) * 100 : 0
  const ghostPct = Math.max(0, Math.min(100 - solidPct, ghost))
  return { solidPct, ghostPct, emptyPct: Math.max(0, 100 - solidPct - ghostPct) }
}

/**
 * 最后一个**昼/夜段**的起始 stage，也就是「跟随最新」时虚条的基准。
 *
 * 「一段结算」的粒度是昼战/夜战（isNightPhase 的划分），不是流水的每个内部
 * 阶段——昼战里航空战掉一口、炮击又掉一口，虚条画的是**整个昼战段**累计掉的，
 * 不是「最后挨的那一小口」。曾把段锚在内部阶段上：满血参战被打成小破的舰，
 * 伤害分散在几个阶段里，虚条只剩最后一小截，玩家看不见「这场掉了多少」。
 *
 * 玩家点住流水某一阶段时不走这儿：那时基准是那一阶段自己（见 hpAtStage 的
 * segStart），虚条只画这一阶段掉的——上面那条「看不见掉了多少」是**默认视图**的
 * 教训，聚焦时玩家问的正是「就这一下打掉多少」。
 *
 * 用**全部**攻击（不分敌我）划段：段是战斗全局的时间划分，不随受击方变化。
 */
export const segmentStartOf = (
  attacks: readonly Pick<HpTimelineAttack, 'stage' | 'phase'>[] | null | undefined,
): number => {
  // 与 shipHpTimeline 同一口径：回放/合并夜战后顺序不该被默认成天然有序，
  // 乱序时按数组顺序划段会把夜战伤害并进昼战段的虚条。
  const ordered = [...(attacks ?? [])].sort((a, b) => a.stage - b.stage)
  let runStart = 0
  let prevNight: boolean | null = null
  let best = 0
  for (const attack of ordered) {
    const night = attack.phase === 'night' || attack.phase === 'friendly'
    if (prevNight === null || night !== prevNight) {
      runStart = attack.stage
      prevNight = night
    }
    best = runStart
  }
  return best
}

/**
 * 选中某个阶段时，这艘舰显示什么。
 *
 * `stage` 传 null 表示跟随最新（= 整场结果）。`segStart` 是**基准从哪个 stage 起算**：
 * `before` 回答的是「进到这儿的时候还有多少血」，虚条因此是 segStart 到 stage 之间
 * 掉的。这一截若没伤到这艘舰，`before` 与 `hp` 相等，虚条自然是 0——更早掉的血
 * 都在「空」里。
 *
 * 调用方按视图给两种基准：跟随最新时给 segmentStartOf（昼/夜段的段首，虚条是段内
 * 累计）；玩家点住某一阶段时给**那个 stage 自己**，虚条就只剩这一阶段掉的那截。
 */
export const hpAtStage = (
  timeline: ShipHpTimeline,
  stage: number | null,
  segStart = 0,
): { hp: number; before: number } => {
  let hp = timeline.hpStart
  let before = timeline.hpStart
  for (const point of timeline.points) {
    if (stage != null && point.stage > stage) break
    hp = point.hp
    if (point.stage < segStart) before = point.hp
  }
  if (stage == null) hp = timeline.hpEnd
  return { hp, before }
}
