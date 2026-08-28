// 任务精确计数（quest progress）——主进程引擎与钦共用的展示类型。
// 判定规则由四层规则源装配（kcwiki-quest-req → poi-quest-goal → 艦素自研 → 中文正文兜底），
// 口径见 src/main/mg/quest-counter.ts 的文件头。

export type QpMapRef = [area: number, info: number]

/** 没有 Boss、以到达终点为「クリア」的护航图（现役只有 1-6）。 */
export const isEscortGoalMap = (map: QpMapRef): boolean => map[0] === 1 && map[1] === 6

export type QpTask = (
  | { kind: 'bossKill'; map: QpMapRef; rank: number; count: number }
  | { kind: 'battleNode'; map: QpMapRef; rank: number; count: number; nodes: number[]; name: string | null }
  | { kind: 'battleWin'; rank: number; count: number } // 任意海域出击战斗；rank=0 表示胜负不限
  | { kind: 'bossReach'; count: number }
  | { kind: 'bossWin'; rank: number; count: number }
  | { kind: 'sinkEnemy'; stypes: number[]; count: number }
  | { kind: 'expedition'; missionId: number; count: number } // missionId=0 表示任意成功远征
  | { kind: 'scrapEquip'; equipId: number; count: number }
  | { kind: 'scrapCategory'; category: number; count: number }
  | { kind: 'scrapCardType'; cardType: number; count: number }
  | { kind: 'scrapIconType'; iconType: number; count: number }
  | { kind: 'nodeReach'; map: QpMapRef; count: number; nodes: number[]; name: string | null }
  | { kind: 'mapFirstClear'; map: QpMapRef; count: number }
  // 护航图的「クリア」：到达终点（罗盘事件 8）每次都算，不是海域首通——
  // 首通口径下已通关的提督永远计不了数（2026-08-12 用户实锤：By2 到 N 没 +1）
  | { kind: 'mapGoal'; map: QpMapRef; count: number }
  | { kind: 'exercise'; rank: number; count: number }
  // 工厂类动作：由任务库文本推导 → 一律标 ≈
  // perItem：这条任务按「件数」而不是「操作回数」计。现只对 destroyitem 有意义
  // （一括廃棄 n 件 = +n）；缺省不写 = 按操作回数，见 quest-counter-rules 的 actionIncrement。
  | { kind: 'action'; action: QpAction; label: string; count: number; perItem?: true }
) & {
  slot?: number // 多个候选 task 可共享一个计数槽，表达“任一命中”
  fleetGoal?: QpFleetGoal // 组合规则中，每条动作可保留自己的编成门
}

export type QpAction =
  | 'createitem' // 开发装备
  | 'createship' // 建造舰娘
  | 'destroyship' // 解体舰娘
  | 'destroyitem' // 废弃装备
  | 'charge' // 补给
  | 'nyukyo' // 入渠
  | 'remodel_slot' // 装备改修（改修工厂）
  | 'powerup' // 近代化改修
  | 'sortie' // 出击
  | 'expedition_start' // 派出任意远征（初次远征任务）

export type QpTrackerSource = 'kcwiki' | 'poi' | 'text' | 'kanso'

export type QpStockGoal =
  | { kind: 'equip'; id: number; label: string; count: number }
  | { kind: 'equipCategory'; ids: number[]; label: string; count: number }
  | { kind: 'useitem'; id: number; label: string; count: number }
  | { kind: 'material'; id: number; label: string; count: number }

export interface QpFleetGoalGroup {
  label: string
  ships: number[] | 'any' | 'other'
  stypes: number[]
  ctypes?: number[]
  amount: number
  maxAmount?: number
  flagship?: boolean
  position?: number
  lv?: number
  speedMin?: number
  speedMax?: number
  /** 「含旗舰/含具名舰」口径的伞组：允许与其他组共用同一艘舰，组间去重
   *  跳过它（组内数量线仍独立校验）。B149「美英澳荷≥3（含 Fletcher 旗舰）」
   *  被去重误杀过——3 美 1 日的标准编成打 Boss S 不计数（2026-08-11 实锤）。 */
  overlapOk?: boolean
}

export interface QpFleetGoal {
  groups: QpFleetGoalGroup[]
  disallowedStypes?: number[]
  allowOnlyGoalShips?: boolean
  fleetId?: number
  /** 「合計N隻**以下**」的总数上限（By2：海防艦3隻を含む5隻以下）。
   *  kcwiki 用「任意组×k + 他の艦禁止」编码它——任意组是允许额度不是下限，
   *  照下限校验会把 4 隻的合规编成打成不通过（2026-08-12 用户实锤）。 */
  maxShips?: number
}

