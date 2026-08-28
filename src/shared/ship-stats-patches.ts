// 舰娘成长三维（回避 / 对潜 / 索敌）端点表的**第一方转写补丁台账**。
//
// ---- 为什么需要它 ----
//
// 这三项的 [Lv1, Lv99] 端点游戏**不在主数据里下发**（api_mst_ship 根本没有这三个字段），
// 只能靠社区实测。随包基座是 `kcwiki-ships`（CC BY-NC-SA，可分发）的 `数据.回避/对潜/索敌`。
// 但用户 2026-08-22 实证：kcwiki 那张成长表**显著滞后**——2026-04-07 官方公告的上方修正里，
// 大和改二重【回避】up 之后 wikiwiki 已跟到 62，kcwiki 仍是 60，而账本一手 api_kaihi[1] = 62。
// 所以端点表不能单源。
//
// 出路与 `fit-bonus-corrections.ts` 同一条：**不搬表**（wikiwiki 无许可声明，一格文件都不许抄进随包的包），
// 而是把**分歧的那几格事实**逐条转写进这张第一方台账，带值、带来源、带依据。
// 全表 862 友军形态 × 3 项 × 2 端点 = 5172 格里，需要转写的只有下面这 64 格。
//
// ---- 三张票与裁决顺序（2026-08-22 用户规格「端点表改多源」）----
//
// ① **账本一手**（`via: 'ledger'`）：游戏对**持有形态**其实下发 Lv99 上限——
//    `api_kaihi/api_taisen/api_sakuteki` 的 `[1]` 就是它（依据见 `ship-growth.ts` 文件头）。
//    这是一手事实，无条件压过两个 wiki。init 端游戏不下发，账本票只裁 max 端。
// ② **kcwiki 基座**：随包，覆盖 857 形态。
// ③ **wikiwiki 补丁票**（`via: 'wikiwiki'`）：「艦船最大値」总表 + 定向舰页初期值。
//
// **§裁决一（补缺）**：kcwiki 基座整条没有这个形态 → 取 wikiwiki，标待印证。
// **§裁决二（分歧）**：两边都有且不等时——
//   · wikiwiki **高** 1~2 → 判为「C2 上方修正、kcwiki 未跟」，取 wikiwiki，标待印证。
//     依据不是语感：账本能裁的 4 例（陸奥改二 索敌 +1、早波改 対潜 +1、Helena改 索敌 +1、
//     大和改二重 回避 +2）**全部**证实 wikiwiki 那一侧为真，且后两例正是官方 4/7 公告点名的舰。
//     已知反例 1 例：Nevada改 Mod.2 索敌 kcwiki 52 / wikiwiki 53，账本一手 52 —— 它由 ①
//     直接裁掉，不落这条规则。所以这条规则的实测命中是 4/5，且只在账本裁不了时才生效。
//   · 其余（wikiwiki 偏低，或差值 >2）→ **不动基座**，把 wikiwiki 那一格挂进
//     `SHIP_STAT_SUSPECT_CELLS` 等人复核。账本能裁的 5 例（鳳翔 索敌 69 vs 36、
//     時津風 回避 79 vs 9、宗谷 索敌 12 vs 2、朝霜 対潜 70 vs 64、Gloire改 回避 83 vs 38）
//     全部证实这一侧是 wikiwiki 那张总表**解析/录入错**，不是数据新旧之争。
//
// **§终审**：无论走哪条，`ship-stats.ts` 的**标定闸门**才是上线开关——
// 拿玩家自己的空槽舰逐艘验 `面板 == 插值(端点, 等级)`，零残差才准启用该形态该项的面板反推。
//
// ---- 自失效 ----
//
// 每条补丁钉着它写下时 kcwiki 基座那一格的值（`base`）。上游哪天改了那一格，
// 对不上就**跳过并告警**，而不是拿一份过期裁决去改一个已经变了样的东西。
// `base: null` = 写下时基座整条缺失，核对的是「现在仍然缺」。
//
// **这个文件不 import 任何东西**（维护者脚本与运行时都要能直接读它）。

