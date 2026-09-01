// 「谁给了 boss 最后一击」——一场 boss 战里，终结敌旗舰的那一击归谁。
//
// 这不是推算。战斗解析层逐击模拟 HP（battle.ts 的 applyHit），归零那一刻就地把
// `hits[].sunk` 立起来；这里只是**把已经记下来的那一击找出来**，读它的 side/attacker。
// 判据全在快照里，一条也不靠外部知识补。
//
// 实时落账（ship-life 的战斗段）与老快照回算（ledger 的 v10 迁移）共用这一个函数，
// 两边跑不出第二套口径——这与 ship-join-origin 是同一条纪律。
//
// ---- 三档语义，照报文本身分 ----
//
// - `side=0 && attacker>=0`：我方某一舰位打出的。这是唯一会落到单舰头上的一档。
// - `attacker=-1`：报文本来就没给逐舰归属。航空战/基地航空/喷气强袭是**阶段伤害**
//   （stage3 只说哪一格挨了多少，不说谁投的弹），支援舰队同理（那支队伍根本不在
//   这场战斗的舰表里）。这两类**不摊给任何人**——与 battle.ts 里 `attacker<0`
//   就不累加 damageDealt 是同一条口径。
// - `side=2`（NPC 友军）：见下面的护栏。
//
// ---- 为什么 side=2 走异常而不是「记成友军击杀」----
//
// 机制上活动友军不会终结敌旗舰（对旗舰锁血最多打到 1，最后一击只能是本队）。
// 但这条机制**没有写进代码**：这里不去 `if (side === 2) 视为打不死`，那等于把
// 一条会随版本变的官方规则硬编进数据层。归属只读数据——真读出 side=2 终结了
// 敌旗舰，先当**解析 bug**（友军段的舰位映射历史上翻过车，见 battle.ts
// activeDeckIndex 的头注），登记成异常、不写归属，让调用方 warn 出来。
// 若哪天机制真变了，异常计数会先冒出来，那时再改口径也来得及。
//
// `side=1`（敌打敌旗舰）同样只可能是解析错位，一并登记异常。

/** 一击。字段取 BattleAttack.hits 的子集。 */
export interface BossKillHit {
  /** 受击方舰位（与 BattleShipView.index 同一套 0-11 视图舰位） */
  target: number
  /** 该击后目标 HP 落 0 */
  sunk?: boolean
}

/** 一次攻击。字段取 BattleAttack 的子集。 */
export interface BossKillAttack {
  phase: string
  /** 0 我方 / 1 敌方 / 2 NPC 友军 */
  side: number
  /** 攻方舰位；-1 = 无逐舰归属 */
  attacker: number
  /** 真实阶段序 */
  stage: number
  /** 同阶段行动序 */
  action: number
  hits?: BossKillHit[]
}

/** 一条舰位记录。字段取 BattleShipView 的子集。 */
export interface BossKillShip {
  index: number
  fleet: string
  position: number
  mstId: number
}

/**
 * 无逐舰归属的那两档。
 *
 * 名单照 BattleAttack.phase 的字面量抄，**不按「名字里有没有 air」猜**：
 * 漏一个的后果是它落进 unknown 异常档（吵，但不会写错账），
 * 而把逐舰阶段误列进来会让真正的击杀者被记成「航空」，那是静默的错。
 */
const AIRCRAFT_PHASES = new Set(['lbas', 'injection', 'air', 'air2', 'friendlyAir'])
const SUPPORT_PHASES = new Set(['support'])

/** 终结那一击的归属。`ship` 是唯一会落到单舰头上的一档。 */
export type BossKillAgent =
  | { kind: 'ship'; index: number }
  | { kind: 'aircraft'; phase: string }
  | { kind: 'support'; phase: string }

export type BossKillAnomalyKind =
  /** 同一场里读出不止一条「终结敌旗舰」的击（复活再沉之类的怪形态） */
  | 'multiple-final-blows'
  /** NPC 友军终结了敌旗舰：先疑解析 bug，再疑机制变更 */
  | 'npc-final-blow'
  /** 敌方打沉了敌旗舰：只可能是舰位错位 */
  | 'enemy-final-blow'
  /** attacker=-1 但阶段不在航空/支援名单里：新阶段，或解析层改了口径 */
  | 'unattributed-phase'

export interface BossKillAnomaly {
  kind: BossKillAnomalyKind
  phase: string
  side: number
  attacker: number
  /** multiple-final-blows 时是读出的条数 */
  count?: number
}