export interface QpStateGoalSecretary {
  label: string
  ships: number[] | 'any'
  stypes: number[]
}

export interface QpStateGoalEquipment {
  label: string
  mstIds: number[]
  slot?: number
  fullySkilled?: boolean
  maxModified?: boolean
  /** 改修至少 ★+N（F116 的 ★+3、F120/F128 的 ★+8 这类门槛） */
  minLevel?: number
}

export interface QpStateGoal {
  secretary?: QpStateGoalSecretary
  equipment?: QpStateGoalEquipment[]
}

export interface QpStateGoalLine {
  label: string
  current: number
  required: number
  ok: boolean
  issue: string | null
}

export interface QpStateGoalDiff {
  ok: boolean
  lines: QpStateGoalLine[]
}

export interface QpFleetGoalLine {
  label: string
  current: number
  required: number
  ok: boolean
  issue: string | null
}

export interface QpFleetDeckDiff {
  deckId: number
  ok: boolean
  lines: QpFleetGoalLine[]
}

export const qpTaskSlot = (task: QpTask, index: number): number =>
  Number.isInteger(task.slot) && (task.slot as number) >= 0 ? task.slot as number : index

export const qpTaskGroups = (tasks: QpTask[]) => {
  const grouped = new Map<number, { task: QpTask; index: number }[]>()
  tasks.forEach((task, index) => {
    const slot = qpTaskSlot(task, index)
    const entries = grouped.get(slot) ?? []
    entries.push({ task, index })
    grouped.set(slot, entries)
  })
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slot, entries]) => ({ slot, entries }))
}

// 渲染层拿到的单任务追踪信息。编成条件一律走 fleetGoal（结构化，钦自己渲染成
// 「编成检查」逐条对照），不再另发一份纯文本摘要——两份表达迟早会说不到一块去。
export interface QpTrackerInfo {
  questId: number
  tasks: QpTask[]
  source: QpTrackerSource
  fleetGoal?: QpFleetGoal
  stateGoal?: QpStateGoal
  stateGoalReady?: boolean
  stockGoals?: QpStockGoal[]
  approx: boolean // 判定含拿不准的项 → 计数可能偏多，UI 标 ≈
  partial: boolean // true = 只覆盖部分条件；计数满不代表整项任务可交付
  // 现在这条到底会不会计数，以及卡在哪。**由派发时用的同一道门算出**，
  // 不在渲染端另算一遍——两边各判一次迟早会出现「诊断说在计数、实际没计」。
  blocked: QpBlockReason | null
}

/**
 * 动作发生时这条任务拿不到计数的原因。null = 没被挡住。
 *
 * **只含受领门**，与 activeTracked() 的两条 continue 一一对应。
 * 「没有可计数动作」不放进来：那是 tasks.length === 0 的结构事实，
 * 塞进同一个判定会让它抢在两道硬门前面返回，activeTracked 就会多收人。
 */
export type QpBlockReason =
  | 'periodStale' // 周期任务：受领确认还停在上一周期，得重新看一次任务页
  | 'notReceived' // 没观测到它在遂行中（未领取，或从没同步过任务页）

export const QP_BLOCK_TEXT: Record<QpBlockReason, { label: string; how: string }> = {
  periodStale: {
    label: '受领状态还停在上一周期',
    how: '在游戏里打开一次任务页，或重新领取，计数就会恢复',
  },
  notReceived: {
    label: '没看到它在遂行中',
    how: '在游戏里领取并打开一次任务页即可',
  },
}

// qp:check-fleet 的返回：questId → 编成条件由哪几支舰队满足
// hasCond=false 表示该任务无编成限制（任何编成都能推进）
export type QpFleetCheck = Record<
  number,
  {
    hasCond: boolean
    decks: number[]
    diffs?: QpFleetDeckDiff[]
    stateGoal?: QpStateGoalDiff
  }
>

export interface QpState {
  trackers: Record<number, QpTrackerInfo>
  // questId → 各**槽位**当前计数。按 qpTaskSlot(task, index) 读，不能按 tasks 下标：
  // 「远征 A 或 B」这类备选任务共享一个槽，下标与槽位会错位（镖曾因此串位）。
  progress: Record<number, number[]>
  serverFloors: Record<number, { flag: 1 | 2; counts: number[] }> // 游戏粗档换算出的可证明下限；不覆盖本地原始数
  packCredit: string | null // 「谁说的、多新」
}

// EO BattleRank 下限值 → 游戏显示名。EO 内部值 7 叫 SS，但游戏显示仍是 S（完全胜利）。
export const QP_RANK_NAME: Record<number, string> = {
  1: 'E',
  2: 'D',
  3: 'C',
  4: 'B',
  5: 'A',
  6: 'S',
  7: 'S（完全胜利）',
}