export type ShipGrowthKey = 'evasion' | 'asw' | 'los'
export type ShipStatEnd = 'init' | 'max'

export interface ShipStatPatch {
  formId: number
  /** 给人读的锚，不参与判定 */
  name: string
  key: ShipGrowthKey
  end: ShipStatEnd
  value: number
  /** 写下这条时 kcwiki 基座那一格的值；null = 基座整条缺失。自失效判据 */
  base: number | null
  via: 'ledger' | 'wikiwiki'
  why: string
}

/** 补丁台账。裁决日 2026-08-22，账本观测日 2026-08-06（423 舰全量快照）。 */
export const SHIP_STAT_PATCHES: readonly ShipStatPatch[] = Object.freeze([
  { formId: 195, name: '綾波改二', key: 'los', end: 'max', value: 51, base: 49, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 49 / wikiwiki 51（+2，上方修正型），取勤快侧待印证' },
  { formId: 363, name: '春風改', key: 'evasion', end: 'max', value: 91, base: 90, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 90 / wikiwiki 91（+1，上方修正型），取勤快侧待印证' },
  { formId: 363, name: '春風改', key: 'asw', end: 'max', value: 76, base: 75, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 75 / wikiwiki 76（+1，上方修正型），取勤快侧待印证' },
  { formId: 392, name: 'Richelieu改', key: 'evasion', end: 'max', value: 74, base: 73, via: 'ledger',
    why: '账本一手 api_kaihi[1]=74（观测 2026-08-06）；kcwiki 基座 73、wikiwiki 73' },
  { formId: 542, name: '夕雲改二', key: 'los', end: 'max', value: 46, base: 45, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 45 / wikiwiki 46（+1，上方修正型），取勤快侧待印证' },
  { formId: 543, name: '長波改二', key: 'evasion', end: 'max', value: 92, base: 91, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 91 / wikiwiki 92（+1，上方修正型），取勤快侧待印证' },
  { formId: 557, name: '磯風乙改', key: 'asw', end: 'max', value: 72, base: 71, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 71 / wikiwiki 72（+1，上方修正型），取勤快侧待印证' },
  { formId: 558, name: '浜風乙改', key: 'asw', end: 'max', value: 74, base: 73, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 73 / wikiwiki 74（+1，上方修正型），取勤快侧待印证' },
  { formId: 564, name: '風雲改二', key: 'evasion', end: 'max', value: 93, base: 92, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 92 / wikiwiki 93（+1，上方修正型），取勤快侧待印证' },
  { formId: 564, name: '風雲改二', key: 'asw', end: 'max', value: 79, base: 78, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 78 / wikiwiki 79（+1，上方修正型），取勤快侧待印证' },
  { formId: 573, name: '陸奥改二', key: 'los', end: 'max', value: 57, base: 56, via: 'ledger',
    why: '账本一手 api_sakuteki[1]=57（观测 2026-08-06）；kcwiki 基座 56、wikiwiki 57' },
  { formId: 578, name: '朝霜改二', key: 'los', end: 'max', value: 46, base: 44, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 44 / wikiwiki 46（+2，上方修正型），取勤快侧待印证' },
  { formId: 620, name: 'Helena改', key: 'los', end: 'max', value: 77, base: 76, via: 'ledger',
    why: '账本一手 api_sakuteki[1]=77（观测 2026-08-06）；kcwiki 基座 76、wikiwiki 77' },
  { formId: 648, name: '秋雲改二', key: 'evasion', end: 'max', value: 92, base: 91, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 91 / wikiwiki 92（+1，上方修正型），取勤快侧待印证' },
  { formId: 648, name: '秋雲改二', key: 'asw', end: 'max', value: 77, base: 75, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 75 / wikiwiki 77（+2，上方修正型），取勤快侧待印证' },
  { formId: 649, name: '高波改二', key: 'los', end: 'max', value: 62, base: 60, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 60 / wikiwiki 62（+2，上方修正型），取勤快侧待印证' },
  { formId: 688, name: '早波改', key: 'asw', end: 'max', value: 70, base: 69, via: 'ledger',
    why: '账本一手 api_taisen[1]=70（观测 2026-08-06）；kcwiki 基座 69、wikiwiki 70' },
  { formId: 703, name: '有明改', key: 'evasion', end: 'max', value: 89, base: 88, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 88 / wikiwiki 89（+1，上方修正型），取勤快侧待印证' },
  { formId: 724, name: 'Jean Bart改', key: 'evasion', end: 'max', value: 74, base: 73, via: 'ledger',
    why: '账本一手 api_kaihi[1]=74（观测 2026-08-06）；kcwiki 基座 73、wikiwiki 73' },
  { formId: 732, name: 'Drum改', key: 'evasion', end: 'init', value: 18, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 18' },
  { formId: 732, name: 'Drum改', key: 'evasion', end: 'max', value: 59, base: null, via: 'ledger',
    why: '账本一手 api_kaihi[1]=59（观测 2026-08-06）；kcwiki 基座缺这一格、wikiwiki 59' },
  { formId: 732, name: 'Drum改', key: 'los', end: 'init', value: 12, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 12' },
  { formId: 732, name: 'Drum改', key: 'los', end: 'max', value: 43, base: null, via: 'ledger',
    why: '账本一手 api_sakuteki[1]=43（观测 2026-08-06）；kcwiki 基座缺这一格、wikiwiki 43' },
  { formId: 734, name: 'Phoenix改', key: 'evasion', end: 'init', value: 37, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 37' },
  { formId: 734, name: 'Phoenix改', key: 'evasion', end: 'max', value: 82, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 82' },
  { formId: 734, name: 'Phoenix改', key: 'asw', end: 'init', value: 0, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 0' },
  { formId: 734, name: 'Phoenix改', key: 'asw', end: 'max', value: 42, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 42' },
  { formId: 734, name: 'Phoenix改', key: 'los', end: 'init', value: 22, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 22' },
  { formId: 734, name: 'Phoenix改', key: 'los', end: 'max', value: 78, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 78' },
  { formId: 736, name: '榧改', key: 'evasion', end: 'max', value: 85, base: 83, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 83 / wikiwiki 85（+2，上方修正型），取勤快侧待印证' },
  { formId: 736, name: '榧改', key: 'los', end: 'max', value: 48, base: 47, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 47 / wikiwiki 48（+1，上方修正型），取勤快侧待印证' },
  { formId: 740, name: 'Glorious改', key: 'evasion', end: 'max', value: 66, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 66' },
  { formId: 740, name: 'Glorious改', key: 'asw', end: 'max', value: 0, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 0' },
  { formId: 740, name: 'Glorious改', key: 'los', end: 'max', value: 46, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 46' },
  { formId: 741, name: 'Glorious改', key: 'evasion', end: 'max', value: 66, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 66' },
  { formId: 741, name: 'Glorious改', key: 'asw', end: 'max', value: 0, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 0' },
  { formId: 741, name: 'Glorious改', key: 'los', end: 'max', value: 86, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 86' },
  { formId: 892, name: 'Drum', key: 'evasion', end: 'init', value: 17, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 17' },
  { formId: 892, name: 'Drum', key: 'evasion', end: 'max', value: 47, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 47' },
  { formId: 892, name: 'Drum', key: 'los', end: 'init', value: 11, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 11' },
  { formId: 892, name: 'Drum', key: 'los', end: 'max', value: 43, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 43' },
  { formId: 911, name: '大和改二', key: 'evasion', end: 'max', value: 68, base: 67, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 67 / wikiwiki 68（+1，上方修正型），取勤快侧待印证' },
  { formId: 916, name: '大和改二重', key: 'evasion', end: 'max', value: 62, base: 60, via: 'ledger',
    why: '账本一手 api_kaihi[1]=62（观测 2026-08-06）；kcwiki 基座 60、wikiwiki 62' },
  { formId: 944, name: '平安丸', key: 'evasion', end: 'init', value: 14, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 14' },
  { formId: 944, name: '平安丸', key: 'evasion', end: 'max', value: 27, base: null, via: 'ledger',
    why: '账本一手 api_kaihi[1]=27（观测 2026-08-06）；kcwiki 基座缺这一格、wikiwiki 27' },
  { formId: 944, name: '平安丸', key: 'los', end: 'init', value: 11, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 11' },
  { formId: 944, name: '平安丸', key: 'los', end: 'max', value: 30, base: null, via: 'ledger',
    why: '账本一手 api_sakuteki[1]=30（观测 2026-08-06）；kcwiki 基座缺这一格、wikiwiki 30' },
  { formId: 949, name: '平安丸改', key: 'evasion', end: 'init', value: 16, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 16' },
  { formId: 949, name: '平安丸改', key: 'evasion', end: 'max', value: 37, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 37' },
  { formId: 949, name: '平安丸改', key: 'los', end: 'init', value: 18, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 18' },
  { formId: 949, name: '平安丸改', key: 'los', end: 'max', value: 39, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 39' },
  { formId: 952, name: 'Phoenix', key: 'evasion', end: 'init', value: 31, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 31' },
  { formId: 952, name: 'Phoenix', key: 'evasion', end: 'max', value: 68, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 68' },
  { formId: 952, name: 'Phoenix', key: 'asw', end: 'init', value: 0, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 0' },
  { formId: 952, name: 'Phoenix', key: 'asw', end: 'max', value: 34, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 34' },
  { formId: 952, name: 'Phoenix', key: 'los', end: 'init', value: 18, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 18' },
  { formId: 952, name: 'Phoenix', key: 'los', end: 'max', value: 68, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 68' },
  { formId: 1027, name: 'Glorious', key: 'evasion', end: 'init', value: 32, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 32' },
  { formId: 1027, name: 'Glorious', key: 'evasion', end: 'max', value: 56, base: null, via: 'ledger',
    why: '账本一手 api_kaihi[1]=56（观测 2026-08-06）；kcwiki 基座缺这一格、wikiwiki 56' },
  { formId: 1027, name: 'Glorious', key: 'asw', end: 'init', value: 0, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 0' },
  { formId: 1027, name: 'Glorious', key: 'asw', end: 'max', value: 0, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 0' },
  { formId: 1027, name: 'Glorious', key: 'los', end: 'init', value: 12, base: null, via: 'wikiwiki',
    why: 'kcwiki 基座缺这一格（本形态整条不在「模块:舰娘数据」里）；wikiwiki 舰页 12' },
  { formId: 1027, name: 'Glorious', key: 'los', end: 'max', value: 65, base: null, via: 'ledger',
    why: '账本一手 api_sakuteki[1]=65（观测 2026-08-06）；kcwiki 基座缺这一格、wikiwiki 65' },
  { formId: 1036, name: 'Independence Flight II', key: 'evasion', end: 'init', value: 33, base: 32, via: 'wikiwiki',
    why: '两 wiki 分歧 kcwiki 32 / wikiwiki 33（+1，上方修正型），取勤快侧待印证' },
])

/**
 * wikiwiki 那张总表**疑似解析/录入错**的格：一律**不动 kcwiki 基座**，挂在这里等人复核。
 *
 * 判据见文件头 §裁决二。这里的每一条都不影响出包的值（`kept` 就是基座值），
 * 列出来只为一件事：下次有人拿 wikiwiki 对账时，别把这几格当成「我们漏跟了」。
 */
export interface ShipStatSuspect {
  formId: number
  name: string
  key: ShipGrowthKey
  end: ShipStatEnd
  /** 出包实际采用的值（= kcwiki 基座） */
  kept: number
  wikiwiki: number
  why: string
}

export const SHIP_STAT_SUSPECT_CELLS: readonly ShipStatSuspect[] = Object.freeze([
  { formId: 228, name: '雪風改', key: 'asw', end: 'max', kept: 60, wikiwiki: 59,
    why: 'wikiwiki 与 kcwiki 差 -1（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 228, name: '雪風改', key: 'los', end: 'max', kept: 41, wikiwiki: 39,
    why: 'wikiwiki 与 kcwiki 差 -2（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 235, name: '響改', key: 'evasion', end: 'max', kept: 91, wikiwiki: 89,
    why: 'wikiwiki 与 kcwiki 差 -2（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 274, name: '筑摩改', key: 'los', end: 'max', kept: 79, wikiwiki: 77,
    why: 'wikiwiki 与 kcwiki 差 -2（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 747, name: 'Reno改', key: 'evasion', end: 'init', kept: 38, wikiwiki: 37,
    why: 'wikiwiki 与 kcwiki 差 -1（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 747, name: 'Reno改', key: 'los', end: 'init', kept: 10, wikiwiki: 9,
    why: 'wikiwiki 与 kcwiki 差 -1（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 981, name: '藤波改二', key: 'asw', end: 'init', kept: 30, wikiwiki: 29,
    why: 'wikiwiki 与 kcwiki 差 -1（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  { formId: 1006, name: 'Киров改', key: 'evasion', end: 'max', kept: 78, wikiwiki: 39,
    why: 'wikiwiki 与 kcwiki 差 -39（wikiwiki 偏低），不是上方修正的形状，按 §裁决二 取 kcwiki 并挂牌复核' },
  // 下面 6 条不是「按形状判」，是**账本一手当场判死的**：这几艘在籍，
  // api_*[1] 与 kcwiki 逐格相同，与 wikiwiki 差得离谱。它们是 §裁决二 后半段
  // （「wikiwiki 那张总表解析/录入错」）最硬的证据，所以单独列在这里，
  // 而不是混进上面那批靠差值形状判的。
  { formId: 89, name: '鳳翔', key: 'los', end: 'max', kept: 69, wikiwiki: 36,
    why: '账本一手 api_sakuteki[1]=69（观测 2026-08-06）＝kcwiki；wikiwiki 36 是错值' },
  { formId: 186, name: '時津風', key: 'evasion', end: 'max', kept: 79, wikiwiki: 9,
    why: '账本一手 api_kaihi[1]=79（观测 2026-08-06）＝kcwiki；wikiwiki 9 是错值' },
  { formId: 425, name: '朝霜', key: 'asw', end: 'max', kept: 70, wikiwiki: 64,
    why: '账本一手 api_taisen[1]=70（观测 2026-08-06）＝kcwiki；wikiwiki 64 是错值' },
  { formId: 699, name: '宗谷', key: 'los', end: 'max', kept: 12, wikiwiki: 2,
    why: '账本一手 api_sakuteki[1]=12（观测 2026-08-06）＝kcwiki；wikiwiki 2 是错值' },
  { formId: 936, name: 'Nevada改 Mod.2', key: 'los', end: 'max', kept: 52, wikiwiki: 53,
    why:
      '账本一手 api_sakuteki[1]=52（观测 2026-08-06）＝kcwiki；wikiwiki 53。' +
      '**这是 §裁决二「wikiwiki 高 1~2 判上方修正」那条规则唯一的已知反例**——' +
      '它由账本票直接裁掉，不落那条规则。规则的实测记录因此是 4 中 4 对（有账本旁证的四例）、' +
      '连这一例算 5 中 4，且只在账本裁不了时才生效。' },
  { formId: 970, name: 'Gloire改', key: 'evasion', end: 'max', kept: 83, wikiwiki: 38,
    why: '账本一手 api_kaihi[1]=83（观测 2026-08-06）＝kcwiki；wikiwiki 38 是错值' },
])

/**
 * 三张票**都没有**的格。出包时这一格就是缺的，面板反推对该形态该项一律不启用
 *（`ship-stats.ts` 的 `noEndpoint`），界面如实说「缺成长端点」而不是摆个 0。
 */
export interface ShipStatGap {
  formId: number
  name: string
  key: ShipGrowthKey
  end: ShipStatEnd
}

export const SHIP_STAT_GAPS: readonly ShipStatGap[] = Object.freeze([
  { formId: 740, name: 'Glorious改', key: 'evasion', end: 'init' },
  { formId: 740, name: 'Glorious改', key: 'asw', end: 'init' },
  { formId: 740, name: 'Glorious改', key: 'los', end: 'init' },
  { formId: 741, name: 'Glorious改', key: 'evasion', end: 'init' },
  { formId: 741, name: 'Glorious改', key: 'asw', end: 'init' },
  { formId: 741, name: 'Glorious改', key: 'los', end: 'init' },
])

/**
 * 官方公告播种表（用户 2026-08-22 定的口径）。
 *
 * 官方 X @KanColle_STAFF 的「上方修正」公告**只说谁和哪项，不说加多少**。
 * 但它是一手事实、零许可问题，转写成事件清单之后有两个用处：
 *
 * ① **按通道拆开读**。走 `api_mst_ship` 的项（火力max / 対空max / 運max …）主数据一更新
 *    我们自动到手，kcwiki 烂不烂无所谓；**只有 回避 / 対潜 / 索敌 三项是服务端项**——
 *    主数据里根本看不见，wiki 只能人肉重测，这才是标定闸门的风险区。维护者只需盯这三个词。
 * ② **给「成长值疑似过时」定性**。闸门抓到的残差若命中清单，直接从「疑似过时」
 *    升级成「确认过时 + 官方上修 YYYY-MM-DD」。反向亦然：清单里的舰若在籍，
 *    就是闸门的首批指名测试对象。
 */
export interface ShipGrowthNotice {
  /** 公告日（JST） */
  at: string
  source: string
  /** 点名的形态 */
  forms: { formId: number; name: string }[]
  /** 走主数据的项（会自愈，只记录不设防） */
  masterStats: string[]
  /** 服务端项（无声腐坏源，闸门的风险区） */
  serverStats: ShipGrowthKey[]
  note: string
}

export const SHIP_GROWTH_NOTICES: readonly ShipGrowthNotice[] = Object.freeze([
  {
    at: '2026-04-07',
    source: '官方 X @KanColle_STAFF 上方微修正公告',
    forms: [
      { formId: 663, name: '矢矧改二' },
      { formId: 668, name: '矢矧改二乙' },
    ],
    masterStats: ['対空max', '運max'],
    serverStats: [],
    note:
      '两项都走 api_mst_ship，主数据一更新自动到手。账本核对：矢矧改二乙 対空max 主数据 89、運max 108，' +
      '与 wikiwiki 一致；kcwiki 那张表当时仍是 88/89——正是「kcwiki 滞后」这一判断的用户实证起点。',
  },
  {
    at: '2026-04-07',
    source: '官方 X @KanColle_STAFF 上方微修正公告',
    forms: [
      { formId: 911, name: '大和改二' },
      { formId: 916, name: '大和改二重' },
    ],
    masterStats: [],
    serverStats: ['evasion'],
    note:
      '**纯服务端项**，主数据里看不见。账本一手裁定：大和改二重 api_kaihi[1] = 62（观测 2026-08-06），' +
      'kcwiki 仍是 60、wikiwiki 已跟到 62 —— kcwiki 那一格确认过时（不是疑似）。' +
      '大和改二不在籍，按 §裁决二 取 wikiwiki 68（kcwiki 67），待印证。',
  },
  {
    at: '2026-04-07',
    source: '官方 X @KanColle_STAFF 上方微修正公告',
    forms: [
      { formId: 557, name: '磯風乙改' },
      { formId: 558, name: '浜風乙改' },
    ],
    masterStats: ['火力max'],
    serverStats: ['asw'],
    note:
      '火力max 走主数据自愈；対潜是服务端项。两舰都不在籍，闸门裁不了，' +
      '按 §裁决二 取 wikiwiki（磯風乙改 72 / 浜風乙改 74，kcwiki 分别 71 / 73），待印证。' +
      '**用户若日后收了这两艘，把空装备状态下的面板对一次就能终审。**',
  },
])