export interface BossKillVerdict {
  /** 敌旗舰的视图舰位（敌联合也是 0：主力队第一格） */
  flagshipIndex: number
  /** 敌旗舰的深海 mstId；落账写的就是它 */
  flagshipMstId: number
  /** 敌旗舰这一战有没有沉。false 时 agent 必为 null */
  flagshipSunk: boolean
  /** 归属；无人终结、或撞上异常护栏时为 null */
  agent: BossKillAgent | null
  /** 终结那一击的定位（stage/action），异常时也填，便于对着流水复核 */
  at: { phase: string; stage: number; action: number } | null
  anomalies: BossKillAnomaly[]
}

/**
 * 敌旗舰是哪一条：敌主力队的第一格。
 *
 * 联合敌军（12 舰）同样是主力 #0——护卫队的旗舰不是 boss。
 * 按 `fleet/position` 认而不是直接取 `index === 0`：视图舰位的 0 本来就等价，
 * 但这样写在联合形态下自证，不必读者去回想两队的下标怎么排。
 */
export const enemyFlagshipOf = <T extends BossKillShip>(eShips: readonly T[]): T | null =>
  eShips.find((ship) => ship.fleet === 'main' && ship.position === 0) ?? null

/**
 * 找出终结敌旗舰的那一击并定归属。
 *
 * 调用方负责先确认这是**非演习的 boss 战**——这里不去猜战斗性质，
 * 快照里的 `is_boss` / `practice` 是账本自己的列，比重新判一遍可靠。
 *
 * 敌旗舰不在（空敌表）时返回 null：那不是「没人终结」，是这场压根没得判。
 */
export const resolveBossKill = (
  eShips: readonly BossKillShip[],
  attacks: readonly BossKillAttack[],
): BossKillVerdict | null => {
  const flagship = enemyFlagshipOf(eShips)
  if (!flagship) return null
  const anomalies: BossKillAnomaly[] = []
  const base = {
    flagshipIndex: flagship.index,
    flagshipMstId: flagship.mstId,
  }

  // 按真实阶段序排一遍再找。attacks 数组通常已经是这个顺序，但夜战包合并进来的段
  // 是追加的，排序是那条「取最后一条」的前提——不排的话「最后」只是数组末尾。
  const finals: { attack: BossKillAttack }[] = []
  const ordered = [...attacks].sort((l, r) => l.stage - r.stage || l.action - r.action)
  for (const attack of ordered) {
    for (const hit of attack.hits ?? []) {
      if (hit.sunk === true && hit.target === flagship.index) finals.push({ attack })
    }
  }

  if (!finals.length) {
    return { ...base, flagshipSunk: false, agent: null, at: null, anomalies }
  }
  if (finals.length > 1) {
    const first = finals[0].attack
    anomalies.push({
      kind: 'multiple-final-blows',
      phase: first.phase,
      side: first.side,
      attacker: first.attacker,
      count: finals.length,
    })
  }
  // 多条时取最后一条：真发生「沉了又沉」，最后那一次才是这一战的终点。
  const attack = finals[finals.length - 1].attack
  const at = { phase: attack.phase, stage: attack.stage, action: attack.action }
  const flag = { ...base, flagshipSunk: true, at }
  const note = (kind: BossKillAnomalyKind) => {
    anomalies.push({ kind, phase: attack.phase, side: attack.side, attacker: attack.attacker })
    return { ...flag, agent: null, anomalies }
  }

  if (attack.side === 2) return note('npc-final-blow')
  if (attack.side === 1) return note('enemy-final-blow')
  if (attack.attacker >= 0) {
    return { ...flag, agent: { kind: 'ship', index: attack.attacker }, anomalies }
  }
  if (AIRCRAFT_PHASES.has(attack.phase)) {
    return { ...flag, agent: { kind: 'aircraft', phase: attack.phase }, anomalies }
  }
  if (SUPPORT_PHASES.has(attack.phase)) {
    return { ...flag, agent: { kind: 'support', phase: attack.phase }, anomalies }
  }
  return note('unattributed-phase')
}

/** 异常给人看的一行；warn 与迁移日志共用，两处不各写一句。 */
export const bossKillAnomalyText = (anomaly: BossKillAnomaly): string => {
  const where = `phase=${anomaly.phase} side=${anomaly.side} attacker=${anomaly.attacker}`
  switch (anomaly.kind) {
    case 'multiple-final-blows':
      return `读出 ${anomaly.count} 条终结敌旗舰的击（应只有一条），取最后一条；${where}`
    case 'npc-final-blow':
      return `NPC 友军终结了敌旗舰——先疑友军段舰位解析，不写归属；${where}`
    case 'enemy-final-blow':
      return `敌方打沉了敌旗舰——只可能是舰位错位，不写归属；${where}`
    case 'unattributed-phase':
      return `无逐舰归属的攻击来自名单外的阶段，不写归属；${where}`
  }
}
