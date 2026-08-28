// 前置链三源仲裁表（2026-08-17，用户提议「自己分析一个个拼凑」后做的裁决）。
//
// 三源 = kcwiki(quests-scn) × wikiwiki(任務页) × KC3Kai(quests_meta.json 的 unlock
// 前向边反转，api_id 键控无对齐歧义)。另用本机账本两周流水做了证伪扫描：
// 「X 与其号称前置 P 同表共存」在周期规则下（P 周期 ≥ X 周期才有效）零命中，
// 即两个 wiki 的主张没有一条被第一手观测推翻。
//
// **只收硬裁决，弱证据不进表**：
// - KC3Kai 在双 wiki 一致集上完全吻合率 71%，不吻合的基本是它少记周期前置——
//   有系统性省略偏差。所以它站在「更小集合」一边不算数（可能只是共同省略），
//   只有它**肯定了争议项的存在**才算数（省略型偏差不会凭空发明一条前置）。
//   按此规则 36 个 2v1 里只有 5 个成立，其余 31 个弱倾向一律不裁。
// - B204/F128/F135 的悬空限时码经 EO 对照确认身份（#1020=2409B1、#1037=2508B1），
//   kcwiki 与 KC3Kai 两源一致：真前置就是已下线的限时任务；wikiwiki 给的替代链
//   全部自标「達成後？」。裁决保留限时码——判定端对库外码如实给「未同步」，
//   不猜测玩家当年做没做过。
//
// 复算方法（数据更新后）：拉 KC3Kai src/data/quests_meta.json，反转 unlock 得
// 前置主张，与 assets/review/quest-pre-reconcile.json 的 conflicts 逐条对表决，
// 强弱分级规则如上。账本证伪扫描见 events 表 questlist 流水的同表共存检查。
export interface QuestPreArbitrationEntry {
  /** 裁定的现行前置（可含库外的限时码——判定端会退「未同步」） */
  pre: string[]
  /** 裁决依据，详情面板原样展示 */
  basis: string
}

export const QUEST_PRE_ARBITRATION: ReadonlyMap<string, QuestPreArbitrationEntry> = new Map([
  [
    'B100',
    {
      pre: ['B98', 'Bw5'],
      basis: 'kcwiki 与 KC3Kai 一致，KC3Kai 肯定 Bw5 存在；wikiwiki 漏记 Bw5',
    },
  ],
  [
    'Cq1',
    {
      pre: ['Bd1', 'C9'],
      basis: 'kcwiki 与 KC3Kai 一致，KC3Kai 肯定 C9；wikiwiki 写 B9 且自标待查证',
    },
  ],
  [
    'Cs3',
    {
      pre: ['Cd1'],
      basis: 'wikiwiki 与 KC3Kai 一致，KC3Kai 肯定 Cd1；kcwiki 写的 B6+C1 无第二源支持',
    },
  ],
  [
    'F61',
    {
      pre: ['A80', 'Fd4'],
      basis: 'wikiwiki 与 KC3Kai 一致，KC3Kai 肯定 Fd4；kcwiki 写 Fd3',
    },
  ],
  [
    'F91',
    {
      pre: ['B154', 'C46'],
      basis: 'wikiwiki 与 KC3Kai 一致，KC3Kai 肯定 C46 存在；kcwiki 漏记 C46',
    },
  ],
  [
    'B204',
    {
      pre: ['2409B1'],
      basis:
        'kcwiki 与 KC3Kai 一致：前置是 2024 秋限时任务「第三戦隊」緊急展開！；wikiwiki 的 B135+C15 自标待查证',
    },
  ],
  [
    'F128',
    {
      pre: ['2409B1', 'Cy15'],
      basis:
        'kcwiki 与 KC3Kai 一致：前置含 2024 秋限时任务「第三戦隊」緊急展開！；wikiwiki 只写 Cy15 且自标待查证',
    },
  ],
  [
    'F135',
    {
      pre: ['2508B1', 'F76'],
      basis:
        'kcwiki 与 KC3Kai 一致：前置含 2025 秋限时任务「秋の旗艦は……私ッ！」；wikiwiki 只写 F76 且自标待查证',
    },
  ],
])
